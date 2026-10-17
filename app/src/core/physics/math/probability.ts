// Probability: Gaussian noise and the central limit, Bayes rule on a noisy detector, variance under averaging and fusion.
import { gaussRng, mean, parkMiller, seededRng, stdDev } from '../common'
import { gaussPdf, kfUpdate } from '../sensors/fusion'

/** Share of a normal distribution within ±k·σ of the mean (erf(k/√2)). */
export function withinSigma(k: number) {
  const x = k / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return erf
}

/** Counts of `xs` in `bins` equal bins over [lo, hi); values outside are dropped. */
export function binCounts(xs: readonly number[], lo: number, hi: number, bins: number) {
  const h = new Array<number>(bins).fill(0)
  for (const x of xs) {
    const i = Math.floor(((x - lo) / (hi - lo)) * bins)
    if (i >= 0 && i < bins) h[i]++
  }
  return h
}

/**
 * Range readings: true distance mu plus noise of std sigma made by summing `sources` independent uniform kicks
 * (each ±a with a = σ·√(3/sources)). One source is flat, two a triangle, more turn into a bell (central limit).
 */
export function noisyReadings(mu: number, sigma: number, sources: number, count: number, seed = 7) {
  const rng = parkMiller(seed * 104729 + sources)
  const a = sigma * Math.sqrt(3 / sources)
  return Array.from({ length: count }, () => {
    let s = 0
    for (let j = 0; j < sources; j++) s += (2 * rng() - 1) * a
    return mu + s
  })
}

/** First `shown` readings binned over μ ± 4σ, with the sample mean/σ, the share inside ±1/2/3σ and the matching normal counts per bin. */
export function gaussianView(mu: number, sigma: number, sources: number, total: number, shown: number, bins = 32) {
  const all = noisyReadings(mu, sigma, sources, total)
  const xs = all.slice(0, Math.max(1, Math.min(total, shown)))
  const [lo, hi] = [mu - 4 * sigma, mu + 4 * sigma]
  const counts = binCounts(xs, lo, hi, bins)
  const w = (hi - lo) / bins
  const share = (k: number) => xs.filter((x) => Math.abs(x - mu) <= k * sigma).length / xs.length
  return {
    xs,
    lo,
    hi,
    counts,
    expected: counts.map((_, i) => xs.length * w * gaussPdf(lo + (i + 0.5) * w, mu, sigma)),
    mean: mean(xs),
    sd: stdDev(xs),
    within: [share(1), share(2), share(3)],
    ideal: [withinSigma(1), withinSigma(2), withinSigma(3)],
  }
}

// --- Bayes rule: is there a door ahead? A detector beeps with P(beep | door) = hit, P(beep | wall) = falseAlarm. ---

/** One Bayes step on P(door): prior × likelihood, normalised by the evidence P(reading). */
export function bayesStep(prior: number, hit: number, falseAlarm: number, beep: boolean) {
  const [lDoor, lWall] = beep ? [hit, falseAlarm] : [1 - hit, 1 - falseAlarm]
  const door = prior * lDoor
  const wall = (1 - prior) * lWall
  const evidence = door + wall
  return { lDoor, lWall, door, wall, evidence, posterior: evidence > 0 ? door / evidence : prior }
}

/** Seeded detector readings when the truth is a door (or a wall). */
export const detectorReadings = (door: boolean, hit: number, falseAlarm: number, count: number, seed = 3) => {
  const rng = seededRng(seed)
  return Array.from({ length: count }, () => rng() < (door ? hit : falseAlarm))
}

/** Belief after each of `count` readings: beliefs[0] = prior; log-odds grow by log(hit/falseAlarm) per beep. */
export function bayesRun(prior: number, hit: number, falseAlarm: number, door: boolean, count: number) {
  const reads = detectorReadings(door, hit, falseAlarm, count)
  const beliefs = [prior]
  const steps = reads.map((beep) => {
    const s = bayesStep(beliefs[beliefs.length - 1], hit, falseAlarm, beep)
    beliefs.push(s.posterior)
    return s
  })
  return { reads, beliefs, steps, logOdds: beliefs.map((p) => Math.log(p / (1 - p))) }
}

// --- Variance: averaging N readings shrinks σ by √N; two sensors fuse by inverse-variance weights. ---

/** `batches` averages of n readings each (σ = sigma) and their spread; σ/√n is the prediction. */
export function averageView(mu: number, sigma: number, n: number, batches = 400, seed = 11) {
  const g = gaussRng(parkMiller(seed))
  const avgs = Array.from({ length: batches }, () => {
    let s = 0
    for (let j = 0; j < n; j++) s += g()
    return mu + (sigma * s) / n
  })
  return { avgs, sd: stdDev(avgs), predicted: sigma / Math.sqrt(n) }
}

/** Fuse readings zA (σA) and zB (σB): weights ∝ 1/σ², fused σ² = 1/(1/σA² + 1/σB²), the same as one Kalman update. */
export function fuseTwo(zA: number, sigmaA: number, zB: number, sigmaB: number) {
  const u = kfUpdate({ x: zA, P: sigmaA ** 2 }, zB, sigmaB ** 2)
  return { x: u.x, sigma: Math.sqrt(u.P), wA: 1 - u.K, wB: u.K }
}

/** n seeded readings of sensor A (σA) averaged to σA/√n, then fused with one reading of sensor B (σB): all looking at a wall at mu. */
export function varianceView(mu: number, sigmaA: number, sigmaB: number, n: number, seed = 5) {
  const g = gaussRng(seededRng(seed))
  const zB = mu + sigmaB * g()
  const readsA = Array.from({ length: n }, () => mu + sigmaA * g())
  const avgA = mean(readsA)
  const sigmaAvg = sigmaA / Math.sqrt(n)
  return { readsA, avgA, sigmaAvg, zB, fused: fuseTwo(avgA, sigmaAvg, zB, sigmaB) }
}
