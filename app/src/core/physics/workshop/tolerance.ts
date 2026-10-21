// Tolerances: hole vs shaft limits (clearance / transition / interference), a chain's worst case vs RSS, and how much
// of a printed batch assembles. Printed holes come out small and outsides a little big (Design for printing).
import { gaussRng, parkMiller } from '../common'
import { puzzleVerdict } from '../challenges/verdict'
import { withinSigma } from '../math/probability'
import { BALL_BEARINGS } from '../materials/bearings'
import { FIT, FitClass, FootFix, fitClass, footBulge } from '../printing/design'

/** Φ(z), the standard normal CDF. */
export const normalCdf = (z: number) => 0.5 * (1 + Math.sign(z) * withinSigma(Math.abs(z)))

/** Share of N(mu, sigma) inside [lo, hi]. */
export function yieldIn(lo: number, hi: number, mu: number, sigma: number) {
  if (sigma <= 0) return mu >= lo && mu <= hi ? 1 : 0
  return normalCdf((hi - mu) / sigma) - normalCdf((lo - mu) / sigma)
}

type FitKind = 'clearance' | 'transition' | 'interference'

/** Limits [lo, hi] of a hole and a shaft → smallest and largest clearance and the ISO fit kind. */
export function limitFit(hole: readonly [number, number], shaft: readonly [number, number]) {
  const minC = hole[0] - shaft[1]
  const maxC = hole[1] - shaft[0]
  const kind: FitKind = minC >= 0 ? 'clearance' : maxC <= 0 ? 'interference' : 'transition'
  return { minC, maxC, kind }
}

/** A size in a chain: mean, ± tolerance (taken as 3σ), +1 adds to the gap (hole, slot), −1 takes from it (shaft, part). */
interface StackDim {
  name: string
  mean: number
  tol: number
  sign: 1 | -1
}

/** Gap of a chain: nominal, worst-case ± (Σ tol) and RSS ± (√Σ tol²), σ = RSS / 3. */
export function stackUp(dims: readonly StackDim[]) {
  const mean = dims.reduce((s, d) => s + d.sign * d.mean, 0)
  const wc = dims.reduce((s, d) => s + d.tol, 0)
  const rss = Math.sqrt(dims.reduce((s, d) => s + d.tol * d.tol, 0))
  return { mean, wc, rss, sigma: rss / 3 }
}

/** A printed hole or slot prints this much under its CAD size (typical tuned printer; Design for printing default). */
export const HOLE_SHRINK_MM = 0.1

interface Bought {
  name: string
  /** Nominal and its limits (bought parts' catalogue tolerances). */
  nom: number
  lo: number
  hi: number
}
interface TolJob {
  name: string
  /** What goes in the hole or slot: bought sizes and printed parts (CAD nominal). */
  bought: Bought[]
  printed: { name: string; nom: number }[]
  /** Hole or slot name; wanted clearance window (negative = interference), mm. */
  hole: string
  want: [number, number]
  wantText: string
  /** Least clearance at the mouth before it jams or cracks. */
  mouthMin: number
}

const B608 = BALL_BEARINGS.b608
/** 608 OD 22 0/−0.009 (P0); width 7 0/−0.12; M3 thread major 2.874–2.980 (6g); 8 mm h6 pin 0/−0.009. */
export const TOL_JOBS = {
  bearing: { name: '608 bearing pressed into a printed pocket', bought: [{ name: '608 outer ring', nom: B608.D, lo: B608.D - 0.009, hi: B608.D }], printed: [], hole: 'pocket', want: [-0.12, -0.02], wantText: 'light press', mouthMin: -0.15 },
  screw: { name: 'M3 screw through a printed hole', bought: [{ name: 'M3 thread', nom: 3, lo: 2.874, hi: 2.98 }], printed: [], hole: 'clearance hole', want: [0.15, 0.65], wantText: 'passes, little slop', mouthMin: 0 },
  axle: { name: '8 mm steel pin turning in a printed hole', bought: [{ name: '8 mm pin', nom: FIT.pinMm, lo: FIT.pinMm - 0.009, hi: FIT.pinMm }], printed: [], hole: 'bore', want: [0.1, 0.3], wantText: 'slide: turns freely', mouthMin: 0 },
  stack: {
    name: 'Wheel hub stack between two printed walls',
    bought: [
      { name: '608 bearing', nom: B608.B, lo: B608.B - 0.12, hi: B608.B },
      { name: '608 bearing', nom: B608.B, lo: B608.B - 0.12, hi: B608.B },
    ],
    printed: [{ name: 'spacer', nom: 4 }, { name: 'hub', nom: 12 }],
    hole: 'slot',
    want: [0.05, 0.5],
    wantText: 'axial play 0.05–0.5 mm',
    mouthMin: 0,
  },
} as const satisfies Record<string, TolJob>
export type TolJobKey = keyof typeof TOL_JOBS

