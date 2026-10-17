import * as THREE from 'three/webgpu'
import { DEG, crossView, dotView, polar3, projectionView, sub3, toDeg } from '../../core/physics'
import { Vec3 } from '../../core/fields'
import { degText, fixedText, lengthText, signed } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  angleArc,
  diffBot,
  dotLine,
  faceFront,
  floorMat,
  floorView,
  glowMat,
  liveLabel,
  memoBy,
  parallelogram,
  sectorGeometry,
  statusHeader,
  titledScope,
  vecArrow,
  zUp,
} from '../fx'
import { Lesson, Params, Stage, angleSlider, n, namesOf, opts, pick, toneOf } from '../types'

const f2 = (v: number) => fixedText(v)
const dg = (rad: number) => degText(toDeg(rad), 0)
const fp = (v: number) => (v < -0.005 ? `(${f2(v)})` : f2(v))
const xyz = (v: readonly number[]) => `(${v.map(f2).join(', ')})`
const PLOT = { x: 8.2, w: 11, y: 1.6, h: 6 }
const textRows = (scene: THREE.Object3D, k: number, x = 2.7, y = -3.3) => Array.from({ length: k }, (_, i) => liveLabel(scene, [x, y - i * 0.8, 0.2], { size: 0.34, align: 'left' }))

// --- Dot product: heading · to-target. Its sign says ahead or behind, its size is the target's shadow on the heading, cos θ checks the field of view. ---

const DP = { at: [-8.2, -2.6, 0] as V3, k: 7.5, bot: 2.8, reach: 1.2, z: 0.02 }
const dpRun = memoBy(
  (p: Params) => `${p.bearing} ${p.dist} ${p.fov}`,
  (p: Params) => {
    const q = { bearing: n(p, 'bearing'), dist: n(p, 'dist'), fov: n(p, 'fov') }
    const h = polar3(1, 90)
    const b = polar3(q.dist, 90 + q.bearing)
    return { ...q, h, b, D: dotView(h, b, (q.fov / 2) * DEG) }
  },
)
const sideWord = (deg: number) => (Math.abs(deg) < 1e-9 || Math.abs(deg) === 180 ? '' : deg > 0 ? ' left' : ' right')

