// Gear trains: tooth ratios and meshing phase, backlash, planetary sets, worm drives.
import { DEG } from '../common'

const TAU = 2 * Math.PI
const wrap1 = (x: number) => ((x % 1) + 1) % 1

export const pitchDiameterMm = (mod: number, teeth: number) => mod * teeth
export const centerDistanceMm = (mod: number, z1: number, z2: number) => (mod * (z1 + z2)) / 2
export const circularPitchMm = (mod: number) => Math.PI * mod
/** Pitch-line speed, the same on both gears of a mesh: v = π·d·n. */
export const pitchLineMmS = (mod: number, teeth: number, rpm: number) => (Math.PI * pitchDiameterMm(mod, teeth) * rpm) / 60

/** One gear of a train, in order; `shaft` = keyed to the previous gear's shaft (compound) instead of meshing with it. */
export interface TrainGear {
  teeth: number
  shaft?: boolean
}
/** Signed speed of every gear per unit input speed (− = turning the other way). */
export function trainSpeeds(gears: TrainGear[]) {
  const w = [1]
  for (let i = 1; i < gears.length; i++) w.push(gears[i].shaft ? w[i - 1] : (-w[i - 1] * gears[i - 1].teeth) / gears[i].teeth)
  return w
}
/** Reduction N = ω_in / ω_out, signed: < 0 when the output turns the other way. */
export const trainRatio = (gears: TrainGear[]) => 1 / trainSpeeds(gears)[gears.length - 1]
export const meshCount = (gears: TrainGear[]) => gears.filter((g, i) => i > 0 && !g.shaft).length
export const trainEfficiency = (gears: TrainGear[], meshEff = 0.95) => meshEff ** meshCount(gears)

/** Fraction of a tooth pitch at world angle β on a z-tooth gear turned θ: 0 = tooth centre, 0.5 = gap. */
export const toothPhase = (beta: number, theta: number, z: number) => wrap1(((beta - theta) * z) / TAU)
/** Turn of gear B meshing with gear A along world angle α (A → B), so A's tooth always sits in B's gap. */
export const meshTurn = (thetaA: number, zA: number, zB: number, alpha: number) => (alpha * (zA + zB)) / zB + Math.PI - Math.PI / zB - (thetaA * zA) / zB
/** Turn of an internal ring (zR) around a planet (zP) touching it at world angle α. */
export const ringTurn = (thetaP: number, zP: number, zR: number, alpha: number) => alpha - ((alpha - thetaP) * zP - Math.PI) / zR

// --- Backlash ---

/** A mesh with play: the output stays put until the input takes up the gap on either side (output degrees). */
export const backlashStep = (out: number, input: number, gap: number) => Math.min(input + gap / 2, Math.max(input - gap / 2, out))
export function backlashTrace(inputs: number[], gap: number, start = inputs[0] ?? 0) {
  let out = start
  return inputs.map((x) => (out = backlashStep(out, x, gap)))
}
/** Motor turn lost at each reversal: the output gap seen through the reduction. */
export const deadZoneMotorDeg = (gapDeg: number, ratio: number) => gapDeg * ratio
export const tipErrorMm = (armMm: number, deg: number) => armMm * deg * DEG
/** Peak torque to swing a payload on an arm through ±amp degrees sinusoidally: I·Aω². */
export const swingPeakNm = (massKg: number, armM: number, ampDeg: number, periodS: number) => massKg * armM * armM * ampDeg * DEG * (TAU / periodS) ** 2
/** Split (scissor) gear: its spring closes the gap while it out-pulls the load torque, then gives and the gap is back. */
export const splitGearGap = (gapDeg: number, springNm: number, loadNm: number) => (Math.abs(loadNm) <= springNm ? 0 : gapDeg)
/** Friction the preload adds: both flanks pressed, μ on each. */
export const preloadDragNm = (springNm: number, mu = 0.1) => 2 * mu * springNm

// --- Planetary ---

export type PlanetHeld = 'ring' | 'carrier' | 'sun'
export const planetTeeth = (sun: number, ring: number) => (ring - sun) / 2
export const ringTeeth = (sun: number, planet: number) => sun + 2 * planet
/** Equal-spaced planets assemble only when (S + R) / n is whole. */
export const planetsFit = (sun: number, ring: number, n: number) => (sun + ring) % n === 0
export const PLANET_PATHS = {
  ring: { input: 'sun', output: 'carrier' },
  carrier: { input: 'sun', output: 'ring' },
  sun: { input: 'ring', output: 'carrier' },
} as const
/** Willis: ω_s − ω_c = −(R/S)(ω_r − ω_c). Reduction from input to output with one member held (signed). */
export function planetaryRatio(sun: number, ring: number, held: PlanetHeld) {
  if (held === 'ring') return 1 + ring / sun
  if (held === 'carrier') return -ring / sun
  return 1 + sun / ring
}
/** Angles of sun, ring and carrier once the input member has turned `inputRad`. */
export function planetaryTurns(sun: number, ring: number, held: PlanetHeld, inputRad: number) {
  const out = inputRad / planetaryRatio(sun, ring, held)
  if (held === 'ring') return { sun: inputRad, ring: 0, carrier: out }
  if (held === 'carrier') return { sun: inputRad, ring: out, carrier: 0 }
  return { sun: 0, ring: inputRad, carrier: out }
}
/** Planet spin about its own pin, from the sun and carrier angles. */
export const planetTurn = (sun: number, planet: number, sunRad: number, carrierRad: number) => carrierRad - ((sunRad - carrierRad) * sun) / planet

// --- Worm drive ---

/** Steel worm, bronze wheel, greased; q = worm pitch diameter / module. */
export const WORM = { q: 12, mu: 0.1, pressureDeg: 20 }
export const wormRatio = (wheelTeeth: number, starts: number) => wheelTeeth / starts
export const wormLeadAngle = (starts: number, q = WORM.q) => Math.atan(starts / q)
export const wormFrictionAngle = (mu = WORM.mu, pressureDeg = WORM.pressureDeg) => Math.atan(mu / Math.cos(pressureDeg * DEG))
/** Worm driving the wheel: η = tan λ / tan(λ + φ). */
export const wormEfficiency = (lead: number, fric = wormFrictionAngle()) => Math.tan(lead) / Math.tan(lead + fric)
/** Wheel driving the worm: η' = tan(λ − φ) / tan λ, 0 when it locks. */
export const wormBackEfficiency = (lead: number, fric = wormFrictionAngle()) => Math.max(0, Math.tan(lead - fric) / Math.tan(lead))
export const wormSelfLocking = (lead: number, fric = wormFrictionAngle()) => lead <= fric
/** Worm torque to turn the wheel against `wheelNm`. */
export const wormInputNm = (wheelNm: number, ratio: number, eff: number) => wheelNm / (ratio * eff)
