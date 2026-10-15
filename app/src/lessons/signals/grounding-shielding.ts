import * as THREE from 'three/webgpu'
import {
  Shield,
  capPickup,
  decibels,
  emfPeak,
  groundLoop,
  motorField,
  pairFacing,
  pairFlux,
  shieldPickup,
} from '../../core/physics'
import { si } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh, rod, tube } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  CONVENTIONAL,
  FORCE,
  GREY,
  HIGH_V,
  LABEL,
  LOW_V,
  POWER,
  RING,
  addLabel,
  cableRun,
  emptyGroup,
  glowMat,
  groundAt,
  liveLabel,
  loopBeads,
  scope,
  setGlow,
} from '../fx'
import { Lesson, Params, Stage, opts, pick } from '../types'

const TAU = 2 * Math.PI
const vText = (v: number) => si(Math.abs(v), 'V', 2)

// --- Ground loops: two earthed boxes joined by a signal cable close a loop; a mains field threads it and drives hum. ---

const HUM_HZ = 50
const B_ROOM = 20e-6
const LOOP_OHMS = 0.4
const CABLE_OHMS = 0.2
const MIC = 10e-3
const TONE_HZ = 400
const SLOW = 100
const AREAS = { bundled: 0.05, loose: 0.5, room: 2 }
const AREA_NAMES = { bundled: 'Bundled', loose: 'Loose', room: 'Across room' }
const LOOP_DEPTH = { bundled: 2.8, loose: 4.6, room: 6.4 }
const LOOP = { bT: B_ROOM, hz: HUM_HZ, loopOhms: LOOP_OHMS, sharedOhms: CABLE_OHMS }
const BX = 13
const CY = 1
const LX = 10.6
const GW = 16
const GH = 5.2
const GY = 8.4
const G_WIN = 0.04
const G_FS = 20e-3

const loopOf = (p: Params) => {
  const ak = pick(AREAS, p.area, 'loose')
  const closed = p.path !== 'iso'
  const g = groundLoop({ ...LOOP, areaM2: AREAS[ak] }, closed)
  return { ak, closed, ...g, snr: decibels(MIC / Math.max(g.hum, 1e-9)) }
}

function rackBox(parent: THREE.Object3D, at: V3, name: string) {
  const g = add(parent, new THREE.Group(), at)
  box(g, [6, 4.2, 3], mat('#3a3d45', { rough: 0.5 }), [0, 0, -1.5])
  box(g, [5.6, 3.8, 0.1], mat('#1e2024', { rough: 0.6 }), [0, 0, 0.02])
  for (const x of [-1.6, 0, 1.6]) cylinder(g, 0.45, 0.4, mat('#c9cdd4', { metal: 0.3, rough: 0.35 }), [x, -0.7, 0.2], 'z', 24)
  addLabel(g, name, [0, 1.1, 0.2], LABEL, 0.55)
  return g
}

