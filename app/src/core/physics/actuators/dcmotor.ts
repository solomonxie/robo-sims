// DC motor: back-EMF, torque–speed, stall heating, gearbox on a robot.

export interface DcMotor {
  /** Winding resistance (Ω), current drawn spinning free (A), and back-EMF per rpm of the output shaft (V/rpm). */
  ohms: number
  noLoadA: number
  voltsPerRpm: number
}

/** TT gear motor (1:48): ~1 A stall and ~160 rpm free at 5 V. */
export const TT_MOTOR: DcMotor = { ohms: 5, noLoadA: 0.15, voltsPerRpm: 0.02625 }

/** Unloaded motor current at `volts`: stalled (V / R) until friction is overcome at noLoadA, then back-EMF holds it there. */
export const motorAmps = (volts: number, m: DcMotor = TT_MOTOR) => Math.min(volts / m.ohms, m.noLoadA)

/** Free-running speed: back-EMF = V − I·R. */
export const motorRpm = (volts: number, m: DcMotor = TT_MOTOR) => Math.max(0, volts - m.noLoadA * m.ohms) / m.voltsPerRpm

export const RPM_PER_RADS = 60 / (2 * Math.PI)

/** Spur gearbox: tooth ratio per stage and efficiency per mesh. TT: 1:48 in three stages. */
export interface Gearbox {
  stages: number[]
  meshEff: number
}
export const GEARBOXES = {
  direct: { stages: [], meshEff: 1 },
  tt48: { stages: [3, 4, 4], meshEff: 0.9 },
  tt120: { stages: [4, 5, 6], meshEff: 0.9 },
} satisfies Record<string, Gearbox>
export type GearKind = keyof typeof GEARBOXES

export const gearRatio = (g: Gearbox) => g.stages.reduce((a, b) => a * b, 1)
export const gearEfficiency = (g: Gearbox) => g.meshEff ** g.stages.length

/** Back-EMF constant at the armature (V per rad/s) = torque constant (N·m/A); TT_MOTOR's volts are per output rpm. */
export const motorK = (m: DcMotor = TT_MOTOR) => (m.voltsPerRpm * RPM_PER_RADS) / gearRatio(GEARBOXES.tt48)
export const backEmf = (radS: number, m: DcMotor = TT_MOTOR) => motorK(m) * radS
/** V = I·R + kω. */
export const armatureAmps = (volts: number, radS: number, m: DcMotor = TT_MOTOR) => (volts - backEmf(radS, m)) / m.ohms
export const stallAmps = (volts: number, m: DcMotor = TT_MOTOR) => volts / m.ohms
/** Brush and bearing drag, what the no-load current pays for. */
export const frictionNm = (m: DcMotor = TT_MOTOR) => motorK(m) * m.noLoadA
/** Torque left at the shaft on the straight T–ω line. */
export const shaftTorque = (volts: number, radS: number, m: DcMotor = TT_MOTOR) => motorK(m) * armatureAmps(volts, radS, m) - frictionNm(m)
export const stallTorque = (volts: number, m: DcMotor = TT_MOTOR) => Math.max(0, shaftTorque(volts, 0, m))
export const freeSpeed = (volts: number, m: DcMotor = TT_MOTOR) => Math.max(0, volts - m.noLoadA * m.ohms) / motorK(m)

/** Steady armature speed against a load of `loadNm` + `dampNm`·ω; 0 when it can't break away. */
export function loadedSpeed(volts: number, loadNm: number, m: DcMotor = TT_MOTOR, dampNm = 0) {
  const k = motorK(m)
  return Math.max(0, (shaftTorque(volts, 0, m) - loadNm) / ((k * k) / m.ohms + dampNm))
}

export interface MotorPoint {
  radS: number
  rpm: number
  amps: number
  emf: number
  torque: number
  powerIn: number
  powerOut: number
  eff: number
}

export function motorPoint(volts: number, radS: number, m: DcMotor = TT_MOTOR): MotorPoint {
  const amps = armatureAmps(volts, radS, m)
  const torque = shaftTorque(volts, radS, m)
  const powerIn = volts * amps
  const powerOut = Math.max(0, torque * radS)
  return { radS, rpm: radS * RPM_PER_RADS, amps, emf: backEmf(radS, m), torque, powerIn, powerOut, eff: powerIn > 0 ? powerOut / powerIn : 0 }
}

/** Mechanical power peaks at half the free speed. */
export const peakPower = (volts: number, m: DcMotor = TT_MOTOR) => motorPoint(volts, freeSpeed(volts, m) / 2, m)

/** Efficiency peaks where I = √(I₀·I_stall). */
export function peakEfficiency(volts: number, m: DcMotor = TT_MOTOR) {
  const amps = Math.sqrt(m.noLoadA * stallAmps(volts, m))
  return motorPoint(volts, (volts - amps * m.ohms) / motorK(m), m)
}

/** TT rotor plus the car reflected through 1:48 (kg·m²). */
export const TT_INERTIA = 2.5e-7

