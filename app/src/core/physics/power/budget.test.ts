import {
  CHEMISTRIES,
  LM2596,
  MISSION_S,
  TT_CRUISE_A,
  WIFI_PEAK_A,
  averageBudget,
  budgetAt,
  budgetOf,
  deliveredWh,
  dcdcPoint,
  missionAmps,
  missionState,
  packRuntime,
  sagged,
  startAmps,
  stateAmps,
  ttStallAmps,
} from '..'

const LI = CHEMISTRIES.liion

describe('power budget', () => {
  it('items sum to the pack power, and the 5 V rail draws fewer amps from a 7.4 V pack', () => {
    const b = budgetOf(stateAmps('cruise', 7.4), 7.4)
    const sum = b.items.reduce((s, it) => s + it.watts, 0)
    expect(sum).toBeCloseTo(b.packW, 6)
    expect(b.items.reduce((s, it) => s + it.packA, 0)).toBeCloseTo(b.packA, 6)
    expect(b.conv.iin).toBeLessThan(b.logicA)
    expect(b.conv.iin).toBeCloseTo(dcdcPoint(LM2596, 7.4, 5, b.logicA).iin, 9)
    expect(b.motorA).toBeCloseTo(2 * TT_CRUISE_A + 0.036, 9)
  })

  it('a stall pulls (V − 1.4) / 5.6 per motor and dwarfs everything else', () => {
    expect(ttStallAmps(7.4)).toBeCloseTo(6 / 5.6, 9)
    const b = budgetOf(stateAmps('stall', 7.4), 7.4)
    expect(b.motorA).toBeGreaterThan(2)
    expect(b.packA).toBeGreaterThan(4 * budgetOf(stateAmps('idle', 7.4), 7.4).packA)
  })

  it('in deep sleep the L298N, not the ESP32, eats most; cutting it saves most of the rest', () => {
    const s = budgetOf(stateAmps('sleep', 7.4), 7.4)
    const top = [...s.items].sort((a, b) => b.watts - a.watts)[0]
    expect(top.id).toBe('l298n')
    expect(budgetOf(stateAmps('cut', 7.4), 7.4).packW).toBeLessThan(s.packW / 2)
  })

  it('sag finds V = OCV − I(V)·R', () => {
    const v = sagged(8, 0.5, (x) => x / 4)
    expect(v).toBeCloseTo(8 - 0.5 * (v / 4), 6)
    const b = budgetAt(7.8, 0.9, (x) => stateAmps('stall', x))
    expect(b.vpack).toBeCloseTo(7.8 - 0.9 * b.packA, 3)
  })

  it('a hard start peaks at stall; a soft start keeps the excess small and both settle to cruise', () => {
    expect(startAmps(0, 1, 0.25, 0)).toBeCloseTo(1, 9)
    expect(startAmps(2, 1, 0.25, 0)).toBeCloseTo(0.25, 3)
    const peak = Math.max(...Array.from({ length: 200 }, (_, i) => startAmps(i * 0.005, 1, 0.25, 0.5)))
    expect(peak).toBeLessThan(0.55)
    expect(startAmps(2, 1, 0.25, 0.5)).toBeCloseTo(0.25, 3)
  })

  it('duty averaging and runtime: Wh at that draw over the watts', () => {
    const drive = budgetOf(stateAmps('cruise', 7.4), 7.4)
    const rest = budgetOf(stateAmps('sleep', 7.4), 7.4)
    const avg = averageBudget([[0.25, drive], [0.75, rest]])
    expect(avg.packW).toBeCloseTo(0.25 * drive.packW + 0.75 * rest.packW, 6)
    const r = packRuntime(LI, 2, 1, avg.packW)
    expect(r.wh).toBeCloseTo(2 * deliveredWh(LI, avg.packW / 7.4), 6)
    expect(r.hours).toBeCloseTo(r.wh / avg.packW, 9)
    expect(packRuntime(LI, 2, 2, avg.packW).hours).toBeGreaterThan(1.9 * r.hours)
  })

  it('the errand loops, with WiFi bursts and motor starts', () => {
    expect(missionState(0.5).state).toBe('idle')
    expect(missionState(MISSION_S + 4.2)).toEqual({ state: 'scan', since: expect.closeTo(0.2, 6) })
    expect(missionAmps(2.02, 7.4, 0).esp32).toBe(WIFI_PEAK_A)
    expect(missionAmps(1.001, 7.4, 0).motors).toBeGreaterThan(2)
    expect(missionAmps(3.5, 7.4, 0).motors).toBeCloseTo(2 * TT_CRUISE_A, 3)
  })
})
