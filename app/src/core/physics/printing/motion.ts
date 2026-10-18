// Printer motion: homing to endstops, belt vs lead-screw axes, steps/mm and calibration, input shaping (ZV/MZV/EI).
import { G, TAU, gaussRng, parkMiller } from '../common'
import { NEMA17, pullOutNm, rpmToRadS, stepsPerRev } from '../actuators/stepper'
import { NEMA_DETENT_NM, SCREWS, Screw, backDrives, screwEfficiency, screwLeadMm, stepsPerMm, thrustN } from '../actuators/linear'
import { GT2, pitchRadiusMm } from '../materials/belts'

// --- Axes and endstops ---

/** Trigger scatter (1σ) and detection delay per switch, typical. Sensorless stall needs speed, so it skips the slow re-bump. */
export const ENDSTOPS = {
  micro: { name: 'Microswitch', sigmaMm: 0.004, latencyS: 5e-4, sensorless: false },
  optical: { name: 'Optical slot', sigmaMm: 0.0015, latencyS: 5e-5, sensorless: false },
  sensorless: { name: 'Sensorless (stall)', sigmaMm: 0.02, latencyS: 1.5e-3, sensorless: true },
}
export type EndstopKind = keyof typeof ENDSTOPS
/** Soft limits in machine coordinates (mm), the power-on position and homing moves, typical 220 mm bed slinger. */
export const MACHINE = { x: 220, y: 220, z: 250 }
export const HOMING = { start: { x: 140, y: 90, z: 24 }, fastMmS: 50, zFastMmS: 10, backoffMm: 5, zBackoffMm: 2 }
export type Axis3 = 'x' | 'y' | 'z'
export type HomeStep = 'seek' | 'back off' | 'bump' | 'done'

/** Spread (max − min) of trigger points: the delay × approach speed plus ±2σ of switch scatter. */
export const repeatMm = (kind: EndstopKind, bumpMmS: number) => {
  const E = ENDSTOPS[kind]
  return (E.sensorless ? HOMING.fastMmS : bumpMmS) * E.latencyS + 4 * E.sigmaMm
}

/** One trigger error (mm past the true switch point) per trial, seeded. */
export function endstopTrials(kind: EndstopKind, bumpMmS: number, count: number, seed = 7) {
  const E = ENDSTOPS[kind]
  const v = E.sensorless ? HOMING.fastMmS : bumpMmS
  const rng = parkMiller(seed)
  const g = gaussRng(rng)
  return Array.from({ length: count }, () => v * E.latencyS * rng() + E.sigmaMm * g())
}

export interface HomeSeg { axis: Axis3; step: HomeStep; from: number; to: number; t0: number; dur: number }

/** G28 on a bed slinger: X, then Y, then Z; each seeks fast, backs off and re-bumps slowly (sensorless: one fast hit; Z keeps a switch). */
export function homingPlan(kind: EndstopKind, bumpMmS: number) {
  const segs: HomeSeg[] = []
  let t = 0
  const push = (axis: Axis3, step: HomeStep, from: number, to: number, v: number) => {
    const dur = Math.abs(to - from) / v
    segs.push({ axis, step, from, to, t0: t, dur })
    t += dur
  }
  for (const axis of ['x', 'y', 'z'] as Axis3[]) {
    const fast = axis === 'z' ? HOMING.zFastMmS : HOMING.fastMmS
    const back = axis === 'z' ? HOMING.zBackoffMm : HOMING.backoffMm
    push(axis, 'seek', HOMING.start[axis], 0, fast)
    if (ENDSTOPS[kind].sensorless && axis !== 'z') push(axis, 'back off', 0, back, fast)
    else {
      push(axis, 'back off', 0, back, fast)
      push(axis, 'bump', back, 0, Math.min(fast, bumpMmS))
    }
  }
  return { segs, total: t }
}

/** Machine position and the active segment at time t of a homing plan. */
export function homingAt(plan: ReturnType<typeof homingPlan>, t: number) {
  const pos = { ...HOMING.start }
  let seg: HomeSeg | null = null
  for (const s of plan.segs) {
    if (t < s.t0) break
    const u = s.dur > 0 ? Math.min(1, (t - s.t0) / s.dur) : 1
    pos[s.axis] = s.from + (s.to - s.from) * u
    seg = s
  }
  const done = t >= plan.total
  return { pos, seg: done ? null : seg, done }
}

/** A G1 target clipped to the soft limits once homed. */
export const softClip = (axis: Axis3, mm: number) => Math.min(MACHINE[axis], Math.max(0, mm))

// --- Belts vs lead screws ---

