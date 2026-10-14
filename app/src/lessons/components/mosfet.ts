import * as THREE from 'three/webgpu'
import {
  FET_PARTS,
  FET_TJ_MAX,
  FetName,
  LEDS,
  LED_RATED_A,
  MOSFETS,
  fetSwitch,
  gateDrivePeriod,
  junctionTemp,
  ledStringAmps,
  millerPlateau,
  thresholdAt,
} from '../../core/physics'
import { nearestE12 } from '../../core/resistorColors'
import { fitDigits, ohms, si, volts } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CELL_H,
  CONVENTIONAL,
  GREY,
  HIGH_V,
  LANE,
  RING,
  RS,
  bulb,
  cell,
  clamp01,
  dropAlong,
  ease,
  emptyGroup,
  fetPart,
  groundSymbol,
  heatWaves,
  icPackage,
  ivScreen,
  ledLamp,
  lerp,
  plusFlow,
  pulseLabel,
  resistorAlong,
  scope,
  smoke,
  swapResistor,
  thermometer,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const S = 1.6
const LEG = 0.5 * S
const DEEP = LANE + 0.7
const tiny = (x: number, eps: number) => (Math.abs(x) < eps ? 0 : x)
const STATE = { cutoff: 'off', saturation: 'half on', triode: 'on' } as const
const HEAT = '#ff8a1e'
const LABEL: Record<FetName, string> = { '2N7000': '2N7000 (TO-92)', IRLZ44N: 'IRLZ44N (logic)', IRFZ44N: 'IRFZ44N (standard)' }
const partOf = (p: Params, parts: readonly FetName[]): FetName => parts.find((x) => x === p.part) ?? parts[0]
const partChoice = (parts: readonly FetName[], initial: FetName) =>
  ({ kind: 'choice', key: 'part', options: parts.map((value) => ({ value, label: LABEL[value] })), initial }) as const
const T_SHOWN = 300
const celsius = (t: number) => (t > T_SHOWN ? `> ${T_SHOWN} °C` : `${Math.round(t)} °C`)
const tjTone = (t: number) => (t > FET_TJ_MAX ? 'bad' : t > 100 ? 'warn' : undefined)
/** 0..1 epoxy glow from 40 °C up to the 150 °C limit. */
const heatOf = (tj: number) => clamp01((tj - 40) / (FET_TJ_MAX - 40))

interface Rig {
  /** Gate lead end, top rail, bottom rail (0 V), gate drive x and supply x. */
  gx: number
  gy: number
  yt: number
  yb: number
  sx: number
  vx: number
}
interface Live {
  vdd: number
  vgs: number
  vds: number
  /** Volts where the load starts, after its series resistor (if any). */
  top: number
  /** Load ends along the top rail, supply side first. */
  loadA: number
  loadB: number
}
type Pins = ReturnType<typeof fetPart>['pins']

const cellAt = (y: number, cy: number) => clamp01((y - cy + CELL_H / 2) / CELL_H)

/** Potential fraction on the drain loop: supply on the right, load on the top rail, then down through the MOSFET. */
function drainPaint(at: THREE.Vector3, g: Rig, s: Live, pins: Pins, full: number, rx: number | null) {
  if (at.x >= g.vx - 0.01) return (s.vdd / full) * cellAt(at.y, (g.yt + g.yb) / 2)
  if (at.y >= g.yt - 0.01) {
    if (at.x > s.loadA) return rx === null ? s.vdd / full : dropAlong(at, [g.vx, g.yt, 0], [s.loadA, g.yt, 0], s.vdd / full, s.top / full, RS)
    if (at.x >= s.loadB) return lerp(s.vds, s.top, (at.x - s.loadB) / (s.loadA - s.loadB)) / full
    return s.vds / full
  }
  if (at.y <= g.yb + 0.01) return 0
  return (s.vds / full) * clamp01((at.y - pins.s[1]) / (pins.d[1] - pins.s[1]))
}

/** Rebuilds `holder` with `name`'s package, gate lead at (gx, gy): drain up to the top rail and along it to `loadB`, source
 *  down to the bottom rail. Returns the part and the charge lane from the top rail through it to the bottom rail. */
function fetRig(holder: THREE.Group, g: Rig, name: FetName, loadB: number) {
  emptyGroup(holder)
  const part = fetPart(holder, [g.gx, g.gy, 0], FET_PARTS[name].pkg, { scale: S })
  const { d, s } = part.pins
  wire(holder, [d, [d[0], g.yt, 0], [loadB, g.yt, 0]])
  wire(holder, [s, [s[0], g.yb, 0]])
  const dx = part.die[0]
  const tail: V3[] = [[d[0], g.yt, LANE], [d[0], d[1], LANE], [dx, d[1], DEEP], [dx, s[1], DEEP], [s[0], s[1], LANE], [s[0], g.yb, LANE]]
  return { part, tail }
}

/** Drain loop lane: up the supply, along the top rail through `load` (supply side first), then `tail` back to 0 V. */
const drainLane = (g: Rig, load: V3[], tail: V3[]): V3[] => [[g.vx, g.yb, LANE], [g.vx, g.yt, LANE], ...load, ...tail]

