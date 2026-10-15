// FreeRTOS on the ESP32: a tick-by-tick, fixed-priority preemptive scheduler on two cores, with queues and mutexes.

export const TICK_MS = 1

export type Op =
  | { op: 'run'; ticks: number; out?: string[]; res?: string }
  | { op: 'delay'; ticks: number }
  | { op: 'until'; period: number }
  | { op: 'send'; q: string; wait?: boolean }
  | { op: 'recv'; q: string }
  | { op: 'take'; m: string }
  | { op: 'give'; m: string }

export interface TaskDef {
  name: string
  prio: number
  core: number
  ops: Op[]
  start?: number
  once?: boolean
}
export type LockKind = 'semaphore' | 'mutex'
export interface SimSpec {
  tasks: TaskDef[]
  ticks: number
  cores?: number
  queues?: Record<string, number>
  locks?: Record<string, LockKind>
}
export type TaskState = 'run' | 'ready' | 'blocked' | 'done'
export interface RtosEvent {
  t: number
  task: number
  kind: 'wake' | 'block' | 'send' | 'recv' | 'drop' | 'take' | 'give'
  name?: string
  item?: number
}
export interface QItem {
  id: number
  t: number
}
export interface RtosRun {
  spec: SimSpec
  /** [core][tick] → running task, −1 = IDLE. */
  cores: number[][]
  /** [tick][task] */
  state: TaskState[][]
  /** [tick][task] effective priority (after inheritance). */
  prio: number[][]
  queues: Record<string, QItem[][]>
  holders: Record<string, number[]>
  events: RtosEvent[]
  out: { t: number; task: number; text: string }[]
  spans: { res: string; task: number; t0: number; t1: number }[]
}

interface Tcb {
  pc: number
  left: number
  status: 'ready' | 'blocked' | 'done'
  wakeAt: number
  wait: { kind: 'send' | 'recv' | 'take'; name: string } | null
  lastWake: number
  lastRan: number
  span: number
}

