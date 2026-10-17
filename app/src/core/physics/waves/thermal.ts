// Thermal radiation: Planck spectrum, Wien peak, Stefan–Boltzmann, emissivity, and a thermopile-array camera looking at a desk. SI units, temperatures in °C at the API.
import { LIGHT_C } from '../common'

const H = 6.62607015e-34
const KB = 1.380649e-23
const SIGMA_SB = 5.670374419e-8
const WIEN_B = 2.897771955e-3
export const kelvinOf = (c: number) => c + 273.15
const celsiusOf = (k: number) => k - 273.15

/** Black-body spectral exitance at `lambdaM` (m), W/(m²·µm). */
export function planckExitance(lambdaM: number, tK: number) {
  const x = (H * LIGHT_C) / (lambdaM * KB * tK)
  if (x > 700) return 0
  return ((2 * Math.PI * H * LIGHT_C * LIGHT_C) / lambdaM ** 5 / Math.expm1(x)) * 1e-6
}

export const wienPeakM = (tK: number) => WIEN_B / tK
/** Total exitance εσT⁴, W/m². */
export const exitance = (tK: number, eps = 1) => eps * SIGMA_SB * tK ** 4
/** Net power a surface of `areaM2` radiates into surroundings at `ambC` (absorbs as much as it emits: ε both ways). */
export const netRadiatedW = (tC: number, eps: number, ambC: number, areaM2: number) => eps * SIGMA_SB * (kelvinOf(tC) ** 4 - kelvinOf(ambC) ** 4) * areaM2

/** Share of black-body power between `lo` and `hi` (m), integrated in log λ. */
export function bandShare(tK: number, lo: number, hi: number, steps = 200) {
  const a = Math.log(lo)
  const h = (Math.log(hi) - a) / steps
  let sum = 0
  for (let i = 0; i < steps; i++) {
    const l = Math.exp(a + (i + 0.5) * h)
    sum += planckExitance(l, tK) * 1e6 * l * h
  }
  return sum / exitance(tK)
}

/** Wavelength bands each detector responds to, m. */
export const SENSOR_BANDS = {
  eye: { name: 'Eye', lo: 0.38e-6, hi: 0.75e-6 },
  silicon: { name: 'Phone camera, IR LEDs', lo: 0.4e-6, hi: 1.1e-6 },
  thermal: { name: 'Thermopile', lo: 8e-6, hi: 14e-6 },
} as const

/** Emissivity in the thermal IR. */
export const EMISSIVITY = {
  skin: { name: 'Skin', eps: 0.98 },
  paint: { name: 'Matte black paint', eps: 0.95 },
  tape: { name: 'Electrical tape', eps: 0.95 },
  anodised: { name: 'Anodised aluminium', eps: 0.8 },
  aluminium: { name: 'Bare aluminium', eps: 0.09 },
  copper: { name: 'Polished copper', eps: 0.03 },
} as const
export type EmitSurface = keyof typeof EMISSIVITY

/** Radiance-equivalent σT⁴ leaving a surface: its own emission plus reflected surroundings. */
export const leaving = (tC: number, eps: number, ambC: number) => eps * SIGMA_SB * kelvinOf(tC) ** 4 + (1 - eps) * SIGMA_SB * kelvinOf(ambC) ** 4

/** Temperature a radiometer set to `epsSet` shows for radiance `L` with the room at `ambC`. */
const readC = (L: number, ambC: number, epsSet = 0.95) =>
  celsiusOf(Math.max(0, (L - (1 - epsSet) * SIGMA_SB * kelvinOf(ambC) ** 4) / (epsSet * SIGMA_SB)) ** 0.25)

/** What a thermometer gun / thermal camera set to ε = `epsSet` reads off a surface at `tC` with emissivity `eps`. */
export const apparentC = (tC: number, eps: number, ambC = 22, epsSet = 0.95) => readC(leaving(tC, eps, ambC), ambC, epsSet)

// --- Thermal camera: a thermopile array; each pixel averages the radiance over its footprint, then converts to °C. ---

export const THERMAL_CAMS = {
  amg8833: { name: 'AMG8833 8×8', cols: 8, rows: 8, hfov: 60, vfov: 60 },
  mlx90640: { name: 'MLX90640 32×24', cols: 32, rows: 24, hfov: 55, vfov: 35 },
  lepton: { name: 'Lepton 80×60', cols: 80, rows: 60, hfov: 51, vfov: 38 },
} as const
export type ThermalCam = keyof typeof THERMAL_CAMS

/** Flat object in the scene plane (m, y up); `on` = index of the object it sits in front of (null: the wall). */
export type HeatBlob = { name: string; shape: 'rect' | 'ellipse'; x: number; y: number; w: number; h: number; c: number; eps: number; on: number | null }
export const DESK_ROOM_C = 22
export const DESK_TOP = -0.25
/** Where the camera points: the middle of the desk scene. */
export const DESK_AIM = [0, -0.06] as const
const blob = (name: string, shape: HeatBlob['shape'], x: number, y: number, w: number, h: number, c: number, eps: number, on: number | null = null): HeatBlob => ({ name, shape, x, y, w, h, c, eps, on })

