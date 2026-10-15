// A small behaviour-tree ticker (Nav2's control nodes plus the generic ones and decorators), Nav2's navigate tree down a corridor,
// a fetch robot with a battery branch (vs the same job as an FSM), and a blackboard with a stale cup pose.
import { Machine } from '../../fsm'

export type BtStatus = 'idle' | 'running' | 'success' | 'failure'
export type BtNode =
  | { id: string; kind: 'action' | 'condition'; act: string }
  | { id: string; kind: 'sequence' | 'fallback' | 'reactiveSequence' | 'reactiveFallback' | 'pipeline' | 'roundRobin'; kids: BtNode[] }
  | { id: string; kind: 'inverter'; kids: [BtNode] }
  | { id: string; kind: 'retry'; tries: number; kids: [BtNode] }
  | { id: string; kind: 'timeout'; sec: number; kids: [BtNode] }
  | { id: string; kind: 'recovery'; retries: number; kids: [BtNode, BtNode] }
  | { id: string; kind: 'rate'; hz: number; kids: [BtNode] }
export type BtLeaf = Extract<BtNode, { act: string }>

export interface BtMemory {
  status: Record<string, BtStatus>
  idx: Record<string, number>
  retry: Record<string, number>
  last: Record<string, number>
  /** Result of each node's latest tick and when, for display. */
  lit: Record<string, { s: BtStatus; at: number }>
}
export const btMemory = (): BtMemory => ({ status: {}, idx: {}, retry: {}, last: {}, lit: {} })

function halt(n: BtNode, m: BtMemory) {
  m.status[n.id] = 'idle'
  m.retry[n.id] = 0
  if (n.kind !== 'roundRobin') m.idx[n.id] = 0
  if ('kids' in n) for (const k of n.kids) halt(k, m)
}

/** One tick from `n`; `leaf(node, fresh)` runs actions/conditions (`fresh` = not running last tick). */
export function btTick(n: BtNode, m: BtMemory, leaf: (n: BtLeaf, fresh: boolean) => BtStatus, now: number): BtStatus {
  const prev = m.status[n.id] ?? 'idle'
  const tick = (k: BtNode) => btTick(k, m, leaf, now)
  const haltKids = (from = 0) => 'kids' in n && n.kids.slice(from).forEach((k) => halt(k, m))
  let s: BtStatus = 'failure'
  switch (n.kind) {
    case 'action':
    case 'condition':
      s = leaf(n, prev !== 'running')
      break
    case 'sequence':
    case 'fallback': {
      const stop = n.kind === 'sequence' ? 'failure' : 'success'
      let i = m.idx[n.id] ?? 0
      for (;;) {
        const r = tick(n.kids[i])
        if (r === 'running') {
          s = 'running'
          break
        }
        if (r === stop || ++i === n.kids.length) {
          s = r
          haltKids()
          i = 0
          break
        }
      }
      m.idx[n.id] = i
      break
    }
    case 'pipeline': {
      const upTo = m.idx[n.id] ?? 0
      s = 'success'
      for (let i = 0; i < n.kids.length; i++) {
        const r = tick(n.kids[i])
        if (r === 'failure') {
          s = 'failure'
          break
        }
        if (r === 'running' && i >= upTo) {
          m.idx[n.id] = i
          s = 'running'
          break
        }
      }
      if (s !== 'running') {
        haltKids()
        m.idx[n.id] = 0
      }
      break
    }
    case 'recovery': {
      let i = m.idx[n.id] ?? 0
      for (;;) {
        const r = tick(n.kids[i])
        if (r === 'running') {
          s = 'running'
          break
        }
        if (i === 0 && r === 'success') {
          s = 'success'
          break
        }
        if (i === 0 && (m.retry[n.id] ?? 0) < n.retries) {
          halt(n.kids[0], m)
          i = 1
          continue
        }
        if (i === 1 && r === 'success') {
          m.retry[n.id] = (m.retry[n.id] ?? 0) + 1
          halt(n.kids[1], m)
          i = 0
          continue
        }
        s = 'failure'
        break
      }
      m.idx[n.id] = i
      if (s !== 'running') {
        haltKids()
        m.idx[n.id] = 0
        m.retry[n.id] = 0
      }
      break
    }
    case 'reactiveSequence':
    case 'reactiveFallback': {
      const stop = n.kind === 'reactiveSequence' ? 'failure' : 'success'
      s = n.kind === 'reactiveSequence' ? 'success' : 'failure'
      for (let i = 0; i < n.kids.length; i++) {
        const r = tick(n.kids[i])
        if (r === 'running') {
          haltKids(i + 1)
          s = 'running'
          break
        }
        if (r === stop) {
          s = stop
          break
        }
      }
      if (s !== 'running') haltKids()
      break
    }
    case 'inverter': {
      const r = tick(n.kids[0])
      s = r === 'success' ? 'failure' : r === 'failure' ? 'success' : r
      break
    }
    case 'retry': {
      s = tick(n.kids[0])
      if (s === 'failure') {
        const k = (m.retry[n.id] ?? 0) + 1
        halt(n.kids[0], m)
        m.retry[n.id] = k < n.tries ? k : 0
        if (k < n.tries) s = 'running'
      } else if (s === 'success') m.retry[n.id] = 0
      break
    }
    case 'timeout':
      if (prev !== 'running') m.last[n.id] = now
      if (now - m.last[n.id] >= n.sec - 1e-9) {
        halt(n.kids[0], m)
        s = 'failure'
      } else s = tick(n.kids[0])
      break
    case 'roundRobin': {
      let i = m.idx[n.id] ?? 0
      for (let tried = 0; tried < n.kids.length; tried++) {
        const r = tick(n.kids[i])
        if (r === 'running') {
          s = 'running'
          break
        }
        i = (i + 1) % n.kids.length
        if (r === 'success') {
          s = 'success'
          break
        }
      }
      m.idx[n.id] = i
      break
    }
    case 'rate':
      if (prev === 'idle' || m.status[n.kids[0].id] === 'running' || now - (m.last[n.id] ?? -Infinity) >= 1 / n.hz - 1e-9) {
        s = tick(n.kids[0])
        if (s === 'success') m.last[n.id] = now
      } else s = prev
      break
  }
  m.status[n.id] = s
  m.lit[n.id] = { s, at: now }
  return s
}