/** Each tick, every core runs its highest-priority ready task (equal priorities take turns); zero-time ops (send, take, delay…) run between ticks. */
export function simulate(spec: SimSpec): RtosRun {
  const { tasks, ticks } = spec
  const nCores = spec.cores ?? 2
  const locks = spec.locks ?? {}
  const qs: Record<string, QItem[]> = Object.fromEntries(Object.keys(spec.queues ?? {}).map((k) => [k, []]))
  const holder: Record<string, number> = Object.fromEntries(Object.keys(locks).map((k) => [k, -1]))
  const tcb: Tcb[] = tasks.map((d) => ({ pc: 0, left: -1, status: (d.start ?? 0) > 0 ? 'blocked' : 'ready', wakeAt: d.start ?? 0, wait: null, lastWake: d.start ?? 0, lastRan: -1, span: -1 }))
  const r: RtosRun = {
    spec,
    cores: Array.from({ length: nCores }, () => []),
    state: [],
    prio: [],
    queues: Object.fromEntries(Object.keys(qs).map((k) => [k, []])),
    holders: Object.fromEntries(Object.keys(holder).map((k) => [k, []])),
    events: [],
    out: [],
    spans: [],
  }
  let nextId = 1
  const ev = (t: number, task: number, kind: RtosEvent['kind'], name?: string, item?: number) => r.events.push({ t, task, kind, name, item })
  const waitsOn = (j: number, kind: string, name: string) => tcb[j].status === 'blocked' && tcb[j].wait?.kind === kind && tcb[j].wait?.name === name
  const eff = (i: number) => {
    let p = tasks[i].prio
    for (const [m, h] of Object.entries(holder)) if (h === i && locks[m] === 'mutex') tasks.forEach((d, j) => waitsOn(j, 'take', m) && (p = Math.max(p, d.prio)))
    return p
  }
  const wakeOne = (kind: 'send' | 'recv' | 'take', name: string, t: number) => {
    let best = -1
    tasks.forEach((d, j) => waitsOn(j, kind, name) && (best < 0 || d.prio > tasks[best].prio) && (best = j))
    if (best < 0) return
    tcb[best].status = 'ready'
    tcb[best].wait = null
    ev(t, best, 'wake', name)
  }
  const block = (i: number, t: number, wait: Tcb['wait'], wakeAt = 0) => {
    Object.assign(tcb[i], { status: 'blocked', wait, wakeAt })
    ev(t, i, 'block', wait?.name)
  }
  const advance = (i: number) => {
    const c = tcb[i]
    c.left = -1
    if (++c.pc < tasks[i].ops.length) return
    c.pc = 0
    if (tasks[i].once) c.status = 'done'
  }
  /** Runs one op of task i; true if it used up the tick. */
  const step = (i: number, t: number): boolean => {
    const c = tcb[i]
    const op = tasks[i].ops[c.pc]
    switch (op.op) {
      case 'run': {
        if (c.left < 0) {
          c.left = op.ticks
          if (op.res) c.span = r.spans.push({ res: op.res, task: i, t0: t, t1: t }) - 1
        }
        if (c.left === 0) {
          advance(i)
          return false
        }
        const piece = op.out?.[op.ticks - c.left]
        if (piece) r.out.push({ t, task: i, text: piece })
        if (c.span >= 0) r.spans[c.span].t1 = t + 1
        if (--c.left === 0) {
          c.span = -1
          advance(i)
        }
        return true
      }
      case 'delay':
        advance(i)
        if (c.status !== 'done') block(i, t, null, t + op.ticks)
        return false
      case 'until':
        c.lastWake += op.period
        advance(i)
        if (c.status !== 'done' && c.lastWake > t) block(i, t, null, c.lastWake)
        return false
      case 'send': {
        const q = qs[op.q]
        if (q.length < spec.queues![op.q]) {
          const id = nextId++
          q.push({ id, t })
          ev(t, i, 'send', op.q, id)
          advance(i)
          wakeOne('recv', op.q, t)
        } else if (op.wait === false) {
          ev(t, i, 'drop', op.q, nextId++)
          advance(i)
        } else block(i, t, { kind: 'send', name: op.q })
        return false
      }
      case 'recv': {
        const q = qs[op.q]
        if (!q.length) {
          block(i, t, { kind: 'recv', name: op.q })
          return false
        }
        ev(t, i, 'recv', op.q, q.shift()!.id)
        advance(i)
        wakeOne('send', op.q, t)
        return false
      }
      case 'take':
        if (holder[op.m] < 0) {
          holder[op.m] = i
          ev(t, i, 'take', op.m)
          advance(i)
        } else block(i, t, { kind: 'take', name: op.m })
        return false
      case 'give':
        if (holder[op.m] === i) holder[op.m] = -1
        ev(t, i, 'give', op.m)
        advance(i)
        wakeOne('take', op.m, t)
        return false
    }
  }
  for (let t = 0; t < ticks; t++) {
    tcb.forEach((c, i) => {
      if (c.status !== 'blocked' || c.wait || c.wakeAt > t) return
      c.status = 'ready'
      ev(t, i, 'wake')
    })
    for (let core = 0; core < nCores; core++) {
      let who = -1
      for (let guard = 0; guard < 64 && who < 0; guard++) {
        let best = -1
        tcb.forEach((c, i) => {
          if (tasks[i].core !== core || c.status !== 'ready') return
          if (best < 0 || eff(i) > eff(best) || (eff(i) === eff(best) && c.lastRan < tcb[best].lastRan)) best = i
        })
        if (best < 0) break
        if (step(best, t)) {
          who = best
          tcb[best].lastRan = t
        }
      }
      r.cores[core].push(who)
    }
    r.state.push(tcb.map((c, i) => (r.cores.some((row) => row[t] === i) ? 'run' : c.status)))
    r.prio.push(tasks.map((_, i) => eff(i)))
    for (const k of Object.keys(qs)) r.queues[k].push(qs[k].map((x) => ({ ...x })))
    for (const k of Object.keys(holder)) r.holders[k].push(holder[k])
  }
  return r
}

