import { ARM, ArmFrame, FilterPlace, MeasFilter, NO_FILTER, SpeedFrame, WHEEL, armRun, dTauFor, emaAlpha, filterAt, filterDelay, filterRun, filteredLoopAt, filteredMargins, fixedStepAt, kalmanSpeed, noiseGain, placePd, speedStats, stepMetrics, stepSp, wheelCpr, wheelSpeedRun, ARM_FROM, decibels, stdDev } from '../../core/physics'
import { pct, degText, secsText } from '../../core/units'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, DATA_COLOR, GREY, HEAT, HIGH_V, LABEL, MEAS_COLOR, POWER, RING, SIDE_SCOPE, addLabel, addRod, controlLoop, glowMat, liveLabel, memoBy, pidArm, scope, scopeLabels, statusHeader, stretchRod, termBars, traceRun, lapseClock, sideScope } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'
import { speedStage } from './speed-control'

const VIEW = { center: [-2.2, -1.3, 0] as V3, radius: 54, polar: 1.45, azimuth: 0 }
const TOP = { y: 1.2, h: 6 }
const SCOPE = { y: -6.3, h: 4, split: 0.4 }
const RIG = { at: [-11.6, 1.3, 0] as V3, len: 5.2, bars: [-11.2, -6.5, 0] as V3, rest: 1.2 }
const ST = { from: 30, target: 40, seconds: 2.5, slow: 0.4, lo: 28, hi: 46, lag: 0.01, hold: 1.5 }
const GAINS = placePd(0.7, 12, ST.target)
const ms = (s: number) => `${Math.round(s * 1000)} ms`
const pmText = (pm: number | null) => (pm === null ? '∞' : degText(pm, 0))
const pmTone = (pm: number | null) => (pm === null || pm >= 45 ? 'ok' : pm > 20 ? 'warn' : 'bad')
const ARM_LEGEND = {
  th: { color: RING, label: `Arm angle (scope top ${ST.lo}…${ST.hi}°)`, shape: 'dot' as const },
  raw: { color: GREY, label: 'Raw pot reading (noisy)', shape: 'dot' as const },
  seen: { color: DATA_COLOR, label: 'What the controller sees', shape: 'dot' as const },
  u: { color: POWER, label: 'Motor duty (scope bottom ±100 %)', shape: 'dot' as const },
}

/** 30 → 40° step, PD on measurement + spring/gravity feed-forward, noisy pot, `f` on the reading or (`d`) only in D. */
function armFiltered(f: MeasFilter, place: FilterPlace, noise: number) {
  const dTau = place === 'd' && f.kind === 'ema' ? dTauFor(f.alpha) : 0
  const run = armRun({ pid: { ...GAINS, limit: 2, dOnMeas: true, dTau }, from: ST.from, target: ST.target, ff: true, lag: ST.lag, seconds: ST.seconds, noiseDeg: noise, filter: place === 'meas' ? filterRun(f) : undefined })
  const hold = run.filter((r) => r.t >= ST.hold)
  return {
    run,
    m: stepMetrics(run.map((r) => r.th), ARM.dt, ARM_FROM, ST.from, ST.target),
    buzz: stdDev(hold.map((r) => r.u)),
    pBuzz: stdDev(hold.map((r) => r.p)),
    mg: filteredMargins(GAINS, ST.lag, ST.target, f, place),
  }
}