/** Mechanical time constant τ = J·R / k². */
export const motorTau = (inertia = TT_INERTIA, m: DcMotor = TT_MOTOR) => (inertia * m.ohms) / motorK(m) ** 2

/** Speed `t` s after switching on from rest (inductance ignored): ω∞·(1 − e^(−t/τ)). */
export const spinUp = (volts: number, t: number, loadNm = 0, inertia = TT_INERTIA, m: DcMotor = TT_MOTOR) =>
  loadedSpeed(volts, loadNm, m) * (1 - Math.exp(-t / motorTau(inertia, m)))

/** Share of armature current in each coil of a delta-wound 3-slot rotor at angle `theta` (coil k's arm at θ + 2πk/3,
 *  brushes on the ±y axis): 2/3 through the coil most across the brushes, 1/3 back through the other two in series. */
export function coilShares(theta: number) {
  const s = [0, 1, 2].map((k) => Math.sin(theta + (2 * Math.PI * k) / 3))
  const across = s.reduce((best, v, k) => (Math.abs(v) > Math.abs(s[best]) + 1e-9 ? k : best), 0)
  const sign = Math.sign(s[across])
  return s.map((_, k) => (k === across ? (2 * sign) / 3 : -sign / 3))
}

// --- Stalled motor heating ---

/** Winding as one thermal lump: heat capacity, rise per watt, copper tempco; the end cap softens at maxC. */
export const TT_THERMAL = { jPerK: 1.5, kPerW: 25, ambientC: 25, maxC: 100, tempco: 0.0039 }
export const windingOhms = (tempC: number, m: DcMotor = TT_MOTOR) => m.ohms * (1 + TT_THERMAL.tempco * (tempC - TT_THERMAL.ambientC))

/** Resettable PTC fuse (0.5 A hold) as a fuse lump; once tripped it passes a trickle until power is removed. */
export const PTC_050 = { ratedA: 0.5, minMeltA: 0.75, tauS: 3, trickleA: 0.03 }
/** Driver current limit (DRV8871-style ILIM). */
export const DRIVER_LIMIT_A = 0.5

export type StallGuard = 'none' | 'ptc' | 'limit'
export interface StallFrame {
  t: number
  amps: number
  tempC: number
  watts: number
  tripped: boolean
}

/** Locked rotor on `volts` for `seconds`: I = V / R(T) heats the winding, R rises; the guard limits or cuts I. */
export function stallRun(volts: number, guard: StallGuard, seconds = 90, dt = 0.1, m: DcMotor = TT_MOTOR) {
  const T = TT_THERMAL
  const frames: StallFrame[] = []
  let tempC = T.ambientC
  let ptc = 0
  let tripped = false
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const r = windingOhms(tempC, m)
    let amps = volts / r
    if (guard === 'limit') amps = Math.min(amps, DRIVER_LIMIT_A)
    if (guard === 'ptc') {
      if (!tripped) {
        const target = (amps / PTC_050.minMeltA) ** 2
        ptc = target + (ptc - target) * Math.exp(-dt / PTC_050.tauS)
        tripped = ptc >= 1
      }
      if (tripped) amps = PTC_050.trickleA
    }
    const watts = amps * amps * r
    frames.push({ t: i * dt, amps, tempC, watts, tripped })
    const target = T.ambientC + watts * T.kPerW
    tempC = target + (tempC - target) * Math.exp(-dt / (T.jPerK * T.kPerW))
  }
  return frames
}

// --- Gearbox on a robot ---

/** Small 2WD car: mass, wheel radius, rolling resistance, driven wheels. */
export const TT_CAR = { massKg: 0.8, wheelM: 0.0325, crr: 0.04, driven: 2 }
const G = 9.81

/** One driven wheel on a slope of `slopeRad`: motor speed and current, wheel rpm, car speed and the pull it needs/can give. */
export function wheelDrive(volts: number, g: Gearbox, slopeRad: number, m: DcMotor = TT_MOTOR) {
  const n = gearRatio(g)
  const eff = gearEfficiency(g)
  const needN = (TT_CAR.massKg * G * (Math.sin(slopeRad) + TT_CAR.crr * Math.cos(slopeRad))) / TT_CAR.driven
  const loadNm = (needN * TT_CAR.wheelM) / (n * eff)
  const radS = loadedSpeed(volts, loadNm, m)
  const wheelRadS = radS / n
  return {
    ratio: n,
    eff,
    motorRpm: radS * RPM_PER_RADS,
    amps: radS > 0 ? (loadNm + frictionNm(m)) / motorK(m) : stallAmps(volts, m),
    wheelRpm: wheelRadS * RPM_PER_RADS,
    speed: wheelRadS * TT_CAR.wheelM,
    needN,
    maxN: (stallTorque(volts, m) * n * eff) / TT_CAR.wheelM,
    wheelNm: needN * TT_CAR.wheelM,
    loadNm,
  }
}

