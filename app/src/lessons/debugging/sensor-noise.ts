import {
  ADC_BOT,
  ADC_FAULTS,
  ADC_HUNT,
  ADC_PROBES,
  AdcFault,
  AdcProbe,
  FLOAT_BOT,
  FLOAT_FAULTS,
  FLOAT_HUNT,
  FLOAT_PROBES,
  FloatFault,
  FloatProbe,
  LOGIC_INPUTS,
  MeterRead,
  SWITCHES,
  adcSource,
  buttonLead,
  drivePack,
  floatingButton,
  groundOhms,
  jitteryAdc,
  motorDip,
  once,
  peakBins,
  pressCloses,
  readingSpread,
} from '../../core/physics'
import { millivolts, msText, ohms, si } from '../../core/units'
import { CASE_LOG, GREY, HUNT_HOWTO, HUNT_LEGEND, NoisePart, NoiseTp, PlotView, ProbeCase, huntKit, huntRig, huntStage, noiseBench, serialPlot } from '../fx'
import { Lesson, Stage } from '../types'

type Bench = ReturnType<typeof noiseBench>
type Plot = ReturnType<typeof serialPlot>
interface Tip {
  red: NoiseTp | NoisePart
  black: NoiseTp
}

const V = (v: number) => si(v, 'V', 2)
const A = (a: number) => si(a, 'A', 2)
const pF = (c: number) => si(c, 'F', 2)
const BINS = 200
const VDD = FLOAT_BOT.vdd
const VIL = LOGIC_INPUTS.esp32.vil * VDD
const VIH = LOGIC_INPUTS.esp32.vih * VDD

interface NoiseSpec<F extends string, P extends string> extends ProbeCase<F, P, Tip, NoisePart> {
  kind: 'button' | 'analog'
  /** Plot for the probe: healthy and this case, the view, a stats line; null = nothing to plot. */
  plot: (truth: F, probe: P) => { ok: number[] | null; got: number[] | null; view: PlotView; stats: string } | null
  extra: (bench: Bench, truth: F, probe: P, found: boolean, t: number, dt: number) => void
}

/** Shared stage: noise bench, meter, suspect table, and a serial plot for what the meter can't show. */
function noiseBuild<F extends string, P extends string>(s: NoiseSpec<F, P>, colW: number): Stage {
  const stage = huntStage()
  const { scene } = stage
  const bench = noiseBench(scene, s.kind)
  const plot: Plot = serialPlot(scene, [9.5, -6.3, 0], 4.4, 2.6, 'Serial plot')
  let shown = ''
  return huntRig<F, P, NoiseTp, NoisePart, Tip>(stage, {
    ...s,
    bench,
    table: { colW, nameW: 5 },
    extra({ q, t, dt, found }) {
      s.extra(bench, q.truth, q.probe, found, t, dt)
      const key = `${q.truth}|${q.probe}`
      if (key === shown) return
      shown = key
      const p = s.plot(q.truth, q.probe)
      if (!p) {
        plot.show(null, null, { lo: 0, hi: 1, axis: ['', ''], span: '' })
        plot.stats('Meter: power off, Ω range', GREY)
        plot.log('')
        return
      }
      plot.show(p.ok, p.got, p.view)
      plot.stats(p.stats)
      plot.log(CASE_LOG)
    },
  })
}

/** `n` samples of a running count of `times` over 0…`seconds`. */
const staircase = (times: number[], seconds: number) => Array.from({ length: BINS }, (_, i) => times.filter((x) => x <= (i / (BINS - 1)) * seconds).length)
const presses = (r: MeterRead) => Math.round(r.value)

// --- Floating input ---

const flKit = huntKit(FLOAT_HUNT, FLOAT_FAULTS, FLOAT_PROBES, 89)
const fl = (f: FloatFault | 'ok') => floatingButton(f)
const FL = once(() => {
  const lead = buttonLead('lead')
  const short = buttonLead('ok')
  return {
    okIdle: fl('ok').reads.idle.value,
    pack: drivePack().ocv,
    lead,
    short,
    tau: FLOAT_BOT.pullOhms * (lead.cc + lead.cg),
    dipLead: motorDip('lead'),
    dipOk: motorDip('ok'),
    closes: pressCloses().closes.length,
  }
})
const flFixes = (): Record<FloatFault, string> => ({
  nopull: `No pull-up: GPIO 27 floats, hum swings it across both thresholds: ${presses(fl('nopull').reads.quiet)} counts in 10 s. Fit 10 kΩ to 3V3`,
  wrongpin: `The 10 kΩ sits on GPIO 26, so 27 floats just the same (${presses(fl('wrongpin').reads.quiet)} counts in 10 s). Move it one pin over`,
  lead: `Lead taped to the motor wires: each PWM edge kicks GPIO 27 down ${V(FL().dipLead)}, under VIL. Short lead, kept apart`,
  isr: `No debounce: one press bounces closed ${FL().closes} times, each counted. Ignore edges for 200 ms after a count`,
})

