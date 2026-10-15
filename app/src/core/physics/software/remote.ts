import { clamp } from '../common'
import { Pose } from '../room'
import { hash01 } from '../mcu/timers'
import { BLE_L2CAP_BYTES, BLE_LL_BYTES, TCP_IP_BYTES, WS_HDR_BYTES, gattLink } from '../mcu/wireless'
import { odoStep } from '../sensors/encoder'

// --- Joystick over BLE: stick → deadzone → expo → arcade mix → notify → slew-limited wheels ---

/** Inside `dz` reads 0; outside, rescaled so the edge of the deadzone is 0 and full throw is still 1. */
export const deadzone = (v: number, dz: number) => (Math.abs(v) <= dz ? 0 : (Math.sign(v) * (Math.abs(v) - dz)) / (1 - dz))
/** Blend of linear and cubic: fine control near centre, full speed at full throw. */
export const expoCurve = (v: number, k: number) => (1 - k) * v + k * v * v * v
/** Arcade mixing: forward ± turn per wheel, scaled down together so neither exceeds full speed. */
export function arcadeMix(x: number, y: number): [number, number] {
  const l = y + x
  const r = y - x
  const m = Math.max(1, Math.abs(l), Math.abs(r))
  return [l / m, r / m]
}
/** Step `from` toward `to` by at most `maxStep`. */
export const slewStep = (from: number, to: number, maxStep: number) => from + clamp(to - from, -maxStep, maxStep)

export interface StickShape {
  dz: number
  expo: number
}
export const stickToWheels = (x: number, y: number, s: StickShape) => arcadeMix(expoCurve(deadzone(x, s.dz), s.expo), expoCurve(deadzone(y, s.dz), s.expo))

/** Signed −1…1 to an int8 byte (two's complement). */
export const int8Byte = (v: number) => (Math.round(clamp(v, -1, 1) * 127) + 0x100) % 0x100
export const byteInt8 = (b: number) => (b >= 0x80 ? b - 0x100 : b) / 127
/** Drive characteristic value: [seq, left, right]. */
export const driveBytes = (seq: number, l: number, r: number) => [seq % 0x100, int8Byte(l), int8Byte(r)]
/** One notification on air: ATT opcode + handle + 3 B value, L2CAP and LL framing. */
export const DRIVE_PDU_BYTES = 3 + 3 + BLE_L2CAP_BYTES + BLE_LL_BYTES

export const JOY = {
  dt: 0.01,
  seconds: 13,
  track: 0.16,
  vMax: 0.5,
  ciS: 0.03,
  rest: [0.08, 0.1] as [number, number],
  slewPerS: 2.5,
  releaseAt: 9.4,
}

/** Driver's thumb: [x right, y forward]; it never comes back to exact centre. */
export function thumbAt(t: number): [number, number] {
  const tremor = 0.015 * Math.sin(t * 23)
  const seg: [number, number, number][] = [
    [0.6, ...JOY.rest],
    [2.8, 0, 1],
    [4.6, 0.3, 0.75],
    [5.8, 0.08, 0.6],
    [6.6, -0.45, 0],
    [JOY.releaseAt, 0, 1],
  ]
  const s = seg.find(([end]) => t < end)
  const [x, y] = s ? [s[1], s[2]] : JOY.rest
  return [clamp(x + tremor, -1, 1), clamp(y + tremor, -1, 1)]
}

export interface JoyFrame extends Pose {
  t: number
  sx: number
  sy: number
  l: number
  r: number
  wl: number
  wr: number
  seq: number
}
export interface JoyPacket {
  seq: number
  sent: number
  arrive: number
  bytes: number[]
}

/** BLE notifies at `hz`, capped by one notification per connection event; robot slews wheels at `slew` full-scale/s (0 = off). */
export function joyRun(shape: StickShape, slew: number, hz: number) {
  const link = gattLink('notify', JOY.ciS, hz)
  const period = 1 / link.rate
  const frames: JoyFrame[] = []
  const packets: JoyPacket[] = []
  let pose: Pose = { x: 0, y: 0, th: 0 }
  let target = [0, 0]
  let w = [0, 0]
  let nextSend = 0
  let seq = 0
  for (let i = 0; i <= Math.round(JOY.seconds / JOY.dt); i++) {
    const t = i * JOY.dt
    const [sx, sy] = thumbAt(t)
    const [l, r] = stickToWheels(sx, sy, shape)
    if (t >= nextSend - 1e-9) {
      packets.push({ seq, sent: t, arrive: Math.ceil(t / JOY.ciS + 1e-9) * JOY.ciS, bytes: driveBytes(seq, l, r) })
      seq++
      nextSend += period
    }
    for (const p of packets) if (p.arrive <= t + 1e-9 && p.arrive > t - JOY.dt + 1e-9) target = [byteInt8(p.bytes[1]), byteInt8(p.bytes[2])]
    w = slew > 0 ? w.map((v, k) => slewStep(v, target[k], slew * JOY.dt)) : [...target]
    frames.push({ t, sx, sy, l, r, wl: w[0], wr: w[1], seq: seq - 1, ...pose })
    pose = odoStep(pose, w[0] * JOY.vMax * JOY.dt, w[1] * JOY.vMax * JOY.dt, JOY.track)
  }
  return { frames, packets, link }
}

