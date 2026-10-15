import { Vec3 } from '../../fields'
import {
  GPS_SKY,
  L1_LAMBDA,
  canyonPath,
  carrierCycles,
  dop,
  fixKind,
  flightTime,
  parkedFixes,
  pseudoranges,
  radiusQuantile,
  ratioTest,
  rtkEpochs,
  skyPos,
  solveFix,
  uere,
  wander,
} from './gps'
import { LIGHT_C } from '../common'

const sats = (n: number) => GPS_SKY.slice(0, n).map((s) => skyPos(s.az, s.el))
const len = (v: Vec3) => Math.hypot(...v)

describe('GPS', () => {
  it('satellites are 20 200 km up overhead, farther near the horizon; signals take ~67–86 ms', () => {
    expect(skyPos(0, 90)[2]).toBeCloseTo(20_189e3, -3)
    expect(len(skyPos(0, 10))).toBeGreaterThan(24_000e3)
    expect(flightTime(skyPos(0, 90)) * 1e3).toBeCloseTo(67.3, 1)
  })

  it('four pseudoranges solve position and clock bias exactly', () => {
    const rx: Vec3 = [120, -45, 30]
    const r = solveFix(sats(4), pseudoranges(sats(4), rx, 1e-3))
    expect(r.ok).toBe(true)
    r.pos.forEach((c, i) => expect(c).toBeCloseTo(rx[i], 3))
    expect(r.bias / LIGHT_C).toBeCloseTo(1e-3, 9)
  })

  it('three satellites assuming a perfect clock: 1 µs (300 m of range) puts the fix hundreds of metres off', () => {
    const r = solveFix(sats(3), pseudoranges(sats(3), [0, 0, 0], 1e-6), { bias: 0 })
    expect(len(r.pos)).toBeGreaterThan(300)
    expect(r.rms).toBeLessThan(1e-3)
  })

  it('a 2D fix holds the altitude and solves east, north and the clock from three satellites', () => {
    const r = solveFix(sats(3), pseudoranges(sats(3), [8, -3, 0], 2e-6), { up: 0 })
    expect(r.pos[0]).toBeCloseTo(8, 3)
    expect(r.pos[1]).toBeCloseTo(-3, 3)
    expect(fixKind(3)).toBe('2D')
    expect(fixKind(2)).toBe('none')
    expect(fixKind(7)).toBe('3D')
  })

  it('least squares with more satellites spreads noise: residual rms > 0, error bounded', () => {
    const s = sats(8)
    const r = solveFix(s, pseudoranges(s, [0, 0, 0], 0, [3, -2, 1, 0, -1, 2, -3, 1]))
    expect(r.rms).toBeGreaterThan(0.1)
    expect(len(r.pos)).toBeLessThan(15)
  })

  it('DOP: more and spread-out satellites give lower DOP; bunched ones blow it up', () => {
    expect(dop(sats(3)).p).toBe(Infinity)
    const d4 = dop(sats(4))
    const d8 = dop(sats(8))
    expect(d8.p).toBeLessThan(d4.p)
    expect(d8.h).toBeLessThan(d8.v)
    expect(d8.g ** 2).toBeCloseTo(d8.p ** 2 + d8.t ** 2, 9)
    const bunch = [skyPos(0, 60), skyPos(10, 65), skyPos(355, 70), skyPos(5, 55)]
    expect(dop(bunch).p).toBeGreaterThan(5 * d4.p)
  })

  it('urban canyon: high satellites direct, low across-street ones reflected (late) or blocked; along the street clear', () => {
    expect(canyonPath(90, 80, 20, 40).path).toBe('direct')
    const r = canyonPath(90, 60, 20, 40)
    expect(r.path).toBe('reflected')
    expect(r.extraM).toBeCloseTo(20 * Math.cos(60 * (Math.PI / 180)), 9)
    expect(canyonPath(90, 15, 20, 40).path).toBe('blocked')
    expect(canyonPath(0, 10, 20, 40).path).toBe('direct')
  })

  it('error budget: metres alone, under a metre with code corrections, millimetres on carrier phase', () => {
    expect(uere('single')).toBeGreaterThan(4)
    expect(uere('dgps', 5)).toBeLessThan(1)
    expect(uere('carrier', 0)).toBeLessThan(0.01)
    expect(uere('carrier', 20)).toBeGreaterThan(uere('carrier', 1))
  })

  it('wander is smooth and roughly unit variance', () => {
    const v = Array.from({ length: 2000 }, (_, t) => wander(3, t, 40))
    const varr = v.reduce((s, x) => s + x * x, 0) / v.length
    expect(varr).toBeGreaterThan(0.4)
    expect(varr).toBeLessThan(2)
    expect(Math.abs(wander(1, 10.0, 40) - wander(1, 10.5, 40))).toBeLessThan(0.1)
  })

  it('a parked receiver scatters metres; reflections in a canyon pull the cloud off', () => {
    const s = sats(8)
    const open = parkedFixes(s, s.map(() => 0), 300)
    expect(open).toHaveLength(300)
    const cep = radiusQuantile(open.map((e) => e.err), 0.5)
    expect(cep).toBeGreaterThan(0.5)
    expect(cep).toBeLessThan(15)
    expect(parkedFixes(sats(2), [0, 0], 10)).toHaveLength(0)
    expect(parkedFixes(sats(3), [0, 0, 0], 5)[0].kind).toBe('2D')
  })

  it('carrier phase: 19 cm L1 wavelength, whole cycles + fraction', () => {
    expect(L1_LAMBDA).toBeCloseTo(0.1903, 4)
    const c = carrierCycles(20_000e3)
    expect(c.n).toBe(105_100_709)
    expect(c.frac).toBeGreaterThanOrEqual(0)
    expect(c.frac).toBeLessThan(1)
  })

  it('ratio test passes near integers, fails halfway', () => {
    expect(ratioTest([3.02, 7.98, -1.01]).ratio).toBeGreaterThan(3)
    expect(ratioTest([3.02, 7.98, -1.01]).ints).toEqual([3, 8, -1])
    expect(ratioTest([3.45, 8.0]).ratio).toBeLessThan(1.5)
  })

  it('RTK: float converges, fixes to cm on a short baseline; a long one stays float', () => {
    const short = rtkEpochs('rtk', 5, 120, 1)
    expect(short[0].state).toBe('float')
    const fixAt = short.findIndex((e) => e.state === 'fixed')
    expect(fixAt).toBeGreaterThan(0)
    expect(fixAt).toBeLessThan(90)
    expect(short[fixAt].sigma).toBeLessThan(0.02)
    expect(rtkEpochs('rtk', 30, 120, 1).every((e) => e.state === 'float')).toBe(true)
    expect(rtkEpochs('single', 5, 1, 1)[0].sigma).toBeGreaterThan(3)
  })
})
