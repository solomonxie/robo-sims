import * as THREE from 'three/webgpu'
import {
  AMS1117_33,
  CAR_CMDS,
  CAR_PACKS,
  CHASSIS,
  CarCmd,
  CarPack,
  DrvMode,
  WIRE_FAULTS,
  WireFault,
  DRIVE,
  PHONE_CAR,
  audible,
  driverLoss,
  drvMode,
  ledcResolution,
  phoneCarRun,
  phoneJson,
  pwmHigh,
  pwmSquareRun,
  pwmWheelSpeed,
  spinMs,
  startDuty,
  wiredDrive,
  ROBOCAR,
  carPower,
  minInputVolts,
  robocarParts,
} from '../../core/physics'
import { ampText as A, fixedText, hoursText, mpsText, msText, pct, voltText as V } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'

import {
  ARDUINO,
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  IDLE,
  LABEL,
  POWER,
  RING,
  WIDE_VIEW,
  addLabel,
  addRod,
  arcAt,
  cableRun,
  chassisModel,
  codeListing,
  countBars,
  crashWall,
  cursorBar,
  dcdcModule,
  diffBot,
  ease,
  emptyGroup,
  esp32Board,
  floorMat,
  floorTrail,
  floorView,
  glowDot,
  glowMat,
  headerStage,
  i2cBreakout,
  lapseClock,
  liveLabel,
  memoBy,
  moduleBlock,
  packHolder,
  packetPool,
  setGlow,
  sketchTint,
  stickPhone,
  storyClock,
  storySlider,
  stretchRod,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const grams = (g: number) => `${Math.round(g)} g`
const mmFixedM = (m: number) => (Math.abs(m) < 1 ? `${Math.round(m * 1000)} mm` : `${fixedText(m, 2)} m`)

/** Car top view on the left of a span-40 board, metres × k, x forward, tilted toward the viewer. */
const CAR = { at: [-9.4, -3.2, 0] as V3, tilt: -0.3, k: 68 }
function carStage() {
  const { scene, ...head } = headerStage()
  const top = add(scene, new THREE.Group(), CAR.at)
  top.rotation.x = CAR.tilt
  const parts = robocarParts()
  const model = chassisModel(top, parts, CAR.k)
  model.part('imu').visible = false
  top.position.x = CAR.at[0] + ((ROBOCAR.wheelbase - CHASSIS.front) / 2) * CAR.k
  return { scene, head, top, parts, model }
}

// --- Chassis & power: build the Chassis design car part by part, then the power tree from pack to 3.3 V, cruising or at a hard start. ---

const CP_STEPS = ['Plate and motors', 'Caster', 'Battery and switch', 'Buck to 5 V', 'Driver and ESP32', 'Power on']
const CP_SECS = [2.5, 1.5, 2, 2, 2.5, 5]
const CP_PARTS: string[][] = [['plate', 'motorL', 'motorR'], ['caster'], ['pack', 'switch'], ['buck'], ['driver', 'esp32'], []]
const LOADS = { cruise: 'Cruising (Wi-Fi on)', start: 'Hard start (both motors stalled)' }
const PACK_NAMES = namesOf(CAR_PACKS)
const cpRun = memoBy(
  (p: Params) => `${p.pack}`,
  (p: Params) => carPower(pick(CAR_PACKS, p.pack, 'li2') as CarPack),
)
const atStart = (p: Params) => pick(LOADS, p.load, 'cruise') === 'start'
const VERDICT_CP = {
  ok: ['Runs: motors get their volts, the ESP32 keeps 3.3 V even at a hard start', POWER],
  slow: ['Runs, but slowly: too few volts for the motors', HEAT],
  resets: ['Drives, but every hard start sags the pack and resets the ESP32', HIGH_V],
  dips: ['Runs, but the 3.3 V rail dips at every start: no margin left', HEAT],
  noLogic: ['The buck cannot make 5 V from one cell: the ESP32 never runs', HIGH_V],
} as const

const VERDICT_WORD = { ok: 'ok', slow: 'slow', resets: 'resets', dips: 'dips', noLogic: 'no 5 V' }

export const roboCarChassisPower: Lesson = {
  id: 'robo-car-chassis-power',
  title: 'Chassis & power',
  tagline: 'Bolt the parts on the plate, pick a pack, check every rail',
  formula: (p) => {
    const P = cpRun(p)
    const c = P.cruise
    const s = P.stall
    return `pack V = OCV − I·R: cruise ${V(P.ocv)} − ${A(c.packA)} × ${fixedText(P.ohms, 2)} Ω = ${V(c.packV)} · motors ${V(c.motorV)} after the DRV8833 → ${mpsText(c.speed)} · start 2 × ${A(s.motorA)} → ${V(s.packV)} · LM2596 → ${V(s.railV)} → AMS1117 needs ≥ ${V(minInputVolts(AMS1117_33, 0.35))} → ${V(s.mcuV)} · runtime ≈ Wh / ${fixedText(c.watts, 1)} W = ${hoursText(P.hours)} (typical, 80 % charged)`
  },
  legend: [
    { color: POWER, label: 'Rail in spec', shape: 'dot' },
    { color: HEAT, label: 'Rail sagging', shape: 'dot' },
    { color: HIGH_V, label: 'Rail lost: ESP32 off or reset', shape: 'dot' },
    { color: RING, label: 'Part going on now', shape: 'dot' },
  ],
  points: [
    'The first Practice build: a two-wheel car on the plate from Materials › Chassis design (Layout and balance), with the parts sitting where that lesson put them. Plate, two TT gearmotors on the axle, a ball caster 110 mm back, the battery under the plate just behind the axle (weight on the drive wheels), then a DRV8833 motor driver and an ESP32 DevKit on top.',
    'The battery feeds two branches through one switch. The motors take the pack straight through the driver (Actuators › H-bridge › L298N vs modern drivers: a MOSFET driver loses only a few tenths of a volt). The ESP32 gets a clean 5 V from an LM2596 buck (Power › Buck-boost), and its own AMS1117 makes 3.3 V from that, which needs about 4.3 V in.',
    'Pick the pack. 2 × 18650 (2S, 7.4 V nominal) has volts to spare and a low internal resistance, so even a hard start, when both motors draw stall current (Actuators › DC motor › Stall current), barely dips it. Four alkaline AAs sag by more than a volt at that moment, the buck drops out and the ESP32 resets: the classic “resets when the motors start” (Power › Brownouts). One 18650 is below what a buck needs to make 5 V at all.',
    'Runtime is energy over power (Power › Power budget › Runtime estimate): about 3.5 W while cruising, so a 2S pack lasts hours. TT motors are rated 3 to 6 V, so on 2S cap the PWM near 75 % in code (next lessons). Add an inline fuse or a polyfuse at the switch (Components › Fuses & protection).',
  ],
  controls: [
    storySlider(CP_STEPS),
    { kind: 'choice', key: 'pack', options: opts(PACK_NAMES), initial: 'li2' },
    { kind: 'choice', key: 'load', options: opts(LOADS), initial: 'cruise' },
  ],
  build(): Stage {
    const { scene, head, top, parts, model } = carStage()
    const k = CAR.k
    const bp = parts.find((q) => q.key === 'battery')!
    model.part('battery').visible = false
    const packG = add(top, new THREE.Group())
    const setPack = packHolder(packG, [bp.x * k, bp.y * k, bp.z * k], k)
    const swG = add(top, new THREE.Group())
    const swAt: V3 = [-0.02 * k, -0.045 * k, (CHASSIS.plateZ + 0.004) * k]
    box(swG, [0.012 * k, 0.008 * k, 0.006 * k], mat('#1f2126', { rough: 0.6 }), swAt)
    const lever = box(swG, [0.002 * k, 0.002 * k, 0.008 * k], mat('#d6d8dc', { metal: 0.5 }), [swAt[0], swAt[1], swAt[2] + 0.006 * k])
    const buckG = add(top, new THREE.Group())
    dcdcModule(buckG, [-0.085 * k, -0.03 * k, (CHASSIS.plateZ + 0.002) * k], 'lm2596', k / 1000)
    const groups: Record<string, THREE.Object3D> = { pack: packG, switch: swG, buck: buckG }
    const groupOf = (key: string) => groups[key] ?? model.part(key)
    const homeZ = new Map(CP_PARTS.flat().map((key) => [key, groupOf(key).position.z]))
    const tag = liveLabel(top, [0, 0, 0], { size: 0.34, color: RING, align: 'left' })

    const TX = { x: 3.8, y: 0.2, w: 2.5, h: 1.2 }
    const node = (name: string, x: number, y: number) => {
      const set = moduleBlock(scene, [x, y, 0], [TX.w, TX.h, 0.3], name)
      const volts = liveLabel(scene, [x, y - TX.h / 2 - 0.45, 0.3], { size: 0.26 })
      return { set, volts, at: [x, y, 0.1] as V3 }
    }
    const nodes = {
      pack: node('Pack', TX.x, TX.y),
      sw: node('Switch', TX.x + 3.2, TX.y),
      drv: node('DRV8833', TX.x + 6.6, TX.y + 1.7),
      motors: node('Motors', TX.x + 9.8, TX.y + 1.7),
      buck: node('LM2596', TX.x + 6.6, TX.y - 1.7),
      esp: node('ESP32', TX.x + 9.8, TX.y - 1.7),
    }
    const link = (a: V3, b: V3) => {
      const m = glowMat(IDLE, 0.3)
      const mid: V3 = [a[0] + (b[0] - a[0]) * 0.5, a[1], 0]
      const r1 = addRod(scene, m)
      const r2 = addRod(scene, m)
      const r3 = addRod(scene, m)
      stretchRod(r1, [a[0], a[1], 0], mid, 0.07)
      stretchRod(r2, mid, [mid[0], b[1], 0], 0.07)
      stretchRod(r3, [mid[0], b[1], 0], [b[0], b[1], 0], 0.07)
      return m
    }
    const wires = [link(nodes.pack.at, nodes.sw.at), link(nodes.sw.at, nodes.drv.at), link(nodes.drv.at, nodes.motors.at), link(nodes.sw.at, nodes.buck.at), link(nodes.buck.at, nodes.esp.at)]
    addLabel(scene, 'rails (full scale 8.4 V)', [3.4, -4.4, 0.3], GREY, 0.26, 'left')
    const bars = countBars(scene, [6.6, -5.3, 0], ['pack', 'motor', '5 V rail', '3.3 V'], 6, { row: 0.62, size: 0.26 })
    const rows = textRows(scene, 3, 2.6, 4.4, 0.28, 0.66)
    const clock = storyClock(CP_SECS)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const P = cpRun(p)
        const pack = P.pack
        setPack(pack)
        clock.frame(dt, n(p, 'step'))
        const s = clock.step
        CP_PARTS.forEach((keys, i) =>
          keys.forEach((key) => {
            const g = groupOf(key)
            const d = clock.done(i)
            g.visible = d > 0
            g.position.z = homeZ.get(key)! + (1 - ease(d)) * 4
          }),
        )
        const lit = s >= 5
        lever.rotation.y = lit ? 0.5 : -0.5
        tag.set(lit ? '' : `+ ${CP_STEPS[s].toLowerCase()}`)
        tag.group.position.set((-ROBOCAR.wheelbase - 0.025) * k, -0.1 * k, 0.05 * k)

        const start = atStart(p)
        const r = start ? P.stall : P.cruise
        const motorV = start ? P.stall.packV - 0.36 * P.stall.motorA : P.cruise.motorV
        const railTone = (v: number, want: number, lo: number) => (v >= want - 0.05 ? POWER : v >= lo ? HEAT : HIGH_V)
        const mcuC = railTone(r.mcuV, 3.3, 2.43)
        const railC = railTone(r.railV, 5, minInputVolts(AMS1117_33, start ? 0.35 : ROBOCAR.logicA))
        const packC = r.packV < 4.5 ? HIGH_V : r.packV < 6 ? HEAT : POWER
        const motorC = motorV < 4 ? HEAT : POWER
        const on = (i: number) => (s >= i ? 1 : 0)
        nodes.pack.set(dt, packC, on(2) * (lit ? 1 : 0.4))
        nodes.sw.set(dt, lit ? POWER : GREY, on(2) * (lit ? 1 : 0.3))
        nodes.buck.set(dt, s >= 3 ? railC : IDLE, on(3) * (lit ? 1 : 0.3))
        nodes.drv.set(dt, s >= 4 ? motorC : IDLE, on(4) * (lit ? 1 : 0.3))
        nodes.esp.set(dt, s >= 4 ? mcuC : IDLE, on(4) * (lit ? 1 : 0.3))
        nodes.motors.set(dt, motorC, lit ? 1 : 0.3)
        nodes.pack.volts.set(lit ? `${V(r.packV)} · ${A(start ? 2 * P.stall.motorA : P.cruise.packA)}` : V(P.ocv), lit ? packC : GREY)
        nodes.sw.volts.set('')
        nodes.drv.volts.set(lit ? `${V(motorV)} out` : '', motorC)
        nodes.motors.volts.set(lit ? `${A(start ? P.stall.motorA : P.cruise.amps)} each` : '', motorC)
        nodes.buck.volts.set(lit ? `${V(r.railV)} out` : '', railC)
        nodes.esp.volts.set(lit ? V(r.mcuV) : '', mcuC)
        const wc = [packC, motorC, motorC, railC, mcuC]
        wires.forEach((m, i) => setGlow(m, lit ? wc[i] : IDLE, lit ? 0.9 : 0.3))
        const vals = [r.packV, motorV, r.railV, r.mcuV]
        bars.set(lit ? vals : [0, 0, 0, 0], lit ? vals.map(V) : ['', '', '', ''], [packC, motorC, railC, mcuC], 8.4)

        const [vt, vc] = VERDICT_CP[P.verdict]
        rows[0].set(`${CAR_PACKS[pack].name}: ${grams(P.grams)}, ${fixedText(P.ohms * 1000, 0)} mΩ in pack + wires`, LABEL)
        rows[1].set(`Cruise ${mpsText(P.cruise.speed)} · ${fixedText(P.cruise.watts, 1)} W · runs ${hoursText(P.hours)}`, P.cruise.speed < 0.3 ? HEAT : LABEL)
        rows[2].set(`Hard start: pack ${V(P.stall.packV)}${P.stall.resets ? ', ESP32 resets' : `, ESP32 ${V(P.stall.mcuV)}`}`, P.stall.resets ? HIGH_V : GREY)
        head.status.set(`Robo-car · ${CP_STEPS[s]}`)
        head.sub.set(`Step ${s + 1} of ${CP_STEPS.length} · ${start ? 'hard start' : 'cruising'}`, GREY)
        head.event.set(lit ? vt : '', vc)
      },
      readouts: (p) => {
        const P = cpRun(p)
        return [
          { label: 'Cruise speed', value: mpsText(P.cruise.speed), tone: toneOf(P.cruise.speed >= 0.5, P.cruise.speed >= 0.3) },
          { label: 'Runtime', value: hoursText(P.hours), tone: toneOf(P.hours >= 2, P.hours >= 1) },
          { label: 'ESP32 at a start', value: V(P.stall.mcuV), tone: toneOf(P.stall.mcuV >= 3.25, !P.stall.resets) },
          { label: 'Verdict', value: VERDICT_WORD[P.verdict], tone: P.verdict === 'ok' ? 'ok' : P.verdict === 'slow' || P.verdict === 'dips' ? 'warn' : 'bad' },
        ]
      },
    }
  },
}

