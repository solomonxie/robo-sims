// 3D text from the stroke font in core/strokeFont: one merged mesh per label, no fonts or textures.
import * as THREE from 'three/webgpu'
import { add, mat, mesh } from '../../models/kit'
import { layoutText } from '../../core/strokeFont'
import { GREY, LABEL, glowMat } from './colors'

export interface LabelOpts {
  /** Cap height in world units. */
  size?: number
  color?: string
  /** Emissive intensity; `false` = matte. */
  glow?: boolean | number
  align?: 'left' | 'center' | 'right'
  /** Stroke thickness as a fraction of `size`. */
  weight?: number
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)

/** Stroke boxes (square ends overlap at joints), merged into one geometry; facing +z. */
function textGeometry(text: string, size: number, weight = 0.14) {
  const { lines, width } = layoutText(text)
  const t = size * weight
  const src = UNIT_BOX.attributes.position.array as Float32Array
  const nrm = UNIT_BOX.attributes.normal.array as Float32Array
  const idx = UNIT_BOX.index!.array
  const segs: [number, number, number, number][] = []
  for (const l of lines) for (let i = 1; i < l.length; i++) segs.push([l[i - 1][0], l[i - 1][1], l[i][0], l[i][1]])
  const pos = new Float32Array(segs.length * src.length)
  const nor = new Float32Array(segs.length * src.length)
  const index: number[] = []
  const nv = src.length / 3
  segs.forEach(([x0, y0, x1, y1], s) => {
    const dx = (x1 - x0) * size
    const dy = (y1 - y0) * size
    const len = Math.hypot(dx, dy) + t
    const c = len > t ? dx / (len - t) : 1
    const sn = len > t ? dy / (len - t) : 0
    const cx = ((x0 + x1) / 2) * size
    const cy = ((y0 + y1) / 2) * size
    for (let v = 0; v < nv; v++) {
      const px = src[v * 3] * len
      const py = src[v * 3 + 1] * t
      const o = (s * nv + v) * 3
      pos[o] = cx + px * c - py * sn
      pos[o + 1] = cy + px * sn + py * c
      pos[o + 2] = src[v * 3 + 2] * t
      nor[o] = nrm[v * 3] * c - nrm[v * 3 + 1] * sn
      nor[o + 1] = nrm[v * 3] * sn + nrm[v * 3 + 1] * c
      nor[o + 2] = nrm[v * 3 + 2]
    }
    for (let k = 0; k < idx.length; k++) index.push(idx[k] + s * nv)
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  geo.setIndex(index)
  return { geo, width: width * size }
}

/** A text label facing +z, anchored at mid cap height; Q̄ = 'Q\u0304'. One mesh, so cheap to sprinkle. */
export function label(text: string, { size = 1, color = LABEL, glow = 0.9, align = 'center', weight }: LabelOpts = {}) {
  const { geo, width } = textGeometry(text, size, weight)
  const shift = align === 'left' ? 0 : align === 'right' ? -width : -width / 2
  geo.translate(shift, -size / 2, 0)
  const material = glow === false ? mat(color) : glowMat(color, glow === true ? 0.9 : glow)
  return mesh(geo, material)
}

/** A label at `at` whose text (and colour) can change; rebuilds its mesh only when they do. */
export function liveLabel(parent: THREE.Object3D, at: [number, number, number], opts: LabelOpts = {}) {
  const group = new THREE.Group()
  group.position.set(...at)
  parent.add(group)
  let key = ''
  return {
    group,
    set(text: string, color = opts.color ?? LABEL) {
      if (`${text}|${color}` === key) return
      key = `${text}|${color}`
      for (const c of [...group.children]) {
        group.remove(c)
        if (c instanceof THREE.Mesh) c.geometry.dispose()
      }
      if (!text) return
      const m = label(text, { ...opts, color })
      m.castShadow = false
      group.add(m)
    },
  }
}

/** A shadowless `label` added to `parent` at `at`. */
export const addLabel = (parent: THREE.Object3D, s: string, at: [number, number, number], color = GREY, size = 0.6, align: LabelOpts['align'] = 'center') =>
  (add(parent, label(s, { size, color, align }), at).castShadow = false)

/** Three left-aligned text lines from `T0` down, plus a smaller status line under them. */
export function textLines(scene: THREE.Object3D, T0: [number, number, number]) {
  const [a, b, c] = [0, 1, 2].map((i) => liveLabel(scene, [T0[0], T0[1] - i * 1.2, 0], { size: 0.5, align: 'left' }))
  const status = liveLabel(scene, [T0[0], T0[1] - 3.7, 0], { size: 0.38, align: 'left' })
  return { a, b, c, status }
}
