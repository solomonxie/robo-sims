import * as THREE from 'three/webgpu'
import {
  CALIBRATED,
  DRIVE_TASK,
  DriveConditions,
  DriveFrame,
  Pose,
  ROLL_FLOORS,
  calibratedDistance,
  closedLoopRun,
  fixedStepAt,
  openLoopRun,
  pDeadband,
  stallDuty,
  trialConditions,
  wheelSpeedSs,
} from '../../core/physics'
import { pct, signed } from '../../core/units'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  SIDE_SCOPE,
  controlLoop,
  cursorBar,
  diffBot,
  flatBox,
  floorMat,
  floorView,
  glowMat,
  liveLabel,
  memoBy,
  pointCloud,
  scope,
  scopeLabels,
  statusHeader,
  traceRun,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const D = calibratedDistance()
const metres = (m: number) => `${m.toFixed(2)} m`
const cm = (m: number) => `${Math.abs(m * 100) < 10 ? Math.abs(m * 100).toFixed(1) : Math.round(Math.abs(m * 100))} cm`
const FLOOR_OPTS = Object.fromEntries(Object.entries(ROLL_FLOORS).map(([k, f]) => [k, f.name])) as Record<keyof typeof ROLL_FLOORS, string>
const VIEW = { center: [-2.2, -1.3, 0] as V3, radius: 54, polar: 1.45, azimuth: 0 }
const RIG = { at: [-15.6, -3.2, 0] as V3, k: 10, robotK: 1.4, fx: [-0.15, 1.3] as [number, number], fy: [-0.32, 0.32] as [number, number], every: 8 }
const DIAG = { at: [SIDE_SCOPE.x, 2.4, 0] as V3, w: 12.5, h: 3.6 }
const conditionsText = (c: DriveConditions, floor: string) => `${c.volts.toFixed(1)} V pack · ${floor}${c.payloadKg > 0 ? ` · +${Math.round(c.payloadKg * 1000)} g` : ''}`

/** Tilted floor in metres with the tuned stopping line at `D`; robot and a trail cloud for `trails` runs. */
function trackRig(scene: THREE.Object3D, trails: number, steps: number) {
  const g = floorView(scene, RIG.at, RIG.k, -0.6)
  floorMat(g, RIG.fx, RIG.fy)
  flatBox(g, [0.012, RIG.fy[1] - RIG.fy[0], 0.004], glowMat(B_FIELD, 1), [D, 0, 0.004])
  flatBox(g, [0.012, RIG.fy[1] - RIG.fy[0], 0.004], glowMat(GREY, 0.5), [0, 0, 0.004])
  const tag = liveLabel(g, [D, RIG.fy[1] + 0.06, 0.01], { size: 0.045, color: B_FIELD })
  tag.set(`target ${metres(D)}`, B_FIELD)
  liveLabel(g, [0, RIG.fy[1] + 0.06, 0.01], { size: 0.04, color: GREY }).set('start', GREY)
  const dots = pointCloud(g, trails * steps, 0.0045)
  const bot = diffBot(g)
  bot.group.scale.setScalar(RIG.robotK)
  return {
    g,
    bot,
    /** Trail of run `k` up to frame `upTo`. */
    trail(k: number, run: DriveFrame[], upTo: number, color: string) {
      for (let j = 0; j < steps; j++) {
        const f = run[Math.min(upTo, j * RIG.every)]
        dots.set(k * steps + j, [f.pose.x, f.pose.y, 0.004], color)
      }
    },
    show: (count: number) => dots.show(count * steps),
  }
}
const place = (bot: ReturnType<typeof diffBot>, f: DriveFrame) => bot.set(f.pose as Pose, f.dL, f.dR)

// --- Dead reckoning drift: "drive 2 s at 60 %" tuned on a full pack lands somewhere else on every run once the pack, load or floor change. ---

