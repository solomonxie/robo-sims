import * as THREE from 'three/webgpu'
import {
  CalMode,
  DEG,
  GYRO_RANGES,
  GYRO_ZRO,
  GyroRange,
  accelTilt,
  angleRms,
  balanceRun,
  bodyAccel,
  combChange,
  compTau,
  coriolisAccel,
  countsToDps,
  driftRun,
  driveSpeed,
  gyroBiasAt,
  gyroCounts,
  headingPath,
  integrateRate,
  proofShift,
  residualBias,
  toDeg,
  yawProfile,
} from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CLK_COLOR,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  arrow,
  codeBlock,
  glowMat,
  liveLabel,
  memoBy,
  partLetter,
  pointCloud,
  scope,
  setGlow,
  shadowlessRod,
  stretchRod,
  ticks,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'
import { signed } from '../../core/units'

const MPU_F0 = 2500
const COMB_GAP = 2e-6
const BOARD = '#2c6e3a'

/** A small robot seen side-on, facing +x, wheel axle at the origin; `roll(x)` spins the wheels for travel `x`. */
function sideRobot(parent: THREE.Object3D, k = 1) {
  const g = add(parent, new THREE.Group())
  g.scale.setScalar(k)
  box(g, [8, 1.6, 4], mat('#d8dbe2', { rough: 0.55 }), [0, 1.2, 0])
  const imu = box(g, [2.4, 0.3, 1.8], mat(BOARD, { rough: 0.55 }), [0.6, 2.15, 0])
  box(g, [0.8, 0.25, 0.8], mat('#16171b', { rough: 0.5 }), [0.6, 2.4, 0])
  const wheels = [-2.6, 2.6].map((x) => {
    const w = add(g, new THREE.Group(), [x, 0, 0])
    cylinder(w, 1.4, 4.4, mat('#1c1c1f', { rough: 0.8 }), [0, 0, 0], 'z', 24)
    box(w, [2.2, 0.35, 4.5], mat('#f2c230', { rough: 0.5 }))
    return w
  })
  return { group: g, imu, roll: (x: number) => wheels.forEach((w) => (w.rotation.z = -x / 1.4)) }
}

/** Zig-zag spring of `segs` shadowless rods; `set(a, b)` restretches it between two points. */
function spring(parent: THREE.Object3D, color: string, segs = 8, width = 0.35) {
  const material = mat(color, { rough: 0.4 })
  const rods = Array.from({ length: segs }, () => add(parent, shadowlessRod(material)))
  return (a: V3, b: V3) => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const pt = (i: number): V3 => {
      const off = i === 0 || i === segs ? 0 : (i % 2 ? 1 : -1) * width
      return [a[0] + (dx * i) / segs + nx * off, a[1] + (dy * i) / segs + ny * off, a[2]]
    }
    rods.forEach((r, i) => stretchRod(r, pt(i), pt(i + 1), 0.07))
  }
}

/** Square MEMS frame of half-size `h` with a proof mass on four springs; `set(x, y)` moves the mass (frame units). */
function memsCell(parent: THREE.Object3D, h: number, m: number, { springColor = '#9aa0ab', massColor = '#c9ced8' } = {}) {
  const g = add(parent, new THREE.Group())
  const wall = mat('#3a3d45', { rough: 0.6 })
  box(g, [2 * h + 0.8, 2 * h + 0.8, 0.3], mat('#1b1d22', { rough: 0.7 }), [0, 0, -0.4])
  for (const s of [-1, 1]) {
    box(g, [2 * h + 0.8, 0.4, 0.8], wall, [0, s * (h + 0.2), 0])
    box(g, [0.4, 2 * h + 0.8, 0.8], wall, [s * (h + 0.2), 0, 0])
  }
  const massMat = mat(massColor, { rough: 0.35, metal: 0.2 }, true)
  const mass = add(g, mesh(new THREE.BoxGeometry(2 * m, 2 * m, 0.7), massMat))
  const springs = [0, 1, 2, 3].map(() => spring(g, springColor))
  return {
    group: g,
    mass,
    massMat,
    set(x: number, y: number) {
      mass.position.set(x, y, 0)
      springs[0]([-h, y, 0], [x - m, y, 0])
      springs[1]([x + m, y, 0], [h, y, 0])
      springs[2]([x, -h, 0], [x, y - m, 0])
      springs[3]([x, y + m, 0], [x, h, 0])
    },
  }
}

// --- Accelerometer: a proof mass on springs; gravity tips it, but so does braking. ---

