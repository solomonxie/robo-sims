import * as THREE from 'three/webgpu'
import {
  DESK_AIM,
  DESK_TOP,
  EMISSIVITY,
  DESK_ROOM_C,
  SENSOR_BANDS,
  EmitSurface,
  THERMAL_CAMS,
  ThermalCam,
  apparentC,
  bandShare,
  deskScene,
  exitance,
  kelvinOf,
  netRadiatedW,
  planckExitance,
  thermalImage,
  wienPeakM,
} from '../../core/physics'
import { celsiusText, cmText, fixedText, pct, watts } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  IR_TINT,
  LABEL,
  POWER,
  RING,
  addLabel,
  countBars,
  cursorBar,
  flatBox,
  glowMat,
  heatGlow,
  ironbow,
  liveLabel,
  memoBy,
  pixelGrid,
  rayFan,
  rodPool,
  setGlow,
  sideView,
  statusHeader,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, namesOf, n, opts, pick } from '../types'

const VIEW = sideView(-2.2, -0.8)
const umText = (m: number) => `${fixedText(m * 1e6, m < 3e-6 ? 2 : 1)} µm`
const perM2 = (w: number) => `${watts(w)}/m²`
const shareText = (f: number) => (f < 0.001 ? (f < 1e-9 ? '0 %' : '< 0.1 %') : f < 0.1 ? `${fixedText(f * 100, 1)} %` : pct(f))
const SURFACE_LIST = Object.keys(EMISSIVITY) as EmitSurface[]
const SURFACE_NAMES = Object.fromEntries(SURFACE_LIST.map((k) => [k, `${EMISSIVITY[k].name} (ε ${EMISSIVITY[k].eps})`])) as Record<EmitSurface, string>
const SURFACE_LOOK: Record<EmitSurface, { color: string; rough: number; metal: number }> = {
  skin: { color: '#c98a6b', rough: 0.7, metal: 0 },
  paint: { color: '#1b1c20', rough: 0.95, metal: 0 },
  tape: { color: '#111216', rough: 0.4, metal: 0 },
  anodised: { color: '#5a6170', rough: 0.45, metal: 0.6 },
  aluminium: { color: '#d4d8de', rough: 0.3, metal: 0.7 },
  copper: { color: '#e09a5c', rough: 0.25, metal: 0.7 },
}

// --- Black-body radiation: Planck spectrum on log axes, Wien peak, εσT⁴ by finish, detector bands. ---

const SP = { lo: 0.3e-6, hi: 30e-6, yLo: -2, yHi: 5, samples: 160 }
const uOfLambda = (l: number) => Math.log(l / SP.lo) / Math.log(SP.hi / SP.lo)
const lambdaOfU = (u: number) => SP.lo * (SP.hi / SP.lo) ** u
const REFS = [
  { name: 'body 37 °C', c: 37, color: B_FIELD },
  { name: 'iron 350 °C', c: 350, color: HIGH_V },
] as const
const curveOf = (tK: number, eps: number) => Array.from({ length: SP.samples }, (_, i) => eps * planckExitance(lambdaOfU(i / (SP.samples - 1)), tK))
const REF_CURVES = REFS.map((r) => curveOf(kelvinOf(r.c), 1))
const bbParams = (p: Params) => ({ c: n(p, 'temp'), s: pick(EMISSIVITY, p.finish, 'paint') as EmitSurface })
type BbQ = ReturnType<typeof bbParams>
const bbRun = memoBy(
  (q: BbQ) => `${q.c}|${q.s}`,
  (q: BbQ) => {
    const tK = kelvinOf(q.c)
    const eps = EMISSIVITY[q.s].eps
    const share = (b: keyof typeof SENSOR_BANDS) => bandShare(tK, SENSOR_BANDS[b].lo, SENSOR_BANDS[b].hi)
    return {
      ...q,
      tK,
      eps,
      peak: wienPeakM(tK),
      M: exitance(tK, eps),
      netMw: netRadiatedW(q.c, eps, DESK_ROOM_C, 1e-4) * 1000,
      shares: { eye: share('eye'), silicon: share('silicon'), thermal: share('thermal') },
      curve: curveOf(tK, eps),
      byFinish: SURFACE_LIST.map((k) => exitance(tK, EMISSIVITY[k].eps)),
      glow: Math.max(0, Math.min(1, (q.c - 480) / 520)),
    }
  },
)
const BANDS = Object.keys(SENSOR_BANDS) as (keyof typeof SENSOR_BANDS)[]
const BAND_COLORS = { eye: LABEL, silicon: IR_TINT, thermal: POWER }

