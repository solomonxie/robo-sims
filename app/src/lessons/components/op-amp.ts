import * as THREE from 'three/webgpu'
import {
  MCP6002,
  Rails,
  TL072,
  comparatorRun,
  comparatorStep,
  comparatorThresholds,
  inverting,
  loadedVolts,
  nonInverting,
  nonInvertingGain,
  openLoopOut,
  swingHigh,
  swingLow,
} from '../../core/physics'
import { nearestE12 } from '../../core/resistorColors'
import { amps, fitDigits, ohms, volts } from '../../core/units'
import { V3, add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  GREY,
  HIGH_V,
  LOW_V,
  POWER,
  RING,
  acSource,
  cell,
  dip8OpAmp,
  dropAlong,
  ease,
  glowMat,
  groundAt,
  lane,
  junction,
  ledLamp,
  opAmpSymbol,
  plusFlow,
  potentialColor,
  presence,
  pulseLabel,
  resistorAlong,
  scope,
  swapResistor,
  terminal,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, e12, n } from '../types'

const OP = TL072
const RSH = 1.9
const VIS_HZ = 0.5
const SLOW = 1000 / VIS_HZ
const fraction = (r: Rails) => (v: number) => (v - r.vee) / (r.vcc - r.vee)
const sine = (amp: number, t: number) => amp * Math.sin(2 * Math.PI * VIS_HZ * t)
const signed = (v: number, cells: number) => (v < -0.005 ? '-' : '') + fitDigits(Math.abs(v), cells - (v < -0.005 ? 1 : 0))
const microvolts = (v: number) => (Math.abs(v) < 1e-3 ? `${+(v * 1e6).toPrecision(3)} µV` : volts(v))
const gainText = (g: number) => `×${g < 0 ? '−' : ''}${+Math.abs(g).toPrecision(Math.abs(g) < 10 ? 3 : 4)}`
const slowNote = `A 1 kHz signal, shown ${SLOW}× slower.`

// --- Ideal rules: huge open-loop gain plus negative feedback makes V− track V+; the gain → 1/β as A → ∞. ---

const R12: Rails = { vcc: 12, vee: -12 }
const f12 = fraction(R12)
const RF = 100e3
const RG = 10e3
const BETA = RG / (RF + RG)
const LG_MIN = 1
const LG_MAX = 6
const G_MAX = 12
const IR_PLOT: V3 = [10.8, -2, 0]
const IR_W = 10
const IR_H = 7.5
const F_Y = -4.2
const N_X = -11
const O_X = -0.5

const solveRules = (p: Params, aol = n(p, 'aol'), vin = n(p, 'vin')) => {
  const op = { ...OP, aol }
  if (p.loop === 'open') {
    const vout = openLoopOut(op, vin, 0, R12)
    return { open: true, vin, vout, vn: 0, diff: vin, gain: vin ? vout / vin : 0, linear: nonInvertingGain(aol, BETA) }
  }
  const s = nonInverting(op, vin, BETA, R12)
  return { open: false, vin, vout: s.vout, vn: s.vn, diff: s.diff, gain: nonInvertingGain(aol, BETA), linear: nonInvertingGain(aol, BETA) }
}

