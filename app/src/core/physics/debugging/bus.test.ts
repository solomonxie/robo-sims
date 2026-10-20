import { medianMs } from '../../stopwatch'
import { INTERNAL_PULL_OHMS } from '../mcu/gpio'
import { I2C_MODES, i2cRiseTime, lowVolts } from '../mcu/i2c'
import { FaultHunt, faultTable, probesNeeded, sameReading, stillSuspect } from './hunt'
import { ADDR_HUNT, BUS_BOT, PULL_HUNT, busFarads, busFrame, frameText, i2cBits, missingPullups, openDrainVolts, pullSetup, sclRise, wireAddressByte, wrongAddress } from './bus'

const HUNTS = [ADDR_HUNT, PULL_HUNT] as unknown as FaultHunt<string, string>[]

describe('bus faults', () => {
  it('every hunt separates every fault, and each differs from the healthy build', () => {
    for (const h of HUNTS) {
      const t = faultTable(h)
      for (const f of h.faults) {
        expect(h.probes.some((p) => !sameReading(t.ok[p], t[f][p]))).toBe(true)
        expect(stillSuspect(h, f, h.probes)).toEqual([f])
        expect(probesNeeded(h, f).length).toBeGreaterThan(0)
      }
    }
  })
  it('address byte, open-drain edges, I²C thresholds and the decode text', () => {
    expect(wireAddressByte(0x68)).toBe(0xd0)
    expect(wireAddressByte(0x68, true)).toBe(0xd1)
    // The datasheet's 8-bit 0xD0 shifted again loses its top bit: 0xA0 → address 0x50.
    expect(wireAddressByte(0xd0)).toBe(0xa0)
    const v = openDrainVolts([0, 1], 4.7e3, 50e-12, 400, 1e-6)
    expect(v[399]).toBeCloseTo(lowVolts(4.7e3), 3)
    expect(v[799]).toBeGreaterThan(0.98 * BUS_BOT.vdd)
    expect(openDrainVolts([1], 4.7e3, 50e-12, 4, 1e-6, true)[3]).toBeCloseTo(lowVolts(4.7e3), 6)
    // Hysteresis: the band between 0.3 and 0.7 VDD keeps the last bit.
    expect(i2cBits([3.3, 1.5, 0.5, 1.5, 2.5])).toEqual([1, 1, 0, 0, 1])
    expect(frameText([])).toBe('no START')
    expect(frameText([{ kind: 'start', value: 0, from: 0, to: 0 }])).toBe('START only')
    expect(busFarads(0.3, 2)).toBeCloseTo(63e-12, 15)
  })
  it('wrong address: the healthy read ACKs WHO_AM_I; AD0 high moves the IMU to 0x69; 0xD0 calls 0x50; crossed or dead, only the OLED answers', () => {
    const ok = wrongAddress('ok')
    expect(ok.frame.acks).toBe(true)
    expect(ok.frame.events.filter((e) => e.kind === 'data').map((e) => e.value)).toEqual([BUS_BOT.whoAmI.reg, BUS_BOT.whoAmI.value])
    expect(ok.scan).toEqual([0x3c, 0x68])
    expect(wrongAddress('ad0').scan).toEqual([0x3c, 0x69])
    expect(wrongAddress('eight').frame.addr).toBe(0x50)
    for (const f of ['ad0', 'eight', 'swap', 'vcc'] as const) expect(wrongAddress(f).frame.text).toMatch(/NACK$/)
    expect(wrongAddress('swap').scan).toEqual([0x3c])
    expect(wrongAddress('vcc').scan).toEqual([0x3c])
    expect(wrongAddress('swap').reads.sda.value).toBeGreaterThan(2 * BUS_BOT.pullOhms)
  })
  it('missing pull-ups: 45 kΩ or a 4 m cable can’t lift SCL to 0.7 VDD in a 400 kHz half-clock but can at 100 kHz; a held SDA never STARTs', () => {
    const ok = missingPullups('ok')
    expect(ok.fast.text).toBe('0x68 ACK')
    expect(ok.rise! * 1e9).toBeLessThan(I2C_MODES.fast.trMax * 1e9)
    for (const f of ['none', 'scl', 'cable'] as const) {
      const r = missingPullups(f)
      expect(r.fast.acks).toBe(false)
      expect(r.slow.text).toBe('0x68 ACK')
      expect(r.rise!).toBeGreaterThan(I2C_MODES.fast.trMax)
      expect(sclRise(r.fastSetup.sclOhms, r.fastSetup.farads, I2C_MODES.fast.hz)).toBeNull()
    }
    expect(missingPullups('none').rise).toBeCloseTo(i2cRiseTime(INTERNAL_PULL_OHMS, busFarads(BUS_BOT.shortM, 1)), 12)
    expect(pullSetup('scl', 1e5).sdaOhms).toBe(BUS_BOT.pullOhms)
    const held = missingPullups('held')
    expect(held.fast.events).toEqual([])
    expect(held.reads.sda.value).toBeLessThan(0.3 * BUS_BOT.vdd)
    // The healthy frame at 400 kHz takes the whole register read.
    expect(busFrame(BUS_BOT.imu, pullSetup('ok', I2C_MODES.fast.hz)).events.at(-1)?.kind).toBe('stop')
  })
  it('speed: both tables', () => {
    expect(medianMs(() => HUNTS.forEach((h) => faultTable(h)))).toBeLessThan(50)
  })
})
