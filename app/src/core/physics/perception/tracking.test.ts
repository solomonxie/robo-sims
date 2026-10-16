import { Img, makeImg, setPixel } from './image'
import { NO_FILTER } from '../control/loopfilter'
import { PAN_CAM, RED_BALL, ballFrame, closeMask, columnOf, dilateMask, erodeMask, findBlob, labelBlobs, largestBlob, openMask, panStats, panTrackRun } from './tracking'

const fromRows = (rows: string[]): Img => {
  const img = makeImg(rows[0].length, rows.length, 1)
  rows.forEach((r, y) => [...r].forEach((c, x) => setPixel(img, x, y, [c === '#' ? 255 : 0])))
  return img
}
const toRows = (m: Img) => Array.from({ length: m.h }, (_, y) => Array.from({ length: m.w }, (__, x) => (m.data[y * m.w + x] > 127 ? '#' : '.')).join(''))

const SPECK = ['.......', '.###...', '.###...', '.###..#', '.......']

test('erode shrinks a 3 × 3 square to its centre and drops the lone speck; dilate grows it back (open)', () => {
  expect(toRows(erodeMask(fromRows(SPECK)))).toEqual(['.......', '.......', '..#....', '.......', '.......'])
  expect(toRows(dilateMask(fromRows(['.....', '..#..', '.....'])))).toEqual(['.###.', '.###.', '.###.'])
  expect(toRows(openMask(fromRows(SPECK)))).toEqual(['.......', '.###...', '.###...', '.###...', '.......'])
})

test('close fills a one-pixel hole but keeps the outline', () => {
  const ring = ['.........', '.........', '..#####..', '..##.##..', '..#####..', '.........', '.........']
  expect(toRows(closeMask(fromRows(ring)))).toEqual(ring.map((r) => r.replace('##.##', '#####')))
})

test('blob labelling: area, centroid and box; diagonal pixels join only with 8-neighbours', () => {
  const m = fromRows(['##...', '##...', '..#..', '...#.'])
  const b8 = labelBlobs(m, 8).blobs
  expect(b8).toHaveLength(1)
  expect(b8[0]).toMatchObject({ area: 6, x0: 0, y0: 0, x1: 3, y1: 3 })
  expect(b8[0].cx).toBeCloseTo((0 + 1 + 0 + 1 + 2 + 3) / 6)
  const b4 = labelBlobs(m, 4)
  expect(b4.blobs.map((b) => b.area)).toEqual([4, 1, 1])
  expect(b4.blobs[0]).toMatchObject({ cx: 0.5, cy: 0.5 })
  expect(b4.labels[2 * 5 + 2]).toBe(2)
  expect(largestBlob(b4.blobs)?.area).toBe(4)
  expect(largestBlob(b4.blobs, 5)).toBeNull()
})

test('ball frame: the red-ball blob sits where it was drawn, also through noise', () => {
  const img = ballFrame(48, 36, 30, 20, 4, 8, 3)
  const { best, blobs } = findBlob(img, RED_BALL)
  expect(blobs).toHaveLength(1)
  expect(Math.abs(best!.cx - 30)).toBeLessThan(0.8)
  expect(Math.abs(best!.cy - 20)).toBeLessThan(0.8)
  expect(best!.area).toBeGreaterThan(Math.PI * 16 * 0.7)
  expect(findBlob(ballFrame(48, 36, -20, 20, 4), RED_BALL).best).toBeNull()
})

test('pinhole column: centre on axis, image edge at half the field of view, left = smaller x', () => {
  expect(columnOf(0)).toBeCloseTo(23.5)
  expect(columnOf(30)).toBeCloseTo(23.5 - 24)
  expect(columnOf(-30)).toBeCloseTo(23.5 + 24)
})

test('pan tracking: a still ball 25° left is centred; slow camera + high gain rings', () => {
  const good = panTrackRun({ kp: 8, kd: 0, fps: 20, filter: NO_FILTER, path: 'step' })
  const end = good.samples[good.samples.length - 1]
  expect(end.ballDeg).toBeCloseTo(25, 5)
  expect(Math.abs(end.panDeg - 25)).toBeLessThan(1.5)
  expect(Math.max(...good.samples.map((s) => s.panDeg))).toBeLessThan(28)
  const ring = panTrackRun({ kp: 30, kd: 0, fps: 5, filter: NO_FILTER, path: 'step' })
  expect(Math.max(...ring.samples.map((s) => s.panDeg))).toBeGreaterThan(32)
  expect(good.frames).toHaveLength(Math.floor(PAN_CAM.seconds * 20 + 1e-6) + 1)
})

test('sweep: tracking error grows when the camera only sees 5 frames a second', () => {
  const fast = panStats(panTrackRun({ kp: 8, kd: 0, fps: 30, filter: NO_FILTER, path: 'sweep' }).samples)
  const slow = panStats(panTrackRun({ kp: 8, kd: 0, fps: 5, filter: NO_FILTER, path: 'sweep' }).samples)
  expect(fast.lostS).toBe(0)
  expect(fast.rms).toBeLessThan(slow.rms)
})
