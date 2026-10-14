import * as THREE from 'three/webgpu'
import { thermistorResistance } from '../../core/formulas'
import { adcCounts, dividerOut, loadedDivider } from '../../core/physics'
import { nearestE12 } from '../../core/resistorColors'
import { amps, fitDigits, mA, ohms, volts } from '../../core/units'
import { add, box, mat } from '../../models/kit'
import { buildEsp32 } from '../../models/modules'
import { createStage } from '../../scene/stage'
import {
  CELL_H,
  CONVENTIONAL,
  HIGH_V,
  LANE,
  LOW_V,
  OHMS_LABEL,
  POWER,
  R_SCALE,
  RING,
  RS,
  cell,
  cellFraction,
  ease,
  emptyGroup,
  groundSymbol,
  lerp,
  plusFlow,
  pulseLabel,
  swapResistor,
  terminal,
  thermistorAlong,
  thermometer,
  voltStack,
  wire,
} from '../fx'
import { Lesson, Params, Stage, e12, n } from '../types'

const VIN = 9
const H = 6
const W = 10

/** Potential fraction down a column with R₁ centred at +H/2 and R₂ at −H/2: 1 on top, `mid` at the tap, 0 below. */
const columnFraction = (y: number, mid: number) => {
  const top = H / 2
  if (y > top + RS) return 1
  if (y > top - RS) return lerp(mid, 1, (y - top + RS) / (2 * RS))
  if (y > -top + RS) return mid
  if (y > -top - RS) return lerp(0, mid, (y + top + RS) / (2 * RS))
  return 0
}

/** Cell on the left, top and bottom rails, and the two-part column at `x`; returns holders for the top and bottom parts. */
function dividerFrame(parent: THREE.Object3D, x: number) {
  wire(parent, [[x, 0, 0], [x, H, 0], [-W, H, 0], [-W, -H, 0], [x, -H, 0], [x, 0, 0]])
  const battery = cell(CELL_H, 1.5)
  battery.position.set(-W, 0, 0)
  parent.add(battery)
  return [add(parent, new THREE.Group(), [x, H / 2, 0]), add(parent, new THREE.Group(), [x, -H / 2, 0])]
}

// --- The divider formula: two resistors in series; the tap between them sits at a fixed fraction of the supply. ---

const F_X = 3
const OUT_X = F_X + 6.5
const F_SPEED = 3 // drawn units/s per mA

const solveFormula = (p: Params) => {
  const r1 = e12(p, 'r1')
  const r2 = e12(p, 'r2')
  const vout = dividerOut(VIN, r1, r2)
  return { r1, r2, vout, v1: VIN - vout, ratio: r2 / (r1 + r2), amps: VIN / (r1 + r2) }
}

const kSlider = (key: string, label: string, initial: number) =>
  ({ kind: 'slider', key, label, min: 1000, max: 100e3, initial, log: true, format: (v: number) => ohms(nearestE12(v)) }) as const

