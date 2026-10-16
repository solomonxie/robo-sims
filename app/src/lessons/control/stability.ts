import { ARM, ArmFrame, Cx, Gains, armPoles, armRun, dominant, fixedStepAt, loopAt, margins, placePd, secondOrder, secondOrderAt, stepMetrics, swing } from '../../core/physics'
import { pct } from '../../core/units'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, DATA_COLOR, FORCE, GREY, HEAT, HIGH_V, LABEL, POWER, RING, SIDE_SCOPE, addLabel, addRod, glowMat, liveLabel, memoBy, pidArm, scope, scopeLabels, sPlane, statusHeader, stretchRod, termBars, traceRun } from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const VIEW = { center: [-2.2, -1.3, 0] as V3, radius: 54, polar: 1.45, azimuth: 0 }
const TOP = { y: 1.2, h: 6 }
const SCOPE = { y: -6.3, h: 4 }
const RIG = { at: [-11.6, 1.3, 0] as V3, len: 5.2, bars: [-11.2, -6.5, 0] as V3, rest: 1.2 }
const ST = { from: 30, target: 40, seconds: 2.5, slow: 0.4, lo: 25, hi: 50 }
const FROM = Math.round(ARM.stepAt / ARM.dt)
const SPLANE = { per: 5, re: [-35, 10] as const, im: 15 }
const deg = (d: number, digits = 1) => `${d.toFixed(digits)}°`
const secs = (s: number | null) => (s === null || !Number.isFinite(s) ? '—' : `${s.toFixed(2)} s`)
const kpText = (kp: number) => `${(kp * 100).toFixed(2)} %/°`
const kdText = (kd: number) => `${(kd * 100).toFixed(2)} %/(°/s)`
const poleText = (p: Cx) => (p.im > 0.01 ? `${p.re.toFixed(1)} ± ${p.im.toFixed(1)}j /s` : `${p.re.toFixed(1)} /s`)
const gainsKey = (g: Gains, lag: number) => `${g.kp}|${g.kd}|${lag}`
const swingText = (r: number | undefined) => (r === undefined ? 'no swing left' : r < 0.9 ? `dies out (×${r.toFixed(2)} per cycle)` : r < 1.02 ? 'sustained' : `grows (×${r.toFixed(2)} per cycle)`)

/** 30 → 40° step with spring + gravity feed-forward, PD on measurement; `lag` s of pot delay. */
const stepRun = memoBy(
  ({ g, lag }: { g: Gains; lag: number }) => gainsKey(g, lag),
  ({ g, lag }: { g: Gains; lag: number }) => {
    const run = armRun({ pid: { ...g, limit: 2, dOnMeas: true }, from: ST.from, target: ST.target, ff: true, lag, seconds: ST.seconds })
    const th = run.map((f) => f.th)
    return { run, m: stepMetrics(th, ARM.dt, FROM, ST.from, ST.target), sw: swing(th, ARM.dt, FROM), clipped: run.some((f) => Math.abs(f.u) >= 0.999) }
  },
)

