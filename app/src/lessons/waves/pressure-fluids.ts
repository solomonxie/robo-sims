import * as THREE from 'three/webgpu'
import {
  FLUIDS,
  FluidKind,
  IIR_COEFFS,
  IirCoeff,
  OVERSAMPLING,
  Oversampling,
  P_SEA,
  THROAT_X,
  airPressureAt,
  baroHoldRun,
  baroNoise,
  bmp280Mode,
  ductRadius,
  dynamicPa,
  fixedStepAt,
  kelvinOf,
  paPerMetre,
  pitotSpeedError,
  venturi,
} from '../../core/physics'
import { niceCeil, si, celsiusText, cmText, hoursText, hpaText, mpsText, msText, paText, signed, tiny } from '../../core/units'
import { V3, add, box, cylinder, lathe, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  arrow,
  glowMat,
  i2cBreakout,
  lapseClock,
  liveLabel,
  memoBy,
  potentialColor,
  quadcopter,
  shellMat,
  sideView,
  statusHeader,
  titledScope,
  traceRun,
} from '../fx'
import { Lesson, Params, Stage, namesOf, n, opts, pick } from '../types'

const VIEW = sideView(-1.5, -1)
const mText = (m: number) => `${m.toFixed(1)} m`
const pa = (x: number) => (Math.abs(x) < 0.05 ? '0 Pa' : `${x < 0 ? '−' : ''}${paText(Math.abs(x))}`)

// --- Bernoulli: a venturi duct; continuity speeds the flow up in the neck and the static pressure drops by ½ρ(v₂² − v₁²). ---

const FLUID_NAMES = namesOf(FLUIDS)
const PITOT_NOISE = 1
const bnParams = (p: Params) => ({ v1: n(p, 'v1'), throat: n(p, 'throat'), fluid: pick(FLUIDS, p.fluid, 'air') as FluidKind })
type BnQ = ReturnType<typeof bnParams>
const bnRun = memoBy(
  (q: BnQ) => `${q.v1} ${q.throat} ${q.fluid}`,
  (q: BnQ) => {
    const V = venturi(q.v1, q.throat, q.fluid)
    return { ...V, vmax: niceCeil(V.v2 * 1.15), pitotErr: pitotSpeedError(V.rho, q.v1, PITOT_NOISE) }
  },
)
const D_LEN = 15
const D_R = 1.6
const D0: V3 = [-9, -5, 0]
const STATIONS = [0.08, 0.38, THROAT_X, 0.72, 0.94]
const COL_Y0 = D0[1] + D_R + 0.5
const COL_H = 5
const PARTICLES = 170

