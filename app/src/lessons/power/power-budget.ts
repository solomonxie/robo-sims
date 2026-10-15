import * as THREE from 'three/webgpu'
import {
  Budget,
  CHEMISTRIES,
  ItemId,
  LoadAmps,
  MISSION_S,
  RobotState,
  averageBudget,
  budgetAt,
  budgetOf,
  cellVolts,
  missionAmps,
  missionState,
  openCircuitVolts,
  packRuntime,
  stateAmps,
} from '../../core/physics'
import { amps, fitDigits, hoursText, pct, volts, watts } from '../../core/units'
import { buildTtMotor, buildWheel } from '../../models/motion'
import { buildEsp32, buildHcSr04, buildL298n } from '../../models/modules'
import { V3, add, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  cellPackModel,
  clamp01,
  dcdcModule,
  emptyGroup,
  glide,
  glowMat,
  heatWaves,
  inOutBars,
  label,
  lane,
  memoBy,
  plusFlow,
  pulseLabel,
  scope,
  sg90Servo,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const LI = CHEMISTRIES.liion
const ALK = CHEMISTRIES.alkaline
const COLOR: Record<ItemId, string> = { esp32: B_FIELD, sonar: '#4d8dff', servo: '#b0f2ff', motors: POWER, buck: HIGH_V, l298n: HEAT }
const NAME: Record<ItemId, string> = { esp32: 'ESP32', sonar: 'HC-SR04', servo: 'SG90', motors: '2× TT', buck: 'LM2596', l298n: 'L298N' }
const ITEMS: ItemId[] = ['esp32', 'sonar', 'servo', 'motors', 'l298n', 'buck']
const mAh = (a: number) => String(Math.round(a * 1000))
const hours = (h: number) => (h < 48 ? hoursText(h) : `${+(h / 24).toFixed(1)} days`)
const LOAD_LEGEND = [
  { color: B_FIELD, label: 'Logic on the 5 V rail (blues)', shape: 'dot' as const },
  { color: POWER, label: 'Motors, straight off the pack', shape: 'dot' as const },
  { color: HIGH_V, label: 'Lost as heat: buck, L298N', shape: 'dot' as const },
]

// --- The robot car laid out flat: pack, LM2596 → 5 V rail (ESP32, HC-SR04, SG90), L298N → two TT motors. ---

const TRUNK_X = -11.4
const J_Y = -0.4
const BUCK: V3 = [-6.8, 5.4, 0]
const DRV: V3 = [-6.8, -4.4, 0]
const ESP: V3 = [0, 5.4, 0]
const SONAR: V3 = [6, 3.4, 0]
const SERVO: V3 = [11, 5.4, 0]
const MOTORS: V3[] = [[-0.8, -5.6, 0], [8.4, -5.6, 0]]
const BUS_Y = 9.2
const TT = 0.2
const RIG_K = 0.65
const RIG_AT: V3 = [-1.5, 0.6, 0]

interface PackSpec { key: string; series: number; parallel?: number; r: number; text: string }

function robotRig(parent: THREE.Object3D, packs: PackSpec[]) {
  const scene = add(parent, new THREE.Group(), RIG_AT)
  scene.scale.setScalar(RIG_K)
  const packGroups = new Map<string, { g: THREE.Group; flow: ReturnType<typeof plusFlow> }>()
  const J: V3 = [TRUNK_X, J_Y, 0]
  for (const p of packs) {
    const g = add(scene, new THREE.Group())
    const deep = (p.parallel ?? 1) > 1
    const pack = cellPackModel(g, p.series, p.parallel ?? 1, { r: p.r, dx: 2.4 * p.r, dz: (deep ? 5.2 : 2.4) * p.r })
    const at: V3 = [-15.6, 0.6, 0]
    pack.group.position.set(...at)
    if (deep) pack.group.rotation.set(0.2, 0.75, 0)
    const tip = new THREE.Vector3(...pack.plus).applyEuler(pack.group.rotation)
    const plus: V3 = [tip.x + at[0], tip.y + at[1], 0]
    const out = Math.sign(pack.plus[1]) * 0.9
    const route: V3[] = [plus, [plus[0], plus[1] + out, 0], [TRUNK_X, plus[1] + out, 0], J]
    wire(g, route, 0.16)
    packGroups.set(p.key, { g, flow: plusFlow(g, lane(route, 0.9), () => 1) })
    add(g, label(p.text, { size: 0.55, color: LABEL }), [at[0], at[1] + pack.h / 2 + 1.4, 0])
  }

  const buck = dcdcModule(scene, BUCK, 'lm2596', 0.2)
  const buckHeat = heatWaves(scene, 1.6, { count: 3, rise: 1.6 })
  buckHeat.group.position.set(buck.chipTop[0], buck.chipTop[1] + 1, buck.chipTop[2] + 0.4)
  const { inP, outP } = buck.pins
  const toBuck: V3[] = [J, [TRUNK_X, inP[1], 0], inP]
  const drvIn: V3 = [DRV[0] - 2.7, DRV[1] + 1.4, 0]
  const toDrv: V3[] = [J, [TRUNK_X, drvIn[1], 0], drvIn]
  const bus: V3[] = [outP, [outP[0] + 0.7, outP[1], 0], [outP[0] + 0.7, BUS_Y, 0], [SERVO[0], BUS_Y, 0]]
  const drops: V3[][] = [
    [[ESP[0], BUS_Y, 0], [ESP[0], ESP[1] + 1.8, 0]],
    [[SONAR[0], BUS_Y, 0], [SONAR[0], SONAR[1] + 2.9, 0]],
    [[SERVO[0], BUS_Y, 0], [SERVO[0], SERVO[1] + 1, 0]],
  ]
  const drvOut: V3 = [DRV[0] + 2.7, DRV[1] - 0.6, 0]
  const motorAt = MOTORS.map((m): V3 => [m[0] + 5.2 * TT, m[1] + 3.7 * TT - 1.2, 0])
  const toMotors: V3[][] = motorAt.map((m) => [drvOut, [drvOut[0] + 0.8, drvOut[1], 0], [drvOut[0] + 0.8, -9, 0], [m[0], -9, 0], [m[0], m[1] - 0.2, 0]])
  for (const r of [toBuck, toDrv, bus, ...drops, ...toMotors]) wire(scene, r, 0.16)
  const flow = (r: V3[], v: number) => plusFlow(scene, lane(r, 0.9), () => v)
  const flows = {
    buck: flow(toBuck, 1),
    drv: flow(toDrv, 1),
    bus: flow(bus, 0.68),
    drops: drops.map((r) => flow(r, 0.68)),
    motors: toMotors.map((r) => flow(r, 0.85)),
  }
  add(scene, label('5 V RAIL', { size: 0.5, color: B_FIELD, align: 'left' }), [outP[0] + 1.4, BUS_Y + 0.9, 0])
  add(scene, label('PACK RAIL', { size: 0.5, color: POWER, align: 'left' }), [TRUNK_X + 0.5, -9.9, 0])

  const flat = (o: THREE.Object3D, s: number) => {
    o.scale.setScalar(s)
    o.rotation.x = Math.PI / 2
    return o
  }
  flat(add(scene, buildEsp32(), ESP), 0.3)
  const wifi = Array.from({ length: 3 }, (_, i) => {
    const m = new THREE.MeshBasicMaterial({ color: B_FIELD, transparent: true, opacity: 0, depthWrite: false })
    const arc = add(scene, mesh(new THREE.TorusGeometry(0.7 + 0.55 * i, 0.07, 6, 24, Math.PI / 2), m), [ESP[0] - 2.4, ESP[1] + 0.2, 1])
    arc.rotation.z = Math.PI / 4 + Math.PI / 2
    return m
  })
  add(scene, buildHcSr04(), SONAR).scale.setScalar(0.3)
  const pings = Array.from({ length: 2 }, (_, i) => {
    const m = new THREE.MeshBasicMaterial({ color: COLOR.sonar, transparent: true, opacity: 0, depthWrite: false })
    const ring = add(scene, mesh(new THREE.TorusGeometry(1, 0.06, 6, 32), m), [SONAR[0] + (i ? 1.53 : -1.53), SONAR[1] + 1.73, 2])
    return { ring, m }
  })
  const horn = sg90Servo(scene, SERVO)
  flat(add(scene, buildL298n(), DRV), 0.3)
  const drvHeat = heatWaves(scene, 2, { count: 3, rise: 1.8 })
  drvHeat.group.position.set(DRV[0], DRV[1] + 2.4, 1.2)
  const wheels = MOTORS.map((m) => {
    add(scene, buildTtMotor(), m).scale.setScalar(TT)
    const w = add(scene, buildWheel(), [m[0] - 4 * TT, m[1] + 3.7 * TT, -3])
    w.scale.setScalar(TT)
    return w
  })

  const tag = (id: ItemId, at: V3) => {
    add(scene, label(NAME[id], { size: 0.6, color: COLOR[id] }), at)
    add(scene, label('MA', { size: 0.45, color: GREY, align: 'left' }), [at[0] + 1.7, at[1] - 1.5, 0])
    return pulseLabel(scene, 4, COLOR[id], [at[0] - 0.3, at[1] - 1.3, 0], 0.8)
  }
  const tags = {
    esp32: tag('esp32', [ESP[0], ESP[1] - 2.6, 0]),
    sonar: tag('sonar', [SONAR[0], SONAR[1] - 1.1, 0]),
    servo: tag('servo', [SERVO[0], SERVO[1] - 2, 0]),
    motors: tag('motors', [(MOTORS[0][0] + MOTORS[1][0]) / 2 + 1.6, -10.4, 0]),
  }
  add(scene, label('L298N', { size: 0.5, color: HEAT }), [DRV[0], DRV[1] - 3.3, 0])
  add(scene, label('LM2596', { size: 0.5, color: HIGH_V }), [BUCK[0], BUCK[1] - 2.9, 0])
  const st = { ping: 0, sweep: 0, wifi: 0 }

  return {
    showPack(key: string) {
      for (const [k, p] of packGroups) p.g.visible = k === key
    },
    set(dt: number, a: LoadAmps, b: Budget, spin: number, pack: string) {
      const v = (x: number) => dt * Math.min(9, 4 * x)
      packGroups.get(pack)?.flow.step(v(b.packA))
      flows.buck.step(v(b.conv.iin))
      flows.drv.step(v(b.motorA))
      flows.bus.step(v(b.logicA))
      flows.drops.forEach((f, i) => f.step(v([a.esp32, a.sonar, a.servo][i])))
      flows.motors.forEach((f) => f.step(v(a.motors / 2)))
      for (const w of wheels) w.rotation.z -= dt * 9 * spin
      buck.set(clamp01(b.conv.loss / 1.5), clamp01(b.logicA / 1.5))
      buckHeat.step(dt, b.conv.loss / 0.6)
      const drvW = b.items.find((i) => i.id === 'l298n')!.watts
      drvHeat.step(dt, drvW / 3)
      st.wifi = glide(dt, st.wifi, clamp01((a.esp32 - 0.01) / 0.34), 20)
      wifi.forEach((m, i) => (m.opacity = clamp01(st.wifi * 3 - i * 0.6) * 0.9))
      const sonarOn = a.sonar > 0.005
      st.ping = (st.ping + dt * 1.6) % 1
      for (const p of pings) {
        p.ring.scale.setScalar(0.4 + 2.2 * st.ping)
        p.m.opacity = sonarOn ? 0.8 * (1 - st.ping) : 0
      }
      if (a.servo > 0.1) st.sweep += dt * 2.2
      horn.rotation.z = 1.1 * Math.sin(st.sweep)
      for (const id of ['esp32', 'sonar', 'servo', 'motors'] as const) {
        tags[id].show(mAh(a[id]))
        tags[id].frame(dt)
      }
    },
  }
}

const PACK_2S: PackSpec = { key: 'li', series: 2, r: 0.8, text: '2S 18650' }

/** Stacked columns of `perUnit` per amp/watt from `at`, one block per item, with a tick axis on the left. */
function columns(scene: THREE.Object3D, at: V3, heads: [string, string][], perUnit: number, step: number, top: number, unit: string) {
  const g = add(scene, new THREE.Group(), at)
  const gap = 2.8
  const axisMat = glowMat(GREY, 0.3)
  add(g, mesh(new THREE.BoxGeometry(0.08, top * perUnit + 0.4, 0.08), axisMat), [-1.6, (top * perUnit + 0.4) / 2, 0])
  for (let v = 0; v <= top + 1e-9; v += step) {
    add(g, mesh(new THREE.BoxGeometry(0.4, 0.06, 0.06), axisMat), [-1.6, v * perUnit, 0])
    add(g, label(String(+v.toFixed(2)), { size: 0.42, color: GREY, align: 'right' }), [-2, v * perUnit, 0])
  }
  add(g, label(unit, { size: 0.45, color: GREY, align: 'right' }), [-2, top * perUnit + 1, 0])
  const bars = heads.map(([text, color], i) => {
    const bar = inOutBars(g, ITEMS.map((id) => COLOR[id]), perUnit, 1.6)
    bar.group.position.x = i * gap + (1.6 + 0.5) / 2
    add(g, label(text, { size: 0.5, color }), [i * gap, -1, 0])
    return bar
  })
  const totals = add(g, new THREE.Group())
  return {
    group: g,
    bars,
    totals(texts: string[]) {
      emptyGroup(totals)
      texts.forEach((t, i) => add(totals, label(t, { size: 0.45, color: LABEL }), [i * gap, -2.1, 0]))
    },
  }
}

// --- Add up the loads: list every load by rail and state; the buck turns 5 V amps into fewer pack amps. ---

const STATES: { value: RobotState; label: string }[] = [
  { value: 'sleep', label: 'Deep sleep' },
  { value: 'idle', label: 'Parked, WiFi on' },
  { value: 'scan', label: 'Scanning' },
  { value: 'cruise', label: 'Driving' },
  { value: 'stall', label: 'Stalled' },
]
const V_NOM = 2 * LI.nominal
const PER_A = 3.2

const pickState = (p: Params) => (STATES.find((s) => s.value === p.state) ?? STATES[3]).value

export const addUpTheLoads: Lesson = {
  id: 'power-budget-add-up-the-loads',
  title: 'Add up the loads',
  tagline: 'Every part’s current, rail by rail, back to the pack',
  formula: (p) => {
    const b = budgetOf(stateAmps(pickState(p), V_NOM), V_NOM)
    return `I_pack = I_motor rail + 5 V × I_5V / (η × V_pack) = ${amps(b.motorA)} + 5 V × ${amps(b.logicA)} / (${pct(b.conv.efficiency)} × ${volts(V_NOM)}) = ${amps(b.packA)}`
  },
  legend: LOAD_LEGEND,
  points: [
    'List every load with its current in each state: datasheet typicals, or better, a USB meter or a meter in series with each part.',
    'Sum per rail. The 5 V rail (ESP32, HC-SR04, servo) comes from the LM2596; the motors and the L298N run straight off the 2S pack.',
    'A buck converts power, not current: 5 V × I_5V ÷ η ÷ V_pack. 140 mA at 5 V costs only ~110 mA from a 7.4 V pack.',
    'The ESP32 swings from 8 mA asleep (a DevKit’s LED and USB chip; the bare chip needs 10 µA) to 120 mA on WiFi. A sweeping SG90 takes 250 mA.',
    'Two TT motors driving ≈ 0.5 A; stalled against a wall each pulls (V − 1.4 V L298N drop) / 5.6 Ω ≈ 1 A. The bridge burns ~2 V of it as heat.',
    'Size the pack and buck for the worst state, the battery life for the typical one.',
  ],
  controls: [{ kind: 'choice', key: 'state', options: STATES, initial: 'cruise' }],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const rig = robotRig(scene, [PACK_2S])
    rig.showPack('li')
    const cols = columns(scene, [12, -7.2, 0], [['5 V', B_FIELD], ['MOTOR', POWER], ['PACK', LABEL]], PER_A, 0.5, 2.5, 'A')
    const zero = Object.fromEntries(ITEMS.map((id) => [id, 0])) as Record<ItemId, number>
    const shown = [{ ...zero }, { ...zero }, { ...zero }]
    const st = { key: '', state: 'cruise' as RobotState, a: stateAmps('cruise', V_NOM), b: budgetOf(stateAmps('cruise', V_NOM), V_NOM) }

    return {
      scene,
      view: { center: [3.4, -0.6, 0], radius: 58, polar: 1.4, azimuth: 0.08 },
      frame(dt, p) {
        const state = pickState(p)
        if (state !== st.key) {
          st.key = state
          st.state = state
          st.a = stateAmps(state, V_NOM)
          st.b = budgetOf(st.a, V_NOM)
          cols.totals([st.b.logicA, st.b.motorA, st.b.packA].map((x) => x.toFixed(2)))
        }
        const { a, b } = st
        const target: Record<ItemId, number>[] = [
          { ...zero, esp32: a.esp32, sonar: a.sonar, servo: a.servo },
          { ...zero, motors: a.motors, l298n: a.driver },
          Object.fromEntries(b.items.map((i) => [i.id, i.packA])) as Record<ItemId, number>,
        ]
        cols.bars.forEach((bar, k) => {
          for (const id of ITEMS) shown[k][id] = glide(dt, shown[k][id], target[k][id], 6)
          bar.set(ITEMS.map((id) => shown[k][id]))
        })
        rig.set(dt, a, b, state === 'cruise' ? 1 : 0, 'li')
      },
      readouts: () => {
        const { b } = st
        return [
          { label: '5 V rail (ESP32 + sonar + servo)', value: amps(b.logicA) },
          { label: 'Motor rail (motors + L298N)', value: amps(b.motorA), tone: st.state === 'stall' ? 'bad' : undefined },
          { label: `From the pack (${volts(V_NOM)})`, value: `${amps(b.packA)} · ${watts(b.packW)}` },
          { label: 'Runtime if it stayed like this', value: hours(packRuntime(LI, 2, 1, b.packW).hours) },
        ]
      },
    }
  },
}

