import * as THREE from 'three/webgpu'
import {
  Img, MaskBlob, MeasFilter, NO_FILTER, PAN_CAM, PanSample, Cleanup, panFrameImg, filterDelay, findBlob, fixedStepAt, hsvMask, hsvToRgb, labelBlobs, largestBlob, maskIoU, noisyImg, panStats, panTrackRun, rgbToHsv, tabletopImg,
} from '../../core/physics'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, Rgb01, SIDE_SCOPE, addLabel, beamCone, controlLoop, esp32Cam, floorView, histChart, lapseClock, gridPoint, liveLabel, memoBy, pixelBox, pixelGrid, ringMarks, rodPool, scopeLabels, sg90Servo,
  showImg, sideScope, statusHeader, traceRun,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const f1 = (v: number) => v.toFixed(1)
const f2 = (v: number) => v.toFixed(2)
const deg = (v: number) => `${Math.round(v)}°`
const rgb01 = (c: string): Rgb01 => {
  const k = new THREE.Color(c)
  return [k.r, k.g, k.b]
}

const blobBox = (b: MaskBlob) => [b.x0, b.y0, b.x1 + 1, b.y1 + 1]

// --- HSV mask: hue window → clean-up (open / close) → connected blobs → the biggest one's box and centroid. ---

const W = 48
const H = 36
const TARGETS = { ball: 'Red ball', block: 'Green block', cup: 'Blue cup', tape: 'Yellow tape' }
const TARGET_HUE: Record<keyof typeof TARGETS, number> = { ball: 0, block: 130, cup: 220, tape: 50 }
const CLEANUPS: Record<Cleanup, string> = { none: 'No clean-up', open: 'Open', close: 'Close', both: 'Open + close' }
const HM = { cam: [-9.6, 1.6, 0] as V3, mask: [3.4, 1.6, 0] as V3, pitch: 0.245, hist: [-15.5, -6.9, 0] as V3, histW: 11.8, histH: 2.2, bins: 36, vMin: 0.15, seed: 11, maxBlobs: 16 }

const truthMask = memoBy(
  (t: string) => t,
  (t: keyof typeof TARGETS) => {
    const m = hsvMask(tabletopImg(W, H, 1), TARGET_HUE[t], 20, 0.45, HM.vMin)
    const { labels, blobs } = labelBlobs(m)
    const best = largestBlob(blobs)
    return { ...m, data: m.data.map((_, i) => (best && labels[i] === best.id + 1 ? 255 : 0)) }
  },
)

const hmParams = memoBy(
  (p: Params) => ['target', 'tol', 'smin', 'clean', 'noise', 'light'].map((k) => p[k]).join('|'),
  (p: Params) => {
    const target = pick(TARGETS, p.target, 'ball')
    const clean = pick(CLEANUPS, p.clean, 'open')
    const tol = n(p, 'tol')
    const sMin = n(p, 'smin')
    const noise = n(p, 'noise')
    const light = n(p, 'light')
    const hue = TARGET_HUE[target]
    const img = noisyImg(tabletopImg(W, H, light), noise, HM.seed)
    const found = findBlob(img, { hue, tol, sMin, vMin: HM.vMin, clean, minArea: 1 })
    const best = found.best
    const keep = { ...found.mask, data: found.mask.data.map((_, i) => (best && found.labels[i] === best.id + 1 ? 255 : 0)) }
    const hist = Array(HM.bins).fill(0) as number[]
    for (let i = 0; i < W * H; i++) {
      const [h, s, v] = rgbToHsv(img.data[3 * i], img.data[3 * i + 1], img.data[3 * i + 2])
      if (s >= sMin && v >= HM.vMin) hist[Math.min(HM.bins - 1, Math.floor(h / (360 / HM.bins)))]++
    }
    return { target, clean, tol, sMin, noise, light, hue, img, ...found, keep, hist, iou: maskIoU(keep, truthMask(target)) }
  },
)

const MASK_COLORS = { best: rgb01('#ffffff'), other: rgb01('#7d8494'), cut: rgb01('#7a2626'), added: rgb01('#2a8a98'), none: [0.03, 0.03, 0.04] as Rgb01 }

