import * as THREE from 'three/webgpu'
import {
  LENSES,
  PT_CROP,
  PT_FRAMES,
  PT_PATHS,
  PT_RIG,
  PT_TRACK,
  PtFrame,
  PtLens,
  PtPath,
  PtSample,
  TOOTH_DEG,
  fixedStepAt,
  ptBallAt,
  ptCoverage,
  ptFocal,
  ptLoop,
  ptRange,
  ptRayToWall,
  ptShotImg,
  ptShotPx,
  ptStats,
  ptTrackRun,
  ptView,
} from '../../core/physics'
import { fixedText } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  SIDE_SCOPE,
  addLabel,
  beamCone,
  codeListing,
  floorView,
  gridPoint,
  lapseClock,
  liveLabel,
  memoBy,
  panTiltHead,
  pixelGrid,
  ringMarks,
  rodPool,
  scopeLabels,
  showImg,
  sideScope,
  statusHeader,
  textRows,
  traceRun,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const DEG = Math.PI / 180
const deg = (v: number) => `${Math.round(v)}°`
const signedDeg = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}°`
const VIEW = { center: [-2.4, -0.8, 0] as V3, radius: 50, polar: Math.PI / 2, azimuth: 0 }

/** Floor with a pan-tilt head on it (metres; the head drawn `scale` m per servo unit). */
function rigStage(scene: THREE.Scene, at: V3, k: number, tilt: number, scale: number, floor: [number, number, number], lift = 0) {
  const g = floorView(scene, at, k, tilt)
  const f = add(g, new THREE.Mesh(new THREE.PlaneGeometry(floor[0], floor[1]), new THREE.MeshStandardMaterial({ color: '#2a2c31', roughness: 0.9 })), [0, floor[2], -0.001])
  f.receiveShadow = true
  if (lift > 0) add(g, new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, lift), new THREE.MeshStandardMaterial({ color: '#3a3d45', roughness: 0.8 })), [0, 0, lift / 2]).castShadow = true
  const hold = add(g, new THREE.Group(), [0, 0, lift])
  hold.scale.setScalar(scale)
  return { g, head: panTiltHead(hold, [0, 0, 0]) }
}

// --- Pan-tilt rig: two SG90s and an ESP32-CAM; what it can see, how small the ball gets, how fast the loop can run. ---

const LENS_NAMES = namesOf(LENSES)
const FRAME_NAMES = namesOf(PT_FRAMES)
const HORNS = { '0': 'Horn fitted at centre', '1': 'One tooth off', '2': 'Two teeth off' }
const rgParams = (p: Params) => ({
  lens: pick(LENS_NAMES, p.lens, 'stock') as PtLens,
  frame: pick(FRAME_NAMES, p.frame, 'qvga') as PtFrame,
  dist: n(p, 'dist'),
  teeth: Number(pick(HORNS, p.horn, '0')),
})
type RgQ = ReturnType<typeof rgParams>
const rangeOf = memoBy((q: { lens: PtLens; frame: PtFrame }) => `${q.lens}|${q.frame}`, (q: { lens: PtLens; frame: PtFrame }) => ptRange(q.lens, q.frame))
const rgView = memoBy((q: RgQ) => `${q.lens}|${q.frame}|${q.dist}`, (q: RgQ) => ptView(q.lens, q.frame, q.dist))
const RG = { floor: [-8.4, -2.2, 0] as V3, k: 26, tilt: -0.9, scale: 0.022, sweepS: 10, cone: 0.24, grid: [7.4, 2.2, 0] as V3, pitch: 0.2 }

export const cameraTrackerPanTiltRig: Lesson = {
  id: 'camera-tracker-pan-tilt-rig',
  title: 'Pan-tilt rig',
  tagline: 'An ESP32-CAM on two SG90s: the lens and the horn set what it can see, the frame size sets how far off it still finds the ball and how fast the loop can run',
  formula: (p) => {
    const q = rgParams(p)
    const c = ptCoverage(q.lens, q.frame, q.teeth)
    const L = ptLoop(q.frame)
    const v = rgView(q)
    return `ball radius = f·R/d = ${fixedText(ptFocal(q.lens, q.frame), 0)} px × ${PT_RIG.ballR * 100} cm / ${fixedText(q.dist, 1)} m = ${fixedText(v.r, 1)} px · sees ${signedDeg(c.see.right)} … ${signedDeg(c.see.left)} = pan ${signedDeg(c.pan[0])} … ${signedDeg(c.pan[1])} ± ${deg(c.hfov / 2)} · loop = min(${PT_FRAMES[q.frame].grabFps} fps grab, 1 / ${fixedText(L.procMs, 0)} ms mask) = ${fixedText(L.fps, 1)} fps`
  },
  legend: [
    { color: RING, label: 'Camera field of view', shape: 'dot' },
    { color: GREY, label: 'Everything it can see, pan end to end', shape: 'dot' },
    { color: HEAT, label: 'Pan servo travel limits', shape: 'dot' },
    { color: POWER, label: 'Ball blob found (after the open)', shape: 'dot' },
  ],
  points: [
    'The kit: two SG90s in a plastic pan-tilt bracket, an ESP32-CAM (OV2640) on the tilt horn, servo signals from two free GPIOs (12 and 13; the camera uses most of the rest). Power the servos from their own 5 V, not the board\'s pin: a servo kick browns the ESP32 out (Actuators › Hobby servo › Jitter and power).',
    `Centre each servo (write 90°) before you press the horn on. The spline has 25 teeth, so a horn can only sit in ${fixedText(TOOTH_DEG, 1)}° steps: one tooth off and the pan range is lopsided, and the far side is gone for good. The tilt stops near −40°, where the camera hits the bracket.`,
    'Coverage is the servo travel plus half the field of view on each side. The wide lens sees more at once but makes every pixel cover more of the world: the ball shrinks and bends near the edges (Sensors › Camera › Lens distortion).',
    `How far can it track? The ball covers f·R/d pixels (Perception › Camera model). The open in the HSV mask (Perception › Colour tracking › HSV mask) wipes anything under 3 px across, so past about 1.5 px radius the ball is gone. Double the frame width, double the range.`,
    'But every pixel costs time: about 0.5 µs each for RGB565 → HSV → mask on the ESP32. QQVGA runs at the camera\'s 25 fps, QVGA at 20, VGA drops to 6.5 fps with a 0.28 s old result. Pick the smallest frame that still sees the ball where you need it.',
  ],
  controls: [
    { kind: 'choice', key: 'lens', options: opts(LENS_NAMES), initial: 'stock' },
    { kind: 'choice', key: 'frame', options: opts(FRAME_NAMES), initial: 'qvga' },
    { kind: 'slider', key: 'dist', label: 'Ball distance', min: 0.5, max: 8, step: 0.25, initial: 2, format: (v) => `${v.toFixed(2)} m` },
    { kind: 'choice', key: 'horn', options: opts(HORNS), initial: '0' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const { g, head } = rigStage(scene, RG.floor, RG.k, RG.tilt, RG.scale, [0.62, 0.36, 0.08])
    const seeCone = beamCone(g, GREY)
    const fovCone = beamCone(g, RING)
    const limits = rodPool(g, 2)
    const limitTags = [0, 1].map(() => liveLabel(scene, [0, 0, 0], { size: 0.3, color: HEAT }))
    const grid = pixelGrid(scene, RG.grid, PT_CROP.w, PT_CROP.h, RG.pitch)
    const top = (PT_CROP.h * RG.pitch) / 2
    const gridTag = liveLabel(scene, [RG.grid[0], RG.grid[1] + top + 0.7, 0.2], { size: 0.32 })
    addLabel(scene, `native pixels, ${PT_CROP.w} × ${PT_CROP.h} crop at the image centre`, [RG.grid[0], RG.grid[1] - top - 0.6, 0.2], GREY, 0.26)
    const ring = ringMarks(scene, 1)
    const rows = textRows(scene, 4, RG.grid[0] - (PT_CROP.w * RG.pitch) / 2, -3.4, 0.28, 0.66)
    const v = new THREE.Vector3()
    const world = (x: number, y: number): V3 => {
      g.updateWorldMatrix(true, false)
      g.localToWorld(v.set(x, y, 0.004))
      return [v.x, v.y, v.z]
    }
    const st = { key: '' }
    const clock = lapseClock(RG.sweepS, 1, 0)
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = rgParams(p)
        const c = ptCoverage(q.lens, q.frame, q.teeth)
        const key = `${q.lens}|${q.frame}|${q.dist}|${q.teeth}`
        if (key !== st.key) {
          st.key = key
          const V = rgView(q)
          showImg(grid, V.img)
          if (V.best) ring.set(0, gridPoint(grid.cell, V.best.cx, V.best.cy), Math.max(0.25, (V.r + 1.2) * RG.pitch), POWER)
          else ring.hideFrom(0)
          ring.commit()
          const range = rangeOf(q)
          gridTag.set(V.best ? `ball ${fixedText(2 * V.r, 1)} px across · found` : `ball ${fixedText(2 * V.r, 1)} px across · lost in the open`, V.best ? POWER : HIGH_V)
          const head0 = Math.PI / 2
          seeCone([0, 0, 0.202], head0 + ((c.see.left + c.see.right) / 2) * DEG, Math.min(Math.PI, ((c.see.left - c.see.right) / 2) * DEG), RG.cone, 0.08)
          ;[c.pan[0], c.pan[1]].forEach((a, i) => {
            const th = head0 + a * DEG
            const end: V3 = [Math.cos(th) * RG.cone * 1.05, Math.sin(th) * RG.cone * 1.05, 0.004]
            limits.set(i, [0, 0, 0.004], end, 0.002, HEAT)
            const w = world(Math.cos(th) * RG.cone * 1.2, Math.sin(th) * RG.cone * 1.2)
            limitTags[i].group.position.set(w[0], w[1], w[2] + 0.3)
            limitTags[i].set(signedDeg(a), HEAT)
          })
          limits.commit()
          rows[0].set(`view ${deg(c.hfov)} × ${deg(c.vfov)} · range ${fixedText(range, 1)} m`, LABEL)
          rows[1].set(`sees ${signedDeg(c.see.right)} … ${signedDeg(c.see.left)} across`, LABEL)
          rows[2].set(`and ${signedDeg(c.see.down)} … ${signedDeg(c.see.up)} up and down`, LABEL)
          const L = ptLoop(q.frame)
          rows[3].set(`mask ${fixedText(L.procMs, 0)} ms → ${fixedText(L.fps, 1)} fps`, L.fps < 10 ? HEAT : GREY)
          const lopsided = q.teeth > 0
          event.set(
            !V.best ? `at ${fixedText(q.dist, 1)} m the ball is under 3 px: get closer or use a bigger frame` : lopsided ? `horn ${q.teeth} tooth${q.teeth > 1 ? ' teeth' : ''} off: the right side ends at ${signedDeg(c.see.right)}, refit it centred` : `ball found at ${fixedText(q.dist, 1)} m; the range limit is ${fixedText(range, 1)} m`,
            !V.best ? HIGH_V : lopsided ? HEAT : POWER,
          )
          sub.set(`7 cm red ball · ${FRAME_NAMES[q.frame]} · ${LENS_NAMES[q.lens].toLowerCase()}`, GREY)
        }
        const t = clock(dt, 'sweep')
        const u = Math.sin((2 * Math.PI * t) / RG.sweepS)
        const w = Math.sin((4 * Math.PI * t) / RG.sweepS + 0.6)
        const pan = (c.pan[0] + c.pan[1]) / 2 + ((c.pan[1] - c.pan[0]) / 2) * u
        const tilt = (c.tilt[0] + c.tilt[1]) / 2 + ((c.tilt[1] - c.tilt[0]) / 2) * w
        head.set(pan * DEG, tilt * DEG)
        fovCone([0, 0, 0.203], Math.PI / 2 + pan * DEG, (c.hfov / 2) * DEG, RG.cone * 0.92, 0.2)
        status.set(`Range test: pan ${signedDeg(pan)}, tilt ${signedDeg(tilt)}`, LABEL)
      },
      readouts: (p) => {
        const q = rgParams(p)
        const V = rgView(q)
        const c = ptCoverage(q.lens, q.frame, q.teeth)
        const L = ptLoop(q.frame)
        const range = rangeOf(q)
        return [
          { label: 'Ball in the frame', value: `${fixedText(2 * V.r, 1)} px · ${V.best ? 'found' : 'lost'}`, tone: V.best ? (q.dist < range * 0.8 ? 'ok' : 'warn') : 'bad' },
          { label: 'Tracking range', value: `${fixedText(range, 1)} m` },
          { label: 'Loop rate', value: `${fixedText(L.fps, 1)} fps · ${fixedText(L.latencyMs, 0)} ms old`, tone: toneOf(L.fps >= 15, L.fps >= 10) },
          { label: 'Sees across', value: `${signedDeg(c.see.right)} … ${signedDeg(c.see.left)}`, tone: toneOf(q.teeth === 0, q.teeth === 1) },
        ]
      },
    }
  },
}

// --- Colour tracking loop: both servos from the blob centroid; error in degrees, gain, frame size and a dead zone. ---

const ctParams = (p: Params) => ({
  path: pick(PT_PATHS, p.path, 'circle') as PtPath,
  frame: pick(FRAME_NAMES, p.frame, 'qvga') as PtFrame,
  kp: n(p, 'kp'),
  deadDeg: n(p, 'dead'),
})
type CtQ = ReturnType<typeof ctParams>
const ctKey = (q: CtQ) => `${q.path}|${q.frame}|${q.kp}|${q.deadDeg}`
const ctRun = memoBy(ctKey, (q: CtQ) => {
  const run = ptTrackRun(q)
  return { ...run, stats: ptStats(run) }
})
const CT = { slow: 0.5, rest: 1, floor: [-8.6, -3.2, 0] as V3, k: 6, tilt: -1.2, scale: 0.04, lensZ: 0.3, grid: [SIDE_SCOPE.x, 1.4, 0] as V3, dw: 64, dh: 48, pitch: 0.14, zoom: 2.5, scopeY: -5.3, scopeH: 3.4, range: 30 }
const LOOP_CODE = (fps: number, q: CtQ) => [
  `// every frame, ${fixedText(fps, 1)} fps`,
  'e = atan((cx0 - x̄) / f);  // px → degrees',
  `if (abs(e) > ${fixedText(q.deadDeg, 1)}) cmd += ${q.kp} * e * T;`,
  'pan.write(round(cmd));    // whole degrees',
  '// same for tilt with y\u0304',
]

