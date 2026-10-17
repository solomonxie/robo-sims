// RL gridworld on a floor (metres, z up): cell board with wall blocks, value tiles, policy arrows, Q wedges and a robot replaying an episode.
import * as THREE from 'three/webgpu'
import { DIR_TH, GridWorld, GwStepLog, MAZE, isTerminal } from '../../core/physics'
import { box, mat } from '../../models/kit'
import { mazeModel } from './maze'
import { liveLabel } from './text'
import { diffBot } from './wheeled'

export const GW_COLORS = { goal: '#2f8f5b', pit: '#5a1a1a', near: '#7a6a1f', wall: '#9aa0ab', edge: '#d9dce3', arrow: '#f2f2ee' }

function instanced(parent: THREE.Object3D, geo: THREE.BufferGeometry, max: number) {
  const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }), max)
  im.frustumCulled = false
  im.castShadow = im.receiveShadow = false
  im.setColorAt(0, new THREE.Color())
  parent.add(im)
  return im
}
function arrowGeometry() {
  const s = new THREE.Shape()
  ;[[-0.3, 0.07], [0.08, 0.07], [0.08, 0.2], [0.34, 0], [0.08, -0.2], [0.08, -0.07], [-0.3, -0.07]].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)))
  return new THREE.ShapeGeometry(s)
}
function wedgeGeometry() {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([0.04, 0, 0, 0.46, -0.42, 0, 0.46, 0.42, 0], 3))
  return g
}

/** Board for `world`: `tiles(colorOf)` for floor cells (terminals keep their colour), `numbers`, `arrows(dirOf, colorOf)`, `wedges(colorOf(c, a))`, `drive(log, k)` (k = steps done, fractional). */
export function gridWorldBoard(parent: THREE.Object3D, world: GridWorld, { cellM = MAZE.cellM, numberSize = 0 } = {}) {
  const { w, h, cells } = world
  const mz = mazeModel(parent, w, h, { cellM, posts: false, numberSize: 0.01 })
  const arrowK = numberSize ? 0.72 : 1
  const arrowDy = numberSize ? 0.1 * cellM : 0
  const nums = numberSize ? cells.map((_, c) => liveLabel(parent, [mz.centre(c)[0], mz.centre(c)[1] - 0.29 * cellM, 0.012], { size: numberSize })) : []
  const outer = (c: number, d: number) => (d === 0 ? c >= w * (h - 1) : d === 1 ? c % w === w - 1 : d === 2 ? c < w : c % w === 0)
  mz.walls((c, d) => (outer(c, d) ? GW_COLORS.edge : null))
  const wallMat = mat(GW_COLORS.wall, { rough: 0.6 })
  cells.forEach((k, c) => {
    const [x, y] = mz.centre(c)
    if (k === '#') box(parent, [cellM * 0.96, cellM * 0.96, 0.08], wallMat, [x, y, 0.04]).castShadow = false
    if (k === 'G') box(parent, [cellM * 0.3, cellM * 0.12, 0.06], mat('#3a3f48', { rough: 0.5 }), [x, y + cellM * 0.36, 0.03]).castShadow = false
  })
  const fixed = (c: number) => (cells[c] === 'G' ? GW_COLORS.goal : cells[c] === 'P' ? GW_COLORS.pit : cells[c] === 'N' ? GW_COLORS.near : cells[c] === '#' ? null : undefined)
  const free = cells.map((_, c) => !isTerminal(world, c) && cells[c] !== '#')
  const arrowIm = instanced(parent, arrowGeometry(), w * h)
  const wedgeIm = instanced(parent, wedgeGeometry(), 4 * w * h)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const zAxis = new THREE.Vector3(0, 0, 1)
  const pos = new THREE.Vector3()
  const sc = new THREE.Vector3()
  const col = new THREE.Color()
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
  const place = (im: THREE.InstancedMesh, i: number, c: number, th: number, z: number, color: string | null, k = 1, dy = 0) => {
    const [x, y] = mz.centre(c)
    im.setMatrixAt(i, color === null ? hidden : m4.compose(pos.set(x, y + dy, z), q.setFromAxisAngle(zAxis, th), sc.set(cellM * k, cellM * k, 1)))
    im.setColorAt(i, col.set(color ?? '#000000'))
  }
  const done = (im: THREE.InstancedMesh) => {
    im.instanceMatrix.needsUpdate = true
    im.instanceColor!.needsUpdate = true
  }
  const bot = diffBot(parent)
  arrowIm.count = wedgeIm.count = 0
  return {
    centre: mz.centre,
    free,
    tiles(colorOf: (c: number) => string | null) {
      mz.tiles((c) => {
        const f = fixed(c)
        return f === undefined ? colorOf(c) : f
      })
    },
    /** Needs `numberSize` > 0: text under each cell's arrow. */
    numbers(textOf: (c: number) => string, colorOf: (c: number) => string) {
      nums.forEach((l, c) => l.set(cells[c] === '#' ? '' : textOf(c), colorOf(c)))
    },
    arrows(dirOf: (c: number) => number | null, colorOf: (c: number) => string = () => GW_COLORS.arrow) {
      arrowIm.count = w * h
      for (let c = 0; c < w * h; c++) {
        const d = free[c] ? dirOf(c) : null
        place(arrowIm, c, c, d === null ? 0 : DIR_TH[d], 0.012, d === null ? null : colorOf(c), arrowK, arrowDy)
      }
      done(arrowIm)
    },
    wedges(colorOf: ((c: number, a: number) => string | null) | null) {
      wedgeIm.count = 4 * w * h
      for (let c = 0; c < w * h; c++) for (let a = 0; a < 4; a++) place(wedgeIm, 4 * c + a, c, DIR_TH[a], 0.006, colorOf && free[c] ? colorOf(c, a) : null)
      done(wedgeIm)
    },
    /** Robot after `k` steps of `log`: faces the chosen action, slides along the move it made (a skid goes sideways); drops into a pit. */
    drive(log: readonly GwStepLog[], k: number) {
      const i = Math.min(log.length - 1, Math.floor(k))
      if (i < 0) {
        const [x, y] = mz.centre(world.start)
        bot.set({ x, y, th: DIR_TH[0] })
        bot.group.position.z = 0
        return
      }
      const e = log[i]
      const u = Math.min(1, k - i)
      const [ax, ay] = mz.centre(e.s)
      const [bx, by] = mz.centre(e.s2)
      const stuck = e.s === e.s2
      const bump = stuck ? Math.sin(Math.PI * u) * 0.25 * cellM : 0
      const mx = Math.cos(DIR_TH[e.moved])
      const my = Math.sin(DIR_TH[e.moved])
      bot.set({ x: ax + (bx - ax) * u + mx * bump, y: ay + (by - ay) * u + my * bump, th: DIR_TH[e.a] })
      bot.group.position.z = cells[e.s2] === 'P' ? -0.25 * Math.max(0, u - 0.5) * 2 : 0
    },
    bot,
  }
}

const TINT = [new THREE.Color('#5a2328'), new THREE.Color('#2a2d34'), new THREE.Color('#1f6a45')]
const tint = new THREE.Color()
/** f in −1 … 1: red (bad) → grey → green (good), dim enough for arrows on top. */
export function valueTint(f: number) {
  const u = Math.max(-1, Math.min(1, f))
  return '#' + tint.copy(TINT[1]).lerp(TINT[u < 0 ? 0 : 2], Math.abs(u)).getHexString()
}