const act = (id: string, a = id): BtNode => ({ id, kind: 'action', act: a })

/** Nav2's navigate_to_pose_w_replanning_and_recovery.xml. */
export const NAV_TREE: BtNode = {
  id: 'NavigateRecovery',
  kind: 'recovery',
  retries: 6,
  kids: [
    {
      id: 'NavigateWithReplanning',
      kind: 'pipeline',
      kids: [
        {
          id: 'RateController',
          kind: 'rate',
          hz: 1,
          kids: [{ id: 'ComputePathRecovery', kind: 'recovery', retries: 1, kids: [act('ComputePathToPose'), act('ClearGlobal1', 'ClearGlobalCostmap')] }],
        },
        { id: 'FollowPathRecovery', kind: 'recovery', retries: 1, kids: [act('FollowPath'), act('ClearLocal1', 'ClearLocalCostmap')] },
      ],
    },
    {
      id: 'RecoveryFallback',
      kind: 'reactiveFallback',
      kids: [
        { id: 'GoalUpdated', kind: 'condition', act: 'GoalUpdated' },
        {
          id: 'RecoveryActions',
          kind: 'roundRobin',
          kids: [{ id: 'ClearingActions', kind: 'sequence', kids: [act('ClearLocal2', 'ClearLocalCostmap'), act('ClearGlobal2', 'ClearGlobalCostmap')] }, act('Spin'), act('Wait'), act('BackUp')],
        },
      ],
    },
  ],
}

/** Tree in depth-first order with depth, for drawing. */
export function btRows(n: BtNode, depth = 0, parent = ''): { node: BtNode; depth: number; parent: string }[] {
  return [{ node: n, depth, parent }, ...('kids' in n ? n.kids.flatMap((k) => btRows(k, depth + 1, n.id)) : [])]
}

export const CORRIDOR = { len: 7, wid: 1.6, startX: 0.6, goalX: 6.4, v: 0.4, personS: 4, personAhead: 0.7, stopM: 0.9, spinRad: Math.PI / 2, spinW: 1, waitS: 5, backM: 0.3, backV: 0.15, dt: 0.1, endS: 45 }

export interface BtFrame {
  t: number
  x: number
  th: number
  person: number | null
  lit: BtMemory['lit']
  /** Leaf running now, if any. */
  doing: string
  /** What the running leaf is up to. */
  note: string
  root: BtStatus
  retries: number
  clearedAt: number
}

