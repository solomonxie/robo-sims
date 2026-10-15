// Timers & interrupts: hardware timer alarms, one-at-a-time ISR servicing, shared-counter races, millis() scheduling.
import { hash01 } from '../common'
import { nextLoopRead } from './gpio'

export const APB_HZ = 80e6
export const ISR_LATENCY_S = 2e-6

export const timerTickHz = (prescaler: number, clk = APB_HZ) => clk / prescaler
/** Alarm value for a period: whole ticks, at least one. */
export const alarmTicks = (periodS: number, prescaler: number, clk = APB_HZ) => Math.max(1, Math.round(periodS * timerTickHz(prescaler, clk)))
export const alarmPeriod = (ticks: number, prescaler: number, clk = APB_HZ) => ticks / timerTickHz(prescaler, clk)

/** Auto-reloading timer at time `t`: ticks since the last reload, and alarms fired so far. */
export function timerAt(t: number, prescaler: number, alarm: number, clk = APB_HZ) {
  const ticks = Math.floor(t * timerTickHz(prescaler, clk) + 1e-9)
  return { count: ticks % alarm, fired: Math.floor(ticks / alarm) }
}

/** Toggle times of a pin flipped once per loop() pass of `delay(P)` plus 0…`workS` of other work: errors pile up. */
export function softwareEdges(n: number, periodS: number, workS: number) {
  const out: number[] = []
  for (let i = 0, t = 0; i < n; i++) out.push((t += periodS + workS * hash01(i)))
  return out
}

/** Time to push `chars` out of a UART at `baud`, 10 bits per character. */
export const serialPrintS = (chars: number, baud = 115200) => (chars * 10) / baud

/** Edges every `periodS`, each late by up to `jitter` of a period. */
export const pulseTrain = (n: number, periodS: number, jitter = 0.2) => Array.from({ length: n }, (_, i) => (i + 1 + jitter * hash01(i + 7)) * periodS)

/** One interrupt line into a CPU that runs one ISR (`isrS` long) at a time. An edge while it runs sets the pending bit,
 *  which re-runs the ISR as soon as it returns; an edge while the bit is already set is lost. Start time per edge, or null. */
export function serviceIrqs(edges: number[], isrS: number, latencyS = ISR_LATENCY_S) {
  let start = -Infinity
  let end = -Infinity
  return edges.map((e) => {
    if (e >= end) {
      start = e + latencyS
      end = start + isrS
      return start
    }
    if (start > e) return null
    start = end
    end += isrS
    return start
  })
}

/** Wall time at which loop() has had `cpuS` of CPU, with ISR runs [start, end) (sorted, disjoint) taking it away. */
export function loopWallTime(cpuS: number, runs: [number, number][]) {
  let wall = cpuS
  for (const [s, e] of runs) {
    if (s >= wall) break
    wall += e - s
  }
  return wall
}

export type IsrShare = 'plain' | 'volatile' | 'critical'

/** ISR does count++; loop() runs `loopS` passes of CPU, copying the counter at the start of each and clearing it `gapS`
 *  later. Plain: the compiler keeps a stale copy in a register, so loop() never sees a count. Volatile: counts landing
 *  between copy and clear are wiped. Critical: copy + clear with interrupts off, nothing wiped. */
export function isrCounter(edges: number[], isrS: number, loopS: number, gapS: number, share: IsrShare, untilS: number) {
  const starts = serviceIrqs(edges, isrS)
  const runs = starts.filter((s): s is number => s !== null).map((s): [number, number] => [s, s + isrS])
  const reads: { copy: number; clear: number; got: number; wiped: number }[] = []
  let last = -Infinity
  for (let k = 0; ; k++) {
    const copy = loopWallTime(k * loopS, runs)
    if (copy > untilS) break
    const clear = share === 'volatile' ? loopWallTime(k * loopS + gapS, runs) : copy
    const inside = (a: number, b: number) => runs.filter(([s]) => s > a && s <= b).length
    reads.push({ copy, clear, got: share === 'plain' ? 0 : inside(last, copy), wiped: share === 'volatile' ? inside(copy, clear) : 0 })
    last = clear
  }
  return { starts, runs, reads }
}

/** Share of [0, untilS) spent inside ISRs. */
export const isrLoad = (runs: [number, number][], untilS: number) => runs.reduce((a, [s, e]) => a + Math.max(0, Math.min(e, untilS) - Math.max(s, 0)), 0) / untilS

export const MILLIS_WRAP_DAYS = 2 ** 32 / 86_400_000

/** millis() − then in unsigned 32-bit maths: stays right across the 49.7-day rollover. */
export const elapsedMs = (now: number, then: number) => (((now - then) % 2 ** 32) + 2 ** 32) % 2 ** 32
export const isDue = (now: number, last: number, intervalMs: number) => elapsedMs(now, last) >= intervalMs

/** Robot at `speed` toward a wall `d0` away; the sensor is read at phase + k·period and the first read under `stopAt`
 *  stops it. Crashes if no read lands before the wall. */
export function driveToWall(d0: number, speed: number, stopAt: number, readPeriodS: number, phaseS = 0) {
  const cross = (d0 - stopAt) / speed
  const read = nextLoopRead(cross, readPeriodS, phaseS)
  const hit = d0 / speed
  const crashed = read >= hit
  const stopT = Math.min(read, hit)
  return { cross, read, stopT, stopD: d0 - speed * stopT, crashed }
}