/** Arm rig + term bars left; top-right slot for a diagram or Bode; scope bottom-right (angle above, duty below). */
function armStage() {
  const scene = createStage({ span: 40 })
  const head = statusHeader(scene)
  const arm = pidArm(scene, RIG.at, RIG.len)
  const bars = termBars(scene, RIG.bars, 7)
  const plot = sideScope(scene, SCOPE.y, SCOPE.h, { divs: [5, 5], zeroAt: SCOPE.split / 2 })
  scopeLabels(scene, SCOPE.y, SCOPE.h, ST.seconds, `angle ${ST.lo}…${ST.hi}°`, 'duty ±100 %')
  const uTr = plot.trace(POWER, { samples: 400, radius: 0.025 })
  const spTr = plot.trace(B_FIELD, { samples: 200, radius: 0.035 })
  const rawTr = plot.trace(GREY, { samples: 500, radius: 0.02 })
  const seenTr = plot.trace(DATA_COLOR, { samples: 400, radius: 0.035 })
  const thTr = plot.trace(RING, { samples: 260, radius: 0.07 })
  const bottom = -SCOPE.h / 2
  const split = bottom + SCOPE.split * SCOPE.h
  const yDeg = (d: number) => split + 0.1 + ((Math.max(ST.lo, Math.min(ST.hi, d)) - ST.lo) / (ST.hi - ST.lo)) * (SCOPE.h / 2 - split - 0.1)
  const yDuty = (u: number) => bottom + (SCOPE.split * SCOPE.h) / 2 + Math.max(-1, Math.min(1, u)) * (SCOPE.split * SCOPE.h) * 0.46
  return {
    scene,
    ...head,
    clock: lapseClock(ST.seconds, ST.slow, RIG.rest * ST.slow),
    show(dt: number, run: ArmFrame[], t: number, seen = true) {
      const f = fixedStepAt(run, t, ARM.dt)
      traceRun(uTr, run, ARM.dt, ST.seconds, t, (g) => yDuty(g.u), 400)
      traceRun(spTr, run, ARM.dt, ST.seconds, t, (g) => yDeg(g.sp), 200)
      traceRun(rawTr, run, ARM.dt, ST.seconds, t, (g) => yDeg(g.meas), 500)
      seenTr.group.visible = seen
      if (seen) traceRun(seenTr, run, ARM.dt, ST.seconds, t, (g) => yDeg(g.seen), 400)
      traceRun(thTr, run, ARM.dt, ST.seconds, t, (g) => yDeg(g.th), 260)
      arm.set(dt, f.th, f.sp, f.u)
      bars.set({ p: f.p, i: f.i, d: f.d, u: f.u }, Math.abs(f.u) >= 0.999)
      return f
    },
    sub(t: number, extra: string) {
      head.sub.set(`${t.toFixed(2)} / ${ST.seconds} s · slowed ${1 / ST.slow}× · loop ${Math.round(1 / ARM.dt)} Hz · PD + feed-forward · ${extra}`)
    },
  }
}

// --- Moving average: N samples cut white noise by √N but delay the reading (N − 1)/2 samples; the delay eats phase margin. ---

const maParams = (p: Params) => ({ n: Math.max(1, Math.round(n(p, 'win') / (ARM.dt * 1000))), noise: n(p, 'noise') })
type MaQ = ReturnType<typeof maParams>
const maKey = (q: MaQ) => `${q.n}|${q.noise}`
const maFilter = (q: MaQ): MeasFilter => (q.n > 1 ? { kind: 'ma', n: q.n } : NO_FILTER)
const maData = memoBy(maKey, (q: MaQ) => armFiltered(maFilter(q), 'meas', q.noise))

