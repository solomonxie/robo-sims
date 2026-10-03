// Single-loop LED circuit: supply → resistor → LED → ground.
// Ported from robotic-references/hello-electronics/hello_05_led_resistor_calc.py.

export interface LedLoop {
  supplyV: number
  ohms: number
  forwardVoltageV: number
  maxCurrentMA: number
}

export interface LedReading {
  currentMA: number
  /** 0..1 of the LED's rated current, for glow. */
  brightness: number
  status: 'off' | 'lit' | 'over-current'
  reason: string
}

export function solveLedLoop({ supplyV, ohms, forwardVoltageV, maxCurrentMA }: LedLoop): LedReading {
  const headroomV = supplyV - forwardVoltageV
  if (headroomV <= 0) {
    return {
      currentMA: 0,
      brightness: 0,
      status: 'off',
      reason: `${supplyV} V supply is below the LED's ${forwardVoltageV} V forward voltage`,
    }
  }
  const currentMA = (headroomV / ohms) * 1000
  const brightness = Math.min(1, currentMA / maxCurrentMA)
  if (currentMA > maxCurrentMA) {
    return {
      currentMA,
      brightness,
      status: 'over-current',
      reason: `${currentMA.toFixed(1)} mA exceeds the ${maxCurrentMA} mA rating; use a larger resistor`,
    }
  }
  return {
    currentMA,
    brightness,
    status: 'lit',
    reason: `(${supplyV} V − ${forwardVoltageV} V) / ${ohms} Ω = ${currentMA.toFixed(1)} mA`,
  }
}

/** Smallest resistor keeping the LED at its rated current. */
export function minLedResistor(supplyV: number, forwardVoltageV: number, maxCurrentMA: number): number {
  return (supplyV - forwardVoltageV) / (maxCurrentMA / 1000)
}
