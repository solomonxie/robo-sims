// Camera: pinhole projection, rolling vs global shutter readout, exposure (signal, shot + read noise, gain, clipping), radial lens distortion.
import { gaussAt } from '../mcu/adc'

const DEG = Math.PI / 180

/** OV2640 (ESP32-CAM): 2.2 µm pixels, 1600 × 1200; SVGA mode 800 × 600 at 30 fps with 672 line times per frame. */
export const OV2640 = {
  name: 'OV2640',
  w: 1600,
  h: 1200,
  pixelUm: 2.2,
  focalMm: 3.4,
  svga: { w: 800, h: 600, lines: 672, fps: 30 },
  fullWell: 6000,
  readNoise: 6,
  bits: 8,
}

/** Pinhole: a point (x right, y up, z forward, any unit) lands at f·x/z, f·y/z on the sensor. */
export const project = ([x, y, z]: readonly number[], f: number): [number, number] => [(f * x) / z, (f * y) / z]

/** Full field of view (°) of a sensor side `sizeMm` behind a lens of focal length `focalMm`. */
export const fovDeg = (sizeMm: number, focalMm: number) => (2 * Math.atan(sizeMm / 2 / focalMm)) / DEG

/** Sensor side (mm) from pixel count and pitch. */
export const sensorMm = (px: number, pitchUm = OV2640.pixelUm) => (px * pitchUm) / 1000

// --- Shutter ---

/** One line time (s): the frame period split over every line, blanking included. */
export const lineTime = (fps: number, lines: number) => 1 / (fps * lines)

/** When row `row` is sampled after the frame starts (s): rolling = row × line time, global = all at 0. */
export const rowTime = (row: number, line: number, global: boolean) => (global ? 0 : row * line)

/** Degrees a propeller at `rpm` turns in `s` seconds. */
export const turnDeg = (rpm: number, s: number) => (rpm / 60) * 360 * s

/** Blade index (0…blades−1) covering point (x, y) of a propeller of unit radius turned `angle` rad, or −1. Blades taper toward the tip. */
export function propellerAt(x: number, y: number, angle: number, blades = 3, hub = 0.14) {
  const r = Math.hypot(x, y)
  if (r > 1) return -1
  if (r < hub) return 0
  const half = 0.34 - 0.2 * r
  const a = Math.atan2(y, x) - angle
  for (let b = 0; b < blades; b++) {
    const d = a - (b * 2 * Math.PI) / blades
    const w = Math.atan2(Math.sin(d), Math.cos(d))
    if (Math.abs(w) < half) return b
  }
  return -1
}

// --- Exposure ---

/** Electrons per lux·s on one 2.2 µm pixel at f/2, 50 % grey scene, QE 0.5: 4.1e15 photons/(lm·s) × E/(4N²) × area × QE. */
export const E_PER_LUX_S = 4.1e15 * (0.5 / 16) * (OV2640.pixelUm * 1e-6) ** 2 * 0.5

/** Photo-electrons collected (capped at the full well): ∝ scene lux × exposure time / f-number². */
export const signalE = (lux: number, tS: number, fNum: number) => Math.min(OV2640.fullWell, (E_PER_LUX_S * lux * tS * 4) / (fNum * fNum))

/** Noise (e⁻ rms): shot noise √signal and read noise, in quadrature. */
export const noiseE = (e: number, read = OV2640.readNoise) => Math.sqrt(e + read * read)

/** Signal to noise ratio (dB); gain scales both, so it can't change this. */
export const snrDb = (e: number) => 20 * Math.log10(Math.max(1e-9, e) / noiseE(e))

/** 8-bit pixel value from `e` electrons at analog `gain` (1× maps the full well to 255), with noise draw `k` (null = noiseless). */
export function pixelDn(e: number, gain: number, k: number | null = null) {
  const full = 2 ** OV2640.bits - 1
  const x = k === null ? e : e + noiseE(e) * gaussAt(k)
  return Math.min(full, Math.max(0, Math.round((x * gain * full) / OV2640.fullWell)))
}

/** Motion blur (px) of something moving `pxPerS` across the image while the shutter is open `tS`. */
export const blurPx = (pxPerS: number, tS: number) => pxPerS * tS

/** Counts of `values` (0…max) in `bins` equal bins. */
export function histogram(values: readonly number[], bins: number, max = 255) {
  const h = new Array<number>(bins).fill(0)
  for (const v of values) h[Math.min(bins - 1, Math.max(0, Math.floor((v / (max + 1)) * bins)))]++
  return h
}

/** Fractions of `values` crushed to 0 and clipped at `max`. */
export function clipShares(values: readonly number[], max = 255) {
  let lo = 0
  let hi = 0
  for (const v of values) {
    if (v <= 0) lo++
    else if (v >= max) hi++
  }
  return { low: lo / (values.length || 1), high: hi / (values.length || 1) }
}

// --- Lens distortion (Brown radial model, normalized image coords) ---

/** Radial scale 1 + k1·r² + k2·r⁴ at undistorted radius `r`. */
export const radialScale = (r: number, k1: number, k2: number) => 1 + k1 * r * r + k2 * r ** 4

/** Ideal (pinhole) point → where the lens puts it: barrel when k1 < 0, pincushion when k1 > 0. */
export function distort([x, y]: readonly number[], k1: number, k2: number): [number, number] {
  const s = radialScale(Math.hypot(x, y), k1, k2)
  return [x * s, y * s]
}

/** Inverse of `distort` by Newton on the radius: the undistorted point that lands at (x, y). */
export function undistort([x, y]: readonly number[], k1: number, k2: number): [number, number] {
  const rd = Math.hypot(x, y)
  if (rd === 0) return [0, 0]
  let r = rd
  for (let i = 0; i < 20; i++) {
    const f = r * radialScale(r, k1, k2) - rd
    const df = 1 + 3 * k1 * r * r + 5 * k2 * r ** 4
    r = Math.max(0, r - f / Math.max(0.05, df))
    if (Math.abs(f) < 1e-10) break
  }
  return [(x * r) / rd, (y * r) / rd]
}

/** Lenses for the OV2640, k1/k2 in image coords where the sensor corner is r = 1. */
export const LENSES = {
  stock: { name: 'Stock 66° lens', fov: 66, k1: -0.06, k2: 0.01 },
  wide: { name: 'Wide 120° lens', fov: 120, k1: -0.3, k2: 0.08 },
  tele: { name: 'Pincushion lens', fov: 40, k1: 0.14, k2: 0 },
}
