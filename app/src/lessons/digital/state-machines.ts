import * as THREE from 'three/webgpu'
import {
  AVOID,
  Avoid,
  BRAKE_S,
  Box,
  CLEAR_CM,
  LIGHT_S,
  Light,
  PRESS_MEALY,
  PRESS_MOORE,
  PressMealy,
  PressMoore,
  Robot,
  TRAFFIC,
  avoidTick,
  fsmStep,
  pressMealyOut,
  pressMooreOut,
  trafficLamps,
} from '../../core/fsm'
import { Bit, bit } from '../../core/logic'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  GREY,
  LED_RED,
  RING,
  ease,
  glowHalo,
  groundSymbol,
  inBall,
  ledLamp,
  partLetter,
  segmentDisplay,
  signalWire,
  stateDiagram,
  tactSwitch,
  timingDiagram,
} from '../fx'
import { Lesson, Stage, n } from '../types'

const CLK_COLOR = '#5ad8e6'
const B_COLOR = '#b48cff'
const NODE = '#ffd84d'
const TRANSITIONS = { color: RING, label: 'Lit disc = current state; arrow flashes when taken', shape: 'arrow-right' } as const

/** Translucent board the diagram sits on, standing in for the logic that runs it. */
function panel(parent: THREE.Object3D, at: V3, w: number, h: number) {
  const m = new THREE.MeshStandardMaterial({ color: '#3a4152', roughness: 0.6, transparent: true, opacity: 0.35, depthWrite: false })
  add(parent, new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.4), m), [at[0], at[1], -2]).castShadow = false
}

// --- Moore vs Mealy: the same press detector both ways; Moore's output waits for the next clock, Mealy's follows the input. ---

const CLK = 1
const LOOP = 14
const PRESSES: [number, number][] = [
  [1.3, 4.6],
  [6.5, 7.4],
  [9.2, 11.8],
]
const btnAt = (t: number): Bit => bit(PRESSES.some(([a, b]) => t % LOOP >= a && t % LOOP < b))

const MOORE_NODES = [
  { id: 'UP', label: 'UP', at: [-8, -2] as [number, number], color: NODE },
  { id: 'EDGE', label: 'EDGE', at: [0, 5] as [number, number], color: LED_RED },
  { id: 'HELD', label: 'HELD', at: [8, -2] as [number, number], color: NODE },
]
const MOORE_LOOPS: Record<string, number> = { UP: Math.PI + 0.7, HELD: -0.7 }
const MEALY_NODES = [
  { id: 'UP', label: 'UP', at: [-6.5, 0] as [number, number], color: NODE },
  { id: 'HELD', label: 'HELD', at: [6.5, 0] as [number, number], color: NODE },
]
const MEALY_LOOPS: Record<string, number> = { UP: Math.PI, HELD: 0 }

