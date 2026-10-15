import {
  CRASH_TICK,
  NAV_T0,
  RESEND_MS,
  SCAN_SUBS,
  launchRun,
  navRun,
  navTicks,
  publishTimes,
  queuedAt,
  scanBytes,
  subStats,
  subscriberRun,
  uiGapMs,
} from './messaging'

const [fast, slam, rviz] = SCAN_SUBS

describe('publish and subscribe', () => {
  it('publishes at the set rate', () => {
    expect(publishTimes(10, 1000)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900])
    expect(publishTimes(15, 200)).toEqual([0, 67, 133])
  })
  it('a fast local subscriber gets every message within a few ms', () => {
    const s = subStats(subscriberRun(fast, 20, 'best_effort', 1))
    expect(s).toMatchObject({ done: 24, lost: 0, overflow: 0 })
    expect(s.maxAge).toBe(1)
  })
  it('best effort drops every 4th over Wi-Fi; reliable re-sends it and holds later ones in order', () => {
    const be = subscriberRun(rviz, 10, 'best_effort', 5)
    expect(subStats(be)).toMatchObject({ lost: 3, done: 9, resent: 0 })
    const rel = subscriberRun(rviz, 10, 'reliable', 5)
    expect(subStats(rel)).toMatchObject({ lost: 0, done: 12, resent: 3 })
    expect(rel[3].arrive).toBe(300 + RESEND_MS + rviz.linkMs)
    const arrivals = rel.map((d) => d.arrive!)
    expect([...arrivals].sort((a, b) => a - b)).toEqual(arrivals)
  })
  it('a slow subscriber: depth 1 stays fresh but drops; a deep queue keeps more but serves stale scans', () => {
    const shallow = subStats(subscriberRun(slam, 20, 'reliable', 1))
    const deep = subStats(subscriberRun(slam, 20, 'reliable', 10))
    expect(shallow.overflow).toBeGreaterThan(deep.overflow)
    expect(deep.maxAge).toBeGreaterThan(3 * shallow.maxAge)
    expect(shallow.maxAge).toBeLessThan(slam.procMs)
  })
  it('the queue never holds more than its depth', () => {
    const ds = subscriberRun(slam, 20, 'reliable', 3)
    for (let t = 0; t < 1200; t += 7) expect(queuedAt(ds, t).length).toBeLessThanOrEqual(3)
  })
  it('a LaserScan of 1455 points is ~11.7 kB', () => expect(scanBytes(1455)).toBe(11700))
})

describe('services and actions', () => {
  it('a blocking service call starves the client timer for the whole drive', () => {
    const r = navRun('service', 2)
    expect(navTicks(2)).toBe(80)
    expect(r.done).toBe(NAV_T0 + 88)
    expect(r.msgs.map((m) => m.text)).toEqual(['request', 'response'])
    expect(uiGapMs(r.ui)).toBe(90 * 50)
    expect(r.x[r.done]).toBeCloseTo(2)
  })
  it('an action streams feedback at 5 Hz and leaves the client free', () => {
    const r = navRun('action', 2)
    const fb = r.msgs.filter((m) => m.lane === 'feedback')
    expect(fb.length).toBe(19)
    expect(fb[0].text).toBe('1.9 m')
    expect(uiGapMs(r.ui)).toBe(100)
    expect(r.status).toBe('SUCCEEDED')
  })
  it('cancel stops the robot half-way and the result is CANCELED', () => {
    const r = navRun('cancel', 2)
    expect(r.status).toBe('CANCELED')
    expect(r.x[r.x.length - 1]).toBeCloseTo(1.1)
    expect(r.msgs.some((m) => m.lane === 'cancel_goal' && m.out)).toBe(true)
  })
})

describe('launch files', () => {
  it('starts each node in turn and respawns the crashed driver after the delay', () => {
    const r = launchRun(true, 2)
    expect(r.lanes.lidar_driver.slice(0, 6)).toEqual([null, 'starting', 'starting', 'starting', 'starting', 'up'])
    expect(r.lanes.motor_driver[CRASH_TICK]).toBe('dead')
    expect(r.respawnAt).toBe(CRASH_TICK + 20)
    expect(r.odomGapMs).toBe(2400)
  })
  it('without respawn /odom stays silent to the end', () => {
    const r = launchRun(false, 2)
    expect(r.respawnAt).toBeNull()
    expect(r.lanes.motor_driver[99]).toBe('dead')
    expect(r.odomGapMs).toBe(6000)
  })
})