/** The navigate tree ticked at 10 Hz down a corridor; someone steps in front at 4 s and stays `blockS` s. */
export function btNavRun(blockS: number): BtFrame[] {
  const C = CORRIDOR
  const m = btMemory()
  const w = { x: C.startX, th: 0, start: 0, from: 0, clearedAt: -1, personX: 0 }
  const out: BtFrame[] = []
  let root: BtStatus = 'running'
  for (let n = 0; n * C.dt <= C.endS; n++) {
    const t = n * C.dt
    if (t >= C.personS && w.personX === 0) w.personX = w.x + C.personAhead
    const here = t >= C.personS && t < C.personS + blockS
    const blocked = here && w.personX - w.x < C.stopM && w.personX > w.x
    let doing = ''
    let note = ''
    const leaf = (l: BtLeaf, fresh: boolean): BtStatus => {
      if (fresh && ['Spin', 'Wait', 'BackUp'].includes(l.act)) Object.assign(w, { start: t, from: l.act === 'Spin' ? w.th : w.x })
      const el = t - w.start
      switch (l.act) {
        case 'ComputePathToPose':
          return here ? 'failure' : 'success'
        case 'ClearGlobalCostmap':
        case 'ClearLocalCostmap':
          w.clearedAt = t
          return 'success'
        case 'GoalUpdated':
          return 'failure'
        case 'FollowPath':
          if (blocked) {
            note = 'FollowPath: blocked, no safe command'
            return 'failure'
          }
          doing = l.act
          note = Math.abs(w.th) > 0.02 ? 'FollowPath: turning back onto the path' : `FollowPath: ${(C.goalX - w.x).toFixed(1)} m to go`
          if (Math.abs(w.th) > 0.02) w.th -= Math.sign(w.th) * Math.min(Math.abs(w.th), C.spinW * 1.5 * C.dt)
          else w.x = Math.min(C.goalX, w.x + C.v * C.dt)
          return w.x >= C.goalX ? 'success' : 'running'
        case 'Spin':
          doing = l.act
          w.th = Math.min(w.from + C.spinRad, w.th + C.spinW * C.dt)
          note = `Spin: ${Math.round(((w.th - w.from) * 180) / Math.PI)}° of 90°`
          return w.th >= w.from + C.spinRad - 1e-9 ? 'success' : 'running'
        case 'Wait':
          doing = l.act
          note = `Wait: ${Math.min(el, C.waitS).toFixed(1)} of ${C.waitS} s`
          return el >= C.waitS - 1e-9 ? 'success' : 'running'
        case 'BackUp':
          doing = l.act
          w.x = Math.max(w.from - C.backM, w.x - C.backV * C.dt)
          note = `BackUp: ${Math.round((w.from - w.x) * 100)} of ${C.backM * 100} cm`
          return w.x <= w.from - C.backM + 1e-9 ? 'success' : 'running'
      }
      return 'failure'
    }
    if (root === 'running') root = btTick(NAV_TREE, m, leaf, t)
    const lit = Object.fromEntries(Object.entries(m.lit).map(([k, v]) => [k, { ...v }]))
    out.push({ t, x: w.x, th: w.th, person: t >= C.personS ? w.personX : null, lit, doing, note, root, retries: root === 'failure' ? 6 : (m.retry.NavigateRecovery ?? 0), clearedAt: w.clearedAt })
    if (root !== 'running' && out.length > 1 && out[out.length - 2].root !== 'running') break
  }
  return out
}

const cond = (id: string): BtNode => ({ id, kind: 'condition', act: id })
type Pt = [number, number]

/** Fetch robot room, metres: charger, shelf (cup), table; rates in %/s. */
export const FETCH = {
  w: 6,
  d: 4,
  charger: [0.6, 0.6] as Pt,
  shelf: [5.2, 3.2] as Pt,
  table: [1, 3.3] as Pt,
  v: 0.4,
  driveDrain: 1.5,
  idleDrain: 0.5,
  chargeRate: 10,
  low: 20,
  full: 95,
  graspS: 2,
  placeS: 1.5,
  helpS: 2,
  timeoutS: 4,
  tries: 3,
  dt: 0.1,
  endS: 90,
}

