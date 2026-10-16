// Grippers: jaw kinematics and squeeze from servo torque, friction grip, suction cups, underactuated (tendon) fingers. mm, N, N·mm unless named.
import { SERVO_BAND_DEG } from '../actuators/servo'
import { circleAreaMm2 } from '../actuators/pneumatics'
import { DEG, G, clamp, clamp01 } from '../common'

// --- Jaws ---

export type JawKind = 'rack' | 'linkage' | 'angular'
/** Servo angle 0 = open … 90° = shut. rack: pinion radius; linkage: crank length, pivot half-spacing; angular: finger length, pivot half-spacing, depth of the object centre below the pivots. */
export const JAWS = { openMm: 45, pinionMm: 25, crankMm: 40, linkPivotMm: 5, crankStartDeg: 10, fingerMm: 60, angPivotMm: 14, depthMm: 45, angStartDeg: -30 }

/** Inner half-gap at servo angle θ: rack h = h0 − r·θ; linkage (parallelogram) h = p + L·cos α; angular: fingertip p − L·sin φ. */
export function jawHalfGap(kind: JawKind, servoDeg: number, j = JAWS) {
  const th = servoDeg * DEG
  if (kind === 'rack') return j.openMm - j.pinionMm * th
  if (kind === 'linkage') return j.linkPivotMm + j.crankMm * Math.cos(th + j.crankStartDeg * DEG)
  return j.angPivotMm - j.fingerMm * Math.sin(th + j.angStartDeg * DEG)
}

/** Parallelogram pads ride an arc: they drop L·sin α as they close. */
export const linkagePadDropMm = (servoDeg: number, j = JAWS) => j.crankMm * Math.sin((servoDeg + j.crankStartDeg) * DEG)

/** Angular finger angle φ (from straight down, + = tip inward) that touches a ball of radius R: ρ·cos(φ + β) = R. */
export function angularTouchDeg(radiusMm: number, j = JAWS) {
  const rho = Math.hypot(j.angPivotMm, j.depthMm)
  const beta = Math.atan2(j.depthMm, j.angPivotMm)
  const phi = Math.acos(clamp(radiusMm / rho, -1, 1)) - beta
  return { phiDeg: phi / DEG, servoDeg: phi / DEG - j.angStartDeg, armMm: j.angPivotMm * Math.sin(phi) + j.depthMm * Math.cos(phi) }
}

/** Servo angle where the jaws touch an object of half-width R (NaN if out of range). */
export function jawTouchDeg(kind: JawKind, radiusMm: number, j = JAWS) {
  if (kind === 'angular') return angularTouchDeg(radiusMm, j).servoDeg
  const th = kind === 'rack' ? (j.openMm - radiusMm) / j.pinionMm : Math.acos(clamp((radiusMm - j.linkPivotMm) / j.crankMm, -1, 1)) - j.crankStartDeg * DEG
  return th / DEG
}

/** Normal force per jaw for servo torque τ (N·m): rack F = τ/2r; linkage F = τ/(2L·sin α); angular F = τ/(2d), d = pivot to contact. */
export function jawForceN(kind: JawKind, torqueNm: number, servoDeg: number, radiusMm: number, j = JAWS) {
  const t = torqueNm * 1000
  if (kind === 'rack') return t / (2 * j.pinionMm)
  if (kind === 'linkage') return t / (2 * j.crankMm * Math.max(0.05, Math.sin((servoDeg + j.crankStartDeg) * DEG)))
  return t / (2 * angularTouchDeg(radiusMm, j).armMm)
}

/** Position servo pushing past contact: torque ramps over its proportional band, then stalls. */
export const servoSqueezeNm = (cmdDeg: number, touchDeg: number, stallNm: number, bandDeg = SERVO_BAND_DEG) => stallNm * clamp01((cmdDeg - touchDeg) / bandDeg)

/** Squeeze per jaw that lifts m with acceleration a and safety factor s: N ≥ s·m(g + a)/(2μ). */
export const requiredSqueezeN = (massKg: number, mu: number, safety = 1, accel = 0) => (safety * massKg * (G + accel)) / (2 * mu)

