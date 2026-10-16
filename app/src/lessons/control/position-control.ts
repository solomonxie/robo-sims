import { CAR_MOVE, Move, PosFrame, fixedStepAt, moveStats, positionRun, sCurveMove, stepMove, trapezoidMove, G } from '../../core/physics'
import { pct, mmTenths, secsText } from '../../core/units'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, FORCE, GREY, HEAT, HIGH_V, LABEL, POWER, RING, SIDE_SCOPE, controlLoop, memoBy, positionCar, scope, scopeLabels, statusHeader, traceRun, lapseClock, sideScope } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const VIEW = { center: [-2.2, -1.3, 0] as V3, radius: 54, polar: 1.45, azimuth: 0 }
const DIAG = { at: [SIDE_SCOPE.x, 2.4, 0] as V3, w: 12.5, h: 3.6 }
const SCOPE = { y: -4.6, h: 5 }
const RIG = { at: [-17, -2.6, 0] as V3, k: 16, slow: 0.5, rest: 0.6, exag: 5 }
const D = 0.8
const START = 0.3
const SECONDS = 4
const dtL = 0.01
/** Rubber on tile, ~70 % of the weight on the driven wheels: μ·g·share. */
const GRIP = 0.8 * G * 0.7
const VL = CAR_MOVE.vLimit
const mps = (v: number) => `${v.toFixed(2)} m/s`

type Trace = ReturnType<ReturnType<typeof scope>['trace']>
type Lower = [string, (f: PosFrame) => number, number]

/** Car rig, cascade loop diagram, scope (position 0…D on top, signed `lower` traces ±1 on the bottom). */
function posStage(lower: Lower[], bottom: string, exag = RIG.exag) {
  const scene = createStage({ span: 40 })
  const head = statusHeader(scene)
  const car = positionCar(scene, RIG.at, RIG.k, D, exag)
  const loop = controlLoop(scene, DIAG.at, { ctrl: 'P → FF + PI', plant: 'motor + car', sensor: 'encoder', w: DIAG.w, h: DIAG.h })
  const plot = sideScope(scene, SCOPE.y, SCOPE.h, { divs: [8, 4], zeroAt: 0.25 })
  const lowTr = lower.map(([c, f, r]) => [plot.trace(c, { samples: 300, radius: 0.04 }), f, r] as const)
  const refTr = plot.trace(B_FIELD, { samples: 300, radius: 0.05 })
  const xTr = plot.trace(RING, { samples: 300, radius: 0.07 })
  scopeLabels(scene, SCOPE.y, SCOPE.h, SECONDS, `position 0…${D} m`, bottom)
  const yPos = (v: number) => (Math.max(-0.02, Math.min(D * 1.08, v)) / D) * (SCOPE.h / 2) * 0.9
  const yLow = (v: number) => -SCOPE.h / 4 + Math.max(-1.1, Math.min(1.1, v)) * (SCOPE.h / 4) * 0.9
  const draw = (tr: Trace, run: PosFrame[], t: number, v: (f: PosFrame) => number) => traceRun(tr, run, dtL, SECONDS, t, v, 300)
  return {
    scene,
    ...head,
    clock: lapseClock(SECONDS, RIG.slow, RIG.rest),
    show(dt: number, run: PosFrame[], t: number) {
      const f = fixedStepAt(run, t, dtL)
      draw(refTr, run, t, (g) => yPos(g.ref))
      draw(xTr, run, t, (g) => yPos(g.x))
      for (const [tr, v, r] of lowTr) draw(tr, run, t, (g) => yLow(v(g) / r))
      car.set(f.x, f.ref, f.rev, f.sway, f.u)
      const e = f.ref - f.meas
      loop.set(
        dt,
        { r: f.ref / D, e: Math.min(1, Math.abs(e) / 0.02), u: f.u, y: f.x / D, m: f.meas / D },
        { r: `x_ref ${mmTenths(f.ref)}`, e: `e ${mmTenths(e)}`, u: `u ${pct(f.u)}`, y: mmTenths(f.x), m: mmTenths(f.meas) },
      )
      return f
    },
    sub(t: number) {
      head.sub.set(`${t.toFixed(2)} / ${SECONDS} s · slowed ${1 / RIG.slow}× · loop 100 Hz · mast bend drawn ${exag}×`)
    },
  }
}

