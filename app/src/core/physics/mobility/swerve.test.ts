import { SWERVE, steerToward, swerveDesat, swerveFit, swerveOptimize, swerveStates, swerveTick } from './swerve'

describe('swerve module states', () => {
  it('translation points all four the same way; spin makes a tangent circle', () => {
    swerveStates(1, 1, 0).forEach((m) => {
      expect(m.speed).toBeCloseTo(Math.SQRT2)
      expect(m.angle).toBeCloseTo(Math.PI / 4)
    })
    const spin = swerveStates(0, 0, 2)
    spin.forEach((m) => expect(m.speed).toBeCloseTo(2 * Math.hypot(SWERVE.halfL, SWERVE.halfW)))
    expect(spin.map((m) => +((m.angle * 180) / Math.PI).toFixed(3))).toEqual([135, 45, -135, -45])
  })
  it('desaturate scales all modules together', () => {
    const { states, k } = swerveDesat(swerveStates(4, 0, 6), SWERVE.maxSpeed)
    expect(Math.max(...states.map((m) => m.speed))).toBeCloseTo(SWERVE.maxSpeed)
    expect(k).toBeLessThan(1)
  })
  it('fit recovers the twist, scrub is zero when the modules agree', () => {
    const f = swerveFit(swerveStates(0.5, -1, 1.5))
    expect([f.vx, f.vy, f.w].map((v) => +v.toFixed(6))).toEqual([0.5, -1, 1.5])
    f.scrub.forEach((s) => expect(s).toBeLessThan(1e-6))
    const bad = swerveFit([0, 0, 0, Math.PI / 2].map((angle) => ({ speed: 1, angle })))
    expect(Math.max(...bad.scrub)).toBeGreaterThan(0.3)
  })
})

describe('shortest-turn optimisation', () => {
  it('reverses the wheel instead of turning more than 90°', () => {
    const o = swerveOptimize({ speed: 2, angle: Math.PI }, 0)
    expect(o).toEqual({ speed: -2, angle: expect.closeTo(0), flipped: true })
    const slow = swerveOptimize({ speed: 2, angle: Math.PI }, 0, false)
    expect(Math.abs(slow.angle)).toBeCloseTo(Math.PI)
    expect(swerveOptimize({ speed: 1, angle: Math.PI / 3 }, 0).flipped).toBe(false)
    expect(swerveOptimize({ speed: 0, angle: 2 }, 0.4).angle).toBe(0.4)
  })
  it('stays near the current angle across ±π', () => {
    const o = swerveOptimize({ speed: 1, angle: -3 }, 3)
    expect(o.flipped).toBe(false)
    expect(o.angle).toBeCloseTo(3 + (2 * Math.PI - 6))
  })
  it('steering is rate limited, and a reversal without the flip drives the wrong way', () => {
    expect(steerToward(0, 2, 4, 0.1)).toBeCloseTo(0.4)
    expect(steerToward(0, 0.1, 4, 0.1)).toBeCloseTo(0.1)
    const angles = [0, 0, 0, 0]
    const back = swerveStates(-1, 0, 0)
    const flip = swerveTick(angles, back, { rate: 6, shortest: true }, 0.02)
    expect(Math.max(...swerveFit(flip).scrub)).toBeLessThan(1e-6)
    const turn = swerveTick(angles, back, { rate: 6, shortest: false }, 0.02)
    expect(Math.abs(turn[0].error)).toBeGreaterThan(2.9)
    expect(swerveFit(turn).vx).toBeGreaterThan(0.9)
    const toSpin = swerveTick(angles, swerveStates(0, 0, 3), { rate: 6, shortest: true }, 0.02)
    expect(Math.max(...swerveFit(toSpin).scrub)).toBeGreaterThan(0.5)
  })
})
