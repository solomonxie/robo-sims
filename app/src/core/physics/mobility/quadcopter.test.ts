import { DEG } from '../common'
import { MIX, QUAD, QUAD0, attitudeLoop, hoverThrottle, mix, propRpm, quadBodyStep, quadWrench, rollWobble, levelTime, speedShare, thrustOf, thrustToWeight } from './quadcopter'
import { weightN } from '../actuators/linear'

const RATE = { kp: 0.002, ki: 0, kd: 0 }
const GUST = { at: 1, dur: 0.18, torque: 0.5 }
const thrusts = (d: Parameters<typeof mix>[0]) => mix(d).out.map((s) => thrustOf(s))

describe('quadcopter mixer', () => {
  it('throttle alone gives four equal thrusts and no torque', () => {
    const w = quadWrench(thrusts({ throttle: 0.5, roll: 0, pitch: 0, yaw: 0 }))
    expect(w.thrust).toBeCloseTo(2 * QUAD.tMax)
    expect([w.roll, w.pitch, w.yaw].map((v) => Math.abs(v) < 1e-12)).toEqual([true, true, true])
  })
  it('each stick makes only its own torque, with the right sign', () => {
    const r = quadWrench(thrusts({ throttle: 0.5, roll: 0.1, pitch: 0, yaw: 0 }))
    const p = quadWrench(thrusts({ throttle: 0.5, roll: 0, pitch: 0.1, yaw: 0 }))
    const y = quadWrench(thrusts({ throttle: 0.5, roll: 0, pitch: 0, yaw: 0.1 }))
    expect(r.roll).toBeCloseTo(4 * 0.1 * QUAD.tMax * (QUAD.arm / Math.SQRT2))
    expect([r.pitch, r.yaw, p.roll, p.yaw, y.roll, y.pitch].every((v) => Math.abs(v) < 1e-12)).toBe(true)
    expect(p.pitch).toBeGreaterThan(0)
    expect(y.yaw).toBeCloseTo(4 * 0.1 * QUAD.tMax * QUAD.kM)
    expect(r.thrust).toBeCloseTo(2 * QUAD.tMax)
  })
  it('yaw speeds up the counter-clockwise pair, columns sum to zero', () => {
    expect(mix({ throttle: 0.5, roll: 0, pitch: 0, yaw: 0.1 }).out).toEqual([0.4, 0.6, 0.6, 0.4])
    for (const k of [1, 2, 3]) expect(MIX.reduce((s, row) => s + row[k], 0)).toBe(0)
  })
  it('clips motors at 0 and 1', () => {
    const m = mix({ throttle: 0.95, roll: 0.2, pitch: 0, yaw: 0 })
    expect(m.out).toEqual([0.75, 0.75, 1, 1])
    expect(m.clipped).toEqual([false, false, true, true])
  })
  it('airmode shifts the collective and keeps the differential', () => {
    const d = { throttle: 0.1, roll: 0.2, pitch: 0, yaw: 0 }
    const a = mix(d, true)
    expect(a.shift).toBeCloseTo(0.1)
    expect(a.clipped.some(Boolean)).toBe(false)
    expect(quadWrench(a.out.map((s) => thrustOf(s))).roll).toBeCloseTo(4 * 0.2 * QUAD.tMax * (QUAD.arm / Math.SQRT2))
    expect(quadWrench(thrusts(d)).roll).toBeLessThan(quadWrench(a.out.map((s) => thrustOf(s))).roll)
    expect(mix({ throttle: 0.95, roll: 0.2, pitch: 0, yaw: 0 }, true).out.map((v) => +v.toFixed(6))).toEqual([0.6, 0.6, 1, 1])
    expect(mix({ throttle: 0.5, roll: 0.6, pitch: 0, yaw: 0 }, true).out).toEqual([0, 0, 1, 1])
  })
  it('thrust ∝ ω²: hover and thrust-to-weight', () => {
    expect(speedShare(0.25)).toBeCloseTo(0.5)
    expect(propRpm(1)).toBeCloseTo((QUAD.wMax * 60) / (2 * Math.PI))
    expect(4 * thrustOf(hoverThrottle(QUAD.mass))).toBeCloseTo(weightN(QUAD.mass))
    expect(thrustToWeight(QUAD.mass) * hoverThrottle(QUAD.mass)).toBeCloseTo(1)
  })
})

