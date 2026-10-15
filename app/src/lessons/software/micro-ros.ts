import * as THREE from 'three/webgpu'
import {
  AgentScenario,
  CMD_EVERY,
  FORMAT_8N1,
  LINK_BAUD,
  RMW_UXRCE_MAX_HISTORY,
  RMW_UXRCE_MAX_PUBLISHERS,
  SERIAL_FRAME,
  UDP_ROBOT_M,
  UDP_WIFI_HDR,
  UNPLUG_TICKS,
  UROS_TICKS,
  UROS_TICK_MS,
  UrosState,
  XRCE_HDR,
  XRCE_RETRY_MS,
  XrceLink,
  frameLength,
  imuCdrBytes,
  urosRun,
  urosStaticRam,
  urosStats,
  xrceDemand,
  xrceLink,
  xrceRun,
  xrceStats,
} from '../../core/physics'
import { bytesText } from '../../core/units'
import { V3, add, box } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  DATA_COLOR,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  IDF,
  LABEL,
  POWER,
  RING,
  addLabel,
  codeBlock,
  emptyGroup,
  esp32Board,
  flatBox,
  gantt,
  glowMat,
  i2cBreakout,
  liveLabel,
  memoBy,
  moduleBlock,
  packetPool,
  partLetter,
  rosTint,
  routerModel,
  simClock,
  stateDiagram,
  topicPipe,
  trayMat,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const RCLC_LEGEND = { color: IDF, label: 'Code: rclc (C) blue, $ agent CLI green', shape: 'dot' } as const
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`
const ms1 = (ms: number) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`

// --- Agent and client: rclc node on the ESP32 ↔ micro_ros_agent ↔ the DDS graph; ping, create, spin, lose, rebuild. ---

const AGENT: Record<AgentScenario, string> = { steady: 'Agent running', late: 'Agent starts late', unplug: 'Agent unplugged' }
const STATE_COLOR: Record<UrosState, string> = { waiting: HEAT, available: B_FIELD, connected: POWER, disconnected: HIGH_V }
const STATE_NAME: Record<UrosState, string> = { waiting: 'WAITING_AGENT', available: 'AGENT_AVAILABLE', connected: 'AGENT_CONNECTED', disconnected: 'AGENT_DISCONNECTED' }
const TOPICS = ['/imu', '/battery', '/range', '/odom', '/temp', '/status']
const AC_SLOW = 0.1
const AC_FLY = 2
const BLOCK: V3 = [7.4, 3.2, 1.4]
const CLIENT: V3 = [-15.5, 4.6, 0]
const AGENT_AT: V3 = [1, 4.6, 0]
const UP_Y = 5.5
const DOWN_Y = 3.7
const SLOT_X0 = -20.2
const SLOT_W = 2
const AC_GANTT = { x0: -1, x1: 19, y: -2, rowH: 1.1, ticks: UROS_TICKS }

const acRun = memoBy(
  (p: Params) => `${p.agent}|${p.pubs}`,
  (p: Params) => {
    const agent = pick(AGENT, p.agent, 'unplug')
    const pubs = n(p, 'pubs')
    const r = urosRun(agent, pubs)
    return { agent, pubs, r, s: urosStats(r) }
  },
)

