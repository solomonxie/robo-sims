import { aliasFrequency } from '../signals/fourier'
import {
  CSV_HEADER,
  KP,
  MCAP_RECORD,
  REPLAY,
  TELE,
  ZSTD_RATIO,
  csvRow,
  faultRun,
  findSlip,
  findStall,
  logAt,
  logBytesPerS,
  oscillation,
  replayAt,
  speedRun,
  streamLoad,
  streamRun,
  txQueued,
} from './telemetry'

describe('live plot stream', () => {
  const tuned = speedRun(KP.tuned)
  const hot = speedRun(KP.hot)

  it('tuned loop settles on the setpoint, high Kp limit-cycles near 6.5 Hz', () => {
    expect(Math.abs(tuned[Math.round(2.9 / TELE.dt)].v - 0.4)).toBeLessThan(0.01)
    expect(oscillation(tuned, 2, 3).pp).toBeLessThan(0.01)
    const o = oscillation(hot, 2, 3)
    expect(o.hz).toBeGreaterThan(5.5)
    expect(o.hz).toBeLessThan(7.5)
    expect(o.pp).toBeGreaterThan(0.3)
  })

  it('heading turns 90° between 4 and 5 s; battery sags harder when oscillating', () => {
    expect(tuned[tuned.length - 1].hd).toBeCloseTo(90, 0)
    const mean = (r: typeof tuned) => r.reduce((s, f) => s + f.batt, 0) / r.length
    expect(mean(hot)).toBeLessThan(mean(tuned))
  })

  it('10 Hz decimation aliases the wobble to a slow one', () => {
    const f = oscillation(hot, 2, 3).hz
    expect(Math.abs(aliasFrequency(f, 10))).toBeLessThan(5)
    expect(Math.abs(aliasFrequency(f, 10))).toBeLessThan(f / 1.5)
  })

  it('200 Hz overflows the radio: queue fills, lag grows, samples drop; 50 Hz does not', () => {
    expect(streamLoad(1)).toBeGreaterThan(1)
    expect(streamLoad(4)).toBeLessThan(0.5)
    const full = streamRun(tuned, 1)
    const dec = streamRun(tuned, 4)
    expect(full.dropped.length).toBeGreaterThan(0)
    expect(dec.dropped.length).toBe(0)
    const lag = (s: typeof full.samples) => Math.max(...s.map((x) => (x.retry ? 0 : x.arrive - x.stamp)))
    expect(lag(full.samples)).toBeGreaterThan(0.3)
    expect(lag(dec.samples)).toBeLessThan(0.05)
    expect(txQueued(full.samples, 6)).toBeGreaterThan(TELE.queue * 0.8)
  })

  it('a resent frame arrives after newer samples: arrival order ≠ stamp order', () => {
    const { samples } = streamRun(tuned, 4)
    const late = samples.findIndex((s) => s.retry)
    expect(late).toBeGreaterThan(0)
    expect(samples[late - 1].stamp).toBeGreaterThan(samples[late].stamp)
    samples.forEach((s, k) => k && expect(s.arrive).toBeGreaterThanOrEqual(samples[k - 1].arrive))
  })
})

describe('replay log', () => {
  const run = faultRun()

  it('slip yaws the robot while the encoders read straight, then it stalls on the door post', () => {
    const before = run[REPLAY.slip[0] - 1].th
    const after = run[REPLAY.slip[1]].th
    expect(after - before).toBeGreaterThan(0.15)
    const stall = findStall(run)!
    expect(stall.t).toBeGreaterThan(8)
    expect(stall.t).toBeLessThan(REPLAY.seconds - 1)
  })

  it('10 Hz log misses the 80 ms slip, 100 Hz catches it', () => {
    expect(findSlip(logAt(run, 10))).toBeNull()
    expect(findSlip(logAt(run, 100))!.t).toBeCloseTo(6.22, 2)
    expect(findSlip(logAt(run, 1000))!.t).toBeCloseTo(REPLAY.slip[0] * REPLAY.dt, 3)
    expect(findStall(logAt(run, 10))).not.toBeNull()
  })

  it('replay interpolates between rows and is deterministic', () => {
    const log = logAt(run, 10)
    expect(log).toHaveLength(141)
    const a = replayAt(log, 3.05)
    expect(a.x).toBeCloseTo((log[30].x + log[31].x) / 2, 9)
    expect(replayAt(log, 3.05)).toEqual(a)
    expect(replayAt(log, -1)).toBe(log[0])
    expect(replayAt(log, 99)).toBe(log[log.length - 1])
  })

  it('log size scales with rate; CSV rows are text, MCAP is framed binary + zstd', () => {
    expect(CSV_HEADER.split(',')).toHaveLength(8)
    expect(csvRow(run[0]).startsWith('0.000,0.400,2.000,0.000,0.300,0.300,')).toBe(true)
    expect(csvRow(run[0]).split(',')).toHaveLength(8)
    const log = logAt(run, 100)
    expect(logBytesPerS('csv', 1000, log)).toBeCloseTo(10 * logBytesPerS('csv', 100, log), 6)
    expect(logBytesPerS('mcap', 100, log)).toBeCloseTo(100 * MCAP_RECORD * ZSTD_RATIO, 9)
    expect(logBytesPerS('csv', 100, log)).toBeGreaterThan(4000)
  })
})
