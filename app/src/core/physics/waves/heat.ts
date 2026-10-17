// Heat transfer as a circuit: °C/W like Ω, watts like amps, °C like volts. Conduction L/(kA), convection 1/(hA), radiation linearised
// from netRadiatedW, a lumped heat capacity for the warm-up, and a linear regulator on a choice of coolers.
import { LinearReg, Thermal, ldoThermalStep, linearReg } from '../regulators'
import { EMISSIVITY, netRadiatedW } from './thermal'

/** Conductivity k (W/(m·K)), volumetric heat capacity ρc (J/(m³·K)) and emissivity of a plate's faces. */
export const SOLIDS = {
  copper: { name: 'Copper', k: 400, rhoC: 3.45e6, eps: 0.1 },
  aluminium: { name: 'Aluminium', k: 205, rhoC: 2.42e6, eps: EMISSIVITY.aluminium.eps },
  steel: { name: 'Steel', k: 50, rhoC: 3.6e6, eps: 0.3 },
  fr4: { name: 'FR4 board, no copper', k: 0.3, rhoC: 2.0e6, eps: 0.9 },
} as const
export type PlateSolid = keyof typeof SOLIDS

/** Layer between the part's tab and the plate: conductivity and thickness, m. */
export const INTERFACES = {
  paste: { name: 'Thermal paste', k: 3, t: 0.05e-3 },
  pad: { name: 'Silicone pad 1 mm', k: 3, t: 1e-3 },
  air: { name: 'Air gap 0.1 mm', k: 0.026, t: 0.1e-3 },
} as const
export type Interface = keyof typeof INTERFACES

/** Convection coefficient h, W/(m²·K): still air vs a small fan (~2 m/s). */
export const AIRFLOW = {
  still: { name: 'Still air', h: 8 },
  fan: { name: 'Fan, 2 m/s', h: 40 },
} as const
export type Airflow = keyof typeof AIRFLOW

/** Conduction through a slab, °C/W. */
export const conductionR = (k: number, thicknessM: number, areaM2: number) => thicknessM / (k * areaM2)
/** Convection from a surface, °C/W. */
export const convectionR = (h: number, areaM2: number) => 1 / (h * areaM2)
/** Radiation as a conductance at surface temperature `tC`, W/K (εσ(T⁴ − Ta⁴) / ΔT). */
export const radiationG = (tC: number, eps: number, ambC: number, areaM2: number): number =>
  Math.abs(tC - ambC) < 1e-6 ? radiationG(ambC + 1e-3, eps, ambC, areaM2) : netRadiatedW(tC, eps, ambC, areaM2) / (tC - ambC)

/** Node temperatures down a series chain carrying `watts`: [hot end, …, ambient]. */
export function chainTemps(rs: readonly number[], watts: number, ambC: number) {
  const out = [ambC]
  for (let i = rs.length - 1; i >= 0; i--) out.unshift(out[0] + watts * rs[i])
  return out
}

export interface PlateCfg {
  watts: number
  solid: PlateSolid
  thicknessM: number
  sideM: number
  joint: Interface
  air: Airflow
  ambC?: number
}

/** TO-220 part: tab footprint side (m), junction-to-case °C/W, own heat capacity J/K. */
export const TAB = { side: 0.01, thetaJC: 2, heatJPerK: 1 }

/** Plate cooling a TO-220 part: series resistances junction → case → plate → far face → air, steady temperatures and τ.
 *  Heat spreads at 45° through the thickness; both faces shed it by convection plus radiation. */
export function plateChain(c: PlateCfg) {
  const ambC = c.ambC ?? 25
  const S = SOLIDS[c.solid]
  const J = INTERFACES[c.joint]
  const foot = TAB.side ** 2
  const spread = Math.min(c.sideM, TAB.side + c.thicknessM) ** 2
  const rJoint = conductionR(J.k, J.t, foot)
  const rPlate = conductionR(S.k, c.thicknessM, spread)
  const face = 2 * c.sideM ** 2
  const gConv = 1 / convectionR(AIRFLOW[c.air].h, face)
  let ts = ambC + c.watts / gConv
  for (let i = 0; i < 40; i++) ts = ambC + c.watts / (gConv + radiationG(ts, S.eps, ambC, face))
  const gRad = radiationG(ts, S.eps, ambC, face)
  const rAir = 1 / (gConv + gRad)
  const rs = [TAB.thetaJC, rJoint, rPlate, rAir]
  const heatJPerK = S.rhoC * c.sideM ** 2 * c.thicknessM + TAB.heatJPerK
  return {
    rs,
    rTotal: rs.reduce((a, b) => a + b, 0),
    temps: chainTemps(rs, c.watts, ambC),
    radShare: gRad / (gConv + gRad),
    heatJPerK,
    tauS: heatJPerK * rAir,
    ambC,
  }
}

