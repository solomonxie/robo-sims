import * as THREE from 'three/webgpu'
import {
  AXIS_DRIVES,
  AxisDrive,
  CAL_MM,
  DRIVE_SWEEP,
  ENDSTOPS,
  EndstopKind,
  FRAME,
  HOMING,
  MACHINE,
  RING_RUN,
  SHAPERS,
  SHAPE_SWEEP,
  STEP_DRIVES,
  ShaperKind,
  StepDriveKey,
  driveView,
  endstopTrials,
  fixedStepAt,
  homingAt,
  homingPlan,
  microstepError,
  repeatMm,
  shaperView,
  stepsView,
} from '../../core/physics'
import { fixedText, hertz, mmFixed, msText, newtonsText, pct, secsText, signed, umText } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  DATA_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  WIDE_RIGHT,
  WIDE_VIEW,
  addLabel,
  addRod,
  beltLoop,
  caliper,
  cursorBar,
  fdmPrinter,
  glowDot,
  leadScrew,
  liveLabel,
  memoBy,
  plotY,
  printBeads,
  smoothstep,
  statusHeader,
  stepperBlock,
  stretchRod,
  textRows,
  timingPulley,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const PLOT_R = { ...WIDE_RIGHT, y: -8.6, h: 10 }
const MICRO_OPTS = { '1': 'Full step', '4': '1/4', '16': '1/16', '64': '1/64', '256': '1/256' }

// --- Axes and endstops: G28 homes X, Y, Z to their switches; repeatability depends on the switch and the bump speed. ---

const AE = { k: 0.029, at: [-8.4, -12.8, 0] as V3, hold: 3, trials: 64, vMax: 25 }
const aeParams = (p: Params) => ({ kind: pick(ENDSTOPS, p.stop, 'micro') as EndstopKind, bump: n(p, 'bump') })
const aeRun = memoBy((p: Params) => `${p.stop} ${p.bump}`, (p: Params) => {
  const q = aeParams(p)
  return { q, plan: homingPlan(q.kind, q.bump), rep: repeatMm(q.kind, q.bump), trials: endstopTrials(q.kind, q.bump, AE.trials * 3) }
})
const AE_KINDS = Object.keys(ENDSTOPS) as EndstopKind[]
const AE_COL: Record<EndstopKind, string> = { micro: RING, optical: B_FIELD, sensorless: DATA_COLOR }
const AE_SPEEDS = Array.from({ length: 49 }, (_, i) => 1 + i * 0.5)

