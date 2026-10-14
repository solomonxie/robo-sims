import * as THREE from 'three/webgpu'
import {
  CHEMISTRIES,
  Chemistry,
  ChemistryId,
  cRateAmps,
  cRateHours,
  openCircuitVolts,
  powerI2R,
  shortCircuitAmps,
  terminalVolts,
  usableFraction,
} from '../../core/physics'
import { amps, fitDigits, ohms, pct, volts, watts } from '../../core/units'
import { V3, add } from '../../models/kit'
import { buildBattery18650 } from '../../models/power'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  ELECTRON,
  Flow,
  GREY,
  HIGH_V,
  ION_LI,
  ION_OH,
  LABEL,
  POWER,
  RING,
  bulb,
  cell,
  cellCutaway,
  chargeTank,
  clamp01,
  emptyGroup,
  glide,
  heatWaves,
  ivScreen,
  label,
  motorCan,
  path,
  plainChem,
  plusFlow,
  pulseLabel,
  resistorAlong,
  ticks,
  glowMat,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const chemOf = (p: Params) => CHEMISTRIES[p.chem as ChemistryId]
const chemChoice = (ids: ChemistryId[], initial: ChemistryId) => ({
  kind: 'choice' as const,
  key: 'chem',
  options: ids.map((id) => ({ value: id, label: CHEMISTRIES[id].name })),
  initial,
})
const ALL: ChemistryId[] = ['alkaline', 'nimh', 'liion', 'lfp']
const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${+h.toFixed(2)} h`)

// --- Cell voltage curve: ions shuttle across the separator; the OCV follows state of charge. ---

const SWEEP_C = 0.5
const SWEEP_S = 10
const HOLD_S = 1.5
const SPEEDUP1 = Math.round((3600 * cRateHours(SWEEP_C)) / SWEEP_S)
const CELL1: V3 = [-8.6, -0.8, 0]
const CELL1_W = 13
const CELL1_H = 7
const PLOT1: V3 = [7.6, 0.4, 0]
const PLOT1_W = 10
const PLOT1_H = 8
const V1_MAX = 4.4

export const cellVoltageCurve: Lesson = {
  id: 'battery-chemistry-cell-voltage-curve',
  title: 'Cell voltage curve',
  tagline: 'Ions shuttle, the voltage follows',
  formula: (p) => {
    const c = chemOf(p)
    return `${c.name}: ${c.full} V full → ${c.nominal} V nominal → ${c.cutoff} V empty`
  },
  legend: [
    { color: ION_LI, label: 'Li⁺ ion', shape: 'dot' },
    { color: ION_OH, label: 'OH⁻ ion', shape: 'dot' },
    { color: ELECTRON, label: 'Electron, outside wire', shape: 'dot' },
    { color: RING, label: 'Open-circuit voltage', shape: 'dot' },
  ],
  points: [
    'A cell is two electrodes in an electrolyte, kept apart by a porous separator. Ions can cross it; electrons can’t, so they take the outside wire.',
    'Li-ion: discharging, Li⁺ leaves the graphite anode, crosses the separator and tucks into the cathode while an electron runs through the load. Charging pushes both back.',
    'Alkaline and NiMH use OH⁻ instead, drifting the other way. Alkaline can’t be pushed back: charging it leaks or bursts.',
    'Voltage is set by the chemistry: 1.5 V alkaline, 1.2 V NiMH, 3.7 V Li-ion, 3.2 V LiFePO₄. It then slides with state of charge.',
    'Li-ion’s slope makes voltage a fuel gauge. LiFePO₄ is nearly flat from 90 % to 10 %, so its voltage hides how full it is.',
    'Energy per kilogram: Li-ion about 240 Wh/kg, LiFePO₄ 140, alkaline 110, NiMH 80. That’s why robots run on lithium.',
  ],
  controls: [
    chemChoice(ALL, 'liion'),
    {
      kind: 'choice',
      key: 'mode',
      options: [
        { value: 'discharge', label: 'Discharge' },
        { value: 'charge', label: 'Charge' },
      ],
      initial: 'discharge',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const cut = cellCutaway(scene, CELL1, CELL1_W, CELL1_H)
    const at = (v: V3): V3 => [v[0] + CELL1[0], v[1] + CELL1[1], v[2] + CELL1[2]]
    const a = at(cut.hooks.anode)
    const k = at(cut.hooks.cathode)
    const top = a[1] + 3.2
    const loadX = CELL1[0]
    const route: V3[] = [a, [a[0], top, 0], [k[0], top, 0], k]
    wire(scene, route)
    const electrons = new Flow(path(route.map(([x, y]): V3 => [x, y, 0.7])), 1.3, ELECTRON, 0.26)
    scene.add(electrons.mesh)
    const lamp = bulb()
    lamp.group.scale.setScalar(0.5)
    lamp.group.rotation.z = -Math.PI / 2
    lamp.group.position.set(loadX + 0.3, top, 0)
    scene.add(lamp.group)
    const charger = add(scene, new THREE.Group(), [loadX, top, 0.4])
    add(charger, new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.6, 1.2), new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.5 })))
    add(charger, label('CHARGER', { size: 0.5, color: POWER }), [0, 0, 0.65])
    const refuse = add(scene, label('NOT RECHARGEABLE', { size: 0.7, color: HIGH_V }), [CELL1[0], top + 1.6, 0.6])

    const { plot, dot, y } = ivScreen(scene, PLOT1, PLOT1_W, PLOT1_H, [4, 4])
    ticks(plot, [[0, '0'], [0.5, '50'], [1, '100']], [1, 2, 3, 4].map((v): [number, string] => [v / V1_MAX, String(v)]))
    add(plot.group, label('STATE OF CHARGE %', { size: 0.5, color: GREY }), [0, -PLOT1_H / 2 - 2.3, 0])
    add(plot.group, label('V', { size: 0.6, color: GREY }), [PLOT1_W / 2 + 1.5, PLOT1_H / 2 + 0.9, 0])
    const vOf = (c: Chemistry) => (u: number) => y(openCircuitVolts(c, u) / V1_MAX)
    const ghosts = ALL.map((id) => {
      const t = plot.trace(GREY, { radius: 0.06 })
      t.draw(vOf(CHEMISTRIES[id]), null)
      return t
    })
    const live = plot.trace(RING, { radius: 0.12 })
    const name = add(plot.group, new THREE.Group(), [PLOT1_W / 2, PLOT1_H / 2 + 1.1, 0])
    const vLabel = pulseLabel(plot.group, 3, RING, [-PLOT1_W / 2 + 1.6, PLOT1_H / 2 + 1.1, 0], 1.1)

    const st = { chem: '', key: '', t: 0, soc: 1, ocv: 0, simH: 0 }
    return {
      scene,
      view: { center: [0, 1.4, 0], radius: 52, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const c = chemOf(p)
        const discharge = p.mode !== 'charge'
        const blocked = !discharge && !c.rechargeable
        if (p.chem !== st.chem) {
          st.chem = String(p.chem)
          cut.setChemistry(c)
          live.draw(vOf(c), null)
          ghosts.forEach((g, i) => (g.group.visible = ALL[i] !== p.chem))
          emptyGroup(name)
          add(name, label(plainChem(c.name), { size: 0.7, color: RING, align: 'right' }))
        }
        const key = `${p.chem}|${p.mode}`
        let snap = false
        if (key !== st.key) {
          st.key = key
          st.t = 0
          snap = true
        }
        st.t += dt
        if (st.t > SWEEP_S + HOLD_S) {
          st.t = 0
          snap = true
        }
        const phase = clamp01(st.t / SWEEP_S)
        st.soc = blocked ? 0 : discharge ? 1 - phase : phase
        st.simH = blocked ? 0 : phase * cRateHours(SWEEP_C)
        st.ocv = openCircuitVolts(c, st.soc)
        const running = !blocked && phase < 1
        cut.step(dt, st.soc, snap)
        electrons.step(running ? (discharge ? 1 : -1) * dt * 3 : 0)
        lamp.group.visible = discharge
        charger.visible = !discharge
        refuse.visible = blocked
        electrons.mesh.visible = !blocked
        lamp.setGlow(running && discharge ? 0.2 + 0.8 * clamp01((st.ocv - c.cutoff) / (c.full - c.cutoff)) : 0)
        dot.position.set(plot.xAt(st.soc), y(st.ocv / V1_MAX), 0.3)
        vLabel.show(fitDigits(st.ocv, 3))
        vLabel.frame(dt)
      },
      readouts: (p) => {
        const c = chemOf(p)
        const blocked = p.mode === 'charge' && !c.rechargeable
        return [
          { label: 'Open-circuit V', value: volts(st.ocv), tone: blocked ? 'bad' : undefined },
          { label: 'State of charge', value: blocked ? 'won’t charge' : pct(st.soc), tone: blocked ? 'bad' : undefined },
          { label: 'Energy density', value: `${c.whPerKg} Wh/kg` },
          { label: `Time at ${SWEEP_C} C (${SPEEDUP1}× fast)`, value: hours(st.simH) },
        ]
      },
    }
  },
}

// --- Capacity and C-rate: the same 18650 at gentle and hard currents; sag hits cutoff early. ---

const RUN_S = 8
const GENTLE_C = 0.2
const CELL2: V3 = [-9.8, -2.6, 0]
const CELL2_SCALE = 0.36
const MOTOR2: V3 = [-8.6, 5.2, 0]
const PLOT2: V3 = [7.6, 0.4, 0]
const PLOT2_W = 10
const PLOT2_H = 8
const V2_LO = 2.4
const V2_HI = 4.4
const MAX_HEAT_W = 6

const solveC = (p: Params) => {
  const c = chemOf(p)
  const rate = Math.round(n(p, 'c') * 10) / 10
  const i = cRateAmps(c.cell.mAh, rate)
  return { c, rate, i, usable: usableFraction(c, i), idealH: cRateHours(rate), speedup: Math.round((3600 * cRateHours(rate)) / RUN_S) }
}

export const capacityAndCRate: Lesson = {
  id: 'battery-chemistry-capacity-and-c-rate',
  title: 'Capacity and C-rate',
  tagline: 'Pull harder, get less',
  formula: (p) => {
    const s = solveC(p)
    return `I = C × Ah = ${s.rate} × ${s.c.cell.mAh / 1000} Ah = ${amps(s.i)} → ${hours(s.idealH)} ideal, ${hours(s.idealH * s.usable)} real`
  },
  legend: [
    { color: RING, label: 'Voltage at this C-rate', shape: 'dot' },
    { color: GREY, label: `Gentle ${GENTLE_C} C`, shape: 'dot' },
    { color: HIGH_V, label: 'Cutoff voltage', shape: 'dot' },
    { color: POWER, label: 'Charge left', shape: 'dot' },
  ],
  points: [
    'Capacity is the charge a cell gives from full to its cutoff voltage, rated at a gentle current: 3000 mAh for a good Li-ion 18650.',
    'C-rate scales current to capacity: 1 C empties the cell in an hour (3 A here), 2 C in 30 min, 0.2 C in 5 h.',
    'At high C the voltage sags under load, so it reaches cutoff while charge is still inside. The cell seems smaller.',
    'The lost part isn’t gone: rest the cell and the voltage creeps back up. The I²R heat is what really wastes energy.',
    'Datasheets give a maximum continuous C-rate. Motor stall currents can blow past it, so size the cell for the peaks.',
  ],
  controls: [
    chemChoice(['liion', 'lfp'], 'liion'),
    { kind: 'slider', key: 'c', label: 'C-rate', min: 0.2, max: 5, initial: 1, log: true, format: (v) => `${(Math.round(v * 10) / 10).toFixed(1)} C` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const model = add(scene, buildBattery18650(), CELL2)
    model.scale.setScalar(CELL2_SCALE)
    model.rotation.y = Math.PI
    const leadX = CELL2[0] + (15.15 + 4) * CELL2_SCALE
    const leadY = CELL2[1] + 0.8 * CELL2_SCALE
    const motor = motorCan(scene, MOTOR2, { r: 1.5 })
    const [pinL, pinR] = motor.pins
    const top = pinR[1]
    const right = leadX + 1
    const left = CELL2[0] - 6.4
    const bottom = CELL2[1] - 1.2
    wire(scene, [[leadX, leadY, -1.1], [right, leadY, 0], [right, top, 0], pinR], 0.22)
    wire(scene, [pinL, [left, top, 0], [left, bottom, 0], [right + 0.9, bottom, 0], [right + 0.9, leadY - 0.5, 0], [leadX, leadY, 0.7]], 0.22)
    const loop: V3[] = [[right, leadY, 1], [right, top, 1], [left, top, 1], [left, bottom, 1], [right, bottom, 1]]
    const st = { key: '', t: 0, running: true, v: 0, soc: 1 }
    const flow = plusFlow(scene, loop, (q) => (q.x > right - 0.1 || (q.y > top - 0.1 && q.x > MOTOR2[0]) ? 1 : 0), true)
    const heat = heatWaves(scene, 7, { count: 5, rise: 2.2 })
    heat.group.position.set(CELL2[0] - 0.6, CELL2[1] + 3.2, 0)
    const tank = chargeTank(9, 0.7)
    tank.group.rotation.z = Math.PI / 2
    tank.group.position.set(CELL2[0], CELL2[1] - 2.6, 0)
    scene.add(tank.group)

    const { plot, dot, y } = ivScreen(scene, PLOT2, PLOT2_W, PLOT2_H, [4, 4])
    const yOf = (v: number) => y((v - V2_LO) / (V2_HI - V2_LO))
    ticks(plot, [], [2.5, 3, 3.5, 4].map((v): [number, string] => [(v - V2_LO) / (V2_HI - V2_LO), String(v)]))
    const xTicks = add(plot.group, new THREE.Group())
    add(plot.group, label('mAh DELIVERED', { size: 0.5, color: GREY }), [0, -PLOT2_H / 2 - 2.3, 0])
    add(plot.group, label('V', { size: 0.6, color: GREY }), [PLOT2_W / 2 + 1.5, PLOT2_H / 2 + 0.9, 0])
    const cutoff = plot.level(HIGH_V)
    const gentle = plot.trace(GREY, { radius: 0.07 })
    const live = plot.trace(RING, { radius: 0.12 })
    const fit = (t: ReturnType<typeof plot.trace>, c: Chemistry, i: number) => {
      const f = Math.max(0.02, usableFraction(c, i))
      t.draw((u) => yOf(terminalVolts(c, 1 - u * f, i)), null)
      t.group.scale.x = f
      t.group.position.x = (-PLOT2_W / 2) * (1 - f)
    }
    const mahLabel = pulseLabel(plot.group, 4, CONVENTIONAL, [-PLOT2_W / 2 + 2, PLOT2_H / 2 + 1.1, 0], 1.1)
    const name = add(plot.group, new THREE.Group(), [PLOT2_W / 2, PLOT2_H / 2 + 1.1, 0])
    let chem = ''

    return {
      scene,
      view: { center: [-0.8, 1.2, 0], radius: 54, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveC(p)
        const { c } = s
        if (p.chem !== chem) {
          chem = String(p.chem)
          fit(gentle, c, cRateAmps(c.cell.mAh, GENTLE_C))
          cutoff.set(yOf(c.cutoff))
          emptyGroup(xTicks)
          ticks({ ...plot, group: xTicks }, [[0, '0'], [0.5, String(c.cell.mAh / 2)], [1, String(c.cell.mAh)]], [])
          emptyGroup(name)
          add(name, label(plainChem(c.name), { size: 0.7, color: RING, align: 'right' }))
        }
        const key = `${p.chem}|${s.rate}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          fit(live, c, s.i)
        }
        st.t += dt
        const end = RUN_S * s.usable
        if (st.t > end + HOLD_S) st.t = 0
        st.running = st.t < end
        const drawn = Math.min(st.t, end) / RUN_S
        st.soc = 1 - drawn
        st.v = st.running ? terminalVolts(c, st.soc, s.i) : openCircuitVolts(c, st.soc)
        const load = st.running ? s.i : 0
        flow.step(dt * (1.5 + 3 * Math.sqrt(load)))
        motor.spin(dt, st.running ? 600 * st.v : 0)
        heat.step(dt, Math.sqrt(powerI2R(load, c.cell.ohms) / MAX_HEAT_W))
        tank.set(st.soc)
        dot.position.set(plot.xAt(drawn), yOf(st.running ? st.v : terminalVolts(c, st.soc, s.i)), 0.3)
        mahLabel.show(String(Math.round(drawn * c.cell.mAh)))
        mahLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveC(p)
        return [
          { label: 'Current C × Ah', value: amps(s.i) },
          { label: 'Usable to cutoff', value: `${Math.round(s.usable * s.c.cell.mAh)} mAh (${pct(s.usable)})`, tone: s.usable < 0.85 ? 'warn' : 'ok' },
          { label: 'Terminal V', value: volts(st.v), tone: st.running ? undefined : 'bad' },
          { label: `Time (${s.speedup}× fast)`, value: hours((Math.min(st.t, RUN_S * s.usable) / RUN_S) * s.idealH) },
        ]
      },
    }
  },
}

