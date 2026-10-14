import * as THREE from 'three/webgpu'
import {
  MODERN_NMOS,
  MODERN_PMOS,
  Mosfet,
  channelCarriers,
  channelOverdrive,
  cmosInverter,
  dynamicPower,
  inverterDelay,
  inverterStep,
  mosfetDrain,
  switchingEnergy,
  switchingPoint,
} from '../../core/physics'
import { fitDigits, si, volts } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CELL_H,
  CONVENTIONAL,
  ELECTRON,
  Flow,
  GREY,
  HOLE,
  LANE,
  POWER,
  RING,
  cell,
  chargeTank,
  clamp01,
  ease,
  groundSymbol,
  ivScreen,
  junction,
  mosfetDie,
  path,
  pulseLabel,
  scope,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

type Die = ReturnType<typeof mosfetDie>

const FULL = 1.2
const NMOS = MODERN_NMOS
const PMOS = MODERN_PMOS
const TOX = 1.2e-9
const voltSlider = (key: string, label: string, initial: number, min = 0) =>
  ({ kind: 'slider', key, label, min, max: FULL, initial, step: 0.01, format: volts }) as const
const microamps = (a: number) => fitDigits(Math.max(0, a) * 1e6, 4)
const REGION = { cutoff: 'Cut-off', triode: 'Triode', saturation: 'Saturation' } as const

/** Feeds one die its gate charge, depletion, channel profile and carrier speed (√ of the current, `iRef` = full speed). */
function drive(die: Die, dt: number, vgs: number, vds: number, m: Mosfet, iRef: number, heat = 0) {
  const amps = mosfetDrain(vgs, vds, m).amps
  die.step(dt, {
    gate: vgs / FULL,
    deplete: 0.8 * Math.sqrt(clamp01(vgs / m.vthV)),
    channel: (u) => channelOverdrive(u, vgs, vds, m) / (FULL - m.vthV),
    flow: 7 * Math.sqrt(clamp01(amps / iRef)),
    heat,
  })
}

// --- Channel formation: the gate's field pulls electrons up into a thin channel; Vds tilts it until it pinches off. ---

const I1_FULL = 500e-6
const DIE1: V3 = [-5.6, -1.2, 0]
const S1: V3 = [12.4, -0.6, 0]

const fet1 = (p: Params) => {
  const vgs = n(p, 'vgs')
  const vds = n(p, 'vds')
  return { vgs, vds, vov: vgs - NMOS.vthV, ...mosfetDrain(vgs, vds, NMOS) }
}

