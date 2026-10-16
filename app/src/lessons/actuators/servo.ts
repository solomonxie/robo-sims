import * as THREE from 'three/webgpu'
import {
  CR_SERVO,
  DEG,
  ESP32_BOD,
  ESP32_MIN_V,
  PwmSource,
  RAIL,
  SERVO_DEG_PER_S,
  SERVO_SPECS,
  SG90_LOOP,
  Wiring,
  crRpm,
  fixedStepAt,
  overshootDeg,
  pulseForDeg,
  railSummary,
  servoAim,
  servoLoopRun,
  servoRailRun,
  servoRest,
  servoSettleS,
  servoStep,
  usToDeg,
} from '../../core/physics'
import { msText } from '../../core/units'
import { buildElectrolyticCap } from '../../models/passives'
import { V3, add, box, mat, mesh, rod } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  PIN_COLOR,
  POWER,
  RING,
  B_FIELD,
  addLabel,
  brushedMotor,
  codeBlock,
  cursorBar,
  esp32Board,
  gearTrain,
  glowBox,
  glowHalo,
  glowMat,
  heatWaves,
  icPackage,
  litWire,
  liveLabel,
  memoBy,
  partLetter,
  rotaryPot,
  scope,
  sg90Servo,
  shellMat,
  simClock,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const lit = (c: string) => new THREE.Color(c)
const deg0 = (d: number) => `${Math.round(d)}°`
const pct = (f: number) => `${f > 0 ? '+' : ''}${Math.round(f * 100)} %`

/** Protractor in the xy plane round `at`: 0° at +x, 180° at −x, ticks every 45°. */
function dial(scene: THREE.Object3D, at: V3, r: number) {
  const g = add(scene, new THREE.Group(), at)
  add(g, mesh(new THREE.TorusGeometry(r, 0.07, 8, 64, Math.PI), mat('#5c6270', { rough: 0.5 })))
  for (const d of [0, 45, 90, 135, 180]) {
    const a = d * DEG
    add(g, mesh(new THREE.BoxGeometry(0.6, 0.12, 0.12), glowMat(GREY, 0.4)), [r * Math.cos(a), r * Math.sin(a), 0]).rotation.z = a
    const end = d % 180 === 0
    partLetter(g, `${d}°`, [(r + (end ? 0 : 1.2)) * Math.cos(a), (r + 1.2) * Math.sin(a) - (end ? 1.3 : 0.3), 0.4], 0.5, GREY)
  }
  return { group: g, at: (d: number, rr = r): V3 => [rr * Math.cos(d * DEG), rr * Math.sin(d * DEG), 0] }
}

// --- Pulse to angle: each servo maps its own pulse range; code must match it, or the horn misses or pushes on its stop. ---

const SERVO_KIND = { wide: 'SG90 clone (500–2500 µs)', narrow: 'Standard (1000–2000 µs)', cr: '360° continuous' }
const CODE_RANGE = { narrow: 'Code 1000–2000 µs', wide: 'Code 500–2500 µs' }
const RANGES = { narrow: [1000, 2000], wide: [500, 2500] } as const
const PA = { at: [-9.5, -2.4, 0] as V3, k: 2, arc: 5.6, maxUs: 3000 }
const PA_SHAFT: V3 = [PA.at[0] - 0.75 * PA.k, PA.at[1], PA.at[2] + 1.75 * PA.k]
const pulseParams = (p: Params) => {
  const kind = pick(SERVO_KIND, p.servo, 'wide')
  const code = pick(CODE_RANGE, p.code, 'narrow')
  const deg = n(p, 'angle')
  const us = pulseForDeg(deg, RANGES[code])
  return { kind, code, deg, us, rest: kind === 'cr' ? null : servoRest(us, SERVO_SPECS[kind]), rpm: crRpm(us) }
}

