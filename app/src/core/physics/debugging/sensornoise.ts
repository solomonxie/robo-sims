// Sensor noise: a button that counts presses nobody made (floating input, wrong pin, coupled motor edges, bounce) and an
// ADC reading that jumps (no decoupling, shared motor ground, high source impedance, a noisy sensor). New probe: a serial
// plot of readings, judged by their spread.
import { gaussAt, mean, stdDev } from '../common'
import { PIN_LEAK_A, floatingPickup, pulledPin } from '../circuits'
import { METER_INPUT_OHMS } from '../dc'
import { LOGIC_INPUTS, readInput } from '../levels'
import { GPIO_VDD } from '../mcu/gpio'
import { AttenKey, esp32Raw } from '../mcu/adc'
import { SWITCHES, bounceEdges } from '../electromechanical'
import { capPickup } from '../signals/interference'
import { CAPS, Cap, pwmCurrent, railTrace } from '../power/noise'
import { ohmsPerMetre } from '../power/wiring'
import { TT_CRUISE_A } from '../power/budget'
import { drivePack } from './motor'
import { FaultHunt, MeterRead } from './hunt'

const volt = (value: number): MeterRead => ({ value, unit: 'V' })
const ohm = (value: number): MeterRead => ({ value, unit: 'Ω' })
const OL: MeterRead = { value: Infinity, unit: 'Ω', open: true }
const mv = (value: number): MeterRead => ({ value, unit: 'mV' })
const cnt = (value: number, label: string): MeterRead => ({ value, unit: 'cnt', label })
const memo = <K extends string, V>(f: (k: K) => V) => {
  const m = new Map<K, V>()
  return (k: K) => {
    let hit = m.get(k)
    if (!hit) m.set(k, (hit = f(k)))
    return hit
  }
}
const hunt = <F extends string, P extends string>(faults: Record<F, unknown>, probes: Record<P, unknown>, read: (f: F | 'ok', p: P) => MeterRead): FaultHunt<F, P> => ({
  faults: Object.keys(faults) as F[],
  probes: Object.keys(probes) as P[],
  read,
})

/** Spread of a run of readings: what a serial plot shows at a glance. */
export function readingSpread(xs: readonly number[]) {
  const min = Math.min(...xs)
  const max = Math.max(...xs)
  return { min, max, mean: mean(xs), sd: stdDev(xs), pp: max - min }
}

/** Times at which a rising run of events is accepted when each acceptance ignores the next `lockoutS`. */
export function lockoutCount(times: readonly number[], lockoutS: number) {
  const out: number[] = []
  for (const t of [...times].sort((a, b) => a - b)) if (!out.length || t - out[out.length - 1] >= lockoutS) out.push(t)
  return out
}

/** Peak a voltage edge (`volts` in `riseS`) couples through `cc` into a node with `cg` to ground and `ohms` to a rail:
 *  a ramp into a first-order high-pass, τ = R·(Cc + Cg). With no resistor the charge just shares: V·Cc / (Cc + Cg). */
export function edgeKick(volts: number, riseS: number, cc: number, cg: number, ohms: number) {
  const share = (volts * cc) / (cc + cg)
  if (!Number.isFinite(ohms)) return share
  const tau = ohms * (cc + cg)
  return (share * tau * (1 - Math.exp(-riseS / tau))) / riseS
}

// --- Floating input: the start button on GPIO 27, counted by a falling-edge interrupt ---

/** Start button to GND on GPIO 27, a 10 kΩ pull-up to 3.3 V, an ISR on FALLING that ignores edges for 200 ms
 *  after a count (its debounce, past the release bounce too). Motors: the robo-car's 2S pack PWM'd at 1 kHz (analogWrite's default), edges ~100 ns. Lead: 20 cm kept
 *  clear of the motor wires (1 pF/m to them, 50 pF/m to ground) or 1.5 m taped along them (30 pF/m, 20 pF/m); pin 5 pF.
 *  Counts run 10 s; the press test is one press at 0.2 s held 150 ms, in a 1 s window. Floating pin sampled every 100 µs. */
export const FLOAT_BOT = {
  vdd: GPIO_VDD,
  pullOhms: 10e3,
  lockoutS: 0.2,
  pwmHz: 1e3,
  edgeS: 100e-9,
  pinF: 5e-12,
  short: { m: 0.2, couple: 1e-12, ground: 50e-12 },
  long: { m: 1.5, couple: 30e-12, ground: 20e-12 },
  countS: 10,
  press: { at: 0.2, hold: 0.15, window: 1 },
  dt: 100e-6,
}