export const movingAverage: Lesson = {
  id: 'filters-in-the-loop-moving-average',
  title: 'Moving average',
  tagline: 'Smoother reading, later reading',
  formula: (p) => {
    const q = maParams(p)
    const f = maFilter(q)
    return `seen = (x₀ + x₁ + … + x₍N−1₎) / N, N = ${q.n} × ${ms(ARM.dt)} · noise × 1/√N = ×${noiseGain(f).toFixed(2)} · delay (N − 1)/2 samples = ${ms(filterDelay(f))} → phase −ω·${ms(filterDelay(f))} at every frequency`
  },
  legend: [ARM_LEGEND.th, ARM_LEGEND.raw, { ...ARM_LEGEND.seen, label: 'Averaged reading (what the PD sees)' }, ARM_LEGEND.u],
  points: [
    'The PID arm again: a PD loop at 200 Hz steps it from 30° to 40°. The pot reading carries ADC noise (the slider sets its RMS). D multiplies the reading\'s slope, and a slope from noise is huge: 0.5° of jitter between two samples 5 ms apart looks like 100°/s. With no filter the duty slams between the limits and the motor buzzes.',
    'The firmware fix is a moving average of the last N readings (Noise and averaging covers the ADC side). White noise drops by √N: 8 samples, a third of the noise. The duty calms down and the arm holds still.',
    'The cost: the average describes where the arm was (N − 1)/2 samples ago. That is a pure delay, and in a loop delay is lag with no gain change: at the crossover frequency (15 rad/s here) every 10 ms costs about 9° of phase margin. Watch the purple reading trail the yellow arm.',
    'Push the window to 100 ms and more: the arm overshoots before the controller sees it move, then rings; near 160 ms it barely settles. A good window is a few samples, well below 1/ωc. Past that, filter less and lower Kd, or use a better sensor.',
  ],
  controls: [
    { kind: 'slider', key: 'win', label: 'Average window', min: 5, max: 160, step: 5, initial: 40, format: (v) => (v <= 5 ? 'off (1 sample)' : `${v} ms (${Math.round(v / 5)} samples)`) },
    { kind: 'slider', key: 'noise', label: 'Pot noise (RMS)', min: 0, max: 1, step: 0.1, initial: 0.5, format: (v) => degText(v) },
  ],
  build(): Stage {
    const s = armStage()
    const loop = controlLoop(s.scene, [SIDE_SCOPE.x, TOP.y, 0], { ctrl: 'PD', plant: 'motor + arm', sensor: 'pot + avg', noise: true, w: 12.5, h: 4.4 })
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = maParams(p)
        const { run, mg } = maData(q)
        const t = s.clock(dt, maKey(q))
        const f = s.show(dt, run, t, q.n > 1)
        const e = f.sp - f.seen
        loop.set(
          dt,
          { r: f.sp / 60, e: Math.min(1, Math.abs(e) / 5), u: f.u, y: f.th / 60, m: f.seen / 60, n: q.noise },
          { r: degText(f.sp, 0), e: `e ${degText(e)}`, u: `u ${pct(f.u)}`, y: degText(f.th), m: q.n > 1 ? `${degText(f.seen)} (${ms(filterDelay(maFilter(q)))} old)` : degText(f.seen), n: q.noise ? `±${degText(q.noise)} noise` : 'no noise' },
          { sensor: q.n > 1 ? `pot + avg ${q.n}` : 'pot (raw)' },
        )
        const late = f.th - f.seen
        const { buzz } = maData(q)
        s.status.set(`Moving average · ${q.n > 1 ? `${q.n} samples (${ms(q.n * ARM.dt)})` : 'off'} · noise ${degText(q.noise)} · PM ${pmText(mg.pm)}`, LABEL)
        if (t < ARM.stepAt) s.event.set('holding 30°: setpoint about to step to 40°', GREY)
        else if (buzz > 0.3) s.event.set(`duty slams ±100 %: D turns pot noise into full-scale kicks · arm ${degText(f.th)}`, HIGH_V)
        else if (q.n > 1 && Math.abs(late) > 1 + 2 * q.noise * noiseGain(maFilter(q))) s.event.set(`reading ${degText(Math.abs(late))} ${late > 0 ? 'behind' : 'ahead of'} the arm: the PD reacts to where it was`, HEAT)
        else s.event.set(`seen ${degText(f.seen)} · arm ${degText(f.th)} · duty ${pct(f.u)}`, RING)
        s.sub(t, `pot ${ms(ST.lag)} late`)
      },
      readouts: (p) => {
        const q = maParams(p)
        const { m, buzz, mg } = maData(q)
        const f = maFilter(q)
        return [
          { label: 'Duty noise while holding (RMS)', value: pct(buzz), tone: buzz > 0.2 ? 'bad' : buzz > 0.08 ? 'warn' : 'ok' },
          { label: 'Overshoot · settle (±2 %)', value: `${pct(m.overshoot)} · ${secsText(m.settle)}`, tone: m.overshoot > 0.3 || m.settle === null ? 'bad' : m.overshoot > 0.1 ? 'warn' : 'ok' },
          { label: 'Phase margin', value: pmText(mg.pm), tone: pmTone(mg.pm) },
          { label: 'Filter delay · noise left', value: `${ms(filterDelay(f))} · ×${noiseGain(f).toFixed(2)}` },
        ]
      },
    }
  },
}

