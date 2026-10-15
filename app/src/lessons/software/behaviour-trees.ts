import * as THREE from 'three/webgpu'
import {
  BB,
  BB_KEYS,
  BB_PORTS,
  BB_TREE,
  BbFrame,
  FETCH,
  FETCH_FSM,
  FETCH_STATE,
  FetchFrame,
  FetchState,
  Grip,
  RoomSolid,
  bbAge,
  bbRun,
  fetchRun,
  fetchTree,
  walledRoom,
} from '../../core/physics'
import { V3, add, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  btDiagram,
  floorView,
  glide,
  glowMat,
  lidarRobot,
  liveLabel,
  memoBy,
  meterBar,
  moduleBlock,
  rodBetween,
  roomModel,
  simClock,
  stateDiagram,
} from '../fx'
import { Lesson, Stage, opts, pick } from '../types'

const solid = (name: string, x: [number, number], y: [number, number], h: number): RoomSolid => ({ kind: 'box', name, x, y, h, refl: 0.5 })
const FURNITURE = [solid('shelf', [4.7, 5.7], [3.55, 3.95], 0.8), solid('table', [0.5, 1.5], [3.55, 3.95], 0.6)]
const ROOM = walledRoom(FETCH.w, FETCH.d, 0.3, FURNITURE)
const BB_ROOM = walledRoom(FETCH.w, FETCH.d, 0.3, [...FURNITURE, solid('stool', [4.35, 4.85], [0.35, 0.85], 0.45)])
/** Height of whatever the cup stands on at (x, y). */
const cupZ = (x: number, y: number) => (y > 3.5 ? (x > 3 ? 0.8 : 0.6) : Math.hypot(x - BB.to[0], y - BB.to[1]) < 0.3 ? 0.45 : 0)
const CUP_AT = { shelf: [5.2, 3.75, 0.8] as V3, table: [1, 3.75, 0.6] as V3 }
const ROBOT_K = 1.5

/** Fetch room: walls, shelf, table, charger pad, robot, cup. */
function fetchRoom(parent: THREE.Object3D, at: V3, k: number, room = ROOM) {
  const g = floorView(parent, at, k, -0.5)
  roomModel(g, 0.6).draw(room)
  const padM = glowMat(POWER, 0.3)
  cylinder(g, 0.32, 0.02, padM, [FETCH.charger[0], FETCH.charger[1], 0.01], 'z', 32)
  addLabel(g, 'charger', [FETCH.charger[0] + 0.45, FETCH.charger[1], 0.02], GREY, 0.2, 'left')
  addLabel(g, 'shelf', [5.2, 3.75, 1.3], GREY, 0.2)
  addLabel(g, 'table', [1, 3.75, 1.1], GREY, 0.2)
  const robot = lidarRobot(g, ROBOT_K)
  const cup = cylinder(g, 0.11, 0.22, mat('#ff9a4d', { rough: 0.4 }), [0, 0, 0], 'z', 20)
  return { g, padM, robot, cup }
}

const robotTop: V3 = [0, 0, 0.3]
function placeCup(cup: THREE.Object3D, robot: THREE.Object3D, held: boolean, at: V3 | null) {
  cup.visible = held || at !== null
  if (held) robot.localToWorld(cup.position.set(...robotTop)) && cup.parent!.worldToLocal(cup.position)
  else if (at) cup.position.set(at[0], at[1], at[2] + 0.11)
}

// --- Sequence and fallback: a fetch robot with a battery branch, memory vs reactive, decorators, vs the same FSM. ---

const SEQ = { reactive: 'ReactiveSequence', memory: 'Sequence (memory)' }
const BATT = { b100: '100 %', b50: '50 %', b35: '35 %' }
const BATT_PCT: Record<keyof typeof BATT, number> = { b100: 100, b50: 50, b35: 35 }
const GRIP: Record<Grip, string> = { ok: 'Grasp works', slip: 'Slips twice', missing: 'Cup missing' }
const fetchMemo = memoBy((q: readonly [boolean, number, Grip]) => q.join(), (q) => fetchRun(...q))
const params = (p: Record<string, number | string>) =>
  [pick(SEQ, p.seq, 'reactive') === 'reactive', BATT_PCT[pick(BATT, p.battery, 'b35')], pick(GRIP, p.grip, 'ok')] as const
