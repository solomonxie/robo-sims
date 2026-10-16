// Cell maze on a floor (metres, z up, cell 0's corner at the origin): wall blocks, posts, cell tiles and cell numbers.
import * as THREE from 'three/webgpu'
import { MAZE, neighbour } from '../../core/physics'
import { V3, add, box, mat } from '../../models/kit'
import { flatBox } from './shapes'
import { liveLabel } from './text'

const WALL_H = 0.05

function instanced(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, max: number) {
  const im = new THREE.InstancedMesh(geo, m, max)
  im.frustumCulled = false
  im.castShadow = im.receiveShadow = false
  im.setColorAt(0, new THREE.Color())
  parent.add(im)
  return im
}

/** `posts: false` + `walls(() => null)` = a plain grid map. `walls(colorOf)` shows each wall side (null hides it), `tiles(colorOf)` tints cells, `numbers(textOf, colorOf)` writes on them. */
export function mazeModel(parent: THREE.Object3D, w: number, h: number, { cellM = MAZE.cellM, wallM = MAZE.wallM, numberSize = 0.09, posts = true } = {}) {
  const g = add(parent, new THREE.Group())
  flatBox(g, [w * cellM + wallM, h * cellM + wallM, 0.01], mat('#23262d', { rough: 0.85 }), [(w * cellM) / 2, (h * cellM) / 2, -0.005])
  const postMat = mat('#9aa0ab', { rough: 0.5 })
  if (posts) for (let x = 0; x <= w; x++) for (let y = 0; y <= h; y++) box(g, [wallM * 1.3, wallM * 1.3, WALL_H * 1.05], postMat, [x * cellM, y * cellM, (WALL_H * 1.05) / 2]).castShadow = false
  const sides: [number, number][] = []
  const ref = { w, h, walls: new Uint8Array(4 * w * h) }
  for (let c = 0; c < w * h; c++) for (const d of [2, 3, 0, 1]) if (d >= 2 || neighbour(ref, c, d) < 0) sides.push([c, d])
  const wallIm = instanced(g, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }), sides.length)
  const tileIm = instanced(g, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), w * h)
  const m4 = new THREE.Matrix4()
  const col = new THREE.Color()
  const centre = (c: number): V3 => [((c % w) + 0.5) * cellM, (Math.floor(c / w) + 0.5) * cellM, 0]
  const nums = Array.from({ length: w * h }, (_, c) => liveLabel(g, [centre(c)[0], centre(c)[1], 0.004], { size: numberSize }))
  return {
    group: g,
    centre,
    walls(colorOf: (c: number, d: number) => string | null) {
      sides.forEach(([c, d], k) => {
        const color = colorOf(c, d)
        const [cx, cy] = centre(c)
        const along = d === 0 || d === 2
        const [x, y] = along ? [cx, cy + (d === 0 ? 0.5 : -0.5) * cellM] : [cx + (d === 1 ? 0.5 : -0.5) * cellM, cy]
        if (color === null) m4.makeScale(0, 0, 0)
        else m4.makeScale(along ? cellM : wallM, along ? wallM : cellM, WALL_H).setPosition(x, y, WALL_H / 2)
        wallIm.setMatrixAt(k, m4)
        wallIm.setColorAt(k, col.set(color ?? '#000000'))
      })
      wallIm.instanceMatrix.needsUpdate = true
      wallIm.instanceColor!.needsUpdate = true
    },
    tiles(colorOf: (c: number) => string | null) {
      for (let c = 0; c < w * h; c++) {
        const color = colorOf(c)
        const s = cellM * 0.92
        tileIm.setMatrixAt(c, color === null ? m4.makeScale(0, 0, 0) : m4.makeScale(s, s, 0.004).setPosition(centre(c)[0], centre(c)[1], 0.002))
        tileIm.setColorAt(c, col.set(color ?? '#000000'))
      }
      tileIm.instanceMatrix.needsUpdate = true
      tileIm.instanceColor!.needsUpdate = true
    },
    numbers(textOf: (c: number) => string, colorOf: (c: number) => string) {
      nums.forEach((l, c) => l.set(textOf(c), colorOf(c)))
    },
  }
}
