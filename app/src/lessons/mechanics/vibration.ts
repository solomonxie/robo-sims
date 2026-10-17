import { ACC_HZ, ACC_N, ACC_NOISE_G, ISOLATION_R, MOTOR_PLATE, MOUNTS, MOUNT_FN, Mount, accelG, accelSamples, accelSpectrum, frameShake, gaussAt, mountLag, mountStiffness, mountTransmit } from '../../core/physics'
import { niceCeil } from '../../core/units'
import { V3, box, mat, rod } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, LABEL, POWER, RING, SIDE_SCOPE, addLabel, coilSpring, flatBox, forceArrow, i2cBreakout, liveLabel, memoBy, plotPanel, scope, sideView, statusHeader, unbalancedMotor } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const VIEW = sideView(-2.2, -0.6)
const rpmText = (rpm: number) => `${Math.round(rpm).toLocaleString('en-US')} rpm`
const gText = (g: number) => (g < 0.1 ? `${(g * 1000).toFixed(0)} mg` : `${g.toFixed(g < 10 ? 2 : 0)} g`)
const um = (x: number) => (x < 1e-3 ? `${(x * 1e6).toFixed(0)} µm` : `${(x * 1000).toFixed(2)} mm`)
/** IMU sample i of a ±amp g sine at hz with a phase, plus sensor noise; linear between samples. */
const imuAt = (amp: number, hz: number, phase: number, seed: number) => (t: number) => {
  const s = (i: number) => amp * Math.sin((2 * Math.PI * hz * i) / ACC_HZ + phase) + ACC_NOISE_G * gaussAt(seed + (((i % 100000) + 100000) % 100000))
  const u = t * ACC_HZ
  const i = Math.floor(u)
  return s(i) + (s(i + 1) - s(i)) * (u - i)
}
const WIN = 0.05

// --- Motor vibration: an off-centre mass on the rotor pulls the frame round with m·e·ω²; the IMU sees it at rpm/60. ---

const MV = { slow: 1 / 80, plate: [-10, -3.6], top: { y: 1.4, h: 4.4 }, bot: { y: -5.8, h: 4.4 }, fMax: ACC_HZ / 2, shakeRef: 150e-6 }
const mvParams = (p: Params) => ({ rpm: n(p, 'rpm'), kg: n(p, 'mass') / 1000, e: n(p, 'radius') / 1000 })
type MvQ = ReturnType<typeof mvParams>
const mvKey = (q: MvQ) => `${q.rpm}|${q.kg}|${q.e}`
const mvShake = (q: MvQ) => frameShake(MOTOR_PLATE, q.kg, q.e, q.rpm)
const mvSpec = memoBy(mvKey, (q: MvQ) => {
  const s = mvShake(q)
  const amp = accelG(s.accel)
  return { amp, ...accelSpectrum(accelSamples(amp, s.hz, ACC_NOISE_G, 11, ACC_N, Math.PI - s.lag)) }
})