export const FLOAT_FAULTS = {
  nopull: { name: 'No pull-up resistor' },
  wrongpin: { name: 'Pull-up on GPIO 26' },
  lead: { name: 'Long lead by motor wires' },
  isr: { name: 'No debounce in the ISR' },
}
export type FloatFault = keyof typeof FLOAT_FAULTS
export type FloatProbe = 'idle' | 'pull' | 'pin26' | 'quiet' | 'motors' | 'press'
export const FLOAT_PROBES: Record<FloatProbe, { name: string }> = {
  idle: { name: 'GPIO 27 idle' },
  pull: { name: '3V3 ↔ 27' },
  pin26: { name: '3V3 ↔ 26' },
  quiet: { name: 'Motors off' },
  motors: { name: 'Motors on' },
  press: { name: 'One press' },
}

/** The pin's capacitances with `fault`: to the motor wire and to ground (lead + pin). */
export function buttonLead(fault: FloatFault | 'ok') {
  const l = fault === 'lead' ? FLOAT_BOT.long : FLOAT_BOT.short
  return { cc: l.couple * l.m, cg: l.ground * l.m + FLOAT_BOT.pinF }
}

const floats = (f: FloatFault | 'ok') => f === 'nopull' || f === 'wrongpin'

/** Dip each falling motor edge kicks into GPIO 27 (V): through the pull-up, or a plain charge share on a floating pin. */
export const motorDip = (fault: FloatFault | 'ok') => {
  const { cc, cg } = buttonLead(fault)
  return edgeKick(drivePack().ocv, FLOAT_BOT.edgeS, cc, cg, floats(fault) ? Infinity : FLOAT_BOT.pullOhms)
}

/** Contact-close times of one press of a 6 mm tact switch (make bounce, then break bounce on release). */
export function pressCloses() {
  const p = FLOAT_BOT.press
  const s = SWITCHES.tact
  const make = bounceEdges(s.makeS, s.bounces, 3).map((e) => e + p.at)
  const brk = bounceEdges(s.breakS, Math.max(1, Math.round(s.bounces / 3)), 10).map((e) => e + p.at + p.hold)
  // Make edges: even = closes; break edges: odd = closes again.
  return { closes: [...make.filter((_, i) => i % 2 === 0), ...brk.filter((_, i) => i % 2 === 1)], make, brk }
}

/** One run of the button input with `fault`: the falling edges the pin makes, the times the ISR counts, and a trace of
 *  the pin (min per 1 ms bin) for the plot. `motors` PWMs the motors; `press` adds one press. */
export function buttonRun(fault: FloatFault | 'ok', motors: boolean, press: boolean) {
  const b = FLOAT_BOT
  const seconds = press ? b.press.window : b.countS
  const vil = LOGIC_INPUTS.esp32.vil * b.vdd
  const edges: number[] = []
  const { closes, make, brk } = pressCloses()
  const held = (t: number) => {
    if (!press) return false
    const before = t < b.press.at + b.press.hold
    const list = before ? make : brk
    const n = list.filter((e) => e <= t).length
    return before ? n % 2 === 1 : n % 2 === 0
  }
  if (press) edges.push(...closes)
  const dip = motors ? motorDip(fault) : 0
  const bins = Math.round(seconds * 1000)
  const trace = new Array<number>(bins).fill(b.vdd)
  if (floats(fault)) {
    // Hum on a floating pin, plus the motor PWM riding on it as a charge share; hysteresis between VIL and VIH.
    let high = true
    const n = Math.round(seconds / b.dt)
    for (let k = 0; k < n; k++) {
      const t = k * b.dt
      const pwmHigh = motors && (t * b.pwmHz) % 1 < 0.5
      const down = held(t)
      const v = down ? 0 : Math.min(b.vdd, Math.max(0, floatingPickup(t, b.vdd) + (pwmHigh ? dip / 2 : -dip / 2)))
      const r = readInput(v, LOGIC_INPUTS.esp32, b.vdd)
      if (r === 0 && high && !down) edges.push(t)
      if (r !== null) high = r === 1
      const i = Math.min(bins - 1, Math.floor(t * 1000))
      trace[i] = k % 10 === 0 ? v : Math.min(trace[i], v)
    }
  } else {
    if (b.vdd - dip < vil) for (let i = 0; i < seconds * b.pwmHz; i++) edges.push((i + 0.5) / b.pwmHz)
    // Sub-µs dips: too short for a 1 ms trace.
    for (let i = 0; i < bins; i++) trace[i] = held(i / 1000) ? 0 : b.vdd
  }
  const times = fault === 'isr' ? [...edges].sort((x, y) => x - y) : lockoutCount(edges, b.lockoutS)
  return { edges, times, counted: times.length, seconds, trace, dip }
}

