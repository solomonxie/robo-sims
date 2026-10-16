import { ARM, ArmCfg, ArmFrame, ZN_RULES, ZnRule, armRun, fixedStepAt, loadDuty, pRestDeg, stepMetrics, swing, ultimateGain, zieglerNichols } from '../../core/physics'
import { pct } from '../../core/units'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HIGH_V, LABEL, PID_COLORS, POWER, RING, SIDE_SCOPE, addRod, controlLoop, glowMat, liveLabel, memoBy, pidArm, scope, scopeLabels, statusHeader, stretchRod, termBars, traceRun } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const VIEW = { center: [-2.2, -1.3, 0] as V3, radius: 54, polar: 1.45, azimuth: 0 }
const DIAG = { at: [SIDE_SCOPE.x, 2.4, 0] as V3, w: 12.5, h: 3.6 }
const SCOPE = { y: -4.6, h: 5 }
const RIG = { at: [-11.6, 1.3, 0] as V3, len: 5.2, bars: [-11.2, -6.5, 0] as V3, slow: 0.4, rest: 1.2 }
const FROM = Math.round(ARM.stepAt / ARM.dt)
const deg = (d: number, digits = 1) => `${d.toFixed(digits)}°`
const secs = (s: number | null) => (s === null ? '—' : `${s.toFixed(2)} s`)
const kpText = (kp: number) => `${(kp * 100).toFixed(2)} %/°`
const kiText = (ki: number) => `${(ki * 100).toFixed(1)} %/(°·s)`
const kdText = (kd: number) => `${(kd * 100).toFixed(2)} %/(°/s)`
const metricsOf = (run: ArmFrame[], target = ARM.target) => stepMetrics(run.map((f) => f.th), ARM.dt, FROM, 0, target)
const rms = (xs: number[]) => {
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length)
}
const LEGEND = {
  th: { color: RING, label: 'Arm angle θ (scope top: 0…60°)', shape: 'dot' as const },
  sp: { color: B_FIELD, label: 'Setpoint 40° (ghost arm)', shape: 'dot' as const },
  p: { color: PID_COLORS.p, label: 'P term Kp·e (scope bottom ±100 %)', shape: 'dot' as const },
  i: { color: PID_COLORS.i, label: 'I term Ki·∫e dt', shape: 'dot' as const },
  d: { color: PID_COLORS.d, label: 'D term Kd·de/dt', shape: 'dot' as const },
  id: { color: PID_COLORS.i, label: 'I term (purple) · D term (pink)', shape: 'dot' as const },
}

/** Shared stage: arm rig, term bars, loop diagram and a scope (angle on top, P/I/D below); `show` plays a run at time t. */
function pidStage(ctrl: string, { noise = false, seconds = ARM.seconds, slow = RIG.slow, terms = ['p', 'i', 'd'] as ('p' | 'i' | 'd')[] } = {}) {
  const scene = createStage({ span: 40 })
  const head = statusHeader(scene)
  const arm = pidArm(scene, RIG.at, RIG.len)
  const bars = termBars(scene, RIG.bars, 7)
  const loop = controlLoop(scene, DIAG.at, { ctrl, plant: 'motor + arm', sensor: 'pot', disturb: true, noise, w: DIAG.w, h: DIAG.h })
  const plot = scope(scene, SIDE_SCOPE.w, SCOPE.h, { divs: [6, 4], zeroAt: 0.25 })
  plot.group.position.set(SIDE_SCOPE.x, SCOPE.y, 0)
  const spTr = plot.trace(B_FIELD, { samples: 300, radius: 0.04 })
  const tr = terms.map((k) => [k, plot.trace(PID_COLORS[k], { samples: 300, radius: 0.045 })] as const)
  const thTr = plot.trace(RING, { samples: 300, radius: 0.08 })
  scopeLabels(scene, SCOPE.y, SCOPE.h, seconds, 'angle θ 0…60°', 'P · I · D ±100 %')
  const yDeg = (d: number) => (Math.min(64, d) / 60) * (SCOPE.h / 2)
  const yTerm = (v: number) => -SCOPE.h / 4 + Math.max(-1.12, Math.min(1.12, v)) * (SCOPE.h / 4) * 0.92
  const xAt = (t: number) => SIDE_SCOPE.x - SIDE_SCOPE.w / 2 + (t / seconds) * SIDE_SCOPE.w
  const st = { key: '', t: 0 }
  return {
    scene,
    ...head,
    arm,
    plot,
    yDeg,
    xAt,
    /** Advances the looping clock; resets on a new key. Returns sim time. */
    clock(dt: number, key: string) {
      if (key !== st.key) {
        st.key = key
        st.t = 0
      }
      st.t += dt * slow
      if (st.t > seconds + RIG.rest * slow) st.t = 0
      return Math.min(st.t, seconds)
    },
    show(dt: number, run: ArmFrame[], t: number, grams = 0, title = ctrl, noiseDeg = 0) {
      const f = fixedStepAt(run, t, ARM.dt)
      traceRun(thTr, run, ARM.dt, seconds, t, (g) => yDeg(g.th), 300)
      traceRun(spTr, run, ARM.dt, seconds, t, (g) => yDeg(g.sp), 300)
      for (const [k, trace] of tr) traceRun(trace, run, ARM.dt, seconds, t, (g) => yTerm(g[k]), 300)
      arm.set(dt, f.th, f.sp, f.u, grams)
      bars.set({ p: f.p, i: f.i, d: f.d, u: f.u }, f.sat)
      const e = f.sp - f.meas
      loop.set(
        dt,
        { r: f.sp ? 0.5 : 0.1, e: Math.min(1, Math.abs(e) / 20), u: f.u, y: f.th / 50, m: f.th / 50, d: grams / 200 + (f.blocked ? 1 : 0.2), n: noiseDeg * 2 },
        {
          r: `${deg(f.sp, 0)}`,
          e: `e ${deg(e)}`,
          u: `u ${pct(f.u)}`,
          y: `θ ${deg(f.th)}`,
          m: `pot ${deg(f.meas)}`,
          d: f.blocked ? 'held!' : grams ? `spring + ${grams} g` : 'spring + gravity',
          n: noiseDeg ? `noise σ ${deg(noiseDeg)}` : '',
        },
        { ctrl: title },
      )
      return f
    },
    sub(t: number) {
      head.sub.set(`${t.toFixed(2)} / ${seconds} s · slowed ${1 / slow}× · loop ${Math.round(1 / ARM.dt)} Hz · pot reads ${Math.round(ARM.lag * 1000)} ms late`)
    },
  }
}
type PidStage = ReturnType<typeof pidStage>

