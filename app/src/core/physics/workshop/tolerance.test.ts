import { footBulge } from '../printing/design'
import { HOLE_SHRINK_MM, TOL_BATCH, TolCfg, limitFit, normalCdf, stackUp, tolRun, yieldIn } from './tolerance'

describe('fits and stacks', () => {
  it('normal CDF and yield', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 9)
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3)
    expect(normalCdf(-1)).toBeCloseTo(1 - normalCdf(1), 9)
    expect(yieldIn(-3, 3, 0, 1)).toBeCloseTo(0.9973, 4)
    expect(yieldIn(0, 1, 0.5, 0)).toBe(1)
  })
  it('limit fit kinds', () => {
    expect(limitFit([3.3, 3.5], [2.874, 2.98]).kind).toBe('clearance')
    expect(limitFit([21.85, 22.05], [21.991, 22]).kind).toBe('transition')
    expect(limitFit([21.8, 21.9], [21.991, 22])).toEqual({ minC: 21.8 - 22, maxC: 21.9 - 21.991, kind: 'interference' })
  })
  it('worst case adds tolerances, RSS adds them in quadrature', () => {
    const s = stackUp([
      { name: 'slot', mean: 30.2, tol: 0.15, sign: 1 },
      { name: 'a', mean: 10, tol: 0.15, sign: -1 },
      { name: 'b', mean: 10, tol: 0.15, sign: -1 },
      { name: 'c', mean: 10, tol: 0.15, sign: -1 },
    ])
    expect(s.mean).toBeCloseTo(0.2, 9)
    expect(s.wc).toBeCloseTo(0.6, 9)
    expect(s.rss).toBeCloseTo(0.3, 9)
    expect(s.sigma).toBeCloseTo(0.1, 9)
  })
})

describe('tolRun', () => {
  const cfg = (o: Partial<TolCfg>): TolCfg => ({ job: 'screw', cadMm: 0.4, printTol: 0.15, foot: 'comp', ...o })
  it('an ISO medium 3.4 mm hole takes an M3 every time', () => {
    const r = tolRun(cfg({}))
    expect(r.holeCad).toBeCloseTo(3.4, 9)
    expect(r.mean).toBeCloseTo(3.4 - HOLE_SHRINK_MM - 2.927, 9)
    expect(r.limits.kind).toBe('clearance')
    expect(r.verdict.pass).toBe(true)
    expect(r.batch.filter((b) => b.fits)).toHaveLength(TOL_BATCH.n)
  })
  it('names too tight, too loose, the elephant-foot mouth and a too-wide spread', () => {
    expect(tolRun(cfg({ cadMm: 0 })).verdict.fail).toBe('tight')
    expect(tolRun(cfg({ cadMm: 0.9 })).verdict.fail).toBe('loose')
    const foot = tolRun(cfg({ foot: 'none' }))
    expect(foot.mouth).toBeCloseTo(foot.mean - 2 * footBulge(), 9)
    expect(foot.verdict.fail).toBe('mouth')
    expect(tolRun(cfg({ job: 'bearing', cadMm: 0, printTol: 0.15 })).verdict.fail).toBe('spread')
    expect(tolRun(cfg({ job: 'bearing', cadMm: 0.025, printTol: 0.05 })).verdict.pass).toBe(true)
  })
  it('stack: RSS passes where worst case says it cannot', () => {
    const r = tolRun(cfg({ job: 'stack', cadMm: 0.4, printTol: 0.1 }))
    expect(r.wcInside).toBe(false)
    expect(r.good).toBeGreaterThan(0.99)
    expect(r.verdict.pass).toBe(true)
    expect(r.wc).toBeCloseTo(0.3 + 0.12, 9)
  })
})
