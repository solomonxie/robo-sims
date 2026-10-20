// Fault hunts: a symptom, a list of suspects, test points; every suspect predicts a reading at every probe.
// The learner probes, compares with what each suspect predicts and picks a diagnosis.
import { seededRng } from '../common'
import { PuzzleVerdict, puzzleVerdict } from '../challenges/verdict'

export type MeterUnit = 'V' | 'A' | 'Ω' | '°C'

/** What the meter shows: a value, or `open` (OL); `alt` = a second value it flickers to (a supply hiccuping);
 *  `label` = what it is on (a thermal camera's hottest part). */
export interface MeterRead {
  value: number
  unit: MeterUnit
  open?: boolean
  alt?: number
  label?: string
}

export interface FaultHunt<F extends string, P extends string> {
  faults: readonly F[]
  probes: readonly P[]
  /** The reading at `probe` with `fault` in the build ('ok' = a healthy build). */
  read: (fault: F | 'ok', probe: P) => MeterRead
}

/** Absolute tolerance per unit a hobby meter tells apart (plus 5 % of the value). */
const TOL: Record<MeterUnit, number> = { V: 0.15, A: 0.02, 'Ω': 0.5, '°C': 5 }

/** Two readings a person with a meter can't tell apart. */
export function sameReading(a: MeterRead, b: MeterRead): boolean {
  if (a.unit !== b.unit || !!a.open !== !!b.open || a.label !== b.label) return false
  if (a.open) return true
  if ((a.alt === undefined) !== (b.alt === undefined)) return false
  const near = (x: number, y: number) => Math.abs(x - y) <= TOL[a.unit] + 0.05 * Math.max(Math.abs(x), Math.abs(y))
  return near(a.value, b.value) && (a.alt === undefined || near(a.alt, b.alt!))
}

/** Every suspect (and 'ok') × every probe. */
export function faultTable<F extends string, P extends string>(h: FaultHunt<F, P>) {
  const rows = ['ok' as const, ...h.faults]
  return Object.fromEntries(rows.map((f) => [f, Object.fromEntries(h.probes.map((p) => [p, h.read(f, p)]))])) as Record<F | 'ok', Record<P, MeterRead>>
}

/** Suspects a reading at `probe` rules out when `truth` is the real fault. */
export const ruledOutBy = <F extends string, P extends string>(h: FaultHunt<F, P>, truth: F, probe: P) =>
  h.faults.filter((f) => f !== truth && !sameReading(h.read(f, probe), h.read(truth, probe)))

/** Suspects still standing after `probes`. */
export const stillSuspect = <F extends string, P extends string>(h: FaultHunt<F, P>, truth: F, probes: readonly P[]) =>
  h.faults.filter((f) => probes.every((p) => sameReading(h.read(f, p), h.read(truth, p))))

/** First probe (in list order) that tells `other` from `truth`, or null if none does. */
export const decisiveProbe = <F extends string, P extends string>(h: FaultHunt<F, P>, truth: F, other: F) =>
  h.probes.find((p) => !sameReading(h.read(other, p), h.read(truth, p))) ?? null

/** Greedy shortest probe list that leaves only `truth`: each step takes the probe ruling out the most. */
export function probesNeeded<F extends string, P extends string>(h: FaultHunt<F, P>, truth: F): P[] {
  const out: P[] = []
  while (stillSuspect(h, truth, out).length > 1 && out.length < h.probes.length) {
    const left = stillSuspect(h, truth, out)
    const gain = (p: P) => left.filter((f) => !sameReading(h.read(f, p), h.read(truth, p))).length
    const best = h.probes.filter((p) => !out.includes(p)).reduce((a, b) => (gain(b) > gain(a) ? b : a))
    if (gain(best) === 0) break
    out.push(best)
  }
  return out
}

/** Seeded shuffle of the suspects: case k (0-based) hides fault [k], so every suspect is the answer to exactly one case. */
export function caseFaults<F extends string>(faults: readonly F[], seed: number): F[] {
  const rng = seededRng(seed)
  const out = [...faults]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** No diagnosis yet → 'probe' (near); wrong → 'wrong'; right → pass. */
export const huntVerdict = <F extends string>(truth: F, guess: F | null): PuzzleVerdict<'probe' | 'wrong'> =>
  puzzleVerdict<'probe' | 'wrong'>([
    { id: 'probe', ok: guess !== null, near: true },
    { id: 'wrong', ok: guess === truth },
  ])
