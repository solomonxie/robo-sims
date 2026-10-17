// Thermal design: a plate-fin heatsink on a TO-220 MOSFET (fin spacing, orientation, airflow, mounting, enclosure air rise),
// and a robot-arm joint's winding temperature over a duty cycle (servo current follows the load, stepper current is set).
import { G, clamp01 } from '../common'
import { DRIVES, Drive, ampsAt, hotOhms, ratedNm, stallA } from '../actuators/sizing'
import { NEMA17 } from '../actuators/stepper'
import { INTERFACES, SOLIDS, TAB, conductionR, radiationG } from '../waves/heat'
import { kelvinOf } from '../waves/thermal'

/** Air near 50 °C: conductivity, kinematic viscosity, diffusivity, Prandtl, ρ·cp (J/(m³·K)). */
const AIR_50C = { k: 0.027, nu: 1.8e-5, alpha: 2.55e-5, pr: 0.71, rhoCp: 1.2 * 1005 }

/** 40 × 40 mm aluminium plate-fin sink, 20 mm fins 1.2 mm thick on a 3 mm base, black anodised. */
export const SINK = { w: 0.04, l: 0.04, finH: 0.02, finT: 0.0012, baseT: 0.003, k: SOLIDS.aluminium.k, eps: 0.85 }

/** Natural-convection factor vs fins vertical (typical): horizontal channels trap the warm air. */
export const SINK_ORIENT = {
  vertical: { name: 'Fins vertical', k: 1 },
  up: { name: 'Base flat, fins up', k: 0.8 },
  sideways: { name: 'Fins horizontal', k: 0.55 },
} as const
export type SinkOrient = keyof typeof SINK_ORIENT

/** Tab-to-sink joint over the TO-220 tab, °C/W from conduction through the layer. */
export const SINK_MOUNTS = {
  paste: { name: 'Thermal paste, screwed', theta: conductionR(INTERFACES.paste.k, INTERFACES.paste.t, TAB.side ** 2) },
  pad: { name: 'Silicone pad 1 mm', theta: conductionR(INTERFACES.pad.k, INTERFACES.pad.t, TAB.side ** 2) },
  dry: { name: 'Dry, screwed tight', theta: conductionR(0.026, 0.02e-3, TAB.side ** 2) },
  loose: { name: 'Dry, loose screw', theta: conductionR(INTERFACES.air.k, INTERFACES.air.t, TAB.side ** 2) },
} as const
export type SinkMount = keyof typeof SINK_MOUNTS

/** Where the sink sits: air speed over it (m/s), inside a box or not, box vents (m² each) and fan flow (m³/s). Typical. */
export const SINK_AIR = {
  open: { name: 'Open chassis, still air', v: 0, boxed: false, vent: 0, fanQ: 0 },
  driving: { name: 'Open, robot driving 1 m/s', v: 1, boxed: false, vent: 0, fanQ: 0 },
  closed: { name: 'Closed box', v: 0, boxed: true, vent: 0, fanQ: 0 },
  vented: { name: 'Box with vents', v: 0, boxed: true, vent: 12e-4, fanQ: 0 },
  fan: { name: 'Box + 30 mm fan', v: 2, boxed: true, vent: 0, fanQ: 9.4e-4 },
} as const
export type SinkAir = keyof typeof SINK_AIR

/** Electronics box: 160 × 120 × 60 mm, 2 mm PLA walls, 2 W from the other boards (typical), 50 mm vent height. */
export const E_BOX = { dims: [0.16, 0.12, 0.06] as const, wallT: 0.002, wallK: 0.13, hIn: 4, hOut: 6, otherW: 2, ventH: 0.05 }

/** Gap between fins, m. */
export const finGap = (fins: number) => (SINK.w - fins * SINK.finT) / (fins - 1)

/** Natural convection between vertical plates (Bar-Cohen & Rohsenow), W/(m²·K). */
function channelNaturalH(gap: number, dT: number, ambC: number) {
  const beta = 1 / kelvinOf(ambC + dT / 2)
  const ra = (G * beta * Math.max(dT, 0.1) * gap ** 3) / (AIR_50C.nu * AIR_50C.alpha)
  const el = (ra * gap) / SINK.l
  const nu = (576 / el ** 2 + 2.873 / Math.sqrt(el)) ** -0.5
  return (nu * AIR_50C.k) / gap
}

