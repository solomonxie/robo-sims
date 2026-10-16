import { DEG } from '../common'
import { BALANCER, CART0, comOffset, kpMin, balanceLoop, cartStep, catchAccel, fallTau, fallTime, fellAt, gravityAlpha, torqueLimit } from './balance'

const TILT = { kp: 0.05, ki: 0, kd: 0.003 }
const SPEED = { kp: 5, ki: 2, kd: 0 }

describe('inverted pendulum', () => {
  it('falls faster when short: τ = √(h/g), cosh growth', () => {
    expect(fallTau(0.4)).toBeCloseTo(2 * fallTau(0.1))
    expect(fallTime(3 * DEG, 30 * DEG, 0.1)).toBeCloseTo(fallTau(0.1) * Math.acosh(10))
    expect(gravityAlpha(Math.PI / 2, 1)).toBeCloseTo(9.81)
    expect(catchAccel(Math.PI / 4)).toBeCloseTo(9.81)
  })
  it('topples with the wheels still and matches the linear fall time', () => {
    const r = balanceLoop({ tilt: { kp: 0, ki: 0, kd: 0 }, seconds: 2, start: 3 * DEG, h: 0.2 })
    expect(r.find((f) => f.tilt > 30 * DEG)!.t).toBeCloseTo(fallTime(3 * DEG, 30 * DEG, 0.2), 1)
    expect(r[r.length - 1].fallen).toBe(true)
  })
  it('back-EMF leaves no forward torque at free speed', () => {
    expect(torqueLimit(1, 0)).toBe(1)
    expect(torqueLimit(1, BALANCER.vMax)).toBeCloseTo(0)
    expect(torqueLimit(-1, BALANCER.vMax)).toBe(-1)
  })
  it('P must beat gravity; a forward battery leans the CoM forward', () => {
    expect(kpMin() * BALANCER.aMax).toBeCloseTo(9.81 * DEG)
    expect(comOffset(0.015)).toBeCloseTo(Math.atan(0.006 / 0.12))
  })
  it('wheels accelerating forward push a forward lean back', () => {
    const s = cartStep({ ...CART0, tilt: 0.05, a: 10 }, 1, 0.005)
    expect(s.rate).toBeLessThan(0)
  })
})

describe('tilt loop', () => {
  it('too little P falls, P + D balances, P without D oscillates out', () => {
    expect(fellAt(balanceLoop({ tilt: { ...TILT, kp: 0.01 }, seconds: 4, start: 3 * DEG }))).not.toBeNull()
    const ok = balanceLoop({ tilt: TILT, seconds: 4, start: 3 * DEG })
    expect(fellAt(ok)).toBeNull()
    expect(Math.abs(ok[ok.length - 1].tilt)).toBeLessThan(0.1 * DEG)
    expect(fellAt(balanceLoop({ tilt: { ...TILT, kd: 0 }, seconds: 4, start: 3 * DEG }))).not.toBeNull()
    expect(fellAt(balanceLoop({ tilt: { ...TILT, kp: 0.3 }, seconds: 6, start: 3 * DEG }))).not.toBeNull()
  })
  it('an off-centre CoM runs away; I zeroes the lean but not the run', () => {
    const offset = Math.atan(0.006 / BALANCER.h)
    const pd = balanceLoop({ tilt: TILT, seconds: 6, start: 3 * DEG, offset })
    expect(fellAt(pd)).not.toBeNull()
    const pid = balanceLoop({ tilt: { ...TILT, ki: 0.1 }, seconds: 6, start: 3 * DEG, offset })
    expect(Math.abs(pid[400].tilt)).toBeLessThan(0.05 * DEG)
    expect(pid[400].v).toBeGreaterThan(0.8)
    expect(fellAt(pid)).not.toBeNull()
  })
})

describe('cascaded loops', () => {
  const offset = 3 * DEG
  it('the speed loop finds the lean that holds the CoM over the axle and tracks a speed', () => {
    const r = balanceLoop({ tilt: TILT, speed: SPEED, seconds: 14, offset, drive: (t) => (t > 2 && t < 7 ? 0.4 : 0) })
    expect(fellAt(r)).toBeNull()
    expect(Math.abs(r[Math.round(6.5 / BALANCER.dt)].v - 0.4)).toBeLessThan(0.1)
    expect(r[r.length - 1].tilt / DEG).toBeCloseTo(-3, 0)
    expect(Math.abs(r[r.length - 1].v)).toBeLessThan(0.05)
  })
  it('recovers a push, falls once the motors saturate', () => {
    const push = (kick: number, supply = 1) => balanceLoop({ tilt: TILT, speed: SPEED, seconds: 5, offset, pushes: [{ at: 1, kick }], supply })
    expect(fellAt(push(1))).toBeNull()
    const big = push(4)
    expect(fellAt(big)).not.toBeNull()
    expect(big.some((f) => f.sat)).toBe(true)
    expect(fellAt(push(1, 0.5))).not.toBeNull()
  })
})
