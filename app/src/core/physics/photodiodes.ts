// Photodiodes and solar cells: photocurrent from light, the lit diode equation, max-power point, transimpedance amp.
import { bisectRoot } from './common'
import { OpAmp, Rails, saturate } from './opamps'
import { SI_BANDGAP_EV, photonEv, thermalVoltage } from './semiconductors'

/** Longest wavelength silicon absorbs, nm: photon energy = band gap. */
export const SI_CUTOFF_NM = photonEv(SI_BANDGAP_EV)

/** Responsivity in A/W: each absorbed photon (above the gap) gives one electron, so R = QE·λ/1239.84. */
export const responsivity = (nm: number, qe = 0.8) => (nm < SI_CUTOFF_NM ? (qe * nm) / 1239.84 : 0)

/** Photocurrent I = E·A·R: irradiance W/m², area m², responsivity A/W. */
export const photocurrent = (wPerM2: number, areaM2: number, aPerW: number) => Math.max(0, wPerM2) * areaM2 * aPerW

/** Sunlight ≈ 110 lm per W. */
export const SUN_LUX_PER_W = 110
export const luxToIrradiance = (lux: number) => lux / SUN_LUX_PER_W

export interface SolarCell {
  areaM2: number
  /** Short-circuit current density at 1000 W/m², A/m². */
  jsc: number
  /** Dark saturation current, A, and ideality. */
  saturationA: number
  ideality: number
}

/** 5 × 5 cm mono-silicon cell: 34 mA/cm², Voc ≈ 0.6 V in full sun. */
export const SOLAR_CELL: SolarCell = { areaM2: 25e-4, jsc: 340, saturationA: 3e-9, ideality: 1.2 }

export const cellPhotoA = (wPerM2: number, c: SolarCell = SOLAR_CELL) => (c.jsc * c.areaM2 * Math.max(0, wPerM2)) / 1000

/** Diode convention: I = Is·(e^(V/nVt) − 1) − Iph. Light shifts the dark curve down by Iph; delivered current is −I. */
export const litDiodeAmps = (v: number, wPerM2: number, c: SolarCell = SOLAR_CELL) =>
  c.saturationA * Math.expm1(v / (c.ideality * thermalVoltage())) - cellPhotoA(wPerM2, c)

/** Open-circuit voltage: Voc = nVt·ln(Iph/Is + 1). */
export const cellVoc = (wPerM2: number, c: SolarCell = SOLAR_CELL) =>
  c.ideality * thermalVoltage() * Math.log1p(cellPhotoA(wPerM2, c) / c.saturationA)

/** Max-power point: V, I (delivered), P, fill factor P/(Voc·Isc), efficiency P/(E·A). */
export function cellMpp(wPerM2: number, c: SolarCell = SOLAR_CELL) {
  const voc = cellVoc(wPerM2, c)
  const isc = cellPhotoA(wPerM2, c)
  if (isc <= 0) return { v: 0, i: 0, p: 0, voc: 0, isc: 0, fill: 0, efficiency: 0 }
  const nvt = c.ideality * thermalVoltage()
  // dP/dV = Iph − Is(e^x − 1) − Is·x·e^x, x = V/nVt: falls from > 0 at 0 to < 0 at Voc.
  const x = bisectRoot((u) => isc - c.saturationA * Math.expm1(u) - c.saturationA * u * Math.exp(u), 0, voc / nvt)
  const v = x * nvt
  const i = -litDiodeAmps(v, wPerM2, c)
  const p = v * i
  return { v, i, p, voc, isc, fill: p / (voc * isc), efficiency: p / (wPerM2 * c.areaM2) }
}

/** Cell driving a resistor: V = I·R where the lit curve meets the load line. */
export function cellOnLoad(wPerM2: number, ohms: number, c: SolarCell = SOLAR_CELL) {
  const voc = cellVoc(wPerM2, c)
  const v = voc > 0 ? bisectRoot((u) => -litDiodeAmps(u, wPerM2, c) - u / ohms, 0, voc) : 0
  const i = v / ohms
  return { v, i, p: v * i }
}

export interface Photodiode {
  areaM2: number
  /** A/W at the test wavelength. */
  aPerW: number
  /** Dark current at `darkAtV` reverse, A. */
  darkA: number
  darkAtV: number
  /** Zero-bias junction capacitance, F, and built-in voltage. */
  cj0: number
  vbi: number
}

/** BPW34: 7.5 mm² PIN photodiode, 0.6 A/W, 2 nA dark at 10 V, 70 pF at 0 V. */
export const BPW34: Photodiode = { areaM2: 7.5e-6, aPerW: 0.6, darkA: 2e-9, darkAtV: 10, cj0: 70e-12, vbi: 0.6 }

/** Junction capacitance: the depletion zone widens as √(Vbi + Vr), so C = Cj0 / √(1 + Vr/Vbi). */
export const pdCapacitance = (vr: number, d: Photodiode = BPW34) => d.cj0 / Math.sqrt(1 + Math.max(0, vr) / d.vbi)

/** Dark (leak) current: generation in the depletion zone ∝ its width; none with 0 V across (photovoltaic mode). */
export const pdDarkA = (vr: number, d: Photodiode = BPW34) =>
  vr <= 0 ? 0 : (d.darkA * (Math.sqrt(d.vbi + vr) - Math.sqrt(d.vbi))) / (Math.sqrt(d.vbi + d.darkAtV) - Math.sqrt(d.vbi))

/** Photocurrent from illuminance in lux (sunlight spectrum). */
export const pdPhotoA = (lux: number, d: Photodiode = BPW34) => photocurrent(luxToIrradiance(lux), d.areaM2, d.aPerW)

/** TL072 gain–bandwidth, Hz; plus ~5 pF of op-amp input capacitance. */
export const TIA_GBW = 3e6
export const TIA_CIN = 5e-12

/** Transimpedance amp, photodiode into V− (virtual ground), anode at −Vr: Vout = (Iph + Idark)·Rf, clipped at the rails.
 *  Bandwidth of the uncompensated loop ≈ √(GBW / (2π·Rf·C)); rise time 10–90 % ≈ 0.35 / f. */
export function tia(lux: number, rf: number, vr: number, op: OpAmp, rails: Rails, d: Photodiode = BPW34, gbw = TIA_GBW) {
  const photoA = pdPhotoA(lux, d)
  const darkA = pdDarkA(vr, d)
  const ideal = (photoA + darkA) * rf
  const vout = saturate(op, ideal, rails)
  const c = pdCapacitance(vr, d) + TIA_CIN
  const hz = Math.sqrt(gbw / (2 * Math.PI * rf * c))
  return { photoA, darkA, ideal, vout, clipped: vout < ideal - 1e-9, capF: c, hz, riseS: 0.35 / hz }
}

/** Lux at which the photocurrent equals the dark current: below it the reading is mostly leak. */
export const darkFloorLux = (vr: number, d: Photodiode = BPW34) => pdDarkA(vr, d) / pdPhotoA(1, d)
