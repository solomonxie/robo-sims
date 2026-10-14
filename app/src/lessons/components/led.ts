import * as THREE from 'three/webgpu'
import { minLedResistor } from '../../core/circuit'
import { LED_MAX_A, LED_RATED_A, LEDS, Led, diodeAmps, diodeNode, matrixScan, photonEv, rowOnFractions } from '../../core/physics'
import { e12Above } from '../../core/resistorColors'
import { fitDigits, ohms, si, tiny, volts } from '../../core/units'
import { V3, add, mesh, rod } from '../../models/kit'
import { LED_DOME, buildRgbLed } from '../../models/passives'
import { createStage } from '../../scene/stage'
import {
  CELL_H,
  CONVENTIONAL,
  GREY,
  HIGH_V,
  LANE,
  LOW_V,
  RING,
  RS,
  cell,
  cellFraction,
  clamp01,
  dropAlong,
  ease,
  emptyGroup,
  glowHalo,
  glowMat,
  groundSymbol,
  icPackage,
  ivScreen,
  ledLamp,
  plusFlow,
  presence,
  pulseLabel,
  scope,
  smoke,
  swapResistor,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, e12, n, resistorSlider } from '../types'

const VIEW = { center: [-0.4, 2.4, 0] as V3, radius: 56, polar: 1.42, azimuth: 0.1 }

// --- Shared loop: cell (left), resistor (top), LED standing on the bottom wire, anode to the right. ---

const L = -15
const X = -3
const H = 5.5
const LX = -6.5
const LED_SCALE = 1.6
const LEG = 0.5 * LED_SCALE
const DIE_Y = -H + 3.8 * LED_SCALE
const R_AT = (L + X) / 2

/** Loop with + charges painted by potential: `live.vs` at the cell top, `live.vf` on the LED's anode. */
function ledLoop(scene: THREE.Scene, vmax: number) {
  wire(scene, [[LX + LEG, -H, 0], [X, -H, 0], [X, H, 0], [L, H, 0], [L, -H, 0], [LX - LEG, -H, 0]])
  add(scene, cell(CELL_H, 1.5), [L, 0, 0])
  const resistor = add(scene, new THREE.Group())
  const holder = add(scene, new THREE.Group())
  const live = { vs: 0, vf: 0 }
  const z = LANE + 0.7
  const flow = plusFlow(
    scene,
    [[LX - LEG, -H, LANE], [L, -H, LANE], [L, H, LANE], [X, H, LANE], [X, -H, LANE], [LX + LEG, -H, LANE], [LX + LEG, DIE_Y, z], [LX - LEG, DIE_Y, z]],
    (at) => {
      const top = live.vs / vmax
      const vf = live.vf / vmax
      if (at.x <= L + 0.01) return top * cellFraction(at.y)
      if (at.y >= H - 0.01) return dropAlong(at, [L, H, 0], [X, H, 0], top, vf, RS)
      if (at.x >= LX + LEG - 0.01) return vf
      if (at.y <= -H + 0.01) return 0
      return vf * clamp01((at.x - LX + LEG) / (2 * LEG))
    },
    true,
  )
  let shown = NaN
  return {
    holder,
    live,
    flow,
    setOhms(r: number) {
      if (r === shown) return
      shown = r
      swapResistor(resistor, r, [R_AT - 1, H, 0], [R_AT + 1, H, 0])
    },
  }
}

// --- Forward voltage and colour: the photon's energy sets the colour, and the voltage it takes to light. ---

const R1 = 150
const V1_MAX = 6
const S1: V3 = [6.8, 0.4, 0]
const S1_W = 11
const S1_H = 8
const V1_FULL = 4
const I1_FULL = 0.03
type Colour = keyof typeof LEDS
const COLOURS = Object.keys(LEDS) as Colour[]
const colourOf = (p: Params): Colour => (COLOURS.includes(p.color as Colour) ? (p.color as Colour) : 'red')

