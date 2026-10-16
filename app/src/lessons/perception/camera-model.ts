import * as THREE from 'three/webgpu'
import {
  Ball, Intrinsics, LENSES, Lens, Mat4, NO_LENS, P3, apply4, boardPoints, boardShots, boardViews, calibrate, camTf, depthFromDisparity, depthStep, groundHit, groundSpan,
  inImage, intrinsicsOf, invert4, lensFor, matchDisparity, mul4, pixelRay, projectPx, renderView, cropK, stereoRig, toPixel,
} from '../../core/physics'
import { V3, add, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  AXIS_RGB, B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, camBody, flatBox, frameTriad, glowMat, histChart, liveLabel, matrixGrid, memoBy, pixelGrid, ringMarks, rodPool, setTf, showImg, statusHeader, zUp,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const f0 = (v: number) => v.toFixed(0)
const f1 = (v: number) => v.toFixed(1)
const f2 = (v: number) => v.toFixed(2)
const f3 = (v: number) => v.toFixed(3)
const cm = (m: number) => (m === Infinity ? '∞' : m >= 1 ? `${f2(m)} m` : m >= 0.01 ? `${f1(m * 100)} cm` : `${f1(m * 1000)} mm`)
const DEG = Math.PI / 180

/** Frustum rods: optical centre → the 4 image corners at depth `s`, plus the image rectangle; uses rods i…i+7. */
function frustum(pool: ReturnType<typeof rodPool>, i: number, k: Intrinsics, Twc: Mat4, s: number, r: number, color: string) {
  const o: V3 = [Twc[3], Twc[7], Twc[11]]
  const c = [[-0.5, -0.5], [k.w - 0.5, -0.5], [k.w - 0.5, k.h - 0.5], [-0.5, k.h - 0.5]].map(([u, v]) => apply4(Twc, [((u - k.cx) / k.fx) * s, ((v - k.cy) / k.fy) * s, s]) as V3)
  c.forEach((p, j) => {
    pool.set(i + j, o, p, r * 0.6, color)
    pool.set(i + 4 + j, p, c[(j + 1) % 4], r, color)
  })
}

/** Point on the image plane (depth `s`) where pixel (u, v) sits. */
const onPlane = (k: Intrinsics, Twc: Mat4, s: number, u: number, v: number) => apply4(Twc, [((u - k.cx) / k.fx) * s, ((v - k.cy) / k.fy) * s, s]) as V3

/** Pixel (u, v) of a w × h camera → centre of the shown grid cell (cols × rows). */
function gridAt(cell: (c: number, r: number) => V3, k: Intrinsics, cols: number, rows: number, u: number, v: number, lift = 0.15): V3 {
  const [x, y] = [((u + 0.5) * cols) / k.w - 0.5, ((v + 0.5) * rows) / k.h - 0.5]
  const [a, b] = [cell(0, 0), cell(1, 1)]
  return [a[0] + x * (b[0] - a[0]), a[1] + y * (b[1] - a[1]), a[2] + lift]
}

const FLOOR = { tile: 0.25, a: [118, 112, 100] as [number, number, number], b: [70, 74, 82] as [number, number, number] }
const DARK_TILE = '#464a52'
const LIGHT_TILE = '#767064'

/** 3D floor tiles matching the renderer's checker. */
function floorTiles(g: THREE.Object3D, x: [number, number], y: [number, number], tile: number) {
  for (let i = Math.floor(x[0] / tile); i < Math.ceil(x[1] / tile); i++)
    for (let j = Math.floor(y[0] / tile); j < Math.ceil(y[1] / tile); j++)
      flatBox(g, [tile, tile, 0.004], mat((i + j) % 2 !== 0 ? DARK_TILE : LIGHT_TILE, { rough: 0.85 }), [(i + 0.5) * tile, (j + 0.5) * tile, -0.002])
}

// --- Pinhole model: K and [R|t] take a floor scene to pixels; back-projected pixels hit the floor. ---

const QVGA = { w: 320, h: 240 }
const PIN = { at: [-12.4, -3.0, 0] as V3, k: 9.4, x: [0, 1.5] as [number, number], y: [-0.5, 0.5] as [number, number], cols: 48, rows: 36, pitch: 0.2, img: [7.4, 0.3, 0] as V3, plane: 0.22, mx: [7.4, -5.5, 0] as V3 }
const BALLS = { red: 'Red ball', green: 'Green ball', blue: 'Blue ball', yellow: 'Yellow ball' }
const PIN_BALLS: Record<keyof typeof BALLS, Ball> = {
  red: { c: [0.62, 0.16, 0.04], r: 0.04, rgb: [215, 45, 35] },
  green: { c: [0.95, -0.24, 0.04], r: 0.04, rgb: [60, 190, 80] },
  blue: { c: [1.3, 0.3, 0.04], r: 0.04, rgb: [60, 110, 230] },
  yellow: { c: [0.38, -0.1, 0.04], r: 0.04, rgb: [235, 205, 50] },
}
const BALL_KEYS = Object.keys(BALLS) as (keyof typeof BALLS)[]
const hex = (c: readonly number[]) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`

const pinKey = (p: Params) => ['fov', 'tilt', 'height', 'ball'].map((k) => p[k]).join('|')
const pinParams = memoBy(pinKey, (p: Params) => {
  const fov = n(p, 'fov')
  const tilt = n(p, 'tilt') * DEG
  const h = n(p, 'height')
  const ball = pick(BALLS, p.ball, 'red')
  const k = intrinsicsOf(QVGA.w, QVGA.h, fov)
  const Twc = camTf([0, 0, h], 0, tilt)
  const img = renderView(k, Twc, { floor: { ...FLOOR, x: PIN.x, y: PIN.y }, balls: Object.values(PIN_BALLS) }, PIN.cols, PIN.rows, NO_LENS, 2)
  const px = Object.fromEntries(BALL_KEYS.map((b) => [b, projectPx(k, Twc, PIN_BALLS[b].c)])) as Record<keyof typeof BALLS, [number, number, number]>
  const pc = apply4(invert4(Twc), PIN_BALLS[ball].c)
  const edge: (V3 | null)[] = []
  const N = 10
  for (let s = 0; s < 4 * N; s++) {
    const e = s % N / N
    const side = Math.floor(s / N)
    const [u, v] = [[e, 0], [1, e], [1 - e, 1], [0, 1 - e]][side].map((t, i) => t * (i ? k.h : k.w) - 0.5)
    const hit = groundHit(pixelRay(k, Twc, u, v))
    edge.push(hit && hit[0] >= PIN.x[0] && hit[0] <= PIN.x[1] && hit[1] >= PIN.y[0] && hit[1] <= PIN.y[1] ? (hit as V3) : null)
  }
  return { fov, tilt, h, ball, k, Twc, img, px, pc, edge, span: groundSpan(k, h, tilt) }
})

export const cameraModelPinholeModel: Lesson = {
  id: 'camera-model-pinhole-model',
  title: 'Pinhole model',
  tagline: 'Every pixel is a ray through one point. K turns a ray into a pixel, [R|t] says where the camera sits; run it backwards and a pixel on the floor becomes a distance',
  formula: (p) => {
    const S = pinParams(p)
    const [x, y, z] = S.pc
    const [u, v] = S.px[S.ball]
    return `p_cam = R·p + t = (${f2(x)}, ${f2(y)}, ${f2(z)}) m · u = fx·x/z + cx = ${f0(S.k.fx)}·${f2(x / z)} + ${S.k.cx} = ${f0(u)} px · v = fy·y/z + cy = ${f0(v)} px · fx = (W/2)/tan(FOV/2) = 160/tan(${S.fov / 2}°)`
  },
  legend: [
    { color: AXIS_RGB[2], label: 'Camera axes: x right, y down, z forward', shape: 'dot' },
    { color: RING, label: 'Image plane and field of view', shape: 'dot' },
    { color: B_FIELD, label: 'What the image covers on the floor', shape: 'dot' },
    { color: HEAT, label: 'Horizon row (rays above it never hit the floor)', shape: 'dot' },
  ],
  points: [
    'A pinhole camera sends each scene point along a straight ray through one point, the optical centre, onto the image plane. Divide by depth: x/z, y/z. Far things shrink, and depth is lost.',
    'Intrinsics K = [fx 0 cx; 0 fy cy; 0 0 1] turn x/z, y/z into pixels: fx is the focal length in pixels, (cx, cy) the image centre. fx = (W/2)/tan(FOV/2): a wider lens means a smaller fx and fewer pixels per degree.',
    'Extrinsics [R|t] say where the camera sits on the robot: the same 4×4 transform as in Kinematics → Coordinate frames, with the camera\'s own axes (z forward, y down) instead of the robot\'s.',
    'Back-projection runs it in reverse: pixel → K⁻¹ → a ray, not a point. On a flat floor the ray ends where it meets z = 0, so a downward-tilted robot camera can read floor distance straight off the image row: d = h / tan(tilt + angle below the centre).',
    'Rows near the horizon are a long way off and one pixel there spans many centimetres; rows near the bottom are close and precise. Lift the camera or tilt it down to trade range for precision. The image itself is the same grid of pixels as in Image basics.',
  ],
  controls: [
    { kind: 'choice', key: 'ball', options: opts(BALLS), initial: 'red' },
    { kind: 'slider', key: 'fov', label: 'Horizontal field of view', min: 40, max: 120, step: 2, initial: 66, format: (v) => `${v}°` },
    { kind: 'slider', key: 'tilt', label: 'Camera tilt down', min: 0, max: 60, step: 1, initial: 20, format: (v) => `${v}°` },
    { kind: 'slider', key: 'height', label: 'Camera height', min: 0.05, max: 0.4, step: 0.01, initial: 0.12, format: (v) => `${Math.round(v * 100)} cm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = zUp(scene, PIN.at, PIN.k, 0.62, -0.3)
    floorTiles(g, PIN.x, PIN.y, FLOOR.tile)
    const balls = BALL_KEYS.map((b) => {
      const s = add(g, mesh(new THREE.SphereGeometry(PIN_BALLS[b].r, 24, 16), mat(hex(PIN_BALLS[b].rgb), { rough: 0.45 })), PIN_BALLS[b].c as V3)
      s.castShadow = true
      return s
    })
    const cam = add(g, new THREE.Group())
    camBody(cam, 0.1)
    const tri = frameTriad(cam, 0.13, '', LABEL, 0.004, { letters: 'xyz', size: 0.035 })
    const robot = frameTriad(g, 0.2, '', GREY, 0.004, { letters: 'XYZ', size: 0.035 })
    const rods = rodPool(g, 8 + 4 + 40)
    const dots = ringMarks(scene, 6)
    const bead = add(g, mesh(new THREE.SphereGeometry(0.008, 12, 8), glowMat(RING, 1.4)))
    bead.castShadow = false
    const pierce = BALL_KEYS.map(() => add(g, mesh(new THREE.SphereGeometry(0.006, 12, 8), glowMat(RING, 1.2))))

    const grid = pixelGrid(scene, PIN.img, PIN.cols, PIN.rows, PIN.pitch)
    const imgTop = (PIN.rows * PIN.pitch) / 2 + 0.6
    const imgTag = liveLabel(scene, [PIN.img[0], PIN.img[1] + imgTop, 0], { size: 0.34 })
    const marks = rodPool(scene, 2)
    const horizonTag = liveLabel(scene, [PIN.img[0] - (PIN.cols * PIN.pitch) / 2 - 0.3, 0, 0.2], { size: 0.28, align: 'right' })
    const K = matrixGrid(scene, PIN.mx, 3, 3, { cell: 1.7, size: 0.36 })
    addLabel(scene, 'K =', [PIN.mx[0] - K.w / 2 - 0.5, PIN.mx[1], 0.2], LABEL, 0.42, 'right')
    const st = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-2.4, -0.8, 0], radius: 50, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = pinParams(p)
        st.t = (st.t + dt / 1.6) % 1
        const sel = S.pc
        const bc = PIN_BALLS[S.ball].c
        const o: P3 = [S.Twc[3], S.Twc[7], S.Twc[11]]
        bead.position.set(...(bc.map((x, i) => x + (o[i] - x) * st.t) as V3))
        tri.face()
        robot.face()
        const key = pinKey(p)
        if (key === st.key) return
        st.key = key
        setTf(cam, S.Twc)
        frustum(rods, 0, S.k, S.Twc, PIN.plane, 0.003, RING)
        BALL_KEYS.forEach((b, i) => {
          const [u, v, z] = S.px[b]
          const seen = z > 0 && inImage(S.k, u, v)
          const col = b === S.ball ? RING : hex(PIN_BALLS[b].rgb)
          rods.set(8 + i, PIN_BALLS[b].c as V3, o as V3, b === S.ball ? 0.0035 : 0.0018, seen ? col : GREY)
          pierce[i].visible = seen
          if (seen) pierce[i].position.set(...onPlane(S.k, S.Twc, PIN.plane, u, v))
          if (seen) dots.set(i, gridAt(grid.cell, S.k, PIN.cols, PIN.rows, u, v), b === S.ball ? 0.42 : 0.3, col)
          else dots.set(i, [0, 0, -50], 0, GREY)
          balls[i].visible = true
        })
        S.edge.forEach((a, i) => {
          const b = S.edge[(i + 1) % S.edge.length]
          if (a && b) rods.set(12 + i, [a[0], a[1], 0.004], [b[0], b[1], 0.004], 0.006, B_FIELD)
          else rods.set(12 + i, [0, 0, 0], [0, 0, 0], 0, GREY)
        })
        rods.commit()
        const hv = S.span.horizonV
        if (hv > -0.5 && hv < S.k.h - 0.5) {
          const [a, b] = [gridAt(grid.cell, S.k, PIN.cols, PIN.rows, -0.5, hv, 0.1), gridAt(grid.cell, S.k, PIN.cols, PIN.rows, S.k.w - 0.5, hv, 0.1)]
          a[0] -= PIN.pitch / 2
          b[0] += PIN.pitch / 2
          marks.set(0, a, b, 0.05, HEAT)
          horizonTag.group.position.y = a[1]
          horizonTag.set(`horizon, v = ${f0(hv)}`, HEAT)
        } else {
          marks.hideFrom(0)
          horizonTag.set('', HEAT)
        }
        marks.commit()
        dots.commit()
        showImg(grid, S.img)
        imgTag.set(`${QVGA.w} × ${QVGA.h} image (shown ${PIN.cols} × ${PIN.rows}) · FOV ${S.fov}°`, LABEL)
        K.set([f0(S.k.fx), '0', f1(S.k.cx), '0', f0(S.k.fy), f1(S.k.cy), '0', '0', '1'], [RING, GREY, B_FIELD, GREY, RING, B_FIELD, GREY, GREY, LABEL])
        const [u, v, z] = S.px[S.ball]
        const seen = z > 0 && inImage(S.k, u, v)
        status.set(`camera ${Math.round(S.h * 100)} cm up, tilted ${Math.round(S.tilt / DEG)}° down · ${BALLS[S.ball].toLowerCase()} ${cm(Math.hypot(...sel))} away`, LABEL)
        sub.set(`in camera axes (${f2(sel[0])}, ${f2(sel[1])}, ${f2(sel[2])}) m → pixel (${f0(u)}, ${f0(v)})`, GREY)
        event.set(
          seen ? `centre row sees the floor ${cm(S.span.centreM)} ahead · blind below ${cm(S.span.nearM)} · far edge ${cm(S.span.farM)}` : `${BALLS[S.ball].toLowerCase()} is outside the image: widen the view or tilt`,
          seen ? POWER : HIGH_V,
        )
      },
      readouts: (p) => {
        const S = pinParams(p)
        const [u, v, z] = S.px[S.ball]
        const seen = z > 0 && inImage(S.k, u, v)
        const per = S.span.centreM === Infinity ? Infinity : (S.span.centreM ** 2 + S.h ** 2) / (S.h * S.k.fy)
        return [
          { label: 'Focal length fx = fy', value: `${f0(S.k.fx)} px` },
          { label: `${BALLS[S.ball]} pixel (u, v)`, value: seen ? `(${f0(u)}, ${f0(v)})` : 'out of view', tone: seen ? 'ok' : 'bad' },
          { label: 'Floor at the centre row', value: cm(S.span.centreM), tone: S.span.centreM === Infinity ? 'warn' : 'ok' },
          { label: 'Floor per pixel there', value: per === Infinity ? '–' : `${f1(per * 100)} cm`, tone: per < 0.01 ? 'ok' : per < 0.03 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}

// --- Calibration: photograph a checkerboard from many angles, fit K, k1, k2 and every pose, score by reprojection error. ---

const LENS_PICK = { stock: 'Stock 66°', wide: 'Wide 120°', tele: 'Narrow 40°' }
const MODELS = { k: 'K only', kd: 'K + k1, k2' }
const CAL = { nx: 8, ny: 6, sq: 0.025, maxViews: 10, cols: 80, rows: 60, pitch: 0.13, img: [4.6, 0.1, 0] as V3, at: [-14.6, -3.2, 0] as V3, mx: [0.6, -5.4, 0] as V3, dwell: 1.6, mag: 6 }
const CAL_PTS = boardPoints(CAL.nx, CAL.ny, CAL.sq)

const calLens = (key: keyof typeof LENS_PICK) => {
  const L = LENSES[key]
  const k = intrinsicsOf(QVGA.w, QVGA.h, L.fov)
  const boardW = (CAL.nx + 3) * CAL.sq
  return { k, lens: lensFor(L, k), dist: (boardW / (2 * Math.tan((L.fov * DEG) / 2))) * 1.2 }
}
const calKey = (p: Params) => ['lens', 'views', 'noise', 'model'].map((k) => p[k]).join('|')
const calParams = memoBy(calKey, (p: Params) => {
  const lensKey = pick(LENS_PICK, p.lens, 'wide')
  const model = pick(MODELS, p.model, 'kd')
  const views = n(p, 'views')
  const noise = n(p, 'noise')
  const { k, lens, dist } = calLens(lensKey)
  const poses = boardShots(k, lens, views, dist, CAL_PTS)
  const obs = boardViews(k, lens, poses, CAL_PTS, noise, 5)
  const fit = calibrate(CAL_PTS, obs, k.w, k.h, model === 'kd')
  return { lensKey, model, views: poses.length, noise, k, lens, dist, poses, obs, fit, fxErr: fit.k.fx / k.fx - 1 }
})
type CalSetup = ReturnType<typeof calParams>
const calImage = memoBy(
  ({ S, v }: { S: CalSetup; v: number }) => `${S.lensKey}|${v}`,
  ({ S, v }: { S: CalSetup; v: number }) => renderView(S.k, camTf([0, 0, 0], 0, 0), { board: { tf: mul4(camTf([0, 0, 0], 0, 0), S.poses[v]), nx: CAL.nx, ny: CAL.ny, sq: CAL.sq }, sky: [52, 56, 66] }, CAL.cols, CAL.rows, S.lens),
)
const calPose = (S: CalSetup, v: number) => mul4(camTf([0, 0, 0], 0, 0), S.poses[v])

export const cameraModelCalibration: Lesson = {
  id: 'camera-model-calibration',
  title: 'Calibration',
  tagline: 'Photograph a checkerboard whose corners you know from many angles, then find the K, lens bend and board poses that put every corner back where it was seen',
  formula: (p) => {
    const S = calParams(p)
    const F = S.fit
    return `H = K·[r1 r2 t] per view (DLT) → K from Zhang's constraints → poses → ${S.model === 'kd' ? 'k1, k2 → ' : ''}Levenberg–Marquardt on all ${4 + (S.model === 'kd' ? 2 : 0) + 6 * S.views} numbers · RMS reprojection ${f2(F.linearRms)} → ${f2(F.rms)} px`
  },
  legend: [
    { color: RING, label: 'Corner as detected (with noise)', shape: 'dot' },
    { color: POWER, label: 'Corner re-projected by the fitted model', shape: 'dot' },
    { color: HIGH_V, label: `Reprojection error, drawn ${CAL.mag}× longer`, shape: 'dot' },
    { color: B_FIELD, label: 'Board pose found by the fit', shape: 'dot' },
  ],
  points: [
    'The board\'s corners are known: a flat grid, 25 mm apart, z = 0. Each photo gives a homography H (plane → image) from four or more matches, a small least-squares problem (DLT).',
    'Each H = K·[r1 r2 t] up to scale. r1 and r2 must be unit length and at right angles, which gives two equations per view about K: three or more tilted views pin down fx, fy, cx, cy (Zhang\'s method, what OpenCV calibrateCamera runs).',
    'K then gives every board pose, and a straight-line fit gives the lens bend k1, k2 (see Sensors → Lens distortion). Finally Levenberg–Marquardt nudges all of it together to shrink the reprojection error: detected corner minus predicted corner, in pixels.',
    'Check the result by the RMS error: about the corner-detection noise (√2·σ) is good. Fit a wide lens with K only and the error stays high and fx comes out wrong: the model cannot bend.',
    'Two views of a flat board can only just constrain K; add tilted views and noise matters much less. Fill the frame, tilt the board, cover the corners of the image.',
  ],
  controls: [
    { kind: 'choice', key: 'lens', options: opts(LENS_PICK), initial: 'wide' },
    { kind: 'choice', key: 'model', options: opts(MODELS), initial: 'kd' },
    { kind: 'slider', key: 'views', label: 'Board photos', min: 2, max: CAL.maxViews, step: 1, initial: 6, format: (v) => `${v}` },
    { kind: 'slider', key: 'noise', label: 'Corner noise σ', min: 0, max: 2, step: 0.1, initial: 0.3, format: (v) => `${f1(v)} px` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = zUp(scene, CAL.at, 1, 0.45, 0.75)
    const cam = add(g, new THREE.Group())
    const frus = rodPool(g, 8 + CAL.maxViews * 4)
    const tri = frameTriad(cam, 1, 'camera', LABEL, 0.035, { letters: 'xyz', size: 0.3 })
    const body = camBody(cam, 1)
    setTf(cam, camTf([0, 0, 0], 0, 0))
    const plate = new THREE.MeshStandardMaterial({ color: '#e6e6e0', roughness: 0.7, transparent: true, opacity: 0.3, depthWrite: false })
    const ink = new THREE.MeshStandardMaterial({ color: '#1c1f25', roughness: 0.7, transparent: true, opacity: 0.3, depthWrite: false })
    const sqTotal = (CAL.nx + 1) * (CAL.ny + 1)
    const boards = Array.from({ length: CAL.maxViews }, () => {
      const b = add(g, new THREE.Group())
      const w = (CAL.nx + 3) * CAL.sq
      const h = (CAL.ny + 3) * CAL.sq
      add(b, mesh(new THREE.PlaneGeometry(w, h), plate), [0, 0, 0.001]).castShadow = false
      const tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(CAL.sq, CAL.sq), ink, sqTotal)
      const m4 = new THREE.Matrix4()
      let ti = 0
      for (let j = 0; j <= CAL.ny; j++)
        for (let i = 0; i <= CAL.nx; i++) if ((i + j) % 2 === 0) tiles.setMatrixAt(ti++, m4.makeTranslation((i - CAL.nx / 2) * CAL.sq, (j - CAL.ny / 2) * CAL.sq, 0))
      tiles.count = ti
      tiles.castShadow = false
      b.add(tiles)
      return { b, tiles }
    })
    const plateOn = new THREE.MeshStandardMaterial({ color: '#f2f2ec', roughness: 0.7, side: THREE.DoubleSide })
    const inkOn = new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 })
    const grid = pixelGrid(scene, CAL.img, CAL.cols, CAL.rows, CAL.pitch)
    const imgTag = liveLabel(scene, [CAL.img[0], CAL.img[1] + (CAL.rows * CAL.pitch) / 2 + 0.6, 0], { size: 0.32 })
    const nPts = CAL.nx * CAL.ny
    const seen = ringMarks(scene, nPts, 0.3)
    const fitDots = ringMarks(scene, nPts, 1)
    const errs = rodPool(scene, nPts)
    const K = matrixGrid(scene, CAL.mx, 3, 3, { cell: 1.45, size: 0.32 })
    addLabel(scene, 'K fit =', [CAL.mx[0] - K.w / 2 - 0.4, CAL.mx[1], 0.2], LABEL, 0.36, 'right')
    const tx = CAL.mx[0] + K.w / 2 + 0.6
    const truth = liveLabel(scene, [tx, CAL.mx[1] + 0.55, 0.2], { size: 0.28, align: 'left' })
    const lensLine = liveLabel(scene, [tx, CAL.mx[1] - 0.15, 0.2], { size: 0.28, align: 'left' })
    const lensTrue = liveLabel(scene, [tx, CAL.mx[1] - 0.85, 0.2], { size: 0.28, align: 'left' })
    const st = { key: '', t: 0, v: -1 }
    return {
      scene,
      view: { center: [-2.4, -0.8, 0], radius: 50, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = calParams(p)
        const key = calKey(p)
        if (key !== st.key) Object.assign(st, { key, t: 0, v: -1 })
        st.t += dt
        const v = Math.floor(st.t / CAL.dwell) % S.views
        tri.face()
        if (v === st.v) return
        const scale = 3.6 / S.dist
        g.scale.setScalar(scale)
        tri.group.scale.setScalar(0.25 * S.dist)
        body.scale.setScalar(0.12 * S.dist)
        if (st.v === -1) {
          frustum(frus, 0, S.k, camTf([0, 0, 0], 0, 0), S.dist * 0.5, 0.004 * S.dist, RING)
          boards.forEach((B, i) => {
            B.b.visible = i < S.views
            if (i < S.views) setTf(B.b, calPose(S, i))
          })
        }
        st.v = v
        boards.forEach((B, i) => {
          const on = i === v
          ;(B.b.children[0] as THREE.Mesh).material = on ? plateOn : plate
          B.tiles.material = on ? inkOn : ink
        })
        const Tf = mul4(camTf([0, 0, 0], 0, 0), S.fit.poses[v])
        const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => apply4(Tf, [(a * (CAL.nx + 1) * CAL.sq) / 2, (b * (CAL.ny + 1) * CAL.sq) / 2, 0]) as V3)
        c.forEach((q, j) => frus.set(8 + j, q, c[(j + 1) % 4], 0.003 * S.dist, B_FIELD))
        frus.hideFrom(12)
        frus.commit()
        showImg(grid, calImage({ S, v }))
        const fitLens: Lens = S.model === 'kd' ? S.fit.lens : NO_LENS
        CAL_PTS.forEach((pt, i) => {
          const [ou, ov] = S.obs[v][i]
          const [fu, fv] = toPixel(S.fit.k, apply4(S.fit.poses[v], pt), fitLens)
          const a = gridAt(grid.cell, S.k, CAL.cols, CAL.rows, ou, ov, 0.2)
          const b = gridAt(grid.cell, S.k, CAL.cols, CAL.rows, fu, fv, 0.25)
          seen.set(i, a, 0.17, RING)
          fitDots.set(i, b, 0.07, POWER)
          const e: V3 = [b[0] + (a[0] - b[0]) * CAL.mag, b[1] + (a[1] - b[1]) * CAL.mag, 0.3]
          errs.set(i, b, e, 0.035, HIGH_V)
        })
        seen.commit()
        fitDots.commit()
        errs.commit()
        const F = S.fit
        const err = Math.sqrt(S.fit.errors[v].reduce((s, e) => s + e[0] ** 2 + e[1] ** 2, 0) / nPts)
        imgTag.set(`photo ${v + 1} of ${S.views} · ${LENS_PICK[S.lensKey]} · this photo ${f2(err)} px RMS`, LABEL)
        const bad = (x: number, t: number) => (Math.abs(x) > t ? HIGH_V : POWER)
        K.set([f1(F.k.fx), '0', f1(F.k.cx), '0', f1(F.k.fy), f1(F.k.cy), '0', '0', '1'], [bad(S.fxErr, 0.02), GREY, bad(F.k.cx - S.k.cx, 3), GREY, bad(F.k.fy / S.k.fy - 1, 0.02), bad(F.k.cy - S.k.cy, 3), GREY, GREY, LABEL])
        truth.set(`true fx = fy ${f1(S.k.fx)}, centre (${S.k.cx}, ${S.k.cy})`, GREY)
        lensLine.set(S.model === 'kd' ? `fit k1 ${f3(F.lens.k1)}, k2 ${f3(F.lens.k2)}` : 'lens bend not modelled', S.model === 'kd' ? LABEL : HEAT)
        lensTrue.set(`true k1 ${f3(S.lens.k1)}, k2 ${f3(S.lens.k2)}`, GREY)
        const target = S.noise * Math.SQRT2
        status.set(`${S.views} photos of a ${CAL.nx + 1} × ${CAL.ny + 1} board, ${CAL.sq * 1000} mm squares`, LABEL)
        sub.set(`RMS ${f2(F.linearRms)} px closed form → ${f2(F.rms)} px refined · noise floor √2·σ = ${f2(target)} px`, GREY)
        event.set(
          F.rms > target + 0.3 ? 'error above the noise: model missing the lens bend?' : Math.abs(S.fxErr) > 0.03 ? `fits the corners but fx is ${f0(S.fxErr * 100)}% off: too few photos` : 'at the noise floor, K close: good',
          F.rms > target + 0.3 ? HIGH_V : Math.abs(S.fxErr) > 0.03 ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const S = calParams(p)
        const F = S.fit
        return [
          { label: 'RMS reprojection error', value: `${f2(F.rms)} px`, tone: F.rms < S.noise * 1.6 + 0.1 ? 'ok' : F.rms < 1 ? 'warn' : 'bad' },
          { label: 'fx fit vs true', value: `${f1(F.k.fx)} vs ${f1(S.k.fx)} (${S.fxErr >= 0 ? '+' : ''}${f1(S.fxErr * 100)} %)`, tone: Math.abs(S.fxErr) < 0.01 ? 'ok' : Math.abs(S.fxErr) < 0.04 ? 'warn' : 'bad' },
          { label: 'Image centre fit', value: `(${f1(F.k.cx)}, ${f1(F.k.cy)})`, tone: Math.hypot(F.k.cx - S.k.cx, F.k.cy - S.k.cy) < 3 ? 'ok' : 'warn' },
          { label: 'k1 fit vs true', value: S.model === 'kd' ? `${f3(F.lens.k1)} vs ${f3(S.lens.k1)}` : `– vs ${f3(S.lens.k1)}` },
        ]
      },
    }
  },
}

