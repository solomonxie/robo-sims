import {
  decodeStep,
  encoderCpr,
  headingDrift,
  maxIsrRpm,
  mmPerTick,
  odoStep,
  odometryM,
  periodResolution,
  periodSpeed,
  quadEdgeHz,
  quadEdges,
  quadIndex,
  quadIsr,
  quadLevels,
  quadReader,
  quadStep,
  ticksAt,
  ticksPerWheelRev,
  windowResolution,
  windowSpeed,
} from './encoder'

describe('wheel encoders', () => {
  it('A leads B by a quarter cycle going forward', () => {
    expect([0, 1, 2, 3].map(quadLevels)).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]])
    expect(quadIndex(-1)).toBe(3)
  })

  it('Gray-code steps give direction; a two-state jump is an error', () => {
    expect(quadStep(0, 1)).toBe(1)
    expect(quadStep(3, 0)).toBe(1)
    expect(quadStep(0, 3)).toBe(-1)
    expect(quadStep(1, 3)).toBe(2)
    expect(quadStep(2, 2)).toBe(0)
  })

  it('×1/×2/×4 count 1, 2, 4 per cycle in both directions', () => {
    const cycle = (mode: 1 | 2 | 4, dir: 1 | -1) => [0, 1, 2, 3].reduce((a, k) => a + decodeStep(quadIndex(dir * k), quadIndex(dir * (k + 1)), mode), 0)
    for (const m of [1, 2, 4] as const) {
      expect(cycle(m, 1)).toBe(m)
      expect(cycle(m, -1)).toBe(-m)
    }
  })

  it('counts per wheel rev and mm per tick for a 65 mm wheel', () => {
    expect(encoderCpr(11, 4)).toBe(44)
    expect(ticksPerWheelRev(11, 4, 48)).toBe(2112)
    expect(mmPerTick(65, 2112)).toBeCloseTo(0.0967, 4)
    expect(mmPerTick(65, 20)).toBeCloseTo(10.21, 2)
    expect(odometryM(2112, mmPerTick(65, 2112))).toBeCloseTo(0.2042, 4)
  })

  it('edge rate and ISR limit', () => {
    expect(quadEdgeHz(9600, 11)).toBeCloseTo(7040)
    expect(maxIsrRpm(1e-4, 11)).toBeCloseTo(13636, 0)
  })

  it('edges land on quarter-cycle crossings both ways', () => {
    expect(quadEdges(0.5, 10, 0, 0.3).map((t) => +t.toFixed(6))).toEqual([0.05, 0.15, 0.25])
    expect(quadEdges(0.5, -10, 0, 0.1).map((t) => +t.toFixed(6))).toEqual([0.05])
    expect(quadEdges(0, 0, 0, 1)).toEqual([])
  })

  it('a fast ISR keeps count; a slow one loses edges', () => {
    const qps = 1000
    const edges = quadEdges(0, qps, 0, 0.1)
    const at = (t: number) => quadIndex(t * qps)
    const fast = quadIsr(quadReader(), edges, at, 5e-6, 0.1)
    expect(fast.count).toBe(100)
    expect(fast.errors).toBe(0)
    const slow = quadIsr(quadReader(), edges, at, 1.5e-3, 0.1)
    expect(slow.errors).toBeGreaterThan(0)
    expect(slow.count).toBeLessThan(100)
  })

  it('window speed quantises at low speed; period speed does not', () => {
    const mm = mmPerTick(65, 20)
    expect(ticksAt(50 * 0.1, mm)).toBe(0)
    expect(ticksAt(3 * mm, mm)).toBe(3)
    expect(windowSpeed(1, mm, 0.1)).toBeCloseTo(102.1, 1)
    expect(windowResolution(mm, 0.1)).toBeCloseTo(102.1, 1)
    expect(periodSpeed(mm / 50, mm)).toBeCloseTo(50, 2)
    expect(periodSpeed(Infinity, mm)).toBe(0)
    expect(periodResolution(500, 0.1)).toBeCloseTo(2.5)
  })

  it('odometry: equal wheels go straight, mismatched ones turn', () => {
    const p = odoStep({ x: 0, y: 0, th: 0 }, 1, 1, 0.13)
    expect(p).toEqual({ x: 1, y: 0, th: 0 })
    expect(odoStep(p, 0.1, 0.11, 0.1).th).toBeCloseTo(0.1)
    expect((headingDrift(1, 1.01, 0.13) * 180) / Math.PI).toBeCloseTo(4.39, 2)
  })
})
