// Telemetry & logging: a speed loop streamed over a slow radio (decimation, queueing, stamps vs arrival) and a run logged then replayed.
import { clamp, gaussAt } from '../common'

// --- Live plot: a 200 Hz speed loop streamed over a 57.6 kbaud telemetry radio ---

export const TELE = {
  dt: 0.005,
  seconds: 8,
  tau: 0.12,
  delaySteps: 8,
  uMax: 1.5,
  ki: 6,
  linkBps: 5760,
  sampleBytes: 36,
  queue: 64,
  airFrameS: 0.02,
  airLatS: 0.01,
  lossEvery: 31,
  retryS: 0.15,
}
export const KP = { tuned: 1, hot: 5 }

export interface TeleFrame {
  t: number
  sp: number
  v: number
  hd: number
  batt: number
}

export const speedSetpoint = (t: number) => (t < 0.5 ? 0 : t < 3 ? 0.4 : t < 5.5 ? 0.8 : 0.3)
const yawRateDeg = (t: number) => (t >= 4 && t < 5 ? 90 : 0)

/** PI speed loop on a first-order motor with actuator delay; heading from the turn profile, battery sags with drive effort. */
export function speedRun(kp: number, seconds = TELE.seconds): TeleFrame[] {
  const { dt, tau, delaySteps, uMax, ki } = TELE
  const q: number[] = Array(delaySteps).fill(0)
  let v = 0
  let integ = 0
  let hd = 0
  const out: TeleFrame[] = []
  for (let i = 0; i * dt < seconds - 1e-9; i++) {
    const t = i * dt
    const sp = speedSetpoint(t)
    const e = sp - v
    integ += e * dt
    const u = clamp(kp * e + ki * integ, -uMax, uMax)
    q.push(u)
    const ua = q.shift()!
    out.push({ t, sp, v, hd, batt: 8.1 - 0.01 * t - 0.15 * (0.3 + 1.6 * Math.abs(ua)) })
    v += ((ua - v) / tau) * dt
    hd += yawRateDeg(t) * dt
  }
  return out
}

/** Bytes per second offered by streaming every `every`-th loop sample, as a fraction of the link. */
export const streamHz = (every: number) => 1 / (TELE.dt * every)
export const streamLoad = (every: number) => (streamHz(every) * TELE.sampleBytes) / TELE.linkBps

export interface TeleSample {
  i: number
  stamp: number
  sent: number
  arrive: number
  retry: boolean
}

/** Every `every`-th sample goes into a FIFO TX queue drained at link speed; the radio ships in 20 ms air frames;
 *  every `lossEvery`-th frame is lost and resent `retryS` later; a full queue drops new samples. Sorted by arrival. */
export function streamRun(run: TeleFrame[], every: number) {
  const { linkBps, sampleBytes, queue, airFrameS, airLatS, lossEvery, retryS } = TELE
  const txS = sampleBytes / linkBps
  const samples: TeleSample[] = []
  const dropped: number[] = []
  const pending: number[] = []
  let busy = 0
  let seq = 0
  for (let i = 0; i < run.length; i += every) {
    const stamp = run[i].t
    while (pending.length && pending[0] <= stamp + 1e-12) pending.shift()
    if (pending.length >= queue) {
      dropped.push(stamp)
      continue
    }
    const sent = Math.max(busy, stamp) + txS
    busy = sent
    pending.push(sent)
    const air = Math.ceil(sent / airFrameS - 1e-9) * airFrameS + airLatS
    const retry = ++seq % lossEvery === 0
    samples.push({ i, stamp, sent, arrive: air + (retry ? retryS : 0), retry })
  }
  samples.sort((a, b) => a.arrive - b.arrive)
  return { samples, dropped }
}

/** Samples queued at `now` (stamped, not yet on air). */
export const txQueued = (samples: TeleSample[], now: number) => samples.reduce((n, s) => n + (s.stamp <= now && s.sent > now ? 1 : 0), 0)

/** Oscillation in v − sp over [from, to): frequency from zero crossings and peak-to-peak. */
export function oscillation(run: TeleFrame[], from: number, to: number) {
  const seg = run.filter((f) => f.t >= from && f.t < to)
  let cross = 0
  for (let k = 1; k < seg.length; k++) if ((seg[k].v - seg[k].sp) * (seg[k - 1].v - seg[k - 1].sp) < 0) cross++
  const e = seg.map((f) => f.v - f.sp)
  const pp = e.length ? Math.max(...e) - Math.min(...e) : 0
  return { hz: cross / 2 / (to - from), pp }
}


