import { medianMs } from '../../stopwatch'
import { E12, E24 } from '../../resistorColors'
import { ESP32_ATTEN } from '../mcu/adc'
import { ADC_PUZZLE, DIVIDER_PUZZLE, adcMatch, adcTapRead, shiftDivider } from './dividers'

const decade = (series: number[], from: number, to: number) => {
  const out: number[] = []
  for (let d = from; d <= to; d *= 10) out.push(...series.map((v) => v * d))
  return out
}

describe('3.3 V from 5 V', () => {
  it('10 k over 22 k: 3.44 V, every 5 % corner under 3.6 V, fast enough for UART', () => {
    const s = shiftDivider('uart', 10e3, 22e3)
    expect(s.vout).toBeCloseTo(5 * 22 / 32, 6)
    expect(s.corners[1]).toBeLessThan(DIVIDER_PUZZLE.hi)
    expect(s.corners[0]).toBeLessThan(s.vout)
    expect(s.verdict.pass).toBe(true)
  })
  it('order: over, low, waste, spread, slow', () => {
    expect(shiftDivider('echo', 10e3, 47e3).verdict.fail).toBe('over')
    expect(shiftDivider('echo', 10e3, 10e3).verdict).toEqual({ pass: false, near: true, fail: 'low' })
    expect(shiftDivider('echo', 10e3, 1e3).verdict).toMatchObject({ fail: 'low', near: false })
    expect(shiftDivider('echo', 22e3, 56e3).verdict.fail).toBe('spread')
    expect(shiftDivider('uart', 1e3, 2.2e3).verdict).toEqual({ pass: false, near: true, fail: 'waste' })
  })
  it('big resistors: slow edges fail UART but are fine for the echo', () => {
    const u = shiftDivider('uart', 100e3, 220e3)
    expect(u.tau).toBeCloseTo((100e3 * 220e3) / 320e3 * DIVIDER_PUZZLE.pinF, 12)
    expect(u.verdict.fail).toBe('slow')
    expect(shiftDivider('echo', 100e3, 220e3).verdict.pass).toBe(true)
    expect(shiftDivider('echo', 1e6, 2.2e6).verdict.fail).toBe('slow')
  })
  it('a module load sags the tap; no E12 pair powers it without wasting power', () => {
    const m = shiftDivider('module', 10e3, 22e3)
    expect(m.vout).toBeLessThan(0.2)
    const rs = decade(E12, 10, 10e3)
    for (const r1 of rs) for (const r2 of rs) expect(shiftDivider('module', r1, r2).verdict.pass).toBe(false)
    expect(shiftDivider('module', 100, 220).verdict.fail).toBe('waste')
  })
})

describe('ADC range matching', () => {
  it('pin volts and reconstructed input inside the linear range', () => {
    const r = adcTapRead(7.4, 75e3, 27e3, '11')
    expect(r.vpin).toBeCloseTo((7.4 * 27) / 102, 9)
    expect(Math.abs(r.readV - 7.4)).toBeLessThan(0.02)
  })
  it('2S on 11 dB: 75 k / 27 k passes with a pin cap; without one the 20 kΩ source is a close miss', () => {
    expect(adcMatch('pack2s', 75e3, 27e3, '11', true).verdict.pass).toBe(true)
    const m = adcMatch('pack2s', 75e3, 27e3, '11', false)
    expect(m.rth).toBeGreaterThan(ADC_PUZZLE.sourceOhms)
    expect(m.verdict).toEqual({ pass: false, near: true, fail: 'source' })
    expect(m.worstErr).toBeLessThan(0.01)
  })
  it('order: abs, clip, toe, range, drain', () => {
    expect(adcMatch('pack2s', 10e3, 10e3, '11', true).verdict).toEqual({ pass: false, near: false, fail: 'abs' })
    const clip = adcMatch('pack2s', 47e3, 27e3, '11', true)
    expect(clip.pinHi).toBeGreaterThan(ESP32_ATTEN['11'].hi)
    expect(clip.verdict).toMatchObject({ fail: 'clip', near: true })
    expect(clip.worstErr).toBeGreaterThan(0.01)
    expect(adcMatch('pack2s', 75e3, 27e3, '0', true).verdict.fail).toBe('clip')
    expect(adcMatch('cell1s', 1e6, 39e3, '11', true).verdict.fail).toBe('toe')
    expect(adcMatch('pack2s', 100e3, 15e3, '11', true).verdict.fail).toBe('range')
    expect(adcMatch('pack2s', 7.5e3, 2.7e3, '11', true).verdict.fail).toBe('drain')
  })
  it('every source has an E24 answer on 11 dB with a cap', () => {
    const rs = decade(E24, 1e3, 100e3)
    for (const src of ['cell1s', 'pack2s', 'lead12'] as const) expect(rs.some((r1) => rs.some((r2) => adcMatch(src, r1, r2, '11', true).verdict.pass))).toBe(true)
  })
  it('solves fast', () => {
    expect(medianMs(() => { for (let k = 0; k < 50; k++) { adcMatch('lead12', 130e3 + k, 24e3, '11', false); shiftDivider('uart', 10e3 + k, 22e3) } })).toBeLessThan(50)
  })
})
