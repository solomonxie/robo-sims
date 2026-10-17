import { medianMs } from '../../stopwatch'
import { BALL_BEARINGS, BUSHINGS, BallBearingKey, ballBearingView, ballLoads, bearingLife, bushingState, bushingView, frictionTorque, seatHoles, shaftLoads } from './bearings'

describe('ball bearings', () => {
  it('ball loads balance the radial load and peak near 4.4 × the even share', () => {
    for (const phase of [0, 0.2, 0.45]) {
      const L = ballLoads(8, 100, phase)
      const vertical = L.loads.reduce((s, q, i) => s + q * Math.cos(L.psi[i]), 0)
      expect(vertical).toBeCloseTo(100, 6)
      expect(L.loads.filter((q) => q > 0).length).toBeLessThanOrEqual(5)
      expect(L.max / L.even).toBeGreaterThan(3.5)
      expect(L.max / L.even).toBeLessThan(5.5)
    }
  })
  it('two bearings: lever balance, closer spacing loads both harder', () => {
    const wide = shaftLoads(50, 30, 15)
    expect(wide.near - wide.far).toBeCloseTo(50, 9)
    expect(wide.far).toBeCloseTo(25, 9)
    const close = shaftLoads(50, 6, 15)
    expect(close.near).toBeGreaterThan(wide.near * 2)
  })
  it('rolling friction is ~200× less than a plain hole; life falls with the cube of load', () => {
    const v = ballBearingView('b608', 50, 20, 15)
    expect(v.torque.plain / v.torque.ball).toBeGreaterThan(100)
    expect(frictionTorque(0.1, 100, 8)).toBeCloseTo(0.04, 9)
    expect(bearingLife('b608', 100, 300).mrev / bearingLife('b608', 200, 300).mrev).toBeCloseTo(8, 6)
    expect(ballBearingView('mr63', 50, 20, 15).life.s0).toBeLessThan(1)
    expect(seatHoles(22).press).toBeLessThan(22)
    for (const k of Object.keys(BALL_BEARINGS) as BallBearingKey[]) expect(BALL_BEARINGS[k].C).toBeGreaterThan(BALL_BEARINGS[k].C0)
  })
})

describe('bushings', () => {
  it('PV = F/(d·L) · π·d·n; heat = T·ω', () => {
    const s = bushingState('bronze', 64, 1000, 0.05)
    expect(s.p).toBeCloseTo(1, 9)
    expect(s.v).toBeCloseTo((Math.PI * 8 * 1000) / 60000, 9)
    expect(s.heatW).toBeCloseTo(s.torque * ((1000 * 2 * Math.PI) / 60), 9)
    expect(s.verdict).toBe('ok')
  })
  it('PLA wears then melts as speed rises; bronze copes', () => {
    expect(bushingState('pla', 20, 30, 0.1).verdict).toBe('ok')
    expect(bushingState('pla', 50, 300, 0.1).verdict).toMatch(/wears|melts/)
    expect(bushingState('pla', 50, 1500, 0.1).verdict).toBe('melts')
    expect(bushingState('bronze', 50, 1500, 0.1).tempC).toBeLessThan(BUSHINGS.bronze.maxC)
    expect(bushingState('polymer', 400, 10, 0.1).verdict).toBe('ok')
    expect(bushingState('pla', 1000, 10, 0.1).verdict).toBe('crushed')
  })
  it('clearance → wobble; ball bearing far below every bushing', () => {
    expect(bushingState('bronze', 10, 10, 0.2).play).toBeCloseTo(0.2 / 8 * 50, 9)
    const v = bushingView('polymer', 50, 200, 0.05)
    v.all.forEach((s) => expect(s.torque).toBeGreaterThan(v.ballTorque * 30))
    expect(v.limitP(0.5)).toBeCloseTo(0.8, 9)
  })
  it('recomputes fast', () => {
    expect(medianMs(() => {
      for (let i = 0; i < 100; i++) {
        ballBearingView('b608', i, 20, 15)
        ballLoads(7, i, i * 0.01)
        bushingView('pla', i, i * 10, 0.1)
      }
    })).toBeLessThan(50)
  })
})