export const channelFormation: Lesson = {
  id: 'mosfet-physics-channel-formation',
  title: 'Channel formation',
  tagline: 'A gate voltage makes a wire appear',
  formula: (p) => {
    const f = fet1(p)
    const k = `${si(NMOS.k, 'A/V²', 3)}`
    if (f.region === 'cutoff') return `Vgs = ${volts(f.vgs)} < Vth = ${volts(NMOS.vthV)}: no channel, only a leak I = ${si(f.amps, 'A', 3)}`
    if (f.region === 'triode')
      return `Triode: I = k·(Vov·Vds − Vds²/2)(1 + λVds) = ${k} × (${f.vov.toFixed(2)} × ${f.vds.toFixed(2)} − ${f.vds.toFixed(2)}²/2) × ${(1 + NMOS.lambda! * f.vds).toFixed(3)} = ${si(f.amps, 'A', 3)}`
    return `Saturation: I = ½k·Vov²·(1 + λVds) = ½ × ${k} × ${f.vov.toFixed(2)}² × ${(1 + NMOS.lambda! * f.vds).toFixed(3)} = ${si(f.amps, 'A', 3)}`
  },
  legend: [
    { color: ELECTRON, label: 'Electrons: n+ wells and the channel', shape: 'arrow-right' },
    { color: HOLE, label: 'Holes in the p substrate', shape: 'dot' },
    { color: '#ffffff', label: 'Depleted: bare − acceptor ions', shape: 'dot' },
    { color: RING, label: 'I–Vds at this Vgs; grey = pinch-off', shape: 'dot' },
  ],
  points: [
    'An n-channel MOSFET is p-type silicon with two heavily n-doped wells, source (S) and drain (d), and a metal gate (G) on top, insulated by an oxide only ~1 nm thick. No current can flow through the gate.',
    'With the gate at 0 V, source and drain are two back-to-back PN junctions: whichever way you push, one blocks. Off.',
    'Raise the gate and its + charge pushes the holes away from the surface, leaving bare − ions (depletion). Past the threshold Vth it also pulls electrons up from the wells into a thin layer: an n-type channel, a wire made by a field.',
    'Its charge is Cox·(Vgs − Vth) per area, so more gate voltage means a thicker channel and less resistance. Small Vds: it acts like a resistor (triode).',
    'Raise Vds and the channel thins toward the drain, where the gate-to-channel voltage is lower. At Vds = Vgs − Vth it pinches off: the current stops rising and sits at ½k(Vgs − Vth)² (saturation). Electrons race through the pinch.',
  ],
  controls: [voltSlider('vgs', 'Gate Vgs', 0.8), voltSlider('vds', 'Drain Vds', 0.6)],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const die = mosfetDie(scene, DIE1, { width: 18, depth: 6.4 })
    const { source, drain, gate } = die.pins
    const top = DIE1[1] + 7.6
    wire(scene, [source, [source[0], top, 0], [-CELL_H / 2 + 1.6, top, 0]])
    wire(scene, [[CELL_H / 2 + 2.4, top, 0], [drain[0], top, 0], drain])
    const battery = add(scene, cell(CELL_H, 1.2), [2, top, 0])
    battery.rotation.z = -Math.PI / 2
    const gateTop: V3 = [gate[0], gate[1] + 2.2, 0]
    wire(scene, [gate, gateTop])
    const gateBall = junction(scene, gateTop, 0.6)
    const sourceBall = junction(scene, [source[0], top, 0], 0.6)
    sourceBall.set(0)
    add(scene, groundSymbol(), [source[0] - 1.6, top - 1.4, 0])
    wire(scene, [[source[0], top - 1.4, 0], [source[0] - 1.6, top - 1.4, 0]], 0.2)
    const vgsLabel = pulseLabel(scene, 4, RING, [gate[0] - 2.8, gateTop[1], 0], 0.9)
    const vdsLabel = pulseLabel(scene, 4, RING, [2, top + 1.9, 0], 0.9)
    const ampsLabel = pulseLabel(scene, 4, CONVENTIONAL, [drain[0] + 2.6, top - 2.2, 0], 0.9)
    const lane = new Flow(path([[drain[0], drain[1], LANE], [drain[0], top, LANE], [source[0], top, LANE], [source[0], source[1], LANE]]), 1.5, ELECTRON, 0.26)
    scene.add(lane.mesh)

    const { plot, dot, y } = ivScreen(scene, S1, 8, 8, [4, 4])
    ticks(plot, [[0, '0'], [0.5, '0.6'], [1, '1.2']], [[0.5, '250'], [1, '500']])
    const curve = plot.trace(RING, { radius: 0.12 })
    plot.trace(GREY, { radius: 0.07 }).draw((u) => y(mosfetDrain(NMOS.vthV + u * FULL, u * FULL, NMOS).amps / I1_FULL), null)

    const state = { vgs: 0.8, vds: 0.6 }
    return {
      scene,
      view: { center: [1.6, 0.6, 0], radius: 60, polar: 1.42, azimuth: 0.12 },
      frame(dt, p) {
        state.vgs += (n(p, 'vgs') - state.vgs) * ease(dt, 4)
        state.vds += (n(p, 'vds') - state.vds) * ease(dt, 4)
        const amps = mosfetDrain(state.vgs, state.vds, NMOS).amps
        drive(die, dt, state.vgs, state.vds, NMOS, I1_FULL)
        die.paintGate(state.vgs / FULL)
        gateBall.set(state.vgs / FULL)
        vgsLabel.show(state.vgs.toFixed(2))
        vgsLabel.frame(dt)
        vdsLabel.show(state.vds.toFixed(2))
        vdsLabel.frame(dt)
        ampsLabel.show(microamps(amps))
        ampsLabel.frame(dt)
        lane.step(dt * 5 * Math.sqrt(clamp01(amps / I1_FULL)))
        curve.draw((u) => y(mosfetDrain(state.vgs, u * FULL, NMOS).amps / I1_FULL), null)
        dot.position.set(plot.xAt(state.vds / FULL), y(Math.min(1, amps / I1_FULL)), 0.4)
      },
      readouts: (p) => {
        const f = fet1(p)
        return [
          { label: 'Region', value: REGION[f.region], tone: f.region === 'cutoff' ? undefined : 'ok' },
          { label: 'Current', value: si(f.amps, 'A', 3) },
          { label: 'Vgs − Vth', value: volts(f.vov) },
          { label: 'e⁻ per µm²', value: `${Math.round(channelCarriers(f.vov, TOX) / 1000)} k` },
        ]
      },
    }
  },
}