// --- Gate threshold: a voltage on an insulated gate opens the channel; the datasheet threshold is barely on. ---

const G1: Rig = { gx: -9, gy: -0.6, yt: 8.2, yb: -5.6, sx: -17, vx: 3.6 }
const VDD1 = 5
const LX1 = -4.4
const RX1 = (G1.vx + LX1 + LEG) / 2
const R_LED = 150
const RED = LEDS.red
const P1: V3 = [11.4, 2.6, 0]
const P1_W = 8.4
const P1_H = 8
const VG1 = 5
const PARTS1 = ['2N7000', 'IRLZ44N'] as const
/** Datasheet Vgs(th) test current. */
const SPEC_A: Record<FetName, number> = { '2N7000': 1e-3, IRLZ44N: 250e-6, IRFZ44N: 250e-6 }
const ledLoad = (v: number) => ledStringAmps(v, R_LED, RED)
const solve1 = (vgs: number, name: FetName) => fetSwitch({ vgs, vdd: VDD1, load: ledLoad }, MOSFETS[name])
/** 1 µA … 100 mA on a log axis. */
const logF = (a: number) => clamp01((Math.log10(Math.max(a, 1e-12)) + 6) / 5)

export const gateThreshold: Lesson = {
  id: 'mosfet-gate-threshold',
  title: 'Gate threshold',
  tagline: 'A voltage, not a current, opens it',
  formula: (p) => {
    const name = partOf(p, PARTS1)
    const m = MOSFETS[name]
    const vgs = n(p, 'vgs')
    const r = solve1(vgs, name)
    const th = thresholdAt(SPEC_A[name], m)
    if (r.region === 'cutoff') return `Vgs = ${volts(vgs)}, under Vgs(th) ≈ ${volts(th)} (where ${si(SPEC_A[name], 'A')} flows): no channel, Id = ${si(tiny(r.amps, 1e-12), 'A', 2)}. The gate draws nothing.`
    if (r.region === 'saturation')
      return `Half on: Id = ½k(Vgs − Vth)² = ½ × ${m.k} A/V² × (${volts(vgs)} − ${volts(m.vthV)})² = ${si(r.amps, 'A', 3)}, and ${volts(r.vds)} stays across it`
    return `Fully on: Rds = Vds / Id = ${volts(r.vds)} / ${si(r.amps, 'A', 3)} = ${ohms(r.vds / r.amps)}; the LED + ${ohms(R_LED)} now set the current`
  },
  legend: [
    { color: RING, label: 'Id vs Vgs (log, mA); dot = now', shape: 'dot' },
    { color: GREY, label: 'The other part', shape: 'dot' },
    { color: '#e8e8e8', label: 'Datasheet Vgs(th) test current', shape: 'dot' },
    { color: HIGH_V, label: 'Wires by potential, 0–5 V', shape: 'dot' },
  ],
  points: [
    'A MOSFET is switched by voltage: its gate (G) is a small capacitor plate, insulated from everything else. Gate-to-source voltage Vgs above the threshold makes a channel from drain (D) to source (S) (Semiconductors → MOSFET physics).',
    'Below it nothing flows: the LED is dark and all 5 V sits across the MOSFET. Unlike a BJT base, the gate draws no current at all once charged.',
    'Datasheets quote Vgs(th) as the gate voltage where a mere 250 µA (2N7000: 1 mA) flows: the switch is only cracking open. The plot is logarithmic: each grid line up is 10× more current.',
    'A little above it the MOSFET is half on: Vgs sets the current (½k(Vgs − Vth)²) and it eats the volts the LED doesn’t. Higher still it is fully on, a small resistance Rds(on), and the LED gets all it wants.',
    'Vgs(th) also spreads from part to part: 0.8–3 V for a 2N7000, 1–2 V for an IRLZ44N. Design for the voltage in the Rds(on) row of the datasheet, never the threshold.',
  ],
  controls: [
    partChoice(PARTS1, '2N7000'),
    { kind: 'slider', key: 'vgs', label: 'Gate Vgs', min: 0, max: VG1, initial: 2.4, step: 0.05, format: volts },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const g = G1
    const live: Live = { vdd: VDD1, vgs: 2.4, vds: VDD1, top: VDD1, loadA: LX1 + LEG, loadB: LX1 - LEG }
    const holder = add(scene, new THREE.Group())
    wire(scene, [[g.vx, g.yt, 0], [g.vx, g.yb, 0], [g.sx, g.yb, 0], [g.sx, g.gy, 0], [g.gx, g.gy, 0]])
    add(scene, cell(CELL_H, 1.5), [g.vx, (g.yt + g.yb) / 2, 0])
    add(scene, cell(CELL_H, 1.2), [g.sx, (g.gy + g.yb) / 2, 0])
    wire(scene, [[LX1 + LEG, g.yt, 0], [g.vx, g.yt, 0]])
    swapResistor(add(scene, new THREE.Group()), R_LED, [RX1 - 1, g.yt, 0], [RX1 + 1, g.yt, 0])
    const lamp = ledLamp(scene, RED.color, [LX1, g.yt, 0], { scale: S })
    add(scene, groundSymbol(), [-1, g.yb, 0])
    const die = g.yt + 3.8 * S
    const ledPath: V3[] = [[LX1 + LEG, g.yt, LANE], [LX1 + LEG, die, DEEP], [LX1 - LEG, die, DEEP], [LX1 - LEG, g.yt, LANE]]
    const gate = plusFlow(scene, [[g.sx, g.yb, LANE], [g.sx, g.gy, LANE], [g.gx, g.gy, LANE]], (at) =>
      at.x <= g.sx + 0.01 ? (live.vgs / VDD1) * cellAt(at.y, (g.gy + g.yb) / 2) : live.vgs / VDD1,
    )
    const vgsLabel = pulseLabel(scene, 4, RING, [(g.sx + g.gx) / 2, g.gy + 1.6, 0], 1.1)
    const idLabel = pulseLabel(scene, 3, CONVENTIONAL, [RX1, g.yt + 1.8, 0], 1.1)

    const { plot, dot, y } = ivScreen(scene, P1, P1_W, P1_H, [4, 5])
    ticks(plot, [[0, '0'], [0.5, '2.5'], [1, '5']], [[0.4, '0.1'], [0.6, '1'], [0.8, '10'], [1, '100']])
    const other = plot.trace(GREY, { radius: 0.07 })
    other.material.emissiveIntensity = 0.3
    const curve = plot.trace(RING, { radius: 0.12 })
    const spec = plot.level('#e8e8e8')

    const st = { part: '' as FetName | '', vgs: 2.4, r: solve1(2.4, '2N7000') }
    let rig: ReturnType<typeof fetRig> | null = null
    let drain: ReturnType<typeof plusFlow> | null = null
    return {
      scene,
      view: { center: [0.2, 4.6, 0], radius: 62, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const name = partOf(p, PARTS1)
        if (name !== st.part) {
          st.part = name
          const r = (rig = fetRig(holder, g, name, LX1 - LEG))
          drain = plusFlow(holder, drainLane(g, ledPath, r.tail), (at) => drainPaint(at, g, live, r.part.pins, VDD1, RX1), true)
          const twin = PARTS1.find((x) => x !== name)!
          curve.draw((u) => y(logF(solve1(u * VG1, name).amps)), null)
          other.draw((u) => y(logF(solve1(u * VG1, twin).amps)), null)
          spec.set(y(logF(SPEC_A[name])))
        }
        st.vgs += (n(p, 'vgs') - st.vgs) * ease(dt, 5)
        const r = (st.r = solve1(st.vgs, name))
        Object.assign(live, { vgs: st.vgs, vds: r.vds, top: VDD1 - r.amps * R_LED })
        lamp.set(r.amps / LED_RATED_A)
        lamp.step(dt)
        rig?.part.set(r.amps / LED_RATED_A, 0)
        drain?.step(dt * 250 * r.amps)
        gate.step(0)
        dot.position.set(plot.xAt(st.vgs / VG1), y(logF(r.amps)), 0.4)
        vgsLabel.show(st.vgs.toFixed(2))
        idLabel.show(fitDigits(Math.max(0, r.amps) * 1e3, 3))
        vgsLabel.frame(dt)
        idLabel.frame(dt)
      },
      readouts: () => {
        const r = st.r
        return [
          { label: 'Gate Vgs', value: volts(tiny(st.vgs, 1e-3)) },
          { label: 'Gate current', value: '0 A', tone: 'ok' },
          { label: 'Drain Id', value: si(tiny(r.amps, 1e-9), 'A', 3), tone: r.amps > 1e-3 ? 'ok' : undefined },
          { label: `Vds: ${STATE[r.region]}`, value: volts(r.vds), tone: r.region === 'saturation' ? 'warn' : undefined },
        ]
      },
    }
  },
}

