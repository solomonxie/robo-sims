import * as THREE from 'three/webgpu'
import {
  FC51,
  Follower,
  IR_NM,
  LOST,
  SUN,
  SURFACES,
  Surface,
  TCRT,
  ambientAmps,
  detectRange,
  followStep,
  modulatedReceiver,
  obstacleReading,
  photoVolts,
  plainReceiver,
  reflectedAmps,
  remoteAmps,
  sensorAt,
  sensorX,
  startFollower,
  trackOffset,
  trackPoint,
  vs1838Floor,
} from '../../core/physics'
import { amps } from '../../core/units'
import { buildLed } from '../../models/passives'
import { V3, add, box, cylinder, mat, tube } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CODE_LEGEND,
  DATA_COLOR,
  GREY,
  HEAT,
  IR_TINT,
  LABEL,
  POWER,
  RING,
  beamCone,
  codeBlock,
  glide,
  glowHalo,
  glowMat,
  lightRay,
  liveLabel,
  memoBy,
  partLetter,
  scope,
  setGlow,
  shadowlessRod,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'

const rodTo = (parent: THREE.Object3D, m: THREE.Material) => add(parent, shadowlessRod(m))
const SUN_TINT = '#ffc04d'
const signed = (x: number, digits = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`

/** 5 mm LED lying in the screen plane, dome toward `dir` (±1 on x); → its tip and glow. */
function sideLed(parent: THREE.Object3D, color: string, at: V3, dir: 1 | -1, k: number) {
  const led = buildLed(color)
  led.scale.setScalar(k)
  led.updateMatrixWorld(true)
  const top = new THREE.Box3().setFromObject(led).max.y
  const g = add(parent, new THREE.Group(), at)
  g.add(led)
  g.rotation.z = -dir * (Math.PI / 2)
  return { tip: [at[0] + dir * top, at[1], at[2]] as V3, glow: led.userData.setGlow as (f: number) => void }
}

/** SMD indicator LED: `set(on)`. */
function smdLed(parent: THREE.Object3D, at: V3, color: string) {
  const m = glowMat(color, 0.05)
  box(parent, [0.9, 0.5, 0.3], m, at)
  let k = 0
  return (dt: number, on: boolean) => {
    k = glide(dt, k, on ? 1.5 : 0.05, 10)
    setGlow(m, color, k)
  }
}

// --- Obstacle sensor: FC-51 IR LED + photodiode + LM393 against a trim pot. ---

const SURFACE_LABEL: Record<Surface, string> = { white: 'White card', grey: 'Grey card', black: 'Black card' }
const SURFACE_COLOR: Record<Surface, string> = { white: '#ecebe6', grey: '#7d7f84', black: '#2a2b30' }
const CURVE_COLOR: Record<Surface, string> = { white: '#f2f2ee', grey: '#a6abb5', black: '#6d7280' }
const OB = { face: -11, y: 2.4, sc: 0.36, maxCm: 60 }

const obRun = memoBy(
  (p: Params) => `${p.cm}|${p.surface}|${p.pot}`,
  (p: Params) => {
    const cm = n(p, 'cm')
    const surface: Surface = pick(SURFACES, p.surface, 'white')
    const pot = n(p, 'pot')
    return { cm, surface, pot, ...obstacleReading(cm, surface, pot), range: detectRange(surface, pot) }
  },
)

export const obstacleSensor: Lesson = {
  id: 'infrared-obstacle-sensor',
  title: 'Obstacle sensor',
  tagline: 'Shine IR, measure what bounces back, compare against a knob',
  formula: (p) => {
    const R = obRun(p)
    return `I_LED = (5 − 1.2 V) / 150 Ω = ${(R.ledA * 1000).toFixed(0)} mA · I_ph ∝ ρ / (d + 1 cm)² = ${amps(R.pdA)} · V = I_ph × 100 kΩ = ${R.v.toFixed(2)} V ${R.blocked ? '>' : '<'} pot ${R.pot.toFixed(1)} V → OUT ${R.blocked ? 'LOW: obstacle' : 'HIGH: clear'} · reach on ${R.surface}: ${R.range.toFixed(0)} cm`
  },
  legend: [
    { color: IR_TINT, label: `${IR_NM} nm IR, drawn pink (invisible)`, shape: 'dot' },
    { color: RING, label: 'Pot threshold on the LM393', shape: 'dot' },
    { color: POWER, label: 'OUT LED: lit = obstacle (OUT LOW)', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'An FC-51 module is an IR LED and a photodiode side by side, looking the same way, with a black divider so the LED can’t shine straight into the receiver. The LED glows at 940 nm, invisible to you but plain to most phone cameras.',
    'Whatever is in front scatters some of the IR back. The photodiode turns that light into a few µA, and a 100 kΩ resistor turns the current into a voltage: brighter return, higher voltage.',
    'The return falls roughly with 1/d²: half the distance gives four times the signal. Colour matters as much: white paper sends back ~85 % of the IR, matte black ~5 %, so a black object has to come four times closer to trigger it.',
    'An LM393 comparator checks that voltage against the trim pot. Above it, OUT is pulled LOW and the on-board LED lights. Turning the pot down makes it reach further, but bright rooms and shiny floors then trip it too.',
    'It answers only “something is there”, not how far. OUT is open-collector with a pull-up, fine on a 3.3 V ESP32 pin when the module runs from 3.3 V.',
  ],
  controls: [
    { kind: 'slider', key: 'cm', label: 'Distance', min: 2, max: OB.maxCm, step: 1, initial: 20, format: (v) => `${v} cm` },
    { kind: 'choice', key: 'surface', options: (Object.keys(SURFACES) as Surface[]).map((k) => ({ value: k, label: SURFACE_LABEL[k] })), initial: 'white' },
    { kind: 'slider', key: 'pot', label: 'Trim pot threshold', min: 0.2, max: 4.5, step: 0.1, initial: 1.2, format: (v) => `${v.toFixed(1)} V` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    // FC-51 board, components toward the camera, LEDs pointing right.
    const bx = OB.face - 6.2
    box(scene, [11, 5.2, 0.3], mat('#1f4fa8', { rough: 0.5 }), [bx, OB.y, -0.4])
    const ir = sideLed(scene, '#cfd8ff', [OB.face - 2.6, OB.y + 1.3, 0.4], 1, 0.62)
    const pd = sideLed(scene, '#141418', [OB.face - 2.6, OB.y - 1.3, 0.4], 1, 0.62)
    box(scene, [2.4, 0.25, 1.2], mat('#101012', { rough: 0.8 }), [OB.face - 1.2, OB.y, 0.4])
    partLetter(scene, 'IR LED', [OB.face - 0.6, OB.y + 3.4, 0.4], 0.32, IR_TINT)
    partLetter(scene, 'photodiode', [OB.face - 0.6, OB.y - 3.4, 0.4], 0.32, LABEL)
    box(scene, [2.4, 1.6, 0.6], mat('#1c1d22', { rough: 0.6 }), [bx + 0.6, OB.y - 0.9, 0])
    partLetter(scene, 'LM393', [bx + 0.6, OB.y - 0.9, 0.4], 0.28, GREY)
    box(scene, [1.8, 1.8, 1], mat('#2c64d8', { rough: 0.5 }), [bx + 0.6, OB.y + 1.3, 0.2])
    const screw = add(scene, new THREE.Group(), [bx + 0.6, OB.y + 1.3, 0.75])
    cylinder(screw, 0.55, 0.25, mat('#d9b24a', { metal: 0.4, rough: 0.35 }), [0, 0, 0], 'z', 16)
    box(screw, [0.9, 0.16, 0.12], mat('#5a4a20'), [0, 0, 0.14])
    const pwrLed = smdLed(scene, [bx - 2.4, OB.y + 1.6, 0], HEAT)
    const outLed = smdLed(scene, [bx - 2.4, OB.y - 0.2, 0], POWER)
    partLetter(scene, 'PWR', [bx - 2.4, OB.y + 2.3, 0.2], 0.24, GREY)
    partLetter(scene, 'OUT', [bx - 2.4, OB.y - 0.9, 0.2], 0.24, GREY)
    ;['OUT', 'GND', 'VCC'].forEach((t, i) => {
      const y = OB.y + 1.4 - i * 1.4
      box(scene, [1.6, 0.25, 0.25], mat('#d9b24a', { metal: 0.4, rough: 0.35 }), [bx - 6.1, y, 0])
      partLetter(scene, t, [bx - 7.2, y, 0.2], 0.28, GREY, 'right')
    })
    const outText = liveLabel(scene, [bx - 7.6, OB.y - 3.6, 0.3], { size: 0.38, align: 'left' })
    const cmpText = liveLabel(scene, [bx, OB.y + 3.6, 0.3], { size: 0.36 })
    const irHalo = glowHalo(scene, ir.tip, 0.9)
    const pdHalo = glowHalo(scene, pd.tip, 0.9)
    // Target card, beam and rays.
    const card = add(scene, new THREE.Group(), [0, OB.y, 0])
    const cardMat = mat(SURFACE_COLOR.white, { rough: 0.85 }, true)
    box(card, [0.6, 10, 4], cardMat, [0.3, 0, 0])
    const cone = beamCone(scene, IR_TINT)
    const outRays = [0, 1, 2].map(() => lightRay(scene, 12, 0.12))
    const backRays = [0, 1, 2].map(() => lightRay(scene, 12, 0.12))
    const ruler = rodTo(scene, glowMat(GREY, 0.4))
    const rulerText = liveLabel(scene, [0, OB.y - 6.6, 0.3], { size: 0.4 })
    // Plot: photodiode volts vs distance for each surface, with the pot line.
    const PW = 34
    const PH = 6.4
    const PY = -10.4
    const plot = scope(scene, PW, PH, { divs: [12, 5], zeroAt: 0 })
    plot.group.position.set(1, PY, 0)
    const yOf = (v: number) => -PH / 2 + (v / FC51.vcc) * PH
    const curves = (Object.keys(SURFACES) as Surface[]).map((s) => ({ s, tr: plot.trace(CURVE_COLOR[s], { samples: 120, radius: 0.08 }) }))
    curves.forEach(({ s, tr }) => tr.draw((u) => yOf(photoVolts(reflectedAmps(2 + u * (OB.maxCm - 2), SURFACES[s], obstacleReading(10, 'white', 1).ledA))), null))
    const potLine = rodTo(scene, glowMat(RING, 1))
    const marker = add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), glowMat(IR_TINT, 1.2)))
    partLetter(scene, '5 V', [1 - PW / 2 - 0.8, PY + PH / 2, 0], 0.32, GREY, 'right')
    partLetter(scene, '0', [1 - PW / 2 - 0.8, PY - PH / 2, 0], 0.32, GREY, 'right')
    partLetter(scene, '2 cm', [1 - PW / 2, PY - PH / 2 - 1, 0], 0.32, GREY, 'left')
    partLetter(scene, `${OB.maxCm} cm`, [1 + PW / 2, PY - PH / 2 - 1, 0], 0.32, GREY, 'right')
    partLetter(scene, 'signal V vs distance', [1, PY + PH / 2 + 1, 0], 0.34, LABEL)
    const curveNames = (Object.keys(SURFACES) as Surface[]).map((s) => ({ s, l: liveLabel(scene, [0, 0, 0.3], { size: 0.3, align: 'left' }) }))
    const code = codeBlock(scene, [-25, 14.2, 0], 0.38, 4)
    const status = liveLabel(scene, [-25, -16, 0.3], { size: 0.4, align: 'left' })
    const s = { x: OB.face + 8, t: 0, glowKey: '' }
    return {
      scene,
      view: { center: [-1, -0.6, 0], radius: 80, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const R = obRun(p)
        s.t += dt
        s.x = glide(dt, s.x, OB.face + R.cm * OB.sc, 10)
        card.position.x = s.x
        if (s.glowKey !== R.surface) {
          cardMat.color.set(SURFACE_COLOR[R.surface])
          s.glowKey = R.surface
        }
        screw.rotation.z = -((R.pot - 0.2) / 4.3) * Math.PI * 1.5
        ir.glow(0.12)
        irHalo.set(1, IR_TINT)
        const back = Math.min(1.6, R.v / 1.2)
        pdHalo.set(0.15 + 0.9 * Math.min(1, back), IR_TINT)
        cone(ir.tip, 0, 0.26, Math.max(0.5, s.x - ir.tip[0]), 0.1)
        const span = Math.tan(0.26) * (s.x - ir.tip[0]) * 0.7
        ;[-1, 0, 1].forEach((k, i) => {
          const spot: V3 = [s.x, OB.y + 1.3 + k * Math.min(span, 4), 0.4]
          outRays[i]([ir.tip, spot], s.t + i * 0.31, 1.1)
          backRays[i]([spot, pd.tip], s.t + i * 0.31, 0.15 + 1.1 * Math.min(1, back) * (k === 0 ? 1 : 0.7))
        })
        stretchRod(ruler, [OB.face, OB.y - 5.6, 0.3], [s.x, OB.y - 5.6, 0.3], 0.05)
        rulerText.group.position.x = (OB.face + s.x) / 2
        rulerText.set(`d = ${R.cm} cm`, LABEL)
        // Board state.
        pwrLed(dt, true)
        outLed(dt, R.blocked)
        cmpText.set(`signal ${R.v.toFixed(2)} V ${R.blocked ? '>' : '<'} pot ${R.pot.toFixed(1)} V`, R.blocked ? POWER : LABEL)
        outText.set(`OUT ${R.blocked ? 'LOW' : 'HIGH'}`, R.blocked ? POWER : GREY)
        // Plot.
        curves.forEach(({ s: sf, tr }) => setGlow(tr.material, CURVE_COLOR[sf], sf === R.surface ? 1.1 : 0.25))
        curveNames.forEach(({ s: sf, l }) => {
          const u = sf === 'white' ? 0.55 : sf === 'grey' ? 0.3 : 0.1
          const v = photoVolts(reflectedAmps(2 + u * (OB.maxCm - 2), SURFACES[sf], R.ledA))
          l.group.position.set(1 + plot.xAt(u), PY + Math.min(PH / 2 - 0.4, yOf(v)) + 0.5, 0.3)
          l.set(sf, sf === R.surface ? LABEL : GREY)
        })
        const py = PY + yOf(R.pot)
        stretchRod(potLine, [1 - PW / 2, py, 0.3], [1 + PW / 2, py, 0.3], 0.06)
        const u = (R.cm - 2) / (OB.maxCm - 2)
        marker.position.set(1 + plot.xAt(u), PY + Math.min(PH / 2, yOf(R.v)), 0.4)
        code([
          'const int IR_OUT = 27;  // FC-51 OUT, active LOW',
          'pinMode(IR_OUT, INPUT);',
          `bool blocked = digitalRead(IR_OUT) == LOW;  // ${R.blocked}`,
          'if (blocked) stopMotors();',
        ])
        status.set(
          R.blocked
            ? `${R.surface} card at ${R.cm} cm returns ${amps(R.pdA)} → ${R.v.toFixed(2)} V beats the pot: obstacle`
            : `${R.surface} card at ${R.cm} cm returns ${amps(R.pdA)} → ${R.v.toFixed(2)} V, under the pot: it would trip inside ${R.range.toFixed(0)} cm`,
          R.blocked ? POWER : LABEL,
        )
      },
      readouts: (p) => {
        const R = obRun(p)
        return [
          { label: 'IR LED', value: `${(R.ledA * 1000).toFixed(0)} mA` },
          { label: 'Photocurrent', value: amps(R.pdA) },
          { label: 'Signal / pot', value: `${R.v.toFixed(2)} / ${R.pot.toFixed(1)} V` },
          { label: 'OUT', value: R.blocked ? 'LOW: obstacle' : 'HIGH: clear', tone: R.blocked ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Line follower: 5 × TCRT5000 under a car, weighted line position, P steering. ---

const MODES = { analog: 'Analog, weighted', digital: 'Digital, thresholded' }
const LF = { cx: -7.5, cy: 1.2, sc: 12, dt: 0.005, px: 14.6, py: -0.6, pp: 2 }
const fx = (x: number) => LF.cx + x * LF.sc
const fy = (y: number) => LF.cy + y * LF.sc
const TRAIL = 90

export const lineFollower: Lesson = {
  id: 'infrared-line-follower',
  title: 'Line follower',
  tagline: 'Five IR spots read the tape; their weighted average steers the wheels',
  formula: (p) => {
    const digital = pick(MODES, p.mode, 'analog') === 'digital'
    return `ADC_i: white ≈ 370, black ≈ 3800 · w_i = (ADC_i − white) / (black − white)${digital ? ' → 0 or 1' : ''} · pos = Σ w_i·x_i / Σ w_i, x_i = −30, −15, 0, 15, 30 mm · turn = Kp·pos = ${n(p, 'kp')} × pos · left = v(1 + turn), right = v(1 − turn)`
  },
  legend: [
    { color: IR_TINT, label: 'IR spot per TCRT5000 (brighter on white)', shape: 'dot' },
    { color: DATA_COLOR, label: 'Analog reading, 0–4095 (dark tape = high)', shape: 'dot' },
    { color: RING, label: 'Weighted line position → steering', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'A TCRT5000 is an IR LED and a phototransistor in one block, looking down from a few mm. White floor reflects the IR and pulls the output low; black tape absorbs it and the output stays high. Five of them sit across the front of the car, 15 mm apart.',
    'Read them as analog values, not just black/white. A sensor half over the tape reads half-way, so the weighted average Σ w·x / Σ w lands between sensors: millimetre position from five sensors 15 mm apart.',
    'That position is the error. Steer by it: turn = Kp × error, slow the wheel on the line’s side and speed up the other. Too little Kp and the car runs wide on the bends and loses the tape; plenty and it hugs the line.',
    'Thresholding each sensor first (digital) gives only a few possible positions, 0, ±7.5, ±15 mm…, so the steering jumps between steps and the car wiggles. Calibrate white and black for each sensor at start-up: no two TCRT5000s or floors read the same.',
    'Lost the line (all white)? Keep turning toward the side it was last seen. Sunlight and shiny floors fool these sensors too: see Sunlight interference.',
  ],
  controls: [
    { kind: 'slider', key: 'speed', label: 'Base speed', min: 0.1, max: 0.8, step: 0.05, initial: 0.35, format: (v) => `${v.toFixed(2)} m/s` },
    { kind: 'slider', key: 'kp', label: 'Kp (per metre)', min: 5, max: 120, step: 5, initial: 40, format: (v) => `${v}` },
    { kind: 'choice', key: 'mode', options: (Object.keys(MODES) as (keyof typeof MODES)[]).map((k) => ({ value: k, label: MODES[k] })), initial: 'analog' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    box(scene, [27, 18, 0.2], mat('#e6e5df', { rough: 0.9 }), [LF.cx, LF.cy, -0.35])
    const tape = mat('#141416', { rough: 0.8 })
    tube(scene, Array.from({ length: 241 }, (_, i) => {
      const q = trackPoint(i / 240)
      return [fx(q.x), fy(q.y), -0.2] as V3
    }), (TCRT.lineM / 2) * LF.sc * 1.6, tape, 480)
    // Car (top view): chassis, wheels, sensor bar.
    const car = add(scene, new THREE.Group())
    const k = LF.sc
    box(car, [0.17 * k, 0.11 * k, 0.4], mat('#3d6fd8', { rough: 0.5 }), [0.02 * k, 0, 0.3])
    for (const side of [-1, 1]) box(car, [0.065 * k, 0.025 * k, 0.6], mat('#1c1c1f', { rough: 0.8 }), [0, side * 0.075 * k, 0.3])
    box(car, [0.02 * k, 0.085 * k, 0.4], mat('#202226'), [0.09 * k, 0, 0.5])
    const dots = Array.from({ length: TCRT.count }, (_, i) => {
      const m = glowMat(IR_TINT, 0.4)
      cylinder(car, 0.08, 0.2, m, [0.09 * k, -sensorX(i) * k, 0.75], 'z', 10)
      return m
    })
    const arrowMat = glowMat(RING, 0.9)
    const steer = rodTo(scene, arrowMat)
    const trailMat = glowMat(RING, 0.5)
    const trail = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 4), trailMat, TRAIL)
    trail.frustumCulled = false
    trail.castShadow = false
    scene.add(trail)
    const m4 = new THREE.Matrix4()
    // Magnified bar panel.
    const scale = LF.pp / TCRT.pitchM
    partLetter(scene, `under the bar (×${Math.round(scale / LF.sc)})`, [LF.px, LF.py - 4.2, 0], 0.34, GREY)
    box(scene, [11.2, 5, 0.2], mat('#e6e5df', { rough: 0.9 }), [LF.px, LF.py, -0.3])
    const band = add(scene, new THREE.Group(), [LF.px, LF.py, -0.1])
    box(band, [TCRT.lineM * scale, 5, 0.1], tape, [0, 0, 0])
    const mods = Array.from({ length: TCRT.count }, (_, i) => {
      const x = LF.px + sensorX(i) * scale
      box(scene, [1.6, 1.2, 0.5], mat('#18191c', { rough: 0.6 }), [x, LF.py, 0.4])
      cylinder(scene, 0.32, 0.3, mat('#4a6cff', { rough: 0.3 }), [x - 0.4, LF.py, 0.8], 'z', 12)
      cylinder(scene, 0.32, 0.3, mat('#0d0d10', { rough: 0.3 }), [x + 0.4, LF.py, 0.8], 'z', 12)
      const halo = glowHalo(scene, [x, LF.py - 1.2, 0.2], 0.5)
      const barMat = glowMat(DATA_COLOR, 0.9)
      const bar = rodTo(scene, barMat)
      const val = liveLabel(scene, [x, LF.py + 6.9, 0.3], { size: 0.3 })
      return { x, halo, bar, val }
    })
    partLetter(scene, '4095', [LF.px - 6, LF.py + 6.2, 0], 0.26, GREY, 'right')
    partLetter(scene, '0', [LF.px - 6, LF.py + 1.2, 0], 0.26, GREY, 'right')
    const posMarker = add(scene, new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.9, 16), glowMat(RING, 1.2)))
    const posText = liveLabel(scene, [LF.px, LF.py - 3.2, 0.3], { size: 0.34 })
    const code = codeBlock(scene, [-23.5, 14.6, 0], 0.36, 4)
    const status = liveLabel(scene, [-23.5, -10.4, 0.3], { size: 0.4, align: 'left' })
    const s: { key: string; f: Follower; acc: number; t: number; lost: number; sq: number; steps: number; trail: V3[]; tick: number } = {
      key: '',
      f: startFollower(),
      acc: 0,
      t: 0,
      lost: 0,
      sq: 0,
      steps: 0,
      trail: [],
      tick: 0,
    }
    return {
      scene,
      view: { center: [-1.5, 1, 0], radius: 76, polar: 1.36, azimuth: 0.08 },
      frame(dt, p) {
        const speed = n(p, 'speed')
        const kp = n(p, 'kp')
        const digital = pick(MODES, p.mode, 'analog') === 'digital'
        const key = `${speed}|${kp}|${digital}`
        const offTrack = Math.abs(trackOffset(s.f.pose.x, s.f.pose.y)) > 0.3
        if (key !== s.key || (offTrack && s.lost > 1.5)) Object.assign(s, { key, f: startFollower(), acc: 0, t: 0, lost: 0, sq: 0, steps: 0, trail: [] })
        s.acc += Math.min(dt, 0.05)
        while (s.acc >= LF.dt) {
          s.f = followStep(s.f, LF.dt, speed, kp, digital)
          s.acc -= LF.dt
          s.t += LF.dt
          s.steps++
          s.sq += (s.f.err ?? 0.03) ** 2
          s.lost = offTrack ? s.lost + LF.dt : 0
          if (++s.tick % 6 === 0) {
            s.trail.push([fx(s.f.pose.x), fy(s.f.pose.y), 0.05])
            if (s.trail.length > TRAIL) s.trail.shift()
          }
        }
        const { pose, adc, err, left, right } = s.f
        car.position.set(fx(pose.x), fy(pose.y), 0)
        car.rotation.z = pose.heading
        for (let i = 0; i < TRAIL; i++) trail.setMatrixAt(i, i < s.trail.length ? m4.makeTranslation(...s.trail[i]) : m4.makeScale(0, 0, 0))
        trail.instanceMatrix.needsUpdate = true
        const turn = (left - right) / Math.max(0.05, left + right)
        const nose = sensorAt(pose, 2)
        const h = pose.heading - turn * 1.2
        stretchRod(steer, [fx(nose.x), fy(nose.y), 1], [fx(nose.x) + 2.2 * Math.cos(h), fy(nose.y) + 2.2 * Math.sin(h), 1], 0.09)
        // Panel: the tape where it really is under the bar, each sensor's spot and reading.
        const bar = sensorAt(pose, 2)
        const truth = -trackOffset(bar.x, bar.y)
        band.visible = Math.abs(truth) * scale < 5
        band.position.x = LF.px + truth * scale
        mods.forEach((m, i) => {
          const dark = (adc[i] - 370) / 3430
          m.halo.set(0.2 + 0.9 * (1 - Math.max(0, Math.min(1, dark))), IR_TINT)
          setGlow(dots[i], IR_TINT, 0.3 + 1.2 * Math.max(0, Math.min(1, dark)))
          const top = LF.py + 1.2 + (adc[i] / 4095) * 5
          stretchRod(m.bar, [m.x, LF.py + 1.2, 0.5], [m.x, Math.max(LF.py + 1.25, top), 0.5], 0.42)
          m.val.set(`${adc[i]}`, DATA_COLOR)
        })
        posMarker.visible = err !== null
        if (err !== null) posMarker.position.set(LF.px + err * scale, LF.py - 1.9, 0.6)
        posText.set(err === null ? 'line lost: turn toward last side' : `pos = ${signed(err * 1000)} mm`, err === null ? HEAT : RING)
        const rms = Math.sqrt(s.sq / Math.max(1, s.steps)) * 1000
        code([
          's[i] = analogRead(IR[i]);  // i = 0…4, calibrated',
          `float pos = lineMm(s);  // ${err === null ? 'lost' : signed(err * 1000)}`,
          `float turn = ${kp} * pos / 1000;  // ${signed(kp * (err ?? 0), 2)}`,
          `drive(${speed} * (1 + turn), ${speed} * (1 − turn));`,
        ])
        status.set(
          `t = ${s.t.toFixed(1)} s (real time) · ${err === null ? 'line lost, turning toward the last side' : `L ${left.toFixed(2)} · R ${right.toFixed(2)} m/s`} · RMS error ${rms.toFixed(1)} mm`,
          err === null ? HEAT : LABEL,
        )
      },
      readouts: (p) => {
        const kp = n(p, 'kp')
        const digital = pick(MODES, p.mode, 'analog') === 'digital'
        return [
          { label: 'Sensor pitch', value: `${TCRT.pitchM * 1000} mm` },
          { label: 'Position steps', value: digital ? `${(TCRT.pitchM * 500).toFixed(1)} mm` : '< 1 mm', tone: digital ? 'warn' : 'ok' },
          { label: 'Error for full turn', value: `${(1000 / kp).toFixed(0)} mm`, tone: kp < 15 ? 'warn' : 'ok' },
          { label: 'Lost when', value: `Σw < ${LOST}` },
        ]
      },
    }
  },
}

// --- Sunlight interference: DC photodiode swamped; 38 kHz receiver filters the DC. ---

const RX = { plain: 'Bare photodiode', vs1838: 'VS1838 (38 kHz)' }
type Rx = keyof typeof RX
const SL = { tx: -17, y: 1.2, sx: -2, sy: 10.4, w: 6e-3, slow: 600 }
const BURSTS: [number, number][] = [[0.3, 1.2], [1.8, 2.4], [3.0, 4.2], [4.8, 5.4]].map(([a, b]) => [a * 1e-3, b * 1e-3])
const burstOn = (t: number) => BURSTS.some(([a, b]) => t >= a && t < b)
const rxX = (m: number) => SL.tx + 6 + 22 * (Math.log(m / 0.1) / Math.log(80))
const hash = (x: number) => {
  const v = Math.sin(x * 127.1) * 43758.5453
  return v - Math.floor(v)
}

const slRun = memoBy(
  (p: Params) => `${p.klux}|${p.rx}|${p.m}`,
  (p: Params) => {
    const klux = n(p, 'klux')
    const rx: Rx = pick(RX, p.rx, 'plain')
    const m = n(p, 'm')
    const plain = plainReceiver(klux, m)
    const mod = modulatedReceiver(klux, m)
    const verdict = rx === 'plain' ? (plain.falseHit ? (plain.swing < 0.05 ? 'blinded' : 'fooled') : plain.works ? 'works' : 'too weak') : mod.works ? 'decodes' : 'too weak'
    return { klux, rx, m, sunA: ambientAmps(klux), sigA: remoteAmps(m), plain, mod, verdict, ok: verdict === 'works' || verdict === 'decodes' }
  },
)

export const sunlightInterference: Lesson = {
  id: 'infrared-sunlight-interference',
  title: 'Sunlight interference',
  tagline: 'The sun is a huge IR lamp; blink at 38 kHz and filter it out',
  formula: (p) => {
    const R = slRun(p)
    if (R.rx === 'plain')
      return `I_sun = 0.6 µA/klux × ${R.klux} = ${amps(R.sunA)} · I_remote = 0.3 µA/d² = ${amps(R.sigA)} · V = (I_sun + I_remote) × 100 kΩ: ${R.plain.idle.toFixed(2)} V idle, ${R.plain.lit.toFixed(2)} V lit vs ${SUN.thresholdV} V → ${R.verdict}`
    return `38 kHz band-pass drops the ${amps(R.sunA)} DC · noise floor 2 nA·√(1 + I_sun/0.1 µA) = ${amps(R.mod.floor)} · signal ${amps(R.sigA)} = ${R.mod.margin.toFixed(1)}× → ${R.verdict} · range ${R.mod.rangeM.toFixed(1)} m`
  },
  legend: [
    { color: SUN_TINT, label: 'Sunlight: steady IR (DC)', shape: 'dot' },
    { color: IR_TINT, label: 'Remote’s IR LED: bursts', shape: 'dot' },
    { color: POWER, label: 'OUT; carrier drawn 1/4 rate', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Sunlight carries more infrared than visible light: in full sun (100 klux) a small photodiode collects tens of µA of it, far more than the µA or less a remote or IR sensor sends back from across a room.',
    'A bare photodiode into a resistor and comparator can’t tell the two apart: sun alone pushes the voltage over the threshold (a false “obstacle”), and in full sun the node saturates near the rail so the real signal adds nothing you can see.',
    'The fix is to blink. A remote turns its IR LED on and off 38 000 times a second in short bursts. A VS1838 receiver amplifies only 38 kHz: steady sunlight is DC and is filtered out, so only the bursts get through, and OUT goes LOW for each one.',
    'Sunlight still costs something: its photocurrent brings shot noise (∝ √I) right across the 38 kHz band, and the receiver’s automatic gain control raises its threshold to stay above it. Range drops from ~10 m indoors to a couple of metres in full sun.',
    'The same trick makes robot IR sensors sun-proof: modulate the emitter, demodulate the receiver. TCRT5000 and FC-51 modules don’t, which is why they misbehave by a window.',
  ],
  controls: [
    { kind: 'slider', key: 'klux', label: 'Sunlight', min: 0, max: 100, step: 1, initial: 20, format: (v) => (v < 1 ? 'dark room' : `${v} klux`) },
    { kind: 'choice', key: 'rx', options: (Object.keys(RX) as Rx[]).map((k) => ({ value: k, label: RX[k] })), initial: 'plain' },
    { kind: 'slider', key: 'm', label: 'Remote distance', min: 0.1, max: 8, step: 0.1, initial: 0.2, format: (v) => `${v.toFixed(1)} m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    // Sun.
    const sunMat = glowMat(SUN_TINT, 1)
    add(scene, new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 16), sunMat), [SL.sx, SL.sy, 0])
    const sunHalo = glowHalo(scene, [SL.sx, SL.sy, 0.2], 1.1)
    const sunText = liveLabel(scene, [SL.sx + 2.6, SL.sy, 0.3], { size: 0.38, align: 'left' })
    const sunRays = [0, 1, 2, 3, 4].map(() => lightRay(scene, 10, 0.15, 0.6))
    // Remote: IR LED pointing right.
    box(scene, [3.4, 6, 1.4], mat('#3c3f48', { rough: 0.6 }), [SL.tx - 2.6, SL.y, -0.2])
    const tx = sideLed(scene, '#cfd8ff', [SL.tx - 0.8, SL.y, 0.3], 1, 0.62)
    partLetter(scene, 'remote', [SL.tx - 2.6, SL.y - 4, 0], 0.34, LABEL)
    const txHalo = glowHalo(scene, tx.tip, 0.9)
    const txRays = [-1, 0, 1].map(() => lightRay(scene, 14, 0.13, 1.2))
    // Receivers.
    const rx = add(scene, new THREE.Group(), [0, SL.y, 0])
    const plainG = add(rx, new THREE.Group())
    box(plainG, [1, 4.6, 3], mat('#1f4fa8', { rough: 0.5 }), [1.2, 0, -0.2])
    const pd = sideLed(plainG, '#141418', [0.6, 0, 0.3], -1, 0.62)
    const vsG = add(rx, new THREE.Group())
    const vsBody = mat('#7a7f8c', { rough: 0.3 })
    box(vsG, [1.6, 3.2, 2.2], vsBody, [0.9, 0, 0])
    const dome = add(vsG, new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 12, Math.PI / 2, Math.PI), vsBody), [0.1, 0.3, 0])
    dome.rotation.y = Math.PI
    for (const y of [-1.8, -2.6]) box(vsG, [0.1, 0.1, 0.1], mat('#000'), [0, y, 0])
    const rxName = liveLabel(scene, [0, SL.y - 4, 0.3], { size: 0.34 })
    const rxHalo = glowHalo(scene, [0, SL.y, 0.4], 0.8)
    const outLed = smdLed(rx, [1.2, 3, 0.6], POWER)
    const ruler = rodTo(scene, glowMat(GREY, 0.4))
    const rulerText = liveLabel(scene, [0, SL.y - 5.4, 0.3], { size: 0.36 })
    // Scope: input to the decision and OUT.
    const W = 40
    const H = 7.2
    const Y = -11.2
    const plot = scope(scene, W, H, { divs: [12, 4] })
    plot.group.position.set(0, Y, 0)
    const inTrace = plot.trace(IR_TINT, { samples: 480, radius: 0.06 })
    const outTrace = plot.trace(POWER, { samples: 240, radius: 0.08 })
    const thrLine = rodTo(scene, glowMat(RING, 1))
    const thrText = liveLabel(scene, [W / 2 + 0.6, 0, 0.3], { size: 0.3, align: 'left' })
    const inName = liveLabel(scene, [-W / 2 - 0.8, Y + 1.8, 0], { size: 0.32, align: 'right' })
    partLetter(scene, 'OUT', [-W / 2 - 0.8, Y - 2, 0], 0.34, POWER, 'right')
    partLetter(scene, '6 ms', [W / 2, Y - H / 2 - 1, 0], 0.32, GREY, 'right')
    const cursor = rodTo(scene, glowMat(LABEL, 1))
    const code = codeBlock(scene, [-25, 15.2, 0], 0.36, 4)
    const status = liveLabel(scene, [-25, -17, 0.3], { size: 0.4, align: 'left' })
    const s = { key: '', t: 0, x: 0, wall: 0 }
    return {
      scene,
      view: { center: [-1.5, -0.6, 0], radius: 82, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const R = slRun(p)
        const key = `${R.klux}|${R.rx}|${R.m}`
        s.wall += dt
        s.t = (s.t + dt / SL.slow) % (SL.w * 1.25)
        const t = Math.min(s.t, SL.w)
        const on = burstOn(t)
        s.x = glide(dt, s.x, rxX(R.m), 10)
        rx.position.x = s.x
        const vs = R.rx === 'vs1838'
        plainG.visible = !vs
        vsG.visible = vs
        const face: V3 = [vs ? s.x + 0.1 : pd.tip[0] + s.x, SL.y + (vs ? 0.3 : 0), 0.3]
        rxName.group.position.x = s.x + 0.8
        rxName.set(vs ? 'VS1838' : 'photodiode + LM393', LABEL)
        // Sun and its rays onto the receiver.
        const f = Math.sqrt(R.klux / 100)
        setGlow(sunMat, SUN_TINT, 0.2 + 1.2 * f)
        sunHalo.set(0.3 + 0.9 * f, SUN_TINT)
        sunText.set(R.klux < 1 ? 'night / dark room' : `${R.klux} klux · ${amps(R.sunA)} into the diode`, R.klux > 10 ? HEAT : GREY)
        sunRays.forEach((ray, i) => ray([[SL.sx + (i - 2) * 1.2, SL.sy - 1.4, 0.3], [face[0] + (i - 2) * 0.5, face[1] + 0.6, 0.3]], s.wall + i * 0.21, 1.2 * f, SUN_TINT))
        rxHalo.group.position.set(face[0], face[1], 0.6)
        // Remote bursts (slowed); carrier flicker shown for the VS1838 path.
        const flick = vs ? 0.55 + 0.45 * Math.sign(Math.sin(s.wall * 40)) : 1
        const txF = on ? flick : 0
        txHalo.set(txF, IR_TINT)
        txRays.forEach((ray, i) => ray([tx.tip, [face[0], face[1] + i * 0.6, 0.3]], s.wall + i * 0.27, 1.1 * txF))
        const out = vs ? R.mod.works && on : R.plain.falseHit || (R.plain.works && on)
        rxHalo.set(Math.min(1.6, (R.sunA + (on ? R.sigA : 0)) / 20e-6) + 0.1, R.klux > 5 ? SUN_TINT : IR_TINT)
        outLed(dt, out)
        stretchRod(ruler, [tx.tip[0], SL.y - 4.6, 0.3], [face[0], SL.y - 4.6, 0.3], 0.05)
        rulerText.group.position.x = (tx.tip[0] + face[0]) / 2
        rulerText.set(`${R.m.toFixed(1)} m (log scale)`, GREY)
        // Scope: redraw only on input change.
        if (key !== s.key) {
          if (vs) {
            const floor = vs1838Floor(R.klux)
            const full = Math.max(R.sigA, 1.5 * floor)
            const a = (R.sigA / full) * 1.5
            const nz = (floor / full) * 1.5
            inTrace.draw((u) => 1.8 + (burstOn(u * SL.w) ? a * Math.sin(u * 2 * Math.PI * 57) : 0) + 0.6 * nz * (hash(u * 977) - 0.5) * 2, null)
            stretchRod(thrLine, [-W / 2, Y + 1.8 + nz, 0.3], [W / 2, Y + 1.8 + nz, 0.3], 0.04)
            thrText.group.position.y = Y + 1.8 + nz
            thrText.set('AGC', RING)
            inName.set('after 38 kHz filter', IR_TINT)
          } else {
            const span = SUN.vcc
            const yv = (v: number) => 0.2 + (v / span) * 3.2
            inTrace.draw((u) => yv(photoVolts(R.sunA + (burstOn(u * SL.w) ? R.sigA : 0), SUN.pdOhms, SUN.vcc)), null)
            stretchRod(thrLine, [-W / 2, Y + yv(SUN.thresholdV), 0.3], [W / 2, Y + yv(SUN.thresholdV), 0.3], 0.04)
            thrText.group.position.y = Y + yv(SUN.thresholdV)
            thrText.set(`${SUN.thresholdV} V`, RING)
            inName.set('diode V', IR_TINT)
          }
          outTrace.draw((u) => {
            const b = burstOn(u * SL.w)
            const low = vs ? R.mod.works && b : !(R.plain.falseHit || (R.plain.works && b))
            return low ? -3.2 : -1.2
          }, null)
          s.key = key
        }
        const cx = plot.xAt(t / SL.w)
        stretchRod(cursor, [cx, Y - H / 2, 0.4], [cx, Y + H / 2, 0.4], 0.05)
        code(
          vs
            ? ['IrReceiver.begin(IR_PIN);  // VS1838 OUT, idle HIGH', 'if (IrReceiver.decode()) {', `  cmd = IrReceiver.decodedIRData.command;  // ${R.mod.works ? '0x45' : 'never'}`, '  IrReceiver.resume(); }']
            : ['pinMode(PD_OUT, INPUT);  // photodiode + comparator', `bool seen = digitalRead(PD_OUT);  // ${R.plain.falseHit ? 'always 1' : R.plain.works ? (on ? '1' : '0') : 'always 0'}`, '// no filter: sunlight looks like a signal', '']
        )
        const why = vs
          ? R.mod.works
            ? `DC removed; bursts are ${R.mod.margin.toFixed(1)}× the noise floor → OUT LOW per burst`
            : `bursts ${amps(R.sigA)} under the ${amps(R.mod.floor)} noise floor: move within ${R.mod.rangeM.toFixed(1)} m`
          : R.verdict === 'blinded'
            ? 'sun saturates the diode near 3.3 V: the remote adds nothing'
            : R.verdict === 'fooled'
              ? `sun alone gives ${R.plain.idle.toFixed(2)} V > ${SUN.thresholdV} V: OUT stuck HIGH`
              : R.verdict === 'works'
                ? 'dim room and close: bursts cross the threshold'
                : `remote gives only ${R.plain.swing.toFixed(2)} V: too far for a bare diode`
        status.set(`t = ${(t * 1000).toFixed(2)} ms · slowed ${SL.slow}× · ${why}`, R.ok ? POWER : HEAT)
      },
      readouts: (p) => {
        const R = slRun(p)
        return [
          { label: 'Sun photocurrent', value: amps(R.sunA), tone: R.klux > 10 ? 'warn' : 'ok' },
          { label: 'Remote signal', value: amps(R.sigA) },
          { label: R.rx === 'plain' ? 'Diode V idle' : 'VS1838 range', value: R.rx === 'plain' ? `${R.plain.idle.toFixed(2)} V` : `${R.mod.rangeM.toFixed(1)} m` },
          { label: 'Receiver', value: R.verdict, tone: R.ok ? 'ok' : 'warn' },
        ]
      },
    }
  },
}
