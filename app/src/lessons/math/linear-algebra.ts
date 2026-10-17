import * as THREE from 'three/webgpu'
import { DEG, Mat2, V2, apply2, eigenView, leastSquaresView, mul2, rotMat2, scaleMat2, toDeg, turnOf, wallPca } from '../../core/physics'
import { fixedText, mat2Text, mpsText, pct, radText, signed, tupleText } from '../../core/units'
import { V3 } from '../../models/kit'
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
  addRod,
  angleArc,
  dotLine,
  floorView,
  glowMat,
  liveLabel,
  matrixGrid,
  memoBy,
  parallelogram,
  plotY,
  pointCloud,
  statusHeader,
  stretchArrow,
  stretchRod,
  textRows,
  titledScope,
  vecArrow,
  warpGrid,
  WIDE_VIEW,
  glowDot,
} from '../fx'
import { Lesson, Params, Stage, angleSlider, n, namesOf, opts, pick, toneOf } from '../types'

const f3 = (v: number) => fixedText(v, 3)

// --- Least squares: fit a motor calibration line through noisy readings; residual squares, normal equations, outliers. ---

const SLIPS = { '0': 'No slips', '1': 'One wheel slip', '2': 'Two wheel slips' }
const LS = { x: -7.8, y: -3.8, w: 17, h: 12.4, lo: -0.2, hi: 0.6, mx: [4, 8.9, 12.9], my: 3.3, sse: { x: 9, y: -6.4, w: 11.6, h: 4.6 }, span: 0.4 }
const lsRun = memoBy(
  (p: Params) => `${p.nudge} ${p.sigma} ${p.slips}`,
  (p: Params) => {
    const nudge = n(p, 'nudge')
    const sigma = n(p, 'sigma') / 100
    const slips = Number(pick(SLIPS, p.slips, '1'))
    return { nudge, sigma, slips, V: leastSquaresView(sigma, slips, nudge) }
  },
)

