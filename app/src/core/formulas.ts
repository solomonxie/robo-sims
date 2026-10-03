// Pure circuit-math formulas, ported 1:1 from robotic-references/hello-electronics/*.py.
// No React/Three imports anywhere under src/core/.

/** Ohm's Law: give exactly two of {voltsV, ampsA, ohms}, get all three back.
 *  Ported from hello_01_ohms_law.py. */
export function ohmsLaw(
  input: { voltsV?: number; ampsA?: number; ohms?: number },
): { voltsV: number; ampsA: number; ohms: number } {
  const { voltsV, ampsA, ohms } = input
  const knownCount = [voltsV, ampsA, ohms].filter((x) => x !== undefined).length
  if (knownCount !== 2) {
    throw new Error('give exactly two of voltsV/ampsA/ohms')
  }
  if (voltsV === undefined) {
    return { voltsV: ampsA! * ohms!, ampsA: ampsA!, ohms: ohms! }
  }
  if (ampsA === undefined) {
    return { voltsV, ampsA: voltsV / ohms!, ohms: ohms! }
  }
  return { voltsV, ampsA, ohms: voltsV / ampsA }
}

/** Total resistance of resistors chained end to end.
 *  Ported from hello_02_series_circuit.py. */
export function seriesResistance(ohmsList: number[]): number {
  return ohmsList.reduce((sum, r) => sum + r, 0)
}

/** Total resistance of resistors in parallel.
 *  Ported from hello_03_parallel_circuit.py. */
export function parallelResistance(ohmsList: number[]): number {
  if (ohmsList.length === 0) return Infinity
  const reciprocalSum = ohmsList.reduce((sum, r) => sum + 1 / r, 0)
  return 1 / reciprocalSum
}

/** RC time constant (tau = R * C, seconds) and the fraction charged after
 *  `elapsedS` seconds: 1 - e^(-t/tau).
 *  Ported from hello_06_capacitor_rc.py. */
export function rcCharge(ohms: number, farads: number, elapsedS: number): { tauS: number; fractionCharged: number } {
  const tauS = ohms * farads
  const fractionCharged = 1 - Math.exp(-elapsedS / tauS)
  return { tauS, fractionCharged }
}

export type HBridgeState = 'forward' | 'reverse' | 'brake' | 'coast'

/** L298N-style H-bridge: EN(enabled) gates the channel, IN1/IN2 pick
 *  direction when enabled, matching pairs (both true or both false) brake.
 *  Ported from hello_11_hbridge_direction.py. */
export function hBridgeDirection(in1: boolean, in2: boolean, enabled: boolean): HBridgeState {
  if (!enabled) return 'coast'
  if (in1 === in2) return 'brake'
  return in1 ? 'forward' : 'reverse'
}

/** PWM duty cycle as an average driven voltage, e.g. a GPIO pin toggling
 *  at `dutyPercent`% of `supplyV`. */
export function pwmAverageVoltage(supplyV: number, dutyPercent: number): number {
  return supplyV * (dutyPercent / 100)
}

/** NTC thermistor resistance from temperature via the Beta equation. */
export function thermistorResistance(
  { ohmsAt25C, beta }: { ohmsAt25C: number; beta: number },
  tempC: number,
): number {
  const T0 = 298.15 // 25°C in kelvin
  const T = tempC + 273.15
  return ohmsAt25C * Math.exp(beta * (1 / T - 1 / T0))
}
