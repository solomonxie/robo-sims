// Electromagnetic spectrum: c = f·λ, photon energy, named bands, robot parts placed on it, and what blocks each band.
import { LIGHT_C } from '../common'
import { photonEv } from '../semiconductors'
import { quarterWave, wavelength } from '../signals/radio'
import { L1_HZ } from '../sensors/gps'
import { IR_NM } from '../sensors/infrared'
import { VL53L0X } from '../sensors/tof'
import { SENSOR_BANDS, bandShare } from './thermal'

export const hzOfLambda = (m: number) => LIGHT_C / m
/** Photon energy E = h·f, in eV. */
export const photonEvAt = (hz: number) => photonEv(wavelength(hz) * 1e9)
/** Above ~10 eV a photon can knock an electron off an atom. */
export const IONISING_EV = 10

/** Bands by wavelength (m), long to short. The radio / microwave line is a convention, not physics. */
export const EM_BANDS = [
  { key: 'radio', name: 'Radio', lo: 0.1, hi: Infinity },
  { key: 'microwave', name: 'Microwave', lo: 1e-3, hi: 0.1 },
  { key: 'infrared', name: 'Infrared', lo: 750e-9, hi: 1e-3 },
  { key: 'visible', name: 'Visible', lo: 380e-9, hi: 750e-9 },
  { key: 'uv', name: 'Ultraviolet', lo: 10e-9, hi: 380e-9 },
  { key: 'xray', name: 'X-ray', lo: 10e-12, hi: 10e-9 },
  { key: 'gamma', name: 'Gamma', lo: 0, hi: 10e-12 },
] as const
export type EmBand = (typeof EM_BANDS)[number]
export const emBandOf = (m: number): EmBand => EM_BANDS.find((b) => m >= b.lo && m < b.hi) ?? EM_BANDS[0]

/** Everyday things for a sense of size, m. */
const SIZE_REFS = [
  { name: 'a house', m: 8 },
  { name: 'a person', m: 1.7 },
  { name: 'a phone', m: 0.15 },
  { name: 'a coin', m: 0.02 },
  { name: 'an ant', m: 3e-3 },
  { name: 'a sand grain', m: 0.5e-3 },
  { name: 'a hair, across', m: 80e-6 },
  { name: 'a blood cell', m: 8e-6 },
  { name: 'a bacterium', m: 1.5e-6 },
  { name: 'a virus', m: 100e-9 },
  { name: 'a protein', m: 10e-9 },
  { name: 'a sugar molecule', m: 1e-9 },
  { name: 'an atom', m: 0.1e-9 },
] as const
export const sizeLike = (m: number) => SIZE_REFS.reduce((a, b) => (Math.abs(Math.log(b.m / m)) < Math.abs(Math.log(a.m / m)) ? b : a))

/** Familiar sources along the spectrum, Hz. */
export const EM_LANDMARKS = [
  { name: 'LoRa', hz: 868e6 },
  { name: 'GPS', hz: L1_HZ },
  { name: 'Wi-Fi', hz: 2.437e9 },
  { name: 'Wi-Fi 5G', hz: 5.5e9 },
  { name: 'radar 24G', hz: 24.125e9 },
  { name: 'radar 60G', hz: 60e9 },
  { name: 'body heat', hz: hzOfLambda(9.3e-6) },
  { name: 'IR remote', hz: hzOfLambda(IR_NM * 1e-9) },
  { name: 'red laser', hz: hzOfLambda(650e-9) },
  { name: 'green', hz: hzOfLambda(532e-9) },
  { name: 'blue LED', hz: hzOfLambda(450e-9) },
  { name: 'UV LED', hz: hzOfLambda(365e-9) },
  { name: 'dental X-ray', hz: hzOfLambda(30e-12) },
] as const
/** The landmark within `decades` of `hz`, if any. */
export function landmarkNear(hz: number, decades = 0.06) {
  let best: (typeof EM_LANDMARKS)[number] | null = null
  for (const l of EM_LANDMARKS) if (Math.abs(Math.log10(l.hz / hz)) <= decades && (!best || Math.abs(Math.log10(l.hz / hz)) < Math.abs(Math.log10(best.hz / hz)))) best = l
  return best
}

/** Everything about one frequency. */
export function emAt(hz: number) {
  const lambda = wavelength(hz)
  const ev = photonEvAt(hz)
  const band = emBandOf(lambda)
  return {
    hz,
    lambda,
    ev,
    band,
    like: sizeLike(lambda),
    ionising: ev >= IONISING_EV,
    antenna: lambda >= 1e-3 ? quarterWave(hz) : null,
    seenBy: (Object.keys(SENSOR_BANDS) as (keyof typeof SENSOR_BANDS)[]).filter((k) => lambda >= SENSOR_BANDS[k].lo && lambda <= SENSOR_BANDS[k].hi),
  }
}

