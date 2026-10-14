import * as THREE from 'three/webgpu'
import { BMS_LIMITS, CHEMISTRIES, BmsFault, bmsTrip, cellVolts, driftWeeks, loadedCellVolts, packRating, powerI2R } from '../../core/physics'
import { amps, fitDigits, volts, watts } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  GREY,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  cellPackModel,
  chargeTank,
  clamp01,
  emptyGroup,
  glide,
  glowMat,
  heatWaves,
  ivScreen,
  label,
  motorCan,
  plusFlow,
  pulseLabel,
  resistorAlong,
  smoke,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const LI = CHEMISTRIES.liion
const CELL_MAX_A = 10
const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${+h.toFixed(1)} h`)
const mAh = (x: number) => `${Math.round(x)} mAh`

// --- 1S to 4S: weld cells into a pack; series stacks volts, parallel stacks capacity and current. ---

const S_OPTIONS = [1, 2, 3, 4]
const P_OPTIONS = [1, 2, 3]
const PACK1: V3 = [-4.5, -0.6, 0]
const MOTOR1: V3 = [8.4, 3.6, 0]
const MOTOR1_R = 1.6
const WELD_S = 2.4
const RPM_PER_V = 160

const solvePack = (p: Params) => {
  const s = n(p, 's')
  const par = n(p, 'p')
  return { s, par, ...packRating(LI, s, par, CELL_MAX_A) }
}

export const oneSToFourS: Lesson = {
  id: '18650-packs-1s-to-4s',
  title: '1S to 4S',
  tagline: 'Weld cells into the pack your robot needs',
  formula: (p) => {
    const k = solvePack(p)
    return `${k.s}S${k.par}P: ${k.s} × ${LI.nominal} V = ${volts(k.volts)}, ${k.par} × ${LI.cell.mAh} mAh = ${mAh(k.mAh)}, ${k.par} × ${CELL_MAX_A} A = ${amps(k.maxAmps)}`
  },
  legend: [
    { color: HIGH_V, label: 'Pack + (high potential)', shape: 'dot' },
    { color: '#3d6bff', label: 'Pack − (low potential)', shape: 'dot' },
    { color: '#c4c8ce', label: 'Nickel strip, spot-welded', shape: 'dot' },
    { color: RING, label: 'Voltage at each strip', shape: 'dot' },
  ],
  points: [
    '“3S2P” means 3 cells in series, each one really 2 cells in parallel. Series adds volts; parallel adds capacity and current.',
    'Cells are joined with nickel strip, spot-welded: a short, huge current pulse fuses the strip to the can. Soldering would cook the cell.',
    'The cells alternate + up and − up so one strip can join a + end to the next − end. The strips zig-zag the string.',
    'A Li-ion cell swings from 4.2 V full to 3.0 V empty, so a 3S pack runs 12.6 V down to 9 V. Your regulators must take the whole range.',
    'Robot car: 2S (7.4 V) suits TT motors behind an L298N; 3S (11.1 V) feeds 12 V motors; a buck converter makes 5 V for the ESP32.',
    'Parallel cells share the load: a 10 A cell becomes a 20 A group in 2P. Match cells (same model, same charge) before welding them together.',
  ],
  controls: [
    { kind: 'choice', key: 's', options: S_OPTIONS.map((v) => ({ value: String(v), label: `${v}S` })), initial: '2' },
    { kind: 'choice', key: 'p', options: P_OPTIONS.map((v) => ({ value: String(v), label: `${v}P` })), initial: '1' },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const holder = add(scene, new THREE.Group(), PACK1)
    const motor = motorCan(scene, MOTOR1, { r: MOTOR1_R })
    const [pinL, pinR] = motor.pins
    add(scene, label('MOTOR', { size: 0.6, color: LABEL }), [MOTOR1[0], MOTOR1[1] + MOTOR1_R + 1.2, 0])
    const st = {
      key: '',
      t: 0,
      pack: null as ReturnType<typeof cellPackModel> | null,
      flow: null as ReturnType<typeof plusFlow> | null,
      speed: 0,
    }
    const spark = add(scene, new THREE.PointLight('#bcd8ff', 0, 18, 2))

    const tag = (text: string, size: number, color: string, at: V3) => (add(holder, label(text, { size, color }), at).castShadow = false)
    const rebuild = (s: number, par: number) => {
      emptyGroup(holder)
      const pack = cellPackModel(holder, s, par, { r: 1, dx: 2.5, dz: 2.4 })
      st.pack = pack
      const top = pack.h / 2
      const at = (v: V3): V3 => [v[0] + PACK1[0], v[1] + PACK1[1], v[2] + PACK1[2]]
      const plus = at(pack.plus)
      const minus = at(pack.minus)
      const xa = PACK1[0] + pack.xs[s - 1] + 1.8
      const xb = pinR[0] + 1.4
      const bot = PACK1[1] - top - 1.6
      const wz = pack.front + 0.2
      const z = wz + 0.4
      const local = (pts: V3[]) => pts.map(([x, y, zz]): V3 => [x - PACK1[0], y - PACK1[1], zz])
      wire(holder, local([plus, [plus[0], plus[1], wz], [xa, plus[1], wz], [xa, pinL[1], wz], [pinL[0], pinL[1], wz], pinL]), 0.2)
      wire(holder, local([pinR, [pinR[0], pinR[1], wz], [xb, pinR[1], wz], [xb, bot, wz], [minus[0], bot, wz], [minus[0], minus[1], wz], minus]), 0.2)
      const loop: V3[] = [
        ...pack.chain.map(([x, y]): V3 => [x, y, z]),
        [pack.plus[0], pack.plus[1], z],
        ...local([[xa, plus[1], z], [xa, pinL[1], z], [pinL[0], pinL[1], z], [pinR[0], pinR[1], z], [xb, pinR[1], z], [xb, bot, z], [minus[0], bot, z]]),
      ]
      const gx = PACK1[0] + pack.xs[s - 1] + 0.6
      st.flow = plusFlow(holder, loop, (q) => {
        if (q.y < -top - 0.4 && q.x < pack.xs[0] + 0.4) return 0
        if (q.y < bot - PACK1[1] + 0.2 || q.x > pinL[0] + 0.6 - PACK1[0]) return 0
        if (q.x > gx - PACK1[0]) return 1
        return pack.potentialAt(q.x, q.y)
      }, true)
      st.flow.mesh.visible = false
      pack.xs.forEach((x, i) => {
        const y = (i % 2 === 0 ? 1 : -1) * (top + 0.9)
        tag(`${fitDigits((i + 1) * LI.nominal, 3)} V`, 0.5, RING, [x + 1.25 * (i < s - 1 ? 1 : 0), y + (y > 0 ? 0.3 : -0.6), pack.front + 0.4])
      })
      tag(`${s}S${par}P`, 1, LABEL, [0, top + 2.8, 0])
      pack.weld(0)
    }

    return {
      scene,
      view: { center: [0.8, -1.2, 0], radius: 44, polar: 1.12, azimuth: 0.3 },
      frame(dt, p) {
        const k = solvePack(p)
        const key = `${k.s}|${k.par}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          rebuild(k.s, k.par)
        }
        st.t += dt
        const pack = st.pack!
        const progress = (st.t / WELD_S) * pack.dotCount
        const welding = progress < pack.dotCount + 1
        pack.weld(progress)
        spark.intensity = welding ? 30 * (1 - (progress % 1)) : 0
        if (welding) {
          const strips = pack.chain
          const i = Math.min(strips.length - 1, Math.floor((progress / pack.dotCount) * strips.length))
          spark.position.set(strips[i][0] + PACK1[0], strips[i][1] + PACK1[1] + Math.sign(strips[i][1]) * 0.6, 2)
        }
        st.speed = glide(dt, st.speed, welding ? 0 : k.volts, 3)
        st.flow!.mesh.visible = !welding
        st.flow!.step(dt * (0.6 + 0.25 * st.speed))
        motor.spin(dt, RPM_PER_V * st.speed)
      },
      readouts: (p) => {
        const k = solvePack(p)
        return [
          { label: 'Pack voltage (full → empty)', value: `${volts(k.volts)} (${+k.full.toFixed(1)} → ${+k.empty.toFixed(1)})` },
          { label: 'Capacity · energy', value: `${mAh(k.mAh)} · ${fitDigits(k.wh, 3)} Wh` },
          { label: 'Max continuous current', value: `${amps(k.maxAmps)} (${watts(k.maxWatts)})`, tone: k.maxAmps < 15 ? 'warn' : 'ok' },
          { label: `Weight (${k.cells} cells)`, value: `${k.grams} g` },
        ]
      },
    }
  },
}

