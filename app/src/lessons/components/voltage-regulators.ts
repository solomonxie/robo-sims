import * as THREE from 'three/webgpu'
import {
  AMBIENT_C,
  AMS1117_33,
  BOOST_DEMO,
  BUCK_DEMO,
  Converter,
  ESP32_AMPS,
  Thermal,
  boost,
  buck,
  inductorAmps,
  junctionC,
  ldoThermalStep,
  linearReg,
  rejectedRipple,
} from '../../core/physics'
import { amps, fitDigits, niceCeil, ohms, pct, volts, watts } from '../../core/units'
import { V3, add } from '../../models/kit'
import { buildEsp32 } from '../../models/modules'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  GREY,
  HIGH_V,
  LANE,
  POWER,
  RING,
  cell,
  ceramicAlong,
  clamp01,
  diodeAlong,
  dropAlong,
  ease,
  frac,
  groundAt,
  lane,
  heatWaves,
  inductorCoil,
  ivScreen,
  junction,
  knifeSwitch,
  plusFlow,
  pulseLabel,
  scope,
  sot223Regulator,
  swapResistor,
  thermometer,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, e12, n } from '../types'

const REG = AMS1117_33
const VIS_HZ = 0.5
const onLane = (p: V3): V3 => [p[0], p[1], LANE]
const mA = (a: number) => `${Math.round(a * 1000)} mA`
const view = (cx: number, radius: number) => ({ center: [cx, -1, 0] as V3, radius, polar: 1.42, azimuth: 0.12 })

// --- Shared LDO bench: source → AMS1117 (SOT-223) → ESP32 DevKit on its 3V3 pin, 22 µF on the output. ---

const LDO_V = 12
const REG_AT: V3 = [0, 0.5, 0]
const SRC_X = 10
const RAIL = -7
const BS = 0.5
const BOARD: V3 = [-15, -2, 0]
const PIN_Z = 3.5 * BS
const BOARD_Z = PIN_Z + 0.6
const V33: V3 = [BOARD[0] + 7 * BS, BOARD[1] + 5 * BS, PIN_Z]
const GND_PIN: V3 = [BOARD[0] + 6 * BS, BOARD[1] - 5 * BS, PIN_Z]
const OUT_X = -9
const CAP_X = -7
const fl = (v: number) => clamp01(v / LDO_V)

function ldoBench(scene: THREE.Object3D) {
  const reg = sot223Regulator(scene, REG_AT, 3)
  const { in: pin, gnd, tab } = reg.pins
  const cellTop = pin[1]
  const cellBot = cellTop - 4.4
  add(scene, cell(4, 1.1), [SRC_X, cellTop - 2.4, 0])
  wire(scene, [pin, [SRC_X, cellTop, 0]], 0.18)
  wire(scene, [[SRC_X, cellBot, 0], [SRC_X, RAIL, 0], [GND_PIN[0], RAIL, 0], [GND_PIN[0], RAIL, PIN_Z], GND_PIN], 0.18)
  wire(scene, [gnd, [gnd[0] + 1.3, gnd[1], 0], [gnd[0] + 1.3, RAIL, 0]], 0.18)
  wire(scene, [tab, [OUT_X, tab[1], 0], [OUT_X, tab[1], PIN_Z], V33], 0.18)
  wire(scene, [[CAP_X, tab[1], 0], [CAP_X, -1.6, 0]], 0.18)
  ceramicAlong(scene, [CAP_X, -1.6, 0], [CAP_X, -4.6, 0], 1.3)
  wire(scene, [[CAP_X, -4.6, 0], [CAP_X, RAIL, 0]], 0.18)
  junction(scene, [CAP_X, tab[1], 0], 0.32)
  groundAt(scene, [0, RAIL - 0.2, 0])

  const holder = add(scene, new THREE.Group(), BOARD)
  const board = add(holder, buildEsp32())
  board.scale.setScalar(BS)
  board.rotation.x = Math.PI / 2

  const live = { vin: 5, vout: 3.3 }
  const pts: V3[] = [
    onLane([SRC_X, cellTop, 0]),
    onLane(pin),
    onLane([0, pin[1], 0]),
    onLane([0, tab[1], 0]),
    onLane(tab),
    onLane([OUT_X, tab[1], 0]),
    [V33[0], V33[1], BOARD_Z],
    [BOARD[0] - 1.8 * BS, BOARD[1], BOARD_Z],
    [GND_PIN[0], GND_PIN[1], BOARD_Z],
    onLane([GND_PIN[0], RAIL, 0]),
    onLane([SRC_X, RAIL, 0]),
    onLane([SRC_X, cellBot, 0]),
  ]
  const flow = plusFlow(scene, pts, (at) => {
    if (at.y < RAIL + 0.2 || (at.x > SRC_X - 0.2 && at.y < cellBot + 0.1)) return 0
    if (at.x >= pin[0] - 0.05) return fl(live.vin)
    if (at.x > tab[0]) return fl(live.vin + (live.vout - live.vin) * clamp01((pin[0] - at.x) / (pin[0] - tab[0])))
    if (at.z < PIN_Z) return fl(live.vout)
    return fl(live.vout * (1 - clamp01((V33[1] - at.y) / (V33[1] - GND_PIN[1]))))
  })
  return { reg, flow, live, cellTop }
}

