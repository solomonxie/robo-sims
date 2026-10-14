import {
  builtInVoltage,
  depletionWidth,
  diodeCurrent,
  drainCurrent,
  intrinsicCarriers,
  MODERN_NMOS,
} from '.'

describe('semiconductors', () => {
  it('silicon has ~1e10 intrinsic carriers per cm³ at room temperature, rising steeply with heat', () => {
    expect(intrinsicCarriers(300)).toBeCloseTo(1e10, -8)
    expect(intrinsicCarriers(400) / intrinsicCarriers(300)).toBeGreaterThan(100)
  })
  it('a 1e16/1e16 junction has ~0.7 V built in and a ~0.4 µm depletion region', () => {
    expect(builtInVoltage(1e16, 1e16)).toBeCloseTo(0.71, 1)
    const w = depletionWidth(1e16, 1e16, 0)
    expect(w).toBeGreaterThan(0.3e-6)
    expect(w).toBeLessThan(0.5e-6)
  })
  it('reverse bias widens the depletion region, forward narrows it', () => {
    const w0 = depletionWidth(1e16, 1e16, 0)
    expect(depletionWidth(1e16, 1e16, -3)).toBeGreaterThan(w0)
    expect(depletionWidth(1e16, 1e16, 0.5)).toBeLessThan(w0)
  })
  it('diode current grows ~10x per 60 mV', () => {
    expect(diodeCurrent(0.66) / diodeCurrent(0.6)).toBeCloseTo(10.2, 0)
    expect(diodeCurrent(-1)).toBeCloseTo(-1e-12)
  })
  it('a transistor is off below threshold and on above', () => {
    expect(drainCurrent(0)).toBeLessThan(1e-9)
    expect(drainCurrent(0.8)).toBeGreaterThan(5e-5)
    expect(drainCurrent(MODERN_NMOS.vthV + 0.01)).toBeGreaterThan(drainCurrent(MODERN_NMOS.vthV))
  })
})