/** Vertical hold of two jaws whose faces tilt φ (+ = cradling): 2N(μ·cos φ + sin φ); φ < −atan μ squeezes it out at any force. */
export const jawHoldN = (normalN: number, mu: number, tiltDeg = 0) => Math.max(0, 2 * normalN * (mu * Math.cos(tiltDeg * DEG) + Math.sin(tiltDeg * DEG)))
export const squeezesOut = (mu: number, tiltDeg: number) => -tiltDeg * DEG > Math.atan(mu)

// --- Suction ---

/** F = ΔP·A: kPa on a cup of Ø d mm, N. */
export const suctionForceN = (vacKPa: number, diaMm: number) => (vacKPa * circleAreaMm2(diaMm)) / 1000

export const ATM_KPA = 101.3
/** Small 6 V diaphragm pump (linear curve), cup + hose volume; leak conductance per surface, ml/s per kPa; cup rubber μ. */
export const VAC_PUMP = { maxKPa: 65, maxMlS: 83, volMl: 60, muCup: 0.5 }
export const VAC_SURFACES = { glass: 0, cardboard: 0.8, textured: 3 }
export type VacSurface = keyof typeof VAC_SURFACES

/** Pump curve Q = Qmax(1 − ΔP/ΔPmax) meets leak Q = C·ΔP. */
export const vacuumSteadyKPa = (leak: number, p = VAC_PUMP) => p.maxKPa / (1 + (leak * p.maxKPa) / p.maxMlS)
/** Pull-down time constant τ = V / (Patm·(Qmax/ΔPmax + C)), s. */
export const vacuumTauS = (leak: number, p = VAC_PUMP) => p.volMl / (ATM_KPA * (p.maxMlS / p.maxKPa + leak))
export const vacuumAt = (t: number, leak: number, p = VAC_PUMP) => (t <= 0 ? 0 : vacuumSteadyKPa(leak, p) * (1 - Math.exp(-t / vacuumTauS(leak, p))))

export type PickDir = 'top' | 'side'
/** Cup force needed: from the top m(g + a); on a side face friction carries it, m(g + a)/μ. */
export const suctionNeedN = (massKg: number, accel: number, dir: PickDir, p = VAC_PUMP) => (massKg * (G + accel)) / (dir === 'top' ? 1 : p.muCup)

export interface SuctionOpts {
  diaMm: number
  surface: VacSurface
  massKg: number
  dir: PickDir
}
/** Pump on at 0, lift starts at `liftS`: smooth up-move `heightMm` over `moveS`. */
export const SUCTION_RUN = { liftS: 1.5, moveS: 0.4, heightMm: 90, seconds: 3.4, dt: 0.005 }

/** Cycloidal up-move: z = H(u − sin 2πu / 2π), a = 2πH/T² · sin 2πu (m/s²). */
export function liftAt(t: number, r = SUCTION_RUN) {
  const u = clamp01((t - r.liftS) / r.moveS)
  return { z: r.heightMm * (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI)), accel: ((2 * Math.PI * r.heightMm) / 1000 / r.moveS ** 2) * Math.sin(2 * Math.PI * u) }
}

/** Fixed-step pick: vacuum builds, the arm lifts; the part lets go the first time cup force < need, then free-falls. */
export function suctionRun(o: SuctionOpts, r = SUCTION_RUN) {
  const leak = VAC_SURFACES[o.surface]
  const frames: { t: number; vac: number; force: number; need: number; z: number; partZ: number; held: boolean }[] = []
  let dropT = NaN
  let dropZ = 0
  for (let i = 0; i * r.dt <= r.seconds + 1e-9; i++) {
    const t = i * r.dt
    const vac = vacuumAt(t, leak)
    const force = suctionForceN(vac, o.diaMm)
    const { z, accel } = liftAt(t, r)
    const need = suctionNeedN(o.massKg, accel, o.dir)
    if (Number.isNaN(dropT) && t >= r.liftS && force < need) [dropT, dropZ] = [t, z]
    const held = Number.isNaN(dropT)
    const fall = held ? 0 : 0.5 * G * 1000 * (t - dropT) ** 2
    frames.push({ t, vac, force, need, z, partZ: held ? z : Math.max(0, dropZ - fall), held })
  }
  return { frames, dropT, dropZ }
}