export const linearAlgebraLeastSquares: Lesson = {
  id: 'linear-algebra-least-squares',
  title: 'Least squares',
  tagline: 'Nine readings, two unknowns: the line that makes the squared misses smallest',
  formula: (p) => {
    const { V } = lsRun(p)
    const { AtA, Atb, m, c } = V.fit
    return `model v = m·d + c · one row [d 1] per reading: A·[m c]ᵀ ≈ b (9 equations, 2 unknowns) · minimise Σr² = |b − A·x|² · normal equations AᵀA·x = Aᵀb: [Σd² Σd; Σd N] = ${mat2Text(AtA)}, [Σdv; Σv] = ${tupleText(Atb)} → m = ${f3(m)} m/s, c = ${f3(c)} m/s · your line Σr² = ${f3(V.sse)} vs best ${f3(V.best)}`
  },
  legend: [
    { color: LABEL, label: 'Readings (red: wheel slipped)', shape: 'dot' },
    { color: RING, label: 'Your line (tilt it)', shape: 'dot' },
    { color: HEAT, label: 'Residuals r, squares r²', shape: 'dot' },
    { color: POWER, label: 'Best fit (blue: no slips)', shape: 'dot' },
  ],
  points: [
    'Calibrating a motor: drive it at nine duty cycles and read the wheel speed off the encoder. The readings never sit on one line, so which line? Each reading misses a line by a residual r (orange stick). Least squares picks the line that makes the sum of r² smallest, drawn here literally as orange squares. Tilt your line: the squares grow whichever way you go, and the parabola on the right has exactly one bottom.',
    'As matrices: every reading is one equation m·d + c = v. Nine equations, two unknowns, so A·x = b has no exact answer (A is 9×2: no inverse, see Matrices › Inverse). Multiply both sides by Aᵀ and it collapses to the 2×2 normal equations AᵀA·x = Aᵀb, built from four sums, solved with the 2×2 inverse. The best line always runs through the mean point.',
    'Squaring punishes big misses hardest. One slipped wheel gives a reading whose square dwarfs the rest, and it drags the whole line down (green vs blue, the fit without the slips). Least squares is the right tool when the noise is Gaussian (Probability › Gaussian noise); throw out outliers first, by a residual threshold or RANSAC, or down-weight them.',
    'The fitted line is the motor model: c/m gives the deadband (no motion below it) and m the speed per duty, which is exactly what Control › Speed control › Feed-forward needs. The same machinery, bigger: Perception › Camera model › Calibration fits a homography to many corners, Sensors › Magnetometer › Hard-iron calibration fits an offset, Localization › Scan matching (ICP) solves a small least squares each step, and SLAM › Pose graphs is one huge least squares over every pose.',
  ],
  controls: [
    { kind: 'slider', key: 'nudge', label: 'Tilt your line (slope − best, m/s)', min: -LS.span, max: LS.span, step: 0.01, initial: 0.15, format: (v) => signed(v, 2) },
    { kind: 'slider', key: 'sigma', label: 'Encoder noise σ (cm/s)', min: 0, max: 6, step: 0.5, initial: 2, format: (v) => `${v.toFixed(1)} cm/s` },
    { kind: 'choice', key: 'slips', options: opts(SLIPS), initial: '1' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const plot = titledScope(scene, LS.y, LS.h, 'wheel speed v vs duty d', LABEL, 0.25, LS.x, LS.w)
    const g = plot.s.group
    const [px, py] = [(d: number) => -LS.w / 2 + d * LS.w, plotY(LS.lo, LS.hi, LS.h)]
    const clean = plot.s.trace(B_FIELD, { samples: 2, radius: 0.05 })
    const best = plot.s.trace(POWER, { samples: 2, radius: 0.06 })
    const yours = plot.s.trace(RING, { samples: 2, radius: 0.08 })
    const dots = pointCloud(g, 9, 0.2)
    const stickM = glowMat(HEAT, 1)
    const sticks = Array.from({ length: 9 }, () => addRod(g, stickM))
    const squares = Array.from({ length: 9 }, () => parallelogram(g, HEAT, 0.28))
    const centre = glowDot(g, 0.16, POWER)
    const meanTag = liveLabel(g, [0, 0, 0.4], { size: 0.26 })
    ;[0, 0.5, 1].forEach((d) => addLabel(scene, `${d * 100} %`, [LS.x + px(d), LS.y - LS.h / 2 - 0.9, 0.3], GREY, 0.26))
    ;[0, 0.4].forEach((v) => addLabel(scene, `${v} m/s`, [LS.x - LS.w / 2 - 0.5, LS.y + py(v), 0.3], GREY, 0.24, 'right'))

    const grids = [matrixGrid(scene, [LS.mx[0], LS.my, 0], 2, 2, { cell: 1.9, size: 0.36 }), matrixGrid(scene, [LS.mx[1], LS.my, 0], 2, 1, { cell: 1.6, size: 0.36 }), matrixGrid(scene, [LS.mx[2], LS.my, 0], 2, 1, { cell: 1.6, size: 0.36 })]
    ;['AᵀA', 'x = [m c]ᵀ', 'Aᵀb'].forEach((t, i) => addLabel(scene, t, [LS.mx[i], LS.my + 1.4, 0.2], LABEL, 0.34))
    addLabel(scene, '·', [(LS.mx[0] + LS.mx[1]) / 2 + 0.3, LS.my, 0.2], LABEL, 0.5)
    addLabel(scene, '=', [(LS.mx[1] + LS.mx[2]) / 2, LS.my, 0.2], LABEL, 0.45)
    const rows = textRows(scene, 4, 2.4, 1.3, 0.32, 0.75)
    const { x: sx, y: sy, w: sw, h: sh } = LS.sse
    const sse = titledScope(scene, sy, sh, 'Σr² vs slope', HEAT, 0, sx, sw)
    const curve = sse.s.trace(HEAT, { samples: 81, radius: 0.06 })
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { nudge, sigma, slips, V } = lsRun(p)
        const line = (tr: typeof yours, m: number, c: number) => tr.points([0, 1], [py(c), py(m + c)], null)
        line(yours, V.trial.m, V.trial.c)
        line(best, V.fit.m, V.fit.c)
        clean.group.visible = slips > 0
        line(clean, V.clean.m, V.clean.c)
        V.xs.forEach((d, i) => {
          const [x, y, yl] = [px(d), py(V.ys[i]), py(V.ys[i] - V.residuals[i])]
          dots.set(i, [x, y, 0.45], V.bad.includes(i) ? HIGH_V : LABEL)
          stretchRod(sticks[i], [x, y, 0.35], [x, yl, 0.35], 0.05)
          squares[i].set([x, yl, 0.3], [0, y - yl, 0], [-Math.abs(y - yl), 0, 0])
        })
        dots.show(9)
        const [cx, cy] = [px(V.centroid[0]), py(V.centroid[1])]
        centre.position.set(cx, cy, 0.5)
        meanTag.group.position.set(cx + 0.5, cy - 0.5, 0.5)
        meanTag.set('mean', POWER)

        const { AtA, Atb, m, c } = V.fit
        grids[0].set(AtA.map((x) => fixedText(x)), [LABEL])
        grids[1].set([f3(m), f3(c)], [POWER])
        grids[2].set(Atb.map((x) => fixedText(x)), [LABEL])
        rows[0].set(`Σd² ${fixedText(AtA[0])}, Σd ${fixedText(AtA[1])}, N ${AtA[3]}, Σdv ${fixedText(Atb[0])}, Σv ${fixedText(Atb[1])}`, GREY)
        rows[1].set(`best v = ${f3(m)}·d ${c < 0 ? '−' : '+'} ${f3(Math.abs(c))} · moves above ${pct(V.deadband)}`, POWER)
        rows[2].set(slips ? `slips pull m by ${signed(V.pull, 3)} (blue: without)` : 'no slips: every reading fair', slips ? HIGH_V : LABEL)
        rows[3].set(`yours Σr² ${f3(V.sse)} = best ${f3(V.best)}${V.sse - V.best < 5e-4 ? '' : ` + ${f3(V.sse - V.best)}`}`, Math.abs(nudge) < 0.005 ? POWER : RING)

        const top = V.sseAt(V.fit.m + LS.span) * 1.05
        const yS = plotY(0, top, sh)
        curve.draw((u) => yS(V.sseAt(V.fit.m + (u * 2 - 1) * LS.span)), (nudge + LS.span) / (2 * LS.span))
        sse.lo.set(`m ${fixedText(V.fit.m - LS.span)}`)
        sse.hi.set(`${fixedText(V.fit.m + LS.span)} m/s`)
        sse.right.set(`now ${f3(V.sse)}`, Math.abs(nudge) < 0.005 ? POWER : RING)
        head.status.set(`Least squares · noise σ ${(sigma * 100).toFixed(1)} cm/s · ${SLIPS[String(slips) as keyof typeof SLIPS]}`)
        head.sub.set('9 calibration runs · x: PWM duty, y: wheel speed · squares drawn to scale', GREY)
        head.event.set(
          Math.abs(nudge) < 0.005 ? 'at the bottom: no other line has smaller squares' : `tilted ${signed(nudge, 2)}: the squares add ${f3(V.sse - V.best)}`,
          Math.abs(nudge) < 0.005 ? POWER : RING,
        )
      },
      readouts: (p) => {
        const { nudge, V } = lsRun(p)
        return [
          { label: 'Slope m (speed per duty)', value: mpsText(V.fit.m, 3) },
          { label: 'Deadband d = −c/m', value: pct(V.deadband) },
          { label: 'Your Σr² vs best', value: `${f3(V.sse)} vs ${f3(V.best)}`, tone: toneOf(Math.abs(nudge) < 0.005, Math.abs(nudge) < 0.1) },
          { label: 'Pull from slips', value: signed(V.pull, 3), tone: toneOf(Math.abs(V.pull) < 0.02, Math.abs(V.pull) < 0.06) },
        ]
      },
    }
  },
}

