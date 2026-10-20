import { DIODES, Diode, Mosfet, diodeAmps, diodeNode, rdsOn } from './semiconductors'

/** Glass 5×20 mm fuse element as one thermal lump: heat 1 = melting. `minMeltA` is the smallest current that ever melts it,
 *  `tauS` its thermal time constant (bigger mass = slow-blow). */
export interface Fuse {
  ratedA: number
  minMeltA: number
  tauS: number
}

export const FUSES = {
  F1A: { ratedA: 1, minMeltA: 1.8, tauS: 0.25 },
  T1A: { ratedA: 1, minMeltA: 1.8, tauS: 2 },
} satisfies Record<string, Fuse>

/** Where the element's heat settles at `amps` (I²R in, loss ∝ rise out); ≥ 1 means it melts. */
export const fuseHeat = (amps: number, f: Fuse) => (amps / f.minMeltA) ** 2

/** Exact first-order step of the element's heat. */
export function fuseStep(heat: number, amps: number, dt: number, f: Fuse) {
  const target = fuseHeat(amps, f)
  return target + (heat - target) * Math.exp(-dt / f.tauS)
}

/** Time-current curve: seconds from `heat` to melting at `amps`; Infinity if it never melts. */
export function fuseMeltTime(amps: number, f: Fuse, heat = 0) {
  const target = fuseHeat(amps, f)
  return target <= 1 ? Infinity : f.tauS * Math.log((target - heat) / (target - 1))
}

/** Melting I²t, A²s; tends to τ·Imin² for big faults (too fast to lose heat). */
export const fuseI2t = (amps: number, f: Fuse) => amps * amps * fuseMeltTime(amps, f)

/** Diode in series with `ohms`: bisection on its drop, signed with `vs`. */
export function seriesDiode(vs: number, ohms: number, d: Diode) {
  let lo = Math.min(0, vs)
  let hi = Math.max(0, vs)
  for (let k = 0; k < 80; k++) {
    const v = (lo + hi) / 2
    if (diodeAmps(v, d) < (vs - v) / ohms) lo = v
    else hi = v
  }
  const v = (lo + hi) / 2
  return { v, amps: (vs - v) / ohms }
}

export type Guard = 'none' | 'diode' | 'pfet'
export const BATTERY_OHMS = 0.1
/** IRF4905 P-MOSFET (|Vgs| values): ~20 mΩ at 10 V. */
export const IRF4905: Mosfet = { vthV: 3, k: 7.1, n: 1.5 }

/** Battery `vb` (negative = in backwards) into a load through a reverse-polarity guard. With no guard a backwards battery
 *  drives the chip's substrate diodes straight across the cell. Diode guard: series 1N4007. P-FET guard: high side, gate to
 *  ground, so Vgs = −V and it turns on only the right way round; its body diode blocks the wrong way. `batteryOhms` = the
 *  pack's internal + wiring resistance. */
export function reverseGuard(vb: number, loadOhms: number, guard: Guard, batteryOhms = BATTERY_OHMS) {
  const r = loadOhms + batteryOhms
  const d = DIODES['1N4007']
  if (guard === 'none') {
    if (vb >= 0) return { vLoad: (vb * loadOhms) / r, amps: vb / r, guardV: 0 }
    const sub = diodeNode(-vb, batteryOhms, d, { load: loadOhms })
    return { vLoad: -sub.v, amps: -sub.sourceA, guardV: 0 }
  }
  const rds = guard === 'pfet' && vb > 0 ? rdsOn(vb, IRF4905) : Infinity
  if (Number.isFinite(rds)) {
    const amps = vb / (r + rds)
    return { vLoad: amps * loadOhms, amps, guardV: amps * rds }
  }
  const s = seriesDiode(vb, r, d)
  return { vLoad: s.amps * loadOhms, amps: s.amps, guardV: s.v }
}

/** P6KE15A transient suppressor for a 12 V rail: 1 mA at 15 V, clamps 21.2 V at 28 A. */
export const P6KE15A: Diode = { saturationA: 1e-9, ideality: 2, breakdownV: 15.05, kneeA: 1e-3, breakdownIdeality: 23.2 }

/** 8/20 µs surge shape: peaks at 1 at 8 µs, half by 20 µs. */
export function surge(t: number) {
  if (t <= 0) return 0
  const x = t / 8e-6
  return Math.pow(x, 1.19) * Math.exp(1.19 * (1 - x))
}

/** Rail `vs` through the source's `ohms` into a chip load, optionally with the TVS from rail to ground. */
export function tvsNode(vs: number, ohms: number, loadOhms: number, fitted: boolean) {
  if (!fitted) {
    const v = (vs * loadOhms) / (loadOhms + ohms)
    return { v, tvsA: 0, loadA: v / loadOhms }
  }
  const r = diodeNode(vs, ohms, P6KE15A, { reversed: true, load: loadOhms })
  return { v: r.v, tvsA: r.diodeA, loadA: r.loadA }
}
