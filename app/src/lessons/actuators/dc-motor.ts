import * as THREE from 'three/webgpu'
import {
  DRIVER_LIMIT_A,
  GEARBOXES,
  GearKind,
  PTC_050,
  RPM_PER_RADS,
  StallGuard,
  TT_CAR,
  TT_MOTOR,
  TT_THERMAL,
  armatureAmps,
  backEmf,
  freeSpeed,
  loadedSpeed,
  motorK,
  motorPoint,
  motorTau,
  peakEfficiency,
  peakPower,
  spinUp,
  stallAmps,
  stallRun,
  stallTorque,
  wheelDrive,
} from '../../core/physics'
import { msText } from '../../core/units'
import { V3, add, box, cylinder, mat, rod } from '../../models/kit'
import { buildWheel } from '../../models/motion'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  NORTH,
  POWER,
  RING,
  SOUTH,
  addLabel,
  brushedMotor,
  cell,
  cursorBar,
  gearTrain,
  glowMat,
  heatWaves,
  inOutBars,
  ivScreen,
  litWire,
  liveLabel,
  memoBy,
  meterBar,
  scope,
  simClock,
  smoke,
  thermometer,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const lit = (c: string) => new THREE.Color(c)
const R = TT_MOTOR.ohms
const mNm = (nm: number) => `${(nm * 1000).toFixed(2)} mN·m`
const rpm = (radS: number) => Math.round(radS * RPM_PER_RADS)
const voltSlider = (initial: number) => ({ kind: 'slider' as const, key: 'volts', label: 'Supply', min: 3, max: 6, step: 0.5, initial, format: (v: number) => `${v} V` })

/** Battery on the left wired to the motor's brushes; returns the lit overlay of both legs. */
function supplyLoop(scene: THREE.Object3D, x: number, pins: V3[], extra: (pts: V3[]) => V3[] = (p) => p) {
  add(scene, cell(5, 1.5), [x, 0, 0])
  const [p, m] = pins
  const plus = extra([[x, 2.9, 0], [x, p[1] + 1.4, 0], [p[0], p[1] + 1.4, p[2]], p])
  const minus: V3[] = [[x, -2.6, 0], [x, m[1] - 1.4, 0], [m[0], m[1] - 1.4, m[2]], m]
  wire(scene, plus, 0.14)
  wire(scene, minus, 0.14)
  return [litWire(scene, plus, 0.26), litWire(scene, minus, 0.26)]
}

// --- Back-EMF: switched on from rest, the spinning armature generates kω against the supply and the current falls. ---

const LOADS = { none: 'No load', light: 'Light load (25 %)', heavy: 'Heavy load (60 %)' }
const LOAD_F = { none: 0, light: 0.25, heavy: 0.6 }
const EMF = { ms: 300, slow: 20, draw: 150 }
const emfParams = (p: Params) => {
  const v = n(p, 'volts')
  const load = pick(LOADS, p.load, 'none')
  const loadNm = LOAD_F[load] * stallTorque(v)
  return { v, load, loadNm, w: loadedSpeed(v, loadNm) }
}