/** Arm rig and term bars left, a top screen (s-plane or Bode) and a step scope right. */
function stabStage(top: 'splane' | 'bode') {
  const scene = createStage({ span: 40 })
  const head = statusHeader(scene)
  const arm = pidArm(scene, RIG.at, RIG.len)
  const bars = termBars(scene, RIG.bars, 7)
  const plane = top === 'splane' ? sPlane(scene, [SIDE_SCOPE.x, TOP.y, 0], SPLANE.per, SPLANE.re[0], SPLANE.re[1], SPLANE.im) : null
  const offTag = plane ? liveLabel(plane.group, [-plane.w / 2 + 0.25, -plane.h / 2 + 0.35, 0.35], { size: 0.24, color: GREY, align: 'left' }) : null
  const plot = scope(scene, SIDE_SCOPE.w, SCOPE.h, { divs: [5, 5], zeroAt: 0.2 })
  plot.group.position.set(SIDE_SCOPE.x, SCOPE.y, 0)
  scopeLabels(scene, SCOPE.y, SCOPE.h, ST.seconds, `arm angle ${ST.lo}…${ST.hi}°`, `step ${ST.from} → ${ST.target}°`)
  const spTr = plot.trace(B_FIELD, { samples: 200, radius: 0.04 })
  const thTr = plot.trace(RING, { samples: 260, radius: 0.08 })
  const yDeg = (d: number) => ((d - ST.lo) / (ST.hi - ST.lo) - 0.5) * SCOPE.h
  const xAt = (t: number) => SIDE_SCOPE.x - SIDE_SCOPE.w / 2 + (t / ST.seconds) * SIDE_SCOPE.w
  const st = { key: '', t: 0 }
  return {
    scene,
    ...head,
    plane,
    /** Pole crosses; notes the fast ones (the delay's Padé poles) that sit off the left edge. */
    poles(list: readonly Cx[], color?: (k: number) => string) {
      const off = plane!.poles(list, color)
      offTag!.set(off ? `← ${off} fast poles off-screen` : '', GREY)
    },
    plot,
    yDeg,
    xAt,
    clock(dt: number, key: string) {
      if (key !== st.key) [st.key, st.t] = [key, 0]
      st.t += dt * ST.slow
      if (st.t > ST.seconds + RIG.rest * ST.slow) st.t = 0
      return Math.min(st.t, ST.seconds)
    },
    show(dt: number, run: ArmFrame[], t: number) {
      const f = fixedStepAt(run, t, ARM.dt)
      traceRun(thTr, run, ARM.dt, ST.seconds, t, (g) => yDeg(g.th), 260)
      traceRun(spTr, run, ARM.dt, ST.seconds, t, (g) => yDeg(g.sp), 200)
      arm.set(dt, f.th, f.sp, f.u)
      bars.set({ p: f.p, i: f.i, d: f.d, u: f.u }, Math.abs(f.u) >= 0.999)
      return f
    },
    sub(t: number, lag: number) {
      head.sub.set(`${t.toFixed(2)} / ${ST.seconds} s · slowed ${1 / ST.slow}× · loop ${Math.round(1 / ARM.dt)} Hz · pot ${lag ? `${Math.round(lag * 1000)} ms late` : 'no lag'} · feed-forward holds the load`)
    },
  }
}
type StabStage = ReturnType<typeof stabStage>

/** Rod from the s-plane origin to a pole: its angle from the −σ axis is acos ζ, its length ωn. */
function zetaRay(s: StabStage, color: string) {
  const rods = [addRod(s.plane!.group, glowMat(color, 0.8)), addRod(s.plane!.group, glowMat(color, 0.8))]
  const tag = liveLabel(s.plane!.group, [0, 0, 0.35], { size: 0.26, color, align: 'right' })
  return (p: Cx | null, text: string) => {
    rods.forEach((r, k) => {
      r.visible = !!p
      if (!p) return
      const [x0, y0] = s.plane!.xy(0, 0)
      const [x, y] = s.plane!.xy(p.re, k ? -p.im : p.im)
      stretchRod(r, [x0, y0, 0.25], [x, y, 0.25], 0.035)
    })
    tag.group.visible = !!p
    if (!p) return
    const [x, y] = s.plane!.xy(p.re, p.im)
    const [x0] = s.plane!.xy(0, 0)
    tag.group.position.set((x + x0) / 2 - 0.3, y / 2 + 0.2, 0.35)
    tag.set(text, color)
  }
}

const poleColor = (ps: readonly Cx[], dom: Cx) => (k: number) => (ps[k].re > 1e-6 ? HIGH_V : Math.abs(ps[k].re - dom.re) < 1e-6 ? RING : GREY)

// --- Poles and damping: Kp, Kd (and pot lag) move the closed-loop poles; σ sets decay, ωd the ring, the angle ζ the overshoot. ---

const pdParams = (p: Params) => ({ g: { kp: n(p, 'kp') / 100, ki: 0, kd: n(p, 'kd') / 100 }, lag: n(p, 'lag') / 1000 })
type PdQ = ReturnType<typeof pdParams>
const pdPoles = memoBy(
  (q: PdQ) => gainsKey(q.g, q.lag),
  (q: PdQ) => {
    const poles = armPoles(q.g, q.lag, ST.target)
    const locus = Array.from({ length: 81 }, (_, k) => armPoles({ ...q.g, kp: k * 0.001 }, q.lag, ST.target)).flat()
    return { poles, dom: dominant(poles), locus }
  },
)

