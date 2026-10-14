import * as THREE from 'three/webgpu'
import {
  BJTS,
  DIODES,
  MAINS,
  SSR_25DA,
  acVolts,
  contactHeat,
  nextZeroCross,
  peakFromRms,
  ssrHeat,
  ssrInputAmps,
  zeroCrossConducts,
  FET_PARTS,
  LEDS,
  LED_RATED_A,
  MOSFETS,
  SRD_05,
  bjtSwitch,
  coilAmps,
  diodeVolts,
  dropOutAmps,
  fetSwitch,
  flybackStep,
  inductorEnergy,
  ledStringAmps,
  operateTime,
  pullInAmps,
  relayLatch,
  relayPull,
  releaseTime,
} from '../../core/physics'
import { fitDigits, si, volts } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  CONVENTIONAL,
  FORCE,
  GREY,
  HIGH_V,
  LANE,
  POWER,
  RING,
  acSource,
  arcSpark,
  bulb,
  cell,
  clamp01,
  diodeAlong,
  dropAlong,
  ease,
  emptyGroup,
  fetPart,
  icPackage,
  ivScreen,
  junction,
  ledLamp,
  lerp,
  plusFlow,
  presence,
  pulseLabel,
  relayPart,
  resistorAlong,
  scope,
  ssrPart,
  swapResistor,
  ticks,
  transistorPart,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const RELAY = SRD_05
const PULL_IN = pullInAmps(RELAY)
const DROP_OUT = dropOutAmps(RELAY)
const tiny = (x: number, eps: number) => (Math.abs(x) < eps ? 0 : x)
const newtons = (f: number) => si(tiny(f, 1e-4), 'N', 3)
const lane = (pts: V3[], z = LANE): V3[] => pts.map(([x, y]): V3 => [x, y, z])

// --- Coil and contacts: the coil's pull beats the spring and throws COM from NC to NO; once down, it holds on far less. ---

const K1 = 1.4
const AT1: V3 = [-7.5, -3, 0]
const V1_MAX = 6
const VC1 = 5
const R_LED1 = 150
const COIL_Y1 = -7.2
const NO_Y1 = -6.2
const NC_Y1 = -7.2
const COM_Y1 = -8.6
const BUS_X = 8
const UP_NO = 1.5
const UP_NC = 4.2
const TOP_NO = 1.6
const TOP_NC = -3.4
const LED_NO = 3.2
const LED_NC = 5.8
const LEG1 = 0.5
const RX1 = 2.6
const P1: V3 = [14.4, 0.6, 0]
const P1_W = 5.6
const P1_H = 6
/** 10 mN … 100 N on a log axis. */
const logF = (f: number) => clamp01((Math.log10(Math.max(f, 1e-6)) + 2) / 4)

