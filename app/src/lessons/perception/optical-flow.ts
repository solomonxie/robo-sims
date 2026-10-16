import { Img, camTf, imgAt, makeImg, carpetColor, carpetPlate, fixedStepAt, flowField, flowHoldRun, imgDerivs, intrinsicsOf, medianFlow, renderView, tabletopImg, tensorAt, warpImg, warpPoint, FlowVec, FLOW_MIN_EIG } from '../../core/physics'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, frustum, liveLabel, memoBy, pixelGrid, quadcopter, ringMarks, rodPool, scope, showImg, statusHeader, stretchArrow, zUp } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const f0 = (v: number) => v.toFixed(0)
const f1 = (v: number) => v.toFixed(1)
const f2 = (v: number) => v.toFixed(2)
const sgn = (v: number, d = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`
const cm = (m: number) => `${f0(m * 100)} cm`
const KIND_COLOR = { corner: POWER, edge: HEAT, flat: GREY }

// --- Lucas–Kanade: two frames, one window at a time, flow from the 2 × 2 structure tensor. ---

const W = 48
const H = 36
const STEP = 4
const LK = { a: [-10.4, -2.2, 0] as V3, b: [2.2, -2.2, 0] as V3, pitch: 0.24, zoom: [13.9, -1.2, 0] as V3, zp: 0.5, mag: 3 }
const METHOD = { lk: 'Lucas–Kanade', block: 'Block matching' }
const FRAME1 = tabletopImg(W, H)

const lkKey = (p: Params) => [p.method, p.dx, p.dy, p.rot, p.win].join('|')
const lkOf = memoBy(lkKey, (p: Params) => {
  const method = pick(METHOD, p.method, 'lk')
  const r = n(p, 'win')
  const wp = { angle: (n(p, 'rot') * Math.PI) / 180, dx: n(p, 'dx'), dy: n(p, 'dy') }
  const b = warpImg(FRAME1, wp)
  const seen = warpImg(makeImg(W, H, 1, 1), wp)
  const inView = (v: FlowVec) => { for (let y = v.y - r - 1; y <= v.y + r + 1; y++) for (let x = v.x - r - 1; x <= v.x + r + 1; x++) if (imgAt(seen, x, y) < 0.999) return false; return true }
  const field = flowField(FRAME1, b, STEP, r, method).filter(inView)
  const truth = (v: FlowVec) => warpPoint(wp, W, H, v.x, v.y).map((q, i) => q - (i ? v.y : v.x))
  const epe = (v: FlowVec) => Math.hypot(v.u - truth(v)[0], v.v - truth(v)[1])
  const corners = field.filter((v) => v.kind === 'corner')
  const count = (k: FlowVec['kind']) => field.filter((v) => v.kind === k).length
  return {
    method, r, wp, b, field, truth, epe, d: imgDerivs(FRAME1),
    meanErr: corners.length ? corners.reduce((s, v) => s + epe(v), 0) / corners.length : 0,
    med: medianFlow(field),
    corners: corners.length, edges: count('edge'), flats: count('flat'),
  }
})

export const opticalFlowLucasKanade: Lesson = {
  id: 'optical-flow-lucas-kanade',
  title: 'Lucas–Kanade',
  tagline: 'Optical flow is how far each patch of the image moved between two frames. Lucas–Kanade solves it from brightness gradients in a small window, but only where the window holds a corner',
  formula: (p) => {
    const S = lkOf(p)
    return S.method === 'lk'
      ? `brightness constancy I₂(x + u, y + v) = I₁(x, y) → Ix·u + Iy·v + It = 0 per pixel · window ${2 * S.r + 1} × ${2 * S.r + 1}: [ΣIx² ΣIxIy; ΣIxIy ΣIy²]·[u v]ᵀ = −[ΣIxIt ΣIyIt]ᵀ, iterate`
      : `block matching: try every whole-pixel shift within ±4 px, keep the least Σ|I₂ − I₁| over the ${2 * S.r + 1} × ${2 * S.r + 1} window (81 tries, no sub-pixel)`
  },
  legend: [
    { color: POWER, label: 'Corner window: full flow (u, v), arrows ×3', shape: 'dot' },
    { color: HEAT, label: 'Edge window: only the flow across the edge', shape: 'dot' },
    { color: GREY, label: 'Flat window: nothing to track', shape: 'dot' },
    { color: RING, label: 'Window being solved', shape: 'dot' },
  ],
  points: [
    'Brightness constancy: a patch keeps its brightness as it moves, so I₂(x + u, y + v) = I₁(x, y). A first-order Taylor step turns that into one linear equation per pixel, Ix·u + Iy·v + It = 0, with the gradients from Edges & features.',
    'One equation, two unknowns. Lucas–Kanade assumes every pixel in a small window moves together and solves the least-squares 2 × 2 system; then warps and repeats a few times for shifts over a pixel. It gives sub-pixel flow.',
    'The 2 × 2 matrix is the structure tensor from Edges & features → Corners. Two big eigenvalues (a corner) pin both u and v. On a straight edge one eigenvalue is ~0: any slide along the edge looks the same, so only the normal flow across it is known. That is the aperture problem.',
    'Flat windows (table, wall) have no gradient at all. Real trackers (KLT) only follow corners and use an image pyramid so big motions shrink to a pixel or two; turning the frame breaks the "window moves rigidly" assumption at the edges of the window.',
    'Block matching tries every whole-pixel shift and keeps the best sum of differences: robust and simple, as in the stereo matcher in Camera model, but it costs 81 tries per window here and rounds to whole pixels.',
  ],
  controls: [
    { kind: 'choice', key: 'method', options: opts(METHOD), initial: 'lk' },
    { kind: 'slider', key: 'dx', label: 'Shift x', min: -3, max: 3, step: 0.25, initial: 1.5, format: (v) => `${sgn(v)} px` },
    { kind: 'slider', key: 'dy', label: 'Shift y', min: -3, max: 3, step: 0.25, initial: -0.75, format: (v) => `${sgn(v)} px` },
    { kind: 'slider', key: 'rot', label: 'Turn', min: -8, max: 8, step: 1, initial: 0, format: (v) => `${sgn(v, 0)}°` },
    { kind: 'slider', key: 'win', label: 'Window radius', min: 1, max: 4, step: 1, initial: 2, format: (v) => `${2 * v + 1} × ${2 * v + 1} px` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const ga = pixelGrid(scene, LK.a, W, H, LK.pitch)
    const gb = pixelGrid(scene, LK.b, W, H, LK.pitch)
    const top = (H * LK.pitch) / 2 + 0.5
    liveLabel(scene, [LK.a[0], LK.a[1] + top, 0], { size: 0.32 }).set('frame 1 (t)', LABEL)
    const bTag = liveLabel(scene, [LK.b[0], LK.b[1] + top, 0], { size: 0.32 })
    const bSub = liveLabel(scene, [LK.b[0], LK.b[1] - top - 0.1, 0], { size: 0.27, color: GREY })
    const nMax = Math.ceil(W / STEP) * Math.ceil(H / STEP)
    const arrows = rodPool(scene, nMax, { heads: true })
    const dots = ringMarks(scene, nMax, 0.5)
    const probe = ringMarks(scene, 2, 0.25)
    const zoom = pixelGrid(scene, LK.zoom, 9, 9, LK.zp)
    const grads = rodPool(scene, 81, { heads: true })
    const zTop = (9 * LK.zp) / 2 + 0.5
    const zTag = liveLabel(scene, [LK.zoom[0], LK.zoom[1] + zTop, 0], { size: 0.3 })
    const zL = [0, 1, 2].map((k) => liveLabel(scene, [LK.zoom[0], LK.zoom[1] - zTop - 0.1 - 0.5 * k, 0], { size: 0.27 }))
    const st = { key: '', t: 0, i: -1 }
    const lift = (c: V3, z = 0.12): V3 => [c[0], c[1], c[2] + z]
    return {
      scene,
      view: { center: [0, -0.4, 0], radius: 56, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = lkOf(p)
        const key = lkKey(p)
        st.t = (st.t + dt / 14) % 1
        if (key !== st.key) {
          st.key = key
          st.i = -1
          showImg(ga, FRAME1)
          showImg(gb, S.b)
          let [k, j] = [0, 0]
          for (const v of S.field) {
            const a = lift(gb.cell(v.x, v.y))
            if (v.kind === 'flat') {
              dots.set(j++, a, 0.09, GREY)
              continue
            }
            arrows.set(k++, a, [a[0] + v.u * LK.pitch * LK.mag, a[1] - v.v * LK.pitch * LK.mag, a[2]], 0.035, KIND_COLOR[v.kind])
          }
          arrows.hideFrom(k)
          dots.hideFrom(j)
          arrows.commit()
          dots.commit()
          bTag.set(`frame 2 (t + 1) + flow, ${S.method === 'lk' ? 'Lucas–Kanade' : 'block matching'}`, LABEL)
          bSub.set(`true motion: shift (${sgn(S.wp.dx)}, ${sgn(S.wp.dy)}) px${S.wp.angle ? `, turn ${sgn(n(p, 'rot'), 0)}°` : ''} · median found (${sgn(S.med[0])}, ${sgn(S.med[1])})`, GREY)
          status.set(`${W} × ${H} px, a window every ${STEP} px: ${S.field.length} windows · ${S.corners} corners, ${S.edges} edges, ${S.flats} flat`, LABEL)
          sub.set(`corner windows: mean flow error ${f2(S.meanErr)} px · trust a window when λ2 ≥ ${FLOW_MIN_EIG} and λ2 ≥ λ1/20`, GREY)
          const big = Math.hypot(S.wp.dx, S.wp.dy) > S.r + 1.5
          event.set(
            S.meanErr > 0.6 ? (big && S.method === 'lk' ? 'motion bigger than the window: the linear step loses track (real trackers use a pyramid)' : S.wp.angle ? 'turning: the window no longer moves as one block' : 'some windows lock onto the wrong patch') : S.method === 'block' ? 'whole pixels only: the error is the rounding' : 'sub-pixel flow on every corner window',
            S.meanErr > 0.6 ? HIGH_V : S.method === 'block' ? HEAT : POWER,
          )
        }
        const i = Math.floor(st.t * S.field.length)
        if (i === st.i || !S.field.length) return
        st.i = i
        const v = S.field[i]
        probe.set(0, lift(ga.cell(v.x, v.y), 0.15), (S.r + 0.5) * LK.pitch, RING)
        probe.set(1, lift(gb.cell(v.x, v.y), 0.15), (S.r + 0.5) * LK.pitch, RING)
        probe.commit()
        let peak = 1
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) peak = Math.max(peak, Math.hypot(S.d.gx[(v.y + dy) * W + v.x + dx] || 0, S.d.gy[(v.y + dy) * W + v.x + dx] || 0))
        for (let dy = -4; dy <= 4; dy++)
          for (let dx = -4; dx <= 4; dx++) {
            const q = (dy + 4) * 9 + dx + 4
            const [x, y] = [v.x + dx, v.y + dy]
            const inside = Math.abs(dx) <= S.r && Math.abs(dy) <= S.r && x >= 0 && y >= 0 && x < W && y < H
            const c = (x >= 0 && y >= 0 && x < W && y < H ? FRAME1.data.slice((y * W + x) * 3, (y * W + x) * 3 + 3) : [0, 0, 0]) as ArrayLike<number>
            const dim = inside ? 1 : 0.3
            zoom.set(q, (c[0] / 255) * dim, (c[1] / 255) * dim, (c[2] / 255) * dim)
            const g = inside ? [S.d.gx[y * W + x], S.d.gy[y * W + x]] : [0, 0]
            const len = (Math.hypot(g[0], g[1]) / peak) * LK.zp * 0.9
            const a = lift(zoom.cell(dx + 4, dy + 4), 0.1)
            const m = Math.hypot(g[0], g[1]) || 1
            const off: V3 = [(g[0] / m) * len, (-g[1] / m) * len, 0]
            grads.set(q, [a[0] - off[0] / 2, a[1] - off[1] / 2, a[2]], [a[0] + off[0] / 2, a[1] + off[1] / 2, a[2]], 0.035, B_FIELD)
          }
        zoom.commit()
        grads.commit()
        const T = tensorAt(S.d, v.x, v.y, S.r)
        const tr = S.truth(v)
        zTag.set(`window (${v.x}, ${v.y}): gradients`, LABEL)
        zL[0].set(`λ1 = ${f0(T.l1)}, λ2 = ${f0(T.l2)} → ${v.kind}${v.kind === 'edge' ? ': normal flow only' : ''}`, KIND_COLOR[v.kind])
        zL[1].set(v.kind === 'flat' ? 'no gradient: flow unknown' : `found (${sgn(v.u)}, ${sgn(v.v)}) px`, v.kind === 'flat' ? GREY : LABEL)
        zL[2].set(`true (${sgn(tr[0])}, ${sgn(tr[1])}) px${v.kind !== 'flat' ? ` · error ${f2(S.epe(v))}` : ''}`, GREY)
      },
      readouts: (p) => {
        const S = lkOf(p)
        return [
          { label: 'Mean error (corners)', value: `${f2(S.meanErr)} px`, tone: S.meanErr < 0.3 ? 'ok' : S.meanErr < 0.6 ? 'warn' : 'bad' },
          { label: 'Median flow found', value: `${sgn(S.med[0])}, ${sgn(S.med[1])} px` },
          { label: 'Corner / edge / flat', value: `${S.corners} / ${S.edges} / ${S.flats}` },
          { label: 'Tries per window', value: S.method === 'lk' ? `≤ 8 iterations` : '81 shifts' },
        ]
      },
    }
  },
}

// --- Visual odometry: a downward flow camera + range finder → ground speed → position, holding a quad still in wind. ---

const KC = intrinsicsOf(32, 24, 42)
const DOWN = Math.PI / 2
const FPS = 20
const CARPET = carpetPlate()
const T_RUN = 12
const DT = 0.01
const VO = { at: [-9.8, -5.6, 0] as V3, k: 3.5, img: [9.6, 1.6, 0] as V3, pitch: 0.2, scope: [9.6, -4.3, 0] as V3, sw: 10, sh: 3.4, xs: [-1.2, 2.4] as [number, number], ys: [-0.6, 0.6] as [number, number] }
const HSRC = { tof: 'Height from ToF', fixed: 'Height fixed at 1 m' }
const ROT = { on: 'Gyro de-rotation on', off: 'Gyro de-rotation off' }

const voKey = (p: Params) => [p.rot, p.wind, p.h, p.hsrc].join('|')
const voOf = memoBy(voKey, (p: Params) => {
  const h = n(p, 'h')
  const derotate = pick(ROT, p.rot, 'on') === 'on'
  const hsrc = pick(HSRC, p.hsrc, 'tof')
  const run = flowHoldRun({ wind: n(p, 'wind'), h, hUsed: hsrc === 'tof' ? h : 1, derotate, f: KC.fx, T: T_RUN, dt: DT })
  const xs = run.map((s) => s.x)
  const last = run[run.length - 1]
  const maxDev = Math.max(...xs.map(Math.abs))
  return { h, derotate, hsrc, run, range: Math.max(0.5, Math.ceil(maxDev / 0.5) * 0.5), maxDev, last, peakTilt: Math.max(...run.map((s) => Math.abs(s.pitch))), shots: new Map<number, { img: Img; field: FlowVec[] }>() }
})
type Vo = ReturnType<typeof voOf>

/** Camera frame at shot index `k` (FPS) and LK flow from the previous one; cached per run. */
function shotAt(V: Vo, k: number) {
  const hit = V.shots.get(k)
  if (hit) return hit
  const view = (j: number) => {
    const s = fixedStepAt(V.run, Math.max(0, j) / FPS, DT)
    return renderView(KC, camTf([s.x, 0, V.h], 0, DOWN + s.pitch), { plates: [CARPET] })
  }
  const img = view(k)
  const shot = { img, field: flowField(view(k - 1), img, 5, 2) }
  V.shots.set(k, shot)
  return shot
}

export const opticalFlowVisualOdometry: Lesson = {
  id: 'optical-flow-visual-odometry',
  title: 'Visual odometry',
  tagline: 'Point a camera at the floor and flow becomes speed: v = flow·h/f. Add the height from a range finder, take out the drone\'s own tilting with the gyro, and it can hold position with no GPS',
  formula: (p) => {
    const V = voOf(p)
    return `v = (flow / f ${V.derotate ? '+ ω_gyro' : ''})·h = (flow / ${f1(KC.fx)} px${V.derotate ? ' + ω' : ''}) × ${V.hsrc === 'tof' ? `${f1(V.h)} m (ToF)` : '1 m (fixed)'} · x̂ = ∫v dt → PID → tilt · 1 px/s at ${f1(V.h)} m = ${f1((100 * V.h) / KC.fx)} cm/s`
  },
  legend: [
    { color: LABEL, label: 'Quad, true position', shape: 'dot' },
    { color: B_FIELD, label: 'Where the flow says it is (x̂)', shape: 'dot' },
    { color: RING, label: 'Hold point, camera frustum', shape: 'dot' },
    { color: HEAT, label: 'Wind', shape: 'dot' },
  ],
  points: [
    'An optical-flow sensor (PMW3901, the chip in a mouse with a lens) runs flow on a tiny downward image hundreds of times a second and reports pixels moved. Over the ground at height h, a speed v sweeps the image at f·v/h px/s, so v = flow·h/f (focal length f from Camera model).',
    'So the height matters as much as the flow: a ToF range finder (VL53L1X) sits next to it. Fix the height at 1 m and fly at 2 m and every speed reads half: the hold gets soft and drifts further. The same flow at greater height also means more metres per pixel of noise.',
    'Tilting the camera also sweeps the floor through the image, even when standing still. To push against wind the quad tilts, the flow sees motion that is not there, and the hold loop chases it. The gyro measures the tilt rate ω; adding it back (de-rotation) leaves only the true motion.',
    'Summing the speed gives position: visual odometry. Like wheel odometry it drifts, as small errors integrate, so it holds a hover well but slowly wanders over minutes. Full visual odometry tracks corners in 3D (forward camera, KLT + pose); SLAM fixes the drift with a map.',
  ],
  controls: [
    { kind: 'choice', key: 'rot', options: opts(ROT), initial: 'on' },
    { kind: 'choice', key: 'hsrc', options: opts(HSRC), initial: 'tof' },
    { kind: 'slider', key: 'wind', label: 'Wind gust', min: 0, max: 3, step: 0.25, initial: 1.5, format: (v) => `${f2(v)} m/s` },
    { kind: 'slider', key: 'h', label: 'Height', min: 0.4, max: 2.4, step: 0.1, initial: 1, format: (v) => `${f1(v)} m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = zUp(scene, VO.at, VO.k, 0.32, 0.5)
    const [nx, ny] = [36, 12]
    const floor = pixelGrid(g, [(VO.xs[0] + VO.xs[1]) / 2, 0, 0], nx, ny, (VO.xs[1] - VO.xs[0]) / nx)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const c = carpetColor(VO.xs[0] + ((i + 0.5) / nx) * (VO.xs[1] - VO.xs[0]), ((ny - 1) / 2 - j) * ((VO.xs[1] - VO.xs[0]) / nx))
        floor.set(j * nx + i, c[0] / 255, c[1] / 255, c[2] / 255)
      }
    floor.commit()
    const quad = quadcopter(g, { arcs: false })
    quad.group.scale.setScalar(2)
    const rods = rodPool(g, 9)
    const marks = ringMarks(g, 2, 0.3)
    const wind = stretchArrow(g, HEAT, 0.02)
    const img = pixelGrid(scene, VO.img, KC.w, KC.h, VO.pitch)
    const arrows = rodPool(scene, 40, { heads: true })
    const top = (KC.h * VO.pitch) / 2 + 0.45
    const imgTag = liveLabel(scene, [VO.img[0], VO.img[1] + top, 0], { size: 0.3 })
    const imgSub = liveLabel(scene, [VO.img[0], VO.img[1] - top - 0.05, 0], { size: 0.26, color: GREY })
    const sc = scope(scene, VO.sw, VO.sh)
    sc.group.position.set(...VO.scope)
    const trTrue = sc.trace(LABEL, { radius: 0.06 })
    const trEst = sc.trace(B_FIELD, { radius: 0.06 })
    const scTag = liveLabel(scene, [VO.scope[0], VO.scope[1] - VO.sh / 2 - 1.0, 0], { size: 0.26, color: GREY })
    const st = { key: '', t: 0, k: -1 }
    return {
      scene,
      view: { center: [0, -0.8, 0], radius: 56, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const V = voOf(p)
        const key = voKey(p)
        if (key !== st.key) {
          st.key = key
          st.t = 0
          st.k = -1
          scTag.set(`position over ${T_RUN} s (±${f1(V.range)} m): true white, flow estimate cyan`, GREY)
          status.set(`quad hovering ${f1(V.h)} m up, flow camera ${KC.w} × ${KC.h} px at ${FPS} fps · gust ${f2(n(p, 'wind'))} m/s from 1 s`, LABEL)
          sub.set(`${V.derotate ? 'gyro rate added back' : 'no gyro de-rotation'} · ${V.hsrc === 'tof' ? 'height measured' : `height assumed 1 m${Math.abs(V.h - 1) > 0.05 ? ` (really ${f1(V.h)} m)` : ''}`} · real time`, GREY)
          const bad = V.maxDev > 0.8
          event.set(
            !V.derotate && bad ? 'no gyro: its own tilt reads as motion, the hold is fooled and gives way' : V.hsrc === 'fixed' && Math.abs(V.h - 1) > 0.25 ? `wrong height: every speed reads ×${f2(1 / V.h)}, ${V.h > 1 ? 'soft hold, drifts further' : 'over-eager hold'}` : bad ? 'blown well off the spot' : `held within ${cm(V.maxDev)} of the spot`,
            bad ? HIGH_V : V.maxDev > 0.4 ? HEAT : POWER,
          )
        }
        st.t = (st.t + dt) % (T_RUN + 1.5)
        const t = Math.min(st.t, T_RUN)
        const s = fixedStepAt(V.run, t, DT)
        quad.group.position.set(s.x, 0, V.h)
        quad.pose(0, s.pitch)
        quad.set([t * 90, t * 91, t * 92, t * 93], [0.5, 0.5, 0.5, 0.5])
        const cam = camTf([s.x, 0, V.h], 0, DOWN + s.pitch)
        frustum(rods, 0, KC, cam, Math.min(V.h, 0.9) - 0.02, 0.006, RING)
        rods.set(8, [s.x, 0, 0.01], [s.x, 0, V.h], 0.004, GREY)
        rods.commit()
        marks.set(0, [0, 0, 0.012], 0.12, RING)
        marks.set(1, [Math.max(VO.xs[0], Math.min(VO.xs[1], s.xEst)), 0, 0.016], 0.09, B_FIELD)
        marks.commit()
        const w = t >= 1 ? n(p, 'wind') : 0
        wind([VO.xs[0] + 0.1, 0.45, V.h], [VO.xs[0] + 0.1 + 0.2 * w + 0.001, 0.45, V.h], HEAT)
        const y = (x: number) => (Math.max(-V.range, Math.min(V.range, x)) / V.range) * (VO.sh / 2)
        trTrue.draw((u) => y(fixedStepAt(V.run, Math.min(u, t / T_RUN) * T_RUN, DT).x), t / T_RUN)
        trEst.draw((u) => y(fixedStepAt(V.run, Math.min(u, t / T_RUN) * T_RUN, DT).xEst), t / T_RUN)
        const k = Math.floor(t * FPS)
        if (k === st.k) return
        st.k = k
        const shot = shotAt(V, k)
        showImg(img, shot.img)
        let a = 0
        for (const v of shot.field) {
          if (v.kind !== 'corner' || a >= 40) continue
          const c = img.cell(v.x, v.y)
          const o: V3 = [c[0], c[1], c[2] + 0.1]
          arrows.set(a++, o, [o[0] + v.u * VO.pitch * 4, o[1] - v.v * VO.pitch * 4, o[2]], 0.03, POWER)
        }
        arrows.hideFrom(a)
        arrows.commit()
        const [, mv] = medianFlow(shot.field)
        imgTag.set('downward camera + LK flow (arrows ×4)', LABEL)
        const vNow = (mv * FPS * (V.hsrc === 'tof' ? V.h : 1)) / KC.fx
        const gyro = V.derotate ? s.rate * (V.hsrc === 'tof' ? V.h : 1) : 0
        imgSub.set(`${sgn(mv)} px/frame → ${V.derotate ? `${sgn(vNow)} ${sgn(gyro)} gyro = ` : ''}${sgn(vNow + gyro)} m/s · true ${sgn(s.v)}`, GREY)
      },
      readouts: (p) => {
        const V = voOf(p)
        return [
          { label: 'Furthest from the spot', value: cm(V.maxDev), tone: V.maxDev < 0.4 ? 'ok' : V.maxDev < 0.8 ? 'warn' : 'bad' },
          { label: `Offset after ${T_RUN} s`, value: cm(V.last.x) },
          { label: 'Estimate error (x̂ − x)', value: cm(V.last.xEst - V.last.x), tone: Math.abs(V.last.xEst - V.last.x) < 0.1 ? 'ok' : 'warn' },
          { label: 'Peak tilt', value: `${f0((V.peakTilt * 180) / Math.PI)}°` },
        ]
      },
    }
  },
}
