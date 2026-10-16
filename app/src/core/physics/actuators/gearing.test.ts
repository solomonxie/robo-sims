import { DEG } from '../common'
import {
  backlashStep,
  backlashTrace,
  centerDistanceMm,
  circularPitchMm,
  deadZoneMotorDeg,
  meshCount,
  meshTurn,
  pitchDiameterMm,
  pitchLineMmS,
  planetTeeth,
  planetTurn,
  planetaryRatio,
  planetaryTurns,
  planetsFit,
  preloadDragNm,
  ringTeeth,
  ringTurn,
  splitGearGap,
  swingPeakNm,
  tipErrorMm,
  toothPhase,
  trainEfficiency,
  trainRatio,
  trainSpeeds,
  wormBackEfficiency,
  wormEfficiency,
  wormFrictionAngle,
  wormInputNm,
  wormLeadAngle,
  wormRatio,
  wormSelfLocking,
} from './gearing'

describe('spur trains', () => {
  it('module sets size, not ratio', () => {
    expect(pitchDiameterMm(1, 40)).toBe(40)
    expect(centerDistanceMm(1.5, 10, 40)).toBe(37.5)
    expect(circularPitchMm(1)).toBeCloseTo(Math.PI)
    expect(pitchLineMmS(1, 10, 600)).toBeCloseTo(pitchLineMmS(1, 40, 150))
  })
  it('a pair reverses and divides by the tooth ratio', () => {
    expect(trainRatio([{ teeth: 10 }, { teeth: 40 }])).toBe(-4)
  })
  it('an idler reverses back without changing the ratio', () => {
    const g = [{ teeth: 10 }, { teeth: 17 }, { teeth: 40 }]
    expect(trainRatio(g)).toBeCloseTo(4)
    expect(meshCount(g)).toBe(2)
    expect(trainEfficiency(g, 0.9)).toBeCloseTo(0.81)
  })
  it('compound stages multiply', () => {
    const g = [{ teeth: 10 }, { teeth: 40 }, { teeth: 10, shaft: true }, { teeth: 30 }]
    expect(trainSpeeds(g)[2]).toBeCloseTo(-0.25)
    expect(trainRatio(g)).toBeCloseTo(12)
    expect(meshCount(g)).toBe(2)
  })
  it('meshTurn keeps a tooth in a gap and rolls at the tooth ratio', () => {
    for (const [zA, zB, alpha, th] of [[10, 40, 0, 0.3], [12, 25, 1.1, -2], [17, 9, -0.4, 5]]) {
      const thB = meshTurn(th, zA, zB, alpha)
      const sum = toothPhase(alpha, th, zA) + toothPhase(alpha + Math.PI, thB, zB)
      expect(Math.abs(Math.round(sum - 0.5) - (sum - 0.5))).toBeCloseTo(0, 6)
      expect(meshTurn(th + 1, zA, zB, alpha) - thB).toBeCloseTo(-zA / zB)
    }
  })
  it('ringTurn puts a planet tooth in a ring gap, same direction', () => {
    const [zP, zR, alpha, th] = [12, 48, 0.7, 1.3]
    const thR = ringTurn(th, zP, zR, alpha)
    const d = toothPhase(alpha, th, zP) - toothPhase(alpha, thR, zR) - 0.5
    expect(Math.abs(Math.round(d) - d)).toBeCloseTo(0, 6)
    expect(ringTurn(th + 1, zP, zR, alpha) - thR).toBeCloseTo(zP / zR)
  })
})

describe('backlash', () => {
  it('output waits for the gap on reversal', () => {
    expect(backlashStep(0, 1, 4)).toBe(0)
    expect(backlashStep(0, 3, 4)).toBe(1)
    expect(backlashStep(0, 3, 0)).toBe(3)
    const out = backlashTrace([0, 5, 10, 8, 6, 4], 4)
    expect(out).toEqual([0, 3, 8, 8, 8, 6])
  })
  it('error grows with gear ratio at the motor and arm length at the tip', () => {
    expect(deadZoneMotorDeg(1, 300)).toBe(300)
    expect(tipErrorMm(250, 2)).toBeCloseTo(8.73, 2)
  })
  it('split gear holds until the load out-pulls its spring', () => {
    expect(splitGearGap(3, 0.2, 0.1)).toBe(0)
    expect(splitGearGap(3, 0.2, -0.3)).toBe(3)
    expect(preloadDragNm(0.2)).toBeCloseTo(0.04)
    expect(swingPeakNm(1, 0.25, 30, 2)).toBeCloseTo(0.0625 * 30 * DEG * Math.PI ** 2)
  })
})

describe('planetary', () => {
  it('ring held: 1 + R/S; carrier held reverses; sun held barely reduces', () => {
    expect(ringTeeth(12, 24)).toBe(60)
    expect(planetTeeth(12, 60)).toBe(24)
    expect(planetaryRatio(12, 60, 'ring')).toBe(6)
    expect(planetaryRatio(12, 60, 'carrier')).toBe(-5)
    expect(planetaryRatio(12, 60, 'sun')).toBeCloseTo(1.2)
    expect(planetsFit(12, 60, 3)).toBe(true)
    expect(planetsFit(13, 61, 3)).toBe(false)
  })
  it('every held case obeys Willis', () => {
    for (const held of ['ring', 'carrier', 'sun'] as const) {
      const t = planetaryTurns(18, 54, held, 2)
      expect(t.sun - t.carrier).toBeCloseTo((-54 / 18) * (t.ring - t.carrier))
      expect(t[held]).toBe(0)
    }
  })
  it('planets spin backward on their pins when the carrier is held', () => {
    expect(planetTurn(12, 24, 1, 0)).toBeCloseTo(-0.5)
    expect(planetTurn(12, 24, 1, 1)).toBeCloseTo(1)
  })
})

describe('worm drive', () => {
  it('ratio = wheel teeth / starts', () => {
    expect(wormRatio(40, 1)).toBe(40)
    expect(wormRatio(40, 2)).toBe(20)
  })
  it('single start locks, more starts back-drive and run more efficiently', () => {
    const fric = wormFrictionAngle()
    expect(fric / DEG).toBeCloseTo(6.07, 1)
    const l1 = wormLeadAngle(1)
    const l4 = wormLeadAngle(4)
    expect(wormSelfLocking(l1)).toBe(true)
    expect(wormSelfLocking(wormLeadAngle(2))).toBe(false)
    expect(wormBackEfficiency(l1)).toBe(0)
    expect(wormBackEfficiency(l4)).toBeGreaterThan(0.4)
    expect(wormEfficiency(l1)).toBeCloseTo(0.435, 2)
    expect(wormEfficiency(l4)).toBeGreaterThan(wormEfficiency(l1))
  })
  it('a self-locking worm is under 50 % efficient', () => {
    const fric = wormFrictionAngle()
    expect(wormEfficiency(fric, fric)).toBeLessThan(0.5)
  })
  it('input torque = wheel torque / (N·η)', () => {
    expect(wormInputNm(1, 40, 0.5)).toBeCloseTo(0.05)
  })
})
