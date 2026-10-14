import * as THREE from 'three/webgpu'
import {
  AMBIENT_C,
  BMS_LIMITS,
  CHEMISTRIES,
  ChargePhase,
  TP4056,
  Tp4056Point,
  chargeCurve,
  chargerWatts,
  dieC,
  liionCharger,
  sampleAt,
  tp4056Amps,
  tp4056Point,
} from '../../core/physics'
import { amps, fitDigits, pct, volts, watts } from '../../core/units'
import { V3, add, box, mat, mesh, rod, tube } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  GREY,
  HIGH_V,
  LABEL,
  LOW_V,
  POWER,
  RING,
  cell18650,
  cell18650Height,
  chargeTank,
  clamp01,
  emptyGroup,
  glide,
  glowMat,
  heatWaves,
  ivScreen,
  label,
  plusFlow,
  pulseLabel,
  thermistorAlong,
  thermometer,
  ticks,
  tp4056Module,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const LI = CHEMISTRIES.liion
const EMPTY_SOC = -0.01
const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${+h.toFixed(1)} h`)
const PHASE_TEXT: Record<ChargePhase | 'paused', string> = { pre: 'PRE-CHARGE', cc: 'CC', cv: 'CV', done: 'FULL', cut: 'BMS CUT', paused: 'PAUSED' }
const kOhm = (r: number) => `${+(r / 1000).toFixed(1)}k`

/** TP4056 board with an 18650 (+ end right) in a holder below it, fed by a USB-C cable from the left. `fill(soc)` sets the
 *  gauge under the cell; `flow` carries current USB → B+ → cell → B− → USB. */
function chargerRig(scene: THREE.Object3D, boardAt: V3, cellAt: V3) {
  const board = tp4056Module(scene, boardAt, 0.5)
  const r = 1.1
  const h = cell18650Height(r)
  const cell = cell18650(scene, cellAt, r)
  cell.rotation.z = -Math.PI / 2
  const [cx, cy] = cellAt
  const x0 = cx - h / 2
  const x1 = cx + h / 2
  const black = mat('#1c1c1f', { rough: 0.7 })
  box(scene, [h + 1.4, 2 * r + 0.5, 1], black, [cx, cy, -r - 0.1])
  for (const x of [x0 - 0.45, x1 + 0.45]) box(scene, [0.3, 2 * r + 0.5, 2.4], black, [x, cy, -0.4])
  const { bP, bM } = board.pins
  const xp = x1 + 1.3
  const xm = bM[0] + 1.2
  const mid = (bM[1] + cy + r) / 2 - 1
  const xl = x0 - 1.3
  wire(scene, [bP, [xp, bP[1], bP[2]], [xp, cy, 0], [x1 + 0.3, cy, 0]], 0.18)
  wire(scene, [bM, [xm, bM[1], bM[2]], [xm, mid, 0], [xl, mid, 0], [xl, cy, 0], [x0 - 0.3, cy, 0]], 0.18)

  const u = board.usb
  const plugX = u[0] - 1.6
  const plastic = mat('#2a2c32', { rough: 0.6 })
  box(scene, [3.2, 3.6, 2.4], plastic, [plugX, u[1], u[2]])
  box(scene, [1.2, 4.2, 1.6], plastic, [plugX - 1.8, u[1], u[2]])
  tube(scene, [[plugX - 2.2, u[1], u[2]], [plugX - 3.6, u[1], u[2]], [plugX - 4.6, u[1] - 1.4, u[2]], [plugX - 4.6, u[1] - 6, u[2]]], 0.5, plastic)
  add(scene, label('USB 5 V', { size: 0.6, color: LABEL }), [plugX - 1, u[1] + 3, 0])

  const z = 2.4
  const top = u[1] + 0.9
  const bot = u[1] - 0.9
  const loop: V3[] = [
    [plugX - 3, top, z], [u[0] + 6, top, z], [bP[0], bP[1], z], [xp, bP[1], z], [xp, cy, z], [x0, cy, z], [xl, cy, z], [xl, mid, z], [xm, mid, z],
    [xm, bM[1], z], [bM[0], bM[1], z], [u[0] + 6, bot, z], [plugX - 3, bot, z],
  ]
  const flow = plusFlow(scene, loop, (q) => {
    if (q.y > (top + bot) / 2 + 0.2 && q.x < u[0] + 5.5) return 1
    if (q.y > bM[1] + 0.5 || q.x > xp - 0.5) return 0.82
    if (Math.abs(q.y - cy) <= 0.5 && q.x > x0 - 0.5) return 0.82 * clamp01((q.x - x0) / h)
    return 0
  }, true)

  const gaugeY = cy - r - 0.9
  box(scene, [h, 0.55, 0.3], plastic, [cx, gaugeY, 0])
  const gauge = add(scene, mesh(new THREE.BoxGeometry(1, 0.4, 0.4), glowMat(POWER, 0.7)), [cx, gaugeY, 0.05])
  return {
    board,
    flow,
    under: [cx, gaugeY - 1.9, 0] as V3,
    cellSpan: [x0, x1] as [number, number],
    fill(soc: number) {
      const f = Math.max(0.002, clamp01(soc))
      gauge.scale.x = f * (h - 0.2)
      gauge.position.x = x0 + 0.1 + (f * (h - 0.2)) / 2
    },
  }
}

// --- TP4056: the module on every robot. R_PROG sets the current; red LED while charging, blue when full. ---

const R_PROG = [10000, 4000, 2000, 1200]
const BOARD1: V3 = [-3, 4.4, 0]
const CELL1: V3 = [1.2, -3.4, 0]
const PLAY1_S = 12
const HOLD1_S = 2.5

const solveTp = (p: Params) => {
  const r = n(p, 'rprog')
  const set = tp4056Amps(r)
  const curve = chargeCurve(LI, liionCharger(set), EMPTY_SOC, { dtS: 30, maxHours: 40 })
  const end = curve[curve.length - 1].hours
  return { r, set, curve, end, speedup: Math.round((end * 3600) / PLAY1_S) }
}

export const tp4056: Lesson = {
  id: 'charging-tp4056',
  title: 'TP4056',
  tagline: 'The one-dollar board that charges a cell from USB',
  formula: (p) => {
    const s = solveTp(p)
    return `I = 1200 × 1 V / R_PROG = 1200 / ${kOhm(s.r)}Ω = ${amps(s.set)} · then hold 4.2 V, stop at ${amps(s.set / 10)}`
  },
  legend: [
    { color: HIGH_V, label: 'USB + (5 V)', shape: 'dot' },
    { color: LOW_V, label: 'Ground (−)', shape: 'dot' },
    { color: POWER, label: 'Cell charge', shape: 'dot' },
    { color: RING, label: 'Cell voltage', shape: 'dot' },
  ],
  points: [
    'The TP4056 is a linear Li-ion charger: USB 5 V in, a single cell out. Most modules add a DW01 + 8205A protection pair on B−.',
    'R_PROG (R3 on the board) sets the charge current: I = 1200 / R. Modules ship with 1.2 kΩ, i.e. 1 A. Swap it for a smaller cell.',
    'A flat cell (< 2.9 V) first gets a gentle pre-charge at I/10. Then constant current until the cell reaches 4.2 V, then constant voltage while the current fades.',
    'Charging stops when the current falls to I/10. Red LED = charging, blue = full.',
    'Linear means the difference is burned: (5 V − Vbat) × I. At 1 A that is over a watt, so the chip runs hot and throttles itself at 120 °C.',
    'Wire B+ / B− to the cell, OUT+ / OUT− to the robot. Never charge a pack of cells in series with one TP4056: it is a 1S charger.',
  ],
  controls: [{ kind: 'choice', key: 'rprog', options: R_PROG.map((r) => ({ value: String(r), label: `${kOhm(r)}Ω` })), initial: '1200' }],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const rig = chargerRig(scene, BOARD1, CELL1)
    const callout = add(scene, new THREE.Group())
    const lab: V3 = [rig.board.rProg[0] - 0.3, BOARD1[1] - 6.2, 0]
    rod(scene, rig.board.rProg, [rig.board.rProg[0], lab[1] + 0.9, rig.board.rProg[2]], 0.06, glowMat(RING, 0.6))
    const vLabel = pulseLabel(scene, 4, RING, [rig.under[0] - 1.6, rig.under[1], 0], 1.3)
    const phaseTag = add(scene, new THREE.Group(), [rig.under[0] + 2.6, rig.under[1] - 0.6, 0])
    const heat = heatWaves(scene, 2, { count: 3, rise: 3 })
    heat.group.position.set(rig.board.chipTop[0], rig.board.chipTop[1] + 1.4, rig.board.chipTop[2] + 0.5)
    const st = { key: '', t: 0, phase: '', s: solveTp({ rprog: 1200 }) }

    const now = () => sampleAt(st.s.curve, Math.min(st.t, PLAY1_S) * (st.s.end / PLAY1_S))
    return {
      scene,
      view: { center: [-3, 0.6, 0], radius: 46, polar: 1.3, azimuth: 0.15 },
      frame(dt, p) {
        const s = solveTp(p)
        if (`${s.r}` !== st.key) {
          st.key = `${s.r}`
          st.s = s
          st.t = 0
          emptyGroup(callout)
          add(callout, label(`R3 = ${kOhm(s.r)}Ω = ${amps(s.set)}`, { size: 0.7, color: RING, align: 'right' }), lab)
        }
        st.t += dt
        if (st.t > PLAY1_S + HOLD1_S) st.t = 0
        const k = now()
        const charging = k.phase !== 'done'
        const die = Math.min(TP4056.dieLimitC, dieC(AMBIENT_C, k.volts, k.amps))
        rig.board.set(charging, !charging, (die - 80) / 60)
        heat.step(dt, (die - 60) / 60)
        rig.flow.mesh.visible = charging
        rig.flow.step(dt * (0.5 + 4 * k.amps))
        rig.fill(k.soc)
        vLabel.show(fitDigits(k.volts, 4))
        vLabel.frame(dt)
        if (k.phase !== st.phase) {
          st.phase = k.phase
          emptyGroup(phaseTag)
          add(phaseTag, label(PHASE_TEXT[k.phase], { size: 0.8, color: charging ? LABEL : POWER, align: 'left' }))
        }
      },
      readouts: () => {
        const k = now()
        const w = chargerWatts(k.volts, k.amps)
        return [
          { label: 'Charge current', value: k.phase === 'done' ? 'off' : `${amps(k.amps)} (${PHASE_TEXT[k.phase]})` },
          { label: 'Cell voltage · charge', value: `${volts(k.volts)} · ${pct(clamp01(k.soc))}` },
          { label: 'Chip heat (5 V − Vbat) × I', value: watts(w), tone: w > 1.4 ? 'warn' : undefined },
          { label: `Time (${st.s.speedup}× fast)`, value: hours(k.hours) },
        ]
      },
    }
  },
}

// --- Charge curve: CC then CV on a plot; current tapers to I/10 and the charger stops. A CC-only supply overshoots. ---

const RATES = [0.25, 0.5, 1]
const TANK2: V3 = [-11, -1.4, 0]
const PLOT2: V3 = [3, -1, 0]
const PLOT2_W = 14
const PLOT2_H = 8
const V2_LO = 2.6
const V2_HI = 4.4
const I2_TOP = 0.62
const PLAY2_S = 10
const HOLD2_S = 2.5

const solveCurve = (p: Params) => {
  const c = n(p, 'rate')
  const set = (c * LI.cell.mAh) / 1000
  const cccv = p.mode !== 'cc'
  const curve = chargeCurve(LI, liionCharger(set, cccv ? LI.full : Infinity), EMPTY_SOC, { dtS: 15, cutVolts: BMS_LIMITS.ovp })
  const end = curve[curve.length - 1].hours
  const span = Math.max(1, Math.ceil(end))
  return { c, set, cccv, curve, end, span, speedup: Math.round((end * 3600) / PLAY2_S) }
}

export const chargeCurveLesson: Lesson = {
  id: 'charging-charge-curve',
  title: 'Charge curve',
  tagline: 'Constant current, then constant voltage, then stop',
  formula: (p) => {
    const s = solveCurve(p)
    return s.cccv
      ? `CC at ${amps(s.set)} until 4.2 V · CV at 4.2 V while I falls · stop at I/10 = ${amps(s.set / 10)}`
      : `CC at ${amps(s.set)}, no voltage limit · only the BMS stops it at ${BMS_LIMITS.ovp} V`
  },
  legend: [
    { color: RING, label: 'Cell voltage', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Charge current', shape: 'dot' },
    { color: HIGH_V, label: '4.2 V limit (BMS trip above)', shape: 'dot' },
    { color: POWER, label: 'Charge in the cell', shape: 'dot' },
  ],
  points: [
    'Li-ion charges in two stages. Constant current (CC): the charger pushes a fixed current and the voltage climbs.',
    'At 4.2 V it switches to constant voltage (CV): it holds 4.2 V and the current tapers as the cell fills up.',
    'When the current drops to about a tenth of the set value the cell is ~98 % full and the charger stops. Never trickle a Li-ion cell at 4.2 V for days.',
    'Charging faster shortens CC but the CV tail stays: at 1C the cell hits 4.2 V half-full, because I × R lifts the terminal voltage.',
    'A plain bench supply set to a current but no 4.2 V limit keeps pushing: the voltage runs past 4.2 V and only a BMS saves the cell.',
    'A cell below ~2.9 V is first pre-charged at I/10, to recover it gently (or reveal it is dead).',
  ],
  controls: [
    { kind: 'choice', key: 'rate', options: RATES.map((c) => ({ value: String(c), label: `${c}C` })), initial: '0.5' },
    {
      kind: 'choice',
      key: 'mode',
      options: [
        { value: 'cccv', label: 'CC/CV charger' },
        { value: 'cc', label: 'CC only' },
      ],
      initial: 'cccv',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const tank = chargeTank(8, 1.6)
    add(scene, tank.group, TANK2)
    const tankLabel = pulseLabel(scene, 4, RING, [TANK2[0], TANK2[1] + 6.2, 0], 1.2)
    const { plot, dot, y } = ivScreen(scene, PLOT2, PLOT2_W, PLOT2_H, [6, 6])
    const yV = (v: number) => y((v - V2_LO) / (V2_HI - V2_LO))
    const vTicks: [number, string][] = [3, 3.5, 4].map((v) => [(v - V2_LO) / (V2_HI - V2_LO), String(v)])
    plot.level(HIGH_V).set(yV(LI.full))
    const vTrace = plot.trace(RING, { radius: 0.1 })
    const iTrace = plot.trace(CONVENTIONAL, { radius: 0.1 })
    const iLevel = plot.level(CONVENTIONAL, 0.35)
    iLevel.set(y(I2_TOP / 10))
    const iDot = add(plot.group, mesh(new THREE.SphereGeometry(0.36, 16, 12), glowMat(CONVENTIONAL, 1.4)))
    add(plot.group, label('V', { size: 0.6, color: RING }), [PLOT2_W / 2 + 1.5, PLOT2_H / 2 + 0.9, 0])
    add(plot.group, label('I', { size: 0.6, color: CONVENTIONAL }), [-PLOT2_W / 2 - 1.2, PLOT2_H / 2 + 0.9, 0])
    add(plot.group, label('I/10', { size: 0.45, color: CONVENTIONAL, align: 'right' }), [-PLOT2_W / 2 - 0.5, y(I2_TOP / 10) - 0.2, 0])
    add(plot.group, label('HOURS', { size: 0.5, color: GREY }), [0, -PLOT2_H / 2 - 2.3, 0])
    const dynamic = add(plot.group, new THREE.Group())
    const phaseTag = add(scene, new THREE.Group(), [TANK2[0], TANK2[1] - 6, 0])
    const st = { key: '', t: 0, phase: '', s: solveCurve({ rate: 0.5, mode: 'cccv' }) }
    const now = () => sampleAt(st.s.curve, Math.min(st.t, PLAY2_S) * (st.s.end / PLAY2_S))
    const xOf = (h: number) => plot.xAt(h / st.s.span)

    return {
      scene,
      view: { center: [-0.4, -1.2, 0], radius: 46, polar: 1.36, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveCurve(p)
        const key = `${s.c}|${s.cccv}`
        if (key !== st.key) {
          st.key = key
          st.s = s
          st.t = 0
          const f = s.end / s.span
          const at = (u: number) => sampleAt(s.curve, u * s.end)
          for (const [t, fn] of [[vTrace, (u: number) => yV(at(u).volts)], [iTrace, (u: number) => y((at(u).amps / s.set) * I2_TOP)]] as const) {
            t.draw(fn, null)
            t.group.scale.x = f
            t.group.position.x = (-PLOT2_W / 2) * (1 - f)
          }
          emptyGroup(dynamic)
          const step = s.span > 6 ? 2 : 1
          ticks({ ...plot, group: dynamic }, Array.from({ length: Math.floor(s.span / step) + 1 }, (_, i): [number, string] => [(i * step) / s.span, String(i * step)]), vTicks)
          add(dynamic, label(amps(s.set), { size: 0.45, color: CONVENTIONAL, align: 'right' }), [-PLOT2_W / 2 - 0.5, y(I2_TOP) - 0.2, 0])
          let prev = s.curve[0]
          for (const k of s.curve) {
            if (k.phase !== prev.phase || k === s.curve[s.curve.length - 1]) {
              const x = (xOf(prev.hours) + xOf(k.hours)) / 2
              if (xOf(k.hours) - xOf(prev.hours) > 1.4 && prev.phase !== 'pre')
                add(dynamic, label(PHASE_TEXT[prev.phase], { size: 0.55, color: LABEL }), [x, PLOT2_H / 2 + 0.9, 0])
              if (k.phase !== prev.phase) add(dynamic, mesh(new THREE.BoxGeometry(0.06, PLOT2_H, 0.06), glowMat(GREY, 0.4))).position.set(xOf(k.hours), 0, 0.15)
              prev = k
            }
          }
        }
        st.t += dt
        if (st.t > PLAY2_S + HOLD2_S) st.t = 0
        const k = now()
        dot.position.set(xOf(k.hours), yV(k.volts), 0.3)
        iDot.position.set(xOf(k.hours), y((k.amps / st.s.set) * I2_TOP), 0.3)
        tank.set(clamp01(k.soc))
        tankLabel.show(fitDigits(k.volts, 4))
        tankLabel.frame(dt)
        if (k.phase !== st.phase) {
          st.phase = k.phase
          emptyGroup(phaseTag)
          const bad = k.phase === 'cut'
          add(phaseTag, label(PHASE_TEXT[k.phase], { size: 0.75, color: bad ? HIGH_V : k.phase === 'done' ? POWER : LABEL }))
        }
      },
      readouts: () => {
        const k = now()
        const over = k.volts > LI.full + 0.005
        return [
          { label: 'Stage', value: k.phase === 'cut' ? 'BMS cut: over-charge' : PHASE_TEXT[k.phase], tone: k.phase === 'cut' ? 'bad' : k.phase === 'done' ? 'ok' : undefined },
          { label: 'Cell voltage', value: volts(k.volts), tone: over ? 'bad' : undefined },
          { label: 'Current · charge', value: `${amps(k.amps)} · ${pct(clamp01(k.soc))}` },
          { label: `Time (${st.s.speedup}× fast)`, value: hours(k.hours) },
        ]
      },
    }
  },
}

// --- Thermal limits: the chip throttles itself at 120 °C; an NTC on TEMP pauses charging outside 0 … 45 °C. ---

const RPROG3 = 1200
const BOARD3: V3 = [-1.6, 3.4, 0]
const CELL3: V3 = [2.6, -3.6, 0]
const THERMO3: V3 = [10.4, -7.8, 0]
const THERMO_H = 9
const T_LO = -20
const T_HI = 70
const SOC3 = 0.05
const SPEED3 = 1200
const RESET3_H = 4.5

const tFrac = (c: number) => (c - T_LO) / (T_HI - T_LO)

const statusOf = (k: Tp4056Point, ntc: boolean): { text: string; tone: 'ok' | 'warn' | 'bad' } => {
  if (k.phase === 'paused') return { text: k.cell === 'cold' ? 'PAUSED: TOO COLD' : 'PAUSED: TOO HOT', tone: 'warn' }
  if (!ntc && k.cell === 'cold' && k.amps > 0) return { text: 'PLATING LITHIUM', tone: 'bad' }
  if (!ntc && k.cell === 'hot' && k.amps > 0) return { text: 'CELL TOO HOT', tone: 'bad' }
  if (k.phase === 'done') return { text: 'FULL', tone: 'ok' }
  if (k.throttled) return { text: 'THROTTLED', tone: 'warn' }
  return { text: 'CHARGING', tone: 'ok' }
}

export const thermalLimits: Lesson = {
  id: 'charging-thermal-limits',
  title: 'Thermal limits',
  tagline: 'Too cold, too hot, and a chip that cooks itself',
  formula: (p) => {
    const ta = n(p, 'ambient')
    return `Die = ${Math.round(ta)} °C + ${TP4056.thetaJA} °C/W × (5 V − Vbat) × I, held ≤ ${TP4056.dieLimitC} °C · cell window ${TP4056.coldC} … ${TP4056.hotC} °C`
  },
  legend: [
    { color: POWER, label: 'Safe to charge 0 … 45 °C', shape: 'dot' },
    { color: LOW_V, label: 'Too cold: lithium plating', shape: 'dot' },
    { color: HIGH_V, label: 'Too hot: fast ageing, venting', shape: 'dot' },
    { color: '#ff9a4d', label: 'Heat from the charger chip', shape: 'dot' },
  ],
  points: [
    'Below 0 °C lithium cannot slip into the graphite fast enough and plates out as metal. It never comes back and can grow into a short.',
    'Above 45 °C charging ages the cell fast; far hotter and it can vent or catch fire. Charge only between about 0 and 45 °C.',
    'The TP4056 TEMP pin reads an NTC thermistor taped to the cell and pauses charging outside the window. Most cheap modules tie TEMP to ground: no check at all.',
    'The chip burns (5 V − Vbat) × I. When the die reaches 120 °C it cuts the current instead of shutting down, so a hot day just means a slower charge.',
    'Throttling is worst early in the charge, when the cell is low and the chip drops the most voltage.',
    'Robot tip: don’t charge in a hot car or a cold garage, and give the module some copper or air.',
  ],
  controls: [
    { kind: 'slider', key: 'ambient', label: 'Room temperature', min: -10, max: 60, initial: 25, step: 1, format: (v) => `${Math.round(v)} °C` },
    {
      kind: 'choice',
      key: 'ntc',
      options: [
        { value: 'on', label: 'NTC on TEMP' },
        { value: 'off', label: 'TEMP to GND' },
      ],
      initial: 'on',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const rig = chargerRig(scene, BOARD3, CELL3)
    const [x0, x1] = rig.cellSpan
    const ntcPart = add(scene, new THREE.Group())
    const [cx, cy] = CELL3
    box(ntcPart, [2.8, 1.6, 0.06], mat('#c99a3a', { rough: 0.4 }), [cx, cy, 1.12])
    const bead = thermistorAlong(ntcPart, [cx - 0.8, cy, 1.4], [cx + 0.8, cy, 1.4], 0.6)
    wire(ntcPart, [[cx - 0.75, cy, 1.4], [x0 + 0.8, cy, 1.4], [x0 + 0.8, BOARD3[1] - 3.4, 1.4], [BOARD3[0] - 0.6, BOARD3[1] - 3.4, 0.3]], 0.07)
    add(ntcPart, label('NTC', { size: 0.6, color: LABEL, align: 'right' }), [x0 - 2, cy - 0.3, 0])
    const gndTag = add(scene, label('TEMP = GND', { size: 0.5, color: GREY, align: 'right' }), [x0 - 2, cy - 0.3, 0])

    const thermo = thermometer(THERMO_H)
    add(scene, thermo.group, THERMO3)
    const band = (lo: number, hi: number, color: string) => {
      const h = (tFrac(hi) - tFrac(lo)) * THERMO_H
      box(scene, [0.35, h, 0.35], glowMat(color, 0.5), [THERMO3[0] + 1.1, THERMO3[1] + 0.9 + tFrac(lo) * THERMO_H + h / 2, 0])
    }
    band(T_LO, TP4056.coldC, LOW_V)
    band(TP4056.coldC, TP4056.hotC, POWER)
    band(TP4056.hotC, T_HI, HIGH_V)
    for (const t of [TP4056.coldC, TP4056.hotC]) add(scene, label(`${t}°`, { size: 0.5, color: LABEL, align: 'left' }), [THERMO3[0] + 1.6, THERMO3[1] + 0.65 + tFrac(t) * THERMO_H, 0])
    const tempLabel = pulseLabel(scene, 3, LABEL, [THERMO3[0] + 0.3, THERMO3[1] + THERMO_H + 3, 0], 1.1)

    const chipHeat = heatWaves(scene, 2, { count: 3, rise: 3.4 })
    chipHeat.group.position.set(rig.board.chipTop[0], rig.board.chipTop[1] + 1.4, rig.board.chipTop[2] + 0.5)
    const cellHeat = heatWaves(scene, x1 - x0 - 1, { count: 4, rise: 3 })
    cellHeat.group.position.set(CELL3[0], CELL3[1] + 1.4, 1.2)
    const dieAt: V3 = [BOARD3[0] - 10.6, BOARD3[1] - 8.6, 0]
    const dieLabel = pulseLabel(scene, 3, '#ff9a4d', dieAt, 1.1)
    add(scene, label('CHIP °C', { size: 0.45, color: GREY }), [dieAt[0], dieAt[1] - 1.5, 0])
    const statusTag = add(scene, new THREE.Group(), [rig.under[0], rig.under[1] - 0.3, 0])
    const st = { key: '', h: 0, soc: SOC3, die: AMBIENT_C, status: '', k: tp4056Point(LI, SOC3, RPROG3, AMBIENT_C, true) }

    return {
      scene,
      view: { center: [-0.8, -0.2, 0], radius: 51, polar: 1.3, azimuth: 0.15 },
      frame(dt, p) {
        const ta = n(p, 'ambient')
        const ntc = p.ntc !== 'off'
        const key = `${ta}|${ntc}`
        if (key !== st.key) {
          st.key = key
          st.h = 0
          st.soc = SOC3
        }
        const k = tp4056Point(LI, st.soc, RPROG3, ta, ntc)
        st.k = k
        const dh = (dt * SPEED3) / 3600
        st.h += dh
        st.soc += (k.amps * dh) / (LI.cell.mAh / 1000)
        if (st.h > RESET3_H) {
          st.h = 0
          st.soc = SOC3
        }
        st.die = glide(dt, st.die, k.dieC, 3)
        const charging = k.amps > 0
        rig.board.set(charging, k.phase === 'done', (st.die - 80) / 60)
        chipHeat.step(dt, (st.die - 50) / 60)
        cellHeat.step(dt, charging && k.cell === 'hot' ? 0.8 : 0)
        rig.flow.mesh.visible = charging
        rig.flow.step(dt * (0.5 + 4 * k.amps))
        rig.fill(st.soc)
        ntcPart.visible = ntc
        gndTag.visible = !ntc
        bead.set(tFrac(ta))
        thermo.set(tFrac(ta))
        tempLabel.show(String(Math.round(ta)))
        tempLabel.frame(dt)
        dieLabel.show(String(Math.round(st.die)))
        dieLabel.frame(dt)
        const s = statusOf(k, ntc)
        if (s.text !== st.status) {
          st.status = s.text
          emptyGroup(statusTag)
          add(statusTag, label(s.text, { size: 0.75, color: s.tone === 'bad' ? HIGH_V : s.tone === 'warn' ? RING : POWER }))
        }
      },
      readouts: (p) => {
        const k = st.k
        const s = statusOf(k, p.ntc !== 'off')
        return [
          { label: 'Charger', value: s.text.toLowerCase(), tone: s.tone },
          { label: 'Charge current (set 1 A)', value: k.amps > 0 ? amps(k.amps) : 'off', tone: k.throttled ? 'warn' : undefined },
          { label: 'Chip die · heat', value: `${Math.round(k.dieC)} °C · ${watts(chargerWatts(k.volts, k.amps))}`, tone: k.dieC >= TP4056.dieLimitC - 0.5 ? 'warn' : undefined },
          { label: `Time (${SPEED3}× fast) · charge`, value: `${hours(st.h)} · ${pct(clamp01(st.soc))}` },
        ]
      },
    }
  },
}
