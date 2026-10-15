import * as THREE from 'three/webgpu'
import {
  E_PER_LUX_S,
  LENSES,
  OV2640,
  blurPx,
  clipShares,
  distort,
  histogram,
  lineTime,
  noiseE,
  pixelDn,
  propellerAt,
  radialScale,
  rowTime,
  signalE,
  snrDb,
  turnDeg,
  undistort,
} from '../../core/physics'
import { V3, add, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  esp32Cam,
  flatBox,
  glide,
  glowMat,
  label,
  lightRay,
  liveLabel,
  memoBy,
  pixelGrid,
  robotCar,
  setGlow,
  shadowlessRod,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const SUBJECT: V3 = [-12.5, 1, 0]
const CAM_AT: V3 = [-2.6, 0.6, 1.2]
const T0: V3 = [-18.5, 11.8, 0]
const SVGA = OV2640.svga
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
const ms = (s: number) => `${(s * 1e3).toFixed(s < 0.1 ? 1 : 0)} ms`

/** Subject group turned toward the camera, the ESP32-CAM aimed back at it, two light rays crossing in the lens, a cable to the image. */
function rig(scene: THREE.Scene, imageLeft: V3) {
  const subject = add(scene, new THREE.Group(), SUBJECT)
  subject.rotation.y = 0.7
  const cam = esp32Cam(scene, CAM_AT, 0.17)
  cam.group.rotation.y = -1.0
  const lens = cam.lens()
  const back: V3 = [CAM_AT[0] + 1.2, CAM_AT[1], CAM_AT[2] - 0.6]
  stretchRod(add(scene, shadowlessRod(glowMat(GREY, 0.3))), back, imageLeft, 0.05)
  const rays = [lightRay(scene, 14, 0.1, 0.45), lightRay(scene, 14, 0.1, 0.45)]
  const world = (local: V3): V3 => {
    const v = subject.localToWorld(new THREE.Vector3(...local))
    return [v.x, v.y, v.z]
  }
  return {
    subject,
    cam,
    lens,
    world,
    /** Rays from two subject points through the lens, crossing (the sensor image is upside down). */
    rays(t: number, from: V3[], color: string, f = 0.9) {
      rays.forEach((ray, i) => {
        const a = world(from[i])
        const beyond: V3 = [lens[0] + (lens[0] - a[0]) * 0.12, lens[1] + (lens[1] - a[1]) * 0.12, lens[2] + (lens[2] - a[2]) * 0.12]
        ray([a, lens, beyond], t, f, color)
      })
    },
  }
}

const textLines = (scene: THREE.Scene) => {
  const [a, b, c] = [0, 1, 2].map((i) => liveLabel(scene, [T0[0], T0[1] - i * 1.3, 0], { size: 0.55, align: 'left' }))
  const status = liveLabel(scene, [T0[0], T0[1] - 4.1, 0], { size: 0.4, align: 'left' })
  return { a, b, c, status }
}

// --- Rolling vs global shutter: rows read top to bottom while a propeller turns. ---

const ROLL = { cols: 40, rows: 30, pitch: 0.4, read: 3, hold: 1.6, propR: 3.6, imgR: 0.92 }
const ROLL_IMG: V3 = [10.6, 1.4, 0]
const ROLL_CYCLE = ROLL.read + ROLL.hold
const LINE_S = lineTime(SVGA.fps, SVGA.lines)
const READ_S = rowTime(SVGA.h, LINE_S, false)
const ROLL_SLOW = ROLL.read / READ_S
const SHUTTERS = { rolling: 'Rolling shutter', global: 'Global shutter' }
const BLADE_RGB = [rgb(RING), rgb(HEAT), rgb(HEAT)]
const HUB_RGB = rgb('#9aa0ab')
const BACK_RGB = rgb('#1b1f27')

function rollSetup(p: Params) {
  const global = pick(SHUTTERS, p.shutter, 'rolling') === 'global'
  const rpm = n(p, 'rpm')
  const turn = turnDeg(rpm, READ_S)
  return { global, rpm, turn, bend: global ? 0 : turn }
}

/** Flat blade outline matching `propellerAt` (unit radius), extruded thin. */
function bladeGeometry(R: number) {
  const s = new THREE.Shape()
  const steps = 12
  const edge = (r: number, side: number) => {
    const h = (0.34 - 0.2 * r) * side
    return [r * Math.cos(h) * R, r * Math.sin(h) * R] as const
  }
  s.moveTo(...edge(0.1, -1))
  for (let i = 1; i <= steps; i++) s.lineTo(...edge(0.1 + (0.9 * i) / steps, -1))
  for (let i = steps; i >= 0; i--) s.lineTo(...edge(0.1 + (0.9 * i) / steps, 1))
  return new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false })
}

