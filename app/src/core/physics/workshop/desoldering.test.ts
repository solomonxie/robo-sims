import { medianMs } from '../../stopwatch'
import { ALLOYS } from './soldering'
import { DesolderCfg, desolderRun, mixAlloy } from './desoldering'

const run = (o: Partial<DesolderCfg> = {}) => desolderRun({ method: 'pump', fresh: true, setC: 340, dwellS: 3, ...o })

describe('mixAlloy', () => {
  it('linear rule of mixtures between the two melting ranges', () => {
    expect(mixAlloy('sac305', 1, 'sn63', 0).liquidusC).toBe(ALLOYS.sac305.liquidusC)
    expect(mixAlloy('sac305', 1, 'sn63', 1).liquidusC).toBeCloseTo((220 + 183) / 2, 9)
    expect(mixAlloy('sac305', 0, 'sn63', 1).solidusC).toBeCloseTo(183, 9)
  })
})

describe('desolderRun', () => {
  it('fresh solder, then the pump once the barrel has melted: lead free', () => {
    const r = run()
    expect(r.verdict.pass).toBe(true)
    expect(r.out.barrelLeft).toBeLessThanOrEqual(0.3)
    expect(r.out.liquidusC).toBeLessThan(ALLOYS.sac305.liquidusC)
  })
  it('without fresh solder the old joint heats slowly: the pump fires before the barrel melts', () => {
    const r = run({ fresh: false, dwellS: 2, setC: 360 })
    expect(r.verdict.fail).toBe('stuck')
    expect(run({ fresh: false, dwellS: 2, setC: 360 }).out.peakC).toBeLessThan(run({ dwellS: 2, setC: 360 }).out.peakC)
  })
  it('braid on a cold old joint melts nothing', () => {
    expect(run({ method: 'braid', fresh: false, setC: 320, dwellS: 2 }).verdict.fail).toBe('cold')
  })
  it('braid clears the pad fast but the barrel drains slowly', () => {
    const r = run({ method: 'braid', setC: 360, dwellS: 4 })
    expect(r.out.topLeft).toBeLessThan(0.3)
    expect(r.out.barrelLeft).toBeGreaterThan(0.3)
    expect(r.out.braidMm3).toBeGreaterThan(0)
  })
  it('too hot for too long lifts the pad', () => {
    expect(run({ setC: 400, dwellS: 6 }).verdict.fail).toBe('lifted')
  })
  it('runs fast', () => {
    expect(medianMs(() => run({ method: 'braid', dwellS: 8 }))).toBeLessThan(50)
  })
})
