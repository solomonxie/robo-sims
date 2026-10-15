import * as THREE from 'three/webgpu'
import {
  ESPNOW_FRAME_BYTES,
  ESPNOW_RETRIES,
  GattMode,
  WebProto,
  ackAirtime,
  espNowLink,
  gattLink,
  tempBytes,
  webRounds,
  webTelemetry,
  wifiTopology,
} from '../../core/physics'
import { dbmText, hexByte, msText, pct, secs } from '../../core/units'
import { V3, add, mat, mesh, rod, box } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CLK_COLOR,
  CODE_LEGEND,
  DATA_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  arcAt,
  codeBlock,
  glowMat,
  halton,
  liveLabel,
  packetPool,
  partLetter,
  phoneModel,
  ripples,
  robotCar,
  routerModel,
  setGlow,
  shadowlessRod,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, opts, pick } from '../types'

const rssiColor = (r: number) => (r > -67 ? POWER : r > -77 ? RING : r > -82 ? HEAT : HIGH_V)
const rssiTone = (r: number) => (r > -67 ? 'ok' : r > -82 ? 'warn' : 'bad')
const loopT = (s: { key: string; t: number }, key: string, dt: number) => {
  if (key !== s.key) Object.assign(s, { key, t: 0 })
  s.t += dt
  return s.t
}

// --- Station and AP: the robot joins the home router, or hosts its own network for the phone, or both. ---

type Node = 'phone' | 'router' | 'robot'
type Step = { a: Node; b: Node; text: string; color: string }
const STEP = 0.75
const SA_HOLD = 2.5
const SA_DISTS = { '5': 5, '25': 25, '80': 80, '150': 150 }
const MODES = { sta: 'Station', ap: 'Access point', apsta: 'AP + Station' }
const join = (sta: Node, ap: Node, ip: string): Step[] => [
  { a: sta, b: ap, text: 'probe', color: CLK_COLOR },
  { a: ap, b: sta, text: 'SSID', color: CLK_COLOR },
  { a: sta, b: ap, text: 'auth+assoc', color: CLK_COLOR },
  { a: ap, b: sta, text: 'WPA2 keys', color: CLK_COLOR },
  { a: sta, b: ap, text: 'DHCP?', color: RING },
  { a: ap, b: sta, text: ip, color: RING },
]
const getVia = (hops: Node[]): Step[] => {
  const out: Step[] = []
  for (let i = 1; i < hops.length; i++) out.push({ a: hops[i - 1], b: hops[i], text: 'GET /', color: DATA_COLOR })
  for (let i = hops.length - 1; i > 0; i--) out.push({ a: hops[i], b: hops[i - 1], text: '200 OK', color: DATA_COLOR })
  return out
}
const SEQ: Record<keyof typeof MODES, Step[]> = {
  sta: [...join('robot', 'router', '.1.37'), ...getVia(['phone', 'router', 'robot'])],
  ap: [...join('phone', 'robot', '.4.2'), ...getVia(['phone', 'robot'])],
  apsta: [
    ...join('robot', 'router', '.1.37'),
    { a: 'robot', b: 'router', text: 'NTP?', color: POWER },
    { a: 'router', b: 'robot', text: 'time', color: POWER },
    ...join('phone', 'robot', '.4.2'),
    ...getVia(['phone', 'robot']),
  ],
}

const saSetup = (p: Params) => {
  const mode = pick(MODES, p.mode, 'sta')
  const dk = pick(SA_DISTS, p.dist, '25')
  const d = SA_DISTS[dk]
  const top = wifiTopology(mode, d)
  const hops = [...top.path, ...(top.uplink ? [top.uplink] : [])]
  const linkOf = (a: Node, b: Node) => hops.find((h) => (h.from === a && h.to === b) || (h.from === b && h.to === a))
  const steps = SEQ[mode]
  const fail = steps.findIndex((st) => !(linkOf(st.a, st.b)?.mbps ?? 0))
  return { mode, dk, d, top, linkOf, steps, fail }
}

