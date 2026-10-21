import { CONNECTORS } from '../power/wiring'
import { CONNECTOR_JOBS, CONNECTOR_SPECS, PLUG_LAPSE, plugRun, plugTempAt, retentionN } from './connectors'

describe('contact temperature through a burst', () => {
  it('steady before, rises toward the burst temperature, decays after', () => {
    const C = CONNECTORS.xt60
    const J = CONNECTOR_JOBS.battery
    const tau = CONNECTOR_SPECS.xt60.tauS
    const before = plugTempAt(C, tau, J, 0)
    expect(before).toBeCloseTo(25 + 30 * (20 / 30) ** 2, 9)
    const end = plugTempAt(C, tau, J, PLUG_LAPSE.burstAtS + J.burstS)
    expect(end).toBeCloseTo(before + (25 + 30 * (40 / 30) ** 2 - before) * (1 - Math.exp(-J.burstS / tau)), 9)
    expect(plugTempAt(C, tau, J, PLUG_LAPSE.burstAtS + J.burstS + tau)).toBeCloseTo(before + (end - before) / Math.E, 9)
  })
  it('single Dupont housings hold per pin', () => {
    expect(retentionN(CONNECTOR_SPECS.dupont, 4)).toBe(6)
    expect(retentionN(CONNECTOR_SPECS.xt60, 2)).toBe(40)
  })
})

describe('plugRun', () => {
  const fail = (j: Parameters<typeof plugRun>[0], c: Parameters<typeof plugRun>[1]) => plugRun(j, c).verdict
  it('the right part for each job passes', () => {
    for (const [j, c] of [['battery', 'xt60'], ['motor', 'jstph'], ['servo', 'dupont'], ['i2c', 'jstph'], ['balance', 'jstxh']] as const)
      expect(fail(j, c)).toEqual({ pass: true, near: false, fail: null })
  })
  it('Dupont on 2S main power melts; XT30 runs over its 15 A rating', () => {
    expect(fail('battery', 'dupont').fail).toBe('melts')
    expect(plugRun('battery', 'dupont').peakC).toBeGreaterThan(1000)
    expect(fail('battery', 'xt30')).toMatchObject({ fail: 'rating', near: true })
  })
  it('unkeyed housings fail where a swap does harm', () => {
    expect(fail('i2c', 'dupont')).toMatchObject({ fail: 'reverse', near: false })
    expect(fail('motor', 'dupont')).toMatchObject({ fail: 'reverse', near: true })
    expect(plugRun('motor', 'dupont').swapped).toBe('backwards')
    expect(plugRun('motor', 'jstph').swapped).toBe('blocked')
  })
  it('two-pin power plugs can’t carry three-pin leads; oversize and wear are close misses', () => {
    expect(fail('balance', 'xt60').fail).toBe('pins')
    expect(fail('motor', 'xt30')).toMatchObject({ fail: 'bulky', near: true })
    expect(fail('balance', 'jstph')).toMatchObject({ fail: 'wear', near: true })
  })
})
