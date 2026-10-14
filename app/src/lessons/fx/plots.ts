// Quantities drawn as shapes: formula triangle, rulers, area plot, stacked bars.
import * as THREE from 'three/webgpu'
import { V3, add, box, lead, mat, mesh, rod } from '../../models/kit'
import { RING, glowMat, potentialColor } from './colors'
import { arrow } from './shapes'
import { clamp01 } from './util'

/** Formula triangle (top over left × right): outline, ÷ bar and × divider; parts sit in `slots`; `light` one operator. */
export function formulaTriangle(side = 12) {
  const group = new THREE.Group()
  const height = side * 0.866
  const top = (2 * height) / 3
  const base = -height / 3
  const barY = base + height * 0.42
  const halfAt = (y: number) => ((top - y) / height) * (side / 2)
  const edge = mat('#8a8f99', { emissive: '#2a2d33' })
  lead(group, [[0, top, 0], [side / 2, base, 0], [-side / 2, base, 0], [0, top, 0]], 0.14, edge)
  const bar = glowMat('#8a8f99', 0.15)
  const cross = glowMat('#8a8f99', 0.15)
  rod(group, [-halfAt(barY), barY, 0], [halfAt(barY), barY, 0], 0.16, bar)
  rod(group, [0, barY, 0], [0, base, 0], 0.16, cross)
  const lowY = (barY + base) / 2
  const slots: V3[] = [[0, (top + barY) / 2 - height * 0.06, 0], [-halfAt(lowY) / 2, lowY, 0], [halfAt(lowY) / 2, lowY, 0]]
  const light = (which: 'bar' | 'cross' | null, glow = 1.2) => {
    for (const [k, m] of [['bar', bar], ['cross', cross]] as const) {
      const on = k === which
      m.color.set(on ? '#ffffff' : '#8a8f99')
      m.emissive.set(on ? RING : '#8a8f99')
      m.emissiveIntensity = on ? glow : 0.15
    }
  }
  return { group, slots, light }
}

/** Vertical voltage ruler at x: a tick per volt, long ticks every 5 V and at 0. */
export function voltScale(parent: THREE.Object3D, x: number, fromV: number, toV: number, perVolt: number, z = 0) {
  const tickMat = mat('#8a8f99')
  const major = mat('#e8e8e8')
  rod(parent, [x, fromV * perVolt, z], [x, toV * perVolt, z], 0.08, tickMat)
  for (let v = Math.ceil(fromV); v <= toV; v++) {
    const big = v % 5 === 0
    box(parent, [big ? 1.6 : 0.9, 0.12, 0.12], big ? major : tickMat, [x, v * perVolt, z])
  }
}

/** x × y drawn as an area: axes from the origin (arrows tinted `xColor`/`yColor`), a faint grid every `step`,
 *  and a slab whose area is the product. `set(x, y, lit)` sizes it; only the left `lit` fraction glows. */
