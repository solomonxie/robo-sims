import * as THREE from 'three/webgpu'
import { ohmsLaw } from '../../core/formulas'
import {
  JOULES_PER_WH,
  RESISTOR_BURN_C,
  RESISTOR_MAX_C,
  ROOM_C,
  energyOver,
  heatingTemp,
  powerV2R,
  powerVI,
  rcStep,
  resistorThermalK,
  runtimeHours,
  wattHours,
} from '../../core/physics'
import { nearestE12 } from '../../core/resistorColors'
import { amps, fitDigits, joules, ohms, si, volts, watts } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  HIGH_V,
  LANE,
  POWER,
  RING,
  areaPlot,
  arrow,
  bulb,
  cell,
  chargeTank,
  clamp01,
  ease,
  emptyGroup,
  heatGlow,
  heatWaves,
  plusFlow,
  pulseLabel,
  resistorAlong,
  resistorLoop,
  segmentDisplay,
  smoke,
  thermometer,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'


// --- P = V × I: the rectangle with sides V and I has area P. ---

const MAX_V = 12
const MIN_OHMS = 10
const MAX_OHMS = 100
const MAX_A = MAX_V / MIN_OHMS
const PER_V = 0.85
const PER_A = 6.5
const PLOT_AT: V3 = [0.8, -5, 0]
const LOOP_X = -9.2

const solveVI = (p: Params) => {
  const s = ohmsLaw({ voltsV: n(p, 'volts'), ohms: nearestE12(n(p, 'ohms')) })
  return { ...s, watts: powerVI(s.voltsV, s.ampsA) }
}

