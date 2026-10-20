import {
  DEG,
  DRIFT_BOT,
  MISMATCH_FAULTS,
  MISMATCH_HUNT,
  MISMATCH_PROBES,
  MismatchFault,
  MismatchProbe,
  ODO_BOT,
  TT_TRACK_M,
  TT_WHEEL_MM,
  WHEELSIZE_FAULTS,
  WHEELSIZE_HUNT,
  WHEELSIZE_PROBES,
  WheelSizeFault,
  WheelSizeProbe,
  mmPerTick,
  motorMismatch,
  wheelSizeError,
} from '../../core/physics'
import { fixedText, mmText, mpsText, pct, rpmText, si } from '../../core/units'
import { CASE_LOG, DriftPart, DriftTp, HIGH_V, HUNT_HOWTO, HUNT_LEGEND, POWER, PlotView, ProbeCase, RING, driftBench, huntKit, huntRig, huntStage, serialPlot } from '../fx'
import { Lesson, Stage } from '../types'

type Bench = ReturnType<typeof driftBench>
interface Tip {
  red: DriftTp
  black: DriftTp
}
/** Off-meter probes park the meter; any tip will do. */
const PARKED: Tip = { red: 'mR1', black: 'mR2' }
/** Each test runs for `RUN_S`, holds, and repeats every `LOOP_S`. */
const RUN_S = 2.5
const LOOP_S = 4
const NO_VIEW: PlotView = { lo: 0, hi: 1, axis: ['', ''], span: '' }

interface PlotSpec {
  got: readonly number[] | null
  ok: readonly number[] | null
  view: PlotView
  stats: string
  log: string
  tone?: string
}

interface DriftSpec<F extends string, P extends string> extends ProbeCase<F, P, Tip, DriftPart> {
  plotTitle: string
  /** What the serial plot shows for this case and probe; null = a meter reading. */
  plot: (truth: F, probe: P) => PlotSpec | null
  /** Car, markers and probe glow per frame: `u` = 0…1 through the test (holds at 1), `t` = seconds into this probe. */
  show: (s: { bench: Bench; truth: F; probe: P; u: number; t: number; glow: boolean }) => void
}

/** Shared stage: floor-test bench, meter, suspect table, and a serial plot for what the tests log. */
function driftBuild<F extends string, P extends string>(s: DriftSpec<F, P>, colW: number): Stage {
  const stage = huntStage()
  const { scene } = stage
  const bench = driftBench(scene)
  const plot = serialPlot(scene, [9.5, -6.2, 0], 4.4, 2.6, s.plotTitle, [RING])
  let key = ''
  let t0 = 0
  return huntRig<F, P, DriftTp, DriftPart, Tip>(stage, {
    ...s,
    bench,
    table: { colW },
    extra({ q, t }) {
      const k = `${q.truth}|${q.probe}`
      if (k !== key) {
        key = k
        t0 = t
        const c = s.plot(q.truth, q.probe)
        plot.show(c?.ok ?? null, c?.got ?? null, c?.view ?? NO_VIEW)
        plot.stats(c ? c.stats : 'Meter on the right motor, wheels up', c?.tone)
        plot.log(c ? c.log : '')
      }
      const since = t - t0
      s.show({ bench, truth: q.truth, probe: q.probe, u: Math.min(1, (since % LOOP_S) / RUN_S), t: since, glow: !q.guess })
    },
  })
}

const V = (v: number) => `${fixedText(v, 2)} V`
const A = (a: number) => si(a, 'A', 2)

// --- Motor mismatch ---

const mmKit = huntKit(MISMATCH_HUNT, MISMATCH_FAULTS, MISMATCH_PROBES, 107)
const mm = (f: MismatchFault | 'ok') => motorMismatch(f)
const offsets = (f: MismatchFault | 'ok') => mm(f).path.map((p) => -p.y * 1000)
const mmFixes = (): Record<MismatchFault, string> => ({
  motor: `Right motor ${pct(1 - mm('motor').up[1].rpm / mm('ok').up[1].rpm)} slower: ${rpmText(mm('motor').up[1].rpm)} vs ${rpmText(mm('ok').up[0].rpm)} wheels up at the same ${V(mm('motor').up[1].volts)}. Use encoders + a speed loop`,
  pwm: `Right side: map(70, 0, 100, 0, ${DRIFT_BOT.badTop}) = ${mm('pwm').pwm[1]}/255, ${V(mm('pwm').up[1].volts)} vs ${V(mm('ok').up[1].volts)}. Same map() on both sides`,
  rub: `Right tyre rubs a screw: ${A(mm('rub').up[1].amps)} vs ${A(mm('ok').up[1].amps)} wheels up. Space the wheel out, shorten the screw`,
  weight: `Battery over the right wheel: ${pct(DRIFT_BOT.heavyShare)} of the load, slower on the floor only. Centre the pack`,
})

