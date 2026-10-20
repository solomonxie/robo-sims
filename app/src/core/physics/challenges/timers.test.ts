import { medianMs } from '../../stopwatch'
import { NE555, astable555, astableAt, blinkChallenge, debounceChallenge, debounceLevels, debounceRun } from './timers'

describe('555 astable', () => {
  it('textbook formula: f = 1.44 / ((R1 + 2 R2) C), duty = (R1 + R2) / (R1 + 2 R2)', () => {
    const a = astable555(10e3, 68e3, 10e-6, false)
    expect(a.hz).toBeCloseTo(1 / (Math.LN2 * 146e3 * 10e-6), 9)
    expect(a.duty).toBeCloseTo(78 / 146, 9)
    expect(a.tFirst).toBeGreaterThan(a.tH)
  })
  it('a diode across R2 lets the duty drop under 50 %, but its drop stretches t_H past ln 2 · R1 C', () => {
    const plain = astable555(47e3, 240e3, 4.7e-6, false)
    const d = astable555(47e3, 240e3, 4.7e-6, true)
    expect(plain.duty).toBeGreaterThan(0.5)
    expect(d.duty).toBeLessThan(0.25)
    expect(d.vd).toBeGreaterThan(0.3)
    expect(d.tH).toBeGreaterThan(Math.LN2 * 47e3 * 4.7e-6)
    expect(d.tL).toBeCloseTo(plain.tL, 12)
  })
  it('the cap swings between ⅓ and ⅔ VCC, output HIGH while charging', () => {
    const a = astable555(10e3, 68e3, 10e-6, false)
    expect(astableAt(a, 0).vc).toBe(0)
    expect(astableAt(a, a.tFirst - 1e-6).vc).toBeCloseTo(a.vHi, 4)
    const t = a.tFirst + a.tL
    expect(astableAt(a, t - 1e-6)).toMatchObject({ high: false })
    expect(astableAt(a, t - 1e-6).vc).toBeCloseTo(a.vLo, 4)
    expect(astableAt(a, t + 1e-6).high).toBe(true)
    expect(astableAt(a, t + a.period).vc).toBeCloseTo(astableAt(a, t).vc, 6)
  })
})

describe('blinkChallenge', () => {
  it('passes a film-cap even blink, LED through 150 Ω', () => {
    const s = blinkChallenge('even', 10e3, 68e3, 10e-6, 'film', false, 150)
    expect(s.verdict.pass).toBe(true)
    expect(s.led.amps).toBeGreaterThan(0.005)
    expect(s.corners[0]).toBeLessThan(s.hz)
  })
  it('order: discharge, slow / fast, duty, leak, bulky, spread, led', () => {
    expect(blinkChallenge('even', 470, 68e3, 10e-6, 'film', false, 150).verdict.fail).toBe('discharge')
    expect(blinkChallenge('even', 10e3, 68e3, 15e-6, 'film', false, 150).verdict).toMatchObject({ fail: 'slow', near: true })
    expect(blinkChallenge('even', 10e3, 68e3, 1e-6, 'film', false, 150).verdict).toMatchObject({ fail: 'fast', near: false })
    expect(blinkChallenge('flash', 10e3, 68e3, 10e-6, 'film', false, 150).verdict.fail).toBe('duty')
    expect(blinkChallenge('flash', 47e3, 240e3, 4.7e-6, 'film', true, 150).verdict.pass).toBe(true)
    expect(blinkChallenge('even', 10e3, 68e3, 10e-6, 'electrolytic', false, 150).verdict.fail).toBe('leak')
    expect(blinkChallenge('even', 1e3, 6.8e3, 100e-6, 'film', false, 150).verdict.fail).toBe('bulky')
    expect(blinkChallenge('even', 1e3, 6.8e3, 100e-6, 'electrolytic', false, 150).verdict).toEqual({ pass: false, near: true, fail: 'spread' })
    expect(blinkChallenge('even', 10e3, 68e3, 10e-6, 'film', false, 33).verdict.fail).toBe('led')
    expect(NE555.minR1).toBe(1e3)
  })
})

describe('debounce', () => {
  it('thresholds: 74HC14 1.0 / 1.8 V, ESP32 VIL / VIH 0.83 / 2.48 V', () => {
    expect(debounceLevels('hc14').lo).toBeCloseTo(0.99, 6)
    expect(debounceLevels('gpio').hi).toBeCloseTo(2.475, 6)
  })
  it('no filter: the bounces read as several presses; RC + Schmitt reads one, quickly', () => {
    expect(debounceRun('worn', 'hc14', 10e3, 1e-9).presses).toBeGreaterThan(2)
    const s = debounceChallenge('worn', 'hc14', 10e3, 1e-6)
    expect(s.presses).toBe(1)
    expect(s.verdict.pass).toBe(true)
    expect(s.releaseLag).toBeGreaterThan(s.pressLag)
    const rc = s.tauRelease * Math.log((3.3 - s.pressedV) / (3.3 * 0.45))
    expect(s.releaseLag).toBeGreaterThan(rc)
    expect(s.releaseLag).toBeLessThan(rc + s.part.breakS)
  })
  it('order: level, missed, bounce, slow, chatter', () => {
    expect(debounceChallenge('tact', 'hc14', 1e3, 1e-6).verdict.fail).toBe('level')
    expect(debounceChallenge('tact', 'hc14', 10e3, 100e-6).verdict.fail).toBe('missed')
    expect(debounceChallenge('tact', 'hc14', 10e3, 1e-9).verdict.fail).toBe('bounce')
    expect(debounceChallenge('game', 'hc14', 10e3, 1e-6).verdict).toMatchObject({ fail: 'slow', near: false })
    const g = debounceChallenge('tact', 'gpio', 3.3e3, 1e-6)
    expect(g.verdict).toEqual({ pass: false, near: true, fail: 'chatter' })
    expect(g.dwellS).toBeGreaterThan(1e-3)
  })
  it('solves fast', () => {
    expect(medianMs(() => debounceChallenge('worn', 'gpio', 10e3, 1e-6))).toBeLessThan(40)
    expect(medianMs(() => blinkChallenge('flash', 47e3, 240e3, 4.7e-6, 'film', true, 150))).toBeLessThan(5)
  })
})