export const forwardVoltageAndColour: Lesson = {
  id: 'led-forward-voltage-and-colour',
  title: 'Forward voltage and colour',
  tagline: 'Bluer light, bigger push',
  formula: (p) => {
    const d = LEDS[colourOf(p)]
    const r = diodeNode(n(p, 'v'), R1, d)
    return `E = hc/λ = 1240 / ${d.nm} nm = ${photonEv(d.nm).toFixed(2)} eV · I = (V − Vf) / R = (${volts(n(p, 'v'))} − ${volts(r.v)}) / ${ohms(R1)} = ${si(r.sourceA, 'A', 3)}`
  },
  legend: [
    { color: '#ffffff', label: 'I–V of each colour; dot = now', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Current I, mA', shape: 'dot' },
    { color: '#e8e8e8', label: 'LED drop Vf, V', shape: 'dot' },
    { color: HIGH_V, label: 'Wires by potential', shape: 'dot' },
  ],
  points: [
    'An LED is a diode that gives its energy away as light: each charge that crosses the junction can free one photon.',
    'The photon’s energy is set by the chip’s material, and so is its colour: E = hc/λ. Red light at 625 nm carries 1.98 eV, blue at 470 nm 2.64 eV.',
    'A charge can’t give more energy than the voltage gave it, so Vf follows the colour: red ~2.0 V, yellow 2.2 V, true green 3.0 V, blue 3.1 V. A bit extra is lost as heat.',
    'White LEDs are blue chips under a yellow phosphor, so they need blue’s ~3.2 V. Drop the battery to 3 V: red still shines, blue barely glows.',
    'Light follows current, not voltage. Past the knee, ×10 the current costs only ~0.12 V more, which is why every LED needs a resistor.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'color',
      options: COLOURS.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })),
      initial: 'red',
    },
    { kind: 'slider', key: 'v', label: 'Battery', min: 0, max: V1_MAX, initial: 5, step: 0.1, format: volts },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const loop = ledLoop(scene, V1_MAX)
    loop.setOhms(R1)
    const iLabel = pulseLabel(scene, 3, CONVENTIONAL, [R_AT, H + 1.8, 0], 1.2)
    const vLabel = pulseLabel(scene, 3, '#e8e8e8', [L + 4.4, -1.6, 0], 1.1)

    const { plot, dot, y } = ivScreen(scene, S1, S1_W, S1_H, [8, 3])
    ticks(plot, [[0.25, '1'], [0.5, '2'], [0.75, '3'], [1, '4']], [[1 / 3, '10'], [1, '30']])
    const curve = (d: Led) => (u: number) => y(diodeAmps(u * V1_FULL, d) / I1_FULL)
    for (const c of COLOURS) {
      const t = plot.trace(LEDS[c].color, { radius: 0.06 })
      t.material.emissiveIntensity = 0.35
      t.draw(curve(LEDS[c]), null)
    }
    const live = plot.trace('#ffffff', { radius: 0.14 })
    const level = plot.level(CONVENTIONAL)

    const state = { c: '' as Colour | '', v: 5, vf: 0, amps: 0 }
    let lamp: ReturnType<typeof ledLamp> | null = null
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const c = colourOf(p)
        const d = LEDS[c]
        if (c !== state.c) {
          state.c = c
          emptyGroup(loop.holder)
          lamp = ledLamp(loop.holder, d.color, [LX, -H, 0], { scale: LED_SCALE })
          live.material.color.set(d.color)
          live.material.emissive.set(d.color)
          live.draw(curve(d), null)
        }
        state.v += (n(p, 'v') - state.v) * ease(dt, 5)
        const r = diodeNode(state.v, R1, d)
        state.vf = r.v
        state.amps = r.sourceA
        loop.live.vs = state.v
        loop.live.vf = r.v
        lamp?.set(r.sourceA / LED_RATED_A)
        lamp?.step(dt)
        dot.position.set(plot.xAt(r.v / V1_FULL), y(Math.min(1, r.sourceA / I1_FULL)), 0.4)
        level.set(y(r.sourceA / I1_FULL))
        loop.flow.step(dt * 150 * r.sourceA)
        iLabel.show(fitDigits(r.sourceA * 1000, 3))
        vLabel.show(fitDigits(r.v, 3))
        iLabel.frame(dt)
        vLabel.frame(dt)
      },
      readouts: (p) => {
        const d = LEDS[colourOf(p)]
        return [
          { label: 'LED drop Vf', value: `${state.vf.toFixed(2)} V`, tone: 'ok' },
          { label: 'Current', value: si(tiny(state.amps, 1e-9), 'A', 3), tone: state.amps > LED_RATED_A ? 'warn' : undefined },
          { label: 'Photon', value: `${photonEv(d.nm).toFixed(2)} eV` },
          { label: 'Wavelength', value: `${d.nm} nm` },
        ]
      },
    }
  },
}