export const mooreVsMealy: Lesson = {
  id: 'state-machines-moore-vs-mealy',
  title: 'Moore vs Mealy',
  tagline: 'One pulse per button press, two ways',
  formula: (p) =>
    p.kind === 'moore'
      ? 'Moore: out = 1 in state EDGE only · on each clock edge, state ← next(state, b)'
      : 'Mealy: out = 1 while state = UP and b = 1 · on each clock edge, state ← next(state, b)',
  legend: [
    { color: RING, label: 'b = button, CLK = clock; out lights the LED', shape: 'dot' },
    TRANSITIONS,
    { color: GREY, label: 'Arrow labels: b (Mealy: b / out)', shape: 'dot' },
  ],
  points: [
    'A state machine remembers where it is in a job. It holds one state in flip-flops; on each clock edge it reads its inputs and moves along one arrow. Here the job is: one pulse per press, however long the button is held.',
    'Moore: the output belongs to the state. UP sees b = 1 and moves to EDGE, which drives out = 1 for one whole clock; then HELD waits for the release. The pulse is clean, but starts at the next edge.',
    'Mealy: the output belongs to the arrow, written b / out. UP with b = 1 drives out = 1 at once, before any clock, and the next edge moves to HELD, which ends it. One state fewer, no wait, but a glitch on b gets straight through.',
    'Either way the press counter goes up by one per press, never once per clock. In code it is the same idea: if (pressed && !wasPressed) count++ is a Mealy machine with wasPressed as its state.',
    `The clock here is ${CLK} s; a microcontroller polling a button every few ms is the same machine, and the few-ms wait also rides out contact bounce.`,
  ],
  controls: [
    {
      kind: 'choice',
      key: 'kind',
      options: [
        { value: 'moore', label: 'Moore' },
        { value: 'mealy', label: 'Mealy' },
      ],
      initial: 'moore',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 34 })
    panel(scene, [0, 1.5, 0], 30, 19)
    const diagram = (nodes: typeof MOORE_NODES, m: typeof PRESS_MOORE | typeof PRESS_MEALY, loops: Record<string, number>, bend: (e: { from: string; to: string }) => number) =>
      stateDiagram(scene, [0, 0, 0], nodes, m.edges.map((e) => ({ ...e, loop: loops[e.from], bend: bend(e) })))
    const moore = diagram(MOORE_NODES, PRESS_MOORE, MOORE_LOOPS, (e) => (e.from === 'HELD' ? 0 : 0.9))
    const mealy = diagram(MEALY_NODES, PRESS_MEALY, MEALY_LOOPS, () => 2.2)
    const sw = tactSwitch(scene, [-25, -1.4, 0], { scale: 2.4 })
    const bIn: V3 = [-15, 1.5, 0]
    const bBall = inBall(scene, 'B', [-17.6, 1.5, 0])
    signalWire(scene, [sw.pins.a, [sw.pins.a[0], -4, 0], [sw.pins.a[0] - 1.6, -4, 0]])(0)
    add(scene, groundSymbol(), [sw.pins.a[0] - 1.6, -4, 0]).scale.setScalar(0.5)
    const bFeed = signalWire(scene, [sw.pins.b, [sw.pins.b[0], 1.5, 0], bIn])
    const cBall = inBall(scene, 'CLK', [-12, -10.5, 0])
    const cWire = signalWire(scene, [[-12, -10.5, 0], [0, -10.5, 0], [0, -8, 0]])
    const outWire = signalWire(scene, [[15, 1.5, 0], [19.4, 1.5, 0]])
    partLetter(scene, 'out', [17, 3, 0], 0.8, RING)
    const lamp = ledLamp(scene, LED_RED, [20, 1.5, 0], { scale: 1.2, anodeRight: false })
    signalWire(scene, [[20.6, 1.5, 0], [20.6, -0.6, 0]])(0)
    add(scene, groundSymbol(), [20.6, -0.6, 0]).scale.setScalar(0.5)
    const count = segmentDisplay(2, 3, LED_RED, true)
    add(scene, count.group, [21, -6, 0])
    partLetter(scene, 'presses', [21, -9, 0], 0.7, GREY)
    const scope = timingDiagram(scene, [0, -18.6, 0], [
      { label: 'CLK', color: CLK_COLOR },
      { label: 'B', color: B_COLOR },
      { label: 'out', color: LED_RED },
    ], { width: 44, rowH: 3 })
    const s = { key: '', t: 0, edges: 0, state: 'UP' as string, out: 0, count: 0, lv: { b: 0, c: 0, o: 0 } }
    return {
      scene,
      view: { center: [-1.5, -4.5, 0], radius: 96, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const isMoore = p.kind === 'moore'
        if (p.kind !== s.key) Object.assign(s, { key: p.kind, t: 0, edges: 0, state: 'UP', out: 0, count: 0 })
        s.t += dt
        const d = isMoore ? moore : mealy
        moore.group.visible = isMoore
        mealy.group.visible = !isMoore
        for (const k = Math.floor(s.t / CLK); s.edges < k; s.edges++) {
          const b = btnAt((s.edges + 1) * CLK)
          const r = isMoore ? fsmStep(PRESS_MOORE, s.state as PressMoore, b) : fsmStep(PRESS_MEALY, s.state as PressMealy, b)
          s.state = r.state
          d.fire(r.edge)
        }
        const b = btnAt(s.t)
        const C = bit(s.t % CLK < CLK / 2)
        const out = isMoore ? pressMooreOut(s.state as PressMoore) : pressMealyOut(s.state as PressMealy, b)
        if (out && !s.out) s.count++
        s.out = out
        const lv = s.lv
        lv.b += (b - lv.b) * ease(dt, 14)
        lv.c += (C - lv.c) * ease(dt, 14)
        lv.o += (out - lv.o) * ease(dt, 14)
        sw.set(lv.b, b === 1)
        bBall.set(lv.b)
        bFeed(lv.b)
        cBall.set(lv.c)
        cWire(lv.c)
        outWire(lv.o)
        lamp.set(lv.o)
        lamp.step(dt)
        d.frame(dt, s.state)
        count.set(String(s.count % 100))
        scope.frame(dt, [C, b, out])
      },
      readouts: (p) =>
        p.kind === 'moore'
          ? [
              { label: 'States', value: '3' },
              { label: 'Output from', value: 'state' },
              { label: 'Pulse', value: 'next edge, 1 clock', tone: 'ok' },
            ]
          : [
              { label: 'States', value: '2' },
              { label: 'Output from', value: 'state + input' },
              { label: 'Pulse', value: 'at once, to next edge', tone: 'warn' },
            ],
    }
  },
}

