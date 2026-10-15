// Supply noise: a rail fed through wire R + L, held up by real capacitors (C with ESR and ESL), and LC filters between rails.

const TAU = 2 * Math.PI

export interface Cap {
  farads: number
  /** Series resistance, Ω. */
  esr: number
  /** Series inductance of the leads and body, H. */
  esl: number
}

export const CAPS = {
  ceramic10n: { farads: 10e-9, esr: 0.05, esl: 1e-9 },
  ceramic100n: { farads: 100e-9, esr: 0.02, esl: 1e-9 },
  ceramic10u: { farads: 10e-6, esr: 0.005, esl: 2e-9 },
  bulk100u: { farads: 100e-6, esr: 0.1, esl: 10e-9 },
  bulk470u: { farads: 470e-6, esr: 0.08, esl: 15e-9 },
} satisfies Record<string, Cap>

type Z = [number, number]
const capZ = (c: Cap, hz: number): Z => [c.esr, TAU * hz * c.esl - 1 / (TAU * hz * c.farads)]
const zAbs = ([a, b]: Z) => Math.hypot(a, b)
function parallel(x: Z, y: Z): Z {
  const [a, b] = x
  const [c, d] = y
  const [nr, ni] = [a * c - b * d, a * d + b * c]
  const [sr, si] = [a + c, b + d]
  const den = sr * sr + si * si
  return [(nr * sr + ni * si) / den, (ni * sr - nr * si) / den]
}
const bankZ = (caps: Cap[], hz: number): Z | null => caps.reduce<Z | null>((z, c) => (z ? parallel(z, capZ(c, hz)) : capZ(c, hz)), null)

/** |Z| of one real capacitor at `hz`: ESR, plus ESL's reactance fighting the capacitance's. */
export const capOhms = (c: Cap, hz: number) => zAbs(capZ(c, hz))

/** |Z| of capacitors in parallel at `hz`; Infinity for none. */
export const bankOhms = (caps: Cap[], hz: number) => {
  const z = bankZ(caps, hz)
  return z ? zAbs(z) : Infinity
}

/** Self-resonant frequency, 1 / 2π√(ESL·C): above it the capacitor acts as an inductor. */
export const selfResonance = (c: Cap) => 1 / (TAU * Math.sqrt(c.esl * c.farads))

/** LC low-pass corner, 1 / 2π√(LC). */
export const lcCutoff = (henries: number, farads: number) => 1 / (TAU * Math.sqrt(henries * farads))

/** Fraction of a noise voltage at `hz` that gets past a series L (+ R) into shunt capacitors: |Zc| / |Z_L + Zc|. */
export function lcGain(hz: number, henries: number, ohms: number, caps: Cap[]) {
  const zc = bankZ(caps, hz)
  if (!zc) return 1
  return zAbs(zc) / zAbs([ohms + zc[0], TAU * hz * henries + zc[1]])
}

export const decibels = (gain: number) => 20 * Math.log10(gain)

/** A supply node fed from `vs` through wire `ohms` + `henries`, with `stray` capacitance and real `caps` on it. */
export interface Rail {
  vs: number
  ohms: number
  henries: number
  stray: number
  caps: Cap[]
}

/** Node voltage of each stage, sampled every `every` s over `seconds`. Stage k > 0 is fed from stage k − 1's node
 *  (its wire current adds to that node's load); `loads[k](t)` is the current drawn at stage k. Starts settled at t = 0. */
export function railTrace(stages: Rail[], loads: ((t: number) => number)[], seconds: number, every: number, dt = 1e-9) {
  const st = stages.map((r) => ({ i: 0, v: 0, b: r.caps.map(() => ({ i: 0, v: 0 })) }))
  for (let k = stages.length - 1; k >= 0; k--) st[k].i = loads[k](0) + (st[k + 1]?.i ?? 0)
  st.forEach((s, k) => {
    s.v = (k === 0 ? stages[0].vs : st[k - 1].v) - s.i * stages[k].ohms
    for (const b of s.b) b.v = s.v
  })
  const out = stages.map(() => [] as number[])
  const steps = Math.round(seconds / dt)
  const each = Math.max(1, Math.round(every / dt))
  for (let n = 0; n <= steps; n++) {
    const t = n * dt
    if (n % each === 0) st.forEach((s, k) => out[k].push(s.v))
    stages.forEach((r, k) => {
      const s = st[k]
      const vs = k === 0 ? r.vs : st[k - 1].v
      s.i += ((vs - r.ohms * s.i - s.v) / r.henries) * dt
      r.caps.forEach((c, j) => {
        const b = s.b[j]
        b.i += ((s.v - b.v - c.esr * b.i) / c.esl) * dt
      })
    })
    stages.forEach((r, k) => {
      const s = st[k]
      const down = k + 1 < stages.length ? st[k + 1].i : 0
      const into = s.i - loads[k](t) - down - s.b.reduce((a, b) => a + b.i, 0)
      s.v += (into / r.stray) * dt
      r.caps.forEach((c, j) => (s.b[j].v += (s.b[j].i / c.farads) * dt))
    })
  }
  return out
}

/** Downsample to `n` points, each the sample furthest from `ref` in its bin, so narrow spikes survive. */
export function peakBins(samples: number[], n: number, ref: number) {
  return Array.from({ length: n }, (_, k) => {
    const lo = Math.floor((k * samples.length) / n)
    const hi = Math.max(lo + 1, Math.floor(((k + 1) * samples.length) / n))
    let best = samples[lo]
    for (let i = lo; i < hi; i++) if (Math.abs(samples[i] - ref) > Math.abs(best - ref)) best = samples[i]
    return best
  })
}

/** ADC counts of peak-to-peak noise `volts` on an `bits`-bit converter spanning `fullScale`. */
export const noiseCounts = (volts: number, fullScale: number, bits: number) => Math.round((volts / fullScale) * (2 ** bits - 1))

/** PWM motor current at `t`: on from the start of each `period` for `duty` of it, edges ramping over `rise` s. */
export function pwmCurrent(t: number, amps: number, period: number, duty: number, rise: number) {
  const u = ((t % period) + period) % period
  const on = duty * period
  if (u < rise) return (amps * u) / rise
  if (u < on) return amps
  return u < on + rise ? amps * (1 - (u - on) / rise) : 0
}
