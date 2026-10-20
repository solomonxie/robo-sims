// Smart plant monitor: a soil-moisture probe on the ESP32 ADC (resistive vs capacitive, corrosion, calibration),
// then a 5 V pump on a low-side switch watering a pot for two weeks (run-until-wet vs dose-and-soak vs timer, tank alerts).
import { clamp, once } from '../common'
import { DcMotor, motorAmps, motorRpm } from '../actuators/dcmotor'
import { CentrifugalPump, centrifugalLpm, doseSeconds } from '../actuators/pumps'
import { SRD_05, coilAmps } from '../electromechanical'
import { GPIO_VDD } from '../mcu/gpio'
import { adcReadable, esp32Raw } from '../mcu/adc'
import { MOSFETS, Mosfet, mosfetDrain } from '../semiconductors'

// --- Moisture probe ---

/** Potting mix, volumetric water content θ: a dry pot (plant wilting), just watered and drained (field capacity), saturated. */
export const PLANT_SOIL = { dryTheta: 0.08, fcTheta: 0.35, satTheta: 0.45 }
/** Topp's equation (inverse form): soil permittivity from θ. Air 1, water 80. */
export const toppEps = (theta: number) => 3.03 + 9.3 * theta + 146 * theta ** 2 - 76.7 * theta ** 3
/** Relative permittivity of air and water. */
export const PLANT_EPS = { air: 1, water: 80 }

/** Capacitive v1.2 board: the probe's capacitance (stray + field × ε, relative to its reference) pulls a ~3 V signal down.
 *  Fitted to a typical board on 3.3 V: 2.7 V in air, 1.25 V in water. */
export const PLANT_CAP = { vTop: 3, cPar: 0.0948, cField: 0.0163 }
export const plantCapVolts = (eps: number) => PLANT_CAP.vTop / (1 + PLANT_CAP.cPar + PLANT_CAP.cField * eps)

/** Resistive fork (YL-69): soil between the tines, 10 kΩ to 3.3 V on the module; 10 kΩ at field capacity, ∝ θ⁻². */
export const PLANT_FORK = { seriesOhms: 10e3, fcOhms: 10e3, exp: 2, waterOhms: 1e3, readS: 0.01, copperMg: 62.7, failShare: 0.5, dissolveShare: 0.3 }
export const plantForkOhms = (theta: number) => PLANT_FORK.fcOhms * (PLANT_SOIL.fcTheta / Math.max(theta, 1e-3)) ** PLANT_FORK.exp
export const plantForkVolts = (ohms: number) => (GPIO_VDD * ohms) / (ohms + PLANT_FORK.seriesOhms)

export const PLANT_PROBES = {
  fork: { name: 'Resistive fork, always on', kind: 'fork' as const, pulsed: false },
  pulsed: { name: 'Fork, GPIO-powered 10 ms a read', kind: 'fork' as const, pulsed: true },
  cap: { name: 'Capacitive v1.2', kind: 'cap' as const, pulsed: false },
}
export type PlantProbe = keyof typeof PLANT_PROBES
export type PlantMedium = number | 'air' | 'water'

/** Probe output for soil at θ, or in air / a glass of water. */
export function plantProbeVolts(probe: PlantProbe, m: PlantMedium) {
  if (PLANT_PROBES[probe].kind === 'cap') return plantCapVolts(m === 'air' ? PLANT_EPS.air : m === 'water' ? PLANT_EPS.water : toppEps(m))
  return m === 'air' ? GPIO_VDD : plantForkVolts(m === 'water' ? PLANT_FORK.waterOhms : plantForkOhms(m))
}

export const PLANT_PINS = {
  adc1: { name: 'GPIO 34 (ADC1)', unit: 1 as const },
  adc2: { name: 'GPIO 4 (ADC2)', unit: 2 as const },
}
export type PlantPin = keyof typeof PLANT_PINS
export const PLANT_CALS = {
  air: { name: 'Calibrate in air / water', dry: 'air' as PlantMedium, wet: 'water' as PlantMedium },
  soil: { name: 'Calibrate dry pot / watered', dry: PLANT_SOIL.dryTheta as PlantMedium, wet: PLANT_SOIL.fcTheta as PlantMedium },
}
export type PlantCal = keyof typeof PLANT_CALS