const MOVES = { still: 'Parked', cruise: 'Steady speed', brake: 'Braking 0.4 g' }
type Move = keyof typeof MOVES
const ACC = { cycle: 5, cruise: 2.2, brakeS: 1, brakeG: 0.4, v: 4, x0: -8, mm: 1.4, ramp: [-11, -5, 0] as V3 }
const accSetup = (p: Params) => {
  const move = pick(MOVES, p.move, 'brake')
  const slope = n(p, 'slope') * DEG
  const peak = move === 'brake' ? -ACC.brakeG : 0
  const f = bodyAccel(slope, peak * Math.cos(slope), peak * Math.sin(slope))
  return { move, slope, peak, f, est: accelTilt(f) }
}
/** Position (units along the ramp) and along-ramp acceleration (g) at `t` s into the cycle. */
function accMotion(move: Move, t: number) {
  if (move === 'still') return { x: 0, a: 0 }
  if (move === 'cruise') return { x: ACC.x0 + ((ACC.v * t) % 16), a: 0 }
  const u = t % ACC.cycle
  const run = ACC.v * ACC.cruise
  if (u < ACC.cruise) return { x: ACC.x0 + ACC.v * u, a: 0 }
  const b = Math.min(u - ACC.cruise, ACC.brakeS)
  const dec = ACC.v / ACC.brakeS
  return { x: ACC.x0 + run + ACC.v * b - (dec * b * b) / 2, a: u - ACC.cruise < ACC.brakeS ? -ACC.brakeG : 0 }
}

