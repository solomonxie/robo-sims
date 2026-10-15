// micro-ROS: an rclc client on the ESP32 reaches the ROS 2 graph through the micro-ROS agent (XRCE-DDS ↔ DDS).
import { hash01 } from '../common'
import { frameLength, FORMAT_8N1 } from '../mcu/uart'
import { linkRssi, wifiAttempt, wifiRate } from '../mcu/wireless'

// --- Agent and client: the reconnect state machine from the micro-ROS examples. ---

export type UrosState = 'waiting' | 'available' | 'connected' | 'disconnected'
export type AgentScenario = 'steady' | 'late' | 'unplug'
export const UROS_TICK_MS = 50
export const UROS_TICKS = 200
/** Ping the agent every 500 ms while waiting, every 200 ms (100 ms timeout) once connected. */
export const WAIT_PING_EVERY = 10
export const LIVE_PING_EVERY = 4
/** /imu every tick (20 Hz), teleop's /cmd_vel every other (10 Hz). */
export const CMD_EVERY = 2
export const AGENT_LATE_TICK = 60
export const UNPLUG_TICKS: [number, number] = [82, 130]
/** colcon.meta defaults: entity slots are fixed at build time. */
export const RMW_UXRCE_MAX_PUBLISHERS = 4
export const RMW_UXRCE_MAX_SUBSCRIPTIONS = 4
export const RMW_UXRCE_MAX_HISTORY = 4
export const UXR_MTU = 512

export const agentUp = (s: AgentScenario, t: number) => (s === 'late' ? t >= AGENT_LATE_TICK : s === 'unplug' ? t < UNPLUG_TICKS[0] || t >= UNPLUG_TICKS[1] : true)

export type UrosDelivery = 'ok' | 'lost' | null
export interface UrosRun {
  state: UrosState[]
  agent: boolean[]
  imu: UrosDelivery[]
  cmd: UrosDelivery[]
  pings: { t: number; ok: boolean }[]
  /** Transition at the end of tick t. */
  moves: { t: number; from: UrosState; to: UrosState }[]
  failed: boolean
}

export function urosRun(scenario: AgentScenario, pubs: number): UrosRun {
  const failed = pubs > RMW_UXRCE_MAX_PUBLISHERS
  const r: UrosRun = { state: [], agent: [], imu: [], cmd: [], pings: [], moves: [], failed }
  let s: UrosState = 'waiting'
  let since = 0
  for (let t = 0; t < UROS_TICKS; t++) {
    const up = agentUp(scenario, t)
    r.state.push(s)
    r.agent.push(up)
    let next: UrosState = s
    if (s === 'waiting') {
      if (t === 0 || since % WAIT_PING_EVERY === WAIT_PING_EVERY - 1) {
        r.pings.push({ t, ok: up })
        if (up) next = 'available'
      }
    } else if (s === 'available') next = failed || !up ? 'waiting' : 'connected'
    else if (s === 'disconnected') next = 'waiting'
    const live = s === 'connected'
    r.imu.push(live ? (up ? 'ok' : 'lost') : null)
    r.cmd.push(t % CMD_EVERY ? null : live && up ? 'ok' : 'lost')
    if (live && since % LIVE_PING_EVERY === LIVE_PING_EVERY - 1) {
      r.pings.push({ t, ok: up })
      if (!up) next = 'disconnected'
    }
    if (next !== s) {
      r.moves.push({ t, from: s, to: next })
      s = next
      since = 0
    } else since++
  }
  return r
}

export function urosStats(r: UrosRun) {
  const count = (xs: UrosDelivery[], v: UrosDelivery) => xs.filter((x) => x === v).length
  const firstLive = r.state.indexOf('connected')
  return {
    imuOk: count(r.imu, 'ok'),
    imuLost: count(r.imu, 'lost'),
    cmdOk: count(r.cmd, 'ok'),
    cmdSent: r.cmd.filter((x) => x !== null).length,
    offlineMs: r.state.filter((x) => x !== 'connected').length * UROS_TICK_MS,
    firstLiveMs: firstLive < 0 ? null : firstLive * UROS_TICK_MS,
    reconnects: r.moves.filter((m) => m.to === 'disconnected').length,
  }
}

/** RAM reserved up front: reliable in/out streams (MTU × history) + best-effort in/out + entity slots. */
export const PUB_SLOT_BYTES = 280
export const SUB_SLOT_BYTES = 360
export const UROS_BASE_BYTES = 9000
export function urosStaticRam() {
  const streams = 2 * UXR_MTU * RMW_UXRCE_MAX_HISTORY + 2 * UXR_MTU
  const slots = RMW_UXRCE_MAX_PUBLISHERS * PUB_SLOT_BYTES + RMW_UXRCE_MAX_SUBSCRIPTIONS * SUB_SLOT_BYTES
  return { streams, slots, total: UROS_BASE_BYTES + streams + slots }
}

// --- Serial transport: one sensor_msgs/Imu per 10 ms over UART or UDP. ---

