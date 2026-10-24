import * as THREE from 'three/webgpu'
import {
  TL072,
  cellMpp,
  cellOnLoad,
  cellPhotoA,
  cellVoc,
  depletion,
  litDiodeAmps,
  tia,
} from '../../core/physics'
import { nearestE12 } from '../../core/resistorColors'
import { amps, fitDigits, ohms, si, volts, watts } from '../../core/units'
import { V3, add, box } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  ELECTRON,
  GREY,
  HIGH_V,
  POWER,
  SUN_TINT,
  addLabel,
  areaStrips,
  diodeSymbol,
  dropAlong,
  ease,
  glowDot,
  groundAt,
  junction,
  junctionBacking,
  junctionDopants,
  lane,
  lightRay,
  liveLabel,
  opAmpSymbol,
  plusFlow,
  potentialColor,
  pulseLabel,
  resistorSlot,
  scope,
  siliconCrystal,
  terminal,
  ticks,
  wire,
  zoneEdges,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const LOAD_LINE = '#e8e8e8'
const lightText = (w: number) => `${Math.round(w)} W/m²`

// --- Photovoltaic effect: photons make pairs in the depletion zone, its field sweeps them apart, and a load takes the current. ---

const ROWS = 4
const COLS = 8
const PITCH = 2.6
const CX = -8.4
const CY = 1.2
const DOPING = 1e16
const Z1 = 11
const V_MAX = 0.7
const I_LO = -1
const I_HI = 0.5
const S1: V3 = [10.2, 1.2, 0]
const W1 = 8.5
const H1 = 9

const cell1 = (p: Params) => {
  const light = n(p, 'light')
  const load = nearestE12(n(p, 'load'))
  return { light, load, ...cellOnLoad(light, load), mpp: cellMpp(light), isc: cellPhotoA(light), voc: cellVoc(light) }
}

/** Crystal between two plates; the plates' leads drop to a load resistor under it. */
function cellRig(scene: THREE.Object3D, ohmsNow: number) {
  const rig = add(scene, new THREE.Group(), [CX, CY, 0])
  const width = COLS * PITCH
  const height = ROWS * PITCH
  const zone = junctionBacking(rig, width, height)
  const crystal = siliconCrystal(rig, { cols: COLS, rows: ROWS, pitch: PITCH, dopants: junctionDopants(COLS, 5, 5), wrap: false, ionizeAfter: 0.2 })
  const plateX = width / 2 + 0.7
  const plateH = height + 0.6
  const plates = [-1, 1].map((s) => {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.4 })
    box(rig, [0.7, plateH, 2.4], material, [s * plateX, 0, 0])
    return material
  })
  const botY = -plateH / 2 - 3.2
  const loop: V3[] = [[-plateX, -plateH / 2, 0], [-plateX, botY, 0], [plateX, botY, 0], [plateX, -plateH / 2, 0]]
  wire(rig, loop)
  const load = resistorSlot(rig, [-1.6, botY, 0], [1.6, botY, 0])
  load(ohmsNow)
  const live = { v: 0 }
  const flow = plusFlow(rig, lane(loop), (at) => (at.y > botY + 0.3 ? (at.x < 0 ? live.v : 0) : dropAlong(at, loop[1], loop[2], live.v, 0, 1.6)))
  const current = pulseLabel(rig, 4, SUN_TINT, [-plateX / 2 - 1.2, botY - 1.8, 0], 1)
  addLabel(rig, 'mA', [-plateX / 2 + 2.6, botY - 1.8, 0], GREY, 0.7)

  const sunAt: V3 = [-3, height / 2 + 5.2, 0.6]
  const sun = glowDot(rig, 1.1, SUN_TINT, 1.4)
  sun.position.set(...sunAt)
  const rays = Array.from({ length: 5 }, () => lightRay(rig, 10, 0.16, 0.7))
  const c = new THREE.Color()
  return {
    crystal,
    width,
    zone,
    load,
    flow,
    current,
    rays: (t: number, f: number, from: number, to: number) =>
      rays.forEach((ray, k) => {
        const x = from + ((k + 0.5) / rays.length) * (to - from) + (k - 2) * 0.9
        const y = height / 2 - 1 - (k % 3) * 2.6
        ray([sunAt, [x, y, 0.6]], t + k * 0.17, f, SUN_TINT)
      }),
    paint(vf: number, sunF: number) {
      live.v = vf
      plates[0].color.copy(potentialColor(vf, c))
      plates[0].emissive.copy(c).multiplyScalar(0.4)
      plates[1].color.copy(potentialColor(0, c))
      plates[1].emissive.copy(c).multiplyScalar(0.4)
      sun.scale.setScalar(0.3 + 0.7 * sunF)
      sun.visible = sunF > 0.01
    },
  }
}