/** Loss through a few obstacles: points (λ m, dB) long to short, log-λ interpolated, flat beyond the ends. */
export const OBSTACLES = {
  wall: { name: 'Brick wall', pts: [[3, 5], [0.35, 7], [0.125, 10], [0.06, 15], [0.0125, 40], [0.005, 60], [1e-3, 100]] },
  glass: { name: 'Window glass', pts: [[3, 0.5], [5e-3, 2], [1e-3, 6], [20e-6, 100], [5e-6, 30], [2.7e-6, 1], [0.4e-6, 0.4], [0.33e-6, 3], [0.3e-6, 20], [0.25e-6, 100]] },
  fog: { name: '100 m of fog', pts: [[3, 0], [0.01, 0.1], [1e-3, 3], [12e-6, 8], [2e-6, 30], [0.4e-6, 40], [0.2e-6, 40]] },
  water: { name: '2 cm of water', pts: [[1, 4], [0.35, 8], [0.125, 20], [0.06, 35], [0.0125, 100], [3e-6, 100], [1.4e-6, 40], [1e-6, 3], [0.94e-6, 2], [0.7e-6, 0.1], [0.4e-6, 0.02], [0.2e-6, 0.5]] },
} as const
export type Obstacle = keyof typeof OBSTACLES
export function throughDb(o: Obstacle, m: number) {
  const pts = OBSTACLES[o].pts
  if (m >= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    const [l1, d1] = pts[i]
    if (m >= l1) {
      const [l0, d0] = pts[i - 1]
      return d0 + ((d1 - d0) * Math.log(m / l0)) / Math.log(l1 / l0)
    }
  }
  return pts[pts.length - 1][1]
}
export const throughShare = (o: Obstacle, m: number) => 10 ** (-throughDb(o, m) / 10)

const SUN_K = 5778
/** Share of the sun's power that lands in a band (before the atmosphere). */
export const sunShare = (lo: number, hi: number) => bandShare(SUN_K, lo, hi, 60)

const radio = (hz0: number, hz1: number) => ({ lo: wavelength(hz1), hi: wavelength(hz0) })
const nm = (a: number, b: number) => ({ lo: a * 1e-9, hi: b * 1e-9 })

/** Robot parts and where they sit on the spectrum (band in m). */
export const SPECTRUM_PARTS = {
  lora: { name: 'LoRa SX1276', ...radio(863e6, 870e6), good: 'km range at a trickle of data', blocked: 'little: walls cost a few dB; hills and metal block', see: 'Signals › Radio basics › LoRa' },
  gps: { name: 'GPS NEO-6M', ...radio(L1_HZ - 1e6, L1_HZ + 1e6), good: 'position anywhere under open sky', blocked: 'roofs, walls, dense trees: signals arrive weaker than noise', see: 'Sensors › GPS' },
  wifi: { name: 'ESP32 Wi-Fi + BT', ...radio(2.4e9, 2.4835e9), good: 'Mbit/s across a house', blocked: 'each wall ~10 dB, water and bodies soak it up', see: 'Microcontrollers › Wi-Fi & Bluetooth' },
  nrf24: { name: 'nRF24L01', ...radio(2.4e9, 2.525e9), good: 'cheap low-latency remote links', blocked: 'same as Wi-Fi, and Wi-Fi crowds its channels', see: 'Signals › Radio basics › 2.4 GHz' },
  radar: { name: 'LD2410 24 GHz radar', ...radio(24e9, 24.25e9), good: 'presence and motion, through a plastic case', blocked: 'walls and metal; water reflects it strongly', see: 'Sound & ultrasound › Doppler (same maths)' },
  remote: { name: 'IR remote VS1838B', ...nm(IR_NM - 40, IR_NM + 40), good: '38 kHz-coded commands at a few metres', blocked: 'anything opaque; bright sun swamps it', see: 'Sensors › Infrared' },
  tcrt: { name: 'TCRT5000 line sensor', ...nm(IR_NM - 30, IR_NM + 30), good: 'black vs white tape at 2–10 mm', blocked: 'sunlight leaking under the robot', see: 'Sensors › Infrared › Line follower' },
  tof: { name: 'VL53L0X ToF laser', ...nm(VL53L0X.nm - 10, VL53L0X.nm + 10), good: 'mm distance up to ~2 m', blocked: 'sunlight cuts range; glass and black felt confuse it', see: 'Sensors › Time-of-flight laser' },
  camera: { name: 'OV2640 camera', lo: SENSOR_BANDS.silicon.lo, hi: SENSOR_BANDS.silicon.hi, good: 'colour images; without its IR filter it also sees 940 nm', blocked: 'darkness, fog, glare', see: 'Sensors › Camera' },
  thermal: { name: 'MLX90640 thermal', lo: SENSOR_BANDS.thermal.lo, hi: SENSOR_BANDS.thermal.hi, good: 'people and hot parts in the dark', blocked: 'glass is a wall to it; shiny metal mirrors', see: 'Infrared & thermal › Thermal camera' },
  uv: { name: 'GUVA-S12SD UV', ...nm(240, 370), good: 'UV index, flame detection', blocked: 'window glass, most plastics', see: 'Light & optics' },
} as const
export type SpectrumPart = keyof typeof SPECTRUM_PARTS

/** A part's band as frequencies, photon energies, obstacle losses and sunlight share. */
export function partView(k: SpectrumPart) {
  const p = SPECTRUM_PARTS[k]
  const mid = Math.sqrt(p.lo * p.hi)
  return {
    key: k,
    ...p,
    mid,
    hzLo: hzOfLambda(p.hi),
    hzHi: hzOfLambda(p.lo),
    ev: photonEv(mid * 1e9),
    band: emBandOf(mid),
    loss: (Object.keys(OBSTACLES) as Obstacle[]).map((o) => throughDb(o, mid)),
    sun: sunShare(p.lo, p.hi),
    antenna: mid >= 1e-3 ? quarterWave(hzOfLambda(mid)) : null,
  }
}
