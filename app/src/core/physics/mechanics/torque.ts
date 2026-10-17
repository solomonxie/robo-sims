// Torque and levers: moment arm on a servo horn, the three lever classes, a counterweighted arm in static balance.
import { G } from '../common'
import { Drive } from '../actuators/sizing'
import { servoStiffness } from '../kinematics/armbuild'

/** Force `f` N at `r` m from the pivot, `theta` rad between the arm and the force: τ = F·r·sin θ = F·d. */
export function torqueOf(f: number, r: number, theta: number) {
  const s = Math.sin(theta)
  return { tau: f * r * s, d: Math.abs(r * s), fPerp: f * s, fPar: f * Math.cos(theta) }
}

/** Farthest radius at which a drive can still hold force `f` at `theta` (Infinity along the arm). */
export const reachLimit = (stallNm: number, f: number, theta: number) => {
  const p = Math.abs(f * Math.sin(theta))
  return p < 1e-9 ? Infinity : stallNm / p
}

/** Servo horn under a torque: share of stall, how far the P-band lets it sag, and whether it gets back-driven. */
export function hornSag(tauNm: number, d: Drive) {
  const share = Math.abs(tauNm) / d.stallNm
  return { share, sagRad: Math.min(Math.abs(tauNm), d.stallNm) / servoStiffness(d), slips: share > 1 }
}

export const LEVER_CLASSES = {
  first: { name: 'Class 1: fulcrum in the middle', middle: 'fulcrum', effortDown: true },
  second: { name: 'Class 2: load in the middle', middle: 'load', effortDown: false },
  third: { name: 'Class 3: effort in the middle', middle: 'effort', effortDown: false },
} as const
export type LeverClass = keyof typeof LEVER_CLASSES

/** Beam `len` m with the class's middle element at `pos` (0…1) of the way along; the other two at the ends. */
export function leverLayout(cls: LeverClass, pos: number, len: number) {
  const mid = pos * len
  const at =
    cls === 'first' ? { load: 0, fulcrum: mid, effort: len } : cls === 'second' ? { fulcrum: 0, load: mid, effort: len } : { fulcrum: 0, effort: mid, load: len }
  const effortArm = Math.abs(at.effort - at.fulcrum)
  const loadArm = Math.abs(at.load - at.fulcrum)
  return { cls, len, ...at, effortArm, loadArm, ma: effortArm / loadArm }
}
export type Lever = ReturnType<typeof leverLayout>

/** Effort to hold `loadN` level (weightless beam) and the fulcrum's push on the beam (+ up). */
export function leverForces(l: Lever, loadN: number) {
  const effort = loadN / l.ma
  return { effort, fulcrum: loadN + (LEVER_CLASSES[l.cls].effortDown ? effort : -effort) }
}

/** Arc lengths the effort and load points move when the beam turns `rad`: d_load / d_effort = 1 / MA. */
export const leverTravel = (l: Lever, rad: number) => ({ effort: l.effortArm * Math.abs(rad), load: l.loadArm * Math.abs(rad) })

/** Shoulder boom of a servo arm: 20 cm link (60 g, centre at 10 cm), payload at the tip, counterweight on a stub behind. */
export const BOOM = { lenM: 0.2, linkKg: 0.06, linkM: 0.1 }

export interface BoomLoad {
  payloadKg: number
  counterKg: number
  counterM: number
}

/** Gravity torques about the shoulder at `angle` rad above horizontal (+ = tips the arm down forward), the servo's share and the pivot push. */
export function boomTorques({ payloadKg, counterKg, counterM }: BoomLoad, angle: number) {
  const c = Math.cos(angle) * G
  const payload = payloadKg * BOOM.lenM * c
  const link = BOOM.linkKg * BOOM.linkM * c
  const counter = -counterKg * counterM * c
  const net = payload + link + counter
  return { payload, link, counter, net, servo: -net, pivotN: (payloadKg + BOOM.linkKg + counterKg) * G }
}

/** Counterweight distance that balances the boom exactly (Σ τ = 0 at every angle). */
export const balanceRadius = ({ payloadKg, counterKg }: Omit<BoomLoad, 'counterM'>) =>
  counterKg > 0 ? (payloadKg * BOOM.lenM + BOOM.linkKg * BOOM.linkM) / counterKg : Infinity
