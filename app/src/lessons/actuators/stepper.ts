import * as THREE from 'three/webgpu'
import {
  DEG,
  MOVE_FRAME_S,
  NEMA17,
  SGTHRS,
  STEP_CHIPS,
  STEP_FRAME_S,
  StepChip,
  chopCurrent,
  fixedStepAt,
  lostSteps,
  missedStepRun,
  phaseCurrents,
  pullOutNm,
  peakOvershoot,
  rpmToRadS,
  sineErrorPct,
  slipAt,
  stallDiag,
  stallGuardResult,
  stepDeg,
  stepperRun,
  stepsPerRev,
  torquePerMicrostep,
  vrefAmps,
} from '../../core/physics'
import { msText } from '../../core/units'
import { V3, add, box, mat, mesh, rod } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  PIN_COLOR,
  POWER,
  RING,
  addLabel,
  codeBlock,
  cursorBar,
  esp32Board,
  glowMat,
  heatWaves,
  lit,
  litWire,
  liveLabel,
  memoBy,
  nema17,
  scope,
  simClock,
  stepDriver,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const nm = (v: number) => `${v.toFixed(2)} N·m`
const PHASE_A = HEAT
const PHASE_B = B_FIELD

/** Needle on the rotor front, `len` long, pointing up at angle 0. */
function needle(parent: THREE.Object3D, z: number, len: number, color: string, opacity = 1) {
  const g = add(parent, new THREE.Group(), [0, 0, z])
  const m = glowMat(color, 0.9)
  m.transparent = opacity < 1
  m.opacity = opacity
  box(g, [0.16, len, 0.12], m, [0, len / 2, 0]).castShadow = false
  return g
}

// --- Full, half and micro-steps: the driver's sine table sets phase currents; the rotor snaps to each new field angle. ---

const MODES = { full: 'Full step', half: 'Half step', q4: '1/4 step', s16: '1/16 microstep' }
const MICRO = { full: 1, half: 2, q4: 4, s16: 16 }
const MS_PINS = { full: 'L L L', half: 'H L L', q4: 'L H L', s16: 'H H H' }
const SP = { at: [-10.5, 0.6, 0] as V3, r: 2.6, loopS: 3, maxSteps: 5.5 }
const stepParams = (p: Params) => {
  const mode = pick(MODES, p.mode, 'full')
  const rate = n(p, 'rate')
  const micro = MICRO[mode]
  const window = 4 / rate
  return { mode, micro, rate, window, slow: Math.max(1, Math.round(SP.loopS / window)) }
}
type StepQ = ReturnType<typeof stepParams>
const stepKey = (q: StepQ) => `${q.mode}|${q.rate}`
const stepMemo = memoBy(stepKey, (q: StepQ) => stepperRun(q.micro, q.rate, q.window))

