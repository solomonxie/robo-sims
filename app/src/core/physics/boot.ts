// ESP32 boot: strapping pins, USB-serial auto-reset, esptool upload over UART, OTA slots with rollback.
import { KB } from './storage'
import { FORMAT_8N1, frameLength } from './uart'

// --- Boot modes: straps sampled as EN rises, then ROM → 2nd-stage bootloader → app, or ROM download mode. ---

export interface Straps {
  io0: number
  io2: number
  io12: number
}
export const RUN_STRAPS: Straps = { io0: 1, io2: 0, io12: 0 }

/** GPIO_STRAP as the ROM prints it (`boot:0x13`): GPIO12 bit 5, GPIO0 bit 4, GPIO2 bit 3, GPIO4 bit 2, GPIO15 + GPIO5 high. */
export const strapByte = (s: Straps) => s.io12 * 32 + s.io0 * 16 + s.io2 * 8 + 3

export type BootMode = 'flash' | 'download' | 'invalid'
export const bootMode = (s: Straps): BootMode => (s.io0 ? 'flash' : s.io2 ? 'invalid' : 'download')

/** GPIO12 high at reset selects 1.8 V for the flash: a 3.3 V flash chip then reads back garbage. */
export const flashVolts = (s: Straps) => (s.io12 ? 1.8 : 3.3)

/** DevKit auto-reset: two NPNs between the USB-serial DTR/RTS and EN/GPIO0. Inputs are “asserted” (line pulled low). */
export const autoReset = (dtr: boolean, rts: boolean) => ({ en: rts && !dtr ? 0 : 1, io0: dtr && !rts ? 0 : 1 })

export const ROM_BAUD = 115200
export const STUB_BYTES = 13 * KB
export const FLASH_BLOCK = 16 * KB
export const ZLIB_RATIO = 0.62
/** SLIP escaping plus the 8-byte command and 16-byte block headers. */
const SLIP = 1.02
const BLOCK_HDR = 24
/** USB round trip + flash write of one block before the next is sent. */
export const BLOCK_ACK_S = 0.004
export const SYNC_S = 0.1
export const VERIFY_S = 0.2

export const uartByteS = (baud: number) => frameLength(FORMAT_8N1) / baud

/** esptool write_flash: sync and the RAM stub at 115200, then zlib-compressed 16 KB blocks at `baud`. */
export function uploadPlan(bytes: number, baud: number, ratio = ZLIB_RATIO) {
  const compressed = Math.round(bytes * ratio)
  const blocks = Math.ceil(compressed / FLASH_BLOCK)
  const blockS = (k: number) => (Math.min(FLASH_BLOCK, compressed - k * FLASH_BLOCK) + BLOCK_HDR) * SLIP * uartByteS(baud) + BLOCK_ACK_S
  const writeS = Array.from({ length: blocks }, (_, k) => blockS(k)).reduce((a, b) => a + b, 0)
  const stubS = STUB_BYTES * SLIP * uartByteS(ROM_BAUD)
  return { compressed, blocks, writeS, stubS, totalS: SYNC_S + stubS + writeS + VERIFY_S, kbitps: (bytes * 8) / writeS / 1000 }
}

/** ROM init + loading the ~26 KB 2nd-stage bootloader; then it reads the table + otadata, loads and checks the app. */
export const ROM_S = 0.03
export const BOOT2_S = 0.25

export type BootStart = 'reset' | 'button' | 'esptool' | 'gpio12'
export type BootStage = 'app' | 'reset' | 'rom' | 'boot2' | 'download' | 'sync' | 'stub' | 'write' | 'verify' | 'error'
export interface BootPhase {
  stage: BootStage
  s: number
  dtr: boolean
  rts: boolean
  en: number
  io0: number
  io12: number
  uart: boolean
}

/** Phases from a running app through a reset (and maybe an upload) back to the app, each with constant pin levels. */
export function bootScript(start: BootStart, bytes: number, baud: number): BootPhase[] {
  const up = uploadPlan(bytes, baud)
  const P = (stage: BootStage, s: number, o: Partial<BootPhase> = {}): BootPhase => {
    const dtr = o.dtr ?? false
    const rts = o.rts ?? false
    const auto = autoReset(dtr, rts)
    return { io12: 0, uart: false, ...o, stage, s, dtr, rts, en: Math.min(auto.en, o.en ?? 1), io0: Math.min(auto.io0, o.io0 ?? 1) }
  }
  const boot = [P('rom', ROM_S, { uart: true }), P('boot2', BOOT2_S, { uart: true }), P('app', 1)]
  const upload = (held: Partial<BootPhase>) => [
    P('sync', SYNC_S, { ...held, uart: true }),
    P('stub', up.stubS, { ...held, uart: true }),
    P('write', up.writeS, { uart: true }),
    P('verify', VERIFY_S, { uart: true }),
  ]
  if (start === 'reset') return [P('app', 0.4), P('reset', 0.1, { en: 0 }), ...boot]
  if (start === 'gpio12') {
    const fail = [P('reset', 0.1, { en: 0, io12: 1 }), P('rom', ROM_S, { io12: 1, uart: true }), P('error', 0.3, { io12: 1, uart: true })]
    return [P('app', 0.4), ...fail, ...fail]
  }
  if (start === 'button')
    return [P('app', 0.4), P('app', 0.3, { io0: 0 }), P('reset', 0.1, { en: 0, io0: 0 }), P('download', 0.2, { io0: 0 }), ...upload({ io0: 0 }), P('reset', 0.1, { en: 0 }), ...boot]
  return [
    P('app', 0.4),
    P('reset', 0.1, { rts: true }),
    P('download', 0.05, { dtr: true }),
    P('download', 0.15),
    ...upload({}),
    P('reset', 0.1, { rts: true }),
    ...boot,
  ]
}

