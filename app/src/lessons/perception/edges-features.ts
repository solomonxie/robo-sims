import * as THREE from 'three/webgpu'
import {
  EDGE, HARRIS_K, KERNELS, clamp, Warp, canny, convolveImg, cornerField, grayImg, harrisBoundary, houghLines, imgStats, lineInImg, mapImg, matchDescriptors, noisyImg, patchDescriptor,
  pickCorners, tabletopImg, warpImg, warpPoint,
} from '../../core/physics'
import { pct } from '../../core/units'
import { V3, add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, Rgb01, addLabel, asIs, glide, histChart, liveLabel, matrixGrid, memoBy, pixelGrid, ringMarks, rodPool, showImg, stretchArrow, zoomInset } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const W = 48
const H = 36
const scene0 = memoBy(() => 'scene', () => tabletopImg(W, H, 1))
const gray0 = memoBy(() => 'gray', () => grayImg(scene0(0)))
const f2 = (v: number) => v.toFixed(2)
const r0 = (v: number) => `${Math.round(v)}`
const noiseSlider = (initial: number) => ({ kind: 'slider' as const, key: 'noise', label: 'Sensor noise', min: 0, max: 40, initial, step: 1, format: (v: number) => `σ ${v}` })
const statusLines = (scene: THREE.Object3D, y: number) => [0, 1].map((i) => liveLabel(scene, [-15.5, y - i * 0.8, 0.2], { size: i ? 0.36 : 0.44, align: 'left' }))
const greyView = (px: number[]): Rgb01 => [px[0] / 255, px[0] / 255, px[0] / 255]
/** Centre of pixel (x, y) on a w × h grid of `pitch` at `at` (fractional x, y allowed). */
const cellAt = (at: V3, pitch: number, x: number, y: number, z = 0.12): V3 => [at[0] + (x - (W - 1) / 2) * pitch, at[1] + ((H - 1) / 2 - y) * pitch, at[2] + z]

// --- Convolution: a small grid of weights slides over the image; each output pixel = weighted sum of its neighbourhood. ---

const KERNS = { box: 'Box blur', gauss: 'Gaussian', sharpen: 'Sharpen', sobelX: 'Sobel X', sobelY: 'Sobel Y' }
type KernKey = keyof typeof KERNS
const CV = { inAt: [-9.7, 1.2, 0] as V3, outAt: [9.7, 1.2, 0] as V3, pitch: 0.24, inset: [0, -0.4, 0] as V3, cell: 1.4, kern: [0, 4.3, 0] as V3, seed: 5, signed: 400 }
const KERN_SCALE: Partial<Record<KernKey, number>> = { box: 9, gauss: 16 }
const KERN_TEXT: Record<KernKey, string[]> = {
  box: Array(9).fill('1'),
  gauss: ['1', '2', '1', '2', '4', '2', '1', '2', '1'],
  sharpen: KERNELS.sharpen.flat().map(String),
  sobelX: KERNELS.sobelX.flat().map(String),
  sobelY: KERNELS.sobelY.flat().map(String),
}
const isSigned = (k: KernKey) => k === 'sobelX' || k === 'sobelY'
const signedView = (v: number): Rgb01 => {
  const t = clamp(v / CV.signed, -1, 1)
  return t >= 0 ? [t, 0.62 * t, 0.18 * t] : [-0.25 * t, -0.6 * t, -t]
}
const outView = (k: KernKey) => (px: number[]): Rgb01 => (isSigned(k) ? signedView(px[0]) : greyView(px))

const cvParams = memoBy(
  (p: Params) => `${p.kernel}|${p.noise}`,
  (p: Params) => {
    const kernel = pick(KERNS, p.kernel, 'gauss')
    const noise = n(p, 'noise')
    const k = KERNELS[kernel]
    const input = noisyImg(gray0(0), noise, CV.seed)
    const out = convolveImg(input, k)
    const clean = convolveImg(gray0(0), k)
    const resid = imgStats({ ...out, data: out.data.map((v, i) => v - clean.data[i]) })
    const inResid = imgStats({ ...input, data: input.data.map((v, i) => v - gray0(0).data[i]) })
    return { kernel, noise, k, input, out, sum: k.flat().reduce((a, b) => a + b, 0), noiseIn: inResid.std, noiseOut: resid.std }
  },
)

