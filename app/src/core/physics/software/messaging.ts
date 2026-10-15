// ROS 2 graph, simulated: topics with QoS and queue depth, a service vs an action, a launch file that respawns a crashed node.

// --- Publish and subscribe: /scan fans out to three subscribers, each with its own link, speed and queue. ---

export type Qos = 'reliable' | 'best_effort'
export interface SubSpec {
  name: string
  /** One-way transport delay, ms. */
  linkMs: number
  /** Callback time per message, ms. */
  procMs: number
  /** Every n-th message is lost on the link (Wi-Fi), none if absent. */
  lossEvery?: number
}
export const SCAN_SUBS: SubSpec[] = [
  { name: 'obstacle_stop', linkMs: 1, procMs: 5 },
  { name: 'slam', linkMs: 1, procMs: 140 },
  { name: 'rviz2', linkMs: 12, procMs: 10, lossEvery: 4 },
]
export const PUBSUB_MS = 1200
/** Reliable QoS: the reader NACKs a gap on the next heartbeat and the writer re-sends after this long. */
export const RESEND_MS = 60

export type Fate = 'done' | 'lost' | 'overflow' | 'queued'
export interface Delivery {
  seq: number
  sent: number
  /** Time it reaches the subscriber's queue (null if lost). */
  arrive: number | null
  /** Where a best-effort drop or a reliable first copy vanished, ms. */
  lostAt?: number
  /** Reliable re-send leaves the publisher, ms. */
  resent?: number
  /** Callback runs over [start, end). */
  start?: number
  end?: number
  /** Overflowed out of the queue at this time. */
  dropped?: number
  fate: Fate
}

/** Publish times at `hz` over `horizonMs`, rounded to whole ms. */
export const publishTimes = (hz: number, horizonMs: number) =>
  Array.from({ length: Math.ceil((horizonMs * hz) / 1000) }, (_, k) => Math.round((k * 1000) / hz)).filter((t) => t < horizonMs)

/** One subscriber's view of a topic published at `hz`: link loss, in-order reliable re-sends, KEEP_LAST `depth` queue, one callback at a time. */
export function subscriberRun(sub: SubSpec, hz: number, qos: Qos, depth: number, horizonMs = PUBSUB_MS): Delivery[] {
  let order = 0
  const ds: Delivery[] = publishTimes(hz, horizonMs).map((sent, seq) => {
    const lost = !!sub.lossEvery && seq % sub.lossEvery === sub.lossEvery - 1
    const lostAt = lost ? sent + sub.linkMs / 2 : undefined
    if (lost && qos === 'best_effort') return { seq, sent, arrive: null, lostAt, fate: 'lost' }
    const resent = lost ? sent + RESEND_MS : undefined
    order = Math.max(order, (resent ?? sent) + sub.linkMs)
    return { seq, sent, arrive: order, lostAt, resent, fate: 'queued' }
  })
  const queue: Delivery[] = []
  const arrivals = ds.filter((d) => d.arrive !== null)
  let busy = 0
  let i = 0
  for (let t = 0; t < horizonMs; t++) {
    for (; i < arrivals.length && arrivals[i].arrive === t; i++) {
      if (queue.length >= depth) Object.assign(queue.shift()!, { fate: 'overflow', dropped: t })
      queue.push(arrivals[i])
    }
    if (busy <= t && queue.length) {
      const d = queue.shift()!
      Object.assign(d, { start: t, end: t + sub.procMs, fate: 'done' })
      busy = t + sub.procMs
    }
  }
  return ds
}

export interface SubStats {
  done: number
  lost: number
  overflow: number
  resent: number
  /** Mean / worst age of the data when its callback starts, ms. */
  meanAge: number
  maxAge: number
}

export function subStats(ds: Delivery[]): SubStats {
  const done = ds.filter((d) => d.fate === 'done')
  const ages = done.map((d) => d.start! - d.sent)
  return {
    done: done.length,
    lost: ds.filter((d) => d.fate === 'lost').length,
    overflow: ds.filter((d) => d.fate === 'overflow').length,
    resent: ds.filter((d) => d.resent !== undefined).length,
    meanAge: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0,
    maxAge: ages.length ? Math.max(...ages) : 0,
  }
}

/** Messages waiting in the queue at time `t` (arrived, not yet taken or dropped). */
export const queuedAt = (ds: Delivery[], t: number) =>
  ds.filter((d) => d.arrive !== null && d.arrive <= t && !(d.start !== undefined && d.start <= t) && !(d.dropped !== undefined && d.dropped <= t))

/** LaserScan bytes: ranges + intensities as float32, plus ~60 B of header/angles. */
export const scanBytes = (points: number) => 8 * points + 60

// --- Services and actions: navigate to a pose as one blocking call or as an action with feedback and cancel. ---

export type CallMode = 'service' | 'action' | 'cancel'
export const NAV_TICK_MS = 50
export const NAV_TICKS = 200
/** Robot speed, m/s. */
export const NAV_SPEED = 0.5
/** Request leaves the client at this tick. */
export const NAV_T0 = 4
/** One-way link, ticks (drawn slow). */
export const NAV_LINK = 4
/** Feedback every n ticks (5 Hz). */
export const FEEDBACK_EVERY = 4
/** Client UI timer every n ticks (10 Hz). */
export const UI_EVERY = 2