export const polesAndDamping: Lesson = {
  id: 'stability-poles-and-damping',
  title: 'Poles and damping',
  tagline: 'Where the poles sit decides how the loop moves',
  formula: (p) => {
    const q = pdParams(p)
    const { dom } = pdPoles(q)
    return `θ'' + (1/τ + K·Kd)·θ' + K·(kL + Kp)·θ = 0 → poles s = −ζωn ± jωn√(1 − ζ²) · now ${poleText(dom.pole)}: ζ ${dom.zeta.toFixed(2)}, ωn ${dom.wn.toFixed(1)} rad/s${q.lag ? ` · + ${Math.round(q.lag * 1000)} ms lag (Padé poles, grey)` : ''}`
  },
  legend: [
    { color: RING, label: 'Dominant pole pair (s-plane) · arm angle θ', shape: 'dot' },
    { color: GREY, label: 'Root locus: poles as Kp goes 0 → 8 %/°', shape: 'dot' },
    { color: B_FIELD, label: 'ζ ray (angle) · setpoint', shape: 'dot' },
    { color: HIGH_V, label: 'Right half plane: grows, unstable', shape: 'dot' },
  ],
  points: [
    'The PID arm (see PID) again, now with feed-forward holding the spring and gravity, stepping 30 → 40°. Near 40° its motion obeys a linear equation, θ\'\' + (1/τ + K·Kd)·θ\' + K·(kL + Kp)·θ = 0, and the solutions are e^(st) for the roots s of that polynomial: the closed-loop poles.',
    'Each pole is a mode. Its real part σ sets the envelope e^(σt): left of the axis it dies away (time constant 1/|σ|), right of it it grows. The imaginary part ωd is how fast it rings. A pair at −ζωn ± jωd: the distance from the origin is ωn, the angle from the negative axis is acos ζ, the damping ratio.',
    'Kp pushes the pair apart vertically: more stiffness, faster ringing, smaller ζ (the grey dots trace this root locus). Kd moves them left: more damping, higher ζ, until they meet on the real axis and split (ζ > 1, no overshoot, slower). Read ζ off the angle and the overshoot follows.',
    'Add pot lag and two extra poles appear (here from a Padé fit of the delay), and the locus now bends right: past a Kp the pair crosses the jω axis and the arm swings itself apart. That crossing is the Ziegler–Nichols Ku. Gain and phase margin says how far from it you are.',
  ],
  controls: [
    { kind: 'slider', key: 'kp', label: 'Kp', min: 0, max: 8, step: 0.25, initial: 2, format: (v) => `${v.toFixed(2)} %/°` },
    { kind: 'slider', key: 'kd', label: 'Kd', min: 0, max: 0.6, step: 0.05, initial: 0, format: (v) => `${v.toFixed(2)} %/(°/s)` },
    { kind: 'slider', key: 'lag', label: 'Pot lag', min: 0, max: 100, step: 10, initial: 0, format: (v) => (v ? `${v} ms` : 'none') },
  ],
  build(): Stage {
    const s = stabStage('splane')
    const ray = zetaRay(s, B_FIELD)
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = pdParams(p)
        const { poles, dom, locus } = pdPoles(q)
        const { run } = stepRun(q)
        const t = s.clock(dt, gainsKey(q.g, q.lag))
        s.plane!.locus(locus, GREY)
        s.poles(poles, poleColor(poles, dom.pole))
        ray(dom.pole.im > 0.01 ? dom.pole : null, dom.zeta < 0 ? 'ζ < 0' : `ζ ${dom.zeta.toFixed(2)}`)
        const f = s.show(dt, run, t)
        const unstable = dom.pole.re > 1e-6
        s.status.set(`Poles and damping · Kp ${kpText(q.g.kp)} · Kd ${kdText(q.g.kd)}${q.lag ? ` · lag ${Math.round(q.lag * 1000)} ms` : ''}`, LABEL)
        if (unstable) s.event.set(`pole in the right half: e^(+${dom.pole.re.toFixed(1)}t) grows, swing limited only by the motor`, HIGH_V)
        else if (dom.pole.im < 0.01) s.event.set(`real poles (ζ ≥ 1): creeps in, no overshoot, slowest 1/${(-dom.pole.re).toFixed(1)} s`, POWER)
        else if (t < ARM.stepAt) s.event.set(`poles ${poleText(dom.pole)}: setpoint about to step 30 → 40°`, GREY)
        else s.event.set(`rings at ${(dom.pole.im / (2 * Math.PI)).toFixed(1)} Hz, envelope shrinks ×e every ${(1 / -dom.pole.re).toFixed(2)} s · θ ${deg(f.th)}`, dom.zeta < 0.3 ? HEAT : RING)
        s.sub(t, q.lag)
      },
      readouts: (p) => {
        const q = pdParams(p)
        const { dom } = pdPoles(q)
        const { m, sw } = stepRun(q)
        const unstable = dom.pole.re > 1e-6
        const th = secondOrder(dom.zeta, dom.wn)
        return [
          { label: 'Dominant poles', value: poleText(dom.pole), tone: unstable ? 'bad' : dom.pole.re > -1 ? 'warn' : 'ok' },
          { label: 'ζ · ωn', value: `${dom.zeta.toFixed(2)} · ${dom.wn.toFixed(1)} rad/s`, tone: unstable ? 'bad' : dom.zeta < 0.3 ? 'warn' : 'ok' },
          { label: 'Overshoot: from ζ vs the arm', value: unstable ? swingText(sw?.ratio) : `${pct(th.overshoot)} vs ${pct(m.overshoot)}`, tone: unstable ? 'bad' : undefined },
          { label: 'Settled ±2 %', value: unstable || m.settle === null ? 'never' : secs(m.settle), tone: unstable ? 'bad' : undefined },
        ]
      },
    }
  },
}

