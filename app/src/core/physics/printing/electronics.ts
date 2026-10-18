// Printer electronics: driver and motor heat, pull-out vs speed, heater currents per supply; Marlin vs Klipper MCU load;
// hotend thermistor divider readout, °C per ADC count, faults, cartridge power P = V²/R and PWM hold duty.
import { clamp } from '../common'
import { stepsPerMm } from '../actuators/linear'
import { NEMA17, pullOutNm, radSToRpm, vrefAmps } from '../actuators/stepper'
import { quantize } from '../mcu/adc'
import { filamentArea } from './fdm'
import { GCODE_HEAT } from './gcode'
import { HOTEND, HOTEND_LOSS } from './heaters'

const AMB = GCODE_HEAT.ambient
const K0 = 273.15

// --- Mainboard and drivers ---

/** Typical bed-slinger Y axis: GT2 20T belt, 16 microsteps, 0.08 Nm needed (1 kg bed at 3000 mm/s² + friction, 2× margin). */
export const BOARD = { mmRev: 40, micro: 16, needNm: 0.08, motorKPerW: 10, fetOhm: 0.012, bedW: 200, hotendW: 40, logicA: 0.5, maxMmS: 500 }
/** Bridge on-resistance (high + low side, Ω) and chip-to-air K/W on a stepstick with a small heatsink, typical. */
export const BOARD_DRIVERS = {
  a4988: { name: 'A4988', rdsOhm: 0.75, kPerW: 40, warnC: 110, offC: 150, how: 'Vref trimmer' },
  tmc2209: { name: 'TMC2209', rdsOhm: 0.34, kPerW: 60, warnC: 120, offC: 150, how: 'UART, set in firmware' },
}
export type BoardDriver = keyof typeof BOARD_DRIVERS
const BOARD_SUPPLIES = [12, 24] as const
const BOARD_SPEEDS = Array.from({ length: 51 }, (_, i) => (i * BOARD.maxMmS) / 50)

const radSOf = (mmS: number) => (mmS / BOARD.mmRev) * 2 * Math.PI
/** Pull-out torque (N·m) at `mmS` on the belt axis for `amps` RMS per phase on `volts`. */
const axisPullNm = (mmS: number, amps: number, volts: number) => pullOutNm(radSOf(mmS), amps, volts)

export function boardView(driver: BoardDriver, amps: number, volts: number, mmS: number) {
  const d = BOARD_DRIVERS[driver]
  const spm = stepsPerMm(BOARD.mmRev, BOARD.micro)
  const driverW = 2 * amps ** 2 * d.rdsOhm
  const driverC = AMB + driverW * d.kPerW
  const off = driverC >= d.offC
  const motorW = off ? 0 : 2 * amps ** 2 * NEMA17.ohms
  const pullNm = off ? 0 : axisPullNm(mmS, amps, volts)
  const curves = BOARD_SUPPLIES.map((v) => BOARD_SPEEDS.map((s) => axisPullNm(s, amps, v)))
  let topMmS = 0
  for (const s of BOARD_SPEEDS) if (axisPullNm(s, amps, volts) >= BOARD.needNm) topMmS = s
  const bedA = BOARD.bedW / volts
  const hotA = BOARD.hotendW / volts
  return {
    spm,
    stepHz: mmS * spm,
    rpm: radSToRpm(radSOf(mmS)),
    pullNm,
    holdNm: off ? 0 : axisPullNm(0, amps, volts),
    skips: off || pullNm < BOARD.needNm,
    topMmS,
    curves,
    driverW,
    driverC,
    state: off ? ('off' as const) : driverC >= d.warnC ? ('hot' as const) : ('ok' as const),
    motorW,
    motorC: AMB + motorW * BOARD.motorKPerW,
    vref: driver === 'a4988' ? (amps * Math.SQRT2) / vrefAmps('a4988', 1) : null,
    bedA,
    hotA,
    bedFetW: bedA ** 2 * BOARD.fetOhm,
    hotFetW: hotA ** 2 * BOARD.fetOhm,
    psuA: bedA + hotA + (4 * motorW) / volts + BOARD.logicA,
  }
}

// --- Marlin and Klipper ---