export const groundLoops: Lesson = {
  id: 'grounding-shielding-ground-loops',
  title: 'Ground loops',
  tagline: 'Two ground paths make a loop; a mains field threading it drives a current that hums',
  formula: (p) => {
    const s = loopOf(p)
    const head = `EMF = 2π·f·B·A = 2π·${HUM_HZ}·${B_ROOM * 1e6} µT·${AREAS[s.ak]} m² = ${vText(s.emf)}`
    return s.closed
      ? `${head} · I = EMF / ${LOOP_OHMS} Ω = ${si(s.amps, 'A', 2)} · hum = I·${CABLE_OHMS} Ω = ${vText(s.hum)}`
      : `${head} · loop open: I = 0, hum = 0`
  },
  legend: [
    { color: RING, label: 'Amp input: 10 mV tone + hum', shape: 'dot' },
    { color: B_FIELD, label: '50 Hz field through the loop', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Loop current in the grounds', shape: 'dot' },
  ],
  points: [
    'Each box is earthed through its mains cord, and the audio cable’s ground joins them again. Cable ground, earth wires and the wall wiring close a loop with two paths to ground.',
    `Mains wiring and power bricks fill a room with a 50 Hz magnetic field, here ${B_ROOM * 1e6} µT. Faraday: the changing flux through the loop induces EMF = 2π·f·B·A.`,
    `The loop is under half an ohm, so even millivolts drive tens of milliamps. The slice across the thin cable ground (${CABLE_OHMS} Ω) adds straight onto the signal: the classic 50 Hz hum.`,
    'Shrink the loop by running the cables together, or open it: one ground point, an isolating transformer, an opto/digital isolator or a differential input. Never cut the mains earth to do it.',
    'The same loop forms between a USB-powered ESP32, a bench supply and a laptop: the ADC reading wobbles at 50 Hz.',
    `Drawn ${SLOW}× slower than real time; the loop and field are not to scale.`,
  ],
  controls: [
    { kind: 'choice', key: 'path', options: [{ value: 'two', label: 'Two ground paths' }, { value: 'iso', label: 'Isolator' }], initial: 'two' },
    { kind: 'choice', key: 'area', options: (Object.keys(AREAS) as (keyof typeof AREAS)[]).map((k) => ({ value: k, label: AREA_NAMES[k] })), initial: 'loose' },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    rackBox(scene, [-BX, CY + 1.2, 0], 'MIXER')
    rackBox(scene, [BX, CY + 1.2, 0], 'AMP')
    cableRun(scene, [[-BX + 3, CY + 0.45, 0.4], [BX - 3, CY + 0.45, 0.4]], '#c9a227', 0.14)
    cableRun(scene, [[-BX + 3, CY, 0.4], [BX - 3, CY, 0.4]], '#6c7079', 0.2)
    addLabel(scene, `AUDIO CABLE · GROUND ${CABLE_OHMS} Ω`, [-5.6, CY + 1.3, 0.4], LABEL, 0.42)
    const iso = add(scene, new THREE.Group(), [5, CY + 0.2, 0.4])
    box(iso, [2.2, 1.8, 1.2], mat('#2b2e35', { rough: 0.5 }), [0, 0, 0])
    for (const x of [-0.45, 0.45]) cylinder(iso, 0.4, 0.5, mat('#b87333', { metal: 0.35, rough: 0.4 }), [x, 0, 0.6], 'z', 20)
    addLabel(iso, 'ISOLATOR', [0, 1.4, 0.3], RING, 0.42)

    const holder = add(scene, new THREE.Group())
    const fieldMat = glowMat(B_FIELD, 0)
    const beads = loopBeads(scene, 20, CONVENTIONAL)
    const dots: THREE.Mesh[] = []

    const plot = scope(scene, GW, GH, { divs: [10, 4] })
    plot.group.position.set(-4, GY, 0)
    const hum = plot.trace(B_FIELD, { samples: 200, radius: 0.05 })
    const sig = plot.trace(RING, { samples: 420, radius: 0.07 })
    addLabel(plot.group, 'AMP INPUT · 5 mV/DIV · 4 ms/DIV', [-GW / 2, GH / 2 + 0.9, 0], LABEL, 0.42, 'left')

    const st = { key: '', t: 0 }
    return {
      scene,
      view: { center: [0, 1.4, 0], radius: 56, polar: 1.42, azimuth: 0.05 },
      frame(dt, p) {
        const s = loopOf(p)
        const key = `${s.ak}`
        if (key !== st.key) {
          st.key = key
          emptyGroup(holder)
          dots.length = 0
          const yb = CY - LOOP_DEPTH[s.ak]
          for (const sx of [-1, 1]) cableRun(holder, [[sx * LX, CY - 0.9, 0], [sx * LX, yb, 0], [sx * 4.2, yb, 0]], '#2a2b30', 0.24)
          box(holder, [9, 1.3, 1.6], mat('#e6e3dc', { rough: 0.7 }), [0, yb, -0.3])
          for (const x of [-2.8, 2.8]) box(holder, [1.3, 0.8, 0.1], mat('#3a3d45'), [x, yb, 0.55])
          addLabel(holder, 'MAINS STRIP · SHARED EARTH', [0, yb - 1.3, 0], GREY, 0.42)
          for (let y = CY - 1.3; y > yb + 0.9; y -= 1.4)
            for (let x = -8.4; x <= 8.4; x += 1.4) dots.push(add(holder, mesh(new THREE.SphereGeometry(0.16, 8, 6), fieldMat), [x, y, -0.2]))
          beads.setPath([[-LX, CY, 1.2], [LX, CY, 1.2], [LX, yb, 1.2], [-LX, yb, 1.2]])
        }
        iso.visible = !s.closed
        st.t += dt / SLOW
        const ph = TAU * HUM_HZ * st.t
        const b = Math.sin(ph)
        setGlow(fieldMat, b >= 0 ? B_FIELD : LOW_V, 0.3 + 1.4 * Math.abs(b))
        dots.forEach((d) => d.scale.setScalar(0.35 + 0.9 * Math.abs(b)))
        beads.show(s.closed)
        beads.step((dt * 0.5 * Math.cos(ph) * Math.min(1, s.amps / 0.03)) / 2)
        const hAt = (t: number) => (s.hum * Math.cos(TAU * HUM_HZ * t)) / G_FS
        const at = (u: number) => st.t - (1 - u) * G_WIN
        sig.draw((u) => ((MIC * Math.sin(TAU * TONE_HZ * at(u))) / G_FS + hAt(at(u))) * (GH / 2))
        hum.draw((u) => hAt(at(u)) * (GH / 2), null)
      },
      readouts: (p) => {
        const s = loopOf(p)
        return [
          { label: 'Loop EMF', value: `${vText(s.emf)} at ${HUM_HZ} Hz` },
          { label: 'Loop current', value: s.closed ? si(s.amps, 'A', 2) : '0 · loop open', tone: s.closed ? 'warn' : 'ok' },
          { label: 'Hum at the input', value: s.closed ? vText(s.hum) : '0 V' },
          { label: 'Signal / hum', value: s.closed ? `${Math.round(s.snr)} dB` : 'clean', tone: !s.closed || s.snr > 30 ? 'ok' : s.snr > 15 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}

// --- Twisted pairs: each half-twist flips the pair's loop, so a motor's field induces opposite EMFs that cancel. ---

const PAIR_M = 0.4
const GAP_M = 0.002
const PWM_HZ = 20e3
const B_NEAR = 1e-3
const MOTOR_X = 0.013
const U = 65
const MOTOR_Y = { '2': -2.6, '5': -4.2 }
const TWISTS = { '0': 0, '10': 10, '25': 25, '50': 50 }
const TWIST_NAMES = { '0': 'Flat pair', '10': '10 cm pitch', '25': '4 cm pitch', '50': '2 cm pitch' }
const NEAR = { '2': 0.02, '5': 0.05 }
const G = 0.9
const SLICE = 0.25
const SLICES = Math.round((PAIR_M * U) / SLICE)
const TW = 22
const TH = 5.2
const TY = 6.6
const T_FS = 10e-3
const T_SLOW = 40000
const T_WIN = 125e-6

const pairOf = (p: Params) => {
  const tk = pick(TWISTS, p.twist, '0')
  const dk = pick(NEAR, p.near, '2')
  const h = NEAR[dk]
  const tw = TWISTS[tk]
  const b = motorField(B_NEAR * (0.02 / h) ** 3, h, MOTOR_X)
  const flat = emfPeak(pairFlux(b, PAIR_M, GAP_M, 0), PWM_HZ)
  const emf = emfPeak(pairFlux(b, PAIR_M, GAP_M, tw), PWM_HZ)
  return { tk, dk, h, tw, b, flat, emf, cut: decibels(Math.abs(flat) / Math.max(Math.abs(emf), 1e-12)) }
}

export const twistedPairs: Lesson = {
  id: 'grounding-shielding-twisted-pairs',
  title: 'Twisted pairs',
  tagline: 'Twisting flips the pair’s loop every half-turn, so magnetic pickup cancels itself',
  formula: (p) => {
    const s = pairOf(p)
    return `EMF = 2π·f·∮B·w(x)·dx, w flips sign each half-twist · flat ${vText(s.flat)} → ${vText(s.emf)} (${s.tw ? `−${Math.round(s.cut)} dB` : 'no twist'})`
  },
  legend: [
    { color: HIGH_V, label: 'Loop facing the field: + EMF', shape: 'dot' },
    { color: LOW_V, label: 'Flipped loop: − EMF', shape: 'dot' },
    { color: RING, label: 'Pickup at the receiver', shape: 'dot' },
    { color: GREY, label: 'Same cable untwisted', shape: 'dot' },
  ],
  points: [
    'A signal wire and its return make a long thin loop. A motor’s changing field threads it and induces a voltage in series with the signal, set by the loop’s area.',
    'Twist the pair and the loop rolls over every half-twist: the field enters one tiny loop from the front and the next from the back. Their EMFs point opposite ways and cancel.',
    'Cancellation needs the field to be about equal over neighbouring half-twists, so the pitch must be short compared with the distance to the source. A 10 cm twist next to a motor 2 cm away barely helps.',
    'Twisting does nothing against electric fields (that is shielding’s job) but costs nothing: Ethernet, CAN, RS-485 and USB data all ride twisted pairs. Twist motor leads too, so they radiate less.',
    `Motor ripple field ${B_NEAR * 1000} mT at 2 cm, falling as 1/r³; ${PAIR_M * 100} cm pair, ${GAP_M * 1000} mm apart (drawn wider). ${PWM_HZ / 1000} kHz slowed ${T_SLOW}×.`,
  ],
  controls: [
    { kind: 'choice', key: 'twist', options: (Object.keys(TWISTS) as (keyof typeof TWISTS)[]).map((k) => ({ value: k, label: TWIST_NAMES[k] })), initial: '0' },
    { kind: 'choice', key: 'near', options: [{ value: '2', label: 'Motor 2 cm away' }, { value: '5', label: '5 cm away' }], initial: '2' },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const x0 = (-PAIR_M / 2) * U
    const x1 = (PAIR_M / 2) * U
    for (const [x, name] of [[x0 - 2, 'SENSOR'], [x1 + 2, 'MCU']] as [number, string][]) {
      box(scene, [3, 3, 1.4], mat('#2e7d4f', { rough: 0.5 }), [x, 0, -0.4])
      addLabel(scene, name, [x, 2.1, 0], LABEL, 0.45)
    }
    const wires = add(scene, new THREE.Group())
    const slices = Array.from({ length: SLICES }, (_, i) => {
      const m = glowMat(HIGH_V, 0)
      const x = x0 + (i + 0.5) * SLICE
      const o = add(scene, mesh(new THREE.BoxGeometry(SLICE * 0.92, 1, 0.04), m), [x, 0, 0])
      o.castShadow = false
      return { o, m, xm: x / U, w: 1 }
    })
    const motor = add(scene, new THREE.Group())
    cylinder(motor, 0.9, 1.6, mat('#b8bcc4', { metal: 0.35, rough: 0.35 }), [0, 0, -0.8], 'z', 32)
    cylinder(motor, 0.55, 0.12, mat('#2b2e35'), [0, 0, 0.05], 'z', 24)
    cylinder(motor, 0.12, 0.6, mat('#e6e6e6', { metal: 0.4 }), [0, 0, 0.3], 'z', 12)
    const ringMats = [1.25, 1.7, 2.15].map((r) => {
      const m = glowMat(B_FIELD, 0)
      add(motor, mesh(new THREE.TorusGeometry(r, 0.05, 6, 48), m), [0, 0, -0.2]).castShadow = false
      return m
    })
    const motorTag = liveLabel(motor, [0, -2.7, 0.3], { size: 0.42 })

    const plot = scope(scene, TW, TH, { divs: [10, 4] })
    plot.group.position.set(-2, TY, 0)
    const ref = plot.trace(GREY, { samples: 200, radius: 0.06 })
    const tr = plot.trace(RING, { samples: 200, radius: 0.09 })
    addLabel(plot.group, 'PICKUP AT THE MCU · 5 mV/DIV · 12.5 µs/DIV', [-TW / 2, TH / 2 + 0.9, 0], LABEL, 0.42, 'left')

    const st = { key: '', t: 0 }
    return {
      scene,
      view: { center: [0, 2.2, 0], radius: 56, polar: 1.42, azimuth: 0.05 },
      frame(dt, p) {
        const s = pairOf(p)
        const key = `${s.tk}|${s.dk}`
        if (key !== st.key) {
          st.key = key
          emptyGroup(wires)
          const pts = (side: number): V3[] =>
            Array.from({ length: 641 }, (_, i) => {
              const x = x0 + (i / 640) * (x1 - x0)
              if (!s.tw) return [x, (side * G) / 2, 0]
              const a = TAU * s.tw * (x / U + PAIR_M / 2)
              return [x, (side * G * Math.sin(a)) / 2, (-side * G * Math.cos(a)) / 2]
            })
          tube(wires, pts(1), 0.14, mat('#d8322c', { rough: 0.5 }), 900)
          tube(wires, pts(-1), 0.14, mat('#25272c', { rough: 0.5 }), 900)
          slices.forEach((c) => {
            c.w = pairFacing(c.xm, PAIR_M, s.tw)
            c.o.scale.y = Math.max(0.02, Math.abs(c.w) * G)
          })
          motor.position.set(MOTOR_X * U, MOTOR_Y[s.dk], 0)
          motorTag.set(`MOTOR · ${s.h * 100} CM AWAY`, LABEL)
        }
        st.t += dt / T_SLOW
        const ph = Math.sin(TAU * PWM_HZ * st.t)
        slices.forEach((c) => {
          const k = (s.b(c.xm) / B_NEAR) * Math.abs(ph)
          const f = Math.min(1, k * Math.abs(c.w))
          setGlow(c.m, c.w * ph >= 0 ? HIGH_V : LOW_V, 0.05 + 2 * f)
          c.m.color.multiplyScalar(0.12 + 0.88 * f)
        })
        ringMats.forEach((m, i) => (m.emissiveIntensity = (0.2 + 1.2 * Math.abs(ph)) * (1 - i * 0.28)))
        const y = (amp: number) => (u: number) => ((amp * Math.sin(TAU * PWM_HZ * (st.t - (1 - u) * T_WIN))) / T_FS) * (TH / 2)
        ref.draw(y(s.flat), null)
        tr.draw(y(s.emf))
      },
      readouts: (p) => {
        const s = pairOf(p)
        return [
          { label: 'Flat pair picks up', value: vText(s.flat) },
          { label: 'This pair', value: vText(s.emf), tone: Math.abs(s.emf) < 1e-3 ? 'ok' : Math.abs(s.emf) < 4e-3 ? 'warn' : 'bad' },
          { label: 'Cancelled', value: !s.tw ? 'none' : s.cut > 60 ? 'over 60 dB · ÷1000+' : `${Math.round(s.cut)} dB · ÷${Math.round(10 ** (s.cut / 20))}` },
          { label: 'Pitch vs distance', value: s.tw ? `${100 / s.tw} cm vs ${s.h * 100} cm` : `flat vs ${s.h * 100} cm` },
        ]
      },
    }
  },
}

// --- Cable shields: a grounded braid catches the mains' electric field; a floating one passes it on; both ends earthed closes a ground loop. ---

const MAINS_V = 230
const SPEC = { volts: MAINS_V, hz: HUM_HZ, couple: 10e-12, shieldToGround: 30e-12, coreToShield: 100e-12, ohms: 1e6, leak: 5e-4 }
const SHIELDS: Record<Shield, string> = { none: 'No shield', floating: 'Floating', one: 'One end', both: 'Both ends' }
const SHIELD_LOOP = groundLoop({ ...LOOP, areaM2: AREAS.loose })
const MY = 5.6
const SX = 12
const SR = 0.8
const LINES = 9
const EY = -3.6
const SW = 15
const SH = 4.6
const SY = 9.8
const S_FS = 2e-3
const S_WIN = 0.05

const shieldOf = (p: Params) => {
  const kind = pick(SHIELDS, p.shield, 'none') as Shield
  const e = shieldPickup(kind, SPEC)
  const hum = kind === 'both' ? SHIELD_LOOP.hum : 0
  return { kind, ...e, hum, total: Math.hypot(e.core, hum) }
}

export const cableShields: Lesson = {
  id: 'grounding-shielding-cable-shields',
  title: 'Cable shields',
  tagline: 'A grounded shield catches electric-field noise; earth it at one end for low-frequency signals',
  formula: (p) => {
    const s = shieldOf(p)
    const bare = `V ≈ ${MAINS_V} V · 2π·${HUM_HZ}·10 pF·1 MΩ = ${vText(capPickup(MAINS_V, HUM_HZ, SPEC.couple, SPEC.ohms))}`
    if (s.kind === 'none') return `bare core: ${bare}`
    if (s.kind === 'floating') return `V_shield = ${MAINS_V} V · 10 / (10 + 30) pF = ${+s.shieldV.toFixed(1)} V → core via 100 pF: ${vText(s.core)}`
    const leak = `grounded: ${SPEC.leak * 100} % leaks through the braid = ${vText(s.core)}`
    return s.kind === 'one' ? leak : `${leak} · + loop hum I·R_shield = ${vText(s.hum)}`
  },
  legend: [
    { color: RING, label: 'Electric field from the mains cord', shape: 'dot' },
    { color: HIGH_V, label: 'Noise on the sensor wire', shape: 'dot' },
    { color: FORCE, label: 'Charged (floating) shield', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Ground-loop current in the shield', shape: 'dot' },
  ],
  points: [
    `A wire near mains forms a tiny capacitor with it (here 10 pF). Into a 1 MΩ input (a scope, a piezo, a pH probe) that couples ${vText(capPickup(MAINS_V, HUM_HZ, SPEC.couple, SPEC.ohms))} of 50 Hz. Low-impedance inputs pick up far less.`,
    'A shield is a Faraday cage around the core: the field lines end on the braid instead of the wire, and the charge they bring drains away to ground.',
    'Left floating, the shield just charges up to the noise voltage and, being close to the core, passes it on even better: a floating shield is not a shield.',
    `Grounded at both ends, the braid also closes a ground loop. 50 Hz loop current through its ${CABLE_OHMS} Ω adds hum in series with the signal. For audio and sensors, ground the shield at one end, usually the receiver.`,
    'At radio frequencies it flips: ground both ends, 360° at the connectors, so the shield also blocks magnetic fields. Twisted pair inside a grounded shield covers both.',
    `Scope at 1 mV/div clips anything over 2 mV. Slowed ${SLOW}×.`,
  ],
  controls: [{ kind: 'choice', key: 'shield', options: opts(SHIELDS), initial: 'none' }],
  build(): Stage {
    const scene = createStage({ span: 22 })
    cableRun(scene, [[-SX - 4, MY, 0], [SX + 4, MY, 0]], '#7a4a2a', 0.4)
    const mainsMat = glowMat(HIGH_V, 0)
    rod(scene, [-SX - 4, MY, 0.38], [SX + 4, MY, 0.38], 0.08, mainsMat)
    addLabel(scene, `${MAINS_V} V MAINS CORD · ${HUM_HZ} Hz`, [SX + 4, MY + 1.1, 0], LABEL, 0.48, 'right')

    box(scene, [3, 3, 1.6], mat('#4a6fa5', { rough: 0.5 }), [-SX - 2.3, 0, -0.3])
    addLabel(scene, 'SENSOR', [-SX - 2.3, 2.1, 0], LABEL, 0.42)
    box(scene, [3.4, 3.4, 1.6], mat('#2e7d4f', { rough: 0.5 }), [SX + 2.5, 0, -0.3])
    addLabel(scene, '1 MΩ IN', [SX + 2.5, 2.3, 0], LABEL, 0.42)

    const coreMat = glowMat(HIGH_V, 0)
    coreMat.color.set('#c8803f')
    rod(scene, [-SX - 0.8, 0, 0], [SX + 0.8, 0, 0], 0.2, coreMat)
    const shield = add(scene, new THREE.Group())
    const shieldMat = glowMat(FORCE, 0)
    shieldMat.color.set('#b8bcc4')
    shieldMat.side = THREE.DoubleSide
    const shell = add(shield, mesh(new THREE.CylinderGeometry(SR, SR, 2 * SX, 28, 1, true, Math.PI / 2, Math.PI), shieldMat))
    shell.rotation.z = Math.PI / 2
    for (let x = -SX + 0.5; x < SX; x += 1) add(shield, mesh(new THREE.TorusGeometry(SR, 0.05, 6, 24, Math.PI), shieldMat), [x, 0, 0]).rotation.set(0, Math.PI / 2, -Math.PI / 2)

    const drains = (['one', 'both'] as const).map((_, i) => {
      const x = i ? -SX + 0.4 : SX - 0.4
      const g = add(scene, new THREE.Group())
      rod(g, [x, -SR, 0], [x, EY + 0.6, 0], 0.1, mat('#9aa0aa', { metal: 0.3 }))
      groundAt(g, [x, EY + 0.6, 0])
      return g
    })
    const earth = add(scene, new THREE.Group())
    cableRun(earth, [[-SX + 0.4, EY - 0.8, 0], [SX - 0.4, EY - 0.8, 0]], '#4f8a3c', 0.14)
    addLabel(earth, 'EARTH WIRING · CLOSES THE LOOP', [0, EY - 1.8, 0], GREY, 0.4)
    const beads = loopBeads(scene, 22, CONVENTIONAL)
    beads.setPath([[-SX + 0.4, SR + 0.3, 1], [SX - 0.4, SR + 0.3, 1], [SX - 0.4, EY - 0.8, 1], [-SX + 0.4, EY - 0.8, 1]])

    const lineMat = glowMat(RING, 0)
    const lines = Array.from({ length: LINES }, (_, i) => {
      const m = add(scene, mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), lineMat), [-SX + 1.5 + (i * (2 * SX - 3)) / (LINES - 1), 0, 0.2])
      m.castShadow = false
      return m
    })
    const inner = Array.from({ length: LINES }, (_, i) => {
      const m = add(scene, mesh(new THREE.CylinderGeometry(0.04, 0.04, SR - 0.25, 6), lineMat), [-SX + 1.5 + (i * (2 * SX - 3)) / (LINES - 1), (SR + 0.2) / 2, 0.25])
      m.castShadow = false
      return m
    })
    const shieldTag = liveLabel(scene, [0, -1.6, 0.5], { size: 0.45 })

    const plot = scope(scene, SW, SH, { divs: [10, 4] })
    plot.group.position.set(-5, SY, 0)
    const tr = plot.trace(HIGH_V, { samples: 240, radius: 0.08 })
    const clipTag = liveLabel(plot.group, [SW / 2, SH / 2 + 0.9, 0], { size: 0.42, align: 'right' })
    addLabel(plot.group, 'INPUT · 1 mV/DIV · 5 ms/DIV', [-SW / 2, SH / 2 + 0.9, 0], LABEL, 0.42, 'left')

    const st = { key: '', t: 0 }
    return {
      scene,
      view: { center: [0, 4.2, 0], radius: 58, polar: 1.42, azimuth: 0.05 },
      frame(dt, p) {
        const s = shieldOf(p)
        if (s.kind !== st.key) {
          st.key = s.kind
          shield.visible = s.kind !== 'none'
          drains[0].visible = s.kind === 'one' || s.kind === 'both'
          drains[1].visible = earth.visible = s.kind === 'both'
          beads.show(s.kind === 'both')
          const end = s.kind === 'none' ? 0.2 : SR + 0.05
          lines.forEach((l) => {
            l.position.y = (MY - 0.4 + end) / 2
            l.scale.y = MY - 0.4 - end
          })
          inner.forEach((l) => (l.visible = s.kind === 'floating'))
          shieldTag.set(
            s.kind === 'none' ? 'BARE WIRE' : s.kind === 'floating' ? `SHIELD FLOATS AT ${Math.round(s.shieldV)} V` : 'SHIELD AT 0 V',
            s.kind === 'floating' ? FORCE : s.kind === 'none' ? HIGH_V : POWER,
          )
        }
        st.t += dt / SLOW
        const ph = TAU * HUM_HZ * st.t
        const a = Math.abs(Math.sin(ph))
        mainsMat.emissiveIntensity = 0.3 + 1.4 * a
        lineMat.emissiveIntensity = 0.15 + 1.5 * a
        shieldMat.emissiveIntensity = s.kind === 'floating' ? 0.15 + 0.9 * a : 0.03
        coreMat.emissiveIntensity = Math.min(1.8, (s.total / S_FS) * 1.2) * a
        beads.step((dt * 0.5 * Math.cos(ph)) / 2)
        clipTag.set(s.total > S_FS ? 'OFF SCALE' : '', HIGH_V)
        const at = (u: number) => st.t - (1 - u) * S_WIN
        tr.draw((u) => ((s.core * Math.sin(TAU * HUM_HZ * at(u)) + s.hum * Math.cos(TAU * HUM_HZ * at(u))) / S_FS) * (SH / 2))
      },
      readouts: (p) => {
        const s = shieldOf(p)
        return [
          { label: 'Electric-field pickup', value: vText(s.core), tone: s.core < 1e-3 ? 'ok' : 'bad' },
          { label: 'Shield', value: s.kind === 'none' ? 'none' : s.kind === 'floating' ? `floats at ${Math.round(s.shieldV)} V` : 'grounded, 0 V', tone: s.kind === 'floating' ? 'bad' : undefined },
          { label: 'Shield-loop hum', value: s.kind === 'both' ? `${vText(s.hum)} · ${si(SHIELD_LOOP.amps, 'A', 2)} in braid` : '0 V', tone: s.kind === 'both' ? 'warn' : 'ok' },
          { label: 'Noise at the input', value: vText(s.total), tone: s.total < 0.5e-3 ? 'ok' : s.total < 5e-3 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}