// --- Current-limiting resistor: the resistor, not the LED, sets the current; without enough of it the LED burns. ---

const RED = LEDS.red
const V2_FULL = 10
const I2_FULL = 0.06
const BURN_A = 0.05
const S2: V3 = [6.8, 0.4, 0]
const SUPPLIES = ['3.3', '5', '9']

const solveLimit = (p: Params) => {
  const vs = SUPPLIES.includes(String(p.vs)) ? Number(p.vs) : 5
  return { vs, r: e12(p, 'r') }
}

export const currentLimitingResistor: Lesson = {
  id: 'led-current-limiting-resistor',
  title: 'Current-limiting resistor',
  tagline: 'The resistor sets the brightness',
  formula: (p) => {
    const s = solveLimit(p)
    const min = minLedResistor(s.vs, RED.vf, LED_RATED_A * 1000)
    const r = diodeNode(s.vs, s.r, RED)
    return `R ≥ (Vs − Vf) / 20 mA = (${volts(s.vs)} − ${volts(RED.vf)}) / 20 mA = ${ohms(min)} → ${ohms(e12Above(min))} · now ${ohms(s.r)}: ${si(r.sourceA, 'A', 3)}`
  },
  legend: [
    { color: RED.color, label: 'LED I–V; dot = now', shape: 'dot' },
    { color: GREY, label: 'What the resistor allows', shape: 'dot' },
    { color: RING, label: '20 mA rated', shape: 'dot' },
    { color: HIGH_V, label: '30 mA max', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Current I, mA', shape: 'dot' },
  ],
  points: [
    'An LED barely limits its own current: past the knee its curve is almost a wall. Connect it straight across a battery and the current climbs until it burns.',
    'So a resistor goes in series to take the rest of the voltage: R = (Vs − Vf) / I. For a red LED (2.0 V) at 20 mA from 5 V: 3 V / 20 mA = 150 Ω.',
    'On the plot the grey line is what the resistor lets through at each LED voltage. Where it meets the LED’s curve is the working point. A bigger R tilts the line flatter: less current, dimmer.',
    'Round up to the next standard value. 220–330 Ω from 5 V is the usual safe choice; LEDs are bright enough at 5–10 mA.',
    'Go below the minimum and the LED runs past its 30 mA limit. Small R at 9 V and it pops; pick a safe resistor and a fresh one goes in.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'vs',
      options: SUPPLIES.map((v) => ({ value: v, label: `${v} V` })),
      initial: '5',
    },
    { ...resistorSlider('r', 'Resistor', 220), min: 10 },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const loop = ledLoop(scene, 9)
    const lamp = ledLamp(loop.holder, RED.color, [LX, -H, 0], { scale: LED_SCALE })
    const flash = glowHalo(scene, [LX, DIE_Y + 0.6, 0], 1.6)
    const fumes = smoke(scene, 1.4)
    fumes.group.position.set(LX, DIE_Y + 2, 0)
    const iLabel = pulseLabel(scene, 3, CONVENTIONAL, [R_AT, H + 1.8, 0], 1.2)

    const { plot, dot, y } = ivScreen(scene, S2, S1_W, S1_H, [10, 6])
    ticks(plot, [[0.2, '2'], [0.5, '5'], [0.9, '9']], [[1 / 3, '20'], [0.5, '30'], [1, '60']])
    plot.trace(RED.color, { radius: 0.12 }).draw((u) => y(diodeAmps(u * V2_FULL, RED) / I2_FULL), null)
    const line = plot.trace(GREY, { radius: 0.08 })
    plot.level(RING).set(y(LED_RATED_A / I2_FULL))
    plot.level(HIGH_V).set(y(LED_MAX_A / I2_FULL))
    const level = plot.level(CONVENTIONAL)

    const state = { vs: 5, r: 0, vf: 0, amps: 0, heat: 0, burnt: false, pop: 0, fumes: 0, grow: 1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const s = solveLimit(p)
        state.r = s.r
        loop.setOhms(s.r)
        state.vs += (s.vs - state.vs) * ease(dt, 5)
        const alive = diodeNode(state.vs, s.r, RED)
        state.heat = alive.sourceA > BURN_A && !state.burnt ? state.heat + dt * 2 * (alive.sourceA / BURN_A - 1) : Math.max(0, state.heat - dt)
        if (state.heat >= 1) {
          state.burnt = true
          state.heat = 0
          state.pop = 1
          state.fumes = 1
          lamp.burn(true)
        }
        if (state.burnt && alive.sourceA <= LED_MAX_A) {
          state.burnt = false
          state.grow = 0
          lamp.burn(false)
        }
        state.grow += (1 - state.grow) * ease(dt, 6)
        presence(lamp.group, state.grow)
        state.pop = Math.max(0, state.pop - dt * 2.5)
        state.fumes = Math.max(0, state.fumes - dt / 3)
        flash.set(4 * state.pop * state.pop, '#fff1c8')
        fumes.step(dt, state.fumes)

        const amps = state.burnt ? 0 : alive.sourceA
        state.amps = amps
        state.vf = state.burnt ? state.vs : alive.v
        loop.live.vs = state.vs
        loop.live.vf = state.vf
        lamp.set((amps / LED_RATED_A) * (1 + 2 * clamp01(state.heat)))
        lamp.step(dt)
        line.draw((u) => y((state.vs - u * V2_FULL) / s.r / I2_FULL), null)
        dot.position.set(plot.xAt(state.vf / V2_FULL), y(Math.min(1, amps / I2_FULL)), 0.4)
        level.set(y(amps / I2_FULL))
        loop.flow.step(dt * 100 * Math.min(amps, 0.08))
        iLabel.show(fitDigits(amps * 1000, 3))
        iLabel.frame(dt)
      },
      readouts: () => {
        const tone = state.burnt || state.amps > LED_MAX_A ? 'bad' : state.amps > LED_RATED_A ? 'warn' : 'ok'
        const heat = state.amps * state.amps * state.r
        return [
          { label: 'LED current', value: si(tiny(state.amps, 1e-9), 'A', 3), tone },
          { label: 'Across R', value: volts(tiny(state.amps * state.r, 1e-3)) },
          { label: 'Resistor heat', value: si(tiny(heat, 1e-9), 'W', 2), tone: heat > 0.25 ? 'bad' : undefined },
          { label: 'LED', value: state.burnt ? 'Burnt out' : state.amps > LED_MAX_A ? 'Overdriven' : state.amps > 1e-4 ? 'Lit' : 'Dark', tone },
        ]
      },
    }
  },
}

