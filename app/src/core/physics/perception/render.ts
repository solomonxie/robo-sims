// A tiny ray-cast renderer: checker floor, balls, blocks, a checkerboard, painted plates and a wall, seen through any camera.
import { clamp, hash01 } from '../common'
import { P3 } from '../room'
import { Mat4, apply4, invert4 } from '../software/urdf'
import { Img, makeImg } from './image'
import { Intrinsics, Lens, NO_LENS, Ray, pixelRay, rayAt } from './projection'

type Rgb = [number, number, number]

/** The grey checker floor most camera lessons stand on (renderer colours; `fx.checkerTiles` builds it in 3D). */
export const CHECKER_FLOOR = { tile: 0.25, a: [118, 112, 100] as Rgb, b: [70, 74, 82] as Rgb }

export interface Ball { c: P3; r: number; rgb: Rgb; speckle?: number }
export interface Board { tf: Mat4; nx: number; ny: number; sq: number }
/** Any flat print: `color(x, y)` in plate coords (z = 0 plane of `tf`, world ← plate), null where there is no plate. */
export interface Plate { tf: Mat4; color: (x: number, y: number) => Rgb | null }
/** Axis-aligned solid block, one flat colour (lit per face). */
export interface RenderBlock { min: P3; max: P3; rgb: Rgb }
export interface RenderScene { floor?: { tile: number; a: Rgb; b: Rgb; x?: [number, number]; y?: [number, number]; off?: Rgb }; balls?: Ball[]; blocks?: RenderBlock[]; board?: Board; plates?: Plate[]; wallX?: number; sky?: Rgb; light?: P3 }
/** What a ray hits: colour and distance along the (unit) ray, Infinity for sky. */
export interface Hit { rgb: Rgb; t: number }

const LIGHT: P3 = (() => {
  const l = [0.35, 0.45, 0.82]
  const n = Math.hypot(...l)
  return l.map((x) => x / n) as P3
})()
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k]

/** Repeatable two-scale dot texture (0.45…1) at unit direction `n`, `cells` around the equator: gives block matching something to lock onto. */
function speckleAt(n: readonly number[], cells: number) {
  const lon = (Math.atan2(n[1], n[0]) / (2 * Math.PI) + 0.5) * cells
  const lat = (Math.asin(clamp(n[2], -1, 1)) / Math.PI + 0.5) * cells * 0.5
  const fine = hash01(Math.floor(lon) * 7919 + Math.floor(lat) * 104729)
  const coarse = hash01(Math.floor(lon / 4) * 15485863 + Math.floor(lat / 4) * 32452843 + 17)
  return 0.45 + 0.3 * fine + 0.25 * coarse
}

/** Board-plane colour at board coords (x, y): black/white squares with a one-square white margin, null off the board. */
export function boardColor(b: Board, x: number, y: number): Rgb | null {
  const hx = ((b.nx + 1) / 2 + 1) * b.sq
  const hy = ((b.ny + 1) / 2 + 1) * b.sq
  if (Math.abs(x) > hx || Math.abs(y) > hy) return null
  const ix = Math.floor(x / b.sq + (b.nx + 1) / 2)
  const iy = Math.floor(y / b.sq + (b.ny + 1) / 2)
  const inside = ix >= 0 && ix <= b.nx && iy >= 0 && iy <= b.ny
  return inside && (ix + iy) % 2 === 0 ? [28, 30, 36] : [236, 236, 230]
}