/** Level line on the scope at angle `d`, from u0 to u1 of the time axis. */
function hLine(s: PidStage, color: string) {
  const tr = s.plot.trace(color, { samples: 2, radius: 0.035 })
  return (d: number, u0 = ARM.stepAt / ARM.seconds, u1 = 1) => tr.points([u0, u1], [s.yDeg(d), s.yDeg(d)])
}

// --- Proportional only: u = Kp·e; the spring + gravity load needs a standing error; more Kp → smaller error, faster, then oscillation. ---

const poParams = (p: Params) => ({ kp: n(p, 'kp') / 100, grams: n(p, 'grams') })
type PoQ = ReturnType<typeof poParams>
const poKey = (q: PoQ) => `${q.kp}|${q.grams}`
const poRun = memoBy(poKey, (q: PoQ) => {
  const run = armRun({ pid: { kp: q.kp, ki: 0, kd: 0, limit: 1 }, grams: q.grams })
  const rest = pRestDeg(q.kp, ARM.target, q.grams)
  const tail = run.slice(-Math.round(0.6 / ARM.dt)).map((f) => f.th)
  return { run, rest, m: metricsOf(run, rest), wobble: Math.max(...tail) - Math.min(...tail) }
})

export const proportionalOnly: Lesson = {
  id: 'pid-proportional-only',
  title: 'Proportional only',
  tagline: 'Push in proportion to the error, and stop short',
  formula: (p) => {
    const q = poParams(p)
    const r = poRun(q).rest
    return `u = Kp·e = ${kpText(q.kp)} × e · at rest Kp·e = load(θ) = ${pct(loadDuty(r, q.grams))} (spring + gravity) → e = load / Kp = ${deg(ARM.target - r)}`
  },
  legend: [LEGEND.th, LEGEND.sp, { ...LEGEND.p, label: 'P term = u (scope bottom ±100 %)' }, { color: GREY, label: 'Where P alone comes to rest', shape: 'dot' }],
  points: [
    'The test rig for the whole PID topic: a 12 V gearmotor swings an arm up from hanging to 40°, against a return spring and gravity. A pot on the hub reads the angle every 5 ms (50 ms late after filtering and the driver), and the controller sets the motor duty u between −100 and +100 %.',
    'Proportional control is the first idea everyone has: push in proportion to how far off you are, u = Kp·e. Big error, full power; small error, gentle. Unlike bang-bang (see Chatter) the command shrinks smoothly as the arm arrives.',
    'But it can never quite arrive. Holding the arm at 40° takes about 45 % duty just to beat the spring and gravity, and P only gives duty when there is an error. So the arm settles where Kp·e equals the load: error = load / Kp. Add a payload and the error grows. That standing gap is the steady-state error.',
    'Raising Kp shrinks the gap and speeds up the rise, but the arm now arrives with momentum and the 50 ms lag means the push comes late: it overshoots and rings. Around 4.5 %/° it never stops swinging. P alone trades accuracy against stability; the I term removes the gap (next lesson), D calms the swing.',
  ],
  controls: [
    { kind: 'slider', key: 'kp', label: 'Kp (proportional)', min: 0.5, max: 5, step: 0.25, initial: 2, format: (v) => `${v.toFixed(2)} %/°` },
    { kind: 'slider', key: 'grams', label: 'Payload at the tip', min: 0, max: 300, step: 50, initial: 100, format: (v) => `${v} g` },
  ],
  build(): Stage {
    const s = pidStage('P: Kp·e', { terms: ['p'] })
    const rest = hLine(s, GREY)
    const restTag = liveLabel(s.scene, [s.xAt(ARM.stepAt) + 0.2, 0, 0.3], { size: 0.24, color: GREY, align: 'left' })
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = poParams(p)
        const { run, rest: r, wobble } = poRun(q)
        const t = s.clock(dt, poKey(q))
        rest(r)
        restTag.group.position.y = SCOPE.y + s.yDeg(r) - 0.35
        restTag.set(`P rests at ${deg(r)}`, GREY)
        const f = s.show(dt, run, t, q.grams, `P ${(q.kp * 100).toFixed(2)}%/°`)
        const prev = fixedStepAt(run, t - 0.05, ARM.dt)
        const moving = Math.abs(f.th - prev.th) > 0.3
        s.status.set(`Proportional only · Kp ${kpText(q.kp)} · ${q.grams} g payload`, LABEL)
        if (t < ARM.stepAt) s.event.set('hanging at 0°: setpoint about to jump to 40°', GREY)
        else if (f.sat) s.event.set(`e ${deg(f.sp - f.meas)} × Kp = ${pct(f.raw)} → motor clipped at 100 %`, HIGH_V)
        else if (moving) s.event.set(`u = Kp·e = ${pct(f.u)}: pushing, ${f.th > f.sp ? 'past the target!' : 'easing off as e shrinks'}`, PID_COLORS.p)
        else s.event.set(`stuck ${deg(f.sp - f.th)} short: Kp·e = ${pct(f.u)} only just holds the load`, wobble > 1 ? RING : PID_COLORS.p)
        s.sub(t)
      },
      readouts: (p) => {
        const q = poParams(p)
        const { run, rest: r, m, wobble } = poRun(q)
        const err = ARM.target - run[run.length - 1].th
        return [
          { label: 'Steady-state error (load / Kp)', value: wobble > 1 ? `still swinging ±${deg(wobble / 2)}` : `${deg(err)} (theory ${deg(ARM.target - r)})`, tone: wobble > 1 ? 'bad' : err > 5 ? 'warn' : 'ok' },
          { label: 'Rise time, 10 → 90 % of its rest', value: secs(m.rise) },
          { label: 'Overshoot past its rest', value: pct(m.overshoot), tone: m.overshoot > 0.2 ? 'bad' : m.overshoot > 0.05 ? 'warn' : 'ok' },
          { label: 'Load to hold 40°', value: pct(loadDuty(ARM.target, q.grams)) },
        ]
      },
    }
  },
}

