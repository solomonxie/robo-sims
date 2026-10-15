import { stopDistance } from './remote'
import { ESTOP, FAULT, FaultIn, WDT, estopRun, faultFsmRun, faultLevel, maxWdtTimeout, wallGap, wdtRun } from './safety'

describe('watchdog', () => {
  it('a timeout must fit the gap ahead', () => {
    expect(maxWdtTimeout(1.32, 0.4, 2)).toBeCloseTo(3.2)
    expect(stopDistance(0.4, maxWdtTimeout(1.32, 0.4, 2), 2)).toBeCloseTo(1.32)
  })
  it('feeding at the end of loop() resets the hung board and it stops short of the wall', () => {
    const { frames, resetAt } = wdtRun('loop', 1)
    expect(resetAt.length).toBe(1)
    expect(resetAt[0]).toBeCloseTo(WDT.hangAt + 1, 1)
    const fin = frames[frames.length - 1]
    expect(fin.crashed).toBe(false)
    expect(fin.v).toBe(0)
    expect(wallGap(fin.x)).toBeGreaterThan(0.2)
    expect(Math.max(...frames.filter((f) => f.t < WDT.hangAt).map((f) => f.count))).toBeLessThanOrEqual(WDT.loopS + 1e-9)
  })
  it('feeding inside the wait, no WDT or a 5 s timeout all hit the wall', () => {
    for (const run of [wdtRun('wait', 1), wdtRun('none', 1), wdtRun('loop', 5)]) expect(run.frames[run.frames.length - 1].crashed).toBe(true)
    const w = wdtRun('wait', 1)
    expect(w.resetAt.length).toBe(0)
    expect(Math.max(...w.frames.map((f) => f.count))).toBeLessThanOrEqual(WDT.loopS + 1e-9)
    expect(Number.isNaN(wdtRun('none', 1).frames[5].count)).toBe(true)
  })
})

describe('E-stop', () => {
  it('software and cat 1 brake hard; cat 0 coasts further', () => {
    const sw = estopRun('sw', 'none', true, 1)
    expect(sw.travelled).toBeCloseTo(stopDistance(1, ESTOP.pollS, ESTOP.brake), 2)
    expect(estopRun('cat1', 'none', true, 1).travelled).toBeCloseTo(sw.travelled, 2)
    const c0 = estopRun('cat0', 'none', true, 1)
    expect(c0.travelled).toBeCloseTo(stopDistance(1, ESTOP.releaseS, ESTOP.coast), 2)
    expect(c0.crashed).toBe(false)
  })
  it('only the hardware cut survives hung firmware or a shorted driver, until someone resets', () => {
    expect(estopRun('sw', 'hung', true, 1).crashed).toBe(true)
    expect(estopRun('sw', 'short', true, 1).crashed).toBe(true)
    for (const f of ['hung', 'short'] as const) {
      const r = estopRun('cat0', f, true, 1)
      expect(r.stopX).toBeLessThan(ESTOP.gapM)
      expect(r.frames.find((h) => h.crashed)!.t).toBeGreaterThan(ESTOP.resetAt)
    }
  })
  it('without a latch, twisting the button out drives off again; a latched reset restores power only', () => {
    const free = estopRun('cat0', 'none', false, 1)
    expect(free.restartAt).toBeGreaterThanOrEqual(ESTOP.releaseAt)
    const held = estopRun('cat0', 'none', true, 1)
    expect(Number.isNaN(held.restartAt)).toBe(true)
    expect(held.frames.find((f) => f.t >= ESTOP.resetAt)!.power).toBe(true)
    expect(held.frames.find((f) => f.t >= ESTOP.releaseAt && f.t < ESTOP.resetAt)!.power).toBe(false)
  })
})

describe('fault states', () => {
  const base: FaultIn = { battV: 7.8, amps: 1, overFor: 0, sensorAge: 0.02, commsAge: 0.03, clearFor: 0, reset: false }
  it('ranks the worst input', () => {
    expect(faultLevel(base).level).toBe('OK')
    expect(faultLevel({ ...base, battV: 6.9 }).level).toBe('WARN')
    expect(faultLevel({ ...base, battV: 6.9, sensorAge: 0.3 })).toEqual({ level: 'LIMP', cause: 'sensor timeout' })
    expect(faultLevel({ ...base, commsAge: 0.6 })).toEqual({ level: 'STOP', cause: 'comms lost' })
  })
  it('boots with the motors off, then runs', () => {
    const { frames } = faultFsmRun('comms', true)
    expect(frames[0].state).toBe('BOOT')
    expect(frames[0].cap).toBe(0)
    expect(frames.find((f) => f.state === 'OK')!.t).toBeGreaterThanOrEqual(FAULT.bootS - FAULT.dt)
  })
  it('comms loss: a blip warns, a long dropout stops, then it recovers', () => {
    const s = faultFsmRun('comms', true).frames.map((f) => f.state)
    expect(s).toContain('WARN')
    expect(s).toContain('STOP')
    expect(s[s.length - 1]).toBe('OK')
  })
  it('battery drains OK → WARN → LIMP → STOP', () => {
    const s = faultFsmRun('battery', true).frames.map((f) => f.state)
    const order = ['OK', 'WARN', 'LIMP', 'STOP'].map((x) => s.indexOf(x as never))
    expect(order.every((k, i) => k > 0 && (i === 0 || k > order[i - 1]))).toBe(true)
  })
  it('a stall latches until reset; unlatched it retries into the stall again', () => {
    const latched = faultFsmRun('stall', true).frames
    expect(latched.some((f) => f.state === 'LATCH')).toBe(true)
    expect(latched.filter((f) => f.t < FAULT.resetAt).every((f) => f.state !== 'LATCH' || f.cap === 0)).toBe(true)
    expect(latched[latched.length - 1].state).toBe('OK')
    const trips = faultFsmRun('stall', false).frames.filter((f, i, a) => i && f.state === 'STOP' && a[i - 1].state !== 'STOP').length
    expect(trips).toBeGreaterThan(1)
  })
  it('a sensor timeout limps, a dead sensor stops', () => {
    const s = faultFsmRun('sensor', true).frames
    expect(s.find((f) => f.t >= 3)!.state).toBe('LIMP')
    expect(s.find((f) => f.t >= 7.5)!.state).toBe('STOP')
  })
})
