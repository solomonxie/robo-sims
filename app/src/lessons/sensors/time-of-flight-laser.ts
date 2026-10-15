import * as THREE from 'three/webgpu'
import {
  Solid,
  TOF_MODES,
  TOF_TARGETS,
  TofMode,
  TofTarget,
  VL53L0X,
  VL53L5CX,
  ZoneScene,
  arrivalHistogram,
  echoSeconds,
  lightVsSound,
  reportedMm,
  steerFrom,
  tofMaxRange,
  tofRanging,
  zoneGrid,
  zoneWidth,
} from '../../core/physics'
import { hexByte, msText } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CODE_LEGEND,
  GREY,
  HEAT,
  IR_TINT,
  LABEL,
  POWER,
  RING,
  SUN_TINT,
  addLabel,
  addRod,
  beamCone,
  codeBlock,
  glide,
  glowHalo,
  glowMat,
  lightRay,
  liveLabel,
  memoBy,
  partLetter,
  potentialColor,
  scope,
  setGlow,
  sineHash,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

/** Standard normal from two hashes (Box–Muller). */
const gauss = (k: number) => Math.sqrt(-2 * Math.log(Math.max(1e-6, sineHash(k)))) * Math.cos(2 * Math.PI * sineHash(k + 0.5))
const ns = (s: number) => `${(s * 1e9).toFixed(2)} ns`
const STATUS: Record<number, string> = { 0: 'valid', 1: 'sigma fail', 2: 'signal fail', 4: 'out of range' }

// --- VL53L0X: one 940 nm pulse, a SPAD array timing its return, read over I²C. ---

const TARGET_LABEL: Record<TofTarget, string> = { white: 'White 88 %', grey: 'Grey 17 %', black: 'Black 5 %' }
const TARGET_COLOR: Record<TofTarget, string> = { white: '#ecebe6', grey: '#7d7f84', black: '#2a2b30' }
const L0 = { face: -16.4, y: 2.6, sc: 0.17, slow: 1.5e8, pause: 0.7, bins: 96, win: 16 }

const l0Run = memoBy(
  (p: Params) => `${p.cm}|${p.target}|${p.klux}|${p.mode}`,
  (p: Params) => {
    const cm = n(p, 'cm')
    const target: TofTarget = pick(TOF_TARGETS, p.target, 'white')
    const klux = n(p, 'klux')
    const mode: TofMode = pick(TOF_MODES, p.mode, 'default')
    const refl = TOF_TARGETS[target]
    const R = tofRanging(cm / 100, refl, klux, mode)
    return {
      cm,
      target,
      klux,
      mode,
      M: TOF_MODES[mode],
      ...R,
      reach: tofMaxRange(refl, klux, mode),
      hist: arrivalHistogram(cm / 100, refl, klux, mode, L0.bins, L0.win),
      sound: echoSeconds(cm / 100, 20),
    }
  },
)

