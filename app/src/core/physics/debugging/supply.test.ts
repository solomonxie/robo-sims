import { medianMs } from '../../stopwatch'
import { CHEMISTRIES } from '../power/batteries'
import { LM2596 } from '../power/converters'
import { AMS1117_33 } from '../regulators'
import { FUSES, fuseMeltTime } from '../protection'
import { FaultHunt, faultTable, probesNeeded, sameReading, stillSuspect } from './hunt'
import {
  DEAD_HUNT, REVERSE_HUNT, SHORT_HUNT, SHORT_OHMS, SUPPLY_BOT, bootPoint, bridgedBuck, deadBattery, guardCompare,
  holderOhms, holderVolts, reversePolarity, shortCircuit, shortedLdoRun,
} from './supply'

const HUNTS = [DEAD_HUNT, REVERSE_HUNT, SHORT_HUNT] as unknown as FaultHunt<string, string>[]

describe('supply faults', () => {
  it('every hunt: the healthy build differs from each fault, and the probes tell every fault apart', () => {
    for (const h of HUNTS) {
      const t = faultTable(h)
      for (const f of h.faults) {
        expect(h.probes.some((p) => !sameReading(t.ok[p], t[f][p]))).toBe(true)
        expect(stillSuspect(h, f, h.probes)).toEqual([f])
        expect(probesNeeded(h, f).length).toBeGreaterThan(0)
      }
    }
  })
  it('healthy build boots: 6 × AA at 85 % = 8.85 V, sags I·R at the burst, 5 V and 3.3 V rails up', () => {
    const ok = deadBattery('ok')
    expect(ok.ocv).toBeCloseTo(6 * 1.475, 6)
    expect(ok.boot!.boots).toBe(true)
    expect(ok.boot!.packV).toBeCloseTo(ok.ocv - holderOhms() * ok.boot!.amps, 9)
    expect(ok.boot!.rail).toBeCloseTo(5, 2)
    expect(ok.boot!.mcu).toBeCloseTo(3.3, 6)
  })
  it('worn cells read fine at rest but can’t deliver the burst (OCV² / 4R under the need): the buck hiccups at its UVLO', () => {
    const w = deadBattery('worn')
    expect(sameReading(w.reads.rest, deadBattery('ok').reads.rest)).toBe(true)
    expect(w.maxW).toBeLessThan(w.needW)
    expect(w.reads.buckIn).toEqual({ value: LM2596.vinMin, unit: 'V', alt: w.ocv })
    expect(w.reads.rail.alt).toBe(SUPPLY_BOT.rail)
  })
  it('corroded springs: the drop is in the contact, so the pack terminals barely sag while the buck input collapses', () => {
    const c = deadBattery('contact')
    expect(c.reads.loaded.value).toBeGreaterThan(c.ocv - 0.5)
    expect(c.reads.buckIn.value).toBeCloseTo(LM2596.vinMin, 6)
  })
  it('flat pack is under the buck’s minimum input: it never starts', () => {
    const f = deadBattery('flat')
    expect(f.ocv).toBeLessThan(LM2596.vinMin)
    expect(f.boot!.starts).toBe(false)
    expect(f.reads.loaded.value).toBeCloseTo(f.ocv, 9)
  })
  it('a stiff enough source has a steady point; a weak one hiccups', () => {
    expect(bootPoint(8.85, 1).boots).toBe(true)
    expect(bootPoint(8.85, 20).dip).not.toBeNull()
  })
  it('reverse: the 1N4007 drops ~0.8 V forwards, blocks backwards; two cells reversed leave 2 of 6', () => {
    const ok = reversePolarity('ok')
    expect(ok.reads.guard.value).toBeGreaterThan(0.7)
    expect(ok.reads.guard.value).toBeLessThan(0.9)
    const r = reversePolarity('plug')
    expect(r.reads.plug.value).toBeCloseTo(-holderVolts(), 3)
    expect(Math.abs(r.reads.amps.value)).toBeLessThan(1e-6)
    expect(reversePolarity('cells').ocv).toBeCloseTo(2 * holderVolts() / 6, 9)
    expect(reversePolarity('diode').reads.guard.value).toBeCloseTo(holderVolts(), 2)
  })
  it('guards: no guard pushes amps through the substrate diodes; the P-FET costs millivolts, the diode most of a volt', () => {
    const g = guardCompare()
    expect(g.noneA).toBeGreaterThan(5)
    expect(g.pfetV).toBeLessThan(0.02)
    expect(g.diodeV / g.pfetV).toBeGreaterThan(50)
  })
  it('short before the fuse: the cells’ own resistance limits it to ~9 A and the 22 AWG lead runs past PVC’s 80 °C', () => {
    const s = shortCircuit('lead')
    expect(s.amps).toBeLessThan(holderVolts() / (6 * CHEMISTRIES.alkaline.cell.ohms))
    expect(s.amps).toBeGreaterThan(8)
    expect(s.reads.heat.value).toBeGreaterThan(80)
    expect(s.reads.fuse.open).toBeFalsy()
  })
  it('short after the fuse: the T1A melts in a tenth of a second and opens', () => {
    const s = shortCircuit('blown')
    expect(s.meltS).toBeCloseTo(fuseMeltTime(s.amps, FUSES.T1A), 12)
    expect(s.meltS).toBeLessThan(0.5)
    expect(s.reads.fuse.open).toBe(true)
  })
  it('bridged 5 V: the buck sits at its switch current limit, out = I × R, and heats', () => {
    const b = bridgedBuck(8.3)
    expect(b.vout).toBeCloseTo(b.iout * SHORT_OHMS.rail5, 9)
    expect(b.iout).toBeGreaterThan(3)
    expect(b.iout).toBeLessThan(LM2596.switchAmps)
    expect(b.boardC).toBeGreaterThan(100)
  })
  it('shorted 3.3 V: the AMS1117 trips at 155 °C, cools to 140 °C and cycles', () => {
    const l = shortedLdoRun(5)
    expect(l.peakC).toBeGreaterThanOrEqual(AMS1117_33.tOff)
    expect(l.peakC).toBeLessThan(AMS1117_33.tOff + 2)
    expect(l.duty).toBeGreaterThan(0.05)
    expect(l.duty).toBeLessThan(0.9)
    expect(Number.isFinite(l.period)).toBe(true)
    expect(l.firstTripS).toBeGreaterThan(0)
  })
  it('speed: all three tables', () => {
    expect(medianMs(() => HUNTS.forEach((h) => faultTable(h)))).toBeLessThan(50)
  })
})