export const vibrationMotorVibration: Lesson = {
  id: 'vibration-motor-vibration',
  title: 'Motor vibration',
  tagline: 'Twice the speed, four times the shake',
  formula: (p) => {
    const q = mvParams(p)
    const s = mvShake(q)
    return `F = m·e·ω² = ${(q.kg * 1000).toFixed(1)} g × ${(q.e * 1000).toFixed(0)} mm × (${s.w.toFixed(0)} rad/s)² = ${s.force.toFixed(2)} N, turning at f = rpm/60 = ${s.hz.toFixed(0)} Hz · frame whirl X = (m·e/M)·r²/√((1 − r²)² + (2ζr)²), r = f/fn = ${s.r.toFixed(1)} → ${um(s.x)} · a = ω²·X = ${gText(accelG(s.accel))}`
  },
  legend: [
    { color: HEAT, label: 'Rotating force m·e·ω² (turns with the bolt)', shape: 'arrow-right' },
    { color: B_FIELD, label: 'IMU z-axis reading, gravity removed (top)', shape: 'dot' },
    { color: POWER, label: `Its spectrum 0…${MV.fMax} Hz (bottom)`, shape: 'dot' },
    { color: RING, label: 'Peak at the rotation frequency rpm/60', shape: 'dot' },
  ],
  points: [
    'No rotor is perfectly balanced: a blob of glue, a chipped propeller or a set-screw puts a little mass m a distance e off the axis. Spinning at ω it needs a centripetal pull m·e·ω², and that pull comes from the shaft, the bearings and whatever the motor is bolted to. The force turns with the rotor, so the frame is dragged round in a small circle once per revolution.',
    `The force grows with speed squared: 0.5 g at 10 mm is a gentle 0.12 N at 1,500 rpm but 7.9 N at 12,000 rpm, more than the motor and plate weigh. The plate here (${MOTOR_PLATE.M} kg on rubber feet, fn = ${MOTOR_PLATE.fn} Hz) swings hardest near ${rpmText(MOTOR_PLATE.fn * 60)} (Oscillations › Resonance); above that its whirl settles at m·e/M, but its acceleration ω²·X keeps climbing with speed².`,
    'An IMU on the frame feels every revolution as a sine at f = rpm/60 on its accelerometer, on top of its own noise (Sensors › IMU). At low speed it is lost in the noise; fast, it swamps the tilt you wanted to measure. The spectrum shows one clean peak at the rotation frequency: halve the bolt and it halves. A new peak, or one that grows over weeks, is how AI › Anomaly detection spots a damaged prop or a worn bearing. Fixes: balance the rotor (tape on the light side of a prop), keep fn away from the running speed, and soft-mount the sensor (Damping mounts).',
  ],
  controls: [
    { kind: 'slider', key: 'rpm', label: 'Motor speed', min: 600, max: 12000, step: 300, initial: 6000, format: rpmText },
    { kind: 'slider', key: 'mass', label: 'Unbalance mass m', min: 0.1, max: 2, step: 0.1, initial: 0.5, format: (v) => `${v.toFixed(1)} g` },
    { kind: 'slider', key: 'radius', label: 'At radius e', min: 5, max: 20, step: 1, initial: 10, format: (v) => `${v} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const { x, w } = SIDE_SCOPE
    const [px, py] = MV.plate
    flatBox(scene, [13, 0.5, 4], mat('#3a3d44', { rough: 0.8 }), [px, -7.6, 0])
    const springs = [-3.2, 3.2].map(() => coilSpring(scene, 0.45, 7, 0.08))
    const plate = box(scene, [9, 0.6, 3], mat('#7d848f', { metal: 0.4, rough: 0.45 }), [px, py, 0])
    const motor = unbalancedMotor(scene, [px - 1.8, py + 2.3, 0.4], 1.9)
    const imu = i2cBreakout(scene, [px + 2.7, py + 1.95, 1.6], { name: 'MPU-6050', k: 0.2 })
    imu.led(1)
    const zTag = liveLabel(scene, [px + 5.1, py + 2, 1.6], { size: 0.3, color: B_FIELD })
    zTag.set('z ↑')
    const force = forceArrow(scene, HEAT, { size: 0.3 })
    addLabel(scene, 'rubber feet', [px, -7, 1.6], GREY, 0.26)

    const { y: ty, h: th } = MV.top
    const acc = scope(scene, w, th, { divs: [10, 4], zeroAt: 0.5 })
    acc.group.position.set(x, ty, 0)
    addLabel(scene, `IMU accel z, last ${WIN * 1000} ms`, [x - w / 2, ty + th / 2 + 1.1, 0.3], B_FIELD, 0.3, 'left')
    const accRange = liveLabel(scene, [x + w / 2, ty + th / 2 + 1.1, 0.3], { size: 0.3, align: 'right' })
    addLabel(scene, `1 kHz samples · ${WIN * 1000} ms`, [x + w / 2, ty - th / 2 - 0.9, 0.3], GREY, 0.26, 'right')
    const accTr = acc.trace(B_FIELD, { samples: 201, radius: 0.05 })
    const { y: by, h: bh } = MV.bot
    const spec = scope(scene, w, bh, { divs: [10, 4], zeroAt: 0 })
    spec.group.position.set(x, by, 0)
    addLabel(scene, 'amplitude spectrum', [x - w / 2, by + bh / 2 + 1.1, 0.3], POWER, 0.3, 'left')
    const specRange = liveLabel(scene, [x + w / 2, by + bh / 2 + 1.1, 0.3], { size: 0.3, align: 'right' })
    addLabel(scene, '0', [x - w / 2, by - bh / 2 - 0.9, 0.3], GREY, 0.26, 'left')
    addLabel(scene, `${MV.fMax} Hz`, [x + w / 2, by - bh / 2 - 0.9, 0.3], GREY, 0.26, 'right')
    const specTr = spec.trace(POWER, { samples: ACC_N / 2 + 1, radius: 0.045 })
    const peakTr = spec.trace(RING, { samples: 2, radius: 0.04 })
    const peakTag = liveLabel(scene, [x + w / 2 - 0.4, by + bh / 2 - 0.5, 0.3], { size: 0.28, color: RING, align: 'right' })
    const st = { t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dtF, p) {
        const q = mvParams(p)
        const s = mvShake(q)
        const sp = mvSpec(q)
        st.t += dtF * MV.slow
        const th0 = s.w * st.t
        const vis = 0.9 * Math.min(1, Math.sqrt(s.x / MV.shakeRef))
        const [dx, dy] = [vis * Math.cos(th0 - s.lag), vis * Math.sin(th0 - s.lag)]
        plate.position.set(px + dx, py + dy, 0)
        motor.group.position.set(px - 1.8 + dx, py + 2.3 + dy, 0.4)
        motor.set(th0, q.e / 0.02)
        imu.group.position.set(px + 2.7 + dx, py + 1.95 + dy, 1.6)
        zTag.group.position.set(px + 5.1 + dx, py + 2 + dy, 1.6)
        springs.forEach((spring, i) => spring([px + (i ? 3.2 : -3.2), -7.35, 0], [px + (i ? 3.2 : -3.2) + dx, py - 0.3 + dy, 0]))
        const c: V3 = [px - 1.8 + dx, py + 2.3 + dy, 2.6]
        const L = Math.min(4, 0.5 + 0.55 * Math.sqrt(s.force))
        force(c, [c[0] + L * Math.cos(th0), c[1] + L * Math.sin(th0), c[2]], `${s.force.toFixed(2)} N`, [0, 0.6, 0.4])

        const range = Math.min(50, niceCeil(Math.max(sp.amp * 1.15, 4 * ACC_NOISE_G)))
        accRange.set(`±${gText(range)}`, LABEL)
        const sig = imuAt(sp.amp, s.hz, Math.PI - s.lag, 11)
        accTr.scroll((t) => (sig(t) / range) * (th / 2), st.t, WIN)
        specRange.set(`0…${gText(range)}`, LABEL)
        const us = sp.amps.map((_, i) => (i * sp.df) / MV.fMax)
        specTr.points(us, sp.amps.map((a) => -bh / 2 + (a / range) * bh))
        const up = sp.peakHz / MV.fMax
        const visible = sp.peak > 3 * ACC_NOISE_G
        peakTr.group.visible = visible
        peakTr.points([up, up], [-bh / 2, -bh / 2 + Math.min(1, sp.peak / range) * bh])
        peakTag.group.visible = visible
        peakTag.set(`peak ${sp.peakHz.toFixed(0)} Hz ≈ ${rpmText(q.rpm)} / 60`)

        head.status.set(`Motor vibration · ${rpmText(q.rpm)} · ${(q.kg * 1000).toFixed(1)} g at ${(q.e * 1000).toFixed(0)} mm`, LABEL)
        const near = Math.abs(s.r - 1) < 0.3
        head.event.set(
          visible ? (near ? `near the plate's fn (${MOTOR_PLATE.fn} Hz): it whirls hardest` : `frame shakes ±${gText(sp.amp)} at ${s.hz.toFixed(0)} Hz`) : 'shake lost in the IMU noise',
          near ? HEAT : visible ? B_FIELD : GREY,
        )
        head.sub.set(`motion shown ${Math.round(1 / MV.slow)}× slower · whirl exaggerated · M ${MOTOR_PLATE.M} kg, fn ${MOTOR_PLATE.fn} Hz`)
      },
      readouts: (p) => {
        const q = mvParams(p)
        const s = mvShake(q)
        const sp = mvSpec(q)
        return [
          { label: 'Unbalance force m·e·ω²', value: `${s.force.toFixed(2)} N`, tone: s.force > 3 ? 'bad' : s.force > 0.5 ? 'warn' : 'ok' },
          { label: 'Frame whirl X', value: um(s.x) },
          { label: 'IMU shake ω²·X', value: `±${gText(sp.amp)}`, tone: sp.amp > 0.5 ? 'bad' : sp.amp > 0.1 ? 'warn' : 'ok' },
          { label: 'Spectrum peak (3.9 Hz bins)', value: `${sp.peakHz.toFixed(0)} Hz (rpm/60 = ${s.hz.toFixed(0)})` },
        ]
      },
    }
  },
}