// --- Integral windup: arm held at 5° while I sums the error; on release the stored I drives a huge overshoot; clamp / back-calculation fix it. ---

const WINDUP: Record<'none' | 'clamp' | 'back', string> = { none: 'No anti-windup', clamp: 'Clamp (stop integrating)', back: 'Back-calculation' }
const WU = { kp: 0.025, kd: 0.0015, block: 5, seconds: 4 }
const wuParams = (p: Params) => ({ aw: pick(WINDUP, p.aw, 'none'), ki: n(p, 'ki') / 100, until: n(p, 'hold') })
type WuQ = ReturnType<typeof wuParams>
const wuKey = (q: WuQ) => `${q.aw}|${q.ki}|${q.until}`
const wuCfg = (q: WuQ, aw = q.aw): ArmCfg => ({ pid: { kp: WU.kp, ki: q.ki, kd: WU.kd, limit: 1, antiWindup: aw, backGain: 10 }, block: { deg: WU.block, until: q.until }, seconds: WU.seconds })
const wuRun = memoBy(wuKey, (q: WuQ) => {
  const run = armRun(wuCfg(q))
  const at = Math.round(q.until / ARM.dt)
  const after = run.slice(at)
  const peak = Math.max(...after.map((f) => f.th))
  const last = after.reduce((k, f, j) => (Math.abs(f.th - ARM.target) > 2 ? j : k), -1)
  const ghost = Math.max(...armRun(wuCfg(q, 'none')).slice(at).map((f) => f.th))
  return { run, peak, ghost, iAt: run[at - 1].i, back: last === after.length - 1 ? null : (last + 1) * ARM.dt }
})

