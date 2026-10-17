// Centre of mass: combined CoM of parts, where gravity plus the inertial force through it meets the floor, tip angles and accelerations, a tilting-table tip-over.
import { G } from '../common'

interface MassPart {
  kg: number
  x: number
  z: number
}

export function massCentre(parts: readonly MassPart[]): MassPart {
  const kg = parts.reduce((s, p) => s + p.kg, 0)
  return { kg, x: parts.reduce((s, p) => s + p.kg * p.x, 0) / kg, z: parts.reduce((s, p) => s + p.kg * p.z, 0) / kg }
}

/** Body frame, x along the floor: where the line from the CoM (x, h) along gravity + the inertial force −m·a meets the floor,
 *  floor pitched θ (+x side up), body accelerating `a` along +x. Stable while it falls between the contact edges. */
export const plumbHit = (x: number, h: number, theta: number, a = 0) => x - (h * (G * Math.sin(theta) + a)) / (G * Math.cos(theta))

/** Floor tilt that tips the body over its rear edge (raising +x) and over its front edge (lowering +x). */
export const tipLimits = (x: number, h: number, rear: number, front: number) => ({ back: Math.atan2(x - rear, h), forward: Math.atan2(front - x, h) })

/** Accelerations on slope θ that lift the front wheels (`wheelie`, > 0) and the rear wheels (`nose`, braking, < 0). */
export function tipAccels(x: number, h: number, rear: number, front: number, theta: number) {
  const c = (G * Math.cos(theta)) / h
  return { wheelie: c * (x - rear) - G * Math.sin(theta), nose: c * (x - front) - G * Math.sin(theta) }
}

interface TableFrame {
  t: number
  tilt: number
  roll: number
}

/** Table tilts (+x side up) linearly to `tilt` over `ramp` s and holds; once the CoM passes over the rear edge the body
 *  pivots on it (`roll`), I = m·(r² + gyr²), until it lies on its back (roll = π/2). */
export function tableTipRun({ x, h, rear, tilt, ramp, seconds, gyr, dt = 0.002 }: { x: number; h: number; rear: number; tilt: number; ramp: number; seconds: number; gyr: number; dt?: number }) {
  const beta = Math.atan2(x - rear, h)
  const r = Math.hypot(x - rear, h)
  const k = (G * r) / (r * r + gyr * gyr)
  const out: TableFrame[] = []
  let roll = 0
  let w = 0
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const t = i * dt
    const th = tilt * Math.min(1, t / ramp)
    out.push({ t, tilt: th, roll })
    const psi = th + roll
    if (roll >= Math.PI / 2) continue
    if (roll > 0 || psi > beta) {
      w += k * Math.sin(psi - beta) * dt
      roll = Math.min(Math.PI / 2, Math.max(0, roll + w * dt))
      if (roll === 0) w = Math.max(0, w)
    }
  }
  const tipAt = out.find((f) => f.roll > 0)?.t ?? Infinity
  return { frames: out, beta, tipAt, dt }
}

/** Two chassis compared in "Low and wide": wheelbase, ground clearance, body height (m), body + battery mass (kg). */
export const TIP_DESIGNS = {
  tall: { name: 'tall and narrow', wheelbase: 0.12, clear: 0.03, bodyH: 0.2, bodyKg: 0.8, battKg: 0.4 },
  wide: { name: 'low and wide', wheelbase: 0.22, clear: 0.02, bodyH: 0.07, bodyKg: 0.8, battKg: 0.4 },
}
export type TipDesign = keyof typeof TIP_DESIGNS
export const BATT_H = 0.03

/** CoM of a design with the battery on the floor plate (`low`) or on the roof (`high`), `shift` m forward of centre. */
export function designCom(d: TipDesign, high: boolean, shift = 0) {
  const s = TIP_DESIGNS[d]
  const battZ = high ? s.clear + s.bodyH + BATT_H / 2 : s.clear + BATT_H / 2 + 0.005
  return massCentre([
    { kg: s.bodyKg, x: 0, z: s.clear + s.bodyH / 2 },
    { kg: s.battKg, x: shift, z: battZ },
  ])
}
