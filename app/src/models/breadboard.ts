import * as THREE from 'three/webgpu'
import { BOARD, generateHoles, holePosition } from '../core/breadboard'
import { box, mat } from './kit'

const RAIL_LINES: [number, string][] = [
  [-10.3, '#2a55c9'],
  [-7.7, '#d4282b'],
  [7.7, '#d4282b'],
  [10.3, '#2a55c9'],
]

/** Top surface at y = 0; the body hangs below. */
export function buildBreadboard(): THREE.Group {
  const g = new THREE.Group()
  const plastic = mat('#f2efe6', { rough: 0.85 })
  box(g, [BOARD.width, BOARD.height, BOARD.depth], plastic, [0, -BOARD.height / 2, 0])

  // Center channel and the grooves between rails and strips.
  const groove = mat('#d6d2c6', { rough: 0.9 })
  box(g, [BOARD.width, 0.02, 1.4], groove, [0, 0.005, 0])
  box(g, [BOARD.width, 0.02, 0.35], groove, [0, 0.005, -7.05])
  box(g, [BOARD.width, 0.02, 0.35], groove, [0, 0.005, 7.05])

  for (const [z, color] of RAIL_LINES) box(g, [BOARD.width - 3, 0.02, 0.14], mat(color), [0, 0.008, z])

  const holes = generateHoles()
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.03, 0.42), mat('#34343a', { rough: 1 }), holes.length)
  const m = new THREE.Matrix4()
  holes.forEach((hole, i) => {
    const { x, z } = holePosition(hole)
    inst.setMatrixAt(i, m.makeTranslation(x, 0.006, z))
  })
  inst.receiveShadow = true
  g.add(inst)
  return g
}
