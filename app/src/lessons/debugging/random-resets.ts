import {
  AMS1117_33,
  ESP32_BOD,
  ESP32_MIN_V,
  ESP32_TIMELINE,
  FaultHunt,
  SPIKE_BOT,
  SPIKE_FAULTS,
  SPIKE_HUNT,
  SPIKE_PROBES,
  SpikeFault,
  SpikeProbe,
  WEAK_BOT,
  WEAK_FAULTS,
  WEAK_HUNT,
  WEAK_PROBES,
  WEAK_TIMELINE,
  WeakFault,
  WeakProbe,
  dropoutVolts,
  linearReg,
  motorSpike,
  peakBins,
  rideThroughS,
  spikeOhms,
  weakRegulator,
} from '../../core/physics'
import { celsiusText, fixedText, msText, ohms, si } from '../../core/units'
import { FACE_VIEW, HIGH_V, HUNT_HOWTO, HUNT_LEGEND, RING, GREY, ResetSource, huntKit, huntRig, huntStage, railCapture, resetBench } from '../fx'
import { Lesson, Stage } from '../types'

type Bench = ReturnType<typeof resetBench>
type Tp = keyof Bench['tp'] & string
type Part = keyof Bench['spots'] & string
interface Tip {
  red: Tp | Part
  black: Tp
}

const REASON = (r: string) => `ESP_RST_${r}`
const BINS = 160
const A = (a: number) => si(a, 'A', 2)
const V = (v: number) => si(v, 'V', 2)
const LEVELS: [number, string, string][] = [
  [ESP32_MIN_V, 'MIN 3.0 V', HIGH_V],
  [ESP32_BOD[0], `BOD ${ESP32_BOD[0]} V`, RING],
]

interface ResetSpec<F extends string, P extends string> {
  hunt: FaultHunt<F, P>
  kit: ReturnType<typeof huntKit<F, P>>
  bench: { motors?: boolean; sensors?: boolean }
  tips: Record<P, Tip>
  parts: Record<F, Part>
  hot?: Record<string, Part>
  symptom: string
  hint: string
  fixes: Record<F, string>
  scope: P
  /** Scope traces (healthy, measured) and the timebase text, for the real fault. */
  traces: (truth: F) => [number[], number[], string]
  capture: { lo: number; hi: number }
  /** Per frame: motors, sources, reveals once found. */
  extra: (bench: Bench, truth: F, found: boolean, t: number, dt: number) => void
}

/** Shared stage: reset bench, meter, suspect table, and a scope + serial line for what the meter can't catch. */
function resetBuild<F extends string, P extends string>(s: ResetSpec<F, P>, colW: number): Stage {
  const { scene, header } = huntStage()
  const bench = resetBench(scene, s.bench)
  const cap = railCapture(scene, [9.5, -6.3, 0], 4.4, 2.6, { ...s.capture, title: '3.3 V rail', levels: LEVELS })
  const rig = huntRig<F, P, Tp, Part, Tip>(scene, header, {
    ...s,
    bench,
    table: { colW, nameW: 5 },
    extra({ q, read, t, dt, found }) {
      s.extra(bench, q.truth, found, t, dt)
      if (q.probe === s.scope) {
        const [ok, got, span] = s.traces(q.truth)
        cap.set(ok, got, span)
        cap.log('grey healthy · cyan this case', GREY)
      } else {
        cap.set(null, null, '')
        cap.log(read.unit === 'log' ? REASON(read.label ?? '') : 'Scope: pick “3.3 V, scope”', read.unit === 'log' ? (read.label === 'POWERON' ? GREY : HIGH_V) : GREY)
      }
    },
  })
  return { scene, view: FACE_VIEW, ...rig }
}

// --- Motor spike resets ---