export const vl53l0x: Lesson = {
  id: 'time-of-flight-laser-vl53l0x',
  title: 'VL53L0X',
  tagline: 'Time a laser pulse to the target and back, in picoseconds',
  formula: (p) => {
    const R = l0Run(p)
    return `t = 2d / c = 2 × ${(R.cm / 100).toFixed(2)} m / 3×10⁸ m/s = ${ns(R.tripS)} · return ∝ ρ / d² = ${R.sig.toFixed(2)} Mcps, ambient ${R.amb.toFixed(2)} Mcps · N = rate × ${R.M.budgetMs} ms: ${Math.round(R.ns)} signal, ${Math.round(R.na)} ambient counts · σ = ${VL53L0X.pulseMm} mm × √(Ns + 2Na) / Ns = ${R.sigma.toFixed(1)} mm (limit ${R.M.sigmaMm}) → status ${R.status}: ${STATUS[R.status]}`
  },
  legend: [
    { color: IR_TINT, label: `${VL53L0X.nm} nm laser pulse, drawn pink`, shape: 'dot' },
    { color: SUN_TINT, label: 'Ambient light: random SPAD hits', shape: 'dot' },
    { color: RING, label: 'Photon arrivals vs time', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'A VL53L0X fires short pulses from a 940 nm VCSEL (a tiny laser) and times each one back on an array of SPADs: diodes so sensitive that a single photon sets them off. Distance = c × t / 2, the same echo rule as the ultrasonic sensor (see Ultrasonic › Time of flight).',
    'Light is ~10⁶× faster than sound: 1 m and back takes 6.7 ns, not 5.8 ms. 1 mm is 6.7 ps, far shorter than the pulse, so the chip fires thousands of pulses per reading and builds a histogram of arrival times; the centre of the peak gives the range.',
    'Only a few photons come back: the return falls with reflectance and 1/d². Ambient light adds random SPAD hits spread over the whole window. Range noise σ ≈ (pulse length) / √(signal counts), and the ambient floor makes it worse.',
    'Each reading checks two limits: too few return photons (signal fail) or too much noise (sigma fail). Default mode reaches ~1.2 m on white, ~0.5 m on grey, and much less in sunlight; a longer timing budget or long-range mode trades speed for reach.',
    'It talks I²C at 0x29 (see Microcontrollers › I²C). Every sensor wakes at 0x29, so for several hold the others in reset with XSHUT and give each a new address. Out of range it returns 8190.',
  ],
  controls: [
    { kind: 'slider', key: 'cm', label: 'Distance', min: 3, max: 200, step: 1, initial: 60, format: (v) => `${v} cm` },
    { kind: 'choice', key: 'target', options: (Object.keys(TOF_TARGETS) as TofTarget[]).map((k) => ({ value: k, label: TARGET_LABEL[k] })), initial: 'white' },
    { kind: 'slider', key: 'klux', label: 'Ambient light', min: 0, max: 100, step: 1, initial: 0, format: (v) => (v < 1 ? 'dark room' : `${v} klux`) },
    { kind: 'choice', key: 'mode', options: (Object.keys(TOF_MODES) as TofMode[]).map((k) => ({ value: k, label: TOF_MODES[k].name })), initial: 'default' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    // Breakout seen edge-on, sensor package facing right.
    const bx = L0.face - 1.6
    box(scene, [0.5, 8, 4], mat('#5b2a86', { rough: 0.55 }), [bx, L0.y, 0])
    box(scene, [1.1, 3.2, 2.2], mat('#4a4d57', { rough: 0.3 }), [L0.face - 0.8, L0.y, 0])
    const emit: V3 = [L0.face, L0.y + 0.8, 0.4]
    const spad: V3 = [L0.face, L0.y - 0.8, 0.4]
    const vcselMat = glowMat(IR_TINT, 0.2)
    cylinder(scene, 0.38, 0.2, vcselMat, [L0.face - 0.15, emit[1], 0], 'x', 16)
    const spadMat = glowMat('#20222a', 0.2)
    cylinder(scene, 0.38, 0.2, spadMat, [L0.face - 0.15, spad[1], 0], 'x', 16)
    partLetter(scene, 'VCSEL', [L0.face - 0.2, L0.y + 2.3, 1.3], 0.32, IR_TINT, 'right')
    partLetter(scene, 'SPAD', [L0.face - 0.2, L0.y - 2.3, 1.3], 0.32, LABEL, 'right')
    ;['VIN', 'GND', 'SCL', 'SDA'].forEach((t, i) => {
      const y = L0.y + 2.4 - i * 1.6
      box(scene, [1.8, 0.22, 0.22], mat('#d9b24a', { metal: 0.4, rough: 0.35 }), [bx - 1.1, y, 0])
      partLetter(scene, t, [bx - 2.3, y, 0.2], 0.28, GREY, 'right')
    })
    partLetter(scene, `VL53L0X · I2C ${hexByte(VL53L0X.addr)}`, [L0.face - 0.2, L0.y - 5, 0.3], 0.34, LABEL, 'right')
    const emitHalo = glowHalo(scene, emit, 0.8)
    const spadHalo = glowHalo(scene, spad, 0.8)
    // Target card and beam.
    const card = add(scene, new THREE.Group(), [0, L0.y, 0])
    const cardMat = mat(TARGET_COLOR.white, { rough: 0.85 }, true)
    box(card, [0.6, 11, 4], cardMat, [0.3, 0, 0])
    const cone = beamCone(scene, IR_TINT)
    const pulseOut = add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), glowMat(IR_TINT, 1.6)))
    pulseOut.scale.set(2.6, 1, 1)
    const backMat = glowMat(IR_TINT, 1)
    const pulseBack = add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), backMat))
    pulseBack.scale.set(2.6, 1, 1)
    const sunMat = glowMat(SUN_TINT, 1)
    add(scene, new THREE.Mesh(new THREE.SphereGeometry(1.2, 20, 14), sunMat), [-7, 11.4, 0])
    const sunRays = [0, 1, 2].map(() => lightRay(scene, 10, 0.13, 0.6))
    const sunText = liveLabel(scene, [-5.2, 11.4, 0.3], { size: 0.34, align: 'left' })
    const ruler = addRod(scene, glowMat(GREY, 0.4))
    const rulerText = liveLabel(scene, [0, L0.y - 6.6, 0.3], { size: 0.38 })
    const flight = liveLabel(scene, [0, L0.y + 6.6, 0.3], { size: 0.38 })
    // SPAD array, magnified.
    const SP = { x: -21.6, y: -8.2, n: 8, c: 0.5 }
    partLetter(scene, 'SPAD array (zoom)', [SP.x, SP.y + 2.8, 0.3], 0.3, GREY)
    box(scene, [SP.n * SP.c + 0.4, SP.n * SP.c + 0.4, 0.2], mat('#16171b', { rough: 0.6 }), [SP.x, SP.y, -0.2])
    const cells = Array.from({ length: SP.n * SP.n }, (_, i) => {
      const m = glowMat(IR_TINT, 0)
      box(scene, [SP.c * 0.8, SP.c * 0.8, 0.2], m, [SP.x + ((i % SP.n) - 3.5) * SP.c, SP.y + (Math.floor(i / SP.n) - 3.5) * SP.c, 0])
      return { m, k: 0, color: IR_TINT }
    })
    // Histogram of arrival times.
    const PW = 34
    const PH = 6
    const PX = 3
    const PY = -9.8
    const plot = scope(scene, PW, PH, { divs: [16, 4], zeroAt: 0 })
    plot.group.position.set(PX, PY, 0)
    const hist = plot.trace(RING, { samples: L0.bins * 2, radius: 0.07 })
    const cursor = addRod(scene, glowMat(IR_TINT, 1.2))
    const peakText = liveLabel(scene, [0, PY + PH / 2 + 0.9, 0.3], { size: 0.32 })
    partLetter(scene, '0', [PX - PW / 2, PY - PH / 2 - 1, 0], 0.32, GREY, 'left')
    partLetter(scene, `${L0.win} ns`, [PX + PW / 2, PY - PH / 2 - 1, 0], 0.32, GREY, 'right')
    partLetter(scene, 'photon arrivals vs time', [PX, PY - PH / 2 - 1, 0], 0.32, LABEL)
    const code = codeBlock(scene, [-25, 14.6, 0], 0.34, 4)
    const status = liveLabel(scene, [-25, -15.6, 0.3], { size: 0.38, align: 'left' })
    const s = { key: '', x: L0.face + 60 * L0.sc, t: 0, cycle: 0, wall: 0, mm: 0 }
    return {
      scene,
      view: { center: [-1.5, -0.4, 0], radius: 80, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const R = l0Run(p)
        const key = `${R.cm}|${R.target}|${R.klux}|${R.mode}`
        s.wall += dt
        s.x = glide(dt, s.x, L0.face + R.cm * L0.sc, 10)
        card.position.x = s.x
        cardMat.color.set(TARGET_COLOR[R.target])
        // Pulse in flight at a fixed slow-down, so far targets take longer.
        const trip = R.tripS * L0.slow
        const period = trip + L0.pause
        if (key !== s.key) {
          s.t = 0
          s.cycle = 0
        }
        s.t += dt
        if (s.t >= period) {
          s.t -= period
          s.cycle++
        }
        const u = Math.min(1, s.t / trip)
        const flying = s.t < trip
        const hit = s.x - 0.1
        const gx = emit[0] + (hit - emit[0]) * Math.min(1, u * 2)
        pulseOut.visible = flying && u < 0.5
        pulseOut.position.set(gx, emit[1] + (L0.y - emit[1]) * u * 2, 0.4)
        pulseBack.visible = flying && u >= 0.5
        pulseBack.position.set(hit - (hit - spad[0]) * (u * 2 - 1), L0.y + (spad[1] - L0.y) * (u * 2 - 1), 0.4)
        const ret = Math.min(1, Math.max(0.08, Math.log10(1 + R.sig * 10) / 1.2))
        setGlow(backMat, IR_TINT, 0.3 + 1.2 * ret)
        pulseBack.scale.set(2.6 * (0.5 + 0.5 * ret), 0.5 + 0.5 * ret, 1)
        setGlow(vcselMat, IR_TINT, flying && u < 0.08 ? 2 : 0.2)
        emitHalo.set(flying && u < 0.08 ? 1.2 : 0.15, IR_TINT)
        cone(emit, 0, (VL53L0X.fovDeg * Math.PI) / 360, Math.max(0.5, s.x - emit[0]), 0.08)
        // Ambient: sunlight streaming onto the SPADs.
        const f = Math.sqrt(R.klux / 100)
        setGlow(sunMat, SUN_TINT, 0.15 + 1.2 * f)
        sunText.set(R.klux < 1 ? 'dark room' : `${R.klux} klux · ${R.amb.toFixed(1)} Mcps ambient`, R.klux > 20 ? HEAT : GREY)
        sunRays.forEach((ray, i) => ray([[-7 + (i - 1) * 0.8, 10.2, 0.3], [spad[0] + 0.6 + i * 0.4, spad[1] + 0.2, 0.4]], s.wall + i * 0.27, 1.1 * f, SUN_TINT))
        // SPAD hits: ambient at random, the return all at once.
        const arrived = !flying && s.t - trip < 0.25
        const hitFrac = Math.min(1, R.sig / 2)
        cells.forEach((c, i) => {
          const r = sineHash(i * 7.31 + Math.floor(s.wall * 30) * 0.913)
          if (r < f * 0.12) {
            c.k = 1.6
            c.color = SUN_TINT
          }
          if (arrived && sineHash(i * 3.7 + s.cycle) < 0.08 + 0.9 * hitFrac) {
            c.k = 2
            c.color = IR_TINT
          }
          c.k = glide(dt, c.k, 0, 8)
          setGlow(c.m, c.color, c.k)
        })
        spadHalo.set(arrived ? 0.4 + ret : 0.15 * f, arrived ? IR_TINT : SUN_TINT)
        setGlow(spadMat, '#20222a', 0.2)
        stretchRod(ruler, [L0.face, L0.y - 5.8, 0.3], [s.x, L0.y - 5.8, 0.3], 0.05)
        rulerText.group.position.x = (L0.face + s.x) / 2
        rulerText.set(`d = ${R.cm} cm`, LABEL)
        flight.group.position.x = (L0.face + s.x) / 2
        flight.set(`out and back: ${ns(R.tripS)} (sound: ${msText(R.sound, 2)})`, IR_TINT)
        // Histogram: redraw on input change; light noise ∝ √counts.
        if (key !== s.key) {
          const top = Math.max(...R.hist)
          hist.draw((x) => {
            const i = Math.min(L0.bins - 1, Math.floor(x * L0.bins))
            const c = R.hist[i] + Math.sqrt(R.hist[i]) * gauss(i * 1.37 + R.cm)
            return -PH / 2 + 0.1 + (Math.max(0, c) / (top * 1.15)) * (PH - 0.2)
          }, null)
          s.key = key
        }
        const tx = PX + plot.xAt(Math.min(1, (R.tripS * 1e9) / L0.win))
        const cx = PX + plot.xAt(Math.min(1, ((flying ? u : 1) * R.tripS * 1e9) / L0.win))
        stretchRod(cursor, [cx, PY - PH / 2, 0.4], [cx, PY + PH / 2, 0.4], 0.05)
        peakText.group.position.x = Math.min(PX + PW / 2 - 3, Math.max(PX - PW / 2 + 3, tx))
        peakText.set(R.tripS * 1e9 > L0.win ? 'peak past the window' : R.ok ? `peak ${ns(R.tripS)} → ${R.cm} cm` : 'peak lost in the noise', R.ok ? RING : HEAT)
        // A new reading each cycle.
        s.mm = reportedMm(R.cm / 100, R.sigma, R.ok, gauss(s.cycle * 3.1 + R.cm))
        code([
          'VL53L0X tof;  Wire.begin(21, 22);  tof.init();  // 0x29',
          `tof.setSignalRateLimit(${R.M.minMcps});  tof.setMeasurementTimingBudget(${R.M.budgetMs * 1000});`,
          `uint16_t mm = tof.readRangeSingleMillimeters();  // ${s.mm}`,
          `if (mm >= ${VL53L0X.outOfRange}) mm = 0;  // no valid target`,
        ])
        status.set(
          `t = ${ns(u * R.tripS)} · slowed ${(L0.slow / 1e6).toFixed(0)} million× · ${R.ok ? `reads ${s.mm} mm (±${R.sigma.toFixed(0)}) at ${R.hz.toFixed(0)} Hz` : `${STATUS[R.status]}: reach here ${Math.round(R.reach * 100)} cm`}`,
          R.ok ? POWER : HEAT,
        )
      },
      readouts: (p) => {
        const R = l0Run(p)
        return [
          { label: 'Round trip', value: `${ns(R.tripS)} (${Math.round(lightVsSound(20) / 1000)}k× sound)` },
          { label: 'Return / ambient', value: `${R.sig.toFixed(2)} / ${R.amb.toFixed(1)} Mcps`, tone: R.sig < R.M.minMcps ? 'warn' : 'ok' },
          { label: 'Sigma', value: `${R.sigma.toFixed(R.sigma < 100 ? 1 : 0)} mm`, tone: R.sigma > R.M.sigmaMm ? 'warn' : 'ok' },
          { label: 'Status', value: `${R.status}: ${STATUS[R.status]}`, tone: R.ok ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Multi-zone ranging: an 8×8 depth image in front of a robot. ---

const RES = { x4: '4×4 zones, 60 Hz', x8: '8×8 zones, 15 Hz' }
const MZ = { sx: -19, sy: -1, sc: 13, wallM: 1.6, gx: 12.5, gy: -0.6, gw: 14, h: 0.08 }
const POST: Solid = { kind: 'post', name: 'chair leg', at: [0.95, -0.32], r: 0.015, h: 0.45 }
const BOX = { d: 0.3, w: 0.3, h: 0.25 }
const top = (x: number, y: number, z = 0): V3 => [MZ.sx + x * MZ.sc, MZ.sy + y * MZ.sc, z]

const mzRun = memoBy(
  (p: Params) => `${p.res}|${p.m}|${p.side}|${p.tilt}`,
  (p: Params) => {
    const res = pick(RES, p.res, 'x8') === 'x4' ? 4 : 8
    const m = n(p, 'm')
    const side = n(p, 'side')
    const tilt = n(p, 'tilt')
    const sc: ZoneScene = {
      height: MZ.h,
      tilt: (tilt * Math.PI) / 180,
      solids: [
        { kind: 'box', name: 'wall', x: [MZ.wallM, MZ.wallM + 0.1], y: [-3, 3], h: 2 },
        { kind: 'box', name: 'box', x: [m, m + BOX.d], y: [side - BOX.w / 2, side + BOX.w / 2], h: BOX.h },
        POST,
      ],
    }
    const grid = zoneGrid(sc, res)
    const legSeen = grid.some((row) => row.some((z) => z.what === 'chair leg'))
    return { res, m, side, tilt, sc, grid, legSeen, steer: steerFrom(grid), zw: zoneWidth(m, res), hz: VL53L5CX.hz[res] }
  },
)

/** Near → red, 2 m and beyond → blue. */
const depthColor = (m: number | null, out = new THREE.Color()) => (m === null ? out.set('#15171c') : potentialColor(1 - Math.min(1, m / 2), out))
const FLOOR_GREY = new THREE.Color('#5a5e68')
const STEER: Record<string, string> = { stop: 'STOP', ahead: 'ahead', left: 'turn left', right: 'turn right' }

export const multiZoneRanging: Lesson = {
  id: 'time-of-flight-laser-multi-zone-ranging',
  title: 'Multi-zone ranging',
  tagline: 'An 8×8 grid of distances: a coarse depth image in front of the robot',
  formula: (p) => {
    const R = mzRun(p)
    return `${VL53L5CX.fovDeg}° / ${R.res} = ${(VL53L5CX.fovDeg / R.res).toFixed(1)}° per zone · width at d: 2d·tan(${(VL53L5CX.fovDeg / R.res / 2).toFixed(2)}°) = ${(R.zw * 100).toFixed(1)} cm at ${R.m.toFixed(2)} m · ${R.res * R.res} zones × ${R.hz} Hz = ${R.res * R.res * R.hz} ranges/s · nearest (floor masked) ${Number.isFinite(R.steer.nearest) ? `${Math.round(R.steer.nearest * 100)} cm` : 'none'} → ${STEER[R.steer.action]}`
  },
  legend: [
    { color: IR_TINT, label: '940 nm pulse per column', shape: 'dot' },
    { color: HEAT, label: 'Zone depth: red near → blue far', shape: 'dot' },
    { color: GREY, label: 'Grey zone = floor, masked', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'A VL53L5CX floods a 45° × 45° square with 940 nm light and splits its SPAD array into zones: 4×4 at up to 60 Hz or 8×8 at 15 Hz. Each zone is its own time-of-flight sensor (see VL53L0X), so one read gives 64 distances: a tiny depth camera.',
    'Zones are angles, not sizes: 45° / 8 = 5.6° each, so a zone is ~10 cm wide at 1 m and ~20 cm at 2 m. A thin chair leg fills enough of an 8×8 zone to show up, but in a 4×4 zone it is under a quarter of the area and gets lost behind the wall.',
    'Each zone reports one distance: the nearest target that covers a fair share of it. Edges blur: a zone half on a box and half on the wall reads the box.',
    'Mounted low and level, the bottom rows see the floor. Tilt the sensor up, or mask zones whose reading matches where the floor should be. Then steering is easy: stop if anything is close, else turn toward the half of the image that is further away.',
    'At start-up the ESP32 uploads ~84 KB of firmware to the sensor over I²C (see Microcontrollers › I²C), which takes a few seconds at 400 kHz; 1 MHz Fast-mode Plus helps. Then each frame is 64 distances plus a status per zone.',
  ],
  controls: [
    { kind: 'choice', key: 'res', options: opts(RES), initial: 'x8' },
    { kind: 'slider', key: 'm', label: 'Box distance', min: 0.15, max: 1.3, step: 0.05, initial: 0.6, format: (v) => `${Math.round(v * 100)} cm` },
    { kind: 'slider', key: 'side', label: 'Box left ↔ right', min: -0.5, max: 0.5, step: 0.05, initial: 0.15, format: (v) => (Math.abs(v) < 0.01 ? 'centre' : `${Math.round(Math.abs(v) * 100)} cm ${v > 0 ? 'left' : 'right'}`) },
    { kind: 'slider', key: 'tilt', label: 'Sensor tilt up', min: 0, max: 20, step: 1, initial: 5, format: (v) => `${v}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    // Top view: floor, wall, chair leg, box, robot pointing +x (its left is up).
    box(scene, [26, 22, 0.2], mat('#3a3d45', { rough: 0.9 }), [MZ.sx + 9, MZ.sy, -0.4])
    box(scene, [0.1 * MZ.sc, 20, 2], mat('#8a8f9c', { rough: 0.8 }), top(MZ.wallM + 0.05, 0, 0.6))
    addLabel(scene, 'wall', top(MZ.wallM + 0.05, 0.8, 1.8), LABEL, 0.34)
    cylinder(scene, 0.25, 1.4, mat('#c9ced8', { rough: 0.4 }), top(0.95, -0.32, 0.5), 'z', 12)
    addLabel(scene, 'chair leg', top(0.95, -0.42, 0.6), GREY, 0.28)
    const boxG = add(scene, new THREE.Group())
    box(boxG, [BOX.d * MZ.sc, BOX.w * MZ.sc, 1.6], mat('#c8803f', { rough: 0.8 }), [0, 0, 0.6])
    addLabel(boxG, 'box', [0, 0, 1.5], '#2a1a0c', 0.34)
    const robot = add(scene, new THREE.Group(), [MZ.sx, MZ.sy, 0])
    box(robot, [3.6, 2.8, 1.2], mat('#d8dbe2', { rough: 0.55 }), [-2, 0, 0.4])
    for (const y of [-1.7, 1.7]) box(robot, [1.6, 0.6, 1.2], mat('#1c1c1f', { rough: 0.8 }), [-2.4, y, 0.4])
    box(robot, [0.4, 1, 0.8], mat('#5b2a86', { rough: 0.55 }), [-0.1, 0, 1])
    addLabel(scene, 'robot', [MZ.sx - 2, MZ.sy - 2.6, 1.2], LABEL, 0.3)
    const cone = beamCone(scene, IR_TINT)
    const half = (VL53L5CX.fovDeg * Math.PI) / 360
    const fanMat = glowMat(IR_TINT, 0.35)
    const fans = Array.from({ length: 9 }, () => addRod(scene, fanMat))
    const beams = Array.from({ length: 8 }, () => lightRay(scene, 8, 0.12, 0.9))
    const hits = Array.from({ length: 8 }, () => add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), glowMat(IR_TINT, 1.2))))
    const steerMat = glowMat(RING, 1)
    const steer = addRod(scene, steerMat)
    const steerText = liveLabel(scene, [MZ.sx - 2, MZ.sy + 2.6, 1.2], { size: 0.38 })
    const ruler = addRod(scene, glowMat(GREY, 0.4))
    const rulerText = liveLabel(scene, [0, MZ.sy - 9.4, 0.3], { size: 0.34 })
    // Depth image, as seen from behind the robot.
    box(scene, [MZ.gw + 0.8, MZ.gw + 0.8, 0.4], mat('#2a2c32', { rough: 0.5 }), [MZ.gx, MZ.gy, -0.3])
    const tiles = ([4, 8] as const).map((res) => {
      const c = MZ.gw / res
      const g = add(scene, new THREE.Group())
      const cells = Array.from({ length: res * res }, (_, i) => {
        const r = Math.floor(i / res)
        const k = i % res
        const at: V3 = [MZ.gx - MZ.gw / 2 + (k + 0.5) * c, MZ.gy + MZ.gw / 2 - (r + 0.5) * c, 0]
        const m = glowMat('#15171c', 0.6)
        box(g, [c * 0.92, c * 0.92, 0.2], m, at)
        const t = liveLabel(g, [at[0], at[1], 0.2], { size: res === 8 ? 0.36 : 0.6 })
        return { m, t }
      })
      return { res, g, cells }
    })
    partLetter(scene, 'depth image (cm), robot’s view', [MZ.gx, MZ.gy + MZ.gw / 2 + 1, 0.3], 0.34, LABEL)
    partLetter(scene, 'left', [MZ.gx - MZ.gw / 2, MZ.gy - MZ.gw / 2 - 1, 0.3], 0.3, GREY, 'left')
    partLetter(scene, 'right', [MZ.gx + MZ.gw / 2, MZ.gy - MZ.gw / 2 - 1, 0.3], 0.3, GREY, 'right')
    const legText = liveLabel(scene, [MZ.gx, MZ.gy - MZ.gw / 2 - 2.2, 0.3], { size: 0.32 })
    const code = codeBlock(scene, [-25, 14.6, 0], 0.34, 4)
    const status = liveLabel(scene, [-25, -12.6, 0.3], { size: 0.38, align: 'left' })
    const s = { key: '', t: 0, frame: 0, bx: 0.6, by: 0.15 }
    const col = new THREE.Color()
    return {
      scene,
      view: { center: [-1.5, 0.4, 0], radius: 78, polar: 1.36, azimuth: 0.08 },
      frame(dt, p) {
        const R = mzRun(p)
        const key = `${R.res}|${R.m}|${R.side}|${R.tilt}`
        if (key !== s.key) {
          s.t = 0
          s.frame = 0
        }
        s.t += dt
        s.frame = Math.floor(s.t * R.hz)
        s.bx = glide(dt, s.bx, R.m, 10)
        s.by = glide(dt, s.by, R.side, 10)
        boxG.position.set(...top(s.bx + BOX.d / 2, s.by))
        const eye = top(0, 0, 0.9)
        cone(eye, 0, half, (MZ.wallM / Math.cos(half)) * MZ.sc, 0.07)
        // Column boundaries, and per column a beam to its nearest non-floor target.
        const step = (2 * half) / R.res
        fans.forEach((f, i) => {
          f.visible = i <= R.res
          if (!f.visible) return
          const a = half - i * step
          const L = (MZ.wallM / Math.cos(a)) * MZ.sc
          stretchRod(f, eye, [eye[0] + L * Math.cos(a), eye[1] + L * Math.sin(a), 0.9], 0.03)
        })
        const pulse = (s.t * R.hz) % 1
        beams.forEach((ray, c) => {
          const on = c < R.res
          let best: number | null = null
          if (on) for (const row of R.grid) if (row[c].m !== null && row[c].what !== 'floor' && (best === null || row[c].m! < best)) best = row[c].m
          const a = half - (c + 0.5) * step
          hits[c].visible = on && best !== null
          if (!on || best === null) return ray([], 0, 0)
          const flat = best * Math.cos(a) * MZ.sc
          const end: V3 = [eye[0] + flat, eye[1] + flat * Math.tan(a), 0.9]
          hits[c].position.set(...end)
          ray([eye, end], s.t + c * 0.13, 0.5 + 0.6 * (1 - pulse))
        })
        // Steering.
        const act = R.steer.action
        const turn = act === 'left' ? 0.7 : act === 'right' ? -0.7 : 0
        const base: V3 = [MZ.sx - 2, MZ.sy, 1.4]
        const len = act === 'stop' ? 0.01 : 3.4
        stretchRod(steer, base, [base[0] + len * Math.cos(turn), base[1] + len * Math.sin(turn), 1.4], 0.12)
        setGlow(steerMat, act === 'stop' ? HEAT : RING, 1)
        steerText.set(STEER[act], act === 'stop' ? HEAT : RING)
        stretchRod(ruler, top(0, -0.68, 0.3), top(s.bx, -0.68, 0.3), 0.05)
        rulerText.group.position.x = top(s.bx / 2, 0)[0]
        rulerText.set(`box ${Math.round(R.m * 100)} cm · zone ${(R.zw * 100).toFixed(0)} cm wide there`, GREY)
        // Grid: rebuild colours and numbers only on change.
        if (key !== s.key) {
          tiles.forEach((T) => {
            T.g.visible = T.res === R.res
            if (!T.g.visible) return
            T.cells.forEach((cell, i) => {
              const z = R.grid[Math.floor(i / R.res)][i % R.res]
              depthColor(z.m, col)
              const floor = z.what === 'floor'
              if (floor) col.lerp(FLOOR_GREY, 0.75)
              cell.m.color.copy(col)
              cell.m.emissive.copy(col)
              cell.m.emissiveIntensity = z.m === null ? 0.1 : floor ? 0.25 : 0.75
              cell.t.set(z.m === null ? '–' : `${Math.round(z.m * 100)}`, floor ? GREY : '#ffffff')
            })
          })
          s.key = key
        }
        legText.set(R.legSeen ? 'chair leg seen' : `chair leg missed: 3 cm in a ${(zoneWidth(0.95, R.res) * 100).toFixed(0)} cm zone, or hidden`, R.legSeen ? POWER : HEAT)
        code([
          'imager.begin();  // 84 KB firmware over I2C, 0x29',
          `imager.setResolution(${R.res * R.res});  imager.setRangingFrequency(${R.hz});`,
          'imager.startRanging();',
          `if (imager.getRangingData(&d)) steer(d.distance_mm);  // ${STEER[act]}`,
        ])
        status.set(
          `t = ${s.t.toFixed(1)} s (real time) · frame ${s.frame} at ${R.hz} Hz · nearest ${Number.isFinite(R.steer.nearest) ? `${Math.round(R.steer.nearest * 100)} cm` : 'none'} · ${STEER[act]}`,
          act === 'stop' ? HEAT : LABEL,
        )
      },
      readouts: (p) => {
        const R = mzRun(p)
        const floorRows = R.grid.filter((row) => row.some((z) => z.what === 'floor')).length
        return [
          { label: 'Zones × rate', value: `${R.res * R.res} × ${R.hz} Hz` },
          { label: 'Zone at the box', value: `${(R.zw * 100).toFixed(1)} cm` },
          { label: 'Floor rows', value: `${floorRows} of ${R.res}`, tone: floorRows > R.res / 4 ? 'warn' : 'ok' },
          { label: 'Steering', value: STEER[R.steer.action], tone: R.steer.action === 'stop' ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
