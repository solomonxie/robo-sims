import * as THREE from 'three/webgpu'
import {
  Abc,
  DEG,
  FOC_LOOP_S,
  FOC_MOTOR,
  PHASE_NAMES,
  abcToDq,
  clarke,
  dqToAbc,
  fixedStepAt,
  focRun,
  invPark,
  piGains,
  pmsmTorque,
  iqRiseTime,
  rpmToWe,
  sixStepCurrents,
  svMaxVolts,
  svSector,
  svpwm,
} from '../../core/physics'
import { msText } from '../../core/units'
import { V3, add, box, mesh, rod } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  DATA_COLOR,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  PHASE_COLORS,
  POWER,
  RING,
  addLabel,
  arrow,
  bldcMotor,
  codeBlock,
  cursorBar,
  fetSymbol,
  glowMat,
  liveLabel,
  memoBy,
  moduleBlock,
  scope,
  simClock,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const TAU = 2 * Math.PI
const turn = (th: number) => (((th / TAU) % 1) + 1) % 1
const amps = (a: number) => `${(Math.abs(a) < 0.05 ? 0 : a).toFixed(1)} A`
const nm = (t: number) => `${t.toFixed(2)} N·m`

/** Arrow from the origin along +x (angle 0); `set(angle, len)`. */
function vectorArrow(parent: THREE.Object3D, at: V3, color: string, width = 0.18, opacity = 1) {
  const g = add(parent, new THREE.Group(), at)
  const m = glowMat(color, 0.9)
  m.transparent = opacity < 1
  m.opacity = opacity
  const shaft = box(g, [1, width, width * 0.7], m, [0.5, 0, 0])
  shaft.castShadow = false
  const tip = add(g, mesh(new THREE.ConeGeometry(width * 1.9, width * 3.6, 12), m))
  tip.rotation.z = -Math.PI / 2
  return {
    group: g,
    set(angle: number, len: number) {
      g.rotation.z = angle
      const l = Math.max(0.001, len - width * 1.8)
      shaft.scale.x = l
      shaft.position.x = l / 2
      tip.position.x = l + width * 1.8
      g.visible = len > 0.05
    },
  }
}

function motorWithNeedles(scene: THREE.Object3D, at: V3, r: number) {
  const motor = bldcMotor(scene, at, r, { phaseColors: PHASE_COLORS })
  const current = vectorArrow(scene, [at[0], at[1], at[2] + 0.4 * r], RING, 0.16, 0.7)
  const rotor = vectorArrow(motor.rotor, [0, 0, 0.3 * r], POWER, 0.16)
  rotor.set(0, 1.1 * r)
  return { motor, current }
}

// --- Clarke and Park: three phase currents → a rotating α/β vector → two steady numbers in the rotor's frame. ---

const DRIVES = { foc: 'FOC (sine currents)', six: 'Six-step (trapezoid)' }
const CP = { motor: [-13.4, 1.6, 0] as V3, r: 2.4, abc: [-4.6, 1.6, 0] as V3, ab: [3.2, 1.6, 0] as V3, dq: [10.4, 0.4, 0] as V3, dial: 2.5, perA: 0.21, rev: 0.18 }
const cpParams = (p: Params) => {
  const drive = pick(DRIVES, p.drive, 'foc')
  return { drive, iq: n(p, 'iq'), id: drive === 'foc' ? n(p, 'id') : 0 }
}
type CpQ = ReturnType<typeof cpParams>
const currentsOf = (q: CpQ, th: number): Abc => (q.drive === 'foc' ? dqToAbc(q.id, q.iq, th) : sixStepCurrents(q.iq, th))
const torqueAt = (q: CpQ, th: number) => {
  const dq = abcToDq(currentsOf(q, th), th)
  return pmsmTorque(dq.d, dq.q)
}
const SAMPLES = Array.from({ length: 360 }, (_, k) => (k + 0.5) * DEG)
const cpMemo = memoBy(
  (q: CpQ) => `${q.drive}|${q.iq}|${q.id}`,
  (q: CpQ) => {
    const ts = SAMPLES.map((th) => torqueAt(q, th))
    const max = Math.max(...ts)
    const min = Math.min(...ts)
    return { max, min, mean: ts.reduce((a, b) => a + b, 0) / ts.length, ripple: max > 0 ? (max - min) / max : 0 }
  },
)

