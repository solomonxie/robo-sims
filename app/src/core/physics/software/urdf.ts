// URDF: a tiny XML reader, the link/joint tree, and link poses for given joint values (4×4 homogeneous transforms).
import { P3 } from '../room'

/** Row-major 4×4 homogeneous transform. */
export type Mat4 = number[]

export const IDENTITY4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

export function mul4(a: Mat4, b: Mat4): Mat4 {
  const m = new Array<number>(16).fill(0)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) m[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c]
  return m
}

export const apply4 = (m: Mat4, p: P3): P3 => [0, 1, 2].map((r) => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3]) as P3

/** Rotation from URDF `rpy` (fixed axes: roll about x, then pitch about y, then yaw about z) plus translation `xyz`. */
export function tf3(xyz: P3, rpy: P3 = [0, 0, 0]): Mat4 {
  const [cr, sr, cp, sp, cy, sy] = rpy.flatMap((a) => [Math.cos(a), Math.sin(a)])
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, xyz[0],
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, xyz[1],
    -sp, cp * sr, cp * cr, xyz[2],
    0, 0, 0, 1,
  ]
}

/** Inverse of a rigid transform: Rᵀ, −Rᵀt. */
export function invert4(m: Mat4): Mat4 {
  const out = [...IDENTITY4]
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[r * 4 + c] = m[c * 4 + r]
    out[r * 4 + 3] = -(m[r] * m[3] + m[4 + r] * m[7] + m[8 + r] * m[11])
  }
  return out
}

/** Rotation by `q` rad about unit `axis` (Rodrigues). */
export function rotAxis4(axis: P3, q: number): Mat4 {
  const l = Math.hypot(...axis) || 1
  const [x, y, z] = axis.map((v) => v / l)
  const c = Math.cos(q)
  const s = Math.sin(q)
  const t = 1 - c
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0, t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0, t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0, 0, 0, 0, 1]
}

interface XmlEl {
  tag: string
  attrs: Record<string, string>
  kids: XmlEl[]
  /** 0-based lines of the opening and closing tag. */
  line: number
  end: number
}