export const stationAndAp: Lesson = {
  id: 'wi-fi-bluetooth-station-and-ap',
  title: 'Station and AP',
  tagline: 'Join the home network, or be the network',
  formula: (p) => {
    const S = saSetup(p)
    const rates = S.top.path.map((h) => h.mbps)
    const via = rates.length > 1 ? `1 / (1/${rates[0]} + 1/${rates[1]}) = ${+S.top.mbps.toFixed(1)} Mbit/s (the router sends every frame twice)` : `${rates[0]} Mbit/s direct`
    return `RSSI = 22 dBm − path loss (n = 3 near the floor) → best rate · phone ↔ robot: ${S.top.ok ? via : 'no link'} · robot IP ${S.top.robotIp} from the ${S.top.dhcp}'s DHCP`
  },
  legend: [
    { color: CLK_COLOR, label: 'Join: probe, auth, WPA2 keys', shape: 'dot' },
    { color: RING, label: 'DHCP: who gives out the IP', shape: 'dot' },
    { color: DATA_COLOR, label: 'HTTP to the robot’s web page', shape: 'dot' },
    { color: POWER, label: 'Internet through the router', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'The ESP32 radio can be a Wi-Fi client (station, STA), an access point (AP) or both at once. Your phone and laptop are always stations; the router is the AP.',
    'Station: the robot joins the home network like a phone does: scan, authenticate, associate, swap WPA2 keys, then ask the router’s DHCP for an IP (192.168.1.x). The phone reaches it through the router, and the robot has the internet (time, updates, cloud).',
    'Every frame between two stations goes to the router and back out, on the same channel: two airtimes, so the throughput is roughly halved. Drive out of the router’s range and the robot is gone.',
    'Access point: the robot broadcasts its own SSID, say robot-car, runs a tiny DHCP server and is always 192.168.4.1. The phone joins it directly: works in a field with no router, but the phone loses its internet while connected. Default limit: 4 clients.',
    'AP + Station runs both: the phone talks to the robot directly while the robot keeps an uplink. One radio, so the AP must follow the router’s channel.',
    'RSSI falls with distance as in Radio basics → 2.4 GHz; here walls and furniture near the floor are folded into a steeper n = 3.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'sta' },
    { kind: 'choice', key: 'dist', options: Object.keys(SA_DISTS).map((k) => ({ value: k, label: `${k} m` })), initial: '25' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const xOfM = (m: number) => -8.5 + (14 * Math.log(m / 5)) / Math.log(150 / 5)
    const router = routerModel(scene, [-18.5, -1.6, 0], 0.8)
    partLetter(scene, 'home router', [-18.5, -3.4, 0.5], 0.42, LABEL)
    const cloud = mat('#5b6270', { rough: 0.8 }, true)
    for (const [x, y, r] of [[-19.7, 6.2, 1], [-18.1, 6.7, 1.3], [-16.5, 6.2, 0.9]]) add(scene, mesh(new THREE.SphereGeometry(r, 18, 12), cloud), [x, y, -1])
    partLetter(scene, 'internet', [-18.1, 6.4, 0.6], 0.42, LABEL)
    const upMat = glowMat(POWER, 0)
    const upRod = add(scene, shadowlessRod(upMat))
    stretchRod(upRod, [-18.1, 2, -0.5], [-18.1, 5, -0.5], 0.1)
    rod(scene, [-9.5, -5.6, 0], [6.5, -5.6, 0], 0.05, mat('#46645a'))
    for (const k of Object.keys(SA_DISTS)) {
      const x = xOfM(SA_DISTS[k as keyof typeof SA_DISTS])
      rod(scene, [x, -5.9, 0], [x, -5.3, 0], 0.05, mat('#46645a'))
      partLetter(scene, `${k} m`, [x, -6.5, 0], 0.38, GREY)
    }
    partLetter(scene, 'distance from the router', [-1.5, -7.4, 0], 0.36, GREY)
    const robotG = add(scene, new THREE.Group())
    const car = robotCar(robotG, [0, -3.4, 0], 0.55)
    const phoneG = add(scene, new THREE.Group())
    const phone = phoneModel(phoneG, [0, 0, 0.5], 1.5)
    const robotTag = liveLabel(robotG, [0, 3.2, 0.4], { size: 0.4 })
    const routerRip = ripples(scene, router.top, { reach: 2.2 })
    const robotRip = ripples(robotG, car.antenna, { reach: 2.2 })
    const pairs: [Node, Node][] = [
      ['phone', 'router'],
      ['router', 'robot'],
      ['phone', 'robot'],
    ]
    const links = pairs.map(() => {
      const m = glowMat(GREY, 0)
      return { m, o: add(scene, shadowlessRod(m)), tag: liveLabel(scene, [0, 0, 0.4], { size: 0.36 }) }
    })
    const pk = packetPool(scene, 2, 0.55)
    const code = codeBlock(scene, [-22.8, -4.6, 0], 0.34, 4)
    const s = { key: '', t: 0, rx: xOfM(25) }
    return {
      scene,
      view: { center: [-3.5, 0.2, 0], radius: 64, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const S = saSetup(p)
        const t = loopT(s, `${S.mode}|${S.dk}`, dt)
        s.rx = s.rx + (xOfM(S.d) - s.rx) * Math.min(1, dt * 4)
        robotG.position.x = s.rx
        phoneG.position.set(s.rx + 5.8, -2.4, 0)
        const pos: Record<Node, V3> = {
          router: router.top,
          robot: [s.rx + car.antenna[0], car.antenna[1], car.antenna[2]],
          phone: [s.rx + 5.8, 0.2, 1],
        }
        pairs.forEach(([a, b], i) => {
          const h = S.linkOf(a, b)
          const L = links[i]
          L.o.visible = !!h
          L.tag.group.visible = !!h
          if (!h) return
          stretchRod(L.o, pos[a], pos[b], 0.06)
          setGlow(L.m, rssiColor(h.rssi), h.mbps ? 0.35 : 0.15)
          const lift = a === 'phone' && b === 'robot' ? 1.2 : i === 0 ? 0.6 : -0.9
          const f = i === 0 ? 0.2 : 0.5
          L.tag.group.position.set(pos[a][0] + (pos[b][0] - pos[a][0]) * f, pos[a][1] + (pos[b][1] - pos[a][1]) * f + lift, 0.4)
          L.tag.set(h.mbps ? `${dbmText(h.rssi)} · ${h.mbps} Mbit/s` : `${dbmText(h.rssi)} · out of range`, rssiColor(h.rssi))
        })
        const shown = S.fail >= 0 ? S.fail + 1 : S.steps.length
        const total = shown * STEP + SA_HOLD
        const tt = t % total
        const k = Math.floor(tt / STEP)
        const u = (tt % STEP) / (STEP * 0.85)
        pk.begin()
        if (k < shown && u <= 1) {
          const st = S.steps[k]
          const lost = k === S.fail
          const lift = st.a === 'router' || st.b === 'router' ? 2.4 : 2.2
          const fade = lost ? Math.max(0, 1 - Math.max(0, u - 0.4) * 2.5) : 1
          pk.put(arcAt(pos[st.a], pos[st.b], lost ? Math.min(u, 0.6) : u, lift), lost ? HIGH_V : st.color, { w: 1.1, text: lost ? `${st.text} · no reply` : st.text, fade })
        }
        pk.end()
        const robotJoined = S.mode !== 'ap' && (S.fail < 0 || S.fail > 5) && (k >= 6 || tt >= shown * STEP)
        const phoneJoined = S.mode !== 'sta' && S.fail < 0 && k >= S.steps.length - 2
        const done = S.fail < 0 && tt >= S.steps.length * STEP
        robotTag.set(
          S.mode === 'ap' ? `AP robot-car · ${S.top.robotIp}` : robotJoined ? (S.mode === 'apsta' ? `192.168.1.37 · AP ${S.top.robotIp}` : S.top.robotIp) : S.fail >= 0 && S.fail <= 5 ? 'no router in range' : 'joining home…',
          S.fail >= 0 && S.fail <= 5 ? HIGH_V : robotJoined || S.mode === 'ap' ? POWER : GREY,
        )
        routerRip(t, LABEL, 0.6)
        robotRip(t, CLK_COLOR, S.mode === 'sta' ? 0 : 0.8)
        const online = S.top.internet && (S.mode === 'sta' || robotJoined)
        setGlow(upMat, online ? POWER : '#3a3f4a', online ? 0.8 : 0.1)
        router.led(0, POWER, 1)
        router.led(1, CLK_COLOR, 0.5 + 0.5 * Math.sin(t * 9))
        const net = S.mode === 'sta' ? 'home' : 'robot-car'
        phone.lines[0].set(net, S.mode === 'sta' || phoneJoined ? LABEL : GREY)
        phone.lines[1].set(S.mode === 'sta' ? '192.168.1.20' : phoneJoined ? '192.168.4.2' : '…', GREY)
        phone.lines[2].set(done ? 'robot page' : S.fail >= 0 ? 'unreachable' : '', done ? DATA_COLOR : HIGH_V)
        phone.screen(done ? '#2a2f6a' : '#141a2a', done ? 0.7 : 0.4)
        code(
          S.mode === 'sta'
            ? ['WiFi.mode(WIFI_STA);', 'WiFi.begin("home", "secret");', 'while (WiFi.status() != WL_CONNECTED) delay(100);', 'Serial.println(WiFi.localIP());  // 192.168.1.37']
            : S.mode === 'ap'
              ? ['WiFi.mode(WIFI_AP);', 'WiFi.softAP("robot-car", "12345678");', 'Serial.println(WiFi.softAPIP());  // 192.168.4.1', 'server.begin();  // phone opens http://192.168.4.1']
              : ['WiFi.mode(WIFI_AP_STA);', 'WiFi.begin("home", "secret");  // uplink', 'WiFi.softAP("robot-car", "12345678");', "// AP switches to the router's channel"],
        )
      },
      readouts: (p) => {
        const S = saSetup(p)
        const up = S.top.uplink
        return [
          { label: 'Robot IP', value: S.mode === 'sta' && !S.top.ok ? 'none, not joined' : `${S.top.robotIp} (${S.top.dhcp === 'router' ? 'router DHCP' : 'its own DHCP'})`, tone: S.mode === 'sta' && !S.top.ok ? 'bad' : undefined },
          { label: 'Phone ↔ robot', value: S.top.ok ? `${S.top.path.length} hop${S.top.path.length > 1 ? 's' : ''} · ${+S.top.mbps.toFixed(1)} Mbit/s` : 'no link', tone: S.top.ok ? 'ok' : 'bad' },
          { label: 'Robot ↔ router', value: up ? dbmText(up.rssi) : 'not used', tone: up ? rssiTone(up.rssi) : undefined },
          { label: 'Robot internet', value: S.top.internet ? 'yes, via router' : 'no', tone: S.top.internet ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- HTTP and WebSocket: polling opens (or reuses) a connection per reading; a WebSocket pushes frames down one open pipe. ---

const RTT = 0.025
const WEB_SLOW = 48
const TELEMETRY = '{"rpm":312,"bat":3.91,"yaw":-12.5}'
const PAYLOAD = TELEMETRY.length
const PROTOS = { http: 'HTTP poll', keepalive: 'Keep-alive', ws: 'WebSocket' }
const RATES = { '5': 5, '20': 20, '50': 50 }
/** Start of each segment of one exchange, in RTTs (one-way = ½ RTT). */
const START: Record<WebProto, number[]> = {
  http: [0, 0.5, 1, 1.2, 1.7, 2.2, 1.9, 2.4, 2.9],
  keepalive: [0, 0.5, 1.2],
  ws: [0, 0.5],
}
const webSetup = (p: Params) => {
  const proto = pick(PROTOS, p.proto, 'http')
  const rk = pick(RATES, p.rate, '20')
  const T = webTelemetry(proto, RATES[rk], PAYLOAD, RTT)
  return { proto, rk, hz: RATES[rk], T }
}
const rpmAt = (t: number) => Math.round(312 + 40 * Math.sin(t * 2.1))

export const httpAndWebSocket: Lesson = {
  id: 'wi-fi-bluetooth-http-and-websocket',
  title: 'HTTP and WebSocket',
  tagline: 'Ask for every reading, or keep one pipe open and push',
  formula: (p) => {
    const { proto, hz, T } = webSetup(p)
    const rounds = webRounds(proto)
    return `${T.packets.length} TCP segments × 40 B headers + ${proto === 'ws' ? '2 B frame header' : 'HTTP headers'} + ${PAYLOAD} B JSON = ${T.bytes} B per reading (${pct(T.overhead)} overhead) · ${rounds ? `max rate = 1 / (${rounds} × RTT ${msText(RTT)}) = ${Math.round(T.maxHz)} Hz` : 'no round trip per reading'} · age = ½ / ${Math.round(T.rate)} Hz + ½ RTT = ${msText(T.ageS)}${T.keepsUp ? '' : ` (wanted ${hz} Hz)`} · slowed ${WEB_SLOW}×`
  },
  legend: [
    { color: DATA_COLOR, label: 'Telemetry JSON (the payload)', shape: 'dot' },
    { color: GREY, label: 'Headers: TCP/IP 40 B, HTTP ~270 B', shape: 'dot' },
    { color: CLK_COLOR, label: 'Phone → robot: SYN, GET, ACK, FIN', shape: 'dot' },
    { color: RING, label: 'Robot → phone: replies and frames', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    `A phone app wants the robot’s speed, battery and heading many times a second: a ${PAYLOAD}-byte JSON reading. The robot runs a web server; the phone is on its Wi-Fi.`,
    'HTTP is request/response: the phone asks (GET), the robot answers (200 OK + headers + body). A fresh connection first needs the TCP handshake (SYN, SYN-ACK, ACK) and a close (FIN): 9 segments and two round trips for 34 bytes of data.',
    'Keep-alive reuses the TCP connection, so only GET, reply and ACK remain. Still one full round trip per reading, and the ~270 bytes of HTTP headers every time. The phone can’t ask faster than once per round trip.',
    'A WebSocket starts as one HTTP request (Upgrade: websocket) and then stays open both ways. The robot pushes a frame whenever it has a reading: 2 bytes of frame header, no request, no waiting for a question.',
    `At ${Math.round(RTT * 1000)} ms round trip (typical for an ESP32 on Wi-Fi with modem sleep) polling tops out at 20–40 Hz; a WebSocket keeps up at 50 Hz with a fraction of the bytes. Use HTTP for pages and commands, a WebSocket for live telemetry and joysticks.`,
  ],
  controls: [
    { kind: 'choice', key: 'proto', options: opts(PROTOS), initial: 'http' },
    { kind: 'choice', key: 'rate', options: Object.keys(RATES).map((k) => ({ value: k, label: `${k} Hz` })), initial: '20' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const car = robotCar(scene, [-16, -3.5, 0], 0.8)
    partLetter(scene, 'robot · web server', [-16, -6.4, 0.5], 0.42, LABEL)
    const phone = phoneModel(scene, [12, -2.5, 0.5], 1.6, 3)
    partLetter(scene, 'phone app', [12, -6.4, 0.5], 0.42, LABEL)
    const a = car.antenna
    const b: V3 = [11, 0.2, 1]
    const pathMat = glowMat('#3a3f4a', 0.2)
    const pipe = add(scene, shadowlessRod(pathMat))
    stretchRod(pipe, a, b, 0.05)
    const pipeMat = glowMat(RING, 0)
    pipeMat.transparent = true
    pipeMat.depthWrite = false
    const wsPipe = add(scene, shadowlessRod(pipeMat))
    stretchRod(wsPipe, a, b, 0.22)
    const pk = packetPool(scene, 28, 0.7)
    const conn = liveLabel(scene, [(a[0] + b[0]) / 2, 5.6, 0], { size: 0.45 })
    const code = codeBlock(scene, [-21.8, -8.6, 0], 0.32, 4)
    const s = { key: '', t: 0, shownAt: -1, value: 312 }
    return {
      scene,
      view: { center: [-2, -1, 0], radius: 64, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const S = webSetup(p)
        const now = loopT(s, `${S.proto}|${S.rk}`, dt) / WEB_SLOW
        const segs = S.T.packets
        const starts = START[S.proto]
        const period = 1 / S.T.rate
        const span = Math.max(...starts) * RTT + RTT / 2
        pk.begin()
        let lastRx = -1
        for (let j = Math.max(0, Math.floor((now - span) / period)); j * period <= now; j++) {
          const t0 = j * period
          segs.forEach((sg, i) => {
            const st = t0 + starts[i] * RTT
            const u = (now - st) / (RTT / 2)
            if (sg.payload && u >= 1) lastRx = Math.max(lastRx, t0)
            if (u < 0 || u > 1) return
            const [from, to] = sg.up ? [b, a] : [a, b]
            pk.put(arcAt(from, to, u, sg.up ? 3.2 : -1.6), sg.payload ? DATA_COLOR : sg.up ? CLK_COLOR : RING, {
              w: 0.6 + sg.bytes / 55,
              payload: sg.payload / sg.bytes,
              text: sg.what,
            })
          })
        }
        pk.end()
        if (lastRx >= 0 && lastRx !== s.shownAt) {
          s.shownAt = lastRx
          s.value = rpmAt(lastRx)
        }
        setGlow(pipeMat, RING, 0.4)
        pipeMat.opacity = 0.18
        wsPipe.visible = S.proto === 'ws'
        conn.set(S.proto === 'ws' ? 'one TCP connection, open the whole time' : S.proto === 'keepalive' ? 'connection reused, one GET per reading' : 'new TCP connection per reading', S.proto === 'ws' ? RING : GREY)
        phone.lines[0].set(`rpm ${s.value}`, DATA_COLOR)
        phone.lines[1].set(`${Math.round(S.T.rate)} / s`, S.T.keepsUp ? POWER : HIGH_V)
        phone.lines[2].set(`age ${msText(S.T.ageS)}`, LABEL)
        phone.screen('#141a2a', 0.5)
        code(
          S.proto === 'ws'
            ? ['AsyncWebSocket ws("/ws");', `ws.textAll(json());  // every ${Math.round(1000 / S.hz)} ms`, '// phone: new WebSocket("ws://192.168.4.1/ws")', '//   .onmessage = (m) => draw(JSON.parse(m.data))']
            : [
                'server.on("/t", [] { server.send(200, "application/json", json()); });',
                `// phone: setInterval(() => fetch("http://192.168.4.1/t"), ${Math.round(1000 / S.hz)})`,
                S.proto === 'http' ? '//   Connection: close → new TCP handshake each time' : '//   Connection: keep-alive → TCP stays open',
                '// one request in flight at a time',
              ],
        )
      },
      readouts: (p) => {
        const S = webSetup(p)
        return [
          { label: 'Per reading', value: `${S.T.packets.length} segments · ${S.T.bytes} B` },
          { label: 'Overhead', value: pct(S.T.overhead), tone: S.T.overhead > 0.9 ? 'bad' : S.T.overhead > 0.6 ? 'warn' : 'ok' },
          { label: 'Readings', value: `${Math.round(S.T.rate)} of ${S.hz} / s · ${(S.T.bytesPerS / 1000).toFixed(1)} kB/s`, tone: S.T.keepsUp ? 'ok' : 'bad' },
          { label: 'Reading age', value: msText(S.T.ageS) },
        ]
      },
    }
  },
}

// --- BLE GATT: a tree of services and characteristics; the phone reads one, or subscribes and gets notified. ---

const BLE_SLOW = 20
const POLL_HZ = 10
const CIS = { '7.5': 0.0075, '30': 0.03, '100': 0.1 }
const BLE_MODES = { notify: 'Notify', read: 'Read' }
const WIN = 0.4
const tempAt = (t: number) => 23 + 1.6 * Math.sin(t * 1.3) + 0.3 * Math.sin(t * 5.1)
const bleSetup = (p: Params) => {
  const mode = pick(BLE_MODES, p.mode, 'notify') as GattMode
  const ck = pick(CIS, p.ci, '30')
  const ci = CIS[ck]
  return { mode, ck, ci, G: gattLink(mode, ci, POLL_HZ) }
}
const EPS = 1e-9
/** What happens at connection event `k`: the sample it carries (or −1) and which PDU. */
function bleEvent(mode: GattMode, ci: number, rate: number, k: number) {
  const req = (kk: number) => {
    const j = Math.ceil(((kk - 1) * ci) * rate + EPS)
    return j / rate <= kk * ci + EPS && kk >= 0 ? j : -1
  }
  if (mode === 'notify') {
    const j = req(k)
    return { j, what: j >= 0 ? 'Notify' : '' }
  }
  const r = req(k)
  if (r >= 0) return { j: r, what: 'Read Req' }
  const q = req(k - 1)
  return q >= 0 ? { j: q, what: 'Read Rsp' } : { j: -1, what: '' }
}

export const bleGatt: Lesson = {
  id: 'wi-fi-bluetooth-ble-gatt',
  title: 'BLE GATT',
  tagline: 'Services, characteristics, and who speaks first',
  formula: (p) => {
    const { mode, ci, G } = bleSetup(p)
    return `Radio meets every CI = ${msText(ci)} (n × 1.25 ms) · ${mode === 'read' ? `read = request in one event + response in the next: max ${Math.round(G.maxHz)} Hz · age ≈ ½ / ${Math.round(G.rate)} Hz + 1.5 × CI` : `notify = next event: max ${Math.round(G.maxHz)} Hz · age ≈ ½ / ${Math.round(G.rate)} Hz + ½ × CI`} = ${msText(G.ageS)} · ${G.bytes} B on air = ${G.airUs} µs at 1 Mbit/s · slowed ${BLE_SLOW}×`
  },
  legend: [
    { color: RING, label: 'Service (a group, 16-bit UUID)', shape: 'dot' },
    { color: DATA_COLOR, label: 'Characteristic value: temperature', shape: 'dot' },
    { color: CLK_COLOR, label: 'Read request from the phone', shape: 'dot' },
    { color: GREY, label: 'Empty packets: the link stays alive', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Bluetooth Low Energy keeps a connection by meeting at fixed connection events: every connection interval (CI, 7.5 ms … 4 s) the phone (central) and the ESP32 (peripheral) wake, swap a packet, and sleep. Long CI = less power, more delay.',
    'GATT is the menu the ESP32 offers: services (Environmental Sensing 0x181A, Battery 0x180F) holding characteristics, each with a UUID, a value and properties: READ, WRITE, NOTIFY.',
    'Temperature 0x2A6E is a signed 16-bit value in 0.01 °C, little-endian: 23.45 °C = 2345 = 0x0929 → bytes 29 09. The app has to know the format; standard UUIDs define it.',
    `Read: the phone asks whenever it wants (here ${POLL_HZ} times a second). The request goes out at one event and the answer comes back at the next, so each reading costs two events.`,
    'Notify: the phone writes 01 00 to the characteristic’s CCCD (0x2902) once, then the ESP32 sends each new value at the next event by itself. One packet, half the delay, and nothing sent when nothing changed.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(BLE_MODES), initial: 'notify' },
    { kind: 'choice', key: 'ci', options: Object.keys(CIS).map((k) => ({ value: k, label: `CI ${k} ms` })), initial: '30' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const car = robotCar(scene, [-17, -4, 0], 0.75)
    partLetter(scene, 'ESP32 · peripheral', [-17, -6.8, 0.5], 0.42, LABEL)
    const phone = phoneModel(scene, [13, -3, 0.5], 1.5, 3)
    partLetter(scene, 'phone · central', [13, -6.8, 0.5], 0.42, LABEL)
    const a = car.antenna
    const b: V3 = [12, -0.4, 1]
    // GATT table
    const gx = -24
    const rows: [number, string, string][] = [
      [0, 'Service 0x181A  Environmental Sensing', RING],
      [1, '0x2A6E  Temperature', DATA_COLOR],
      [2, 'value', DATA_COLOR],
      [2, 'CCCD 0x2902', GREY],
      [1, '0x2A6F  Humidity  READ', GREY],
      [0, 'Service 0x180F  Battery', RING],
      [1, '0x2A19  Battery Level  READ', GREY],
    ]
    const rowMats = rows.map(([ind, text, color], i) => {
      const y = 9.6 - i * 1.15
      const m = glowMat('#20242c', 0.15)
      box(scene, [13.5 - ind * 1.2, 0.95, 0.2], m, [gx + ind * 1.2 + (13.5 - ind * 1.2) / 2, y, -0.2])
      const lab = liveLabel(scene, [gx + 0.35 + ind * 1.2, y, 0.05], { size: 0.38, align: 'left' })
      lab.set(text, color)
      return { m, lab, color }
    })
    const props = liveLabel(scene, [gx + 13.2, 9.6 - 1.15, 0.05], { size: 0.34, align: 'right' })
    // event strip
    const sx0 = -6
    const sw = 17
    const sy = -9.2
    rod(scene, [sx0, sy, 0], [sx0 + sw, sy, 0], 0.04, mat('#46645a'))
    partLetter(scene, `connection events · ${Math.round(WIN * 1000)} ms`, [sx0, sy - 1, 0], 0.34, GREY, 'left')
    const nowMark = add(scene, mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), glowMat(LABEL, 0.8)), [sx0 + sw / 2, sy + 0.3, 0.1])
    nowMark.castShadow = false
    const tickGeo = new THREE.BoxGeometry(0.16, 1, 0.16)
    const ticks = Array.from({ length: 60 }, () => {
      const m = glowMat(GREY, 0.3)
      const o = add(scene, mesh(tickGeo, m), [0, sy, 0])
      o.castShadow = false
      return { o, m }
    })
    const pk = packetPool(scene, 4, 0.65)
    const ripA = ripples(scene, a, { count: 1, reach: 1.2, period: 0.4 })
    const ripB = ripples(scene, b, { count: 1, reach: 1.2, period: 0.4 })
    const code = codeBlock(scene, [-25, -8.4, 0], 0.32, 4)
    const s = { key: '', t: 0, shown: -1 }
    return {
      scene,
      view: { center: [-5, 0.4, 0], radius: 70, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const S = bleSetup(p)
        if (`${S.mode}|${S.ck}` !== s.key) s.shown = -1
        const now = loopT(s, `${S.mode}|${S.ck}`, dt) / BLE_SLOW
        const rate = S.G.rate
        const kNow = Math.floor(now / S.ci + EPS)
        const flight = Math.min(0.3, 0.8 * S.ci * BLE_SLOW) / BLE_SLOW
        // strip: events in the window, now in the middle
        ticks.forEach((tk, i) => {
          const k = Math.floor((now - WIN / 2) / S.ci) + i
          const te = k * S.ci
          const x = (te - (now - WIN / 2)) / WIN
          tk.o.visible = k >= 0 && x >= 0 && x <= 1
          if (!tk.o.visible) return
          const ev = bleEvent(S.mode, S.ci, rate, k)
          tk.o.position.x = sx0 + x * sw
          const col = ev.what === 'Read Req' ? CLK_COLOR : ev.what ? DATA_COLOR : GREY
          tk.o.scale.y = ev.what ? 1.3 : 0.6
          tk.o.position.y = sy + tk.o.scale.y / 2
          setGlow(tk.m, col, te <= now ? 0.9 : 0.25)
        })
        pk.begin()
        let hot = 0
        for (let k = kNow - 1; k <= kNow; k++) {
          if (k < 0) continue
          const u = (now - k * S.ci) / flight
          if (u < 0 || u > 1) continue
          const ev = bleEvent(S.mode, S.ci, rate, k)
          if (!ev.what) pk.put(arcAt(b, a, u, 1.5), GREY, { w: 0.4, payload: 0, text: '' })
          else {
            const ask = ev.what === 'Read Req'
            const bytes = tempBytes(tempAt(ev.j / rate))
            pk.put(arcAt(ask ? b : a, ask ? a : b, u, ask ? 1.5 : -1), ask ? CLK_COLOR : DATA_COLOR, {
              w: ask ? 1 : 1.6,
              payload: ask ? 0 : 0.45,
              text: ask ? 'Read Req' : `${ev.what} ${bytes.map((x) => hexByte(x).slice(2)).join(' ')}`,
            })
            hot = 1 - u
            if (!ask && u > 0.95) s.shown = ev.j
          }
        }
        pk.end()
        const evU = (now - kNow * S.ci) / S.ci
        ripA(evU * 0.4, LABEL, 0.7)
        ripB(evU * 0.4, LABEL, 0.7)
        const temp = s.shown >= 0 ? tempAt(s.shown / rate) : NaN
        const cur = tempAt(now)
        const vb = tempBytes(cur)
        rowMats[2].lab.set(`value ${vb.map((x) => hexByte(x).slice(2)).join(' ')} = ${cur.toFixed(2)} °C`, DATA_COLOR)
        rowMats[3].lab.set(`CCCD 0x2902 = ${S.mode === 'notify' ? '01 00 notify on' : '00 00 off'}`, S.mode === 'notify' ? POWER : GREY)
        props.set(S.mode === 'notify' ? 'READ NOTIFY' : 'READ', LABEL)
        rowMats.forEach((r, i) => setGlow(r.m, i === 1 || i === 2 ? '#3b2f66' : '#20242c', i === 1 || i === 2 ? 0.15 + 0.6 * hot : 0.15))
        phone.lines[0].set('Temperature', LABEL)
        phone.lines[1].set(Number.isNaN(temp) ? '—' : `${temp.toFixed(2)} °C`, DATA_COLOR)
        phone.lines[2].set(`${Math.round(rate)} / s · age ${msText(S.G.ageS)}`, S.G.keepsUp ? GREY : HIGH_V)
        phone.screen('#141a2a', 0.5)
        code(
          S.mode === 'notify'
            ? ['auto *c = svc->createCharacteristic((uint16_t)0x2A6E, READ | NOTIFY);', 'c->setValue(t100); c->notify();  // each new reading', '// phone: await c.startNotifications()', '//   → writes 01 00 to CCCD 0x2902']
            : ['auto *c = svc->createCharacteristic((uint16_t)0x2A6E, READ);', 'c->setValue(t100);  // just keep it current', `// phone: setInterval(() => c.readValue(), ${1000 / POLL_HZ})`, '// each read: request event + response event'],
        )
      },
      readouts: (p) => {
        const S = bleSetup(p)
        return [
          { label: 'Per reading', value: `${S.G.pdus.length} packet${S.G.pdus.length > 1 ? 's' : ''} · ${S.G.bytes} B · ${S.G.airUs} µs` },
          { label: 'Events per reading', value: String(S.G.events) },
          { label: 'Updates', value: `${Math.round(S.G.rate)} of ${POLL_HZ} / s`, tone: S.G.keepsUp ? 'ok' : 'bad' },
          { label: 'Reading age', value: msText(S.G.ageS), tone: S.G.ageS < 0.1 ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- ESP-NOW: one robot sends a command straight to another by MAC address, acked in microseconds, no router. ---

const NOW_SLOW = 400
const PAYLOADS = { '8': 8, '64': 64, '250': 250 }
const NOW_DISTS = { '10': 10, '100': 100, '300': 300, '500': 500 }
const GAP = 0.9
const nowSetup = (p: Params) => {
  const pk = pick(PAYLOADS, p.payload, '64')
  const dk = pick(NOW_DISTS, p.dist, '100')
  const bytes = PAYLOADS[pk]
  const d = NOW_DISTS[dk]
  return { pk, dk, bytes, d, L: espNowLink(bytes, d) }
}
/** Display timeline of send `n`: its attempts (lost or not) until delivered or out of retries. */
function sendPlan(n: number, per: number, attempt: number) {
  const out: boolean[] = []
  for (let k = 0; k <= ESPNOW_RETRIES; k++) {
    const lost = halton(n * 9 + k, 3) < per
    out.push(lost)
    if (!lost) break
  }
  return { lost: out, dur: out.length * attempt * NOW_SLOW + GAP }
}

export const espNow: Lesson = {
  id: 'wi-fi-bluetooth-esp-now',
  title: 'ESP-NOW',
  tagline: 'Robot to robot in a millisecond, no router',
  formula: (p) => {
    const S = nowSetup(p)
    return `Frame = 192 µs preamble + (${S.bytes} + ${ESPNOW_FRAME_BYTES} B) × 8 µs at 1 Mbit/s = ${secs(S.L.air)} · attempt = wait + frame + SIFS + ACK ${secs(ackAirtime())} = ${secs(S.L.attempt)} · RSSI ${dbmText(S.L.rssi)} → ${pct(S.L.per)} lost per try → ${S.L.tries.toFixed(2)} tries = ${secs(S.L.latencyS)} · slowed ${NOW_SLOW}×, gaps between 50 Hz sends skipped`
  },
  legend: [
    { color: DATA_COLOR, label: 'Command: steer and speed (payload)', shape: 'dot' },
    { color: GREY, label: '43 B MAC header and frame wrap', shape: 'dot' },
    { color: POWER, label: 'ACK from the follower’s radio', shape: 'dot' },
    { color: HIGH_V, label: 'Lost: no ACK, sender retries', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'ESP-NOW is Espressif’s connectionless protocol on the Wi-Fi radio: no access point, no association, no IP. The sender addresses a peer by its 6-byte MAC and the payload (up to 250 bytes) goes out as one vendor action frame.',
    'The receiving radio acks in hardware within microseconds; no ACK, and the sender’s MAC retries by itself. The send callback tells your code whether it got through.',
    'At the default 1 Mbit/s an 8-byte command with 43 bytes of framing is airborne for about 0.6 ms, the whole attempt with the ACK about 1.3 ms. Through a router with TCP the same command takes two hops plus the stack, typically 5–30 ms, and both robots must first join.',
    'The slow 1 Mbit/s rate is also the most robust (sensitivity about −98 dBm), so ESP-NOW reaches a few hundred metres with the PCB antennas. Near the edge some tries are lost; retries fix it at the cost of latency, until even 8 tries are not enough.',
    'Good for leader/follower robots, remote controls and sensor nodes that sleep between sends. Up to 20 peers; Wi-Fi station mode can run alongside, on the same channel.',
  ],
  controls: [
    { kind: 'choice', key: 'payload', options: Object.keys(PAYLOADS).map((k) => ({ value: k, label: `${k} B` })), initial: '64' },
    { kind: 'choice', key: 'dist', options: Object.keys(NOW_DISTS).map((k) => ({ value: k, label: `${k} m` })), initial: '100' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const xOfM = (m: number) => -6 + (15 * Math.log(m / 10)) / Math.log(50)
    const lead = robotCar(scene, [-17, -3.5, 0], 0.7)
    partLetter(scene, 'leader', [-17, -6.2, 0.5], 0.42, LABEL)
    const folG = add(scene, new THREE.Group())
    const fol = robotCar(folG, [0, -3.5, 0], 0.7)
    partLetter(folG, 'follower', [0, -6.2, 0.5], 0.42, LABEL)
    const folTag = liveLabel(folG, [0, 1.3, 0.4], { size: 0.4 })
    const leadTag = liveLabel(scene, [-17, 1.3, 0.4], { size: 0.4 })
    const ghost = routerModel(scene, [-11.5, 4.4, -1], 0.55)
    ghost.group.traverse((o) => o instanceof THREE.Mesh && (o.material = mat('#4a4f5a', { rough: 0.7 })))
    partLetter(scene, 'no router needed', [-11.5, 3.2, 0], 0.4, GREY)
    rod(scene, [-10, -7.4, 0], [10.5, -7.4, 0], 0.05, mat('#46645a'))
    for (const k of Object.keys(NOW_DISTS)) {
      const x = xOfM(NOW_DISTS[k as keyof typeof NOW_DISTS])
      rod(scene, [x, -7.7, 0], [x, -7.1, 0], 0.05, mat('#46645a'))
      partLetter(scene, `${k} m`, [x, -8.4, 0], 0.38, GREY)
    }
    const rip = ripples(scene, lead.antenna, { reach: 3, period: 0.5 })
    const pk = packetPool(scene, 2, 0.55)
    const code = codeBlock(scene, [-25, -10.2, 0], 0.34, 4)
    const s = { key: '', t: 0, x: xOfM(100), n: 0, t0: 0, got: 0, value: '' }
    return {
      scene,
      view: { center: [-4.5, -1.5, 0], radius: 66, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const S = nowSetup(p)
        const key = `${S.pk}|${S.dk}`
        if (key !== s.key) Object.assign(s, { key, t: 0, n: 0, t0: 0, got: 0, value: '' })
        s.t += dt
        s.x = s.x + (xOfM(S.d) - s.x) * Math.min(1, dt * 4)
        folG.position.x = s.x
        let plan = sendPlan(s.n, S.L.per, S.L.attempt)
        while (s.t - s.t0 > plan.dur) {
          s.t0 += plan.dur
          s.n++
          plan = sendPlan(s.n, S.L.per, S.L.attempt)
        }
        const a = lead.antenna
        const b: V3 = [s.x + fol.antenna[0], fol.antenna[1], fol.antenna[2]]
        const at = (s.t - s.t0) / NOW_SLOW
        const k = Math.floor(at / S.L.attempt)
        const inA = at - k * S.L.attempt
        const wait = S.L.attempt - S.L.air - 10e-6 - ackAirtime()
        const steer = Math.round(25 * Math.sin(s.n * 0.7))
        pk.begin()
        let sending = false
        if (k < plan.lost.length) {
          const lost = plan.lost[k]
          const uData = (inA - wait) / S.L.air
          const uAck = (inA - wait - S.L.air - 10e-6) / ackAirtime()
          if (uData >= 0 && uData <= 1) {
            sending = true
            const fade = lost ? Math.max(0, 1 - Math.max(0, uData - 0.5) * 2) : 1
            pk.put(arcAt(a, b, lost ? Math.min(uData, 0.65) : uData, 2), lost ? HIGH_V : DATA_COLOR, {
              w: 0.8 + (S.bytes + ESPNOW_FRAME_BYTES) / 60,
              payload: S.bytes / (S.bytes + ESPNOW_FRAME_BYTES),
              text: lost ? 'lost' : `steer ${steer}°`,
              fade,
            })
          }
          if (!lost && uAck >= 0 && uAck <= 1) pk.put(arcAt(b, a, uAck, -1), POWER, { w: 0.6, payload: 1, text: 'ACK' })
          if (!lost && uData > 1) s.value = `got steer ${steer}°`
        }
        pk.end()
        const failed = plan.lost.every((l) => l) && k >= plan.lost.length
        leadTag.set(k < plan.lost.length ? `send #${s.n + 1} · try ${k + 1}/${ESPNOW_RETRIES + 1}` : failed ? 'send failed' : 'delivered ✓', failed ? HIGH_V : k < plan.lost.length ? LABEL : POWER)
        folTag.set(s.value || 'waiting', s.value ? POWER : GREY)
        rip(s.t, DATA_COLOR, sending ? 0.9 : 0)
        code([
          'esp_now_init();',
          'esp_now_peer_info_t peer = {}; memcpy(peer.peer_addr, follower, 6);',
          'esp_now_add_peer(&peer);',
          `esp_now_send(follower, (uint8_t *)&cmd, ${S.bytes});  // every 20 ms`,
        ])
      },
      readouts: (p) => {
        const S = nowSetup(p)
        return [
          { label: 'RSSI', value: dbmText(S.L.rssi), tone: rssiTone(S.L.rssi + 16) },
          { label: 'Airtime per try', value: `${secs(S.L.air)} frame · ${secs(S.L.attempt)} with ACK` },
          { label: 'Delivered', value: `${pct(S.L.delivered)} · ${S.L.tries.toFixed(2)} tries`, tone: S.L.delivered > 0.999 ? 'ok' : S.L.delivered > 0.9 ? 'warn' : 'bad' },
          { label: 'Latency', value: secs(S.L.latencyS), tone: S.L.latencyS < 3e-3 ? 'ok' : 'warn' },
        ]
      },
    }
  },
}
