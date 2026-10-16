// Pneumatic cylinders (F = P·A, meter-out speed, the air spring) and soft PneuNet fingers (curl vs pressure, gentle grip).

const G = 9.81
export const ATM_BAR = 1.013
/** 1 bar × 1 mm² = 0.1 N. */
const N_PER_BAR_MM2 = 0.1
/** Normal litre of air expressed as bar·mm³ (isothermal amount). */
const NL = 1e6
/** ISO 6358 critical pressure ratio. */
const B_CRIT = 0.528

export const circleAreaMm2 = (diaMm: number) => (Math.PI * diaMm * diaMm) / 4
/** Rod side: the bore minus the rod. */
export const annulusAreaMm2 = (boreMm: number, rodMm: number) => circleAreaMm2(boreMm) - circleAreaMm2(rodMm)
/** F = P·A, gauge bar on mm², N. */
export const pressForceN = (barG: number, areaMm2: number) => barG * areaMm2 * N_PER_BAR_MM2

/** A regulator can only lower the pressure: out = min(set, tank). */
export const regulatedBar = (setBar: number, tankBar: number) => Math.min(setBar, tankBar)

/** ISO 6358 flow through a restriction with sonic conductance C (Nl/s/bar), absolute bar: choked below b, then elliptic. */
export function orificeNlS(pUp: number, pDn: number, C: number) {
  if (pUp <= pDn) return 0
  const r = pDn / pUp
  return r <= B_CRIT ? C * pUp : C * pUp * Math.sqrt(1 - ((r - B_CRIT) / (1 - B_CRIT)) ** 2)
}

/** Restrictions in series (valve + needle). */
export const seriesConductance = (a: number, b: number) => 1 / (1 / a + 1 / b)

/** Meter-out speed when the exhaust is choked: the needle passes C·p Nl/s of air at p, so v = C/A whatever the supply, mm/s. */
export const meterOutMmS = (C: number, areaMm2: number) => (C * NL) / areaMm2

/** Free air used per double stroke: both chambers filled to p and dumped, Nl. */
export const airPerCycleNl = (boreMm: number, rodMm: number, strokeMm: number, barG: number) =>
  ((circleAreaMm2(boreMm) + annulusAreaMm2(boreMm, rodMm)) * strokeMm * (barG + ATM_BAR)) / ATM_BAR / NL

/** Trapped air acts as a spring: k = p·A²/V (isothermal), absolute bar, mm², mm³ → N/mm. */
export const airSpringNmm = (pAbs: number, areaMm2: number, volMm3: number) => (pAbs * areaMm2 * areaMm2 * N_PER_BAR_MM2) / volMm3

export interface Cylinder {
  boreMm: number
  rodMm: number
  strokeMm: number
  /** Port and cushion volume at each end, as extra stroke length. */
  deadMm: number
  /** Piston, rod and the sled it drives, kg. */
  massKg: number
  /** Seal friction: breakaway N and viscous N per mm/s. */
  frictionN: number
  viscous: number
  /** 5/2 valve sonic conductance, Nl/s/bar. */
  valveC: number
}

/** ISO 15552 Ø32 × 100 cylinder with a 12 mm rod pushing a 12 kg sled. */
export const CYL_32: Cylinder = { boreMm: 32, rodMm: 12, strokeMm: 100, deadMm: 8, massKg: 12, frictionN: 10, viscous: 0.02, valveC: 0.5 }

export type ValveMode = 'cycle' | 'stop'
export type ValvePos = 'extend' | 'retract' | 'hold'
export interface CylOpts {
  supplyBar: number
  /** Meter-out needle conductance, Nl/s/bar (same on both ports). */
  needleC: number
  mode: ValveMode
}
export interface CylFrame {
  t: number
  x: number
  v: number
  /** Chamber gauge pressures, bar: A = cap end, B = rod end. */
  pA: number
  pB: number
  valve: ValvePos
  /** Exhaust/fill flows into A and B, Nl/s (negative = out). */
  qA: number
  qB: number
  pushN: number
}

export const CYL_RUN = { seconds: 4, retractS: 2, stopAtMm: 50, holdS: 2.6, push: [1.3, 2.0] as const, pushN: 100, dt: 1e-4, every: 100 }