// --- Runtime estimate: a duty cycle of driving and resting, averaged; the pack's watt-hours over the average watts. ---

const RESTS: { value: RobotState; label: string }[] = [
  { value: 'idle', label: 'Rest: WiFi on' },
  { value: 'sleep', label: 'Rest: deep sleep' },
  { value: 'cut', label: 'Sleep + cut motor side' },
]
const CYCLE_S = 5
const PLAY2_S = 12
const HOLD2_S = 2.5
const PER_W = 1.3
const GAUGE: V3 = [-13.4, 9.4, 0]
const GAUGE_W = 5

const solveRun = (p: Params) => {
  const duty = n(p, 'duty') / 100
  const rest = (RESTS.find((r) => r.value === p.rest) ?? RESTS[1]).value
  const parallel = n(p, 'pack')
  const drive = budgetOf(stateAmps('cruise', V_NOM), V_NOM)
  const still = budgetOf(stateAmps(rest, V_NOM), V_NOM)
  const avg = averageBudget([[duty, drive], [1 - duty, still]])
  const run = packRuntime(LI, 2, parallel, avg.packW)
  const ranked = [...avg.items].sort((x, y) => y.watts - x.watts)
  return { duty, rest, parallel, drive, still, avg, run, top: ranked[0], speedup: Math.round((run.hours * 3600) / PLAY2_S) }
}

