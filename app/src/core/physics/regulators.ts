// Voltage regulators: a linear LDO burns the difference as heat; buck and boost converters chop it with an inductor.

export interface LinearReg {
  vout: number
  /** Dropout at no load, V, and how much it grows per amp. */
  dropout0: number
  dropoutPerAmp: number
  /** Ground-pin (quiescent) current, A. */
  iq: number
  maxAmps: number
  /** Junction-to-air thermal resistance, °C/W; thermal shutdown trips at `tOff` and releases at `tOn`. */
  thetaJA: number
  tMax: number
  tOff: number
  tOn: number
  /** Thermal time constant of the package on its pad, s. */
  tauS: number
  /** Ripple rejection, dB. */
  psrrDb: number
}

/** AMS1117-3.3 in SOT-223: 1.1 V dropout at 800 mA, 5 mA ground current, ~90 °C/W on a small pad, 75 dB ripple rejection. */
export const AMS1117_33: LinearReg = {
  vout: 3.3,
  dropout0: 0.95,
  dropoutPerAmp: 0.19,
  iq: 0.005,
  maxAmps: 0.8,
  thetaJA: 90,
  tMax: 125,
  tOff: 155,
  tOn: 140,
  tauS: 4,
  psrrDb: 75,
}

/** ESP32 DevKit current on 3.3 V: CPU idle with radio off, Wi-Fi listening, Wi-Fi transmitting. */
export const ESP32_AMPS = { idle: 0.05, listen: 0.1, transmit: 0.24 }

export const AMBIENT_C = 25

export const dropoutVolts = (r: LinearReg, amps: number) => r.dropout0 + r.dropoutPerAmp * amps

/** Steady output of a linear regulator: Vout, or Vin − dropout once the input sags too low. Iin = Iload + Iq. */
export function linearReg(r: LinearReg, vin: number, amps: number) {
  const dropout = dropoutVolts(r, amps)
  const vout = Math.max(0, Math.min(r.vout, vin - dropout))
  const iin = amps + r.iq
  const power = (vin - vout) * amps + vin * r.iq
  return { vout, dropout, inDropout: vin - dropout < r.vout, iin, power, efficiency: vin > 0 ? (vout * amps) / (vin * iin) : 0 }
}

export const junctionC = (r: LinearReg, watts: number, ambient = AMBIENT_C) => ambient + r.thetaJA * watts

/** Output ripple left after rejection, V. */
export const rejectedRipple = (r: LinearReg, ripple: number) => ripple * 10 ** (-r.psrrDb / 20)

export interface Thermal {
  tj: number
  on: boolean
}

/** One step of the junction heating toward Ta + θ·P; past `tOff` the output shuts off until it cools to `tOn`. */
export function ldoThermalStep(r: LinearReg, s: Thermal, dt: number, vin: number, amps: number, ambient = AMBIENT_C): Thermal {
  const power = s.on ? linearReg(r, vin, amps).power : vin * r.iq
  const tj = s.tj + (junctionC(r, power, ambient) - s.tj) * (1 - Math.exp(-dt / r.tauS))
  const on = s.on ? tj < r.tOff : tj <= r.tOn
  return { tj, on }
}

export interface Switcher {
  fHz: number
  henries: number
  /** MOSFET on-resistance, Schottky drop and inductor winding resistance. */
  ronOhms: number
  diodeV: number
  dcrOhms: number
}

/** 100 kHz buck, 12 V in: 220 µH, 50 mΩ FET, SS34 Schottky, 150 mΩ coil. */
export const BUCK_DEMO: Switcher = { fHz: 100e3, henries: 220e-6, ronOhms: 0.05, diodeV: 0.4, dcrOhms: 0.15 }
/** 100 kHz boost, 5 V in: 100 µH, same FET and diode. */
export const BOOST_DEMO: Switcher = { fHz: 100e3, henries: 100e-6, ronOhms: 0.05, diodeV: 0.4, dcrOhms: 0.15 }

export interface Converter {
  vout: number
  /** Average inductor, output and input current, A. */
  il: number
  iout: number
  iin: number
  /** Peak-to-peak inductor ripple, A; the triangle swings iMin … iMax. */
  ripple: number
  iMin: number
  iMax: number
  efficiency: number
  /** Inductor current never reaches zero (continuous conduction). */
  ccm: boolean
}

function converter(vin: number, vout: number, il: number, iout: number, iin: number, ripple: number): Converter {
  const pin = vin * iin
  return {
    vout,
    il,
    iout,
    iin,
    ripple,
    iMin: il - ripple / 2,
    iMax: il + ripple / 2,
    efficiency: pin > 0 ? (vout * iout) / pin : 0,
    ccm: il > ripple / 2,
  }
}

/** Buck into a resistor, continuous conduction. Ideal: Vout = D·Vin. Real: volt-seconds on the inductor balance with
 *  the FET, diode and winding drops in, so D(Vin − I·Ron) − (1 − D)Vd − I·Rdcr = Vout. */
export function buck(s: Switcher, vin: number, duty: number, load: number, ideal = false): Converter {
  const [ron, vd, dcr] = ideal ? [0, 0, 0] : [s.ronOhms, s.diodeV, s.dcrOhms]
  const vout = Math.max(0, (duty * vin - (1 - duty) * vd) / (1 + (duty * ron + dcr) / load))
  const i = vout / load
  return converter(vin, vout, i, i, duty * i, ((vin - vout) * duty) / (s.henries * s.fHz))
}

/** Boost into a resistor, continuous conduction. Ideal: Vout = Vin / (1 − D). Real: the inductor carries Iout / (1 − D),
 *  so Vin − (1 − D)Vd = Vout [(1 − D) + (Rdcr + D·Ron) / (R (1 − D))]; the output peaks and falls as D → 1. */
export function boost(s: Switcher, vin: number, duty: number, load: number, ideal = false): Converter {
  const [ron, vd, dcr] = ideal ? [0, 0, 0] : [s.ronOhms, s.diodeV, s.dcrOhms]
  const off = 1 - duty
  const vout = Math.max(0, (vin - off * vd) / (off + (dcr + duty * ron) / (load * off)))
  const iout = vout / load
  const il = iout / off
  return converter(vin, vout, il, iout, il, (vin * duty) / (s.henries * s.fHz))
}

/** Inductor current at `phase` (0..1) of a switching period: ramps up while the switch is on (phase < D), down after. */
export const inductorAmps = (c: Converter, duty: number, phase: number) =>
  phase < duty ? c.iMin + (c.ripple * phase) / duty : c.iMax - (c.ripple * (phase - duty)) / (1 - duty)
