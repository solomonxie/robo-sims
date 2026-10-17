import * as THREE from 'three/webgpu'
import {
  Antenna,
  Keying,
  antennaPattern,
  keyedAt,
  keyedFreq,
  loraAirtime,
  loraBitRate,
  loraSnrLimit,
  pathLossDb,
  quarterWave,
  rangeFor,
  rssiDbm,
  sensitivityDbm,
  wavelength,
} from '../../core/physics'
import { dbmText, ohms, si } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh, rod, tube } from '../../models/kit'
import { buildEsp32 } from '../../models/modules'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  benchScope,
  emptyGroup,
  glide,
  glowMat,
  lieFlat,
  liveLabel,
  scope,
  setGlow,
  emWave,
} from '../fx'
import { Lesson, Params, Stage, pick } from '../types'

const db = (x: number) => `${Math.round(x)} dB`
const cm = (m: number) => `${+(m * 100).toFixed(m < 0.2 ? 1 : 0)} cm`
const dist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${+(m / 1000).toFixed(1)} km`)
const mhz = (hz: number) => (hz >= 1e9 ? `${+(hz / 1e9).toFixed(2)} GHz` : `${Math.round(hz / 1e6)} MHz`)

// --- 2.4 GHz: an ESP32 radiates; the wave thins out with the square of distance and every wall takes a bite. ---

const WIFI_HZ = 2.44e9
const TX = 20
const GAIN = 2
const WALL_DB = 10
const WALL_AT = [2, 5, 8]
const SENS = -90
const GOOD = -67
const DISTS = { '1': 1, '3': 3, '10': 10, '30': 30, '100': 100 }
const D_MIN = 0.5
const D_MAX = 200
const RINGS = 26
const CREST_HZ = 0.9
const K1 = 0.42
const ESP1: V3 = [-17.4, -3.2, 0]
const SRC: V3 = [ESP1[0] + 8 * K1, ESP1[1], 0.6]
const SPAN = 33
const PW = SPAN
const PH = 7.2
const PY = 7.6
const DB_TOP = -10
const DB_BOT = -100

const sOf = (d: number) => (SPAN * Math.log(d / D_MIN)) / Math.log(D_MAX / D_MIN)
const dOf = (s: number) => D_MIN * (D_MAX / D_MIN) ** (s / SPAN)
const wallsBefore = (d: number, walls: number) => WALL_AT.slice(0, walls).filter((w) => w < d).length
const rssiAt = (d: number, walls: number) => rssiDbm(TX, GAIN, d, WIFI_HZ, wallsBefore(d, walls) * WALL_DB)

const wifiOf = (p: Params) => {
  const dk = pick(DISTS, p.dist, '10')
  const walls = Math.max(0, Math.min(3, Math.round(Number(p.walls ?? 1))))
  const d = DISTS[dk]
  const crossed = wallsBefore(d, walls)
  return { dk, d, walls, crossed, fspl: pathLossDb(d, WIFI_HZ), rssi: rssiAt(d, walls), lambda: wavelength(WIFI_HZ) }
}
const tone = (r: number) => (r > GOOD ? 'ok' : r > -80 ? 'warn' : 'bad')
const toneColor = (r: number) => (r > GOOD ? POWER : r > -80 ? RING : r > SENS ? HEAT : HIGH_V)

export const twoFourGhz: Lesson = {
  id: 'radio-basics-2-4-ghz',
  title: '2.4 GHz',
  tagline: 'Wi-Fi’s 12 cm wave spreads out, thins with distance and loses a chunk at every wall',
  formula: (p) => {
    const s = wifiOf(p)
    return `RSSI = Ptx + G − FSPL − walls = ${TX} + ${GAIN} − ${db(s.fspl)} − ${s.crossed * WALL_DB} = ${dbmText(s.rssi)} · FSPL = 20·log10(4π·d / λ)`
  },
  legend: [
    { color: HIGH_V, label: 'Wavefronts: brighter = stronger field', shape: 'dot' },
    { color: RING, label: 'Received power (RSSI) vs distance', shape: 'dot' },
    { color: HEAT, label: `${SENS} dBm: link starts dropping`, shape: 'dot' },
    { color: POWER, label: `${GOOD} dBm: good enough to stream`, shape: 'dot' },
  ],
  points: [
    'An ESP32’s radio swings current in its antenna 2.44 billion times a second. The changing current launches an electromagnetic wave that travels at light speed: λ = c / f = 12.3 cm.',
    'The power spreads over a growing sphere, so its density falls as 1/d²: every doubling of distance costs 6 dB, every ×10 costs 20 dB. That is free-space path loss.',
    'Radio people count in dBm: 0 dBm = 1 mW, +20 dBm = 100 mW (the ESP32’s maximum), −90 dBm = a trillionth of a milliwatt. Adding dB = multiplying power.',
    `RSSI is what the receiver measures. Above ${GOOD} dBm Wi-Fi flies; near ${SENS} dBm packets get lost and the rate drops; below about −95 dBm the link is gone.`,
    `Walls absorb far more than distance: a brick wall costs about ${WALL_DB} dB, the same as tripling the distance. Water (people, plants) absorbs 2.4 GHz well, which is also why microwave ovens use it.`,
    `Rings show crests, not to scale (the real ones are ${cm(wavelength(WIFI_HZ))} apart); slowed about 3 × 10^9×.`,
  ],
  controls: [
    { kind: 'choice', key: 'dist', options: (Object.keys(DISTS) as (keyof typeof DISTS)[]).map((k) => ({ value: k, label: `${k} m` })), initial: '10' },
    { kind: 'choice', key: 'walls', options: [0, 1, 2, 3].map((n) => ({ value: String(n), label: n === 1 ? '1 wall' : `${n} walls` })), initial: '1' },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const esp = add(scene, new THREE.Group(), ESP1)
    esp.rotation.z = Math.PI
    add(esp, lieFlat(buildEsp32(), K1))
    addLabel(scene, 'ESP32 · +20 dBm', [ESP1[0], ESP1[1] - 3.4, 0], LABEL, 0.5)

    const rings = Array.from({ length: RINGS }, (_, i) => {
      const r = 0.9 + (i * (SPAN - 0.9)) / (RINGS - 1)
      const half = Math.min(1.2, Math.asin(Math.min(1, 5.2 / r)))
      const m = add(scene, mesh(new THREE.TorusGeometry(r, 0.08, 6, 64, 2 * half), glowMat(HIGH_V, 0)), SRC)
      m.rotation.z = -half
      m.castShadow = false
      return { m, d: dOf(r), mat: m.material as THREE.MeshStandardMaterial }
    })

    const walls = WALL_AT.map((d, i) => {
      const g = add(scene, new THREE.Group(), [SRC[0] + sOf(d), SRC[1], 0])
      box(g, [0.7, 10, 4], mat('#8a5a44', { rough: 0.85 }), [0, 0, -0.4])
      for (let k = -4; k <= 4; k += 1.3) box(g, [0.74, 0.08, 4.04], mat('#c9b8a4', { rough: 0.9 }), [0, k, -0.4])
      if (!i) addLabel(g, `−${WALL_DB} dB EACH`, [0, 5.7, 0], HEAT, 0.42)
      return g
    })

    const phone = add(scene, new THREE.Group())
    box(phone, [1.7, 3.2, 0.35], mat('#1b1d22', { rough: 0.4 }), [0, 0, 0])
    box(phone, [1.45, 2.8, 0.05], mat('#0b1013', { emissive: '#050a0a' }), [0, 0, 0.2])
    const bars = [0, 1, 2, 3].map((i) => {
      const h = 0.35 + i * 0.3
      const m = add(phone, mesh(new THREE.BoxGeometry(0.22, h, 0.08), glowMat(GREY, 0.2)), [-0.48 + i * 0.32, -0.6 + h / 2, 0.26])
      return m.material as THREE.MeshStandardMaterial
    })
    const phoneTag = liveLabel(phone, [0, 2.4, 0], { size: 0.5 })
    const phoneDist = liveLabel(phone, [0, -2.4, 0], { size: 0.42 })

    const plot = scope(scene, PW, PH, { divs: [10, 9] })
    plot.group.position.set(SRC[0] + PW / 2, PY, 0)
    const curve = plot.trace(RING, { samples: 220, radius: 0.08 })
    const yOf = (r: number) => ((r - DB_BOT) / (DB_TOP - DB_BOT) - 0.5) * PH
    plot.level(HEAT).set(yOf(SENS))
    plot.level(POWER).set(yOf(GOOD))
    addLabel(plot.group, 'RSSI VS DISTANCE · 10 dB/DIV · LOG DISTANCE', [-PW / 2, PH / 2 + 1, 0], LABEL, 0.45, 'left')
    for (const r of [-10, -50, -90]) addLabel(plot.group, `${r}`.replace('-', '−'), [-PW / 2 - 0.9, yOf(r), 0], GREY, 0.38, 'right')
    for (const d of [1, 10, 100]) addLabel(plot.group, `${d} m`, [plot.xAt(sOf(d) / SPAN), -PH / 2 - 0.9, 0], GREY, 0.38)

    const st = { key: '', t: 0, x: SRC[0] + sOf(10) }
    return {
      scene,
      view: { center: [-1.6, 2.2, 0], radius: 74, polar: 1.42, azimuth: 0.05 },
      frame(dt, p) {
        const s = wifiOf(p)
        const key = `${s.dk}|${s.walls}`
        if (key !== st.key) {
          st.key = key
          walls.forEach((w, i) => (w.visible = i < s.walls))
          curve.draw((u) => yOf(rssiAt(dOf(u * SPAN), s.walls)), sOf(s.d) / SPAN)
          phoneTag.set(dbmText(s.rssi), toneColor(s.rssi))
          phoneDist.set(`${s.d} M`, LABEL)
          const lit = s.rssi > GOOD ? 4 : s.rssi > -75 ? 3 : s.rssi > -82 ? 2 : s.rssi > SENS ? 1 : 0
          bars.forEach((m, i) => setGlow(m, i < lit ? toneColor(s.rssi) : GREY, i < lit ? 1.2 : 0.1))
        }
        st.t += dt
        st.x = glide(dt, st.x, SRC[0] + sOf(s.d), 5)
        phone.position.set(st.x, SRC[1], 1.4)
        rings.forEach((ring, i) => {
          const f = Math.max(0, (rssiAt(ring.d, s.walls) - (SENS - 8)) / (DB_TOP - (SENS - 8)))
          const crest = 0.5 + 0.5 * Math.cos(2 * Math.PI * (i / 4 - st.t * CREST_HZ))
          ring.mat.emissiveIntensity = 0.05 + 1.9 * f * crest ** 3
          ring.mat.color.set(HIGH_V).multiplyScalar(0.08 + 0.92 * f)
        })
      },
      readouts: (p) => {
        const s = wifiOf(p)
        return [
          { label: 'Wavelength', value: `${cm(s.lambda)} · λ/4 ${cm(s.lambda / 4)}` },
          { label: 'Path loss', value: `${db(s.fspl)} over ${s.d} m` },
          { label: 'Walls in the way', value: s.crossed ? `${s.crossed} × ${WALL_DB} dB` : 'none', tone: s.crossed ? 'warn' : 'ok' },
          { label: 'RSSI', value: s.rssi < -95 ? `${dbmText(s.rssi)} · lost` : dbmText(s.rssi), tone: tone(s.rssi) },
        ]
      },
    }
  },
}

// --- Antenna types: a λ/4 whip, a λ/2 dipole or a chip; the element is sized by the wavelength, which the E and B wave shows. ---

const BANDS = { '433': 433.92e6, '868': 868e6, '2400': 2.44e9 }
const BAND_NAMES = { '433': '433 MHz', '868': '868 MHz', '2400': '2.4 GHz' }
const ANTENNAS: Record<Antenna, { name: string; short: string; z: number; gain: Record<keyof typeof BANDS, number> }> = {
  whip: { name: 'λ/4 whip', short: 'λ/4 whip', z: 36, gain: { '433': 2, '868': 2, '2400': 2 } },
  dipole: { name: 'λ/2 dipole', short: 'λ/2 dipole', z: 73, gain: { '433': 2.15, '868': 2.15, '2400': 2.15 } },
  chip: { name: 'Chip antenna', short: 'Chip', z: 50, gain: { '433': -6, '868': -3, '2400': -0.5 } },
}
const UNIT = 0.025
const AX = -13
const WX0 = -11
const WX1 = 16.5
const ARROWS = 120
const AMP = 3.4
const WAVE_HZ = 0.55
const PAT: V3 = [-19.5, 7.8, 0]
const PAT_R = 3.2
const SEGS = 14

const antOf = (p: Params) => {
  const band = pick(BANDS, p.band, '433')
  const kind = pick(ANTENNAS, p.ant, 'whip') as Antenna
  const hz = BANDS[band]
  const lambda = wavelength(hz)
  const a = ANTENNAS[kind]
  const len = kind === 'whip' ? quarterWave(hz) : kind === 'dipole' ? 2 * quarterWave(hz) : 0.007
  return { band, kind, hz, lambda, a, len, gain: a.gain[band] }
}

/** Antenna at the origin, feed at y = 0; returns the glowing element segments with their current weight. */
function antennaModel(holder: THREE.Group, kind: Antenna, len: number) {
  emptyGroup(holder)
  const segs: { m: THREE.MeshStandardMaterial; w: number }[] = []
  const element = (y0: number, y1: number) => {
    for (let i = 0; i < SEGS; i++) {
      const a = y0 + ((y1 - y0) * i) / SEGS
      const b = y0 + ((y1 - y0) * (i + 1)) / SEGS
      const m = glowMat(HIGH_V, 0)
      m.color.set('#c9ccd1')
      rod(holder, [0, a, 0], [0, b, 0], 0.16, m)
      segs.push({ m, w: Math.cos(((i + 0.5) / SEGS) * (Math.PI / 2)) })
    }
  }
  const coax = mat('#25272c', { rough: 0.55 })
  if (kind === 'whip') {
    const l = len / UNIT
    element(0.15, l)
    cylinder(holder, 2.6, 0.12, mat('#2e7d4f', { rough: 0.5 }), [0, 0, 0], 'y', 32)
    rod(holder, [0, -0.1, 0], [0, -3.5, 0], 0.22, coax)
  } else if (kind === 'dipole') {
    const h = len / UNIT / 2
    element(0.15, h)
    element(-0.15, -h)
    rod(holder, [0, 0, -0.05], [-3, 0, -0.05], 0.22, coax)
  } else {
    box(holder, [5, 3.2, 0.16], mat('#2e7d4f', { rough: 0.5 }), [-1.2, -1.2, -0.1])
    box(holder, [0.7, 0.28, 0.3], mat('#e6e1d6', { rough: 0.4 }), [0, 0, 0.1])
    const m = glowMat(HIGH_V, 0)
    m.color.set('#c9a24a')
    box(holder, [0.3, 0.3, 0.32], m, [0.3, 0, 0.1])
    segs.push({ m, w: 1 })
    rod(holder, [-0.4, 0, 0.05], [-3.4, 0, 0.05], 0.08, mat('#d9b24a', { metal: 0.45, rough: 0.35 }))
  }
  return segs
}

/** Polar plot of the radiation pattern (side view, antenna vertical). */
function patternCurve(holder: THREE.Group, kind: Antenna) {
  emptyGroup(holder)
  const pts: V3[] = []
  for (let i = 0; i <= 96; i++) {
    const th = (i / 96) * 2 * Math.PI
    const r = PAT_R * antennaPattern(kind, th)
    pts.push([r * Math.sin(th), r * Math.cos(th), 0.25])
  }
  tube(holder, pts, 0.09, glowMat(POWER, 0.9), 160)
}

export const antennaTypes: Lesson = {
  id: 'radio-basics-antenna-types',
  title: 'Antenna types',
  tagline: 'The antenna’s length is set by the wavelength: a quarter or a half of it',
  formula: (p) => {
    const s = antOf(p)
    const el = s.kind === 'whip' ? `whip = 0.95 × λ/4 = ${cm(s.len)}` : s.kind === 'dipole' ? `dipole = 0.95 × λ/2 = ${cm(s.len)}` : `chip ≈ 7 mm, ${cm(s.lambda / 4)} folded inside`
    return `λ = c / f = 3×10⁸ / ${mhz(s.hz)} = ${cm(s.lambda)} · ${el}`
  },
  legend: [
    { color: HIGH_V, label: 'E field (and antenna current)', shape: 'dot' },
    { color: B_FIELD, label: 'B field, at right angles to E', shape: 'dot' },
    { color: POWER, label: 'Radiation pattern, side view', shape: 'dot' },
  ],
  points: [
    'An antenna is a wire tuned to resonate: current sloshes along it, strongest at the feed and zero at the tips, and the charge pile-up at the ends launches the wave.',
    'The wave is an electric field E (along the antenna) and a magnetic field B (across it), in step and at right angles, travelling outward at light speed. Hold the antenna vertical and the wave is vertically polarised.',
    'A λ/4 whip stands on a ground plane that mirrors it into a dipole: ≈ 36 Ω, 2 dBi. A λ/2 dipole needs no ground: ≈ 73 Ω, 2.15 dBi. Both radiate a donut: strong sideways, nothing off the tips.',
    'At 433 MHz a whip is 16 cm, at 2.4 GHz only 3 cm, which is why the ESP32 fits a meandered λ/4 trace on its board. A chip antenna squeezes it further, at the cost of a few dB.',
    'Real wire runs about 5 % short of the free-space λ/4. A 433 MHz module with no antenna, or a bare 17 cm wire at 2.4 GHz, can lose 10–20 dB.',
    'Drawn to scale: the 10 cm bar matches the wave. Slowed about 10^9×.',
  ],
  controls: [
    { kind: 'choice', key: 'band', options: (Object.keys(BANDS) as (keyof typeof BANDS)[]).map((k) => ({ value: k, label: BAND_NAMES[k] })), initial: '433' },
    { kind: 'choice', key: 'ant', options: (Object.keys(ANTENNAS) as Antenna[]).map((k) => ({ value: k, label: ANTENNAS[k].short })), initial: 'whip' },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const holder = add(scene, new THREE.Group(), [AX, 0, 0])
    const antTag = liveLabel(scene, [AX, -5.2, 0], { size: 0.5 })
    const wave = emWave(scene, WX0, WX1, { arrows: ARROWS })
    addLabel(scene, 'E', [WX1 + 0.8, AMP * 0.7, 0], HIGH_V, 0.7, 'left')
    addLabel(scene, 'B', [WX1 + 0.8, -0.4, AMP * 0.8], B_FIELD, 0.7, 'left')

    const lam = add(scene, new THREE.Group(), [WX0, -AMP - 3.4, 0])
    const lamBar = add(lam, mesh(new THREE.BoxGeometry(1, 0.08, 0.08), glowMat(RING, 0.8)))
    const lamEnds = [0, 1].map(() => add(lam, mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), glowMat(RING, 0.8))))
    const lamTag = liveLabel(lam, [0, -0.7, 0], { size: 0.45 })

    const ruler = add(scene, new THREE.Group(), [AX - 8, -6.8, 0])
    box(ruler, [0.1 / UNIT, 0.35, 0.2], mat('#d9d4c6', { rough: 0.6 }), [0.05 / UNIT, 0, 0])
    for (let k = 0; k <= 10; k++) box(ruler, [0.05, k % 5 ? 0.25 : 0.45, 0.25], mat('#202226'), [(k * 0.01) / UNIT, 0.15, 0.05])
    addLabel(ruler, '10 CM', [0.05 / UNIT, -0.8, 0], GREY, 0.4)

    box(scene, [2 * PAT_R + 1.6, 2 * PAT_R + 2.6, 0.3], mat('#14171b', { rough: 0.6 }), [PAT[0], PAT[1] + 0.4, -0.3])
    rod(scene, [PAT[0], PAT[1] - PAT_R, 0.05], [PAT[0], PAT[1] + PAT_R, 0.05], 0.03, mat('#46645a', { emissive: '#1a2a24' }))
    rod(scene, [PAT[0] - PAT_R, PAT[1], 0.05], [PAT[0] + PAT_R, PAT[1], 0.05], 0.03, mat('#46645a', { emissive: '#1a2a24' }))
    addLabel(scene, 'PATTERN', [PAT[0], PAT[1] + PAT_R + 0.9, 0.2], LABEL, 0.4)
    const pat = add(scene, new THREE.Group(), PAT)

    const st = { key: '', t: 0, segs: [] as { m: THREE.MeshStandardMaterial; w: number }[] }
    return {
      scene,
      view: { center: [-2, 0.6, 0], radius: 70, polar: 1.32, azimuth: 0.28 },
      frame(dt, p) {
        const s = antOf(p)
        const key = `${s.band}|${s.kind}`
        const lu = s.lambda / UNIT
        if (key !== st.key) {
          st.key = key
          st.segs = antennaModel(holder, s.kind, s.len)
          patternCurve(pat, s.kind)
          antTag.set(`${s.a.name.toUpperCase().replace('Λ', 'λ')} · ${s.kind === 'chip' ? '7 MM' : cm(s.len).toUpperCase()}`, LABEL)
          const w = Math.min(lu, WX1 - WX0)
          lamBar.scale.x = w
          lamBar.position.x = w / 2
          lamEnds[0].position.x = 0
          lamEnds[1].position.x = w
          lamEnds[1].visible = lu <= WX1 - WX0
          lamTag.group.position.x = w / 2
          lamTag.set(`λ = ${cm(s.lambda)}`, RING)
        }
        st.t += dt
        const ph = st.t * WAVE_HZ
        const amp = AMP * Math.min(1.2, 10 ** (s.gain / 20) / 10 ** (2.15 / 20))
        wave.set(lu, ph, amp)
        const drive = Math.cos(2 * Math.PI * ph)
        for (const g of st.segs) g.m.emissiveIntensity = 1.8 * g.w * Math.abs(drive)
      },
      readouts: (p) => {
        const s = antOf(p)
        return [
          { label: 'Wavelength', value: `${cm(s.lambda)} at ${mhz(s.hz)}` },
          { label: 'Element', value: s.kind === 'chip' ? `≈ 7 mm (λ/4 = ${cm(s.lambda / 4)})` : cm(s.len) },
          { label: 'Gain', value: `${s.gain > 0 ? '+' : s.gain < 0 ? '−' : ''}${Math.abs(s.gain)} dBi`, tone: s.gain >= 0 ? 'ok' : s.gain > -4 ? 'warn' : 'bad' },
          { label: 'Feed impedance', value: `≈ ${ohms(s.a.z)}${s.kind === 'whip' ? ' (on ground plane)' : ''}` },
        ]
      },
    }
  },
}

// --- LoRa: the same data keyed four ways, on a scope and as frequency vs time; slower chirps reach further. ---

const MARGIN = 10
const EXPONENT = 3
const PACKET = 20
const BW = 125e3
const NF = 6
const MODES = {
  ook: { name: '433 MHz OOK', short: 'OOK', keying: 'ook' as Keying, hz: 433.92e6, tx: 10, bw: 300e3, snr: 13, rate: 2400, sf: 0 },
  fsk: { name: '868 MHz FSK', short: 'FSK', keying: 'fsk' as Keying, hz: 868e6, tx: 14, bw: 25e3, snr: 10, rate: 9600, sf: 0 },
  sf7: { name: 'LoRa SF7', short: 'LoRa SF7', keying: 'chirp' as Keying, hz: 868e6, tx: 14, bw: BW, snr: loraSnrLimit(7), rate: loraBitRate(7, BW), sf: 7 },
  sf12: { name: 'LoRa SF12', short: 'LoRa SF12', keying: 'chirp' as Keying, hz: 868e6, tx: 14, bw: BW, snr: loraSnrLimit(12), rate: loraBitRate(12, BW), sf: 12 },
}
type ModeKey = keyof typeof MODES
const BITS = [1, 0, 1, 1, 0, 0, 1, 0]
const CHIRPS = [0.1, 0.6, 0.35, 0.85]
const BIT_CYCLES = 4
const CHIRP_CYCLES = 6
const SW = 16
const SH = 8.4
const BC: V3 = [-8.6, 6.4, 0]
const FW = 9
const FH = 5.2
const FC: V3 = [14.8, 3, 0]
const RX0 = -14
const RX1 = 20
const RY = -7
const R_MIN = 10
const R_MAX = 30000
const REVEAL3 = 2.6
const HOLD3 = 1.4

const xOfRange = (m: number) => RX0 + ((RX1 - RX0) * Math.log(m / R_MIN)) / Math.log(R_MAX / R_MIN)

const loraOf = (p: Params) => {
  const key = pick(MODES, p.mode, 'sf7')
  const m = MODES[key]
  const sens = sensitivityDbm(m.bw, NF, m.snr)
  const range = rangeFor(m.tx - sens - MARGIN, m.hz, EXPONENT)
  const syms = m.keying === 'chirp' ? CHIRPS : BITS
  const frame = m.sf ? (syms.length * 2 ** m.sf) / BW : syms.length / m.rate
  const airtime = m.sf ? loraAirtime(PACKET, m.sf, BW) : (8 * PACKET) / m.rate
  return { key, m, sens, range, syms, frame, airtime, cycles: m.keying === 'chirp' ? CHIRP_CYCLES : BIT_CYCLES }
}
const timeDiv = (s: number) => si(s / 10, 's', 2).replace(' ', '')

/** Small LoRa-style module: green PCB, shield can and a spring antenna, facing +z. */
function radioModule(parent: THREE.Object3D, at: V3) {
  const g = add(parent, new THREE.Group(), at)
  box(g, [3.4, 3, 0.2], mat('#2e7d4f', { rough: 0.5 }), [0, 0, 0])
  box(g, [2, 1.8, 0.4], mat('#c9ccd1', { metal: 0.45, rough: 0.3 }), [-0.3, -0.3, 0.3])
  const pts: V3[] = Array.from({ length: 120 }, (_, i) => {
    const a = (i / 119) * 14 * 2 * Math.PI
    return [1.1 + 0.35 * Math.cos(a), 1.5 + (i / 119) * 3.4, 0.35 * Math.sin(a)]
  })
  tube(g, pts, 0.07, mat('#d9b24a', { metal: 0.5, rough: 0.3 }), 360)
  return g
}

export const lora: Lesson = {
  id: 'radio-basics-lora',
  title: 'LoRa',
  tagline: 'Keying data onto a carrier: OOK, FSK, and LoRa’s slow chirps that reach kilometres',
  formula: (p) => {
    const s = loraOf(p)
    const sens = `sensitivity = −174 + 10·log10(${si(s.m.bw, 'Hz', 3)}) + NF ${NF} + SNR ${s.m.snr} = ${dbmText(s.sens)}`
    return s.m.sf ? `Rb = SF × BW / 2^SF × 4/5 = ${s.m.sf} × 125 kHz / ${2 ** s.m.sf} × 0.8 = ${si(s.m.rate, 'bps', 3)} · ${sens}` : sens
  },
  legend: [
    { color: RING, label: 'RF carrier on the scope', shape: 'dot' },
    { color: HIGH_V, label: 'Frequency vs time', shape: 'dot' },
    { color: POWER, label: 'Reach in town (10 dB fade margin)', shape: 'dot' },
  ],
  points: [
    'A radio sends data by changing something about its carrier. Turning it on and off is OOK, the digital cousin of AM: cheap 433 MHz remotes and doorbells. Hopping between two frequencies is FSK, the cousin of FM.',
    'LoRa sends chirps: each symbol sweeps the whole 125 kHz band upward, and the data is where in the sweep it starts. With spreading factor SF each chirp carries SF bits and lasts 2^SF / BW.',
    'The receiver correlates against a known chirp, so it can pull signals out from under the noise: SF7 decodes at −7.5 dB SNR, SF12 at −20 dB. Thermal noise in 125 kHz is −123 dBm, so SF12 hears −137 dBm.',
    'The price is speed: every step of SF halves the bit rate and doubles the time on air. SF7 sends a 20-byte packet in 57 ms, SF12 in 1.3 s. In the EU the 868 MHz band allows 1 % airtime: 36 s an hour.',
    `Range here: transmit power − sensitivity − ${MARGIN} dB margin, with loss growing as d^${EXPONENT} (buildings, trees). Line of sight from a hill reaches 10× further.`,
    'Carrier drawn about 10^5× slower than 868 MHz, with a few cycles per symbol.',
  ],
  controls: [{ kind: 'choice', key: 'mode', options: (Object.keys(MODES) as ModeKey[]).map((k) => ({ value: k, label: MODES[k].short })), initial: 'sf7' }],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const bench = benchScope(scene, SW, SH, { divs: [10, 8] })
    bench.group.position.set(...BC)
    const rf = bench.screen.trace(RING, { samples: 520, radius: 0.06 })
    const symTags = Array.from({ length: BITS.length }, () => liveLabel(bench.screen.group, [0, SH / 2 - 0.55, 0.3], { size: 0.38 }))
    const dividers = Array.from({ length: BITS.length - 1 }, () => {
      const m = add(bench.screen.group, mesh(new THREE.BoxGeometry(0.05, SH, 0.05), glowMat('#46645a', 0.5)), [0, 0, 0.2])
      m.castShadow = false
      return m
    })

    const fplot = scope(scene, FW, FH, { divs: [8, 4], zeroAt: 0 })
    fplot.group.position.set(...FC)
    const ftr = fplot.trace(HIGH_V, { samples: 260, radius: 0.08 })
    addLabel(fplot.group, 'FREQUENCY VS TIME', [-FW / 2, FH / 2 + 0.9, 0], LABEL, 0.42, 'left')
    const fTag = liveLabel(fplot.group, [0, -FH / 2 - 0.9, 0], { size: 0.38 })

    const mod = radioModule(scene, [RX0 - 3.6, RY + 0.4, 0])
    const modTag = liveLabel(scene, [RX0 - 3.6, RY - 2.2, 0], { size: 0.42 })
    box(scene, [RX1 - RX0 + 1, 0.3, 1.4], mat('#2a2c32', { rough: 0.6 }), [(RX0 + RX1) / 2, RY - 0.4, -0.2])
    for (const [m, name] of [[10, ''], [100, 'STREET'], [1000, 'DISTRICT'], [10000, 'TOWN']] as [number, string][]) {
      const x = xOfRange(m)
      box(scene, [0.08, 0.9, 0.08], mat('#46645a', { emissive: '#1a2a24' }), [x, RY, 0.5])
      addLabel(scene, dist(m), [x, RY - 1.1, 0.5], GREY, 0.38)
      if (name) addLabel(scene, name, [x, RY + 1.1, 0.5], GREY, 0.34)
    }
    const barMat = glowMat(POWER, 0.9)
    const bar = add(scene, mesh(new THREE.BoxGeometry(1, 0.35, 0.35), barMat), [RX0, RY, 0.3])
    bar.castShadow = false
    const packet = add(scene, mesh(new THREE.SphereGeometry(0.35, 12, 8), glowMat(RING, 1.4)))
    const rangeTag = liveLabel(scene, [0, RY + 1.9, 0.5], { size: 0.48 })

    const st = { key: '', t: 0, end: RX0 }
    return {
      scene,
      view: { center: [1.5, 0.4, 0], radius: 70, polar: 1.42, azimuth: 0.06 },
      frame(dt, p) {
        const s = loraOf(p)
        if (s.key !== st.key) {
          st.key = s.key
          st.t = 0
          const n = s.syms.length
          symTags.forEach((l, i) => {
            l.group.position.x = -SW / 2 + ((i + 0.5) / n) * SW
            l.set(i >= n ? '' : s.m.sf ? `S${Math.round(s.syms[i] * 2 ** s.m.sf)}` : String(s.syms[i]), LABEL)
          })
          dividers.forEach((d, i) => {
            d.visible = i < n - 1
            d.position.x = -SW / 2 + ((i + 1) / n) * SW
          })
          bench.status[0].set(`CH1 ${s.m.short.replace('LoRa ', '')}`, RING)
          bench.status[1].set(timeDiv(s.frame), LABEL)
          bench.knobs.time.set(Math.log10(s.frame / 1e-4) * 1.4)
          bench.knobs.volts.set(0)
          modTag.set(s.m.name.toUpperCase(), LABEL)
          fTag.set(s.m.keying === 'ook' ? 'ON / OFF' : s.m.keying === 'fsk' ? 'TWO TONES' : `CHIRPS · ${s.m.sf} BITS EACH`, GREY)
          rangeTag.set(dist(s.range).toUpperCase(), POWER)
        }
        st.t += dt
        if (st.t > REVEAL3 + HOLD3) st.t = 0
        const prog = Math.min(1, st.t / REVEAL3)
        const y = (u: number) => keyedAt(s.m.keying, u, s.syms, s.cycles) * SH * 0.36
        rf.draw((u) => (u <= prog ? y(u) : 0), prog < 1 ? prog : null)
        const top = 1.6 * s.cycles
        ftr.draw((u) => (u <= prog ? (keyedFreq(s.m.keying, u, s.syms, s.cycles) / top) * FH : 0) - FH / 2, prog < 1 ? prog : null)
        bench.lamp(POWER, prog < 1)
        bench.status[2].set(prog < 1 ? 'TX' : 'HOLD', prog < 1 ? HEAT : GREY)
        st.end = glide(dt, st.end, xOfRange(s.range), 4)
        bar.scale.x = Math.max(0.01, st.end - RX0)
        bar.position.x = (RX0 + st.end) / 2
        rangeTag.group.position.x = st.end
        const f = (st.t / (REVEAL3 + HOLD3)) % 1
        packet.position.set(RX0 + f * (st.end - RX0), RY, 0.6)
        packet.visible = f < 0.98
        mod.rotation.y = 0.25 * Math.sin(st.t * 0.6)
      },
      readouts: (p) => {
        const s = loraOf(p)
        return [
          { label: 'Bit rate', value: si(s.m.rate, 'bps', 3) },
          { label: 'Sensitivity', value: `${dbmText(s.sens)} (${s.m.tx > 0 ? '+' : ''}${s.m.tx} dBm out)` },
          { label: 'Reach in town', value: dist(s.range), tone: s.range > 2000 ? 'ok' : s.range > 500 ? 'warn' : 'bad' },
          { label: `${PACKET}-byte packet`, value: si(s.airtime, 's', 3), tone: s.airtime < 0.2 ? 'ok' : s.airtime < 1 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}
