import { ARM, armRun, loadDuty, pRestDeg } from './arm'
import { stepMetrics, ultimateGain, zieglerNichols } from './pid'

const from = Math.round(ARM.stepAt / ARM.dt)
const metrics = (run: ReturnType<typeof armRun>) => stepMetrics(run.map((f) => f.th), ARM.dt, from, 0, ARM.target)
const p = (kp: number, grams = 0) => armRun({ pid: { kp, ki: 0, kd: 0, limit: 1 }, grams })

describe('arm rig', () => {
  it('P alone rests short by load / Kp; more payload, more error', () => {
    const r = pRestDeg(0.01, 40)
    expect(0.01 * (40 - r)).toBeCloseTo(loadDuty(r), 4)
    expect(p(0.01).at(-1)!.th).toBeCloseTo(r, 0)
    expect(pRestDeg(0.01, 40, 200)).toBeLessThan(r)
  })
  it('higher P: faster but overshoots', () => {
    const [lo, hi] = [metrics(p(0.02)), metrics(p(0.035))]
    expect(hi.rise!).toBeLessThan(lo.rise!)
    expect(lo.overshoot).toBeLessThan(0.02)
    expect(hi.overshoot).toBeGreaterThan(0.15)
  })
  it('PID with I reaches the target', () => {
    const m = metrics(armRun({ pid: { kp: 0.03, ki: 0.08, kd: 0.004, limit: 1, antiWindup: 'clamp' } }))
    expect(m.overshoot).toBeLessThan(0.05)
    expect(m.settle!).toBeLessThan(0.8)
  })
  it('a blocked arm winds up I; anti-windup cuts the overshoot on release', () => {
    const run = (antiWindup: 'none' | 'clamp' | 'back') =>
      Math.max(...armRun({ pid: { kp: 0.025, ki: 0.05, kd: 0.0015, limit: 1, antiWindup }, block: { deg: 5, until: 1.5 }, seconds: 3.5 }).map((f) => f.th))
    expect(run('none')).toBeGreaterThan(80)
    expect(run('clamp')).toBeLessThan(55)
    expect(run('back')).toBeLessThan(55)
    expect(armRun({ pid: { kp: 0.02, ki: 0, kd: 0, limit: 1 }, block: { deg: 5, until: 1 } })[100].th).toBeCloseTo(5)
  })
  it('noise through D shakes the command; a D filter calms it', () => {
    const jitter = (dTau: number) => {
      const u = armRun({ pid: { kp: 0.027, ki: 0.09, kd: 0.002, limit: 1, antiWindup: 'clamp', dOnMeas: true, dTau }, noiseDeg: 0.3 }).slice(-200).map((f) => f.u)
      const mu = u.reduce((a, b) => a + b, 0) / u.length
      return Math.sqrt(u.reduce((a, b) => a + (b - mu) ** 2, 0) / u.length)
    }
    expect(jitter(0)).toBeGreaterThan(3 * jitter(0.03))
  })
  it('Ziegler–Nichols: classic overshoots, the no-overshoot row does not', () => {
    const { ku, tu } = ultimateGain((kp) => armRun({ pid: { kp, ki: 0, kd: 0, limit: 1 }, seconds: 6 }).map((f) => f.th), ARM.dt, 0.005, 1, 300)
    expect(ku).toBeGreaterThan(0.03)
    expect(ku).toBeLessThan(0.07)
    expect(tu).toBeGreaterThan(0.4)
    expect(tu).toBeLessThan(0.8)
    const os = (g: ReturnType<typeof zieglerNichols>) => metrics(armRun({ pid: { ...g, limit: 1, antiWindup: 'clamp' }, seconds: 4 })).overshoot
    expect(os(zieglerNichols(ku, tu, 'classic'))).toBeGreaterThan(0.15)
    expect(os(zieglerNichols(ku, tu, 'none'))).toBeLessThan(0.02)
  })
})
