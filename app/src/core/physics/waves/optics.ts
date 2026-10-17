// Geometric optics: specular vs diffuse reflection (what an IR line sensor sees), Snell's law and total internal reflection, thin-lens focus and blur. SI units, angles in degrees.
import { DEG } from '../common'

// --- Reflection: a surface sends a share of the light into a mirror-angle lobe, a share everywhere (Lambert). ---

/** `diffuse` / `spec`: shares of the incident light; `lobeDeg`: spread (σ) of the mirror lobe. */
export const FINISHES = {
  mirror: { name: 'Mirror', diffuse: 0.02, spec: 0.92, lobeDeg: 1.5 },
  paper: { name: 'White paper', diffuse: 0.85, spec: 0.02, lobeDeg: 25 },
  tile: { name: 'Glossy floor tile', diffuse: 0.5, spec: 0.06, lobeDeg: 4 },
  tape: { name: 'Black vinyl tape', diffuse: 0.04, spec: 0.05, lobeDeg: 6 },
  card: { name: 'Matte black card', diffuse: 0.05, spec: 0.005, lobeDeg: 30 },
} as const
export type Finish = keyof typeof FINISHES

/** Law of reflection: direction `d` off a surface with unit normal `n` (2D). */
export const reflect2 = ([dx, dy]: readonly number[], [nx, ny]: readonly number[]): [number, number] => {
  const k = 2 * (dx * nx + dy * ny)
  return [dx - k * nx, dy - k * ny]
}

/** Light per radian leaving at `outDeg` from the normal (+ = mirror side) for a unit beam arriving at `inDeg`. */
export function scatterAt(f: Finish, inDeg: number, outDeg: number) {
  const s = FINISHES[f]
  if (Math.abs(outDeg) >= 90) return { diffuse: 0, spec: 0 }
  const sig = s.lobeDeg * DEG
  const x = (outDeg - inDeg) * DEG
  return { diffuse: (s.diffuse * Math.cos(outDeg * DEG)) / 2, spec: (s.spec * Math.exp(-(x * x) / (2 * sig * sig))) / (sig * Math.sqrt(2 * Math.PI)) }
}

/** Share of a unit beam a detector at `atDeg` collects over ±`halfDeg`, split into diffuse and mirror-lobe light. */
export function detectorReturn(f: Finish, inDeg: number, atDeg: number, halfDeg = 8, steps = 40) {
  let diffuse = 0
  let spec = 0
  const h = (2 * halfDeg * DEG) / steps
  for (let i = 0; i < steps; i++) {
    const s = scatterAt(f, inDeg, atDeg - halfDeg + ((i + 0.5) * 2 * halfDeg) / steps)
    diffuse += s.diffuse * h
    spec += s.spec * h
  }
  return { diffuse, spec, total: diffuse + spec, glare: spec / Math.max(1e-12, diffuse + spec) }
}

// --- Refraction: Snell's law, Fresnel reflectance, total internal reflection, apparent depth. ---

export const OPTIC_MEDIA = {
  air: { name: 'Air', n: 1.0003 },
  water: { name: 'Water', n: 1.333 },
  acrylic: { name: 'Acrylic', n: 1.49 },
  glass: { name: 'Glass', n: 1.52 },
} as const
export type OpticMedium = keyof typeof OPTIC_MEDIA

/** n₁·sin θ₁ = n₂·sin θ₂; null past the critical angle (total internal reflection). */
export function snellDeg(n1: number, n2: number, deg: number) {
  const s = (n1 / n2) * Math.sin(deg * DEG)
  return Math.abs(s) > 1 ? null : Math.asin(s) / DEG
}
/** Angle past which light going from n₁ into a thinner n₂ can't get out; null if n₂ ≥ n₁. */
export const criticalDeg = (n1: number, n2: number) => (n2 >= n1 ? null : Math.asin(n2 / n1) / DEG)

/** Share reflected at the boundary (unpolarised Fresnel); 1 under total internal reflection. */
export function fresnelR(n1: number, n2: number, deg: number) {
  const t = snellDeg(n1, n2, deg)
  if (t === null) return 1
  const ci = Math.cos(deg * DEG)
  const ct = Math.cos(t * DEG)
  const rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct)
  const rp = (n1 * ct - n2 * ci) / (n1 * ct + n2 * ci)
  return (rs * rs + rp * rp) / 2
}

/** Looking straight down from `nEye` into `nObj`: a thing `real` deep looks real·nEye/nObj deep. */
export const apparentDepth = (real: number, nObj: number, nEye: number) => (real * nEye) / nObj

// --- Thin lens: 1/f = 1/u + 1/v, blur circle on a sensor, depth of field. ---

/** Image distance behind a lens of focal length `f` for an object `u` in front (∞ at u = f, negative = virtual). */
export const thinLensV = (f: number, u: number) => (u === f ? Infinity : (f * u) / (u - f))
/** Image size ÷ object size; negative = upside down. */
export const magnification = (f: number, u: number) => -thinLensV(f, u) / u

/** Blur spot diameter on a sensor `s` behind the lens for a point `u` away: aperture f/N times |s − v|/v. */
export function blurCircle(f: number, N: number, u: number, s: number) {
  const v = thinLensV(f, u)
  return ((f / N) * Math.abs(s - v)) / v
}

/** Focus at this distance and everything from H/2 to ∞ looks sharp (blur ≤ `c`). */
export const hyperfocal = (f: number, N: number, c: number) => (f * f) / (N * c) + f

/** Nearest and farthest object distances that blur ≤ `c` with the sensor focused at `uFocus`. */
export function dofLimits(f: number, N: number, uFocus: number, c: number) {
  const H = hyperfocal(f, N, c)
  return {
    near: (uFocus * (H - f)) / (H + uFocus - 2 * f),
    far: uFocus >= H ? Infinity : (uFocus * (H - f)) / (H - uFocus),
  }
}
