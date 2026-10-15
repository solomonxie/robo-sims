import {
  OTA_EMPTY,
  RUN_STRAPS,
  autoReset,
  bootMode,
  bootScript,
  flashVolts,
  otaDowntimeS,
  otaMarkValid,
  otaSelect,
  otaSetBoot,
  otaStory,
  sampledMode,
  strapByte,
  uploadPlan,
} from './boot'
import { KB, MB } from './memory'

describe('ESP32 strapping pins', () => {
  it('prints the ROM boot byte for flash, download and GPIO12-high', () => {
    expect(strapByte(RUN_STRAPS)).toBe(0x13)
    expect(strapByte({ ...RUN_STRAPS, io0: 0 })).toBe(0x03)
    expect(strapByte({ ...RUN_STRAPS, io12: 1 })).toBe(0x33)
  })
  it('GPIO0 low (GPIO2 low) is download mode; GPIO12 high drops the flash to 1.8 V', () => {
    expect(bootMode(RUN_STRAPS)).toBe('flash')
    expect(bootMode({ ...RUN_STRAPS, io0: 0 })).toBe('download')
    expect(bootMode({ io0: 0, io2: 1, io12: 0 })).toBe('invalid')
    expect(flashVolts({ ...RUN_STRAPS, io12: 1 })).toBe(1.8)
  })
  it('auto-reset: RTS alone holds EN low, DTR alone pulls GPIO0 low, both or none do nothing', () => {
    expect(autoReset(false, true)).toEqual({ en: 0, io0: 1 })
    expect(autoReset(true, false)).toEqual({ en: 1, io0: 0 })
    expect(autoReset(true, true)).toEqual({ en: 1, io0: 1 })
    expect(autoReset(false, false)).toEqual({ en: 1, io0: 1 })
  })
})

describe('esptool upload', () => {
  it('1 MB at 921600 takes a few seconds, ~8× faster than at 115200', () => {
    const fast = uploadPlan(MB, 921600)
    const slow = uploadPlan(MB, 115200)
    expect(fast.blocks).toBe(Math.ceil((MB * 0.62) / (16 * KB)))
    expect(fast.writeS).toBeGreaterThan(6)
    expect(fast.writeS).toBeLessThan(8)
    expect(slow.writeS / fast.writeS).toBeGreaterThan(7)
    expect(fast.kbitps).toBeGreaterThan(921.6)
    expect(fast.stubS).toBeCloseTo(slow.stubS)
  })
})

describe('boot script', () => {
  const resetAfter = (ph: ReturnType<typeof bootScript>) => ph.findIndex((p, i) => i > 0 && ph[i - 1].en === 0 && p.en === 1)
  it('esptool: RTS reset, then DTR pulls GPIO0 low as EN rises → download; RTS reset again → flash boot', () => {
    const ph = bootScript('esptool', MB, 921600)
    const first = resetAfter(ph)
    expect(sampledMode(ph, first).mode).toBe('download')
    expect(ph[first].dtr).toBe(true)
    const second = ph.findIndex((p, i) => i > first && ph[i - 1].en === 0 && p.en === 1)
    expect(sampledMode(ph, second).mode).toBe('flash')
    expect(ph.at(-1)!.stage).toBe('app')
    expect(ph.some((p) => p.stage === 'write')).toBe(true)
  })
  it('a plain reset boots ROM → bootloader → app; GPIO12 high errors twice', () => {
    expect(bootScript('reset', MB, 921600).map((p) => p.stage)).toEqual(['app', 'reset', 'rom', 'boot2', 'app'])
    const bad = bootScript('gpio12', MB, 921600)
    expect(bad.filter((p) => p.stage === 'error')).toHaveLength(2)
    expect(sampledMode(bad, resetAfter(bad)).byte).toBe(0x33)
  })
  it('BOOT held through the EN tap enters download mode with DTR/RTS idle', () => {
    const ph = bootScript('button', MB, 921600)
    expect(ph.every((p) => !p.dtr && !p.rts)).toBe(true)
    expect(sampledMode(ph, resetAfter(ph)).mode).toBe('download')
  })
})

describe('OTA slots', () => {
  it('empty otadata boots app0; set_boot alternates sectors and seq maps to the slot', () => {
    expect(otaSelect(OTA_EMPTY, true).slot).toBe(0)
    const d = otaSetBoot(OTA_EMPTY, 1, true)
    expect(d[0]).toEqual({ seq: 2, state: 'new' })
    const back = otaSetBoot(d, 0, false)
    expect(back[1].seq).toBe(3)
    expect(otaSelect(back, false).slot).toBe(0)
  })
  it('rollback: new → pending on first boot, aborted on the second unless marked valid', () => {
    const d = otaSetBoot(OTA_EMPTY, 1, true)
    const first = otaSelect(d, true)
    expect(first.slot).toBe(1)
    expect(first.otadata[0].state).toBe('pending')
    const again = otaSelect(first.otadata, true)
    expect(again).toMatchObject({ slot: 0, rolledBack: true })
    expect(otaSelect(otaMarkValid(first.otadata), true).slot).toBe(1)
  })
  it('stories: good ends valid on app1, crash rolls back or loops, corrupt never switches', () => {
    expect(otaStory('good', true, 200 * KB).at(-1)).toMatchObject({ key: 'valid', slot: 1 })
    expect(otaStory('good', true, 200 * KB).at(-1)!.otadata[0].state).toBe('valid')
    expect(otaStory('crash', true, 200 * KB).at(-1)).toMatchObject({ key: 'rollback', slot: 0 })
    const loop = otaStory('crash', false, 200 * KB)
    expect(loop.filter((s) => s.key === 'panic')).toHaveLength(3)
    const bad = otaStory('corrupt', true, 200 * KB)
    expect(bad.at(-1)!.key).toBe('reject')
    expect(bad.at(-1)!.otadata).toEqual(OTA_EMPTY)
    expect(otaStory('good', true, 100 * KB)[1].s).toBeCloseTo(10)
    expect(otaDowntimeS(otaStory('good', true, 200 * KB))).toBeLessThan(0.5)
  })
})
