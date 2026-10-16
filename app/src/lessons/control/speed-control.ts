import { EncoderKind, SpeedCfg, SpeedFrame, WHEEL, fixedStepAt, rampSp, wheelSpeedRun, speedStats, speedStep, stepMetrics, stepSp, wheelFf } from '../../core/physics'
import { pct } from '../../core/units'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, DATA_COLOR, GREY, HEAT, HIGH_V, LABEL, MEAS_COLOR, PID_COLORS, POWER, RING, SIDE_SCOPE, controlLoop, memoBy, scope, scopeLabels, speedWheel, statusHeader, termBars, traceRun } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const VIEW = { center: [-2.2, -1.3, 0] as V3, radius: 54, polar: 1.45, azimuth: 0 }
const DIAG = { at: [SIDE_SCOPE.x, 2.4, 0] as V3, w: 12.5, h: 3.6 }
const SCOPE = { y: -4.6, h: 5 }
const RIG = { at: [-13.6, 0.2, 0] as V3, r: 2.4, bars: [-11.2, -6.5, 0] as V3, slow: 0.25, rest: 1 }
const SECONDS = 3
const MAX = WHEEL.maxRpm
const dtL = WHEEL.loopS
const rpmText = (v: number) => `${Math.round(v)} rpm`
const signedRpm = (v: number) => `${v < -0.5 ? '−' : v > 0.5 ? '+' : ''}${Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)} rpm`
const secs = (s: number | null) => (s === null ? '—' : `${s.toFixed(2)} s`)
const LEGEND = {
  rpm: { color: RING, label: `Wheel speed (scope top: 0…${MAX} rpm)`, shape: 'dot' as const },
  sp: { color: B_FIELD, label: 'Setpoint', shape: 'dot' as const },
  meas: { color: MEAS_COLOR, label: 'Encoder reading', shape: 'dot' as const },
  u: { color: POWER, label: 'Motor duty u (scope bottom ±100 %)', shape: 'dot' as const },
}

type Trace = ReturnType<ReturnType<typeof scope>['trace']>

/** Wheel rig + gauge, loop diagram(s), scope (speed on top, `lower` traces on the bottom half). */
function speedStage(lower: [string, (f: SpeedFrame) => number][], { bars = false, open = false, ctrl = 'PI' } = {}) {
  const scene = createStage({ span: 40 })
  const head = statusHeader(scene)
  const wheel = speedWheel(scene, RIG.at, RIG.r, MAX)
  const tb = bars ? termBars(scene, RIG.bars, 7) : null
  const loopOpts = { ctrl, plant: 'motor + wheel', sensor: 'encoder', disturb: true, w: DIAG.w, h: DIAG.h }
  const closed = controlLoop(scene, DIAG.at, loopOpts)
  const openLoop = open ? controlLoop(scene, DIAG.at, { ...loopOpts, ctrl: 'fixed duty', feedback: false }) : null
  const plot = scope(scene, SIDE_SCOPE.w, SCOPE.h, { divs: [6, 4], zeroAt: 0.25 })
  plot.group.position.set(SIDE_SCOPE.x, SCOPE.y, 0)
  const lowTr = lower.map(([c, f]) => [plot.trace(c, { samples: 300, radius: 0.04 }), f] as const)
  const spTr = plot.trace(B_FIELD, { samples: 300, radius: 0.04 })
  const measTr = plot.trace(MEAS_COLOR, { samples: 300, radius: 0.03 })
  const rpmTr = plot.trace(RING, { samples: 300, radius: 0.07 })
  scopeLabels(scene, SCOPE.y, SCOPE.h, SECONDS, `speed 0…${MAX} rpm`, 'duty ±100 %')
  const ySpd = (v: number) => (Math.max(-10, Math.min(MAX * 1.05, v)) / MAX) * (SCOPE.h / 2)
  const yDuty = (v: number) => -SCOPE.h / 4 + Math.max(-1.12, Math.min(1.12, v)) * (SCOPE.h / 4) * 0.92
  const draw = (tr: Trace, run: SpeedFrame[], t: number, v: (f: SpeedFrame) => number) => traceRun(tr, run, dtL, SECONDS, t, v, 300)
  const st = { key: '', t: 0 }
  return {
    scene,
    ...head,
    plot,
    clock(dt: number, key: string) {
      if (key !== st.key) {
        st.key = key
        st.t = 0
      }
      st.t += dt * RIG.slow
      if (st.t > SECONDS + RIG.rest * RIG.slow) st.t = 0
      return Math.min(st.t, SECONDS)
    },
    show(dt: number, run: SpeedFrame[], t: number, enc: boolean, title = ctrl, fb = enc) {
      const f = fixedStepAt(run, t, dtL)
      draw(spTr, run, t, (g) => ySpd(g.sp))
      draw(measTr, run, enc ? t : 0, (g) => ySpd(g.meas))
      draw(rpmTr, run, t, (g) => ySpd(g.rpm))
      for (const [tr, v] of lowTr) draw(tr, run, t, (g) => yDuty(v(g)))
      wheel.set(dt, f.rev, f.rpm, f.sp, enc ? f.meas : f.rpm, f.u, f.slope, enc ? f.counts : undefined)
      tb?.set({ p: f.p, i: f.i, d: f.d, u: f.u }, f.sat)
      const loop = fb || !openLoop ? closed : openLoop
      closed.group.visible = loop === closed
      if (openLoop) openLoop.group.visible = loop === openLoop
      const e = f.sp - f.meas
      loop.set(
        dt,
        { r: f.sp / MAX, e: Math.min(1, Math.abs(e) / 30), u: f.u, y: f.rpm / MAX, m: f.meas / MAX, d: f.slope ? 1 : 0.2 },
        { r: rpmText(f.sp), e: fb ? `e ${signedRpm(e)}` : '', u: `u ${pct(f.u)}`, y: rpmText(f.rpm), m: fb ? rpmText(f.meas) : '', d: f.slope ? `ramp ${f.slope}°` : 'rolling drag' },
        { ctrl: title },
      )
      return f
    },
    sub(t: number, extra = '') {
      head.sub.set(`${t.toFixed(2)} / ${SECONDS} s · slowed ${1 / RIG.slow}× · loop ${Math.round(1 / dtL)} Hz${extra}`)
    },
  }
}

