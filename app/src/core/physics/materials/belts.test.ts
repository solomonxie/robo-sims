import { medianMs } from '../../stopwatch'
import { BELT_MOTOR, COUPLERS, CouplerKey, GT2, JUMP_K, beltDrive, beltLengthMm, couplerForceN, couplerView, equivOffsetMm, gripNm, pitchRadiusMm, shaftChainK, teethInMesh, wrapRad } from './belts'

describe('timing belt', () => {
  it('ratio = teeth ratio; belt speed = ω·r; output torque × ratio', () => {
    const d = beltDrive(20, 60, 80, 20, 0.2)
    expect(d.ratio).toBeCloseTo(3, 9)
    expect(d.outRpm).toBeCloseTo(BELT_MOTOR.rpm / 3, 9)
    expect(pitchRadiusMm(20)).toBeCloseTo(40 / (2 * Math.PI), 9)
    expect(d.beltMps).toBeCloseTo((BELT_MOTOR.rpm / 60) * 20 * GT2.pitch / 1000, 9)
    expect(d.outNm).toBeCloseTo(0.2 * 3 * 0.98, 9)
    expect(d.verdict).toBe('ok')
  })
  it('belt length and wrap: equal pulleys → 2C + π·D, half wrap', () => {
    const r = pitchRadiusMm(20)
    expect(beltLengthMm(r, r, 100)).toBeCloseTo(200 + 2 * Math.PI * r, 6)
    expect(wrapRad(r, r, 100)).toBeCloseTo(Math.PI, 9)
    expect(teethInMesh(20, Math.PI)).toBe(10)
    expect(beltDrive(20, 80, 40, 20, 0.1).mesh).toBeLessThan(beltDrive(20, 80, 150, 20, 0.1).mesh)
  })
  it('too loose skips; tension raises the limit; too tight overloads the motor bearing', () => {
    expect(beltDrive(20, 60, 80, 5, 0.2).verdict).toBe('skips')
    const d = beltDrive(20, 60, 80, 20, 0.2)
    expect(d.tight - d.slack).toBeCloseTo(d.pull, 9)
    expect(d.jumpNmAt(10)).toBeCloseTo((JUMP_K * 10 * d.r1) / 1000, 9)
    expect(d.jumpNmAt(1000)).toBeCloseTo((d.mesh * GT2.toothN * d.r1) / 1000, 9)
    expect(beltDrive(20, 60, 80, 80, 0.1).verdict).toBe('tight')
    expect(beltDrive(20, 60, 80, 14, 0.2).verdict).toBe('slack')
    expect(beltDrive(16, 80, 30, 40, 0.05).verdict).toBe('few teeth')
  })
  it('stretch grows with pull and span; pluck pitch with √T', () => {
    const a = beltDrive(20, 60, 80, 20, 0.2)
    expect(beltDrive(20, 60, 160, 20, 0.2).stretchMm).toBeGreaterThan(a.stretchMm * 1.9)
    expect(beltDrive(20, 60, 80, 80, 0.2).pluck / a.pluck).toBeCloseTo(2, 9)
  })
})

describe('shaft couplers', () => {
  it('rigid: side force set by the shafts and mount; flexible couplers far softer', () => {
    expect(couplerForceN('rigid', 0.1, 0)).toBeCloseTo(shaftChainK() * 0.1, 9)
    expect(couplerForceN('rigid', 0.1, 0)).toBeGreaterThan(BELT_MOTOR.radialN)
    expect(couplerForceN('helical', 0.1, 0)).toBeLessThan(COUPLERS.helical.kRad * 0.1)
    expect(couplerForceN('helical', 0.1, 0)).toBeLessThan(couplerForceN('jaw', 0.1, 0))
    const sh = couplerView('rigid', 0.1, 0, 'clamp', 0.1).shares
    expect(sh.coupler).toBe(0)
    expect(sh.motor + sh.screw + sh.mount).toBeCloseTo(1, 9)
    expect(couplerView('helical', 0.1, 0, 'clamp', 0.1).shares.coupler).toBeGreaterThan(0.9)
    expect(equivOffsetMm(0, 1)).toBeCloseTo((Math.PI / 180) * 12.5, 9)
  })
  it('set screw on round slips first; D-flat and clamp hold more', () => {
    expect(gripNm('dflat')).toBeGreaterThan(gripNm('round') * 3)
    expect(gripNm('clamp')).toBeGreaterThan(gripNm('round'))
    expect(couplerView('helical', 0.05, 0, 'round', 0.45).verdict).toBe('slips')
    expect(couplerView('helical', 0.05, 0, 'dflat', 0.45).verdict).toBe('ok')
    expect(couplerView('rigid', 0.1, 0, 'dflat', 0.3).verdict).toBe('bearing')
    expect(couplerView('jaw', 0.2, 0, 'dflat', 0.3).verdict).toBe('over rated')
    expect(couplerView('helical', 0.05, 0, 'clamp', 1.2).verdict).toMatch(/slips|overload/)
    for (const k of Object.keys(COUPLERS) as CouplerKey[]) expect(couplerView(k, 0.1, 0.5, 'clamp', 0.3).curves.length).toBe(3)
  })
  it('recomputes fast', () => {
    expect(medianMs(() => {
      for (let i = 0; i < 100; i++) {
        beltDrive(20, 20 + i, 80, 5 + i, 0.2)
        const v = couplerView('jaw', i / 200, 0.5, 'round', 0.3)
        for (let j = 0; j < 60; j++) v.curves.forEach((f) => f(j / 120))
      }
    })).toBeLessThan(100)
  })
})
