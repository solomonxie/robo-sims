// A small behaviour-tree ticker with the control nodes Nav2's navigate_to_pose tree uses, and that tree driving a robot down a corridor.

export type BtStatus = 'idle' | 'running' | 'success' | 'failure'
export type BtNode =
  | { id: string; kind: 'action' | 'condition'; act: string }
  | { id: string; kind: 'sequence' | 'pipeline' | 'reactiveFallback' | 'roundRobin'; kids: BtNode[] }
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
    case 'sequence': {
      let i = m.idx[n.id] ?? 0
      for (;;) {
        const r = tick(n.kids[i])
        if (r === 'running') {
          s = 'running'
          break
        }
        if (r === 'failure' || ++i === n.kids.length) {
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
    case 'reactiveFallback':
      for (let i = 0; i < n.kids.length; i++) {
        const r = tick(n.kids[i])
        if (r === 'running') {
          haltKids(i + 1)
          s = 'running'
          break
        }
        if (r === 'success') {
          s = 'success'
          break
        }
      }
      if (s !== 'running') haltKids()
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