const DR = { runs: 6, total: DRIVE_TASK.seconds + 0.8, hold: 0.5, rest: 2.5, sy: -4.4, sh: 4.6, vTop: 0.8 }
const drParams = (p: Params) => {
  const floor = pick(ROLL_FLOORS, p.floor, 'tile')
  const c: DriveConditions = { volts: n(p, 'battery'), payloadKg: n(p, 'payload') / 1000, crr: ROLL_FLOORS[floor].crr, mismatch: 0 }
  return { c, floor: ROLL_FLOORS[floor].name }
}
type DrQ = ReturnType<typeof drParams>
const drKey = (q: DrQ) => `${q.c.volts}|${q.c.payloadKg}|${q.c.crr}`
const drRuns = memoBy(drKey, (q: DrQ) => Array.from({ length: DR.runs }, (_, k) => openLoopRun(trialConditions(q.c, k), D, DR.total)))
const drSteps = Math.ceil(DR.total / DRIVE_TASK.dt / RIG.every) + 1
const landings = (runs: DriveFrame[][]) => runs.map((r) => r.at(-1)!.pose)
const vMean = (f: DriveFrame) => (f.vL + f.vR) / 2

export const deadReckoningDrift: Lesson = {
  id: 'open-vs-closed-loop-dead-reckoning-drift',
  title: 'Dead reckoning drift',
  tagline: 'A timed move tuned once lands somewhere else every time',
  formula: (p) => {
    const q = drParams(p)
    const v = wheelSpeedSs(DRIVE_TASK.duty * q.c.volts, q.c.payloadKg, q.c.crr)
    const v0 = wheelSpeedSs(DRIVE_TASK.duty * CALIBRATED.volts, 0, CALIBRATED.crr)
    return `x = ∫v dt ≈ v·2 s + coast · v = f(60 % × ${q.c.volts.toFixed(1)} V, load, floor) = ${v.toFixed(2)} m/s vs ${v0.toFixed(2)} m/s when tuned · nothing measures x, so nothing corrects it`
  },
  legend: [
    { color: B_FIELD, label: 'Target: where the move landed when tuned', shape: 'dot' },
    { color: RING, label: 'This run: path, speed (scope), landing', shape: 'dot' },
    { color: GREY, label: 'Earlier runs; disturbances into the plant', shape: 'dot' },
    { color: POWER, label: 'Motor command u (60 % for 2 s)', shape: 'dot' },
  ],
  points: [
    'Open loop means acting without looking: the code says "both motors 60 % for 2 s, then stop" and never checks where the robot went. Tuned on a full pack, on tile, with nothing on board, it stops on the blue line (1.1 m) — on that day.',
    'Distance is the area under the speed curve, and speed depends on everything the code cannot see. A DC motor\'s speed follows its voltage, and 60 % of a sagging pack is fewer volts: 7.4 V instead of 8.4 V costs about 15 % of the distance. Carpet and payload add rolling drag, so the motor settles slower still.',
    'Even with nothing changed, every run differs: the pack sits ±0.1 V from run to run, the floor varies, and two "identical" TT motors differ by a few percent, so one wheel outruns the other and the robot curves off sideways. The landings scatter in a cloud, and repeating the move adds the errors up.',
    'That is dead reckoning: position from commands (or from wheel ticks, see Odometry) with no outside check, so the error only grows. The fix is to measure the thing you care about and steer by the difference — closing the loop (next lesson).',
  ],
  controls: [
    { kind: 'slider', key: 'battery', label: 'Pack voltage', min: 6.4, max: 8.4, step: 0.1, initial: 7.4, format: (v) => `${v.toFixed(1)} V` },
    { kind: 'slider', key: 'payload', label: 'Payload', min: 0, max: 1000, step: 100, initial: 0, format: (v) => `${v} g` },
    { kind: 'choice', key: 'floor', options: opts(FLOOR_OPTS), initial: 'tile' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const rig = trackRig(scene, DR.runs, drSteps)
    const landDots = pointCloud(rig.g, DR.runs, 0.014)
    const loop = controlLoop(scene, DIAG.at, { ctrl: 'timer', plant: 'motors', sensor: 'encoder', feedback: false, disturb: true, w: DIAG.w, h: DIAG.h })

    const plot = scope(scene, SIDE_SCOPE.w, DR.sh, { divs: [7, 4], zeroAt: 0.1 })
    plot.group.position.set(SIDE_SCOPE.x, DR.sy, 0)
    const old = Array.from({ length: DR.runs }, () => plot.trace(GREY, { samples: 140, radius: 0.05 }))
    const cur = plot.trace(RING, { samples: 140, radius: 0.08 })
    cursorBar(plot, POWER, 0.05)(DRIVE_TASK.seconds / DR.total)
    scopeLabels(scene, DR.sy, DR.sh, null, `speed · top line ${DR.vTop} m/s`, 'motors off ↓')
    const yV = (v: number) => -DR.sh * 0.4 + (v / DR.vTop) * DR.sh * 0.9

    const st = { key: '', t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = drParams(p)
        const runs = drRuns(q)
        const per = DR.total + DR.hold
        const cycle = DR.runs * per + DR.rest
        if (drKey(q) !== st.key) {
          st.key = drKey(q)
          st.t = 0
          old.forEach((tr) => tr.points([], []))
        }
        st.t = (st.t + dt) % cycle
        const k = Math.min(DR.runs - 1, Math.floor(st.t / per))
        const t = Math.min(DR.total, st.t - k * per)
        const run = runs[k]
        const i = Math.round(t / DRIVE_TASK.dt)
        const f = fixedStepAt(run, t, DRIVE_TASK.dt)
        const landed = t >= DR.total
        const resting = st.t >= DR.runs * per
        place(rig.bot, f)
        rig.bot.group.visible = !resting
        for (let j = 0; j < k; j++) rig.trail(j, runs[j], run.length, GREY)
        rig.trail(k, run, i, RING)
        rig.show(k + 1)
        const lands = landings(runs)
        const shown = k + (landed ? 1 : 0)
        lands.forEach((l, j) => landDots.set(j, [l.x, l.y, 0.01], j === k ? RING : LABEL))
        landDots.show(shown)
        old.forEach((tr, j) => (j < k ? traceRun(tr, runs[j], DRIVE_TASK.dt, DR.total, DR.total, (g) => yV(vMean(g)), 140) : tr.points([], [])))
        traceRun(cur, run, DRIVE_TASK.dt, DR.total, t, (g) => yV(vMean(g)), 140)

        const c = trialConditions(q.c, k)
        const on = f.uL > 0
        const v = vMean(f)
        loop.set(dt, { r: on ? 1 : 0, u: f.uL, y: v / 0.6, d: Math.min(1, (CALIBRATED.volts - q.c.volts) / 2 + q.c.payloadKg + q.c.crr * 4) }, {
          r: on ? '2 s × 60 %' : 'done',
          u: `u ${pct(f.uL)}`,
          y: `x ${metres(f.pose.x)}`,
          d: conditionsText(c, q.floor),
        })
        status.set(`${resting ? `All ${DR.runs} runs` : `Run ${k + 1} of ${DR.runs}`} · "drive 2 s at 60 %, stop"`, LABEL)
        const miss = f.pose.x - D
        if (resting) {
          const xs = landings(runs).map((l) => l.x)
          event.set(`${DR.runs} runs landed ${metres(Math.min(...xs))} to ${metres(Math.max(...xs))}: same code, ${cm(Math.max(...xs) - Math.min(...xs))} apart`, HIGH_V)
        } else if (landed) event.set(`landed ${metres(f.pose.x)}: ${cm(miss)} ${miss < 0 ? 'short' : 'long'}, ${cm(f.pose.y)} ${f.pose.y > 0 ? 'left' : 'right'}`, Math.abs(miss) < 0.03 ? POWER : HIGH_V)
        else if (on) event.set(`motors 60 % of ${c.volts.toFixed(2)} V = ${(0.6 * c.volts).toFixed(2)} V · ${v.toFixed(2)} m/s`, POWER)
        else event.set(`motors off: braking from ${v.toFixed(2)} m/s`, HEAT)
        sub.set(`${t.toFixed(2)} / ${DR.total.toFixed(1)} s · real time · this run: motors ${signed(c.mismatch * 100)} % right vs left`)
      },
      readouts: (p) => {
        const q = drParams(p)
        const ls = landings(drRuns(q))
        const xs = ls.map((l) => l.x)
        const ys = ls.map((l) => l.y)
        const mean = xs.reduce((a, b) => a + b, 0) / xs.length
        return [
          { label: 'Tuned: full pack, tile, no load', value: metres(D) },
          { label: 'Mean landing now', value: `${metres(mean)} (${signed((mean - D) * 100, 0)} cm)`, tone: Math.abs(mean - D) < 0.03 ? 'ok' : 'bad' },
          { label: `Spread over ${DR.runs} runs: along · across`, value: `${cm(Math.max(...xs) - Math.min(...xs))} · ${cm(Math.max(...ys) - Math.min(...ys))}`, tone: 'warn' },
          { label: 'Cruise speed at 60 %: now · tuned', value: `${wheelSpeedSs(0.6 * q.c.volts, q.c.payloadKg, q.c.crr).toFixed(2)} · ${wheelSpeedSs(0.6 * CALIBRATED.volts, 0, CALIBRATED.crr).toFixed(2)} m/s` },
        ]
      },
    }
  },
}

