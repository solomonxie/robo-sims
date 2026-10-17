import * as THREE from 'three/webgpu'
import {
  JointType,
  LOOP,
  Mat4,
  ODOM_ERR,
  P3,
  POST,
  Pose,
  ROVER,
  ROVER_URDF,
  UrdfJoint,
  apply4,
  compose2,
  jointValue,
  linkFrames,
  loopLength,
  loopPose,
  poseTf,
  tfChain,
  toDeg,
  urdfTree,
  wrapPi,
} from '../../core/physics'
import { V3, add, box, cylinder, mat, tube } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  AXIS_RGB,
  B_FIELD,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  arrow,
  flatBox,
  frameTriad,
  glide,
  glowMat,
  liveLabel,
  moduleBlock,
  pointArrow,
  presence,
  rodBetween,
  setTf,
  storyClock,
  storySlider,
  stretchRod,
  addRod,
  urdfModel,
  zUp,
} from '../fx'
import { Lesson, Stage, n, opts, pick } from '../types'
import { cmWhole } from '../../core/units'

const AXES_LEGEND = { color: AXIS_RGB[0], label: 'Axes: x red, y green, z blue', shape: 'dot' } as const
const MAP_C = '#e8e8e8'
const xyz = (p: P3) => `(${p.map((v) => v.toFixed(2)).join(', ')})`
const poseText = (p: Pose) => `x ${p.x.toFixed(2)}, y ${p.y.toFixed(2)}, θ ${Math.round(toDeg(p.th))}°`

/** Rover materials by link name. */
const roverLook = (link: string) =>
  link.includes('wheel')
    ? mat('#1c1c1f', { rough: 0.8 })
    : link === 'lidar_link'
      ? mat('#2a2c32', { rough: 0.35 })
      : link === 'camera_link'
        ? mat('#3a3d45', { rough: 0.4 })
        : link === 'arm_link'
          ? mat('#f2c230', { rough: 0.5 })
          : mat('#d8dbe2', { rough: 0.55 })

// --- Frame tree: map → odom → base_link → sensor and wheel links; a lidar hit chained into map. ---

const FT_K = 5.8
const ROBOT_X = 2.2
const FLOOR_Y = 1.1
const WHEEL_R = 0.033
const CHAIN = ['lidar_link', 'base_link', 'odom', 'map'] as const
const CHAIN_C = [RING, B_FIELD, HEAT, MAP_C]
const CHAIN_S = [1.6, 1.6, 1.6, 2.6]
const CORR = { on: 'SLAM corrects map → odom', off: 'Odometry only' }
const TREE_X = 9
const KID_COL = 17.5
const KIDS = urdfTree(ROVER).children.base_link
const NODE: V3 = [4.6, 1.4, 0.8]

/** Odometry-only estimate of base_link in map: the start pose composed with raw odometry. */
const odomOnly = (s: number) => compose2(LOOP.start, tfChain(s, true).odom)