/** Where each job runs and its CPU cost (cycles; per G-code line or per step), typical. Klipper's MCU only times steps. */
export const FIRMWARES = {
  marlin8: { name: 'Marlin, 8-bit AVR', mhz: 16, host: false, parse: 8000, plan: 14000, kin: 2000, step: 300, change: 'edit Configuration.h, recompile, flash: minutes', extras: 'linear advance eats the step budget, input shaping off' },
  marlin32: { name: 'Marlin, 32-bit STM32', mhz: 168, host: false, parse: 3000, plan: 8000, kin: 1000, step: 500, change: 'edit Configuration.h, recompile, flash: minutes', extras: 'input shaping + linear advance on the MCU' },
  klipper8: { name: 'Klipper, Pi + 8-bit AVR', mhz: 16, host: true, parse: 0, plan: 0, kin: 1200, step: 160, change: 'edit printer.cfg, RESTART: seconds', extras: 'input shaping + pressure advance on the Pi' },
  klipper32: { name: 'Klipper, Pi + 32-bit STM32', mhz: 168, host: true, parse: 0, plan: 0, kin: 1200, step: 60, change: 'edit printer.cfg, RESTART: seconds', extras: 'input shaping + pressure advance on the Pi' },
}
export type Firmware = keyof typeof FIRMWARES
export const FIRMWARE_KEYS = Object.keys(FIRMWARES) as Firmware[]
/** Curves sliced into 0.5 mm segments; 0.45 × 0.2 mm bead; extruder 415 steps/rev ÷ 16 µsteps × micro; Pi 1.5 GHz, 2 × 10⁵ cycles/line. */
export const FW = { segMm: 0.5, beadMm2: 0.45 * 0.2, eSpm16: 93, hostMhz: 1500, hostLine: 2e5, maxMmS: 500 }
export const FW_TASKS = ['Read G-code', 'Plan moves', 'Kinematics', 'Step pulses'] as const

/** Motor steps per mm of nozzle travel on a 45° curve: X + Y each at v/√2, plus the extruder. */
const stepsPerTravelMm = (micro: number) => stepsPerMm(BOARD.mmRev, micro) * Math.SQRT2 + (FW.beadMm2 / filamentArea()) * FW.eSpm16 * (micro / 16)

/** MCU load (fraction of its clock) per task at `mmS`: lines/s = v / segment, steps/s = v × steps per travel mm. */
function mcuTasks(fw: Firmware, mmS: number, micro: number) {
  const f = FIRMWARES[fw]
  const clk = f.mhz * 1e6
  const lines = mmS / FW.segMm
  return [f.parse * lines, f.plan * lines, f.kin * lines, f.step * mmS * stepsPerTravelMm(micro)].map((c) => c / clk)
}
const sum = (a: readonly number[]) => a.reduce((s, x) => s + x, 0)
/** Fastest speed the MCU keeps up with (load = 1), mm/s. */
export const fwTopMmS = (fw: Firmware, micro: number) => 1 / sum(mcuTasks(fw, 1, micro))

export function firmwareView(fw: Firmware, mmS: number, micro: number) {
  const f = FIRMWARES[fw]
  const tasks = mcuTasks(fw, mmS, micro)
  const load = sum(tasks)
  const top = fwTopMmS(fw, micro)
  const speeds = Array.from({ length: 51 }, (_, i) => (i * FW.maxMmS) / 50)
  return {
    fw,
    tasks,
    load,
    top,
    keeps: load <= 1,
    actualMmS: Math.min(mmS, top),
    stepHz: mmS * stepsPerTravelMm(micro),
    linesS: mmS / FW.segMm,
    hostPct: f.host ? ((mmS / FW.segMm) * FW.hostLine) / (FW.hostMhz * 1e6) : 0,
    speeds,
    curves: FIRMWARE_KEYS.map((k) => speeds.map((s) => sum(mcuTasks(k, s, micro)))),
    config: firmwareConfig(fw, micro),
  }
}

/** The steps/mm setting as each firmware stores it. */
export function firmwareConfig(fw: Firmware, micro: number) {
  const xy = stepsPerMm(BOARD.mmRev, micro)
  const z = stepsPerMm(8, micro)
  const e = (FW.eSpm16 * micro) / 16
  if (!FIRMWARES[fw].host)
    return ['// Configuration.h', `#define X_MICROSTEPS ${micro}`, '#define DEFAULT_AXIS_STEPS_PER_UNIT \\', `  { ${xy}, ${xy}, ${z}, ${e} }`, '// then compile and flash']
  return ['# printer.cfg', '[stepper_x]', `microsteps: ${micro}`, `rotation_distance: ${BOARD.mmRev}`, '# then RESTART']
}

// --- Thermistors and heaters ---

/** 100 kΩ B3950 glass bead and PT1000 (Callendar–Van Dusen), each on a 4.7 kΩ pull-up into a 12-bit 3.3 V ADC; `maxC` = MAXTEMP. */
export const PROBES = {
  ntc: { name: 'NTC 100k B3950', maxC: 290 },
  pt1000: { name: 'PT1000', maxC: 450 },
}
export type HotendProbe = keyof typeof PROBES
const PROBE_ADC = { pullup: 4700, vref: 3.3, bits: 12, r25: 100e3, beta: 3950, a: 3.9083e-3, b: -5.775e-7, minC: 5 }