export const agentAndClient: Lesson = {
  id: 'micro-ros-agent-and-client',
  title: 'Agent and client',
  tagline: 'A proxy on the laptop speaks DDS for the ESP32',
  formula: (p) => {
    const P = acRun(p)
    const ram = urosStaticRam()
    const head = 'rclc node on the ESP32 ↔ XRCE-DDS ↔ micro_ros_agent ↔ DDS graph'
    const sm = 'ping every 500 ms until pong → create entities → spin; ping every 200 ms, no pong → destroy, wait again'
    const mem = P.r.failed
      ? `${P.pubs} publishers > ${RMW_UXRCE_MAX_PUBLISHERS} static slots: publisher #${RMW_UXRCE_MAX_PUBLISHERS + 1} fails, it never connects`
      : `${P.pubs} / ${RMW_UXRCE_MAX_PUBLISHERS} publisher slots, ${bytesText(ram.total)} reserved at boot`
    return `${head} · ${sm} · ${mem} · slowed ${Math.round(AC_SLOW / (UROS_TICK_MS / 1000))}×`
  },
  legend: [
    { color: RING, label: '/imu (sensor_msgs/Imu) ESP32 → graph', shape: 'arrow-right' },
    { color: FORCE, label: '/cmd_vel (Twist) graph → ESP32', shape: 'arrow-left' },
    { color: LABEL, label: 'Ping → agent · pong ←', shape: 'dot' },
    { color: HIGH_V, label: 'Lost: agent gone · or no free slot', shape: 'dot' },
    RCLC_LEGEND,
  ],
  points: [
    'ROS 2 nodes talk DDS: threads, dynamic memory, an IP stack and megabytes of RAM. An ESP32 has 320 KB and often only a UART. micro-ROS puts the same rcl API on the microcontroller (rclc, in C) and swaps DDS for XRCE-DDS, a small client/agent protocol.',
    'The micro-ROS agent runs on the laptop or Raspberry Pi. It is a proxy: for every publisher or subscription the client asks for, it creates a real DDS one and forwards the data. To the rest of the graph /imu is just another topic (ROS 2 concepts → Publish and subscribe); ros2 topic list shows it, and the ESP32 never speaks DDS.',
    'The rclc node: rclc_support_init, rclc_node_init_default, a publisher for /imu, a subscription to /cmd_vel and a 50 ms timer, all handed to an executor. There are no threads: loop() calls rclc_executor_spin_some(), which runs whichever callbacks are ready (on_cmd_vel, the timer that publishes /imu) and returns.',
    'Memory is static. colcon.meta fixes RMW_UXRCE_MAX_PUBLISHERS, _MAX_SUBSCRIPTIONS, _MAX_HISTORY and the MTU when the library is built; the stream buffers and every slot are reserved at boot, used or not, and nothing is malloc’d afterwards. Slide past 4 publishers: the 5th rclc_publisher_init returns RCL_RET_ERROR. The fix is a bigger limit and a rebuild, not more heap.',
    'The client can’t tell the agent is gone until it asks. The reconnect state machine from the micro-ROS examples: WAITING_AGENT pings every 500 ms; on a pong, AGENT_AVAILABLE creates the entities; AGENT_CONNECTED spins and pings every 200 ms; a missed pong → AGENT_DISCONNECTED destroys everything and goes back to waiting.',
    'Between the unplug and the missed ping, /imu goes nowhere and no /cmd_vel arrives, so the motor code needs its own timeout. Firmware that only calls rclc init once in setup() stays dead until it is reset; the state machine heals by itself when the agent comes back.',
  ],
  controls: [
    { kind: 'choice', key: 'agent', options: opts(AGENT), initial: 'unplug' },
    { kind: 'slider', key: 'pubs', label: 'Publishers', min: 1, max: 6, initial: 2, step: 1, format: (v) => `${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    esp32Board(scene, [CLIENT[0] - 1, 8.4, 0], 0.26)
    addLabel(scene, 'ESP32 · rclc', [CLIENT[0] + 2.6, 8.4, 0], GREY, 0.36, 'left')
    const client = moduleBlock(scene, CLIENT, BLOCK, 'esp32_imu')
    const agent = moduleBlock(scene, AGENT_AT, BLOCK, 'micro_ros_agent')
    addLabel(scene, 'laptop / RPi', [AGENT_AT[0], AGENT_AT[1] - 2.3, 0], GREY, 0.36)
    const xl = CLIENT[0] + BLOCK[0] / 2
    const xr = AGENT_AT[0] - BLOCK[0] / 2
    const up = topicPipe(scene, [[xl, UP_Y, 0], [xr, UP_Y, 0]], '', DATA_COLOR, { r: 0.24 })
    const down = topicPipe(scene, [[xr, DOWN_Y, 0], [xl, DOWN_Y, 0]], '', DATA_COLOR, { r: 0.24 })
    addLabel(scene, 'XRCE-DDS · serial', [(xl + xr) / 2, 7.2, 0], DATA_COLOR, 0.42)
    const imuSub = moduleBlock(scene, [15.5, 7.4, 0], [6.6, 2.6, 1.4], 'imu_filter')
    const teleop = moduleBlock(scene, [15.5, 1.8, 0], [6.6, 2.6, 1.4], 'teleop')
    const ax = AGENT_AT[0] + BLOCK[0] / 2
    const imuPipe = topicPipe(scene, [[ax, UP_Y, 0], [8.4, UP_Y, 0], [8.4, 7.4, 0], [12.2, 7.4, 0]], '', RING, { r: 0.24 })
    const cmdPipe = topicPipe(scene, [[12.2, 1.8, 0], [8.4, 1.8, 0], [8.4, DOWN_Y, 0], [ax, DOWN_Y, 0]], '', FORCE, { r: 0.24 })
    addLabel(scene, '/imu', [10.3, 8.1, 0], RING, 0.42)
    addLabel(scene, '/cmd_vel', [10.3, 1, 0], FORCE, 0.42)
    addLabel(scene, 'DDS graph', [15.5, 4.6, 0], GREY, 0.4)
    box(scene, [6 * SLOT_W + 0.4, 1.5, 0.3], trayMat(), [SLOT_X0 + 2.5 * SLOT_W, 1.2, -0.4])
    addLabel(scene, `publisher slots · RMW_UXRCE_MAX_PUBLISHERS = ${RMW_UXRCE_MAX_PUBLISHERS}`, [SLOT_X0 - 0.8, -0.2, 0], GREY, 0.32, 'left')
    const slots = add(scene, new THREE.Group())
    const dia = stateDiagram(
      scene,
      [-13.6, -4.6, 0],
      [
        { id: 'waiting', label: 'WAITING', at: [-4.4, 2.1], color: STATE_COLOR.waiting },
        { id: 'available', label: 'AVAILABLE', at: [4.4, 2.1], color: STATE_COLOR.available },
        { id: 'connected', label: 'CONNECTED', at: [4.4, -2.1], color: STATE_COLOR.connected },
        { id: 'disconnected', label: 'LOST', at: [-4.4, -2.1], color: STATE_COLOR.disconnected },
      ],
      [
        { from: 'waiting', to: 'available', label: 'pong', bend: -0.5 },
        { from: 'available', to: 'waiting', label: 'init fail', bend: -0.5 },
        { from: 'available', to: 'connected', label: 'init', bend: -0.5 },
        { from: 'connected', to: 'disconnected', label: 'no pong', bend: -0.01 },
        { from: 'disconnected', to: 'waiting', label: 'wait', bend: -0.5 },
      ],
      { r: 1.55, text: 0.3 },
    )
    dia.group.scale.setScalar(0.75)
    const edgeOf = (from: UrosState, to: UrosState) =>
      ['waiting>available', 'available>waiting', 'available>connected', 'connected>disconnected', 'disconnected>waiting'].indexOf(`${from}>${to}`)
    const chart = gantt(scene, 3, AC_GANTT)
    ;['agent', 'client', '/imu'].forEach((t, i) => chart.name(i, t, LABEL))
    for (let s = 0; s * 1000 <= UROS_TICKS * UROS_TICK_MS; s += 2)
      partLetter(scene, `${s} s`, [AC_GANTT.x0 + ((s * 1000) / UROS_TICK_MS / UROS_TICKS) * (AC_GANTT.x1 - AC_GANTT.x0), chart.rowY(2) - 1.3, 0], 0.32, GREY)
    const pool = packetPool(scene, 40, 0.55)
    const status = liveLabel(scene, [-20.5, -15.2, 0.3], { size: 0.44, align: 'left' })
    const code = codeBlock(scene, [-20.5, -9.8, 0], 0.34, 5, rosTint)
    const clock = simClock(AC_SLOW)
    let key = ''
    let fired = -1
    return {
      scene,
      view: { center: [-1, 1.2, 0], radius: 78, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const P = acRun(p)
        const { r } = P
        const k = `${P.agent}|${P.pubs}`
        if (k !== key) {
          key = k
          fired = -1
          emptyGroup(slots)
          for (let i = 0; i < P.pubs; i++) {
            const over = i >= RMW_UXRCE_MAX_PUBLISHERS
            const at: V3 = [SLOT_X0 + i * SLOT_W, 1.2, 0]
            flatBox(slots, [SLOT_W - 0.2, 1.1, 0.25], glowMat(over ? HIGH_V : i ? B_FIELD : RING, over ? 0.9 : 0.5), at)
            partLetter(slots, TOPICS[i], [at[0], at[1], 0.3], 0.27, over ? LABEL : '#14161b')
          }
          for (let i = P.pubs; i < RMW_UXRCE_MAX_PUBLISHERS; i++) flatBox(slots, [SLOT_W - 0.2, 1.1, 0.25], glowMat(GREY, 0.05), [SLOT_X0 + i * SLOT_W, 1.2, 0])
          chart.rebuild(
            (row, t) =>
              row === 0
                ? r.agent[t]
                  ? { color: B_FIELD, dim: true }
                  : { color: HIGH_V, text: 'stopped' }
                : row === 1
                  ? { color: STATE_COLOR[r.state[t]], dim: r.state[t] !== 'connected', text: r.state[t] === 'connected' ? 'spin' : '' }
                  : r.imu[t]
                    ? { color: r.imu[t] === 'ok' ? RING : HIGH_V }
                    : null,
            [],
          )
        }
        const now = clock(dt, key, UROS_TICKS)
        const t = Math.min(UROS_TICKS - 1, Math.floor(now))
        chart.show(now)
        const state = r.state[t]
        const upNow = r.agent[t]
        const move = r.moves.filter((m) => m.t < now).at(-1)
        const mi = move ? r.moves.indexOf(move) : -1
        if (mi !== fired) {
          fired = mi
          if (move && now - move.t < 1.5) dia.fire(edgeOf(move.from, move.to))
        }
        dia.frame(dt, state)
        pool.begin()
        const fade = (pipe: ReturnType<typeof topicPipe>, u: number, since: number, color: string) => {
          const at = pipe.at(u)
          pool.put([at[0], at[1] - since * 0.8, at[2]], color, { w: 0.6, payload: 0.75, fade: 1 - since })
        }
        let imuLive = false
        let cmdLive = false
        for (let k0 = Math.max(0, Math.floor(now - 2 * AC_FLY)); k0 <= t; k0++) {
          const u = (now - k0) / AC_FLY
          const im = r.imu[k0]
          if (im) {
            if (u < 1) {
              const lostU = 0.5
              if (im === 'ok' || u < lostU) pool.put(up.at(u), RING, { w: 0.6, payload: 0.75 })
              else fade(up, lostU, (u - lostU) * 2, HIGH_V)
              imuLive = true
            } else if (im === 'ok' && u < 2) pool.put(imuPipe.at(u - 1), RING, { w: 0.6, payload: 0.75 })
          }
          const cm = r.cmd[k0]
          if (cm) {
            if (u < 1) {
              pool.put(cmdPipe.at(u), FORCE, { w: 0.6, payload: 0.75 })
              cmdLive = true
            } else if (u < 2) {
              if (cm === 'ok') pool.put(down.at(u - 1), FORCE, { w: 0.6, payload: 0.75 })
              else if (u < 1.5) fade(cmdPipe, 1, (u - 1) * 2, HIGH_V)
            }
          }
        }
        for (const pg of r.pings) {
          const u = (now - pg.t) / (AC_FLY / 2)
          if (u < 0 || u >= 2) continue
          if (u < 1) pool.put(up.at(u), LABEL, { w: 0.35, payload: 0, text: u < 0.6 ? 'ping' : '' })
          else if (pg.ok) pool.put(down.at(u - 1), LABEL, { w: 0.35, payload: 0, text: u > 1.4 ? 'pong' : '' })
          else if (u < 1.5) fade(up, 1, (u - 1) * 2, HIGH_V)
        }
        pool.end()
        up.glow(imuLive ? 0.6 : 0)
        down.glow(state === 'connected' ? 0.4 : 0)
        imuPipe.glow(imuLive && upNow ? 0.6 : 0)
        cmdPipe.glow(cmdLive ? 0.5 : 0)
        const gotCmd = r.cmd.some((c, i) => c === 'ok' && now - i >= 2 * AC_FLY && now - i < 2 * AC_FLY + 0.6)
        client(dt, STATE_COLOR[state], state === 'connected' ? (gotCmd ? 1 : 0.7) : 0.5, state === 'connected' ? (gotCmd ? 'on_cmd_vel()' : 'esp32_imu') : STATE_NAME[state].toLowerCase())
        agent(dt, upNow ? B_FIELD : HIGH_V, upNow ? 0.7 : 0.25, upNow ? 'micro_ros_agent' : 'agent stopped')
        imuSub(dt, RING, imuLive && upNow && state === 'connected' ? 0.8 : 0.15)
        teleop(dt, FORCE, t % CMD_EVERY === 0 ? 0.8 : 0.3)
        const ms = now * UROS_TICK_MS
        const outage = P.agent === 'unplug' && t >= UNPLUG_TICKS[0] && t < UNPLUG_TICKS[1]
        status.set(
          `t = ${sec(ms)} · ${STATE_NAME[state]}${
            P.r.failed
              ? ` · create_entities() fails on publisher #${RMW_UXRCE_MAX_PUBLISHERS + 1}, retry in 500 ms`
              : outage && state === 'connected'
                ? ' · agent gone, client doesn’t know yet: /imu lost'
                : outage
                  ? ' · pinging a dead agent every 500 ms'
                  : state === 'connected'
                    ? ` · /imu at ${1000 / UROS_TICK_MS} Hz, /cmd_vel at ${1000 / (UROS_TICK_MS * CMD_EVERY)} Hz`
                    : ''
          }`,
          state === 'connected' && !outage ? LABEL : STATE_COLOR[state],
        )
        const ram = urosStaticRam()
        code([
          `rclc_publisher_init_best_effort(&imu_pub, &node, ROSIDL_GET_MSG_TYPE_SUPPORT(sensor_msgs, msg, Imu), "imu");   // + ${P.pubs - 1} more publishers`,
          'rclc_executor_init(&exec, &support.context, 2, &alloc);   rclc_executor_add_subscription(&exec, &cmd_sub, &twist, on_cmd_vel, ON_NEW_DATA);',
          state === 'waiting'
            ? 'case WAITING_AGENT: EXECUTE_EVERY_N_MS(500, state = (RMW_RET_OK == rmw_uros_ping_agent(100, 1)) ? AGENT_AVAILABLE : WAITING_AGENT);'
            : state === 'available'
              ? `case AGENT_AVAILABLE: state = create_entities() ? AGENT_CONNECTED : WAITING_AGENT;   // ${P.r.failed ? 'RCL_RET_ERROR: no free slot' : 'node, pubs, sub, timer, executor'}`
              : state === 'connected'
                ? 'case AGENT_CONNECTED: EXECUTE_EVERY_N_MS(200, state = ping_ok() ? AGENT_CONNECTED : AGENT_DISCONNECTED); rclc_executor_spin_some(&exec, 0);'
                : 'case AGENT_DISCONNECTED: destroy_entities();   state = WAITING_AGENT;',
          `// colcon.meta: -DRMW_UXRCE_MAX_PUBLISHERS=${RMW_UXRCE_MAX_PUBLISHERS} -DRMW_UXRCE_MAX_HISTORY=${RMW_UXRCE_MAX_HISTORY} → ${bytesText(ram.streams)} stream buffers + ${bytesText(ram.slots)} slots, reserved at boot`,
          '$ ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ttyUSB0 -b 115200',
        ])
      },
      readouts: (p) => {
        const P = acRun(p)
        const { s } = P
        return [
          { label: '/imu delivered', value: `${s.imuOk} / ${UROS_TICKS}`, tone: s.imuOk > UROS_TICKS * 0.9 ? 'ok' : s.imuOk ? 'warn' : 'bad' },
          { label: 'Offline', value: sec(s.offlineMs), tone: s.offlineMs <= 200 ? 'ok' : s.firstLiveMs === null ? 'bad' : 'warn' },
          { label: 'Publisher slots', value: `${P.pubs} / ${RMW_UXRCE_MAX_PUBLISHERS}`, tone: P.r.failed ? 'bad' : 'ok' },
          { label: 'Static RAM', value: bytesText(urosStaticRam().total) },
        ]
      },
    }
  },
}

