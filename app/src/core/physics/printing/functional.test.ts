import { medianMs } from '../../stopwatch'
import { anchorPullout } from '../materials/fasteners'
import { hingeCycles, hingeStrain, hingeView, insertBoss, insertBossView, lewisStress, lewisY, nutPlayDeg, nutPocket, nutPocketView, printedGear, printedGearView, snapHook, snapPushN, snapStrain, snapView } from './functional'

describe('Functional parts', () => {
  it('insert boss: a 4.0 mm hole and a 2.3 mm wall match the Fasteners pull-out; too big a hole, a thin wall or a sideways boss lose', () => {
    const good = insertBoss(4.0, 2.3, 7.5, 'vertical')
    expect(good.force).toBeCloseTo(anchorPullout('insert', 2.3).force)
    expect(good.split).toBe(false)
    expect(good.overflow).toBe(0)
    expect(insertBoss(4.4, 2.3, 7, 'vertical').force).toBeLessThan(good.force * 0.6)
    expect(insertBoss(4.0, 0.8, 7, 'vertical').split).toBe(true)
    expect(insertBoss(4.0, 2.3, 7, 'horizontal').force).toBeLessThan(good.force * 0.6)
    expect(insertBoss(4.0, 2.3, 4.5, 'vertical').seated).toBeLessThan(1)
    expect(insertBoss(3.6, 2.3, 5.7, 'vertical').overflow).toBeGreaterThan(0)
    const v = insertBossView(4.0, 2.3, 7, 'vertical')
    expect(v.curve.length).toBeGreaterThan(10)
    expect(v.screw).toBeLessThan(v.ideal)
  })
  it('captive nut: hole shrink sets the fit, gap lets the nut turn, a bridged roof costs a layer', () => {
    expect(nutPlayDeg(5.5, 0)).toBeCloseTo(0)
    expect(nutPlayDeg(5.5, 0.3)).toBeGreaterThan(4)
    expect(nutPocket(0.05, 2, 'top').fit).toBe('press')
    expect(nutPocket(0.4, 2, 'side').fallsOut).toBe(true)
    const top = nutPocket(0.2, 2, 'top')
    const side = nutPocket(0.2, 2, 'side')
    expect(side.force).toBeLessThan(top.force)
    expect(side.both).toBe(true)
    expect(nutPocket(0.2, 3, 'buried').force).toBeGreaterThan(side.force)
    expect(nutPocketView(0.2, 2, 'top').insert).toBeGreaterThan(0)
  })
  it('snap fit: ε = 1.5 t y / L², PLA near its limit where PETG is easy, across the layers halves the allowance, a 90° back locks', () => {
    expect(snapStrain(1.6, 1, 12)).toBeCloseTo(0.01667, 4)
    const pla = snapHook('pla', 'along', 1.6, 12, 1, 45)
    expect(pla.ratio).toBeGreaterThan(0.7)
    expect(pla.ratio).toBeLessThan(1)
    expect(snapHook('petg', 'along', 1.6, 12, 1, 45).ratio).toBeLessThan(0.5)
    expect(snapHook('pla', 'across', 1.6, 12, 1, 45).breaks).toBe(true)
    expect(pla.pull).toBeGreaterThan(pla.push)
    expect(snapPushN(10, 90)).toBe(Infinity)
    expect(snapView('pla', 'along', 1.6, 12, 1, 45).curve[0]).toBeGreaterThan(pla.eps)
  })
  it('living hinge: PP lasts ~a million folds, PLA cracks in under a few hundred; lines along the fold fail sooner', () => {
    expect(hingeStrain(0.4, 180)).toBeCloseTo(0.209, 2)
    expect(hingeCycles('pp', 0.4, 180, 'across')).toBeGreaterThan(5e5)
    expect(hingeCycles('pla', 0.4, 180, 'across')).toBeLessThan(300)
    expect(hingeCycles('petg', 0.4, 180, 'along')).toBeLessThan(hingeCycles('petg', 0.4, 180, 'across') / 10)
    expect(hingeCycles('pp', 0.3, 180, 'across')).toBeGreaterThan(hingeCycles('pp', 0.6, 180, 'across'))
    expect(hingeView('tpu', 0.4, 180, 'across').cycles).toBe(1e7)
  })
  it('printed gears: Lewis Y grows with teeth, stress falls with module and face width; on its edge halves the allowance', () => {
    expect(lewisY(12)).toBeCloseTo(0.245)
    expect(lewisY(36)).toBeGreaterThan(lewisY(20))
    const a = lewisStress(0.1, 1, 6, 12)
    expect(a.Ft).toBeCloseTo(16.67, 1)
    expect(lewisStress(0.1, 2, 6, 12).sigma).toBeLessThan(a.sigma / 3)
    const g = printedGear(0.1, 1, 6, 'pla', 'flat')
    expect(g.ratio).toBe(3)
    expect(g.backlash).toBeCloseTo(0.109, 2)
    expect(printedGear(0.1, 1, 6, 'pla', 'edge').sf).toBeCloseTo(g.sf / 2)
    expect(printedGear(0.1, 1, 6, 'nylon', 'herring').sf).toBeGreaterThan(g.sf)
  })
  it('every view recomputes well under 100 ms', () => {
    expect(
      medianMs(() => {
        insertBossView(4, 2, 7, 'vertical')
        nutPocketView(0.2, 2, 'side')
        snapView('pla', 'along', 1.6, 12, 1, 45)
        hingeView('pp', 0.4, 180, 'across')
        printedGearView(0.1, 1, 6, 'pla', 'flat')
      }),
    ).toBeLessThan(20)
  })
})
