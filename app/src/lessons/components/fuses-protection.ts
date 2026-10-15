import * as THREE from 'three/webgpu'
import {
  FUSES,
  Fuse,
  Guard,
  IRF4905,
  fuseI2t,
  fuseMeltTime,
  fuseStep,
  rdsOn,
  reverseGuard,
  surge,
  tvsNode,
} from '../../core/physics'
import { fitDigits, si, tiny, volts } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CELL_H,
  CONVENTIONAL,
  GREY,
  HEAT,
  HIGH_V,
  RING,
  arcSpark,
  bulb,
  cell,
  cellFraction,
  clamp01,
  diodeAlong,
  dropAlong,
  ease,
  emptyGroup,
  fetPart,
  glassFuse,
  glowHalo,
  heatWaves,
  icPackage,
  ivScreen,
  lane,
  lerp,
  plusFlow,
  presence,
  pulseLabel,
  scope,
  smoke,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const VIEW = { center: [-0.8, 2.2, 0] as V3, radius: 54, polar: 1.42, azimuth: 0.1 }
const secs = (t: number) => (Number.isFinite(t) ? si(t, 's', 3) : 'Never')

// --- Fuse ratings: the wire heats as I²R and melts; the time to melt falls steeply with current. ---

const SLOW1 = 5
const REFIT = 3
const L1 = -15
const X1 = -3
const H1 = 4.5
const FUSE_X = -9
const S1: V3 = [6.4, 0.4, 0]
const S1_W = 11
const S1_H = 8
const I_LO = 0.5
const I_HI = 10
const T_LO = 1e-3
const DECADES = 5
type FuseKind = 'F1A' | 'T1A'

const solveFuse = (p: Params) => {
  const kind: FuseKind = p.kind === 'T1A' ? 'T1A' : 'F1A'
  const f: Fuse = FUSES[kind]
  const amps = n(p, 'amps')
  return { kind, f, amps, t: fuseMeltTime(amps, f) }
}
const xOf = (amps: number) => Math.log(amps / I_LO) / Math.log(I_HI / I_LO)
const yOf = (t: number) => (Math.log10(t / T_LO) / DECADES) * S1_H - S1_H / 2

