import * as THREE from 'three/webgpu'
import {
  NTC,
  OW,
  OW_CMD,
  THERMAL,
  betaBetween,
  degPerCount,
  ds18C,
  ds18ConvMs,
  ds18Raw,
  ntcOhms,
  ntcReading,
  ntcWatts,
  owBytes,
  owPulling,
  owReadAllUs,
  owReset,
  rcStep,
  romId,
  selfHeatedC,
  thermalTau,
} from '../../core/physics'
import type { Medium, NtcMethod, OwFrame } from '../../core/physics'
import { hexByte, ohms, watts } from '../../core/units'
import { STEEL, V3, add, cylinder, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  CODE_LEGEND,
  DATA_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  PIN_COLOR,
  POWER,
  RING,
  addLabel,
  captureScreen,
  codeBlock,
  esp32Board,
  flatBox,
  glide,
  glowMat,
  junction,
  liveLabel,
  memoBy,
  swapResistor,
  resistorAlong,
  scope,
  litWire,
  thermistorAlong,
  transistorPart,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'

const textLines = (scene: THREE.Scene, T0: V3) => {
  const [a, b, c] = [0, 1, 2].map((i) => liveLabel(scene, [T0[0], T0[1] - i * 1.2, 0], { size: 0.5, align: 'left' }))
  const status = liveLabel(scene, [T0[0], T0[1] - 3.7, 0], { size: 0.38, align: 'left' })
  return { a, b, c, status }
}
const degC = (t: number, d = 1) => `${t < 0 ? '−' : ''}${Math.abs(t).toFixed(d)} °C`
const signed = (t: number, d = 2) => `${t < 0 ? '−' : '+'}${Math.abs(t).toFixed(d)} °C`
const secsText = (s: number) => `${s < 10 ? s.toFixed(1) : Math.round(s)} s`

// --- Thermistor curve: ADC count → ohms → °C by Beta, Steinhart–Hart or table; self-heating; bead vs probe lag. ---

const METHODS: Record<NtcMethod, string> = { beta: 'Beta 3950', sh: 'Steinhart–Hart', table: 'Table / 10 °C' }
const FIXED = { '1k': 1e3, '10k': 10e3, '100k': 100e3 }
const MEDIA: Record<Medium, string> = { still: 'Still air', air: 'Moving air', water: 'Stirred water' }
const RANGE = { lo: -20, hi: 120, errMax: 2, room: 20, samples: 141, scroll: 8 }
const OK_ERR = 0.5
const HOT = new THREE.Color(HEAT)
const B85 = betaBetween(25, 85)

function curveSetup(p: Params) {
  const t = n(p, 'temp')
  const method = pick(METHODS, p.method, 'beta')
  const rKey = pick(FIXED, p.rfix, '10k')
  const rf = FIXED[rKey]
  const medium = pick(MEDIA, p.medium, 'still')
  const delta = THERMAL.bead.delta[medium]
  const r = ntcReading(t, rf, method, delta)
  const fit = ntcReading(t, rf, method)
  const amps = 3.3 / (ntcOhms(t + r.selfHeat) + rf)
  return { t, method, rKey, rf, medium, delta, r, fitErr: fit.error, lsb: degPerCount(t, rf), amps, watts: ntcWatts(ntcOhms(t + r.selfHeat), rf), tauBead: thermalTau('bead', medium), tauProbe: thermalTau('probe', medium) }
}
type CurveSetup = ReturnType<typeof curveSetup>

const errCurves = memoBy(
  (S: CurveSetup) => `${S.method}|${S.rKey}|${S.medium}`,
  (S: CurveSetup) => {
    const ts = Array.from({ length: RANGE.samples }, (_, i) => RANGE.lo + ((RANGE.hi - RANGE.lo) * i) / (RANGE.samples - 1))
    return { fit: ts.map((t) => ntcReading(t, S.rf, S.method).error), total: ts.map((t) => ntcReading(t, S.rf, S.method, S.delta).error) }
  },
)

const errTone = (e: number) => (Math.abs(e) > 1 ? 'bad' : Math.abs(e) > OK_ERR ? 'warn' : 'ok')
const toneColor = { ok: POWER, warn: HEAT, bad: HIGH_V }

function curveCode(S: CurveSetup) {
  const rf = S.rf.toFixed(0)
  if (S.method === 'table') return ['int raw = analogRead(34);', '// LUT[i] = raw count at -40, -30 … 150 °C', 'float t = -40 + 10 * lerpIndex(LUT, raw);']
  const r = `float r = ${rf}.0 * raw / (4095 - raw);`
  if (S.method === 'sh') return [r, 'float L = log(r);', 'float t = 1 / (A + B*L + C*L*L*L) - 273.15;']
  return [r, `float t = 1 / (1/298.15 + log(r/${NTC.r25})/${Math.round(B85)})`, '          - 273.15;']
}

export const thermistorCurve: Lesson = {
  id: 'temperature-humidity-thermistor-curve',
  title: 'Thermistor curve',
  tagline: 'An NTC is a steep, curved resistor: the ADC count must be turned back into °C, the divider current warms it, and a bead lags less than a probe',
  formula: (p) => {
    const S = curveSetup(p)
    const conv =
      S.method === 'beta'
        ? `1/T = 1/298.15 + ln(R/10 kΩ)/${Math.round(B85)}`
        : S.method === 'sh'
          ? '1/T = A + B·lnR + C·ln³R (fit at 0, 25, 85 °C)'
          : 'interpolate raw between 10 °C rows'
    return `R = ${ohms(S.rf)} × raw / (4095 − raw) = ${ohms(S.rf)} × ${S.r.raw} / ${4095 - S.r.raw} = ${ohms(S.r.ohms)} · ${conv} → ${degC(S.r.read, 2)} · self-heat = I²R / δ = ${watts(S.watts)} / ${(S.delta * 1e3).toFixed(1)} mW/K = ${signed(S.r.selfHeat)}`
  },
  legend: [
    { color: B_FIELD, label: 'Error of the conversion + ADC', shape: 'dot' },
    { color: HEAT, label: '… plus self-heating', shape: 'dot' },
    { color: RING, label: 'Step: bath grey, bead yellow, probe cyan', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'The NTC is the one from Resistance › Temperature effects and Voltage divider › Divider as a sensor input: 10 kΩ at 25 °C, about 98 kΩ at −20 °C and 390 Ω at 120 °C. The ESP32 reads a count; firmware turns it back into ohms, then °C.',
    'The datasheet "B = 3950" is a chord between 25 and 85 °C: exact there, over 1 °C off at −20 or 120 °C. Steinhart–Hart fits three calibration points and stays within a few tenths. A table of counts every 10 °C, interpolated, is exact at its rows and cheap on an MCU.',
    'Pick the fixed resistor near the NTC at the temperatures you care about: 100 kΩ starves the hot end (1 °C per count), 1 kΩ pushes milliamps through the bead. That current heats it: ΔT = I²R / δ, with δ ≈ 1.5 mW/K in still air, so 1 mW reads 0.7 °C high. Moving air or water carries the heat away.',
    'The sensor also has to reach the temperature. A 2.4 mm bead has τ ≈ 10 s in still air and 1 s in water; a DS18B20 in a 6 mm steel probe takes ~100 s in still air. After τ it has 63 % of a step, after 5τ 99 %: fast loops need small sensors in moving media.',
  ],
  controls: [
    { kind: 'slider', key: 'temp', label: 'Temperature', min: RANGE.lo, max: RANGE.hi, initial: 60, step: 1, format: (v) => degC(v, 0) },
    { kind: 'choice', key: 'method', options: (Object.keys(METHODS) as NtcMethod[]).map((k) => ({ value: k, label: METHODS[k] })), initial: 'beta' },
    { kind: 'choice', key: 'rfix', options: (Object.keys(FIXED) as (keyof typeof FIXED)[]).map((k) => ({ value: k, label: `Fixed ${ohms(FIXED[k])}` })), initial: '10k' },
    { kind: 'choice', key: 'medium', options: (Object.keys(MEDIA) as Medium[]).map((k) => ({ value: k, label: MEDIA[k] })), initial: 'still' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const k = 0.55
    const espAt: V3 = [-14, -2, 0]
    const pin = esp32Board(scene, espAt, k)
    const vcc = pin(3, true)
    const adc = pin(5, true)
    const gnd = pin(-5, true)
    const X = -5
    const top: V3 = [X, 4.4, 0]
    const tap: V3 = [X, 1.2, 0]
    wire(scene, [vcc, [vcc[0], top[1], 0], top], 0.14)
    const rHolder = add(scene, new THREE.Group())
    wire(scene, [top, [X, 3.8, 0]], 0.14)
    wire(scene, [[X, 2, 0], tap], 0.14)
    wire(scene, [adc, [adc[0], tap[1], 0], tap], 0.14)
    junction(scene, tap, 0.28)
    addLabel(scene, '3V3', [vcc[0] - 0.9, top[1] + 0.6, 0], GREY, 0.4)
    addLabel(scene, 'GPIO34', [adc[0] + 2.2, tap[1] + 0.6, 0], PIN_COLOR, 0.4)
    const rTag = liveLabel(scene, [X - 1.9, 2.9, 0], { size: 0.45, color: LABEL })
    const BEAKER: V3 = [-3, -5.6, 0]
    const beadA: V3 = [X - 0.9, -6.4, 0]
    const beadB: V3 = [X + 0.9, -6.4, 0]
    wire(scene, [tap, [X - 0.9, tap[1], 0], beadA], 0.1)
    wire(scene, [beadB, [X + 0.9, -9.4, 0], [gnd[0], -9.4, 0], [gnd[0], gnd[1] - 10 * k, 0]], 0.1)
    addLabel(scene, 'GND', [gnd[0] - 0.9, -9.4, 0], GREY, 0.4)
    const bead = thermistorAlong(scene, beadA, beadB, 0.9)
    addLabel(scene, 'NTC bead', [X, -7.6, 0.8], RING, 0.42)

    const probeAt: V3 = [-1, -5.4, 0]
    cylinder(scene, 0.42, 4.2, STEEL(), probeAt)
    add(scene, mesh(new THREE.SphereGeometry(0.42, 16, 10), STEEL()), [probeAt[0], probeAt[1] - 2.1, 0])
    wire(scene, [[probeAt[0], probeAt[1] + 2.1, 0], [probeAt[0], 1.6, 0]], 0.2)
    addLabel(scene, 'DS18B20 probe', [probeAt[0] + 0.4, 2.3, 0], PIN_COLOR, 0.42)

    const glass = new THREE.MeshStandardMaterial({ color: '#e8eef8', transparent: true, opacity: 0.08, roughness: 0.05, depthWrite: false })
    const beaker = cylinder(scene, 3.4, 6.4, glass, BEAKER, 'y', 32)
    beaker.castShadow = false
    const waterMat = new THREE.MeshStandardMaterial({ color: LOW_V, transparent: true, opacity: 0.35, emissive: LOW_V, emissiveIntensity: 0.2, depthWrite: false })
    const water = cylinder(scene, 3.25, 4.6, waterMat, [BEAKER[0], BEAKER[1] - 0.8, 0], 'y', 32)
    water.castShadow = false
    const airMat = glowMat(B_FIELD, 0.6)
    const streaks = Array.from({ length: 6 }, (_, i) => {
      const m = add(scene, mesh(new THREE.BoxGeometry(1.4, 0.08, 0.08), airMat), [0, BEAKER[1] - 2.4 + i * 0.9, 1.2])
      m.castShadow = false
      return m
    })
    const bathTag = liveLabel(scene, [BEAKER[0], BEAKER[1] - 4.3, 0], { size: 0.45 })

    const EP: V3 = [10.5, 5, 0]
    const ew = 16
    const eh = 6.4
    const err = scope(scene, ew, eh, { divs: [7, 4] })
    err.group.position.set(...EP)
    const fitTr = err.trace(B_FIELD, { samples: RANGE.samples, radius: 0.08 })
    const totTr = err.trace(HEAT, { samples: RANGE.samples, radius: 0.1 })
    const eY = (e: number) => (e / RANGE.errMax) * (eh / 2)
    for (const s of [-1, 1]) err.level(POWER).set(eY(s * OK_ERR))
    addLabel(scene, 'reading error vs temperature', [EP[0], EP[1] + eh / 2 + 1.1, 0], LABEL, 0.45)
    addLabel(scene, '−20 °C', [EP[0] - ew / 2, EP[1] - eh / 2 - 1, 0], GREY, 0.38)
    addLabel(scene, '120 °C', [EP[0] + ew / 2, EP[1] - eh / 2 - 1, 0], GREY, 0.38)
    addLabel(scene, '+2 °C', [EP[0] + ew / 2 + 1.6, EP[1] + eh / 2, 0], GREY, 0.38)
    addLabel(scene, '−2 °C', [EP[0] + ew / 2 + 1.6, EP[1] - eh / 2, 0], GREY, 0.38)
    addLabel(scene, '±0.5', [EP[0] + ew / 2 + 1.6, EP[1] + eY(OK_ERR), 0], POWER, 0.38)

    const SP: V3 = [10.5, -6, 0]
    const step = scope(scene, ew, eh, { divs: [6, 4] })
    step.group.position.set(...SP)
    const HIST = 200
    const tracks = [GREY, RING, PIN_COLOR].map((c, i) => step.trace(c, { samples: HIST, radius: i ? 0.1 : 0.07 }))
    addLabel(scene, 'bath steps · bead · probe', [SP[0], SP[1] + eh / 2 + 1.1, 0], LABEL, 0.45)
    const stepTag = liveLabel(scene, [SP[0], SP[1] - eh / 2 - 1, 0], { size: 0.38, color: GREY })
    const code = codeBlock(scene, [-19, -11.4, 0], 0.4, 3)
    const text = textLines(scene, [-19, 9.8, 0])

    const s = { key: '', curveKey: '', sim: 0, acc: 0, hist: [[], [], []] as number[][], bead: RANGE.room, probe: RANGE.room, warm: 0.5, flow: 0 }
    return {
      scene,
      view: { center: [0, -0.8, 0], radius: 72, polar: 1.3, azimuth: 0 },
      frame(dt, p) {
        const S = curveSetup(p)
        const half = 3 * S.tauProbe
        const window = 2 * half
        const speed = window / RANGE.scroll
        const slot = window / (HIST - 1)
        const bath = (t: number) => (Math.floor(t / half) % 2 ? RANGE.room : S.t)
        const key = `${S.t}|${S.method}|${S.rKey}|${S.medium}`
        if (key !== s.key) {
          if (s.curveKey !== `${S.method}|${S.rKey}|${S.medium}`) {
            s.curveKey = `${S.method}|${S.rKey}|${S.medium}`
            const c = errCurves(S)
            fitTr.draw((u) => eY(c.fit[Math.round(u * (RANGE.samples - 1))]), null)
            totTr.draw((u) => eY(c.total[Math.round(u * (RANGE.samples - 1))]), null)
            swapResistor(rHolder, S.rf, [X, 3.8, 0], [X, 2, 0], 1.1)
          }
          totTr.draw((u) => eY(errCurves(S).total[Math.round(u * (RANGE.samples - 1))]), (S.t - RANGE.lo) / (RANGE.hi - RANGE.lo))
          Object.assign(s, { key, sim: 0, acc: 0, bead: RANGE.room, probe: RANGE.room })
          s.hist = [0, 1, 2].map(() => Array<number>(HIST).fill(RANGE.room))
          code(curveCode(S))
        }
        s.acc += dt * speed
        while (s.acc >= slot) {
          s.acc -= slot
          s.sim += slot
          const b = bath(s.sim)
          s.bead = rcStep(s.bead, selfHeatedC(b, S.rf, S.delta), S.tauBead, slot)
          s.probe = rcStep(s.probe, b, S.tauProbe, slot)
          ;[b, s.bead, s.probe].forEach((v, i) => {
            s.hist[i].shift()
            s.hist[i].push(v)
          })
        }
        const lo = Math.min(RANGE.room, S.t) - 6
        const hi = Math.max(RANGE.room, S.t) + 6
        const yOf = (v: number) => ((v - lo) / (hi - lo) - 0.5) * eh
        tracks.forEach((tr, i) => tr.draw((u) => yOf(s.hist[i][Math.round(u * (HIST - 1))]), i ? 1 : null))

        const b = bath(s.sim)
        const hot = Math.max(0, (b - RANGE.room) / (RANGE.hi - RANGE.room))
        water.visible = S.medium === 'water'
        waterMat.color.set(LOW_V).lerp(HOT, hot)
        waterMat.emissive.copy(waterMat.color)
        s.flow += dt
        streaks.forEach((m, i) => {
          m.visible = S.medium === 'air'
          m.position.x = BEAKER[0] - 3.6 + ((s.flow * 4 + i * 1.7) % 7.2)
        })
        s.warm = glide(dt, s.warm, (s.bead - RANGE.lo) / (RANGE.hi - RANGE.lo))
        bead.set(s.warm)
        bathTag.set(`${MEDIA[S.medium].toLowerCase()} · ${degC(b, 0)}`, b > RANGE.room ? HEAT : B_FIELD)
        rTag.set(ohms(S.rf), LABEL)

        const tone = errTone(S.r.error)
        const fitTone = errTone(S.fitErr)
        text.a.set(
          Math.abs(S.r.selfHeat) > OK_ERR
            ? 'The divider current is heating the bead'
            : S.lsb >= OK_ERR / 2
              ? 'Too coarse here: the count barely moves'
              : fitTone !== 'ok'
                ? `${METHODS[S.method]} misses the real curve here`
                : 'Conversion, ADC and self-heating all small',
          toneColor[tone],
        )
        text.b.set(`raw ${S.r.raw} → ${ohms(S.r.ohms)} → ${degC(S.r.read, 2)} (true ${degC(S.t, 0)})`, toneColor[tone])
        text.c.set(`${(S.amps * 1e3).toFixed(2)} mA × ${ohms(ntcOhms(S.t + S.r.selfHeat))} → ${watts(S.watts)} → ${signed(S.r.selfHeat)}`, Math.abs(S.r.selfHeat) > OK_ERR ? HIGH_V : LABEL)
        text.status.set(`1 count = ${S.lsb.toFixed(S.lsb < 0.1 ? 3 : 2)} °C here · bath ${degC(RANGE.room, 0)} / ${degC(S.t, 0)}, steps every ${secsText(half)}`, GREY)
        stepTag.set(`sim ${secsText(s.sim)} · time ×${speed.toFixed(speed < 10 ? 1 : 0)} · τ bead ${secsText(S.tauBead)}, probe ${secsText(S.tauProbe)}`)
      },
      readouts: (p) => {
        const S = curveSetup(p)
        return [
          { label: 'Reading', value: degC(S.r.read, 2), tone: errTone(S.r.error) },
          { label: 'Curve + ADC error', value: signed(S.fitErr), tone: errTone(S.fitErr) },
          { label: 'Self-heating', value: signed(S.r.selfHeat), tone: errTone(S.r.selfHeat) },
          { label: 'τ bead · probe', value: `${secsText(S.tauBead)} · ${secsText(S.tauProbe)}`, tone: S.tauProbe > 30 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- One-wire protocol: reset/presence, write/read slots, ROM IDs, 750 ms conversion, several DS18B20 on one pin. ---

const PROBES = [
  { serial: [0xa2, 0x17, 0x5c, 0x0b, 0x00, 0x00], tC: 23.5625, name: 'motor' },
  { serial: [0x3f, 0xc1, 0x60, 0x0b, 0x00, 0x00], tC: 41.25, name: 'battery' },
  { serial: [0x09, 0x8e, 0x5d, 0x0b, 0x00, 0x00], tC: -6.4375, name: 'outside' },
]
const ROMS = PROBES.map((p) => romId(p.serial))
const romText = (rom: number[]) => rom.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
const SENSOR_COUNTS = { '1': '1 sensor', '2': '2 sensors', '3': '3 sensors' }
const RESOLUTIONS = { '9': '9-bit', '10': '10-bit', '11': '11-bit', '12': '12-bit' }
const DWELL = 2.6

type Seg = { u0: number; u1: number; text: string; color: string }
type OwStep = { title: string; tag: string; frame: OwFrame; sensor: number | null; segs: Seg[]; code: string[] }

const bitSegs = (f: OwFrame): Seg[] => f.bits.map((b) => ({ u0: b.t0 / f.len, u1: b.t1 / f.len, text: String(b.bit), color: b.read ? DATA_COLOR : POWER }))
const byteSegs = (f: OwFrame, bytes: number[], color: string): Seg[] => bytes.map((b, i) => ({ u0: i / bytes.length, u1: (i + 1) / bytes.length, text: hexByte(b).slice(2), color }))

function owSetup(p: Params) {
  const count = Number(pick(SENSOR_COUNTS, p.sensors, '3'))
  const bits = Number(pick(RESOLUTIONS, p.bits, '12'))
  const convMs = ds18ConvMs(bits)
  const raws = PROBES.slice(0, count).map((s) => ds18Raw(s.tC, bits))
  const busMs = owReadAllUs(count) / 1000
  return { count, bits, convMs, raws, busMs, cycleMs: convMs + busMs }
}
type OwSetup = ReturnType<typeof owSetup>

const REQ = ['sensors.requestTemperatures();', '// reset, CC, 44, then wait']
const getLine = (i: number) => [`float t${i} = sensors.getTempC(rom[${i}]);`, '// reset, 55 + ROM, BE, 2 bytes']

const owSteps = memoBy(
  (S: OwSetup) => `${S.count}|${S.bits}`,
  (S: OwSetup): OwStep[] => {
    const reset = owReset()
    const resetSegs: Seg[] = [
      { u0: 0, u1: OW.reset / OW.frame, text: 'RESET 480 µs', color: POWER },
      { u0: (OW.reset + OW.wait) / OW.frame, u1: (OW.reset + OW.wait + OW.presence) / OW.frame, text: 'PRESENCE', color: PIN_COLOR },
    ]
    const cmd = (byte: number, title: string, sensor: number | null, code: string[]): OwStep => {
      const f = owBytes([byte])
      return { title, tag: `${hexByte(byte)} = ${title.split(',')[0]}`, frame: f, sensor, segs: bitSegs(f), code }
    }
    const steps: OwStep[] = [
      { title: 'Reset: every sensor answers', tag: 'Reset + presence', frame: reset, sensor: null, segs: resetSegs, code: REQ },
      cmd(OW_CMD.skipRom, 'Skip ROM, talk to all', null, REQ),
      cmd(OW_CMD.convert, 'Convert T, all at once', null, REQ),
      {
        title: `Converting, ${S.convMs} ms at ${S.bits} bits`,
        tag: 'Bus idle: sensors measuring',
        frame: { len: S.convMs * 1000, pulls: [], bits: [] },
        sensor: null,
        segs: [{ u0: 0, u1: 1, text: `converting · ${S.convMs} ms · bus idle`, color: HEAT }],
        code: REQ,
      },
    ]
    for (let i = 0; i < S.count; i++) {
      const code = getLine(i)
      const rom = owBytes(ROMS[i])
      const data = [S.raws[i] % 256, Math.floor(S.raws[i] / 256)]
      const read = owBytes(data, true)
      steps.push(
        { title: `Reset before sensor ${i + 1}`, tag: 'Reset + presence', frame: reset, sensor: null, segs: resetSegs, code },
        cmd(OW_CMD.matchRom, 'Match ROM', i, code),
        { title: `Sending sensor ${i + 1}'s 64-bit ROM`, tag: `ROM ${romText(ROMS[i])}`, frame: rom, sensor: i, segs: byteSegs(rom, ROMS[i], POWER), code },
        cmd(OW_CMD.readScratch, 'Read scratchpad', i, code),
        { title: `Sensor ${i + 1} answers in read slots`, tag: `LSB ${hexByte(data[0])} · MSB ${hexByte(data[1])}`, frame: read, sensor: i, segs: bitSegs(read), code },
      )
    }
    return steps
  },
)

const usText = (us: number) => (us >= 1000 ? `${+(us / 1000).toFixed(us < 1e4 ? 2 : 0)} ms` : `${Math.round(us)} µs`)

export const oneWireProtocol: Lesson = {
  id: 'temperature-humidity-one-wire-protocol',
  title: 'One-wire protocol',
  tagline: 'Several DS18B20s share one data pin and a 4.7 kΩ pull-up: timed low pulses carry the bits, 64-bit ROM IDs pick the sensor',
  formula: (p) => {
    const S = owSetup(p)
    const raw = S.raws[0]
    return `T = raw / 16 = ${hexByte(Math.floor(raw / 256))}${hexByte(raw % 256).slice(2)} = ${raw >= 0x8000 ? raw - 0x10000 : raw} / 16 = ${degC(ds18C(raw), 4)} · conversion = 750 ms / 2^(12 − ${S.bits}) = ${S.convMs} ms · bus = 960 + 2×8×65 + ${S.count} × (960 + 11×8×65) µs = ${S.busMs.toFixed(1)} ms`
  },
  legend: [
    { color: PIN_COLOR, label: 'DQ line: lit = released, pulled high', shape: 'dot' },
    { color: POWER, label: 'Bits the ESP32 writes', shape: 'dot' },
    { color: DATA_COLOR, label: 'Bits a sensor answers', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'One data wire (DQ) plus VDD and GND. Every device only ever pulls DQ low (open-drain, see GPIO › Open-drain); a 4.7 kΩ pull-up brings it back high. Nobody drives it high, so the ESP32 and any sensor can share it without a fight.',
    'Time is the code. Reset: the host holds the line low 480 µs, and each sensor answers with a 60–240 µs presence pulse. In each 60 µs slot a short low (≈ 6 µs) writes 1, a long one writes 0; to read, the host taps it low and samples at ~15 µs: a sensor sending 0 is still holding it down.',
    'Each DS18B20 has a laser-trimmed 64-bit ROM: family 0x28, 48-bit serial, CRC-8. Skip ROM (0xCC) + Convert T (0x44) starts every sensor at once; Match ROM (0x55) + the 8 bytes picks one for Read Scratchpad (0xBE). Search ROM finds the IDs at start-up.',
    'Conversion takes 750 ms at 12 bits (1/16 °C), halving per bit down to 94 ms at 9 bits (0.5 °C). Don\'t block: request, do other work, read later. 85.0 °C is the power-up value: it means "never converted", not a hot sensor.',
    'DHT11/DHT22 also use one wire but not this protocol: the host pulls low 1–18 ms, the sensor then streams 40 bits (humidity, temperature, checksum) as 26 µs vs 70 µs high pulses. No addresses (one sensor per pin) and DHT22 allows one read per 2 s.',
  ],
  controls: [
    { kind: 'choice', key: 'sensors', options: Object.entries(SENSOR_COUNTS).map(([value, label]) => ({ value, label })), initial: '3' },
    { kind: 'choice', key: 'bits', options: Object.entries(RESOLUTIONS).map(([value, label]) => ({ value, label })), initial: '12' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const k = 0.55
    const pin = esp32Board(scene, [-14, -1.8, 0], k)
    const rail = { vdd: 2.2, dq: 3.5, gnd: 4.8 }
    const x1 = 17
    const vddPin = pin(6, true)
    const dqPin = pin(4, true)
    const gndPin = pin(2, true)
    const xPull = -6
    wire(scene, [vddPin, [vddPin[0], rail.vdd, 0], [x1, rail.vdd, 0]], 0.12)
    wire(scene, [gndPin, [gndPin[0], rail.gnd, 0], [x1, rail.gnd, 0]], 0.12)
    const dqPts: V3[] = [dqPin, [dqPin[0], rail.dq, 0], [x1, rail.dq, 0]]
    wire(scene, dqPts, 0.14)
    const dqGlow = litWire(scene, dqPts, 0.3)
    const dqColor = new THREE.Color(PIN_COLOR)
    addLabel(scene, 'GPIO4', [-8.6, rail.dq + 0.55, 0], PIN_COLOR, 0.38)
    addLabel(scene, '3V3', [x1 + 1.1, rail.vdd, 0], HIGH_V, 0.38)
    addLabel(scene, 'DQ', [x1 + 1.1, rail.dq, 0], PIN_COLOR, 0.38)
    addLabel(scene, 'GND', [x1 + 1.1, rail.gnd, 0], GREY, 0.38)
    resistorAlong(scene, 4700, [xPull, rail.vdd, 0.5], [xPull, rail.dq, 0.5], 0.5)
    junction(scene, [xPull, rail.vdd, 0.3], 0.16)
    junction(scene, [xPull, rail.dq, 0.3], 0.16)
    addLabel(scene, '4.7 kΩ', [xPull + 1.6, rail.vdd - 0.6, 0.5], LABEL, 0.36)

    const legsY = 6.2
    const sensors = PROBES.map((pr, i) => {
      const x = 1.5 + i * 6
      const holder = add(scene, new THREE.Group())
      const g = add(holder, new THREE.Group(), [x, legsY, 0])
      g.rotation.z = Math.PI / 2
      const part = transistorPart(g, [0, 0, 0], { scale: 1, letters: [] })
      for (const [dx, y] of [
        [-1, rail.gnd],
        [0, rail.dq],
        [1, rail.vdd],
      ]) {
        wire(holder, [[x + dx, legsY, 0.3], [x + dx, y, 0.3]], 0.08)
        junction(holder, [x + dx, y, 0.3], 0.16)
      }
      addLabel(holder, pr.name, [x + 1.4, legsY + 2.7, 0], LABEL, 0.36, 'left')
      addLabel(holder, romText(ROMS[i]).slice(0, 14) + '…', [x, rail.vdd - 0.7, 0], GREY, 0.28)
      const tag = liveLabel(holder, [x + 1.4, legsY + 1.9, 0], { size: 0.36, align: 'left' })
      return { holder, part, tag }
    })

    const rows = [
      { label: 'DQ', color: PIN_COLOR },
      { label: 'ESP32', color: POWER },
      { label: 'DS18B20', color: DATA_COLOR },
    ]
    const CAP: V3 = [5, -7.4, 0]
    const cap = captureScreen(scene, CAP, rows, { width: 19, rowH: 1.3, decoder: true })
    const ch = rows.map((_, i) => cap.channel(i, { samples: 1400, radius: 0.05 }))
    const cursor = flatBox(cap.group, [0.07, cap.height, 0.06], glowMat(RING, 0.8), [0, 0, 0.35])
    const capTag = liveLabel(scene, [CAP[0], CAP[1] + cap.height / 2 + 1, 0], { size: 0.4 })
    const spanTag = liveLabel(scene, [CAP[0], CAP[1] - cap.height / 2 - 0.9, 0], { size: 0.34, color: GREY })
    const code = codeBlock(scene, [-19, -6.2, 0], 0.34, 2)
    const text = textLines(scene, [-19, 9.8, 0])

    const s = { key: '', t: 0, idx: -1, level: 1 }
    return {
      scene,
      view: { center: [0, 0.6, 0], radius: 72, polar: 1.3, azimuth: 0 },
      frame(dt, p) {
        const S = owSetup(p)
        const steps = owSteps(S)
        const key = `${S.count}|${S.bits}`
        if (key !== s.key) Object.assign(s, { key, t: 0, idx: -1 })
        s.t += dt
        const idx = Math.floor(s.t / DWELL) % steps.length
        const st = steps[idx]
        const f = st.frame
        const u = (s.t % DWELL) / DWELL
        cursor.position.x = cap.xAt(u)
        if (idx !== s.idx) {
          s.idx = idx
          const at = (fn: (t: number) => boolean) => (v: number) => (fn(v * f.len) ? 0 : 1)
          ch[0].draw(at((t) => owPulling(f, t)), null)
          ch[1].draw(at((t) => owPulling(f, t, 'host')), null)
          ch[2].draw(at((t) => owPulling(f, t, 'sensor')), null)
          cap.annotate(st.segs)
          capTag.set(st.tag, LABEL)
          spanTag.set(`window ${usText(f.len)} · shown ${Math.round(DWELL / (f.len * 1e-6))}× slower`)
          code(st.code)
        }
        const tNow = u * f.len
        const low = owPulling(f, tNow)
        s.level = glide(dt * 3, s.level, low ? 0 : 1)
        dqGlow.set(s.level, dqColor)
        const convIdx = 3
        sensors.forEach((sn, i) => {
          const on = i < S.count
          sn.holder.visible = on
          const readIdx = convIdx + 5 + i * 5
          sn.tag.set(on ? `${idx > readIdx || (idx === readIdx && u > 0.6) ? degC(ds18C(S.raws[i]), S.bits === 12 ? 4 : S.bits === 9 ? 1 : 2) : '…'}` : '', on && st.sensor === i ? PIN_COLOR : LABEL)
          const talking = st.sensor === null || st.sensor === i
          const busy = idx === convIdx
          sn.part.set(on ? (busy ? 0.6 + 0.4 * Math.sin(s.t * 8) : talking && owPulling(f, tNow, 'sensor') ? 1 : talking ? 0.25 : 0) : 0, busy ? 0.4 : 0)
        })
        const sel = st.sensor
        text.a.set(st.title, idx === convIdx ? HEAT : sel === null ? POWER : PIN_COLOR)
        text.b.set(sel === null ? S.count > 1 ? `all ${S.count} sensors listen` : 'the sensor listens' : `only ROM ${romText(ROMS[sel])} answers`, LABEL)
        text.c.set(`line ${low ? 'pulled LOW by ' + (owPulling(f, tNow, 'host') ? 'ESP32' : 'sensor') : 'released: 4.7 kΩ pulls it HIGH'}`, low ? HIGH_V : PIN_COLOR)
        text.status.set(`step ${idx + 1} / ${steps.length} · one reading every ${S.cycleMs.toFixed(0)} ms for ${S.count} sensor${S.count > 1 ? 's' : ''}`, GREY)
      },
      readouts: (p) => {
        const S = owSetup(p)
        return [
          { label: 'Conversion', value: `${S.convMs} ms · ${(1 / 2 ** (S.bits - 8)).toString()} °C`, tone: S.convMs > 500 ? 'warn' : 'ok' },
          { label: 'Bus time', value: `${S.busMs.toFixed(1)} ms`, tone: 'ok' },
          { label: 'Update rate', value: `${(1000 / S.cycleMs).toFixed(1)} Hz`, tone: S.cycleMs > 500 ? 'warn' : 'ok' },
          { label: 'Pins used', value: `1 for ${S.count}`, tone: 'ok' },
        ]
      },
    }
  },
}
