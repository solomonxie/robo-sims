import * as THREE from 'three/webgpu'
import { DEG, bearingView, elbowView, toDeg, unitCircleView } from '../../core/physics'
import { cmText, fixedText, radText, signed } from '../../core/units'
import { V3, add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  AXIS_RGB,
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  addRod,
  angleArc,
  diffBot,
  dotLine,
  floorMat,
  floorView,
  glowMat,
  liveLabel,
  memoBy,
  pointCloud,
  statusHeader,
  stretchRod,
  titledScope,
  vecArrow,
  textRows,
} from '../fx'
import { Lesson, Params, Stage, angleSlider, n, opts, pick, toneOf } from '../types'

const f2 = (v: number) => fixedText(v)
const dg = (rad: number) => radText(rad, 0)
const rd = (rad: number) => `${f2(rad)} rad`
const VIEW = { center: [-1.2, -1, 0] as V3, radius: 56, polar: 1.45, azimuth: 0 }
const ball = (g: THREE.Object3D, r: number, c: string) => add(g, mesh(new THREE.SphereGeometry(r, 18, 12), glowMat(c, 1.1)))
const ringDots = (g: THREE.Object3D, k: number, r: number) => {
  const dots = pointCloud(g, k, r)
  return (radius: number, color: (a: number) => string, from = 0, span = 2 * Math.PI) => {
    for (let i = 0; i < k; i++) {
      const a = from + (i / k) * span
      dots.set(i, [radius * Math.cos(a), radius * Math.sin(a), 0.01], color(a))
    }
    dots.show(k)
  }
}
const quadName = (q: number) => ['on an axis', 'quadrant I', 'quadrant II', 'quadrant III', 'quadrant IV'][q]

// --- Unit circle: a point going round; cos θ and sin θ are its x and y shadows, unrolled into waves. ---

const UC = { at: [-9.6, -4, 0] as V3, k: 5.4, x: 9.4, w: 11, h: 5.6, ys: 0.4, yc: -8.4, span: 360 }
const ucRun = memoBy(
  (p: Params) => `${p.th}`,
  (p: Params) => {
    const th = n(p, 'th')
    return { th, U: unitCircleView(th * DEG) }
  },
)

