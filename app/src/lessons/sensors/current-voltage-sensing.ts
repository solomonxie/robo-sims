import * as THREE from 'three/webgpu'
import {
  CHEMISTRIES,
  DRIVE_CYCLE,
  INA219,
  INA219_PGA,
  cycleAmps,
  ina219Cal,
  ina219Config,
  ina219Read,
  missionAmps,
  packDivider,
  regWord,
  fixedStepAt,
  shuntSense,
  socRun,
  stateAmps,
  terminalVolts,
} from '../../core/physics'
import type { ShuntSide } from '../../core/physics'
import { hexByte, hoursText, millivolts, ohms, pct, watts } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  CODE_LEGEND,
  CONVENTIONAL,
  DATA_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  PIN_COLOR,
  POWER,
  RING,
  addLabel,
  cellPackModel,
  codeBlock,
  esp32Board,
  flatBox,
  glide,
  glowMat,
  groundAt,
  i2cBreakout,
  junction,
  lane,
  litWire,
  liveLabel,
  loopBeads,
  memoBy,
  meterBar,
  motorCan,
  opAmpSymbol,
  resistorAlong,
  robotCar,
  scope,
  terminal,
  textLines,
  toneColor,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const LI = CHEMISTRIES.liion
const ampsText = (a: number) => (Math.abs(a) < 1 ? `${(a * 1000).toFixed(Math.abs(a) < 0.01 ? 2 : 1)} mA` : `${a.toFixed(3)} A`)
const voltsText = (v: number, d = 2) => `${v.toFixed(d)} V`
const mv = (v: number) => (v >= 1 ? voltsText(v) : v < 0.01 ? `${(v * 1000).toFixed(2)} mV` : millivolts(v))
const word = (v: number) => `0x${regWord(v).toString(16).toUpperCase().padStart(4, '0')}`

/** A 2512 metal-strip shunt from `a` to `b` (horizontal): copper ends, alloy middle that glows with heat, code in silk. */
function shuntPart(parent: THREE.Object3D, a: V3, b: V3) {
  const g = add(parent, new THREE.Group(), [(a[0] + b[0]) / 2, a[1], 0])
  const len = Math.abs(b[0] - a[0])
  for (const s of [-1, 1]) box(g, [len * 0.22, 1, 0.7], mat('#c8803f', { metal: 0.35, rough: 0.4 }), [(s * len * 0.39), 0, 0])
  const alloy = new THREE.MeshStandardMaterial({ color: '#8d939c', metalness: 0.3, roughness: 0.45, emissive: HEAT, emissiveIntensity: 0 })
  box(g, [len * 0.56, 0.9, 0.6], alloy, [0, 0, 0])
  const code = liveLabel(g, [0, 0, 0.42], { size: 0.36 })
  return {
    group: g,
    set(text: string, heat: number) {
      code.set(text, heat > 0.6 ? '#ffffff' : '#1c1e24')
      alloy.emissiveIntensity = 1.6 * Math.min(1, heat)
    },
  }
}

// --- Shunt resistor: V = I·R across a tiny resistor, low vs high side, op-amp gain into the ADC, heat vs resolution, pack divider. ---

const SHUNTS = { '0.01': '10 mΩ shunt', '0.1': '0.1 Ω shunt', '1': '1 Ω shunt' }
const SHUNT_CODE: Record<keyof typeof SHUNTS, string> = { '0.01': 'R010', '0.1': 'R100', '1': '1R00' }
const GAINS = { '1': 'No amp', '10': 'Gain ×10', '50': 'Gain ×50' }
const SIDES: Record<ShuntSide, string> = { low: 'Low side', high: 'High side' }
const SHUNT_W = 1
const I_MAX = 3
const DIV = { r1: 100e3, r2: 33e3 }

function shuntSetup(p: Params) {
  const amps = n(p, 'amps')
  const rKey = pick(SHUNTS, p.shunt, '0.1')
  const r = Number(rKey)
  const gain = Number(pick(GAINS, p.gain, '10'))
  const side = pick(SIDES, p.side, 'low')
  const vpack = 2 * terminalVolts(LI, 0.5, amps)
  const s = shuntSense(amps, r, gain, side, vpack)
  const d = packDivider(vpack, DIV.r1, DIV.r2)
  const heat = s.watts / SHUNT_W
  const tone: 'ok' | 'warn' | 'bad' = heat > 1 || s.clipped ? 'bad' : s.floored || s.code < 200 || s.vsh > 0.2 || heat > 0.5 ? 'warn' : 'ok'
  return { amps, rKey, r, gain, side, vpack, s, d, heat, tone }
}
type ShuntSetup = ReturnType<typeof shuntSetup>

function shuntHeadline(S: ShuntSetup) {
  if (S.heat > 1) return `The shunt burns ${watts(S.s.watts)} in a ${SHUNT_W} W part`
  if (S.s.clipped) return 'Amp output pinned at the rail: lower the gain'
  if (S.s.floored) return 'Below the op-amp’s 25 mV floor: reads high'
  if (S.s.code < 200) return `Only ${S.s.code} counts: ${ampsText(S.s.perCount)} steps`
  if (S.s.vsh > 0.2) return `Burden: the motor loses ${mv(S.s.vsh)}`
  return 'Big enough to read, small enough to ignore'
}

const shuntCode = (S: ShuntSetup) => [
  `int raw = analogRead(34);  // ${S.gain === 1 ? 'shunt' : `amp ×${S.gain}`}`,
  `float amps = raw * 3.3 / 4096 / ${S.gain === 1 ? '' : `${S.gain} / `}${S.r};`,
  `float vpack = analogRead(35) * 3.3 / 4096 * 133 / 33;`,
]

