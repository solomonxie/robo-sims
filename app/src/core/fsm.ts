// Finite-state machines: a table of guarded transitions, stepped once per clock or tick.
import { Bit, bit } from './logic'

export interface Transition<S extends string, I> {
  from: S
  to: S
  when: (i: I) => boolean
  label: string
}

export interface Machine<S extends string, I> {
  states: S[]
  start: S
  edges: Transition<S, I>[]
}

/** First edge out of `s` whose guard holds (edge = its index); none → stay, edge −1. */
export function fsmStep<S extends string, I>(m: Machine<S, I>, s: S, i: I): { state: S; edge: number } {
  const edge = m.edges.findIndex((e) => e.from === s && e.when(i))
  return { state: edge < 0 ? s : m.edges[edge].to, edge }
}

export function fsmRun<S extends string, I>(m: Machine<S, I>, inputs: I[], from: S = m.start) {
  return inputs.map((i) => {
    const r = fsmStep(m, from, i)
    from = r.state
    return r
  })
}

// --- Press detector: one output pulse per button press, however long it is held. ---

export type PressMoore = 'UP' | 'EDGE' | 'HELD'
export const PRESS_MOORE: Machine<PressMoore, Bit> = {
  states: ['UP', 'EDGE', 'HELD'],
  start: 'UP',
  edges: [
    { from: 'UP', to: 'UP', when: (b) => !b, label: '0' },
    { from: 'UP', to: 'EDGE', when: (b) => !!b, label: '1' },
    { from: 'EDGE', to: 'HELD', when: (b) => !!b, label: '1' },
    { from: 'EDGE', to: 'UP', when: (b) => !b, label: '0' },
    { from: 'HELD', to: 'HELD', when: (b) => !!b, label: '1' },
    { from: 'HELD', to: 'UP', when: (b) => !b, label: '0' },
  ],
}
/** Moore: the output is a function of the state alone. */
export const pressMooreOut = (s: PressMoore): Bit => bit(s === 'EDGE')

export type PressMealy = 'UP' | 'HELD'
export const PRESS_MEALY: Machine<PressMealy, Bit> = {
  states: ['UP', 'HELD'],
  start: 'UP',
  edges: [
    { from: 'UP', to: 'UP', when: (b) => !b, label: '0/0' },
    { from: 'UP', to: 'HELD', when: (b) => !!b, label: '1/1' },
    { from: 'HELD', to: 'HELD', when: (b) => !!b, label: '1/0' },
    { from: 'HELD', to: 'UP', when: (b) => !b, label: '0/0' },
  ],
}
/** Mealy: the output reads the state and the input now, so it moves as soon as the input does. */
export const pressMealyOut = (s: PressMealy, b: Bit): Bit => bit(s === 'UP' && b === 1)

// --- Traffic light with a pedestrian button: a Moore machine on a timer. ---

export type Light = 'GREEN' | 'YELLOW' | 'RED'
export interface LightIn {
  /** Seconds since entering the state. */
  t: number
  /** A pedestrian has pressed and is waiting. */
  ped: boolean
}
export const LIGHT_S = { green: 4, yellow: 2, red: 5 }
export const TRAFFIC: Machine<Light, LightIn> = {
  states: ['GREEN', 'YELLOW', 'RED'],
  start: 'GREEN',
  edges: [
    { from: 'GREEN', to: 'YELLOW', when: (i) => i.ped && i.t >= LIGHT_S.green, label: 'P' },
    { from: 'YELLOW', to: 'RED', when: (i) => i.t >= LIGHT_S.yellow, label: `${LIGHT_S.yellow}S` },
    { from: 'RED', to: 'GREEN', when: (i) => i.t >= LIGHT_S.red, label: `${LIGHT_S.red}S` },
  ],
}
export const trafficLamps = (s: Light) => ({ red: bit(s === 'RED'), yellow: bit(s === 'YELLOW'), green: bit(s === 'GREEN'), walk: bit(s === 'RED') })

// --- Obstacle-avoiding robot: drive, brake, turn on the spot until the way is clear. ---

export type Avoid = 'GO' | 'STOP' | 'TURN'
export interface AvoidIn {
  /** Ultrasonic range ahead, cm. */
  cm: number
  /** Seconds in this state. */
  t: number
  /** Range below which the robot stops, cm. */
  near: number
}
export const BRAKE_S = 0.5
/** Turning stops only once the range is this much past `near` (hysteresis), so it doesn't stop again at once. */
export const CLEAR_CM = 15
export const AVOID: Machine<Avoid, AvoidIn> = {
  states: ['GO', 'STOP', 'TURN'],
  start: 'GO',
  edges: [
    { from: 'GO', to: 'STOP', when: (i) => i.cm < i.near, label: 'nEAr' },
    { from: 'STOP', to: 'TURN', when: (i) => i.t >= BRAKE_S, label: `${BRAKE_S}S` },
    { from: 'TURN', to: 'GO', when: (i) => i.cm > i.near + CLEAR_CM, label: 'CLEAr' },
  ],
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Distance along the ray from (x, y) at `heading` (rad) to the nearest wall: the inside of `room`, the outside of `blocks`. */
export function rangeTo(x: number, y: number, heading: number, room: Box, blocks: Box[] = []) {
  const dx = Math.cos(heading)
  const dy = Math.sin(heading)
  const slab = (p: number, d: number, a: number, b: number): [number, number] => {
    if (Math.abs(d) < 1e-12) return p >= a && p <= b ? [-Infinity, Infinity] : [Infinity, -Infinity]
    const t0 = (a - p) / d
    const t1 = (b - p) / d
    return t0 < t1 ? [t0, t1] : [t1, t0]
  }
  const span = (b: Box) => {
    const [ax, bx] = slab(x, dx, b.x0, b.x1)
    const [ay, by] = slab(y, dy, b.y0, b.y1)
    return [Math.max(ax, ay), Math.min(bx, by)]
  }
  let best = span(room)[1]
  for (const b of blocks) {
    const [tin, tout] = span(b)
    if (tin <= tout && tin > 0) best = Math.min(best, tin)
  }
  return Math.max(0, best)
}

export interface Robot {
  x: number
  y: number
  heading: number
  state: Avoid
  t: number
}

/** Ultrasonic echo: the nearest wall within ±`cone` rad of the beam's axis. */
export const echoRange = (x: number, y: number, heading: number, cone: number, room: Box, blocks: Box[] = []) =>
  Math.min(...[-1, -0.5, 0, 0.5, 1].map((k) => rangeTo(x, y, heading + k * cone, room, blocks)))

/** One tick: read the echo from the robot's nose, step the machine, then drive (cm/s) or spin (rad/s) for `dt`. */
export function avoidTick(r: Robot, dt: number, o: { near: number; speed: number; spin: number; nose: number; cone: number; room: Box; blocks: Box[] }) {
  const nx = r.x + o.nose * Math.cos(r.heading)
  const ny = r.y + o.nose * Math.sin(r.heading)
  const cm = echoRange(nx, ny, r.heading, o.cone, o.room, o.blocks)
  const { state, edge } = fsmStep(AVOID, r.state, { cm, t: r.t, near: o.near })
  const t = state === r.state ? r.t + dt : 0
  const go = state === 'GO' ? o.speed * dt : 0
  const next: Robot = {
    x: r.x + go * Math.cos(r.heading),
    y: r.y + go * Math.sin(r.heading),
    heading: r.heading + (state === 'TURN' ? o.spin * dt : 0),
    state,
    t,
  }
  return { robot: next, cm, edge }
}