export const dividerFormula: Lesson = {
  id: 'voltage-divider-the-divider-formula',
  title: 'The divider formula',
  tagline: 'A fraction of the supply',
  formula: (p) => {
    const s = solveFormula(p)
    return `Vout = Vin × R₂ / (R₁ + R₂) = ${VIN} V × ${+s.ratio.toPrecision(3)} = ${volts(s.vout)}`
  },
  legend: [
    { color: HIGH_V, label: 'Drop across R₁, V', shape: 'dot' },
    { color: RING, label: 'Vout across R₂, V', shape: 'dot' },
    { color: LOW_V, label: 'Ground 0 V', shape: 'dot' },
  ],
  points: [
    'Two resistors in series across a supply share its voltage. Tap the wire between them and you get a lower voltage out: a voltage divider.',
    'Vout is the drop across the bottom resistor, measured from ground: Vout = Vin × R₂ / (R₁ + R₂).',
    'Only the ratio matters. 1 kΩ over 1 kΩ and 47 kΩ over 47 kΩ both give half, 4.5 V. Bigger values just draw less current.',
    'Make R₂ bigger and the tap climbs toward 9 V; make R₁ bigger and it sinks toward 0 V. The column on the left stacks the two drops.',
    'Nothing flows out of the tap here, so the formula holds exactly. Draw current from it and Vout sags: that’s the next lesson.',
  ],
  controls: [kSlider('r1', 'R₁ (top)', 10e3), kSlider('r2', 'R₂ (bottom)', 4700)],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const [top, bottom] = dividerFrame(scene, F_X)
    wire(scene, [[F_X, 0, 0], [OUT_X, 0, 0]])
    wire(scene, [[F_X, -H, 0], [OUT_X, -H, 0]])
    const out = terminal(scene, [OUT_X, 0, 0])
    add(scene, groundSymbol(), [OUT_X, -H, 0])
    const stack = voltStack(scene, 2, (2 * H) / VIN, VIN, 1)
    stack.group.position.set(-5.5, -H, -1.2)

    let mid = 0.5
    const fraction = (x: number, y: number) => {
      if (x <= -W + 0.01) return cellFraction(y)
      if (y >= H - 0.01) return 1
      if (y <= -H + 0.01) return 0
      return columnFraction(y, mid)
    }
    const flow = plusFlow(scene, [[-W, -H, LANE], [-W, H, LANE], [F_X, H, LANE], [F_X, -H, LANE]], (at) => fraction(at.x, at.y), true)

    const v1Label = pulseLabel(scene, 3, HIGH_V, [F_X - 4, H / 2, 0], 1.5)
    const voutLabel = pulseLabel(scene, 3, RING, [OUT_X, 2.2, 0], 1.6)

    const shown = [NaN, NaN]
    const shownV = [VIN / 2, VIN / 2]
    return {
      scene,
      view: { center: [0, 0.2, 0], radius: 47, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const s = solveFormula(p)
        ;[s.r1, s.r2].forEach((r, k) => {
          if (r === shown[k]) return
          shown[k] = r
          swapResistor(k ? bottom : top, r, [0, 1, 0], [0, -1, 0])
        })
        shownV[0] += (s.vout - shownV[0]) * ease(dt, 8)
        shownV[1] += (s.v1 - shownV[1]) * ease(dt, 8)
        stack.set(shownV)
        mid = shownV[0] / VIN
        out.set(mid)
        flow.step(dt * mA(s.amps) * F_SPEED)
        v1Label.show(fitDigits(s.v1, 3))
        voutLabel.show(fitDigits(s.vout, 3))
        for (const l of [v1Label, voutLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveFormula(p)
        return [
          { label: 'R₂ / (R₁ + R₂)', value: `${+s.ratio.toPrecision(3)}` },
          { label: 'Vout', value: volts(s.vout), tone: 'ok' },
          { label: 'Across R₁', value: volts(s.v1) },
          { label: 'Current I', value: amps(s.amps) },
        ]
      },
    }
  },
}

// --- Loading a divider: a load across R₂ is in parallel with it, so the bottom gets smaller and Vout sags. ---

const L_X = 0
const LOAD_X = L_X + 7
const L_SPEED = 1.6 // drawn units/s per mA
const PAIRS: Record<string, number> = { '1k': 1000, '10k': 10e3 }

const solveLoad = (p: Params) => {
  const r = PAIRS[String(p.pair)] ?? 10e3
  const load = e12(p, 'load')
  return { r, load, ...loadedDivider(VIN, r, r, load) }
}

export const loadingDivider: Lesson = {
  id: 'voltage-divider-loading-a-divider',
  title: 'Loading a divider',
  tagline: 'Draw current and Vout sags',
  formula: (p) => {
    const s = solveLoad(p)
    return `Vout = 9 V × (R₂ ∥ RL) / (R₁ + R₂ ∥ RL) = ${volts(s.vout)}, ${+(s.sag * 100).toPrecision(2)} % low`
  },
  legend: [
    { color: RING, label: 'Vout loaded, V', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Load current, mA', shape: 'dot' },
    { color: LOW_V, label: 'Ground 0 V', shape: 'dot' },
  ],
  points: [
    'Hang a load RL on the tap and it sits in parallel with R₂. The bottom of the divider gets smaller, so Vout drops below the formula.',
    'R₁ now carries both currents: I₁ = I₂ + I_L. The extra current through R₁ is what drags the tap down.',
    'With 10 kΩ over 10 kΩ, a 10 kΩ load turns 4.5 V into 3 V. The bar on the left shows the sag against the unloaded mark.',
    'Rule of thumb: keep the load at least 10× R₂ and Vout stays within about 5 %. Or use smaller divider resistors: 1 kΩ holds up far better, at 10× the wasted current.',
    'That’s why dividers feed high-impedance inputs (meters, ADC pins, op-amps), never motors or LEDs. To power something, use a regulator.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'pair',
      options: [
        { value: '10k', label: 'R₁ = R₂ = 10 kΩ' },
        { value: '1k', label: '1 kΩ' },
      ],
      initial: '10k',
    },
    { kind: 'slider', key: 'load', label: 'Load RL', min: 100, max: 1e6, initial: 10e3, log: true, format: (v) => ohms(nearestE12(v)) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const [top, bottom] = dividerFrame(scene, L_X)
    wire(scene, [[L_X, 0, 0], [LOAD_X, 0, 0], [LOAD_X, -H, 0], [L_X, -H, 0]])
    const loadHolder = add(scene, new THREE.Group(), [LOAD_X, -H / 2, 0])
    const perVolt = (2 * H) / VIN
    const stack = voltStack(scene, 2, perVolt, VIN, 1)
    stack.group.position.set(-5, -H, -1.2)
    const mark = box(scene, [2.2, 0.16, 1.2], mat(RING, { emissive: '#aa8800' }), [-5, 0, -1.2])

    let mid = 0.5
    const fraction = (x: number, y: number) => {
      if (x <= -W + 0.01) return cellFraction(y)
      if (y >= H - 0.01) return 1
      if (y <= -H + 0.01) return 0
      if (x > L_X + 0.01 && x < LOAD_X - 0.01) return mid
      if (x >= LOAD_X - 0.01) return y > -H / 2 + RS ? mid : y < -H / 2 - RS ? 0 : lerp(0, mid, (y + H / 2 + RS) / (2 * RS))
      return columnFraction(y, mid)
    }
    const paint = (at: THREE.Vector3) => fraction(at.x, at.y)
    const mainFlow = plusFlow(scene, [[L_X, -H, LANE], [-W, -H, LANE], [-W, H, LANE], [L_X, H, LANE], [L_X, 0, LANE]], paint)
    const r2Flow = plusFlow(scene, [[L_X, 0, LANE], [L_X, -H, LANE]], paint)
    const loadFlow = plusFlow(scene, [[L_X, 0, LANE], [LOAD_X, 0, LANE], [LOAD_X, -H, LANE], [L_X, -H, LANE]], paint)

    const voutLabel = pulseLabel(scene, 3, RING, [(L_X + LOAD_X) / 2, 2, 0], 1.6)
    const iLabel = pulseLabel(scene, 4, CONVENTIONAL, [(L_X + LOAD_X) / 2, -H / 2, 0], 1.2)

    let shownR = NaN
    let shownLoad = NaN
    let shownV = VIN / 2
    return {
      scene,
      view: { center: [-1.2, 0.2, 0], radius: 44, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const s = solveLoad(p)
        if (s.r !== shownR) {
          shownR = s.r
          swapResistor(top, s.r, [0, 1, 0], [0, -1, 0])
          swapResistor(bottom, s.r, [0, 1, 0], [0, -1, 0])
        }
        if (s.load !== shownLoad) {
          shownLoad = s.load
          swapResistor(loadHolder, s.load, [0, 1, 0], [0, -1, 0])
        }
        shownV += (s.vout - shownV) * ease(dt, 6)
        stack.set([shownV, VIN - shownV])
        mark.position.y = -H + s.unloaded * perVolt
        mid = shownV / VIN
        mainFlow.step(dt * mA(s.amps) * L_SPEED)
        r2Flow.step(dt * mA(s.amps2) * L_SPEED)
        loadFlow.step(dt * mA(s.loadAmps) * L_SPEED)
        voutLabel.show(fitDigits(s.vout, 3))
        iLabel.show(fitDigits(mA(s.loadAmps), 4))
        for (const l of [voutLabel, iLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveLoad(p)
        return [
          { label: 'Unloaded', value: volts(s.unloaded) },
          { label: 'Vout', value: volts(s.vout), tone: s.sag > 0.2 ? 'bad' : s.sag > 0.05 ? 'warn' : 'ok' },
          { label: 'Sag', value: `${+(s.sag * 100).toPrecision(2)} %` },
          { label: 'Load I', value: amps(s.loadAmps) },
        ]
      },
    }
  },
}

// --- Divider as a sensor input: a thermistor as one half turns temperature into a voltage the ADC reads. ---

const VCC = 3.3
const ADC_BITS = 12
const FIXED_OHMS = 10e3
const NTC = { ohmsAt25C: 10e3, beta: 3950 }
const T_MIN = -10
const T_MAX = 60
const S_X = -1
const BOARD_X = 8.6
const BOARD_Y = -2.6
const BOARD_SCALE = 0.42
const PIN_X = -4 // header pins run x = −7..7 on the board
const GND_PIN_X = 6
const S_SPEED = 20

const solveSensor = (p: Params) => {
  const tempC = n(p, 'temp')
  const ntc = thermistorResistance(NTC, tempC)
  const ntcOnTop = p.ntc === 'top'
  const [r1, r2] = ntcOnTop ? [ntc, FIXED_OHMS] : [FIXED_OHMS, ntc]
  const vout = dividerOut(VCC, r1, r2)
  return { tempC, ntc, ntcOnTop, r1, r2, vout, counts: adcCounts(vout, VCC, ADC_BITS), amps: VCC / (r1 + r2) }
}

export const dividerSensor: Lesson = {
  id: 'voltage-divider-divider-as-a-sensor-input',
  title: 'Divider as a sensor input',
  tagline: 'Resistance in, voltage out',
  formula: (p) => {
    const s = solveSensor(p)
    return `Vout = 3.3 V × ${s.ntcOnTop ? '10 kΩ' : 'R_NTC'} / (${s.ntcOnTop ? 'R_NTC + 10 kΩ' : '10 kΩ + R_NTC'}) = ${volts(s.vout)} → ${s.counts}`
  },
  legend: [
    { color: OHMS_LABEL, label: 'Thermistor, kΩ', shape: 'dot' },
    { color: RING, label: 'Vout, V', shape: 'dot' },
    { color: POWER, label: 'ADC reading, 0–4095', shape: 'dot' },
  ],
  points: [
    'Many sensors are just resistors that change: thermistors with heat, LDRs with light, pots with angle. A microcontroller can’t read ohms, only volts.',
    'So pair the sensor with a fixed resistor in a divider across 3.3 V. As its resistance moves, the tap moves, and the ESP32’s ADC pin reads it.',
    'This NTC thermistor is 10 kΩ at 25 °C and falls as it warms. Matched with a 10 kΩ fixed resistor, 25 °C sits mid-scale: 1.65 V, about 2048 of 4095.',
    'Put the thermistor on the bottom and the reading falls as it heats; on top it rises. Same circuit, flipped. Firmware just has to know which.',
    'Choose the fixed resistor near the sensor’s mid-range value: the reading swings most there. The curve isn’t linear; code converts it back to °C.',
  ],
  controls: [
    { kind: 'slider', key: 'temp', label: 'Temperature', min: T_MIN, max: T_MAX, initial: 25, step: 1, format: (v) => `${Math.round(v)} °C` },
    {
      kind: 'choice',
      key: 'ntc',
      options: [
        { value: 'bottom', label: 'NTC on bottom' },
        { value: 'top', label: 'NTC on top' },
      ],
      initial: 'bottom',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const [top, bottom] = dividerFrame(scene, S_X)
    const board = buildEsp32()
    board.scale.setScalar(BOARD_SCALE)
    board.rotation.x = Math.PI / 2
    board.position.set(BOARD_X, BOARD_Y, 0)
    scene.add(board)
    const pinZ = 3.6 * BOARD_SCALE
    const pinX = BOARD_X + PIN_X * BOARD_SCALE
    const gndX = BOARD_X + GND_PIN_X * BOARD_SCALE
    const pinTop = BOARD_Y + 5 * BOARD_SCALE
    const pinBottom = BOARD_Y - 5 * BOARD_SCALE
    wire(scene, [[S_X, 0, 0], [pinX, 0, 0], [pinX, pinTop, pinZ]], 0.22)
    wire(scene, [[S_X, -H, 0], [gndX, -H, 0], [gndX, pinBottom, pinZ]], 0.22)

    const meter = thermometer(9)
    meter.group.scale.setScalar(0.45)
    scene.add(meter.group)
    let sensor: ReturnType<typeof thermistorAlong> | null = null

    let mid = 0.5
    const fraction = (x: number, y: number) => {
      if (x <= -W + 0.01) return cellFraction(y)
      if (y >= H - 0.01) return 1
      if (y <= -H + 0.01) return 0
      return columnFraction(y, mid)
    }
    const flow = plusFlow(scene, [[-W, -H, LANE], [-W, H, LANE], [S_X, H, LANE], [S_X, -H, LANE]], (at) => fraction(at.x, at.y), true)

    const rLabel = pulseLabel(scene, 3, OHMS_LABEL, [S_X - 5.6, 0, 0], 1.3)
    const voutLabel = pulseLabel(scene, 3, RING, [(S_X + pinX) / 2, 1.8, 0], 1.5)
    const adcLabel = pulseLabel(scene, 4, POWER, [BOARD_X + 1, BOARD_Y + 5.6, 0], 1.6)

    let shownSide = ''
    let shownV = VCC / 2
    return {
      scene,
      view: { center: [1, 0.2, 0], radius: 47, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const s = solveSensor(p)
        const side = s.ntcOnTop ? 'top' : 'bottom'
        if (side !== shownSide) {
          shownSide = side
          const [ntcHolder, fixedHolder] = s.ntcOnTop ? [top, bottom] : [bottom, top]
          emptyGroup(ntcHolder)
          sensor = thermistorAlong(ntcHolder, [0, 1, 0], [0, -1, 0], R_SCALE)
          swapResistor(fixedHolder, FIXED_OHMS, [0, 1, 0], [0, -1, 0])
          const y = s.ntcOnTop ? H / 2 : -H / 2
          meter.group.position.set(S_X - 2.6, y - 2.6, -0.4)
          rLabel.display.group.position.y = y
        }
        const warmth = (s.tempC - T_MIN) / (T_MAX - T_MIN)
        sensor!.set(warmth)
        meter.set(warmth)
        shownV += (s.vout - shownV) * ease(dt, 8)
        mid = shownV / VCC
        flow.step(dt * mA(s.amps) * S_SPEED)
        rLabel.show(fitDigits(s.ntc / 1000, 3))
        voutLabel.show(fitDigits(s.vout, 3))
        adcLabel.show(String(s.counts))
        for (const l of [rLabel, voutLabel, adcLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveSensor(p)
        return [
          { label: 'Thermistor', value: ohms(s.ntc) },
          { label: 'Vout', value: volts(s.vout), tone: 'ok' },
          { label: 'ADC (12-bit)', value: String(s.counts) },
          { label: 'Current I', value: amps(s.amps) },
        ]
      },
    }
  },
}