// --- Shared by the 12 V lessons: a microcontroller pin drives the gate through Rg, 10 kΩ pulls it down, a lamp on top. ---

const VDD = 12
const R_PULL = 10e3
const MCU_Y = -3.6
/** Microcontroller at x, its pin, the pull-down and Rg along the gate wire. */
function pinRig(mcuX: number, gx: number, vx: number) {
  const sx = mcuX + 1.7 + 0.85
  const g: Rig = { gx, gy: MCU_Y + 2.4, yt: MCU_Y + 2.4 + 9, yb: MCU_Y - 3.8, sx, vx }
  const pdx = gx - 2
  return { g, mcuX, pdx, rgx: (sx + pdx) / 2 }
}
type PinRig = ReturnType<typeof pinRig>

/** Static parts of a 12 V rig: MCU (pin and GND), gate wire with the pull-down, supply, rails; returns the Rg holder. */
function pinScene(scene: THREE.Scene, k: PinRig) {
  const { g } = k
  add(scene, icPackage(3.4, 7.2, 3), [k.mcuX, MCU_Y, 0])
  wire(scene, [[g.sx, g.gy, 0], [g.gx, g.gy, 0]])
  wire(scene, [[g.sx, MCU_Y - 2.4, 0], [g.sx, g.yb, 0], [g.vx, g.yb, 0], [g.vx, g.yt, 0]])
  wire(scene, [[k.pdx, g.gy, 0], [k.pdx, g.yb, 0]])
  const my = (g.gy + g.yb) / 2
  resistorAlong(scene, R_PULL, [k.pdx, my - 1, 0], [k.pdx, my + 1, 0], 1.4)
  add(scene, cell(CELL_H, 1.5), [g.vx, (g.yt + g.yb) / 2, 0])
  add(scene, groundSymbol(), [g.gx + 6, g.yb, 0])
  return add(scene, new THREE.Group())
}

