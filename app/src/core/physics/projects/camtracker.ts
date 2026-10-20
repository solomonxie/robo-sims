// Camera tracker: an ESP32-CAM on two SG90s (pan + tilt). What the rig can see (lens, frame size, horn fit, ball range)
// and the two-axis colour tracking loop (frame size → loop rate, error in degrees, dead zone vs 1° servo steps).
import { DEG, clamp } from '../common'
import { SG90_LOOP } from '../actuators/servo'
import { TOOTH_DEG } from '../kinematics/armbuild'
import { fovOfFocal, focalPx } from '../perception/projection'
import { Img } from '../perception/image'
import { RED_BALL, ballFrame, findBlob } from '../perception/tracking'
import { LENSES } from '../sensors/camera'

/** Kit pan-tilt bracket: pan travel, tilt travel (camera hits the pan bracket below −40°), 7 cm ball, table grain, ESP32 µs per pixel (RGB565 → HSV → mask). */
export const PT_RIG = { panDeg: [-90, 90] as const, tiltDeg: [-40, 80] as const, ballR: 0.035, noise: 6, usPerPx: 0.5, maxRate: 300 }
/** OV2640 frame sizes in RGB565, grab rate with two frame buffers. */
export const PT_FRAMES = {
  qqvga: { name: 'QQVGA 160 × 120', w: 160, h: 120, grabFps: 25 },
  qvga: { name: 'QVGA 320 × 240', w: 320, h: 240, grabFps: 20 },
  vga: { name: 'VGA 640 × 480', w: 640, h: 480, grabFps: 8 },
}
export type PtFrame = keyof typeof PT_FRAMES
export type PtLens = keyof typeof LENSES

/** Loop rate with grab and processing overlapped (fb_count = 2): the slower of the two sets it; a result is one grab + processing old. */
export function ptLoop(frame: PtFrame) {
  const f = PT_FRAMES[frame]
  const procMs = (f.w * f.h * PT_RIG.usPerPx) / 1000
  const fps = Math.min(f.grabFps, 1000 / procMs)
  return { procMs, fps, latencyMs: 1000 / f.grabFps + procMs }
}

export const ptFocal = (lens: PtLens, frame: PtFrame) => focalPx(LENSES[lens].fov, PT_FRAMES[frame].w)
/** Ball radius (px) at `distM`. */
export const ptBallPx = (lens: PtLens, frame: PtFrame, distM: number) => (ptFocal(lens, frame) * PT_RIG.ballR) / distM

/** Horizontal and vertical field of view, pan/tilt travel (horn `teeth` off centre shifts the pan range) and what the camera can see edge to edge. */
export function ptCoverage(lens: PtLens, frame: PtFrame, teeth = 0) {
  const hfov = LENSES[lens].fov
  const vfov = fovOfFocal(ptFocal(lens, frame), PT_FRAMES[frame].h)
  const off = teeth * TOOTH_DEG
  const pan: [number, number] = [PT_RIG.panDeg[0] + off, PT_RIG.panDeg[1] + off]
  const tilt: [number, number] = [PT_RIG.tiltDeg[0], PT_RIG.tiltDeg[1]]
  return { hfov, vfov, pan, tilt, see: { right: pan[0] - hfov / 2, left: pan[1] + hfov / 2, down: tilt[0] - vfov / 2, up: tilt[1] + vfov / 2 } }
}

export const PT_CROP = { w: 48, h: 36 }
/** Native-pixel crop round the image centre with the ball `distM` away, `offPx` right of centre; the blob found in it (crop px). */
export function ptView(lens: PtLens, frame: PtFrame, distM: number, offPx = 0, seed = 0) {
  const { w, h } = PT_FRAMES[frame]
  const r = ptBallPx(lens, frame, distM)
  const x0 = Math.round(w / 2 - PT_CROP.w / 2)
  const y0 = Math.round(h / 2 - PT_CROP.h / 2)
  const img = ballFrame(w, h, (w - 1) / 2 + offPx, (h - 1) / 2, r, PT_RIG.noise, seed, x0, y0, x0 + PT_CROP.w - 1, y0 + PT_CROP.h - 1)
  return { img, r, best: findBlob(img, RED_BALL).best }
}

/** Furthest distance (m) the cleaned mask still keeps the ball (bisection on `ptView`). */
export function ptRange(lens: PtLens, frame: PtFrame) {
  let lo = 0.1
  let hi = 40
  for (let i = 0; i < 28; i++) {
    const mid = Math.sqrt(lo * hi)
    if (ptView(lens, frame, mid).best) lo = mid
    else hi = mid
  }
  return lo
}

