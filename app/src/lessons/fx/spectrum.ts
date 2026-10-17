// Log-wavelength strip of the EM spectrum: coloured bands, decade ticks in λ (below) and f (above), a cursor and a band highlight.
import * as THREE from 'three/webgpu'
import { EM_BANDS, hzOfLambda } from '../../core/physics'
import { hertz, wavelengthText } from '../../core/units'
import { V3 } from '../../models/kit'
import { GREY, LABEL, RING, glowMat, setGlow, spectralColor } from './colors'
import { flatBox } from './shapes'
import { addLabel } from './text'

export const BAND_TINT: Record<(typeof EM_BANDS)[number]['key'], string> = {
  radio: '#6f6bd8',
  microwave: '#3f8fd0',
  infrared: '#b8452f',
  visible: '#ffffff',
  uv: '#8f4cff',
  xray: '#4fb8a8',
  gamma: '#3f9f6a',
}

/** Strip `w` × `h` with its left end at `at` (long λ = `hi` on the left, short = `lo` on the right). */
export function spectrumStrip(parent: THREE.Object3D, at: V3, w: number, h: number, hi: number, lo: number, { names = true, freqs = true, size = 0.26 } = {}) {
  const decades = Math.log10(hi / lo)
  const xOf = (m: number) => at[0] + (Math.log10(hi / Math.min(hi, Math.max(lo, m))) / decades) * w
  const [y, z] = [at[1], at[2]]
  for (const b of EM_BANDS) {
    const [x0, x1] = [xOf(Math.min(hi, b.hi)), xOf(Math.max(lo, b.lo))]
    if (x1 - x0 < 1e-3) continue
    if (b.key === 'visible') {
      const n = 12
      for (let i = 0; i < n; i++) {
        const nm = 750 - ((i + 0.5) / n) * 370
        const m = glowMat('#ffffff', 0.8)
        spectralColor(nm, m.color)
        m.emissive.copy(m.color)
        flatBox(parent, [(x1 - x0) / n, h, 0.12], m, [x0 + ((i + 0.5) / n) * (x1 - x0), y, z])
      }
    } else flatBox(parent, [x1 - x0 - 0.04, h, 0.12], glowMat(BAND_TINT[b.key], 0.45), [(x0 + x1) / 2, y, z])
    if (names && x1 - x0 > 2.5 && b.key !== 'visible') addLabel(parent, b.name, [(x0 + x1) / 2, y, z + 0.12], LABEL, size * 1.05)
    else if (names && b.key === 'visible') addLabel(parent, 'Visible', [(x0 + x1) / 2, y + h / 2 + 1.2, z], LABEL, size)
  }
  const tickM = glowMat(GREY, 0.3)
  for (let k = Math.ceil(Math.log10(lo)); k <= Math.floor(Math.log10(hi)); k++) {
    const m = 10 ** k
    const x = xOf(m)
    flatBox(parent, [0.05, 0.3, 0.05], tickM, [x, y - h / 2 - 0.15, z])
    addLabel(parent, wavelengthText(m).replace('.00 ', ' ').replace('.0 ', ' '), [x, y - h / 2 - 0.55, z], GREY, size * 0.9)
    if (freqs && k % 2 === 0) {
      flatBox(parent, [0.05, 0.3, 0.05], tickM, [x, y + h / 2 + 0.15, z])
      addLabel(parent, hertz(hzOfLambda(m)), [x, y + h / 2 + 0.55, z], GREY, size * 0.9)
    }
  }
  const curM = glowMat(RING, 1)
  const cursor = flatBox(parent, [0.12, h + 0.7, 0.2], curM, [at[0], y, z + 0.1])
  const spanM = glowMat(RING, 0.5)
  spanM.transparent = true
  spanM.opacity = 0.55
  const span = flatBox(parent, [1, h + 0.25, 0.08], spanM, [at[0], y, z + 0.14])
  cursor.visible = span.visible = false
  return {
    xOf,
    cursor(m: number | null, color = RING) {
      cursor.visible = m !== null
      if (m === null) return
      cursor.position.x = xOf(m)
      setGlow(curM, color, 1)
    },
    /** Highlight `a`…`b` (m), at least `min` wide. */
    span(a: number | null, b = a ?? 0, min = 0.25, color = RING) {
      span.visible = a !== null
      if (a === null) return
      const [x0, x1] = [xOf(Math.max(a, b)), xOf(Math.min(a, b))]
      const wd = Math.max(min, x1 - x0)
      span.scale.x = wd
      span.position.x = (x0 + x1) / 2
      setGlow(spanM, color, 0.6)
    },
  }
}
