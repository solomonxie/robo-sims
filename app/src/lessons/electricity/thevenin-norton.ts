import * as THREE from 'three/webgpu'
import { theveninAt } from '../../core/nodal'
import { T_NET, nortonLoad, powerTransfer, theveninDemo, theveninLoad, theveninNetwork } from '../../core/physics'
import { nearestE12 } from '../../core/resistorColors'
import { fitDigits, si } from '../../core/units'
import { V3, add, lead, mat, mesh, rod } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  Flow,
  HIGH_V,
  POWER,
  RING,
  areaPlot,
  arrow,
  cell,
  clamp01,
  currentSource,
  dropAlong,
  emptyGroup,
  glowMat,
  heatWaves,
  junction,
  path,
  plusGeometry,
  potentialColor,
  presence,
  pulseLabel,
  resistorAlong,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const VIN = 12
const NET: [number, number, number] = [100, 100, 100]
const LANE = 1.3
const R_SCALE = 1.8
const RS = 1.2 * R_SCALE
const CELL_H = 4.4
const OHMS_LABEL = '#e8e8e8'
const BOX = '#5a606c'
const volts = (v: number) => si(v, 'V', 3)
const amps = (a: number) => si(a, 'A', 3)
const ohms = (r: number) => si(r, 'Ω', 3)
const watts = (w: number) => si(w, 'W', 3)
const mA = (a: number) => a * 1000
const ease = (dt: number, rate = 5) => 1 - Math.exp(-dt * rate)
const e12 = (p: Params, k: string) => nearestE12(n(p, k))
const cellFraction = (y: number) => clamp01((y + CELL_H / 2) / CELL_H)
const plusFlow = (parent: THREE.Object3D, points: V3[], paint: (at: THREE.Vector3) => number) => {
  const flow = new Flow(path(points), 1.5, CONVENTIONAL, 0.3, plusGeometry(0.7))
  flow.colorBy((at, out) => potentialColor(paint(at), out))
  parent.add(flow.mesh)
  return flow
}
const swapResistor = (holder: THREE.Group, value: number, a: V3, b: V3) => {
  emptyGroup(holder)
  resistorAlong(holder, value, a, b, R_SCALE)
}
/** Thin outline of the "black box" whose terminals sit on its right wall. */
const boxOutline = (parent: THREE.Object3D, x0: number, x1: number, h: number) =>
  lead(parent, [[x0, -h, -0.6], [x0, h, -0.6], [x1, h, -0.6], [x1, -h, -0.6], [x0, -h, -0.6]], 0.1, mat(BOX, { emissive: '#22252b' }))

// --- Thevenin equivalent: the network, its Vth + Rth, or its IN ∥ Rth all drive the load identically. ---

type View = 'network' | 'thevenin' | 'norton'

const E_W = 10
const E_H = 6
const A_X = -3
const OUT_X = 3
const LOAD_X = 9
const L_MID = (-E_W + A_X) / 2
const E_SPEED = 90 // drawn units/s per amp
const WEIGHTS: Record<View, [number, number, number]> = { network: [1, 0, 0], thevenin: [0, 1, 0], norton: [0, 0, 1] }

const solveEquivalent = (p: Params) => {
  const view = (p.view as View) ?? 'network'
  const load = e12(p, 'load')
  const s = theveninDemo(VIN, NET, load)
  const eq = view === 'norton' ? nortonLoad(s.norton, s.rth, load) : theveninLoad(s.vth, s.rth, load)
  const [vl, il] = view === 'network' ? [s.vl, s.il] : [eq.volts, eq.amps]
  return { view, load, ...s, vl, il }
}