export const integralWindup: Lesson = {
  id: 'pid-integral-windup',
  title: 'Integral windup',
  tagline: 'Hold the arm, let I pile up, then let go',
  formula: (p) => {
    const q = wuParams(p)
    const law = q.aw === 'clamp' ? 'while u is clipped and e pushes further: hold I' : q.aw === 'back' ? 'I += (Ki·e + Kb·(u − u_raw))·dt, Kb 10/s' : 'I += Ki·e·dt, always'
    return `u = Kp·e + I + Kd·de/dt, clipped to ±100 % · ${law} · held ${q.until} s with e ≈ ${ARM.target - WU.block}° → Ki·e·t = ${pct(q.ki * (ARM.target - WU.block) * (q.until - ARM.stepAt))} of I if nothing stops it`
  },
  legend: [LEGEND.th, LEGEND.sp, LEGEND.i, { color: HIGH_V, label: 'Arm held at 5°; u clipped', shape: 'dot' }],
  points: [
    'The I term fixes P\'s standing error: it sums the error over time, I = Ki·∫e dt, so any gap left keeps adding duty until it is gone. That is why the arm reaches exactly 40° with I and stops short without it.',
    'Now hold the arm at 5° (a hand, a jammed gear, a robot pushing a wall). The motor is already at 100 %, so more command does nothing, but the error is still 35° and the integrator keeps summing: after a second it holds several hundred per cent of duty. That is windup.',
    'Let go and the stored integral drives the motor at full power until it has been unwound, which takes negative error: the arm flies far past 40° (here toward the top stop) before it comes back. The longer it was held and the bigger Ki, the worse.',
    'Anti-windup stops the pile-up. Clamping (conditional integration) freezes I while the output is clipped and the error would push it further. Back-calculation bleeds I by the amount the output is clipped, so it hovers at what the motor can actually deliver. Either way the release overshoot is close to a normal step. Every real PID needs one of these.',
  ],
  controls: [
    { kind: 'choice', key: 'aw', options: opts(WINDUP), initial: 'none' },
    { kind: 'slider', key: 'ki', label: 'Ki (integral)', min: 2, max: 12, step: 1, initial: 6, format: (v) => `${v} %/(°·s)` },
    { kind: 'slider', key: 'hold', label: 'Held until', min: 0.6, max: 2.4, step: 0.2, initial: 1.6, format: (v) => `${v.toFixed(1)} s` },
  ],
  build(): Stage {
    const s = pidStage('PID', { seconds: WU.seconds })
    const releaseTr = s.plot.trace(HIGH_V, { samples: 2, radius: 0.035 })
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = wuParams(p)
        const { run, iAt } = wuRun(q)
        const t = s.clock(dt, wuKey(q))
        const u = q.until / WU.seconds
        releaseTr.points([u, u], [-SCOPE.h / 2, SCOPE.h / 2])
        const f = s.show(dt, run, t, 0, q.aw === 'none' ? 'PID' : q.aw === 'clamp' ? 'PID + clamp' : 'PID + back-calc')
        s.arm.peg(dt, f.blocked ? WU.block : null)
        s.status.set(`Integral windup · ${WINDUP[q.aw]} · Ki ${kiText(q.ki)}`, LABEL)
        if (t < ARM.stepAt) s.event.set('a hand holds the arm at 5°; setpoint about to jump to 40°', GREY)
        else if (f.blocked) s.event.set(q.aw === 'none' ? `held: motor at 100 %, yet I keeps summing → I = ${pct(f.i)}` : `held: u clipped, so I is ${q.aw === 'clamp' ? 'frozen' : 'bled back'} at ${pct(f.i)}`, f.i > 1 ? HIGH_V : PID_COLORS.i)
        else if (f.th > ARM.target + 3) s.event.set(`released with I = ${pct(iAt)}: ${iAt > 1 ? 'flying past while I unwinds' : 'an ordinary overshoot'}, ${deg(f.th)}`, iAt > 1 ? HIGH_V : RING)
        else s.event.set(`I = ${pct(f.i)}: holds the arm at the target`, PID_COLORS.i)
        s.sub(t)
      },
      readouts: (p) => {
        const q = wuParams(p)
        const { peak, ghost, iAt, back } = wuRun(q)
        return [
          { label: 'Peak after release', value: `${deg(peak)} (+${deg(peak - ARM.target)})`, tone: peak - ARM.target > 20 ? 'bad' : peak - ARM.target > 8 ? 'warn' : 'ok' },
          { label: 'I term at release', value: pct(iAt), tone: iAt > 1 ? 'bad' : 'ok' },
          { label: 'Back within ±2° after release', value: back === null ? `not by ${WU.seconds} s` : secs(back), tone: back === null || back > 1.5 ? 'warn' : 'ok' },
          { label: 'Peak without anti-windup', value: deg(ghost) },
        ]
      },
    }
  },
}

// --- Derivative kick: a setpoint step spikes D on error; D on measurement doesn't; D amplifies pot noise, a low-pass on D tames it. ---

const D_ON: Record<'error' | 'meas', string> = { error: 'D on error', meas: 'D on measurement' }
const DK = { kp: 0.027, ki: 0.09, kd: 0.002 }
const dkParams = (p: Params) => ({ on: pick(D_ON, p.on, 'error'), tau: n(p, 'tau') / 1000, noise: n(p, 'noise') })
type DkQ = ReturnType<typeof dkParams>
const dkKey = (q: DkQ) => `${q.on}|${q.tau}|${q.noise}`
const dkRun = memoBy(dkKey, (q: DkQ) => {
  const run = armRun({ pid: { ...DK, limit: 1, antiWindup: 'clamp', dOnMeas: q.on === 'meas', dTau: q.tau }, noiseDeg: q.noise })
  const kick = Math.max(...run.slice(FROM, FROM + 3).map((f) => Math.abs(f.d)))
  const tail = run.slice(-Math.round(1 / ARM.dt))
  return { run, kick, jitter: rms(tail.map((f) => f.u)), dNoise: rms(tail.map((f) => f.d)), m: metricsOf(run) }
})