/** Gate wire potential: the pin's volts before Rg, the gate's after. */
const gatePaint = (k: PinRig, live: Live, vpin: () => number) => (at: THREE.Vector3) =>
  dropAlong(at, [k.g.sx, k.g.gy, 0], [k.pdx, k.g.gy, 0], vpin() / VDD, live.vgs / VDD, RS)

const LAMP_K = 0.85
const LAMP_GAP = 1.1
const LAMP_UP = 0.6 + 3.25 * LAMP_K

/** 12 V lamp in a socket on the top rail at `lx`; returns its glow and the lane through its filament (supply side first). */
function lamp12(scene: THREE.Scene, g: Rig, lx: number) {
  box(scene, [2.8, 1.2, 1.8], mat('#2b2d33', { rough: 0.5 }), [lx, g.yt + 0.1, 0])
  wire(scene, [[lx + LAMP_GAP, g.yt, 0], [g.vx, g.yt, 0]])
  const b = bulb()
  add(scene, b.group, [lx, g.yt + LAMP_UP, 0])
  b.group.scale.setScalar(LAMP_K)
  const f = 1.1 * LAMP_K
  const lane: V3[] = [[lx + LAMP_GAP, g.yt, LANE], [lx + f, g.yt + LAMP_UP, DEEP], [lx - f, g.yt + LAMP_UP, DEEP], [lx - LAMP_GAP, g.yt, LANE]]
  return { glow: (vlamp: number) => b.setGlow(clamp01((vlamp / VDD) ** 2)), lane }
}

// --- Low-side switching: MOSFET between load and ground, so a 5 V pin switches 12 V; on, it is a resistor that warms. ---

const K2 = pinRig(-18.4, -7.4, 5.6)
const LX2 = -0.6
const PARTS2 = ['IRLZ44N', '2N7000'] as const
const THERMO: V3 = [9.8, -4.8, 0]
const THERMO_H = 9
const loadOhms = (p: Params) => VDD / n(p, 'amps')
const solve2 = (p: Params) => {
  const name = partOf(p, PARTS2)
  const rl = loadOhms(p)
  const r = fetSwitch({ vgs: 5, vdd: VDD, load: (v) => v / rl }, MOSFETS[name])
  return { name, rl, r, tj: junctionTemp(r.watts, FET_PARTS[name]) }
}

