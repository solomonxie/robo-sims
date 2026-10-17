// Belts and couplers: GT2 timing belt drive (ratio, teeth in mesh, tension, skipping, stretch) and shaft couplers (misalignment, set-screw grip).
import { trainRatio } from '../actuators/gearing'
import { rpmToRadS } from '../actuators/stepper'
import { shaftLoads } from './bearings'
import { preloadOf } from './fasteners'
import { MATERIALS, beamStiffness, bendingStress } from './stress'

/** GT2 6 mm belt (typical): 2 mm pitch, mass per metre, stretch stiffness EA (N), tooth shear capacity, working tension. */
export const GT2 = { pitch: 2, width: 6, massKgM: 0.0045, ea: 25000, toothN: 12, workN: 120 }
/** Teeth jump once the pull exceeds about this × the installed tension (typical). */
export const JUMP_K = 2.5
export const MIN_MESH = 6
/** NEMA17 on the belt: speed, radial limit at the shaft end and at a pulley near the flange (typical datasheet). */
export const BELT_MOTOR = { rpm: 300, radialN: 28, hubMaxN: 80 }

export const pitchRadiusMm = (z: number, p = GT2.pitch) => (z * p) / (2 * Math.PI)
/** Open belt over pulleys of radius r1 ≤ r2, centres C apart. */
export const wrapRad = (r1: number, r2: number, C: number) => Math.PI - 2 * Math.asin(Math.min(1, (r2 - r1) / C))
const spanMm = (r1: number, r2: number, C: number) => Math.sqrt(Math.max(0, C * C - (r2 - r1) ** 2))
export const beltLengthMm = (r1: number, r2: number, C: number) => 2 * spanMm(r1, r2, C) + r1 * wrapRad(r1, r2, C) + r2 * (2 * Math.PI - wrapRad(r1, r2, C))
export const teethInMesh = (z: number, wrap: number) => Math.floor((z * wrap) / (2 * Math.PI))
/** Largest belt pull (N) before teeth jump: the lower of tension-limited and tooth-shear-limited. */
const jumpPullN = (tensionN: number, mesh: number) => Math.min(JUMP_K * tensionN, mesh * GT2.toothN)
/** Pluck frequency of a span: f = √(T/μ) / 2L. */
const pluckHz = (tensionN: number, spanM: number, massKgM = GT2.massKgM) => Math.sqrt(tensionN / massKgM) / (2 * spanM)

export type BeltVerdict = 'skips' | 'few teeth' | 'slack' | 'tight' | 'ok'

/** Motor pulley z1 driving z2 at centre distance C (mm), installed tension T0 (N), motor torque (N·m). */
export function beltDrive(z1: number, z2: number, C: number, tensionN: number, motorNm: number, rpm = BELT_MOTOR.rpm) {
  const r1 = pitchRadiusMm(z1)
  const r2 = pitchRadiusMm(z2)
  const ratio = Math.abs(trainRatio([{ teeth: z1 }, { teeth: z2 }]))
  const wrap = wrapRad(r1, r2, C)
  const mesh = teethInMesh(z1, wrap)
  const pull = motorNm / (r1 / 1000)
  const jumpN = jumpPullN(tensionN, mesh)
  const tight = tensionN + pull / 2
  const slack = Math.max(0, tensionN - pull / 2)
  const hubN = Math.sqrt(tight * tight + slack * slack - 2 * tight * slack * Math.cos(wrap))
  const stretchMm = (pull * spanMm(r1, r2, C)) / GT2.ea
  const span = spanMm(r1, r2, C)
  const verdict: BeltVerdict =
    pull > jumpN ? 'skips' : mesh < MIN_MESH ? 'few teeth' : hubN > BELT_MOTOR.hubMaxN || tight > GT2.workN ? 'tight' : slack <= 0 ? 'slack' : 'ok'
  return {
    r1,
    r2,
    ratio,
    wrap,
    mesh,
    pull,
    jumpN,
    tight,
    slack,
    hubN,
    stretchMm,
    windupDeg: ((stretchMm / r2) * 180) / Math.PI,
    beltMps: (rpmToRadS(rpm) * r1) / 1000,
    outRpm: rpm / ratio,
    outNm: motorNm * ratio * 0.98,
    lengthMm: beltLengthMm(r1, r2, C),
    pluck: pluckHz(tensionN, span / 1000),
    verdict,
    /** Motor torque (N·m) the belt carries before skipping, at tension t. */
    jumpNmAt: (t: number) => (jumpPullN(t, mesh) * r1) / 1000,
  }
}

// --- Shaft couplers ---

/** Couplers for a 5 mm motor shaft to an 8 mm lead screw (typical small aluminium ones): radial rate N/mm, allowed offset mm and angle °, rated N·m, torsional N·m/°. */
export const COUPLERS = {
  rigid: { name: 'Rigid', kRad: Infinity, maxOffset: 0.02, maxDeg: 0.05, ratedNm: 2, torDeg: 20 },
  helical: { name: 'Helical beam', kRad: 12, maxOffset: 0.25, maxDeg: 3, ratedNm: 0.9, torDeg: 0.6 },
  jaw: { name: 'Jaw + spider', kRad: 50, maxOffset: 0.1, maxDeg: 1, ratedNm: 1.5, torDeg: 1.2 },
} as const
export type CouplerKey = keyof typeof COUPLERS