// --- Encoder feedback: open loop sags on a ramp; PI on counts holds speed; coarse counts buzz, long windows lag and swing. ---

const ENC_OPTS = { open: 'No encoder (fixed duty)', hall: 'Hall, 2112 counts/turn', slot: 'Slot disc, 80 counts/turn' }
const EF = { sp: 140, at: 0.2, ramp: { at: 1.6, deg: 15 }, pi: { kp: 0.005, ki: 0.08, kd: 0, antiWindup: 'clamp' as const } }
const efParams = (p: Params) => ({ enc: pick(ENC_OPTS, p.enc, 'hall'), win: Math.round(n(p, 'win') / (dtL * 1000)) })
type EfQ = ReturnType<typeof efParams>
const efKey = (q: EfQ) => `${q.enc}|${q.win}`
const efKind = (q: EfQ): EncoderKind | null => (q.enc === 'open' ? null : q.enc)
const efRun = memoBy(efKey, (q: EfQ) => {
  const run = wheelSpeedRun({ sp: stepSp(EF.sp, EF.at), seconds: SECONDS, enc: efKind(q), window: q.win, pid: EF.pi, ramp: EF.ramp })
  return { run, flat: speedStats(run, 1, EF.ramp.at), climb: speedStats(run, 2.4) }
})