/** 11 dB attenuation, like analogRead() by default. */
export const plantProbeRaw = (probe: PlantProbe, m: PlantMedium) => esp32Raw(plantProbeVolts(probe, m), '11')
/** Where θ sits between a dry pot (0) and field capacity (1): what the plant cares about. */
export const plantSoilPct = (theta: number) => (theta - PLANT_SOIL.dryTheta) / (PLANT_SOIL.fcTheta - PLANT_SOIL.dryTheta)
/** Arduino map() + constrain(): raw between the dry and wet calibration readings → 0…1. */
export const plantCalPct = (raw: number, dryRaw: number, wetRaw: number) => (dryRaw === wetRaw ? 0 : clamp((dryRaw - raw) / (dryRaw - wetRaw), 0, 1))

const COPPER_MG_PER_C = (63.55 / (2 * 96485)) * 1000
/** Days until DC through a fork eats half the anode tine's copper (Faraday; ~30 % of the current dissolves copper, the rest splits
 *  water). Infinity for the capacitive probe: its plates are under solder mask, no DC in the soil. */
export function plantForkLife(probe: PlantProbe, theta: number, everyS: number) {
  const p = PLANT_PROBES[probe]
  if (p.kind === 'cap') return { amps: 0, duty: 0, mgPerDay: 0, days: Infinity }
  const amps = GPIO_VDD / (plantForkOhms(theta) + PLANT_FORK.seriesOhms)
  const duty = p.pulsed ? PLANT_FORK.readS / everyS : 1
  const mgPerDay = amps * duty * 86400 * PLANT_FORK.dissolveShare * COPPER_MG_PER_C
  return { amps, duty, mgPerDay, days: (PLANT_FORK.copperMg * PLANT_FORK.failShare) / mgPerDay }
}

/** One read: volts, raw (null on ADC2 with Wi-Fi on), the two calibration readings, % shown vs true, probe life. */
export function plantProbe(probe: PlantProbe, theta: number, pin: PlantPin, cal: PlantCal, everyS = 600) {
  const volts = plantProbeVolts(probe, theta)
  const readable = adcReadable(PLANT_PINS[pin].unit, true)
  const raw = readable ? plantProbeRaw(probe, theta) : null
  const dryRaw = plantProbeRaw(probe, PLANT_CALS[cal].dry)
  const wetRaw = plantProbeRaw(probe, PLANT_CALS[cal].wet)
  const pct = raw === null ? null : plantCalPct(raw, dryRaw, wetRaw)
  const truePct = clamp(plantSoilPct(theta), 0, 1)
  return { volts, readable, raw, dryRaw, wetRaw, pct, truePct, err: pct === null ? null : pct - truePct, life: plantForkLife(probe, theta, everyS) }
}

// --- Pump control ---

/** 5 V mini submersible pump: small brushed motor (no-load current = its in-water load) on a 14 mm impeller, 1.6 L/min free. */
export const PLANT_PUMP_MOTOR: DcMotor = { ohms: 6, noLoadA: 0.18, voltsPerRpm: 0.000784 }
export const PLANT_PUMP: CentrifugalPump = { impellerM: 0.007, psi: 0.5, maxRpm: 5000, maxLpm: 1.6 }
/** USB 5 V, gate from a 3.3 V pin, the pot 30 cm above the tank. */
export const PLANT_RIG = { supplyV: 5, gateV: GPIO_VDD, liftM: 0.3 }

export const PLANT_DRIVERS = {
  irlz: { name: 'IRLZ44N (logic-level)', fet: MOSFETS.IRLZ44N as Mosfet | null },
  irfz: { name: 'IRFZ44N, this one Vth 3.6 V', fet: { ...MOSFETS.IRFZ44N, vthV: 3.6 } as Mosfet | null },
  relay: { name: 'Relay module (SRD-05)', fet: null as Mosfet | null },
}
export type PlantDriver = keyof typeof PLANT_DRIVERS