// --- BMS protection: a 2S pack behind a protection board; MOSFETs cut the load on a low cell or too much current. ---

const SOC2 = [1, 0.94]
const RUN2_S = 9
const HOLD2_S = 2
const END_SOC = -0.08
const PACK2: V3 = [-11.4, -0.6, 0]
const BMS2: V3 = [-5.8, -7.4, 0]
const MOTOR2: V3 = [-4.2, 3.6, 0]
const PLOT2: V3 = [5.6, 0.4, 0]
const PLOT2_W = 9
const PLOT2_H = 8
const MAH2_MAX = 3200
const V2_LO = 1.5
const V2_HI = 4.5
const FAULT_TEXT: Record<BmsFault, string> = { 'over-current': 'OVER-CURRENT', 'over-charge': 'OVER-CHARGE', 'over-discharge': 'LOW CELL' }

const solveBms = (p: Params) => {
  const load = n(p, 'amps')
  const guarded = p.bms !== 'off'
  const trip = bmsTrip(LI, SOC2, load)
  const endMAh = guarded ? trip.mAh : (Math.min(...SOC2) - END_SOC) * LI.cell.mAh
  const socsAt = (drawn: number) => SOC2.map((s) => s - drawn / LI.cell.mAh)
  return { load, guarded, trip, endMAh, socsAt, heatW: powerI2R(load, LI.cell.ohms), speedup: Math.round((3600 * LI.cell.mAh) / 1000 / load / RUN2_S) }
}

