import * as THREE from 'three/webgpu'
import {
  CHECKER_FLOOR, DEG, Mat4, P3, RenderScene, inImage, mapImg, TAG_BITS, TAG_CELLS, TAG_CORRECT, TAG_DICT, apply4, applyH, camTf, chain4, findTags, grainImg, intrinsicsOf, mul4, projectPx, renderView, resizeImg,
  robotFromTag, rotAbout4, spread3, tagBits, tagCorners, tagJitterRun, tagPlate, trans4, wallTagTf, wrapPi,
} from '../../core/physics'
import { V3, add, box, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, camBody, checkerTiles, diffBot, frameTriad, liveLabel, memoBy, pixelGrid, ringMarks, rodPool, setTf, showImg, statusHeader, zUp,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const f0 = (v: number) => v.toFixed(0)
const f1 = (v: number) => v.toFixed(1)
const f2 = (v: number) => v.toFixed(2)
const cm = (m: number) => (m >= 1 ? `${f2(m)} m` : `${f0(m * 100)} cm`)
const mm = (m: number) => (m >= 0.1 ? `${f1(m * 100)} cm` : `${f1(m * 1000)} mm`)
const hexGrey = (v: number) => `#${Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0').repeat(3)}`
type V2 = [number, number]

const WALL: [number, number, number] = [96, 104, 118]
const FOV = 50

/** Printed tag on a post, built in tag coords (x right, y up, z out of the face); `set(code, size, flip)` repaints it. */
function tagModel(parent: THREE.Object3D) {
  const g = add(parent, new THREE.Group())
  const white = mat('#ecece6', { rough: 0.7 })
  const black = mat('#1a1c20', { rough: 0.7 })
  const back = add(g, mesh(new THREE.PlaneGeometry(1, 1), white))
  const cells = Array.from({ length: TAG_CELLS * TAG_CELLS }, () => add(g, mesh(new THREE.PlaneGeometry(1, 1), black)))
  const post = box(parent, [0.02, 0.02, 1], mat('#5a5f69', { rough: 0.6 }), [0, 0, 0])
  for (const m of [back, ...cells]) m.castShadow = false
  return {
    g,
    set(tf: Mat4, code: number, size: number, flip: readonly number[] = []) {
      setTf(g, tf)
      const c = size / TAG_CELLS
      back.scale.set(size + 2 * c, size + 2 * c, 1)
      back.position.z = 0.001
      const bits = tagBits(code)
      cells.forEach((m, i) => {
        const [r, k] = [Math.floor(i / TAG_CELLS), i % TAG_CELLS]
        const inner = r > 0 && k > 0 && r < TAG_CELLS - 1 && k < TAG_CELLS - 1
        const b = inner ? (r - 1) * TAG_BITS + (k - 1) : -1
        m.visible = !inner || bits[b] === (flip.includes(b) ? 1 : 0)
        m.scale.set(c, c, 1)
        m.position.set(-size / 2 + (k + 0.5) * c, size / 2 - (r + 0.5) * c, 0.002)
      })
      const top = tf[11] - size / 2 - c
      post.scale.z = Math.max(0.01, top)
      post.position.set(tf[3] - tf[2] * 0.012, tf[7] - tf[6] * 0.012, top / 2)
    },
  }
}

/** Camera → the 4 tag corners (rods i…i+3). */
function sightLines(pool: ReturnType<typeof rodPool>, i: number, Twc: Mat4, tag: Mat4, size: number, color: string) {
  const o: V3 = [Twc[3], Twc[7], Twc[11]]
  tagCorners(size).forEach((p, j) => pool.set(i + j, o, apply4(tag, p) as V3, 0.0025, color))
}

/** Quad outline on a pixel grid (4 rods from i). */
function quadOnGrid(pool: ReturnType<typeof rodPool>, i: number, cell: (c: number, r: number) => V3, q: readonly V2[], s: number, r: number, color: string) {
  q.forEach((a, j) => {
    const b = q[(j + 1) % 4]
    const [pa, pb] = [cell(a[0] * s, a[1] * s), cell(b[0] * s, b[1] * s)]
    pool.set(i + j, [pa[0], pa[1], pa[2] + 0.1], [pb[0], pb[1], pb[2] + 0.1], r, color)
  })
}

// --- Detecting a tag: threshold → quads → unwarp → bits → ID with error correction. ---

const DET = { size: 0.1, cam: [0, 0, 0.15] as P3, w: 80, h: 60, noise: 3, at: [-12.8, -2.6, 0] as V3, img: [-0.2, -0.8, 0] as V3, pitch: 0.14, bits: [9.6, -0.8, 0] as V3, cell: 0.75, code: 5 }
const SMUDGE = [5, 10, 3]
const STAGES = { image: 'Camera image', mask: 'Adaptive threshold' }
const DET_K = intrinsicsOf(DET.w, DET.h, FOV)
const DET_CAM = camTf(DET.cam, 0, 0)
const DET_FLOOR = { x: [0, 1.6] as [number, number], y: [-0.5, 0.5] as [number, number] }

const detKey = (p: Params) => ['dist', 'angle', 'roll', 'smudge'].map((k) => p[k]).join('|')
const detParams = memoBy(detKey, (p: Params) => {
  const dist = n(p, 'dist')
  const angle = n(p, 'angle') * DEG
  const roll = n(p, 'roll') * DEG
  const flip = SMUDGE.slice(0, n(p, 'smudge'))
  const tag = wallTagTf([dist, 0, DET.cam[2]], Math.PI + angle, roll)
  const code = TAG_DICT[DET.code]
  const scene: RenderScene = { floor: { ...CHECKER_FLOOR, ...DET_FLOOR }, plates: [tagPlate(tag, code, DET.size, flip)], sky: WALL }
  const img = grainImg(renderView(DET_K, DET_CAM, scene, DET.w, DET.h, undefined, 2), DET.noise, 1)
  const scan = findTags(img)
  const hit = scan.tags[0] ?? null
  const truth = tagCorners(DET.size).map((c) => projectPx(DET_K, DET_CAM, apply4(tag, c)))
  const widthPx = Math.max(...truth.map((t) => t[0])) - Math.min(...truth.map((t) => t[0]))
  return { maskView: mapImg(scan.mask, (v) => 255 - v), dist, angle, roll, flip, tag, img, scan, hit, widthPx, cellPx: widthPx / TAG_CELLS }
})

export const fiducialMarkersDetectingATag: Lesson = {
  id: 'fiducial-markers-detecting-a-tag',
  title: 'Detecting a tag',
  tagline: 'A tag is a black square with a few bits inside. Find dark four-sided shapes, straighten each one, read its cells and look the code up, fixing a couple of bad bits on the way',
  formula: (p) => {
    const S = detParams(p)
    const h = S.hit
    return `dark if I < local mean − 10 → ${S.scan.quads.length + S.scan.rejects.length} outlines → ${S.scan.quads.length} quads → H: cells → pixels → ${TAG_BITS * TAG_BITS} bits → nearest of ${TAG_DICT.length} codes × 4 turns${h ? `: Hamming d = ${h.dist} ≤ ${TAG_CORRECT} → ID ${h.id}` : ': no match'}`
  },
  legend: [
    { color: POWER, label: 'Decoded tag outline (ring = corner 0)', shape: 'dot' },
    { color: HEAT, label: 'Quad that failed the border or code check', shape: 'dot' },
    { color: GREY, label: 'Dark blob that is not a clean quad', shape: 'dot' },
    { color: HIGH_V, label: 'Bit read wrong and fixed by the code', shape: 'dot' },
  ],
  points: [
    'A fiducial tag (ArUco, AprilTag) is made to be found: a thick black border, a white margin, and a small grid of black/white bits inside. Here 4 × 4 bits, 6 × 6 cells with the border.',
    'Step 1, adaptive threshold: a pixel is "dark" if it is darker than the average of its neighbourhood. One global level (Image basics → Thresholding) fails when the light is uneven; a local one does not.',
    'Step 2, find quads: label the dark blobs, keep those whose outer edge is four straight lines, and intersect the lines for sub-pixel corners. Floor tiles and shadows drop out here.',
    'Step 3, unwarp and read: the 4 corners give a homography from the 6 × 6 cell grid to the image (Camera model → Calibration), so each cell centre can be sampled even when the tag is tilted. The border must read black, the inside gives 16 bits.',
    'Step 4, decode: compare with every code in the dictionary in all 4 turns. Codes are at least 6 bits apart, so up to 2 wrong bits still land nearest the right code, and the best turn says which corner is corner 0. Below about 3 px per cell the bits blur and the tag is lost.',
  ],
  controls: [
    { kind: 'choice', key: 'stage', options: opts(STAGES), initial: 'image' },
    { kind: 'slider', key: 'dist', label: 'Distance to the tag', min: 0.25, max: 1.5, step: 0.05, initial: 0.45, format: (v) => cm(v) },
    { kind: 'slider', key: 'angle', label: 'Tag turned away', min: -70, max: 70, step: 5, initial: 30, format: (v) => `${v}°` },
    { kind: 'slider', key: 'roll', label: 'Tag rolled in its plane', min: -180, max: 180, step: 5, initial: 20, format: (v) => `${v}°` },
    { kind: 'slider', key: 'smudge', label: 'Smudged bits', min: 0, max: 3, step: 1, initial: 1, format: (v) => `${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = zUp(scene, DET.at, 7.5, 0.5, 0.75)
    checkerTiles(g, DET_FLOOR.x, DET_FLOOR.y)
    const cam = add(g, new THREE.Group())
    camBody(cam, 0.08)
    setTf(cam, DET_CAM)
    const tagM = tagModel(g)
    const sight = rodPool(g, 4)

    const grid = pixelGrid(scene, DET.img, DET.w, DET.h, DET.pitch)
    const imgTag = liveLabel(scene, [DET.img[0], DET.img[1] + (DET.h * DET.pitch) / 2 + 0.55, 0], { size: 0.32 })
    const outline = rodPool(scene, 4 * 8)
    const corners = ringMarks(scene, 5)

    const half = (TAG_CELLS * DET.cell) / 2
    const cellAt = (i: number): V3 => [DET.bits[0] - half + ((i % TAG_CELLS) + 0.5) * DET.cell, DET.bits[1] + half - (Math.floor(i / TAG_CELLS) + 0.5) * DET.cell, DET.bits[2]]
    const tiles = Array.from({ length: TAG_CELLS * TAG_CELLS }, (_, i) => {
      const m = new THREE.MeshBasicMaterial({ color: '#000000' })
      const t = add(scene, mesh(new THREE.PlaneGeometry(DET.cell * 0.92, DET.cell * 0.92), m), cellAt(i))
      t.castShadow = false
      return { t, m }
    })
    const bitRings = ringMarks(scene, TAG_CELLS * TAG_CELLS, 0.3)
    addLabel(scene, 'unwarped cells', [DET.bits[0], DET.bits[1] + half + 0.55, 0], LABEL, 0.32)
    const verdict = liveLabel(scene, [DET.bits[0], DET.bits[1] - half - 0.6, 0], { size: 0.34 })
    const verdict2 = liveLabel(scene, [DET.bits[0], DET.bits[1] - half - 1.25, 0], { size: 0.28, color: GREY })
    const st = { key: '', stage: '', t: 0, shown: -1, rings: [] as ({ at: V3; color: string } | null)[] }
    return {
      scene,
      view: { center: [-2.4, -0.8, 0], radius: 50, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = detParams(p)
        const stage = pick(STAGES, p.stage, 'image')
        st.t = (st.t + dt / 4) % 1
        const shown = Math.min(TAG_CELLS * TAG_CELLS, Math.floor((st.t / 0.7) * TAG_CELLS * TAG_CELLS))
        const h = S.hit
        tiles.forEach(({ t }, i) => (t.visible = !!h && i < shown))
        if (shown !== st.shown) {
          st.shown = shown
          st.rings.forEach((r, i) => (r && i < shown ? bitRings.set(i, r.at, DET.cell * 0.28, r.color) : bitRings.set(i, [0, 0, -50], 0, GREY)))
          bitRings.commit()
        }
        if (h && shown < TAG_CELLS * TAG_CELLS) {
          const [u, v] = applyH(h.H, [(shown % TAG_CELLS) + 0.5, Math.floor(shown / TAG_CELLS) + 0.5])
          corners.set(4, grid.cell(u, v).map((x, i) => (i === 2 ? x + 0.15 : x)) as V3, 0.16, RING)
        } else corners.hideFrom(4)
        if (!h) corners.hideFrom(0)
        corners.commit()
        const key = detKey(p)
        if (key === st.key && stage === st.stage) return
        st.key = key
        st.stage = stage
        tagM.set(S.tag, TAG_DICT[DET.code], DET.size, S.flip)
        sightLines(sight, 0, DET_CAM, S.tag, DET.size, RING)
        sight.commit()
        showImg(grid, stage === 'mask' ? S.maskView : S.img)
        imgTag.set(`${DET.w} × ${DET.h} ${stage === 'mask' ? 'mask: black = darker than local mean − 10' : 'camera image'} · tag ${f0(S.widthPx)} px wide`, LABEL)
        let r = 0
        S.scan.rejects.forEach((q) => r < 8 && quadOnGrid(outline, 4 * r++, grid.cell, q.corners, 1, 0.03, GREY))
        S.scan.quads.forEach((q) => r < 8 && (!h || q !== h.quad) && quadOnGrid(outline, 4 * r++, grid.cell, q.corners, 1, 0.04, HEAT))
        if (h) quadOnGrid(outline, 4 * r++, grid.cell, h.corners, 1, 0.05, POWER)
        outline.hideFrom(4 * r)
        outline.commit()
        if (h) h.corners.forEach((c, i) => corners.set(i, grid.cell(c[0], c[1]).map((x, j) => (j === 2 ? x + 0.12 : x)) as V3, i === 0 ? 0.32 : 0.16, i === 0 ? POWER : LABEL))
        corners.commit()
        tiles.forEach(({ m }, i) => {
          m.color.set(hexGrey(h ? h.samples[i] : 0))
          const [rr, cc] = [Math.floor(i / TAG_CELLS), i % TAG_CELLS]
          const inner = rr > 0 && cc > 0 && rr < TAG_CELLS - 1 && cc < TAG_CELLS - 1
          const b = (rr - 1) * TAG_BITS + (cc - 1)
          const fixed = h && inner && h.fixed.includes(b)
          st.rings[i] = h && inner ? { at: [...cellAt(i).slice(0, 2), 0.05] as V3, color: fixed ? HIGH_V : h.bits[b] ? '#1a1c20' : '#ecece6' } : null
        })
        st.shown = -1
        if (h) {
          verdict.set(`ID ${h.id} · turned ${h.rot * 90}°`, POWER)
          verdict2.set(h.dist ? `${h.dist} bit${h.dist > 1 ? 's' : ''} fixed` : 'no bit errors', h.dist ? HIGH_V : GREY)
        } else {
          verdict.set('no tag decoded', HIGH_V)
          verdict2.set(S.scan.quads.length ? 'border or code check failed' : 'no clean quad', GREY)
        }
        status.set(`tag ${cm(DET.size)} wide, ${cm(S.dist)} away, turned ${n(p, 'angle')}°, rolled ${n(p, 'roll')}°`, LABEL)
        sub.set(`${S.scan.quads.length + S.scan.rejects.length} dark outlines → ${S.scan.quads.length} quad${S.scan.quads.length === 1 ? '' : 's'} → ${h ? `ID ${h.id}` : 'nothing decoded'} · ${f1(S.cellPx)} px per cell`, GREY)
        event.set(
          h ? (h.dist ? `${h.dist} of 16 bits read wrong, still within ${TAG_CORRECT} of one code: fixed` : 'all 16 bits match a code exactly')
            : S.cellPx < 3 ? 'cells under 3 px: bits blur together, the tag is lost'
            : S.flip.length > TAG_CORRECT ? `${S.flip.length} smudged bits: more than the code can fix, so the tag is refused, not misread`
            : 'tag not found: too steep or too close to the edge',
          h ? POWER : HIGH_V,
        )
      },
      readouts: (p) => {
        const S = detParams(p)
        const h = S.hit
        return [
          { label: 'Tag width in the image', value: `${f0(S.widthPx)} px` },
          { label: 'Pixels per cell', value: f1(S.cellPx), tone: S.cellPx >= 4 ? 'ok' : S.cellPx >= 3 ? 'warn' : 'bad' },
          { label: 'Quads / outlines', value: `${S.scan.quads.length} / ${S.scan.quads.length + S.scan.rejects.length}` },
          { label: 'Decoded', value: h ? `ID ${h.id}, d = ${h.dist}` : 'none', tone: h ? (h.dist ? 'warn' : 'ok') : 'bad' },
        ]
      },
    }
  },
}

// --- Pose from a tag: 4 corners → H → [R|t], the robot's map pose by chaining transforms, and how much it jitters. ---

const POSE = { tag: [1.7, 0, 0.12] as P3, camOn: [0.04, 0, 0.12] as P3, frames: 24, code: 2, at: [-12.2, -3.2, 0] as V3, img: [-0.4, 0.6, 0] as V3, pitch: 0.1, plot: [8.6, 0.3, 0] as V3, plotW: 4.6 }
const RES = { r40: '40 × 30', r60: '60 × 45', r80: '80 × 60' }
const RES_WH: Record<keyof typeof RES, [number, number]> = { r40: [40, 30], r60: [60, 45], r80: [80, 60] }
const POSE_FLOOR = { x: [0, 2] as [number, number], y: [-1, 1] as [number, number] }
const POSE_TAG = wallTagTf(POSE.tag, Math.PI)
const ROBOT_CAM = camTf(POSE.camOn, 0, 0)
const SHOW = { w: 80, h: 60 }

const poseOf = (M: Mat4) => ({ x: M[3], y: M[7], th: Math.atan2(M[4], M[0]) })
const poseKey = (p: Params) => ['dist', 'angle', 'size', 'res', 'noise'].map((k) => p[k]).join('|')
const poseParams = memoBy(poseKey, (p: Params) => {
  const dist = n(p, 'dist')
  const angle = n(p, 'angle') * DEG
  const size = n(p, 'size') / 100
  const res = pick(RES, p.res, 'r80')
  const noise = n(p, 'noise')
  const [w, h] = RES_WH[res]
  const k = intrinsicsOf(w, h, FOV)
  const robot = chain4(trans4([POSE.tag[0] - dist * Math.cos(angle), POSE.tag[1] - dist * Math.sin(angle), 0]), rotAbout4(2, angle))
  const Twc = mul4(robot, ROBOT_CAM)
  const run = tagJitterRun({ k, Twc, worldTag: POSE_TAG, code: TAG_DICT[POSE.code], size, noise, frames: POSE.frames, scene: { floor: { ...CHECKER_FLOOR, ...POSE_FLOOR }, sky: WALL } })
  const truth = poseOf(robot)
  const [c, s] = [Math.cos(angle), Math.sin(angle)]
  const ests = run.frames.map((f) => {
    if (!f.pose) return null
    const R = poseOf(robotFromTag(POSE_TAG, f.pose, ROBOT_CAM))
    const [dx, dy] = [R.x - truth.x, R.y - truth.y]
    return { ...R, along: dx * c + dy * s, side: -dx * s + dy * c, dth: wrapPi(R.th - truth.th), camTag: f.pose }
  })
  const got = ests.filter((e) => e !== null)
  const [sA, sS] = spread3(got.map((e) => [e.along, e.side, 0] as P3))
  const tagRange = Math.hypot(run.truth[3], run.truth[7], run.truth[11])
  const rangeErr = run.frames.flatMap((f) => (f.pose ? [Math.hypot(f.pose[3], f.pose[7], f.pose[11]) - tagRange] : []))
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0)
  const rangeBias = mean(rangeErr)
  const rangeSd = spread3(rangeErr.map((x) => [x, 0, 0] as P3))[0]
  const posErr = mean(got.map((e) => Math.hypot(e.along, e.side)))
  const headErr = mean(got.map((e) => Math.abs(e.dth)))
  const shown = run.frames.map((f) => (w === SHOW.w ? f.img : resizeImg(f.img, SHOW.w, SHOW.h, 'nearest')))
  const reach = Math.max(0.002, 2.4 * Math.max(sA, sS), ...got.map((e) => Math.max(Math.abs(e.along), Math.abs(e.side))))
  const scale = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1].find((x) => x >= reach) ?? 1
  const inView = tagCorners(size).every((corner) => {
    const [u, v, z] = projectPx(k, Twc, apply4(POSE_TAG, corner))
    return z > 0 && inImage(k, u, v)
  })
  return { inView, dist, angle, size, res, noise, k, w, h, robot, Twc, run, truth, ests, got, sA, sS, tagRange, rangeBias, rangeSd, posErr, headErr, shown, scale, widthPx: (k.fx * size) / dist }
})

export const fiducialMarkersPoseFromATag: Lesson = {
  id: 'fiducial-markers-pose-from-a-tag',
  title: 'Pose from a tag',
  tagline: 'Four corners of a square of known size are enough to say where the camera is. Chain that with where the tag hangs on the map and the robot knows where it stands, give or take the jitter',
  formula: (p) => {
    const S = poseParams(p)
    return `H from 4 corners (tag plane → pixels) → [r1 r2 t] = λ·K⁻¹·H → world←robot = world←tag · (cam←tag)⁻¹ · (robot←cam)⁻¹ · range jitter ∝ z²·σ/(f·s): ${f2(S.dist)}² m² / (${f0(S.k.fx)} px · ${f2(S.size)} m)`
  },
  legend: [
    { color: LABEL, label: 'True tag and robot', shape: 'dot' },
    { color: POWER, label: 'Pose from this frame (axes, ghost robot)', shape: 'dot' },
    { color: RING, label: 'Every frame\'s robot position estimate', shape: 'dot' },
    { color: HEAT, label: '±2σ spread', shape: 'dot' },
  ],
  points: [
    'The tag\'s corners are known in its own frame: (±s/2, ±s/2, 0). Four matches give the homography H from the tag plane to the image, and with K from calibration, H = K·[r1 r2 t]: the same step as Camera model → Calibration, now on one small square.',
    'That gives camera ← tag. The tag is fixed on the map (world ← tag) and the camera fixed on the robot (robot ← camera), so world ← robot is one chain of transforms (Kinematics → Coordinate frames). One glimpse of one tag localises the robot in x, y and heading.',
    'Every frame has a little noise and pixelation, so each corner is off by a fraction of a pixel. The distance to the tag survives that well: it comes from the tag\'s size in the image, and its error grows like z²/(f·s).',
    'The tilt of the tag does not: a small square seen nearly face-on looks almost the same turned a few degrees either way. Placing the robot needs that tilt, and 2° at 1 m is 3.5 cm sideways, so the cluster can sit off the true spot even without noise.',
    'Closer, bigger or sharper tags help, and so does seeing the tag at an angle. Real systems use several tags at known spots (a board), average frames, or fuse tag fixes with odometry in a filter.',
  ],
  controls: [
    { kind: 'choice', key: 'res', options: opts(RES), initial: 'r80' },
    { kind: 'slider', key: 'dist', label: 'Robot to tag', min: 0.3, max: 1.5, step: 0.05, initial: 0.6, format: (v) => cm(v) },
    { kind: 'slider', key: 'angle', label: 'Viewing angle', min: -50, max: 50, step: 5, initial: 25, format: (v) => `${v}°` },
    { kind: 'slider', key: 'size', label: 'Tag size', min: 4, max: 20, step: 1, initial: 15, format: (v) => `${v} cm` },
    { kind: 'slider', key: 'noise', label: 'Pixel noise σ', min: 0, max: 15, step: 1, initial: 5, format: (v) => `${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = zUp(scene, POSE.at, 4.6, 0.55, 0.5)
    checkerTiles(g, POSE_FLOOR.x, POSE_FLOOR.y)
    const tagM = tagModel(g)
    const tagTri = frameTriad(g, 0.12, '', LABEL, 0.004)
    setTf(tagTri.group, POSE_TAG)
    const estTri = frameTriad(g, 0.12, '', POWER, 0.006)
    const bot = diffBot(g)
    const ghost = diffBot(g, { ghost: POWER })
    const cam = add(g, new THREE.Group())
    camBody(cam, 0.04)
    const sight = rodPool(g, 4)
    const trail = ringMarks(g, POSE.frames, 0.5)

    const grid = pixelGrid(scene, POSE.img, SHOW.w, SHOW.h, POSE.pitch)
    const imgTag = liveLabel(scene, [POSE.img[0], POSE.img[1] + (SHOW.h * POSE.pitch) / 2 + 0.5, 0], { size: 0.3 })
    const outline = rodPool(scene, 4)

    const P = POSE.plot
    const half = POSE.plotW / 2
    const axes = rodPool(scene, 4 + 4)
    axes.set(0, [P[0] - half, P[1], 0], [P[0] + half, P[1], 0], 0.02, GREY)
    axes.set(1, [P[0], P[1] - half, 0], [P[0], P[1] + half, 0], 0.02, GREY)
    const frame = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => [P[0] + x * half, P[1] + y * half, 0] as V3)
    frame.forEach((a, i) => axes.set(2 + i, a, frame[(i + 1) % 4], 0.012, '#3a3e46'))
    axes.commit()
    const dots = ringMarks(scene, POSE.frames + 1, 0.45)
    addLabel(scene, 'range error →', [P[0] + half, P[1] - half - 0.45, 0], GREY, 0.26, 'right')
    addLabel(scene, '↑ side', [P[0] - half, P[1] + half + 0.3, 0], GREY, 0.26, 'left')
    const scaleTag = liveLabel(scene, [P[0] + half, P[1] + half + 0.3, 0.1], { size: 0.26, align: 'right', color: GREY })
    const plotTag = liveLabel(scene, [P[0], P[1] + half + 0.9, 0], { size: 0.3 })
    const st = { key: '', t: 0, i: -1 }
    return {
      scene,
      view: { center: [-2.4, -0.8, 0], radius: 50, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = poseParams(p)
        st.t += dt
        const key = poseKey(p)
        const fresh = key !== st.key
        const i = Math.floor(st.t * 5) % POSE.frames
        tagTri.face()
        estTri.face()
        if (fresh) {
          st.key = key
          tagM.set(POSE_TAG, TAG_DICT[POSE.code], S.size)
          bot.set(S.truth)
          setTf(cam, S.Twc)
          sightLines(sight, 0, S.Twc, POSE_TAG, S.size, RING)
          sight.commit()
          S.got.forEach((e, j) => trail.set(j, [e.x, e.y, 0.003], 0.012, RING))
          trail.hideFrom(S.got.length)
          trail.commit()
          const k = half / S.scale
          S.got.forEach((e, j) => dots.set(j, [P[0] + e.along * k, P[1] + e.side * k, 0.05], 0.09, RING))
          dots.hideFrom(S.got.length)
          axes.set(6, [P[0] - 2 * S.sA * k, P[1], 0.03], [P[0] + 2 * S.sA * k, P[1], 0.03], 0.05, HEAT)
          axes.set(7, [P[0], P[1] - 2 * S.sS * k, 0.03], [P[0], P[1] + 2 * S.sS * k, 0.03], 0.05, HEAT)
          axes.commit()
          scaleTag.set(`±${S.scale >= 0.01 ? `${Math.round(S.scale * 100)} cm` : `${Math.round(S.scale * 1000)} mm`}`, GREY)
          plotTag.set(`robot x, y from ${S.got.length} / ${POSE.frames} frames`, LABEL)
          status.set(`${RES[S.res]} camera, ${f0(S.widthPx)} px across a ${f0(S.size * 100)} cm tag at ${cm(S.dist)}`, LABEL)
          sub.set(S.got.length ? `tag range ${cm(S.tagRange)} read to ${mm(Math.abs(S.rangeBias))} ± ${mm(S.rangeSd)} · robot off by ${mm(S.posErr)} · heading ${f1(S.headErr / DEG)}°` : 'no detections in any frame', GREY)
          const verdict = !S.got.length ? (S.inView ? 'lost: below about 3 px per cell the bits cannot be read' : 'the tag runs off the image: all 4 corners must be seen')
            : Math.abs(S.rangeBias) + S.rangeSd > 0.05 ? `only ${f0(S.widthPx)} px across: range and tilt are both unreliable`
            : S.posErr > 0.02 ? `range is fine, but a ${f1(S.headErr / DEG)}° tilt error at ${cm(S.dist)} moves the robot ${mm(S.posErr)}`
            : 'steady fix: good enough to drive to a dock or reset odometry'
          event.set(verdict, !S.got.length ? HIGH_V : S.posErr > 0.02 ? HEAT : POWER)
        }
        if (i === st.i && !fresh) return
        st.i = i
        const e = S.ests[i]
        showImg(grid, S.shown[i])
        const hit = S.run.frames[i].hit
        if (hit) quadOnGrid(outline, 0, grid.cell, hit.corners, SHOW.w / S.w, 0.04, POWER)
        else outline.hideFrom(0)
        outline.commit()
        imgTag.set(`frame ${i + 1} / ${POSE.frames} · noise σ ${S.noise}${hit ? '' : ' · missed'}`, hit ? LABEL : HIGH_V)
        ghost.group.visible = estTri.group.visible = !!e
        if (e) {
          ghost.set(e)
          setTf(estTri.group, mul4(S.Twc, e.camTag))
          const k = half / S.scale
          dots.set(POSE.frames, [P[0] + e.along * k, P[1] + e.side * k, 0.08], 0.2, POWER)
        } else dots.hideFrom(POSE.frames)
        dots.commit()
      },
      readouts: (p) => {
        const S = poseParams(p)
        const ok = S.got.length > 0
        return [
          { label: 'Detected', value: `${S.got.length} / ${POSE.frames} frames`, tone: S.got.length === POSE.frames ? 'ok' : ok ? 'warn' : 'bad' },
          { label: 'Tag range error', value: ok ? `${mm(Math.abs(S.rangeBias))} ± ${mm(S.rangeSd)}` : '–', tone: !ok ? 'bad' : Math.abs(S.rangeBias) + S.rangeSd < 0.01 ? 'ok' : 'warn' },
          { label: 'Robot position error', value: ok ? mm(S.posErr) : '–', tone: !ok ? 'bad' : S.posErr < 0.02 ? 'ok' : S.posErr < 0.05 ? 'warn' : 'bad' },
          { label: 'Heading error', value: ok ? `${f1(S.headErr / DEG)}°` : '–', tone: !ok ? 'bad' : S.headErr < 2 * DEG ? 'ok' : S.headErr < 5 * DEG ? 'warn' : 'bad' },
        ]
      },
    }
  },
}