// --- Eigenvectors: a 2×2 acting on the unit circle; most arrows turn, eigen-directions only stretch by λ. ---

const EV_MODES = {
  sym: { name: 'Symmetric stretch', M: () => mul2(mul2(rotMat2(30 * DEG), scaleMat2(1.5, 0.5)), rotMat2(-30 * DEG)) },
  shear: { name: 'Shear + squash', M: (): Mat2 => [1.3, 0.5, 0, 0.6] },
  turn: { name: 'Turn 35° (no real λ)', M: () => rotMat2(35 * DEG) },
  wall: { name: 'Lidar wall covariance (PCA)', M: () => wallM() },
}
const WALL_DEG = 25
const wallScan = wallPca(WALL_DEG * DEG)
const wallM = (): Mat2 => wallScan.cov.map((v) => (v / wallScan.values[0]) * 1.5) as Mat2
const EV = { at: [-8.8, -3.6, 0] as V3, k: 4.4, tilt: -0.35, fan: 12, ring: 72, iter: 10, mx: 4.6, my: 3.3, plot: { x: 9, y: -6.4, w: 11.6, h: 4.6 } }
const EIG_COLORS = [POWER, B_FIELD]
const turnColor = (turn: number) => new THREE.Color(POWER).lerp(new THREE.Color('#5a606c'), Math.min(1, Math.abs(turn) / (12 * DEG)))
const evRun = memoBy(
  (p: Params) => `${p.phi} ${p.mode} ${p.s}`,
  (p: Params) => {
    const phi = n(p, 'phi') * DEG
    const mode = pick(EV_MODES, p.mode, 'sym')
    const s = n(p, 's')
    const M = EV_MODES[mode].M().map((v) => v * s) as Mat2
    return { phi, mode, s, M, V: eigenView(M, phi, EV.iter) }
  },
)
const lamText = (V: ReturnType<typeof eigenView>) => (V.E.real ? V.E.values.map((x) => fixedText(x)).join(', ') : `${fixedText(V.E.re)} ± ${fixedText(V.E.im)}i`)