export const derivativeKick: Lesson = {
  id: 'pid-derivative-kick',
  title: 'Derivative kick',
  tagline: 'D reacts to change, including the ones you did not mean',
  formula: (p) => {
    const q = dkParams(p)
    const d = q.on === 'meas' ? 'D = −Kd·dθ/dt' : 'D = Kd·de/dt'
    const f = q.tau > 0 ? ` through a ${(1 / (2 * Math.PI * q.tau)).toFixed(0)} Hz low-pass (τ ${Math.round(q.tau * 1000)} ms)` : ', unfiltered'
    return `${d}${f} · step 40° in one 5 ms tick → de/dt = 8000 °/s × Kd ${kdText(DK.kd)} = ${pct(DK.kd * 8000)} on error · pot noise σ ${deg(q.noise)} → ~${(q.noise * Math.SQRT2 / ARM.dt).toFixed(0)} °/s of fake rate`
  },
  legend: [LEGEND.th, LEGEND.sp, LEGEND.p, LEGEND.d],
  points: [
    'D is the damper: it pushes against how fast the error is changing, Kd·de/dt, braking the arm as it closes in so P can be stronger without ringing (see Tilt PID, where D from the gyro keeps a balancer up).',
    'The catch is the setpoint step. The error jumps 40° in one 5 ms tick, so de/dt is 8000 °/s and D fires a spike many times full scale. The motor is slammed to 100 % for a tick: a jolt in the gearbox, a current spike, and a scope full of noise. That is derivative kick.',
    'The fix is to differentiate the measurement instead of the error: D = −Kd·dθ/dt. When the arm is not moving, D sees nothing, whatever the setpoint does; once it moves, damping is exactly the same. Most real PID code does this (and P on measurement is a further step).',
    'Second catch: derivatives amplify noise. A pot reading that jitters ±0.3° between 5 ms samples looks like ±85 °/s of motion, so D shakes the motor command by tens of per cent even at rest; D on measurement does not help here. A low-pass on D (τ 10–30 ms) calms it, at the cost of a slightly later brake. Too much filter and D stops damping.',
  ],
  controls: [
    { kind: 'choice', key: 'on', options: opts(D_ON), initial: 'error' },
    { kind: 'slider', key: 'tau', label: 'D filter τ', min: 0, max: 40, step: 5, initial: 0, format: (v) => (v ? `${v} ms` : 'off') },
    { kind: 'slider', key: 'noise', label: 'Pot noise σ', min: 0, max: 1, step: 0.1, initial: 0.3, format: (v) => `${v.toFixed(1)}°` },
  ],
  build(): Stage {
    const s = pidStage('PID', { noise: true })
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = dkParams(p)
        const { run, kick, jitter } = dkRun(q)
        const t = s.clock(dt, dkKey(q))
        const f = s.show(dt, run, t, 0, q.on === 'meas' ? 'PI−D(meas)' : 'PID', q.noise)
        s.status.set(`Derivative kick · ${D_ON[q.on]} · filter ${q.tau ? `${Math.round(q.tau * 1000)} ms` : 'off'} · noise ${deg(q.noise)}`, LABEL)
        if (t < ARM.stepAt) s.event.set('setpoint about to jump 0 → 40° in one tick', GREY)
        else if (t < ARM.stepAt + 0.1) s.event.set(q.on === 'meas' ? 'step: D watches the arm, not the setpoint: no kick' : `kick! D = ${pct(kick)} for a tick: motor slammed to 100 %`, q.on === 'meas' ? POWER : HIGH_V)
        else if (t > ARM.stepAt + 1.2) s.event.set(q.noise ? `at rest, yet D turns pot noise into ${pct(jitter)} RMS of motor jitter` : 'at rest: no noise, D is quiet', jitter > 0.05 ? HIGH_V : POWER)
        else s.event.set(`D ${pct(f.d)} brakes the swing as the arm closes in`, PID_COLORS.d)
        s.sub(t)
      },
      readouts: (p) => {
        const q = dkParams(p)
        const { kick, jitter, m } = dkRun(q)
        return [
          { label: 'D term at the setpoint step', value: pct(kick), tone: kick > 1 ? 'bad' : 'ok' },
          { label: 'Motor jitter at rest (RMS)', value: pct(jitter), tone: jitter > 0.08 ? 'bad' : jitter > 0.03 ? 'warn' : 'ok' },
          { label: 'Overshoot · settling ±2 %', value: `${pct(m.overshoot)} · ${secs(m.settle)}` },
          { label: 'D filter cutoff', value: q.tau ? `${(1 / (2 * Math.PI * q.tau)).toFixed(0)} Hz` : 'none' },
        ]
      },
    }
  },
}

// --- Tuning by hand: Kp/Ki/Kd sliders, live rise/overshoot/settling against a target box. ---

