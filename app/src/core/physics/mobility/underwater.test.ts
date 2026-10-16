import { DEG } from '../common'
import {
  ALLOC,
  GEOMETRY,
  ROV,
  T200,
  WATERS,
  allocate,
  buoyRun,
  buoyancyN,
  capForce,
  gaugeAt,
  leadForTrim,
  netKg,
  pseudoInverse,
  rightingMoment,
  rollPeriod,
  rovRun,
  rovTrim,
  thrustWrench,
  topSpeed,
  ROV_DYN,
  topYawRate,
} from './underwater'

const RUN = { rho: WATERS.fresh, seconds: 20, depth0: 0.5, roll0: 30 * DEG, tank: 1 }

describe('buoyancy and trim', () => {
  it('buoyancy is ρ·V·g and pressure grows 1 bar per ~10 m', () => {
    expect(buoyancyN(1000, 0.001)).toBeCloseTo(9.81)
    expect(gaugeAt(WATERS.salt, 10) / 1e5).toBeCloseTo(1.006, 2)
    expect(capForce(WATERS.salt, ROV.rating) / 1000).toBeCloseTo(7.9, 1)
  })
  it('the bare hull sinks; foam lifts, lead trims to near neutral', () => {
    expect(rovTrim({ foam: 0, lead: 0 }, WATERS.fresh).net).toBeLessThan(0)
    expect(netKg(rovTrim({ foam: 1, lead: 0 }, WATERS.fresh).net - rovTrim({ foam: 0, lead: 0 }, WATERS.fresh).net)).toBeCloseTo(0.7)
    const t = rovTrim({ foam: 3, lead: leadForTrim(3, WATERS.fresh) }, WATERS.fresh)
    expect(leadForTrim(3, WATERS.fresh)).toBe(5)
    expect(netKg(t.net)).toBeGreaterThanOrEqual(0)
    expect(netKg(t.net)).toBeLessThan(0.05)
  })
  it('salt water lifts more, so it needs more lead', () => {
    const trim = { foam: 3, lead: 5 }
    expect(rovTrim(trim, WATERS.salt).net).toBeGreaterThan(rovTrim(trim, WATERS.fresh).net + 2)
    expect(leadForTrim(3, WATERS.salt)).toBeGreaterThan(leadForTrim(3, WATERS.fresh))
  })
  it('foam on top and lead below put B above G and right it; swapped, it capsizes', () => {
    const up = rovTrim({ foam: 3, lead: 5 }, WATERS.fresh)
    const low = rovTrim({ foam: 3, lead: 5, foamLow: true }, WATERS.fresh)
    expect(up.bg).toBeGreaterThan(0.03)
    expect(low.bg).toBeLessThan(0)
    expect(rightingMoment(up, 20 * DEG)).toBeGreaterThan(0)
    expect(rollPeriod(up)).toBeGreaterThan(1)
    expect(rollPeriod(up)).toBeLessThan(3)
    expect(rollPeriod(low)).toBe(Infinity)
    const right = buoyRun({ ...RUN, trim: { foam: 3, lead: 5 } })
    expect(Math.abs(right[right.length - 1].roll)).toBeLessThan(1 * DEG)
    const flip = buoyRun({ ...RUN, trim: { foam: 3, lead: 5, foamLow: true } })
    expect(Math.abs(flip[flip.length - 1].roll)).toBeCloseTo(Math.PI, 1)
  })
  it('heave: positive floats up, negative rests on the floor, neutral stays put', () => {
    const end = (lead: number) => buoyRun({ ...RUN, trim: { foam: 3, lead } }).at(-1)!
    expect(end(0).floating).toBe(true)
    expect(end(10).grounded).toBe(true)
    const drift = (lead: number) => RUN.depth0 - buoyRun({ ...RUN, seconds: 5, trim: { foam: 3, lead } }).at(-1)!.depth
    expect(drift(5)).toBeGreaterThan(0)
    expect(drift(5)).toBeLessThan(drift(4) / 2)
  })
})