export const backEmfLesson: Lesson = {
  id: 'dc-motor-back-emf',
  title: 'Back-EMF',
  tagline: 'A spinning motor is also a generator',
  formula: (p) => {
    const { v, w } = emfParams(p)
    const i = armatureAmps(v, w)
    return `V = I·R + kω · start: I = ${v}/${R} = ${stallAmps(v).toFixed(2)} A · at speed: ${v} = ${i.toFixed(2)}·${R} + ${motorK().toFixed(5)}·${Math.round(w)} = ${(i * R).toFixed(2)} + ${backEmf(w).toFixed(2)} V`
  },
  legend: [
    { color: HEAT, label: 'Current I (I·R drop)', shape: 'dot' },
    { color: B_FIELD, label: 'Back-EMF kω', shape: 'dot' },
    { color: POWER, label: 'Supply V', shape: 'dot' },
    { color: NORTH, label: 'Coil poles: N / S', shape: 'dot' },
  ],
  points: [
    'Inside a brushed DC motor, two curved ferrite magnets make a field across a rotor (the armature) of three iron poles wound with copper. Current from the brushes turns each pole into an electromagnet; the force on its wires (F = IL × B, see the Right-hand rule) pulls it round towards the opposite magnet.',
    'The commutator, a split copper ring on the shaft, swaps which coils the carbon brushes feed every sixth of a turn, so the poles near each magnet always keep the polarity that pulls the rotor on the same way.',
    'Those same coils are now wires moving through a field, so they generate a voltage too: the back-EMF, E = kω, proportional to speed and pointing against the supply. The TT motor makes about 5.2 mV per rad/s at its armature.',
    'Only what is left drives current: I = (V − kω) / R. At switch-on ω = 0 and the 5 Ω winding takes the full V/R. As it speeds up the back-EMF rises and the current falls until it just covers friction and load.',
    `It settles in a few mechanical time constants (τ = J·R/k² ≈ ${msText(motorTau())} here). A load slows it, less back-EMF, more current: the motor draws what the torque needs. Spin it by hand and the same kω appears at its terminals as a generator.`,
  ],
  controls: [voltSlider(5), { kind: 'choice', key: 'load', options: opts(LOADS), initial: 'none' }],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const motor = brushedMotor(scene, [-9.5, 0.6, 0], 2.4)
    const legs = supplyLoop(scene, -16, motor.pins)
    const speedTag = liveLabel(scene, [-9.5, -6.6, 0.3], { size: 0.44 })

    const bars = inOutBars(scene, [POWER, HEAT, B_FIELD], 1.3, 1.4, 0.4)
    bars.group.position.set(-2.4, -4.6, 0)
    addLabel(scene, 'V', [-3.3, -5.4, 0.3], POWER, 0.5)
    addLabel(scene, 'IR + E', [-1.2, -5.4, 0.3], LABEL, 0.5)
    const irTag = liveLabel(scene, [-0.6, -3, 0.3], { size: 0.42, align: 'left' })
    const eTag = liveLabel(scene, [-0.6, 0, 0.3], { size: 0.42, align: 'left' })

    const plot = scope(scene, 8.6, 6.4, { divs: [6, 4], zeroAt: 0 })
    plot.group.position.set(9.4, 1.4, 0)
    const yOf = (u: number) => (u - 0.5) * plot.height
    const tr = { i: plot.trace(HEAT, { samples: EMF.draw, radius: 0.08 }), e: plot.trace(B_FIELD, { samples: EMF.draw, radius: 0.08 }) }
    const cur = cursorBar(plot, LABEL)
    addLabel(scene, `I 0…1.2 A, E 0…6 V · 0…${EMF.ms} ms`, [9.4, -2.6, 0.3], GREY, 0.36)
    const note = liveLabel(scene, [7, -4.4, 0.3], { size: 0.44 })
    const result = liveLabel(scene, [7, -5.6, 0.3], { size: 0.44 })

    const clock = simClock(EMF.slow / 1000, 2)
    const st = { t: 0, key: '', angle: 0 }
    const at = (q: ReturnType<typeof emfParams>, t: number) => {
      const w = spinUp(q.v, t, q.loadNm)
      return { w, i: armatureAmps(q.v, w), e: backEmf(w) }
    }
    return {
      scene,
      view: { center: [-1.5, 0, 0], radius: 55, polar: 1.48, azimuth: 0.12 },
      frame(dt, p) {
        const q = emfParams(p)
        const key = `${q.v}|${q.load}`
        const t = clock(dt, key, EMF.ms) / 1000
        st.t = t
        if (key !== st.key) {
          st.key = key
          const us = Array.from({ length: EMF.draw }, (_, k) => k / (EMF.draw - 1))
          const s = us.map((u) => at(q, (u * EMF.ms) / 1000))
          tr.i.points(us, s.map((x) => yOf(x.i / 1.2)))
          tr.e.points(us, s.map((x) => yOf(x.e / 6)))
        }
        const u = (t * 1000) / EMF.ms
        cur(u)
        const { w, i, e } = at(q, t)
        st.angle += (dt * w) / EMF.slow / 10
        motor.set(st.angle, i / 1.2)
        for (const l of legs) l.set(Math.min(1, 0.25 + i / 1.2), lit(HEAT))
        bars.set([q.v, -i * R, -e])
        irTag.set(`I·R ${(i * R).toFixed(2)} V`, HEAT)
        eTag.set(`kω ${e.toFixed(2)} V`, B_FIELD)
        irTag.group.position.y = -4.6 + (i * R * 1.3) / 2
        eTag.group.position.y = -4.6 + (i * R + e / 2) * 1.3
        speedTag.set(`${rpm(w)} rpm · rotor drawn ${EMF.slow * 10}× slower`, GREY)
        const settled = t > 4 * motorTau()
        note.set(t < 0.25 * motorTau() ? 'Switch-on: no back-EMF, I = V / R' : settled ? 'Steady: kω balances V − I·R' : 'Back-EMF rising, current falling', t < 0.25 * motorTau() ? HIGH_V : settled ? POWER : HEAT)
        result.set(q.loadNm ? `Load keeps ${armatureAmps(q.v, q.w).toFixed(2)} A flowing` : `Free running: only ${TT_MOTOR.noLoadA} A for friction`, LABEL)
      },
      readouts: (p) => {
        const q = emfParams(p)
        const { w, i, e } = at(q, st.t)
        return [
          { label: 'Sim time', value: `${msText(st.t)} (${EMF.slow}× slower)` },
          { label: 'Speed', value: `${rpm(w)} rpm` },
          { label: 'Back-EMF', value: `${e.toFixed(2)} V of ${q.v} V` },
          { label: 'Current', value: `${i.toFixed(2)} A`, tone: i > 0.6 * stallAmps(q.v) ? 'bad' : i > 0.3 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Torque and speed curve: straight T–ω line from stall to free speed; a load line crosses it at the operating point. ---

const LOAD_KIND = { weight: 'Weight on a drum (constant)', eddy: 'Eddy brake (∝ speed)' }
const TS6 = stallTorque(6)
const W06 = freeSpeed(6)
const DRUM_M = 0.005
const curveParams = (p: Params) => {
  const v = n(p, 'volts')
  const kind = pick(LOAD_KIND, p.kind, 'weight')
  const f = n(p, 'load') / 100
  const loadNm = kind === 'weight' ? f * TS6 : 0
  const damp = kind === 'eddy' ? (2 * f * TS6) / W06 : 0
  const w = loadedSpeed(v, loadNm, TT_MOTOR, damp)
  return { v, kind, f, loadNm, damp, w, pt: motorPoint(v, w), pp: peakPower(v), pe: peakEfficiency(v) }
}

export const torqueAndSpeedCurve: Lesson = {
  id: 'dc-motor-torque-and-speed-curve',
  title: 'Torque and speed curve',
  tagline: 'One straight line from stall to free speed',
  formula: (p) => {
    const { v, pt } = curveParams(p)
    return `T = T_stall·(1 − ω/ω₀) = ${mNm(stallTorque(v))}·(1 − ${Math.round(pt.rpm)}/${rpm(freeSpeed(v))}) = ${mNm(pt.torque)} · P = T·ω = ${pt.powerOut.toFixed(2)} W · η = ${Math.round(pt.eff * 100)} %`
  },
  legend: [
    { color: FORCE, label: 'Motor torque', shape: 'dot' },
    { color: B_FIELD, label: 'Load line', shape: 'dot' },
    { color: HEAT, label: 'Current', shape: 'dot' },
    { color: POWER, label: 'Output power', shape: 'dot' },
    { color: RING, label: 'Efficiency', shape: 'dot' },
  ],
  points: [
    'Torque is proportional to current (T = k·I, minus a little friction) and current is (V − kω)/R, so torque falls in a straight line with speed: stall torque at ω = 0, zero at the free-running speed ω₀. More volts slide the whole line up and out.',
    'The load has its own line: a weight on a drum needs the same torque at any speed (flat), an eddy-current brake needs more the faster it turns (sloped). The motor settles where the two cross, the operating point. Add load and it slows, draws more current and makes more torque.',
    'Output power P = T·ω is zero at both ends (no speed at stall, no torque when free) and peaks at half the free speed with a quarter of stall torque × ω₀.',
    'Efficiency is output over V·I. It peaks much nearer free speed, where I = √(I₀·I_stall), because the I²R loss grows with the square of the current. A cheap TT motor peaks near 40 %; good larger motors reach 70–90 %.',
    'So run a motor between its efficiency peak and its power peak, and gear it (next lesson) so the robot\'s load lands there, not near stall where it heats and wastes the battery.',
  ],
  controls: [
    voltSlider(6),
    { kind: 'choice', key: 'kind', options: opts(LOAD_KIND), initial: 'weight' },
    { kind: 'slider', key: 'load', label: 'Load', min: 0, max: 110, step: 5, initial: 30, format: (v) => `${v} % of 6 V stall` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const motor = brushedMotor(scene, [-11, 1, 0], 2.2)
    motor.group.rotation.y = 0.8
    const legs = supplyLoop(scene, -17, motor.pins.map((q): V3 => [q[0] + 1.2, q[1], q[2] - 0.6]))
    const tip = motor.shaftTip
    const drum = add(motor.rotor, new THREE.Group(), [tip[0], tip[1], tip[2] - 0.4])
    cylinder(drum, 0.55, 0.8, mat('#d9b24a', { metal: 0.35, rough: 0.4 }), [0, 0, 0], 'z', 24)
    box(drum, [1.2, 0.18, 0.84], mat('#7a5a1e'), [0, 0, 0])
    const weight = add(motor.group, new THREE.Group())
    const rope = rod(weight, [0.55, 0, tip[2] - 0.4], [0.55, -1, tip[2] - 0.4], 0.05, mat('#e8e2d0'))
    const block = box(weight, [1.2, 1.2, 1.2], mat('#5a5f69', { metal: 0.3, rough: 0.5 }), [0.55, -1, tip[2] - 0.4])
    const massTag = liveLabel(scene, [0, 0, 0.3], { size: 0.4, align: 'left' })
    const wp = new THREE.Vector3()
    const eddy = add(motor.group, new THREE.Group())
    const disc = add(motor.rotor, new THREE.Group(), [tip[0], tip[1], tip[2] - 0.4])
    const discMat = new THREE.MeshStandardMaterial({ color: '#c3c8cf', metalness: 0.4, roughness: 0.35 })
    cylinder(disc, 1.3, 0.14, discMat, [0, 0, 0], 'z', 40)
    for (const [z, c] of [[-0.35, NORTH], [0.35, SOUTH]] as const) box(eddy, [0.8, 0.9, 0.4], mat(c, { rough: 0.5 }), [0, 1.05, tip[2] - 0.4 + z])
    box(eddy, [0.8, 0.35, 1.1], mat('#3a3d44'), [0, 1.65, tip[2] - 0.4])
    const shaftTag = liveLabel(scene, [-13, -6.9, 0.3], { size: 0.42 })

    const { plot, dot, y } = ivScreen(scene, [5.6, 0.8, 0], 11, 7.2, [8, 4])
    const yOf = (f: number) => y(0.03 + 0.92 * f)
    dot.scale.setScalar(0.8)
    const N = 120
    const tr = {
      t: plot.trace(FORCE, { samples: N, radius: 0.09 }),
      l: plot.trace(B_FIELD, { samples: N, radius: 0.09 }),
      i: plot.trace(HEAT, { samples: N, radius: 0.06 }),
      p: plot.trace(POWER, { samples: N, radius: 0.06 }),
      e: plot.trace(RING, { samples: N, radius: 0.06 }),
    }
    ticks(plot, [[0, '0'], [0.5, `${rpm(W06 / 2)}`], [1, `${rpm(W06)}`]], [], 0.6)
    addLabel(scene, `rpm at the armature · T 0…${(TS6 * 1000).toFixed(1)} mN·m · I 0…1.2 A · P 0…${peakPower(6).powerOut.toFixed(1)} W · η 0…100 %`, [5.2, -5.4, 0.3], GREY, 0.28)
    const pTag = liveLabel(plot.group, [0, 0, 0.4], { size: 0.42 })
    const eTag = liveLabel(plot.group, [0, 0, 0.4], { size: 0.42 })
    const result = liveLabel(scene, [3, -6.9, 0.3], { size: 0.44 })

    const st = { key: '', angle: 0, lift: 0 }
    const P6 = peakPower(6).powerOut
    return {
      scene,
      view: { center: [-3.6, -0.4, 0], radius: 56, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = curveParams(p)
        const key = `${q.v}|${q.kind}|${q.f}`
        const uOf = (w: number) => w / W06
        if (key !== st.key) {
          st.key = key
          const w0 = freeSpeed(q.v)
          const us = Array.from({ length: N }, (_, k) => (k / (N - 1)) * uOf(w0))
          const pts = us.map((u) => motorPoint(q.v, u * W06))
          tr.t.points(us, pts.map((x) => yOf(x.torque / TS6)))
          tr.i.points(us, pts.map((x) => yOf(x.amps / 1.2)))
          tr.p.points(us, pts.map((x) => yOf(x.powerOut / P6)))
          tr.e.points(us, pts.map((x) => yOf(x.eff)))
          tr.l.draw((u) => yOf((q.loadNm + q.damp * u * W06) / TS6), null)
          pTag.set(`P max ${q.pp.powerOut.toFixed(2)} W`, POWER)
          pTag.group.position.set(plot.xAt(uOf(q.pp.radS)), yOf(q.pp.powerOut / P6) + 0.6, 0.4)
          eTag.set(`η max ${Math.round(q.pe.eff * 100)} %`, RING)
          eTag.group.position.set(plot.xAt(uOf(q.pe.radS)) - 0.4, yOf(q.pe.eff) + 0.55, 0.4)
        }
        const stalled = q.w === 0
        dot.position.set(plot.xAt(uOf(q.w)), yOf(Math.min(1.1, (stalled ? stallTorque(q.v) : q.pt.torque) / TS6)), 0.35)

        st.angle += (dt * q.w) / 400
        motor.set(st.angle, q.pt.amps / 1.2)
        for (const l of legs) l.set(Math.min(1, 0.25 + q.pt.amps / 1.2), lit(HEAT))
        const isW = q.kind === 'weight'
        drum.visible = weight.visible = isW
        disc.visible = eddy.visible = !isW
        st.lift = (st.lift + (dt * q.w * 0.55) / 400) % 4
        const yb = -6 + st.lift
        block.position.y = yb
        rope.scale.y = -yb
        rope.position.y = yb / 2
        block.getWorldPosition(wp)
        massTag.group.position.set(wp.x + 0.6, -2.4, 1)
        massTag.set(`${Math.round((q.loadNm / (9.81 * DRUM_M)) * 1000)} g on a 5 mm drum`, LABEL)
        discMat.emissive.set(HEAT)
        discMat.emissiveIntensity = isW ? 0 : Math.min(0.6, q.damp * q.w * q.w * 0.8)
        shaftTag.set(stalled ? 'Load beats stall torque: no motion' : `${Math.round(q.pt.rpm)} rpm · drawn 400× slower`, stalled ? HIGH_V : GREY)
        const zone = stalled ? 'Stalled: full V/R, zero output' : q.w < q.pp.radS ? 'Below the power peak: hot, inefficient' : q.w <= q.pe.radS * 1.02 ? 'Between power and efficiency peaks: good' : 'Near free speed: efficient but little torque'
        result.set(zone, stalled ? HIGH_V : q.w < q.pp.radS ? HEAT : POWER)
      },
      readouts: (p) => {
        const { pt, w, v } = curveParams(p)
        const stalled = w === 0
        return [
          { label: 'Speed', value: `${Math.round(pt.rpm)} rpm`, tone: stalled ? 'bad' : 'ok' },
          { label: 'Torque', value: mNm(stalled ? stallTorque(v) : pt.torque) },
          { label: 'Current', value: `${pt.amps.toFixed(2)} A`, tone: pt.amps > 0.7 * stallAmps(v) ? 'bad' : pt.amps > 0.4 * stallAmps(v) ? 'warn' : 'ok' },
          { label: 'Power · η', value: `${pt.powerOut.toFixed(2)} W · ${Math.round(pt.eff * 100)} %` },
        ]
      },
    }
  },
}

// --- Stall current: rotor locked, no back-EMF, I = V/R heats the winding unless a PTC or current limit steps in. ---

const GUARDS = { none: 'No protection', ptc: 'PTC fuse 0.5 A', limit: `Driver limit ${DRIVER_LIMIT_A} A` }
const STALL = { seconds: 90, dt: 0.1, fast: 10, maxA: 1.5, maxC: 160 }
const stallParams = (p: Params) => [n(p, 'volts'), pick(GUARDS, p.guard, 'none') as StallGuard] as const
const stallMemo = memoBy((q: readonly [number, StallGuard]) => q.join(), ([v, g]) => stallRun(v, g, STALL.seconds, STALL.dt))
const overAt = (frames: { t: number; tempC: number }[]) => frames.find((f) => f.tempC >= TT_THERMAL.maxC)?.t

export const stallCurrent: Lesson = {
  id: 'dc-motor-stall-current',
  title: 'Stall current',
  tagline: 'Locked rotor: only the winding resistance is left',
  formula: (p) => {
    const [v] = stallParams(p)
    const i = stallAmps(v)
    return `ω = 0 → no back-EMF → I = V / R = ${v} / ${R} = ${i.toFixed(2)} A · P = I²R = ${(i * i * R).toFixed(1)} W · rise = P·${TT_THERMAL.kPerW} K/W, R grows ${(TT_THERMAL.tempco * 100).toFixed(2)} %/K`
  },
  legend: [
    { color: HEAT, label: 'Current', shape: 'dot' },
    { color: HIGH_V, label: 'Winding temperature', shape: 'dot' },
    { color: RING, label: 'PTC / driver limit', shape: 'dot' },
  ],
  points: [
    'Hold the shaft (a wheel against a wall, a jammed arm) and the speed is zero, so there is no back-EMF. Nothing but the winding resistance limits the current: I = V / R, about 1 A for a TT motor at 5 V, 6 to 8 times its running current.',
    'Every start is a short stall too: for the first few milliseconds the motor draws V/R before back-EMF builds. Your battery, wiring and driver see that peak each time you go from stop to full PWM.',
    'All of it turns into heat, I²R = 5–7 W in a winding the size of a thumb. It climbs tens of degrees a minute; copper\'s resistance rises with it (0.39 %/K), which trims the current a little but not enough. Past ~100 °C the plastic end cap and brush holders soften and the enamel starts to fail.',
    `So the driver must survive stall current: an L298N (2 A) or TB6612 (1.2 A, 3.2 A peak) is fine for TT motors, a 500 mA chip is not. A resettable PTC fuse (${PTC_050.ratedA} A hold) heats and trips in seconds, then passes a trickle until power is cut. A driver with a current limit (ILIM, e.g. DRV8871) chops at a set current so the motor keeps pushing without cooking.`,
    'Firmware should also notice: high current with no encoder ticks for a few hundred ms means stalled; cut the PWM and report a fault (see Fault states).',
  ],
  controls: [voltSlider(6), { kind: 'choice', key: 'guard', options: opts(GUARDS), initial: 'none' }],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const motor = brushedMotor(scene, [-8, 0.4, 0], 2.4)
    const tip = motor.shaftTip
    for (const s of [-1, 1]) box(motor.group, [0.7, 1.2, 0.9], mat('#c23a3a', { rough: 0.5 }), [s * 0.55, 0, tip[2] - 0.6])
    box(motor.group, [2.4, 0.4, 0.9], mat('#8a2a2a', { rough: 0.5 }), [0, -0.8, tip[2] - 0.6])
    addLabel(motor.group, 'locked', [0, -1.5, tip[2] + 0.2], HIGH_V, 0.45)
    const guardAt: V3 = [-15, 5.4, 0]
    const legs = supplyLoop(scene, -15, motor.pins)
    const ptcMat = new THREE.MeshStandardMaterial({ color: '#e8b923', roughness: 0.5 })
    const ptc = cylinder(scene, 0.75, 0.3, ptcMat, guardAt, 'z', 24)
    const chipMat = new THREE.MeshStandardMaterial({ color: '#1f2126', roughness: 0.6 })
    const chip = box(scene, [2.2, 1.4, 0.5], chipMat, guardAt)
    const guardTag = liveLabel(scene, [guardAt[0], guardAt[1] + 1.4, 0.3], { size: 0.42 })
    const waves = heatWaves(scene, 3, { count: 4, rise: 4 })
    waves.group.position.set(-8, 4.6, 0)
    const fumes = smoke(scene, 3, { count: 18, rise: 5 })
    fumes.group.position.set(-8, 4.4, 0)
    const therm = thermometer(7)
    add(scene, therm.group, [-2.4, -4, 0])
    const tempTag = liveLabel(scene, [-2.4, 4.4, 0.3], { size: 0.46 })
    const ampTag = liveLabel(scene, [-8, -5.6, 0.3], { size: 0.5 })

    const plot = scope(scene, 9, 6.4, { divs: [9, 4], zeroAt: 0 })
    plot.group.position.set(7, 1.4, 0)
    const yA = (a: number) => (a / STALL.maxA - 0.5) * plot.height
    const yT = (c: number) => ((c - TT_THERMAL.ambientC) / (STALL.maxC - TT_THERMAL.ambientC) - 0.5) * plot.height
    const N = 300
    const tr = { a: plot.trace(HEAT, { samples: N, radius: 0.08 }), c: plot.trace(HIGH_V, { samples: N, radius: 0.08 }) }
    plot.level(HIGH_V).set(yT(TT_THERMAL.maxC))
    const cur = cursorBar(plot, LABEL)
    addLabel(scene, `I 0…${STALL.maxA} A, winding ${TT_THERMAL.ambientC}…${STALL.maxC} °C · 0…${STALL.seconds} s`, [7, -2.6, 0.3], GREY, 0.34)
    const note = liveLabel(scene, [5.4, -4.4, 0.3], { size: 0.42 })
    const result = liveLabel(scene, [5.4, -5.6, 0.3], { size: 0.42 })

    const clock = simClock(STALL.dt / STALL.fast, 2.5)
    const st = { t: 0, key: '' }
    return {
      scene,
      view: { center: [-3.6, 0, 0], radius: 53, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = stallParams(p)
        const [v, guard] = q
        const key = q.join()
        const frames = stallMemo(q)
        const f = frames[Math.floor(clock(dt, key, frames.length - 1))]
        st.t = f.t
        if (key !== st.key) {
          st.key = key
          const step = Math.ceil(frames.length / N)
          const pts = frames.filter((_, k) => k % step === 0)
          const us = pts.map((h) => h.t / STALL.seconds)
          tr.a.points(us, pts.map((h) => yA(h.amps)))
          tr.c.points(us, pts.map((h) => yT(h.tempC)))
        }
        cur(f.t / STALL.seconds)
        const hot = (f.tempC - TT_THERMAL.ambientC) / (TT_THERMAL.maxC - TT_THERMAL.ambientC)
        motor.set(0.3, f.amps / 1.2, Math.max(0.01, hot))
        for (const l of legs) l.set(Math.min(1, 0.2 + f.amps / 1.2), lit(HEAT))
        waves.step(dt, Math.max(0, hot - 0.15))
        fumes.step(dt, Math.max(0, hot - 1) * 4)
        therm.set((f.tempC - TT_THERMAL.ambientC) / (STALL.maxC - TT_THERMAL.ambientC))
        tempTag.set(`${Math.round(f.tempC)} °C`, f.tempC >= TT_THERMAL.maxC ? HIGH_V : f.tempC > 60 ? HEAT : LABEL)
        ampTag.set(`I = ${v} V / ${(v / f.amps).toFixed(1)} Ω = ${f.amps.toFixed(2)} A`, guard === 'none' ? HEAT : RING)
        if (guard === 'ptc' && f.tripped) ampTag.set(`PTC tripped: ${Math.round(f.amps * 1000)} mA trickle`, RING)
        if (guard === 'limit' && f.amps >= DRIVER_LIMIT_A - 1e-9) ampTag.set(`Limited: ${f.amps.toFixed(2)} A of ${(v / R).toFixed(2)} A`, RING)
        ptc.visible = guard === 'ptc'
        chip.visible = guard === 'limit'
        ptcMat.emissive.set(HIGH_V)
        ptcMat.emissiveIntensity = guard === 'ptc' && f.tripped ? 0.9 : 0
        chipMat.emissive.set(RING)
        chipMat.emissiveIntensity = guard === 'limit' && f.amps >= DRIVER_LIMIT_A - 1e-9 ? 0.4 : 0
        guardTag.set(guard === 'ptc' ? (f.tripped ? 'PTC tripped' : 'PTC 0.5 A') : guard === 'limit' ? 'ILIM 0.5 A' : 'direct', guard === 'none' ? GREY : RING)

        const over = overAt(frames)
        const trip = frames.find((h) => h.tripped)?.t
        note.set(f.tempC >= TT_THERMAL.maxC ? 'Past 100 °C: end cap softens, enamel fails' : f.tripped ? 'Hot PTC is now high-ohm: only a trickle flows' : 'Locked: no back-EMF, all power is heat', f.tempC >= TT_THERMAL.maxC ? HIGH_V : f.tripped ? RING : HEAT)
        result.set(
          trip !== undefined ? `PTC trips at ${trip.toFixed(1)} s, winding safe` : over !== undefined ? `Overheats at ${Math.round(over)} s` : `Settles at ${Math.round(frames[frames.length - 1].tempC)} °C: survives`,
          trip !== undefined || over === undefined ? POWER : HIGH_V,
        )
      },
      readouts: (p) => {
        const frames = stallMemo(stallParams(p))
        const f = frames[Math.min(frames.length - 1, Math.round(st.t / STALL.dt))]
        return [
          { label: 'Sim time', value: `${f.t.toFixed(1)} s (${STALL.fast}× faster)` },
          { label: 'Current', value: `${f.amps.toFixed(2)} A`, tone: f.amps > 0.8 ? 'bad' : f.amps > 0.4 ? 'warn' : 'ok' },
          { label: 'Heat', value: `${f.watts.toFixed(2)} W` },
          { label: 'Winding', value: `${Math.round(f.tempC)} °C`, tone: f.tempC >= TT_THERMAL.maxC ? 'bad' : f.tempC > 60 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Gearboxes: spur stages divide speed and multiply torque (minus mesh losses); the car climbs or stalls. ---

const GEARS = { direct: 'Direct drive (1:1)', tt48: 'TT 1:48', tt120: 'TT 1:120' }
const SLOPES = { s0: 'Flat floor', s15: '15° ramp', s30: '30° ramp' }
const SLOPE_DEG = { s0: 0, s15: 15, s30: 30 }
const GEAR_V = 5
const GEAR_SLOW = 100
const RAMP = { len: 9, k: 15 }
const gearParams = (p: Params) => {
  const g = pick(GEARS, p.gear, 'tt48') as GearKind
  const s = pick(SLOPES, p.slope, 's0')
  return { g, s, deg: SLOPE_DEG[s], d: wheelDrive(GEAR_V, GEARBOXES[g], (SLOPE_DEG[s] * Math.PI) / 180) }
}

export const gearboxes: Lesson = {
  id: 'dc-motor-gearboxes',
  title: 'Gearboxes',
  tagline: 'Trade the motor\'s speed for the wheel\'s torque',
  formula: (p) => {
    const { d } = gearParams(p)
    return `N = ${GEARBOXES[pick(GEARS, p.gear, 'tt48') as GearKind].stages.join('×') || '1'} = ${d.ratio} · ω_wheel = ${Math.round(d.motorRpm)}/${d.ratio} = ${Math.round(d.wheelRpm)} rpm · T_wheel = T_m·N·η = ${mNm(d.loadNm)}·${d.ratio}·${d.eff.toFixed(2)} = ${mNm(d.wheelNm)} · v = ω·r = ${d.speed.toFixed(2)} m/s`
  },
  legend: [
    { color: POWER, label: 'Pull the motor can give', shape: 'dot' },
    { color: HIGH_V, label: 'Pull the car needs', shape: 'dot' },
    { color: RING, label: 'Output shaft', shape: 'dot' },
  ],
  points: [
    `A bare TT motor spins ~${rpm(freeSpeed(GEAR_V))} rpm at ${GEAR_V} V but makes only ${mNm(stallTorque(GEAR_V))} at stall. A 65 mm wheel needs more than that just to roll a ${TT_CAR.massKg} kg car on carpet, so on direct drive it sits stalled, drawing V/R.`,
    'Two meshing spur gears turn at the inverse ratio of their teeth: a 10-tooth pinion driving a 40-tooth gear turns it 4× slower and, since power in ≈ power out, with 4× the torque. Stages multiply: the TT box is 3 × 4 × 4 = 48.',
    'Each mesh loses a few percent to tooth friction (~90 % per plastic stage here), so three stages give η ≈ 0.73: the wheel gets T_motor·N·η, never the full N×.',
    'More reduction climbs steeper ramps and starts heavier loads, but tops out slower: 1:120 has 2.5× the pull of 1:48 at 40 % of the speed. Pick the ratio so the usual load lands between the motor\'s efficiency and power peaks.',
    'Car speed is wheel ω × radius: v = ω·r. Plastic gears also add backlash (play before the output moves), which matters for position control; see Gear trains.',
  ],
  controls: [
    { kind: 'choice', key: 'gear', options: opts(GEARS), initial: 'tt48' },
    { kind: 'choice', key: 'slope', options: opts(SLOPES), initial: 's15' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const trains = (Object.keys(GEARS) as GearKind[]).map((g) => {
      const t = gearTrain(scene, [-17, 1.6, 0], GEARBOXES[g].stages, { mod: 0.14, width: 0.6 })
      cylinder(t.group, 1.5, 3.2, mat('#c9ccd1', { metal: 0.45, rough: 0.35 }), [0, 0, -2.2], 'z', 32)
      return { g, t }
    })
    const gearTag = liveLabel(scene, [-10, 7.2, 0.3], { size: 0.46 })
    addLabel(scene, `motor at ${GEAR_V} V · gears drawn ${GEAR_SLOW}× slower`, [-10, -5.6, 0.3], GREY, 0.4)
    const outTags = trains.map(({ t }) => liveLabel(scene, [t.shafts[t.shafts.length - 1], -2.4 - (t.radius > 4 ? 2.4 : 1), 0.3], { size: 0.42 }))

    const ramp = add(scene, new THREE.Group(), [2.6, -2.6, 0])
    box(ramp, [RAMP.len + 3, 0.4, 2.4], mat('#6b5a45', { rough: 0.9 }), [RAMP.len / 2 + 0.5, -0.2, 0])
    const car = add(ramp, new THREE.Group())
    box(car, [2.4, 0.8, 1.6], mat('#d8dbe2', { rough: 0.55 }), [0, 1.15, 0])
    box(car, [1.1, 0.4, 0.9], glowMat('#2a7a4a', 0.2), [0.2, 1.75, 0])
    const wheels = [-0.8, 0.8].map((x) => {
      const w = add(car, buildWheel(), [x, 0.7, 0.9])
      w.scale.setScalar(0.055)
      return w
    })
    const carTag = liveLabel(scene, [8, 4.4, 0.3], { size: 0.42 })

    const pull = meterBar(scene, [2.4, -7.2, 0], 6, 12, [], 'Max pull')
    const needMark = box(scene, [0.14, 2.2, 0.7], glowMat(HIGH_V, 0.7), [2.4, -7.2, 0])
    const needTag = liveLabel(scene, [2.4, -5.4, 0.3], { size: 0.4 })
    const result = liveLabel(scene, [-11.5, -7.4, 0.3], { size: 0.42 })

    const st = { angle: 0, x: 0, key: '' }
    return {
      scene,
      view: { center: [-2.6, -0.4, 0], radius: 56, polar: 1.45, azimuth: 0.12 },
      frame(dt, p) {
        const q = gearParams(p)
        const { d } = q
        const key = `${q.g}|${q.s}`
        if (key !== st.key) {
          st.key = key
          st.x = 0
        }
        trains.forEach(({ g, t }, k) => {
          t.group.visible = outTags[k].group.visible = g === q.g
          if (g === q.g) t.set(st.angle)
          outTags[k].set(`wheel ${Math.round(d.wheelRpm)} rpm`, d.speed > 0 ? RING : HIGH_V)
        })
        st.angle += (dt * d.motorRpm) / RPM_PER_RADS / GEAR_SLOW
        gearTag.set(d.speed > 0 ? `motor ${Math.round(d.motorRpm)} rpm ÷ ${d.ratio}` : `motor stalled: ${d.amps.toFixed(2)} A`, d.speed > 0 ? LABEL : HIGH_V)

        ramp.rotation.z = (q.deg * Math.PI) / 180
        st.x = (st.x + dt * d.speed * RAMP.k) % RAMP.len
        car.position.x = 1 + st.x
        for (const w of wheels) w.rotation.z = -st.x / 0.7
        carTag.set(d.speed > 0 ? `${d.speed.toFixed(2)} m/s · ${d.amps.toFixed(2)} A per motor` : `stalled · ${d.amps.toFixed(2)} A per motor`, d.speed > 0 ? POWER : HIGH_V)

        const ok = d.maxN > d.needN
        pull(d.maxN, `${d.maxN.toFixed(2)} N`, ok ? POWER : HIGH_V)
        needMark.position.x = 2.4 + (Math.min(12, d.needN) / 12) * 6
        needTag.group.position.x = needMark.position.x
        needTag.set(`needs ${d.needN.toFixed(2)} N`, HIGH_V)
        result.set(
          !ok ? 'Too little torque: the car never starts' : d.maxN < 2 * d.needN ? 'Climbs, but close to stall: hot and slow' : `Climbs with ${(d.maxN / d.needN).toFixed(1)}× margin`,
          !ok ? HIGH_V : d.maxN < 2 * d.needN ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const { d } = gearParams(p)
        return [
          { label: 'Wheel', value: `${Math.round(d.wheelRpm)} rpm`, tone: d.speed > 0 ? 'ok' : 'bad' },
          { label: 'Car speed', value: `${d.speed.toFixed(2)} m/s` },
          { label: 'Motor current', value: `${d.amps.toFixed(2)} A`, tone: d.amps > 0.7 ? 'bad' : d.amps > 0.4 ? 'warn' : 'ok' },
          { label: 'Pull need / max', value: `${d.needN.toFixed(2)} / ${d.maxN.toFixed(2)} N`, tone: d.maxN > 2 * d.needN ? 'ok' : d.maxN > d.needN ? 'warn' : 'bad' },
        ]
      },
    }
  },
}
