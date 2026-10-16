// Frame tree: each frame stores its pose in its parent; lookups walk up to the common ancestor and back down.
import { DEG } from '../common'
import { Mat4, IDENTITY4, invert4, mul4, tf3 } from '../software/urdf'

export type FrameTree = Record<string, { parent: string | null; tf: Mat4 }>

/** `name`, its parent, … up to the root. */
export function rootPath(tree: FrameTree, name: string): string[] {
  const out = [name]
  for (let p = tree[name].parent; p !== null; p = tree[p].parent) out.push(p)
  return out
}

/** Pose of `name` in the root frame. */
export const frameWorld = (tree: FrameTree, name: string): Mat4 => rootPath(tree, name).reduce((m, f) => mul4(tree[f].tf, m), IDENTITY4)

/** Frames from `from` up to the common ancestor (`up`, both ends included) and on down to `to` (`down`, ancestor excluded). */
export function framePath(tree: FrameTree, from: string, to: string) {
  const a = rootPath(tree, from)
  const b = rootPath(tree, to)
  const common = a.find((f) => b.includes(f))!
  return { up: a.slice(0, a.indexOf(common) + 1), down: b.slice(0, b.indexOf(common)).reverse(), common }
}

/** T(target ← source): multiplies source coordinates into target coordinates, hop by hop along `framePath`. */
export function frameLookup(tree: FrameTree, target: string, source: string): Mat4 {
  const { up, down } = framePath(tree, source, target)
  let m = IDENTITY4
  for (const f of up.slice(0, -1)) m = mul4(tree[f].tf, m)
  for (const f of down) m = mul4(invert4(tree[f].tf), m)
  return m
}

/** Desk scene: an arm on a pedestal (yaw turret, pitching boom, camera at its tip looking down) beside a table with a cup. Metres, z up. */
export const DESK = { pedestal: 0.3, turret: 0.06, shoulder: 0.07, boom: 0.36, camPitch: 40 * DEG, table: { x: 0.6, y: -0.05, z: 0.32, yaw: 20 * DEG, w: 0.5, d: 0.4 }, cup: { x: 0.04, y: 0.1, r: 0.035, h: 0.09 } }

export function deskTree(yaw: number, lift: number): FrameTree {
  const { table: t, cup } = DESK
  return {
    world: { parent: null, tf: IDENTITY4 },
    table: { parent: 'world', tf: tf3([t.x, t.y, t.z], [0, 0, t.yaw]) },
    cup: { parent: 'table', tf: tf3([cup.x, cup.y, 0]) },
    base: { parent: 'world', tf: tf3([0, 0, DESK.pedestal]) },
    turret: { parent: 'base', tf: tf3([0, 0, DESK.turret], [0, 0, yaw]) },
    boom: { parent: 'turret', tf: tf3([0, 0, DESK.shoulder], [0, -lift, 0]) },
    camera: { parent: 'boom', tf: tf3([DESK.boom, 0, 0], [0, DESK.camPitch, 0]) },
  }
}
