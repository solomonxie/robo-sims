import * as THREE from 'three/webgpu'
import { ohmsLaw, thermistorResistance } from '../../core/formulas'
import {
  RESISTIVITY,
  ROOM_C,
  TEMP_COEFF,
  awgDiameter,
  metalResistance,
  relativeChange,
  wireArea,
  wireResistance,
} from '../../core/physics'
import { BAND_COLORS, BAND_NAMES, TOLERANCE, bandValue, nearestE12, resistorDigits, toleranceRange } from '../../core/resistorColors'
import { sci, si, superscript } from '../../core/units'
import { TIN, add, box, mat, mesh } from '../../models/kit'
import { resistorBody } from '../../models/passives'
import { createStage } from '../../scene/stage'
import {
  ELECTRON,
  HIGH_V,
  RING,
  arrow,
  clamp01,
  countingRing,
  electronGas,
  emptyGroup,
  glassTube,
  glowMat,
  heatGlow,
  ionLattice,
  segmentDisplay,
  thermometer,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const ohms = (v: number) => si(v, 'Ω', 3)
const signedPercent = (f: number) => `${f >= 0 ? '+' : ''}${+(f * 100).toPrecision(3)} %`

// --- Resistivity and wire gauge: R = ρL/A, drawn as a see-through wire you stretch and thicken. ---

type Metal = 'copper' | 'aluminium' | 'nichrome'

const ION_COLORS: Record<Metal, string[]> = {
  copper: ['#d08a4e'],
  aluminium: ['#c4cad3'],
  nichrome: ['#a9aeb6', '#6f747c'],
}
const SCATTER: Record<Metal, number> = { copper: 3, aluminium: 4.5, nichrome: 14 } // collisions/s, drawn
const MIN_M = 0.1
const MAX_M = 10
const REF_GAUGE = 22

const drawnLength = (m: number) => 7 + 17 * (Math.log10(m / MIN_M) / Math.log10(MAX_M / MIN_M))
const drawnRadius = (diameterM: number) => 0.7 + diameterM * 900

function wireNumbers(p: Params) {
  const rho = RESISTIVITY[p.metal as Metal]
  const d = awgDiameter(n(p, 'gauge'))
  const r = wireResistance(rho, n(p, 'len'), d)
  return { rho, d, r }
}

export const resistivityAndGauge: Lesson = {
  id: 'resistance-resistivity-and-wire-gauge',
  title: 'Resistivity and wire gauge',
  tagline: 'Material, length and thickness',
  formula: 'R = ρ · L / A',
  legend: [
    { color: ELECTRON, label: 'Free electron', shape: 'dot' },
    { color: '#d08a4e', label: 'Metal ion', shape: 'dot' },
    { color: RING, label: 'Cross-section A', shape: 'dot' },
    { color: ELECTRON, label: 'Drift at 1 A', shape: 'arrow-left' },
  ],
  points: [
    'Drifting electrons keep bumping into the metal’s vibrating ions. Resistance measures how hard that makes it to push a current through.',
    'Length: twice as long is twice as many ions in the way, so twice the resistance.',
    'Thickness: a fatter wire has more lanes side by side. R falls with the cross-section A, and A goes with diameter², so half the diameter is four times the resistance.',
    'Wire gauge (AWG) runs backwards: a bigger number is thinner. Every 3 gauges doubles the resistance. Breadboard jumpers are 22 AWG, about 52 mΩ per metre.',
    'ρ (resistivity) is the material. Aluminium is 1.6× copper; nichrome, a jumbled nickel-chromium alloy, is ~65× copper, which is why heaters use it.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'metal',
      options: [
        { value: 'copper', label: 'Copper' },
        { value: 'aluminium', label: 'Aluminium' },
        { value: 'nichrome', label: 'Nichrome' },
      ],
      initial: 'copper',
    },
    { kind: 'slider', key: 'len', label: 'Length', min: MIN_M, max: MAX_M, initial: 2, log: true, format: (v) => si(v, 'm', 2) },
    { kind: 'slider', key: 'gauge', label: 'Gauge', min: 10, max: 30, initial: REF_GAUGE, step: 1, format: (v) => `${v} AWG` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const wireGroup = new THREE.Group()
    scene.add(wireGroup)
    let gas: ReturnType<typeof electronGas> | null = null
    let vibrate = (_t: number) => {}
    let drift = 0
    let scatter = 0
    let built = ''
    let t = 0

    const rebuild = (p: Params) => {
      emptyGroup(wireGroup)
      const d = awgDiameter(n(p, 'gauge'))
      const length = drawnLength(n(p, 'len'))
      const radius = drawnRadius(d)
      glassTube(wireGroup, length, radius)
      countingRing(wireGroup, radius, -length / 2)
      arrow(wireGroup, [0, radius + 2, 0], [-1, 0, 0], ELECTRON, 1.1)
      vibrate = ionLattice(wireGroup, length, radius, { spacing: 1.8, size: 0.45, colors: ION_COLORS[p.metal as Metal] }).vibrate
      gas = electronGas(wireGroup, length, radius, { count: Math.round(Math.min(260, Math.max(8, 0.4 * length * Math.PI * radius ** 2))) })
      drift = 1.5 * (awgDiameter(REF_GAUGE) / d) ** 1.2
      scatter = SCATTER[p.metal as Metal]
    }

    return {
      scene,
      view: { center: [0, 0.6, 0], radius: 44, polar: 1.3, azimuth: 0.25 },
      frame(dt, p) {
        const key = `${p.metal}|${p.len}|${p.gauge}`
        if (key !== built) {
          rebuild(p)
          built = key
        }
        t += dt
        vibrate(t)
        gas!.step(dt, drift, scatter)
      },
      readouts: (p) => {
        const { rho, d, r } = wireNumbers(p)
        const drop = ohmsLaw({ ampsA: 1, ohms: r }).voltsV
        return [
          { label: 'Resistance', value: ohms(r) },
          { label: `${n(p, 'gauge')} AWG`, value: `${+(d * 1000).toPrecision(3)} mm · ${+(wireArea(d) * 1e6).toPrecision(3)} mm²` },
          { label: 'Resistivity ρ', value: `${sci(rho)} Ω·m` },
          { label: 'Drop at 1 A', value: si(drop, 'V', 3), tone: drop > 1 ? 'bad' : drop > 0.1 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Temperature effects: heat shakes the lattice; metals resist more, a thermistor less. ---

type Element = 'copper' | 'nichrome' | 'ntc'

const R_ROOM = 100
const SUPPLY = 5
const NTC_BETA = 3950
const T_MIN = -40
const T_MAX = 150
const HOT_LENGTH = 22
const HOT_RADIUS = 3
const MAX_ELECTRONS = 140
const DRIFT = 1.5

const ELEMENT_IONS: Record<Element, string[]> = {
  copper: ['#d08a4e'],
  nichrome: ['#a9aeb6', '#6f747c'],
  ntc: ['#5b6170', '#3f4450'],
}

function elementOhms(e: Element, tempC: number) {
  if (e === 'ntc') return thermistorResistance({ ohmsAt25C: R_ROOM, beta: NTC_BETA }, tempC)
  return metalResistance(R_ROOM, TEMP_COEFF[e], tempC)
}

export const temperatureEffects: Lesson = {
  id: 'resistance-temperature-effects',
  title: 'Temperature effects',
  tagline: 'Hot metal resists more',
  formula: (p) => (p.element === 'ntc' ? 'R = R₀ · e^(B(1/T − 1/T₀))' : 'R = R₀ (1 + α ΔT)'),
  legend: [
    { color: ELECTRON, label: 'Free electron', shape: 'dot' },
    { color: RING, label: 'Resistance, Ω', shape: 'dot' },
    { color: HIGH_V, label: 'Temperature', shape: 'dot' },
    { color: ELECTRON, label: `Drift at ${SUPPLY} V`, shape: 'arrow-left' },
  ],
  points: [
    'Heat makes a metal’s ions vibrate harder. Drifting electrons hit them more often, so resistance rises with temperature.',
    'For metals it’s close to a straight line: R = R₀(1 + αΔT). Copper’s α is about 0.39 % per °C, so 100 °C hotter is ~39 % more resistance.',
    'Nichrome’s α is ten times smaller, so a heater’s resistance, and its power, stays steady as it warms up.',
    'An NTC thermistor goes the other way. It’s a semiconductor: heat frees more charge carriers, so resistance falls steeply. That makes it a good thermometer.',
    'A cold bulb filament has about a tenth of its hot resistance, which is why bulbs draw a surge and usually fail at switch-on.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'element',
      options: [
        { value: 'copper', label: 'Copper' },
        { value: 'nichrome', label: 'Nichrome' },
        { value: 'ntc', label: 'Thermistor' },
      ],
      initial: 'copper',
    },
    { kind: 'slider', key: 'temp', label: 'Temperature', min: T_MIN, max: T_MAX, initial: ROOM_C, step: 5, format: (v) => `${v} °C` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const body = new THREE.Group()
    scene.add(body)
    glassTube(scene, HOT_LENGTH, HOT_RADIUS)
    arrow(scene, [3, HOT_RADIUS + 1.8, 0], [-1, 0, 0], ELECTRON, 1.1)
    const gauge = thermometer(9)
    gauge.group.position.set(-HOT_LENGTH / 2 - 3, -4.5, 0)
    scene.add(gauge.group)
    const display = segmentDisplay(4, 1.8, RING, true)
    display.group.position.set(-4, HOT_RADIUS + 2, 0)
    scene.add(display.group)

    let lattice: ReturnType<typeof ionLattice> | null = null
    let shownElement = ''
    let shownOhms = NaN
    let t = 0
    const gas = electronGas(scene, HOT_LENGTH, HOT_RADIUS, { count: MAX_ELECTRONS })

    return {
      scene,
      view: { center: [-1.5, 0.8, 0], radius: 44, polar: 1.3, azimuth: 0.3 },
      frame(dt, p) {
        const e = p.element as Element
        const temp = n(p, 'temp')
        if (e !== shownElement) {
          emptyGroup(body)
          lattice = ionLattice(body, HOT_LENGTH, HOT_RADIUS, { colors: ELEMENT_IONS[e] })
          shownElement = e
        }
        const r = elementOhms(e, temp)
        const heat = clamp01((temp - T_MIN) / (T_MAX - T_MIN))
        t += dt
        lattice!.vibrate(t, 0.03 + 0.25 * heat)
        heatGlow(lattice!.ions.material as THREE.MeshStandardMaterial, (temp - 60) / (T_MAX - 60))
        gauge.set(heat)
        const current = R_ROOM / r // relative to room temperature
        if (e === 'ntc') {
          const carriers = clamp01(0.5 + 0.3 * Math.log10(current))
          gas.mesh.count = Math.max(6, Math.round(MAX_ELECTRONS * carriers))
          gas.step(dt, Math.min(4.5, (DRIFT * current * 0.5) / Math.max(0.05, carriers)), 4)
        } else {
          gas.mesh.count = MAX_ELECTRONS
          gas.step(dt, DRIFT * current, 4 * (r / R_ROOM) ** 3)
        }
        const rounded = Math.round(r)
        if (rounded !== shownOhms) {
          display.set(String(rounded))
          shownOhms = rounded
        }
      },
      readouts: (p) => {
        const e = p.element as Element
        const r = elementOhms(e, n(p, 'temp'))
        return [
          { label: 'Resistance', value: ohms(r) },
          { label: `vs ${ROOM_C} °C`, value: signedPercent(relativeChange(r, R_ROOM)) },
          { label: `Current at ${SUPPLY} V`, value: si(ohmsLaw({ voltsV: SUPPLY, ohms: r }).ampsA, 'A', 3) },
          e === 'ntc'
            ? { label: 'Beta B', value: `${NTC_BETA} K` }
            : { label: 'Coefficient α', value: `${+(TEMP_COEFF[e] * 100).toPrecision(2)} %/°C` },
        ]
      },
    }
  },
}

// --- Reading resistor bands: a giant resistor, a colour key, and the bands read one at a time. ---

const SCALE = 6
const BAND_X = [-0.78, -0.42, -0.08, 0.72].map((x) => x * SCALE)
const BODY_Y = 1.5
const KEY_Y = -6.2
const KEY_PITCH = 2.3
const READ_S = 1.3
const LABEL_Y = BODY_Y + 4.6

const keyX = (digit: number) => (digit - 4.5) * KEY_PITCH

function decode(p: Params) {
  const value = nearestE12(n(p, 'ohms'))
  const { first, second, exponent } = resistorDigits(value)
  return { value, first, second, exponent }
}

export const readingResistorBands: Lesson = {
  id: 'resistance-reading-resistor-bands',
  title: 'Reading resistor bands',
  tagline: 'Two digits and a count of zeros',
  formula: (p) => {
    const { first, second, exponent } = decode(p)
    return `${first}${second} × 10${superscript(exponent)} Ω = ${si(bandValue(first, second, exponent), 'Ω', 2)}`
  },
  legend: [{ color: RING, label: 'Band being read', shape: 'dot' }],
  points: [
    'A resistor is too small to print on, so its value is painted as colour bands. Hold it with the gold band on the right and read left to right.',
    'Each colour is a digit: black 0, brown 1, red 2, orange 3, yellow 4, green 5, blue 6, violet 7, grey 8, white 9. The card below is the key.',
    'The first two bands are digits. The third is the multiplier: how many zeros to add. Yellow, violet, red is 4, 7 and two zeros: 4700 Ω = 4.7 kΩ.',
    'The last band is tolerance. Gold means the real value is within ±5 %, so a 4.7 kΩ part can measure anywhere from about 4.47 to 4.94 kΩ.',
    'Values come in standard steps, E12: 10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82 in every decade. That’s why the slider snaps.',
  ],
  controls: [
    { kind: 'slider', key: 'ohms', label: 'Value', min: 10, max: 1e6, initial: 4700, log: true, format: (v) => si(nearestE12(v), 'Ω', 2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const part = new THREE.Group()
    part.position.y = BODY_Y
    scene.add(part)
    const lead = TIN()
    for (const s of [-1, 1]) add(part, mesh(new THREE.CylinderGeometry(0.4, 0.4, 5, 16), lead), [s * 9.5, 0, 0]).rotation.z = Math.PI / 2
    let resistor: THREE.Group | null = null

    const highlight = add(part, mesh(new THREE.TorusGeometry(3.25, 0.16, 12, 64), glowMat(RING, 1.2)))
    highlight.rotation.y = Math.PI / 2

    const digit1 = segmentDisplay(1, 2, '#e8e8e8', true)
    const digit2 = segmentDisplay(1, 2, '#e8e8e8', true)
    const zeros = segmentDisplay(5, 2, '#e8e8e8', true)
    const zeroPitch = 2 * 0.82
    digit1.group.position.set(BAND_X[0], LABEL_Y, 0)
    digit2.group.position.set(BAND_X[1], LABEL_Y, 0)
    zeros.group.position.set(BAND_X[2] + 2 * zeroPitch, LABEL_Y, 0)
    const tolerance = segmentDisplay(1, 1.4, RING, true)
    tolerance.group.position.set(BAND_X[3], BODY_Y - 4.3, 0)
    tolerance.set(String(TOLERANCE.percent))
    scene.add(digit1.group, digit2.group, zeros.group, tolerance.group)
    const labels = [digit1.group, digit2.group, zeros.group, tolerance.group]

    box(scene, [10 * KEY_PITCH + 0.8, 4.4, 0.4], mat('#d9dce2', { rough: 0.8 }), [0, KEY_Y - 0.8, -0.3])
    const swatches = BAND_COLORS.map((color, d) => {
      const s = box(scene, [1.7, 1.5, 0.5], mat(color, { rough: 0.5 }), [keyX(d), KEY_Y, 0.2])
      const label = segmentDisplay(1, 1.1)
      label.set(String(d))
      label.group.position.set(keyX(d), KEY_Y - 2, 0.05)
      scene.add(label.group)
      return s
    })

    let shown = NaN
    let t = 0
    return {
      scene,
      view: { center: [0, -2.2, 0], radius: 46, polar: 1.4, azimuth: 0.12 },
      frame(dt, p) {
        const { value, first, second, exponent } = decode(p)
        if (value !== shown) {
          if (resistor) part.remove(resistor)
          resistor = add(part, resistorBody(value))
          resistor.scale.setScalar(SCALE)
          digit1.set(String(first))
          digit2.set(String(second))
          zeros.set('0'.repeat(exponent).padEnd(5, ' '))
          shown = value
          t = 0
        }
        t += dt
        const step = Math.floor(t / READ_S) % 4
        const f = (t % READ_S) / READ_S
        highlight.position.x = BAND_X[step]
        const pick = [first, second, exponent, -1][step]
        swatches.forEach((s, d) => {
          const on = d === pick
          s.scale.setScalar(on ? 1.25 : 1)
          s.position.z = on ? 0.9 : 0.2
        })
        labels.forEach((g, i) => g.scale.setScalar(i === step ? 1 + 0.25 * Math.sin(Math.PI * Math.min(1, f * 2)) : 1))
        part.rotation.y = 0.08 * Math.sin(t * 0.6)
      },
      readouts: (p) => {
        const { first, second, exponent } = decode(p)
        const value = bandValue(first, second, exponent)
        const [lo, hi] = toleranceRange(value, TOLERANCE.percent)
        return [
          { label: 'Digits', value: `${BAND_NAMES[first]} ${first} · ${BAND_NAMES[second]} ${second}` },
          { label: 'Multiplier', value: `${BAND_NAMES[exponent]} ×${10 ** exponent}` },
          { label: 'Value', value: si(value, 'Ω', 2) },
          { label: `${TOLERANCE.name} ±${TOLERANCE.percent} %`, value: `${si(lo, 'Ω', 3)} – ${si(hi, 'Ω', 3)}` },
        ]
      },
    }
  },
}
