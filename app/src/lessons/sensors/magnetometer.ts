import * as THREE from 'three/webgpu'
import { Vec3, norm } from '../../core/fields'
import {
  CalMotion,
  DEG,
  MAGNET_BR,
  MAG_SITES,
  MagSite,
  QMC5883L,
  calAttitude,
  circleFit,
  dipoleAxisB,
  earthField,
  ironReading,
  magHeading,
  magnetMoment,
  qmcCounts,
  sphereFit,
  tiltAccel,
  tiltCompHeading,
  toBody,
  toDeg,
  toLevel,
  trueHeading,
  worstHeadingError,
  wrap2pi,
  wrapPi,
} from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  NORTH,
  POWER,
  RING,
  add3,
  compass,
  frac,
  glowMat,
  i2cBreakout,
  label,
  liveLabel,
  memoBy,
  pointCloud,
  shadowlessRod,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'
import { signed } from '../../core/units'

const hdg = (r: number) => `${String(Math.round(toDeg(wrap2pi(r))) % 360).padStart(3, '0')}°`
const uT = (v: number, d = 1) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`
/** (north, west, up) → stage: north is −z (away from the camera), east +x, up +y. */
const T = ([nn, w, u]: Vec3, k = 1): V3 => [-w * k, u * k, -nn * k]
/** Body (X forward, Y left, Z up) → robot-local stage axes. */
const bodyLocal = ([x, y, z]: Vec3, k = 1): V3 => [-y * k, z * k, -x * k]
/** Floor direction for a heading clockwise from magnetic north. */
const floorDir = (h: number, r = 1, y = 0): V3 => [Math.sin(h) * r, y, -Math.cos(h) * r]
const UPV = new THREE.Vector3(0, 1, 0)

/** Robot seen from above, nose toward −z, with a QMC5883L on the deck; `pose(yaw, pitch)` turns it clockwise / nose-up. */
function deckRobot(parent: THREE.Object3D, at: V3) {
  const outer = add(parent, new THREE.Group(), at)
  const body = add(outer, new THREE.Group())
  body.rotation.order = 'YXZ'
  box(body, [6, 1.2, 8], mat('#d8dbe2', { rough: 0.55 }), [0, 1.6, 0])
  const tyre = mat('#1c1c1f', { rough: 0.8 })
  const can = mat('#c9ccd1', { metal: 0.45, rough: 0.35 })
  for (const s of [-1, 1]) {
    cylinder(body, 1.4, 0.9, tyre, [s * 3.5, 1.4, 1.8], 'x', 24)
    cylinder(body, 0.5, 1, mat('#f2c230', { rough: 0.5 }), [s * 3.5, 1.4, 1.8], 'x', 16)
    box(body, [1.3, 1.2, 2.2], mat('#f2c230', { rough: 0.5 }), [s * 2.3, 2.8, 1.8])
    cylinder(body, 0.65, 1.3, can, [s * 1, 2.85, 1.8], 'x', 20)
  }
  add(body, mesh(new THREE.SphereGeometry(0.55, 14, 10), mat('#9aa0ab', { rough: 0.4 })), [0, 0.55, -3])
  const board = i2cBreakout(body, [0, 2.56, -2], { name: 'QMC5883L', color: '#1f5fa8', k: 0.22 })
  board.group.rotation.x = -Math.PI / 2
  board.led(1)
  return {
    group: outer,
    body,
    board,
    pose(yaw: number, pitch: number) {
      body.rotation.y = -yaw
      body.rotation.x = pitch
    },
  }
}

/** Rod with a cone tip; `set(a, b)` restretches it. */
function vecArrow(parent: THREE.Object3D, color: string, r = 0.09, glow = 0.9) {
  const m = glowMat(color, glow)
  const rod = add(parent, shadowlessRod(m))
  const tip = add(parent, mesh(new THREE.ConeGeometry(r * 3.2, r * 9, 14), m))
  tip.castShadow = false
  const d = new THREE.Vector3()
  return {
    material: m,
    set(a: V3, b: V3) {
      d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      const len = d.length()
      const head = Math.min(r * 9, len * 0.5)
      d.normalize()
      stretchRod(rod, a, [b[0] - d.x * head, b[1] - d.y * head, b[2] - d.z * head], r)
      tip.visible = len > 1e-3
      tip.scale.setScalar(head / (r * 9))
      tip.position.set(b[0] - (d.x * head) / 2, b[1] - (d.y * head) / 2, b[2] - (d.z * head) / 2)
      tip.quaternion.setFromUnitVectors(UPV, d)
    },
    show(v: boolean) {
      rod.visible = v
      tip.visible = v
    },
  }
}

const flatLabel = (parent: THREE.Object3D, s: string, at: V3, color = GREY, size = 0.8) => {
  const m = add(parent, label(s, { size, color }), at)
  m.rotation.x = -Math.PI / 2
  m.castShadow = false
  return m
}

// --- Heading: Earth's field on three axes, atan2, tilt error, declination. ---

const MODES = { raw: 'atan2 only', tilt: 'Tilt-compensated' }
type Mode = keyof typeof MODES
const SITE_KEYS = Object.keys(MAG_SITES) as MagSite[]
const HD = { rose: 12, k: 0.2, turn: 1.4, turnView: 0.55, field: 0.22, mid: [9, 9, -2] as V3 }

function headSetup(p: Params) {
  const site = MAG_SITES[pick(MAG_SITES, p.site, 'london')]
  const mode: Mode = pick(MODES, p.mode, 'raw')
  const yaw = n(p, 'heading') * DEG
  const pitch = n(p, 'tilt') * DEG
  const B = earthField(site.fUT, site.dip)
  return { site, mode, yaw, pitch, B, ...headRead(B, yaw, pitch, mode) }
}
function headRead(B: Vec3, yaw: number, pitch: number, mode: Mode) {
  const m = toBody(B, yaw, pitch)
  const raw = magHeading(m)
  const fixed = tiltCompHeading(m, tiltAccel(pitch, 0))
  const shown = mode === 'tilt' ? fixed : raw
  return { m, raw, fixed, shown, err: wrapPi(shown - yaw) }
}

export const heading: Lesson = {
  id: 'magnetometer-heading',
  title: 'Heading',
  tagline: "Three axes measure Earth's field; atan2 of the level part points the robot at north",
  formula: (p) => {
    const S = headSetup(p)
    const lv = toLevel(S.m, S.pitch)
    return `heading = atan2(Y, X) = atan2(${uT(S.m[1])}, ${uT(S.m[0])}) = ${hdg(S.raw)} · level first: Xh = X cos θ − Z sin θ = ${uT(lv[0])} µT, θ from accel → ${hdg(S.fixed)} · true = magnetic + D = ${hdg(S.shown)} ${signed(S.site.decl, 0)}° = ${hdg(trueHeading(S.shown, S.site.decl))}`
  },
  legend: [
    { color: B_FIELD, label: "Earth's field: level H + vertical Z", shape: 'dot' },
    { color: RING, label: 'Sensor axes X (nose), Y (left), Z', shape: 'dot' },
    { color: HIGH_V, label: 'Heading from atan2(Y, X)', shape: 'dot' },
    { color: POWER, label: 'Heading levelled by the accel', shape: 'dot' },
  ],
  points: [
    "Earth's field is ~50 µT and dips into the ground: 66° in London, almost flat at the equator, pointing up in the south. Only its level part H points north.",
    'A QMC5883L (or HMC5883L) reads the field on X, Y and Z over I²C. Held level, X and Y see H split by the heading: heading = atan2(Y, X), clockwise from magnetic north.',
    'Tilt the robot and X or Y picks up some of the big vertical part. At 66° dip a 10° slope swings the heading by 20° or more, so use the IMU: get pitch and roll from the accelerometer and level the reading before atan2.',
    'Compasses find magnetic north. Maps use true north: add the local declination D (+13° in San Francisco, +1° in London) to get a map heading.',
  ],
  controls: [
    { kind: 'slider', key: 'heading', label: 'Nose heading', min: 0, max: 355, step: 5, initial: 60, format: (v) => `${v.toFixed(0)}°` },
    { kind: 'slider', key: 'tilt', label: 'Pitch', min: -30, max: 30, step: 1, initial: 15, format: (v) => `${v.toFixed(0)}°` },
    { kind: 'choice', key: 'site', options: SITE_KEYS.map((k) => ({ value: k, label: MAG_SITES[k].name })), initial: 'london' },
    { kind: 'choice', key: 'mode', options: (Object.keys(MODES) as Mode[]).map((k) => ({ value: k, label: MODES[k] })), initial: 'raw' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const world = add(scene, new THREE.Group())
    world.rotation.y = -HD.turnView
    cylinder(world, HD.rose + 1, 0.3, mat('#23262d', { rough: 0.85 }), [0, -0.15, 0], 'y', 64)
    const tickMat = mat('#55585f')
    for (let k = 0; k < 12; k++) {
      const a = k * 30 * DEG
      const t = box(world, [0.12, 0.06, k % 3 ? 0.8 : 1.4], tickMat, floorDir(a, HD.rose - (k % 3 ? 0.4 : 0.7), 0.03))
      t.rotation.y = -a
    }
    ;['N', 'E', 'S', 'W'].forEach((c, k) => flatLabel(world, c, floorDir((k * Math.PI) / 2, HD.rose + 1.9, 0.05), k ? GREY : NORTH, 1.3))
    const trueN = add(world, shadowlessRod(glowMat(GREY, 0.5)))
    const trueTag = liveLabel(world, [0, 0.1, 0], { size: 0.6 })
    trueTag.group.rotation.x = -Math.PI / 2
    stretchRod(add(world, shadowlessRod(glowMat(NORTH, 0.8))), [0, 0.08, 0], floorDir(0, HD.rose, 0.08), 0.06)

    const robot = deckRobot(world, [0, 0, 0])
    const sensor: V3 = [0, 4.5, -2]
    const nose = vecArrow(robot.body, GREY, 0.06, 0.4)
    nose.set([0, 3.3, -4.2], [0, 3.3, -6.4])
    const axX = vecArrow(robot.body, RING, 0.07)
    const axY = vecArrow(robot.body, RING, 0.07)
    const hVec = vecArrow(robot.body, HIGH_V, 0.1, 1.1)
    const lx = liveLabel(robot.body, [0, 0, 0], { size: 0.6 })
    const ly = liveLabel(robot.body, [0, 0, 0], { size: 0.6 })
    for (const l of [lx, ly]) l.group.rotation.x = -Math.PI / 2
    const deckCompass = compass(robot.body, [0, 3.65, 3.6], 0.95)
    deckCompass.group.rotation.x = -Math.PI / 2

    const needles = ([GREY, HIGH_V, POWER] as const).map((c, i) => vecArrow(world, c, i ? 0.13 : 0.1, i ? 1 : 0.5))

    const field = vecArrow(world, B_FIELD, 0.16, 1)
    const hPart = add(world, shadowlessRod(glowMat(B_FIELD, 0.35)))
    const zPart = add(world, shadowlessRod(glowMat(B_FIELD, 0.35)))
    const hTag = liveLabel(world, [0, 0, 0], { size: 0.55 })
    const zTag = liveLabel(world, [0, 0, 0], { size: 0.55, align: 'left' })
    const dipTag = liveLabel(world, [0, 0, 0], { size: 0.55, align: 'right' })
    const beads = Array.from({ length: 4 }, () => add(world, mesh(new THREE.SphereGeometry(0.3, 12, 8), glowMat(B_FIELD, 1.2))))

    const T0 = [-17.5, 14, 0] as V3
    const [truthText, rawText, fixText, mapText] = [0, 1, 2, 3].map((i) => liveLabel(scene, [T0[0], T0[1] - i * 1.3, 0], { size: 0.55, align: 'left' }))
    const status = liveLabel(scene, [T0[0], T0[1] - 5.4, 0], { size: 0.4, align: 'left' })
    const s = { yaw: 0, pitch: 0, t: 0, init: false }
    return {
      scene,
      view: { center: [0, 5, 0], radius: 70, polar: 1.1, azimuth: 0 },
      frame(dt, p) {
        const S = headSetup(p)
        if (!s.init) Object.assign(s, { yaw: S.yaw, pitch: S.pitch, init: true })
        s.t += dt
        const dy = wrapPi(S.yaw - s.yaw)
        s.yaw = wrap2pi(s.yaw + Math.sign(dy) * Math.min(Math.abs(dy), HD.turn * dt))
        s.pitch += Math.sign(S.pitch - s.pitch) * Math.min(Math.abs(S.pitch - s.pitch), 0.6 * dt)
        const R = headRead(S.B, s.yaw, s.pitch, S.mode)
        robot.pose(s.yaw, s.pitch)

        const { m } = R
        axX.set(sensor, add3(sensor, bodyLocal([m[0], 0, 0], HD.k)))
        axY.set(sensor, add3(sensor, bodyLocal([0, m[1], 0], HD.k)))
        hVec.set(sensor, add3(sensor, bodyLocal([m[0], m[1], 0], HD.k)))
        lx.group.position.set(...add3(sensor, bodyLocal([m[0] + 3 * Math.sign(m[0] || 1), 0, 0.5], HD.k)))
        ly.group.position.set(...add3(sensor, bodyLocal([0, m[1] + 3 * Math.sign(m[1] || 1), 0.5], HD.k)))
        lx.set('X', RING)
        ly.set('Y', RING)
        deckCompass.swing(Math.atan2(m[0], -m[1]), dt)

        needles[0].set([0, 0.2, 0], floorDir(s.yaw, HD.rose - 0.6, 0.2))
        needles[1].set([0, 0.25, 0], floorDir(R.raw, HD.rose - 1.4, 0.25))
        needles[2].show(S.mode === 'tilt')
        if (S.mode === 'tilt') needles[2].set([0, 0.3, 0], floorDir(R.fixed, HD.rose - 2.2, 0.3))
        const tn = floorDir(-S.site.decl * DEG, HD.rose, 0.07)
        stretchRod(trueN, [0, 0.07, 0], tn, 0.05)
        trueTag.group.position.set(...floorDir(-S.site.decl * DEG - 0.16, HD.rose + 1, 0.08))
        trueTag.set('true N', GREY)

        const L = norm(S.B) * HD.field
        const d = T(S.B, 1 / norm(S.B))
        const a: V3 = [HD.mid[0] - (d[0] * L) / 2, HD.mid[1] - (d[1] * L) / 2, HD.mid[2] - (d[2] * L) / 2]
        const b: V3 = [HD.mid[0] + (d[0] * L) / 2, HD.mid[1] + (d[1] * L) / 2, HD.mid[2] + (d[2] * L) / 2]
        const c: V3 = [b[0], a[1], b[2]]
        field.set(a, b)
        stretchRod(hPart, a, c, 0.06)
        stretchRod(zPart, c, b, 0.06)
        hTag.group.position.set((a[0] + c[0]) / 2 - 1, a[1] + 1, (a[2] + c[2]) / 2)
        hTag.set(`H ${S.B[0].toFixed(0)} µT`, B_FIELD)
        zTag.group.position.set(c[0] + 0.8, (c[1] + b[1]) / 2, c[2])
        zTag.set(`Z ${Math.abs(S.B[2]).toFixed(0)} µT ${S.B[2] < 0 ? 'down' : 'up'}`, B_FIELD)
        dipTag.group.position.set(a[0] - 0.8, a[1], a[2])
        dipTag.set(`dip ${S.site.dip}°`, B_FIELD)
        beads.forEach((bd, i) => {
          const u = frac(s.t * 0.35 + i / beads.length)
          bd.position.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u)
        })

        const ok = (e: number) => Math.abs(e) < 2 * DEG
        const rawErr = wrapPi(R.raw - s.yaw)
        truthText.set(`nose ${hdg(s.yaw)} · pitch ${signed(toDeg(s.pitch), 0)}°`, GREY)
        rawText.set(`atan2(Y, X) → ${hdg(R.raw)}${ok(rawErr) ? '' : `  (off ${signed(toDeg(rawErr), 0)}°)`}`, ok(rawErr) ? POWER : HIGH_V)
        fixText.set(S.mode === 'tilt' ? `levelled by accel → ${hdg(R.fixed)}` : 'no tilt compensation', S.mode === 'tilt' ? POWER : GREY)
        mapText.set(`${signed(S.site.decl, 0)}° declination → map ${hdg(trueHeading(R.shown, S.site.decl))}`, LABEL)
        const turning = Math.abs(dy) > 0.01 ? ` · turning ${toDeg(HD.turn).toFixed(0)}°/s` : ''
        status.set(`${S.site.name} · |B| ${S.site.fUT} µT${turning} · real time`, GREY)
      },
      readouts: (p) => {
        const S = headSetup(p)
        const bad = Math.abs(S.err) > 2 * DEG
        return [
          { label: 'Mag X · Y · Z', value: `${S.m.map((v) => uT(v, 0)).join(' · ')} µT` },
          { label: 'Raw counts (120/µT)', value: qmcCounts(S.m).join(' · ') },
          { label: S.mode === 'tilt' ? 'Tilt-compensated heading' : 'Heading atan2(Y, X)', value: `${hdg(S.shown)}${bad ? ` (${signed(toDeg(S.err), 0)}°)` : ''}`, tone: bad ? 'bad' : 'ok' },
          { label: 'True (map) heading', value: hdg(trueHeading(S.shown, S.site.decl)) },
        ]
      },
    }
  },
}


// --- Hard-iron calibration: magnets riding on the robot shift every reading; spin, fit the centre, subtract. ---

const MOTIONS: Record<CalMotion, string> = { flat: 'Spin flat', tumble: 'Tumble (figure-8)' }
const CAL = {
  site: MAG_SITES.london,
  moment: magnetMoment(MAGNET_BR.ferrite, 1e-6),
  dir: [-0.62, 0.32, -0.72] as Vec3,
  noise: 0.4,
  rate: 12,
  n: { flat: 90, tumble: 240 },
  fitS: 2,
  holdS: 3,
  plot: [10, 4, 0] as V3,
  span: 7,
  robot: [-10, 0, 0] as V3,
  perCm: 0.3,
}
const calRun = memoBy(
  (p: Params) => `${p.dist}|${p.motion}|${p.soft}`,
  (p: Params) => {
    const dist = n(p, 'dist')
    const motion = pick(MOTIONS, p.motion, 'flat')
    const soft = n(p, 'soft') / 100
    const B = earthField(CAL.site.fUT, CAL.site.dip)
    const k = dipoleAxisB(CAL.moment, dist / 100) / norm(CAL.dir)
    const hard = CAL.dir.map((c) => c * k) as Vec3
    const N = CAL.n[motion]
    const pts = Array.from({ length: N }, (_, i) => {
      const a = calAttitude(motion, i / (N - 1))
      return ironReading(B, a.yaw, a.pitch, hard, soft, i, CAL.noise)
    })
    const fit = motion === 'flat' ? circleFit(pts) : sphereFit(pts)
    const centre = fit.centre
    if (motion === 'flat') centre[2] = 0
    const fixed = pts.map((q) => q.map((c, i) => c - centre[i]) as Vec3)
    const clipped = pts.some((q) => q.some((c) => Math.abs(c) >= QMC5883L.rangeUT - 1e-9))
    const axes = motion === 'flat' ? [0, 1] : [0, 1, 2]
    const reach = Math.max(...[...pts, ...fixed].flatMap((q) => axes.map((i) => Math.abs(q[i]))), 20)
    return {
      dist,
      motion,
      soft,
      B,
      hard,
      pts,
      fit,
      centre,
      fixed,
      clipped,
      scale: CAL.span / reach,
      reach,
      before: worstHeadingError(B, hard, soft),
      after: worstHeadingError(B, hard, soft, centre),
      sampleS: N / CAL.rate,
    }
  },
)
const vecText = (v: Vec3, d = 0) => `(${v.map((c) => uT(c, d)).join(', ')})`

export const hardIronCalibration: Lesson = {
  id: 'magnetometer-hard-iron-calibration',
  title: 'Hard-iron calibration',
  tagline: 'Magnets on the robot add a fixed offset; spin it, fit the circle, subtract the centre',
  formula: (p) => {
    const R = calRun(p)
    const fitText = R.motion === 'flat' ? 'circle x² + y² = 2ax + 2by + c' : 'sphere |p|² = 2c·p + d'
    return `motor B = μ₀m / 2πr³ = 4π × 10⁻⁷ × ${CAL.moment.toFixed(2)} A·m² / (2π × ${(R.dist / 100).toFixed(2)}³ m³) = ${norm(R.hard).toFixed(0)} µT · least-squares ${fitText} → centre ${vecText(R.centre, 1)} µT · heading = atan2(Y − cy, X − cx)`
  },
  legend: [
    { color: HIGH_V, label: 'Raw samples: shifted circle / sphere', shape: 'dot' },
    { color: RING, label: 'Fitted centre = hard-iron offset', shape: 'dot' },
    { color: POWER, label: 'Samples with the offset removed', shape: 'dot' },
    { color: HEAT, label: 'Motor magnets', shape: 'dot' },
  ],
  points: [
    "The motors' ferrite magnets and steel screws ride along with the sensor. Their field turns with the robot, so it adds the same offset to every reading: hard iron.",
    'A 1 cm³ ferrite magnet 10 cm away adds ~64 µT, more than Earth. Closer than ~6 cm it pushes the QMC5883L past its ±200 µT range and the samples clip flat.',
    'Spin the robot on the spot and X, Y trace a circle around the offset instead of around zero. Fit a circle (or, tumbling it in a figure-8, a sphere) and subtract its centre.',
    'Soft iron (steel that bends the field) squashes the circle into an ellipse; subtracting the centre is not enough, you also rescale the axes. A flat spin cannot see the Z offset, so tilt-compensated compasses need the full sphere.',
  ],
  controls: [
    { kind: 'slider', key: 'dist', label: 'Motor to sensor', min: 6, max: 30, step: 1, initial: 10, format: (v) => `${v.toFixed(0)} cm` },
    { kind: 'choice', key: 'motion', options: (Object.keys(MOTIONS) as CalMotion[]).map((k) => ({ value: k, label: MOTIONS[k] })), initial: 'flat' },
    { kind: 'slider', key: 'soft', label: 'Soft iron', min: 0, max: 30, step: 5, initial: 0, format: (v) => `${v.toFixed(0)} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    cylinder(scene, 7.5, 0.3, mat('#23262d', { rough: 0.85 }), [CAL.robot[0], -0.15, CAL.robot[2]], 'y', 48)
    flatLabel(scene, 'N', [CAL.robot[0], 0.05, -8.8], NORTH, 1.1)
    const robot = deckRobot(scene, CAL.robot)
    const boom = add(robot.body, shadowlessRod(mat('#9aa0ab', { rough: 0.5 })))
    const motorGlow = [-1, 1].map((s) => add(robot.body, mesh(new THREE.SphereGeometry(1.5, 16, 12), glowMat(HEAT, 0.6)), [s * 1, 2.85, 1.8]))
    for (const g of motorGlow) {
      const m = g.material as THREE.MeshStandardMaterial
      m.transparent = true
      m.opacity = 0.25
      g.castShadow = false
    }
    const offsetArrow = vecArrow(robot.body, HEAT, 0.08)

    const P = CAL.plot
    const axMat = glowMat(GREY, 0.3)
    const ax = [0, 1, 2].map(() => add(scene, shadowlessRod(axMat)))
    const axTags = ['X', 'Y', 'Z'].map((c) => add(scene, label(c, { size: 0.6, color: GREY })))
    const raw = pointCloud(scene, 260, 0.2)
    const fixed = pointCloud(scene, 260, 0.2)
    const centre = add(scene, mesh(new THREE.SphereGeometry(0.42, 16, 12), glowMat(RING, 1.2)))
    const offsetVec = vecArrow(scene, RING, 0.07)
    const ringMat = glowMat(POWER, 0.35)
    const rings = [0, 1, 2].map(() => add(scene, mesh(new THREE.TorusGeometry(1, 0.025, 6, 64), ringMat)))
    const scaleTag = liveLabel(scene, [P[0], P[1] - CAL.span - 2, 0], { size: 0.45 })

    const T0: V3 = [-18.5, 14.5, 0]
    const [motorText, phaseText, fitText] = [0, 1, 2].map((i) => liveLabel(scene, [T0[0], T0[1] - i * 1.3, 0], { size: 0.55, align: 'left' }))
    const status = liveLabel(scene, [T0[0], T0[1] - 4.1, 0], { size: 0.4, align: 'left' })
    const s = { key: '', t: 0 }
    let zOn = 1
    const toPlot = (q: Vec3, k: number): V3 => [P[0] + q[0] * k, P[1] + q[1] * k, P[2] + q[2] * k * zOn]
    return {
      scene,
      view: { center: [0, 5.5, 0], radius: 70, polar: 1.15, azimuth: 0 },
      frame(dt, p) {
        const R = calRun(p)
        zOn = R.motion === 'tumble' ? 1 : 0
        const key = `${p.dist}|${p.motion}|${p.soft}`
        if (key !== s.key) Object.assign(s, { key, t: 0 })
        s.t += dt
        const cycle = R.sampleS + CAL.fitS + CAL.holdS
        const t = s.t % cycle
        const u = Math.min(1, t / R.sampleS)
        const att = calAttitude(R.motion, u)
        robot.group.position.y = R.motion === 'tumble' ? 2.5 : 0
        robot.pose(att.yaw, att.pitch)

        const sz = 1.8 - R.dist * CAL.perCm
        robot.board.group.position.z = sz
        stretchRod(boom, [0, 2.3, -3.9], [0, 2.3, sz], 0.12)
        boom.visible = sz < -3.9
        const hard = R.hard
        const hk = 0.05
        offsetArrow.set([0, 3.6, sz], add3([0, 3.6, sz], bodyLocal(hard.map((c) => Math.max(-200, Math.min(200, c))) as Vec3, hk)))
        motorGlow.forEach((g) => ((g.material as THREE.MeshStandardMaterial).opacity = Math.min(0.5, 0.1 + norm(hard) / 400)))

        const k = R.scale
        const L = CAL.span
        const ends: [V3, V3][] = [
          [toPlot([-L / k, 0, 0], k), toPlot([L / k, 0, 0], k)],
          [toPlot([0, -L / k, 0], k), toPlot([0, L / k, 0], k)],
          [toPlot([0, 0, -L / k], k), toPlot([0, 0, L / k], k)],
        ]
        ends.forEach(([a, b], i) => {
          stretchRod(ax[i], a, b, 0.05)
          ax[i].visible = axTags[i].visible = i < 2 || zOn > 0
          axTags[i].position.set(b[0] + (i === 0 ? 0.8 : 0), b[1] + (i === 1 ? 0.8 : 0), b[2] + (i === 2 ? 0.8 : 0))
        })
        const shown = Math.min(R.pts.length, Math.floor(u * R.pts.length) + 1)
        const fitU = Math.min(1, Math.max(0, (t - R.sampleS) / CAL.fitS))
        const fitting = t >= R.sampleS
        R.pts.forEach((q, i) => raw.set(i, toPlot(q, k), HIGH_V, fitting ? 0.6 : 1))
        raw.show(shown)
        R.fixed.forEach((q, i) => {
          const a = R.pts[i]
          const e = fitU * fitU * (3 - 2 * fitU)
          fixed.set(i, toPlot([a[0] + (q[0] - a[0]) * e, a[1] + (q[1] - a[1]) * e, a[2] + (q[2] - a[2]) * e], k), POWER)
        })
        fixed.show(fitting ? R.pts.length : 0)
        centre.visible = fitting
        centre.position.set(...toPlot(R.centre, k))
        offsetVec.show(fitting)
        if (fitting) offsetVec.set(P, toPlot(R.centre, k))
        rings.forEach((rg, i) => {
          rg.visible = fitting && (R.motion === 'tumble' || i === 0)
          rg.scale.setScalar(R.fit.r * k)
          rg.position.set(...P)
          rg.rotation.set(i === 1 ? Math.PI / 2 : 0, i === 2 ? Math.PI / 2 : 0, 0)
        })
        scaleTag.set(`axes ±${(L / k).toFixed(0)} µT`, GREY)

        const big = norm(hard) > CAL.site.fUT
        motorText.set(`motor ${R.dist} cm away: +${norm(hard).toFixed(0)} µT vs Earth ${CAL.site.fUT} µT${R.clipped ? ' · CLIPS' : ''}`, R.clipped ? HIGH_V : big ? HEAT : LABEL)
        const turns = R.motion === 'flat' ? '1 turn' : '5 turns while pitching ±75°'
        phaseText.set(
          fitting ? (R.clipped ? 'fit fails: clipped samples are flat, not round' : fitU < 1 ? 'fitting: subtract the centre from every sample' : R.soft > 0 ? 'centred, still an ellipse: soft iron, rescale axes' : 'calibrated: samples ring around zero') : `sampling ${shown}/${R.pts.length} · ${turns}`,
          fitting && !R.clipped ? POWER : HIGH_V,
        )
        fitText.set(fitting ? `centre ${vecText(R.centre, 0)} µT, true ${vecText(R.hard, 0)}` : R.motion === 'flat' ? 'X–Y samples trace a circle' : 'X–Y–Z samples cover a sphere', fitting ? RING : GREY)
        status.set(`${CAL.rate} Hz, noise ${CAL.noise} µT · ${R.motion === 'flat' ? 'flat spin: no Z offset · ' : ''}real time · t = ${t.toFixed(1)} s`, GREY)
      },
      readouts: (p) => {
        const R = calRun(p)
        const miss = norm(R.centre.map((c, i) => (R.motion === 'flat' && i === 2 ? 0 : c - R.hard[i])) as Vec3)
        return [
          { label: 'Hard-iron offset', value: `${norm(R.hard).toFixed(0)} µT`, tone: R.clipped ? 'bad' : norm(R.hard) > CAL.site.fUT ? 'warn' : 'ok' },
          { label: 'Fit misses by', value: `${miss.toFixed(1)} µT`, tone: miss < 1 ? 'ok' : 'warn' },
          { label: 'Heading error, raw', value: `±${toDeg(R.before).toFixed(0)}°`, tone: R.before > 5 * DEG ? 'bad' : 'ok' },
          { label: 'After calibration', value: `±${toDeg(R.after).toFixed(1)}°`, tone: R.after > 2 * DEG ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