function parseXml(xml: string): XmlEl {
  const root: XmlEl = { tag: '', attrs: {}, kids: [], line: 0, end: 0 }
  const stack = [root]
  const lineAt = (i: number) => xml.slice(0, i).split('\n').length - 1
  for (const m of xml.matchAll(/<(\/?)([\w:]+)((?:\s+[\w:]+="[^"]*")*)\s*(\/?)>/g)) {
    const line = lineAt(m.index!)
    const top = stack[stack.length - 1]
    if (m[1]) {
      if (top.tag !== m[2]) throw new Error(`</${m[2]}> closes <${top.tag}>`)
      top.end = line
      stack.pop()
      continue
    }
    const el: XmlEl = { tag: m[2], attrs: Object.fromEntries([...m[3].matchAll(/([\w:]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])), kids: [], line, end: line }
    top.kids.push(el)
    if (!m[4]) stack.push(el)
  }
  if (stack.length > 1) throw new Error(`<${stack[stack.length - 1].tag}> not closed`)
  return root
}

export type UrdfGeom = { kind: 'box'; size: P3 } | { kind: 'cylinder'; radius: number; length: number } | { kind: 'sphere'; radius: number }
export interface UrdfShape {
  geom: UrdfGeom
  xyz: P3
  rpy: P3
  line: number
}
export interface UrdfLink {
  name: string
  visual?: UrdfShape
  collision?: UrdfShape
  line: number
  end: number
}
export type JointType = 'fixed' | 'continuous' | 'revolute' | 'prismatic'
export interface UrdfJoint {
  name: string
  type: JointType
  parent: string
  child: string
  xyz: P3
  rpy: P3
  axis: P3
  limit?: [number, number]
  line: number
  end: number
}
export interface UrdfModel {
  name: string
  links: UrdfLink[]
  joints: UrdfJoint[]
}

const nums = (s: string | undefined, d: P3): P3 => (s ? (s.trim().split(/\s+/).map(Number) as P3) : d)
const kid = (e: XmlEl, tag: string) => e.kids.find((k) => k.tag === tag)

function origin(e: XmlEl) {
  const o = kid(e, 'origin')
  return { xyz: nums(o?.attrs.xyz, [0, 0, 0]), rpy: nums(o?.attrs.rpy, [0, 0, 0]) }
}

function shape(e: XmlEl | undefined): UrdfShape | undefined {
  const g = e && kid(e, 'geometry')?.kids[0]
  if (!e || !g) return undefined
  const geom: UrdfGeom =
    g.tag === 'box'
      ? { kind: 'box', size: nums(g.attrs.size, [0, 0, 0]) }
      : g.tag === 'cylinder'
        ? { kind: 'cylinder', radius: Number(g.attrs.radius), length: Number(g.attrs.length) }
        : { kind: 'sphere', radius: Number(g.attrs.radius) }
  return { geom, ...origin(e), line: e.line }
}

export function parseUrdf(xml: string): UrdfModel {
  const robot = kid(parseXml(xml), 'robot')
  if (!robot) throw new Error('no <robot>')
  const links = robot.kids
    .filter((e) => e.tag === 'link')
    .map((e): UrdfLink => ({ name: e.attrs.name, visual: shape(kid(e, 'visual')), collision: shape(kid(e, 'collision')), line: e.line, end: e.end }))
  const joints = robot.kids
    .filter((e) => e.tag === 'joint')
    .map((e): UrdfJoint => {
      const lim = kid(e, 'limit')
      return {
        name: e.attrs.name,
        type: e.attrs.type as JointType,
        parent: kid(e, 'parent')?.attrs.link ?? '',
        child: kid(e, 'child')?.attrs.link ?? '',
        ...origin(e),
        axis: nums(kid(e, 'axis')?.attrs.xyz, [1, 0, 0]),
        limit: lim ? [Number(lim.attrs.lower ?? 0), Number(lim.attrs.upper ?? 0)] : undefined,
        line: e.line,
        end: e.end,
      }
    })
  return { name: robot.attrs.name, links, joints }
}

/** Root link and children; throws unless the joints form one tree over the links. */
export function urdfTree(m: UrdfModel) {
  const names = new Set(m.links.map((l) => l.name))
  const children: Record<string, string[]> = Object.fromEntries(m.links.map((l) => [l.name, []]))
  const jointOf: Record<string, UrdfJoint> = {}
  for (const j of m.joints) {
    if (!names.has(j.parent) || !names.has(j.child)) throw new Error(`${j.name}: unknown link`)
    if (jointOf[j.child]) throw new Error(`${j.child} has two parents`)
    jointOf[j.child] = j
    children[j.parent].push(j.child)
  }
  const roots = m.links.filter((l) => !jointOf[l.name])
  if (roots.length !== 1) throw new Error(`${roots.length} root links`)
  return { root: roots[0].name, children, jointOf }
}

/** Joint value after limits: revolute/prismatic clamp, continuous wraps freely, fixed is 0. */
export const jointValue = (j: UrdfJoint, q: number) =>
  j.type === 'fixed' ? 0 : j.limit && j.type !== 'continuous' ? Math.min(j.limit[1], Math.max(j.limit[0], q)) : q

/** Child-from-parent transform: origin, then the joint motion about/along `axis`. */
export function jointTf(j: UrdfJoint, q: number): Mat4 {
  const v = jointValue(j, q)
  const motion = j.type === 'prismatic' ? tf3(j.axis.map((a) => a * v) as P3) : j.type === 'fixed' ? IDENTITY4 : rotAxis4(j.axis, v)
  return mul4(tf3(j.xyz, j.rpy), motion)
}

/** Every link's pose in the root frame for joint values `q` (by joint name, default 0). */
export function linkFrames(m: UrdfModel, q: Record<string, number> = {}): Record<string, Mat4> {
  const { root, children, jointOf } = urdfTree(m)
  const out: Record<string, Mat4> = { [root]: IDENTITY4 }
  const walk = (name: string) =>
    children[name].forEach((c) => {
      out[c] = mul4(out[name], jointTf(jointOf[c], q[jointOf[c].name] ?? 0))
      walk(c)
    })
  walk(root)
  return out
}

/** Small two-wheel rover with a lidar, a camera and a one-joint arm. */
export const ROVER_URDF = `<robot name="rover">
  <link name="base_link">
    <visual><geometry><box size="0.3 0.2 0.06"/></geometry></visual>
    <collision><geometry><box size="0.34 0.24 0.08"/></geometry></collision>
  </link>
  <link name="left_wheel">
    <visual><geometry><cylinder radius="0.033" length="0.026"/></geometry></visual>
  </link>
  <joint name="left_wheel_joint" type="continuous">
    <parent link="base_link"/><child link="left_wheel"/>
    <origin xyz="0 0.12 0" rpy="-1.5708 0 0"/><axis xyz="0 0 1"/>
  </joint>
  <link name="right_wheel">
    <visual><geometry><cylinder radius="0.033" length="0.026"/></geometry></visual>
  </link>
  <joint name="right_wheel_joint" type="continuous">
    <parent link="base_link"/><child link="right_wheel"/>
    <origin xyz="0 -0.12 0" rpy="-1.5708 0 0"/><axis xyz="0 0 1"/>
  </joint>
  <link name="lidar_link">
    <visual><geometry><cylinder radius="0.035" length="0.04"/></geometry></visual>
  </link>
  <joint name="lidar_joint" type="fixed">
    <parent link="base_link"/><child link="lidar_link"/>
    <origin xyz="0.05 0 0.07"/>
  </joint>
  <link name="camera_link">
    <visual><geometry><box size="0.02 0.06 0.03"/></geometry></visual>
  </link>
  <joint name="camera_joint" type="fixed">
    <parent link="base_link"/><child link="camera_link"/>
    <origin xyz="0.16 0 0.03"/>
  </joint>
  <link name="arm_link">
    <visual><origin xyz="0.07 0 0"/>
      <geometry><box size="0.14 0.025 0.025"/></geometry></visual>
  </link>
  <joint name="arm_joint" type="revolute">
    <parent link="base_link"/><child link="arm_link"/>
    <origin xyz="-0.1 0 0.045"/><axis xyz="0 -1 0"/>
    <limit lower="0" upper="1.2" effort="2" velocity="1"/>
  </joint>
</robot>`

export const ROVER = parseUrdf(ROVER_URDF)
