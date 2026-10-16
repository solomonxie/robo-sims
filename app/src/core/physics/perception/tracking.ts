// Colour tracking: mask clean-up (erode/dilate/open/close), connected blobs, a ball rendered into camera frames, and a pan servo steering toward the blob centroid.
import { clamp } from '../common'
import { SG90_LOOP } from '../actuators/servo'
import { MeasFilter, filterRun } from '../control/loopfilter'
import { PID_MEM0, pidTick } from '../control/pid'
import { Img, grainAt, hsvMask, makeImg } from './image'
import { focalPx } from './projection'

/** 3 × 3 min (erode) or max (dilate) of a binary mask as a row pass then a column pass; pixels outside the image are ignored. */
function morph(mask: Img, erode: boolean): Img {
  const { w, h, ch, data } = mask
  const n = w * h
  const a = new Uint8Array(n)
  for (let i = 0; i < n; i++) a[i] = data[i * ch] > 127 ? 1 : 0
  const b = new Uint8Array(n)
  const keep = erode ? 1 : 0
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i++) b[i] = (x > 0 && a[i - 1] !== keep) || (x < w - 1 && a[i + 1] !== keep) ? 1 - keep : a[i]
  const out = makeImg(w, h, 1)
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i++) out.data[i] = ((y > 0 && b[i - w] !== keep) || (y < h - 1 && b[i + w] !== keep) ? 1 - keep : b[i]) * 255
  return out
}
export const erodeMask = (mask: Img) => morph(mask, true)
export const dilateMask = (mask: Img) => morph(mask, false)
/** Erode then dilate: specks smaller than 3 × 3 vanish, big shapes keep their size. */
export const openMask = (mask: Img) => dilateMask(erodeMask(mask))
/** Dilate then erode: one-pixel holes and gaps fill, outlines stay put. */
export const closeMask = (mask: Img) => erodeMask(dilateMask(mask))

export type Cleanup = 'none' | 'open' | 'close' | 'both'
const cleanMask = (mask: Img, c: Cleanup) => (c === 'open' ? openMask(mask) : c === 'close' ? closeMask(mask) : c === 'both' ? closeMask(openMask(mask)) : mask)

