import {
  HBRIDGE,
  bridgeAmps,
  bridgeMode,
  bridgeRun,
  closed,
  decayCurrent,
  decaySpeed,
  driverLoss,
  freeSpeed,
  legAt,
  motorK,
  safeDeadNs,
  shootThrough,
  stopTime,
} from '.'

describe('four switches', () => {
  it('names each combination', () => {
    expect(bridgeMode(closed('q1', 'q4'))).toBe('forward')
    expect(bridgeMode(closed('q3', 'q2'))).toBe('reverse')
    expect(bridgeMode(closed('q2', 'q4'))).toBe('brake')
    expect(bridgeMode(closed('q1', 'q3'))).toBe('brake')
    expect(bridgeMode(closed())).toBe('coast')
    expect(bridgeMode(closed('q1'))).toBe('coast')
    expect(bridgeMode(closed('q1', 'q2'))).toBe('shoot')
    expect(bridgeMode(closed('q1', 'q2', 'q3', 'q4'))).toBe('shoot')
  })
  it('drives both ways and shorts the supply on a shorted leg', () => {
    const v = HBRIDGE.vs
    expect(bridgeAmps(closed('q1', 'q4'), 0).motorA).toBeCloseTo(v / 5.2, 6)
    expect(bridgeAmps(closed('q3', 'q2'), 0).motorA).toBeCloseTo(-v / 5.2, 6)
    expect(bridgeAmps(closed('q1', 'q2'), 0).shootA).toBeCloseTo(v / 0.35, 6)
    expect(bridgeAmps(closed('q1', 'q2', 'q3', 'q4'), 0).shootA).toBeCloseTo(v / 0.25, 6)
  })
  it('brake reverses the current of a spinning motor and stops it faster than coasting', () => {
    expect(bridgeAmps(closed('q2', 'q4'), 500).motorA).toBeCloseTo((-motorK() * 500) / 5.2, 6)
    const brake = stopTime(bridgeRun(closed('q2', 'q4')))
    const coast = stopTime(bridgeRun(closed()))
    expect(brake).toBeLessThan(coast / 2)
    expect(coast).toBeLessThan(0.6)
  })
  it('spins up to free speed forward and the other way in reverse', () => {
    const f = bridgeRun(closed('q1', 'q4'))
    const r = bridgeRun(closed('q3', 'q2'))
    expect(f[f.length - 1].radS / freeSpeed(HBRIDGE.vs)).toBeCloseTo(1, 1)
    expect(r[r.length - 1].radS / freeSpeed(HBRIDGE.vs)).toBeCloseTo(-1, 1)
  })
})

describe('drivers', () => {
  it('L298N drops volts and heats, MOSFET bridges barely', () => {
    const l = driverLoss('l298n', 1, 7.4)
    const t = driverLoss('tb6612', 1, 7.4)
    const d = driverLoss('drv8833', 1, 7.4)
    expect(l.drop).toBeCloseTo(2, 6)
    expect(l.lossW).toBeCloseTo(2, 6)
    expect(t.lossW).toBeCloseTo(0.5, 6)
    expect(d.efficiency).toBeGreaterThan(t.efficiency)
    expect(t.efficiency).toBeGreaterThan(l.efficiency + 0.15)
    expect(driverLoss('tb6612', 2, 7.4).overA).toBe(true)
  })
})

describe('decay modes', () => {
  it('slow decay holds the current with small ripple at 20 kHz', () => {
    const s = decayCurrent('slow', 0.5, 20000, motorK() * 400)
    const s1k = decayCurrent('slow', 0.5, 1000, motorK() * 400)
    expect(s.ripple).toBeLessThan(0.1)
    expect(s1k.ripple).toBeGreaterThan(5 * s.ripple)
  })
  it('fast decay returns the current to zero each period', () => {
    const f = decayCurrent('fast', 0.5, 1000, 0)
    expect(Math.min(...f.amps)).toBe(0)
    expect(f.mean).toBeLessThan(decayCurrent('slow', 0.5, 1000, 0).mean)
  })
  it('slow decay speed is near-linear in duty, fast decay has a dead zone', () => {
    const s = [0.25, 0.5, 0.75].map((d) => decaySpeed('slow', d, 20000))
    expect((s[2] - s[1]) / (s[1] - s[0])).toBeCloseTo(1, 1)
    expect(decaySpeed('fast', 0.5, 20000)).toBe(0)
    expect(decaySpeed('fast', 1, 20000)).toBeCloseTo(decaySpeed('slow', 1, 20000), 0)
  })
})

describe('shoot-through', () => {
  it('overlaps without dead time and is gone past the safe dead time', () => {
    const none = shootThrough(0)
    expect(none.peakA).toBeGreaterThan(40)
    expect(none.overlapNs).toBe(150)
    expect(none.watts).toBeGreaterThan(1)
    expect(shootThrough(100).watts).toBeLessThan(none.watts / 3)
    expect(shootThrough(safeDeadNs()).peakA).toBe(0)
  })
  it('high side waits for the dead time', () => {
    expect(legAt(100, 200).hi).toBe(0)
    expect(legAt(100, 200).lo).toBe(1)
    expect(legAt(300, 200).hi).toBe(1)
  })
})