export const taskIndex = (r: RtosRun, name: string) => r.spec.tasks.findIndex((d) => d.name === name)
export const cpuShare = (r: RtosRun, i: number) => r.state.filter((s) => s[i] === 'run').length / r.state.length

/** Longest run of ticks the task was ready but not running. */
export function longestReady(r: RtosRun, i: number) {
  let best = 0
  let cur = 0
  for (const s of r.state) {
    cur = s[i] === 'ready' ? cur + 1 : 0
    best = Math.max(best, cur)
  }
  return best
}

/** Jobs of a periodic task: wake tick → end of its last run tick before it blocked again. */
export function jobs(r: RtosRun, i: number) {
  const out: { wake: number; end: number }[] = []
  let from = (r.spec.tasks[i].start ?? 0) === 0 ? 0 : -1
  for (const e of r.events) {
    if (e.task !== i) continue
    if (e.kind === 'wake' && !e.name) from = e.t
    else if (e.kind === 'block' && !e.name && from >= 0) {
      let last = -1
      for (let t = from; t <= e.t && t < r.state.length; t++) if (r.state[t][i] === 'run') last = t
      if (last >= 0) out.push({ wake: from, end: last + 1 })
      from = -1
    }
  }
  return out
}
export const responses = (r: RtosRun, i: number) => jobs(r, i).map((j) => j.end - j.wake)

/** What the task is blocked on at tick t ('' if not waiting on a queue or lock). */
export function blockedOn(r: RtosRun, i: number, t: number) {
  let on = ''
  for (const e of r.events) {
    if (e.t > t) break
    if (e.task === i) on = e.kind === 'block' ? (e.name ?? '') : ''
  }
  return r.state[t]?.[i] === 'blocked' ? on : ''
}

/** Time for a queue to fill when readings arrive every `period` and leave every `work` (∞ if it keeps up). */
export const queueFillMs = (len: number, period: number, work: number) => (work > period ? len / (1 / period - 1 / work) : Infinity)

/** Share of printed lines that came out whole. */
export function intactShare(text: string, valid: string[]) {
  const lines = text.split('\n').slice(0, -1)
  return lines.length ? lines.filter((l) => valid.includes(l)).length / lines.length : 1
}

/** Ticks from blocking on `name` to getting it (take or recv), per wait. */
export function waits(r: RtosRun, i: number, name: string) {
  const out: number[] = []
  let from = -1
  for (const e of r.events) {
    if (e.task !== i || e.name !== name) continue
    if (e.kind === 'block') from = e.t
    else if ((e.kind === 'take' || e.kind === 'recv' || e.kind === 'send') && from >= 0) {
      out.push(e.t - from)
      from = -1
    }
  }
  return out
}

/** Queue latency per item: received tick − sent tick. */
export function latencies(r: RtosRun, q: string) {
  const sent = new Map(r.events.filter((e) => e.kind === 'send' && e.name === q).map((e) => [e.item, e.t]))
  return r.events.filter((e) => e.kind === 'recv' && e.name === q).map((e) => e.t - sent.get(e.item)!)
}

export const drops = (r: RtosRun, q: string) => r.events.filter((e) => e.kind === 'drop' && e.name === q).length
export const peakFill = (r: RtosRun, q: string) => Math.max(0, ...r.queues[q].map((x) => x.length))
export const blockedTicks = (r: RtosRun, i: number) => r.state.filter((s) => s[i] === 'blocked').length

/** Everything written to the shared port, in order (core 0 before core 1 within a tick). */
export const serialText = (r: RtosRun, upTo = Infinity) =>
  r.out
    .filter((o) => o.t < upTo)
    .map((o) => o.text)
    .join('')

/** Two tasks' transactions on the same resource overlapping in time. */
export const collides = (r: RtosRun, res: string) =>
  r.spans.some((a, k) => r.spans.some((b, j) => j > k && a.res === res && b.res === res && a.task !== b.task && a.t0 < b.t1 && b.t0 < a.t1))