export const runtimeEstimate: Lesson = {
  id: 'power-budget-runtime-estimate',
  title: 'Runtime estimate',
  tagline: 'Average the duty cycle, divide the watt-hours',
  formula: (p) => {
    const s = solveRun(p)
    return `P_avg = d·P_drive + (1 − d)·P_rest = ${s.duty.toFixed(2)} × ${watts(s.drive.packW)} + ${(1 - s.duty).toFixed(2)} × ${watts(s.still.packW)} = ${watts(s.avg.packW)} · t = ${s.run.wh.toFixed(1)} Wh / ${watts(s.avg.packW)} = ${hours(s.run.hours)}`
  },
  legend: [...LOAD_LEGEND, { color: RING, label: 'Pack charge left', shape: 'dot' }],
  points: [
    'A robot is rarely at full load. Split its time into states, weight each state’s power by the share of time spent in it: P_avg = Σ dₖ·Pₖ.',
    'Runtime = usable Wh ÷ P_avg. Use watts, not mA, when rails differ: the pack’s Wh is cells × 3.7 V × Ah, a bit less at high current.',
    'Driving all the time, the motors eat most of it: ~4.8 W gives 4–5 h from 2S 18650s. Doubling to 2S2P doubles that.',
    'Parked with WiFi on still costs ~1 W. Deep sleep drops the ESP32 to 8 mA, but now the L298N’s 36 mA logic supply is the biggest eater.',
    'Cut the motor side with a switch or a P-MOSFET while asleep and the idle drain falls ~5×: days instead of hours.',
    'Keep 20 % margin: cells age, cold cuts capacity, and the low-voltage cut-off ends the run before 0 %.',
  ],
  controls: [
    { kind: 'slider', key: 'duty', label: 'Time spent driving', min: 0, max: 100, initial: 25, step: 5, format: (v) => `${v} %` },
    { kind: 'choice', key: 'rest', options: RESTS, initial: 'sleep' },
    {
      kind: 'choice',
      key: 'pack',
      options: [
        { value: '1', label: '2S1P' },
        { value: '2', label: '2S2P' },
      ],
      initial: '1',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const rig = robotRig(scene, [PACK_2S, { key: 'li2', series: 2, parallel: 2, r: 0.8, text: '2S2P 18650' }])
    const cols = columns(scene, [12, -6.6, 0], [['AVERAGE', LABEL]], PER_W, 1, 5, 'W')
    const shares = add(cols.group, new THREE.Group())
    add(scene, mesh(new THREE.BoxGeometry(GAUGE_W + 0.3, 1.2, 0.6), mat('#2a2c32', { rough: 0.5 })), [GAUGE[0] + GAUGE_W / 2, GAUGE[1], -0.2])
    const fill = add(scene, mesh(new THREE.BoxGeometry(1, 1, 0.6), glowMat(RING, 0.8)))
    const clock = pulseLabel(scene, 3, RING, [GAUGE[0] + 0.9, GAUGE[1] - 1.7, 0], 0.9)
    const clockUnit = add(scene, new THREE.Group(), [GAUGE[0] + 2.9, GAUGE[1] - 1.9, 0])
    add(scene, label('CYCLE', { size: 0.45, color: GREY }), [-4.6, -9.2, 0])
    const cycleBar = add(scene, mesh(new THREE.BoxGeometry(1, 0.3, 0.3), glowMat(POWER, 0.8)))
    const restBar = add(scene, mesh(new THREE.BoxGeometry(1, 0.3, 0.3), glowMat(GREY, 0.4)))
    const cursor = add(scene, mesh(new THREE.SphereGeometry(0.3, 14, 10), glowMat('#ffffff', 1.2)))
    const shown = Object.fromEntries(ITEMS.map((id) => [id, 0])) as Record<ItemId, number>
    const st = { key: '', t: 0, cyc: 0, unit: '', s: solveRun({ duty: 25, rest: 'sleep', pack: 1 }) }
    const CYC_X = -1.4
    const CYC_W = 10

    return {
      scene,
      view: { center: [3.4, -0.6, 0], radius: 58, polar: 1.4, azimuth: 0.08 },
      frame(dt, p) {
        const key = `${p.duty}|${p.rest}|${p.pack}`
        if (key !== st.key) {
          const s = solveRun(p)
          st.key = key
          st.s = s
          st.t = 0
          rig.showPack(s.parallel === 2 ? 'li2' : 'li')
          cols.totals([watts(s.avg.packW)])
          emptyGroup(shares)
          let y = 0
          for (const id of ITEMS) {
            const w = s.avg.items.find((i) => i.id === id)!.watts
            const h = w * PER_W
            const share = w / s.avg.packW
            if (share > 0.04 && h > 0.45) add(shares, label(`${NAME[id]} ${pct(share)}`, { size: 0.42, color: COLOR[id], align: 'left' }), [2.4, y + h / 2, 0])
            y += h
          }
          cycleBar.scale.x = Math.max(0.001, CYC_W * s.duty)
          cycleBar.position.set(CYC_X + (CYC_W * s.duty) / 2, -9.2, 0)
          restBar.scale.x = Math.max(0.001, CYC_W * (1 - s.duty))
          restBar.position.set(CYC_X + CYC_W * s.duty + (CYC_W * (1 - s.duty)) / 2, -9.2, 0)
        }
        const s = st.s
        st.t += dt
        if (st.t > PLAY2_S + HOLD2_S) st.t = 0
        const u = Math.min(st.t, PLAY2_S) / PLAY2_S
        const h = u * s.run.hours
        const charge = 1 - u
        fill.scale.set(Math.max(0.001, GAUGE_W * charge), 0.8, 1)
        fill.position.set(GAUGE[0] + (GAUGE_W * charge) / 2, GAUGE[1], 0.2)
        const unit = h < 1 ? 'MIN' : h < 48 ? 'HOURS' : 'DAYS'
        clock.show(fitDigits(h < 1 ? h * 60 : h < 48 ? h : h / 24, 3))
        clock.frame(dt)
        if (unit !== st.unit) {
          st.unit = unit
          emptyGroup(clockUnit)
          add(clockUnit, label(unit, { size: 0.45, color: GREY, align: 'left' }))
        }
        st.cyc = (st.cyc + dt / CYCLE_S) % 1
        cursor.position.set(CYC_X + CYC_W * st.cyc, -9.2, 0.3)
        const driving = st.cyc < s.duty
        const b = driving ? s.drive : s.still
        for (const id of ITEMS) shown[id] = glide(dt, shown[id], s.avg.items.find((i) => i.id === id)!.watts, 6)
        cols.bars[0].set(ITEMS.map((id) => shown[id]))
        rig.set(dt, stateAmps(driving ? 'cruise' : s.rest, V_NOM), b, driving ? 1 : 0, s.parallel === 2 ? 'li2' : 'li')
      },
      readouts: () => {
        const s = st.s
        const u = Math.min(st.t, PLAY2_S) / PLAY2_S
        return [
          { label: 'Average from the pack', value: `${watts(s.avg.packW)} · ${amps(s.avg.packW / V_NOM)}` },
          { label: `Runtime (${s.run.wh.toFixed(1)} Wh usable)`, value: hours(s.run.hours), tone: s.run.hours > 24 ? 'ok' : s.run.hours < 6 ? 'warn' : undefined },
          { label: 'Biggest eater', value: `${NAME[s.top.id]} · ${pct(s.top.watts / s.avg.packW)}` },
          { label: `Time (${s.speedup.toLocaleString('en-US')}× fast) · charge`, value: `${hours(u * s.run.hours)} · ${pct(1 - u)}` },
        ]
      },
    }
  },
}

// --- Peak vs average: an 8 s errand on the scope. Starts and WiFi bursts spike far above the mean and sag the pack. ---

const PACKS3 = {
  aa: { spec: { key: 'aa', series: 6, r: 0.42, text: '6× AA' } as PackSpec, ocv: (soc: number) => 6 * openCircuitVolts(ALK, soc), ohms: 6 * ALK.cell.ohms },
  li: { spec: { key: 'li', series: 2, r: 0.8, text: '2S 18650' } as PackSpec, ocv: (soc: number) => 2 * cellVolts(LI, soc), ohms: 2 * LI.cell.ohms },
}
const SAMPLES = 400
const SC3: V3 = [13.2, 0.4, 0]
const SC3_W = 9
const SC3_H = 8
const I_TOP = 2.5
const BROWNOUT_V = 4.4
const DIP_V = 4.75

const computePeak = (p: Params) => {
  const kind = p.pack === 'aa' ? 'aa' : 'li'
  const pk = PACKS3[kind]
  const ramp = p.start === 'soft' ? 0.5 : 0
  const soc = n(p, 'charge') / 100
  const ocv = pk.ocv(soc)
  const samples = Array.from({ length: SAMPLES }, (_, i) => {
    const t = (i / SAMPLES) * MISSION_S
    const b = budgetAt(ocv, pk.ohms, (v) => missionAmps(t, v, ramp))
    return { t, b, a: missionAmps(t, b.vpack, ramp) }
  })
  const avg = samples.reduce((s, x) => s + x.b.packA, 0) / SAMPLES
  const peak = samples.reduce((m, x) => (x.b.packA > m.b.packA ? x : m))
  const low = samples.reduce((m, x) => (x.b.conv.vout < m.b.conv.vout ? x : m))
  return { kind, ramp, soc, ocv, ohms: pk.ohms, samples, avg, peak, low, browns: low.b.conv.vout < BROWNOUT_V }
}

const solvePeak = memoBy((p: Params) => `${p.pack}|${p.start}|${p.charge}`, computePeak)

export const peakVsAverage: Lesson = {
  id: 'power-budget-peak-vs-average',
  title: 'Peak vs average',
  tagline: 'Capacity follows the average; wiring and the pack must survive the peaks',
  formula: (p) => {
    const s = solvePeak(p)
    return `peak / average = ${amps(s.peak.b.packA)} / ${amps(s.avg)} = ${(s.peak.b.packA / s.avg).toFixed(1)}× · sag = I·R = ${amps(s.peak.b.packA)} × ${s.ohms.toFixed(2)} Ω = ${volts(s.ocv - s.peak.b.vpack)}`
  },
  legend: [
    { color: HEAT, label: 'Pack current', shape: 'dot' },
    { color: POWER, label: 'Average current', shape: 'dot' },
    { color: HIGH_V, label: 'Peak current', shape: 'dot' },
  ],
  points: [
    'The average sets the runtime; the peaks set the pack, wires, fuse, BMS and converter. A robot car runs 4–5× above its average for moments.',
    'Peaks: motors starting from rest draw stall current until they spin up (~0.1 s); WiFi transmit bursts hit ~350 mA; a servo jumping to a new angle.',
    'Each peak sags the pack by I × R. Two 18650s (≈ 0.08 Ω) shrug it off; six AA alkalines (≈ 0.9 Ω) lose volts, worse as they empty.',
    'Sag far enough and the LM2596 drops out: the 5 V rail dips, the ESP32 browns out and resets mid-move.',
    'Soft-start the motors (ramp the PWM over ~0.5 s) to cut the start peak by more than half. Bulk caps on the rails cover the short WiFi spikes.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'pack',
      options: [
        { value: 'li', label: '2S 18650' },
        { value: 'aa', label: '6× AA alkaline' },
      ],
      initial: 'li',
    },
    {
      kind: 'choice',
      key: 'start',
      options: [
        { value: 'hard', label: 'Hard start' },
        { value: 'soft', label: 'Soft start' },
      ],
      initial: 'hard',
    },
    { kind: 'slider', key: 'charge', label: 'Pack charge', min: 5, max: 100, initial: 60, step: 5, format: (v) => `${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const rig = robotRig(scene, [PACKS3.li.spec, PACKS3.aa.spec])
    const plot = scope(scene, SC3_W, SC3_H, { divs: [8, 5], zeroAt: 0 })
    plot.group.position.set(...SC3)
    const yOf = (a: number) => (a / I_TOP) * SC3_H - SC3_H / 2
    ticks(plot, [], [0, 0.5, 1, 1.5, 2, 2.5].map((a): [number, string] => [a / I_TOP, String(a)]))
    add(plot.group, label('A', { size: 0.6, color: HEAT }), [SC3_W / 2 + 1.5, SC3_H / 2 + 1.4, 0])
    add(plot.group, label('8 S ERRAND  REAL TIME', { size: 0.45, color: GREY }), [0, -SC3_H / 2 - 1.2, 0])
    const avgLine = plot.level(POWER)
    const peakLine = plot.level(HIGH_V, 0.3)
    const trace = plot.trace(HEAT, { samples: 320, radius: 0.09 })
    const status = add(scene, new THREE.Group(), [SC3[0], SC3[1] - SC3_H / 2 - 3, 0])
    const st = { key: '', t: 0, status: '', s: solvePeak({ pack: 'li', start: 'hard', charge: 60 }) }
    const at = (t: number) => st.s.samples[Math.floor((((t % MISSION_S) + MISSION_S) % MISSION_S) / MISSION_S * SAMPLES) % SAMPLES]

    return {
      scene,
      view: { center: [3.4, -0.6, 0], radius: 58, polar: 1.4, azimuth: 0.08 },
      frame(dt, p) {
        const key = `${p.pack}|${p.start}|${p.charge}`
        if (key !== st.key) {
          st.key = key
          st.s = solvePeak(p)
          rig.showPack(st.s.kind)
          avgLine.set(yOf(st.s.avg))
          peakLine.set(yOf(Math.min(I_TOP, st.s.peak.b.packA)))
        }
        st.t += dt
        trace.scroll((t) => yOf(at(t).b.packA), st.t, MISSION_S)
        const k = at(st.t)
        const { state, since } = missionState(st.t)
        rig.set(dt, k.a, k.b, state === 'cruise' ? 1 - Math.exp(-since / 0.3) : 0, st.s.kind)
        const rail = k.b.conv.vout
        const text = rail < BROWNOUT_V ? `BROWNOUT  5 V RAIL ${volts(rail)}` : rail < DIP_V ? `5 V RAIL DIPS TO ${volts(rail)}` : `PACK ${volts(k.b.vpack)}  5 V RAIL OK`
        if (text !== st.status) {
          st.status = text
          emptyGroup(status)
          add(status, label(text, { size: 0.6, color: rail < BROWNOUT_V ? HIGH_V : rail < DIP_V ? RING : POWER }))
        }
      },
      readouts: () => {
        const s = st.s
        const ratio = s.peak.b.packA / s.avg
        return [
          { label: 'Average · peak', value: `${amps(s.avg)} · ${amps(s.peak.b.packA)}` },
          { label: 'Peak ÷ average', value: `${ratio.toFixed(1)}×`, tone: ratio > 4 ? 'warn' : undefined },
          { label: `Pack at the peak (rest ${volts(s.ocv)})`, value: volts(s.peak.b.vpack), tone: s.ocv - s.peak.b.vpack > 1 ? 'warn' : undefined },
          { label: 'Lowest 5 V rail', value: volts(s.low.b.conv.vout), tone: s.browns ? 'bad' : s.low.b.conv.vout < DIP_V ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
