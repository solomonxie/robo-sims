import * as THREE from 'three/webgpu'
import {
  Decoding,
  ENCODERS,
  EncoderKind,
  Pose,
  QUAD_STATES,
  QuadReader,
  TT_TRACK_M,
  TT_WHEEL_MM,
  decodeStep,
  encoderCpr,
  headingDrift,
  maxIsrRpm,
  mmPerTick,
  motorRpm,
  odoStep,
  odometryM,
  periodResolution,
  periodSpeed,
  quadEdgeHz,
  quadEdges,
  quadIndex,
  quadIsr,
  quadLevels,
  quadReader,
  quadStep,
  ticksAt,
  ticksPerWheelRev,
  windowResolution,
  windowSpeed,
} from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { buildTtMotor, buildWheel } from '../../models/motion'
import { createStage } from '../../scene/stage'
import {
  CLK_COLOR,
  CODE_LEGEND,
  DATA_COLOR,
  GREY,
  HEAT,
  LABEL,
  NORTH,
  POWER,
  RING,
  SOUTH,
  codeBlock,
  emptyGroup,
  glowMat,
  liveLabel,
  memoBy,
  partLetter,
  pointCloud,
  rayFan,
  scope,
  setGlow,
  stateDiagram,
  timingDiagram,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const ENC = { hall: 'Hall, 11 PPR on motor', slot: 'Optical, 20 slots on wheel' }
const MODES = { x1: '×1 decoding', x2: '×2', x4: '×4' }
const DEC: Record<keyof typeof MODES, Decoding> = { x1: 1, x2: 2, x4: 4 }
const TT_GEAR = 48
const FULL_RPM = motorRpm(6)
const A_COLOR = CLK_COLOR
const B_COLOR = DATA_COLOR
const AB = (i: number) => QUAD_STATES[i]
const us = (s: number) => (s >= 1e-3 ? `${(s * 1e3).toFixed(s >= 0.01 ? 0 : 1)} ms` : `${Math.round(s * 1e6)} µs`)
const encChoice = { kind: 'choice', key: 'enc', options: opts(ENC), initial: 'hall' } as const
const modeChoice = { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'x4' } as const

/** Encoder disc (faces +z, spins in `disc`) with A/B sensors at the rim, placed so A leads B by a quarter pulse going forward. */
function encoderUnit(parent: THREE.Object3D, kind: EncoderKind, ppr: number, r: number) {
  const g = add(parent, new THREE.Group())
  const disc = add(g, new THREE.Group())
  const pitch = (2 * Math.PI) / ppr
  const sector = (r0: number, r1: number, a: number, len: number, m: THREE.Material, z = 0) =>
    add(disc, mesh(new THREE.RingGeometry(r0, r1, Math.max(2, Math.ceil(len / 0.1)), 1, a, len), m), [0, 0, z])
  if (kind === 'hall') {
    for (let k = 0; k < 2 * ppr; k++) {
      const m = mat(k % 2 ? SOUTH : NORTH, { rough: 0.55 })
      add(disc, mesh(new THREE.RingGeometry(r * 0.5, r, 6, 1, (k * pitch) / 2, pitch / 2), m))
    }
    cylinder(disc, r * 0.5, 0.3, mat('#3a3d45', { rough: 0.5 }), [0, 0, -0.15], 'z', 32)
  } else {
    const steel = mat('#2a2c32', { rough: 0.45 })
    sector(r * 0.2, r * 0.72, 0, 2 * Math.PI, steel)
    for (let k = 0; k < ppr; k++) sector(r * 0.72, r, k * pitch + pitch / 2, pitch / 2, steel)
  }
  cylinder(disc, r * 0.12, 1.2, mat('#f4f1e8', { rough: 0.5 }), [0, 0, 0], 'z', 16)
  // Sensor angles: A sits a quarter pitch past a sector edge, B (k + ¼) pitches further on.
  const aAng = pitch * (Math.round(Math.PI / 2 / pitch - 0.25) + 0.25)
  const bAng = aAng + pitch * (Math.max(0, Math.round((0.7 / pitch) - 0.25)) + 0.25)
  const body = mat('#1c1d22', { rough: 0.6 })
  const sensors = [aAng, bAng].map((ang, i) => {
    const s = add(g, new THREE.Group())
    s.rotation.z = ang - Math.PI / 2
    const color = i ? B_COLOR : A_COLOR
    const lit = glowMat(color, 0)
    if (kind === 'hall') {
      box(s, [r * 0.16, r * 0.12, 0.35], body, [0, r * 0.78, 0.45])
      add(s, mesh(new THREE.SphereGeometry(r * 0.04, 12, 8), lit), [0, r * 0.78, 0.7])
    } else {
      for (const z of [-0.6, 0.6]) box(s, [r * 0.14, r * 0.3, 0.4], body, [0, r * 0.84, z])
      box(s, [r * 0.14, r * 0.12, 1.6], body, [0, r * 1.03, 0])
      add(s, mesh(new THREE.CylinderGeometry(r * 0.025, r * 0.025, 0.8, 8), lit), [0, r * 0.84, 0]).rotation.x = Math.PI / 2
    }
    const c = Math.cos(ang)
    const sn = Math.sin(ang)
    partLetter(g, i ? 'B' : 'A', [c * (r + 1.1), sn * (r + 1.1), 0.4], 0.9, color)
    return { lit, color }
  })
  return {
    group: g,
    spin(q: number) {
      disc.rotation.z = (q * pitch) / 4
      quadLevels(q).forEach((v, i) => setGlow(sensors[i].lit, sensors[i].color, v ? 2 : 0.05))
    },
  }
}

// --- Quadrature: two channels 90° apart, Gray-code decoding, missed edges. ---

const Q = { disc: [-15, 0, 0] as V3, r: 5.6, k: 0.9, slow: { hall: 1000, slot: 50 } }
const quadRun = memoBy(
  (p: Params) => `${p.enc}|${p.speed}|${p.mode}|${p.isr}`,
  (p: Params) => {
    const enc = pick(ENC, p.enc, 'hall')
    const E = ENCODERS[enc]
    const wheelRpm = (FULL_RPM * n(p, 'speed')) / 100
    const shaftRpm = wheelRpm * (E.onMotor ? TT_GEAR : 1)
    const mode = DEC[pick(MODES, p.mode, 'x4')]
    const isrS = n(p, 'isr') * 1e-6
    const edgeHz = quadEdgeHz(shaftRpm, E.ppr)
    const limit = maxIsrRpm(isrS, E.ppr)
    return { enc, ppr: E.ppr, wheelRpm, shaftRpm, mode, isrS, edgeHz, limit, keeps: Math.abs(shaftRpm) <= limit, qps: (shaftRpm / 60) * E.ppr * 4, slow: Q.slow[enc] }
  },
)
const STEP_NAME: Record<Decoding, string> = { 1: 'STEP_X1', 2: 'STEP_X2', 4: 'STEP_X4' }

export const quadrature: Lesson = {
  id: 'encoder-quadrature',
  title: 'Quadrature',
  tagline: 'Two sensors a quarter pulse apart give both distance and direction',
  formula: (p) => {
    const R = quadRun(p)
    return `CPR = ${R.ppr} pulses × ${R.mode} = ${encoderCpr(R.ppr, R.mode)} counts/rev · ${Math.round(Math.abs(R.shaftRpm))} rpm × ${R.ppr} × 4 / 60 = ${Math.round(R.edgeHz)} edges/s${R.edgeHz ? ` (one every ${us(1 / R.edgeHz)})` : ''} · ISR ${us(R.isrS)} → follows up to ${Math.round(R.limit).toLocaleString('en-US')} rpm`
  },
  legend: [
    { color: A_COLOR, label: 'Channel A', shape: 'dot' },
    { color: B_COLOR, label: 'Channel B, 90° behind A', shape: 'dot' },
    { color: HEAT, label: 'ISR running', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'An encoder turns rotation into pulses. A TT motor takes either a magnet ring on the motor shaft read by hall sensors (11 pulses per motor turn), or a slotted disc on the wheel shaft read by optical forks (20 slots).',
    'One sensor only counts. Add a second, placed a quarter pulse (90°) behind the first, and the order of edges gives direction: A rises while B is low going forward; turn backwards and B leads.',
    'Together A and B step through four states, 00 → 10 → 11 → 01, changing one bit at a time (a Gray code). Each step is +1 forward or −1 backward. Counting every edge is ×4 decoding; counting only A’s edges is ×2, only one A edge per pulse ×1.',
    'Read it with a CHANGE interrupt on both pins and a 4 × 4 table indexed by the last and new state. If both bits changed since the last read, an edge was missed and the direction is unknown.',
    'That happens when the ISR is too slow: a Serial.print or a long calculation inside it. At full speed the hall encoder gives ~7000 edges/s, one every ~140 µs; keep ISRs to a few µs, or use the ESP32’s PCNT hardware counter.',
  ],
  controls: [
    encChoice,
    { kind: 'slider', key: 'speed', label: 'Motor speed', min: -100, max: 100, step: 5, initial: 40, format: (v) => `${v > 0 ? '+' : ''}${v} %` },
    modeChoice,
    { kind: 'slider', key: 'isr', label: 'ISR time', min: 2, max: 5000, log: true, initial: 5, format: (v) => us(v * 1e-6) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const rig = add(scene, new THREE.Group())
    let unit: ReturnType<typeof encoderUnit> | null = null
    const td = timingDiagram(scene, [10.5, 8.6, 0], [
      { label: 'A', color: A_COLOR },
      { label: 'B', color: B_COLOR },
      { label: 'ISR', color: HEAT },
    ], { width: 22, rowH: 2.1, window: 6 })
    const k = 3.4
    const dia = stateDiagram(
      scene,
      [14, -5.2, 0],
      [
        { id: '0', label: AB(0), at: [-k, 0] },
        { id: '1', label: AB(1), at: [0, k] },
        { id: '2', label: AB(2), at: [k, 0] },
        { id: '3', label: AB(3), at: [0, -k] },
      ],
      [
        ...[0, 1, 2, 3].map((i) => ({ from: `${i}`, to: `${(i + 1) % 4}`, label: '+', bend: 0.45 })),
        ...[0, 1, 2, 3].map((i) => ({ from: `${(i + 1) % 4}`, to: `${i}`, label: '−', bend: 0.45 })),
      ],
      { r: 1.25, text: 0.62 },
    )
    partLetter(scene, 'AB state', [14, -0.2, 0], 0.5, LABEL)
    const countText = liveLabel(scene, [-1, -4.2, 0.3], { size: 0.62, align: 'left' })
    const trueText = liveLabel(scene, [-1, -5.8, 0.3], { size: 0.4, align: 'left' })
    const dirText = liveLabel(scene, [-1, -7.2, 0.3], { size: 0.4, align: 'left' })
    const code = codeBlock(scene, [-25, 14.6, 0], 0.34, 4)
    const status = liveLabel(scene, [-25, -12.4, 0.3], { size: 0.38, align: 'left' })
    const s = { key: '', enc: '', T: 0, q: 0.5, r: quadReader(0), truth: quadReader(0), last: '// waiting for an edge', miss: 0 }
    return {
      scene,
      view: { center: [-1, 1.2, 0], radius: 80, polar: 1.42, azimuth: 0.18 },
      frame(dt, p) {
        const R = quadRun(p)
        if (R.enc !== s.enc) {
          emptyGroup(rig)
          const motor = add(rig, buildTtMotor())
          motor.scale.setScalar(Q.k)
          if (R.enc === 'hall') {
            motor.rotation.y = -Math.PI / 2
            motor.position.set(Q.disc[0], Q.disc[1] - 3.7 * Q.k, Q.disc[2] - 22 * Q.k)
          } else motor.position.set(Q.disc[0] + 4 * Q.k, Q.disc[1] - 3.7 * Q.k, Q.disc[2] - 8.2 * Q.k)
          unit = encoderUnit(rig, R.enc, R.ppr, Q.r)
          unit.group.position.set(...Q.disc)
          s.enc = R.enc
        }
        const key = `${R.enc}|${R.mode}|${R.isrS}`
        if (key !== s.key) {
          s.T = 0
          s.q = 0.5
          s.r = quadReader(0)
          s.truth = quadReader(0)
          s.last = '// waiting for an edge'
          s.miss = 0
          s.key = key
        }
        const t0 = s.T
        const t1 = t0 + dt / R.slow
        const q0 = s.q
        const at = (t: number) => quadIndex(q0 + R.qps * (t - t0))
        const edges = quadEdges(q0, R.qps, t0, t1)
        const from = s.r.state
        const prev: QuadReader = s.r
        s.r = quadIsr(s.r, edges, at, R.isrS, t1, R.mode)
        s.truth = quadIsr(s.truth, edges, at, 0, t1, R.mode)
        s.T = t1
        s.q = q0 + R.qps * (t1 - t0)
        if (s.r.state !== from) {
          const d = quadStep(from, s.r.state)
          const to = s.r.state
          if (s.r.errors > prev.errors) {
            s.miss = 2.5
            s.last = `// ${AB(from)} → ${AB(to)}: both pins flipped, an edge was missed`
          } else {
            const inc = decodeStep(from, to, R.mode)
            s.last = `// ${AB(from)} → ${AB(to)}: ${d > 0 ? 'forward' : 'reverse'}, count ${inc > 0 ? '+= 1' : inc < 0 ? '−= 1' : 'unchanged'} → ${s.r.count}`
            dia.fire(d > 0 ? from : 4 + to)
          }
        }
        s.miss = Math.max(0, s.miss - dt)
        unit?.spin(s.q)
        const [a, b] = quadLevels(s.q)
        const busy = s.T < Math.max(s.r.busyUntil, s.r.busyUntil - R.isrS + 0.07 / R.slow) ? 1 : 0
        td.frame(dt, [a, b, busy])
        dia.frame(dt, `${s.r.state}`)
        const lost = s.truth.count - s.r.count
        countText.set(`count ${s.r.count}`, lost ? HEAT : RING)
        trueText.set(`true ${s.truth.count}${lost ? ` · lost ${lost}` : ''}`, lost ? HEAT : GREY)
        dirText.set(R.qps > 0 ? 'A leads B → forward' : R.qps < 0 ? 'B leads A → reverse' : 'stopped', R.qps ? POWER : GREY)
        code([
          'attachInterrupt(ENC_A, isr, CHANGE);  // and ENC_B',
          'void IRAM_ATTR isr() { uint8_t s = digitalRead(A) << 1 | digitalRead(B);',
          `  count += ${STEP_NAME[R.mode]}[last][s];  last = s;${R.isrS > 50e-6 ? '  Serial.print(count); }  // slow!' : ' }'}`,
          s.last,
        ])
        status.set(
          s.miss > 0
            ? `missed edge: ${us(R.isrS)} ISR > ${R.edgeHz ? us(1 / R.edgeHz) : '∞'} between edges`
            : `t = ${(s.T * 1e3).toFixed(1)} ms · slowed ${R.slow}× · ${R.enc === 'hall' ? 'motor shaft' : 'wheel shaft'} ${Math.round(Math.abs(R.shaftRpm))} rpm`,
          s.miss > 0 ? HEAT : LABEL,
        )
      },
      readouts: (p) => {
        const R = quadRun(p)
        const lost = s.truth.count - s.r.count
        return [
          { label: 'Counts / rev', value: `${encoderCpr(R.ppr, R.mode)}` },
          { label: 'Edge every', value: R.edgeHz ? us(1 / R.edgeHz) : '—' },
          { label: 'ISR keeps up to', value: `${Math.round(R.limit).toLocaleString('en-US')} rpm`, tone: R.keeps ? 'ok' : 'bad' },
          { label: 'Lost counts', value: `${lost}${s.r.errors ? ` (${s.r.errors} skips)` : ''}`, tone: lost ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Counts per revolution: encoder CPR × gearbox → ticks per wheel turn → mm per tick → odometry. ---

const GEARS = { g48: '1:48 gearbox', g120: '1:120 gearbox' }
const GEAR_N: Record<keyof typeof GEARS, number> = { g48: 48, g120: 120 }
const C = { k: 0.42, y: -4, x0: -23, x1: 2, mmPerUnit: 2.54 / 0.42, slow: 12, wheelRpm: 100, maxMarks: 160 }
const cprRun = memoBy(
  (p: Params) => `${p.enc}|${p.gear}|${p.mode}|${p.tyre}`,
  (p: Params) => {
    const enc = pick(ENC, p.enc, 'hall')
    const E = ENCODERS[enc]
    const gear = E.onMotor ? GEAR_N[pick(GEARS, p.gear, 'g48')] : 1
    const mode = DEC[pick(MODES, p.mode, 'x4')]
    const tyre = n(p, 'tyre')
    const tpr = ticksPerWheelRev(E.ppr, mode, gear)
    const mm = mmPerTick(TT_WHEEL_MM, tpr)
    const real = mmPerTick(tyre, tpr)
    const per1m = ticksAt(1000, real)
    const est = odometryM(per1m, mm)
    const mark = [1, 10, 100, 1000].find((m) => m * real >= 2.5) ?? 1000
    return { enc, ppr: E.ppr, gear, mode, tyre, tpr, mm, real, per1m, est, mark }
  },
)

export const countsPerRevolution: Lesson = {
  id: 'encoder-counts-per-revolution',
  title: 'Counts per revolution',
  tagline: 'Encoder counts × gearbox = ticks per wheel turn; the wheel turns ticks into millimetres',
  formula: (p) => {
    const R = cprRun(p)
    return `ticks / wheel rev = ${R.ppr} PPR × ${R.mode} × ${R.gear} = ${R.tpr} · mm / tick = π × ${TT_WHEEL_MM} mm / ${R.tpr} = ${R.mm.toPrecision(3)} mm · 1 m → ${R.per1m} ticks × ${R.mm.toPrecision(3)} = ${(R.est * 1000).toFixed(0)} mm`
  },
  legend: [
    { color: RING, label: `Tick marks on the floor`, shape: 'dot' },
    { color: POWER, label: 'Odometry: ticks × mm/tick', shape: 'dot' },
    { color: GREY, label: 'True position', shape: 'dot' },
  ],
  points: [
    'Encoder resolution is quoted per turn of the shaft it sits on. PPR (pulses per rev) × decoding gives counts per rev (CPR): an 11 PPR hall encoder read at ×4 is 44 counts per motor turn.',
    'On the motor shaft, the gearbox multiplies it: the TT motor turns 48 times per wheel turn, so 44 × 48 = 2112 ticks per wheel rev. A 20-slot disc on the wheel shaft gets no gearbox help: 20 ticks per rev at ×1.',
    'A 65 mm wheel rolls π × 65 = 204 mm per turn, so one tick is 204 / 2112 ≈ 0.1 mm on the hall encoder, but 10 mm on the slotted disc. Odometry is just ticks × mm per tick.',
    'Gear backlash and tyre squash matter more than encoder resolution below ~1 mm. The real wheel size sets the scale: a worn or soft 64 mm tyre makes every metre read 1.5 % long. Calibrate by driving a measured 1 m and fixing mm/tick.',
  ],
  controls: [
    encChoice,
    { kind: 'choice', key: 'gear', options: opts(GEARS), initial: 'g48' },
    modeChoice,
    { kind: 'slider', key: 'tyre', label: 'Real tyre', min: 62, max: 68, step: 0.5, initial: 65, format: (v) => `${v.toFixed(1)} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    // Floor ruler.
    box(scene, [C.x1 - C.x0 + 14, 0.3, 11], mat('#3a3d45', { rough: 0.8 }), [(C.x0 + C.x1) / 2 + 4, C.y - 0.15, 0])
    for (let x = C.x0, i = 0; x <= C.x1 + 0.01; x += 50 / C.mmPerUnit, i++) {
      box(scene, [0.08, 0.05, i % 2 ? 0.8 : 1.6], mat(GREY), [x, C.y + 0.03, 4.6])
      if (i % 2 === 0) partLetter(scene, `${i * 50}`, [x, C.y - 0.9, 6], 0.42, GREY)
    }
    partLetter(scene, 'mm', [C.x1 + 2, C.y - 0.9, 6], 0.42, GREY)
    const rig = add(scene, new THREE.Group())
    const r0 = 12.8 * C.k
    const parts = { wheel: new THREE.Group(), disc: null as ReturnType<typeof encoderUnit> | null, tag: liveLabel(scene, [0, 0, 0], { size: 0.5 }) }
    const marks = pointCloud(scene, C.maxMarks, 0.18)
    const odo = add(scene, mesh(new THREE.ConeGeometry(0.5, 1.2, 16), glowMat(POWER, 1.2)))
    odo.rotation.z = Math.PI
    const truth = add(scene, mesh(new THREE.ConeGeometry(0.35, 0.9, 16), glowMat(GREY, 0.8)))
    truth.rotation.x = Math.PI / 2
    const markText = liveLabel(scene, [C.x0, C.y - 2.4, 6], { size: 0.42, align: 'left' })
    const countText = liveLabel(scene, [-23, 10.4, 0.3], { size: 0.6, align: 'left' })
    const odoText = liveLabel(scene, [-23, 9, 0.3], { size: 0.42, align: 'left' })
    const code = codeBlock(scene, [-25, 14.6, 0], 0.34, 3)
    const status = liveLabel(scene, [-25, -12.4, 0.3], { size: 0.38, align: 'left' })
    const s = { key: '', enc: '', T: 0 }
    const markColor = new THREE.Color(RING)
    return {
      scene,
      view: { center: [-5, 2, 0], radius: 72, polar: 1.36, azimuth: 0.3 },
      frame(dt, p) {
        const R = cprRun(p)
        if (R.enc !== s.enc) {
          emptyGroup(rig)
          // Motor side-on, wheel on the far end of the output shaft, encoder on the near side.
          const motor = add(rig, buildTtMotor())
          motor.scale.setScalar(C.k)
          motor.position.set(4 * C.k, -3.7 * C.k, 0)
          parts.wheel = add(rig, buildWheel(), [0, 0, -8.5 * C.k])
          parts.wheel.scale.setScalar(C.k)
          if (R.enc === 'hall') {
            parts.disc = encoderUnit(rig, 'hall', R.ppr, 3.8)
            parts.disc.group.rotation.y = 0.8
            parts.disc.group.position.set(29 * C.k, 0, 0)
          } else {
            parts.disc = encoderUnit(rig, 'slot', R.ppr, 4.2)
            parts.disc.group.position.set(0, 0, 8.4 * C.k)
          }
          s.enc = R.enc
        }
        if (p.enc + `${R.gear}|${R.mode}|${R.tyre}` !== s.key) {
          s.T = 0
          s.key = p.enc + `${R.gear}|${R.mode}|${R.tyre}`
        }
        s.T += dt / C.slow
        const span = (C.x1 - C.x0) * C.mmPerUnit
        const run = (Math.PI * R.tyre * C.wheelRpm) / 60
        const travel = (run * s.T) % span
        if (run * s.T > span && travel < run * (dt / C.slow) * 1.5) s.T = travel / run
        const turns = travel / (Math.PI * R.tyre)
        const x = C.x0 + travel / C.mmPerUnit
        const wheelR = (r0 * R.tyre) / TT_WHEEL_MM
        rig.position.set(x, C.y + wheelR, 0)
        parts.wheel.scale.set(C.k * (R.tyre / TT_WHEEL_MM), C.k * (R.tyre / TT_WHEEL_MM), C.k)
        parts.wheel.rotation.z = -2 * Math.PI * turns
        const shaftQ = -turns * R.gear * R.ppr * 4
        parts.disc?.spin(R.enc === 'hall' ? -shaftQ : shaftQ)
        const ticks = ticksAt(travel, R.real)
        const nMarks = Math.min(C.maxMarks, Math.floor(ticks / R.mark))
        for (let i = 0; i < nMarks; i++) marks.set(i, [C.x0 + ((i + 1) * R.mark * R.real) / C.mmPerUnit, C.y + 0.1, 1.6], markColor)
        marks.show(nMarks)
        const est = odometryM(ticks, R.mm) * 1000
        odo.position.set(C.x0 + est / C.mmPerUnit, C.y + 0.8, 4.6)
        truth.position.set(x, C.y + 0.1, 5.4)
        parts.tag.group.position.set(x, C.y + 2 * wheelR + 1.4, 0)
        parts.tag.set(R.enc === 'hall' ? `encoder × ${R.gear}` : 'disc on wheel', LABEL)
        markText.set(R.mark === 1 ? `1 mark = 1 tick = ${R.real.toFixed(1)} mm` : `1 mark = ${R.mark} ticks (${(R.mark * R.real).toFixed(1)} mm)`, RING)
        countText.set(`ticks ${ticks}`, RING)
        const err = est - travel
        odoText.set(`odometry ${est.toFixed(1)} mm · true ${travel.toFixed(1)} mm`, Math.abs(err) > 1 ? HEAT : POWER)
        code([
          `const float MM_PER_TICK = PI * ${TT_WHEEL_MM} / (${R.ppr} * ${R.mode}${R.gear > 1 ? ` * ${R.gear}` : ''});  // ${R.mm.toPrecision(3)} mm`,
          `float dist = count * MM_PER_TICK;  // ${ticks} × ${R.mm.toPrecision(3)} = ${est.toFixed(1)} mm`,
          R.tyre === TT_WHEEL_MM ? '// tyre matches the constant: odometry = truth' : `// real tyre ${R.tyre} mm: off by ${(((R.tyre - TT_WHEEL_MM) / TT_WHEEL_MM) * 100).toFixed(1)} %`,
        ])
        status.set(`t = ${s.T.toFixed(2)} s · slowed ${C.slow}× · wheel ${C.wheelRpm} rpm · ${turns.toFixed(2)} turns`, LABEL)
      },
      readouts: (p) => {
        const R = cprRun(p)
        const err = R.est * 1000 - 1000
        return [
          { label: 'Ticks / wheel rev', value: `${R.tpr}` },
          { label: 'mm / tick', value: R.mm.toPrecision(3) },
          { label: 'Odometry for 1 m', value: `${(R.est * 1000).toFixed(0)} mm`, tone: Math.abs(err) > 5 ? 'warn' : 'ok' },
          { label: 'Error per m', value: `${err > 0 ? '+' : ''}${err.toFixed(1)} mm`, tone: Math.abs(err) > 5 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Speed from ticks: window counting vs tick timing, and heading from two wheels. ---

const METHOD = { w20: 'Count / 20 ms', w100: 'Count / 100 ms', period: 'Time between ticks' }
const WINDOW_S: Record<keyof typeof METHOD, number> = { w20: 0.02, w100: 0.1, period: 0 }
const SP = { sc: 12, o: [-24.5, -9.5, 0] as V3, field: [1.75, 1.35] as [number, number], start: [0.12, 0.675] as [number, number], robotK: 2, slow: 2, plotS: 2, samples: 200, timeout: 0.5, wobble: 0.2 }
const PL = { x: 11.5, y: 4.8, w: 21, h: 9 }
const spRun = memoBy(
  (p: Params) => `${p.enc}|${p.method}|${p.speed}|${p.mis}`,
  (p: Params) => {
    const enc = pick(ENC, p.enc, 'hall')
    const E = ENCODERS[enc]
    const method = pick(METHOD, p.method, 'w20')
    const tpr = ticksPerWheelRev(E.ppr, enc === 'hall' ? 4 : 1, E.onMotor ? TT_GEAR : 1)
    const mm = mmPerTick(TT_WHEEL_MM, tpr)
    const v = n(p, 'speed')
    const mis = n(p, 'mis') / 100
    const W = WINDOW_S[method]
    const step = W ? windowResolution(mm, W) : periodResolution(v, mm)
    const drift = (headingDrift(1, 1 + mis, TT_TRACK_M) * 180) / Math.PI
    return { enc, method, tpr, mm, v, mis, W, step, drift, headStep: (mm / 1000 / TT_TRACK_M) * (180 / Math.PI) }
  },
)
const deg = (r: number) => (r * 180) / Math.PI

export const speedFromTicks: Lesson = {
  id: 'encoder-speed-from-ticks',
  title: 'Speed from ticks',
  tagline: 'Count ticks per window, or time between them; two wheels’ counts give the heading',
  formula: (p) => {
    const R = spRun(p)
    return `${R.W ? `v = ticks × ${R.mm.toPrecision(3)} mm / ${R.W * 1000} ms → steps of ${R.step.toFixed(R.step < 10 ? 2 : 0)} mm/s` : `v = ${R.mm.toPrecision(3)} mm / Δt → ±${R.step.toPrecision(2)} mm/s at 1 µs timer, ${us(R.mm / R.v)} between ticks`} · heading = (R − L) ticks × ${R.mm.toPrecision(3)} mm / ${TT_TRACK_M * 1000} mm → ${R.headStep.toPrecision(2)}° per tick · ${(R.mis * 100).toFixed(0)} % mismatch → ${R.drift.toFixed(1)}° per m`
  },
  legend: [
    { color: GREY, label: 'True speed / path', shape: 'dot' },
    { color: RING, label: 'From ticks: speed / odometry', shape: 'dot' },
    { color: HEAT, label: 'Left wheel ticks', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Speed is ticks over time, measured two ways. Window: count ticks for a fixed time (say 20 ms) and divide. Simple, but the answer moves in steps of one tick per window: with a 10 mm tick and 20 ms, 0, 510, 1020 mm/s — useless at walking pace.',
    'Period: timestamp every tick with micros() and divide mm/tick by the gap. Precise at low speed, but it updates only when a tick comes (set it to zero after a timeout), and at high speed the gap shrinks to a few µs and jitters.',
    'Fine ticks fix both: the hall encoder’s 0.1 mm ticks give 5 mm/s steps in a 20 ms window. Most robots use a 10–50 ms window for the speed PID (see Speed control), longer if the encoder is coarse.',
    'Two wheels give heading too: Δθ = (right − left) travel / track width. TT motors are never matched; a few % faster right motor curves the car left, and the counts show it. A 10 mm tick on a 130 mm track is 4.4° per tick of difference.',
  ],
  controls: [
    encChoice,
    { kind: 'choice', key: 'method', options: opts(METHOD), initial: 'w20' },
    { kind: 'slider', key: 'speed', label: 'Speed', min: 20, max: 600, step: 10, initial: 150, format: (v) => `${v} mm/s` },
    { kind: 'slider', key: 'mis', label: 'Right motor', min: -10, max: 10, step: 1, initial: 4, format: (v) => `${v > 0 ? '+' : ''}${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const at = (x: number, y: number, z = 0): V3 => [SP.o[0] + x * SP.sc, SP.o[1] + y * SP.sc, SP.o[2] + z]
    const [FW, FH] = SP.field
    box(scene, [FW * SP.sc, FH * SP.sc, 0.3], mat('#2c2f36', { rough: 0.85 }), at(FW / 2, FH / 2, -0.3))
    const gridMat = mat('#3d414a')
    for (let x = 0; x <= FW + 1e-6; x += 0.25) box(scene, [0.05, FH * SP.sc, 0.04], gridMat, at(x, FH / 2, -0.12))
    for (let y = 0; y <= FH + 1e-6; y += 0.25) box(scene, [FW * SP.sc, 0.05, 0.04], gridMat, at(FW / 2, y, -0.12))
    partLetter(scene, '25 cm grid', at(FW, -0.06), 0.36, GREY, 'right')
    // Robot, top view: chassis, two wheels, caster.
    const robot = add(scene, new THREE.Group())
    const k = SP.robotK
    const tw = (TT_TRACK_M * SP.sc * k) / 2
    box(robot, [3, tw * 2 - 0.9, 0.4], mat('#d8dbe2', { rough: 0.55 }), [0, 0, 0.3])
    box(robot, [1.1, 1.3, 0.12], mat('#1d6fd1', { rough: 0.5 }), [0.2, 0, 0.56])
    const wheels = [-1, 1].map((side) => {
      const w = add(robot, new THREE.Group(), [0, side * tw, 0.4])
      const tyre = add(w, buildWheel())
      tyre.scale.setScalar((0.065 * SP.sc * k) / 25.6)
      tyre.rotation.x = Math.PI / 2
      return w
    })
    cylinder(robot, 0.18, 0.3, mat('#8a8f99'), [-1.2, 0, 0.1], 'z', 12)
    const ghost = add(scene, mesh(new THREE.ConeGeometry(0.35, 1.1, 12), glowMat(RING, 1.2)))
    const truePath = rayFan(scene, 400, glowMat(GREY, 0.9), 0.16)
    const odoPath = rayFan(scene, 400, glowMat(RING, 1.0), 0.07)
    const lText = liveLabel(scene, at(0, FH + 0.12), { size: 0.42, align: 'left' })
    const hText = liveLabel(scene, at(0, FH + 0.25), { size: 0.42, align: 'left' })
    // Speed plot (left wheel).
    const plot = scope(scene, PL.w, PL.h, { divs: [10, 4], zeroAt: 0 })
    plot.group.position.set(PL.x, PL.y, 0)
    const trueTrace = plot.trace(GREY, { samples: SP.samples, radius: 0.06 })
    const measTrace = plot.trace(RING, { samples: SP.samples, radius: 0.08 })
    const tickMarks = pointCloud(plot.group, 260, 0.09)
    partLetter(scene, `left wheel speed, last ${SP.plotS} s`, [PL.x, PL.y - PL.h / 2 - 0.9, 0], 0.36, LABEL)
    const topText = liveLabel(scene, [PL.x + PL.w / 2, PL.y + PL.h / 2 + 0.7, 0], { size: 0.36, align: 'right' })
    const code = codeBlock(scene, [-25, 14.6, 0], 0.34, 4)
    const status = liveLabel(scene, [-25, -12.4, 0.3], { size: 0.38, align: 'left' })
    const s = {
      key: '',
      T: 0,
      dl: 0,
      dr: 0,
      truePose: { x: 0, y: 0, th: 0 } as Pose,
      odoPose: { x: 0, y: 0, th: 0 } as Pose,
      tl: 0,
      tr: 0,
      trail: [] as [V3, V3][],
      odoTrail: [] as [V3, V3][],
      winStart: 0,
      winTicks: 0,
      meas: 0,
      lastTick: -Infinity,
      prevTick: -Infinity,
      hist: [] as [number, number][],
      ticks: [] as number[],
      slot: 0,
    }
    const reset = () => {
      Object.assign(s, { T: 0, dl: 0, dr: 0, tl: 0, tr: 0, trail: [], odoTrail: [], winStart: 0, winTicks: 0, meas: 0, lastTick: -Infinity, prevTick: -Infinity, hist: [], ticks: [], slot: 0 })
      s.truePose = { x: SP.start[0], y: SP.start[1], th: 0 }
      s.odoPose = { ...s.truePose }
    }
    const tickColor = new THREE.Color(HEAT)
    return {
      scene,
      view: { center: [-1.5, 1.5, 0], radius: 80, polar: 1.4, azimuth: 0.04 },
      frame(dt, p) {
        const R = spRun(p)
        if (R.enc + R.method + R.v + R.mis !== s.key) {
          reset()
          s.key = R.enc + R.method + R.v + R.mis
        }
        const h = dt / SP.slow
        const t0 = s.T
        s.T += h
        const vL = R.v * (1 + SP.wobble * Math.sin((2 * Math.PI * s.T) / 1.6))
        const vR = vL * (1 + R.mis)
        // Left wheel ticks inside this step, with their times.
        const dl0 = s.dl
        s.dl += vL * h
        s.dr += vR * h
        const tl = ticksAt(s.dl, R.mm)
        for (let k2 = ticksAt(dl0, R.mm) + 1; k2 <= tl; k2++) {
          const tk = t0 + ((k2 * R.mm - dl0) / (s.dl - dl0)) * h
          s.prevTick = s.lastTick
          s.lastTick = tk
          s.ticks.push(tk)
          if (!R.W && Number.isFinite(s.prevTick)) s.meas = periodSpeed(s.lastTick - s.prevTick, R.mm)
        }
        if (!R.W && s.T - s.lastTick > SP.timeout) s.meas = 0
        if (R.W)
          while (s.T >= s.winStart + R.W) {
            s.winStart += R.W
            const now = ticksAt(s.dl - vL * (s.T - s.winStart), R.mm)
            s.meas = windowSpeed(now - s.winTicks, R.mm, R.W)
            s.winTicks = now
          }
        // Poses: truth from wheel travel, odometry from counted ticks.
        const tr = ticksAt(s.dr, R.mm)
        const prevTrue = s.truePose
        s.truePose = odoStep(s.truePose, (vL * h) / 1000, (vR * h) / 1000, TT_TRACK_M)
        const prevOdo = s.odoPose
        s.odoPose = odoStep(s.odoPose, ((tl - s.tl) * R.mm) / 1000, ((tr - s.tr) * R.mm) / 1000, TT_TRACK_M)
        s.tl = tl
        s.tr = tr
        const z = 0.05
        if (Math.hypot(s.truePose.x - prevTrue.x, s.truePose.y - prevTrue.y) > 0) {
          const last = s.trail.at(-1)
          const pt = at(s.truePose.x, s.truePose.y, z)
          if (!last || Math.hypot(pt[0] - last[1][0], pt[1] - last[1][1]) > 0.25) s.trail.push([last ? last[1] : at(prevTrue.x, prevTrue.y, z), pt])
          const lo = s.odoTrail.at(-1)
          const po = at(s.odoPose.x, s.odoPose.y, z + 0.05)
          if (!lo || Math.hypot(po[0] - lo[1][0], po[1] - lo[1][1]) > 0.25) s.odoTrail.push([lo ? lo[1] : at(prevOdo.x, prevOdo.y, z + 0.05), po])
        }
        truePath(s.trail)
        odoPath(s.odoTrail)
        const P = s.truePose
        robot.position.set(...at(P.x, P.y))
        robot.rotation.z = P.th
        wheels.forEach((w, i) => (w.children[0].rotation.z = -(i ? s.dr : s.dl) / (TT_WHEEL_MM / 2)))
        const O = s.odoPose
        ghost.position.set(...at(O.x + 0.07 * Math.cos(O.th), O.y + 0.07 * Math.sin(O.th), 1.2))
        ghost.rotation.z = O.th - Math.PI / 2
        if (P.x > FW - 0.15 || P.y < 0.1 || P.y > FH - 0.1) reset()
        // Plot history.
        const slotS = SP.plotS / (SP.samples - 1)
        while (s.slot * slotS <= s.T) {
          s.hist.push([vL, s.meas])
          if (s.hist.length > SP.samples) s.hist.shift()
          s.slot++
        }
        const vmax = Math.max(1.6 * R.v, Math.min(1.1 * R.step, 4 * R.v))
        const yOf = (v: number) => -PL.h / 2 + 0.1 + (Math.min(vmax, v) / vmax) * (PL.h - 0.2)
        const H = s.hist
        const off = SP.samples - H.length
        trueTrace.draw((u) => yOf(H[Math.max(0, Math.round(u * (SP.samples - 1)) - off)]?.[0] ?? 0), H.length ? 1 : null)
        measTrace.draw((u) => yOf(H[Math.max(0, Math.round(u * (SP.samples - 1)) - off)]?.[1] ?? 0), H.length ? 1 : null)
        while (s.ticks.length && s.ticks[0] < s.T - SP.plotS) s.ticks.shift()
        const shown = s.ticks.length <= 260 ? s.ticks : []
        shown.forEach((tk, i) => tickMarks.set(i, [plot.xAt(1 - (s.T - tk) / SP.plotS), -PL.h / 2 + 0.3, 0.35], tickColor))
        tickMarks.show(shown.length)
        topText.set(`${Math.round(vmax)} mm/s${s.ticks.length > 260 ? ' · ticks too dense to draw' : ' · orange = ticks'}`, GREY)
        const headOdo = deg(O.th)
        lText.set(`L ${tl} ticks · R ${tr} ticks · Δ ${tr - tl}`, LABEL)
        hText.set(`heading from ticks ${headOdo.toFixed(1)}° · true ${deg(P.th).toFixed(1)}°`, Math.abs(headOdo - deg(P.th)) > 3 ? HEAT : POWER)
        code(
          R.W
            ? [
                `// every ${R.W * 1000} ms, from a hardware timer`,
                'noInterrupts();  long n = ticks;  ticks = 0;  interrupts();',
                `float v = n * MM_PER_TICK / ${R.W};  // mm/s, steps of ${R.step.toFixed(R.step < 10 ? 1 : 0)}`,
                `// n = ${Math.round((s.meas * R.W) / R.mm)} → v = ${s.meas.toFixed(0)} mm/s (true ${vL.toFixed(0)})`,
              ]
            : [
                'void IRAM_ATTR isr() { period = micros() - last;  last += period; }',
                'float v = MM_PER_TICK * 1e6 / period;  // mm/s',
                `if (micros() - last > ${SP.timeout * 1e6}) v = 0;  // stalled`,
                `// period = ${s.meas ? Math.round((R.mm / s.meas) * 1e6) : '—'} µs → v = ${s.meas.toFixed(0)} mm/s (true ${vL.toFixed(0)})`,
              ],
        )
        status.set(`t = ${s.T.toFixed(2)} s · slowed ${SP.slow}× · ${R.tpr} ticks/rev, ${R.mm.toPrecision(3)} mm/tick · track ${TT_TRACK_M * 1000} mm`, LABEL)
      },
      readouts: (p) => {
        const R = spRun(p)
        const vL = R.v * (1 + SP.wobble * Math.sin((2 * Math.PI * s.T) / 1.6))
        const err = s.meas - vL
        return [
          { label: 'Measured / true', value: `${s.meas.toFixed(0)} / ${vL.toFixed(0)} mm/s`, tone: Math.abs(err) > 0.15 * vL ? 'warn' : 'ok' },
          { label: R.W ? 'Speed step' : 'Δt between ticks', value: R.W ? `${R.step.toFixed(R.step < 10 ? 1 : 0)} mm/s` : us(R.mm / R.v) },
          { label: 'Heading per tick', value: `${R.headStep.toPrecision(2)}°` },
          { label: 'Drift per m', value: `${R.drift.toFixed(1)}°`, tone: Math.abs(R.drift) > 2 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