export const linearAlgebraEigenvectors: Lesson = {
  id: 'linear-algebra-eigenvectors',
  title: 'Eigenvectors',
  tagline: 'The directions a matrix only stretches, and what the stretch λ tells a robot',
  formula: (p) => {
    const { M, V } = evRun(p)
    return `M·v = λ·v: v keeps its direction, only scaled by λ · det(M − λI) = 0 → λ² − (a + d)λ + (ad − bc) = 0 · M = ${mat2Text(M)} · λ = ${lamText(V)}${V.E.real ? ` · v1 = ${tupleText(V.E.vectors[0])}, v2 = ${tupleText(V.E.vectors[1])}` : ''} · x(k+1) = M·x(k) is stable when every |λ| < 1: max |λ| = ${fixedText(V.growth)}`
  },
  legend: [
    { color: RING, label: 'Probe v (orange: M·v)', shape: 'dot' },
    { color: POWER, label: 'Eigen-direction 1: no turn', shape: 'dot' },
    { color: B_FIELD, label: 'Eigen-direction 2', shape: 'dot' },
    { color: HEAT, label: 'Repeat: x, M·x, M²·x, …', shape: 'dot' },
  ],
  points: [
    'A matrix moves every arrow (Matrices › Rotation matrix): the unit circle becomes an ellipse and almost every arrow turns on the way. A few special directions do not turn at all, they only get longer or shorter: M·v = λ·v. Those v are the eigenvectors and the stretch factors λ are the eigenvalues. Sweep the probe: the turn plot crosses zero exactly at the eigen-directions, and the arrows there light up green.',
    'Finding them: M·v = λ·v means (M − λI)·v = 0 has a non-zero answer, so M − λI must be singular, det(M − λI) = 0 (Matrices › Inverse). For a 2×2 that is a quadratic in λ: λ² − trace·λ + det = 0. A symmetric matrix always has real λ and perpendicular eigenvectors; a shear has real λ but slanted directions; a pure turn has none at all (complex λ), because every arrow turns.',
    'Repeat M again and again and the orange dots line up with the biggest-|λ| direction, growing by λ1 each step. That is the stability test of a linear system: x(k+1) = M·x(k) dies away when every |λ| < 1 and blows up when any |λ| > 1. Slide s across 1. For continuous ẋ = A·x the test is Re λ < 0: those λ are the poles in Control › Stability › Poles and damping, and LQR (State-space & LQR) picks the gains that place them.',
    'The lidar wall: the covariance matrix Σ of its hits (Probability › Variance) is symmetric, its top eigenvector points along the wall and its λs are the spread along and across (σ²). That is PCA, and it finds a wall direction or a line segment in a scan without fitting angles one by one; the same ellipse is the uncertainty ellipse of a pose in Localization.',
  ],
  controls: [
    angleSlider('phi', 'Probe direction φ', 0, 180, 70),
    { kind: 'choice', key: 'mode', options: opts(namesOf(EV_MODES)), initial: 'sym' },
    { kind: 'slider', key: 's', label: 'Scale s (all λ × s)', min: 0.4, max: 1.4, step: 0.02, initial: 1, format: (v) => `${v.toFixed(2)}×` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = floorView(scene, EV.at, EV.k, EV.tilt)
    const grid = warpGrid(g, { half: 1, step: 0.25, r: 0.006, outline: [] })
    const circle = pointCloud(g, EV.ring, 0.014)
    for (let i = 0; i < EV.ring; i++) circle.set(i, [Math.cos((i / EV.ring) * 2 * Math.PI), Math.sin((i / EV.ring) * 2 * Math.PI), 0.02], GREY)
    circle.show(EV.ring)
    const ellipse = pointCloud(g, EV.ring, 0.03)
    const spokes = Array.from({ length: EV.fan }, () => dotLine(g, 0.008, 14))
    const fan = Array.from({ length: EV.fan }, () => stretchArrow(g, GREY, 0.012))
    const eigLines = EIG_COLORS.map(() => dotLine(g, 0.014, 60))
    const eigTags = EIG_COLORS.map(() => liveLabel(g, [0, 0, 0.05], { size: 0.12 }))
    const cloud = pointCloud(g, wallScan.pts.length, 0.025)
    const vArrow = vecArrow(g, RING, 0.02, 0.12)
    const wArrow = vecArrow(g, HEAT, 0.024, 0.12)
    const arc = angleArc(g, 0.01, 0.1)
    const trail = pointCloud(g, EV.iter + 1, 0.035)

    const mx = matrixGrid(scene, [EV.mx, EV.my, 0], 2, 2, { cell: 2, size: 0.44 })
    addLabel(scene, 'M', [EV.mx, EV.my + 1.6, 0.2], LABEL, 0.42)
    const lam = [0, 1].map((i) => liveLabel(scene, [8.2, EV.my + 0.45 - i * 0.9, 0.2], { size: 0.32, align: 'left' }))
    const rows = textRows(scene, 4, 2.4, 1.1, 0.32, 0.75)
    const { x: px, y: py, w: pw, h: ph } = EV.plot
    const plot = titledScope(scene, py, ph, 'turn of M·v vs φ (0 = eigen)', LABEL, 0.5, px, pw)
    const turnTr = plot.s.trace(RING, { samples: 121, radius: 0.06 })
    const marks = EIG_COLORS.map((c) => plot.s.trace(c, { samples: 2, radius: 0.05 }))
    const yT = plotY(-60, 60, ph)
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { phi, mode, s, M, V } = evRun(p)
        const z = (q: V2, h: number): V3 => [q[0], q[1], h]
        grid.set(M, '#5a606c', RING)
        for (let i = 0; i < EV.ring; i++) {
          const a = (i / EV.ring) * 2 * Math.PI
          const w = apply2(M, [Math.cos(a), Math.sin(a)])
          const turn = Math.atan2(Math.cos(a) * w[1] - Math.sin(a) * w[0], Math.cos(a) * w[0] + Math.sin(a) * w[1])
          ellipse.set(i, [w[0], w[1], 0.03], turnColor(turn))
        }
        ellipse.show(EV.ring)
        fan.forEach((draw, i) => {
          const a = (i / EV.fan) * 2 * Math.PI
          const v: V2 = [Math.cos(a), Math.sin(a)]
          const w = apply2(M, v)
          const turn = Math.atan2(v[0] * w[1] - v[1] * w[0], v[0] * w[0] + v[1] * w[1])
          spokes[i]([0, 0, 0.02], z(v, 0.02), '#4a505c')
          draw([0, 0, 0.025], z(w, 0.025), `#${turnColor(turn).getHexString()}`)
        })
        eigLines.forEach((line, i) => {
          const v = V.E.vectors[i]
          const show = V.E.real && !!v
          eigTags[i].group.visible = show
          if (!show) return line([0, 0, 0], [0, 0, 0], GREY)
          const L = Math.max(1.2, Math.abs(V.E.values[i]) + 0.25)
          line(z([-v[0] * L, -v[1] * L], 0.04), z([v[0] * L, v[1] * L], 0.04), EIG_COLORS[i])
          eigTags[i].group.position.set(v[0] * (L + 0.22), v[1] * (L + 0.22) + (i ? -0.1 : 0.1), 0.05)
          eigTags[i].set(`λ${i + 1} ${fixedText(V.E.values[i])}`, EIG_COLORS[i])
        })
        const wall = mode === 'wall'
        cloud.show(wall ? wallScan.pts.length : 0)
        if (wall) wallScan.pts.forEach((q, i) => cloud.set(i, [(q[0] - wallScan.mean[0]) / 0.6, (q[1] - wallScan.mean[1]) / 0.6, 0.05], LABEL))
        const { v, w, turn, stretch } = V.probe
        vArrow([0, 0, 0.06], z(v, 0.06), 'v')
        wArrow([0, 0, 0.07], z(w, 0.07), 'M·v')
        arc([0, 0, 0.07], z(v, 0), z(w, 0), 0.35, HEAT, '')
        const pts = V.iterates.filter((q) => Math.hypot(...q) < 2.2)
        pts.forEach((q, i) => trail.set(i, z(q, 0.08), HEAT, 1 - (0.5 * i) / EV.iter))
        trail.show(pts.length)

        mx.set(M.map((x) => fixedText(x)), [LABEL])
        lam.forEach((l, i) =>
          V.E.real ? l.set(`λ${i + 1} ${fixedText(V.E.values[i])}, v${i + 1} ${tupleText(V.E.vectors[i])}`, EIG_COLORS[i]) : l.set(i ? `|λ| ${fixedText(V.E.radius)}, ${radText(Math.atan2(V.E.im, V.E.re))} a step` : `λ = ${fixedText(V.E.re)} ± ${fixedText(V.E.im)}i`, HIGH_V),
        )
        rows[0].set(`λ² − ${fixedText(V.E.tr)}λ + ${fixedText(V.E.det)} = 0 (trace, det)`, GREY)
        rows[1].set(`probe φ ${radText(phi)}: turns ${signed(toDeg(turn), 1)}°, stretch ${fixedText(stretch)}`, Math.abs(turn) < 1 * DEG ? POWER : RING)
        rows[2].set(`repeat M: max |λ| ${fixedText(V.growth)} ${V.stable ? '< 1: stable' : '≥ 1: unstable'}`, V.stable ? POWER : HIGH_V)
        rows[3].set(wall ? `wall ${WALL_DEG}°: v1 says ${radText(wallScan.fitted)}, σ ${fixedText(wallScan.along)} / ${f3(wallScan.across)} m` : V.E.real ? (Math.abs(V.E.vectors[0][0] * V.E.vectors[1][0] + V.E.vectors[0][1] * V.E.vectors[1][1]) < 1e-6 ? 'v1, v2 at right angles (symmetric)' : 'v1, v2 slanted (not symmetric)') : 'complex λ: every arrow turns', wall ? POWER : LABEL)

        turnTr.draw((u) => yT(toDeg(turnOf(M, u * Math.PI).turn)), toDeg(phi) / 180)
        marks.forEach((mk, i) => {
          const a = V.eigenAngles[i]
          mk.group.visible = a !== undefined
          if (a !== undefined) mk.points([a / Math.PI, a / Math.PI], [-ph / 2, ph / 2], null)
        })
        plot.lo.set('φ 0°')
        plot.hi.set('180°')
        plot.right.set(`now ${signed(toDeg(turn), 0)}°`, Math.abs(turn) < 1 * DEG ? POWER : RING)
        head.status.set(`Eigenvectors · ${EV_MODES[mode].name} · s ${fixedText(s)} · λ ${lamText(V)}`)
        head.sub.set('top view · grey circle → coloured ellipse = M·(unit circle) · green = no turn', GREY)
        head.event.set(
          Math.abs(turn) < 1 * DEG ? `on an eigenvector: M·v = ${fixedText(stretch * Math.sign(Math.cos(turn)))}·v, no turn` : V.E.real ? `off by ${radText(V.nearest)} from an eigen-direction: M turns it ${signed(toDeg(turn), 0)}°` : 'no real eigenvector: every arrow turns',
          Math.abs(turn) < 1 * DEG ? POWER : V.E.real ? RING : HIGH_V,
        )
      },
      readouts: (p) => {
        const { V } = evRun(p)
        return [
          { label: 'λ1, λ2', value: lamText(V) },
          { label: 'Probe turn', value: `${signed(toDeg(V.probe.turn), 1)}°`, tone: toneOf(Math.abs(V.probe.turn) < 1 * DEG, Math.abs(V.probe.turn) < 10 * DEG) },
          { label: 'Max |λ|', value: fixedText(V.growth), tone: V.stable ? 'ok' : 'bad' },
          { label: 'Repeat M', value: V.stable ? 'stable: dies away' : 'unstable: grows', tone: V.stable ? 'ok' : 'bad' },
        ]
      },
    }
  },
}
