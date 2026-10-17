import { G } from '../common'
import { ARM_SERVOS } from '../kinematics/armbuild'
import { BOOM, balanceRadius, boomTorques, hornSag, leverForces, leverLayout, leverTravel, reachLimit, torqueOf } from './torque'

describe('moment arm', () => {
  test('τ = F·r·sin θ; only the perpendicular part turns', () => {
    const t = torqueOf(2, 0.05, Math.PI / 2)
    expect(t.tau).toBeCloseTo(0.1)
    expect(t.d).toBeCloseTo(0.05)
    expect(torqueOf(2, 0.05, Math.PI / 6).tau).toBeCloseTo(0.05)
    expect(torqueOf(2, 0.05, 0).tau).toBeCloseTo(0)
    const s = torqueOf(3, 0.04, 0.7)
    expect(Math.hypot(s.fPerp, s.fPar)).toBeCloseTo(3)
    expect(s.tau).toBeCloseTo(s.fPerp * 0.04)
  })

  test('an SG90 holds 2 N out to 9 cm; past stall it gets back-driven', () => {
    const sg = ARM_SERVOS.sg90
    expect(reachLimit(sg.stallNm, 2, Math.PI / 2)).toBeCloseTo(0.09)
    expect(reachLimit(sg.stallNm, 2, 0)).toBe(Infinity)
    const ok = hornSag(0.09, sg)
    expect(ok.share).toBeCloseTo(0.5)
    expect(ok.slips).toBe(false)
    expect(ok.sagRad).toBeCloseTo((5 * Math.PI) / 180)
    expect(hornSag(0.3, sg).slips).toBe(true)
  })
})

describe('levers', () => {
  test('class layouts, MA = effort arm / load arm, work in = work out', () => {
    const one = leverLayout('first', 0.25, 0.3)
    expect(one.loadArm).toBeCloseTo(0.075)
    expect(one.effortArm).toBeCloseTo(0.225)
    expect(one.ma).toBeCloseTo(3)
    const f = leverForces(one, 6)
    expect(f.effort).toBeCloseTo(2)
    expect(f.fulcrum).toBeCloseTo(8)
    const tr = leverTravel(one, 0.2)
    expect(f.effort * tr.effort).toBeCloseTo(6 * tr.load)
    expect(leverLayout('second', 0.5, 0.3).ma).toBeCloseTo(2)
    const three = leverLayout('third', 0.25, 0.3)
    expect(three.ma).toBeCloseTo(0.25)
    expect(leverForces(three, 2).fulcrum).toBeCloseTo(2 - 8)
    expect(leverTravel(three, 0.1).load).toBeCloseTo(4 * leverTravel(three, 0.1).effort)
  })
})

describe('static balance', () => {
  test('counterweight at the balance radius zeroes the servo torque at any angle', () => {
    const load = { payloadKg: 0.2, counterKg: 0.4, counterM: 0 }
    const r = balanceRadius(load)
    expect(r).toBeCloseTo((0.2 * BOOM.lenM + BOOM.linkKg * BOOM.linkM) / 0.4)
    for (const a of [-0.5, 0, 0.8]) expect(boomTorques({ ...load, counterM: r }, a).net).toBeCloseTo(0)
    const bare = boomTorques(load, 0)
    expect(bare.servo).toBeCloseTo(-(0.2 * 0.2 + 0.006) * G)
    expect(bare.pivotN).toBeCloseTo(0.66 * G)
    expect(boomTorques(load, Math.PI / 2).net).toBeCloseTo(0)
    expect(balanceRadius({ payloadKg: 0.1, counterKg: 0 })).toBe(Infinity)
  })
})