/** The three runs per electrically distinct build (a pull-up on the wrong pin floats just like none). */
const buttonRuns = memo((fault: FloatFault | 'ok') => ({ quiet: buttonRun(fault, false, false), motors: buttonRun(fault, true, false), press: buttonRun(fault, false, true) }))

/** The button input with `fault`: the three runs and the readings. */
export const floatingButton = memo((fault: FloatFault | 'ok') => {
  const b = FLOAT_BOT
  const { quiet, motors, press } = buttonRuns(fault === 'wrongpin' ? 'nopull' : fault)
  const pulled = !floats(fault)
  const presses = (n: number) => cnt(n, n === 1 ? 'press' : 'presses')
  const reads: Record<FloatProbe, MeterRead> = {
    // A floating pin's only DC path is the meter's 10 MΩ: the pin's leakage across it is what shows.
    idle: volt(pulled ? pulledPin('up', false, b.pullOhms, b.vdd).volts! : pulledPin('down', false, METER_INPUT_OHMS, b.vdd, PIN_LEAK_A).volts!),
    pull: pulled ? ohm(b.pullOhms) : OL,
    pin26: fault === 'wrongpin' ? ohm(b.pullOhms) : OL,
    quiet: presses(quiet.counted),
    motors: presses(motors.counted),
    press: presses(press.counted),
  }
  return { quiet, motors, press, reads }
})

export const FLOAT_HUNT = hunt(FLOAT_FAULTS, FLOAT_PROBES, (f, p) => floatingButton(f).reads[p])

// --- Missing decoupling: a 5 V analog sensor through a divider into GPIO 34, on the motors' 5 V rail ---

/** A ratiometric 5 V analog sensor (output = ½ supply, held still) on the shared 5 V rail with a DRV8833 driving four TT
 *  motors at 20 kHz, 50 % (1 A while on). Rail: 0.05 Ω + 0.5 µH from the buck, 47 nF stray, 470 µF + 10 µF + 100 nF by the
 *  sensor (the fault: the 470 µF missing). The divider sits on the sensor board (10 k / 10 k; the fault 150 k / 150 k, no pin cap) into GPIO 34
 *  (ADC1, 11 dB). Sensor GND to the ESP32 on its own wire, or sharing the motors' 30 cm 28 AWG return. Mains wiring
 *  couples 5 pF of 230 V 50 Hz into the pin. ESP32 ADC noise 1.5 mV rms; sensor 1 mV rms (a noisy one 20 mV).
 *  Plot: one reading every 13 ms (loop + print, jittering over the PWM cycle), 200 readings; averages take 16 reads
 *  10 µs apart. */
export const ADC_BOT = {
  vs: 5,
  ratio: 0.5,
  sensorA: 0.01,
  motorA: 4 * TT_CRUISE_A,
  pwm: { period: 50e-6, duty: 0.5, riseS: 1e-6 },
  rail: { ohms: 0.05, henries: 0.5e-6, stray: 47e-9 },
  caps: [CAPS.bulk470u, CAPS.ceramic10u, CAPS.ceramic100n] as Cap[],
  bare: [CAPS.ceramic10u, CAPS.ceramic100n] as Cap[],
  divider: { ok: [10e3, 10e3], high: [150e3, 150e3] } as Record<'ok' | 'high', [number, number]>,
  atten: '11' as AttenKey,
  ground: { gauge: 28, m: 0.3 },
  hum: { volts: 230, hz: 50, couple: 5e-12 },
  adcSigma: 1.5e-3,
  sensorSigma: 1e-3,
  noisySigma: 20e-3,
  plotS: 0.013,
  readings: 200,
  avg: 16,
  readS: 10e-6,
  periods: 3,
  every: 5e-9,
}

export const ADC_FAULTS = {
  decap: { name: 'Bulk cap missing' },
  ground: { name: 'Shared motor ground' },
  source: { name: '150 k divider, no pin cap' },
  noisy: { name: 'Noisy sensor: average it' },
}
export type AdcFault = keyof typeof ADC_FAULTS
export type AdcProbe = 'plot' | 'quiet' | 'avg' | 'rail' | 'gnd'
export const ADC_PROBES: Record<AdcProbe, { name: string }> = {
  plot: { name: 'Motors on' },
  quiet: { name: 'Motors off' },
  avg: { name: 'Off, 16× avg' },
  rail: { name: '5 V, scope' },
  gnd: { name: 'GND, scope' },
}

