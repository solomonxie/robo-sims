import { BSS138, ESP32_ABS_MAX, LOGIC_INPUTS, MOSFETS, Shifter, dividerShift, noiseMargins, readInput, riseTime, shifterSolve, thresholds } from '.'

const shifter = (o: Partial<Shifter> = {}): Shifter => ({ lowRail: 3.3, highRail: 5, lowPull: 10e3, highPull: 10e3, fet: BSS138, pullLow: false, pullHigh: false, ...o })

describe('levels', () => {
  it('3.3 V is HIGH to an ATmega or a 74HCT at 5 V but not to a WS2812', () => {
    expect(readInput(3.3, LOGIC_INPUTS.atmega328, 5)).toBe(1)
    expect(readInput(3.3, LOGIC_INPUTS.hct, 5)).toBe(1)
    expect(readInput(3.3, LOGIC_INPUTS.ws2812, 5)).toBeNull()
    expect(readInput(1, LOGIC_INPUTS.ws2812, 5)).toBe(0)
    expect(thresholds(LOGIC_INPUTS.hct, 3.3)).toEqual({ vil: 0.8, vih: 2 })
    expect(noiseMargins(3.3, 0, LOGIC_INPUTS.atmega328, 5).high).toBeCloseTo(0.3, 9)
    expect(noiseMargins(3.3, 0, LOGIC_INPUTS.ws2812, 5).high).toBeLessThan(0)
  })
  it('a 10k/20k divider brings 5 V under the ESP32 limit and above its VIH', () => {
    const d = dividerShift(5, 10e3, 20e3, 15e-12)
    expect(d.vout).toBeCloseTo(3.333, 3)
    expect(d.vout).toBeLessThan(ESP32_ABS_MAX)
    expect(readInput(d.vout, LOGIC_INPUTS.esp32, 3.3)).toBe(1)
    expect(d.amps).toBeCloseTo(5 / 30e3, 12)
    expect(d.tau).toBeCloseTo(100e-9, 15)
  })
  it('rise time grows with the target and never reaches the final value', () => {
    expect(riseTime(0.5, 1, 1)).toBeCloseTo(Math.LN2, 12)
    expect(riseTime(0.9, 1, 1)).toBeGreaterThan(riseTime(0.5, 1, 1))
    expect(riseTime(1, 1, 1)).toBe(Infinity)
  })
  it('idle: both sides sit at their own rail, the FET is off', () => {
    const r = shifterSolve(shifter())
    expect(r.vl).toBeCloseTo(3.3, 3)
    expect(r.vh).toBeCloseTo(5, 3)
    expect(r.on).toBe(false)
  })
  it('either side pulling low drags the other low through the channel', () => {
    for (const s of [shifter({ pullLow: true }), shifter({ pullHigh: true })]) {
      const r = shifterSolve(s)
      expect(r.on).toBe(true)
      expect(r.vl).toBeLessThan(0.1)
      expect(r.vh).toBeLessThan(0.1)
    }
  })
  it('a 2N7000 cannot shift from 1.8 V: too little gate drive', () => {
    const fet = MOSFETS['2N7000']
    const low = shifterSolve(shifter({ lowRail: 1.8, fet, pullLow: true }))
    expect(low.vh).toBeGreaterThan(4.9)
    const high = shifterSolve(shifter({ lowRail: 1.8, fet, pullHigh: true }))
    expect(high.diodeA).toBeGreaterThan(1e-5)
    expect(readInput(high.vl, LOGIC_INPUTS.esp32, 1.8)).toBeNull()
    expect(shifterSolve(shifter({ lowRail: 1.8, pullHigh: true })).vl).toBeLessThan(0.1)
  })
})