const spKit = huntKit(SPIKE_HUNT, SPIKE_FAULTS, SPIKE_PROBES, 79)
const sp = (f: SpikeFault | 'ok') => motorSpike(f)
const spTrace = (f: SpikeFault | 'ok') => peakBins(sp(f).run.rail, BINS, AMS1117_33.vout)
const okSp = sp('ok')
const noCap = sp('cap')
const thin = spikeOhms(true)
const SPIKE_FLOOR = ESP32_MIN_V + dropoutVolts(AMS1117_33, ESP32_TIMELINE.runA)
/** Healthy hold-up: the cap alone carrying the ESP32 from its rest volts down to the floor. */
const RIDE_S = rideThroughS(SPIKE_BOT.holdup.farads, ESP32_TIMELINE.runA, okSp.run.vin[0], SPIKE_FLOOR)
const SP_FIX: Record<SpikeFault, string> = {
  cap: `No hold-up cap: VIN follows the pack to ${V(noCap.reads.vin.value)}, 3.3 V to ${V(noCap.reads.scope.value)}: BROWNOUT. Fit 10 mF behind the Schottky`,
  lead: `Thin 1.5 m lead: ${ohms(thin.lead)} drops ${V(sp('lead').reads.lead.value)} in the burst; the cap runs dry. Use short 20 AWG`,
  flat: `Run-down cells: ${V(sp('flat').reads.rest.value)} at rest, no headroom for the burst. Fresh cells, or 2S + a buck`,
  wdt: `The ramp loop never yields: the task watchdog fires after ${SPIKE_BOT.wdtS} s, rail clean. Add delay(1) or ramp on a timer`,
}

export const randomResetsMotorSpikeResets: Lesson = {
  id: 'random-resets-motor-spike-resets',
  title: 'Motor spike resets',
  tagline: 'The ESP32 reboots every time the motors start: catch a 50 ms dip a multimeter averages away',
  formula: (p) => {
    const q = spKit.params(p)
    const r = sp(q.truth)
    if (q.guess === q.truth && (q.truth === 'lead' || q.truth === 'flat'))
      return `VIN floor = 3.0 V + dropout ${V(dropoutVolts(AMS1117_33, ESP32_TIMELINE.runA))} = ${V(SPIKE_FLOOR)} · VIN MIN hold ${V(r.reads.vin.value)} → 3.3 V rail ${V(r.reads.scope.value)}`
    return `Sag = I_stall × R = ${A(noCap.rig.stallA)} × ${ohms(noCap.rig.ohms)} = ${V(noCap.rig.stallA * noCap.rig.ohms)} → VIN ${V(noCap.reads.vin.value)} − ${V(dropoutVolts(AMS1117_33, 0.1))} dropout = ${V(noCap.reads.scope.value)} < BOD ${ESP32_BOD[0]} V`
  },
  legend: HUNT_LEGEND,
  points: [
    HUNT_HOWTO,
    `Resets are transient. A multimeter shows ~3 averaged readings a second, so the 3.3 V rail reads about ${V(okSp.reads.rail.value)} in every case. MIN/MAX hold keeps the lowest or highest value it caught; a scope shows the dip and when it happens (Power › Brownouts › Current spikes).`,
    `Four TT motors starting from rest have no back-EMF yet: I = V / R, ${A(okSp.rig.stallA)} for ~${msText(3 * SPIKE_BOT.tau)}. Four AA cells and their springs are ~${ohms(spikeOhms().pack)}, so the pack sags ${V(okSp.rig.stallA * spikeOhms().pack)} and every part on it sees the dip.`,
    `The DevKit’s AMS1117 needs ~1 V of headroom. Under 3.0 V the ESP32 is out of spec and crashes (PANIC); under the brownout detector’s ${ESP32_BOD[0]} V it resets cleanly (BROWNOUT). esp_reset_reason() tells you which; TASK_WDT means code, not power (Software › Safety & failsafes › Watchdog).`,
    `The healthy car has a Schottky + ${SPIKE_BOT.holdup.farads * 1000} mF cap feeding only the ESP32 while the pack dips: t = C·ΔV / I = ${SPIKE_BOT.holdup.farads * 1000} mF × (${V(okSp.run.vin[0])} − ${V(SPIKE_FLOOR)}) / ${A(ESP32_TIMELINE.runA)} = ${msText(RIDE_S)}. A thin 1.5 m lead (${ohms(thin.lead)}) adds to the motor path: MAX hold across it shows I·R. Fixes: short thick leads, soft-start, or a separate logic supply.`,
  ],
  controls: spKit.controls,
  build: () =>
    resetBuild<SpikeFault, SpikeProbe>(
      {
        hunt: SPIKE_HUNT,
        kit: spKit,
        bench: { motors: true },
        tips: {
          rest: { red: 'pack', black: 'packGnd' },
          lead: { red: 'pack', black: 'rail' },
          vin: { red: 'vin', black: 'gnd' },
          rail: { red: 'v33', black: 'gnd' },
          scope: { red: 'v33', black: 'gnd' },
          reason: { red: 'usb', black: 'gnd' },
        },
        parts: { cap: 'cap', lead: 'lead', flat: 'source', wdt: 'esp' },
        symptom: 'ESP32 reboots every time the motors start',
        hint: 'Hint: the DMM looks fine; try a hold, the scope, the reset reason',
        fixes: SP_FIX,
        scope: 'scope',
        traces: (f) => [spTrace('ok'), spTrace(f), `${SPIKE_BOT.window} s`],
        capture: { lo: 1.8, hi: 3.6 },
        extra(bench, truth, found, t, dt) {
          const r = sp(truth).run
          const k = Math.floor(((t / 6) % 1) * r.motor.length)
          bench.spin(dt, Math.min(1.5, r.motor[k] / sp('ok').rig.cruiseA))
          if (r.phase[k] === 'reset' && !found) bench.glow('esp', 0.7, HIGH_V)
          bench.holdup(!(found && truth === 'cap'))
          bench.lead(found && truth === 'lead')
        },
      },
      3,
    ),
}