export const infraredThermalBlackBodyRadiation: Lesson = {
  id: 'infrared-thermal-black-body-radiation',
  title: 'Black-body radiation',
  tagline: 'Everything warm glows; at room temperature the glow is at 10 µm',
  formula: (p) => {
    const R = bbRun(bbParams(p))
    return `T = ${celsiusText(R.c)} = ${Math.round(R.tK)} K · Wien: λ_peak = 2898 µm·K / T = ${umText(R.peak)} · Stefan–Boltzmann: M = ε·σ·T⁴ = ${R.eps} × 5.67e-8 × ${Math.round(R.tK)}⁴ = ${perM2(R.M)} · net into a ${DESK_ROOM_C} °C room: ε·σ·(T⁴ − T_room⁴) = ${fixedText(R.netMw * 10, 1)} W/m²`
  },
  legend: [
    { color: HEAT, label: 'This surface: spectrum ε × Planck (log axes)', shape: 'dot' },
    { color: B_FIELD, label: 'Black bodies for reference: body 37 °C, soldering iron 350 °C', shape: 'dot' },
    { color: RING, label: 'Wien peak λ = 2898 µm·K / T', shape: 'dot' },
    { color: IR_TINT, label: 'Radiated heat (rays ∝ log of power)', shape: 'dot' },
  ],
  points: [
    'Every object above absolute zero radiates, because its jiggling charges do. An ideal radiator, a black body, sends out a fixed spectrum that depends only on its temperature: the Planck curve.',
    'Hotter means bluer: the peak sits at λ = 2898 µm·K / T (Wien’s law). A cold drink peaks near 10.4 µm, your skin at 9.3 µm, a 350 °C soldering iron at 4.6 µm, a bulb filament (2700 K) at 1.1 µm and the sun (5800 K) at 0.5 µm, right in the middle of what eyes see. Below about 500 °C nearly nothing is visible, so hot things look normal; above it they glow dull red, then orange.',
    'Hotter also means much more: total power M = σ·T⁴ (Stefan–Boltzmann), in kelvin. Double the kelvin and you get 16× the power. Your body sends out ~0.5 kW/m² but also soaks up nearly as much from the room; only the difference ε·σ·(T⁴ − T_room⁴), about 100 W for a person, is lost.',
    'Real surfaces emit a fraction ε (emissivity) of the black-body curve, and reflect the rest of what falls on them. Skin, paint, tape and plastic: ε ≈ 0.95. Bare or polished metal: 0.03 to 0.1, so a shiny heatsink radiates poorly and also mirrors the room. Anodising or painting it fixes both.',
    'Detectors only see their own band. Eyes 0.38–0.75 µm; silicon (phone cameras, the IR LEDs and phototransistors in Sensors › Infrared) up to ~1.1 µm, which is reflected light, not heat (Light & optics › Reflection). A thermopile (MLX90614, AMG8833) reads 8–14 µm, where room-temperature things glow brightest; that is how it measures temperature without touching (Thermal camera).',
  ],
  controls: [
    { kind: 'slider', key: 'temp', label: 'Temperature', min: -20, max: 1000, step: 5, initial: 37, format: (v) => `${v} °C` },
    { kind: 'choice', key: 'finish', options: opts(SURFACE_NAMES), initial: 'paint' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const C: V3 = [-8.5, 0, 0]
    const plateM = mat(SURFACE_LOOK.paint.color, { rough: 0.9 }, true)
    box(scene, [2.6, 2.6, 0.8], plateM, C)
    const rayM = glowMat(IR_TINT, 0.8)
    const rays = rayFan(scene, 16, rayM, 0.09)
    const tTag = liveLabel(scene, [-17, -4.4, 0.4], { size: 0.32, align: 'left' })
    const finishTag = liveLabel(scene, [-17, -5.05, 0.4], { size: 0.26, color: GREY, align: 'left' })

    addLabel(scene, 'Emitted at this temperature, by finish', [-17, -5.85, 0.3], LABEL, 0.28, 'left')
    const bars = countBars(scene, [-10.8, -6.5, 0], SURFACE_LIST.map((k) => EMISSIVITY[k].name), 4.2, { row: 0.45, size: 0.24 })

    const plot = titledScope(scene, 0.4, 7, 'spectrum, W/(m²·µm), log scale', HEAT)
    const { s } = plot
    const refTr = REFS.map((r) => s.trace(r.color, { samples: SP.samples, radius: 0.035 }))
    const tr = s.trace(HEAT, { samples: SP.samples, radius: 0.07 })
    const peak = cursorBar(s, RING, 0.08)
    plot.lo.set('0.3 µm')
    plot.hi.set('30 µm')
    const [x0, w] = [6.4 - 5.25, 10.5]
    const yOf = (v: number) => -plot.h / 2 + ((Math.log10(Math.max(v, 1e-12)) - SP.yLo) / (SP.yHi - SP.yLo)) * plot.h
    for (const [u, t] of [[uOfLambda(1e-6), '1'], [uOfLambda(3e-6), '3'], [uOfLambda(10e-6), '10']] as const) addLabel(scene, t, [x0 + u * w, 0.4 - 3.5 - 0.9, 0.3], GREY, 0.26)
    addLabel(scene, '100k', [x0 - 0.8, 0.4 + 3.3, 0.3], GREY, 0.24, 'right')
    addLabel(scene, '0.01', [x0 - 0.8, 0.4 - 3.4, 0.3], GREY, 0.24, 'right')
    REFS.forEach((r, i) => {
      const pk = wienPeakM(kelvinOf(r.c))
      addLabel(scene, r.name, [x0 + uOfLambda(pk) * w, 0.4 + yOf(Math.max(...REF_CURVES[i])) + 0.45, 0.4], r.color, 0.24)
    })
    REF_CURVES.forEach((c, i) => refTr[i].draw((u) => yOf(c[Math.round(u * (SP.samples - 1))]), null))
    const bandTags = BANDS.map((b, i) => {
      const y = -5.3 - i * 0.65
      const [u0, u1] = [uOfLambda(SENSOR_BANDS[b].lo), uOfLambda(SENSOR_BANDS[b].hi)]
      flatBox(scene, [(u1 - u0) * w, 0.3, 0.1], glowMat(BAND_COLORS[b], 0.6), [x0 + ((u0 + u1) / 2) * w, y, 0])
      flatBox(scene, [w, 0.06, 0.05], glowMat(GREY, 0.15), [x0 + w / 2, y, -0.05])
      addLabel(scene, SENSOR_BANDS[b].name, [x0 - 0.3, y, 0.3], BAND_COLORS[b], 0.24, 'right')
      return liveLabel(scene, [x0 + u1 * w + 0.3, y, 0.3], { size: 0.24, align: 'left' })
    })
    const st = { t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const R = bbRun(bbParams(p))
        st.t += dt
        const look = SURFACE_LOOK[R.s]
        plateM.color.set(look.color)
        plateM.roughness = look.rough
        plateM.metalness = look.metal
        heatGlow(plateM, R.glow)
        const len = 0.3 + 0.55 * Math.max(0, Math.log10(Math.max(R.M, 1)) - 0.8)
        const pulse = 0.85 + 0.15 * Math.sin(st.t * 3)
        rays(Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2 + 0.2
          const r0 = 1.8
          return [[C[0] + Math.cos(a) * r0, C[1] + Math.sin(a) * r0, 0], [C[0] + Math.cos(a) * (r0 + len * pulse), C[1] + Math.sin(a) * (r0 + len * pulse), 0]] as [V3, V3]
        }))
        setGlow(rayM, IR_TINT, 0.3 + 0.25 * len)
        tTag.set(`${celsiusText(R.c)} = ${Math.round(R.tK)} K`, R.glow > 0 ? HEAT : LABEL)
        finishTag.set(`${EMISSIVITY[R.s].name}, ε ${R.eps}`)
        bars.set(R.byFinish, R.byFinish.map(perM2), SURFACE_LIST.map((k) => (k === R.s ? HEAT : GREY)))

        tr.draw((u) => yOf(R.curve[Math.round(u * (SP.samples - 1))]), Math.min(1, Math.max(0, uOfLambda(R.peak))))
        peak(uOfLambda(R.peak))
        plot.right.set(`peak ${umText(R.peak)}`, RING)
        BANDS.forEach((b, i) => bandTags[i].set(shareText(R.shares[b]), BAND_COLORS[b]))

        head.status.set(`Black-body radiation · ${celsiusText(R.c)}`, LABEL)
        head.event.set(R.glow > 0 ? 'hot enough to glow visibly red' : R.c < DESK_ROOM_C ? 'colder than the room: absorbs more than it sends' : 'invisible glow: all infrared', R.glow > 0 ? HEAT : R.c < DESK_ROOM_C ? B_FIELD : POWER)
        head.sub.set(`band shares of a black body at this temperature · room ${DESK_ROOM_C} °C`)
      },
      readouts: (p) => {
        const R = bbRun(bbParams(p))
        return [
          { label: 'Peak wavelength', value: umText(R.peak) },
          { label: 'Emitted εσT⁴', value: perM2(R.M) },
          { label: 'Net from 1 cm² into the room', value: `${R.netMw < 0 ? '−' : ''}${fixedText(Math.abs(R.netMw), Math.abs(R.netMw) < 10 ? 1 : 0)} mW`, tone: R.netMw < 0 ? 'warn' : 'ok' },
          { label: 'In the thermopile band', value: shareText(R.shares.thermal) },
        ]
      },
    }
  },
}

