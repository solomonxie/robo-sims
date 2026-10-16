// Image visuals: an Img on a pixel plate, a zoomed inset with RGB sub-pixels and values, a 3D brightness relief, a histogram chart, a hue wheel.
import * as THREE from 'three/webgpu'
import { Img, hsvToRgb, lumaOf } from '../../core/physics'
import { V3, add, mesh } from '../../models/kit'
import { GREY, INK, LABEL, glowMat, setGlow } from './colors'
import { addRod, stretchRod } from './layout'
import { pixelGrid } from './sensing'
import { liveLabel } from './text'

export type Rgb01 = [number, number, number]
/** Pixel values (0…255 per channel) → sRGB 0…1. */
export type PixelView = (px: number[]) => Rgb01
export const asIs: PixelView = (px) => (px.length === 1 ? [px[0] / 255, px[0] / 255, px[0] / 255] : [px[0] / 255, px[1] / 255, px[2] / 255])

const pxAt = (img: Img, i: number) => Array.from(img.data.subarray(i * img.ch, i * img.ch + img.ch))
const clip01 = (v: number) => Math.min(1, Math.max(0, v))

/** Paints `img` onto a `pixelGrid` of the same size. */
export function showImg(grid: ReturnType<typeof pixelGrid>, img: Img, view: PixelView = asIs) {
  for (let i = 0; i < img.w * img.h; i++) {
    const [r, g, b] = view(pxAt(img, i))
    grid.set(i, clip01(r), clip01(g), clip01(b))
  }
  grid.commit()
}

/** `n × n` magnified window of a `cols × rows` grid at `src` (pitch `srcPitch`), drawn at `at` with cell `pitch`. Each cell has three
 *  R/G/B sub-pixel stripes (`split`) or one colour, and an optional value label. A frame marks the window on the source with two leader lines. */
export function zoomInset(parent: THREE.Object3D, src: { cell: (c: number, r: number) => V3 }, srcPitch: number, at: V3, n: number, pitch: number, color = LABEL) {
  const g = add(parent, new THREE.Group(), at)
  const half = (n * pitch) / 2
  const plate = add(g, mesh(new THREE.BoxGeometry(n * pitch + 0.3, n * pitch + 0.3, 0.2), new THREE.MeshStandardMaterial({ color: '#08090c', roughness: 0.8 })), [0, 0, -0.1])
  plate.castShadow = false
  const stripes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), n * n * 3)
  stripes.frustumCulled = false
  g.add(stripes)
  const centre = (c: number, r: number): V3 => [(c - (n - 1) / 2) * pitch, ((n - 1) / 2 - r) * pitch, 0.02]
  const labels = Array.from({ length: n * n }, (_, i) => liveLabel(g, [centre(i % n, Math.floor(i / n))[0], centre(i % n, Math.floor(i / n))[1], 0.08], { size: pitch * 0.2 }))
  const edge = glowMat(color, 1)
  const box = [0, 1, 2, 3].map(() => addRod(parent, edge))
  const leads = [0, 1].map(() => addRod(parent, glowMat(color, 0.4)))
  const ring = [0, 1, 2, 3].map(() => addRod(g, edge))
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()
  const col = new THREE.Color()
  const rect = (rods: THREE.Object3D[], x0: number, y0: number, x1: number, y1: number, z: number, r: number) => {
    const c: V3[] = [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]
    rods.forEach((o, i) => stretchRod(o, c[i], c[(i + 1) % 4], r))
    return c
  }
  rect(ring, -half - 0.15, -half - 0.15, half + 0.15, half + 0.15, 0.05, 0.06)
  return {
    group: g,
    /** Centre the window on pixel (cx, cy); `text(px)` labels cells (null = none); returns the top-left pixel. */
    show(img: Img, cx: number, cy: number, { split = true, view = asIs, text = null as ((px: number[]) => string) | null } = {}) {
      const x0 = Math.min(img.w - n, Math.max(0, Math.round(cx) - Math.floor(n / 2)))
      const y0 = Math.min(img.h - n, Math.max(0, Math.round(cy) - Math.floor(n / 2)))
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) {
          const px = pxAt(img, (y0 + r) * img.w + x0 + c)
          const rgb = view(px)
          const [x, y] = centre(c, r)
          for (let k = 0; k < 3; k++) {
            const i = (r * n + c) * 3 + k
            const w = split ? pitch * 0.27 : pitch * 0.9
            const sx = split ? x + (k - 1) * pitch * 0.3 : x
            m4.compose(p.set(sx, y, 0.02 + (split ? 0 : k * 0.001)), q, s.set(w, pitch * 0.9, 1))
            stripes.setMatrixAt(i, m4)
            const v = split ? clip01(rgb[k]) : 0
            stripes.setColorAt(i, split ? col.setRGB(k === 0 ? v : 0, k === 1 ? v : 0, k === 2 ? v : 0, THREE.SRGBColorSpace) : col.setRGB(clip01(rgb[0]), clip01(rgb[1]), clip01(rgb[2]), THREE.SRGBColorSpace))
          }
          const bright = lumaOf(rgb[0], rgb[1], rgb[2]) > 0.55
          labels[r * n + c].set(text ? text(px) : '', split ? LABEL : bright ? INK : LABEL)
        }
      stripes.instanceMatrix.needsUpdate = true
      stripes.instanceColor!.needsUpdate = true
      const a = src.cell(x0, y0)
      const b = src.cell(x0 + n - 1, y0 + n - 1)
      const e = srcPitch / 2 + 0.04
      const c = rect(box, a[0] - e, b[1] - e, b[0] + e, a[1] + e, a[2] + 0.05, 0.05)
      const right = at[0] > a[0]
      const tl: V3 = [at[0] + (right ? -half : half), at[1] + half, at[2]]
      const bl: V3 = [at[0] + (right ? -half : half), at[1] - half, at[2]]
      stretchRod(leads[0], right ? c[2] : c[3], tl, 0.03)
      stretchRod(leads[1], right ? c[1] : c[0], bl, 0.03)
      return [x0, y0] as const
    },
  }
}