describe('thruster allocation', () => {
  it('allocation inverts the geometry: B·B⁺ = I', () => {
    const p = pseudoInverse(GEOMETRY)
    GEOMETRY.forEach((row, i) => row.forEach((_, j) => {
      if (j >= 4) return
      const v = row.reduce((a, b, k) => a + b * p[k][j], 0)
      expect(v).toBeCloseTo(i === j ? 1 : 0)
    }))
    expect(ALLOC.map((r) => r.map((v) => Math.abs(v)))).toEqual([[1, 1, 0, 1], [1, 1, 0, 1], [1, 1, 0, 1], [1, 1, 0, 1], [0, 0, 1, 0], [0, 0, 1, 0]])
  })
  it('each stick makes only its own force', () => {
    const fx = (w: Partial<Parameters<typeof allocate>[0]>) => thrustWrench(allocate({ surge: 0, sway: 0, heave: 0, yaw: 0, ...w }, true).force)
    const y = fx({ yaw: 0.5 })
    expect(y.yaw).toBeGreaterThan(0)
    expect(Math.abs(y.surge) + Math.abs(y.sway)).toBeLessThan(1e-9)
    const s = fx({ sway: 0.5 })
    expect(s.sway).toBeGreaterThan(0)
    expect(Math.abs(s.surge) + Math.abs(s.yaw)).toBeLessThan(1e-9)
    expect(fx({ heave: 1 }).heave).toBeCloseTo(2 * T200.fwd)
  })
  it('reverse thrust is weaker: uncompensated sway creeps forward', () => {
    const raw = thrustWrench(allocate({ surge: 0, sway: 1, heave: 0, yaw: 0 }).force)
    expect(raw.surge).toBeCloseTo(2 * Math.SQRT1_2 * (T200.fwd - T200.rev))
    const fwd = thrustWrench(allocate({ surge: 1, sway: 0, heave: 0, yaw: 0 }).force).surge
    const rev = thrustWrench(allocate({ surge: -1, sway: 0, heave: 0, yaw: 0 }).force).surge
    expect(-rev / fwd).toBeCloseTo(T200.rev / T200.fwd)
  })
  it('saturation scales every command down together', () => {
    const a = allocate({ surge: 1, sway: 0, heave: 0, yaw: 1 })
    expect(a.saturated).toBe(true)
    expect(Math.max(...a.cmd.map(Math.abs))).toBeCloseTo(1)
    expect(a.scale).toBeCloseTo(0.5)
  })
  it('v² drag sets the top speed: ~1.5 m/s forward, slower in reverse', () => {
    const fwd = thrustWrench(allocate({ surge: 1, sway: 0, heave: 0, yaw: 0 }).force).surge
    expect(topSpeed(fwd, ROV_DYN.cdA[0])).toBeCloseTo(1.5, 1)
    const run = rovRun({ surge: 1, sway: 0, heave: 0, yaw: 0 }, false, 20)
    expect(run.at(-1)!.u).toBeCloseTo(topSpeed(fwd, ROV_DYN.cdA[0]), 2)
    expect(rovRun({ surge: -1, sway: 0, heave: 0, yaw: 0 }, false, 20).at(-1)!.u).toBeCloseTo(-1.5 * Math.sqrt(T200.rev / T200.fwd), 1)
    expect(topSpeed(4 * fwd, ROV_DYN.cdA[0]) / topSpeed(fwd, ROV_DYN.cdA[0])).toBeCloseTo(2)
  })
  it('yaw turns it clockwise: heading grows', () => {
    const r = rovRun({ surge: 0, sway: 0, heave: 0, yaw: 0.5 }, true, 3).at(-1)!
    expect(r.heading).toBeGreaterThan(1)
    expect(Math.hypot(r.x, r.y)).toBeLessThan(1e-6)
    const m = thrustWrench(allocate({ surge: 0, sway: 0, heave: 0, yaw: 0.5 }, true).force).yaw
    expect(rovRun({ surge: 0, sway: 0, heave: 0, yaw: 0.5 }, true, 10).at(-1)!.r).toBeCloseTo(topYawRate(m), 2)
  })
})
