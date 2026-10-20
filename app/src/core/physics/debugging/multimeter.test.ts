import { DMM } from './dmm'
import { faultTable, probesNeeded, stillSuspect } from './hunt'
import { AMP_HUNT, CONT_HUNT, METER_BOT, VOLT_HUNT, ampSpot, contSpot, spotRead, voltSpot } from './multimeter'
import { SUPPLY_BOT, holderVolts } from './supply'

describe('using a multimeter', () => {
  it('every hunt can single out each fault', () => {
    for (const h of [CONT_HUNT, VOLT_HUNT, AMP_HUNT] as const) {
      for (const f of h.faults as string[]) {
        const need = probesNeeded(h as never, f as never)
        expect(stillSuspect(h as never, f as never, need as never)).toEqual([f])
      }
    }
  })
  it('continuity: leads beep, a cold joint chirps, the diode reads one way, a bridged rail beeps', () => {
    const t = faultTable(CONT_HUNT)
    expect(t.ok.lead.value).toBeCloseTo(SUPPLY_BOT.wiringOhms / 2 + DMM.leadOhms, 3)
    expect(t.lead.lead.open).toBe(true)
    expect(t.joint.switch.value).toBeCloseTo(METER_BOT.coldJointOhms + DMM.leadOhms, 2)
    expect(spotRead(contSpot('joint', 'switch'), { dial: 'beep', jack: 'v' }).beep).toBe('chirp')
    expect(t.ok.diode.value).toBeGreaterThan(0.45)
    expect(t.ok.diodeRev.open).toBe(true)
    expect(t.diode.diode.open).toBe(true)
    expect(t.ok.rail.value).toBeCloseTo(SUPPLY_BOT.offOhms, -1)
    expect(spotRead(contSpot('bridge', 'rail'), { dial: 'beep', jack: 'v' }).beep).toBe('on')
  })
  it('continuity on the live bench: a good lead reads ohms that aren’t there', () => {
    const r = spotRead(contSpot('ok', 'lead', true), { dial: 'ohm', jack: 'v' })
    expect(r.shown!).toBeGreaterThan(1)
  })
  it('voltage: healthy chain, then where each fault makes the volts vanish', () => {
    const t = faultTable(VOLT_HUNT)
    expect(t.ok.pack.value).toBeLessThan(holderVolts())
    expect(t.ok.rail5.value).toBeCloseTo(SUPPLY_BOT.rail, 1)
    expect(t.ok.rail33.value).toBeCloseTo(3.3, 1)
    expect(t.fuse.fuse.value).toBeGreaterThan(8)
    expect(t.buck.rail5.value).toBeCloseTo(0, 2)
    expect(t.ldo.rail33.value).toBeCloseTo(0, 2)
    expect(t.flat.pack.value).toBeLessThan(4.5)
  })
  it('voltage misuse: red left in 10A shorts the pack; the 5 V rail into it hits the buck’s limit', () => {
    const pack = spotRead(voltSpot('ok', 'pack'), { dial: 'vdc', jack: 'a10' })
    expect(pack.shown).toBe(0)
    expect(pack.amps).toBeGreaterThan(5)
    const rail = spotRead(voltSpot('ok', 'rail5'), { dial: 'vdc', jack: 'a10' })
    expect(rail.amps).toBeGreaterThan(2)
    expect(rail.amps).toBeLessThan(5)
    // COM left on 5 V: the 3.3 V rail reads negative.
    expect(spotRead(voltSpot('ok', 'rail33'), { dial: 'vdc', jack: 'v' }, 6).shown!).toBeCloseTo(3.3 - 5, 1)
  })
  it('current: series readings add up; the mA socket survives idle but not a motor start; across the pack it is a short', () => {
    const t = faultTable(AMP_HUNT)
    expect(t.ok.run.value).toBeGreaterThan(t.ok.idle.value + 0.2)
    expect(t.drag.motor.value).toBeGreaterThan(2 * t.ok.motor.value)
    expect(t.open.motor.value).toBeCloseTo(0, 3)
    expect(t.stuck.idle.value).toBeCloseTo(t.ok.run.value, 2)
    expect(t.leak.idle.value).toBeGreaterThan(t.ok.idle.value + 0.04)
    expect(spotRead(ampSpot('ok', 'idle'), { dial: 'ma', jack: 'ma' }).blown).toBeNull()
    const run = spotRead(ampSpot('ok', 'run'), { dial: 'ma', jack: 'ma' })
    expect(run.blown).toBe('ma')
    expect(run.meltS).toBeLessThan(DMM.startS)
    const pack = spotRead(ampSpot('ok', 'pack'), { dial: 'amp', jack: 'a10' })
    expect(pack.amps).toBeGreaterThan(5)
    // A voltmeter in series: the robot gets nothing, the meter reads the pack.
    const v = spotRead(ampSpot('ok', 'idle'), { dial: 'vdc', jack: 'v' })
    expect(v.shown!).toBeGreaterThan(8)
    expect(v.volts[6]).toBeCloseTo(0, 2)
  })
})