// --- Weak regulator ---

const wkKit = huntKit(WEAK_HUNT, WEAK_FAULTS, WEAK_PROBES, 83)
const wk = (f: WeakFault | 'ok') => weakRegulator(f)
const okWk = wk('ok')
const hot = wk('hot')
const hotW = linearReg(AMS1117_33, hot.reads.vin.value, hot.avgA).power
/** Thermal trace: the first 40 s of the junction run, one sample per bin. */
const HEAT_TRACE_S = 40
/** Healthy rail over the thermal run: always on. */
const STEADY = Array.from({ length: BINS }, () => AMS1117_33.vout)
const wkTrace = (f: WeakFault | 'ok'): number[] => {
  const w = wk(f)
  const step = HEAT_TRACE_S / WEAK_BOT.thermalDt / BINS
  return w.tripped ? STEADY.map((_, i) => (w.heat.on[Math.round(i * step)] ? AMS1117_33.vout : 0)) : peakBins(w.zoom, BINS, AMS1117_33.vout)
}
const WK_FIX: Record<WeakFault, string> = {
  low: `4 × AA run down: VIN ${V(wk('low').reads.vin.value)}, but 3.3 V needs ~${V(AMS1117_33.vout + dropoutVolts(AMS1117_33, WEAK_TIMELINE.wifiA))}. Feed VIN 5 V from a buck`,
  hot: `12 V in: ${si(hotW, 'W', 2)} in the AMS1117, ${celsiusText(hot.heat.peakC)}, shutdown every ${fixedText(hot.heat.period, 1)} s. Buck to 5 V first`,
  cap: `No 10 µF on 3.3 V: the Wi-Fi burst dips the rail to ${V(wk('cap').zoomMin)} for µs: BROWNOUT. Fit it by the module`,
  crash: 'Rail and VIN clean, still PANIC: a firmware bug. Read the Guru Meditation backtrace',
}