export const AXIS_DRIVES = {
  belt: { name: 'GT2 belt, 20T pulley', short: 'belt' },
  t8l8: { name: 'T8 lead screw, 8 mm lead', short: 'T8 lead 8' },
  t8l2: { name: 'T8 lead screw, 2 mm lead', short: 'T8 lead 2' },
}
export type AxisDrive = keyof typeof AXIS_DRIVES
const DRIVE_SCREW: Record<Exclude<AxisDrive, 'belt'>, Screw> = { t8l8: SCREWS.t8l8, t8l2: SCREWS.t8l2 }
const BELT_Z = 20
const BELT_EFF = 0.95
/** Brass-nut backlash, typical; a tensioned belt has none but stretches. */
export const NUT_BACKLASH_MM = 0.08
const BELT_SPAN_M = 0.3

export const driveMmPerRev = (d: AxisDrive) => (d === 'belt' ? BELT_Z * GT2.pitch : screwLeadMm(DRIVE_SCREW[d]))

/** Push (N) a NEMA17 at 24 V and driver current `setA` gets out of the drive at `mmS`. */
export function driveForceN(d: AxisDrive, mmS: number, setA = NEMA17.ratedA) {
  const rpm = (mmS / driveMmPerRev(d)) * 60
  const nm = pullOutNm(rpmToRadS(rpm), setA)
  if (d === 'belt') return (BELT_EFF * nm) / (pitchRadiusMm(BELT_Z) / 1000)
  const s = DRIVE_SCREW[d]
  return thrustN(nm, screwLeadMm(s), screwEfficiency(s))
}

export const DRIVE_SWEEP = Array.from({ length: 61 }, (_, i) => i * 5)

/** Each drive lifting `kg` vertically at `mmS` (16 microsteps): rpm, push, top speed, resolution, holds unpowered, stretch, backlash. */
export function driveView(mmS: number, kg: number) {
  const needN = kg * G * 1.5
  const weightN = kg * G
  const drives = (Object.keys(AXIS_DRIVES) as AxisDrive[]).map((d) => {
    const mmRev = driveMmPerRev(d)
    const forceN = driveForceN(d, mmS)
    const curve = DRIVE_SWEEP.map((v) => driveForceN(d, v))
    let topMmS = 0
    for (let v = 0; v <= 2000; v += 2) if (driveForceN(d, v) >= needN) topMmS = v
    const holds = d === 'belt' ? weightN * (pitchRadiusMm(BELT_Z) / 1000) <= NEMA_DETENT_NM : !backDrives(DRIVE_SCREW[d], weightN)
    return {
      d,
      mmRev,
      rpm: (mmS / mmRev) * 60,
      forceN,
      curve,
      lifts: forceN >= needN,
      topMmS,
      umStep: (mmRev / stepsPerRev(16)) * 1000,
      holds,
      stretchMm: d === 'belt' ? (weightN * BELT_SPAN_M * 1000) / GT2.ea : 0,
      backlashMm: d === 'belt' ? 0 : NUT_BACKLASH_MM,
    }
  })
  return { needN, weightN, drives }
}

// --- Steps per mm ---

export const STEP_DRIVES = {
  gt2_20: { name: 'GT2 belt, 20T pulley', mmRev: 40, screw: false },
  gt2_16: { name: 'GT2 belt, 16T pulley', mmRev: 32, screw: false },
  t8l8: { name: 'T8 screw, 8 mm lead', mmRev: 8, screw: true },
  t8l2: { name: 'T8 screw, 2 mm lead', mmRev: 2, screw: true },
}
export type StepDriveKey = keyof typeof STEP_DRIVES
export const CAL_MM = 100

/** Detent torque pulls the rotor off each microstep by about (detent / holding) electrical rad ÷ 50 teeth: the real accuracy limit. */
export const detentErrMm = (mmRev: number) => (mmRev * (NEMA_DETENT_NM / NEMA17.holdNm)) / NEMA17.teeth / TAU

/** Measure-and-correct: a setting that produced `measured` where `target` was asked becomes old × target / measured. */
export const measureFix = (old: number, target: number, measured: number) => (old * target) / measured

/** Steps/mm from the drive and microsteps; firmware set `errPct` off; a 100 mm move measured and corrected. */
export function stepsView(drive: StepDriveKey, micro: number, errPct: number) {
  const mmRev = STEP_DRIVES[drive].mmRev
  const trueSpm = stepsPerMm(mmRev, micro)
  const fwSpm = trueSpm * (1 + errPct / 100)
  const steps = Math.round(CAL_MM * fwSpm)
  const actualMm = steps / trueSpm
  const fixedSpm = measureFix(fwSpm, CAL_MM, actualMm)
  return { mmRev, micro, trueSpm, fwSpm, steps, actualMm, fixedSpm, fullMm: mmRev / NEMA17.steps, microMm: mmRev / stepsPerRev(micro), accMm: detentErrMm(mmRev) }
}

/** Position error (mm) against a smooth command over `fullSteps` full steps: microstep quantisation plus the detent ripple. */
export function microstepError(mmRev: number, micro: number, fullSteps = 2, samples = 400) {
  const full = mmRev / NEMA17.steps
  const micro_ = full / micro
  const a = detentErrMm(mmRev)
  return Array.from({ length: samples }, (_, i) => {
    const cmd = (i / (samples - 1)) * fullSteps * full
    const k = Math.round(cmd / micro_)
    const at = k * micro_
    return { cmd, err: at + a * Math.sin((TAU * at) / full) - cmd }
  })
}

