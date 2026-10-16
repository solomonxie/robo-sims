import * as THREE from 'three/webgpu'
import {
  Img, SCENE_SPOTS, bitDepthImg, channelImg, contrastImg, cumulative, equalizeImg, imageBytes, grayImg, hsvMask, hsvToRgb, imgHistogram, imgStats, makeImg, maskIoU, maskStats, noisyImg, otsuLevel, pixelOf,
  rgbToHsv, tabletopImg, thresholdImg,
} from '../../core/physics'
import { bytesText, pct } from '../../core/units'
import { V3, add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, Rgb01, addLabel, asIs, glide, histChart, hueWheel, liveLabel, memoBy, pixelGrid, pixelRelief, shellMat, showImg, zoomInset } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const W = 48
const H = 36
const scene0 = memoBy((light: number) => light.toFixed(2), (light: number) => tabletopImg(W, H, light))
const hsvOf = (px: number[]) => rgbToHsv(px[0], px[1], px[2])
const deg = (h: number) => `${Math.round(h)}°`
const f2 = (v: number) => v.toFixed(2)
const lightText = (v: number) => `${v.toFixed(2)}×`
const lightSlider = (initial: number) => ({ kind: 'slider' as const, key: 'light', label: 'Light', min: 0.25, max: 1.6, initial, step: 0.05, format: lightText })
const statusLines = (scene: THREE.Object3D, y: number) => [0, 1].map((i) => liveLabel(scene, [-15.5, y - i * 0.8, 0.2], { size: i ? 0.36 : 0.44, align: 'left' }))

// --- RGB and HSV: every pixel is three bytes; HSV splits colour (hue) from brightness (value). ---

const SPOTS = { ball: 'Red ball', block: 'Green block', cup: 'Blue cup', wall: 'Grey wall', shadow: 'Shadow' }
const VIEWS = { rgb: 'RGB', r: 'R', g: 'G', b: 'B', h: 'Hue', v: 'Value' }
const RH = { at: [-8.8, 0.6, 0] as V3, pitch: 0.28, inset: [3.6, 0.6, 0] as V3, n: 5, cell: 1.75, wheel: [11.2, 2.4, 0] as V3 }

const hueView = (px: number[]): Rgb01 => {
  const [h, s] = hsvOf(px)
  return s < 0.2 ? [0.12, 0.12, 0.13] : (hsvToRgb(h, 1, 1).map((c) => c / 255) as Rgb01)
}
const VIEW_FN: Record<keyof typeof VIEWS, (px: number[]) => Rgb01> = {
  rgb: asIs,
  r: (px) => [px[0] / 255, 0, 0],
  g: (px) => [0, px[1] / 255, 0],
  b: (px) => [0, 0, px[2] / 255],
  h: hueView,
  v: (px) => Array(3).fill(Math.max(...px) / 255) as Rgb01,
}
const VIEW_TEXT: Record<keyof typeof VIEWS, (px: number[]) => string> = {
  rgb: () => '',
  r: (px) => `${Math.round(px[0])}`,
  g: (px) => `${Math.round(px[1])}`,
  b: (px) => `${Math.round(px[2])}`,
  h: (px) => (hsvOf(px)[1] < 0.2 ? '–' : deg(hsvOf(px)[0])),
  v: (px) => f2(hsvOf(px)[2]),
}

const rgbParams = (p: Params) => {
  const spot = pick(SPOTS, p.spot, 'ball')
  const view = pick(VIEWS, p.view, 'rgb')
  const light = n(p, 'light')
  const bits = Math.round(n(p, 'bits'))
  const img = bitDepthImg(scene0(light), bits)
  const [u, v] = SCENE_SPOTS[spot]
  const x = Math.floor(u * W)
  const y = Math.floor(v * H)
  const px = pixelOf(img, x, y).map(Math.round)
  return { spot, view, light, bits, img, x, y, px, hsv: hsvOf(px) }
}

