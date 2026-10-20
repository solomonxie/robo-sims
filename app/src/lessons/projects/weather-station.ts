import * as THREE from 'three/webgpu'
import {
  GPIO_VDD,
  NodeRadio,
  WX_ADDR,
  WX_ALERT,
  WX_BOARDS,
  WX_KIT,
  WX_PULLUPS,
  WX_SUN,
  WX_WEEK,
  WxBoard,
  WxMode,
  WxPullup,
  WxSun,
  fixedStepAt,
  wxBoardW,
  wxBus,
  wxJson,
  wxReportBytes,
  wxSeaPa,
  wxSensorC,
  wxSunAt,
  wxWeek,
} from '../../core/physics'
import { amps as ampText, bytesText, celsiusText, dayClock, fixedText, hexByte as hex, hoursText, ohms, pct, secs } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'

import {
  CLK_COLOR,
  CODE_LEGEND,
  DATA_COLOR,
  FACE_VIEW,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  SUN_TINT,
  addLabel,
  addRod,
  cableRun,
  cell18650,
  codeBlock,
  emptyGroup,
  esp32Board,
  frac,
  glowDot,
  glowMat,
  headerStage,
  heatWaves,
  i2cBreakout,
  liveLabel,
  memoBy,
  presence,
  ripples,
  routerModel,
  scope,
  setGlow,
  shellMat,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const pf = (f: number) => `${Math.round(f * 1e12)} pF`
const BOX = { x: -12, y: -0.9, w: 9.6, h: 6.6, d: 2.4 }

/** Sealed station box, face-on: dark back, see-through lid. */
function stationBox(scene: THREE.Object3D, at: V3, w: number, h: number, d: number) {
  const g = add(scene, new THREE.Group(), at)
  box(g, [w, h, 0.2], mat('#2b2e35', { rough: 0.8 }), [0, 0, -d / 2])
  box(g, [w, h, d], shellMat('#cfd6e0', 0.08), [0, 0, 0])
  for (const s of [-1, 1]) {
    box(g, [w, 0.2, d], mat('#dfe3ea', { rough: 0.6 }), [0, (s * h) / 2, 0])
    box(g, [0.2, h, d], mat('#dfe3ea', { rough: 0.6 }), [(s * w) / 2, 0, 0])
  }
  return g
}

/** White louvred radiation shield (plates over the sensor), centred on `at`. */
function radiationShield(parent: THREE.Object3D, at: V3, w: number) {
  const g = add(parent, new THREE.Group(), at)
  const white = mat('#eef0f3', { rough: 0.6 })
  const slat = shellMat('#eef0f3', 0.3, 0.6)
  box(g, [w + 0.3, 0.25, 1.6], white, [0, 2.3, 0])
  for (let i = 0; i < 6; i++) box(g, [w, 0.3, 0.12], slat, [0, 1.8 - i * 0.75, 0.9])
  box(g, [0.25, 4.6, 0.25], white, [0, 0, -1.4])
  return g
}

// --- Wire the sensors: BMP280 + OLED on one I²C bus; in the box it reads the board's heat, on a cable the bus slows. ---

const PU_NAMES = namesOf(WX_PULLUPS)
const MODES: Record<WxMode, string> = { standard: '100 kHz', fast: '400 kHz' }
const wsParams = (p: Params) => ({
  cable: n(p, 'cable'),
  pullup: pick(PU_NAMES, p.pullup, 'both') as WxPullup,
  mode: pick(MODES, p.mode, 'fast') as WxMode,
})
const SCL_SLOW_S = 2.4
const SC = { x: -2.4, y: -7.7, w: 26, h: 3.4 }

export const weatherStationWireTheSensors: Lesson = {
  id: 'weather-station-wire-the-sensors',
  title: 'Wire the sensors',
  tagline: 'A BMP280 and an OLED on one I²C bus: inside the box the sensor reads the board’s heat, out on a cable the extra capacitance slows every clock edge',
  formula: (p) => {
    const q = wsParams(p)
    const b = wxBus(q.cable, q.pullup, q.mode)
    const T = wxSensorC(q.cable)
    return `Cb = ${WX_KIT.espPf + WX_KIT.wiringPf} + 2 × ${WX_KIT.boardPf} + ${WX_KIT.cablePfPerM} pF/m × ${fixedText(q.cable, 2)} m = ${pf(b.farads)} · tr = 0.85·R·C = 0.85 × ${ohms(b.ohms)} × ${pf(b.farads)} = ${secs(b.tr)} (limit ${secs(b.trMax)}) · box air = ${WX_KIT.airC} °C + ${fixedText(wxBoardW(), 2)} W / U·A = ${celsiusText(T.boxC, 1)}`
  },
  legend: [
    { color: CLK_COLOR, label: 'SCL as the bus sees it', shape: 'dot' },
    { color: GREY, label: 'The clock the ESP32 meant', shape: 'dot' },
    { color: RING, label: 'VIH: counts as HIGH above this', shape: 'dot' },
    { color: HEAT, label: 'Board heat in the box', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    `The kit: an ESP32 DevKit, a BMP280 breakout (pressure + temperature, I²C ${hex(WX_ADDR.bmp)}) and a 0.96" SSD1306 OLED (${hex(WX_ADDR.oled)}) for a local readout. Both boards share SDA 21 / SCL 22, 3.3 V and GND; different addresses, so no clash (Microcontrollers › I²C › Addresses). Run a bus scan first: both addresses should answer.`,
    'Each breakout ships with its own 10 kΩ pull-ups, so two boards give 5 kΩ (Microcontrollers › I²C › Pull-up resistors). Fine on a short breadboard bus at 400 kHz.',
    `Inside a sealed box the sensor reads the box air, and the always-on prototype heats it: ${fixedText(wxBoardW(), 2)} W from USB (ESP32 with Wi-Fi, the DevKit's regulator and USB chip, the OLED) lifts it about ${fixedText(wxSensorC(0).rise, 1)} °C. Pressure is the same in and out, temperature isn't.`,
    'So the sensor goes outside, under a white louvred radiation shield (sun off, air through), on a cable. Every metre of 4-core cable adds about 60 pF; with 5 kΩ the clock edge stops meeting the 300 ns limit at 400 kHz after half a metre, and past a metre it never reaches a valid HIGH: the scan finds nothing.',
    'Fixes: drop to 100 kHz (Wire.setClock(100000); a weather station reads once a minute, speed doesn\'t matter), or add 2.2 kΩ at the ESP32 end. Past a few metres, use an I²C buffer or a sensor with its own MCU.',
  ],
  controls: [
    { kind: 'slider', key: 'cable', label: 'Cable to the sensor', min: 0, max: 5, step: 0.25, initial: 0, format: (v) => (v === 0 ? 'on the breadboard' : `${v.toFixed(2)} m`) },
    { kind: 'choice', key: 'pullup', options: opts(PU_NAMES), initial: 'both' },
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'fast' },
  ],
  build(): Stage {
    const { scene, status, sub, event } = headerStage()
    stationBox(scene, [BOX.x, BOX.y, 0], BOX.w, BOX.h, BOX.d)
    const espAt: V3 = [-13.7, -1.3, 0]
    const ek = 0.32
    const esp = esp32Board(scene, espAt, ek)
    const waves = heatWaves(add(scene, new THREE.Group(), [espAt[0], espAt[1] + 2.2, 0.6]), 3.6, { rise: 2.2, count: 4 })
    const oled = i2cBreakout(scene, [-9.6, 1.0, 0], { name: 'SSD1306', color: '#1d2f6b', k: 0.2 })
    oled.led(1)
    const screen = glowMat('#7fd8ff', 0)
    box(scene, [2.6, 1.3, 0.1], screen, [-9.6, 0.7, 0.25])
    const oledText = liveLabel(scene, [-9.6, 0.7, 0.4], { size: 0.26 })
    const bmpIn = i2cBreakout(scene, [-9.6, -2.7, 0], { name: 'BMP280', k: 0.2 })
    const outAt: V3 = [-3.2, -2.4, 0]
    const outside = add(scene, new THREE.Group())
    radiationShield(outside, [outAt[0], outAt[1] + 0.8, 0], 3.6)
    const bmpOut = i2cBreakout(outside, outAt, { name: 'BMP280', k: 0.2 })
    const wires = add(scene, new THREE.Group())
    const cableTag = liveLabel(scene, [-4.6, -4.4, 0.3], { size: 0.26 })
    const boxTag = liveLabel(scene, [BOX.x, BOX.y + BOX.h / 2 + 0.6, 0.3], { size: 0.3 })
    const airTag = liveLabel(scene, [outAt[0], outAt[1] + 3.6, 0.3], { size: 0.3 })

    const sc = scope(scene, SC.w, SC.h, { divs: [8, 4], zeroAt: 0 })
    sc.group.position.set(SC.x, SC.y, 0)
    const yOf = (v: number) => -SC.h / 2 + (v / GPIO_VDD) * SC.h * 0.88
    const ideal = sc.trace(GREY, { samples: 200, radius: 0.05 })
    const real = sc.trace(CLK_COLOR, { samples: 320, radius: 0.09 })
    const vih = sc.level(RING)
    const scTag = liveLabel(scene, [SC.x - SC.w / 2, SC.y + SC.h / 2 + 0.9, 0.3], { size: 0.3, align: 'left' })
    const okTag = liveLabel(scene, [SC.x + SC.w / 2, SC.y + SC.h / 2 + 0.9, 0.3], { size: 0.3, align: 'right' })
    addLabel(scene, '3.3 V', [SC.x - SC.w / 2 - 0.5, SC.y + yOf(GPIO_VDD), 0.3], GREY, 0.26, 'right')
    addLabel(scene, '0 V', [SC.x - SC.w / 2 - 0.5, SC.y + yOf(0), 0.3], GREY, 0.26, 'right')
    const code = codeBlock(scene, [0.6, 2.2, 0.3], 0.28, 4)
    const st = { key: '', t: 0 }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = wsParams(p)
        const b = wxBus(q.cable, q.pullup, q.mode)
        const T = wxSensorC(q.cable)
        const key = `${q.cable}|${q.pullup}|${q.mode}`
        if (key !== st.key) {
          Object.assign(st, { key, t: 0 })
          emptyGroup(wires)
          bmpIn.group.visible = T.inside
          outside.visible = !T.inside
          const scl = esp(4, true)
          const sda = esp(5, true)
          const bus = (to: { pin: (s: string) => V3 }, via: number) => {
            const c = to.pin('SCL')
            const d = to.pin('SDA')
            cableRun(wires, [scl, [scl[0], via, 0.6], [c[0], via, 0.6], c], CLK_COLOR, 0.07)
            cableRun(wires, [sda, [sda[0], via + 0.3, 0.7], [d[0], via + 0.3, 0.7], d], DATA_COLOR, 0.07)
          }
          bus(oled, 2.3)
          if (T.inside) {
            const c = bmpIn.pin('SCL')
            const d = bmpIn.pin('SDA')
            cableRun(wires, [oled.pin('SCL'), [c[0] - 1.6, c[1] + 1.6, 0.8], c], CLK_COLOR, 0.07)
            cableRun(wires, [oled.pin('SDA'), [d[0] + 1.6, d[1] + 1.4, 0.8], d], DATA_COLOR, 0.07)
          } else {
            const gland: V3 = [BOX.x + BOX.w / 2, -1.9, 0.4]
            const c = bmpOut.pin('SCL')
            const loops = Math.min(6, Math.round(q.cable * 1.2))
            const pts: V3[] = [[-10.2, -1.9, 0.6], gland]
            for (let i = 0; i < loops; i++) pts.push([gland[0] + 0.5 + i * 0.25, -3.3 - (i % 2) * 0.5, 0.5])
            pts.push([c[0], c[1] + 1.2, 0.5], c)
            cableRun(wires, [oled.pin('SCL'), [-10.2, -1.9, 0.6]], CLK_COLOR, 0.07)
            cableRun(wires, pts, '#3a3f4a', 0.14)
          }
          cableTag.set(T.inside ? '' : `${fixedText(q.cable, 2)} m cable · +${pf(WX_KIT.cablePfPerM * q.cable * 1e-12)}`, GREY)
          boxTag.set(`box air ${celsiusText(T.boxC, 1)}`, HEAT)
          airTag.set(`outside air ${celsiusText(WX_KIT.airC, 1)}`, LABEL)
          vih.set(yOf(b.clk.vih))
          const bad = b.state === 'fail'
          okTag.set(b.clk.toHigh === Infinity ? 'NEVER REACHES HIGH' : b.state === 'ok' ? `HIGH after ${secs(b.clk.toHigh)}` : bad ? `TOO LATE: HIGH after ${secs(b.clk.toHigh)}` : `out of spec: rise ${secs(b.tr)}`, bad ? HIGH_V : b.state === 'ok' ? POWER : HEAT)
          scTag.set(`SCL at ${MODES[q.mode]} · ${ohms(b.ohms)} · ${pf(b.farads)}`, LABEL)
          code([
            'Wire.begin(21, 22);  // SDA, SCL',
            `Wire.setClock(${b.hz});`,
            b.found.length ? `// scan: ${b.found.map((a) => hex(a)).join(' ')} answer` : '// scan: no device found',
            b.found.length ? `bmp.readTemperature();  // ${celsiusText(T.readC, 1)}` : 'bmp.begin(0x76);  // false: sensor not found',
          ])
          sub.set(T.inside ? 'BMP280 on the breadboard, inside the sealed box' : `BMP280 outside in a radiation shield, ${fixedText(q.cable, 2)} m of cable`, GREY)
          event.set(
            bad ? `bus dead: the clock never makes a clean HIGH at ${MODES[q.mode]}; slow it down or stiffen the pull-ups` : T.inside ? `reads ${celsiusText(T.readC, 1)} with ${WX_KIT.airC} °C outside: it is measuring the box` : b.state === 'late' ? 'works on the bench, out of spec: expect errors on a cold night' : `reads the air: ${celsiusText(T.readC, 1)}`,
            bad ? HIGH_V : T.inside || b.state === 'late' ? HEAT : POWER,
          )
        }
        const period = 1 / b.hz
        st.t = (st.t + dt / SCL_SLOW_S) % 2
        const win = 2 * period
        ideal.draw((u) => yOf((frac((u * win) / period) < 0.5 ? 1 : 0) * GPIO_VDD), null)
        const head = st.t / 2
        real.draw((u) => yOf(b.clk.level(Math.min(u, head) * win)), head)
        waves.step(dt, 0.8)
        const reading = b.state !== 'fail' && frac(st.t) < 0.5
        ;(T.inside ? bmpIn : bmpOut).chip(POWER, reading ? 0.9 : 0)
        ;(T.inside ? bmpIn : bmpOut).led(1)
        setGlow(screen, '#7fd8ff', b.state !== 'fail' ? 0.5 : 0.15)
        oledText.set(b.state !== 'fail' ? `${fixedText(T.readC, 1)}°C` : 'no sensor', b.state !== 'fail' ? '#0b1013' : HIGH_V)
        status.set(`Bench: BMP280 + OLED on I²C`, LABEL)
      },
      readouts: (p) => {
        const q = wsParams(p)
        const b = wxBus(q.cable, q.pullup, q.mode)
        const T = wxSensorC(q.cable)
        return [
          { label: 'Temperature read', value: b.state === 'fail' ? 'no reading' : `${celsiusText(T.readC, 1)} (air ${WX_KIT.airC} °C)`, tone: T.inside || b.state === 'fail' ? 'bad' : 'ok' },
          { label: 'Rise time', value: `${secs(b.tr)} / ${secs(b.trMax)} max`, tone: b.state === 'ok' ? 'ok' : b.state === 'late' ? 'warn' : 'bad' },
          { label: 'Longest cable in spec', value: b.maxCableM > 0 ? `${fixedText(b.maxCableM, 1)} m` : 'none', tone: toneOf(q.cable <= b.maxCableM, b.state !== 'fail') },
          { label: 'Bus scan', value: b.found.length ? b.found.map((a) => hex(a)).join(' ') : 'nothing answers', tone: b.found.length ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- Send over Wi-Fi: a week on an 18650 (+ solar); wake, read, send, sleep; the dashboard reduces to sea level and flags a storm. ---

const EVERY = { '60': '1 min', '600': '10 min', '3600': '1 h' }
const RADIOS: Record<NodeRadio, string> = { wifi: 'Wi-Fi + DHCP', static: 'Wi-Fi, static IP', espnow: 'ESP-NOW to a gateway' }
const BOARD_NAMES = namesOf(WX_BOARDS)
const SUN_NAMES = namesOf(WX_SUN)
const swParams = (p: Params) => ({
  everyS: Number(pick(EVERY, p.every, '600')),
  radio: pick(RADIOS, p.radio, 'wifi') as NodeRadio,
  board: pick(BOARD_NAMES, p.board, 'devkit') as WxBoard,
  sun: pick(SUN_NAMES, p.sun, 'none') as WxSun,
})
type SwQ = ReturnType<typeof swParams>
const swKey = (q: SwQ) => `${q.everyS}|${q.radio}|${q.board}|${q.sun}`
const swRun = memoBy(swKey, (q: SwQ) => wxWeek(q))
const WEEK_H = WX_WEEK.days * 24
const LAPSE_S = 14
const P_LO = 100_000
const P_HI = 102_400
const PP = { x: 4.6, y: -0.2, w: 14, h: 4.6 }
const BP = { x: 4.6, y: -6.9, w: 14, h: 2.6 }
const ST: V3 = [-13.2, -4.4, 0]
const SEND_CODE: Record<NodeRadio, string> = {
  wifi: 'WiFi.begin(ssid, pass);  // scan + join + DHCP',
  static: 'WiFi.config(ip, gw, mask); WiFi.begin(ssid, pass, ch, bssid);',
  espnow: 'esp_now_send(gateway, data, len);  // gateway posts it',
}

export const weatherStationSendOverWiFi: Lesson = {
  id: 'weather-station-send-over-wi-fi',
  title: 'Send over Wi-Fi',
  tagline: 'A week on one 18650: wake, read, post to a dashboard, deep sleep. The board’s idle draw and the sun decide whether it is still reporting when the storm comes',
  formula: (p) => {
    const q = swParams(p)
    const R = swRun(q)
    return `avg = ${ampText(R.avgA)} (${secs(R.awakeS)} awake per ${EVERY[String(q.everyS) as keyof typeof EVERY]}${q.board === 'devkit' ? ' + 8 mA DevKit' : ''}) · ${fixedText(R.useMahPerDay, 1)} mAh/day used vs ${fixedText(R.inMahPerDay, 0)} mAh/day from the panel · sea level = p / (1 − 0.0065·${WX_WEEK.altM} / 288.15)^5.26 · alert when Δp(3 h) < −${WX_ALERT.pa / 100} hPa`
  },
  legend: [
    { color: GREY, label: 'True sea-level pressure', shape: 'dot' },
    { color: RING, label: 'Readings on the dashboard', shape: 'dot' },
    { color: POWER, label: 'Battery charge', shape: 'dot' },
    { color: SUN_TINT, label: 'Solar charge current', shape: 'dot' },
    { color: HIGH_V, label: 'Storm alert', shape: 'dot' },
  ],
  points: [
    'The station from Wire the sensors, now on a 2600 mAh 18650 (40 % charged) with a TP4056 and an optional 1 W panel. Each wake: boot, one BMP280 forced read (×16 oversampling), send a small JSON, deep sleep (Microcontrollers › Power modes › Battery budget).',
    `The dashboard gets station pressure, which at ${WX_WEEK.altM} m is ~30 hPa below sea level. It reduces every reading to sea level with the barometric formula (Waves › Pressure & fluids › Barometer altitude), so it matches weather maps.`,
    'A falling glass is the forecast: more than 3.5 hPa down in 3 hours means a storm is coming. Hourly reports flag it up to an hour late; every 10 min is plenty. Every minute only burns battery.',
    'The DevKit\'s USB chip, power LED and AMS1117 draw ~8 mA all the time, deep sleep or not: that alone empties the cell in under a week, before the storm. A bare module with a low-Iq LDO sleeps at 15 µA.',
    'A full Wi-Fi join + DHCP keeps the radio on ~1.6 s per report (Microcontrollers › Wi-Fi & Bluetooth); a static IP with the saved channel cuts it to 0.35 s, ESP-NOW to an indoor gateway to 25 ms.',
    'Solar: a 1 W panel gives ~0.5 Ah a day in summer, a fifth of that in winter, less under the storm\'s cloud (Power › Charging). It hides a DevKit in summer, not in winter.',
  ],
  controls: [
    { kind: 'choice', key: 'every', options: opts(EVERY), initial: '600' },
    { kind: 'choice', key: 'radio', options: opts(RADIOS), initial: 'wifi' },
    { kind: 'choice', key: 'board', options: opts(BOARD_NAMES), initial: 'devkit' },
    { kind: 'choice', key: 'sun', options: opts(SUN_NAMES), initial: 'none' },
  ],
  build(): Stage {
    const { scene, status, sub, event } = headerStage()
    const metal = mat('#9aa0aa', { metal: 0.5, rough: 0.4 })
    stretchRod(addRod(scene, metal), [ST[0], -10, -0.6], [ST[0], -0.4, -0.6], 0.18)
    stationBox(scene, ST, 3.4, 2.6, 1.4)
    esp32Board(scene, [ST[0] + 0.3, ST[1] + 0.3, 0], 0.16)
    const cellG = add(scene, new THREE.Group(), [ST[0] - 1.1, ST[1] - 0.3, 0.2])
    cell18650(cellG, [0, 0, 0], 0.3).rotation.z = Math.PI / 2
    radiationShield(scene, [ST[0] + 3.2, ST[1] - 2.4, 0], 2.2).scale.setScalar(0.7)
    stretchRod(addRod(scene, metal), [ST[0], ST[1] - 2.4, -0.6], [ST[0] + 3.2, ST[1] - 2.4, -0.6], 0.1)
    const panel = add(scene, new THREE.Group(), [ST[0], ST[1] + 3.2, 0])
    panel.rotation.x = -0.6
    box(panel, [4.4, 2.6, 0.15], mat('#c9ccd2', { metal: 0.4 }), [0, 0, -0.1])
    const cells = new THREE.MeshStandardMaterial({ color: '#1a2d6b', roughness: 0.3, emissive: SUN_TINT, emissiveIntensity: 0 })
    box(panel, [4.1, 2.3, 0.1], cells, [0, 0, 0])
    for (let i = 1; i < 4; i++) box(panel, [0.05, 2.3, 0.12], mat('#c9ccd2'), [-2.05 + i * 1.025, 0, 0.02])
    const sunDot = glowDot(scene, 0.6, SUN_TINT, 1.6)
    sunDot.position.set(ST[0] + 3.6, ST[1] + 4.6, 0.5)
    const router = routerModel(scene, [-6.2, -8.2, 0], 0.5)
    const rip = ripples(scene, [ST[0] + 1.7, ST[1] + 0.9, 0.8], { reach: 1.6, period: 0.8 })
    const cellTag = liveLabel(scene, [ST[0] - 2.2, ST[1] - 0.3, 0.4], { size: 0.3, align: 'right' })

    const pplot = scope(scene, PP.w, PP.h, { divs: [7, 4], zeroAt: 0 })
    pplot.group.position.set(PP.x, PP.y, 0)
    const truth = pplot.trace(GREY, { samples: 240, radius: 0.04 })
    const reads = pplot.trace(RING, { samples: 400, radius: 0.07 })
    const alertMark = addRod(pplot.group, glowMat(HIGH_V, 1))
    const alertTag = liveLabel(pplot.group, [0, PP.h / 2 + 0.5, 0.2], { size: 0.26 })
    addLabel(scene, 'Dashboard: sea-level pressure', [PP.x - PP.w / 2, PP.y + PP.h / 2 + 0.9, 0.3], LABEL, 0.3, 'left')
    const nowTag = liveLabel(scene, [PP.x + PP.w / 2, PP.y + PP.h / 2 + 0.9, 0.3], { size: 0.28, align: 'right' })
    addLabel(scene, `${P_HI / 100}`, [PP.x - PP.w / 2 - 0.4, PP.y + PP.h / 2, 0.3], GREY, 0.24, 'right')
    addLabel(scene, `${P_LO / 100} hPa`, [PP.x - PP.w / 2 - 0.4, PP.y - PP.h / 2, 0.3], GREY, 0.24, 'right')
    const bplot = scope(scene, BP.w, BP.h, { divs: [7, 2], zeroAt: 0 })
    bplot.group.position.set(BP.x, BP.y, 0)
    const socTr = bplot.trace(POWER, { samples: 240, radius: 0.06 })
    const sunTr = bplot.trace(SUN_TINT, { samples: 240, radius: 0.035 })
    addLabel(scene, '100 %', [BP.x - BP.w / 2 - 0.4, BP.y + BP.h / 2, 0.3], GREY, 0.22, 'right')
    addLabel(scene, '0', [BP.x - BP.w / 2 - 0.4, BP.y - BP.h / 2, 0.3], GREY, 0.22, 'right')
    addLabel(scene, 'Battery charge · solar current (0–200 mA)', [BP.x - BP.w / 2, BP.y + BP.h / 2 + 0.9, 0.3], LABEL, 0.3, 'left')
    for (let d = 0; d < WX_WEEK.days; d++) addLabel(scene, `day ${d + 1}`, [BP.x - BP.w / 2 + ((d + 0.5) / WX_WEEK.days) * BP.w, BP.y - BP.h / 2 - 0.7, 0.3], GREY, 0.22)
    const code = codeBlock(scene, [-17.2, 3.7, 0.3], 0.22, 4)
    const pY = (pa: number) => ((pa - P_LO) / (P_HI - P_LO)) * PP.h - PP.h / 2
    const st = { key: '', t: 0 }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = swParams(p)
        const R = swRun(q)
        const key = swKey(q)
        if (key !== st.key) {
          Object.assign(st, { key, t: 0 })
          truth.draw((u) => pY(wxSeaPa(u * WEEK_H)), null)
        }
        st.t = (st.t + dt) % (LAPSE_S + 2)
        const tH = Math.min(1, st.t / LAPSE_S) * WEEK_H
        const s = fixedStepAt(R.samples, tH, WX_WEEK.dt)
        const shown = R.reports.filter((r) => r.t <= tH)
        const stride = Math.max(1, Math.ceil(shown.length / 400))
        const pick1 = shown.filter((_, i) => i % stride === 0 || i === shown.length - 1)
        reads.group.visible = pick1.length >= 2
        if (pick1.length >= 2) reads.points(pick1.map((r) => r.t / WEEK_H), pick1.map((r) => pY(r.seaPa)))
        const sCut = R.samples.filter((x) => x.t <= tH)
        const sStride = Math.max(1, Math.ceil(sCut.length / 240))
        const sPick = sCut.filter((_, i) => i % sStride === 0 || i === sCut.length - 1)
        socTr.points(sPick.map((x) => x.t / WEEK_H), sPick.map((x) => (x.soc - 0.5) * BP.h))
        sunTr.points(sPick.map((x) => x.t / WEEK_H), sPick.map((x) => Math.min(1, x.chargeA / 0.2) * BP.h - BP.h / 2), null)
        const alerted = R.alertH !== null && R.alertH <= tH
        alertMark.visible = alerted
        if (alerted) {
          const x = -PP.w / 2 + (R.alertH! / WEEK_H) * PP.w
          stretchRod(alertMark, [x, -PP.h / 2, 0.15], [x, PP.h / 2, 0.15], 0.06)
          alertTag.group.position.x = x
        }
        alertTag.set(alerted ? 'storm alert' : '', HIGH_V)
        const last = shown[shown.length - 1]
        nowTag.set(s.alive && last ? `${fixedText(last.seaPa / 100, 1)} hPa · ${celsiusText(last.airC, 1)}` : 'no data', s.alive ? RING : HIGH_V)
        const sun = wxSunAt(q.sun, tH)
        const day = WX_SUN[q.sun]
        presence(sunDot, day.panelW > 0 ? Math.min(1, 0.3 + 1.4 * sun) * (sun > 0 ? 1 : 0) : 0)
        cells.emissiveIntensity = 0.5 * sun
        panel.visible = day.panelW > 0
        rip(st.t, DATA_COLOR, s.alive ? 0.8 : 0)
        router.led(0, s.alive ? POWER : GREY, s.alive ? 0.4 + 0.6 * frac(st.t * 3) : 0)
        cellTag.set(pct(s.soc), s.soc > 0.25 ? POWER : s.soc > 0.08 ? RING : HIGH_V)
        code([
          'bmp.takeForcedMeasurement();  // ×16, 41 ms',
          SEND_CODE[q.radio],
          `http.POST(${wxJson(last?.seaPa ?? 101_325, last?.airC ?? 10, 3.6 + 0.6 * s.soc)});`,
          `esp_deep_sleep(${q.everyS}e6);  // ${EVERY[String(q.everyS) as keyof typeof EVERY]}`,
        ])
        status.set(`${dayClock(tH)} · ${s.alive ? 'reporting' : 'battery flat'}`, s.alive ? LABEL : HIGH_V)
        sub.set(`7 days in ${LAPSE_S} s (${Math.round((WEEK_H * 3600) / LAPSE_S).toLocaleString('en')}× faster) · ${RADIOS[q.radio]} every ${EVERY[String(q.everyS) as keyof typeof EVERY]}`, GREY)
        const front = tH > WX_WEEK.frontH
        if (!s.alive) event.set(`battery flat on ${dayClock(R.emptyH!)}: the dashboard goes dark${R.alertH === null ? ' and misses the storm' : ''}`, HIGH_V)
        else if (alerted) event.set(`storm alert: ${fixedText(-(R.reports.find((r) => r.t === R.alertH)?.tend ?? 0) / 100, 1)} hPa down in 3 h, ${hoursText(R.alertH! - R.trueAlertH!)} after the real fall passed 3.5`, HIGH_V)
        else if (front) event.set('the front is coming: pressure starts to fall', HEAT)
        else event.set(`${fixedText(R.useMahPerDay, 0)} mAh a day out, ${fixedText(R.inMahPerDay, 0)} in from the sun`, R.inMahPerDay >= R.useMahPerDay ? POWER : GREY)
      },
      readouts: (p) => {
        const q = swParams(p)
        const R = swRun(q)
        return [
          { label: 'Average draw', value: `${ampText(R.avgA)} · ${secs(R.awakeS)} awake`, tone: toneOf(R.avgA < 1e-3, R.avgA < 5e-3) },
          { label: 'Per day out / in', value: `${fixedText(R.useMahPerDay, 0)} / ${fixedText(R.inMahPerDay, 0)} mAh`, tone: R.inMahPerDay >= R.useMahPerDay ? 'ok' : R.emptyH === null ? 'warn' : 'bad' },
          { label: 'Battery after 7 days', value: R.emptyH === null ? pct(R.socEnd) : `flat on day ${Math.floor(R.emptyH / 24) + 1}`, tone: R.emptyH !== null ? 'bad' : toneOf(R.socEnd >= WX_WEEK.soc0, R.socEnd > 0.15) },
          { label: 'Storm alert', value: R.alertH === null ? 'missed' : `${hoursText(R.alertH - R.trueAlertH!)} late · ${bytesText(wxReportBytes(q.radio))} a report`, tone: R.alertH === null ? 'bad' : toneOf(R.alertH - R.trueAlertH! < 0.5, true) },
        ]
      },
    }
  },
}
