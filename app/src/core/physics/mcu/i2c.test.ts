import { i2cDecode, i2cLines, i2cRegisterSteps, sampleLine, stepLines } from '../signals/buses'
import {
  I2C_CHIPS,
  I2C_MODES,
  MPU6050,
  accelPitch,
  addressConflicts,
  busAnswer,
  chipAddress,
  i2cRiseTime,
  i2cScan,
  int16Bytes,
  isReserved,
  lowVolts,
  mpu6050Burst,
  mpu6050Parse,
  openDrainClock,
  probeTime,
  pullupMax,
  pullupMin,
  tiltAccel,
  toInt16,
} from './i2c'

describe('addresses', () => {
  it('adds the select pins onto the base address', () => {
    expect(chipAddress(I2C_CHIPS.mpu6050, 0)).toBe(0x68)
    expect(chipAddress(I2C_CHIPS.mpu6050, 1)).toBe(0x69)
    expect(chipAddress(I2C_CHIPS.pcf8574, 7)).toBe(0x27)
  })

  it('only the matching chips answer; two at one address conflict', () => {
    expect(busAnswer([0x68, 0x76, 0x3c], 0x76)).toEqual({ ackers: [1], ack: true, conflict: false })
    expect(busAnswer([0x68, 0x76, 0x68], 0x68).conflict).toBe(true)
    expect(busAnswer([0x68], 0x50).ack).toBe(false)
    expect(addressConflicts([0x68, 0x3c, 0x68, 0x76])).toEqual([0x68])
  })

  it('scans 0x08–0x77 and skips the reserved ranges', () => {
    const s = i2cScan([0x3c, 0x68, 0x05])
    expect(s.probes).toHaveLength(112)
    expect(s.found).toEqual([0x3c, 0x68])
    expect(isReserved(0x07) && isReserved(0x78) && !isReserved(0x08)).toBe(true)
  })

  it('probe time matches an address-only frame', () => {
    expect(probeTime(100e3)).toBeCloseTo(i2cLines({ addr: 0x3c, data: [], ack: true }, 100e3).duration, 12)
  })
})

describe('pull-ups', () => {
  it('rise time is ln(7/3)·RC', () => {
    expect(i2cRiseTime(4700, 100e-12)).toBeCloseTo(398e-9, 9)
  })

  it('the pull-up window narrows with capacitance and speed', () => {
    expect(pullupMin(3.3)).toBeCloseTo(967, 0)
    expect(pullupMax(200e-12, I2C_MODES.standard)).toBeCloseTo(5901, 0)
    expect(pullupMax(200e-12, I2C_MODES.fast)).toBeLessThan(pullupMin(3.3) * 2)
    expect(lowVolts(1000)).toBeLessThan(0.4)
    expect(lowVolts(470)).toBeGreaterThan(0.4)
  })

  it('a weak pull-up never reaches HIGH at 400 kHz', () => {
    const strong = openDrainClock(400e3, 2200, 100e-12)
    expect(strong.ok).toBe(true)
    expect(strong.top).toBeGreaterThan(3.2)
    const weak = openDrainClock(400e3, 47e3, 200e-12)
    expect(weak.ok).toBe(false)
    expect(weak.top).toBeLessThan(weak.vih)
    expect(weak.level(0)).toBeCloseTo(weak.bottom, 6)
    expect(weak.level(weak.half - 1e-12)).toBeCloseTo(weak.top, 3)
  })
})

describe('MPU-6050', () => {
  it('signed 16-bit big-endian round-trips', () => {
    expect(int16Bytes(-1)).toEqual([0xff, 0xff])
    expect(toInt16(0x80, 0x00)).toBe(-32768)
    expect(toInt16(...int16Bytes(16384))).toBe(16384)
  })

  it('flat reads +1 g on Z, tilted reads gravity on X', () => {
    const flat = mpu6050Parse(mpu6050Burst(tiltAccel(0, 0), [0, 0, 0], 25))
    expect(flat.raw[2]).toBe(16384)
    expect(flat.tempC).toBeCloseTo(25, 1)
    const p = 0.5
    const r = mpu6050Parse(mpu6050Burst(tiltAccel(p, 0), [0, 12.5, 0], 25))
    expect(accelPitch(r.accel)).toBeCloseTo(p, 3)
    expect(r.gyro[1]).toBeCloseTo(12.5, 1)
  })

  it('burst read: write pointer, repeated START, read with NACK on the last byte', () => {
    const bytes = mpu6050Burst([0, 0, 1], [0, 0, 0], 25)
    const l = stepLines(i2cRegisterSteps(MPU6050.addr, MPU6050.accelOut, bytes), 100e3)
    const fs = 4e6
    const count = Math.ceil(l.duration * fs) + 4
    const ev = i2cDecode(sampleLine(l.scl, fs, count, -1 / fs), sampleLine(l.sda, fs, count, -1 / fs))
    expect(ev.filter((e) => e.kind === 'start')).toHaveLength(2)
    expect(ev.filter((e) => e.kind === 'addr').map((e) => e.read)).toEqual([false, true])
    const data = ev.filter((e) => e.kind === 'data').map((e) => e.value)
    expect(data).toEqual([MPU6050.accelOut, ...bytes])
    expect(ev.filter((e) => e.kind === 'nack')).toHaveLength(1)
  })
})