export const cameraTrackerColourTrackingLoop: Lesson = {
  id: 'camera-tracker-colour-tracking-loop',
  title: 'Colour tracking loop',
  tagline: 'Two copies of the centroid loop, one per servo: work in degrees, keep the frame small so the loop is fast, and stop chasing errors smaller than a servo step',
  formula: (p) => {
    const q = ctParams(p)
    const R = ctRun(q)
    return `e = atan((W − 1)/2 − x̄) / f) ° · |e| > ${fixedText(q.deadDeg, 1)}° → cmd += Kp·e·T = ${q.kp} × e × ${fixedText(1000 / R.fps, 0)} ms · write(round(cmd)) · ball lag ≈ ball rate / Kp · result ${fixedText(R.latencyMs, 0)} ms old`
  },
  legend: [
    { color: GREY, label: 'Ball angle: pan (grey), tilt (blue)', shape: 'dot' },
    { color: RING, label: 'Pan servo', shape: 'dot' },
    { color: HEAT, label: 'Tilt servo', shape: 'dot' },
    { color: HIGH_V, label: 'Ball not in the frame: hold', shape: 'dot' },
  ],
  points: [
    'This is Perception › Colour tracking › Centroid steering twice over: x̄ steers the pan servo, ȳ the tilt. The ball is 1 m away on a wall; the rig is the one from Pan-tilt rig.',
    'Turn the pixel error into degrees first, atan(offset / f). Then the same Kp works on every frame size and lens; in raw pixels a VGA frame has 4 × the error of QQVGA and the gain you tuned on one shakes on the other.',
    'Rate = Kp·e, added to the servo command each frame (Control › PID: the servo position integrates, so P alone centres a still ball). A moving ball leaves a lag of about ball rate ÷ Kp: raise Kp until it rings.',
    'Frame size is the delay. VGA sees further but its result is 0.28 s old at 6.5 fps: the Kp that tracks well at QVGA overshoots, and the ball leaves the frame. Small frames, fast loop.',
    'The servo takes whole degrees. On a still ball the command creeps past a half degree, the horn jumps 1°, the error flips and it creeps back: the camera twitches for ever. A dead zone of about half a degree (one servo step) stops it; wider costs aim.',
  ],
  controls: [
    { kind: 'choice', key: 'path', options: opts(PT_PATHS), initial: 'circle' },
    { kind: 'choice', key: 'frame', options: opts(FRAME_NAMES), initial: 'qvga' },
    { kind: 'slider', key: 'kp', label: 'Kp (°/s per °)', min: 2, max: 20, step: 1, initial: 8, format: (v) => `${v}` },
    { kind: 'slider', key: 'dead', label: 'Dead zone ±', min: 0, max: 1.5, step: 0.1, initial: 0, format: (v) => `${v.toFixed(1)}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const D = PT_TRACK.distM
    const { g, head } = rigStage(scene, CT.floor, CT.k, CT.tilt, CT.scale, [1.2, 1.15, 0.45], CT.lensZ - 0.135)
    const wall = add(g, new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), new THREE.MeshStandardMaterial({ color: '#8a909c', roughness: 0.9 })), [0, D + 0.01, 0.425])
    wall.rotation.x = Math.PI / 2
    wall.receiveShadow = true
    const ball = add(g, new THREE.Mesh(new THREE.SphereGeometry(PT_RIG.ballR, 24, 16), new THREE.MeshStandardMaterial({ color: '#d4261e', roughness: 0.45 })), [0, D - PT_RIG.ballR, CT.lensZ])
    ball.castShadow = true
    const rods = rodPool(g, 5)
    const wallPt = (x: number, y: number): V3 => [-x, D - 0.004, CT.lensZ + y]
    const onWall = (x: number, y: number): V3 => wallPt(Math.max(-0.85, Math.min(0.85, x)), Math.max(-CT.lensZ, Math.min(0.85 - CT.lensZ, y)))
    const L0: V3 = [0, 0.02, CT.lensZ]

    const grid = pixelGrid(scene, CT.grid, CT.dw, CT.dh, CT.pitch)
    const gridTag = liveLabel(scene, [CT.grid[0], CT.grid[1] + (CT.dh * CT.pitch) / 2 + 0.7, 0.2], { size: 0.32 })
    const marks = rodPool(scene, 4)
    const ring = ringMarks(scene, 1)
    const cell = (x: number, y: number) => gridPoint(grid.cell, x, y)

    addLabel(scene, 'ESP32 loop', [-15.6, -5.0, 0.3], LABEL, 0.34, 'left')
    const code = codeListing(scene, [-15.6, -5.9, 0.3], 5, 13, 0.28)
    const plot = sideScope(scene, CT.scopeY, CT.scopeH, { divs: [6, 4] })
    const tr = [GREY, RING, B_FIELD, HEAT].map((c, i) => plot.trace(c, { samples: 300, radius: i % 2 ? 0.06 : 0.045 }))
    scopeLabels(scene, CT.scopeY, CT.scopeH, PT_TRACK.seconds, `angle ±${CT.range}°`, 'ball · pan · tilt')
    const yA = (a: number) => Math.max(-1, Math.min(1, a / CT.range)) * (CT.scopeH / 2)
    let clock = lapseClock(PT_TRACK.seconds, CT.slow, CT.rest)
    const st = { key: '', shot: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = ctParams(p)
        const R = ctRun(q)
        const key = ctKey(q)
        if (key !== st.key) {
          Object.assign(st, { key, shot: -1 })
          clock = lapseClock(PT_TRACK.seconds, CT.slow, CT.rest)
          code.set(LOOP_CODE(R.fps, q), 2, (l) => (l.startsWith('//') ? GREY : LABEL))
        }
        const t = clock(dt, key)
        const s: PtSample = fixedStepAt(R.samples, t, R.sampleDt)
        const [bx, by] = ptBallAt(q.path, s.t)
        ball.position.set(-bx, D - PT_RIG.ballR, CT.lensZ + by)
        head.set(s.pan * DEG, s.tilt * DEG)
        const tint = s.seen ? RING : HIGH_V
        const c0 = ptRayToWall(s.pan, s.tilt, 0, 0)
        if (c0) rods.set(0, L0, wallPt(...c0), 0.006, tint)
        const tx = Math.tan((LENSES[PT_TRACK.lens].fov / 2) * DEG)
        const ty = (tx * R.h) / R.w
        const corners = [[tx, ty], [-tx, ty], [-tx, -ty], [tx, -ty]].map(([l, u]) => ptRayToWall(s.pan, s.tilt, l, u))
        corners.forEach((a, i) => {
          const b = corners[(i + 1) % 4]
          if (a && b) rods.set(1 + i, onWall(...a), onWall(...b), 0.004, tint)
          else rods.hideFrom(1 + i)
        })
        rods.commit()
        const shot = R.shots[s.frame]
        if (shot && s.frame !== st.shot) {
          st.shot = s.frame
          showImg(grid, ptShotImg(shot, R.w, CT.dw, CT.dh, CT.zoom))
          const kx = (CT.dw * CT.zoom) / R.w
          const mx = (CT.dw - 1) / 2
          const my = (CT.dh - 1) / 2
          marks.set(0, cell(mx, -0.6), cell(mx, CT.dh - 0.4), 0.02, GREY)
          marks.set(1, cell(-0.6, my), cell(CT.dw - 0.4, my), 0.02, GREY)
          if (shot.cx !== null && shot.cy !== null) {
            const [x, y] = ptShotPx(shot.cx, shot.cy, R.w, CT.dw, CT.dh, CT.zoom)
            ring.set(0, cell(x, y), Math.max(0.3, (shot.ball[2] * kx + 1) * CT.pitch), POWER)
            marks.set(2, cell(mx, y), cell(x, y), 0.04, RING)
            marks.set(3, cell(x, my), cell(x, y), 0.04, HEAT)
          } else {
            ring.hideFrom(0)
            marks.hideFrom(2)
          }
          marks.commit()
          ring.commit()
          gridTag.set(`frame ${s.frame + 1} · ${FRAME_NAMES[q.frame]}, middle 2/5${shot.cx === null ? ' · no blob' : ''}`, shot.cx === null ? HIGH_V : LABEL)
        }
        traceRun(tr[0], R.samples, R.sampleDt, PT_TRACK.seconds, t, (f) => yA(f.ball[0]), 300)
        traceRun(tr[1], R.samples, R.sampleDt, PT_TRACK.seconds, t, (f) => yA(f.pan), 300)
        traceRun(tr[2], R.samples, R.sampleDt, PT_TRACK.seconds, t, (f) => yA(f.ball[1]), 300)
        traceRun(tr[3], R.samples, R.sampleDt, PT_TRACK.seconds, t, (f) => yA(f.tilt), 300)
        const miss = Math.hypot(s.ball[0] - s.pan, s.ball[1] - s.tilt)
        status.set(`${PT_PATHS[q.path]} · Kp ${q.kp} · dead zone ±${fixedText(q.deadDeg, 1)}° · ${fixedText(R.fps, 1)} fps`, LABEL)
        const still = q.path === 'hover' && s.t > 1
        if (!s.seen && s.t > 0.5) event.set('ball out of the frame: holding still until it comes back', HIGH_V)
        else if (R.stats.lostS > 0.3) event.set(`too much gain for a ${fixedText(R.latencyMs, 0)} ms old result: it overshoots and loses the ball`, HEAT)
        else if (still && R.stats.writesPerS > 1) event.set(`still ball, servos still stepping ${fixedText(R.stats.writesPerS, 1)} times a second: add a dead zone`, HEAT)
        else if (miss > 4) event.set(`lagging ${fixedText(miss, 1)}° behind the ball: more Kp, or a faster loop`, HEAT)
        else event.set(`locked on: ${fixedText(miss, 1)}° off · pan ${fixedText(s.err[0], 1)}°, tilt ${fixedText(s.err[1], 1)}° measured`, POWER)
        sub.set(`${s.t.toFixed(2)} / ${PT_TRACK.seconds} s · ${1 / CT.slow}× slower · ball on a wall ${D} m away · servo writes ${signedDeg(s.cmd[0])}, ${signedDeg(s.cmd[1])}`, GREY)
      },
      readouts: (p) => {
        const q = ctParams(p)
        const { stats, fps, latencyMs } = ctRun(q)
        return [
          { label: 'RMS aim miss after 1 s', value: `${fixedText(stats.rms, 1)}°`, tone: toneOf(stats.rms < 3, stats.rms < 8) },
          { label: 'Ball out of frame', value: `${fixedText(stats.lostS, 2)} s`, tone: stats.lostS > 0 ? 'bad' : 'ok' },
          { label: 'Servo steps per second', value: fixedText(stats.writesPerS, 1), tone: q.path === 'hover' ? toneOf(stats.writesPerS < 0.5, stats.writesPerS < 3) : undefined },
          { label: 'Loop', value: `${fixedText(fps, 1)} fps · ${fixedText(latencyMs, 0)} ms old`, tone: toneOf(fps >= 15, fps >= 10) },
        ]
      },
    }
  },
}

