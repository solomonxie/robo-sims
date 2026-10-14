import * as THREE from 'three/webgpu'
import { BJTS, Bjt, LEDS, LED_RATED_A, TT_MOTOR, baseResistorFor, bjtCollector, bjtSwitch, diodeNode, ledStringAmps, motorAmps, motorRpm } from '../../core/physics'
import { e12Below, nearestE12 } from '../../core/resistorColors'
import { fitDigits, ohms, si, volts } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CELL_H,
  CONVENTIONAL,
  ELECTRON,
  GREY,
  HIGH_V,
  HOLE,
  LANE,
  RING,
  RS,
  bjtDie,
  cell,
  clamp01,
  currentSource,
  diodeAlong,
  dropAlong,
  ease,
  emptyGroup,
  groundSymbol,
  heatWaves,
  icPackage,
  ivScreen,
  ledLamp,
  lerp,
  motorCan,
  plusFlow,
  pulseLabel,
  swapResistor,
  ticks,
  transistorPart,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const FULL = 5
const VCC = 5
const S = 1.6
const LEG = 0.5 * S
const RED = LEDS.red
const R_LED = 150
const tiny = (x: number, eps: number) => (Math.abs(x) < eps ? 0 : x)
const ledLoad = (r: number) => (v: number) => ledStringAmps(v, r, RED)
const SWITCH = { cutoff: 'off', active: 'half on', saturation: 'on' } as const
const REGION = { cutoff: 'cut-off', active: 'active', saturation: 'saturated' } as const

interface Rig {
  /** Base tip, the three rails, the base source x and the collector supply x. */
  bx: number
  yb: number
  yt: number
  yg: number
  sx: number
  vx: number
}
interface Live {
  vin: number
  vbe: number
  vce: number
  /** Volts where the load starts, after its series resistor. */
  top: number
  /** Load input end and output end along the top rail (supply side first). */
  loadA: number
  loadB: number
}

const cellAt = (y: number, cy: number) => clamp01((y - cy + CELL_H / 2) / CELL_H)

/** Potential fraction on the collector loop: supply cell on the right, load on the top rail, transistor C → E down x = bx. */
function collectorPaint(at: THREE.Vector3, g: Rig, s: Live, rx: number | null) {
  const yc = g.yb + S
  const ye = g.yb - S
  if (at.x >= g.vx - 0.01) return cellAt(at.y, (g.yt + g.yg) / 2)
  if (at.y >= g.yt - 0.01) {
    if (at.x > s.loadA) return rx === null ? 1 : dropAlong(at, [g.vx, g.yt, 0], [s.loadA, g.yt, 0], 1, s.top / FULL, RS)
    if (at.x >= s.loadB) return lerp(s.vce, s.top, (at.x - s.loadB) / (s.loadA - s.loadB)) / FULL
    return s.vce / FULL
  }
  if (at.y <= g.yg + 0.01) return 0
  if (at.y >= yc - 0.01) return s.vce / FULL
  if (at.y <= ye + 0.01) return 0
  return ((s.vce / FULL) * (at.y - ye)) / (yc - ye)
}

/** Potential fraction on the base loop: source up x = sx, Rb (if any) on the base wire, then B → E inside. */
function basePaint(at: THREE.Vector3, g: Rig, s: Live, withRb: boolean, srcCell: boolean) {
  const ye = g.yb - S
  if (at.y <= g.yg + 0.01) return 0
  if (at.x <= g.sx + 0.01) return srcCell ? (s.vin / FULL) * cellAt(at.y, (g.yb + g.yg) / 2) : s.vbe / FULL
  if (at.y >= g.yb - 0.01) return withRb ? dropAlong(at, [g.sx, g.yb, 0], [g.bx, g.yb, 0], s.vin / FULL, s.vbe / FULL, RS) : s.vbe / FULL
  if (at.y <= ye + 0.01) return 0
  return ((s.vbe / FULL) * (at.y - ye)) / (g.yb - ye)
}