export const sensorNoiseFloatingInput: Lesson = {
  id: 'sensor-noise-floating-input',
  title: 'Floating input',
  tagline: 'The start button counts presses nobody made: a floating pin, a stray pull-up, coupled motor edges or bounce?',
  formula: (p) => {
    const q = flKit.params(p)
    const f = FL()
    if (q.guess === q.truth && q.truth === 'lead')
      return `Kick = V·Cc/(Cc+Cg) · τ/t_r·(1 − e^(−t_r/τ)) = ${V(f.pack)} × ${pF(f.lead.cc)} / ${pF(f.lead.cc + f.lead.cg)} ≈ ${V(f.dipLead)} → pin ${V(VDD - f.dipLead)} < VIL ${V(VIL)}`
    if (q.guess === q.truth && q.truth === 'isr')
      return `Tact bounce ${msText(SWITCHES.tact.makeS)} on press + ${msText(SWITCHES.tact.breakS)} on release → ${f.closes} closes · 200 ms lockout → 1 count`
    return `ESP32 input: LOW ≤ 0.25 × 3.3 V = ${V(VIL)}, HIGH ≥ 0.75 × 3.3 V = ${V(VIH)} · pull-up: 3.3 V − I_leak × 10 kΩ = ${V(f.okIdle)}`
  },
  legend: HUNT_LEGEND,
  points: [
    HUNT_HOWTO,
    'A CMOS input draws almost nothing, so with nothing pulling it the pin floats: the lead’s few pF pick up mains hum and your hand, and it reads 0 and 1 at random (Microcontrollers › GPIO). A meter can’t see it: its 10 MΩ is the only DC path, so it shows the pin’s ~50 nA leakage × 10 MΩ = 0.5 V. Count edges instead.',
    `A 10 kΩ pull-up holds the pin at ${V(FL().okIdle)}. Soldered one pin over it does nothing for GPIO 27: Ω from 3V3 to each pin (power off) shows where it went. GPIO 34–39 have no internal pulls, so INPUT_PULLUP there floats too.`,
    `A pulled-up pin can still be kicked. A 1.5 m lead taped to a motor wire couples ${pF(FL().lead.cc)} to it; each ${V(FL().pack)} PWM edge dips the pin ${V(FL().dipLead)} for ~${si(FL().tau, 's', 2)} (τ = 10 kΩ × ${pF(FL().lead.cc + FL().lead.cg)}): under VIL, and an interrupt catches it. Short and clear (${pF(FL().short.cc)}) the dip is ${V(FL().dipOk)}. Only with the motors on: that’s the tell.`,
    `A tact switch bounces for ~${msText(SWITCHES.tact.makeS)}: ${FL().closes} contact closes per press and release. The ISR ignores edges for 200 ms after a count; without that, one press counts ${presses(fl('isr').reads.press)} (Circuit challenges › Timing puzzles › Debounce time).`,
  ],
  controls: flKit.controls,
  build: () =>
    noiseBuild<FloatFault, FloatProbe>(
      {
        hunt: FLOAT_HUNT,
        kit: flKit,
        kind: 'button',
        tips: {
          idle: { red: 'gpio27', black: 'gnd' },
          pull: { red: 'v33', black: 'gpio27' },
          pin26: { red: 'v33', black: 'gpio26' },
          quiet: { red: 'usb', black: 'gnd' },
          motors: { red: 'usb', black: 'gnd' },
          press: { red: 'usb', black: 'gnd' },
        },
        parts: { nopull: 'pull', wrongpin: 'pull26', lead: 'lead', isr: 'esp' },
        symptom: 'The start button counts presses nobody made',
        hint: 'Hint: count presses (motors off, on, one press); Ω the pull-up',
        fixes: flFixes(),
        plot(truth, probe) {
          if (probe === 'pull' || probe === 'pin26') return null
          if (probe === 'idle') {
            const cut = (f: FloatFault | 'ok') => fl(f).quiet.trace.slice(0, BINS)
            const got = cut(truth)
            const sp = readingSpread(got)
            return {
              ok: cut('ok'),
              got,
              view: { lo: 0, hi: 3.6, axis: ['0 V', '3.6 V'], span: '200 ms', marks: [[VIH, 'VIH'], [VIL, 'VIL']] },
              stats: `GPIO 27 swings ${V(sp.min)} … ${V(sp.max)}`,
            }
          }
          const run = (f: FloatFault | 'ok') => fl(f)[probe]
          const r = run(truth)
          const hi = Math.max(4, Math.ceil(1.15 * Math.max(r.counted, run('ok').counted)))
          return {
            ok: staircase(run('ok').times, r.seconds),
            got: staircase(r.times, r.seconds),
            view: { lo: 0, hi, axis: ['0', String(hi)], span: `${r.seconds} s` },
            stats: `presses = ${r.counted} (healthy ${run('ok').counted})`,
          }
        },
        extra(bench, truth, probe, found, t, dt) {
          bench.pull(found && truth === 'nopull' ? null : found && truth === 'wrongpin' ? 26 : 27)
          bench.lead(found && truth === 'lead')
          bench.spin(dt, probe === 'motors' ? 1 : 0)
          bench.press(probe === 'press' && t % 2 < 0.3 ? 1 : 0)
        },
      },
      3,
    ),
}