/** Motor current on the 5 V rail at `t`. */
export const motorDraw = (t: number) => pwmCurrent(t, ADC_BOT.motorA, ADC_BOT.pwm.period, ADC_BOT.pwm.duty, ADC_BOT.pwm.riseS)

/** One settled PWM period of the sensor's 5 V with all its caps or just the ceramics, every `every` s (motors running). */
export const sensorRail = memo((key: 'caps' | 'bare') => {
  const b = ADC_BOT
  const [v] = railTrace([{ vs: b.vs, ...b.rail, caps: key === 'caps' ? b.caps : b.bare }], [(t) => motorDraw(t) + b.sensorA], b.periods * b.pwm.period, b.every)
  const per = Math.round(b.pwm.period / b.every)
  return v.slice(v.length - 1 - per, v.length - 1)
})

/** Shared ground lead: one wire's resistance. */
export const groundOhms = () => ohmsPerMetre(ADC_BOT.ground.gauge) * ADC_BOT.ground.m

/** Pin with `fault`: divider Thevenin resistance and the 50 Hz pickup amplitude on it. */
export function adcSource(fault: AdcFault | 'ok') {
  const [r1, r2] = ADC_BOT.divider[fault === 'source' ? 'high' : 'ok']
  const rth = (r1 * r2) / (r1 + r2)
  const h = ADC_BOT.hum
  return { r1, r2, rth, k: r2 / (r1 + r2), hum: capPickup(h.volts, h.hz, h.couple, rth) }
}

/** GPIO 34 volts at `t` with `fault` (`seed` picks the noise samples), relative to the ESP32's GND. */
export function adcPinAt(fault: AdcFault | 'ok', t: number, motors: boolean, seed: number) {
  const b = ADC_BOT
  const rail = motors ? sensorRail(fault === 'decap' ? 'bare' : 'caps') : null
  const vs = rail ? rail[Math.floor(((t % b.pwm.period) / b.pwm.period) * rail.length) % rail.length] : b.vs - b.rail.ohms * b.sensorA
  const sigma = fault === 'noisy' ? b.noisySigma : b.sensorSigma
  const out = b.ratio * vs + sigma * gaussAt(seed * 2 + 1)
  const shift = fault === 'ground' && motors ? motorDraw(t) * groundOhms() : 0
  const s = adcSource(fault)
  return shift + out * s.k + s.hum * Math.sin(2 * Math.PI * b.hum.hz * t)
}

/** The plot: `readings` raw codes, each the mean of `n` back-to-back reads; reading k at k · 13 ms plus loop jitter. */
export function adcPlot(fault: AdcFault | 'ok', motors: boolean, n = 1) {
  const b = ADC_BOT
  const golden = (Math.sqrt(5) - 1) / 2
  return Array.from({ length: b.readings }, (_, k) => {
    const t0 = k * b.plotS + ((k * golden) % 1) * b.pwm.period
    let sum = 0
    for (let i = 0; i < n; i++) {
      const seed = 7919 * (k * b.avg + i) + 17
      sum += esp32Raw(adcPinAt(fault, t0 + i * b.readS, motors, seed) + b.adcSigma * gaussAt(seed * 2), b.atten)
    }
    return sum / n
  })
}

/** The analog sensor with `fault`: the three plots, the rail period and ground drop, the readings. */
export const jitteryAdc = memo((fault: AdcFault | 'ok') => {
  const b = ADC_BOT
  const plot = adcPlot(fault, true)
  const quiet = adcPlot(fault, false)
  const avg = adcPlot(fault, false, b.avg)
  const rail = sensorRail(fault === 'decap' ? 'bare' : 'caps')
  const drop = rail.map((_, i) => (fault === 'ground' ? motorDraw((i / rail.length) * b.pwm.period) * groundOhms() : 0))
  const spread = (xs: number[]) => cnt(Math.round(readingSpread(xs).pp), 'cnt p-p')
  const reads: Record<AdcProbe, MeterRead> = {
    plot: spread(plot),
    quiet: spread(quiet),
    avg: spread(avg),
    rail: mv(1000 * readingSpread(rail).pp),
    gnd: mv(1000 * readingSpread(drop).pp),
  }
  return { plot, quiet, avg, rail, drop, reads }
})

export const ADC_HUNT = hunt(ADC_FAULTS, ADC_PROBES, (f, p) => jitteryAdc(f).reads[p])
