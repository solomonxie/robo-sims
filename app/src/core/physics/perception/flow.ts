// Optical flow on small grey images: brightness constancy, Lucas–Kanade on a window (structure tensor, aperture problem),
// block matching, a sparse grid field, and flow from a downward camera → ground speed (v = flow·h/f, gyro de-rotation) → position hold.
import { G, gaussAt } from '../common'
import { Img, grayImg, sampleImg } from './image'
import { eigen2 } from './features'
import { Plate } from './render'
import { trans4 } from '../kinematics/transforms'

export interface Derivs { w: number; h: number; gx: Float32Array; gy: Float32Array }

/** Central-difference gradient of the grey image (brightness per pixel). */
export function imgDerivs(img: Img): Derivs {
  const g = grayImg(img)
  const { w, h } = g
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  const at = (x: number, y: number) => g.data[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      gx[y * w + x] = (at(x + 1, y) - at(x - 1, y)) / 2
      gy[y * w + x] = (at(x, y + 1) - at(x, y - 1)) / 2
    }
  return { w, h, gx, gy }
}

/** Structure tensor [Σgx², Σgx·gy, Σgy²] over the (2r+1)² window at (x, y), and its eigenvalues per pixel. */
export function tensorAt(d: Derivs, x: number, y: number, r: number) {
  let [a, b, c, n] = [0, 0, 0, 0]
  for (let j = Math.max(0, y - r); j <= Math.min(d.h - 1, y + r); j++)
    for (let i = Math.max(0, x - r); i <= Math.min(d.w - 1, x + r); i++) {
      const [p, q] = [d.gx[j * d.w + i], d.gy[j * d.w + i]]
      a += p * p
      b += p * q
      c += q * q
      n++
    }
  const [l1, l2] = eigen2(a, b, c)
  return { a, b, c, n, l1: l1 / n, l2: Math.max(0, l2) / n }
}

/** Smallest eigenvalue (grey levels² per pixel) worth trusting. */
export const FLOW_MIN_EIG = 15
export type FlowKind = 'corner' | 'edge' | 'flat'
export interface FlowVec { x: number; y: number; u: number; v: number; kind: FlowKind; l1: number; l2: number; iters: number; err: number }

/** Window kind from the per-pixel eigenvalues: both big (and λ2 ≥ λ1/20) = corner, one = edge (aperture problem), none = flat. */
const flowKind = (l1: number, l2: number, minEig: number): FlowKind => (l2 >= minEig && l2 * 20 >= l1 ? 'corner' : l1 >= minEig ? 'edge' : 'flat')

/** Mean |b(x + u, y + v) − a(x, y)| over the window: brightness constancy says it is 0 at the true flow. */
export function flowResidual(a: Img, b: Img, x: number, y: number, r: number, u: number, v: number) {
  const [ga, gb] = [grayImg(a), grayImg(b)]
  let [s, n] = [0, 0]
  for (let j = Math.max(0, y - r); j <= Math.min(a.h - 1, y + r); j++)
    for (let i = Math.max(0, x - r); i <= Math.min(a.w - 1, x + r); i++) {
      s += Math.abs(sampleImg(gb, i + u, j + v) - ga.data[j * a.w + i])
      n++
    }
  return s / n
}

/** Iterative Lucas–Kanade at (x, y): solve [Σgx² Σgxgy; Σgxgy Σgy²]·d = −[Σgx·It, Σgy·It], warp, repeat.
 *  On an edge the tensor is rank 1: only the flow along the gradient (normal flow) is solved; flat windows return 0. */
export function lkAt(a: Img, b: Img, d: Derivs, x: number, y: number, r: number, { iters = 8, minEig = FLOW_MIN_EIG } = {}): FlowVec {
  const [ga, gb] = [grayImg(a), grayImg(b)]
  const T = tensorAt(d, x, y, r)
  const kind = flowKind(T.l1, T.l2, minEig)
  let [u, v, k] = [0, 0, 0]
  if (kind !== 'flat') {
    const det = T.a * T.c - T.b * T.b
    const e = Math.abs(T.b) < 1e-9 ? (T.a >= T.c ? [1, 0] : [0, 1]) : [T.b, T.l1 * T.n - T.a].map((q, _, m) => q / Math.hypot(m[0], m[1]))
    for (; k < iters; k++) {
      let [bx, by] = [0, 0]
      for (let j = Math.max(0, y - r); j <= Math.min(a.h - 1, y + r); j++)
        for (let i = Math.max(0, x - r); i <= Math.min(a.w - 1, x + r); i++) {
          const q = j * a.w + i
          const it = sampleImg(gb, i + u, j + v) - ga.data[q]
          bx += d.gx[q] * it
          by += d.gy[q] * it
        }
      let du: number
      let dv: number
      if (kind === 'corner') {
        du = -(T.c * bx - T.b * by) / det
        dv = -(T.a * by - T.b * bx) / det
      } else {
        const s = -(e[0] * bx + e[1] * by) / (T.l1 * T.n)
        ;[du, dv] = [s * e[0], s * e[1]]
      }
      const m = Math.hypot(du, dv)
      if (m > 1) [du, dv] = [du / m, dv / m]
      u += du
      v += dv
      if (Math.hypot(du, dv) < 0.01) {
        k++
        break
      }
    }
  }
  return { x, y, u, v, kind, l1: T.l1, l2: T.l2, iters: k, err: flowResidual(a, b, x, y, r, u, v) }
}