export const theveninEquivalent: Lesson = {
  id: 'thevenin-norton-thevenin-equivalent',
  title: 'Thevenin equivalent',
  tagline: 'Any network is one cell and one resistor',
  formula: (p) => {
    const s = solveEquivalent(p)
    if (s.view === 'thevenin') return `IL = Vth / (Rth + RL) = ${volts(s.vth)} / (${ohms(s.rth)} + ${ohms(s.load)}) = ${amps(s.il)}`
    if (s.view === 'norton') return `IL = IN × Rth / (Rth + RL) = ${amps(s.norton)} × ${ohms(s.rth)} / (${ohms(s.rth)} + ${ohms(s.load)}) = ${amps(s.il)}`
    return `Open: Vth = ${volts(s.vth)} · Shorted: IN = ${amps(s.norton)} · Rth = Vth / IN = ${ohms(s.rth)}`
  },
  legend: [
    { color: HIGH_V, label: 'Source: 12 V or Vth, V', shape: 'dot' },
    { color: OHMS_LABEL, label: 'Rth, Ω', shape: 'dot' },
    { color: CONVENTIONAL, label: 'IN and load IL, mA', shape: 'dot' },
    { color: RING, label: 'Load voltage VL, V', shape: 'dot' },
  ],
  points: [
    'Seen from two terminals, any tangle of cells and resistors behaves exactly like one cell Vth in series with one resistor Rth. That’s Thevenin’s theorem.',
    'Vth is what the terminals read with nothing connected. R₃ then carries no current, so it’s the R₁/R₂ divider: 12 V × 100 / 200 = 6 V.',
    'Rth: short the terminals and measure the current, IN = 40 mA. Then Rth = Vth / IN = 150 Ω. Same as turning the cell into a wire and reducing: R₁ ∥ R₂ + R₃ = 50 + 100 Ω.',
    'Switch views: the load’s voltage and current don’t change at all, for any RL. Slide RL to 10 Ω (nearly shorted) and IL → IN; to 10 kΩ (nearly open) and VL → Vth.',
    'Norton’s version: the same box as a current source IN in parallel with Rth, with Vth = IN × Rth. Pick whichever makes the maths easier.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'view',
      options: [
        { value: 'network', label: 'Network' },
        { value: 'thevenin', label: 'Thevenin' },
        { value: 'norton', label: 'Norton' },
      ],
      initial: 'network',
    },
    { kind: 'slider', key: 'load', label: 'Load RL', min: 10, max: 10e3, initial: 220, log: true, format: (v) => ohms(nearestE12(v)) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    wire(scene, [[-E_W, -E_H, 0], [-E_W, E_H, 0], [LOAD_X, E_H, 0], [LOAD_X, -E_H, 0], [-E_W, -E_H, 0]])
    boxOutline(scene, -E_W - 2.6, OUT_X, E_H + 1.6)
    const battery = add(scene, cell(CELL_H, 1.5), [-E_W, 0, 0])
    const source = add(scene, currentSource(1.7), [-E_W, 0, 0])
    const column = add(scene, new THREE.Group(), [A_X, 0, 0])
    wire(column, [[0, E_H, 0], [0, -E_H, 0]])
    const nodeA = junction(column, [0, E_H, 0], 0.6)
    junction(column, [0, -E_H, 0], 0.6).set(0)
    const part = (ohmsValue: number, at: V3, vertical: boolean) => {
      const g = add(scene, new THREE.Group(), at)
      swapResistor(g, ohmsValue, vertical ? [0, 1, 0] : [-1, 0, 0], vertical ? [0, -1, 0] : [1, 0, 0])
      return g
    }
    const rth = theveninDemo(VIN, NET, 1).rth
    const r1 = part(NET[0], [L_MID, E_H, 0], false)
    const r2 = part(NET[1], [A_X, 0, 0], true)
    const r3 = part(NET[2], [(A_X + OUT_X) / 2, E_H, 0], false)
    const rthTop = part(rth, [L_MID, E_H, 0], false)
    const rthColumn = part(rth, [A_X, 0, 0], true)
    const loadHolder = add(scene, new THREE.Group(), [LOAD_X, 0, 0])
    const outTop = junction(scene, [OUT_X, E_H, 0], 0.8)
    junction(scene, [OUT_X, -E_H, 0], 0.8).set(0)

    const f = { top: 1, a: 0.5, l: 0.5 }
    const paint = (at: THREE.Vector3) => {
      if (at.y <= -E_H + 0.01) return 0
      if (at.x <= -E_W + 0.01) return cellFraction(at.y) * f.top
      if (Math.abs(at.x - A_X) < 0.01 && at.y < E_H - 0.01) return dropAlong(at, [A_X, E_H, 0], [A_X, -E_H, 0], f.a, 0, RS)
      if (at.x < A_X) return dropAlong(at, [-E_W, E_H, 0], [A_X, E_H, 0], f.top, f.a, RS)
      if (at.x < OUT_X) return dropAlong(at, [A_X, E_H, 0], [OUT_X, E_H, 0], f.a, f.l, RS)
      if (at.x >= LOAD_X - 0.01) return dropAlong(at, [LOAD_X, E_H, 0], [LOAD_X, -E_H, 0], f.l, 0, RS)
      return f.l
    }
    const left = plusFlow(scene, [[A_X, -E_H, LANE], [-E_W, -E_H, LANE], [-E_W, E_H, LANE], [A_X, E_H, LANE]], paint)
    const down = plusFlow(scene, [[A_X, E_H, LANE], [A_X, -E_H, LANE]], paint)
    const right = plusFlow(scene, [[A_X, E_H, LANE], [LOAD_X, E_H, LANE], [LOAD_X, -E_H, LANE], [A_X, -E_H, LANE]], paint)

    const srcV = pulseLabel(scene, 3, HIGH_V, [L_MID, 0.4, 0], 1.5)
    const srcI = pulseLabel(scene, 3, CONVENTIONAL, [L_MID, 0.4, 0], 1.5)
    const rthLabel = pulseLabel(scene, 3, OHMS_LABEL, [L_MID, E_H + 2.4, 0], 1.3)
    const ilLabel = pulseLabel(scene, 3, CONVENTIONAL, [(OUT_X + LOAD_X) / 2, E_H - 3.4, 0], 1.3)
    const vlLabel = pulseLabel(scene, 3, RING, [(OUT_X + LOAD_X) / 2, -1.6, 0], 1.5)
    arrow(scene, [(OUT_X + LOAD_X) / 2, E_H - 1.5, 0], [1, 0, 0], CONVENTIONAL, 0.6)

    const w = [1, 0, 0]
    let shownLoad = NaN
    return {
      scene,
      view: { center: [-0.6, 1.6, 0], radius: 43, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const s = solveEquivalent(p)
        if (s.load !== shownLoad) {
          shownLoad = s.load
          swapResistor(loadHolder, s.load, [0, 1, 0], [0, -1, 0])
        }
        WEIGHTS[s.view].forEach((target, k) => (w[k] += (target - w[k]) * ease(dt)))
        const [wn, wt, wo] = w
        presence(battery, wn + wt)
        presence(source, wo)
        presence(column, wn + wo)
        presence(r1, wn)
        presence(r2, wn)
        presence(r3, wn)
        presence(rthTop, wt)
        presence(rthColumn, wo)

        f.top = (wn * VIN + wt * s.vth + wo * s.vl) / VIN
        f.a = (wn * s.va + (wt + wo) * s.vl) / VIN
        f.l = s.vl / VIN
        nodeA.set(f.a)
        outTop.set(f.l)
        left.step(dt * (wn * s.i1 + wt * s.il + wo * s.norton) * E_SPEED)
        down.step(dt * (wn * s.i2 + wo * (s.norton - s.il)) * E_SPEED)
        down.mesh.visible = wn + wo > 0.5
        right.step(dt * s.il * E_SPEED)

        srcV.display.group.visible = wn + wt > 0.5
        srcV.show(fitDigits(wn > 0.5 ? VIN : s.vth, 3))
        srcI.display.group.visible = wo > 0.5
        srcI.show(fitDigits(mA(s.norton), 3))
        rthLabel.display.group.visible = wt + wo > 0.5
        rthLabel.display.group.position.set(wo > 0.5 ? (A_X + OUT_X) / 2 : L_MID, wo > 0.5 ? 0 : E_H + 2.4, 0)
        rthLabel.show(fitDigits(s.rth, 3))
        ilLabel.show(fitDigits(mA(s.il), 3))
        vlLabel.show(fitDigits(s.vl, 3))
        for (const l of [srcV, srcI, rthLabel, ilLabel, vlLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveEquivalent(p)
        return [
          s.view === 'norton' ? { label: 'IN', value: amps(s.norton) } : { label: 'Vth', value: volts(s.vth) },
          { label: 'Rth', value: ohms(s.rth) },
          { label: 'VL', value: volts(s.vl), tone: 'ok' },
          { label: 'IL', value: amps(s.il), tone: 'ok' },
        ]
      },
    }
  },
}

// --- Maximum power transfer: the load gets the most when it matches the source's Rth. ---

const EQ = theveninAt(3, theveninNetwork(VIN, NET), T_NET.out)!
const P_W = 15
const P_H = 5
const RTH_X = -11.5
const TERM_X = -8
const RL_X = -5
const PLOT: V3 = [-0.8, -P_H, 0]
const PER_MA = 0.27
const PER_V = 1.6
const P_SPEED = 90

const solvePower = (p: Params) => {
  const load = e12(p, 'load')
  return { load, ...powerTransfer(EQ.vth, EQ.rth, load) }
}
const mW = (w: number) => w * 1000

export const maximumPowerTransfer: Lesson = {
  id: 'thevenin-norton-maximum-power-transfer',
  title: 'Maximum power transfer',
  tagline: 'Match the load to the source',
  formula: (p) => {
    const s = solvePower(p)
    return `P = Vth² × RL / (Rth + RL)² = ${watts(s.loadW)}, at most Vth² / 4Rth = ${watts(s.maxW)}`
  },
  legend: [
    { color: POWER, label: 'Load power VL × IL, mW', shape: 'dot' },
    { color: OHMS_LABEL, label: 'Source line, Rth and RL, Ω', shape: 'dot' },
    { color: RING, label: 'Load voltage VL', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Load current IL', shape: 'dot' },
  ],
  points: [
    'Reduce any source to Vth behind Rth; here the 6 V, 150 Ω box from the last lesson. Which load RL gets the most power out of it?',
    'A tiny RL draws lots of current but has almost no voltage across it; a huge RL gets nearly all of Vth but almost no current. P = VL × IL is near 0 at both ends.',
    'On the plot, the load always sits on the source’s line from Vth (open) down to IN (shorted). Its power is the green rectangle’s area, and the biggest rectangle under a straight line has its corner at the middle.',
    'That’s VL = Vth / 2 and IL = IN / 2, which happens when RL = Rth = 150 Ω: P = Vth² / 4Rth = 60 mW.',
    'The catch: Rth then burns just as much, so efficiency is 50 %. Matching suits weak signals (antennas, speakers, 50 Ω RF lines); batteries and power supplies want RL ≫ Rth instead.',
  ],
  controls: [{ kind: 'slider', key: 'load', label: 'Load RL', min: 10, max: 2200, initial: 47, log: true, format: (v) => ohms(nearestE12(v)) }],
  build(): Stage {
    const scene = createStage({ span: 22 })
    wire(scene, [[-P_W, -P_H, 0], [-P_W, P_H, 0], [RL_X, P_H, 0], [RL_X, -P_H, 0], [-P_W, -P_H, 0]])
    boxOutline(scene, -P_W - 2.4, TERM_X, P_H + 1.5)
    add(scene, cell(CELL_H, 1.5), [-P_W, 0, 0])
    resistorAlong(scene, EQ.rth, [RTH_X - 1, P_H, 0], [RTH_X + 1, P_H, 0], R_SCALE)
    const loadHolder = add(scene, new THREE.Group(), [RL_X, 0, 0])
    const outTop = junction(scene, [TERM_X, P_H, 0], 0.75)
    junction(scene, [TERM_X, -P_H, 0], 0.75).set(0)
    const lostWaves = heatWaves(scene, 2.4, { count: 3, rise: 3.6 })
    lostWaves.group.position.set(RTH_X, P_H + 1, 0)
    const loadWaves = heatWaves(scene, 1.6, { count: 3, rise: 3.6 })
    loadWaves.group.position.set(RL_X + 2.1, -1.2, 0)

    const top = EQ.vth / VIN
    let fl = 0.5
    const flow = plusFlow(scene, [[-P_W, -P_H, LANE], [-P_W, P_H, LANE], [RL_X, P_H, LANE], [RL_X, -P_H, LANE], [-P_W, -P_H, LANE]], (at) => {
      if (at.y <= -P_H + 0.01) return 0
      if (at.x <= -P_W + 0.01) return cellFraction(at.y) * top
      if (at.x >= RL_X - 0.01) return dropAlong(at, [RL_X, P_H, 0], [RL_X, -P_H, 0], fl, 0, RS)
      if (at.x < RTH_X + RS) return dropAlong(at, [RTH_X - 4, P_H, 0], [RTH_X + 4, P_H, 0], top, fl, RS)
      return fl
    })

    const maxMA = mA(EQ.norton)
    const plot = areaPlot(scene, { maxX: maxMA, maxY: EQ.vth, perX: PER_MA, perY: PER_V, stepX: 10, stepY: 1, color: POWER, xColor: CONVENTIONAL, yColor: RING })
    plot.group.position.set(...PLOT)
    rod(plot.group, [0, EQ.vth * PER_V, 0.5], [maxMA * PER_MA, 0, 0.5], 0.11, glowMat(OHMS_LABEL, 0.5))
    add(plot.group, mesh(new THREE.TorusGeometry(0.42, 0.09, 8, 24), glowMat(POWER, 0.9)), [(maxMA / 2) * PER_MA, (EQ.vth / 2) * PER_V, 0.5])
    const dot = add(plot.group, mesh(new THREE.SphereGeometry(0.42, 20, 14), glowMat('#ffffff', 1)))

    const rthLabel = pulseLabel(scene, 3, OHMS_LABEL, [RTH_X + 0.4, P_H - 2.4, 0], 1.3)
    const rlLabel = pulseLabel(scene, 4, OHMS_LABEL, [RL_X - 4.6, -1.6, 0], 1.3)
    const pLabel = pulseLabel(scene, 3, POWER, [PLOT[0] + maxMA * PER_MA * 0.72, PLOT[1] + EQ.vth * PER_V * 0.78, 0], 1.6)
    rthLabel.show(fitDigits(EQ.rth, 3))

    const shown = { load: NaN, ma: 0, v: 0 }
    return {
      scene,
      view: { center: [-3, 1.2, 0], radius: 50, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solvePower(p)
        if (s.load !== shown.load) {
          shown.load = s.load
          swapResistor(loadHolder, s.load, [0, 1, 0], [0, -1, 0])
        }
        shown.ma += (mA(s.amps) - shown.ma) * ease(dt, 6)
        shown.v += (s.volts - shown.v) * ease(dt, 6)
        plot.set(shown.ma, shown.v)
        dot.position.set(shown.ma * PER_MA, shown.v * PER_V, 0.6)
        fl = shown.v / VIN
        outTop.set(fl)
        flow.step(dt * s.amps * P_SPEED)
        lostWaves.step(dt, s.lostW / s.maxW)
        loadWaves.step(dt, s.loadW / s.maxW)
        rlLabel.show(String(s.load))
        pLabel.show(fitDigits(mW(s.loadW), 3))
        for (const l of [rthLabel, rlLabel, pLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solvePower(p)
        const near = s.loadW / s.maxW
        return [
          { label: 'RL', value: ohms(s.load) },
          { label: 'Load P', value: watts(s.loadW), tone: near > 0.97 ? 'ok' : near < 0.6 ? 'warn' : undefined },
          { label: 'Lost in Rth', value: watts(s.lostW) },
          { label: 'Efficiency', value: `${Math.round(s.efficiency * 100)} %` },
        ]
      },
    }
  },
}