/** Distance driven after the thumb let go. */
export function creepM(frames: JoyFrame[]) {
  const i = frames.findIndex((f) => f.t >= JOY.releaseAt + 0.6)
  const a = frames[i]
  const b = frames[frames.length - 1]
  return Math.hypot(b.x - a.x, b.y - a.y)
}
/** Largest wheel-command change per second (a jump = wheelie / slip). */
export function peakJerk(frames: JoyFrame[]) {
  let m = 0
  for (let i = 1; i < frames.length; i++) m = Math.max(m, Math.abs(frames[i].wl - frames[i - 1].wl), Math.abs(frames[i].wr - frames[i - 1].wr))
  return m / JOY.dt
}

// --- WebSocket control: JSON commands, acks with telemetry, stale-command timeout ---

export const WS = {
  dt: 0.01,
  seconds: 8,
  hz: 20,
  oneWayS: 0.015,
  cruise: 0.4,
  accel: 1,
  decel: 1.5,
  wallX: 1.8,
  halfLen: 0.12,
  pressAt: 0.3,
  trimAt: 1.6,
  releaseAt: 3.5,
  dropout: [3, 5.5] as [number, number],
}
/** WebSocket client frames carry a 4 B mask key on top of the 2 B header. */
export const WS_MASK_BYTES = 4
export type WsSend = 'change' | 'periodic'

export const cmdJson = (seq: number, v: number) => `{"seq":${seq},"v":${v.toFixed(2)},"w":0}`
export const ackJson = (seq: number, v: number) => `{"ack":${seq},"v":${v.toFixed(2)},"bat":7.9}`
export const wsBytes = (json: string, fromClient: boolean) => TCP_IP_BYTES + WS_HDR_BYTES + (fromClient ? WS_MASK_BYTES : 0) + json.length

/** Stick the driver holds: forward, a small trim, then let go. */
export const wsStick = (t: number) => (t < WS.pressAt ? 0 : t < WS.trimAt ? WS.cruise : t < WS.releaseAt ? WS.cruise - 0.05 : 0)

export interface WsMsg {
  seq: number
  kind: 'cmd' | 'ack'
  sent: number
  arrive: number
  json: string
  bytes: number
}
export interface WsFrame {
  t: number
  x: number
  v: number
  target: number
  age: number
  timedOut: boolean
  crashed: boolean
  ackAge: number
}

/** TCP never drops a segment, it holds it: during a dropout every message waits and lands in a burst when the link returns. */
const wsArrive = (sent: number, dropout: [number, number] | null) => {
  const a = sent + WS.oneWayS
  return dropout && a >= dropout[0] && a < dropout[1] ? dropout[1] + WS.oneWayS : a
}

export function wsRun(send: WsSend, timeoutS: number, fault: boolean) {
  const drop = fault ? WS.dropout : null
  const msgs: WsMsg[] = []
  let seq = 0
  let last = NaN
  for (let i = 0; i <= Math.round(WS.seconds / WS.dt); i++) {
    const t = i * WS.dt
    const v = wsStick(t)
    const due = send === 'periodic' ? i % Math.round(1 / (WS.hz * WS.dt)) === 0 : v !== last
    if (!due) continue
    last = v
    const json = cmdJson(seq, v)
    const arrive = wsArrive(t, drop)
    msgs.push({ seq, kind: 'cmd', sent: t, arrive, json, bytes: wsBytes(json, true) })
    seq++
  }
  const cmds = msgs.slice()
  for (const c of cmds) {
    const json = ackJson(c.seq, Number(JSON.parse(c.json).v))
    msgs.push({ seq: c.seq, kind: 'ack', sent: c.arrive, arrive: wsArrive(c.arrive, drop), json, bytes: wsBytes(json, false) })
  }
  const frames: WsFrame[] = []
  let x = 0
  let v = 0
  let target = 0
  let lastRx = -Infinity
  let lastAck = -Infinity
  let crashed = false
  for (let i = 0; i <= Math.round(WS.seconds / WS.dt); i++) {
    const t = i * WS.dt
    for (const c of cmds) if (c.arrive <= t + 1e-9 && c.arrive > t - WS.dt + 1e-9) {
      target = Number(JSON.parse(c.json).v)
      lastRx = t
    }
    for (const m of msgs) if (m.kind === 'ack' && m.arrive <= t + 1e-9) lastAck = Math.max(lastAck, m.sent)
    const age = t - lastRx
    const timedOut = timeoutS > 0 && age > timeoutS
    const goal = timedOut || crashed ? 0 : target
    v = slewStep(v, goal, (goal > v ? WS.accel : WS.decel) * WS.dt)
    x += v * WS.dt
    if (x >= WS.wallX - WS.halfLen) {
      x = WS.wallX - WS.halfLen
      v = 0
      crashed = true
    }
    frames.push({ t, x, v, target, age, timedOut, crashed, ackAge: t - lastAck })
  }
  return { msgs, frames }
}