export const vectorsDotProduct: Lesson = {
  id: 'vectors-dot-product',
  title: 'Dot product',
  tagline: 'Is the target in front of me? One multiply-add answers it',
  formula: (p) => {
    const { h, b, D, fov } = dpRun(p)
    return `h·b = hx·bx + hy·by = ${f2(h[0])}·${fp(b[0])} + ${f2(h[1])}·${fp(b[1])} = ${f2(D.dot)} m = |h||b| cos θ = 1 · ${f2(D.lb)} · cos ${dg(D.theta)} · ${D.ahead ? 'ahead (> 0)' : 'behind (≤ 0)'} · cos θ ${f2(D.cos)} ${D.inView ? '≥' : '<'} cos ${fov / 2}° = ${f2(Math.cos((fov / 2) * DEG))} → ${D.inView ? 'in view' : 'out of view'}`
  },
  legend: [
    { color: B_FIELD, label: 'Heading h (length 1)', shape: 'dot' },
    { color: RING, label: 'To target b', shape: 'dot' },
    { color: HEAT, label: 'Shadow of b on h = h·b', shape: 'dot' },
    { color: POWER, label: 'Camera field of view', shape: 'dot' },
  ],
  points: [
    'A vector is an arrow: a direction and a size. In numbers it is a list of components, here (x, y) on the floor in metres. The robot\'s heading h is a unit vector (length 1); the target is at b = target − robot.',
    'The dot product multiplies matching components and adds them: h·b = hx·bx + hy·by. Geometrically it is |h||b| cos θ, θ the angle between the arrows. With h of length 1 it is just how far b reaches along h: the shadow b casts on the heading line (orange).',
    'The sign is the useful part. Positive: the target is ahead. Zero: exactly abeam, at right angles. Negative: behind. No atan2, no angles, no square roots: two multiplies and an add, cheap enough to run for every lidar point every scan.',
    'Field of view: divide by |b| to get cos θ, and compare with cos of the half-angle computed once. cos θ ≥ cos(fov/2) means inside the cone; a 60° camera keeps targets with cos θ ≥ 0.87. Sweep the bearing: the plot is cos θ, and it crosses the threshold at ±fov/2.',
    'The dot product says how far ahead, not which side: +30° and −30° give the same value. Left or right needs the Cross product. The same h·b shows up as the along-track distance in Projection, as the "is it in front of the camera" test in Perception › Camera model › Pinhole model (z > 0), and in Kinematics › Coordinate frames › 2D rotation (each matrix entry is a dot product of two axes).',
  ],
  controls: [
    angleSlider('bearing', 'Target bearing (+ left)', -180, 180, 30),
    { kind: 'slider', key: 'dist', label: 'Target distance |b|', min: 0.2, max: 1.1, step: 0.05, initial: 0.8, format: (v) => `${v.toFixed(2)} m` },
    angleSlider('fov', 'Camera field of view', 20, 180, 60),
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = floorView(scene, DP.at, DP.k, -0.62)
    floorMat(g, [-1.25, 1.25], [-1, 1.1])
    const bot = diffBot(add(g, new THREE.Group()))
    bot.group.scale.setScalar(DP.bot)
    bot.set({ x: 0, y: -0.24, th: Math.PI / 2 })
    const fovMat = new THREE.MeshStandardMaterial({ color: POWER, emissive: POWER, emissiveIntensity: 0.35, transparent: true, opacity: 0.22, depthWrite: false })
    const cone = add(g, mesh(sectorGeometry(0.12, DP.reach, Math.PI / 2, 1, 0.004), fovMat))
    cone.castShadow = false
    let coneFov = NaN
    const abeam = dotLine(g, 0.008, 40)
    const aheadTag = liveLabel(g, [1.2, 0.06, DP.z], { size: 0.07, align: 'right' })
    const behindTag = liveLabel(g, [1.2, -0.1, DP.z], { size: 0.07, align: 'right' })
    aheadTag.set('ahead: h·b > 0', POWER)
    behindTag.set('behind: h·b < 0', HIGH_V)
    const hArrow = vecArrow(g, B_FIELD, 0.014, 0.09)
    const bArrow = vecArrow(g, RING, 0.014, 0.09)
    const shadow = vecArrow(g, HEAT, 0.02, 0.085)
    const drop = dotLine(g, 0.01, 30)
    const arc = angleArc(g, 0.009, 0.09)
    const target = add(g, mesh(new THREE.SphereGeometry(0.05, 18, 12), glowMat(RING, 1.1)))

    const plot = titledScope(scene, PLOT.y, PLOT.h, 'cos θ = h·b / |b| vs bearing', POWER, 0.5, PLOT.x, PLOT.w)
    const curve = plot.s.trace(POWER, { samples: 181, radius: 0.06 })
    const thr = plot.s.level(RING)
    const yOf = (c: number) => (c * PLOT.h) / 2
    const thrTag = liveLabel(scene, [PLOT.x + PLOT.w / 2 + 0.3, 0, 0.2], { size: 0.26, align: 'left' })
    const rows = textRows(scene, 4)
    return {
      scene,
      view: { center: [-1.2, -1, 0], radius: 56, polar: 1.45, azimuth: 0 },
      frame(_dt, p) {
        const { h, b, D, fov, bearing } = dpRun(p)
        if (fov !== coneFov) {
          coneFov = fov
          cone.geometry.dispose()
          cone.geometry = sectorGeometry(0.12, DP.reach, Math.PI / 2, fov * DEG, 0.004)
        }
        const z = DP.z
        abeam([-1.22, 0, z], [1.22, 0, z], GREY)
        const tip: V3 = [b[0], b[1], z]
        target.position.set(b[0], b[1], 0.05)
        const off = b[0] > 1e-9 ? -0.1 : 0.1
        hArrow([0, 0.02, z + 0.01], [h[0] * 0.45, 0.02 + h[1] * 0.45, z + 0.01], 'h', [-off, -0.1, 0])
        bArrow([0, 0, z], tip, 'b', [0.04, 0.04, 0])
        shadow([off, 0, z + 0.02], [off, D.along, z + 0.02], `h·b = ${f2(D.dot)} m`, [off * 6, D.along >= 0 ? -0.1 : 0.1, 0])
        drop(tip, [off, D.along, z], GREY)
        arc([0, 0, z], [h[0], h[1], 0], [b[0], b[1], 0], 0.22, LABEL, 'θ')
        fovMat.color.set(D.inView ? POWER : GREY)
        fovMat.emissive.set(D.inView ? POWER : GREY)

        curve.draw((u) => yOf(Math.cos((u * 360 - 180) * DEG)), (bearing + 180) / 360)
        const c0 = Math.cos((fov / 2) * DEG)
        thr.set(yOf(c0))
        thrTag.group.position.y = PLOT.y + yOf(c0)
        thrTag.set(`cos ${fov / 2}°`, RING)
        plot.lo.set('−180°')
        plot.hi.set('+180°')
        plot.right.set(`now ${signed(bearing, 0)}°: ${f2(D.cos)}`, D.inView ? POWER : LABEL)
        rows[0].set(`h·b = ${f2(h[0])}·${fp(b[0])} + ${f2(h[1])}·${fp(b[1])} = ${f2(D.dot)} m`, HEAT)
        rows[1].set(`|h||b| cos θ = 1 · ${f2(D.lb)} · cos ${dg(D.theta)} = ${f2(D.dot)} m`, LABEL)
        rows[2].set(D.ahead ? 'positive → target ahead' : Math.abs(D.dot) < 1e-9 ? 'zero → exactly abeam' : 'negative → target behind', D.ahead ? POWER : HIGH_V)
        rows[3].set(`cos θ ${f2(D.cos)} ${D.inView ? '≥' : '<'} cos ${fov / 2}° ${f2(c0)} → ${D.inView ? 'in view' : 'out of view'}`, D.inView ? POWER : GREY)
        head.status.set(`Dot product · target ${lengthText(D.lb)} away at ${Math.abs(bearing)}°${sideWord(bearing)}`)
        head.sub.set('top view · robot faces up the floor · tape every 0.5 m · robot drawn 2.8× size', GREY)
        head.event.set(D.inView ? 'in the camera cone: turn the tracker on' : D.ahead ? 'ahead, but outside the field of view' : 'behind the robot: the shadow points backwards', D.inView ? POWER : D.ahead ? RING : HIGH_V)
      },
      readouts: (p) => {
        const { D, fov } = dpRun(p)
        return [
          { label: 'h·b (shadow on heading)', value: `${f2(D.dot)} m` },
          { label: 'Angle θ = acos(h·b / |b|)', value: dg(D.theta) },
          { label: 'Ahead or behind', value: D.ahead ? 'ahead' : 'behind or abeam', tone: D.ahead ? 'ok' : 'bad' },
          { label: `In a ${fov}° field of view`, value: D.inView ? 'yes' : 'no', tone: toneOf(D.inView, D.ahead) },
        ]
      },
    }
  },
}