const statsOf = (move: Move, extra: Partial<Parameters<typeof positionRun>[0]> = {}) => {
  const cfg = { move, start: START, seconds: SECONDS, ...extra }
  const run = positionRun(cfg)
  return { run, s: moveStats(run, cfg), peakU: Math.max(...run.map((f) => Math.abs(f.u))) }
}
const phaseOf = (f: PosFrame, move: Move) => {
  const t = f.t - START
  if (t < 0) return 'waiting'
  if (move.kind === 'step' || t >= move.T) return Math.abs(f.x - D) < 0.002 ? 'holding the mark' : 'closing in'
  if (f.refA > 1e-6) return 'speeding up'
  if (f.refA < -1e-6) return 'braking'
  return 'cruising'
}

// --- Trapezoid profile: plan the move (accelerate, cruise, brake) instead of jumping the target. ---

const TP_MODES = { step: 'Step to the target', trap: 'Trapezoid profile' }
const tpParams = (p: Params) => ({ mode: pick(TP_MODES, p.mode, 'trap'), v: n(p, 'vmax'), a: n(p, 'amax') })
type TpQ = ReturnType<typeof tpParams>
const tpKey = (q: TpQ) => `${q.mode}|${q.v}|${q.a}`
const tpMove = (q: TpQ) => (q.mode === 'step' ? stepMove(D) : trapezoidMove(D, q.v, q.a))
const tpRun = memoBy(tpKey, (q: TpQ) => ({ move: tpMove(q), ...statsOf(tpMove(q)) }))

