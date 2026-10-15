import * as THREE from 'three/webgpu'
import { HX711, LOAD_CELL, TOUCH, calFactor, fingerC, hx711Lsb, loadCellRead, padFarads, padPeriod, padVolts, toGrams, touchCount, touchState, waterC } from '../../core/physics'
import type { Bridge, Overlay, Water } from '../../core/physics'
import { si } from '../../core/units'
import { V3, add, box, mat, mesh, range } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  CODE_LEGEND,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  PIN_COLOR,
  POWER,
  RING,
  addLabel,
  codeBlock,
  esp32Board,
  glowMat,
  groundAt,
  i2cBreakout,
  junction,
  litWire,
  liveLabel,
  partLetter,
  resistorAlong,
  scope,
  setGlow,
  shadowlessRod,
  smoothstep,
  stretchRod,
  textLines,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'


// --- Strain gauge: a bar load cell bends, its foil gauges stretch, a Wheatstone bridge turns milliohms into microvolts, the HX711 counts them, tare + one known weight give grams. ---

const BRIDGES: Record<Bridge, string> = { quarter: 'Quarter bridge', half: 'Half bridge', full: 'Full bridge' }
const STEPS = { raw: 'Raw counts', tare: 'Tared', cal: 'Calibrated' }
const VEX = 3.3
const TRAY = 0.05
const KNOWN_G = 500
const GAUGES = [
  { name: 'R1', u: 0.38, top: true, sign: 1 },
  { name: 'R2', u: 0.62, top: true, sign: -1 },
  { name: 'R3', u: 0.38, top: false, sign: -1 },
  { name: 'R4', u: 0.62, top: false, sign: 1 },
]
const BAR = { x0: -16.5, len: 12, y: 2, h: 1.6, d: 1.8, n: 30, sag: 3 }
const HISTORY = 60
const FOIL_EXAG = 400

function scaleSetup(p: Params) {
  const grams = n(p, 'grams')
  const bridge = pick(BRIDGES, p.bridge, 'full')
  const step = pick(STEPS, p.step, 'cal')
  const at = (kg: number, k?: number) => loadCellRead(kg, bridge, VEX, k)
  const rawTare = at(TRAY).code
  const factor = calFactor(at(TRAY + KNOWN_G / 1000).code, rawTare, KNOWN_G)
  const now = at(TRAY + grams / 1000)
  return { grams, bridge, step, at, rawTare, factor, now, read: toGrams(now.code, rawTare, factor) }
}
type ScaleSetup = ReturnType<typeof scaleSetup>

const uV = (v: number) => si(v, 'V', 3)
const microStrain = (e: number) => `${Math.round(e * 1e6)} µε`
const gramsText = (g: number) => `${g.toFixed(Math.abs(g) < 100 ? 2 : 1)} g`
const shown = (S: ScaleSetup, raw: number) => (S.step === 'raw' ? raw : S.step === 'tare' ? raw - S.rawTare : toGrams(raw, S.rawTare, S.factor))
const shownText = (S: ScaleSetup, raw: number) => (S.step === 'cal' ? gramsText(shown(S, raw)) : `${Math.round(shown(S, raw))} counts`)

const scaleCode = (S: ScaleSetup) =>
  S.step === 'raw'
    ? ['scale.begin(16, 4);  // DT, SCK · channel A ×128', 'long raw = scale.read();  // 24-bit, signed', `// ${S.now.code}: tray, zero offset and load mixed`, '']
    : S.step === 'tare'
      ? ['scale.begin(16, 4);', `scale.tare(10);  // empty tray = ${S.rawTare}`, 'long net = scale.read() - scale.get_offset();', '// counts, not grams yet']
      : ['scale.begin(16, 4);', `scale.tare(10);  // empty tray = ${S.rawTare}`, `scale.set_scale(${S.factor.toFixed(1)});  // counts per g, from ${KNOWN_G} g`, 'float g = scale.get_units(10);']

function strainHeadline(S: ScaleSetup) {
  const err = S.read - S.grams
  if (S.step === 'raw') return S.now.code < 0 ? `Raw ${S.now.code}: negative with a load on it` : `Raw ${S.now.code}: tray and offset baked in`
  if (S.step === 'tare') return `Tared: ${S.now.code - S.rawTare} counts, but how many grams?`
  if (S.grams === 0) return `Empty tray reads ${gramsText(S.read)}: tare removed tray and offset`
  if (S.bridge === 'quarter' && Math.abs(err) > 0.05) return `Quarter bridge bends the line: ${err > 0 ? '+' : ''}${err.toFixed(2)} g`
  return `${gramsText(S.read)} on the tray, from a ${uV(S.now.out - S.at(TRAY).out)} change`
}

