import * as THREE from 'three/webgpu'
import {
  BridgeMode,
  Closed,
  DECAY,
  DRIVERS,
  Decay,
  DriverChip,
  HBRIDGE,
  HSwitch,
  LEG,
  RPM_PER_RADS,
  TT_MOTOR,
  bridgeAmps,
  bridgeRun,
  closed,
  decayCurrent,
  decaySpeed,
  driverLoss,
  freeSpeed,
  legAt,
  motorK,
  safeDeadNs,
  shootThrough,
  stopTime,
} from '../../core/physics'
import { msText } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { buildL298n } from '../../models/modules'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  CODE_LEGEND,
  GREY,
  HEAT,
  HIGH_V,
  IDLE,
  LABEL,
  PIN_COLOR,
  POWER,
  RING,
  addLabel,
  brushedMotor,
  cell,
  codeBlock,
  cursorBar,
  diodeSymbol,
  fetSymbol,
  glowMat,
  heatGlow,
  heatWaves,
  lane,
  lit,
  litWire,
  liveLabel,
  loopBeads,
  memoBy,
  meterBar,
  scope,
  setGlow,
  simClock,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const rpm = (radS: number) => Math.round(radS * RPM_PER_RADS)
const SW: HSwitch[] = ['q1', 'q2', 'q3', 'q4']

// --- Shared H diagram: Q1/Q2 left leg, Q3/Q4 right leg (P-FET high, N-FET low), motor across the middle. ---

const LX = 7
const TOP = 7
const CX = -13
const DX = 2.8
const PIN = 2.02
type Route = 'fwd' | 'rev' | 'brakeLo' | 'brakeHi' | 'shootL' | 'shootR' | 'fastOff' | 'diodeLo'
const IN_CELL: V3[] = [[CX, 2.9, 0], [CX, TOP, 0]]
const OUT_CELL: V3[] = [[CX, -TOP, 0], [CX, -2.6, 0]]
const ROUTES: Record<Route, V3[]> = {
  fwd: [...IN_CELL, [-LX, TOP, 0], [-LX, 0, 0], [LX, 0, 0], [LX, -TOP, 0], ...OUT_CELL],
  rev: [...IN_CELL, [LX, TOP, 0], [LX, 0, 0], [-LX, 0, 0], [-LX, -TOP, 0], ...OUT_CELL],
  brakeLo: [[-LX, 0, 0], [LX, 0, 0], [LX, -TOP, 0], [-LX, -TOP, 0]],
  brakeHi: [[-LX, 0, 0], [LX, 0, 0], [LX, TOP, 0], [-LX, TOP, 0]],
  shootL: [...IN_CELL, [-LX, TOP, 0], [-LX, -TOP, 0], ...OUT_CELL],
  shootR: [...IN_CELL, [LX, TOP, 0], [LX, -TOP, 0], ...OUT_CELL],
  fastOff: [[-LX, 0, 0], [LX, 0, 0], [LX + DX, 0, 0], [LX + DX, TOP, 0], [CX, TOP, 0], [CX, 2.9, 0], [CX, -2.6, 0], [CX, -TOP, 0], [-LX + DX, -TOP, 0], [-LX + DX, 0, 0]],
  diodeLo: [[-LX, 0, 0], [LX, 0, 0], [LX, -TOP, 0], [-LX + DX, -TOP, 0], [-LX + DX, 0, 0]],
}

/** The H at `at`, scaled by `s`: `fets` light per switch, `route(key, level, color)` lights a current path, beads ride it. */
function hDiagram(scene: THREE.Object3D, at: V3, s: number, { volts = HBRIDGE.vs, diodes = false } = {}) {
  const g = add(scene, new THREE.Group(), at)
  g.scale.setScalar(s)
  add(g, cell(5, 1.5), [CX, 0, 0])
  wire(g, [[CX, 2.9, 0], [CX, TOP, 0], [LX, TOP, 0]], 0.2)
  wire(g, [[CX, -2.6, 0], [CX, -TOP, 0], [LX, -TOP, 0]], 0.2)
  addLabel(g, `+${volts} V`, [CX - 0.4, TOP + 1, 0.3], HIGH_V, 0.7, 'left')
  addLabel(g, '0 V', [CX - 0.4, -TOP - 1, 0.3], GREY, 0.7, 'left')
  const fets = {
    q1: fetSymbol(g, [-LX, TOP, 0], [-LX, 0, 0], 'P', 'Q1'),
    q2: fetSymbol(g, [-LX, 0, 0], [-LX, -TOP, 0], 'N', 'Q2'),
    q3: fetSymbol(g, [LX, TOP, 0], [LX, 0, 0], 'P', 'Q3'),
    q4: fetSymbol(g, [LX, 0, 0], [LX, -TOP, 0], 'N', 'Q4'),
  }
  const dots = SW.map((k) => {
    const m = glowMat(IDLE, 0.4)
    add(g, mesh(new THREE.SphereGeometry(0.42, 16, 12), m), fets[k].gate)
    return m
  })
  if (diodes)
    for (const x of [-LX, LX])
      for (const sy of [1, -1]) {
        const dx = x + DX
        const d = add(g, diodeSymbol(1.2, '#c9ced8'), [dx, (sy * TOP) / 2, 0])
        d.rotation.z = Math.PI / 2
        wire(g, [[dx, (sy * TOP) / 2 + 1.2, 0], [dx, sy > 0 ? TOP : 0, 0], [x, sy > 0 ? TOP : 0, 0]], 0.14)
        wire(g, [[dx, (sy * TOP) / 2 - 1.2, 0], [dx, sy > 0 ? 0 : -TOP, 0], [x, sy > 0 ? 0 : -TOP, 0]], 0.14)
      }
  wire(g, [[-LX, 0, 0], [-PIN, 0, 0], [-PIN, 0, 1.56]], 0.2)
  wire(g, [[LX, 0, 0], [PIN, 0, 0], [PIN, 0, 1.56]], 0.2)
  const motor = brushedMotor(g, [0, 0, 0], 1.3)
  motor.group.rotation.z = Math.PI / 2
  const glows = Object.fromEntries((Object.keys(ROUTES) as Route[]).map((k) => [k, litWire(g, ROUTES[k], 0.34)])) as Record<Route, ReturnType<typeof litWire>>
  const beads = { motor: loopBeads(g, 16, HEAT, { r: 0.26 }), short: loopBeads(g, 16, HIGH_V, { r: 0.26 }) }
  const on = { motor: '', short: '' }
  return {
    g,
    motor,
    /** Switch states 0..1 with heat 0..1, gate dots lit when driven. */
    set(c: Record<HSwitch, number>, heat: Partial<Record<HSwitch, number>> = {}) {
      SW.forEach((k, i) => {
        fets[k].set(c[k], heat[k] ?? 0)
        setGlow(dots[i], c[k] > 0.5 ? PIN_COLOR : IDLE, c[k] > 0.5 ? 1.2 : 0.4)
      })
    },
    /** Lit routes this frame, `[route, level 0..1, colour]`. */
    routes(list: [Route, number, string][]) {
      for (const k of Object.keys(glows) as Route[]) {
        const hit = list.find((r) => r[0] === k)
        glows[k].set(hit ? hit[1] : 0, lit(hit ? hit[2] : HEAT))
      }
    },
    /** Beads on route `r` (null hides them), moved by `du` of the loop. */
    flow(kind: 'motor' | 'short', r: Route | null, du: number) {
      const b = beads[kind]
      b.show(r !== null)
      if (r === null) return
      if (on[kind] !== r) {
        b.setPath(lane(ROUTES[r], 0.9))
        on[kind] = r
      }
      b.step(du)
    },
  }
}