export const trapezoidProfile: Lesson = {
  id: 'position-control-trapezoid-profile',
  title: 'Trapezoid profile',
  tagline: 'Accelerate, cruise, brake',
  formula: (p) => {
    const q = tpParams(p)
    if (q.mode === 'step') return `x_ref = ${D} m at once → v_cmd = Kpos·e = ${CAR_MOVE.kpos}/s × ${D} m, clipped at ${mps(VL)}: full duty, no plan`
    const m = tpMove(q)
    const tri = m.vPeak < q.v - 1e-9
    return `t_a = v/a = ${(m.vPeak / q.a).toFixed(2)} s · T = D/v + v/a = ${m.T.toFixed(2)} s${tri ? ` · D < v²/a → triangle, v_peak = √(a·D) = ${mps(m.vPeak)}` : ` · cruise ${(m.T - (2 * m.vPeak) / q.a).toFixed(2)} s`} · v_cmd = v_ref + ${CAR_MOVE.kpos}/s·(x_ref − x_enc)`
  },
  legend: [
    { color: RING, label: `Car position (scope top 0…${D} m)`, shape: 'dot' },
    { color: B_FIELD, label: 'Setpoint from the profile', shape: 'dot' },
    { color: FORCE, label: `Car speed (scope bottom ±${VL.toFixed(1)} m/s)`, shape: 'dot' },
    { color: POWER, label: 'Motor duty u (±100 %)', shape: 'dot' },
  ],
  points: [
    `Drive the TT car ${D} m and stop on the mark. Jump the setpoint straight to the target and the position loop asks for full speed at once: the motor gets 100 %, the car lunges at about 12 m/s², more than the tyres can grip, and the camera mast whips. Nothing decides how fast it travels.`,
    'A motion profile plans the move first: accelerate at a, cruise at v, brake at a. Speed against time is a trapezoid, position an S. The setpoint now glides to the target and the loop only has to follow it, a few millimetres behind.',
    'Move time is T = D/v + v/a. If the move is too short to reach v (D < v²/a), the cruise vanishes and the trapezoid becomes a triangle. Asking for a speed near the motor top (about 1 m/s) leaves no headroom: the duty clips and the car falls behind the plan.',
    'The profile feeds a cascade: v_ref plus Kpos × position error becomes the speed command for the wheel loop from Speed control (feed-forward + PI on encoder counts), and a_ref feeds the kA part of the feed-forward.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(TP_MODES), initial: 'trap' },
    { kind: 'slider', key: 'vmax', label: 'Max speed v', min: 0.3, max: 1, step: 0.05, initial: 0.6, format: (v) => mps(v) },
    { kind: 'slider', key: 'amax', label: 'Max acceleration a', min: 0.5, max: 6, step: 0.25, initial: 2, format: (v) => `${v.toFixed(2)} m/s²` },
  ],
  build(): Stage {
    const s = posStage(
      [
        [B_FIELD, (f) => f.refV, VL],
        [FORCE, (f) => f.v, VL],
        [POWER, (f) => f.u, 1],
      ],
      'speed · duty',
    )
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = tpParams(p)
        const { run, move } = tpRun(q)
        const t = s.clock(dt, tpKey(q))
        const f = s.show(dt, run, t)
        s.status.set(`Trapezoid profile · ${q.mode === 'step' ? 'step to the target' : `v ${mps(q.v)} · a ${q.a.toFixed(2)} m/s²`}`, LABEL)
        const ph = phaseOf(f, move)
        const lag = f.ref - f.x
        if (ph === 'waiting') s.event.set(`at rest: target ${D} m ahead`, GREY)
        else if (Math.abs(f.u) > 0.999) s.event.set(`${ph}: duty clipped at ${pct(f.u)}, ${mps(f.v)} · ${move.kind === 'step' ? `${mmTenths(D - f.x)} to go` : `${mmTenths(lag)} behind the plan`}`, HIGH_V)
        else if (ph === 'holding the mark') s.event.set(`holding the mark: ${mmTenths(f.x - D)} off · duty ${pct(f.u)}`, RING)
        else if (move.kind === 'step') s.event.set(`${ph}: ${mps(f.v)}, ${mmTenths(D - f.x)} to go · duty ${pct(f.u)}`, HEAT)
        else s.event.set(`${ph}: ${mps(f.v)}, ${mmTenths(Math.abs(lag))} ${lag >= 0 ? 'behind' : 'ahead of'} the plan · duty ${pct(f.u)}`, Math.abs(lag) > 0.01 ? HEAT : FORCE)
        s.sub(t)
      },
      readouts: (p) => {
        const { s: m, move, peakU } = tpRun(tpParams(p))
        return [
          { label: 'Move time (to ±2 mm)', value: secsText(m.settle), tone: m.settle === null ? 'bad' : 'ok' },
          { label: `Peak accel (tyre grip ≈ ${GRIP.toFixed(1)} m/s²)`, value: `${m.peakAcc.toFixed(1)} m/s²`, tone: m.peakAcc > GRIP ? 'bad' : m.peakAcc > 0.7 * GRIP ? 'warn' : 'ok' },
          { label: 'Worst lag behind the plan', value: move.kind === 'step' ? 'no plan' : mmTenths(m.track), tone: move.kind === 'step' ? 'bad' : m.track > 0.01 ? 'warn' : 'ok' },
          { label: 'Peak duty', value: pct(peakU), tone: peakU > 0.999 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- S-curve: limit jerk so the acceleration ramps in; tune the ramp to the mast's period and the wobble cancels. ---

const SC_MODES = { trap: 'Trapezoid (jerk unlimited)', scurve: 'S-curve (jerk limited)' }
const SC = { v: 0.8, a: 1.5, exag: 8 }
const scParams = (p: Params) => ({ mode: pick(SC_MODES, p.mode, 'scurve'), tj: n(p, 'tj') / 1000, hz: n(p, 'hz') })
type ScQ = ReturnType<typeof scParams>
const scKey = (q: ScQ) => `${q.mode}|${q.tj}|${q.hz}`
const scMove = (q: ScQ) => (q.mode === 'trap' ? trapezoidMove(D, SC.v, SC.a) : sCurveMove(D, SC.v, SC.a, SC.a / q.tj))
const scRun = memoBy(scKey, (q: ScQ) => ({ move: scMove(q), ...statsOf(scMove(q), { mastHz: q.hz }) }))
const SWAY_RANGE = 0.015

export const sCurve: Lesson = {
  id: 'position-control-s-curve',
  title: 'S-curve',
  tagline: 'Ramp the acceleration, not just the speed',
  formula: (p) => {
    const q = scParams(p)
    const m = scMove(q)
    const head = q.mode === 'trap' ? `a jumps 0 → ${SC.a} m/s² in one step (jerk ∞)` : `jerk J = a/t_j = ${SC.a} / ${(q.tj * 1000).toFixed(0)} ms = ${(SC.a / q.tj).toFixed(1)} m/s³`
    return `${head} · T = ${m.T.toFixed(2)} s · mast ${q.hz.toFixed(2)} Hz → period ${((1 / q.hz) * 1000).toFixed(0)} ms${q.mode === 'trap' ? ` · accel lasts ${((SC.v / SC.a) * 1000).toFixed(0)} ms` : ''}`
  },
  legend: [
    { color: RING, label: `Car position (scope top 0…${D} m)`, shape: 'dot' },
    { color: B_FIELD, label: `Profile accel (scope bottom ±${SC.a * 2} m/s²)`, shape: 'dot' },
    { color: FORCE, label: `Camera sway (±${SWAY_RANGE * 1000} mm)`, shape: 'dot' },
    { color: POWER, label: 'Motor duty u (±100 %)', shape: 'dot' },
  ],
  points: [
    'In a trapezoid the acceleration jumps from zero to full in an instant: infinite jerk. Anything springy on the robot gets a kick. Here a camera on an 18 cm mast bends back, then rings at its own frequency, and keeps wobbling after the car has stopped: blurred frames, a missed grasp.',
    'An S-curve limits jerk: the acceleration ramps in and out over a jerk time t_j, giving seven segments instead of three. Speed now has rounded corners, and the move costs about t_j more.',
    'The trick is to match the ramp to the mast. A ramp lasting exactly one oscillation period (t_j = 1/f) pushes evenly through a whole swing, so the mast is left still. Set the jerk time to the period shown in the formula and the leftover wobble nearly vanishes; a much shorter ramp acts like a trapezoid.',
    'A trapezoid can get lucky if its acceleration lasts a whole number of periods, but only for that one move and that one mast. 3D printers (input shaping), CNC machines, lifts and robot arms all limit jerk; it also spares gears from backlash knocks and tyres from slipping.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(SC_MODES), initial: 'scurve' },
    { kind: 'slider', key: 'tj', label: 'Jerk time t_j', min: 50, max: 500, step: 10, initial: 360, format: (v) => `${v} ms` },
    { kind: 'slider', key: 'hz', label: 'Mast frequency', min: 1.5, max: 4, step: 0.25, initial: 2.75, format: (v) => `${v.toFixed(2)} Hz` },
  ],
  build(): Stage {
    const s = posStage(
      [
        [POWER, (f) => f.u, 1],
        [B_FIELD, (f) => f.refA, SC.a * 2],
        [FORCE, (f) => f.sway, SWAY_RANGE],
      ],
      'accel · sway · duty',
      SC.exag,
    )
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = scParams(p)
        const { run, move } = scRun(q)
        const t = s.clock(dt, scKey(q))
        const f = s.show(dt, run, t)
        s.status.set(`S-curve · ${q.mode === 'trap' ? 'trapezoid' : `jerk time ${(q.tj * 1000).toFixed(0)} ms`} · mast ${q.hz.toFixed(2)} Hz`, LABEL)
        const ph = phaseOf(f, move)
        const sw = `camera ${mmTenths(Math.abs(f.sway))} ${f.sway >= 0 ? 'back' : 'forward'}`
        if (ph === 'waiting') s.event.set(`at rest: target ${D} m ahead`, GREY)
        else if (f.t > START + move.T) s.event.set(`stopped · ${sw}${Math.abs(f.sway) > 0.002 ? ': still ringing' : ''}`, Math.abs(f.sway) > 0.002 ? HIGH_V : RING)
        else s.event.set(`${ph}: accel ${f.refA.toFixed(2)} m/s² · ${sw}`, Math.abs(f.sway) > 0.008 ? HEAT : FORCE)
        s.sub(t)
      },
      readouts: (p) => {
        const q = scParams(p)
        const { s: m, move } = scRun(q)
        return [
          { label: 'Profile time', value: secsText(move.T) },
          { label: 'Peak camera sway', value: mmTenths(m.peakSway), tone: m.peakSway > 0.008 ? 'warn' : 'ok' },
          { label: 'Wobble left after the stop', value: mmTenths(m.residual), tone: m.residual > 0.003 ? 'bad' : m.residual > 0.001 ? 'warn' : 'ok' },
          { label: 'Jerk time vs mast period', value: q.mode === 'trap' ? '0 ms (step)' : `${(q.tj * q.hz).toFixed(2)} periods` },
        ]
      },
    }
  },
}