export const fullHalfAndMicroSteps: Lesson = {
  id: 'stepper-full-half-and-micro-steps',
  title: 'Full, half and micro-steps',
  tagline: '200 steps a turn, then split them',
  formula: (p) => {
    const q = stepParams(p)
    return `step = 1.8° / ${q.micro} = ${stepDeg(q.micro).toFixed(4).replace(/0+$/, '')}° (${stepsPerRev(q.micro)}/rev) · I_A = I·cos(45° + k·${90 / q.micro}°), I_B = I·sin(…) · torque per step = ${NEMA17.holdNm}·sin(${90 / q.micro}°) = ${nm(torquePerMicrostep(q.micro))}`
  },
  legend: [
    { color: PHASE_A, label: 'Phase A current', shape: 'dot' },
    { color: PHASE_B, label: 'Phase B current', shape: 'dot' },
    { color: RING, label: 'Field angle (commanded)', shape: 'dot' },
    { color: POWER, label: 'Rotor angle', shape: 'dot' },
  ],
  points: [
    'A stepper has two coils (phases A and B) wound on 8 stator poles, and a rotor with 50 teeth, magnetised along its axis. Each pole face has teeth too; the rotor turns to line its teeth up with the poles that are on.',
    'Swap which phase is on and in which direction, four times, and the rotor moves one tooth: 7.2°. So each switch is 1.8°, and 200 full steps make a turn. Count pulses and you know the angle, no sensor needed.',
    'Full step drives both phases at once (70.7 % each); half step puts a one-phase step in between, 400 a turn. Each step is a jump: the rotor overshoots the new detent and rings, which is the clatter and vibration you hear.',
    'Microstepping sets the two currents to a sine and cosine in finer steps (1/16 on an A4988: 3200 a turn). The field turns almost smoothly and the rotor glides; ringing and the resonance near 40 steps/s mostly go away.',
    'Microsteps add smoothness, not accuracy: the torque that pulls the rotor one microstep over is T·sin(90°/n), only 0.04 N·m at 1/16. Any load or friction bigger than that and the rotor lags several microsteps.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'full' },
    { kind: 'slider', key: 'rate', label: 'Speed', min: 10, max: 80, step: 5, initial: 25, format: (v) => `${v} full steps/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const motor = nema17(scene, SP.at, SP.r)
    const front = SP.r * 0.05
    const field = needle(scene, 0, 7, RING, 0.45)
    field.position.set(SP.at[0], SP.at[1], SP.at[2] + front + 0.3)
    needle(motor.rotor, front + 0.15, 6.4, POWER)
    addLabel(scene, 'NEMA17, front cap off', [SP.at[0], SP.at[1] - 7.6, 0.4], GREY, 0.4)
    const poleTag = liveLabel(scene, [SP.at[0], SP.at[1] + 6.4, 0.6], { size: 0.42 })

    const cur = scope(scene, 12, 4, { divs: [8, 4] })
    cur.group.position.set(7, 3.4, 0)
    const N = 400
    const ta = cur.trace(PHASE_A, { samples: N, radius: 0.06 })
    const tb = cur.trace(PHASE_B, { samples: N, radius: 0.06 })
    const cursorA = cursorBar(cur, LABEL)
    addLabel(scene, 'coil currents, ±I', [7, 6.5, 0.3], GREY, 0.36)

    const pos = scope(scene, 12, 4, { divs: [8, 4], zeroAt: 0 })
    pos.group.position.set(7, -2.6, 0)
    const yS = (s: number) => (s / SP.maxSteps - 0.5) * pos.height
    const tc = pos.trace(RING, { samples: N, radius: 0.05 })
    const tp = pos.trace(POWER, { samples: N, radius: 0.07 })
    const cursorB = cursorBar(pos, LABEL)
    ticks(pos, [0, 1, 2, 3, 4].map((k): [number, string] => [k / 4, `${k}`]), [], 0.4)
    addLabel(scene, 'angle, full steps (1.8° each) · time in full-step periods', [7, -6, 0.3], GREY, 0.32)
    const code = codeBlock(scene, [-15.6, -9.4, 0.3], 0.42)
    const result = liveLabel(scene, [7, -7.3, 0.3], { size: 0.42 })

    const clock = simClock(0.001, 1.5)
    const st = { t: 0, key: '', slow: 1 }
    return {
      scene,
      view: { center: [-1.6, -1.2, 0], radius: 60, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = stepParams(p)
        const run = stepMemo(q)
        const key = stepKey(q)
        st.slow = q.slow
        const t = clock(dt / q.slow, key, q.window * 1000) / 1000
        st.t = t
        if (key !== st.key) {
          st.key = key
          const at = (u: number) => phaseCurrents(Math.min(4 * q.micro - 1, Math.floor(u * 4 * q.micro)), q.micro)
          ta.draw((u) => at(u).a * 0.42 * cur.height, null)
          tb.draw((u) => at(u).b * 0.42 * cur.height, null)
          const pts = run.filter((_, i) => i % Math.max(1, Math.ceil(run.length / N)) === 0)
          const us = pts.map((f) => f.t / q.window)
          tc.points(us, pts.map((f) => yS(f.cmd)))
          tp.points(us, pts.map((f) => yS(f.pos)))
          const os = peakOvershoot(run)
          result.set(os > 0.3 ? `Snaps and rings: overshoots ${os.toFixed(2)} step past each detent` : `Glides: overshoot only ${os.toFixed(2)} step`, os > 0.3 ? HEAT : POWER)
          code([`// MS1 MS2 MS3 = ${MS_PINS[q.mode]} → ${MODES[q.mode]}, ${stepsPerRev(q.micro)} pulses/rev`, `digitalWrite(STEP, HIGH); digitalWrite(STEP, LOW);`, `delayMicroseconds(${Math.round(1e6 / (q.rate * q.micro))});  // ${q.rate} full steps/s`])
        }
        cursorA(t / q.window)
        cursorB(t / q.window)
        const f = fixedStepAt(run, t, STEP_FRAME_S)
        motor.set(f.pos * stepDeg(1) * DEG, f.ia, f.ib)
        field.rotation.z = f.cmd * stepDeg(1) * DEG
        poleTag.set(`A ${Math.round(f.ia * 100)} %   B ${Math.round(f.ib * 100)} %`, LABEL)
      },
      readouts: (p) => {
        const q = stepParams(p)
        const f = fixedStepAt(stepMemo(q), st.t, STEP_FRAME_S)
        return [
          { label: 'Sim time', value: `${msText(st.t)} (${st.slow}× slower)` },
          { label: 'Step', value: `${stepDeg(q.micro).toFixed(3)}° (${stepsPerRev(q.micro)}/rev)` },
          { label: 'Torque per step', value: nm(torquePerMicrostep(q.micro)), tone: q.micro >= 16 ? 'warn' : 'ok' },
          { label: 'Rotor lag', value: `${(f.cmd - f.pos).toFixed(2)} step`, tone: Math.abs(f.cmd - f.pos) > 0.3 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- A4988 and TMC drivers: STEP/DIR in, Vref sets the current, the chopper holds it; TMC2209 is quiet and feels a stall. ---

const CHIPS = { a4988: 'A4988 (1/16)', stealth: 'TMC2209 StealthChop', spread: 'TMC2209 SpreadCycle' }
const DRV = { rpm: 120, esp: [-15.4, 1.2, 0] as V3, drv: [-7.6, 1.2, 0] as V3, motor: [0.6, 1.4, 0] as V3, r: 1.9, pulley: 1.6, sx: 6.6, sw: 8 }
const driverParams = (p: Params) => {
  const chip = pick(CHIPS, p.chip, 'a4988') as StepChip
  const vref = n(p, 'vref')
  const load = n(p, 'load')
  const amps = vrefAmps(chip, vref)
  const pull = pullOutNm(rpmToRadS(DRV.rpm), amps)
  const sg = chip === 'stealth' ? stallGuardResult(load, pull) : null
  const diag = sg !== null && stallDiag(sg)
  return { chip, vref, load, amps, pull, sg, diag, stalled: !diag && load >= pull, hot: amps > NEMA17.ratedA * 1.05, err: sineErrorPct(chip) }
}

export const a4988AndTmcDrivers: Lesson = {
  id: 'stepper-a4988-and-tmc-drivers',
  title: 'A4988 and TMC drivers',
  tagline: 'STEP, DIR, a current limit and a chopper',
  formula: (p) => {
    const q = driverParams(p)
    const law = q.chip === 'a4988' ? `I = Vref / (8 × ${STEP_CHIPS.a4988.senseOhm} Ω)` : `I = Vref/2.5 × 0.325 V / (${STEP_CHIPS[q.chip].senseOhm} + 0.02 Ω)`
    return `${law} = ${q.amps.toFixed(2)} A · pull-out at ${DRV.rpm} rpm = ${NEMA17.holdNm} × ${q.amps.toFixed(2)}/${NEMA17.ratedA} = ${nm(q.pull)}${q.sg !== null ? ` · SG_RESULT ${q.sg}, DIAG at ≤ ${2 * SGTHRS}` : ''}`
  },
  legend: [
    { color: PIN_COLOR, label: 'STEP / DIR from the ESP32', shape: 'dot' },
    { color: PHASE_A, label: 'Coil A current (chopped)', shape: 'dot' },
    { color: GREY, label: 'Ideal sine', shape: 'dot' },
    { color: HIGH_V, label: 'Stall / DIAG', shape: 'dot' },
  ],
  points: [
    'A step driver hides the H-bridges (two, one per coil: see Four switches). The microcontroller gives it a direction level on DIR and one pulse on STEP per (micro)step; the driver walks its sine table and moves the currents.',
    'The coil is 1.5 Ω, so 24 V would push 16 A. The driver chops instead: it switches the bridge on until the sense resistor shows the set current, then lets it decay (see Decay modes), tens of kHz. Vref on the little trimmer sets that limit.',
    'Set Vref with a multimeter from the pot to GND before connecting the motor: A4988 I = Vref / (8·Rs), so 0.8 V ≈ 1.5 A. Too low and the motor is weak and skips; above the motor\'s rating it and the driver cook (add a heatsink beyond ~1 A).',
    'The A4988\'s 1/16 table and fixed off-time chopper leave a stepped, rippled current: the motor hums and whines and has resonant speeds. A TMC2209 interpolates every STEP to 1/256 and in StealthChop regulates voltage instead: nearly silent at printer speeds. SpreadCycle is its punchier, louder mode.',
    'StallGuard4 (in StealthChop) measures back-EMF: SG_RESULT drops as load eats the torque margin. Below 2·SGTHRS the DIAG pin goes high, so firmware can stop or home against an end stop without a switch. An A4988 has no idea when the rotor stalls.',
  ],
  controls: [
    { kind: 'choice', key: 'chip', options: opts(CHIPS), initial: 'a4988' },
    { kind: 'slider', key: 'vref', label: 'Vref', min: 0.2, max: 1.6, step: 0.05, initial: 0.8, format: (v) => `${v.toFixed(2)} V` },
    { kind: 'slider', key: 'load', label: 'Load', min: 0, max: 0.4, step: 0.02, initial: 0.1, format: (v) => nm(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const espPin = esp32Board(scene, DRV.esp, 0.32)
    const drivers = { a4988: stepDriver(scene, DRV.drv, 'a4988', 0.36), tmc2209: stepDriver(scene, DRV.drv, 'tmc2209', 0.36) }
    const motor = nema17(scene, DRV.motor, DRV.r)
    const pulleyZ = motor.shaftTip[2] - 0.3
    const pulley = add(motor.rotor, new THREE.Group(), [0, 0, pulleyZ])
    add(pulley, mesh(new THREE.CylinderGeometry(DRV.pulley, DRV.pulley, 0.4, 32), mat('#d9dde3', { metal: 0.3, rough: 0.4 }))).rotation.x = Math.PI / 2
    box(pulley, [0.3, DRV.pulley * 1.8, 0.2], glowMat(POWER, 0.8), [0, 0, 0.25]).castShadow = false
    const ropeTop: V3 = [DRV.motor[0] + DRV.pulley, DRV.motor[1], DRV.motor[2] + pulleyZ]
    const weight = add(scene, new THREE.Group())
    rod(weight, ropeTop, [ropeTop[0], -6.2, ropeTop[2]], 0.05, mat('#e8e2d6'))
    const mass = box(weight, [1.6, 1.6, 1.6], mat('#5d636c', { metal: 0.3, rough: 0.5 }), [ropeTop[0], -7, ropeTop[2]])
    const loadTag = liveLabel(scene, [ropeTop[0] + 1.4, -7, 0.4], { size: 0.38, align: 'left' })

    const sig = (name: string, i: number, y: number): V3[] => {
      const a = espPin(i, true)
      const b = drivers.a4988.pin(name, 0)
      return [a, [a[0], y, a[2]], [b[0] - 1.2, y, b[2]], [b[0] - 1.2, b[1], b[2]], b]
    }
    const stepPath = sig('STEP', 3, 6.6)
    const dirPath = sig('DIR', 2, 7.2)
    wire(scene, stepPath, 0.07)
    wire(scene, dirPath, 0.07)
    const stepGlow = litWire(scene, stepPath, 0.13)
    const dirGlow = litWire(scene, dirPath, 0.11)
    addLabel(scene, 'STEP', [stepPath[1][0] + 1.2, 6.2, 0.4], PIN_COLOR, 0.34)
    addLabel(scene, 'DIR', [stepPath[1][0] + 3.4, 7.7, 0.4], PIN_COLOR, 0.34)
    const coilNames = ['1A', '1B', '2A', '2B']
    motor.pins.forEach((m, i) => {
      const d = drivers.a4988.pin(coilNames[i], 1)
      const y = -4.6 - i * 0.35
      wire(scene, [d, [d[0] + 0.8 + i * 0.25, d[1], d[2]], [d[0] + 0.8 + i * 0.25, y, d[2]], [m[0], y, m[2]], m], 0.06)
    })
    addLabel(scene, 'coil A', [DRV.drv[0] + 4.4, -3.6, 0.4], PHASE_A, 0.32)
    const diagTag = liveLabel(scene, [DRV.drv[0], DRV.drv[1] - 5, 0.6], { size: 0.38 })
    const ampTag = liveLabel(scene, [DRV.drv[0] + 0.6, DRV.drv[1] + 4.6, 0.6], { size: 0.34 })
    const waves = heatWaves(scene, 2, { count: 3, rise: 1.6 })
    waves.group.position.set(DRV.motor[0] - 3.2, DRV.motor[1] + 3.4, 1)

    const plot = scope(scene, DRV.sw, 4, { divs: [8, 4] })
    plot.group.position.set(DRV.sx + DRV.sw / 2, 3, 0)
    const ideal = plot.trace(GREY, { samples: 160, radius: 0.04 })
    const chop = plot.trace(PHASE_A, { samples: 600, radius: 0.05 })
    addLabel(scene, 'coil A, one electrical cycle', [DRV.sx + DRV.sw / 2, 0.3, 0.3], GREY, 0.3)
    const sgY = -1
    const sgBar = box(scene, [1, 0.6, 0.3], glowMat(POWER, 0.8), [0, sgY, 0])
    const sgLevel = box(scene, [0.12, 1, 0.3], glowMat(HIGH_V, 1), [DRV.sx + (DRV.sw * 2 * SGTHRS) / 510, sgY, 0])
    const sgTag = liveLabel(scene, [DRV.sx + DRV.sw / 2, -2.1, 0.3], { size: 0.36 })
    const code = codeBlock(scene, [-16.4, -6.6, 0.3], 0.4)
    const result = liveLabel(scene, [DRV.sx + DRV.sw / 2, -3.3, 0.3], { size: 0.38 })

    const st = { t: 0, angle: 0, steps: 0, key: '' }
    return {
      scene,
      view: { center: [-0.8, -0.6, 0], radius: 60, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = driverParams(p)
        st.t += dt
        const tmc = q.chip !== 'a4988'
        drivers.a4988.group.visible = !tmc
        drivers.tmc2209.group.visible = tmc
        const drv = tmc ? drivers.tmc2209 : drivers.a4988
        drv.trim(q.vref / 1.8)
        drv.chip(HIGH_V, q.hot ? 0.5 + 0.3 * Math.sin(st.t * 6) : 0)
        const key = `${q.chip}|${q.vref}`
        if (key !== st.key) {
          st.key = key
          const k = (0.4 * plot.height) / 2.2
          ideal.draw((u) => q.amps * Math.cos(2 * Math.PI * u) * k, null)
          chop.draw((u) => chopCurrent(q.chip, u, q.amps) * k, null)
        }
        const running = !q.diag && !q.stalled
        const w = rpmToRadS(DRV.rpm)
        if (running) st.angle += w * dt
        const buzz = q.stalled ? 0.6 * DEG * Math.sin(st.t * 2 * Math.PI * 9) : 0
        const e = (st.angle + buzz) * NEMA17.teeth
        motor.set(st.angle + buzz, Math.cos(e), Math.sin(e))
        st.steps += running || q.stalled ? (DRV.rpm / 60) * 200 * dt : 0
        stepGlow.set(running || q.stalled ? 0.4 + 0.6 * Math.abs(Math.sin(st.t * 40)) : 0.1, lit(PIN_COLOR))
        dirGlow.set(0.6, lit(PIN_COLOR))
        mass.scale.setScalar(0.4 + 1.5 * q.load)
        weight.position.y = running ? 0 : q.diag ? 0 : -0.2 * Math.abs(Math.sin(st.t * 9))
        loadTag.set(nm(q.load), q.load >= q.pull ? HIGH_V : LABEL)
        waves.step(dt, q.hot ? 1 : 0)
        ampTag.set(`${q.amps.toFixed(2)} A${q.hot ? ` > ${NEMA17.ratedA} A: hot` : ''}`, q.hot ? HIGH_V : q.amps < 0.6 ? HEAT : POWER)
        if (q.sg !== null) {
          sgBar.visible = sgLevel.visible = true
          sgBar.scale.x = Math.max(0.02, (DRV.sw * q.sg) / 510)
          sgBar.position.set(DRV.sx + sgBar.scale.x / 2, sgY, 0)
          ;(sgBar.material as THREE.MeshStandardMaterial).emissive.set(q.diag ? HIGH_V : POWER)
          sgTag.set(`SG_RESULT ${q.sg}${q.diag ? ` ≤ ${2 * SGTHRS}: DIAG high` : ''}`, q.diag ? HIGH_V : POWER)
        } else {
          sgBar.visible = sgLevel.visible = false
          sgTag.set(q.chip === 'spread' ? 'StallGuard4 needs StealthChop' : 'A4988: no stall detection', GREY)
        }
        diagTag.set(q.diag ? 'DIAG → stop' : '', HIGH_V)
        code(
          q.chip === 'a4988'
            ? [`// Vref ${q.vref.toFixed(2)} V → ${q.amps.toFixed(2)} A, 1/16 steps`, 'digitalWrite(DIR, HIGH);', 'digitalWrite(STEP, HIGH); digitalWrite(STEP, LOW);']
            : [`driver.rms_current(${Math.round((q.amps / Math.SQRT2) * 1000)});  // or Vref ${q.vref.toFixed(2)} V`, `driver.en_spreadCycle(${q.chip === 'spread'});  // ${q.chip === 'spread' ? 'SpreadCycle' : 'StealthChop'}`, q.chip === 'spread' ? '// StallGuard4 is off in SpreadCycle' : `driver.SGTHRS(${SGTHRS});  // DIAG when SG ≤ ${2 * SGTHRS}`],
        )
        result.set(
          q.diag ? (q.load >= q.pull ? 'Stalled, but DIAG reports it: stop, re-home' : 'Near stall: DIAG stops it in time') : q.stalled ? 'Stalled: buzzing, nobody knows' : `${DRV.rpm} rpm, margin ${nm(q.pull - q.load)}`,
          q.diag ? HEAT : q.stalled ? HIGH_V : POWER,
        )
      },
      readouts: (p) => {
        const q = driverParams(p)
        return [
          { label: 'Current limit', value: `${q.amps.toFixed(2)} A`, tone: q.hot ? 'bad' : q.amps < 0.6 ? 'warn' : 'ok' },
          { label: 'Pull-out torque', value: nm(q.pull), tone: q.load >= q.pull ? 'bad' : 'ok' },
          { label: 'Current vs sine', value: `${q.err.toFixed(1)} % RMS`, tone: q.err > 4 ? 'warn' : 'ok' },
          { label: 'StallGuard', value: q.sg === null ? '—' : `${q.sg}${q.diag ? ' DIAG' : ''}`, tone: q.diag ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Missed steps: open loop; ramp too steep or load too high and the rotor slips teeth behind the field, for good. ---

const RAMPS = { none: 'No ramp (jump to speed)', steep: 'Ramp 16 000 steps/s²', gentle: 'Ramp 4 000 steps/s²' }
const RAMP_ACC = { none: Infinity, steep: 16000, gentle: 4000 }
const LOADS = { l0: 'No load', l15: 'Load 0.15 N·m', l30: 'Load 0.30 N·m' }
const LOAD_NM = { l0: 0, l15: 0.15, l30: 0.3 }
const MS = { dist: 1600, seconds: 1.6, slow: 3, at: [-11.6, 0.4, 0] as V3, r: 2.4, maxRpm: 900, maxNm: 0.5 }
const missParams = (p: Params) => ({ rpm: n(p, 'rpm'), ramp: pick(RAMPS, p.ramp, 'gentle'), load: pick(LOADS, p.load, 'l0') })
type MissQ = ReturnType<typeof missParams>
const missKey = (q: MissQ) => `${q.rpm}|${q.ramp}|${q.load}`
const missMemo = memoBy(missKey, (q: MissQ) => missedStepRun(MS.dist, (q.rpm * NEMA17.steps) / 60, RAMP_ACC[q.ramp], LOAD_NM[q.load], MS.seconds))

export const missedSteps: Lesson = {
  id: 'stepper-missed-steps',
  title: 'Missed steps',
  tagline: 'Too fast, too sudden or too heavy',
  formula: (p) => {
    const q = missParams(p)
    const acc = RAMP_ACC[q.ramp]
    const accNm = Number.isFinite(acc) ? NEMA17.inertia * acc * ((2 * Math.PI) / NEMA17.steps) : null
    return `need = load + J·α = ${LOAD_NM[q.load]} + ${accNm === null ? '∞ (no ramp)' : accNm.toFixed(3)} N·m · pull-out at ${q.rpm} rpm = ${nm(pullOutNm(rpmToRadS(q.rpm)))} · lag > 2 steps → slips 4 steps (a tooth) at a time`
  },
  legend: [
    { color: RING, label: 'Commanded (step count)', shape: 'dot' },
    { color: POWER, label: 'Actual rotor', shape: 'dot' },
    { color: B_FIELD, label: 'Pull-out torque curve', shape: 'dot' },
    { color: HEAT, label: 'Torque the move needs', shape: 'dot' },
  ],
  points: [
    'A stepper is open loop: the firmware counts pulses and assumes the shaft followed. Under load the rotor runs a little behind the field, up to a quarter of a tooth (1 full step) at the pull-out torque, and comes back when the load goes.',
    'Ask for more torque than that and the rotor falls behind by more than half a tooth, gets pulled forward into the next tooth, and has lost 4 full steps. The count is now wrong for good, and nobody knows: the print layer shifts, the arm misses.',
    'The torque available falls with speed: each coil\'s current must rise through its inductance against the back-EMF in every step, so above a few hundred rpm it can\'t reach the set value. That is the pull-out curve; a higher supply voltage pushes it out.',
    'Starting at full speed needs infinite acceleration. Even unloaded the rotor and arm have inertia, so it buzzes in place. Ramp up and down (AccelStepper\'s setAcceleration): the torque for J·α plus the load must stay under the curve at every speed.',
    'Fixes: a gentle ramp, a lower top speed, more voltage, enough current, less load, or close the loop: an encoder, or a TMC driver\'s StallGuard to at least detect the stall, then home again.',
  ],
  controls: [
    { kind: 'slider', key: 'rpm', label: 'Top speed', min: 60, max: 900, step: 30, initial: 600, format: (v) => `${v} rpm` },
    { kind: 'choice', key: 'ramp', options: opts(RAMPS), initial: 'gentle' },
    { kind: 'choice', key: 'load', options: opts(LOADS), initial: 'l0' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const motor = nema17(scene, MS.at, MS.r)
    const z = motor.shaftTip[2] - 0.2
    const arm = add(motor.rotor, new THREE.Group(), [0, 0, z])
    box(arm, [0.7, 5.6, 0.4], mat('#e0e3e8', { rough: 0.5 }), [0, 1.8, 0])
    const armTip = add(arm, mesh(new THREE.SphereGeometry(0.55, 16, 12), glowMat(POWER, 0.9)), [0, 4.4, 0.2])
    const ghost = needle(scene, 0, 5.4, RING, 0.5)
    ghost.position.set(MS.at[0], MS.at[1], MS.at[2] + z + 0.4)
    addLabel(scene, 'NEMA17 + arm', [MS.at[0], MS.at[1] + 6, 0.4], GREY, 0.4)
    const lagTag = liveLabel(scene, [MS.at[0], MS.at[1] + 7.2, 0.6], { size: 0.42 })

    const pos = scope(scene, 11, 4, { divs: [8, 4], zeroAt: 0 })
    pos.group.position.set(5.6, 3.4, 0)
    const yP = (s: number) => (s / MS.dist - 0.5) * pos.height
    const N = 400
    const tc = pos.trace(RING, { samples: N, radius: 0.05 })
    const tp = pos.trace(POWER, { samples: N, radius: 0.07 })
    const cur = cursorBar(pos, LABEL)
    addLabel(scene, `position 0…${MS.dist} steps · 0…${MS.seconds} s`, [5.6, 0.9, 0.3], GREY, 0.32)

    const ts = scope(scene, 11, 4, { divs: [9, 5], zeroAt: 0 })
    ts.group.position.set(5.6, -3.6, 0)
    const yT = (t: number) => (t / MS.maxNm - 0.5) * ts.height
    const curve = ts.trace(B_FIELD, { samples: 120, radius: 0.06 })
    curve.draw((u) => yT(pullOutNm(rpmToRadS(u * MS.maxRpm))), null)
    const loadLine = ts.level(HEAT)
    const dot = add(ts.group, mesh(new THREE.SphereGeometry(0.3, 16, 12), glowMat(HEAT, 1.2)))
    ticks(ts, [0, 300, 600, 900].map((r): [number, string] => [r / MS.maxRpm, `${r}`]), [], 0.4)
    addLabel(scene, 'torque 0…0.5 N·m vs speed, rpm', [5.6, -7.3, 0.3], GREY, 0.32)
    const code = codeBlock(scene, [-16.4, -8.4, 0.3], 0.4)
    const result = liveLabel(scene, [5.6, -8.7, 0.3], { size: 0.42 })

    const clock = simClock(MS.slow / 1000, 2)
    const st = { t: 0, key: '' }
    return {
      scene,
      view: { center: [-3.2, -0.8, 0], radius: 60, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = missParams(p)
        const run = missMemo(q)
        const key = missKey(q)
        const t = clock(dt, key, MS.seconds * 1000) / 1000
        st.t = t
        if (key !== st.key) {
          st.key = key
          const pts = run.filter((_, i) => i % 2 === 0)
          const us = pts.map((f) => f.t / MS.seconds)
          tc.points(us, pts.map((f) => yP(f.cmd)))
          tp.points(us, pts.map((f) => yP(f.pos)))
          loadLine.set(yT(LOAD_NM[q.load]))
          loadLine.group.visible = LOAD_NM[q.load] > 0
          const lost = lostSteps(run)
          const slip = slipAt(run)
          result.set(lost ? `Slipped at ${msText(slip ?? 0)}: ${lost} steps lost` : 'Kept step: every pulse moved 1.8°', lost ? HIGH_V : POWER)
          const acc = RAMP_ACC[q.ramp]
          code([
            `stepper.setMaxSpeed(${Math.round((q.rpm * NEMA17.steps) / 60)});  // ${q.rpm} rpm`,
            Number.isFinite(acc) ? `stepper.setAcceleration(${acc});` : 'stepper.setAcceleration(1e9);  // no ramp',
            `stepper.moveTo(${MS.dist});  // 8 turns, then run() in loop()`,
          ])
        }
        cur(t / MS.seconds)
        const f = fixedStepAt(run, t, MOVE_FRAME_S)
        const lag = f.cmd - f.pos
        const slipped = lag > 2
        const e = f.cmd * (Math.PI / 2)
        motor.set(f.pos * stepDeg(1) * DEG, Math.cos(e), Math.sin(e))
        ghost.rotation.z = f.cmd * stepDeg(1) * DEG
        ;(armTip.material as THREE.MeshStandardMaterial).emissive.set(slipped ? HIGH_V : POWER)
        lagTag.set(slipped ? `Slipping: ${Math.round(lag)} steps behind` : `Lag ${lag.toFixed(2)} step`, slipped ? HIGH_V : lag > 0.5 ? HEAT : POWER)
        dot.position.set(ts.xAt(Math.min(1, Math.abs(f.cmdRpm) / MS.maxRpm)), yT(Math.min(MS.maxNm, f.needNm)), 0.3)
      },
      readouts: (p) => {
        const q = missParams(p)
        const run = missMemo(q)
        const f = fixedStepAt(run, st.t, MOVE_FRAME_S)
        const lost = lostSteps(run)
        return [
          { label: 'Sim time', value: `${msText(st.t)} (${MS.slow}× slower)` },
          { label: 'Speed', value: `${Math.round(f.rpm)} / ${Math.round(f.cmdRpm)} rpm` },
          { label: 'Torque', value: `need ${f.needNm > 1 ? '∞' : f.needNm.toFixed(2)} / ${nm(f.pullNm)}`, tone: f.needNm > f.pullNm ? 'bad' : 'ok' },
          { label: 'Lost steps', value: `${lost}`, tone: lost ? 'bad' : 'ok' },
        ]
      },
    }
  },
}
