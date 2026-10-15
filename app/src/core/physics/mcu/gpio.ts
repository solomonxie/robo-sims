// ESP32 GPIO pin: push-pull and open-drain drivers, internal pulls, drive strength, polling vs interrupts.
import { Pull, pulledPin, rcTau } from '../circuits'
import { LOGIC_INPUTS, riseTime, thresholds } from '../levels'
import { Diode, diodeNode } from '../semiconductors'

export const GPIO_VDD = 3.3
/** ESP32 internal pull-up / pull-down resistors, typically ~45 kΩ. */
export const INTERNAL_PULL_OHMS = 45e3
/** Datasheet per-pin source limit (absolute maximum). */
export const PIN_MAX_A = 0.04
/** Comfortable continuous current per pin. */
export const PIN_SAFE_A = 0.02
/** GPIO_DRIVE_CAP_0…3: nominal 5 / 10 / 20 / 40 mA; 2 is the default. */
export const DRIVE_CAPS = [0.005, 0.01, 0.02, 0.04]

export type PinMode = 'output' | 'input' | 'pullup' | 'pulldown' | 'opendrain'

/** Which parts inside the pad conduct: P-FET to VDD, N-FET to GND, pull-up, pull-down. */
export function padSwitches(mode: PinMode, bit: 0 | 1) {
  return {
    p: mode === 'output' && bit === 1,
    n: (mode === 'output' || mode === 'opendrain') && bit === 0,
    up: mode === 'pullup' || mode === 'opendrain',
    down: mode === 'pulldown',
  }
}

export const pullOf = (mode: PinMode): Pull => (mode === 'pullup' || mode === 'opendrain' ? 'up' : mode === 'pulldown' ? 'down' : 'none')

/** Pad voltage (null = floating) and pull-resistor current. `pressed` closes a button to the rail opposite the pull
 *  (to GND when there is none); in open-drain mode `bit` 0 also pulls the line low through our own N-FET. */
export function pullPad(mode: PinMode, pressed: boolean, bit: 0 | 1 = 1, vdd = GPIO_VDD) {
  const low = mode === 'opendrain' && bit === 0
  return pulledPin(pullOf(mode), pressed || low, INTERNAL_PULL_OHMS, vdd)
}

/** Time for a pull-up `ohms` to raise a line of `farads` from 0 V to the ESP32's VIH. */
export const pullRiseTime = (ohms: number, farads: number, vdd = GPIO_VDD) =>
  riseTime(thresholds(LOGIC_INPUTS.esp32, vdd).vih, vdd, rcTau(ohms, farads))

/** Driver on-resistance for a drive cap: VOH stays ≥ 0.8 VDD at the cap's nominal current. */
export const driveOhms = (cap: number, vdd = GPIO_VDD) => (0.2 * vdd) / DRIVE_CAPS[cap]

export type PinLoad = { ohms: number; led?: Diode }

/** A HIGH output into a load to GND (a resistor, or an LED with its series resistor): current, pad voltage, driver heat. */
export function drivenPin(cap: number, load: PinLoad, vdd = GPIO_VDD) {
  const rOn = driveOhms(cap, vdd)
  const amps = load.led ? diodeNode(vdd, rOn + load.ohms, load.led).sourceA : vdd / (rOn + load.ohms)
  return { amps, rOn, pinV: vdd - amps * rOn, heatW: amps * amps * rOn }
}

/** Does a loop reading the pin every `periodS` (first read at `phaseS`) see a press over [start, start + len)? */
export function pollSees(start: number, len: number, periodS: number, phaseS = 0) {
  const k = Math.ceil((start - phaseS) / periodS - 1e-9)
  return phaseS + k * periodS < start + len
}

/** Chance a press of `len` at a random moment falls between two reads. */
export const pollMissChance = (len: number, periodS: number) => Math.max(0, 1 - len / periodS)

/** When the loop next looks (at a read or at the flag) after time `t`. */
export const nextLoopRead = (t: number, periodS: number, phaseS = 0) => phaseS + Math.ceil((t - phaseS) / periodS - 1e-9) * periodS

/** A repeating set of button presses: start and length (s) of press `i`. */
const PRESS_LENS = [0.12, 0.05, 0.25, 0.03, 0.08, 0.16]
export const PRESS_EVERY_S = 0.9
export const press = (i: number) => ({ start: i * PRESS_EVERY_S + 0.3, len: PRESS_LENS[((i % PRESS_LENS.length) + PRESS_LENS.length) % PRESS_LENS.length] })
export const buttonDown = (t: number) => {
  const p = press(Math.floor((t - 0.3) / PRESS_EVERY_S))
  return t >= p.start && t < p.start + p.len
}

/** A slow sensor signal with fast ripple on it, clipped to 0…vdd: a plain threshold chatters on every crossing. */
export const noisySensor = (t: number, vdd = GPIO_VDD) =>
  Math.min(vdd, Math.max(0, vdd * (0.5 + 0.42 * Math.sin((2 * Math.PI * t) / 5) + 0.06 * Math.sin(2 * Math.PI * 6.1 * t) + 0.04 * Math.sin(2 * Math.PI * 9.7 * t + 1))))
