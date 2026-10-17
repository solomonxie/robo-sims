import * as THREE from 'three/webgpu'
import {
  AIRFLOW,
  Airflow,
  INTERFACES,
  Interface,
  LM2596,
  LM7805,
  PlateCfg,
  REG_COOLERS,
  RegCooler,
  SOLIDS,
  PlateSolid,
  TAB,
  boardC,
  chainTemps,
  cooledReg,
  dcdcPoint,
  fixedStepAt,
  linearReg,
  plateRun,
  regHeatRun,
} from '../../core/physics'
import { amps, celsiusText, hoursText, mmText, mmTenths, pct, thetaText, volts, watts } from '../../core/units'
import { add, box, mat } from '../../models/kit'
import { buildTo220, TO220 } from '../../models/passives'
import { createStage } from '../../scene/stage'
import {
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  boxFan,
  countBars,
  cursorBar,
  fetPart,
  heatGlow,
  heatWaves,
  lapseClock,
  liveLabel,
  memoBy,
  sideView,
  statusHeader,
  thermalLadder,
  titledScope,
  traceRun,
} from '../fx'
import { Lesson, Params, Stage, namesOf, n, opts, pick, toneOf } from '../types'

const VIEW = sideView(-1.5, -1)
const AMB = 25
const minText = (s: number) => (s < 60 ? `${Math.round(s)} s` : hoursText(s / 3600))
const toneC = (c: number) => toneOf(c < 100, c < 150)

// --- Thermal resistance: a 2 W TO-220 part on a plate; the heat path as series °C/W, then the warm-up through C·θ. ---

const WATTS = 2
const TR_S = 1800
const TR_DT = 2
const TR_MAX = 300
const K = 0.13
const SOLID_NAMES = namesOf(SOLIDS)
const JOINT_NAMES = namesOf(INTERFACES)
const AIR_NAMES = namesOf(AIRFLOW)
const SOLID_LOOK: Record<PlateSolid, { color: string; metal: number; rough: number }> = {
  copper: { color: '#c87533', metal: 0.7, rough: 0.3 },
  aluminium: { color: '#c9cdd3', metal: 0.6, rough: 0.35 },
  steel: { color: '#868b93', metal: 0.6, rough: 0.45 },
  fr4: { color: '#2f6b3f', metal: 0, rough: 0.6 },
}
const trParams = (p: Params): PlateCfg => ({
  watts: WATTS,
  solid: pick(SOLIDS, p.solid, 'aluminium') as PlateSolid,
  thicknessM: n(p, 'thick') / 1000,
  sideM: n(p, 'side') / 1000,
  joint: pick(INTERFACES, p.joint, 'paste') as Interface,
  air: pick(AIRFLOW, p.air, 'still') as Airflow,
})
const trRun = memoBy(
  (c: PlateCfg) => `${c.solid} ${c.thicknessM} ${c.sideM} ${c.joint} ${c.air}`,
  (c: PlateCfg) => {
    const R = plateRun(c, TR_S, TR_DT)
    const [rjc, rj, rp, ra] = R.chain.rs
    const worst = R.chain.rs.indexOf(Math.max(...R.chain.rs))
    return { ...R, rjc, rj, rp, ra, worst, inner: [0, rjc, rjc + rj, rjc + rj + rp].map((r) => WATTS * r) }
  },
)
const STAGES = ['θjc', 'θjoint', 'θplate', 'θair']
const STAGE_WHY = ['inside the package', 'tab-to-plate joint', 'through the plate', 'plate to the air']

