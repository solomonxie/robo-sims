// Quartz crystals: Butterworth–Van Dyke model (motional R1, L1, C1 in series, shunted by the holder's C0), load pulling, ppm drift.

export interface Crystal {
  /** Frequency marked on the can, reached with `loadC` across it. */
  nominal: number
  c1: number
  c0: number
  r1: number
  loadC: number
  tolPpm: number
}

/** 16 MHz HC-49/U, AT-cut fundamental, 18 pF load, ±30 ppm. */
export const HC49_16M: Crystal = { nominal: 16e6, c1: 18e-15, c0: 5e-12, r1: 10, loadC: 18e-12, tolPpm: 30 }

const TAU = 2 * Math.PI

/** Fractional rise of the oscillation above series resonance with `cl` across the crystal: C1 / (2 (C0 + CL)). */
export const pullFraction = (x: Crystal, cl: number) => x.c1 / (2 * (x.c0 + cl))

/** Series resonance fs, where L1 and C1 cancel: the cut sets it so `nominal` lands at the rated load. */
export const seriesResonance = (x: Crystal) => x.nominal / (1 + pullFraction(x, x.loadC))

export const motionalL = (x: Crystal) => 1 / ((TAU * seriesResonance(x)) ** 2 * x.c1)

/** Q = ωs L1 / R1 = 1 / (ωs C1 R1). */
export const crystalQ = (x: Crystal) => 1 / (TAU * seriesResonance(x) * x.c1 * x.r1)

/** −3 dB width of the series peak, fs / Q. */
export const crystalBandwidth = (x: Crystal) => seriesResonance(x) / crystalQ(x)

/** Parallel (anti-)resonance, where the motional arm resonates with C0: fs √(1 + C1 / C0). */
export const parallelResonance = (x: Crystal) => seriesResonance(x) * Math.sqrt(1 + x.c1 / x.c0)

/** |Y| of the whole crystal at `f`, siemens. */
export function crystalAdmittance(x: Crystal, f: number): number {
  const w = TAU * f
  const reactance = w * motionalL(x) - 1 / (w * x.c1)
  const d = x.r1 ** 2 + reactance ** 2
  return Math.hypot(x.r1 / d, -reactance / d + w * x.c0)
}

/** Motional (vibration) current at `f` relative to its peak at fs, 0..1. */
export function motionalResponse(x: Crystal, f: number): number {
  const w = TAU * f
  const reactance = w * motionalL(x) - 1 / (w * x.c1)
  return x.r1 / Math.hypot(x.r1, reactance)
}

/** Admittance at `f` relative to series resonance, dB. */
export const responseDb = (x: Crystal, f: number) => 20 * Math.log10(crystalAdmittance(x, f) / crystalAdmittance(x, seriesResonance(x)))

/** Load the crystal sees in a Pierce oscillator: the two caps in series plus pin and trace stray. */
export const loadCapacitance = (ca: number, cb: number, stray: number) => (ca * cb) / (ca + cb) + stray

/** Equal pair of caps that gives load `cl`: 2 (CL − Cstray). */
export const loadCapsFor = (cl: number, stray: number) => 2 * (cl - stray)

/** Running frequency with `cl` across the crystal: fs (1 + C1 / (2 (C0 + CL))). */
export const loadedFrequency = (x: Crystal, cl: number) => seriesResonance(x) * (1 + pullFraction(x, cl))

/** Error from the marked frequency with `cl`, ppm (+ = fast). */
export const pullPpm = (x: Crystal, cl: number) => 1e6 * (loadedFrequency(x, cl) / x.nominal - 1)

export const SECONDS_PER_DAY = 86400

/** Seconds a clock gains (+) or loses per day running `ppm` off. */
export const driftPerDay = (ppm: number) => ppm * 1e-6 * SECONDS_PER_DAY

/** 32.768 kHz watch crystal: 2¹⁵ Hz, so 15 halvings give exactly 1 Hz. */
export const WATCH_HZ = 32768
export const dividerStages = (hz: number) => Math.log2(hz)
