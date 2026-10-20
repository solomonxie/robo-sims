import { medianMs } from '../../stopwatch'
import { LOGIC_INPUTS } from '../levels'
import { SWITCHES } from '../electromechanical'
import { capPickup } from '../signals/interference'
import { FaultHunt, faultTable, probesNeeded, sameReading, stillSuspect } from './hunt'
import {
  ADC_BOT,
  ADC_HUNT,
  FLOAT_BOT,
  FLOAT_HUNT,
  adcPinAt,
  adcSource,
  buttonLead,
  edgeKick,
  floatingButton,
  groundOhms,
  jitteryAdc,
  lockoutCount,
  motorDip,
  pressCloses,
  readingSpread,
} from './sensornoise'

const HUNTS = [FLOAT_HUNT, ADC_HUNT] as unknown as FaultHunt<string, string>[]

describe('sensor noise faults', () => {
  it('every hunt separates every fault, and each differs from the healthy build', () => {
    for (const h of HUNTS) {
      const t = faultTable(h)
      for (const f of h.faults) {
        expect(h.probes.some((p) => !sameReading(t.ok[p], t[f][p]))).toBe(true)
        expect(stillSuspect(h, f, h.probes)).toEqual([f])
        expect(probesNeeded(h, f).length).toBeGreaterThan(0)
      }
    }
  })
  it('spread, lockout and edge coupling', () => {
    expect(readingSpread([1, 3, 2])).toMatchObject({ min: 1, max: 3, mean: 2, pp: 2 })
    expect(lockoutCount([0, 0.01, 0.3, 0.05, 0.31], 0.2)).toEqual([0, 0.3])
    // Slow edge or a stiff pull-up: less kick; no resistor: plain charge share.
    expect(edgeKick(10, 1e-9, 1e-12, 9e-12, Infinity)).toBeCloseTo(1, 9)
    expect(edgeKick(10, 1e-9, 1e-12, 9e-12, 1e9)).toBeCloseTo(1, 3)
    expect(edgeKick(10, 1e-6, 1e-12, 9e-12, 1e3)).toBeLessThan(0.02)
  })
  it('floating input: the healthy button counts one press; a floating pin counts hum; the long lead counts motor edges', () => {
    const ok = floatingButton('ok')
    expect(ok.press.counted).toBe(1)
    expect(ok.quiet.counted + ok.motors.counted).toBe(0)
    // Without the lockout every bounce re-close is a press.
    expect(floatingButton('isr').press.counted).toBe(pressCloses().closes.length)
    expect(pressCloses().closes.length).toBeGreaterThan(SWITCHES.tact.bounces)
    const vil = LOGIC_INPUTS.esp32.vil * FLOAT_BOT.vdd
    expect(FLOAT_BOT.vdd - motorDip('ok')).toBeGreaterThan(LOGIC_INPUTS.esp32.vih * FLOAT_BOT.vdd)
    expect(FLOAT_BOT.vdd - motorDip('lead')).toBeLessThan(vil)
    expect(buttonLead('lead').cc).toBeGreaterThan(20 * buttonLead('ok').cc)
    // Lead: one count per lockout (plus the next PWM edge) only while the motors run.
    const lead = floatingButton('lead')
    expect(lead.quiet.counted).toBe(0)
    expect(lead.motors.counted).toBe(Math.ceil(FLOAT_BOT.countS / (FLOAT_BOT.lockoutS + 1 / FLOAT_BOT.pwmHz)))
    const nopull = floatingButton('nopull')
    expect(nopull.quiet.counted).toBeGreaterThan(10)
    expect(nopull.quiet.counted).toBeLessThanOrEqual(FLOAT_BOT.countS / FLOAT_BOT.lockoutS)
    expect(floatingButton('wrongpin').reads.quiet).toEqual(nopull.reads.quiet)
    expect(nopull.reads.idle.value).toBeCloseTo(0.5, 6)
  })
  it('jittery ADC: no bulk cap lets the rail swing, a shared ground adds I·R, a high divider picks up hum, a noisy sensor averages down', () => {
    const ok = jitteryAdc('ok')
    const decap = jitteryAdc('decap')
    expect(decap.reads.rail.value).toBeGreaterThan(3 * ok.reads.rail.value)
    expect(decap.reads.plot.value).toBeGreaterThan(2 * ok.reads.plot.value)
    expect(decap.reads.quiet).toEqual(ok.reads.quiet)
    const g = jitteryAdc('ground')
    expect(g.reads.gnd.value).toBeCloseTo(1000 * ADC_BOT.motorA * groundOhms(), 6)
    // 0.76 mV per count at 11 dB: the ground drop shows almost one-for-one.
    expect(g.reads.plot.value).toBeGreaterThan(g.reads.gnd.value / 0.76 - 10)
    const s = adcSource('source')
    expect(s.rth).toBe(75e3)
    expect(s.hum).toBeCloseTo(capPickup(230, 50, 5e-12, 75e3), 12)
    expect(s.hum).toBeGreaterThan(10 * adcSource('ok').hum)
    // Hum is slow: 16 reads in 160 µs don't average it; a noisy sensor's white noise falls ~ 1/√16.
    const src = jitteryAdc('source')
    expect(src.reads.avg.value).toBeGreaterThan(0.85 * src.reads.quiet.value)
    const noisy = jitteryAdc('noisy')
    expect(noisy.reads.avg.value).toBeLessThan(0.4 * noisy.reads.quiet.value)
    expect(noisy.reads.avg.value).toBeGreaterThan(2 * ok.reads.avg.value)
    // Pin sits mid-range: half the sensor's 2.5 V.
    expect(adcPinAt('ok', 0, false, 3)).toBeCloseTo(1.25, 1)
  })
  it('speed: both tables', () => {
    expect(medianMs(() => HUNTS.forEach((h) => faultTable(h)))).toBeLessThan(50)
  })
})