export const randomResetsWeakRegulator: Lesson = {
  id: 'random-resets-weak-regulator',
  title: 'Weak regulator',
  tagline: 'Random reboots, no motors involved: is the 3.3 V regulator starved, cooking or unsupported?',
  formula: (p) => {
    const q = wkKit.params(p)
    if (q.guess === q.truth && q.truth === 'hot')
      return `P = (V_in − 3.3 V) × I = (${V(hot.reads.vin.value)} − 3.3 V) × ${A(hot.avgA)} = ${si(hotW, 'W', 2)} · T_j = 25 °C + ${AMS1117_33.thetaJA} °C/W × P → trips at ${AMS1117_33.tOff} °C`
    if (q.guess === q.truth && q.truth === 'cap')
      return `Burst ΔI = ${A(WEAK_TIMELINE.wifiA - WEAK_TIMELINE.bootA)} in ${si(WEAK_BOT.riseS, 's', 1)}: dip ≈ ΔI·√(L/C) = ${V(-Math.min(...wk('cap').dip))} with 100 nF, ${V(-Math.min(...okWk.dip))} with 10 µF`
    return `V_3.3 = min(3.3 V, V_in − dropout) · dropout = ${AMS1117_33.dropout0} V + ${AMS1117_33.dropoutPerAmp} Ω × I → at the Wi-Fi burst V_in ≥ ${V(AMS1117_33.vout + dropoutVolts(AMS1117_33, WEAK_TIMELINE.wifiA))}`
  },
  legend: HUNT_LEGEND,
  points: [
    HUNT_HOWTO,
    `The DevKit’s AMS1117 is linear: it needs VIN ≥ 3.3 V + its dropout (~1 V). Four AA cells run down give ${V(wk('low').reads.vin.value)}; at each Wi-Fi burst the rail falls under 3.0 V and the ESP32 crashes (Components › Voltage regulators › Dropout).`,
    `It turns the difference into heat: (V_in − 3.3 V) × I. From a 3S pack that is ${si(hotW, 'W', 2)}; at ${AMS1117_33.thetaJA} °C/W the junction reaches ${AMS1117_33.tOff} °C in ${fixedText(hot.heat.firstTrip, 0)} s, shuts off, cools, restarts: a reboot every ${fixedText(hot.heat.period, 1)} s. On 5 V it sits at ${celsiusText(okWk.heat.peakC)}.`,
    `Wi-Fi start adds ${A(WEAK_TIMELINE.wifiA - WEAK_TIMELINE.bootA)} in a fraction of a µs, faster than the regulator reacts. The 10 µF ceramic by the module covers it; without it the rail dips ${V(-Math.min(...wk('cap').dip))} for microseconds. Only a scope at µs/div sees that (Power › Noise & decoupling).`,
    'A reset reason narrows it down, it doesn’t decide: run-down AAs crash with PANIC just like a firmware bug. Clean VIN and rail plus PANIC = code; read the backtrace.',
  ],
  controls: wkKit.controls,
  build: () =>
    resetBuild<WeakFault, WeakProbe>(
      {
        hunt: WEAK_HUNT,
        kit: wkKit,
        bench: { sensors: true },
        tips: {
          vin: { red: 'vin', black: 'gnd' },
          rail: { red: 'v33', black: 'gnd' },
          scope: { red: 'v33', black: 'gnd' },
          heat: { red: 'ldo', black: 'gnd' },
          reason: { red: 'usb', black: 'gnd' },
        },
        parts: { low: 'source', hot: 'ldo', cap: 'decoupling', crash: 'esp' },
        hot: { AMS1117: 'ldo' },
        symptom: 'ESP32 reboots at random, often just as Wi-Fi starts',
        hint: 'Hint: measure what the regulator gets, gives and how hot it runs',
        fixes: WK_FIX,
        scope: 'scope',
        traces: (f) => (wk(f).tripped ? [STEADY, wkTrace(f), `${HEAT_TRACE_S} s`] : [wkTrace('ok'), wkTrace(f), `${si(WEAK_BOT.zoomS, 's', 2)}`]),
        capture: { lo: 0, hi: 3.6 },
        extra(bench, truth, found) {
          const src: ResetSource = !found ? 'hidden' : truth === 'low' ? '4aa' : truth === 'hot' ? '3s' : 'buck'
          bench.source(src)
          bench.decoupling(!(found && truth === 'cap'))
        },
      },
      3.1,
    ),
}