export const imageBasicsRgbHsv: Lesson = {
  id: 'image-basics-rgb-and-hsv',
  title: 'RGB and HSV',
  tagline: 'A colour image is a grid of three numbers per pixel. HSV re-packs them as colour, purity and brightness, so a dim red is still red',
  formula: (p) => {
    const S = rgbParams(p)
    const [r, g, b] = S.px
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    return `pixel (${S.x}, ${S.y}) = R ${r} G ${g} B ${b} · V = max/255 = ${f2(max / 255)} · S = (max − min)/max = ${max ? f2((max - min) / max) : '0'} · H = ${S.hsv[1] > 0 ? deg(S.hsv[0]) : 'undefined (grey)'} · ${S.bits} bits × 3 = ${(2 ** (3 * S.bits)).toLocaleString('en-US')} colours`
  },
  legend: [
    { color: LABEL, label: 'Image 48 × 36 · box = zoomed 5 × 5', shape: 'dot' },
    { color: HIGH_V, label: 'R, G, B sub-pixels: 0 … 255 each', shape: 'dot' },
    { color: RING, label: 'Hue wheel: angle = hue, radius = saturation', shape: 'dot' },
  ],
  points: [
    'A camera stores each pixel as red, green and blue intensities, one byte each (0 … 255): 24 bits, 16.7 million colours. Zoom in and every pixel is just three numbers.',
    'Fewer bits per channel means fewer levels: at 2 bits the smooth ball shading collapses into bands (posterisation). The ESP32-CAM often sends RGB565: 5-6-5 bits, 2 bytes a pixel.',
    'HSV: Value = the brightest channel, Saturation = how far the others fall below it, Hue = which channel leads (red 0°, green 120°, blue 240°).',
    'Dim the light: R, G and B all drop, but hue and saturation of the ball stay put. That is why robots look for colours in HSV. Greys have no hue at all.',
  ],
  controls: [
    { kind: 'choice', key: 'spot', options: opts(SPOTS), initial: 'ball' },
    { kind: 'choice', key: 'view', options: opts(VIEWS), initial: 'rgb' },
    lightSlider(1),
    { kind: 'slider', key: 'bits', label: 'Bits per channel', min: 1, max: 8, initial: 8, step: 1, format: (v) => `${v} bit${v > 1 ? 's' : ''}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const grid = pixelGrid(scene, RH.at, W, H, RH.pitch)
    const title = liveLabel(scene, [RH.at[0], RH.at[1] + (H * RH.pitch) / 2 + 0.8, 0], { size: 0.4 })
    const inset = zoomInset(scene, grid, RH.pitch, RH.inset, RH.n, RH.cell)
    const insetTag = liveLabel(scene, [RH.inset[0], RH.inset[1] + (RH.n * RH.cell) / 2 + 0.75, 0], { size: 0.4 })
    const wheel = hueWheel(scene, RH.wheel, 2.4)
    addLabel(scene, 'hue · saturation', [RH.wheel[0], RH.wheel[1] + 3.2, 0], GREY, 0.34)
    const wx = RH.wheel[0]
    const rgbTags = [-1.9, 0, 1.9].map((dx) => liveLabel(scene, [wx + dx, -1.2, 0.2], { size: 0.38 }))
    const hsvTags = [-1.9, 0, 1.9].map((dx) => liveLabel(scene, [wx + dx, -2.3, 0.2], { size: 0.38 }))
    const swatch = add(scene, mesh(new THREE.PlaneGeometry(2.6, 1.1), new THREE.MeshBasicMaterial({ color: '#ffffff' })), [wx, -3.9, 0.05])
    const vBar = add(scene, mesh(new THREE.PlaneGeometry(4.4, 0.18), new THREE.MeshBasicMaterial({ color: '#ffffff' })), [wx, -4.8, 0.05])
    addLabel(scene, 'V', [wx - 2.7, -4.8, 0], GREY, 0.3)
    const lines = statusLines(scene, -6.6)
    const st = { key: '', h: 0, s: 0, v: 0 }
    return {
      scene,
      view: { center: [-1.8, -0.8, 0], radius: 53, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = rgbParams(p)
        const key = `${S.spot}|${S.view}|${S.light}|${S.bits}`
        if (key !== st.key) {
          st.key = key
          showImg(grid, S.img, VIEW_FN[S.view])
          inset.show(S.img, S.x, S.y, { split: S.view === 'rgb', view: VIEW_FN[S.view], text: S.view === 'rgb' ? null : VIEW_TEXT[S.view] })
          title.set(`${W} × ${H} pixels · ${VIEWS[S.view]}${S.view === 'rgb' ? '' : ' channel'} · ${S.bits * 3}-bit colour`, LABEL)
          insetTag.set(S.view === 'rgb' ? 'each pixel = R G B sub-pixels' : S.view === 'h' ? 'hue in degrees (– = grey)' : `${VIEWS[S.view]} values`, LABEL)
          const [r, g, b] = S.px
          rgbTags[0].set(`R ${r}`, HIGH_V)
          rgbTags[1].set(`G ${g}`, POWER)
          rgbTags[2].set(`B ${b}`, '#5b8cff')
          const [h, s, v] = S.hsv
          hsvTags[0].set(s > 0 ? `H ${deg(h)}` : 'H –', RING)
          hsvTags[1].set(`S ${f2(s)}`, LABEL)
          hsvTags[2].set(`V ${f2(v)}`, LABEL)
          ;(swatch.material as THREE.MeshBasicMaterial).color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
          const dull = s < 0.2
          const black = v < 0.04
          lines[0].set(
            black ? `${SPOTS[S.spot]}: below the first of ${2 ** S.bits} levels, every channel reads 0` : dull ? `${SPOTS[S.spot]}: R ≈ G ≈ B, so saturation is low and hue means nothing` : S.light < 0.6 ? `Dim light: RGB fell, hue still ${deg(h)}` : S.bits <= 3 ? `${S.bits} bits: only ${2 ** S.bits} levels per channel, shading bands` : `${SPOTS[S.spot]}: hue ${deg(h)}, saturation ${f2(s)}`,
            black ? HIGH_V : dull || S.bits <= 3 ? HEAT : POWER,
          )
          lines[1].set(`QVGA 320 × 240 at ${S.bits * 3} bits = ${bytesText(imageBytes(320, 240, S.bits * 3))} per frame · light ${lightText(S.light)}`, GREY)
        }
        st.h = st.h + ((((S.hsv[0] - st.h + 540) % 360) - 180) * Math.min(1, dt * 8))
        st.s = glide(dt, st.s, S.hsv[1], 8)
        st.v = glide(dt, st.v, S.hsv[2], 8)
        wheel.set((st.h + 360) % 360, st.s, st.v)
        vBar.scale.x = Math.max(0.02, st.v)
        vBar.position.x = wx - 2.2 + 2.2 * vBar.scale.x
        ;(vBar.material as THREE.MeshBasicMaterial).color.setRGB(st.v, st.v, st.v, THREE.SRGBColorSpace)
      },
      readouts: (p) => {
        const S = rgbParams(p)
        const [h, s, v] = S.hsv
        return [
          { label: 'Pixel RGB', value: S.px.join(' · ') },
          { label: 'Pixel HSV', value: `${s > 0 ? deg(h) : '–'} · ${f2(s)} · ${f2(v)}`, tone: s < 0.2 ? 'warn' : 'ok' },
          { label: 'Colours', value: (2 ** (3 * S.bits)).toLocaleString('en-US'), tone: S.bits <= 3 ? 'warn' : 'ok' },
          { label: 'QVGA frame', value: bytesText(imageBytes(320, 240, 3 * S.bits)) },
        ]
      },
    }
  },
}

// --- Thresholding: one number splits the image into object and background; grey levels move with the light, hue does not. ---

const MODES = { fixed: 'Fixed grey level', otsu: 'Otsu (automatic)', hsv: 'HSV: red hue' }
const TH = { relief: [-7.4, 2.4, 0] as V3, pitch: 0.27, maxH: 3.2, tilt: 0.95, mask: [8.4, 2.4, 0] as V3, hist: [-14, -7.2, 0] as V3, histW: 28, histH: 2.6, bins: 64, noiseSeed: 7, hue: 0, tol: 20 }
const truthMask = memoBy(() => 'ball', () => hsvMask(tabletopImg(W, H, 1), TH.hue, TH.tol, 0.5, 0.15))

const thParams = memoBy(
  (p: Params) => `${p.mode}|${p.level}|${p.light}|${p.noise}`,
  (p: Params) => {
    const mode = pick(MODES, p.mode, 'fixed')
    const level = n(p, 'level')
    const light = n(p, 'light')
    const noise = n(p, 'noise')
    const rgb = noisyImg(scene0(light), noise, TH.noiseSeed)
    const sat = makeImg(W, H, 1)
    for (let i = 0; i < W * H; i++) sat.data[i] = 255 * rgbToHsv(rgb.data[3 * i], rgb.data[3 * i + 1], rgb.data[3 * i + 2])[1]
    const gray = grayImg(rgb)
    const hsv = mode === 'hsv'
    const src = hsv ? sat : gray
    const hist = imgHistogram(src, TH.bins)
    const otsu = otsuLevel(imgHistogram(gray, 256))
    const t = mode === 'otsu' ? otsu : level
    const mask = hsv ? hsvMask(rgb, TH.hue, TH.tol, level / 255, 0.12) : thresholdImg(gray, t)
    const m = maskStats(mask)
    return { mode, hsv, level, light, noise, rgb, src, hist, otsu, t, mask, share: m.share, iou: maskIoU(mask, truthMask(0)) }
  },
)

export const imageBasicsThresholding: Lesson = {
  id: 'image-basics-thresholding',
  title: 'Thresholding',
  tagline: 'Pick a level: brighter pixels become white, the rest black. The easiest way to find an object, and the easiest to break with a change of light',
  formula: (p) => {
    const S = thParams(p)
    return S.hsv
      ? `mask = |hue − 0°| ≤ ${TH.tol}° and S ≥ ${f2(S.level / 255)} and V ≥ 0.12 → ${pct(S.share)} white · ball IoU = ${f2(S.iou)}`
      : `mask = grey ≥ T · grey = 0.299 R + 0.587 G + 0.114 B · T = ${Math.round(S.t)}${S.mode === 'otsu' ? ' (Otsu: max between-class variance)' : ''} → ${pct(S.share)} white · ball IoU = ${f2(S.iou)}`
  },
  legend: (p) => [
    { color: LABEL, label: pick(MODES, p.mode, 'fixed') === 'hsv' ? 'Height = saturation of each pixel' : 'Height = grey level of each pixel', shape: 'dot' },
    { color: B_FIELD, label: 'Glass plane = threshold', shape: 'dot' },
    { color: POWER, label: 'Mask: white = above threshold', shape: 'dot' },
    { color: RING, label: 'Otsu level on the histogram', shape: 'dot' },
  ],
  points: [
    'Thresholding turns grey levels into a yes/no mask: every pixel at or above T is "object". Think of the image as a landscape and T as water level: peaks that poke through are kept.',
    'Grey alone mixes colour with brightness: the red ball (grey ≈ 90) is darker than the wooden table, so no single T keeps the ball and drops the table.',
    "A fixed T breaks when the light changes. Otsu picks T from the histogram each frame, at the valley that best splits it into two groups, so it follows the exposure.",
    'For a coloured target, threshold in HSV instead: keep pixels near red hue that are saturated enough. It finds the ball in dim and bright light; noise speckles both.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'fixed' },
    { kind: 'slider', key: 'level', label: 'Threshold', min: 0, max: 255, initial: 150, step: 1, format: (v) => `${Math.round(v)}` },
    lightSlider(1),
    { kind: 'slider', key: 'noise', label: 'Sensor noise', min: 0, max: 40, initial: 4, step: 1, format: (v) => `σ ${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const tilt = add(scene, new THREE.Group(), TH.relief)
    tilt.rotation.x = -TH.tilt
    const relief = pixelRelief(tilt, [0, 0, 0], W, H, TH.pitch, TH.maxH)
    const glass = add(tilt, mesh(new THREE.PlaneGeometry(W * TH.pitch + 0.8, H * TH.pitch + 0.8), shellMat(B_FIELD, 0.32)), [0, 0, 1])
    glass.castShadow = false
    const reliefTag = liveLabel(scene, [TH.relief[0], TH.relief[1] + 5.4, 0], { size: 0.4 })
    const grid = pixelGrid(scene, TH.mask, W, H, TH.pitch)
    const maskTag = liveLabel(scene, [TH.mask[0], TH.mask[1] + (H * TH.pitch) / 2 + 0.8, 0], { size: 0.4 })
    const hist = histChart(scene, TH.hist, TH.histW, TH.histH, TH.bins, { markers: 2 })
    const histTag = liveLabel(scene, [TH.hist[0] + TH.histW / 2, TH.hist[1] - 0.5, 0], { size: 0.3, color: GREY })
    const lines = [liveLabel(scene, [0, TH.hist[1] - 1.5, 0.2], { size: 0.42 })]
    const st = { key: '', z: 1 }
    return {
      scene,
      view: { center: [0, -0.6, 0], radius: 56, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = thParams(p)
        const key = `${S.mode}|${S.level}|${S.light}|${S.noise}`
        if (key !== st.key) {
          st.key = key
          relief.set(S.rgb, S.hsv ? (px) => hsvOf(px)[1] : (px) => (0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]) / 255)
          showImg(grid, S.mask, (px) => (px[0] > 127 ? [0.92, 0.96, 0.93] : [0.05, 0.05, 0.06]))
          const cut = S.hsv ? S.level : S.t
          const tb = Math.floor((cut / 256) * TH.bins)
          const dimBar = (b: number): Rgb01 => {
            const v = (b + 0.5) / TH.bins
            return b >= tb ? [0.36 + 0.6 * v, 0.9, 0.62 + 0.3 * v] : [0.18 + 0.25 * v, 0.2 + 0.25 * v, 0.24 + 0.25 * v]
          }
          hist.set(S.hist, dimBar)
          hist.marker(0, cut / 255, B_FIELD, `${S.hsv ? 'S ≥ ' + f2(S.level / 255) : 'T = ' + Math.round(S.t)}`)
          hist.marker(1, S.hsv ? null : S.otsu / 255, RING, Math.abs(S.otsu - S.t) < 12 ? '' : `Otsu ${Math.round(S.otsu)}`)
          histTag.set(S.hsv ? 'saturation' : 'grey level', GREY)
          hist.axis('0', S.hsv ? '1' : '255')
          reliefTag.set(S.hsv ? 'saturation as height' : 'grey level as height', LABEL)
          maskTag.set(`mask · ${pct(S.share)} white`, LABEL)
          const good = S.iou > 0.7
          lines[0].set(
            S.hsv ? (good ? `Ball found · IoU ${f2(S.iou)}` : `Ball IoU ${f2(S.iou)}: ${S.noise >= 15 ? 'noise speckles the dark pixels' : S.level > 200 ? 'saturation cut too high' : 'cut too loose'}`) : S.share > 0.6 ? 'Most of the frame passes: T too low' : S.share < 0.02 ? 'Almost nothing passes: T too high' : `Grey can't isolate the ball · IoU ${f2(S.iou)}`,
            good ? POWER : S.hsv ? HEAT : HIGH_V,
          )
        }
        st.z = glide(dt, st.z, ((S.hsv ? S.level : S.t) / 255) * TH.maxH, 10)
        glass.position.z = st.z
      },
      readouts: (p) => {
        const S = thParams(p)
        return [
          { label: S.hsv ? 'Saturation cut' : 'Threshold', value: S.hsv ? f2(S.level / 255) : `${Math.round(S.t)}` },
          { label: 'White pixels', value: pct(S.share), tone: S.share > 0.6 || S.share < 0.01 ? 'warn' : 'ok' },
          { label: 'Otsu level', value: `${Math.round(S.otsu)}` },
          { label: 'Ball match (IoU)', value: f2(S.iou), tone: S.iou > 0.7 ? 'ok' : S.iou > 0.4 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}

// --- Histogram: how many pixels sit at each level; exposure slides it, contrast stretches it, equalising flattens it. ---

const CHANNELS = { luma: 'Grey', r: 'Red', g: 'Green', b: 'Blue' }
const EQ = { off: 'As captured', on: 'Equalised' }
const HI = { at: [-8.6, 1, 0] as V3, pitch: 0.29, hist: [0.6, -2.6, 0] as V3, histW: 14, histH: 6.4, bins: 64, scanHz: 220, fly: 0.45 }
const TINT: Record<keyof typeof CHANNELS, Rgb01> = { luma: [1, 1, 1], r: [1, 0.25, 0.22], g: [0.3, 1, 0.4], b: [0.35, 0.55, 1] }

const hiParams = memoBy(
  (p: Params) => `${p.light}|${p.contrast}|${p.channel}|${p.eq}`,
  (p: Params) => {
    const light = n(p, 'light')
    const contrast = n(p, 'contrast')
    const channel = pick(CHANNELS, p.channel, 'luma')
    const eq = pick(EQ, p.eq, 'off') === 'on'
    const rgb = noisyImg(scene0(light), 3, 11)
    const one = channel === 'luma' ? grayImg(rgb) : channelImg(rgb, ['r', 'g', 'b'].indexOf(channel))
    const adj = contrastImg(one, contrast)
    const img: Img = eq ? equalizeImg(adj) : adj
    const hist = imgHistogram(img, HI.bins)
    const stats = imgStats(img)
    const total = W * H
    let lo = 0
    let hi = 0
    for (const v of img.data) {
      if (v <= 0.5) lo++
      else if (v >= 254.5) hi++
    }
    return { light, contrast, channel, eq, img, hist, cdf: cumulative(hist), stats, black: lo / total, white: hi / total }
  },
)

export const imageBasicsHistogram: Lesson = {
  id: 'image-basics-histogram',
  title: 'Histogram',
  tagline: 'Count how many pixels sit at each brightness. One glance shows under- or over-exposure, low contrast and clipping, without looking at the picture',
  formula: (p) => {
    const S = hiParams(p)
    return `out = (in − 128) × ${S.contrast.toFixed(2)} + 128, clipped 0 … 255${S.eq ? ' → equalised: out = 255 × CDF(in)' : ''} · mean ${Math.round(S.stats.mean)} · σ ${Math.round(S.stats.std)} · range ${Math.round(S.stats.min)} … ${Math.round(S.stats.max)}`
  },
  legend: [
    { color: LABEL, label: 'Bars: pixels per brightness bin (64 bins)', shape: 'dot' },
    { color: RING, label: 'Cumulative share (CDF) 0 … 100 %', shape: 'dot' },
    { color: HIGH_V, label: 'Crushed to 0 / clipped at 255', shape: 'dot' },
    { color: B_FIELD, label: 'Mean level', shape: 'dot' },
  ],
  points: [
    'Each pixel drops one vote into the bin of its value. Dark image: the hill sits left. Bright: right. The picture is gone, but exposure is easy to read.',
    "Pixels piled in the first or last bin are clipped: detail there is lost for good, no later maths can bring it back. Auto-exposure aims to keep the hill off both walls.",
    'Contrast stretches the hill about mid-grey; too much shoves the ends into the walls. The CDF line is the running share of pixels below each level.',
    'Equalising maps each level through the CDF, spreading the pixels evenly: dim detail pops out, but noise is stretched too. Per-channel histograms show colour casts.',
  ],
  controls: [
    lightSlider(0.55),
    { kind: 'slider', key: 'contrast', label: 'Contrast', min: 0.4, max: 2.5, initial: 1, step: 0.05, format: (v) => `${v.toFixed(2)}×` },
    { kind: 'choice', key: 'channel', options: opts(CHANNELS), initial: 'luma' },
    { kind: 'choice', key: 'eq', options: opts(EQ), initial: 'off' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const grid = pixelGrid(scene, HI.at, W, H, HI.pitch)
    const title = liveLabel(scene, [HI.at[0], HI.at[1] + (H * HI.pitch) / 2 + 0.8, 0], { size: 0.4 })
    const hist = histChart(scene, HI.hist, HI.histW, HI.histH, HI.bins, { markers: 1, dots: 48 })
    addLabel(scene, '100 %', [HI.hist[0] + HI.histW + 0.3, HI.hist[1] + HI.histH, 0], GREY, 0.28, 'left')
    const histTag = liveLabel(scene, [HI.hist[0] + HI.histW / 2, HI.hist[1] - 1.1, 0], { size: 0.36 })
    const cursor = add(scene, mesh(new THREE.RingGeometry(HI.pitch * 0.7, HI.pitch * 1.05, 4, 1, Math.PI / 4), new THREE.MeshBasicMaterial({ color: RING })), [0, 0, 0.1])
    const vote = add(scene, mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: RING })), [0, 0, 0.3])
    const lines = statusLines(scene, -6.4)
    const st = { key: '', t: 0, flyFrom: [0, 0] as number[], flyTo: [0, 0] as number[], last: -1 }
    const bw = HI.histW / HI.bins
    return {
      scene,
      view: { center: [0, -0.4, 0], radius: 56, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = hiParams(p)
        const key = `${S.light}|${S.contrast}|${S.channel}|${S.eq}`
        const tint = TINT[S.channel]
        if (key !== st.key) {
          st.key = key
          showImg(grid, S.img, (px) => [(px[0] / 255) * tint[0], (px[0] / 255) * tint[1], (px[0] / 255) * tint[2]])
          hist.set(S.hist, (b) => {
            const v = 0.25 + (0.75 * (b + 0.5)) / HI.bins
            const clip = (b === 0 && S.black > 0.02) || (b === HI.bins - 1 && S.white > 0.02)
            return clip ? [1, 0.3, 0.3] : [v * tint[0], v * tint[1], v * tint[2]]
          })
          hist.curve(S.cdf, RING)
          hist.marker(0, S.stats.mean / 255, B_FIELD, `mean ${Math.round(S.stats.mean)}`)
          title.set(`${CHANNELS[S.channel]} channel · ${S.eq ? 'equalised' : `light ${lightText(S.light)}, contrast ${S.contrast.toFixed(2)}×`}`, LABEL)
          histTag.set(`black ${pct(S.black)} · white ${pct(S.white)}`, S.black > 0.05 || S.white > 0.05 ? HIGH_V : GREY)
          const clipped = S.black > 0.05 || S.white > 0.05
          const narrow = S.stats.std < 25
          lines[0].set(
            S.eq && clipped ? 'Equalised, but clipped pixels stay stuck in one bin' : S.eq ? 'Equalised: levels spread to fill 0 … 255' : clipped ? (S.white > S.black ? 'Highlights clipped at 255: detail lost' : 'Shadows crushed to 0: detail lost') : S.stats.mean < 70 ? 'Under-exposed: the hill hugs the left' : S.stats.mean > 185 ? 'Over-exposed: the hill hugs the right' : narrow ? 'Low contrast: a narrow hill' : 'Well spread: most levels in use',
            clipped ? HIGH_V : S.eq ? POWER : S.stats.mean < 70 || S.stats.mean > 185 || narrow ? HEAT : POWER,
          )
          lines[1].set(`each pixel votes into one of ${HI.bins} bins · ${W * H} pixels · scan shown at ${HI.scanHz} px/s`, GREY)
        }
        st.t += dt
        const k = Math.floor(st.t * HI.scanHz) % (W * H)
        const x = k % W
        const y = Math.floor(k / W)
        const cx = HI.at[0] + (x - (W - 1) / 2) * HI.pitch
        const cy = HI.at[1] + ((H - 1) / 2 - y) * HI.pitch
        cursor.position.set(cx, cy, 0.1)
        const voteK = Math.floor(st.t / HI.fly)
        if (voteK !== st.last) {
          st.last = voteK
          const b = Math.min(HI.bins - 1, Math.floor((S.img.data[k] / 256) * HI.bins))
          const peak = Math.max(1, ...S.hist)
          st.flyFrom = [cx, cy]
          st.flyTo = [HI.hist[0] + (b + 0.5) * bw, HI.hist[1] + Math.min(1, S.hist[b] / peak) * HI.histH + 0.2]
        }
        const u = ((st.t / HI.fly) % 1 + 1) % 1
        const e = u * u * (3 - 2 * u)
        vote.position.set(st.flyFrom[0] + (st.flyTo[0] - st.flyFrom[0]) * e, st.flyFrom[1] + (st.flyTo[1] - st.flyFrom[1]) * e + Math.sin(Math.PI * e) * 1.2, 0.3)
      },
      readouts: (p) => {
        const S = hiParams(p)
        return [
          { label: 'Mean level', value: `${Math.round(S.stats.mean)}`, tone: S.stats.mean < 70 || S.stats.mean > 185 ? 'warn' : 'ok' },
          { label: 'Spread (σ)', value: `${Math.round(S.stats.std)}`, tone: S.stats.std < 25 ? 'warn' : 'ok' },
          { label: 'Black · white', value: `${pct(S.black)} · ${pct(S.white)}`, tone: S.black > 0.05 || S.white > 0.05 ? 'bad' : 'ok' },
          { label: 'Range used', value: `${Math.round(S.stats.min)} … ${Math.round(S.stats.max)}` },
        ]
      },
    }
  },
}