// --- Linear LDO: the pass transistor drops whatever is left above 3.3 V; ripple on the input never reaches the output. ---

const RIP_HZ = 100
const LDO_SLOW = RIP_HZ / VIS_HZ
const LS_AT: V3 = [16, -1.2, 0]
const LS_W = 8
const LS_H = 7.5
const LS_MAX = 10
const MODES = { idle: 'Idle', listen: 'Wi-Fi on', transmit: 'Transmit' } as const

const esp32Amps = (p: Params) => ESP32_AMPS[(p.mode as keyof typeof ESP32_AMPS) ?? 'listen'] ?? ESP32_AMPS.listen
const vinAt = (p: Params, t: number) => n(p, 'vin') + n(p, 'ripple') * Math.sin(2 * Math.PI * VIS_HZ * t)

export const linearLdo: Lesson = {
  id: 'voltage-regulators-linear-ldo',
  title: 'Linear LDO',
  tagline: 'Burn off the extra, keep 3.3 V',
  formula: (p) => {
    const i = esp32Amps(p)
    const s = linearReg(REG, n(p, 'vin'), i)
    return `Vout = 3.3 V while Vin ≥ 3.3 V + ${volts(s.dropout)} dropout; Iin = ${mA(i)} + 5 mA; heat = (${volts(n(p, 'vin'))} − ${volts(s.vout)}) × ${mA(i)} = ${watts(s.power)}`
  },
  legend: [
    { color: POWER, label: 'Vin with ripple', shape: 'dot' },
    { color: RING, label: 'Vout', shape: 'dot' },
    { color: GREY, label: 'Lowest Vin that still gives 3.3 V', shape: 'dot' },
    { color: CONVENTIONAL, label: 'ESP32 current, mA', shape: 'dot' },
  ],
  points: [
    'An ESP32 runs on 3.3 V, but USB gives 5 V, a cheap adapter wobbles and batteries sag from full to empty. A regulator turns that messy input into a steady rail.',
    'Inside an AMS1117 a transistor sits between IN and OUT like a self-adjusting resistor. An error amplifier compares a fraction of OUT with a 1.25 V reference and opens or closes it to hold 3.3 V.',
    'Ripple on the input barely gets through: 75 dB of rejection turns 1 V of wobble into about 0.2 mV. The 22 µF on the output keeps the loop stable and covers fast load steps.',
    'All the ESP32 current comes in at the input, plus 5 mA for the chip itself. The (Vin − Vout) × I in between turns into heat. Let the ripple dip below about 4.3 V and Vout dips with it: dropout, next lesson.',
    `The DevKit carries this same AMS1117 next to its USB socket. The scope shows a ${RIP_HZ} Hz ripple ${LDO_SLOW}× slower.`,
  ],
  controls: [
    { kind: 'slider', key: 'vin', label: 'Vin (average)', min: 4, max: 9, initial: 5, step: 0.1, format: volts },
    { kind: 'slider', key: 'ripple', label: 'Ripple peak', min: 0, max: 2, initial: 0.5, step: 0.05, format: volts },
    {
      kind: 'choice',
      key: 'mode',
      options: Object.entries(MODES).map(([value, label]) => ({ value, label })),
      initial: 'listen',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 26 })
    const bench = ldoBench(scene)
    const plot = scope(scene, LS_W, LS_H, { divs: [8, 5], zeroAt: 0 })
    plot.group.position.set(...LS_AT)
    ticks(plot, [], [[0, '0'], [0.5, '5'], [1, '10']])
    const vy = (v: number) => (v / LS_MAX) * LS_H - LS_H / 2
    const floor = plot.level(GREY)
    const inTrace = plot.trace(POWER)
    const outTrace = plot.trace(RING)
    const vinLabel = pulseLabel(scene, 3, POWER, [SRC_X, bench.cellTop + 2, 0], 1.1)
    const voutLabel = pulseLabel(scene, 3, RING, [-5.6, 2.6, 0], 1.1)
    const ampLabel = pulseLabel(scene, 3, CONVENTIONAL, [BOARD[0] - 1, BOARD[1] + 5.4, 0], 1.1)
    let t = 0
    let draw = esp32Amps({ mode: 'listen' })
    return {
      scene,
      view: view(1.5, 70),
      frame(dt, p) {
        t += dt
        draw += (esp32Amps(p) - draw) * ease(dt, 4)
        const out = (x: number) => linearReg(REG, vinAt(p, x), draw).vout
        bench.live.vin = vinAt(p, t)
        bench.live.vout = out(t)
        const s = linearReg(REG, n(p, 'vin'), draw)
        bench.flow.step(dt * draw * 25)
        bench.reg.set(draw / REG.maxAmps, (junctionC(REG, s.power) - 40) / (REG.tOff - 40))
        floor.set(vy(REG.vout + s.dropout))
        inTrace.scroll((x) => vy(vinAt(p, x)), t, 4)
        outTrace.scroll((x) => vy(out(x)), t, 4)
        vinLabel.show(fitDigits(bench.live.vin, 3))
        voutLabel.show(fitDigits(bench.live.vout, 3))
        ampLabel.show(String(Math.round(draw * 1000)))
        for (const l of [vinLabel, voutLabel, ampLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const i = esp32Amps(p)
        const s = linearReg(REG, n(p, 'vin'), i)
        const low = linearReg(REG, n(p, 'vin') - n(p, 'ripple'), i)
        const leak = rejectedRipple(REG, n(p, 'ripple'))
        return [
          {
            label: 'Vout',
            value: low.inDropout ? `dips to ${volts(low.vout)}` : `3.3 V ± ${+(leak * 1e3).toPrecision(2)} mV`,
            tone: low.inDropout ? 'bad' : 'ok',
          },
          { label: 'Iin', value: mA(s.iin) },
          { label: 'Heat', value: watts(s.power) },
          { label: 'Efficiency', value: pct(s.efficiency), tone: s.efficiency < 0.5 ? 'warn' : undefined },
        ]
      },
    }
  },
}

// --- Dropout and heat: below Vout + dropout the output sags; above it P = (Vin − Vout)·I heats the junction to shutdown. ---

const PV_AT: V3 = [16, -1.2, 0]
const PV_W = 8
const PV_H = 6.5
const PV_VIN = 12
const PV_VOUT = 4
const TH_X = 7.4
const T_FULL = 200

export const dropoutAndHeat: Lesson = {
  id: 'voltage-regulators-dropout-and-heat',
  title: 'Dropout and heat',
  tagline: 'Too little in sags, too much in cooks',
  formula: (p) => {
    const vin = n(p, 'vin')
    const i = n(p, 'amps')
    const s = linearReg(REG, vin, i)
    return `P = (Vin − Vout) × I = (${volts(vin)} − ${volts(s.vout)}) × ${mA(i)} = ${watts(s.power)} → Tj = 25 °C + 90 °C/W × P = ${Math.round(junctionC(REG, s.power))} °C`
  },
  legend: [
    { color: RING, label: 'Vout vs Vin at this load (operating point white)', shape: 'dot' },
    { color: GREY, label: '3.3 V target', shape: 'dot' },
    { color: HIGH_V, label: 'Junction temperature, shuts off at ~155 °C', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Heat in the regulator, W', shape: 'dot' },
  ],
  points: [
    'A linear regulator can only take voltage away, and it needs headroom to do it: the dropout, about 1 V for an AMS1117 (1.1 V at 800 mA). Below about 4.3 V in, Vout follows Vin down, 1 V short.',
    'Everything above Vout is burned: P = (Vin − Vout) × I. 5 V to 3.3 V at 240 mA is 0.43 W; the same load from 12 V is 2.2 W.',
    'That heat has to leave through the package. A SOT-223 on a small copper pad runs about 90 °C hotter per watt: 0.43 W puts the junction near 64 °C, 2.2 W would mean over 200 °C.',
    'At about 155 °C thermal shutdown turns the output off; the chip cools to about 140 °C and turns back on. Push it there and the ESP32’s supply blinks: it keeps rebooting.',
    'Efficiency is at best Vout / Vin: about 65 % from 5 V, 27 % from 12 V. For a big step down, use a buck converter.',
  ],
  controls: [
    { kind: 'slider', key: 'vin', label: 'Vin', min: 3.3, max: 12, initial: 5, step: 0.1, format: volts },
    { kind: 'slider', key: 'amps', label: 'Load current', min: 0.01, max: 0.8, initial: 0.24, step: 0.01, format: mA },
  ],
  build(): Stage {
    const scene = createStage({ span: 26 })
    const bench = ldoBench(scene)
    const waves = heatWaves(scene, 2.6, { count: 4, rise: 2.5 })
    waves.group.position.set(REG_AT[0], REG_AT[1] + 4, 1)
    const thermo = thermometer(5)
    add(scene, thermo.group, [TH_X, RAIL + 0.6, 0])
    const tLabel = pulseLabel(scene, 3, HIGH_V, [TH_X, RAIL - 1.4, 0], 1)
    const pLabel = pulseLabel(scene, 3, CONVENTIONAL, [1.6, -5.2, 0], 1)
    const vinLabel = pulseLabel(scene, 3, POWER, [SRC_X, bench.cellTop + 2, 0], 1.1)
    const voutLabel = pulseLabel(scene, 3, RING, [-5.6, 2.6, 0], 1.1)

    const { plot, dot, y } = ivScreen(scene, PV_AT, PV_W, PV_H, [6, 4])
    ticks(plot, [[0, '0'], [0.5, '6'], [1, '12']], [[0, '0'], [3.3 / PV_VOUT, '3.3']])
    plot.level(GREY).set(y(3.3 / PV_VOUT))
    const curve = plot.trace(RING, { samples: 120 })

    let state: Thermal = { tj: AMBIENT_C, on: true }
    let vin = 5
    let draw = 0.24
    let drawn = ''
    return {
      scene,
      view: view(1.5, 70),
      frame(dt, p) {
        vin += (n(p, 'vin') - vin) * ease(dt)
        draw += (n(p, 'amps') - draw) * ease(dt)
        state = ldoThermalStep(REG, state, dt, vin, draw)
        const s = linearReg(REG, vin, draw)
        const vout = state.on ? s.vout : 0
        const i = state.on ? draw : 0
        bench.live.vin = vin
        bench.live.vout = vout
        bench.flow.step(dt * i * 25)
        const heat = (state.tj - AMBIENT_C) / (REG.tOff - AMBIENT_C)
        bench.reg.set(i / REG.maxAmps, heat)
        waves.step(dt, (state.tj - 40) / (REG.tOff - 40))
        thermo.set(state.tj / T_FULL)
        const key = draw.toFixed(3)
        if (key !== drawn) {
          drawn = key
          curve.draw((u) => y(linearReg(REG, u * PV_VIN, draw).vout / PV_VOUT), null)
        }
        dot.position.set(plot.xAt(Math.min(1, vin / PV_VIN)), y(vout / PV_VOUT), 0.35)
        tLabel.show(String(Math.round(state.tj)))
        pLabel.show(fitDigits(state.on ? s.power : 0, 3))
        vinLabel.show(fitDigits(vin, 3))
        voutLabel.show(fitDigits(vout, 3))
        for (const l of [tLabel, pLabel, vinLabel, voutLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = linearReg(REG, n(p, 'vin'), n(p, 'amps'))
        const tj = junctionC(REG, s.power)
        return [
          tj >= REG.tOff ? { label: 'Vout', value: 'cycles off', tone: 'bad' } : { label: 'Vout', value: volts(s.vout), tone: s.inDropout ? 'warn' : 'ok' },
          { label: 'Heat', value: watts(s.power) },
          {
            label: 'Junction',
            value: tj >= REG.tOff ? 'shuts down' : `${Math.round(tj)} °C`,
            tone: tj >= REG.tOff ? 'bad' : tj > REG.tMax ? 'warn' : 'ok',
          },
          { label: 'Efficiency', value: pct(s.efficiency) },
        ]
      },
    }
  },
}

// --- Switching converters: a switch, an inductor, a diode and a capacitor, with the inductor current on a slowed scope. ---

const SW_SLOW = BUCK_DEMO.fHz / VIS_HZ
const WINDOW = 3 / VIS_HZ
const TOP = 3
const BOT = -5
const CELL_X = -17
const CELL_BOT = TOP - 4.4
const SC_W = 9
const SC_H = 7.5
const FLOW_K = 5
const MODELS = [
  { value: 'real', label: 'Real parts' },
  { value: 'ideal', label: 'Ideal' },
]
const switchLegend = [
  { color: POWER, label: 'Switch on (top trace), duty D in %', shape: 'dot' as const },
  { color: CONVENTIONAL, label: 'Inductor current', shape: 'dot' as const },
  { color: RING, label: 'Its average', shape: 'dot' as const },
]
const slowNote = `The switch runs at 100 kHz; everything here is shown ${SW_SLOW.toLocaleString('en-US')}× slower.`

function switchCell(scene: THREE.Object3D) {
  add(scene, cell(4, 1.1), [CELL_X, TOP - 2.4, 0])
  wire(scene, [[CELL_X, CELL_BOT, 0], [CELL_X, BOT, 0]], 0.18)
  groundAt(scene, [0, BOT - 0.2, 0])
}

/** Output cap at `capX` and the load resistor at `loadX`, both from TOP down to BOT, centred on y = −1. */
function outputStage(scene: THREE.Object3D, capX: number, loadX: number) {
  wire(scene, [[capX, TOP, 0], [capX, 0.6, 0]], 0.18)
  ceramicAlong(scene, [capX, 0.6, 0], [capX, -2.6, 0], 1.3)
  wire(scene, [[capX, -2.6, 0], [capX, BOT, 0], [loadX, BOT, 0], [loadX, -3.2, 0]], 0.18)
  wire(scene, [[capX, TOP, 0], [loadX, TOP, 0], [loadX, 1.2, 0]], 0.18)
  const out = junction(scene, [capX, TOP, 0], 0.35)
  const holder = add(scene, new THREE.Group())
  let built = 0
  return {
    out,
    load(r: number) {
      if (r === built) return
      built = r
      swapResistor(holder, r, [loadX, 1.2, 0], [loadX, -3.2, 0], 1.6)
    },
  }
}

const flowOn = (scene: THREE.Object3D, pts: V3[], paint: (at: THREE.Vector3) => number) => plusFlow(scene, lane(pts), paint)

/** Scope: switch state in a thin band at the top, inductor current below (auto full scale, ticked at the right). */
function switchScope(scene: THREE.Object3D, at: V3) {
  const plot = scope(scene, SC_W, SC_H, { divs: [6, 6], zeroAt: 0 })
  plot.group.position.set(...at)
  ticks(plot, [], [[0, '0']])
  const band = SC_H * 0.7
  const avg = plot.level(RING)
  const gate = plot.trace(POWER, { radius: 0.08 })
  const coil = plot.trace(CONVENTIONAL)
  const full = pulseLabel(plot.group, 3, GREY, [SC_W / 2 + 1.5, band - SC_H / 2, 0], 0.8)
  let scale = 1
  return {
    frame(dt: number, c: Converter, duty: number, t: number) {
      const step = niceCeil(c.iMax) / 5
      const target = Math.ceil((c.iMax * 1.08) / step) * step
      scale += (target - scale) * ease(dt, 4)
      const iy = (i: number) => (i / scale) * band - SC_H / 2
      const ph = (x: number) => frac(x * VIS_HZ)
      coil.scroll((x) => iy(inductorAmps(c, duty, ph(x))), t, WINDOW)
      gate.scroll((x) => SC_H / 2 - (ph(x) < duty ? 0.4 : 1.3), t, WINDOW)
      avg.set(iy(c.il))
      full.show(fitDigits(target, 3))
      full.frame(dt)
    },
  }
}

const solveSwitcher = (p: Params, kind: 'buck' | 'boost', duty = n(p, 'duty'), load = e12(p, 'load')) =>
  kind === 'buck' ? buck(BUCK_DEMO, BUCK_VIN, duty, load, p.model === 'ideal') : boost(BOOST_DEMO, BOOST_VIN, duty, load, p.model === 'ideal')

// --- Buck: chop 12 V with duty D, let the inductor average it: Vout = D·Vin. ---

const BUCK_VIN = 12
const SW_X = -7
const B_CAP = 5
const B_LOAD = 9
const PIVOT: V3 = [-13.5, TOP, 0]
const BLADE = 3.5

export const buckConverter: Lesson = {
  id: 'voltage-regulators-buck-converter',
  title: 'Buck converter',
  tagline: 'Chop it, smooth it, lose almost nothing',
  formula: (p) => {
    const d = n(p, 'duty')
    const c = solveSwitcher(p, 'buck')
    if (p.model === 'ideal') return `Vout = D × Vin = ${pct(d)} × ${volts(BUCK_VIN)} = ${volts(c.vout)}; ΔI = (Vin − Vout) D / (L f) = ${mA(c.ripple)}`
    return `Vout = D (Vin − I·Ron) − (1 − D) Vd − I·Rcoil = ${volts(c.vout)} (ideal ${volts(d * BUCK_VIN)}); η = ${pct(c.efficiency)}`
  },
  legend: switchLegend,
  points: [
    'A linear regulator throws away (Vin − Vout) × I. A buck converter chops instead: a switch (a MOSFET) connects 12 V for a fraction D of each period, then opens.',
    'Switch closed: Vin − Vout across the coil ramps its current up. Switch open: the coil keeps the current going round through the diode while Vout ramps it down. Up, down: the triangle on the scope.',
    'The coil can’t hold a DC voltage on average, so the output settles at the average of the chopped input: Vout = D × Vin. 30 % of 12 V is 3.6 V; the capacitor smooths what’s left of the ripple.',
    'Pick Real parts: the FET’s 50 mΩ, the Schottky diode’s 0.4 V while the switch is off and the coil’s 150 mΩ pull Vout a little lower, so a real controller measures Vout and trims D. Here 30 % gives about 3.3 V.',
    'Little is lost, so efficiency stays near 90 %: the input draws only D × Iout from 12 V. An LDO doing 12 V → 3.3 V can’t beat 3.3 / 12 = 27 %; the other 73 % is heat.',
    slowNote,
  ],
  controls: [
    { kind: 'slider', key: 'duty', label: 'Duty cycle D', min: 0.1, max: 0.9, initial: 0.3, step: 0.01, format: pct },
    { kind: 'slider', key: 'load', label: 'Load', min: 4.7, max: 22, initial: 10, log: true, format: (v: number) => ohms(e12({ v }, 'v')) },
    { kind: 'choice', key: 'model', options: MODELS, initial: 'real' },
  ],
  build(): Stage {
    const scene = createStage({ span: 26 })
    switchCell(scene)
    const contact: V3 = [PIVOT[0] + BLADE, TOP, 0]
    wire(scene, [[CELL_X, TOP, 0], PIVOT], 0.18)
    const sw = knifeSwitch(scene, PIVOT, BLADE, [0])
    wire(scene, [contact, [SW_X, TOP, 0], [-4.4, TOP, 0]], 0.18)
    wire(scene, [[SW_X, TOP, 0], [SW_X, 0.8, 0]], 0.18)
    const diode = diodeAlong(scene, [SW_X, -2.8, 0], [SW_X, 0.8, 0])
    wire(scene, [[SW_X, -2.8, 0], [SW_X, BOT, 0]], 0.18)
    wire(scene, [[CELL_X, BOT, 0], [B_CAP, BOT, 0]], 0.18)
    const coil = inductorCoil(scene)
    coil.group.position.set(-1, TOP, 0)
    wire(scene, [[2.4, TOP, 0], [B_CAP, TOP, 0]], 0.18)
    const swNode = junction(scene, [SW_X, TOP, 0], 0.35)
    const stage = outputStage(scene, B_CAP, B_LOAD)

    const live = { vin: BUCK_VIN, vsw: 0, vout: 0 }
    const f = (v: number) => clamp01(v / BUCK_VIN)
    const paint = (at: THREE.Vector3) => {
      if (at.y < BOT + 0.2) return 0
      if (at.x < CELL_X + 0.2) return at.y > CELL_BOT ? f(live.vin) : 0
      if (at.x < contact[0] - 0.2) return f(live.vin)
      if (at.x < SW_X - 0.2) return f(live.vsw)
      if (at.x < SW_X + 0.2) return dropAlong(at, [SW_X, BOT, 0], [SW_X, TOP, 0], 0, f(live.vsw), 1.6)
      if (at.x < B_CAP - 0.2) return dropAlong(at, [SW_X, TOP, 0], [B_CAP, TOP, 0], f(live.vsw), f(live.vout), 3.2)
      if (at.x < B_CAP + 0.2) return dropAlong(at, [B_CAP, TOP, 0], [B_CAP, BOT, 0], f(live.vout), 0, 1.6)
      if (at.x < B_LOAD - 0.2) return f(live.vout)
      return dropAlong(at, [B_LOAD, TOP, 0], [B_LOAD, BOT, 0], f(live.vout), 0, 2.2)
    }
    const flows = {
      src: flowOn(scene, [[CELL_X, TOP, 0], [SW_X, TOP, 0]], paint),
      ret: flowOn(scene, [[SW_X, BOT, 0], [CELL_X, BOT, 0], [CELL_X, CELL_BOT, 0]], paint),
      diode: flowOn(scene, [[SW_X, BOT, 0], [SW_X, TOP, 0]], paint),
      coil: flowOn(scene, [[SW_X, TOP, 0], [B_CAP, TOP, 0]], paint),
      cap: flowOn(scene, [[B_CAP, TOP, 0], [B_CAP, BOT, 0]], paint),
      load: flowOn(scene, [[B_CAP, TOP, 0], [B_LOAD, TOP, 0], [B_LOAD, BOT, 0], [B_CAP, BOT, 0]], paint),
      rail: flowOn(scene, [[B_CAP, BOT, 0], [SW_X, BOT, 0]], paint),
    }
    const plot = switchScope(scene, [17.5, -1, 0])
    const dutyLabel = pulseLabel(scene, 2, POWER, [-11.8, 5.6, 0], 1.1)
    const vinLabel = pulseLabel(scene, 2, POWER, [CELL_X, 5.4, 0], 1.1)
    const voutLabel = pulseLabel(scene, 4, RING, [7, 5.4, 0], 1.1)

    let t = 0
    let duty = 0.3
    let angle = 0
    return {
      scene,
      view: view(3.5, 70),
      frame(dt, p) {
        t += dt
        duty += (n(p, 'duty') - duty) * ease(dt)
        const r = e12(p, 'load')
        stage.load(r)
        const c = solveSwitcher(p, 'buck', duty, r)
        const phase = frac(t * VIS_HZ)
        const on = phase < duty
        const il = inductorAmps(c, duty, phase)
        const ideal = p.model === 'ideal'
        live.vout = c.vout
        live.vsw = on ? BUCK_VIN - (ideal ? 0 : il * BUCK_DEMO.ronOhms) : ideal ? 0 : -BUCK_DEMO.diodeV
        angle += ((on ? 0 : 0.5) - angle) * ease(dt, 25)
        sw.set(angle)
        diode.set(on ? -0.7 : il / Math.max(c.iMax, 1e-6))
        coil.set(il / c.iMax)
        swNode.set(f(live.vsw))
        stage.out.set(f(live.vout))
        const k = dt * FLOW_K
        flows.src.step(k * (on ? il : 0))
        flows.ret.step(k * (on ? il : 0))
        flows.diode.step(k * (on ? 0 : il))
        flows.coil.step(k * il)
        flows.cap.step(k * (il - c.iout))
        flows.load.step(k * c.iout)
        flows.rail.step(k * il)
        plot.frame(dt, c, duty, t)
        dutyLabel.show(String(Math.round(duty * 100)))
        vinLabel.show(String(BUCK_VIN))
        voutLabel.show(fitDigits(c.vout, 4))
        for (const l of [dutyLabel, vinLabel, voutLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const c = solveSwitcher(p, 'buck')
        return [
          { label: 'Vout', value: volts(c.vout) },
          { label: 'Ripple ΔI', value: `${mA(c.ripple)} p-p` },
          { label: 'Efficiency', value: pct(c.efficiency), tone: c.efficiency > 0.85 ? 'ok' : 'warn' },
          { label: 'An LDO would be', value: pct(c.vout / BUCK_VIN), tone: c.vout / BUCK_VIN < 0.5 ? 'bad' : 'warn' },
        ]
      },
    }
  },
}

// --- Boost: switch to ground stores energy in the coil, the diode lets it out on top of Vin: Vout = Vin / (1 − D). ---

const BOOST_VIN = 5
const BOOST_V = 25
const BS_X = -5
const D_A: V3 = [-3, TOP, 0]
const D_B: V3 = [1, TOP, 0]
const O_CAP = 3
const O_LOAD = 7
const B_PIVOT: V3 = [BS_X, -3.5, 0]
const UPRIGHT = Math.PI / 2

export const boostConverter: Lesson = {
  id: 'voltage-regulators-boost-converter',
  title: 'Boost converter',
  tagline: 'More volts out than in',
  formula: (p) => {
    const d = n(p, 'duty')
    const c = solveSwitcher(p, 'boost')
    if (p.model === 'ideal') return `Vout = Vin / (1 − D) = ${volts(BOOST_VIN)} / ${(1 - d).toFixed(2)} = ${volts(c.vout)}; Iin = Iout / (1 − D) = ${amps(c.iin)}`
    return `Vout = (Vin − (1 − D) Vd) / ((1 − D) + (Rcoil + D·Ron) / (R (1 − D))) = ${volts(c.vout)} (ideal ${volts(BOOST_VIN / (1 - d))}); η = ${pct(c.efficiency)}`
  },
  legend: switchLegend,
  points: [
    'Swap the switch and the coil round and the output can climb above the input. Here 5 V from USB, the switch to ground, the diode to the output.',
    'Switch closed: the full 5 V sits across the coil and its current ramps up, storing energy. Switch open: that current must go on, so the coil’s voltage flips and stacks on top of the 5 V, pushing through the diode into the capacitor.',
    'Over a period the coil’s volt-seconds balance: Vin × D = (Vout − Vin) × (1 − D), so Vout = Vin / (1 − D). D = 58 % turns 5 V into 12 V.',
    'Energy is conserved, not current: the coil and the input carry Iout / (1 − D). At 12 V out the 5 V side supplies 2.4× the load current.',
    'Those bigger currents make the losses grow fast, so the real curve falls further below Vin / (1 − D) as D rises; push D toward 1 and Vout would peak and collapse. An LDO can’t do this at all: it can only drop voltage.',
    slowNote,
  ],
  controls: [
    { kind: 'slider', key: 'duty', label: 'Duty cycle D', min: 0.1, max: 0.85, initial: 0.58, step: 0.01, format: pct },
    { kind: 'slider', key: 'load', label: 'Load', min: 22, max: 100, initial: 47, log: true, format: (v: number) => ohms(e12({ v }, 'v')) },
    { kind: 'choice', key: 'model', options: MODELS, initial: 'real' },
  ],
  build(): Stage {
    const scene = createStage({ span: 26 })
    switchCell(scene)
    const coil = inductorCoil(scene)
    coil.group.position.set(-11, TOP, 0)
    wire(scene, [[CELL_X, TOP, 0], [-14.4, TOP, 0]], 0.18)
    wire(scene, [[-7.6, TOP, 0], [BS_X, TOP, 0], D_A], 0.18)
    const diode = diodeAlong(scene, D_A, D_B)
    wire(scene, [D_B, [O_CAP, TOP, 0]], 0.18)
    wire(scene, [[BS_X, TOP, 0], [BS_X, B_PIVOT[1] + BLADE, 0]], 0.18)
    const sw = knifeSwitch(scene, B_PIVOT, BLADE, [UPRIGHT])
    wire(scene, [B_PIVOT, [BS_X, BOT, 0]], 0.18)
    wire(scene, [[CELL_X, BOT, 0], [O_CAP, BOT, 0]], 0.18)
    const swNode = junction(scene, [BS_X, TOP, 0], 0.35)
    const stage = outputStage(scene, O_CAP, O_LOAD)

    const live = { vsw: 0, vout: 0 }
    const f = (v: number) => clamp01(v / BOOST_V)
    const paint = (at: THREE.Vector3) => {
      if (at.y < BOT + 0.2) return 0
      if (at.x < CELL_X + 0.2) return at.y > CELL_BOT ? f(BOOST_VIN) : 0
      if (at.x < BS_X - 0.2) return dropAlong(at, [CELL_X, TOP, 0], [BS_X, TOP, 0], f(BOOST_VIN), f(live.vsw), 3.2)
      if (at.x < BS_X + 0.2) return dropAlong(at, [BS_X, TOP, 0], [BS_X, BOT, 0], f(live.vsw), 0, 1.75)
      if (at.x < O_CAP - 0.2) return dropAlong(at, [BS_X, TOP, 0], [O_CAP, TOP, 0], f(live.vsw), f(live.vout), 1.6)
      if (at.x < O_CAP + 0.2) return dropAlong(at, [O_CAP, TOP, 0], [O_CAP, BOT, 0], f(live.vout), 0, 1.6)
      if (at.x < O_LOAD - 0.2) return f(live.vout)
      return dropAlong(at, [O_LOAD, TOP, 0], [O_LOAD, BOT, 0], f(live.vout), 0, 2.2)
    }
    const flows = {
      coil: flowOn(scene, [[CELL_X, TOP, 0], [BS_X, TOP, 0]], paint),
      sw: flowOn(scene, [[BS_X, TOP, 0], [BS_X, BOT, 0]], paint),
      diode: flowOn(scene, [[BS_X, TOP, 0], [O_CAP, TOP, 0]], paint),
      cap: flowOn(scene, [[O_CAP, TOP, 0], [O_CAP, BOT, 0]], paint),
      load: flowOn(scene, [[O_CAP, TOP, 0], [O_LOAD, TOP, 0], [O_LOAD, BOT, 0], [O_CAP, BOT, 0]], paint),
      railR: flowOn(scene, [[O_CAP, BOT, 0], [BS_X, BOT, 0]], paint),
      railL: flowOn(scene, [[BS_X, BOT, 0], [CELL_X, BOT, 0], [CELL_X, CELL_BOT, 0]], paint),
    }
    const plot = switchScope(scene, [15.5, -1, 0])
    const dutyLabel = pulseLabel(scene, 2, POWER, [BS_X - 2.4, -1.6, 0], 1.1)
    const vinLabel = pulseLabel(scene, 2, POWER, [CELL_X, 5.4, 0], 1.1)
    const voutLabel = pulseLabel(scene, 4, RING, [5, 5.4, 0], 1.1)

    let t = 0
    let duty = 0.58
    let angle = UPRIGHT
    return {
      scene,
      view: view(3, 68),
      frame(dt, p) {
        t += dt
        duty += (n(p, 'duty') - duty) * ease(dt)
        const r = e12(p, 'load')
        stage.load(r)
        const c = solveSwitcher(p, 'boost', duty, r)
        const phase = frac(t * VIS_HZ)
        const on = phase < duty
        const il = inductorAmps(c, duty, phase)
        const ideal = p.model === 'ideal'
        const id = on ? 0 : il
        live.vout = c.vout
        live.vsw = on ? (ideal ? 0 : il * BOOST_DEMO.ronOhms) : c.vout + (ideal ? 0 : BOOST_DEMO.diodeV)
        angle += ((on ? UPRIGHT : UPRIGHT - 0.5) - angle) * ease(dt, 25)
        sw.set(angle)
        diode.set(on ? -0.7 : il / Math.max(c.iMax, 1e-6))
        coil.set(il / c.iMax)
        swNode.set(f(live.vsw))
        stage.out.set(f(live.vout))
        const k = dt * FLOW_K
        flows.coil.step(k * il)
        flows.sw.step(k * (on ? il : 0))
        flows.diode.step(k * id)
        flows.cap.step(k * (id - c.iout))
        flows.load.step(k * c.iout)
        flows.railR.step(k * id)
        flows.railL.step(k * il)
        plot.frame(dt, c, duty, t)
        dutyLabel.show(String(Math.round(duty * 100)))
        vinLabel.show(String(BOOST_VIN))
        voutLabel.show(fitDigits(c.vout, 4))
        for (const l of [dutyLabel, vinLabel, voutLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const c = solveSwitcher(p, 'boost')
        return [
          { label: 'Vout', value: volts(c.vout) },
          { label: 'Iin = I coil', value: `${amps(c.iin)} (out ${amps(c.iout)})` },
          { label: 'Efficiency', value: pct(c.efficiency), tone: c.efficiency > 0.85 ? 'ok' : 'warn' },
          { label: 'An LDO', value: 'can’t step up', tone: 'bad' },
        ]
      },
    }
  },
}
