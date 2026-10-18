import { DEG } from '../common'
import { legFK } from '../mobility/legged'
import { medianMs } from '../../stopwatch'
import { KNEE_FOLD, QUAD_KIT, QUAD_LINKS, quadGaitRun, quadGeometry, quadLoads, quadReach, quadServoDeg, quadShift, quadStance, QUAD_GAITS } from './quadkit'

describe('leg geometry', () => {
  it('servo horns centred: femur straight down, knee bent 90°', () => {
    const [h, k] = quadServoDeg(-90 * DEG, 90 * DEG)
    expect(h).toBeCloseTo(90)
    expect(k).toBeCloseTo(90)
  })
  it('knees back, and IK lands the foot on the target', () => {
    const s = quadStance(0.02, -0.07)
    expect(s.fits).toBe(true)
    expect(s.knee).toBeGreaterThan(0)
    const f = legFK(s.hip, s.knee, QUAD_LINKS.kit.femur, QUAD_LINKS.kit.tibia)
    expect(f.foot[0]).toBeCloseTo(0.02, 6)
    expect(f.foot[1]).toBeCloseTo(-0.07, 6)
    expect(f.knee[0]).toBeLessThan(0)
  })
  it('too tall straightens the knee past its stop; too low folds it', () => {
    expect(quadStance(0, -0.1095).fits).toBe(false)
    expect(quadStance(0, -0.02).knee).toBeGreaterThan(KNEE_FOLD[1])
    expect(quadReach(0.12)).toBeNull()
  })
  it('stride: tall = reach ring, crouched = hip servo runs out of travel behind', () => {
    const tall = quadReach(0.1)!
    expect(tall[0]).toBeCloseTo(-tall[1], 3)
    const low = quadReach(0.055)!
    expect(-low[0]).toBeLessThan(0.03)
    expect(quadStance(low[0] - 0.002, -0.055).hipDeg).toBeLessThan(0)
    expect(quadGeometry(0.07, 0.04, 4).maxStride).toBeGreaterThan(quadGeometry(0.1, 0.04, 4).maxStride)
  })
  it('knee load: F = m·g / feet, times the knee lever; trot doubles it', () => {
    const l = quadLoads(0, 0.07, 4)
    expect(l.F).toBeCloseTo((QUAD_KIT.massKg * 9.81) / 4, 2)
    expect(l.hipNm).toBe(0)
    expect(l.kneeNm).toBeCloseTo(l.F * Math.abs(l.kneeX), 9)
    const stand = quadGeometry(0.07, 0.04, 4)
    const trot = quadGeometry(0.07, 0.04, 2)
    expect(trot.share).toBeCloseTo(2 * stand.share, 6)
    expect(stand.verdict).toBe('ok')
    expect(trot.verdict).toBe('thin')
    expect(quadGeometry(0.1, 0.04, 2).share).toBeLessThan(trot.share)
    expect(quadGeometry(0.07, 0.04, 2, 'long').share).toBeGreaterThan(trot.share)
    expect(quadGeometry(0.07, 0.3, 2).fits).toBe(false)
  })
})

describe('gait generator', () => {
  it('slow trot: full stride, two feet down, no static margin', () => {
    const r = quadGaitRun('trot', 0.05, 1.2)
    expect(r.stride).toBeGreaterThan(0.047)
    expect(r.speed).toBeCloseTo(r.planned, 2)
    expect(r.minDown).toBe(2)
    expect(r.margin).toBeLessThan(0)
    expect(r.lift).toBeGreaterThan(0.018)
    expect(r.frames.length).toBe(61)
  })
  it('fast cycles: loaded servos fall behind, stride and lift shrink', () => {
    const slow = quadGaitRun('trot', 0.05, 1.2)
    const fast = quadGaitRun('trot', 0.05, 0.3)
    expect(fast.stride).toBeLessThan(slow.stride - 0.004)
    expect(fast.lagMax).toBeGreaterThan(3 * slow.lagMax)
    const creep = quadGaitRun('creep', 0.05, 0.3)
    expect(creep.lift).toBeLessThan(0.01)
    expect(creep.speed).toBeLessThan(0.6 * creep.planned)
  })
  it('creep: three feet down; only the fore-aft shift moves the CoM off the diagonal', () => {
    expect(quadShift(QUAD_GAITS.creep.gait, 0.1)).toBe(0)
    expect(Math.abs(quadShift(QUAD_GAITS.shift.gait, 0.1))).toBeGreaterThan(0.01)
    const still = quadGaitRun('creep', 0.05, 1.2)
    const shift = quadGaitRun('shift', 0.05, 1.2)
    expect(still.minDown).toBe(3)
    expect(still.margin).toBeLessThan(0.003)
    expect(shift.margin).toBeGreaterThan(0.01)
    expect(quadGaitRun('shift', 0.05, 0.3).margin).toBeLessThan(0.003)
  })
  it('fast enough for time-lapse rebuilds', () => {
    expect(medianMs(() => quadGaitRun('shift', 0.06, 2), 3)).toBeLessThan(150)
    expect(medianMs(() => quadGeometry(0.06, 0.05, 2, 'long'), 3)).toBeLessThan(50)
  })
})
