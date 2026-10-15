import { DRIVE_PDU_BYTES, JOY, LAG, WS, arcadeMix, byteInt8, cmdJson, creepM, deadzone, driveBytes, expoCurve, joyRun, lagRun, peakJerk, safeSpeed, slewStep, stickToWheels, stopDistance, wsBytes, wsRun } from './remote'

describe('joystick shaping', () => {
  it('deadzone zeroes the centre and rescales the rest', () => {
    expect(deadzone(0.08, 0.1)).toBe(0)
    expect(deadzone(-0.55, 0.1)).toBeCloseTo(-0.5)
    expect(deadzone(1, 0.1)).toBe(1)
  })
  it('expo keeps the ends and softens the middle', () => {
    expect(expoCurve(1, 0.6)).toBeCloseTo(1)
    expect(expoCurve(-1, 0.6)).toBeCloseTo(-1)
    expect(expoCurve(0.5, 0.6)).toBeCloseTo(0.275)
  })
  it('arcade mix turns in place and scales down a full diagonal', () => {
    expect(arcadeMix(0, 1)).toEqual([1, 1])
    expect(arcadeMix(-0.5, 0)).toEqual([-0.5, 0.5])
    expect(arcadeMix(1, 1)).toEqual([1, 0])
    expect(stickToWheels(0.05, 0.08, { dz: 0.1, expo: 0.6 })).toEqual([0, 0])
  })
  it('slew limits a step and int8 packs signed speeds', () => {
    expect(slewStep(0, 1, 0.025)).toBeCloseTo(0.025)
    expect(slewStep(0.5, 0.49, 0.025)).toBeCloseTo(0.49)
    expect(driveBytes(257, 1, -1)).toEqual([0x01, 0x7f, 0x81])
    expect(byteInt8(0x81)).toBeCloseTo(-1)
    expect(DRIVE_PDU_BYTES).toBe(20)
  })
})

describe('joystick over BLE run', () => {
  const raw = joyRun({ dz: 0, expo: 0 }, 0, 20)
  const tuned = joyRun({ dz: 0.1, expo: 0.6 }, JOY.slewPerS, 20)
  it('raw stick creeps after release; deadzone parks it', () => {
    expect(creepM(raw.frames)).toBeGreaterThan(0.1)
    expect(creepM(tuned.frames)).toBeLessThan(0.005)
  })
  it('slew limit caps wheel change per second', () => {
    expect(peakJerk(raw.frames)).toBeGreaterThan(100)
    expect(peakJerk(tuned.frames)).toBeCloseTo(JOY.slewPerS)
  })
  it('notify rate is capped by one notification per connection event', () => {
    expect(joyRun({ dz: 0.1, expo: 0.6 }, 0, 50).link.rate).toBeCloseTo(1 / JOY.ciS)
    expect(raw.packets.length).toBe(JOY.seconds * 20 + 1)
    for (const p of raw.packets) expect(p.arrive - p.sent).toBeLessThanOrEqual(JOY.ciS + 1e-9)
  })
})

describe('WebSocket control', () => {
  it('client frames are masked JSON over TCP', () => {
    const j = cmdJson(12, 0.4)
    expect(j).toBe('{"seq":12,"v":0.40,"w":0}')
    expect(wsBytes(j, true)).toBe(40 + 2 + 4 + j.length)
    expect(wsBytes(j, false)).toBe(40 + 2 + j.length)
  })
  it('a dropout with no timeout drives into the wall', () => {
    const r = wsRun('periodic', 0, true).frames
    expect(r[r.length - 1].crashed).toBe(true)
  })
  it('a stale-command timeout stops it short of the wall', () => {
    const ok = wsRun('periodic', 0, false).frames
    const to = wsRun('periodic', 0.3, true).frames
    expect(to[to.length - 1].crashed).toBe(false)
    expect(to[to.length - 1].x).toBeLessThan(ok[ok.length - 1].x)
    expect(to.find((f) => f.t > 1 && f.timedOut)!.t).toBeCloseTo(WS.dropout[0] + 0.3, 1)
  })
  it('send-on-change with a timeout stutters: no heartbeat', () => {
    const r = wsRun('change', 0.3, false)
    const stops = r.frames.filter((f, i) => i && f.timedOut && !r.frames[i - 1].timedOut).length
    expect(stops).toBeGreaterThanOrEqual(2)
    expect(r.msgs.filter((m) => m.kind === 'cmd').length).toBeLessThan(10)
  })
  it('TCP holds messages through the dropout and delivers them in a burst', () => {
    const late = wsRun('periodic', 0.3, true).msgs.filter((m) => m.kind === 'cmd' && m.sent > WS.dropout[0] && m.sent < WS.dropout[1] - 0.1)
    expect(late.length).toBeGreaterThan(10)
    for (const m of late) expect(m.arrive).toBeCloseTo(WS.dropout[1] + WS.oneWayS)
  })
})

describe('latency', () => {
  it('stopping distance and safe speed invert each other', () => {
    expect(stopDistance(1, 0.3, 2)).toBeCloseTo(0.55)
    expect(stopDistance(safeSpeed(0.5, 0.5, 2), 0.5, 2)).toBeCloseTo(0.5)
    expect(safeSpeed(LAG.clearM, 0.8, LAG.decel)).toBeLessThan(safeSpeed(LAG.clearM, 0.2, LAG.decel))
  })
  it('overshoot ≈ speed × RTT; prediction cancels it', () => {
    expect(lagRun(0.3, 0, 1, false).overshoot).toBeCloseTo(0.3, 1)
    expect(lagRun(0.3, 0, 0.5, false).overshoot).toBeCloseTo(0.15, 1)
    expect(Math.abs(lagRun(0.3, 0, 1, true).overshoot)).toBeLessThan(0.02)
  })
  it('jitter reorders frames; late ones are dropped', () => {
    const r = lagRun(0.3, 0.06, 1, false)
    expect(r.msgs.some((m) => m.late)).toBe(true)
    expect(lagRun(0.3, 0, 1, false).msgs.some((m) => m.late)).toBe(false)
    for (const f of r.frames) expect(f.shown).toBeLessThanOrEqual(f.x + 1e-9)
  })
})
