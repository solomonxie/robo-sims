import { FollowCfg, HEATERS, bangBang, cycleStats, followRun, followStats, followSteer, relayLifeHours, thermostatRun } from './bangbang'

const stats = (band: number, jPerK = HEATERS.ceramic.jPerK) => cycleStats(thermostatRun(40, band, jPerK), 40, band)
const follow = (c: Partial<FollowCfg>) => followStats(followRun({ mode: 'bang', noiseM: 0, bandM: 0.006, holdS: 0.15, kp: 40, ...c }))

describe('relay thermostat', () => {
  it('switches only outside the band', () => {
    expect(bangBang(false, 38.9, 40, 2)).toBe(true)
    expect(bangBang(true, 41.1, 40, 2)).toBe(false)
    expect(bangBang(true, 40.5, 40, 2)).toBe(true)
    expect(bangBang(false, 39.5, 40, 2)).toBe(false)
  })
  it('warms from room temperature and cycles around the setpoint', () => {
    const run = thermostatRun(40, 2, HEATERS.ceramic.jPerK)
    expect(run[0].air).toBe(20)
    const s = stats(2)
    expect(s.settledAt).toBeGreaterThan(200)
    expect(s.closures).toBeGreaterThan(3)
    expect(Math.abs(Math.max(...run.slice(-600).map((f) => f.air)) - 41) < 1.5).toBe(true)
  })
  it('a wider band switches less often with more ripple', () => {
    const [narrow, wide] = [stats(1), stats(4)]
    expect(wide.perHour).toBeLessThan(narrow.perHour)
    expect(wide.ripple).toBeGreaterThan(narrow.ripple + 2)
    expect(relayLifeHours(wide.perHour)).toBeGreaterThan(relayLifeHours(narrow.perHour))
  })
  it('overshoots past the threshold more with a heavier element; still ripples with no band', () => {
    expect(stats(2, HEATERS.oil.jPerK).overshoot).toBeGreaterThan(stats(2, HEATERS.wire.jPerK).overshoot)
    expect(stats(0).overshoot).toBeGreaterThan(0.3)
    expect(stats(0).period).toBeGreaterThan(30)
  })
})

describe('bang-bang line follower', () => {
  it('steers toward the line; P is proportional and clamped', () => {
    const cfg: FollowCfg = { mode: 'band', noiseM: 0, bandM: 0.01, holdS: 0.2, kp: 40 }
    expect(followSteer(cfg, 0.005, -1, 0)).toBe(-1)
    expect(followSteer(cfg, 0.02, -1, 0)).toBe(1)
    expect(followSteer({ ...cfg, mode: 'hold' }, -0.01, 1, 0.1)).toBe(1)
    expect(followSteer({ ...cfg, mode: 'hold' }, -0.01, 1, 0.3)).toBe(-1)
    expect(followSteer({ ...cfg, mode: 'p' }, 0.01, 0, 0)).toBeCloseTo(0.4)
    expect(followSteer({ ...cfg, mode: 'p' }, 0.1, 0, 0)).toBe(1)
  })
  it('chatters faster with sensor noise', () => {
    expect(follow({ noiseM: 0.005 }).flipsPerS).toBeGreaterThan(2 * follow({}).flipsPerS)
    expect(follow({}).flipsPerS).toBeGreaterThan(5)
  })
  it('hysteresis or a hold time cut the flips; P never flips', () => {
    const noisy = follow({ noiseM: 0.002 }).flipsPerS
    expect(follow({ mode: 'band', noiseM: 0.002 }).flipsPerS).toBeLessThan(noisy / 5)
    expect(follow({ mode: 'hold', noiseM: 0.002 }).flipsPerS).toBeLessThan(noisy / 5)
    expect(follow({ mode: 'band' }).wiggle).toBeGreaterThan(follow({}).wiggle)
    expect(follow({ mode: 'p', noiseM: 0.005 }).flipsPerS).toBe(0)
    expect(follow({ mode: 'p' }).rms).toBeLessThan(0.005)
  })
})