/** Transistor on its side at (bx, yb), emitter to the bottom rail, collector to the top rail, base lane and collector
 *  lane in front; the load sits on the top rail between `loadB` (collector side) and `loadA` (supply side). */
function npnRig(scene: THREE.Scene, g: Rig) {
  const t = transistorPart(scene, [g.bx, g.yb, 0], { scale: S })
  const { c, e } = t.pins
  const dx = t.die[0]
  wire(scene, [c, [g.bx, g.yt, 0]])
  wire(scene, [e, [g.bx, g.yg, 0]])
  wire(scene, [[g.vx, g.yt, 0], [g.vx, g.yg, 0], [g.sx, g.yg, 0]])
  add(scene, cell(CELL_H, 1.5), [g.vx, (g.yt + g.yg) / 2, 0])
  const deep = LANE + 0.7
  /** B → through the body → E → down to the bottom rail. */
  const baseInner: V3[] = [[g.bx, g.yb, LANE], [dx, g.yb, deep], [dx, e[1], deep], [g.bx, e[1], LANE], [g.bx, g.yg, LANE]]
  const collectorTail: V3[] = [[g.bx, g.yt, LANE], [g.bx, c[1], LANE], [dx, c[1], deep], [dx, e[1], deep], [g.bx, e[1], LANE], [g.bx, g.yg, LANE]]
  return { t, dx, baseLane: [[g.sx, g.yg, LANE], [g.sx, g.yb, LANE], ...baseInner] as V3[], baseInner, collectorTail }
}

/** Collector lane from the supply's bottom, up the cell, along the top rail through an LED standing at `lx`. */
const ledLane = (g: Rig, lx: number, tail: V3[]): V3[] => {
  const die = g.yt + 3.8 * S
  return [[g.vx, g.yg, LANE], [g.vx, g.yt, LANE], [lx + LEG, g.yt, LANE], [lx + LEG, die, LANE + 0.7], [lx - LEG, die, LANE + 0.7], [lx - LEG, g.yt, LANE], ...tail]
}

// --- NPN as a switch: a small base current lets a big collector current flow; inside, electrons shoot across a thin base. ---

const G1: Rig = { bx: -8, yb: -1, yt: 4, yg: -6, sx: -17, vx: 3.5 }
const LX1 = -4.2
const RB1 = 4700
const RX1 = (G1.vx + LX1 + LEG) / 2
const RBX1 = (G1.sx + G1.bx) / 2
const Q1 = BJTS['2N2222']
const DIE1: V3 = [11.2, -0.6, 0]

const solve1 = (vin: number) => bjtSwitch({ vin, rb: RB1, vcc: VCC, load: ledLoad(R_LED) }, Q1)