export const trigonometryUnitCircle: Lesson = {
  id: 'trigonometry-unit-circle',
  title: 'Unit circle',
  tagline: 'cos and sin are just the x and y of a point going round',
  formula: (p) => {
    const { th, U } = ucRun(p)
    return `point = (cos θ, sin θ) · θ = ${th}° = ${rd(U.th)} (180° = π rad) · cos θ = ${f2(U.x)}, sin θ = ${f2(U.y)} · cos² + sin² = ${f2(U.check)} · same direction as ${dg(U.wrapped)} (wrapped to −180°…+180°) · ${f2(U.turns)} turns`
  },
  legend: [
    { color: RING, label: 'Radius 1 at angle θ', shape: 'dot' },
    { color: AXIS_RGB[0], label: 'x shadow = cos θ', shape: 'dot' },
    { color: AXIS_RGB[1], label: 'y shadow = sin θ', shape: 'dot' },
    { color: HEAT, label: 'Arc swept = θ in radians', shape: 'dot' },
  ],
  points: [
    'Put a point on a circle of radius 1 and turn it by θ, counter-clockwise from the x axis. Its x coordinate is cos θ and its y coordinate is sin θ. That is the whole definition: no triangles needed, and it works for any angle, even past 90° or below zero.',
    'Sweep θ: the x shadow (red) and the y shadow (green) slide back and forth, and plotted against θ they unroll into the cos and sin waves. Same shape, sin a quarter turn (90°) behind. A servo horn, a wheel spot or a crank pin traces exactly this; an AC voltage is the y shadow of a turning generator (Electricity › AC vs DC › Sine waves and RMS).',
    'Radians measure the angle as the arc length on this unit circle (orange). One full turn is 2π ≈ 6.28 rad = 360°, so 1 rad ≈ 57.3°. Code uses radians: Math.sin(30) is sin of 30 rad, not 30°. Convert with θ·π/180.',
    'Angles repeat every turn: 270° points the same way as −90°, and 400° the same as 40°. Robots keep angles wrapped to −180°…+180° (wrapPi) so a heading never grows without bound and "how far to turn" is the short way round: see atan2. cos² θ + sin² θ = 1 always, because the point stays on the circle.',
    'The Rotation matrix is built from this point: its first column is (cos θ, sin θ), where the x axis lands (Maths › Matrices › Rotation matrix).',
  ],
  controls: [angleSlider('th', 'Angle θ', -360, 360, 60)],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = floorView(scene, UC.at, UC.k, 0)
    const ring = ringDots(g, 144, 0.016)
    const axis = [dotLine(g, 0.008, 60), dotLine(g, 0.008, 60)]
    const marks: [string, string, number][] = [['0°', '0', 0], ['90°', 'π/2', 90], ['±180°', 'π', 180], ['−90°', '−π/2', 270]]
    for (const [d, r, a] of marks) {
      const [c, s] = [Math.cos(a * DEG), Math.sin(a * DEG)]
      addLabel(g, d, [1.27 * c, 1.15 * s - 0.03, 0.02], GREY, 0.085)
      addLabel(g, r, [0.86 * c + (s ? 0.12 : 0), 0.86 * s + (s ? 0 : 0.07), 0.02], HEAT, 0.07)
    }
    const radius = vecArrow(g, RING, 0.016, 0.09)
    const cosA = vecArrow(g, AXIS_RGB[0], 0.022, 0.09)
    const sinA = vecArrow(g, AXIS_RGB[1], 0.022, 0.09)
    const drops = [dotLine(g, 0.008, 30), dotLine(g, 0.008, 30)]
    const arc = angleArc(g, 0.01, 0.085)
    const dot = ball(g, 0.05, RING)

    const scopes = [
      { y: UC.ys, title: 'y shadow: sin θ', c: AXIS_RGB[1], f: Math.sin },
      { y: UC.yc, title: 'x shadow: cos θ', c: AXIS_RGB[0], f: Math.cos },
    ].map((s) => {
      const plot = titledScope(scene, s.y, UC.h, s.title, s.c, 0.5, UC.x, UC.w)
      return { ...s, plot, tr: plot.s.trace(s.c, { samples: 241, radius: 0.06 }) }
    })
    const rows = textRows(scene, 2, -16.4, -11.6, 0.34)
    return {
      scene,
      view: VIEW,
      frame(_dt, p) {
        const { th, U } = ucRun(p)
        const swept = Math.abs(U.th)
        ring(1, (a) => {
          const along = U.th >= 0 ? a : (2 * Math.PI - a) % (2 * Math.PI)
          return swept >= 2 * Math.PI || along <= swept ? HEAT : GREY
        })
        axis[0]([-1.25, 0, 0.005], [1.25, 0, 0.005], GREY)
        axis[1]([0, -1.15, 0.005], [0, 1.15, 0.005], GREY)
        const P: V3 = [U.x, U.y, 0.03]
        radius([0, 0, 0.03], P, '')
        cosA([0, 0, 0.04], [U.x, 0, 0.04], 'cos', [0, U.y >= 0 ? -0.12 : 0.12, 0])
        sinA([U.x, 0, 0.04], [U.x, U.y, 0.04], 'sin', [U.x >= 0 ? 0.14 : -0.14, 0, 0])
        drops[0](P, [U.x, 0, 0.03], GREY)
        drops[1](P, [0, U.y, 0.03], GREY)
        arc([0, 0, 0.03], [1, 0, 0], [U.x, U.y, 0], 0.3, LABEL, dg(U.wrapped))
        dot.position.set(U.x, U.y, 0.04)

        const u = (th + UC.span) / (2 * UC.span)
        for (const s of scopes) {
          s.tr.draw((v) => (s.f((v * 2 - 1) * UC.span * DEG) * UC.h) / 2.3, u)
          s.plot.lo.set('−360°')
          s.plot.hi.set('+360°')
          s.plot.right.set(`θ ${signed(th, 0)}°: ${f2(s.f(U.th))}`, s.c)
        }
        rows[0].set(`θ = ${th}° = ${rd(U.th)} = ${f2(U.turns)} turns`, HEAT)
        rows[1].set(`(cos θ, sin θ) = (${f2(U.x)}, ${f2(U.y)}) · cos² + sin² = ${f2(U.check)}`, LABEL)
        head.status.set(`Unit circle · θ ${signed(th, 0)}° · ${quadName(U.quadrant)}`)
        head.sub.set('face-on · radius 1 · counter-clockwise from the x axis is positive', GREY)
        const wraps = Math.abs(toDeg(U.wrapped) - th) > 1e-6
        head.event.set(wraps ? `points the same way as ${dg(U.wrapped)}: wrap to ±180°` : 'already inside −180°…+180°', wraps ? HEAT : POWER)
      },
      readouts: (p) => {
        const { th, U } = ucRun(p)
        return [
          { label: 'cos θ (x)', value: f2(U.x) },
          { label: 'sin θ (y)', value: f2(U.y) },
          { label: 'In radians', value: rd(th * DEG) },
          { label: 'Wrapped to ±180°', value: dg(U.wrapped), tone: Math.abs(toDeg(U.wrapped) - th) > 1e-6 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- atan2: bearing to a target in any quadrant; atan(y/x) loses the quadrant; heading error wraps the short way. ---

const AT = { at: [-8.8, -3, 0] as V3, k: 7.2, bot: 2.2, x: 9.6, w: 10, y: 1.4, h: 6.4 }
const atRun = memoBy(
  (p: Params) => `${p.tx} ${p.ty} ${p.heading}`,
  (p: Params) => {
    const [tx, ty, heading] = [n(p, 'tx'), n(p, 'ty'), n(p, 'heading')]
    return { tx, ty, heading, V: bearingView(tx, ty, heading * DEG) }
  },
)
const naiveText = (v: number | null) => (v === null ? 'undefined (x = 0)' : dg(v))

export const trigonometryAtan2: Lesson = {
  id: 'trigonometry-atan2',
  title: 'atan2',
  tagline: 'Which way is the target? atan2 gets all four quadrants right',
  formula: (p) => {
    const { tx, ty, V } = atRun(p)
    return `bearing = atan2(y, x) = atan2(${f2(ty)}, ${f2(tx)}) = ${dg(V.bearing)} · atan(y/x) = ${naiveText(V.naive)}${V.naiveOff !== null && Math.abs(V.naiveOff) > 1e-6 ? ' (off by 180°)' : ''} · heading error = wrap(bearing − heading) = wrap(${dg(V.raw)}) = ${dg(V.error)} → turn ${V.side}`
  },
  legend: [
    { color: POWER, label: 'atan2(y, x): true bearing', shape: 'dot' },
    { color: HIGH_V, label: 'atan(y/x): loses the quadrant', shape: 'dot' },
    { color: B_FIELD, label: 'Robot heading', shape: 'dot' },
    { color: HEAT, label: 'Heading error, short way round', shape: 'dot' },
  ],
  points: [
    'The robot sits at the origin and the target is at (x, y). The bearing is the angle of that arrow from the x axis. Trig says tan θ = y/x, so the obvious guess is θ = atan(y/x).',
    'atan(y/x) only answers −90°…+90°. Move the target to the left half (quadrants II and III): (−1, −1) and (1, 1) give the same y/x = 1, so atan says 45° for both and the robot drives away from a target behind it. At x = 0 it divides by zero.',
    'atan2(y, x) takes y and x separately, so it sees their signs and returns the true angle in −180°…+180°, x = 0 included. The plot sweeps the target round a circle: atan2 (green) is a straight line, atan(y/x) (red) jumps by 180° at x = 0.',
    'To steer, subtract: heading error = bearing − heading. With heading 170° and the target at −170°, the raw difference is −340°, but the target is just 20° to the left. Wrap it to −180°…+180° (wrapPi) and turn the short way. Every heading controller does this (Navigation › Path tracking › Pure pursuit, Stanley controller).',
    'The same function reads tilt from an accelerometer: pitch = atan2(ax, √(ay² + az²)) stays correct even upside down (Sensors › IMU › Accelerometer). The wheel angle from two quadrature channels, an encoder angle from sin/cos tracks, and the shoulder angle in Inverse kinematics all use atan2.',
  ],
  controls: [
    { kind: 'slider', key: 'tx', label: 'Target x', min: -1, max: 1, step: 0.05, initial: -0.7, format: (v) => `${v.toFixed(2)} m` },
    { kind: 'slider', key: 'ty', label: 'Target y', min: -1, max: 1, step: 0.05, initial: -0.4, format: (v) => `${v.toFixed(2)} m` },
    angleSlider('heading', 'Robot heading', -180, 180, 150),
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = floorView(scene, AT.at, AT.k, -0.5)
    floorMat(g, [-1.15, 1.15], [-1.15, 1.15])
    const axis = [dotLine(g, 0.008, 60), dotLine(g, 0.008, 60)]
    const quads: [string, number, number][] = [['I', 1, 1], ['II', -1, 1], ['III', -1, -1], ['IV', 1, -1]]
    for (const [t, sx, sy] of quads) addLabel(g, t, [sx * 0.95, sy * 0.95, 0.02], GREY, 0.11)
    addLabel(g, '+x', [1.12, 0.06, 0.02], AXIS_RGB[0], 0.08)
    addLabel(g, '+y', [0.08, 1.08, 0.02], AXIS_RGB[1], 0.08)
    const bot = diffBot(add(g, new THREE.Group()))
    bot.group.scale.setScalar(AT.bot)
    const target = ball(g, 0.05, RING)
    const truth = vecArrow(g, POWER, 0.016, 0.085)
    const naive = vecArrow(g, HIGH_V, 0.014, 0.085)
    const heading = vecArrow(g, B_FIELD, 0.014, 0.085)
    const errArc = angleArc(g, 0.011, 0.085)
    const thArc = angleArc(g, 0.007, 0.075)

    const plot = titledScope(scene, AT.y, AT.h, 'angle out vs target direction', LABEL, 0.5, AT.x, AT.w)
    const trTrue = plot.s.trace(POWER, { samples: 241, radius: 0.06 })
    const trNaive = plot.s.trace(HIGH_V, { samples: 241, radius: 0.05 })
    const rows = textRows(scene, 4, 2.4, -3.4, 0.32)
    return {
      scene,
      view: VIEW,
      frame(_dt, p) {
        const { tx, ty, heading: hd, V } = atRun(p)
        const z = 0.03
        axis[0]([-1.15, 0, 0.005], [1.15, 0, 0.005], GREY)
        axis[1]([0, -1.15, 0.005], [0, 1.15, 0.005], GREY)
        bot.set({ x: 0, y: 0, th: hd * DEG })
        target.position.set(tx, ty, 0.05)
        truth([0, 0, z], [tx, ty, z], 'atan2', [0.06, ty >= 0 ? 0.09 : -0.09, 0])
        const off = V.naive === null || Math.abs(V.naiveOff ?? 0) > 1e-6
        const nr = 0.7
        naive([0, 0, z + 0.01], V.naive === null ? [0, 0, z + 0.01] : [nr * Math.cos(V.naive), nr * Math.sin(V.naive), z + 0.01], off && V.naive !== null ? 'atan(y/x)' : '', [0, -0.08, 0])
        const h: V3 = [Math.cos(hd * DEG), Math.sin(hd * DEG), 0]
        heading([0, 0, z + 0.02], [h[0] * 0.6, h[1] * 0.6, z + 0.02], 'heading', [h[0] * 0.12, h[1] * 0.12 + 0.05, 0])
        errArc([0, 0, z], h, [tx, ty, 0], 0.36, HEAT, dg(V.error))
        thArc([0, 0, z], [1, 0, 0], [tx, ty, 0], 0.2, LABEL)

        const r = Math.max(V.dist, 0.3)
        const toU = (a: number) => (a + Math.PI) / (2 * Math.PI)
        const yOf = (a: number) => (a / Math.PI) * (AT.h / 2.2)
        const angAt = (u: number) => (u * 2 - 1) * Math.PI
        trTrue.draw((u) => yOf(Math.atan2(r * Math.sin(angAt(u)), r * Math.cos(angAt(u)))), toU(V.bearing))
        trNaive.draw((u) => yOf(Math.atan(Math.tan(angAt(u)))), V.naive === null ? null : toU(V.bearing))
        plot.lo.set('target at −180°')
        plot.hi.set('+180°')
        plot.right.set(`now ${dg(V.bearing)}`, POWER)

        rows[0].set(`atan2(${f2(ty)}, ${f2(tx)}) = ${dg(V.bearing)} · ${quadName(V.quadrant)}`, POWER)
        rows[1].set(`atan(y/x) = atan(${V.naive === null ? `${f2(ty)}/0` : f2(ty / tx)}) = ${naiveText(V.naive)}${off && V.naive !== null ? ': off by 180°' : ''}`, off ? HIGH_V : LABEL)
        rows[2].set(`bearing − heading = ${dg(V.bearing)} − ${hd}° = ${dg(V.raw)}`, V.wrapped ? GREY : LABEL)
        rows[3].set(`wrapped: ${dg(V.error)} → turn ${V.side}${V.wrapped ? ', the short way' : ''}`, HEAT)
        head.status.set(`atan2 · target (${f2(tx)}, ${f2(ty)}) m · heading ${signed(hd, 0)}°`)
        head.sub.set('top view · x axis = 0°, counter-clockwise + · robot 2.2× size', GREY)
        head.event.set(
          V.naive === null ? 'x = 0: atan(y/x) divides by zero, atan2 is fine' : off ? 'left half: atan(y/x) points the opposite way' : V.wrapped ? 'raw difference past ±180°: wrap it' : 'right half: atan and atan2 agree here',
          off ? HIGH_V : V.wrapped ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const { V } = atRun(p)
        const off = V.naive === null || Math.abs(V.naiveOff ?? 0) > 1e-6
        return [
          { label: 'atan2(y, x)', value: dg(V.bearing), tone: 'ok' },
          { label: 'atan(y/x)', value: naiveText(V.naive), tone: off ? 'bad' : 'ok' },
          { label: 'bearing − heading (raw)', value: dg(V.raw), tone: V.wrapped ? 'warn' : 'ok' },
          { label: 'Heading error (wrapped)', value: `${dg(V.error)} ${V.side}` },
        ]
      },
    }
  },
}

// --- Law of cosines: two links and the distance to the target fix the elbow angle; two mirror solutions; out of range, no triangle. ---

const ELBOWS = { up: 'Elbow up', down: 'Elbow down' }
const LC = { at: [-9.6, -7.2, 0] as V3, k: 36, ring: [-15 * DEG, 180 * DEG] as const, dMax: 0.32, x: 9.6, w: 10, y: 1.4, h: 6.4 }
const lcRun = memoBy(
  (p: Params) => `${p.a} ${p.b} ${p.d} ${p.dir} ${p.elbow}`,
  (p: Params) => {
    const [a, b, d, dir] = [n(p, 'a'), n(p, 'b'), n(p, 'd'), n(p, 'dir')]
    const elbow = pick(ELBOWS, p.elbow, 'up')
    return { a, b, d, dir, elbow, E: elbowView(a, b, d, dir * DEG, elbow), O: elbowView(a, b, d, dir * DEG, elbow === 'up' ? 'down' : 'up') }
  },
)

export const trigonometryLawOfCosines: Lesson = {
  id: 'trigonometry-law-of-cosines',
  title: 'Law of cosines',
  tagline: 'Three sides fix a triangle: the elbow angle of a two-link arm',
  formula: (p) => {
    const { a, b, d, E } = lcRun(p)
    return `c² = a² + b² − 2ab·cos C · cos C = (a² + b² − c²)/(2ab) = (${f2(a)}² + ${f2(b)}² − ${f2(d)}²)/(2·${f2(a)}·${f2(b)}) m = ${f2(E.cosC)}${E.reachable ? ` → C = ${dg(E.C)}, elbow joint q2 = ±(180° − C)` : ': |cos C| > 1, no triangle: out of reach'} · reach ${cmText(E.reach[0])} … ${cmText(E.reach[1])}`
  },
  legend: [
    { color: B_FIELD, label: 'a: upper arm', shape: 'dot' },
    { color: POWER, label: 'b: forearm', shape: 'dot' },
    { color: HEAT, label: 'c: shoulder to target, angle C', shape: 'dot' },
    { color: GREY, label: 'Mirror solution and reach ring', shape: 'dot' },
  ],
  points: [
    'Pythagoras only works with a right angle. The law of cosines works for any triangle: c² = a² + b² − 2ab·cos C, where C is the angle between sides a and b, opposite c. At C = 90° the last term vanishes and it is Pythagoras again.',
    'A two-link arm is a triangle: upper arm a, forearm b, and c the straight line from shoulder to target. The lengths are fixed and c comes from the target, so the elbow angle is cos C = (a² + b² − c²)/(2ab). Slide c: nearer targets fold the elbow, far ones open it toward 180° (plot).',
    'Each c gives two mirror triangles: elbow up or elbow down. Same C, the elbow just flips across the shoulder–target line (grey ghost). The servo joint angle is q2 = ±(180° − C), one sign per solution.',
    'When c > a + b the arm cannot reach, and when c < |a − b| it cannot fold small enough: then |cos C| > 1 and acos has no answer. Real code checks the range first and clamps or refuses. The dotted rings mark the reachable band.',
    'That is the core of analytic IK. The shoulder angle then comes from atan2 of the target plus the triangle\'s angle at the shoulder: the full solve, joint limits and the 3D servo arm are in Kinematics › Inverse kinematics › Analytic IK and Multiple solutions.',
  ],
  controls: [
    { kind: 'slider', key: 'a', label: 'Upper arm a', min: 0.06, max: 0.16, step: 0.01, initial: 0.12, format: (v) => cmText(v) },
    { kind: 'slider', key: 'b', label: 'Forearm b', min: 0.06, max: 0.16, step: 0.01, initial: 0.09, format: (v) => cmText(v) },
    { kind: 'slider', key: 'd', label: 'Distance to target c', min: 0.01, max: LC.dMax, step: 0.005, initial: 0.15, format: (v) => cmText(v) },
    angleSlider('dir', 'Target direction', -15, 120, 30),
    { kind: 'choice', key: 'elbow', options: opts(ELBOWS), initial: 'up' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = floorView(scene, LC.at, LC.k, 0)
    const base = add(g, mesh(new THREE.BoxGeometry(0.05, 0.02, 0.02), glowMat('#3a3f48', 0.2)), [0, -0.012, 0])
    base.castShadow = false
    const ground = dotLine(g, 0.0018, 80)
    const rings = [ringDots(g, 60, 0.0018), ringDots(g, 100, 0.0018)]
    const links = [addRod(g, glowMat(B_FIELD, 0.8)), addRod(g, glowMat(POWER, 0.8))]
    const joints = [ball(g, 0.008, LABEL), ball(g, 0.008, LABEL), ball(g, 0.006, LABEL)]
    const target = ball(g, 0.008, RING)
    const cLine = dotLine(g, 0.0022, 60)
    const ghost = [dotLine(g, 0.0024, 40), dotLine(g, 0.0024, 40)]
    const arcC = angleArc(g, 0.0018, 0.016)
    const tags = ['a', 'b', 'c'].map((t, i) => {
      const l = liveLabel(g, [0, 0, 0.01], { size: 0.016 })
      l.set(t, [B_FIELD, POWER, HEAT][i])
      return l
    })

    const plot = titledScope(scene, LC.y, LC.h, 'elbow angle C vs distance c', HEAT, 0, LC.x, LC.w)
    const tr = plot.s.trace(HEAT, { samples: 201, radius: 0.06 })
    const rows = textRows(scene, 3, 2.4, -3.4, 0.32)
    return {
      scene,
      view: VIEW,
      frame(_dt, p) {
        const { a, b, d, elbow, E, O } = lcRun(p)
        const z = 0.01
        const at = (v: readonly number[], dz = z): V3 => [v[0], v[1], dz]
        ground([-0.12, 0, 0], [0.3, 0, 0], GREY)
        rings[0](E.reach[0], () => GREY, ...LC.ring)
        rings[1](E.reach[1], () => GREY, ...LC.ring)
        stretchRod(links[0], at([0, 0]), at(E.elbowAt), 0.006)
        stretchRod(links[1], at(E.elbowAt), at(E.tip), 0.005)
        joints[1].position.set(...at(E.elbowAt, 0.015))
        joints[2].position.set(...at(E.tip, 0.015))
        joints[0].position.set(0, 0, 0.015)
        target.position.set(...at(E.target, 0.02))
        target.visible = !E.reachable
        cLine(at([0, 0], 0.012), at(E.target, 0.012), E.reachable ? HEAT : HIGH_V)
        ghost[0](at([0, 0], 0.005), at(O.elbowAt, 0.005), GREY)
        ghost[1](at(O.elbowAt, 0.005), at(O.tip, 0.005), GREY)
        const ea = E.elbowAt
        const toTip: V3 = E.reachable ? [E.tip[0] - ea[0], E.tip[1] - ea[1], 0] : [-ea[0], -ea[1], 0]
        arcC(at(ea, 0.012), [-ea[0], -ea[1], 0], toTip, 0.025, HEAT, E.C > 0.05 ? 'C' : '')
        const side = (u: readonly number[], v: readonly number[], opp: readonly number[]): V3 => {
          const m = [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2]
          const L = Math.hypot(v[0] - u[0], v[1] - u[1]) || 1
          let [nx, ny] = [-(v[1] - u[1]) / L, (v[0] - u[0]) / L]
          if (nx * (opp[0] - m[0]) + ny * (opp[1] - m[1]) > 0) [nx, ny] = [-nx, -ny]
          return [m[0] + nx * 0.02, m[1] + ny * 0.02 - 0.005, 0.02]
        }
        tags[0].group.position.set(...side([0, 0], ea, E.tip))
        tags[1].group.position.set(...side(ea, E.tip, [0, 0]))
        tags[2].group.position.set(...side([0, 0], E.target, ea))

        const cOf = (c: number) => elbowView(a, b, Math.max(c, 1e-4), 0, 'up').C
        const yOf = (C: number) => (C / Math.PI) * LC.h - LC.h / 2
        tr.draw((u) => yOf(cOf(u * LC.dMax)), d / LC.dMax)
        plot.lo.set('c = 0')
        plot.hi.set(cmText(LC.dMax))
        plot.right.set(E.reachable ? `C = ${dg(E.C)}` : 'out of reach', E.reachable ? HEAT : HIGH_V)

        rows[0].set(`cos C = (a² + b² − c²) / 2ab = ${f2(E.cosC)}`, E.reachable ? HEAT : HIGH_V)
        rows[1].set(E.reachable ? `C = acos(${f2(E.cosC)}) = ${dg(E.C)} · q2 = ${dg(E.q[1])}` : `|cos C| > 1: acos fails, ${cmText(Math.abs(E.miss))} too ${E.miss > 0 ? 'far' : 'close'}`, E.reachable ? LABEL : HIGH_V)
        rows[2].set(`reach ${cmText(E.reach[0])} … ${cmText(E.reach[1])} · flat = out of reach`, GREY)
        head.status.set(`Law of cosines · a ${cmText(a)} · b ${cmText(b)} · c ${cmText(d)} · ${ELBOWS[elbow].toLowerCase()}`)
        head.sub.set('side view · shoulder at the origin · grey ghost = the mirror solution', GREY)
        head.event.set(E.reachable ? (E.C > Math.PI - 0.05 ? 'nearly straight: at the edge of reach' : 'two links + one distance = one elbow angle (two mirror poses)') : E.miss > 0 ? 'c > a + b: too far, the arm stretches out straight' : 'c < |a − b|: too close to fold that small', E.reachable ? POWER : HIGH_V)
      },
      readouts: (p) => {
        const { E } = lcRun(p)
        return [
          { label: 'cos C', value: f2(E.cosC), tone: toneOf(E.reachable, false) },
          { label: 'Elbow angle C', value: E.reachable ? dg(E.C) : 'none' },
          { label: 'Joint angle q2', value: E.reachable ? dg(E.q[1]) : '—' },
          { label: 'Reach band', value: `${cmText(E.reach[0])} … ${cmText(E.reach[1])}`, tone: toneOf(E.reachable, false) },
        ]
      },
    }
  },
}