// --- Internal resistance: an ideal cell behind a small resistor; the load current drops I × R inside. ---

const MAX_A = 10
const SOC3 = 0.5
const L3 = -14
const R3 = -4.4
const H3 = 4
const PLOT3: V3 = [7.8, 0.4, 0]
const PLOT3_W = 10
const PLOT3_H = 8
const STACK_H = 6
const MAX_IR_W = 15

const solveIR = (p: Params) => {
  const c = chemOf(p)
  const short = shortCircuitAmps(c, SOC3)
  const i = Math.min(n(p, 'amps'), short)
  const ocv = openCircuitVolts(c, SOC3)
  const v = Math.max(0, terminalVolts(c, SOC3, i))
  return { c, i, short: i >= short, ocv, v, sag: ocv - v, heatW: powerI2R(i, c.cell.ohms), usable: usableFraction(c, i) }
}

export const internalResistance: Lesson = {
  id: 'battery-chemistry-internal-resistance',
  title: 'Internal resistance',
  tagline: 'A cell is a perfect source behind a small resistor',
  formula: (p) => {
    const s = solveIR(p)
    return `V = OCV − I × R = ${volts(s.ocv)} − ${amps(s.i)} × ${ohms(s.c.cell.ohms)} = ${volts(s.v)}`
  },
  legend: [
    { color: RING, label: 'Terminal voltage vs current', shape: 'dot' },
    { color: GREY, label: 'Other chemistries', shape: 'dot' },
    { color: HIGH_V, label: 'Cutoff (dashed), lost I × R', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Current I', shape: 'arrow-right' },
  ],
  points: [
    'Ions push through electrolyte and electrode material that resist them. Model it as a perfect voltage source (the OCV) behind a resistor R.',
    'Draw current and you lose I × R inside: the terminal voltage sags. A straight line on the plot whose slope is −R.',
    'That lost voltage becomes heat, I² × R. Ten amps through 40 mΩ is 4 W warming the cell.',
    'Alkaline AA: about 150 mΩ, so 2 A drops 0.3 V of 1.5 V. A Li-ion 18650 is about 40 mΩ, and good power cells under 20 mΩ.',
    'Sag is why a robot browns out when the motors start, and why alkalines die early in motors but last for months in a clock.',
    'R rises as cells age and in the cold. Measure it by the sag: R = ΔV ÷ ΔI.',
  ],
  controls: [
    chemChoice(ALL, 'liion'),
    { kind: 'slider', key: 'amps', label: 'Load current', min: 0.1, max: MAX_A, initial: 2, log: true, format: (v) => amps(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const box = add(scene, new THREE.Mesh(
      new THREE.BoxGeometry(6.6, 10.4, 2.6),
      new THREE.MeshStandardMaterial({ color: '#9ab8ff', transparent: true, opacity: 0.07, depthWrite: false }),
    ), [L3 + 2.4, 0.2, 0])
    box.castShadow = false
    add(scene, label('INSIDE THE CELL', { size: 0.55, color: LABEL }), [L3 + 2.4, -5.8, 0])
    add(scene, cell(4.4, 1.4), [L3, -1.2, 0])
    const rA: V3 = [L3 + 0.4, H3, 0]
    const rB: V3 = [L3 + 4.6, H3, 0]
    const rHolder = add(scene, new THREE.Group())
    resistorAlong(rHolder, 0.1, rA, rB, 1.4)
    add(scene, label('R', { size: 0.8, color: '#e8e8e8' }), [(rA[0] + rB[0]) / 2, H3 + 1.4, 0.6])
    const heat = heatWaves(scene, 3, { count: 3, rise: 3 })
    heat.group.position.set((rA[0] + rB[0]) / 2, H3 + 0.6, 0)
    wire(scene, [[L3, 1.2, 0], [L3, H3, 0], rA])
    wire(scene, [rB, [R3, H3, 0], [R3, 1.6, 0]])
    wire(scene, [[R3, -1.6, 0], [R3, -H3, 0], [L3, -H3, 0], [L3, -3.6, 0]])
    const lamp = bulb()
    lamp.group.scale.setScalar(0.6)
    lamp.group.position.set(R3, 0, 0)
    scene.add(lamp.group)
    const st = { s: solveIR({ chem: 'liion', amps: 1 }) }
    const flow = plusFlow(
      scene,
      [[L3, -H3, 1.3], [L3, H3, 1.3], [R3, H3, 1.3], [R3, -H3, 1.3]],
      (q) => (q.y < -H3 + 0.05 ? 0 : q.x < rA[0] ? 1 : q.x > rB[0] - 0.05 ? st.s.v / Math.max(st.s.ocv, 1e-3) : 1),
      true,
    )
    const stack = add(scene, new THREE.Group(), [R3 + 3.2, -H3, 0])
    const bar = (color: string) => add(stack, new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 0.8), glowMat(color, 0.5)))
    const vBar = bar(RING)
    const sagBar = bar(HIGH_V)
    const vLabel = pulseLabel(scene, 3, RING, [R3 + 3.2, -H3 - 1.3, 0], 1)
    add(scene, label('OCV', { size: 0.5, color: LABEL }), [R3 + 3.2, -H3 + STACK_H + 0.7, 0])
    const sagLabel = add(scene, label('I×R', { size: 0.55, color: HIGH_V, align: 'left' }), [R3 + 4.2, 0, 0])

    const { plot, dot, y } = ivScreen(scene, PLOT3, PLOT3_W, PLOT3_H, [5, 4])
    ticks(plot, [[0, '0'], [0.5, '5'], [1, '10']], [1, 2, 3, 4].map((v): [number, string] => [v / V1_MAX, String(v)]))
    add(plot.group, label('AMPS', { size: 0.5, color: GREY }), [0, -PLOT3_H / 2 - 2.3, 0])
    add(plot.group, label('V', { size: 0.6, color: GREY }), [PLOT3_W / 2 + 1.5, PLOT3_H / 2 + 0.9, 0])
    const line = (c: Chemistry) => (u: number) => y(Math.max(0, terminalVolts(c, SOC3, u * MAX_A)) / V1_MAX)
    const ghosts = ALL.map((id) => {
      const t = plot.trace(GREY, { radius: 0.06 })
      t.draw(line(CHEMISTRIES[id]), null)
      return t
    })
    const live = plot.trace(RING, { radius: 0.12 })
    const cutoff = plot.level(HIGH_V)
    const name = add(plot.group, new THREE.Group(), [0, PLOT3_H / 2 + 1.1, 0])
    let chem = ''
    let shownV = 0
    let shownSag = 0

    return {
      scene,
      view: { center: [-0.6, 1.2, 0], radius: 54, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveIR(p)
        st.s = s
        if (p.chem !== chem) {
          chem = String(p.chem)
          live.draw(line(s.c), null)
          ghosts.forEach((g, i) => (g.group.visible = ALL[i] !== p.chem))
          cutoff.set(y(s.c.cutoff / V1_MAX))
          emptyGroup(name)
          add(name, label(`${plainChem(s.c.name)} ${s.c.cell.format}, ${Math.round(s.c.cell.ohms * 1000)} mΩ`, { size: 0.6, color: RING }))
        }
        shownV = glide(dt, shownV, s.v, 8)
        shownSag = glide(dt, shownSag, s.sag, 8)
        const k = STACK_H / s.ocv
        const hv = Math.max(0.001, shownV * k)
        const hs = Math.max(0.001, shownSag * k)
        vBar.scale.y = hv
        vBar.position.y = hv / 2
        sagBar.scale.y = hs
        sagBar.position.y = hv + hs / 2
        sagLabel.position.y = -H3 + (shownV + shownSag / 2) * k
        sagLabel.visible = shownSag * k > 0.3
        flow.step(dt * (1 + 3 * Math.sqrt(s.i)))
        heat.step(dt, Math.sqrt(s.heatW / MAX_IR_W))
        lamp.setGlow(clamp01(Math.sqrt((s.v * s.i) / 10)))
        dot.position.set(plot.xAt(s.i / MAX_A), y(s.v / V1_MAX), 0.3)
        vLabel.show(fitDigits(s.v, 3))
        vLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveIR(p)
        const low = s.v <= s.c.cutoff
        return [
          { label: s.short ? 'Short circuit' : 'Sag I × R', value: s.short ? amps(s.i) : volts(s.sag), tone: s.short ? 'bad' : s.sag / s.ocv > 0.1 ? 'warn' : undefined },
          { label: 'Terminal V (half charged)', value: volts(s.v), tone: low ? 'bad' : 'ok' },
          { label: 'Heat I² × R', value: watts(s.heatW) },
          { label: 'Usable before cutoff', value: low ? 'none' : pct(s.usable), tone: s.usable < 0.8 ? 'warn' : undefined },
        ]
      },
    }
  },
}