export const accelerometer: Lesson = {
  id: 'imu-accelerometer',
  title: 'Accelerometer',
  tagline: 'A mass on springs feels gravity, which gives tilt, and every push, which spoils it',
  formula: (p) => {
    const S = accSetup(p)
    return `ax = sin θ + a = sin ${n(p, 'slope')}° ${signed(S.peak, 2)} g = ${signed(S.f[0], 3)} g · az = cos θ = ${S.f[2].toFixed(3)} g · tilt = atan2(ax, az) = ${toDeg(S.est).toFixed(1)}° · mass shift = a / ω₀² = ${(proofShift(1, MPU_F0) * 1e9).toFixed(0)} nm per g at ${MPU_F0 / 1000} kHz`
  },
  legend: [
    { color: GREY, label: 'True tilt of the robot', shape: 'dot' },
    { color: HIGH_V, label: 'Tilt the accelerometer reports', shape: 'dot' },
    { color: HEAT, label: 'Robot acceleration', shape: 'dot' },
    { color: CLK_COLOR, label: 'Sense plates: gap → capacitance', shape: 'dot' },
  ],
  points: [
    'Inside the MPU-6050 is a silicon proof mass hung on springs. Force moves it a few nanometres; comb plates beside it read the gap as a capacitance change.',
    'At rest the springs hold the mass up against gravity, so a flat sensor reads +1 g on Z. Tilt it and part of that 1 g moves onto X: tilt = atan2(ax, az).',
    'The mass cannot tell gravity from acceleration. Braking at 0.4 g shoves it forward exactly like tipping nose-down by atan(0.4) = 22°.',
    'So the accelerometer is right on average and wrong whenever the robot speeds up, brakes, turns or vibrates. Fix that with a gyro (next lessons).',
  ],
  controls: [
    { kind: 'slider', key: 'slope', label: 'Slope', min: 0, max: 30, step: 1, initial: 15, format: (v) => `${v.toFixed(0)}°` },
    { kind: 'choice', key: 'move', options: opts(MOVES), initial: 'brake' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const ramp = add(scene, new THREE.Group(), ACC.ramp)
    box(ramp, [23, 0.8, 7], mat('#3a3d45', { rough: 0.8 }), [0, -0.4, 0])
    const robot = sideRobot(ramp, 0.85)
    const accArrow = arrow(ramp, [0, 0, 0], [1, 0, 0], HEAT, 0.9)
    const trueRod = add(scene, shadowlessRod(glowMat(GREY, 0.5)))
    const estRod = add(scene, shadowlessRod(glowMat(HIGH_V, 1)))
    const tiltText = liveLabel(scene, [-21, 8.4, 0.3], { size: 0.55, align: 'left' })
    const estText = liveLabel(scene, [-21, 7.1, 0.3], { size: 0.55, align: 'left' })

    const at: V3 = [11, 1, 0]
    const holder = add(scene, new THREE.Group(), at)
    const cell = memsCell(holder, 4, 1.4)
    const plates = [-1, 1].map((s) => {
      const m = glowMat(CLK_COLOR, 0.3)
      add(cell.group, mesh(new THREE.BoxGeometry(0.3, 2.4, 0.9), m), [s * 2.9, 0, 0.2])
      return m
    })
    partLetter(cell.group, 'X', [5.3, -0.2, 0], 0.55, LABEL)
    partLetter(cell.group, 'Z', [0, 5.1, 0], 0.55, LABEL)
    arrow(scene, [at[0] - 6.6, at[1] + 3.4, 0], [0, -1, 0], GREY, 0.9)
    partLetter(scene, 'g', [at[0] - 7.6, at[1] + 3, 0], 0.6, GREY, 'right')
    partLetter(scene, 'MEMS cell, magnified 10 million ×', [at[0], at[1] - 6.6, 0], 0.45, GREY)
    const shiftText = liveLabel(scene, [at[0], at[1] - 7.8, 0.3], { size: 0.42 })
    const status = liveLabel(scene, [-21, -13, 0.3], { size: 0.42, align: 'left' })
    const s = { key: '', t: 0, est: 0, f: [0, 0, 1] as [number, number, number] }
    return {
      scene,
      view: { center: [-2, -1, 0], radius: 74, polar: 1.45, azimuth: 0.1 },
      frame(dt, p) {
        const S = accSetup(p)
        const key = `${S.move}|${S.slope}`
        if (key !== s.key) Object.assign(s, { key, t: 0 })
        s.t += dt
        ramp.rotation.z = S.slope
        ramp.updateMatrixWorld(true)
        const M = accMotion(S.move, s.t)
        robot.group.position.set(M.x, 1.2, 0)
        robot.roll(M.x)
        accArrow.visible = M.a !== 0
        accArrow.position.set(M.x + (M.a < 0 ? -5.6 : 5.6), 2, 2.2)
        accArrow.rotation.z = M.a < 0 ? Math.PI / 2 : -Math.PI / 2
        const f = bodyAccel(S.slope, M.a * Math.cos(S.slope), M.a * Math.sin(S.slope))
        for (let i = 0; i < 3; i++) s.f[i] += (f[i] - s.f[i]) * (1 - Math.exp(-dt * 12))
        const est = accelTilt(s.f)
        const c = new THREE.Vector3(M.x, 2.6, 0).applyMatrix4(ramp.matrixWorld)
        const end = (a: number, r: number): V3 => [c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, 2.6]
        stretchRod(trueRod, end(S.slope + Math.PI, 5), end(S.slope, 7), 0.07)
        stretchRod(estRod, end(est + Math.PI, 5), end(est, 7), 0.09)
        holder.rotation.z = S.slope
        cell.set(-s.f[0] * ACC.mm, -(s.f[2] - 1) * ACC.mm - 0.6)
        plates.forEach((m, i) => setGlow(m, CLK_COLOR, 0.3 + Math.max(0, (i ? -1 : 1) * s.f[0]) * 2.2))
        tiltText.set(`true tilt ${toDeg(S.slope).toFixed(1)}°`, GREY)
        const bad = Math.abs(est - S.slope) > 1 * DEG
        estText.set(`accel says ${toDeg(est).toFixed(1)}°${bad ? `  (off ${signed(toDeg(est - S.slope))}°)` : ''}`, bad ? HIGH_V : POWER)
        const x = proofShift(s.f[0], MPU_F0)
        shiftText.set(`ax ${signed(s.f[0], 2)} g · mass ${signed(-x * 1e9, 1)} nm · ΔC/C ${signed(combChange(x, COMB_GAP) * 100)} %`, CLK_COLOR)
        const phase = S.move !== 'brake' ? MOVES[S.move].toLowerCase() : M.a ? 'braking' : (s.t % ACC.cycle) < ACC.cruise ? 'cruising' : 'stopped'
        status.set(`t = ${(s.t % ACC.cycle).toFixed(1)} s · ${phase} · real time`, LABEL)
      },
      readouts: (p) => {
        const S = accSetup(p)
        const err = toDeg(S.est - S.slope)
        const tag = S.move === 'brake' ? ' (braking)' : ''
        return [
          { label: `Accel X${tag}`, value: `${signed(S.f[0], 3)} g` },
          { label: 'Accel Z', value: `${S.f[2].toFixed(3)} g` },
          { label: 'Tilt from accel', value: `${toDeg(S.est).toFixed(1)}°`, tone: Math.abs(err) > 1 ? 'warn' : 'ok' },
          { label: 'Tilt error', value: `${signed(err)}°`, tone: Math.abs(err) > 1 ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Gyroscope: a vibrating mass is pushed sideways by rotation; sum the rate to get the angle. ---

const RANGE_KEYS = Object.keys(GYRO_RANGES)
const GY = { dt: 0.01, cycles: 6, window: 3, plotMax: 650, drive: [10e-6, 30e3] as [number, number], visHz: 1.6, amp: 1.3, sense: 1.6 }
const gyRun = memoBy(
  (p: Params) => `${p.peak}|${p.range}`,
  (p: Params) => {
    const peak = n(p, 'peak')
    const fs = (RANGE_KEYS.includes(String(p.range)) ? Number(p.range) : 250) as GyroRange
    const N = Math.round((GY.cycles * 3) / GY.dt)
    const truth = Array.from({ length: N }, (_, k) => yawProfile(k * GY.dt, peak))
    const meas = truth.map((r) => countsToDps(gyroCounts(r, fs), fs))
    const trueAng = integrateRate(truth, GY.dt)
    const measAng = integrateRate(meas, GY.dt)
    const perCycle = measAng[Math.round(3 / GY.dt) - 1] - trueAng[Math.round(3 / GY.dt) - 1]
    return { peak, fs, truth, meas, trueAng, measAng, perCycle, clips: peak > fs, coriolis: coriolisAccel(peak * DEG, driveSpeed(...GY.drive)) }
  },
)

export const gyroscope: Lesson = {
  id: 'imu-gyroscope',
  title: 'Gyroscope',
  tagline: 'A vibrating mass gets pushed sideways when the chip turns; add up the rate to get the angle',
  formula: (p) => {
    const R = gyRun(p)
    return `Coriolis a = 2 Ω v = 2 × ${(R.peak * DEG).toFixed(2)} rad/s × ${driveSpeed(...GY.drive).toFixed(2)} m/s = ${R.coriolis.toFixed(1)} m/s² · counts = ω × ${GYRO_RANGES[R.fs]} LSB per °/s, clipped at ±32767 = ±${R.fs} °/s · angle += ω × dt (dt = ${GY.dt * 1000} ms)`
  },
  legend: [
    { color: CLK_COLOR, label: 'Drive: mass swings along X', shape: 'dot' },
    { color: FORCE, label: 'Coriolis push along Y', shape: 'dot' },
    { color: GREY, label: 'True rate / heading', shape: 'dot' },
    { color: RING, label: 'Gyro reading / summed heading', shape: 'dot' },
  ],
  points: [
    'A MEMS gyro keeps a tiny mass swinging back and forth (≈ 10 µm at 30 kHz). When the chip turns, the Coriolis effect pushes the moving mass sideways, a = 2 Ω v.',
    'The sideways push flips with each swing, so the chip demodulates it at the drive frequency; the size of the wobble is the turn rate in °/s, not the angle.',
    'To get heading, add up rate × dt every loop. Any rate the gyro misses is lost from the angle for good.',
    'Pick the range for the fastest turn: at ±250 °/s (131 LSB per °/s) a 400 °/s flick clips at 250, so the heading under-counts every turn and walks away.',
  ],
  controls: [
    { kind: 'slider', key: 'peak', label: 'Fastest turn', min: 60, max: 600, step: 10, initial: 400, format: (v) => `${v.toFixed(0)} °/s` },
    { kind: 'choice', key: 'range', options: RANGE_KEYS.map((k) => ({ value: k, label: `±${k} °/s` })), initial: '250' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const base: V3 = [-12.5, -1, 0]
    const deck = add(scene, new THREE.Group(), base)
    cylinder(deck, 7, 0.8, mat('#d8dbe2', { rough: 0.55 }), [0, 0, -0.9], 'z', 48)
    for (const s of [-1, 1]) box(deck, [1.2, 3.6, 1.6], mat('#1c1c1f', { rough: 0.8 }), [s * 7.5, 0, -0.6])
    add(deck, mesh(new THREE.ConeGeometry(0.7, 1.4, 16), glowMat(GREY, 0.8)), [0, 6.2, 0])
    const cell = memsCell(deck, 4, 1.1, { springColor: '#7c8390' })
    cell.group.position.z = -0.2
    const coriolis = arrow(deck, [0, 0, 0.8], [0, 1, 0], FORCE, 0.9)
    const drive = arrow(deck, [0, 0, 0.8], [1, 0, 0], CLK_COLOR, 0.8)
    partLetter(deck, 'X', [5, -0.9, 0.2], 0.6, CLK_COLOR)
    partLetter(deck, 'Y', [0.9, 5, 0.2], 0.6, FORCE)
    const measNeedle = add(scene, shadowlessRod(glowMat(RING, 1)))
    const measTip = add(scene, mesh(new THREE.SphereGeometry(0.45, 14, 10), glowMat(RING, 1.2)))
    const headText = liveLabel(scene, [base[0], base[1] - 10, 0.3], { size: 0.48 })

    const plot = scope(scene, 15, 8, { divs: [6, 4] })
    plot.group.position.set(9.5, 4, 0)
    const trueTrace = plot.trace(GREY, { samples: 150, radius: 0.07 })
    const measTrace = plot.trace(RING, { samples: 150, radius: 0.1 })
    const clipHi = plot.level(HEAT)
    const clipLo = plot.level(HEAT)
    const yOf = (dps: number) => (dps / GY.plotMax) * 4
    ticks(plot, [[0, '-3'], [1, '0']], [[1, '650'], [0.5, '0'], [0, '-650']], 0.45)
    partLetter(scene, 'rate °/s · last 3 s', [2, 9.2, 0], 0.42, GREY, 'left')
    const rateText = liveLabel(scene, [2, -2.4, 0.3], { size: 0.45, align: 'left' })
    const code = codeBlock(scene, [1.6, -4.4, 0], 0.32, 3)
    const status = liveLabel(scene, [-21, -14, 0.3], { size: 0.4, align: 'left' })
    const s = { key: '', t: 0, vis: 0 }
    return {
      scene,
      view: { center: [-1.5, -1.5, 0], radius: 74, polar: 1.5, azimuth: 0.05 },
      frame(dt, p) {
        const R = gyRun(p)
        if (`${R.peak}|${R.fs}` !== s.key) Object.assign(s, { key: `${R.peak}|${R.fs}`, t: 0 })
        s.t = (s.t + dt) % (GY.cycles * 3)
        s.vis += dt
        const k = Math.min(R.truth.length - 1, Math.floor(s.t / GY.dt))
        const rate = R.truth[k]
        deck.rotation.z = R.trueAng[k] * DEG
        const ph = 2 * Math.PI * GY.visHz * s.vis
        const vx = Math.cos(ph)
        const y = (-GY.sense * (rate / GY.plotMax)) * vx
        cell.set(GY.amp * Math.sin(ph), y)
        drive.position.set(GY.amp * Math.sin(ph) + (vx > 0 ? 1.9 : -1.9), 0, 0.8)
        drive.rotation.z = vx > 0 ? -Math.PI / 2 : Math.PI / 2
        drive.scale.setScalar(Math.max(0.05, Math.abs(vx)))
        coriolis.visible = Math.abs(y) > 0.08
        coriolis.position.set(GY.amp * Math.sin(ph), y + (y > 0 ? 1.8 : -1.8), 0.8)
        coriolis.rotation.z = y > 0 ? 0 : Math.PI
        coriolis.scale.setScalar(Math.min(1.4, 0.35 + Math.abs(y)))
        const mh = R.measAng[k] * DEG + Math.PI / 2
        const tip: V3 = [base[0] + Math.cos(mh) * 8.4, base[1] + Math.sin(mh) * 8.4, 0.6]
        stretchRod(measNeedle, [base[0] + Math.cos(mh) * 7.2, base[1] + Math.sin(mh) * 7.2, 0.6], tip, 0.12)
        measTip.position.set(...tip)
        const err = R.measAng[k] - R.trueAng[k]
        headText.set(`true ${signed(R.trueAng[k], 0)}° · summed ${signed(R.measAng[k], 0)}° · off ${signed(err, 0)}°`, Math.abs(err) > 2 ? HIGH_V : POWER)
        const at = (arr: number[]) => (u: number) => yOf(arr[Math.max(0, Math.min(arr.length - 1, Math.round((s.t - (1 - u) * GY.window) / GY.dt)))])
        trueTrace.draw(at(R.truth))
        measTrace.draw(at(R.meas))
        clipHi.set(yOf(R.fs))
        clipLo.set(yOf(-R.fs))
        const clipped = Math.abs(R.meas[k]) < Math.abs(rate) - 0.5
        rateText.set(`ω ${signed(rate, 0)} °/s → reads ${signed(R.meas[k], 0)}${clipped ? ' (clipped)' : ''}`, clipped ? HEAT : RING)
        code([
          `int16_t gz = Wire.read() << 8 | Wire.read();  // ${gyroCounts(rate, R.fs)}`,
          `float rate = gz / ${GYRO_RANGES[R.fs].toFixed(1)};  // °/s at ±${R.fs}`,
          `heading += rate * 0.01;  // ${signed(R.measAng[k], 1)}°`,
        ])
        status.set(`t = ${s.t.toFixed(1)} s · real time · drive shown at ${GY.visHz} Hz, really ${GY.drive[1] / 1000} kHz`, LABEL)
      },
      readouts: (p) => {
        const R = gyRun(p)
        return [
          { label: 'Peak reading', value: `${gyroCounts(R.peak, R.fs)} LSB` },
          { label: 'Reads as', value: `${countsToDps(gyroCounts(R.peak, R.fs), R.fs).toFixed(0)} °/s`, tone: R.clips ? 'bad' : 'ok' },
          { label: 'Heading error / turn', value: `${signed(R.perCycle)}°`, tone: Math.abs(R.perCycle) > 1 ? 'bad' : 'ok' },
          { label: 'Coriolis at peak', value: `${R.coriolis.toFixed(1)} m/s²` },
        ]
      },
    }
  },
}

// --- Complementary filter: high-pass the gyro angle, low-pass the accel angle, add them. ---

const CF = { dt: 0.01, seconds: 30, window: 6, plotDeg: 30, needle: 9 }
const cfRun = memoBy(
  (p: Params) => `${p.alpha}|${p.bias}`,
  (p: Params) => {
    const alpha = n(p, 'alpha')
    const bias = n(p, 'bias')
    const r = balanceRun(alpha, bias, CF.seconds, CF.dt)
    const e = (x: number[]) => toDeg(angleRms(x, r.truth))
    return { alpha, bias, r, tau: compTau(alpha, CF.dt), accelErr: e(r.accel), gyroErr: e(r.gyro), fusedErr: e(r.fused) }
  },
)

export const complementaryFilter: Lesson = {
  id: 'imu-complementary-filter',
  title: 'Complementary filter',
  tagline: 'Trust the gyro for the next instant and the accelerometer over seconds',
  formula: (p) => {
    const R = cfRun(p)
    return `angle = α (angle + ω dt) + (1 − α) accel_angle · α = ${R.alpha.toFixed(3)}, dt = ${CF.dt * 1000} ms → τ = α dt / (1 − α) = ${R.tau.toFixed(2)} s · faster than τ: gyro · slower: accel`
  },
  legend: [
    { color: GREY, label: 'True tilt', shape: 'dot' },
    { color: HIGH_V, label: 'Accel angle (noisy, jolted)', shape: 'dot' },
    { color: CLK_COLOR, label: 'Gyro summed (smooth, drifts)', shape: 'dot' },
    { color: POWER, label: 'Fused', shape: 'dot' },
  ],
  points: [
    'The accelerometer angle is right on average but jumps with every wheel jolt. The summed gyro angle is smooth but wanders off by its bias × time.',
    'They fail in opposite bands, so blend them: each loop take the gyro step, then pull a little (1 − α) toward the accel angle.',
    'α sets a crossover time τ = α dt / (1 − α). At 100 Hz, α = 0.98 gives τ ≈ 0.5 s: motion faster than that comes from the gyro, slower trends from the accel.',
    'Too low an α lets accel noise through; too high and gyro drift survives for seconds. A balancing robot needs the fused angle, not either raw one.',
  ],
  controls: [
    { kind: 'slider', key: 'alpha', label: 'α', min: 0.8, max: 0.998, step: 0.002, initial: 0.98, format: (v) => v.toFixed(3) },
    { kind: 'slider', key: 'bias', label: 'Gyro bias', min: 0, max: 5, step: 0.5, initial: 2, format: (v) => `${v.toFixed(1)} °/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const axle: V3 = [-13, -6, 0]
    box(scene, [16, 0.6, 7], mat('#3a3d45', { rough: 0.8 }), [axle[0], axle[1] - 2.1, 0])
    const bot = add(scene, new THREE.Group(), axle)
    const wheel = add(bot, new THREE.Group())
    cylinder(wheel, 1.8, 4.6, mat('#1c1c1f', { rough: 0.8 }), [0, 0, 0], 'z', 28)
    box(wheel, [2.8, 0.4, 4.7], mat('#f2c230', { rough: 0.5 }))
    const body = add(bot, new THREE.Group())
    box(body, [2.6, 9, 3.2], mat('#d8dbe2', { rough: 0.55 }), [0, 5.2, 0])
    box(body, [2, 2.6, 0.3], mat(BOARD, { rough: 0.55 }), [0, 5.2, 1.75])
    box(body, [0.8, 0.8, 0.3], mat('#16171b', { rough: 0.5 }), [0, 5.2, 1.95])
    const needles = [HIGH_V, CLK_COLOR, POWER].map((c) => add(scene, shadowlessRod(glowMat(c, 1))))
    const plot = scope(scene, 15, 8, { divs: [6, 4] })
    plot.group.position.set(8.5, 0.5, 0)
    const traces = [GREY, HIGH_V, CLK_COLOR, POWER].map((c, i) => plot.trace(c, { samples: 200, radius: i === 1 ? 0.05 : 0.09 }))
    ticks(plot, [[0, '-6'], [1, '0']], [[1, '30'], [0.5, '0'], [0, '-30']], 0.45)
    partLetter(scene, 'tilt ° · last 6 s', [1, 5.6, 0], 0.42, GREY, 'left')
    const errText = liveLabel(scene, [1, -5.8, 0.3], { size: 0.4, align: 'left' })
    const code = codeBlock(scene, [1, -7.6, 0], 0.32, 2)
    const status = liveLabel(scene, [-20, -12.4, 0.3], { size: 0.4, align: 'left' })
    const s = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-2, -2, 0], radius: 72, polar: 1.5, azimuth: 0.05 },
      frame(dt, p) {
        const R = cfRun(p)
        if (`${R.alpha}|${R.bias}` !== s.key) Object.assign(s, { key: `${R.alpha}|${R.bias}`, t: 0 })
        s.t = (s.t + dt) % CF.seconds
        const { r } = R
        const k = Math.min(r.t.length - 1, Math.floor(s.t / CF.dt))
        const tilt = r.truth[k]
        const x = -9 * Math.tan(tilt)
        bot.position.x = axle[0] + x
        wheel.rotation.z = -x / 1.8
        body.rotation.z = -tilt
        ;[r.accel, r.gyro, r.fused].forEach((arr, i) => {
          const a = Math.PI / 2 - arr[k]
          stretchRod(needles[i], [axle[0] + x, axle[1], 2.4 + i * 0.1], [axle[0] + x + Math.cos(a) * CF.needle, axle[1] + Math.sin(a) * CF.needle, 2.4 + i * 0.1], 0.08)
        })
        const yOf = (rad: number) => (toDeg(rad) / CF.plotDeg) * 4
        ;[r.truth, r.accel, r.gyro, r.fused].forEach((arr, i) =>
          traces[i].draw((u) => {
            const j = Math.round((s.t - (1 - u) * CF.window) / CF.dt)
            return j < 0 ? 0 : yOf(arr[j])
          }),
        )
        const e = (arr: number[]) => toDeg(arr[k] - tilt)
        errText.set(`error now: accel ${signed(e(r.accel))}° · gyro ${signed(e(r.gyro))}° · fused ${signed(e(r.fused))}°`, LABEL)
        code([
          `angle = ${R.alpha.toFixed(3)} * (angle + gyroY * 0.01)`,
          `      + ${(1 - R.alpha).toFixed(3)} * atan2(ax, az);  // ${signed(toDeg(r.fused[k]))}°`,
        ])
        status.set(`t = ${s.t.toFixed(1)} s · real time · 100 Hz loop · true tilt ${signed(toDeg(tilt))}°`, LABEL)
      },
      readouts: (p) => {
        const R = cfRun(p)
        const best = Math.min(R.accelErr, R.gyroErr, R.fusedErr) === R.fusedErr
        return [
          { label: 'τ crossover', value: `${R.tau.toFixed(2)} s` },
          { label: 'Accel error rms', value: `${R.accelErr.toFixed(1)}°`, tone: 'warn' },
          { label: 'Gyro error rms', value: `${R.gyroErr.toFixed(1)}°`, tone: R.gyroErr > 3 ? 'bad' : 'warn' },
          { label: 'Fused error rms', value: `${R.fusedErr.toFixed(1)}°`, tone: best && R.fusedErr < 3 ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Drift: the gyro's zero-rate offset, integrated, turns a straight drive into a curve. ---

const CAL: Record<CalMode, string> = { none: 'No calibration', rest: 'Calibrate at rest', temp: 'At rest + temp model' }
const DR = { seconds: 60, dt: 0.05, speed: 0.15, k: 2.2, speedup: 3, calS: 2, hold: 2.5, start: [-20, 3, 0] as V3, samples: 500, plotDeg: 240 }
const drRun = memoBy(
  (p: Params) => `${p.cal}|${p.temp}`,
  (p: Params) => {
    const cal = pick(CAL, p.cal, 'rest') as CalMode
    const temp = n(p, 'temp')
    const bias = gyroBiasAt(temp)
    const res = residualBias(cal, temp, DR.samples)
    const err = driftRun(res, DR.seconds, DR.dt)
    const path = headingPath(err.map((e) => -e), DR.speed, DR.dt)
    const end = path[path.length - 1]
    return { cal, temp, bias, res, err, path, endErr: err[err.length - 1], miss: Math.hypot(end[0] - DR.speed * DR.seconds, end[1]) }
  },
)

export const drift: Lesson = {
  id: 'imu-drift',
  title: 'Drift',
  tagline: 'A gyro never reads exactly zero; summed for a minute, a little offset becomes a big turn',
  formula: (p) => {
    const R = drRun(p)
    return `bias(T) = ${GYRO_ZRO.b25} + ${GYRO_ZRO.tc} × (T − 25) = ${R.bias.toFixed(2)} °/s at ${R.temp} °C · residual after ${CAL[R.cal].toLowerCase()} = ${signed(R.res, 3)} °/s · heading error ≈ residual × t = ${signed(R.endErr)}° after ${DR.seconds} s`
  },
  legend: [
    { color: GREY, label: 'Where the robot means to go', shape: 'dot' },
    { color: RING, label: 'Where it really goes', shape: 'dot' },
    { color: HIGH_V, label: 'Heading error over time', shape: 'dot' },
    { color: HEAT, label: 'Chip temperature', shape: 'dot' },
  ],
  points: [
    'Hold a gyro perfectly still and it still reads a little: the zero-rate offset (bias), often 1–3 °/s raw on an MPU-6050.',
    'Integrating it adds bias × t to the heading. 1.6 °/s is 96° a minute: a robot steering “straight” by the gyro drives in a circle.',
    'Calibrate at rest: at boot, average a few hundred samples while the robot sits still, and subtract that mean from every reading.',
    'The bias moves with temperature (here 0.045 °/s per °C), so a chip that warms up after calibration drifts again. Re-zero whenever the robot stops, or model the tempco.',
  ],
  controls: [
    { kind: 'choice', key: 'cal', options: opts(CAL), initial: 'rest' },
    { kind: 'slider', key: 'temp', label: 'Chip now (cal. at 25 °C)', min: 5, max: 60, step: 1, initial: 45, format: (v) => `${v.toFixed(0)} °C` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const [sx, sy] = DR.start
    const W = DR.speed * DR.seconds * DR.k
    box(scene, [W + 10, 19, 0.4], mat('#24272d', { rough: 0.85 }), [sx + W / 2 - 1.5, sy - 6.5, -0.6])
    for (let x = 0; x <= W; x += 1.2) box(scene, [0.6, 0.12, 0.1], mat(GREY), [sx + x, sy, -0.3])
    partLetter(scene, `${DR.speed * DR.seconds} m`, [sx + W, sy + 1.2, 0], 0.45, GREY)
    const trail = pointCloud(scene, 400, 0.16)
    const robot = add(scene, new THREE.Group())
    box(robot, [3, 2.2, 1], mat('#d8dbe2', { rough: 0.55 }), [0, 0, 0.5])
    for (const y of [-1.35, 1.35]) box(robot, [1.6, 0.5, 1.2], mat('#1c1c1f', { rough: 0.8 }), [0, y, 0.5])
    add(robot, mesh(new THREE.ConeGeometry(0.4, 0.9, 12), glowMat(GREY, 0.8)), [1.9, 0, 0.5]).rotation.z = -Math.PI / 2
    const chipMat = glowMat(HEAT, 0)
    box(robot, [0.8, 0.8, 0.3], chipMat, [-0.3, 0, 1.15])
    const plot = scope(scene, 13, 7, { divs: [6, 4] })
    plot.group.position.set(11, -1, 0)
    const errTrace = plot.trace(HIGH_V, { samples: 200, radius: 0.09 })
    ticks(plot, [[0, '0'], [1, '60']], [[1, '240'], [0.5, '0'], [0, '-240']], 0.42)
    partLetter(scene, 'heading error °', [4.5, 3.4, 0], 0.42, GREY, 'left')
    const calText = liveLabel(scene, [sx, -12.4, 0.3], { size: 0.5, align: 'left' })
    const biasText = liveLabel(scene, [sx, -13.8, 0.3], { size: 0.45, align: 'left' })
    const code = codeBlock(scene, [sx, -15.5, 0], 0.34, 2)
    const status = liveLabel(scene, [sx, -18, 0.3], { size: 0.42, align: 'left' })
    const trailColor = new THREE.Color(RING)
    const s = { key: '', T: 0 }
    return {
      scene,
      view: { center: [-2, -5.5, 0], radius: 74, polar: 1.5, azimuth: 0.04 },
      frame(dt, p) {
        const R = drRun(p)
        if (`${R.cal}|${R.temp}` !== s.key) Object.assign(s, { key: `${R.cal}|${R.temp}`, T: 0 })
        const calS = R.cal === 'none' ? 0 : DR.calS
        s.T += dt
        if (s.T > calS + DR.seconds / DR.speedup + DR.hold) s.T = 0
        const calibrating = s.T < calS
        const simT = Math.max(0, Math.min(DR.seconds, (s.T - calS) * DR.speedup))
        const k = Math.min(R.path.length - 1, Math.floor(simT / DR.dt))
        const pos = simT > 0 ? R.path[k] : [0, 0]
        const head = simT > 0 ? -R.err[k] : 0
        robot.position.set(sx + pos[0] * DR.k, sy + pos[1] * DR.k, 0)
        robot.rotation.z = head * DEG
        const step = Math.max(1, Math.ceil(R.path.length / 400))
        const shown = simT > 0 ? Math.floor(k / step) : 0
        for (let i = 0; i < shown; i++) trail.set(i, [sx + R.path[i * step][0] * DR.k, sy + R.path[i * step][1] * DR.k, 0], trailColor)
        trail.show(shown)
        setGlow(chipMat, HEAT, calibrating ? 0.3 : 0.2 + ((R.temp - 5) / 55) * 1.6)
        const yOf = (d: number) => (d / DR.plotDeg) * 3.5
        errTrace.group.visible = simT > 0
        errTrace.draw((u) => (u * DR.seconds <= simT ? yOf(R.err[Math.min(R.err.length - 1, Math.floor((u * DR.seconds) / DR.dt))]) : yOf(R.err[k] ?? 0)), simT > 0 ? simT / DR.seconds : null)
        if (calibrating) {
          const got = Math.round((s.T / calS) * DR.samples)
          calText.set(`calibrating at rest: ${got} / ${DR.samples} samples, hold still`, CLK_COLOR)
        } else calText.set(`gyro says heading 0° · really ${signed(head, 0)}°`, Math.abs(head) > 5 ? HIGH_V : POWER)
        biasText.set(`chip ${R.temp} °C · bias ${signed(R.bias, 2)} °/s${R.cal === 'none' ? ', uncorrected' : ` · left after correction ${signed(R.res, 3)} °/s`}`, HEAT)
        code(
          R.cal === 'none'
            ? ['float rate = gz / 131.0;  // raw, bias included', 'heading += rate * dt;']
            : [`float rate = gz / 131.0 - bias${R.cal === 'temp' ? ' - 0.045 * (tempC - 25)' : ''};`, `// bias = mean of ${DR.samples} still samples at boot`],
        )
        status.set(calibrating ? `t = ${s.T.toFixed(1)} s · calibrating, robot still` : `t = ${simT.toFixed(0)} s · sped up ${DR.speedup}× · ${DR.speed} m/s`, LABEL)
      },
      readouts: (p) => {
        const R = drRun(p)
        return [
          { label: 'Raw bias', value: `${signed(R.bias, 2)} °/s`, tone: 'warn' },
          { label: 'After correction', value: `${signed(R.res, R.cal === 'none' ? 2 : 3)} °/s`, tone: Math.abs(R.res) > 0.1 ? 'bad' : 'ok' },
          { label: `Heading error @ ${DR.seconds} s`, value: `${signed(R.endErr)}°`, tone: Math.abs(R.endErr) > 5 ? 'bad' : 'ok' },
          { label: 'Miss at the end', value: `${R.miss.toFixed(2)} m`, tone: R.miss > 0.3 ? 'bad' : 'ok' },
        ]
      },
    }
  },
}