// --- Serial transport: /imu at 100 Hz as XRCE frames over UART at 115200 / 921600 baud, or UDP over Wi-Fi. ---

const LINK: Record<XrceLink, string> = { uart115: 'UART 115200', uart921: 'UART 921600', udp: 'UDP Wi-Fi' }
const STREAM = { best_effort: 'Best effort', reliable: 'Reliable' }
const ST_SLOW = 0.08
const ST_TICKS = 150
const IMU_HZ = 100
const ST_GANTT = { x0: -16, x1: 19, y: -1.2, rowH: 1.1, ticks: ST_TICKS, axis: true }
const EXIT: V3 = [-12.3, 6.5, 0]
const ENTRY: V3 = [11.6, 6.5, 0]

const stRun = memoBy(
  (p: Params) => `${p.link}|${p.stream}|${p.loss}`,
  (p: Params) => {
    const link = pick(LINK, p.link, 'uart115')
    const reliable = pick(STREAM, p.stream, 'best_effort') === 'reliable'
    const loss = n(p, 'loss') / 100
    const msgs = xrceRun(link, reliable, loss, IMU_HZ)
    return { link, reliable, loss, L: xrceLink(link), msgs, s: xrceStats(msgs), demand: xrceDemand(link, IMU_HZ) }
  },
)

