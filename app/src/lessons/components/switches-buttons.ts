import * as THREE from 'three/webgpu'
import { Debounce, LEDS, LED_RATED_A, SCHMITT_HI, SCHMITT_LO, SWITCHES, SwitchPart, VIH, VIL, bounceEdges, bouncedState, debounceStep, latchToggle, ledStringAmps, rcDebounceStep, schmittHigh } from '../../core/physics'
import { si } from '../../core/units'
import { V3, add, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  GREY,
  HIGH_V,
  LANE,
  LOW_V,
  POWER,
  RING,
  ceramicAlong,
  dropAlong,
  ease,
  emptyGroup,
  icPackage,
  junction,
  ledLamp,
  lerp,
  plusFlow,
  presence,
  pulseLabel,
  resistorAlong,
  scope,
  tactSwitch,
  ticks,
  toggleSwitch,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const VDD = 3.3
const R_PULL = 10e3
const ms = (s: number) => si(s, 's', 2)
const lane = (pts: V3[], z = LANE): V3[] => pts.map(([x, y]): V3 => [x, y, z])
type PartKey = keyof typeof SWITCHES
const partOf = (p: Params): PartKey => (p.part === 'toggle' || p.part === 'worn' ? p.part : 'tact')

/** MCU stand-in with 3.3 V, the input pin and GND on its right side (`side` -1: left); returns their wire ends. */
function mcu(scene: THREE.Object3D, at: V3, side = 1) {
  add(scene, icPackage(3.4, 7.2, 3), at)
  const x = at[0] + side * (1.7 + 0.85)
  return { x, v3: at[1] + 2.4, pin: at[1], gnd: at[1] - 2.4 }
}

// --- Contact bounce: a press is a burst of makes and breaks, milliseconds long. ---

const W1 = 8e-3
const SLOW1 = 500
const T0 = 1e-3
const MCU1: V3 = [-16, -1, 0]
const PX1 = -10
const TOP1 = 5.6
const GND1 = -6
const SW1_X = -3.2
const K_TACT = 3.2
const K_TOGGLE = 1
const SC1: V3 = [8.2, 0.6, 0]
const SC1_W = 7.2
const SC1_H = 5.6
const vy1 = (v: number) => (v / 4) * SC1_H - SC1_H / 2

/** One press or release of `part` inside the scope window: the contact edges (s from the window start) and whether it's made at `t`. */
function event1(part: SwitchPart, press: boolean, seed: number) {
  const edges = (press ? bounceEdges(part.makeS, part.bounces, seed) : bounceEdges(part.breakS, Math.max(1, Math.round(part.bounces / 3)), seed + 7)).map((e) => e + T0)
  return { press, edges, made: (t: number) => bouncedState(t, edges, !press) }
}

export const contactBounce: Lesson = {
  id: 'switches-buttons-contact-bounce',
  title: 'Contact bounce',
  tagline: 'One press, a dozen clicks',
  formula: (p) => {
    const s = SWITCHES[partOf(p)]
    return `${s.name}: the contacts bounce ${s.bounces} times in ${ms(s.makeS)} on a press, for ${ms(s.breakS)} on release. An input that reacts in microseconds sees every one`
  },
  legend: [
    { color: '#ffffff', label: 'Pin voltage, 8 ms across, slowed 500×', shape: 'dot' },
    { color: RING, label: 'Contacts touching', shape: 'dot' },
    { color: HIGH_V, label: '3.3 V (pulled up)', shape: 'dot' },
    { color: LOW_V, label: '0 V (switch closed)', shape: 'dot' },
  ],
  points: [
    'Metal contacts are springs. When they hit they bounce apart a few times before they settle, and a dirty or worn contact also loses touch as it wipes. Each bounce makes and breaks the circuit.',
    'Here a 10 kΩ pull-up holds the pin at 3.3 V; the button pulls it to 0 V. The scope shows 8 ms, slowed 500×: a single press is a burst of falling edges, then it settles. Releasing bounces too, less.',
    'Bounce is typically 1–2 ms for a tactile button, a few ms for a toggle, 5–10 ms on a worn one (Ganssle’s survey: worst 6.2 ms on press).',
    'An ESP32 sees an edge in under a microsecond, so an interrupt on FALLING counts every bounce: one press reads as several. The counter shows what naive code thinks happened.',
    'Fix it in hardware (RC filter + Schmitt trigger) or in code (wait until the level holds): next lesson.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'part',
      options: [
        { value: 'tact', label: 'Tactile' },
        { value: 'toggle', label: 'Toggle' },
        { value: 'worn', label: 'Worn tactile' },
      ],
      initial: 'tact',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const m = mcu(scene, MCU1)
    const rx = m.x + 0.9
    wire(scene, [[m.x, m.v3, 0], [rx, m.v3, 0], [rx, TOP1, 0], [PX1, TOP1, 0], [PX1, m.pin, 0]])
    wire(scene, [[m.x, m.pin, 0], [PX1, m.pin, 0]])
    wire(scene, [[m.x, m.gnd, 0], [rx, m.gnd, 0], [rx, GND1, 0]])
    resistorAlong(scene, R_PULL, [PX1, TOP1, 0], [PX1, m.pin, 0], 1.8)
    const holder = add(scene, new THREE.Group())
    const countLabel = pulseLabel(scene, 2, RING, [m.x + 2.6, m.pin - 1.4, 0], 1.3)

    const plot = scope(scene, SC1_W, SC1_H, { divs: [8, 4], zeroAt: 0 })
    plot.group.position.set(...SC1)
    ticks(plot, [[0, '0'], [0.5, '4'], [1, '8']], [[0, '0'], [VDD / 4, '3.3']])
    const trace = plot.trace('#ffffff', { samples: 640, radius: 0.07 })

    const live = { f: 1, made: false }
    const paint = (at: THREE.Vector3) => {
      if (at.y < m.pin - 0.01) return 0
      if (Math.abs(at.x - PX1) < 0.01 && at.y > m.pin) return dropAlong(at, [PX1, TOP1, 0], [PX1, m.pin, 0], 1, live.f, 1.2 * 1.8)
      if (at.y > m.pin + 0.01) return 1
      return live.f
    }
    let part: ReturnType<typeof tactSwitch> | ReturnType<typeof toggleSwitch> | null = null
    let flow: ReturnType<typeof plusFlow> | null = null
    const st = { key: '' as PartKey | '', t: 0, sweep: 0, ev: event1(SWITCHES.tact, true, 1), counted: 0, presses: 0, edges: 0, seen: 0 }

    return {
      scene,
      view: { center: [-1.6, 3.4, 0], radius: 55, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const key = partOf(p)
        const sw = SWITCHES[key]
        if (key !== st.key) {
          st.key = key
          emptyGroup(holder)
          const toggle = key === 'toggle'
          const sy = m.pin + (toggle ? 2.15 * K_TOGGLE : 0.9 * K_TACT)
          const made = toggle ? toggleSwitch(holder, [SW1_X, sy, 0], { scale: K_TOGGLE }) : tactSwitch(holder, [SW1_X, sy, 0], { scale: K_TACT, cap: key === 'worn' ? '#5a4a3c' : '#2a2b30' })
          const a = made.pins.a
          const b = 'com' in made.pins ? made.pins.com : made.pins.b
          wire(holder, [[PX1, m.pin, 0], a])
          wire(holder, [b, [b[0], GND1, 0], [rx, GND1, 0]])
          flow = plusFlow(holder, lane([[m.x, m.v3, 0], [rx, m.v3, 0], [rx, TOP1, 0], [PX1, TOP1, 0], [PX1, m.pin, 0], a, [b[0], m.pin, 0], [b[0], GND1, 0], [rx, GND1, 0], [rx, m.gnd, 0], [m.x, m.gnd, 0]]), paint)
          part = made
          Object.assign(st, { t: 0, sweep: 0, ev: event1(sw, true, 1), counted: 0, presses: 0, edges: 0, seen: 0 })
        }
        st.t += dt / SLOW1
        if (st.t >= W1) {
          st.t -= W1
          st.sweep++
          st.ev = event1(sw, st.sweep % 2 === 0, 1 + (Math.floor(st.sweep / 2) % 5))
          st.seen = 0
          st.edges = 0
        }
        const { ev } = st
        const t = st.t
        const seen = ev.edges.filter((e) => e <= t).length
        for (let k = st.seen; k < seen; k++) {
          if (ev.press && k === 0) st.presses++
          if ((k % 2 === 0) === ev.press) {
            st.counted++
            st.edges++
          }
        }
        st.seen = seen
        live.made = ev.made(t)
        live.f = live.made ? 0 : 1
        const travel = Math.min(1, Math.max(0, (t - 0.2e-3) / (T0 - 0.2e-3)))
        const pushed = ev.press ? travel : 1 - travel
        if (part && 'tip' in part) part.set(1 - pushed, live.made ? 'a' : pushed > 0.5 ? null : 'b')
        else part?.set(pushed, live.made)

        const u = t / W1
        trace.draw((x) => vy1(ev.made(Math.min(x, u) * W1) ? 0 : VDD), u)
        if (flow) {
          flow.mesh.visible = live.made
          flow.step(dt * 3)
        }
        countLabel.show(String(st.counted % 100))
        countLabel.frame(dt)
      },
      readouts: (p) => {
        const s = SWITCHES[partOf(p)]
        return [
          { label: 'Bounce', value: ms(s.makeS) },
          { label: 'Pin', value: live.made ? 'LOW' : 'HIGH' },
          { label: 'Edges', value: String(st.edges), tone: st.edges > 1 ? 'warn' : undefined },
          { label: 'Counted', value: `${st.counted} of ${st.presses}`, tone: st.counted > st.presses ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Debouncing: an RC filter + Schmitt trigger, or a software timer, turns the burst into one clean edge. ---

type Method = 'none' | 'rc' | 'soft'
const methodOf = (p: Params): Method => (p.method === 'rc' || p.method === 'soft' ? p.method : 'none')
const W2 = 40e-3
const SLOW2 = 200
const PRESS2 = 4e-3
const RELEASE2 = 22e-3
const N2 = 2000
const SUB2 = 10
const R_DIS = 1e3
const SW2 = SWITCHES.worn
const EDGES_MAKE = bounceEdges(SW2.makeS, SW2.bounces, 3).map((e) => e + PRESS2)
const EDGES_BREAK = bounceEdges(SW2.breakS, 4, 5).map((e) => e + RELEASE2)
const made2 = (t: number) => (t < RELEASE2 ? bouncedState(t, EDGES_MAKE, false) : bouncedState(t, EDGES_BREAK, true))
const capOf = (filterS: number) => filterS / R_PULL

/** One window, steady state (run twice): input volts, contact, what code sees as pressed, the software timer. */
function cycle2(method: Method, filterS: number) {
  const dt = W2 / N2 / SUB2
  const vin = new Float32Array(N2)
  const made = new Uint8Array(N2)
  const seen = new Uint8Array(N2)
  const since = new Float32Array(N2)
  let vc = VDD
  let high = true
  let soft: Debounce = { stable: false, last: false, sinceS: 1 }
  let presses = 0
  let rise = NaN
  let fall = NaN
  for (let c = 0; c < 2; c++)
    for (let k = 0; k < N2; k++) {
      let out = false
      let closed = false
      for (let j = 0; j < SUB2; j++) {
        const t = (k * SUB2 + j) * dt
        closed = made2(t)
        if (method === 'rc') {
          vc = rcDebounceStep(vc, closed, VDD, R_PULL, R_DIS, capOf(filterS), dt)
          high = schmittHigh(high, vc, VDD)
          out = !high
        } else {
          vc = closed ? 0 : VDD
          soft = debounceStep(soft, closed, dt, filterS)
          out = method === 'soft' ? soft.stable : closed
        }
      }
      vin[k] = vc
      made[k] = closed ? 1 : 0
      since[k] = method === 'soft' ? Math.min(soft.sinceS, filterS) / filterS : 0
      if (c) {
        const was = k ? seen[k - 1] : seen[N2 - 1]
        seen[k] = out ? 1 : 0
        if (out && !was) {
          presses++
          if (Number.isNaN(rise)) rise = (k / N2) * W2 - PRESS2
        }
        if (!out && was && Number.isNaN(fall) && k / N2 > RELEASE2 / W2) fall = (k / N2) * W2 - RELEASE2
      } else seen[k] = out ? 1 : 0
    }
  return { method, filterS, vin, made, seen, since, presses, rise, fall }
}
let memo2: ReturnType<typeof cycle2> | null = null
const solve2 = (p: Params) => {
  const method = methodOf(p)
  const filterS = n(p, 'ms') * 1e-3
  if (!memo2 || memo2.method !== method || memo2.filterS !== filterS) memo2 = cycle2(method, filterS)
  return memo2
}
const lag = (s: number) => (Number.isNaN(s) ? '—' : s < 1e-6 ? '0' : ms(s))
const at2 = (a: ArrayLike<number>, u: number) => a[Math.min(N2 - 1, Math.max(0, Math.floor(u * N2)))]

const TOP2 = 5.6
const GND2 = -6
const MCU2: V3 = [3.4, -1, 0]
const SW2_X = -15
const AX = -5.2
const R2A = -10.2
const R2B = -6.8
const IC2_X = -1.6
const SC2_X = 9.6
const SC2_W = 7.2
const SC2_H = 4.8
const SC2_Y = -0.6
const LOG2_H = 1.9
const LOG2_Y = SC2_Y + SC2_H / 2 + 0.8 + LOG2_H / 2 + 0.6
const vy2 = (v: number) => (v / 4) * SC2_H - SC2_H / 2

export const debouncing: Lesson = {
  id: 'switches-buttons-debouncing',
  title: 'Debouncing',
  tagline: 'Wait for the contacts to settle',
  formula: (p) => {
    const s = solve2(p)
    const t = ms(s.filterS)
    if (s.method === 'rc') return `τ = R·C = 10 kΩ × ${si(capOf(s.filterS), 'F', 2)} = ${t}. The cap can’t follow the fast bounces; the Schmitt trigger flips at 1.8 V up, 1.0 V down, never in between`
    if (s.method === 'soft') return `Accept a new level only after it has held for ${t}: if (now − lastChange > ${t}) state = reading`
    return 'No filter: every bounce is an edge, so one press reads as many'
  },
  legend: [
    { color: '#ffffff', label: 'Input voltage, 40 ms across, slowed 200×', shape: 'dot' },
    { color: RING, label: 'Switching thresholds', shape: 'dot' },
    { color: GREY, label: 'Top: contacts touching', shape: 'dot' },
    { color: POWER, label: 'Top: what the code sees pressed', shape: 'dot' },
  ],
  points: [
    'A worn button bounces for ~6 ms. Anything that waits longer than the bounce, but shorter than a human press (≥ 50 ms), sees one clean press.',
    'Hardware: 10 kΩ pull-up and a capacitor. The closed contact drains the cap through 1 kΩ in a fraction of a ms; each short bounce barely recharges it (τ = 10 kΩ·C). A Schmitt trigger (74HC14) has two thresholds, so the slow, noisy ramp gives one clean edge. It inverts: pressed reads HIGH.',
    'Software: read the pin, and only accept a change once it has stayed put for 5–20 ms (e.g. the Bounce2 library). Costs nothing but a timer; the press is reported a little late.',
    'Too short a filter lets bounces through (try 0.1 ms); too long adds lag and can miss quick taps. 5–10 ms suits most buttons.',
    'A plain input without a Schmitt trigger and a slow RC ramp can chatter as it crosses the threshold; ESP32 inputs have a little hysteresis, not much.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'method',
      options: [
        { value: 'none', label: 'None' },
        { value: 'rc', label: 'RC + Schmitt' },
        { value: 'soft', label: 'Software' },
      ],
      initial: 'rc',
    },
    { kind: 'slider', key: 'ms', label: 'Filter time', min: 0.1, max: 20, initial: 5, log: true, format: (v) => ms(v * 1e-3) },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const m = mcu(scene, MCU2, -1)
    const lx = m.x - 0.9
    const yn = m.pin
    const sw = tactSwitch(scene, [SW2_X, yn + 0.9 * K_TACT, 0], { scale: K_TACT, cap: '#5a4a3c' })
    const { a, b } = sw.pins
    wire(scene, [[m.x, m.v3, 0], [lx, m.v3, 0], [lx, TOP2, 0], [AX, TOP2, 0], [AX, yn, 0]])
    resistorAlong(scene, R_PULL, [AX, TOP2, 0], [AX, yn, 0], 1.8)
    wire(scene, [[m.x, m.gnd, 0], [lx, m.gnd, 0], [lx, GND2, 0], [a[0], GND2, 0], a])
    wire(scene, [b, [R2A, yn, 0]])
    wire(scene, [[R2B, yn, 0], [AX, yn, 0], [IC2_X - 1.6, yn, 0]])
    wire(scene, [[IC2_X + 1.6, yn, 0], [m.x, yn, 0]])
    const node = junction(scene, [AX, yn, 0], 0.5)

    const rcParts = [add(scene, new THREE.Group(), [(R2A + R2B) / 2, yn, 0]), add(scene, new THREE.Group(), [AX, (yn + GND2) / 2, 0]), add(scene, new THREE.Group(), [IC2_X, yn, 0])]
    const [r2, cap, ic] = rcParts
    resistorAlong(r2, R_DIS, [(R2A - R2B) / 2, 0, 0], [(R2B - R2A) / 2, 0, 0], 1.4)
    const ch = (yn - GND2) / 2
    wire(cap, [[0, ch, 0], [0, -ch, 0]])
    ceramicAlong(cap, [0, ch - 0.6, 0], [0, 0.6 - ch, 0], 1)
    add(ic, icPackage(2.2, 2.6, 1))
    const bypass = add(scene, new THREE.Group())
    wire(bypass, [[R2A, yn, 0], [R2B, yn, 0]])
    wire(bypass, [[IC2_X - 1.6, yn, 0], [IC2_X + 1.6, yn, 0]])
    const timer = pulseLabel(scene, 2, POWER, [MCU2[0], MCU2[1] + 5.2, 0], 1.3)

    const analog = scope(scene, SC2_W, SC2_H, { divs: [8, 4], zeroAt: 0 })
    analog.group.position.set(SC2_X, SC2_Y, 0)
    ticks(analog, [[0, '0'], [0.5, '20'], [1, '40']], [[0, '0'], [VDD / 4, '3.3']])
    const hi = analog.level(RING)
    const lo = analog.level(RING)
    const vTrace = analog.trace('#ffffff', { samples: 500, radius: 0.07 })
    const logic = scope(scene, SC2_W, LOG2_H, { divs: [8, 2], zeroAt: 0 })
    logic.group.position.set(SC2_X, LOG2_Y, 0)
    const madeTrace = logic.trace(GREY, { samples: 500, radius: 0.06 })
    const seenTrace = logic.trace(POWER, { samples: 300, radius: 0.08 })

    const live = { fA: 1, rc: true, made: false }
    const paint = (at: THREE.Vector3) => {
      if (at.y < yn - 0.01) return 0
      if (Math.abs(at.x - AX) < 0.01 && at.y > yn) return dropAlong(at, [AX, TOP2, 0], [AX, yn, 0], 1, live.fA, 1.2 * 1.8)
      if (at.y > yn + 0.01) return 1
      return live.rc ? dropAlong(at, [AX, yn, 0], [b[0], yn, 0], live.fA, 0, 1.2 * 1.4) : live.fA
    }
    const flow = plusFlow(scene, lane([[m.x, m.v3, 0], [lx, m.v3, 0], [lx, TOP2, 0], [AX, TOP2, 0], [AX, yn, 0], [b[0], yn, 0], a, [a[0], GND2, 0], [lx, GND2, 0], [lx, m.gnd, 0], [m.x, m.gnd, 0]]), paint)
    const st = { t: 0, grow: 1, method: '' as Method | '' }

    return {
      scene,
      view: { center: [-2.4, 3.2, 0], radius: 60, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const c = solve2(p)
        if (c.method !== st.method) {
          st.method = c.method
          st.t = 0
        }
        live.rc = c.method === 'rc'
        st.grow += ((live.rc ? 1 : 0) - st.grow) * ease(dt, 6)
        for (const o of rcParts) presence(o, st.grow)
        bypass.visible = st.grow < 0.5
        hi.set(vy2((live.rc ? SCHMITT_HI : VIH) * VDD))
        lo.set(vy2((live.rc ? SCHMITT_LO : VIL) * VDD))
        hi.group.visible = lo.group.visible = c.method !== 'none'

        st.t = (st.t + dt / SLOW2) % W2
        const u = st.t / W2
        const t = st.t
        live.made = made2(t)
        live.fA = at2(c.vin, u) / VDD
        node.set(live.fA)
        const travel = (t0: number) => Math.min(1, Math.max(0, (t - t0 + 1e-3) / 1e-3))
        sw.set(travel(PRESS2) - travel(RELEASE2), live.made)
        const upTo = (arr: ArrayLike<number>, x: number) => at2(arr, Math.min(x, u))
        vTrace.draw((x) => vy2(upTo(c.vin, x)), u)
        madeTrace.draw((x) => (upTo(c.made, x) ? 0.25 : 0.05) * LOG2_H - LOG2_H / 2, u)
        seenTrace.draw((x) => (upTo(c.seen, x) ? 0.88 : 0.55) * LOG2_H - LOG2_H / 2, u)
        flow.mesh.visible = live.made
        flow.step(dt * 3)
        timer.display.group.visible = c.method === 'soft'
        timer.show(String(Math.round(at2(c.since, u) * c.filterS * 1e3)))
        timer.frame(dt)
      },
      readouts: (p) => {
        const c = solve2(p)
        return [
          { label: 'Presses seen', value: `${c.presses} of 1`, tone: c.presses === 1 ? 'ok' : 'bad' },
          { label: 'Press lag', value: lag(c.rise) },
          { label: 'Release lag', value: lag(c.fall) },
          { label: c.method === 'rc' ? 'C' : 'Filter', value: c.method === 'rc' ? si(capOf(c.filterS), 'F', 2) : c.method === 'soft' ? ms(c.filterS) : 'None' },
        ]
      },
    }
  },
}

// --- Toggle vs momentary: a toggle holds its state mechanically, a button only while pressed; code can make a button toggle. ---

type Kind = 'momentary' | 'toggle' | 'latch'
const kindOf = (p: Params): Kind => (p.kind === 'toggle' || p.kind === 'latch' ? p.kind : 'momentary')
const LOOP3 = 8
const ACTIONS: [number, number][] = [[0.5, 0.95], [2.2, 4.4], [5.2, 5.6], [6.6, 7.1]]
const FLICK = 0.25
const R_LED = 220
const LED3 = LEDS.red
const LED_A = ledStringAmps(VDD, R_LED, LED3)
const pressAt = (t: number) => Math.max(0, ...ACTIONS.map(([a, b]) => Math.min(1, Math.max(0, Math.min((t - a) / 0.12, (b - t) / 0.12)))))
const flips = (t: number) => ACTIONS.filter(([a]) => a <= t).length
const throwAt = (t: number) => {
  const k = flips(t)
  const last = k ? ACTIONS[k - 1][0] : -1
  const to = k % 2
  return k && t - last < FLICK ? lerp(1 - to, to, (t - last) / FLICK) : to
}
/** Contact made, and the LED, at loop time `t`. */
function state3(kind: Kind, t: number) {
  if (kind === 'toggle') {
    const made = throwAt(t) > 0.5
    return { made, led: made }
  }
  const made = pressAt(t) > 0.6
  const latched = ACTIONS.filter(([a]) => a + 0.08 <= t).reduce((on) => latchToggle(on, false, true), false)
  return { made, led: kind === 'latch' ? latched : made }
}

const MCU3: V3 = [-4.2, -1, 0]
const SW3_X = -13
const GND3 = -6
const LED_X = 4.6
const SC3: V3 = [11.8, 0.6, 0]
const SC3_W = 6.4
const SC3_H = 4.4
const SKIN = '#e2b08f'
const LED_K = 1.1
const LEG = LED_K / 2

export const toggleVsMomentary: Lesson = {
  id: 'switches-buttons-toggle-vs-momentary',
  title: 'Toggle vs momentary',
  tagline: 'Does it remember, or only while you hold it?',
  formula: (p) => {
    const k = kindOf(p)
    if (k === 'toggle') return 'Toggle: each flick moves the contacts and they stay. LED = switch position'
    if (k === 'latch') return 'Button + code: on each new press, led = !led. The state lives in RAM, not in the switch'
    return 'Momentary: contacts close only while held. LED = button held'
  },
  legend: [
    { color: GREY, label: 'Finger on it, 8 s across', shape: 'dot' },
    { color: POWER, label: 'Contacts closed', shape: 'dot' },
    { color: LED3.color, label: 'LED on (GPIO → 220 Ω → LED)', shape: 'dot' },
  ],
  points: [
    'Momentary switches (tactile buttons, microswitches) spring back: closed only while pressed. Most are normally open (NO); normally closed (NC) ones open while pressed, e.g. for stop buttons.',
    'Latching switches (toggle, rocker, slide) stay where you put them. This MTS-102 is SPDT: single pole, double throw, so COM goes to one of two lugs (on-on). SPST is plain on-off; DPDT switches two circuits at once.',
    'Code can turn a button into a toggle: on each new press (debounced!), flip a variable. Bouncing would flip it several times, so the result would be random.',
    'The difference shows at power-up: a toggle still says where it is; a code toggle forgets unless saved (ESP32 NVS / Preferences).',
    'Ratings matter: a 6 mm tact switch handles ~50 mA at 12 V, logic only; an MTS-102 toggle 6 A at 125 VAC, so it can switch a load directly.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'kind',
      options: [
        { value: 'momentary', label: 'Button' },
        { value: 'toggle', label: 'Toggle' },
        { value: 'latch', label: 'Button + code' },
      ],
      initial: 'momentary',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    const m = mcu(scene, MCU3, -1)
    const lx = m.x - 0.9
    const out = MCU3[0] + 1.7 + 0.85
    const ledAt: V3 = [LED_X, m.pin, 0]
    const lamp = ledLamp(scene, LED3.color, ledAt, { scale: LED_K, anodeRight: false })
    const rA: V3 = [out + 0.6, m.pin, 0]
    const rB: V3 = [LED_X - 1.8, m.pin, 0]
    wire(scene, [[out, m.pin, 0], rA])
    resistorAlong(scene, R_LED, [out + 0.6, m.pin, 0], [LED_X - 1.8, m.pin, 0], 1.3)
    wire(scene, [rB, [LED_X - LEG, m.pin, 0]])
    wire(scene, [[LED_X + LEG, m.pin, 0], [LED_X + 2, m.pin, 0], [LED_X + 2, m.gnd, 0], [out, m.gnd, 0]])
    wire(scene, [[m.x, m.gnd, 0], [lx, m.gnd, 0], [lx, GND3, 0]])
    const holder = add(scene, new THREE.Group())
    const finger = add(scene, new THREE.Group())
    const tip = add(finger, mesh(new THREE.CapsuleGeometry(0.85, 3.4, 8, 20), mat(SKIN, { rough: 0.7 })), [0, 2.55, 0])
    tip.castShadow = true
    add(finger, mesh(new THREE.SphereGeometry(0.62, 16, 10), mat('#f3d6c6', { rough: 0.4 })), [0, 1.0, 0.45]).scale.set(1, 1.3, 0.35)

    const plot = scope(scene, SC3_W, SC3_H, { divs: [8, 3], zeroAt: 0 })
    plot.group.position.set(...SC3)
    ticks(plot, [[0, '0'], [0.5, '4'], [1, '8']], [])
    const lane3 = (f: number) => (f * SC3_H) / 3 - SC3_H / 2
    const fingerTrace = plot.trace(GREY, { samples: 320, radius: 0.07 })
    const madeTrace = plot.trace(POWER, { samples: 320, radius: 0.07 })
    const ledTrace = plot.trace(LED3.color, { samples: 320, radius: 0.08 })

    const live = { made: false, led: false }
    const paintIn = (at: THREE.Vector3) => (at.y < m.pin - 0.01 ? 0 : live.made ? 0 : 1)
    const paintOut = (at: THREE.Vector3) => (at.y < m.pin - 0.01 || at.x > LED_X + 0.5 ? 0 : at.x > LED_X - 0.6 ? 0.6 : dropAlong(at, [out, m.pin, 0], [LED_X - LEG, m.pin, 0], 1, 0.6, 1.2 * 1.3))
    const ledFlow = plusFlow(scene, lane([[out, m.pin, 0], [LED_X - LEG, m.pin, 0], [LED_X, m.pin + 1.2, 0], [LED_X + LEG, m.pin, 0], [LED_X + 2, m.pin, 0], [LED_X + 2, m.gnd, 0], [out, m.gnd, 0]]), paintOut)
    let part: ReturnType<typeof tactSwitch> | ReturnType<typeof toggleSwitch> | null = null
    let inFlow: ReturnType<typeof plusFlow> | null = null
    const st = { kind: '' as Kind | '', t: 0, glow: 0 }

    return {
      scene,
      view: { center: [-1.4, 3.2, 0], radius: 58, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const kind = kindOf(p)
        if (kind !== st.kind) {
          st.kind = kind
          st.t = 0
          emptyGroup(holder)
          const toggle = kind === 'toggle'
          const sy = m.pin + (toggle ? 2.15 : 0.9 * K_TACT)
          const made = toggle ? toggleSwitch(holder, [SW3_X, sy, 0], { scale: 1 }) : tactSwitch(holder, [SW3_X, sy, 0], { scale: K_TACT })
          const pin = made.pins.b
          const gnd = 'com' in made.pins ? made.pins.com : made.pins.a
          wire(holder, [pin, [lx, m.pin, 0], [m.x, m.pin, 0]])
          wire(holder, [gnd, [gnd[0], GND3, 0], [lx, GND3, 0]])
          inFlow = plusFlow(holder, lane([[m.x, m.pin, 0], pin, gnd, [gnd[0], GND3, 0], [lx, GND3, 0], [lx, m.gnd, 0], [m.x, m.gnd, 0]]), paintIn)
          part = made
        }
        st.t = (st.t + dt) % LOOP3
        const t = st.t
        const s = state3(kind, t)
        Object.assign(live, s)
        const press = pressAt(t)
        if (part && 'tip' in part) {
          const u = throwAt(t)
          part.set(u, s.made ? 'b' : 'a')
          const k = flips(t)
          const pushing = k > 0 && t - ACTIONS[k - 1][0] < FLICK + 0.35
          const side = k % 2 ? 1 : -1
          const at = part.tip(u)
          finger.position.set(at[0] + side * 0.45, at[1] - 0.2, at[2])
          finger.rotation.z = (-side * Math.PI) / 2
          presence(finger, pushing ? 1 : 0)
        } else if (part) {
          part.set(press, s.made)
          finger.rotation.z = 0
          finger.position.set(part.top[0], part.top[1] - 0.5 * K_TACT * press + 2.4 * (1 - Math.min(1, press * 3)), part.top[2] + 0.2)
          presence(finger, Math.min(1, press * 4 + (press > 0 ? 0.2 : 0)))
        }
        st.glow += ((s.led ? 1 : 0) - st.glow) * ease(dt, 20)
        lamp.set((st.glow * LED_A) / LED_RATED_A)
        lamp.step(dt)
        ledFlow.mesh.visible = s.led
        ledFlow.step(dt * 300 * LED_A)
        if (inFlow) {
          inFlow.mesh.visible = s.made
          inFlow.step(dt * 2)
        }
        const u = t / LOOP3
        const upTo = (x: number) => Math.min(x, u) * LOOP3
        fingerTrace.draw((x) => lane3(2.15 + 0.6 * pressAt(upTo(x)) + (kind === 'toggle' && flips(upTo(x)) && upTo(x) - ACTIONS[flips(upTo(x)) - 1][0] < FLICK ? 0.6 : 0) * (1 - pressAt(upTo(x)))), u)
        madeTrace.draw((x) => lane3(1.15 + 0.6 * Number(state3(kind, upTo(x)).made)), u)
        ledTrace.draw((x) => lane3(0.15 + 0.6 * Number(state3(kind, upTo(x)).led)), u)
      },
      readouts: (p) => {
        const k = kindOf(p)
        return [
          { label: 'Switch', value: k === 'toggle' ? 'SPDT toggle' : 'Tact (NO)' },
          { label: 'Contacts', value: live.made ? 'Closed' : 'Open' },
          { label: 'LED', value: live.led ? si(LED_A, 'A', 2) : 'Off', tone: live.led ? 'ok' : undefined },
          { label: 'Power cut', value: k === 'toggle' ? 'Stays put' : k === 'latch' ? 'Forgets' : 'n/a' },
        ]
      },
    }
  },
}