// --- Wire the motor driver: ESP32 GPIOs → DRV8833 IN pins, pack → VM, shared ground, motor leads; the classic faults. ---

const WD = { esp: [-11.5, -1.2, 0] as V3, espK: 0.6, drv: [0.6, -9.8, 0] as V3, drvK: 0.45, motorX: 9.6, motorY: [-5.6, -10.6], floor: [8.6, 0.2, 0] as V3, floorK: 11, loop: 2.4, simS: 0.6 }
const DRV_PINS = ['AIN1', 'AIN2', 'BIN1', 'BIN2', 'GND', 'VM']
const IN_COLORS = ['#ffd84d', '#ff9a4d', '#5ad8e6', '#c58cff']
const GND_COLOR = '#6b707b'
const VM_COLOR = '#d8322c'
/** DevKit bottom header, antenna left: EN, 36, 39, 34, 35, 32, 33, 25, 26, 27, 14, 12, 13, GND, VIN (i = −7 … 7). */
const ESP_BOTTOM = ['EN', '36', '39', '34', '35', '32', '33', '25', '26', '27', '14', '12', '13', 'GND', 'VIN']
const espIndex = (name: string) => ESP_BOTTOM.indexOf(name) - 7
const CMD_NAMES = namesOf(CAR_CMDS)
const FAULT_NAMES = namesOf(WIRE_FAULTS)
const wdParams = (p: Params) => ({ cmd: pick(CAR_CMDS, p.cmd, 'forward') as CarCmd, fault: pick(WIRE_FAULTS, p.fault, 'ok') as WireFault })
const wdRun = memoBy(
  (p: Params) => `${p.cmd} ${p.fault}`,
  (p: Params) => {
    const q = wdParams(p)
    return { ...q, D: wiredDrive(q.cmd, q.fault) }
  },
)
const bit = (b: boolean) => (b ? '1' : '0')
const MODE_TINT: Record<DrvMode, string> = { forward: POWER, reverse: HEAT, brake: HIGH_V, coast: GREY }
const FAULT_ROW: Record<WireFault, [string, string]> = {
  ok: ['Wired right: the wheels do what the code asks', POWER],
  noGround: ['No shared ground: the driver reads 0 on every IN pin', HIGH_V],
  swapped: ['Right motor leads swapped: that wheel runs backwards', HIGH_V],
  inputOnly: ['GPIO 34 is input-only: BIN1 never goes high', HIGH_V],
}