// --- Replay: a 1 kHz run with a wheel slip, logged at a chosen rate, scrubbed back ---

export const REPLAY = {
  dt: 0.001,
  seconds: 14,
  v: 0.3,
  track: 0.13,
  r: 0.15,
  start: [0.4, 2] as [number, number],
  slip: [6215, 6295] as [number, number],
  door: { x: [3.8, 4.2] as [number, number], y: [1.75, 2.25] as [number, number] },
  room: [6, 4] as [number, number],
  runA: 0.42,
  stallA: 2.4,
  gzFault: 1,
}

export interface LogRow {
  t: number
  x: number
  y: number
  th: number
  wl: number
  wr: number
  gz: number
  amps: number
}

const hitsDoorPost = (x: number, y: number) => {
  const { door, r } = REPLAY
  const nx = clamp(x, door.x[0], door.x[1])
  for (const [y0, y1] of [[-Infinity, door.y[0]], [door.y[1], Infinity]]) if (Math.hypot(x - nx, y - clamp(y, y0, y1)) < r) return true
  return false
}

/** Ground truth at 1 kHz: drives straight on encoder heading-hold; the left wheel spins on a cable during `slip`,
 *  so the robot yaws while the encoders read straight, then clips the doorway post and stalls. */
export function faultRun(): LogRow[] {
  const { dt, seconds, v, track, slip, runA, stallA } = REPLAY
  let [x, y] = REPLAY.start
  let th = 0
  let stuck = false
  const out: LogRow[] = []
  const n = Math.round(seconds / dt)
  for (let i = 0; i <= n; i++) {
    const t = i * dt
    const spin = i >= slip[0] && i < slip[1]
    const vl = stuck ? 0 : spin ? 0 : v
    const vr = stuck ? 0 : v
    const gz = (vr - vl) / track + 0.004 * gaussAt(i)
    out.push({ t, x, y, th, wl: stuck ? 0 : v, wr: vr, gz, amps: stuck ? stallA : runA + 0.03 * gaussAt(i + 7919) })
    if (stuck) continue
    th += ((vr - vl) / track) * dt
    const nx = x + ((vl + vr) / 2) * Math.cos(th) * dt
    const ny = y + ((vl + vr) / 2) * Math.sin(th) * dt
    if (hitsDoorPost(nx, ny)) stuck = true
    else [x, y] = [nx, ny]
  }
  return out
}

/** One row every 1/hz s. */
export const logAt = (run: LogRow[], hz: number) => run.filter((_, i) => i % Math.max(1, Math.round(1 / (hz * REPLAY.dt))) === 0)

/** Pose at time `t`, linearly between the two logged rows around it: same log, same answer, every replay. */
export function replayAt(log: LogRow[], t: number): LogRow {
  if (t <= log[0].t) return log[0]
  const last = log[log.length - 1]
  if (t >= last.t) return last
  let lo = 0
  let hi = log.length - 1
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (log[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = log[lo]
  const b = log[hi]
  const u = (t - a.t) / (b.t - a.t)
  const mix = (k: keyof LogRow) => a[k] + (b[k] - a[k]) * u
  return { t, x: mix('x'), y: mix('y'), th: mix('th'), wl: mix('wl'), wr: mix('wr'), gz: mix('gz'), amps: mix('amps') }
}

/** First logged row whose yaw rate exceeds `gzFault` while both encoders agree: the slip. */
export const findSlip = (log: LogRow[]) => log.find((s) => Math.abs(s.gz) > REPLAY.gzFault && Math.abs(s.wl - s.wr) < 0.01) ?? null
/** First logged row at stall current: the symptom. */
export const findStall = (log: LogRow[]) => log.find((s) => s.amps > REPLAY.stallA * 0.9) ?? null

export const CSV_HEADER = 't,x,y,th,wl,wr,gz,amps\n'
export const csvRow = (s: LogRow) => [s.t, s.x, s.y, s.th, s.wl, s.wr, s.gz, s.amps].map((v) => v.toFixed(3)).join(',') + '\n'

/** MCAP message record: opcode 1 + length 8 + channel 2 + sequence 4 + log/publish time 16, then CDR (4 + 8 doubles). */
export const MCAP_RECORD = 31 + 4 + 8 * 8
export const ZSTD_RATIO = 0.45
export type LogFormat = 'csv' | 'mcap'

export function logBytesPerS(format: LogFormat, hz: number, log: LogRow[]) {
  if (format === 'mcap') return hz * MCAP_RECORD * ZSTD_RATIO
  const chars = log.reduce((s, r) => s + csvRow(r).length, 0)
  return (hz * chars) / log.length
}