export const heatTransferThermalResistance: Lesson = {
  id: 'heat-transfer-thermal-resistance',
  title: 'Thermal resistance',
  tagline: 'Heat flows like current: °C/W in series, and the air is the big resistor',
  formula: (p) => {
    const R = trRun(trParams(p))
    return `Tj = Ta + P·(θjc + θjoint + θplate + θair) = ${AMB} °C + ${WATTS} W × (${R.chain.rs.map((r) => thetaText(r).replace(' °C/W', '')).join(' + ')}) °C/W = ${celsiusText(R.chain.temps[0])} · θ = L/(kA) through, 1/(hA) to air · τ = C·θair = ${R.chain.heatJPerK.toFixed(1)} J/K × ${thetaText(R.ra)} = ${minText(R.chain.tauS)}`
  },
  legend: [
    { color: HEAT, label: 'Heat path: column height = °C, like volts', shape: 'dot' },
    { color: HIGH_V, label: '150 °C: most silicon gives up here', shape: 'dot' },
    { color: RING, label: 'Junction warming up (time-lapse)', shape: 'dot' },
    { color: POWER, label: 'τ = C·θair: 63 % of the rise', shape: 'dot' },
  ],
  points: [
    'Heat flows from hot to cold the way current flows from high to low voltage. Temperature difference plays voltage, watts play amps, and °C/W plays ohms: ΔT = P × θ. A 2 W part behind 20 °C/W runs 40 °C above the air.',
    'The path from the silicon to the room is resistors in series: junction to case (fixed by the package), the joint under the tab, through the plate, and from the plate surface into the air. They add, and each drop is P × θ, exactly like a voltage divider.',
    'Conduction: θ = L / (k·A). Copper (k = 400) and aluminium (205) barely resist; FR4 board (0.3) is a thousand times worse and air (0.026) worse again. That is why a part lifted 0.1 mm off its plate can cook while thermal paste, filling the gaps, costs a fraction of a degree.',
    'Convection: θ = 1 / (h·A). Still air takes only about 8 W per m² per °C, so the air side is nearly always the biggest resistor. Only area (a bigger plate, fins) or moving air (a fan, h ≈ 40) shrinks it. Radiation helps a little in parallel: matte FR4 (ε 0.9) radiates far better than shiny metal (Infrared & thermal › Black-body radiation).',
    'Temperature does not jump: the plate is a heat capacity C (J/K) charged through θair, an RC circuit. It reaches 63 % of its rise after τ = C·θ and is settled after about 5τ, minutes for a metal plate. A short burst can run hotter than steady-state allows; a long one cannot. The model takes the plate as evenly warm; real FR4 is hot only near the part, so it does worse still. Choosing a heatsink: Materials › Thermal design › Heatsinks.',
  ],
  controls: [
    { kind: 'choice', key: 'solid', options: opts(SOLID_NAMES), initial: 'aluminium' },
    { kind: 'slider', key: 'thick', label: 'Plate thickness', min: 0.5, max: 6, step: 0.1, initial: 2, format: (v) => mmTenths(v / 1000) },
    { kind: 'slider', key: 'side', label: 'Plate size (square)', min: 20, max: 100, step: 5, initial: 50, format: (v) => mmText(v / 1000) },
    { kind: 'choice', key: 'joint', options: opts(JOINT_NAMES), initial: 'paste' },
    { kind: 'choice', key: 'air', options: opts(AIR_NAMES), initial: 'still' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const C0 = { x: -10.3, y: 0.9 }
    const asm = add(scene, new THREE.Group(), [C0.x, C0.y, 0])
    asm.rotation.set(0.4, -0.4, 0)
    const plateM = mat('#c9cdd3', { metal: 0.6, rough: 0.35 }, true)
    const plate = box(asm, [1, 1, 1], plateM)
    const jointM = mat('#d8d8d8', { rough: 0.6 }, true)
    const joint = box(asm, [TAB.side * 1000 * K * 1.1, 1, TAB.side * 1000 * K * 1.4], jointM)
    const part = add(asm, buildTo220({ legs: 0.8 }))
    const ps = 2.54 * K
    part.scale.setScalar(ps)
    part.rotation.x = -Math.PI / 2
    const body = part.userData.body as THREE.MeshStandardMaterial
    const waves = heatWaves(scene, 4, { count: 5, rise: 0.6 })
    const fan = boxFan(scene, [0, C0.y, 0], 2.6)
    fan.group.rotation.y = 1.1
    const what = liveLabel(scene, [C0.x, -2.4, 0.4], { size: 0.3 })
    const why = liveLabel(scene, [C0.x, -3.0, 0.4], { size: 0.26 })

    const ladder = thermalLadder(scene, [-2.2, -0.6, 0], ['junction', 'case', 'plate', 'face', 'air'], STAGES, { w: 13, h: 5, maxC: TR_MAX })
    const plot = titledScope(scene, -7.3, 4, 'junction (yellow), plate face (grey), 0 … 300 °C', RING, 0, -1.5, 29)
    const { s } = plot
    const lim = s.level(HIGH_V)
    lim.set(-plot.h / 2 + (150 / TR_MAX) * plot.h)
    const tsTr = s.trace(GREY, { samples: 200, radius: 0.05 })
    const tjTr = s.trace(RING, { samples: 200, radius: 0.08 })
    const tauBar = cursorBar(s, POWER, 0.06)
    plot.lo.set('0')
    plot.hi.set('30 min')
    const yOf = (c: number) => -plot.h / 2 + (c / TR_MAX) * plot.h
    const clock = lapseClock(TR_S, 90, 300)
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const c = trParams(p)
        const R = trRun(c)
        const now = clock(dt, `${c.solid} ${c.thicknessM} ${c.sideM} ${c.joint} ${c.air}`)
        const f = fixedStepAt(R.run, now, TR_DT)

        const side = c.sideM * 1000 * K
        const th = Math.max(0.08, c.thicknessM * 1000 * K * 1.5)
        plate.scale.set(side, th, side)
        plate.position.y = -th / 2
        const look = SOLID_LOOK[c.solid]
        plateM.color.set(look.color)
        plateM.metalness = look.metal
        plateM.roughness = look.rough
        plateM.emissive.set(HEAT)
        plateM.emissiveIntensity = 0.5 * Math.min(1, Math.max(0, (f.ts - 40) / 150))
        const jt = c.joint === 'pad' ? 0.15 : 0.04
        joint.scale.y = jt
        joint.position.y = jt / 2
        jointM.color.set(c.joint === 'air' ? '#7ad0ff' : c.joint === 'pad' ? '#9aa3ad' : '#e8e8e8')
        jointM.opacity = c.joint === 'air' ? 0.25 : 1
        jointM.transparent = c.joint === 'air'
        part.position.set(0, jt + (TO220.t / 2) * ps, (TO220.base + TO220.h / 2) * ps)
        heatGlow(body, (f.tj - 90) / 150)
        waves.group.position.set(C0.x, C0.y + 0.6, 0.5)
        waves.step(dt, (f.ts - AMB) / 60)
        fan.group.visible = c.air === 'fan'
        fan.group.position.x = C0.x - side / 2 - 2
        fan.spin(dt, 18)
        what.set(`${SOLIDS[c.solid].name} ${mmTenths(c.thicknessM)} · ${mmText(c.sideM)} square · ${INTERFACES[c.joint].name.toLowerCase()}`, LABEL)
        why.set(`biggest resistor: ${STAGES[R.worst]}, ${STAGE_WHY[R.worst]} (${pct(R.chain.rs[R.worst] / R.chain.rTotal)})`, HEAT)

        ladder.set([f.tj, f.tj - R.inner[1], f.tj - R.inner[2], f.ts, AMB], R.chain.rs, `${WATTS} W →`)
        const u = now / TR_S
        traceRun(tjTr, R.run, TR_DT, TR_S, now, (x) => yOf(x.tj))
        traceRun(tsTr, R.run, TR_DT, TR_S, now, (x) => yOf(x.ts))
        tauBar(Math.min(1, R.chain.tauS / TR_S))
        plot.right.set(`τ = ${minText(R.chain.tauS)} · t = ${minText(now)}`, POWER)

        const hot = f.tj >= 150
        head.status.set(`Thermal resistance · Tj ${celsiusText(f.tj)} after ${minText(now)}`, hot ? HIGH_V : LABEL)
        head.sub.set(`${WATTS} W TO-220 part · ${AIRFLOW[c.air].name.toLowerCase()} at ${AMB} °C · time-lapse 90×`)
        head.event.set(
          R.chain.temps[0] >= 150 ? `settles at ${celsiusText(R.chain.temps[0])}: too hot` : `settles at ${celsiusText(R.chain.temps[0])} after about 5τ = ${minText(5 * R.chain.tauS)}`,
          R.chain.temps[0] >= 150 ? HIGH_V : u > 0.99 ? POWER : HEAT,
        )
      },
      readouts: (p) => {
        const R = trRun(trParams(p))
        return [
          { label: 'Junction, steady', value: celsiusText(R.chain.temps[0]), tone: toneC(R.chain.temps[0]) },
          { label: 'Junction to air θ', value: thetaText(R.chain.rTotal) },
          { label: 'Air side share', value: `${pct(R.ra / R.chain.rTotal)} (radiation ${pct(R.chain.radShare)})` },
          { label: 'Time constant τ', value: minText(R.chain.tauS) },
        ]
      },
    }
  },
}