export const clarkeAndPark: Lesson = {
  id: 'field-oriented-control-clarke-and-park',
  title: 'Clarke and Park',
  tagline: 'Three sines become two steady numbers',
  formula: (p) => {
    const q = cpParams(p)
    return `Clarke: α = ⅔(a − b/2 − c/2), β = (b − c)/√3 · Park: d = α·cosθ + β·sinθ, q = −α·sinθ + β·cosθ · T = 1.5 · ${FOC_MOTOR.pairs} pole pairs · ${FOC_MOTOR.psi} Wb · Iq = ${nm(cpMemo(q).mean)}`
  },
  legend: [
    { color: HEAT, label: 'Phase A', shape: 'dot' },
    { color: B_FIELD, label: 'Phase B', shape: 'dot' },
    { color: DATA_COLOR, label: 'Phase C', shape: 'dot' },
    { color: RING, label: 'Current vector · q axis', shape: 'dot' },
    { color: POWER, label: 'Rotor magnet · d axis', shape: 'dot' },
  ],
  points: [
    'Six-step drive (see Three-phase drive) points the stator field in only six directions, so the angle to the rotor swings between 60° and 120° and torque ripples. FOC (field-oriented control, vector control) steers the field smoothly so it always sits exactly 90° ahead of the magnet.',
    'To do that it drives sine currents in all three phases. Measured, they are three waves 120° apart that add to zero, which is awkward to control: every value is moving all the time, faster as the motor speeds up.',
    'The Clarke transform adds the three phase currents as arrows along the coil axes (A 0°, B 120°, C 240°). Since a + b + c = 0, two numbers carry it all: α along A and β 90° from it. α/β is one vector of fixed length turning with the rotor.',
    'The Park transform reads that vector in the rotor\'s own frame, using the rotor angle θ from an encoder or observer: d along the magnet, q 90° ahead. Seen from the spinning rotor the vector stands still, so d and q are two steady DC numbers, at any speed.',
    'Now the job is simple: q current makes torque (T = 1.5·p·ψ·Iq), d current only pushes along the magnet, so hold Id = 0 (or below 0 to weaken the field at top speed). Switch to six-step and the d/q bars wobble: that wobble is the 13 % torque ripple you hear and feel.',
  ],
  controls: [
    { kind: 'choice', key: 'drive', options: opts(DRIVES), initial: 'foc' },
    { kind: 'slider', key: 'iq', label: 'Torque current Iq', min: 1, max: 10, step: 0.5, initial: 8, format: (v) => `${v.toFixed(1)} A` },
    { kind: 'slider', key: 'id', label: 'Id (FOC only)', min: -6, max: 6, step: 0.5, initial: 0, format: (v) => `${v.toFixed(1)} A` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { motor, current } = motorWithNeedles(scene, CP.motor, CP.r)
    addLabel(scene, 'rotor angle θ', [CP.motor[0], CP.motor[1] + 3.6, 0.4], GREY, 0.34)
    const faint = glowMat('#5a606c', 0.3)
    const R = CP.dial

    const abcAxes = PHASE_COLORS.map((c, k) => {
      const a = (k * TAU) / 3
      const g = add(scene, new THREE.Group(), CP.abc)
      g.rotation.z = a
      rod(g, [-R - 0.3, 0, -0.05], [R + 0.3, 0, -0.05], 0.04, faint)
      addLabel(scene, PHASE_NAMES[k], [CP.abc[0] + (R + 0.8) * Math.cos(a), CP.abc[1] + (R + 0.8) * Math.sin(a), 0.3], c, 0.42)
      return vectorArrow(g, [0, 0, 0.05 + 0.04 * k], c, 0.15)
    })
    addLabel(scene, 'a, b, c along coil axes', [CP.abc[0], CP.abc[1] - R - 1.3, 0.3], GREY, 0.32)

    const ring = add(scene, mesh(new THREE.TorusGeometry(R, 0.05, 8, 96), faint), CP.ab)
    ring.castShadow = false
    rod(scene, [CP.ab[0] - R - 0.4, CP.ab[1], -0.05], [CP.ab[0] + R + 0.4, CP.ab[1], -0.05], 0.04, faint)
    rod(scene, [CP.ab[0], CP.ab[1] - R - 0.4, -0.05], [CP.ab[0], CP.ab[1] + R + 0.4, -0.05], 0.04, faint)
    addLabel(scene, 'α', [CP.ab[0] + R + 0.8, CP.ab[1], 0.3], LABEL, 0.42)
    addLabel(scene, 'β', [CP.ab[0], CP.ab[1] + R + 0.7, 0.3], LABEL, 0.42)
    const dAxis = add(scene, new THREE.Group(), [CP.ab[0], CP.ab[1], 0.02])
    rod(dAxis, [0, 0, 0], [R + 0.2, 0, 0], 0.07, glowMat(POWER, 0.5))
    rod(dAxis, [0, 0, 0], [0, R + 0.2, 0], 0.05, glowMat(RING, 0.25))
    const vec = vectorArrow(scene, [CP.ab[0], CP.ab[1], 0.15], RING, 0.18)
    addLabel(scene, 'α β: one turning vector', [CP.ab[0], CP.ab[1] - R - 1.3, 0.3], GREY, 0.32)

    const bars = [POWER, RING].map((c, k) => {
      const x = CP.dq[0] + (k - 0.5) * 2.2
      box(scene, [1.6, 0.06, 1], faint, [x, CP.dq[1], -0.1])
      const bar = box(scene, [1.1, 1, 0.8], glowMat(c, 0.7), [x, CP.dq[1], 0])
      bar.castShadow = false
      addLabel(scene, k ? 'q' : 'd', [x, CP.dq[1] - 2.6, 0.4], c, 0.46)
      return { bar, x, tag: liveLabel(scene, [x, CP.dq[1] + 0.6, 0.6], { size: 0.34 }) }
    })
    addLabel(scene, 'd q: steady', [CP.dq[0], CP.dq[1] - 3.4, 0.3], GREY, 0.32)
    for (const [x0, x1, name] of [[CP.motor[0] + 3.2, CP.abc[0] - 3.5, 'measure'], [CP.abc[0] + 3.4, CP.ab[0] - 3.4, 'Clarke'], [CP.ab[0] + 3.4, CP.dq[0] - 2.4, 'Park']] as const) {
      const y = CP.motor[1] + 2.4
      arrow(scene, [x1, y, 0], [1, 0, 0], GREY, 0.45)
      rod(scene, [x0, y, 0], [x1 - 0.6, y, 0], 0.05, glowMat(GREY, 0.3))
      addLabel(scene, name, [(x0 + x1) / 2, y + 0.5, 0.3], LABEL, 0.32)
    }

    const ab = scope(scene, 12, 3.2, { divs: [12, 4], zeroAt: 0.5 })
    ab.group.position.set(-7.6, -6.8, 0)
    const yI = (a: number) => (a / 12) * (ab.height / 2)
    const phaseTr = PHASE_COLORS.map((c, k) => ab.trace(c, { samples: 241, radius: 0.04 + 0.01 * (2 - k) }))
    const abCur = cursorBar(ab, LABEL)
    ticks(ab, [0, 0.25, 0.5, 0.75, 1].map((u): [number, string] => [u, `${u * 360}`]), [], 0.34)
    addLabel(scene, 'phase current ±12 A vs rotor angle (°)', [-7.6, -9.5, 0.3], GREY, 0.3)

    const tq = scope(scene, 9, 3.2, { divs: [12, 4], zeroAt: 0 })
    tq.group.position.set(8.9, -6.8, 0)
    const yT = (t: number) => (t / 1.2 - 0.5) * tq.height
    const other = tq.trace(GREY, { samples: 361, radius: 0.035 })
    const mine = tq.trace(FORCE, { samples: 361, radius: 0.07 })
    const tqCur = cursorBar(tq, LABEL)
    ticks(tq, [0, 0.5, 1].map((u): [number, string] => [u, `${u * 360}`]), [], 0.34)
    addLabel(scene, 'torque 0…1.2 N·m vs angle · grey: other drive', [8.9, -9.5, 0.3], GREY, 0.3)
    const result = liveLabel(scene, [8.9, -4.2, 0.3], { size: 0.36 })

    const st = { th: 0.4, key: '' }
    return {
      scene,
      view: { center: [-1.6, -2, 0], radius: 55, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = cpParams(p)
        st.th += TAU * CP.rev * dt
        const key = `${q.drive}|${q.iq}|${q.id}`
        if (key !== st.key) {
          st.key = key
          phaseTr.forEach((tr, k) => tr.draw((u) => yI(currentsOf(q, u * TAU)[k]), null))
          const alt: CpQ = { ...q, drive: q.drive === 'foc' ? 'six' : 'foc', id: 0 }
          mine.draw((u) => yT(torqueAt(q, u * TAU)), null)
          other.draw((u) => yT(torqueAt(alt, u * TAU)), null)
          const m = cpMemo(q)
          result.set(q.drive === 'foc' ? `Flat torque ${nm(m.mean)}` : `Torque ripple ${(m.ripple * 100).toFixed(0)} %: ${m.min.toFixed(2)}…${nm(m.max)}`, q.drive === 'foc' ? POWER : HEAT)
        }
        const i = currentsOf(q, st.th)
        motor.set(st.th, i.map((a) => a / 10))
        const v = clarke(...i)
        const ang = Math.atan2(v.beta, v.alpha)
        const mag = Math.hypot(v.alpha, v.beta)
        current.set(ang, 0.32 * mag)
        abcAxes.forEach((arr, k) => arr.set(i[k] >= 0 ? 0 : Math.PI, Math.abs(i[k]) * CP.perA))
        vec.set(ang, mag * CP.perA)
        dAxis.rotation.z = st.th
        const dq = abcToDq(i, st.th)
        ;[dq.d, dq.q].forEach((val, k) => {
          const h = Math.max(0.02, Math.abs(val) * 0.32)
          const b = bars[k]
          b.bar.scale.y = h
          b.bar.position.y = CP.dq[1] + (val >= 0 ? h / 2 : -h / 2)
          b.tag.group.position.y = CP.dq[1] + (val >= 0 ? h + 0.6 : 0.6)
          b.tag.set(amps(val), k ? RING : POWER)
        })
        abCur(turn(st.th))
        tqCur(turn(st.th))
      },
      readouts: (p) => {
        const q = cpParams(p)
        const m = cpMemo(q)
        return [
          { label: 'Drive', value: q.drive === 'foc' ? 'sine currents' : 'six steps of 60°' },
          { label: 'Id / Iq', value: q.drive === 'foc' ? `${amps(q.id)} / ${amps(q.iq)}` : 'wobbling', tone: q.drive === 'foc' && q.id === 0 ? 'ok' : 'warn' },
          { label: 'Torque', value: nm(m.mean) },
          { label: 'Ripple', value: `${(m.ripple * 100).toFixed(1)} %`, tone: m.ripple > 0.05 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Current loops: two PIs hold Id = 0 and Iq = command, inverse Park/Clarke → SVPWM → three half-bridges. ---

const CL = { seconds: 8e-3, stepAt: 1e-3, rpm: 1000, slow: 750, motor: [12.4, 1.6, 0] as V3, r: 2.1, legs: [0, 3.4, 6.8], top: 4.8, bot: -1.4, node: 1.7 }
const clParams = (p: Params) => ({ cmd: n(p, 'cmd'), bw: n(p, 'bw'), err: n(p, 'err') })
type ClQ = ReturnType<typeof clParams>
const clKey = (q: ClQ) => `${q.cmd}|${q.bw}|${q.err}`
const clMemo = memoBy(clKey, (q: ClQ) => focRun(q.cmd, q.bw, q.err * DEG, { rpm: CL.rpm, stepAt: CL.stepAt, seconds: CL.seconds }))

export const currentLoops: Lesson = {
  id: 'field-oriented-control-current-loops',
  title: 'Current loops',
  tagline: 'Two PIs, SVPWM and the rotor angle',
  formula: (p) => {
    const q = clParams(p)
    const g = piGains(q.bw, FOC_MOTOR.ohms, FOC_MOTOR.ld)
    return `Kp = L·2π·f = ${g.kp.toFixed(2)} V/A, Ki = R·2π·f = ${Math.round(g.ki)} V/(A·s) at f = ${q.bw} Hz · |V| ≤ Vbus/√3 = ${svMaxVolts(FOC_MOTOR.vbus).toFixed(1)} V · angle error ${q.err}° → T × cos ${q.err}° = ${(Math.cos(q.err * DEG) * 100).toFixed(0)} %`
  },
  legend: [
    { color: RING, label: 'Iq (torque) · current', shape: 'dot' },
    { color: POWER, label: 'Id · rotor magnet', shape: 'dot' },
    { color: GREY, label: 'Command · believed angle', shape: 'dot' },
    { color: HEAT, label: 'Phase A duty', shape: 'dot' },
  ],
  points: [
    'FOC is two current loops running in the rotor frame, typically at 10–40 kHz on the motor-control MCU. Each pass: read two phase currents (the third is minus their sum) and the rotor angle, Clarke and Park them into Id and Iq.',
    'Two PI controllers compare them with their targets: Iq with the torque command, Id with zero. Because d/q are steady numbers, a plain PI reaches zero error at any speed. Their outputs are the voltages Vd and Vq to apply.',
    'Inverse Park and Clarke turn Vd/Vq back into three phase voltages, and SVPWM turns those into three duty cycles for the half-bridges, adding a common offset that buys 15 % more voltage from the same bus. The saddle-shaped duties are that offset.',
    'Tune by cancelling the coil: Kp = L·ωc, Ki = R·ωc gives a clean first-order response at bandwidth ωc. Raise it and the step gets faster, until the loop asks for more than Vbus/√3 and the bus voltage, not the gains, sets the slope. Set it low and the speed coupling ωL·Iq pushes Id off zero; real drives add it back as feed-forward.',
    'Everything hinges on the angle. An encoder mounted a few degrees off, or a sensorless observer lagging at low speed, puts the vector where the loop thinks q is. It still reads Iq = command, but the real Iq is command × cos(error): at 60° half the torque, at 90° none, the motor just heats.',
  ],
  controls: [
    { kind: 'slider', key: 'cmd', label: 'Iq command step', min: 1, max: 10, step: 0.5, initial: 6, format: (v) => `${v.toFixed(1)} A` },
    { kind: 'slider', key: 'bw', label: 'Loop bandwidth', min: 100, max: 2000, step: 100, initial: 500, format: (v) => `${v} Hz` },
    { kind: 'slider', key: 'err', label: 'Angle error', min: 0, max: 90, step: 5, initial: 0, format: (v) => `${v}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { motor, current } = motorWithNeedles(scene, CL.motor, CL.r)
    const ghost = vectorArrow(scene, [CL.motor[0], CL.motor[1], 0.7 * CL.r], GREY, 0.12, 0.8)

    const blk = { d: moduleBlock(scene, [-15, 3.9, 0], [4.4, 1.4, 0.6], 'PI d'), q: moduleBlock(scene, [-15, 1.5, 0], [4.4, 1.4, 0.6], 'PI q'), inv: moduleBlock(scene, [-9.9, 2.7, 0], [3.4, 2.6, 0.6], 'inv Park'), sv: moduleBlock(scene, [-4.8, 2.7, 0], [3.2, 2.6, 0.6], 'SVPWM') }
    addLabel(scene, '+ inv Clarke', [-9.9, 1.9, 0.4], GREY, 0.28)
    const svTag = liveLabel(scene, [-4.8, 1.9, 0.4], { size: 0.28, color: GREY })
    wire(scene, [[-12.8, 3.9, 0], [-12.5, 3.9, 0], [-12.5, 3.2, 0], [-11.6, 3.2, 0]], 0.07)
    wire(scene, [[-12.8, 1.5, 0], [-12.5, 1.5, 0], [-12.5, 2.2, 0], [-11.6, 2.2, 0]], 0.07)
    addLabel(scene, 'Vd', [-12.1, 4.0, 0.3], POWER, 0.3)
    addLabel(scene, 'Vq', [-12.1, 1.4, 0.3], RING, 0.3)
    wire(scene, [[-8.2, 2.7, 0], [-6.4, 2.7, 0]], 0.07)
    addLabel(scene, 'Va Vb Vc', [-7.3, 3.15, 0.3], GREY, 0.24)
    addLabel(scene, 'Iq* →', [-18, 0.2, 0.3], GREY, 0.3)

    wire(scene, [[CL.legs[0] - 1.2, CL.top, 0], [CL.legs[2] + 0.4, CL.top, 0]], 0.14)
    wire(scene, [[CL.legs[0] - 1.2, CL.bot, 0], [CL.legs[2] + 0.4, CL.bot, 0]], 0.14)
    addLabel(scene, `+${FOC_MOTOR.vbus} V`, [CL.legs[0] - 1.4, CL.top, 0.3], HIGH_V, 0.32, 'right')
    addLabel(scene, 'GND', [CL.legs[0] - 1.4, CL.bot, 0.3], LOW_V, 0.32, 'right')
    const legs = CL.legs.map((x, k) => {
      const hi = fetSymbol(scene, [x, CL.top, 0], [x, CL.node + 0.4, 0], 'N', ' ')
      const lo = fetSymbol(scene, [x, CL.node - 0.4, 0], [x, CL.bot, 0], 'N', ' ')
      wire(scene, [[x, CL.node + 0.4, 0], [x, CL.node - 0.4, 0]], 0.16)
      const pin = motor.pins[k]
      const y = -2.4 - k * 0.4
      wire(scene, [[x, CL.node, 0], [x + 0.8, CL.node, 0], [x + 0.8, y, 0], [pin[0], y, 0], pin], 0.07)
      addLabel(scene, PHASE_NAMES[k], [x + 1.2, CL.node + 0.5, 0.3], PHASE_COLORS[k], 0.36)
      return { hi, lo, duty: liveLabel(scene, [x, CL.top + 0.6, 0.3], { size: 0.28 }) }
    })
    wire(scene, [[-3.2, 2.7, 0], [CL.legs[0] - 1.3, 2.7, 0]], 0.07)
    const fb: V3[] = [[CL.motor[0], CL.motor[1] - CL.r - 1.9, 0], [CL.motor[0], -3.8, 0], [-17, -3.8, 0], [-17, 2.7, 0], [-16.8, 2.7, 0]]
    wire(scene, fb, 0.06)
    const fbTag = liveLabel(scene, [-5, -3.3, 0.3], { size: 0.3 })

    const sr = scope(scene, 13, 3.4, { divs: [8, 4], zeroAt: 0.5 })
    sr.group.position.set(-8.6, -7.8, 0)
    const yA = (a: number) => (a / 10) * (sr.height * 0.45)
    const refTr = sr.trace(GREY, { samples: 161, radius: 0.04 })
    const idTr = sr.trace(POWER, { samples: 161, radius: 0.05 })
    const iqTr = sr.trace(RING, { samples: 161, radius: 0.06 })
    const srCur = cursorBar(sr, LABEL)
    ticks(sr, [0, 2, 4, 6, 8].map((ms): [number, string] => [ms / 8, `${ms}`]), [], 0.34)
    addLabel(scene, 'true Id, Iq and the command (±10 A) vs time (ms)', [-8.6, -10.8, 0.3], GREY, 0.3)
    const result = liveLabel(scene, [-8.6, -5.4, 0.3], { size: 0.34 })

    const du = scope(scene, 8.4, 3.4, { divs: [12, 4], zeroAt: 0 })
    du.group.position.set(9.6, -7.8, 0)
    const yD = (d: number) => (d - 0.5) * du.height
    const dutyTr = PHASE_COLORS.map((c, k) => du.trace(c, { samples: 121, radius: 0.04 + 0.01 * (2 - k) }))
    const duCur = cursorBar(du, LABEL)
    ticks(du, [0, 0.5, 1].map((u): [number, string] => [u, `${u * 360}`]), [], 0.34)
    addLabel(scene, 'duty 0…100 % vs electrical angle (°)', [9.6, -10.8, 0.3], GREY, 0.3)
    const code = codeBlock(scene, [-17.6, 7.6, 0.3], 0.3)

    const clock = simClock(CL.slow * 1e-6, 2)
    const st = { t: 0, key: '' }
    const frameAt = (q: ClQ, t: number) => fixedStepAt(clMemo(q), t, FOC_LOOP_S)
    return {
      scene,
      view: { center: [-2.2, -1.8, 0], radius: 60, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = clParams(p)
        const run = clMemo(q)
        const key = clKey(q)
        const t = clock(dt, key, CL.seconds * 1e6) / 1e6
        st.t = t
        if (key !== st.key) {
          st.key = key
          const us = run.map((f) => f.t / CL.seconds)
          refTr.points(us, run.map((f) => yA(f.iqRef)))
          idTr.points(us, run.map((f) => yA(f.id)))
          iqTr.points(us, run.map((f) => yA(f.iq)))
          const end = run[run.length - 1]
          const rise = iqRiseTime(run, CL.stepAt)
          const sat = run.some((f) => f.sat)
          result.set(
            q.err >= 45 ? `Loop reads ${amps(end.iqSeen)} but real Iq is ${amps(end.iq)}` : `Rise ${rise === null ? '—' : msText(rise)}${sat ? ': voltage-limited' : ''}`,
            q.err >= 45 ? HIGH_V : sat ? HEAT : POWER,
          )
          fbTag.set(`ia, ib + encoder θ${q.err ? ` (${q.err}° off)` : ''} → Clarke, Park`, q.err ? HEAT : LABEL)
          const g = piGains(q.bw, FOC_MOTOR.ohms, FOC_MOTOR.ld)
          code([`vd = piD.step(0 - id, ${g.kp.toFixed(2)}, ${Math.round(g.ki)});  // ${(1e6 * FOC_LOOP_S).toFixed(0)} µs loop`, `vq = piQ.step(${q.cmd.toFixed(1)} - iq, ${g.kp.toFixed(2)}, ${Math.round(g.ki)});`, 'svpwm(invPark(vd, vq, theta), &da, &db, &dc);'])
        }
        const f = frameAt(q, t)
        const est = f.theta + q.err * DEG
        motor.set(f.theta, dqToAbc(f.id, f.iq, f.theta).map((a) => a / 10))
        current.set(f.theta + Math.atan2(f.iq, f.id), 0.3 * Math.hypot(f.id, f.iq))
        ghost.set(est, 1.15 * CL.r)
        ghost.group.visible = q.err > 0
        const v = invPark(f.vd, f.vq, est)
        dutyTr.forEach((tr, k) =>
          tr.draw((u) => {
            const w = invPark(f.vd, f.vq, u * TAU + q.err * DEG)
            return yD(svpwm(w.alpha, w.beta, FOC_MOTOR.vbus)[k])
          }, null),
        )
        legs.forEach((l, k) => {
          l.hi.set(f.duty[k])
          l.lo.set(1 - f.duty[k])
          l.duty.set(`${Math.round(f.duty[k] * 100)} %`, PHASE_COLORS[k])
        })
        const busy = f.t >= CL.stepAt && Math.abs(f.iqRef - f.iqSeen) > 0.3
        blk.d(dt, POWER, Math.min(1, 0.25 + Math.abs(f.idSeen)), `Id ${f.idSeen.toFixed(1)} → 0`)
        blk.q(dt, RING, busy ? 1 : 0.35, `Iq ${f.iqSeen.toFixed(1)} → ${f.iqRef.toFixed(1)}`)
        blk.inv(dt, GREY, 0.4, 'inv Park')
        blk.sv(dt, f.sat ? HEAT : PHASE_COLORS[0], f.sat ? 1 : 0.4, f.sat ? 'SVPWM max' : 'SVPWM')
        svTag.set(`sector ${svSector(v.alpha, v.beta)}`, GREY)
        srCur(t / CL.seconds)
        duCur(turn(f.theta))
      },
      readouts: (p) => {
        const q = clParams(p)
        const f = frameAt(q, st.t)
        return [
          { label: 'Sim time', value: `${msText(st.t)} (${CL.slow}× slower)` },
          { label: 'Iq command / real', value: `${amps(f.iqRef)} / ${amps(f.iq)}`, tone: Math.abs(f.iqRef - f.iq) > 0.5 ? 'warn' : 'ok' },
          { label: 'Torque', value: nm(f.torque), tone: q.err >= 30 ? 'bad' : q.err > 0 ? 'warn' : 'ok' },
          { label: 'Back-EMF at 1000 rpm', value: `${(rpmToWe(CL.rpm) * FOC_MOTOR.psi).toFixed(1)} V of ${svMaxVolts(FOC_MOTOR.vbus).toFixed(1)} V` },
        ]
      },
    }
  },
}
