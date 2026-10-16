import { PID0, PID_MEM0, PidCfg, pidStep, pidTick, stepMetrics, swing, ultimateGain, zieglerNichols } from './pid'

describe('pidStep', () => {
  it('sums P, I and D and stops integrating when saturated', () => {
    const a = pidStep(PID0, 2, { kp: 1, ki: 1, kd: 1 }, 0.1)
    expect(a.d).toBe(0)
    expect(a.out).toBeCloseTo(2.2)
    const b = pidStep(a, 3, { kp: 1, ki: 1, kd: 1 }, 0.1)
    expect(b.d).toBeCloseTo(10)
    const c = pidStep(a, 3, { kp: 1, ki: 1, kd: 1 }, 0.1, 1)
    expect(c.sat).toBe(true)
    expect(c.integ).toBe(a.integ)
    expect(pidStep(PID0, 1, { kp: 0, ki: 0, kd: 2 }, 0.1, Infinity, 5).d).toBe(10)
  })
})

const cfg: PidCfg = { kp: 1, ki: 1, kd: 1, limit: 10 }
describe('pidTick', () => {
  it('sums P, I and D; D on error kicks on a setpoint step, D on measurement does not', () => {
    const a = pidTick(PID_MEM0, 2, 0, cfg, 0.1)
    expect(a.terms.d).toBe(0)
    expect(a.terms.out).toBeCloseTo(2.2)
    const kick = pidTick(a.mem, 5, 0, cfg, 0.1)
    expect(kick.terms.d).toBeCloseTo(30)
    expect(pidTick(a.mem, 5, 0, { ...cfg, dOnMeas: true }, 0.1).terms.d).toBeCloseTo(0)
    expect(pidTick(a.mem, 2, 0.5, { ...cfg, dOnMeas: true }, 0.1).terms.d).toBeCloseTo(-5)
  })
  it('filters D with a first-order lag', () => {
    const a = pidTick(PID_MEM0, 0, 0, { ...cfg, dTau: 0.1 }, 0.1)
    expect(pidTick(a.mem, 1, 0, { ...cfg, dTau: 0.1 }, 0.1).terms.d).toBeCloseTo(5)
  })
  it('anti-windup: none keeps integrating when saturated, clamp holds, back-calculation bleeds it', () => {
    let none = PID_MEM0
    let clamp = PID_MEM0
    let back = PID_MEM0
    const c = { kp: 1, ki: 10, kd: 0, limit: 1 }
    for (let k = 0; k < 50; k++) {
      none = pidTick(none, 5, 0, c, 0.01).mem
      clamp = pidTick(clamp, 5, 0, { ...c, antiWindup: 'clamp' }, 0.01).mem
      back = pidTick(back, 5, 0, { ...c, antiWindup: 'back', backGain: 10 }, 0.01).mem
    }
    expect(none.integ).toBeCloseTo(25)
    expect(clamp.integ).toBe(0)
    expect(back.integ).toBeGreaterThan(0)
    expect(back.integ).toBeLessThan(1.01)
    expect(pidTick(clamp, -0.5, 0, { ...c, antiWindup: 'clamp' }, 0.01).mem.integ).toBeCloseTo(-0.05)
  })
})

describe('step metrics', () => {
  const dt = 0.01
  const ys = Array.from({ length: 400 }, (_, k) => (k < 100 ? 0 : 1 - Math.exp(-(k - 100) * dt * 5) * Math.cos((k - 100) * dt * 8)))
  it('rise, overshoot and settling of a damped step', () => {
    const m = stepMetrics(ys, dt, 100, 0, 1)
    expect(m.rise).toBeGreaterThan(0.05)
    expect(m.rise).toBeLessThan(0.3)
    expect(m.overshoot).toBeGreaterThan(0.1)
    expect(m.overshoot).toBeLessThan(0.3)
    expect(m.settle).toBeGreaterThan(0.5)
    expect(m.settle).toBeLessThan(1)
    expect(m.final).toBeCloseTo(1, 2)
  })
  it('no rise or settle when it never gets there', () => {
    const m = stepMetrics(ys.map((y) => y * 0.5), dt, 100, 0, 1)
    expect(m.rise).toBeNull()
    expect(m.settle).toBeNull()
  })
})

describe('Ziegler–Nichols', () => {
  const sine = (grow: number, period: number) => Array.from({ length: 600 }, (_, k) => Math.exp(grow * k * 0.01) * Math.sin((2 * Math.PI * k * 0.01) / period))
  it('measures period and per-cycle swing ratio', () => {
    const s = swing(sine(0, 0.5), 0.01)!
    expect(s.period).toBeCloseTo(0.5, 2)
    expect(s.ratio).toBeCloseTo(1, 2)
    expect(swing(sine(-1, 0.5), 0.01)!.ratio).toBeCloseTo(Math.exp(-0.5), 1)
    expect(swing(Array(100).fill(1), 0.01)).toBeNull()
  })
  it('finds where the oscillation stops dying out', () => {
    const { ku, tu } = ultimateGain((kp) => sine(kp - 2, 0.4), 0.01, 0, 5)
    expect(ku).toBeCloseTo(2 + Math.log(0.98) / 0.4, 1)
    expect(tu).toBeCloseTo(0.4, 2)
  })
  it('applies the table', () => {
    const g = zieglerNichols(10, 0.5, 'classic')
    expect(g.kp).toBeCloseTo(6)
    expect(g.ki).toBeCloseTo(24)
    expect(g.kd).toBeCloseTo(0.375)
    expect(zieglerNichols(10, 0.5, 'p').ki).toBe(0)
  })
})