export const shuntResistor: Lesson = {
  id: 'current-voltage-sensing-shunt-resistor',
  title: 'Shunt resistor',
  tagline: 'Put a tiny resistor in the current path and read the few millivolts across it: V = I·R, amplified into the ADC',
  formula: (p) => {
    const S = shuntSetup(p)
    return `V = I·R = ${ampsText(S.amps)} × ${ohms(S.r)} = ${mv(S.s.vsh)} · ×${S.gain} → ${voltsText(S.s.vout, 3)} → raw ${S.s.code} → ${ampsText(S.s.read)} · P = I²R = ${watts(S.s.watts)} · pack = raw × 3.3/4096 × (100k + 33k)/33k = ${voltsText(S.d.read)}`
  },
  legend: [
    { color: CONVENTIONAL, label: 'Current, speed ∝ amps', shape: 'dot' },
    { color: PIN_COLOR, label: 'Sense lines and ADC inputs', shape: 'dot' },
    { color: B_FIELD, label: 'Volts at the ADC vs current', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'A shunt is just a small, precise resistor in series with the load. Ohm’s law turns current into voltage: 1 A through 0.1 Ω is 100 mV. A multimeter on its amps range does exactly this inside (Voltage › Measuring with a multimeter).',
    'Small R wastes little: the load loses I·R (the burden voltage) and the shunt turns I²R into heat. Big R gives a big signal. 1 Ω at 3 A drops 3 V and burns 9 W; 10 mΩ burns 90 mW but gives 30 mV. Pick the R that gives ~50–100 mV at full current.',
    'Millivolts waste a 12-bit ADC (0.8 mV per count), so an op-amp multiplies them first: G = 1 + Rf/Rg. Too much gain pins the output at the rail; a single-supply op-amp also can’t get closer than ~25 mV to ground, so tiny currents read high.',
    'Low side (between load and ground) keeps the sense voltage near 0 V, easy for a cheap op-amp, but lifts the load’s ground by I·R and misses a short to the chassis. High side sees every fault, but the shunt sits at pack voltage: it needs a current-sense amp (INA180, INA219) built for that common mode.',
    'Pack voltage needs no shunt: a 100 k / 33 k divider scales 8.4 V to 2.08 V for the ADC and only drains 63 µA. Use big resistors so it doesn’t empty the pack while parked.',
  ],
  controls: [
    { kind: 'slider', key: 'amps', label: 'Motor current', min: 0.05, max: I_MAX, initial: 1, step: 0.05, format: (v) => `${v.toFixed(2)} A` },
    { kind: 'choice', key: 'shunt', options: opts(SHUNTS), initial: '0.1' },
    { kind: 'choice', key: 'gain', options: Object.entries(GAINS).map(([value, label]) => ({ value, label })), initial: '10' },
    { kind: 'choice', key: 'side', options: opts(SIDES), initial: 'low' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const pack = cellPackModel(scene, 2, 1, { r: 0.9 })
    const PK: V3 = [-16, -1, 0]
    pack.group.position.set(...PK)
    const plus: V3 = [PK[0] + pack.plus[0], PK[1] + pack.plus[1], 0]
    const minus: V3 = [PK[0] + pack.minus[0], PK[1] + pack.minus[1], 0]
    addLabel(scene, '2S', [PK[0] - 2.3, PK[1], 1], LABEL, 0.42)
    const TOP = 4.5
    const BOT = -5.5
    const hi = { a: -13, b: -10 }
    const lo = { a: -10, b: -7 }
    wire(scene, [plus, [plus[0], TOP, 0], [hi.a, TOP, 0]], 0.14)
    wire(scene, [[hi.b, TOP, 0], [-8.5, TOP, 0], [-8.5, -1.6, 0], [-6.12, -1.6, 0], [-6.12, -0.7, 0]], 0.14)
    const motor = motorCan(scene, [-5, 1.5, 0], { r: 1.4 })
    addLabel(scene, 'motor', [-5, 3.9, 0], LABEL, 0.42)
    wire(scene, [[-3.88, -0.7, 0], [-3.88, -1.6, 0], [-1.5, -1.6, 0], [-1.5, BOT, 0], [lo.b, BOT, 0]], 0.14)
    wire(scene, [[lo.a, BOT, 0], [minus[0], BOT, 0], minus], 0.14)
    const motorLow = liveLabel(scene, [-0.8, -2.6, 0], { size: 0.36, align: 'left' })

    const OA: V3 = [3, -6, 0]
    const amp = opAmpSymbol(scene, OA, { size: 3, lead: 0.8, minusTop: false })
    const ampTag = liveLabel(scene, [OA[0], OA[1] - 2.9, 0], { size: 0.38 })
    const sides = (['high', 'low'] as ShuntSide[]).map((side) => {
      const g = add(scene, new THREE.Group())
      const plain = add(scene, new THREE.Group())
      const [y, xs] = side === 'high' ? [TOP, hi] : [BOT, lo]
      wire(plain, [[xs.a, y, 0], [xs.b, y, 0]], 0.14)
      const part = shuntPart(g, [xs.a + 0.2, y, 0], [xs.b - 0.2, y, 0])
      for (const x of [xs.a, xs.b]) {
        wire(g, [[x, y, 0], [x + (x === xs.a ? 0.25 : -0.25), y, 0]], 0.14)
        junction(g, [x, y, 0.1], 0.18)
      }
      const [pIn, nIn] = [amp.pins.p, amp.pins.n]
      const sense = side === 'high'
        ? [[xs.a, 5.2, pIn[0] - 0.6, pIn], [xs.b, 5.7, pIn[0] - 1.2, nIn]] as const
        : [[xs.b, -7.6, pIn[0] - 1.2, pIn], [xs.a, -7.0, pIn[0] - 0.6, nIn]] as const
      const glows = sense.map(([x0, yl, xv, pin]) => {
        const pts: V3[] = [[x0, y, 0], [x0, yl, 0], [xv, yl, 0], [xv, pin[1], 0], pin]
        wire(g, pts, 0.07)
        return litWire(g, pts, 0.14)
      })
      const vTag = liveLabel(g, [(xs.a + xs.b) / 2, y + (side === 'high' ? -1 : 1), 0.4], { size: 0.38 })
      return { side, g, plain, part, glows, vTag }
    })

    const ESP: V3 = [12, -9.6, 0]
    const k = 0.45
    const pin = esp32Board(scene, ESP, k)
    const adcA = pin(-6, true)
    const adcB = pin(-4, true)
    const outPts: V3[] = [amp.pins.out, [adcA[0], amp.pins.out[1], 0], adcA]
    wire(scene, outPts, 0.1)
    const outGlow = litWire(scene, outPts, 0.18)
    addLabel(scene, 'GPIO34', [adcA[0] - 1.6, amp.pins.out[1] + 0.55, 0], PIN_COLOR, 0.34)
    groundAt(scene, [amp.pins.vee[0], amp.pins.vee[1], 0])
    const PT: V3 = [17, -1.6, 0]
    terminal(scene, PT, 0.35)
    addLabel(scene, 'pack +', [PT[0] - 1.5, PT[1] + 0.2, 0], HIGH_V, 0.34)
    resistorAlong(scene, DIV.r1, [PT[0], PT[1] - 0.6, 0], [PT[0], -3.6, 0], 0.9)
    resistorAlong(scene, DIV.r2, [PT[0], -4.6, 0], [PT[0], -6.6, 0], 0.9)
    wire(scene, [[PT[0], PT[1] - 0.4, 0], [PT[0], -3.4, 0]], 0.08)
    wire(scene, [[PT[0], -3.8, 0], [PT[0], -4.4, 0]], 0.08)
    wire(scene, [[PT[0], -6.4, 0], [PT[0], -7, 0]], 0.08)
    groundAt(scene, [PT[0], -7, 0])
    const tapPts: V3[] = [[PT[0], -4.1, 0], [adcB[0], -4.1, 0], adcB]
    wire(scene, tapPts, 0.08)
    junction(scene, [PT[0], -4.1, 0.1], 0.16)
    addLabel(scene, '100k', [PT[0] + 1.3, -2.6, 0], LABEL, 0.32)
    addLabel(scene, '33k', [PT[0] + 1.2, -5.6, 0], LABEL, 0.32)
    const divTag = liveLabel(scene, [adcB[0] + 3.4, -3.5, 0], { size: 0.34 })

    const EP: V3 = [10.5, 3.6, 0]
    const ew = 15
    const eh = 5.6
    const plot = scope(scene, ew, eh, { divs: [6, 4], zeroAt: 0 })
    plot.group.position.set(...EP)
    const ideal = plot.trace(GREY, { samples: 121, radius: 0.06 })
    const real = plot.trace(B_FIELD, { samples: 121, radius: 0.1 })
    const yV = (v: number) => (v / 3.3 - 0.5) * eh
    plot.level(HIGH_V).set(yV(3.3 - 0.025))
    addLabel(scene, 'volts at GPIO34 vs current', [EP[0], EP[1] + eh / 2 + 1, 0], LABEL, 0.42)
    addLabel(scene, '0 A', [EP[0] - ew / 2, EP[1] - eh / 2 - 0.9, 0], GREY, 0.34)
    addLabel(scene, `${I_MAX} A`, [EP[0] + ew / 2, EP[1] - eh / 2 - 0.9, 0], GREY, 0.34)
    addLabel(scene, '3.3 V', [EP[0] + ew / 2 + 1.5, EP[1] + eh / 2, 0], HIGH_V, 0.34)

    const loop = lane([plus, [plus[0], TOP, 0], [-8.5, TOP, 0], [-8.5, -1.6, 0], [-6.12, -1.6, 0], [-6.12, -0.7, 0], [-3.88, -0.7, 0], [-3.88, -1.6, 0], [-1.5, -1.6, 0], [-1.5, BOT, 0], [minus[0], BOT, 0], minus, [minus[0], plus[1], 0]], 0.9)
    const beads = loopBeads(scene, 26, CONVENTIONAL, { r: 0.2 })
    beads.setPath(loop)
    const code = codeBlock(scene, [-19, -9.6, 0], 0.36, 3)
    const text = textLines(scene, [-19, 10.2, 0])
    const pinColor = new THREE.Color(PIN_COLOR)
    const s = { key: '', glow: 0 }
    return {
      scene,
      view: { center: [0, -0.2, 0], radius: 72, polar: 1.3, azimuth: 0 },
      frame(dt, p) {
        const S = shuntSetup(p)
        const key = `${S.rKey}|${S.gain}|${S.side}`
        if (key !== s.key) {
          s.key = key
          ideal.draw((u) => yV(S.gain * u * I_MAX * S.r), null)
          real.draw((u) => yV(shuntSense(u * I_MAX, S.r, S.gain, S.side, S.vpack).vout), S.amps / I_MAX)
          code(shuntCode(S))
        }
        real.draw((u) => yV(shuntSense(u * I_MAX, S.r, S.gain, S.side, S.vpack).vout), S.amps / I_MAX)
        beads.step(dt * S.amps * 0.06)
        motor.spin(dt, 120 * S.amps)
        s.glow = glide(dt, s.glow, Math.min(1, S.s.vout / 3.3))
        for (const sd of sides) {
          const on = sd.side === S.side
          sd.g.visible = on
          sd.plain.visible = !on
          sd.part.set(SHUNT_CODE[S.rKey], S.heat)
          sd.glows.forEach((g) => g.set(0.3 + 0.7 * Math.min(1, S.s.vsh / 0.1), pinColor))
          sd.vTag.set(mv(S.s.vsh), S.s.vsh > 0.2 ? HEAT : PIN_COLOR)
        }
        outGlow.set(s.glow, pinColor)
        amp.set(S.s.vout / 3.3, S.s.clipped ? 1 : 0)
        amp.group.visible = S.gain > 1
        ampTag.set(S.gain > 1 ? `×${S.gain} · ${S.side === 'high' ? 'current-sense amp' : 'MCP6002'}` : 'bypassed: shunt wired straight in', S.gain > 1 ? LABEL : GREY)
        motorLow.set(S.side === 'low' ? `motor − sits at +${mv(S.s.groundLift)}` : '', S.side === 'low' && S.s.groundLift > 0.1 ? HEAT : GREY)
        divTag.set(`${voltsText(S.d.vadc)} · ${(S.d.amps * 1e6).toFixed(0)} µA`, PIN_COLOR)
        text.a.set(shuntHeadline(S), toneColor[S.tone])
        text.b.set(`${ampsText(S.amps)} × ${ohms(S.r)} = ${mv(S.s.vsh)} → ${voltsText(S.s.vout, 3)} → raw ${S.s.code} → ${ampsText(S.s.read)}`, toneColor[S.tone])
        text.c.set(`burden ${mv(S.s.vsh)} · heat ${watts(S.s.watts)} · ${S.side === 'high' ? `shunt sits at ${voltsText(S.s.commonMode, 1)}` : 'shunt sits near 0 V'}`, S.heat > 1 ? HIGH_V : LABEL)
        text.status.set(`1 count = ${ampsText(S.s.perCount)} · full scale ${ampsText(S.s.fullScale)} · pack ${voltsText(S.vpack)} → divider → ${voltsText(S.d.read)}`, GREY)
      },
      readouts: (p) => {
        const S = shuntSetup(p)
        return [
          { label: 'Shunt voltage', value: mv(S.s.vsh), tone: S.s.vsh > 0.2 ? 'warn' : 'ok' },
          { label: 'At the ADC', value: voltsText(S.s.vout, 3), tone: S.s.clipped ? 'bad' : S.s.floored || S.s.code < 200 ? 'warn' : 'ok' },
          { label: 'Reading', value: ampsText(S.s.read), tone: S.tone },
          { label: 'Shunt heat', value: watts(S.s.watts), tone: S.heat > 1 ? 'bad' : S.heat > 0.5 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- INA219: high-side shunt + PGA + 12-bit ADC; bus, shunt, current and power registers over I²C; calibration. ---

const PGAS: Record<string, string> = Object.fromEntries(INA219_PGA.map((v) => [String(v * 1000), `PGA ±${v * 1000} mV`]))
const LSBS = { '0.05': '0.05 mA/bit', '0.1': '0.1 mA/bit', '1': '1 mA/bit' }
const STARTS = { hard: 'Hard start', soft: 'Soft start' }
const R_INA = 0.1
const WINDOW = 8
const A_TOP = 3.5

function inaSetup(p: Params) {
  const pga = Number(pick(PGAS, p.pga, '320')) / 1000
  const lsbKey = pick(LSBS, p.lsb, '0.1')
  const lsb = Number(lsbKey) / 1000
  const ramp = pick(STARTS, p.start, 'hard') === 'soft' ? 0.6 : 0
  const cal = ina219Cal(lsb, R_INA)
  const limit = Math.min(pga / R_INA, 32767 * lsb)
  return { pga, lsbKey, lsb, ramp, cal, limit, config: ina219Config(pga) }
}
type InaSetup = ReturnType<typeof inaSetup>

const railAmps = (t: number, ramp: number) => {
  const a = missionAmps(t, 2 * LI.nominal, ramp)
  return a.motors + a.driver
}
const busAt = (amps: number) => 2 * terminalVolts(LI, 0.7, amps) - amps * R_INA
const inaAt = (S: InaSetup, t: number) => {
  const amps = railAmps(t, S.ramp)
  return { amps, r: ina219Read(amps, busAt(amps), R_INA, S.pga, S.lsb) }
}

const INA_CODE = (S: InaSetup) => [
  `writeReg(0x05, ${S.cal});  // Cal: ${S.lsbKey} mA per bit`,
  `float mA = (int16_t)readReg(0x04) * ${S.lsbKey};`,
  'float V = (readReg(0x02) >> 3) * 0.004;',
  `float mW = readReg(0x03) * ${+(20 * Number(S.lsbKey)).toFixed(2)};`,
]

export const ina219: Lesson = {
  id: 'current-voltage-sensing-ina219',
  title: 'INA219',
  tagline: 'Shunt, amplifier and ADC in one chip on the high side: the ESP32 just reads volts, amps and watts over I²C',
  formula: (p) => {
    const S = inaSetup(p)
    const { r } = inaAt(S, 2)
    return `Cal = trunc(0.04096 / (${S.lsbKey} mA × 0.1 Ω)) = ${S.cal} · I = shunt × Cal / 4096 = ${r.shunt} × ${S.cal} / 4096 = ${r.current} × ${S.lsbKey} mA = ${ampsText(r.amps)} · P = I × bus / 5000 = ${r.power} × ${+(20 * Number(S.lsbKey)).toFixed(2)} mW = ${watts(r.watts)}`
  },
  legend: [
    { color: GREY, label: 'True motor-rail current', shape: 'dot' },
    { color: B_FIELD, label: 'INA219 current register', shape: 'dot' },
    { color: HIGH_V, label: 'Clip: PGA range or 16-bit register', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'The INA219 is the shunt lesson on one chip: VIN+ and VIN− go either side of a 0.1 Ω shunt in the positive wire (high side, up to 26 V), a programmable-gain amp and 12-bit ADC read the shunt in 10 µV steps, and a second channel reads the bus voltage at VIN− in 4 mV steps.',
    'The PGA sets the shunt range: ±40, 80, 160 or 320 mV, i.e. 0.4 to 3.2 A on 0.1 Ω. Too small and motor start-up spikes clip; the OVF flag in the bus register says so. A smaller range doesn’t add bits here: the shunt LSB stays 10 µV.',
    'The chip can also do the maths. Write Cal = trunc(0.04096 / (Current_LSB × R)) to register 0x05 and it fills 0x04 with amps in your units and 0x03 with watts (LSB = 20 × Current_LSB). The current register is 16-bit signed: a 0.05 mA LSB tops out at 1.64 A. A 1 mA LSB gives Cal = 409.6, truncated to 409: 0.15 % low.',
    'Every value is a 16-bit register read: write the register pointer, then read two bytes (I²C › Reading an IMU). At address 0x40 (A0, A1 change it) up to 16 can share the bus: one per motor, one for the logic rail.',
    'Watch the rail while the robot drives: ~0.5 A cruising, ~2 A for a fraction of a second at each start. Power budget › Peak vs average explains why that spike matters; here it decides the PGA range.',
  ],
  controls: [
    { kind: 'choice', key: 'pga', options: Object.entries(PGAS).map(([value, label]) => ({ value, label })), initial: '320' },
    { kind: 'choice', key: 'lsb', options: Object.entries(LSBS).map(([value, label]) => ({ value, label })), initial: '0.1' },
    { kind: 'choice', key: 'start', options: Object.entries(STARTS).map(([value, label]) => ({ value, label })), initial: 'hard' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const pack = cellPackModel(scene, 2, 1, { r: 0.9 })
    const PK: V3 = [-17, -5.4, 0]
    pack.group.position.set(...PK)
    const plus: V3 = [PK[0] + pack.plus[0], PK[1] + pack.plus[1], 0]
    const minus: V3 = [PK[0] + pack.minus[0], PK[1] + pack.minus[1], 0]
    groundAt(scene, [minus[0], minus[1] - 0.2, 0])
    addLabel(scene, '2S', [PK[0] - 2, PK[1], 1], LABEL, 0.42)
    const board = i2cBreakout(scene, [-9, -6.6, 0], { name: 'INA219', k: 0.4, pins: ['VIN+', 'VIN-', 'VCC', 'GND', 'SCL', 'SDA'] })
    const P = (name: string): V3 => {
      const q = board.pin(name)
      return [q[0], q[1], 0]
    }
    const shunt = shuntPart(board.group, [-1.6, 0.4, 0], [1.6, 0.4, 0])
    shunt.group.position.z = 0.6
    shunt.group.scale.setScalar(0.8)
    const inPts: V3[] = [plus, [plus[0], -1.4, 0], [P('VIN+')[0], -1.4, 0], P('VIN+')]
    const MOT = [-14.6, -11.6].map((x) => motorCan(scene, [x, 2.2, 0], { r: 1.1 }))
    const outPts: V3[] = [P('VIN-'), [P('VIN-')[0], -0.4, 0], [MOT[0].pins[0][0], -0.4, 0], MOT[0].pins[0]]
    wire(scene, inPts, 0.14)
    wire(scene, outPts, 0.14)
    wire(scene, [[MOT[1].pins[0][0], -0.4, 0], MOT[1].pins[0]], 0.14)
    junction(scene, [MOT[1].pins[0][0], -0.4, 0.1], 0.18)
    for (const m of MOT) groundAt(scene, [m.pins[1][0], m.pins[1][1], 0])
    addLabel(scene, 'motors (via L298N)', [-13.1, 4.7, 0], LABEL, 0.38)
    const rail = loopBeads(scene, 14, CONVENTIONAL, { r: 0.18, closed: false })
    rail.setPath(lane([...inPts, [P('VIN+')[0], -4.6, 0], [P('VIN-')[0], -4.6, 0], ...outPts], 0.9))

    const pin = esp32Board(scene, [-0.5, -8.8, 0], 0.3)
    const busNames = ['VCC', 'GND', 'SCL', 'SDA']
    const espPins = [pin(6), pin(3), pin(0), pin(-3)]
    const busWires = busNames.map((nm, i) => {
      const a = P(nm)
      const yl = 0.9 - i * 0.6
      const pts: V3[] = [a, [a[0], yl, 0], [espPins[i][0], yl, 0], espPins[i]]
      wire(scene, pts, 0.07)
      return litWire(scene, pts, 0.13)
    })
    const addrTag = liveLabel(scene, [-19, -10.8, 0], { size: 0.34, color: GREY, align: 'left' })

    const SP: V3 = [10.5, 4.2, 0]
    const sw = 15
    const sh = 5.6
    const sc = scope(scene, sw, sh, { divs: [8, 5], zeroAt: 0 })
    sc.group.position.set(...SP)
    const yA = (a: number) => (a / A_TOP - 0.5) * sh
    const trueTr = sc.trace(GREY, { samples: 240, radius: 0.06 })
    const readTr = sc.trace(B_FIELD, { samples: 240, radius: 0.1 })
    const clip = sc.level(HIGH_V)
    addLabel(scene, 'motor-rail current, last 8 s', [SP[0], SP[1] + sh / 2 + 1, 0], LABEL, 0.42)
    addLabel(scene, `${A_TOP} A`, [SP[0] + sw / 2 + 1.4, SP[1] + sh / 2, 0], GREY, 0.34)
    addLabel(scene, '0', [SP[0] + sw / 2 + 1, SP[1] - sh / 2, 0], GREY, 0.34)
    const clipTag = liveLabel(scene, [SP[0] + sw / 2 + 1.5, SP[1], 0], { size: 0.34, color: HIGH_V })

    const REG_AT: V3 = [5, -1.6, 0]
    const regs = Array.from({ length: 6 }, (_, i) => liveLabel(scene, [REG_AT[0], REG_AT[1] - i * 0.95, 0], { size: 0.4, align: 'left' }))
    addLabel(scene, 'registers @ 0x40', [REG_AT[0] + 4.2, REG_AT[1] + 1.1, 0], DATA_COLOR, 0.4)
    const code = codeBlock(scene, [5, -8.2, 0], 0.32, 4)
    const text = textLines(scene, [-19, 10.2, 0])
    const sdaColor = new THREE.Color(DATA_COLOR)
    const sclColor = new THREE.Color(PIN_COLOR)
    const pwrColor = new THREE.Color(GREY)
    const s = { key: '', t: 0, peak: 0, lastPoll: -1 }
    return {
      scene,
      view: { center: [0, -0.2, 0], radius: 72, polar: 1.3, azimuth: 0 },
      frame(dt, p) {
        const S = inaSetup(p)
        const key = `${S.pga}|${S.lsbKey}|${S.ramp}`
        if (key !== s.key) {
          Object.assign(s, { key, t: 0, peak: 0 })
          code(INA_CODE(S))
          clip.set(yA(S.limit))
        }
        s.t += dt
        const now = s.t
        trueTr.scroll((t) => yA(t < 0 ? 0 : railAmps(t, S.ramp)), now, WINDOW)
        readTr.scroll((t) => yA(t < 0 ? 0 : inaAt(S, t).r.amps), now, WINDOW)
        const { amps, r } = inaAt(S, now)
        s.peak = Math.max(s.peak * Math.exp(-dt / 2), amps)
        rail.step(dt * amps * 0.12)
        for (const m of MOT) m.spin(dt, 200 * Math.max(0, amps - 0.04))
        const poll = Math.floor(now * 4)
        const busy = (now * 4) % 1 < 0.35
        busWires[0].set(0.5, pwrColor)
        busWires[1].set(0.2, pwrColor)
        busWires[2].set(busy ? 0.6 + 0.4 * Math.sin(now * 90) : 0.1, sclColor)
        busWires[3].set(busy ? 0.6 + 0.4 * Math.sin(now * 53) : 0.1, sdaColor)
        board.led(1)
        board.chip(r.ovf ? HIGH_V : B_FIELD, busy ? 0.8 : 0.3)
        shunt.set('R100', (amps * amps * R_INA) / 0.5)
        if (poll !== s.lastPoll) {
          s.lastPoll = poll
          const rows: [number, string, number, string, string][] = [
            [INA219.reg.config, 'CONFIG', S.config, `±${S.pga * 1000} mV, 32 V`, LABEL],
            [INA219.reg.shunt, 'SHUNT', r.shunt, `${(r.shuntV * 1000).toFixed(2)} mV`, r.shuntOvf ? HIGH_V : PIN_COLOR],
            [INA219.reg.bus, 'BUS', r.bus, `${voltsText(r.busV, 3)}${r.ovf ? ' OVF' : ''}`, r.ovf ? HIGH_V : PIN_COLOR],
            [INA219.reg.power, 'POWER', r.power, watts(r.watts), POWER],
            [INA219.reg.current, 'CURRENT', r.current, ampsText(r.amps), r.ovf ? HIGH_V : B_FIELD],
            [INA219.reg.cal, 'CAL', S.cal, `${S.cal}`, RING],
          ]
          rows.forEach(([a, nm, v, val, color], i) => regs[i].set(`${hexByte(a)} ${nm.padEnd(8)}${word(v)}  ${val}`, color))
        }
        const err = r.amps - amps
        const clipped = amps > S.limit
        text.a.set(
          clipped
            ? r.shuntOvf
              ? `Spike past ±${S.pga * 1000} mV: the PGA clips`
              : `Past ${ampsText(32767 * S.lsb)}: the 16-bit register clips`
            : S.lsb >= 1e-3
              ? `Coarse: 1 mA steps, Cal ${S.cal} not ${(0.04096 / (S.lsb * R_INA)).toFixed(1)}`
              : 'Every spike fits: shunt, bus and power all valid',
          clipped ? HIGH_V : S.lsb >= 1e-3 ? HEAT : POWER,
        )
        text.b.set(`true ${ampsText(amps)} → shunt ${(r.shuntV * 1000).toFixed(2)} mV → read ${ampsText(r.amps)} (${err >= 0 ? '+' : '−'}${ampsText(Math.abs(err))})`, clipped ? HIGH_V : LABEL)
        text.c.set(`bus ${voltsText(r.busV, 3)} × ${ampsText(r.amps)} = ${watts(r.watts)} · peak ${ampsText(s.peak)}`, LABEL)
        text.status.set(`range ${ampsText(S.limit)} · ${S.ramp ? 'soft start 0.6 s ramp' : 'hard start: ~2 A for 0.2 s'} · polled 4×/s · real time`, GREY)
        clipTag.set(ampsText(S.limit), HIGH_V)
        clipTag.group.position.y = SP[1] + Math.min(sh / 2, yA(S.limit))
        addrTag.set('A0 A1 low → 0x40 · SDA GPIO21 · SCL GPIO22 · VIN+ / VIN− across R100', GREY)
      },
      readouts: (p) => {
        const S = inaSetup(p)
        let peak = 0
        for (let t = 0; t < WINDOW; t += 0.01) peak = Math.max(peak, railAmps(t, S.ramp))
        return [
          { label: 'Range', value: ampsText(S.limit), tone: peak > S.limit ? 'bad' : 'ok' },
          { label: 'Peak draw', value: ampsText(peak), tone: peak > S.limit ? 'bad' : 'ok' },
          { label: 'Cal (0x05)', value: `${S.cal}`, tone: S.lsb >= 1e-3 ? 'warn' : 'ok' },
          { label: 'Current LSB', value: `${S.lsbKey} mA`, tone: S.lsb >= 1e-3 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- State of charge: voltage lookup vs coulomb counting on a 2S pack while the robot drives; sag vs drift. ---

const PACKS = { new: 'New pack', aged: 'Aged pack (85 %)' }
const RECALS = { off: 'No re-sync', rest: 'Re-sync at rest' }
const MAH = LI.cell.mAh
const PARK_A = Object.values(stateAmps('idle', 2 * LI.nominal)).reduce((a, b) => a + b, 0)
const SCROLL = 30
const HOLD = 3
const DT = 5

function socSetup(p: Params) {
  const driveA = n(p, 'drive')
  const offsetA = n(p, 'offset') / 1000
  const aged = pick(PACKS, p.pack, 'new') === 'aged'
  const recal = pick(RECALS, p.recal, 'off') === 'rest'
  return { driveA, offsetA, aged, recal, mAh: aged ? 0.85 * MAH : MAH }
}
type SocSetup = ReturnType<typeof socSetup>

const socRunFor = memoBy(
  (S: SocSetup) => `${S.driveA}|${S.offsetA}|${S.aged}|${S.recal}`,
  (S: SocSetup) => socRun({ chem: LI, series: 2, mAh: S.mAh, assumedMAh: MAH, driveA: S.driveA, parkA: PARK_A, offsetA: S.offsetA, recalS: S.recal ? 180 : 0, dt: DT }),
)

const socCode = (S: SocSetup) => [
  `soc_v = lookup(OCV, vpack / 2);  // only valid at rest`,
  `used_mAh += mA * dt_h;  // ${S.offsetA ? `sensor reads +${Math.round(S.offsetA * 1000)} mA` : 'perfect sensor'}`,
  `soc_c = 1 - used_mAh / ${MAH};${S.recal ? '  // at rest: = soc_v' : ''}`,
]

export const stateOfCharge: Lesson = {
  id: 'current-voltage-sensing-state-of-charge',
  title: 'State of charge',
  tagline: 'Two fuel gauges: look the pack voltage up in the OCV table, or count the amp-hours out. Sag fools one, drift creeps into the other',
  formula: (p) => {
    const S = socSetup(p)
    const run = socRunFor(S)
    const e = run[run.length - 1]
    return `SoC_v = OCV⁻¹(V_pack / 2) · SoC_c = 1 − ∫(I + ${Math.round(S.offsetA * 1000)} mA) dt / ${MAH} mAh · sag = I × (R₀ + R_pol) = ${S.driveA.toFixed(2)} A × ${((LI.cell.ohms + 0.03) * 1000).toFixed(0)} mΩ per cell · run ${hoursText(e.t / 3600)}, ends at SoC_c ${pct(e.ccSoc)} (true ${pct(e.soc)})`
  },
  legend: [
    { color: GREY, label: 'True state of charge', shape: 'dot' },
    { color: HEAT, label: 'Voltage lookup', shape: 'dot' },
    { color: B_FIELD, label: 'Coulomb count', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'The simplest gauge reads the pack voltage (divider, or INA219 bus register) and looks it up in the OCV curve from Battery chemistry › Cell voltage curve. That curve is for a rested cell: under load the terminals sag by I × R₀ at once, plus a polarisation that builds and relaxes over minutes.',
    'So while driving the voltage gauge reads low, and it jumps back up when the robot parks. Li-ion’s middle is flat (3.6–3.8 V spans 40 %), so 50 mV of sag is 7 % of charge. It only becomes trustworthy after a few minutes at rest, and is best near the steep ends.',
    'Coulomb counting integrates the current from the shunt or INA219: used mAh += I × dt. It ignores sag, but every error adds up: a 30 mA offset is 180 mAh over a 6 h run, and an aged pack holding 85 % runs out while the counter still says 15 % left.',
    'Real fuel gauges (MAX17048, BQ27441) do both: count coulombs while driving, and re-anchor to the rested voltage table whenever the robot sits still long enough. Turn on the re-sync to see the drift reset at every stop.',
  ],
  controls: [
    { kind: 'slider', key: 'drive', label: 'Driving current', min: 0.3, max: 2.5, initial: 1.2, step: 0.1, format: (v) => `${v.toFixed(1)} A` },
    { kind: 'slider', key: 'offset', label: 'Sensor offset', min: 0, max: 100, initial: 30, step: 5, format: (v) => `+${v} mA` },
    { kind: 'choice', key: 'pack', options: Object.entries(PACKS).map(([value, label]) => ({ value, label })), initial: 'new' },
    { kind: 'choice', key: 'recal', options: Object.entries(RECALS).map(([value, label]) => ({ value, label })), initial: 'off' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const carHolder = add(scene, new THREE.Group(), [-12, 1.6, 0])
    robotCar(carHolder, [0, 0, 0], 0.9)
    const pack = cellPackModel(scene, 2, 1, { r: 0.7 })
    pack.group.position.set(-3.4, 1.6, 0)
    addLabel(scene, `2S · ${MAH} mAh`, [-3.4, -1.9, 1], LABEL, 0.36)
    const floor = flatBox(scene, [14, 0.2, 3], glowMat('#2a2d34', 0.1), [-12, -0.2, -1])
    floor.castShadow = false
    const carTag = liveLabel(scene, [-12, -1.3, 1.6], { size: 0.4 })
    const bars = [
      { caption: 'true', color: GREY },
      { caption: 'volts', color: HEAT },
      { caption: 'count', color: B_FIELD },
    ].map((b, i) => ({ ...b, set: meterBar(scene, [-14, -3.8 - i * 2.3, 0], 10, 100, [], b.caption) }))

    const SP: V3 = [10.5, 1.4, 0]
    const sw = 16
    const sh = 7.6
    const sc = scope(scene, sw, sh, { divs: [6, 4], zeroAt: 0 })
    sc.group.position.set(...SP)
    const yS = (f: number) => (f - 0.5) * sh
    const traces = [GREY, HEAT, B_FIELD].map((c, i) => sc.trace(c, { samples: 360, radius: i ? 0.08 : 0.06 }))
    const cursor = flatBox(sc.group, [0.07, sh, 0.06], glowMat(RING, 0.8), [0, 0, 0.35])
    addLabel(scene, 'state of charge over the run', [SP[0], SP[1] + sh / 2 + 1, 0], LABEL, 0.42)
    addLabel(scene, '100 %', [SP[0] + sw / 2 + 1.6, SP[1] + sh / 2, 0], GREY, 0.34)
    addLabel(scene, '0 %', [SP[0] + sw / 2 + 1.2, SP[1] - sh / 2, 0], GREY, 0.34)
    const endTag = liveLabel(scene, [SP[0] + sw / 2, SP[1] - sh / 2 - 0.9, 0], { size: 0.34, color: GREY })
    addLabel(scene, '0 h', [SP[0] - sw / 2, SP[1] - sh / 2 - 0.9, 0], GREY, 0.34)
    const code = codeBlock(scene, [3, -6.4, 0], 0.34, 3)
    const text = textLines(scene, [-19, 10.2, 0])
    const s = { key: '', sim: 0, hold: 0, x: 0, phase: 0, shown: -1, vis: [1, 1, 1] }
    return {
      scene,
      view: { center: [0, -0.4, 0], radius: 72, polar: 1.3, azimuth: 0 },
      frame(dt, p) {
        const S = socSetup(p)
        const run = socRunFor(S)
        const T = run[run.length - 1].t
        const speed = T / SCROLL
        const key = `${S.driveA}|${S.offsetA}|${S.aged}|${S.recal}`
        if (key !== s.key) {
          Object.assign(s, { key, sim: 0, hold: 0, shown: -1 })
          code(socCode(S))
          endTag.set(hoursText(T / 3600))
        }
        if (s.sim >= T) {
          s.hold += dt
          if (s.hold > HOLD) Object.assign(s, { sim: 0, hold: 0, shown: -1 })
        } else s.sim = Math.min(T, s.sim + dt * speed)
        const uNow = Math.max(0.004, s.sim / T)
        const idx = Math.floor(s.sim / DT)
        if (idx !== s.shown) {
          s.shown = idx
          const at = (u: number) => fixedStepAt(run, u * uNow * T, DT)
          traces[0].draw((u) => yS(at(u).soc), null)
          traces[1].draw((u) => yS(at(u).vSoc), null)
          traces[2].draw((u) => yS(at(u).ccSoc), null)
          for (const tr of traces) {
            tr.group.scale.x = uNow
            tr.group.position.x = (-sw / 2) * (1 - uNow)
          }
        }
        cursor.position.x = -sw / 2 + uNow * sw
        const now = fixedStepAt(run, s.sim, DT)
        const { parked } = cycleAmps(s.sim, S.driveA, PARK_A)
        const driving = !parked && s.sim < T
        s.phase += driving ? dt * 1.6 : 0
        s.x = glide(dt, s.x, 3.2 * Math.sin(s.phase), 4)
        carHolder.position.x = -12 + s.x
        carTag.set(s.sim >= T ? 'stopped: a cell hit 3.0 V' : driving ? `driving · ${S.driveA.toFixed(1)} A` : `parked · ${Math.round(PARK_A * 1000)} mA`, s.sim >= T ? HIGH_V : driving ? HEAT : POWER)
        const vErr = now.vSoc - now.soc
        const cErr = now.ccSoc - now.soc
        bars[0].set(now.soc * 100, pct(now.soc), GREY)
        bars[1].set(now.vSoc * 100, `${pct(now.vSoc)}`, Math.abs(vErr) > 0.08 ? HIGH_V : HEAT)
        bars[2].set(now.ccSoc * 100, `${pct(now.ccSoc)}`, Math.abs(cErr) > 0.08 ? HIGH_V : B_FIELD)
        const head =
          s.sim >= T && now.ccSoc > 0.05
            ? `Robot died with the counter at ${pct(now.ccSoc)}`
            : Math.abs(vErr) > 0.05 && driving
              ? `Sag: the voltage reads ${pct(Math.abs(vErr))} ${vErr < 0 ? 'low' : 'high'}`
              : Math.abs(cErr) > 0.05
                ? `Drift: the count is ${pct(Math.abs(cErr))} ${cErr > 0 ? 'high' : 'low'}`
                : parked
                  ? 'Parked: the voltage settles back'
                  : 'Both gauges agree with the truth'
        text.a.set(head, s.sim >= T || Math.abs(vErr) > 0.08 || Math.abs(cErr) > 0.08 ? HIGH_V : Math.abs(cErr) > 0.05 ? HEAT : POWER)
        text.b.set(`pack ${voltsText(now.packV)} at ${ampsText(now.amps)} → table says ${pct(now.vSoc)} (true ${pct(now.soc)})`, HEAT)
        text.c.set(`counted ${(((1 - now.ccSoc) * MAH) / 1000).toFixed(2)} Ah of ${(MAH / 1000).toFixed(1)} → ${pct(now.ccSoc)}${S.aged ? ` · pack really holds ${(S.mAh / 1000).toFixed(2)} Ah` : ''}`, B_FIELD)
        text.status.set(`sim ${hoursText(s.sim / 3600)} · time ×${Math.round(speed)} · drive ${DRIVE_CYCLE.driveS / 60} min, park ${DRIVE_CYCLE.parkS / 60} min`, GREY)
      },
      readouts: (p) => {
        const S = socSetup(p)
        const run = socRunFor(S)
        const e = run[run.length - 1]
        const worstV = Math.max(...run.map((r) => r.soc - r.vSoc))
        return [
          { label: 'Runtime', value: hoursText(e.t / 3600), tone: 'ok' },
          { label: 'Sag error', value: pct(worstV), tone: worstV > 0.15 ? 'bad' : worstV > 0.08 ? 'warn' : 'ok' },
          { label: 'Count at end', value: pct(e.ccSoc), tone: Math.abs(e.ccSoc - e.soc) > 0.1 ? 'bad' : Math.abs(e.ccSoc - e.soc) > 0.05 ? 'warn' : 'ok' },
          { label: 'Left at end', value: pct(e.soc), tone: e.soc > 0.1 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