// --- Cooling a regulator: an LM7805 dropping Vin to 5 V; bare, PCB copper, clip-on, finned, fan; shutdown cycling; the buck alternative. ---

const CR_S = 1200
const CR_DT = 0.5
const CR_MAX = 200
const JC_7805 = 5
const COOLER_NAMES = namesOf(REG_COOLERS)
const crParams = (p: Params) => ({ vin: n(p, 'vin'), a: n(p, 'amps'), k: pick(REG_COOLERS, p.cooler, 'bare') as RegCooler })
type CrQ = ReturnType<typeof crParams>
const crKey = (q: CrQ) => `${q.vin} ${q.a} ${q.k}`
const crRun = memoBy(crKey, (q: CrQ) => {
  const reg = cooledReg(LM7805, JC_7805, q.k)
  const R = regHeatRun(reg, q.vin, q.a, CR_S, CR_DT, AMB)
  const lin = linearReg(reg, q.vin, q.a)
  const bk = dcdcPoint(LM2596, q.vin, 5, q.a)
  return { ...R, reg, lin, temps: chainTemps(reg.chain, R.watts, AMB), buckW: bk.loss, buckC: boardC(LM2596, bk.loss, AMB), buckEff: bk.efficiency }
})

export const heatTransferCoolingARegulator: Lesson = {
  id: 'heat-transfer-cooling-a-regulator',
  title: 'Cooling a regulator',
  tagline: '12 V to 5 V through a 7805: every volt dropped is heat to get rid of',
  formula: (p) => {
    const q = crParams(p)
    const R = crRun(q)
    return `P = (Vin − Vout)·I + Vin·Iq = (${volts(q.vin)} − ${volts(R.lin.vout)}) × ${amps(q.a)} + ${volts(q.vin)} × 5 mA = ${watts(R.watts)} · Tj = ${AMB} °C + P × (θjc + θcs + θsa) = ${AMB} + ${watts(R.watts)} × (${R.reg.chain.join(' + ')}) °C/W = ${celsiusText(R.steadyC)} · buck: ${watts(R.buckW)} lost`
  },
  legend: [
    { color: HEAT, label: 'Heat path: column height = temperature', shape: 'dot' },
    { color: HIGH_V, label: '150 °C: thermal shutdown', shape: 'dot' },
    { color: RING, label: 'Junction over 20 min (time-lapse)', shape: 'dot' },
    { color: POWER, label: 'Same job with an LM2596 buck', shape: 'dot' },
  ],
  points: [
    'A 7805 makes 5 V by burning the rest: P = (Vin − 5 V) × I. From 12 V at 0.5 A that is 3.5 W of heat, more than the 2.5 W delivered to the load. The physics of the heat path is Thermal resistance; the electronics is Components › Voltage regulators › Dropout and heat.',
    'Junction temperature = ambient + P × (θjc + θcs + θsa). θjc is 5 °C/W, fixed by the TO-220 package. Standing bare, the package itself is the sink: about 50 °C/W in total, so 3.5 W would mean 200 °C.',
    'Each cooler only attacks the last two terms: tab soldered flat to a copper pour (about 36 °C/W total), a clip-on fin (24), a 40 mm finned sink with paste (11.5), the same sink with a fan (7). Numbers are typical datasheet values; choosing one is Materials › Thermal design › Heatsinks.',
    'Past about 150 °C the 7805 shuts itself off, cools to about 135 °C and comes back: the output blinks on and off every few seconds and the robot browns out (Power › Brownout). A bigger sink also has more heat capacity, so it takes minutes to get there: a bench test of 30 s proves nothing.',
    'Or do not make the heat. A buck converter such as an LM2596 module switches instead of burning: around 85 % efficient here, so it loses a few hundred milliwatts and needs no sink at all (Power › Buck & boost › Efficiency). Linear regulators earn their place for small drops and quiet rails.',
  ],
  controls: [
    { kind: 'slider', key: 'vin', label: 'Vin', min: 7, max: 24, step: 0.5, initial: 12, format: volts },
    { kind: 'slider', key: 'amps', label: 'Load current', min: 0.05, max: 1.5, step: 0.05, initial: 0.5, format: amps },
    { kind: 'choice', key: 'cooler', options: opts(COOLER_NAMES), initial: 'bare' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const C0 = { x: -10.5, y: -2.6 }
    const kk = 0.75 * 0.95
    const asm = add(scene, new THREE.Group(), [C0.x, C0.y, 0])
    asm.rotation.set(0.15, 0.85, 0)
    const reg = fetPart(asm, [-kk, 0, 0], 'TO-220', { scale: 0.95, letters: ['IN', 'OUT', 'GND'] })
    const zBack = -(TO220.t / 2) * 1.2
    const sinkM = mat('#24262c', { rough: 0.5, metal: 0.4 }, true)
    const looks: Record<RegCooler, THREE.Group> = {
      bare: new THREE.Group(),
      pcb: new THREE.Group(),
      clip: new THREE.Group(),
      finned: new THREE.Group(),
      fan: new THREE.Group(),
    }
    box(looks.pcb, [9, 9, 0.3], mat('#2f6b3f', { rough: 0.6 }), [0, 3, zBack - 0.15])
    box(looks.pcb, [6, 6, 0.06], mat('#c87533', { metal: 0.6, rough: 0.35 }), [0, 4.2, zBack + 0.03])
    box(looks.clip, [5.2, 6.5, 0.15], sinkM, [0, 5, zBack - 0.08])
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) box(looks.clip, [0.15, 6.5, 1.6], sinkM, [sx * (2.6 - i * 0.6), 5, zBack - 0.9])
    for (const g of [looks.finned, looks.fan]) {
      box(g, [8, 8, 0.5], sinkM, [0, 4.5, zBack - 0.25])
      for (let i = 0; i < 9; i++) box(g, [0.18, 8, 3.2], sinkM, [-3.8 + i * 0.95, 4.5, zBack - 2.1])
    }
    const fan = boxFan(looks.fan, [-5.6, 4.5, zBack - 2.1], 6)
    fan.group.rotation.y = Math.PI / 2
    const sinks = add(asm, new THREE.Group())
    sinks.scale.setScalar(kk / 1.2)
    for (const g of Object.values(looks)) sinks.add(g)
    const waves = heatWaves(scene, 4, { count: 5, rise: 0.4 })
    waves.group.position.set(C0.x, C0.y + 4.6, 0)
    const coolTag = liveLabel(scene, [C0.x, C0.y - 1.6, 0.6], { size: 0.3 })

    const ladder = thermalLadder(scene, [-1.5, -0.8, 0], ['junction', 'case', 'sink', 'air'], ['θjc', 'θcs', 'θsa'], { w: 11.5, h: 5, maxC: CR_MAX })
    const plot = titledScope(scene, -7.3, 3.4, 'junction, 0 … 200 °C', RING, 0, 4.2, 18)
    const { s } = plot
    s.level(HIGH_V).set(-plot.h / 2 + (150 / CR_MAX) * plot.h)
    const steady = s.level(GREY, 0.3)
    const tjTr = s.trace(RING, { samples: 200, radius: 0.08 })
    plot.lo.set('0')
    plot.hi.set('20 min')
    const yOf = (c: number) => -plot.h / 2 + (c / CR_MAX) * plot.h
    liveLabel(scene, [-16.5, -5.4, 0.3], { size: 0.28, align: 'left' }).set('Heat to get rid of', LABEL)
    const bars = countBars(scene, [-12.2, -6.2, 0], ['7805 linear', 'LM2596 buck'], 3.4, { row: 0.8, size: 0.28 })
    const clock = lapseClock(CR_S, 60, 200)
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = crParams(p)
        const R = crRun(q)
        const now = clock(dt, crKey(q))
        const f = fixedStepAt(R.run, now, CR_DT)
        for (const [k, g] of Object.entries(looks)) g.visible = k === q.k
        fan.spin(dt, 20)
        reg.set(f.on ? q.a / LM7805.maxAmps : 0, (f.tj - 70) / 100)
        waves.step(dt, (f.tj - AMB) / 120)
        coolTag.set(REG_COOLERS[q.k].name, LABEL)

        const rise = Math.max(1e-6, R.steadyC - AMB)
        const live = R.temps.map((t) => AMB + ((t - AMB) * (f.tj - AMB)) / rise)
        ladder.set(live, R.reg.chain, `${watts(f.on ? R.watts : q.vin * LM7805.iq)} →`)
        traceRun(tjTr, R.run, CR_DT, CR_S, now, (x) => yOf(x.tj))
        steady.set(yOf(R.steadyC))
        plot.right.set(`steady ${celsiusText(R.steadyC)} · τ = ${minText(R.reg.tauS)}`, R.steadyC >= 150 ? HIGH_V : POWER)
        bars.set([R.watts, R.buckW], [watts(R.watts), `${watts(R.buckW)}, ${pct(R.buckEff)}`], [R.steadyC >= 150 ? HIGH_V : HEAT, POWER], Math.max(4, R.watts))

        head.status.set(`Cooling a regulator · ${volts(q.vin)} → 5 V at ${amps(q.a)} · Tj ${celsiusText(f.tj)}`, f.on ? LABEL : HIGH_V)
        head.sub.set(`LM7805, ${watts(R.watts)} of heat · ${AMB} °C air · t = ${minText(now)}, time-lapse 60×`)
        head.event.set(
          !f.on ? 'THERMAL SHUTDOWN: output off until it cools' : R.trips ? `will trip: steady state would be ${celsiusText(R.steadyC)}` : R.steadyC > LM7805.tMax ? 'runs, but above the 125 °C rating' : 'holds: settles below the limit',
          !f.on || R.trips ? HIGH_V : R.steadyC > LM7805.tMax ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const R = crRun(crParams(p))
        return [
          { label: 'Heat in the 7805', value: watts(R.watts), tone: R.watts > 2 ? 'warn' : 'ok' },
          { label: 'Junction, steady', value: celsiusText(R.steadyC), tone: toneC(R.steadyC) },
          { label: 'Output on (2nd 10 min)', value: pct(R.onShare), tone: R.onShare > 0.999 ? 'ok' : 'bad' },
          { label: 'Buck instead', value: `${watts(R.buckW)} lost, board ${celsiusText(R.buckC)}`, tone: 'ok' },
        ]
      },
    }
  },
}
