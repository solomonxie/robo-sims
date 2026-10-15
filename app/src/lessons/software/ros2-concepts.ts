import * as THREE from 'three/webgpu'
import {
  CRASH_TICK,
  CallMode,
  FEEDBACK_EVERY,
  LAUNCH_NODES,
  LAUNCH_TICKS,
  LAUNCH_TICK_MS,
  LaunchNode,
  NAV_LINK,
  NAV_SPEED,
  NAV_T0,
  NAV_TICKS,
  NAV_TICK_MS,
  NavLane,
  ProcState,
  PUBSUB_MS,
  Qos,
  RESEND_MS,
  RPLIDAR_A1,
  SCAN_SUBS,
  STARTUP_TICKS,
  UI_EVERY,
  launchRun,
  navRun,
  navTicks,
  pointsPerRev,
  publishTimes,
  queuedAt,
  scanBytes,
  subStats,
  subscriberRun,
  uiGapMs,
} from '../../core/physics'
import { bytesText } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  DATA_COLOR,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  ROS_CODE_LEGEND,
  addLabel,
  codeBlock,
  emptyGroup,
  flatBox,
  gantt,
  glowMat,
  liveLabel,
  memoBy,
  moduleBlock,
  packetPool,
  partLetter,
  robotCar,
  rosTint,
  shadowlessRod,
  simClock,
  stretchRod,
  topicPipe,
  trayMat,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'

const NODE: V3 = [7, 2.8, 1.4]
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** Polyline length, so a packet can stop `back` short of the end. */
const polyLen = (pts: V3[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1], p[2] - pts[i][2]), 0)

// --- Publish and subscribe: /scan fans out to three subscribers; QoS and queue depth decide who gets what. ---

const QOS: Record<Qos, string> = { reliable: 'Reliable', best_effort: 'Best effort' }
const SUB_Y = [9.5, 4.5, -0.5]
const SUB_X = 6
const SLOT = 0.8
const FLY = 60
const PS_TICK = 10
const PS_SLOW = 0.04
const LIDAR: V3 = [-17, 4.5, 0]
const TRUNK_X = -8
const SUB_COLOR = [POWER, DATA_COLOR, B_FIELD]

const psRun = memoBy(
  (p: Params) => `${p.qos}|${p.hz}|${p.depth}`,
  (p: Params) => {
    const qos = pick(QOS, p.qos, 'best_effort')
    const hz = n(p, 'hz')
    const depth = n(p, 'depth')
    const subs = SCAN_SUBS.map((s) => subscriberRun(s, hz, qos, depth))
    return { qos, hz, depth, subs, stats: subs.map(subStats), sent: publishTimes(hz, PUBSUB_MS).length }
  },
)