export const idealRules: Lesson = {
  id: 'op-amp-ideal-rules',
  title: 'Ideal rules',
  tagline: 'V− chases V+, and nothing flows in',
  formula: (p) => {
    const s = solveRules(p)
    if (s.open) return `No feedback: Vout = A (V+ − V−) = ${Math.round(n(p, 'aol'))} × ${volts(s.vin)} → pinned at ${volts(s.vout)}`
    return `Vout = A / (1 + Aβ) × Vin = ${s.gain.toFixed(4)} × ${volts(s.vin)} = ${volts(s.vout)}, so V+ − V− = ${microvolts(s.diff)} (ideal 1/β = 11)`
  },
  legend: [
    { color: RING, label: 'Closed-loop gain vs open-loop A (log)', shape: 'dot' },
    { color: GREY, label: 'Ideal 1 + Rf/Rg = 11', shape: 'dot' },
    { color: POWER, label: 'V+ − V−, mV', shape: 'dot' },
  ],
  points: [
    'An op-amp amplifies the difference between its two inputs: Vout = A (V+ − V−). A is enormous: a TL072 (two op-amps in one DIP-8) has about 200 000.',
    'Without feedback that is useless: 50 µV of difference already makes 10 V, so any real input slams the output into a rail. Pick Open loop: it sits at +10.5 V, about 1.5 V short of the +12 V supply.',
    'Feed part of the output back to V−: Rf and Rg give V− = β Vout with β = 1/11. The output now climbs only until V− has nearly caught up with V+, and the gain becomes A / (1 + Aβ), which tends to 1/β = 11 as A grows.',
    'So with negative feedback two rules hold: the output does whatever makes V− = V+, and no current flows into the inputs (a TL072 draws picoamps). The resistors set the gain, not the chip.',
    'Drag A down: at 10 the gain is only 5.2, at 1000 it’s 1 % short, at 200 000 it’s right to 0.005 %. Push Vin past about 0.95 V and the output clips; then V− can no longer follow and the rules break.',
  ],
  controls: [
    { kind: 'slider', key: 'aol', label: 'Open-loop gain A', min: 10, max: 1e6, initial: OP.aol, log: true, format: (v: number) => Math.round(v).toLocaleString('en-US') },
    { kind: 'slider', key: 'vin', label: 'Vin', min: 0, max: 1.5, initial: 0.5, step: 0.05, format: volts },
    {
      kind: 'choice',
      key: 'loop',
      options: [
        { value: 'closed', label: 'Feedback' },
        { value: 'open', label: 'Open loop' },
      ],
      initial: 'closed',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const chip = dip8OpAmp(scene, [-16.4, -6.6, 0], 0.65)
    const amp = opAmpSymbol(scene, [-6, 0, 0], { minusTop: false })
    const { p: pPin, n: nPin, out } = amp.pins
    const cellTop = 0.6
    add(scene, cell(3.2, 0.9), [-14, cellTop - 1.8, 0])
    wire(scene, [[-14, cellTop, 0], [-14, pPin[1], 0], pPin], 0.18)
    wire(scene, [[-14, cellTop - 3.4, 0], [-14, -3.6, 0]], 0.18)
    groundAt(scene, [-14, -3.6, 0])
    wire(scene, [out, [O_X, 0, 0], [3, 0, 0]], 0.18)
    const vout = terminal(scene, [3, 0, 0], 0.45)
    const outNode = junction(scene, [O_X, 0, 0], 0.35)
    wire(scene, [nPin, [N_X, nPin[1], 0], [N_X, F_Y, 0]], 0.18)

    const fb = add(scene, new THREE.Group(), [(N_X + O_X) / 2, F_Y, 0])
    const local = (x: number, y: number): V3 => [x - (N_X + O_X) / 2, y - F_Y, 0]
    wire(fb, [local(O_X, 0), local(O_X, F_Y), local(N_X, F_Y), local(N_X, F_Y - 4.4)], 0.18)
    resistorAlong(fb, RF, local(-8.4, F_Y), local(-3.1, F_Y))
    resistorAlong(fb, RG, local(N_X, F_Y - 0.6), local(N_X, F_Y - 3.8))
    groundAt(fb, local(N_X, F_Y - 4.4))
    const nNode = junction(fb, local(N_X, F_Y), 0.35)
    const grounded = add(scene, new THREE.Group())
    wire(grounded, [[N_X, F_Y, 0], [N_X, F_Y - 1, 0]], 0.18)
    groundAt(grounded, [N_X, F_Y - 1, 0])

    const fbPts: V3[] = [out, [O_X, 0, 0], [O_X, F_Y, 0], [N_X, F_Y, 0], [N_X, F_Y - 4.4, 0]]
    const live = { vout: 0, vn: 0 }
    const flow = plusFlow(scene, lane(fbPts), (at) => {
      if (at.y > F_Y + 0.2) return f12(live.vout)
      if (at.x > N_X + 0.2) return dropAlong(at, [O_X, F_Y, 0], [N_X, F_Y, 0], f12(live.vout), f12(live.vn), RSH)
      return dropAlong(at, [N_X, F_Y, 0], [N_X, F_Y - 4.4, 0], f12(live.vn), f12(0), RSH * 0.9)
    })

    const vinLabel = pulseLabel(scene, 3, POWER, [-14, 2.4, 0], 1.1)
    const diffLabel = pulseLabel(scene, 5, POWER, [-7.4, 4.6, 0], 1.1)
    const outLabel = pulseLabel(scene, 4, HIGH_V, [3, 1.6, 0], 1.2)

    const plot = scope(scene, IR_W, IR_H, { divs: [5, 6], zeroAt: 0 })
    plot.group.position.set(...IR_PLOT)
    ticks(plot, [[0, '10'], [0.4, '1000'], [0.8, '100000']], [])
    const gy = (g: number) => (Math.min(G_MAX, Math.max(0, g)) / G_MAX) * IR_H - IR_H / 2
    const lgOf = (u: number) => LG_MIN + u * (LG_MAX - LG_MIN)
    plot.level(GREY).set(gy(11))
    const curve = plot.trace(RING, { samples: 120 })
    curve.draw((u) => gy(nonInvertingGain(10 ** lgOf(u), BETA)), null)
    const dot = add(plot.group, mesh(new THREE.SphereGeometry(0.42, 18, 12), glowMat('#ffffff', 1.4)))
    const gainLabel = pulseLabel(plot.group, 4, RING, [0, 0, 0.3], 1.1)

    const pin1 = new THREE.Color()
    chip.light(3, POWER)
    chip.light(8, HIGH_V)
    chip.light(4, LOW_V)
    let lg = Math.log10(OP.aol)
    let vin = 0.5
    let closed = 1
    return {
      scene,
      view: { center: [-0.2, -2.4, 0], radius: 58, polar: 1.42, azimuth: 0.12 },
      frame(dt, p) {
        lg += (Math.log10(n(p, 'aol')) - lg) * ease(dt)
        vin += (n(p, 'vin') - vin) * ease(dt)
        closed += ((p.loop === 'open' ? 0 : 1) - closed) * ease(dt, 5)
        const s = solveRules(p, 10 ** lg, vin)
        live.vout += (s.vout - live.vout) * ease(dt, 8)
        live.vn = s.vn
        presence(fb, closed)
        presence(grounded, 1 - closed)
        flow.mesh.visible = closed > 0.5
        flow.step(dt * (live.vout / (RF + RG)) * 4e4)
        const clip = Math.abs(live.vout) >= swingHigh(OP, R12) - 0.05 ? 1 : 0
        amp.set(f12(live.vout), clip)
        amp.inputs(f12(vin), f12(s.vn))
        outNode.set(f12(live.vout))
        vout.set(f12(live.vout))
        nNode.set(f12(s.vn))
        chip.light(1, `#${potentialColor(f12(live.vout), pin1).getHexString()}`)
        chip.light(2, closed > 0.5 ? RING : null)

        const lgx = (Math.min(LG_MAX, Math.max(LG_MIN, lg)) - LG_MIN) / (LG_MAX - LG_MIN)
        curve.material.opacity = closed > 0.5 ? 1 : 0.3
        curve.material.transparent = closed <= 0.5
        const y = gy(s.linear)
        const x = plot.xAt(lgx)
        dot.visible = closed > 0.5
        dot.position.set(x, y, 0.35)
        gainLabel.display.group.visible = closed > 0.5
        gainLabel.display.group.position.set(Math.min(IR_W / 2 - 2, x + 1.2), y - 1.4, 0.3)
        gainLabel.show(fitDigits(s.linear, 4))
        vinLabel.show(fitDigits(vin, 3))
        diffLabel.display.group.visible = closed > 0.5
        diffLabel.show(fitDigits(Math.abs(s.diff) * 1e3, 5))
        outLabel.show(signed(live.vout, 4))
        for (const l of [vinLabel, diffLabel, outLabel, gainLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveRules(p)
        const err = Math.abs(s.gain - 11) / 11
        return [
          { label: 'Gain Vout/Vin', value: s.vin ? gainText(s.vout / s.vin) : '—', tone: s.open ? 'bad' : undefined },
          { label: 'V+ − V−', value: microvolts(s.diff) },
          { label: 'Off ideal ×11', value: s.open ? 'no feedback' : `${+(err * 100).toPrecision(2)} %`, tone: s.open ? 'bad' : err < 0.01 ? 'ok' : 'warn' },
          { label: 'Vout', value: volts(s.vout), tone: Math.abs(s.vout) >= swingHigh(OP, R12) ? 'warn' : undefined },
        ]
      },
    }
  },
}

// --- Inverting amplifier: Rin and Rf around a virtual ground set Vout = −Rf/Rin × Vin; past the rails it clips. ---

const RIN = 10e3
const INV_W = 10
const INV_H = 8
const INV_AT: V3 = [9.6, 0.4, 0]
const WINDOW = 4
const TOP_Y = 5
const IN_Y = 1.1
const SRC_X = -16.5
const NI_X = -10.5
const OI_X = 0.5

const solveInverting = (p: Params) => {
  const rf = e12(p, 'rf')
  const amp = n(p, 'amp')
  const ideal = (rf / RIN) * amp
  const at = (v: number) => inverting(OP, v, RIN, rf, R12)
  return { rf, amp, gain: -rf / RIN, ideal, peak: at(amp), clipped: ideal > swingHigh(OP, R12), at }
}

export const invertingAmplifier: Lesson = {
  id: 'op-amp-inverting-amplifier',
  title: 'Inverting amplifier',
  tagline: 'Two resistors set the gain',
  formula: (p) => {
    const s = solveInverting(p)
    const tail = s.clipped ? ` → clipped at ±${volts(swingHigh(OP, R12))}` : ''
    return `Vout = −Rf / Rin × Vin = −${ohms(s.rf)} / ${ohms(RIN)} × ${volts(s.amp)} = ${volts(-s.ideal)} peak${tail}`
  },
  legend: [
    { color: POWER, label: 'Vin', shape: 'dot' },
    { color: HIGH_V, label: 'Vout (faint: what it would be without rails)', shape: 'dot' },
    { color: GREY, label: 'Output swing limit ±10.5 V', shape: 'dot' },
    { color: RING, label: 'V− (virtual ground), mV', shape: 'dot' },
  ],
  points: [
    'Ground V+, feed the signal through Rin into V−, and connect Rf from the output back to V−. Negative feedback holds V− at V+ = 0 V: a virtual ground.',
    'No current enters the op-amp, so all of Vin / Rin flows on through Rf, and the output must swing to −Rf × Vin / Rin to pull it out. Gain = −Rf / Rin: the minus is a flipped waveform.',
    'With Rin = 10 kΩ, Rf = 100 kΩ gives ×−10: 0.5 V in, 5 V out, upside down. The input sees just Rin, 10 kΩ, as its load.',
    'On ±12 V a TL072 swings only to about ±10.5 V. Ask for more and the tops get sliced flat (clipping). Then the output can’t balance Rin any more, V− lifts off 0 V and the waveform distorts.',
    slowNote,
  ],
  controls: [
    { kind: 'slider', key: 'rf', label: 'Rf', min: 10e3, max: 220e3, initial: 100e3, log: true, format: (v: number) => ohms(nearestE12(v)) },
    { kind: 'slider', key: 'amp', label: 'Vin peak', min: 0.1, max: 2, initial: 0.5, step: 0.05, format: volts },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const amp = opAmpSymbol(scene, [-5, 0, 0])
    const { p: pPin, n: nPin, out } = amp.pins
    add(scene, acSource(1.3), [SRC_X, -1, 0])
    wire(scene, [[SRC_X, 0.3, 0], [SRC_X, IN_Y, 0], [NI_X, IN_Y, 0], nPin], 0.18)
    resistorAlong(scene, RIN, [-15.2, IN_Y, 0], [-11.8, IN_Y, 0])
    wire(scene, [[NI_X, IN_Y, 0], [NI_X, TOP_Y, 0], [OI_X, TOP_Y, 0], [OI_X, 0, 0]], 0.18)
    const rfHolder = add(scene, new THREE.Group())
    wire(scene, [out, [2.4, 0, 0]], 0.18)
    wire(scene, [pPin, [-9.5, pPin[1], 0], [-9.5, -2.4, 0]], 0.18)
    groundAt(scene, [-9.5, -2.4, 0])
    wire(scene, [[SRC_X, -2.3, 0], [SRC_X, -3, 0]], 0.18)
    groundAt(scene, [SRC_X, -3, 0])
    const vn = junction(scene, [NI_X, IN_Y, 0], 0.35)
    const vo = junction(scene, [OI_X, 0, 0], 0.35)
    const term = terminal(scene, [2.4, 0, 0], 0.45)

    const live = { vin: 0, vn: 0, vout: 0 }
    const pts: V3[] = [[SRC_X, 0.3, 0], [SRC_X, IN_Y, 0], [NI_X, IN_Y, 0], [NI_X, TOP_Y, 0], [OI_X, TOP_Y, 0], [OI_X, 0, 0], out]
    const flow = plusFlow(scene, lane(pts), (at) => {
      if (at.y > TOP_Y - 0.2) return dropAlong(at, [NI_X, TOP_Y, 0], [OI_X, TOP_Y, 0], f12(live.vn), f12(live.vout), RSH)
      if (at.x < SRC_X + 0.2) return f12(live.vin)
      if (at.y < IN_Y + 0.2 && at.x < NI_X - 0.2) return dropAlong(at, [SRC_X, IN_Y, 0], [NI_X, IN_Y, 0], f12(live.vin), f12(live.vn), RSH)
      return at.x < NI_X + 0.2 ? f12(live.vn) : f12(live.vout)
    })

    const vinLabel = pulseLabel(scene, 4, POWER, [SRC_X, 3.2, 0], 1.1)
    const vnLabel = pulseLabel(scene, 4, RING, [-12.6, -1.7, 0], 1.1)
    const outLabel = pulseLabel(scene, 4, HIGH_V, [2.2, -2.4, 0], 1.2)

    const plot = scope(scene, INV_W, INV_H, { divs: [8, 8] })
    plot.group.position.set(...INV_AT)
    const vy = (v: number) => (v / 12) * (INV_H / 2)
    for (const s of [-1, 1]) plot.level(GREY).set(vy(s * swingHigh(OP, R12)))
    const ghost = plot.trace(HIGH_V, { radius: 0.07 })
    ghost.material.transparent = true
    ghost.material.opacity = 0.3
    ghost.material.emissiveIntensity = 0.25
    const inTrace = plot.trace(POWER)
    const outTrace = plot.trace(HIGH_V)

    let t = 0
    let rfBuilt = -1
    return {
      scene,
      view: { center: [-1, 0, 0], radius: 58, polar: 1.42, azimuth: 0.12 },
      frame(dt, p) {
        t += dt
        const s = solveInverting(p)
        if (s.rf !== rfBuilt) {
          rfBuilt = s.rf
          swapResistor(rfHolder, s.rf, [-7.7, TOP_Y, 0], [-2.3, TOP_Y, 0], 1.6)
        }
        const now = s.at(sine(s.amp, t))
        live.vin = sine(s.amp, t)
        live.vn = now.vn
        live.vout = now.vout
        flow.step(dt * now.amps * 2e4)
        amp.set(f12(now.vout), now.clipped ? 1 : 0)
        amp.inputs(f12(0), f12(now.vn))
        vn.set(f12(now.vn))
        vo.set(f12(now.vout))
        term.set(f12(now.vout))
        inTrace.scroll((x) => vy(sine(s.amp, x)), t, WINDOW)
        ghost.scroll((x) => vy(s.gain * sine(s.amp, x)), t, WINDOW)
        outTrace.scroll((x) => vy(s.at(sine(s.amp, x)).vout), t, WINDOW)
        vinLabel.show(signed(live.vin, 4))
        vnLabel.show(signed(now.vn * 1000, 4))
        outLabel.show(signed(now.vout, 4))
        for (const l of [vinLabel, vnLabel, outLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveInverting(p)
        const low = s.at(-s.amp)
        return [
          { label: 'Gain −Rf/Rin', value: gainText(s.gain) },
          { label: 'Vout peak', value: volts(Math.abs(s.peak.vout)), tone: s.clipped ? 'bad' : 'ok' },
          { label: 'V− peak', value: `${+(Math.abs(low.vn) * 1000).toPrecision(3)} mV`, tone: s.clipped ? 'warn' : undefined },
          { label: 'Wanted', value: volts(s.ideal), tone: s.clipped ? 'bad' : undefined },
        ]
      },
    }
  },
}

// --- Voltage follower: gain 1, but the load no longer draws on the source, so a weak source keeps its voltage. ---

const R5: Rails = { vcc: 5, vee: -5 }
const f5 = fraction(R5)
const RS = 10e3
const VF_AT: V3 = [10.6, 0.6, 0]
const VF_W = 9
const VF_H = 8
const VS_X = -16
const A_X = -10
const S_Y = 2.5
const AMP_AT: V3 = [-4.5, 1.4, 0]
const L_X = 3.5
const BY_Y = 6
const GND_Y = -4.4

const solveFollower = (p: Params) => {
  const rl = e12(p, 'rl')
  const amp = n(p, 'amp')
  const buffered = p.buffer !== 'off'
  const at = (vs: number) => {
    if (!buffered) {
      const vl = loadedVolts(vs, RS, rl)
      return { vl, is: (vs - vl) / RS, il: vl / rl, clipped: false }
    }
    const s = nonInverting(OP, vs, 1, R5, rl)
    return { vl: s.vout, is: 0, il: s.vout / rl, clipped: s.clipped }
  }
  return { rl, amp, buffered, at, peak: at(amp) }
}

export const voltageFollower: Lesson = {
  id: 'op-amp-voltage-follower',
  title: 'Voltage follower',
  tagline: 'Gain of one, and that’s the point',
  formula: (p) => {
    const s = solveFollower(p)
    if (!s.buffered) return `Direct: VL = Vs × RL / (Rs + RL) = ${volts(s.amp)} × ${ohms(s.rl)} / ${ohms(RS + s.rl)} = ${volts(s.peak.vl)} peak`
    return `Follower: VL = Vs × A / (1 + A) = ${volts(s.peak.vl)} peak${s.peak.clipped ? ` (clipped at ±${volts(swingHigh(OP, R5))})` : ''}; source current ≈ 0`
  },
  legend: [
    { color: POWER, label: 'Source voltage Vs', shape: 'dot' },
    { color: HIGH_V, label: 'Voltage on the load VL', shape: 'dot' },
    { color: GREY, label: 'Swing limit on ±5 V: ±3.5 V', shape: 'dot' },
  ],
  points: [
    'Tie the output straight to V−: β = 1, so Vout = V+. It looks like a wire with extra steps.',
    'The point is the currents. A weak source, a sensor or a divider with 10 kΩ inside, sags as soon as anything draws current: into 1 kΩ only a tenth of its voltage survives (pick Direct).',
    'The op-amp input draws picoamps, so the source sees no load and keeps its full voltage. The current for the load comes from the op-amp’s supply instead, up to about 40 mA for a TL072.',
    'That’s a buffer: put one after a divider, a reference or a high-impedance sensor before an ADC, a cable or a speaker.',
    'Limits still apply. On ±5 V a TL072 only reaches ±3.5 V, so a 4 V peak gets clipped; a rail-to-rail op-amp (MCP6002) gets within millivolts.',
    slowNote,
  ],
  controls: [
    { kind: 'slider', key: 'rl', label: 'Load RL', min: 100, max: 100e3, initial: 1e3, log: true, format: (v: number) => ohms(nearestE12(v)) },
    { kind: 'slider', key: 'amp', label: 'Vs peak', min: 0.5, max: 4.5, initial: 2, step: 0.1, format: volts },
    {
      kind: 'choice',
      key: 'buffer',
      options: [
        { value: 'on', label: 'Follower' },
        { value: 'off', label: 'Direct' },
      ],
      initial: 'on',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    add(scene, acSource(1.3), [VS_X, -0.5, 0])
    wire(scene, [[VS_X, 0.8, 0], [VS_X, S_Y, 0], [A_X, S_Y, 0]], 0.18)
    resistorAlong(scene, RS, [-14.7, S_Y, 0], [-11.3, S_Y, 0])
    wire(scene, [[VS_X, -1.8, 0], [VS_X, GND_Y, 0]], 0.18)
    groundAt(scene, [VS_X, GND_Y, 0])
    const aNode = junction(scene, [A_X, S_Y, 0], 0.35)

    const ampGroup = add(scene, new THREE.Group(), AMP_AT)
    const al = (x: number, y: number): V3 => [x - AMP_AT[0], y - AMP_AT[1], 0]
    const amp = opAmpSymbol(ampGroup, [0, 0, 0], { minusTop: false })
    const { n: nPin, out } = amp.pins
    wire(ampGroup, [al(A_X, S_Y), amp.pins.p], 0.18)
    wire(ampGroup, [nPin, [nPin[0] - 1.1, nPin[1], 0], al(-8.8, -2.6), al(0.6, -2.6), al(0.6, AMP_AT[1]), out], 0.18)
    wire(ampGroup, [al(0.6, AMP_AT[1]), al(L_X, AMP_AT[1])], 0.18)

    const byGroup = add(scene, new THREE.Group(), [(A_X + L_X) / 2, BY_Y, 0])
    const bl = (x: number, y: number): V3 => [x - (A_X + L_X) / 2, y - BY_Y, 0]
    wire(byGroup, [bl(A_X, S_Y), bl(A_X, BY_Y), bl(L_X, BY_Y), bl(L_X, AMP_AT[1])], 0.18)

    wire(scene, [[L_X, AMP_AT[1], 0], [L_X, GND_Y, 0]], 0.18)
    groundAt(scene, [L_X, GND_Y, 0])
    const rlHolder = add(scene, new THREE.Group())
    const lNode = junction(scene, [L_X, AMP_AT[1], 0], 0.35)

    const live = { vs: 0, vl: 0 }
    const outX = AMP_AT[0] + out[0]
    const loadPaint = (at: THREE.Vector3) =>
      at.x > L_X - 0.2 && at.y < AMP_AT[1] - 0.2 ? dropAlong(at, [L_X, AMP_AT[1], 0], [L_X, GND_Y, 0], f5(live.vl), f5(0), RSH) : f5(live.vl)
    const inFlow = plusFlow(scene, lane([[VS_X, 0.8, 0], [VS_X, S_Y, 0], [A_X, S_Y, 0]]), (at) =>
      at.x < VS_X + 0.2 ? f5(live.vs) : dropAlong(at, [VS_X, S_Y, 0], [A_X, S_Y, 0], f5(live.vs), f5(live.vl), RSH),
    )
    const byFlow = plusFlow(scene, lane([[A_X, S_Y, 0], [A_X, BY_Y, 0], [L_X, BY_Y, 0], [L_X, GND_Y, 0]]), loadPaint)
    const outFlow = plusFlow(scene, lane([[outX, AMP_AT[1], 0], [L_X, AMP_AT[1], 0], [L_X, GND_Y, 0]]), loadPaint)

    const vsLabel = pulseLabel(scene, 4, POWER, [VS_X, 4, 0], 1.1)
    const vlLabel = pulseLabel(scene, 4, HIGH_V, [0.5, 3.4, 0], 1.2)

    const plot = scope(scene, VF_W, VF_H, { divs: [8, 8] })
    plot.group.position.set(...VF_AT)
    const vy = (v: number) => (v / 5) * (VF_H / 2)
    for (const s of [-1, 1]) plot.level(GREY).set(vy(s * swingHigh(OP, R5)))
    const sTrace = plot.trace(POWER, { radius: 0.2 })
    const lTrace = plot.trace(HIGH_V)
    lTrace.group.position.z = 0.15

    let t = 0
    let on = 1
    let rlBuilt = -1
    return {
      scene,
      view: { center: [-0.8, 0.2, 0], radius: 58, polar: 1.42, azimuth: 0.12 },
      frame(dt, p) {
        t += dt
        const s = solveFollower(p)
        if (s.rl !== rlBuilt) {
          rlBuilt = s.rl
          swapResistor(rlHolder, s.rl, [L_X, -0.2, 0], [L_X, -3, 0], 1.6)
        }
        on += ((s.buffered ? 1 : 0) - on) * ease(dt, 5)
        presence(ampGroup, on)
        presence(byGroup, 1 - on)
        const vs = sine(s.amp, t)
        const now = s.at(vs)
        live.vs = vs
        live.vl = now.vl
        const speed = (i: number) => Math.max(-14, Math.min(14, i * 3000))
        inFlow.step(dt * speed(now.is))
        byFlow.mesh.visible = on < 0.5
        outFlow.mesh.visible = on >= 0.5
        byFlow.step(dt * speed(now.il))
        outFlow.step(dt * speed(now.il))
        amp.set(f5(now.vl), now.clipped ? 1 : 0)
        amp.inputs(f5(vs), f5(now.vl))
        aNode.set(f5(s.buffered ? vs : now.vl))
        lNode.set(f5(now.vl))
        sTrace.scroll((x) => vy(sine(s.amp, x)), t, WINDOW)
        lTrace.scroll((x) => vy(s.at(sine(s.amp, x)).vl), t, WINDOW)
        vsLabel.show(signed(vs, 4))
        vlLabel.show(signed(now.vl, 4))
        for (const l of [vsLabel, vlLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveFollower(p)
        const kept = s.peak.vl / s.amp
        return [
          { label: 'Load peak', value: volts(s.peak.vl) },
          { label: 'Kept', value: `${Math.round(kept * 100)} %`, tone: kept > 0.97 ? 'ok' : kept > 0.8 ? 'warn' : 'bad' },
          { label: 'From source', value: s.buffered ? '≈ 0' : amps(s.peak.is) },
          { label: 'Load I', value: amps(s.peak.il) },
        ]
      },
    }
  },
}

// --- Comparator: no feedback, so the output snaps between rails; hysteresis (positive feedback) stops noise chattering it. ---

const CMP = MCP6002
const R0: Rails = { vcc: 5, vee: 0 }
const f0 = fraction(R0)
const C_RIN = 10e3
const C_RH = 100e3
const SAMPLES = 240
const C_WINDOW = 8
const SENSE_HZ = 0.125
const C_AT: V3 = [10, 0.6, 0]
const C_W = 9
const C_H = 8
const CP_AT: V3 = [-4, 0.5, 0]
const SN_X = -15
const REF_X = -8.2
const P_X = -9
const H_Y = 4.6
const CO_X = 0.8
const LED_X = 2.8
const LED_VF = 2
const LED_R = 1e3

const hash = (k: number) => {
  const s = Math.sin(k * 12.9898) * 43758.5453
  return 2 * (s - Math.floor(s)) - 1
}
const wobble = (k: number) => {
  const i = Math.floor(k / 2)
  const u = k / 2 - i
  return hash(i) + (hash(i + 1) - hash(i)) * u * u * (3 - 2 * u)
}
const sensor = (k: number, noise: number) => 2.5 + 0.9 * Math.sin((2 * Math.PI * SENSE_HZ * k * C_WINDOW) / SAMPLES) + noise * wobble(k)

const solveComparator = (p: Params) => {
  const ref = n(p, 'ref')
  const noise = n(p, 'noise')
  const rh = p.hyst === 'on' ? C_RH : Infinity
  const window = Array.from({ length: SAMPLES }, (_, k) => sensor(k, noise))
  return { ref, noise, rh, th: comparatorThresholds(CMP, ref, C_RIN, rh, R0), flips: comparatorRun(CMP, window, ref, C_RIN, rh, R0).flips }
}

export const comparator: Lesson = {
  id: 'op-amp-comparator',
  title: 'Comparator',
  tagline: 'Is it above the line, yes or no',
  formula: (p) => {
    const s = solveComparator(p)
    const g = `A = ${CMP.aol.toLocaleString('en-US')}: ${+((swingHigh(CMP, R0) - swingLow(CMP, R0)) / CMP.aol * 1e6).toPrecision(2)} µV swings it rail to rail`
    if (!Number.isFinite(s.rh)) return `Vin > ${volts(s.ref)} → out high; ${g}`
    return `Hysteresis: rises past ${volts(s.th.up)}, falls past ${volts(s.th.down)} (Rin / Rh = ${ohms(C_RIN)} / ${ohms(C_RH)}); ${g}`
  },
  legend: [
    { color: POWER, label: 'Noisy sensor Vin', shape: 'dot' },
    { color: HIGH_V, label: 'Output', shape: 'dot' },
    { color: RING, label: 'Switching threshold(s)', shape: 'dot' },
  ],
  points: [
    'Run an op-amp with no negative feedback and it can only say yes or no: an MCP6002 has A ≈ 400 000, so 12 µV of difference already moves the output from one rail to the other.',
    'Put the sensor on V+ and a reference on V−. Above the reference the output goes high (≈ 5 V on a 5 V supply: rail-to-rail, lighting the LED through 1 kΩ); below it, ≈ 0 V.',
    'Real signals are noisy. Near the threshold the noise crosses it back and forth, and the output chatters: dozens of edges for one slow crossing. Raise Noise and watch the flips.',
    'Add Rh from the output back to V+ (positive feedback). Once high, the output holds V+ up, so the input must fall further to flip it back: two thresholds, a dead band wider than the noise. That’s a Schmitt trigger.',
    'Dedicated comparators (LM393) switch in nanoseconds rather than microseconds; an op-amp is fine for slow signals like light, temperature or a battery level.',
  ],
  controls: [
    { kind: 'slider', key: 'ref', label: 'Vref', min: 1.5, max: 3.5, initial: 2.5, step: 0.1, format: volts },
    { kind: 'slider', key: 'noise', label: 'Noise', min: 0, max: 0.4, initial: 0.25, step: 0.01, format: (v: number) => `±${volts(v)}` },
    {
      kind: 'choice',
      key: 'hyst',
      options: [
        { value: 'off', label: 'Plain' },
        { value: 'on', label: 'Hysteresis' },
      ],
      initial: 'off',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const amp = opAmpSymbol(scene, CP_AT, { minusTop: false })
    const { p: pPin, n: nPin, out } = amp.pins
    add(scene, acSource(1.3), [SN_X, -0.6, 0])
    wire(scene, [[SN_X, 0.7, 0], [SN_X, pPin[1], 0], pPin], 0.18)
    resistorAlong(scene, C_RIN, [-13.7, pPin[1], 0], [-10.3, pPin[1], 0])
    wire(scene, [[SN_X, -1.9, 0], [SN_X, -3.6, 0]], 0.18)
    groundAt(scene, [SN_X, -3.6, 0])
    const pNode = junction(scene, [P_X, pPin[1], 0], 0.35)
    const refTop = -1.8
    wire(scene, [nPin, [REF_X, nPin[1], 0], [REF_X, refTop, 0]], 0.18)
    add(scene, cell(2.6, 0.8), [REF_X, refTop - 1.5, 0])
    wire(scene, [[REF_X, refTop - 2.9, 0], [REF_X, -5.4, 0]], 0.18)
    groundAt(scene, [REF_X, -5.4, 0])
    wire(scene, [out, [LED_X - 0.5, CP_AT[1], 0]], 0.18)
    const oNode = junction(scene, [CO_X, CP_AT[1], 0], 0.35)
    const led = ledLamp(scene, RING, [LED_X, CP_AT[1], 0], { scale: 1, anodeRight: false })
    wire(scene, [[LED_X + 0.5, CP_AT[1], 0], [4.2, CP_AT[1], 0], [4.2, -1.2, 0]], 0.18)
    groundAt(scene, [4.2, -1.2, 0])

    const hGroup = add(scene, new THREE.Group(), [(P_X + CO_X) / 2, H_Y, 0])
    const hl = (x: number, y: number): V3 => [x - (P_X + CO_X) / 2, y - H_Y, 0]
    wire(hGroup, [hl(P_X, pPin[1]), hl(P_X, H_Y), hl(CO_X, H_Y), hl(CO_X, CP_AT[1])], 0.18)
    resistorAlong(hGroup, C_RH, hl(-5.8, H_Y), hl(-2.4, H_Y))

    const vinLabel = pulseLabel(scene, 4, POWER, [SN_X, 3, 0], 1.1)
    const refLabel = pulseLabel(scene, 3, GREY, [REF_X - 2.4, -3.3, 0], 1.1)
    const outLabel = pulseLabel(scene, 4, HIGH_V, [CO_X - 0.8, -1.4, 0], 1.2)

    const plot = scope(scene, C_W, C_H, { divs: [6, 6], zeroAt: 0 })
    plot.group.position.set(...C_AT)
    const vy = (v: number) => (v / R0.vcc) * C_H - C_H / 2
    const up = plot.level(RING)
    const down = plot.level(RING)
    const inTrace = plot.trace(POWER, { samples: SAMPLES, radius: 0.08 })
    const outTrace = plot.trace(HIGH_V, { samples: SAMPLES })

    const ins: number[] = []
    const outs: number[] = []
    let k = 0
    let acc = 0
    let state = swingLow(CMP, R0)
    let hyst = 0
    let shown = 0
    const step = C_WINDOW / SAMPLES
    return {
      scene,
      view: { center: [-0.6, 0, 0], radius: 58, polar: 1.42, azimuth: 0.12 },
      frame(dt, p) {
        const s = solveComparator(p)
        hyst += ((Number.isFinite(s.rh) ? 1 : 0) - hyst) * ease(dt, 5)
        presence(hGroup, hyst)
        acc += Math.min(dt, 0.25)
        if (!ins.length) {
          for (; k < SAMPLES; k++) {
            ins.push(sensor(k, s.noise))
            outs.push((state = comparatorStep(CMP, state, ins[k], s.ref, C_RIN, s.rh, R0)))
          }
        }
        for (; acc >= step; acc -= step, k++) {
          const x = sensor(k, s.noise)
          state = comparatorStep(CMP, state, x, s.ref, C_RIN, s.rh, R0)
          ins.push(x)
          outs.push(state)
          ins.shift()
          outs.shift()
        }
        const vin = ins[SAMPLES - 1]
        shown += (state - shown) * ease(dt, 30)
        inTrace.draw((u) => vy(ins[Math.round(u * (SAMPLES - 1))]))
        outTrace.draw((u) => vy(outs[Math.round(u * (SAMPLES - 1))]))
        up.set(vy(s.th.up))
        down.set(vy(s.th.down))
        const high = state > R0.vcc / 2
        amp.set(f0(shown), 1)
        amp.inputs(f0(vin), f0(s.ref))
        pNode.set(f0(vin))
        oNode.set(f0(shown))
        led.set(Math.max(0, shown - LED_VF) / LED_R / 0.003)
        led.step(dt)
        vinLabel.show(fitDigits(vin, 4))
        refLabel.show(fitDigits(s.ref, 3))
        outLabel.show(high ? fitDigits(swingHigh(CMP, R0), 4) : fitDigits(swingLow(CMP, R0), 4))
        for (const l of [vinLabel, refLabel, outLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveComparator(p)
        return [
          { label: `Flips / ${C_WINDOW} s`, value: String(s.flips), tone: s.flips <= 3 ? 'ok' : 'bad' },
          { label: 'Rises at', value: volts(s.th.up) },
          { label: 'Falls at', value: volts(s.th.down) },
        ]
      },
    }
  },
}