export const serialTransport: Lesson = {
  id: 'micro-ros-serial-transport',
  title: 'Serial transport',
  tagline: 'Does /imu at 100 Hz fit down the wire?',
  formula: (p) => {
    const P = stRun(p)
    const { L } = P
    const cdr = imuCdrBytes()
    const wire =
      P.link === 'udp'
        ? `${cdr} B Imu + ${XRCE_HDR} B XRCE + ${UDP_WIFI_HDR} B UDP/IP/802.11 = ${L.bytes} B, at ${L.mbps} Mbit/s with backoff + ACK = ${ms1(L.busyMs)} on air`
        : `${cdr} B Imu + ${XRCE_HDR} B XRCE + ${SERIAL_FRAME} B framing + ${L.stuffed} escaped = ${L.bytes} B × ${frameLength(FORMAT_8N1)} bits / ${LINK_BAUD[P.link as keyof typeof LINK_BAUD]} = ${ms1(L.busyMs)}`
    const fit = P.demand > 1 ? `100 Hz needs ${Math.round(P.demand * 100)} % of the link: it can’t keep up` : `100 Hz uses ${Math.round(P.demand * 100)} % of the link`
    const rel = P.reliable ? `reliable: lost frames re-sent after a NACK (~${XRCE_RETRY_MS} ms), ≤ ${RMW_UXRCE_MAX_HISTORY} unacknowledged` : 'best effort: a lost frame is gone'
    return `${wire} · ${fit} · ${rel} · slowed ${Math.round(ST_SLOW / 0.001)}×`
  },
  legend: [
    { color: RING, label: '/imu frame: header grey, Imu payload', shape: 'arrow-right' },
    { color: HEAT, label: 'Reliable re-send after a NACK', shape: 'dot' },
    { color: HIGH_V, label: 'Lost on the link · or skipped: link still busy', shape: 'dot' },
    { color: POWER, label: 'Agent hands it to DDS', shape: 'dot' },
    RCLC_LEGEND,
  ],
  points: [
    'The client and agent need a transport. The usual first one is the USB cable the ESP32 is already flashed through: UART0 to a USB-serial bridge to /dev/ttyUSB0 on the laptop (Microcontrollers → UART serial for the bits).',
    'A UART only moves bytes, so XRCE-DDS frames each message: a 0x7E flag, addresses, a length, the payload and a CRC-16, with any 0x7E inside escaped. A bad CRC throws the frame away; the agent never sees half a message.',
    'Do the budget before choosing a baud rate. One sensor_msgs/Imu is 324 B of CDR (three 3 × 3 covariances are most of it), about 346 B framed = 3460 bits with start and stop bits. At 115200 baud that is 30 ms per message: 100 Hz would need three times the link. The timer can only fire when the last write has finished, so three in four are skipped.',
    'At 921600 baud the same frame takes 3.8 ms: 38 % of the link, about 5 ms from sample to the ROS graph. Most ESP32 USB bridges (CP2102, CH340) handle it; short wires matter more at that speed.',
    'UDP over Wi-Fi (set_microros_wifi_transports, agent udp4 --port 8888) adds ~64 B of headers but sends at tens of Mbit/s, so airtime is well under a millisecond and the stack and agent dominate. No cable, but Wi-Fi drops packets, and ESP32 power save can add 100 ms stalls: turn it off for control loops.',
    'Best-effort streams just send; a lost frame is gone, which suits /imu at 100 Hz (the next one is 10 ms away). Reliable streams number every message: the agent NACKs a gap, the client re-sends from its history (RMW_UXRCE_MAX_HISTORY slots), and later messages wait so they arrive in order. Nothing lost, but latency jumps, and on a link that is already full the history fills and publishing stalls.',
  ],
  controls: [
    { kind: 'choice', key: 'link', options: opts(LINK), initial: 'uart115' },
    { kind: 'choice', key: 'stream', options: opts(STREAM), initial: 'best_effort' },
    { kind: 'slider', key: 'loss', label: 'Frames lost', min: 0, max: 20, initial: 5, step: 5, format: (v) => `${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    esp32Board(scene, [-16.5, 6.5, 0], 0.32)
    i2cBreakout(scene, [-16.5, 11, 0], { name: 'MPU-6050', k: 0.18 })
    const node = moduleBlock(scene, [-16.5, 2.4, 0], [6.6, 2.2, 1.2], 'imu_cb()')
    const agent = moduleBlock(scene, [15.5, 6.5, 0], [7.4, 3.2, 1.4], 'micro_ros_agent')
    addLabel(scene, 'laptop · DDS →', [15.5, 4.1, 0], GREY, 0.36)
    const uart = add(scene, new THREE.Group())
    const udp = add(scene, new THREE.Group())
    const wire = topicPipe(uart, [EXIT, ENTRY], '', DATA_COLOR, { r: 0.3 })
    const uartTag = liveLabel(uart, [0, 7.7, 0], { size: 0.42 })
    addLabel(uart, 'TX → RX · USB-serial bridge', [0, 5.1, 0], GREY, 0.34)
    routerModel(udp, [0, 4.6, 0], 0.8)
    const air = topicPipe(udp, [EXIT, [0, 7.4, -1.4], ENTRY], '', DATA_COLOR, { r: 0.18 })
    addLabel(udp, `UDP :8888 · Wi-Fi, robot ${UDP_ROBOT_M} m from the router`, [0, 3.2, 0], GREY, 0.34)
    const frameTag = liveLabel(scene, [0, 2, 0.3], { size: 0.38 })
    const chart = gantt(scene, 3, ST_GANTT)
    ;['timer', 'link', 'agent'].forEach((t, i) => chart.name(i, t, LABEL))
    const pool = packetPool(scene, 40, 0.6)
    const status = liveLabel(scene, [-20.5, -14.6, 0.3], { size: 0.44, align: 'left' })
    const code = codeBlock(scene, [-20.5, -9.6, 0], 0.38, 4, rosTint)
    const clock = simClock(ST_SLOW)
    let key = ''
    return {
      scene,
      view: { center: [-1, -0.6, 0], radius: 78, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const P = stRun(p)
        const { L, msgs } = P
        const isUdp = P.link === 'udp'
        const lane = isUdp ? air : wire
        const k = `${P.link}|${P.reliable}|${P.loss}`
        if (k !== key) {
          key = k
          uart.visible = !isUdp
          udp.visible = isUdp
          if (!isUdp) uartTag.set(`${LINK_BAUD[P.link as keyof typeof LINK_BAUD]} baud · 8N1`, DATA_COLOR)
          frameTag.set(`one frame = ${L.bytes} B → ${ms1(L.busyMs)} ${isUdp ? 'on air' : 'on the wire'}`, LABEL)
          chart.rebuild((row, t) => {
            if (row === 0) {
              const m = msgs.find((x) => Math.floor(x.gen) === t)
              return m ? { color: m.fate === 'skipped' ? HIGH_V : RING } : null
            }
            if (row === 1) {
              for (const m of msgs)
                for (let i = 0; i < m.tries.length; i++) {
                  const tr = m.tries[i]
                  if (t >= Math.floor(tr.t0) && t < Math.max(Math.floor(tr.t0) + 1, Math.ceil(tr.t1)))
                    return { color: tr.lost ? HIGH_V : i ? HEAT : RING, text: `#${m.seq}` }
                }
              return null
            }
            const m = msgs.find((x) => x.arrive !== null && Math.floor(x.arrive) === t)
            return m ? { color: POWER } : null
          }, [])
        }
        const now = clock(dt, key, ST_TICKS)
        chart.show(now)
        const W = Math.max(L.busyMs, 2)
        pool.begin()
        let sending: number | null = null
        let arrived = false
        for (const m of msgs) {
          if (m.gen > now) break
          if (m.fate === 'skipped') {
            const since = (now - m.gen) / 5
            if (since < 1) pool.put([EXIT[0] - 1, EXIT[1] + 1 + since * 1.5, 0.4], HIGH_V, { w: 0.5, payload: 0.75, fade: 1 - since, text: since < 0.6 ? 'skip' : '' })
            continue
          }
          m.tries.forEach((tr, i) => {
            const color = i ? HEAT : RING
            const u = (now - tr.t0) / W
            if (now < tr.t0) return
            if (now < tr.t1) sending = m.seq
            if (tr.lost) {
              const lu = 0.55
              if (u < lu) pool.put(lane.at(u), color, { w: 1, payload: 0.95, text: `#${m.seq}` })
              else if (u < lu + 0.5) {
                const at = lane.at(lu)
                const f = (u - lu) * 2
                pool.put([at[0], at[1] - f * 2, at[2]], HIGH_V, { w: 1, payload: 0.95, fade: 1 - f })
              }
              if (P.reliable) {
                const nu = (now - tr.t1) / XRCE_RETRY_MS
                if (nu >= 0 && nu < 1) {
                  const at = lane.at(1 - nu)
                  pool.put([at[0], at[1] - 1, at[2]], LABEL, { w: 0.5, payload: 0, text: 'NACK' })
                }
              }
            } else if (u < 1) pool.put(lane.at(u), color, { w: 1, payload: 0.95, text: `#${m.seq}` })
            else if (m.arrive !== null && now < m.arrive) pool.put([ENTRY[0] + 0.4, ENTRY[1] - 1.2, 0.4], color, { w: 1, payload: 0.95, text: `#${m.seq}` })
          })
          if (m.arrive !== null && now >= m.arrive && now - m.arrive < 2) arrived = true
        }
        pool.end()
        lane.glow(sending !== null ? 0.8 : 0)
        const tick = msgs.some((m) => now >= m.gen && now - m.gen < 1.5)
        node(dt, RING, tick ? 1 : 0.3)
        agent(dt, POWER, arrived ? 1 : 0.35, arrived ? 'publish to DDS' : 'micro_ros_agent')
        const pub = msgs.filter((m) => m.gen <= now)
        const got = msgs.filter((m) => m.arrive !== null && m.arrive <= now).length
        status.set(
          `t = ${now.toFixed(1)} ms · ${pub.length} timer ticks · ${got} delivered · ${pub.filter((m) => m.fate === 'skipped').length} skipped · ${sending !== null ? `sending #${sending}` : 'link idle'}`,
          sending !== null ? LABEL : GREY,
        )
        const baud = isUdp ? 0 : LINK_BAUD[P.link as keyof typeof LINK_BAUD]
        code([
          `rclc_publisher_init_${P.reliable ? 'default' : 'best_effort'}(&imu_pub, &node, ROSIDL_GET_MSG_TYPE_SUPPORT(sensor_msgs, msg, Imu), "imu");   // ${P.reliable ? 'reliable' : 'best-effort'} stream`,
          isUdp
            ? 'set_microros_wifi_transports("robot-net", "secret", "192.168.1.20", 8888);   esp_wifi_set_ps(WIFI_PS_NONE);'
            : `set_microros_serial_transports(Serial);   Serial.begin(${baud});   rclc_timer_init_default(&timer, &support, RCL_MS_TO_NS(10), imu_cb);`,
          `// ${L.bytes} B per message × ${IMU_HZ} Hz = ${bytesText(L.bytes * IMU_HZ)}/s · ${P.demand > 1 ? 'more than the link carries' : `${Math.round(P.demand * 100)} % of the link`}`,
          isUdp ? '$ ros2 run micro_ros_agent micro_ros_agent udp4 --port 8888' : `$ ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ttyUSB0 -b ${baud}`,
        ])
      },
      readouts: (p) => {
        const P = stRun(p)
        const { s } = P
        return [
          { label: 'Link load', value: `${Math.round(P.demand * 100)} %`, tone: P.demand > 1 ? 'bad' : P.demand > 0.6 ? 'warn' : 'ok' },
          { label: 'Delivered / s', value: `${s.ok} / ${s.sent}`, tone: s.ok === s.sent ? 'ok' : s.ok > s.sent * 0.8 ? 'warn' : 'bad' },
          { label: 'Latency avg · max', value: `${Math.round(s.meanMs)} · ${Math.round(s.maxMs)} ms`, tone: s.maxMs < 10 ? 'ok' : s.maxMs < 40 ? 'warn' : 'bad' },
          { label: P.reliable ? 'Re-sent' : 'Lost', value: `${P.reliable ? s.retries : s.lost}`, tone: P.reliable ? (s.retries ? 'warn' : 'ok') : s.lost ? 'bad' : 'ok' },
        ]
      },
    }
  },
}
