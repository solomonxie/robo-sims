// Visual vocabulary shared by lessons.
import * as THREE from 'three/webgpu'
import { V3, add, mesh } from '../models/kit'

export const ELECTRON = '#4da6ff'
export const CONVENTIONAL = '#ff9a2e'

export function glowMat(color: string, intensity = 0.7) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 })
}

const UP = new THREE.Vector3(0, 1, 0)

export function arrow(parent: THREE.Object3D, at: V3, dir: V3, color = CONVENTIONAL, size = 1) {
  const g = new THREE.Group()
  const material = glowMat(color, 0.5)
  add(g, mesh(new THREE.CylinderGeometry(0.18 * size, 0.18 * size, 1.4 * size, 10), material), [0, -0.5 * size, 0])
  add(g, mesh(new THREE.ConeGeometry(0.55 * size, 1.1 * size, 16), material), [0, 0.6 * size, 0])
  g.position.set(...at)
  g.quaternion.setFromUnitVectors(UP, new THREE.Vector3(...dir).normalize())
  parent.add(g)
  return g
}

export function randomDir(len: number): THREE.Vector3 {
  return new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(len)
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a)