describe('quad rigid body', () => {
  it('hovers at hover throttle, climbs above it', () => {
    const run = (share: number) => {
      let s = { ...QUAD0, w: Array(4).fill(share) }
      for (let i = 0; i < 500; i++) s = quadBodyStep(s, [share, share, share, share], QUAD.dt)
      return s
    }
    expect(Math.abs(run(hoverThrottle(QUAD.mass)).z)).toBeLessThan(1e-9)
    expect(run(0.4).z).toBeGreaterThan(0.5)
  })
  it('a roll split rolls it right and drifts it right', () => {
    let s = { ...QUAD0, w: Array(4).fill(0.3) }
    const cmds = mix({ throttle: 0.3, roll: 0.02, pitch: 0, yaw: 0 }).out
    for (let i = 0; i < 100; i++) s = quadBodyStep(s, cmds, QUAD.dt)
    expect(s.roll).toBeGreaterThan(0)
    expect(s.vy).toBeGreaterThan(0)
  })
})

describe('attitude loops', () => {
  it('angle mode rides out a gust and comes back level', () => {
    const r = attitudeLoop({ mode: 'angle', angleP: 8, rate: RATE, seconds: 4, gust: GUST })
    expect(Math.max(...r.map((f) => f.roll))).toBeGreaterThan(5 * DEG)
    expect(Math.abs(r[r.length - 1].roll)).toBeLessThan(0.5 * DEG)
    expect(levelTime(r, GUST.at)).not.toBeNull()
  })
  it('acro stops the rotation but keeps the tilt', () => {
    const r = attitudeLoop({ mode: 'acro', angleP: 8, rate: RATE, seconds: 4, gust: GUST })
    const end = r[r.length - 1]
    expect(end.roll).toBeGreaterThan(5 * DEG)
    expect(Math.abs(end.rate)).toBeLessThan(1 * DEG)
    expect(end.y).toBeGreaterThan(2)
  })
  it('too much rate P oscillates', () => {
    expect(rollWobble(attitudeLoop({ mode: 'angle', angleP: 8, rate: { kp: 0.005, ki: 0, kd: 0 }, seconds: 4, gust: GUST }))).toBeGreaterThan(1 * DEG)
  })
  it('a heavy payload clips the motors and tilts further', () => {
    const peak = (mass: number) => Math.max(...attitudeLoop({ mode: 'angle', angleP: 8, rate: RATE, seconds: 3, gust: GUST, mass }).map((f) => f.roll))
    const heavy = attitudeLoop({ mode: 'angle', angleP: 8, rate: RATE, seconds: 3, gust: GUST, mass: 2.6 })
    expect(heavy.some((f) => f.clipped)).toBe(true)
    expect(peak(2.6)).toBeGreaterThan(peak(1.8))
  })
  it('airmode stops a light quad clipping in a gust, at the cost of a climb', () => {
    const run = (airmode: boolean) => attitudeLoop({ mode: 'angle', angleP: 8, rate: RATE, seconds: 4, gust: GUST, airmode })
    const [off, on] = [run(false), run(true)]
    const peak = (r: typeof off) => Math.max(...r.map((f) => f.roll))
    expect(off.some((f) => f.clipped)).toBe(true)
    expect(on.some((f) => f.clipped)).toBe(false)
    expect(peak(on)).toBeLessThan(peak(off))
    expect(on[on.length - 1].z).toBeGreaterThan(off[off.length - 1].z)
  })
})
