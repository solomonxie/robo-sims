// Radio: wavelength, antennas, path loss, link budget, keying and LoRa.
const C = 299_792_458
const TAU = 2 * Math.PI

export const wavelength = (hz: number) => C / hz

/** Length of a λ/4 whip; real wire runs ~5 % short (`vf` 0.95). */
export const quarterWave = (hz: number, vf = 0.95) => (vf * wavelength(hz)) / 4

export const wattsToDbm = (w: number) => 10 * Math.log10(w * 1000)
export const dbmToWatts = (dbm: number) => 10 ** (dbm / 10) / 1000

/** Log-distance path loss: free space (Friis) out to 1 m, then 10·n·log10(d); n = 2 is the inverse-square law. */
export const pathLossDb = (meters: number, hz: number, n = 2) => 20 * Math.log10((4 * Math.PI * hz) / C) + 10 * n * Math.log10(meters)

/** Received power: transmit power plus antenna gains minus path and wall losses. */
export const rssiDbm = (txDbm: number, gainDb: number, meters: number, hz: number, lossDb = 0, n = 2) =>
  txDbm + gainDb - pathLossDb(meters, hz, n) - lossDb

/** Distance at which the path loss uses up `budgetDb`. */
export const rangeFor = (budgetDb: number, hz: number, n = 2) => 10 ** ((budgetDb - pathLossDb(1, hz, n)) / (10 * n))

/** Thermal noise in a receiver bandwidth: −174 dBm/Hz + 10·log10(B). */
export const noiseFloorDbm = (bwHz: number) => -174 + 10 * Math.log10(bwHz)

/** Weakest decodable signal: noise floor + receiver noise figure + the SNR the modulation needs (negative for LoRa). */
export const sensitivityDbm = (bwHz: number, nfDb: number, snrDb: number) => noiseFloorDbm(bwHz) + nfDb + snrDb

export const loraSnrLimit = (sf: number) => -7.5 - 2.5 * (sf - 7)
export const loraSymbolTime = (sf: number, bwHz: number) => 2 ** sf / bwHz
/** Useful bits per second with coding rate `cr` (4/5). */
export const loraBitRate = (sf: number, bwHz: number, cr = 4 / 5) => (sf * bwHz * cr) / 2 ** sf

/** Semtech time on air: 8-symbol preamble, explicit header, CRC, CR 4/5; low-data-rate optimise once symbols exceed 16 ms. */
export function loraAirtime(bytes: number, sf: number, bwHz: number) {
  const ts = loraSymbolTime(sf, bwHz)
  const de = ts > 0.016 ? 1 : 0
  const payload = 8 + Math.max(Math.ceil((8 * bytes - 4 * sf + 44) / (4 * (sf - 2 * de))) * 5, 0)
  return ts * (8 + 4.25 + payload)
}

export type Antenna = 'whip' | 'dipole' | 'chip'

/** Relative radiated power (0…1) at angle `theta` from the antenna axis: half-wave dipole cos(π/2·cosθ)/sinθ squared;
 *  a whip is half of one over its ground plane; a chip antenna is nearly omnidirectional. */
export function antennaPattern(kind: Antenna, theta: number) {
  const s = Math.sin(theta)
  if (kind === 'chip') return 0.55 + 0.45 * s * s
  if (kind === 'whip' && Math.cos(theta) < 0) return 0
  return Math.abs(s) < 1e-9 ? 0 : (Math.cos((Math.PI / 2) * Math.cos(theta)) / s) ** 2
}

export type Keying = 'ook' | 'fsk' | 'chirp'

const FSK_SHIFT = 0.25
const CHIRP_LO = 0.5

function slot(u: number, n: number) {
  const x = Math.min(n - 1e-9, Math.max(0, u * n))
  const k = Math.floor(x)
  return { k, tau: x - k }
}

/** Cycles an up-chirp completes `tau` (0…1) into a symbol: it sweeps lo → lo + span, starting `shift` (0…1) of the way up and wrapping. */
export function chirpCycles(tau: number, shift: number, lo: number, span: number) {
  const wrap = Math.max(0, tau - (1 - shift))
  return lo * tau + span * (shift * tau + (tau * tau) / 2 - wrap)
}

/** Instantaneous carrier frequency in cycles per symbol (0 when OOK is off). `symbols`: bits, or LoRa chirp offsets 0…1. */
export function keyedFreq(kind: Keying, u: number, symbols: number[], cycles: number) {
  const { k, tau } = slot(u, symbols.length)
  const s = symbols[k]
  if (kind === 'ook') return s ? cycles : 0
  if (kind === 'fsk') return cycles * (1 + (s ? FSK_SHIFT : -FSK_SHIFT))
  return cycles * (CHIRP_LO + ((s + tau) % 1))
}

/** Phase-continuous keyed carrier at u (0…1 across the frame), `cycles` carrier cycles per symbol. */
export function keyedAt(kind: Keying, u: number, symbols: number[], cycles: number) {
  const { k, tau } = slot(u, symbols.length)
  const s = symbols[k]
  if (kind === 'ook') return s ? Math.sin(TAU * cycles * (k + tau)) : 0
  if (kind === 'fsk') {
    const f = (b: number) => cycles * (1 + (b ? FSK_SHIFT : -FSK_SHIFT))
    const before = symbols.slice(0, k).reduce((a, b) => a + f(b), 0)
    return Math.sin(TAU * (before + f(s) * tau))
  }
  return Math.sin(TAU * (k * cycles + chirpCycles(tau, s, CHIRP_LO * cycles, cycles)))
}
