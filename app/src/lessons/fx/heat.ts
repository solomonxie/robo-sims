import * as THREE from 'three/webgpu'
import { add, box, mat, mesh } from '../../models/kit'
import { HIGH_V, glowMat } from './colors'
import { clamp01, rand } from './util'

/** Red-hot glow for a material: 0 = off, 1 = bright orange. */
export function heatGlow(material: THREE.MeshStandardMaterial, f: number) {
  const t = clamp01(f)
  material.emissive.set('#b01800').lerp(new THREE.Color('#ff8a1e'), t)
  material.emissiveIntensity = t * t * 1.6
}

/** Glass thermometer standing on the origin, bulb at the bottom; `set(0..1)` fills it. */
export function thermometer(height = 10) {
  const group = new THREE.Group()
  const red = glowMat(HIGH_V, 0.6)
  const glass = new THREE.MeshStandardMaterial({ color: '#e8eef8', transparent: true, opacity: 0.14, roughness: 0.05, depthWrite: false })
  add(group, mesh(new THREE.SphereGeometry(0.9, 24, 16), red), [0, 0.9, 0])
  const column = add(group, mesh(new THREE.CylinderGeometry(0.55, 0.55, height, 24, 1, true), glass), [0, 0.9 + height / 2, 0])
  column.castShadow = false
  add(group, mesh(new THREE.SphereGeometry(0.55, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass), [0, 0.9 + height, 0]).castShadow = false
  const fill = add(group, mesh(new THREE.CylinderGeometry(0.3, 0.3, 1, 16), red), [0, 0.9, 0])
  const tickMat = mat('#8a8f99')
  for (let i = 1; i < 10; i++) box(group, [i % 5 === 0 ? 0.9 : 0.5, 0.08, 0.08], tickMat, [-0.85, 0.9 + (i / 10) * height, 0])
  return {
    group,
    set(f: number) {
      const h = Math.max(0.05, clamp01(f) * height)
      fill.scale.y = h
      fill.position.y = 0.9 + h / 2
    },
  }
}

/** Wavy heat lines rising from a strip `width` wide along x at the origin; `step(dt, heat 0..1)`. */
export function heatWaves(parent: THREE.Object3D, width: number, { count = 5, rise = 5 } = {}) {
  const group = add(parent, new THREE.Group())
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, k) => new THREE.Vector3(0.35 * Math.sin(k * 1.6), (k / 8) * 2.4, 0)))
  const geometry = new THREE.TubeGeometry(curve, 48, 0.09, 6)
  const lines = Array.from({ length: count }, (_, i) => {
    const material = new THREE.MeshBasicMaterial({ color: '#ff9a4d', transparent: true, opacity: 0, depthWrite: false })
    const m = add(group, mesh(geometry, material), [count === 1 ? 0 : -width / 2 + (i / (count - 1)) * width, 0, 0])
    m.castShadow = false
    return { m, material, phase: i / count + rand(0, 0.15) }
  })
  return {
    group,
    step(dt: number, heat: number) {
      const h = clamp01(heat)
      for (const l of lines) {
        l.phase = (l.phase + dt * (0.35 + 0.5 * h)) % 1
        l.m.position.y = l.phase * rise
        l.material.opacity = 0.75 * h * Math.sin(Math.PI * l.phase)
        l.m.visible = h > 0.01
      }
    },
  }
}

/** Grey puffs rising from the origin, spread over `width` along x; `step(dt, amount 0..1)` sets how many. */
export function smoke(parent: THREE.Object3D, width: number, { count = 24, rise = 7 } = {}) {
  const puffs = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.6, 14, 10),
    new THREE.MeshStandardMaterial({ color: '#c3c6cc', roughness: 1, transparent: true, opacity: 0.3, depthWrite: false }),
    count,
  )
  puffs.frustumCulled = false
  puffs.castShadow = false
  const group = add(parent, new THREE.Group())
  group.add(puffs)
  const life = Array.from({ length: count }, () => 1)
  const x = Array.from({ length: count }, () => 0)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const sc = new THREE.Vector3()
  return {
    group,
    step(dt: number, amount: number) {
      const a = clamp01(amount)
      for (let i = 0; i < count; i++) {
        if (life[i] >= 1 && Math.random() < dt * 6 * a) {
          life[i] = 0
          x[i] = rand(-width / 2, width / 2)
        }
        if (life[i] < 1) life[i] = Math.min(1, life[i] + dt / 2.2)
        const t = life[i]
        const s = t >= 1 ? 0 : (0.4 + 1.6 * t) * Math.sin(Math.PI * Math.min(1, t * 1.3 + 0.05))
        p.set(x[i] + Math.sin(t * 5 + i) * 0.6, t * rise, Math.cos(t * 4 + i) * 0.4)
        puffs.setMatrixAt(i, m.compose(p, q, sc.setScalar(Math.max(0.001, s))))
      }
      puffs.instanceMatrix.needsUpdate = true
    },
  }
}