// --- RGB LED: three dies under one diffused cap; PWM on each mixes any colour. ---

const VCC = 5
const PWM_HZ = 490
const SLOW3 = 490
const CHANNELS = [
  { key: 'r', label: 'Red', d: LEDS.red, ohms: 150, leg: -1.5 },
  { key: 'g', label: 'Green', d: LEDS.green, ohms: 100, leg: 0.5 },
  { key: 'b', label: 'Blue', d: LEDS.blue, ohms: 100, leg: 1.5 },
].map((c) => ({ ...c, on: diodeNode(VCC, c.ohms, c.d) }))
const MCU: V3 = [-16.5, -2.6, 0]
const PIN_X = MCU[0] + 1.7 + 0.85
const CH_Y = [-0.2, -2.6, -5]
const RX3 = -10
const LX3 = -3
const RGB_SCALE = 1.3
const LEG_Y = 1.2
const legX = (k: number) => LX3 + k * RGB_SCALE
const DIE3_Y = LEG_Y + 4.3 * RGB_SCALE
const GND_Y = 0.4
const VENN: V3 = [8.6, 3.4, 0]
const VENN_R = 2.6
const S3: V3 = [8.6, -4.6, 0]
const S3_W = 10
const S3_H = 4.2

const duties = (p: Params) => CHANNELS.map((c) => clamp01(n(p, c.key) / 100))

