// Slicer scene for the wheel hub in printer mm × k (bed x, y; z up): tilted bed, layer stack, lathe shell, toolpath beads, flat layer preview.
import * as THREE from 'three/webgpu'
import { HubForm, SegKind, SliceSeg } from '../../core/physics'
import { V3, add } from '../../models/kit'
import { glowDot, shellMat } from './shapes'
import { FILAMENT_COLOR, printBeads } from './printer'

export const SEG_COLORS: Record<SegKind, string> = { outer: FILAMENT_COLOR, inner: '#ffd166', gap: '#ff5fd2', skin: '#5aa9ff', infill: '#7ee081' }
export const SEG_NAMES: Record<SegKind, string> = { outer: 'Outer wall', inner: 'Inner walls', gap: 'Gap fill', skin: 'Top/bottom skin', infill: 'Infill' }

/** Lathe of an (r, z) outline in mm × k, y up. */
export const hubLathe = (profile: readonly [number, number][], k: number, segments = 64) =>
  new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(Math.max(1e-3, r * k), z * k)), segments)

export interface StackLayer {
  z: number
  h: number
  rOut: number
  rIn: number
}

/** Stack of printed layers: solid discs (round or square) with the bore drawn dark; `set(layers, count, form, color(i))`. */
export function layerStack(parent: THREE.Object3D, k: number, max = 600) {
  const mk = (sides: number, color: string) => {
    const m = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, sides), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }), max)
    m.count = 0
    m.frustumCulled = false
    parent.add(m)
    return m
  }
  const round = mk(48, '#ffffff')
  const square = mk(4, '#ffffff')
  const bore = mk(24, '#16181c')
  const M = new THREE.Matrix4()
  const R = new THREE.Matrix4().makeRotationY(Math.PI / 4)
  const c = new THREE.Color()
  return {
    set(layers: readonly StackLayer[], count: number, form: HubForm, color: (i: number) => string) {
      const outer = form === 'square' ? square : round
      round.visible = form === 'round'
      square.visible = form === 'square'
      const n = Math.min(max, count, layers.length)
      for (let i = 0; i < n; i++) {
        const L = layers[i]
        const r = (form === 'square' ? L.rOut * Math.SQRT2 : L.rOut) * k
        M.makeScale(r, L.h * k * 0.92, r).setPosition(0, (L.z + L.h / 2) * k, 0)
        if (form === 'square') M.multiply(R)
        outer.setMatrixAt(i, M)
        outer.setColorAt(i, c.set(color(i)))
        M.makeScale(L.rIn * k, L.h * k * 1.02, L.rIn * k).setPosition(0, (L.z + L.h / 2) * k, 0)
        bore.setMatrixAt(i, M)
      }
      for (const m of [outer, bore]) {
        m.count = n
        m.instanceMatrix.needsUpdate = true
        if (m.instanceColor) m.instanceColor.needsUpdate = true
      }
    },
  }
}

/** Tilted bed with the hub on it: `holder` (bed-local, y up), layer `stack`, see-through `shell`, toolpath `beads`, `nozzle`. */
export function slicerRig(parent: THREE.Object3D, at: V3, k: number, { tilt = 0.42, turn = -0.5, bed = 52, beads = 900 } = {}) {
  const holder = add(parent, new THREE.Group(), at)
  holder.rotation.set(tilt, turn, 0)
  add(holder, new THREE.Mesh(new THREE.BoxGeometry(bed * k, 1.2 * k, bed * k), new THREE.MeshStandardMaterial({ color: '#3a3f48', metalness: 0.3, roughness: 0.4 }))).position.y = -0.6 * k
  const stack = layerStack(holder, k)
  const shell = add(holder, new THREE.Mesh(new THREE.BufferGeometry(), shellMat('#6f8cff', 0.14)))
  const beadsMesh = printBeads(holder, beads, k)
  const nozzle = add(holder, new THREE.Mesh(new THREE.ConeGeometry(1.6 * k, 3 * k, 6), new THREE.MeshStandardMaterial({ color: '#d9b24a', metalness: 0.45, roughness: 0.35 })))
  nozzle.rotation.x = Math.PI
  return {
    holder,
    stack,
    shell,
    beads: beadsMesh,
    nozzle,
    setShell(profile: readonly [number, number][]) {
      shell.geometry.dispose()
      shell.geometry = hubLathe(profile, k)
    },
    /** Lays one layer's toolpath at height z, coloured by kind; returns the bead count. */
    layLayer(segs: readonly SliceSeg[], z: number, h: number, colors = SEG_COLORS) {
      const n = Math.min(segs.length, beadsMesh.max)
      for (let i = 0; i < n; i++) beadsMesh.lay(i, segs[i].a, segs[i].b, z, Math.max(0.12, segs[i].w), h, colors[segs[i].kind])
      return n
    },
    nozzleAt(x: number, y: number, z: number) {
      nozzle.position.set(x * k, (z + 1.5) * k, -y * k)
    },
  }
}

/** Flat top-down layer preview facing the camera, `span` mm wide drawn `size` scene units wide; `show(segs, upto)` + nozzle dot. */
export function layerPreview(parent: THREE.Object3D, at: V3, span: number, size: number, max = 1500) {
  let k = size / span
  const g = add(parent, new THREE.Group(), at)
  g.rotation.x = Math.PI / 2
  const plate = add(g, new THREE.Mesh(new THREE.CylinderGeometry(size * 0.56, size * 0.56, 0.1, 48), new THREE.MeshStandardMaterial({ color: '#1d2026', roughness: 0.8 })))
  plate.position.y = -0.1
  const inner = add(g, new THREE.Group())
  const beads = printBeads(inner, max, k)
  const dot = glowDot(parent, 0.22, '#ffffff')
  let segs: readonly SliceSeg[] = []
  return {
    group: g,
    k,
    plate,
    /** Lays the path; call `show(n)` after. */
    set(path: readonly SliceSeg[], colors: Record<SegKind, string> = SEG_COLORS, height = 0.3) {
      segs = path
      const n = Math.min(path.length, max)
      for (let i = 0; i < n; i++) beads.lay(i, path[i].a, path[i].b, 0, Math.max(0.12, path[i].w * 0.85), height, colors[path[i].kind])
      beads.show(n)
      return n
    },
    show(n: number) {
      beads.show(n)
    },
    /** Zooms so a part of radius `r` mm fills the plate. */
    fit(r: number) {
      const f = span / (2.25 * Math.max(1, r))
      inner.scale.set(f, 1, f)
      k = (size / span) * f
    },
    /** Nozzle dot at bed (x, y) mm, or hidden. */
    dotAt(p: { x: number; y: number } | null) {
      dot.visible = !!p
      if (p) dot.position.set(at[0] + p.x * k, at[1] + p.y * k, at[2] + 0.6)
    },
    get count() {
      return Math.min(segs.length, max)
    },
  }
}