/** Forced flow in the channels (developing laminar, Teertstra), with flow bypassing dense fins: V = v·s/(s + 1.5 mm). */
function channelForcedH(gap: number, v: number) {
  if (v <= 0) return 0
  const vc = (v * gap) / (gap + 1.5e-3)
  const re = ((vc * gap) / AIR_50C.nu) * (gap / SINK.l)
  const a = ((re * AIR_50C.pr) / 2) ** -3
  const b = (0.664 * Math.sqrt(re) * AIR_50C.pr ** (1 / 3) * Math.sqrt(1 + 3.65 / Math.sqrt(re))) ** -3
  return ((a + b) ** (-1 / 3) * AIR_50C.k) / gap
}

/** Sink-to-air θsa (°C/W) for `fins` fins carrying `watts`: convection on fins (with fin efficiency) and base, radiation off the envelope. */
export function sinkTheta(fins: number, orient: SinkOrient, v: number, watts: number, ambC: number) {
  const gap = finGap(fins)
  const finA = 2 * fins * SINK.finH * SINK.l
  const baseA = Math.max(0, SINK.w - fins * SINK.finT) * SINK.l
  const envA = SINK.w * SINK.l + 2 * (SINK.finH + SINK.baseT) * (SINK.w + SINK.l)
  let dT = 30
  let r = { theta: 1, h: 0, eta: 1, gap }
  for (let i = 0; i < 30; i++) {
    const hn = SINK_ORIENT[orient].k * channelNaturalH(gap, dT, ambC)
    const h = Math.cbrt(hn ** 3 + channelForcedH(gap, v) ** 3)
    const mH = Math.sqrt((2 * h) / (SINK.k * SINK.finT)) * SINK.finH
    const eta = Math.tanh(mH) / mH
    const g = h * (eta * finA + baseA) + radiationG(ambC + dT, SINK.eps, ambC, envA)
    r = { theta: 1 / g, h, eta, gap }
    dT = 0.5 * dT + 0.5 * watts * r.theta
  }
  return r
}

/** Air inside the box above room: walls U·A plus vent (stack effect) or fan flow ρ·cp·Q; 0 when not boxed. */
export function boxAirRise(air: SinkAir, watts: number, ambC: number) {
  const A = SINK_AIR[air]
  if (!A.boxed) return { rise: 0, ua: 0, flowG: 0 }
  const [x, y, z] = E_BOX.dims
  const area = 2 * (x * y + x * z + y * z)
  const ua = area / (1 / E_BOX.hIn + E_BOX.wallT / E_BOX.wallK + 1 / E_BOX.hOut)
  let rise = watts / ua
  let flowG = 0
  for (let i = 0; i < 40; i++) {
    const stackQ = A.vent > 0 ? 0.6 * A.vent * Math.sqrt((G * E_BOX.ventH * rise) / kelvinOf(ambC)) : 0
    flowG = AIR_50C.rhoCp * (stackQ + A.fanQ)
    rise = 0.5 * rise + (0.5 * watts) / (ua + flowG)
  }
  return { rise, ua, flowG }
}

interface SinkCfg {
  watts: number
  fins: number
  orient: SinkOrient
  air: SinkAir
  mount: SinkMount
  ambC?: number
}

/** Junction → case → sink → box air → room: series θs, node temperatures, and θsa against fin count for the same setup. */
export function heatsinkView(c: SinkCfg) {
  const ambC = c.ambC ?? 25
  const A = SINK_AIR[c.air]
  const box = boxAirRise(c.air, c.watts + E_BOX.otherW, ambC)
  const airC = ambC + box.rise
  const s = sinkTheta(c.fins, c.orient, A.v, c.watts, airC)
  const thetas = [TAB.thetaJC, SINK_MOUNTS[c.mount].theta, s.theta]
  const temps = [airC]
  for (let i = thetas.length - 1; i >= 0; i--) temps.unshift(temps[0] + c.watts * thetas[i])
  temps.push(ambC)
  const sweep = Array.from({ length: 23 }, (_, i) => ({ fins: i + 2, theta: sinkTheta(i + 2, c.orient, A.v, c.watts, airC).theta }))
  const best = sweep.reduce((a, b) => (b.theta < a.theta ? b : a))
  return { ...s, thetas, temps, tj: temps[0], airC, box, sweep, best, ambC }
}