// --- Underactuated tendon finger ---

/** Two phalanges on one tendon (pulley radii r), return springs k (N·mm/rad), distal spring preload (holds it straight until the proximal is blocked); base half-spacing, link half-thickness, depth of the ball centre below the palm; rigid claw θ2 = claw·θ1. */
export const FINGER = { l1: 50, l2: 36, r1: 18, r2: 6, k1: 150, k2: 40, pre2: 30, baseMm: 36, halfW: 5, depthMm: 36, maxDeg: 100, claw: 0.6 }
export type Finger = typeof FINGER
export type FingerKind = 'underactuated' | 'rigid'

type P2 = [number, number]
/** Right finger hanging from (b, 0) curling toward −x: joint, tip. Left finger = mirror. */
export function fingerPoints(t1: number, t2: number, b = FINGER.baseMm, f = FINGER): [P2, P2, P2] {
  const j: P2 = [b - f.l1 * Math.sin(t1), -f.l1 * Math.cos(t1)]
  return [[b, 0], j, [j[0] - f.l2 * Math.sin(t1 + t2), j[1] - f.l2 * Math.cos(t1 + t2)]]
}

/** Closest point of segment ab to c: distance and distance along from a. */
export function segmentNearest(a: P2, b: P2, c: P2) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  const s = clamp(((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / (len * len), 0, 1)
  const p: P2 = [a[0] + s * dx, a[1] + s * dy]
  return { dist: Math.hypot(c[0] - p[0], c[1] - p[1]), along: s * len, p }
}

const clear = (t1: number, t2: number, c: P2, R: number, f: Finger) => {
  const [b, j, tip] = fingerPoints(t1, t2, f.baseMm, f)
  return Math.min(segmentNearest(b, j, c).dist, segmentNearest(j, tip, c).dist) - (R + f.halfW)
}
/** Furthest angle from `from` toward `to` (marching ≤ 1°, then bisecting) at which `ok` still holds: no tunnelling through the ball. */
const advance = (from: number, to: number, ok: (th: number) => boolean) => {
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / DEG))
  let lo = from
  for (let i = 1; i <= n; i++) {
    const th = from + ((to - from) * i) / n
    if (!ok(th)) {
      let hi = th
      for (let k = 0; k < 24; k++) {
        const m = (lo + hi) / 2
        if (ok(m)) lo = m
        else hi = m
      }
      return lo
    }
    lo = th
  }
  return to
}

export interface FingerContact {
  link: 1 | 2
  /** Contact point (finger frame), along the link from its joint, force N and its unit direction onto the ball. */
  p: P2
  along: number
  forceN: number
  n: P2
}
export interface FingerState {
  t1: number
  t2: number
  contacts: FingerContact[]
  /** The proximal contact would need to pull: the ball is pushed out of the wrap. */
  ejects: boolean
}

/** Quasi-static close of one right-hand finger on a ball at c (finger frame) as tendon tension ramps to T. */
export function fingerClose(kind: FingerKind, tensionN: number, c: P2, R: number, f: Finger = FINGER, steps = 60): FingerState {
  const lim = f.maxDeg * DEG
  let t1 = 0
  let t2 = 0
  for (let i = 1; i <= steps; i++) {
    const T = (tensionN * i) / steps
    if (kind === 'rigid') {
      const want = Math.min(lim, (T * f.r1) / f.k1)
      if (want > t1) t1 = advance(t1, want, (th) => clear(th, f.claw * th, c, R, f) >= 0)
      t2 = f.claw * t1
      continue
    }
    for (let pass = 0; pass < 2; pass++) {
      const w1 = Math.min(lim, (T * f.r1) / f.k1)
      if (w1 > t1) t1 = advance(t1, w1, (th) => clear(th, t2, c, R, f) >= 0)
      const w2 = Math.min(lim, Math.max(0, T * f.r2 - f.pre2) / f.k2)
      if (w2 > t2) t2 = advance(t2, w2, (th) => clear(t1, th, c, R, f) >= 0)
    }
  }
  return { t1, t2, ...fingerForces(kind, tensionN, t1, t2, c, R, f) }
}