// --- Latency: drive at a gate through a delayed video feed ---

export const LAG = {
  dt: 0.005,
  seconds: 6,
  fps: 30,
  gateX: 2,
  accel: 2,
  decel: 2,
  reactS: 0.2,
  clearM: 0.5,
}

/** Stopping distance: travel during the dead time `deadS`, then braking at `decel`. */
export const stopDistance = (v: number, deadS: number, decel: number) => v * deadS + (v * v) / (2 * decel)
/** Fastest speed that still stops within `distM`. */
export const safeSpeed = (distM: number, deadS: number, decel: number) => decel * (-deadS + Math.sqrt(deadS * deadS + (2 * distM) / decel))
/** One-way delay of message `i`: half the RTT plus 0…2 × `jitterS` (mean `jitterS`). */
export const oneWay = (rttS: number, jitterS: number, i: number) => rttS / 2 + 2 * jitterS * hash01(i)

export interface LagFrame {
  t: number
  x: number
  v: number
  shown: number
  stamp: number
  pressed: boolean
  braking: boolean
}
export interface LagMsg {
  i: number
  kind: 'video' | 'stop'
  sent: number
  arrive: number
  late: boolean
}

/** The driver presses stop when the robot on screen reaches a brake mark that already allows for braking and reaction.
 *  Prediction moves the on-screen robot ahead by the frame's age plus the expected uplink delay. */
export function lagRun(rttS: number, jitterS: number, speed: number, predict: boolean) {
  const brakeAt = LAG.gateX - stopDistance(speed, LAG.reactS, LAG.decel)
  const n = Math.round(LAG.seconds / LAG.dt)
  const xs: number[] = []
  const vs: number[] = []
  const msgs: LagMsg[] = []
  const frames: LagFrame[] = []
  let x = 0
  let v = 0
  let decideAt = Infinity
  let stopArrive = Infinity
  let shown = 0
  let stamp = -Infinity
  let lastVideo = -1
  for (let k = 0; k <= n; k++) {
    const t = k * LAG.dt
    const braking = t >= stopArrive
    v = braking ? Math.max(0, v - LAG.decel * LAG.dt) : Math.min(speed, v + LAG.accel * LAG.dt)
    x += v * LAG.dt
    xs.push(x)
    vs.push(v)
    const fi = Math.floor(t * LAG.fps + 1e-9)
    if (fi > lastVideo) {
      lastVideo = fi
      msgs.push({ i: fi, kind: 'video', sent: t, arrive: t + oneWay(rttS, jitterS, fi), late: false })
    }
    for (const m of msgs) {
      if (m.kind !== 'video' || m.arrive > t + 1e-9 || m.arrive <= t - LAG.dt + 1e-9) continue
      if (m.sent < stamp) {
        m.late = true
        continue
      }
      stamp = m.sent
      const j = Math.round(m.sent / LAG.dt)
      shown = predict ? xs[j] + vs[j] * (t - m.sent + rttS / 2 + jitterS) : xs[j]
    }
    if (decideAt === Infinity && shown >= brakeAt) {
      decideAt = t
      const sent = t + LAG.reactS
      const arrive = sent + oneWay(rttS, jitterS, 9999)
      msgs.push({ i: 0, kind: 'stop', sent, arrive, late: false })
      stopArrive = arrive
    }
    frames.push({ t, x, v, shown, stamp, pressed: t >= decideAt + LAG.reactS, braking })
  }
  const stopped = frames[frames.length - 1].x
  return { frames, msgs, brakeAt, overshoot: stopped - LAG.gateX, stopAt: stopArrive }
}