export const pulseToAngle: Lesson = {
  id: 'servo-pulse-to-angle',
  title: 'Pulse to angle',
  tagline: 'Calibrate the range, or it misses or buzzes',
  formula: (p) => {
    const q = pulseParams(p)
    const [lo, hi] = RANGES[q.code]
    const code = `pulse = ${lo} + ${q.deg}/180 × ${hi - lo} = ${Math.round(q.us)} µs`
    if (!q.rest) return `${code} · 360°: speed ∝ pulse − ${CR_SERVO.neutralUs} µs → ${q.rpm.toFixed(1)} rpm`
    const s = SERVO_SPECS[q.kind as 'wide' | 'narrow']
    return `${code} · servo: (${Math.round(q.us)} − ${s.minUs}) / ${s.maxUs - s.minUs} × 180° = ${deg0(q.rest.aim)}${q.rest.overDeg ? ` → stop at ${deg0(q.rest.deg)}` : ''}`
  },
  legend: [
    { color: PIN_COLOR, label: 'Pulse the code sends', shape: 'dot' },
    { color: POWER, label: 'Range this servo expects', shape: 'dot' },
    { color: RING, label: 'Where the servo aims', shape: 'dot' },
    { color: HIGH_V, label: 'Mechanical end stops', shape: 'dot' },
  ],
  points: [
    'A servo turns pulse width into an angle (see Servo pulses), but the range is not universal. Many cheap SG90 and MG996R clones want 500–2500 µs for their full 180°; classic RC servos take 1000–2000 µs. The Arduino Servo library defaults to 544–2400 µs.',
    'Code for 1000–2000 µs on a 500–2500 µs servo only reaches 45°…135°: half the travel. Code for 500–2500 on a 1000–2000 servo aims past both ends.',
    'Past the end the gears hit a mechanical stop, but the electronics still see an error, so the motor pushes at full current and buzzes: about 0.7 A for an SG90, 2.5 A for an MG996R, and it heats and strips gears.',
    'Calibrate once: step the pulse in 10 µs steps until the horn just stops moving at each end (or lines up with 0° and 180° on a protractor), back off a little, and pass those numbers: servo.attach(pin, min, max).',
    `A 360° (continuous) servo has its pot swapped for a fixed divider, so the pulse sets speed and direction, not angle. Its stop point is set by a trim pot and is rarely exactly 1500 µs: this one stops at ${CR_SERVO.neutralUs} µs, so write(90) still creeps.`,
  ],
  controls: [
    { kind: 'choice', key: 'servo', options: opts(SERVO_KIND), initial: 'wide' },
    { kind: 'choice', key: 'code', options: opts(CODE_RANGE), initial: 'narrow' },
    { kind: 'slider', key: 'angle', label: 'write(angle)', min: 0, max: 180, step: 5, initial: 180, format: (v) => `${v}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const holder = add(scene, new THREE.Group(), PA.at)
    holder.scale.setScalar(PA.k)
    const horn = sg90Servo(holder, [0, 0, 0])
    const kindTag = liveLabel(scene, [PA.at[0] + 0.9, PA.at[1] - 3.4, 0.3], { size: 0.5 })
    const d = dial(scene, [PA_SHAFT[0], PA_SHAFT[1], PA_SHAFT[2] - 0.4], PA.arc)
    const stops = [0, 1].map(() => add(d.group, mesh(new THREE.BoxGeometry(1.4, 0.36, 0.36), glowMat(HIGH_V, 0.8))))
    const aimMat = glowMat(RING, 1.2)
    const aim = add(d.group, mesh(new THREE.SphereGeometry(0.42, 16, 12), aimMat))
    const waves = heatWaves(scene, 2.4, { count: 3, rise: 3 })
    waves.group.position.set(PA.at[0] + 1, PA.at[1] + 2.4, 1)
    const hornTag = liveLabel(scene, [PA_SHAFT[0], PA.at[1] + PA.arc + 2.4, 0.3], { size: 0.55 })

    const plot = scope(scene, 11, 4.4, { divs: [6, 2] })
    plot.group.position.set(9.4, 2.4, 0)
    const pulse = plot.trace(PIN_COLOR, { samples: 200, radius: 0.1 })
    ticks(plot, [0, 0.5, 1, 1.5, 2, 2.5, 3].map((m): [number, string] => [m / 3, `${m}`]), [], 0.5)
    addLabel(scene, 'ms', [15.6, -0.6, 0.3], GREY, 0.45)
    const usTag = liveLabel(scene, [9.4, 5.4, 0.3], { size: 0.6, color: PIN_COLOR })
    const bar = (y: number, c: string, name: string) => {
      const m = add(scene, mesh(new THREE.BoxGeometry(1, 0.4, 0.3), glowMat(c, 0.7)), [0, y, 0])
      addLabel(scene, name, [3.4, y, 0.3], c, 0.42)
      return (lo: number, hi: number) => {
        const [a, b] = [plot.xAt(lo / PA.maxUs), plot.xAt(hi / PA.maxUs)]
        m.scale.x = b - a
        m.position.x = 9.4 + (a + b) / 2
      }
    }
    const codeBar = bar(-1.8, PIN_COLOR, 'code')
    const servoBar = bar(-2.7, POWER, 'servo')
    const code = codeBlock(scene, [3.2, -4.6, 0.3], 0.5)
    const result = liveLabel(scene, [9.4, -8.4, 0.3], { size: 0.5 })

    const st = { t: 0, deg: 90, spin: 0 }
    return {
      scene,
      view: { center: [0.4, -1, 0], radius: 64, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = pulseParams(p)
        st.t += dt
        const cr = !q.rest
        d.group.visible = !cr
        pulse.draw((u) => (u * PA.maxUs < q.us ? 1.4 : -1.4), null)
        usTag.set(`${Math.round(q.us)} µs every 20 ms`, PIN_COLOR)
        const [lo, hi] = RANGES[q.code]
        codeBar(lo, hi)
        const pinned = !!q.rest && q.rest.overDeg > 0
        if (q.rest) {
          const s = SERVO_SPECS[q.kind as 'wide' | 'narrow']
          servoBar(s.minUs, s.maxUs)
          s.stops.forEach((a, i) => {
            stops[i].position.set(...d.at(a, PA.arc - 0.9))
            stops[i].rotation.z = a * DEG
          })
          aim.position.set(...d.at(q.rest.aim, PA.arc + 1))
          aimMat.emissive.set(pinned ? HIGH_V : RING)
          st.deg = servoStep(st.deg, q.rest.deg, dt)
          const buzz = pinned && Math.abs(st.deg - q.rest.deg) < 0.5 ? 1.2 * Math.sin(st.t * 2 * Math.PI * 25) : 0
          horn.rotation.z = (st.deg + buzz - 90) * DEG
          hornTag.set(pinned ? `Pushing on the stop: ${q.rest.amps.toFixed(2)} A, buzzing` : `Horn ${deg0(st.deg)}`, pinned ? HIGH_V : LABEL)
          code([`servo.attach(13, ${lo}, ${hi});`, `servo.write(${q.deg});  // ${Math.round(q.us)} µs`, `// aims ${deg0(q.rest.aim)}, stops ${s.stops[0]}°…${s.stops[1]}°`])
          const span = Math.round(servoAim(hi, s) - servoAim(lo, s))
          result.set(
            pinned ? 'Over-driven: stall current against the stop' : span < 180 ? `Code range too narrow: ${180 - span}° of travel unused` : span > 180 ? 'Code range too wide: the ends hit the stops' : 'Code range matches this servo',
            pinned ? HIGH_V : span === 180 ? POWER : HEAT,
          )
        } else {
          servoBar(CR_SERVO.neutralUs - CR_SERVO.spanUs, CR_SERVO.neutralUs + CR_SERVO.spanUs)
          st.spin += q.rpm * 6 * dt
          horn.rotation.z = -st.spin * DEG
          hornTag.set(q.rpm === 0 ? 'Stopped' : `${q.rpm > 0 ? 'Clockwise' : 'Anticlockwise'} ${Math.abs(q.rpm).toFixed(1)} rpm`, q.rpm === 0 ? POWER : LABEL)
          code([`servo.attach(13, ${lo}, ${hi});`, `servo.write(${q.deg});  // ${Math.round(q.us)} µs`, `// stops at ${CR_SERVO.neutralUs} µs: trim or calibrate`])
          const creep = q.rpm !== 0 && Math.abs(q.rpm) < 5
          result.set(creep ? `Creeping: neutral is ${CR_SERVO.neutralUs} µs, not 1500` : q.rpm === 0 ? 'Inside the deadband: stopped' : 'Pulse sets speed, not angle', creep ? HEAT : q.rpm === 0 ? POWER : LABEL)
        }
        waves.step(dt, pinned ? 1 : 0)
        kindTag.set(cr ? 'SG90 360°' : q.kind === 'wide' ? 'SG90 (500–2500)' : 'Standard (1000–2000)', GREY)
      },
      readouts: (p) => {
        const q = pulseParams(p)
        const r = q.rest
        return [
          { label: 'Pulse', value: `${Math.round(q.us)} µs` },
          r
            ? { label: 'Angle', value: `${deg0(st.deg)} (aims ${deg0(r.aim)})`, tone: r.overDeg ? 'bad' : 'ok' }
            : { label: 'Speed', value: `${q.rpm.toFixed(1)} rpm`, tone: q.rpm !== 0 && Math.abs(q.rpm) < 5 ? 'warn' : 'ok' },
          { label: 'Current', value: r ? `${r.amps.toFixed(2)} A` : '—', tone: r && r.amps > 0 ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Inside a hobby servo: the pot on the output is compared with the pulse; the error drives the motor through an H-bridge. ---

const GAINS = { low: 'Gain low (30° band)', mid: 'Gain normal (10° band)', high: 'Gain high (2° band)' }
const BAND = { low: 30, mid: 10, high: 2 }
const DEADS = { d0: 'No deadband', d4: 'Deadband ±4 µs', d10: 'Deadband ±10 µs' }
const DEAD_US = { d0: 0, d4: 4, d10: 10 }
const LOOP = { ms: 1000, dt: 0.001, slow: 10, stepS: 0.1, fromDeg: 90, stages: [5, 4, 4, 3.6], at: [-13, 0.4, 0] as V3 }
const loopParams = (p: Params) => {
  const us = n(p, 'pulse')
  const gain = pick(GAINS, p.gain, 'mid')
  const dead = pick(DEADS, p.dead, 'd10')
  return { us, gain, dead, target: servoAim(us, SERVO_SPECS.wide) }
}
type LoopQ = ReturnType<typeof loopParams>
const loopMemo = memoBy(
  (q: LoopQ) => `${q.us}|${q.gain}|${q.dead}`,
  (q: LoopQ) => servoLoopRun((t) => (t < LOOP.stepS ? LOOP.fromDeg : q.target), BAND[q.gain], DEAD_US[q.dead], LOOP.ms / 1000, LOOP.dt),
)
const potVolts = (d: number) => 3.3 * ((45 + d) / 270)

export const insideAHobbyServo: Lesson = {
  id: 'servo-inside-a-hobby-servo',
  title: 'Inside a hobby servo',
  tagline: 'Motor, gears, pot and a tiny P-controller',
  formula: (p) => {
    const q = loopParams(p)
    return `duty = (target − pot) / band, 0 inside ±deadband · target = ${deg0(q.target)}, band ${BAND[q.gain]}°, deadband ±${DEAD_US[q.dead]} µs = ±${usToDeg(DEAD_US[q.dead]).toFixed(1)}° · motor → ${SG90_LOOP.gear}:1 gears → horn`
  },
  legend: [
    { color: RING, label: 'Target from the pulse', shape: 'dot' },
    { color: POWER, label: 'Output angle (pot)', shape: 'dot' },
    { color: HEAT, label: 'Motor drive (H-bridge duty)', shape: 'dot' },
    { color: HIGH_V, label: 'Bridge switches on', shape: 'dot' },
  ],
  points: [
    'Open an SG90 (or its metal-geared big brother, the MG996R) and there are four parts: a small brushed DC motor, a train of spur gears (about 300:1 here) trading speed for torque, an output shaft, and a potentiometer screwed to the bottom of that shaft.',
    'The pot is the feedback: its wiper voltage says where the horn really is. A control chip turns the incoming pulse width into a target voltage and subtracts the two: that difference is the error.',
    'The error drives the motor through a tiny H-bridge (see Four switches): forward or reverse, with a duty in proportion to the error, flat out when it is bigger than the proportional band. That is a P-controller, the simplest closed loop.',
    'Too little gain and the horn creeps the last few degrees and gives way under load; too much and it overshoots and hunts round the target, drawing current all the time.',
    'Pot noise and the pulse jitter of a few µs would keep the motor twitching at rest, so the chip ignores errors inside a deadband (SG90: about ±5 µs). The price: the horn may stop up to that far from the exact target.',
  ],
  controls: [
    { kind: 'slider', key: 'pulse', label: 'Pulse', min: 600, max: 2400, step: 50, initial: 2100, format: (v) => `${v} µs` },
    { kind: 'choice', key: 'gain', options: opts(GAINS), initial: 'mid' },
    { kind: 'choice', key: 'dead', options: opts(DEADS), initial: 'd10' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    add(scene, mesh(new THREE.BoxGeometry(21, 13, 0.2), shellMat('#2a5bd7', 0.22)), [-7.4, -1.8, -2]).castShadow = false
    addLabel(scene, 'SG90, case cut open', [-12.6, -7.6, 0.4], GREY, 0.42)
    const motor = brushedMotor(scene, LOOP.at, 1.1)
    const train = gearTrain(scene, [LOOP.at[0], LOOP.at[1], LOOP.at[2] + motor.shaftTip[2]], LOOP.stages, { mod: 0.1, width: 0.45 })
    const outX = train.shafts[train.shafts.length - 1]
    addLabel(scene, 'motor', [LOOP.at[0], LOOP.at[1] - 2.6, 3.4], LABEL, 0.4)
    addLabel(scene, 'output + horn', [outX, LOOP.at[1] + 3.1, 3.4], LABEL, 0.4)

    const potAt: V3 = [outX, -5, 0]
    const pot = rotaryPot(scene, potAt, { scale: 0.8 })
    rod(scene, [outX, LOOP.at[1] - 0.2, 2], [outX, potAt[1] + 1.2, 2], 0.07, glowMat(GREY, 0.4))
    addLabel(scene, 'pot on the output shaft', [outX - 7, -3.2, 0.6], GREY, 0.36)
    const potTag = liveLabel(scene, [outX - 2.4, -5, 0.6], { size: 0.4, align: 'right' })

    const pcb = [4.2, -1.6, 0] as V3
    box(scene, [5.6, 6, 0.3], mat('#1d5b3a', { rough: 0.6 }), pcb)
    add(scene, icPackage(2, 1.8, 4), [pcb[0] - 1.1, pcb[1] + 1.3, 0.7])
    addLabel(scene, 'compare', [pcb[0] - 1.1, pcb[1] + 2.6, 0.9], LABEL, 0.32)
    const q4 = [
      [-0.55, 0.6],
      [-0.55, -0.6],
      [0.55, 0.6],
      [0.55, -0.6],
    ].map(([x, y], i) => {
      const g = glowBox(scene, [0.8, 0.8, 0.6], [pcb[0] + 1.4 + x, pcb[1] - 1 + y, 0.5], HIGH_V, 0.85)
      partLetter(scene, `Q${i + 1}`, [pcb[0] + 1.4 + x * 2.3, pcb[1] - 1 + y, 0.9], 0.28, GREY)
      return g
    })
    addLabel(scene, 'H-bridge', [pcb[0] + 1.4, pcb[1] - 2.4, 0.6], LABEL, 0.32)
    const [mp, mm] = motor.pins
    const top = pcb[1] + 3
    const legA: V3[] = [mp, [mp[0], 4.2, mp[2]], [pcb[0] + 1, 4.2, 0.4], [pcb[0] + 1, top, 0.4]]
    const legB: V3[] = [mm, [mm[0], mm[1] - 0.6, mm[2]], [-15.2, mm[1] - 0.6, mm[2]], [-15.2, 4.8, 0.4], [pcb[0] + 1.8, 4.8, 0.4], [pcb[0] + 1.8, top, 0.4]]
    for (const l of [legA, legB]) wire(scene, l, 0.1)
    const legs = [litWire(scene, legA, 0.16), litWire(scene, legB, 0.16)]
    wire(scene, [pot.pins.w, [pot.pins.w[0], -8.6, pot.pins.w[2]], [pcb[0] - 1.6, -8.6, 0.4], [pcb[0] - 1.6, pcb[1] - 3, 0.4]], 0.07)
    wire(scene, [[pcb[0] + 2.8, pcb[1] + 2, 0.3], [7.6, pcb[1] + 2, 0.3]], 0.08)
    addLabel(scene, 'pulse in', [7.6, pcb[1] + 2.7, 0.4], PIN_COLOR, 0.34)

    const plot = scope(scene, 7, 4.6, { divs: [5, 4] })
    plot.group.position.set(11.8, 2.4, 0)
    const yDeg = (dg: number) => (dg / 180 - 0.5) * plot.height
    const N = 250
    const tr = { tg: plot.trace(RING, { samples: N, radius: 0.06 }), deg: plot.trace(POWER, { samples: N, radius: 0.07 }), duty: plot.trace(HEAT, { samples: N, radius: 0.045 }) }
    const cur = cursorBar(plot, LABEL)
    addLabel(scene, `angle 0…180°, duty ±100 % · 0…${LOOP.ms} ms`, [11.8, -0.6, 0.3], GREY, 0.28)
    const errTag = liveLabel(scene, [11.8, -1.9, 0.3], { size: 0.38 })
    const note = liveLabel(scene, [11.8, -3, 0.3], { size: 0.38 })
    const result = liveLabel(scene, [11.8, -4.1, 0.3], { size: 0.38 })

    const clock = simClock(LOOP.slow / 1000, 2)
    const st = { t: 0, key: '', motor: 0, last: 0 }
    return {
      scene,
      view: { center: [0, 0, 0], radius: 66, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = loopParams(p)
        const run = loopMemo(q)
        const key = `${q.us}|${q.gain}|${q.dead}`
        const t = clock(dt, key, LOOP.ms) / 1000
        st.t = t
        if (key !== st.key) {
          st.key = key
          const pts = run.filter((_, i) => i % 4 === 0)
          const us = pts.map((f) => f.t / (LOOP.ms / 1000))
          tr.tg.points(us, pts.map((f) => yDeg(f.target)))
          tr.deg.points(us, pts.map((f) => yDeg(f.deg)))
          tr.duty.points(us, pts.map((f) => f.duty * 0.45 * plot.height))
        }
        cur(t / (LOOP.ms / 1000))
        const f = fixedStepAt(run, t, LOOP.dt)
        train.set(f.deg * DEG * SG90_LOOP.gear)
        st.motor += (dt * f.duty * 25) / LOOP.slow
        motor.set(st.motor, Math.abs(f.duty))
        for (const l of legs) l.set(Math.min(1, 0.15 + Math.abs(f.duty)), lit(HEAT))
        const on = f.duty > 0 ? [0, 3] : f.duty < 0 ? [1, 2] : []
        q4.forEach((g, i) => (g.m.opacity = on.includes(i) ? 0.2 + 0.7 * Math.abs(f.duty) : 0.06))
        pot.set((45 + f.deg) / 270, (s) => s)
        potTag.set(`wiper ${potVolts(f.deg).toFixed(2)} V = ${deg0(f.deg)}`, POWER)
        const err = f.target - f.deg
        errTag.set(`error ${err >= 0 ? '+' : ''}${err.toFixed(1)}° → duty ${pct(f.duty)}`, f.duty ? HEAT : GREY)
        note.set(t < LOOP.stepS ? 'Holding 90°' : f.duty === 0 ? 'Inside the deadband: motor off' : Math.abs(f.duty) >= 1 ? 'Error past the band: full drive' : 'Duty ∝ error: easing in', f.duty === 0 ? POWER : HEAT)
        const settle = servoSettleS(run)
        result.set(
          settle === null ? 'Hunting: never settles' : `Settles in ${msText(settle - LOOP.stepS)}, overshoot ${overshootDeg(run).toFixed(1)}°`,
          settle === null ? HIGH_V : overshootDeg(run) > 5 ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const q = loopParams(p)
        const f = fixedStepAt(loopMemo(q), st.t, LOOP.dt)
        const idle = loopMemo(q).filter((x) => x.t > 0.7)
        const twitchy = Math.max(...idle.map((x) => x.amps)) > 0.05
        return [
          { label: 'Sim time', value: `${msText(st.t)} (${LOOP.slow}× slower)` },
          { label: 'Angle', value: `${deg0(f.deg)} → ${deg0(f.target)}` },
          { label: 'Duty', value: pct(f.duty), tone: Math.abs(f.duty) >= 1 ? 'warn' : 'ok' },
          { label: 'Current', value: `${f.amps.toFixed(2)} A`, tone: twitchy && st.t > 0.7 ? 'bad' : f.amps > 0.4 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Jitter and power: servos starting together sag a shared rail and lift its ground; jitter and lost pulses twitch the rest. ---

const WIRING = { shared: 'Shared USB 5 V, breadboard', separate: 'Separate 6 V pack, star ground' }
const CAPS = { c0: 'No bulk cap', c470: '470 µF bulk cap', c2200: '2200 µF bulk cap' }
const CAP_F = { c0: 0, c470: 470e-6, c2200: 2200e-6 }
const SIGNAL = { ledc: 'LEDC hardware PWM', soft: 'Software PWM + Wi-Fi IRQs' }
const JP = { ms: 400, dt: 0.0002, slow: 25, maxV: 6.5, maxA: 3, servoX: [-3.6, 1.2, 6, 10.8], servoY: 2.6, k: 1.1, startS: 0.06 + RAIL.startDelayS }
const jitterParams = (p: Params) => ({
  moving: Math.round(n(p, 'moving')),
  wiring: pick(WIRING, p.wiring, 'shared') as Wiring,
  cap: pick(CAPS, p.cap, 'c0'),
  src: pick(SIGNAL, p.signal, 'ledc') as PwmSource,
})
type JitterQ = ReturnType<typeof jitterParams>
const jitterKey = (q: JitterQ) => `${q.moving}|${q.wiring}|${q.cap}|${q.src}`
const railMemo = memoBy(jitterKey, (q: JitterQ) => servoRailRun(q.moving, q.wiring, CAP_F[q.cap], q.src, JP.ms / 1000, JP.dt))

export const jitterAndPower: Lesson = {
  id: 'servo-jitter-and-power',
  title: 'Jitter and power',
  tagline: 'Stall spikes, ground bounce and twitching',
  formula: (p) => {
    const q = jitterParams(p)
    const s = railSummary(railMemo(q))
    const r = RAIL[q.wiring]
    return `rail = ${r.volts} V − I·${r.rSrc} Ω → ${s.minRail.toFixed(2)} V at ${s.peakA.toFixed(1)} A · 3V3 ≥ ${ESP32_BOD[0]} V or reset · pulse lost when 3.3 − I·${r.rGnd} Ω < ${RAIL.vih} V`
  },
  legend: [
    { color: POWER, label: 'Servo rail', shape: 'dot' },
    { color: B_FIELD, label: 'ESP32 3V3', shape: 'dot' },
    { color: HEAT, label: 'Servo current', shape: 'dot' },
    { color: RING, label: 'Twitch: jitter', shape: 'dot' },
    { color: HIGH_V, label: 'Twitch: lost pulse / reset', shape: 'dot' },
  ],
  points: [
    'Every servo that starts to move is a stalled DC motor for a few milliseconds: an SG90 pulls about 0.7 A, an MG996R 2.5 A. Four starting together on the same frame want 2.8 A from a USB port and breadboard wiring.',
    'The rail sags by I·R. The ESP32 hangs off that rail through an AMS1117 (≈1 V dropout), so its 3V3 falls too: below 3.0 V flash is out of spec, below 2.43 V the brownout detector resets it and every servo goes limp.',
    'The return current also lifts the servos\' ground above the ESP32\'s (ground bounce). The servo sees a 3.3 V pulse minus that offset; if it falls below its input threshold the edge is lost and the holding servos twitch.',
    'Noisy PWM twitches them on any supply: bit-banged pulses delayed by Wi-Fi interrupts wander by several µs, more than the ±5 µs deadband. Use the hardware LEDC timer.',
    'Fixes: power servos from their own pack or BEC (5–6 V, a few amps), join grounds at one point, and put a 470–2200 µF electrolytic across the servo rail at the servos to supply the spikes locally. Staggering moves helps too.',
  ],
  controls: [
    { kind: 'slider', key: 'moving', label: 'Servos starting', min: 1, max: 4, step: 1, initial: 2, format: (v) => `${v} of 4` },
    { kind: 'choice', key: 'wiring', options: opts(WIRING), initial: 'shared' },
    { kind: 'choice', key: 'cap', options: opts(CAPS), initial: 'c0' },
    { kind: 'choice', key: 'signal', options: opts(SIGNAL), initial: 'ledc' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const espAt: V3 = [-11.6, 2.8, 0]
    esp32Board(scene, espAt, 0.36)
    const resetTag = liveLabel(scene, [espAt[0], espAt[1] + 2.6, 0.6], { size: 0.45 })
    const v33Tag = liveLabel(scene, [espAt[0], espAt[1] - 2.6, 0.6], { size: 0.38 })
    box(scene, [1.4, 1, 0.8], mat('#c4c9d1', { metal: 0.4, rough: 0.35 }), [espAt[0] - 4.6, espAt[1], 0])
    addLabel(scene, 'USB', [espAt[0] - 4.6, espAt[1] + 1, 0.6], LABEL, 0.34)
    wire(scene, [[espAt[0] - 3.9, espAt[1], 0], [espAt[0] - 3, espAt[1], 0]], 0.16)

    const railY = -0.6
    const gndY = -1.5
    const busX: [number, number] = [-7, 13]
    wire(scene, [[busX[0], railY, 0.3], [busX[1], railY, 0.3]], 0.12)
    wire(scene, [[busX[0], gndY, 0.3], [busX[1], gndY, 0.3]], 0.12)
    const rail = litWire(scene, [[busX[0], railY, 0.3], [busX[1], railY, 0.3]], 0.18)
    const gndGlow = litWire(scene, [[busX[0], gndY, 0.3], [busX[1], gndY, 0.3]], 0.18)
    addLabel(scene, '+', [busX[0] - 0.5, railY, 0.3], HIGH_V, 0.45)
    addLabel(scene, '−', [busX[0] - 0.5, gndY, 0.3], LOW_V, 0.45)
    const shared = add(scene, new THREE.Group())
    wire(shared, [[espAt[0] + 1.6, espAt[1] - 1.9, 0.3], [espAt[0] + 1.6, railY, 0.3], [busX[0], railY, 0.3]], 0.12)
    wire(shared, [[espAt[0] + 2.4, espAt[1] - 1.9, 0.3], [espAt[0] + 2.4, gndY, 0.3], [busX[0], gndY, 0.3]], 0.12)
    addLabel(shared, 'breadboard rails', [espAt[0] + 2, -2.4, 0.3], GREY, 0.32)
    const pack = add(scene, new THREE.Group())
    for (let i = 0; i < 4; i++) box(pack, [2.6, 0.8, 0.8], mat(i % 2 ? '#2c2d33' : '#3a3c44', { rough: 0.5 }), [-13.4, -3.2 - i * 0.85, 0])
    addLabel(pack, '6 V pack', [-13.4, -6.6, 0.6], LABEL, 0.34)
    wire(pack, [[-12.1, -3, 0.3], [-11.2, -3, 0.3], [-11.2, railY, 0.3], [busX[0], railY, 0.3]], 0.1)
    wire(pack, [[-12.1, -5.6, 0.3], [-10.4, -5.6, 0.3], [-10.4, gndY, 0.3], [busX[0], gndY, 0.3]], 0.1)
    const star = add(scene, new THREE.Group())
    wire(star, [[espAt[0] + 2.4, espAt[1] - 1.9, 0.3], [espAt[0] + 2.4, gndY, 0.3], [busX[0], gndY, 0.3]], 0.06)
    addLabel(star, 'star ground', [-7.4, -3.1, 0.3], GREY, 0.32)
    wire(scene, [[espAt[0] + 0.8, espAt[1] + 1.9, 0.3], [espAt[0] + 0.8, 5.4, 0.3], [JP.servoX[3] - 0.8, 5.4, 0.3]], 0.07)

    const cap = add(scene, buildElectrolyticCap(), [-6.4, railY + 0.3, 1])
    cap.scale.setScalar(0.5)
    const capTag = liveLabel(scene, [-6.4, gndY - 0.8, 0.6], { size: 0.32 })

    const servos = JP.servoX.map((x, i) => {
      const holder = add(scene, new THREE.Group(), [x, JP.servoY, 0])
      holder.scale.setScalar(JP.k)
      const horn = sg90Servo(holder, [0, 0, 0])
      wire(scene, [[x + 1, railY, 0.3], [x + 1, JP.servoY - 0.9, 0.3]], 0.07)
      wire(scene, [[x + 1.6, gndY, 0.3], [x + 1.6, JP.servoY - 0.9, 0.3]], 0.07)
      wire(scene, [[x - 0.8, 5.4, 0.3], [x - 0.8, JP.servoY + 1, 0.3]], 0.05)
      const halo = glowHalo(scene, [x - 0.8, JP.servoY + 1.6, 1.6], 0.4)
      const tag = liveLabel(scene, [x, JP.servoY - 1.6, 0.6], { size: 0.32 })
      partLetter(scene, `S${i + 1}`, [x + 1.4, JP.servoY + 1.4, 0.6], 0.36, GREY)
      return { horn, halo, tag, deg: 90 }
    })

    const plot = scope(scene, 13, 3.6, { divs: [8, 4], zeroAt: 0 })
    plot.group.position.set(-0.6, -5, 0)
    const yV = (v: number) => (v / JP.maxV - 0.5) * plot.height
    const N = 400
    const tr = { rail: plot.trace(POWER, { samples: N, radius: 0.06 }), v33: plot.trace(B_FIELD, { samples: N, radius: 0.06 }), a: plot.trace(HEAT, { samples: N, radius: 0.045 }) }
    plot.level(HIGH_V).set(yV(ESP32_BOD[0]))
    const cur = cursorBar(plot, LABEL)
    addLabel(scene, `V 0…${JP.maxV}, I 0…${JP.maxA} A · 0…${JP.ms} ms · dashed = brownout`, [-0.6, -7.4, 0.3], GREY, 0.3)
    const result = liveLabel(scene, [7, -4.4, 0.3], { size: 0.38, align: 'left' })
    const result2 = liveLabel(scene, [7, -5.5, 0.3], { size: 0.38, align: 'left' })

    const clock = simClock(JP.slow / 1000, 2)
    const st = { t: 0, key: '' }
    return {
      scene,
      view: { center: [-1.6, -0.6, 0], radius: 57, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = jitterParams(p)
        const run = railMemo(q)
        const key = jitterKey(q)
        const t = clock(dt, key, JP.ms) / 1000
        st.t = t
        const sum = railSummary(run)
        if (key !== st.key) {
          st.key = key
          const pts = run.frames.filter((_, i) => i % 5 === 0)
          const us = pts.map((f) => f.t / (JP.ms / 1000))
          tr.rail.points(us, pts.map((f) => yV(f.railV)))
          tr.v33.points(us, pts.map((f) => yV(f.logicV)))
          tr.a.points(us, pts.map((f) => yV((f.amps / JP.maxA) * JP.maxV)))
          shared.visible = q.wiring === 'shared'
          pack.visible = star.visible = q.wiring === 'separate'
          cap.visible = q.cap !== 'c0'
          capTag.set(q.cap === 'c0' ? '' : CAPS[q.cap].replace(' bulk cap', ''), LABEL)
        }
        cur(t / (JP.ms / 1000))
        const f = fixedStepAt(run.frames, t, JP.dt)
        const sag = (RAIL[q.wiring].volts - f.railV) / RAIL[q.wiring].volts
        rail.set(0.3 + 0.7 * Math.min(1, f.amps / 2), lit(sag > 0.2 ? HIGH_V : sag > 0.1 ? HEAT : POWER))
        gndGlow.set(Math.min(1, f.gndV * 1.2), lit(LOW_V))
        const down = sum.resetAt !== null && t >= sum.resetAt
        servos.forEach((s, i) => {
          const moving = i < q.moving && t >= JP.startS
          if (!down) s.deg = moving ? 45 + Math.min(90, (t - JP.startS) * SERVO_DEG_PER_S) : i < q.moving ? 45 : 90
          const tw = run.twitches.filter((x) => x.servo === i && x.t <= t && t - x.t < 0.03).pop()
          const wob = tw ? 6 * Math.sin(((t - tw.t) / 0.03) * Math.PI * 3) * (1 - (t - tw.t) / 0.03) : 0
          s.horn.rotation.z = (s.deg + wob - 90) * DEG
          s.halo.set(tw ? 1 : down ? 0.6 : 0, tw?.lost || down ? HIGH_V : RING)
          s.tag.set(down ? 'limp' : moving && s.deg < 135 ? 'moving' : tw ? (tw.lost ? 'lost pulse' : 'jitter') : 'holding', down || tw?.lost ? HIGH_V : tw ? RING : moving && s.deg < 135 ? HEAT : GREY)
        })
        resetTag.set(down ? 'BROWNOUT RESET' : '', HIGH_V)
        v33Tag.set(`3V3 ${f.logicV.toFixed(2)} V`, f.logicV < ESP32_BOD[0] ? HIGH_V : f.logicV < ESP32_MIN_V ? HEAT : B_FIELD)
        result.set(sum.resetAt !== null ? `ESP32 reset at ${msText(sum.resetAt)}` : `3V3 min ${sum.minLogic.toFixed(2)} V`, sum.resetAt !== null ? HIGH_V : sum.minLogic < ESP32_MIN_V ? HEAT : POWER)
        const lost = run.twitches.filter((x) => x.lost).length
        result2.set(sum.twitches ? `${sum.twitches} twitches${lost ? `, ${lost} lost pulses` : ''}` : 'No twitches', sum.twitches ? (lost ? HIGH_V : RING) : POWER)
      },
      readouts: (p) => {
        const q = jitterParams(p)
        const run = railMemo(q)
        const s = railSummary(run)
        const f = fixedStepAt(run.frames, st.t, JP.dt)
        return [
          { label: 'Sim time', value: `${msText(st.t)} (${JP.slow}× slower)` },
          { label: 'Servo rail', value: `${f.railV.toFixed(2)} V (min ${s.minRail.toFixed(2)})`, tone: s.minRail < 4 ? 'bad' : s.minRail < 4.5 ? 'warn' : 'ok' },
          { label: 'ESP32 3V3', value: `min ${s.minLogic.toFixed(2)} V`, tone: s.minLogic < ESP32_BOD[0] ? 'bad' : s.minLogic < ESP32_MIN_V ? 'warn' : 'ok' },
          { label: 'Twitches', value: `${s.twitches}`, tone: s.twitches ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
