import { ARM, armRun } from './arm'
import { stepMetrics, swing, ultimateGain } from './pid'
import { armPoles, dominant, margins, placePd, polyRoots, secondOrder, secondOrderAt } from './stability'

const step = (g: { kp: number; ki: number; kd: number }, lag: number) =>
  armRun({ pid: { ...g, limit: 2, dOnMeas: true }, from: 30, target: 40, ff: true, lag, seconds: 3 }).map((f) => f.th)
const P = (kp: number) => ({ kp, ki: 0, kd: 0 })

test('polyRoots finds real and complex roots', () => {
  const r = polyRoots([6, -5, 1]).map((z) => z.re).sort()
  expect(r[0]).toBeCloseTo(2, 9)
  expect(r[1]).toBeCloseTo(3, 9)
  const c = polyRoots([5, 2, 1])
  expect(c.every((z) => Math.abs(z.re + 1) < 1e-9 && Math.abs(Math.abs(z.im) - 2) < 1e-9)).toBe(true)
})

test('2nd-order formulas match the curve', () => {
  const so = secondOrder(0.5, 10)
  expect(so.overshoot).toBeCloseTo(0.163, 3)
  expect(1 + so.overshoot).toBeCloseTo(secondOrderAt(0.5, 10, so.peak), 9)
  expect(secondOrder(1.2, 10).overshoot).toBe(0)
  expect(secondOrderAt(1, 5, 3)).toBeCloseTo(1, 4)
  expect(secondOrder(0.5, 10).settle).toBeGreaterThan(0.5)
  expect(secondOrder(0.5, 10).settle).toBeLessThan(0.85)
  expect(secondOrder(1, 10).settle).toBeCloseTo(0.583, 2)
})

test('placed PD poles predict the simulated arm', () => {
  for (const [z, wn] of [[0.3, 8], [0.5, 10], [0.7, 8]]) {
    const g = placePd(z, wn, 40)
    const d = dominant(armPoles(g, 0, 40))
    expect(d.wn).toBeCloseTo(wn, 0)
    expect(Math.abs(d.zeta - z)).toBeLessThan(0.02)
    const m = stepMetrics(step(g, 0), ARM.dt, 50, 30, 40)
    expect(Math.abs(m.overshoot - secondOrder(z, wn).overshoot)).toBeLessThan(0.02)
  }
})

test('Kd moves poles left, Kp raises ωn', () => {
  const a = dominant(armPoles(P(0.02), 0, 40))
  const b = dominant(armPoles({ kp: 0.02, ki: 0, kd: 0.002 }, 0, 40))
  const c = dominant(armPoles(P(0.05), 0, 40))
  expect(b.pole.re).toBeLessThan(a.pole.re)
  expect(c.wn).toBeGreaterThan(a.wn)
  expect(c.zeta).toBeLessThan(a.zeta)
})

test('lag: margins and poles agree with the simulated ultimate gain', () => {
  const m = margins(P(0.02), ARM.lag, 40)
  const kuLin = 0.02 * m.gm!
  const sim = ultimateGain((kp) => step(P(kp), ARM.lag), ARM.dt, 0.005, 1, 300)
  expect(Math.abs(kuLin - sim.ku) / sim.ku).toBeLessThan(0.06)
  expect(Math.abs((2 * Math.PI) / m.w180! - sim.tu) / sim.tu).toBeLessThan(0.05)
  expect(Math.abs(dominant(armPoles(P(kuLin), ARM.lag, 40)).pole.re)).toBeLessThan(0.05)
  expect(dominant(armPoles(P(kuLin * 1.1), ARM.lag, 40)).pole.re).toBeGreaterThan(0)
  expect(swing(step(P(kuLin * 1.2), ARM.lag), ARM.dt, 300)!.ratio).toBeGreaterThan(0.98)
})

test('no pot lag: only the half-tick hold reaches −180°; delay margin is the lag that tips it', () => {
  expect(margins(P(0.03), 0, 40).gm!).toBeGreaterThan(5)
  expect(margins(P(0.03), 0, 40).w180!).toBeGreaterThan(30)
  const m = margins(P(0.03), 0.02, 40)
  const more = margins(P(0.03), 0.02 + m.delayMargin!, 40)
  expect(Math.abs(more.pm!)).toBeLessThan(1)
  expect(margins({ kp: 0.03, ki: 0, kd: 0.003 }, 0.05, 40).pm!).toBeGreaterThan(margins(P(0.03), 0.05, 40).pm!)
})