// --- Thermal camera: a thermopile array views a desk; pixels average radiance over their footprint, shiny metal reads cold. ---

const CAM_NAMES = namesOf(THERMAL_CAMS)
const MOTOR_FINISHES = { paint: 'Motor painted black', anodised: 'Motor anodised', aluminium: 'Motor bare aluminium' } as const
type MotorFinish = keyof typeof MOTOR_FINISHES
const TC = { k: 14, cx: -9.2, cy: -2.6, x0: -17, x1: -1.6, y0: -8.6, y1: 3.4, hx: 7.2, hy: -1.5, hw: 12, hh: 9 }
const tcParams = (p: Params) => ({ cam: pick(THERMAL_CAMS, p.cam, 'mlx90640') as ThermalCam, d: n(p, 'dist'), f: pick(MOTOR_FINISHES, p.motor, 'paint') as MotorFinish })
type TcQ = ReturnType<typeof tcParams>
const tcRun = memoBy(
  (q: TcQ) => `${q.cam}|${q.d}|${q.f}`,
  (q: TcQ) => {
    const scene = deskScene(EMISSIVITY[q.f].eps)
    const img = thermalImage(q.cam, q.d, scene)
    const [reg, motor] = ['regulator', 'motor'].map((name) => scene.find((b) => b.name === name)!)
    return { ...q, scene, img, reg, regRead: img.at(reg.x, reg.y), motorRead: img.at(motor.x, motor.y), gun: apparentC(65, EMISSIVITY[q.f].eps) }
  },
)
const readText = (c: number | null) => (c === null ? 'out of view' : celsiusText(c, 1))
const toPanel = (x: number, y: number): [number, number] => [TC.cx + (x - DESK_AIM[0]) * TC.k, TC.cy + (y - DESK_AIM[1]) * TC.k]

