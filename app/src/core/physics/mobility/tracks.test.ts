import { DEG } from '../common'
import {
  SKID,
  TANK,
  TERRAINS,
  climbLimit,
  groundSpeed,
  peakThrust,
  pivotShift,
  plateSink,
  shearShare,
  skidRun,
  slipFor,
  slopeForces,
  softPull,
  steerLimit,
  tankWeight,
  tipAngle,
  trackForces,
  turnMoment,
  wheelSink,
} from './tracks'

const { concrete, sand, mud } = TERRAINS
const W = tankWeight()

describe('skid steer', () => {
  it('turning moment grows with L and with a shifted pivot', () => {
    expect(turnMoment(0.7, W, 0.2)).toBeCloseTo((0.7 * W * 0.2) / 4)
    expect(turnMoment(0.7, W, 0.3)).toBeGreaterThan(turnMoment(0.7, W, 0.2))
    expect(turnMoment(0.7, W, 0.2, 0.05)).toBeGreaterThan(turnMoment(0.7, W, 0.2))
  })
  it('outer track hits its grip limit exactly at the steerability L/B', () => {
    const B = TANK.gauge
    const f = trackForces(sand, W, steerLimit(sand) * B, B)
    expect(f.outer).toBeCloseTo(f.limit)
    expect(f.outer - f.inner).toBeCloseTo((2 * turnMoment(sand.muT, W, steerLimit(sand) * B)) / B)
    expect(steerLimit(concrete)).toBeGreaterThan(steerLimit(sand))
  })
  it('pivot shifts forward with lateral acceleration, capped at L/2', () => {
    expect(pivotShift(0, 0.7, 0.2)).toBe(0)
    expect(pivotShift(0.7 * 9.81 * 0.5, 0.7, 0.2)).toBeCloseTo(0.05)
    expect(pivotShift(100, 0.7, 0.2)).toBe(0.1)
  })
  it('Janosi slip inverts the shear curve; driving lags, braking is dragged ahead', () => {
    const i = slipFor(0.6, 0.2, 0.02)
    expect(shearShare(i, 0.2, 0.02)).toBeCloseTo(0.6, 6)
    expect(slipFor(0.9, 0.2, 0.02)).toBeGreaterThan(i)
    expect(slipFor(1, 0.2, 0.02)).toBe(1)
    expect(groundSpeed(0.2, 2, 8, 0.2, 0.02)).toBeLessThan(0.2)
    expect(groundSpeed(0.2, -2, 8, 0.2, 0.02)).toBeGreaterThan(0.2)
  })
  it('a turn draws more current than a straight and turns 180°, but a long track on sand is stuck', () => {
    const run = skidRun(concrete, 1.2, 0.2)
    const straight = run.find((f) => !f.turning)!
    const turn = run.find((f) => f.turning && f.t > 3)!
    expect(Math.max(...turn.amps)).toBeGreaterThan(1.5 * Math.max(...straight.amps))
    expect(turn.scuff).toBeGreaterThan(0)
    const back = run.find((f) => f.t > 1 && !f.turning && Math.abs(Math.abs(f.pose.th) - Math.PI) < 0.1)
    expect(back).toBeDefined()
    expect(skidRun(sand, 2, 0.2).some((f) => f.stuck)).toBe(true)
    expect(run.length).toBeGreaterThan(SKID.seconds / (SKID.dt * SKID.every))
  })
})

describe('traction', () => {
  it('thrust: μN on rigid ground, soil shear with grousers', () => {
    expect(peakThrust(concrete, 10, 0.01, true)).toBeCloseTo(9)
    expect(peakThrust(sand, 10, 0.01, true)).toBeCloseTo(2 + 10 * Math.tan(28 * DEG))
    expect(peakThrust(sand, 10, 0.01, false)).toBeCloseTo(4.5)
  })
  it('Bekker sinkage: more pressure sinks deeper; none on concrete', () => {
    expect(plateSink(sand, 2, 0.04)).toBeGreaterThan(plateSink(sand, 1, 0.04))
    expect(plateSink(concrete, 5, 0.04)).toBe(0)
    expect(wheelSink(mud, 5, 0.026, 0.065)).toBeGreaterThan(wheelSink(sand, 5, 0.026, 0.065))
  })
  it('tracks spread weight and float on mud where wheels belly out', () => {
    const t = softPull(mud, 'track', true)
    const w = softPull(mud, 'wheels', true)
    expect(t.pressureKpa).toBeLessThan(w.pressureKpa)
    expect(t.sink).toBeLessThan(w.sink)
    expect(w.stuck).toBe(true)
    expect(t.stuck).toBe(false)
    expect(t.pull).toBeGreaterThan(0)
  })
  it('slopes: traction limit and tip-over angle', () => {
    expect(tipAngle(0.2, 0.1)).toBeCloseTo(Math.PI / 4)
    const c = climbLimit(concrete, true)
    expect(slopeForces(concrete, c - 0.01, true).holds).toBe(true)
    expect(slopeForces(concrete, c + 0.01, true).holds).toBe(false)
    expect(climbLimit(sand, true)).toBeGreaterThan(climbLimit(sand, false))
  })
})
