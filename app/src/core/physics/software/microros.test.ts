import {
  RMW_UXRCE_MAX_PUBLISHERS,
  UNPLUG_TICKS,
  UROS_TICKS,
  imuCdrBytes,
  urosRun,
  urosStaticRam,
  urosStats,
  xrceDemand,
  xrceLink,
  xrceRun,
  xrceStats,
} from './microros'

describe('agent and client', () => {
  it('connects in two ticks when the agent is already up', () => {
    const r = urosRun('steady', 3)
    expect(r.moves.map((m) => m.to)).toEqual(['available', 'connected'])
    expect(urosStats(r)).toMatchObject({ imuOk: UROS_TICKS - 2, imuLost: 0, reconnects: 0, firstLiveMs: 100 })
  })
  it('keeps pinging every 500 ms until a late agent answers', () => {
    const r = urosRun('late', 3)
    expect(r.pings.slice(0, 3).map((p) => p.t)).toEqual([0, 9, 19])
    expect(urosStats(r).firstLiveMs).toBe(3550)
  })
  it('a lost agent is noticed by the next ping, entities destroyed, then rebuilt', () => {
    const r = urosRun('unplug', 3)
    expect(r.moves.map((m) => m.to)).toEqual(['available', 'connected', 'disconnected', 'waiting', 'available', 'connected'])
    const lost = r.moves[2].t
    expect(lost).toBeGreaterThanOrEqual(UNPLUG_TICKS[0])
    expect(lost).toBeLessThan(UNPLUG_TICKS[0] + 4)
    expect(r.moves[5].t).toBeGreaterThanOrEqual(UNPLUG_TICKS[1])
    const s = urosStats(r)
    expect(s.imuLost).toBe(lost - UNPLUG_TICKS[0] + 1)
    expect(s.reconnects).toBe(1)
  })
  it('one publisher over the static limit fails entity creation forever', () => {
    const r = urosRun('steady', RMW_UXRCE_MAX_PUBLISHERS + 1)
    expect(r.failed).toBe(true)
    expect(r.state).not.toContain('connected')
    expect(urosStats(r).imuOk).toBe(0)
  })
  it('reserves the stream buffers and every slot up front', () => {
    expect(urosStaticRam()).toEqual({ streams: 5120, slots: 2560, total: 16680 })
  })
})

describe('serial transport', () => {
  it('sizes an Imu message and its frames', () => {
    expect(imuCdrBytes()).toBe(324)
    expect(xrceLink('uart115')).toMatchObject({ payload: 336, stuffed: 3, bytes: 346 })
    expect(xrceLink('uart115').busyMs).toBeCloseTo(30.03, 2)
    expect(xrceLink('uart921').busyMs).toBeCloseTo(3.754, 3)
    expect(xrceLink('udp')).toMatchObject({ bytes: 400, mbps: 65 })
  })
  it('115200 baud cannot carry 100 Hz: the timer skips three in four', () => {
    expect(xrceDemand('uart115', 100)).toBeGreaterThan(3)
    expect(xrceStats(xrceRun('uart115', false, 0))).toMatchObject({ ok: 25, skipped: 75 })
  })
  it('reliable at 115200 queues up to the history depth, so latency piles up', () => {
    const s = xrceStats(xrceRun('uart115', true, 0))
    expect(s.meanMs).toBeGreaterThan(100)
    expect(s.load).toBeLessThanOrEqual(1)
  })
  it('921600 and UDP fit, with ~5 ms and ~3 ms latency', () => {
    expect(xrceStats(xrceRun('uart921', false, 0))).toMatchObject({ ok: 100, skipped: 0 })
    expect(xrceStats(xrceRun('uart921', false, 0)).meanMs).toBeCloseTo(4.75, 2)
    expect(xrceStats(xrceRun('udp', false, 0)).meanMs).toBeCloseTo(3.3, 1)
  })
  it('best effort loses what the link drops; reliable re-sends it in order', () => {
    const be = xrceStats(xrceRun('udp', false, 0.1))
    expect(be.lost).toBeGreaterThan(0)
    expect(be.ok + be.lost).toBe(100)
    const run = xrceRun('udp', true, 0.1)
    const rel = xrceStats(run)
    expect(rel).toMatchObject({ ok: 100, lost: 0, retries: be.lost })
    expect(rel.maxMs).toBeGreaterThan(12)
    const arr = run.map((m) => m.arrive!)
    expect(arr).toEqual([...arr].sort((a, b) => a - b))
  })
})