export const frameTree: Lesson = {
  id: 'tf-urdf-frame-tree',
  title: 'Frame tree',
  tagline: 'Every part has its own axes; TF chains them',
  formula: (p) => {
    const s = n(p, 'dist')
    const on = pick(CORR, p.corr, 'on') === 'on'
    const c = tfChain(s, on)
    const est = odomOnly(s)
    const drift = Math.hypot(est.x - c.truth.x, est.y - c.truth.y)
    return `p_map = T(map←odom) · T(odom←base_link) · T(base_link←lidar_link) · p_lidar · after ${s} m odometry is ${cmWhole(drift)}, ${Math.round(Math.abs(toDeg(wrapPi(est.th - c.truth.th))))}° off · ${on ? 'SLAM moves map → odom to absorb the drift, so the point lands on the post' : `nobody updates map → odom: the point lands ${cmWhole(c.err)} from the post`}`
  },
  legend: [
    AXES_LEGEND,
    { color: RING, label: 'Lidar hit on the post', shape: 'dot' },
    { color: B_FIELD, label: 'base_link · odom orange · map white', shape: 'dot' },
    { color: HIGH_V, label: 'Odometry-only guess', shape: 'dot' },
  ],
  points: [
    'A robot is full of coordinate frames: the map, the robot body (base_link), each sensor (lidar_link, camera_link), each wheel. Each one is a set of x/y/z axes: in ROS x points forward, y left, z up (drawn red, green, blue).',
    'TF keeps them in one tree. Each edge is a transform: a translation plus a rotation from parent to child, published by whoever knows it. The fixed ones (where the lidar is bolted on) come from the URDF via robot_state_publisher; odom → base_link comes from wheel odometry; map → odom from SLAM or AMCL.',
    'The lidar measures the post in its own frame: a point a little ahead and to the left. To use it on the map, chain the transforms up the tree: lidar_link → base_link adds the mount offset, odom ← base_link applies where odometry says the robot is, map ← odom applies the correction. Each step is one 4×4 matrix times the point.',
    `Odometry is smooth but drifts: wheels ${Math.round(ODOM_ERR.scale * 100)} % bigger than it thinks, turns over-counted by ${Math.round(ODOM_ERR.turn * 100)} %. After a lap it is tens of cm and many degrees off. Switch to odometry only and the point lands off the post: the map would get a ghost obstacle.`,
    'With SLAM running, the robot keeps matching scans to the map and publishes map → odom so that map → base_link is right. That is why the odom frame slowly slides away from the map frame: the correction lives in that one edge, and base_link in odom never jumps.',
    'Ask TF instead of doing the maths: tf2 buffer.lookup_transform("map", "lidar_link", time) walks the tree for you; ros2 run tf2_tools view_frames draws it.',
  ],
  controls: [
    { kind: 'slider', key: 'dist', label: 'Driven', min: 0, max: 15, initial: 9, step: 1, format: (v) => `${v} m` },
    { kind: 'choice', key: 'corr', options: opts(CORR), initial: 'on' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const world = zUp(scene, [-8.8, 3.8, 0], FT_K, 0.72)
    const map = add(world, new THREE.Group(), [0, -FLOOR_Y, 0])
    box(map, [4.2, 3, 0.02], mat('#2a2d34', { rough: 0.9 }), [0, FLOOR_Y, -0.012]).castShadow = false
    const loop = Array.from({ length: 81 }, (_, i): V3 => {
      const q = loopPose((i / 80) * loopLength())
      return [q.x, q.y, 0.002]
    })
    tube(map, loop, 0.008, glowMat(GREY, 0.2), 120)
    cylinder(map, POST.r, 0.3, mat('#8a8f99', { rough: 0.6 }), [POST.x, POST.y, 0.15], 'z', 20)
    const mapTri = frameTriad(map, 0.42, 'map', MAP_C, 0.016)
    const odomTri = frameTriad(map, 0.34, 'odom', HEAT, 0.014)
    const robot = add(map, new THREE.Group())
    const body = add(robot, new THREE.Group(), [0, 0, WHEEL_R * ROBOT_X])
    body.scale.setScalar(ROBOT_X)
    const rover = urdfModel(body, ROVER, roverLook)
    for (const l of Object.values(rover.links)) if (l.collision) l.collision.visible = false
    const baseTri = frameTriad(body, 0.13, 'base_link', B_FIELD, 0.006)
    const kidTris = KIDS.map((k) => frameTriad(body, 0.07, k === 'lidar_link' ? 'lidar_link' : '', k === 'lidar_link' ? RING : GREY, 0.004))
    const ghost = add(map, new THREE.Group())
    const ghostMat = new THREE.MeshStandardMaterial({ color: HIGH_V, emissive: HIGH_V, emissiveIntensity: 0.5, transparent: true, opacity: 0.3, depthWrite: false })
    flatBox(ghost, [0.3 * ROBOT_X, 0.2 * ROBOT_X, 0.06 * ROBOT_X], ghostMat, [0, 0, WHEEL_R * ROBOT_X])
    frameTriad(ghost, 0.2, 'odom says', HIGH_V, 0.008)
    const beamMat = glowMat(RING, 1)
    const beam = addRod(map, beamMat)
    const hitDot = add(map, new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), glowMat(RING, 1.2)))
    const missDot = add(map, new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), glowMat(HIGH_V, 1.2)))
    const vecMat = glowMat(RING, 1)
    const vec = addRod(map, vecMat)

    const nodes: Record<string, ReturnType<typeof moduleBlock>> = {}
    const at: Record<string, V3> = { map: [TREE_X, 10, 0], odom: [TREE_X, 6.6, 0], base_link: [TREE_X, 3.2, 0] }
    KIDS.forEach((k, i) => (at[k] = [KID_COL, 6.4 - i * 1.7, 0]))
    for (const [k, v] of Object.entries(at)) nodes[k] = moduleBlock(scene, v, NODE, k)
    const edgeM = glowMat(GREY, 0.3)
    const down = (a: V3, b: V3) => {
      const mid = (a[1] + b[1]) / 2
      rodBetween(scene, [a[0], a[1] - NODE[1] / 2, -0.2], [a[0], mid, -0.2], edgeM, 0.08)
      rodBetween(scene, [a[0], mid, -0.2], [b[0], mid, -0.2], edgeM, 0.08)
      rodBetween(scene, [b[0], mid, -0.2], [b[0], b[1] + NODE[1] / 2, -0.2], edgeM, 0.08)
    }
    const right = (a: V3, b: V3) => {
      const x = (a[0] + b[0]) / 2
      rodBetween(scene, [a[0] + NODE[0] / 2, a[1], -0.2], [x, a[1], -0.2], edgeM, 0.08)
      rodBetween(scene, [x, a[1], -0.2], [x, b[1], -0.2], edgeM, 0.08)
      rodBetween(scene, [x, b[1], -0.2], [b[0] - NODE[0] / 2, b[1], -0.2], edgeM, 0.08)
    }
    down(at.map, at.odom)
    down(at.odom, at.base_link)
    KIDS.forEach((k) => right(at.base_link, at[k]))
    const mapEdge = liveLabel(scene, [TREE_X - 0.5, 8.3, 0.3], { size: 0.4, align: 'right' })
    addLabel(scene, 'wheel odometry', [TREE_X - 0.5, 4.9, 0.3], HEAT, 0.4, 'right')
    addLabel(scene, 'static, from the URDF', [KID_COL, 8, 0.3], GREY, 0.4)

    const lines = CHAIN.map((_, i) => liveLabel(scene, [-22.5, -5.6 - i * 1.45, 0.3], { size: 0.56, align: 'left' }))
    const clock = storyClock(CHAIN_S)
    const st = { s: -1, spin: 0 }
    return {
      scene,
      view: { center: [0, 1.6, 0], radius: 76, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const target = n(p, 'dist')
        const on = pick(CORR, p.corr, 'on') === 'on'
        if (st.s < 0) st.s = target
        const step = Math.sign(target - st.s) * Math.min(Math.abs(target - st.s), dt * Math.max(1.5, Math.abs(target - st.s) * 1.5))
        st.s += step
        st.spin += step / WHEEL_R
        const c = tfChain(st.s, on)
        setTf(robot, poseTf(c.truth))
        rover.pose({ left_wheel_joint: st.spin, right_wheel_joint: st.spin, arm_joint: 0.5 })
        const f = linkFrames(ROVER, { left_wheel_joint: st.spin, right_wheel_joint: st.spin, arm_joint: 0.5 })
        KIDS.forEach((k, i) => setTf(kidTris[i].group, f[k]))
        setTf(odomTri.group, poseTf(c.mapOdom))
        const est = compose2(c.mapOdom, c.odom)
        ghost.visible = !on && Math.hypot(est.x - c.truth.x, est.y - c.truth.y) > 0.01
        setTf(ghost, poseTf(est))

        const toMap = (m: Mat4, local: P3) => apply4(m, local.map((v, i) => (i === 2 ? (v + WHEEL_R) * ROBOT_X : v * ROBOT_X)) as P3)
        const lidarAt = toMap(poseTf(c.truth), [c.baseLidar[3], c.baseLidar[7], c.baseLidar[11]])
        const hitAt: P3 = [c.hit[0], c.hit[1], lidarAt[2]]
        stretchRod(beam, lidarAt, hitAt, 0.008)
        hitDot.position.set(...hitAt)
        const missAt: P3 = [c.p[3][0], c.p[3][1], lidarAt[2]]
        missDot.visible = c.err > 0.01
        missDot.position.set(...missAt)

        clock.frame(dt, 0)
        const k = clock.step
        const origin: P3[] = [lidarAt, toMap(poseTf(c.truth), [0, 0, 0]), [c.mapOdom.x, c.mapOdom.y, 0], [0, 0, 0]]
        const end = k === 3 ? missAt : hitAt
        stretchRod(vec, origin[k], end, 0.018)
        vecMat.color.set(CHAIN_C[k])
        vecMat.emissive.set(CHAIN_C[k])
        const lit = (name: string) => CHAIN.indexOf(name as (typeof CHAIN)[number])
        for (const [name, node] of Object.entries(nodes)) {
          const i = lit(name)
          node(dt, i >= 0 ? CHAIN_C[i] : GREY, i < 0 ? 0.15 : i === k ? 1 : i < k ? 0.45 : 0.15)
        }
        mapEdge.set(on ? 'SLAM' : 'frozen (no SLAM)', on ? MAP_C : HIGH_V)
        mapTri.label.set('map', MAP_C)
        baseTri.label.set('base_link', B_FIELD)
        const odomP = c.odom
        const text = [
          `lidar_link   p = ${xyz(c.p[0])}   measured by the lidar`,
          `base_link   = lidar_joint (0.05, 0, 0.07) · p = ${xyz(c.p[1])}`,
          `odom   = odometry (${poseText(odomP)}) · p = ${xyz(c.p[2])}`,
          `map   = map→odom (${poseText(c.mapOdom)}) · p = ${xyz(c.p[3])}${c.err > 0.01 ? `   ${cmWhole(c.err)} off the post` : '   on the post'}`,
        ]
        lines.forEach((l, i) => l.set(text[i], i === 3 && c.err > 0.01 && k === 3 ? HIGH_V : i <= k ? CHAIN_C[i] : GREY))
      },
      readouts: (p) => {
        const s = n(p, 'dist')
        const on = pick(CORR, p.corr, 'on') === 'on'
        const c = tfChain(s, on)
        const est = odomOnly(s)
        const drift = Math.hypot(est.x - c.truth.x, est.y - c.truth.y)
        return [
          { label: 'Odometry drift', value: `${cmWhole(drift)} · ${Math.round(Math.abs(toDeg(wrapPi(est.th - c.truth.th))))}°`, tone: drift < 0.05 ? 'ok' : drift < 0.2 ? 'warn' : 'bad' },
          { label: 'map → odom', value: `${c.mapOdom.x.toFixed(2)}, ${c.mapOdom.y.toFixed(2)} · ${Math.round(toDeg(c.mapOdom.th))}°` },
          { label: 'Point error', value: cmWhole(c.err), tone: c.err < 0.02 ? 'ok' : c.err < 0.1 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}

// --- Writing a URDF: the rover built element by element as its XML is read. ---

const URDF_LINES = ROVER_URDF.split('\n')
const link = (name: string) => ROVER.links.find((l) => l.name === name)!
const joint = (name: string) => ROVER.joints.find((j) => j.name === name)!
const STEP_LINES: [number, number][] = [
  [0, link('base_link').visual!.line],
  [link('base_link').collision!.line, link('base_link').end],
  [link('left_wheel').line, joint('left_wheel_joint').end],
  [link('right_wheel').line, joint('right_wheel_joint').end],
  [link('lidar_link').line, joint('lidar_joint').end],
  [link('camera_link').line, joint('camera_joint').end],
  [link('arm_link').line, URDF_LINES.length - 1],
]
const STEPS = ['base_link visual', 'Collision box', 'Left wheel · continuous', 'Right wheel', 'Lidar · fixed', 'Camera · fixed', 'Arm · revolute']
const STEP_S = [4, 3.2, 5, 4.2, 4.2, 4.2, 5.4]
const WINDOW = 10
const JOINT_C: Record<JointType, string> = { fixed: GREY, continuous: POWER, revolute: FORCE, prismatic: B_FIELD }
const UR_K = 36
const UR_TREE = urdfTree(ROVER)
const UR_KIDS = UR_TREE.children.base_link

const explain = (l: string) => {
  const t = l.trim()
  const type = /type="(\w+)"/.exec(t)?.[1]
  if (t.startsWith('<robot')) return 'robot: one file, every link and joint of the machine'
  if (t.startsWith('<link')) return 'link: a rigid part with its own frame'
  if (t.startsWith('<visual')) return 'visual: the shape RViz draws, in the link frame'
  if (t.startsWith('<collision')) return 'collision: a simpler hull for physics and planners'
  if (t.startsWith('<joint'))
    return type === 'fixed' ? 'fixed joint: bolted on, never moves' : type === 'continuous' ? 'continuous joint: spins forever (wheels)' : 'revolute joint: turns between limits'
  if (t.startsWith('<parent')) return 'parent → child: one parent per link, so links form a tree'
  if (t.startsWith('<origin')) return 'origin: child frame = parent frame moved by xyz (m), turned by rpy (rad)'
  if (t.startsWith('<limit')) return 'limit: lower..upper rad, max effort N·m, max speed rad/s'
  if (t.startsWith('</robot')) return '$ ros2 launch: robot_state_publisher reads it and publishes TF'
  return ''
}

export const writingAUrdf: Lesson = {
  id: 'tf-urdf-writing-a-urdf',
  title: 'Writing a URDF',
  tagline: 'Links and joints in XML become the robot model',
  formula: (p) => {
    const arm = joint('arm_joint')
    const q = n(p, 'arm') * (Math.PI / 180)
    const v = jointValue(arm, q)
    return `link = rigid body (visual + collision) · joint = parent → child at origin xyz/rpy, moving about axis · ${ROVER.links.length} links, ${ROVER.joints.length} joints, ${ROVER.joints.filter((j) => j.type !== 'fixed').length} move · arm_joint asked ${Math.round(n(p, 'arm'))}°, limit ${arm.limit![0]}..${arm.limit![1]} rad → ${Math.round(toDeg(v))}°`
  },
  legend: [
    { color: RING, label: 'Line being read · its part pops in', shape: 'dot' },
    { color: HEAT, label: 'Collision hull (translucent)', shape: 'dot' },
    { color: POWER, label: 'Joint axis: continuous green, revolute pink', shape: 'arrow-right' },
    AXES_LEGEND,
  ],
  points: [
    'A URDF (Unified Robot Description Format) is an XML file that describes the robot as links and joints. ROS reads it once: robot_state_publisher turns it into the static and moving TF frames, RViz draws it, Gazebo and MoveIt use it for physics and planning.',
    'A <link> is one rigid part. Its <visual> is what you see (a box, cylinder, sphere or mesh), its <collision> a simpler hull that physics engines and planners check; they can differ, and a link without collision is invisible to them.',
    'A <joint> connects a parent link to a child link. Its <origin xyz rpy> says where the child frame sits in the parent frame (metres, and roll-pitch-yaw in radians). Until the origin is given, the wheel sits in the middle of the body; the origin moves it out to the side.',
    'The joint type says how it may move: fixed (lidar, camera: bolted on), continuous (wheels: spin without limit), revolute (the arm: turns about <axis> between <limit> lower and upper), prismatic (slides). Here the wheels are turned −90° about x so their cylinders lie sideways and spin about their own z.',
    'Every link has exactly one parent, so the joints form a tree rooted at base_link. Moving a joint moves its whole subtree. Try asking the arm for more than its 1.2 rad limit: the joint stops there.',
    'In practice the file is written as xacro (XML with macros), so both wheels come from one macro with a side parameter. Check it with check_urdf, view it with ros2 launch urdf_tutorial display.launch.py.',
  ],
  controls: [storySlider(STEPS), { kind: 'slider', key: 'arm', label: 'arm_joint', min: -30, max: 100, initial: 60, step: 10, format: (v) => `${v}°` }],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const bar = flatBox(scene, [27, 1, 0.1], new THREE.MeshStandardMaterial({ color: RING, emissive: RING, emissiveIntensity: 0.4, transparent: true, opacity: 0.18, depthWrite: false }), [0, 0, -0.3])
    const rows = Array.from({ length: WINDOW }, (_, i) => liveLabel(scene, [-23.5, 10.4 - i * 1.12, 0.3], { size: 0.44, align: 'left', glow: 0.7 }))
    const g = zUp(scene, [12.6, 3, 0], UR_K, 0.42, Math.PI - 0.6)
    const rover = urdfModel(g, ROVER, roverLook)
    const tris = Object.fromEntries(ROVER.links.map((l) => [l.name, frameTriad(g, l.name === 'base_link' ? 0.22 : 0.06, '', GREY, 0.003)]))
    const axes = Object.fromEntries(ROVER.joints.filter((j) => j.type !== 'fixed').map((j) => [j.name, arrow(g, [0, 0, 0], [0, 0, 1], JOINT_C[j.type], 0.022)]))

    const treeAt: Record<string, V3> = { base_link: [0, -4.6, 0] }
    UR_KIDS.forEach((k, i) => (treeAt[k] = [(i - 2) * 8.6, -9.4, 0]))
    const tnode: V3 = [7.2, 1.4, 0.8]
    const tree = Object.fromEntries(Object.entries(treeAt).map(([k, v]) => [k, { g: add(scene, new THREE.Group()), at: v }]))
    const blocks = Object.fromEntries(Object.entries(tree).map(([k, t]) => [k, moduleBlock(t.g, t.at, tnode, k)]))
    const edges = Object.fromEntries(
      UR_KIDS.map((k) => {
        const e = add(scene, new THREE.Group())
        const a = treeAt.base_link
        const b = treeAt[k]
        const m = glowMat(JOINT_C[UR_TREE.jointOf[k].type], 0.5)
        const mid = (a[1] + b[1]) / 2 + 0.6
        rodBetween(e, [a[0], a[1] - 0.75, -0.2], [a[0], mid, -0.2], m, 0.09)
        rodBetween(e, [a[0], mid, -0.2], [b[0], mid, -0.2], m, 0.09)
        rodBetween(e, [b[0], mid, -0.2], [b[0], b[1] + 0.75, -0.2], m, 0.09)
        const j = UR_TREE.jointOf[k]
        addLabel(e, j.type, [b[0] + 0.3, b[1] + 1.3, 0.3], JOINT_C[j.type], 0.4, 'left')
        return [k, e]
      }),
    )
    const status = liveLabel(scene, [-23.5, -12.4, 0.3], { size: 0.5, align: 'left' })

    const clock = storyClock(STEP_S)
    const shown: Record<string, number> = {}
    const st = { arm: 0, spin: 0 }
    const fade = (key: string, on: boolean, dt: number) => (shown[key] = on ? glide(dt, shown[key] ?? 0, 1, 8) : 0)
    return {
      scene,
      view: { center: [0, 0.6, 0], radius: 78, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        clock.frame(dt, n(p, 'step'))
        const k = clock.step
        const [a, b] = STEP_LINES[k]
        const cur = Math.min(b, a + Math.floor(Math.min(1, clock.t / 0.72) * (b - a + 1)))
        const read = (line: number) => line < STEP_LINES[k][0] || line <= cur
        const top = Math.max(0, Math.min(URDF_LINES.length - WINDOW, cur - 5))
        rows.forEach((r, i) => {
          const l = top + i
          const t = URDF_LINES[l] ?? ''
          const done = read(l)
          r.set(t, l === cur ? RING : !done ? '#4a4e57' : t.trim().startsWith('<joint') || t.includes('<parent') || t.includes('<axis') || t.includes('<limit') || t.trim() === '</joint>' ? FORCE : B_FIELD)
        })
        bar.position.set(-23.5 + 13.3, 10.4 - (cur - top) * 1.12 + 0.22, 0)

        const jointOn = (j: UrdfJoint) => fade(j.name, read(j.line + 2), dt)
        const placed = { ...ROVER, joints: ROVER.joints.map((j) => ({ ...j, xyz: j.xyz.map((v) => v * jointOn(j)) as P3, rpy: j.rpy.map((v) => v * shown[j.name]) as P3 })) }
        st.spin += dt * 2.4
        st.arm = glide(dt, st.arm, n(p, 'arm') * (Math.PI / 180), 4)
        const q = {
          left_wheel_joint: read(joint('left_wheel_joint').end) ? st.spin : 0,
          right_wheel_joint: read(joint('right_wheel_joint').end) ? st.spin : 0,
          arm_joint: read(joint('arm_joint').end) ? st.arm : 0,
        }
        const f = linkFrames(placed, q)
        for (const l of ROVER.links) {
          const parts = rover.links[l.name]
          setTf(parts.g, f[l.name])
          if (parts.visual) presence(parts.visual, fade(`${l.name}.v`, read(l.visual!.line), dt))
          if (parts.collision) presence(parts.collision, fade(`${l.name}.c`, read(l.collision!.line), dt))
          const tri = tris[l.name]
          setTf(tri.group, f[l.name])
          const j = UR_TREE.jointOf[l.name]
          presence(tri.group, l.name === 'base_link' ? fade('base.t', read(l.line), dt) : shown[j.name])
          presence(tree[l.name].g, fade(`${l.name}.n`, read(l.line), dt))
          blocks[l.name](dt, j ? JOINT_C[j.type] : B_FIELD, k === STEP_LINES.findIndex(([s, e]) => l.line >= s && l.line <= e) ? 1 : 0.3)
          if (j) presence(edges[l.name], fade(`${j.name}.e`, read(j.line), dt))
        }
        for (const j of ROVER.joints.filter((jj) => jj.type !== 'fixed')) {
          const ar = axes[j.name]
          const m = f[j.child]
          const axisLine = j.line + 2
          presence(ar, fade(`${j.name}.a`, read(axisLine), dt))
          const o = apply4(m, [0, 0, 0])
          const d = apply4(m, j.axis).map((v, i) => v - o[i]) as V3
          const lift = j.type === 'continuous' ? 0.03 : 0.02
          ar.position.set(o[0] + d[0] * lift, o[1] + d[1] * lift, o[2] + d[2] * lift)
          pointArrow(ar, d)
        }
        const arm = joint('arm_joint')
        const v = jointValue(arm, n(p, 'arm') * (Math.PI / 180))
        const clamped = Math.abs(v - n(p, 'arm') * (Math.PI / 180)) > 1e-6
        const said = URDF_LINES.slice(0, cur + 1).map(explain)
        const tip = said.filter(Boolean).pop() ?? ''
        const at = said.lastIndexOf(tip)
        status.set(
          k === 6 && read(arm.end) && clamped ? `arm_joint asked ${n(p, 'arm')}°: held at its limit, ${Math.round(toDeg(v))}°` : `line ${at + 1}: ${tip}`,
          k === 6 && read(arm.end) && clamped ? HIGH_V : LABEL,
        )
      },
      readouts: (p) => {
        const arm = joint('arm_joint')
        const want = n(p, 'arm') * (Math.PI / 180)
        const v = jointValue(arm, want)
        return [
          { label: 'Links', value: `${ROVER.links.length}` },
          { label: 'Joints · moving', value: `${ROVER.joints.length} · ${ROVER.joints.filter((j) => j.type !== 'fixed').length}` },
          { label: 'arm_joint', value: `${Math.round(toDeg(v))}°`, tone: Math.abs(v - want) > 1e-6 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

