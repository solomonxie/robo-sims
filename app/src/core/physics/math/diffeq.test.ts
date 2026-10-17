import { freeAt } from '../mechanics/oscillation'
import { integrateRule } from './calculus'
import { MAST, ODE_METHODS, OdeMethod, SPIN, SWING, criticalStep, eulerView, exactFrom, fieldGrid, odeRun, odeStep, spinFrom, springEnergy, springRate, stepError, stepGain, stepSizeView, swingFrom, swingW } from './diffeq'

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

describe('stepping a rule', () => {
  it('exact solutions obey their rules', () => {
    const e = 1e-6
    const dw = (spinFrom(0, 0.4 + e) - spinFrom(0, 0.4 - e)) / (2 * e)
    expect(dw).toBeCloseTo((SPIN.torque - SPIN.b * spinFrom(0, 0.4)) / SPIN.J, 4)
    const y = swingFrom([SWING.x0, 0], 0.3)
    expect(y[0]).toBeCloseTo(freeAt(0, swingW, SWING.x0, 0.3), 12)
    expect(springEnergy(SWING.m, SWING.k, y)).toBeCloseTo(springEnergy(SWING.m, SWING.k, [SWING.x0, 0]), 12)
  })
  it('Euler on a rate that ignores the state is the left-rectangle rule', () => {
    const f = (t: number) => Math.sin(t) + t
    const { ys } = odeRun('euler', (t) => [f(t)], [0], 0.1, 2)
    expect(ys[20][0]).toBeCloseTo(integrateRule(f, 0, 2, 20, 'left'), 12)
  })
  it('the motor speeds up toward τ/b; Euler follows the slope and converges', () => {
    const v = eulerView('motor', 0.05)
    expect(v.ys[1][0]).toBeCloseTo(0.05 * (SPIN.torque / SPIN.J), 12)
    expect(v.exact[v.ts.length - 1][0]).toBeGreaterThan(0.98 * (SPIN.torque / SPIN.b))
    expect(eulerView('motor', 0.025).maxErr).toBeLessThan(0.6 * v.maxErr)
    expect(v.steps[3].local[0]).toBeCloseTo(exactFrom('motor', v.ys[3], 0.05)[0], 12)
  })
  it('Euler on a spring gains energy by exactly 1 + (ωh)² per step', () => {
    const v = eulerView('spring', 0.05)
    const n = v.ts.length - 1
    expect(v.energy[n]).toBeCloseTo((1 + (swingW * 0.05) ** 2) ** n, 9)
    expect(v.energy[n]).toBeGreaterThan(5)
    expect(v.growth ** 2).toBeCloseTo(1 + (swingW * 0.05) ** 2, 12)
  })
  it('field grid spans the box', () => {
    const g = fieldGrid([0, 1], [0, 2], 4, 2, (x, y) => [1, x + y])
    expect(g).toHaveLength(8)
    expect(g[0].at).toEqual([0.125, 0.5])
    expect(g[7].d).toEqual([1, 0.875 + 1.5])
  })
})

describe('step size', () => {
  const w = Math.sqrt(150 / MAST.m)
  it('error order: Euler and semi-implicit ~h, RK4 ~h⁴', () => {
    const order = (m: OdeMethod) => Math.log2(stepError(m, w, MAST.zeta, 0.004) / stepError(m, w, MAST.zeta, 0.002))
    expect(order('euler')).toBeCloseTo(1, 0)
    expect(order('semi')).toBeCloseTo(1, 0)
    expect(order('rk4')).toBeGreaterThan(3.5)
  })
  it('explicit Euler is stable only for h < 2ζ/ω, semi-implicit to ωh = 2(√(ζ²+1) − ζ), RK4 to ≈ 2.8/ω when undamped', () => {
    expect(criticalStep('euler', w, MAST.zeta)).toBeCloseTo((2 * MAST.zeta) / w, 6)
    expect(criticalStep('semi', w, MAST.zeta) * w).toBeCloseTo(2 * (Math.sqrt(MAST.zeta ** 2 + 1) - MAST.zeta), 5)
    expect(criticalStep('rk4', w, 0) * w).toBeCloseTo(2 * Math.SQRT2, 2)
    expect(stepGain('euler', w, 0, 0.001)).toBeGreaterThan(1)
    expect(stepGain('semi', w, 0, 0.05)).toBeCloseTo(1, 9)
  })
  it('stepGain is the growth of a real run', () => {
    const h = 0.03
    const { ys } = odeRun('euler', springRate(1, w * w, 2 * MAST.zeta * w), [1, 0], h, 3)
    const amp = (y: number[]) => Math.hypot(y[0] * w, y[1])
    const rate = (amp(ys[100]) / amp(ys[50])) ** (1 / 50)
    expect(rate).toBeCloseTo(stepGain('euler', w, MAST.zeta, h), 2)
  })
  it('an unstable step blows up; a stiffer spring lowers every critical step', () => {
    const hs = [0.001, 0.01, 0.05]
    const soft = stepSizeView('euler', 150, 0.012, hs)
    expect(soft.stable).toBe(false)
    expect(Math.abs(soft.xs[soft.xs.length - 1])).toBeGreaterThan(MAST.x0)
    expect(Math.abs(soft.exact[soft.exact.length - 1])).toBeLessThan(0.1 * MAST.x0)
    const stiff = stepSizeView('rk4', 5000, 0.012, hs)
    for (const m of Object.keys(ODE_METHODS) as OdeMethod[]) expect(stiff.crit[m]).toBeLessThan(soft.crit[m])
    expect(odeStep('semi', springRate(1, 1), 0, [1, 0], 0.1)).toEqual([1 - 0.01, -0.1])
  })
  it('recomputes fast enough for a slider', () => {
    const hs = Array.from({ length: 31 }, (_, i) => 0.001 * 100 ** (i / 30))
    const runs = Array.from({ length: 5 }, () => {
      const t0 = performance.now()
      stepSizeView('euler', 5000, 0.001, hs)
      return performance.now() - t0
    })
    expect(median(runs)).toBeLessThan(150)
  })
})