export const strainGauge: Lesson = {
  id: 'force-touch-strain-gauge',
  title: 'Strain gauge',
  tagline: 'Weight bends an aluminium bar a few micrometres; foil gauges stretch with it, a bridge turns milliohms into microvolts, and a 24-bit ADC counts them',
  formula: (p) => {
    const S = scaleSetup(p)
    const e = S.now.strain
    return `ε = 6·F·L / (E·b·h²) = ${microStrain(e)} · ΔR = R·GF·ε = 1 kΩ × ${LOAD_CELL.gf} × ${microStrain(e)} = ${si(S.now.delta, 'Ω', 3)} · V_out = ${uV(S.now.out)} (${BRIDGES[S.bridge].toLowerCase()}) · HX711 ×128 → ${S.now.code} · g = (raw − ${S.rawTare}) / ${S.factor.toFixed(1)} = ${gramsText(S.read)}`
  },
  legend: [
    { color: HIGH_V, label: 'Gauge in tension (R up)', shape: 'dot' },
    { color: LOW_V, label: 'Gauge in compression (R down)', shape: 'dot' },
    { color: B_FIELD, label: 'Scale reading, 10 per second', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'A bar load cell is an aluminium block with a hole through it. One end is bolted down, the tray sits on the other, and the thin webs above and below the hole bend into an S. At its rated 1 kg the surface stretches about 500 µε: half a micrometre per millimetre (drawn here hundreds of times larger).',
    'A foil strain gauge is a zig-zag of thin metal glued to the web. Stretched, its tracks get longer and thinner, so R rises: ΔR/R = GF·ε, with a gauge factor of about 2. On a 1 kΩ gauge, 500 µε is only 1 Ω, and 10 g is 10 mΩ: far too small to read with a divider and a 12-bit ADC.',
    'A Wheatstone bridge cancels the 1 kΩ and keeps only the change. Two dividers share the excitation: balanced, A+ and A− sit at exactly half and the difference is 0 V. One active gauge (quarter bridge) gives Vex·GF·ε/4 and is slightly non-linear; four gauges, two stretched and two squeezed (full bridge), give the whole Vex·GF·ε, about 3.3 mV at 1 kg, and cancel temperature.',
    'The HX711 amplifies A+ − A− by 128 and converts it with a 24-bit ADC, 10 times a second: one count is about 1.5 nV. It clocks the bits out on DT with pulses on SCK, not I²C.',
    'Raw counts include the tray, the bridge’s zero offset and the load. Tare reads the empty scale and subtracts it; then put a known weight on and divide: factor = counts per gram. Both are stored in firmware, and get_units() returns grams.',
  ],
  controls: [
    { kind: 'slider', key: 'grams', label: 'Weight', min: 0, max: 1000, initial: 200, step: 10, format: (v) => `${v} g` },
    { kind: 'choice', key: 'bridge', options: opts(BRIDGES), initial: 'full' },
    { kind: 'choice', key: 'step', options: Object.entries(STEPS).map(([value, label]) => ({ value, label })), initial: 'cal' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const alu = mat('#b9c0c8', { metal: 0.35, rough: 0.35 })
    const hole = mat('#101216', { rough: 0.8 })
    box(scene, [3, 5, 2.6], mat('#4a4f58', { metal: 0.3, rough: 0.5 }), [BAR.x0 - 1.5, BAR.y - 1.4, 0])
    for (const y of [BAR.y - 0.3, BAR.y + 0.3]) box(scene, [0.5, 0.35, 0.35], mat('#d0d4da', { metal: 0.4 }), [BAR.x0 - 0.4, y, BAR.d / 2 + 0.1])
    addLabel(scene, 'bolted', [BAR.x0 - 1.5, BAR.y - 4.4, 1.6], GREY, 0.36)
    const segW = BAR.len / BAR.n
    const holeH = (u: number) => {
      const r = 0.08
      if (u >= 0.38 && u <= 0.62) return 0.9
      const d = Math.min(Math.abs(u - 0.38), Math.abs(u - 0.62)) / r
      return d < 1 ? 0.9 * Math.sqrt(1 - d * d) : 0
    }
    const segs = range(BAR.n).map((i) => {
      const u = (i + 0.5) / BAR.n
      const g = add(scene, new THREE.Group())
      box(g, [segW + 0.03, BAR.h, BAR.d], alu)
      const hh = holeH(u)
      if (hh > 0.02) box(g, [segW + 0.03, hh, 0.04], hole, [0, 0, BAR.d / 2 + 0.01])
      return { u, g }
    })
    const gauges = GAUGES.map((G) => {
      const seg = segs[Math.round(G.u * BAR.n - 0.5)]
      const m = glowMat(GREY, 0.2)
      const ys = G.top ? 1 : -1
      box(seg.g, [1.4, 0.08, 1.3], m, [0, ys * (BAR.h / 2 + 0.05), 0])
      partLetter(seg.g, G.name, [0, ys * (BAR.h / 2 + 0.55), BAR.d / 2], 0.38, LABEL)
      return { ...G, m }
    })
    const end = add(scene, new THREE.Group())
    box(end, [0.5, 0.9, 0.5], alu, [-0.6, BAR.h / 2 + 0.45, 0])
    box(end, [4.4, 0.22, 2.8], mat('#d0d4da', { metal: 0.3, rough: 0.4 }), [-0.6, BAR.h / 2 + 1, 0])
    const weight = add(end, new THREE.Group())
    const wMesh = add(weight, mesh(new THREE.CylinderGeometry(1, 1, 1, 32), mat('#6d737d', { metal: 0.4, rough: 0.35 })))
    const wTag = liveLabel(weight, [0, 0, 1.6], { size: 0.38 })

    const FO: V3 = [-11, -5.4, 0]
    const foil = add(scene, new THREE.Group(), FO)
    box(scene, [8.6, 3.2, 0.2], mat('#7a4a1c', { rough: 0.6 }), [FO[0], FO[1], -0.25])
    const foilMat = glowMat(HIGH_V, 0.3)
    const tracks = 9
    for (let i = 0; i < tracks; i++) {
      const x = (i - (tracks - 1) / 2) * 0.62
      box(foil, [0.22, 2.2, 0.08], foilMat, [x, 0, 0])
      if (i < tracks - 1) box(foil, [0.84, 0.22, 0.08], foilMat, [x + 0.31, i % 2 ? -1.1 : 1.1, 0])
    }
    for (const s of [-1, 1]) box(foil, [0.9, 0.7, 0.08], foilMat, [s * 3.2, 0, 0])
    addLabel(scene, `R4 foil, stretch ×${FOIL_EXAG}`, [FO[0], FO[1] + 2.2, 0], LABEL, 0.36)
    const foilTag = liveLabel(scene, [FO[0], FO[1] - 2.2, 0], { size: 0.36 })

    const BC: V3 = [2.4, -3.5, 0]
    const hd = 3
    const N = { ep: [BC[0], BC[1] + hd, 0] as V3, am: [BC[0] - hd, BC[1], 0] as V3, ap: [BC[0] + hd, BC[1], 0] as V3, em: [BC[0], BC[1] - hd, 0] as V3 }
    const armEnds: [V3, V3][] = [[N.ep, N.am], [N.am, N.em], [N.ep, N.ap], [N.ap, N.em]]
    const arms = armEnds.map(([a, b], i) => {
      const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]
      const at = (f: number): V3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 0]
      wire(scene, [a, at(0.25)], 0.08)
      wire(scene, [at(0.75), b], 0.08)
      const fixed = add(scene, new THREE.Group())
      resistorAlong(fixed, 1000, at(0.25), at(0.75), 0.75)
      const gauge = add(scene, new THREE.Group(), mid)
      gauge.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0])
      const m = glowMat(GREY, 0.4)
      box(gauge, [2.2, 0.55, 0.15], m)
      for (let k = -3; k <= 3; k++) box(gauge, [0.08, 0.4, 0.05], glowMat('#ffe0b0', 0.5), [k * 0.28, 0, 0.1])
      wire(gauge, [[-1.1, 0, 0], [-1.06, 0, 0]], 0.08)
      const out: V3 = [mid[0] - BC[0], mid[1] - BC[1], 0]
      const tag = liveLabel(scene, [BC[0] + out[0] * 1.75, BC[1] + out[1] * 1.6, 0], { size: 0.32 })
      partLetter(scene, GAUGES[i].name, [BC[0] + out[0] * 0.55, BC[1] + out[1] * 0.55, 0], 0.32, GREY)
      return { fixed, gauge, m, tag }
    })
    for (const p of Object.values(N)) junction(scene, [p[0], p[1], 0.1], 0.18)
    addLabel(scene, 'inside the cell', [BC[0] - 1.2, -8.5, 0], GREY, 0.34)
    const aTags = { am: liveLabel(scene, [N.am[0] - 0.3, N.am[1] + 0.5, 0], { size: 0.3, align: 'right' }), ap: liveLabel(scene, [N.ap[0] + 0.4, N.ap[1] + 0.5, 0], { size: 0.3, align: 'left' }) }

    const board = i2cBreakout(scene, [12, -8, 0], { name: 'HX711', color: '#1d6b45', k: 0.5, pins: ['E-', 'A+', 'E+', 'A-', 'DT', 'SCK'] })
    const P = (nm: string): V3 => {
      const q = board.pin(nm)
      return [q[0], q[1], 0]
    }
    const lanes: { pts: V3[]; color: string }[] = [
      { pts: [N.ap, [P('A+')[0], N.ap[1], 0], P('A+')], color: '#3fbf5a' },
      { pts: [N.ep, [N.ep[0], 0.4, 0], [P('E+')[0], 0.4, 0], P('E+')], color: HIGH_V },
      { pts: [N.am, [N.am[0], 1.1, 0], [P('A-')[0], 1.1, 0], P('A-')], color: '#e8e8e8' },
    ]
    const sigGlow = lanes.map(({ pts, color }) => {
      wire(scene, pts, 0.08)
      return { g: litWire(scene, pts, 0.15), c: new THREE.Color(color) }
    })
    const GY = -7.6
    wire(scene, [P('E-'), [P('E-')[0], GY, 0], [N.em[0], GY, 0], N.em], 0.08)
    junction(scene, [4.2, GY, 0.1], 0.16)
    groundAt(scene, [4.2, GY, 0])
    const bus = ['DT', 'SCK'].map((nm, i) => {
      const pts: V3[] = [P(nm), [P(nm)[0], -3.4 + i * 0.6, 0]]
      wire(scene, pts, 0.07)
      addLabel(scene, nm === 'DT' ? 'GPIO16' : 'GPIO4', [P(nm)[0], -2.9 + i * 0.6, 0], PIN_COLOR, 0.3)
      return litWire(scene, pts, 0.14)
    })
    const ampTag = liveLabel(scene, [12, -12.8, 0], { size: 0.34 })

    const SP: V3 = [11.5, 4, 0]
    const sw = 14
    const sh = 4.6
    const sc = scope(scene, sw, sh, { divs: [6, 4], zeroAt: 1 / 12 })
    sc.group.position.set(...SP)
    const trace = sc.trace(B_FIELD, { samples: HISTORY * 2, radius: 0.09 })
    const truth = sc.level(GREY)
    addLabel(scene, 'HX711 reading, last 6 s', [SP[0], SP[1] + sh / 2 + 1, 0], LABEL, 0.4)
    const topTag = liveLabel(scene, [SP[0] + sw / 2 + 0.9, SP[1] + sh / 2, 0], { size: 0.32, align: 'left', color: GREY })
    const botTag = liveLabel(scene, [SP[0] + sw / 2 + 0.9, SP[1] - sh / 2 + sh / 12, 0], { size: 0.32, align: 'left', color: GREY })

    const code = codeBlock(scene, [-19, -9, 0], 0.32, 4)
    const text = textLines(scene, [-19, 10.2, 0])
    const pinC = new THREE.Color(PIN_COLOR)
    const s = { key: '', grams: -1, fall: 0, fallV: 0, load: 0, vel: 0, t: 0, k: 0, hist: [] as number[], pulse: 0 }
    return {
      scene,
      view: { center: [0, 2.4, 0], radius: 72, polar: 1.3, azimuth: 0 },
      frame(dt, p) {
        const S = scaleSetup(p)
        const key = `${S.bridge}|${S.step}`
        const kgOn = () => TRAY + s.load
        if (s.grams < 0) Object.assign(s, { grams: S.grams, load: S.grams / 1000 })
        if (S.grams !== s.grams) {
          if (S.grams > s.grams) Object.assign(s, { fall: 2.6, fallV: 0 })
          else s.load = Math.min(s.load, S.grams / 1000)
          s.grams = S.grams
        }
        const target = S.grams / 1000
        if (s.fall > 0) {
          s.fallV += 30 * dt
          s.fall = Math.max(0, s.fall - s.fallV * dt)
        } else {
          const steps = Math.ceil(dt * 240)
          for (let i = 0; i < steps; i++) {
            s.vel += (110 * (target - s.load) - 4.5 * s.vel) * (dt / steps)
            s.load = Math.max(0, s.load + s.vel * (dt / steps))
          }
        }
        const span = S.at(TRAY + 1).code - S.rawTare
        const lo = S.step === 'raw' ? S.rawTare - 0.1 * span : -0.1 * span
        const yr = [lo, lo + 1.2 * span]
        const yOf = (raw: number) => {
          const v = S.step === 'raw' ? raw : raw - S.rawTare
          return ((v - yr[0]) / (yr[1] - yr[0]) - 0.5) * sh
        }
        if (key !== s.key) {
          s.key = key
          s.hist = Array(HISTORY).fill(S.at(kgOn()).code)
          code(scaleCode(S))
          topTag.set(S.step === 'cal' ? '1100 g' : `${Math.round(yr[1])}`)
          botTag.set(S.step === 'cal' ? '0 g' : S.step === 'raw' ? `${S.rawTare}` : '0')
        }
        s.t += dt
        while (s.t >= 1 / HX711.sps) {
          s.t -= 1 / HX711.sps
          s.hist.push(S.at(kgOn(), ++s.k).code)
          if (s.hist.length > HISTORY) s.hist.shift()
          s.pulse = 1
        }
        s.pulse = Math.max(0, s.pulse - dt * 6)
        trace.draw((u) => yOf(s.hist[Math.min(HISTORY - 1, Math.floor(u * HISTORY))]), 1)
        truth.set(yOf(S.at(TRAY + target).code))

        const live = S.at(kgOn())
        const ratedE = loadCellRead(LOAD_CELL.ratedKg, 'full', VEX).strain
        const bend = (BAR.sag * s.load) / LOAD_CELL.ratedKg
        for (const sg of segs) {
          const u = sg.u
          sg.g.position.set(BAR.x0 + u * BAR.len, BAR.y - bend * (3 * u * u - 2 * u * u * u), 0)
          sg.g.rotation.z = Math.atan((-bend * 6 * (u - u * u)) / BAR.len)
        }
        end.position.set(BAR.x0 + BAR.len, BAR.y - bend, 0)
        const wr = 0.55 + 0.9 * Math.cbrt(S.grams / 1000)
        const wh = 0.4 + 1.6 * Math.cbrt(S.grams / 1000)
        weight.visible = S.grams > 0
        wMesh.scale.set(wr, wh, wr)
        weight.position.set(-0.6, BAR.h / 2 + 1.11 + wh / 2 + s.fall, 0)
        wTag.group.position.z = wr + 0.1
        wTag.set(`${S.grams} g`, LABEL)
        const active = [1, 1, 1, 1].map((_, i) => (S.bridge === 'full' ? true : S.bridge === 'half' ? i >= 2 : i === 3))
        gauges.forEach((G, i) => {
          const f = Math.min(1, live.strain / ratedE)
          setGlow(G.m, active[i] ? (G.sign > 0 ? HIGH_V : LOW_V) : GREY, active[i] ? 0.25 + 1.1 * f : 0.15)
        })
        arms.forEach((A, i) => {
          A.fixed.visible = !active[i]
          A.gauge.visible = active[i]
          const f = Math.min(1, live.strain / ratedE)
          setGlow(A.m, GAUGES[i].sign > 0 ? HIGH_V : LOW_V, 0.25 + 1.1 * f)
          const dR = GAUGES[i].sign * live.delta
          A.tag.set(active[i] ? `${dR >= 0 ? '+' : '−'}${si(Math.abs(dR), 'Ω', 3)}` : '1 kΩ', active[i] ? (GAUGES[i].sign > 0 ? HIGH_V : LOW_V) : GREY)
        })
        aTags.am.set(`A− ${live.aMinus.toFixed(6)} V`, LABEL)
        aTags.ap.set(`A+ ${live.aPlus.toFixed(6)} V`, LABEL)
        const fStretch = 1 + live.strain * FOIL_EXAG
        foil.scale.set(fStretch, 1 - 0.3 * live.strain * FOIL_EXAG, 1)
        setGlow(foilMat, HIGH_V, 0.25 + Math.min(1, live.strain / ratedE))
        foilTag.set(`1 kΩ + ${si(live.arms[3] - 1000, 'Ω', 3)} · ΔR/R = ${((live.arms[3] / 1000 - 1) * 100).toFixed(4)} %`, HIGH_V)
        const outF = Math.min(1, Math.abs(live.out) / 3.4e-3)
        sigGlow.forEach((w, i) => w.g.set(i === 1 ? 0.5 : 0.25 + 0.75 * outF, w.c))
        bus.forEach((b) => b.set(s.pulse, pinC))
        board.led(1)
        board.chip(B_FIELD, 0.3 + 0.6 * s.pulse)
        ampTag.set(`(A+ − A−) = ${uV(live.out)} × 128 · 1 count = ${si(hx711Lsb(VEX), 'V', 3)}`, LABEL)

        const last = s.hist[s.hist.length - 1]
        const tone = S.step === 'raw' ? HEAT : S.step === 'tare' ? RING : S.bridge === 'quarter' && Math.abs(S.read - S.grams) > 0.05 ? HEAT : POWER
        text.a.set(strainHeadline(S), tone)
        text.b.set(`ε ${microStrain(S.now.strain)} (µm/m) → R4 ${si(S.now.delta, 'Ω', 3)} → ${uV(S.now.out)} → raw ${S.now.code}`, LABEL)
        text.c.set(`now: ${shownText(S, last)}${S.step === 'cal' ? ` (true ${S.grams} g)` : ''}`, B_FIELD)
        text.status.set(`tray ${TRAY * 1000} g · tare ${S.rawTare} · ${S.factor.toFixed(1)} counts/g · 10 SPS, real time · bend exaggerated`, GREY)
      },
      readouts: (p) => {
        const S = scaleSetup(p)
        return [
          { label: 'Strain', value: microStrain(S.now.strain), tone: 'ok' },
          { label: 'Gauge ΔR', value: si(S.now.delta, 'Ω', 3), tone: S.now.delta < 0.1 ? 'warn' : 'ok' },
          { label: 'Bridge out', value: uV(S.now.out), tone: S.bridge === 'quarter' ? 'warn' : 'ok' },
          { label: S.step === 'cal' ? 'Reading' : 'Counts', value: S.step === 'cal' ? gramsText(S.read) : `${Math.round(shown(S, S.now.code))}`, tone: S.step === 'cal' ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Capacitive touch: the pad is one plate, the finger another; more C slows the charge/discharge sweep, so the cycle count drops; threshold + hysteresis; plastic cover and water. ---

const COVERS: Record<Overlay, string> = { bare: 'Bare pad', thin: '1 mm plastic', thick: '3 mm plastic' }
const COVER_UNITS: Record<Overlay, number> = { bare: 0.14, thin: 0.9, thick: 2 }
const WATERS: Record<Water, string> = { none: 'Dry', drop: 'Droplet', puddle: 'Puddle' }
const HYST = { off: 'No hysteresis', on: 'Hysteresis' }
const CYCLE = 8
const FAR_MM = 12
const MM_U = 0.28
const RATE = 50
const N_HIST = CYCLE * RATE
const SWEEP = 100e-6
const SLOW = 1e5

const gapAt = (t: number) => {
  const u = ((t % CYCLE) + CYCLE) % CYCLE
  return u < 1 ? FAR_MM : u < 3 ? FAR_MM * (1 - smoothstep((u - 1) / 2)) : u < 5 ? 0 : u < 7 ? FAR_MM * smoothstep((u - 5) / 2) : FAR_MM
}

function touchSetup(p: Params) {
  const cover = pick(COVERS, p.cover, 'bare')
  const water = pick(WATERS, p.water, 'none')
  const thr = n(p, 'thr')
  const hyst = pick(HYST, p.hyst, 'on') === 'on'
  const base = touchCount(padFarads(cover, null, 'none'))
  const on = Math.round((base * thr) / 100)
  const off = hyst ? on + Math.max(2, Math.round(base * 0.05)) : on
  const wet = touchCount(padFarads(cover, null, water))
  const pressed = touchCount(padFarads(cover, 0, water))
  return { cover, water, thr, hyst, base, on, off, wet, pressed, falseTouch: wet < on, missed: pressed >= on }
}
type TouchSetup = ReturnType<typeof touchSetup>

const pF = (f: number) => `${(f * 1e12).toFixed(f < 1e-11 ? 2 : 1)} pF`
const touchCode = (S: TouchSetup) => [
  `int v = touchRead(T0);  // GPIO4 · dry idle ${S.base}`,
  `if (!on && v < ${S.on}) on = true;  // ${S.thr} % of idle`,
  S.hyst ? `if (on && v > ${S.off}) on = false;  // band ${S.off - S.on}` : `if (on && v >= ${S.on}) on = false;  // no band`,
]

export const capacitiveTouch: Lesson = {
  id: 'force-touch-capacitive-touch',
  title: 'Capacitive touch',
  tagline: 'The pad is one plate of a capacitor, your finger (grounded through your body) the other: more C, slower charge cycles, a lower count',
  formula: (p) => {
    const S = touchSetup(p)
    const cf = fingerC(S.cover, 0)
    const c = padFarads(S.cover, 0, S.water)
    return `C_finger = (ε₀·εr·A / t) in series with 150 pF body = ${pF(cf)} · T = 2·C·ΔV / I = 2 × ${pF(c)} × 2.2 V / 12 µA = ${si(padPeriod(c), 's', 3)} · count = 0.5 ms / T: idle ${S.base}, touched ${S.pressed} · on < ${S.on}, off > ${S.off}`
  },
  legend: [
    { color: B_FIELD, label: 'touchRead() count, 50 per second', shape: 'dot' },
    { color: RING, label: 'Touch threshold', shape: 'dot' },
    { color: POWER, label: 'Touched state', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'An ESP32 touch pad is just copper wired to a touch GPIO (T0 = GPIO4). The touch peripheral charges it with a small constant current to 2.7 V, discharges it to 0.5 V, and counts how many cycles fit in a fixed window. The pad and its trace are ~20 pF to ground: about 68 cycles.',
    'A finger is a second plate. It couples to the pad through the cover (C = ε₀·εr·A / d, Electric fields › Capacitors) and to ground through your body (~150 pF). That extra C slows each cycle (T = 2·C·ΔV / I), so touchRead() goes down when touched. On a bare pad it falls from 68 to ~14.',
    'Plastic in between is a thick dielectric: 1 mm leaves ~4 pF and 3 mm ~1.3 pF, so the drop shrinks to a few counts. Thin covers, big pads and a threshold close to idle sense through it; set the threshold as a percentage of the idle count measured at boot, not a fixed number.',
    'Noise jitters the count by a count or so. If the count sits near the threshold the state flickers on and off: hysteresis releases only above a higher level, so one press is one event.',
    'Water also adds capacitance. A droplet floating on the cover barely changes it, but a puddle that bridges the pad to the ground copper around it looks just like a finger. ESP32-S2/S3 drive a shield electrode to ignore water; on the ESP32, ignore slow changes and reject touches that never lift.',
  ],
  controls: [
    { kind: 'choice', key: 'cover', options: opts(COVERS), initial: 'bare' },
    { kind: 'slider', key: 'thr', label: 'Threshold', min: 50, max: 98, initial: 80, step: 1, format: (v) => `${v} % of idle` },
    { kind: 'choice', key: 'hyst', options: Object.entries(HYST).map(([value, label]) => ({ value, label })), initial: 'on' },
    { kind: 'choice', key: 'water', options: opts(WATERS), initial: 'none' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const PX = -11
    const PY = -3.4
    box(scene, [15, 0.7, 3.2], mat('#1f5c3a', { rough: 0.6 }), [PX, PY - 0.42, 0])
    const padM = glowMat('#c8803f', 0.15)
    box(scene, [5, 0.14, 2.6], padM, [PX, PY, 0])
    for (const s of [-1, 1]) box(scene, [3.6, 0.14, 2.6], mat('#8a6a3c', { metal: 0.3, rough: 0.5 }), [PX + s * 5.4, PY, 0])
    addLabel(scene, 'GND', [PX - 5.4, PY - 1.4, 1.7], GREY, 0.32)
    addLabel(scene, 'GND', [PX + 5.4, PY - 1.4, 1.7], GREY, 0.32)
    addLabel(scene, 'pad T0', [PX, PY - 1.4, 1.7], HEAT, 0.34)
    const coverM = new THREE.MeshStandardMaterial({ color: '#cfd8e2', transparent: true, opacity: 0.32, roughness: 0.2, depthWrite: false })
    const cover = add(scene, mesh(new THREE.BoxGeometry(15, 1, 3.2), coverM))
    cover.castShadow = false
    const coverTag = liveLabel(scene, [PX + 8, PY + 0.5, 0], { size: 0.32, align: 'left', color: GREY })
    const finger = add(scene, new THREE.Group())
    add(finger, mesh(new THREE.CapsuleGeometry(0.95, 2.2, 8, 16), mat('#e0b49a', { rough: 0.7 })), [0, 2.05, 0])
    box(finger, [1.3, 0.12, 1.2], mat('#f2d6c8', { rough: 0.5 }), [0, 1.2, 0.75])
    const fieldM = glowMat(B_FIELD, 0)
    const rods = [-1.6, -0.8, 0, 0.8, 1.6].map(() => add(scene, shadowlessRod(fieldM)))
    const waterM = new THREE.MeshStandardMaterial({ color: '#4da6ff', emissive: '#1a4a80', transparent: true, opacity: 0.7, roughness: 0.1 })
    const drop = add(scene, mesh(new THREE.SphereGeometry(1, 20, 12), waterM))
    drop.scale.set(0.9, 0.38, 0.9)
    const puddle = add(scene, mesh(new THREE.SphereGeometry(1, 28, 12), waterM))
    puddle.scale.set(4.2, 0.18, 1.4)
    const gapTag = liveLabel(scene, [PX + 2.2, 0, 0], { size: 0.34, align: 'left' })

    const ESP: V3 = [1, -8.2, 0]
    const pin = esp32Board(scene, ESP, 0.35)
    const t0 = pin(-4, true)
    const padWire: V3[] = [[PX, PY - 0.8, 0], [PX, -5.8, 0], [t0[0], -5.8, 0], t0]
    wire(scene, padWire, 0.09)
    const padGlow = litWire(scene, padWire, 0.17)
    addLabel(scene, 'GPIO4 · T0', [t0[0] + 1.9, -5.3, 0], PIN_COLOR, 0.32)
    const ledM = glowMat(POWER, 0.05)
    const led = add(scene, mesh(new THREE.SphereGeometry(0.45, 16, 12), ledM), [ESP[0] + 5.2, ESP[1] + 0.2, 0.5])
    led.castShadow = false
    const ledTag = liveLabel(scene, [ESP[0] + 5.2, ESP[1] - 1, 0], { size: 0.32 })

    const VP: V3 = [11.5, 3.8, 0]
    const vw = 14
    const vh = 4
    const vs = scope(scene, vw, vh, { divs: [6, 4], zeroAt: 0 })
    vs.group.position.set(...VP)
    const yV = (v: number) => (v / 3.3 - 0.5) * vh
    const vTrace = vs.trace(HEAT, { samples: 240, radius: 0.07 })
    vs.level(GREY).set(yV(TOUCH.vHigh))
    vs.level(GREY).set(yV(TOUCH.vLow))
    addLabel(scene, `pad voltage, ${Math.round(SWEEP * 1e6)} µs, slowed ${SLOW / 1000}k×`, [VP[0], VP[1] + vh / 2 + 0.9, 0], LABEL, 0.38)
    addLabel(scene, '2.7 V', [VP[0] + vw / 2 + 1.3, VP[1] + yV(TOUCH.vHigh), 0], GREY, 0.3)
    addLabel(scene, '0.5 V', [VP[0] + vw / 2 + 1.3, VP[1] + yV(TOUCH.vLow), 0], GREY, 0.3)
    const cyclesTag = liveLabel(scene, [VP[0], VP[1] - vh / 2 - 0.8, 0], { size: 0.34 })

    const CP: V3 = [11.5, -4.4, 0]
    const cw = 14
    const ch = 5
    const cs = scope(scene, cw, ch, { divs: [8, 4], zeroAt: 0 })
    cs.group.position.set(...CP)
    const TOP = 80
    const yC = (c: number) => (c / TOP - 0.5) * ch
    const cTrace = cs.trace(B_FIELD, { samples: 200, radius: 0.08 })
    const sTrace = cs.trace(POWER, { samples: 200, radius: 0.06 })
    const onLvl = cs.level(RING)
    const offLvl = cs.level(GREY, 0.3)
    addLabel(scene, 'touchRead(T0), last 8 s', [CP[0], CP[1] + ch / 2 + 0.9, 0], LABEL, 0.38)
    addLabel(scene, `${TOP}`, [CP[0] + cw / 2 + 0.9, CP[1] + ch / 2, 0], GREY, 0.3)
    addLabel(scene, '0', [CP[0] + cw / 2 + 0.7, CP[1] - ch / 2, 0], GREY, 0.3)
    const onTag = liveLabel(scene, [CP[0] - cw / 2 + 0.4, 0, 0.3], { size: 0.3, align: 'left', color: RING })

    const code = codeBlock(scene, [-19, -9.6, 0], 0.32, 3)
    const text = textLines(scene, [-19, 10.2, 0])
    const pinC = new THREE.Color(PIN_COLOR)
    const s = { key: '', t: 0, acc: 0, k: 0, hist: [] as { c: number; on: boolean }[], on: false }
    return {
      scene,
      view: { center: [0, 2.4, 0], radius: 72, polar: 1.3, azimuth: 0 },
      frame(dt, p) {
        const S = touchSetup(p)
        const key = `${S.cover}|${S.water}|${S.thr}|${S.hyst}`
        if (key !== s.key) {
          Object.assign(s, { key, t: 0, acc: 0, on: false })
          s.hist = Array.from({ length: N_HIST }, () => ({ c: S.wet, on: false }))
          code(touchCode(S))
          onLvl.set(yC(S.on))
          offLvl.set(yC(S.off))
          offLvl.group.visible = S.hyst
          onTag.group.position.y = CP[1] + yC(S.off) + 0.45
          onTag.set(S.hyst ? `on < ${S.on} · off > ${S.off}` : `< ${S.on}`)
        }
        s.t += dt
        s.acc += dt
        const gap = gapAt(s.t)
        while (s.acc >= 1 / RATE) {
          s.acc -= 1 / RATE
          const c = touchCount(padFarads(S.cover, gapAt(s.t - s.acc) / 1000, S.water), ++s.k)
          s.on = touchState(s.on, c, S.on, S.off)
          s.hist.push({ c, on: s.on })
          s.hist.shift()
        }
        const H = (u: number) => s.hist[Math.min(N_HIST - 1, Math.floor(u * N_HIST))]
        cTrace.draw((u) => yC(H(u).c), 1)
        sTrace.draw((u) => (H(u).on ? -ch / 2 + 0.9 : -ch / 2 + 0.2), null)
        let toggles = 0
        for (let i = 1; i < N_HIST; i++) if (s.hist[i].on !== s.hist[i - 1].on) toggles++

        const th = COVER_UNITS[S.cover]
        const top = PY + 0.07 + th
        cover.scale.set(1, th, 1)
        cover.position.set(PX, PY + 0.07 + th / 2, 0)
        coverTag.set(S.cover === 'bare' ? 'solder mask' : COVERS[S.cover].replace(' plastic', ' cover'))
        finger.position.set(PX, top + gap * MM_U, 0)
        const cf = fingerC(S.cover, gap / 1000)
        const fieldK = Math.min(1, Math.max(0, Math.log10(cf / 0.05e-12) / Math.log10(80 / 0.05)))
        setGlow(fieldM, B_FIELD, 1.4 * fieldK)
        rods.forEach((r, i) => {
          const x = PX + (i - 2) * 0.8
          stretchRod(r, [x, PY + 0.1, 0.4], [PX + (i - 2) * 0.45, top + gap * MM_U, 0.4], 0.01 + 0.07 * fieldK)
        })
        drop.visible = S.water === 'drop'
        drop.position.set(PX + 1.6, top + 0.2, 0.6)
        puddle.visible = S.water === 'puddle'
        puddle.position.set(PX + 3.2, top + 0.08, 0.2)
        gapTag.group.position.y = top + gap * MM_U + 1.1
        gapTag.set(gap > 0.05 ? `${gap.toFixed(1)} mm · +${pF(cf)}` : `touching · +${pF(cf)}`, gap > 0.05 ? LABEL : B_FIELD)

        const cNow = padFarads(S.cover, gap / 1000, S.water)
        vTrace.draw((u) => yV(padVolts(u * SWEEP + s.t / SLOW, cNow)), 1)
        const last = s.hist[N_HIST - 1]
        cyclesTag.set(`${pF(cNow)} → ${si(padPeriod(cNow), 's', 3)} per cycle → ${last.c} in 0.5 ms`, HEAT)
        setGlow(padM, s.on ? POWER : '#c8803f', s.on ? 1 : 0.15)
        padGlow.set(0.3 + 0.7 * (1 - last.c / Math.max(1, S.base)), pinC)
        setGlow(ledM, POWER, s.on ? 1.6 : 0.05)
        ledTag.set(s.on ? 'touched' : 'idle', s.on ? POWER : GREY)

        const head = S.falseTouch
          ? `False touch: the ${S.water === 'puddle' ? 'puddle' : 'droplet'} alone reads ${S.wet} < ${S.on}`
          : S.missed
            ? `Never fires: touching only gets ${S.pressed}, threshold ${S.on}`
            : toggles > 2
              ? `Chatter: ${toggles} switches in one press, add hysteresis`
              : 'One press, one touch event'
        const bad = S.falseTouch || S.missed
        text.a.set(head, bad ? HIGH_V : toggles > 2 ? HEAT : POWER)
        text.b.set(`idle ${S.base} (dry) · water ${S.wet} · touched ${S.pressed} · drop ${S.base - S.pressed} counts`, LABEL)
        text.c.set(`finger ${pF(fingerC(S.cover, 0))} through the ${S.cover === 'bare' ? 'mask' : 'cover'}${S.water !== 'none' ? ` · water ${pF(waterC(S.cover, S.water))}` : ''} · pad ${pF(TOUCH.padF)}`, B_FIELD)
        text.status.set(`press every ${CYCLE} s · 50 reads/s, real time · ${S.hyst ? `release above ${S.off}` : 'release at the same level'}`, GREY)
      },
      readouts: (p) => {
        const S = touchSetup(p)
        return [
          { label: 'Idle count', value: `${S.wet}`, tone: S.falseTouch ? 'bad' : S.wet < S.base ? 'warn' : 'ok' },
          { label: 'Touched', value: `${S.pressed}`, tone: S.missed ? 'bad' : 'ok' },
          { label: 'Threshold', value: S.hyst ? `${S.on} / ${S.off}` : `${S.on}`, tone: S.hyst ? 'ok' : 'warn' },
          { label: 'Finger adds', value: pF(fingerC(S.cover, 0)), tone: fingerC(S.cover, 0) < 2e-12 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