export interface MaskBlob {
  id: number
  area: number
  cx: number
  cy: number
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Connected components of a binary mask (4- or 8-neighbour), flood fill in scan order; `labels` = blob id + 1 per pixel (0 = background). */
export function labelBlobs(mask: Img, conn: 4 | 8 = 8) {
  const { w, h } = mask
  const labels = new Int32Array(w * h)
  const blobs: MaskBlob[] = []
  const DX = [1, -1, 0, 0, 1, -1, 1, -1]
  const DY = [0, 0, 1, -1, 1, 1, -1, -1]
  for (let s = 0; s < w * h; s++) {
    if (labels[s] || mask.data[s * mask.ch] <= 127) continue
    const b: MaskBlob = { id: blobs.length, area: 0, cx: 0, cy: 0, x0: w, y0: h, x1: -1, y1: -1 }
    const stack = [s]
    labels[s] = b.id + 1
    while (stack.length) {
      const k = stack.pop()!
      const x = k % w
      const y = (k - x) / w
      b.area++
      b.cx += x
      b.cy += y
      b.x0 = Math.min(b.x0, x)
      b.x1 = Math.max(b.x1, x)
      b.y0 = Math.min(b.y0, y)
      b.y1 = Math.max(b.y1, y)
      for (let d = 0; d < conn; d++) {
        const nx = x + DX[d]
        const ny = y + DY[d]
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const nk = ny * w + nx
        if (!labels[nk] && mask.data[nk * mask.ch] > 127) {
          labels[nk] = b.id + 1
          stack.push(nk)
        }
      }
    }
    b.cx /= b.area
    b.cy /= b.area
    blobs.push(b)
  }
  return { labels, blobs }
}

export const largestBlob = (blobs: readonly MaskBlob[], minArea = 1) => blobs.reduce<MaskBlob | null>((best, b) => (b.area >= minArea && (!best || b.area > best.area) ? b : best), null)

export interface BlobSpec {
  hue: number
  tol: number
  sMin: number
  vMin: number
  clean: Cleanup
  minArea: number
}
export const RED_BALL: BlobSpec = { hue: 0, tol: 20, sMin: 0.45, vMin: 0.15, clean: 'open', minArea: 4 }

/** HSV mask → clean-up → blobs → the largest one (null when none reaches `minArea`). */
export function findBlob(img: Img, s: BlobSpec) {
  const raw = hsvMask(img, s.hue, s.tol, s.sMin, s.vMin)
  const mask = cleanMask(raw, s.clean)
  const { labels, blobs } = labelBlobs(mask)
  return { raw, mask, labels, blobs, best: largestBlob(blobs, s.minArea) }
}

// --- A red ball in front of a wall and table, as a small camera frame ---

/** Window x0…x1, y0…y1 (default: all) of a w × h frame (2 × 2 supersampled) with a shaded red ball of radius `r` px centred at (bx, by) px; table grain `sigma`, draw `seed`. */
export function ballFrame(w: number, h: number, bx: number, by: number, r: number, sigma = 0, seed = 0, x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1): Img {
  const img = makeImg(x1 - x0 + 1, y1 - y0 + 1, 3)
  const back = backdrop(w, h)
  const d = img.data
  for (let y = y0, o = 0; y <= y1; y++)
    for (let x = x0; x <= x1; x++, o += 3) {
      const i = (y * w + x) * 3
      let k = 0
      let inside = 0
      if (Math.abs(x - bx) < r + 1 && Math.abs(y - by) < r + 1)
        for (let q = 0; q < 4; q++) {
          const dx = (x + (q % 2 ? 0.25 : -0.25) - bx) / r
          const dy = (y + (q > 1 ? 0.25 : -0.25) - by) / r
          const rr = dx * dx + dy * dy
          if (rr >= 1) continue
          k += 0.25 + 0.75 * Math.max(0, -0.45 * dx - 0.5 * dy + 0.74 * Math.sqrt(1 - rr))
          inside++
        }
      const out = (4 - inside) / 4
      for (let j = 0; j < 3; j++) d[o + j] = clamp((BALL_RGB[j] * k) / 4 + back[i + j] * out + (sigma ? sigma * grainAt(i + j, seed) : 0), 0, 255)
    }
  return img
}
const BALL_RGB = [210, 36, 30]

const backdrops = new Map<string, Float32Array>()
/** Grey wall over a wooden table (2 × 2 supersampled), cached per size. */
function backdrop(w: number, h: number) {
  const key = `${w}x${h}`
  const hit = backdrops.get(key)
  if (hit) return hit
  const data = new Float32Array(w * h * 3)
  const horizon = h * 0.55
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let q = 0; q < 4; q++) {
        const px = x + (q % 2 ? 0.25 : -0.25)
        const py = y + (q > 1 ? 0.25 : -0.25)
        const wall = py < horizon
        const k = wall ? 0.85 + (0.3 * py) / h : 0.9 + 0.1 * Math.sin(px * 1.3 + py * 0.4)
        const c = wall ? [80, 88, 104] : [172, 124, 80]
        for (let j = 0; j < 3; j++) data[(y * w + x) * 3 + j] += (c[j] * k) / 4
      }
  backdrops.set(key, data)
  return data
}

// --- Pan servo tracking: camera on an SG90, ball on a line in front, PD on the centroid error ---

export const PAN_CAM = { w: 48, h: 36, hfovDeg: 60, distM: 0.5, ballR: 0.05, limitDeg: 80, maxRate: 400, searchRate: 90, noise: 6, dt: 0.002, seconds: 6 }

/** Image column of a point `relDeg` left of the optical axis ((w − 1)/2 at 0, smaller x = further left). */
export const columnOf = (relDeg: number, c = PAN_CAM) => (c.w - 1) / 2 - focalPx(c.hfovDeg, c.w) * Math.tan((relDeg * Math.PI) / 180)

export type BallPath = 'step' | 'sweep' | 'dash'
/** Ball position across the line (m, + = left) at time t. */
function ballX(path: BallPath, t: number, c = PAN_CAM) {
  if (path === 'step') return t < 0.3 ? 0 : c.distM * Math.tan((25 * Math.PI) / 180)
  if (path === 'sweep') return 0.4 * Math.sin((2 * Math.PI * t) / 4)
  return clamp(-0.25 + 0.3 * Math.max(0, t - 0.5), -0.25, 0.5)
}

export interface PanCfg {
  kp: number
  kd: number
  fps: number
  filter: MeasFilter
  path: BallPath
}
export interface PanSample {
  t: number
  ballDeg: number
  panDeg: number
  cmdDeg: number
  seen: boolean
  /** Latest filtered centroid error (px, + = ball left of centre). */
  errPx: number
  rate: number
  frame: number
}
export interface PanFrame {
  t: number
  /** Ball centre and radius (px) and grain draw: `panFrameImg` renders the frame. */
  ball: [number, number, number]
  seed: number
  cx: number | null
  cy: number | null
  cxF: number | null
}