// --- Cross product: a × b is at right angles to both, as long as their parallelogram's area; its z sign says left or right. ---

const CROSS_USES = {
  turn: { name: 'Turn left or right', a: 'heading h', b: 'goal g', c: 'h × g', la: 1, lb: 0.8, au: '', bu: ' m', cu: 'm' },
  torque: { name: 'Torque τ = r × F', a: 'lever r', b: 'force F', c: 'τ = r × F', la: 0.15, lb: 20, au: ' m', bu: ' N', cu: 'N·m' },
  normal: { name: 'Surface normal', a: 'edge e1', b: 'edge e2', c: 'n', la: 0.3, lb: 0.2, au: ' m', bu: ' m', cu: 'm²' },
} as const
type CrossUse = keyof typeof CROSS_USES
const CP = { at: [-9.6, -2.3, 0] as V3, k: 6.4, da: 1, db: 0.8, up: 0.5 }
const cpRun = memoBy(
  (p: Params) => `${p.theta} ${p.lift} ${p.use}`,
  (p: Params) => {
    const use = pick(CROSS_USES, p.use, 'turn') as CrossUse
    const U = CROSS_USES[use]
    const [theta, lift] = [n(p, 'theta'), n(p, 'lift')]
    const a = polar3(U.la, 0)
    const b = polar3(U.lb, theta, lift)
    return { use, U, theta, lift, a, b, C: crossView(a, b), da: polar3(CP.da, 0), db: polar3(CP.db, theta, lift) }
  },
)
const turnText = (t: 'left' | 'right' | 'straight') => (t === 'left' ? 'z > 0: b is left of a, turn left' : t === 'right' ? 'z < 0: b is right of a, turn right' : 'z = 0: parallel, no turn')

