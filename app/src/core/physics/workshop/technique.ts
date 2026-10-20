// Hands-on technique helpers shared by the workshop topics: bench ambient, temperature-doubling rates, two-sided window checks.

/** Bench (room) temperature, °C. */
export const BENCH_C = 25

/** Rate that doubles every `doubleC` °C: 1 / `refS` per second at `refC` (thermally activated wear, burn-off, oxidation). */
export const doublingRate = (tC: number, refC: number, refS: number, doubleC: number) => 2 ** ((tC - refC) / doubleC) / refS

/** Two `puzzleVerdict` checks for a value that must sit in [lo, hi]: `lowId` / `highId` fail outside, near within `slack` (fraction). */
export function bandChecks<K extends string>(lowId: K, highId: K, v: number, lo: number, hi: number, slack = 0.3) {
  return [
    { id: lowId, ok: v >= lo, near: v >= lo * (1 - slack) },
    { id: highId, ok: v <= hi, near: v <= hi * (1 + slack) },
  ]
}
