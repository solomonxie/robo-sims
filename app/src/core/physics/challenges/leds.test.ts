import { medianMs } from '../../stopwatch'
import { LEDS, diodeVolts } from '../semiconductors'
import { LED_PUZZLE, brightnessTarget, ledLoopAt, ledPairAt, ledPart, pairParts, safeLed, twoLeds } from './leds'

describe('safe LED current', () => {
  it('I = (Vs − Vf) / R: red from 5 V through 150 Ω is the rated 20 mA', () => {
    const r = safeLed('red', 5, 150)
    expect(r.amps).toBeCloseTo(0.02, 4)
    expect(r.rMin).toBeCloseTo(150, 6)
    expect(r.verdict.pass).toBe(true)
    expect(r.rW).toBeCloseTo(0.02 * 0.02 * 150, 4)
  })
  it('too small R is over-current (near up to 30 mA, burnt past it), too big is dim', () => {
    expect(safeLed('red', 5, 120).verdict).toEqual({ pass: false, near: true, fail: 'over' })
    const burn = safeLed('red', 9, 47)
    expect(burn.verdict).toMatchObject({ fail: 'over', near: false })
    expect(burn.burnt).toBe(true)
    expect(safeLed('red', 5, 1000).verdict.fail).toBe('dim')
  })
  it('12 V: 560 Ω keeps the LED safe but cooks the ¼ W resistor past half rating; 820 Ω passes', () => {
    const hot = safeLed('red', 12, 560)
    expect(hot.verdict).toEqual({ pass: false, near: true, fail: 'heat' })
    expect(hot.rW).toBeGreaterThan(LED_PUZZLE.ratingW * LED_PUZZLE.derate)
    expect(safeLed('red', 12, 820).verdict.pass).toBe(true)
  })
  it('blue on 3.3 V has under 0.3 V of headroom: no resistor passes', () => {
    for (const r of [10, 22, 47]) expect(safeLed('blue', 3.3, r).verdict.fail).toBe('headroom')
  })
})

describe('two LEDs, one supply', () => {
  it('series: one current for both, needs Vf1 + Vf2', () => {
    const s = twoLeds('series', 'reds', 5, 100, 100)
    expect(s.amps[0]).toBeCloseTo(s.amps[1], 9)
    expect(5 - 100 * s.amps[0] - s.vf[0] - s.vf[1]).toBeCloseTo(0, 6)
    expect(s.verdict.pass).toBe(true)
    expect(twoLeds('series', 'whites', 5, 100, 100).verdict.fail).toBe('headroom')
  })
  it('parallel on one R: 50 mV of Vf spread splits the current ~e^(ΔV / nVt) ≈ 2.6 : 1', () => {
    const s = twoLeds('shared', 'reds', 5, 150, 150)
    expect(s.ratio).toBeGreaterThan(2.4)
    expect(s.ratio).toBeLessThan(2.8)
    expect(s.amps[0] + s.amps[1]).toBeCloseTo(s.supplyA, 6)
    expect(s.verdict.fail).toBe('match')
    expect(s.dimmer).toBe(1)
  })
  it('red + green on one R: red clamps the node, green stays dark', () => {
    const s = twoLeds('shared', 'mixed', 5, 150, 150)
    expect(s.amps[1]).toBeLessThan(1e-4)
    expect(s.verdict.fail).toBe('dim')
  })
  it('a resistor each: matched by picking each value', () => {
    expect(twoLeds('own', 'mixed', 5, 150, 150).verdict.fail).toBe('match')
    expect(twoLeds('own', 'mixed', 5, 220, 150).verdict.pass).toBe(true)
  })
  it('the bag spread is only on same-colour pairs', () => {
    expect(pairParts('reds')[1].vf - pairParts('reds')[0].vf).toBeCloseTo(LED_PUZZLE.batchV, 9)
    expect(pairParts('mixed')[1].vf).toBe(LEDS.green.vf)
    expect(diodeVolts(0.02, ledPart('red', 0.05))).toBeCloseTo(2.05, 6)
  })
})

describe('brightness target', () => {
  it('typical part inside ±20 % passes; worst case also needs every corner inside', () => {
    expect(brightnessTarget('torch', 3.3, 5.6, false).verdict.pass).toBe(true)
    expect(brightnessTarget('torch', 3.3, 5.6, true).verdict.fail).toBe('spread')
    expect(brightnessTarget('torch', 5, 100, true).verdict.pass).toBe(true)
  })
  it('corners bracket the typical current; ideal R lands it on target', () => {
    const b = brightnessTarget('panel', 5, 200, true)
    expect(b.lo).toBeLessThan(b.amps)
    expect(b.hi).toBeGreaterThan(b.amps)
    expect(ledLoopAt(5, b.rIdeal, LEDS.green).amps).toBeCloseTo(0.01, 5)
    expect(brightnessTarget('panel', 5, 330, false).verdict.fail).toBe('low')
    expect(brightnessTarget('panel', 5, 120, false).verdict.fail).toBe('high')
  })
  it('solves fast', () => {
    expect(medianMs(() => { for (let k = 0; k < 50; k++) { brightnessTarget('torch', 5, 100 + k, true); ledPairAt('shared', pairParts('reds'), 5, 100 + k, 100) } })).toBeLessThan(50)
  })
})
