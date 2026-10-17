import * as THREE from 'three/webgpu'
import { mat } from '../../models/kit'
import { clamp01 } from './util'

export const ELECTRON = '#4da6ff'
export const HOLE = '#ff6a5a'
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
export const LABEL = '#c9ced8'
export const LED_RED = '#ff3b30'
export const HEAT = '#ff9a4d'
export const COPPER = () => mat('#c8803f', { metal: 0.35, rough: 0.4 })

export function glowMat(color: string, intensity = 0.7) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 })
}

/** 0 → LOW_V (blue), 1 → HIGH_V (red). */
export function potentialColor(f: number, out = new THREE.Color()): THREE.Color {
  return out.set(LOW_V).lerp(new THREE.Color(HIGH_V), clamp01(f))
}
export const CLK_COLOR = '#5ad8e6'
export const DATA_COLOR = '#b48cff'
/** Dark text on lit plates. */
export const INK = '#14161b'

export function setGlow(m: THREE.MeshStandardMaterial, color: string, k: number) {
  m.color.set(color)
  m.emissive.set(color)
  m.emissiveIntensity = k
}

/** Readout tone → colour for 3D text. */
export const toneColor = { ok: POWER, warn: HEAT, bad: HIGH_V }
export const lit = (c: string) => new THREE.Color(c)

const IRONBOW = ['#000010', '#2a0a6e', '#8c0e8c', '#d6334a', '#f57a16', '#fcc232', '#ffffd8'].map(lit)
/** Thermal-camera false colour (ironbow): 0 = cold black-blue … 1 = hot white. */
export function ironbow(f: number, out = new THREE.Color()): THREE.Color {
  const x = clamp01(f) * (IRONBOW.length - 1)
  const i = Math.min(IRONBOW.length - 2, Math.floor(x))
  return out.copy(IRONBOW[i]).lerp(IRONBOW[i + 1], x - i)
}