// --- Lesson scenes ---

export type PrioMode = 'preempt' | 'equal' | 'starve'
export const MOTOR_PERIOD = 10
export const MOTOR_WORK = 3
export const TELEMETRY_WORK = 7
export const PRIO_TICKS = 60

/** Motor control every 10 ms (3 ms of work) and a long telemetry job, on one core or split across both. */
export function priorityScene(mode: PrioMode, split: boolean): SimSpec {
  const motorOps: Op[] = mode === 'starve' ? [{ op: 'run', ticks: MOTOR_WORK }] : [{ op: 'run', ticks: MOTOR_WORK }, { op: 'until', period: MOTOR_PERIOD }]
  return {
    ticks: PRIO_TICKS,
    tasks: [
      { name: 'motor', prio: mode === 'equal' ? 1 : 5, core: 1, start: 2, ops: motorOps },
      { name: 'telemetry', prio: 1, core: split ? 0 : 1, ops: [{ op: 'run', ticks: TELEMETRY_WORK }, { op: 'delay', ticks: 3 }] },
    ],
  }
}

export type Producer = 'isr' | 'task'
export const QUEUE_LEN = 4
export const QUEUE_TICKS = 60

/** Sensor readings every `period` ticks into a 4-deep queue; the control task needs `work` ticks per reading. */
export function queueScene(producer: Producer, period: number, work: number): SimSpec {
  const sensor: TaskDef =
    producer === 'isr'
      ? { name: 'ISR', prio: 99, core: 0, ops: [{ op: 'send', q: 'readings', wait: false }, { op: 'until', period }] }
      : { name: 'sensor', prio: 3, core: 0, ops: [{ op: 'run', ticks: 1 }, { op: 'send', q: 'readings' }, { op: 'until', period }] }
  return {
    ticks: QUEUE_TICKS,
    queues: { readings: QUEUE_LEN },
    tasks: [sensor, { name: 'control', prio: 4, core: 1, ops: [{ op: 'recv', q: 'readings' }, { op: 'run', ticks: work }] }],
  }
}

export type Bus = 'serial' | 'i2c'
export type Locking = 'none' | LockKind
export const IMU_LINE = ['ax=', '0.12', ' ay=', '0.98\n']
export const MOTOR_LINE = ['L=', '180', ' R=', '176\n']

/** Serial: two equal tasks on both cores printing lines. I²C: logger (1) holds the bus, IMU (5) wants it, Wi-Fi (3) wakes in between, all on core 1. */
export function mutexScene(bus: Bus, guard: Locking): SimSpec {
  const wrap = (m: string, body: Op[]): Op[] => (guard === 'none' ? body : [{ op: 'take', m }, ...body, { op: 'give', m }])
  const locks = guard === 'none' ? {} : { [bus]: guard }
  if (bus === 'serial')
    return {
      ticks: 40,
      locks,
      tasks: [
        { name: 'imu', prio: 2, core: 0, ops: [...wrap(bus, [{ op: 'run', ticks: 4, out: IMU_LINE, res: bus }]), { op: 'delay', ticks: 2 }] },
        { name: 'motor', prio: 2, core: 1, start: 1, ops: [...wrap(bus, [{ op: 'run', ticks: 4, out: MOTOR_LINE, res: bus }]), { op: 'delay', ticks: 3 }] },
      ],
    }
  return {
    ticks: 32,
    locks,
    tasks: [
      { name: 'logger', prio: 1, core: 1, once: true, ops: wrap(bus, [{ op: 'run', ticks: 6, res: bus }]) },
      { name: 'wifi', prio: 3, core: 1, once: true, start: 3, ops: [{ op: 'run', ticks: 14 }] },
      { name: 'imu', prio: 5, core: 1, once: true, start: 2, ops: wrap(bus, [{ op: 'run', ticks: 2, res: bus }]) },
    ],
  }
}
