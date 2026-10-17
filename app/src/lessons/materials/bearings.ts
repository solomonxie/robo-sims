import * as THREE from 'three/webgpu'
import {
  BALL_BEARINGS,
  BUSHING,
  BUSHINGS,
  BushingKey,
  BushingVerdict,
  PLAIN_HOLE_MU,
  ROLLING_MU,
  ballBearingView,
  ballLoads,
  bushingView,
  frictionTorque,
} from '../../core/physics'
import { celsiusText, fixedText, mmFixed, newtonsText, pct, spanText } from '../../core/units'
import { V3, add, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  MATERIAL_TINT,
  POWER,
  RING,
  WIDE_RIGHT,
  WIDE_VIEW,
  addLabel,
  ballBearing,
  bearingSection,
  countBars,
  flatBox,
  forceArrow,
  glowDot,
  glowMat,
  heatGlow,
  liveLabel,
  memoBy,
  plotY,
  setGlow,
  ringTube,
  shellMat,
  statusHeader,
  textRows,
  titledScope,
  toneColor,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const nmm = (T: number) => `${fixedText(T * 1000, T < 0.001 ? 3 : T < 0.01 ? 2 : T < 0.1 ? 1 : 0)} N·mm`

// --- Ball bearings: an open 608/625/MR63 spinning under the near bearing's load, the two-bearing wheel shaft, friction vs a plain hole. ---

const BB = { at: [-9.4, -5.6, 0] as V3, r: 6.3, shaft: { y: -5.2, x: 13.4, w: 10.5, h: 3.4, wheelR: 3 }, bars: [6.4, -11.4, 0] as V3, rpm: 300 }
const bbRun = memoBy(
  (p: Params) => `${p.bearing} ${p.load} ${p.spacing} ${p.overhang}`,
  (p: Params) => {
    const bk = pick(BALL_BEARINGS, p.bearing, 'b608')
    return { bk, load: n(p, 'load'), spacing: n(p, 'spacing'), overhang: n(p, 'overhang'), V: ballBearingView(bk, n(p, 'load'), n(p, 'spacing'), n(p, 'overhang'), BB.rpm) }
  },
)
const ballTint = (f: number) => (f > 0.66 ? HIGH_V : f > 0.33 ? HEAT : POWER)

export const bearingsBallBearings: Lesson = {
  id: 'bearings-ball-bearings',
  title: 'Ball bearings',
  tagline: 'Balls roll between two races, so a loaded shaft spins almost freely',
  formula: (p) => {
    const { load, spacing, overhang, V } = bbRun(p)
    return `lever balance about the near bearing: far = W·a/s = ${newtonsText(load, 0)} · ${mmFixed(overhang, 0)} / ${mmFixed(spacing, 0)} = ${newtonsText(V.far, 1)} · near = W + far = ${newtonsText(V.near, 1)} · busiest ball ≈ 4.4·F/z = ${newtonsText(V.peakBall, 1)} · friction T = μ·F·d/2, μ ≈ ${ROLLING_MU} rolling vs ${PLAIN_HOLE_MU} in a printed hole (typical) · static safety C0/F = ${fixedText(V.life.s0, 1)}`
  },
  legend: [
    { color: POWER, label: 'Lightly loaded ball', shape: 'dot' },
    { color: HIGH_V, label: 'Busiest ball', shape: 'dot' },
    { color: FORCE, label: 'Forces on the shaft', shape: 'dot' },
    { color: RING, label: 'Near bearing', shape: 'dot' },
  ],
  points: [
    'A ball bearing is an inner race on the shaft, an outer race in the frame, and a ring of hardened balls held apart by a cage. The balls roll instead of sliding, so friction drops to μ ≈ 0.001–0.002 (typical), about 200 times less than a steel shaft rubbing in a printed hole. Rolling resistance is the same idea as in Mechanics › Friction & traction.',
    'A radial load is not shared evenly: only the balls on the loaded side touch, and the one straight under the load carries about 4.4 times the even share (Stribeck). As the cage turns, each ball takes its turn under the load. The rating sheet gives a static load C0 (dents the races) and a dynamic load C for life: L10 = (C/F)³ million turns, so double the load means an eighth of the life.',
    'A deep-groove bearing takes radial load and some axial (thrust) load, but almost no moment. That is why a wheel shaft needs two bearings spaced apart: the overhanging wheel makes a moment that the pair turns into a push and a pull, from the same lever balance as Torque & levers › Static balance. Close together, both bearings carry many times the wheel load.',
    'Seat the outer race in a hole: a press fit (printed about 0.1 mm under the outside diameter, typical, tune on a test print) holds it without glue; a slip fit needs a clip or glue. Fits in sheet parts: Laser & CNC › Kerf. Robots use 608 (skate wheels, idlers), 625 (belt idlers) and tiny MR-series bearings in arms. Cheaper and slower: Bushings.',
  ],
  controls: [
    { kind: 'choice', key: 'bearing', options: opts(namesOf(BALL_BEARINGS)), initial: 'b608' },
    { kind: 'slider', key: 'load', label: 'Wheel load', min: 5, max: 200, step: 5, initial: 40, format: (v) => `${v} N` },
    { kind: 'slider', key: 'spacing', label: 'Bearing spacing', min: 5, max: 60, step: 1, initial: 20, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'overhang', label: 'Wheel overhang', min: 5, max: 40, step: 1, initial: 15, format: (v) => `${v} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const face = add(scene, new THREE.Group(), BB.at)
    const faceTitle = liveLabel(scene, [BB.at[0], BB.at[1] + BB.r + 1.1, 0.3], { size: 0.32 })
    const shaftM = mat('#8f98a6', { metal: 0.6, rough: 0.35 })
    const shaftEnd = add(face, new THREE.Group())
    const ballTags = Array.from({ length: 8 }, () => liveLabel(scene, [0, 0, 0.6], { size: 0.26 }))
    const loadArrow = forceArrow(scene, FORCE, { r: 0.14, size: 0.3 })
    let model: ReturnType<typeof ballBearing> | null = null
    let built = ''
    const st = { inner: 0 }

    const S = BB.shaft
    addLabel(scene, 'wheel shaft on two bearings, side cut', [2.2, 0.3, 0.3], LABEL, 0.28, 'left')
    const side = add(scene, new THREE.Group())
    let sideKey = ''
    const arrows = [0, 1, 2].map(() => forceArrow(scene, FORCE, { r: 0.1, size: 0.26 }))

    addLabel(scene, `friction torque on the shaft`, [2.2, BB.bars[1] + 0.9, 0.3], LABEL, 0.28, 'left')
    const bars = countBars(scene, BB.bars, ['ball bearing', 'bronze bushing', 'printed hole'], 6.2, { row: 0.75, size: 0.26 })
    const rows = textRows(scene, 4, 2.4, 3.4, 0.32, 0.75)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { bk, load, spacing, overhang, V } = bbRun(p)
        const b = V.b
        const k = (2 * BB.r) / b.D
        if (bk !== built) {
          built = bk
          face.clear()
          model = ballBearing(face, b, k)
          const housing = ringTube(face, BB.r, BB.r + 0.5, b.B * k * 1.4, shellMat(MATERIAL_TINT.pla, 0.5, 0.6))
          housing.position.z = -0.05
          shaftEnd.clear()
          face.add(shaftEnd)
          cylinder(shaftEnd, (b.d / 2) * k * 0.98, b.B * k * 2, shaftM, [0, 0, 0], 'z', 32)
          flatBox(shaftEnd, [0.12, (b.d / 2) * k * 0.9, 0.05], glowMat(RING, 0.8), [0, (b.d / 4) * k, b.B * k + 0.05])
        }
        st.inner = (st.inner + dt * 1.6) % (2 * Math.PI)
        const cage = (st.inner / 2) * (1 - b.ball / ((b.d + b.D) / 2))
        const L = ballLoads(b.balls, V.near, cage)
        model!.set(st.inner, cage, L.loads.map((q) => (q > 1e-6 ? ballTint(q / L.max) : null)))
        shaftEnd.rotation.z = st.inner
        ballTags.forEach((t, i) => {
          const q = L.loads[i] ?? 0
          t.group.visible = q > 0.05 * L.max
          if (!t.group.visible) return
          const a = L.psi[i]
          const R = BB.r + 1.7
          t.group.position.set(BB.at[0] + R * Math.sin(a), BB.at[1] - R * Math.cos(a), 0.6)
          t.set(newtonsText(q, 0), ballTint(q / L.max))
        })
        const len = Math.min(3.2, 0.8 + V.near / 60)
        loadArrow([BB.at[0], BB.at[1] + len, 1.2], [BB.at[0], BB.at[1], 1.2], newtonsText(V.near, 0), [1.2, len + 0.6, 0])
        faceTitle.set(`${b.name}: ${b.d} × ${b.D} × ${b.B} mm, ${b.balls} balls`, RING)

        const sk = `${bk}|${spacing}|${overhang}`
        const sk1 = Math.min(0.35, S.w / (spacing + overhang))
        const xn = S.x - overhang * sk1
        const xf = xn - Math.max(spacing * sk1, (b.B * S.h) / b.D + 0.9)
        const xw = S.x
        const bs = S.h / b.D
        if (sk !== sideKey) {
          sideKey = sk
          side.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
          side.clear()
          const plateM = shellMat(MATERIAL_TINT.plywood, 0.55, 0.6)
          for (const x of [xn, xf]) {
            bearingSection(side, b, bs, [x, S.y, 0])
            for (const s of [-1, 1]) add(side, mesh(new THREE.BoxGeometry(b.B * bs + 0.5, 1.2, 1.4), plateM), [x, S.y + s * ((b.D / 2) * bs + 0.6), 0])
          }
          cylinder(side, (b.d / 2) * bs, xw - xf + 1.6, shaftM, [(xw + xf) / 2, S.y, 0], 'x', 24)
          cylinder(side, S.wheelR, 1, mat('#3a3f4a', { rough: 0.8 }), [xw, S.y, 0], 'x', 32)
          addLabel(side, 'near', [xn, S.y - (b.D / 2) * bs - 1.7, 0.3], RING, 0.26)
          addLabel(side, 'far', [xf - (b.B * bs) / 2 - 0.6, S.y, 0.3], GREY, 0.26, 'right')
          addLabel(side, `s ${mmFixed(spacing, 0)}`, [(xn + xf) / 2, S.y + (b.D / 2) * bs + 1.7, 0.3], GREY, 0.24)
          addLabel(side, `a ${mmFixed(overhang, 0)}`, [(xn + xw) / 2, S.y + 0.9, 0.3], GREY, 0.24)
        }
        const scale = 2.2 / Math.max(V.near, 1e-9)
        const top = S.y + (b.D / 2) * bs + 1.2
        const bot = S.y - (b.D / 2) * bs - 1.2
        arrows[0]([xw, S.y - S.wheelR - load * scale, 0.8], [xw, S.y - S.wheelR, 0.8], `W ${newtonsText(load, 0)}`, [1.4, -0.2, 0])
        arrows[1]([xn, top + V.near * scale, 0.8], [xn, top, 0.8], newtonsText(V.near, 0), [1.5, V.near * scale + 0.2, 0])
        arrows[2]([xf, bot - V.far * scale, 0.8], [xf, bot, 0.8], newtonsText(V.far, 0), [-1.5, -V.far * scale - 0.2, 0])

        const T = V.torque
        const bronze = frictionTorque(BUSHINGS.bronze.mu, V.near, b.d)
        bars.set([T.ball, bronze, T.plain], [nmm(T.ball), nmm(bronze), nmm(T.plain)], [POWER, HEAT, HIGH_V])

        const s0 = V.life.s0
        const okS = toneOf(s0 >= 4, s0 >= 1)
        rows[0].set(`near ${newtonsText(V.near, 0)} · far ${newtonsText(V.far, 0)} for a ${newtonsText(load, 0)} wheel`, RING)
        rows[1].set(`${b.name}: C0 ${newtonsText(b.C0, 0)} → static safety ${fixedText(s0, 1)}`, toneColor[okS!])
        rows[2].set(`life L10 ${spanText(V.life.hours)} at ${BB.rpm} rpm (typical)`, V.life.hours > 5000 ? POWER : HEAT)
        rows[3].set(`printed seat: press ${mmFixed(V.seat.press, 2)} · slip ${mmFixed(V.seat.slip, 2)} (typical)`, GREY)
        head.status.set(`Ball bearings · ${b.name} · wheel ${newtonsText(load, 0)} · s ${mmFixed(spacing, 0)} · a ${mmFixed(overhang, 0)}`)
        head.sub.set(`near bearing face-on, balls coloured by load; ${b.use}`, GREY)
        head.event.set(
          s0 < 1 ? `${b.name} overloaded: the busiest ball dents the races, pick a bigger bearing or space them wider` : `rolling: ${Math.round(T.plain / T.ball)}× less friction than a plain hole`,
          s0 < 1 ? HIGH_V : POWER,
        )
      },
      readouts: (p) => {
        const { V } = bbRun(p)
        return [
          { label: 'Near bearing', value: newtonsText(V.near, 0) },
          { label: 'Far bearing', value: newtonsText(V.far, 0) },
          { label: 'Busiest ball', value: newtonsText(V.peakBall, 0) },
          { label: 'Static safety', value: fixedText(V.life.s0, 1), tone: toneOf(V.life.s0 >= 4, V.life.s0 >= 1) },
        ]
      },
    }
  },
}

// --- Bushings: a shaft in a plain sleeve; friction torque and heat, PV limit, clearance wobble; vs a ball bearing. ---

const BUSH_KEYS = Object.keys(BUSHINGS) as BushingKey[]
const BUSH_TINT: Record<BushingKey, string> = { bronze: '#b9803f', polymer: '#d9d4c7', pla: MATERIAL_TINT.pla }
const VERDICT: Record<BushingVerdict, [string, string]> = {
  ok: ['runs cool, well inside the PV limit', POWER],
  warm: ['warm: over half the PV limit', HEAT],
  wears: ['over the PV limit: wears fast', HIGH_V],
  melts: ['too hot for this sleeve: past its temperature limit it wears and seizes', HIGH_V],
  crushed: ['pressure too high: the sleeve creeps and crushes', HIGH_V],
}
const BU = { end: [-9.6, -2.2, 0] as V3, k: 0.44, exag: 12, tiltExag: 5, side: [-13, -11.2, 0] as V3, vMax: 1.5, pMax: 4, bars: [7.4, -1.6, 0] as V3 }
const buRun = memoBy(
  (p: Params) => `${p.bushing} ${p.load} ${p.rpm} ${p.clear}`,
  (p: Params) => {
    const bk = pick(BUSHINGS, p.bushing, 'bronze')
    return { bk, load: n(p, 'load'), rpm: n(p, 'rpm'), clear: n(p, 'clear'), V: bushingView(bk, n(p, 'load'), n(p, 'rpm'), n(p, 'clear')) }
  },
)

export const bearingsBushings: Lesson = {
  id: 'bearings-bushings',
  title: 'Bushings',
  tagline: 'A plain sleeve: cheap and compact, until pressure × speed heats it up',
  formula: (p) => {
    const { bk, load, V } = buRun(p)
    const s = V.s
    return `P = F/(d·L) = ${newtonsText(load, 0)} / (${BUSHING.d} mm · ${BUSHING.len} mm) = ${fixedText(s.p, 2)} MPa · v = π·d·n = ${fixedText(s.v, 2)} m/s · PV = ${fixedText(s.pv, 3)} of ${BUSHINGS[bk].pv} MPa·m/s (typical) · T = μ·F·d/2 = ${nmm(s.torque)} · heat T·ω = ${fixedText(s.heatW, 2)} W → ≈ ${celsiusText(s.tempC)}`
  },
  legend: [
    { color: BUSH_TINT.bronze, label: 'Bushing sleeve', shape: 'dot' },
    { color: HEAT, label: 'Rubbing contact, hot', shape: 'dot' },
    { color: FORCE, label: 'Load on the shaft', shape: 'dot' },
    { color: RING, label: 'Chosen sleeve, PV limit', shape: 'dot' },
  ],
  points: [
    'A bushing (plain bearing) is just a sleeve the shaft slides in: oil-filled sintered bronze, a self-lubricating polymer such as igus, or simply a printed hole. The shaft rubs, so the friction torque is T = μ·F·d/2 with μ ≈ 0.08–0.35 (typical), 50–200 times a ball bearing, and all of it turns into heat (power T·ω, as in Energy & work › Efficiency).',
    'The limit is pressure times speed. P = F/(d·L) is the load over the projected area, v = π·d·n the rubbing speed, and every material has a PV limit (typical: bronze about 1.8, polymer about 0.4, PLA about 0.05 MPa·m/s). Above it the sleeve wears fast or heats until it softens; PLA softens near 60 °C.',
    'A sleeve needs clearance to turn, and clearance is wobble: a gap c in a sleeve of length L lets the shaft tilt by c/L, which a long arm magnifies at its tip. Longer sleeves (L ≥ d) and tighter fits wobble less but bind more easily; a ball bearing pair has almost none.',
    'Choose a bushing when it is slow, oscillating or rarely turned: a servo-arm pivot, a hinge, a linkage, a cheap slow axle. It is compact (a thin wall instead of a 7 mm-wide bearing), cheap, quiet and takes shock. Choose ball bearings when it spins fast, runs for hours or must feel free: wheels, idlers, motor shafts (Ball bearings).',
  ],
  controls: [
    { kind: 'choice', key: 'bushing', options: opts(namesOf(BUSHINGS)), initial: 'pla' },
    { kind: 'slider', key: 'load', label: 'Radial load', min: 5, max: 300, step: 5, initial: 40, format: (v) => `${v} N` },
    { kind: 'slider', key: 'rpm', label: 'Shaft speed', min: 10, max: 1500, step: 10, initial: 200, format: (v) => `${v} rpm` },
    { kind: 'slider', key: 'clear', label: 'Clearance', min: 0.02, max: 0.4, step: 0.02, initial: 0.1, format: (v) => `${v.toFixed(2)} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const k = BU.k
    const d = BUSHING.d
    const endG = add(scene, new THREE.Group(), BU.end)
    addLabel(scene, `${d} mm shaft in an ${d} mm long sleeve, end view`, [BU.end[0], BU.end[1] + 5.6, 0.3], LABEL, 0.28)
    const housingM = shellMat(MATERIAL_TINT.plywood, 0.55, 0.6)
    ringTube(endG, 7 * k, 11 * k, 1, housingM)
    const sleeveM = new THREE.MeshStandardMaterial({ color: BUSH_TINT.bronze, metalness: 0.5, roughness: 0.4 })
    const sleeve = ringTube(endG, (d / 2) * k, 7 * k, 1.1, sleeveM)
    const shaftG = add(endG, new THREE.Group())
    const steel = mat('#8f98a6', { metal: 0.6, rough: 0.35 })
    cylinder(shaftG, (d / 2) * k * 0.97, 1.6, steel, [0, 0, 0.2], 'z', 40)
    flatBox(shaftG, [0.14, (d / 2) * k * 0.85, 0.05], glowMat(RING, 0.8), [0, (d / 4) * k, 1.05])
    const contactM = glowMat(HEAT, 0)
    const contact = add(endG, mesh(new THREE.TorusGeometry((d / 2) * k, 0.12, 8, 24, Math.PI * 0.45), contactM), [0, 0, 0.62])
    contact.rotation.z = -Math.PI / 2 - Math.PI * 0.225
    const loadArrow = forceArrow(scene, FORCE, { r: 0.14, size: 0.3 })
    const tempTag = liveLabel(scene, [BU.end[0], BU.end[1] - 5.8, 0.5], { size: 0.3 })

    const sideG = add(scene, new THREE.Group(), BU.side)
    const k2 = 0.32
    for (const s of [-1, 1]) add(sideG, mesh(new THREE.BoxGeometry(BUSHING.len * k2, 1, 0.6), sleeveM), [0, s * ((d / 2) * k2 + 0.55), 0])
    const arm = add(sideG, new THREE.Group())
    add(arm, mesh(new THREE.BoxGeometry(BUSHING.len * k2 + 1.2, d * k2 * 0.92, 0.3), steel))
    add(arm, mesh(new THREE.BoxGeometry(8, 0.5, 0.4), mat('#3a3f4a', { rough: 0.7 })), [4.2, 0, 0.4])
    const tipDot = glowDot(arm, 0.22, RING)
    tipDot.position.set(8.2, 0, 0.6)
    addLabel(scene, `arm ${BUSHING.armMm} mm, tilt ×${BU.tiltExag}`, [BU.side[0] - 1.3, BU.side[1] - 2.7, 0.3], GREY, 0.24, 'left')
    const playTag = liveLabel(scene, [BU.side[0] + 9, BU.side[1] - 2.7, 0.3], { size: 0.28, align: 'right' })
    const st = { spin: 0, t: 0 }

    addLabel(scene, 'friction torque, same load', [2.2, BU.bars[1] + 0.9, 0.3], LABEL, 0.28, 'left')
    const bars = countBars(scene, BU.bars, [...BUSH_KEYS.map((b) => BUSHINGS[b].name), 'Ball bearing'], 5.2, { row: 0.75, size: 0.26 })
    const P = WIDE_RIGHT
    const plot = titledScope(scene, P.y, P.h, 'PV chart: load P vs speed v', LABEL, 0, P.x, P.w)
    const py = plotY(0, BU.pMax, P.h)
    const curves = BUSH_KEYS.map(() => plot.s.trace(GREY, { samples: 121, radius: 0.06 }))
    const marker = glowDot(plot.s.group, 0.26, RING)
    const tagAt: Record<BushingKey, [number, number]> = { bronze: [0.97, BUSHINGS.bronze.pv / (0.97 * BU.vMax) + 0.35], polymer: [0.97, BUSHINGS.polymer.pv / (0.97 * BU.vMax) + 0.35], pla: [0.07, 1.1] }
    BUSH_KEYS.forEach((b) => addLabel(plot.s.group, ({ bronze: 'bronze', polymer: 'polymer', pla: 'PLA' })[b], [plot.s.xAt(tagAt[b][0]), py(tagAt[b][1]), 0.4], GREY, 0.22, b === 'pla' ? 'left' : 'right'))
    addLabel(plot.s.group, `${BU.pMax} MPa`, [P.w / 2 - 0.2, P.h / 2 - 0.4, 0.4], GREY, 0.22, 'right')
    const rows = textRows(scene, 4, 2.4, 3.4, 0.32, 0.75)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { bk, load, rpm, clear, V } = buRun(p)
        const s = V.s
        const m = BUSHINGS[bk]
        sleeve.visible = bk !== 'pla'
        sleeveM.color.set(BUSH_TINT[bk])
        housingM.color.set(bk === 'pla' ? MATERIAL_TINT.pla : MATERIAL_TINT.plywood)
        st.spin = (st.spin + dt * Math.min(6, 0.4 + rpm / 150)) % (2 * Math.PI)
        st.t += dt
        const drop = (clear / 2) * k * BU.exag
        shaftG.position.y = -drop
        shaftG.rotation.z = -st.spin
        contact.position.y = -drop
        const hot = Math.min(1, Math.max(0, (s.tempC - BUSHING.ambientC) / (m.maxC - BUSHING.ambientC)))
        heatGlow(contactM, 0.15 + 0.85 * hot)
        const len = Math.min(3, 0.8 + load / 80)
        const top = BU.end[1] - drop + (d / 2) * k
        loadArrow([BU.end[0], top + len, 1.4], [BU.end[0], top, 1.4], newtonsText(load, 0), [1.3, len + 0.4, 0])
        tempTag.set(`contact ≈ ${celsiusText(s.tempC)}, ${m.name} limit ${celsiusText(m.maxC)}`, s.tempC > m.maxC ? HIGH_V : hot > 0.6 ? HEAT : POWER)
        arm.rotation.z = Math.sin(st.t * 2.2) * s.tilt * BU.tiltExag
        playTag.set(`tip play ±${mmFixed(s.play / 2, 2)}`, s.play > 1 ? HEAT : LABEL)

        bars.set([...V.all.map((a) => a.torque), V.ballTorque], [...V.all.map((a) => nmm(a.torque)), nmm(V.ballTorque)], [...BUSH_KEYS.map((b) => (b === bk ? RING : BUSH_TINT[b])), POWER])

        const us = Array.from({ length: 121 }, (_, i) => i / 120)
        BUSH_KEYS.forEach((b, j) => {
          curves[j].points(us, us.map((u) => py(Math.min(BU.pMax * 1.05, BUSHINGS[b].pv / Math.max(u * BU.vMax, 1e-6)))), null)
          setGlow(curves[j].material, b === bk ? RING : GREY, b === bk ? 1.1 : 0.3)
        })
        const vu = Math.min(1, s.v / BU.vMax)
        marker.position.set(plot.s.xAt(vu), py(Math.min(BU.pMax, s.p)), 0.46)
        ;(marker.material as THREE.MeshStandardMaterial).emissive.set(VERDICT[s.verdict][1])
        plot.lo.set('v 0')
        plot.hi.set(`${BU.vMax} m/s`)
        plot.right.set(`PV ${fixedText(s.pv, 3)} = ${pct(s.ratio)} of limit`, VERDICT[s.verdict][1])

        rows[0].set(`P ${fixedText(s.p, 2)} MPa · v ${fixedText(s.v, 2)} m/s · PV ${pct(s.ratio)} of limit`, VERDICT[s.verdict][1])
        rows[1].set(`friction ${nmm(s.torque)} → ${fixedText(s.heatW, 2)} W of heat`, s.heatW > 1 ? HEAT : LABEL)
        rows[2].set(`clearance ${mmFixed(clear, 2)} → tilt ${fixedText((s.tilt * 180) / Math.PI, 2)}°`, GREY)
        rows[3].set(`ball bearing: ${nmm(V.ballTorque)}, ${fixedText(V.ballHeat, 3)} W`, POWER)
        head.status.set(`Bushings · ${m.name} · ${newtonsText(load, 0)} · ${rpm} rpm`)
        head.sub.set(`${d} mm steel shaft, clearance drawn ×${BU.exag}; values typical`, GREY)
        head.event.set(...VERDICT[s.verdict])
      },
      readouts: (p) => {
        const { V } = buRun(p)
        const s = V.s
        return [
          { label: 'PV / limit', value: pct(s.ratio), tone: toneOf(s.ratio <= 0.5, s.ratio <= 1) },
          { label: 'Friction', value: nmm(s.torque) },
          { label: 'Contact', value: celsiusText(s.tempC), tone: s.verdict === 'melts' ? 'bad' : undefined },
          { label: 'Tip play', value: mmFixed(s.play, 2) },
        ]
      },
    }
  },
}
