/** Median wall time in ms of `times` calls of `run(i)`, so speed tests ride out a single slow run under machine load. */
export function medianMs(run: (i: number) => void, times = 5) {
  const ms = Array.from({ length: times }, (_, i) => {
    const t0 = performance.now()
    run(i)
    return performance.now() - t0
  }).sort((a, b) => a - b)
  return ms[Math.floor(times / 2)]
}