/** Steady pump: switch drop (FET operating point by bisection on Vds, or relay contacts), pump volts, current, rpm, flow. */
export function plantPumpDrive(driver: PlantDriver, rig = PLANT_RIG) {
  const fet = PLANT_DRIVERS[driver].fet
  let switchV: number
  let extraA = 0
  if (fet) {
    let lo = 0
    let hi = rig.supplyV
    for (let i = 0; i < 60; i++) {
      const v = (lo + hi) / 2
      if (mosfetDrain(rig.gateV, v, fet).amps < motorAmps(rig.supplyV - v, PLANT_PUMP_MOTOR)) lo = v
      else hi = v
    }
    switchV = (lo + hi) / 2
  } else {
    switchV = motorAmps(rig.supplyV, PLANT_PUMP_MOTOR) * SRD_05.contactOhms
    extraA = coilAmps(rig.supplyV, SRD_05)
  }
  const pumpV = rig.supplyV - switchV
  const amps = motorAmps(pumpV, PLANT_PUMP_MOTOR)
  const rpm = motorRpm(pumpV, PLANT_PUMP_MOTOR)
  const lpm = centrifugalLpm(rpm, rig.liftM, true, PLANT_PUMP)
  return { switchV, pumpV, amps, extraA, rpm, lpm, mlPerS: (lpm * 1000) / 60, switchW: switchV * amps }
}

/** 2 L pot of mix, the capacitive probe calibrated in soil; water takes ~5 min to reach the probe; the plant drinks 100 mL a
 *  day by daylight, 2.5× in a heatwave (days 7–11), less as the soil dries. Two weeks. */
export const PLANT_POT = { soilMl: 2000, theta0: 0.25, soakS: 300, etMlDay: 100, heatFrom: 7, heatTo: 11, heatK: 2.5, days: 14 }
/** Thresholds and doses (probe %). */
export const PLANT_CTRL = { lowPct: 0.3, wetPct: 0.6, alertPct: 0.15, doseMl: 150, soakS: 1800, risePct: 0.05, retryS: 6 * 3600, timerMl: 100, timerH: 8, checkS: 10, pumpDt: 0.5 }

export const PLANT_STRATEGIES = {
  until: { name: 'Pump until it reads wet' },
  dose: { name: 'Dose 150 mL, soak, re-check' },
  timer: { name: 'Timer: 100 mL at 8:00' },
}
export type PlantStrategy = keyof typeof PLANT_STRATEGIES
export const PLANT_TANKS = { '1000': '1 L tank', '3000': '3 L tank' }

/** Plant water use (mL/s) at hour t: daylight half-sine averaging `etMlDay`, heatwave factor, and drought stress. */
export function plantEt(tH: number, theta: number, pot = PLANT_POT) {
  const h = ((tH % 24) + 24) % 24
  const sun = Math.max(0, Math.sin((Math.PI * (h - 6)) / 12)) * Math.PI
  const day = tH / 24
  const heat = day >= pot.heatFrom && day < pot.heatTo ? pot.heatK : 1
  const stress = clamp((theta - PLANT_SOIL.dryTheta) / (0.5 * (PLANT_SOIL.fcTheta - PLANT_SOIL.dryTheta)), 0, 1)
  return (pot.etMlDay / 86400) * sun * heat * stress
}

/** Flow measured on the bench with the logic-level FET: the firmware turns a dose (mL) into pump seconds with it. */
export const plantBenchMlS = once(() => plantPumpDrive('irlz').mlPerS)

export interface PlantCfg {
  driver: PlantDriver
  strategy: PlantStrategy
  tankMl: number
}
export interface PlantSample {
  t: number
  truePct: number
  readPct: number
  tankMl: number
  pumping: boolean
  /** Total run out of the drain hole so far, mL. */
  drainedMl: number
}
export type PlantAlert = { t: number; kind: 'dry' | 'tank' }

/** Two weeks of the pot: probe read every 10 s (every 0.5 s while pumping), the strategy switches the pump, water soaks down
 *  to the probe, anything over field capacity runs out the drain hole. Samples every 10 min. */
