import { WHEEL_TOP, barAt, errorSweep, junctionOutcome, junctionRun, sCourse, steerRun, steerStats, sweepStats, tapeDist, turnWheels } from './linefollow'

const sweep = (pitch: number, count: number, digital = false) => sweepStats(errorSweep(pitch, count, digital))
const steer = (v: number, kp: number, kd: number) => steerStats(steerRun({ v, kp, kd, r: 0.12 }))
const junction = (c: Partial<Parameters<typeof junctionRun>[0]>) => junctionOutcome(junctionRun({ v: 0.3, target: 2, dir: 'left', detector: 'edge', creep: true, ...c }))

describe('error from a TCRT5000 bar', () => {
  it('reads the tape position, right positive', () => {
    expect(Math.abs(barAt(0, 0.015, 5, false).pos!)).toBeLessThan(1e-4)
    expect(barAt(0.01, 0.015, 5, false).pos!).toBeCloseTo(0.01, 2)
    expect(barAt(0.1, 0.015, 5, false).pos).toBeNull()
  })
  it('analog weighting tracks to within 3 mm across the bar; thresholding gives steps', () => {
    const a = sweep(0.015, 5)
    expect(a.range).toBeGreaterThan(0.028)
    expect(a.lostAt!).toBeGreaterThan(0.04)
    const d = sweep(0.015, 5, true)
    expect(d.levels).toBeLessThanOrEqual(11)
    expect(d.range).toBeLessThan(0.005)
  })
  it('sensors wider apart than the tape read in steps even when analog', () => {
    expect(sweep(0.03, 5).range).toBeLessThan(0.005)
    expect(sweep(0.03, 5).lostAt!).toBeGreaterThan(sweep(0.015, 5).lostAt!)
  })
})

describe('PD steering', () => {
  it('measures tape distance and caps wheel speed', () => {
    expect(tapeDist(sCourse(), 0.2, 0.01)).toBeCloseTo(0.01, 6)
    expect(turnWheels(0.8, 1.5)).toEqual([WHEEL_TOP, -0.4])
  })
  it('P alone is calm when slow but weaves when fast; D damps it', () => {
    expect(steer(0.2, 100, 0).swings).toBeLessThan(5)
    const p = steer(0.8, 120, 0)
    const pd = steer(0.8, 120, 2)
    expect(p.swings).toBeGreaterThan(10)
    expect(pd.swings).toBeLessThan(p.swings / 3)
    expect(pd.rms).toBeLessThan(p.rms * 0.75)
  })
  it('finishes the course and stops', () => {
    const run = steerRun({ v: 0.5, kp: 100, kd: 1.5, r: 0.12 })
    expect(run.at(-1)!.done).toBe(true)
    expect(steerStats(run).lostS).toBe(0)
  })
})

describe('intersections', () => {
  it('counts rising edges and turns at the target crossing', () => {
    expect(junction({})).toMatchObject({ turnedAt: 2, count: 2, heading: 'left' })
    expect(junction({ dir: 'right', target: 3 })).toMatchObject({ turnedAt: 3, heading: 'right' })
    expect(junction({ dir: 'straight' })).toMatchObject({ turnedAt: null, count: 3, heading: 'straight' })
  })
  it('a level counter adds up every loop tick and turns at the first crossing', () => {
    expect(junction({ detector: 'level', target: 3 }).turnedAt).toBe(1)
  })
  it('spinning without creeping forward finds the old line when slow', () => {
    expect(junction({ creep: false, v: 0.2 }).heading).toBe('back')
    expect(Math.abs(junction({ v: 0.2 }).end.x - 0.7)).toBeLessThan(0.01)
  })
})