// --- Low-pass: a one-pole filter on the reading lags P and D alike; the same filter inside D only leaves P on fresh data. ---

const PLACES = { meas: 'Filter the reading', d: 'Filter D only' }
const LP_NOISE = 0.4
const lpParams = (p: Params) => ({ place: pick(PLACES, p.place, 'meas'), tau: n(p, 'tau') / 1000 })
type LpQ = ReturnType<typeof lpParams>
const lpKey = (q: LpQ) => `${q.place}|${q.tau}`
const lpFilter = (q: LpQ): MeasFilter => (q.tau > 0 ? { kind: 'ema', alpha: emaAlpha(ARM.dt, q.tau) } : NO_FILTER)
const lpData = memoBy(lpKey, (q: LpQ) => ({ ...armFiltered(lpFilter(q), q.place, LP_NOISE), bare: filteredMargins(GAINS, ST.lag, ST.target, NO_FILTER) }))
const BODE = { w0: 1, decades: 2, db: 20, h: 5.4 }

export const lowPass: Lesson = {
  id: 'filters-in-the-loop-low-pass',
  title: 'Low-pass',
  tagline: 'Where the filter sits matters',
  formula: (p) => {
    const q = lpParams(p)
    const f = lpFilter(q)
    const { mg, bare } = lpData(q)
    const lagAt = mg.wc === null ? 0 : -filterAt(f, mg.wc).phase / (Math.PI / 180)
    return `y += α(x − y), α = 1 − e^(−dt/τ) = ${f.kind === 'ema' ? f.alpha.toFixed(3) : '1'} · lag at ωc ≈ atan(ωc·τ) = ${degText(lagAt, 0)} · ${q.place === 'd' ? 'u = Kp·e − Kd·LPF(dθ/dt)' : 'u = Kp·LPF(e) − Kd·d LPF(θ)/dt'} · PM ${pmText(bare.pm)} → ${pmText(mg.pm)}`
  },
  legend: [
    { color: HEAT, label: 'Loop gain |L| (top, ±20 dB)', shape: 'dot' },
    { color: DATA_COLOR, label: 'Loop phase with the filter (0…−240°)', shape: 'dot' },
    { color: GREY, label: 'Phase with no filter · raw pot on the scope', shape: 'dot' },
    { color: POWER, label: 'Phase margin · motor duty on the scope', shape: 'dot' },
  ],
  points: [
    'The firmware low-pass y += α(x − y) is the RC filter of RC low-pass in one line: it trusts each new reading by α and remembers the rest. Time constant τ sets both how much noise it removes and how late it is: about τ at low frequency, and a phase lag of atan(ωτ) at frequency ω.',
    'Filter the whole reading and both P and D see the old value. On the Bode plot the purple phase sinks below the grey unfiltered one near crossover; the phase margin falls and the step overshoots, because the arm has already passed 40° when the controller finds out.',
    'The noise problem is really a D problem: P passes noise at Kp, D at Kd/dt, here 20× more. So filter only the D term (what pidTick\'s dTau does). P keeps reacting to fresh data and the duty noise drops almost as much. On this arm the phase margin is only a few degrees better (D does most of the work at crossover), yet at τ = 80 ms the step overshoots about 9 % instead of 45 %: a lagging reading lets the arm run past 40° before anything reacts, a lagging D only softens the brake.',
    'Rule of thumb: keep the filter corner 5–10× above the crossover (τ well under 1/(5ωc), about 13 ms here), filter D harder than P, and read the margin off the loop with the filter in it. Gain and phase margin explains the plot.',
  ],
  controls: [
    { kind: 'choice', key: 'place', options: opts(PLACES), initial: 'meas' },
    { kind: 'slider', key: 'tau', label: 'Filter τ', min: 0, max: 80, step: 5, initial: 40, format: (v) => (v ? `${v} ms` : 'off') },
  ],
  build(): Stage {
    const s = armStage()
    const bode = scope(s.scene, SIDE_SCOPE.w, BODE.h, { divs: [BODE.decades, 8], zeroAt: 0.5 })
    bode.group.position.set(SIDE_SCOPE.x, TOP.y, 0)
    const q4 = BODE.h / 4
    const wAt = (u: number) => BODE.w0 * 10 ** (u * BODE.decades)
    const uAt = (w: number) => Math.log10(w / BODE.w0) / BODE.decades
    const yMag = (m: number) => q4 + (decibels(m) / BODE.db) * q4
    const yPh = (ph: number) => (ph / Math.PI / (4 / 3)) * 2 * q4
    const bareTr = bode.trace(GREY, { samples: 160, radius: 0.04 })
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
    tick('0°', left + 0.15, TOP.y - 0.25)
    tick('−180°', left + 0.15, TOP.y + yPh(-Math.PI) + 0.25)
    for (let k = 0; k <= BODE.decades; k++) tick(`${BODE.w0 * 10 ** k}${k === BODE.decades ? ' rad/s' : ''}`, left + (k / BODE.decades) * SIDE_SCOPE.w, TOP.y - BODE.h / 2 - 0.8, k === BODE.decades ? 'right' : k ? 'center' : 'left')
    const pmBar = addRod(bode.group, glowMat(POWER, 1))
    const pmTag = liveLabel(bode.group, [0, 0, 0.35], { size: 0.26, color: POWER, align: 'right' })
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = lpParams(p)
        const f = lpFilter(q)
        const { run, mg, bare } = lpData(q)
        const t = s.clock(dt, lpKey(q))
        const L = (u: number) => filteredLoopAt(GAINS, ST.lag, ST.target, wAt(u), f, q.place)
        curve(magTr, (u) => yMag(L(u).mag), 0, 2 * q4)
        curve(phTr, (u) => yPh(L(u).phase), -2 * q4, 0)
        curve(bareTr, (u) => yPh(filteredLoopAt(GAINS, ST.lag, ST.target, wAt(u), NO_FILTER).phase), -2 * q4, 0)
        const show = mg.wc !== null && mg.pm !== null && uAt(mg.wc) >= 0 && uAt(mg.wc) <= 1
        pmBar.visible = pmTag.group.visible = show
        if (show) {
          const x = bode.xAt(uAt(mg.wc!))
          stretchRod(pmBar, [x, yPh(-Math.PI), 0.3], [x, Math.max(-2 * q4, yPh(L(uAt(mg.wc!)).phase)), 0.3], 0.08)
          pmTag.group.position.set(x - 0.15, yPh(-Math.PI) - 0.4, 0.35)
          pmTag.set(`PM ${degText(mg.pm!, 0)}`, mg.pm! < 20 ? HIGH_V : POWER)
        }
        const fr = s.show(dt, run, t, q.place === 'meas' && q.tau > 0)
        s.status.set(`Low-pass · ${PLACES[q.place]} · τ ${q.tau ? ms(q.tau) : 'off'} · PM ${pmText(bare.pm)} → ${pmText(mg.pm)}`, LABEL)
        if (t < ARM.stepAt) s.event.set('holding 30°: setpoint about to step to 40°', GREY)
        else if (fr.th > ST.target + 1) s.event.set(`overshoot ${degText(fr.th - ST.target)}: ${q.place === 'meas' ? 'the filtered reading still says ' + degText(fr.seen) : 'D is late, P is not'}`, HEAT)
        else if (Math.abs(fr.d) > 0.3) s.event.set(`D ${pct(fr.d)}: unfiltered slope noise kicks the duty`, HIGH_V)
        else s.event.set(`P ${pct(fr.p)} · D ${pct(fr.d)} · duty ${pct(fr.u)}`, RING)
        s.sub(t, `pot noise ${degText(LP_NOISE)}`)
      },
      readouts: (p) => {
        const q = lpParams(p)
        const { m, buzz, pBuzz, mg, bare } = lpData(q)
        return [
          { label: 'Phase margin (no filter → now)', value: `${pmText(bare.pm)} → ${pmText(mg.pm)}`, tone: pmTone(mg.pm) },
          { label: 'Overshoot · settle (±2 %)', value: `${pct(m.overshoot)} · ${secsText(m.settle)}`, tone: m.overshoot > 0.3 || m.settle === null ? 'bad' : m.overshoot > 0.1 ? 'warn' : 'ok' },
          { label: 'Duty noise holding (RMS)', value: pct(buzz), tone: buzz > 0.2 ? 'bad' : buzz > 0.08 ? 'warn' : 'ok' },
          { label: 'Of which the P term (RMS)', value: `${(pBuzz * 100).toFixed(1)} %` },
        ]
      },
    }
  },
}