export const bmsProtection: Lesson = {
  id: '18650-packs-bms-protection',
  title: 'BMS protection',
  tagline: 'The board that keeps a pack from killing itself',
  formula: (p) => {
    const s = solveBms(p)
    return `Trip if any cell < ${BMS_LIMITS.uvp} V, > ${BMS_LIMITS.ovp} V, or |I| > ${BMS_LIMITS.ocp} A · now ${amps(s.load)}`
  },
  legend: [
    { color: RING, label: 'Cell A (fuller)', shape: 'dot' },
    { color: '#c58cff', label: 'Cell B (a bit lower)', shape: 'dot' },
    { color: HIGH_V, label: 'Under-voltage cutoff', shape: 'dot' },
    { color: POWER, label: 'MOSFETs on (red = cut)', shape: 'dot' },
  ],
  points: [
    'A BMS (battery management system) sits between the cells and the robot. It watches every cell through balance taps and the current through a shunt.',
    'Two MOSFETs in the − lead are the switch: one blocks discharge, one blocks charge. They open on any fault.',
    'Over-discharge: below about 2.5–2.8 V a Li-ion cell plates copper inside and may never be safe again. The BMS cuts the load on the first low cell, not the pack average.',
    'Over-current: a stalled motor or a dropped screwdriver can pull tens of amps. The BMS trips in milliseconds, long before the cell overheats.',
    'Over-charge: above 4.25 V a cell can vent and burn. The BMS stops charging if a charger or a drifting cell pushes past it.',
    'Without a BMS nothing stops these. Every robot pack of loose 18650s needs one rated for its S count and current.',
  ],
  controls: [
    { kind: 'slider', key: 'amps', label: 'Load current', min: 0.5, max: 30, initial: 3, log: true, format: (v) => amps(v) },
    {
      kind: 'choice',
      key: 'bms',
      options: [
        { value: 'on', label: 'With BMS' },
        { value: 'off', label: 'No BMS' },
      ],
      initial: 'on',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const holder = add(scene, new THREE.Group(), PACK2)
    const pack = cellPackModel(holder, 2, 1, { r: 1.1, dx: 2.8 })
    pack.weld(1e3)
    const top = pack.h / 2
    const at = (v: V3): V3 => [v[0] + PACK2[0], v[1] + PACK2[1], v[2]]
    const minus = at(pack.minus)
    const plus = at(pack.plus)
    ;['A', 'B'].forEach((t, i) => add(scene, label(t, { size: 0.7, color: i ? '#c58cff' : RING }), [PACK2[0] + pack.xs[i], PACK2[1] + top + 1.2, 1.4]))

    const board = add(scene, new THREE.Group(), BMS2)
    box(board, [6, 2.6, 0.2], mat('#1f6a3a', { rough: 0.6 }))
    add(board, label('BMS 2S', { size: 0.45, color: '#e8e8e8' }), [-1.6, 0.75, 0.2])
    box(board, [1.2, 0.9, 0.3], mat('#1c1c1f', { rough: 0.6 }), [-1.6, -0.35, 0.2])
    const fetMat = glowMat(POWER, 0.8)
    const fets = [0.8, 2.2].map((x) => {
      box(board, [1, 1.2, 0.35], mat('#1c1c1f', { rough: 0.6 }), [x, -0.1, 0.25])
      return add(board, new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), fetMat), [x, 0.85, 0.45])
    })
    add(board, label('Q', { size: 0.4, color: LABEL }), [1.5, -1.05, 0.3])
    const left = BMS2[0] - 3
    const right = BMS2[0] + 3
    wire(scene, [minus, [minus[0], BMS2[1], 0], [left, BMS2[1], 0]], 0.2)
    const mid: V3 = [PACK2[0], PACK2[1] + top + 0.1, 0]
    const tapX = PACK2[0] + pack.xs[1] + 0.3
    const tap = add(scene, new THREE.Group())
    wire(tap, [mid, [mid[0], mid[1] + 0.5, -1.5], [tapX, mid[1] + 0.5, -1.5], [tapX, BMS2[1] + 0.9, -1.5], [left, BMS2[1] + 0.9, 0]], 0.08)
    const bypass = add(scene, new THREE.Group())
    wire(bypass, [[left, BMS2[1], 0], [right, BMS2[1], 0]], 0.2)
    const motor = motorCan(scene, MOTOR2, { r: 1.8 })
    const [pinL, pinR] = motor.pins
    const xr = right + 1.2
    wire(scene, [plus, [plus[0], plus[1] - 0.5, 0], [pinL[0] - 1.6, plus[1] - 0.5, 0], [pinL[0] - 1.6, pinL[1], 0], pinL], 0.2)
    wire(scene, [pinR, [xr, pinR[1], 0], [xr, BMS2[1], 0], [right, BMS2[1], 0]], 0.2)
    const z = 1.6
    const st = { key: '', t: 0, drawn: 0, cut: false, s: solveBms({ amps: 3, bms: 'on' }) }
    const lo = plus[1] - 0.5
    const loop: V3[] = [
      [plus[0], plus[1], z], [plus[0], lo, z], [pinL[0] - 1.6, lo, z], [pinL[0] - 1.6, pinL[1], z], [pinL[0], pinL[1], z], [pinR[0], pinR[1], z],
      [xr, pinR[1], z], [xr, BMS2[1], z], [left, BMS2[1], z], [minus[0], BMS2[1], z],
      ...[...pack.chain.map(([x, y]): V3 => [x + PACK2[0], y + PACK2[1], z])],
    ]
    const flow = plusFlow(scene, loop, (q) => {
      const xb = PACK2[0] + pack.xs[1]
      if (q.y < lo - 0.5 || q.x > pinL[0] + 0.5) return 0
      if (q.x > xb + 0.5) return 1
      if (q.y < PACK2[1] - top - 0.2) return q.x > xb - 0.3 ? 1 : 0
      return pack.potentialAt(q.x - PACK2[0], q.y - PACK2[1])
    }, true)
    const heat = heatWaves(scene, 4, { count: 4, rise: 3 })
    heat.group.position.set(PACK2[0], PACK2[1] + top + 1.8, 0)
    const fumes = smoke(scene, 3, { count: 18, rise: 6 })
    fumes.group.position.set(PACK2[0], PACK2[1] + top + 1, 0)
    const cutLabel = add(scene, new THREE.Group(), [MOTOR2[0], MOTOR2[1] + 3, 0])

    const { plot, dot, y } = ivScreen(scene, PLOT2, PLOT2_W, PLOT2_H, [4, 3])
    const yOf = (v: number) => y((v - V2_LO) / (V2_HI - V2_LO))
    ticks(plot, [[0, '0'], [1000 / MAH2_MAX, '1000'], [2000 / MAH2_MAX, '2000'], [3000 / MAH2_MAX, '3000']], [2, 3, 4].map((v): [number, string] => [(v - V2_LO) / (V2_HI - V2_LO), String(v)]))
    add(plot.group, label('mAh DRAWN', { size: 0.5, color: GREY }), [0, -PLOT2_H / 2 - 2.3, 0])
    add(plot.group, label('V', { size: 0.6, color: GREY }), [PLOT2_W / 2 + 1.5, PLOT2_H / 2 + 0.9, 0])
    plot.level(HIGH_V).set(yOf(BMS_LIMITS.uvp))
    const traces = [plot.trace(RING, { radius: 0.1 }), plot.trace('#c58cff', { radius: 0.1 })]
    const vLabel = pulseLabel(plot.group, 3, '#c58cff', [-PLOT2_W / 2 + 1.6, PLOT2_H / 2 + 1.1, 0], 1.1)

    return {
      scene,
      view: { center: [-1.6, -0.6, 0], radius: 50, polar: 1.38, azimuth: 0.15 },
      frame(dt, p) {
        const s = solveBms(p)
        st.s = s
        const key = `${s.load.toFixed(2)}|${s.guarded}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          const f = Math.max(0.01, Math.min(1, s.endMAh / MAH2_MAX))
          traces.forEach((t, i) => {
            t.draw((u) => yOf(loadedCellVolts(LI, s.socsAt(u * f * MAH2_MAX), s.load)[i]), null)
            t.group.scale.x = f
            t.group.position.x = (-PLOT2_W / 2) * (1 - f)
          })
          emptyGroup(cutLabel)
          if (s.guarded) add(cutLabel, label(`CUT: ${FAULT_TEXT[s.trip.fault]}`, { size: 0.55, color: HIGH_V }))
        }
        st.t += dt
        const runS = (RUN2_S * s.endMAh) / LI.cell.mAh
        if (st.t > runS + HOLD2_S) st.t = 0
        st.drawn = (Math.min(st.t, runS) / RUN2_S) * LI.cell.mAh
        st.cut = s.guarded && st.t >= runS
        const flowing = !st.cut && st.t < runS
        cutLabel.visible = st.cut
        board.visible = tap.visible = s.guarded
        bypass.visible = !s.guarded
        fetMat.color.set(st.cut ? HIGH_V : POWER)
        fetMat.emissive.set(st.cut ? HIGH_V : POWER)
        fets.forEach((f) => f.scale.setScalar(st.cut ? 1 + 0.3 * Math.abs(Math.sin(st.t * 8)) : 1))
        flow.mesh.visible = flowing
        flow.step(flowing ? dt * (1 + 2.4 * Math.sqrt(s.load)) : 0)
        motor.spin(dt, flowing ? 220 * Math.min(s.load, 8) : 0)
        const burning = flowing && !s.guarded
        heat.step(dt, flowing ? Math.sqrt(Math.max(0, s.heatW - 0.5) / 16) : 0)
        fumes.step(dt, burning ? clamp01((s.load - CELL_MAX_A) / 10) : 0)
        const v = loadedCellVolts(LI, s.socsAt(st.drawn), flowing ? s.load : 0)
        dot.position.set(plot.xAt(st.drawn / MAH2_MAX), yOf(v[1]), 0.3)
        vLabel.show(fitDigits(Math.max(0, v[1]), 3))
        vLabel.frame(dt)
      },
      readouts: () => {
        const s = st.s
        const flowing = !st.cut && st.t < (RUN2_S * s.endMAh) / LI.cell.mAh
        const v = loadedCellVolts(LI, s.socsAt(st.drawn), flowing ? s.load : 0)
        const dead = v[1] < 2
        return [
          { label: 'Cell A / B', value: `${fitDigits(Math.max(0, v[0]), 3)} / ${fitDigits(Math.max(0, v[1]), 3)} V`, tone: dead ? 'bad' : v[1] < BMS_LIMITS.uvp ? 'warn' : undefined },
          {
            label: 'BMS',
            value: !s.guarded ? (dead ? 'none: cell B ruined' : 'none') : st.cut ? `cut: ${s.trip.fault}` : 'MOSFETs on',
            tone: !s.guarded ? 'bad' : st.cut ? 'warn' : 'ok',
          },
          { label: 'Heat per cell I² × R', value: watts(flowing ? s.heatW : 0), tone: flowing && s.load > CELL_MAX_A ? 'bad' : undefined },
          { label: `Time (${s.speedup}× fast)`, value: hours(st.drawn / 1000 / s.load) },
        ]
      },
    }
  },
}

// --- Balancing: three cells in series leak at different rates; without balancing they drift apart week after week. ---

const CAPS3 = [3000, 2950, 2900]
const LEAK3 = [10, 20, 60]
const WEEKS = 24
const WEEK_S = 1.2
const HOLD3_S = 2.5
const TANK3_H = 7
const TANK3_R = 1.1
const XS3 = [-12.8, -8.8, -4.8]
const TANK3_Y = -0.4
const PLOT3: V3 = [5.8, 0.4, 0]
const PLOT3_W = 9
const PLOT3_H = 8
const U3_LO = 1500
const U3_HI = 3000
const NAMES3 = ['A', 'B', 'C']
const PHASES: [string, number][] = [['CHARGE', 0.35], ['BALANCE', 0.5], ['SHELF', 0.65], ['DRIVE', 1]]
const RUNS = { off: driftWeeks(LI, CAPS3, LEAK3, WEEKS), on: driftWeeks(LI, CAPS3, LEAK3, WEEKS, { balance: true }) }
const runOf = (p: Params) => RUNS[p.balance === 'on' ? 'on' : 'off']

export const balancing: Lesson = {
  id: '18650-packs-balancing',
  title: 'Balancing',
  tagline: 'Series cells drift apart unless something pulls them together',
  formula: () => `Charge stops at ${CAPS3.length} × ${LI.full} V or the first cell at ${BMS_LIMITS.ovp} V; driving stops at the first empty cell`,
  legend: [
    { color: POWER, label: 'Charge in each cell', shape: 'dot' },
    { color: RING, label: 'Usable pack mAh, this mode', shape: 'dot' },
    { color: GREY, label: 'The other mode', shape: 'dot' },
    { color: '#ff9a4d', label: 'Bleed resistor burning off excess', shape: 'dot' },
  ],
  points: [
    'Cells in series carry the same current, so charging and driving move them together. Anything that differs between them doesn’t.',
    'Here cell C leaks 60 mAh a week (a weak cell, or the BMS drawing from its tap) and A only 10 mAh. Each week C falls a little further behind.',
    'The charger only sees the pack total (12.6 V). A full cell shoots past 4.2 V while C is still low, until the BMS stops the charge at 4.25 V.',
    'Driving ends when the emptiest cell hits cutoff. With C behind, the pack gives less each week, even though A and B are still half full.',
    'A balancing BMS bleeds the fullest cells through small resistors at the top of charge (here up to 60 mAh), so all three finish together.',
    'Passive balancing wastes the excess as heat and is slow, so start with matched cells. Check the cell voltages now and then; a growing spread means a tired cell.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'balance',
      options: [
        { value: 'off', label: 'No balancing' },
        { value: 'on', label: 'Balancing BMS' },
      ],
      initial: 'off',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const tanks = XS3.map((x, i) => {
      const t = chargeTank(TANK3_H, TANK3_R)
      t.group.position.set(x, TANK3_Y, 0)
      scene.add(t.group)
      add(scene, label(NAMES3[i], { size: 0.7, color: LABEL }), [x, TANK3_Y - TANK3_H / 2 - 1.2, 0.6])
      return t
    })
    const topY = TANK3_Y + TANK3_H / 2 + 0.5
    const botY = TANK3_Y - TANK3_H / 2 - 0.1
    for (let i = 0; i < XS3.length - 1; i++) {
      const a = XS3[i] + TANK3_R + 0.3
      wire(scene, [[XS3[i], topY, 0], [XS3[i], topY + 0.6, 0], [a, topY + 0.6, 0], [a, botY - 0.6, 0], [XS3[i + 1], botY - 0.6, 0], [XS3[i + 1], botY, 0]], 0.16)
    }
    const vLabels = XS3.map((x) => pulseLabel(scene, 3, RING, [x, topY + 1.9, 0], 0.9))
    const bleeders = XS3.map((x) => {
      const rx = x + TANK3_R + 0.9
      const holder = add(scene, new THREE.Group())
      resistorAlong(holder, 33, [rx, TANK3_Y + 1.6, -0.8], [rx, TANK3_Y - 1.6, -0.8], 1)
      wire(holder, [[rx, TANK3_Y + 1.6, -0.8], [rx, topY - 0.3, -0.8], [x, topY - 0.3, -0.8]], 0.07)
      wire(holder, [[rx, TANK3_Y - 1.6, -0.8], [rx, botY + 0.1, -0.8], [x, botY + 0.1, -0.8]], 0.07)
      const h = heatWaves(scene, 0.6, { count: 2, rise: 2 })
      h.group.position.set(rx, TANK3_Y + 2, -0.8)
      return { holder, h }
    })
    const rowY = TANK3_Y - TANK3_H / 2 - 2.9
    add(scene, label('WEEK', { size: 0.6, color: GREY, align: 'right' }), [XS3[0] + 0.6, rowY, 0.6])
    const weekLabel = pulseLabel(scene, 2, LABEL, [XS3[0] + 2.2, rowY, 0.6], 0.9)
    const phaseLabels = PHASES.map(([t]) => add(scene, label(t, { size: 0.7, color: LABEL, align: 'left' }), [XS3[1] + 0.4, rowY, 0.6]))
    const overLabels = XS3.map((x) => add(scene, label('OVER 4.2', { size: 0.42, color: HIGH_V }), [x, topY + 3.3, 0.4]))

    const { plot, dot, y } = ivScreen(scene, PLOT3, PLOT3_W, PLOT3_H, [4, 3])
    const yOf = (u: number) => y((u - U3_LO) / (U3_HI - U3_LO))
    ticks(plot, [[0, '1'], [0.5, String(WEEKS / 2)], [1, String(WEEKS)]], [1500, 2000, 2500, 3000].map((v): [number, string] => [(v - U3_LO) / (U3_HI - U3_LO), String(v / 1000)]))
    add(plot.group, label('WEEK', { size: 0.5, color: GREY }), [0, -PLOT3_H / 2 - 2.3, 0])
    add(plot.group, label('USABLE Ah', { size: 0.5, color: GREY }), [0, PLOT3_H / 2 + 1.1, 0])
    const curve = (run: typeof RUNS.on) => (u: number) => {
      const f = u * (WEEKS - 1)
      const i = Math.min(WEEKS - 2, Math.floor(f))
      return yOf(run[i].usableMAh + (run[i + 1].usableMAh - run[i].usableMAh) * (f - i))
    }
    const traces = { off: plot.trace(GREY, { radius: 0.08 }), on: plot.trace(GREY, { radius: 0.08 }) }
    traces.off.draw(curve(RUNS.off), null)
    traces.on.draw(curve(RUNS.on), null)
    const live = plot.trace(RING, { radius: 0.12 })

    const st = { mode: '', t: 0, week: 0, socs: [0.5, 0.5, 0.5], phase: 0 }
    const shown = [0.5, 0.5, 0.5]
    return {
      scene,
      view: { center: [-2.2, 0.6, 0], radius: 50, polar: 1.4, azimuth: 0.15 },
      frame(dt, p) {
        const run = runOf(p)
        const on = p.balance === 'on'
        if (p.balance !== st.mode) {
          st.mode = String(p.balance)
          st.t = 0
          st.week = -1
          traces.on.group.visible = !on
          traces.off.group.visible = on
        }
        st.t += dt
        if (st.t > WEEKS * WEEK_S + HOLD3_S) st.t = 0
        const tt = Math.min(st.t, WEEKS * WEEK_S - 1e-3)
        const week = Math.floor(tt / WEEK_S)
        if (week !== st.week) {
          st.week = week
          const g = Math.max(0.01, week / (WEEKS - 1))
          live.draw((u) => curve(run)(u * g), null)
          live.group.scale.x = g
          live.group.position.x = (-PLOT3_W / 2) * (1 - g)
        }
        const f = tt / WEEK_S - st.week
        const w = run[st.week]
        const prev = st.week ? run[st.week - 1].bottom : [0.5, 0.5, 0.5]
        const [, c1] = PHASES[0]
        const [, c2] = PHASES[1]
        const [, c3] = PHASES[2]
        st.phase = PHASES.findIndex(([, end]) => f < end)
        st.socs = w.top.map((top, i) =>
          f < c1 ? prev[i] + (top - prev[i]) * (f / c1)
          : f < c2 ? top
          : f < c3 ? top + (w.stored[i] - top) * ((f - c2) / (c3 - c2))
          : w.stored[i] + (w.bottom[i] - w.stored[i]) * ((f - c3) / (1 - c3)))
        tanks.forEach((t, i) => {
          shown[i] = glide(dt, shown[i], st.socs[i], 20)
          t.set(shown[i])
          vLabels[i].show(fitDigits(cellVolts(LI, st.socs[i]), 3))
          vLabels[i].frame(dt)
          overLabels[i].visible = cellVolts(LI, st.socs[i]) > LI.full + 0.005
          const bleeding = st.phase === 1 && w.bledMAh[i] > 1
          bleeders[i].h.step(dt, bleeding ? 0.4 + w.bledMAh[i] / 100 : 0)
          bleeders[i].holder.visible = on
        })
        phaseLabels.forEach((l, i) => (l.visible = i === st.phase && (i !== 1 || on)))
        weekLabel.show(String(st.week + 1))
        weekLabel.frame(dt)
        dot.position.set(plot.xAt(st.week / (WEEKS - 1)), yOf(w.usableMAh), 0.3)
      },
      readouts: (p) => {
        const w = runOf(p)[st.week]
        const hi = Math.max(...w.topVolts)
        const spread = hi - Math.min(...w.topVolts)
        return [
          { label: 'Week (each 1.2 s)', value: String(st.week + 1) },
          { label: 'Cell spread at full', value: `${Math.round(spread * 1000)} mV`, tone: spread > 0.1 ? 'bad' : spread > 0.03 ? 'warn' : 'ok' },
          { label: 'Highest cell at full', value: volts(hi), tone: hi >= BMS_LIMITS.ovp - 0.005 ? 'bad' : hi > LI.full + 0.01 ? 'warn' : undefined },
          { label: 'Usable this week', value: mAh(w.usableMAh), tone: w.usableMAh < 2500 ? 'bad' : undefined },
        ]
      },
    }
  },
}
