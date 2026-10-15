import {
  CONNECTORS,
  INSULATION_MAX_C,
  ampacity,
  awgDiameter,
  connectorPoint,
  groundReturn,
  loopOhms,
  ohmsPerMetre,
  pickGauge,
  runPoint,
  wireRiseC,
  wireTauS,
  wireTempAt,
} from '..'

describe('wiring', () => {
  it('22 AWG copper is ~52 mΩ/m and the loop counts both conductors', () => {
    expect(ohmsPerMetre(22)).toBeCloseTo(0.052, 3)
    expect(loopOhms(22, 1)).toBeCloseTo(2 * ohmsPerMetre(22), 9)
    expect(ohmsPerMetre(22, 75) / ohmsPerMetre(22)).toBeCloseTo(1 + 0.0039 * 50, 9)
  })

  it('ampacity lands near chassis-wiring tables and holds the wire at the limit', () => {
    expect(ampacity(22, INSULATION_MAX_C.pvc)).toBeGreaterThan(6)
    expect(ampacity(22, INSULATION_MAX_C.pvc)).toBeLessThan(8)
    expect(ampacity(12, INSULATION_MAX_C.pvc)).toBeGreaterThan(25)
    expect(ampacity(12, INSULATION_MAX_C.silicone)).toBeGreaterThan(ampacity(12, INSULATION_MAX_C.pvc))
    const i = ampacity(18, 80)
    expect(25 + wireRiseC(18, i)).toBeCloseTo(80, 6)
  })

  it('rise grows faster than I² because R rises with temperature, and runs away past a limit', () => {
    expect(wireRiseC(22, 4) / wireRiseC(22, 2)).toBeGreaterThan(4)
    expect(wireRiseC(28, 60)).toBe(Infinity)
  })

  it('warms with the time constant toward the steady rise', () => {
    const tau = wireTauS(22)
    expect(tau).toBeGreaterThan(20)
    expect(tau).toBeLessThan(120)
    expect(wireTempAt(22, 5, 0)).toBe(25)
    expect(wireTempAt(22, 5, tau) - 25).toBeCloseTo(wireRiseC(22, 5) * (1 - Math.exp(-1)), 9)
  })

  it('run point: the wire cuts the current, drop = I·R, the load sees the rest', () => {
    const r = runPoint(7.4, 22, 1, 3)
    expect(r.amps).toBeLessThan(3)
    expect(r.amps).toBeCloseTo(7.4 / (7.4 / 3 + r.ohms), 6)
    expect(r.drop).toBeCloseTo(r.amps * r.ohms, 9)
    expect(r.heatW).toBeCloseTo(r.amps * r.amps * r.ohms, 9)
    expect(r.loadV).toBeCloseTo(7.4 - r.drop, 9)
    expect(r.tempC).toBeCloseTo(25 + wireRiseC(22, r.amps), 3)
    expect(r.ohms).toBeGreaterThan(loopOhms(22, 1))
  })

  it('a thin wire far over its ampacity fuses open', () => {
    const r = runPoint(7.4, 28, 0.1, 20)
    expect(r.fused).toBe(true)
    expect(r.amps).toBe(0)
    expect(runPoint(7.4, 12, 0.1, 20).fused).toBe(false)
  })

  it('picks the thinnest gauge that keeps the drop and the heat in bounds', () => {
    const gauges = [28, 26, 24, 22, 20, 18, 16, 14, 12]
    const g = pickGauge(7.4, 1, 10, 0.05, 80, gauges)!
    expect(runPoint(7.4, g, 1, 10).drop).toBeLessThanOrEqual(0.37)
    expect(runPoint(7.4, g + 2, 1, 10).drop).toBeGreaterThan(0.37)
    expect(pickGauge(7.4, 1, 500, 0.05, 80, gauges)).toBeNull()
    expect(awgDiameter(g)).toBeGreaterThan(awgDiameter(22))
  })

  it('connectors hit a 30 K rise at the rating; worn contacts heat in proportion', () => {
    const xt = connectorPoint(CONNECTORS.xt60, 30)
    expect(xt.tempC).toBeCloseTo(55, 9)
    expect(xt.melts).toBe(false)
    const worn = connectorPoint(CONNECTORS.xt60, 30, 4)
    expect(worn.heatW).toBeCloseTo(4 * xt.heatW, 9)
    expect(connectorPoint(CONNECTORS.dupont, 8).melts).toBe(true)
    expect(connectorPoint(CONNECTORS.dupont, 2).pairDrop).toBeCloseTo(2 * 2 * 0.02, 9)
  })

  it('daisy-chained grounds lift the MCU by the motor current; a star keeps only its own', () => {
    const spec = { packV: 7.4, motorA: 2, logicA: 0.1, wireOhms: 0.05 }
    const daisy = groundReturn('daisy', spec)
    const star = groundReturn('star', spec)
    expect(daisy.lift).toBeCloseTo(2.1 * 0.05, 9)
    expect(star.lift).toBeCloseTo(0.1 * 0.05, 9)
    expect(star.logicV).toBeCloseTo(7.4 - 2 * 0.1 * 0.05, 9)
    expect(daisy.lossW).toBeCloseTo(0.05 * (0.1 ** 2 + 2 ** 2 + 2.1 ** 2 + 2 ** 2), 9)
  })
})
