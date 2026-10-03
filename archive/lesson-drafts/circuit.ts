// The shared single-loop circuit: cell on the left (+ up), a part on the right.
import * as THREE from 'three/webgpu'
import { V3 } from '../models/kit'
import { createStage } from '../scene/stage'
import { CONVENTIONAL, Flow, arrow, cell, path, wire } from './fx'
import { Stage } from './types'

export const W = 12
export const H = 7
export const CELL_HALF = 2.5

/** Electron direction: out of − (bottom), around, back into + (top), down through the cell. */
export const LOOP: V3[] = [
  [-W, -CELL_HALF, 0],
  [-W, -H, 0],
  [W, -H, 0],
  [W, H, 0],
  [-W, H, 0],
  [-W, CELL_HALF, 0],
]

export const CIRCUIT_VIEW: Stage['view'] = { center: [0, 0, 0], radius: 42, polar: 1.25, azimuth: 0.35 }

export function circuitScene() {
  return createStage({ deskY: -H - 3, span: 22 })
}

export interface Loop {
  battery: THREE.Group
  electrons: Flow
}

/** Wires, cell, electron flow and conventional-current arrows for LOOP. */
export function standardLoop(scene: THREE.Scene, { arrows = true } = {}): Loop {
  wire(scene, LOOP)
  const battery = cell(CELL_HALF * 2)
  battery.position.set(-W, 0, 0)
  scene.add(battery)
  const electrons = new Flow(path(LOOP, true))
  scene.add(electrons.mesh)
  if (arrows) conventionalArrows(scene)
  return { battery, electrons }
}

export function conventionalArrows(scene: THREE.Object3D) {
  arrow(scene, [-6, H + 1.6, 0], [1, 0, 0], CONVENTIONAL, 0.8)
  arrow(scene, [0, -H - 1.6, 0], [-1, 0, 0], CONVENTIONAL, 0.8)
  arrow(scene, [W + 1.6, -4.5, 0], [0, -1, 0], CONVENTIONAL, 0.8)
}
