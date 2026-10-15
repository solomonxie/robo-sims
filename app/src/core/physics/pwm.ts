// PWM on an ESP32: LEDC timer resolution vs frequency, duty, averaging by an RC or a motor, switching loss, hobby-servo pulses.
import { ledcBits } from './signals/scope'

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const frac = (x: number) => x - Math.floor(x)

export const LEDC_CLOCK_HZ = 80e6
export const LEDC_MAX_BITS = 20

/** Finest LEDC duty resolution at `hz`: one period must hold 2^bits ticks of the 80 MHz clock. */
export const ledcResolution = (hz: number) => Math.max(1, Math.min(LEDC_MAX_BITS, ledcBits(hz)))
/** Highest LEDC frequency for a `bits` resolution. */
export const ledcMaxHz = (bits: number) => LEDC_CLOCK_HZ / 2 ** bits
/** Duty register value (0 … 2^bits) for a duty of 0..1. */
export const dutyCounts = (duty: number, bits: number) => Math.round(clamp01(duty) * 2 ** bits)
/** Timer count at time `t`: ramps 0 … 2^bits − 1 once per period. */
export const ledcCount = (t: number, hz: number, bits: number) => Math.floor(frac(t * hz) * 2 ** bits)
/** The pin is high while the timer count is below the duty value. */
export const pwmHigh = (t: number, hz: number, duty: number) => frac(t * hz) < duty
export const pwmAverage = (volts: number, duty: number) => volts * clamp01(duty)

/** Peak-to-peak ripple left on a first-order lag (RC, a coil's L/R, a motor's inertia) with time constant `tauS`, fed a 0…`volts` PWM. */
export function pwmRipple(volts: number, duty: number, hz: number, tauS: number) {
  const d = clamp01(duty)
  const a = Math.exp(-d / hz / tauS)
  const b = Math.exp(-(1 - d) / hz / tauS)
  return a * b === 1 ? 0 : (volts * (1 - a) * (1 - b)) / (1 - a * b)
}

export const HEARING_HZ: [number, number] = [20, 20e3]
export const audible = (hz: number) => hz >= HEARING_HZ[0] && hz <= HEARING_HZ[1]
/** Below about this an LED's PWM shows as flicker (and as stripes on camera). */
export const FLICKER_HZ = 100
/** Energy lost in the switch over its rise and fall (each `edgeS`), times the switching rate. */
export const switchingLoss = (volts: number, amps: number, edgeS: number, hz: number) => volts * amps * edgeS * hz

/** TT gear motor: coil L/R and the time its speed takes to follow the voltage (rotor + gearbox inertia). */
export const TT_COIL_TAU = 1e-3 / 5
export const TT_SPIN_TAU = 0.04

export const SERVO_HZ = 50
export const SERVO_PULSE: [number, number] = [1e-3, 2e-3]
/** SG90: 0.1 s per 60° at 4.8 V. */
export const SERVO_DEG_PER_S = 600
/** Hobby servo: 1 ms → 0°, 1.5 ms → 90°, 2 ms → 180°. */
export const servoAngle = (pulseS: number) => 180 * clamp01((pulseS - SERVO_PULSE[0]) / (SERVO_PULSE[1] - SERVO_PULSE[0]))
export const servoPulse = (deg: number) => SERVO_PULSE[0] + clamp01(deg / 180) * (SERVO_PULSE[1] - SERVO_PULSE[0])
/** The horn turns toward `target` at the servo's top speed. */
export const servoStep = (deg: number, target: number, dt: number) => deg + Math.max(-SERVO_DEG_PER_S * dt, Math.min(SERVO_DEG_PER_S * dt, target - deg))

/** Edge time of a logic-level MOSFET driven straight from a pin through ~100 Ω. */
export const PIN_GATE_EDGE_S = 100e-9
