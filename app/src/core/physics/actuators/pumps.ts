// Peristaltic (positive displacement) vs centrifugal pumps: volume per rev, pulsation, dosing, priming.
import { G } from '../common'

export const WATER_KG_M3 = 1000
export const AIR_KG_M3 = 1.2

export interface PeristalticPump {
  /** Tube bore (mm), track radius to the tube centre (mm), rollers, tube length lost under each roller (mm). */
  boreMm: number
  trackMm: number
  rollers: number
  pinchMm: number
}

/** Small 12 V dosing head (Kamoer/Grothen class): 2 mm silicone tube, three rollers. */
export const PERI_PUMP: PeristalticPump = { boreMm: 2, trackMm: 12, rollers: 3, pinchMm: 3 }

export const tubeAreaMm2 = (p: PeristalticPump = PERI_PUMP) => Math.PI * (p.boreMm / 2) ** 2

/** Fluid pushed out per rotor turn: bore area × the track circumference not under a roller, mL. */
export const periMlPerRev = (p: PeristalticPump = PERI_PUMP) => (tubeAreaMm2(p) * (2 * Math.PI * p.trackMm - p.rollers * p.pinchMm)) / 1000

/** Flow = volume per rev × rpm, mL/min. */
export const periFlowMlMin = (rpm: number, p: PeristalticPump = PERI_PUMP) => periMlPerRev(p) * rpm

const RIPPLE = 1.5

/** Instantaneous / mean flow at rotor angle θ: dips each time a roller lifts off the tube (n pulses per turn). */
export const periPulse = (theta: number, p: PeristalticPump = PERI_PUMP) => 1 + (RIPPLE / p.rollers) * Math.cos(p.rollers * theta)

/** Volume delivered after the rotor turns θ from a roller-lift point: the integral of `periPulse`, mL. */
export const periDeliveredMl = (theta: number, p: PeristalticPump = PERI_PUMP) =>
  (periMlPerRev(p) / (2 * Math.PI)) * (theta + (RIPPLE / p.rollers ** 2) * Math.sin(p.rollers * theta))

/** Worst dose error from stopping mid-pulse when the rotor angle itself is exact (a stepper), mL. */
export const periPulseErrorMl = (p: PeristalticPump = PERI_PUMP) => (periMlPerRev(p) * RIPPLE) / (2 * Math.PI * p.rollers ** 2)

export const doseRevs = (doseMl: number, p: PeristalticPump = PERI_PUMP) => doseMl / periMlPerRev(p)
export const doseSteps = (doseMl: number, stepsPerRev: number, p: PeristalticPump = PERI_PUMP) => Math.round(doseRevs(doseMl, p) * stepsPerRev)
export const doseSeconds = (doseMl: number, flowMlMin: number) => (60 * doseMl) / flowMlMin

/** Air to pull out of the inlet tube before liquid arrives, mL. */
export const periPrimeMl = (inletM: number, p: PeristalticPump = PERI_PUMP) => tubeAreaMm2(p) * inletM

/** Suction a squeezed tube can pull (~0.8 bar of vacuum) as a water column, m. */
export const PERI_SUCTION_M = 0.8e5 / (WATER_KG_M3 * G)

/** An open-loop DC gearmotor timed for its 12 V speed, run from a sagging 11 V battery: the fraction of the speed it gets. */
export const DC_SPEED_FRACTION = 0.92

export type DoseDrive = 'stepper' | 'dc'

/** Dose that actually lands: a stepper turns exactly; a timed DC motor runs at `DC_SPEED_FRACTION`; a dry inlet eats the prime. */
export function dosedMl(drive: DoseDrive, doseMl: number, primed: boolean, inletM: number, p: PeristalticPump = PERI_PUMP) {
  const pumped = drive === 'stepper' ? doseMl : doseMl * DC_SPEED_FRACTION
  return Math.max(0, pumped - (primed ? 0 : periPrimeMl(inletM, p)))
}

export interface CentrifugalPump {
  impellerM: number
  /** Head coefficient ψ: Δp = ψ·ρ·u² at the impeller tip speed u. */
  psi: number
  maxRpm: number
  maxLpm: number
}

/** 12 V brushless DC water pump, 30 mm impeller. */
export const CENTRIFUGAL_12V: CentrifugalPump = { impellerM: 0.015, psi: 0.5, maxRpm: 6000, maxLpm: 8 }

export const tipSpeed = (rpm: number, c: CentrifugalPump = CENTRIFUGAL_12V) => (rpm * 2 * Math.PI * c.impellerM) / 60

/** Pressure the impeller makes in `fluidKgM3`, as metres of water it can hold up: ψρu² / ρ_w·g. A pump full of air
 *  (ρ 800× lower) makes 800× less: it can't suck water up its own inlet. */
export const centrifugalHeadM = (rpm: number, fluidKgM3: number, c: CentrifugalPump = CENTRIFUGAL_12V) =>
  (c.psi * fluidKgM3 * tipSpeed(rpm, c) ** 2) / (WATER_KG_M3 * G)

/** Flow at lift `liftM` on the pump curve Q = Q_max·√(1 − h/H) (Q_max ∝ rpm), L/min; 0 past shut-off head. */
export function centrifugalLpm(rpm: number, liftM: number, primed: boolean, c: CentrifugalPump = CENTRIFUGAL_12V) {
  const H = centrifugalHeadM(rpm, primed ? WATER_KG_M3 : AIR_KG_M3, c)
  return liftM >= H ? 0 : c.maxLpm * (rpm / c.maxRpm) * Math.sqrt(1 - liftM / H)
}