export const encoderFeedback: Lesson = {
  id: 'speed-control-encoder-feedback',
  title: 'Encoder feedback',
  tagline: 'Count ticks, compare, correct',
  formula: (p) => {
    const q = efParams(p)
    const k = efKind(q)
    if (!k) return `u = fixed duty for ${EF.sp} rpm on the flat · nothing measures the wheel, so a ramp just slows it`
    return `speed = Δcounts / (counts per turn × window) = Δn / (${k === 'hall' ? 2112 : 80} × ${(q.win * dtL * 1000).toFixed(0)} ms) × 60 → one count = ${speedStep(k, q.win * dtL).toFixed(1)} rpm · u = Kp·e + Ki·∫e dt`
  },
  legend: [LEGEND.rpm, { ...LEGEND.sp, label: `Setpoint ${EF.sp} rpm` }, LEGEND.meas, LEGEND.u],
  points: [
    'A car wheel on a TT gearmotor (1:48, 2S pack) should turn at 140 rpm. Without a sensor the best you can do is a fixed duty that gives 140 rpm on a flat floor. At 1.6 s the car meets a 15° ramp: the motor needs more torque, the wheel slows by about a quarter, and nothing notices.',
    'With an encoder the loop sees the wheel. Every 10 ms it reads the count, takes the change over a window and turns it into rpm (Speed from ticks covers the counting methods). The error to the setpoint feeds a PI controller, which raises the duty on the ramp until the speed is back.',
    'Resolution matters. The Hall encoder on the motor shaft gives 2112 counts per wheel turn, so a 10 ms window resolves 2.8 rpm. A 20-slot disc on the wheel gives only 80: at 140 rpm that is about 2 counts per tick, and the reading jumps in 75 rpm steps. The controller faithfully chases those steps, so the duty buzzes.',
    'A longer window smooths the reading, but it is an average of the past: the loop now reacts late. With the slot disc a 100 ms window is calmer; at 200 ms the PI keeps pushing after the wheel is already fast and the speed swings. More counts per turn beats more averaging.',
  ],
  controls: [
    { kind: 'choice', key: 'enc', options: opts(ENC_OPTS), initial: 'hall' },
    { kind: 'slider', key: 'win', label: 'Speed window', min: 10, max: 200, step: 10, initial: 10, format: (v) => `${v} ms` },
  ],
  build(): Stage {
    const s = speedStage([[POWER, (f) => f.u]], { open: true })
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = efParams(p)
        const k = efKind(q)
        const { run } = efRun(q)
        const t = s.clock(dt, efKey(q))
        const f = s.show(dt, run, t, k !== null, k ? 'PI' : 'fixed duty')
        s.status.set(`Encoder feedback · ${ENC_OPTS[q.enc]}${k ? ` · window ${q.win * 10} ms` : ''}`, LABEL)
        const off = f.sp - f.rpm
        if (t < EF.at) s.event.set(`at rest: setpoint about to jump to ${EF.sp} rpm`, GREY)
        else if (!k) s.event.set(f.slope ? `on the ramp at the same duty: ${rpmText(f.rpm)}, ${signedRpm(-off)} and nobody knows` : `fixed ${pct(f.u)} duty: ${rpmText(f.rpm)} on the flat`, f.slope ? HIGH_V : POWER)
        else if (Math.abs(f.meas - f.rpm) > 20) s.event.set(`reads ${rpmText(f.meas)} (${f.counts} counts) while the wheel does ${rpmText(f.rpm)}: the duty chases the steps`, HEAT)
        else if (f.slope && Math.abs(off) > 3) s.event.set(`ramp: ${signedRpm(-off)} → PI raises the duty to ${pct(f.u)}`, HEAT)
        else s.event.set(`reads ${rpmText(f.meas)}, ${f.counts} counts per tick · duty ${pct(f.u)}`, RING)
        s.sub(t, k ? ` · ${speedStep(k, q.win * dtL).toFixed(1)} rpm per count` : '')
      },
      readouts: (p) => {
        const q = efParams(p)
        const { flat, climb } = efRun(q)
        const k = efKind(q)
        return [
          { label: 'Ramp speed vs setpoint (mean)', value: signedRpm(-climb.meanErr), tone: Math.abs(climb.meanErr) > 10 ? 'bad' : Math.abs(climb.meanErr) > 3 ? 'warn' : 'ok' },
          { label: 'Speed wobble on the flat (RMS)', value: `${flat.rmsErr.toFixed(1)} rpm`, tone: flat.rmsErr > 10 ? 'bad' : flat.rmsErr > 3 ? 'warn' : 'ok' },
          { label: 'Duty buzz (RMS change per tick)', value: pct(flat.jitter), tone: flat.jitter > 0.1 ? 'bad' : flat.jitter > 0.03 ? 'warn' : 'ok' },
          { label: 'One count is worth', value: k ? `${speedStep(k, q.win * dtL).toFixed(1)} rpm` : 'no encoder' },
        ]
      },
    }
  },
}

// --- Feed-forward: the model gives most of the duty up front; feedback only trims; a sagging pack shows why both. ---