// --- Traffic light: a Moore machine on a timer, with a pedestrian button as the only way out of green. ---

const DEMAND: Record<string, { label: string; press: (t: number) => boolean; text: string }> = {
  button: { label: 'Push button', press: (t) => t % 15 > 6 && t % 15 < 6.6, text: 'someone presses every 15 s' },
  timer: { label: 'Fixed timer', press: () => true, text: 'request always on: a fixed cycle' },
  none: { label: 'No one', press: () => false, text: 'nobody presses, so green holds' },
}
const LAMP: Record<'red' | 'yellow' | 'green' | 'walk', string> = { red: '#ff3b30', yellow: '#ffb020', green: '#3ddc84', walk: '#3ddc84' }
const LIGHT_NODES = [
  { id: 'GREEN', label: 'GREEN', at: [-24, 4] as [number, number], color: LAMP.green },
  { id: 'YELLOW', label: 'YELLOW', at: [-10, 4] as [number, number], color: LAMP.yellow },
  { id: 'RED', label: 'RED', at: [-17, -6] as [number, number], color: LAMP.red },
]
const STOP_X = 4
const CAR_V = 9
const ROAD_Y = -12

const VISOR = new THREE.MeshStandardMaterial({ color: '#1c1d22', roughness: 0.6, side: THREE.DoubleSide })

function lampHead(parent: THREE.Object3D, at: V3, color: string, r: number) {
  const g = add(parent, new THREE.Group(), at)
  const lens = new THREE.MeshStandardMaterial({ color: '#2a2c31', emissive: color, emissiveIntensity: 0, roughness: 0.3 })
  add(g, mesh(new THREE.CylinderGeometry(r, r, 0.3, 32), lens), [0, 0, 0.15]).rotation.x = Math.PI / 2
  const visor = add(g, mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.15, 1.2, 32, 1, true, -Math.PI / 2, Math.PI), VISOR), [0, 0.1, 0.6])
  visor.rotation.x = Math.PI / 2
  const halo = glowHalo(g, [0, 0, 0.6], r)
  const tint = new THREE.Color(color)
  return (f: number) => {
    lens.emissiveIntensity = 1.6 * f
    lens.color.set('#2a2c31').lerp(tint, 0.5 * f)
    halo.set(0.8 * f, color)
  }
}

function robotCar(parent: THREE.Object3D) {
  const g = add(parent, new THREE.Group())
  box(g, [5, 1.4, 2.6], mat('#2f6fd6', { rough: 0.5 }), [0, 1.3, 0])
  box(g, [3.2, 0.25, 2.2], mat('#1b4d2e', { rough: 0.5 }), [-0.4, 2.1, 0])
  box(g, [0.25, 0.9, 1.6], mat('#2d6fb8', { rough: 0.5 }), [2.6, 1.5, 0])
  for (const z of [-0.4, 0.4]) cylinder(g, 0.32, 0.4, mat('#c9ccd1', { metal: 0.4, rough: 0.35 }), [2.85, 1.5, z], 'x', 16)
  const wheels = [-1.6, 1.6].flatMap((x) =>
    [-1.5, 1.5].map((z) => {
      const w = add(g, new THREE.Group(), [x, 0.75, z])
      cylinder(w, 0.75, 0.5, mat('#1c1c1f', { rough: 0.8 }), [0, 0, 0], 'z', 24)
      box(w, [1.2, 0.2, 0.52], mat('#f2c230', { rough: 0.5 }))
      return w
    }),
  )
  return { g, roll: (dx: number) => wheels.forEach((w) => (w.rotation.z -= dx / 0.75)) }
}

