import { medianMs } from '../../stopwatch'
import { dcdcPoint, LM2596 } from '../power/converters'
import { LM7805, PlateCfg, REG_COOLERS, RegCooler, chainTemps, conductionR, convectionR, cooledReg, plateChain, plateRun, radiationG, regHeatRun } from './heat'

const BASE: PlateCfg = { watts: 2, solid: 'aluminium', thicknessM: 0.002, sideM: 0.05, joint: 'paste', air: 'still' }

describe('thermal resistance', () => {
  test('conduction, convection and radiation in °C/W', () => {
    expect(conductionR(400, 0.002, 1e-4)).toBeCloseTo(0.05, 9)
    expect(conductionR(0.026, 1e-4, 1e-4) / conductionR(400, 1e-4, 1e-4)).toBeCloseTo(400 / 0.026, 6)
    expect(convectionR(10, 0.01)).toBeCloseTo(10, 9)
    const g = radiationG(60, 0.9, 25, 1)
    expect(g).toBeGreaterThan(5)
    expect(g).toBeLessThan(8)
  })

  test('a series chain drops P·R across each stage, like volts', () => {
    expect(chainTemps([2, 3, 5], 2, 25)).toEqual([45, 41, 35, 25])
  })

  test('metal barely resists, FR4 and an air gap dominate, the air side is the bottleneck', () => {
    const al = plateChain(BASE)
    expect(al.rs[2]).toBeLessThan(0.1)
    expect(al.rs[3]).toBeGreaterThan(10)
    expect(al.temps[0]).toBeCloseTo(25 + 2 * al.rTotal, 9)
    expect(plateChain({ ...BASE, solid: 'fr4', thicknessM: 0.0016 }).rs[2]).toBeGreaterThan(30)
    expect(plateChain({ ...BASE, joint: 'air' }).rs[1]).toBeGreaterThan(30)
    const fan = plateChain({ ...BASE, air: 'fan' })
    expect(fan.rs[3]).toBeLessThan(al.rs[3] / 3)
    expect(plateChain({ ...BASE, sideM: 0.1 }).rs[3]).toBeLessThan(al.rs[3] / 3)
  })

  test('FR4 radiates a bigger share than bare aluminium', () => {
    const fr4 = plateChain({ ...BASE, solid: 'fr4', thicknessM: 0.0016 })
    expect(fr4.radShare).toBeGreaterThan(0.3)
    expect(plateChain(BASE).radShare).toBeLessThan(0.1)
  })

  test('warm-up reaches ~63 % at τ and settles at the steady chain', () => {
    const { chain, run } = plateRun(BASE, 3000, 1)
    const rise = chain.temps[0] - 25
    const inner = chain.temps[0] - chain.temps[3]
    const atTau = run[Math.round(chain.tauS)].tj - 25 - inner
    expect(atTau / (rise - inner)).toBeGreaterThan(0.58)
    expect(atTau / (rise - inner)).toBeLessThan(0.7)
    expect(run[run.length - 1].tj).toBeCloseTo(chain.temps[0], 0)
  })

  test('the run is fast', () => {
    expect(medianMs(() => plateRun({ ...BASE, solid: 'copper', thicknessM: 0.006, sideM: 0.1 }, 1800, 1))).toBeLessThan(100)
  })
})

describe('cooling a regulator', () => {
  const run = (k: RegCooler, vin = 12, a = 0.5) => regHeatRun(cooledReg(LM7805, 5, k), vin, a, 600)

  test('12 V → 5 V at 0.5 A burns ~3.5 W', () => {
    expect(run('bare').watts).toBeCloseTo(7 * 0.5 + 12 * 0.005, 6)
  })

  test('bare it trips and cycles; a finned sink holds it; a fan holds 1 A', () => {
    const bare = run('bare')
    expect(bare.steadyC).toBeGreaterThan(150)
    expect(bare.trips).toBe(true)
    expect(bare.onShare).toBeLessThan(0.9)
    const fin = run('finned')
    expect(fin.trips).toBe(false)
    expect(fin.steadyC).toBeLessThan(125)
    expect(run('fan', 12, 1).trips).toBe(false)
    expect(Object.keys(REG_COOLERS).map((k) => cooledReg(LM7805, 5, k as RegCooler).thetaJA)).toEqual([50, 36, 24, 11.5, 7])
  })

  test('a buck converter wastes a fraction of the linear loss', () => {
    const lin = run('bare').watts
    expect(dcdcPoint(LM2596, 12, 5, 0.5).loss).toBeLessThan(lin / 4)
  })
})
