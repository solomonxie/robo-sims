import * as THREE from 'three/webgpu'
import { nearestE12 } from '../core/resistorColors'
import { ohms } from '../core/units'
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

export const n = (p: Params, k: string) => Number(p[k])
/** `v` if it is a key of `rec`, else the default `d`. */
export const pick = <R extends object>(rec: R, v: unknown, d: keyof R & string) => (String(v) in rec ? (v as keyof R & string) : d)

/** Param `k` snapped to the nearest E12 resistor value. */
export const e12 = (p: Params, k: string) => nearestE12(n(p, k))

export const resistorSlider = (key: string, label: string, initial: number) =>
  ({ kind: 'slider', key, label, min: 47, max: 1000, initial, log: true, format: (v: number) => ohms(nearestE12(v)) }) as const

/** 0/1 choice for a logic input. */
export const bitChoice = (key: string, label: string, initial: number) => ({
  kind: 'choice' as const,
  key,
  options: [0, 1].map((v) => ({ value: String(v), label: `${label} = ${v}` })),
  initial: String(initial),
})