// --- CMOS inverter: an NMOS to ground and a PMOS to Vdd share one gate; exactly one of them is on. ---

const W2 = 12
const D2 = 5.4
const GATE_Y = 4.2
const OUT_Y = 6.6

/** NMOS (left) and PMOS (right, flipped) side by side: gates tied to the input on the left, drains tied to the output,
 *  sources to ground and Vdd. The output lead ends at `out`. */
function inverterRig(scene: THREE.Object3D, at: V3) {
  const nDie = mosfetDie(scene, [at[0] - W2 / 2 - 0.6, at[1], 0], { kind: 'n', width: W2, depth: D2 })
  const pDie = mosfetDie(scene, [at[0] + W2 / 2 + 0.6, at[1], 0], { kind: 'p', width: W2, depth: D2, flip: true })
  const gy = at[1] + GATE_Y
  const oy = at[1] + OUT_Y
  const ny = nDie.pins.drain[1] + 2
  const inX = nDie.pins.source[0] + 1.2
  wire(scene, [nDie.pins.gate, [nDie.pins.gate[0], gy, -0.5]])
  wire(scene, [pDie.pins.gate, [pDie.pins.gate[0], gy, -0.5]])
  wire(scene, [[inX, gy, -0.5], [pDie.pins.gate[0], gy, -0.5]])
  wire(scene, [nDie.pins.drain, [nDie.pins.drain[0], ny, 0], [pDie.pins.drain[0], ny, 0], pDie.pins.drain])
  const out: V3 = [pDie.pins.gate[0] + 1.6, oy, 0.5]
  wire(scene, [[at[0], ny, 0.5], [at[0], oy, 0.5], out])
  const rails = [nDie.pins.source, pDie.pins.source].map((pin) => {
    const ball: V3 = [pin[0], pin[1] + 2, 0]
    wire(scene, [pin, ball])
    return junction(scene, ball, 0.6)
  })
  const inBall = junction(scene, [inX, gy, -0.5], 0.6)
  const node = junction(scene, [at[0], ny, 0.5], 0.45)
  const inLabel = pulseLabel(scene, 4, RING, [inX, gy + 1.5, 0], 0.9)
  const vddLabel = pulseLabel(scene, 4, RING, [pDie.pins.source[0], pDie.pins.source[1] + 3.5, 0], 0.9)
  rails[0].set(0)
  return {
    nDie,
    pDie,
    out,
    /** Paints the nodes and runs both dies; `iRef` sets the carrier speed scale, `heat` = [nmos, pmos]. */
    frame(dt: number, vin: number, vout: number, vdd: number, iRef: number, heat: [number, number] = [0, 0]) {
      drive(nDie, dt, vin, vout, NMOS, iRef, heat[0])
      drive(pDie, dt, vdd - vin, vdd - vout, PMOS, iRef, heat[1])
      nDie.paintGate(vin / FULL)
      pDie.paintGate(vin / FULL)
      inBall.set(vin / FULL)
      node.set(vout / FULL)
      rails[1].set(vdd / FULL)
      inLabel.show(vin.toFixed(2))
      inLabel.frame(dt)
      vddLabel.show(vdd.toFixed(2))
      vddLabel.frame(dt)
    },
  }
}

const RIG: V3 = [-5.6, -1.6, 0]
const S2: V3 = [13.4, -0.6, 0]
const I2_FULL = 40e-6

const inverter2 = (p: Params) => {
  const vdd = n(p, 'vdd')
  const vin = Math.min(n(p, 'vin'), vdd)
  return { vdd, vin, ...cmosInverter(vin, vdd, NMOS, PMOS) }
}