export const pEqualsVI: Lesson = {
  id: 'power-energy-p-v-i',
  title: 'P = V × I',
  tagline: 'Push times flow',
  formula: (p) => {
    const s = solveVI(p)
    return `P = V × I = ${volts(s.voltsV)} × ${amps(s.ampsA)} = ${watts(s.watts)}`
  },
  legend: [
    { color: HIGH_V, label: 'Voltage V, volts', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Current I, amps', shape: 'dot' },
    { color: POWER, label: 'Power P = V × I, W', shape: 'dot' },
  ],
  points: [
    'Power is how fast energy is delivered: 1 watt is 1 joule every second.',
    'Each coulomb crossing V volts gives up V joules, and I coulombs cross every second. So joules per second = V × I: P = V × I.',
    'Draw it as a rectangle: V up the side, I along the bottom. Its area is the power. Each small square is 1 V × 0.1 A = 0.1 W.',
    'Double the voltage on the same resistor and the current doubles too, so both sides double and the area, the power, goes up 4×.',
    'Lower the resistance and only the width grows. 12 V across 10 Ω pushes 1.2 A: 14.4 W, far past what a small ¼ W resistor can take.',
  ],
  controls: [
    { kind: 'slider', key: 'volts', label: 'Battery', min: 0, max: MAX_V, initial: 6, step: 0.5, format: volts },
    { kind: 'slider', key: 'ohms', label: 'Resistor', min: MIN_OHMS, max: MAX_OHMS, initial: 22, log: true, format: (v) => ohms(nearestE12(v)) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const circuit = add(scene, new THREE.Group(), [LOOP_X, 0, 0])
    const loop = resistorLoop(circuit, { w: 5, h: 4.6, cellH: 4, scale: 1.5, maxVolts: MAX_V })
    const flowArrow = arrow(circuit, [0, 6.4, 0], [1, 0, 0], CONVENTIONAL, 0.8)

    const plotGroup = add(scene, new THREE.Group(), PLOT_AT)
    const plot = areaPlot(plotGroup, {
      maxX: MAX_A, maxY: MAX_V, perX: PER_A, perY: PER_V, stepX: 0.1, stepY: 1, color: POWER, xColor: CONVENTIONAL, yColor: HIGH_V,
    })
    const vLabel = segmentDisplay(3, 1.2, HIGH_V, true)
    const iLabel = segmentDisplay(3, 1.2, CONVENTIONAL, true)
    plotGroup.add(vLabel.group, iLabel.group)
    const pLabel = pulseLabel(plotGroup, 3, POWER, [(MAX_A * PER_A) / 2, MAX_V * PER_V + 2.6, 0], 1.8)

    let shownV = 0
    let shownA = 0
    return {
      scene,
      view: { center: [-1.8, 1.4, 0], radius: 50, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const s = solveVI(p)
        loop.set(s.voltsV, s.ohms)
        loop.flow.step(dt * s.ampsA * 14)
        flowArrow.visible = s.ampsA > 0
        flowArrow.scale.setScalar(0.5 + 0.7 * Math.sqrt(s.ampsA / MAX_A))
        shownV += (s.voltsV - shownV) * ease(dt, 8)
        shownA += (s.ampsA - shownA) * ease(dt, 8)
        plot.set(shownA, shownV)
        vLabel.set(fitDigits(s.voltsV, 3))
        vLabel.group.position.set(-2.4, shownV * PER_V, 0)
        iLabel.set(fitDigits(s.ampsA, 3))
        iLabel.group.position.set(Math.max(1.2, shownA * PER_A), -1.6, 0)
        pLabel.show(fitDigits(s.watts, 3))
        pLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveVI(p)
        return [
          { label: 'Voltage V', value: volts(s.voltsV) },
          { label: 'Current I = V / R', value: amps(s.ampsA) },
          { label: 'Power P = V × I', value: watts(s.watts), tone: s.watts > 0.25 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Heat in a resistor: every watt turns into heat; the resistor warms until it sheds heat as fast as it gets it. ---

type Rating = '0.25' | '0.5' | '1'

const R_HEAT = 100
const RATING: Record<Rating, { scale: number; tauS: number }> = {
  '0.25': { scale: 3.6, tauS: 20 },
  '0.5': { scale: 4.4, tauS: 30 },
  '1': { scale: 5.4, tauS: 45 },
}
const TIME_LAPSE = 5
const HEAT_W = 12
const HEAT_H = 4.6
const BODY_Y = HEAT_H
const THERMO_H = 7.4
const SCORCHED = new THREE.Color('#5a4030')

const heatSolve = (p: Params) => {
  const rating = Number(p.rating)
  const v = n(p, 'volts')
  const w = powerV2R(v, R_HEAT)
  const k = resistorThermalK(rating)
  return { rating, v, w, k, amps: v / R_HEAT, settleC: heatingTemp(ROOM_C, w, k, RATING[p.rating as Rating].tauS, Infinity) }
}

export const heatInAResistor: Lesson = {
  id: 'power-energy-heat-in-a-resistor',
  title: 'Heat in a resistor',
  tagline: 'Every watt becomes heat',
  formula: 'P = I²R = V² / R',
  legend: [
    { color: POWER, label: 'Power P, W', shape: 'dot' },
    { color: HIGH_V, label: 'Temperature, °C', shape: 'dot' },
    { color: RING, label: `Limit ${RESISTOR_MAX_C} °C`, shape: 'dot' },
  ],
  points: [
    'A resistor turns all the power it takes into heat. With P = V × I and V = I × R: P = I²R = V² / R.',
    'Heat builds up until the resistor sheds it as fast as it arrives. It settles at ΔT = P × θ, where θ (°C per watt) depends on its size.',
    'The power rating is the most it can shed while staying under about 155 °C. 5 V across 100 Ω is 0.25 W: right at a ¼ W resistor’s limit.',
    'Push past it and it smokes. Far past it, the coating chars and the film burns open. Bigger bodies have more surface, so a 1 W part runs cooler.',
    'Energy is power × time: 0.25 W for a minute is 15 J of heat. The clock here runs 5× fast.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'rating',
      options: [
        { value: '0.25', label: '¼ W' },
        { value: '0.5', label: '½ W' },
        { value: '1', label: '1 W' },
      ],
      initial: '0.25',
    },
    { kind: 'slider', key: 'volts', label: 'Voltage', min: 0, max: MAX_V, initial: 4, step: 0.5, format: volts },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const halfLen = (scale: number) => 1.2 * scale
    wire(scene, [[-HEAT_W, -HEAT_H, 0], [-HEAT_W, HEAT_H, 0], [HEAT_W, HEAT_H, 0], [HEAT_W, -HEAT_H, 0], [-HEAT_W, -HEAT_H, 0]])
    const battery = cell(4, 1.4)
    battery.position.set(-HEAT_W, 0, 0)
    scene.add(battery)
    const holder = add(scene, new THREE.Group())
    const waves = heatWaves(scene, 6, { rise: 4 })
    const fumes = smoke(scene, 5)

    let level = 0
    let bodyHalf = 1
    const fraction = (x: number, y: number) => {
      if (y <= -HEAT_H + 0.01 || x >= HEAT_W - 0.01) return 0
      if (x <= -HEAT_W + 0.01) return clamp01((y + 2) / 4)
      return clamp01((bodyHalf - x) / (2 * bodyHalf))
    }
    const lane: V3[] = [[-HEAT_W, -HEAT_H, LANE], [-HEAT_W, HEAT_H, LANE], [HEAT_W, HEAT_H, LANE], [HEAT_W, -HEAT_H, LANE]]
    const flow = plusFlow(scene, lane, (at) => fraction(at.x, at.y) * level, true)

    const gauge = thermometer(THERMO_H)
    gauge.group.position.set(HEAT_W - 3.2, -HEAT_H + 0.5, 0)
    scene.add(gauge.group)
    const limitF = (RESISTOR_MAX_C - ROOM_C) / (RESISTOR_BURN_C - ROOM_C)
    box(gauge.group, [1.5, 0.16, 0.16], mat(RING, { emissive: '#aa8800' }), [0.6, 0.9 + limitF * THERMO_H, 0])
    const tLabel = pulseLabel(scene, 3, HIGH_V, [3, -0.4, 0], 1.7)
    const pLabel = pulseLabel(scene, 3, POWER, [-4.6, -0.4, 0], 1.7)

    let body: THREE.MeshStandardMaterial | null = null
    let shown = ''
    let lastV = NaN
    let temp = ROOM_C
    let joulesIn = 0
    let burnt = false
    let simT = 0
    const replace = (rating: Rating) => {
      emptyGroup(holder)
      const { scale } = RATING[rating]
      const r = resistorAlong(holder, R_HEAT, [-1, BODY_Y, 0], [1, BODY_Y, 0], scale)
      const shell = r.children[0] as THREE.Mesh
      body = mat('#d9c08c', { rough: 0.55 }, true)
      shell.material = body
      bodyHalf = halfLen(scale)
      temp = ROOM_C
      joulesIn = 0
      burnt = false
      simT = 0
    }

    return {
      scene,
      view: { center: [0, 2.4, 0], radius: 47, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const rating = p.rating as Rating
        const s = heatSolve(p)
        if (rating !== shown || (burnt && s.v !== lastV)) {
          shown = rating
          replace(rating)
        }
        lastV = s.v
        const { scale, tauS } = RATING[rating]
        const sim = dt * TIME_LAPSE
        const w = burnt ? 0 : s.w
        simT += sim
        temp = rcStep(temp, ROOM_C + w * s.k, tauS, sim)
        joulesIn += energyOver(w, sim)
        if (!burnt && temp >= RESISTOR_BURN_C) burnt = true

        level = burnt ? 0 : s.v / MAX_V
        flow.step(dt * (burnt ? 0 : s.amps) * 60)
        const rise = clamp01((temp - ROOM_C) / (RESISTOR_MAX_C - ROOM_C))
        const over = clamp01((temp - RESISTOR_MAX_C) / (RESISTOR_BURN_C - RESISTOR_MAX_C))
        if (body) {
          body.color.set(burnt ? '#2a2420' : '#d9c08c').lerp(SCORCHED, burnt ? 0 : over)
          heatGlow(body, burnt ? 0 : (temp - 90) / (RESISTOR_BURN_C - 90))
        }
        const top = BODY_Y + 0.47 * scale
        waves.group.position.set(0, top + 0.3, 0)
        waves.step(dt, rise)
        fumes.group.position.set(0, top, 0)
        fumes.step(dt, burnt ? clamp01((temp - ROOM_C) / 150) : over * 1.2)
        gauge.set((temp - ROOM_C) / (RESISTOR_BURN_C - ROOM_C))
        tLabel.show(String(Math.round(temp)))
        pLabel.show(fitDigits(w, 3))
        tLabel.frame(dt)
        pLabel.frame(dt)
      },
      readouts: (p) => {
        const s = heatSolve(p)
        const live = p.rating === shown && !burnt
        const t = p.rating === shown ? temp : ROOM_C
        return [
          { label: 'Power P = V² / R', value: watts(live ? s.w : 0), tone: s.w > s.rating ? 'warn' : 'ok' },
          { label: 'Temperature', value: `${Math.round(t)} °C`, tone: burnt ? 'bad' : t > RESISTOR_MAX_C ? 'warn' : 'ok' },
          burnt ? { label: 'Resistor', value: 'Burnt open', tone: 'bad' } : { label: 'Settles at', value: `${Math.round(s.settleC)} °C` },
          { label: `Heat in ${Math.round(simT)} s`, value: joules(joulesIn) },
        ]
      },
    }
  },
}

// --- Wh and mAh: capacity is charge; energy is charge × voltage. ---

type Battery = 'aa' | '9v' | '18650'

const BATTERIES: Record<Battery, { volts: number; mAh: number; height: number; r: number; square?: boolean }> = {
  aa: { volts: 1.2, mAh: 2000, height: 5.2, r: 1.15 },
  '9v': { volts: 9, mAh: 550, height: 4.6, r: 1.35, square: true },
  '18650': { volts: 3.7, mAh: 3000, height: 6.6, r: 1.45 },
}
const PER_AH = 3.3
const PER_VOLT = 1
const MAX_AH = 3
const MAX_BATTERY_V = 9
const DRAIN_S = 6
const HOLD_S = 1.4
const BAT_W = 5.5
const BAT_H = 4.6
const BAT_X = -10.5
const PLOT2_AT: V3 = [1.6, -4.4, 0]
const FULL_GLOW_W = 4

const batterySolve = (p: Params) => {
  const b = BATTERIES[p.battery as Battery]
  const mA = Math.round(n(p, 'mA'))
  const wh = wattHours(b.volts, b.mAh)
  return { b, mA, wh, hours: runtimeHours(b.mAh, mA), watts: powerVI(b.volts, mA / 1000) }
}

export const whAndMah: Lesson = {
  id: 'power-energy-wh-and-mah',
  title: 'Wh and mAh',
  tagline: 'Charge in the tank vs energy in the tank',
  formula: (p) => {
    const { b, wh } = batterySolve(p)
    return `Wh = V × Ah = ${b.volts} V × ${b.mAh / 1000} Ah = ${+wh.toPrecision(3)} Wh = ${si(wh * JOULES_PER_WH, 'J', 3)}`
  },
  legend: [
    { color: HIGH_V, label: 'Voltage V', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Capacity, mAh', shape: 'dot' },
    { color: POWER, label: 'Energy, Wh', shape: 'dot' },
    { color: '#e8e8e8', label: 'Hours running', shape: 'dot' },
  ],
  points: [
    'mAh is charge: 1 mAh is 1 mA flowing for an hour (3.6 coulombs). A 2000 mAh cell can supply 200 mA for 10 hours.',
    'Runtime = capacity ÷ current. Halve the current and it lasts twice as long. Real cells give less at high currents.',
    'Charge alone isn’t energy. Each coulomb carries V joules, so energy = V × Ah, in watt-hours. 1 Wh = 3600 J, so an AA’s 2.4 Wh is 8.6 kJ.',
    'Draw capacity along the bottom and voltage up the side: the area is the energy, and the green part is what’s left. The 9 V battery has the fewest mAh but twice the AA’s Wh.',
    'Compare batteries in Wh, not mAh. An 18650 holds 3.7 V × 3 Ah = 11.1 Wh, over four AA NiMH cells’ worth.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'battery',
      options: [
        { value: 'aa', label: 'AA' },
        { value: '9v', label: '9 V' },
        { value: '18650', label: '18650' },
      ],
      initial: 'aa',
    },
    { kind: 'slider', key: 'mA', label: 'Load current', min: 20, max: 1000, initial: 200, log: true, format: (v) => `${Math.round(v)} mA` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const circuit = add(scene, new THREE.Group(), [BAT_X, 0, 0])
    const bulbX = 1.2
    wire(circuit, [[-BAT_W, -BAT_H, 0], [BAT_W, -BAT_H, 0], [BAT_W, BAT_H, 0], [bulbX + 2.2, BAT_H, 0]])
    wire(circuit, [[bulbX - 2.4, BAT_H, 0], [-BAT_W, BAT_H, 0]])
    const lamp = bulb()
    lamp.group.scale.setScalar(0.62)
    lamp.group.rotation.z = -Math.PI / 2
    lamp.group.position.set(bulbX + 0.4, BAT_H, 0)
    circuit.add(lamp.group)
    const holder = add(circuit, new THREE.Group(), [-BAT_W, 0, 0])
    let tank: ReturnType<typeof chargeTank> | null = null
    let level = 0
    let cellHalf = 2.5
    const fraction = (x: number, y: number) => {
      if (x <= -BAT_W + 0.01) return clamp01((y + cellHalf) / (2 * cellHalf))
      if (y >= BAT_H - 0.01 && x < bulbX) return 1
      return 0
    }
    const lane: V3[] = [[-BAT_W, -BAT_H, LANE], [-BAT_W, BAT_H, LANE], [BAT_W, BAT_H, LANE], [BAT_W, -BAT_H, LANE]]
    const flow = plusFlow(circuit, lane, (at) => fraction(at.x, at.y) * level, true)
    const hLabel = pulseLabel(circuit, 3, '#e8e8e8', [0.6, 0, 0], 1.8)

    const plotGroup = add(scene, new THREE.Group(), PLOT2_AT)
    const plot = areaPlot(plotGroup, {
      maxX: MAX_AH, maxY: MAX_BATTERY_V, perX: PER_AH, perY: PER_VOLT, stepX: 0.5, stepY: 1, color: POWER, xColor: CONVENTIONAL, yColor: HIGH_V,
    })
    const vLabel = segmentDisplay(3, 1.2, HIGH_V, true)
    const cLabel = segmentDisplay(4, 1.2, CONVENTIONAL, true)
    plotGroup.add(vLabel.group, cLabel.group)
    const whLabel = pulseLabel(plotGroup, 3, POWER, [(MAX_AH * PER_AH) / 2, MAX_BATTERY_V * PER_VOLT + 2.4, 0], 1.8)

    let shown = ''
    let t = 0
    let shownAh = 0
    let shownV = 0
    return {
      scene,
      view: { center: [-1.6, 1.4, 0], radius: 55, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const s = batterySolve(p)
        const key = `${p.battery}|${s.mA}`
        if (p.battery !== shown.split('|')[0]) {
          emptyGroup(holder)
          tank = chargeTank(s.b.height, s.b.r, { square: s.b.square })
          holder.add(tank.group)
          wire(holder, [[0, BAT_H, 0], [0, s.b.height / 2 + 0.4, 0]])
          wire(holder, [[0, -BAT_H, 0], [0, -s.b.height / 2 - 0.1, 0]])
          cellHalf = s.b.height / 2
        }
        if (key !== shown) {
          shown = key
          t = 0
        }
        t = (t + dt) % (DRAIN_S + HOLD_S)
        const used = clamp01(t / DRAIN_S)
        const left = 1 - used
        tank!.set(left)
        const running = used < 1
        level = running ? s.b.volts / MAX_BATTERY_V : 0
        flow.step(running ? dt * (2 + 10 * Math.sqrt(s.mA / 1000)) : 0)
        lamp.setGlow(running ? 0.15 + 0.85 * Math.sqrt(clamp01(s.watts / FULL_GLOW_W)) : 0)
        hLabel.show(fitDigits(s.hours * used, 3))
        hLabel.frame(dt)

        shownAh += (s.b.mAh / 1000 - shownAh) * ease(dt, 8)
        shownV += (s.b.volts - shownV) * ease(dt, 8)
        plot.set(shownAh, shownV, left)
        vLabel.set(fitDigits(s.b.volts, 3))
        vLabel.group.position.set(-2.4, shownV * PER_VOLT, 0)
        cLabel.set(String(s.b.mAh))
        cLabel.group.position.set(shownAh * PER_AH, -1.6, 0)
        whLabel.show(fitDigits(s.wh * left, 3))
        whLabel.frame(dt)
      },
      readouts: (p) => {
        const s = batterySolve(p)
        return [
          { label: 'Capacity', value: `${s.b.mAh} mAh` },
          { label: 'Energy V × Ah', value: `${+s.wh.toPrecision(3)} Wh` },
          { label: 'Runtime mAh / mA', value: `${+s.hours.toPrecision(3)} h` },
        ]
      },
    }
  },
}
