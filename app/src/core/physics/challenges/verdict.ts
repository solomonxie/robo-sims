// Puzzle verdicts: ordered checks; the first failing one is the reason (lessons word it).

interface PuzzleCheck<K extends string = string> {
  id: K
  ok: boolean
  /** Failing, but a close miss (warn tone). */
  near?: boolean
}

export interface PuzzleVerdict<K extends string = string> {
  pass: boolean
  near: boolean
  /** First failing check, null on a pass. */
  fail: K | null
}

export function puzzleVerdict<K extends string>(checks: PuzzleCheck<K>[]): PuzzleVerdict<K> {
  const bad = checks.find((c) => !c.ok)
  return bad ? { pass: false, near: !!bad.near, fail: bad.id } : { pass: true, near: false, fail: null }
}

/** Where `v` sits against [lo, hi]: side −1 below, 0 inside, +1 above; `miss` = fractional distance outside (0 inside). */
export function windowMiss(v: number, lo: number, hi: number): { side: -1 | 0 | 1; miss: number } {
  if (v < lo) return { side: -1, miss: (lo - v) / lo }
  if (v > hi) return { side: 1, miss: (v - hi) / hi }
  return { side: 0, miss: 0 }
}

/** [target·(1 − tol), target·(1 + tol)]. */
export const targetWindow = (target: number, tol: number): [number, number] => [target * (1 - tol), target * (1 + tol)]
