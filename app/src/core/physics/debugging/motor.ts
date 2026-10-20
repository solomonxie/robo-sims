// Motor does nothing: the robo-car's drive chain (2S 18650 pack → TB6612FNG or DRV8833 → TT gear motor, ESP32 on USB
// driving the logic pins) and the faults that leave the wheel still: an enable pin low, no common ground, a jammed gearbox.
import { solveNodal } from '../../nodal'
import { memoize, once } from '../common'
import { ROOM_C } from '../dc'
import { DRIVERS, DriverChip, driverLoss } from '../actuators/hbridge'
import { GEARBOXES, TT_MOTOR, TT_THERMAL, stallRun, wheelDrive } from '../actuators/dcmotor'
import { pinBridge } from '../challenges/motordrivers'
import { GPIO_VDD } from '../mcu/gpio'
import { LogicInput, readInput } from '../levels'
import { carPower, drvMode } from '../projects/robocar'
import { MeterRead, OL, amp, huntOf, ohm, volt } from './hunt'

/** The bench: robo-car 2S pack, PWM at 80 % (204 of 255, 8-bit LEDC), the ESP32 on a laptop's USB (its ground isolated
 *  from the pack by ~50 MΩ), a 10 MΩ meter, a Dupont ground jumper, the thermal camera after 30 s of trying. */
export const DRIVE_BOT = { duty: 204 / 255, isolationOhms: 50e6, meterOhms: 10e6, jumperOhms: 0.1, heatS: 30 }
/** Logic input pull-downs inside the driver chips (datasheet typicals). */
export const DRIVER_PULL_OHMS: Record<DriverChip, number> = { tb6612: 200e3, drv8833: 100e3, l298n: Infinity }
/** DRV8833 IN / nSLEEP thresholds: fixed volts, so 3.3 V logic drives it. */
export const DRV8833_IN: LogicInput = { vil: 0.7, vih: 2, ratio: false }

/** Rest volts and resistance of the robo-car's 2S 18650 pack (with its leads). */
export const drivePack = once(() => {
  const p = carPower('li2')
  return { ocv: p.ocv, ohms: p.ohms }
})

type MotorLoad = 'run' | 'stall' | 'open'

/** One TT motor behind `chip` at PWM `duty` (slow decay: both low sides on in the off-time, so the motor current is
 *  continuous and the pack sees duty × I). `run` = on the floor (stalls by itself if the volts can't start it), `stall` =
 *  rotor locked, `open` = winding open. Meter values are averages: `term` across the motor, `amps` through it. */
export function drivePoint(chip: DriverChip, duty: number, load: MotorLoad, ocv = drivePack().ocv) {
  const { ohms } = drivePack()
  let vm = ocv
  let amps = 0
  for (let k = 0; k < 60; k++) {
    const motorV = duty * driverLoss(chip, amps, vm).motorV
    const next = load === 'open' ? 0 : load === 'stall' ? motorV / TT_MOTOR.ohms : wheelDrive(motorV, GEARBOXES.tt48, 0).amps
    vm = ocv - ohms * duty * next
    if (Math.abs(next - amps) < 1e-9) break
    amps = next
  }
  const term = duty * driverLoss(chip, amps, vm).motorV
  const w = load === 'run' ? wheelDrive(term, GEARBOXES.tt48, 0) : null
  const locked = !w || w.speed === 0
  const motorC = locked && amps > 0 ? stallRun(term, 'none', DRIVE_BOT.heatS).at(-1)!.tempC : windingC(amps, DRIVE_BOT.heatS)
  return { vm, amps, term, speed: w ? w.speed : 0, wheelRpm: w ? w.wheelRpm : 0, driverC: driverLoss(chip, amps, vm).tempC, motorC }
}

/** Winding temperature after `seconds` at a steady `amps` (one thermal lump, R at room temperature). */
export const windingC = (amps: number, seconds: number) =>
  ROOM_C + amps * amps * TT_MOTOR.ohms * TT_THERMAL.kPerW * (1 - Math.exp(-seconds / (TT_THERMAL.jPerK * TT_THERMAL.kPerW)))