export const edgesFeaturesConvolution: Lesson = {
  id: 'edges-features-convolution',
  title: 'Convolution',
  tagline: 'Slide a 3 × 3 grid of weights over the image and add up weight × pixel. The same move blurs, sharpens or finds edges, depending only on the nine numbers',
  formula: (p) => {
    const S = cvParams(p)
    return `out(x, y) = Σ k(i, j) · in(x + i, y + j), i, j ∈ −1 … 1 · ${KERNS[S.kernel]}: weights sum to ${f2(S.sum)}${S.sum === 0 ? ' → flat areas give 0, only changes survive' : ' → flat areas keep their level'} · noise σ ${f2(S.noiseIn)} → ${f2(S.noiseOut)}`
  },
  legend: (p) => [
    { color: LABEL, label: 'Input grey image 48 × 36 (see Image basics)', shape: 'dot' },
    { color: RING, label: 'Box = 3 × 3 window under the kernel', shape: 'dot' },
    ...(isSigned(pick(KERNS, p.kernel, 'gauss'))
      ? [{ color: HEAT, label: 'Output > 0: brighter to the right / below', shape: 'dot' as const }, { color: '#5b8cff', label: 'Output < 0: darker to the right / below', shape: 'dot' as const }]
      : [{ color: POWER, label: 'Output fills in as the window slides', shape: 'dot' as const }]),
  ],
  points: [
    'Convolution (strictly, correlation) visits every pixel, lays the 3 × 3 kernel over it and its 8 neighbours, multiplies each pair and adds the nine products. That sum is the output pixel.',
    'Blur kernels are all positive and sum to 1: flat areas keep their level, noise averages out. The box blurs evenly, the Gaussian weights the centre more and gives softer, rounder results.',
    'Sharpen is 5 × centre minus the 4 neighbours: it sums to 1 but exaggerates any difference, so edges pop and noise is amplified.',
    'Sobel kernels sum to 0: flat areas give 0, a left-to-right rise gives a big positive number. Sobel X sees vertical edges, Sobel Y horizontal ones: the first step of edge detection.',
  ],
  controls: [
    { kind: 'choice', key: 'kernel', options: opts(KERNS), initial: 'gauss' },
    noiseSlider(8),
    { kind: 'slider', key: 'speed', label: 'Slide speed', min: 20, max: 800, initial: 160, log: true, format: (v) => `${Math.round(v)} px/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const gIn = pixelGrid(scene, CV.inAt, W, H, CV.pitch)
    const gOut = pixelGrid(scene, CV.outAt, W, H, CV.pitch)
    const top = CV.inAt[1] + (H * CV.pitch) / 2 + 0.8
    addLabel(scene, 'input', [CV.inAt[0], top, 0], LABEL, 0.4)
    const outTag = liveLabel(scene, [CV.outAt[0], top, 0], { size: 0.4 })
    const kern = matrixGrid(scene, CV.kern, 3, 3, { cell: 1.1, size: 0.4 })
    const kernTag = liveLabel(scene, [CV.kern[0], CV.kern[1] + 1.55, 0], { size: 0.32, color: GREY })
    const inset = zoomInset(scene, gIn, CV.pitch, CV.inset, 3, CV.cell, RING)
    const sumTag = liveLabel(scene, [CV.inset[0], CV.inset[1] - 3.0, 0.2], { size: 0.46 })
    const arrow = stretchArrow(scene, RING, 0.05)
    const dot = add(scene, mesh(new THREE.RingGeometry(CV.pitch * 0.75, CV.pitch * 1.1, 4, 1, Math.PI / 4), new THREE.MeshBasicMaterial({ color: RING })), [0, 0, 0.15])
    const lines = statusLines(scene, -6.4)
    const st = { key: '', t: 0, k: -1 }
    return {
      scene,
      view: { center: [0, -0.6, 0], radius: 56, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = cvParams(p)
        const key = `${S.kernel}|${S.noise}`
        if (key !== st.key) {
          st.key = key
          st.k = -1
          showImg(gIn, S.input)
          kern.set(KERN_TEXT[S.kernel], S.k.flat().map((v) => (v > 0 ? HEAT : v < 0 ? '#5b8cff' : GREY)))
          outTag.set(`output · ${KERNS[S.kernel]}`, LABEL)
          kernTag.set(KERN_SCALE[S.kernel] ? `kernel k (all ÷ ${KERN_SCALE[S.kernel]})` : 'kernel k', GREY)
          const msg: Record<KernKey, [string, string]> = {
            box: [`Box blur: noise σ ${f2(S.noiseIn)} → ${f2(S.noiseOut)}, edges smeared evenly`, POWER],
            gauss: [`Gaussian: noise σ ${f2(S.noiseIn)} → ${f2(S.noiseOut)}, edges kept softer than the box`, POWER],
            sharpen: [`Sharpen: edges crisper, but noise σ ${f2(S.noiseIn)} → ${f2(S.noiseOut)}`, S.noise > 10 ? HIGH_V : HEAT],
            sobelX: ['Sobel X: vertical edges light up; orange = rising, blue = falling', B_FIELD],
            sobelY: ['Sobel Y: horizontal edges light up (table edge, tape)', B_FIELD],
          }
          lines[0].set(...msg[S.kernel])
          lines[1].set(`${W * H} pixels × 9 multiply-adds = ${(W * H * 9).toLocaleString('en-US')} per frame · QVGA: ${(320 * 240 * 9).toLocaleString('en-US')}`, GREY)
        }
        st.t += dt
        const k = Math.floor(st.t * n(p, 'speed')) % (W * H)
        if (k !== st.k) {
          const wrapped = k < st.k
          st.k = k
          const x = k % W
          const y = Math.floor(k / W)
          const view = outView(S.kernel)
          for (let i = 0; i < W * H; i++) {
            const [r, g, b] = i <= k ? view([S.out.data[i]]) : ([0.07, 0.075, 0.09] as Rgb01)
            gOut.set(i, clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1))
          }
          gOut.commit()
          inset.show(S.input, x, y, { split: false, view: greyView, text: (px) => r0(px[0]) })
          const v = S.out.data[k]
          sumTag.set(`Σ k · in = ${isSigned(S.kernel) ? (v > 0 ? '+' : '') + r0(v) : r0(v)}`, isSigned(S.kernel) ? (v > 0 ? HEAT : v < 0 ? '#5b8cff' : GREY) : LABEL)
          const to = cellAt(CV.outAt, CV.pitch, x, y)
          dot.position.set(to[0], to[1], 0.15)
          arrow([CV.inset[0] + 2.0, CV.inset[1] - 3.0, 0.2], [to[0] - 0.25, to[1], 0.2])
          if (wrapped) st.t = k / n(p, 'speed')
        }
      },
      readouts: (p) => {
        const S = cvParams(p)
        return [
          { label: 'Kernel sum', value: f2(S.sum) },
          { label: 'Noise in', value: `σ ${f2(S.noiseIn)}` },
          { label: 'Noise out', value: `σ ${f2(S.noiseOut)}`, tone: S.noiseOut > S.noiseIn * 1.5 && !isSigned(S.kernel) ? 'warn' : 'ok' },
          { label: 'Output range', value: `${r0(Math.min(...S.out.data))} … ${r0(Math.max(...S.out.data))}` },
        ]
      },
    }
  },
}

// --- Canny edges: blur, gradient, thin to one pixel, keep weak edges only when attached to strong ones; Hough turns edges into lines. ---

const STAGES = { grad: '1 Gradient', nms: '2 Thin (NMS)', hyst: '3 Hysteresis', hough: '4 Hough lines' }
type StageKey = keyof typeof STAGES
const CA = { inAt: [-9.4, 1.8, 0] as V3, outAt: [9.4, 1.8, 0] as V3, pitch: 0.28, prof: [-14, -6.2, 0] as V3, profW: 28, profH: 2.2, magTop: 500, every: 3, rowHz: 2.5, growS: 0.09, seed: 3, minVotes: 20 }
const LINE_COLORS = [B_FIELD, RING, POWER, '#ff7ad9']

const caParams = memoBy(
  (p: Params) => `${p.blur}|${p.lo}|${p.hi}|${p.noise}`,
  (p: Params) => {
    const blur = Math.round(n(p, 'blur'))
    const hi = n(p, 'hi')
    const lo = Math.min(n(p, 'lo'), hi)
    const noise = n(p, 'noise')
    const c = canny(noisyImg(gray0(0), noise, CA.seed), lo, hi, blur)
    let strong = 0
    let weak = 0
    let dropped = 0
    let maxDepth = 0
    for (let i = 0; i < W * H; i++) {
      if (c.cls[i] === EDGE.strong) strong++
      else if (c.cls[i] === EDGE.weak) weak++
      else if (c.cls[i] === EDGE.dropped) dropped++
      maxDepth = Math.max(maxDepth, c.depth[i])
    }
    const hough = houghLines(c.edges, 90, 4, CA.minVotes)
    return { blur, lo, hi, noise, ...c, strong, weak, dropped, maxDepth, hough }
  },
)

export const edgesFeaturesCannyEdges: Lesson = {
  id: 'edges-features-canny-edges',
  title: 'Canny edges',
  tagline: 'Four steps turn a photo into clean one-pixel outlines: smooth, measure the slope, keep only the ridge tops, then follow weak edges that touch strong ones',
  formula: (p) => {
    const S = caParams(p)
    return `|∇| = √(Gx² + Gy²), θ = atan2(Gy, Gx) (Sobel after ${S.blur} Gaussian pass${S.blur === 1 ? '' : 'es'}) · keep if |∇| ≥ both neighbours along θ · strong ≥ ${r0(S.hi)}, weak ≥ ${r0(S.lo)} kept only when touching strong · ${S.count} edge pixels`
  },
  legend: (p) => {
    const s = pick(STAGES, p.stage, 'hyst')
    return [
      ...(s === 'grad' || s === 'nms' ? [{ color: HEAT, label: 'Arrows: gradient, uphill in brightness', shape: 'dot' as const }] : []),
      ...(s === 'hough'
        ? [{ color: B_FIELD, label: 'Lines: Hough peaks ρ = x cos θ + y sin θ', shape: 'dot' as const }]
        : [{ color: LABEL, label: 'Strong edge (≥ high)', shape: 'dot' as const }, { color: RING, label: 'Weak edge kept (joined to strong)', shape: 'dot' as const }, { color: HIGH_V, label: 'Weak edge dropped (isolated)', shape: 'dot' as const }]),
    ]
  },
  points: [
    'Step 1: blur (a Gaussian convolution) so single noisy pixels do not look like edges, then Sobel X and Y give the gradient: how steeply brightness rises and in which direction.',
    'Step 2, non-maximum suppression: a blurred edge is a ridge several pixels wide. Each pixel looks at its two neighbours along the gradient and survives only if it is the top.',
    'Step 3, hysteresis: two thresholds. Pixels above high are certain edges; pixels between low and high are kept only if they connect to a certain one. Outlines stay unbroken, specks vanish.',
    'Step 4 (optional): Hough voting. Every edge pixel votes for all lines through it; peaks in (ρ, θ) are straight lines such as the table edge or the tape, handy for lane or shelf finding.',
  ],
  controls: [
    { kind: 'choice', key: 'stage', options: opts(STAGES), initial: 'hyst' },
    { kind: 'slider', key: 'blur', label: 'Blur passes', min: 0, max: 3, initial: 1, step: 1, format: (v) => `${v} × Gaussian` },
    { kind: 'slider', key: 'lo', label: 'Low threshold', min: 10, max: 400, initial: 90, step: 5, format: r0 },
    { kind: 'slider', key: 'hi', label: 'High threshold', min: 20, max: 600, initial: 220, step: 5, format: r0 },
    noiseSlider(4),
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const gIn = pixelGrid(scene, CA.inAt, W, H, CA.pitch)
    const gOut = pixelGrid(scene, CA.outAt, W, H, CA.pitch)
    const top = CA.inAt[1] + (H * CA.pitch) / 2 + 0.8
    const inTag = liveLabel(scene, [CA.inAt[0], top, 0], { size: 0.4 })
    const outTag = liveLabel(scene, [CA.outAt[0], top, 0], { size: 0.4 })
    const cols = Math.floor(W / CA.every)
    const rows = Math.floor(H / CA.every)
    const arrows = rodPool(scene, cols * rows, { heads: true })
    const rods = rodPool(scene, 8)
    const prof = histChart(scene, CA.prof, CA.profW, CA.profH, W, { left: 'x = 0', right: `x = ${W - 1}`, markers: 0 })
    const profTag = liveLabel(scene, [CA.prof[0] + CA.profW / 2, CA.prof[1] - 0.55, 0], { size: 0.3, color: GREY })
    const thTags = [liveLabel(scene, [CA.prof[0] + CA.profW + 0.4, 0, 0.1], { size: 0.3, align: 'left' }), liveLabel(scene, [CA.prof[0] + CA.profW + 0.4, 0, 0.1], { size: 0.3, align: 'left' })]
    const houghTag = liveLabel(scene, [CA.outAt[0], CA.outAt[1] - (H * CA.pitch) / 2 - 0.7, 0.2], { size: 0.32 })
    const lines = statusLines(scene, -8.1)
    const st = { key: '', t: 0, row: -1, shown: -2 }
    const yOf = (v: number) => CA.prof[1] + (Math.min(v, CA.magTop) / CA.magTop) * CA.profH
    return {
      scene,
      view: { center: [0, -0.4, 0], radius: 56, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = caParams(p)
        const stage: StageKey = pick(STAGES, p.stage, 'hyst')
        const key = `${S.blur}|${S.lo}|${S.hi}|${S.noise}|${stage}`
        const fresh = key !== st.key
        if (fresh) {
          st.key = key
          st.t = 0
          st.shown = -2
          showImg(gIn, S.smooth)
          inTag.set(S.blur ? `smoothed (${S.blur} × Gaussian) + gradient` : 'raw grey + gradient', LABEL)
          let k = 0
          if (stage === 'grad' || stage === 'nms')
            for (let j = 0; j < rows; j++)
              for (let i = 0; i < cols; i++) {
                const x = i * CA.every + 1
                const y = j * CA.every + 1
                const q = y * W + x
                const m = S.grad.mag[q]
                if (m < S.lo * 0.6) continue
                const len = Math.sqrt(Math.min(m, CA.magTop) / CA.magTop) * CA.every * CA.pitch * 1.25
                const a = cellAt(CA.inAt, CA.pitch, x, y, 0.2)
                const ang = S.grad.ang[q]
                arrows.set(k++, a, [a[0] + Math.cos(ang) * len, a[1] - Math.sin(ang) * len, 0.2], 0.045, HEAT)
              }
          arrows.hideFrom(k)
          arrows.commit()
          const ys = [S.lo, S.hi].map(yOf)
          rods.set(0, [CA.prof[0], ys[0], 0.25], [CA.prof[0] + CA.profW, ys[0], 0.25], 0.03, RING)
          rods.set(1, [CA.prof[0], ys[1], 0.25], [CA.prof[0] + CA.profW, ys[1], 0.25], 0.03, LABEL)
          thTags[0].group.position.y = ys[0] - (ys[1] - ys[0] < 0.5 ? 0.25 : 0)
          thTags[1].group.position.y = ys[1] + (ys[1] - ys[0] < 0.5 ? 0.25 : 0)
          thTags[0].set(`low ${r0(S.lo)}`, RING)
          thTags[1].set(`high ${r0(S.hi)}`, LABEL)
          let h = 0
          if (stage === 'hough')
            for (const L of S.hough.lines) {
              const seg = lineInImg(L, W, H)
              if (!seg) continue
              rods.set(4 + h, cellAt(CA.outAt, CA.pitch, ...seg[0], 0.25), cellAt(CA.outAt, CA.pitch, ...seg[1], 0.25), 0.06, LINE_COLORS[h])
              h++
            }
          for (let i = 4 + h; i < 8; i++) rods.set(i, [0, 0, 0], [0, 0, 0], 0, LABEL)
          houghTag.set(
            stage === 'hough' ? (S.hough.lines.length ? S.hough.lines.map((L) => `ρ ${r0(L.rho)} θ ${r0((L.theta * 180) / Math.PI)}°`).join(' · ') : `no line with ≥ ${CA.minVotes} votes`) : '',
            GREY,
          )
          outTag.set({ grad: 'edge strength (gradient length)', nms: 'thinned: ridge tops only', hyst: 'hysteresis: final edges', hough: 'edges + strongest lines' }[stage], LABEL)
          const busy = S.count > 0.18 * W * H
          lines[0].set(
            S.count === 0 ? 'No pixel reaches the high threshold: nothing to grow from' : busy ? `${pct(S.count / (W * H))} of pixels are edges: ${S.blur === 0 || S.noise > 10 ? 'noise and wood grain get through' : 'thresholds too low'}` : stage === 'hyst' ? `${S.strong} strong seeds grew into ${S.weak} weak pixels; ${S.dropped} isolated weak ones dropped` : stage === 'hough' ? `${S.hough.lines.length} straight line${S.hough.lines.length === 1 ? '' : 's'} found among ${S.count} edge pixels` : stage === 'nms' ? 'Each ridge thinned to its top pixel across the edge' : 'Arrows point uphill; length = edge strength',
            S.count === 0 || busy ? HEAT : POWER,
          )
          lines[1].set(`thresholds in Sobel units (step of 100 grey levels ≈ 400) · scan row shown at ${CA.rowHz} rows/s`, GREY)
        }
        st.t += dt
        const grow = stage === 'hyst' ? Math.floor(st.t / CA.growS) % (S.maxDepth + 1 + Math.round(1.5 / CA.growS)) : Infinity
        if (fresh || grow !== st.shown) {
          st.shown = grow
          for (let i = 0; i < W * H; i++) {
            const m = Math.sqrt(Math.min(1, S.grad.mag[i] / CA.magTop))
            const c = S.cls[i]
            let rgb: Rgb01
            if (stage === 'grad') rgb = [m, m * 0.9, m * 0.75]
            else if (stage === 'nms') rgb = S.thin[i] > 0 ? [m, m * 0.9, m * 0.75] : [m * 0.12, m * 0.12, m * 0.14]
            else if (stage === 'hough') rgb = c >= EDGE.weak ? [0.42, 0.44, 0.48] : [0.04, 0.04, 0.05]
            else if (c === EDGE.strong) rgb = [0.95, 0.96, 1]
            else if (c === EDGE.weak && S.depth[i] <= grow) rgb = [1, 0.85, 0.3]
            else if (c === EDGE.weak || c === EDGE.dropped) rgb = [0.5, 0.12, 0.1]
            else rgb = [0.04, 0.04, 0.05]
            gOut.set(i, rgb[0], rgb[1], rgb[2])
          }
          gOut.commit()
        }
        const row = Math.floor(st.t * CA.rowHz) % H
        if (fresh || row !== st.row) {
          st.row = row
          const vals = Array.from(S.grad.mag.subarray(row * W, row * W + W))
          prof.set(vals, (x) => {
            const i = row * W + x
            const c = S.cls[i]
            return S.thin[i] === 0 ? [0.3, 0.32, 0.38] : c === EDGE.strong ? [0.95, 0.96, 1] : c === EDGE.weak ? [1, 0.85, 0.3] : c === EDGE.dropped ? [0.85, 0.25, 0.2] : [0.45, 0.46, 0.5]
          }, CA.magTop)
          profTag.set(`edge strength along row y = ${row} · dim bars = suppressed by NMS`, GREY)
          for (const [i, at] of [[2, CA.inAt], [3, CA.outAt]] as const) rods.set(i, cellAt(at, CA.pitch, -0.5, row, 0.22), cellAt(at, CA.pitch, W - 0.5, row, 0.22), 0.025, B_FIELD)
          rods.commit()
        }
      },
      readouts: (p) => {
        const S = caParams(p)
        const share = S.count / (W * H)
        return [
          { label: 'Edges', value: `${S.count} (${pct(share)})`, tone: S.count === 0 || share > 0.18 ? 'warn' : 'ok' },
          { label: 'Strong · weak', value: `${S.strong} · ${S.weak}` },
          { label: 'Dropped', value: `${S.dropped}` },
          { label: 'Lines', value: `${S.hough.lines.length}` },
        ]
      },
    }
  },
}

// --- Corners: where the gradient points in two directions at once; small patches around them can be matched between two views. ---

const METHODS = { harris: 'Harris', shi: 'Shi-Tomasi' }
const CO = { aAt: [-6.8, 2.4, 0] as V3, bAt: [6.8, 2.4, 0] as V3, pitch: 0.25, plot: [-2.8, -9.0, 0] as V3, plotS: 5.6, logMax: 3.2, max: 30, shift: [2, 1], fill: 50, matchHz: 2.5, okPx: 2.5, edgeL1: 40 }
const markR = CO.pitch * 1.3

const coParams = memoBy(
  (p: Params) => `${p.method}|${p.quality}|${p.turn}|${p.lightB}`,
  (p: Params) => {
    const method = pick(METHODS, p.method, 'harris')
    const quality = n(p, 'quality')
    const turn = n(p, 'turn')
    const lightB = n(p, 'lightB')
    const wp: Warp = { angle: (turn * Math.PI) / 180, dx: CO.shift[0], dy: CO.shift[1] }
    const A = scene0(0)
    const B = mapImg(warpImg(A, wp, CO.fill), (v) => clamp(v * lightB, 0, 255))
    const fa = cornerField(A, method)
    const fb = cornerField(B, method)
    const thr = quality * Math.max(...fa.resp)
    const ca = pickCorners(fa.resp, W, H, thr, CO.max, 2, 3)
    const cb = pickCorners(fb.resp, W, H, quality * Math.max(...fb.resp), CO.max, 2, 3)
    const matches = matchDescriptors(ca.map((c) => patchDescriptor(A, c.x, c.y)), cb.map((c) => patchDescriptor(B, c.x, c.y)), 0.8).map((m) => {
      const [x, y] = warpPoint(wp, W, H, ca[m.a].x, ca[m.a].y)
      return { ...m, ok: Math.hypot(x - cb[m.b].x, y - cb[m.b].y) < CO.okPx }
    })
    const good = matches.filter((m) => m.ok).length
    return { method, quality, turn, lightB, wp, A, B, fa, thr, ca, cb, matches, good }
  },
)

const lamXY = (l1: number, l2: number): [number, number] => [(Math.log10(1 + Math.max(0, l1)) / CO.logMax) * CO.plotS, (Math.log10(1 + Math.max(0, l2)) / CO.logMax) * CO.plotS]

export const edgesFeaturesCorners: Lesson = {
  id: 'edges-features-corners',
  title: 'Corners',
  tagline: 'An edge looks the same if you slide along it; a corner changes whichever way you move. Those points can be found again in the next frame and matched',
  formula: (p) => {
    const S = coParams(p)
    return `M = Σ window [Gx² GxGy; GxGy Gy²] → eigenvalues λ1 ≥ λ2 · ${S.method === 'harris' ? `Harris R = λ1λ2 − ${HARRIS_K}(λ1 + λ2)²` : 'Shi-Tomasi R = λ2'} ≥ ${pct(S.quality)} of the best · ${S.ca.length} corners · ${S.matches.length} matches, ${S.good} correct`
  },
  legend: [
    { color: RING, label: 'Corner: R above the quality level', shape: 'dot' },
    { color: POWER, label: 'Match lands where the true motion puts it', shape: 'dot' },
    { color: HIGH_V, label: 'Wrong match', shape: 'dot' },
    { color: B_FIELD, label: 'λ plot: edge pixels (λ1 big, λ2 small)', shape: 'dot' },
  ],
  points: [
    'For each pixel, gather the gradients (Gx, Gy) in a small window into the 2 × 2 structure matrix M. Its eigenvalues say how much the patch changes when shifted along its two main directions.',
    'Flat: both λ small. Edge: one big λ1, tiny λ2, the patch slides along the edge unchanged. Corner: both big. Shi-Tomasi keeps pixels with large λ2; Harris scores λ1λ2 − k(λ1 + λ2)² and avoids the square root.',
    'Keep local maxima above a share of the best score. Then describe each corner by its patch of grey values with the mean removed and scaled to unit length, so brighter or darker light does not matter.',
    'Match by nearest descriptor, kept only if clearly better than the runner-up (ratio test) and mutual. Turn the second view: plain patches are not rotation-invariant, so matches fail past ~15°. ORB and SIFT fix that.',
  ],
  controls: [
    { kind: 'choice', key: 'method', options: opts(METHODS), initial: 'harris' },
    { kind: 'slider', key: 'quality', label: 'Quality level', min: 0.002, max: 0.3, initial: 0.01, log: true, format: (v) => pct(v) },
    { kind: 'slider', key: 'turn', label: 'View B turn', min: -30, max: 30, initial: 6, step: 1, format: (v) => `${v}°` },
    { kind: 'slider', key: 'lightB', label: 'View B light', min: 0.5, max: 1.5, initial: 0.8, step: 0.05, format: (v) => `${v.toFixed(2)}×` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const gA = pixelGrid(scene, CO.aAt, W, H, CO.pitch)
    const gB = pixelGrid(scene, CO.bAt, W, H, CO.pitch)
    const top = CO.aAt[1] + (H * CO.pitch) / 2 + 0.8
    addLabel(scene, 'view A', [CO.aAt[0], top, 0], LABEL, 0.4)
    const bTag = liveLabel(scene, [CO.bAt[0], top, 0], { size: 0.4 })
    const marks = ringMarks(scene, 2 * CO.max + 2)
    const links = rodPool(scene, CO.max)
    const P = CO.plot
    const S0 = CO.plotS
    const axes = rodPool(scene, 2 + 40)
    axes.set(0, [P[0], P[1], 0], [P[0] + S0 + 0.3, P[1], 0], 0.03, GREY)
    axes.set(1, [P[0], P[1], 0], [P[0], P[1] + S0 + 0.3, 0], 0.03, GREY)
    addLabel(scene, 'λ1 →', [P[0] + S0, P[1] - 0.45, 0], GREY, 0.3)
    addLabel(scene, 'λ2', [P[0] - 0.45, P[1] + S0, 0], GREY, 0.3)
    addLabel(scene, 'flat', [P[0] + 0.3, P[1] + 1.1, 0.1], GREY, 0.3, 'left')
    addLabel(scene, 'edge', [P[0] + S0 * 0.75, P[1] - 0.45, 0.1], B_FIELD, 0.3)
    addLabel(scene, 'corner', [P[0] + S0 * 0.45, P[1] + S0 * 0.9, 0.1], RING, 0.3)
    addLabel(scene, 'eigenvalues, log scale', [P[0] + S0 / 2, P[1] + S0 + 0.8, 0], GREY, 0.3)
    const dots = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.09), new THREE.MeshBasicMaterial({ color: '#ffffff' }), W * H)
    dots.frustumCulled = false
    scene.add(dots)
    const probe = add(scene, mesh(new THREE.RingGeometry(0.16, 0.24, 20), new THREE.MeshBasicMaterial({ color: '#ffffff' })), [0, 0, 0.3])
    const bead = add(scene, mesh(new THREE.SphereGeometry(0.14, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' })), [0, 0, 0.35])
    const lines = statusLines(scene, -10.8)
    const st = { key: '', t: 0, px: 0, py: 0 }
    const m4 = new THREE.Matrix4()
    const col = new THREE.Color()
    return {
      scene,
      view: { center: [0, -0.6, 0], radius: 55, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = coParams(p)
        const key = `${S.method}|${S.quality}|${S.turn}|${S.lightB}`
        if (key !== st.key) {
          st.key = key
          showImg(gA, S.A, asIs)
          showImg(gB, S.B, asIs)
          bTag.set(`view B · turned ${S.turn}°, moved (${CO.shift.join(', ')}) px, light ${S.lightB.toFixed(2)}×`, LABEL)
          const matchedA = new Map(S.matches.map((m) => [m.a, m]))
          const matchedB = new Map(S.matches.map((m) => [m.b, m]))
          let k = 0
          S.ca.forEach((c, i) => marks.set(k++, cellAt(CO.aAt, CO.pitch, c.x, c.y, 0.2), markR, matchedA.has(i) ? (matchedA.get(i)!.ok ? POWER : HIGH_V) : RING))
          S.cb.forEach((c, i) => marks.set(k++, cellAt(CO.bAt, CO.pitch, c.x, c.y, 0.2), markR, matchedB.has(i) ? (matchedB.get(i)!.ok ? POWER : HIGH_V) : RING))
          marks.hideFrom(k)
          marks.commit()
          for (let i = 0; i < W * H; i++) {
            const [x, y] = lamXY(S.fa.l1[i], S.fa.l2[i])
            dots.setMatrixAt(i, m4.makeTranslation(P[0] + x, P[1] + y, 0.05))
            const corner = S.fa.resp[i] >= S.thr && S.thr > 0
            dots.setColorAt(i, col.set(corner ? RING : S.fa.l1[i] > CO.edgeL1 ? B_FIELD : GREY))
          }
          dots.instanceMatrix.needsUpdate = true
          dots.instanceColor!.needsUpdate = true
          let a = 2
          let prev: [number, number] | null = null
          for (let s = 0; s <= 40 && a < 42; s++) {
            const l1 = 10 ** ((s / 40) * CO.logMax) - 1
            const l2 = S.method === 'shi' ? (l1 >= S.thr ? S.thr : null) : harrisBoundary(l1, S.thr)
            const pt = l2 === null ? null : lamXY(l1, l2)
            if (pt && prev) axes.set(a++, [P[0] + prev[0], P[1] + prev[1], 0.1], [P[0] + pt[0], P[1] + pt[1], 0.1], 0.03, RING)
            prev = pt
          }
          axes.hideFrom(a)
          axes.commit()
          const rate = S.matches.length ? S.good / S.matches.length : 0
          lines[0].set(
            S.ca.length < 4 ? 'Quality level too strict: hardly any corners left' : Math.abs(S.turn) > 12 && S.matches.length < S.ca.length / 2 ? `Only ${S.matches.length} of ${S.ca.length} corners matched: turned ${Math.abs(S.turn)}°, patches no longer line up` : S.matches.length === 0 ? 'No distinctive matches: patches no longer look alike' : rate < 0.6 ? `Only ${S.good} of ${S.matches.length} matches correct: ${Math.abs(S.turn) > 12 ? 'rotated patches look different' : 'repeated texture fools the patch'}` : `${S.good} of ${S.matches.length} matches correct${S.lightB !== 1 ? ': normalised patches ignore the light change' : ''}`,
            S.ca.length < 4 || S.matches.length < S.ca.length / 2 ? HEAT : rate < 0.6 ? HIGH_V : POWER,
          )
          lines[1].set(`7 × 7 patch = 49 numbers · ratio test 0.8 + mutual check`, GREY)
        }
        st.t += dt
        const nm = S.matches.length
        const cycle = nm + 4
        const u = st.t * CO.matchHz
        const shown = Math.min(nm, Math.floor(u % cycle))
        S.matches.forEach((m, i) => {
          const a = cellAt(CO.aAt, CO.pitch, S.ca[m.a].x, S.ca[m.a].y, 0.25)
          const b = cellAt(CO.bAt, CO.pitch, S.cb[m.b].x, S.cb[m.b].y, 0.25)
          if (i < shown) links.set(i, a, b, 0.03, m.ok ? POWER : HIGH_V)
          else links.set(i, a, a, 0, LABEL)
        })
        links.hideFrom(nm)
        links.commit()
        const cur = nm ? S.matches[Math.min(nm - 1, Math.floor(u % cycle))] : null
        if (cur && Math.floor(u % cycle) < nm) {
          const ca = S.ca[cur.a]
          const a = cellAt(CO.aAt, CO.pitch, ca.x, ca.y, 0.3)
          const b = cellAt(CO.bAt, CO.pitch, S.cb[cur.b].x, S.cb[cur.b].y, 0.3)
          const e = u % 1
          const s = e * e * (3 - 2 * e)
          bead.visible = true
          bead.position.set(a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s + Math.sin(Math.PI * s) * 0.8, 0.35)
          const [x, y] = lamXY(S.fa.l1[ca.y * W + ca.x], S.fa.l2[ca.y * W + ca.x])
          st.px = glide(dt, st.px, x, 10)
          st.py = glide(dt, st.py, y, 10)
          probe.visible = true
          probe.position.set(P[0] + st.px, P[1] + st.py, 0.3)
        } else {
          bead.visible = false
          probe.visible = false
        }
      },
      readouts: (p) => {
        const S = coParams(p)
        const rate = S.matches.length ? S.good / S.matches.length : 0
        return [
          { label: 'Corners A · B', value: `${S.ca.length} · ${S.cb.length}`, tone: S.ca.length < 4 ? 'warn' : 'ok' },
          { label: 'Matches', value: `${S.matches.length}` },
          { label: 'Correct', value: S.matches.length ? pct(rate) : '–', tone: rate >= 0.8 ? 'ok' : rate >= 0.5 ? 'warn' : 'bad' },
          { label: 'R threshold', value: S.method === 'shi' ? `λ2 ≥ ${r0(S.thr)}` : `R ≥ ${r0(S.thr)}` },
        ]
      },
    }
  },
}