export const vectorsCrossProduct: Lesson = {
  id: 'vectors-cross-product',
  title: 'Cross product',
  tagline: 'An arrow at right angles to both: turn side, torque, surface normal',
  formula: (p) => {
    const { a, b, C, U } = cpRun(p)
    return `a × b = (ay bz − az by, az bx − ax bz, ax by − ay bx) = ${xyz(C.c)} ${U.cu} · |a × b| = |a||b| sin θ = ${f2(U.la * U.lb)} · sin ${dg(C.theta)} = ${f2(C.area)} ${U.cu} · 2D: ax by − ay bx = ${f2(a[0] * b[1] - a[1] * b[0])} → ${C.turn}`
  },
  legend: [
    { color: B_FIELD, label: 'a', shape: 'dot' },
    { color: RING, label: 'b', shape: 'dot' },
    { color: POWER, label: 'a × b (right hand: a curls to b, thumb)', shape: 'dot' },
    { color: HEAT, label: 'Parallelogram: area = |a × b|', shape: 'dot' },
  ],
  points: [
    'The cross product of two 3D vectors is a third vector at right angles to both. Its direction follows the right-hand rule: curl the fingers of your right hand from a to b and the thumb points along a × b. Swap the order and it flips: b × a = −(a × b).',
    'Its length is |a||b| sin θ, the area of the parallelogram the two arrows span (orange). Parallel arrows span no area and give zero; at right angles the area is largest. Compare the Dot product, which grows with cos θ: the plot shows both.',
    'On the floor (z = 0) only the z part survives: ax·by − ay·bx. Its sign says which side: positive, b is counter-clockwise (left) of a; negative, right. A robot with heading h and goal direction g turns left when h × g > 0. The same sign test tells which side of a path a line follower is on (Projection) and whether three waypoints bend left or right.',
    'Torque is a cross product: τ = r × F, r from the pivot to where the force acts. Only the part of F at right angles to r counts, and τ points along the axis it would spin (Mechanics › Torque & levers › Moment arm; Kinematics › Jacobian uses z × r for every joint).',
    'Two edges of a flat face give its normal: n = e1 × e2, scaled to length 1. A depth camera gets surface normals this way from neighbouring points (Perception › Depth sensing › Point cloud); a normal pointing up means floor, sideways means wall. Lift b out of the floor and watch a × b tilt to stay square to both.',
  ],
  controls: [
    angleSlider('theta', 'Floor angle from a to b (+ left)', -180, 180, 60),
    angleSlider('lift', 'Lift b out of the floor', -60, 60, 0),
    { kind: 'choice', key: 'use', options: opts(namesOf(CROSS_USES)), initial: 'turn' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = zUp(scene, CP.at, CP.k, 0.4, -0.3)
    const floor = add(g, new THREE.Group(), [0, 0, -CP.up])
    floorMat(floor, [-0.9, 1.3], [-1, 1])
    const post = dotLine(g, 0.01, 20)
    const botHolder = add(floor, new THREE.Group())
    const bot = diffBot(botHolder)
    botHolder.scale.setScalar(3)
    bot.set({ x: 0, y: 0, th: 0 })
    const pivot = add(g, new THREE.Group())
    cylinder(pivot, 0.05, CP.up, mat('#9aa0a8', { metal: 0.4, rough: 0.4 }), [0, 0, -CP.up / 2], 'z', 20)
    box(pivot, [CP.da, 0.07, 0.03], mat('#6b6f78', { rough: 0.6 }), [CP.da / 2, 0, 0.0])
    const plate = parallelogram(g, HEAT, 0.3)
    const aArrow = vecArrow(g, B_FIELD, 0.02, 0.1)
    const bArrow = vecArrow(g, RING, 0.02, 0.1)
    const cArrow = vecArrow(g, POWER, 0.026, 0.1)
    const curl = angleArc(g, 0.012, 0.09)
    const lift = dotLine(g, 0.01, 20)

    const plot = titledScope(scene, PLOT.y, PLOT.h, 'z of a × b (sin) and a·b (cos) vs θ', POWER, 0.5, PLOT.x, PLOT.w)
    const sinTr = plot.s.trace(POWER, { samples: 181, radius: 0.06 })
    const cosTr = plot.s.trace(GREY, { samples: 181, radius: 0.04 })
    const rows = textRows(scene, 4)
    return {
      scene,
      view: { center: [-1.2, -1, 0], radius: 56, polar: 1.45, azimuth: 0 },
      frame(_dt, p) {
        const { use, U, a, b, C, da, db, theta, lift: up } = cpRun(p)
        const z = 0.04
        const o: V3 = [0, 0, z]
        const bFrom: V3 = use === 'torque' ? [da[0], da[1], z] : o
        botHolder.visible = use === 'turn'
        pivot.visible = use === 'torque'
        plate.material.opacity = use === 'normal' ? 0.6 : 0.28
        plate.set(o, da as V3, db as V3)
        aArrow(o, [da[0], da[1], z], U.a, use === 'torque' ? [-0.35, 0, -0.12] : [0, 0, 0])
        post([0, 0, z], [0, 0, use === 'torque' ? z : -CP.up], GREY)
        bArrow(bFrom, [bFrom[0] + db[0], bFrom[1] + db[1], bFrom[2] + db[2]], U.b, [0, 0, 0.1])
        const dc = crossView(da, db).c
        const len = Math.hypot(...dc)
        const show: Vec3 = use === 'normal' && len > 1e-6 ? (dc.map((v) => (v / len) * 0.7) as Vec3) : dc
        cArrow(o, [show[0], show[1], z + show[2]], U.c, [0.15, 0, show[2] < 0 ? 0.3 : 0])
        curl(o, da as V3, db as V3, 0.3, LABEL, 'θ')
        lift([db[0], db[1], z], [db[0], db[1], z + db[2]], GREY)

        const u = (theta + 180) / 360
        const cosL = Math.cos(up * DEG)
        sinTr.draw((v) => (Math.sin((v * 360 - 180) * DEG) * cosL * PLOT.h) / 2.2, u)
        cosTr.draw((v) => (Math.cos((v * 360 - 180) * DEG) * cosL * PLOT.h) / 2.2, null)
        plot.lo.set('−180°')
        plot.hi.set('+180°')
        plot.right.set(`z ${signed(C.z / (U.la * U.lb), 2)} |a||b|`, C.turn === 'left' ? POWER : C.turn === 'right' ? HIGH_V : LABEL)
        const unitOf = (v: number, s: string) => `${f2(v)}${s}`
        rows[0].set(`a = ${xyz(a)}${U.au}, b = ${xyz(b)}${U.bu}`, LABEL)
        rows[1].set(`a × b = ${xyz(C.c)} ${U.cu}`, POWER)
        rows[2].set(`|a × b| = ${unitOf(U.la, '')} · ${unitOf(U.lb, '')} · sin ${dg(C.theta)} = ${f2(C.area)} ${U.cu}`, HEAT)
        rows[3].set(use === 'turn' ? turnText(C.turn) : use === 'torque' ? `τz ${signed(C.z, 2)} N·m: ${C.z > 0 ? 'counter-clockwise' : C.z < 0 ? 'clockwise' : 'no turn'} from above` : `n = ${xyz(C.area > 1e-9 ? C.c.map((v) => v / C.area) : [0, 0, 0])}: ${Math.abs(up) < 1 ? 'flat floor, n straight up' : 'tilted face, n tilts too'}`, C.turn === 'right' ? HIGH_V : POWER)
        head.status.set(`Cross product · ${U.name} · floor angle ${signed(theta, 0)}°, b lifted ${signed(up, 0)}°`)
        head.sub.set('3D view · floor tape every 0.5 m · arrows drawn at a fixed length', GREY)
        head.event.set(C.area < 1e-9 ? 'a and b parallel: no area, no cross product' : `a × b stands square to a and b: ${C.turn === 'straight' ? 'lies in the floor' : C.turn === 'left' ? 'thumb up' : 'thumb down'}`, C.area < 1e-9 ? HIGH_V : POWER)
      },
      readouts: (p) => {
        const { C, U } = cpRun(p)
        return [
          { label: 'a × b', value: `${xyz(C.c)} ${U.cu}` },
          { label: 'Length = parallelogram area', value: `${f2(C.area)} ${U.cu}` },
          { label: 'Angle θ', value: dg(C.theta) },
          { label: 'z sign: b seen from above', value: C.turn, tone: C.turn === 'straight' ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Projection: split p − a into along the path, across it in the plane, and off the plane; the closest point on a segment clamps. ---

const PJ = { at: [-12, -1.8, 0] as V3, k: 8.4, s0: -0.4, s1: 1.4, N: 145 }
const pjParams = (p: Params) => ({ x: n(p, 'x'), y: n(p, 'y'), z: n(p, 'z'), tilt: n(p, 'tilt') })
const planeN = (tilt: number): Vec3 => [0, -Math.sin(tilt * DEG), Math.cos(tilt * DEG)]
const A: Vec3 = [0, 0, 0]
const B: Vec3 = [1, 0, 0]
const pjRun = memoBy(
  (p: Params) => `${p.x} ${p.y} ${p.z} ${p.tilt}`,
  (p: Params) => {
    const q = pjParams(p)
    return { ...q, P: projectionView([q.x, q.y, q.z], A, B, planeN(q.tilt)) }
  },
)
const pjCurve = memoBy(
  (p: Params) => `${p.y} ${p.z} ${p.tilt}`,
  (p: Params) => {
    const q = pjParams(p)
    const nn = planeN(q.tilt)
    return Array.from({ length: PJ.N }, (_, i) => projectionView([PJ.s0 + ((PJ.s1 - PJ.s0) * i) / (PJ.N - 1), q.y, q.z], A, B, nn).segDist)
  },
)

export const vectorsProjection: Lesson = {
  id: 'vectors-projection',
  title: 'Projection',
  tagline: 'How far along, how far off: a line follower\'s two numbers',
  formula: (p) => {
    const { P } = pjRun(p)
    return `v = p − a · along = v·u = ${f2(P.along)} m (t = ${f2(P.t)}) · across = v·m = ${f2(P.side)} m · off the plane = v·n = ${f2(P.up)} m · v = (v·u)u + (v·m)m + (v·n)n · shadow = p − (v·n)n · closest on segment: t clamped to 0…1 → ${lengthText(P.segDist)}`
  },
  legend: [
    { color: RING, label: 'v = p − a', shape: 'dot' },
    { color: HEAT, label: 'Along the path (v·u) u', shape: 'dot' },
    { color: B_FIELD, label: 'Across, in the plane: cross-track', shape: 'dot' },
    { color: POWER, label: 'Off the plane (v·n) n', shape: 'dot' },
  ],
  points: [
    'Projecting a vector onto a direction keeps only the part along it. With u the unit vector along the path a → b, the dot product v·u is how far along the point p sits, and (v·u)u is that part as an arrow. What is left, v − (v·u)u, is at right angles to the path: the perpendicular part.',
    'On a flat floor that perpendicular part is the cross-track error: how far a line follower or path tracker is off its line, signed + to the left (Control › Line following; Navigation › Path tracking › Stanley controller steers on exactly this number). Its sign comes from the Cross product of u and v.',
    'A path is made of segments, not endless lines. t = (v·u) / |b − a| says where along: 0 at a, 1 at b. Clamp t to 0…1 and you have the closest point on the segment; past either end it sticks to the end point and the distance grows again (the plot). Path trackers run this on every segment and keep the nearest.',
    'Projecting onto a plane drops the part along its normal n: shadow = p − (v·n)n. Tilt the ramp and the point\'s x, y, z no longer line up with the plane: the three parts along u, across m and off n (m = n × u) still add back to v, at right angles to each other. That is a change of basis, and a drone\'s shadow on a slope.',
    'The camera version squashes 3D onto an image plane along rays instead of straight down (Perception › Camera model › Pinhole model); the robot-arm version reads a force along each joint axis (Kinematics › Jacobian). Both start with a dot product.',
  ],
  controls: [
    { kind: 'slider', key: 'x', label: 'Point x (along a → b)', min: PJ.s0, max: PJ.s1, step: 0.05, initial: 0.6, format: (v) => `${v.toFixed(2)} m` },
    { kind: 'slider', key: 'y', label: 'Point y (left)', min: -0.5, max: 0.5, step: 0.05, initial: 0.3, format: (v) => `${v.toFixed(2)} m` },
    { kind: 'slider', key: 'z', label: 'Point z (up)', min: 0, max: 0.6, step: 0.05, initial: 0.35, format: (v) => `${v.toFixed(2)} m` },
    angleSlider('tilt', 'Ramp tilt', 0, 40, 20),
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = zUp(scene, PJ.at, PJ.k, 0.42, -0.3)
    floorMat(add(g, new THREE.Group(), [0, 0, -0.35]), [-0.5, 1.5], [-0.6, 0.7])
    const ramp = add(g, new THREE.Group())
    const rampMat = new THREE.MeshStandardMaterial({ color: '#6a7a8c', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide })
    add(ramp, mesh(new THREE.BoxGeometry(1.9, 1, 0.004), rampMat), [0.5, 0.1, 0]).castShadow = false
    box(ramp, [1, 0.04, 0.006], mat('#111214', { rough: 0.9 }), [0.5, 0, 0.004])
    for (const e of [A, B]) add(ramp, mesh(new THREE.SphereGeometry(0.03, 14, 10), glowMat(LABEL, 0.8)), e as V3)
    const endTags = ['a', 'b'].map((t, i) => {
      const l = liveLabel(ramp, [i, -0.1, 0.05], { size: 0.08 })
      l.set(t, LABEL)
      return l
    })
    const line = dotLine(g, 0.006, 40)
    const vArrow = vecArrow(g, RING, 0.012, 0.075)
    const alongArrow = vecArrow(g, HEAT, 0.014, 0.075)
    const sideArrow = vecArrow(g, B_FIELD, 0.014, 0.075)
    const upArrow = vecArrow(g, POWER, 0.014, 0.075)
    const toClosest = dotLine(g, 0.009, 30)
    const drop = dotLine(g, 0.007, 30)
    const ball = add(g, mesh(new THREE.SphereGeometry(0.04, 18, 12), glowMat(RING, 1.1)))
    const pTag = liveLabel(g, [0, 0, 0], { size: 0.08 })
    pTag.set('p', RING)
    const shadow = add(g, mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.004, 24).rotateX(Math.PI / 2), mat('#15171b', { rough: 1 })))
    const closest = add(g, mesh(new THREE.SphereGeometry(0.03, 14, 10), glowMat('#ffffff', 1.2)))

    const plot = titledScope(scene, PLOT.y, PLOT.h, 'distance to segment vs x', LABEL, 0, PLOT.x, PLOT.w)
    const curve = plot.s.trace(LABEL, { samples: PJ.N, radius: 0.06 })
    const lineLvl = plot.s.level(GREY)
    const ab = [0, 1].map((t) => liveLabel(scene, [PLOT.x - PLOT.w / 2 + ((t - PJ.s0) / (PJ.s1 - PJ.s0)) * PLOT.w, PLOT.y - PLOT.h / 2 - 0.9, 0.2], { size: 0.26 }))
    ab.forEach((l, i) => l.set(i ? 'b' : 'a', LABEL))
    const rows = textRows(scene, 4)
    const yOf = (d: number) => -PLOT.h / 2 + (Math.min(d, 1) / 1) * PLOT.h
    return {
      scene,
      view: { center: [-1.2, -1, 0], radius: 56, polar: 1.45, azimuth: 0 },
      frame(_dt, p) {
        const { x, y, z, tilt, P } = pjRun(p)
        ramp.rotation.x = tilt * DEG
        endTags.forEach((t) => faceFront(t.group))
        faceFront(pTag.group)
        const pt: V3 = [x, y, z]
        const u = P.u as V3
        line([u[0] * -0.5, u[1] * -0.5, u[2] * -0.5], [u[0] * 1.5, u[1] * 1.5, u[2] * 1.5], GREY)
        ball.position.set(...pt)
        pTag.group.position.set(x, y, z + 0.1)
        vArrow([0, 0, 0], pt, '')
        const foot = P.foot as V3
        alongArrow([0, 0, 0], foot, '')
        const sideEnd: V3 = [foot[0] + P.m[0] * P.side, foot[1] + P.m[1] * P.side, foot[2] + P.m[2] * P.side]
        sideArrow(foot, sideEnd, `e ${signed(P.side, 2)} m`, [0.32, 0, -0.1])
        upArrow(sideEnd, pt, '')
        const sh = P.shadow as V3
        shadow.position.set(...sh)
        shadow.rotation.x = tilt * DEG
        drop(pt, sh, GREY)
        closest.position.set(...(P.closest as V3))
        toClosest(pt, P.closest as V3, P.clamped ? HIGH_V : LABEL)

        curve.draw((v) => yOf(pjCurve(p)[Math.round(v * (PJ.N - 1))]), (x - PJ.s0) / (PJ.s1 - PJ.s0))
        lineLvl.set(yOf(P.lineDist))
        plot.lo.set(`${PJ.s0} m`)
        plot.hi.set(`${PJ.s1} m`)
        plot.right.set(`now ${lengthText(P.segDist)}${P.clamped ? ', end' : ''}`, P.clamped ? HIGH_V : LABEL)
        rows[0].set(`along v·u = ${f2(P.along)} m → t = ${f2(P.t)}${P.clamped ? `, clamped to ${P.tc}` : ''}`, HEAT)
        rows[1].set(`across v·m = ${signed(P.side, 2)} m (${P.side >= 0 ? 'left' : 'right'} of the path)`, B_FIELD)
        rows[2].set(`off the ramp v·n = ${f2(P.up)} m → shadow = p − (v·n)n`, POWER)
        rows[3].set(`check: ${f2(P.along)}² + ${fp(P.side)}² + ${fp(P.up)}² = |v|² = ${f2(Math.hypot(...sub3([x, y, z], A)) ** 2)}`, GREY)
        head.status.set(`Projection · p = ${xyz(pt)} m · ramp ${tilt}°`)
        head.sub.set('3D view · path a → b is 1 m on the ramp · floor tape every 0.5 m', GREY)
        head.event.set(P.clamped ? `past ${P.t < 0 ? 'a' : 'b'}: the closest point is the end, not the foot` : 'between a and b: the closest point is the foot of the perpendicular', P.clamped ? HIGH_V : POWER)
      },
      readouts: (p) => {
        const { P } = pjRun(p)
        return [
          { label: 'Along (t)', value: `${f2(P.along)} m (${f2(P.t)})`, tone: P.clamped ? 'warn' : 'ok' },
          { label: 'Cross-track (+ left)', value: `${signed(P.side, 2)} m` },
          { label: 'Off the plane', value: `${f2(P.up)} m` },
          { label: 'Distance to segment', value: lengthText(P.segDist), tone: P.clamped ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