export const cmosInverterLesson: Lesson = {
  id: 'mosfet-physics-cmos-inverter',
  title: 'CMOS inverter',
  tagline: 'Two switches, one always off',
  formula: (p) => {
    const f = inverter2(p)
    return `In(Vin, Vout) = Ip(Vdd − Vin, Vdd − Vout) → Vout = ${volts(f.vout)} · flips at Vm = (Vtn + Vdd − Vtp) / 2 = ${volts(switchingPoint(f.vdd, NMOS, PMOS))}`
  },
  legend: [
    { color: ELECTRON, label: 'NMOS (left): electron channel to ground', shape: 'arrow-right' },
    { color: HOLE, label: 'PMOS (right, n-well): hole channel to Vdd', shape: 'arrow-left' },
    { color: RING, label: 'Vout against Vin; dot = now', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Current Vdd → ground', shape: 'dot' },
  ],
  points: [
    'Flip the doping and you get a PMOS: n-type body, p+ wells, and a channel of holes that forms when the gate is pulled below its source. Its source sits at Vdd.',
    'Tie both gates to the input and both drains to the output. Input low: the PMOS is on and connects the output to Vdd, the NMOS is off. Input high: the reverse. Out = NOT in.',
    'In either state one transistor is off, so almost no current flows from Vdd to ground: only nanoamp leaks. That is why CMOS took over every chip.',
    'Only near the middle, around Vdd/2, are both partly on, and a little current flows straight through while the output swings. The steep middle is the gain that keeps logic levels clean.',
    'Holes are ~2.8× slower than electrons, so the PMOS is built ~2.8× wider to make the two match and flip at Vdd/2.',
  ],
  controls: [voltSlider('vin', 'Input Vin', 0.3), voltSlider('vdd', 'Supply Vdd', 1, 0.5)],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const rig = inverterRig(scene, RIG)
    const outBall = junction(scene, rig.out, 0.6)
    const outLabel = pulseLabel(scene, 4, RING, [rig.out[0] + 2.8, rig.out[1], 0], 0.9)
    const { plot, dot, y } = ivScreen(scene, S2, 7.5, 7.5, [4, 4])
    ticks(plot, [[0, '0'], [0.5, '0.6'], [1, '1.2']], [[0.5, '0.6'], [1, '1.2']])
    const vtc = plot.trace(RING, { radius: 0.12 })
    const through = plot.trace(CONVENTIONAL, { radius: 0.08 })

    const state = { vin: 0.3, vdd: 1, drawn: -1 }
    return {
      scene,
      view: { center: [0.4, 0.2, 0], radius: 68, polar: 1.42, azimuth: 0.12 },
      frame(dt, p) {
        const target = inverter2(p)
        state.vin += (target.vin - state.vin) * ease(dt, 4)
        state.vdd += (target.vdd - state.vdd) * ease(dt, 4)
        const f = cmosInverter(state.vin, state.vdd, NMOS, PMOS)
        rig.frame(dt, state.vin, f.vout, state.vdd, I2_FULL)
        outBall.set(f.vout / FULL)
        outLabel.show(f.vout.toFixed(2))
        outLabel.frame(dt)
        if (Math.abs(state.vdd - state.drawn) > 1e-3) {
          state.drawn = state.vdd
          const at = (u: number) => cmosInverter(Math.min(u * FULL, state.vdd), state.vdd, NMOS, PMOS)
          vtc.draw((u) => y(at(u).vout / FULL), null)
          through.draw((u) => y(at(u).amps / I2_FULL), null)
        }
        dot.position.set(plot.xAt(state.vin / FULL), y(f.vout / FULL), 0.4)
      },
      readouts: (p) => {
        const f = inverter2(p)
        const nOn = f.vin > NMOS.vthV
        const pOn = f.vdd - f.vin > PMOS.vthV
        const on = nOn && pOn ? 'Both' : nOn ? 'NMOS' : pOn ? 'PMOS' : 'Neither'
        return [
          { label: 'Output', value: volts(f.vout), tone: 'ok' },
          { label: 'On', value: on, tone: on === 'Both' ? 'warn' : undefined },
          { label: 'Through', value: si(f.amps, 'A', 3) },
          { label: 'Flips at', value: volts(switchingPoint(f.vdd, NMOS, PMOS)) },
        ]
      },
    }
  },
}

// --- Switching energy: every 0 → 1 → 0 of a load costs C·V², half burnt charging it and half discharging it. ---

