import * as THREE from 'three/webgpu'
import {
  DRIVE_PDU_BYTES,
  JOY,
  LAG,
  WS,
  WS_MASK_BYTES,
  WsSend,
  cmdJson,
  creepM,
  joyRun,
  lagRun,
  peakJerk,
  safeSpeed,
  stopDistance,
  wsBytes,
  wsRun,
} from '../../core/physics'
import { hertz, hexByte, msText } from '../../core/units'
import { V3, add, box, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  arcAt,
  codeBlock,
  cursorBar,
  flatBox,
  floorMat,
  floorView,
  glowBox,
  glowMat,
  lidarRobot,
  liveLabel,
  memoBy,
  meterBar,
  packetPool,
  phoneModel,
  pointCloud,
  ripples,
  routerModel,
  scope,
  setGlow,
  simClock,
} from '../fx'
import { Lesson, Params, Stage, pick } from '../types'

const opts = <R extends Record<string, string>>(rec: R) => (Object.keys(rec) as (keyof R & string)[]).map((k) => ({ value: k, label: rec[k] }))
const pctText = (v: number) => `${v < 0 ? '−' : '+'}${Math.round(Math.abs(v) * 100)} %`
const hexRow = (b: number[]) => b.map((x) => hexByte(x).slice(2)).join(' ')

/** Phone with an on-screen thumbstick under two text rows; `stick(x, y)` moves the knob (x right, y up). */
function stickPhone(parent: THREE.Object3D, at: V3, k: number) {
  const phone = phoneModel(parent, at, k, 2)
  phone.screen('#10161c', 0.4)
  const c: V3 = [0, -0.6, 0.08]
  const ring = add(phone.group, mesh(new THREE.TorusGeometry(0.55, 0.035, 8, 40), glowMat(GREY, 0.6)), c)
  ring.castShadow = false
  const knob = add(phone.group, mesh(new THREE.SphereGeometry(0.2, 16, 12), glowMat(RING, 1)), c)
  knob.castShadow = false
  return {
    ...phone,
    top: [at[0], at[1] + 1.6 * k, at[2] + 0.2] as V3,
    stick(x: number, y: number) {
      knob.position.set(c[0] + x * 0.45, c[1] + y * 0.45, c[2] + 0.1)
    },
  }
}

const worldOf = (o: THREE.Object3D, v = new THREE.Vector3()): V3 => {
  o.getWorldPosition(v)
  return [v.x, v.y, v.z + 0.6]
}

// --- Joystick over BLE: thumb → deadzone → expo → arcade mix → 3 B notify → slew-limited wheels. ---

const SHAPE = { raw: 'Raw stick', dz: 'Deadzone 10 %', expo: 'Deadzone + expo' }
const SHAPES = { raw: { dz: 0, expo: 0 }, dz: { dz: 0.1, expo: 0 }, expo: { dz: 0.1, expo: 0.6 } }
const SLEW = { off: 'No rate limit', on: `Ramp ${Math.round(JOY.slewPerS * 100)} %/s` }
const NOTIFY = { r10: 'Notify 10 Hz', r20: 'Notify 20 Hz', r50: 'Notify 50 Hz' }
const NOTIFY_HZ = { r10: 10, r20: 20, r50: 50 }
const joyParams = (p: Params) => [pick(SHAPE, p.shape, 'raw'), pick(SLEW, p.slew, 'off'), pick(NOTIFY, p.rate, 'r20')] as const
const joyMemo = memoBy(
  (q: readonly [string, string, string]) => q.join(),
  ([s, l, r]) => joyRun(SHAPES[s as keyof typeof SHAPES], l === 'on' ? JOY.slewPerS : 0, NOTIFY_HZ[r as keyof typeof NOTIFY_HZ]),
)

