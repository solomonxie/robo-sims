import { FLYWHEELS, SHOOTER, SPINNER, armRadius, raceAngle, reactionRatio, rotorInertias, shooterInertia, shooterRun, shot, spinRace, spinTau, spinnerInertia, spinnerRun, wheelRate } from './rotation'

describe('moment of inertia', () => {
  test('same mass: ring = 2 × disk; masses on an arm go as r²', () => {
    const i = rotorInertias(0.2, 0.05, 0.025)
    expect(i.disk).toBeCloseTo(2.5e-4)
    expect(i.ring).toBeCloseTo(2 * i.disk)
    expect(rotorInertias(0.2, 0.05, 0.05).arm / i.arm).toBeCloseTo(4)
  })

  test('α = τ/I; double I takes √2 longer; same work, same ½Iω² at the finish', () => {
    const a = spinRace(0.01, 1.25e-4, 3)
    const b = spinRace(0.01, 2.5e-4, 3)
    expect(a.alpha).toBeCloseTo(80)
    expect(b.t / a.t).toBeCloseTo(Math.SQRT2)
    expect(0.5 * 1.25e-4 * a.omega ** 2).toBeCloseTo(a.energy)
    expect(0.5 * 2.5e-4 * b.omega ** 2).toBeCloseTo(a.energy)
    expect(raceAngle(a.alpha, a.t + 1, a.t)).toBeCloseTo(6 * Math.PI + a.omega)
  })
})

describe('angular momentum', () => {
  test('arms in: I drops, ω rises by the same factor, L stays, KE grows', () => {
    const run = spinnerRun('arms', 0.2, 30)
    const out = run[0]
    const mid = run[Math.round(run.length / 2)]
    expect(out.r).toBeCloseTo(SPINNER.armMax)
    expect(mid.r).toBeCloseTo(SPINNER.armMin)
    expect(mid.L).toBeCloseTo(out.L)
    expect(mid.omega / out.omega).toBeCloseTo(out.inertia / mid.inertia)
    expect(mid.inertia).toBeCloseTo(spinnerInertia(0.2, SPINNER.armMin))
    expect(mid.ke).toBeGreaterThan(out.ke * 3)
    expect(armRadius(SPINNER.period)).toBeCloseTo(SPINNER.armMax)
  })

  test('reaction wheel: total L stays 0, body turns −I_w/(I_b+I_w) of the wheel and comes back', () => {
    const run = spinnerRun('wheel', 0.2, 600)
    for (const f of run) expect(Math.abs(f.L)).toBeLessThan(1e-12)
    const iw = 0.5 * 0.2 * SPINNER.wheelR ** 2
    const half = run[Math.round(run.length / 2)]
    expect(half.theta / half.wheelAngle).toBeCloseTo(reactionRatio(SPINNER.bodyKgM2, iw))
    expect(half.theta).toBeLessThan(-1)
    expect(Math.abs(run[run.length - 1].theta)).toBeLessThan(0.05)
    expect(wheelRate(0.25, 10)).toBeCloseTo(5)
    expect(wheelRate(SPINNER.period / 2 + 1, 10)).toBeCloseTo(-10)
  })
})

describe('flywheel', () => {
  test('one shot: momentum at the rim, the wheel loses more energy than the ball gets', () => {
    const j = shooterInertia('none')
    const s = shot(j, 500, 0.06)
    expect(j * 500).toBeCloseTo(j * s.omega1 + 0.06 * s.v * SHOOTER.wheelR)
    expect(s.v).toBeCloseTo((s.omega1 * SHOOTER.wheelR) / 2)
    expect(s.wheelJ).toBeGreaterThan(s.ballJ)
  })

  test('a bigger flywheel sags less per ball, spins up slower, stores more', () => {
    const none = shooterRun('none', 0.3, 0.2)
    const big = shooterRun('big', 0.3, 0.2)
    expect(none.balls).toHaveLength(SHOOTER.balls)
    expect(big.inertia).toBeCloseTo(SHOOTER.baseKgM2 + 0.5 * FLYWHEELS.big.kg * FLYWHEELS.big.r ** 2)
    expect(big.balls[0].v).toBeGreaterThan(none.balls[0].v * 1.5)
    expect(big.sag).toBeLessThan(none.sag * 0.7)
    expect(big.balls[4].v).toBeLessThan(big.balls[0].v * 0.9)
    expect(big.spinUp95).toBeGreaterThan(none.spinUp95 * 5)
    expect(big.stored).toBeGreaterThan(none.stored * 5)
    expect(none.frames[Math.round(1 / SHOOTER.dt)].omega).toBeCloseTo(SHOOTER.freeRadS * (1 - Math.exp(-1 / spinTau(none.inertia))), 0)
  })

  test('slider recomputes are fast', () => {
    const t0 = performance.now()
    for (const f of ['none', 'small', 'big'] as const) shooterRun(f, 0.15, 0.1)
    spinnerRun('arms', 0.3, 60)
    spinnerRun('wheel', 0.3, 900)
    expect(performance.now() - t0).toBeLessThan(100)
  })
})
