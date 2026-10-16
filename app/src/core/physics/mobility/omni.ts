// Omni drive: wheels with free rollers at 90° push only along their rolling direction; kiwi (3 × 120°) and X (4 × 90°) bases.
import { fitTwist, mecInverse } from './mecanum'

export type OmniBase = 'kiwi' | 'x'
/** 58 mm double-row omni wheels; kiwi wheels 115 mm from the centre, X wheels 125 mm (on the diagonals). */
export const OMNI = { wheelR: 0.029, kiwiR: 0.115, xR: 0.125, maxRim: 0.6, rollers: 6, rollerR: 0.0075 }

const wheel = (name: string, phiDeg: number, r: number, dDeg: number) => {
  const phi = (phiDeg * Math.PI) / 180
  return { name, x: r * Math.cos(phi), y: r * Math.sin(phi), d: (dDeg * Math.PI) / 180 }
}

/** Wheel centres (x forward, y left) and each wheel's rolling direction d (rad from +x); + rim speed rolls along d. */
export function omniWheels(base: OmniBase, g = OMNI) {
  return base === 'kiwi'
    ? [wheel('FL', 60, g.kiwiR, -30), wheel('FR', -60, g.kiwiR, 30), wheel('B', 180, g.kiwiR, 90)]
    : [wheel('FL', 45, g.xR, -45), wheel('FR', -45, g.xR, 45), wheel('RL', 135, g.xR, 45), wheel('RR', -135, g.xR, -45)]
}

const row = (k: { x: number; y: number; d: number }) => [Math.cos(k.d), Math.sin(k.d), k.x * Math.sin(k.d) - k.y * Math.cos(k.d)]

/** Rim speed per wheel for body twist vx, vy (m/s), ω (rad/s, CCW +): the wheel-point velocity projected on its rolling direction. */
export const omniInverse = (vx: number, vy: number, w: number, base: OmniBase, g = OMNI) =>
  omniWheels(base, g).map((k) => row(k).reduce((a, c, i) => a + c * [vx, vy, w][i], 0))

/** Speed each wheel's rollers spin off sideways (along its axle) for that twist. */
export const omniSideSlip = (vx: number, vy: number, w: number, base: OmniBase, g = OMNI) =>
  omniWheels(base, g).map((k) => -(vx - w * k.y) * Math.sin(k.d) + (vy + w * k.x) * Math.cos(k.d))

/** Twist from measured rim speeds (exact for kiwi, least squares for X) and each wheel's leftover. */
export function omniForward(s: number[], base: OmniBase, g = OMNI) {
  const J = omniWheels(base, g).map(row)
  const [vx, vy, w] = fitTwist(J, s)
  return { vx, vy, w, scrub: J.map((r, i) => s[i] - (r[0] * vx + r[1] * vy + r[2] * w)) }
}

export type HoloDrive = OmniBase | 'mecanum'
/** Top ground speed heading at angle a (rad, body frame) when no rim may exceed maxRim. */
export function holoTopSpeed(drive: HoloDrive, a: number, maxRim = OMNI.maxRim) {
  const [vx, vy] = [Math.cos(a), Math.sin(a)]
  const s = drive === 'mecanum' ? mecInverse(vx, vy, 0) : omniInverse(vx, vy, 0, drive)
  return maxRim / Math.max(...s.map(Math.abs))
}