/** Warm-up from ambient: the plate is one lump C charged through the air path (radiation kept non-linear); the junction
 *  sits P·(θjc + joint + plate) above it. Samples every `dt` s. */
export function plateRun(c: PlateCfg, seconds: number, dt = 1) {
  const ch = plateChain(c)
  const S = SOLIDS[c.solid]
  const face = 2 * c.sideM ** 2
  const h = AIRFLOW[c.air].h
  const inner = c.watts * (ch.rs[0] + ch.rs[1] + ch.rs[2])
  const out: { ts: number; tj: number }[] = []
  let ts = ch.ambC
  for (let t = 0; t <= seconds + 1e-9; t += dt) {
    out.push({ ts, tj: ts + inner })
    const shed = h * face * (ts - ch.ambC) + netRadiatedW(ts, S.eps, ch.ambC, face)
    ts += ((c.watts - shed) / ch.heatJPerK) * dt
  }
  return { chain: ch, run: out }
}

/** LM7805 in TO-220: 2 V dropout, 5 mA ground current, θjc 5 °C/W, standing bare 50 °C/W, shuts down at 150 °C. */
export const LM7805: LinearReg = {
  vout: 5,
  dropout0: 1.7,
  dropoutPerAmp: 0.3,
  iq: 0.005,
  maxAmps: 1.5,
  thetaJA: 50,
  tMax: 125,
  tOff: 150,
  tOn: 135,
  tauS: 90,
  psrrDb: 70,
}

/** Ways to cool a TO-220 regulator: case→sink and sink→air °C/W (typical datasheet values), and heat capacity J/K. */
export const REG_COOLERS = {
  bare: { name: 'Nothing, standing in air', thetaCS: 0, thetaSA: 45, heatJPerK: 2 },
  pcb: { name: 'Tab soldered to 6 cm² copper', thetaCS: 1, thetaSA: 30, heatJPerK: 6 },
  clip: { name: 'Clip-on fin sink', thetaCS: 1, thetaSA: 18, heatJPerK: 8 },
  finned: { name: 'Finned sink 40 mm + paste', thetaCS: 0.5, thetaSA: 6, heatJPerK: 30 },
  fan: { name: 'Finned sink + fan', thetaCS: 0.5, thetaSA: 1.5, heatJPerK: 30 },
} as const
export type RegCooler = keyof typeof REG_COOLERS

/** Regulator on a cooler: its chain [θjc, θcs, θsa], total θja and τ = C·θ. */
export function cooledReg(r: LinearReg, thetaJC: number, k: RegCooler): LinearReg & { chain: number[] } {
  const C = REG_COOLERS[k]
  const chain = [thetaJC, C.thetaCS, C.thetaSA]
  const thetaJA = chain[0] + chain[1] + chain[2]
  return { ...r, thetaJA, tauS: C.heatJPerK * thetaJA, chain }
}

/** Junction temperature over time from ambient, with thermal shutdown cycling; share of time the output is on. */
export function regHeatRun(r: LinearReg, vin: number, amps: number, seconds: number, dt = 0.5, ambC = 25) {
  let s: Thermal = { tj: ambC, on: true }
  const run: Thermal[] = []
  let on = 0
  let counted = 0
  for (let t = 0; t <= seconds + 1e-9; t += dt) {
    run.push(s)
    if (t >= seconds / 2) [on, counted] = [on + (s.on ? 1 : 0), counted + 1]
    s = ldoThermalStep(r, s, dt, vin, amps, ambC)
  }
  const P = linearReg(r, vin, amps).power
  return { run, watts: P, steadyC: ambC + r.thetaJA * P, onShare: counted ? on / counted : 1, trips: run.some((x) => !x.on) }
}