export const fuseRatings: Lesson = {
  id: 'fuses-protection-fuse-ratings',
  title: 'Fuse ratings',
  tagline: 'The weakest link, on purpose',
  formula: (p) => {
    const s = solveFuse(p)
    const head = `t = τ·ln(I² / (I² − Imin²))`
    if (!Number.isFinite(s.t)) return `${head} · I = ${si(s.amps, 'A', 3)} ≤ Imin = ${si(s.f.minMeltA, 'A', 2)}: never melts`
    return `${head} = ${s.f.tauS} s · ln(${s.amps.toFixed(1)}² / (${s.amps.toFixed(1)}² − ${s.f.minMeltA}²)) = ${secs(s.t)} · I²t = ${si(fuseI2t(s.amps, s.f), 'A²s', 2)}`
  },
  legend: [
    { color: RING, label: 'Time to melt vs current (log–log)', shape: 'dot' },
    { color: GREY, label: 'The other fuse type', shape: 'dot' },
    { color: '#ffffff', label: 'Time so far at this current', shape: 'dot' },
    { color: HIGH_V, label: 'Wires by potential', shape: 'dot' },
  ],
  points: [
    'A fuse is a thin wire made to be the weakest link. Too much current heats it (P = I²R) until it melts and opens the circuit, before the wiring or the battery catches fire.',
    'The rating is what it carries for good: this 1 A fuse holds 1 A, even 1.5 A. Only above about 1.8 A does it ever melt, and the further above, the faster.',
    'That trade is the time-current curve: 2 A melts a fast fuse in 0.4 s, 10 A in 8 ms. A big fault melts it before the heat can leave, so it blows at a fixed I²t, about 0.8 A²s here.',
    'A slow-blow (T) element is coiled on a core: 8× the heat to store, so a motor’s start-up surge passes while a short still blows it. Fast (F) guards delicate electronics.',
    'Rate it above the normal current and below what the wires can carry. A blown fuse means a fault: fix it, then fit the same rating, never a bigger one. Time slowed 5×.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'kind',
      options: [
        { value: 'F1A', label: 'Fast 1 A' },
        { value: 'T1A', label: 'Slow-blow 1 A' },
      ],
      initial: 'F1A',
    },
    { kind: 'slider', key: 'amps', label: 'Load current', min: I_LO, max: I_HI, initial: 2, step: 0.1, format: (v) => si(v, 'A', 2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const fuseHolder = add(scene, new THREE.Group())
    add(scene, cell(CELL_H, 1.5), [L1, 0, 0])
    let fuse = glassFuse(fuseHolder, [FUSE_X, H1, 0], { scale: 0.95 })
    const [fa, fb] = fuse.ends
    wire(scene, [fa, [L1, H1, 0], [L1, -H1, 0], [X1, -H1, 0], [X1, H1, 0], fb])
    const spark = arcSpark(scene, [FUSE_X, H1, 0.3])
    const puff = smoke(scene, 1.2, { count: 14, rise: 5 })
    puff.group.position.set(FUSE_X, H1 + 0.8, 0)
    const lamp = bulb()
    lamp.group.scale.setScalar(0.62)
    lamp.group.position.set(X1, 0.4, 0)
    scene.add(lamp.group)
    const iLabel = pulseLabel(scene, 3, CONVENTIONAL, [X1 - 3.4, 0, 0], 1.2)

    const { plot, dot } = ivScreen(scene, S1, S1_W, S1_H, [4, 5])
    ticks(plot, [[xOf(1), '1'], [xOf(2), '2'], [xOf(5), '5'], [xOf(10), '10']], [[0.2, '0.01'], [0.6, '1'], [1, '100']])
    const ghost = plot.trace(GREY, { radius: 0.08 })
    const live = plot.trace(RING, { radius: 0.12 })
    const curve = (f: Fuse) => (u: number) => yOf(fuseMeltTime(I_LO * (I_HI / I_LO) ** u, f))

    const state = { kind: '', key: '', t: 0, heat: 0, blown: false, since: 0, melt: 0, amps: 0 }
    const refit = () => {
      state.t = state.heat = state.melt = 0
      state.blown = false
    }
    const flow = plusFlow(
      scene,
      lane([[L1, -H1, 0], [L1, H1, 0], [X1, H1, 0], [X1, -H1, 0]]),
      (at) => {
        const right = state.blown ? 0 : 1
        if (at.y <= -H1 + 0.01) return 0
        if (at.x <= L1 + 0.01) return cellFraction(at.y)
        if (at.y >= H1 - 0.01) return at.x < FUSE_X ? 1 : right
        return dropAlong(at, [X1, H1, 0], [X1, -H1, 0], right, 0, 1.6)
      },
      true,
    )
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const s = solveFuse(p)
        if (s.kind !== state.kind) {
          state.kind = s.kind
          emptyGroup(fuseHolder)
          fuse = glassFuse(fuseHolder, [FUSE_X, H1, 0], { scale: 0.95, slow: s.kind === 'T1A' })
          ghost.draw(curve(FUSES[s.kind === 'T1A' ? 'F1A' : 'T1A']), null)
          live.draw(curve(s.f), null)
        }
        const key = `${s.kind}|${s.amps}`
        if (key !== state.key) {
          state.key = key
          refit()
        }
        state.amps = state.blown ? 0 : s.amps
        const step = dt / SLOW1
        state.heat = Math.min(1, fuseStep(state.heat, state.amps, step, s.f))
        if (!state.blown) {
          state.t += step
          if (state.heat >= 1 || state.t >= s.t) {
            state.blown = true
            state.since = 0
          }
        } else if ((state.since += dt) > REFIT) refit()
        state.melt += ((state.blown ? 1 : 0) - state.melt) * ease(dt, 14)
        fuse.set(clamp01((state.heat - 0.2) / 0.8), state.melt)
        const flash = state.blown ? Math.max(0, 1 - state.since / 0.35) : 0
        spark.set([FUSE_X - 0.7, H1, 0.3], [FUSE_X + 0.7, H1, 0.3], flash)
        puff.step(dt, state.blown && state.since < 1.4 ? 0.6 : 0)
        flow.step(dt * 2.5 * state.amps)
        lamp.setGlow(Math.sqrt(state.amps / I_HI))
        dot.position.set(plot.xAt(clamp01(xOf(s.amps))), yOf(Math.max(state.t, T_LO)), 0.4)
        iLabel.show(fitDigits(state.amps, 3))
        iLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveFuse(p)
        return [
          { label: 'Current', value: si(tiny(state.amps, 1e-6), 'A', 3), tone: state.blown ? 'bad' : undefined },
          { label: 'Toward melting', value: state.blown ? 'Blown' : `${Math.round(100 * state.heat)} %`, tone: state.blown ? 'bad' : state.heat > 0.8 ? 'warn' : 'ok' },
          { label: 'Blows after', value: secs(s.t), tone: Number.isFinite(s.t) ? 'warn' : 'ok' },
          { label: `Time (${SLOW1}× slow)`, value: si(Math.max(state.t, 1e-4), 's', 3) },
        ]
      },
    }
  },
}

