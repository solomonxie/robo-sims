import {
  NOMINAL, PINION_TEETH, SHIFT_N, SHIFT_ONSET, VIB_BANDS, VIB_HZ, VIB_N, alarmStats, expectedLevels, learnBaseline, modelScore, shiftRun, shiftState, vibModel, vibRms, vibSpectrum,
  vibWindow, zScore, zScores,
} from './anomaly'

const healthy = { ...NOMINAL, fault: 'healthy' as const, severity: 0 }

describe('vibration windows', () => {
  it('is repeatable per seed; the gear mesh peak sits at 12× shaft', () => {
    expect(vibWindow(healthy, 3)).toEqual(vibWindow(healthy, 3))
    const { amps, levels } = vibSpectrum(vibWindow(healthy, 3))
    expect(levels).toHaveLength(VIB_BANDS)
    const peak = amps.indexOf(Math.max(...amps.slice(60)))
    expect(Math.abs((peak * VIB_HZ) / VIB_N - (PINION_TEETH * NOMINAL.rpm) / 60)).toBeLessThan(8)
  })
  it('each fault lifts its own band far above the healthy baseline', () => {
    const b = learnBaseline(NOMINAL, 40)
    expect(zScore(zScores(vibSpectrum(vibWindow(healthy, 9)).levels, b))).toBeLessThan(3)
    const zOf = (fault: 'imbalance' | 'bearing' | 'loose') => zScores(vibSpectrum(vibWindow({ ...NOMINAL, fault, severity: 0.5 }, 9)).levels, b)
    const top = (z: number[]) => z.indexOf(Math.max(...z))
    expect(top(zOf('imbalance'))).toBe(0)
    expect(top(zOf('bearing'))).toBe(VIB_BANDS - 1)
    expect(top(zOf('loose'))).toBe(1)
    for (const f of ['imbalance', 'bearing', 'loose'] as const) expect(zScore(zOf(f))).toBeGreaterThan(5)
  })
  it('a faster healthy motor is louder than a slow worn one', () => {
    const fast = vibRms(vibWindow({ ...healthy, rpm: 2100, load: 1 }, 4))
    const worn = vibRms(vibWindow({ rpm: 1200, load: 0.4, fault: 'bearing', severity: 0.4 }, 4))
    expect(fast).toBeGreaterThan(worn)
  })
})

describe('model of normal vs fixed threshold', () => {
  it('predicts healthy levels across speeds; scores stay low when healthy', () => {
    const m = vibModel()
    for (const rpm of [1000, 1500, 2000]) {
      const s = { ...healthy, rpm, load: 0.5 }
      const lv = vibSpectrum(vibWindow(s, 21)).levels
      expectedLevels(m, s).forEach((v, i) => expect(Math.abs(v - lv[i])).toBeLessThan(0.3))
      expect(modelScore(m, s, lv)).toBeLessThan(2)
    }
  })
  it('speed changes fool a tight RMS threshold but not the model; the model catches faults', () => {
    const ok = shiftRun('speeds', 'healthy')
    expect(ok).toHaveLength(SHIFT_N)
    expect(alarmStats(ok.map((r) => r.rms), 0.04, false).falses).toBeGreaterThan(0)
    expect(alarmStats(ok.map((r) => r.score), 2, false).falses).toBe(0)
    for (const f of ['imbalance', 'bearing', 'loose'] as const) {
      const run = shiftRun('speeds', f)
      const a = alarmStats(run.map((r) => r.score), 2, true)
      expect(a.falses).toBe(0)
      expect(a.delay).not.toBeNull()
      expect(a.delay!).toBeLessThan(10)
    }
  })
  it('drift slowly raises the score: false alarms without a new baseline', () => {
    const run = shiftRun('drift', 'healthy')
    expect(run[SHIFT_N - 1].score).toBeGreaterThan(run[0].score)
    expect(alarmStats(run.map((r) => r.score), 2, false).falses).toBeGreaterThan(0)
  })
  it('alarms need two windows in a row; faults start at onset', () => {
    expect(alarmStats([0, 3, 0, 3, 3, 0], 1, false)).toMatchObject({ falses: 1 })
    expect(alarmStats([0, 0, 3, 3, 3], 1, true, 2)).toMatchObject({ falses: 0, delay: 1 })
    expect(shiftState('steady', 'bearing', SHIFT_ONSET - 1).fault).toBe('healthy')
    expect(shiftState('steady', 'bearing', SHIFT_ONSET).fault).toBe('bearing')
  })
})
