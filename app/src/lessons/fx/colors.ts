import * as THREE from 'three/webgpu'
import { mat } from '../../models/kit'
import { clamp01 } from './util'

export const ELECTRON = '#4da6ff'
export const CONVENTIONAL = '#ff9a2e'
export const RING = '#ffd84d'
export const HIGH_V = '#ff4d4d'
export const LOW_V = '#3d6bff'
export const POWER = '#5ce1a0'
export const B_FIELD = '#5ad8e6'
export const NORTH = '#ff5a4d'
export const SOUTH = '#4d7dff'
export const FORCE = '#ff7ad9'
export const OHMS_LABEL = '#e8e8e8'
export const GREY = '#8a8f99'
export const COPPER = () => mat('#c8803f', { metal: 0.35, rough: 0.4 })

export function glowMat(color: string, intensity = 0.7) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 })
}

/** 0 → LOW_V (blue), 1 → HIGH_V (red). */
export function potentialColor(f: number, out = new THREE.Color()): THREE.Color {
  return out.set(LOW_V).lerp(new THREE.Color(HIGH_V), clamp01(f))
}