export const rgbLed: Lesson = {
  id: 'led-rgb-led',
  title: 'RGB LED',
  tagline: 'Three colours, one dot',
  formula: (p) => {
    const d = duties(p)
    const parts = CHANNELS.map((c, i) => `${c.label[0]} ${Math.round(d[i] * 100)}% × ${fitDigits(c.on.sourceA * 1000, 3)}`)
    return `I_avg = duty × (5 V − Vf) / R: ${parts.join(' · ')} mA`
  },
  legend: [
    { color: '#ffffff', label: 'Light adds: R + G = yellow', shape: 'dot' },
    { color: GREY, label: 'Scope: each pin’s PWM, slowed 490×', shape: 'dot' },
    { color: HIGH_V, label: 'Wires by potential', shape: 'dot' },
  ],
  points: [
    'An RGB LED packs a red, a green and a blue die under one milky cap. Here they share the cathode (the longest leg) to ground; each anode gets its own pin and resistor.',
    'Their forward voltages differ (red 2.0 V, green and blue ~3 V), so each needs its own resistor for 20 mA from 5 V: 150 Ω for red, 100 Ω for the others.',
    'Light adds: red + green looks yellow, green + blue cyan, all three white. Your eye has only three kinds of colour sensor, so three dies can fool it into seeing almost any colour.',
    'To dim a die, the pin is switched on and off fast (PWM, 490 Hz on an Arduino; the scope is slowed 490×). The eye averages, so light follows the duty cycle.',
    'The mix isn’t perfectly even: the eye is most sensitive to green, so real code scales each channel to balance white. On a 3.3 V board, green and blue barely reach their Vf.',
  ],
  controls: CHANNELS.map((c, i) => ({
    kind: 'slider' as const,
    key: c.key,
    label: `${c.label} duty`,
    min: 0,
    max: 100,
    initial: [100, 45, 0][i],
    step: 1,
    format: (v: number) => `${Math.round(v)} %`,
  })),
  build(): Stage {
    const scene = createStage({ span: 22 })
    add(scene, icPackage(3.4, 7.2, 3), MCU)
    const led = add(scene, buildRgbLed(), [LX3, LEG_Y + 1.5 * RGB_SCALE, 0])
    led.scale.setScalar(RGB_SCALE)
    const halo = glowHalo(scene, [LX3, DIE3_Y + 0.6, 0], 1.7)
    const cathode = legX(-0.5)
    wire(scene, [[cathode, LEG_Y, 0], [cathode, GND_Y, 0]])
    add(scene, groundSymbol(), [cathode, GND_Y, 0])

    const live = CHANNELS.map(() => ({ duty: 0, amps: 0 }))
    const flows = CHANNELS.map((c, i) => {
      const y = CH_Y[i]
      const lx = legX(c.leg)
      wire(scene, [[PIN_X, y, 0], [lx, y, 0], [lx, LEG_Y, 0]])
      swapResistor(add(scene, new THREE.Group()), c.ohms, [RX3 - 1, y, 0], [RX3 + 1, y, 0])
      const pts: V3[] = [[PIN_X, y, LANE], [lx, y, LANE], [lx, DIE3_Y, LANE]]
      return plusFlow(scene, pts, (at) => {
        const f = live[i].duty
        const vf = (f * c.on.v) / VCC
        return Math.abs(at.y - y) < 0.01 ? dropAlong(at, [PIN_X, y, 0], [2 * RX3 - PIN_X, y, 0], f, vf, RS) : vf
      })
    })
    const back = plusFlow(scene, [[cathode, DIE3_Y, LANE], [cathode, GND_Y, LANE]], () => 0)

    const venn = CHANNELS.map((c, i) => {
      const a = Math.PI / 2 + (i * 2 * Math.PI) / 3
      const at: V3 = [VENN[0] + 1.35 * Math.cos(a), VENN[1] + 1.35 * Math.sin(a), 0.1 * i]
      const material = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
      add(scene, mesh(new THREE.CircleGeometry(VENN_R, 48), material), at).castShadow = false
      const ring = add(scene, mesh(new THREE.TorusGeometry(VENN_R, 0.06, 6, 64), glowMat(c.d.color, 0.25)), at)
      ring.castShadow = false
      return material
    })

    const plot = scope(scene, S3_W, S3_H, { divs: [10, 3] })
    plot.group.position.set(...S3)
    const band = S3_H / 3
    const traces = CHANNELS.map((c) => plot.trace(c.d.color, { samples: 300, radius: 0.08 }))
    const square = (duty: number, t: number) => (duty > 0 && ((t * PWM_HZ) % 1 + 1) % 1 < duty ? 1 : 0)

    const state = { t: 0 }
    const mix = new THREE.Color()
    const tmp = new THREE.Color()
    return {
      scene,
      view: { center: [-2.4, 2.8, 0], radius: 58, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const target = duties(p)
        state.t += dt / SLOW3
        mix.setRGB(0, 0, 0)
        const levels = CHANNELS.map((c, i) => {
          live[i].duty += (target[i] - live[i].duty) * ease(dt, 8)
          live[i].amps = live[i].duty * c.on.sourceA
          const f = live[i].amps / LED_RATED_A
          venn[i].color.set(c.d.color).multiplyScalar(0.85 * f)
          mix.add(tmp.set(c.d.color).multiplyScalar(f))
          flows[i].step(dt * 150 * live[i].amps)
          traces[i].scroll((t) => band * (1 - i) - band * 0.35 + band * 0.7 * square(live[i].duty, t), state.t, 3 / PWM_HZ)
          return f
        })
        back.step(dt * 150 * live.reduce((a, l) => a + l.amps, 0))
        const peak = Math.max(mix.r, mix.g, mix.b)
        const gain = peak > 0 ? Math.sqrt(Math.min(peak, 1)) / peak : 0
        led.userData.setMix(...levels.map((f) => f * gain))
        halo.set(Math.sqrt(Math.min(peak, 1)), mix.clone().multiplyScalar(peak > 0 ? 1 / peak : 0))
      },
      readouts: () => {
        const peak = Math.max(mix.r, mix.g, mix.b)
        return [
          { label: 'Colour', value: peak > 1e-3 ? `#${mix.clone().multiplyScalar(1 / peak).getHexString().toUpperCase()}` : 'Off' },
          ...CHANNELS.map((c, i) => ({ label: c.label, value: si(tiny(live[i].amps, 1e-6), 'A', 2) })),
        ]
      },
    }
  },
}