export const lowSideSwitching: Lesson = {
  id: 'mosfet-low-side-switching',
  title: 'Low-side switching',
  tagline: 'A 5 V pin switching 12 V, and the heat it costs',
  formula: (p) => {
    const { name, r, tj } = solve2(p)
    const rth = FET_PARTS[name].rthJA
    if (r.region === 'triode')
      return `P = I²·Rds(on) = (${si(r.amps, 'A', 3)})² × ${ohms(r.vds / r.amps)} = ${si(r.watts, 'W', 2)} → Tj = 25 °C + P × ${rth} °C/W = ${celsius(tj)}`
    return `A ${name} at Vgs = 5 V passes at most ~${si(r.amps, 'A', 2)}: half on, P = Vds × Id = ${volts(r.vds)} × ${si(r.amps, 'A', 2)} = ${si(r.watts, 'W', 2)} → Tj ≈ ${celsius(tj)}${tj > FET_TJ_MAX ? ': it dies' : ''}`
  },
  legend: [
    { color: CONVENTIONAL, label: 'Load current, A', shape: 'dot' },
    { color: HEAT, label: 'Junction temperature, °C (no heatsink)', shape: 'dot' },
    { color: HIGH_V, label: 'Wires by potential, 0–12 V', shape: 'dot' },
  ],
  points: [
    'Low-side switch: the load goes from +12 V to the drain, the source to ground. The gate is then measured from ground, so a 5 V (or 3.3 V) pin switches a 12 V load; the two supplies only share ground.',
    '~100 Ω in series tames the pin’s current spike into the gate capacitance; 10 kΩ from gate to ground holds the MOSFET off while the microcontroller boots and its pin floats.',
    'Fully on, a MOSFET is a resistor, Rds(on), and burns P = I²·Rds(on). IRLZ44N: 22 mΩ, so 2 A costs 88 mW; 10 A costs 2.2 W, too hot in free air (62 °C/W) without a heatsink.',
    'A 2N7000 is ~5 Ω and rated 200 mA: fine for an LED or a relay coil. Past ~0.35 A its 5 V gate can’t keep it fully on; it sits half on and burns watts in a tiny TO-92 (312 °C/W).',
    'Motor, relay or solenoid? Add a flyback diode across it (Diode → Flyback diode), or the drain spikes far past the 55–60 V rating at switch-off.',
  ],
  controls: [
    partChoice(PARTS2, 'IRLZ44N'),
    { kind: 'slider', key: 'amps', label: 'Load at 12 V', min: 0.1, max: 10, initial: 2, log: true, format: (v) => si(v, 'A', 2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const k = K2
    const g = k.g
    const live: Live = { vdd: VDD, vgs: 5, vds: 0, top: VDD, loadA: LX2 + LAMP_GAP, loadB: LX2 - LAMP_GAP }
    swapResistor(pinScene(scene, k), 100, [k.rgx - 1, g.gy, 0], [k.rgx + 1, g.gy, 0])
    const lamp = lamp12(scene, g, LX2)
    const holder = add(scene, new THREE.Group())
    const gate = plusFlow(scene, [[g.sx, g.gy, LANE], [g.gx, g.gy, LANE]], gatePaint(k, live, () => 5))
    const waves = heatWaves(scene, 2.4, { count: 3, rise: 4 })
    const fumes = smoke(scene, 2)
    const gauge = thermometer(THERMO_H)
    add(scene, gauge.group, THERMO)
    const tLabel = pulseLabel(scene, 3, HEAT, [THERMO[0], THERMO[1] + THERMO_H + 2.6, 0], 1.1)
    const idLabel = pulseLabel(scene, 4, CONVENTIONAL, [(LX2 + LAMP_GAP + g.vx) / 2, g.yt + 1.6, 0], 1.1)

    const st = { part: '' as FetName | '', s: solve2({ part: 'IRLZ44N', amps: 2 }), amps: 0, vds: VDD, tj: 25 }
    let rig: ReturnType<typeof fetRig> | null = null
    let drain: ReturnType<typeof plusFlow> | null = null
    return {
      scene,
      view: { center: [-3.6, 4.2, 0], radius: 57, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = (st.s = solve2(p))
        if (s.name !== st.part) {
          st.part = s.name
          const r = (rig = fetRig(holder, g, s.name, LX2 - LAMP_GAP))
          drain = plusFlow(holder, drainLane(g, lamp.lane, r.tail), (at) => drainPaint(at, g, live, r.part.pins, VDD, null), true)
          const [x, y] = r.part.die
          waves.group.position.set(x, y + 2, 0)
          fumes.group.position.set(x, y + 1, 0)
        }
        const e = ease(dt, 5)
        st.amps += (s.r.amps - st.amps) * e
        st.vds += (s.r.vds - st.vds) * e
        st.tj += (Math.min(T_SHOWN, s.tj) - st.tj) * ease(dt, 1.2)
        Object.assign(live, { vds: st.vds })
        lamp.glow(VDD - st.vds)
        rig?.part.set(st.amps / 2, heatOf(st.tj))
        drain?.step(dt * Math.min(8, 4 * st.amps))
        gate.step(0)
        waves.step(dt, clamp01((st.tj - 50) / 60))
        fumes.step(dt, st.tj > FET_TJ_MAX ? 1 : 0)
        gauge.set(st.tj / T_SHOWN)
        tLabel.show(String(Math.round(st.tj)))
        idLabel.show(fitDigits(st.amps, 4))
        tLabel.frame(dt)
        idLabel.frame(dt)
      },
      readouts: (p) => {
        const { r, tj } = st.s
        const want = n(p, 'amps')
        return [
          { label: 'Load current', value: si(r.amps, 'A', 3), tone: r.amps > 0.95 * want ? 'ok' : 'warn' },
          { label: `Vds: ${STATE[r.region]}`, value: volts(r.vds), tone: r.region === 'triode' ? 'ok' : 'warn' },
          { label: 'MOSFET heat', value: si(r.watts, 'W', 2) },
          { label: 'Junction', value: celsius(tj), tone: tjTone(tj) },
        ]
      },
    }
  },
}

// --- Logic-level MOSFETs: Rds(on) is only promised at the datasheet's gate voltage; a 3.3 V pin needs a part rated for it. ---

const K3 = pinRig(-18.6, -8.2, 2.6)
const LX3 = -2.4
const PARTS3 = ['IRFZ44N', 'IRLZ44N', '2N7000'] as const
const R_LAMP = 6
const lampLoad = (v: number) => v / R_LAMP
const GATES = ['3.3', '5', '10'] as const
const gateOf = (p: Params) => Number(GATES.find((x) => x === p.gate) ?? '3.3')
const RDS_SPEC: Record<FetName, string> = { '2N7000': '5 Ω max at 10 V', IRLZ44N: '22 mΩ at 5 V', IRFZ44N: '17.5 mΩ at 10 V' }
const P3: V3 = [9.4, 2.6, 0]
const P3_W = 7
const P3_H = 8
const VG3 = 10
const solve3 = (p: Params) => {
  const name = partOf(p, PARTS3)
  const vg = gateOf(p)
  const r = fetSwitch({ vgs: vg, vdd: VDD, load: lampLoad }, MOSFETS[name])
  return { name, vg, r, tj: junctionTemp(r.watts, FET_PARTS[name]) }
}

export const logicLevelMosfets: Lesson = {
  id: 'mosfet-logic-level-mosfets',
  title: 'Logic-level MOSFETs',
  tagline: 'Will a 3.3 V pin really turn it on?',
  formula: (p) => {
    const { name, vg, r, tj } = solve3(p)
    return `${name}, Rds(on) ${RDS_SPEC[name]}. At Vgs = ${volts(vg)}: Rds = Vds / Id = ${volts(r.vds)} / ${si(r.amps, 'A', 3)} = ${ohms(r.vds / r.amps)} → P = ${si(r.watts, 'W', 2)}, Tj ≈ ${celsius(tj)}`
  },
  legend: [
    { color: RING, label: 'Vds vs gate volts, 2 A lamp; dot = now', shape: 'dot' },
    { color: GREY, label: 'The other two parts', shape: 'dot' },
    { color: HEAT, label: 'MOSFET heat', shape: 'dot' },
    { color: HIGH_V, label: 'Wires by potential, 0–12 V', shape: 'dot' },
  ],
  points: [
    'The 12 V lamp wants 2 A. Every datasheet quotes Rds(on) at a stated gate voltage, and only there is it guaranteed. That row, not Vgs(th), tells you whether your pin can drive the part.',
    'IRFZ44N: 17.5 mΩ at Vgs = 10 V, threshold 2–4 V. From a 3.3 V pin it is barely half on: ~0.4 A, ~10 V across it, ~4 W of heat, a dim lamp. 5 V works on a good day; give it 10 V.',
    'IRLZ44N, its “L” (logic-level) twin: Rds(on) is specified at 4–5 V, and here even 3.3 V turns it almost fully on.',
    '2N7000: a small-signal part, ~5 Ω. Whatever the gate, 2 A is ten times its rating.',
    'For 3.3 V boards (ESP32, Raspberry Pi Pico) pick a part with Rds(on) specified at Vgs = 2.5 V (e.g. AO3400, IRLML6344), or put a gate driver between the pin and a 10–12 V gate.',
  ],
  controls: [
    partChoice(PARTS3, 'IRFZ44N'),
    { kind: 'choice', key: 'gate', options: GATES.map((value) => ({ value, label: `${value} V gate` })), initial: '3.3' },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const k = K3
    const g = k.g
    const live: Live = { vdd: VDD, vgs: 3.3, vds: VDD, top: VDD, loadA: LX3 + LAMP_GAP, loadB: LX3 - LAMP_GAP }
    swapResistor(pinScene(scene, k), 100, [k.rgx - 1, g.gy, 0], [k.rgx + 1, g.gy, 0])
    const lamp = lamp12(scene, g, LX3)
    const holder = add(scene, new THREE.Group())
    const gate = plusFlow(scene, [[g.sx, g.gy, LANE], [g.gx, g.gy, LANE]], gatePaint(k, live, () => live.vgs))
    const vgLabel = pulseLabel(scene, 4, RING, [k.rgx, g.gy + 1.6, 0], 1.1)
    const waves = heatWaves(scene, 2.4, { count: 3, rise: 4 })
    const fumes = smoke(scene, 2)

    const { plot, dot, y } = ivScreen(scene, P3, P3_W, P3_H, [10, 4])
    ticks(plot, [[0, '0'], [0.33, '3.3'], [1, '10']], [[0.5, '6'], [1, '12']])
    const others = [0, 1].map(() => {
      const t = plot.trace(GREY, { radius: 0.07 })
      t.material.emissiveIntensity = 0.3
      return t
    })
    const curve = plot.trace(RING, { radius: 0.12 })
    const vdsAt = (vg: number, name: FetName) => fetSwitch({ vgs: vg, vdd: VDD, load: lampLoad }, MOSFETS[name]).vds

    const st = { part: '' as FetName | '', s: solve3({ part: 'IRFZ44N', gate: '3.3' }), vgs: 3.3, amps: 0, vds: VDD, tj: 25 }
    let rig: ReturnType<typeof fetRig> | null = null
    let drain: ReturnType<typeof plusFlow> | null = null
    return {
      scene,
      view: { center: [-2.2, 4.2, 0], radius: 60, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = (st.s = solve3(p))
        if (s.name !== st.part) {
          st.part = s.name
          const r = (rig = fetRig(holder, g, s.name, LX3 - LAMP_GAP))
          drain = plusFlow(holder, drainLane(g, lamp.lane, r.tail), (at) => drainPaint(at, g, live, r.part.pins, VDD, null), true)
          const [x, yd] = r.part.die
          waves.group.position.set(x, yd + 2, 0)
          fumes.group.position.set(x, yd + 1, 0)
          curve.draw((u) => y(vdsAt(u * VG3, s.name) / VDD), null)
          PARTS3.filter((q) => q !== s.name).forEach((q, i) => others[i].draw((u) => y(vdsAt(u * VG3, q) / VDD), null))
        }
        const e = ease(dt, 5)
        st.vgs += (s.vg - st.vgs) * e
        const now = fetSwitch({ vgs: st.vgs, vdd: VDD, load: lampLoad }, MOSFETS[s.name])
        st.amps = now.amps
        st.vds = now.vds
        st.tj += (Math.min(T_SHOWN, s.tj) - st.tj) * ease(dt, 1.2)
        Object.assign(live, { vgs: st.vgs, vds: st.vds })
        lamp.glow(VDD - st.vds)
        rig?.part.set(st.amps / 2, heatOf(st.tj))
        drain?.step(dt * Math.min(8, 4 * st.amps))
        gate.step(0)
        waves.step(dt, clamp01((st.tj - 50) / 60))
        fumes.step(dt, st.tj > FET_TJ_MAX ? 1 : 0)
        dot.position.set(plot.xAt(st.vgs / VG3), y(st.vds / VDD), 0.4)
        vgLabel.show(st.vgs.toFixed(2))
        vgLabel.frame(dt)
      },
      readouts: () => {
        const { r, tj } = st.s
        return [
          { label: 'Rds now', value: ohms(r.vds / r.amps), tone: r.region === 'triode' ? 'ok' : 'warn' },
          { label: 'Lamp current', value: si(r.amps, 'A', 3), tone: r.amps > 1.9 ? 'ok' : 'warn' },
          { label: 'MOSFET heat', value: si(r.watts, 'W', 2) },
          { label: 'Junction', value: celsius(tj), tone: tjTone(tj) },
        ]
      },
    }
  },
}

// --- Gate drive: the gate is a capacitor; Rg sets how fast it charges, and every slow edge burns V × I. ---

const K4 = pinRig(-18.6, -8.2, 2.6)
const LX4 = -2.4
const FET4: FetName = 'IRLZ44N'
const M4 = MOSFETS[FET4]
const PART4 = FET_PARTS[FET4]
const VPIN = 5
/** A GPIO pin's own output resistance, in series with Rg. */
const R_PIN = 40
const SHOWN_S = 4
const SC4_X = 9.6
const SC4_W = 7.6
const SC4_H = 5.2
const SC4_Y = [6, -1]
const HZ = ['1000', '20000', '100000'] as const
const hzOf = (p: Params) => Number(HZ.find((x) => x === p.hz) ?? '20000')
const PLATEAU = millerPlateau(VDD, lampLoad, M4)
const QGD = PART4.cgd * VDD
const drive4 = (rg: number, hz: number) => gateDrivePeriod({ vdrive: VPIN, rg: rg + R_PIN, vdd: VDD, load: lampLoad, hz }, M4, PART4)
const sample = (a: number[], u: number) => {
  const x = clamp01(u) * (a.length - 1)
  const i = Math.min(a.length - 2, Math.floor(x))
  return a[i] + (a[i + 1] - a[i]) * (x - i)
}
/** Turn-on window for the zoomed scope: ~4 RC to settle plus the plateau. */
const zoomWindow = (rg: number) => (rg + R_PIN) * (4 * PART4.cgs + QGD / (VPIN - PLATEAU))
const pinTone = (a: number) => (a > 0.04 ? 'bad' : a > 0.02 ? 'warn' : 'ok')

export const gateDrive: Lesson = {
  id: 'mosfet-gate-drive',
  title: 'Gate drive',
  tagline: 'Charging the gate fast enough',
  formula: (p) => {
    const rg = nearestE12(n(p, 'rg'))
    const hz = hzOf(p)
    const w = drive4(rg, hz)
    const t = ((rg + R_PIN) * QGD) / (VPIN - PLATEAU)
    return `Edge ≈ (Rg + ${R_PIN} Ω pin)·Qgd / (5 V − ${volts(PLATEAU)}) = ${ohms(rg + R_PIN)} × ${si(QGD, 'C', 2)} / ${volts(VPIN - PLATEAU)} = ${si(t, 's', 2)} · loss ${si((w.switchJ + w.settledJ) * hz, 'W', 2)} at ${si(hz, 'Hz')} · shown ${Math.round(SHOWN_S * hz).toLocaleString('en-US')}× slower`
  },
  legend: [
    { color: RING, label: 'Vgs, 0–6 V; dashed = Miller plateau', shape: 'dot' },
    { color: HIGH_V, label: 'Vds, 0–12 V', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Id, 0–2 A', shape: 'dot' },
    { color: GREY, label: 'Top: one period · bottom: turn-on, zoomed', shape: 'dot' },
  ],
  points: [
    'The gate is a capacitor, ~2 nF on an IRLZ44N. To switch, the pin pushes charge in through Rg (~17 nC here) and pulls it out again: on the scope Vgs (yellow) climbs, Vds (red) falls.',
    'Vgs stalls on the Miller plateau (~1.9 V): the drain is swinging 12 V, and the gate–drain capacitance soaks up all the gate current. The edge lasts as long as the plateau: t ≈ Rg·Qgd / (Vpin − Vplateau).',
    'During an edge the MOSFET has volts across it and amps through it at once, so each edge burns ~½·V·I·t. At 20 kHz that is 40 000 edges a second: slow edges turn a cool switch into a heater.',
    'A small Rg means fast edges, but each edge pulls a spike of 5 V / (Rg + the pin’s own ~40 Ω) from the pin: ~20 mA is comfortable for an Arduino or ESP32. 100–220 Ω is the usual compromise; for fast PWM of big MOSFETs use a gate-driver chip (amps of gate current).',
    'At 10 kΩ and 20 kHz the gate never finishes charging before the pin turns off again: the MOSFET never fully turns on.',
  ],
  controls: [
    { kind: 'slider', key: 'rg', label: 'Gate resistor Rg', min: 10, max: 10e3, initial: 220, log: true, format: (v) => ohms(nearestE12(v)) },
    { kind: 'choice', key: 'hz', options: [{ value: '1000', label: '1 kHz' }, { value: '20000', label: '20 kHz PWM' }, { value: '100000', label: '100 kHz' }], initial: '20000' },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const k = K4
    const g = k.g
    const live: Live = { vdd: VDD, vgs: 0, vds: VDD, top: VDD, loadA: LX4 + LAMP_GAP, loadB: LX4 - LAMP_GAP }
    const rgHolder = pinScene(scene, k)
    const lamp = lamp12(scene, g, LX4)
    const holder = add(scene, new THREE.Group())
    const rig = fetRig(holder, g, FET4, LX4 - LAMP_GAP)
    const drain = plusFlow(scene, drainLane(g, lamp.lane, rig.tail), (at) => drainPaint(at, g, live, rig.part.pins, VDD, null), true)
    const st = { rg: NaN, hz: NaN, u: 0, w: drive4(220, 20e3), tj: 25, vpin: 0 }
    const gate = plusFlow(scene, [[g.sx, g.gy, LANE], [g.gx, g.gy, LANE]], gatePaint(k, live, () => st.vpin))
    const heat = heatWaves(scene, 2.4, { count: 3, rise: 4 })
    heat.group.position.set(rig.part.die[0], rig.part.die[1] + 2, 0)
    const pinLabel = pulseLabel(scene, 3, CONVENTIONAL, [k.rgx, g.gy + 1.6, 0], 1.1)

    const yOf = (f: number) => f * SC4_H - SC4_H / 2
    const screens = SC4_Y.map((sy) => {
      const screen = scope(scene, SC4_W, SC4_H, { divs: [10, 6], zeroAt: 0 })
      screen.group.position.set(SC4_X, sy, 0)
      screen.level(GREY).set(yOf(PLATEAU / 6))
      return { ids: screen.trace(CONVENTIONAL, { radius: 0.08 }), vds: screen.trace(HIGH_V, { radius: 0.1 }), vgs: screen.trace(RING, { radius: 0.1 }) }
    })
    let zoom = drive4(220, 1 / (2 * zoomWindow(220)))

    return {
      scene,
      view: { center: [-2.2, 4.2, 0], radius: 60, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const rg = nearestE12(n(p, 'rg'))
        const hz = hzOf(p)
        if (rg !== st.rg || hz !== st.hz) {
          swapResistor(rgHolder, rg, [k.rgx - 1, g.gy, 0], [k.rgx + 1, g.gy, 0])
          Object.assign(st, { rg, hz, u: 0, w: drive4(rg, hz) })
          zoom = drive4(rg, 1 / (2 * zoomWindow(rg)))
        }
        const w = st.w
        st.u = (st.u + dt / SHOWN_S) % 1
        const u = st.u
        st.vpin = u < 0.5 ? VPIN : 0
        const vg = sample(w.vgs, u)
        const vd = sample(w.vds, u)
        const id = sample(w.amps, u)
        Object.assign(live, { vgs: vg, vds: vd })
        const zu = u / (hz * zoomWindow(rg))
        const zoomU = zu <= 1 ? zu : null
        ;[w, zoom].forEach((wave, i) => {
          const at = (x: number) => (i ? x / 2 : x)
          const head = i ? zoomU : u
          const t = screens[i]
          t.vgs.draw((x) => yOf(sample(wave.vgs, at(x)) / 6), head)
          t.vds.draw((x) => yOf(sample(wave.vds, at(x)) / VDD), head)
          t.ids.draw((x) => yOf(sample(wave.amps, at(x)) / 2), head)
        })
        const ig = (st.vpin - vg) / (rg + R_PIN)
        gate.step(dt * Math.max(-8, Math.min(8, 300 * ig)))
        drain.step(dt * Math.min(8, 4 * id))
        lamp.glow(VDD - vd)
        st.tj += (junctionTemp((w.switchJ + w.settledJ) * hz, PART4) - st.tj) * ease(dt, 1.2)
        rig.part.set(id / 2, heatOf(st.tj))
        heat.step(dt, clamp01((st.tj - 50) / 60))
        pinLabel.show(fitDigits(Math.abs(ig) * 1e3, 3))
        pinLabel.frame(dt)
      },
      readouts: () => {
        const { w, rg, hz } = st
        const watts = (w.switchJ + w.settledJ) * hz
        const tj = junctionTemp(watts, PART4)
        return [
          { label: 'Pin peak', value: si(VPIN / (rg + R_PIN), 'A', 2), tone: pinTone(VPIN / (rg + R_PIN)) },
          { label: 'On edge', value: Number.isNaN(w.onEdge) ? 'never on' : si(w.onEdge, 's', 2), tone: Number.isNaN(w.onEdge) ? 'bad' : undefined },
          { label: 'Loss', value: si(watts, 'W', 2), tone: watts > 1 ? 'warn' : 'ok' },
          { label: 'Junction', value: celsius(tj), tone: tjTone(tj) },
        ]
      },
    }
  },
}
