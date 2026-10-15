import { decibels, emaAlpha, rcAsymptote, rcCutoff, rcFilter, rcGain, rcPhase, rcSteadyCycle } from '.'

const sine = (c: number) => Math.sin(2 * Math.PI * c)
const span = (v: number[]) => Math.max(...v) - Math.min(...v)

describe('filters', () => {
  it('10 kΩ with 1 µF has its corner near 16 Hz, at −3 dB and 45°', () => {
    const fc = rcCutoff(10e3, 1e-6)
    expect(fc).toBeCloseTo(15.92, 2)
    expect(decibels(rcGain('low', fc, fc))).toBeCloseTo(-3.01, 2)
    expect(rcGain('high', fc, fc)).toBeCloseTo(Math.SQRT1_2, 9)
    expect(rcPhase('low', fc, fc)).toBeCloseTo(-Math.PI / 4, 9)
    expect(rcPhase('high', fc, fc)).toBeCloseTo(Math.PI / 4, 9)
  })

  it('rolls off 20 dB per decade, and low² + high² = 1', () => {
    expect(decibels(rcGain('low', 1000, 10)) - decibels(rcGain('low', 100, 10))).toBeCloseTo(-20, 0)
    expect(decibels(rcGain('high', 0.1, 10)) - decibels(rcGain('high', 1, 10))).toBeCloseTo(-20, 0)
    for (const f of [1, 10, 100]) expect(rcGain('low', f, 10) ** 2 + rcGain('high', f, 10) ** 2).toBeCloseTo(1, 9)
    expect(rcAsymptote('low', 5, 10)).toBe(0)
    expect(rcAsymptote('low', 1000, 10)).toBeCloseTo(-40, 9)
    expect(rcAsymptote('high', 1, 10)).toBeCloseTo(-20, 9)
  })

  it('rcFilter steps the exact RC: a DC step settles 63 % in one τ, high-pass decays to 0', () => {
    const dt = 1e-3
    const step = Array(1000).fill(1)
    expect(rcFilter('low', step, dt, 0.1)[99]).toBeCloseTo(1 - Math.exp(-1), 6)
    expect(rcFilter('high', step, dt, 0.1)[999]).toBeCloseTo(0, 3)
    expect(emaAlpha(dt, 0.1)).toBeCloseTo(1 - Math.exp(-0.01), 12)
  })

  it('the settled cycle of a sine matches |H| and is periodic', () => {
    const fc = 10
    for (const kind of ['low', 'high'] as const)
      for (const f of [2, 10, 50]) {
        const { output } = rcSteadyCycle(kind, sine, f, 1 / (2 * Math.PI * fc), 2048)
        expect(span(output) / 2).toBeCloseTo(rcGain(kind, f, fc), 2)
      }
  })

  it('PWM through a low-pass settles at duty × V with ripple shrinking as f rises', () => {
    const pwm = (c: number) => (c - Math.floor(c) < 0.3 ? 3.3 : 0)
    const tau = 0.01
    const slow = rcSteadyCycle('low', pwm, 50, tau, 1000).output
    const fast = rcSteadyCycle('low', pwm, 500, tau, 1000).output
    expect(fast.reduce((s, v) => s + v, 0) / fast.length).toBeCloseTo(0.99, 2)
    expect(span(fast)).toBeLessThan(span(slow) / 5)
    const high = rcSteadyCycle('high', pwm, 500, tau, 1000).output
    expect(high.reduce((s, v) => s + v, 0) / high.length).toBeCloseTo(0, 2)
  })
})