const TREES = { reactive: fetchTree(true), memory: fetchTree(false) }
const FT = { x: -24, y: 8.8, dx: 1.5, dy: 1.3, w: 7.2, h: 1.08 }
const FSM_NODES: { id: FetchState; at: [number, number] }[] = [
  { id: 'TO_SHELF', at: [-9, 5.5] },
  { id: 'GRASP', at: [9, 5.5] },
  { id: 'TO_TABLE', at: [9, -6.5] },
  { id: 'PLACE', at: [-9, -6.5] },
  { id: 'CHARGE', at: [0, -0.5] },
]
const BATTERY_EDGES = FETCH_FSM.edges.filter((e) => e.from === 'CHARGE' || e.to === 'CHARGE').length

function outcome(f: FetchFrame) {
  if (f.dead) return { text: `Flat at ${f.t.toFixed(1)} s, cup undelivered`, color: HIGH_V }
  if (f.root === 'running') return null
  if (f.cup === 'table') return { text: `Cup on the table at ${f.t.toFixed(1)} s`, color: POWER }
  return { text: `Task failed → AskForHelp at ${f.t.toFixed(1)} s`, color: HEAT }
}

export const sequenceAndFallback: Lesson = {
  id: 'behaviour-trees-sequence-and-fallback',
  title: 'Sequence and fallback',
  tagline: 'Do these in order, or try these until one works',
  formula: (p) => {
    const [r, b, g] = params(p)
    const f = fetchMemo([r, b, g])
    const o = outcome(f[f.length - 1])
    return `${r ? 'ReactiveSequence' : 'Sequence'}[ Fallback[ Inverter(BatteryLow), GoCharge ], Fallback[ Holding, Sequence[ GoToShelf, Retry×3(Timeout 4 s(Grasp)) ] ], GoToTable, Place ] · start ${b} % → ${o?.text ?? ''}`
  },
  legend: [
    { color: RING, label: 'Running', shape: 'dot' },
    { color: POWER, label: 'Success', shape: 'dot' },
    { color: HIGH_V, label: 'Failure (fades with time since tick)', shape: 'dot' },
    { color: GREY, label: 'Not ticked', shape: 'dot' },
  ],
  points: [
    'A behaviour tree is ticked from the root, here 10 times a second. Every node answers running, success or failure, and its parent decides what to tick next. Leaves do the work: conditions (BatteryLow, Holding) answer at once, actions (GoToShelf, Grasp) may stay running for many ticks.',
    'A Sequence ticks its children in order and stops at the first one that does not succeed: "do all of these". A Fallback (selector) ticks them in order and stops at the first one that does not fail: "try these until one works". Fallback[Holding, Pick] reads as "make sure I hold the cup".',
    'Memory vs reactive: a plain Sequence remembers the running child and resumes there next tick, so BatteryLow is checked once, at the start. A ReactiveSequence re-ticks from the first child every tick, so a battery dropping below 20 % halts the running drive and GoCharge takes over. Start at 35 % and switch: the memory one runs flat on the way to the table.',
    'Decorators wrap one child. Inverter flips success and failure (not-low → carry on). Retry×3 re-runs a failing Grasp up to three times. Timeout 4 s fails a child that runs too long, so a missing cup cannot hang the robot; the whole Task then fails and the root Fallback runs AskForHelp.',
    `The same job as an FSM (bottom right): battery low needs an edge from every task state into CHARGE and one back to each, ${BATTERY_EDGES} of the ${FETCH_FSM.edges.length} edges, and CHARGE must remember where it came from. The tree adds one Fallback branch and touches nothing else.`,
    'BatteryLow has hysteresis: below 20 % to start charging, below 95 % while docked. Without it the reactive tree would leave the charger at 21 % and come straight back.',
    'Behaviour trees on robots are usually BehaviorTree.CPP (what Nav2 uses) or py_trees; trees are XML, and Groot draws them live like this.',
  ],
  controls: [
    { kind: 'choice', key: 'seq', options: opts(SEQ), initial: 'reactive' },
    { kind: 'choice', key: 'battery', options: opts(BATT), initial: 'b35' },
    { kind: 'choice', key: 'grip', options: opts(GRIP), initial: 'ok' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const trees = {
      reactive: add(scene, new THREE.Group()),
      memory: add(scene, new THREE.Group()),
    }
    const diagrams = { reactive: btDiagram(trees.reactive, TREES.reactive, FT), memory: btDiagram(trees.memory, TREES.memory, FT) }
    const room = fetchRoom(scene, [1.2, -1.2, 0], 1.9)
    const note = liveLabel(scene, [0.6, -2.6, 0.3], { size: 0.46, align: 'left' })
    const result = liveLabel(scene, [0.6, -3.8, 0.3], { size: 0.46, align: 'left' })
    const battery = meterBar(scene, [3.8, -6.2, 0], 5, 100, [[FETCH.low, `${FETCH.low}`, HIGH_V], [FETCH.full, `${FETCH.full}`, POWER]], 'battery')
    const fsm = stateDiagram(
      scene,
      [7, -11.6, 0],
      FSM_NODES.map((s) => ({ id: s.id, label: s.id.replace('_', ' '), at: s.at, color: s.id === 'CHARGE' ? POWER : RING })),
      FETCH_FSM.edges.map((e) => ({ from: e.from, to: e.to, label: e.label, bend: e.from === 'CHARGE' || e.to === 'CHARGE' ? 0.7 : 0 })),
      { r: 2.4, text: 0.62 },
    )
    fsm.group.scale.setScalar(0.42)
    addLabel(scene, `Same job as an FSM: ${BATTERY_EDGES} of ${FETCH_FSM.edges.length} edges handle the battery`, [5.8, -16.4, 0.3], GREY, 0.36)

    const clock = simClock(FETCH.dt / 2, 3)
    const st = { f: null as FetchFrame | null, state: 'TO_SHELF' as FetchState, key: '', last: '' }
    return {
      scene,
      view: { center: [-5.5, -1.6, 0], radius: 62, polar: 1.5, azimuth: 0 },
      frame(dt, p) {
        const [r, b, g] = params(p)
        const run = fetchMemo([r, b, g])
        const key = `${r}${b}${g}`
        const f = run[Math.min(run.length - 1, Math.floor(clock(dt, key, run.length - 1)))]
        st.f = f
        if (key !== st.key) Object.assign(st, { key, state: 'TO_SHELF', last: '' })
        const which = r ? 'reactive' : 'memory'
        trees.reactive.visible = r
        trees.memory.visible = !r
        diagrams[which].frame(dt, f.lit, f.t)

        const rb = room.robot.group
        rb.position.set(f.x, f.y, 0)
        rb.rotation.z = f.th
        if (!f.dead) room.robot.head.rotation.z -= dt * 12
        rb.updateMatrixWorld(true)
        placeCup(room.cup, rb, f.cup === 'held', f.cup === 'shelf' ? CUP_AT.shelf : f.cup === 'table' ? CUP_AT.table : null)
        room.padM.emissiveIntensity = glide(dt, room.padM.emissiveIntensity, f.charging ? 1.4 : 0.3, 6)

        const s = FETCH_STATE[f.doing]
        if (s && s !== st.state) {
          fsm.fire(FETCH_FSM.edges.findIndex((e) => e.from === st.state && e.to === s))
          st.state = s
        }
        fsm.frame(dt, st.state)
        battery(f.battery, `${Math.round(f.battery)} %`, f.battery < FETCH.low ? HIGH_V : f.charging ? POWER : f.battery < 40 ? HEAT : POWER)
        if (f.note) st.last = f.note
        const o = outcome(f)
        note.set(o ? st.last : f.note || 'Ticking the tree at 10 Hz', f.doing ? RING : LABEL)
        result.set(o?.text ?? `t ${f.t.toFixed(1)} s (2× real time)`, o?.color ?? LABEL)
      },
      readouts: () => {
        const f = st.f
        if (!f) return []
        const o = outcome(f)
        return [
          { label: 'Sim time', value: `${f.t.toFixed(1)} s (2×)` },
          { label: 'Running leaf', value: f.doing || '—' },
          { label: 'Battery', value: `${Math.round(f.battery)} %`, tone: f.battery < FETCH.low ? 'bad' : f.battery < 40 ? 'warn' : 'ok' },
          { label: 'Root', value: f.root === 'running' ? 'running' : f.dead ? 'flat' : f.cup === 'table' ? 'delivered' : 'asked for help', tone: o?.color === POWER ? 'ok' : o ? 'bad' : undefined },
        ]
      },
    }
  },
}

// --- Blackboard: nodes share keys through remapped ports; a stale cup_pose sends the grasp to the wrong place. ---

const CASE = { stays: 'Cup stays put', stale: 'Cup moved · max_age ∞', fresh: 'Cup moved · max_age 2 s' }
const caseOf = (p: Record<string, number | string>) => {
  const c = pick(CASE, p.case, 'stale')
  return [c !== 'stays', c === 'fresh' ? 2 : Infinity] as const
}
const bbMemo = memoBy((q: readonly [boolean, number]) => q.join(), (q) => bbRun(...q))
const BT = { x: -24, y: 8.8, dx: 1.6, dy: 1.5, w: 7.2, h: 1.15 }
const KEYS = { x: 0.2, y: -7, dy: 1.6, w: 5.4, h: 1.2 }
const LINK_X = -6
const PORT_TAG: Record<string, string> = {
  BatteryOK: 'pct ←',
  PoseFresh: 'pose ←',
  DetectCup: 'pose, seen →',
  GoToCup: 'goal ← {cup_pose}',
  Grasp: 'pose ←, holding →',
  GoToTable: 'goal ← {table_pose}',
  Place: 'holding →',
}
const fmt = (k: string, f: BbFrame) => {
  const e = f.bb[k]
  if (!e) return '(empty)'
  const v = e.v
  const text = typeof v === 'number' ? `${Math.round(v)} % ← /battery` : typeof v === 'boolean' ? `${v}` : `(${v[0].toFixed(1)}, ${v[1].toFixed(1)}) m`
  return k === 'cup_pose' ? `${text} · ${bbAge(f.bb, k, f.t).toFixed(1)} s old` : text
}

function bbOutcome(f: BbFrame) {
  if (f.root === 'success') return { text: `Cup on the table at ${f.t.toFixed(1)} s`, color: POWER }
  if (f.root === 'failure') return { text: 'Fetch failed: grasped where the cup used to be', color: HIGH_V }
  return null
}

export const blackboard: Lesson = {
  id: 'behaviour-trees-blackboard',
  title: 'Blackboard',
  tagline: 'Shared memory between nodes',
  formula: (p) => {
    const [moved, age] = caseOf(p)
    const f = bbMemo([moved, age])
    return `Sequence[ BatteryOK, ReactiveSequence[ Fallback[ PoseFresh(max_age ${Number.isFinite(age) ? `${age} s` : '∞'}), DetectCup ], GoTo(goal={cup_pose}) ], Grasp, GoTo(goal={table_pose}), Place ] → ${bbOutcome(f[f.length - 1])?.text ?? ''}`
  },
  legend: [
    { color: HEAT, label: 'Port writes a key', shape: 'dot' },
    { color: B_FIELD, label: 'Port reads; ring = cup_pose', shape: 'dot' },
    { color: RING, label: 'Running', shape: 'dot' },
    { color: POWER, label: 'Success', shape: 'dot' },
  ],
  points: [
    'Nodes do not call each other or pass return values; they share a blackboard, a key/value store owned by the tree. DetectCup writes cup_pose, GoTo and Grasp read it. Outside code can write keys too: here a battery topic callback updates {battery}.',
    'Each node declares ports, its own parameter names. The tree XML maps a port to a key: GoTo goal="{cup_pose}" and GoTo goal="{table_pose}" are the same node class, reused with a remapped port. Literal values work too: max_age="2".',
    'A blackboard entry is only as fresh as its last write. With max_age ∞, PoseFresh passes forever after the first DetectCup; someone moves the cup at 4 s, but the robot drives to the old pose and Grasp closes on air. The ring marks what the blackboard believes; the cup is where it really is.',
    'With max_age 2 s, PoseFresh fails once the pose is 2 s old, the Fallback re-runs DetectCup, and because Approach is a ReactiveSequence, GoTo reads the new goal on its next tick and turns toward the moved cup.',
    'Habits that avoid stale data: stamp values with a time and check it, re-detect near the goal, clear keys a branch no longer owns, and keep remapping explicit so two subtrees do not fight over one key.',
  ],
  controls: [{ kind: 'choice', key: 'case', options: opts(CASE), initial: 'stale' }],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const tree = btDiagram(scene, BB_TREE, BT, PORT_TAG)
    const keyAt = (i: number): V3 => [KEYS.x + KEYS.w / 2, KEYS.y - i * KEYS.dy, 0]
    addLabel(scene, 'blackboard', [KEYS.x + KEYS.w / 2, KEYS.y + 1.3, 0.3], GREY, 0.46)
    const keys = BB_KEYS.map((k, i) => {
      const block = moduleBlock(scene, keyAt(i), [KEYS.w, KEYS.h, 0.4], k)
      const value = liveLabel(scene, [KEYS.x + KEYS.w + 0.4, keyAt(i)[1], 0.3], { size: 0.4, align: 'left' })
      return { block, value, hot: 0, color: GREY }
    })
    const links = BB_PORTS.map((pt) => {
      const nd = tree.node(pt.node)
      const a: V3 = [nd.end + 0.3, nd.at[1], 0]
      const ki = BB_KEYS.indexOf(pt.key)
      const to: V3 = [KEYS.x, keyAt(ki)[1], 0.25]
      const m = glowMat(GREY, 0.2)
      if (LINK_X > a[0]) rodBetween(scene, [a[0], a[1], -0.1], [LINK_X, a[1], -0.1], m, 0.04)
      rodBetween(scene, [Math.max(LINK_X, a[0]), a[1], -0.1], [KEYS.x - 0.1, to[1], -0.1], m, 0.04)
      const bead = add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), glowMat(RING, 1.3)))
      bead.visible = false
      return { m, bead, a: [Math.max(LINK_X, a[0]), a[1], 0] as V3, b: [KEYS.x - 0.1, to[1], 0] as V3, ki, u: 1, out: pt.out, hot: 0 }
    })
    const r = fetchRoom(scene, [1.2, -0.9, 0], 1.9, BB_ROOM)
    const belief = add(r.g, new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 40), glowMat(B_FIELD, 1.2)))
    const note = liveLabel(scene, [-24, -7.4, 0.3], { size: 0.46, align: 'left' })
    const result = liveLabel(scene, [-24, -8.6, 0.3], { size: 0.46, align: 'left' })

    const clock = simClock(FETCH.dt / 2, 3)
    const st = { f: null as BbFrame | null, i: -1, last: '', cup: [0, 0] as [number, number] }
    return {
      scene,
      view: { center: [-5.5, -1.6, 0], radius: 62, polar: 1.5, azimuth: 0 },
      frame(dt, p) {
        const [moved, age] = caseOf(p)
        const run = bbMemo([moved, age])
        const i = Math.min(run.length - 1, Math.floor(clock(dt, `${moved}${age}`, run.length - 1)))
        const f = run[i]
        st.f = f
        tree.frame(dt, f.lit, f.t)
        const tick = i !== st.i
        if (i < st.i) st.last = ''
        st.i = i
        links.forEach((l, k) => {
          const io = f.io[k]
          if (tick && io) {
            l.u = 0
            l.hot = 1
            keys[l.ki].hot = 1
            keys[l.ki].color = io === 'w' ? HEAT : B_FIELD
            ;(l.bead.material as THREE.MeshStandardMaterial).emissive.set(io === 'w' ? HEAT : B_FIELD)
            ;(l.bead.material as THREE.MeshStandardMaterial).color.set(io === 'w' ? HEAT : B_FIELD)
            l.out = io === 'w'
          }
          l.u = Math.min(1, l.u + dt / 0.35)
          l.hot = Math.max(0, l.hot - dt * 1.5)
          l.bead.visible = l.u < 1
          const [s, e] = l.out ? [l.a, l.b] : [l.b, l.a]
          l.bead.position.set(s[0] + (e[0] - s[0]) * l.u, s[1] + (e[1] - s[1]) * l.u, 0.3)
          l.m.emissive.set(l.out ? HEAT : B_FIELD)
          l.m.color.set(l.hot > 0.05 ? (l.out ? HEAT : B_FIELD) : GREY)
          l.m.emissiveIntensity = 0.15 + 1.1 * l.hot
        })
        keys.forEach((k, ki) => {
          k.hot = Math.max(0, k.hot - dt * 1.5)
          k.block(dt, k.color, Math.max(0.12, k.hot))
          const stale = BB_KEYS[ki] === 'cup_pose' && f.cup && f.bb.cup_pose && Math.hypot(f.cup[0] - (f.bb.cup_pose.v as number[])[0], f.cup[1] - (f.bb.cup_pose.v as number[])[1]) > BB.reach
          k.value.set(fmt(BB_KEYS[ki], f), stale ? HIGH_V : LABEL)
        })

        const rb = r.robot.group
        rb.position.set(f.x, f.y, 0)
        rb.rotation.z = f.th
        r.robot.head.rotation.z -= dt * 12
        rb.updateMatrixWorld(true)
        const held = f.bb.holding?.v === true
        const onTable = f.cup && Math.hypot(f.cup[0] - FETCH.table[0], f.cup[1] - FETCH.table[1]) < 0.01
        if (f.cup && !onTable) {
          st.cup[0] = glide(dt, st.cup[0] || f.cup[0], f.cup[0], 5)
          st.cup[1] = glide(dt, st.cup[1] || f.cup[1], f.cup[1], 5)
        }
        placeCup(r.cup, rb, held, onTable ? CUP_AT.table : f.cup ? [st.cup[0], st.cup[1], cupZ(st.cup[0], st.cup[1])] : null)
        const bp = f.bb.cup_pose?.v as [number, number] | undefined
        belief.visible = !!bp && !held && f.root !== 'success'
        if (bp) belief.position.set(bp[0], bp[1], cupZ(bp[0], bp[1]) + 0.02)

        if (f.note) st.last = f.note
        const o = bbOutcome(f)
        note.set(o ? st.last : f.note || 'Ticking the tree at 10 Hz', f.doing ? RING : LABEL)
        result.set(o?.text ?? `t ${f.t.toFixed(1)} s (2× real time)${moved && f.t >= BB.moveS ? ' · the cup was moved at 4 s' : ''}`, o?.color ?? LABEL)
      },
      readouts: () => {
        const f = st.f
        if (!f) return []
        return [
          { label: 'Sim time', value: `${f.t.toFixed(1)} s (2×)` },
          { label: 'Leaf', value: f.doing || '—' },
          { label: 'Pose age', value: f.bb.cup_pose ? `${bbAge(f.bb, 'cup_pose', f.t).toFixed(1)} s` : '—', tone: bbAge(f.bb, 'cup_pose', f.t) > 2.05 ? 'warn' : 'ok' },
          { label: 'Fetch', value: f.root === 'running' ? 'running' : f.root === 'success' ? 'delivered' : 'failed', tone: f.root === 'failure' ? 'bad' : f.root === 'success' ? 'ok' : undefined },
        ]
      },
    }
  },
}
