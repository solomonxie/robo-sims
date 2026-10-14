import { Bit, bit } from '../logic'

const xor = (a: Bit, b: boolean): Bit => bit(a !== bit(b))

/** Rising clock edges at 0, T, 2T…: how many have happened by time t. */
export const edgesBy = (t: number, period: number) => (t < 0 ? 0 : Math.floor(t / period) + 1)

/** Clock that rises at 0, T, 2T… and is high for the first half of each period. */
export const clockLevel = (t: number, period: number): Bit => bit(((t % period) + period) % period < period / 2)

/** Launch flip-flop → `stages` inverters → capture flip-flop, both on one clock. Times in s. */
export interface TimingPath {
  period: number
  tcq: number
  tpd: number
  stages: number
  tsu: number
}

export const pathDelay = (p: TimingPath) => p.tcq + p.stages * p.tpd
export const pathSlack = (p: TimingPath) => p.period - pathDelay(p) - p.tsu
/** Fastest clock a register-to-register path allows: tclk→Q + logic + setup (+ skew). */
export const maxClock = (tcq: number, logic: number, tsu: number, skew = 0) => 1 / (tcq + logic + tsu + skew)

/** Path levels at time t. The launch flip-flop toggles (D = Q̄) tcq after each edge, node k is its Q through k inverters;
 *  the capture flip-flop takes its D as it was tsu before each edge, so a late D catches the old value. */
export function pathAt(p: TimingPath, t: number) {
  const launch = (x: number): Bit => bit(edgesBy(x - p.tcq, p.period) % 2)
  const node = (k: number, x: number) => xor(launch(x - k * p.tpd), k % 2 === 1)
  const m = edgesBy(t - p.tcq, p.period) - 1
  const capture: Bit = m < 0 ? 0 : node(p.stages, m * p.period - p.tsu)
  return { clk: clockLevel(t, p.period), nodes: Array.from({ length: p.stages + 1 }, (_, k) => node(k, t)), capture }
}

/** What edge m should capture: the launch value from edge m − 1, through every inverter. */
export const expectedCapture = (p: TimingPath, m: number): Bit => xor(bit(m % 2), p.stages % 2 === 1)

/** Metastability. A D edge `offset` s after the clock edge (negative = before) inside the aperture `window` leaves the
 *  latch off balance by dv0 (fraction of the supply, + toward the new D). Outside the window it switches cleanly (±½). */
export const captureImbalance = (offset: number, window: number) => 0.5 * Math.max(-1, Math.min(1, -offset / window))

/** Output level 0..1 a time t after the edge: the cross-coupled pair amplifies the imbalance as e^(t/τ). */
export const metastableLevel = (t: number, dv0: number, tau: number) => Math.max(0, Math.min(1, 0.5 + dv0 * Math.exp(Math.max(0, t) / tau)))

/** Time to reach a full logic level from imbalance dv0. */
export const resolveTime = (dv0: number, tau: number) => tau * Math.log(0.5 / Math.max(Math.abs(dv0), 1e-300))

/** Mean time between synchroniser failures given `slack` s to resolve: e^(slack/τ) / (T0 · fclk · fdata). */
export const syncMtbf = (slack: number, tau: number, t0: number, fClk: number, fData: number) => Math.exp(slack / tau) / (t0 * fClk * fData)

/** Even ÷N divider after `edges` clock edges: a counter runs 0…N/2 − 1, and at its terminal count (tc) the next edge
 *  wraps it and toggles the output, so the output has N input periods per cycle at 50 % duty. */
export function divideBy(edges: number, n: number) {
  const m = n / 2
  const count = edges % m
  return { count, tc: bit(count === m - 1), out: bit(Math.floor(edges / m) % 2) }
}