export const coilAndContacts: Lesson = {
  id: 'relay-coil-and-contacts',
  title: 'Coil and contacts',
  tagline: 'An electromagnet throws a switch',
  formula: (p) => {
    const v = n(p, 'v')
    const i = coilAmps(v, RELAY)
    return `F = μ₀(N·I)²·A / 2g²: at ${volts(v)}, I = ${si(i, 'A', 3)}: ${newtons(relayPull(i, RELAY.openGapM, RELAY))} across the open 0.45 mm gap, ${newtons(relayPull(i, RELAY.closedGapM, RELAY))} closed; spring ${newtons(RELAY.springN)}`
  },
  legend: [
    { color: B_FIELD, label: 'Pull vs coil volts, armature up (log N)', shape: 'dot' },
    { color: FORCE, label: 'Pull, armature down: gap ÷ 6', shape: 'dot' },
    { color: RING, label: 'Return spring, 0.15 N', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Coil current, mA', shape: 'dot' },
  ],
  points: [
    'A relay is a switch thrown by an electromagnet. Current in the coil magnetises its iron core, which pulls a hinged steel armature down; the armature carries the moving contact.',
    'Three contacts: COM (common) moves. At rest a spring holds it on NC (normally closed, red LED); powered, it is pulled onto NO (normally open, green). Coil and contacts never touch electrically: 5 V on the coil can switch mains.',
    'The pull F = μ₀(N·I)²·A / 2g² grows with the current squared and falls with the gap squared. Across the open 0.45 mm gap this SRD-05 needs ~49 mA (3.4 V) to beat the spring: pull-in. Its datasheet promises by 75 % of 5 V.',
    'Once down, the gap is ~0.07 mm, so the same current pulls ~40× harder. It holds until the coil drops below ~7.6 mA (0.54 V): drop-out. Slide down from 5 V and watch it hang on. That hysteresis keeps it from chattering at the edge.',
    'Rated 5 V across 70 Ω: 71 mA, 0.36 W, more than a microcontroller pin can give (next lesson). The contacts take 10 A at 250 V AC or 30 V DC.',
  ],
  controls: [{ kind: 'slider', key: 'v', label: 'Coil voltage', min: 0, max: V1_MAX, initial: 5, step: 0.05, format: volts }],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const relay = relayPart(scene, AT1, { scale: K1 })
    const [pa, pb] = relay.pins.coil
    const { com, no, nc } = relay.pins
    wire(scene, [pa, [pa[0], COIL_Y1, 0], [pa[0] + 0.3, COIL_Y1, 0]])
    wire(scene, [pb, [pb[0], COIL_Y1, 0], [pb[0] - 0.3, COIL_Y1, 0]])
    const coilCell = add(scene, cell(pb[0] - pa[0] - 0.6, 0.9), [(pa[0] + pb[0]) / 2, COIL_Y1, 0])
    coilCell.rotation.z = -Math.PI / 2

    wire(scene, [no, [no[0], NO_Y1, 0], [UP_NO, NO_Y1, 0], [UP_NO, TOP_NO, 0], [LED_NO - LEG1, TOP_NO, 0]])
    wire(scene, [[LED_NO + LEG1, TOP_NO, 0], [BUS_X, TOP_NO, 0], [BUS_X, TOP_NC, 0]])
    wire(scene, [nc, [nc[0], NC_Y1, 0], [UP_NC, NC_Y1, 0], [UP_NC, TOP_NC, 0], [LED_NC - LEG1, TOP_NC, 0]])
    wire(scene, [[LED_NC + LEG1, TOP_NC, 0], [BUS_X, TOP_NC, 0], [BUS_X, COM_Y1 + 2.2, 0]])
    wire(scene, [com, [com[0], COM_Y1, 0], [BUS_X, COM_Y1, 0]])
    add(scene, cell(4.4, 1.2), [BUS_X, COM_Y1 + 2.2, 0])
    resistorAlong(scene, R_LED1, [RX1 - 1, COM_Y1, 0], [RX1 + 1, COM_Y1, 0], 1.4)
    const green = ledLamp(scene, LEDS.green.color, [LED_NO, TOP_NO, 0], { scale: 1 })
    const red = ledLamp(scene, LEDS.red.color, [LED_NC, TOP_NC, 0], { scale: 1 })
    const iLabel = pulseLabel(scene, 3, CONVENTIONAL, [(pa[0] + pb[0]) / 2, COIL_Y1 - 1.9, 0], 1)

    const { plot, dot, y } = ivScreen(scene, P1, P1_W, P1_H, [6, 4])
    ticks(plot, [[0, '0'], [0.5, '3'], [1, '6']], [[0.25, '0.1'], [0.5, '1'], [0.75, '10'], [1, '100']])
    const pullAt = (u: number, gap: number) => y(logF(relayPull(coilAmps(u * V1_MAX, RELAY), gap, RELAY)))
    plot.trace(B_FIELD, { radius: 0.1 }).draw((u) => pullAt(u, RELAY.openGapM), null)
    plot.trace(FORCE, { radius: 0.1 }).draw((u) => pullAt(u, RELAY.closedGapM), null)
    plot.level(RING).set(y(logF(RELAY.springN)))

    const st = { v: 5, closed: true, arm: 1, ledA: 0 }
    const flowNo = plusFlow(
      scene,
      [...lane([[BUS_X, COM_Y1 + 4.4, 0], [BUS_X, TOP_NO, 0], [LED_NO + LEG1, TOP_NO, 0], [LED_NO + LEG1, TOP_NO + 3.8, 0], [LED_NO - LEG1, TOP_NO + 3.8, 0], [UP_NO, TOP_NO, 0], [UP_NO, NO_Y1, 0], [no[0], NO_Y1, 0]]), ...[...relay.contactLane(true, LANE)].reverse(), ...lane([[com[0], COM_Y1, 0], [BUS_X, COM_Y1, 0]])],
      (at) => contactPaint(at, st.ledA, true),
      true,
    )
    const flowNc = plusFlow(
      scene,
      [...lane([[BUS_X, COM_Y1 + 4.4, 0], [BUS_X, TOP_NC, 0], [LED_NC + LEG1, TOP_NC, 0], [LED_NC + LEG1, TOP_NC + 3.8, 0], [LED_NC - LEG1, TOP_NC + 3.8, 0], [UP_NC, TOP_NC, 0], [UP_NC, NC_Y1, 0], [nc[0], NC_Y1, 0]]), ...[...relay.contactLane(false, LANE)].reverse(), ...lane([[com[0], COM_Y1, 0], [BUS_X, COM_Y1, 0]])],
      (at) => contactPaint(at, st.ledA, false),
      true,
    )
    const coilFlow = plusFlow(scene, lane([pa, [pa[0], COIL_Y1, 0], [pb[0], COIL_Y1, 0], pb]), (at) => (st.v / V1_MAX) * clamp01((at.x - pa[0] - 0.3) / (pb[0] - pa[0] - 0.6)))

    return {
      scene,
      view: { center: [2.2, 0.6, 0], radius: 61, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        st.v += (n(p, 'v') - st.v) * ease(dt, 5)
        const i = coilAmps(st.v, RELAY)
        st.closed = relayLatch(st.closed, i, RELAY)
        st.arm += ((st.closed ? 1 : 0) - st.arm) * ease(dt, 14)
        const gap = lerp(RELAY.openGapM, RELAY.closedGapM, st.arm)
        relay.set(st.arm, clamp01(relayPull(i, gap, RELAY) / 2))
        relay.coilFlow.step(-dt * 40 * i)
        coilFlow.step(dt * 40 * i)
        const made = st.arm > 0.97 ? 'no' : st.arm < 0.03 ? 'nc' : ''
        st.ledA = ledStringAmps(VC1, R_LED1, made === 'no' ? LEDS.green : LEDS.red)
        green.set(made === 'no' ? st.ledA / LED_RATED_A : 0)
        red.set(made === 'nc' ? st.ledA / LED_RATED_A : 0)
        green.step(dt)
        red.step(dt)
        flowNo.mesh.visible = made === 'no'
        flowNc.mesh.visible = made === 'nc'
        ;(made === 'no' ? flowNo : flowNc).step(dt * 250 * st.ledA)
        dot.position.set(plot.xAt(st.v / V1_MAX), y(logF(relayPull(i, gap, RELAY))), 0.4)
        iLabel.show(fitDigits(tiny(i, 1e-5) * 1e3, 3))
        iLabel.frame(dt)
      },
      readouts: () => {
        const i = coilAmps(st.v, RELAY)
        const gap = lerp(RELAY.openGapM, RELAY.closedGapM, st.arm)
        const f = relayPull(i, gap, RELAY)
        return [
          { label: 'Coil', value: si(tiny(i, 1e-5), 'A', 3) },
          { label: 'Pull', value: newtons(f), tone: f >= RELAY.springN ? 'ok' : undefined },
          { label: 'Contacts', value: st.closed ? 'COM–NO' : 'COM–NC', tone: st.closed ? 'ok' : undefined },
          { label: 'In / out', value: `${(PULL_IN * RELAY.ohms).toFixed(2)} · ${(DROP_OUT * RELAY.ohms).toFixed(2)} V` },
        ]
      },
    }
  },
}

