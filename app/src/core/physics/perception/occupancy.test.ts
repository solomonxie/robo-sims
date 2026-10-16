import { walledRoom } from '../room'
import { addLogOdds, bresenham, cellState, coneCells, integrateScan, lapPath, logOdds, occGrid, occModel, occRun, occScan, occStats, occTruth, probOf, rayCells, roomOccGrid } from './occupancy'

const ROOM = walledRoom(2, 1, 0.5, [{ kind: 'box', name: 'crate', x: [1.2, 1.4], y: [0.2, 0.4], h: 0.3, refl: 0.6 }])

describe('log-odds', () => {
  it('round-trips and adds evidence', () => {
    expect(logOdds(0.5)).toBe(0)
    expect(logOdds(0.7)).toBeCloseTo(0.8473, 4)
    expect(probOf(logOdds(0.9))).toBeCloseTo(0.9, 9)
    // two hits at 0.7 from unknown: 0.847 + 0.847 = 1.695 → p = 0.845
    expect(probOf(2 * logOdds(0.7))).toBeCloseTo(0.8448, 4)
  })
  it('clamps', () => {
    const m = occModel(0.7, 0.4, 0.9)
    const g = occGrid(0, 0, 1, 1, 1)
    for (let i = 0; i < 10; i++) addLogOdds(g, 0, m.lOcc, m)
    expect(g.lo[0]).toBeCloseTo(logOdds(0.9), 6)
    addLogOdds(g, 0, m.lFree, m)
    expect(g.lo[0]).toBeCloseTo(logOdds(0.9) + logOdds(0.4), 6)
    expect(occModel(0.7, 0.4, 1).lMax).toBe(Infinity)
  })
})

describe('bresenham', () => {
  it('walks straight, diagonal and shallow lines', () => {
    expect(bresenham(0, 0, 3, 0)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]])
    expect(bresenham(0, 0, 2, 2)).toEqual([[0, 0], [1, 1], [2, 2]])
    expect(bresenham(0, 0, 5, 2)).toEqual([[0, 0], [1, 0], [2, 1], [3, 1], [4, 2], [5, 2]])
    expect(bresenham(0, 3, 1, 0)).toEqual([[0, 3], [0, 2], [1, 1], [1, 0]])
  })
})

describe('one beam', () => {
  it('frees the cells before the hit and marks the hit cell', () => {
    const g = occGrid(0, 0, 1, 5, 1)
    const c = rayCells(g, 0.5, 0.5, 0, 3, true)
    expect(c).toEqual({ free: [0, 1, 2], occ: [3] })
    const m = occModel(0.7, 0.4, 0.97)
    integrateScan(g, m, { x: 0.5, y: 0.5, th: 0 }, [{ a: 0, m: 3, hit: true, half: 0 }])
    expect(Array.from(g.lo).map((v) => +v.toFixed(3))).toEqual([-0.405, -0.405, -0.405, 0.847, 0])
  })
  it('a miss frees the end cell too', () => {
    expect(rayCells(occGrid(0, 0, 1, 5, 1), 0.5, 0.5, 0, 3, false)).toEqual({ free: [0, 1, 2, 3], occ: [] })
  })
  it('a hit on a cell edge lands in the far cell', () => {
    expect(rayCells(occGrid(0, 0, 1, 5, 1), 0.5, 0.5, 0, 2.5, true).occ).toEqual([3])
  })
  it('a cone marks a whole arc, weaker off-axis', () => {
    const g = occGrid(0, 0, 0.1, 40, 40)
    const c = coneCells(g, 0.05, 2.05, 0, Math.PI / 12, 3, true)
    expect(c.occ.length).toBeGreaterThan(10)
    expect(Math.max(...c.gain)).toBeGreaterThan(0.95)
    expect(Math.min(...c.gain)).toBeLessThan(0.6)
    expect(c.free.length).toBeGreaterThan(100)
  })
})

describe('scan and run', () => {
  it('lidar sees the crate, sonar sees it wider', () => {
    const pose = { x: 0.5, y: 0.3, th: 0 }
    expect(occScan(ROOM, pose, 'lidar', 4, 5)[0].m).toBeCloseTo(0.7, 6)
    const sonar = occScan(ROOM, { x: 0.5, y: 0.6, th: 0 }, 'sonar', 4, 5)
    expect(sonar[0].m).toBeLessThan(1)
    expect(occScan(ROOM, { x: 0.5, y: 0.6, th: 0 }, 'lidar', 4, 5)[0].m).toBeCloseTo(1.5, 6)
  })
  it('maps a room: few wrong cells without drift, more with', () => {
    const run = (drift: number) =>
      occRun({ room: () => ROOM, path: lapPath(1, 0.5, 0.45, 0.2, 0.3), sensor: 'lidar', beams: 90, maxM: 4, res: 0.1, model: occModel(), drift, T: 8, scanHz: 4 })
    const truth = occTruth(ROOM, 0.1)
    const stat = (d: number) => {
      const fr = run(d)
      return occStats({ ...roomOccGrid(ROOM, 0.1), lo: fr[fr.length - 1].lo }, truth)
    }
    const clean = stat(0)
    expect(clean.wrong / clean.cells).toBeLessThan(0.03)
    expect(clean.free).toBeGreaterThan(100)
    expect(stat(0.15).wrong).toBeGreaterThan(clean.wrong)
    expect(cellState(0)).toBe('unknown')
  })
})
