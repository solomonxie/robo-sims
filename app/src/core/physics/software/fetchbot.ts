// A fetch robot run by a behaviour tree with a battery branch (vs the same job as an FSM), and a blackboard with a stale cup pose.
import { Machine } from '../../fsm'
import { BtLeaf, BtMemory, BtNode, BtStatus, btAct as act, btMemory, btTick } from './btree'

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