/** `cols × rows` boxes in a group (pixel row 0 at +y), each `height(px)` tall (0…1 × `maxH`) along +z: a brightness landscape. */
export function pixelRelief(parent: THREE.Object3D, at: V3, cols: number, rows: number, pitch: number, maxH: number) {
  const g = add(parent, new THREE.Group(), at)
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }), cols * rows)
  im.frustumCulled = false
  im.castShadow = false
  g.add(im)
  const base = add(g, mesh(new THREE.BoxGeometry(cols * pitch + pitch, rows * pitch + pitch, 0.1), new THREE.MeshStandardMaterial({ color: '#0d0f13', roughness: 0.9 })), [0, 0, -0.05])
  base.castShadow = false
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()
  const col = new THREE.Color()
  return {
    group: g,
    set(img: Img, height: (px: number[]) => number, view: PixelView = asIs) {
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c
          const px = pxAt(img, i)
          const h = Math.max(0.02, clip01(height(px)) * maxH)
          m4.compose(p.set((c - (cols - 1) / 2) * pitch, ((rows - 1) / 2 - r) * pitch, h / 2), q, s.set(pitch * 0.92, pitch * 0.92, h))
          im.setMatrixAt(i, m4)
          const [cr, cg, cb] = view(px)
          im.setColorAt(i, col.setRGB(clip01(cr), clip01(cg), clip01(cb), THREE.SRGBColorSpace))
        }
      im.instanceMatrix.needsUpdate = true
      im.instanceColor!.needsUpdate = true
    },
  }
}