/** Double-acting cylinder on a 5/2 (or closed-centre 5/3) valve with meter-out flow controls: isothermal air in both chambers, seal friction, end stops. */
export function cylinderRun(o: CylOpts, c: Cylinder = CYL_32, r = CYL_RUN) {
  const A = circleAreaMm2(c.boreMm)
  const Ab = annulusAreaMm2(c.boreMm, c.rodMm)
  const ps = o.supplyBar + ATM_BAR
  const cOut = seriesConductance(c.valveC, o.needleC)
  const vol = (x: number) => [A * (x + c.deadMm), Ab * (c.strokeMm - x + c.deadMm)]
  let x = 0
  let v = 0
  let [vA, vB] = vol(0)
  let nA = ATM_BAR * vA
  let nB = ps * vB
  let stopped = false
  const frames: CylFrame[] = []
  const steps = Math.round(r.seconds / r.dt)
  for (let i = 0; i <= steps; i++) {
    const t = i * r.dt
    if (o.mode === 'stop' && !stopped && x >= r.stopAtMm) stopped = true
    const valve: ValvePos = o.mode === 'cycle' ? (t < r.retractS ? 'extend' : 'retract') : t >= r.holdS ? 'retract' : stopped ? 'hold' : 'extend'
    const pA = nA / vA
    const pB = nB / vB
    const flow = (p: number, fill: boolean) => (fill ? orificeNlS(ps, p, c.valveC) : -orificeNlS(p, ATM_BAR, cOut))
    const qA = valve === 'hold' ? 0 : flow(pA, valve === 'extend')
    const qB = valve === 'hold' ? 0 : flow(pB, valve === 'retract')
    const pushN = o.mode === 'stop' && t >= r.push[0] && t < r.push[1] ? r.pushN : 0
    if (i % r.every === 0) frames.push({ t, x, v, pA: pA - ATM_BAR, pB: pB - ATM_BAR, valve, qA, qB, pushN })
    const drive = (pA * A - pB * Ab - ATM_BAR * (A - Ab)) * N_PER_BAR_MM2 - pushN - c.viscous * v
    let f = 0
    if (Math.abs(v) < 1e-3 && Math.abs(drive) <= c.frictionN) v = 0
    else f = drive - c.frictionN * Math.sign(v || drive)
    v += ((f / c.massKg) * 1000 * r.dt)
    x += v * r.dt
    if (x <= 0 || x >= c.strokeMm) {
      x = Math.min(c.strokeMm, Math.max(0, x))
      v = 0
    }
    nA = Math.max(1e-6, nA + qA * NL * r.dt)
    nB = Math.max(1e-6, nB + qB * NL * r.dt)
    ;[vA, vB] = vol(x)
  }
  return frames
}

/** Stroke time and average speed of the first extend, s and mm/s. */
export function strokeStats(run: CylFrame[], c: Cylinder = CYL_32) {
  const end = run.find((f) => f.x >= c.strokeMm - 0.01)
  const start = run.find((f) => f.x > 0.01)
  const s = end && start ? end.t - start.t : NaN
  return { strokeS: s, mmS: c.strokeMm / s }
}

/** Stiffness of the air trapped on both sides at stroke x: springs in parallel, N/mm. */
export function trappedStiffnessNmm(x: number, pAg: number, pBg: number, c: Cylinder = CYL_32) {
  const A = circleAreaMm2(c.boreMm)
  const Ab = annulusAreaMm2(c.boreMm, c.rodMm)
  return airSpringNmm(pAg + ATM_BAR, A, A * (x + c.deadMm)) + airSpringNmm(pBg + ATM_BAR, Ab, Ab * (c.strokeMm - x + c.deadMm))
}

/** Bounce frequency of the load on that air spring, Hz. */
export const airBounceHz = (kNmm: number, massKg: number) => Math.sqrt((kNmm * 1000) / massKg) / (2 * Math.PI)

// --- Soft PneuNet finger ---

export interface SoftFinger {
  lengthMm: number
  /** Strain-limiting layer to the chamber walls' centroid, mm. */
  layerMm: number
  /** Silicone modulus, kPa; chamber size over wall thickness; share of the length that is stretching wall. */
  eKPa: number
  rt: number
  fill: number
  /** Chamber end-wall area, mm²; finger width, mm. */
  chamberMm2: number
  widthMm: number
  /** Base spacing past the object surface and depth of the object centre below the palm, mm. */
  gapMm: number
  depthMm: number
}

/** Ecoflex-class PneuNet: 90 mm, full curl near 50 kPa. */
export const PNEUNET: SoftFinger = { lengthMm: 90, layerMm: 6, eKPa: 125, rt: 1, fill: 0.5, chamberMm2: 200, widthMm: 16, gapMm: 25, depthMm: 35 }