export const publishAndSubscribe: Lesson = {
  id: 'ros-2-concepts-publish-and-subscribe',
  title: 'Publish and subscribe',
  tagline: 'One topic, many readers, each with its own queue',
  formula: (p) => {
    const P = psRun(p)
    const slam = SCAN_SUBS[1]
    return `/scan at ${P.hz} Hz · ${bytesText(scanBytes(pointsPerRev(RPLIDAR_A1.sampleHz, P.hz)))} each · slam needs ${slam.procMs} ms per scan (≤ ${(1000 / slam.procMs).toFixed(1)} Hz) · KEEP_LAST(${P.depth}) drops the oldest · ${P.qos === 'reliable' ? `Reliable: a lost message is re-sent after ${RESEND_MS} ms` : 'Best effort: a lost message is gone'} · slowed ${Math.round(PS_SLOW / (PS_TICK / 1000))}×, pipes drawn ${FLY} ms long`
  },
  legend: [
    { color: RING, label: '/scan message (LaserScan)', shape: 'dot' },
    { color: HIGH_V, label: 'Lost on Wi-Fi or pushed out of a full queue', shape: 'dot' },
    { color: HEAT, label: 'Reliable re-send', shape: 'dot' },
    { color: GREY, label: 'Queue slots (depth) · node lit = callback running', shape: 'dot' },
    ROS_CODE_LEGEND,
  ],
  points: [
    'A ROS 2 system is a graph of nodes: small processes that each do one job. Nodes never call each other for data; they publish messages on named topics, and any node that subscribes to that name gets a copy.',
    'Here the lidar driver publishes /scan (sensor_msgs/LaserScan). Three nodes subscribe: obstacle_stop on the robot, slam on the robot, and rviz2 on a laptop over Wi-Fi. The publisher doesn’t know or care how many there are: that is the fan-out.',
    'Each subscription has its own queue (QoS history KEEP_LAST, depth N). obstacle_stop is fast, so its queue stays empty. slam needs 140 ms per scan, so above ~7 Hz scans pile up: when the queue is full the oldest is pushed out.',
    'A deep queue drops less but hands slam scans that are hundreds of ms old; depth 1 always gives the newest scan and quietly skips the rest. For sensors, fresh beats complete.',
    'Reliability is the other QoS knob. Best effort just sends: one in four Wi-Fi packets to rviz2 is lost for good. Reliable makes the reader ask for the gap and the writer re-send it, and holds later messages until it arrives, so nothing is lost but latency jumps.',
    'Sensor drivers default to best effort (the SensorDataQoS profile); commands and maps want reliable. A best-effort publisher and a reliable subscriber are incompatible and never connect: check with ros2 topic info -v.',
    'The other pipes are the same idea: teleop publishes /cmd_vel (geometry_msgs/Twist) to the motor driver, which publishes /odom back for slam.',
  ],
  controls: [
    { kind: 'choice', key: 'qos', options: (Object.keys(QOS) as Qos[]).map((k) => ({ value: k, label: QOS[k] })), initial: 'best_effort' },
    { kind: 'slider', key: 'hz', label: 'Publish rate', min: 5, max: 20, initial: 10, step: 5, format: (v) => `${v} Hz` },
    { kind: 'slider', key: 'depth', label: 'Queue depth', min: 1, max: 8, initial: 3, step: 1, format: (v) => `${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const lidar = moduleBlock(scene, LIDAR, NODE, 'lidar_driver')
    const head = add(scene, new THREE.Group(), [LIDAR[0], LIDAR[1] + 2.1, 0])
    cylinder(head, 0.9, 0.7, mat('#9aa0ab', { rough: 0.35 }), [0, 0, 0], 'y', 32)
    box(head, [0.3, 0.3, 0.3], glowMat(HIGH_V, 1), [0.85, 0.1, 0])
    const subs = SCAN_SUBS.map((s, i) => moduleBlock(scene, [SUB_X, SUB_Y[i], 0], NODE, s.name))
    const nodeLeft = SUB_X - NODE[0] / 2 - 0.3
    const routes: V3[][] = SUB_Y.map((y) => [
      [LIDAR[0] + NODE[0] / 2, LIDAR[1], 0],
      [TRUNK_X, LIDAR[1], 0],
      [TRUNK_X, y, 0],
      [nodeLeft, y, 0],
    ])
    const pipes = routes.map((r) => topicPipe(scene, r, '', RING))
    addLabel(scene, '/scan', [(LIDAR[0] + NODE[0] / 2 + TRUNK_X) / 2, LIDAR[1] + 0.9, 0], RING, 0.55)
    addLabel(scene, 'LaserScan', [(LIDAR[0] + NODE[0] / 2 + TRUNK_X) / 2, LIDAR[1] - 0.9, 0], GREY, 0.34)
    addLabel(scene, 'laptop · Wi-Fi', [SUB_X, SUB_Y[2] - 2.1, 0], GREY, 0.36)
    const slotGroup = add(scene, new THREE.Group())
    const teleop = moduleBlock(scene, [-17, -5, 0], NODE, 'teleop')
    const motor = moduleBlock(scene, [SUB_X, -5, 0], NODE, 'motor_driver')
    const cmdVel = topicPipe(scene, [[-13.5, -5, 0], [nodeLeft, -5, 0]], '/cmd_vel', FORCE)
    const odomPts: V3[] = [[SUB_X + NODE[0] / 2, -5, 0], [13.5, -5, 0], [13.5, SUB_Y[1], 0], [SUB_X + NODE[0] / 2 + 0.3, SUB_Y[1], 0]]
    const odom = topicPipe(scene, odomPts, '/odom', HEAT)
    const pool = packetPool(scene, 70, 0.6)
    const status = liveLabel(scene, [-20.5, -12.6, 0.3], { size: 0.46, align: 'left' })
    const code = codeBlock(scene, [-20.5, -8, 0], 0.42, 4, rosTint)
    const clock = simClock(PS_SLOW)
    const ticks = (PUBSUB_MS + FLY) / PS_TICK
    let key = ''
    let spin = 0
    return {
      scene,
      view: { center: [-2.5, 2.2, 0], radius: 70, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const P = psRun(p)
        const k = `${P.qos}|${P.hz}|${P.depth}`
        if (k !== key) {
          key = k
          emptyGroup(slotGroup)
          SUB_Y.forEach((y) => {
            for (let s = 0; s < P.depth; s++) flatBox(slotGroup, [SLOT - 0.12, 1.3, 0.2], glowMat(GREY, 0.12), [nodeLeft - 0.5 - s * SLOT, y, -0.5])
          })
        }
        const now = clock(dt, key, ticks) * PS_TICK
        const ts = now - FLY
        spin += dt * P.hz * 0.6
        head.rotation.y = spin
        const pubAt = publishTimes(P.hz, PUBSUB_MS)
        const justSent = pubAt.some((t) => now >= t && now - t < 40)
        lidar(dt, RING, justSent ? 1 : 0.35)
        pool.begin()
        const fly = (i: number, tSend: number, tLand: number, uEnd: number, color: string) => {
          const u = ((now - tSend) / (tLand - tSend)) * uEnd
          if (u >= 0 && u < uEnd) pool.put(pipes[i].at(u), color, { w: 0.6, payload: 0.75 })
        }
        let busyTitle = ''
        P.subs.forEach((ds, i) => {
          const len = polyLen(routes[i])
          const uTail = (len - 0.5 - P.depth * SLOT) / len
          for (const d of ds) {
            if (d.arrive === null) {
              const uLost = 0.62
              fly(i, d.sent, d.sent + FLY / uLost, uLost, RING)
              const since = now - (d.sent + FLY)
              if (since >= 0 && since < 200) {
                const at = pipes[i].at(uLost)
                pool.put([at[0], at[1] - since * 0.012, at[2]], HIGH_V, { w: 0.6, payload: 0.75, fade: 1 - since / 200 })
              }
              continue
            }
            if (d.resent !== undefined) {
              fly(i, d.sent, d.sent + FLY / 0.62, 0.62, RING)
              const since = now - (d.sent + FLY)
              const at = pipes[i].at(0.62)
              if (since >= 0 && since < 150) pool.put([at[0], at[1] - since * 0.012, at[2]], HIGH_V, { w: 0.6, payload: 0.75, fade: 1 - since / 150 })
              fly(i, d.resent, d.arrive + FLY, uTail, HEAT)
            } else fly(i, d.sent, d.arrive + FLY, uTail, RING)
            if (d.dropped !== undefined && ts >= d.dropped && ts - d.dropped < 200) {
              const x = nodeLeft - 0.5
              pool.put([x, SUB_Y[i] - (ts - d.dropped) * 0.012, 0.3], HIGH_V, { w: 0.6, payload: 0.75, fade: 1 - (ts - d.dropped) / 200 })
            }
          }
          const q = queuedAt(ds, ts)
          q.forEach((d, s) => pool.put([nodeLeft - 0.5 - s * SLOT, SUB_Y[i], 0.3], d.resent !== undefined ? HEAT : RING, { w: 0.6, payload: 0.75 }))
          const run = ds.find((d) => d.start !== undefined && d.start <= ts && ts < d.end!)
          subs[i](dt, SUB_COLOR[i], run ? 1 : 0, run ? `${SCAN_SUBS[i].name} #${run.seq}` : SCAN_SUBS[i].name)
          if (i === 1 && run) busyTitle = `slam is on scan #${run.seq}, ${Math.round(run.start! - run.sent)} ms old · ${q.length} waiting`
        })
        for (const t of publishTimes(10, PUBSUB_MS)) {
          const u = (now - t) / FLY
          if (u >= 0 && u < 1) pool.put(cmdVel.at(u), FORCE, { w: 0.6, payload: 0.75 })
        }
        for (const t of publishTimes(20, PUBSUB_MS)) {
          const u = (now - t) / FLY
          if (u >= 0 && u < 1) pool.put(odom.at(u), HEAT, { w: 0.6, payload: 0.75 })
        }
        pool.end()
        const cmdOn = publishTimes(10, PUBSUB_MS).some((t) => now >= t && now - t < 30)
        teleop(dt, FORCE, cmdOn ? 1 : 0.3)
        motor(dt, HEAT, ts >= 0 && publishTimes(10, PUBSUB_MS).some((t) => ts >= t && ts - t < 30) ? 1 : 0.3)
        pipes.forEach((pp) => pp.glow(justSent ? 1 : 0))
        cmdVel.glow(cmdOn ? 1 : 0)
        odom.glow(0.3)
        const sent = pubAt.filter((t) => t <= now).length
        status.set(`t = ${Math.min(PUBSUB_MS, Math.round(now))} ms · /scan #${Math.max(0, sent - 1)} published${busyTitle ? ' · ' + busyTitle : ''}`, LABEL)
        const be = P.qos === 'best_effort'
        const rviz = P.stats[2]
        code([
          `qos = QoSProfile(depth=${P.depth}, reliability=ReliabilityPolicy.${be ? 'BEST_EFFORT' : 'RELIABLE'})`,
          `pub = node.create_publisher(LaserScan, '/scan', qos)   # timer every ${1000 / P.hz} ms calls pub.publish(scan)`,
          `auto sub = create_subscription<sensor_msgs::msg::LaserScan>("/scan", rclcpp::QoS(${P.depth})${be ? '.best_effort()' : '.reliable()'}, on_scan);`,
          `$ ros2 topic hz /scan   # on the laptop: average rate ${((rviz.done * 1000) / PUBSUB_MS).toFixed(1)}`,
        ])
      },
      readouts: (p) => {
        const P = psRun(p)
        const [, slam, rviz] = P.stats
        return [
          { label: 'slam got', value: `${slam.done} / ${P.sent}`, tone: slam.done === P.sent ? 'ok' : slam.done > P.sent / 2 ? 'warn' : 'bad' },
          { label: 'slam data age', value: `≤ ${slam.maxAge} ms`, tone: slam.maxAge < 100 ? 'ok' : slam.maxAge < 300 ? 'warn' : 'bad' },
          { label: 'Queue drops', value: `${slam.overflow}`, tone: slam.overflow ? 'warn' : 'ok' },
          { label: 'rviz2 Wi-Fi', value: P.qos === 'reliable' ? `${rviz.resent} re-sent` : `${rviz.lost} lost`, tone: rviz.lost ? 'bad' : rviz.resent ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Services and actions: navigate to a pose as one blocking call, or as an action with feedback and cancel. ---

const MODE: Record<CallMode, string> = { service: 'Service', action: 'Action', cancel: 'Action + cancel' }
const SA_SLOW = 0.05
const CLIENT: V3 = [-17, 6.3, 0]
const SERVER: V3 = [13.5, 6.3, 0]
const LANE_Y: Record<NavLane, number> = { call: 6.3, send_goal: 9, feedback: 7.2, cancel_goal: 5.4, get_result: 3.6 }
const LANE_COLOR: Record<NavLane, string> = { call: RING, send_goal: RING, feedback: B_FIELD, cancel_goal: HIGH_V, get_result: POWER }
const LANE_NAME: Record<NavLane, string> = {
  call: '/drive_to · service',
  send_goal: '_action/send_goal · service',
  feedback: '_action/feedback · topic',
  cancel_goal: '_action/cancel_goal · service',
  get_result: '_action/get_result · service',
}
const TRACK = { x0: -12, perM: 7, y: 0 }
const SA_GANTT = { x0: -12, x1: 17, y: -4.4, rowH: 1.4, ticks: NAV_TICKS }

const saRun = memoBy(
  (p: Params) => `${p.mode}|${p.dist}`,
  (p: Params) => {
    const mode = pick(MODE, p.mode, 'service')
    const dist = n(p, 'dist')
    return { mode, dist, r: navRun(mode, dist) }
  },
)

export const servicesAndActions: Lesson = {
  id: 'ros-2-concepts-services-and-actions',
  title: 'Services and actions',
  tagline: 'Ask and wait, or ask and keep watching',
  formula: (p) => {
    const P = saRun(p)
    const drive = navTicks(P.dist) * NAV_TICK_MS
    const head = `drive ${P.dist} m at ${NAV_SPEED} m/s = ${sec(drive)}`
    const tail =
      P.mode === 'service'
        ? `a service answers once at the end: the caller waits ${sec(uiGapMs(P.r.ui))}, no progress, no way to stop`
        : P.mode === 'action'
          ? `an action = 3 services + feedback topic: goal accepted at once, feedback every ${FEEDBACK_EVERY * NAV_TICK_MS} ms, result at the end`
          : `cancel_goal half-way: the server stops and the result comes back ${P.r.status}`
    return `${head} · ${tail} · links drawn ${NAV_LINK * NAV_TICK_MS} ms slow`
  },
  legend: [
    { color: RING, label: 'Request / goal → server', shape: 'arrow-right' },
    { color: B_FIELD, label: 'Feedback (remaining distance) ← server', shape: 'arrow-left' },
    { color: POWER, label: 'Response / result · red = cancel', shape: 'arrow-left' },
    { color: HIGH_V, label: 'Client callback blocked', shape: 'dot' },
    ROS_CODE_LEGEND,
  ],
  points: [
    'Topics are one-way streams. When a node needs an answer it uses a service: a request message goes to one server, a response comes back. Good for quick questions: “clear the costmap”, “what is parameter x”, “save the map”.',
    'A service is a bad fit for long jobs. Here a made-up /drive_to service drives the robot 2 m: the client gets nothing until the robot arrives, can’t see progress and can’t say stop. If it calls synchronously from a callback, that callback (and everything sharing its executor) is stuck the whole time; in rclpy with the default single-threaded executor it never returns at all.',
    'An action is built for this. navigate_to_pose (nav2_msgs/action/NavigateToPose) is three services and a topic underneath: send_goal (accepted/rejected at once), feedback (a stream, here the distance left at 5 Hz), cancel_goal, and get_result (answered when the goal ends).',
    'The client sends the goal asynchronously and keeps running its own timers, its UI keeps refreshing at 10 Hz, and it can cancel any time. The server stops the robot and the result comes back CANCELED instead of SUCCEEDED.',
    'Rule of thumb: topic for continuous data, service for a fast request/response (well under a second), action for anything that takes time, reports progress or might be pre-empted.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: (Object.keys(MODE) as CallMode[]).map((k) => ({ value: k, label: MODE[k] })), initial: 'service' },
    { kind: 'slider', key: 'dist', label: 'Goal distance', min: 1, max: 3, initial: 2, step: 0.5, format: (v) => `${v} m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const client = moduleBlock(scene, CLIENT, [7, 6.6, 1.4], 'mission')
    const server = moduleBlock(scene, SERVER, [7, 6.6, 1.4], 'bt_navigator')
    addLabel(scene, 'client', [CLIENT[0], CLIENT[1] + 3.9, 0], GREY, 0.38)
    addLabel(scene, 'server', [SERVER[0], SERVER[1] + 3.9, 0], GREY, 0.38)
    const ends = (y: number): V3[] => [
      [CLIENT[0] + 3.7, y, 0],
      [SERVER[0] - 3.7, y, 0],
    ]
    const groups = { service: add(scene, new THREE.Group()), action: add(scene, new THREE.Group()) }
    const lanes = Object.fromEntries(
      (Object.keys(LANE_Y) as NavLane[]).map((l) => [l, topicPipe(l === 'call' ? groups.service : groups.action, ends(LANE_Y[l]), LANE_NAME[l], LANE_COLOR[l], { r: 0.26, text: 0.36 })]),
    ) as Record<NavLane, ReturnType<typeof topicPipe>>
    box(scene, [3 * TRACK.perM + 4, 0.3, 3], trayMat(), [TRACK.x0 + 1.5 * TRACK.perM, TRACK.y - 1.2, -0.6])
    for (let m = 0; m <= 3; m++) partLetter(scene, `${m} m`, [TRACK.x0 + m * TRACK.perM, TRACK.y - 2, 1], 0.36, GREY)
    const car = add(scene, new THREE.Group(), [TRACK.x0, TRACK.y, 0])
    robotCar(car, [0, 0, 0], 0.5)
    const flag = add(scene, new THREE.Group())
    stretchRod(add(flag, shadowlessRod(glowMat(LABEL, 0.4))), [0, -1, 0], [0, 2, 0], 0.07)
    box(flag, [1.1, 0.7, 0.08], glowMat(POWER, 0.9), [0.6, 1.6, 0])
    const flagText = liveLabel(flag, [0, 2.6, 0], { size: 0.38 })
    const chart = gantt(scene, 2, SA_GANTT)
    chart.name(0, 'mission', LABEL)
    chart.name(1, 'bt_navigator', LABEL)
    for (let s = 0; s * 1000 <= NAV_TICKS * NAV_TICK_MS; s += 2) partLetter(scene, `${s} s`, [SA_GANTT.x0 + ((s * 1000) / NAV_TICK_MS / NAV_TICKS) * (SA_GANTT.x1 - SA_GANTT.x0), chart.rowY(1) - 1.4, 0], 0.32, GREY)
    const pool = packetPool(scene, 12, 0.6)
    const status = liveLabel(scene, [-20.5, -13.4, 0.3], { size: 0.46, align: 'left' })
    const code = codeBlock(scene, [-20.5, -9.2, 0], 0.42, 4, rosTint)
    const clock = simClock(SA_SLOW)
    let key = ''
    return {
      scene,
      view: { center: [-2.5, 1.8, 0], radius: 73, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const P = saRun(p)
        const { r } = P
        const svc = P.mode === 'service'
        const k = `${P.mode}|${P.dist}`
        if (k !== key) {
          key = k
          groups.service.visible = svc
          groups.action.visible = !svc
          flag.position.set(TRACK.x0 + P.dist * TRACK.perM, TRACK.y, 0.5)
          flagText.set(`goal ${P.dist} m`, POWER)
          chart.rebuild(
            (row, t) =>
              row === 0
                ? r.blocked[t]
                  ? { color: HIGH_V, text: 'blocked in call()' }
                  : r.ui.includes(t)
                    ? { color: POWER }
                    : null
                : r.busy[t]
                  ? { color: FORCE, text: 'driving' }
                  : null,
            [{ t: r.done, row: 0, text: svc ? 'response' : r.status, color: r.status === 'CANCELED' ? HIGH_V : POWER }],
          )
        }
        const now = clock(dt, key, NAV_TICKS)
        const t = Math.min(NAV_TICKS, Math.floor(now))
        chart.show(now)
        const xi = Math.min(NAV_TICKS - 1, Math.floor(now))
        const x = r.x[xi] + (r.x[xi + 1] - r.x[xi]) * (now - xi)
        car.position.x = TRACK.x0 + x * TRACK.perM
        pool.begin()
        let feedback = ''
        for (const m of r.msgs) {
          const u = (now - m.t0) / (m.t1 - m.t0)
          if (u < 0 || u >= 1) continue
          const color = m.lane === 'cancel_goal' ? HIGH_V : m.out ? RING : m.lane === 'feedback' ? B_FIELD : POWER
          pool.put(lanes[m.lane].at(m.out ? u : 1 - u), color, { w: 1, payload: 0.7, text: m.lane === 'feedback' ? m.text : '' })
          if (m.lane === 'feedback') feedback = m.text
        }
        pool.end()
        for (const l of Object.keys(lanes) as NavLane[]) lanes[l].glow(r.msgs.some((m) => m.lane === l && now >= m.t0 && now < m.t1) ? 1 : 0)
        const blocked = r.blocked[t]
        const tick = r.ui.some((u) => now >= u && now - u < 0.8)
        client(dt, blocked ? HIGH_V : POWER, blocked ? 1 : tick ? 0.8 : 0.2, blocked ? 'blocked' : 'mission')
        server(dt, FORCE, r.busy[t] ? 1 : 0.15, 'bt_navigator')
        const ms = Math.round(now * NAV_TICK_MS)
        status.set(
          now >= r.done
            ? `t = ${sec(ms)} · ${svc ? 'response arrived' : `result: ${r.status}`} after ${sec((r.done - NAV_T0) * NAV_TICK_MS)} · robot at ${x.toFixed(2)} m`
            : blocked
              ? `t = ${sec(ms)} · mission is stuck in call(): no UI refresh, no progress, can’t cancel`
              : `t = ${sec(ms)} · robot at ${x.toFixed(2)} m${feedback ? ` · feedback: ${feedback} to go` : ''} · mission UI still ticks at ${1000 / (UI_EVERY * NAV_TICK_MS)} Hz`,
          blocked ? HIGH_V : LABEL,
        )
        code(
          svc
            ? [
                `resp = self.cli.call(DriveTo.Request(x=${P.dist}))   # blocks this callback ${sec(uiGapMs(r.ui))}`,
                'auto fut = cli->async_send_request(req);   // rclcpp: the future only resolves while spinning',
                `$ ros2 service call /drive_to robot_msgs/srv/DriveTo "{x: ${P.dist}}"`,
                '$ ros2 service list   # quick request/response: clear costmap, set parameters, save map',
              ]
            : [
                `fut = self.nav.send_goal_async(NavigateToPose.Goal(pose=goal), feedback_callback=self.on_feedback)`,
                P.mode === 'cancel' ? 'self.goal_handle.cancel_goal_async()   # half-way: result comes back CANCELED' : 'self.goal_handle.get_result_async().add_done_callback(self.on_result)',
                'auto gh = nav->async_send_goal(goal, opts);   // opts.feedback_callback = on_feedback',
                `$ ros2 action send_goal /navigate_to_pose nav2_msgs/action/NavigateToPose "{pose: ...}" --feedback`,
              ],
        )
      },
      readouts: (p) => {
        const P = saRun(p)
        const gap = uiGapMs(P.r.ui)
        return [
          { label: 'Drive', value: sec(navTicks(P.dist) * NAV_TICK_MS) },
          { label: 'Feedback', value: `${P.r.msgs.filter((m) => m.lane === 'feedback').length}`, tone: P.mode === 'service' ? 'bad' : 'ok' },
          { label: 'Stalled', value: sec(gap), tone: gap <= 100 ? 'ok' : 'bad' },
          { label: 'Result', value: P.mode === 'service' ? 'reply' : P.r.status === 'CANCELED' ? 'canceled' : 'done', tone: P.r.status === 'CANCELED' ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Launch files: one launch file starts four nodes with parameters and a remap; the motor driver crashes. ---

const RESPAWN = { on: 'respawn=True', off: 'respawn=False' }
const LA_SLOW = 0.1
const LAUNCH_AT: V3 = [-18.5, 3.5, 0]
const NODE_AT: Record<LaunchNode, V3> = { lidar_driver: [-3.5, 8, 0], teleop: [-3.5, 2.8, 0], safety_stop: [9, 5.4, 0], motor_driver: [9, -0.6, 0] }
const PARAMS: Record<LaunchNode, string> = {
  lidar_driver: 'serial_port: /dev/ttyUSB0',
  teleop: 'cmd_vel → /cmd_vel_raw',
  safety_stop: 'stop_dist: 0.3',
  motor_driver: 'wheel_radius: 0.033',
}
const STATE_COLOR: Record<Exclude<ProcState, null>, string> = { starting: HEAT, up: POWER, dead: HIGH_V }
const LA_GANTT = { x0: -12, x1: 18, y: -4.4, rowH: 1.2, ticks: LAUNCH_TICKS }
/** Pipes: publisher, subscriber, every n ticks. */
const LA_PIPES: { pub: LaunchNode; sub: LaunchNode | null; every: number; name: string; color: string; pts: V3[]; tag: V3 }[] = [
  { pub: 'lidar_driver', sub: 'safety_stop', every: 1, name: '/scan', color: RING, tag: [1.5, 8.7, 0], pts: [[0, 8, 0], [3, 8, 0], [3, 6, 0], [5.5, 6, 0]] },
  { pub: 'teleop', sub: 'safety_stop', every: 2, name: '/cmd_vel_raw', color: FORCE, tag: [3.6, 2.2, 0], pts: [[0, 2.8, 0], [3, 2.8, 0], [3, 4.8, 0], [5.5, 4.8, 0]] },
  { pub: 'safety_stop', sub: 'motor_driver', every: 2, name: '/cmd_vel', color: FORCE, tag: [13.4, 2.4, 0], pts: [[11.3, 4, 0], [11.3, 0.8, 0]] },
  { pub: 'motor_driver', sub: null, every: 1, name: '/odom', color: HEAT, tag: [15.8, 0.1, 0], pts: [[12.5, -0.6, 0], [19, -0.6, 0]] },
]
const LA_FLY = 4

const laRun = memoBy(
  (p: Params) => `${p.respawn}|${p.delay}`,
  (p: Params) => {
    const respawn = pick(RESPAWN, p.respawn, 'on')
    const delay = n(p, 'delay')
    return { respawn, delay, r: launchRun(respawn === 'on', delay) }
  },
)

export const launchFiles: Lesson = {
  id: 'ros-2-concepts-launch-files',
  title: 'Launch files',
  tagline: 'One command starts the whole robot',
  formula: (p) => {
    const P = laRun(p)
    const t = (k: number) => sec(k * LAUNCH_TICK_MS)
    return `ros2 launch starts ${LAUNCH_NODES.length} processes · motor_driver segfaults at ${t(CRASH_TICK)} (exit −11) · ${
      P.r.respawnAt === null ? 'respawn off: it stays dead, /odom and the wheels stop' : `respawn after ${P.delay} s + ${t(STARTUP_TICKS)} start-up → /odom silent ${sec(P.r.odomGapMs)}`
    } · real time`
  },
  legend: [
    { color: GREY, label: 'Process tree: ros2 launch → child processes', shape: 'dot' },
    { color: HEAT, label: 'Starting · green = running', shape: 'dot' },
    { color: HIGH_V, label: 'Crashed (exit code −11 = SIGSEGV)', shape: 'dot' },
    { color: FORCE, label: 'Topics: /scan, /cmd_vel_raw → /cmd_vel, /odom', shape: 'dot' },
    ROS_CODE_LEGEND,
  ],
  points: [
    'A real robot is a dozen nodes: drivers, filters, planners. Starting each with ros2 run in its own terminal does not scale, so a launch file (Python, XML or YAML) describes them all and ros2 launch starts them in one go.',
    'Each Node() entry names the package and executable and can set parameters (serial port, wheel radius) and remappings. Here teleop publishes cmd_vel, but the launch file remaps it to /cmd_vel_raw so safety_stop can sit in between and publish the real /cmd_vel. Same binary, rewired from outside.',
    'ros2 launch is the parent process; every node is a child, so Ctrl-C stops them all, and their output is collected in one place (prefixed with the node name).',
    'Nodes crash: a null pointer, a USB adapter unplugged. With respawn=True the launch system starts the process again after respawn_delay; the node re-reads its parameters, re-creates its publishers and the graph heals itself. Subscribers never notice beyond a gap in messages.',
    'Without respawn the node stays dead and everything downstream starves: no /odom, and the wheels keep the last command unless the driver has a timeout (Safety & failsafes → Watchdog). For a node the robot can’t live without, on_exit=Shutdown() takes the whole launch down instead.',
  ],
  controls: [
    { kind: 'choice', key: 'respawn', options: (Object.keys(RESPAWN) as (keyof typeof RESPAWN)[]).map((k) => ({ value: k, label: RESPAWN[k] })), initial: 'on' },
    { kind: 'slider', key: 'delay', label: 'respawn_delay', min: 0.5, max: 4, initial: 2, step: 0.5, format: (v) => `${v} s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const launcher = moduleBlock(scene, LAUNCH_AT, [6.4, 3, 1.4], 'ros2 launch')
    addLabel(scene, 'bringup.launch.py', [LAUNCH_AT[0], LAUNCH_AT[1] - 2.1, 0], GREY, 0.34)
    const nodes = Object.fromEntries(LAUNCH_NODES.map((k) => [k, moduleBlock(scene, NODE_AT[k], NODE, k)])) as Record<LaunchNode, ReturnType<typeof moduleBlock>>
    for (const k of LAUNCH_NODES) addLabel(scene, PARAMS[k], [NODE_AT[k][0], NODE_AT[k][1] - 1.9, 0], k === 'teleop' ? FORCE : GREY, 0.32)
    const treeM = Object.fromEntries(LAUNCH_NODES.map((k) => [k, glowMat(GREY, 0.3)])) as Record<LaunchNode, THREE.MeshStandardMaterial>
    const busX = -12.5
    stretchRod(add(scene, shadowlessRod(glowMat(GREY, 0.3))), [LAUNCH_AT[0] + 3.2, LAUNCH_AT[1], 0], [busX, LAUNCH_AT[1], 0], 0.08)
    stretchRod(add(scene, shadowlessRod(glowMat(GREY, 0.3))), [busX, 8, 0], [busX, -0.6, 0], 0.08)
    for (const k of LAUNCH_NODES) {
      const [x, y] = NODE_AT[k]
      stretchRod(add(scene, shadowlessRod(treeM[k])), [busX, y, -0.6], [x - NODE[0] / 2, y, -0.6], 0.08)
    }
    const pipes = LA_PIPES.map((pp) => topicPipe(scene, pp.pts, '', pp.color, { r: 0.26 }))
    for (const pp of LA_PIPES) addLabel(scene, pp.name, pp.tag, pp.color, 0.4)
    const chart = gantt(scene, LAUNCH_NODES.length, LA_GANTT)
    LAUNCH_NODES.forEach((k, i) => chart.name(i, k, LABEL))
    for (let s = 0; s * 1000 <= LAUNCH_TICKS * LAUNCH_TICK_MS; s += 2)
      partLetter(scene, `${s} s`, [LA_GANTT.x0 + ((s * 1000) / LAUNCH_TICK_MS / LAUNCH_TICKS) * (LA_GANTT.x1 - LA_GANTT.x0), chart.rowY(3) - 1.3, 0], 0.32, GREY)
    const pool = packetPool(scene, 30, 0.55)
    const status = liveLabel(scene, [-20.5, -17, 0.3], { size: 0.46, align: 'left' })
    const code = codeBlock(scene, [-20.5, -12.4, 0], 0.38, 5, rosTint)
    const clock = simClock(LA_SLOW)
    let key = ''
    return {
      scene,
      view: { center: [-2.5, 0.6, 0], radius: 80, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const P = laRun(p)
        const { r } = P
        const k = `${P.respawn}|${P.delay}`
        if (k !== key) {
          key = k
          chart.rebuild(
            (row, t) => {
              const s = r.lanes[LAUNCH_NODES[row]][t]
              return s ? { color: STATE_COLOR[s], dim: s === 'starting', text: s === 'dead' ? 'dead' : '' } : null
            },
            [
              { t: CRASH_TICK, row: 3, text: '−11', color: HIGH_V },
              ...(r.respawnAt === null ? [] : [{ t: r.respawnAt, row: 3, text: 'respawn', color: HEAT }]),
            ],
          )
        }
        const now = clock(dt, key, LAUNCH_TICKS)
        const t = Math.min(LAUNCH_TICKS - 1, Math.floor(now))
        chart.show(now)
        const state = (nd: LaunchNode, at: number) => (at < 0 ? null : r.lanes[nd][Math.min(LAUNCH_TICKS - 1, at)])
        for (const nd of LAUNCH_NODES) {
          const s = state(nd, t)
          const respawned = nd === 'motor_driver' && r.respawnAt !== null && t >= r.respawnAt
          const title = s === 'dead' ? 'exit −11' : s === 'starting' ? (respawned ? 'respawn…' : 'starting…') : nd
          nodes[nd](dt, s ? STATE_COLOR[s] : GREY, s === 'up' ? 1 : s === 'starting' ? 0.6 : s === 'dead' ? 0.9 : 0, title)
          treeM[nd].emissiveIntensity = s === 'starting' ? 1.4 : s ? 0.5 : 0.1
        }
        const spawning = LAUNCH_NODES.some((nd) => state(nd, t) === 'starting')
        launcher(dt, spawning ? HEAT : LABEL, spawning ? 1 : 0.4)
        pool.begin()
        LA_PIPES.forEach((pp, i) => {
          let live = false
          for (let k0 = Math.floor(now) - LA_FLY; k0 <= now; k0++) {
            if (k0 < 0 || k0 % pp.every || state(pp.pub, k0) !== 'up') continue
            const u = (now - k0) / LA_FLY
            if (u < 0 || u >= 1) continue
            const deaf = pp.sub !== null && state(pp.sub, t) !== 'up'
            live = true
            pool.put(pipes[i].at(u), deaf ? GREY : pp.color, { w: 0.6, payload: 0.75, fade: deaf ? 1 - u : 1 })
          }
          pipes[i].glow(live ? 0.6 : 0)
        })
        pool.end()
        const md = state('motor_driver', t)
        const sec1 = sec(now * LAUNCH_TICK_MS)
        status.set(
          md === 'dead'
            ? `t = ${sec1} · motor_driver crashed: /odom silent, /cmd_vel goes nowhere${r.respawnAt === null ? ' · no respawn' : ` · respawn in ${sec((r.respawnAt - now) * LAUNCH_TICK_MS)}`}`
            : spawning
              ? `t = ${sec1} · launch is spawning processes`
              : `t = ${sec1} · ${LAUNCH_NODES.filter((nd) => state(nd, t) === 'up').length} / ${LAUNCH_NODES.length} nodes running`,
          md === 'dead' ? HIGH_V : LABEL,
        )
        const on = P.respawn === 'on'
        code([
          "Node(package='rplidar_ros', executable='rplidar_node', name='lidar_driver', parameters=[{'serial_port': '/dev/ttyUSB0'}]),",
          "Node(package='teleop_twist_keyboard', executable='teleop_twist_keyboard', remappings=[('cmd_vel', 'cmd_vel_raw')]),",
          "Node(package='robot_safety', executable='safety_stop', parameters=['config/safety.yaml']),",
          `Node(package='robot_base', executable='motor_driver', parameters=[{'wheel_radius': 0.033}], respawn=${on ? 'True' : 'False'}${on ? `, respawn_delay=${P.delay}` : ''}),`,
          '$ ros2 launch robot_bringup bringup.launch.py',
        ])
      },
      readouts: (p) => {
        const P = laRun(p)
        return [
          { label: 'Processes', value: `${LAUNCH_NODES.length} · 1 crash` },
          { label: '/odom silent', value: sec(P.r.odomGapMs), tone: P.r.respawnAt === null ? 'bad' : P.r.odomGapMs <= 2000 ? 'ok' : 'warn' },
          { label: 'Respawned at', value: P.r.respawnAt === null ? 'never' : sec(P.r.respawnAt * LAUNCH_TICK_MS), tone: P.r.respawnAt === null ? 'bad' : 'ok' },
        ]
      },
    }
  },
}