/** Desk scene: a person, a warm motor (finish set by the caller), a board with a small hot regulator, a cold drink. */
export function deskScene(motorEps: number): HeatBlob[] {
  return [
    blob('desk', 'rect', 0, DESK_TOP - 5, 20, 10, 24, 0.9),
    blob('shirt', 'rect', -0.27, -0.16, 0.36, 0.18, 30, 0.95),
    blob('neck', 'rect', -0.27, -0.045, 0.06, 0.05, 34, 0.98),
    blob('face', 'ellipse', -0.27, 0.08, 0.15, 0.2, 34, 0.98),
    blob('motor', 'rect', -0.02, -0.205, 0.06, 0.09, 65, motorEps),
    blob('board', 'rect', 0.14, -0.2, 0.07, 0.1, 30, 0.9),
    blob('regulator', 'rect', 0.14, -0.18, 0.012, 0.012, 90, 0.9, 5),
    blob('drink', 'rect', 0.3, -0.19, 0.066, 0.12, 6, 0.9),
  ]
}

type Box = { x0: number; x1: number; y0: number; y1: number; dL: number }
/** Each blob as boxes (ellipses as 24 strips) carrying its radiance step over what is behind it. */
function sceneBoxes(scene: HeatBlob[], ambC: number) {
  const wallL = leaving(ambC, 0.95, ambC)
  const L = scene.map((b) => leaving(b.c, b.eps, ambC))
  const boxes: Box[] = []
  scene.forEach((b, i) => {
    const dL = L[i] - (b.on === null ? wallL : L[b.on])
    if (b.shape === 'rect') boxes.push({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y - b.h / 2, y1: b.y + b.h / 2, dL })
    else
      for (let k = 0, S = 24; k < S; k++) {
        const v = -1 + (2 * (k + 0.5)) / S
        const hw = (b.w / 2) * Math.sqrt(1 - v * v)
        boxes.push({ x0: b.x - hw, x1: b.x + hw, y0: b.y - b.h / 2 + (k * b.h) / S, y1: b.y - b.h / 2 + ((k + 1) * b.h) / S, dL })
      }
  })
  return { wallL, boxes }
}

/** Pixel footprint (m) at distance `d`. */
export function pixelFootprint(cam: ThermalCam, d: number) {
  const c = THERMAL_CAMS[cam]
  const w = 2 * d * Math.tan((c.hfov * Math.PI) / 360)
  const h = 2 * d * Math.tan((c.vfov * Math.PI) / 360)
  return { w, h, px: w / c.cols, py: h / c.rows }
}

/** Thermal image (row 0 on top, °C as the camera reports with ε set to `epsSet`) of `scene` from `d` m, aimed at `aim`. */
export function thermalImage(cam: ThermalCam, d: number, scene: HeatBlob[], { ambC = DESK_ROOM_C, epsSet = 0.95, aim = DESK_AIM as readonly number[] } = {}) {
  const { cols, rows } = THERMAL_CAMS[cam]
  const fp = pixelFootprint(cam, d)
  const { wallL, boxes } = sceneBoxes(scene, ambC)
  const area = fp.px * fp.py
  const temps = new Float64Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    const y1 = aim[1] + fp.h / 2 - r * fp.py
    const y0 = y1 - fp.py
    for (let c = 0; c < cols; c++) {
      const x0 = aim[0] - fp.w / 2 + c * fp.px
      const x1 = x0 + fp.px
      let L = wallL
      for (const b of boxes) {
        const ox = Math.min(x1, b.x1) - Math.max(x0, b.x0)
        if (ox <= 0) continue
        const oy = Math.min(y1, b.y1) - Math.max(y0, b.y0)
        if (oy > 0) L += (b.dL * ox * oy) / area
      }
      temps[r * cols + c] = readC(L, ambC, epsSet)
    }
  }
  let hot = 0
  let lo = Infinity
  for (let i = 0; i < temps.length; i++) {
    if (temps[i] > temps[hot]) hot = i
    lo = Math.min(lo, temps[i])
  }
  /** Reading of the pixel that sees scene point (x, y), or null outside the view. */
  const at = (x: number, y: number) => {
    const c = Math.floor((x - aim[0] + fp.w / 2) / fp.px)
    const r = Math.floor((aim[1] + fp.h / 2 - y) / fp.py)
    return c < 0 || r < 0 || c >= cols || r >= rows ? null : temps[r * cols + c]
  }
  return { cols, rows, temps, fp, lo, hi: temps[hot], hotCol: hot % cols, hotRow: Math.floor(hot / cols), at }
}