// --- Stereo depth: two cameras a baseline apart; the shift (disparity) of a point between their images gives its depth. ---

const RES = { qvga: 'QVGA 320 × 240', vga: 'VGA 640 × 480', svga: 'SVGA 800 × 600' }
const RES_W = { qvga: 320, vga: 640, svga: 800 }
const MATCH = { whole: 'Whole pixels', quarter: '¼ pixel (parabola fit)' }
const ST = { h: 0.1, ballR: 0.06, at: [-16.4, -2.4, 0] as V3, k: 2.75, cols: 48, rows: 36, pitch: 0.13, imgL: [0.9, 1.6, 0] as V3, imgR: [8.0, 1.6, 0] as V3, hist: [1.4, -6.2, 0] as V3, histW: 10.6, histH: 2, bins: 48, patch: 3, maxZ: 4.5, wall: 4.75, ticks: 40 }
const ST_SCENE = (z: number, base: number) => ({ floor: { ...FLOOR, x: [0, ST.wall] as [number, number], y: [-0.75, 0.75] as [number, number] }, balls: [{ c: [z, -base / 2, ST.ballR] as P3, r: ST.ballR, rgb: [225, 70, 40] as [number, number, number], speckle: 64 }], wallX: ST.wall })

const stKey = (p: Params) => ['base', 'depth', 'res', 'match'].map((k) => p[k]).join('|')
const stParams = memoBy(stKey, (p: Params) => {
  const base = n(p, 'base') / 100
  const z = n(p, 'depth')
  const res = pick(RES, p.res, 'qvga')
  const match = pick(MATCH, p.match, 'whole')
  const W = RES_W[res]
  const k = intrinsicsOf(W, (W * 3) / 4, LENSES.stock.fov)
  const [L, R] = stereoRig([0, 0, ST.h], base)
  const scene = ST_SCENE(z, base)
  const ball = scene.balls[0].c
  const front: P3 = [z - ST.ballR, ball[1], ball[2]]
  const [uL, vL] = projectPx(k, L, front)
  const [uR] = projectPx(k, R, front)
  const surface = front[0]
  const dTrue = uL - uR
  const r = Math.round(ST.patch * Math.sqrt(W / 320))
  const per = Math.max(1, Math.ceil((dTrue * 1.6 + 12) / ST.bins))
  const [x, y] = [Math.round(uL), Math.round(vL)]
  const maxD = Math.max(1, Math.min(per * ST.bins - 1, x - r))
  const seen = uR >= 0 && uL <= W - 1
  const m = !seen ? { d: 0, costs: [0] } : matchDisparity(renderView(cropK(k, x - r, y - r, 2 * r + 1, 2 * r + 1), L, scene), renderView(cropK(k, x - r - maxD, y - r, maxD + 2 * r + 1, 2 * r + 1), R, scene), r, r + maxD, r, r, maxD, match === 'quarter')
  const zFound = depthFromDisparity(k.fx, base, m.d)
  return {
    base, z, res, match, W, k, L, R, ball, uL, uR, vL, surface, dTrue, maxD, per, r, seen, ...m, zFound,
    step: depthStep(k.fx, base, surface, match === 'quarter' ? 0.25 : 1),
    range: depthFromDisparity(k.fx, base, 1),
    imgL: renderView(k, L, scene, ST.cols, ST.rows, NO_LENS, 2),
    imgR: renderView(k, R, scene, ST.cols, ST.rows, NO_LENS, 2),
  }
})

