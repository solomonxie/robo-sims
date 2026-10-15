import * as THREE from 'three/webgpu'
import {
  BtFrame,
  CORRIDOR,
  INSCRIBED,
  NAV,
  NAV_CART,
  NAV_DROP,
  NAV_MAP,
  NAV_TREE,
  NavFrame,
  XY,
  btNavRun,
  costAt,
  costmapRun,
  maxLayers,
  pathLength,
  staticLayer,
  walledRoom,
} from '../../core/physics'
import { V3, add, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LETHAL_C,
  LABEL,
  POWER,
  RING,
  addLabel,
  btDiagram,
  btKindText,
  costField,
  floorView,
  glide,
  glowMat,
  lidarRobot,
  liveLabel,
  memoBy,
  pointCloud,
  presence,
  rayFan,
  rodBetween,
  roomModel,
  simClock,
} from '../fx'
import { Lesson, Stage, n, opts, pick } from '../types'

const segs = (p: XY[], z: (q: XY) => number): [V3, V3][] => p.slice(1).map((q, i) => [[p[i][0], p[i][1], z(p[i])], [q[0], q[1], z(q)]])

// --- Costmaps: static map + live obstacle layer + inflation; A* plans over the sum and re-plans when a box is dropped. ---

const DROP = { on: 'Box dropped at 3.5 s', off: 'Way stays clear' }
const BAR_H = 0.3
const STILL = staticLayer(NAV_MAP, NAV.res)
const ROOM_CART = { ...NAV_MAP, solids: [...NAV_MAP.solids, NAV_CART] }
const ROOM_DROP = { ...ROOM_CART, solids: [...ROOM_CART.solids, NAV_DROP] }
const cmRun = memoBy((p: { r: number; drop: boolean }) => `${p.r}|${p.drop}`, (p) => costmapRun(p.r, p.drop))
const cmParams = (p: Record<string, number | string>) => ({ r: n(p, 'radius'), drop: pick(DROP, p.drop, 'on') === 'on' })
const THUMBS = [
  { name: 'static layer (saved map)', color: LABEL },
  { name: 'obstacle layer (live lidar)', color: HEAT },
  { name: 'inflation layer', color: HIGH_V },
]
const MAIN = { at: [-21.4, -6.6, 0] as V3, k: 3.9 }
const TH = { x: 6.8, y: [2.6, -4.2, -11], k: 1.25 }