// --- Damping mounts: a flight controller on rubber; above √2·fn the board shakes less than the frame. ---

const DMT = { slow: 1 / 100, frame: [-10, -5.8], mountH: 2.8, top: { y: 1.4, h: 4.4 }, bot: { y: -5.8, h: 4.4 }, fMax: 300, tMax: 4, frameG: 1, gRange: 3, boardKg: 0.02 }
const dmtParams = (p: Params) => ({ rpm: n(p, 'rpm'), mount: pick(MOUNTS, p.mount, 'soft') as Mount, zeta: n(p, 'zeta') })
const MOUNT_COLOR: Record<Mount, string> = { none: GREY, stiff: RING, soft: B_FIELD }
const fnText = (m: Mount) => (m === 'none' ? 'rigid' : `${MOUNT_FN[m]} Hz`)

export const vibrationDampingMounts: Lesson = {
  id: 'vibration-damping-mounts',
  title: 'Damping mounts',
  tagline: 'Soft enough to float, not so soft it rings',
  formula: (p) => {
    const q = dmtParams(p)
    const f = q.rpm / 60
    const T = mountTransmit(q.mount, q.zeta, f)
    const r = q.mount === 'none' ? 0 : f / MOUNT_FN[q.mount]
    return `T = board ÷ frame = √(1 + (2ζr)²) / √((1 − r²)² + (2ζr)²) · r = f/fn = ${q.mount === 'none' ? '0 (rigid)' : r.toFixed(2)} → T = ${T.toFixed(2)} · T < 1 only when r > √2 · fn = √(k/m)/2π, k = m·(2π·fn)²`
  },
  legend: [
    { color: B_FIELD, label: `Soft gummies, fn ${MOUNT_FN.soft} Hz (top: T vs frequency, 0…${DMT.tMax})`, shape: 'dot' },
    { color: RING, label: `Stiff rubber, fn ${MOUNT_FN.stiff} Hz`, shape: 'dot' },
    { color: GREY, label: `Frame IMU reading (bottom, ±${DMT.gRange} g)`, shape: 'dot' },
    { color: POWER, label: 'Flight-controller IMU on the mount', shape: 'dot' },
  ],
  points: [
    `The frame shakes at the motor speed (Motor vibration); the flight controller only feels what its mounts pass on. On rubber it is a spring-mass with its own fn = √(k/m)/2π (Oscillations › Spring-mass), shaken from below. The ratio board ÷ frame is the transmissibility T. Here the frame shakes ±${DMT.frameG} g; hard-mounted, the IMU gets all of it.`,
    'Below fn the board just rides along (T ≈ 1). Near fn the mount resonates and makes things worse (Oscillations › Resonance). Only above r = √2 does the board shake less than the frame, and the further above, the better: T falls roughly as 1/r². So the mount must be soft enough that fn sits well below the lowest motor speed: a 30 Hz mount isolates from 42 Hz (2,500 rpm) up, a stiff 120 Hz one only from 170 Hz.',
    'Damping ζ is a trade: it flattens the resonant peak you pass through while spinning up, but it also leaks more vibration at high speed (the curves cross at √2). Drones use soft silicone grommets or gel pads under the flight controller and still filter the gyro in software (Signals › Filters). Too soft is bad too: the board wobbles on its mounts when the frame tilts, and a fn near the control-loop rate corrupts the attitude estimate.',
  ],
  controls: [
    { kind: 'choice', key: 'mount', options: opts(MOUNTS), initial: 'soft' },
    { kind: 'slider', key: 'rpm', label: 'Motor speed', min: 600, max: 18000, step: 300, initial: 9000, format: rpmText },
    { kind: 'slider', key: 'zeta', label: 'Mount damping ζ', min: 0.03, max: 0.5, step: 0.01, initial: 0.1, format: (v) => v.toFixed(2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const { x, w } = SIDE_SCOPE
    const [fx, fy] = DMT.frame
    const steel = mat('#7d848f', { metal: 0.4, rough: 0.45 })
    const frame = box(scene, [13, 0.5, 3], mat('#5a606b', { metal: 0.3, rough: 0.5 }), [fx, fy, 0])
    const motors = [-6, 6].map((dx) => {
      const g = box(scene, [1.4, 1.4, 1.4], steel, [fx + dx, fy + 0.95, 0])
      const prop = box(scene, [3.6, 0.12, 0.4], mat('#c9ccd1', { rough: 0.5 }), [fx + dx, fy + 1.8, 0])
      return { g, prop, dx }
    })
    addLabel(scene, 'frame', [fx - 4, fy - 0.9, 1.6], GREY, 0.28)
    const mountXs = [-1.8, 1.8]
    const soft = mountXs.map(() => coilSpring(scene, 0.4, 6, 0.06))
    const stiff = mountXs.map(() => coilSpring(scene, 0.32, 3, 0.14))
    const brass = mat('#c8a24a', { metal: 0.6, rough: 0.35 })
    const posts = mountXs.map(() => rod(scene, [0, 0, 0], [0, 1, 0], 0.18, brass))
    const board = i2cBreakout(scene, [fx, 0, 0.3], { name: 'FC · IMU', color: '#1f5e3a', k: 0.3 })
    board.led(1)
    const mountTag = liveLabel(scene, [fx + 3.4, fy + 1.4, 1.6], { size: 0.28, align: 'left' })

    const { y: ty, h: th } = DMT.top
    const tp = scope(scene, w, th, { divs: [6, 4], zeroAt: 0 })
    tp.group.position.set(x, ty, 0)
    addLabel(scene, `transmissibility T (0…${DMT.tMax})`, [x - w / 2, ty + th / 2 + 1.1, 0.3], LABEL, 0.3, 'left')
    addLabel(scene, 'isolates below T = 1', [x + w / 2, ty + th / 2 + 1.1, 0.3], GREY, 0.28, 'right')
    addLabel(scene, '0', [x - w / 2, ty - th / 2 - 0.9, 0.3], GREY, 0.26, 'left')
    addLabel(scene, `${DMT.fMax} Hz`, [x + w / 2, ty - th / 2 - 0.9, 0.3], GREY, 0.26, 'right')
    for (const m of ['soft', 'stiff'] as const) {
      const u = (ISOLATION_R * MOUNT_FN[m]) / DMT.fMax
      addLabel(scene, '√2·fn', [x - w / 2 + u * w, ty - th / 2 - 0.9, 0.3], MOUNT_COLOR[m], 0.24)
    }
    tp.level(GREY).set(-th / 2 + th / DMT.tMax)
    const fLine = tp.trace(HEAT, { samples: 2, radius: 0.035 })
    const curves = (['none', 'stiff', 'soft'] as const).map((m) => ({ m, tr: tp.trace(MOUNT_COLOR[m], { samples: 240, radius: 0.05 }) }))
    const yT = (T: number) => -th / 2 + (Math.min(T, DMT.tMax * 1.05) / DMT.tMax) * th
    const { y: by, h: bh } = DMT.bot
    const ap = plotPanel(scene, [x, by, 0], w, bh, WIN, 'IMU accel: frame vs board', `±${DMT.gRange} g`, 0.5, 10)
    const frameTr = ap.trace(GREY, { samples: 201, radius: 0.04 })
    const boardTr = ap.trace(POWER, { samples: 201, radius: 0.06 })
    const st = { t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dtF, p) {
        const q = dmtParams(p)
        const f = q.rpm / 60
        const T = mountTransmit(q.mount, q.zeta, f)
        const lag = mountLag(q.mount, q.zeta, f)
        st.t += dtF * DMT.slow
        const ph = 2 * Math.PI * f * st.t
        const vf = 0.3 * Math.sin(ph)
        const vb = Math.min(4, T) * 0.3 * Math.sin(ph - lag)
        frame.position.y = fy + vf
        for (const m of motors) {
          m.g.position.y = fy + 0.95 + vf
          m.prop.position.y = fy + 1.8 + vf
        }
        const top = fy + 0.25 + vf
        const bottom = fy + 0.25 + DMT.mountH + vb
        mountXs.forEach((mx, i) => {
          const a: V3 = [fx + mx, top, 0]
          const b: V3 = [fx + mx, bottom, 0]
          soft[i].group.visible = q.mount === 'soft'
          stiff[i].group.visible = q.mount === 'stiff'
          soft[i](a, b)
          stiff[i](a, b)
          posts[i].visible = q.mount === 'none'
          posts[i].position.set(fx + mx, (top + bottom) / 2, 0)
          posts[i].scale.y = bottom - top
        })
        board.group.position.set(fx, bottom + 2.4, 0.3)
        mountTag.group.position.y = fy + 1.4 + vf
        mountTag.set(`${MOUNTS[q.mount]} · fn ${fnText(q.mount)}`, MOUNT_COLOR[q.mount])

        for (const { m, tr } of curves) tr.draw((u) => yT(mountTransmit(m, q.zeta, u * DMT.fMax)), m === q.mount ? Math.min(1, f / DMT.fMax) : null)
        const uf = Math.min(1, f / DMT.fMax)
        fLine.points([uf, uf], [-th / 2, th / 2])
        const scale = bh / 2 / DMT.gRange
        const fs = imuAt(DMT.frameG, f, 0, 3)
        const bs = imuAt(DMT.frameG * T, f, -lag, 5)
        frameTr.scroll((t) => fs(t) * scale, st.t, WIN)
        boardTr.scroll((t) => bs(t) * scale, st.t, WIN)

        const iso = T < 1
        head.status.set(`Damping mounts · ${MOUNTS[q.mount]} · ${rpmText(q.rpm)} (${f.toFixed(0)} Hz)`, LABEL)
        head.event.set(
          q.mount === 'none' ? 'hard-mounted: the IMU gets the full shake' : iso ? `isolating: the board gets ${Math.round(T * 100)} % of the shake` : `amplifying ${T.toFixed(1)}×: below √2·fn = ${(ISOLATION_R * MOUNT_FN[q.mount]).toFixed(0)} Hz`,
          q.mount === 'none' ? GREY : iso ? POWER : HEAT,
        )
        head.sub.set(`motion shown ${Math.round(1 / DMT.slow)}× slower, exaggerated · frame ±${DMT.frameG} g at the motor speed`)
      },
      readouts: (p) => {
        const q = dmtParams(p)
        const f = q.rpm / 60
        const T = mountTransmit(q.mount, q.zeta, f)
        const fn = MOUNT_FN[q.mount]
        return [
          { label: 'Mount fn (20 g board)', value: q.mount === 'none' ? 'rigid' : `${fn} Hz · k ${(mountStiffness(DMT.boardKg, fn) / 1000).toFixed(1)} N/mm` },
          { label: 'Isolates above √2·fn', value: q.mount === 'none' ? 'never' : rpmText(ISOLATION_R * fn * 60) },
          { label: 'Transmissibility T', value: `${T.toFixed(2)}×`, tone: T < 0.5 ? 'ok' : T < 1 ? 'warn' : 'bad' },
          { label: 'Board IMU shake', value: `±${gText(T * DMT.frameG)} (frame ±${DMT.frameG} g)` },
        ]
      },
    }
  },
}
