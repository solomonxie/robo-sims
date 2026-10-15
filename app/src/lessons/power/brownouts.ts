import * as THREE from 'three/webgpu'
import {
  AMS1117_33,
  BrownoutRig,
  CHEMISTRIES,
  ESP32_BOD,
  ESP32_MIN_V,
  ESP32_TIMELINE as TL,
  Phase,
  ResetKind,
  brownoutRun,
  dropoutVolts,
  minInputVolts,
  openCircuitVolts,
  peakBins,
  rideThroughS,
} from '../../core/physics'
import { amps, si, volts } from '../../core/units'
import { buildEsp32, buildL298n } from '../../models/modules'
import { buildElectrolyticCap } from '../../models/passives'
import { V3, add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  cableRun,
  cellPackModel,
  dcdcModule,
  diodeAlong,
  emptyGroup,
  glide,
  glowBox,
  label,
  lane,
  lieFlat,
  memoBy,
  motorCan,
  plusFlow,
  presence,
  pulseLabel,
  scope,
  sot223Regulator,
  standUp,
  ticks,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const PACK_OHMS = 0.52
const STALL_A = 2
const CRUISE_A = 0.4
const TAU = 0.05
const RAMP_S = 0.3
const HOLDUP = { farads: 10e-3, diodeV: 0.3 }
const BINS = 260
const aaVolts = (soc: number) => 4 * openCircuitVolts(CHEMISTRIES.nimh, soc)
const ms = (s: number) => `${Math.round(s * 1000)} ms`

const rigFor = (charge: number, bod: number, fix: string): BrownoutRig => ({
  ocv: aaVolts(charge / 100),
  ohms: PACK_OHMS,
  reg: AMS1117_33,
  bod,
  stallA: STALL_A,
  cruiseA: CRUISE_A,
  rampS: fix === 'soft' ? RAMP_S : 0,
  tau: TAU,
  holdup: fix === 'cap' ? HOLDUP : undefined,
  own: fix === 'own' ? { volts: 5, ohms: 0.1 } : undefined,
})

/** Scope of LDO input and 3.3 V rail over `window` s, with BOD and 3.0 V lines; `frame` sweeps over `playS` and returns the sample index. */
function railScope(scene: THREE.Object3D, at: V3, w: number, h: number, title: string, unit: string) {
  const [lo, hi] = [2, 5.5]
  const plot = scope(scene, w, h, { divs: [10, 5], zeroAt: 0 })
  plot.group.position.set(...at)
  const y = (v: number) => ((v - lo) / (hi - lo)) * h - h / 2
  ticks(plot, [], [2, 3, 4, 5].map((v): [number, string] => [(v - lo) / (hi - lo), String(v)]), 0.45)
  add(plot.group, label(title, { size: 0.5, color: LABEL, align: 'left' }), [-w / 2, h / 2 + 1, 0])
  add(plot.group, label(unit, { size: 0.45, color: GREY, align: 'left' }), [w / 2 - 0.9, h / 2 + 1, 0])
  const clock = pulseLabel(plot.group, 4, LABEL, [w / 2 - 3.2, h / 2 + 1, 0], 0.6)
  plot.level(HIGH_V).set(y(ESP32_MIN_V))
  add(plot.group, label('3.0 V MIN', { size: 0.34, color: HIGH_V, align: 'right' }), [-w / 2 - 0.3, y(ESP32_MIN_V) + 0.3, 0.2])
  const bodLine = plot.level(RING)
  const bodText = add(plot.group, new THREE.Group())
  const traces = [plot.trace(HEAT, { samples: BINS, radius: 0.07 }), plot.trace(B_FIELD, { samples: BINS, radius: 0.08 })]
  const st = { u: 0, data: [] as number[][], n: 1, bod: 0 }
  return {
    set(vin: number[], rail: number[], bod: number) {
      st.data = [peakBins(vin, BINS, vin[0]), peakBins(rail, BINS, AMS1117_33.vout)]
      st.n = rail.length
      st.u = 0
      if (bod !== st.bod) {
        st.bod = bod
        bodLine.set(y(bod))
        emptyGroup(bodText)
        add(bodText, label(`BOD ${bod.toFixed(2)} V`, { size: 0.34, color: RING, align: 'right' }), [-w / 2 - 0.3, y(bod) - 0.3, 0.2])
      }
    },
    frame(dt: number, playS: number, window: number, scale: number) {
      st.u = (st.u + dt / playS) % 1
      st.data.forEach((d, k) => traces[k].draw((u) => y(d[Math.min(BINS - 1, Math.round(u * (BINS - 1)))]), st.u))
      clock.show(String(Math.round(st.u * window * scale)))
      clock.frame(dt)
      return Math.min(st.n - 1, Math.round(st.u * (st.n - 1)))
    },
  }
}

/** 4×AA → driver + motor, and a branch to the ESP32's VIN (AMS1117 on the board), with optional diode + bulk cap or own buck. */
function bench(parent: THREE.Object3D) {
  const scene = add(parent, new THREE.Group())
  const RAIL_Y = 7.6
  const PACK: V3 = [-15.6, 2.8, 0]
  const ESP: V3 = [-4.6, 0.6, 0]
  const DRV: V3 = [5.2, 2.2, 0]
  const MOT: V3 = [12.2, 3.6, 0]
  const pack = cellPackModel(scene, 4, 1, { r: 0.5, dx: 1.25 })
  pack.group.position.set(...PACK)
  add(scene, label('4× AA NIMH', { size: 0.5, color: LABEL }), [PACK[0], PACK[1] - 3, 0])
  const plus: V3 = [pack.plus[0] + PACK[0], pack.plus[1] + PACK[1], 0]
  lieFlat(add(scene, buildEsp32(), ESP))
  add(scene, label('ESP32', { size: 0.5, color: B_FIELD }), [ESP[0], ESP[1] - 2.4, 0])
  sot223Regulator(scene, [ESP[0] - 5, ESP[1] + 0.2, 0.6], 1.1)
  add(scene, label('AMS1117 ON BOARD', { size: 0.34, color: LABEL }), [ESP[0] - 4.6, ESP[1] + 2.4, 0])
  lieFlat(add(scene, buildL298n(), DRV))
  add(scene, label('L298N', { size: 0.5, color: HEAT, align: 'left' }), [DRV[0] - 0.4, DRV[1] + 3.2, 0])
  const motor = motorCan(scene, MOT, { r: 1.9, legs: 0.6 })
  const pins = motor.pins.map((q): V3 => [q[0], q[1], 0])
  const drvV: V3 = [DRV[0] - 1.2, DRV[1] + 2.2, 0]
  const feed: V3[] = [plus, [plus[0] + 1.4, plus[1], 0], [plus[0] + 1.4, RAIL_Y, 0], [drvV[0], RAIL_Y, 0], drvV]
  cableRun(scene, feed)
  const drvOut: V3 = [DRV[0] + 2, DRV[1] + 0.2, 0]
  const [lowA, lowB] = [pins[0][1] - 1.4, pins[0][1] - 2.2]
  cableRun(scene, [drvOut, [drvOut[0] + 0.8, drvOut[1], 0], [drvOut[0] + 0.8, lowA, 0], [pins[0][0], lowA, 0], pins[0]], '#e0e0e0', 0.12)
  cableRun(scene, [[drvOut[0], drvOut[1] - 0.8, 0], [drvOut[0] + 0.3, drvOut[1] - 0.8, 0], [drvOut[0] + 0.3, lowB, 0], [pins[1][0], lowB, 0], pins[1]], '#e0e0e0', 0.12)

  const BX = ESP[0] - 0.8
  const espV: V3 = [BX, ESP[1] + 1.4, 0]
  const shared = add(scene, new THREE.Group())
  const branch: V3[] = [[BX, RAIL_Y, 0], espV]
  cableRun(shared, branch)
  const holdup = add(shared, new THREE.Group())
  const diode = diodeAlong(holdup, [BX, RAIL_Y - 0.6, 0.3], [BX, RAIL_Y - 3, 0.3], { scale: 1.2 })
  const CX = BX + 4.4
  cableRun(holdup, [[BX, 4.2, 0], [CX, 4.2, 0]])
  standUp(holdup, buildElectrolyticCap(), [CX, 4.2, 0], 0.8, true)
  add(holdup, label('10000 µF', { size: 0.4, color: POWER }), [CX, -0.6, 0])
  add(holdup, label('SCHOTTKY', { size: 0.34, color: LABEL, align: 'right' }), [BX - 1, RAIL_Y - 1.8, 0])

  const own = add(scene, new THREE.Group())
  const buck = dcdcModule(own, [-11.4, -5, 0], 'lm2596', 0.16)
  add(own, label('OWN 5 V RAIL', { size: 0.42, color: B_FIELD }), [-11.4, -7.4, 0])
  const out = buck.pins.outP
  const ownFeed: V3[] = [out, [ESP[0] + 1.6, out[1], 0], [ESP[0] + 1.6, ESP[1] - 1.2, 0]]
  cableRun(own, ownFeed)

  const soft = add(scene, label('SOFT START 0.3 S', { size: 0.38, color: POWER, align: 'left' }), [DRV[0] + 0.6, RAIL_Y - 1.1, 0])
  const motorFlow = plusFlow(scene, lane(feed, 0.5), () => 1)
  const logicFlows = { shared: plusFlow(shared, lane(branch, 0.5), () => 1), own: plusFlow(own, lane(ownFeed, 0.5), () => 1) }
  const { m: glow } = glowBox(scene, [5.4, 3.8, 0.4], [ESP[0], ESP[1], 1], HIGH_V, 0)
  const status = add(scene, new THREE.Group(), [ESP[0], ESP[1], 1.4])
  const st = { fix: '', cap: 0, text: '', flash: 0 }

  return {
    scene,
    setFix(fix: string) {
      st.fix = fix
      shared.visible = fix !== 'own'
      own.visible = fix === 'own'
      soft.visible = fix === 'soft'
    },
    /** Per frame: motor amps, MCU phase, rail volts, BOD, and the last reset kind. */
    frame(dt: number, motorA: number, phase: Phase, rail: number, bod: number, last: ResetKind | undefined, blocking: boolean) {
      diode.set(blocking ? -1 : 0.5)
      st.cap = glide(dt, st.cap, st.fix === 'cap' ? 1 : 0, 8)
      presence(holdup, st.cap)
      motorFlow.step(dt * Math.min(9, 0.3 + 2.5 * motorA))
      ;(st.fix === 'own' ? logicFlows.own : logicFlows.shared).step(dt * (phase === 'reset' ? 0.1 : 0.6))
      motor.spin(dt, 300 * motorA)
      const odd = phase !== 'reset' && rail < ESP32_MIN_V && rail >= bod
      const [text, color] =
        phase === 'reset' ? [last === 'panic' ? 'CRASH' : 'RESET', HIGH_V] : odd ? ['UNDEFINED', RING] : phase === 'boot' ? ['BOOT', B_FIELD] : phase === 'wifi' ? ['WIFI', B_FIELD] : ['', POWER]
      st.flash = glide(dt, st.flash, text ? (phase === 'reset' ? 0.5 : 0.25) : 0, 10)
      glow.color.set(color)
      glow.emissive.set(color)
      glow.opacity = st.flash
      if (text !== st.text) {
        st.text = text
        emptyGroup(status)
        if (text) add(status, label(text, { size: 0.7, color: '#ffffff' }))
      }
    },
  }
}

// --- Current spikes: a motor start pulls stall current through the pack's resistance; the LDO input sags and the 3.3 V rail follows. ---

const W1 = 0.5
const AT1 = 0.1
const PLAY1 = 6
const FIXES1: Record<string, string> = { none: 'No fix', cap: 'Diode + 10 mF', soft: 'Soft start' }

const computeSpikes = (p: Params) => {
  const fix = (p.fix as string) in FIXES1 ? (p.fix as string) : 'none'
  const charge = n(p, 'charge')
  const rig = rigFor(charge, ESP32_BOD[0], fix)
  const r = brownoutRun(rig, W1, 1e-4, TL.motorAt - AT1)
  const minOf = (v: number[]) => Math.min(...v)
  const peakA = Math.max(...r.motor)
  const restIn = r.vin[0]
  return { fix, charge, rig, r, peakA, restIn, minPack: minOf(r.pack), minIn: minOf(r.vin), minRail: minOf(r.rail), first: r.resets[0] }
}

const solveSpikes = memoBy((p: Params) => `${p.fix}|${p.charge}`, computeSpikes)

export const currentSpikes: Lesson = {
  id: 'brownouts-current-spikes',
  title: 'Current spikes',
  tagline: 'A motor start sags the pack; the 3.3 V rail falls out from under the ESP32',
  formula: (p) => {
    const s = solveSpikes(p)
    if (s.fix === 'cap') {
      const floor = ESP32_MIN_V + dropoutVolts(AMS1117_33, TL.runA)
      const ride = rideThroughS(HOLDUP.farads, TL.runA, s.restIn, floor)
      return `Ride-through t = C·ΔV / I = 10 mF × (${volts(s.restIn)} − ${volts(floor)}) / ${amps(TL.runA)} = ${ms(ride)}, while the motor spins up in ~${ms(3 * TAU)}`
    }
    return `Sag = I·R = ${amps(s.peakA + TL.runA)} × ${PACK_OHMS} Ω → LDO in ${volts(s.minIn)} − ${volts(dropoutVolts(AMS1117_33, TL.runA))} dropout = ${volts(s.minRail)} on the 3.3 V rail`
  },
  legend: [
    { color: HEAT, label: 'AMS1117 input (pack, or the cap behind the diode)', shape: 'dot' },
    { color: B_FIELD, label: 'ESP32 3.3 V rail', shape: 'dot' },
    { color: HIGH_V, label: '3.0 V: below it the ESP32 is out of spec', shape: 'dot' },
    { color: RING, label: 'Brownout detector (level 0, 2.43 V): resets', shape: 'dot' },
  ],
  points: [
    'A brownout is a supply that sags without going fully off. The ESP32 is specified down to 3.0 V; below that its flash reads and radio can go wrong in any way: crashes, garbage, corrupted settings.',
    'The trigger is a current spike. Motors starting from rest draw stall current (here 2 A) for the ~50 ms they need to spin up; Wi-Fi TX bursts add a few hundred mA.',
    'Four AA cells, holder springs and thin wire add up to ~0.5 Ω. 2 A × 0.5 Ω = 1 V gone from the pack, and every device on it sees the dip.',
    'The DevKit’s AMS1117 needs about 1 V more at its input than its 3.3 V output. Once the pack sags below ~4.3 V the rail follows it down, volt for volt.',
    'Fixes: a Schottky diode + big cap before the regulator, so the cap feeds only the ESP32 while the pack dips (t = C·ΔV / I); or soft-start the motors so the spike never happens.',
    'The diode costs 0.3 V of headroom and the cap must outlast the whole spin-up. Time is slowed 12×; drag the charge down to see the margin shrink.',
  ],
  controls: [
    { kind: 'choice', key: 'fix', options: Object.entries(FIXES1).map(([value, text]) => ({ value, label: text })), initial: 'none' },
    { kind: 'slider', key: 'charge', label: '4× AA NiMH charge', min: 0, max: 100, initial: 40, step: 5, format: (v) => `${v} % · ${aaVolts(v / 100).toFixed(2)} V` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const b = bench(scene)
    const sc = railScope(scene, [-1, -7.6, 0], 24, 5, 'AMS1117 INPUT AND ESP32 3.3 V RAIL', 'MS')
    const st = { key: '', s: solveSpikes({ fix: 'none', charge: 40 }) }

    return {
      scene,
      view: { center: [-1.6, -0.8, 0], radius: 64, polar: 1.4, azimuth: 0.06 },
      frame(dt, p) {
        const key = `${p.fix}|${p.charge}`
        if (key !== st.key) {
          st.key = key
          st.s = solveSpikes(p)
          sc.set(st.s.r.vin, st.s.r.rail, st.s.rig.bod)
          b.setFix(st.s.fix)
        }
        const { r } = st.s
        const k = sc.frame(dt, PLAY1, W1, 1000)
        const t = k * 1e-4
        const last = r.resets.filter((e) => e.t <= t).pop()
        b.frame(dt, r.motor[k], r.phase[k], r.rail[k], st.s.rig.bod, last?.kind, r.pack[k] - HOLDUP.diodeV < r.vin[k] - 1e-3)
      },
      readouts: () => {
        const s = st.s
        const tone = s.first ? 'bad' : s.minRail < 3.25 ? 'warn' : 'ok'
        return [
          { label: 'Motor start peak', value: amps(s.peakA), tone: s.peakA > 1 ? 'warn' : 'ok' },
          { label: 'AMS1117 input, rest → lowest', value: `${volts(s.restIn)} → ${volts(s.minIn)}`, tone: s.minIn < minInputVolts(AMS1117_33, TL.runA) ? 'warn' : 'ok' },
          { label: '3.3 V rail, lowest', value: volts(s.minRail), tone },
          { label: 'ESP32', value: !s.first ? 'kept running' : s.first.t < AT1 ? 'crashes idle: LDO dropout' : `${s.first.kind === 'panic' ? 'crashed' : 'brownout reset'} ${ms(s.first.t - AT1)} in`, tone },
        ]
      },
    }
  },
}

// --- Diagnosing resets: boot, Wi-Fi, motors on, sag, reset, again. The serial log and the reset reason tell you which. ---

const W2 = 4
const DT2 = 2e-4
const PLAY2 = 12
const LOG_LINES = 8
const FIXES2: Record<string, string> = { none: 'Shared pack', soft: 'Soft start', own: 'Own 5 V rail' }
const REASON: Record<ResetKind, string> = { poweron: 'ESP_RST_POWERON', brownout: 'ESP_RST_BROWNOUT', panic: 'ESP_RST_PANIC' }

/** Serial-monitor lines with their times, from the run's resets and phase changes. */
function serialLog(r: ReturnType<typeof brownoutRun>, dt: number) {
  const lines: [number, string][] = []
  const at = (i: number) => (i * dt).toFixed(2)
  for (let i = 1; i < r.phase.length; i++) {
    if (r.phase[i] === 'run' && r.phase[i - 1] === 'wifi') lines.push([i * dt, `${at(i)}  WiFi connected`])
    if (r.motor[i] > 0 && r.motor[i - 1] === 0) lines.push([i * dt, `${at(i)}  motors on`])
  }
  r.resets.forEach((e) => {
    const i = Math.round(e.t / dt)
    if (e.kind === 'brownout') lines.push([e.t, `${at(i)}  Brownout detector was triggered`])
    if (e.kind === 'panic') lines.push([e.t, `${at(i)}  Guru Meditation Error: Core 1 panic'ed`])
    lines.push([e.t + 1e-6, `${at(i)}  rst:${e.kind === 'poweron' ? '0x1 (POWERON_RESET)' : '0xc (SW_CPU_RESET)'}`])
  })
  return lines.sort((a, b) => a[0] - b[0])
}

const computeLoop = (p: Params) => {
  const fix = (p.fix as string) in FIXES2 ? (p.fix as string) : 'none'
  const charge = n(p, 'charge')
  const level = Math.round(n(p, 'bod'))
  const rig = rigFor(charge, ESP32_BOD[level], fix)
  const r = brownoutRun(rig, W2, DT2)
  const resets = r.resets.filter((e) => e.kind !== 'poweron')
  const restIn = rig.own ? rig.own.volts : rig.ocv - rig.ohms * (TL.runA + AMS1117_33.iq)
  return { fix, charge, level, rig, r, resets, log: serialLog(r, DT2), minRail: Math.min(...r.rail), headroom: restIn - minInputVolts(AMS1117_33, TL.runA) }
}

const solveLoop = memoBy((p: Params) => `${p.fix}|${p.charge}|${p.bod}`, computeLoop)

export const diagnosingResets: Lesson = {
  id: 'brownouts-diagnosing-resets',
  title: 'Diagnosing resets',
  tagline: 'Boots, connects, starts the motors, resets. Read the log, then fix the supply',
  formula: (p) => {
    const s = solveLoop(p)
    const bod = ESP32_BOD[s.level]
    return `BOD level ${s.level} trips at ${bod.toFixed(2)} V; between ${bod.toFixed(2)} and ${ESP32_MIN_V.toFixed(1)} V the ESP32 runs out of spec · LDO headroom at rest = ${volts(s.headroom)}`
  },
  legend: [
    { color: B_FIELD, label: 'ESP32 3.3 V rail', shape: 'dot' },
    { color: HEAT, label: 'AMS1117 input', shape: 'dot' },
    { color: RING, label: 'Brownout detector level', shape: 'dot' },
    { color: HIGH_V, label: 'Brownout or crash in the log', shape: 'dot' },
  ],
  points: [
    'The classic symptom: the robot boots, joins Wi-Fi, starts to drive and resets, over and over. Every motor start sags the pack; every reset stops the motors, so it recovers and tries again.',
    'Open the serial monitor. “Brownout detector was triggered” is the ESP32 telling you its 3.3 V fell below the BOD level. In code, esp_reset_reason() returns ESP_RST_BROWNOUT.',
    'If the rail dips below 3.0 V but not below the BOD level, there is no clean message: the chip misbehaves first. Panics, Wi-Fi drops or garbled output point to power, not code.',
    'So raise the BOD level (menuconfig, levels 0–7: 2.43–2.80 V) to turn silent corruption into a clean, logged reset. Never disable it to “fix” resets: that just hides them.',
    'As the AAs empty, the AMS1117’s 1 V dropout eats the headroom: at 0 % even idle current leaves the rail under 3.0 V.',
    'Then fix the cause: soft-start the motors, or give the logic its own 5 V rail so the motors can’t pull it down. Time is slowed 3×.',
  ],
  controls: [
    { kind: 'choice', key: 'fix', options: Object.entries(FIXES2).map(([value, text]) => ({ value, label: text })), initial: 'none' },
    { kind: 'slider', key: 'charge', label: '4× AA NiMH charge', min: 0, max: 100, initial: 20, step: 5, format: (v) => `${v} % · ${aaVolts(v / 100).toFixed(2)} V` },
    { kind: 'slider', key: 'bod', label: 'Brownout detector level', min: 0, max: 7, initial: 0, step: 1, format: (v) => `${v} · ${ESP32_BOD[Math.round(v)].toFixed(2)} V` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const b = bench(scene)
    b.scene.scale.setScalar(0.66)
    b.scene.position.set(-8.4, 2.6, 0)
    const MON: V3 = [10.8, 3.2, 0]
    const [MW, MH] = [14.6, 9]
    add(scene, mesh(new THREE.BoxGeometry(MW, MH, 0.3), new THREE.MeshStandardMaterial({ color: '#0b0e12', roughness: 0.8 })), [MON[0], MON[1], -0.2])
    add(scene, label('SERIAL MONITOR  115200 BAUD', { size: 0.42, color: GREY, align: 'left' }), [MON[0] - MW / 2, MON[1] + MH / 2 + 0.8, 0])
    const log = add(scene, new THREE.Group(), [MON[0] - MW / 2 + 0.5, MON[1] + MH / 2 - 0.8, 0.1])
    const sc = railScope(scene, [-1, -7.8, 0], 24, 5, 'AMS1117 INPUT AND ESP32 3.3 V RAIL', 'MS')
    const st = { key: '', shown: -1, s: solveLoop({ fix: 'none', charge: 20, bod: 0 }) }

    return {
      scene,
      view: { center: [-0.4, -0.6, 0], radius: 69, polar: 1.4, azimuth: 0.06 },
      frame(dt, p) {
        const key = `${p.fix}|${p.charge}|${p.bod}`
        if (key !== st.key) {
          st.key = key
          st.s = solveLoop(p)
          sc.set(st.s.r.vin, st.s.r.rail, st.s.rig.bod)
          b.setFix(st.s.fix)
          st.shown = -1
        }
        const { r, log: lines } = st.s
        const k = sc.frame(dt, PLAY2, W2, 1000)
        const t = k * DT2
        const last = r.resets.filter((e) => e.t <= t).pop()
        b.frame(dt, r.motor[k], r.phase[k], r.rail[k], st.s.rig.bod, last?.kind, r.pack[k] - HOLDUP.diodeV < r.vin[k] - 1e-3)
        const count = lines.filter(([at]) => at <= t).length
        if (count !== st.shown) {
          st.shown = count
          emptyGroup(log)
          lines.slice(Math.max(0, count - LOG_LINES), count).forEach(([, text], i) => {
            const bad = /Brownout|Guru/.test(text)
            add(log, label(text, { size: 0.36, color: bad ? HIGH_V : text.includes('rst:') ? RING : POWER, align: 'left' }), [0, -i * 1.05, 0])
          })
        }
      },
      readouts: () => {
        const s = st.s
        const lastReset = s.resets[s.resets.length - 1]
        return [
          { label: 'esp_reset_reason()', value: REASON[lastReset?.kind ?? 'poweron'], tone: lastReset ? 'bad' : 'ok' },
          { label: `Resets in ${W2} s`, value: String(s.resets.length), tone: s.resets.length ? 'bad' : 'ok' },
          { label: '3.3 V rail, lowest', value: volts(s.minRail), tone: s.minRail < ESP32_MIN_V ? 'bad' : s.minRail < 3.25 ? 'warn' : 'ok' },
          { label: 'AMS1117 headroom at rest', value: si(s.headroom, 'V', 2), tone: s.headroom < 0 ? 'bad' : s.headroom < 0.3 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
