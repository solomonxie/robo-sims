import * as THREE from 'three/webgpu'
import {
  Bounce,
  bounces,
  coaxZ0,
  criticalLength,
  launchVolts,
  lineDelay,
  lineVolts,
  oneTwoFive,
  pulseShape,
  rampShape,
  reflection,
  settleTime,
  settledVolts,
  twinZ0,
  velocityFactor,
} from '../../core/physics'
import { ohms, pct, secs, si, volts } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh, rod, tube } from '../../models/kit'
import { buildEsp32 } from '../../models/modules'
import { createStage } from '../../scene/stage'
import {
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  POWER,
  RING,
  UNIT_ROD,
  addLabel,
  benchScope,
  cableRun,
  emptyGroup,
  glowMat,
  junction,
  lieFlat,
  liveLabel,
  potentialColor,
  resistorAlong,
  scope,
  sg90Servo,
  stretchRod,
  wire,
} from '../fx'
import { Lesson, Params, Stage, pick } from '../types'

const signed = (g: number) => (Math.abs(g) < 0.005 ? '0.00' : `${g >= 0 ? '+' : '−'}${Math.abs(g).toFixed(2)}`)
const zText = (z: number) => (z === Infinity ? '∞' : ohms(z))

const CABLES = {
  coax: { name: 'Coax RG-58', short: 'Coax', z0: coaxZ0(2.84, 0.81, 2.25), vf: velocityFactor(2.25) },
  pair: { name: 'Twisted pair', short: 'Twisted pair', z0: twinZ0(0.92, 0.51, 2), vf: velocityFactor(2) },
  jumper: { name: 'Jumper pair', short: 'Jumpers', z0: twinZ0(4, 0.64, 1.2), vf: velocityFactor(1.2) },
}
type CableKind = keyof typeof CABLES

const BINS = 48
/** A long cable from x0 to x1 at height y, cut into bins whose glow shows the line voltage there; `glow(v, vmax)` takes v(u), u = 0 … 1. */
function cableBody(parent: THREE.Object3D, kind: CableKind, x0: number, x1: number, y: number) {
  const group = add(parent, new THREE.Group())
  const base = { coax: '#25272c', pair: '#d8752c', jumper: '#c8322c' }[kind]
  const mats = Array.from({ length: BINS }, () => new THREE.MeshStandardMaterial({ color: base, roughness: 0.55, emissive: '#000000' }))
  const plain = mat(kind === 'pair' ? '#e8e4da' : '#1f2024', { rough: 0.55 })
  const xAt = (u: number) => x0 + u * (x1 - x0)
  const curve = (u: number, wireNo: number): V3 => {
    const x = xAt(u)
    if (kind === 'pair') {
      const a = u * 26 * Math.PI + wireNo * Math.PI
      return [x, y + 0.32 * Math.cos(a), 0.32 * Math.sin(a)]
    }
    const gap = 0.55 + 0.35 * Math.sin(u * 17 + 1) + 0.2 * Math.sin(u * 41)
    return [x, y + (wireNo ? -gap : gap) * 0.5, 0.25 * Math.sin(u * 23 + wireNo)]
  }
  for (let i = 0; i < BINS; i++) {
    const u0 = i / BINS
    const u1 = (i + 1) / BINS
    if (kind === 'coax') {
      rod(group, [xAt(u0), y, 0], [xAt(u1) + 0.02, y, 0], 0.55, mats[i], 16)
      continue
    }
    for (const w of [0, 1]) {
      const pts = Array.from({ length: 7 }, (_, s) => curve(u0 + ((u1 - u0) * s) / 6, w))
      tube(group, pts, kind === 'pair' ? 0.17 : 0.2, w === 0 ? mats[i] : plain, 6)
    }
  }
  const tint = new THREE.Color()
  return {
    group,
    /** Where each conductor leaves the cable at u = 0 or 1. */
    ends: (u: 0 | 1): [V3, V3] => (kind === 'coax' ? [[xAt(u), y, 0], [xAt(u), y, 0]] : [curve(u, 0), curve(u, 1)]),
    glow(v: (u: number) => number, vmax: number) {
      mats.forEach((m, i) => {
        const f = v((i + 0.5) / BINS) / vmax
        m.emissive.copy(potentialColor(0.5 + f / 2, tint))
        m.emissiveIntensity = Math.min(1.8, Math.abs(f) * 1.8)
      })
    },
  }
}