// --- Step response: pick ζ and ωn, place the poles with PD, compare the arm with the textbook 2nd-order curve. ---

const srParams = (p: Params) => ({ zeta: n(p, 'zeta'), wn: n(p, 'wn') })
type SrQ = ReturnType<typeof srParams>
const FAMILY = [0.2, 0.5, 1]
const srKey = (q: SrQ) => `${q.zeta}|${q.wn}`
const srData = memoBy(srKey, (q: SrQ) => {
  const g = placePd(q.zeta, q.wn, ST.target)
  const r = stepRun({ g, lag: 0 })
  const locus = Array.from({ length: 60 }, (_, k) => armPoles(placePd(0.02 + k * 0.025, q.wn, ST.target), 0, ST.target)).flat()
  return { g, ...r, th: secondOrder(q.zeta, q.wn), poles: armPoles(g, 0, ST.target), locus }
})

export const stepResponse: Lesson = {
  id: 'stability-step-response',
  title: 'Step response',
  tagline: 'Overshoot, peak time and settling, from two numbers',
  formula: (p) => {
    const q = srParams(p)
    const { g, th } = srData(q)
    return `overshoot = e^(−πζ/√(1−ζ²)) = ${pct(th.overshoot)} · peak at π/ωd = ${secs(th.peak)} · settled ±2 % ${q.zeta < 1 ? `≈ 4/(ζωn) = ${secs(4 / (q.zeta * q.wn))}` : `at ${secs(th.settle)} (slow real pole)`} · placed by Kp = ωn²/K − kL = ${kpText(g.kp)}, Kd = (2ζωn − 1/τ)/K = ${kdText(g.kd)}`
  },
  legend: [
    { color: RING, label: 'Arm angle θ (simulated)', shape: 'dot' },
    { color: POWER, label: 'Ideal 2nd-order curve for this ζ, ωn', shape: 'dot' },
    { color: GREY, label: 'ζ 0.2 · 0.5 · 1 at the same ωn', shape: 'dot' },
    { color: HEAT, label: 'Peak time · settling time', shape: 'dot' },
  ],
  points: [
    'Most loops are judged by one test: step the setpoint and watch. Overshoot, the time to the first peak and the time to settle within ±2 % are the numbers on every spec sheet (see Tuning by hand). For a loop whose dominant poles are one pair, all three follow from just ζ and ωn.',
    'ζ alone fixes the overshoot: 0.2 → 53 %, 0.5 → 16 %, 0.7 → 5 %, 1 → none. ωn sets the time scale: double it and the whole curve happens twice as fast with the same shape. Peak time is π/ωd, settling about 4/(ζωn), four envelope time constants.',
    'Here the sliders are the poles, and the gains follow: with feed-forward holding the load, Kp sets the stiffness (ωn) and Kd the damping (ζ). That is pole placement. At low ζ the motor\'s own back-EMF damping is already too much, so Kd goes negative: the controller feeds speed back positively to cancel it.',
    'The simulated arm sits on the ideal curve because its loop is nearly linear and has no lag. Push ωn up and the gains ask for more than 100 % duty: the motor clips, the step turns into a straight ramp and the formulas stop holding. A real plant is never exactly 2nd-order, so use these as estimates, then measure.',
  ],
  controls: [
    { kind: 'slider', key: 'zeta', label: 'Damping ratio ζ', min: 0.1, max: 1.2, step: 0.05, initial: 0.5, format: (v) => v.toFixed(2) },
    { kind: 'slider', key: 'wn', label: 'Natural frequency ωn', min: 6, max: 14, step: 0.5, initial: 8, format: (v) => `${v.toFixed(1)} rad/s` },
  ],
  build(): Stage {
    const s = stabStage('splane')
    const ray = zetaRay(s, B_FIELD)
    const t0 = ARM.stepAt
    const curve = (zeta: number, wn: number) => (u: number) => s.yDeg(ST.from + (ST.target - ST.from) * secondOrderAt(zeta, wn, u * ST.seconds - t0))
    const family = FAMILY.map(() => s.plot.trace(GREY, { samples: 160, radius: 0.025 }))
    const ideal = s.plot.trace(POWER, { samples: 200, radius: 0.04 })
    const marks = [s.plot.trace(HEAT, { samples: 2, radius: 0.035 }), s.plot.trace(HEAT, { samples: 2, radius: 0.035 })]
    const tags = [liveLabel(s.scene, [0, 0, 0.3], { size: 0.24, color: HEAT, align: 'left' }), liveLabel(s.scene, [0, 0, 0.3], { size: 0.24, color: HEAT, align: 'left' })]
    const fu = (t: number) => (t0 + t) / ST.seconds
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = srParams(p)
        const d = srData(q)
        const t = s.clock(dt, srKey(q))
        FAMILY.forEach((z, k) => family[k].draw(curve(z, q.wn), null))
        ideal.draw(curve(q.zeta, q.wn), null)
        const at = [d.th.peak, d.th.settle]
        marks.forEach((m, k) => {
          const show = Number.isFinite(at[k]) && t0 + at[k] < ST.seconds
          m.group.visible = tags[k].group.visible = show
          if (!show) return
          m.points([fu(at[k]), fu(at[k])], [-SCOPE.h / 2, SCOPE.h / 2])
          tags[k].group.position.set(s.xAt(t0 + at[k]) + 0.12, SCOPE.y - SCOPE.h / 2 + 0.35 + k * 0.45, 0.3)
          tags[k].set(k ? 'settled ±2 %' : 'peak π/ωd', HEAT)
        })
        s.plane!.locus(d.locus, GREY)
        s.poles(d.poles, () => RING)
        ray(d.poles[0].im ? d.poles.find((x) => x.im > 0)! : null, `ζ ${q.zeta.toFixed(2)}`)
        const f = s.show(dt, d.run, t)
        s.status.set(`Step response · ζ ${q.zeta.toFixed(2)} · ωn ${q.wn.toFixed(1)} rad/s → Kp ${kpText(d.g.kp)}, Kd ${kdText(d.g.kd)}`, LABEL)
        if (d.clipped) s.event.set('gains ask for more than 100 % duty: the motor clips, the curve no longer follows ζ, ωn', HIGH_V)
        else if (t < t0) s.event.set('setpoint about to step 30 → 40°', GREY)
        else if (f.th > ST.target + 0.2) s.event.set(`over by ${deg(f.th - ST.target)}: ζ ${q.zeta.toFixed(2)} predicts ${pct(d.th.overshoot)}`, HEAT)
        else s.event.set(q.zeta >= 1 ? 'ζ ≥ 1: no overshoot, it creeps the last degrees' : `rising: θ ${deg(f.th)}`, RING)
        s.sub(t, 0)
      },
      readouts: (p) => {
        const q = srParams(p)
        const d = srData(q)
        return [
          { label: 'Overshoot: formula vs arm', value: `${pct(d.th.overshoot)} vs ${pct(d.m.overshoot)}`, tone: Math.abs(d.th.overshoot - d.m.overshoot) > 0.03 ? 'warn' : 'ok' },
          { label: 'Settled ±2 %: ideal vs arm', value: `${secs(d.th.settle)} vs ${d.m.settle === null ? `not in ${ST.seconds} s` : secs(d.m.settle)}` },
          { label: 'Rise 10 → 90 %', value: secs(d.m.rise) },
          { label: 'Placed gains Kp · Kd', value: `${(d.g.kp * 100).toFixed(2)} · ${(d.g.kd * 100).toFixed(2)}`, tone: d.clipped ? 'bad' : d.g.kd < 0 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Gain and phase margin: Bode plot of the loop gain; how much more gain or lag before it oscillates. ---

const gmParams = (p: Params) => ({ g: { kp: n(p, 'kp') / 100, ki: 0, kd: n(p, 'kd') / 100 }, lag: n(p, 'lag') / 1000 })
type GmQ = ReturnType<typeof gmParams>
const BODE = { w0: 1, decades: 2, db: 20, h: 6 }
const gmData = memoBy(
  (q: GmQ) => gainsKey(q.g, q.lag),
  (q: GmQ) => ({ mg: margins(q.g, q.lag, ST.target), ...stepRun(q) }),
)
const db = (x: number) => 20 * Math.log10(x)

export const gainAndPhaseMargin: Lesson = {
  id: 'stability-gain-and-phase-margin',
  title: 'Gain and phase margin',
  tagline: 'How far the loop is from oscillating',
  formula: (p) => {
    const q = gmParams(p)
    const { mg } = gmData(q)
    const gm = mg.gm === null ? '∞' : `${mg.gm.toFixed(2)}× (${db(mg.gm).toFixed(1)} dB)`
    return `L(jω) = C·P·e^(−jωT), T = ${Math.round(q.lag * 1000)} ms lag + ½ tick · GM = 1/|L| where ∠L = −180° → ${gm} · PM = 180° + ∠L where |L| = 1 → ${mg.pm === null ? '∞' : deg(mg.pm)} · delay margin PM/ωc = ${mg.delayMargin === null ? '∞' : `${Math.round(mg.delayMargin * 1000)} ms`}`
  },
  legend: [
    { color: HEAT, label: 'Loop gain |L| (top, ±20 dB)', shape: 'dot' },
    { color: DATA_COLOR, label: 'Loop phase ∠L (bottom, 0…−240°)', shape: 'dot' },
    { color: POWER, label: 'Phase margin at |L| = 1', shape: 'dot' },
    { color: FORCE, label: 'Gain margin at ∠L = −180°', shape: 'dot' },
  ],
  points: [
    'Break the loop open and send a sine round it: it comes back scaled by |L| and delayed by ∠L, the loop gain C·P. If at some frequency it returns at the same size and turned 180° (an inversion, which the minus at Σ turns back into a push), it feeds itself: a steady oscillation. That is the edge of stability, the poles on the jω axis.',
    'Gain margin: at the frequency where the phase hits −180°, how many times more gain until |L| = 1. Phase margin: at the frequency where |L| = 1, how many more degrees of lag until −180°. Rule of thumb: GM above 2× (6 dB), PM 45–60°. PM ≈ 100·ζ, so PM 30° rings like ζ 0.3.',
    'The arm alone has two poles, so its phase only approaches −180° at infinite frequency; even the half-tick hold of the 200 Hz loop only gets there near 7 Hz, where |L| is tiny. The pot lag is what kills it: a delay T adds −ω·T of phase and no gain change, so the phase dives. Here P only with 50 ms lag gives GM ≈ 2.2×: Kp × GM = 4.4 %/°, the Ku that Ziegler–Nichols finds by experiment.',
    'Delay margin = PM/ωc is the extra lag the loop can take before it oscillates: a slower sensor filter, a busier task, a radio link. D adds phase lead near crossover and buys margin back, until noise limits it (see Derivative kick). Margins are measured on the linear model; the motor\'s 100 % limit turns a growing swing into a steady limit cycle.',
  ],
  controls: [
    { kind: 'slider', key: 'kp', label: 'Kp', min: 1, max: 7, step: 0.25, initial: 2, format: (v) => `${v.toFixed(2)} %/°` },
    { kind: 'slider', key: 'kd', label: 'Kd', min: 0, max: 0.4, step: 0.05, initial: 0, format: (v) => `${v.toFixed(2)} %/(°/s)` },
    { kind: 'slider', key: 'lag', label: 'Pot lag', min: 0, max: 120, step: 10, initial: 50, format: (v) => (v ? `${v} ms` : 'none') },
  ],
  build(): Stage {
    const s = stabStage('bode')
    const bode = scope(s.scene, SIDE_SCOPE.w, BODE.h, { divs: [BODE.decades, 8], zeroAt: 0.5 })
    bode.group.position.set(SIDE_SCOPE.x, TOP.y, 0)
    const q4 = BODE.h / 4
    const wAt = (u: number) => BODE.w0 * 10 ** (u * BODE.decades)
    const uAt = (w: number) => Math.log10(w / BODE.w0) / BODE.decades
    const yMag = (m: number) => q4 + (db(m) / BODE.db) * q4
    const yPh = (ph: number) => (ph / Math.PI / (4 / 3)) * 2 * q4
    const magTr = bode.trace(HEAT, { samples: 160, radius: 0.05 })
    const phTr = bode.trace(DATA_COLOR, { samples: 160, radius: 0.05 })
    for (const y of [q4, yPh(-Math.PI)]) bode.level(GREY).set(y)
    const curve = (tr: typeof magTr, y: (u: number) => number, lo: number, hi: number) => {
      const us = Array.from({ length: 160 }, (_, k) => k / 159).filter((u) => y(u) >= lo && y(u) <= hi)
      tr.points(us, us.map(y))
    }
    const left = SIDE_SCOPE.x - SIDE_SCOPE.w / 2
    const tick = (text: string, x: number, y: number, align: 'left' | 'right' | 'center' = 'left') => addLabel(s.scene, text, [x, y, 0.3], GREY, 0.24, align)
    tick('0 dB', left + SIDE_SCOPE.w - 0.15, TOP.y + q4 + 0.25, 'right')
    tick('+20 dB', left + SIDE_SCOPE.w - 0.15, TOP.y + 2 * q4 - 0.3, 'right')
    tick('0°', left + 0.15, TOP.y - 0.25)
    tick('−180°', left + 0.15, TOP.y + yPh(-Math.PI) + 0.25)
    for (let k = 0; k <= BODE.decades; k++) tick(`${BODE.w0 * 10 ** k}${k === BODE.decades ? ' rad/s' : ''}`, left + (k / BODE.decades) * SIDE_SCOPE.w, TOP.y - BODE.h / 2 - 0.8, k === BODE.decades ? 'right' : k ? 'center' : 'left')
    const pmBar = addRod(bode.group, glowMat(POWER, 1))
    const gmBar = addRod(bode.group, glowMat(FORCE, 1))
    const wcLine = bode.trace(POWER, { samples: 2, radius: 0.03 })
    const w180Line = bode.trace(FORCE, { samples: 2, radius: 0.03 })
    const pmTag = liveLabel(bode.group, [0, 0, 0.35], { size: 0.26, color: POWER, align: 'right' })
    const gmTag = liveLabel(bode.group, [0, 0, 0.35], { size: 0.26, color: FORCE, align: 'left' })
    const bx = (w: number) => bode.xAt(uAt(w))
    const inRange = (w: number | null): w is number => w !== null && uAt(w) >= 0 && uAt(w) <= 1
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = gmParams(p)
        const { mg, run, sw } = gmData(q)
        const t = s.clock(dt, gainsKey(q.g, q.lag))
        const L = (u: number) => loopAt(q.g, q.lag, ST.target, wAt(u))
        curve(magTr, (u) => yMag(L(u).mag), 0, 2 * q4)
        curve(phTr, (u) => yPh(L(u).phase), -2 * q4, 0)
        const showPm = inRange(mg.wc) && mg.pm !== null
        pmBar.visible = wcLine.group.visible = pmTag.group.visible = showPm
        if (showPm) {
          const x = bx(mg.wc!)
          const yp = Math.max(-2 * q4, yPh(loopAt(q.g, q.lag, ST.target, mg.wc!).phase))
          stretchRod(pmBar, [x, yPh(-Math.PI), 0.3], [x, yp, 0.3], 0.08)
          wcLine.points([uAt(mg.wc!), uAt(mg.wc!)], [-BODE.h / 2, BODE.h / 2])
          pmTag.group.position.set(x - 0.15, yPh(-Math.PI) - 0.4, 0.35)
          pmTag.set(`PM ${deg(mg.pm!, 0)}`, mg.pm! < 0 ? HIGH_V : POWER)
        }
        const showGm = inRange(mg.w180) && mg.gm !== null
        gmBar.visible = w180Line.group.visible = gmTag.group.visible = showGm
        if (showGm) {
          const x = bx(mg.w180!)
          const ym = Math.min(2 * q4, Math.max(0, yMag(1 / mg.gm!)))
          stretchRod(gmBar, [x, q4, 0.3], [x, ym, 0.3], 0.08)
          w180Line.points([uAt(mg.w180!), uAt(mg.w180!)], [-BODE.h / 2, BODE.h / 2])
          gmTag.group.position.set(x + 0.15, q4 + 0.4, 0.35)
          gmTag.set(`GM ${mg.gm!.toFixed(2)}×`, mg.gm! < 1 ? HIGH_V : FORCE)
        }
        s.show(dt, run, t)
        const unstable = (mg.gm !== null && mg.gm < 1) || (mg.pm !== null && mg.pm < 0)
        s.status.set(`Gain and phase margin · Kp ${kpText(q.g.kp)} · Kd ${kdText(q.g.kd)} · lag ${Math.round(q.lag * 1000)} ms`, LABEL)
        if (unstable) s.event.set(`no margin left: |L| > 1 at −180°, the swing ${swingText(sw?.ratio).split(' (')[0]} until the motor clips`, HIGH_V)
        else if (mg.pm !== null && mg.pm < 30) s.event.set(`thin margin: PM ${deg(mg.pm, 0)} → rings like ζ ≈ ${(mg.pm / 100).toFixed(2)}`, HEAT)
        else s.event.set(mg.pm === null ? '|L| < 1 at every frequency: cannot oscillate (but P alone is soft)' : `healthy: PM ${deg(mg.pm, 0)}, ${mg.gm === null ? 'phase never reaches −180°' : `${mg.gm.toFixed(1)}× more gain to spare`}`, POWER)
        s.sub(t, q.lag)
      },
      readouts: (p) => {
        const q = gmParams(p)
        const { mg, sw } = gmData(q)
        return [
          { label: 'Gain margin', value: mg.gm === null ? '∞ (never −180°)' : `${mg.gm.toFixed(2)}× · ${db(mg.gm).toFixed(1)} dB`, tone: mg.gm === null || mg.gm > 2 ? 'ok' : mg.gm > 1 ? 'warn' : 'bad' },
          { label: 'Phase margin', value: mg.pm === null ? '∞ (|L| < 1)' : `${deg(mg.pm, 0)} at ${(mg.wc! / (2 * Math.PI)).toFixed(2)} Hz`, tone: mg.pm === null || mg.pm >= 45 ? 'ok' : mg.pm > 0 ? 'warn' : 'bad' },
          { label: 'Delay margin (extra lag)', value: mg.delayMargin === null ? '∞' : mg.delayMargin < 0 ? 'none' : `${Math.round(mg.delayMargin * 1000)} ms` },
          { label: 'Arm after the step', value: swingText(sw?.ratio), tone: !sw || sw.ratio < 0.7 ? 'ok' : sw.ratio < 0.98 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}