export type NavLane = 'call' | 'send_goal' | 'cancel_goal' | 'get_result' | 'feedback'
export interface NavMsg {
  lane: NavLane
  /** Toward the server (out) or back to the client. */
  out: boolean
  t0: number
  t1: number
  text: string
}
export interface NavRun {
  msgs: NavMsg[]
  /** Distance driven at each tick, m. */
  x: number[]
  busy: boolean[]
  blocked: boolean[]
  /** Ticks at which the client's UI timer callback ran. */
  ui: number[]
  /** Tick the client learns the outcome. */
  done: number
  status: 'SUCCEEDED' | 'CANCELED'
}

export const navTicks = (distM: number) => Math.round((distM / NAV_SPEED) * (1000 / NAV_TICK_MS))

export function navRun(mode: CallMode, distM: number): NavRun {
  const L = NAV_LINK
  const dur = navTicks(distM)
  const msgs: NavMsg[] = []
  const send = (lane: NavLane, out: boolean, t0: number, text: string) => {
    msgs.push({ lane, out, t0, t1: t0 + L, text })
    return t0 + L
  }
  let start: number
  let stop: number
  let done: number
  let status: NavRun['status'] = 'SUCCEEDED'
  if (mode === 'service') {
    start = send('call', true, NAV_T0, 'request')
    stop = start + dur
    done = send('call', false, stop, 'response')
  } else {
    start = send('send_goal', true, NAV_T0, 'goal')
    send('send_goal', false, start, 'accepted')
    send('get_result', true, start + L, 'get_result')
    stop = start + dur
    if (mode === 'cancel') {
      const tc = start + Math.floor(dur / 2)
      stop = send('cancel_goal', true, tc, 'cancel')
      send('cancel_goal', false, stop, 'canceling')
      status = 'CANCELED'
    }
    for (let t = start + FEEDBACK_EVERY; t < stop; t += FEEDBACK_EVERY) send('feedback', false, t, `${(distM - ((t - start) / dur) * distM).toFixed(1)} m`)
    done = send('get_result', false, stop, status)
  }
  const x = Array.from({ length: NAV_TICKS + 1 }, (_, t) => (Math.min(Math.max(t, start), stop) - start) * (distM / dur))
  const busy = x.map((_, t) => t >= start && t < stop)
  const blocked = x.map((_, t) => mode === 'service' && t >= NAV_T0 && t < done)
  const ui = x.map((_, t) => t).filter((t) => t % UI_EVERY === 0 && t < NAV_TICKS && !blocked[t])
  return { msgs, x, busy, blocked, ui, done, status }
}

/** Longest stretch the client's UI timer did not run, ms. */
export function uiGapMs(ui: number[]) {
  let worst = 0
  for (let i = 1; i < ui.length; i++) worst = Math.max(worst, ui[i] - ui[i - 1])
  return worst * NAV_TICK_MS
}

// --- Launch files: one launch starts four nodes; motor_driver crashes and is (maybe) respawned. ---

export const LAUNCH_NODES = ['lidar_driver', 'teleop', 'safety_stop', 'motor_driver'] as const
export type LaunchNode = (typeof LAUNCH_NODES)[number]
export const LAUNCH_TICK_MS = 100
export const LAUNCH_TICKS = 100
/** Spawn gap between nodes and start-up time to first publish, ticks. */
export const SPAWN_GAP = 2
export const STARTUP_TICKS = 4
export const CRASH_TICK = 40
/** /odom publishes every tick (10 Hz) while motor_driver is up. */
export type ProcState = 'starting' | 'up' | 'dead' | null

export interface LaunchRun {
  lanes: Record<LaunchNode, ProcState[]>
  /** Ticks /odom was published. */
  odom: number[]
  /** Tick the respawned process starts, or null. */
  respawnAt: number | null
  /** /odom silence after the crash, ms (to the end of the run if never respawned). */
  odomGapMs: number
}

export function launchRun(respawn: boolean, delayS: number): LaunchRun {
  const delay = Math.round((delayS * 1000) / LAUNCH_TICK_MS)
  const respawnAt = respawn ? CRASH_TICK + delay : null
  const lanes = Object.fromEntries(
    LAUNCH_NODES.map((name, k) => {
      const spawn = 1 + k * SPAWN_GAP
      const lane: ProcState[] = Array.from({ length: LAUNCH_TICKS }, (_, t) => {
        if (t < spawn) return null
        const crashed = name === 'motor_driver' && t >= CRASH_TICK
        if (!crashed) return t < spawn + STARTUP_TICKS ? 'starting' : 'up'
        if (respawnAt === null || t < respawnAt) return 'dead'
        return t < respawnAt + STARTUP_TICKS ? 'starting' : 'up'
      })
      return [name, lane]
    }),
  ) as Record<LaunchNode, ProcState[]>
  const odom = lanes.motor_driver.flatMap((s, t) => (s === 'up' ? [t] : []))
  const back = odom.find((t) => t >= CRASH_TICK) ?? LAUNCH_TICKS
  return { lanes, odom, respawnAt, odomGapMs: (back - CRASH_TICK) * LAUNCH_TICK_MS }
}
