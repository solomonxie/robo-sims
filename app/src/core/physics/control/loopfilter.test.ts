import { gaussAt } from '../common'
import { emaAlpha } from '../signals/filters'
import { ARM, armRun } from './arm'
import { NO_FILTER, dTauFor, filterAt, filterDelay, filterRun, filteredMargins, kalmanSpeed, noiseGain } from './loopfilter'
import { stepMetrics } from './pid'
import { WHEEL, speedStats, stepSp, wheelSpeedRun } from './speed'
import { margins, placePd } from './stability'

const G = placePd(0.7, 12, 40)
const rms = (xs: number[]) => {
  const m = xs.reduce((a, x) => a + x, 0) / xs.length
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length)
}

test('moving average and EMA: step response, delay, noise gain', () => {
  const ma = filterRun({ kind: 'ma', n: 4 })
  expect([0, 4, 4, 4, 4, 4].map(ma)).toEqual([0, 1, 2, 3, 4, 4])
  const ema = filterRun({ kind: 'ema', alpha: 0.5 })
  expect([2, 4, 4].map(ema)).toEqual([2, 3, 3.5])
  expect(filterDelay({ kind: 'ma', n: 9 }, 0.005)).toBeCloseTo(0.02, 12)
  expect(filterDelay({ kind: 'ema', alpha: emaAlpha(0.005, 0.04) }, 0.005)).toBeCloseTo(0.04 - 0.0025, 3)
  const xs = Array.from({ length: 20000 }, (_, k) => gaussAt(k))
  for (const f of [{ kind: 'ma', n: 8 } as const, { kind: 'ema', alpha: 0.2 } as const]) {
    const run = filterRun(f)
    expect(rms(xs.map(run)) / rms(xs)).toBeCloseTo(noiseGain(f), 1)
  }
  expect(dTauFor(emaAlpha(0.005, 0.03))).toBeCloseTo(0.005 / (Math.exp(0.005 / 0.03) - 1), 12)
})

test('filter response: MA is linear phase with a notch, EMA matches a sampled sine', () => {
  const dt = 0.005
  const f = { kind: 'ma', n: 10 } as const
  expect(filterAt(f, 3, dt).phase).toBeCloseTo(-3 * dt * 4.5, 12)
  expect(filterAt(f, (2 * Math.PI) / (10 * dt), dt).mag).toBeLessThan(1e-9)
  const e = { kind: 'ema', alpha: 0.1 } as const
  const w = 20
  const run = filterRun(e)
  const ys = Array.from({ length: 4000 }, (_, k) => run(Math.sin(w * k * dt)))
  const tail = ys.slice(2000)
  expect(Math.max(...tail)).toBeCloseTo(filterAt(e, w, dt).mag, 2)
})

test('no filter reproduces the arm margins; the filter costs margin, D-only costs less', () => {
  const lag = 0.01
  const bare = filteredMargins(G, lag, 40, NO_FILTER)
  const ref = margins(G, lag, 40)
  expect(bare.pm!).toBeCloseTo(ref.pm!, 3)
  expect(bare.gm!).toBeCloseTo(ref.gm!, 3)
  const ema = { kind: 'ema', alpha: emaAlpha(ARM.dt, 0.04) } as const
  const meas = filteredMargins(G, lag, 40, ema, 'meas')
  const d = filteredMargins(G, lag, 40, ema, 'd')
  expect(meas.pm!).toBeLessThan(bare.pm! - 20)
  expect(d.pm!).toBeGreaterThan(meas.pm!)
  const ma = filteredMargins(G, lag, 40, { kind: 'ma', n: 32 })
  expect(ma.pm!).toBeLessThan(15)
  expect(ma.pm!).toBeGreaterThan(0)
})

test('moving average on a noisy pot: calmer duty, more overshoot', () => {
  const run = (n: number) =>
    armRun({ pid: { ...G, limit: 2, dOnMeas: true }, from: 30, target: 40, ff: true, lag: 0.01, seconds: 2.5, noiseDeg: 0.5, filter: filterRun(n > 1 ? { kind: 'ma', n } : NO_FILTER) })
  const stats = (n: number) => {
    const r = run(n)
    return { buzz: rms(r.filter((f) => f.t > 1.5).map((f) => f.u)), os: stepMetrics(r.map((f) => f.th), ARM.dt, 50, 30, 40).overshoot }
  }
  const [a, b, c] = [stats(1), stats(8), stats(32)]
  expect(a.buzz).toBeGreaterThan(3 * b.buzz)
  expect(b.os).toBeLessThan(0.1)
  expect(c.os).toBeGreaterThan(0.4)
})

test('D-only low-pass: far less overshoot than filtering the reading', () => {
  const alpha = emaAlpha(ARM.dt, 0.08)
  const base = { from: 30, target: 40, ff: true, lag: 0.01, seconds: 2.5, noiseDeg: 0.4 }
  const meas = armRun({ ...base, pid: { ...G, limit: 2, dOnMeas: true }, filter: filterRun({ kind: 'ema', alpha }) })
  const d = armRun({ ...base, pid: { ...G, limit: 2, dOnMeas: true, dTau: dTauFor(alpha) } })
  const os = (r: typeof d) => stepMetrics(r.map((f) => f.th), ARM.dt, 50, 30, 40).overshoot
  expect(os(meas)).toBeGreaterThan(0.3)
  expect(os(d)).toBeLessThan(0.15)
})

test('Kalman speed: no overshoot and less buzz than raw or averaged slot-disc counts', () => {
  const cfg = { sp: stepSp(140, 0.2), seconds: 3, enc: 'slot' as const, pid: { kp: 0.005, ki: 0.08, kd: 0, antiWindup: 'clamp' as const }, ramp: { at: 1.6, deg: 15 } }
  const raw = wheelSpeedRun(cfg)
  const avg = wheelSpeedRun({ ...cfg, window: 8 })
  const kf = wheelSpeedRun({ ...cfg, meter: (cpr) => kalmanSpeed(cpr, 30) })
  const peak = (r: typeof kf) => Math.max(...r.filter((f) => f.t < 1.6).map((f) => f.rpm))
  expect(peak(avg)).toBeGreaterThan(180)
  expect(peak(kf)).toBeLessThan(145)
  expect(speedStats(kf, 1, 1.6).jitter).toBeLessThan(speedStats(raw, 1, 1.6).jitter / 5)
  expect(Math.abs(speedStats(kf, 2.4).meanErr)).toBeLessThan(2)
  const m = kalmanSpeed(80, 30, WHEEL.loopS)
  m.read(0)
  expect(m.sigma()).toBeGreaterThan(0)
})
