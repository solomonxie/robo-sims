import { CAPS, bankOhms, capOhms, decibels, lcCutoff, lcGain, noiseCounts, peakBins, pwmCurrent, railTrace, selfResonance } from '.'

const rail = (caps = [CAPS.bulk470u]) => ({ vs: 5, ohms: 0.05, henries: 0.5e-6, stray: 100e-9, caps })

describe('noise', () => {
  it('a real capacitor dips to its ESR at self-resonance, then turns inductive', () => {
    const c = CAPS.ceramic100n
    expect(selfResonance(c)).toBeCloseTo(15.9e6, -5)
    expect(capOhms(c, selfResonance(c))).toBeCloseTo(c.esr, 9)
    expect(capOhms(c, 1e3)).toBeCloseTo(1 / (2 * Math.PI * 1e3 * 100e-9), 0)
    expect(capOhms(CAPS.bulk470u, 50e6)).toBeGreaterThan(capOhms(c, 50e6))
  })

  it('bulk + ceramic in parallel is low from kHz to tens of MHz', () => {
    const both = [CAPS.bulk470u, CAPS.ceramic100n]
    expect(bankOhms([], 1e3)).toBe(Infinity)
    for (const f of [20e3, 15e6]) expect(bankOhms(both, f)).toBeLessThan(1.01 * Math.min(...both.map((c) => capOhms(c, f))))
    expect(bankOhms(both, 15e6)).toBeLessThan(0.05)
  })

  it('an LC low-pass passes DC and falls 40 dB per decade above its corner', () => {
    const L = 10e-6
    const ideal = { farads: 100e-6, esr: 0, esl: 0 }
    expect(lcCutoff(L, 100e-6)).toBeCloseTo(5033, 0)
    expect(lcGain(10, L, 0, [ideal])).toBeCloseTo(1, 3)
    expect(decibels(lcGain(50330, L, 0, [ideal]))).toBeCloseTo(-40, 0)
    expect(lcGain(1e6, L, 0, [])).toBe(1)
  })

  it('the rail settles at vs − I·R; a bulk cap holds a load step to ~ESR·ΔI once its ESL ring dies', () => {
    const [v] = railTrace([rail()], [(t) => (t > 1e-6 ? 2 : 0)], 40e-6, 0.1e-6)
    expect(v[0]).toBeCloseTo(5, 9)
    expect(5 - Math.min(...v.slice(10, 30))).toBeGreaterThan(2 * Math.sqrt(15e-9 / 100e-9) * 0.5)
    const low = Math.min(...v.slice(30))
    expect(5 - low).toBeGreaterThanOrEqual(2 * 0.05)
    expect(5 - low).toBeLessThan(0.3)
  })

  it('with only stray C a step rings down by ≈ I·√(L/C)', () => {
    const [v] = railTrace([rail([])], [(t) => (t > 0.2e-6 ? 1 : 0)], 3e-6, 10e-9)
    expect(5 - Math.min(...v)).toBeCloseTo(Math.sqrt(0.5e-6 / 100e-9), 0)
  })

  it('a second stage is fed from the first and loads it', () => {
    const lc = { vs: 0, ohms: 0.1, henries: 10e-6, stray: 10e-9, caps: [CAPS.bulk100u] }
    const [a, b] = railTrace([rail(), lc], [() => 1, () => 0.5], 5e-6, 1e-6)
    expect(a[0]).toBeCloseTo(5 - 1.5 * 0.05, 9)
    expect(b[0]).toBeCloseTo(a[0] - 0.05, 9)
    expect(b.at(-1)!).toBeCloseTo(b[0], 4)
  })

  it('peak bins keep narrow spikes; noise counts on a 12-bit ADC', () => {
    expect(peakBins([5, 5, 5, 2, 5, 5, 6, 5], 2, 5)).toEqual([2, 6])
    expect(noiseCounts(3.3, 3.3, 12)).toBe(4095)
    expect(noiseCounts(0.1, 3.3, 12)).toBe(124)
  })

  it('PWM current ramps up, holds for the duty, ramps down', () => {
    const at = (t: number) => pwmCurrent(t, 2, 50e-6, 0.5, 1e-6)
    expect(at(0.5e-6)).toBeCloseTo(1, 9)
    expect(at(10e-6)).toBe(2)
    expect(at(25.5e-6)).toBeCloseTo(1, 9)
    expect(at(40e-6)).toBe(0)
    expect(at(60e-6)).toBe(2)
  })
})
