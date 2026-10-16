import { DEG } from '../common'
import { apply4, invert4, mul4 } from '../software/urdf'
import { camTf, intrinsicsOf, projectPx } from './projection'
import { renderView } from './render'
import {
  TAG_CORRECT, TAG_DICT, TAG_MIN_DIST, adaptiveThreshold, decodeTag, findTags, hamming, robotFromTag, rotBits, tagBits, tagCorners, tagJitterRun, tagPlate, tagPose, wallTagTf,
} from './markers'
import { grainImg, makeImg } from './image'

const K = intrinsicsOf(80, 60, 60)
const CAM = camTf([0, 0, 0.15], 0, 0)
const flip = (b: number[], idx: number[]) => b.map((x, i) => (idx.includes(i) ? 1 - x : x))
const near = (a: readonly number[], b: readonly number[], tol: number) => a.forEach((x, i) => expect(Math.abs(x - b[i])).toBeLessThan(tol))

test('dictionary: every pair of codes and every code against its own turns is ≥ 6 bits apart, so 2 bad bits can be fixed', () => {
  expect(TAG_CORRECT).toBe(2)
  TAG_DICT.forEach((a, i) => {
    for (let r = 1; r < 4; r++) expect(hamming(tagBits(a), rotBits(tagBits(a), r))).toBeGreaterThanOrEqual(TAG_MIN_DIST)
    TAG_DICT.slice(i + 1).forEach((b) => {
      for (let r = 0; r < 4; r++) expect(hamming(tagBits(a), rotBits(tagBits(b), r))).toBeGreaterThanOrEqual(TAG_MIN_DIST)
    })
  })
})

test('rotBits: a quarter-turn clockwise moves the top-left bit to the top-right; four turns are the identity', () => {
  const b = Array(16).fill(0)
  b[0] = 1
  expect(rotBits(b, 1)[3]).toBe(1)
  expect(rotBits(b, 2)[15]).toBe(1)
  expect(rotBits(tagBits(TAG_DICT[3]), 4)).toEqual(tagBits(TAG_DICT[3]))
})

test('decode: all 4 turns give the right id and turn; 1 or 2 flipped bits are fixed, 3 are refused', () => {
  for (let r = 0; r < 4; r++) expect(decodeTag(rotBits(tagBits(TAG_DICT[5]), r))).toMatchObject({ id: 5, rot: r, dist: 0 })
  expect(decodeTag(flip(tagBits(TAG_DICT[2]), [7]))).toMatchObject({ id: 2, dist: 1, fixed: [7] })
  expect(decodeTag(flip(rotBits(tagBits(TAG_DICT[6]), 3), [0, 9]))).toMatchObject({ id: 6, rot: 3, dist: 2 })
  expect(decodeTag(flip(tagBits(TAG_DICT[2]), [1, 6, 12]))).toBeNull()
})

test('adaptive threshold: a dark square on a ramp is found even where the background is darker than the square elsewhere', () => {
  const img = makeImg(30, 10, 1)
  for (let y = 0; y < 10; y++) for (let x = 0; x < 30; x++) img.data[y * 30 + x] = 60 + x * 6 - (x >= 22 && x < 26 && y >= 3 && y < 7 ? 50 : 0)
  const { mask } = adaptiveThreshold(img, 3, 10)
  expect(mask.data[5 * 30 + 23]).toBe(255)
  expect(mask.data[5 * 30 + 3]).toBe(0)
})

test('render → detect: id, corners and turn at all 4 rolls; corner 0 is the tag top-left', () => {
  for (let q = 0; q < 4; q++) {
    const T = wallTagTf([0.45, 0.02, 0.15], Math.PI + 0.3, q * 90 * DEG)
    const img = renderView(K, CAM, { plates: [tagPlate(T, TAG_DICT[4], 0.1)] }, 80, 60, undefined, 2)
    const scan = findTags(img)
    expect(scan.tags).toHaveLength(1)
    const t = scan.tags[0]
    expect(t).toMatchObject({ id: 4, dist: 0 })
    tagCorners(0.1).forEach((p, i) => near(t.corners[i], projectPx(K, CAM, apply4(T, p)), 0.6))
  }
})

test('pose: exact corners give back camera ← tag; detected corners land within 1.5 cm and 10° (orientation is the weak part)', () => {
  const T = wallTagTf([0.5, -0.05, 0.17], Math.PI - 0.4, 0.2)
  const truth = mul4(invert4(CAM), T)
  const exact = tagCorners(0.1).map((p) => projectPx(K, CAM, apply4(T, p)).slice(0, 2) as [number, number])
  near(tagPose(K, exact, 0.1), truth, 1e-6)
  const run = tagJitterRun({ k: K, Twc: CAM, worldTag: T, code: TAG_DICT[1], size: 0.1, noise: 4, frames: 6 })
  expect(run.frames.every((f) => f.pose)).toBe(true)
  for (const f of run.frames) {
    near([f.pose![3], f.pose![7], f.pose![11]], [truth[3], truth[7], truth[11]], 0.015)
    const cosA = [0, 4, 8].reduce((s, i) => s + f.pose![i] * truth[i] + f.pose![i + 1] * truth[i + 1] + f.pose![i + 2] * truth[i + 2], 0)
    expect(Math.acos(Math.min(1, (cosA - 1) / 2))).toBeLessThan(10 * DEG)
  }
})

test('localise: a map tag and the seen camera ← tag give back world ← robot', () => {
  const robot = mul4(camTf([0.2, -0.3, 0], 0.5, 0), invert4(camTf([0, 0, 0], 0, 0)))
  const robotCam = camTf([0.05, 0, 0.12], 0, 0)
  const tag = wallTagTf([1.2, 0.1, 0.12], Math.PI)
  const camTag = mul4(invert4(mul4(robot, robotCam)), tag)
  near(robotFromTag(tag, camTag, robotCam), robot, 1e-9)
})

test('grainImg: zero-mean grain with the asked σ, different per seed, repeatable', () => {
  const flat = makeImg(80, 60, 1, 128)
  const a = grainImg(flat, 10, 1)
  const d = Array.from(a.data, (v) => v - 128)
  expect(Math.abs(d.reduce((s, x) => s + x, 0) / d.length)).toBeLessThan(0.5)
  expect(Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length)).toBeCloseTo(10, 0)
  expect(grainImg(flat, 10, 2).data[5]).not.toBe(a.data[5])
  expect(grainImg(flat, 10, 1).data).toEqual(a.data)
})