/** Contact loop potential: 5 V from the cell up the bus to the LED; after it only I·R is left, through the contacts and COM
 *  to the resistor, then 0 V back to the cell. */
function contactPaint(at: THREE.Vector3, amps: number, toNo: boolean) {
  const after = (amps * R_LED1) / VC1
  if (at.x >= BUS_X - 0.01) return at.y < COM_Y1 + 4.4 ? clamp01((at.y - COM_Y1) / 4.4) : 1
  if (at.y <= COM_Y1 + 0.01) return dropAlong(at, [2 * RX1 - BUS_X, COM_Y1, 0], [BUS_X, COM_Y1, 0], after, 0, 1.2 * 1.4)
  const ledX = toNo ? LED_NO : LED_NC
  const top = toNo ? TOP_NO : TOP_NC
  if (at.y >= top - 0.01 && at.x >= ledX - LEG1 - 0.01) return lerp(after, 1, (at.x - ledX + LEG1) / (2 * LEG1))
  return after
}

// --- Driving a relay: a transistor carries the coil current the pin can't, and a diode catches the coil's kick at switch-off. ---

const VCC = 5
const PIN_V = 3.3
const Q2 = BJTS['2N2222']
const FET2 = MOSFETS['2N7000']
const D2 = DIODES['1N4007']
const C_STRAY2 = 10e-9
const LOSS2 = 3000
const ON2 = 8e-3
const PERIOD2 = 2 * ON2
const SLOW2 = 400
const N2 = 800
const SUB2 = 20
const K2 = 0.9
const AT2: V3 = [-6, 1.53, 0]
const MCU2: V3 = [-17, -3.6, 0]
const SX2 = MCU2[0] + 1.7 + 0.85
const Y5V = MCU2[1] + 2.4
const YPIN = MCU2[1]
const YGND = MCU2[1] - 2.4
const S2 = 1.4
const NO_Y2 = -0.6
const COM_Y2 = -1.5
const UP2 = 0.8
const LAMP_Y2 = 2.6
const LX2 = 2.6
const GAP2 = 1.1
const LOAD_X2 = 4.6
const LAMP_K = 0.75
const LAMP_UP = 0.6 + 3.25 * LAMP_K
const SC2_X = 10.8
const SC2_W = 7
const SC2_H = 5.2
const SC2_Y = -0.4
const LOGIC_H = 1.9
const LOGIC_Y = SC2_Y + SC2_H / 2 + 0.8 + LOGIC_H / 2 + 0.6
const V2_FULL = 80
const I2_FULL = 0.1
type Driver = 'bjt' | 'fet'
const driverOf = (p: Params): Driver => (p.driver === 'fet' ? 'fet' : 'bjt')
const fittedOf = (p: Params) => p.diode !== 'none'
const coilLoad = (v: number) => v / RELAY.ohms

/** The pin's drive through the chosen transistor: volts left across it when on, pin current, breakdown. */
function driveOf(driver: Driver) {
  if (driver === 'bjt') {
    const r = bjtSwitch({ vin: PIN_V, rb: 1000, vcc: VCC, load: coilLoad }, Q2)
    return { name: '2N2222', rIn: 1000, onV: r.vce, pinA: r.ib, vbe: r.vbe, maxV: Q2.maxV }
  }
  const r = fetSwitch({ vgs: PIN_V, vdd: VCC, load: coilLoad }, FET2)
  return { name: '2N7000', rIn: 100, onV: r.vds, pinA: 0, vbe: 0, maxV: FET_PARTS['2N7000'].maxV }
}

/** One steady pin period (on, then off), sampled N2 times: coil current, transistor volts, armature (0 up … 1 on NO). */
function cycle2(driver: Driver, fitted: boolean) {
  const d = driveOf(driver)
  const base = { vs: VCC, ohms: RELAY.ohms, henries: RELAY.henries, farads: C_STRAY2, diode: fitted ? D2 : undefined, onVolts: d.onV, breakdownV: d.maxV, floorV: -0.7, lossOhms: LOSS2 }
  const on = { ...base, closed: true }
  const off = { ...base, closed: false }
  const h = PERIOD2 / N2 / SUB2
  const amps = new Float32Array(N2)
  const vce = new Float32Array(N2)
  const arm = new Float32Array(N2)
  const avalanche = new Uint8Array(N2)
  let s = { amps: 0, volts: VCC }
  let closed = false
  let a = 0
  let peak = 0
  for (let c = 0; c < 2; c++)
    for (let k = 0; k < N2; k++) {
      const pin = k < N2 / 2
      let hit = 0
      for (let j = 0; j < SUB2; j++) {
        s = flybackStep(s, pin ? on : off, h)
        closed = relayLatch(closed, s.amps, RELAY)
        a = clamp01(a + ((closed ? 1 : -1) * h) / RELAY.travelS)
        if (s.volts >= d.maxV) hit = 1
        if (c && !pin) peak = Math.max(peak, s.volts)
      }
      amps[k] = s.amps
      vce[k] = s.volts
      arm[k] = a
      avalanche[k] = hit
    }
  const i0 = coilAmps(VCC - d.onV, RELAY)
  const clampV = fitted ? diodeVolts(i0, D2) : d.maxV - VCC
  return { d, fitted, amps, vce, arm, avalanche, peak, i0, operate: operateTime(VCC - d.onV, RELAY), release: releaseTime(clampV, RELAY, VCC - d.onV), clampV }
}
type Cycle = ReturnType<typeof cycle2>
const memo2 = new Map<string, Cycle>()
const solve2 = (p: Params) => {
  const key = `${driverOf(p)}${fittedOf(p)}`
  if (!memo2.has(key)) memo2.set(key, cycle2(driverOf(p), fittedOf(p)))
  return memo2.get(key)!
}
const at2 = (a: ArrayLike<number>, u: number) => a[Math.min(N2 - 1, Math.floor(clamp01(u) * N2))]
const ms = (s: number) => si(s, 's', 2)