/** Fetch the cup from the shelf to the table; a battery branch first; ask for help if the job fails. */
export function fetchTree(reactive: boolean): BtNode {
  return {
    id: 'Root',
    kind: 'fallback',
    kids: [
      {
        id: 'Task',
        kind: reactive ? 'reactiveSequence' : 'sequence',
        kids: [
          { id: 'Power', kind: 'fallback', kids: [{ id: 'Not', kind: 'inverter', kids: [cond('BatteryLow')] }, act('GoCharge')] },
          {
            id: 'GetCup',
            kind: 'fallback',
            kids: [
              cond('Holding'),
              {
                id: 'Pick',
                kind: 'sequence',
                kids: [act('GoToShelf'), { id: 'Retry', kind: 'retry', tries: FETCH.tries, kids: [{ id: 'Timeout', kind: 'timeout', sec: FETCH.timeoutS, kids: [act('Grasp')] }] }],
              },
            ],
          },
          act('GoToTable'),
          act('Place'),
        ],
      },
      act('AskForHelp'),
    ],
  }
}

export type Grip = 'ok' | 'slip' | 'missing'
export type Cup = 'shelf' | 'held' | 'table' | 'missing'

export interface FetchFrame {
  t: number
  x: number
  y: number
  th: number
  battery: number
  charging: boolean
  cup: Cup
  /** Grasp attempts so far. */
  tries: number
  lit: BtMemory['lit']
  doing: string
  note: string
  root: BtStatus
  /** Battery ran flat mid-task. */
  dead: boolean
}

/** Drive toward `to` one step; true once there. */
function driveTo(w: { x: number; y: number; th: number }, to: Pt, step: number) {
  const dx = to[0] - w.x
  const dy = to[1] - w.y
  const d = Math.hypot(dx, dy)
  if (d > 1e-6) w.th = Math.atan2(dy, dx)
  const k = Math.min(1, step / Math.max(d, 1e-9))
  w.x += dx * k
  w.y += dy * k
  return d <= step
}

const snap = (m: BtMemory) => Object.fromEntries(Object.entries(m.lit).map(([k, v]) => [k, { ...v }]))

/** The fetch tree ticked at 10 Hz from the charger with `startPct` battery. */
export function fetchRun(reactive: boolean, startPct: number, grip: Grip): FetchFrame[] {
  const F = FETCH
  const tree = fetchTree(reactive)
  const m = btMemory()
  const w = { x: F.charger[0], y: F.charger[1], th: Math.PI / 4, battery: startPct, charging: false, cup: (grip === 'missing' ? 'missing' : 'shelf') as Cup, tries: 0, dead: false }
  const start: Record<string, number> = {}
  const out: FetchFrame[] = []
  let root: BtStatus = 'running'
  for (let n = 0; n * F.dt <= F.endS; n++) {
    const t = n * F.dt
    let doing = ''
    let note = ''
    let moved = false
    const go = (to: Pt, name: string) => {
      doing = name
      moved = true
      const there = driveTo(w, to, F.v * F.dt)
      note = `${name}: ${Math.hypot(to[0] - w.x, to[1] - w.y).toFixed(1)} m to go`
      return there ? 'success' : 'running'
    }
    const leaf = (l: BtLeaf, fresh: boolean): BtStatus => {
      if (fresh) start[l.id] = t
      const el = t - start[l.id]
      switch (l.act) {
        case 'BatteryLow':
          return w.battery < (w.charging ? F.full : F.low) ? 'success' : 'failure'
        case 'GoCharge':
          if (go(F.charger, 'GoCharge') === 'running') return 'running'
          moved = false
          w.charging = true
          w.battery = Math.min(100, w.battery + F.chargeRate * F.dt)
          note = `GoCharge: docked, ${Math.round(w.battery)} % of ${F.full} %`
          if (w.battery < F.full) return 'running'
          w.charging = false
          return 'success'
        case 'Holding':
          return w.cup === 'held' ? 'success' : 'failure'
        case 'GoToShelf':
          return go(F.shelf, 'GoToShelf')
        case 'Grasp':
          doing = 'Grasp'
          if (fresh) w.tries = (m.retry.Retry ?? 0) + 1
          if (w.cup === 'missing') {
            note = `Grasp ${w.tries}/${F.tries}: no cup found, ${el.toFixed(1)} s`
            return 'running'
          }
          note = `Grasp ${w.tries}/${F.tries}: closing gripper`
          if (el < F.graspS - 1e-9) return 'running'
          if (grip === 'slip' && w.tries < F.tries) {
            note = `Grasp ${w.tries}/${F.tries}: cup slipped`
            return 'failure'
          }
          w.cup = 'held'
          return 'success'
        case 'GoToTable':
          return go(F.table, 'GoToTable')
        case 'Place':
          doing = 'Place'
          note = 'Place: lowering the cup'
          if (el < F.placeS - 1e-9) return 'running'
          w.cup = 'table'
          return 'success'
        case 'AskForHelp':
          doing = 'AskForHelp'
          note = 'AskForHelp: beeping for a human'
          return el < F.helpS - 1e-9 ? 'running' : 'success'
      }
      return 'failure'
    }
    if (root === 'running') {
      root = btTick(tree, m, leaf, t)
      if (!w.charging) w.battery = Math.max(0, w.battery - (moved ? F.driveDrain : F.idleDrain) * F.dt)
      if (w.battery <= 0 && root === 'running') {
        w.dead = true
        root = 'failure'
        note = 'Battery flat: the robot stops dead'
      }
    }
    out.push({ t, x: w.x, y: w.y, th: w.th, battery: w.battery, charging: w.charging, cup: w.cup, tries: w.tries, lit: snap(m), doing, note, root, dead: w.dead })
    if (root !== 'running' && out.length > 1 && out[out.length - 2].root !== 'running') break
  }
  return out
}