export const robotDriftsMotorMismatch: Lesson = {
  id: 'robot-drifts-motor-mismatch',
  title: 'Motor mismatch',
  tagline: 'Same PWM on both sides, yet the car curves right: is it the motor, the code, a rubbing tyre or the load?',
  formula: (p) => {
    const q = mmKit.params(p)
    const ok = mm('ok').floor
    if (q.guess === q.truth) {
      const [l, r] = mm(q.truth).floor
      return `ω = (v_R − v_L) / b = (${mpsText(r.speed, 3)} − ${mpsText(l.speed, 3)}) / ${TT_TRACK_M} m = ${fixedText((r.speed - l.speed) / TT_TRACK_M, 3)} rad/s → ${Math.round(mm(q.truth).reads.trail.value)} mm off the tape after ${fixedText(mm(q.truth).seconds, 2)} s`
    }
    return `v = (v_L + v_R) / 2, ω = (v_R − v_L) / b, b = ${TT_TRACK_M * 1000} mm · healthy: ${mpsText(ok[0].speed, 3)} both sides → ω = 0, straight`
  },
  legend: HUNT_LEGEND,
  points: [
    HUNT_HOWTO,
    `A two-wheeler goes straight only while v_L = v_R exactly: ω = (v_R − v_L) / b. On a ${TT_TRACK_M * 1000} mm track, a right wheel ${pct(1 - mm('weight').floor[1].speed / mm('weight').floor[0].speed)} slower already lands ${Math.round(mm('weight').reads.trail.value)} mm right of a 1 m tape (Mobility › Differential drive › Turn radius). Drive along masking tape and measure the offset: it is the symptom, not the cause.`,
    `Wheels up on a block, the floor drops out: at the same PWM both encoders should agree to ~2 rpm (${rpmText(mm('ok').up[0].rpm)} here). Slower on the block means motor, code or drag; equal on the block but curving on the floor means load or traction. TT motors spread about 10 % (Practice › Robo-car › Drive with ESP32).`,
    `Then the meter, still wheels up: average volts across the motor (PWM averages, Microcontrollers › PWM › Average voltage) and current in series. Low volts: the code or the driver. Full volts but slow at the same ${A(mm('ok').up[1].amps)}: a weaker motor (higher back-EMF per rpm). Full volts and more current: something drags (Actuators › DC motor › Torque and speed curve).`,
    `Rolling drag grows with the load on a wheel, so a pack over one wheel slows it on the floor only. A trim fixes one speed and one battery level; encoders and a speed loop per wheel fix them all (Control › Speed control › Velocity PID).`,
  ],
  controls: mmKit.controls,
  build: () =>
    driftBuild<MismatchFault, MismatchProbe>(
      {
        hunt: MISMATCH_HUNT,
        kit: mmKit,
        tips: { trail: PARKED, up: PARKED, volts: { red: 'mR1', black: 'mR2' }, amps: { red: 'leadR', black: 'mR1' } },
        parts: { motor: 'motorR', pwm: 'esp', rub: 'wheelR', weight: 'pack' },
        symptom: 'drive(70, 70) for the time 1 m takes: the car curves off the tape to the right',
        hint: 'Hint: tape run first, then wheels up: encoders, volts, current',
        fixes: mmFixes(),
        plotTitle: 'Serial',
        plot(truth, probe) {
          const m = mm(truth)
          if (probe === 'trail') {
            const d = m.reads.trail.value
            return { got: offsets(truth), ok: offsets('ok'), view: { lo: 0, hi: 450, axis: ['0 mm', '450 mm'], span: 'offset' }, stats: `${Math.round(d)} mm right of the tape after ${fixedText(m.seconds, 2)} s`, log: CASE_LOG, tone: Math.abs(d) < 3 ? POWER : HIGH_V }
          }
          if (probe === 'up') {
            const [l, r] = m.up
            return { got: [r.rpm, r.rpm], ok: [l.rpm, l.rpm], view: { lo: 0, hi: 200, axis: ['0 rpm', '200 rpm'], span: 'rpm' }, stats: `L ${rpmText(l.rpm)} · R ${rpmText(r.rpm)}`, log: 'grey left · cyan right', tone: Math.abs(l.rpm - r.rpm) < 2 ? POWER : HIGH_V }
          }
          return null
        },
        show({ bench, truth, probe, u, t, glow }) {
          const m = mm(truth)
          bench.tyre(null)
          bench.heading(null)
          bench.span(null)
          if (probe === 'trail') {
            const i = Math.round(u * DRIFT_BOT.samples)
            const tt = u * m.seconds
            bench.place(m.path[i], m.floor[0].speed * tt, m.floor[1].speed * tt)
            bench.trail(m.path, i + 1)
            bench.offset(u >= 1 ? m.end : null, `${Math.round(m.reads.trail.value)} mm`)
            return
          }
          bench.trail(null, 0)
          bench.offset(null)
          bench.place({ x: 0, y: 0, th: 0 }, m.up[0].speed * t, m.up[1].speed * t, true)
          if (glow && probe === 'up') bench.glow('wheelR', 0.6, RING)
        },
      },
      3.2,
    ),
}