export const roboCarWireTheMotorDriver: Lesson = {
  id: 'robo-car-wire-the-motor-driver',
  title: 'Wire the motor driver',
  tagline: 'Four GPIOs, a shared ground and the pack on VM',
  formula: (p) => {
    const { cmd, D } = wdRun(p)
    const P = carPower('li2')
    const L = driverLoss('drv8833', P.cruise.amps, P.cruise.packV)
    return `DRV8833 per motor: IN1 IN2 = 10 forward, 01 reverse, 11 brake, 00 coast · ${CAR_CMDS[cmd].name.toLowerCase()}: A ${bit(D.ins[0])}${bit(D.ins[1])}, B ${bit(D.ins[2])}${bit(D.ins[3])} sent, ${bit(D.seen[0])}${bit(D.seen[1])} ${bit(D.seen[2])}${bit(D.seen[3])} seen · v = (vL + vR)/2 = ${mpsText(D.v)}, ω = (vR − vL)/track = ${fixedText(D.w, 1)} rad/s · drop ${fixedText(P.cruise.amps, 2)} A × 0.36 Ω = ${fixedText(L.drop, 2)} V, ${fixedText(L.lossW * 1000, 0)} mW per channel (typical)`
  },
  legend: [
    { color: RING, label: 'IN pin high at the driver', shape: 'dot' },
    { color: VM_COLOR, label: 'Pack + to VM', shape: 'dot' },
    { color: GND_COLOR, label: 'Ground: pack −, driver, ESP32', shape: 'dot' },
    { color: HIGH_V, label: 'Wrong move for the command', shape: 'dot' },
  ],
  points: [
    'The DRV8833 is a dual H-bridge (Actuators › H-bridge › Four switches): two inputs per motor pick the mode. 10 drives forward, 01 reverses, 11 turns on both low switches and brakes, 00 lets the motor coast (Decay modes). No enable pin: speed comes later from PWM on the same IN pins (next lesson).',
    'Wire it: four ESP32 GPIOs to AIN1, AIN2, BIN1, BIN2 (25, 26, 27, 14 here), the pack + through the switch to VM, the pack − to the driver GND, and a wire from the ESP32 GND to that same GND. Motor leads go to the outputs. Keep the motor and pack wires short and twisted, away from the I²C pair (Materials › Chassis design › Cable routing).',
    'Pick the pins with care (Microcontrollers › GPIO): 34 to 39 are input-only and cannot drive anything, 6 to 11 belong to the flash, and 0, 2, 12 and 15 are strapping pins that change how the chip boots if a driver holds them.',
    'Then test one command at a time with the wheels off the floor. A logic high is only 3.3 V relative to the ESP32’s ground: without the shared ground wire the driver sees nothing and the car sits dead. One motor backwards (the car spins when told to go straight) is fixed by swapping its two leads, or by swapping its pins in code.',
  ],
  controls: [
    { kind: 'choice', key: 'cmd', options: opts(CMD_NAMES), initial: 'forward' },
    { kind: 'choice', key: 'fault', options: opts(FAULT_NAMES), initial: 'ok' },
  ],
  build(): Stage {
    const { scene, ...head } = headerStage()
    const espPin = esp32Board(scene, WD.esp, WD.espK)
    const esp = (name: string) => espPin(espIndex(name), false)
    for (const g of ['34', '25', '26', '27', '14', 'GND']) {
      const at = esp(g)
      addLabel(scene, g, [at[0], at[1] + 0.75, at[2] + 0.3], g === '34' ? HEAT : LABEL, 0.2)
    }
    addLabel(scene, 'ESP32 DevKit (5 V from the buck)', [WD.esp[0], WD.esp[1] + 4, 0.3], GREY, 0.28)
    const drv = i2cBreakout(scene, WD.drv, { name: 'DRV8833', color: '#b8322a', k: WD.drvK, pins: DRV_PINS })
    const k = WD.drvK
    const outs = ['AO1', 'AO2', 'BO1', 'BO2'].map((name, i) => {
      const at: V3 = [WD.drv[0] + 10 * k - 0.4, WD.drv[1] + (1.5 - i) * 1.3 * k * 1.6 - 1 * k, 0.4]
      box(scene, [0.5, 0.5, 0.3], mat('#d7b45a', { metal: 0.6, rough: 0.3 }), at)
      addLabel(scene, name, [at[0] - 0.5, at[1], 0.4], LABEL, 0.22, 'right')
      return at
    })
    const pack = add(scene, new THREE.Group(), [-13.4, -9.6, 0])
    box(pack, [4.6, 2, 1.2], mat('#2856c8', { rough: 0.45 }), [0, 0, 0])
    addLabel(pack, '2S 18650 + switch', [0, 0, 0.7], LABEL, 0.26)
    const packP: V3 = [-11.1, -9.1, 0.6]
    const packM: V3 = [-11.1, -10.1, 0.6]

    const motors = WD.motorY.map((y, j) => {
      const g = add(scene, new THREE.Group(), [WD.motorX, y, 0])
      box(g, [3.4, 1.4, 1.2], mat('#f2c12e', { rough: 0.55 }), [0, 0, 0])
      const wheel = add(g, new THREE.Group(), [2.8, 0, 0])
      cylinder(wheel, 1.3, 0.5, mat('#2b2d33', { rough: 0.9 }), [0, 0, 0], 'z', 32)
      box(wheel, [2.2, 0.25, 0.6], mat('#e0e3e8', { rough: 0.4 }), [0, 0, 0.1])
      addLabel(scene, j === 0 ? 'left motor (A)' : 'right motor (B)', [WD.motorX + 1, y + 1.9, 0.3], GREY, 0.24)
      const mode = liveLabel(scene, [WD.motorX + 1, y - 1.9, 0.3], { size: 0.28 })
      return { wheel, mode, leads: [[WD.motorX - 1.7, y + 0.3, 0.4], [WD.motorX - 1.7, y - 0.3, 0.4]] as V3[] }
    })
    const inDots = DRV_PINS.slice(0, 4).map((name) => {
      const d = glowDot(scene, 0.22, RING)
      const at = drv.pin(name)
      d.position.set(at[0], at[1] + 0.5, at[2])
      return d
    })
    const wires = add(scene, new THREE.Group())
    const noGnd = liveLabel(scene, [-3.2, -4.4, 2.6], { size: 0.26, color: HIGH_V })

    const floor = floorView(scene, WD.floor, WD.floorK, -0.5)
    floorMat(floor, [-0.3, 0.45], [-0.3, 0.3])
    const bot = diffBot(floor, { track: CHASSIS.track })
    const rows = textRows(scene, 3, 2.6, 5.2, 0.28, 0.66)
    const st = { key: '', t: 0, spin: [0, 0], built: '' }
    const route = (a: V3, b: V3, lane: number, color: string) => cableRun(wires, [a, [a[0], lane, a[2]], [b[0], lane, b[2]], b], color, 0.09)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { cmd, fault, D } = wdRun(p)
        if (st.built !== fault) {
          st.built = fault
          emptyGroup(wires)
          const srcs = ['25', '26', fault === 'inputOnly' ? '34' : '27', '14']
          srcs.forEach((g, i) => route(esp(g), drv.pin(DRV_PINS[i]), -5 - i * 0.35, IN_COLORS[i]))
          if (fault !== 'noGround') route(esp('GND'), drv.pin('GND'), -6.45, GND_COLOR)
          cableRun(wires, [packP, [-6, -9.1, 0.6], [-6, -7.7, 3.2], [drv.pin('VM')[0] + 0.6, -7.7, 3.2], drv.pin('VM')], VM_COLOR, 0.12)
          cableRun(wires, [packM, [-5, -10.1, 0.6], [-5, -8, 3.6], [drv.pin('GND')[0], -8, 3.6], drv.pin('GND')], GND_COLOR, 0.12)
          motors.forEach((m, j) => {
            const [a, b] = [outs[2 * j], outs[2 * j + 1]]
            const [la, lb] = fault === 'swapped' && j === 1 ? [m.leads[1], m.leads[0]] : m.leads
            cableRun(wires, [a, [a[0] + 1.5, a[1], 0.4], [la[0] - 1.6, la[1], 0.4], la], '#d8322c', 0.07)
            cableRun(wires, [b, [b[0] + 1.1, b[1], 0.4], [lb[0] - 1.2, lb[1], 0.4], lb], '#2a2c32', 0.07)
          })
        }
        noGnd.set(fault === 'noGround' ? 'no ESP32 GND wire' : '')
        D.seen.forEach((h, i) => setGlow(inDots[i].material as THREE.MeshStandardMaterial, h ? RING : IDLE, h ? 1.4 : 0.2))
        const key = `${cmd} ${fault}`
        if (st.key !== key) Object.assign(st, { key, t: 0 })
        st.t += dt
        if (st.t > WD.loop + 0.6) st.t = 0
        const t = (Math.min(st.t, WD.loop) / WD.loop) * WD.simS
        const pose = { x: -0.1 + D.v * t * (Math.abs(D.w) < 1e-6 ? 1 : 0), y: 0, th: 0 }
        if (Math.abs(D.w) > 1e-6) {
          const th = D.w * t
          const R = D.v / D.w
          Object.assign(pose, { x: -0.1 + R * Math.sin(th), y: R * (1 - Math.cos(th)), th })
        }
        const speed = carPower('li2').cruise.speed
        const run = st.t <= WD.loop
        bot.set(pose, D.dirs[0] * speed * t, D.dirs[1] * speed * t)
        motors.forEach((m, j) => {
          st.spin[j] -= (run ? D.dirs[j] : 0) * dt * 5
          m.wheel.rotation.z = st.spin[j]
          const mode = D.modes[j]
          const want = drvMode(D.ins[2 * j], D.ins[2 * j + 1])
          const backwards = fault === 'swapped' && j === 1 && D.dirs[j] !== 0
          m.mode.set(backwards ? `${mode}, but turns backwards` : mode === want ? mode : `${mode} (asked ${want})`, backwards || mode !== want ? HIGH_V : MODE_TINT[mode])
        })
        const motion = Math.abs(D.w) > 0.5 && Math.abs(D.v) < 0.05 ? 'spins on the spot' : Math.abs(D.w) > 0.5 ? 'curves' : D.v > 0.05 ? 'drives forward' : D.v < -0.05 ? 'backs up' : 'sits still'
        rows[0].set(`A: AIN1 ${bit(D.seen[0])} AIN2 ${bit(D.seen[1])} → ${D.modes[0]}`, MODE_TINT[D.modes[0]])
        rows[1].set(`B: BIN1 ${bit(D.seen[2])} BIN2 ${bit(D.seen[3])} → ${D.modes[1]}`, MODE_TINT[D.modes[1]])
        rows[2].set(...FAULT_ROW[fault])
        head.status.set(`Robo-car · ${CAR_CMDS[cmd].name}`)
        head.sub.set(`GPIO 25 26 → A, ${fault === 'inputOnly' ? '34' : '27'} 14 → B · ${WIRE_FAULTS[fault].name.toLowerCase()} · floor ${Math.round(WD.loop / WD.simS)}× slower`, GREY)
        head.event.set(`The car ${motion}${D.ok ? '' : ': not what the code asked'}`, D.ok ? POWER : HIGH_V)
      },
      readouts: (p) => {
        const { D } = wdRun(p)
        return [
          { label: 'Left (A)', value: D.modes[0], tone: D.dirs[0] === Math.sign(Number(D.ins[0]) - Number(D.ins[1])) ? 'ok' : 'bad' },
          { label: 'Right (B)', value: D.modes[1], tone: D.ok ? 'ok' : 'bad' },
          { label: 'Car speed', value: mpsText(Math.abs(D.v)), tone: D.ok ? 'ok' : 'bad' },
          { label: 'Turn rate', value: `${fixedText(D.w, 1)} rad/s`, tone: D.ok ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- Drive with ESP32: LEDC PWM on the IN pins, a timed square, a weaker right motor and a trim in code. ---

const DE = { floor: [-12.6, -9.4, 0] as V3, floorK: 6.2, rest: 1.5, plot: { x: 8.6, y: -8.6, w: 12.4, h: 4.6 }, periods: 3 }
const PWM_HZ = { k1: '1 kHz PWM', k20: '20 kHz PWM' }
const PWM_HZ_VAL = { k1: 1000, k20: 20000 }
const deParams = (p: Params) => ({ duty: n(p, 'duty') / 100, trim: n(p, 'trim') / 100, hz: PWM_HZ_VAL[pick(PWM_HZ, p.hz, 'k20') as keyof typeof PWM_HZ_VAL] })
const deRun = memoBy(
  (p: Params) => `${p.duty} ${p.trim}`,
  (p: Params) => {
    const q = deParams(p)
    return pwmSquareRun(q.duty, q.trim)
  },
)
const deCode = (duty: number, trim: number, hz: number, spin: number) => [
  'const int AIN1 = 25, AIN2 = 26, BIN1 = 27, BIN2 = 14;',
  `const float TRIM = ${fixedText(1 + trim, 2)};  // right motor is weaker`,
  'void drive(float l, float r) {  // −1 … 1 → duty on one IN pin',
  '  ledcWrite(l > 0 ? AIN1 : AIN2, fabs(l) * 255); ledcWrite(l > 0 ? AIN2 : AIN1, 0);',
  '  ledcWrite(r > 0 ? BIN1 : BIN2, fabs(r) * 255); ledcWrite(r > 0 ? BIN2 : BIN1, 0); }',
  `void setup() { for (int p : {AIN1, AIN2, BIN1, BIN2}) ledcAttach(p, ${hz}, 8); }`,
  'void loop() {',
  `  drive(${fixedText(duty, 2)}, ${fixedText(duty, 2)} * TRIM); delay(${DRIVE.fwdS * 1000});  // straight`,
  `  drive(-${fixedText(duty, 2)}, ${fixedText(duty, 2)} * TRIM); delay(${spin});  // spin left 90°?`,
  '}',
]

export const roboCarDriveWithEsp32: Lesson = {
  id: 'robo-car-drive-with-esp32',
  title: 'Drive with ESP32',
  tagline: 'PWM on the IN pins, a timed square and a trim',
  formula: (p) => {
    const q = deParams(p)
    const R = deRun(p)
    return `wheel ≈ speed at duty × ${V(carPower('li2').cruise.packV)}: L ${mpsText(R.vL)}, R ${fixedText(q.duty * (1 + q.trim) * 100, 0)} % × (1 − ${DRIVE.weak}) → ${mpsText(R.vR)} · drift over ${mmFixedM(R.side)} = ${mmFixedM(Math.abs(R.driftM))} · spin ${spinMs()} ms → ${fixedText(R.turnDeg, 0)}° · starts moving at ${fixedText(startDuty() * 100, 0)} % · LEDC at ${PWM_HZ_VAL.k20 === q.hz ? '20 kHz' : '1 kHz'}: up to ${ledcResolution(q.hz)} bits, ${audible(q.hz) ? 'audible whine' : 'silent'} (typical)`
  },
  legend: [
    { color: ARDUINO, label: 'The sketch (Arduino), current line lit', shape: 'dot' },
    { color: HEAT, label: 'Left wheel PWM (AIN1)', shape: 'dot' },
    { color: B_FIELD, label: 'Right wheel PWM (BIN1)', shape: 'dot' },
    { color: GREY, label: 'Path driven; the ideal square in yellow', shape: 'dot' },
  ],
  points: [
    'Speed comes from PWM on the IN pin that is high (Microcontrollers › PWM › Duty cycle): the ESP32’s LEDC drives the pin at 20 kHz and the motor averages it, so 70 % duty on a 7.8 V pack is like 5.5 V (Average voltage). 20 kHz is above hearing; at 1 kHz the motor sings (Frequency choice). Below about 13 % the motor hums but cannot overcome friction.',
    'drive(l, r) is the only function the rest of the code ever calls: sign picks the pin, size sets the duty. This is the driver layer from Software › Firmware structure; the remote and later autonomy just call drive().',
    'Run a test square: straight for 1.5 s, spin left for a fixed time, four times. No two TT motors are the same; this right one is 6 % slower, so the car curves right and the turns come up short. A trim factor on the right wheel fixes it at this speed. Raise the trim until the first leg runs straight.',
    'Now change the speed: the timed spin no longer makes 90°, and the battery sagging would change it too. Timing is open loop (Control › Open vs closed loop). Encoders (Sensors › Encoder) and a speed PID (Control › Velocity control) make it repeatable; for now, the car drives. Next: a phone remote.',
  ],
  controls: [
    { kind: 'slider', key: 'duty', label: 'Speed (duty)', min: 10, max: 100, step: 5, initial: 70, format: (v) => `${v} %` },
    { kind: 'slider', key: 'trim', label: 'Right trim', min: 0, max: 12, step: 1, initial: 0, format: (v) => `+${v} %` },
    { kind: 'choice', key: 'hz', options: opts(PWM_HZ), initial: 'k20' },
  ],
  build(): Stage {
    const { scene, ...head } = headerStage()
    const code = codeListing(scene, [-16.8, 3.9, 0.3], 10, 17, 0.2, 0.44, '#ffd56b')
    const floor = floorView(scene, DE.floor, DE.floorK, -0.55)
    floorMat(floor, [-0.3, 1.5], [-0.3, 1.4])
    const bot = diffBot(floor, { track: CHASSIS.track })
    const trail = floorTrail(floor, 600, 0.012)
    const ideal = [0, 1, 2, 3].map(() => addRod(floor, glowMat(RING, 0.7)))
    const P = DE.plot
    const plot = titledScope(scene, P.y, P.h, `PWM, ${DE.periods} periods`, LABEL, 0, P.x, P.w)
    const trA = plot.s.trace(HEAT, { samples: 240, radius: 0.06 })
    const trB = plot.s.trace(B_FIELD, { samples: 240, radius: 0.06 })
    const rows = textRows(scene, 4, 2.6, 4.4, 0.28, 0.66)
    const bars = countBars(scene, [6.4, -1.8, 0], ['left wheel', 'right wheel'], 6, { row: 0.62, size: 0.26 })
    addLabel(scene, 'wheel speed on the floor', [2.6, -0.9, 0.3], GREY, 0.26, 'left')
    const clock = lapseClock(1, 1, 0)
    const st = { key: '', prev: { x: 0, y: 0, th: 0 } }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const q = deParams(p)
        const R = deRun(p)
        const key = `${p.duty} ${p.trim}`
        const tNow = clock(dt / (R.seconds + DE.rest), key) * (R.seconds + DE.rest)
        if (st.key !== key || tNow < 1e-6) {
          st.key = key
          trail.clear()
          st.prev = { x: 0, y: 0, th: 0 }
        }
        const t = Math.min(tNow, R.seconds)
        const f = R.frames[Math.min(R.frames.length - 1, Math.round(t / DRIVE.dt))]
        bot.set(f, f.dL, f.dR)
        trail.add(st.prev, f)
        st.prev = f
        const s = R.side
        const c: V3[] = [[0, 0, 0.004], [s, 0, 0.004], [s, s, 0.004], [0, s, 0.004]]
        ideal.forEach((r, i) => stretchRod(r, c[i], c[(i + 1) % 4], 0.006))
        const line = tNow >= R.seconds ? 9 : f.spinning ? 8 : 7
        code.set(deCode(q.duty, q.trim, q.hz, spinMs()), line, sketchTint)

        const dL = Math.abs(f.l)
        const dR = Math.abs(f.r)
        const us = Array.from({ length: 240 }, (_, i) => i / 239)
        const lane = P.h / 4
        trA.points(us, us.map((u) => (pwmHigh(u * DE.periods, 1, dL) ? lane * 1.6 : lane * 0.4)), null)
        trB.points(us, us.map((u) => (pwmHigh(u * DE.periods, 1, dR) ? -lane * 0.4 : -lane * 1.6)), null)
        plot.lo.set(`AIN${f.l < 0 ? '2' : '1'} ${pct(dL)} · BIN1 ${pct(dR)}`)
        plot.hi.set(`${DE.periods} × ${q.hz === 20000 ? '50 µs' : '1 ms'}`)
        plot.right.set(q.hz === 20000 ? '20 kHz: silent' : '1 kHz: whines', audible(q.hz) ? HEAT : POWER)
        const vmax = pwmWheelSpeed(1)
        const moving = tNow < R.seconds
        bars.set([moving ? R.vL : 0, moving ? R.vR : 0], [mpsText(moving ? R.vL : 0), mpsText(moving ? R.vR : 0)], [HEAT, B_FIELD], vmax)

        const drift = Math.abs(R.driftM)
        rows[0].set(`Leg 1: ${mmFixedM(R.side)} long, drifts ${mmFixedM(drift)} ${R.driftM < 0 ? 'right' : 'left'}`, drift < 0.03 ? POWER : drift < 0.08 ? HEAT : HIGH_V)
        rows[1].set(`Spin ${spinMs()} ms → ${fixedText(R.turnDeg, 0)}° (want 90°)`, Math.abs(R.turnDeg - 90) < 5 ? POWER : Math.abs(R.turnDeg - 90) < 15 ? HEAT : HIGH_V)
        rows[2].set(`Ends ${mmFixedM(R.missM)} from the start after 4 legs`, R.missM < 0.1 ? POWER : R.missM < 0.3 ? HEAT : HIGH_V)
        rows[3].set(q.duty < startDuty() + 0.02 ? 'Barely above the start duty: it hums and crawls' : `Below ${pct(startDuty())} duty the motors only hum`, q.duty < startDuty() + 0.02 ? HEAT : GREY)
        head.status.set(`Robo-car · drive(${fixedText(q.duty, 2)}, ${fixedText(q.duty * (1 + q.trim), 2)})`)
        head.sub.set(`${fixedText(t, 1)} s of ${fixedText(R.seconds, 1)} s · 1× · leg ${f.leg + 1} of 4`, GREY)
        head.event.set(drift < 0.03 && Math.abs(R.turnDeg - 90) < 5 ? 'Square: trimmed for this speed' : drift < 0.03 ? 'Straight, but the timed turn is off at this speed' : 'Curves right: the right motor is weaker', drift < 0.03 && Math.abs(R.turnDeg - 90) < 5 ? POWER : HEAT)
      },
      readouts: (p) => {
        const R = deRun(p)
        const drift = Math.abs(R.driftM)
        return [
          { label: 'Speed', value: mpsText((R.vL + R.vR) / 2), tone: R.vL > 0 ? 'ok' : 'bad' },
          { label: 'Drift on leg 1', value: mmFixedM(drift), tone: toneOf(drift < 0.03, drift < 0.08) },
          { label: 'Turn', value: `${fixedText(R.turnDeg, 0)}°`, tone: toneOf(Math.abs(R.turnDeg - 90) < 5, Math.abs(R.turnDeg - 90) < 15) },
          { label: 'Miss after 4 legs', value: mmFixedM(R.missM), tone: toneOf(R.missM < 0.1, R.missM < 0.3) },
        ]
      },
    }
  },
}

// --- Phone remote: the ESP32 serves a joystick page on its own Wi-Fi; JSON over a WebSocket → arcade mix → drive(); the phone locks. ---

const PR = { phone: [-15.6, 0.4, 0] as V3, phoneK: 2, floor: [-12.2, -6.4, 0] as V3, floorK: 7.2, plot: { x: 8.6, y: -8.6, w: 12.4, h: 4.6 }, rest: 1.5, fly: 0.25 }
const FAILSAFE = { none: 'No failsafe', t300: 'Stop after 300 ms quiet', t1000: 'Stop after 1 s quiet' }
const FAILSAFE_S = { none: 0, t300: 0.3, t1000: 1 }
const prParams = (p: Params) => ({ fs: pick(FAILSAFE, p.fs, 'none') as keyof typeof FAILSAFE, cap: n(p, 'cap') / 100 })
const prRun = memoBy(
  (p: Params) => `${p.fs} ${p.cap}`,
  (p: Params) => {
    const q = prParams(p)
    return { ...q, R: phoneCarRun(FAILSAFE_S[q.fs], q.cap) }
  },
)
const prCode = (to: number, cap: number) => [
  'void onWs(uint8_t* msg) {  // {"x":…,"y":…} from the page',
  `  auto [l, r] = arcade(deadzone(x), deadzone(y)); drive(l * ${fixedText(cap, 1)}, r * ${fixedText(cap, 1)});`,
  '  last = millis(); }',
  to ? `if (millis() - last > ${Math.round(to * 1000)}) drive(0, 0);  // failsafe` : '// no failsafe: the last command keeps running',
]

export const roboCarPhoneRemote: Lesson = {
  id: 'robo-car-phone-remote',
  title: 'Phone remote',
  tagline: 'A joystick page on the car’s own Wi-Fi, and a failsafe',
  formula: (p) => {
    const { cap, fs, R } = prRun(p)
    const to = FAILSAFE_S[fs]
    return `L = y + x, R = y − x (deadzone ${PHONE_CAR.dz}) × ${pct(cap)} · ${PHONE_CAR.hz} Hz × ${phoneJson(0, 0.6).length} B JSON over a WebSocket, ~${msText(PHONE_CAR.oneWayS)} one way · phone locks at ${PHONE_CAR.lockAt} s: ${to ? `stops after ${msText(to)} + braking, ${mmFixedM(R.blindM)} blind` : `nothing stops it: ${R.crashed ? 'into the wall' : `${mmFixedM(R.blindM)} and counting`}`} · v max ${mpsText(R.vMax)} × ${pct(cap)}`
  },
  legend: [
    { color: RING, label: 'Thumbstick on the phone page', shape: 'dot' },
    { color: POWER, label: 'WebSocket message {x, y}', shape: 'dot' },
    { color: HEAT, label: 'Left wheel command', shape: 'dot' },
    { color: B_FIELD, label: 'Right wheel command', shape: 'dot' },
    { color: HIGH_V, label: 'Phone silent: driving blind', shape: 'dot' },
  ],
  points: [
    'No app needed: the ESP32 starts its own Wi-Fi network (Microcontrollers › Wi-Fi & Bluetooth › Station and AP), the phone joins it and opens 192.168.4.1, and the ESP32 serves a small page with a joystick. The page opens a WebSocket (HTTP and WebSocket) and sends {"x":…,"y":…} twenty times a second.',
    'On the car, each message goes through the deadzone and arcade mix from Software › Remote control › Joystick over BLE (left = y + x, right = y − x), is scaled by a speed limit, and calls the same drive() as the last lesson. A 50 % limit indoors keeps it controllable on a 13 cm track.',
    'Then test what happens when the phone goes quiet: here the screen locks with the thumb still pushing forward. The browser stops sending, but the car keeps its last command and drives on until it hits something. A failsafe (Software › Safety & failsafes) remembers when the last message arrived and stops the wheels if none came for 300 ms. Waiting 1 s drives four times further blind.',
    'Every fast-moving robot needs that timer, plus a physical switch you can reach (E-stop). With power, wiring, drive() and a remote, the Robo-car is done; the next projects add sensors to it: Obstacle-avoiding car, Line-following car.',
  ],
  controls: [
    { kind: 'choice', key: 'fs', options: opts(FAILSAFE), initial: 'none' },
    { kind: 'slider', key: 'cap', label: 'Speed limit', min: 30, max: 80, step: 10, initial: 50, format: (v) => `${v} %` },
  ],
  build(): Stage {
    const { scene, ...head } = headerStage()
    const phone = stickPhone(scene, PR.phone, PR.phoneK)
    const floor = floorView(scene, PR.floor, PR.floorK, -0.55)
    floorMat(floor, [-0.3, 1.75], [-0.45, 0.45])
    const wall = crashWall(floor, PHONE_CAR.wallX, 0.07)
    const bot = diffBot(floor, { track: CHASSIS.track })
    const trail = floorTrail(floor, 500, 0.012)
    const blindTrail = floorTrail(floor, 300, 0.012, HIGH_V)
    const packets = packetPool(scene, 8, 0.4)
    const code = codeListing(scene, [2.6, 4.6, 0.3], 4, 13, 0.22, 0.5)
    addLabel(scene, 'browser at 192.168.4.1', [PR.phone[0], PR.phone[1] - 3.9, 0.3], GREY, 0.26)
    const rows = textRows(scene, 3, 2.6, 2, 0.28, 0.66)
    const P = PR.plot
    const plot = titledScope(scene, P.y, P.h, 'wheel commands', LABEL, 0.5, P.x, P.w)
    const trL = plot.s.trace(HEAT, { samples: 400, radius: 0.06 })
    const trR = plot.s.trace(B_FIELD, { samples: 400, radius: 0.06 })
    const cur = cursorBar(plot.s, LABEL)
    const lockBar = addRod(plot.s.group, glowMat(HIGH_V, 0.8))
    const lu = PHONE_CAR.lockAt / PHONE_CAR.seconds
    stretchRod(lockBar, [plot.s.xAt(lu), -P.h / 2, 0.3], [plot.s.xAt(lu), P.h / 2, 0.3], 0.05)
    addLabel(plot.s.group, 'phone locks', [plot.s.xAt(lu) + 0.2, P.h / 2 - 0.4, 0.4], HIGH_V, 0.22, 'left')
    plot.lo.set('0 s')
    plot.hi.set(`${PHONE_CAR.seconds} s`)
    const clock = lapseClock(PHONE_CAR.seconds, 1, PR.rest)
    const st = { key: '', prev: { x: 0, y: 0, th: 0 } }
    const v = new THREE.Vector3()
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { fs, cap, R } = prRun(p)
        const key = `${fs} ${cap}`
        const fresh = st.key !== key
        const t = clock(dt, key)
        const i = Math.min(R.frames.length - 1, Math.round(t / PHONE_CAR.dt))
        const f = R.frames[i]
        if (fresh || t < 1e-6) {
          st.key = key
          trail.clear()
          blindTrail.clear()
          st.prev = R.frames[0]
          const us: number[] = []
          const ls: number[] = []
          const rs: number[] = []
          for (let j = 0; j < R.frames.length; j += 2) {
            us.push(R.frames[j].t / PHONE_CAR.seconds)
            ls.push((R.frames[j].wl * P.h) / 2)
            rs.push((R.frames[j].wr * P.h) / 2)
          }
          trL.points(us, ls)
          trR.points(us, rs)
        }
        cur(f.t / PHONE_CAR.seconds)
        bot.set(f, 0, 0)
        ;(f.sending ? trail : blindTrail).add(st.prev, f)
        st.prev = f
        wall(f.crashed)

        const locked = !f.sending
        phone.screen(locked ? '#000000' : '#10161c', locked ? 0 : 0.4)
        phone.stick(f.sx, f.sy)
        phone.lines[0].set('')
        phone.lines[1].set(locked ? 'locked' : 'Drive', locked ? HIGH_V : LABEL)
        bot.group.getWorldPosition(v)
        const to: V3 = [v.x, v.y + 0.6, v.z + 0.6]
        packets.begin()
        let tagged = false
        for (let j = R.sent.length - 1; j >= 0 && R.sent[j].t > f.t - PR.fly; j--) {
          const m = R.sent[j]
          if (m.t > f.t) continue
          const u = (f.t - m.t) / PR.fly
          const tag = !tagged && u > 0.3
          if (tag) tagged = true
          packets.put(arcAt(phone.top, to, u, 1.2), POWER, { w: 0.9, payload: 0.6, text: tag ? phoneJson(m.x, m.y) : '' })
        }
        packets.end()

        const sec = FAILSAFE_S[fs]
        code.set(prCode(sec, cap), f.failsafe ? 3 : locked ? -1 : 1, (l) => (l.trim().startsWith('//') ? (sec ? GREY : HIGH_V) : ARDUINO))
        rows[0].set(`stick x ${fixedText(f.sx, 2)} y ${fixedText(f.sy, 2)} → L ${pct(f.wl)} R ${pct(f.wr)}`, locked ? GREY : RING)
        rows[1].set(locked ? `Last message ${msText(f.age)} ago${f.failsafe ? ': failsafe stopped the wheels' : ''}` : `Messages every ${msText(1 / PHONE_CAR.hz)}, last ${msText(f.age)} ago`, locked ? (f.failsafe ? POWER : HIGH_V) : LABEL)
        rows[2].set(R.crashed ? `This run: hits the wall ${mmFixedM(R.blindM)} after the lock` : `This run: stops ${mmFixedM(R.gapM)} short of the wall, ${mmFixedM(R.blindM)} blind`, R.crashed ? HIGH_V : R.blindM < 0.1 ? POWER : HEAT)
        head.status.set(`Robo-car · ${fs === 'none' ? 'no failsafe' : `failsafe ${msText(FAILSAFE_S[fs])}`}`)
        head.sub.set(`${fixedText(f.t, 1)} s of ${PHONE_CAR.seconds} s · 1× · speed limit ${pct(cap)}`, GREY)
        head.event.set(f.crashed ? 'Crashed: nobody told it to stop' : f.failsafe ? 'Phone silent: failsafe stopped the car' : locked ? 'Phone locked: no more messages, wheels still turning' : 'Driving from the phone', f.crashed || (locked && !f.failsafe) ? HIGH_V : f.failsafe ? POWER : LABEL)
      },
      readouts: (p) => {
        const { R } = prRun(p)
        return [
          { label: 'Blind', value: mmFixedM(R.blindM), tone: toneOf(R.blindM < 0.1, R.blindM < 0.3 && !R.crashed) },
          { label: 'Gap to wall', value: R.crashed ? 'hit' : mmFixedM(R.gapM), tone: R.crashed ? 'bad' : 'ok' },
          { label: 'Stop delay', value: R.crashed ? 'crash' : Number.isFinite(R.stoppedAt) ? `${fixedText(R.stoppedAt - PHONE_CAR.lockAt, 2)} s` : 'never', tone: Number.isFinite(R.stoppedAt) ? (R.stoppedAt - PHONE_CAR.lockAt < 0.5 ? 'ok' : 'warn') : 'bad' },
          { label: 'Top speed', value: mpsText(R.vMax * prParams(p).cap), tone: 'ok' },
        ]
      },
    }
  },
}