// --- LED matrix: rows share anodes, columns share cathodes; scan one row at a time and the eye fills in the rest. ---

const N = 8
const PITCH = 1.7
const MX = -7
const MY = 0.6
const SIDE = N * PITCH
const PATTERNS: Record<string, string[]> = {
  heart: ['01100110', '11111111', '11111111', '11111111', '01111110', '00111100', '00011000', '00000000'],
  smile: ['00111100', '01000010', '10100101', '10000001', '10100101', '10011001', '01000010', '00111100'],
  arrow: ['00011000', '00111100', '01111110', '11111111', '00011000', '00011000', '00011000', '00011000'],
}
const EYE_RATE = 40
const S4: V3 = [MX + SIDE / 2 + 8.6, MY, 0]
const S4_W = 9
const S4_H = SIDE
const cx = (c: number) => MX + (c - (N - 1) / 2) * PITCH
const ry = (r: number) => MY + ((N - 1) / 2 - r) * PITCH
const patternOf = (p: Params) => PATTERNS[p.pattern as string] ?? PATTERNS.heart

export const ledMatrix: Lesson = {
  id: 'led-led-matrix',
  title: 'LED matrix',
  tagline: '64 LEDs, 16 pins',
  formula: (p) => {
    const s = matrixScan(N, N, n(p, 'hz'))
    return `frame rate = rows/s ÷ rows = ${Math.round(n(p, 'hz'))} / ${N} = ${si(s.frameHz, 'Hz', 3)} · ${s.leds} LEDs on ${N} + ${N} = ${s.pins} pins, each lit 1/${N} of the time`
  },
  legend: [
    { color: HIGH_V, label: 'Row driven high (anodes)', shape: 'dot' },
    { color: LOW_V, label: 'Column pulled low (cathodes)', shape: 'dot' },
    { color: '#ffffff', label: 'Row timing over one frame', shape: 'dot' },
  ],
  points: [
    '64 LEDs, each on its own pin, would need 64 pins. A matrix ties every anode in a row together and every cathode in a column together: 8 + 8 = 16 pins.',
    'Drive one row high and pull low the columns that should light in it. Only LEDs with a high row and a low column see a forward voltage. Then move on to the next row.',
    'Slowly, you see one row at a time. Past ~50 frames a second (400 rows/s) your eye blends the rows into one steady picture: persistence of vision.',
    'Each LED is lit only 1/8 of the time, so the picture is dimmer. Drivers push a bigger current in each short pulse to make up for it.',
    'Chips like the MAX7219 do the scanning and current limiting for you; a microcontroller just sends the pattern.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'pattern',
      options: [
        { value: 'heart', label: 'Heart' },
        { value: 'smile', label: 'Smile' },
        { value: 'arrow', label: 'Arrow' },
      ],
      initial: 'heart',
    },
    { kind: 'slider', key: 'hz', label: 'Scan speed', min: 2, max: 2000, initial: 12, log: true, format: (v: number) => `${Math.round(v)} rows/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const body = SIDE + 1.2
    add(scene, mesh(new THREE.BoxGeometry(body, body, 1), new THREE.MeshStandardMaterial({ color: '#1c1d22', roughness: 0.7 })), [MX, MY, -0.5])

    const traceMat = () => glowMat(GREY, 0.1)
    const rows = Array.from({ length: N }, (_, r) => {
      const m = traceMat()
      const y = ry(r) - 0.45
      rod(scene, [MX - body / 2 - 1.4, y, 0.08], [MX + body / 2 - 0.4, y, 0.08], 0.09, m)
      add(scene, mesh(new THREE.SphereGeometry(0.42, 16, 12), m), [MX - body / 2 - 1.4, y, 0.08])
      return m
    })
    const cols = Array.from({ length: N }, (_, c) => {
      const m = traceMat()
      const x = cx(c) + 0.45
      rod(scene, [x, MY - body / 2 - 1.4, 0.16], [x, MY + body / 2 - 0.4, 0.16], 0.09, m)
      add(scene, mesh(new THREE.SphereGeometry(0.42, 16, 12), m), [x, MY - body / 2 - 1.4, 0.16])
      return m
    })

    const domeGeo = new THREE.LatheGeometry(LED_DOME.map(([r, h]) => new THREE.Vector2(r, h)), 24).rotateX(Math.PI / 2).scale(0.62, 0.62, 0.5)
    const domes = new THREE.InstancedMesh(domeGeo, new THREE.MeshStandardMaterial({ color: '#5a1812', roughness: 0.2 }), N * N)
    const coreGeo = new THREE.SphereGeometry(1, 16, 12).scale(0.72, 0.72, 1).translate(0, 0, 1)
    const additive = () => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    const cores = new THREE.InstancedMesh(coreGeo, additive(), N * N)
    const glows = new THREE.InstancedMesh(new THREE.SphereGeometry(1.25, 16, 12).translate(0, 0, 1), additive(), N * N)
    const m4 = new THREE.Matrix4()
    const black = new THREE.Color('#000000')
    for (let i = 0; i < N * N; i++) {
      m4.makeTranslation(cx(i % N), ry(Math.floor(i / N)), 0)
      for (const o of [domes, cores, glows]) o.setMatrixAt(i, m4)
      cores.setColorAt(i, black)
      glows.setColorAt(i, black)
    }
    for (const o of [domes, cores, glows]) {
      o.castShadow = false
      o.frustumCulled = false
      scene.add(o)
    }

    const plot = scope(scene, S4_W, S4_H, { divs: [N, N] })
    plot.group.position.set(...S4)
    const band = S4_H / N
    for (let r = 0; r < N; r++) {
      const t = plot.trace(HIGH_V, { samples: 2 + 24 * N, radius: 0.07 })
      t.draw((u) => S4_H / 2 - (r + 0.5) * band - 0.3 * band + (Math.min(N - 1, Math.floor(u * N)) === r ? 0.6 * band : 0), null)
    }
    const cursor = add(plot.group, mesh(new THREE.BoxGeometry(0.12, S4_H, 0.12), glowMat('#ffffff', 1.2)), [0, 0, 0.35])
    cursor.castShadow = false

    const eye = new Float32Array(N * N)
    const state = { t: 0, row: 0, hz: 12 }
    const color = new THREE.Color()
    const red = new THREE.Color(LEDS.red.color)
    const lo = new THREE.Color(LOW_V)
    const hi = new THREE.Color(HIGH_V)
    const grey = new THREE.Color(GREY)
    return {
      scene,
      view: { center: [MX + 7.2, MY - 0.6, 0], radius: 58, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const pattern = patternOf(p)
        state.hz = n(p, 'hz')
        const lit = rowOnFractions(state.t, dt, state.hz, N)
        state.t += dt
        state.row = Math.floor(state.t * state.hz) % N
        for (let i = 0; i < N * N; i++) {
          const r = Math.floor(i / N)
          const on = pattern[r][i % N] === '1' ? lit[r] : 0
          eye[i] += (on - eye[i]) * ease(dt, EYE_RATE)
          const b = clamp01(eye[i] * 5)
          cores.setColorAt(i, color.copy(red).multiplyScalar(1.4 * b))
          glows.setColorAt(i, color.copy(red).multiplyScalar(0.22 * b))
        }
        cores.instanceColor!.needsUpdate = glows.instanceColor!.needsUpdate = true
        rows.forEach((m, r) => {
          const active = r === state.row
          m.color.copy(active ? hi : grey)
          m.emissive.copy(active ? hi : grey)
          m.emissiveIntensity = active ? 1.2 : 0.1
        })
        cols.forEach((m, c) => {
          const sink = pattern[state.row][c] === '1'
          m.color.copy(sink ? lo : grey)
          m.emissive.copy(sink ? lo : grey)
          m.emissiveIntensity = sink ? 1.2 : 0.1
        })
        cursor.position.x = plot.xAt(((state.t * state.hz) / N) % 1)
      },
      readouts: () => {
        const s = matrixScan(N, N, state.hz)
        return [
          { label: 'Frame rate', value: si(s.frameHz, 'Hz', 3), tone: s.frameHz < 50 ? 'warn' : 'ok' },
          { label: 'Row on', value: si(1 / state.hz, 's', 3) },
          { label: 'LED duty', value: `${(s.duty * 100).toFixed(1)} %` },
          { label: 'Pins / LEDs', value: `${s.pins} / ${s.leds}` },
        ]
      },
    }
  },
}