// --- Missing decoupling ---

const adKit = huntKit(ADC_HUNT, ADC_FAULTS, ADC_PROBES, 97)
const ad = (f: AdcFault | 'ok') => jitteryAdc(f)
const pp = (f: AdcFault | 'ok', p: AdcProbe) => Math.round(ad(f).reads[p].value)
const AD = once(() => {
  const src = adcSource('source')
  return {
    lsb: 3.1 / 4095,
    gnd: ad('ground').reads.gnd.value / 1000,
    okRail: ad('ok').reads.rail.value / 1000,
    bareRail: ad('decap').reads.rail.value / 1000,
    src,
  }
})
const adFixes = (): Record<AdcFault, string> => ({
  decap: `No 470 µF by the sensor: its 5 V swings ${millivolts(AD().bareRail)} p-p with the PWM, ${pp('decap', 'plot')} counts. Fit bulk next to the ceramics`,
  ground: `Sensor GND rides the motor return: ${A(ADC_BOT.motorA)} × ${ohms(groundOhms())} = ${millivolts(AD().gnd)} per PWM pulse. Give it its own wire to the ESP32`,
  source: `150 k / 150 k divider, no pin cap: ${ohms(AD().src.rth)} picks up ${millivolts(2 * AD().src.hum)} p-p of 50 Hz hum. Fit 100 nF at GPIO 34`,
  noisy: `Wiring clean, the sensor itself is noisy: 16 reads cut ${pp('noisy', 'quiet')} → ${pp('noisy', 'avg')} counts p-p (σ/√16). Average in firmware`,
})