export const trafficLight: Lesson = {
  id: 'state-machines-traffic-light-fsm',
  title: 'Traffic light FSM',
  tagline: 'Timed states and a push button',
  formula: (p) =>
    `GREEN → YELLOW once pressed and ≥ ${LIGHT_S.green} s · YELLOW → RED after ${LIGHT_S.yellow} s · RED → GREEN after ${LIGHT_S.red} s · ${DEMAND[String(p.demand)].text}`,
  legend: [
    TRANSITIONS,
    { color: GREY, label: `P = button pressed, ${LIGHT_S.yellow} s = ${LIGHT_S.yellow} seconds in the state`, shape: 'dot' },
    { color: LAMP.green, label: 'Walk lamp: green while cars have red', shape: 'dot' },
  ],
  points: [
    'Each colour is a state, and the lamps depend on the state alone: a Moore machine. Three states need only two flip-flops; the arrows are the whole program.',
    'A timer is just another input. Entering a state restarts it, and an arrow fires when its time is up: YELLOW always lasts the same, so drivers learn it.',
    'The button sets a request flag (the WAIT lamp). GREEN only leaves when the flag is set and green has had its minimum time, so a stream of presses can’t starve the cars.',
    'Pick No one: no arrow out of GREEN can fire, so it stays green for ever. Fixed timer holds the request on, which is the classic light that cycles with no one there.',
    'Robots run on the same pattern: a state, a timer that resets on entry, and guarded arrows. The robot car here just obeys the output, stopping at the line unless it is green.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'demand',
      options: Object.entries(DEMAND).map(([value, d]) => ({ value, label: d.label })),
      initial: 'button',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    panel(scene, [-17, 0.5, 0], 24, 19)
    const diagram = stateDiagram(scene, [0, 0, 0], LIGHT_NODES, TRAFFIC.edges.map((e) => ({ ...e, bend: -1.4 })))
    const poleX = 9
    cylinder(scene, 0.45, 20, mat('#6d727c', { metal: 0.3, rough: 0.5 }), [poleX, ROAD_Y + 12, -1], 'y', 20)
    box(scene, [3.4, 9.6, 1.6], mat('#22252b', { rough: 0.5 }), [poleX, 8.4, 0])
    const lamps = {
      red: lampHead(scene, [poleX, 11.4, 0.8], LAMP.red, 1.2),
      yellow: lampHead(scene, [poleX, 8.4, 0.8], LAMP.yellow, 1.2),
      green: lampHead(scene, [poleX, 5.4, 0.8], LAMP.green, 1.2),
    }
    const pedX = 20
    cylinder(scene, 0.35, 16, mat('#6d727c', { metal: 0.3, rough: 0.5 }), [pedX, ROAD_Y + 10, -1], 'y', 20)
    box(scene, [2.6, 5.4, 1.4], mat('#22252b', { rough: 0.5 }), [pedX, 5.6, 0])
    const walkRed = lampHead(scene, [pedX, 7, 0.7], LAMP.red, 0.9)
    const walk = lampHead(scene, [pedX, 4.2, 0.7], LAMP.walk, 0.9)
    box(scene, [2.4, 3.2, 1.2], mat('#f2c230', { rough: 0.5 }), [pedX, -1, 0])
    const wait = lampHead(scene, [pedX, -0.2, 0.6], '#ffffff', 0.4)
    partLetter(scene, 'P', [pedX, -1.8, 0.65], 0.6, '#22252b')
    const btn = add(scene, mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 20), mat('#1c1d22', { rough: 0.5 })), [pedX, -1.8, 0.6])
    btn.rotation.x = Math.PI / 2
    const road = add(scene, new THREE.Group(), [0, ROAD_Y, 0])
    road.rotation.x = 0.5
    box(road, [64, 0.6, 7], mat('#2b2e34', { rough: 0.9 }), [0, -0.3, 0])
    box(road, [0.5, 0.06, 6], mat('#e8e8e8', { rough: 0.7 }), [STOP_X + 0.5, 0.03, 0])
    for (let k = 0; k < 6; k++) box(road, [0.7, 0.06, 6], mat('#d8dbe0', { rough: 0.7 }), [STOP_X + 2 + k * 1.4, 0.03, 0])
    const car = robotCar(road)
    const timer = segmentDisplay(3, 2, LAMP.yellow, true)
    add(scene, timer.group, [poleX + 5.4, 11.4, 0])
    const s = { key: '', t: 0, state: 'GREEN' as Light, inState: 0, req: false, carX: -28, carV: CAR_V, lamps: { red: 0, yellow: 0, green: 0, walk: 0 }, press: 0 }
    return {
      scene,
      view: { center: [-3, -0.5, 0], radius: 104, polar: 1.42, azimuth: 0.06 },
      frame(dt, p) {
        const demand = DEMAND[String(p.demand)]
        if (p.demand !== s.key) Object.assign(s, { key: p.demand, t: 0, state: 'GREEN', inState: 0, req: false })
        s.t += dt
        s.inState += dt
        const pressing = demand.press(s.t)
        if (pressing && s.state !== 'RED') s.req = true
        const r = fsmStep(TRAFFIC, s.state, { t: s.inState, ped: s.req })
        if (r.edge >= 0) {
          s.state = r.state
          s.inState = 0
          if (r.state === 'RED') s.req = false
        }
        diagram.fire(r.edge)
        diagram.frame(dt, s.state)
        const want = trafficLamps(s.state)
        for (const k of ['red', 'yellow', 'green', 'walk'] as const) s.lamps[k] += (want[k] - s.lamps[k]) * ease(dt, 12)
        lamps.red(s.lamps.red)
        lamps.yellow(s.lamps.yellow)
        lamps.green(s.lamps.green)
        walk(s.lamps.walk)
        walkRed(1 - s.lamps.walk)
        wait(s.req ? 0.5 + 0.5 * Math.abs(Math.sin(s.t * 4)) : 0)
        s.press += ((pressing && p.demand === 'button' ? 1 : 0) - s.press) * ease(dt, 20)
        btn.position.z = 0.6 - 0.3 * s.press
        const front = s.carX + 2.9
        const gap = STOP_X - front
        const hold = s.state !== 'GREEN' && gap > -0.5 && gap < 9
        const target = hold ? Math.max(0, Math.min(CAR_V, gap * 1.6)) : CAR_V
        s.carV += (target - s.carV) * ease(dt, 5)
        const dx = s.carV * dt
        s.carX += dx
        if (s.carX > 32) s.carX = -32
        car.g.position.set(s.carX, 0, 0.8)
        car.roll(dx)
        const left = s.state === 'GREEN' ? (s.req ? Math.max(0, LIGHT_S.green - s.inState) : NaN) : LIGHT_S[s.state === 'RED' ? 'red' : 'yellow'] - s.inState
        timer.set(Number.isNaN(left) ? '--' : left.toFixed(1))
      },
      readouts: (p) => [
        { label: 'Cycle', value: p.demand === 'none' ? 'stuck on green' : `${LIGHT_S.green + LIGHT_S.yellow + LIGHT_S.red} s minimum`, tone: p.demand === 'none' ? 'warn' : 'ok' },
        { label: 'Lamps from', value: 'state (Moore)' },
        { label: 'Flip-flops', value: '2 (3 states)' },
      ],
    }
  },
}