/** Block matching: the whole-pixel shift within ±maxD with the least sum of absolute differences. */
export function blockMatchAt(a: Img, b: Img, d: Derivs, x: number, y: number, r: number, maxD = 4, minEig = FLOW_MIN_EIG): FlowVec {
  const [ga, gb] = [grayImg(a), grayImg(b)]
  const T = tensorAt(d, x, y, r)
  let best = { u: 0, v: 0, sad: Infinity }
  for (let v = -maxD; v <= maxD; v++)
    for (let u = -maxD; u <= maxD; u++) {
      let sad = 0
      for (let j = y - r; j <= y + r; j++)
        for (let i = x - r; i <= x + r; i++) {
          const [cx, cy] = [Math.min(a.w - 1, Math.max(0, i)), Math.min(a.h - 1, Math.max(0, j))]
          const [bx, by] = [Math.min(a.w - 1, Math.max(0, i + u)), Math.min(a.h - 1, Math.max(0, j + v))]
          sad += Math.abs(gb.data[by * a.w + bx] - ga.data[cy * a.w + cx])
        }
      if (sad < best.sad - 1e-6 || (Math.abs(sad - best.sad) <= 1e-6 && Math.hypot(u, v) < Math.hypot(best.u, best.v))) best = { u, v, sad }
    }
  return { x, y, u: best.u, v: best.v, kind: flowKind(T.l1, T.l2, minEig), l1: T.l1, l2: T.l2, iters: (2 * maxD + 1) ** 2, err: best.sad / (2 * r + 1) ** 2 }
}

/** Sparse flow on a grid every `step` px (windows kept inside the image). */
export function flowField(a: Img, b: Img, step: number, r: number, method: 'lk' | 'block' = 'lk', minEig = FLOW_MIN_EIG): FlowVec[] {
  const d = imgDerivs(a)
  const out: FlowVec[] = []
  const m = r + 1
  for (let y = m; y < a.h - m; y += step)
    for (let x = m; x < a.w - m; x += step) out.push(method === 'lk' ? lkAt(a, b, d, x, y, r, { minEig }) : blockMatchAt(a, b, d, x, y, r, 4, minEig))
  return out
}

/** Per-axis median of the corner windows' flow (robust mean motion); [0, 0, 0] if none. */
export function medianFlow(f: readonly FlowVec[]): [number, number, number] {
  const ok = f.filter((v) => v.kind === 'corner')
  if (!ok.length) return [0, 0, 0]
  const med = (xs: number[]) => xs.sort((p, q) => p - q)[Math.floor(xs.length / 2)]
  return [med(ok.map((v) => v.u)), med(ok.map((v) => v.v)), ok.length]
}

// --- Downward camera: flow → ground speed ---

/** Flow rate (px/s) of the ground under a downward camera: f·(v/h − ω); ω = pitch rate, nose up > 0. */
export const flowRate = (v: number, h: number, f: number, omega = 0) => f * (v / h - omega)
/** Ground speed from flow: v = (flow/f + ω)·h; pass ω = 0 to skip gyro de-rotation. */
export const flowSpeed = (flow: number, h: number, f: number, omega = 0) => (flow / f + omega) * h

/** Textured carpet in world metres: overlapping sine blobs, plenty of corners at any scale. */
export function carpetColor(x: number, y: number): [number, number, number] {
  const s = Math.sin(x * 23 + 1.3 * Math.sin(y * 17)) + Math.sin(y * 29 - 0.7 * Math.cos(x * 13)) + 0.6 * Math.sin((x + y) * 51) + 0.5 * Math.sin((x - 2 * y) * 37)
  const t = Math.max(0, Math.min(1, 0.5 + s / 5.5))
  return [60 + 150 * t, 52 + 130 * t, 44 + 105 * t]
}
export const carpetPlate = (): Plate => ({ tf: trans4([0, 0, 0]), color: carpetColor })

// --- Flow position hold (1-D, along x): a quad tilts to fight wind, a downward flow sensor + range finder estimate its drift ---

export interface HoldCfg {
  /** Wind speed, m/s (the drag pulls the quad toward it). */
  wind: number
  /** Real height and the height the estimator uses, m. */
  h: number
  hUsed: number
  /** Add the gyro pitch rate back (de-rotation). */
  derotate: boolean
  /** Sensor focal length px, flow noise px/s. */
  f?: number
  noise?: number
  T?: number
  dt?: number
}
export interface HoldStep { t: number; x: number; v: number; pitch: number; rate: number; flow: number; vEst: number; xEst: number }

/** Fixed-step run: drag c·(wind − v), accel −g·tan(pitch), pitch lags its command (τ = 0.15 s); PID on the flow estimate. Wind starts at 1 s. */
export function flowHoldRun({ wind, h, hUsed, derotate, f = 42, noise = 4, T = 12, dt = 0.01 }: HoldCfg): HoldStep[] {
  const [c, tau, kp, kd, ki, lim] = [0.6, 0.15, 1.6, 2.2, 0.35, 0.35]
  let [x, v, pitch, xEst, ix, vEst] = [0, 0, 0, 0, 0, 0]
  const out: HoldStep[] = []
  for (let k = 0; k * dt <= T + 1e-9; k++) {
    const t = k * dt
    const aCmd = -kp * xEst - kd * vEst - ki * ix
    const rate = (Math.max(-lim, Math.min(lim, -aCmd / G)) - pitch) / tau
    const flow = flowRate(v, h, f, rate) + noise * gaussAt(k * 7 + 3)
    vEst = flowSpeed(flow, hUsed, f, derotate ? rate : 0)
    out.push({ t, x, v, pitch, rate, flow, vEst, xEst })
    const w = t >= 1 ? wind : 0
    const a = -G * Math.tan(pitch) + c * (w - v)
    pitch += rate * dt
    v += a * dt
    x += v * dt
    xEst += vEst * dt
    ix += xEst * dt
  }
  return out
}