export type FetchState = 'TO_SHELF' | 'GRASP' | 'TO_TABLE' | 'PLACE' | 'CHARGE'
export interface FetchIn {
  done: boolean
  low: boolean
  full: boolean
  /** State to return to after charging: an FSM has to remember it. */
  was: FetchState
}
const TASK: FetchState[] = ['TO_SHELF', 'GRASP', 'TO_TABLE', 'PLACE']
const DONE_LABEL = ['at shelf', 'grasped', 'at table']

/** The same job as an FSM, with battery-low bolted on: an edge into CHARGE from every task state and one back to each. */
export const FETCH_FSM: Machine<FetchState, FetchIn> = {
  states: [...TASK, 'CHARGE'],
  start: 'TO_SHELF',
  edges: [
    ...TASK.map((s) => ({ from: s, to: 'CHARGE' as FetchState, when: (i: FetchIn) => i.low, label: 'low' })),
    ...TASK.slice(0, 3).map((s, k) => ({ from: s, to: TASK[k + 1], when: (i: FetchIn) => i.done, label: DONE_LABEL[k] })),
    ...TASK.map((s) => ({ from: 'CHARGE' as FetchState, to: s, when: (i: FetchIn) => i.full && i.was === s, label: 'full' })),
  ],
}

/** Running leaf → the FSM state doing the same thing. */
export const FETCH_STATE: Record<string, FetchState> = { GoToShelf: 'TO_SHELF', Grasp: 'GRASP', GoToTable: 'TO_TABLE', Place: 'PLACE', GoCharge: 'CHARGE' }

// --- Blackboard: nodes share keys; GoTo's `goal` port is remapped to {cup_pose} or {table_pose}. ---

export type BbValue = number | boolean | Pt
export type Blackboard = Record<string, { v: BbValue; at: number }>
export interface BbPort {
  node: string
  port: string
  key: string
  out: boolean
}

export const BB_TREE: BtNode = {
  id: 'Fetch',
  kind: 'sequence',
  kids: [
    cond('BatteryOK'),
    { id: 'Approach', kind: 'reactiveSequence', kids: [{ id: 'Fresh', kind: 'fallback', kids: [cond('PoseFresh'), act('DetectCup')] }, act('GoToCup', 'GoTo')] },
    act('Grasp'),
    act('GoToTable', 'GoTo'),
    act('Place'),
  ],
}

const port = (node: string, p: string, key: string, out = false): BbPort => ({ node, port: p, key, out })
export const BB_PORTS: BbPort[] = [
  port('BatteryOK', 'pct', 'battery'),
  port('PoseFresh', 'pose', 'cup_pose'),
  port('DetectCup', 'pose', 'cup_pose', true),
  port('DetectCup', 'seen', 'cup_seen', true),
  port('GoToCup', 'goal', 'cup_pose'),
  port('Grasp', 'pose', 'cup_pose'),
  port('Grasp', 'holding', 'holding', true),
  port('GoToTable', 'goal', 'table_pose'),
  port('Place', 'holding', 'holding', true),
]
export const BB_KEYS = ['battery', 'cup_seen', 'cup_pose', 'table_pose', 'holding']

/** Room as for fetch; the cup is moved at `moveS` while the robot drives to it. */
export const BB = { from: [5.2, 3.75] as Pt, to: [4.6, 0.6] as Pt, moveS: 4, reach: 0.25, stop: 0.45, minPct: 20, startPct: 80, graspS: 1.5, placeS: 1.5 }

/** Seconds since `key` was written. */
export const bbAge = (b: Blackboard, key: string, t: number) => (b[key] ? t - b[key].at : Infinity)