// --- Closing the loop: encoder distance fed back, u = Kp·(target − measured); reaches the line despite sag, carpet and a shove; noise leaks into u. ---

const CL = { seconds: 4, slow: 0.5, shoveAt: 1.4, sy: -4.4, sh: 4.6, eTop: 1.2 }
const clParams = (p: Params) => {
  const floor = pick(ROLL_FLOORS, p.floor, 'tile')
  const c: DriveConditions = { volts: n(p, 'battery'), payloadKg: 0, crr: ROLL_FLOORS[floor].crr, mismatch: 0.03 }
  return { c, floor: ROLL_FLOORS[floor].name, kp: n(p, 'kp'), noiseM: n(p, 'noise') / 1000, shove: n(p, 'shove') }
}
type ClQ = ReturnType<typeof clParams>
const clKey = (q: ClQ) => `${q.c.volts}|${q.c.crr}|${q.kp}|${q.noiseM}|${q.shove}`
const clRun = memoBy(clKey, (q: ClQ) => ({
  closed: closedLoopRun(q.c, { target: D, kp: q.kp, noiseM: q.noiseM, seconds: CL.seconds, shove: q.shove > 0 ? { at: CL.shoveAt, kick: q.shove } : undefined }),
  open: openLoopRun(q.c, D, CL.seconds),
}))
const settleTime = (run: DriveFrame[], band = 0.05) => {
  let k = run.length - 1
  while (k >= 0 && Math.abs(D - run[k].pose.x) <= band) k--
  return k < run.length - 1 ? run[k + 1].t : null
}