// --- Kalman filter: a motor model predicts the speed between coarse encoder counts; low noise without the averaging lag. ---

const ESTS = { raw: 'Raw counts per 10 ms', avg50: 'Average 50 ms', avg80: 'Average 80 ms', kf: 'Kalman: model + counts' }
const KF = { sp: 140, at: 0.2, ramp: { at: 1.6, deg: 15 }, pi: { kp: 0.005, ki: 0.08, kd: 0, antiWindup: 'clamp' as const }, enc: 'slot' as const }
const CPR = wheelCpr(KF.enc)
const kfParams = (p: Params) => ({ est: pick(ESTS, p.est, 'kf'), acc: n(p, 'acc') })
type KfQ = ReturnType<typeof kfParams>
const kfKey = (q: KfQ) => `${q.est}|${q.est === 'kf' ? q.acc : ''}`
const rawRpm = (f: SpeedFrame) => (f.counts / CPR / WHEEL.loopS) * 60
const kfData = memoBy(kfKey, (q: KfQ) => {
  const window = q.est === 'avg50' ? 5 : q.est === 'avg80' ? 8 : 1
  const run = wheelSpeedRun({ sp: stepSp(KF.sp, KF.at), seconds: 3, enc: KF.enc, window, pid: KF.pi, ramp: KF.ramp, meter: q.est === 'kf' ? (cpr) => kalmanSpeed(cpr, q.acc) : undefined })
  const before = run.filter((f) => f.t < KF.ramp.at)
  const after = run.filter((f) => f.t >= KF.ramp.at)
  return {
    run,
    flat: speedStats(run, 1, KF.ramp.at),
    peak: Math.max(...before.map((f) => f.rpm)),
    dip: before[before.length - 1].rpm - Math.min(...after.map((f) => f.rpm)),
  }
})