export const pressureFluidsBernoulli: Lesson = {
  id: 'pressure-fluids-bernoulli',
  title: 'Bernoulli',
  tagline: 'Squeeze a flow and it speeds up; where it is fast, the pressure is low',
  formula: (p) => {
    const q = bnParams(p)
    const R = bnRun(q)
    return `A₁v₁ = A₂v₂ → v₂ = ${mpsText(q.v1, 1)} / ${q.throat.toFixed(2)}² = ${mpsText(R.v2, 1)} · p + ½ρv² = const → Δp = ½ρ(v₂² − v₁²) = ½ × ${R.rho} × (${R.v2.toFixed(1)}² − ${q.v1.toFixed(1)}²) = ${paText(R.drop)} · pitot: v = √(2Δp/ρ)`
  },
  legend: [
    { color: B_FIELD, label: 'Static pressure p (scaled to the throat drop)', shape: 'dot' },
    { color: RING, label: 'Dynamic pressure ½ρv²: stacked, same total', shape: 'dot' },
    { color: HIGH_V, label: 'Parcels: red = high static p, blue = low', shape: 'dot' },
    { color: POWER, label: 'Inlet and throat on the ½ρv² curve', shape: 'dot' },
  ],
  points: [
    'Continuity: what flows in must flow out. Air at drone speeds and water barely compress, so the volume per second A·v is the same at every section. Halve the diameter, the area falls to a quarter and the flow runs four times as fast.',
    'Bernoulli: along a streamline p + ½ρv² stays constant (no friction, no change of height). A parcel only speeds up if the pressure behind it is higher than ahead, so the fast neck is the low-pressure spot. The static drop is ½ρ(v₂² − v₁²): it grows with the square of the speed.',
    'A venturi turns that into a tool: measure the drop and you know the flow (flow meters, carburettors, aspirators that suck a side port). In water the drop can fall below the vapour pressure and the throat boils: cavitation, the same thing that pits pump impellers and boat propellers.',
    'A pitot tube faces into the flow: its nose stops the air and reads static + ½ρv², a side port reads static, and v = √(2Δp/ρ). Fixed-wing drones fly with one (an MS4525 sensor on I²C). But ½ρv² is tiny at low speed: 60 Pa at 10 m/s, 5 Pa at 3 m/s, so a 1 Pa error is a big speed error. Multirotors rely on GPS ground speed instead (Sensors › GPS).',
    'Wings and propeller blades turn the air; the air over the top runs faster and its pressure is lower, which is lift and thrust (Wheels & drive › Drones & flight › Quadcopter mixing). The same effect fools a barometer in prop wash: fast air past the port reads low, so the drone thinks it climbed (Barometer altitude).',
  ],
  controls: [
    { kind: 'slider', key: 'v1', label: 'Inlet speed', min: 1, max: 20, step: 0.5, initial: 5, format: (v) => mpsText(v, 1) },
    { kind: 'slider', key: 'throat', label: 'Throat diameter', min: 0.4, max: 1, step: 0.05, initial: 0.5, format: (v) => `${Math.round(v * 100)} % of inlet` },
    { kind: 'choice', key: 'fluid', options: opts(FLUID_NAMES), initial: 'air' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const duct = add(scene, new THREE.Group(), D0)
    duct.rotation.y = -0.18
    const shell = shellMat('#9fd8ff', 0.14)
    let wall: THREE.Mesh | null = null
    let wallKey = -1
    for (const s of [-1, 1]) {
      const rim = add(duct, mesh(new THREE.TorusGeometry(D_R, 0.08, 10, 48), mat('#9aa0a8', { metal: 0.5, rough: 0.35 })), [(s * D_LEN) / 2, 0, 0])
      rim.rotation.y = Math.PI / 2
    }
    arrow(duct, [-D_LEN / 2 - 1.4, 0, 0], [1, 0, 0], POWER, 1)
    const xOf = (u: number) => -D_LEN / 2 + u * D_LEN

    const glass = shellMat('#cfe8ff', 0.18)
    const staticM = glowMat(B_FIELD, 0.5)
    const dynM = glowMat(RING, 0.8)
    const tubes = STATIONS.map((u) => {
      const x = xOf(u)
      cylinder(duct, 0.24, COL_Y0 + COL_H + 0.4 - D0[1], glass, [x, (COL_Y0 + COL_H + 0.4 - D0[1]) / 2, 0], 'y', 16)
      const stat = cylinder(duct, 0.17, 1, staticM, [x, 0, 0], 'y', 12)
      const dyn = cylinder(duct, 0.17, 1, dynM, [x, 0, 0], 'y', 12)
      return {
        stat,
        dyn,
        speed: liveLabel(scene, [D0[0] + x, COL_Y0 + COL_H + 1.0, 0.4], { size: 0.28 }),
        pres: liveLabel(scene, [D0[0] + x, D0[1] - D_R - 0.7, 0.4], { size: 0.24 }),
      }
    })
    const totalM = glowMat(RING, 0.6)
    for (let x = xOf(0.06); x < xOf(0.96); x += 0.7) box(duct, [0.35, 0.06, 0.06], totalM, [x, COL_Y0 + COL_H - D0[1], 0.3])
    addLabel(scene, 'total p + ½ρv²', [D0[0] + xOf(0.98), COL_Y0 + COL_H + 0.05, 0.4], RING, 0.26, 'left')

    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), PARTICLES)
    dots.frustumCulled = false
    duct.add(dots)
    const pu = Array.from({ length: PARTICLES }, (_, i) => i / PARTICLES)
    const pa0 = pu.map((_, i) => (i * 2.399) % (2 * Math.PI))
    const pf = pu.map((_, i) => Math.sqrt(((i * 0.618) % 1) * 0.95))
    const m4 = new THREE.Matrix4()
    const col = new THREE.Color()

    const plot = titledScope(scene, -0.5, 5, '½ρv² against speed', RING, 0, 7.4, 10)
    const curve = plot.s.trace(RING, { samples: 80, radius: 0.06 })
    const inlet = plot.s.trace(POWER, { samples: 2, radius: 0.06 })
    const pitot1 = liveLabel(scene, [2.4, -4.6, 0.3], { size: 0.28, align: 'left' })
    const pitot2 = liveLabel(scene, [2.4, -5.4, 0.3], { size: 0.26, color: GREY, align: 'left' })
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = bnParams(p)
        const R = bnRun(q)
        if (wallKey !== q.throat) {
          if (wall) {
            duct.remove(wall)
            wall.geometry.dispose()
          }
          const prof: [number, number][] = Array.from({ length: 61 }, (_, i) => [ductRadius(i / 60, q.throat) * D_R, xOf(i / 60)])
          wall = lathe(duct, prof, shell, [0, 0, 0], 'x', 48)
          wall.castShadow = false
          wallKey = q.throat
        }
        const scale = COL_H / Math.max(R.q2, 1e-9)
        STATIONS.forEach((u, i) => {
          const d = R.profile(u)
          const top = d.r * D_R
          const statTop = COL_Y0 - D0[1] + (R.q2 - d.q) * scale
          const t = tubes[i]
          t.stat.scale.y = statTop - top
          t.stat.position.y = (statTop + top) / 2
          t.dyn.scale.y = Math.max(1e-3, d.q * scale)
          t.dyn.position.y = statTop + (d.q * scale) / 2
          t.speed.set(mpsText(d.v, 1), i === 2 ? RING : LABEL)
          t.pres.set(pa(d.p), d.p < -0.5 ? B_FIELD : GREY)
        })

        const vis = 1.2 + 0.12 * q.v1
        for (let i = 0; i < PARTICLES; i++) {
          const r = ductRadius(pu[i], q.throat)
          pu[i] = (pu[i] + (dt * vis) / (r * r * D_LEN)) % 1
          const rr = ductRadius(pu[i], q.throat) * D_R * 0.88 * pf[i]
          dots.setMatrixAt(i, m4.makeTranslation(xOf(pu[i]), rr * Math.cos(pa0[i]), rr * Math.sin(pa0[i])))
          const d = R.profile(pu[i])
          dots.setColorAt(i, potentialColor(1 - d.q / Math.max(R.q2, 1e-9) + R.q1 / Math.max(R.q2, 1e-9), col))
        }
        dots.instanceMatrix.needsUpdate = true
        if (dots.instanceColor) dots.instanceColor.needsUpdate = true

        const qMax = dynamicPa(R.rho, R.vmax)
        const yOf = (v: number) => -plot.h / 2 + (dynamicPa(R.rho, v) / qMax) * plot.h
        curve.draw((u) => yOf(u * R.vmax), R.v2 / R.vmax)
        inlet.points([q.v1 / R.vmax, q.v1 / R.vmax], [yOf(q.v1), yOf(q.v1)])
        plot.lo.set('0')
        plot.hi.set(`${R.vmax} m/s`)
        plot.right.set(`full scale ${paText(qMax)}`, GREY)
        pitot1.set(`Pitot at the inlet: ½ρv² = ${paText(R.q1)}`, POWER)
        pitot2.set(`${pa(PITOT_NOISE)} of sensor error → ±${si(R.pitotErr, 'm/s', 2)}`)

        head.status.set(`Bernoulli · ${FLUIDS[q.fluid].name.toLowerCase()} at ${mpsText(q.v1, 1)} → ${mpsText(R.v2, 1)} in the throat`)
        head.sub.set(`same flow everywhere: ${(R.flow * 1000).toFixed(2)} L/s through a 40 mm duct`)
        head.event.set(
          R.cavitates ? 'throat pressure below vapour pressure: the water boils (cavitation)' : `throat static pressure ${pa(-R.drop)} below the inlet`,
          R.cavitates ? HIGH_V : B_FIELD,
        )
      },
      readouts: (p) => {
        const q = bnParams(p)
        const R = bnRun(q)
        return [
          { label: 'Throat speed', value: mpsText(R.v2, 1) },
          { label: 'Throat pressure drop', value: paText(R.drop), tone: R.cavitates ? 'bad' : 'ok' },
          { label: 'Flow (40 mm duct)', value: `${(R.flow * 1000).toFixed(2)} L/s` },
          { label: 'Pitot ½ρv² at the inlet', value: `${paText(R.q1)}, ±${si(R.pitotErr, 'm/s', 2)} per Pa`, tone: R.pitotErr > 0.5 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Barometer altitude: a drone holds a BMP280 altitude for 2 h while the weather and air temperature move the truth. ---

const BA_S = 7200
const BA_DT = 30
const NOISE_S = 10
const OS_NAMES = namesOf(OVERSAMPLING)
const IIR_NAMES = namesOf(IIR_COEFFS)
const baParams = (p: Params) => ({
  holdM: n(p, 'hold'),
  driftPaPerH: n(p, 'drift') * 100,
  tempC: n(p, 'temp'),
  os: pick(OVERSAMPLING, p.os, 'x16') as Oversampling,
  iir: pick(IIR_COEFFS, p.iir, 'off') as IirCoeff,
})
type BaQ = ReturnType<typeof baParams>
const baKey = (q: BaQ) => `${q.holdM} ${q.driftPaPerH} ${q.tempC}`
const baRun = memoBy(baKey, (q: BaQ) => {
  const R = baroHoldRun(q, BA_S, BA_DT)
  const hs = R.run.map((f) => f.h)
  return { ...R, maxH: niceCeil(Math.max(q.holdM, ...hs) * 1.25), perM: paPerMetre(q.holdM) }
})
const noiseRun = memoBy(
  (q: BaQ) => `${q.os} ${q.iir}`,
  (q: BaQ) => {
    const mode = bmp280Mode(q.os, q.iir)
    return { mode, samples: baroNoise(mode, NOISE_S) }
  },
)
const COL_X = -15.2
const GROUND_Y = -9
const SKY_H = 12.4

export const pressureFluidsBarometerAltitude: Lesson = {
  id: 'pressure-fluids-barometer-altitude',
  title: 'Barometer altitude',
  tagline: 'About 12 Pa per metre: a BMP280 feels a stair step, and the weather',
  formula: (p) => {
    const q = baParams(p)
    const R = baRun(q)
    const N = noiseRun(q)
    return `h = 44 330 m × (1 − (p / p_ref)^(1/5.256)) · p = ${hpaText(R.target, 2)}, p_ref = ${hpaText(P_SEA, 2)} → ${mText(q.holdM)} · ρg = ${R.perM.toFixed(1)} Pa/m · noise ${N.mode.noisePa.toFixed(2)} Pa / ${R.perM.toFixed(1)} Pa/m = ±${cmText(N.mode.noisePa / R.perM)}`
  },
  legend: [
    { color: RING, label: 'The baro altitude the drone holds', shape: 'dot' },
    { color: HEAT, label: 'True height over 2 h (time-lapse)', shape: 'dot' },
    { color: B_FIELD, label: 'Air column: denser near the ground', shape: 'dot' },
    { color: POWER, label: 'Baro reading at hover, last 10 s (real time)', shape: 'dot' },
  ],
  points: [
    'Air has weight. The pressure at any height is the weight of the air above each square metre: 1013 hPa at sea level. Climb a metre and about 12 Pa of air (ρg) is no longer above you, 0.012 % of the total. Higher up the air is thinner, so each metre counts less: about 900 hPa at 1000 m.',
    'A BMP280 (I²C at 0x76, Microcontrollers › I²C › Addresses) reads absolute pressure; firmware turns it into height with the standard-atmosphere formula h = 44 330 m × (1 − (p/p_ref)^0.19). It only gives height above wherever p_ref was taken: drones zero it at take-off, aircraft dial in the local sea-level pressure (QNH).',
    'Noise: about 1.3 Pa RMS at ×16 oversampling, 11 cm. Oversampling averages n samples (noise ÷ √n) but each reading takes longer: 5.5 ms at ×1, 37.5 ms at ×16. The IIR filter brings it down to about 2 cm at coefficient 16 but lags by half a second, and lag in an altitude-hold loop means overshoot (Control › Filters in the loop › Low-pass).',
    'Weather: a passing front moves the ground pressure by 1–3 hPa per hour, and the sensor cannot tell that from a climb: 1 hPa is about 8 m. A drone holding a baro altitude sinks as the pressure falls and rises as it climbs. Long flights re-zero or fuse GPS altitude: the baro for smooth short-term changes, GPS for the long-term truth (Sensors › Sensor fusion › Complementary filter).',
    'Temperature: the formula assumes 15 °C. Warm air is less dense, so the same pressure difference spans more metres: at 35 °C a baro reading of 100 m is really about 107 m (≈ 0.35 % per °C). The BMP280 compensates its own temperature, not the air column. And keep it out of the prop wash and sunlight under foam: fast air past the port reads low (Bernoulli) and a sun-warmed board drifts.',
  ],
  controls: [
    { kind: 'slider', key: 'hold', label: 'Hold altitude (baro)', min: 10, max: 200, step: 5, initial: 100, format: (v) => `${v} m` },
    { kind: 'slider', key: 'drift', label: 'Weather drift', min: -3, max: 3, step: 0.25, initial: -1, format: (v) => `${signed(v, 2)} hPa/h` },
    { kind: 'slider', key: 'temp', label: 'Air temperature', min: -10, max: 40, step: 1, initial: 15, format: (v) => celsiusText(v) },
    { kind: 'choice', key: 'os', options: opts(OS_NAMES), initial: 'x16' },
    { kind: 'choice', key: 'iir', options: opts(IIR_NAMES), initial: 'off' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    box(scene, [14, 0.3, 4], mat('#3b4a3a', { rough: 0.9 }), [-9.5, GROUND_Y - 0.15, 0])
    box(scene, [2.4, 0.06, 2.4], mat('#e8e8e8', { rough: 0.6 }), [-8.5, GROUND_Y + 0.03, 0])
    const SLABS = 24
    for (let i = 0; i < SLABS; i++) {
      const f = i / SLABS
      const m = new THREE.MeshStandardMaterial({ color: B_FIELD, emissive: B_FIELD, emissiveIntensity: 0.15 + 0.6 * (1 - f) ** 3, transparent: true, opacity: 0.12 + 0.5 * (1 - f) ** 3, depthWrite: false })
      box(scene, [1.1, SKY_H / SLABS, 1.1], m, [COL_X, GROUND_Y + (i + 0.5) * (SKY_H / SLABS), 0]).castShadow = false
    }
    const TICKS = 4
    const tickLabels = Array.from({ length: TICKS + 1 }, (_, i) => {
      const y = GROUND_Y + (i / TICKS) * SKY_H
      box(scene, [0.5, 0.05, 0.05], glowMat(GREY, 0.4), [COL_X + 0.8, y, 0])
      return liveLabel(scene, [COL_X + 1.2, y, 2.2], { size: 0.24, color: GREY, align: 'left' })
    })

    const holdM = glowMat(RING, 0.7)
    const holdLine = add(scene, new THREE.Group())
    for (let x = -10.4; x < -3.5; x += 0.7) box(holdLine, [0.35, 0.07, 0.07], holdM, [x, 0, 0])
    const holdTag = liveLabel(scene, [-3.3, 0, 0.3], { size: 0.26, align: 'left' })

    const rig = add(scene, new THREE.Group())
    const quad = quadcopter(rig, { arcs: false })
    quad.group.scale.setScalar(16)
    quad.group.rotation.set(-Math.PI / 2 + 0.3, 0, 0.5)
    i2cBreakout(rig, [3.6, 1.6, 0], { name: 'BMP280', k: 0.11 })
    const trueTag = liveLabel(rig, [3.8, -0.9, 0.3], { size: 0.3, align: 'center' })
    const share = [0.6, 0.6, 0.6, 0.6]
    const spin = [0, 0, 0, 0]

    const plot = titledScope(scene, 0, 4.6, 'true height, 2 h', HEAT, 0, 6.4, 10.5)
    const trueTr = plot.s.trace(HEAT, { samples: 200, radius: 0.07 })
    const holdLvl = plot.s.level(RING)
    plot.lo.set('0')
    plot.hi.set('2 h')
    const plotTop = liveLabel(scene, [0.9, 2.3, 0.3], { size: 0.24, color: GREY, align: 'right' })
    const NZ_Y = -6.3
    const nz = titledScope(scene, NZ_Y, 2.6, 'baro at hover, ±50 cm', POWER, 0.5, 6.4, 10.5)
    const nzTr = nz.s.trace(POWER, { samples: 160, radius: 0.05 })
    const sigHi = nz.s.level(GREY, 0.3)
    const sigLo = nz.s.level(GREY, 0.3)
    nz.lo.set('−10 s')
    nz.hi.set('now')
    const clock = lapseClock(BA_S, 600, 600)
    let wall = 0
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = baParams(p)
        const R = baRun(q)
        const N = noiseRun(q)
        wall += dt
        const now = clock(dt, baKey(q))
        const f = fixedStepAt(R.run, now, BA_DT)
        const k = SKY_H / R.maxH
        const yAt = (h: number) => GROUND_Y + h * k

        tickLabels.forEach((t, i) => {
          const h = (i / TICKS) * R.maxH
          t.set(`${Math.round(h)} m  ${hpaText(airPressureAt(h, f.p0, kelvinOf(q.tempC)), 1)}`)
        })
        holdLine.position.y = yAt(q.holdM)
        holdTag.group.position.y = yAt(q.holdM) + 0.35
        holdTag.set(`baro says ${mText(q.holdM)}`, RING)
        rig.position.set(-8.5, yAt(f.h) + 0.35, 0)
        for (let i = 0; i < 4; i++) spin[i] += dt * 30
        quad.set(spin, share)
        trueTag.set(`true ${mText(f.h)}`, HEAT)

        const yP = (h: number) => -plot.h / 2 + (h / R.maxH) * plot.h
        traceRun(trueTr, R.run, BA_DT, BA_S, now, (x) => yP(x.h))
        holdLvl.set(yP(q.holdM))
        plotTop.set(`${R.maxH} m`)
        plot.right.set(`${hoursText(now / 3600)} · ${signed(f.h - q.holdM)} m`, Math.abs(f.h - q.holdM) > 5 ? HIGH_V : POWER)

        const sm = N.samples
        const per = R.perM
        const yN = (dp: number) => ((-dp / per) / 0.5) * (nz.h / 2)
        nzTr.scroll((t) => yN(sm[((Math.floor(t / N.mode.measS) % sm.length) + sm.length) % sm.length]), wall, NOISE_S)
        const sig = N.mode.noisePa / per
        sigHi.set((sig / 0.5) * (nz.h / 2))
        sigLo.set(-(sig / 0.5) * (nz.h / 2))
        nz.right.set(`±${cmText(sig)} · ${Math.round(N.mode.rateHz)} Hz`, POWER)

        head.status.set(`Barometer altitude · holding ${mText(q.holdM)} on the baro · true ${mText(f.h)}`)
        head.sub.set(`ground ${hpaText(P_SEA)} → ${hpaText(f.p0)} · air ${celsiusText(q.tempC)} · time-lapse 600×`)
        const err = f.h - q.holdM
        head.event.set(
          Math.abs(err) < 1 ? 'baro and truth agree: calm weather, standard 15 °C air' : `${err < 0 ? 'sinking' : 'too high'}: ${signed(err)} m, re-zero or fuse GPS altitude`,
          Math.abs(err) < 1 ? POWER : Math.abs(err) > 5 ? HIGH_V : HEAT,
        )
      },
      readouts: (p) => {
        const q = baParams(p)
        const R = baRun(q)
        const N = noiseRun(q)
        return [
          { label: 'Pressure per metre', value: `${R.perM.toFixed(1)} Pa/m` },
          { label: 'Altitude noise ±σ', value: `${cmText(N.mode.noisePa / R.perM)}, lag ${msText(N.mode.lagS)}`, tone: N.mode.noisePa / R.perM > 0.1 ? 'warn' : 'ok' },
          { label: 'Weather error after 2 h', value: `${signed(tiny(R.driftErrM, 0.05))} m`, tone: Math.abs(R.driftErrM) > 5 ? 'bad' : 'ok' },
          { label: 'Temperature error', value: `${signed(tiny(R.tempErrM, 0.05))} m`, tone: Math.abs(R.tempErrM) > 3 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