export const panFrameImg = (fr: PanFrame, c = PAN_CAM) => ballFrame(c.w, c.h, ...fr.ball, c.noise, fr.seed)

/** Blob search in a window 3 px around the ball (grain specks elsewhere never survive the opening); null when the ball is off the frame. */
function ballInView([bx, by, r]: PanFrame['ball'], seed: number, c = PAN_CAM) {
  const x0 = Math.max(0, Math.floor(bx - r - 4))
  const x1 = Math.min(c.w - 1, Math.ceil(bx + r + 4))
  const y0 = Math.max(0, Math.floor(by - r - 4))
  const y1 = Math.min(c.h - 1, Math.ceil(by + r + 4))
  if (x0 > x1 || y0 > y1) return null
  const best = findBlob(ballFrame(c.w, c.h, bx, by, r, c.noise, seed, x0, y0, x1, y1), RED_BALL).best
  return best && { cx: best.cx + x0, cy: best.cy + y0 }
}

/** Fixed-step run: the camera grabs a frame every 1/fps s, the result drives the servo one frame later (rate command = PD on the
 *  centroid error, integrated into the servo setpoint); the SG90 slews toward it with its own lag. Lost ball → turn toward where it was last seen. */
export function panTrackRun(cfg: PanCfg, c = PAN_CAM) {
  const f = focalPx(c.hfovDeg, c.w)
  const cx0 = (c.w - 1) / 2
  const period = 1 / cfg.fps
  const filt = filterRun(cfg.filter)
  const samples: PanSample[] = []
  const frames: PanFrame[] = []
  let mem = PID_MEM0
  let pan = 0
  let cmd = 0
  let rate = 0
  let pending: { cx: number | null } | null = null
  let errPx = 0
  let seen = false
  let searchDir = 0
  let nextGrab = 0
  const n = Math.round(c.seconds / c.dt)
  for (let k = 0; k <= n; k++) {
    const t = k * c.dt
    const ballDeg = (Math.atan2(ballX(cfg.path, t, c), c.distM) * 180) / Math.PI
    if (t >= nextGrab - 1e-9) {
      nextGrab += period
      if (pending) {
        if (pending.cx === null) {
          if (seen || !searchDir) searchDir = Math.sign(errPx)
          if (Math.abs(cmd) >= c.limitDeg - 1e-9 && Math.sign(cmd) === searchDir) searchDir = -searchDir
          seen = false
          rate = searchDir * c.searchRate
          mem = { ...mem, prevErr: NaN, prevMeas: NaN }
        } else {
          seen = true
          const cxF = filt(pending.cx)
          frames[frames.length - 1].cxF = cxF
          errPx = cx0 - cxF
          const r = pidTick(mem, cx0, cxF, { kp: cfg.kp, ki: 0, kd: cfg.kd, limit: c.maxRate }, period)
          mem = r.mem
          rate = r.terms.out
        }
      }
      cmd = clamp(cmd + rate * period, -c.limitDeg, c.limitDeg)
      const rel = ballDeg - pan
      const ball: PanFrame['ball'] = [columnOf(rel, c), c.h * 0.62, (f * c.ballR) / Math.hypot(c.distM, ballX(cfg.path, t, c))]
      const best = ballInView(ball, frames.length, c)
      frames.push({ t, ball, seed: frames.length, cx: best?.cx ?? null, cy: best?.cy ?? null, cxF: null })
      pending = { cx: best?.cx ?? null }
    }
    if (k % 5 === 0) samples.push({ t, ballDeg, panDeg: pan, cmdDeg: cmd, seen, errPx, rate, frame: frames.length - 1 })
    const want = (cmd - pan) / SG90_LOOP.tauS
    pan += clamp(want, -SG90_LOOP.degPerS, SG90_LOOP.degPerS) * c.dt
  }
  return { samples, frames, sampleDt: c.dt * 5 }
}

/** RMS and worst |ball − pan| (°) after `fromS`, and the time the ball was out of the mask. */
export function panStats(samples: readonly PanSample[], fromS = 1) {
  const tail = samples.filter((s) => s.t >= fromS)
  const errs = tail.map((s) => s.ballDeg - s.panDeg)
  const dt = samples.length > 1 ? samples[1].t - samples[0].t : 0
  return {
    rms: Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / Math.max(1, errs.length)),
    worst: Math.max(0, ...errs.map(Math.abs)),
    lostS: samples.filter((s) => !s.seen && s.t > 0.2).length * dt,
  }
}