/** Hottest part a thermal camera finds; 'nothing' when all sit within 2 K of the room. */
export function hotSpot(parts: Record<string, number>): MeterRead {
  const [name, c] = Object.entries(parts).reduce((a, b) => (b[1] > a[1] ? b : a))
  return c - ROOM_C < 2 ? { value: ROOM_C, unit: '°C', label: 'nothing' } : { value: c, unit: '°C', label: name }
}

/** A logic HIGH `high` volts over its own ground, wired to an input with a pull-down `pullOhms` to the other board's
 *  ground, the two grounds joined only by `isolationOhms`: the input pin vs the other ground, read by a `meterOhms` meter. */
export function floatingInput(high: number, pullOhms: number, isolationOhms = DRIVE_BOT.isolationOhms, meterOhms = DRIVE_BOT.meterOhms) {
  // Nodes: 0 driver GND, 1 input pin, 2 ESP32 GND.
  const v = solveNodal(2, [
    { kind: 'V', a: 1, b: 2, volts: high },
    { kind: 'R', a: 1, b: 0, ohms: pullOhms },
    { kind: 'R', a: 1, b: 0, ohms: meterOhms },
    { kind: 'R', a: 2, b: 0, ohms: isolationOhms },
  ])!.volts
  return v[1]
}


// --- Missing enable pin: TB6612FNG, AIN1 high, AIN2 low, PWMA at 80 %, STBY from a GPIO ---

export const ENABLE_FAULTS = {
  stby: { name: 'STBY not wired' },
  pwm: { name: 'PWMA on the wrong GPIO' },
  same: { name: 'AIN1 = AIN2 in code' },
  vm: { name: 'No motor supply (VM)' },
}
export type EnableFault = keyof typeof ENABLE_FAULTS
export type EnableProbe = 'stby' | 'pwma' | 'ain2' | 'vm' | 'term'
export const ENABLE_PROBES: Record<EnableProbe, { name: string }> = {
  stby: { name: 'STBY' },
  pwma: { name: 'PWMA' },
  ain2: { name: 'AIN2' },
  vm: { name: 'VM' },
  term: { name: 'Motor terminals' },
}

/** Pins as the TB6612 sees them, the bridge mode with PWMA high and low, and the motor's averages. */
export const missingEnable = memoize((fault: EnableFault | 'ok') => {
  const d = DRIVE_BOT.duty
  const pins = { ain1: true, ain2: fault === 'same', pwm: fault !== 'pwm', stby: fault !== 'stby' }
  const hi = pinBridge('tb6612', [pins.ain1, pins.ain2, pins.pwm, pins.stby])
  const lo = pinBridge('tb6612', [pins.ain1, pins.ain2, false, pins.stby])
  /** Share of each PWM period spent driving forward. */
  const fwd = (hi.mode === 'forward' ? d : 0) + (lo.mode === 'forward' ? 1 - d : 0)
  const ocv = fault === 'vm' ? 0 : drivePack().ocv
  const run = drivePoint('tb6612', fwd, fwd > 0 ? 'run' : 'open', ocv)
  const term = fwd > 0 ? run.term : 0
  const reads: Record<EnableProbe, MeterRead> = {
    stby: volt(pins.stby ? GPIO_VDD : 0),
    pwma: volt(pins.pwm ? d * GPIO_VDD : 0),
    ain2: volt(pins.ain2 ? GPIO_VDD : 0),
    vm: volt(run.vm),
    term: volt(term),
  }
  return { pins, modes: [hi.mode, lo.mode] as const, off: hi.off, fwd, run, reads }
})

export const ENABLE_HUNT = huntOf(ENABLE_FAULTS, ENABLE_PROBES, (f, p) => missingEnable(f).reads[p])

// --- Common ground missing: DRV8833, IN1 high, IN2 low, ESP32 on USB, driver and motor on the pack ---