// --- Four switches: close two diagonal switches to drive, two on one side to brake, none to coast; never two in one leg. ---

const COMBOS = {
  fwd: 'Q1 + Q4: forward',
  rev: 'Q3 + Q2: reverse',
  brakeLo: 'Q2 + Q4: brake (low side)',
  brakeHi: 'Q1 + Q3: brake (high side)',
  coast: 'All open: coast',
  shootL: 'Q1 + Q2: shoot-through',
  all: 'All four: short',
}
type Combo = keyof typeof COMBOS
const CLOSED: Record<Combo, Closed> = {
  fwd: closed('q1', 'q4'),
  rev: closed('q3', 'q2'),
  brakeLo: closed('q2', 'q4'),
  brakeHi: closed('q1', 'q3'),
  coast: closed(),
  shootL: closed('q1', 'q2'),
  all: closed('q1', 'q2', 'q3', 'q4'),
}
const CODE: Record<Combo, string[]> = {
  fwd: ['// OUT1 high, OUT2 low: Q1 + Q4', 'digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);', 'digitalWrite(ENA, HIGH);'],
  rev: ['// OUT1 low, OUT2 high: Q3 + Q2', 'digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH);', 'digitalWrite(ENA, HIGH);'],
  brakeLo: ['// both outputs low: Q2 + Q4 short the motor', 'digitalWrite(IN1, LOW); digitalWrite(IN2, LOW);', 'digitalWrite(ENA, HIGH);  // EN high = brake'],
  brakeHi: ['// both outputs high: Q1 + Q3 short the motor', 'digitalWrite(IN1, HIGH); digitalWrite(IN2, HIGH);', 'digitalWrite(ENA, HIGH);'],
  coast: ['// EN low: all four off, the motor freewheels', 'digitalWrite(ENA, LOW);', ''],
  shootL: ['// no IN1 / IN2 / ENA pattern can do this:', '// each IN drives one leg high OR low, never both', '// only separate gate pins (discrete FETs) can'],
  all: ['// no IN1 / IN2 / ENA pattern can do this:', '// each IN drives one leg high OR low, never both', '// only separate gate pins (discrete FETs) can'],
}
const MODE_TEXT: Record<BridgeMode, [string, string]> = {
  forward: ['Forward: + on the left brush, current left → right', POWER],
  reverse: ['Reverse: same motor, current right → left', POWER],
  brake: ['Brake: motor shorted, its own back-EMF drives a braking current', B_FIELD],
  coast: ['Coast: no path, only friction slows it', GREY],
  shoot: ['Forbidden: a leg shorts the battery, nothing reaches the motor', HIGH_V],
}
const RUN = { ms: 600, slow: 15, draw: 151 }
const runOf = memoBy((c: Combo) => c, (c: Combo) => bridgeRun(CLOSED[c], RUN.ms / 1000))
const FREE = freeSpeed(HBRIDGE.vs)
const RDS = HBRIDGE.rdsOhm
const RM = TT_MOTOR.ohms + 2 * RDS