export function probeOhms(p: HotendProbe, tC: number) {
  const A = PROBE_ADC
  return p === 'ntc' ? A.r25 * Math.exp(A.beta * (1 / (tC + K0) - 1 / (25 + K0))) : 1000 * (1 + A.a * tC + A.b * tC * tC)
}
/** Inverse of `probeOhms`. */
export function probeC(p: HotendProbe, ohms: number) {
  const A = PROBE_ADC
  if (p === 'ntc') return 1 / (1 / (25 + K0) + Math.log(ohms / A.r25) / A.beta) - K0
  return (-A.a + Math.sqrt(A.a * A.a - 4 * A.b * (1 - ohms / 1000))) / (2 * A.b)
}
const dividerV = (ohms: number) => (PROBE_ADC.vref * ohms) / (ohms + PROBE_ADC.pullup)
/** Ideal (unrounded) ADC count. */
const countOf = (ohms: number) => (dividerV(ohms) / PROBE_ADC.vref) * 2 ** PROBE_ADC.bits
/** °C one ADC count spans at `tC`. */
export const probeDegPerCount = (p: HotendProbe, tC: number) => 1 / Math.max(1e-9, Math.abs(countOf(probeOhms(p, tC + 0.5)) - countOf(probeOhms(p, tC - 0.5))))

export const PROBE_FAULTS = { none: 'Wired and seated', open: 'Wire broken (open)', short: 'Leads shorted', loose: 'Bead fell out of the block' }
export type ProbeFault = keyof typeof PROBE_FAULTS
/** Loose bead: reads this share of the block's rise above ambient, typical. */
const LOOSE_SHARE = 0.3

/** What the firmware reads for a true block temperature `tC`: ohms, volts, raw count, temperature back from the count. */
export function probeReading(p: HotendProbe, tC: number, fault: ProbeFault) {
  const A = PROBE_ADC
  const seenC = fault === 'loose' ? AMB + LOOSE_SHARE * (tC - AMB) : tC
  const ohms = fault === 'open' ? Infinity : fault === 'short' ? 0 : probeOhms(p, seenC)
  const volts = ohms === Infinity ? A.vref : dividerV(ohms)
  const raw = quantize(volts, A.vref, A.bits)
  const back = clamp((raw + 0.5) / 2 ** A.bits, 1e-6, 1 - 1e-6)
  const fit = probeC(p, (A.pullup * back) / (1 - back))
  const readC = Number.isFinite(fit) ? clamp(fit, -273, 9999) : 9999
  const error = readC > PROBES[p].maxC ? 'MAXTEMP' : readC < A.minC ? 'MINTEMP' : fault === 'loose' ? 'runaway' : null
  return { seenC, ohms, volts, raw, readC, error, perCount: probeDegPerCount(p, seenC) }
}

/** Cartridge rating vs the supply it is wired to. */
export const CARTRIDGES = {
  r24w40: { name: '24 V 40 W on 24 V', ratedV: 24, ratedW: 40, supplyV: 24 },
  r24w60: { name: '24 V 60 W on 24 V', ratedV: 24, ratedW: 60, supplyV: 24 },
  r12w40: { name: '12 V 40 W on 12 V', ratedV: 12, ratedW: 40, supplyV: 12 },
  r24on12: { name: '24 V 40 W on 12 V', ratedV: 24, ratedW: 40, supplyV: 12 },
  r12on24: { name: '12 V 40 W on 24 V', ratedV: 12, ratedW: 40, supplyV: 24 },
}
export type Cartridge = keyof typeof CARTRIDGES
export const CARTRIDGE_KEYS = Object.keys(CARTRIDGES) as Cartridge[]
/** Block + cartridge heat capacity, J/K (same plant as `hotendPlant`). */
const HOTEND_J = HOTEND_LOSS * GCODE_HEAT.nozzle.tau + HOTEND.cartJPerK

export function cartridgeView(c: Cartridge, setC: number) {
  const k = CARTRIDGES[c]
  const ohms = k.ratedV ** 2 / k.ratedW
  const watts = k.supplyV ** 2 / ohms
  const amps = k.supplyV / ohms
  const holdW = HOTEND_LOSS * Math.max(0, setC - AMB)
  const duty = holdW / watts
  const ceilingC = AMB + watts / HOTEND_LOSS
  const frac = holdW / watts
  const heatS = frac < 1 ? -(HOTEND_J / HOTEND_LOSS) * Math.log(1 - frac) : Infinity
  return { ohms, watts, amps, holdW, duty: Math.min(1, duty), reaches: duty < 1, ceilingC, heatS, fetW: amps ** 2 * BOARD.fetOhm * Math.min(1, duty), over: watts > 1.5 * k.ratedW }
}
