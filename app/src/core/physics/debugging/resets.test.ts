import { medianMs } from '../../stopwatch'
import { ROOM_C } from '../dc'
import { AMS1117_33 } from '../regulators'
import { ESP32_BOD, ESP32_MIN_V, ESP32_TIMELINE } from '../power/brownout'
import { FaultHunt, faultTable, probesNeeded, sameReading, stillSuspect } from './hunt'
import { SPIKE_BOT, SPIKE_HUNT, WEAK_BOT, WEAK_HUNT, WEAK_TIMELINE, ldoHeatRun, motorSpike, spikeOhms, stallBurstA, stepDip, weakRegulator } from './resets'

const HUNTS = [SPIKE_HUNT, WEAK_HUNT] as unknown as FaultHunt<string, string>[]

describe('reset faults', () => {
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
  it('a plain DMM on 3.3 V misses every motor-start reset; the scope and the reset reason catch them', () => {
    const ok = motorSpike('ok')
    for (const f of ['cap', 'lead', 'flat', 'wdt'] as const) {
      const s = motorSpike(f)
      expect(sameReading(s.reads.rail, ok.reads.rail)).toBe(true)
      expect(s.reads.reason.label).not.toBe('POWERON')
    }
    expect(ok.resets).toBe(0)
    expect(ok.reads.scope.value).toBeGreaterThan(ESP32_MIN_V)
    expect(motorSpike('cap').reads.scope.value).toBeLessThan(ESP32_BOD[0])
    expect(motorSpike('cap').why).toBe('BROWNOUT')
    // Resets come with the motors, not before them.
    for (const f of ['cap', 'lead', 'flat'] as const) expect(motorSpike(f).run.resets[0].t).toBeGreaterThanOrEqual(SPIKE_BOT.pre)
    // The watchdog case is electrically healthy.
    expect(motorSpike('wdt').reads.scope).toEqual(ok.reads.scope)
  })
  it('stall burst is Ohm’s law; the thin lead drops I·R and the hold-up cap is what keeps the healthy car up', () => {
    const r = spikeOhms()
    const i = stallBurstA(6, 4, r.pack)
    expect(i).toBeCloseTo(6 / (5.36 / 4 + r.pack), 9)
    expect(spikeOhms(true).lead).toBeGreaterThan(20 * r.lead)
    const lead = motorSpike('lead')
    // Stall burst plus the ESP32's own draw through the lead.
    expect(lead.reads.lead.value).toBeGreaterThan(lead.rig.stallA * spikeOhms(true).lead)
    expect(lead.reads.lead.value).toBeLessThan((lead.rig.stallA + ESP32_TIMELINE.wifiA) * spikeOhms(true).lead)
    expect(motorSpike('cap').reads.vin.value).toBeLessThan(motorSpike('ok').reads.vin.value - 0.5)
  })
  it('weak regulator: decoupling sets the burst dip; 12 V cooks the AMS1117 into shutdown cycles; AA dropout', () => {
    const tl = WEAK_TIMELINE
    expect(tl.runA).toBeCloseTo(ESP32_TIMELINE.runA + WEAK_BOT.sensorA, 9)
    const deep = Math.min(...stepDip(tl.bootA, tl.wifiA, WEAK_BOT.bare))
    const shallow = Math.min(...stepDip(tl.bootA, tl.wifiA, WEAK_BOT.caps))
    expect(deep).toBeLessThan(5 * shallow)
    expect(Math.abs(shallow)).toBeLessThan(0.15)
    expect(weakRegulator('cap').why).toBe('BROWNOUT')
    const hot = weakRegulator('hot')
    expect(hot.tripped).toBe(true)
    expect(hot.heat.peakC).toBeGreaterThanOrEqual(AMS1117_33.tOff)
    expect(hot.heat.duty).toBeGreaterThan(0.5)
    expect(hot.heat.duty).toBeLessThan(1)
    expect(hot.heat.firstTrip).toBeGreaterThan(5)
    expect(ldoHeatRun(5, 0.17).trips).toBe(false)
    expect(ldoHeatRun(5, 0.17).peakC).toBeLessThan(ROOM_C + 40)
    const low = weakRegulator('low')
    expect(low.reads.vin.value).toBeLessThan(AMS1117_33.vout + AMS1117_33.dropout0 + 0.1)
    expect(low.run.resets.length).toBeGreaterThan(1)
    expect(weakRegulator('ok').run.resets.length).toBe(1)
    expect(weakRegulator('crash').reads.scope).toEqual(weakRegulator('ok').reads.scope)
  })
  it('speed: both tables', () => {
    expect(medianMs(() => HUNTS.forEach((h) => faultTable(h)))).toBeLessThan(50)
  })
})
