import { medianMs } from '../../stopwatch'
import { INSERT_HOLES, ROBOT, ROBOT_PLATE, bedBoxes, insertJoint, printedBelow, insertScrew, testLoopPose, plateSweep, robotBalance, robotBoxes, robotJob, robotPlate, robotSketch } from './robotprint'

describe('Print a robot', () => {
  it('sketch: the Chassis design plate with one insert hole per screw and a wire hole', () => {
    const s = robotSketch()
    expect([s.w, s.h]).toEqual([185, 110])
    expect(s.contours.length).toBe(1 + INSERT_HOLES.length + 1)
    for (const h of INSERT_HOLES) expect(Math.abs(h.x) < ROBOT_PLATE.w / 2 - 4 && Math.abs(h.y) < ROBOT_PLATE.h / 2 - 4).toBe(true)
  })
  it('plate: thicker is stiffer and heavier; ribs cut the flex for fewer grams than thickness', () => {
    const [t2, t3, t4] = [2, 3, 4].map((t) => robotPlate(t, 'none'))
    expect(t3.deflMm).toBeLessThan(t2.deflMm)
    expect(t3.grams).toBeGreaterThan(t2.grams)
    const ribbed = robotPlate(3, 'edge')
    expect(ribbed.deflMm).toBeLessThan(t4.deflMm)
    expect(ribbed.grams).toBeLessThan(t4.grams)
    expect(robotPlate(3, 'four').deflMm).toBeLessThan(ribbed.deflMm)
    expect(t3.bossH).toBeCloseTo(ROBOT.holeDepth + 1 - 3)
    expect(robotPlate(9, 'none').bossH).toBe(0)
    expect(t3.grams).toBeGreaterThan(40)
    expect(t3.grams).toBeLessThan(120)
  })
  it('job: flat prints in the fewest layers, no supports and full strength; standing loses strength across layers', () => {
    const flat = robotJob('flat', 3, 'edge', 3, 0.2, 0.2)
    const side = robotJob('side', 3, 'edge', 3, 0.2, 0.2)
    const end = robotJob('end', 3, 'edge', 3, 0.2, 0.2)
    expect(flat.supportMm3).toBe(0)
    expect(side.supportMm3).toBeGreaterThan(0)
    expect(flat.layers).toBeLessThan(side.layers)
    expect(flat.seconds).toBeLessThan(side.seconds)
    expect(end.sf).toBeLessThan(flat.sf * 0.6)
    expect(flat.boss.force).toBeGreaterThan(side.boss.force)
    expect(flat.seconds / 3600).toBeGreaterThan(1)
    expect(flat.seconds / 3600).toBeLessThan(6)
    expect(robotJob('flat', 3, 'edge', 3, 0.2, 0.28).seconds).toBeLessThan(flat.seconds)
    expect(robotJob('flat', 3, 'edge', 3, 0.5, 0.2).grams).toBeGreaterThan(flat.grams)
  })
  it('boxes: scanned plate leaves holes, turned boxes sit on the bed and clip at the printed height', () => {
    const b = robotBoxes(3, 'edge')
    const row = b.filter((q) => q.kind === 'plate' && q.y0 <= INSERT_HOLES[0].y && q.y1 > INSERT_HOLES[0].y)
    expect(row.length).toBeGreaterThan(1)
    for (const o of ['flat', 'side', 'end'] as const) {
      const all = bedBoxes(b, o)
      expect(Math.min(...all.map((q) => q.z0))).toBeCloseTo(0)
      expect(Math.max(...printedBelow(all, 5).map((q) => q.z1))).toBeLessThanOrEqual(5)
      expect(all.some((q) => q.kind === 'support')).toBe(o !== 'flat')
    }
  })
  it('assembly: screw length vs stack and insert hole, iron temperature, balance, test loop', () => {
    expect(insertScrew(18.5, 20).verdict).toBe('short')
    expect(insertScrew(18.5, 25).verdict).toBe('ok')
    expect(insertScrew(18.5, 30).verdict).toBe('bottoms')
    expect(insertScrew(18.5, 25).best).toBe(25)
    expect(insertJoint(150).force).toBe(0)
    expect(insertJoint(220).force).toBeGreaterThan(insertJoint(180).force)
    expect(insertJoint(220).sf).toBeGreaterThan(10)
    const B = robotBalance(robotPlate(3, 'edge').grams)
    expect(B.stable).toBe(true)
    expect(B.share).toBeGreaterThan(0.5)
    const a = testLoopPose(0)
    const L = 2 * 0.5 + 2 * Math.PI * 0.18
    const b = testLoopPose(L / 0.25)
    expect(b.x).toBeCloseTo(a.x)
    expect(b.y).toBeCloseTo(a.y)
    for (let t = 0; t < 10; t += 0.37) {
      const p = testLoopPose(t)
      expect(Math.abs(p.x) <= 0.25 + 1e-9 ? Math.abs(p.y) : Math.hypot(Math.abs(p.x) - 0.25, p.y)).toBeCloseTo(0.18)
    }
  })
  it('recomputes fast', () => {
    expect(medianMs(() => {
      plateSweep('four')
      robotJob('end', 4, 'four', 4, 0.4, 0.12)
      printedBelow(bedBoxes(robotBoxes(3, 'four'), 'side'), 40)
    })).toBeLessThan(100)
  })
})