export const photovoltaicEffect: Lesson = {
  id: 'photodiodes-solar-cells-photovoltaic-effect',
  title: 'Photovoltaic effect',
  tagline: 'Light in, current out',
  formula: (p) => {
    const s = cell1(p)
    return `I = Is·(e^(V/nVt) − 1) − Iph, Iph = ${amps(s.isc)} · Voc = nVt·ln(Iph/Is + 1) = ${volts(s.voc)} · P = V·I = ${volts(s.v)} × ${amps(s.i)} = ${watts(s.p)} (max ${watts(s.mpp.p)} at ${volts(s.mpp.v)})`
  },
  legend: [
    { color: SUN_TINT, label: 'Photon → electron–hole pair; lit I–V', shape: 'dot' },
    { color: ELECTRON, label: 'Field sweeps electrons to n, holes to p', shape: 'arrow-right' },
    { color: LOAD_LINE, label: 'Load line; dot = now; grey = dark diode', shape: 'dot' },
    { color: POWER, label: 'Power V·I (box); max-power point', shape: 'dot' },
  ],
  points: [
    'A photon with more energy than silicon’s 1.12 eV band gap (any wavelength under ~1100 nm) knocks an electron out of a bond: one electron–hole pair.',
    'Pairs made in or near the depletion zone are pulled apart by its built-in field before they can recombine: electrons to the n side, holes to the p side. That charge piles up as a voltage, p side +, and pushes a current through the load.',
    'On the I–V plot, light shifts the dark diode curve straight down by the photocurrent Iph. Shorted (V = 0) the cell gives Iph, here 34 mA per cm² of full sun; open, the voltage climbs until the diode’s forward current eats all of Iph: Voc ≈ 0.6 V.',
    'Between the two, V·I peaks at the max-power point, about 0.5 V. The load line V = I·R picks where the cell works; match R to it (≈ 0.6 Ω here) and you get the most out. MPPT chargers do this automatically.',
    'Current is ∝ light but voltage grows only with its log, so a dim cell still gives most of its volts. Real cells stack 36 or 72 in series for 18 V or 36 V. This 5 × 5 cm cell turns about 16 % of the light into power.',
  ],
  controls: [
    { kind: 'slider', key: 'light', label: 'Light', min: 0, max: 1000, initial: 1000, step: 10, format: lightText },
    { kind: 'slider', key: 'load', label: 'Load', min: 0.05, max: 50, initial: 0.68, log: true, format: (v: number) => ohms(nearestE12(v)) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const rig = cellRig(scene, 0.68)
    const plot = scope(scene, W1, H1, { divs: [7, 6], zeroAt: -I_LO / (I_HI - I_LO) })
    plot.group.position.set(...S1)
    const uOf = (v: number) => v / V_MAX
    const yOf = (i: number) => ((i - I_LO) / (I_HI - I_LO)) * H1 - H1 / 2
    ticks(plot, [[0, '0'], [0.5, '0.35'], [1, '0.7']], [[0, '-1'], [-I_LO / (I_HI - I_LO), '0'], [1, '0.5']])
    addLabel(plot.group, 'V', [W1 / 2 - 0.4, -H1 / 2 - 2.2, 0], GREY, 0.8)
    addLabel(plot.group, 'I, A', [W1 / 2 + 2.2, H1 / 2 + 1.4, 0], GREY, 0.8)
    const box1 = areaStrips(plot, 1, 0.35)
    const dark = plot.trace(GREY, { radius: 0.08 })
    dark.draw((u) => yOf(litDiodeAmps(u * V_MAX, 0)), null)
    const lit = plot.trace(SUN_TINT, { radius: 0.12 })
    const loadLine = plot.trace(LOAD_LINE, { radius: 0.06 })
    const dot = glowDot(plot.group, 0.42, LOAD_LINE, 1.4)
    const mpp = glowDot(plot.group, 0.32, POWER, 1.4)

    const state = { light: 1000, v: 0.5, load: 0.68, from: 0, to: 0, t: 0 }
    return {
      scene,
      view: { center: [-1.4, 2.6, 0], radius: 67, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        state.t += dt
        const load = nearestE12(n(p, 'load'))
        state.light += (n(p, 'light') - state.light) * ease(dt, 5)
        state.load = load
        rig.load(load)
        const at = cellOnLoad(state.light, load)
        state.v += (at.v - state.v) * ease(dt, 5)
        const iph = cellPhotoA(state.light)
        const fwd = iph - at.i
        const d = depletion(DOPING, DOPING, state.v)
        const target = zoneEdges(d, Z1, rig.width / 2, 0.6)
        state.from += (target.from - state.from) * ease(dt, 3)
        state.to += (target.to - state.to) * ease(dt, 3)
        const sunF = state.light / 1000
        const generate = 7 * sunF
        rig.crystal.step(dt, { junction: { from: state.from, to: state.to, generate, inject: iph > 0 ? (generate * fwd) / iph : 0, contacts: true } })
        rig.zone(state.from, state.to)
        rig.rays(state.t, sunF, state.from - 1, state.to + 1)
        rig.paint(state.v / V_MAX, sunF)
        rig.flow.step(dt * at.i * 4)
        rig.current.show(fitDigits(at.i * 1000, 4))
        rig.current.frame(dt)

        lit.draw((u) => yOf(litDiodeAmps(u * V_MAX, state.light)), null)
        loadLine.draw((u) => yOf((-u * V_MAX) / load), null)
        const i = state.v / load
        box1.set([{ u0: 0, u1: uOf(state.v), y0: yOf(-i), y1: yOf(-i), color: POWER }], yOf(0))
        dot.position.set(plot.xAt(uOf(state.v)), yOf(-i), 0.4)
        const m = cellMpp(state.light)
        mpp.visible = m.p > 0
        mpp.position.set(plot.xAt(uOf(m.v)), yOf(-m.i), 0.45)
      },
      readouts: (p) => {
        const s = cell1(p)
        const share = s.mpp.p > 0 ? s.p / s.mpp.p : 0
        return [
          { label: 'Cell voltage', value: volts(s.v) },
          { label: 'Current', value: amps(s.i) },
          { label: 'Power', value: watts(s.p), tone: share > 0.95 ? 'ok' : share > 0.7 ? 'warn' : 'bad' },
          { label: 'Of max power', value: `${Math.round(100 * share)} %` },
        ]
      },
    }
  },
}

// --- Light sensing: a reverse-biased photodiode into a transimpedance amp turns light into volts. ---

const MODES = { pv: 'Photovoltaic (0 V)', pc: 'Photoconductive (−5 V)' } as const
const RAILS = { vcc: 5, vee: -5 }
const BIAS = { pv: 0, pc: 5 }
const LUX_DECADES = 5
const V_DECADES = 4
const V_FLOOR = 1e-3
const AMP_X = -4
const NI_X = -11
const IN_Y = 1.1
const TOP_Y = 5
const OI_X = -0.2
const OUT_X = 2.6
const PD: V3 = [NI_X, -2.6, 0]
const BIAS_Y = -6.4
const S2: V3 = [12, 0.4, 0]
const W2 = 9
const H2 = 8

const sense2 = (p: Params) => {
  const mode = pick(MODES, p.mode, 'pc')
  const lux = n(p, 'lux')
  const rf = nearestE12(n(p, 'rf'))
  return { mode, lux, rf, vr: BIAS[mode], ...tia(lux, rf, BIAS[mode], TL072, RAILS) }
}

const hzText = (hz: number) => si(hz, 'Hz', 3)
const luxText = (lux: number) => (lux >= 1000 ? `${+(lux / 1000).toPrecision(3)} klx` : `${+lux.toPrecision(3)} lx`)

export const lightSensing: Lesson = {
  id: 'photodiodes-solar-cells-light-sensing',
  title: 'Light sensing',
  tagline: 'Photocurrent into volts',
  formula: (p) => {
    const s = sense2(p)
    const tail = s.clipped ? ' → clipped at 3.5 V' : ''
    return `Iph = E·A·R = ${luxText(s.lux)} ÷ 110 lm/W × 7.5 mm² × 0.6 A/W = ${amps(s.photoA)} · Vout = (Iph + Idark)·Rf = ${volts(s.ideal)}${tail} · f ≈ √(GBW / 2π·Rf·C), C = ${si(s.capF, 'F', 2)} → ${hzText(s.hz)}`
  },
  legend: (p) => [
    { color: SUN_TINT, label: 'Light on a BPW34 photodiode', shape: 'dot' },
    { color: CONVENTIONAL, label: `Photocurrent: out → Rf → diode → ${sense2(p).vr ? '−5 V' : '0 V'}`, shape: 'arrow-left' },
    { color: HIGH_V, label: 'Vout vs light, log–log; dot = now', shape: 'dot' },
    { color: GREY, label: 'Rail limit: TL072 on ±5 V tops out at 3.5 V', shape: 'dot' },
  ],
  points: [
    'Each photon absorbed in a photodiode gives one electron–hole pair, so its current is simply ∝ light: about 0.6 A per watt in silicon, 41 nA per lux on a 7.5 mm² BPW34. Six decades of light give six decades of current.',
    'An op-amp turns that current into a voltage: the diode feeds V−, which feedback holds at 0 V (virtual ground), so the whole photocurrent flows through Rf and Vout = Iph·Rf. A bigger Rf reads dimmer light but clips sooner.',
    'Photovoltaic mode: 0 V across the diode. Nothing leaks, so it is the quietest and reads down to the faintest light, but the wide junction capacitance (70 pF) makes it slow.',
    'Photoconductive mode: reverse-bias the diode (−5 V here). The depletion zone widens, capacitance falls to a third and the response gets faster, at the price of a dark current (~1 nA) that adds to every reading. It only matters in near-darkness, below ~0.03 lux, or when hot: it doubles every ~10 °C.',
    'Speed also falls with Rf: f ≈ √(GBW / 2π·Rf·C). Real designs add a small Cf across Rf to keep it from ringing. Light meters, IR remote receivers, line sensors and lidar all start like this.',
  ],
  controls: [
    { kind: 'slider', key: 'lux', label: 'Light', min: 1, max: 100e3, initial: 300, log: true, format: luxText },
    { kind: 'slider', key: 'rf', label: 'Rf', min: 10e3, max: 10e6, initial: 100e3, log: true, format: (v: number) => ohms(nearestE12(v)) },
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'pc' },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const amp = opAmpSymbol(scene, [AMP_X, 0, 0])
    const { p: pPin, n: nPin, out } = amp.pins
    wire(scene, [[NI_X, PD[1] + 1.6, 0], [NI_X, IN_Y, 0], nPin], 0.18)
    const diode = add(scene, diodeSymbol(2.2), PD)
    diode.rotation.z = Math.PI / 2
    wire(scene, [[NI_X, PD[1] - 1.6, 0], [NI_X, BIAS_Y, 0]], 0.18)
    const bias = terminal(scene, [NI_X, BIAS_Y, 0], 0.45)
    const biasLabel = liveLabel(scene, [NI_X + 2.6, BIAS_Y, 0], { size: 0.8, color: GREY })
    wire(scene, [[NI_X, IN_Y, 0], [NI_X, TOP_Y, 0], [OI_X, TOP_Y, 0], [OI_X, 0, 0]], 0.18)
    const rf = resistorSlot(scene, [-8.6, TOP_Y, 0], [-3, TOP_Y, 0])
    addLabel(scene, 'Rf', [-5.8, TOP_Y + 1.5, 0], GREY, 0.8)
    wire(scene, [out, [OUT_X, 0, 0]], 0.18)
    wire(scene, [pPin, [pPin[0] - 0.6, pPin[1], 0], [pPin[0] - 0.6, -3, 0]], 0.18)
    groundAt(scene, [pPin[0] - 0.6, -3, 0])
    const vn = junction(scene, [NI_X, IN_Y, 0], 0.35)
    const term = terminal(scene, [OUT_X, 0, 0], 0.45)
    const outLabel = pulseLabel(scene, 4, HIGH_V, [OUT_X + 0.2, -2.6, 0], 1.2)
    addLabel(scene, 'Vout', [OUT_X + 0.2, 2.2, 0], GREY, 0.8)

    const lampAt: V3 = [-18, 5.5, 0.6]
    const lamp = glowDot(scene, 1, SUN_TINT, 1.4)
    lamp.position.set(...lampAt)
    const rays = Array.from({ length: 3 }, () => lightRay(scene, 10, 0.15, 0.7))

    const live = { vout: 0 }
    const f5 = (v: number) => 0.5 + v / 10
    const loopPts: V3[] = [[NI_X, BIAS_Y + 0.6, 0], [NI_X, IN_Y, 0], [NI_X, TOP_Y, 0], [OI_X, TOP_Y, 0], [OI_X, 0, 0], out]
    const flow = plusFlow(scene, lane(loopPts).reverse(), (at) => {
      if (at.y > TOP_Y - 0.2) return dropAlong(at, [NI_X, TOP_Y, 0], [OI_X, TOP_Y, 0], f5(0), f5(live.vout), 2.8)
      return at.x < NI_X + 0.2 ? f5(0) : f5(live.vout)
    })

    const plot = scope(scene, W2, H2, { divs: [LUX_DECADES, V_DECADES], zeroAt: 0 })
    plot.group.position.set(...S2)
    const uOf = (lux: number) => Math.log10(lux) / LUX_DECADES
    const yOf = (v: number) => (Math.log10(Math.max(V_FLOOR, v) / V_FLOOR) / V_DECADES) * H2 - H2 / 2
    for (const [u, t] of [[0, '1'], [0.4, '100'], [0.8, '10k']] as const) addLabel(plot.group, t, [plot.xAt(u), -H2 / 2 - 1.2, 0], GREY, 0.7)
    for (const [v, t] of [[0, '1 mV'], [0.5, '0.1 V'], [1, '10 V']] as const) addLabel(plot.group, t, [W2 / 2 + 0.8, v * H2 - H2 / 2, 0], GREY, 0.7, 'left')
    addLabel(plot.group, 'lux', [W2 / 2 - 0.6, -H2 / 2 - 2.4, 0], GREY, 0.8)
    addLabel(plot.group, 'Vout', [-W2 / 2 + 1, H2 / 2 + 1.3, 0], GREY, 0.8)
    plot.level(GREY).set(yOf(3.5))
    const curve = plot.trace(HIGH_V, { radius: 0.12 })
    const dot = glowDot(plot.group, 0.4, '#ffffff', 1.4)

    const state = { lux: 300, t: 0, key: '' }
    return {
      scene,
      view: { center: [1.2, 1.6, 0], radius: 68, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        state.t += dt
        const s = sense2(p)
        state.lux = Math.exp(Math.log(state.lux) + (Math.log(s.lux) - Math.log(state.lux)) * ease(dt, 5))
        const now = tia(state.lux, s.rf, s.vr, TL072, RAILS)
        rf(s.rf)
        const key = `${s.rf}|${s.mode}`
        if (key !== state.key) {
          state.key = key
          curve.draw((u) => yOf(tia(10 ** (u * LUX_DECADES), s.rf, s.vr, TL072, RAILS).vout), null)
          biasLabel.set(s.vr ? '−5 V' : '0 V')
          bias.set(f5(-s.vr))
        }
        live.vout = now.vout
        const lightF = Math.log10(state.lux) / LUX_DECADES
        lamp.scale.setScalar(0.3 + 0.7 * lightF)
        rays.forEach((ray, k) => ray([[lampAt[0] + (k - 1) * 0.7, lampAt[1] - (k - 1) * 0.7, 0.6], [PD[0] - 0.9 + k * 0.4, PD[1] + 0.2 - k * 0.5, 0.6]], state.t + k * 0.23, 0.15 + lightF, SUN_TINT))
        flow.step(dt * Math.min(3, 0.4 + Math.log10(1 + (now.photoA + now.darkA) / 1e-8)))
        amp.set(f5(now.vout), now.clipped ? 1 : 0)
        amp.inputs(f5(0), f5(0))
        vn.set(f5(0))
        term.set(f5(now.vout))
        outLabel.show(fitDigits(now.vout, 4))
        outLabel.frame(dt)
        dot.position.set(plot.xAt(uOf(state.lux)), yOf(now.vout), 0.4)
      },
      readouts: (p) => {
        const s = sense2(p)
        return [
          { label: 'Photocurrent', value: amps(s.photoA) },
          { label: 'Vout', value: volts(s.vout), tone: s.clipped ? 'bad' : s.vout < 0.01 ? 'warn' : 'ok' },
          { label: 'Dark current', value: s.darkA > 0 ? amps(s.darkA) : 'none', tone: s.darkA > s.photoA / 10 ? 'warn' : undefined },
          { label: 'Bandwidth', value: hzText(s.hz) },
        ]
      },
    }
  },
}