/** Desk scene in front view at TC.k units per metre; `motor(finish)` restyles the motor can. */
function deskModel(parent: THREE.Object3D) {
  const z = -0.6
  box(parent, [TC.x1 - TC.x0, TC.y1 - TC.y0, 0.3], mat('#3a3f48', { rough: 0.9 }), [(TC.x0 + TC.x1) / 2, (TC.y0 + TC.y1) / 2, z - 0.5])
  const deskY = toPanel(0, DESK_TOP)[1]
  box(parent, [TC.x1 - TC.x0, deskY - TC.y0, 0.4], mat('#6b5440', { rough: 0.8 }), [(TC.x0 + TC.x1) / 2, (deskY + TC.y0) / 2, z - 0.2])
  const at = (x: number, y: number, dz = 0): V3 => [...toPanel(x, y), z + dz]
  const k = TC.k
  box(parent, [0.36 * k, 0.18 * k, 0.4], mat('#3f6fb0', { rough: 0.8 }), at(-0.27, -0.16))
  box(parent, [0.06 * k, 0.06 * k, 0.3], mat('#c98a6b', { rough: 0.7 }), at(-0.27, -0.045))
  const face = add(parent, mesh(new THREE.SphereGeometry(1, 24, 16), mat('#d39a7a', { rough: 0.7 })), at(-0.27, 0.08, 0.2))
  face.scale.set(0.075 * k, 0.1 * k, 0.3)
  const motorM = mat('#1b1c20', { rough: 0.9 }, true)
  cylinder(parent, 0.03 * k, 0.09 * k, motorM, at(-0.02, -0.205, 0.3))
  box(parent, [0.07 * k, 0.1 * k, 0.15], mat('#1f6b3a', { rough: 0.6 }), at(0.14, -0.2))
  box(parent, [0.012 * k, 0.012 * k, 0.25], mat('#15161a', { rough: 0.5 }), at(0.14, -0.18, 0.1))
  cylinder(parent, 0.033 * k, 0.12 * k, mat('#c8242c', { rough: 0.35, metal: 0.4 }), at(0.3, -0.19, 0.3))
  const tag = (t: string, x: number, y: number) => addLabel(parent, t, [...toPanel(x, y), 0.4], GREY, 0.26)
  tag('person 34 °C', -0.27, 0.215)
  tag('motor 65 °C', -0.02, -0.285)
  tag('regulator 90 °C', 0.14, -0.33)
  tag('drink 6 °C', 0.3, -0.285)
  return {
    motor(f: MotorFinish) {
      const look = SURFACE_LOOK[f]
      motorM.color.set(look.color)
      motorM.roughness = look.rough
      motorM.metalness = look.metal
    },
  }
}