function hitScene(s: RenderScene, r: Ray, boardInv: Mat4 | null, plateInv: Mat4[] = []): Hit {
  let best = Infinity
  let col: Rgb = s.sky ?? [70, 80, 96]
  const light = s.light ?? LIGHT
  for (const b of s.blocks ?? []) {
    let [t0, t1, axis] = [-Infinity, Infinity, 0]
    for (let i = 0; i < 3; i++) {
      if (Math.abs(r.d[i]) < 1e-12) {
        if (r.o[i] < b.min[i] || r.o[i] > b.max[i]) t0 = Infinity
        continue
      }
      const [a, c] = [(b.min[i] - r.o[i]) / r.d[i], (b.max[i] - r.o[i]) / r.d[i]]
      if (Math.min(a, c) > t0) [t0, axis] = [Math.min(a, c), i]
      t1 = Math.min(t1, Math.max(a, c))
    }
    if (t0 > t1 || t0 <= 1e-6 || t0 >= best) continue
    best = t0
    const nrm = [0, 0, 0]
    nrm[axis] = -Math.sign(r.d[axis])
    col = shade(b.rgb, 0.35 + 0.65 * Math.max(0, dot(nrm, light)))
  }
  for (const b of s.balls ?? []) {
    const oc = [r.o[0] - b.c[0], r.o[1] - b.c[1], r.o[2] - b.c[2]]
    const hb = dot(oc, r.d)
    const disc = hb * hb - (dot(oc, oc) - b.r * b.r)
    if (disc < 0) continue
    const t = -hb - Math.sqrt(disc)
    if (t <= 1e-6 || t >= best) continue
    best = t
    const p = rayAt(r, t)
    const nrm = [(p[0] - b.c[0]) / b.r, (p[1] - b.c[1]) / b.r, (p[2] - b.c[2]) / b.r]
    col = shade(b.rgb, (0.35 + 0.65 * Math.max(0, dot(nrm, light))) * (b.speckle ? speckleAt(nrm, b.speckle) : 1))
  }
  const flat = (inv: Mat4, paint: (x: number, y: number) => Rgb | null) => {
    const o = apply4(inv, r.o)
    const d = [0, 1, 2].map((i) => inv[i * 4] * r.d[0] + inv[i * 4 + 1] * r.d[1] + inv[i * 4 + 2] * r.d[2])
    if (Math.abs(d[2]) <= 1e-9) return
    const t = -o[2] / d[2]
    const c = t > 1e-6 && t < best ? paint(o[0] + d[0] * t, o[1] + d[1] * t) : null
    if (c) {
      best = t
      col = c
    }
  }
  const board = s.board
  if (board && boardInv) flat(boardInv, (x, y) => boardColor(board, x, y))
  s.plates?.forEach((p, i) => flat(plateInv[i], p.color))
  if (s.wallX !== undefined && r.d[0] > 1e-9) {
    const t = (s.wallX - r.o[0]) / r.d[0]
    const p = rayAt(r, t)
    if (t < best && p[2] >= 0) {
      best = t
      const brick = (Math.floor(p[2] / 0.08) % 2 ? 0.5 : 0) + p[1] / 0.2
      col = (Math.floor(p[2] / 0.08) + Math.floor(brick)) % 7 === 0 ? [150, 120, 92] : (Math.floor(brick) % 3 === 0 ? [168, 160, 146] : [188, 182, 168])
    }
  }
  if (s.floor && r.d[2] < -1e-9) {
    const t = -r.o[2] / r.d[2]
    if (t < best) {
      const p = rayAt(r, t)
      const f = s.floor
      const out = (f.x && (p[0] < f.x[0] || p[0] > f.x[1])) || (f.y && (p[1] < f.y[0] || p[1] > f.y[1]))
      const odd = (Math.floor(p[0] / f.tile) + Math.floor(p[1] / f.tile)) % 2 !== 0
      col = out ? (f.off ?? [30, 32, 38]) : shade(odd ? f.b : f.a, 1 / (1 + 0.04 * t))
      best = t
    }
  }
  return { rgb: col, t: best }
}

/** Ray caster for scene `s` (inverses cached): pixelRay in, `Hit` out. */
export function sceneCaster(s: RenderScene) {
  const boardInv = s.board ? invert4(s.board.tf) : null
  const plateInv = (s.plates ?? []).map((p) => invert4(p.tf))
  return (r: Ray) => hitScene(s, r, boardInv, plateInv)
}

/** Renders `s` as camera `k` at `Twc` sees it through `lens` on an `outW` × `outH` grid, `aa` × `aa` samples averaged per cell. */
export function renderView(k: Intrinsics, Twc: Mat4, s: RenderScene, outW = k.w, outH = k.h, lens: Lens = NO_LENS, aa = 1): Img {
  const img = makeImg(outW, outH, 3)
  const cast = sceneCaster(s)
  for (let y = 0; y < outH; y++)
    for (let x = 0; x < outW; x++) {
      const i = (y * outW + x) * 3
      for (let sy = 0; sy < aa; sy++)
        for (let sx = 0; sx < aa; sx++) {
          const c = cast(pixelRay(k, Twc, ((x + (sx + 0.5) / aa) * k.w) / outW - 0.5, ((y + (sy + 0.5) / aa) * k.h) / outH - 0.5, lens)).rgb
          for (let ch = 0; ch < 3; ch++) img.data[i + ch] += clamp(c[ch], 0, 255) / (aa * aa)
        }
    }
  return img
}