export const npnAsASwitch: Lesson = {
  id: 'transistor-bjt-npn-as-a-switch',
  title: 'NPN as a switch',
  tagline: 'A trickle into the base opens the tap',
  formula: (p) => {
    const vin = n(p, 'vin')
    const r = solve1(vin)
    if (r.region === 'cutoff') return `Vin = ${volts(vin)} < ~0.6 V: the base–emitter diode stays off, Ib ≈ 0, so Ic ≈ 0: switch open`
    return `Ib = (Vin − Vbe) / Rb = (${volts(vin)} − ${volts(r.vbe)}) / ${ohms(RB1)} = ${si(r.ib, 'A', 3)} · Ic = ${si(r.ic, 'A', 3)} = ${Math.round(r.gain)} × Ib`
  },
  legend: [
    { color: CONVENTIONAL, label: 'Ib, µA (left) · Ic, mA (top)', shape: 'dot' },
    { color: ELECTRON, label: 'Inside: electrons E → C', shape: 'arrow-right' },
    { color: HOLE, label: 'Holes from B: the base current', shape: 'dot' },
    { color: HIGH_V, label: 'Wires by potential, 0–5 V', shape: 'dot' },
  ],
  points: [
    'A bipolar transistor (BJT) has three legs: emitter (E), base (B) and collector (C). In an NPN, current into the base lets a much larger current flow from collector to emitter.',
    'Base to emitter is a diode: below ~0.6 V nothing flows into the base, and nothing flows through the collector either. The LED is dark: the switch is open.',
    'Raise the base past ~0.7 V and a little current flows in, set by the base resistor: here (3.3 V − 0.7 V) / 4.7 kΩ ≈ 0.55 mA. Now ~19 mA flows through the LED: the switch is closed.',
    'Inside (right), the emitter is packed with electrons and the p-type base is very thin. Once its diode turns on, electrons pour into the base; almost all shoot straight across into the collector, and only ~1 in 150 meets a hole fed in by the base current.',
    'Fully on, only ~0.1 V is left across the transistor, so it barely warms. A microcontroller pin can light a lamp, run a motor or click a relay this way.',
  ],
  controls: [{ kind: 'slider', key: 'vin', label: 'Base drive Vin', min: 0, max: 3.3, initial: 3.3, step: 0.05, format: volts }],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const live: Live = { vin: 3.3, vbe: 0, vce: VCC, top: VCC, loadA: LX1 + LEG, loadB: LX1 - LEG }
    const rig = npnRig(scene, G1)
    wire(scene, [[G1.sx, G1.yg, 0], [G1.sx, G1.yb, 0], [G1.bx, G1.yb, 0]])
    add(scene, cell(CELL_H, 1.2), [G1.sx, (G1.yb + G1.yg) / 2, 0])
    swapResistor(add(scene, new THREE.Group()), RB1, [RBX1 - 1, G1.yb, 0], [RBX1 + 1, G1.yb, 0])
    wire(scene, [[G1.bx, G1.yt, 0], [LX1 - LEG, G1.yt, 0]])
    wire(scene, [[LX1 + LEG, G1.yt, 0], [G1.vx, G1.yt, 0]])
    swapResistor(add(scene, new THREE.Group()), R_LED, [RX1 - 1, G1.yt, 0], [RX1 + 1, G1.yt, 0])
    const lamp = ledLamp(scene, RED.color, [LX1, G1.yt, 0], { scale: S })
    add(scene, groundSymbol(), [-2, G1.yg, 0])
    const collector = plusFlow(scene, ledLane(G1, LX1, rig.collectorTail), (at) => collectorPaint(at, G1, live, RX1), true)
    const base = plusFlow(scene, rig.baseLane, (at) => basePaint(at, G1, live, true, true), true)
    const ibLabel = pulseLabel(scene, 3, CONVENTIONAL, [RBX1, G1.yb + 1.8, 0], 1.1)
    const icLabel = pulseLabel(scene, 3, CONVENTIONAL, [RX1, G1.yt + 1.8, 0], 1.1)
    const die = bjtDie(scene, DIE1, { width: 8.4, height: 3.2 })

    const st = { vin: 3.3, r: solve1(3.3) }
    return {
      scene,
      view: { center: [0, 4, 0], radius: 59, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        st.vin += (n(p, 'vin') - st.vin) * ease(dt, 5)
        const r = (st.r = solve1(st.vin))
        Object.assign(live, { vin: st.vin, vbe: r.vbe, vce: r.vce, top: VCC - r.ic * R_LED })
        lamp.set(r.ic / LED_RATED_A)
        lamp.step(dt)
        rig.t.set(r.ic / LED_RATED_A, 0)
        collector.step(dt * 250 * r.ic)
        base.step(dt * 250 * r.ib)
        die.step(dt, { rate: 40 * Math.sqrt(clamp01(r.ic / LED_RATED_A)), recombine: r.ic > 0 ? r.ib / r.ic : 0, saturation: r.region === 'saturation' ? 1 : 0 })
        ibLabel.show(fitDigits(Math.max(0, r.ib) * 1e6, 3))
        icLabel.show(fitDigits(Math.max(0, r.ic) * 1e3, 3))
        ibLabel.frame(dt)
        icLabel.frame(dt)
      },
      readouts: () => {
        const r = st.r
        return [
          { label: 'Base Ib', value: si(tiny(r.ib, 1e-9), 'A', 3) },
          { label: 'Collector Ic', value: si(tiny(r.ic, 1e-9), 'A', 3), tone: r.ic > 1e-3 ? 'ok' : undefined },
          { label: 'Ic / Ib', value: r.ic > 1e-6 ? `${Math.round(r.gain)}×` : '—' },
          { label: `Vce: ${SWITCH[r.region]}`, value: volts(r.vce), tone: r.region === 'active' ? 'warn' : undefined },
        ]
      },
    }
  },
}