/** Seeded batch size shown and its seed. */
export const TOL_BATCH = { n: 60, seed: 11, yieldGoal: 0.99 }

export interface TolCfg {
  job: TolJobKey
  /** CAD hole/slot minus the sum of nominals, mm. */
  cadMm: number
  /** Printer ± (3σ) on every printed size, mm. */
  printTol: number
  foot: FootFix
}

export function tolRun(cfg: TolCfg) {
  const J: TolJob = TOL_JOBS[cfg.job]
  const nomSum = [...J.bought, ...J.printed].reduce((s, d) => s + d.nom, 0)
  const holeCad = nomSum + cfg.cadMm
  const dims: StackDim[] = [
    { name: J.hole, mean: holeCad - HOLE_SHRINK_MM, tol: cfg.printTol, sign: 1 },
    ...J.bought.map((b) => ({ name: b.name, mean: (b.lo + b.hi) / 2, tol: (b.hi - b.lo) / 2, sign: -1 as const })),
    ...J.printed.map((p) => ({ name: p.name, mean: p.nom + FIT.pinGrowMm, tol: cfg.printTol, sign: -1 as const })),
  ]
  const s = stackUp(dims)
  const hole = dims[0]
  const others = dims.slice(1)
  const shaftLo = others.reduce((t, d) => t + d.mean - d.tol, 0)
  const shaftHi = others.reduce((t, d) => t + d.mean + d.tol, 0)
  const limits = limitFit([hole.mean - hole.tol, hole.mean + hole.tol], [shaftLo, shaftHi])
  const foot = cfg.foot === 'none' ? footBulge() : cfg.foot === 'chamfer' ? footBulge(0.5) : 0
  const mouth = s.mean - 2 * foot
  const [lo, hi] = J.want
  // A part fits when it clears the mouth and sits in the window.
  const floor = Math.max(lo, J.mouthMin + 2 * foot)
  const good = floor > hi ? 0 : yieldIn(floor, hi, s.mean, s.sigma)
  const rss: [number, number] = [s.mean - s.rss, s.mean + s.rss]
  const wc: [number, number] = [s.mean - s.wc, s.mean + s.wc]
  const rng = gaussRng(parkMiller(TOL_BATCH.seed))
  const batch = Array.from({ length: TOL_BATCH.n }, () => {
    const c = s.mean + s.sigma * rng()
    const stuck = c - 2 * foot < J.mouthMin
    return { clearance: c, fits: !stuck && c >= lo && c <= hi, cls: fitClass(c) as FitClass, stuck }
  })
  const verdict = puzzleVerdict([
    { id: 'tight', ok: s.mean >= lo, near: s.mean >= lo - (hi - lo) },
    { id: 'loose', ok: s.mean <= hi, near: s.mean <= hi + (hi - lo) },
    { id: 'mouth', ok: mouth >= J.mouthMin, near: mouth >= J.mouthMin - 0.1 },
    { id: 'spread', ok: good >= TOL_BATCH.yieldGoal, near: good >= 0.9 },
  ])
  return { cfg, J, dims, holeCad, ...s, limits, foot, mouth, rssRange: rss, wcRange: wc, wcInside: wc[0] >= lo && wc[1] <= hi, good, batch, verdict }
}
