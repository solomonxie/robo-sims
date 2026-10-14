import { FUSES, P6KE15A, diodeAmps, fuseHeat, fuseI2t, fuseMeltTime, fuseStep, reverseGuard, seriesDiode, surge, tvsNode } from '.'

describe('protection', () => {
  it('a fuse carries its rating and never melts below the minimum fusing current', () => {
    for (const f of Object.values(FUSES)) {
      expect(fuseHeat(f.ratedA, f)).toBeLessThan(0.5)
      expect(fuseMeltTime(f.ratedA, f)).toBe(Infinity)
      expect(fuseMeltTime(f.minMeltA * 0.99, f)).toBe(Infinity)
    }
  })
  it('time-current curve lands in the IEC 60127 windows', () => {
    const { F1A, T1A } = FUSES
    expect(fuseMeltTime(10, F1A)).toBeLessThan(0.02)
    expect(fuseMeltTime(2.75, F1A)).toBeGreaterThan(0.01)
    expect(fuseMeltTime(2.75, F1A)).toBeLessThan(2)
    expect(fuseMeltTime(10, T1A)).toBeGreaterThan(0.01)
    expect(fuseMeltTime(10, T1A)).toBeLessThan(0.1)
    expect(fuseMeltTime(2.75, T1A)).toBeGreaterThan(0.2)
    expect(fuseMeltTime(2.75, T1A)).toBeLessThan(10)
    expect(fuseMeltTime(3, T1A)).toBeGreaterThan(5 * fuseMeltTime(3, F1A))
  })
  it('stepping the heat melts it exactly at the curve time', () => {
    const f = FUSES.F1A
    const t = fuseMeltTime(3, f)
    let heat = 0
    const dt = 1e-4
    let now = 0
    while (heat < 1) {
      heat = fuseStep(heat, 3, dt, f)
      now += dt
    }
    expect(now).toBeCloseTo(t, 3)
    expect(fuseMeltTime(3, f, fuseStep(0, 3, t / 2, f))).toBeCloseTo(t / 2, 6)
  })
  it('big faults melt at a constant I²t', () => {
    const f = FUSES.F1A
    expect(fuseI2t(100, f)).toBeCloseTo(f.tauS * f.minMeltA ** 2, 2)
    expect(fuseI2t(5, f)).toBeGreaterThan(fuseI2t(100, f))
  })
  it('series diode: forward drops ~0.7–1 V, backwards passes only leakage', () => {
    const fwd = seriesDiode(7.4, 7.4, { saturationA: 7.03e-9, ideality: 1.808 })
    expect(fwd.v).toBeGreaterThan(0.6)
    expect(fwd.v).toBeLessThan(1)
    expect(Math.abs(seriesDiode(-7.4, 7.4, { saturationA: 7.03e-9, ideality: 1.808 }).amps)).toBeLessThan(1e-7)
  })
  it('reverse guard: none burns, diode wastes a volt, P-FET wastes millivolts', () => {
    const load = 7.4 / 2
    const none = reverseGuard(-7.4, load, 'none')
    expect(none.amps).toBeLessThan(-40)
    const diode = reverseGuard(7.4, load, 'diode')
    expect(diode.guardV).toBeGreaterThan(0.8)
    expect(diode.vLoad).toBeCloseTo(7.4 - diode.guardV - diode.amps * 0.1, 6)
    const fet = reverseGuard(7.4, load, 'pfet')
    expect(fet.guardV).toBeLessThan(0.1)
    expect(fet.guardV * fet.amps).toBeLessThan((diode.guardV * diode.amps) / 10)
    for (const g of ['diode', 'pfet'] as const) expect(Math.abs(reverseGuard(-7.4, load, g).amps)).toBeLessThan(1e-6)
  })
  it('8/20 µs surge peaks at 8 µs and halves by 20 µs', () => {
    expect(surge(8e-6)).toBeCloseTo(1, 6)
    expect(surge(20e-6)).toBeCloseTo(0.5, 2)
    expect(surge(7e-6)).toBeLessThan(1)
    expect(surge(-1)).toBe(0)
  })
  it('P6KE15A: idles at 12 V, clamps to its datasheet 21.2 V at 28 A', () => {
    expect(-diodeAmps(-12, P6KE15A)).toBeLessThan(10e-6)
    expect(-diodeAmps(-21.2, P6KE15A)).toBeGreaterThan(20)
    expect(-diodeAmps(-21.2, P6KE15A)).toBeLessThan(40)
    const bare = tvsNode(72, 2, 100, false)
    const clamped = tvsNode(72, 2, 100, true)
    expect(bare.v).toBeGreaterThan(60)
    expect(clamped.v).toBeLessThan(23)
    expect(clamped.tvsA).toBeGreaterThan(20)
    expect(tvsNode(12, 2, 100, true).tvsA).toBeLessThan(1e-4)
  })
})