// --- Input shaping ---

export const SHAPERS = {
  none: { name: 'No shaping' },
  zv: { name: 'ZV' },
  mzv: { name: 'MZV' },
  ei: { name: 'EI' },
}
export type ShaperKind = keyof typeof SHAPERS
/** Design damping (Klipper default) and the real frame's, typical. */
export const SHAPER_ZETA = 0.1
export const FRAME = { hz: 45, zeta: 0.07 }

/** Impulse amplitudes (sum 1) and times (s) of a shaper tuned to `hz` (Klipper's ZV, MZV, EI). */
export function shaperImpulses(kind: ShaperKind, hz: number, zeta = SHAPER_ZETA) {
  const df = Math.sqrt(1 - zeta * zeta)
  const Td = 1 / (hz * df)
  let a: number[]
  let t: number[]
  if (kind === 'zv') {
    const K = Math.exp((-zeta * Math.PI) / df)
    ;[a, t] = [[1, K], [0, 0.5 * Td]]
  } else if (kind === 'mzv') {
    const K = Math.exp((-0.75 * zeta * Math.PI) / df)
    const a1 = 1 - Math.SQRT1_2
    ;[a, t] = [[a1, (Math.SQRT2 - 1) * K, a1 * K * K], [0, 0.375 * Td, 0.75 * Td]]
  } else if (kind === 'ei') {
    const K = Math.exp((-zeta * Math.PI) / df)
    const v = 0.05
    ;[a, t] = [[0.25 * (1 + v), 0.5 * (1 - v) * K, 0.25 * (1 + v) * K * K], [0, 0.5 * Td, Td]]
  } else [a, t] = [[1], [0]]
  const sum = a.reduce((s, x) => s + x, 0)
  return { a: a.map((x) => x / sum), t }
}
export type Impulses = ReturnType<typeof shaperImpulses>

/** Ringing left after the shaped move, as a fraction of the unshaped ringing, on a mode at `hz` with damping `zeta`. */
export function residualVibration(imp: Impulses, hz: number, zeta = FRAME.zeta) {
  const w = TAU * hz
  const wd = w * Math.sqrt(1 - zeta * zeta)
  const tn = imp.t[imp.t.length - 1]
  let c = 0
  let s = 0
  imp.a.forEach((a, i) => {
    const e = a * Math.exp(-zeta * w * (tn - imp.t[i]))
    c += e * Math.cos(wd * imp.t[i])
    s += e * Math.sin(wd * imp.t[i])
  })
  return Math.hypot(c, s)
}

export const RING_RUN = { seconds: 0.16, dt: 1e-4 }
export const SHAPE_SWEEP = Array.from({ length: 141 }, (_, i) => 10 + i)

/** Spring-mass toolhead braking from `mmS` to 0 at `accel` (mm/s²) into a corner, the command shaped by `imp`:
 *  e″ = −ω²e − 2ζωe′ − a_cmd. Returns the lag e (mm) from the start of braking. */
export function ringRun(imp: Impulses, mmS: number, accel: number, hz = FRAME.hz, zeta = FRAME.zeta, { seconds, dt } = RING_RUN) {
  const w = TAU * hz
  const brake = mmS / accel
  let e = 0
  let v = 0
  const out: { t: number; e: number }[] = []
  for (let i = 0; i * dt <= seconds + 1e-12; i++) {
    const t = i * dt
    let a = 0
    for (let j = 0; j < imp.a.length; j++) {
      const u = t - imp.t[j]
      if (u >= 0 && u < brake) a -= accel * imp.a[j]
    }
    out.push({ t, e })
    v += (-w * w * e - 2 * zeta * w * v - a) * dt
    e += v * dt
  }
  return { out, endS: brake + imp.t[imp.t.length - 1] }
}

/** Everything the Input shaping lesson shows: impulses, lag run (and unshaped), ringing after the corner, residual sweep. */
export function shaperView(kind: ShaperKind, tunedHz: number, mmS: number, accel: number) {
  const imp = shaperImpulses(kind, tunedHz)
  const run = ringRun(imp, mmS, accel)
  const raw = ringRun(shaperImpulses('none', tunedHz), mmS, accel)
  const after = (r: ReturnType<typeof ringRun>) => Math.max(0, ...r.out.filter((f) => f.t > r.endS + 0.005).map((f) => Math.abs(f.e)))
  return {
    imp,
    run,
    raw,
    ringMm: after(run),
    rawMm: after(raw),
    residual: residualVibration(imp, FRAME.hz),
    sweep: SHAPE_SWEEP.map((hz) => residualVibration(imp, hz)),
    delayS: imp.t[imp.t.length - 1],
    rippleMm: mmS / FRAME.hz,
  }
}