export const closingTheLoop: Lesson = {
  id: 'open-vs-closed-loop-closing-the-loop',
  title: 'Closing the loop',
  tagline: 'Measure the distance, steer by the error',
  formula: (p) => {
    const q = clParams(p)
    return `e = target − measured · u = Kp·e = ${q.kp} %/cm × e, clamped ±100 % · stalls once Kp·e < ${pct(stallDuty(q.c))} → stops ${cm(pDeadband(q.c, q.kp))} short · noise σ ${q.noiseM * 1000} mm → u jitters ±${pct(q.kp * q.noiseM)}`
  },
  legend: [
    { color: B_FIELD, label: 'Target r (blue line)', shape: 'dot' },
    { color: HEAT, label: 'Error e = r − measured (scope ±1.2 m)', shape: 'dot' },
    { color: POWER, label: 'Motor command u (scope ±100 %)', shape: 'dot' },
    { color: GREY, label: 'Ghost: the open-loop 2 s × 60 % move, same floor', shape: 'dot' },
  ],
  points: [
    'Closed loop: measure what you care about and feed it back. Each wheel has a Hall encoder (11 pulses × 4 edges × 1:48 gear ≈ 0.1 mm per tick). Every 20 ms the ESP32 reads both, subtracts the mean travel from the target and sets the motors in proportion: u = Kp·e. Far away it drives flat out; near the line it eases off by itself.',
    'Now a sagging pack, carpet or a shove only change how long it takes, not where it ends: the error keeps the motors on until it is gone. The open-loop ghost under the same conditions stops wherever its 2 s run out. A second term, Kh·(right − left), evens the wheels, so a 3 % motor mismatch no longer curves it.',
    'P alone stops a little short. Once Kp·e falls below the duty that overcomes friction (more on carpet, more with a weak pack) the motors stall with some error left. A bigger Kp shrinks that gap, but makes it surge and overshoot; removing the rest is the job of the I in PID (see PID).',
    'Feedback also feeds back the sensor\'s faults. Encoder jitter (here σ of a few mm, e.g. a wobbly wheel) goes straight into u, multiplied by Kp: the motors buzz at the target. And encoders count wheel turns, not floor: if a wheel slips, the loop happily reaches the wrong spot (see Odometry, Slip).',
  ],
  controls: [
    { kind: 'slider', key: 'kp', label: 'Kp', min: 1, max: 20, step: 1, initial: 5, format: (v) => `${v} %/cm` },
    { kind: 'slider', key: 'noise', label: 'Encoder noise σ', min: 0, max: 5, step: 0.5, initial: 1, format: (v) => `${v.toFixed(1)} mm` },
    { kind: 'slider', key: 'battery', label: 'Pack voltage', min: 6.4, max: 8.4, step: 0.1, initial: 7, format: (v) => `${v.toFixed(1)} V` },
    { kind: 'slider', key: 'shove', label: 'Shove back at 1.4 s', min: 0, max: 0.5, step: 0.05, initial: 0.3, format: (v) => `${v.toFixed(2)} m/s` },
    { kind: 'choice', key: 'floor', options: opts(FLOOR_OPTS), initial: 'carpet' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const steps = Math.ceil(CL.seconds / DRIVE_TASK.dt / RIG.every) + 1
    const rig = trackRig(scene, 2, steps)
    const ghost = diffBot(rig.g, { ghost: GREY })
    ghost.group.scale.setScalar(RIG.robotK)
    const loop = controlLoop(scene, DIAG.at, { ctrl: 'P: Kp·e', plant: 'motors', sensor: 'encoders', disturb: true, noise: true, w: DIAG.w, h: DIAG.h })

    const plot = scope(scene, SIDE_SCOPE.w, CL.sh, { divs: [8, 4] })
    plot.group.position.set(SIDE_SCOPE.x, CL.sy, 0)
    const uTr = plot.trace(POWER, { samples: 400, radius: 0.05 })
    const eTr = plot.trace(HEAT, { samples: 200, radius: 0.08 })
    const shoveBar = cursorBar(plot, HIGH_V, 0.05)
    scopeLabels(scene, CL.sy, CL.sh, CL.seconds, 'error e ±1.2 m', 'command u ±100 %')
    const yE = (e: number) => Math.max(-1, Math.min(1, e / CL.eTop)) * (CL.sh / 2) * 0.95
    const yU = (u: number) => u * (CL.sh / 2) * 0.95

    const st = { key: '', t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = clParams(p)
        const { closed, open } = clRun(q)
        if (clKey(q) !== st.key) {
          st.key = clKey(q)
          st.t = 0
          shoveBar(q.shove > 0 ? CL.shoveAt / CL.seconds : null)
        }
        st.t += dt * CL.slow
        if (st.t > CL.seconds + 0.8) st.t = 0
        const t = Math.min(st.t, CL.seconds)
        const i = Math.round(t / DRIVE_TASK.dt)
        const f = fixedStepAt(closed, t, DRIVE_TASK.dt)
        const g = fixedStepAt(open, t, DRIVE_TASK.dt)
        place(rig.bot, f)
        ghost.set(g.pose as Pose)
        rig.trail(0, open, i, GREY)
        rig.trail(1, closed, i, RING)
        rig.show(2)
        traceRun(eTr, closed, DRIVE_TASK.dt, CL.seconds, t, (h) => yE(h.err))
        traceRun(uTr, closed, DRIVE_TASK.dt, CL.seconds, t, (h) => yU((h.uL + h.uR) / 2), 400)

        const u = (f.uL + f.uR) / 2
        const pushed = q.shove > 0 && t >= CL.shoveAt && t < CL.shoveAt + 0.25
        loop.set(dt, { r: 1, e: f.err / 0.3, u, y: (f.vL + f.vR) / 1.2, m: (f.vL + f.vR) / 1.2, d: pushed ? 1 : 0.3, n: q.noiseM * 300 }, {
          r: metres(D),
          e: `e ${signed(f.err * 100, 1)} cm`,
          u: `u ${pct(u)}`,
          y: `x ${metres(f.pose.x)}`,
          m: `measured ${metres(f.meas)}`,
          d: pushed ? 'shove!' : conditionsText(q.c, q.floor),
          n: q.noiseM > 0 ? `noise σ ${q.noiseM * 1000} mm` : 'no noise',
        })

        status.set(`P loop to ${metres(D)} · ${conditionsText(q.c, q.floor)}`, LABEL)
        const near = Math.abs(f.err) < 0.05
        if (pushed) event.set(`shoved back ${q.shove.toFixed(2)} m/s: error grows, u pushes harder`, HIGH_V)
        else if (near && Math.abs(u) < stallDuty(q.c)) event.set(`stalled ${cm(f.err)} ${f.err > 0 ? 'short' : 'past'}: Kp·e = ${pct(Math.abs(u))} < ${pct(stallDuty(q.c))} to beat friction`, HEAT)
        else if (near) event.set(`at the line: u ${pct(u)} ${q.noiseM > 0 ? 'twitches with sensor noise' : 'settling'}`, POWER)
        else event.set(`e ${cm(f.err)} → u = ${q.kp} %/cm × e = ${pct(u)}${Math.abs(u) >= 0.999 ? ' (clamped)' : ''}`, POWER)
        sub.set(`${t.toFixed(2)} / ${CL.seconds} s · slowed ${1 / CL.slow}× · loop 50 Hz · ghost: open loop ${metres(g.pose.x)}`)
      },
      readouts: (p) => {
        const q = clParams(p)
        const { closed, open } = clRun(q)
        const end = closed.at(-1)!
        const ts = settleTime(closed)
        return [
          { label: 'Closed loop ends', value: `${cm(D - end.pose.x)} ${end.pose.x < D ? 'short' : 'past'}`, tone: Math.abs(D - end.pose.x) < 0.03 ? 'ok' : 'warn' },
          { label: 'Open loop, same conditions', value: `${cm(D - open.at(-1)!.pose.x)} ${open.at(-1)!.pose.x < D ? 'short' : 'past'}`, tone: 'bad' },
          { label: 'Within 5 cm for good after', value: ts === null ? 'never' : `${ts.toFixed(2)} s` },
          { label: 'P stall gap: stall duty / Kp', value: `${pct(stallDuty(q.c))} / ${q.kp} %/cm = ${cm(pDeadband(q.c, q.kp))}` },
        ]
      },
    }
  },
}