/** Visible segment of a→b inside the scene panel (axis-aligned lines only), or null. */
function clipToPanel(a: [number, number], b: [number, number]): [V3, V3] | null {
  const cx = (v: number) => Math.min(TC.x1, Math.max(TC.x0, v))
  const cy = (v: number) => Math.min(TC.y1, Math.max(TC.y0, v))
  if (a[0] === b[0] ? a[0] < TC.x0 || a[0] > TC.x1 : a[1] < TC.y0 || a[1] > TC.y1) return null
  const p: V3 = [cx(a[0]), cy(a[1]), 0.1]
  const q: V3 = [cx(b[0]), cy(b[1]), 0.1]
  return Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-3 ? null : [p, q]
}

export const infraredThermalThermalCamera: Lesson = {
  id: 'infrared-thermal-thermal-camera',
  title: 'Thermal camera',
  tagline: 'A grid of tiny thermometers: each pixel averages the heat it sees',
  formula: (p) => {
    const R = tcRun(tcParams(p))
    const c = THERMAL_CAMS[R.cam]
    return `pixel footprint = 2·d·tan(FOV/2) / pixels = 2 × ${R.d.toFixed(2)} m × tan(${c.hfov}°/2) / ${c.cols} = ${cmText(R.img.fp.px)} · 1.2 cm regulator fills ${pct(Math.min(1, (0.012 * 0.012) / (R.img.fp.px * R.img.fp.py)))} of a pixel · motor at 65 °C, ε ${EMISSIVITY[R.f].eps}, camera set to ε 0.95 → reads ${celsiusText(R.gun, 1)}`
  },
  legend: [
    { color: RING, label: 'Field of view and pixel footprints on the scene', shape: 'dot' },
    { color: HEAT, label: 'Hottest pixel, in the scene and the image', shape: 'dot' },
    { color: IR_TINT, label: 'False colour: black cold → white hot (auto range)', shape: 'dot' },
    { color: B_FIELD, label: 'Scene as a phone camera sees it (reflected light)', shape: 'dot' },
  ],
  points: [
    'A thermal camera is a grid of thermopiles, each a tiny thermometer behind a germanium or silicon lens that passes 8–14 µm, where room-temperature things glow brightest (Black-body radiation). The AMG8833 has 8×8 of them, the MLX90640 32×24, a FLIR Lepton 80×60 microbolometers. Each reports a temperature over I²C or SPI.',
    'The image is false colour: the camera maps the coldest pixel in view to black and the hottest to white (auto range), so the same 34 °C face is orange next to a cold drink and white without one. Read the numbers, not the colours.',
    'A pixel sees a patch, not a point: 2·d·tan(FOV/2) / pixels wide, 14 cm for an AMG8833 at 1 m. It reports the average of everything in it. A 1.2 cm regulator at 90 °C fills a tiny share of that patch and reads barely above the wall; move closer or use more pixels before trusting a hotspot. Resolution and pixels are the same idea as in Perception › Image basics.',
    'The camera assumes an emissivity (here 0.95) to turn radiation into °C. Bare aluminium (ε ≈ 0.09) emits little and mirrors the room, so a 65 °C bare motor reads ~25 °C: dangerously cold. Put a strip of electrical tape or a dab of matte paint on shiny parts and measure that. Glass is opaque at 10 µm: a thermal camera cannot see through a window.',
    'Robots use these for finding people and pets (warm blobs, even in the dark), spotting overheating motors and regulators, and fire detection. Unlike the IR obstacle and line sensors in Sensors › Infrared, nothing is emitted: the scene itself is the light source.',
  ],
  controls: [
    { kind: 'choice', key: 'cam', options: opts(CAM_NAMES), initial: 'mlx90640' },
    { kind: 'slider', key: 'dist', label: 'Distance', min: 0.5, max: 2.5, step: 0.05, initial: 1, format: (v) => `${v.toFixed(2)} m` },
    { kind: 'choice', key: 'motor', options: opts(MOTOR_FINISHES), initial: 'paint' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const desk = deskModel(scene)
    addLabel(scene, 'What a phone camera sees', [TC.x0, TC.y1 + 0.5, 0.3], B_FIELD, 0.28, 'left')
    const overlay = rodPool(scene, 4 + 2 * 120 + 4)
    const grids = (Object.keys(THERMAL_CAMS) as ThermalCam[]).map((key) => {
      const c = THERMAL_CAMS[key]
      const pitch = Math.min(TC.hw / c.cols, TC.hh / c.rows)
      const g = add(scene, new THREE.Group())
      return { key, pitch, g, grid: pixelGrid(g, [TC.hx, TC.hy, 0], c.cols, c.rows, pitch) }
    })
    addLabel(scene, 'Thermal image, auto range', [TC.hx - TC.hw / 2, TC.hy + TC.hh / 2 + 0.9, 0.3], IR_TINT, 0.28, 'left')
    const camTag = liveLabel(scene, [TC.hx + TC.hw / 2, TC.hy + TC.hh / 2 + 0.9, 0.3], { size: 0.26, align: 'right', color: GREY })
    const marker = rodPool(scene, 4)
    const SCALE_N = 32
    const scaleBar = pixelGrid(scene, [TC.hx, TC.hy - TC.hh / 2 - 1.1, 0], SCALE_N, 1, 0.28)
    const col = new THREE.Color()
    for (let i = 0; i < SCALE_N; i++) scaleBar.mesh.setColorAt(i, ironbow(i / (SCALE_N - 1), col))
    scaleBar.commit()
    const scaleLo = liveLabel(scene, [TC.hx - 4.8, TC.hy - TC.hh / 2 - 1.1, 0.3], { size: 0.26, align: 'right' })
    const scaleHi = liveLabel(scene, [TC.hx + 4.8, TC.hy - TC.hh / 2 - 1.1, 0.3], { size: 0.26, align: 'left' })
    const hotTag = liveLabel(scene, [0, 0, 0.5], { size: 0.26, color: HEAT, align: 'left' })
    const fovNote = liveLabel(scene, [TC.x1, TC.y0 - 0.6, 0.3], { size: 0.24, color: GREY, align: 'right' })
    let shown = ''
    return {
      scene,
      view: VIEW,
      frame(_dt, p) {
        const R = tcRun(tcParams(p))
        desk.motor(R.f)
        const { img } = R
        const key = `${R.cam}|${R.d}|${R.f}`
        const G = grids.find((g) => g.key === R.cam)!
        if (key !== shown) {
          shown = key
          grids.forEach((g) => (g.g.visible = g.key === R.cam))
          const span = Math.max(1, img.hi - img.lo)
          for (let i = 0; i < img.temps.length; i++) G.grid.mesh.setColorAt(i, ironbow((img.temps[i] - img.lo) / span, col))
          G.grid.commit()

          const [ax, ay] = [DESK_AIM[0] - img.fp.w / 2, DESK_AIM[1] + img.fp.h / 2]
          const corner = (c: number, r: number) => toPanel(ax + c * img.fp.px, ay - r * img.fp.py)
          let k = 0
          const seg = (a: [number, number], b: [number, number], r: number, color: string) => {
            const s = clipToPanel(a, b)
            if (s && k < 248) overlay.set(k++, s[0], s[1], r, color)
          }
          const fine = img.cols <= 32 && img.fp.px * TC.k >= 0.3
          for (let c = 0; c <= img.cols; c++) if (fine || c === 0 || c === img.cols) seg(corner(c, 0), corner(c, img.rows), c % img.cols ? 0.02 : 0.06, RING)
          for (let r = 0; r <= img.rows; r++) if (fine || r === 0 || r === img.rows) seg(corner(0, r), corner(img.cols, r), r % img.rows ? 0.02 : 0.06, RING)
          const [hc, hr] = [img.hotCol, img.hotRow]
          const hp = [corner(hc, hr), corner(hc + 1, hr), corner(hc + 1, hr + 1), corner(hc, hr + 1)]
          hp.forEach((a, j) => seg(a, hp[(j + 1) % 4], 0.07, HEAT))
          overlay.hideFrom(k)
          overlay.commit()
          const cell = (c: number, r: number) => G.grid.cell(c, r)
          const h = G.pitch / 2
          const [m0, m1] = [cell(hc, hr), cell(hc, hr)]
          const sq: V3[] = [[m0[0] - h, m0[1] + h, 0.15], [m1[0] + h, m0[1] + h, 0.15], [m1[0] + h, m1[1] - h, 0.15], [m0[0] - h, m1[1] - h, 0.15]]
          sq.forEach((a, j) => marker.set(j, a, sq[(j + 1) % 4], Math.max(0.03, G.pitch * 0.08), HEAT))
          marker.commit()
          const fovOut = img.fp.w * TC.k > TC.x1 - TC.x0 || img.fp.h * TC.k > TC.y1 - TC.y0
          fovNote.set(fovOut ? 'field of view extends past this panel' : '')
        }
        const hc = G.grid.cell(img.hotCol, img.hotRow)
        hotTag.group.position.set(Math.min(hc[0] + G.pitch, TC.hx + TC.hw / 2 - 2), hc[1] + G.pitch + 0.3, 0.5)
        hotTag.set(`max ${celsiusText(img.hi, 1)}`)
        scaleLo.set(celsiusText(img.lo, 1), LABEL)
        scaleHi.set(celsiusText(img.hi, 1), LABEL)
        camTag.set(`${THERMAL_CAMS[R.cam].hfov}°×${THERMAL_CAMS[R.cam].vfov}° · pixel ${cmText(img.fp.px)} at ${R.d.toFixed(2)} m`)

        const regLost = R.regRead === null || R.regRead < 50
        head.status.set(`Thermal camera · ${THERMAL_CAMS[R.cam].name} at ${R.d.toFixed(2)} m`, LABEL)
        head.event.set(
          R.f === 'aluminium' ? `bare motor reads ${readText(R.motorRead)}: shiny metal looks cold` : regLost ? `regulator reads ${readText(R.regRead)}: averaged into its pixel` : `regulator resolved: ${readText(R.regRead)}`,
          R.f === 'aluminium' || regLost ? HIGH_V : POWER,
        )
        head.sub.set(`room ${DESK_ROOM_C} °C · camera emissivity set to 0.95`)
      },
      readouts: (p) => {
        const R = tcRun(tcParams(p))
        return [
          { label: 'Pixel footprint', value: cmText(R.img.fp.px) },
          { label: 'Regulator (90 °C) reads', value: readText(R.regRead), tone: R.regRead !== null && R.regRead > 75 ? 'ok' : 'warn' },
          { label: 'Motor (65 °C) reads', value: readText(R.motorRead), tone: R.motorRead !== null && R.motorRead > 55 ? 'ok' : 'warn' },
          { label: 'Hottest pixel', value: celsiusText(R.img.hi, 1) },
        ]
      },
    }
  },
}