const FF_MODES = { fb: 'Feedback only (PI)', ff: 'Feed-forward only', both: 'Feed-forward + PI' }
const FF = { pi: EF.pi, prof: rampSp([[0, 0], [0.2, 0], [0.8, 180], [1.6, 180], [2.0, 80], [2.6, 80], [2.9, 0]]) }
const FF_COLOR = DATA_COLOR
const FB_COLOR = HEAT
const ffParams = (p: Params) => ({ mode: pick(FF_MODES, p.mode, 'both'), volts: n(p, 'volts') })
type FfQ = ReturnType<typeof ffParams>
const ffKey = (q: FfQ) => `${q.mode}|${q.volts}`
const ffCfg = (q: FfQ): SpeedCfg => ({ sp: FF.prof, seconds: SECONDS, enc: 'hall', pid: q.mode === 'ff' ? undefined : FF.pi, ff: q.mode !== 'fb', volts: q.volts })
const ffRun = memoBy(ffKey, (q: FfQ) => {
  const run = wheelSpeedRun(ffCfg(q))
  const lag = run.filter((f) => f.t > 0.3 && f.t < 0.8).map((f) => f.sp - f.rpm)
  const shareFf = run.filter((f) => f.t > 1.2 && f.t < 1.6).map((f) => (f.u ? f.ff / f.u : 0))
  return { run, all: speedStats(run, 0.2), hold: speedStats(run, 1.2, 1.6), ramp: lag.reduce((a, b) => a + b, 0) / lag.length, share: shareFf.reduce((a, b) => a + b, 0) / shareFf.length }
})
const FFK = wheelFf()

export const feedForward: Lesson = {
  id: 'speed-control-feed-forward',
  title: 'Feed-forward',
  tagline: 'Send the duty you know it needs',
  formula: (p) => {
    const q = ffParams(p)
    return `V_ff = kS + kV·ω + kA·dω/dt = ${FFK.kS.toFixed(2)} V + ${(FFK.kV * 1000).toFixed(1)} mV/rpm·ω + ${(FFK.kA * 1000).toFixed(2)} mV/(rpm/s)·dω/dt · u = V_ff / ${WHEEL.volts} V${q.mode === 'ff' ? '' : ' + PI'} · pack ${q.volts.toFixed(1)} V`
  },
  legend: [LEGEND.rpm, { ...LEGEND.sp, label: 'Setpoint profile (ramps)' }, { color: FF_COLOR, label: 'FF part of duty (scope bottom ±100 %)', shape: 'dot' }, { color: FB_COLOR, label: 'PI part of duty · green: total u', shape: 'dot' }],
  points: [
    'Feedback only acts on an error, so it is always a step behind: the wheel has to fall short before the PI pushes harder. On a ramped speed profile the wheel trails the setpoint the whole way up and down.',
    'But the motor is not a mystery. Its model says what voltage a speed needs: kS to beat friction, kV·ω to match the back-EMF (here 26 mV per wheel rpm), and kA·dω/dt to accelerate the rotor and car. Feed-forward sends that duty straight from the setpoint, before any error exists.',
    'Feed-forward alone tracks almost perfectly, as long as the model is right. Drop the pack voltage: the FF still divides by the 8.4 V it was tuned for, so every duty is too small and the wheel runs slow, with nothing to notice. Same for a heavier car, a ramp or a worn motor.',
    'Together, FF does the bulk and the PI trims the rest: small errors, fast response, and the integral picks up whatever the model missed. This is how most wheel, arm and drone controllers are built (dividing by the measured pack voltage removes the battery error too). Velocity PID covers tuning the feedback part.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(FF_MODES), initial: 'both' },
    { kind: 'slider', key: 'volts', label: 'Pack voltage', min: 6.4, max: 8.4, step: 0.2, initial: 8.4, format: (v) => `${v.toFixed(1)} V` },
  ],
  build(): Stage {
    const s = speedStage(
      [
        [POWER, (f) => f.u],
        [FF_COLOR, (f) => f.ff],
        [FB_COLOR, (f) => f.u - f.ff],
      ],
      { ctrl: 'FF + PI', open: true },
    )
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = ffParams(p)
        const { run } = ffRun(q)
        const t = s.clock(dt, ffKey(q))
        const f = s.show(dt, run, t, true, q.mode === 'fb' ? 'PI' : q.mode === 'ff' ? 'FF (model)' : 'FF + PI', q.mode !== 'ff')
        const off = f.sp - f.rpm
        const phase = f.t < 0.2 ? 'at rest' : f.t < 0.8 ? 'speeding up' : f.t < 1.6 ? 'cruising' : f.t < 2 ? 'slowing' : f.t < 2.6 ? 'cruising' : 'stopping'
        s.status.set(`Feed-forward · ${FF_MODES[q.mode]} · pack ${q.volts.toFixed(1)} V`, LABEL)
        const tone = Math.abs(off) > 10 ? HIGH_V : Math.abs(off) > 3 ? HEAT : RING
        s.event.set(`${phase}: FF ${pct(f.ff)} + PI ${pct(f.u - f.ff)} = ${pct(f.u)} · ${Math.abs(off) < 1.5 ? 'on the setpoint' : off > 0 ? `${rpmText(off)} behind` : `${rpmText(-off)} ahead`}`, tone)
        s.sub(t)
      },
      readouts: (p) => {
        const q = ffParams(p)
        const { all, hold, ramp, share } = ffRun(q)
        return [
          { label: 'Tracking error over the run (RMS)', value: rpmText(all.rmsErr), tone: all.rmsErr > 10 ? 'bad' : all.rmsErr > 3 ? 'warn' : 'ok' },
          { label: 'Lag while speeding up (mean)', value: signedRpm(ramp), tone: Math.abs(ramp) > 10 ? 'bad' : Math.abs(ramp) > 3 ? 'warn' : 'ok' },
          { label: 'Error cruising at 180 rpm', value: signedRpm(hold.meanErr), tone: Math.abs(hold.meanErr) > 5 ? 'bad' : Math.abs(hold.meanErr) > 1 ? 'warn' : 'ok' },
          { label: 'Share of duty from FF at cruise', value: q.mode === 'fb' ? 'none' : pct(share) },
        ]
      },
    }
  },
}