// --- Reverse-polarity protection: a series diode blocks a backwards battery but costs a volt; a P-MOSFET costs millivolts. ---

const VB = 7.4
const L2 = -14
const C2 = -5.5
const X2 = 5
const H2 = 4.5
const M2 = -1.6
const FET_SCALE = 1.1
const K2 = 0.75 * FET_SCALE
const GATE: V3 = [C2 - K2, H2 - 5.94 * K2, 0]
const IC_Y = (M2 - H2) / 2
const GUARDS: Guard[] = ['none', 'diode', 'pfet']

const solveGuard = (p: Params) => {
  const guard: Guard = GUARDS.includes(p.guard as Guard) ? (p.guard as Guard) : 'diode'
  const vb = p.battery === 'backwards' ? -VB : VB
  const loadOhms = VB / n(p, 'amps')
  return { guard, vb, loadOhms, ...reverseGuard(vb, loadOhms, guard) }
}

export const reversePolarity: Lesson = {
  id: 'fuses-protection-reverse-polarity-protection',
  title: 'Reverse-polarity protection',
  tagline: 'When the battery goes in backwards',
  formula: (p) => {
    const s = solveGuard(p)
    const loss = `P = ${volts(s.guardV)} × ${si(s.amps, 'A', 3)} = ${si(s.guardV * s.amps, 'W', 2)}`
    if (s.guard === 'none') return s.vb < 0 ? `Substrate diodes short the cell: I = −(V − Vd) / R_batt = ${si(s.amps, 'A', 2)}` : `No guard: the circuit gets all ${volts(s.vLoad)}`
    if (s.vb < 0) return `Reversed: ${s.guard === 'diode' ? 'the diode' : 'the body diode'} blocks, I = ${si(tiny(s.amps, 1e-12), 'A', 2)}`
    if (s.guard === 'diode') return `Series diode: Vload = V − Vd = ${volts(VB)} − ${volts(s.guardV)} ≈ ${volts(s.vLoad)} · ${loss}`
    return `Rds(on) = 1 / (k·(|Vgs| − Vth)) = ${si(rdsOn(VB, IRF4905), 'Ω', 2)} · P = I²·Rds = ${si(s.guardV * s.amps, 'W', 2)}`
  },
  legend: [
    { color: RING, label: 'Voltage at the circuit, V', shape: 'dot' },
    { color: '#e8e8e8', label: 'Drop across the guard, V', shape: 'dot' },
    { color: HEAT, label: 'Heat in the guard', shape: 'dot' },
    { color: HIGH_V, label: 'Wires by potential (blue = negative)', shape: 'dot' },
  ],
  points: [
    'Packs get plugged in backwards. With no guard the circuit gets −7.4 V, and every chip’s substrate (ESD) diodes from ground to supply conduct straight across the battery: tens of amps, then smoke.',
    'The simplest guard is one diode in series. Backwards it blocks. Forwards it costs its drop, ~0.9 V for a 1N4007 at 1 A: 0.9 W of heat and 0.9 V the circuit never sees. A Schottky halves it.',
    'Better: a P-MOSFET in the + line, drain to the battery, gate to ground. Plugged in right, its body diode lifts the source, Vgs ≈ −7.4 V turns the channel fully on: ~30 mΩ, millivolts lost.',
    'Backwards, the gate sits above the source, the channel stays off and the body diode points the wrong way. Nothing flows.',
    'Real boards add a gate resistor, and a zener from gate to source on packs over ~20 V, the gate’s limit.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'guard',
      options: [
        { value: 'none', label: 'No guard' },
        { value: 'diode', label: 'Diode' },
        { value: 'pfet', label: 'P-MOSFET' },
      ],
      initial: 'diode',
    },
    {
      kind: 'choice',
      key: 'battery',
      options: [
        { value: 'right', label: 'Right way' },
        { value: 'backwards', label: 'Backwards' },
      ],
      initial: 'right',
    },
    { kind: 'slider', key: 'amps', label: 'Load current', min: 0.1, max: 3, initial: 1, step: 0.1, format: (v) => si(v, 'A', 2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const battery = add(scene, cell(CELL_H, 1.5), [L2, 0, 0])
    wire(scene, [[C2, H2, 0], [L2, H2, 0], [L2, -H2, 0], [X2, -H2, 0], [X2, M2, 0], [C2, M2, 0]])
    add(scene, icPackage(4, 2.4, 4), [X2, IC_Y, 0])
    const burn = glowHalo(scene, [X2, IC_Y, 1], 1.6)
    const fumes = smoke(scene, 2, { count: 20, rise: 6 })
    fumes.group.position.set(X2, IC_Y + 1.4, 0)
    const holder = add(scene, new THREE.Group())
    const waves = heatWaves(scene, 1.4, { count: 4, rise: 2.6 })
    waves.group.position.set(C2 + 1.6, H2 - 2.6, 0)
    const loadLabel = pulseLabel(scene, 4, RING, [X2, M2 + 2, 0], 1.2)
    const dropLabel = pulseLabel(scene, 4, '#e8e8e8', [C2 - 3.6, (H2 + M2) / 2, 0], 1.1)

    const state = { guard: '', vb: VB, vLoad: 0, amps: 0, guardV: 0, cooked: 0 }
    let diode: ReturnType<typeof diodeAlong> | null = null
    let fet: ReturnType<typeof fetPart> | null = null
    const f = (v: number) => 0.5 + v / (2 * VB)
    const flow = plusFlow(
      scene,
      lane([[L2, -H2, 0], [L2, H2, 0], [C2, H2, 0], [C2, M2, 0], [X2, M2, 0], [X2, -H2, 0]]),
      (at) => {
        const top = state.vLoad + state.guardV
        if (at.y <= -H2 + 0.01) return f(0)
        if (at.x <= L2 + 0.01) return f(state.vb * cellFraction(at.y))
        if (at.y >= H2 - 0.01) return f(top)
        if (at.x <= C2 + 0.01) return f(lerp(top, state.vLoad, (H2 - at.y) / (H2 - M2)))
        if (at.y >= M2 - 0.01) return f(state.vLoad)
        return f(state.vLoad * clamp01((at.y + H2) / (M2 + H2)))
      },
      true,
    )
    return {
      scene,
      view: { center: [-3.4, 1.2, 0], radius: 50, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveGuard(p)
        if (s.guard !== state.guard) {
          state.guard = s.guard
          emptyGroup(holder)
          diode = fet = null
          if (s.guard === 'none') wire(holder, [[C2, H2, 0], [C2, M2, 0]])
          if (s.guard === 'diode') diode = diodeAlong(holder, [C2, H2, 0], [C2, M2, 0], { scale: 2.2 })
          if (s.guard === 'pfet') {
            fet = fetPart(holder, GATE, 'TO-220', { scale: FET_SCALE })
            const { s: src, g } = fet.pins
            wire(holder, [src, [src[0], M2, 0]])
            wire(holder, [g, [g[0], -H2, 0]])
          }
        }
        state.vb += (s.vb - state.vb) * ease(dt, 3)
        battery.rotation.z = (Math.PI * (VB - state.vb)) / (2 * VB)
        const r = reverseGuard(state.vb, s.loadOhms, s.guard)
        state.vLoad = r.vLoad
        state.amps = r.amps
        state.guardV = r.guardV
        const heat = r.guardV * r.amps
        const shorted = s.guard === 'none' && r.amps < -1
        state.cooked += ((shorted ? 1 : 0) - state.cooked) * ease(dt, shorted ? 2 : 0.5)
        burn.set(1.4 * state.cooked, HIGH_V)
        fumes.step(dt, state.cooked)
        waves.step(dt, s.guard === 'none' ? 0 : clamp01(heat / 1.5))
        diode?.set(r.amps > 1e-3 ? clamp01(r.amps / 2) : -clamp01(-state.vb / VB))
        fet?.set(clamp01(r.amps / 3), clamp01(heat / 3))
        flow.step(dt * 3 * Math.max(-4, r.amps))
        loadLabel.show(fitDigits(tiny(r.vLoad, 1e-3), 4))
        dropLabel.show(fitDigits(tiny(r.guardV, 1e-3), 4))
        loadLabel.frame(dt)
        dropLabel.frame(dt)
      },
      readouts: () => {
        const heat = state.guardV * state.amps
        return [
          { label: 'Circuit gets', value: volts(tiny(state.vLoad, 1e-3)), tone: state.vLoad < -0.5 ? 'bad' : 'ok' },
          { label: 'Current', value: si(tiny(state.amps, 1e-9), 'A', 3), tone: state.amps < -1 ? 'bad' : undefined },
          { label: 'Guard drop', value: volts(tiny(state.guardV, 1e-4)) },
          { label: 'Guard heat', value: si(Math.abs(heat) < 1e-6 ? 0 : heat, 'W', 2), tone: heat > 1 ? 'warn' : undefined },
        ]
      },
    }
  },
}

// --- TVS diode: a surge on the rail; the TVS breaks down past its standoff and clamps the spike. ---

const V_RAIL = 12
const R_SRC = 2
const R_CHIP = 100
const ABS_MAX = 30
const SPIKE_MAX = 60
const FULL3 = 80
const PERIOD = 100e-6
const WINDOW3 = 60e-6
const START = 10e-6
const SLOW3 = 40000
const L3 = -15
const T3 = -7.8
const X3 = -3
const H3 = 4.5
const D3 = 2.2
const S3: V3 = [6.4, 0.4, 0]
const S3_W = 11
const S3_H = 8

const solveTvs = (p: Params) => {
  const fitted = p.tvs !== 'off'
  const spike = n(p, 'spike')
  const peak = tvsNode(V_RAIL + spike, R_SRC, R_CHIP, fitted)
  return { fitted, spike, peak, bare: tvsNode(V_RAIL + spike, R_SRC, R_CHIP, false).v }
}
const railAt = (spike: number, t: number) => V_RAIL + spike * surge((((t % PERIOD) + PERIOD) % PERIOD) - START)

export const tvsDiode: Lesson = {
  id: 'fuses-protection-tvs-diode',
  title: 'TVS diode',
  tagline: 'Swallowing the spike',
  formula: (p) => {
    const s = solveTvs(p)
    const head = `Peak: ${volts(V_RAIL)} + ${volts(s.spike)} through ${R_SRC} Ω`
    if (!s.fitted) return `${head} → chip sees ${volts(s.bare)} (rated ${ABS_MAX} V)`
    return `${head} → TVS takes ${si(s.peak.tvsA, 'A', 3)}, clamps at ${volts(s.peak.v)} (bare: ${volts(s.bare)})`
  },
  legend: [
    { color: RING, label: 'Rail at the chip', shape: 'dot' },
    { color: GREY, label: 'Same spike, no TVS', shape: 'dot' },
    { color: HIGH_V, label: 'Chip’s 30 V limit; wires by potential', shape: 'dot' },
    { color: CONVENTIONAL, label: 'TVS current, A', shape: 'dot' },
  ],
  points: [
    'Spikes ride in on cables: a motor switching off, static on a long lead, a nearby lightning surge. A few microseconds at tens of volts punch through a chip rated 30 V.',
    'A TVS (transient voltage suppressor) is a rugged zener made to break down fast and swallow big pulses. Wired band-up from the rail to ground, it waits.',
    'At 12 V it sits under its 12.8 V standoff and leaks microamps. When a spike pushes the rail past ~15 V it conducts tens of amps and holds the rail near 21 V, its clamp voltage, until the pulse passes.',
    'Pick one whose standoff is above the normal rail and whose clamp is below what the chip survives. Here an 8/20 µs surge from a 2 Ω source, slowed 40 000×.',
    'The pulse ends as heat in the TVS: a P6KE takes 600 W for a millisecond. Keep hitting it and it fails short, so put a fuse in front.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'tvs',
      options: [
        { value: 'on', label: 'TVS fitted' },
        { value: 'off', label: 'No TVS' },
      ],
      initial: 'on',
    },
    { kind: 'slider', key: 'spike', label: 'Spike', min: 0, max: SPIKE_MAX, initial: 40, step: 1, format: volts },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    wire(scene, [[L3, H3, 0], [X3, H3, 0], [X3, -H3, 0], [L3, -H3, 0], [L3, H3, 0]])
    add(scene, cell(CELL_H, 1.5), [L3, 0, 0])
    add(scene, icPackage(3, 2.6, 4), [X3, 0, 0])
    const branch = add(scene, new THREE.Group(), [T3, 0, 0])
    wire(branch, [[0, H3, 0], [0, -H3, 0]])
    const tvs = diodeAlong(branch, [0, -D3, 0], [0, D3, 0], { scale: 2.4 })
    const strike = arcSpark(scene, [L3 + 2.5, H3 + 1.2, 0])
    const fumes = smoke(scene, 2, { count: 20, rise: 6 })
    fumes.group.position.set(X3, 1.6, 0)
    const burn = glowHalo(scene, [X3, 0, 1], 1.6)
    const vLabel = pulseLabel(scene, 3, RING, [X3 + 0.2, H3 + 1.8, 0], 1.3)
    const iLabel = pulseLabel(branch, 3, CONVENTIONAL, [-3, -1.4, 0], 1)

    const plot = scope(scene, S3_W, S3_H, { divs: [6, 8], zeroAt: 0 })
    plot.group.position.set(...S3)
    ticks(plot, [], [[V_RAIL / FULL3, '12'], [ABS_MAX / FULL3, '30'], [1, '80']])
    const vy = (v: number) => (v / FULL3) * S3_H - S3_H / 2
    const bare = plot.trace(GREY, { radius: 0.08 })
    const live = plot.trace(RING, { radius: 0.12 })
    plot.level(HIGH_V).set(vy(ABS_MAX))

    const state = { key: '', t: 0, show: 1, v: V_RAIL, tvsA: 0, loadA: 0, fried: false, smoke: 0 }
    const f = (v: number) => v / FULL3
    const paint = (at: THREE.Vector3) => {
      if (at.y <= -H3 + 0.01) return 0
      if (at.x <= L3 + 0.01) return f(state.v) * cellFraction(at.y)
      if (at.y >= H3 - 0.01) return f(state.v)
      if (at.x >= X3 - 0.01) return f(state.v) * clamp01((at.y + 1.3) / 2.6)
      return f(state.v) * clamp01((at.y + D3) / (2 * D3))
    }
    const supply = plusFlow(scene, lane([[T3, -H3, 0], [L3, -H3, 0], [L3, H3, 0], [T3, H3, 0]]), paint)
    const chipFlow = plusFlow(scene, lane([[T3, H3, 0], [X3, H3, 0], [X3, -H3, 0], [T3, -H3, 0]]), paint)
    const tvsFlow = plusFlow(scene, lane([[T3, H3, 0], [T3, -H3, 0]]), paint)
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const s = solveTvs(p)
        const key = `${s.fitted}|${s.spike}`
        if (key !== state.key) {
          state.key = key
          state.fried = false
        }
        state.t += dt / SLOW3
        state.show += ((s.fitted ? 1 : 0) - state.show) * ease(dt, 7)
        presence(branch, state.show)
        tvsFlow.mesh.visible = state.show > 0.5
        const vs = railAt(s.spike, state.t)
        const r = tvsNode(vs, R_SRC, R_CHIP, s.fitted)
        state.v = r.v
        state.tvsA = r.tvsA
        state.loadA = r.loadA
        if (r.v > ABS_MAX) state.fried = true
        const hit = (vs - V_RAIL) / SPIKE_MAX
        strike.set([L3 + 2.5, H3 + 2.6, 0], [L3 + 2.5, H3 + 0.3, 0], hit > 0.05 ? hit : 0)
        state.smoke += ((state.fried ? 1 : 0) - state.smoke) * ease(dt, 1.5)
        fumes.step(dt, state.smoke)
        burn.set(r.v > ABS_MAX ? 1.6 : 0.5 * state.smoke, HIGH_V)
        tvs.set(r.tvsA > 0.01 ? clamp01(r.tvsA / 15) : -0.6)
        supply.step(dt * 20 * Math.min(0.6, r.loadA + r.tvsA))
        chipFlow.step(dt * 20 * Math.min(0.6, r.loadA))
        tvsFlow.step(dt * 20 * Math.min(0.6, r.tvsA))
        bare.scroll((t) => vy(tvsNode(railAt(s.spike, t), R_SRC, R_CHIP, false).v), state.t, WINDOW3)
        live.scroll((t) => vy(tvsNode(railAt(s.spike, t), R_SRC, R_CHIP, s.fitted).v), state.t, WINDOW3)
        vLabel.show(fitDigits(r.v, 3))
        iLabel.show(fitDigits(r.tvsA, 3))
        vLabel.frame(dt)
        iLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveTvs(p)
        return [
          { label: 'Chip sees', value: volts(state.v) },
          { label: 'Peak at chip', value: volts(s.peak.v), tone: s.peak.v > ABS_MAX ? 'bad' : 'ok' },
          { label: 'TVS current', value: si(tiny(state.tvsA, 1e-7), 'A', 3) },
          { label: 'Chip', value: state.fried ? 'Fried' : 'Safe', tone: state.fried ? 'bad' : 'ok' },
        ]
      },
    }
  },
}
