// Push/pull solenoid: plunger force vs gap, low-side drive with peak-and-hold PWM, flyback, coil heat.

import { MU_0 } from '../electromagnetism'
import { DIODES, diodeVolts } from '../semiconductors'

export interface Solenoid {
  volts: number
  ohms: number
  turns: number
  /** Plunger face area (m²), stroke (m), and the iron path folded into an extra gap g₀ (m). */
  areaM2: number
  strokeM: number
  ironGapM: number
  /** Return spring (N) and moving mass (kg). */
  springN: number
  massKg: number
  /** Coil to air (K/W), thermal time constant (s), insulation limit and ambient (°C). */
  rthKW: number
  tauS: number
  maxC: number
  ambientC: number
}

/** 12 V open-frame push/pull solenoid (JF-0730B class): 6 Ω, 8 mm stroke, class A coil. */
export const SOLENOID_12V: Solenoid = {
  volts: 12,
  ohms: 6,
  turns: 1000,
  areaM2: 1e-4,
  strokeM: 8e-3,
  ironGapM: 2e-3,
  springN: 1,
  massKg: 0.015,
  rthKW: 10,
  tauS: 120,
  maxC: 105,
  ambientC: 25,
}

const effGap = (gapM: number, s: Solenoid) => Math.max(0, gapM) + s.ironGapM

/** L = μ₀N²A / (g + g₀): the inductance grows as the plunger closes the gap. */
export const solenoidHenries = (gapM: number, s: Solenoid = SOLENOID_12V) => (MU_0 * s.turns ** 2 * s.areaM2) / effGap(gapM, s)

/** Flux density in the gap, T. */
export const solenoidGapB = (amps: number, gapM: number, s: Solenoid = SOLENOID_12V) => (MU_0 * s.turns * Math.abs(amps)) / effGap(gapM, s)

/** F = ½I²·|dL/dg| = μ₀N²AI² / 2(g + g₀)²: ∝ 1/gap², so it climbs steeply as the plunger seats. */
export const solenoidForceN = (amps: number, gapM: number, s: Solenoid = SOLENOID_12V) =>
  (MU_0 * s.turns ** 2 * s.areaM2 * amps * amps) / (2 * effGap(gapM, s) ** 2)

const ampsForForce = (forceN: number, gapM: number, s: Solenoid) => effGap(gapM, s) * Math.sqrt((2 * forceN) / (MU_0 * s.turns ** 2 * s.areaM2))

/** Current that starts the plunger moving from full stroke against spring + load. */
export const solenoidPullInAmps = (loadN: number, s: Solenoid = SOLENOID_12V) => ampsForForce(s.springN + loadN, s.strokeM, s)

/** Current below which the seated plunger lets go. */
export const solenoidDropOutAmps = (loadN: number, s: Solenoid = SOLENOID_12V) => ampsForForce(s.springN + loadN, 0, s)

export const FREEWHEEL_V = 0.7

/** Average coil current at PWM `duty`, the flyback diode carrying it (and dropping ~0.7 V) through the off-time. */
export function pwmHoldAmps(duty: number, s: Solenoid = SOLENOID_12V) {
  const d = Math.min(1, Math.max(0, duty))
  return Math.max(0, d * s.volts - (1 - d) * FREEWHEEL_V) / s.ohms
}

export const coilWatts = (amps: number, s: Solenoid = SOLENOID_12V) => amps * amps * s.ohms

/** Steady coil temperature held at `watts`: T_amb + P·Rθ. */
export const coilSteadyC = (watts: number, s: Solenoid = SOLENOID_12V) => s.ambientC + watts * s.rthKW

/** Time from cold for the coil to reach its limit at `watts`: −τ·ln(1 − ΔT_max / PRθ); never if it settles below. */
export function coilLimitS(watts: number, s: Solenoid = SOLENOID_12V) {
  const f = (s.maxC - s.ambientC) / (watts * s.rthKW)
  return f >= 1 ? Infinity : -s.tauS * Math.log(1 - f)
}

/** Largest on-fraction (ED) that keeps the average heat within the limit, for cycles short against τ. */
export const maxDutyCycle = (watts: number, s: Solenoid = SOLENOID_12V) => Math.min(1, (s.maxC - s.ambientC) / (watts * s.rthKW))

export type SolenoidDrive = 'full' | 'pwm' | 'peakhold'

export interface SolenoidOpts {
  drive: SolenoidDrive
  holdDuty: number
  loadN: number
  diode: boolean
  pwmHz?: number
  onS?: number
  peakS?: number
  offS?: number
  windowS?: number
  breakdownV?: number
}