export const drivingARelay: Lesson = {
  id: 'relay-driving-a-relay',
  title: 'Driving a relay',
  tagline: 'A transistor to switch it, a diode to stop it biting back',
  formula: (p) => {
    const c = solve2(p)
    const rel = `release ${ms(c.release)} (operate ${ms(c.operate)})`
    if (c.fitted) return `Off: the diode carries the coil’s ${si(c.i0, 'A', 3)} round; V = 5 V + ${volts(c.clampV)} = ${volts(c.peak)}. It fades with τ = L/R = ${ms(RELAY.henries / RELAY.ohms)}: ${rel}`
    return `Off: the coil’s ${si(c.i0, 'A', 3)} has nowhere to go; V shoots to the ${c.d.name}’s ${volts(c.d.maxV)} breakdown, dumping ½LI² = ${si(inductorEnergy(RELAY.henries, c.i0), 'J', 2)} in it: ${rel}`
  },
  legend: [
    { color: HIGH_V, label: 'Transistor voltage, 0–80 V', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Coil current, 0–100 mA', shape: 'dot' },
    { color: RING, label: 'Transistor breakdown', shape: 'dot' },
    { color: POWER, label: 'Top: pin (grey), contacts on NO', shape: 'dot' },
  ],
  points: [
    'The coil wants 71 mA at 5 V; an ESP32 pin gives ~20 mA at 3.3 V (40 mA absolute max). So the pin only drives a transistor, and the transistor carries the coil current from the 5 V rail (here the board’s 5 V pin).',
    'A 2N2222 with 1 kΩ takes 2.6 mA from the pin and saturates easily (Transistor → Base resistor). A 2N7000 takes nothing, but at a 3.3 V gate it is only half on: ~51 mA, 1.4 V lost, so the coil gets 3.6 V, barely above pull-in. Use a logic-level MOSFET (AO3400) or a 5 V gate.',
    'The coil is a 0.1 H inductor. Switched off without a diode, its current drives the transistor’s voltage up until it breaks down (40 V for a 2N2222) and dumps ½LI² into it at every release (Inductor → Flyback spike), then rings briefly until the coil’s own losses soak it up. Few parts survive that a million times.',
    'A 1N4007 across the coil, band to +5 V, gives the current a loop: the transistor sees only 5 V plus a diode drop. The current then dies away over τ = L/R ≈ 1.4 ms, so the contacts let go about 2 ms later than without. For fast release add a zener in series with the diode.',
    'Relay modules carry all of this: transistor (often behind an optocoupler), diode and an LED. Time here is slowed 400×.',
  ],
  controls: [
    { kind: 'choice', key: 'driver', options: [{ value: 'bjt', label: 'NPN 2N2222' }, { value: 'fet', label: 'MOSFET 2N7000' }], initial: 'bjt' },
    { kind: 'choice', key: 'diode', options: [{ value: 'fitted', label: 'Flyback diode' }, { value: 'none', label: 'No diode' }], initial: 'fitted' },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const relay = relayPart(scene, AT2, { scale: K2 })
    const [pa, pb] = relay.pins.coil
    const { com, no } = relay.pins
    const ax = pa[0]
    const bx = pb[0]
    add(scene, icPackage(3.4, 7.2, 3), MCU2)
    wire(scene, [[SX2, Y5V, 0], [ax, Y5V, 0], pa])
    wire(scene, [pb, [bx, YPIN + S2, 0]])
    wire(scene, [[SX2, YGND, 0], [bx, YGND, 0], [bx, YPIN - S2, 0]])
    wire(scene, [[SX2, YPIN, 0], [bx, YPIN, 0]])
    const rinHolder = add(scene, new THREE.Group())
    const partHolder = add(scene, new THREE.Group())
    const branch = add(scene, new THREE.Group())
    wire(branch, [[bx, Y5V, 0], [bx - 0.2, Y5V, 0]])
    const flyback = diodeAlong(branch, [bx, Y5V, 0], [ax, Y5V, 0], { scale: 0.95 })
    junction(branch, [bx, Y5V, 0], 0.4).set(0.5)
    const rx = (SX2 + bx) / 2

    wire(scene, [no, [no[0], NO_Y2, 0], [UP2, NO_Y2, 0], [UP2, LAMP_Y2, 0], [LX2 - GAP2, LAMP_Y2, 0]])
    wire(scene, [[LX2 + GAP2, LAMP_Y2, 0], [LOAD_X2, LAMP_Y2, 0], [LOAD_X2, COM_Y2 + 3.6, 0]])
    wire(scene, [com, [com[0], COM_Y2, 0], [LOAD_X2, COM_Y2, 0]])
    add(scene, cell(3.6, 1.3), [LOAD_X2, COM_Y2 + 1.8, 0])
    box(scene, [2.8, 1.2, 1.8], mat('#2b2d33', { rough: 0.5 }), [LX2, LAMP_Y2 + 0.1, 0])
    const lamp = bulb()
    add(scene, lamp.group, [LX2, LAMP_Y2 + LAMP_UP, 0])
    lamp.group.scale.setScalar(LAMP_K)
    const iLabel = pulseLabel(scene, 3, CONVENTIONAL, [ax - 3.4, 3, 0], 1.1)
    const pinLabel = pulseLabel(scene, 3, CONVENTIONAL, [rx, YPIN + 1.2, 0], 0.9)

    const yOf = (f: number, h: number) => f * h - h / 2
    const analog = scope(scene, SC2_W, SC2_H, { divs: [8, 8], zeroAt: 0 })
    analog.group.position.set(SC2_X, SC2_Y, 0)
    const breakdown = analog.level(RING)
    const iTrace = analog.trace(CONVENTIONAL, { samples: 400, radius: 0.08 })
    const vTrace = analog.trace(HIGH_V, { samples: 400, radius: 0.1 })
    const logic = scope(scene, SC2_W, LOGIC_H, { divs: [8, 2], zeroAt: 0 })
    logic.group.position.set(SC2_X, LOGIC_Y, 0)
    const pinTrace = logic.trace(GREY, { samples: 200, radius: 0.08 })
    const armTrace = logic.trace(POWER, { samples: 200, radius: 0.08 })

    const live = { node: VCC, on: false }
    const st = { key: '', t: 0, u: 0, c: solve2({}), flash: 0, lamp: 0 }
    const deep = LANE + 0.7
    let rig: { set: (f: number, heat?: number) => void } | null = null
    let main: ReturnType<typeof plusFlow> | null = null
    let gate: ReturnType<typeof plusFlow> | null = null
    const feed = plusFlow(scene, lane([[SX2, Y5V, 0], [ax, Y5V, 0], pa]), () => 1)
    const loop = plusFlow(scene, lane([pb, [bx, Y5V, 0], [ax, Y5V, 0], pa], LANE + 0.5), (at) => (at.x > ax + 0.6 && at.x < bx - 0.6 ? lerp(live.node / VCC, 1, (bx - 0.6 - at.x) / (bx - ax - 1.2)) : at.x >= bx - 0.6 ? live.node / VCC : 1))
    const load = plusFlow(
      scene,
      [...lane([[LOAD_X2, COM_Y2 + 3.6, 0], [LOAD_X2, LAMP_Y2, 0], [LX2 + GAP2, LAMP_Y2, 0], [LX2 + 0.8, LAMP_Y2 + LAMP_UP, 0], [LX2 - 0.8, LAMP_Y2 + LAMP_UP, 0], [LX2 - GAP2, LAMP_Y2, 0], [UP2, LAMP_Y2, 0], [UP2, NO_Y2, 0], [no[0], NO_Y2, 0]]), ...[...relay.contactLane(true, LANE)].reverse(), ...lane([[com[0], COM_Y2, 0], [LOAD_X2, COM_Y2, 0]])],
      (at) => (at.x >= LOAD_X2 - 0.01 ? (at.y < COM_Y2 + 3.6 ? clamp01((at.y - COM_Y2) / 3.6) : 1) : at.y > LAMP_Y2 - 0.01 && at.x > LX2 - GAP2 ? clamp01((at.x - LX2 + GAP2) / (2 * GAP2)) : 0),
      true,
    )

    return {
      scene,
      view: { center: [-1.8, 3, 0], radius: 58, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const c = (st.c = solve2(p))
        const key = `${c.d.name}${c.fitted}`
        if (key !== st.key) {
          const driverChanged = !st.key.startsWith(c.d.name)
          st.key = key
          st.t = 0
          if (driverChanged) {
            emptyGroup(partHolder)
            swapResistor(rinHolder, c.d.rIn, [rx - 1, YPIN, 0], [rx + 1, YPIN, 0], 1.4)
            const leg: V3 = [bx, YPIN, 0]
            const part = c.d.name === '2N2222' ? transistorPart(partHolder, leg, { scale: S2 }) : fetPart(partHolder, leg, 'TO-92', { scale: S2 })
            const dx = part.die[0]
            const e = YPIN - S2
            const tail: V3[] = [[bx, YPIN + S2, LANE], [dx, YPIN + S2, deep], [dx, e, deep], [bx, e, LANE], [bx, YGND, LANE], [SX2, YGND, LANE]]
            rig = part
            main = plusFlow(partHolder, [[bx, pb[1], LANE], ...tail], (at) => (at.y >= YPIN + S2 - 0.01 ? live.node / VCC : at.y <= e + 0.01 ? 0 : (live.node / VCC) * clamp01((at.y - e) / (2 * S2))))
            gate = c.d.pinA > 0 ? plusFlow(partHolder, [[SX2, YPIN, LANE], [bx, YPIN, LANE], [dx, YPIN, deep], [dx, e, deep], [bx, e, LANE]], (at) => (at.x < rx - 1.7 ? PIN_V / VCC : at.x < rx + 1.7 ? lerp(PIN_V / VCC, c.d.vbe / VCC, (at.x - rx + 1.7) / 3.4) : (c.d.vbe / VCC) * clamp01((at.y - e) / S2))) : null
          }
          breakdown.set(yOf(c.d.maxV / V2_FULL, SC2_H))
        }
        const prev = st.u
        st.t += dt
        st.u = (st.t / (PERIOD2 * SLOW2)) % 1
        const u = st.u
        const k0 = Math.floor(prev * N2)
        const k1 = Math.floor(u * N2)
        let hit = false
        for (let k = k0; k !== k1; k = (k + 1) % N2) if (c.avalanche[k]) hit = true
        st.flash = hit ? 1 : Math.max(0, st.flash - dt * 2.5)
        const amps = at2(c.amps, u)
        const arm = at2(c.arm, u)
        Object.assign(live, { node: at2(c.vce, u), on: u < 0.5 })
        vTrace.draw((x) => yOf(at2(c.vce, x) / V2_FULL, SC2_H), u)
        iTrace.draw((x) => yOf(at2(c.amps, x) / I2_FULL, SC2_H), u)
        pinTrace.draw((x) => yOf(x < 0.5 ? 0.42 : 0.12, LOGIC_H), u)
        armTrace.draw((x) => yOf(0.58 + 0.3 * at2(c.arm, x), LOGIC_H), u)

        relay.set(arm, amps / c.i0)
        relay.coilFlow.step(dt * 40 * amps)
        rig?.set(live.on ? amps / c.i0 : 0, st.flash)
        const conducting = !live.on && c.fitted && amps > 1e-4
        flyback.set(conducting ? clamp01(amps / c.i0) : -0.6)
        branch.visible = c.fitted
        feed.mesh.visible = live.on
        if (main) main.mesh.visible = live.on
        loop.mesh.visible = conducting
        feed.step(dt * 40 * amps)
        main?.step(dt * 40 * amps)
        loop.step(dt * 40 * amps)
        if (gate) {
          gate.mesh.visible = live.on
          gate.step(dt * 3000 * c.d.pinA)
        }
        st.lamp += ((arm > 0.97 ? 1 : 0) - st.lamp) * ease(dt, 12)
        lamp.setGlow(st.lamp)
        load.mesh.visible = arm > 0.97
        load.step(dt * 4 * st.lamp)
        iLabel.show(fitDigits(Math.max(0, amps) * 1e3, 3))
        pinLabel.show(fitDigits(live.on ? c.d.pinA * 1e3 : 0, 3))
        iLabel.frame(dt)
        pinLabel.frame(dt)
      },
      readouts: () => {
        const c = st.c
        const weak = c.i0 < 0.9 * coilAmps(VCC, RELAY)
        return [
          { label: 'Pin', value: si(c.d.pinA, 'A', 2), tone: 'ok' },
          { label: 'Coil', value: si(c.i0, 'A', 3), tone: weak ? 'warn' : 'ok' },
          { label: 'Spike', value: volts(c.peak), tone: c.peak >= c.d.maxV ? 'bad' : 'ok' },
          { label: 'Release', value: ms(c.release) },
        ]
      },
    }
  },
}

// --- Solid-state relay: an LED and a light-triggered triac instead of a coil and contacts; it switches at 0 V but runs warm. ---

const MAINS3 = MAINS.eu
const VPK3 = peakFromRms(MAINS3.rms)
const PERIOD3 = 0.1
const T_ON3 = 4.2e-3
const T_OFF3 = T_ON3 + PERIOD3 / 2
const SLOW3 = 50
const SSR = SSR_25DA
const OPERATE3 = operateTime(RELAY.coilV, RELAY)
const RELEASE3 = releaseTime(diodeVolts(coilAmps(RELAY.coilV, RELAY), D2), RELAY)
const MAKE3 = T_ON3 + OPERATE3
const BREAK3 = T_OFF3 + RELEASE3 - RELAY.travelS
const ARC_END3 = nextZeroCross(BREAK3, MAINS3.hz)
const AT3S: V3 = [-6, 1.7, 0]
const OUT_HI = -0.6
const OUT_LO = -1.5
const UP3 = 0.8
const LAMP_Y3 = 2.6
const LX3 = 2.6
const SRC_X3 = 4.8
const SRC_R3 = 1.3
const SC3_X = 11.2
const SC3_W = 7.4
const SC3_H = 6.4
const SC3_Y = 1.4
type Kind = 'ssr' | 'relay'
const kindOf = (p: Params): Kind => (p.kind === 'relay' ? 'relay' : 'ssr')
const mainsAt = (t: number) => acVolts(VPK3, MAINS3.hz, t)
/** Armature 0 (up) … 1 (on NO) at time t into the pin period: it flies once the coil current reaches pull-in / drop-out. */
const armAt = (t: number) => clamp01(Math.min((t - MAKE3 + RELAY.travelS) / RELAY.travelS, 1 - (t - BREAK3) / RELAY.travelS))
const conducts3 = (kind: Kind, t: number) => (kind === 'ssr' ? zeroCrossConducts(t, T_ON3, T_OFF3, MAINS3.hz) : t >= MAKE3 && t < ARC_END3)
const solve3 = (p: Params) => {
  const kind = kindOf(p)
  const amps = n(p, 'amps')
  const r = MAINS3.rms / amps
  const make = kind === 'ssr' ? nextZeroCross(T_ON3, MAINS3.hz) : MAKE3
  const brk = kind === 'ssr' ? nextZeroCross(T_OFF3, MAINS3.hz) : BREAK3
  return {
    kind,
    amps,
    r,
    heat: kind === 'ssr' ? ssrHeat(amps, SSR) : contactHeat(amps, RELAY),
    drive: kind === 'ssr' ? ssrInputAmps(PIN_V, SSR) : coilAmps(RELAY.coilV, RELAY),
    makeV: Math.abs(mainsAt(make)),
    breakA: Math.abs(mainsAt(brk)) / r,
    lag: make - T_ON3,
  }
}

export const solidStateRelay: Lesson = {
  id: 'relay-solid-state-relay',
  title: 'Solid-state relay',
  tagline: 'Light instead of a magnet, silicon instead of contacts',
  formula: (p) => {
    const s = solve3(p)
    if (s.kind === 'ssr')
      return `In: (3.3 V − ${volts(diodeVolts(s.drive, SSR.led))}) / ${SSR.inOhms} Ω = ${si(s.drive, 'A', 2)} of IR. Fires at the next 0 V, ${ms(s.lag)} later. Heat = ${SSR.dropV} V × (2√2/π)·${si(s.amps, 'A', 2)} = ${si(s.heat, 'W', 2)}`
    return `Coil ${si(s.drive, 'A', 2)} at 5 V via a driver. Contacts close ${ms(s.lag)} after the pin, at ${volts(s.makeV)}; heat = I²R = (${si(s.amps, 'A', 2)})² × ${RELAY.contactOhms * 1000} mΩ = ${si(s.heat, 'W', 2)}`
  },
  legend: [
    { color: GREY, label: 'Mains 230 V, 50 Hz (50× slower)', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Load current', shape: 'dot' },
    { color: RING, label: 'Pin: on, then off', shape: 'dot' },
    { color: HIGH_V, label: 'Wires by potential, ±325 V', shape: 'dot' },
  ],
  points: [
    'A solid-state relay (SSR) does a relay’s job with no moving parts. Its input is an infrared LED; across a gap, a light-sensitive die fires the output switch, here a triac for AC. Only light crosses, so the pin and the mains stay isolated, as with a coil.',
    'The input is just an LED and a resistor: a 3.3 V pin drives its ~7 mA directly. A mechanical relay needs 71 mA at 5 V, through a transistor and a diode (last lesson; here on a module board).',
    'A zero-cross SSR waits for the mains to pass 0 V before it turns on, and a triac only stops once the current passes zero: no spark, no surge, no radio noise. The relay closes whenever its armature lands, here ~200 V into the cycle, and opens mid-cycle: an arc burns on to the next zero, eroding the contacts.',
    'The price is heat. The triac drops ~1.6 V while on: ~1.4 W per amp, 14 W at 10 A, so big SSRs bolt to a heatsink. Relay contacts (~30 mΩ) waste 3 W at 10 A. An SSR also leaks a few mA when off, enough to make an LED lamp glow.',
    'A triac can’t switch DC: it never sees a zero, so it never turns off. DC SSRs use MOSFETs instead. Contacts wear out (~100 000 switchings at full load); an SSR doesn’t.',
  ],
  controls: [
    { kind: 'choice', key: 'kind', options: [{ value: 'ssr', label: 'SSR (zero-cross)' }, { value: 'relay', label: 'Relay module' }], initial: 'ssr' },
    { kind: 'slider', key: 'amps', label: 'Load current', min: 0.5, max: 10, initial: 5, step: 0.5, format: (v) => si(v, 'A', 2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    add(scene, icPackage(3.4, 7.2, 3), MCU2)
    const ssrHolder = add(scene, new THREE.Group())
    const relayHolder = add(scene, new THREE.Group())

    const ssr = solidStateRelay3(ssrHolder)
    const mod = relayModule3(relayHolder)

    wire(scene, [[UP3, OUT_HI, 0], [UP3, LAMP_Y3, 0], [LX3 - GAP2, LAMP_Y3, 0]])
    wire(scene, [[LX3 + GAP2, LAMP_Y3, 0], [SRC_X3, LAMP_Y3, 0], [SRC_X3, OUT_LO, 0], [mod.lo, OUT_LO, 0]])
    add(scene, acSource(SRC_R3), [SRC_X3, (LAMP_Y3 + OUT_LO) / 2, 0])
    box(scene, [2.8, 1.2, 1.8], mat('#2b2d33', { rough: 0.5 }), [LX3, LAMP_Y3 + 0.1, 0])
    const lamp = bulb()
    add(scene, lamp.group, [LX3, LAMP_Y3 + LAMP_UP, 0])
    lamp.group.scale.setScalar(LAMP_K)
    const spark = arcSpark(scene, mod.relay.contacts.no)

    const plot = scope(scene, SC3_W, SC3_H, { divs: [10, 8], zeroAt: 0.5 })
    plot.group.position.set(SC3_X, SC3_Y, 0)
    const mainsTrace = plot.trace(GREY, { samples: 300, radius: 0.07 })
    const iTrace = plot.trace(CONVENTIONAL, { samples: 300, radius: 0.11 })
    const pinTrace = plot.trace(RING, { samples: 120, radius: 0.07 })
    const vy = (v: number) => (0.36 * SC3_H * v) / VPK3
    const pinY = (t: number) => SC3_H * (t >= T_ON3 && t < T_OFF3 ? 0.45 : 0.4)

    const st = { kind: '' as Kind | '', t: 0, s: solve3({ kind: 'ssr', amps: 5 }), glow: 0, show: 0, heat: 0 }
    const live = { fl: 0.5, closed: false }
    const paint = (inside: (at: THREE.Vector3) => number | null) => (at: THREE.Vector3) => {
      const switched = live.closed ? live.fl : 0.5
      if (at.x >= SRC_X3 - 0.01) return lerp(live.fl, 0.5, (at.y - OUT_LO - 0.6) / (LAMP_Y3 - OUT_LO - 1.2))
      if (at.y >= LAMP_Y3 - 0.01 && at.x >= UP3) return lerp(switched, 0.5, (at.x - LX3 + GAP2) / (2 * GAP2))
      if (at.y <= OUT_LO + 0.01) return live.fl
      return inside(at) ?? switched
    }
    const loopOut = (inner: V3[]) => [...lane([[SRC_X3, OUT_LO, 0], [inner[0][0], OUT_LO, 0]]), ...inner, ...lane([[inner[inner.length - 1][0], OUT_HI, 0], [UP3, OUT_HI, 0], [UP3, LAMP_Y3, 0], [LX3 - GAP2, LAMP_Y3, 0], [LX3 - 0.8, LAMP_Y3 + LAMP_UP, 0], [LX3 + 0.8, LAMP_Y3 + LAMP_UP, 0], [LX3 + GAP2, LAMP_Y3, 0], [SRC_X3, LAMP_Y3, 0]])]
    const ssrFlow = plusFlow(ssrHolder, loopOut(ssr.lane), paint((at) => (at.x < ssr.part.triacAt[0] ? live.fl : null)), true)
    const relayFlow = plusFlow(relayHolder, loopOut(mod.lane), paint((at) => (at.x < mod.relay.contacts.no[0] - 0.4 ? live.fl : null)), true)

    return {
      scene,
      view: { center: [-1.8, 3.6, 0], radius: 58, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = (st.s = solve3(p))
        if (s.kind !== st.kind) {
          st.kind = s.kind
          st.t = 0
        }
        st.show += ((s.kind === 'ssr' ? 1 : 0) - st.show) * ease(dt, 8)
        presence(ssrHolder, st.show)
        presence(relayHolder, 1 - st.show)
        st.t = (st.t + dt / SLOW3) % PERIOD3
        const t = st.t
        const v = mainsAt(t)
        const on = conducts3(s.kind, t)
        const i = on ? v / s.r : 0
        const pin = t >= T_ON3 && t < T_OFF3
        live.fl = 0.5 + (0.5 * v) / VPK3
        live.closed = on
        st.glow += ((on ? 1 : 0) - st.glow) * ease(dt, 6)
        lamp.setGlow(st.glow * clamp01(0.3 + s.amps / 10))
        st.heat += ((on ? s.heat : 0) / 20 - st.heat) * ease(dt, 0.8)
        ssr.part.set(pin ? 1 : 0, on ? Math.abs(i) / (s.amps * Math.SQRT2) : 0, st.heat)
        const arm = armAt(t)
        mod.relay.set(arm, pin ? 1 : 0)
        mod.relay.coilFlow.step(pin ? dt * 2 : 0)
        const arcing = s.kind === 'relay' && ((t >= BREAK3 && t < ARC_END3) || (t >= MAKE3 && t < MAKE3 + 0.6e-3))
        const tip = mod.relay.tipAt(arm)
        const no = mod.relay.contacts.no
        spark.set([no[0], no[1] + 0.3, 0.6], [tip[0], tip[1] - 0.2, 0.6], arcing ? clamp01(0.4 + Math.abs(i) / 10) : 0)
        ;(s.kind === 'ssr' ? ssrFlow : relayFlow).step(dt * 0.6 * i)
        ssr.input.mesh.visible = pin
        ssr.input.step(dt * 300 * s.drive)
        const now = t / PERIOD3
        mainsTrace.draw((u) => vy(mainsAt(u * PERIOD3)), now)
        iTrace.draw((u) => (conducts3(s.kind, u * PERIOD3) ? (vy(mainsAt(u * PERIOD3)) * s.amps) / 10 : 0), now)
        pinTrace.draw((u) => pinY(u * PERIOD3), now)
      },
      readouts: () => {
        const s = st.s
        return [
          { label: s.kind === 'ssr' ? 'Drive, 3.3 V' : 'Drive, 5 V', value: si(s.drive, 'A', 2), tone: s.kind === 'ssr' ? 'ok' : 'warn' },
          { label: 'Heat', value: si(s.heat, 'W', 2), tone: s.heat > 5 ? 'warn' : 'ok' },
          { label: 'Makes at', value: volts(tiny(s.makeV, 1e-6)), tone: s.makeV > 1 ? 'warn' : 'ok' },
          { label: 'Breaks', value: si(tiny(s.breakA, 1e-6), 'A', 2), tone: s.breakA > 0.01 ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

/** The SSR on the mains loop: GPIO → in+, in− → GND, outputs down to the two buses. */
function solidStateRelay3(holder: THREE.Group) {
  const part = ssrPart(holder, AT3S, { scale: 1 })
  const { inP, inN, out } = part.pins
  wire(holder, [[SX2, YPIN, 0], [inP[0], YPIN, 0], inP])
  wire(holder, [[SX2, YGND, 0], [inN[0], YGND, 0], inN])
  wire(holder, [out[0], [out[0][0], OUT_LO, 0]])
  wire(holder, [out[1], [out[1][0], OUT_HI, 0], [UP3, OUT_HI, 0]])
  const tri = part.triacAt
  const input = plusFlow(holder, lane([[SX2, YPIN, 0], [inP[0], YPIN, 0], inP, [inP[0], AT3S[1] + 1, 0], [inN[0], AT3S[1] + 1, 0], inN, [inN[0], YGND, 0], [SX2, YGND, 0]]), (at) => (at.y <= YGND + 0.01 || at.x > inP[0] + 0.5 ? 0 : PIN_V / VCC))
  const lane3: V3[] = lane([[out[0][0], OUT_LO, 0], out[0], [out[0][0], tri[1], 0], [out[1][0], tri[1], 0], out[1], [out[1][0], OUT_HI, 0]])
  return { part, input, lane: lane3 }
}

/** A relay module: the relay on a board with the last lesson's driver (2N2222 + 1N4007), fed from the MCU's 5 V, GPIO, GND. */
function relayModule3(holder: THREE.Group) {
  box(holder, [12.6, 13, 0.3], mat('#1f5a3a', { rough: 0.55 }), [-6.2, 0.4, -1.8])
  const relay = relayPart(holder, AT2, { scale: K2, cased: true })
  const [pa, pb] = relay.pins.coil
  const { com, no } = relay.pins
  wire(holder, [[SX2, Y5V, 0], [pa[0], Y5V, 0], pa])
  wire(holder, [pb, [pb[0], YPIN + S2, 0]])
  wire(holder, [[SX2, YGND, 0], [pb[0], YGND, 0], [pb[0], YPIN - S2, 0]])
  wire(holder, [[SX2, YPIN, 0], [pb[0], YPIN, 0]])
  resistorAlong(holder, 1000, [(SX2 + pb[0]) / 2 - 1, YPIN, 0], [(SX2 + pb[0]) / 2 + 1, YPIN, 0], 1.4)
  transistorPart(holder, [pb[0], YPIN, 0], { scale: S2 })
  wire(holder, [[pb[0], Y5V, 0], [pb[0] - 0.2, Y5V, 0]])
  diodeAlong(holder, [pb[0], Y5V, 0], [pa[0], Y5V, 0], { scale: 0.95 }).set(-0.6)
  wire(holder, [com, [com[0], OUT_LO, 0]])
  wire(holder, [no, [no[0], OUT_HI, 0], [UP3, OUT_HI, 0]])
  return { relay, lo: com[0], lane: [...lane([[com[0], OUT_LO, 0]]), ...relay.contactLane(true, LANE), ...lane([[no[0], OUT_HI, 0]])] }
}
