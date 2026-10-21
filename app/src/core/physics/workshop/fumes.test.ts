import { EXTRACTOR, FUME_SESSION, FumeCfg, ROSIN_PER_JOINT_MG, ROSIN_WEL, captureShare, captureSpeed, fumeAt, fumeRate, fumeRun, fumeShare } from './fumes'
import { fluxBurnRate } from './soldering'

const GOOD: FumeCfg = { vent: 'near', tipC: 330, glasses: true, stand: true, wash: true }
const run = (o: Partial<FumeCfg> = {}) => fumeRun({ ...GOOD, ...o })

describe('source and capture', () => {
  it('a joint’s wire holds ~0.2 mg of rosin; hotter tips burn more of it into fume', () => {
    expect(ROSIN_PER_JOINT_MG).toBeGreaterThan(0.15)
    expect(ROSIN_PER_JOINT_MG).toBeLessThan(0.3)
    expect(fumeShare(380)).toBeGreaterThan(fumeShare(330))
    expect(fumeShare(330)).toBeGreaterThan(fumeShare(290))
    expect(fumeRate(330)).toBeCloseTo(FUME_SESSION.perMin * ROSIN_PER_JOINT_MG * fumeShare(330), 12)
    expect(fumeShare(100)).toBe(0)
    expect(fluxBurnRate(100)).toBe(0)
  })
  it('Dalla Valle: capture speed falls with distance squared; close in it captures the plume, 25 cm away hardly', () => {
    expect(captureSpeed(0)).toBeCloseTo(EXTRACTOR.m3PerMin / 60 / EXTRACTOR.faceM2, 12)
    expect(captureSpeed(0.1)).toBeCloseTo(0.025 / (0.1 + 0.017), 9)
    expect(captureShare(6)).toBe(EXTRACTOR.best)
    expect(captureShare(25)).toBeLessThan(0.2)
    expect(captureShare(0)).toBe(0)
  })
})

describe('fumeRun', () => {
  it('two-zone steady state: C_N → G/Q + G/β, C_F → G/Q', () => {
    const r = run({ vent: 'window' })
    const end = r.frames[r.frames.length - 1]
    const ss = { near: r.G / r.q + r.G / r.beta, far: r.G / r.q }
    expect(end.near).toBeLessThan(ss.near)
    expect(end.near).toBeGreaterThan(0.85 * ss.near)
    expect(end.far).toBeGreaterThan(0.85 * ss.far)
    expect(fumeAt(r, 1e9)).toBe(end)
  })
  it('extractor at 6 cm keeps the breathing zone under the EH40 STEL and passes', () => {
    const r = run()
    expect(r.peak15).toBeLessThan(ROSIN_WEL.stel)
    expect(r.verdict).toEqual({ pass: true, near: false, fail: null })
  })
  it('closed room or a far extractor: several times the STEL; an open window helps but not enough', () => {
    expect(run({ vent: 'still' }).peak15).toBeGreaterThan(5 * ROSIN_WEL.stel)
    expect(run({ vent: 'far' }).verdict).toMatchObject({ fail: 'stel', near: false })
    const w = run({ vent: 'window' })
    expect(w.peak15).toBeLessThan(run({ vent: 'still' }).peak15 / 2)
    expect(w.verdict.fail).toBe('stel')
  })
  it('habits in order: glasses, stand, hands; hot tip is a close miss', () => {
    expect(run({ glasses: false, stand: false }).verdict.fail).toBe('eyes')
    expect(run({ stand: false }).verdict.fail).toBe('stand')
    expect(run({ wash: false }).verdict.fail).toBe('hands')
    expect(run({ tipC: 365, vent: 'near' }).verdict).toMatchObject({ near: true })
    expect(run().clipped).toBe(FUME_SESSION.perMin * FUME_SESSION.minutes)
    expect(run().pvcMelts).toBe(true)
  })
})