export const rollingVsGlobalShutter: Lesson = {
  id: 'camera-rolling-vs-global-shutter',
  title: 'Rolling vs global shutter',
  tagline: 'A rolling shutter reads the rows one after another, so anything fast is caught at a different moment in every row',
  formula: (p) => {
    const S = rollSetup(p)
    return `t_row = row × t_line · t_line = 1 / (${SVGA.fps} fps × ${SVGA.lines} lines) = ${(LINE_S * 1e6).toFixed(1)} µs · ${SVGA.h} rows → ${ms(READ_S)} top to bottom · ${S.rpm} rpm turns ${S.turn.toFixed(0)}° meanwhile${S.global ? ' · global: every row exposed at the same instant, then read out' : ''}`
  },
  legend: [
    { color: B_FIELD, label: 'Row being read out', shape: 'dot' },
    { color: RING, label: 'Blade 1 (to follow it)', shape: 'dot' },
    { color: HEAT, label: 'Blades 2, 3', shape: 'dot' },
    { color: GREY, label: 'Last frame (not yet overwritten)', shape: 'dot' },
  ],
  points: [
    'The lens projects the scene onto a grid of photodiodes (pinhole model: a point at x, z lands at f·x/z, upside down). Each pixel counts the light that fell on it while it was exposed.',
    "The OV2640 on the ESP32-CAM has a rolling shutter: it exposes and reads one row after the next, one line time apart. The bottom row of an SVGA frame is sampled ~30 ms after the top.",
    'Anything that moves during those 30 ms is caught at a different moment in every row: propeller blades bend into bananas, a fast-turning robot sees poles lean, and motor vibration makes the image wobble ("jello").',
    'A global shutter exposes every pixel at the same instant and then reads them out (each pixel has its own storage node). Costlier, but straight blades and right angles; pick one for fast robots or visual odometry.',
  ],
  controls: [
    { kind: 'choice', key: 'shutter', options: opts(SHUTTERS), initial: 'rolling' },
    { kind: 'slider', key: 'rpm', label: 'Propeller speed', min: 0, max: 3000, step: 100, initial: 600, format: (v) => `${v.toFixed(0)} rpm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const W = ROLL.cols * ROLL.pitch
    const H = ROLL.rows * ROLL.pitch
    const R = rig(scene, [ROLL_IMG[0] - W / 2 - 0.3, ROLL_IMG[1], 0])
    const half = ROLL.propR / ROLL.imgR
    flatBox(R.subject, [2 * half + 0.6, 2 * half + 0.6, 0.2], mat('#1b1f27', { rough: 0.8 }), [0, 0, -0.9])
    cylinder(R.subject, 0.9, 1.2, mat('#9aa0ab', { metal: 0.3, rough: 0.4 }), [0, 0, -0.3], 'z', 24)
    const rotor = add(R.subject, new THREE.Group(), [0, 0, 0.35])
    const geo = bladeGeometry(ROLL.propR)
    for (let b = 0; b < 3; b++) {
      const o = add(rotor, mesh(geo, mat(b === 0 ? '#e8b923' : '#e0702a', { rough: 0.5 })))
      o.rotation.z = (b * 2 * Math.PI) / 3
    }
    cylinder(rotor, ROLL.propR * 0.14, 0.4, mat('#9aa0ab', { rough: 0.4 }), [0, 0, 0.1], 'z', 20)
    const scanMat = glowMat(B_FIELD, 1.2)
    const scan = flatBox(R.subject, [2 * half + 0.8, 0.12, 0.12], scanMat, [0, 0, 0.7])
    const flashMat = glowMat('#ffffff', 1)
    flashMat.transparent = true
    flashMat.depthWrite = false
    const flash = add(R.subject, mesh(new THREE.PlaneGeometry(2 * half, 2 * half), flashMat), [0, 0, 0.75])
    flash.castShadow = false
    add(R.subject, label('3-blade prop', { size: 0.5, color: LABEL }), [0, -half - 1, 0])

    const grid = pixelGrid(scene, ROLL_IMG, ROLL.cols, ROLL.rows, ROLL.pitch)
    const cursor = flatBox(scene, [W + 0.5, 0.1, 0.1], glowMat(B_FIELD, 1.4), [ROLL_IMG[0], 0, 0.15])
    add(scene, label(`OV2640 frame · ${SVGA.w} × ${SVGA.h} read, ${ROLL.cols} × ${ROLL.rows} shown`, { size: 0.42, color: LABEL }), [ROLL_IMG[0], ROLL_IMG[1] + H / 2 + 0.8, 0])
    const rowTag = liveLabel(scene, [ROLL_IMG[0] + W / 2 + 0.4, 0, 0], { size: 0.36, align: 'left' })
    const text = textLines(scene)

    const s = { key: '', t: 0, cycle: -1 }
    const rowAngle = new Array<number | null>(ROLL.rows).fill(null)
    const prevAngle = new Array<number | null>(ROLL.rows).fill(null)
    const paint = (r: number, angle: number | null, dim: number) => {
      for (let c = 0; c < ROLL.cols; c++) {
        const i = r * ROLL.cols + c
        if (angle === null) {
          grid.set(i, 0.02, 0.02, 0.03)
          continue
        }
        const x = (((c + 0.5) / ROLL.cols) * 2 - 1) * (ROLL.cols / ROLL.rows)
        const y = 1 - ((r + 0.5) / ROLL.rows) * 2
        const b = propellerAt(x / ROLL.imgR, y / ROLL.imgR, angle)
        const px = b < 0 ? BACK_RGB : Math.hypot(x, y) < 0.14 * ROLL.imgR ? HUB_RGB : BLADE_RGB[b]
        grid.set(i, px[0] * dim, px[1] * dim, px[2] * dim)
      }
    }
    return {
      scene,
      view: { center: [0.5, 4, 0], radius: 76, polar: 1.3, azimuth: 0 },
      frame(dt, p) {
        const S = rollSetup(p)
        const key = `${S.global}|${S.rpm}`
        if (key !== s.key) {
          Object.assign(s, { key, t: 0, cycle: -1 })
          rowAngle.fill(null)
        }
        s.t += dt
        const cycle = Math.floor(s.t / ROLL_CYCLE)
        const tc = s.t - cycle * ROLL_CYCLE
        if (cycle !== s.cycle) {
          s.cycle = cycle
          rowAngle.forEach((a, i) => (prevAngle[i] = a))
          rowAngle.fill(null)
        }
        const omega = (S.rpm / 60) * 2 * Math.PI
        const angleAt = (simT: number) => (-omega * simT) / ROLL_SLOW
        rotor.rotation.z = angleAt(s.t)
        const u = Math.min(1, tc / ROLL.read)
        const done = Math.min(ROLL.rows, Math.floor(u * ROLL.rows + 1e-9))
        const f0 = cycle * ROLL_CYCLE
        for (let r = 0; r < done; r++) rowAngle[r] = angleAt(f0 + (S.global ? 0 : ((r + 0.5) / ROLL.rows) * ROLL.read))
        for (let r = 0; r < ROLL.rows; r++) paint(r, r < done ? rowAngle[r] : prevAngle[r], r < done ? 1 : 0.4)
        grid.commit()

        const reading = u < 1
        cursor.visible = reading
        cursor.position.y = ROLL_IMG[1] + H / 2 - u * H
        rowTag.group.visible = reading
        rowTag.group.position.y = cursor.position.y
        rowTag.set(ms(u * READ_S), B_FIELD)
        scan.visible = reading && !S.global
        scan.position.y = half - 2 * half * u
        const fl = S.global ? Math.max(0, 1 - tc * 3) : 0
        flash.visible = fl > 0.01
        flashMat.opacity = 0.45 * fl
        R.rays(s.t, [[0, half * 0.8, 0.5], [0, -half * 0.8, 0.5]], RING, reading ? 0.9 : 0.35)
        setGlow(R.cam.glass, S.global ? '#ffffff' : '#5a7dff', S.global ? 0.35 + 1.5 * fl : 0.35 + 0.4 * (reading ? 1 : 0))

        text.a.set(
          S.global
            ? reading
              ? 'Every row exposed at the same instant; now read out'
              : 'Global: every row shows the same moment, blades straight'
            : reading
              ? 'Rolling: each row is sampled as the readout reaches it'
              : S.rpm > 0
                ? `Rows sampled ${ms(READ_S)} apart: the blades bend`
                : 'Nothing moved, so rolling looks the same as global',
          S.global ? POWER : reading || S.rpm === 0 ? LABEL : HIGH_V,
        )
        text.b.set(`prop at ${S.rpm} rpm turns ${S.turn.toFixed(0)}° while ${SVGA.h} rows are read`, S.rpm > 0 ? HEAT : GREY)
        text.c.set(S.global ? 'bend 0° (one exposure instant)' : `bend top → bottom ${S.bend.toFixed(0)}°`, S.global || S.bend < 5 ? POWER : HIGH_V)
        text.status.set(`time slowed ${Math.round(ROLL_SLOW)}× · ${ROLL.rows} rows drawn for ${SVGA.h}`, GREY)
      },
      readouts: (p) => {
        const S = rollSetup(p)
        return [
          { label: 'Line time', value: `${(LINE_S * 1e6).toFixed(1)} µs` },
          { label: `Readout (${SVGA.h} rows)`, value: ms(READ_S) },
          { label: 'Prop turn in that time', value: `${S.turn.toFixed(0)}°` },
          { label: 'Blades in the image', value: S.global || S.turn < 5 ? 'straight' : `bent ${S.bend.toFixed(0)}°`, tone: S.global || S.turn < 5 ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- Exposure: shutter time × gain × aperture in a dim room; blur vs noise, histogram clipping. ---

const EXPO = { cols: 32, rows: 24, pitch: 0.42, slow: 10, fps: 6, sub: 12, speed: 1200, bins: 16, travel: 0.6, wallW: 10 }
const EXP_IMG: V3 = [10.4, 3.4, 0]
const LUX = { wall: 40, floor: 15, frame: 12, robot: 150, wheel: 2, lamp: 6000 }
const APERTURES = { '2': 'f/2', '2.8': 'f/2.8', '4': 'f/4' }
const LAMP = [0.55, 0.38]
const [SNR_BAD, SNR_OK, BLUR_OK, BLUR_BAD] = [15, 24, 8, 25]
/** Robot speed across the image in normalized units (image half-width = 1) per real second. */
const ROBOT_V = EXPO.speed / (SVGA.w / 2)
const ROBOT_PERIOD = (4 * EXPO.travel) / ROBOT_V

const robotX = (tReal: number) => {
  const u = (((tReal / ROBOT_PERIOD) % 1) + 1) % 1
  return EXPO.travel * (u < 0.5 ? 4 * u - 1 : 3 - 4 * u)
}

/** Dim-room scene in lux (for 50 % grey): wall with a picture and a lamp, floor, the robot at `rx`; x ±1, y ±0.75. */
function roomLux(x: number, y: number, rx: number) {
  const dx = x - rx
  if (Math.abs(dx) < 0.2 && y > -0.5 && y < -0.24) return LUX.robot
  if (y <= -0.5 && y > -0.62 && (Math.abs(dx - 0.12) < 0.06 || Math.abs(dx + 0.12) < 0.06)) return LUX.wheel
  const d = Math.hypot(x - LAMP[0], y - LAMP[1])
  if (d < 0.09) return LUX.lamp
  if (y < -0.36) return LUX.floor
  if (Math.abs(x + 0.45) < 0.2 && Math.abs(y - 0.2) < 0.16) return Math.abs(x + 0.45) < 0.15 && Math.abs(y - 0.2) < 0.11 ? LUX.wall * 1.6 : LUX.frame
  return LUX.wall * (0.85 + 0.15 * y) * (1 + 5 * Math.exp(-((d / 0.2) ** 2)))
}

function expoSetup(p: Params) {
  const t = n(p, 'shutter') / 1000
  const gain = n(p, 'gain')
  const N = Number(pick(APERTURES, p.aperture, '2'))
  const e = signalE(LUX.wall, t, N)
  return { t, gain, N, e, dn: pixelDn(e, gain), blur: blurPx(EXPO.speed, t), snr: snrDb(e) }
}
type ExpoSetup = ReturnType<typeof expoSetup>

/** One frame (8-bit values, row-major) ending at real time `tReal`, noise draw set `frame`. */
function expoImage(S: ExpoSetup, tReal: number, frame: number) {
  const out = new Array<number>(EXPO.cols * EXPO.rows)
  const xs = Array.from({ length: EXPO.sub }, (_, j) => robotX(tReal - (S.t * (j + 0.5)) / EXPO.sub))
  for (let r = 0; r < EXPO.rows; r++)
    for (let c = 0; c < EXPO.cols; c++) {
      const x = ((c + 0.5) / EXPO.cols) * 2 - 1
      const y = (1 - ((r + 0.5) / EXPO.rows) * 2) * 0.75
      let lux = 0
      for (const rx of xs) lux += roomLux(x, y, rx)
      const i = r * EXPO.cols + c
      out[i] = pixelDn(signalE(lux / EXPO.sub, S.t, S.N), S.gain, frame * out.length + i)
    }
  return out
}
const expoStill = memoBy(
  (p: Params) => `${p.shutter}|${p.gain}|${p.aperture}`,
  (p: Params) => {
    const img = expoImage(expoSetup(p), ROBOT_PERIOD * 0.3, 0)
    return { hist: histogram(img, EXPO.bins), clip: clipShares(img) }
  },
)
const pct = (f: number) => `${(f * 100).toFixed(f > 0 && f < 0.1 ? 1 : 0)} %`

export const exposure: Lesson = {
  id: 'camera-exposure',
  title: 'Exposure',
  tagline: 'Light collected = scene × shutter time ÷ f-number²; gain only multiplies it. In a dim room, long means blur and short means noise',
  formula: (p) => {
    const S = expoSetup(p)
    return `e⁻ = ${E_PER_LUX_S.toFixed(0)} e⁻/(lux·s) × E × t × (2/N)² · wall: ${LUX.wall} lux × ${ms(S.t)} × (2/${S.N})² = ${Math.round(S.e)} e⁻ ± √(e⁻ + ${OV2640.readNoise}²) = ${noiseE(S.e).toFixed(0)} · value = e⁻ × ${S.gain.toFixed(1)} × 255 / ${OV2640.fullWell} = ${S.dn} · blur = ${EXPO.speed} px/s × t = ${S.blur.toFixed(S.blur < 10 ? 1 : 0)} px`
  },
  legend: [
    { color: RING, label: 'Lamp: the brightest spot, clips first', shape: 'dot' },
    { color: LABEL, label: 'Histogram of pixel values 0 … 255', shape: 'dot' },
    { color: HIGH_V, label: 'Crushed to 0 / clipped at 255', shape: 'dot' },
    { color: B_FIELD, label: 'Aperture opening (f-number)', shape: 'dot' },
  ],
  points: [
    'Each photodiode turns photons into electrons while the shutter is open. Collected charge ∝ scene brightness × exposure time × aperture area (∝ 1/N²: f/2.8 lets in half of f/2).',
    'Light arrives as random photons, so the count itself is noisy: shot noise = √electrons, plus a few e⁻ of read noise. More light → better signal-to-noise; nothing else fixes it.',
    'Gain just multiplies the count before the ADC: brighter, but the noise grows with it. A long shutter collects more light, but a robot crossing at 1200 px/s smears 40 px in 1/30 s.',
    "The pixel well holds ~6000 e⁻ and the ADC tops out at 255: the lamp clips white, too little light crushes to 0. Read the histogram, not the preview; auto-exposure (AEC/AGC) is this trade-off in a loop.",
  ],
  controls: [
    { kind: 'slider', key: 'shutter', label: 'Shutter time', min: 0.5, max: 125, initial: 16, log: true, format: (v) => `1/${Math.round(1000 / v)} s` },
    { kind: 'slider', key: 'gain', label: 'Gain', min: 1, max: 64, initial: 12, log: true, format: (v) => `${v.toFixed(v < 10 ? 1 : 0)}×` },
    { kind: 'choice', key: 'aperture', options: opts(APERTURES), initial: '2' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const W = EXPO.cols * EXPO.pitch
    const H = EXPO.rows * EXPO.pitch
    const R = rig(scene, [EXP_IMG[0] - W / 2 - 0.3, EXP_IMG[1], 0])
    const k = EXPO.wallW / 2
    flatBox(R.subject, [EXPO.wallW, 0.75 * EXPO.wallW, 0.2], mat('#4a4640', { rough: 0.9 }), [0, 0, -0.6])
    flatBox(R.subject, [EXPO.wallW, 0.2, 2.4], mat('#2c2a28', { rough: 0.9 }), [0, -0.36 * k - 0.1, 0.5])
    flatBox(R.subject, [0.4 * k, 0.32 * k, 0.1], mat('#2a2622'), [-0.45 * k, 0.2 * k, -0.45])
    flatBox(R.subject, [0.3 * k, 0.22 * k, 0.1], mat('#7b8a96'), [-0.45 * k, 0.2 * k, -0.4])
    const lampAt: V3 = [LAMP[0] * k, LAMP[1] * k, 0]
    add(R.subject, mesh(new THREE.SphereGeometry(0.45, 16, 12), glowMat(RING, 2)), lampAt).castShadow = false
    const shade = add(R.subject, mesh(new THREE.ConeGeometry(0.75, 0.7, 20, 1, true), mat('#d9cfb8', { rough: 0.7 })), [lampAt[0], lampAt[1] + 0.45, 0])
    shade.castShadow = false
    const mover = add(R.subject, new THREE.Group(), [0, -0.37 * k + 0.4, 0.4])
    robotCar(mover, [0, 0, 0], 0.25)
    add(R.subject, label('dim room · 40 lux', { size: 0.45, color: GREY }), [0, -0.375 * k - 1.2, 0.6])

    const grid = pixelGrid(scene, EXP_IMG, EXPO.cols, EXPO.rows, EXPO.pitch)
    add(scene, label(`OV2640 image · ${EXPO.cols} × ${EXPO.rows} shown`, { size: 0.42, color: LABEL }), [EXP_IMG[0], EXP_IMG[1] + H / 2 + 0.8, 0])
    const histBase = EXP_IMG[1] - H / 2 - 4.6
    const histH = 3.2
    const barW = W / EXPO.bins
    const barMat = glowMat(LABEL, 0.5)
    const clipMat = glowMat(HIGH_V, 1.1)
    const bars = Array.from({ length: EXPO.bins }, (_, b) => {
      const o = flatBox(scene, [barW * 0.8, 1, 0.2], barMat, [EXP_IMG[0] - W / 2 + (b + 0.5) * barW, histBase, 0])
      return o
    })
    flatBox(scene, [W + 0.4, 0.06, 0.1], glowMat(GREY, 0.3), [EXP_IMG[0], histBase - 0.05, 0])
    add(scene, label('0', { size: 0.38, color: GREY }), [EXP_IMG[0] - W / 2, histBase - 0.55, 0])
    add(scene, label('255', { size: 0.38, color: GREY }), [EXP_IMG[0] + W / 2, histBase - 0.55, 0])
    const histTag = liveLabel(scene, [EXP_IMG[0], histBase - 0.55, 0], { size: 0.38 })
    const text = textLines(scene)

    const s = { key: '', t: 0, frame: -1, flash: 0, hist: new Array<number>(EXPO.bins).fill(0), clip: { low: 0, high: 0 }, iris: 1 }
    return {
      scene,
      view: { center: [0.5, 4, 0], radius: 76, polar: 1.3, azimuth: 0 },
      frame(dt, p) {
        const S = expoSetup(p)
        const key = `${S.t}|${S.gain}|${S.N}`
        if (key !== s.key) Object.assign(s, { key, frame: -1 })
        s.t += dt
        const tReal = s.t / EXPO.slow
        mover.position.x = robotX(tReal) * k
        const frame = Math.floor(s.t * EXPO.fps)
        if (frame !== s.frame) {
          s.frame = frame
          s.flash = 1
          const img = expoImage(S, tReal, frame)
          img.forEach((v, i) => grid.set(i, v / 255, v / 255, v / 255))
          grid.commit()
          s.hist = histogram(img, EXPO.bins)
          s.clip = clipShares(img)
        }
        s.flash = Math.max(0, s.flash - dt * 4)
        const peak = Math.max(...s.hist, 1)
        bars.forEach((o, b) => {
          const h = Math.max(0.02, (s.hist[b] / peak) * histH)
          o.scale.y = h
          o.position.y = histBase + h / 2
          o.material = (b === 0 && s.clip.low > 0.01) || (b === EXPO.bins - 1 && s.clip.high > 0.01) ? clipMat : barMat
        })
        histTag.set(`black ${pct(s.clip.low)} · white ${pct(s.clip.high)}`, s.clip.low > 0.05 || s.clip.high > 0.05 ? HIGH_V : GREY)
        s.iris = glide(dt, s.iris, 2 / S.N)
        R.cam.iris(s.iris)
        setGlow(R.cam.glass, B_FIELD, 0.4 + 1.2 * s.flash)
        R.rays(s.t, [lampAt, [mover.position.x, mover.position.y, 0.6]], RING, 0.5 + 0.5 * Math.min(1, S.e / 2000))

        const dark = S.dn < 40
        const noisy = S.snr < SNR_BAD
        const blurry = S.blur > BLUR_BAD
        const fair = S.snr < SNR_OK || S.blur > BLUR_OK
        text.a.set(
          noisy && dark ? 'Too little light: dark and noisy' : noisy ? 'Gain brightened the noise along with the image' : blurry ? 'Long exposure: the moving robot smears' : dark ? 'Clean but dark: add gain or time' : fair ? 'Dim-room compromise: a little blur, a little noise' : 'Enough light and little blur',
          noisy || blurry ? HIGH_V : dark || fair ? HEAT : POWER,
        )
        text.b.set(`wall pixel ${Math.round(S.e)} e⁻ · SNR ${S.snr.toFixed(0)} dB · value ${S.dn}`, noisy ? HIGH_V : S.snr < SNR_OK ? HEAT : LABEL)
        text.c.set(`robot ${EXPO.speed} px/s × ${ms(S.t)} = ${S.blur.toFixed(S.blur < 10 ? 1 : 0)} px of blur`, blurry ? HIGH_V : S.blur > BLUR_OK ? HEAT : POWER)
        text.status.set(`robot slowed ${EXPO.slow}× · ${EXPO.fps} new frames/s shown · noise redrawn each frame`, GREY)
      },
      readouts: (p) => {
        const S = expoSetup(p)
        const st = expoStill(p)
        return [
          { label: 'Wall pixel', value: `${Math.round(S.e)} e⁻ → ${S.dn}`, tone: S.dn < 40 ? 'warn' : 'ok' },
          { label: 'Signal / noise', value: `${S.snr.toFixed(0)} dB`, tone: S.snr < SNR_BAD ? 'bad' : S.snr < SNR_OK ? 'warn' : 'ok' },
          { label: 'Motion blur', value: `${S.blur.toFixed(S.blur < 10 ? 1 : 0)} px`, tone: S.blur > BLUR_BAD ? 'bad' : S.blur > BLUR_OK ? 'warn' : 'ok' },
          { label: 'Black · white', value: `${pct(st.clip.low)} · ${pct(st.clip.high)}`, tone: st.clip.low > 0.05 || st.clip.high > 0.05 ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Lens distortion: a checkerboard through stock, wide and pincushion lenses; undistort with k1, k2. ---

const DIST = { cols: 48, rows: 36, pitch: 0.35, hx: 0.8, hy: 0.6, sq: 0.2, bx: 6, by: 4.5, k3d: 4, dwell: 2.4 }
const DIST_IMG: V3 = [10.6, 1.4, 0]
const HALF_DIAG = Math.hypot(SVGA.w, SVGA.h) / 2
const LENS_KEYS = Object.keys(LENSES) as (keyof typeof LENSES)[]
const VIEWS = { raw: 'Raw image', fixed: 'Undistorted' }
const PROBES: [number, number][] = [
  [0.62, 0.42],
  [-0.66, 0.3],
  [0.32, -0.5],
  [-0.55, -0.44],
]
const CHECK = { light: rgb('#e6e8ec'), dark: rgb('#1c1f25'), wall: rgb('#3a3f48'), red: rgb(HIGH_V), green: rgb(POWER), none: [0, 0, 0] as const }

function distSetup(p: Params) {
  const lens = LENSES[pick(LENSES, p.lens, 'wide')]
  const fixed = pick(VIEWS, p.view, 'raw') === 'fixed'
  const corner = radialScale(1, lens.k1, lens.k2)
  return { lens, fixed, corner, shiftPx: (corner - 1) * HALF_DIAG }
}

/** Board colour at ideal image point (x, y): checker squares, two marked for orientation, wall outside. */
function checker(x: number, y: number) {
  const c = Math.floor((x + DIST.sq * DIST.bx) / DIST.sq)
  const r = Math.floor((DIST.sq * DIST.by - y) / DIST.sq)
  if (c < 0 || r < 0 || c >= 2 * DIST.bx || r >= 2 * DIST.by) return CHECK.wall
  if (c === 1 && r === 1) return CHECK.red
  if (c === 2 * DIST.bx - 2 && r === 2 * DIST.by - 2) return CHECK.green
  return (c + r) % 2 ? CHECK.dark : CHECK.light
}

export const lensDistortion: Lesson = {
  id: 'camera-lens-distortion',
  title: 'Lens distortion',
  tagline: 'Real lenses bend straight lines; a radial model with k1, k2 maps every pixel back to where a pinhole would have put it',
  formula: (p) => {
    const S = distSetup(p)
    return `r_d = r_u × (1 + k1·r_u² + k2·r_u⁴) · ${S.lens.name}: k1 = ${S.lens.k1}, k2 = ${S.lens.k2} · sensor corner (r = 1): × ${S.corner.toFixed(2)} = ${S.shiftPx >= 0 ? '+' : ''}${S.shiftPx.toFixed(0)} px at ${SVGA.w} × ${SVGA.h}${S.fixed ? ' · undistort: Newton-solve r_u per pixel, resample' : ''}`
  },
  legend: [
    { color: POWER, label: 'Where a pinhole puts the point', shape: 'dot' },
    { color: HIGH_V, label: 'Where the lens puts it', shape: 'dot' },
    { color: RING, label: 'Light ray from that board corner', shape: 'dot' },
    { color: GREY, label: 'Outside the board / no data', shape: 'dot' },
  ],
  points: [
    'A pinhole maps straight lines to straight lines. A real lens bends rays more (or less) the farther they are from the centre, so the shift is radial and grows with distance.',
    'Barrel (k1 < 0): the edges are squeezed in and straight lines bow outward. Typical of wide-angle lenses like the 120–160° ones sold for the ESP32-CAM. Pincushion (k1 > 0) pinches them inward.',
    'The Brown model r_d = r_u(1 + k1·r_u² + k2·r_u⁴) captures most of it. Calibration (OpenCV calibrateCamera) finds k1, k2 by photographing a checkerboard whose corners are known to lie on straight lines.',
    'To undistort, for each output pixel compute where the lens put it and copy that pixel. Lines come out straight; barrel images lose their stretched corners, pincushion ones gain empty ones.',
  ],
  controls: [
    { kind: 'choice', key: 'lens', options: LENS_KEYS.map((k) => ({ value: k, label: LENSES[k].name.replace(' lens', '') })), initial: 'wide' },
    { kind: 'choice', key: 'view', options: opts(VIEWS), initial: 'raw' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const W = DIST.cols * DIST.pitch
    const H = DIST.rows * DIST.pitch
    const R = rig(scene, [DIST_IMG[0] - W / 2 - 0.3, DIST_IMG[1], 0])
    const k = DIST.k3d
    const sq = DIST.sq * k
    flatBox(R.subject, [2 * DIST.bx * sq + 0.6, 2 * DIST.by * sq + 0.6, 0.2], mat('#f2f3f5', { rough: 0.7 }), [0, 0, -0.15])
    const tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(sq, sq), mat('#1c1f25', { rough: 0.7 }), DIST.bx * DIST.by * 2)
    tiles.castShadow = false
    const m4 = new THREE.Matrix4()
    let ti = 0
    for (let r = 0; r < 2 * DIST.by; r++)
      for (let c = 0; c < 2 * DIST.bx; c++)
        if ((c + r) % 2) tiles.setMatrixAt(ti++, m4.makeTranslation((c + 0.5 - DIST.bx) * sq, (DIST.by - r - 0.5) * sq, -0.04))
    tiles.count = ti
    R.subject.add(tiles)
    flatBox(R.subject, [sq, sq, 0.04], mat(HIGH_V, { rough: 0.6 }), [(1.5 - DIST.bx) * sq, (DIST.by - 1.5) * sq, -0.03])
    flatBox(R.subject, [sq, sq, 0.04], mat(POWER, { rough: 0.6 }), [(DIST.bx - 1.5) * sq, (1.5 - DIST.by) * sq, -0.03])
    add(R.subject, label('calibration checkerboard', { size: 0.45, color: LABEL }), [0, -DIST.by * sq - 1, 0])

    const grid = pixelGrid(scene, DIST_IMG, DIST.cols, DIST.rows, DIST.pitch)
    add(scene, label(`OV2640 image · ${DIST.cols} × ${DIST.rows} shown`, { size: 0.42, color: LABEL }), [DIST_IMG[0], DIST_IMG[1] + H / 2 + 0.8, 0])
    const toPanel = ([x, y]: readonly number[]): V3 => [DIST_IMG[0] + (x / DIST.hx) * (W / 2), DIST_IMG[1] + (y / DIST.hy) * (H / 2), 0.3]
    const ideal = add(scene, mesh(new THREE.TorusGeometry(0.32, 0.07, 8, 24), glowMat(POWER, 1.2)))
    ideal.castShadow = false
    const real = add(scene, mesh(new THREE.SphereGeometry(0.22, 14, 10), glowMat(HIGH_V, 1.3)))
    real.castShadow = false
    const shift = add(scene, shadowlessRod(glowMat(HIGH_V, 0.9)))
    const probeOnBoard = add(scene, mesh(new THREE.SphereGeometry(0.25, 14, 10), glowMat(RING, 1.3)))
    probeOnBoard.castShadow = false
    const text = textLines(scene)

    const s = { key: '', t: 0, u: 0, drawn: -1, real: [0, 0] as [number, number] }
    return {
      scene,
      view: { center: [0.5, 4, 0], radius: 76, polar: 1.3, azimuth: 0 },
      frame(dt, p) {
        const S = distSetup(p)
        const key = S.lens.name
        if (key !== s.key) Object.assign(s, { key, drawn: -1, t: 0 })
        s.t += dt
        s.u = glide(dt, s.u, S.fixed ? 1 : 0, 5)
        if (Math.abs(s.u - (S.fixed ? 1 : 0)) < 0.002) s.u = S.fixed ? 1 : 0
        if (s.u !== s.drawn) {
          s.drawn = s.u
          const { k1, k2 } = S.lens
          for (let r = 0; r < DIST.rows; r++)
            for (let c = 0; c < DIST.cols; c++) {
              const x = (((c + 0.5) / DIST.cols) * 2 - 1) * DIST.hx
              const y = (1 - ((r + 0.5) / DIST.rows) * 2) * DIST.hy
              const [ux, uy] = undistort([x, y], k1, k2)
              const [dx, dy] = distort([x, y], k1, k2)
              const outside = Math.abs(dx) > DIST.hx || Math.abs(dy) > DIST.hy
              const px = s.u > 0.5 && outside ? CHECK.none : checker(ux + (x - ux) * s.u, uy + (y - uy) * s.u)
              grid.set(r * DIST.cols + c, px[0], px[1], px[2])
            }
          grid.commit()
        }

        const pi = Math.floor(s.t / DIST.dwell) % PROBES.length
        const pr = PROBES[pi]
        const d = distort(pr, S.lens.k1, S.lens.k2)
        const target: [number, number] = [d[0] + (pr[0] - d[0]) * s.u, d[1] + (pr[1] - d[1]) * s.u]
        s.real = s.t % DIST.dwell < dt * 1.5 ? target : [glide(dt, s.real[0], target[0], 8), glide(dt, s.real[1], target[1], 8)]
        const a = toPanel(pr)
        const b = toPanel(s.real)
        ideal.position.set(...a)
        real.position.set(...b)
        stretchRod(shift, a, b, 0.06)
        const onBoard = R.world([pr[0] * k, pr[1] * k, 0.15])
        probeOnBoard.position.set(...onBoard)
        R.rays(s.t, [[pr[0] * k, pr[1] * k, 0.15], [-pr[0] * k, -pr[1] * k, 0.15]], RING, 0.9)
        const r = Math.hypot(...pr)
        const movedPx = (Math.hypot(...s.real) - r) * HALF_DIAG

        const barrel = S.lens.k1 < 0
        text.a.set(
          S.fixed ? 'Undistorted: every line straight again' : barrel ? 'Barrel: edges squeezed, lines bow outward' : 'Pincushion: edges stretched, lines pinch inward',
          S.fixed ? POWER : S.corner > 0.97 && S.corner < 1.03 ? LABEL : HIGH_V,
        )
        text.b.set(`k1 = ${S.lens.k1} · k2 = ${S.lens.k2} · corner × ${S.corner.toFixed(2)} (${S.shiftPx >= 0 ? '+' : ''}${S.shiftPx.toFixed(0)} px)`, LABEL)
        const onTarget = Math.abs(movedPx) < 0.5
        text.c.set(
          `board corner at r = ${r.toFixed(2)} → ${onTarget ? 'on target' : `r_d = ${(r + movedPx / HALF_DIAG).toFixed(3)} (${movedPx > 0 ? '+' : ''}${movedPx.toFixed(0)} px)`}`,
          onTarget ? POWER : HEAT,
        )
        text.status.set(`${S.lens.fov}° lens · r = 1 at the sensor corner, ${Math.round(HALF_DIAG)} px out`, GREY)
      },
      readouts: (p) => {
        const S = distSetup(p)
        return [
          { label: 'k1 · k2', value: `${S.lens.k1} · ${S.lens.k2}` },
          { label: 'Field of view', value: `${S.lens.fov}°` },
          { label: 'Corner shift', value: `${S.shiftPx >= 0 ? '+' : ''}${S.shiftPx.toFixed(0)} px`, tone: Math.abs(S.shiftPx) < 20 ? 'ok' : 'warn' },
          { label: 'Straight lines', value: S.fixed ? 'straight' : S.lens.k1 < 0 ? 'bow out (barrel)' : 'pinch in (pincushion)', tone: S.fixed || Math.abs(S.shiftPx) < 20 ? 'ok' : 'bad' },
        ]
      },
    }
  },
}