// --- Wheel size error ---

const wsKit = huntKit(WHEELSIZE_HUNT, WHEELSIZE_FAULTS, WHEELSIZE_PROBES, 109)
const ws = (f: WheelSizeFault | 'ok') => wheelSizeError(f)
const lateral = (f: WheelSizeFault | 'ok') => ws(f).drive.path.map((p) => -p.y * 1000)
const along = (f: WheelSizeFault | 'ok') => ws(f).drive.path.map((p) => Math.hypot(p.x, p.y) * 1000)
const tickMm = mmPerTick(TT_WHEEL_MM, ws('ok').setup.tpr)
const wsFixes = (): Record<WheelSizeFault, string> => ({
  tyre: `Right tyre ${ODO_BOT.smallMm} mm, left ${TT_WHEEL_MM}: equal ticks, ${pct(1 - ODO_BOT.smallMm / TT_WHEEL_MM)} less travel, ${Math.round(ws('tyre').drive.offsetMm)} mm right in 1 m. Match the tyres`,
  dia: `Code says ${ODO_BOT.codeMm} mm, the tyres are ${TT_WHEEL_MM}: 1 m by odometry is ${Math.round(ws('dia').drive.tapeMm)} mm. Put the caliper’s Ø in the code`,
  gear: `1:120 motors, code has 1:48’s ${ws('ok').setup.codeTpr} ticks/rev (really ${ws('gear').setup.tpr}): 1 m is ${Math.round(ws('gear').drive.tapeMm)} mm. Use 11 × 4 × 120`,
  track: `Code’s track ${ODO_BOT.codeTrackM * 1000} mm, real ${TT_TRACK_M * 1000}: straights fine, 360° spins turn ${Math.round(ws('track').spin.realDeg)}°. Measure centre to centre`,
})