/** Shafts as cantilevers from their bearings (mm), a printed motor mount spring (N/mm), coupler length (mm). */
export const COUPLING = { motorD: 5, motorL: 15, screwRoot: 6.6, screwL: 25, mountK: 500, length: 25, bearingSpacing: 25 }

const roundI = (dMm: number) => (Math.PI * (dMm / 1000) ** 4) / 64
const bendK = (d: number, L: number) => beamStiffness(L / 1000, MATERIALS.steel.E, roundI(d)) / 1000
/** Radial springs (N/mm) that give when the shafts are pulled into line: motor shaft, lead screw, motor mount. */
const CHAIN = { motor: bendK(COUPLING.motorD, COUPLING.motorL), screw: bendK(COUPLING.screwRoot, COUPLING.screwL), mount: COUPLING.mountK }
export const shaftChainK = () => 1 / (1 / CHAIN.motor + 1 / CHAIN.screw + 1 / CHAIN.mount)
/** Share of the misalignment each spring takes up (series springs: ∝ compliance). */
function offsetShares(ck: CouplerKey) {
  const c = { coupler: 1 / COUPLERS[ck].kRad, motor: 1 / CHAIN.motor, screw: 1 / CHAIN.screw, mount: 1 / CHAIN.mount }
  const sum = c.coupler + c.motor + c.screw + c.mount
  return { coupler: c.coupler / sum, motor: c.motor / sum, screw: c.screw / sum, mount: c.mount / sum }
}
/** Angle θ across the coupler acts like an extra offset θ·L/2. */
export const equivOffsetMm = (offsetMm: number, angleDeg: number) => offsetMm + ((angleDeg * Math.PI) / 180) * (COUPLING.length / 2)
/** Side force (N) on the shafts with coupler ck at a parallel offset and angle. */
export function couplerForceN(ck: CouplerKey, offsetMm: number, angleDeg: number) {
  const kc = COUPLERS[ck].kRad
  const k = 1 / (1 / kc + 1 / shaftChainK())
  return k * equivOffsetMm(offsetMm, angleDeg)
}

/** How the coupler hub holds the shaft (typical): a set screw (small key, ~0.3 N·m) on a round shaft or a D-flat, or a clamp screw (~1 N·m). */
export const GRIPS = {
  round: { name: 'Set screw, round', screwNm: 0.3 },
  dflat: { name: 'Set screw on a D-flat', screwNm: 0.3 },
  clamp: { name: 'Clamp hub', screwNm: 1 },
} as const
export type GripKey = keyof typeof GRIPS
const GRIP_MU = 0.15
/** The screw tip bearing on a flat drives the shaft by shape, not friction (typical gain). */
const DFLAT_GAIN = 4

/** Torque (N·m) the hub holds on the motor shaft before slipping. */
export function gripNm(gk: GripKey, dMm = COUPLING.motorD) {
  const F = preloadOf(GRIPS[gk].screwNm, 3)
  const r = dMm / 2000
  const round = 2 * GRIP_MU * F * r
  return gk === 'round' ? round : gk === 'dflat' ? round * DFLAT_GAIN : GRIP_MU * F * r * Math.PI
}

export type CouplerVerdict = 'slips' | 'overload' | 'over rated' | 'bearing' | 'ok'

/** Coupler lesson: side force, motor bearing load, cyclic shaft stress, grip and twist under `torqueNm`. */
export function couplerView(ck: CouplerKey, offsetMm: number, angleDeg: number, gk: GripKey, torqueNm: number) {
  const c = COUPLERS[ck]
  const force = couplerForceN(ck, offsetMm, angleDeg)
  const bearing = shaftLoads(force, COUPLING.bearingSpacing, COUPLING.motorL).near
  const stressPa = bendingStress((force * COUPLING.motorL) / 1000, COUPLING.motorD / 2000, roundI(COUPLING.motorD))
  const grips = (Object.keys(GRIPS) as GripKey[]).map((g) => gripNm(g))
  const grip = gripNm(gk)
  const overRated = offsetMm > c.maxOffset || angleDeg > c.maxDeg
  const verdict: CouplerVerdict =
    torqueNm > grip ? 'slips' : torqueNm > c.ratedNm ? 'overload' : force > BELT_MOTOR.radialN ? 'bearing' : overRated ? 'over rated' : 'ok'
  return {
    c,
    force,
    bearing,
    stressPa,
    grips,
    grip,
    twistDeg: torqueNm / c.torDeg,
    overRated,
    verdict,
    shares: offsetShares(ck),
    curves: (Object.keys(COUPLERS) as CouplerKey[]).map((k) => (e: number) => couplerForceN(k, e, angleDeg)),
  }
}
