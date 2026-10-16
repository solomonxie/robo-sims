import * as THREE from 'three/webgpu'
import {
  ACCELERATORS, BBox, CAM_FPS, DETECT_MODELS, DET_CAM, DET_CLASSES, Det, DetObject, P3, Plane, boxIoU, detDataset, detFrame, frameBudget, matchDets, netCost, nmsSteps,
  prAt, prCurve, runDetector, tinyMemory, travelOf, truthBoxes,
} from '../../core/physics'
import { V3, add, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { scope } from '../fx/screens'
import {
  GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, camBody, diffBot, esp32Cam, flatBox, histChart, liveLabel, memoBy, meterBar, pixelGrid, ringMarks, rodPool, setTf, showImg, statusHeader, zUp,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const f0 = (v: number) => v.toFixed(0)
const f2 = (v: number) => v.toFixed(2)
const ms = (s: number) => (!Number.isFinite(s) ? '—' : s >= 1 ? `${s.toFixed(1)} s` : s >= 0.01 ? `${f0(s * 1000)} ms` : `${(s * 1000).toFixed(1)} ms`)
const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(1)} KB`)
const macs = (m: number) => (m >= 1e9 ? `${(m / 1e9).toFixed(1)} G` : m >= 1e6 ? `${(m / 1e6).toFixed(1)} M` : `${f0(m / 1e3)} k`)
const CLS_COLOR = ['#ff6a55', '#5b8cff', '#4fd37a']
const FEAT_RGB: [number, number, number][] = [[1, 0.42, 0.33], [0.36, 0.55, 1], [0.31, 0.83, 0.48], [0.9, 0.9, 0.95]]
type Grid = ReturnType<typeof pixelGrid>
type Rods = ReturnType<typeof rodPool>

/** Box (pixel edges) as 4 rods on a pixel grid of the image size. */
function boxOnGrid(pool: Rods, i: number, grid: Grid, b: BBox, r: number, color: string, lift = 0.12) {
  const [x0, y0, x1, y1] = [b[0] - 0.5, b[1] - 0.5, b[2] - 0.5, b[3] - 0.5]
  const at = (x: number, y: number): V3 => {
    const p = grid.cell(x, y)
    return [p[0], p[1], p[2] + lift]
  }
  const c = [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)]
  c.forEach((a, j) => pool.set(i + j, a, c[(j + 1) % 4], r, color))
}

/** Feature plane → grid, values scaled by `peak`, tinted. */
function showPlane(grid: Grid, p: Plane, tint: [number, number, number], peak: number) {
  for (let i = 0; i < p.w * p.h; i++) {
    const v = Math.min(1, p.data[i] / peak) ** 0.8
    grid.set(i, 0.1 + v * tint[0], 0.11 + v * tint[1], 0.14 + v * tint[2])
  }
  grid.commit()
}

/** A stack of same-size feature planes fanned in depth, in a tilted group. */
function planeStack(scene: THREE.Object3D, at: V3, count: number, w: number, h: number, pitch: number, gap: V3) {
  const g = add(scene, new THREE.Group(), at)
  g.rotation.set(-0.2, 0.75, 0)
  return Array.from({ length: count }, (_, i) => pixelGrid(g, [gap[0] * i, gap[1] * i, gap[2] * i], w, h, pitch))
}

// --- YOLO idea: one pass of a small CNN, a grid of cells each guessing a box, then confidence threshold and NMS. ---

const SCENES: Record<string, { label: string; objs: DetObject[]; card: P3 | null }> = {
  table: { label: 'Table: ball, block, can', objs: [{ cls: 0, x: 0.55, y: 0.11, size: 0.08 }, { cls: 1, x: 0.72, y: -0.13, size: 0.08 }, { cls: 2, x: 0.8, y: 0.24, size: 0.07 }], card: [0.9, 0.0, 0.12] },
  crowd: { label: 'Two balls touching', objs: [{ cls: 0, x: 0.58, y: 0.05, size: 0.09 }, { cls: 0, x: 0.62, y: -0.05, size: 0.08 }, { cls: 2, x: 0.8, y: 0.22, size: 0.07 }], card: null },
  far: { label: 'Far and small', objs: [{ cls: 0, x: 1.05, y: 0.12, size: 0.07 }, { cls: 1, x: 1.3, y: -0.2, size: 0.07 }, { cls: 2, x: 0.9, y: -0.08, size: 0.06 }], card: [1.2, 0.3, 0.12] },
}
const sceneOf = (p: Params) => SCENES[String(p.scene)] ?? SCENES.table
const runOf = memoBy((p: Params) => String(p.scene), (p: Params) => {
  const s = sceneOf(p)
  const img = detFrame(s.objs, 48, 36, s.card, 3)
  return { img, run: runDetector(img), truth: truthBoxes(s.objs) }
})
const nmsKey = (p: Params) => [p.scene, p.thr, p.iou].join('|')
const nmsOf = memoBy(nmsKey, (p: Params) => {
  const { run, truth } = runOf(p)
  const cands = run.dets.filter((d) => d.score >= n(p, 'thr'))
  const s = nmsSteps(cands, n(p, 'iou'))
  const kept = s.kept.map((i) => cands[i])
  const m = matchDets(kept, truth)
  const tp = m.filter((x) => x.tp).length
  return { cands, ...s, keptDets: kept, tp, fp: kept.length - tp, fn: truth.length - tp }
})
const COST = netCost(48, 36)
const detText = (d: Det) => `${DET_CLASSES[d.cls]} ${f2(d.score)}`

const YO = { img: [-14.3, 0.2, 0] as V3, ip: 0.1, c1: [-7.6, -0.3, 0] as V3, c1p: 0.085, c2: [-1.6, -0.3, 0] as V3, c2p: 0.16, out: [8.4, -1.6, 0] as V3, op: 0.165, cells: [-1.6, -5.3, 0] as V3, cp: 0.42 }
const MAX_C = 24

export const objectDetectionYoloIdea: Lesson = {
  id: 'object-detection-yolo-idea',
  title: 'YOLO idea',
  tagline: 'Look once: one pass of a small convolutional net turns the image into a grid of cells, each guessing "is an object centred here, which kind, and how big". Keep the confident guesses, then let non-maximum suppression delete the duplicates',
  formula: (p) => {
    const S = nmsOf(p)
    return `48×36×3 → conv 3×3 ×4 + ReLU → pool 2 → conv 3×3 ×3 + ReLU → pool 3 → 8×6 cells × (object, class, box) · score = object × centred × class ≥ ${f2(n(p, 'thr'))} → ${S.cands.length} boxes → NMS (IoU > ${f2(n(p, 'iou'))}) → ${S.kept.length}`
  },
  legend: [
    { color: CLS_COLOR[0], label: 'Ball (red filter)', shape: 'dot' },
    { color: CLS_COLOR[1], label: 'Block (blue) / green: can', shape: 'dot' },
    { color: GREY, label: 'Box deleted by NMS', shape: 'dot' },
    { color: RING, label: 'Kept box being checked', shape: 'dot' },
  ],
  points: [
    'Older detectors slid a classifier over every window and scale: thousands of runs per image. YOLO ("you only look once") runs the net once and reads all boxes off its last feature map.',
    'The layers are the convolutions from Edges & features: 3×3 filters slid over the image, then ReLU (keep positives) and max-pool (keep the strongest of each block, halve the size). Here the first filters are hand-set colour-opponent and edge filters; a trained net learns its own, many more of them.',
    'After pooling, each pixel of the last map is one grid cell covering 6 × 6 image pixels. The cell predicts: an objectness score, class probabilities and a box (centre offset, width, height). Here the box comes from the class map\'s centroid and spread around the cell, the same moments as Colour tracking.',
    'A cell is "responsible" for an object whose centre falls inside it, so neighbouring cells see the same ball and give weaker, shifted copies. Score = objectness × how centred × class probability; a confidence threshold drops the weak ones.',
    'Non-maximum suppression: sort by score, keep the best box, delete every same-class box overlapping it by IoU (intersection ÷ union) above a limit, repeat. Too low a limit also deletes a real neighbour (two balls touching); too high leaves duplicates.',
  ],
  controls: [
    { kind: 'choice', key: 'scene', options: Object.entries(SCENES).map(([value, s]) => ({ value, label: s.label })), initial: 'table' },
    { kind: 'slider', key: 'thr', label: 'Confidence threshold', min: 0.05, max: 0.95, step: 0.05, initial: 0.25, format: (v) => f2(v) },
    { kind: 'slider', key: 'iou', label: 'NMS IoU limit', min: 0.1, max: 0.9, step: 0.05, initial: 0.45, format: (v) => f2(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const input = pixelGrid(scene, YO.img, 48, 36, YO.ip)
    const c1 = planeStack(scene, YO.c1, 4, 48, 36, YO.c1p, [0, 0, -1.3])
    const c2 = planeStack(scene, YO.c2, 3, 24, 18, YO.c2p, [0, 0, -1.4])
    const cells = pixelGrid(scene, YO.cells, 8, 6, YO.cp)
    const out = pixelGrid(scene, YO.out, 48, 36, YO.op)
    const below = (at: V3, rows: number, pitch: number, text: string, dy = 0.45) => addLabel(scene, text, [at[0], at[1] - (rows * pitch) / 2 - dy, 0], LABEL, 0.28)
    below(YO.img, 36, YO.ip, 'camera 48 × 36 × 3')
    addLabel(scene, 'conv1 ×4 + ReLU', [YO.c1[0], YO.c1[1] + 2.9, 0], LABEL, 0.28)
    addLabel(scene, 'red, blue, green, edge', [YO.c1[0], YO.c1[1] - 2.7, 0], GREY, 0.24)
    addLabel(scene, 'pool 2 → conv2 ×3', [YO.c2[0], YO.c2[1] + 2.9, 0], LABEL, 0.28)
    addLabel(scene, 'ball, block, can', [YO.c2[0], YO.c2[1] - 2.7, 0], GREY, 0.24)
    below(YO.cells, 6, YO.cp, 'pool 3 → 8 × 6 cells: objectness')
    addLabel(scene, '8 × 6 grid → boxes', [YO.out[0], YO.out[1] + (36 * YO.op) / 2 + 0.4, 0], LABEL, 0.3)
    const grid = rodPool(scene, 12)
    for (let k = 1; k < 8; k++) grid.set(k - 1, out.cell(6 * k - 0.5, -0.5).map((v, i) => (i === 2 ? v + 0.05 : v)) as V3, out.cell(6 * k - 0.5, 35.5).map((v, i) => (i === 2 ? v + 0.05 : v)) as V3, 0.012, '#4a505c')
    for (let k = 1; k < 6; k++) grid.set(6 + k, out.cell(-0.5, 6 * k - 0.5).map((v, i) => (i === 2 ? v + 0.05 : v)) as V3, out.cell(47.5, 6 * k - 0.5).map((v, i) => (i === 2 ? v + 0.05 : v)) as V3, 0.012, '#4a505c')
    grid.commit()
    const boxes = rodPool(scene, 4 * MAX_C)
    const tags = Array.from({ length: MAX_C }, () => liveLabel(scene, [0, 0, 0.3], { size: 0.24, align: 'left' }))
    const marks = ringMarks(scene, 2, 0.3)
    const st = { key: '', t: 0, phase: '' }
    return {
      scene,
      view: { center: [-2.4, -0.8, 0], radius: 50, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const R = runOf(p)
        const S = nmsOf(p)
        const key = nmsKey(p)
        if (key !== st.key) {
          if (String(p.scene) !== st.key.split('|')[0]) {
            showImg(input, R.img)
            showImg(out, R.img)
            R.run.conv1.forEach((pl, i) => showPlane(c1[i], pl, FEAT_RGB[i === 1 ? 1 : i === 2 ? 2 : i], i === 3 ? 1.2 : 0.5))
            R.run.conv2.forEach((pl, i) => showPlane(c2[i], pl, FEAT_RGB[i], 1))
            R.run.cells.forEach((c, i) => {
              const v = Math.min(1, c.obj * 1.1)
              const col = new THREE.Color(CLS_COLOR[c.cls])
              cells.set(i, 0.05 + v * col.r, 0.05 + v * col.g, 0.06 + v * col.b)
            })
            cells.commit()
          }
          st.key = key
          st.t = 0
          st.phase = ''
        }
        st.t += dt
        const steps = S.steps
        const T0 = 1.6
        const per = 1.4
        const loop = T0 + per * steps.length + 3
        const t = st.t % loop
        const k = t < T0 ? -1 : Math.min(steps.length, Math.floor((t - T0) / per))
        const blink = t >= T0 && k < steps.length && (t - T0) % per > per * 0.45
        const phase = `${k}|${blink}`
        if (phase === st.phase) return
        st.phase = phase
        const dropped = new Set(steps.slice(0, Math.max(0, k)).flatMap((s) => s.drop))
        const keptSoFar = new Set(steps.slice(0, Math.max(0, k)).map((s) => s.keep))
        const cur = k >= 0 && k < steps.length ? steps[k] : null
        let r = 0
        S.cands.forEach((d, i) => {
          if (r >= MAX_C || dropped.has(i)) return
          const dropping = !!cur?.drop.includes(i)
          const isCur = cur?.keep === i
          const firm = keptSoFar.has(i) || isCur
          const color = dropping ? (blink ? GREY : HIGH_V) : isCur ? RING : CLS_COLOR[d.cls]
          boxOnGrid(boxes, 4 * r, out, d.box, firm ? 0.05 : 0.025, color, 0.12 + 0.01 * r)
          const tl = out.cell(d.box[0] - 0.5, d.box[1] - 0.5)
          tags[r].group.position.set(tl[0], tl[1] + 0.22, 0.4)
          const crowded = !cur && S.cands.slice(0, i).some((e, j) => !dropped.has(j) && Math.abs(e.box[0] - d.box[0]) < 3 && Math.abs(e.box[1] - d.box[1]) < 2)
          tags[r].set((firm || dropping || !cur) && !crowded ? detText(d) : '', color)
          r++
        })
        boxes.hideFrom(4 * r)
        for (let i = r; i < MAX_C; i++) tags[i].set('', GREY)
        boxes.commit()
        if (cur) {
          const d = S.cands[cur.keep]
          marks.set(0, out.cell(6 * d.cell[0] + 2.5, 6 * d.cell[1] + 2.5).map((v, i) => (i === 2 ? v + 0.2 : v)) as V3, 0.35, RING)
          marks.set(1, cells.cell(d.cell[0], d.cell[1]).map((v, i) => (i === 2 ? v + 0.2 : v)) as V3, 0.24, RING)
        } else marks.hideFrom(0)
        marks.commit()
        status.set(`${sceneOf(p).label} · ${S.cands.length} cells scored ≥ ${f2(n(p, 'thr'))} → ${S.kept.length} boxes after NMS`, LABEL)
        sub.set(`one pass: ${macs(COST.macs)} multiply-adds, ${COST.params} weights · cell = 6 × 6 px`, GREY)
        if (k < 0) event.set(`${S.cands.length} raw boxes: every confident cell draws one`, LABEL)
        else if (cur) {
          const d = S.cands[cur.keep]
          const ious = cur.drop.map((j) => f2(boxIoU(d.box, S.cands[j].box)))
          event.set(`NMS step ${k + 1}: keep ${detText(d)}${cur.drop.length ? ` · delete ${cur.drop.length} overlapping (IoU ${ious.join(', ')})` : ' · nothing overlaps it'}`, cur.drop.length ? HEAT : POWER)
        } else event.set(S.fp ? `${S.kept.length} kept: ${S.fp} not matching a real object (duplicate or merged)` : S.fn ? `${S.kept.length} kept, ${S.fn} object missed` : `${S.kept.length} kept: one box per object`, S.fp || S.fn ? HEAT : POWER)
      },
      readouts: (p) => {
        const S = nmsOf(p)
        return [
          { label: 'Boxes above threshold', value: `${S.cands.length} of 48 cells` },
          { label: 'Kept after NMS', value: `${S.kept.length}` },
          { label: 'Right / wrong / missed', value: `${S.tp} / ${S.fp} / ${S.fn}`, tone: S.fp + S.fn === 0 ? 'ok' : S.fp + S.fn === 1 ? 'warn' : 'bad' },
          { label: 'Cost per frame', value: `${macs(COST.macs)} MACs` },
        ]
      },
    }
  },
}

// --- Running on an ESP32-CAM: shrink the input and the numbers until it fits; measure what that costs on a labelled set. ---

const RES = { r48: '48 × 36 input', r24: '24 × 18 input' }
const WEIGHTS = { int8: 'int8', f32: 'float32' }
const CHIPS = { esp32: 'ESP32-CAM', esp32s3: 'ESP32-S3 camera' }
const SET_N = 24
const resOf = (p: Params): [number, number] => (pick(RES, p.res, 'r48') === 'r24' ? [24, 18] : [48, 36])
const DATA = memoBy(() => 'set', () => detDataset(SET_N, 1))
const framesOf = memoBy((p: Params) => String(p.res), (p: Params) => {
  const [w, h] = resOf(p)
  return DATA({}).map((d, i) => ({ img: detFrame(d.objs, w, h, d.card, i + 1), truth: truthBoxes(d.objs, w, h) }))
})
const evalKey = (p: Params) => [p.res, p.weights].join('|')
const evalOf = memoBy(evalKey, (p: Params) => {
  const int8 = pick(WEIGHTS, p.weights, 'int8') === 'int8'
  let nT = 0
  const per = framesOf(p).map((f) => {
    const dets = runDetector(f.img, { int8 }).dets
    const s = nmsSteps(dets, 0.45)
    nT += f.truth.length
    return { ...f, m: matchDets(s.kept.map((i) => dets[i]), f.truth) }
  })
  const scored = per.flatMap((f) => f.m.map((x) => ({ score: x.det.score, tp: x.tp })))
  return { per, scored, nT, ...prCurve(scored, nT) }
})
const budgetOf = (p: Params) => {
  const [w, h] = resOf(p)
  const int8 = pick(WEIGHTS, p.weights, 'int8') === 'int8'
  const chip = ACCELERATORS[pick(CHIPS, p.chip, 'esp32')]
  const c = netCost(w, h)
  const model = { name: '', w, h, macs: c.macs, params: c.params }
  return { chip, int8, w, h, b: frameBudget(chip, model, int8), person: frameBudget(chip, { ...model, w: 96, h: 96, macs: 7.5e6 }, true), mem: tinyMemory(w, h, int8) }
}

const EC = { cam: [-14.2, -0.6, 0] as V3, img: [-4.6, -0.4, 0] as V3, size: 7.6, pr: [8.4, -0.4, 0] as V3, prW: 6, prH: 5.2, bar: 0.5 }

export const objectDetectionRunningOnAnEsp32Cam: Lesson = {
  id: 'object-detection-running-on-an-esp32-cam',
  title: 'Running on an ESP32-CAM',
  tagline: 'A microcontroller has about 300 KB of fast RAM and no GPU. Shrink the input, store weights as 8-bit integers, and measure on a labelled set what the shrinking costs in precision and recall',
  formula: (p) => {
    const B = budgetOf(p)
    return `${B.w}×${B.h} → ${macs(netCost(B.w, B.h).macs)} MACs ÷ ${macs(B.int8 ? B.chip.int8 : B.chip.f32)}MAC/s = ${ms(B.b.netS)} · frame every max(1/${CAM_FPS} s camera, work) → ${B.b.fps.toFixed(1)} fps · RAM ${kb(B.mem.total)} of ${kb(B.mem.sram)}`
  },
  legend: [
    { color: POWER, label: 'Detection matching a labelled box', shape: 'dot' },
    { color: HIGH_V, label: 'Wrong detection (false positive)', shape: 'dot' },
    { color: LABEL, label: 'Labelled box nobody found (miss)', shape: 'dot' },
    { color: RING, label: 'Precision and recall at the threshold', shape: 'dot' },
  ],
  points: [
    'The ESP32-CAM\'s ESP32 runs at 240 MHz with about 320 KB of data RAM plus 4 MB of slower PSRAM. The camera frame alone (160 × 120, 2 bytes per pixel) is 38 KB; activations for each layer must fit beside it.',
    'int8 quantization stores each weight and activation as one byte on a scale (w ≈ step × integer). Four times less memory and integer math the chip does fast; the boxes barely move. TFLite Micro and ESP-DL run int8 models this way.',
    'Fewer pixels cost quadratically less but small objects shrink to a pixel or two: at 24 × 18 the filters cannot separate them from the floor, and recall collapses. Real ESP32 detectors run at 96 × 96 to 160 × 160.',
    'Precision = right ÷ all detections, recall = found ÷ all labelled objects, matched at IoU ≥ 0.5. Raising the threshold trades recall for precision; the curve shows every trade-off and its area is the average precision (AP).',
    'This net is tiny (about 250 k multiply-adds), so the camera, not the net, sets the frame rate. A 96 × 96 person detector needs ~7.5 M; the ESP32-S3\'s vector instructions (ESP-NN) make that about 5× faster. Bigger models need an accelerator (next lesson).',
  ],
  controls: [
    { kind: 'choice', key: 'res', options: opts(RES), initial: 'r48' },
    { kind: 'choice', key: 'weights', options: opts(WEIGHTS), initial: 'int8' },
    { kind: 'choice', key: 'chip', options: opts(CHIPS), initial: 'esp32' },
    { kind: 'slider', key: 'thr', label: 'Confidence threshold', min: 0.05, max: 0.95, step: 0.05, initial: 0.3, format: (v) => f2(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    esp32Cam(scene, EC.cam, 0.12)
    const grids = { r48: pixelGrid(scene, EC.img, 48, 36, EC.size / 48), r24: pixelGrid(scene, EC.img, 24, 18, EC.size / 24) }
    const imgTag = liveLabel(scene, [EC.img[0], EC.img[1] + (36 * EC.size) / 96 + 0.5, 0], { size: 0.3 })
    const boxes = rodPool(scene, 4 * 16)
    const pr = scope(scene, EC.prW, EC.prH, { divs: [10, 10], zeroAt: 0 })
    pr.group.position.set(...EC.pr)
    const curve = pr.trace(RING, { samples: 120, radius: 0.06 })
    addLabel(scene, 'precision', [EC.pr[0] - EC.prW / 2 - 0.3, EC.pr[1] + 0.2, 0.3], LABEL, 0.26, 'right')
    addLabel(scene, 'recall →', [EC.pr[0] + EC.prW / 2, EC.pr[1] - EC.prH / 2 - 0.85, 0.3], LABEL, 0.26, 'right')
    addLabel(scene, '1', [EC.pr[0] - EC.prW / 2 - 0.3, EC.pr[1] + EC.prH / 2 - 0.75, 0.3], GREY, 0.24, 'right')
    addLabel(scene, '0', [EC.pr[0] - EC.prW / 2 - 0.3, EC.pr[1] - EC.prH / 2, 0.3], GREY, 0.24, 'right')
    const prTag = liveLabel(scene, [EC.pr[0], EC.pr[1] + EC.prH / 2 + 0.6, 0.3], { size: 0.3 })
    const dot = ringMarks(scene, 1, 0.45)
    const barGroup = (x: number) => {
      const g = add(scene, new THREE.Group(), [x, -6.2, 0])
      g.scale.setScalar(EC.bar)
      return g
    }
    const ramBar = meterBar(barGroup(-12.6), [0, 0, 0], 10, 320 * 1024, [[160 * 120 * 2, 'frame', GREY]], 'RAM')
    const timeBar = meterBar(barGroup(3.4), [0, 0, 0], 10, 0.25, [[1 / CAM_FPS, '1/25 s', GREY]], 'work')
    const st = { key: '', idx: -1, t: 0 }
    return {
      scene,
      view: { center: [-2.4, -0.8, 0], radius: 50, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const E = evalOf(p)
        const B = budgetOf(p)
        const thr = n(p, 'thr')
        const res = pick(RES, p.res, 'r48')
        st.t += dt
        const idx = Math.floor(st.t / 1.6) % SET_N
        const key = `${evalKey(p)}|${p.chip}|${thr}`
        if (key === st.key && idx === st.idx) return
        const fresh = key !== st.key
        st.key = key
        st.idx = idx
        const F = E.per[idx]
        const grid = grids[res]
        grids.r48.mesh.visible = res === 'r48'
        grids.r24.mesh.visible = res === 'r24'
        showImg(grid, F.img)
        let r = 0
        const kept = F.m.filter((x) => x.det.score >= thr)
        kept.forEach((x) => {
          if (r < 16) boxOnGrid(boxes, 4 * r++, grid, x.det.box, 0.04, x.tp ? POWER : HIGH_V)
        })
        F.truth.forEach((t) => {
          const hit = kept.some((x) => x.tp && x.det.cls === t.cls && iouAtLeast(x.det.box, t.box))
          if (!hit && r < 16) boxOnGrid(boxes, 4 * r++, grid, t.box, 0.02, LABEL, 0.1)
        })
        boxes.hideFrom(4 * r)
        boxes.commit()
        const at = prAt(E.scored, E.nT, thr)
        imgTag.set(`labelled scene ${idx + 1} of ${SET_N} · ${B.w} × ${B.h} px`, LABEL)
        if (!fresh) return
        const pts = [{ r: 0, p: 1 }, ...E.pts]
        curve.points(pts.map((q) => q.r), pts.map((q) => (q.p - 0.5) * EC.prH))
        dot.set(0, [EC.pr[0] - EC.prW / 2 + at.r * EC.prW, EC.pr[1] - EC.prH / 2 + at.p * EC.prH, 0.3], 0.3, RING)
        dot.commit()
        prTag.set(`AP ${f2(E.ap)} · P ${f2(at.p)}, R ${f2(at.r)} at ${f2(thr)}`, LABEL)
        ramBar(B.mem.total, kb(B.mem.total), B.mem.total < 0.6 * B.mem.sram ? POWER : B.mem.total < B.mem.sram ? HEAT : HIGH_V)
        const busy = B.b.preS + B.b.netS + B.b.postS
        timeBar(busy, ms(busy), B.b.cameraBound ? POWER : HEAT)
        status.set(`${B.chip.name} · ${B.w} × ${B.h} ${B.int8 ? 'int8' : 'float32'} · ${SET_N} labelled scenes, ${E.nT} objects`, LABEL)
        sub.set(`net ${ms(B.b.netS)} + resize ${ms(B.b.preS)} · weights ${kb(B.mem.weights)}, activations ${kb(B.mem.activations)} · a 96 × 96 person detector here: ${ms(B.person.netS)}`, GREY)
        event.set(
          E.ap < 0.7 ? `AP ${f2(E.ap)}: objects are only 2–8 px across, blurred into the floor` : at.r < 0.6 ? `threshold ${f2(thr)} keeps only sure boxes: ${at.fn} of ${E.nT} objects missed` : at.p < 0.8 ? `threshold ${f2(thr)} lets ${at.fp} wrong boxes through` : `${at.tp} of ${E.nT} found, ${at.fp} wrong at threshold ${f2(thr)}`,
          E.ap < 0.7 || at.r < 0.6 || at.p < 0.8 ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const E = evalOf(p)
        const B = budgetOf(p)
        const at = prAt(E.scored, E.nT, n(p, 'thr'))
        return [
          { label: 'Average precision', value: f2(E.ap), tone: E.ap > 0.7 ? 'ok' : E.ap > 0.4 ? 'warn' : 'bad' },
          { label: 'Precision / recall', value: `${f2(at.p)} / ${f2(at.r)}`, tone: Math.min(at.p, at.r) > 0.75 ? 'ok' : Math.min(at.p, at.r) > 0.5 ? 'warn' : 'bad' },
          { label: 'Net time per frame', value: ms(B.b.netS) },
          { label: 'Frame rate', value: `${B.b.fps.toFixed(1)} fps${B.b.cameraBound ? ' (camera)' : ''}`, tone: B.b.fps >= 10 ? 'ok' : 'warn' },
        ]
      },
    }
  },
}
const iouAtLeast = (a: BBox, b: BBox) => boxIoU(a, b) >= 0.5

// --- Edge accelerators: the same frame on chips from an ESP32 to a Jetson; what the robot covers while it waits. ---

const ACC_KEYS = Object.keys(ACCELERATORS)
const MODEL_OPTS = { fastest: 'YOLO-Fastest 320', ssd: 'SSDLite 300', yolov8n: 'YOLOv8n 640', tiny: 'Tiny net 48 × 36' }
const accOf = (p: Params) => (ACC_KEYS.includes(String(p.acc)) ? String(p.acc) : 'coral')
const accKey = (p: Params) => [p.model, p.acc, p.speed].join('|')
const accRun = memoBy(accKey, (p: Params) => {
  const model = DETECT_MODELS[pick(MODEL_OPTS, p.model, 'ssd')]
  const all = ACC_KEYS.map((k) => ({ k, a: ACCELERATORS[k], b: frameBudget(ACCELERATORS[k], model, true) }))
  const sel = all.find((x) => x.k === accOf(p))!
  const v = n(p, 'speed')
  return { model, all, sel, v, travel: travelOf(v, sel.b.fps, sel.b.latencyS) }
})
const AX = { bars: [-15.4, -2.6, 0] as V3, bw: 11.4, bh: 4.6, floor: [-1.9, -1.4, 0] as V3, k: 5.0, run: 2.0 }
const LOGF = [-1, 3]
const fpsU = (f: number) => Math.max(0.01, Math.min(1, (Math.log10(Math.max(f, 1e-3)) - LOGF[0]) / (LOGF[1] - LOGF[0])))

export const objectDetectionEdgeAccelerators: Lesson = {
  id: 'object-detection-edge-accelerators',
  title: 'Edge accelerators',
  tagline: 'Real detectors need 0.1 to 5 billion multiply-adds per frame. Neural accelerators do thousands of int8 multiply-adds per clock; pick one by frames per second, latency, watts and whether the model fits',
  formula: (p) => {
    const R = accRun(p)
    const b = R.sel.b
    return `${macs(R.model.macs)} MACs ÷ ${macs(R.sel.a.int8)}MAC/s + overhead = ${ms(b.netS)} → ${b.fps.toFixed(1)} fps (camera ${CAM_FPS}) · latency = frame + resize + net + NMS = ${ms(b.latencyS)} · at ${R.v.toFixed(1)} m/s: ${f0(R.travel.between * 100)} cm between results, ${f0(R.travel.stale * 100)} cm stale`
  },
  legend: [
    { color: RING, label: 'Selected chip (ring)', shape: 'dot' },
    { color: POWER, label: 'Faster than the camera / a result arrives', shape: 'dot' },
    { color: HEAT, label: 'Slower than the camera', shape: 'dot' },
    { color: HIGH_V, label: 'Robot moved from frame taken to result', shape: 'dot' },
  ],
  points: [
    'An NPU / TPU is a grid of int8 multiply-accumulate units fed from on-chip memory: Coral Edge TPU 4 TOPS, Hailo-8L 13 TOPS, Jetson Orin Nano up to 40 TOPS (GPU + tensor cores). Effective speed on real nets is a fraction of the peak; the bars use measured-style rates.',
    'The model must be compiled for the chip (Edge TPU compiler, Hailo Dataflow Compiler, TensorRT), int8 only for most NPUs. Layers it cannot run fall back to the host CPU and can dominate the time; weights beyond the on-chip memory stream in per frame.',
    'Throughput (fps) and latency differ: with a pipeline the next frame is captured while the last one is in the net, so fps is set by the slowest stage, latency by the sum. The robot acts on where things were one latency ago.',
    'Power matters on a robot: an ESP32 runs a tiny net at 0.5 W, a USB TPU adds 2 W, a Jetson about 10 W. Energy per inference (W × s) is the fair way to compare.',
    'Cheap trick before buying hardware: a smaller input, a lighter model (YOLO-Fastest, FOMO) or detecting only every n-th frame and tracking in between (Colour tracking, Optical flow).',
  ],
  controls: [
    { kind: 'choice', key: 'model', options: opts(MODEL_OPTS), initial: 'ssd' },
    { kind: 'choice', key: 'acc', options: ACC_KEYS.map((k) => ({ value: k, label: ACCELERATORS[k].name })), initial: 'coral' },
    { kind: 'slider', key: 'speed', label: 'Robot speed', min: 0.1, max: 2, step: 0.1, initial: 0.6, format: (v) => `${v.toFixed(1)} m/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const chart = histChart(scene, AX.bars, AX.bw, AX.bh, ACC_KEYS.length, { left: '', right: '', markers: 0 })
    const camY = AX.bars[1] + fpsU(CAM_FPS) * AX.bh
    const camLine = rodPool(scene, 1)
    camLine.set(0, [AX.bars[0] - 0.1, camY, 0.25], [AX.bars[0] + AX.bw + 0.1, camY, 0.25], 0.035, LABEL)
    camLine.commit()
    ACC_KEYS.forEach((k, i) => addLabel(scene, ACCELERATORS[k].short, [AX.bars[0] + ((i + 0.5) * AX.bw) / ACC_KEYS.length, AX.bars[1] - 0.55, 0.3], LABEL, 0.28))
    ;[0.1, 1, 10, 100, 1000].forEach((f) => addLabel(scene, `${f}`, [AX.bars[0] - 0.3, AX.bars[1] + fpsU(f) * AX.bh - 0.12, 0.3], GREY, 0.24, 'right'))
    addLabel(scene, `inferences per second the chip could do (log) · line: camera ${CAM_FPS} fps`, [AX.bars[0], AX.bars[1] + AX.bh + 1.1, 0.3], LABEL, 0.28, 'left')
    const barTags = ACC_KEYS.map((_, i) => liveLabel(scene, [AX.bars[0] + ((i + 0.5) * AX.bw) / ACC_KEYS.length, AX.bars[1] - 1.1, 0.3], { size: 0.22, color: GREY }))
    const sel = ringMarks(scene, 1, 0.3)
    const g = zUp(scene, AX.floor, AX.k, 0.5, 0)
    for (let i = 0; i < 11; i++) for (let j = 0; j < 4; j++) flatBox(g, [0.25, 0.25, 0.004], mat((i + j) % 2 ? '#464a52' : '#767064', { rough: 0.85 }), [-0.25 + (i + 0.5) * 0.25, -0.5 + (j + 0.5) * 0.25, -0.002])
    const ball = add(g, mesh(new THREE.SphereGeometry(0.05, 20, 14), mat('#d63a2e', { rough: 0.5 })), [2.3, 0, 0.05])
    ball.castShadow = true
    const bot = diffBot(g)
    const cam = add(g, new THREE.Group())
    camBody(cam, 0.035)
    const seen = ringMarks(g, 40, 0.35)
    const lag = rodPool(g, 40)
    const st = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-2.4, -0.8, 0], radius: 50, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const R = accRun(p)
        const key = accKey(p)
        if (key !== st.key) {
          st.key = key
          st.t = 0
          chart.set(R.all.map((x) => (x.b.fits ? fpsU(1 / x.b.netS) : 0.01)), (i) => {
            const c = new THREE.Color(R.all[i].b.cameraBound ? POWER : HEAT)
            return [c.r, c.g, c.b]
          }, 1)
          R.all.forEach((x, i) => {
            const f = 1 / x.b.netS
            barTags[i].set(!x.b.fits ? 'no fit' : f < 1 ? f.toFixed(2) : f0(f), x.k === R.sel.k ? RING : GREY)
          })
          const i = ACC_KEYS.indexOf(R.sel.k)
          sel.set(0, [AX.bars[0] + ((i + 0.5) * AX.bw) / ACC_KEYS.length, AX.bars[1] - 1.75, 0.3], 0.28, RING)
          sel.commit()
          const b = R.sel.b
          status.set(`${R.model.name} on ${R.sel.a.name} · ${macs(R.model.macs)} MACs, ${R.model.params < 1e5 ? f0(R.model.params) : `${(R.model.params / 1e6).toFixed(2)} M`} weights`, LABEL)
          sub.set(!b.fits ? 'does not run here: weights do not fit or no int8 engine' : `net ${ms(b.netS)} · ${b.fps.toFixed(1)} fps · latency ${ms(b.latencyS)} · ${R.sel.a.watts} W → ${(b.energyJ * 1000).toFixed(1)} mJ per inference`, GREY)
          event.set(
            !b.fits ? 'pick a smaller model or a bigger chip' : b.cameraBound ? `camera-limited: the chip idles ${f0(100 * (1 - b.netS * CAM_FPS))} % of the time` : R.travel.between > 0.3 ? `the robot drives ${f0(R.travel.between * 100)} cm blind between results` : `${f0(R.travel.between * 100)} cm between results, each ${f0(R.travel.stale * 100)} cm out of date`,
            !b.fits || R.travel.between > 0.3 ? HIGH_V : b.cameraBound ? POWER : HEAT,
          )
        }
        st.t = (st.t + dt) % (AX.run / R.v + 1.5)
        const b = R.sel.b
        const x = Math.min(AX.run, R.v * st.t)
        bot.set({ x, y: 0, th: 0 })
        setTf(cam, DET_CAM.map((v, i) => (i === 3 ? v + x + 0.03 : i === 11 ? v - 0.12 : v)))
        let k = 0
        if (b.fits)
          for (let j = 0; k < 40; j++) {
            const tShot = j / b.fps
            const tDone = tShot + b.latencyS
            if (tDone > st.t || R.v * tDone > AX.run) break
            seen.set(k, [R.v * tDone, 0, 0.003] as V3, 0.05, POWER)
            lag.set(k, [R.v * tShot, 0.03 * (k % 2 ? 1 : -1), 0.012], [R.v * tDone, 0.03 * (k % 2 ? 1 : -1), 0.012], 0.01, HIGH_V)
            k++
          }
        seen.hideFrom(k)
        lag.hideFrom(k)
        seen.commit()
        lag.commit()
      },
      readouts: (p) => {
        const R = accRun(p)
        const b = R.sel.b
        return [
          { label: 'Frame rate', value: b.fits ? `${b.fps.toFixed(1)} fps` : 'does not fit', tone: !b.fits ? 'bad' : b.fps >= 15 ? 'ok' : b.fps >= 3 ? 'warn' : 'bad' },
          { label: 'Latency', value: b.fits ? ms(b.latencyS) : '—', tone: !b.fits ? 'bad' : b.latencyS < 0.1 ? 'ok' : b.latencyS < 0.5 ? 'warn' : 'bad' },
          { label: 'Energy per inference', value: b.fits ? `${(b.energyJ * 1000).toFixed(1)} mJ at ${R.sel.a.watts} W` : '—' },
          { label: 'Travel between results', value: b.fits ? `${f0(R.travel.between * 100)} cm` : '—', tone: !b.fits ? 'bad' : R.travel.between < 0.1 ? 'ok' : R.travel.between < 0.3 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}