export const costmaps: Lesson = {
  id: 'nav2-costmaps',
  title: 'Costmaps',
  tagline: 'Layers of cost the planner steers through',
  formula: (p) => {
    const { r } = cmParams(p)
    return `master = max(static, obstacle, inflation) per ${NAV.res * 100} cm cell · 254 on an obstacle, 253 within the robot radius ${NAV.inscribed} m, then 252·e^(−${NAV.k}·(d − ${NAV.inscribed})) out to ${r.toFixed(2)} m · A* step cost = length × (50 + 0.8 × cost), so the path keeps to low cost`
  },
  legend: [
    { color: LETHAL_C, label: 'Lethal 254 · cyan: inscribed 253', shape: 'dot' },
    { color: HIGH_V, label: 'Inflation: red high → blue low', shape: 'dot' },
    { color: RING, label: 'Planned path (A*), grey: previous plan', shape: 'dot' },
    { color: HEAT, label: 'Lidar hits marking the obstacle layer', shape: 'dot' },
  ],
  points: [
    'Nav2 does not plan on the raw map. It plans on a costmap: a grid (here 12.5 cm cells) where every cell holds a cost from 0 (free) to 254 (lethal). The global costmap covers the whole map for the planner; a small local one rolls along with the robot for the controller.',
    'The costmap is built from layers. The static layer copies the saved SLAM map: walls, the divider, the shelf. The obstacle layer is live: every lidar beam clears the cells it passes through and marks the cell where it hits. The cart is not on the saved map, but the obstacle layer has it from the first scan.',
    'The inflation layer treats the robot as a point by growing every lethal cell: within the robot radius (inscribed, 20 cm) the centre may not go at all (253); further out the cost decays exponentially until the inflation radius. The master costmap takes the highest cost of the layers in each cell.',
    'The planner (NavFn or Smac, here A* on the grid) adds cost to the length of every step, so the cheapest path is not the shortest: it keeps to the middle of the doorway and swings wide of corners. Shrink the inflation radius and it hugs the obstacles; grow it and the path is pushed to the centre of open space.',
    'At 3.5 s someone drops a box in the near doorway. The next scan marks it in the obstacle layer, inflation grows around it, and at the next re-plan (1 Hz in the default behaviour tree) A* finds the doorway blocked and routes through the far one.',
    'Tune it in nav2_params.yaml: inflation_layer.inflation_radius and cost_scaling_factor, robot_radius (or a footprint polygon), obstacle_layer.observation_sources: scan, and resolution. Watch /global_costmap/costmap in RViz.',
  ],
  controls: [
    { kind: 'slider', key: 'radius', label: 'Inflation radius', min: 0.3, max: 1, initial: 0.55, step: 0.05, format: (v) => `${v.toFixed(2)} m` },
    { kind: 'choice', key: 'drop', options: opts(DROP), initial: 'on' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const g = floorView(scene, MAIN.at, MAIN.k)
    const room = roomModel(g, 0.3)
    const field = costField(g, STILL, BAR_H)
    const robot = lidarRobot(g, 1)
    const foot = add(g, new THREE.Mesh(new THREE.RingGeometry(NAV.inscribed - 0.015, NAV.inscribed + 0.015, 40), glowMat(B_FIELD, 1)))
    foot.position.z = 0.02
    cylinder(g, 0.06, 0.6, glowMat(POWER, 0.9), [NAV.goal[0], NAV.goal[1], 0.3], 'z', 16)
    addLabel(g, 'goal', [NAV.goal[0], NAV.goal[1] + 0.25, 0.65], POWER, 0.16)
    addLabel(g, 'start', [NAV.start.x, NAV.start.y - 0.3, 0.02], GREY, 0.14)
    addLabel(g, 'cart: not on the map', [NAV_CART.kind === 'post' ? NAV_CART.at[0] : 0, 2.15, 0.6], LABEL, 0.14)
    const dropText = liveLabel(g, [2.95, -0.3, 0.02], { size: 0.15 })
    const beams = rayFan(g, 30, glowMat(HEAT, 0.5), 0.008)
    const hits = pointCloud(g, NAV.beams, 0.03)
    const pathMat = glowMat(RING, 1.2)
    const path = rayFan(g, 120, pathMat, 0.05)
    const old = rayFan(g, 120, glowMat(GREY, 0.4), 0.02)

    const thumbs = THUMBS.map((t, i) => {
      const tg = floorView(scene, [TH.x, TH.y[i], 0], TH.k)
      addLabel(scene, t.name, [TH.x, TH.y[i] + 5.9, 2], t.color, 0.44, 'left')
      return costField(tg, STILL, BAR_H)
    })
    thumbs[0].draw(STILL)
    const status = liveLabel(scene, [-21.4, -13.2, 0.3], { size: 0.56, align: 'left' })
    const clock = simClock(NAV.dt, 3)
    const st = { i: -1, key: '', f: null as NavFrame | null, master: STILL, prev: [] as XY[], flash: 0 }
    return {
      scene,
      view: { center: [-2.6, -1.2, 0], radius: 66, polar: 1.42, azimuth: 0.05 },
      frame(dt, p) {
        const P = cmParams(p)
        const run = cmRun(P)
        const key = `${P.r}|${P.drop}`
        const i = Math.min(run.length - 1, Math.floor(clock(dt, key, run.length - 1)))
        if (key !== st.key) Object.assign(st, { key, i: -1, prev: [] })
        const f = run[i]
        if (i !== st.i) {
          if (st.f && f.path !== st.f.path && i > 0) {
            st.prev = i > st.i ? st.f.path : []
            st.flash = 1
          }
          if (i < st.i) st.prev = []
          st.i = i
          st.f = f
          st.master = maxLayers(STILL, f.obs, f.infl)
          field.draw(st.master)
          thumbs[1].draw(f.obs)
          thumbs[2].draw(f.infl)
          room.draw(f.dropped ? ROOM_DROP : ROOM_CART)
          const lift = (q: XY) => (BAR_H * Math.min(INSCRIBED, costAt(st.master, q[0], q[1]))) / 254 + 0.04
          path(segs(f.path, lift))
          old(segs(st.prev, () => 0.03))
          beams(f.hits.filter((_, k) => k % 4 === 0).map((h): [V3, V3] => [[f.pose.x, f.pose.y, 0.17], [h.x, h.y, 0.17]]))
          let c = 0
          for (const h of f.hits) if (h.hit) hits.set(c++, [h.x, h.y, 0.17], HEAT)
          hits.show(c)
        }
        st.flash = glide(dt, st.flash, 0, 3)
        pathMat.emissiveIntensity = 1.2 + 2 * st.flash
        robot.group.position.set(f.pose.x, f.pose.y, 0)
        robot.group.rotation.z = f.pose.th
        robot.head.rotation.z -= dt * 12
        foot.position.x = f.pose.x
        foot.position.y = f.pose.y
        dropText.set(f.dropped ? 'box: dropped at 3.5 s' : '', HEAT)
        const msg = f.reached
          ? `t ${f.t.toFixed(1)} s · goal reached after ${f.replans + 1} plans`
          : f.dropped && f.t - NAV.dropS < 0.5
            ? `t ${f.t.toFixed(1)} s · box dropped: the next scan marks it in the obstacle layer`
            : f.dropped && f.path.length && f.path.some(([, y]) => y > 3.1) && f.pose.x < 2.8
              ? `t ${f.t.toFixed(1)} s · near doorway blocked: A* re-planned through the far one`
              : `t ${f.t.toFixed(1)} s · re-planning at 1 Hz on the master costmap (1× real time)`
        status.set(msg, f.reached ? POWER : LABEL)
      },
      readouts: () => {
        const f = st.f
        if (!f) return []
        return [
          { label: 'Sim time', value: `${f.t.toFixed(1)} s (1×)` },
          { label: 'Path left', value: `${f.reached ? '0.00' : pathLength(f.path).toFixed(2)} m` },
          { label: 'Cost under robot', value: `${costAt(st.master, f.pose.x, f.pose.y)}`, tone: costAt(st.master, f.pose.x, f.pose.y) < 128 ? 'ok' : 'warn' },
          { label: 'Plans (1 Hz)', value: `${f.replans + 1}` },
        ]
      },
    }
  },
}

// --- Behaviour trees: Nav2's navigate_to_pose tree ticking while someone blocks the corridor. ---

const BLOCK = { s1: 'Steps aside after 1 s', s4: 'Moves after 4 s', s9: 'Moves after 9 s', stay: 'Never moves' }
const BLOCK_S: Record<keyof typeof BLOCK, number> = { s1: 1, s4: 4, s9: 9, stay: Infinity }
const btRun = memoBy((b: number) => `${b}`, btNavRun)
const blockOf = (p: Record<string, number | string>) => BLOCK_S[pick(BLOCK, p.block, 's9')]
const TREE = { x: -15, y: 11.2, dx: 2, dy: 1.32, w: 9.4, h: 1.12 }
const CORR_ROOM = walledRoom(CORRIDOR.len, CORRIDOR.wid, 0.5, [])
const COR = { at: [-18.4, -8.6, 0] as V3, k: 2.4 }

export const behaviourTrees: Lesson = {
  id: 'nav2-behaviour-trees',
  title: 'Behaviour trees',
  tagline: 'Plan, follow, and recover when stuck',
  formula: (p) => {
    const b = blockOf(p)
    const f = btRun(b)
    const end = f[f.length - 1]
    return `NavigateRecovery(6 retries) → PipelineSequence[ RateController 1 Hz → ComputePathToPose, FollowPath ] · on failure: RoundRobin[ clear costmaps, Spin 90°, Wait 5 s, BackUp 30 cm ], then retry · blocked ${Number.isFinite(b) ? `${b} s` : 'for good'} → ${end.root === 'success' ? `goal reached at ${end.t.toFixed(1)} s` : `goal aborted at ${end.t.toFixed(1)} s`}`
  },
  legend: [
    { color: RING, label: 'Running', shape: 'dot' },
    { color: POWER, label: 'Success', shape: 'dot' },
    { color: HIGH_V, label: 'Failure (fades with time since tick)', shape: 'dot' },
    { color: FORCE, label: 'Person in the costmap', shape: 'dot' },
  ],
  points: [
    'Nav2\'s bt_navigator does not hard-code "plan then drive". It runs a behaviour tree, an XML file (navigate_to_pose_w_replanning_and_recovery.xml), ticked about 100 times a second. Each tick flows down from the root; every node answers running, success or failure. Generic sequences and fallbacks are in the Behaviour trees topic; this is the tree Nav2 ships.',
    'The main branch is a PipelineSequence: a RateController lets ComputePathToPose run once a second (re-planning as the costmap changes), while FollowPath keeps running the controller toward the goal every tick.',
    'Each of those is wrapped in a small Recovery node: if planning fails, clear the global costmap and try once more; if following fails, clear the local costmap and try once more. Old ghosts of obstacles are a common reason a plan fails.',
    'If the whole branch still fails, the root Recovery node (6 retries) ticks the recovery branch: a RoundRobin that tries one thing each time: clear both costmaps, then Spin (look around to refresh the costmap), then Wait (5 s for a person to pass), then BackUp. After each one the main branch is retried.',
    'Here someone steps in front of the robot at 4 s. FollowPath fails, ComputePathToPose fails, and the recoveries take turns. Pick how long the person stays: once they move, the next retry plans and drives on. If they never move, the sixth retry fails too and the navigate action is aborted: the caller gets a failure and decides what to do.',
    'Swap behaviours by editing the XML, not the code: default_nav_to_pose_bt_xml in nav2_params.yaml. Groot shows the tree live, lighting nodes the same way.',
  ],
  controls: [{ kind: 'choice', key: 'block', options: opts(BLOCK), initial: 's9' }],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const outer = floorView(scene, COR.at, COR.k, -0.3)
    const g = add(outer, new THREE.Group())
    g.rotation.z = Math.PI / 2
    roomModel(g).draw(CORR_ROOM)
    const robot = lidarRobot(g, 1.5)
    const pathMat = glowMat(RING, 0.8)
    rodBetween(g, [CORRIDOR.startX, CORRIDOR.wid / 2, 0.02], [CORRIDOR.goalX, CORRIDOR.wid / 2, 0.02], pathMat, 0.02)
    cylinder(g, 0.05, 0.5, glowMat(POWER, 0.9), [CORRIDOR.goalX, CORRIDOR.wid / 2, 0.25], 'z', 16)
    addLabel(outer, 'goal', [-CORRIDOR.wid / 2, CORRIDOR.goalX + 0.3, 0.6], POWER, 0.2)
    const person = add(g, new THREE.Group())
    cylinder(person, 0.13, 0.55, mat('#d9893f', { rough: 0.6 }), [0, 0, 0.275], 'z', 16)
    cylinder(person, 0.09, 0.12, mat('#f0c9a0', { rough: 0.6 }), [0, 0, 0.62], 'z', 16)
    const blob = add(g, new THREE.Mesh(new THREE.CircleGeometry(0.45, 32), new THREE.MeshBasicMaterial({ color: FORCE, transparent: true, opacity: 0.4, depthWrite: false })))
    const corrNote = liveLabel(scene, [-23, -11.2, 0.3], { size: 0.5, align: 'left' })
    const result = liveLabel(scene, [-23, -12.5, 0.3], { size: 0.5, align: 'left' })

    const tree = btDiagram(scene, NAV_TREE, TREE)
    const retryText = liveLabel(scene, [TREE.x + TREE.w + 0.3, TREE.y, 0.3], { size: 0.42, align: 'left' })

    const clock = simClock(CORRIDOR.dt, 3)
    const st = { f: null as BtFrame | null, gone: 0, th: 0 }
    return {
      scene,
      view: { center: [-6, 2.2, 0], radius: 64, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const b = blockOf(p)
        const run = btRun(b)
        const i = Math.min(run.length - 1, Math.floor(clock(dt, `${b}`, run.length - 1)))
        const f = run[i]
        st.f = f
        robot.group.position.set(f.x, CORRIDOR.wid / 2, 0)
        robot.group.rotation.z = f.th
        robot.head.rotation.z -= dt * 12
        const here = f.person !== null && f.t < CORRIDOR.personS + b
        st.gone = glide(dt, st.gone, here ? 1 : 0, 6)
        presence(person, st.gone)
        if (f.person !== null) person.position.set(f.person, CORRIDOR.wid / 2 + (1 - st.gone) * 0.5, 0)
        blob.visible = here && f.t - f.clearedAt > 0.35
        blob.position.set(f.person ?? 0, CORRIDOR.wid / 2, 0.015)
        pathMat.emissiveIntensity = f.root === 'failure' ? 0.1 : 0.8
        tree.frame(dt, f.lit, f.t)
        retryText.set(`${btKindText(NAV_TREE)} · retry ${f.retries}`, f.retries ? HEAT : GREY)
        const cleared = here && f.t - f.clearedAt <= 0.35
        corrNote.set(
          f.root === 'running' ? (cleared ? 'Costmap cleared · the person is seen again on the next scan' : f.note || 'Ticking the tree at 10 Hz') : '',
          cleared ? FORCE : f.doing ? RING : LABEL,
        )
        result.set(
          f.root === 'success'
            ? `Goal reached at ${f.t.toFixed(1)} s`
            : f.root === 'failure'
              ? `Goal aborted at ${f.t.toFixed(1)} s: every retry failed`
              : `t ${f.t.toFixed(1)} s (1× real time)${here ? ' · someone is in the way' : ''}`,
          f.root === 'success' ? POWER : f.root === 'failure' ? HIGH_V : LABEL,
        )
      },
      readouts: () => {
        const f = st.f
        if (!f) return []
        return [
          { label: 'Sim time', value: `${f.t.toFixed(1)} s (1×)` },
          { label: 'Running leaf', value: f.doing || '—' },
          { label: 'Root retries', value: `${f.retries} / 6`, tone: f.retries === 0 ? 'ok' : f.retries < 5 ? 'warn' : 'bad' },
          { label: 'Goal', value: f.root === 'running' ? 'running' : f.root === 'success' ? 'reached' : 'aborted', tone: f.root === 'failure' ? 'bad' : f.root === 'success' ? 'ok' : undefined },
        ]
      },
    }
  },
}
