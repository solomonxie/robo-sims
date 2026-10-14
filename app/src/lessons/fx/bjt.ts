// Bipolar transistor: the real TO-92 part in a circuit, and an NPN slab cut open (emitter → thin base → collector).
import * as THREE from 'three/webgpu'
import { V3, add, box, mat } from '../../models/kit'
import { buildTo92, TO92 } from '../../models/passives'
import { CONVENTIONAL, ELECTRON, HOLE, glowMat } from './colors'
import { ACCEPTOR, DONOR } from './crystal'
import { glowHalo } from './circuit'
import { segmentDisplay } from './displays'
import { heatGlow } from './heat'
import { clamp01, rand } from './util'

export const partLetter = (parent: THREE.Object3D, text: string, at: V3, height: number, color = '#c9ced8') => {
  const d = segmentDisplay(1, height, color, true)
  d.set(text)
  add(parent, d.group, at)
  return d
}

/** Lesson parts face the key light edge-on, so near-black epoxy reads as a hole; lift it to a glossy dark grey. */
export function litEpoxy(body: THREE.MeshStandardMaterial) {
  body.color.set('#4a4d57')
  body.roughness = 0.3
}

/** The TO-92 (`buildTo92`) at `scale`, laid on its side: legs pointing −x, ending at C = `at` + (0, scale), B = `at`,
 *  E = `at` − (0, scale), so the base faces its drive and C/E run up/down; lettered (`letters`, top first) right of the body. `set(f, heat)`:
 *  f = collector current / full scale glows the die, heat 0..1 reddens the epoxy. */
export function transistorPart(parent: THREE.Object3D, at: V3, { scale = 1.6, letters = ['C', 'B', 'E'] } = {}) {
  const group = add(parent, new THREE.Group(), [at[0] + 1.5 * scale, at[1], at[2]])
  group.rotation.z = -Math.PI / 2
  const flip = add(group, new THREE.Group())
  flip.rotation.y = Math.PI
  const part = add(flip, buildTo92())
  part.scale.setScalar(scale)
  const body = part.userData.body as THREE.MeshStandardMaterial
  litEpoxy(body)
  const dieX = at[0] + (1.5 + TO92.base + TO92.h / 2) * scale
  const halo = glowHalo(flip, [0, (TO92.base + TO92.h / 2) * scale, -(TO92.r + 0.3) * scale], 0.8 * scale)
  const edge = at[0] + (1.5 + TO92.base + TO92.h + 0.45) * scale
  ;letters.forEach((t, i) => partLetter(parent, t, [edge, at[1] + (1 - i) * scale, at[2]], 0.5 * scale))
  return {
    group,
    pins: { c: [at[0], at[1] + scale, at[2]] as V3, b: at, e: [at[0], at[1] - scale, at[2]] as V3 },
    /** Centre of the body, where charges cross from C to E. */
    die: [dieX, at[1], at[2]] as V3,
    set(f: number, heat = 0) {
      halo.set(0.45 * Math.sqrt(clamp01(f)), CONVENTIONAL)
      heatGlow(body, heat)
    },
  }
}

const tint = (color: string, k: number) => `#${new THREE.Color(color).lerp(new THREE.Color('#1c1e24'), k).getHexString()}`
const MAX_E = 140
const MAX_H = 24
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

export interface BjtDieStep {
  /** Electrons injected per second through the emitter (shown, not real), and the fraction that recombine in the base. */
  rate: number
  recombine: number
  /** 0..1: the collector junction forward-biased too; electrons crowd the base. */
  saturation: number
}

/** NPN cut open facing +z, centred on `at`: n+ emitter (left), a thin p base, n collector (right); contacts E, B (top of the
 *  base) and C. Electrons cross from E to C; a few recombine in the base with holes fed in from B (the base current). */
