import { medianMs } from '../../stopwatch'
import { E_TEST, FLOW_CUBE, PA_SETUPS, eStepsOf, eStepsView, flowCalView, paPattern, paRun, retractView, towerView } from './calibration'
import { stepsView } from './motion'

describe('E-steps', () => {
  it('matches stock values and corrects with the Steps per mm formula', () => {
    expect(eStepsOf('mk8')).toBeCloseTo(93, 0)
    expect(eStepsOf('bmg')).toBeCloseTo(415, 0)
    const v = eStepsView('mk8', 5, 1.5)
    expect(v.slip).toBe(0)
    expect(v.leftMm).toBeCloseTo(E_TEST.markMm - 105, 6)
    expect(v.fixedSpm).toBeCloseTo(v.trueSpm, 6)
    const s = stepsView('gt2_20', 16, 5)
    expect(s.fixedSpm).toBeCloseTo(s.trueSpm, 1)
  })
  it('feeding too fast slips the gear and spoils the fix; the dual gear grips longer', () => {
    const fast = eStepsView('mk8', 0, 7)
    expect(fast.slip).toBeGreaterThan(0.1)
    expect(fast.fixErr).toBeGreaterThan(0.1)
    expect(eStepsView('bmg', 0, 7).slip).toBeLessThan(fast.slip)
  })
})

describe('Flow rate', () => {
  it('nominal flow gives the line width; thin filament under-extrudes and the fix scales back up', () => {
    expect(flowCalView(1, 1.75).wallMm).toBeCloseTo(FLOW_CUBE.lineW, 6)
    const thin = flowCalView(1, 1.7)
    expect(thin.wallMm).toBeLessThan(FLOW_CUBE.lineW)
    expect(thin.fixed).toBeGreaterThan(1.03)
    expect(flowCalView(1.1, 1.75).state).toBe('over')
    expect(flowCalView(thin.fixed, 1.7).wallMm).toBeCloseTo(FLOW_CUBE.lineW, 2)
  })
})

describe('Pressure advance', () => {
  it('K = melt lag cancels it; no PA leaves a thin start and an end blob', () => {
    for (const s of ['direct', 'bowden'] as const) {
      const p = paPattern(s)
      expect(p.bestK).toBeCloseTo(PA_SETUPS[s].tau, 6)
      expect(p.lines[p.best].err).toBeLessThan(0.01)
      const none = paRun(s, 0)
      expect(none.width[1]).toBeLessThan(0.9)
      expect(none.blob).toBeGreaterThan(0)
    }
  })
  it('recomputes well under 100 ms', () => {
    expect(medianMs(() => paPattern('bowden'))).toBeLessThan(100)
  })
})

describe('Retraction', () => {
  it('enough distance stops strings; too far risks jams, too fast grinds', () => {
    expect(retractView('direct', 0, 40).count).toBeGreaterThan(retractView('direct', 0.8, 40).count)
    expect(retractView('direct', 0.8, 40).jam).toBe(0)
    expect(retractView('direct', 5, 40).jam).toBeGreaterThan(0.5)
    expect(retractView('bowden', 0.8, 40).string).toBeGreaterThan(0.5)
    expect(retractView('direct', 0.8, 100).grind).toBeGreaterThan(0.5)
    expect(retractView('direct', 0.8, 10).string).toBeGreaterThan(retractView('direct', 0.8, 40).string)
  })
})

describe('Temperature tower', () => {
  it('the best band sits near the printing temperature, cooler bands lose adhesion, hotter ones string', () => {
    const t = towerView('pla')
    expect(Math.abs(t.bestC - 210)).toBeLessThanOrEqual(5)
    expect(t.bands[0].string).toBeGreaterThan(t.bands[t.best].string)
    expect(t.bands[8].adhesion).toBeLessThan(t.bands[t.best].adhesion)
    expect(Math.abs(towerView('petg').bestC - 240)).toBeLessThanOrEqual(5)
  })
})
