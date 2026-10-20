import { medianMs } from '../../stopwatch'
import { ROOM_C } from '../dc'
import { DRIVERS } from '../actuators/hbridge'
import { TT_MOTOR, TT_THERMAL } from '../actuators/dcmotor'
import { GPIO_VDD } from '../mcu/gpio'
import { FaultHunt, faultTable, probesNeeded, sameReading, stillSuspect } from './hunt'
import {
  DRIVE_BOT, DRIVER_PULL_OHMS, ENABLE_HUNT, GROUND_HUNT, LOW_DUTY, STALL_HUNT, commonGround, drivePack, drivePoint,
  floatingInput, hotSpot, missingEnable, stalledGearbox, windingC,
} from './motor'

const HUNTS = [ENABLE_HUNT, GROUND_HUNT, STALL_HUNT] as unknown as FaultHunt<string, string>[]

describe('motor faults', () => {
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
  it('drive point: running on the floor, locked, open; the pack carries duty × I and Ohm’s law holds when locked', () => {
    const { ocv, ohms } = drivePack()
    const run = drivePoint('tb6612', DRIVE_BOT.duty, 'run')
    expect(run.speed).toBeGreaterThan(0.3)
    expect(run.vm).toBeCloseTo(ocv - ohms * DRIVE_BOT.duty * run.amps, 6)
    const lock = drivePoint('tb6612', DRIVE_BOT.duty, 'stall')
    expect(lock.term).toBeCloseTo(lock.amps * TT_MOTOR.ohms, 6)
    expect(lock.amps).toBeGreaterThan(5 * run.amps)
    const open = drivePoint('tb6612', DRIVE_BOT.duty, 'open')
    expect(open.amps).toBe(0)
    expect(open.term).toBeCloseTo(DRIVE_BOT.duty * ocv, 9)
  })
  it('enable: STBY low switches the outputs off (coast), PWMA low or IN1 = IN2 brakes; a PWM pin reads its average', () => {
    expect(missingEnable('ok').reads.pwma.value).toBeCloseTo(DRIVE_BOT.duty * GPIO_VDD, 9)
    expect(missingEnable('ok').fwd).toBeCloseTo(DRIVE_BOT.duty, 9)
    expect(missingEnable('stby').off).toBe(true)
    expect(missingEnable('stby').modes).toEqual(['coast', 'coast'])
    expect(missingEnable('pwm').modes).toEqual(['brake', 'brake'])
    expect(missingEnable('same').modes).toEqual(['brake', 'brake'])
    for (const f of ['stby', 'pwm', 'same', 'vm'] as const) expect(missingEnable(f).reads.term.value).toBe(0)
  })
  it('no common ground: the ESP32’s HIGH floats, the driver’s pull-down wins, the DRV8833 reads LOW and coasts', () => {
    const v = floatingInput(GPIO_VDD, DRIVER_PULL_OHMS.drv8833)
    expect(v).toBeLessThan(0.05)
    const g = commonGround('ground')
    expect(g.seen).toBe(false)
    expect(g.mode).toBe('coast')
    expect(g.reads.inEsp.value).toBe(GPIO_VDD)
    expect(commonGround('ok').mode).toBe('forward')
    // A loose lead: full volts at the terminals, no current, so the terminals read like a healthy motor.
    expect(sameReading(commonGround('lead').reads.term, commonGround('ok').reads.term)).toBe(true)
  })
  it('stalled: locked rotor draws ~6× running current near the TB6612’s 1.2 A and cooks the winding; 12-bit duty can’t start it', () => {
    const j = stalledGearbox('jammed')
    expect(j.run.amps).toBeGreaterThan(1)
    expect(j.run.amps).toBeLessThan(DRIVERS.tb6612.maxA)
    expect(j.reads.heat.label).toBe('TT motor')
    expect(j.reads.heat.value).toBeGreaterThan(TT_THERMAL.maxC - 10)
    expect(j.reads.term.value).toBeGreaterThan(0.9 * stalledGearbox('ok').reads.term.value)
    const d = stalledGearbox('duty')
    expect(LOW_DUTY).toBeCloseTo(0.0498, 3)
    expect(d.run.speed).toBe(0)
    expect(d.run.amps).toBeLessThan(TT_MOTOR.noLoadA)
    expect(stalledGearbox('open').reads.coil.open).toBe(true)
  })
  it('winding heat and the hottest part', () => {
    expect(windingC(0, 30)).toBe(ROOM_C)
    expect(windingC(0.5, 1e6)).toBeCloseTo(ROOM_C + 0.25 * TT_MOTOR.ohms * TT_THERMAL.kPerW, 6)
    expect(hotSpot({ a: 30, b: 60 }).label).toBe('b')
    expect(hotSpot({ a: 25.5, b: 26 }).label).toBe('nothing')
  })
  it('speed: all three tables', () => {
    expect(medianMs(() => HUNTS.forEach((h) => faultTable(h)))).toBeLessThan(50)
  })
})