// --- Robot behaviour: an obstacle-avoider's GO / STOP / TURN machine, driven by an ultrasonic echo. ---

const ROOM: Box = { x0: 0, y0: 0, x1: 120, y1: 70 }
const PILLAR: Box = { x0: 66, y0: 30, x1: 76, y1: 40 }
const K = 0.36
const SPEED = 30
const SPIN = 1.8
const NOSE = 7
const CONE = 0.26
const BEAM: Record<Avoid, string> = { GO: '#3ddc84', STOP: '#ff3b30', TURN: '#ffb020' }
const AVOID_NODES = [
  { id: 'GO', label: 'GO', at: [-13, 9] as [number, number], color: BEAM.GO },
  { id: 'STOP', label: 'STOP', at: [0, 9] as [number, number], color: BEAM.STOP },
  { id: 'TURN', label: 'TURN', at: [13, 9] as [number, number], color: BEAM.TURN },
]
const TRAIL = 90
const ROOMS: Record<string, { label: string; blocks: Box[] }> = {
  pillar: { label: 'Pillar', blocks: [PILLAR] },
  empty: { label: 'Empty room', blocks: [] },
}

function avoidBot(parent: THREE.Object3D) {
  const g = add(parent, new THREE.Group())
  const s = K
  box(g, [14 * s, 11 * s, 1.2], mat('#2f6fd6', { rough: 0.5 }), [0, 0, 1.4])
  box(g, [8 * s, 8 * s, 0.25], mat('#1b4d2e', { rough: 0.5 }), [-1 * s, 0, 2.15])
  box(g, [0.3, 4.6 * s, 1.1], mat('#2d6fb8', { rough: 0.5 }), [7 * s, 0, 2])
  for (const y of [-1.2, 1.2]) cylinder(g, 0.3, 0.4, mat('#c9ccd1', { metal: 0.4, rough: 0.35 }), [7 * s + 0.3, y * s * 1.2, 2], 'x', 16)
  const wheels = [-1, 1].map((k) => {
    const w = add(g, new THREE.Group(), [-2 * s, k * 6.6 * s, 0.9])
    cylinder(w, 0.9, 0.5, mat('#1c1c1f', { rough: 0.8 }), [0, 0, 0], 'y', 24)
    box(w, [1.4, 0.52, 0.22], mat('#f2c230', { rough: 0.5 }))
    return w
  })
  const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1, Math.tan(CONE)), new THREE.Vector2(1, -Math.tan(CONE))])
  const beamMat = new THREE.MeshBasicMaterial({ color: BEAM.GO, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })
  const beam = add(g, mesh(new THREE.ShapeGeometry(tri), beamMat), [7 * s + 0.3, 0, 2])
  beam.castShadow = false
  return { g, wheels, beam, beamMat }
}