// --- Reflections: a pulse runs down 10 m of cable and comes back from the far end with Γ = (ZL − Z0)/(ZL + Z0). ---

const LEN1 = 10
const VS1 = 5
const RS1 = 50
const LOADS = { open: Infinity, short: 0, r50: 50, r100: 100 }
const LOAD_NAMES = { open: 'Open', short: 'Short', r50: '50 Ω', r100: '100 Ω' }
const LEGS = 5
const PER_TD = 0.9
const WIDTH1 = 0.3
const X0 = -13
const X1 = 13
const W1 = X1 - X0
const CY = 1.2
const LAT_H = 8.5
const LAT_TOP = -1.6
const PLOT_H = 6.4
const PLOT_Y = CY + 5.6
const VMAX1 = 10

const reflOf = (p: Params) => {
  const kind = pick(CABLES, p.cable, 'coax')
  const load = pick(LOADS, p.load, 'open')
  const c = CABLES[kind]
  const zl = LOADS[load]
  return {
    kind,
    load,
    c,
    zl,
    gl: reflection(zl, c.z0),
    gs: reflection(RS1, c.z0),
    v1: launchVolts(VS1, RS1, c.z0),
    td: lineDelay(LEN1, c.vf),
    legs: bounces(VS1, RS1, c.z0, zl, LEGS + 1),
  }
}

/** Open, short or a resistor across the far end; returns the two terminals. */
function farEnd(holder: THREE.Group, load: keyof typeof LOADS, zl: number, ends: [V3, V3]) {
  emptyGroup(holder)
  const s: V3 = [X1 + 2.2, CY + 1.3, 0]
  const r: V3 = [X1 + 2.2, CY - 1.3, 0]
  wire(holder, [ends[0], [s[0] - 0.6, s[1], 0], s], 0.12)
  wire(holder, [ends[1], [r[0] - 0.6, r[1], 0], r], 0.12)
  for (const t of [s, r]) junction(holder, t, 0.3)
  if (load === 'short') wire(holder, [s, [s[0] + 0.7, s[1], 0], [r[0] + 0.7, r[1], 0], r], 0.16)
  else if (load !== 'open') resistorAlong(holder, zl, [s[0] + 0.3, s[1] - 0.3, 0], [r[0] + 0.3, r[1] + 0.3, 0], 0.95)
}