export function areaPlot(
  parent: THREE.Object3D,
  { maxX, maxY, perX, perY, stepX, stepY, color, xColor, yColor }: {
    maxX: number; maxY: number; perX: number; perY: number; stepX: number; stepY: number; color: string; xColor: string; yColor: string
  },
) {
  const group = add(parent, new THREE.Group())
  const axis = mat('#c9ccd3', { emissive: '#3a3d45' })
  const grid = mat('#3a3e48')
  const xEnd = maxX * perX
  const yEnd = maxY * perY
  rod(group, [0, 0, 0], [xEnd + 0.8, 0, 0], 0.12, axis)
  rod(group, [0, 0, 0], [0, yEnd + 0.8, 0], 0.12, axis)
  for (let k = 1; k * stepX <= maxX + 1e-9; k++) rod(group, [k * stepX * perX, 0, -0.4], [k * stepX * perX, yEnd, -0.4], 0.04, grid)
  for (let k = 1; k * stepY <= maxY + 1e-9; k++) rod(group, [0, k * stepY * perY, -0.4], [xEnd, k * stepY * perY, -0.4], 0.04, grid)
  arrow(group, [xEnd + 1.4, 0, 0], [1, 0, 0], xColor, 0.5)
  arrow(group, [0, yEnd + 1.4, 0], [0, 1, 0], yColor, 0.5)
  const unit = new THREE.BoxGeometry(1, 1, 1)
  const litMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.5, transparent: true, opacity: 0.6, depthWrite: false })
  const spentMat = new THREE.MeshStandardMaterial({ color: '#2a2e36', roughness: 0.7, transparent: true, opacity: 0.6 })
  const lit = add(group, mesh(unit, litMat))
  const spent = add(group, mesh(unit, spentMat))
  const edgeX = add(group, mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 8), glowMat(xColor, 0.8)))
  const edgeY = add(group, mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 8), glowMat(yColor, 0.8)))
  edgeX.rotation.z = Math.PI / 2
  const depth = 0.5
  return {
    group,
    set(x: number, y: number, litFraction = 1) {
      const w = Math.max(0.001, x * perX)
      const h = Math.max(0.001, y * perY)
      const f = clamp01(litFraction)
      lit.visible = f > 0
      lit.scale.set(Math.max(0.001, w * f), h, depth)
      lit.position.set((w * f) / 2, h / 2, 0)
      spent.visible = f < 1
      spent.scale.set(Math.max(0.001, w * (1 - f)), h, depth * 0.6)
      spent.position.set(w * f + (w * (1 - f)) / 2, h / 2, 0)
      edgeX.scale.y = w
      edgeX.position.set(w / 2, h, depth / 2)
      edgeY.scale.y = h
      edgeY.position.set(w, h / 2, depth / 2)
    },
  }
}

/** Column of `count` voltage blocks stacked up from the origin, each tinted by the potential at its middle,
 *  with bright seams between; `set(volts bottom → top)` sizes them (full red at `maxVolts`). */
export function voltStack(parent: THREE.Object3D, count: number, perVolt: number, maxVolts: number, width = 1.2) {
  const group = add(parent, new THREE.Group())
  const unit = new THREE.BoxGeometry(1, 1, 1)
  const seam = mat('#e8e8e8', { emissive: '#666666' })
  const blocks = Array.from({ length: count }, () => {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.5, transparent: true, opacity: 0.85 })
    const block = add(group, mesh(unit, material))
    const cap = box(group, [width + 0.3, 0.12, width * 0.6 + 0.3], seam)
    return { block, material, cap }
  })
  const c = new THREE.Color()
  return {
    group,
    set(volts: number[]) {
      let y = 0
      blocks.forEach(({ block, material, cap }, i) => {
        const v = volts[i] ?? 0
        const h = Math.max(0.001, v * perVolt)
        block.visible = cap.visible = v > 0
        block.scale.set(width, h, width * 0.6)
        block.position.y = y + h / 2
        potentialColor((y + h / 2) / (maxVolts * perVolt), c)
        material.color.copy(c)
        material.emissive.copy(c)
        material.emissiveIntensity = 0.45
        y += h
        cap.position.y = y
      })
    },
  }
}

/** Two columns up from the origin: positive values stack on the left (in), negatives on the right (out), block k tinted
 *  `colors[k]`. When the values sum to 0, as currents at a node do, the columns stand equal. `set(values)`. */
export function inOutBars(parent: THREE.Object3D, colors: string[], perUnit: number, width = 1.2, gap = 0.5) {
  const group = add(parent, new THREE.Group())
  const unit = new THREE.BoxGeometry(1, 1, 1)
  const seam = mat('#e8e8e8', { emissive: '#666666' })
  const blocks = colors.map((c) => ({ block: add(group, mesh(unit, glowMat(c, 0.45))), cap: box(group, [width + 0.3, 0.12, width * 0.6 + 0.3], seam) }))
  const xs = [-(width + gap) / 2, (width + gap) / 2]
  return {
    group,
    set(values: number[]) {
      const tops = [0, 0]
      blocks.forEach(({ block, cap }, k) => {
        const v = values[k] ?? 0
        const side = v >= 0 ? 0 : 1
        const h = Math.abs(v) * perUnit
        block.visible = cap.visible = h > 0.02
        block.scale.set(width, Math.max(0.001, h), width * 0.6)
        block.position.set(xs[side], tops[side] + h / 2, 0)
        tops[side] += h
        cap.position.set(xs[side], tops[side], 0)
      })
    },
  }
}