// --- Velocity PID: PI is the workhorse; P alone leaves a gap, I closes it, D mostly amplifies count noise. ---

const VP = { sp: 140, at: 0.2, ramp: EF.ramp }
const vpParams = (p: Params) => ({ kp: n(p, 'kp') / 100, ki: n(p, 'ki') / 100, kd: n(p, 'kd') / 100 })
type VpQ = ReturnType<typeof vpParams>
const vpKey = (q: VpQ) => `${q.kp}|${q.ki}|${q.kd}`
const vpRun = memoBy(vpKey, (q: VpQ) => {
  const run = wheelSpeedRun({ sp: stepSp(VP.sp, VP.at), seconds: SECONDS, enc: 'hall', pid: { ...q, antiWindup: 'clamp', dOnMeas: true }, ramp: VP.ramp })
  const before = run.filter((f) => f.t < VP.ramp.at)
  return {
    run,
    m: stepMetrics(before.map((f) => f.rpm), dtL, Math.round(VP.at / dtL), 0, VP.sp, 0.03),
    flat: speedStats(run, 1, VP.ramp.at),
    climb: speedStats(run, 2.4),
    dip: run[Math.round(VP.ramp.at / dtL) - 1].rpm - Math.min(...run.filter((f) => f.t >= VP.ramp.at).map((f) => f.rpm)),
  }
})