// --- Two-axis tracking: ball on a wall 1 m away, both servos driven from the blob centroid ---

export const PT_TRACK = { distM: 1, dt: 0.002, seconds: 6, lens: 'stock' as PtLens }
export type PtPath = 'hover' | 'circle' | 'toss'
export const PT_PATHS: Record<PtPath, string> = { hover: 'Ball hops, then sits still', circle: 'Ball circles', toss: 'Ball tossed side to side' }

/** Ball on the wall (m, x left, y up) at time t. */
export function ptBallAt(path: PtPath, t: number): [number, number] {
  if (path === 'hover') return t < 0.3 ? [0, 0] : [0.18, 0.08]
  if (path === 'circle') return [0.3 * Math.sin((2 * Math.PI * t) / 3), 0.2 * Math.cos((2 * Math.PI * t) / 3)]
  const ph = (t / 1.6) % 2
  const u = ph < 1 ? ph : 2 - ph
  return [-0.45 + 0.9 * u, -0.15 + 1.6 * u * (1 - u)]
}
/** Pan (+ left) and tilt (+ up) that aim straight at a wall point. */
export const ptAim = ([x, y]: readonly number[], d = PT_TRACK.distM): [number, number] => [Math.atan2(x, d) / DEG, Math.atan2(y, Math.hypot(x, d)) / DEG]

/** A wall point in camera axes for pan/tilt (°): [left, up, forward]. */
export function ptInCamera([x, y]: readonly number[], panDeg: number, tiltDeg: number, d = PT_TRACK.distM): [number, number, number] {
  const p = panDeg * DEG
  const q = tiltDeg * DEG
  const left = x * Math.cos(p) - d * Math.sin(p)
  const z1 = x * Math.sin(p) + d * Math.cos(p)
  return [left, y * Math.cos(q) - z1 * Math.sin(q), y * Math.sin(q) + z1 * Math.cos(q)]
}

/** Where a camera ray (left, up, 1 in camera axes) meets the wall, for pan/tilt (°); null if it points away. */
export function ptRayToWall(panDeg: number, tiltDeg: number, left: number, up: number, d = PT_TRACK.distM): [number, number] | null {
  const p = panDeg * DEG
  const q = tiltDeg * DEG
  const y = up * Math.cos(q) + Math.sin(q)
  const z1 = -up * Math.sin(q) + Math.cos(q)
  const x = left * Math.cos(p) + z1 * Math.sin(p)
  const z = -left * Math.sin(p) + z1 * Math.cos(p)
  return z > 1e-9 ? [(x * d) / z, (y * d) / z] : null
}

interface PtCfg {
  frame: PtFrame
  kp: number
  deadDeg: number
  path: PtPath
}
export interface PtSample {
  t: number
  ball: [number, number]
  pan: number
  tilt: number
  cmd: [number, number]
  seen: boolean
  /** Latest measured error (°, + = ball left / up). */
  err: [number, number]
  frame: number
}
interface PtShot {
  t: number
  /** Ball centre and radius (px) in the full frame. */
  ball: [number, number, number]
  seed: number
  cx: number | null
  cy: number | null
}

/** Blob search in a window round the ball; null when the ball is off the frame or behind the camera. */
function ptSeen([bx, by, r]: PtShot['ball'], seed: number, w: number, h: number) {
  const x0 = Math.max(0, Math.floor(bx - r - 4))
  const x1 = Math.min(w - 1, Math.ceil(bx + r + 4))
  const y0 = Math.max(0, Math.floor(by - r - 4))
  const y1 = Math.min(h - 1, Math.ceil(by + r + 4))
  if (!(r > 0) || x0 > x1 || y0 > y1) return null
  const best = findBlob(ballFrame(w, h, bx, by, r, PT_RIG.noise, seed, x0, y0, x1, y1), RED_BALL).best
  return best && { cx: best.cx + x0, cy: best.cy + y0 }
}

/** Fixed-step run: a frame every 1/fps s, its result arrives one latency later; error in degrees (atan of centroid offset / f),
 *  inside ±dead → no change, else rate = Kp·e per axis, integrated into a setpoint written to each SG90 as whole degrees. Lost ball → hold. */