export const joystickOverBle: Lesson = {
  id: 'remote-control-joystick-over-ble',
  title: 'Joystick over BLE',
  tagline: 'Thumbstick to wheel speeds',
  formula: (p) => {
    const [s, , r] = joyParams(p)
    const { link } = joyMemo(joyParams(p))
    const sh = SHAPES[s]
    return `L = y + x, R = y − x (÷ the larger if > 1)${sh.dz ? ` · deadzone ${sh.dz}` : ''}${sh.expo ? ` · expo ${sh.expo}: 0.4v + 0.6v³` : ''} · [seq, L, R] int8 = ${DRIVE_PDU_BYTES} B on air at ${hertz(link.rate)}${link.rate < NOTIFY_HZ[r] ? ` (asked ${NOTIFY_HZ[r]})` : ''}`
  },
  legend: [
    { color: RING, label: 'Thumbstick (x turn, y forward)', shape: 'dot' },
    { color: HEAT, label: 'Left wheel command', shape: 'dot' },
    { color: B_FIELD, label: 'Right wheel command', shape: 'dot' },
    { color: POWER, label: 'BLE notification [seq L R]', shape: 'dot' },
    { color: HIGH_V, label: 'Creep with the stick let go', shape: 'dot' },
  ],
  points: [
    'The phone app reads the thumbstick as x (turn) and y (forward), each −1 … 1, and turns it into two wheel speeds for a differential drive. Arcade mixing does it: left = y + x, right = y − x. Push forward and both wheels match; push sideways and they run opposite, so the robot spins on the spot. A full diagonal would ask for more than 100 %, so both are scaled down together to keep the turn.',
    'A stick never springs back to exact centre: this one rests at x 0.08, y 0.10. Sent raw, that is 18 % on one wheel and the robot creeps in a slow circle with nobody touching it. A deadzone reads anything inside 0.1 as 0 and rescales the rest, so the edge of the deadzone is 0 and full throw is still 100 %.',
    'Expo bends the curve: out = 0.4·v + 0.6·v³. Full throw is still full speed, but half throw gives 27 % instead of 50 %, so small corrections and slow turns are easy. Race-car and drone radios use the same curve.',
    `The two speeds go out as a 3-byte characteristic value, [seq, L, R] as signed int8 (−1 → 0x81, +1 → 0x7F), pushed by notify (Wi-Fi & Bluetooth → BLE GATT). Notifications only go out at connection events, so at a ${msText(JOY.ciS)} interval asking for 50 Hz gets ${hertz(1 / JOY.ciS)}. 20 Hz is plenty for a thumb.`,
    'The robot does not jump straight to each new value. A rate limit moves each wheel at most 2.5 × full scale per second toward the target, so a stick snapped forward does not pop a wheelie or spin the tyres, and a lost packet or two only makes a smooth step.',
  ],
  controls: [
    { kind: 'choice', key: 'shape', options: opts(SHAPE), initial: 'raw' },
    { kind: 'choice', key: 'slew', options: opts(SLEW), initial: 'off' },
    { kind: 'choice', key: 'rate', options: opts(NOTIFY), initial: 'r20' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const phone = stickPhone(scene, [-17.5, 2, 0], 2.2)
    const stickText = liveLabel(scene, [-17.5, -2.6, 0.3], { size: 0.42 })
    const notifyText = liveLabel(scene, [-17.5, -3.7, 0.3], { size: 0.42 })
    const barL = meterBar(scene, [-18.5, -6.4, 0], 4, 1, [], 'L')
    const barR = meterBar(scene, [-18.5, -8.6, 0], 4, 1, [], 'R')

    const g = floorView(scene, [-11.8, 3.6, 0], 3.8, -0.5)
    floorMat(g, [-0.4, 3.2], [-2.2, 0.6])
    flatBox(g, [0.4, 0.4, 0.006], glowMat(POWER, 0.25), [0, 0, 0.004])
    addLabel(g, 'start', [0, 0.4, 0.02], GREY, 0.16)
    const robot = lidarRobot(g, 1)
    const trail = pointCloud(g, 1400, 0.02)
    const rip = ripples(scene, [phone.top[0], phone.top[1] + 0.6, 0.2], { count: 2, reach: 1, period: 0.5 })
    const packets = packetPool(scene, 12, 0.45)

    const plot = scope(scene, 11, 6, { divs: [13, 4], zeroAt: 0.5 })
    plot.group.position.set(8.5, 1.5, 0)
    const tr = { sy: plot.trace(RING, { samples: 1400, radius: 0.05 }), l: plot.trace(HEAT, { samples: 1400, radius: 0.07 }), r: plot.trace(B_FIELD, { samples: 1400, radius: 0.07 }) }
    const cur = cursorBar(plot, LABEL)
    addLabel(scene, '+100 %', [2.4, 1.5 + plot.height / 2, 0.3], GREY, 0.36, 'right')
    addLabel(scene, '−100 %', [2.4, 1.5 - plot.height / 2, 0.3], GREY, 0.36, 'right')
    addLabel(scene, `stick y and wheels · 0 … ${JOY.seconds} s`, [8.5, -2.4, 0.3], GREY, 0.4)
    const note = liveLabel(scene, [-3, -6.4, 0.3], { size: 0.44, align: 'left' })
    const result = liveLabel(scene, [-3, -7.6, 0.3], { size: 0.44, align: 'left' })

    const clock = simClock(JOY.dt, 2)
    const st = { t: 0, key: '' }
    const us: number[] = []
    const ys: number[][] = [[], [], []]
    return {
      scene,
      view: { center: [-3, -0.8, 0], radius: 62, polar: 1.5, azimuth: 0 },
      frame(dt, p) {
        const q = joyParams(p)
        const key = q.join()
        const run = joyMemo(q)
        const { frames, packets: pk } = run
        const i = Math.floor(clock(dt, key, frames.length - 1))
        const f = frames[i]
        st.t = f.t
        if (key !== st.key) {
          st.key = key
          us.length = ys[0].length = ys[1].length = ys[2].length = 0
          for (let j = 0; j < frames.length; j += 2) {
            const h = frames[j]
            us.push(h.t / JOY.seconds)
            ys[0].push((h.sy * plot.height) / 2)
            ys[1].push((h.wl * plot.height) / 2)
            ys[2].push((h.wr * plot.height) / 2)
          }
          tr.sy.points(us, ys[0])
          tr.l.points(us, ys[1])
          tr.r.points(us, ys[2])
        }
        cur(f.t / JOY.seconds)

        phone.stick(f.sx, f.sy)
        phone.lines[0].set('Drive', LABEL)
        phone.lines[1].set('', RING)
        stickText.set(`stick x ${f.sx.toFixed(2)}  y ${f.sy.toFixed(2)}`, RING)
        robot.group.position.set(f.x, f.y, 0)
        robot.group.rotation.z = f.th
        robot.head.rotation.z += dt * 6 * Math.abs(f.wl + f.wr)
        const released = f.t >= JOY.releaseAt
        let k = 0
        for (let j = 0; j <= i; j += 8) trail.set(k++, [frames[j].x, frames[j].y, 0.01], frames[j].t >= JOY.releaseAt + 0.6 ? HIGH_V : GREY)
        trail.show(k)

        const now = f.t
        const head = worldOf(robot.group)
        packets.begin()
        let newest = -1
        let tagged = -1
        for (let j = pk.length - 1; j >= 0 && pk[j].sent > now - 0.3; j--) {
          if (pk[j].sent > now) continue
          if (newest < 0) newest = j
          const u = (now - pk[j].sent) / 0.3
          if (tagged < 0 && u >= 0.35) tagged = j
          packets.put(arcAt(phone.top, head, u, 3), POWER, { w: 1.1, payload: 0.5, text: j === tagged ? hexRow(pk[j].bytes) : '' })
        }
        packets.end()
        rip(now, POWER, 0.6)
        const last = pk[tagged < 0 ? newest : tagged]
        notifyText.set(last ? `notify #${last.bytes[0]}: ${hexRow(last.bytes)}` : '', POWER)
        barL(Math.abs(f.wl), pctText(f.wl), f.wl < 0 ? HIGH_V : HEAT)
        barR(Math.abs(f.wr), pctText(f.wr), f.wr < 0 ? HIGH_V : B_FIELD)

        const creep = creepM(frames)
        note.set(released ? 'Thumb off: stick rests at x 0.08, y 0.10' : `Stick → L ${pctText(f.l)}, R ${pctText(f.r)} (sent)`, released ? GREY : LABEL)
        result.set(
          released ? (creep > 0.01 ? `Creeps ${Math.round(creep * 100)} cm with nobody driving` : 'Parked: deadzone reads the rest as 0') : `Wheels ${pctText(f.wl)} / ${pctText(f.wr)} after ramp`,
          released ? (creep > 0.01 ? HIGH_V : POWER) : LABEL,
        )
      },
      readouts: (p) => {
        const q = joyParams(p)
        const { frames, link } = joyMemo(q)
        const creep = creepM(frames)
        const jerk = peakJerk(frames)
        return [
          { label: 'Sim time', value: `${st.t.toFixed(2)} s (1×)` },
          { label: 'Notify', value: `${hertz(link.rate)} · ≤ ${msText(JOY.ciS)} late`, tone: link.keepsUp ? 'ok' : 'warn' },
          { label: 'Wheel ramp', value: jerk > 10 ? 'jumps in one step' : `${Math.round(jerk * 100)} %/s`, tone: jerk > 10 ? 'bad' : 'ok' },
          { label: 'Creep', value: creep > 0.01 ? `${Math.round(creep * 100)} cm` : 'none', tone: creep > 0.01 ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- WebSocket control: JSON commands up, acks with telemetry down, a stale-command timeout on the robot. ---

const SEND = { periodic: `Send at ${WS.hz} Hz`, change: 'Send on change' }
const TIMEOUT = { none: 'No timeout', t300: 'Timeout 300 ms', t1000: 'Timeout 1 s' }
const TIMEOUT_S = { none: 0, t300: 0.3, t1000: 1 }
const FAULT = { none: 'Link OK', drop: 'Wi-Fi dropout' }
const wsParams = (p: Params) => [pick(SEND, p.send, 'periodic') as WsSend, pick(TIMEOUT, p.timeout, 'none'), pick(FAULT, p.fault, 'drop')] as const
const wsMemo = memoBy((q: readonly [string, string, string]) => q.join(), ([s, to, f]) => wsRun(s as WsSend, TIMEOUT_S[to as keyof typeof TIMEOUT_S], f === 'drop'))
const AGE_MAX = 1.5
const FLY = 0.35
const wsCode = (to: number) =>
  to
    ? ['void onWs(JsonDocument& d) {', '  target = d["v"]; last = millis(); ack(); }', `if (millis() - last > ${Math.round(to * 1000)}) target = 0;`, '// quiet link: stop']
    : ['void onWs(JsonDocument& d) {', '  target = d["v"]; ack(); }', '// no timeout: last command stays', '']

export const webSocketControl: Lesson = {
  id: 'remote-control-websocket-control',
  title: 'WebSocket control',
  tagline: 'Commands up, acks down, stop when it goes quiet',
  formula: (p) => {
    const [s, to] = wsParams(p)
    const j = cmdJson(12, 0.4)
    return `${j} = ${j.length} B + ${2 + WS_MASK_BYTES} B WS + 40 B TCP/IP = ${wsBytes(j, true)} B${s === 'periodic' ? ` × ${WS.hz} Hz` : ' per change'} · stop if no command for ${TIMEOUT_S[to] ? msText(TIMEOUT_S[to]) : '∞'}`
  },
  legend: [
    { color: RING, label: 'Command {"seq","v"} phone → robot', shape: 'dot' },
    { color: POWER, label: 'Ack + telemetry robot → phone', shape: 'dot' },
    { color: HEAT, label: 'Robot speed', shape: 'dot' },
    { color: HIGH_V, label: 'Timeout stop / crash', shape: 'dot' },
  ],
  points: [
    `A page served by the ESP32 (or a phone app) opens a WebSocket and sends small JSON commands: {"seq":12,"v":0.40,"w":0} is ${cmdJson(12, 0.4).length} B. Browser-to-robot frames carry a 4 B mask key on top of the 2 B header (Wi-Fi & Bluetooth → HTTP and WebSocket covers the handshake). JSON is easy to read in the browser console; the bytes barely matter at ${WS.hz} Hz.`,
    'The robot answers every command with an ack carrying the seq it got plus telemetry (speed, battery). The page shows how old the last ack is, so the driver sees a stale link instead of trusting a frozen screen.',
    'The danger is the last command. The motor driver keeps doing whatever it was told, so if the Wi-Fi drops while you drive forward, the robot keeps driving forward. Your "stop" sits in the phone\'s TCP buffer: TCP never loses it, it holds it and delivers it in a burst when the link comes back, by then too late.',
    'So the robot runs a stale-command timeout (a deadman): if no command has arrived for 300 ms, set the speed to 0. With a timeout it stops 0.3 s into the dropout; without one it hits the wall. Check the seq too, so a burst of old commands is not replayed.',
    'A timeout needs a heartbeat. A page that only sends when the stick moves goes quiet while you hold it steady, and the robot stops and lurches every 300 ms. Send at a fixed rate (here 20 Hz, well inside the timeout) even when nothing changes.',
  ],
  controls: [
    { kind: 'choice', key: 'send', options: opts(SEND), initial: 'periodic' },
    { kind: 'choice', key: 'timeout', options: opts(TIMEOUT), initial: 'none' },
    { kind: 'choice', key: 'fault', options: opts(FAULT), initial: 'drop' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const phone = stickPhone(scene, [-17.5, 2, 0], 2.2)
    const link = liveLabel(scene, [-17.5, -2.6, 0.3], { size: 0.42 })
    const json = liveLabel(scene, [-17.5, -3.7, 0.3], { size: 0.38 })
    const ageBar = meterBar(scene, [-18.5, -6.4, 0], 4, AGE_MAX, [], 'age')
    const queue = liveLabel(scene, [-17.5, -8.4, 0.3], { size: 0.4 })
    const router = routerModel(scene, [-7, 4.4, 0], 0.7)
    const routerTop = router.top
    const rip = ripples(scene, routerTop, { count: 2, reach: 1, period: 0.8 })
    const g = floorView(scene, [-12, -1.4, 0], 6.5, -0.5)
    floorMat(g, [-0.3, WS.wallX], [-0.35, 0.35])
    const wallM = glowMat('#3a3e47', 0.2)
    box(g, [0.06, 0.7, 0.3], wallM, [WS.wallX + 0.03, 0, 0.15])
    addLabel(g, 'wall', [WS.wallX + 0.03, -0.5, 0.02], GREY, 0.12)
    const robot = lidarRobot(g, 1, 0.24)
    const stopMark = flatBox(g, [0.02, 0.5, 0.006], glowMat(HIGH_V, 1), [0, 0, 0.006])
    const packets = packetPool(scene, 24, 0.4)
    const code = codeBlock(scene, [2.5, -2.4, 0.3], 0.36, 4)

    const plot = scope(scene, 10, 5, { divs: [8, 4], zeroAt: 0.1 })
    plot.group.position.set(8, 3.4, 0)
    const yOf = (v: number) => (v / 0.5 - 0.4) * plot.height
    const tr = { stick: plot.trace(RING, { samples: 900, radius: 0.05 }), v: plot.trace(HEAT, { samples: 900, radius: 0.08 }) }
    const cur = cursorBar(plot, LABEL)
    const drop = glowBox(plot.group, [((WS.dropout[1] - WS.dropout[0]) / WS.seconds) * 10, plot.height, 0.05], [plot.xAt((WS.dropout[0] + WS.dropout[1]) / 2 / WS.seconds), 0, 0.1], HIGH_V, 0.12)
    addLabel(scene, `command and speed · 0 … ${WS.seconds} s`, [8, 0, 0.3], GREY, 0.4)
    const note = liveLabel(scene, [-8, -5.6, 0.3], { size: 0.44, align: 'left' })
    const result = liveLabel(scene, [-8, -6.8, 0.3], { size: 0.44, align: 'left' })

    const clock = simClock(WS.dt, 2)
    const st = { t: 0, key: '' }
    const us: number[] = []
    const ys: number[][] = [[], []]
    return {
      scene,
      view: { center: [-3, -1, 0], radius: 62, polar: 1.5, azimuth: 0 },
      frame(dt, p) {
        const q = wsParams(p)
        const key = q.join()
        const [, to, fault] = q
        const toS = TIMEOUT_S[to]
        const { frames, msgs } = wsMemo(q)
        const i = Math.floor(clock(dt, key, frames.length - 1))
        const f = frames[i]
        const now = f.t
        st.t = now
        if (key !== st.key) {
          st.key = key
          us.length = ys[0].length = ys[1].length = 0
          for (const h of frames) {
            us.push(h.t / WS.seconds)
            ys[0].push(yOf(h.target))
            ys[1].push(yOf(h.v))
          }
          tr.stick.points(us, ys[0])
          tr.v.points(us, ys[1])
          drop.mesh.visible = fault === 'drop'
          code(wsCode(toS))
        }
        cur(now / WS.seconds)
        const down = fault === 'drop' && now >= WS.dropout[0] && now < WS.dropout[1]

        const stick = frames[i].t < WS.releaseAt && frames[i].t >= WS.pressAt ? 1 : 0
        phone.stick(0, stick * 0.9)
        const stale = f.ackAge > 0.5
        phone.lines[0].set('Drive', LABEL)
        phone.lines[1].set(stale ? 'LINK?' : 'ws ok', stale ? HIGH_V : POWER)
        link.set(!Number.isFinite(f.ackAge) ? 'connecting' : stale ? `no ack for ${f.ackAge.toFixed(1)} s` : `ack in ${msText(2 * WS.oneWayS)}`, stale ? HIGH_V : POWER)

        robot.group.position.set(f.x + 0.06, 0, 0)
        robot.head.rotation.z += dt * 30 * f.v
        stopMark.visible = f.v === 0 && f.t > 1
        stopMark.position.x = f.x + 0.13
        setGlow(wallM, f.crashed ? HIGH_V : '#3a3e47', f.crashed ? 1 : 0.2)
        for (let k = 0; k < 4; k++) router.led(k, down ? HIGH_V : POWER, down ? 0.3 + 0.7 * (Math.floor(now * 4) % 2) : 0.8)
        rip(now, down ? HIGH_V : B_FIELD, down ? 0 : 0.5)

        const bot = worldOf(robot.group)
        packets.begin()
        let shown = 0
        let held = 0
        let newest: string | null = null
        for (const m of msgs) {
          if (m.sent > now) continue
          const up = m.kind === 'cmd'
          const [a, b] = up ? [phone.top, bot] : [bot, phone.top]
          if (m.arrive > now && m.arrive - m.sent > 0.1) {
            if (up) held++
            continue
          }
          const age = now - Math.max(m.sent, m.arrive - WS.oneWayS)
          if (age < 0 || age > FLY || shown >= 22) continue
          const u = age / FLY
          const via = u < 0.5 ? arcAt(a, routerTop, u * 2, 0.6) : arcAt(routerTop, b, u * 2 - 1, 0.6)
          shown++
          if (up) newest = m.json
          packets.put(via, up ? RING : POWER, { w: 0.9, payload: 0.6 })
        }
        packets.end()
        json.set(newest ?? '', RING)
        queue.set(held ? `TCP buffer: ${held} held` : 'TCP buffer empty', held ? HIGH_V : GREY)

        const ageC = toS && f.timedOut ? HIGH_V : f.age > 0.15 ? HEAT : POWER
        ageBar(Math.min(AGE_MAX, f.age), Number.isFinite(f.age) ? `${f.age.toFixed(2)} s` : '—', ageC)
        note.set(
          down ? 'Wi-Fi down: commands wait in the TCP buffer' : f.t >= WS.releaseAt ? 'Driver let go: stop sent' : f.t >= WS.pressAt ? `Driving: v ${f.target.toFixed(2)} m/s` : 'Ready',
          down ? HIGH_V : LABEL,
        )
        const fin = frames[frames.length - 1]
        result.set(
          f.crashed ? 'Crash: the last command kept the motors on' : f.timedOut && toS && f.t > WS.pressAt ? `Timeout: no command for ${msText(toS)}, stopped` : fin.crashed ? 'Still obeying the last command' : `${(WS.wallX - WS.halfLen - f.x).toFixed(2)} m to the wall`,
          f.crashed || (f.timedOut && toS) ? HIGH_V : LABEL,
        )
      },
      readouts: (p) => {
        const q = wsParams(p)
        const { frames, msgs } = wsMemo(q)
        const f = frames[Math.min(frames.length - 1, Math.round(st.t / WS.dt))]
        const fin = frames[frames.length - 1]
        const stops = frames.filter((h, k) => k && h.t > 0.5 && h.timedOut && !frames[k - 1].timedOut).length
        const sent = msgs.filter((m) => m.kind === 'cmd' && m.sent <= st.t)
        return [
          { label: 'Sim time', value: `${st.t.toFixed(2)} s (1×)` },
          { label: 'Commands', value: `${sent.length} · ${sent.reduce((s, m) => s + m.bytes, 0)} B` },
          { label: 'Cmd age', value: Number.isFinite(f.age) ? `${Math.round(f.age * 1000)} ms` : '—', tone: f.timedOut && TIMEOUT_S[q[1]] ? 'bad' : f.age > 0.15 ? 'warn' : 'ok' },
          { label: 'Outcome', value: fin.crashed ? 'hits the wall' : stops > 1 ? `${stops} false stops` : `stops ${(WS.wallX - WS.halfLen - fin.x).toFixed(2)} m short`, tone: fin.crashed ? 'bad' : stops > 1 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Latency: braking for a gate through a delayed video feed; jitter, safe speed, client-side prediction. ---

const JITTER = { none: 'No jitter', j40: 'Jitter ±40 ms' }
const JITTER_S = { none: 0, j40: 0.04 }
const PREDICT = { off: 'Raw video', on: 'Predicted' }
const lagParams = (p: Params) => [Number(p.rtt), Number(p.speed), pick(JITTER, p.jitter, 'none'), pick(PREDICT, p.predict, 'off')] as const
const lagMemo = memoBy((q: readonly [number, number, string, string]) => q.join(), ([rtt, v, j, pr]) => lagRun(rtt, JITTER_S[j as keyof typeof JITTER_S], v, pr === 'on'))
const LAG_SLOW = 2
const CHAIN_W = 9
const CHAIN: [string, string][] = [
  ['seen', B_FIELD],
  ['react', RING],
  ['uplink', HIGH_V],
  ['brake', HEAT],
]

export const latency: Lesson = {
  id: 'remote-control-latency',
  title: 'Latency',
  tagline: 'You steer the past',
  formula: (p) => {
    const [rtt, v, j] = lagParams(p)
    const dead = rtt + 2 * JITTER_S[j] + LAG.reactS
    return `stop = v·(RTT + react) + v²/2a = ${v.toFixed(1)}·${dead.toFixed(2)} + ${((v * v) / (2 * LAG.decel)).toFixed(2)} = ${stopDistance(v, dead, LAG.decel).toFixed(2)} m · safe in ${LAG.clearM} m: ${safeSpeed(LAG.clearM, dead, LAG.decel).toFixed(2)} m/s`
  },
  legend: [
    { color: B_FIELD, label: 'Where the phone shows the robot', shape: 'dot' },
    { color: RING, label: 'Brake mark (allows for braking + reaction)', shape: 'dot' },
    { color: HIGH_V, label: 'Stop command / overshoot', shape: 'dot' },
    { color: POWER, label: 'Gate', shape: 'dot' },
  ],
  points: [
    'Remote driving closes the loop through you: the robot sends video or telemetry down, you react, and your command goes back up. Everything you see is already half a round trip old, and your stop needs another half to land. Wi-Fi in a quiet room is 10–30 ms round trip; through a cloud relay or a 4G link 200–800 ms is normal.',
    `The driver here knows the robot well: they press stop at a mark that already allows for its braking (v²/2a, a = ${LAG.decel} m/s²) and their own ${msText(LAG.reactS)} reaction. With no latency it stops on the gate. Every millisecond of round trip adds v × RTT of overshoot: 1 m/s and 300 ms is 30 cm past the gate.`,
    'Jitter is the delay changing from packet to packet. Video frames arrive unevenly and sometimes out of order; a frame older than one already shown is dropped (check the stamp or seq), so the picture stutters and the delay is worse than its average.',
    `Turn it around for a safe top speed: if obstacles show up ${LAG.clearM} m ahead, v·(RTT + react) + v²/2a must fit in ${LAG.clearM} m. Double the latency and the safe speed drops; slow down on a laggy link, or let the robot's own sensors stop it.`,
    'Client-side prediction draws the robot where it will be when your command lands: last seen position + speed × (frame age + expected uplink delay), with the frame age from its time stamp. It cancels the steady delay but not jitter, and it guesses wrong when the robot is turning or braking on its own.',
  ],
  controls: [
    { kind: 'slider', key: 'rtt', label: 'Round trip', min: 0.02, max: 0.8, initial: 0.3, step: 0.01, format: (v: number) => msText(v) },
    { kind: 'slider', key: 'speed', label: 'Speed', min: 0.3, max: 1.5, initial: 1, step: 0.1, format: (v: number) => `${v.toFixed(1)} m/s` },
    { kind: 'choice', key: 'jitter', options: opts(JITTER), initial: 'none' },
    { kind: 'choice', key: 'predict', options: opts(PREDICT), initial: 'off' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const phone = stickPhone(scene, [-17.5, 2, 0], 2.2)
    const ageText = liveLabel(scene, [-17.5, -2.6, 0.3], { size: 0.42 })
    const over = meterBar(scene, [-18.5, -6.4, 0], 4, 1.2, [], 'over')

    const g = floorView(scene, [-9.5, -1.4, 0], 5.6, -0.6)
    floorMat(g, [-0.3, 3.8], [-0.4, 0.4])
    const gateM = glowMat(POWER, 0.9)
    for (const y of [-0.42, 0.42]) box(g, [0.05, 0.05, 0.4], gateM, [LAG.gateX, y, 0.2])
    flatBox(g, [0.02, 0.8, 0.006], gateM, [LAG.gateX, 0, 0.006])
    addLabel(g, 'gate', [LAG.gateX, -0.62, 0.02], POWER, 0.12)
    const brake = flatBox(g, [0.02, 0.8, 0.006], glowMat(RING, 1), [0, 0, 0.007])
    const brakeTag = liveLabel(g, [0, 0.55, 0.02], { size: 0.1 })
    const stopAt = flatBox(g, [0.02, 0.8, 0.006], glowMat(HIGH_V, 1), [0, 0, 0.008])
    const robot = lidarRobot(g, 1, 0.24)
    const ghost = glowBox(g, [0.24, 0.2, 0.08], [0, 0, 0.06], B_FIELD, 0.35)
    const packets = packetPool(scene, 32, 0.32)
    const chain = CHAIN.map(([name, color]) => {
      const m = glowMat(color, 0.3)
      const b = flatBox(scene, [1, 0.7, 0.3], m, [0, -6.6, 0])
      const tag = liveLabel(scene, [0, -6.6 + (CHAIN.findIndex((c) => c[0] === name) % 2 ? 0.85 : -0.85), 0.3], { size: 0.34 })
      return { name, color, m, b, tag }
    })
    const note = liveLabel(scene, [-8, -8.8, 0.3], { size: 0.44, align: 'left' })
    const result = liveLabel(scene, [-8, -10, 0.3], { size: 0.44, align: 'left' })
    const safe = liveLabel(scene, [-8, -11.2, 0.3], { size: 0.44, align: 'left' })

    const clock = simClock(LAG.dt * LAG_SLOW, 2)
    const st = { t: 0 }
    return {
      scene,
      view: { center: [-3, -1.8, 0], radius: 62, polar: 1.5, azimuth: 0 },
      frame(dt, p) {
        const q = lagParams(p)
        const run = lagMemo(q)
        const [rtt, v, j, pr] = q
        const i = Math.floor(clock(dt, q.join(), run.frames.length - 1))
        const f = run.frames[i]
        const now = f.t
        st.t = now
        const pressT = run.frames.find((h) => h.pressed)?.t ?? Infinity
        const decide = run.frames.find((h) => h.t >= pressT - LAG.reactS - 1e-9)
        const segs = [decide ? decide.t - decide.stamp : 0, LAG.reactS, run.stopAt - pressT, v / LAG.decel]
        const starts = [decide ? decide.stamp : 0, pressT - LAG.reactS, pressT, run.stopAt]
        let x0 = -8
        chain.forEach((c, k) => {
          const w = Math.max(0.05, segs[k] * CHAIN_W)
          c.b.scale.x = w
          c.b.position.x = x0 + w / 2
          c.tag.group.position.x = x0 + w / 2
          c.tag.set(`${c.name} ${msText(segs[k])}`, c.color)
          setGlow(c.m, c.color, now >= pressT - LAG.reactS && now >= starts[k] ? 1 : 0.15)
          x0 += w + 0.15
        })

        robot.group.position.set(f.x - 0.06, 0, 0)
        robot.head.rotation.z += dt * 12 * f.v
        ghost.mesh.position.x = f.shown - 0.12
        ghost.mesh.visible = f.shown > 0.01
        brake.position.x = run.brakeAt
        brakeTag.group.position.x = run.brakeAt
        brakeTag.set('brake mark', RING)
        stopAt.visible = f.v === 0 && f.braking
        stopAt.position.x = f.x

        phone.stick(0, f.pressed ? 0 : 0.9)
        phone.lines[0].set(pr === 'on' ? 'predict' : 'video', pr === 'on' ? RING : GREY)
        phone.lines[1].set(f.pressed ? 'STOP' : `${f.shown.toFixed(2)} m`, f.pressed ? HIGH_V : B_FIELD)
        ageText.set(Number.isFinite(f.stamp) ? `frame ${msText(now - f.stamp)} old` : 'waiting for video', B_FIELD)

        const bot = worldOf(robot.group)
        packets.begin()
        for (const m of run.msgs) {
          if (m.sent > now || m.arrive <= now) continue
          const u = (now - m.sent) / (m.arrive - m.sent)
          const stop = m.kind === 'stop'
          if (stop) packets.put(arcAt(phone.top, bot, u, 2.5), HIGH_V, { w: 1.4, payload: 0.6, text: 'STOP' })
          else packets.put(arcAt(bot, phone.top, u, -1.5), m.late ? GREY : B_FIELD, { w: 0.5, payload: 0.7, fade: m.late ? 0.4 : 1 })
        }
        packets.end()

        const done = f.braking && f.v === 0
        const os = done ? run.overshoot : Math.max(0, f.x - LAG.gateX)
        over(Math.max(0, Math.min(1.2, os)), `${Math.round(os * 100)} cm`, os > 0.05 ? HIGH_V : POWER)
        const late = run.msgs.filter((m) => m.late && m.arrive <= now).length
        note.set(
          f.braking ? `Stop landed ${msText(run.stopAt - run.frames.find((h) => h.pressed)!.t)} after the press` : f.pressed ? 'Stop pressed, in flight' : `Screen lags the robot by ${Math.round(Math.max(0, f.x - f.shown) * 100)} cm`,
          f.pressed ? HIGH_V : B_FIELD,
        )
        result.set(done ? (run.overshoot > 0.03 ? `Overshot the gate by ${Math.round(run.overshoot * 100)} cm` : run.overshoot < -0.03 ? `Stopped ${Math.round(-run.overshoot * 100)} cm short` : 'Stopped on the gate') : `RTT ${msText(rtt)}${JITTER_S[j] ? ` ± ${msText(JITTER_S[j])}` : ''} · ${late} late frames dropped`, done && Math.abs(run.overshoot) > 0.03 ? HIGH_V : LABEL)
        const vs = safeSpeed(LAG.clearM, rtt + 2 * JITTER_S[j] + LAG.reactS, LAG.decel)
        safe.set(`Safe max for ${LAG.clearM} m warning: ${vs.toFixed(2)} m/s${v > vs ? ` (driving ${v.toFixed(1)})` : ''}`, v > vs ? HEAT : POWER)
      },
      readouts: (p) => {
        const q = lagParams(p)
        const run = lagMemo(q)
        const [rtt, v, j] = q
        const vs = safeSpeed(LAG.clearM, rtt + 2 * JITTER_S[j] + LAG.reactS, LAG.decel)
        const late = run.msgs.filter((m) => m.late).length
        return [
          { label: 'Sim time', value: `${st.t.toFixed(2)} s (½×)` },
          { label: 'Overshoot', value: `${Math.round(run.overshoot * 100)} cm`, tone: Math.abs(run.overshoot) > 0.1 ? 'bad' : Math.abs(run.overshoot) > 0.03 ? 'warn' : 'ok' },
          { label: 'Safe speed', value: `${vs.toFixed(2)} m/s`, tone: v > vs ? 'bad' : 'ok' },
          { label: 'Late frames', value: `${late}`, tone: late ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