export interface SolenoidFrame {
  t: number
  amps: number
  gapM: number
  forceN: number
  /** Drain voltage, highest in the sample interval. */
  drainV: number
  duty: number
}

export const SOLENOID_RUN = { pwmHz: 20e3, onS: 5e-3, peakS: 35e-3, offS: 90e-3, windowS: 120e-3, breakdownV: 55, dt: 1e-6, every: 100 }

/** Gate duty at time t: 0 before on and after off; full during the peak; `holdDuty` afterwards (or throughout for 'pwm'). */
export function solenoidDuty(t: number, o: SolenoidOpts) {
  const { onS = SOLENOID_RUN.onS, peakS = SOLENOID_RUN.peakS, offS = SOLENOID_RUN.offS } = o
  if (t < onS || t >= offS) return 0
  if (o.drive === 'full') return 1
  if (o.drive === 'pwm') return o.holdDuty
  return t < onS + peakS ? 1 : o.holdDuty
}

/** Low-side MOSFET drive of the coil: flux linkage λ = L(g)·I integrates V − IR (so the moving plunger dips the current),
 *  the plunger obeys m·a = F − spring − load between its stops. Off, the coil current flows on through the diode (−Vf) or
 *  drives the drain to the FET's avalanche `breakdownV`. */
export function solenoidRun(o: SolenoidOpts, s: Solenoid = SOLENOID_12V) {
  const { pwmHz = SOLENOID_RUN.pwmHz, windowS = SOLENOID_RUN.windowS, breakdownV = SOLENOID_RUN.breakdownV } = o
  const { dt, every } = SOLENOID_RUN
  let gap = s.strokeM
  let v = 0
  let lambda = 0
  let avalancheJ = 0
  let maxV = 0
  let energyJ = 0
  const out: SolenoidFrame[] = []
  const steps = Math.round(windowS / dt)
  for (let i = 0; i <= steps; i++) {
    const t = i * dt
    const duty = solenoidDuty(t, o)
    const on = duty > 0 && (duty >= 1 || (t * pwmHz) % 1 < duty)
    const L = solenoidHenries(gap, s)
    let amps = lambda / L
    let drain: number
    let coilV: number
    if (on) [drain, coilV] = [0, s.volts]
    else if (amps <= 1e-9) [drain, coilV, amps, lambda] = [s.volts, 0, 0, 0]
    else if (o.diode) {
      const vf = diodeVolts(amps, DIODES['1N4007'])
      ;[drain, coilV] = [s.volts + vf, -vf]
    } else {
      ;[drain, coilV] = [breakdownV, s.volts - breakdownV]
      avalancheJ += breakdownV * amps * dt
    }
    energyJ += amps * amps * s.ohms * dt
    lambda = Math.max(0, lambda + (coilV - amps * s.ohms) * dt)
    const F = solenoidForceN(amps, gap, s)
    v += ((s.springN + o.loadN - F) / s.massKg) * dt
    gap += v * dt
    if (gap <= 0) [gap, v] = [0, 0]
    if (gap >= s.strokeM) [gap, v] = [s.strokeM, 0]
    maxV = Math.max(maxV, drain)
    if (i % every === 0) {
      out.push({ t, amps, gapM: gap, forceN: F, drainV: maxV, duty })
      maxV = 0
    }
  }
  return { frames: out, avalancheJ, heatJ: energyJ }
}

/** Seat and release times, current at the end of the hold, peak drain voltage, and whether it held. */
export function solenoidSummary(run: ReturnType<typeof solenoidRun>, o: SolenoidOpts) {
  const { offS = SOLENOID_RUN.offS } = o
  const f = run.frames
  const seat = f.find((x) => x.gapM <= 0)
  const before = f.filter((x) => x.t < offS)
  const last = before[before.length - 1]
  const lastSeated = [...before].reverse().find((x) => x.gapM <= 0)
  const release = f.find((x) => x.t >= offS && x.gapM > 0)
  return {
    seatS: seat ? seat.t : null,
    held: last.gapM <= 0,
    droppedS: seat && last.gapM > 0 && lastSeated ? lastSeated.t : null,
    releaseS: last.gapM <= 0 && release ? release.t - offS : null,
    holdAmps: last.amps,
    peakAmps: Math.max(...f.map((x) => x.amps)),
    peakDrainV: Math.max(...f.map((x) => x.drainV)),
  }
}