/** Lever arm about joint `o` of the ball pushing back on the finger (−n) at p: positive resists closing. */
const armAbout = (o: P2, p: P2, n: P2) => (p[0] - o[0]) * -n[1] - (p[1] - o[1]) * -n[0]

/** Contact forces from joint torques τ1 = T·r1 − k1θ1, τ2 = T·r2 − k2θ2 − preload: F2 = τ2/a22, F1 = (τ1 − F2·a21)/a11 (aᵢⱼ: arm of contact j about joint i; = d2 and d2 + L1·cos θ2 for a square push).
 *  A touch within `knuckle` mm of the middle joint counts as the proximal link's end. Rigid claw: τ = T·r1 on its one contact. */
export function fingerForces(kind: FingerKind, T: number, t1: number, t2: number, c: P2, R: number, f: Finger = FINGER, tol = 0.3, knuckle = 6) {
  const [b, j, tip] = fingerPoints(t1, t2, f.baseMm, f)
  const touch = ([a, e]: [P2, P2], link: 1 | 2): FingerContact | null => {
    const s = segmentNearest(a, e, c)
    if (s.dist > R + f.halfW + tol) return null
    return { link, p: s.p, along: s.along, forceN: 0, n: [(c[0] - s.p[0]) / s.dist, (c[1] - s.p[1]) / s.dist] }
  }
  let c1 = touch([b, j], 1)
  let c2 = touch([j, tip], 2)
  if (c2 && c2.along < knuckle) [c1, c2] = [c1 ?? { ...c2, link: 1, along: f.l1 }, null]
  let ejects = false
  if (kind === 'rigid') {
    const k = c1 ?? c2
    if (k) k.forceN = (T * f.r1) / Math.max(1, armAbout(b, k.p, k.n))
    return { contacts: k ? [k] : [], ejects }
  }
  const tau1 = Math.max(0, T * f.r1 - f.k1 * t1)
  const tau2 = Math.max(0, T * f.r2 - f.pre2 - f.k2 * t2)
  if (c2) c2.forceN = tau2 / Math.max(1, armAbout(j, c2.p, c2.n))
  if (c1) {
    const f1 = (tau1 - (c2 ? c2.forceN * armAbout(b, c2.p, c2.n) : 0)) / Math.max(1, armAbout(b, c1.p, c1.n))
    ejects = f1 < 0
    c1.forceN = Math.max(0, f1)
  }
  return { contacts: [c1, c2].filter((k): k is FingerContact => !!k && k.forceN > 1e-6), ejects }
}

/** Two fingers (mirror pair) on a ball offset e from centre; the rigid pair is position-driven, so it shoves the ball to the middle first. */
export function gripWrap(kind: FingerKind, tensionN: number, R: number, offsetMm: number, f: Finger = FINGER) {
  const depth = f.depthMm
  const x = kind === 'rigid' ? 0 : offsetMm
  const right = fingerClose(kind, tensionN, [x, -depth], R, f)
  const left = fingerClose(kind, tensionN, [-x, -depth], R, f)
  return { x, depth, shoveMm: Math.abs(offsetMm - x), right, left, contacts: right.contacts.length + left.contacts.length }
}

/** Upward hold from contacts: each gives F(n_y + μ·|n_x|) (cradling plus friction), N. */
export const wrapHoldN = (contacts: readonly FingerContact[], mu: number) => contacts.reduce((s, k) => s + k.forceN * Math.max(0, k.n[1] + mu * Math.abs(k.n[0])), 0)