const BOX = { rise: 0.3, overshoot: 0.05, settle: 0.8, band: 0.02 }
const tuParams = (p: Params) => ({ kp: n(p, 'kp') / 100, ki: n(p, 'ki') / 100, kd: n(p, 'kd') / 100 })
type TuQ = ReturnType<typeof tuParams>
const tuKey = (q: TuQ) => `${q.kp}|${q.ki}|${q.kd}`
const tuRun = memoBy(tuKey, (q: TuQ) => {
  const run = armRun({ pid: { ...q, limit: 1, antiWindup: 'clamp', dOnMeas: true } })
  const m = metricsOf(run)
  const ok = { rise: m.rise !== null && m.rise <= BOX.rise, overshoot: m.overshoot <= BOX.overshoot, settle: m.settle !== null && m.settle <= BOX.settle }
  return { run, m, ok, hits: Object.values(ok).filter(Boolean).length }
})
function tuHint(q: TuQ, r: ReturnType<typeof tuRun>) {
  const { m, ok } = r
  if (r.hits === 3) return 'tuned!'
  if (m.overshoot > 0.15) return q.kd < 0.003 ? 'rings: add Kd to damp it' : 'still overshoots: lower Kp or Ki'
  if (Math.abs(m.final - ARM.target) > 0.8 && q.ki === 0) return 'stops short: add Ki to remove the gap'
  if (!ok.rise) return 'too slow: raise Kp'
  if (!ok.overshoot) return 'a bit of overshoot: a touch more Kd or less Ki'
  return 'slow to settle: balance Ki against Kd'
}