/** Chamber walls stretch ε = (P/E)·(r/t)·fill while the layer can't, so κ = ε/h, 1/mm. */
export const pneuNetCurvature = (pKPa: number, f: SoftFinger = PNEUNET) => (Math.max(0, pKPa) / f.eKPa) * f.rt * f.fill / f.layerMm
/** Tip angle θ = κ·L, rad. */
export const pneuNetBendRad = (pKPa: number, f: SoftFinger = PNEUNET) => pneuNetCurvature(pKPa, f) * f.lengthMm
export const pneuNetPressureFor = (curv: number, f: SoftFinger = PNEUNET) => (curv * f.layerMm * f.eKPa) / (f.rt * f.fill)

/** A finger hanging at R + gap from a ball of radius R whose centre is `depthMm` down first touches it when its arc is tangent:
 *  ρ = (s² + d² − R²) / 2(s − R). Returns that curvature and the arc length to the touch point. */
export function pneuNetContact(radiusMm: number, f: SoftFinger = PNEUNET) {
  const s = radiusMm + f.gapMm
  const d = f.depthMm
  const rho = (s * s + d * d - radiusMm * radiusMm) / (2 * (s - radiusMm))
  const arcMm = rho * Math.atan2(d, rho - s)
  return { curv: 1 / rho, arcMm, pKPa: pneuNetPressureFor(1 / rho, f) }
}

/** Blocked finger: the extra pressure past touching pushes on the chamber walls, M = A·h·(P − Pc), felt at the touch point, N. */
export function pneuNetForceN(pKPa: number, radiusMm: number, f: SoftFinger = PNEUNET) {
  const c = pneuNetContact(radiusMm, f)
  return Math.max(0, ((pKPa - c.pKPa) / 1000) * f.chamberMm2 * f.layerMm) / c.arcMm
}

/** Contact stress = F / A, kPa (N/mm² × 1000). */
export const contactKPa = (forceN: number, areaMm2: number) => (forceN / areaMm2) * 1000
/** Friction grip: fingers × μ × N must carry m·g. */
export const gripHolds = (normalN: number, fingers: number, mu: number, massG: number) => fingers * mu * normalN >= (massG / 1000) * G
export const weightOfN = (massG: number) => (massG / 1000) * G

/** Jamming (granular) gripper: grains wrap the object, vacuum locks them; holding ≈ ΔP × wrapped cap area × k, N. */
export const jammingHoldN = (vacKPa: number, radiusMm: number, k = 0.3) => (vacKPa / 1000) * Math.PI * radiusMm * radiusMm * k

export type GripperKind = 'soft' | 'rigid' | 'jamming'
export interface GripObject {
  radiusMm: number
  massG: number
  /** Contact stress that cracks or bruises it, kPa. */
  crushKPa: number
}
export const GRIP_OBJECTS = {
  egg: { radiusMm: 22, massG: 60, crushKPa: 3000 },
  berry: { radiusMm: 15, massG: 20, crushKPa: 250 },
  steel: { radiusMm: 15, massG: 220, crushKPa: 1e6 },
} satisfies Record<string, GripObject>

/** Full-scale drive per gripper: soft kPa, rigid servo N, jamming vacuum kPa; contact patch mm², friction μ. */
export const GRIPPERS = {
  soft: { full: 70, areaMm2: PNEUNET.widthMm * 12, mu: 0.8 },
  rigid: { full: 40, areaMm2: 4, mu: 0.3 },
  jamming: { full: 80, areaMm2: 0, mu: 0 },
}

/** Grip at `squeeze` (0…1 of full scale): normal force per finger, stress on the object, whether it holds and whether it breaks. */
export function gripOutcome(kind: GripperKind, squeeze: number, o: GripObject) {
  const g = GRIPPERS[kind]
  const drive = squeeze * g.full
  const weight = weightOfN(o.massG)
  if (kind === 'jamming') {
    const holdN = jammingHoldN(drive, o.radiusMm)
    return { drive, normalN: holdN, stressKPa: drive, holdN, weight, holds: holdN >= weight && drive > 0, crushed: drive > o.crushKPa }
  }
  const normalN = kind === 'soft' ? pneuNetForceN(drive, o.radiusMm) : drive
  const stressKPa = contactKPa(normalN, g.areaMm2)
  const crushed = stressKPa > o.crushKPa
  const holdN = 2 * g.mu * normalN
  return { drive, normalN, stressKPa, holdN, weight, holds: !crushed && gripHolds(normalN, 2, g.mu, o.massG), crushed }
}