export const sensorNoiseMissingDecoupling: Lesson = {
  id: 'sensor-noise-missing-decoupling',
  title: 'Missing decoupling',
  tagline: 'A sensor held still, yet its ADC reading jumps: the supply, the ground, the source impedance or the sensor itself?',
  formula: (p) => {
    const q = adKit.params(p)
    const a = AD()
    if (q.guess === q.truth && q.truth === 'ground')
      return `ΔV = I × R = ${A(ADC_BOT.motorA)} × ${ohms(groundOhms())} = ${millivolts(a.gnd)} → ÷ ${si(a.lsb, 'V', 2)}/count ≈ ${Math.round(a.gnd / a.lsb)} counts`
    if (q.guess === q.truth && q.truth === 'source')
      return `V_hum = V·ωCR / √(1 + (ωCR)²) = 230 V × 2π·50 Hz × 5 pF × ${ohms(a.src.rth)} = ${millivolts(a.src.hum)} peak`
    if (q.guess === q.truth && q.truth === 'noisy') return `Averaging n reads: σ_avg = σ / √n → 16 reads = ¼ the noise (Microcontrollers › ADC)`
    return `11 dB: 1 count = 3.1 V / 4095 = ${si(a.lsb, 'V', 2)} · the sensor's output = ½ its 5 V, the divider halves it: GPIO 34 moves ¼ of any 5 V ripple`
  },
  legend: HUNT_LEGEND,
  points: [
    HUNT_HOWTO,
    `The ESP32 ADC measures against its own reference, so ripple on the sensor’s supply and volts between the two grounds land in the reading: at 11 dB one count is ${si(AD().lsb, 'V', 2)}. Plot raw readings (Serial Plotter) and judge the spread, not one number.`,
    `Four TT motors switching ${A(ADC_BOT.motorA)} at 20 kHz pull the shared 5 V around. With 470 µF + 10 µF + 100 nF by the sensor it moves ${millivolts(AD().okRail)} p-p; the ceramics alone hold the edges but not the 25 µs pulses: ${millivolts(AD().bareRail)} (Power › Noise & decoupling). Motors off, it’s gone; a scope on the sensor’s pins shows it.`,
    `A ground wire carrying motor current isn’t 0 V: ${ohms(groundOhms())} of 28 AWG × ${A(ADC_BOT.motorA)} = ${millivolts(AD().gnd)}, added to the sensor’s output. Same motors-only tell, but the 5 V is clean: scope GND to GND (Signals › Grounding & shielding).`,
    `High source impedance makes the pin an antenna: 5 pF from mains wiring into ${ohms(AD().src.rth)} couples ${millivolts(AD().src.hum)} of hum, motors or not, and 16 reads in 160 µs can’t average a 20 ms wave. A noisy sensor’s white noise does average down: 16 reads → ¼.`,
  ],
  controls: adKit.controls,
  build: () =>
    noiseBuild<AdcFault, AdcProbe>(
      {
        hunt: ADC_HUNT,
        kit: adKit,
        kind: 'analog',
        tips: {
          plot: { red: 'usb', black: 'gnd' },
          quiet: { red: 'usb', black: 'gnd' },
          avg: { red: 'usb', black: 'gnd' },
          rail: { red: 's5v', black: 'sgnd' },
          gnd: { red: 'sgnd', black: 'egnd' },
        },
        parts: { decap: 'caps', ground: 'ground', source: 'divider', noisy: 'sensor' },
        symptom: 'A sensor held still: its ADC reading jumps around',
        hint: 'Hint: motors on vs off, the 16× average, then scope its 5 V and its GND',
        fixes: adFixes(),
        plot(truth, probe) {
          if (probe === 'rail' || probe === 'gnd') {
            const trace = (f: AdcFault | 'ok') => {
              const r = ad(f)
              return probe === 'rail' ? peakBins(r.rail, BINS, ADC_BOT.vs) : peakBins(r.drop, BINS, 0).map((v) => 1000 * v)
            }
            const got = trace(truth)
            const sp = readingSpread(got)
            if (probe === 'gnd') {
              const hi = Math.max(20, Math.ceil(1.3 * sp.max))
              return { ok: trace('ok'), got, view: { lo: 0, hi, axis: ['0 mV', `${hi} mV`], span: '50 µs' }, stats: `Scope GND ↔ GND: ${Math.round(sp.pp)} mV p-p` }
            }
            const half = Math.max(0.1, 0.6 * Math.max(sp.pp, readingSpread(trace('ok')).pp))
            const ax = (v: number) => `${(ADC_BOT.vs + v).toFixed(2)} V`
            return { ok: trace('ok'), got, view: { lo: ADC_BOT.vs - half, hi: ADC_BOT.vs + half, axis: [ax(-half), ax(half)], span: '50 µs' }, stats: `Scope on its 5 V: ${millivolts(sp.pp)} p-p` }
          }
          const got = ad(truth)[probe]
          const ok = ad('ok')[probe]
          const sp = readingSpread(got)
          const mid = Math.round(readingSpread(ok).mean)
          const half = Math.max(40, Math.ceil(0.6 * Math.max(sp.pp, readingSpread(ok).pp)))
          return {
            ok,
            got,
            view: { lo: mid - half, hi: mid + half, axis: [String(mid - half), String(mid + half)], span: `${+(ADC_BOT.readings * ADC_BOT.plotS).toFixed(1)} s` },
            stats: `raw ${Math.round(sp.min)} … ${Math.round(sp.max)} · p-p ${Math.round(sp.pp)}`,
          }
        },
        extra(bench, truth, probe, found, _t, dt) {
          bench.caps(!(found && truth === 'decap'))
          bench.ground(found && truth === 'ground')
          bench.divider(found && truth === 'source' ? adcSource('source').r1 : adcSource('ok').r1)
          bench.spin(dt, probe === 'quiet' || probe === 'avg' ? 0 : 1)
        },
      },
      3.4,
    ),
}