/** CDR size of sensor_msgs/Imu: encapsulation 4, stamp 8, frame_id string, then 8-aligned doubles (quat, 3 × vec3, 3 covariances). */
export function imuCdrBytes(frameId = 'imu_link') {
  const o = Math.ceil((8 + 4 + frameId.length + 1) / 8) * 8
  return 4 + o + 32 + 72 + 24 + 72 + 24 + 72
}
/** XRCE message header 4 + submessage header 4 + WRITE_DATA (request + object id) 4. */
export const XRCE_HDR = 12
/** Serial framing: 0x7E flag, src, dst, length ×2, CRC-16 ×2. */
export const SERIAL_FRAME = 7
/** UDP 8 + IPv4 20 + 802.11 MAC 24 + LLC/SNAP 8 + FCS 4. */
export const UDP_WIFI_HDR = 64
/** NACK / heartbeat round before a reliable stream re-sends. */
export const XRCE_RETRY_MS = 12
/** USB-serial bridge + agent read, and Wi-Fi stack + agent, before the DDS publish. */
export const UART_EXTRA_MS = 1
export const UDP_EXTRA_MS = 2.5
export const UDP_ROBOT_M = 6

export type XrceLink = 'uart115' | 'uart921' | 'udp'
export const LINK_BAUD: Record<Exclude<XrceLink, 'udp'>, number> = { uart115: 115200, uart921: 921600 }

/** Bytes on the link per message, ms the link is busy per try, and ms added after it. */
export function xrceLink(link: XrceLink, cdr = imuCdrBytes()) {
  const payload = cdr + XRCE_HDR
  if (link === 'udp') {
    const bytes = payload + UDP_WIFI_HDR
    const mbps = wifiRate(linkRssi(UDP_ROBOT_M))
    return { payload, bytes, stuffed: 0, busyMs: wifiAttempt(bytes, mbps) * 1000, extraMs: UDP_EXTRA_MS, mbps }
  }
  const stuffed = Math.ceil((payload * 2) / 256)
  const bytes = payload + SERIAL_FRAME + stuffed
  return { payload, bytes, stuffed, busyMs: (bytes * frameLength(FORMAT_8N1) * 1000) / LINK_BAUD[link], extraMs: UART_EXTRA_MS, mbps: LINK_BAUD[link] / 1e6 }
}

export interface XrceTry {
  t0: number
  t1: number
  lost: boolean
}
export interface XrceMsg {
  seq: number
  gen: number
  tries: XrceTry[]
  arrive: number | null
  fate: 'ok' | 'lost' | 'skipped'
  doneAt: number
}

/** Publish at `hz` for `horizonMs`. Best effort holds one message (a busy link makes the timer skip); reliable keeps up
 *  to RMW_UXRCE_MAX_HISTORY unacknowledged, re-sends a lost one after a NACK, and the agent delivers in order. */
export function xrceRun(link: XrceLink, reliable: boolean, loss: number, hz = 100, horizonMs = 1000): XrceMsg[] {
  const { busyMs, extraMs } = xrceLink(link)
  const cap = reliable ? RMW_UXRCE_MAX_HISTORY : 1
  const period = 1000 / hz
  const msgs: XrceMsg[] = []
  const ready: { m: XrceMsg; at: number }[] = []
  let free = 0
  let i = 0
  for (;;) {
    const g = i * period
    const hasGen = g < horizonMs
    ready.sort((a, b) => a.at - b.at || a.m.seq - b.m.seq)
    const start = ready.length ? Math.max(ready[0].at, free) : Infinity
    if (!hasGen && !ready.length) break
    if (hasGen && g <= start) {
      const open = msgs.filter((m) => m.fate !== 'skipped' && !(m.doneAt <= g)).length
      const m: XrceMsg = { seq: i, gen: g, tries: [], arrive: null, fate: open >= cap ? 'skipped' : 'ok', doneAt: open >= cap ? g : Infinity }
      msgs.push(m)
      if (m.fate === 'ok') ready.push({ m, at: g })
      i++
      continue
    }
    const { m } = ready.shift()!
    const t1 = start + busyMs
    const lost = hash01(m.seq * 31 + m.tries.length * 7 + 3) < loss
    m.tries.push({ t0: start, t1, lost })
    free = t1
    if (!lost) Object.assign(m, { arrive: t1 + extraMs, doneAt: t1 })
    else if (reliable) ready.push({ m, at: t1 + XRCE_RETRY_MS })
    else Object.assign(m, { fate: 'lost', doneAt: t1 })
  }
  if (reliable) {
    let last = 0
    for (const m of msgs) if (m.arrive !== null) last = m.arrive = Math.max(m.arrive, last)
  }
  return msgs
}

export function xrceStats(msgs: XrceMsg[], horizonMs = 1000) {
  const ok = msgs.filter((m) => m.arrive !== null)
  const lat = ok.map((m) => m.arrive! - m.gen)
  const busy = msgs.reduce((s, m) => s + m.tries.reduce((a, t) => a + Math.max(0, Math.min(t.t1, horizonMs) - t.t0), 0), 0)
  return {
    sent: msgs.length,
    ok: ok.length,
    lost: msgs.filter((m) => m.fate === 'lost').length,
    skipped: msgs.filter((m) => m.fate === 'skipped').length,
    retries: msgs.reduce((s, m) => s + Math.max(0, m.tries.length - 1), 0),
    meanMs: lat.length ? lat.reduce((s, x) => s + x, 0) / lat.length : 0,
    maxMs: lat.length ? Math.max(...lat) : 0,
    load: busy / horizonMs,
  }
}

/** Link load if every message went out once: bytes × bits per byte × rate. */
export const xrceDemand = (link: XrceLink, hz: number) => (xrceLink(link).busyMs * hz) / 1000