export const fourSwitches: Lesson = {
  id: 'h-bridge-four-switches',
  title: 'Four switches',
  tagline: 'Forward, reverse, brake, coast: and two combos that short the battery',
  formula: (p) => {
    const c = pick(COMBOS, p.combo, 'fwd')
    const a = bridgeAmps(CLOSED[c], 0)
    if (a.mode === 'shoot') return `Leg short: I = V / (2·Rds + R_loop) = ${HBRIDGE.vs} / (${2 * RDS} + ${HBRIDGE.loopOhm}) = ${a.shootA.toFixed(1)} A`
    return `I = (±V − kω) / (R + 2·Rds) · start: ${HBRIDGE.vs} / ${RM} = ${(HBRIDGE.vs / RM).toFixed(2)} A · brake: −kω / ${RM} · coast: 0`
  },
  legend: [
    { color: HEAT, label: 'Motor current', shape: 'dot' },
    { color: HIGH_V, label: 'Short through a leg', shape: 'dot' },
    { color: PIN_COLOR, label: 'Gate driven (switch closed)', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'A motor turns one way or the other depending on which terminal is +. An H-bridge gets both from one supply: two legs, each a high switch (to +) and a low switch (to 0 V), with the motor across the middle like the bar of an H.',
    'Close Q1 and Q4 and current runs left to right through the motor: forward. Close Q3 and Q2 instead and it runs right to left: reverse. Only a diagonal pair drives.',
    'Close both low switches (or both high) and the motor terminals are tied together. A spinning motor is a generator, so its back-EMF drives current round that loop against its own motion: a brake, stopping it about 3× faster than coasting with everything open.',
    'Close both switches in one leg and the battery sees two small on-resistances and nothing else: tens of amps, hot switches, a sagging supply, and nothing for the motor. That is shoot-through, the one thing an H-bridge must never do.',
    'Driver chips (L298N, TB6612) take one input per leg: IN high turns that leg\'s high switch on and its low one off, so the forbidden pattern cannot be written in code. Discrete FET bridges with a pin per gate can, which is why their firmware is careful.',
  ],
  controls: [{ kind: 'choice', key: 'combo', options: opts(COMBOS), initial: 'fwd' }],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const h = hDiagram(scene, [-8.6, 1.6, 0], 0.66)
    const waves = heatWaves(h.g, 1.6, { count: 3, rise: 4 })
    waves.group.position.set(-LX + 1.6, 1.2, 0.6)
    const speedTag = liveLabel(scene, [-8.6, -4.3, 0.3], { size: 0.36 })
    const modeTag = liveLabel(scene, [-2, -5.6, 0.3], { size: 0.44 })

    const plot = scope(scene, 9, 6, { divs: [6, 4], zeroAt: 0.5 })
    plot.group.position.set(6.4, 2.4, 0)
    const yOf = (u: number) => (u / 2) * plot.height
    const tr = { w: plot.trace(B_FIELD, { samples: RUN.draw, radius: 0.08 }), i: plot.trace(HEAT, { samples: RUN.draw, radius: 0.08 }) }
    const cur = cursorBar(plot, LABEL)
    addLabel(scene, `speed ±${rpm(FREE)} rpm · I ±1.2 A · 0…${RUN.ms} ms`, [6.4, -1.3, 0.3], GREY, 0.32)
    addLabel(scene, 'speed', [2, 6.2, 0.3], B_FIELD, 0.4, 'left')
    addLabel(scene, 'current', [4.8, 6.2, 0.3], HEAT, 0.4, 'left')
    const result = liveLabel(scene, [6.4, -2.5, 0.3], { size: 0.36 })
    const code = codeBlock(scene, [-15, -7.1, 0], 0.36, 3)

    const clock = simClock(RUN.slow / 1000, 2)
    const st = { t: 0, key: '', angle: 0 }
    const frameAt = (c: Combo, t: number) => {
      const run = runOf(c)
      return run[Math.min(run.length - 1, Math.round((t * 1000) / ((RUN.ms / (run.length - 1)) || 1)))]
    }
    return {
      scene,
      view: { center: [-2, -0.4, 0], radius: 55, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const c = pick(COMBOS, p.combo, 'fwd')
        const sw = CLOSED[c]
        const a = bridgeAmps(sw, 0)
        const t = clock(dt, c, RUN.ms) / 1000
        st.t = t
        if (c !== st.key) {
          st.key = c
          const run = runOf(c)
          const us = Array.from({ length: RUN.draw }, (_, k) => k / (RUN.draw - 1))
          const fr = us.map((u) => run[Math.round(u * (run.length - 1))])
          tr.w.points(us, fr.map((f) => yOf(f.radS / FREE)))
          tr.i.points(us, fr.map((f) => yOf(f.motorA / 1.2)))
          code(CODE[c])
        }
        cur(t / (RUN.ms / 1000))
        const f = frameAt(c, t)
        const short = a.mode === 'shoot'
        h.set(
          { q1: +sw.q1, q2: +sw.q2, q3: +sw.q3, q4: +sw.q4 },
          short ? { q1: +(sw.q1 && sw.q2), q2: +(sw.q1 && sw.q2), q3: +(sw.q3 && sw.q4), q4: +(sw.q3 && sw.q4) } : {},
        )
        st.angle += (dt * f.radS) / RUN.slow / 10
        const level = Math.min(1, Math.abs(f.motorA) / 1.2)
        h.motor.set(st.angle, level)
        const motorRoute: Route | null = a.mode === 'forward' ? 'fwd' : a.mode === 'reverse' ? 'rev' : a.mode === 'brake' ? (sw.q2 ? 'brakeLo' : 'brakeHi') : null
        h.routes([
          ...(motorRoute ? [[motorRoute, Math.min(1, 0.25 + level), HEAT] as [Route, number, string]] : []),
          ...(sw.q1 && sw.q2 ? [['shootL', 1, HIGH_V] as [Route, number, string]] : []),
          ...(sw.q3 && sw.q4 ? [['shootR', 1, HIGH_V] as [Route, number, string]] : []),
        ])
        const loop = motorRoute === 'brakeLo' || motorRoute === 'brakeHi' ? 1.6 : 1
        h.flow('motor', motorRoute && Math.abs(f.motorA) > 0.01 ? motorRoute : null, (dt * f.motorA * 0.5 * loop) / 1.2)
        h.flow('short', short ? 'shootL' : null, dt * 0.9)
        waves.step(dt, short ? 1 : 0)
        speedTag.set(`${rpm(f.radS)} rpm · rotor drawn ${RUN.slow * 10}× slower`, GREY)
        modeTag.set(...MODE_TEXT[a.mode])
        const stop = stopTime(runOf(c))
        result.set(
          short
            ? `${a.shootA.toFixed(1)} A from the battery, ${a.fetW.toFixed(0)} W in each switch`
            : a.mode === 'brake' || a.mode === 'coast'
              ? `From full speed: stopped in ${msText(stop)}`
              : `Full speed in ~${msText(runOf(c).find((x) => Math.abs(x.radS) > 0.95 * FREE)?.t ?? 0)}`,
          short ? HIGH_V : LABEL,
        )
      },
      readouts: (p) => {
        const c = pick(COMBOS, p.combo, 'fwd')
        const a = bridgeAmps(CLOSED[c], 0)
        const f = frameAt(c, st.t)
        return [
          { label: 'Sim time', value: `${msText(st.t)} (${RUN.slow}× slower)` },
          { label: 'Speed', value: `${rpm(f.radS)} rpm` },
          { label: 'Motor current', value: `${f.motorA.toFixed(2)} A` },
          { label: 'Supply short', value: a.shootA ? `${a.shootA.toFixed(1)} A` : 'none', tone: a.shootA ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- L298N vs modern drivers: two bipolar drops vs two small on-resistances at the same motor current. ---

const MODERN = { tb6612: 'TB6612FNG', drv8833: 'DRV8833' }
type Modern = keyof typeof MODERN
const DRIVER_CODE: Record<DriverChip, string[]> = {
  l298n: ['digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);', 'ledcWrite(ENA, duty);  // 3 pins per motor'],
  tb6612: ['digitalWrite(STBY, HIGH); digitalWrite(AIN1, HIGH);', 'digitalWrite(AIN2, LOW); ledcWrite(PWMA, duty);'],
  drv8833: ['ledcWrite(IN1, duty); ledcWrite(IN2, 0);', '// 2 pins per motor: PWM straight on the inputs'],
}
const BOARD_COLOR: Record<Modern, string> = { tb6612: '#1f4fa0', drv8833: '#5a2a82' }
const driverParams = (p: Params) => {
  const chip = pick(MODERN, p.chip, 'tb6612')
  const amps = n(p, 'amps')
  const vs = n(p, 'volts')
  return { chip, amps, vs, old: driverLoss('l298n', amps, vs), modern: driverLoss(chip, amps, vs) }
}

/** Small breakout board, chip on top; returns the chip material for heat glow. */
function breakout(parent: THREE.Object3D, at: V3, color: string) {
  const g = add(parent, new THREE.Group(), at)
  box(g, [7, 0.4, 5], mat(color, { rough: 0.5 }), [0, 0.2, 0])
  const chip = new THREE.MeshStandardMaterial({ color: '#1b1c20', roughness: 0.6 })
  box(g, [2.2, 0.4, 1.8], chip, [0, 0.6, 0])
  for (const z of [-2, 2]) for (let k = 0; k < 8; k++) cylinder(g, 0.18, 0.5, mat('#d4b25a', { metal: 0.4, rough: 0.35 }), [-2.8 + k * 0.8, 0.6, z], 'y', 8)
  for (let k = 0; k < 6; k++) for (const s of [-1, 1]) box(g, [0.12, 0.06, 0.3], mat('#c9ced8'), [-0.6 + k * 0.24, 0.43, s * 1.05])
  return { g, chip }
}

export const l298nVsModernDrivers: Lesson = {
  id: 'h-bridge-l298n-vs-modern-drivers',
  title: 'L298N vs modern drivers',
  tagline: 'Two bipolar drops of heat vs a fraction of an ohm',
  formula: (p) => {
    const { chip, amps, vs, old, modern } = driverParams(p)
    return `L298N: V_motor = ${vs} − ${old.drop.toFixed(2)} = ${old.motorV.toFixed(2)} V, P = ${old.drop.toFixed(2)}·${amps} = ${old.lossW.toFixed(2)} W · ${DRIVERS[chip].name}: ${vs} − ${modern.drop.toFixed(2)} V, P = ${modern.lossW.toFixed(2)} W`
  },
  legend: [
    { color: POWER, label: 'Volts reaching the motor', shape: 'dot' },
    { color: HEAT, label: 'Heat in the driver', shape: 'dot' },
    { color: HIGH_V, label: 'Over the chip\'s rating', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'The L298N (1990s, still on every starter kit) switches with bipolar transistors. A saturated BJT never gets below a few tenths of a volt, and current passes through two of them (high + low, the high one a Darlington): about 1.4 V + 0.6 V per amp gone before the motor sees anything.',
    'At a TT motor\'s 0.5–1 A that is 1.7–2 V of a 7.4 V pack: a quarter of the battery turned into heat, which is why the module wears a big finned heatsink and the motors feel weak on it.',
    'MOSFET bridges (TB6612FNG, DRV8833) behave like small resistors when on: R_ds(on) ≈ 0.5 Ω and 0.36 Ω for the high + low pair. At 1 A that is 0.36–0.5 V and a few hundred mW: no heatsink, smaller board, more speed from the same pack.',
    'The catch is current: they are rated 1.2 A (TB6612) and 1.5 A (DRV8833) per channel continuously, vs 2 A for the L298N. Heat goes as I²·R, so near the limit a tiny package warms fast; stall currents need checking (see DC motor → Stall current).',
    'In firmware only the driver layer changes: L298N wants IN1/IN2 + PWM on ENA, TB6612 adds STBY, DRV8833 takes PWM on its inputs. The app code calling motor.set(speed) stays the same (see Firmware structure → Hardware abstraction).',
  ],
  controls: [
    { kind: 'choice', key: 'chip', options: opts(MODERN), initial: 'tb6612' },
    { kind: 'slider', key: 'amps', label: 'Motor current', min: 0.1, max: 2, step: 0.05, initial: 0.8, format: (v: number) => `${v.toFixed(2)} A` },
    { kind: 'slider', key: 'volts', label: 'Pack', min: 6, max: 12, step: 0.2, initial: 7.4, format: (v: number) => `${v.toFixed(1)} V` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const l298 = add(scene, buildL298n(), [-8, -1.4, 0])
    l298.scale.setScalar(0.5)
    l298.rotation.x = 0.45
    const boards = (Object.keys(MODERN) as Modern[]).map((k) => {
      const b = breakout(scene, [8, -0.4, 0], BOARD_COLOR[k])
      b.g.rotation.x = 0.45
      b.g.scale.setScalar(0.7)
      return { k, ...b }
    })
    const sides = [-8, 8].map((x) => {
      const waves = heatWaves(scene, 3, { count: 4, rise: 2.6 })
      waves.group.position.set(x, x < 0 ? 1.8 : 0.6, 0)
      return { waves, name: liveLabel(scene, [x, 6.4, 0.3], { size: 0.46 }), heat: liveLabel(scene, [x, 5.5, 0.3], { size: 0.42 }) }
    })
    const bars = [-7.4, -9.2].map((y) => meterBar(scene, [-9, y, 0], 9, 12, [], ''))
    const barNames = [-7.4, -9.2].map((y) => liveLabel(scene, [-9.8, y, 0.3], { size: 0.5, align: 'right' }))
    const codes = [codeBlock(scene, [-14.4, -4.6, 0], 0.28, 2), codeBlock(scene, [2.2, -4.6, 0], 0.28, 2)]
    const st = { temps: [25, 25] }
    return {
      scene,
      view: { center: [0, -1.4, 0], radius: 56, polar: 1.42, azimuth: 0.08 },
      frame(dt, p) {
        const q = driverParams(p)
        for (const b of boards) b.g.visible = b.k === q.chip
        const rows = [
          { chip: 'l298n' as DriverChip, r: q.old },
          { chip: q.chip as DriverChip, r: q.modern },
        ]
        rows.forEach(({ chip, r }, i) => {
          const s = sides[i]
          const d = DRIVERS[chip]
          st.temps[i] += (r.tempC - st.temps[i]) * Math.min(1, dt * 1.5)
          const hot = Math.min(1, (st.temps[i] - 25) / 100)
          s.waves.step(dt, Math.max(0, (st.temps[i] - 30) / 80))
          s.name.set(`${d.name} · ${d.switches}`, LABEL)
          s.heat.set(`${r.lossW.toFixed(2)} W → ${Math.round(st.temps[i])} °C`, r.overA ? HIGH_V : hot > 0.4 ? HEAT : POWER)
          bars[i](r.motorV, `${r.motorV.toFixed(2)} V (${Math.round(r.efficiency * 100)} %)`, r.overA ? HIGH_V : POWER)
          barNames[i].set(d.name, LABEL)
          codes[i](DRIVER_CODE[chip])
        })
        heatGlow(boards.find((b) => b.k === q.chip)!.chip, Math.min(1, (st.temps[1] - 40) / 110))
      },
      readouts: (p) => {
        const q = driverParams(p)
        const name = DRIVERS[q.chip].name
        return [
          { label: 'L298N motor V', value: `${q.old.motorV.toFixed(2)} V (${Math.round(q.old.efficiency * 100)} %)`, tone: q.old.efficiency > 0.85 ? 'ok' : 'warn' },
          { label: `${name} motor V`, value: `${q.modern.motorV.toFixed(2)} V (${Math.round(q.modern.efficiency * 100)} %)`, tone: 'ok' },
          { label: 'Heat L298N / new', value: `${q.old.lossW.toFixed(2)} / ${q.modern.lossW.toFixed(2)} W`, tone: q.old.lossW > 2 ? 'bad' : 'warn' },
          { label: `${name} rating`, value: `${DRIVERS[q.chip].maxA} A`, tone: q.modern.overA ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Decay modes: during PWM off-time the winding's current either circulates through both low sides or is driven back into the supply. ---

const DECAYS = { slow: 'Slow decay: low sides on', fast: 'Fast decay: diodes to supply' }
const PWM_HZ = { '1000': '1 kHz PWM', '20000': '20 kHz PWM' }
const DUTIES = Array.from({ length: 21 }, (_, k) => k / 20)
const curvesOf = memoBy(
  (hz: number) => String(hz),
  (hz: number) => ({ slow: DUTIES.map((d) => decaySpeed('slow', d, hz)), fast: DUTIES.map((d) => decaySpeed('fast', d, hz)) }),
)
const decayRun = memoBy(
  (q: { mode: Decay; hz: number; duty: number }) => `${q.mode}|${q.hz}|${q.duty}`,
  (q: { mode: Decay; hz: number; duty: number }) => {
    const w = decaySpeed(q.mode, q.duty, q.hz)
    return { ...q, w, ...decayCurrent(q.mode, q.duty, q.hz, motorK() * w, HBRIDGE.vs, 160) }
  },
)
const decayParams = (p: Params) => decayRun({ mode: pick(DECAYS, p.mode, 'slow') as Decay, hz: Number(pick(PWM_HZ, p.hz, '1000')), duty: n(p, 'duty') / 100 })
const PERIOD_S = 2.4
const ROTOR_SLOW = 200
const I_LO = -0.6
const I_SPAN = 1.8

export const decayModes: Lesson = {
  id: 'h-bridge-decay-modes',
  title: 'Decay modes',
  tagline: 'Where the motor current goes when PWM switches off',
  formula: (p) => {
    const q = decayParams(p)
    const v = q.mode === 'slow' ? '0' : `−(${HBRIDGE.vs} + 2·${DECAY.diodeV})`
    return `Off-time: L·di/dt = ${v} − I·R − kω · L = ${DECAY.henries * 1000} mH, L/R = ${msText(DECAY.henries / (TT_MOTOR.ohms + 2 * HBRIDGE.rdsOhm))} vs period ${msText(1 / q.hz)}`
  },
  legend: [
    { color: HEAT, label: 'On-time: Q1 + Q4 from the pack', shape: 'dot' },
    { color: B_FIELD, label: 'Slow decay loop: Q2 + Q4', shape: 'dot' },
    { color: HIGH_V, label: 'Fast decay: D3, pack, D2', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'PWM drives the bridge on (Q1 + Q4) for a fraction of each period and off for the rest. The motor winding is an inductor, about 1.5 mH here: its current cannot stop when the switches open, so the off-time needs a path.',
    'Slow decay: turn on both low switches (Q2 + Q4). The current loops through the shorted motor with nearly 0 V across it and fades slowly (L/R ≈ 0.3 ms). The current stays smooth, average voltage ≈ duty × supply, and speed is close to linear in duty.',
    'Fast decay: turn everything off. The current forces its way through the diodes across Q3 and Q2, back into the pack against the full supply voltage, so it collapses quickly, often to zero before the next pulse. The motor sees big ripple and less average current.',
    'With little load that means a dead zone at low duty and a speed that depends on load, not just duty: poor for smooth speed control. Fast decay is chosen where the current must change quickly, like microstepping or a quick reverse.',
    'A higher PWM frequency shrinks ripple in both modes (20 kHz is also above hearing). TB6612 and DRV8833 pick the mode from the input pattern: on the DRV8833, PWM on IN1 with IN2 low is fast decay; IN1 high with an inverted PWM on IN2 is slow decay.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(DECAYS), initial: 'slow' },
    { kind: 'slider', key: 'duty', label: 'Duty', min: 5, max: 100, step: 5, initial: 50, format: (v: number) => `${v} %` },
    { kind: 'choice', key: 'hz', options: opts(PWM_HZ), initial: '1000' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const h = hDiagram(scene, [-8.8, 1.6, 0], 0.62, { diodes: true })
    const speedTag = liveLabel(scene, [-8.8, -4, 0.3], { size: 0.34 })
    const phaseTag = liveLabel(scene, [-8.8, -5.1, 0.3], { size: 0.4 })

    const iPlot = scope(scene, 9, 4.6, { divs: [8, 6], zeroAt: -I_LO / I_SPAN })
    iPlot.group.position.set(6.6, 4.2, 0)
    const yI = (a: number) => ((a - I_LO) / I_SPAN - 0.5) * iPlot.height
    const iTrace = iPlot.trace(HEAT, { samples: 200, radius: 0.08 })
    const mean = iPlot.level(RING)
    const cur = cursorBar(iPlot, LABEL)
    const iCap = liveLabel(scene, [6.6, 1.3, 0.3], { size: 0.3 })

    const sPlot = scope(scene, 9, 3.8, { divs: [10, 4], zeroAt: 0 })
    sPlot.group.position.set(6.6, -2.6, 0)
    const yS = (w: number) => (w / FREE - 0.5) * sPlot.height
    const sTr = { slow: sPlot.trace(B_FIELD, { samples: DUTIES.length, radius: 0.08 }), fast: sPlot.trace(HIGH_V, { samples: DUTIES.length, radius: 0.08 }) }
    const marker = add(scene, mesh(new THREE.SphereGeometry(0.3, 16, 12), glowMat(LABEL, 1.2)))
    addLabel(scene, 'slow', [2.4, 0.2, 0.3], B_FIELD, 0.36, 'left')
    addLabel(scene, 'fast', [4.4, 0.2, 0.3], HIGH_V, 0.36, 'left')
    addLabel(scene, `speed vs duty 0…100 % · 0…${rpm(FREE)} rpm`, [6.6, -5.2, 0.3], GREY, 0.3)
    const code = codeBlock(scene, [-15, -6.6, 0], 0.34, 3)

    const st = { u: 0, key: '', hz: 0, angle: 0, cycle: 0 }
    return {
      scene,
      view: { center: [-2, -0.4, 0], radius: 55, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = decayParams(p)
        const key = `${q.mode}|${q.hz}|${q.duty}`
        const N = q.amps.length
        if (key !== st.key) {
          st.key = key
          iTrace.draw((u) => yI(q.amps[Math.round(((u * 2) % 1) * (N - 1))]), null)
          mean.set(yI(q.mean))
          iCap.set(`I −0.6…1.2 A · 2 periods = ${msText(2 / q.hz)} · mean ${q.mean.toFixed(3)} A`, GREY)
          const d = Math.round(q.duty * 255)
          code(
            q.mode === 'slow'
              ? ['// DRV8833 slow decay: IN1 = 1, IN2 = inverted PWM', 'digitalWrite(IN1, HIGH);', `ledcWrite(IN2, ${255 - d});  // off-time: IN1 = IN2 = 1 brakes`]
              : ['// DRV8833 fast decay: IN1 = PWM, IN2 = 0', `ledcWrite(IN1, ${d});`, 'digitalWrite(IN2, LOW);  // off-time: all off, diodes conduct'],
          )
        }
        if (q.hz !== st.hz) {
          st.hz = q.hz
          const c = curvesOf(q.hz)
          sTr.slow.points(DUTIES, c.slow.map(yS))
          sTr.fast.points(DUTIES, c.fast.map(yS))
        }
        setGlow(sTr.slow.material, B_FIELD, q.mode === 'slow' ? 1.1 : 0.3)
        setGlow(sTr.fast.material, HIGH_V, q.mode === 'fast' ? 1.1 : 0.3)
        marker.position.set(6.6 + sPlot.xAt(q.duty), -2.6 + yS(q.w), 0.4)

        st.u += dt / PERIOD_S
        if (st.u >= 1) {
          st.u -= 1
          st.cycle = (st.cycle + 1) % 2
        }
        cur((st.cycle + st.u) / 2)
        const i = q.amps[Math.round(st.u * (N - 1))]
        const on = st.u < q.duty
        const slow = q.mode === 'slow'
        h.set({ q1: +on, q2: +(!on && slow), q3: 0, q4: +(on || slow) })
        const route: Route = on ? 'fwd' : slow ? 'brakeLo' : 'fastOff'
        const color = on ? HEAT : slow ? B_FIELD : HIGH_V
        const level = Math.min(1, Math.abs(i) / 0.8)
        h.routes(Math.abs(i) > 0.005 ? [[route, Math.min(1, 0.25 + level), color]] : [])
        h.flow('motor', Math.abs(i) > 0.005 ? route : null, dt * i * 0.6)
        st.angle += (dt * q.w) / ROTOR_SLOW
        h.motor.set(st.angle, level)
        speedTag.set(`${rpm(q.w)} rpm · rotor drawn ${ROTOR_SLOW}× slower`, GREY)
        phaseTag.set(
          on ? `On: pack drives ${i.toFixed(2)} A up` : slow ? `Off, slow decay: ${i.toFixed(2)} A circulates` : i > 0.005 ? `Off, fast decay: ${i.toFixed(2)} A pushed back into the pack` : 'Off, fast decay: current already zero',
          color,
        )
      },
      readouts: (p) => {
        const q = decayParams(p)
        const lin = (q.duty * HBRIDGE.vs - TT_MOTOR.noLoadA * (TT_MOTOR.ohms + 2 * HBRIDGE.rdsOhm)) / motorK()
        return [
          { label: 'PWM period', value: `${msText(1 / q.hz)} (${Math.round(PERIOD_S * q.hz)}× slower)` },
          { label: 'Mean current', value: `${q.mean.toFixed(3)} A` },
          { label: 'Ripple p-p', value: `${q.ripple.toFixed(2)} A`, tone: q.ripple > 0.4 ? 'bad' : q.ripple > 0.15 ? 'warn' : 'ok' },
          { label: 'Speed', value: `${rpm(q.w)} rpm`, tone: Math.abs(q.w - Math.max(0, lin)) < 0.08 * FREE ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Shoot-through: the low side is still conducting when the high side turns on; dead time keeps them apart. ---

const SHOOT_HZ = { '20000': '20 kHz PWM', '100000': '100 kHz PWM' }
const SPAN_NS = 400
const SHOOT_MAX_A = 60
const shootParams = (p: Params) => {
  const dead = n(p, 'dead')
  const hz = Number(pick(SHOOT_HZ, p.hz, '20000'))
  return { dead, hz, ...shootThrough(dead, hz) }
}

export const shootThroughLesson: Lesson = {
  id: 'h-bridge-shoot-through',
  title: 'Shoot-through',
  tagline: 'Both switches of a leg on for a few nanoseconds',
  formula: (p) => {
    const q = shootParams(p)
    return `I = V / (Rds,lo + Rds,hi + R_loop) ≤ ${LEG.vs} / (${2 * LEG.rdsOhm} + ${LEG.loopOhm}) = ${(LEG.vs / (2 * LEG.rdsOhm + LEG.loopOhm)).toFixed(0)} A · P = 2·f·∫V·I dt = 2·${q.hz / 1000} k·${(q.joules * 1e6).toFixed(1)} µJ = ${q.watts.toFixed(2)} W`
  },
  legend: [
    { color: B_FIELD, label: 'Low side Q2 conducting', shape: 'dot' },
    { color: POWER, label: 'High side Q1 conducting', shape: 'dot' },
    { color: HIGH_V, label: 'Shoot-through current', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'In a PWM bridge one leg flips between its low and high switch thousands of times a second. A MOSFET turns on quickly but turns off slowly: its gate charge has to drain first, here 120 ns of delay plus a 60 ns fall.',
    'Command Q2 off and Q1 on at the same instant and, for those 150 ns, both conduct. The pack sees 22 mΩ + 22 mΩ + wiring: a spike of about 50 A, every edge.',
    'Each spike is only tens of microjoules, but there are two per period: at 20 kHz that is about 2 W of pure heat in the leg, at 100 kHz five times that, plus supply ringing that can reset the microcontroller.',
    'The fix is dead time: wait after switching one side off before switching the other on. Here anything over 150 ns (turn-off delay + fall − turn-on delay) removes the overlap. Meanwhile the motor current keeps flowing through Q2\'s body diode.',
    'Too much dead time costs a little diode loss and distorts small duties, so it is set just past the overlap. ESP32\'s MCPWM inserts it in hardware on complementary outputs; driver chips (TB6612, DRV8833) have it built in.',
  ],
  controls: [
    { kind: 'slider', key: 'dead', label: 'Dead time', min: 0, max: 300, step: 10, initial: 0, format: (v: number) => `${v} ns` },
    { kind: 'choice', key: 'hz', options: opts(SHOOT_HZ), initial: '20000' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const h = hDiagram(scene, [-8.8, 1.6, 0], 0.62, { volts: LEG.vs, diodes: true })
    const waves = heatWaves(h.g, 1.2, { count: 3, rise: 4 })
    waves.group.position.set(-LX, 1.2, 1)
    const stateTag = liveLabel(scene, [-8.8, -4.2, 0.3], { size: 0.4 })

    const PX = 6.6
    const PY = 2.6
    const plot = scope(scene, 9, 5.6, { divs: [8, 6], zeroAt: 0 })
    plot.group.position.set(PX, PY, 0)
    const yOf = (f: number) => (f - 0.5) * plot.height
    const tr = { lo: plot.trace(B_FIELD, { samples: 200, radius: 0.08 }), hi: plot.trace(POWER, { samples: 200, radius: 0.08 }), amps: plot.trace(HIGH_V, { samples: 200, radius: 0.1 }) }
    const cur = cursorBar(plot, LABEL)
    const deadBar = add(scene, mesh(new THREE.BoxGeometry(1, 0.22, 0.2), glowMat(RING, 1.2)))
    const deadTag = liveLabel(scene, [0, PY + plot.height / 2 + 1, 0.3], { size: 0.32, align: 'left' })
    addLabel(scene, `0…100 % on · I 0…${SHOOT_MAX_A} A · ${SPAN_NS} ns from Q2 off`, [PX, PY - plot.height / 2 - 0.9, 0.3], GREY, 0.28)
    const heat = meterBar(scene, [PX - 3.4, -2.6, 0], 5, 4, [], 'heat')
    const result = liveLabel(scene, [PX, -4.2, 0.3], { size: 0.32 })
    const code = codeBlock(scene, [-15, -5.6, 0], 0.3, 4)

    const clock = simClock(4 / SPAN_NS, 1.5)
    const st = { t: 0, key: '' }
    return {
      scene,
      view: { center: [-2, -0.4, 0], radius: 55, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = shootParams(p)
        const key = `${q.dead}|${q.hz}`
        const t = clock(dt, key, SPAN_NS)
        st.t = t
        if (key !== st.key) {
          st.key = key
          const at = (u: number) => legAt(u * SPAN_NS, q.dead)
          tr.lo.draw((u) => yOf(at(u).lo), null)
          tr.hi.draw((u) => yOf(at(u).hi), null)
          tr.amps.draw((u) => yOf(at(u).amps / SHOOT_MAX_A), null)
          const x0 = PX + plot.xAt(0)
          const w = Math.max(0.05, (q.dead / SPAN_NS) * plot.width)
          deadBar.scale.x = w
          deadBar.position.set(x0 + w / 2, PY + plot.height / 2 + 0.35, 0.3)
          deadTag.group.position.x = x0
          deadTag.set(q.dead ? `dead time ${q.dead} ns` : 'no dead time', RING)
          const ticks = Math.round(q.dead / 12.5)
          code([
            `mcpwm_dead_time_config_t dt = {.posedge_delay_ticks = ${ticks}};`,
            'mcpwm_generator_set_dead_time(genH, genH, &dt);  // 80 MHz: 12.5 ns/tick',
            `dt = {.negedge_delay_ticks = ${ticks}, .flags.invert_output = 1};`,
            'mcpwm_generator_set_dead_time(genH, genL, &dt);  // low = inverted high',
          ])
        }
        cur(t / SPAN_NS)
        const s = legAt(t, q.dead)
        const spike = s.amps / SHOOT_MAX_A
        h.set({ q1: s.hi, q2: s.lo, q3: 0, q4: 1 }, { q1: spike * 1.5, q2: spike * 1.5 })
        const motorRoute: Route = s.hi > 0.5 ? 'fwd' : s.lo > 0.5 ? 'brakeLo' : 'diodeLo'
        h.routes([[motorRoute, 0.5, HEAT], ...(s.amps > 0 ? [['shootL', Math.min(1, 0.3 + spike), HIGH_V] as [Route, number, string]] : [])])
        h.flow('motor', motorRoute, dt * 0.3)
        h.flow('short', s.amps > 0 ? 'shootL' : null, dt * (0.4 + spike * 2))
        waves.step(dt, Math.min(1, q.watts / 2))
        stateTag.set(
          s.amps > 0 ? `Both on: ${s.amps.toFixed(0)} A straight through the leg` : motorRoute === 'diodeLo' ? 'Dead time: both off, motor current in D2' : motorRoute === 'fwd' ? 'Q1 on: pack drives the motor' : 'Q2 on: motor current circulates low',
          s.amps > 0 ? HIGH_V : motorRoute === 'diodeLo' ? RING : HEAT,
        )
        heat(q.watts, `${q.watts.toFixed(2)} W`, q.watts > 0.5 ? HIGH_V : q.watts > 0 ? HEAT : POWER)
        result.set(
          q.overlapNs ? `${q.overlapNs} ns overlap: ${q.peakA.toFixed(0)} A spikes, ${q.watts.toFixed(2)} W wasted` : `≥ ${safeDeadNs()} ns: no overlap, no spike`,
          q.overlapNs ? HIGH_V : POWER,
        )
      },
      readouts: (p) => {
        const q = shootParams(p)
        return [
          { label: 'Sim time', value: `${Math.round(st.t)} ns (10⁷× slower)` },
          { label: 'Overlap', value: `${q.overlapNs} ns`, tone: q.overlapNs ? 'bad' : 'ok' },
          { label: 'Peak current', value: `${q.peakA.toFixed(1)} A`, tone: q.peakA ? 'bad' : 'ok' },
          { label: 'Shoot-through heat', value: `${q.watts.toFixed(2)} W`, tone: q.watts > 0.5 ? 'bad' : q.watts > 0 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