// --- Gain and saturation: Ic = β·Ib until the load can't take more; then Vce collapses and the transistor is saturated. ---

const G2: Rig = { bx: -10.5, yb: -1, yt: 4, yg: -6, sx: -16.5, vx: 1.6 }
const LX2 = -6.6
const RX2 = (G2.vx + LX2 + LEG) / 2
const P2: V3 = [9.4, 0.4, 0]
const P2_W = 9
const P2_H = 8.4
const I2_FULL = 0.03
const IB_MAX = 300e-6
const IB_FAMILY = [25e-6, 50e-6, 75e-6, 100e-6]
type Part = keyof typeof BJTS
const partOf = (p: Params): Part => (p.part === 'BC547' ? 'BC547' : '2N2222')
const solve2 = (ib: number, q: Bjt) => bjtSwitch({ vin: 1e3, rb: 1e3 / Math.max(ib, 1e-15), vcc: VCC, load: ledLoad(R_LED) }, q)

export const gainAndSaturation: Lesson = {
  id: 'transistor-bjt-gain-and-saturation',
  title: 'Gain and saturation',
  tagline: 'β times the base, until the load runs out',
  formula: (p) => {
    const q = BJTS[partOf(p)]
    const ib = n(p, 'ib') * 1e-6
    const r = solve2(ib, q)
    const want = q.beta * ib
    if (r.region !== 'saturation') return `Active: Ic = β·Ib = ${q.beta} × ${si(ib, 'A', 3)} = ${si(want, 'A', 3)} (Vce = ${volts(r.vce)} takes the rest)`
    return `β·Ib = ${si(want, 'A', 3)}, but the LED + ${ohms(R_LED)} from 5 V pass at most ~${si(r.ic, 'A', 3)}: saturated, Vce = ${volts(r.vce)}`
  },
  legend: [
    { color: RING, label: 'Ic vs Vce at this Ib; dot = now', shape: 'dot' },
    { color: GREY, label: 'Ib = 25, 50, 75, 100 µA', shape: 'dot' },
    { color: '#e8e8e8', label: 'What the LED + 150 Ω allow', shape: 'dot' },
    { color: CONVENTIONAL, label: 'β·Ib: what the gain asks, mA', shape: 'dot' },
  ],
  points: [
    'Feed a set current into the base (the source on the left) and the collector passes β times it: Ic = β·Ib. β (hFE) is the current gain, ~150 for a 2N2222 and ~300 for a BC547.',
    'In between it is a valve, not a switch (the active region): each flat curve is one base current, and Vce is whatever voltage is left once the LED and resistor take theirs. The transistor burns Vce × Ic.',
    'Raise Ib and the dot climbs the white line: the load’s own limit. Past ~19 mA the LED and its 150 Ω can’t pass more however hard the base pushes: the transistor is saturated, Vce falls to ~0.1 V and Ic/Ib drops below β.',
    'Saturation is what you want in a switch: almost no voltage left across it, so almost no heat, and the load gets the full supply.',
    'β varies 2–3× between parts of the same type and with temperature, so never rely on it: drive the base hard enough to saturate even the worst one (next lesson).',
  ],
  controls: [
    { kind: 'choice', key: 'part', options: [{ value: '2N2222', label: '2N2222 (β 150)' }, { value: 'BC547', label: 'BC547 (β 300)' }], initial: '2N2222' },
    { kind: 'slider', key: 'ib', label: 'Base current Ib', min: 0, max: IB_MAX * 1e6, initial: 60, step: 5, format: (v) => `${Math.round(v)} µA` },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const live: Live = { vin: 0, vbe: 0, vce: VCC, top: VCC, loadA: LX2 + LEG, loadB: LX2 - LEG }
    const rig = npnRig(scene, G2)
    wire(scene, [[G2.sx, G2.yg, 0], [G2.sx, G2.yb, 0], [G2.bx, G2.yb, 0]])
    add(scene, currentSource(1.5), [G2.sx, (G2.yb + G2.yg) / 2, 0])
    wire(scene, [[G2.bx, G2.yt, 0], [LX2 - LEG, G2.yt, 0]])
    wire(scene, [[LX2 + LEG, G2.yt, 0], [G2.vx, G2.yt, 0]])
    swapResistor(add(scene, new THREE.Group()), R_LED, [RX2 - 1, G2.yt, 0], [RX2 + 1, G2.yt, 0])
    const lamp = ledLamp(scene, RED.color, [LX2, G2.yt, 0], { scale: S })
    const collector = plusFlow(scene, ledLane(G2, LX2, rig.collectorTail), (at) => collectorPaint(at, G2, live, RX2), true)
    const base = plusFlow(scene, rig.baseLane, (at) => basePaint(at, G2, live, false, false), true)
    const ibLabel = pulseLabel(scene, 3, CONVENTIONAL, [(G2.sx + G2.bx) / 2, G2.yb + 1.6, 0], 1.1)
    const icLabel = pulseLabel(scene, 3, CONVENTIONAL, [RX2, G2.yt + 1.8, 0], 1.1)

    const { plot, dot, y } = ivScreen(scene, P2, P2_W, P2_H, [5, 3])
    ticks(plot, [[0, '0'], [0.4, '2'], [1, '5']], [[1 / 3, '10'], [2 / 3, '20'], [1, '30']])
    const family = IB_FAMILY.map(() => {
      const t = plot.trace(GREY, { radius: 0.06 })
      t.material.emissiveIntensity = 0.25
      return t
    })
    const curve = plot.trace(RING, { radius: 0.12 })
    plot.trace('#e8e8e8', { radius: 0.08 }).draw((u) => y(ledLoad(R_LED)(VCC - u * VCC) / I2_FULL), null)
    const ask = plot.level(CONVENTIONAL)
    const vceLabel = pulseLabel(plot.group, 4, RING, [0, -P2_H / 2 - 2.4, 0], 1)

    const st = { part: '' as Part | '', ib: 60e-6, r: solve2(60e-6, BJTS['2N2222']), shownIb: NaN }
    return {
      scene,
      view: { center: [-0.6, 3, 0], radius: 59, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const part = partOf(p)
        const q = BJTS[part]
        if (part !== st.part) {
          st.part = part
          st.shownIb = NaN
          IB_FAMILY.forEach((ib, i) => family[i].draw((u) => y(bjtCollector(ib, u * VCC, q).amps / I2_FULL), null))
        }
        st.ib += (n(p, 'ib') * 1e-6 - st.ib) * ease(dt, 5)
        const r = (st.r = solve2(st.ib, q))
        if (!(Math.abs(st.ib - st.shownIb) <= 0.2e-6)) {
          st.shownIb = st.ib
          curve.draw((u) => y(bjtCollector(st.ib, u * VCC, q).amps / I2_FULL), null)
        }
        Object.assign(live, { vbe: r.vbe, vce: r.vce, top: VCC - r.ic * R_LED })
        dot.position.set(plot.xAt(r.vce / VCC), y(Math.min(1, r.ic / I2_FULL)), 0.4)
        ask.set(y(Math.min(1.2, (q.beta * st.ib) / I2_FULL)))
        lamp.set(r.ic / LED_RATED_A)
        lamp.step(dt)
        rig.t.set(r.ic / LED_RATED_A, clamp01((r.watts - 0.02) / 0.08))
        collector.step(dt * 250 * r.ic)
        base.step(dt * 250 * r.ib)
        ibLabel.show(fitDigits(st.ib * 1e6, 3))
        icLabel.show(fitDigits(r.ic * 1e3, 3))
        vceLabel.show(r.vce.toFixed(2))
        for (const l of [ibLabel, icLabel, vceLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const q = BJTS[partOf(p)]
        const r = st.r
        return [
          { label: 'β·Ib', value: si(q.beta * st.ib, 'A', 3) },
          { label: 'Collector Ic', value: si(tiny(r.ic, 1e-9), 'A', 3), tone: 'ok' },
          { label: `Vce: ${REGION[r.region]}`, value: volts(r.vce), tone: r.region === 'saturation' ? 'ok' : r.region === 'active' ? 'warn' : undefined },
          { label: 'Transistor heat', value: si(tiny(r.watts, 1e-6), 'W', 2) },
        ]
      },
    }
  },
}

// --- Base resistor: pick Rb so the worst-case transistor still saturates, without overloading the GPIO pin. ---

const MCU: V3 = [-16.6, -3.4, 0]
const PIN_X = MCU[0] + 1.7 + 0.85
const GND_Y = MCU[1] - 2.4
const G3: Rig = { bx: -6.6, yb: MCU[1] + 2.4, yt: 3.4, yg: -7.2, sx: PIN_X, vx: 8.6 }
const RBX3 = (PIN_X + G3.bx) / 2
const LX3 = 1.2
const RX3 = (G3.vx + LX3 + LEG) / 2
const MOTOR_R = 1.8
const MOTOR_GAP = 0.8 * MOTOR_R
const GPIO_V = 3.3
const GPIO_OK_A = 0.02
const GPIO_MAX_A = 0.04
const Q3 = BJTS['2N2222']
type Load = 'led' | 'motor'
const loadOf = (p: Params): Load => (p.load === 'led' ? 'led' : 'motor')
const LOADS = {
  led: { amps: (v: number) => ledLoad(R_LED)(v), need: diodeNode(VCC, R_LED, RED).sourceA },
  motor: { amps: (v: number) => motorAmps(v), need: TT_MOTOR.noLoadA },
}
const solve3 = (p: Params) => {
  const load = loadOf(p)
  const rb = nearestE12(n(p, 'rb'))
  const r = bjtSwitch({ vin: GPIO_V, rb, vcc: VCC, load: LOADS[load].amps }, Q3)
  const max = baseResistorFor(GPIO_V, LOADS[load].need, Q3)
  return { load, rb, r, max, pick: e12Below(max) }
}
const pinTone = (a: number) => (a > GPIO_MAX_A ? 'bad' : a > GPIO_OK_A ? 'warn' : 'ok')

export const baseResistor: Lesson = {
  id: 'transistor-bjt-base-resistor',
  title: 'Base resistor',
  tagline: 'Enough to saturate, not enough to hurt the pin',
  formula: (p) => {
    const s = solve3(p)
    return `Rb ≤ (3.3 − 0.7) V × β / (3 × Ic) = 2.6 × ${Q3.beta} / (3 × ${si(LOADS[s.load].need, 'A', 3)}) = ${ohms(s.max)} → ${ohms(s.pick)} · now ${ohms(s.rb)}: Ib = ${si(s.r.ib, 'A', 3)}, Ic/Ib = ${Math.round(s.r.gain)}`
  },
  legend: [
    { color: CONVENTIONAL, label: 'Pin current Ib, mA (left) · Ic, mA', shape: 'dot' },
    { color: RING, label: 'Motor speed, rpm', shape: 'dot' },
    { color: '#ff8a1e', label: 'Transistor heat: Vce × Ic', shape: 'dot' },
    { color: HIGH_V, label: 'Wires by potential, 0–5 V', shape: 'dot' },
  ],
  points: [
    'A 3.3 V GPIO pin drives the base through Rb; the transistor switches a 5 V load. Rb sets the base current: Ib = (3.3 V − 0.7 V) / Rb.',
    'The load needs Ic, so the base needs at least Ic / β. β varies between parts, so give it ~3× that: Rb ≤ 2.6 V × β / (3·Ic), rounded down. The LED (19 mA) is happy with 6.8 kΩ; the motor (150 mA) needs 820 Ω.',
    'Too big an Rb starves the base: Ic = β·Ib is less than the load wants, so the transistor sits half on. The motor stalls or crawls, and the transistor burns Vce × Ic: a TO-92 is rated ~0.6 W.',
    'Too small wastes current and loads the pin: an ESP32 pin is comfortable to ~20 mA and has an absolute limit of 40 mA. 100 Ω here asks 26 mA.',
    'A motor draws its stall current (~1 A for a TT motor) for a moment as it starts, and kicks back when switched off: hence the flyback diode across it (Diode → Flyback diode). For bigger loads use a MOSFET.',
  ],
  controls: [
    { kind: 'choice', key: 'load', options: [{ value: 'motor', label: 'TT motor' }, { value: 'led', label: 'LED' }], initial: 'motor' },
    { kind: 'slider', key: 'rb', label: 'Base resistor Rb', min: 47, max: 100e3, initial: 820, log: true, format: (v) => ohms(nearestE12(v)) },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const live: Live = { vin: GPIO_V, vbe: 0, vce: VCC, top: VCC, loadA: 0, loadB: 0 }
    const rig = npnRig(scene, G3)
    add(scene, icPackage(3.4, 7.2, 3), MCU)
    wire(scene, [[PIN_X, G3.yb, 0], [G3.bx, G3.yb, 0]])
    wire(scene, [[PIN_X, GND_Y, 0], [PIN_X, G3.yg, 0]])
    const rbHolder = add(scene, new THREE.Group())
    const loadHolder = add(scene, new THREE.Group())
    const heat = heatWaves(scene, 2.4, { count: 3, rise: 4 })
    heat.group.position.set(rig.dx, G3.yb + 1.6, 0)
    const ibLabel = pulseLabel(scene, 3, CONVENTIONAL, [RBX3, G3.yb + 1.8, 0], 1.1)
    const icLabel = pulseLabel(scene, 3, CONVENTIONAL, [G3.bx + 2.6, G3.yt + 1.6, 0], 1.1)
    const rpmLabel = pulseLabel(scene, 3, RING, [LX3 + 4.2, G3.yt + 3, 0], 1.1)
    rpmLabel.display.set('')
    const g = G3
    const tail = rig.collectorTail
    const base = plusFlow(scene, [[PIN_X, g.yb, LANE], ...rig.baseInner, [PIN_X, g.yg, LANE], [PIN_X, GND_Y, LANE]], (at) => {
      if (at.y >= g.yb - 0.01) return dropAlong(at, [PIN_X, g.yb, 0], [g.bx, g.yb, 0], live.vin / FULL, live.vbe / FULL, RS)
      if (at.x <= PIN_X + 0.01) return 0
      return basePaint(at, g, live, true, false)
    })
    const motorUp = g.yt + 1.6 + MOTOR_R
    const flows = {
      led: plusFlow(scene, ledLane(g, LX3, tail), (at) => collectorPaint(at, g, live, RX3), true),
      motor: plusFlow(
        scene,
        [[g.vx, g.yg, LANE], [g.vx, g.yt, LANE], [LX3 + MOTOR_GAP, g.yt, LANE], [LX3 + MOTOR_GAP, motorUp - MOTOR_R, LANE + 0.4], [LX3 - MOTOR_GAP, motorUp - MOTOR_R, LANE + 0.4], [LX3 - MOTOR_GAP, g.yt, LANE], ...tail],
        (at) => collectorPaint(at, g, live, null),
        true,
      ),
    }
    let lamp: ReturnType<typeof ledLamp> | null = null
    let motor: ReturnType<typeof motorCan> | null = null

    const st = { load: '' as Load | '', rb: NaN, s: solve3({ load: 'motor', rb: 820 }), rpm: 0, ib: 0, ic: 0, vce: VCC, heat: 0 }
    return {
      scene,
      view: { center: [-3.2, 3.9, 0], radius: 59, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = (st.s = solve3(p))
        if (s.rb !== st.rb) swapResistor(rbHolder, (st.rb = s.rb), [RBX3 - 1, g.yb, 0], [RBX3 + 1, g.yb, 0])
        if (s.load !== st.load) {
          st.load = s.load
          emptyGroup(loadHolder)
          lamp = motor = null
          if (s.load === 'led') {
            wire(loadHolder, [[g.bx, g.yt, 0], [LX3 - LEG, g.yt, 0]])
            wire(loadHolder, [[LX3 + LEG, g.yt, 0], [g.vx, g.yt, 0]])
            swapResistor(add(loadHolder, new THREE.Group()), R_LED, [RX3 - 1, g.yt, 0], [RX3 + 1, g.yt, 0])
            lamp = ledLamp(loadHolder, RED.color, [LX3, g.yt, 0], { scale: S })
            Object.assign(live, { loadA: LX3 + LEG, loadB: LX3 - LEG })
          } else {
            wire(loadHolder, [[g.bx, g.yt, 0], [LX3 - MOTOR_GAP, g.yt, 0]])
            wire(loadHolder, [[LX3 + MOTOR_GAP, g.yt, 0], [g.vx, g.yt, 0]])
            motor = motorCan(loadHolder, [LX3, motorUp, 0], { r: MOTOR_R, legs: 1.6 })
            motor.can.rotation.set(-0.35, 0.55, 0)
            diodeAlong(loadHolder, [LX3 - MOTOR_GAP, g.yt, 0], [LX3 + MOTOR_GAP, g.yt, 0], { scale: 1 })
            Object.assign(live, { loadA: LX3 + MOTOR_GAP, loadB: LX3 - MOTOR_GAP })
          }
          flows.led.mesh.visible = s.load === 'led'
          flows.motor.mesh.visible = s.load === 'motor'
        }
        const k = ease(dt, 5)
        st.ib += (s.r.ib - st.ib) * k
        st.ic += (s.r.ic - st.ic) * k
        st.vce += (s.r.vce - st.vce) * k
        const vm = VCC - st.vce
        st.rpm += ((s.load === 'motor' ? motorRpm(vm) : 0) - st.rpm) * ease(dt, 2)
        st.heat += (s.r.watts / Q3.maxW - st.heat) * ease(dt, 1.5)
        Object.assign(live, { vbe: s.r.vbe, vce: st.vce, top: s.load === 'led' ? VCC - st.ic * R_LED : VCC })
        lamp?.set(st.ic / LED_RATED_A)
        lamp?.step(dt)
        motor?.spin(dt, st.rpm)
        rig.t.set(st.ic / LOADS[s.load].need, clamp01(st.heat))
        heat.step(dt, clamp01((st.heat - 0.15) * 1.5))
        flows[s.load].step(dt * Math.min(8, 40 * st.ic))
        base.step(dt * Math.min(8, 40 * st.ib))
        ibLabel.show(fitDigits(st.ib * 1e3, 3))
        icLabel.show(fitDigits(st.ic * 1e3, 3))
        rpmLabel.show(s.load === 'motor' ? String(Math.round(st.rpm)) : '')
        for (const l of [ibLabel, icLabel, rpmLabel]) l.frame(dt)
      },
      readouts: () => {
        const r = st.s.r
        const sat = r.region === 'saturation'
        return [
          { label: 'Pin Ib', value: si(r.ib, 'A', 3), tone: pinTone(r.ib) },
          { label: 'Load Ic', value: si(tiny(r.ic, 1e-9), 'A', 3), tone: sat ? 'ok' : 'warn' },
          { label: `Vce: ${SWITCH[r.region]}`, value: volts(r.vce), tone: sat ? 'ok' : 'warn' },
          { label: 'Heat', value: si(tiny(r.watts, 1e-6), 'W', 2), tone: r.watts > Q3.maxW ? 'bad' : r.watts > 0.25 ? 'warn' : undefined },
        ]
      },
    }
  },
}