export const robotDriftsWheelSizeError: Lesson = {
  id: 'robot-drifts-wheel-size-error',
  title: 'Wheel size error',
  tagline: 'Odometry says 1 m dead straight; the tape disagrees. Which number in the code, or which tyre, is lying?',
  formula: (p) => {
    const q = wsKit.params(p)
    if (q.guess === q.truth && q.truth === 'tyre') {
      const d = ws('tyre').drive
      return `Equal ticks: d_R / d_L = ${ODO_BOT.smallMm} / ${TT_WHEEL_MM} → θ = (d_R − d_L) / b = (${mmText(d.dR)} − ${mmText(d.dL)}) / ${TT_TRACK_M * 1000} mm = ${fixedText(d.end.th / DEG, 1)}°, odometry sees 0°`
    }
    return `mm per tick = π × Ø / ticks per rev = π × ${TT_WHEEL_MM} / ${ws('ok').setup.tpr} = ${fixedText(tickMm, 4)} mm · 1 m = ${Math.round(ws('ok').ticksPerM)} ticks · heading = (d_R − d_L) / b`
  },
  legend: HUNT_LEGEND,
  points: [
    HUNT_HOWTO,
    `Encoder odometry turns ticks into metres with three numbers in the code: the wheel Ø, ticks per wheel turn (11 PPR × 4 edges × 48 = ${ws('ok').setup.tpr}) and the track b. Distance = ticks × π·Ø / ticks per rev; heading = (d_R − d_L) / b (Navigation › Odometry › Dead reckoning).`,
    `Each wrong number has its own signature. Ø or ticks per rev wrong: every distance scales (1 m by odometry: ${Math.round(ws('dia').drive.tapeMm)} mm with 70 mm in the code, ${Math.round(ws('gear').drive.tapeMm)} mm with 1:120 motors) and spins scale with it. Track wrong: straights perfect, spins off (${Math.round(ws('track').spin.realDeg)}°). So test both a straight and a spin.`,
    `A smaller tyre on one side is the sneaky one: the drive loop keeps the ticks equal, so odometry says straight while the car curves ${Math.round(ws('tyre').drive.offsetMm)} mm off in 1 m; a ${ODO_BOT.smallMm} mm tyre is only ${pct(1 - ODO_BOT.smallMm / TT_WHEEL_MM)} smaller. A caliper finds it (Workshop skills › Measuring › Reading a caliper).`,
    'Calibrate: drive a taped distance and rescale Ø, spin whole turns and rescale b (Navigation › Odometry › Calibrating wheel size). UMBmark, a 1 m square clockwise and anticlockwise, separates a wheel-ratio error from a track error (Mobility › Differential drive › Odometry).',
  ],
  controls: wsKit.controls,
  build: () =>
    driftBuild<WheelSizeFault, WheelSizeProbe>(
      {
        hunt: WHEELSIZE_HUNT,
        kit: wsKit,
        tips: { trail: PARKED, tape: PARKED, tyre: PARKED, ticks: PARKED, spin: PARKED },
        parts: { tyre: 'wheelR', dia: 'esp', gear: 'motorR', track: 'esp' },
        symptom: 'Odometry: 1 m dead straight (1.000 m, 0°). The tape on the floor disagrees',
        hint: 'Hint: run it along the tape, spin it 360°, then measure the tyre and count ticks per turn',
        fixes: wsFixes(),
        plotTitle: 'Serial',
        plot(truth, probe) {
          const w = ws(truth)
          if (probe === 'trail')
            return { got: lateral(truth), ok: lateral('ok'), view: { lo: 0, hi: 150, axis: ['0 mm', '150 mm'], span: 'offset' }, stats: `${Math.round(w.drive.offsetMm)} mm right of the tape · odometry: 0°`, log: CASE_LOG, tone: w.drive.offsetMm < 3 ? POWER : HIGH_V }
          if (probe === 'tape')
            return { got: along(truth), ok: along('ok'), view: { lo: 0, hi: 1100, axis: ['0', '1.1 m'], span: 'distance', marks: [[1000, '1 m']] }, stats: `stopped ${Math.round(w.drive.tapeMm)} mm from the start · odometry: ${fixedText(w.drive.odoM, 3)} m`, log: CASE_LOG, tone: Math.abs(w.drive.tapeMm - 1000) < 11 ? POWER : HIGH_V }
          if (probe === 'spin')
            return { got: w.spin.real, ok: w.spin.odo, view: { lo: 0, hi: 450, axis: ['0°', '450°'], span: 'heading', marks: [[360, '360°']] }, stats: `odometry ${Math.round(w.spin.odoDeg)}° · real ${Math.round(w.spin.realDeg)}°`, log: 'grey odometry · cyan real', tone: Math.abs(w.spin.realDeg - 360) < 9 ? POWER : HIGH_V }
          if (probe === 'tyre') return { got: null, ok: null, view: NO_VIEW, stats: `Caliper across the right tyre: ${fixedText(w.setup.rightMm, 2)} mm`, log: `left tyre ${fixedText(w.setup.leftMm, 2)} mm` }
          return { got: null, ok: null, view: NO_VIEW, stats: `Right wheel turned once by hand: ${w.setup.tpr} ticks`, log: `the code assumes ${w.setup.codeTpr} per turn` }
        },
        show({ bench, truth, probe, u, glow }) {
          const w = ws(truth)
          bench.tyre(probe === 'tyre' ? w.setup.rightMm : null, 'right tyre')
          bench.heading(null)
          bench.span(null)
          bench.offset(null)
          bench.trail(null, 0)
          if (probe === 'trail' || probe === 'tape') {
            const i = Math.round(u * ODO_BOT.samples)
            bench.place(w.drive.path[i], w.drive.dL * u, w.drive.dR * u)
            bench.trail(w.drive.path, i + 1)
            if (u >= 1 && probe === 'trail') bench.offset(w.drive.end, `${Math.round(w.drive.offsetMm)} mm`)
            if (u >= 1 && probe === 'tape') bench.span(w.drive.end, `${Math.round(w.drive.tapeMm)} mm`)
            return
          }
          if (probe === 'spin') {
            const th = w.spin.realDeg * DEG * u
            const arc = (th * TT_TRACK_M) / 2
            bench.place({ x: 0, y: 0, th }, -arc, arc)
            bench.heading(th, `${Math.round(w.spin.realDeg * u)}°`)
            return
          }
          if (probe === 'ticks') {
            bench.place({ x: 0, y: 0, th: 0 }, 0, (u * Math.PI * w.setup.rightMm) / 1000, true)
            if (glow) bench.glow('wheelR', 0.6, RING)
            return
          }
          bench.place({ x: 0, y: 0, th: 0 })
          if (glow) bench.glow('wheelR', 0.8, RING)
        },
      },
      3,
    ),
}