/** Mode the ROM picks when EN rises after phase `i`'s reset, from the pins at that moment. */
export function sampledMode(ph: BootPhase[], i: number) {
  const s = { io0: ph[i].io0, io2: 0, io12: ph[i].io12 }
  return { straps: s, mode: bootMode(s), byte: strapByte(s), volts: flashVolts(s) }
}

// --- OTA updates: otadata picks the app slot; with rollback a new image must mark itself valid. ---

export type OtaState = 'empty' | 'new' | 'pending' | 'valid' | 'aborted' | 'unset'
/** One of the two otadata sectors: a sequence number and the image state. */
export interface OtaSector {
  seq: number
  state: OtaState
}
export const OTA_EMPTY: OtaSector[] = [
  { seq: 0, state: 'empty' },
  { seq: 0, state: 'empty' },
]
export const otaSlot = (seq: number) => (seq - 1) % 2

const usable = (x: OtaSector) => x.seq > 0 && x.state !== 'aborted'

/** Bootloader: highest usable seq wins (none → app0). With rollback, NEW → PENDING; a PENDING found at boot never
 *  confirmed itself, so it's ABORTED and the older slot boots. */
export function otaSelect(d: OtaSector[], rollback: boolean) {
  const data = d.map((x) => ({ ...x }))
  let rolledBack = false
  for (;;) {
    const best = data.filter(usable).sort((a, b) => b.seq - a.seq)[0]
    if (!best) return { slot: 0, otadata: data, rolledBack }
    if (rollback && best.state === 'pending') {
      best.state = 'aborted'
      rolledBack = true
      continue
    }
    if (rollback && best.state === 'new') best.state = 'pending'
    return { slot: otaSlot(best.seq), otadata: data, rolledBack }
  }
}

/** esp_ota_set_boot_partition: next seq that maps to `slot`, written into the other sector than the current one. */
export function otaSetBoot(d: OtaSector[], slot: number, rollback: boolean) {
  const top = Math.max(0, ...d.map((x) => x.seq))
  let seq = top + 1
  while (otaSlot(seq) !== slot) seq++
  const cur = d.findIndex((x) => x.seq === top && top > 0)
  const into = cur < 0 ? 0 : 1 - cur
  return d.map((x, i) => (i === into ? { seq, state: (rollback ? 'new' : 'unset') as OtaState } : { ...x }))
}

export const otaMarkValid = (d: OtaSector[]) => {
  const top = Math.max(...d.map((x) => x.seq))
  return d.map((x) => (x.seq === top && x.state === 'pending' ? { ...x, state: 'valid' as OtaState } : { ...x }))
}

export type OtaImage = 'good' | 'crash' | 'corrupt'
export type OtaKey = 'run' | 'download' | 'verify' | 'reject' | 'switch' | 'reboot' | 'boot' | 'health' | 'valid' | 'panic' | 'rollback'
export interface OtaStep {
  key: OtaKey
  s: number
  /** App slot executing (−1 = none, rebooting). */
  slot: number
  otadata: OtaSector[]
  /** Fraction of the new image in the idle slot. */
  written: number
  version: string
}

export const OTA_IMAGE_BYTES = 1000 * KB
export const OTA_VERIFY_S = 0.15
export const OTADATA_WRITE_S = 0.05
export const HEALTH_S = 3
export const PANIC_AT_S = 0.6

/** The whole update: download into app1 while app0 keeps running, check, flip otadata, reboot, health check. */
export function otaStory(image: OtaImage, rollback: boolean, bytesPerS: number, bytes = OTA_IMAGE_BYTES): OtaStep[] {
  const out: OtaStep[] = []
  let d = OTA_EMPTY
  const S = (key: OtaKey, s: number, slot: number, written = 1, version = slot === 1 ? 'v1.1' : 'v1.0') => out.push({ key, s, slot, otadata: d, written, version })
  S('run', 2, 0, 0)
  S('download', bytes / bytesPerS, 0, 0)
  S('verify', OTA_VERIFY_S, 0)
  if (image === 'corrupt') {
    S('reject', 2, 0)
    return out
  }
  d = otaSetBoot(d, 1, rollback)
  S('switch', OTADATA_WRITE_S, 0)
  for (let k = 0; k < (rollback ? 2 : 3); k++) {
    S('reboot', 0.1, -1)
    const sel = otaSelect(d, rollback)
    d = sel.otadata
    S('boot', ROM_S + BOOT2_S, -1)
    if (sel.slot === 0) {
      S('rollback', 2, 0)
      return out
    }
    if (image === 'good') {
      S('health', HEALTH_S, 1)
      d = rollback ? otaMarkValid(d) : d
      S('valid', 2, 1)
      return out
    }
    S('panic', PANIC_AT_S, 1)
  }
  return out
}

/** Robot downtime of the update: reboots, boot time and crashed runs. */
export const otaDowntimeS = (story: OtaStep[]) => story.filter((x) => x.slot < 0 || x.key === 'panic').reduce((a, x) => a + x.s, 0)