export const printerMotionAxesAndEndstops: Lesson = {
  id: 'printer-motion-axes-and-endstops',
  title: 'Axes and endstops',
  tagline: 'G28: find zero on every axis before printing',
  formula: (p) => {
    const { q, plan, rep } = aeRun(p)
    const E = ENDSTOPS[q.kind]
    const v = E.sensorless ? HOMING.fastMmS : q.bump
    return `repeatability ≈ approach speed × delay + 4σ = ${v} mm/s × ${msText(E.latencyS, 2)} + 4 × ${umText(E.sigmaMm, 1)} = ${umText(rep, 1)} (typical) · G28 takes ${secsText(plan.total)} · soft limits 0…${MACHINE.x} × 0…${MACHINE.y} × 0…${MACHINE.z} mm`
  },
  legend: [
    { color: RING, label: 'Microswitch: lever, ±few µm', shape: 'dot' },
    { color: B_FIELD, label: 'Optical slot: flag breaks a light beam', shape: 'dot' },
    { color: DATA_COLOR, label: 'Sensorless: driver senses the stall', shape: 'dot' },
  ],
  points: [
    'A stepper printer has no idea where its axes are at power-on: the drivers count steps, but only from wherever the carriage happened to be. G28 (home) drives each axis toward an endstop until it trips and calls that point 0. Bed slingers home X, then Y, then Z.',
    'Each axis seeks the switch fast, backs off a few mm, then bumps it again slowly. The firmware only notices the trip after a short delay (debounce, the step loop), and the carriage keeps going for that long, so a slow second bump lands much closer to the same spot every time. Switches, bounce and NO/NC wiring are in Actuators › Linear actuators and Sensors › Switches.',
    'Switch types: a lever microswitch repeats to a few µm; an optical slot (a flag breaks an IR beam) is cleaner and faster; sensorless homing (TMC2209 StallGuard, Actuators › Stepper motors) needs no switch at all: the driver notices the back-EMF change when the carriage hits the frame. It only works at speed, so there is no slow bump and it repeats to tens of µm: fine for X and Y, not for Z, which keeps a switch or a bed probe.',
    'After homing, the firmware knows the machine coordinates: 0 at the switches, up to the bed size. Soft limits stop any move that would leave that box (a G1 X250 on a 220 mm bed stops at 220) so the head never grinds into the frame. Z = 0 is then fine-tuned with the Z offset (Bed adhesion).',
  ],
  controls: [
    { kind: 'choice', key: 'stop', options: opts(namesOf(ENDSTOPS)), initial: 'micro' },
    { kind: 'slider', key: 'bump', label: 'Second bump speed', min: 1, max: AE.vMax, step: 1, initial: 5, format: (v) => `${v} mm/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const { k } = AE
    const holder = add(scene, new THREE.Group(), AE.at)
    holder.rotation.set(0.2, 0.42, 0)
    const pr = fdmPrinter(holder, [0, 0, 0], k)
    const stops = (['x', 'y', 'z'] as const).map((a) => {
      const off = glowDot(holder, 0.22, GREY, 0.4)
      const on = glowDot(holder, 0.36, RING, 1.6)
      const tag = liveLabel(scene, [0, 0, 1], { size: 0.34, align: a === 'z' ? 'right' : 'left' })
      return { a, off, on, tag, dx: a === 'z' ? -0.5 : 0.5, dy: a === 'x' ? 0.9 : a === 'z' ? -0.7 : 1.1 }
    })
    const P = PLOT_R
    const plot = titledScope(scene, P.y, P.h, 'repeatability vs bump speed', LABEL, 0, P.x, P.w)
    const curves = AE_KINDS.map((c) => plot.s.trace(AE_COL[c], { samples: AE_SPEEDS.length, radius: 0.06 }))
    const mark = glowDot(plot.s.group, 0.24, RING)
    const cursor = cursorBar(plot.s, RING, 0.05)
    plot.lo.set('1 mm/s')
    plot.hi.set(`${AE.vMax} mm/s`)
    const yTag = liveLabel(plot.s.group, [-P.w / 2 + 0.2, P.h / 2 - 0.45, 0.4], { size: 0.24, color: GREY, align: 'left' })
    const rows = textRows(scene, 4, 2.4, 3.2, 0.3, 0.72)
    const st = { t: 0, key: '', loop: 0 }
    const w = new THREE.Vector3()
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, plan, rep, trials } = aeRun(p)
        const key = `${q.kind} ${q.bump}`
        if (key !== st.key) [st.key, st.t, st.loop] = [key, 0, 0]
        st.t += dt
        if (st.t > plan.total + AE.hold) [st.t, st.loop] = [0, st.loop + 1]
        const { pos, seg, done } = homingAt(plan, st.t)
        pr.set(pos.x - MACHINE.x / 2, pos.y - MACHINE.y / 2, pos.z)
        pr.heat(0, 0)
        const g = (64 + pos.z + 60) * k
        const at: Record<'x' | 'y' | 'z', V3> = {
          x: [(-MACHINE.x / 2 - 36) * k, g, 14 * k],
          y: [40 * k, 72 * k, -212 * k],
          z: [-176 * k, 124 * k, 22 * k],
        }
        holder.updateMatrixWorld(true)
        const offs = trials.slice((st.loop % AE.trials) * 3, (st.loop % AE.trials) * 3 + 3)
        for (const s of stops) {
          const pressed = pos[s.a] <= 1e-6
          s.off.position.set(...at[s.a])
          s.on.position.set(...at[s.a])
          s.on.visible = pressed
          s.off.visible = !pressed
          w.set(...at[s.a])
          holder.localToWorld(w)
          s.tag.group.position.set(w.x + s.dx, w.y + s.dy, w.z + 3)
          s.tag.set(`${s.a.toUpperCase()} stop`, pressed ? RING : GREY)
        }

        const yMax = Math.max(...AE_KINDS.filter((c) => c !== 'sensorless' || q.kind === 'sensorless').map((c) => repeatMm(c, AE.vMax))) * 1.15
        const py = plotY(0, yMax, P.h)
        const us = AE_SPEEDS.map((v) => (v - 1) / (AE.vMax - 1))
        AE_KINDS.forEach((c, i) => curves[i].points(us, AE_SPEEDS.map((v) => Math.min(P.h / 2, py(repeatMm(c, v)))), null))
        const ux = (q.bump - 1) / (AE.vMax - 1)
        mark.position.set(plot.s.xAt(ux), Math.min(P.h / 2, py(rep)), 0.46)
        cursor(ux)
        plot.right.set(`spread ${umText(rep, 1)}`, AE_COL[q.kind])
        yTag.set(umText(yMax), GREY)

        const sl = ENDSTOPS[q.kind].sensorless
        rows[0].set(`seek ${HOMING.fastMmS} mm/s, back off ${HOMING.backoffMm} mm, ${sl ? 'no bump (Z: switch)' : `bump at ${q.bump} mm/s`}`, LABEL)
        rows[1].set(`zero lands within ${umText(rep, 1)} each time (typical)`, toneOf(rep < 0.02, rep < 0.06) === 'ok' ? POWER : rep < 0.06 ? HEAT : HIGH_V)
        rows[2].set(`this home: X ${signed(offs[0] * 1000, 0)} µm · Y ${signed(offs[1] * 1000, 0)} µm · Z ${signed(offs[2] * 1000, 0)} µm`, GREY)
        rows[3].set(`soft limits 0…${MACHINE.x} mm: G1 X250 stops at X${MACHINE.x}`, GREY)
        head.status.set(`Axes and endstops · ${ENDSTOPS[q.kind].name}`)
        head.sub.set(`G28 in real time: ${secsText(plan.total)} · X ${fixedText(pos.x, 0)} Y ${fixedText(pos.y, 0)} Z ${fixedText(pos.z, 1)} mm`, GREY)
        head.event.set(
          done ? 'homed: X0 Y0 Z0 known' : seg ? `${seg.axis.toUpperCase()}: ${seg.step === 'seek' ? 'seeking the switch fast' : seg.step === 'back off' ? 'backing off' : 'second bump, slowly'}` : '',
          done ? POWER : RING,
        )
      },
      readouts: (p) => {
        const { plan, rep } = aeRun(p)
        return [
          { label: 'Repeatability', value: umText(rep, 1), tone: toneOf(rep < 0.02, rep < 0.06) },
          { label: 'G28 time', value: secsText(plan.total) },
        ]
      },
    }
  },
}

// --- Belts vs lead screws: the same vertical axis lifted by a GT2 belt, a T8 lead 8 and a T8 lead 2. ---

const BS = { k: 0.05, at: [-13.4, -11.6, 0] as V3, gap: 6.2, H: 200, lo: 25, hi: 170, show: 60 }
const bsParams = (p: Params) => ({ speed: n(p, 'speed'), kg: n(p, 'kg'), on: p.motors !== 'off' })
const bsRun = memoBy((p: Params) => `${p.speed} ${p.kg}`, (p: Params) => {
  const q = bsParams(p)
  return driveView(q.speed, q.kg)
})
const BS_KEYS = Object.keys(AXIS_DRIVES) as AxisDrive[]
const BS_COL: Record<AxisDrive, string> = { belt: B_FIELD, t8l8: RING, t8l2: HEAT }
const F_MAX = 420

export const printerMotionBeltsVsLeadScrews: Lesson = {
  id: 'printer-motion-belts-vs-lead-screws',
  title: 'Belts vs lead screws',
  tagline: 'Fast and springy, or slow, strong and self-holding',
  formula: (p) => {
    const V = bsRun(p)
    const [b, l8] = V.drives
    return `belt: F = T / r = pull-out torque / 6.4 mm = ${newtonsText(b.forceN, 0)} · screw: F = 2π·η·T / lead = ${newtonsText(l8.forceN, 0)} (lead 8) · need ≈ 1.5 × m·g = ${newtonsText(V.needN, 0)} · µm per 1/16 step = mm per turn / 3200 (NEMA17, 24 V, typical)`
  },
  legend: [
    { color: B_FIELD, label: 'GT2 belt, 20T pulley: 40 mm a turn', shape: 'dot' },
    { color: RING, label: 'T8 lead screw, lead 8 mm', shape: 'dot' },
    { color: HEAT, label: 'T8 lead screw, lead 2 mm', shape: 'dot' },
  ],
  points: [
    'Every axis turns motor rotation into travel. A GT2 belt on a 20-tooth pulley moves 40 mm per turn; a T8 lead screw moves one lead per turn: 8 mm for the common 4-start screw, 2 mm for a single start. Same motor, so the mm per turn trades speed for force and resolution (Steps per mm).',
    'Belts are light, fast and have no backlash when tensioned, which is why X and Y are belts on almost every printer. But the belt is a spring (Materials › Belts, chains, couplers): it stretches under load and lets the toolhead ring (Input shaping).',
    'Lead screws gear the motor down: the push is many times higher and each microstep is a few µm, ideal for Z, which only moves a layer at a time. The thread friction also holds the load: switch the motors off and the screw axes stay put while a belt Z axis drops (so belt-Z printers like the Voron 2.4 park the bed or add brakes). See Actuators › Linear actuators for lead angle and self-locking.',
    'Screw costs: the motor spins 5–20× faster for the same speed, and pull-out torque collapses at speed, so a lead 2 screw tops out near 25 mm/s. A brass nut has about 0.1 mm of backlash (anti-backlash nuts spring it out), and a bent screw or a misaligned coupler shows up as Z wobble: a regular ripple on the walls every lead.',
  ],
  controls: [
    { kind: 'slider', key: 'speed', label: 'Axis speed', min: 5, max: 300, step: 5, initial: 20, format: (v) => `${v} mm/s` },
    { kind: 'slider', key: 'kg', label: 'Load lifted', min: 0.5, max: 5, step: 0.5, initial: 1.5, format: (v) => `${v} kg` },
    { kind: 'choice', key: 'motors', options: opts({ on: 'Motors on', off: 'Motors off' }), initial: 'on' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const { k, H } = BS
    const rail = mat('#33363d', { metal: 0.4, rough: 0.5 })
    const axes = BS_KEYS.map((d, i) => {
      const g = add(scene, new THREE.Group(), [BS.at[0] + i * BS.gap, BS.at[1], 0])
      box(g, [44 * k, 6 * k, 30 * k], rail, [0, -3 * k, 0])
      box(g, [6 * k, (H + 30) * k, 6 * k], rail, [-26 * k, ((H + 30) / 2) * k, -8 * k])
      box(g, [44 * k, 6 * k, 20 * k], rail, [-8 * k, (H + 30) * k, -8 * k])
      const car = add(g, new THREE.Group())
      box(car, [30 * k, 18 * k, 14 * k], mat('#d23b3b', { rough: 0.5 }), [0, 0, 0])
      const load = box(car, [40 * k, 1, 30 * k], mat('#8a929e', { metal: 0.4, rough: 0.4 }), [0, 0, 0])
      let set: (y: number) => void
      if (d === 'belt') {
        stepperBlock(g, [0, 26 * k, -6 * k], k)
        const p1 = timingPulley(g, 20, k, [0, 26 * k, 8 * k])
        const p2 = timingPulley(g, 20, k, [0, (H + 10) * k, 8 * k])
        const r = p1.rp / k
        const loop = beltLoop(g, r, r, H - 16, k, [0, 26 * k, 8 * k])
        loop.group.rotation.z = Math.PI / 2
        set = (y) => {
          loop.set(-y)
          p1.group.rotation.z = p2.group.rotation.z = -y / r
          car.position.set(-r * k, (26 + y) * k, 10 * k)
        }
      } else {
        stepperBlock(g, [0, 14 * k, 0], k).rotation.x = -Math.PI / 2
        const s = leadScrew(g, [0, 20 * k, 0], H * k, { r: 4 * k, lead: (d === 't8l8' ? 8 : 2) * k, starts: d === 't8l8' ? 4 : 1 })
        set = (y) => {
          s.set((10 + y) * k)
          car.position.set(0, (30 + y) * k, 9 * k)
        }
      }
      addLabel(g, AXIS_DRIVES[d].short, [0, (H + 50) * k, 0], BS_COL[d], 0.36)
      const tag = liveLabel(g, [0, -36 * k, 1], { size: 0.3 })
      const tag2 = liveLabel(g, [0, -56 * k, 1], { size: 0.26 })
      return { d, set, load, tag, tag2, y: BS.lo, v: 0, dir: 1 }
    })
    const P = PLOT_R
    const plot = titledScope(scene, P.y, P.h, 'push vs speed', LABEL, 0, P.x, P.w)
    const curves = BS_KEYS.map((d) => plot.s.trace(BS_COL[d], { samples: DRIVE_SWEEP.length, radius: 0.06 }))
    const marks = BS_KEYS.map((d) => glowDot(plot.s.group, 0.22, BS_COL[d]))
    const need = plot.s.level(HIGH_V)
    const cursor = cursorBar(plot.s, LABEL, 0.05)
    plot.lo.set('0 mm/s')
    plot.hi.set(`${DRIVE_SWEEP[DRIVE_SWEEP.length - 1]} mm/s`)
    addLabel(plot.s.group, `${F_MAX} N`, [P.w / 2 - 0.2, P.h / 2 - 0.45, 0.4], GREY, 0.24, 'right')
    const rows = textRows(scene, 4, 2.4, 3.2, 0.3, 0.72)
    const st = { key: '' }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const q = bsParams(p)
        const V = bsRun(p)
        const slow = q.speed > BS.show ? BS.show / q.speed : 1
        const key = `${q.speed} ${q.kg} ${q.on}`
        if (key !== st.key) {
          st.key = key
          for (const a of axes) a.v = 0
        }
        axes.forEach((a, i) => {
          const D = V.drives[i]
          if (!q.on) {
            if (!D.holds) {
              a.v += 9810 * dt * 0.25
              a.y = Math.max(0, a.y - a.v * dt)
            }
          } else if (D.lifts) {
            a.y += a.dir * q.speed * slow * dt
            if (a.y > BS.hi) [a.y, a.dir] = [BS.hi, -1]
            if (a.y < BS.lo) [a.y, a.dir] = [BS.lo, 1]
          }
          a.set(a.y)
          a.load.scale.y = (4 + q.kg * 3) * k
          a.load.position.y = (9 + 2 + q.kg * 1.5) * k
          const stall = q.on && !D.lifts
          a.tag.set(q.on ? (stall ? 'stalls: skips steps' : `${newtonsText(D.forceN, 0)} push`) : D.holds ? 'holds unpowered' : 'drops', stall || (!q.on && !D.holds) ? HIGH_V : POWER)
          a.tag2.set(`${fixedText(D.umStep, 1)} µm/step · ${Math.round(D.rpm)} rpm`, GREY)
        })

        const py = plotY(0, F_MAX, P.h)
        const us = DRIVE_SWEEP.map((v) => v / DRIVE_SWEEP[DRIVE_SWEEP.length - 1])
        const ux = q.speed / DRIVE_SWEEP[DRIVE_SWEEP.length - 1]
        V.drives.forEach((D, i) => {
          curves[i].points(us, D.curve.map((f) => py(f)), null)
          marks[i].position.set(plot.s.xAt(ux), py(D.forceN), 0.46)
        })
        need.set(py(V.needN))
        cursor(ux)
        plot.right.set(`need ${newtonsText(V.needN, 0)} at ${q.speed} mm/s`, HIGH_V)

        const [b, l8, l2] = V.drives
        rows[0].set(`per turn: belt 40 mm · lead 8: 8 mm · lead 2: 2 mm`, LABEL)
        rows[1].set(`top speed lifting ${q.kg} kg: ${b.topMmS} · ${l8.topMmS} · ${l2.topMmS} mm/s`, RING)
        rows[2].set(`belt stretches ${umText(b.stretchMm)}; nut backlash ±${mmFixed(l8.backlashMm / 2, 2)}`, GREY)
        rows[3].set(q.on ? 'an axis lifts if its push beats the red line' : 'motors off: the screws hold, the belt drops', q.on ? GREY : HEAT)
        head.status.set(`Belts vs lead screws · ${q.speed} mm/s · ${q.kg} kg`)
        head.sub.set(slow < 1 ? `shown ${fixedText(1 / slow, 1)}× slowed · NEMA17 at 24 V, 1/16 steps, typical` : 'real time · NEMA17 at 24 V, 1/16 steps, typical', GREY)
        head.event.set(q.on ? `${V.drives.filter((D) => D.lifts).length} of 3 axes keep up` : `${V.drives.filter((D) => D.holds).length} of 3 axes hold the load`, LABEL)
      },
      readouts: (p) => {
        const V = bsRun(p)
        const [b, l8] = V.drives
        return [
          { label: 'Belt push', value: newtonsText(b.forceN, 0), tone: toneOf(b.lifts, b.lifts) },
          { label: 'Lead 8 push', value: newtonsText(l8.forceN, 0), tone: toneOf(l8.lifts, l8.lifts) },
          { label: 'Need', value: newtonsText(V.needN, 0) },
        ]
      },
    }
  },
}

// --- Steps per mm: from motor steps, microsteps and mm per turn; calibrate by measuring a 100 mm move. ---

const SP = { k: 0.1, at: [-13.8, -5.4, 0] as V3, len: 130, move: 2.4, hold: 2.4, back: 1.4, full: 2 }
const spParams = (p: Params) => ({ drive: pick(STEP_DRIVES, p.drive, 'gt2_20') as StepDriveKey, micro: Number(pick(MICRO_OPTS, p.micro, '16')), err: n(p, 'err') })
const spRun = memoBy((p: Params) => `${p.drive} ${p.micro} ${p.err}`, (p: Params) => {
  const q = spParams(p)
  const V = stepsView(q.drive, q.micro, q.err)
  return { q, V, trace: microstepError(V.mmRev, q.micro, SP.full) }
})

export const printerMotionStepsPerMm: Lesson = {
  id: 'printer-motion-steps-per-mm',
  title: 'Steps per mm',
  tagline: 'How many pulses move the axis one millimetre',
  formula: (p) => {
    const { q, V } = spRun(p)
    return `steps/mm = 200 × ${q.micro} / ${V.mmRev} mm per turn = ${fixedText(V.trueSpm, 2)} · firmware ${fixedText(V.fwSpm, 2)} → 100 mm commanded moves ${mmFixed(V.actualMm, 2)} · new = old × 100 / measured = ${fixedText(V.fwSpm, 2)} × 100 / ${fixedText(V.actualMm, 2)} = ${fixedText(V.fixedSpm, 2)}`
  },
  legend: [
    { color: RING, label: 'Position error vs a smooth move', shape: 'dot' },
    { color: HIGH_V, label: 'Detent ripple limit, typical', shape: 'dot' },
    { color: POWER, label: 'One microstep', shape: 'dot' },
  ],
  points: [
    'The firmware turns every G-code distance into step pulses, so it needs one number per axis: steps per mm = (motor steps per turn × microsteps) / mm per turn. A 200-step motor at 1/16 has 3200 microsteps a turn; a GT2 belt on a 20T pulley moves 40 mm a turn, so 80 steps/mm. A T8 lead 8 screw gives 400 (Marlin M92, Klipper rotation_distance = mm per turn).',
    'Compute it, don\'t guess. A wrong pulley (16T is 100 steps/mm) or microstep setting scales every move: parts come out the wrong size by the same percentage. Check it: command a 100 mm move, measure the real travel with a caliper or ruler, and scale: new = old × 100 / measured. On X and Y the number is exact by design; a measured error there is usually a loose belt or the wrong pulley, not the number.',
    'Microsteps add resolution but not accuracy. At 1/256 a belt axis has 0.16 µm steps, yet the rotor does not sit exactly on each microstep: the detent torque and the load pull it off by about (detent / holding torque) of a step, a few µm, repeating every full step (the plot). Microstepping mainly makes motion smooth and quiet (Actuators › Stepper motors).',
    'The extruder has steps/mm too (E-steps), calibrated the same way by feeding 100 mm of filament: see Calibration.',
  ],
  controls: [
    { kind: 'choice', key: 'drive', options: opts(namesOf(STEP_DRIVES)), initial: 'gt2_20' },
    { kind: 'choice', key: 'micro', options: opts(MICRO_OPTS), initial: '16' },
    { kind: 'slider', key: 'err', label: 'Firmware steps/mm off by', min: -10, max: 10, step: 0.5, initial: 2, format: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const { k, len } = SP
    const g = add(scene, new THREE.Group(), SP.at)
    g.rotation.set(0.32, 0.1, 0)
    box(g, [(len + 30) * k, 8 * k, 20 * k], mat('#33363d', { metal: 0.4, rough: 0.5 }), [(len / 2) * k, -10 * k, -10 * k])
    stepperBlock(g, [-12 * k, 0, -14 * k], k)
    const belts = (['gt2_20', 'gt2_16'] as const).map((d) => {
      const bg = add(g, new THREE.Group())
      const z = d === 'gt2_20' ? 20 : 16
      const p1 = timingPulley(bg, z, k, [-12 * k, 0, 4 * k])
      const p2 = timingPulley(bg, z, k, [(len + 6) * k, 0, 4 * k])
      const loop = beltLoop(bg, p1.rp / k, p1.rp / k, len + 18, k, [-12 * k, 0, 4 * k])
      return { d, bg, r: p1.rp / k, p1, p2, loop }
    })
    const screws = (['t8l8', 't8l2'] as const).map((d) => {
      const sg = add(g, new THREE.Group(), [-4 * k, 0, 4 * k])
      sg.rotation.z = -Math.PI / 2
      const s = leadScrew(sg, [0, 0, 0], (len + 10) * k, { r: 4 * k, lead: STEP_DRIVES[d].mmRev * k, starts: d === 't8l8' ? 4 : 1 })
      return { d, sg, s }
    })
    const car = add(g, new THREE.Group())
    box(car, [24 * k, 22 * k, 12 * k], mat('#d23b3b', { rough: 0.5 }), [0, 0, 10 * k])
    const reading = liveLabel(car, [0, 20 * k, 12 * k], { size: 0.42 })
    const cal = caliper(g, k, [0, -26 * k, 6 * k], 120)
    const jaw = addRod(g, mat('#c9ced6', { metal: 0.6, rough: 0.3 }))
    addLabel(g, '0', [0, -34 * k, 6 * k], GREY, 0.3)
    addLabel(g, '100', [CAL_MM * k, -34 * k, 6 * k], GREY, 0.3)
    const P = PLOT_R
    const plot = titledScope(scene, P.y, P.h, 'position error over 2 full steps', LABEL, 0.5, P.x, P.w)
    const err = plot.s.trace(RING, { samples: 400, radius: 0.05 })
    const hi = plot.s.level(HIGH_V)
    const lo = plot.s.level(HIGH_V)
    const cursor = cursorBar(plot.s, POWER, 0.05)
    const yTag = liveLabel(plot.s.group, [-P.w / 2 + 0.2, P.h / 2 - 0.45, 0.4], { size: 0.24, color: GREY, align: 'left' })
    plot.lo.set('0')
    const rows = textRows(scene, 4, 2.4, 3.2, 0.28, 0.68)
    const st = { t: 0, key: '' }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V, trace } = spRun(p)
        const key = `${q.drive} ${q.micro} ${q.err}`
        if (key !== st.key) [st.key, st.t] = [key, 0]
        const cyc = SP.move + SP.hold + SP.back + 0.6
        st.t = (st.t + dt) % cyc
        const u = st.t < SP.move ? smoothstep(st.t / SP.move) : st.t < SP.move + SP.hold ? 1 : st.t < SP.move + SP.hold + SP.back ? 1 - smoothstep((st.t - SP.move - SP.hold) / SP.back) : 0
        const x = u * V.actualMm
        for (const b of belts) {
          b.bg.visible = b.d === q.drive
          if (b.bg.visible) {
            b.loop.set(-x)
            b.p1.group.rotation.z = b.p2.group.rotation.z = -x / b.r
          }
        }
        for (const s of screws) {
          s.sg.visible = s.d === q.drive
          if (s.sg.visible) s.s.set((x + 4) * k)
        }
        car.position.set(x * k, 0, 0)
        cal.set(x)
        reading.set(mmFixed(x, 2), u >= 1 ? (Math.abs(V.actualMm - CAL_MM) < 0.05 ? POWER : HEAT) : LABEL)
        stretchRod(jaw, [x * k, -10 * k, 6 * k], [x * k, -20 * k, 6 * k], 0.8 * k)

        const yMax = Math.max(V.accMm * 1.6, ...trace.map((s) => Math.abs(s.err))) * 1.1
        const py = plotY(-yMax, yMax, P.h)
        const span = SP.full * V.fullMm
        err.points(trace.map((s) => s.cmd / span), trace.map((s) => py(s.err)), null)
        hi.set(py(V.accMm))
        lo.set(py(-V.accMm))
        cursor(V.microMm / span)
        plot.hi.set(umText(span))
        plot.right.set(`1 microstep = ${umText(V.microMm, V.microMm < 0.01 ? 2 : 1)}`, POWER)
        yTag.set(`±${umText(yMax, 1)}`, GREY)

        const off = V.actualMm - CAL_MM
        rows[0].set(`200 × ${q.micro} / ${V.mmRev} mm = ${fixedText(V.trueSpm, 2)} steps/mm; firmware has ${fixedText(V.fwSpm, 2)}`, LABEL)
        rows[1].set(`G1 X100 sends ${V.steps} steps → moves ${mmFixed(V.actualMm, 2)} (${signed(off, 2)} mm)`, Math.abs(off) < 0.05 ? POWER : HEAT)
        rows[2].set(`fix: ${fixedText(V.fwSpm, 2)} × 100 / ${fixedText(V.actualMm, 2)} = ${fixedText(V.fixedSpm, 2)} (M92)`, RING)
        rows[3].set(`resolution ${umText(V.microMm, 2)} · real accuracy ±${umText(V.accMm, 1)} (detent, typical)`, GREY)
        head.status.set(`Steps per mm · ${STEP_DRIVES[q.drive].name} · ${MICRO_OPTS[String(q.micro) as keyof typeof MICRO_OPTS]}`)
        head.sub.set('commanding a 100 mm move, measured with a caliper', GREY)
        head.event.set(u >= 1 ? `caliper reads ${mmFixed(V.actualMm, 2)}` : st.t < SP.move ? 'G1 X100: moving' : 'returning to 0', u >= 1 ? (Math.abs(off) < 0.05 ? POWER : HEAT) : LABEL)
      },
      readouts: (p) => {
        const { V } = spRun(p)
        const off = V.actualMm - CAL_MM
        return [
          { label: 'Correct steps/mm', value: fixedText(V.trueSpm, 2) },
          { label: '100 mm moves', value: mmFixed(V.actualMm, 2), tone: toneOf(Math.abs(off) < 0.05, Math.abs(off) < 1) },
        ]
      },
    }
  },
}

// --- Input shaping: braking into a corner rings the toolhead on its frame; a shaper splits the move into impulses that cancel it. ---

const IS = { k: 0.21, at: [-6.6, -3.9, 0] as V3, leg: 40, layers: 10, layerH: 0.6, w: 1.2, mag: 40, step: 0.5, lapse: 3.2, accel: 5000 }
const isParams = (p: Params) => ({ kind: pick(SHAPERS, p.shaper, 'none') as ShaperKind, hz: n(p, 'hz'), speed: n(p, 'speed') })
const isRun = memoBy((p: Params) => `${p.shaper} ${p.hz} ${p.speed}`, (p: Params) => {
  const q = isParams(p)
  return { q, V: shaperView(q.kind, q.hz, q.speed, IS.accel) }
})
const IS_LEG_N = Math.round(IS.leg / IS.step)

export const printerMotionInputShaping: Lesson = {
  id: 'printer-motion-input-shaping',
  title: 'Input shaping',
  tagline: 'Cancel the ringing after every corner',
  formula: (p) => {
    const { q, V } = isRun(p)
    return `toolhead on a spring: e″ = −ω²e − 2ζωe′ − a(t), frame ${FRAME.hz} Hz, ζ = ${FRAME.zeta} (typical) · ripples every v / f = ${q.speed} / ${FRAME.hz} = ${mmFixed(V.rippleMm, 2)} · ${SHAPERS[q.kind].name}${q.kind === 'none' ? '' : ` at ${q.hz} Hz: ${V.imp.a.length} impulses ${V.imp.a.map((a) => fixedText(a, 2)).join(' + ')} over ${msText(V.delayS, 1)}`} · ringing left ${pct(V.residual)}`
  },
  legend: [
    { color: GREY, label: 'No shaping', shape: 'dot' },
    { color: RING, label: 'With the chosen shaper', shape: 'dot' },
    { color: HIGH_V, label: `Frame resonance, ${FRAME.hz} Hz`, shape: 'dot' },
  ],
  points: [
    'The toolhead sits on a springy frame and belts, so it is a mass on a spring (Mechanics › Oscillations). Braking hard into a corner kicks it, and it keeps swinging for a few cycles at the frame\'s natural frequency. The nozzle draws that swing into the next wall: fine ripples (ringing or ghosting) that fade away from the corner, spaced speed / frequency apart.',
    'Measure the frequency first: an accelerometer (ADXL345, Sensors › IMU) on the toolhead while the printer sweeps a shake through 5–130 Hz; the peak of the spectrum is the resonance (Mechanics › Vibration). Typical bed slingers ring at 30–60 Hz in Y, CoreXY machines at 50–100 Hz.',
    'An input shaper splits every acceleration into a few smaller copies, delayed by fractions of the ringing period. ZV uses two half-size impulses half a period apart: the second swing starts exactly out of phase with the first and cancels it. MZV and EI use three impulses: a bit more delay (more corner rounding), but they still cancel when the guess is 10–20 % off, as the residual plot shows.',
    'Klipper (SHAPER_CALIBRATE) and Marlin (M593) do this in firmware. With ringing gone, acceleration can go up several times without ghosting, which is most of why modern printers are fast.',
  ],
  controls: [
    { kind: 'choice', key: 'shaper', options: opts(namesOf(SHAPERS)), initial: 'none' },
    { kind: 'slider', key: 'hz', label: 'Shaper tuned to', min: 20, max: 100, step: 1, initial: FRAME.hz, format: (v) => `${v} Hz` },
    { kind: 'slider', key: 'speed', label: 'Speed into the corner', min: 50, max: 300, step: 10, initial: 150, format: (v) => `${v} mm/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const { k } = IS
    const holder = add(scene, new THREE.Group(), IS.at)
    holder.rotation.set(1.0, 0.3, 0)
    box(holder, [(IS.leg + 16) * k, 1 * k, (IS.leg + 16) * k], mat('#3a3f48', { metal: 0.3, rough: 0.4 }), [(-IS.leg / 2 + 4) * k, -0.5 * k, (-IS.leg / 2 + 4) * k])
    const beads = printBeads(holder, IS.layers * (IS_LEG_N + 1), k)
    const nozzle = add(holder, new THREE.Mesh(new THREE.ConeGeometry(2.2 * k, 5 * k, 6), new THREE.MeshStandardMaterial({ color: '#d9b24a', metalness: 0.45, roughness: 0.35 })))
    nozzle.rotation.x = Math.PI
    const tip = glowDot(holder, 0.14, RING)
    const R = { x: 8.6, w: 12.4, h: 6 }
    const top = titledScope(scene, 0, R.h, 'toolhead lag after braking', LABEL, 0.5, R.x, R.w)
    const raw = top.s.trace(GREY, { samples: 320, radius: 0.04 })
    const run = top.s.trace(RING, { samples: 320, radius: 0.06 })
    const tCur = cursorBar(top.s, LABEL, 0.05)
    top.lo.set('0')
    top.hi.set(msText(RING_RUN.seconds))
    const topTag = liveLabel(top.s.group, [-R.w / 2 + 0.2, -R.h / 2 + 0.45, 0.4], { size: 0.24, color: GREY, align: 'left' })
    const low = titledScope(scene, -9.6, R.h, 'ringing left vs frequency', LABEL, 0, R.x, R.w)
    const curve = low.s.trace(RING, { samples: SHAPE_SWEEP.length, radius: 0.06 })
    const fCur = cursorBar(low.s, HIGH_V, 0.05)
    const tuned = cursorBar(low.s, RING, 0.03)
    const fDot = glowDot(low.s.group, 0.24, HIGH_V)
    low.lo.set(hertz(SHAPE_SWEEP[0]))
    low.hi.set(hertz(SHAPE_SWEEP[SHAPE_SWEEP.length - 1]))
    addLabel(low.s.group, '100 %', [-R.w / 2 + 0.2, R.h / 2 - 0.45, 0.4], GREY, 0.24, 'left')
    const rows = textRows(scene, 3, -17, -10.2, 0.3, 0.7)
    const st = { key: '', t: 0 }
    const sweepU = SHAPE_SWEEP.map((f) => (f - SHAPE_SWEEP[0]) / (SHAPE_SWEEP[SHAPE_SWEEP.length - 1] - SHAPE_SWEEP[0]))
    const fU = (f: number) => (f - SHAPE_SWEEP[0]) / (SHAPE_SWEEP[SHAPE_SWEEP.length - 1] - SHAPE_SWEEP[0])
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = isRun(p)
        const key = `${q.kind} ${q.hz} ${q.speed}`
        const brake = q.speed / IS.accel
        const eAt = (t: number) => fixedStepAt(V.run.out, Math.min(RING_RUN.seconds, Math.max(0, t)), RING_RUN.dt).e
        if (key !== st.key) {
          st.key = key
          st.t = 0
          let i = 0
          for (let L = 0; L < IS.layers; L++) {
            const z = L * IS.layerH
            beads.lay(i++, [-IS.leg, 0], [0, 0], z, IS.w, IS.layerH)
            let prev: [number, number] = [eAt(brake) * IS.mag, 0]
            for (let j = 1; j <= IS_LEG_N; j++) {
              const y = j * IS.step
              const pt: [number, number] = [eAt(brake + y / q.speed) * IS.mag, y]
              beads.lay(i++, prev, pt, z, IS.w, IS.layerH)
              prev = pt
            }
          }
          beads.show(i)
        }
        st.t = (st.t + dt / IS.lapse) % 1.15
        const tau = -0.03 + Math.min(1, st.t) * (RING_RUN.seconds + 0.03)
        const d = (q.speed * brake) / 2
        let nx: number
        let ny = 0
        if (tau < 0) nx = -d + q.speed * tau
        else if (tau < brake) nx = -d + q.speed * tau - (IS.accel * tau * tau) / 2
        else [nx, ny] = [0, Math.min(IS.leg, q.speed * (tau - brake))]
        nx += eAt(tau) * IS.mag
        const zTop = IS.layers * IS.layerH
        nozzle.position.set(nx * k, (zTop + 2.5) * k, -ny * k)
        tip.position.set(nx * k, zTop * k, -ny * k)

        const eMax = Math.max(V.rawMm, ...V.raw.out.map((f) => Math.abs(f.e))) * 1.1
        const py = plotY(-eMax, eMax, R.h)
        const every = Math.ceil(V.raw.out.length / 320)
        const pick_ = <T,>(a: readonly T[]) => a.filter((_, i) => i % every === 0).slice(0, 320)
        const rs = pick_(V.raw.out)
        const ss = pick_(V.run.out)
        raw.points(rs.map((f) => f.t / RING_RUN.seconds), rs.map((f) => py(f.e)), null)
        run.points(ss.map((f) => f.t / RING_RUN.seconds), ss.map((f) => py(f.e)), null)
        tCur(Math.max(0, tau) / RING_RUN.seconds)
        top.right.set(q.kind === 'none' ? `ringing ±${umText(V.rawMm)}` : `±${umText(V.ringMm)} vs ±${umText(V.rawMm)}`, q.kind === 'none' ? GREY : RING)
        topTag.set(`±${umText(eMax)}`, GREY)

        const pyL = plotY(0, 1, R.h)
        curve.points(sweepU, V.sweep.map((v) => Math.min(R.h / 2, pyL(v))), null)
        fCur(fU(FRAME.hz))
        tuned(q.kind === 'none' ? null : fU(q.hz))
        fDot.position.set(low.s.xAt(fU(FRAME.hz)), pyL(V.residual), 0.46)
        low.right.set(`${pct(V.residual)} at ${FRAME.hz} Hz`, V.residual < 0.1 ? POWER : V.residual < 0.4 ? HEAT : HIGH_V)

        rows[0].set(`ripples ${mmFixed(V.rippleMm, 2)} apart, ±${umText(V.ringMm)} deep (drawn ×${IS.mag})`, V.residual < 0.1 ? POWER : HEAT)
        rows[1].set(q.kind === 'none' ? 'no shaper: the full kick rings the frame' : `${V.imp.a.length} impulses over ${msText(V.delayS, 1)}: corners round by about that`, LABEL)
        rows[2].set(`braking ${IS.accel} mm/s² from ${q.speed} mm/s, frame ${FRAME.hz} Hz`, GREY)
        head.status.set(`Input shaping · ${SHAPERS[q.kind].name}${q.kind === 'none' ? '' : ` at ${q.hz} Hz`}`)
        head.sub.set(`slowed about ${Math.round(IS.lapse / (RING_RUN.seconds + 0.03))}× · toolhead swing drawn ×${IS.mag}`, GREY)
        head.event.set(tau < 0 ? 'cruising toward the corner' : tau < brake ? 'braking: the frame flexes' : V.residual < 0.1 ? 'shaped: the swing cancels out' : 'past the corner: still ringing', tau < brake ? HEAT : V.residual < 0.1 ? POWER : RING)
      },
      readouts: (p) => {
        const { V } = isRun(p)
        return [
          { label: 'Ringing left', value: pct(V.residual), tone: toneOf(V.residual < 0.1, V.residual < 0.4) },
          { label: 'Ripple depth', value: umText(V.ringMm) },
          { label: 'Shaper delay', value: msText(V.delayS, 1) },
        ]
      },
    }
  },
}