// --- Motor heating: a 15 cm arm with a payload, held out for a share of every minute ---

/** Arm link (m, kg) on the joint, cycle period, and how long the time-lapse runs. */
export const ARM_JOINT = { lengthM: 0.15, armKg: 0.06, beltRatio: 5, periodS: 60, seconds: 1800, dt: 2 }
/** PLA motor mounts creep and sag from about here (typical). */
export const PLA_CREEP_C = 60

export type JointDrive = 'servo' | 'stepper'
interface JointCfg {
  drive: JointDrive
  payloadKg: number
  busy: number
  idle: number
  ambC: number
}

/** Gravity torque on the joint with the arm level: m·g·L + m_arm·g·L/2 (Torque & levers › Static balance). */
export const gravityNm = (payloadKg: number) => G * (payloadKg * ARM_JOINT.lengthM + (ARM_JOINT.armKg * ARM_JOINT.lengthM) / 2)

/** Winding temperature over the time-lapse; working share `busy` of each period at busy amps, the rest at idle amps.
 *  Servo: busy = arm held out, idle = parked hanging. Stepper: driver current, busy = run current, idle = `idle` × run. */
export function jointHeat(c: JointCfg) {
  const d: Drive = c.drive === 'servo' ? DRIVES.servo : DRIVES.nema17
  const needNm = gravityNm(c.payloadKg)
  const ampsBusy = c.drive === 'servo' ? Math.min(stallA(d), ampsAt(d, needNm)) : NEMA17.ratedA
  const ampsIdle = c.drive === 'servo' ? d.noLoadA : NEMA17.ratedA * clamp01(c.idle)
  const ratio = c.drive === 'servo' ? 1 : ARM_JOINT.beltRatio
  const peakNm = c.drive === 'servo' ? d.stallNm : NEMA17.holdNm * ratio
  const contNm = c.drive === 'servo' ? ratedNm(d, c.ambC) : peakNm
  const idleHoldNm = c.drive === 'servo' ? 0 : NEMA17.holdNm * clamp01(c.idle) * ratio
  const busy = clamp01(c.busy)
  const run: { t: number; tempC: number; busy: boolean; watts: number }[] = []
  let tempC = c.ambC
  for (let i = 0; i * ARM_JOINT.dt <= ARM_JOINT.seconds + 1e-9; i++) {
    const t = i * ARM_JOINT.dt
    const on = (t % ARM_JOINT.periodS) / ARM_JOINT.periodS < busy
    const a = on ? ampsBusy : ampsIdle
    const watts = a * a * hotOhms(d, tempC)
    run.push({ t, tempC, busy: on, watts })
    const target = c.ambC + watts * d.kPerW
    tempC = target + (tempC - target) * Math.exp(-ARM_JOINT.dt / d.tauS)
  }
  const k = (busy * ampsBusy ** 2 + (1 - busy) * ampsIdle ** 2) * d.ohms * d.kPerW
  const den = 1 - 0.0039 * k
  const steadyC = den <= 0 ? Infinity : c.ambC + (k * (1 + 0.0039 * (c.ambC - 25))) / den
  const wattsOf = (a: number) => a * a * hotOhms(d, Math.min(steadyC, d.maxC))
  return {
    d,
    needNm,
    peakNm,
    contNm,
    idleHoldNm,
    ampsBusy,
    ampsIdle,
    wattsBusy: wattsOf(ampsBusy),
    wattsIdle: wattsOf(ampsIdle),
    steadyC,
    run,
    overAt: run.find((f) => f.tempC >= d.maxC)?.t ?? null,
    canLift: needNm <= peakNm,
    slipsIdle: c.drive === 'stepper' && needNm > idleHoldNm,
  }
}
