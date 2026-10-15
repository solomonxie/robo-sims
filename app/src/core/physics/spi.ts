// SPI bus: full-duplex shift registers, shared MISO with one CS per device, throughput for displays and SD cards.
import { Bit } from '../logic'
import { GPIO_VDD, driveOhms } from './gpio'

/** Master and slave 8-bit shift registers after `k` clocks, MSB first: each MSB goes out, the other's comes in at the LSB. */
export function spiShift(master: number, slave: number, k: number): [number, number] {
  const n = Math.max(0, Math.min(8, Math.round(k)))
  const shift = (a: number, b: number) => (a * 2 ** n + Math.floor(b / 2 ** (8 - n))) % 256
  return [shift(master, slave), shift(slave, master)]
}

/** Default ESP32 push-pull output (20 mA drive cap) as a resistance. */
export const MISO_DRIVE_OHMS = driveOhms(2)

/** One shared MISO wire: `null` drivers are tri-stated (CS high). Disagreeing drivers fight: high side vs low side as a divider. */
export function misoLine(drivers: (Bit | null)[], rOn = MISO_DRIVE_OHMS, vdd = GPIO_VDD) {
  const on = drivers.filter((d): d is Bit => d !== null)
  const highs = on.filter((d) => d === 1).length
  const lows = on.length - highs
  if (!on.length) return { state: 'z' as const, volts: null, amps: 0 }
  if (!highs || !lows) return { state: (highs ? 1 : 0) as Bit, volts: highs ? vdd : 0, amps: 0 }
  const rh = rOn / highs
  const rl = rOn / lows
  return { state: 'clash' as const, volts: (vdd * rl) / (rh + rl), amps: vdd / (rh + rl) }
}
export type MisoState = ReturnType<typeof misoLine>['state']

/** MISO bit by bit (MSB first) when every device with CS low drives its reply byte at once. */
export const misoRead = (replies: number[], selected: boolean[]) =>
  Array.from({ length: 8 }, (_, k) => misoLine(replies.map((r, i) => (selected[i] ? ((Math.floor(r / 2 ** (7 - k)) % 2) as Bit) : null))))

/** Byte value of a MISO read; null if any bit was floating or fought over. */
export function misoByte(bits: MisoState[]) {
  if (bits.some((b) => b === 'z' || b === 'clash')) return null
  return bits.reduce<number>((v, b) => v * 2 + (b as Bit), 0)
}

/** Back-to-back SPI bytes per second at `hz` (8 clocks each, `gapBits` idle clocks between bytes). */
export const spiByteRate = (hz: number, gapBits = 0) => hz / (8 + gapBits)

export const TFT = { name: 'ST7735', w: 128, h: 160, bpp: 16, setup: 11 }
/** One full RGB565 frame: CASET + RASET + RAMWR (11 bytes), then 2 bytes per pixel. */
export const tftFrameBytes = (w = TFT.w, h = TFT.h, bpp = TFT.bpp, setup = TFT.setup) => setup + (w * h * bpp) / 8

export const frameRate = (bytesPerSec: number, frameBytes: number) => bytesPerSec / frameBytes

export const SD_BLOCK = 512
/** SD cards in SPI mode: 400 kHz to initialise, then up to 25 MHz (default speed). */
export const SD_SPI_MAX = 25e6
export const SD_INIT_HZ = 400e3
/** Typical program time after one block (cards vary: 0.25–250 ms). */
export const SD_BUSY_S = 1e-3
/** CMD24 single-block write: 6 command + 2 R1 + token + 512 data + 2 CRC + data response bytes, then the card holds MISO low while it programs. */
export const SD_WRITE_PARTS = [
  { part: 'CMD24', bytes: 6 },
  { part: 'R1', bytes: 2 },
  { part: 'FE', bytes: 1 },
  { part: 'data', bytes: SD_BLOCK },
  { part: 'CRC', bytes: 2 },
  { part: 'resp', bytes: 1 },
]
export function sdBlockWrite(hz: number, busyS = SD_BUSY_S) {
  const clk = Math.min(hz, SD_SPI_MAX)
  const bytes = SD_WRITE_PARTS.reduce((a, p) => a + p.bytes, 0)
  const bus = (bytes * 8) / clk
  const total = bus + busyS
  return { clk, bytes, bus, busy: busyS, total, rate: SD_BLOCK / total }
}
