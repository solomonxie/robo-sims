import * as THREE from 'three/webgpu'
import { V3 } from '../models/kit'

export type Params = Record<string, number | string>

export interface Readout {
  label: string
  value: string
  tone?: 'ok' | 'warn' | 'bad'
}

export interface SliderControl {
  kind: 'slider'
  key: string
  label: string
  min: number
  max: number
  initial: number
  step?: number
  log?: boolean
  format: (v: number) => string
}

export interface ChoiceControl {
  kind: 'choice'
  key: string
  options: { value: string; label: string }[]
  initial: string
}

export type Control = SliderControl | ChoiceControl

export interface Stage {
  scene: THREE.Scene
  view: { center: V3; radius: number; polar?: number; azimuth?: number }
  /** Every frame, with the current control values. */
  frame: (dt: number, p: Params) => void
  readouts: (p: Params) => Readout[]
}

export interface LegendItem {
  color: string
  label: string
  shape: 'dot' | 'arrow-left' | 'arrow-right'
}

export interface Lesson {
  id: string
  title: string
  tagline: string
  formula: string | ((p: Params) => string)
  points: string[]
  legend?: LegendItem[]
  controls: Control[]
  build: () => Stage
}

export interface Unit {
  title: string
  lessons: Lesson[]
}

export const initialParams = (l: Lesson): Params =>
  Object.fromEntries(l.controls.map((c) => [c.key, c.initial]))

/** Runs `rebuild` on the first frame and whenever any of `keys` changes. */
export function onChange(keys: string[], rebuild: (p: Params) => void) {
  let last = ''
  return (p: Params) => {
    const sig = keys.map((k) => p[k]).join('|')
    if (sig === last) return
    last = sig
    rebuild(p)
  }
}

export const n = (p: Params, k: string) => Number(p[k])