export function bjtDie(parent: THREE.Object3D, at: V3, { width = 12, height = 3.6, depth = 2.4 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const eW = width * 0.32
  const bW = width * 0.12
  const cW = width - eW - bW
  const x0 = -width / 2
  const xb = x0 + eW
  const xc = xb + bW
  box(group, [eW, height, depth], mat(tint(DONOR, 0.25), { rough: 0.6 }), [x0 + eW / 2, 0, 0])
  const baseMat = mat(tint(ACCEPTOR, 0.5), { rough: 0.6 }, true)
  box(group, [bW, height, depth], baseMat, [xb + bW / 2, 0, 0])
  box(group, [cW, height, depth], mat(tint(DONOR, 0.55), { rough: 0.6 }), [xc + cW / 2, 0, 0])
  const metal = mat('#b9bec6', { metal: 0.4, rough: 0.35 })
  box(group, [0.6, height + 0.4, depth * 0.8], metal, [x0 - 0.3, 0, 0])
  box(group, [0.6, height + 0.4, depth * 0.8], metal, [width / 2 + 0.3, 0, 0])
  box(group, [bW * 0.9, 0.5, depth * 0.8], metal, [xb + bW / 2, height / 2 + 0.25, 0])
  const front = depth / 2 + 0.06
  const lh = height * 0.22
  partLetter(group, 'n', [x0 + eW / 2, -height / 2 + lh * 0.9, front], lh)
  partLetter(group, 'P', [xb + bW / 2, -height / 2 + lh * 0.9, front], lh)
  partLetter(group, 'n', [xc + cW / 2, -height / 2 + lh * 0.9, front], lh)
  partLetter(group, 'E', [x0 - 1.2, 0, 0], 0.9)
  partLetter(group, 'C', [width / 2 + 1.2, 0, 0], 0.9)
  partLetter(group, 'B', [xb + bW / 2 + 1, height / 2 + 0.9, 0], 0.9)

  const electrons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 10, 8), glowMat(ELECTRON, 1.3), MAX_E)
  const holes = new THREE.InstancedMesh(new THREE.TorusGeometry(0.2, 0.07, 8, 16), glowMat(HOLE, 1.1), MAX_H)
  for (const o of [electrons, holes]) {
    o.frustumCulled = false
    o.castShadow = false
    group.add(o)
  }
  const es = Array.from({ length: MAX_E }, () => ({ live: false, x: 0, y: 0, stop: Infinity, fade: 0 }))
  const hs = Array.from({ length: MAX_H }, () => ({ live: false, x: 0, y: 0, stopY: 0 }))
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  const pinkBase = new THREE.Color(tint(ACCEPTOR, 0.5))
  const flooded = new THREE.Color(ELECTRON)
  let spawn = 0
  const y0 = -height / 2 + 0.35
  const y1 = height / 2 - 0.35

  return {
    group,
    pins: {
      e: [at[0] + x0 - 0.6, at[1], at[2]] as V3,
      b: [at[0] + xb + bW / 2, at[1] + height / 2 + 0.5, at[2]] as V3,
      c: [at[0] + width / 2 + 0.6, at[1], at[2]] as V3,
    },
    step(dt: number, { rate, recombine, saturation }: BjtDieStep) {
      spawn += dt * rate
      const speed = 7 * (1 - 0.3 * clamp01(saturation))
      for (const e of es) {
        if (spawn < 1) break
        if (e.live) continue
        spawn -= 1
        const dies = Math.random() < recombine
        Object.assign(e, { live: true, x: x0 + rand(0, 0.6), y: rand(y0, y1), stop: dies ? xb + rand(0.2, 0.85) * bW : Infinity, fade: 1 })
        if (dies) {
          const free = hs.find((h) => !h.live)
          if (free) Object.assign(free, { live: true, x: e.stop, y: height / 2, stopY: e.y })
        }
      }
      spawn = Math.min(spawn, 2)
      es.forEach((e, i) => {
        if (!e.live) return electrons.setMatrixAt(i, HIDDEN)
        const inBase = e.x > xb && e.x < xc
        const v = speed * (inBase ? 0.6 + 0.4 * (1 - clamp01(saturation)) : 1)
        if (e.x < e.stop) e.x = Math.min(e.stop, e.x + v * dt)
        else e.fade -= dt * 2.5
        e.y += rand(-1, 1) * dt * 0.8
        e.y = Math.min(y1, Math.max(y0, e.y))
        if (e.x > width / 2 || e.fade <= 0) e.live = false
        electrons.setMatrixAt(i, e.live ? m.compose(p.set(e.x, e.y, front + 0.1), q, s.setScalar(Math.max(0.01, e.fade))) : HIDDEN)
      })
      hs.forEach((h, i) => {
        if (!h.live) return holes.setMatrixAt(i, HIDDEN)
        h.y -= dt * 4
        if (h.y <= h.stopY) h.live = false
        holes.setMatrixAt(i, h.live ? m.makeTranslation(h.x, h.y, front + 0.12) : HIDDEN)
      })
      electrons.instanceMatrix.needsUpdate = holes.instanceMatrix.needsUpdate = true
      baseMat.color.copy(pinkBase).lerp(flooded, 0.45 * clamp01(saturation))
    },
  }
}