export interface BbFrame {
  t: number
  x: number
  y: number
  th: number
  cup: Pt | null
  bb: Blackboard
  /** Port index → read or written this tick. */
  io: Record<number, 'r' | 'w'>
  lit: BtMemory['lit']
  doing: string
  note: string
  root: BtStatus
}

/** The blackboard fetch at 10 Hz; PoseFresh's `max_age` port decides when DetectCup re-runs. */
export function bbRun(moved: boolean, maxAge: number): BbFrame[] {
  const F = FETCH
  const m = btMemory()
  const bb: Blackboard = { battery: { v: BB.startPct, at: 0 }, table_pose: { v: F.table, at: 0 } }
  const w = { x: F.charger[0], y: F.charger[1], th: Math.PI / 4, cup: BB.from as Pt | null }
  const start: Record<string, number> = {}
  const out: BbFrame[] = []
  let root: BtStatus = 'running'
  for (let n = 0; n * F.dt <= F.endS; n++) {
    const t = n * F.dt
    if (moved && t >= BB.moveS && w.cup === BB.from) w.cup = BB.to
    const io: Record<number, 'r' | 'w'> = {}
    const rd = (node: string, key: string) => {
      io[BB_PORTS.findIndex((p) => p.node === node && p.key === key)] = 'r'
      return bb[key]?.v
    }
    const wr = (node: string, key: string, v: BbValue) => {
      io[BB_PORTS.findIndex((p) => p.node === node && p.key === key)] = 'w'
      bb[key] = { v, at: t }
    }
    let doing = ''
    let note = ''
    let moving = false
    const leaf = (l: BtLeaf, fresh: boolean): BtStatus => {
      if (fresh) start[l.id] = t
      const el = t - start[l.id]
      switch (l.act) {
        case 'BatteryOK':
          return (rd(l.id, 'battery') as number) >= BB.minPct ? 'success' : 'failure'
        case 'PoseFresh':
          rd(l.id, 'cup_pose')
          return bbAge(bb, 'cup_pose', t) < maxAge ? 'success' : 'failure'
        case 'DetectCup':
          wr(l.id, 'cup_seen', w.cup !== null)
          if (!w.cup) return 'failure'
          wr(l.id, 'cup_pose', [...w.cup])
          return 'success'
        case 'GoTo': {
          const goal = rd(l.id, l.id === 'GoToCup' ? 'cup_pose' : 'table_pose') as Pt
          doing = l.id
          moving = true
          const d = Math.hypot(goal[0] - w.x, goal[1] - w.y)
          const there = d <= BB.stop + 1e-9 || driveTo(w, [goal[0] - ((goal[0] - w.x) / d) * BB.stop, goal[1] - ((goal[1] - w.y) / d) * BB.stop], F.v * F.dt)
          note = `GoTo goal={${l.id === 'GoToCup' ? 'cup_pose' : 'table_pose'}}: ${Math.max(0, d - BB.stop).toFixed(1)} m`
          return there ? 'success' : 'running'
        }
        case 'Grasp': {
          const p = rd(l.id, 'cup_pose') as Pt
          doing = 'Grasp'
          note = `Grasp at cup_pose (${p[0].toFixed(1)}, ${p[1].toFixed(1)})`
          if (el < BB.graspS - 1e-9) return 'running'
          const hit = w.cup !== null && Math.hypot(w.cup[0] - p[0], w.cup[1] - p[1]) < BB.reach
          wr(l.id, 'holding', hit)
          if (!hit) {
            note = 'Grasp: closed on air, the cup is not at cup_pose'
            return 'failure'
          }
          w.cup = null
          return 'success'
        }
        case 'Place':
          doing = 'Place'
          note = 'Place: lowering the cup'
          if (el < BB.placeS - 1e-9) return 'running'
          wr(l.id, 'holding', false)
          w.cup = [...F.table]
          return 'success'
      }
      return 'failure'
    }
    if (root === 'running') {
      root = btTick(BB_TREE, m, leaf, t)
      bb.battery = { v: Math.max(0, (bb.battery.v as number) - (moving ? F.driveDrain : F.idleDrain) * F.dt * 0.5), at: t }
    }
    out.push({ t, x: w.x, y: w.y, th: w.th, cup: w.cup ? [...w.cup] : null, bb: { ...bb }, io, lit: snap(m), doing, note, root })
    if (root !== 'running' && out.length > 1 && out[out.length - 2].root !== 'running') break
  }
  return out
}
