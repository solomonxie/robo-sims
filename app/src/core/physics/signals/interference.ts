// Interference: ground-loop hum, twisted-pair cancellation, capacitive pickup and cable shields.
const TAU = 2 * Math.PI

/** Peak EMF from a flux `fluxPeak` (Wb) alternating at `hz`. */
export const emfPeak = (fluxPeak: number, hz: number) => TAU * hz * fluxPeak

/** Peak EMF around a loop of `areaM2` in a uniform field of peak `bT` at `hz`. */
export const loopEmf = (bT: number, areaM2: number, hz: number) => emfPeak(bT * areaM2, hz)

export interface LoopSpec {
  bT: number
  areaM2: number
  hz: number
  loopOhms: number
  sharedOhms: number
}

/** Induced EMF drives a current round the closed loop; the slice through the signal's ground wire becomes hum. */
export function groundLoop(s: LoopSpec, closed = true) {
  const emf = loopEmf(s.bT, s.areaM2, s.hz)
  const amps = closed ? emf / s.loopOhms : 0
  return { emf, amps, hum: amps * s.sharedOhms }
}

/** Field through a cable's plane from a motor `h` to the side at `x0`, its axis normal to that plane; `b0` at the closest point. */
export const motorField = (b0: number, h: number, x0 = 0) => (x: number) => b0 * (h / Math.hypot(x - x0, h)) ** 3

/** Signed width of a pair's loop as seen by a field normal to the cable's plane, as a fraction of the gap:
 *  a twisted pair rolls over, so its loop flips side every half-twist. Cable centred on 0. */
export const pairFacing = (x: number, lengthM: number, twistsPerM: number) =>
  twistsPerM > 0 ? Math.sin(TAU * twistsPerM * (x + lengthM / 2)) : 1

/** Net flux through a pair `gapM` apart and `lengthM` long in field `b(x)`. */
export function pairFlux(b: (x: number) => number, lengthM: number, gapM: number, twistsPerM: number, steps = 4000) {
  const dx = lengthM / steps
  let sum = 0
  for (let i = 0; i < steps; i++) {
    const x = -lengthM / 2 + (i + 0.5) * dx
    sum += pairFacing(x, lengthM, twistsPerM) * b(x)
  }
  return sum * dx * gapM
}

/** Voltage a source couples through `farads` into an input of `ohms` (high-pass divider). */
export const capPickup = (volts: number, hz: number, farads: number, ohms: number) => {
  const x = TAU * hz * farads * ohms
  return (volts * x) / Math.hypot(1, x)
}

export type Shield = 'none' | 'floating' | 'one' | 'both'

export interface ShieldSpec {
  volts: number
  hz: number
  couple: number
  shieldToGround: number
  coreToShield: number
  ohms: number
  leak: number
}

/** Electric-field pickup on a cable's core: a floating shield is charged by the source and passes it on;
 *  a grounded one drains it, letting only `leak` through. */
export function shieldPickup(shield: Shield, s: ShieldSpec) {
  const bare = capPickup(s.volts, s.hz, s.couple, s.ohms)
  if (shield === 'none') return { shieldV: 0, core: bare }
  if (shield === 'floating') {
    const shieldV = (s.volts * s.couple) / (s.couple + s.shieldToGround)
    return { shieldV, core: capPickup(shieldV, s.hz, s.coreToShield, s.ohms) }
  }
  return { shieldV: 0, core: s.leak * bare }
}