export const kalmanFilter: Lesson = {
  id: 'filters-in-the-loop-kalman-filter',
  title: 'Kalman filter',
  tagline: 'Predict with the model, correct with counts',
  formula: (p) => {
    const q = kfParams(p)
    if (q.est !== 'kf') return `speed = Δcounts / (${CPR} counts/turn × window) · one count per 10 ms = ${(60 / (CPR * WHEEL.loopS)).toFixed(0)} rpm · ${q.est === 'raw' ? 'no lag, all noise' : `lag ≈ half the window = ${q.est === 'avg50' ? '25' : '40'} ms`}`
    return `predict: rpm ← rpm + dt·((V − kV·rpm)/kA − drag), P ← A·P·Aᵀ + Q (σa ${q.acc} rpm/s/√s) · update with turns = count/${CPR}: x ← x + K·(z − x̂), R = 1/12 count² · PI on the estimate`
  },
  legend: [
    { color: RING, label: 'True wheel speed (scope top 0…300 rpm)', shape: 'dot' },
    { color: B_FIELD, label: `Setpoint ${KF.sp} rpm; 15° ramp at ${KF.ramp.at} s`, shape: 'dot' },
    { color: MEAS_COLOR, label: 'Speed the PI uses · grey: raw counts', shape: 'dot' },
    { color: POWER, label: 'Motor duty (scope bottom ±100 %)', shape: 'dot' },
  ],
  points: [
    'The wheel from Speed control, now with a cheap 20-slot disc: 80 counts per turn. At 140 rpm that is under 2 counts per 10 ms tick, so the raw speed jumps in 75 rpm steps (grey). A PI on that reading buzzes the motor.',
    'Averaging over 50 or 80 ms smooths it, but the average is 25–40 ms old: the PI keeps pushing after the wheel is already fast, and the step overshoots by 40–60 rpm. Same lag-for-noise trade as on the arm.',
    'A Kalman filter adds what we already know: the motor model. Each tick it predicts the new speed from the volts it just sent (kV, kA from Feed-forward), then nudges the prediction toward the count by the gain K, which it computes from how much it trusts each side (Kalman intuition covers the 1D idea). A third state, drag, soaks up friction and the ramp the model does not know about.',
    'The slider sets how far the speed may wander off the model (σa). Low: trusts the model, a smooth estimate with no overshoot, but slow to notice the ramp, so the dip is deeper. High: trusts the counts, so it is back to raw buzz. Around 30 it beats both averages: steady, quick and calm. The model must be right, though; a wrong kV shows up as a bias that drag has to absorb.',
  ],
  controls: [
    { kind: 'choice', key: 'est', options: opts(ESTS), initial: 'kf' },
    { kind: 'slider', key: 'acc', label: 'Kalman σa (speed wander)', min: 5, max: 300, step: 5, initial: 30, format: (v) => `${v} rpm/s/√s` },
  ],
  build(): Stage {
    const s = speedStage([[POWER, (f) => f.u]], { sensor: 'disc → est.' })
    const rawTr = s.plot.trace(GREY, { samples: 300, radius: 0.025 })
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = kfParams(p)
        const { run } = kfData(q)
        const t = s.clock(dt, kfKey(q))
        traceRun(rawTr, run, WHEEL.loopS, 3, t, (g) => s.ySpd(rawRpm(g)), 300)
        const f = s.show(dt, run, t, true, 'PI')
        const est = q.est === 'kf' ? 'Kalman' : q.est === 'raw' ? 'raw' : `avg ${q.est.slice(3)} ms`
        s.status.set(`Kalman filter · ${ESTS[q.est]}${q.est === 'kf' ? ` · σa ${q.acc}` : ''} · slot disc ${CPR} counts/turn`, LABEL)
        const off = f.meas - f.rpm
        if (t < KF.at) s.event.set(`at rest: setpoint about to jump to ${KF.sp} rpm`, GREY)
        else if (Math.abs(off) > 15) s.event.set(`${est} says ${Math.round(f.meas)} rpm, wheel does ${Math.round(f.rpm)} rpm: the PI acts on the wrong number`, HEAT)
        else if (f.slope && f.sp - f.rpm > 8) s.event.set(`ramp: ${Math.round(f.sp - f.rpm)} rpm short, duty ${pct(f.u)}`, HIGH_V)
        else s.event.set(`${f.counts} counts this tick · ${est} ${Math.round(f.meas)} rpm · wheel ${Math.round(f.rpm)} rpm`, RING)
        s.sub(t, ` · ${(60 / (CPR * WHEEL.loopS)).toFixed(0)} rpm per count`)
      },
      readouts: (p) => {
        const q = kfParams(p)
        const { flat, peak, dip } = kfData(q)
        return [
          { label: 'Speed error on the flat (RMS)', value: `${flat.rmsErr.toFixed(1)} rpm`, tone: flat.rmsErr > 5 ? 'bad' : flat.rmsErr > 2 ? 'warn' : 'ok' },
          { label: 'Duty buzz (RMS change per tick)', value: pct(flat.jitter), tone: flat.jitter > 0.1 ? 'bad' : flat.jitter > 0.03 ? 'warn' : 'ok' },
          { label: 'Peak after the step', value: `${Math.round(peak)} rpm`, tone: peak > KF.sp * 1.15 ? 'bad' : peak > KF.sp * 1.05 ? 'warn' : 'ok' },
          { label: 'Dip when the ramp hits', value: `${Math.round(dip)} rpm`, tone: dip > 25 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