export const GROUND_FAULTS = {
  ground: { name: 'No common ground' },
  gpio34: { name: 'IN1 on GPIO 34' },
  jumper: { name: 'Broken IN1 jumper' },
  lead: { name: 'Motor lead loose' },
}
export type GroundFault = keyof typeof GROUND_FAULTS
export type GroundProbe = 'gpio' | 'inEsp' | 'inDrv' | 'gnds' | 'term' | 'coil'
export const GROUND_PROBES: Record<GroundProbe, { name: string }> = {
  gpio: { name: 'IN1 wire at ESP32' },
  inEsp: { name: 'IN1 to ESP GND' },
  inDrv: { name: 'IN1 to driver GND' },
  gnds: { name: 'GND to GND, off' },
  term: { name: 'Motor terminals' },
  coil: { name: 'Motor, power off' },
}

/** IN1 at both ends of its jumper, as the DRV8833 reads it, and the motor. GPIO 34 is input-only: it can't drive, so the
 *  driver's pull-down holds the wire low. A broken jumper leaves the driver end on its pull-down. No common ground: the
 *  ESP32's 3.3 V is over its own ground, which floats ~50 MΩ from the driver's. */
export const commonGround = memoize((fault: GroundFault | 'ok') => {
  const pull = DRIVER_PULL_OHMS.drv8833
  const gpio = fault === 'gpio34' ? 0 : GPIO_VDD
  const inEsp = fault === 'jumper' ? 0 : gpio
  const inDrv = fault === 'ground' ? floatingInput(gpio, pull) : inEsp
  const seen = readInput(inDrv, DRV8833_IN, GPIO_VDD) === 1
  const mode = drvMode(seen, false)
  const run = mode === 'forward' ? drivePoint('drv8833', 1, fault === 'lead' ? 'open' : 'run') : null
  const reads: Record<GroundProbe, MeterRead> = {
    gpio: volt(gpio),
    inEsp: volt(inEsp),
    inDrv: volt(inDrv),
    gnds: fault === 'ground' ? OL : ohm(DRIVE_BOT.jumperOhms),
    term: volt(run ? run.term : 0),
    coil: fault === 'lead' ? OL : ohm(TT_MOTOR.ohms),
  }
  return { inDrv, seen, mode, run, reads }
})

export const GROUND_HUNT = huntOf(GROUND_FAULTS, GROUND_PROBES, (f, p) => commonGround(f).reads[p])

// --- Stalled gearbox: TB6612FNG at 80 %, the wheel won't turn ---

/** The same `ledcWrite(…, 204)` on a channel set to 12 bits: 204 / 4095. */
export const LOW_DUTY = 204 / 4095

export const STALL_FAULTS = {
  jammed: { name: 'Jammed gearbox' },
  open: { name: 'Open motor winding' },
  duty: { name: 'Duty 5 % (12-bit)' },
  dead: { name: 'Dead driver channel' },
}
export type StallFault = keyof typeof STALL_FAULTS
export type StallProbe = 'term' | 'amps' | 'coil' | 'heat'
export const STALL_PROBES: Record<StallProbe, { name: string }> = {
  term: { name: 'Motor terminals' },
  amps: { name: 'Motor current' },
  coil: { name: 'Motor, power off' },
  heat: { name: 'Thermal camera' },
}

/** Motor averages and temperatures with `fault` in the build; a dead channel never switches its outputs on. */
export const stalledGearbox = memoize((fault: StallFault | 'ok') => {
  const run = fault === 'dead' ? drivePoint('tb6612', 0, 'open') : drivePoint('tb6612', fault === 'duty' ? LOW_DUTY : DRIVE_BOT.duty, fault === 'jammed' ? 'stall' : fault === 'open' ? 'open' : 'run')
  const reads: Record<StallProbe, MeterRead> = {
    term: volt(run.term),
    amps: amp(run.amps),
    coil: fault === 'open' ? OL : ohm(TT_MOTOR.ohms),
    heat: hotSpot({ 'TT motor': run.motorC, TB6612: run.driverC }),
  }
  return { run, overA: run.amps > DRIVERS.tb6612.maxA, reads }
})

export const STALL_HUNT = huntOf(STALL_FAULTS, STALL_PROBES, (f, p) => stalledGearbox(f).reads[p])