export const reflections: Lesson = {
  id: 'transmission-lines-reflections',
  title: 'Reflections',
  tagline: 'A pulse runs down the cable and the far end decides what comes back',
  formula: (p) => {
    const s = reflOf(p)
    const z0 = ohms(s.c.z0)
    const sum = s.zl === Infinity ? `ZL = ∞ → Γ = +1` : `Γ = (${zText(s.zl)} − ${z0}) / (${zText(s.zl)} + ${z0}) = ${signed(s.gl)}`
    return `Γ = (ZL − Z0) / (ZL + Z0) · ${sum} · echo = Γ × ${volts(s.v1)}`
  },
  legend: [
    { color: HIGH_V, label: 'Positive pulse on the line', shape: 'dot' },
    { color: LOW_V, label: 'Inverted (negative) pulse', shape: 'dot' },
    { color: RING, label: 'Now, on the bounce diagram', shape: 'dot' },
  ],
  points: [
    'A signal doesn’t reach the end of a wire instantly: it travels as a wave at v = c / √εr, about two thirds of light speed in coax, 5 ns per metre.',
    'While it travels, the wave only sees the cable’s characteristic impedance Z0, set by geometry: coax 60/√εr · ln(D/d) ≈ 50 Ω, twisted pair ≈ 100 Ω, two loose jumper wires ≈ 280 Ω.',
    'At the far end the load decides: open (ZL = ∞) sends the pulse back as it was, Γ = +1; a short sends it back inverted, Γ = −1; a resistor equal to Z0 swallows it, Γ = 0.',
    'The bounce diagram below the cable is the same story in time: each slanted line is one trip, labelled with the volts it carries; matched ends stop the zig-zag.',
    'The generator has 50 Ω inside, so on coax echoes die when they return. On twisted pair or jumpers the source end reflects too and the pulse rattles back and forth.',
    `Slowed ${(PER_TD / 50e-9).toExponential(0).replace('e+', ' × 10^')}: one 10 m trip (≈ 50 ns) takes ${PER_TD} s.`,
  ],
  controls: [
    { kind: 'choice', key: 'cable', options: (Object.keys(CABLES) as CableKind[]).map((k) => ({ value: k, label: CABLES[k].short })), initial: 'coax' },
    { kind: 'choice', key: 'load', options: (Object.keys(LOADS) as (keyof typeof LOADS)[]).map((k) => ({ value: k, label: LOAD_NAMES[k] })), initial: 'open' },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const bodies = (Object.keys(CABLES) as CableKind[]).map((k) => ({ k, body: cableBody(scene, k, X0, X1, CY) }))

    const gen = add(scene, new THREE.Group(), [X0 - 4.6, CY, 0])
    box(gen, [5, 4.4, 3], mat('#2b2e35', { rough: 0.55 }), [0, 0, -0.6])
    box(gen, [4.2, 1.2, 0.2], mat('#0b1013', { emissive: '#050a0a' }), [0, 1.1, 0.95])
    addLabel(gen, 'PULSE', [0, 1.1, 1.1], RING, 0.5)
    addLabel(gen, 'Rs 50 Ω', [0, -0.4, 1], LABEL, 0.45)
    const lampMat = glowMat(GREY, 0.2)
    add(gen, mesh(new THREE.SphereGeometry(0.3, 12, 8), lampMat), [-1.4, -1.5, 1])
    const out: V3 = [X0 - 1.6, CY, 0.4]
    cylinder(scene, 0.7, 1.2, mat('#b9bec6', { metal: 0.4, rough: 0.4 }), [X0 - 1.6, CY, 0], 'x', 20)
    addLabel(scene, 'GEN', [X0 - 4.6, CY + 3.1, 0], LABEL, 0.55)
    const cableName = liveLabel(scene, [0, CY - 1.15, 0.8], { size: 0.42 })
    const loadName = liveLabel(scene, [X1 + 2.2, CY + 3.1, 0], { size: 0.5 })
    for (const { body } of bodies) {
      const [a, b] = body.ends(0)
      wire(body.group, [out, [X0 - 0.6, a[1], a[2]], a], 0.1)
      wire(body.group, [out, [X0 - 0.6, b[1], b[2]], b], 0.1)
    }
    const coaxEnds = bodies[0].body.ends(1)
    const holder = add(scene, new THREE.Group())

    const plot = scope(scene, W1, PLOT_H, { divs: [10, 8] })
    plot.group.position.set((X0 + X1) / 2, PLOT_Y, 0)
    const trace = plot.trace(HIGH_V, { samples: 200, radius: 0.09 })
    addLabel(scene, 'VOLTS ALONG THE CABLE · 2.5 V/DIV', [X0 - 0.6, PLOT_Y + PLOT_H / 2 + 1, 0], LABEL, 0.45, 'left')

    const latMid = LAT_TOP - LAT_H / 2
    box(scene, [W1 + 1.2, LAT_H + 1.2, 0.3], mat('#14171b', { rough: 0.6 }), [(X0 + X1) / 2, latMid, -0.6])
    for (const x of [X0, X1]) rod(scene, [x, LAT_TOP + 0.3, -0.35], [x, LAT_TOP - LAT_H - 0.3, -0.35], 0.05, mat('#46645a', { emissive: '#1a2a24' }))
    const yAt = (t: number) => LAT_TOP - (t / LEGS) * LAT_H
    const xAt = (u: number) => X0 + u * W1
    const legs = Array.from({ length: LEGS }, () => {
      const m = add(scene, mesh(UNIT_ROD, glowMat(HIGH_V, 1)))
      m.castShadow = false
      return { m, tag: liveLabel(scene, [0, 0, 0.3], { size: 0.42 }) }
    })
    const ticks = [0, 2, 4].map((k) => liveLabel(scene, [X0 - 0.8, yAt(k), 0], { size: 0.4, align: 'right' }))
    const cursor = add(scene, mesh(new THREE.BoxGeometry(W1, 0.07, 0.07), glowMat(RING, 0.9)))
    cursor.castShadow = false
    const now = liveLabel(scene, [X1 + 0.8, 0, 0], { size: 0.45, align: 'left' })

    const st = { key: '', t: 0 }
    const end = LEGS + 0.2
    return {
      scene,
      view: { center: [-0.4, 1.2, 0], radius: 66, polar: 1.42, azimuth: 0.06 },
      frame(dt, p) {
        const s = reflOf(p)
        const key = `${s.kind}|${s.load}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          for (const { k, body } of bodies) body.group.visible = k === s.kind
          const ends = s.kind === 'coax' ? coaxEnds : bodies.find((b) => b.k === s.kind)!.body.ends(1)
          farEnd(holder, s.load, s.zl, ends)
          cableName.set(`${LEN1} M ${CABLES[s.kind].name.toUpperCase()} · Z0 ${ohms(s.c.z0)} · v ${s.c.vf.toFixed(2)}c`, LABEL)
          loadName.set(`${LOAD_NAMES[s.load].toUpperCase()} · Γ ${signed(s.gl)}`, Math.abs(s.gl) < 0.05 ? POWER : HEAT)
          ticks.forEach((l, i) => l.set(i ? secs(i * 2 * s.td) : '0', GREY))
        }
        st.t += dt / PER_TD
        if (st.t > end + 1.2 / PER_TD) st.t = 0
        const t = Math.min(st.t, end)
        const shape = pulseShape(WIDTH1, 0.04)
        const v = (u: number) => lineVolts(u, t, s.legs, shape)
        trace.draw((u) => (v(u) / VMAX1) * (PLOT_H / 2), null)
        for (const { k, body } of bodies) if (k === s.kind) body.glow(v, VS1 * 0.6)
        lampMat.color.set(t < WIDTH1 ? RING : GREY)
        lampMat.emissive.set(t < WIDTH1 ? RING : GREY)
        lampMat.emissiveIntensity = t < WIDTH1 ? 1.4 : 0.15
        legs.forEach((leg, k) => {
          const b: Bounce = s.legs[k]
          const shown = t > b.k && Math.abs(b.amp) > 0.02
          leg.m.visible = shown
          leg.tag.set(shown && t > b.k + 0.35 ? `${b.amp >= 0 ? '+' : '−'}${Math.abs(b.amp).toFixed(2)} V` : '', b.amp >= 0 ? HIGH_V : LOW_V)
          if (!shown) return
          const u0 = b.forward ? 0 : 1
          const f = Math.min(1, t - b.k)
          const u1 = u0 + (b.forward ? f : -f)
          stretchRod(leg.m, [xAt(u0), yAt(b.k), 0], [xAt(u1), yAt(b.k + f), 0], 0.1)
          const m = leg.m.material as THREE.MeshStandardMaterial
          const c = b.amp >= 0 ? HIGH_V : LOW_V
          m.color.set(c)
          m.emissive.set(c)
          m.emissiveIntensity = 0.4 + Math.min(1, Math.abs(b.amp) / s.v1)
          leg.tag.group.position.set(xAt(0.5), yAt(b.k + 0.5) + 0.6, 0.3)
        })
        cursor.position.set((X0 + X1) / 2, yAt(t), 0.1)
        now.group.position.y = yAt(t)
        now.set(`t ${secs(t * s.td)}`, RING)
      },
      readouts: (p) => {
        const s = reflOf(p)
        const tone = (g: number) => (Math.abs(g) < 0.05 ? 'ok' : Math.abs(g) < 0.5 ? 'warn' : 'bad')
        return [
          { label: 'Cable', value: `Z0 ${ohms(s.c.z0)} · v = ${s.c.vf.toFixed(2)} c` },
          { label: 'Far end Γ', value: `${signed(s.gl)} (${zText(s.zl)})`, tone: tone(s.gl) },
          { label: 'Source end Γ', value: `${signed(s.gs)} (50 Ω gen)`, tone: tone(s.gs) },
          { label: 'One-way delay', value: `${secs(s.td)} for ${LEN1} m` },
        ]
      },
    }
  },
}

// --- Termination: a fast GPIO edge down long jumper wires rings at the open servo input; a series resistor at the driver fixes it. ---

const VDD = 3.3
const RDRV = 30
const RISE = 2e-9
const JUMP = CABLES.jumper
const LENGTHS = { '0.1': 0.1, '1': 1, '2': 2 }
const LENGTH_NAMES = { '0.1': '10 cm', '1': '1 m', '2': '2 m' }
const SERIES = { '0': 0, '33': 33, '100': 100, '220': 220, '470': 470 }
const SAMPLES = 400
const REVEAL2 = 2.4
const HOLD2 = 1.2
const SW = 15
const SH = 11
const ZERO = 0.25
const SC: V3 = [1, 8, 0]
const WY = -5.6
const WX0 = -8
const WX1 = 11
const ESP: V3 = [-17, WY - 0.4, 0]
const K = 0.5
const espPin = (x: number): V3 => [ESP[0] + x * K, ESP[1] + 5 * K, ESP[2] + 3.8 * K]

const termOf = (p: Params) => {
  const len = pick(LENGTHS, p.len, '1')
  const ser = pick(SERIES, p.rs, '0')
  const rs = SERIES[ser]
  const meters = LENGTHS[len]
  const td = lineDelay(meters, JUMP.vf)
  const tdiv = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => oneTwoFive(i, 1e-9)).find((d) => d >= 2.4 * td) ?? 100e-9
  const window = tdiv * 10
  const legs = bounces(VDD, RDRV + rs, JUMP.z0, Infinity, Math.ceil(window / td) + 2)
  const shape = rampShape(RISE / td)
  const dt = window / (SAMPLES - 1)
  const atLoad = Array.from({ length: SAMPLES }, (_, i) => lineVolts(1, (i * dt) / td, legs, shape))
  const peak = Math.max(...atLoad)
  const iPeak = atLoad.indexOf(peak)
  const dip = Math.min(...atLoad.slice(iPeak))
  const settle = settleTime(atLoad, dt, VDD)
  return { len, ser, rs, meters, td, tdiv, window, legs, shape, dt, atLoad, peak, dip, settle, gs: reflection(RDRV + rs, JUMP.z0) }
}

export const termination: Lesson = {
  id: 'transmission-lines-termination',
  title: 'Termination',
  tagline: 'A fast edge on long robot wiring rings; a resistor at the driver calms it',
  formula: (p) => {
    const s = termOf(p)
    return `Γsource = (Rdrv + R − Z0) / (Rdrv + R + Z0) = (${RDRV} + ${s.rs} − ${Math.round(JUMP.z0)}) / (${RDRV + s.rs + Math.round(JUMP.z0)}) = ${signed(s.gs)} · best R = Z0 − Rdrv ≈ ${Math.round(JUMP.z0 - RDRV)} Ω`
  },
  legend: [
    { color: RING, label: 'Servo input voltage (scope CH1)', shape: 'dot' },
    { color: POWER, label: '3.3 V: where it should settle', shape: 'dot' },
    { color: HIGH_V, label: 'Wavefront on the signal wire', shape: 'dot' },
  ],
  points: [
    'An ESP32 GPIO switches in about 2 ns. On a jumper pair that’s 1 m long the edge takes 3.7 ns each way, longer than the edge itself, so the wire behaves as a transmission line.',
    'The servo’s input is a CMOS gate: almost open, Γ ≈ +1. The edge arrives, doubles, and heads back to the GPIO, whose ~30 Ω output is nearly a short to a 280 Ω line, Γ ≈ −0.8. It bounces again, inverted.',
    'The result is ringing: overshoot past 3.3 V, a dip back down, repeating every 4 trips. Real input clamp diodes cut the peaks off by dumping current into the servo’s supply; the dips can cross the logic threshold and count as extra edges.',
    'Series termination: a resistor right at the driver so Rdrv + R = Z0. Half the step goes out, doubles at the open end to exactly 3.3 V, and the echo is absorbed when it returns. One clean edge.',
    'Too big (470 Ω) and the edge climbs in steps instead, slow but no overshoot. Too short a wire (10 cm) and the bounces are faster than the edge: no ringing to fix.',
    `Rule of thumb: worry when the wire is longer than about a sixth of the edge’s length, ${si(criticalLength(RISE, JUMP.vf), 'm', 2)} here. Slowed about 10^8×.`,
  ],
  controls: [
    { kind: 'choice', key: 'rs', options: (Object.keys(SERIES) as (keyof typeof SERIES)[]).map((k) => ({ value: k, label: `${k} Ω` })), initial: '0' },
    { kind: 'choice', key: 'len', options: (Object.keys(LENGTHS) as (keyof typeof LENGTHS)[]).map((k) => ({ value: k, label: LENGTH_NAMES[k] })), initial: '1' },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const bench = benchScope(scene, SW, SH, { divs: [10, 8], zeroAt: ZERO })
    bench.group.position.set(...SC)
    const screen = bench.screen
    const yOf = (v: number) => (ZERO + v / 8) * SH - SH / 2
    const trace = screen.trace(RING, { samples: 240, radius: 0.1 })
    screen.level(POWER).set(yOf(VDD))
    addLabel(screen.group, '3.3 V', [SW / 2 - 1, yOf(VDD) + 0.5, 0.3], POWER, 0.4)

    add(scene, lieFlat(buildEsp32(), K), ESP)
    addLabel(scene, 'ESP32 GPIO · 30 Ω', [ESP[0], ESP[1] + 4.6, 0], LABEL, 0.5)
    const body = cableBody(scene, 'jumper', WX0, WX1, WY)
    const [sig0, gnd0] = body.ends(0)
    const [sig1, gnd1] = body.ends(1)
    const pin = espPin(7)
    const rA: V3 = [WX0 - 4.4, sig0[1], sig0[2]]
    const rB: V3 = [WX0 - 1.2, sig0[1], sig0[2]]
    cableRun(scene, [pin, [pin[0] + 0.3, pin[1] + 0.6, pin[2]], [rA[0] - 0.6, rA[1], rA[2] + 0.4], rA], '#c8322c', 0.14)
    wire(scene, [rB, sig0], 0.1)
    const gp = espPin(5)
    cableRun(scene, [gp, [gp[0], gp[1] + 0.5, gp[2]], [gp[0] + 1, gp[1] - 1.2, gp[2]], [WX0 - 3, gnd0[1] - 0.6, gnd0[2]], gnd0], '#1f2024', 0.14)
    const holder = add(scene, new THREE.Group())
    const rTag = liveLabel(scene, [(rA[0] + rB[0]) / 2, rA[1] + 1.3, 0.5], { size: 0.45 })
    const wireTag = liveLabel(scene, [(WX0 + WX1) / 2, WY - 1.6, 0.6], { size: 0.45 })

    const servoAt: V3 = [WX1 + 4.2, WY, 0]
    sg90Servo(scene, servoAt)
    addLabel(scene, 'SERVO IN', [servoAt[0], servoAt[1] + 2, 0], LABEL, 0.45)
    const sIn: V3 = [servoAt[0] - 2.4, WY + 0.4, 0.4]
    cableRun(scene, [sig1, [sig1[0] + 0.8, sig1[1], 0.4], sIn], '#c8322c', 0.14)
    cableRun(scene, [gnd1, [gnd1[0] + 0.8, gnd1[1], 0.4], [sIn[0], sIn[1] - 0.8, 0.4]], '#1f2024', 0.14)
    const ch1: V3 = [SC[0] + bench.ch1[0], SC[1] + bench.ch1[1], SC[2] + bench.ch1[2]]
    cableRun(scene, [[sIn[0] - 0.6, sIn[1] + 0.1, 0.6], [sIn[0] - 1, sIn[1] + 2.6, 1.6], [ch1[0], ch1[1] - 2, 1.6], ch1], '#2a2c32', 0.18)
    junction(scene, [sIn[0] - 0.6, sIn[1] + 0.1, 0.6], 0.25)

    const st = { key: '', t: 0, cur: [] as number[], prev: [] as number[] }
    return {
      scene,
      view: { center: [-1.6, 3, 0], radius: 75, polar: 1.42, azimuth: 0.06 },
      frame(dt, p) {
        const s = termOf(p)
        const key = `${s.len}|${s.ser}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          st.prev = st.cur
          st.cur = s.atLoad
          emptyGroup(holder)
          if (s.rs) resistorAlong(holder, s.rs, rA, rB, 0.95)
          else wire(holder, [rA, rB], 0.12)
          rTag.set(`R ${s.rs} Ω`, Math.abs(s.gs) < 0.1 ? POWER : s.gs > 0 ? RING : HEAT)
          wireTag.set(`${LENGTH_NAMES[s.len].toUpperCase()} JUMPER PAIR · Z0 ${ohms(JUMP.z0)} · ${secs(s.td)} EACH WAY`, LABEL)
          bench.status[0].set('CH1 1V', RING)
          bench.status[1].set(secs(s.tdiv).replace(' ', ''), LABEL)
          bench.knobs.time.set(Math.log10(s.tdiv / 1e-9) * 1.2 - 1.2)
          bench.knobs.volts.set(0)
        }
        st.t += dt
        if (st.t > REVEAL2 + HOLD2) {
          st.t = 0
          st.prev = st.cur
        }
        const prog = Math.min(1, st.t / REVEAL2)
        const at = (a: number[], u: number) => a[Math.min(a.length - 1, Math.round(u * (a.length - 1)))] ?? 0
        trace.draw((u) => yOf(at(u <= prog ? st.cur : st.prev, u)), prog < 1 ? prog : null)
        const tNow = (prog * s.window) / s.td
        body.glow((u) => lineVolts(u, tNow, s.legs, s.shape), VDD)
        const over = (s.peak - VDD) / VDD
        bench.lamp(POWER, prog > 0)
        bench.status[2].set(prog < 1 ? 'SINGLE' : over > 0.05 ? `OVERSHOOT ${pct(over)}` : 'CLEAN EDGE', prog < 1 ? HEAT : over > 0.05 ? HIGH_V : POWER)
      },
      readouts: (p) => {
        const s = termOf(p)
        const over = (s.peak - VDD) / VDD
        return [
          { label: 'Source Γ', value: `${signed(s.gs)} (${RDRV} + ${s.rs} Ω vs ${ohms(JUMP.z0)})`, tone: Math.abs(s.gs) < 0.1 ? 'ok' : Math.abs(s.gs) < 0.4 ? 'warn' : 'bad' },
          { label: 'Peak', value: `${volts(s.peak)} (${over > 0.005 ? '+' + pct(over) : 'none over'})`, tone: over < 0.05 ? 'ok' : over < 0.3 ? 'warn' : 'bad' },
          { label: 'Dips to', value: volts(s.dip), tone: s.dip > 2 ? 'ok' : s.dip > 0.8 ? 'warn' : 'bad' },
          {
            label: 'Settles (±5 %)',
            value: s.settle > 0.95 * s.window ? `> ${secs(s.window)}` : `${secs(s.settle)} · ${volts(settledVolts(VDD, RDRV + s.rs, Infinity))}`,
            tone: s.settle < 6 * s.td + RISE ? 'ok' : 'warn',
          },
        ]
      },
    }
  },
}
