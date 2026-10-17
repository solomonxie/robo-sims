import * as THREE from 'three/webgpu'
import { DEG, I2, Mat2, apply2, colOf2, composeView, inverseView, mul2, rotMat2, rotationCheck, scaleMat2, shearMat2, toDeg, transpose2 } from '../../core/physics'
import { degText, fixedText, signed } from '../../core/units'
import { V3, add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  AXIS_RGB,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  angleArc,
  dotLine,
  floorView,
  glowMat,
  liveLabel,
  matrixGrid,
  memoBy,
  parallelogram,
  statusHeader,
  titledScope,
  vecArrow,
  warpGrid,
  textRows,
} from '../fx'
import { Lesson, Params, Stage, angleSlider, n, namesOf, opts, pick, toneOf } from '../types'

const f2 = (v: number) => fixedText(v)
const fp = (v: number) => (v < -0.005 ? `(${f2(v)})` : f2(v))
const dg = (rad: number) => degText(toDeg(rad), 0)
const pair = (v: readonly number[]) => `(${v.map(f2).join(', ')})`
const mat2Text = (M: Mat2) => `[${f2(M[0])} ${f2(M[1])}; ${f2(M[2])} ${f2(M[3])}]`
const COLS = [AXIS_RGB[0], AXIS_RGB[1]]
const VIEW = { center: [-1.2, -1, 0] as V3, radius: 56, polar: 1.45, azimuth: 0 }
const vec3 = (p: readonly number[], z: number): V3 => [p[0], p[1], z]

// --- Rotation matrix: its columns are where the x and y axes land; unit length, square to each other, det = +1. ---

const RM_MODES = {
  rot: { name: 'Pure rotation', M: (th: number) => rotMat2(th) },
  stretch: { name: 'Rotate + stretch x 1.5×', M: (th: number) => mul2(rotMat2(th), scaleMat2(1.5, 1)) },
  mirror: { name: 'Rotate + mirror y', M: (th: number) => mul2(rotMat2(th), scaleMat2(1, -1)) },
}
const RM = { at: [-9.4, -3.3, 0] as V3, k: 5.5, plot: { x: 11.2, w: 8.6, y: 2.4, h: 5 }, mx: 3.6 }
const rmRun = memoBy(
  (p: Params) => `${p.th} ${p.mode}`,
  (p: Params) => {
    const th = n(p, 'th')
    const mode = pick(RM_MODES, p.mode, 'rot')
    const M = RM_MODES[mode].M(th * DEG)
    return { th, mode, M, C: rotationCheck(M) }
  },
)
const rmVerdict = (C: ReturnType<typeof rotationCheck>) =>
  C.rotation ? 'a rotation: lengths and angles kept' : C.mirror ? 'orthonormal but det −1: a mirror, not a rotation' : 'columns not length 1: shapes stretch, not a rotation'