export const robotBehaviour: Lesson = {
  id: 'state-machines-robot-behaviour-fsm',
  title: 'Robot behaviour FSM',
  tagline: 'Drive, stop, turn: an obstacle avoider',
  formula: (p) => `GO → STOP when echo < ${n(p, 'near')} cm · STOP → TURN after ${BRAKE_S} s · TURN → GO when echo > ${n(p, 'near') + CLEAR_CM} cm`,
  legend: [
    TRANSITIONS,
    { color: BEAM.GO, label: 'Beam: echo in cm, coloured by state', shape: 'dot' },
    { color: GREY, label: 'Trail: where the robot has been', shape: 'dot' },
  ],
  points: [
    'A robot’s behaviour is easier to get right as a state machine than as a pile of if-statements: each state is one simple action, and each arrow names exactly what ends it.',
    'GO drives straight. An echo closer than the limit ends it: brake. STOP waits a moment so the robot isn’t still rolling when it turns. TURN spins on the spot until the way ahead is clear.',
    `TURN only ends ${CLEAR_CM} cm past the stop distance. With one threshold the robot would turn a hair, see the wall just past the limit, drive, and stop again: chatter. Two thresholds (hysteresis) make a clean break.`,
    'Drag the stop distance down and it noses into corners; up and it turns away from everything. In the firmware it’s a switch (state) in loop(), with millis() timing each state.',
    `An HC-SR04 sees a cone about ±15° wide (±${Math.round((CONE * 180) / Math.PI)}° here), so walls it meets at a glancing angle still echo. Speeds: ${SPEED} cm/s ahead, ${SPIN} rad/s turning.`,
  ],
  controls: [
    { kind: 'slider', key: 'near', label: 'Stop distance', min: 10, max: 30, initial: 20, step: 1, format: (v) => `${v} cm` },
    {
      kind: 'choice',
      key: 'room',
      options: Object.entries(ROOMS).map(([value, d]) => ({ value, label: d.label })),
      initial: 'pillar',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    panel(scene, [0, 10.5, 0], 36, 10)
    const diagram = stateDiagram(scene, [0, 0, 0], AVOID_NODES, AVOID.edges.map((e) => ({ ...e, bend: e.to === 'GO' ? 3.4 : 0 })))
    const floor = add(scene, new THREE.Group(), [0, -11, 0])
    floor.rotation.x = -0.75
    const W = (ROOM.x1 - ROOM.x0) * K
    const H = (ROOM.y1 - ROOM.y0) * K
    const at = (x: number, y: number): V3 => [(x - (ROOM.x0 + ROOM.x1) / 2) * K, (y - (ROOM.y0 + ROOM.y1) / 2) * K, 0]
    box(floor, [W, H, 0.3], mat('#3a3f48', { rough: 0.9 }), [0, 0, -0.15])
    const wallMat = mat('#c9b38a', { rough: 0.7 })
    const t = 0.7
    box(floor, [W + 2 * t, t, 2.4], wallMat, [0, H / 2 + t / 2, 1.2])
    box(floor, [W + 2 * t, t, 2.4], wallMat, [0, -H / 2 - t / 2, 1.2])
    box(floor, [t, H, 2.4], wallMat, [W / 2 + t / 2, 0, 1.2])
    box(floor, [t, H, 2.4], wallMat, [-W / 2 - t / 2, 0, 1.2])
    const pillar = add(floor, new THREE.Group())
    const pc = at((PILLAR.x0 + PILLAR.x1) / 2, (PILLAR.y0 + PILLAR.y1) / 2)
    box(pillar, [(PILLAR.x1 - PILLAR.x0) * K, (PILLAR.y1 - PILLAR.y0) * K, 3], wallMat, [pc[0], pc[1], 1.5])
    const bot = avoidBot(floor)
    const trail = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), TRAIL)
    trail.castShadow = false
    trail.frustumCulled = false
    floor.add(trail)
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
    for (let i = 0; i < TRAIL; i++) {
      trail.setMatrixAt(i, hidden)
      trail.setColorAt(i, new THREE.Color('#000000'))
    }
    const echo = segmentDisplay(3, 2.2, LED_RED, true)
    add(scene, echo.group, [22, 9, 0]).traverse((o) => (o.castShadow = false))
    const s = { key: '', bot: { x: 30, y: 22, heading: 0.45, state: 'GO', t: 0 } as Robot, cm: 0, drop: 0, slot: 0, roll: 0 }
    const m4 = new THREE.Matrix4()
    const c = new THREE.Color()
    return {
      scene,
      view: { center: [0, 0.4, 0], radius: 100, polar: 1.42, azimuth: 0.06 },
      frame(dt, p) {
        const key = `${p.near}|${p.room}`
        const room = ROOMS[String(p.room)]
        if (key !== s.key) {
          Object.assign(s, { key, bot: { x: 30, y: 22, heading: 0.45, state: 'GO', t: 0 }, drop: 0, slot: 0 })
          for (let i = 0; i < TRAIL; i++) trail.setMatrixAt(i, hidden)
          trail.instanceMatrix.needsUpdate = true
        }
        pillar.visible = room.blocks.length > 0
        const o = { near: n(p, 'near'), speed: SPEED, spin: SPIN, nose: NOSE, cone: CONE, room: ROOM, blocks: room.blocks }
        const sub = Math.max(1, Math.ceil(dt / 0.01))
        for (let k = 0; k < sub; k++) {
          const r = avoidTick(s.bot, dt / sub, o)
          diagram.fire(r.edge)
          s.roll += r.robot.state === 'GO' ? (SPEED * dt) / sub / 6.5 : r.robot.state === 'TURN' ? (SPIN * dt) / sub : 0
          s.bot = r.robot
          s.cm = r.cm
        }
        const b = s.bot
        diagram.frame(dt, b.state)
        bot.g.position.set(...at(b.x, b.y))
        bot.g.rotation.z = b.heading
        bot.wheels.forEach((w, i) => (w.rotation.y = i ? s.roll : b.state === 'TURN' ? -s.roll : s.roll))
        bot.beam.scale.set(Math.max(0.1, s.cm * K), Math.max(0.1, s.cm * K), 1)
        bot.beamMat.color.set(BEAM[b.state])
        s.drop += dt
        if (s.drop > 0.2) {
          s.drop = 0
          m4.makeTranslation(...at(b.x, b.y))
          trail.setMatrixAt(s.slot, m4)
          trail.setColorAt(s.slot, c.set(BEAM[b.state]))
          trail.instanceMatrix.needsUpdate = true
          if (trail.instanceColor) trail.instanceColor.needsUpdate = true
          s.slot = (s.slot + 1) % TRAIL
        }
        echo.set(String(Math.min(999, Math.round(s.cm))))
      },
      readouts: (p) => [
        { label: 'Stop below', value: `${n(p, 'near')} cm` },
        { label: 'Go again above', value: `${n(p, 'near') + CLEAR_CM} cm`, tone: 'ok' },
        { label: 'Brake', value: `${BRAKE_S} s` },
      ],
    }
  },
}