const SLOW = 5e10
const HALF_S = 50e-12
const CLOCK_HZ = 2e9
const GATES = 1e9
const ACTIVITY = 0.02
const WINDOW = 4 * HALF_S
const BINS = 160
const TANK_X = 9.2
const I3_REF = 200e-6
const P3_REF = 60e-6
const S3: V3 = [16, -0.4, 0]
const SCOPE3 = 6.5
const femto = (j: number) => fitDigits(j * 1e15, 4)

const load3 = (p: Params) => ({ vdd: n(p, 'vdd'), farads: n(p, 'c') * 1e-15 })

export const switchingEnergyLesson: Lesson = {
  id: 'mosfet-physics-switching-energy',
  title: 'Switching energy',
  tagline: 'Why chips get hot, and why Vdd keeps dropping',
  formula: (p) => {
    const { vdd, farads } = load3(p)
    return `E = C·V² = ${si(farads, 'F', 3)} × ${volts(vdd)}² = ${si(switchingEnergy(farads, vdd), 'J', 3)} per cycle · P = α·C·V²·f = ${si(dynamicPower(farads, vdd, CLOCK_HZ), 'W', 3)} per gate at ${si(CLOCK_HZ, 'Hz', 2)}, α = 1`
  },
  legend: [
    { color: POWER, label: 'Load: next gates + wire; stored ½CV², fJ', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Heat in each transistor this switch, fJ', shape: 'dot' },
    { color: RING, label: 'Vout; grey = Vin; ps since it flipped', shape: 'dot' },
    { color: ELECTRON, label: 'Electrons in and out of the load', shape: 'arrow-left' },
  ],
  points: [
    'Every gate output drives a little capacitance: the gates of the next transistors plus the wire, around a femtofarad or two.',
    'Input low: the PMOS charges the load from Vdd. The supply gives C·V²; half is stored in the load (½CV²) and half is burnt in the PMOS, whatever its resistance.',
    'Input high: the NMOS dumps the stored ½CV² to ground as heat. So each full cycle costs C·V², and a chip pays it billions of times a second: P = α·C·V²·f, with α the share of gates that switch each clock.',
    'Halving Vdd quarters the energy, which is why supplies fell from 5 V to under 1 V. But less overdrive means less current, so each switch takes longer: watch the slower ramps at low Vdd.',
    'Time is slowed 5 × 10¹⁰×: the input flips every 50 ps, shown as 2.5 s. Power is for a 2 GHz clock; leaks add a static power on top.',
  ],
  controls: [
    voltSlider('vdd', 'Supply Vdd', 1, 0.5),
    { kind: 'slider', key: 'c', label: 'Load', min: 0.5, max: 5, initial: 2, step: 0.1, format: (v: number) => `${v.toFixed(1)} fF` },
  ],
  build(): Stage {
    const scene = createStage({ span: 26 })
    const rig = inverterRig(scene, RIG)
    const tankTop = rig.out[1] - 1.4
    const tankH = 6
    wire(scene, [rig.out, [TANK_X, rig.out[1], 0.5], [TANK_X, tankTop, 0.5]])
    const tank = chargeTank(tankH, 1.3, { square: true })
    add(scene, tank.group, [TANK_X, tankTop - tankH / 2 - 0.6, 0])
    const groundY = tankTop - tankH - 1.6
    wire(scene, [[TANK_X, tankTop - tankH - 0.9, 0], [TANK_X, groundY, 0]])
    add(scene, groundSymbol(), [TANK_X, groundY, 0])
    const storedLabel = pulseLabel(scene, 4, POWER, [TANK_X + 3.6, tankTop - tankH / 2, 0], 0.9)
    const heatLabels = [rig.nDie, rig.pDie].map((d) => pulseLabel(scene, 4, CONVENTIONAL, [d.pins.gate[0], RIG[1] - D2 - 1.1, 0], 0.9))
    const lane = new Flow(path([[TANK_X, tankTop, LANE], [TANK_X, rig.out[1], LANE], [RIG[0], rig.out[1], LANE]]), 1.4, ELECTRON, 0.24)
    scene.add(lane.mesh)

    const plot = scope(scene, SCOPE3, SCOPE3, { divs: [4, 4], zeroAt: 0 })
    plot.group.position.set(...S3)
    ticks(plot, [], [[0.5, '0.6'], [1, '1.2']])
    const vinTrace = plot.trace(GREY, { radius: 0.08 })
    const voutTrace = plot.trace(RING, { radius: 0.12 })
    const clock = pulseLabel(scene, 4, GREY, [S3[0] + 1.6, S3[1] + SCOPE3 / 2 + 1.4, 0], 0.8)
    const yOf = (v: number) => (v / FULL - 0.5) * SCOPE3
    const vinAt = (t: number, vdd: number) => (Math.floor(t / HALF_S) % 2 ? 0 : vdd)

    const bins = new Float32Array(BINS)
    const sim = { t: 0, key: '', vout: 0, supplyJ: 0, pmosJ: 0, nmosJ: 0, edge: { pmosJ: 0, nmosJ: 0 }, vdd: 1, farads: 1e-14 }
    return {
      scene,
      view: { center: [1.6, 0.2, 0], radius: 72, polar: 1.42, azimuth: 0.12 },
      frame(dt, p) {
        const { vdd, farads } = load3(p)
        const key = `${vdd}|${farads}`
        if (key !== sim.key) {
          Object.assign(sim, { key, t: 0, vout: vdd, supplyJ: 0, pmosJ: 0, nmosJ: 0, edge: { pmosJ: 0, nmosJ: 0 }, vdd, farads })
          bins.fill(vdd)
        }
        const step = dt / SLOW
        const before = Math.floor(sim.t / HALF_S)
        const vin = vinAt(sim.t, vdd)
        const prev = sim.vout
        Object.assign(sim, inverterStep(sim, { vin, vdd, farads, nmos: NMOS, pmos: PMOS }, step))
        sim.t += step
        if (Math.floor(sim.t / HALF_S) !== before) sim.edge = { pmosJ: sim.pmosJ, nmosJ: sim.nmosJ }
        const pWatts = mosfetDrain(vdd - vin, vdd - sim.vout, PMOS).amps * (vdd - sim.vout)
        const nWatts = mosfetDrain(vin, sim.vout, NMOS).amps * sim.vout
        const heat = (w: number) => 0.7 * Math.sqrt(clamp01(w / P3_REF))
        rig.frame(dt, vin, sim.vout, vdd, I3_REF, [heat(nWatts), heat(pWatts)])
        tank.set(sim.vout / FULL)
        storedLabel.show(femto(0.5 * farads * sim.vout ** 2))
        storedLabel.frame(dt)
        heatLabels[0].show(femto(sim.nmosJ - sim.edge.nmosJ))
        heatLabels[1].show(femto(sim.pmosJ - sim.edge.pmosJ))
        for (const l of heatLabels) l.frame(dt)
        const amps = ((sim.vout - prev) * farads) / step
        lane.step(dt * 6 * Math.sign(amps) * Math.sqrt(clamp01(Math.abs(amps) / I3_REF)))
        bins[Math.floor(sim.t / (WINDOW / BINS)) % BINS] = sim.vout
        const binAt = (t: number) => bins[((Math.floor(t / (WINDOW / BINS)) % BINS) + BINS) % BINS]
        voutTrace.scroll((t) => yOf(binAt(t)), sim.t, WINDOW * 0.98)
        vinTrace.scroll((t) => yOf(vinAt(Math.max(0, t), vdd)), sim.t, WINDOW * 0.98)
        clock.show(fitDigits(((sim.t / HALF_S) % 1) * HALF_S * 1e12, 3))
        clock.frame(dt)
      },
      readouts: (p) => {
        const { vdd, farads } = load3(p)
        const delay = inverterDelay(vdd, farads, NMOS, PMOS)
        const chip = dynamicPower(farads, vdd, CLOCK_HZ, ACTIVITY) * GATES
        return [
          { label: 'Per cycle', value: si(switchingEnergy(farads, vdd), 'J', 3) },
          { label: 'Delay', value: si(delay, 's', 3), tone: delay > HALF_S / 2 ? 'warn' : 'ok' },
          { label: 'Per gate', value: si(dynamicPower(farads, vdd, CLOCK_HZ), 'W', 3) },
          { label: '10⁹ gates, α 2 %', value: si(chip, 'W', 3) },
        ]
      },
    }
  },
}