export const matricesRotationMatrix: Lesson = {
  id: 'matrices-rotation-matrix',
  title: 'Rotation matrix',
  tagline: 'Four numbers that turn everything: read them as the new axes',
  formula: (p) => {
    const { th, M, C } = rmRun(p)
    return `R(θ) = [cos θ  −sin θ; sin θ  cos θ] · θ = ${th}° · M = ${mat2Text(M)} · columns = where x and y land: ${pair(C.x)}, ${pair(C.y)} · |col 1| = ${f2(C.lenX)}, |col 2| = ${f2(C.lenY)}, col 1·col 2 = ${f2(C.dot)}, det = ${f2(C.det)} → ${C.rotation ? 'rotation (RᵀR = I)' : 'not a rotation'}`
  },
  legend: [
    { color: AXIS_RGB[0], label: 'Column 1: where x = (1, 0) lands', shape: 'dot' },
    { color: AXIS_RGB[1], label: 'Column 2: where y = (0, 1) lands', shape: 'dot' },
    { color: HEAT, label: 'Unit square: area = det', shape: 'dot' },
    { color: RING, label: 'Robot outline carried by the matrix', shape: 'dot' },
  ],
  points: [
    'A 2×2 matrix is a machine that moves every point of the plane: p → M·p. The trick to reading one: M·(1, 0) is its first column and M·(0, 1) its second. So the columns are simply where the x and y axes land, and every other point comes along on the same grid.',
    'For a turn by θ the x axis lands at (cos θ, sin θ) and the y axis at (−sin θ, cos θ): that is R(θ) = [cos θ −sin θ; sin θ cos θ]. Sweep θ: the grid and the robot turn rigidly, and the plot shows the four entries are just cos and sin.',
    'What makes a matrix a rotation: both columns have length 1, they are at right angles (their Dot product is 0), and det = +1. Together that is RᵀR = I. Lengths, angles and areas all survive. Switch to stretch and the columns stop being unit length; switch to mirror and det flips to −1 (a reflection: the robot outline flips over).',
    'In 3D the rotation matrix is 3×3 and the same reading holds: its three columns are the robot\'s x, y and z axes written in world coordinates. That is exactly how Kinematics › Coordinate frames › 2D rotation and Homogeneous transforms use it; this lesson is just the operation.',
  ],
  controls: [angleSlider('th', 'Turn θ', -180, 180, 30), { kind: 'choice', key: 'mode', options: opts(namesOf(RM_MODES)), initial: 'rot' }],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = floorView(scene, RM.at, RM.k, -0.45)
    const grid = warpGrid(g, { half: 1, step: 0.25 })
    const square = parallelogram(g, HEAT, 0.2)
    const cols = COLS.map((c) => vecArrow(g, c, 0.016, 0.1))
    const arc = angleArc(g, 0.009, 0.1)

    const mx = matrixGrid(scene, [RM.mx, RM.plot.y, 0], 2, 2, { cell: 2.1, size: 0.52 })
    addLabel(scene, 'M', [RM.mx, RM.plot.y + 1.9, 0.2], LABEL, 0.46)
    const colTags = COLS.map((c, j) => {
      const l = liveLabel(scene, [RM.mx - 1.05 + j * 2.1, RM.plot.y - 1.6, 0.2], { size: 0.28 })
      l.set(`col ${j + 1}`, c)
      return l
    })
    const { x: px, w: pw, y: py, h: ph } = RM.plot
    const plot = titledScope(scene, py, ph, 'entries: cos θ, sin θ', LABEL, 0.5, px, pw)
    const cosTr = plot.s.trace(AXIS_RGB[0], { samples: 181, radius: 0.06 })
    const sinTr = plot.s.trace(AXIS_RGB[1], { samples: 181, radius: 0.06 })
    const rows = textRows(scene, 4, 1.2, -2.6)
    return {
      scene,
      view: VIEW,
      frame(_dt, p) {
        const { th, mode, M, C } = rmRun(p)
        grid.set(M, LABEL, C.rotation ? RING : HEAT)
        square.set([0, 0, 0.006], vec3(C.x, 0), vec3(C.y, 0))
        square.material.color.set(C.det < 0 ? HIGH_V : HEAT)
        square.material.emissive.set(C.det < 0 ? HIGH_V : HEAT)
        cols[0]([0, 0, 0.03], vec3(C.x, 0.03), 'col 1')
        cols[1]([0, 0, 0.03], vec3(C.y, 0.03), 'col 2')
        arc([0, 0, 0.03], [1, 0, 0], vec3(C.x, 0), 0.32, LABEL, 'θ')

        mx.set(M.map(f2), COLS)
        colTags.forEach((t, j) => t.set(`len ${f2(j ? C.lenY : C.lenX)}`, COLS[j]))
        const u = (th + 180) / 360
        cosTr.draw((v) => (Math.cos((v * 360 - 180) * DEG) * ph) / 2.3, u)
        sinTr.draw((v) => (Math.sin((v * 360 - 180) * DEG) * ph) / 2.3, u)
        plot.lo.set('−180°')
        plot.hi.set('+180°')
        plot.right.set(`now ${signed(th, 0)}°`, LABEL)
        rows[0].set(`col 1 = M·(1, 0) = ${pair(C.x)}, length ${f2(C.lenX)}`, AXIS_RGB[0])
        rows[1].set(`col 2 = M·(0, 1) = ${pair(C.y)}, length ${f2(C.lenY)}`, AXIS_RGB[1])
        rows[2].set(`col 1 · col 2 = ${f2(C.dot)}${Math.abs(C.dot) < 1e-6 ? ': at right angles' : ''}`, LABEL)
        rows[3].set(`det = ${fp(M[0])}·${fp(M[3])} − ${fp(M[1])}·${fp(M[2])} = ${f2(C.det)} · RᵀR ${C.orthonormal ? '= I' : '≠ I'}`, C.det < 0 ? HIGH_V : HEAT)
        head.status.set(`Rotation matrix · ${RM_MODES[mode].name} · θ ${dg(th * DEG)}`)
        head.sub.set('top view · grid every 0.25 · faint grid = before, bright grid = after M', GREY)
        head.event.set(rmVerdict(C), C.rotation ? POWER : HIGH_V)
      },
      readouts: (p) => {
        const { C } = rmRun(p)
        return [
          { label: 'Column lengths', value: `${f2(C.lenX)}, ${f2(C.lenY)}`, tone: toneOf(Math.abs(C.lenX - 1) < 1e-6 && Math.abs(C.lenY - 1) < 1e-6, false) },
          { label: 'col 1 · col 2', value: f2(C.dot), tone: toneOf(Math.abs(C.dot) < 1e-6, false) },
          { label: 'det (area scale)', value: f2(C.det), tone: toneOf(Math.abs(C.det - 1) < 1e-6, C.det > 0) },
          { label: 'A rotation?', value: C.rotation ? 'yes' : C.mirror ? 'no: mirror' : 'no: stretch', tone: C.rotation ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- Matrix multiply: A·B means "B first, then A"; each entry is a row · column dot product; order matters. ---

const MM_KINDS = {
  shear: { name: 'B = shear', B: (k: number) => shearMat2(k) },
  stretch: { name: 'B = stretch x', B: (k: number) => scaleMat2(1 + k, 1) },
  turn: { name: 'B = another turn', B: (k: number) => rotMat2(k) },
}
const ENTRIES = { '0': 'Entry row 1, col 1', '1': 'Entry row 1, col 2', '2': 'Entry row 2, col 1', '3': 'Entry row 2, col 2' }
const MM = { left: [-13.4, -3.4, 0] as V3, right: [-5.2, -3.4, 0] as V3, k: 3.3, y: 3.2, x: [2.4, 7.2, 12], cell: 1.8, size: 0.4 }
const mmRun = memoBy(
  (p: Params) => `${p.th} ${p.kind} ${p.k} ${p.entry}`,
  (p: Params) => {
    const th = n(p, 'th')
    const kind = pick(MM_KINDS, p.kind, 'shear')
    const k = n(p, 'k')
    const A = rotMat2(th * DEG)
    const B = MM_KINDS[kind].B(kind === 'turn' ? k * 60 * DEG : k)
    const e = Number(pick(ENTRIES, p.entry, '2'))
    const [i, j] = [Math.floor(e / 2) as 0 | 1, (e % 2) as 0 | 1]
    const V = composeView(A, B)
    return { th, kind, k, A, B, V, i, j, e, t: V.term(i, j) }
  },
)

export const matricesMatrixMultiply: Lesson = {
  id: 'matrices-matrix-multiply',
  title: 'Matrix multiply',
  tagline: 'Chain two moves into one matrix, and why the order matters',
  formula: (p) => {
    const { A, B, V, i, j, t } = mmRun(p)
    return `A·B: do B first, then A · (A·B)p = A(Bp) · entry (${i + 1}, ${j + 1}) = row ${i + 1} of A · col ${j + 1} of B = ${fp(t.row[0])}·${fp(t.col[0])} + ${fp(t.row[1])}·${fp(t.col[1])} = ${f2(t.value)} · A = ${mat2Text(A)}, B = ${mat2Text(B)} · A·B = ${mat2Text(V.AB)} ${V.commute ? '=' : '≠'} B·A = ${mat2Text(V.BA)}`
  },
  legend: [
    { color: HEAT, label: 'Row of A · column of B = one entry', shape: 'dot' },
    { color: RING, label: 'Robot outline after both moves', shape: 'dot' },
    { color: AXIS_RGB[0], label: 'Where the x axis lands', shape: 'dot' },
    { color: AXIS_RGB[1], label: 'Where the y axis lands', shape: 'dot' },
  ],
  points: [
    'Multiplying two matrices chains their moves into one. (A·B)·p = A·(B·p): B acts first, then A. Read a product right to left, the way the point travels. A is a turn by θ here; B is a shear, a stretch or a second turn.',
    'Each entry of A·B is a Dot product: row i of A with column j of B. Pick an entry and follow the orange row and column. Column j of the result is A applied to column j of B, so the columns of A·B are still where x and y finally land.',
    'Order matters: A·B ≠ B·A in general. Left panel: shear, then turn. Right panel: turn, then shear. Same two matrices, different robot. Two turns do commute (R(a)·R(b) = R(a + b)), and so does a uniform scale, but a stretch or a shear along fixed axes does not care which way the robot faces, so it lands differently.',
    'Robots chain frames this way all day: p_camera = T_camera←world · T_world←robot · p_robot. Each factor is one hop of the frame tree (Kinematics › Coordinate frames › Homogeneous transforms, Frame tree; Perception › Camera model › Pinhole model then multiplies by the intrinsics matrix K). Get the order wrong and the point ends up in the wrong place.',
  ],
  controls: [
    angleSlider('th', 'A: turn θ', -180, 180, 40),
    { kind: 'choice', key: 'kind', options: opts(namesOf(MM_KINDS)), initial: 'shear' },
    { kind: 'slider', key: 'k', label: 'B amount (shear k, stretch +k, turn k·60°)', min: -1, max: 1.5, step: 0.05, initial: 0.8, format: (v) => v.toFixed(2) },
    { kind: 'choice', key: 'entry', options: opts(ENTRIES), initial: '2' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const panels = [MM.left, MM.right].map((at, s) => {
      const g = floorView(scene, at, MM.k, -0.45)
      addLabel(scene, s ? 'B·A: A first, then B' : 'A·B: B first, then A', [at[0], at[1] + 5.7, 0.3], LABEL, 0.36)
      return { grid: warpGrid(g, { half: 1, step: 0.25, r: 0.012 }) }
    })
    const grids = MM.x.map((x) => matrixGrid(scene, [x, MM.y, 0], 2, 2, { cell: MM.cell, size: MM.size }))
    ;['A', 'B', 'A·B'].forEach((t, i) => addLabel(scene, t, [MM.x[i], MM.y + 1.5, 0.2], LABEL, 0.4))
    addLabel(scene, '·', [(MM.x[0] + MM.x[1]) / 2, MM.y, 0.2], LABEL, 0.6)
    addLabel(scene, '=', [(MM.x[1] + MM.x[2]) / 2, MM.y, 0.2], LABEL, 0.5)
    const rows = textRows(scene, 4, 0.4, -0.2, 0.32)
    return {
      scene,
      view: VIEW,
      frame(_dt, p) {
        const { th, kind, k, A, B, V, i, j, e, t } = mmRun(p)
        panels[0].grid.set(V.AB)
        panels[1].grid.set(V.BA, LABEL, V.commute ? RING : HEAT)
        const hi = (on: boolean) => (on ? HEAT : GREY)
        grids[0].set(A.map(f2), [0, 1, 2, 3].map((q) => hi(Math.floor(q / 2) === i)))
        grids[1].set(B.map(f2), [0, 1, 2, 3].map((q) => hi(q % 2 === j)))
        grids[2].set(V.AB.map(f2), [0, 1, 2, 3].map((q) => (q === e ? HEAT : LABEL)))
        rows[0].set(`row ${i + 1} of A · col ${j + 1} of B = ${fp(t.row[0])}·${fp(t.col[0])} + ${fp(t.row[1])}·${fp(t.col[1])} = ${f2(t.value)}`, HEAT)
        rows[1].set(`A·B = ${mat2Text(V.AB)}: x lands at ${pair(colOf2(V.AB, 0))}`, LABEL)
        rows[2].set(`B·A = ${mat2Text(V.BA)}: x lands at ${pair(colOf2(V.BA, 0))}`, LABEL)
        rows[3].set(V.commute ? 'A·B = B·A: these two commute' : `A·B ≠ B·A: biggest entry gap ${f2(V.gap)}`, V.commute ? POWER : HIGH_V)
        head.status.set(`Matrix multiply · A = turn ${dg(th * DEG)} · ${MM_KINDS[kind].name}${kind === 'turn' ? ` ${signed(k * 60, 0)}°` : ` k = ${f2(k)}`}`)
        head.sub.set('top views · faint grid = before, bright grid = after both moves · read products right to left', GREY)
        head.event.set(V.commute ? 'same result either way round' : 'same two matrices, different order, different robot', V.commute ? POWER : HIGH_V)
      },
      readouts: (p) => {
        const { V, i, j, t } = mmRun(p)
        return [
          { label: `(A·B) entry ${i + 1}, ${j + 1}`, value: f2(t.value) },
          { label: 'A·B', value: mat2Text(V.AB) },
          { label: 'B·A', value: mat2Text(V.BA) },
          { label: 'Commute?', value: V.commute ? 'yes' : `no (gap ${f2(V.gap)})`, tone: V.commute ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Inverse: M⁻¹ undoes M; for a rotation it is the transpose; det = area scale, and det 0 squashes the plane to a line with no way back. ---

const IV = { left: [-13.6, -3, 0] as V3, right: [-4.4, -3, 0] as V3, k: 3.5, y: 3.4, x: [5.2, 12.6], q: [0.5, 0.3] as const }
const ivRun = memoBy(
  (p: Params) => `${p.th} ${p.k} ${p.s}`,
  (p: Params) => {
    const [th, k, s] = [n(p, 'th'), n(p, 'k'), n(p, 's')]
    const M = mul2(rotMat2(th * DEG), [1, k, 0, s])
    const V = inverseView(M)
    const pw = apply2(M, IV.q)
    return { th, k, s, M, V, pw, back: V.inv ? apply2(V.inv, pw) : null }
  },
)

export const matricesInverse: Lesson = {
  id: 'matrices-inverse',
  title: 'Inverse',
  tagline: 'Undo a transform, and the matrices you can\'t undo',
  formula: (p) => {
    const { M, V, pw } = ivRun(p)
    return `M = R(θ)·[1 k; 0 s] = ${mat2Text(M)} · det = ad − bc = ${f2(V.det)} (area scale) · M⁻¹ = (1/det)·[d −b; −c a] = ${V.inv ? mat2Text(V.inv) : 'none: det = 0'} · p = M·q = ${pair(pw)} → q = M⁻¹·p · rotation: M⁻¹ = Mᵀ`
  },
  legend: [
    { color: RING, label: 'Robot outline and point q / p', shape: 'dot' },
    { color: HEAT, label: 'Unit square → area |det|', shape: 'dot' },
    { color: POWER, label: 'M⁻¹ brings p back to q', shape: 'dot' },
    { color: HIGH_V, label: 'Singular: a whole line lands on p', shape: 'dot' },
  ],
  points: [
    'The inverse M⁻¹ undoes M: if p = M·q then q = M⁻¹·p, and M·M⁻¹ = I. A robot uses it to bring a point seen in the world back into its own frame: "the charger is at (2, 1) in the room; where is that relative to me?"',
    'For a rotation the inverse is free: M⁻¹ = Mᵀ, just swap rows and columns, because the columns are unit length and at right angles (Rotation matrix). Set k = 0 and s = 1 to see it: M⁻¹ and Mᵀ match. For a full pose the translation is undone too: Kinematics › Coordinate frames › Homogeneous transforms.',
    'The determinant is the area scale: the unit square (orange) maps to a parallelogram of area |det|. Negative det means the plane flipped over. In 2D, M⁻¹ = (1/det)·[d −b; −c a], so dividing by det is the whole price, and it blows up as det → 0.',
    'At det = 0 (slide s to 0) the plane squashes onto a line. A whole line of points q (red, left) lands on the same p, so nothing can tell them apart: no inverse. Near it the inverse exists but is huge, so tiny errors in p become big errors in q.',
    'Robot arms hit this at singularities: the Jacobian loses its inverse and some hand directions need infinite joint speed (Kinematics › Jacobian › Singularities). When an exact inverse does not exist, Linear algebra › Least squares finds the best q anyway.',
  ],
  controls: [
    angleSlider('th', 'Turn θ', -180, 180, 30),
    { kind: 'slider', key: 'k', label: 'Shear k', min: -1, max: 1, step: 0.05, initial: 0.4, format: (v) => v.toFixed(2) },
    { kind: 'slider', key: 's', label: 'Stretch y, s (= det)', min: -1, max: 1.5, step: 0.05, initial: 0.7, format: (v) => v.toFixed(2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const [gl, gr] = [IV.left, IV.right].map((at) => floorView(scene, at, IV.k, -0.45))
    addLabel(scene, 'q: before (robot frame)', [IV.left[0], IV.left[1] + 5.2, 0.3], LABEL, 0.36)
    addLabel(scene, 'p = M·q: after (world)', [IV.right[0], IV.right[1] + 5.2, 0.3], LABEL, 0.36)
    warpGrid(gl, { r: 0.01 }).set(I2)
    const gridR = warpGrid(gr, { r: 0.01 })
    const square = parallelogram(gr, HEAT, 0.3)
    const dot = (g: THREE.Object3D, c: string) => add(g, mesh(new THREE.SphereGeometry(0.05, 16, 12), glowMat(c, 1.2)))
    const qBall = dot(gl, RING)
    qBall.position.set(IV.q[0], IV.q[1], 0.03)
    liveLabel(gl, [IV.q[0] + 0.14, IV.q[1] + 0.06, 0.03], { size: 0.13 }).set('q', RING)
    const pBall = dot(gr, RING)
    const pTag = liveLabel(gr, [0, 0, 0.03], { size: 0.13 })
    pTag.set('p', RING)
    const lost = dotLine(gl, 0.014, 50)
    const fwd = liveLabel(scene, [(IV.left[0] + IV.right[0]) / 2, IV.left[1] + 0.9, 0.3], { size: 0.4 })
    const bwd = liveLabel(scene, [(IV.left[0] + IV.right[0]) / 2, IV.left[1] - 0.9, 0.3], { size: 0.4 })
    fwd.set('M →', LABEL)
    const area = liveLabel(scene, [IV.right[0], IV.right[1] - 4.5, 0.3], { size: 0.3 })

    const [gm, gi] = IV.x.map((x) => matrixGrid(scene, [x, IV.y, 0], 2, 2, { cell: 1.8, size: 0.44 }))
    addLabel(scene, 'M', [IV.x[0], IV.y + 1.6, 0.2], LABEL, 0.42)
    addLabel(scene, 'M⁻¹', [IV.x[1], IV.y + 1.6, 0.2], POWER, 0.42)
    const rows = textRows(scene, 4, 1.4, -0.4)
    return {
      scene,
      view: VIEW,
      frame(_dt, p) {
        const { th, k, s, M, V, pw, back } = ivRun(p)
        gridR.set(M, LABEL, V.singular ? HIGH_V : RING)
        square.set([0, 0, 0.006], vec3(colOf2(M, 0), 0), vec3(colOf2(M, 1), 0))
        pBall.position.set(pw[0], pw[1], 0.03)
        pTag.group.position.set(pw[0] + 0.14, pw[1] + 0.06, 0.03)
        const L = V.singular ? 0.8 : 0
        lost([IV.q[0] - V.lost[0] * L, IV.q[1] - V.lost[1] * L, 0.03], [IV.q[0] + V.lost[0] * L, IV.q[1] + V.lost[1] * L, 0.03], V.singular ? HIGH_V : GREY)
        bwd.set(V.singular ? '← no M⁻¹' : '← M⁻¹', V.singular ? HIGH_V : POWER)
        area.set(`unit square → area ${f2(V.area)}${V.flips ? ', flipped' : ''}`, V.singular ? HIGH_V : HEAT)

        gm.set(M.map(f2), COLS)
        gi.set(V.inv ? V.inv.map(f2) : ['—', '—', '—', '—'], V.inv ? [POWER] : [HIGH_V])
        const Mt = transpose2(M)
        rows[0].set(`det = ${fp(M[0])}·${fp(M[3])} − ${fp(M[1])}·${fp(M[2])} = ${f2(V.det)}`, V.singular ? HIGH_V : HEAT)
        rows[1].set(back ? `M⁻¹·p = M⁻¹·${pair(pw)} = ${pair(back)} = q` : 'det = 0: the plane squashes onto a line', back ? POWER : HIGH_V)
        rows[2].set(V.check ? `M·M⁻¹ = ${mat2Text(V.check)} = I` : 'every point on the red line lands on p', V.check ? LABEL : HIGH_V)
        rows[3].set(V.isRotation ? `Mᵀ = ${mat2Text(Mt)} = M⁻¹: a rotation` : `Mᵀ = ${mat2Text(Mt)} ≠ M⁻¹: not a rotation`, V.isRotation ? POWER : GREY)
        head.status.set(`Inverse · turn ${dg(th * DEG)} · shear ${f2(k)} · stretch y ${f2(s)} · det ${f2(V.det)}`)
        head.sub.set('top views · q fixed at (0.50, 0.30) · faint grid = before, bright grid = after M', GREY)
        head.event.set(
          V.singular ? 'singular: no inverse, the plane is flattened to a line' : Math.abs(V.det) < 0.2 ? 'nearly singular: the inverse is huge' : V.isRotation ? 'a rotation: undo it with the transpose' : 'M⁻¹ carries p straight back to q',
          V.singular ? HIGH_V : Math.abs(V.det) < 0.2 ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const { V, back } = ivRun(p)
        const big = V.inv ? Math.max(...V.inv.map(Math.abs)) : Infinity
        return [
          { label: 'det (area scale)', value: f2(V.det), tone: toneOf(Math.abs(V.det) >= 0.2, !V.singular) },
          { label: 'Largest entry of M⁻¹', value: V.inv ? f2(big) : '∞', tone: toneOf(big < 5, !V.singular) },
          { label: 'q back from p', value: back ? pair(back) : 'lost' },
          { label: 'Inverse = transpose?', value: V.isRotation ? 'yes (rotation)' : 'no' },
        ]
      },
    }
  },
}