export const cameraModelStereoDepth: Lesson = {
  id: 'camera-model-stereo-depth',
  title: 'Stereo depth',
  tagline: 'Two cameras side by side see a near thing shifted a lot and a far thing hardly at all; that shift, the disparity, is depth: Z = f·B / d',
  formula: (p) => {
    const S = stParams(p)
    return `Z = fx·B / d = ${f0(S.k.fx)} px × ${f1(S.base * 100)} cm / ${S.d} px = ${cm(S.zFound)} (true ${cm(S.surface)}) · ΔZ ≈ Z²·Δd / (fx·B) = ±${cm(S.step)} · range at d = 1 px: ${cm(S.range)}`
  },
  legend: [
    { color: RING, label: 'Left camera ray and the ball in its image', shape: 'dot' },
    { color: B_FIELD, label: 'Right camera ray and the ball in its image', shape: 'dot' },
    { color: HEAT, label: 'Depths a whole-pixel disparity can report', shape: 'dot' },
    { color: POWER, label: 'Best match (lowest block difference)', shape: 'dot' },
  ],
  points: [
    'Two identical cameras, side by side and level (rectified), a baseline B apart. A point lands on the same row in both images, shifted sideways by the disparity d = uL − uR. Similar triangles give Z = fx·B / d (fx from the pinhole model).',
    'Finding d is matching: take a small block around the point in the left image and slide it along the same row of the right one; the lowest sum of absolute differences wins (bar chart). Plain walls and repeating patterns fool it; texture helps.',
    'd is a whole number of pixels, so depth comes in steps (orange marks) that spread out with distance: ΔZ ≈ Z²/(fx·B). Double the distance, four times the error. A parabola through the three best costs reaches about ¼ pixel.',
    'Wider baseline or more pixels push the useful range out, but near objects leave one camera\'s view and matching gets harder. The same Z = f·B/d sits behind depth cameras like the RealSense and OAK-D.',
  ],
  controls: [
    { kind: 'choice', key: 'res', options: opts(RES), initial: 'qvga' },
    { kind: 'choice', key: 'match', options: opts(MATCH), initial: 'whole' },
    { kind: 'slider', key: 'base', label: 'Baseline B', min: 2, max: 20, step: 1, initial: 6, format: (v) => `${v} cm` },
    { kind: 'slider', key: 'depth', label: 'Ball distance', min: 0.2, max: 4, step: 0.05, initial: 1.2, format: (v) => `${f2(v)} m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = zUp(scene, ST.at, ST.k, 0.8, -0.12)
    floorTiles(g, [0, ST.wall], [-0.75, 0.75], FLOOR.tile)
    flatBox(g, [0.04, 1.5, 0.5], mat('#b4ab98', { rough: 0.9 }), [ST.wall + 0.02, 0, 0.25])
    const camL = add(g, new THREE.Group())
    const camR = add(g, new THREE.Group())
    camBody(camL, 0.05)
    camBody(camR, 0.05)
    const bar = rodPool(g, 1)
    const ball = add(g, mesh(new THREE.SphereGeometry(ST.ballR, 24, 16), mat('#e04628', { rough: 0.45 })))
    ball.castShadow = true
    const rays = rodPool(g, 18)
    const ticks = ringMarks(g, ST.ticks, 0.5)
    const found = ringMarks(g, 1, 0.4)
    const gL = pixelGrid(scene, ST.imgL, ST.cols, ST.rows, ST.pitch)
    const gR = pixelGrid(scene, ST.imgR, ST.cols, ST.rows, ST.pitch)
    const top = (ST.rows * ST.pitch) / 2 + 0.55
    addLabel(scene, 'left camera', [ST.imgL[0], ST.imgL[1] + top, 0], RING, 0.32)
    addLabel(scene, 'right camera', [ST.imgR[0], ST.imgR[1] + top, 0], B_FIELD, 0.32)
    const cols = rodPool(scene, 4, { heads: true })
    const dTag = liveLabel(scene, [(ST.imgL[0] + ST.imgR[0]) / 2, ST.imgL[1] - top - 0.25, 0.2], { size: 0.32 })
    const hist = histChart(scene, ST.hist, ST.histW, ST.histH, ST.bins, { left: 'd = 0', right: '', markers: 1 })
    const histTag = liveLabel(scene, [ST.hist[0] + ST.histW / 2, ST.hist[1] + ST.histH + 0.9, 0], { size: 0.28, color: GREY })
    const st = { key: '' }
    return {
      scene,
      view: { center: [-2.4, -0.8, 0], radius: 50, polar: Math.PI / 2, azimuth: 0 },
      frame(_dt, p) {
        const key = stKey(p)
        if (key === st.key) return
        st.key = key
        const S = stParams(p)
        setTf(camL, S.L)
        setTf(camR, S.R)
        bar.set(0, [0, 0, ST.h - 0.05], [0, -S.base, ST.h - 0.05], 0.012, GREY)
        bar.commit()
        ball.position.set(...(S.ball as V3))
        const oL: V3 = [S.L[3], S.L[7], S.L[11]]
        const oR: V3 = [S.R[3], S.R[7], S.R[11]]
        rays.set(0, oL, S.ball as V3, 0.008, RING)
        rays.set(1, oR, S.ball as V3, 0.008, B_FIELD)
        frustum(rays, 2, S.k, S.L, 0.35, 0.006, RING)
        frustum(rays, 10, S.k, S.R, 0.35, 0.006, B_FIELD)
        rays.commit()
        const dd = S.match === 'quarter' ? 0.25 : 1
        let t = 0
        for (let d = Math.max(dd, Math.floor(S.dTrue / dd) * dd - 8 * dd); t < ST.ticks; d += dd) {
          const z = depthFromDisparity(S.k.fx, S.base, d)
          if (z < 0.15) break
          if (z > ST.maxZ) continue
          ticks.set(t++, [z, -S.base / 2, 0.003], 0.035, HEAT)
        }
        ticks.hideFrom(t)
        ticks.commit()
        if (S.zFound < ST.maxZ + 0.2) found.set(0, [S.zFound, -S.base / 2, 0.005], 0.07, POWER)
        else found.hideFrom(0)
        found.commit()
        showImg(gL, S.imgL)
        showImg(gR, S.imgR)
        const pL = gridAt(gL.cell, S.k, ST.cols, ST.rows, S.uL, S.vL, 0.2)
        const pR = gridAt(gR.cell, S.k, ST.cols, ST.rows, S.uR, S.vL, 0.2)
        const h = (ST.rows * ST.pitch) / 2
        cols.set(0, [pL[0], ST.imgL[1] - h, 0.2], [pL[0], ST.imgL[1] + h, 0.2], 0.03, RING)
        cols.set(1, [pR[0], ST.imgR[1] - h, 0.2], [pR[0], ST.imgR[1] + h, 0.2], 0.03, B_FIELD)
        const ghost = gridAt(gR.cell, S.k, ST.cols, ST.rows, S.uL, S.vL, 0.2)
        cols.set(2, [ghost[0], ST.imgR[1] - h, 0.2], [ghost[0], ST.imgR[1] + h, 0.2], 0.02, GREY)
        if (Math.abs(ghost[0] - pR[0]) > 0.2) cols.set(3, [ghost[0], ST.imgR[1] - h - 0.25, 0.25], [pR[0], ST.imgR[1] - h - 0.25, 0.25], 0.04, POWER)
        else cols.hideFrom(3)
        cols.commit()
        dTag.set(`same row, shifted by d = uL − uR = ${f1(S.uL - S.uR)} px`, LABEL)
        const per = S.per
        const bars = Array.from({ length: ST.bins }, (_, i) => {
          const sl = S.costs.slice(i * per, (i + 1) * per)
          return sl.length ? Math.min(...sl) : NaN
        })
        const sorted = bars.filter((b) => !Number.isNaN(b)).sort((a, b) => a - b)
        const [lo, mid] = [sorted[0], sorted[Math.floor(sorted.length / 2)]]
        hist.set(bars.map((b) => (Number.isNaN(b) ? 0 : Math.max(0, 1 - (b - lo) / (2 * (mid - lo) + 1e-9)))), (i) => (Math.floor(S.d / per) === i ? [0.36, 0.88, 0.63] : [0.45, 0.48, 0.54]))
        hist.marker(0, Math.min(1, (S.d + 0.5) / (per * ST.bins)), POWER, `d = ${S.d}`)
        hist.axis('d = 0', `${per * ST.bins} px`)
        histTag.set(`${2 * S.r + 1} × ${2 * S.r + 1} block matched along the row: higher = better`, GREY)
        const err = S.zFound - S.surface
        status.set(`${RES[S.res]} pair, ${f0(S.k.fx)} px focal length, baseline ${f0(S.base * 100)} cm · ball front ${cm(S.surface)} away`, LABEL)
        sub.set(`measured d = ${S.d} px → Z = ${cm(S.zFound)} · one ${S.match === 'quarter' ? '¼-' : ''}pixel step here = ±${cm(S.step)}`, GREY)
        if (!S.seen) event.set('the ball is outside one camera\'s view: no match possible this close', HIGH_V)
        else event.set(
          Math.abs(err) > 0.15 * S.surface ? `off by ${cm(Math.abs(err))}: at this range one pixel of disparity is a big jump in depth` : S.step > 0.05 * S.surface ? `close (${cm(Math.abs(err))} off), but the depth steps are ${cm(S.step)} apart here` : `precise: ${cm(Math.abs(err))} off, steps of ${cm(S.step)}`,
          Math.abs(err) > 0.15 * S.surface ? HIGH_V : S.step > 0.05 * S.surface ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const S = stParams(p)
        const rel = Math.abs(S.zFound - S.surface) / S.surface
        return [
          { label: 'Disparity true · matched', value: S.seen ? `${f1(S.dTrue)} · ${S.d} px` : `${f1(S.dTrue)} · –`, tone: S.seen ? undefined : 'bad' },
          { label: 'Depth measured vs true', value: S.seen ? `${cm(S.zFound)} vs ${cm(S.surface)}` : `– vs ${cm(S.surface)}`, tone: !S.seen || rel >= 0.15 ? 'bad' : rel < 0.03 ? 'ok' : 'warn' },
          { label: 'Depth step at this range', value: `±${cm(S.step)}`, tone: S.step < 0.02 * S.surface ? 'ok' : S.step < 0.08 * S.surface ? 'warn' : 'bad' },
          { label: 'Farthest range (d = 1 px)', value: cm(S.range) },
        ]
      },
    }
  },
}