export const velocityPid: Lesson = {
  id: 'speed-control-velocity-pid',
  title: 'Velocity PID',
  tagline: 'PI does the work, D rarely helps',
  formula: (p) => {
    const q = vpParams(p)
    return `e = ω_sp − ω_enc · u = ${(q.kp * 100).toFixed(2)} %/rpm·e + ${(q.ki * 100).toFixed(0)} %/(rpm·s)·∫e dt − ${(q.kd * 100).toFixed(3)} %/(rpm/s)·dω/dt · count step ${speedStep('hall', dtL).toFixed(1)} rpm → D noise ±${pct((q.kd * speedStep('hall', dtL)) / dtL)}`
  },
  legend: [LEGEND.rpm, { ...LEGEND.sp, label: `Setpoint ${VP.sp} rpm; 15° ramp at ${VP.ramp.at} s` }, { color: PID_COLORS.p, label: 'P term (scope bottom ±100 %); D in pink', shape: 'dot' }, { color: PID_COLORS.i, label: 'I term: the duty that holds the speed', shape: 'dot' }],
  points: [
    'Same PID as the arm in the PID topic, new job: hold a wheel at 140 rpm, measured by the Hall encoder every 10 ms. The plant is different in one key way. Holding a speed takes a steady duty (about 50 % here, to match the back-EMF), even with no error at all.',
    'So P alone always stops short: the duty Kp·e has to be that 50 %, which needs a large error. Raise Kp and the gap shrinks, but each count step (2.8 rpm) now flips the duty by more and the motor buzzes. The I term is what holds a speed: it settles at the duty the wheel needs, and on the ramp it climbs until the speed is back.',
    'A velocity integral is a position term in disguise (∫ω dt is the angle), which is why PI on speed is so stiff against a load. Too much Ki and the loop overshoots and rings; Ki ≈ Kp / τ (motor time constant, about 50 ms) is a good start.',
    'D on speed is the derivative of a derivative of counts: every one-count jitter becomes a jump of Kd × 280 rpm/s. Even tiny Kd shakes the duty and drowns the signal, so most speed loops are PI, with feed-forward for fast response (see Feed-forward).',
  ],
  controls: [
    { kind: 'slider', key: 'kp', label: 'Kp (proportional)', min: 0.1, max: 4, step: 0.1, initial: 0.5, format: (v) => `${v.toFixed(1)} %/rpm` },
    { kind: 'slider', key: 'ki', label: 'Ki (integral)', min: 0, max: 60, step: 2, initial: 8, format: (v) => `${v} %/(rpm·s)` },
    { kind: 'slider', key: 'kd', label: 'Kd (derivative)', min: 0, max: 0.03, step: 0.005, initial: 0, format: (v) => `${v.toFixed(3)} %/(rpm/s)` },
  ],
  build(): Stage {
    const s = speedStage(
      [
        [PID_COLORS.p, (f) => f.p],
        [PID_COLORS.i, (f) => f.i],
        [PID_COLORS.d, (f) => f.d],
      ],
      { bars: true, ctrl: 'PID' },
    )
    return {
      scene: s.scene,
      view: VIEW,
      frame(dt, p) {
        const q = vpParams(p)
        const { run } = vpRun(q)
        const t = s.clock(dt, vpKey(q))
        const f = s.show(dt, run, t, true, q.ki ? (q.kd ? 'PID' : 'PI') : q.kd ? 'PD' : 'P')
        const off = f.sp - f.rpm
        s.status.set(`Velocity PID · Kp ${(q.kp * 100).toFixed(1)} · Ki ${(q.ki * 100).toFixed(0)} · Kd ${(q.kd * 100).toFixed(3)}`, LABEL)
        if (t < VP.at) s.event.set(`at rest: setpoint about to jump to ${VP.sp} rpm`, GREY)
        else if (Math.abs(f.d) > 0.15) s.event.set(`D ${pct(f.d)}: one count of jitter × Kd shakes the duty`, PID_COLORS.d)
        else if (f.sat) s.event.set(`u clipped at ${pct(f.u)}: the motor gives all it has`, HIGH_V)
        else if (Math.abs(off) > 5) s.event.set(`${off > 0 ? `${rpmText(off)} short` : `${rpmText(-off)} over`}: P ${pct(f.p)} + I ${pct(f.i)}${f.slope ? ' on the ramp' : ''}`, q.ki ? HEAT : PID_COLORS.p)
        else s.event.set(`holding: I = ${pct(f.i)} carries the load, P ${pct(f.p)} trims`, PID_COLORS.i)
        s.sub(t)
      },
      readouts: (p) => {
        const q = vpParams(p)
        const { m, flat, climb, dip } = vpRun(q)
        return [
          { label: 'Steady error, flat / ramp', value: `${signedRpm(flat.meanErr)} / ${signedRpm(climb.meanErr)}`, tone: Math.abs(climb.meanErr) > 5 ? 'bad' : Math.abs(climb.meanErr) > 1 ? 'warn' : 'ok' },
          { label: 'Overshoot · settle (±3 %)', value: `${pct(m.overshoot)} · ${secs(m.settle)}`, tone: m.overshoot > 0.15 || m.settle === null ? 'bad' : m.overshoot > 0.05 ? 'warn' : 'ok' },
          { label: 'Dip when the ramp hits', value: rpmText(dip), tone: dip > 30 ? 'warn' : 'ok' },
          { label: 'Duty buzz (RMS change per tick)', value: pct(flat.jitter), tone: flat.jitter > 0.1 ? 'bad' : flat.jitter > 0.03 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