export function ptTrackRun(cfg: PtCfg, c = PT_TRACK) {
  const { w, h } = PT_FRAMES[cfg.frame]
  const f = focalPx(LENSES[c.lens].fov, w)
  const cx0 = (w - 1) / 2
  const cy0 = (h - 1) / 2
  const loop = ptLoop(cfg.frame)
  const period = 1 / loop.fps
  const late = loop.latencyMs / 1000
  const samples: PtSample[] = []
  const shots: PtShot[] = []
  const queue: { due: number; hit: { cx: number; cy: number } | null }[] = []
  const cmd: [number, number] = [0, 0]
  const pos: [number, number] = [0, 0]
  const lim = [PT_RIG.panDeg, PT_RIG.tiltDeg]
  let err: [number, number] = [0, 0]
  let seen = false
  let nextGrab = 0
  let steps = 0
  let lastWrite: [number, number] = [0, 0]
  const writes: number[] = []
  const n = Math.round(c.seconds / c.dt)
  for (let k = 0; k <= n; k++) {
    const t = k * c.dt
    const ball = ptBallAt(cfg.path, t)
    while (queue.length && queue[0].due <= t + 1e-9) {
      const { hit } = queue.shift()!
      seen = !!hit
      if (hit) {
        err = [Math.atan((cx0 - hit.cx) / f) / DEG, Math.atan((cy0 - hit.cy) / f) / DEG]
        for (let a = 0; a < 2; a++) if (Math.abs(err[a]) > cfg.deadDeg) cmd[a] = clamp(cmd[a] + clamp(cfg.kp * err[a], -PT_RIG.maxRate, PT_RIG.maxRate) * period, lim[a][0], lim[a][1])
      }
      const write: [number, number] = [Math.round(cmd[0]), Math.round(cmd[1])]
      if (write[0] !== lastWrite[0] || write[1] !== lastWrite[1]) {
        steps += Math.abs(write[0] - lastWrite[0]) + Math.abs(write[1] - lastWrite[1])
        writes.push(t)
      }
      lastWrite = write
    }
    if (t >= nextGrab - 1e-9) {
      nextGrab += period
      const [l, u, z] = ptInCamera(ball, pos[0], pos[1], c.distM)
      const shot: PtShot['ball'] = z > 0 ? [cx0 - (f * l) / z, cy0 - (f * u) / z, (f * PT_RIG.ballR) / Math.hypot(l, u, z)] : [-1e3, -1e3, 0]
      const hit = ptSeen(shot, shots.length, w, h)
      shots.push({ t, ball: shot, seed: shots.length, cx: hit?.cx ?? null, cy: hit?.cy ?? null })
      queue.push({ due: t + late, hit })
    }
    if (k % 5 === 0) samples.push({ t, ball: ptAim(ball, c.distM), pan: pos[0], tilt: pos[1], cmd: [...lastWrite], seen, err: [...err], frame: shots.length - 1 })
    for (let a = 0; a < 2; a++) pos[a] += clamp((lastWrite[a] - pos[a]) / SG90_LOOP.tauS, -SG90_LOOP.degPerS, SG90_LOOP.degPerS) * c.dt
  }
  return { samples, shots, sampleDt: c.dt * 5, fps: loop.fps, latencyMs: loop.latencyMs, writes, steps, w, h }
}

/** Re-render the middle 1/zoom of a shot at display size (dw × dh px, same aspect as the frame). */
export const ptShotImg = (s: PtShot, w: number, dw: number, dh: number, zoom = 1): Img => {
  const k = (dw * zoom) / w
  const [x, y] = ptShotPx(s.ball[0], s.ball[1], w, dw, dh, zoom)
  return ballFrame(dw, dh, x, y, s.ball[2] * k, PT_RIG.noise, s.seed)
}
/** Frame pixel → display pixel for `ptShotImg`. */
export const ptShotPx = (x: number, y: number, w: number, dw: number, dh: number, zoom = 1): [number, number] => {
  const k = (dw * zoom) / w
  const h = (w * dh) / dw
  return [(x - (w - 1) / 2) * k + (dw - 1) / 2, (y - (h - 1) / 2) * k + (dh - 1) / 2]
}

/** RMS and worst aim miss (° between the camera axis and the ball) after `fromS`, time lost, and servo write changes per second after `fromS`. */
export function ptStats(run: ReturnType<typeof ptTrackRun>, fromS = 1) {
  const tail = run.samples.filter((s) => s.t >= fromS)
  const miss = tail.map((s) => Math.hypot(s.ball[0] - s.pan, s.ball[1] - s.tilt))
  const span = Math.max(1e-9, run.samples[run.samples.length - 1].t - fromS)
  return {
    rms: Math.sqrt(miss.reduce((a, e) => a + e * e, 0) / Math.max(1, miss.length)),
    worst: Math.max(0, ...miss),
    lostS: run.samples.filter((s) => !s.seen && s.t > 0.5).length * run.sampleDt,
    writesPerS: run.writes.filter((t) => t >= fromS).length / span,
  }
}