/** Bar chart of `bins` counts, `w × h`, bottom-left at `at`. `set(counts, colorOf?, peak?)`, `axis(left, right)` end labels, `marker(i, u, color, text)` vertical line at u ∈ 0…1, `curve(ys)` dotted line of 0…1 values. */
export function histChart(parent: THREE.Object3D, at: V3, w: number, h: number, bins: number, { left = '0', right = '255', markers = 2, dots = 0 } = {}) {
  const g = add(parent, new THREE.Group(), at)
  const bw = w / bins
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.12), new THREE.MeshBasicMaterial({ color: '#ffffff' }), bins)
  bars.frustumCulled = false
  g.add(bars)
  stretchRod(addRod(g, glowMat(GREY, 0.3)), [-0.2, -0.06, 0], [w + 0.2, -0.06, 0], 0.04)
  const ends = [liveLabel(g, [0, -0.5, 0], { size: 0.3, color: GREY }), liveLabel(g, [w, -0.5, 0], { size: 0.3, color: GREY })]
  const axis = (l: string, r: string) => [l, r].forEach((t, i) => ends[i].set(t, GREY))
  axis(left, right)
  const lines = Array.from({ length: markers }, () => ({ m: glowMat(LABEL, 1.2), tag: liveLabel(g, [0, h + 0.45, 0.1], { size: 0.3 }) })).map((L) => ({ ...L, rod: addRod(g, L.m) }))
  const dotMat = glowMat(LABEL, 1)
  const curve = dots ? new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), dotMat, dots) : null
  if (curve) {
    curve.frustumCulled = false
    g.add(curve)
  }
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()
  const col = new THREE.Color()
  return {
    group: g,
    axis,
    set(counts: readonly number[], colorOf: (bin: number) => Rgb01 = () => [0.79, 0.81, 0.85], peak = Math.max(1, ...counts)) {
      counts.forEach((c, i) => {
        const bh = Math.max(0.02, Math.min(1, c / peak) * h)
        m4.compose(p.set((i + 0.5) * bw, bh / 2, 0), q, s.set(bw * 0.82, bh, 1))
        bars.setMatrixAt(i, m4)
        bars.setColorAt(i, col.setRGB(...colorOf(i), THREE.SRGBColorSpace))
      })
      bars.instanceMatrix.needsUpdate = true
      bars.instanceColor!.needsUpdate = true
    },
    marker(i: number, u: number | null, color = LABEL, text = '') {
      const L = lines[i]
      L.rod.visible = u !== null
      L.tag.group.visible = u !== null
      if (u === null) return
      const x = clip01(u) * w
      stretchRod(L.rod, [x, -0.1, 0.15], [x, h + 0.15, 0.15], 0.05)
      setGlow(L.m, color, 1.2)
      L.tag.group.position.x = x
      L.tag.set(text, color)
    },
    curve(ys: readonly number[], color = LABEL) {
      if (!curve) return
      setGlow(dotMat, color, 1)
      for (let k = 0; k < dots; k++) {
        const u = k / (dots - 1)
        const y = ys[Math.min(ys.length - 1, Math.round(u * (ys.length - 1)))]
        curve.setMatrixAt(k, m4.makeTranslation(u * w, clip01(y) * h, 0.2))
      }
      curve.instanceMatrix.needsUpdate = true
    },
  }
}

/** Hue ring (0° = red at the right, counter-clockwise) of radius `r` with a saturation disc; `set(h, s, v)` moves the marker (angle = hue, radius = saturation). */
export function hueWheel(parent: THREE.Object3D, at: V3, r: number, segs = 48) {
  const g = add(parent, new THREE.Group(), at)
  const ring = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), segs)
  ring.frustumCulled = false
  g.add(ring)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()
  const col = new THREE.Color()
  for (let k = 0; k < segs; k++) {
    const a = ((k + 0.5) / segs) * 2 * Math.PI
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a)
    m4.compose(p.set(r * 0.9 * Math.cos(a), r * 0.9 * Math.sin(a), 0), q, s.set(r * 0.2, (2 * Math.PI * r * 0.9) / segs + 0.02, 1))
    ring.setMatrixAt(k, m4)
    ring.setColorAt(k, col.setRGB(...(hsvToRgb((a * 180) / Math.PI, 1, 1).map((v) => v / 255) as Rgb01), THREE.SRGBColorSpace))
  }
  const disc = add(g, mesh(new THREE.CircleGeometry(r * 0.78, 40), new THREE.MeshBasicMaterial({ color: '#2a2d33' })), [0, 0, -0.02])
  disc.castShadow = false
  const dot = add(g, mesh(new THREE.SphereGeometry(r * 0.09, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffffff' })), [0, 0, 0.1])
  const halo = add(g, mesh(new THREE.RingGeometry(r * 0.1, r * 0.14, 24), new THREE.MeshBasicMaterial({ color: '#ffffff' })), [0, 0, 0.12])
  const spoke = addRod(g, glowMat(LABEL, 0.6))
  return {
    group: g,
    set(h: number, sat: number, v: number) {
      const a = (h * Math.PI) / 180
      const rr = sat * r * 0.78
      const pos: V3 = [rr * Math.cos(a), rr * Math.sin(a), 0.1]
      dot.position.set(...pos)
      halo.position.set(pos[0], pos[1], 0.12)
      ;(dot.material as THREE.MeshBasicMaterial).color.setRGB(...(hsvToRgb(h, sat, Math.max(0.15, v)).map((c) => c / 255) as Rgb01), THREE.SRGBColorSpace)
      stretchRod(spoke, [0, 0, 0.05], pos, 0.035)
    },
  }
}
