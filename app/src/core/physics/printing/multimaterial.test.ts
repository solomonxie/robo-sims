import { medianMs } from '../../stopwatch'
import { colourChange, freeHours, mmJob, mmView, purgeMm3, solubleView } from './multimaterial'

describe('Multi-material', () => {
  it('purge: dark to light needs far more than light to dark', () => {
    expect(purgeMm3('black', 'white')).toBeGreaterThan(3 * purgeMm3('white', 'black'))
    expect(purgeMm3('black', 'white')).toBeGreaterThan(500)
    expect(purgeMm3('red', 'red')).toBe(0)
    expect(purgeMm3('red', 'yellow')).toBeGreaterThan(purgeMm3('yellow', 'red'))
  })
  it('tool changers swap fast with almost no waste; the AMS purges', () => {
    const ams = colourChange('ams', 'black', 'white')
    const tool = colourChange('tool', 'black', 'white')
    expect(ams.grams).toBeGreaterThan(10 * tool.grams)
    expect(ams.seconds).toBeGreaterThan(3 * tool.seconds)
    expect(colourChange('idex', 'black', 'white').seconds).toBeLessThan(tool.seconds)
    const j = mmJob('ams', 'black', 'white', 2, 10)
    expect(j.changes).toBe(20)
    expect(j.wasteG).toBeCloseTo(10 * (j.go.grams + j.back.grams))
    expect(mmJob('ams', 'black', 'white', 1, 10).wasteG).toBeLessThan(j.wasteG)
    expect(mmJob('ams', 'black', 'white', 2, 30).wasteShare).toBeGreaterThan(1)
    expect(mmJob('ams', 'black', 'white', 1, 0).wasteG).toBe(0)
  })
  it('soluble supports: warmer and stirred dissolve faster; bonds and reach decide', () => {
    expect(freeHours('pva', 40, 'stirred', 10).hours).toBeLessThan(freeHours('pva', 20, 'still', 10).hours / 5)
    expect(freeHours('bvoh', 20, 'still', 10).hours).toBeLessThan(freeHours('pva', 20, 'still', 10).hours)
    expect(freeHours('hips', 60, 'still', 10).hours).toBeCloseTo(freeHours('hips', 30, 'still', 10).hours)
    const hand = freeHours('breakaway', 20, 'still', 20)
    expect(hand.hand).toBe(true)
    expect(hand.stuckMm).toBeGreaterThan(0)
    expect(solubleView('pla', 'pva', 20, 'still', 10).holds).toBe(true)
    expect(solubleView('petg', 'pva', 20, 'still', 10).holds).toBe(false)
    expect(solubleView('asa', 'hips', 20, 'still', 10).holds).toBe(true)
    expect(solubleView('pla', 'pva', 55, 'still', 10).softens).toBe(true)
    const v = solubleView('pla', 'pva', 20, 'still', 10)
    expect(v.curve[0]).toBeGreaterThan(v.curve[v.curve.length - 1])
  })
  it('recomputes fast', () => {
    expect(medianMs(() => mmView('ams', 'black', 'white', 2, 20))).toBeLessThan(20)
    expect(medianMs(() => solubleView('pla', 'pva', 40, 'stirred', 12))).toBeLessThan(20)
  })
})