export const tuningByHand: Lesson = {
  id: 'pid-tuning-by-hand',
  title: 'Tuning by hand',
  tagline: 'Three knobs, one target box',
  formula: (p) => {
    const q = tuParams(p)
    return `u = ${kpText(q.kp)}·e + ${kiText(q.ki)}·∫e dt + ${kdText(q.kd)}·de/dt (D on measurement, clamped I) · target: rise ≤ ${BOX.rise} s, overshoot ≤ ${pct(BOX.overshoot)}, within ±${pct(BOX.band)} by ${BOX.settle} s`
  },
  legend: [LEGEND.th, LEGEND.sp, LEGEND.id, { color: POWER, label: 'Target box: overshoot cap, ±2 % band', shape: 'dot' }],
  points: [
    'Tuning is choosing Kp, Ki and Kd for the response you want. Write the goal as numbers: rise time (10 → 90 % of the step), overshoot (how far past, as a share of the step) and settling time (until it stays within ±2 %). Here: up in 0.3 s, under 5 % over, settled by 0.8 s.',
    'The classic manual recipe: start with Ki and Kd at zero. Raise Kp until the response is quick but rings a little. Add Kd until the ringing is damped. Then add Ki just until the steady-state gap closes in good time; too much I brings the overshoot back as a slow bulge.',
    'Every knob trades something. Kp: faster but more overshoot. Ki: no gap but slower settling and overshoot. Kd: less overshoot, but noise (see Derivative kick) and, past a point, a sluggish creep. The motor\'s 100 % limit caps how fast any tuning can rise.',
    'Change one knob at a time and watch the scope. Real rigs tune the same way, but on hardware with a step test logged over serial; the plant changes with load and battery, so leave margin. A good start here: Kp 3, Ki 8, Kd 0.4.',
  ],
  controls: [
    { kind: 'slider', key: 'kp', label: 'Kp', min: 0, max: 6, step: 0.25, initial: 2, format: (v) => `${v.toFixed(2)} %/°` },
    { kind: 'slider', key: 'ki', label: 'Ki', min: 0, max: 20, step: 1, initial: 0, format: (v) => `${v} %/(°·s)` },
    { kind: 'slider', key: 'kd', label: 'Kd', min: 0, max: 0.6, step: 0.05, initial: 0, format: (v) => `${v.toFixed(2)} %/(°/s)` },
  ],
  build(): Stage {
    const s = pidStage('PID')
    const ceiling = hLine(s, POWER)
    const bandHi = hLine(s, POWER)
    const bandLo = hLine(s, POWER)
    const gate = s.plot.trace(POWER, { samples: 2, radius: 0.035 })
    const boxTag = liveLabel(s.scene, [0, 0, 0.3], { size: 0.24, color: POWER, align: 'left' })
    const u0 = (ARM.stepAt + BOX.settle) / ARM.seconds
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = tuParams(p)
        const r = tuRun(q)
        const t = s.clock(dt, tuKey(q))
        ceiling(ARM.target * (1 + BOX.overshoot))
        bandHi(ARM.target * (1 + BOX.band), u0)
        bandLo(ARM.target * (1 - BOX.band), u0)
        gate.points([u0, u0], [s.yDeg(ARM.target * (1 - BOX.band)), s.yDeg(ARM.target * (1 + BOX.band))])
        boxTag.group.position.set(s.xAt(ARM.stepAt + BOX.settle) + 0.15, SCOPE.y + s.yDeg(ARM.target * 1.05) + 0.35, 0.3)
        boxTag.set(`≤ ${pct(BOX.overshoot)} over · settled by ${BOX.settle} s`, POWER)
        s.show(dt, r.run, t, 0, 'PID')
        s.status.set(`Tuning by hand · Kp ${(q.kp * 100).toFixed(2)} · Ki ${(q.ki * 100).toFixed(0)} · Kd ${(q.kd * 100).toFixed(2)}`, LABEL)
        s.event.set(`${r.hits} / 3 in the box · ${tuHint(q, r)}`, r.hits === 3 ? POWER : r.hits ? RING : HIGH_V)
        s.sub(t)
      },
      readouts: (p) => {
        const { m, ok, hits } = tuRun(tuParams(p))
        return [
          { label: `Rise time (≤ ${BOX.rise} s)`, value: secs(m.rise), tone: ok.rise ? 'ok' : 'bad' },
          { label: `Overshoot (≤ ${pct(BOX.overshoot)})`, value: `${(m.overshoot * 100).toFixed(1)} %`, tone: ok.overshoot ? 'ok' : 'bad' },
          { label: `Settling ±${pct(BOX.band)} (≤ ${BOX.settle} s)`, value: m.settle === null ? `not settled · ends ${deg(m.final)}` : secs(m.settle), tone: ok.settle ? 'ok' : 'bad' },
          { label: 'Target box', value: hits === 3 ? 'hit' : `${hits} / 3`, tone: hits === 3 ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Ziegler–Nichols: raise P until it oscillates steadily (Ku, Tu), read the gains off the table; classic ZN is aggressive → detune. ---

const ZN_MODES = { find: '1 · Find Ku (P only)', ...Object.fromEntries((['classic', 'some', 'none'] as const).map((k) => [k, `ZN: ${ZN_RULES[k].name}`])) } as Record<'find' | 'classic' | 'some' | 'none', string>
const ZN = { seconds: 6, from: Math.round(1.5 / ARM.dt) }
const ultimate = memoBy(
  () => 'arm',
  () => ultimateGain((kp) => armRun({ pid: { kp, ki: 0, kd: 0, limit: 1 }, seconds: ZN.seconds }).map((f) => f.th), ARM.dt, 0.005, 1, ZN.from),
)
const znParams = (p: Params) => ({ mode: pick(ZN_MODES, p.mode, 'find'), kp: n(p, 'kp') / 100, detune: n(p, 'detune') / 100 })
type ZnQ = ReturnType<typeof znParams>
const znGains = (q: ZnQ) => {
  if (q.mode === 'find') return { kp: q.kp, ki: 0, kd: 0 }
  const { ku, tu } = ultimate(null)
  const g = zieglerNichols(ku, tu, q.mode as ZnRule)
  return { kp: g.kp * q.detune, ki: g.ki * q.detune ** 2, kd: g.kd * q.detune }
}
const znKey = (q: ZnQ) => (q.mode === 'find' ? `find|${q.kp}` : `${q.mode}|${q.detune}`)
const znRun = memoBy(znKey, (q: ZnQ) => {
  const g = znGains(q)
  const run = armRun({ pid: { ...g, limit: 1, antiWindup: 'clamp' }, seconds: ZN.seconds })
  return { run, g, m: metricsOf(run), sw: swing(run.map((f) => f.th), ARM.dt, ZN.from) }
})
const swingText = (r: number | undefined) => (r === undefined ? 'no swing' : r < 0.9 ? `dies out (×${r.toFixed(2)} per cycle)` : r < 0.98 ? `almost steady (×${r.toFixed(2)})` : 'sustained')

export const zieglerNicholsLesson: Lesson = {
  id: 'pid-ziegler-nichols',
  title: 'Ziegler–Nichols',
  tagline: 'Find the edge of oscillation, then back off by rule',
  formula: (p) => {
    const q = znParams(p)
    const { ku, tu } = ultimate(null)
    if (q.mode === 'find') return `P only, Kp ${kpText(q.kp)} · raise it until the swing neither grows nor dies: that Kp is Ku, its period Tu · here Ku ≈ ${kpText(ku)}, Tu ≈ ${tu.toFixed(2)} s`
    const r = ZN_RULES[q.mode as ZnRule]
    return `Kp = ${r.kp.toFixed(2)}·Ku · Ti = ${r.ti.toFixed(2)}·Tu · Td = ${r.td.toFixed(3)}·Tu → Kp ${kpText(znGains(q).kp)}, Ki = Kp/Ti ${kiText(znGains(q).ki)}, Kd = Kp·Td ${kdText(znGains(q).kd)}${q.detune < 1 ? ` · detuned ×${q.detune.toFixed(2)} (Ki ×${(q.detune ** 2).toFixed(2)})` : ''}`
  },
  legend: [LEGEND.th, LEGEND.sp, LEGEND.p, LEGEND.id],
  points: [
    'Ziegler and Nichols (1942) gave a recipe that needs no model of the plant, only one experiment. Set Ki and Kd to zero and raise Kp step by step until the output swings steadily, neither dying out nor growing. That gain is the ultimate gain Ku, and the swing\'s period is Tu.',
    'On this arm the swing stops dying out at Ku ≈ 4.5 %/°, with Tu ≈ 0.58 s. Below it every step rings down; above it the swing grows until the motor\'s 100 % limit caps it. On a real machine do this carefully: a sustained oscillation is hard on gears and on whatever the arm is holding.',
    'Then read the gains off the table. Classic PID: Kp = 0.6·Ku, Ti = Tu/2, Td = Tu/8. It is meant to be aggressive: fast, with a quarter-amplitude decay, so about 20–25 % overshoot here. Fine for rejecting disturbances, too lively for a positioning arm.',
    'So engineers detune: the "some overshoot" and "no overshoot" rows cut Kp to 0.33 and 0.2·Ku and lengthen Td, or scale the classic gains down (Kp and Kd × f, Ki × f²). ZN is a starting point, not an answer; finish by hand (previous lesson).',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(ZN_MODES), initial: 'find' },
    { kind: 'slider', key: 'kp', label: 'Kp (find mode)', min: 1, max: 6, step: 0.25, initial: 3, format: (v) => `${v.toFixed(2)} %/°` },
    { kind: 'slider', key: 'detune', label: 'Detune ZN gains', min: 40, max: 100, step: 5, initial: 100, format: (v) => `×${(v / 100).toFixed(2)}` },
  ],
  build(): Stage {
    const s = pidStage('P', { seconds: ZN.seconds, slow: 0.5 })
    const periodBar = addRod(s.scene, glowMat(RING, 0.9))
    const periodTag = liveLabel(s.scene, [0, 0, 0.3], { size: 0.24, color: RING, align: 'right' })
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = znParams(p)
        const { run, sw } = znRun(q)
        const { ku, tu } = ultimate(null)
        const t = s.clock(dt, znKey(q))
        s.show(dt, run, t, 0, q.mode === 'find' ? `P ${(q.kp * 100).toFixed(2)}%/°` : 'ZN PID')
        const showT = q.mode === 'find' && sw && sw.ratio > 0.9 && t > ZN.seconds - 0.2
        periodBar.visible = periodTag.group.visible = !!showT
        if (showT && sw) {
          const t1 = ZN.seconds - 0.3
          const y = SCOPE.y - SCOPE.h / 2 - 0.5
          stretchRod(periodBar, [s.xAt(t1 - sw.period), y, 0.3], [s.xAt(t1), y, 0.3], 0.05)
          periodTag.group.position.set(s.xAt(t1 - sw.period) - 0.2, y, 0.3)
          periodTag.set(`one swing ${sw.period.toFixed(2)} s`, RING)
        }
        s.status.set(q.mode === 'find' ? `Ziegler–Nichols step 1 · P only, Kp ${kpText(q.kp)}` : `Ziegler–Nichols · ${ZN_RULES[q.mode as ZnRule].name}${q.detune < 1 ? ` × ${q.detune.toFixed(2)}` : ''} · Ku ${kpText(ku)}, Tu ${tu.toFixed(2)} s`, LABEL)
        if (q.mode === 'find') {
          const r = sw?.ratio ?? 0
          s.event.set(sw && r >= 0.98 ? `sustained swing: Ku ≈ ${kpText(q.kp)}, Tu = ${sw.period.toFixed(2)} s → now pick a row` : `${swingText(sw?.ratio)}: ${r >= 0.9 ? 'nearly there' : 'raise Kp'}`, r >= 0.98 ? POWER : RING)
        } else {
          const os = znRun(q).m.overshoot
          s.event.set(os > 0.15 ? `aggressive: ${pct(os)} overshoot · pick a calmer row or detune` : os > 0.02 ? `${pct(os)} overshoot · close to a usable tune` : 'no overshoot: calm, if a little slow', os > 0.15 ? HIGH_V : os > 0.02 ? RING : POWER)
        }
        s.sub(t)
      },
      readouts: (p) => {
        const q = znParams(p)
        const { m, sw, g } = znRun(q)
        const { ku, tu } = ultimate(null)
        if (q.mode === 'find')
          return [
            { label: 'Last swing vs the one before', value: swingText(sw?.ratio), tone: sw && sw.ratio >= 0.98 ? 'ok' : 'warn' },
            { label: 'Swing period', value: sw ? `${sw.period.toFixed(2)} s` : '—' },
            { label: 'Kp vs Ku', value: `${kpText(q.kp)} vs ${kpText(ku)}`, tone: Math.abs(q.kp - ku) < 0.003 ? 'ok' : undefined },
            { label: 'Ultimate period Tu', value: `${tu.toFixed(2)} s` },
          ]
        return [
          { label: 'Overshoot', value: pct(m.overshoot), tone: m.overshoot > 0.15 ? 'bad' : m.overshoot > 0.05 ? 'warn' : 'ok' },
          { label: 'Rise · settling ±2 %', value: `${secs(m.rise)} · ${secs(m.settle)}` },
          { label: 'Ku · Tu', value: `${kpText(ku)} · ${tu.toFixed(2)} s` },
          { label: 'Kp · Ki · Kd', value: `${(g.kp * 100).toFixed(2)} · ${(g.ki * 100).toFixed(1)} · ${(g.kd * 100).toFixed(2)}` },
        ]
      },
    }
  },
}