function maskView(raw: Img, clean: Img, labels: Int32Array, best: MaskBlob | null): Img {
  const out: Img = { w: raw.w, h: raw.h, ch: 3, data: new Float32Array(raw.w * raw.h * 3) }
  for (let i = 0; i < raw.w * raw.h; i++) {
    const was = raw.data[i] > 127
    const is = clean.data[i] > 127
    const c = is ? (best && labels[i] === best.id + 1 ? MASK_COLORS.best : was ? MASK_COLORS.other : MASK_COLORS.added) : was ? MASK_COLORS.cut : MASK_COLORS.none
    for (let k = 0; k < 3; k++) out.data[3 * i + k] = c[k] * 255
  }
  return out
}

export const colourTrackingHsvMask: Lesson = {
  id: 'colour-tracking-hsv-mask',
  title: 'HSV mask',
  tagline: 'Keep the pixels whose hue is close to the ball\'s, clean the specks off, group what is left into blobs and take the biggest: a box and a centre point',
  formula: (p) => {
    const S = hmParams(p)
    const b = S.best
    return `mask = |H − ${S.hue}°| ≤ ${S.tol}° and S ≥ ${f2(S.sMin)} and V ≥ ${HM.vMin} → ${CLEANUPS[S.clean].toLowerCase()} → ${S.blobs.length} blob${S.blobs.length === 1 ? '' : 's'}${b ? ` → biggest: A = ${b.area} px, centroid (x̄, ȳ) = (Σx/A, Σy/A) = (${f1(b.cx)}, ${f1(b.cy)})` : ''}`
  },
  legend: [
    { color: LABEL, label: 'Mask: white = biggest blob, grey = other blobs', shape: 'dot' },
    { color: HIGH_V, label: 'Removed by the clean-up', shape: 'dot' },
    { color: B_FIELD, label: 'Filled in by the clean-up', shape: 'dot' },
    { color: RING, label: 'Box + centroid of the biggest blob', shape: 'dot' },
  ],
  points: [
    'Start from the HSV threshold (Image basics → Thresholding): a pixel joins the mask if its hue sits inside the window and it is saturated and bright enough. Hue survives dim light; RGB levels do not.',
    'Camera noise leaves specks; specular glints leave holes. Erode (a pixel stays only if all 9 around it are set) wipes specks but shrinks shapes; dilate (any of the 9) grows them back. Erode-then-dilate = open (no specks), dilate-then-erode = close (no holes).',
    'Open has a price: anything under 3 pixels thick goes too. Pick the yellow tape and it vanishes. Close on a noisy mask glues nearby specks onto the ball.',
    'Connected-component labelling floods each touching group with its own number. Area, box and centroid (mean x, mean y) of the biggest blob are all a tracker needs: the centroid is the steering signal in the next lesson.',
    'Widen the hue window past ~25° on the yellow tape and the wooden table (hue ≈ 30°) floods in. Tight window, loose saturation; or the reverse.',
  ],
  controls: [
    { kind: 'choice', key: 'target', options: opts(TARGETS), initial: 'ball' },
    { kind: 'choice', key: 'clean', options: opts(CLEANUPS), initial: 'open' },
    { kind: 'slider', key: 'tol', label: 'Hue window ±', min: 5, max: 60, step: 1, initial: 20, format: (v) => `${v}°` },
    { kind: 'slider', key: 'smin', label: 'Min saturation', min: 0, max: 0.9, step: 0.05, initial: 0.45, format: f2 },
    { kind: 'slider', key: 'noise', label: 'Sensor noise σ', min: 0, max: 24, step: 1, initial: 10, format: (v) => `${v}` },
    { kind: 'slider', key: 'light', label: 'Light', min: 0.3, max: 1.6, step: 0.05, initial: 1, format: (v) => `${v.toFixed(2)}×` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const cam = pixelGrid(scene, HM.cam, W, H, HM.pitch)
    const mask = pixelGrid(scene, HM.mask, W, H, HM.pitch)
    const top = (H * HM.pitch) / 2 + 0.75
    const camTag = liveLabel(scene, [HM.cam[0], HM.cam[1] + top, 0], { size: 0.38 })
    const maskTag = liveLabel(scene, [HM.mask[0], HM.mask[1] + top, 0], { size: 0.38 })
    const boxes = rodPool(scene, 4 * (HM.maxBlobs + 1))
    const rings = ringMarks(scene, 2)
    const hist = histChart(scene, HM.hist, HM.histW, HM.histH, HM.bins, { left: '0°', right: '360°', markers: 2 })
    addLabel(scene, 'hue of the saturated, bright pixels', [HM.hist[0] + HM.histW / 2, HM.hist[1] + HM.histH + 1.05, 0], GREY, 0.3)
    const lines = [0, 1, 2].map((i) => liveLabel(scene, [-2.4, -5.2 - i * 0.8, 0.2], { size: i ? 0.34 : 0.42, align: 'left' }))
    const st = { key: '' }
    return {
      scene,
      view: { center: [-2.6, -0.6, 0], radius: 50, polar: Math.PI / 2, azimuth: 0 },
      frame(_dt, p) {
        const S = hmParams(p)
        const key = ['target', 'tol', 'smin', 'clean', 'noise', 'light'].map((k) => p[k]).join('|')
        if (key === st.key) return
        st.key = key
        showImg(cam, S.img)
        showImg(mask, maskView(S.raw, S.mask, S.labels, S.best))
        camTag.set(`camera ${W} × ${H} · noise σ ${S.noise} · light ${S.light.toFixed(2)}×`, LABEL)
        maskTag.set(`mask after ${CLEANUPS[S.clean].toLowerCase()} · ${S.blobs.length} blob${S.blobs.length === 1 ? '' : 's'}`, LABEL)
        let k = 0
        const others = S.blobs.filter((b) => b !== S.best).sort((a, b) => b.area - a.area).slice(0, HM.maxBlobs)
        for (const b of others) pixelBox(boxes, 4 * k++, mask.cell, blobBox(b), 0.03, GREY)
        if (S.best) {
          pixelBox(boxes, 4 * k, mask.cell, blobBox(S.best), 0.05, RING)
          pixelBox(boxes, 4 * k + 4, cam.cell, blobBox(S.best), 0.05, RING)
          k += 2
          rings.set(0, gridPoint(mask.cell, S.best.cx, S.best.cy), 0.32, RING)
          rings.set(1, gridPoint(cam.cell, S.best.cx, S.best.cy), 0.32, RING)
        } else rings.hideFrom(0)
        boxes.hideFrom(4 * k)
        boxes.commit()
        rings.commit()
        hist.set(S.hist, (i) => hsvToRgb((i + 0.5) * (360 / HM.bins), 0.85, 0.95).map((c) => c / 255) as Rgb01)
        hist.marker(0, (((S.hue - S.tol) % 360) + 360) % 360 / 360, RING, deg((S.hue - S.tol + 360) % 360))
        hist.marker(1, ((S.hue + S.tol) % 360) / 360, RING, deg((S.hue + S.tol) % 360))
        const b = S.best
        const name = TARGETS[S.target]
        const specks = S.blobs.length - (b ? 1 : 0)
        lines[0].set(
          !b ? `${name}: nothing left in the mask` : S.iou < 0.5 ? `${name}: the wrong blob is biggest` : specks > 0 ? `${name} + ${specks} stray blob${specks === 1 ? '' : 's'}` : `${name}: one clean blob`,
          !b || S.iou < 0.5 ? HIGH_V : specks > 0 ? HEAT : POWER,
        )
        lines[1].set(b ? `A = ${b.area} px · box ${b.x0}…${b.x1} × ${b.y0}…${b.y1} · centroid (${f1(b.cx)}, ${f1(b.cy)})` : 'no blob: widen the hue window or lower min S', LABEL)
        lines[2].set(`IoU with the noiseless ${name.toLowerCase()}: ${f2(S.iou)}`, GREY)
      },
      readouts: (p) => {
        const S = hmParams(p)
        const b = S.best
        return [
          { label: 'Blobs', value: `${S.blobs.length}`, tone: S.blobs.length === 1 ? 'ok' : S.blobs.length === 0 ? 'bad' : 'warn' },
          { label: 'Biggest blob', value: b ? `${b.area} px · ${b.x1 - b.x0 + 1} × ${b.y1 - b.y0 + 1}` : '–' },
          { label: 'Centroid', value: b ? `(${f1(b.cx)}, ${f1(b.cy)}) px` : '–' },
          { label: 'IoU with the true target', value: f2(S.iou), tone: S.iou > 0.75 ? 'ok' : S.iou > 0.5 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}

// --- Centroid steering: the blob's x offset drives a pan servo; frame rate, gain and D decide if it locks on, lags or rings. ---

const PATHS = { step: 'Ball pops up 25° left', sweep: 'Ball swings side to side', dash: 'Ball rolls across' }
const CS = { slow: 0.5, rest: 1.2, floor: [-8.6, -2.4, 0] as V3, k: 14, tilt: -0.8, grid: [SIDE_SCOPE.x, 2.2, 0] as V3, pitch: 0.17, scopeY: -5.3, scopeH: 3.4, range: 60 }

const csParams = (p: Params) => {
  const path = pick(PATHS, p.path, 'sweep')
  const alpha = n(p, 'alpha')
  const filter: MeasFilter = alpha >= 0.999 ? NO_FILTER : { kind: 'ema', alpha }
  return { path, kp: n(p, 'kp'), kd: n(p, 'kd'), fps: n(p, 'fps'), alpha, filter }
}
type CsCfg = ReturnType<typeof csParams>
const csKey = (c: CsCfg) => `${c.path}|${c.kp}|${c.kd}|${c.fps}|${c.alpha}`
const csRun = memoBy(csKey, (c: CsCfg) => {
  const run = panTrackRun({ kp: c.kp, kd: c.kd, fps: c.fps, filter: c.filter, path: c.path })
  return { ...run, stats: panStats(run.samples) }
})
const latencyMs = (c: CsCfg) => (1000 / c.fps) * 1 + filterDelay(c.filter, 1 / c.fps) * 1000

export const colourTrackingCentroidSteering: Lesson = {
  id: 'colour-tracking-centroid-steering',
  title: 'Centroid steering',
  tagline: 'How far the blob sits from the image centre is the error; turn the camera to shrink it. The loop is only as fast as the frames that feed it',
  formula: (p) => {
    const c = csParams(p)
    return `e = (W − 1)/2 − x̄ (px, + = ball left) · pan rate = Kp·e + Kd·ė = ${c.kp}·e${c.kd > 0 ? ` + ${c.kd}·ė` : ''} °/s · one frame late: ${Math.round(1000 / c.fps)} ms at ${c.fps} fps${c.alpha < 1 ? ` · EMA α ${f1(c.alpha)}` : ''}`
  },
  legend: [
    { color: GREY, label: 'Ball angle', shape: 'dot' },
    { color: RING, label: 'Camera pan angle (SG90)', shape: 'dot' },
    { color: POWER, label: 'Centroid used by the loop (filtered)', shape: 'dot' },
    { color: HIGH_V, label: 'Ball outside the frame: search', shape: 'dot' },
  ],
  points: [
    'The mask and centroid come from the HSV mask lesson. The error is just the centroid\'s offset from the middle column, in pixels: no angles, no camera model.',
    'Pan rate ∝ error: P control (see Control → PID). The servo integrates the rate into an angle, so P alone centres a still ball with no leftover error.',
    'A camera loop is a delayed loop: the frame is grabbed, processed, and acted on one frame later. At 5 fps that is 200 ms: the same Kp that locks on at 30 fps now overshoots, rings and can throw the ball out of view.',
    'A moving ball leaves a steady lag (ball rate ÷ Kp). More Kp shrinks it until the delay makes it ring. Kd on a raw, jittery centroid mostly adds twitch; behind a filter it trims a little overshoot, but the filter adds delay too. The real cure is more frames per second. Same story as Line following, with a camera as the sensor.',
    'Lost the ball? Turn toward the side it was last seen, just like a line follower that slips off the tape.',
  ],
  controls: [
    { kind: 'choice', key: 'path', options: opts(PATHS), initial: 'sweep' },
    { kind: 'slider', key: 'kp', label: 'Kp (°/s per px)', min: 2, max: 30, step: 1, initial: 8, format: (v) => `${v}` },
    { kind: 'slider', key: 'kd', label: 'Kd (°/s per px/s)', min: 0, max: 1, step: 0.05, initial: 0, format: f2 },
    { kind: 'slider', key: 'fps', label: 'Camera frame rate', min: 5, max: 30, step: 5, initial: 15, format: (v) => `${v} fps` },
    { kind: 'slider', key: 'alpha', label: 'Centroid filter α (1 = off)', min: 0.2, max: 1, step: 0.1, initial: 1, format: f1 },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = floorView(scene, CS.floor, CS.k, CS.tilt)
    const floor = add(g, new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.72), new THREE.MeshStandardMaterial({ color: '#2a2c31', roughness: 0.9 })), [0, 0.26, -0.001])
    floor.receiveShadow = true
    const rail = rodPool(g, 1)
    rail.set(0, [-0.52, PAN_CAM.distM, 0.002], [0.52, PAN_CAM.distM, 0.002], 0.004, GREY)
    rail.commit()
    const servoG = add(g, new THREE.Group(), [0, -0.015, 0])
    servoG.scale.setScalar(0.03)
    const horn = sg90Servo(servoG, [0, 0, 1.1])
    const camG = add(horn, new THREE.Group(), [0, 0, 1.4])
    const board = esp32Cam(camG, [0, 0, 1.4], 0.09)
    board.group.rotation.x = -Math.PI / 2
    const cone = beamCone(g, RING)
    const aim = rodPool(g, 1)
    const ball = add(g, new THREE.Mesh(new THREE.SphereGeometry(PAN_CAM.ballR, 24, 16), new THREE.MeshStandardMaterial({ color: '#d4261e', roughness: 0.45 })), [0, PAN_CAM.distM, PAN_CAM.ballR])
    ball.castShadow = true

    const grid = pixelGrid(scene, CS.grid, PAN_CAM.w, PAN_CAM.h, CS.pitch)
    const gridTag = liveLabel(scene, [CS.grid[0], CS.grid[1] + (PAN_CAM.h * CS.pitch) / 2 + 0.7, 0], { size: 0.34 })
    const marks = rodPool(scene, 3, { heads: true })
    const ring = ringMarks(scene, 1)
    const cell = (x: number, y: number) => gridPoint(grid.cell, x, y)

    const loop = controlLoop(scene, [-9.5, -7.6, 0], { ctrl: 'PD', plant: 'SG90 pan', sensor: 'camera', w: 11, h: 3.2 })
    const plot = sideScope(scene, CS.scopeY, CS.scopeH, { divs: [6, 4] })
    const ballTr = plot.trace(GREY, { samples: 300, radius: 0.05 })
    const panTr = plot.trace(RING, { samples: 300, radius: 0.06 })
    scopeLabels(scene, CS.scopeY, CS.scopeH, PAN_CAM.seconds, `angle ±${CS.range}°`, 'ball · pan')
    const yA = (a: number) => Math.max(-1, Math.min(1, a / CS.range)) * (CS.scopeH / 2)
    const clock = lapseClock(PAN_CAM.seconds, CS.slow, CS.rest)
    const st = { frame: -1, key: '' }
    return {
      scene,
      view: { center: [-2.4, -0.8, 0], radius: 50, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const c = csParams(p)
        const R = csRun(c)
        const key = csKey(c)
        const t = clock(dt, key)
        if (key !== st.key) [st.key, st.frame] = [key, -1]
        const s: PanSample = fixedStepAt(R.samples, t, R.sampleDt)
        const fr = R.frames[s.frame]
        const pan = (s.panDeg * Math.PI) / 180
        horn.rotation.z = pan
        const bx = -Math.tan((s.ballDeg * Math.PI) / 180) * PAN_CAM.distM
        ball.position.x = bx
        cone([0, 0, 0.2], Math.PI / 2 + pan, (PAN_CAM.hfovDeg / 2) * (Math.PI / 180), 0.62, 0.12, s.seen ? RING : HIGH_V)
        aim.set(0, [0, 0, 0.06], [-Math.sin(pan) * 0.6, Math.cos(pan) * 0.6, 0.06], 0.003, s.seen ? RING : HIGH_V)
        aim.commit()
        if (s.frame !== st.frame) {
          st.frame = s.frame
          showImg(grid, panFrameImg(fr))
          const mid = (PAN_CAM.w - 1) / 2
          const yTop = -1.4
          marks.set(0, cell(mid, -0.6), cell(mid, PAN_CAM.h - 0.4), 0.025, GREY)
          if (fr.cx !== null && fr.cy !== null) {
            ring.set(0, cell(fr.cx, fr.cy), 0.5, RING)
            const used = fr.cxF ?? fr.cx
            marks.set(1, cell(used, -0.6), cell(used, PAN_CAM.h - 0.4), 0.04, POWER)
            marks.set(2, cell(mid, yTop), cell(used, yTop), 0.06, POWER)
          } else {
            ring.hideFrom(0)
            marks.hideFrom(1)
          }
          marks.commit()
          ring.commit()
          gridTag.set(`frame ${s.frame + 1} at ${c.fps} fps · ${fr.cx === null ? 'no blob' : `x̄ = ${f1(fr.cxF ?? fr.cx)} px`}`, fr.cx === null ? HIGH_V : LABEL)
        }
        traceRun(ballTr, R.samples, R.sampleDt, PAN_CAM.seconds, t, (f) => yA(f.ballDeg), 300)
        traceRun(panTr, R.samples, R.sampleDt, PAN_CAM.seconds, t, (f) => yA(f.panDeg), 300)
        const miss = s.ballDeg - s.panDeg
        loop.set(dt, { r: 0.4, e: Math.min(1, Math.abs(s.errPx) / 12), u: Math.min(1, Math.abs(s.rate) / 200), y: 0.6, m: s.seen ? 0.7 : 0 }, {
          r: 'x̄ = centre',
          e: s.seen ? `e ${f1(s.errPx)} px` : 'lost',
          u: `${Math.round(s.rate)} °/s`,
          y: `pan ${deg(s.panDeg)}`,
          m: s.seen ? 'x̄' : 'no blob',
        })
        status.set(`${PATHS[c.path]} · Kp ${c.kp}${c.kd > 0 ? ` · Kd ${c.kd}` : ''} · ${c.fps} fps`, LABEL)
        if (!s.seen && s.t > 0.2) event.set(`ball out of the frame: turning ${s.errPx >= 0 ? 'left' : 'right'}, where it was last seen`, HIGH_V)
        else if (R.stats.lostS > 0.3) event.set(`too much gain for ${Math.round(latencyMs(c))} ms of delay: the camera overshoots and loses the ball`, HEAT)
        else if (Math.abs(miss) > 8) event.set(`lagging ${deg(Math.abs(miss))} behind the ball: the loop needs a bigger error to turn faster`, HEAT)
        else event.set(`locked on: ${f1(Math.abs(miss))}° off, centroid ${f1(Math.abs(s.errPx))} px from the middle`, POWER)
        sub.set(`${t.toFixed(2)} / ${PAN_CAM.seconds} s · slowed ${1 / CS.slow}× · ${PAN_CAM.w} × ${PAN_CAM.h} frames, ${PAN_CAM.hfovDeg}° field of view, ball ${PAN_CAM.distM * 100} cm away`, GREY)
      },
      readouts: (p) => {
        const c = csParams(p)
        const { stats } = csRun(c)
        return [
          { label: 'RMS miss (ball − pan) after 1 s', value: `${f1(stats.rms)}°`, tone: stats.rms < 4 ? 'ok' : stats.rms < 12 ? 'warn' : 'bad' },
          { label: 'Worst miss', value: `${f1(stats.worst)}°`, tone: stats.worst < PAN_CAM.hfovDeg / 2 ? 'ok' : 'bad' },
          { label: 'Ball out of frame', value: `${f2(stats.lostS)} s`, tone: stats.lostS > 0 ? 'bad' : 'ok' },
          { label: 'Loop delay (frame + filter)', value: `${Math.round(latencyMs(c))} ms`, tone: latencyMs(c) > 150 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