export function plantRun(cfg: PlantCfg, pot = PLANT_POT, ctrl = PLANT_CTRL) {
  const pump = plantPumpDrive(cfg.driver)
  const fcMl = PLANT_SOIL.fcTheta * pot.soilMl
  const end = pot.days * 86400
  const dryRaw = plantProbeRaw('cap', PLANT_CALS.soil.dry)
  const wetRaw = plantProbeRaw('cap', PLANT_CALS.soil.wet)
  const read = (w: number) => plantCalPct(plantProbeRaw('cap', w / pot.soilMl), dryRaw, wetRaw)
  const doseS = (ml: number) => doseSeconds(ml, plantBenchMlS() * 60)
  let soil = pot.theta0 * pot.soilMl
  let pending = 0
  let tank = cfg.tankMl
  let t = 0
  let on = false
  let doseLeft = 0
  let soakUntil = -1
  let before = 0
  let retryAt = 0
  let lastTimerDay = -1
  let dryAlertDay = -1
  let pumped = 0
  let drained = 0
  let dryRunS = 0
  let dryS = 0
  let tankEmptyH: number | null = null
  let nextSample = 0
  let pumpedSince = false
  const samples: PlantSample[] = []
  const alerts: PlantAlert[] = []
  const events: { t: number; ml: number }[] = []
  let pct = read(soil)
  while (t <= end) {
    if (t >= nextSample) {
      samples.push({ t: t / 3600, truePct: plantSoilPct(soil / pot.soilMl), readPct: pct, tankMl: tank, pumping: on || pumpedSince, drainedMl: drained })
      pumpedSince = false
      nextSample += 600
    }
    pct = read(soil)
    const day = Math.floor(t / 86400)
    if (pct < ctrl.alertPct && day !== dryAlertDay) {
      dryAlertDay = day
      alerts.push({ t: t / 3600, kind: 'dry' })
    }
    const wasOn = on
    if (cfg.strategy === 'until') on = on ? pct < ctrl.wetPct : pct < ctrl.lowPct
    else if (cfg.strategy === 'dose') {
      if (doseLeft > 0) on = true
      else {
        on = false
        if (soakUntil >= 0 && t >= soakUntil) {
          soakUntil = -1
          if (pct - before < ctrl.risePct) {
            alerts.push({ t: t / 3600, kind: 'tank' })
            retryAt = t + ctrl.retryS
          }
        }
        if (soakUntil < 0 && t >= retryAt && pct < ctrl.lowPct) {
          before = pct
          doseLeft = doseS(ctrl.doseMl)
          soakUntil = t + doseLeft + ctrl.soakS
          on = true
        }
      }
    } else {
      const hour = (t / 3600) % 24
      if (doseLeft > 0) on = true
      else {
        on = false
        if (hour >= ctrl.timerH && day !== lastTimerDay) {
          lastTimerDay = day
          doseLeft = doseS(ctrl.timerMl)
          on = true
        }
      }
    }
    if (on && !wasOn) events.push({ t: t / 3600, ml: 0 })
    const spinning = on && pump.rpm > 0
    const flowing = spinning && tank > 0 && pump.mlPerS > 0
    const dt = flowing ? ctrl.pumpDt : ctrl.checkS
    if (on) {
      pumpedSince = true
      const runS = doseLeft > 0 ? Math.min(dt, doseLeft) : dt
      const ml = flowing ? Math.min(tank, pump.mlPerS * runS) : 0
      tank -= ml
      pending += ml
      pumped += ml
      if (events.length) events[events.length - 1].ml += ml
      if (spinning && tank <= 0) dryRunS += runS
      if (tank <= 0 && tankEmptyH === null) tankEmptyH = t / 3600
      doseLeft = Math.max(0, doseLeft - dt)
    }
    const inflow = pending * -Math.expm1(-dt / pot.soakS)
    pending -= inflow
    soil += inflow - plantEt(t / 3600, soil / pot.soilMl, pot) * dt
    if (soil > fcMl) {
      drained += soil - fcMl
      soil = fcMl
    }
    if (plantSoilPct(soil / pot.soilMl) < ctrl.alertPct) dryS += dt
    t += dt
  }
  return {
    pump,
    samples,
    alerts,
    events,
    pumpedMl: pumped,
    drainedMl: drained,
    dryRunH: dryRunS / 3600,
    dryH: dryS / 3600,
    tankEmptyH,
    tankAlertH: alerts.find((a) => a.kind === 'tank')?.t ?? null,
    dryAlertH: alerts.find((a) => a.kind === 'dry')?.t ?? null,
  }
}
