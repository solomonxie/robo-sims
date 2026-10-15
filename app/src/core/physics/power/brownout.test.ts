import { AMS1117_33, CHEMISTRIES, ESP32_BOD, ESP32_MIN_V, ESP32_TIMELINE as TL, BrownoutRig, brownoutRun, logicAmps, minInputVolts, openCircuitVolts, rideThroughS } from '..'

const aa = (soc: number) => 4 * openCircuitVolts(CHEMISTRIES.nimh, soc)
const rig = (soc: number, more: Partial<BrownoutRig> = {}): BrownoutRig => ({
  ocv: aa(soc), ohms: 0.52, reg: AMS1117_33, bod: ESP32_BOD[0], stallA: 2, cruiseA: 0.4, rampS: 0, tau: 0.05, ...more,
})
const DT = 1e-4

describe('brownout', () => {
  it('an LDO needs Vout + dropout at its input; a cap rides through C·ΔV/I', () => {
    expect(minInputVolts(AMS1117_33, 0.1)).toBeCloseTo(3.3 + 0.95 + 0.019, 6)
    expect(rideThroughS(4700e-6, 0.1, 4.6, 3.9)).toBeCloseTo(0.0329, 4)
    expect(rideThroughS(1e-3, 0.1, 3, 4)).toBe(0)
  })

  it('the sketch boots, bursts for Wi-Fi, then idles with TX bursts', () => {
    expect(logicAmps(0.1)).toBe(TL.bootA)
    expect(logicAmps(TL.bootS + 0.01)).toBe(TL.wifiA)
    expect(logicAmps(TL.bootS + TL.wifiS + 0.05)).toBe(TL.runA)
    expect(logicAmps(TL.bootS + TL.wifiS + TL.txEvery + 0.001)).toBe(TL.txA)
  })

  it('a full pack shrugs off the motor start; a half-empty one dips the rail below spec', () => {
    const full = brownoutRun(rig(1), 0.5, DT, TL.motorAt - 0.1)
    expect(Math.min(...full.rail)).toBeCloseTo(3.3, 6)
    expect(full.resets).toHaveLength(0)
    const low = brownoutRun(rig(0.2), 0.5, DT, TL.motorAt - 0.1)
    expect(Math.min(...low.pack)).toBeLessThan(4)
    expect(low.resets.length).toBeGreaterThan(0)
  })

  it('a low BOD level lets the rail crash in the undefined zone; a high one resets cleanly', () => {
    const lo = brownoutRun(rig(0.3), 0.5, DT, TL.motorAt - 0.1)
    expect(lo.resets[0].kind).toBe('panic')
    const hi = brownoutRun(rig(0.3, { bod: ESP32_BOD[7] }), 0.5, DT, TL.motorAt - 0.1)
    expect(Math.min(...hi.rail)).toBeLessThan(ESP32_MIN_V)
    expect(['brownout', 'panic']).toContain(hi.resets[0].kind)
  })

  it('soft start and a separate rail keep the MCU running', () => {
    for (const more of [{ rampS: 0.3 }, { own: { volts: 5, ohms: 0.1 } }]) {
      const r = brownoutRun(rig(0.3, more), 0.5, DT, TL.motorAt - 0.1)
      expect(r.resets).toHaveLength(0)
      expect(Math.min(...r.rail)).toBeGreaterThan(ESP32_MIN_V)
    }
  })

  it('a diode + bulk cap holds the LDO input up while the pack sags', () => {
    const bare = brownoutRun(rig(0.4), 0.5, DT, TL.motorAt - 0.1)
    const held = brownoutRun(rig(0.4, { holdup: { farads: 10e-3, diodeV: 0.3 } }), 0.5, DT, TL.motorAt - 0.1)
    expect(Math.min(...held.vin)).toBeGreaterThan(Math.min(...bare.vin))
    expect(bare.resets.length).toBeGreaterThan(0)
    expect(held.resets).toHaveLength(0)
  })

  it('motors starting after boot make a reset loop on a weak pack', () => {
    const r = brownoutRun(rig(0.2), 4, 2e-4)
    expect(r.resets[0].kind).toBe('poweron')
    expect(r.resets.length).toBeGreaterThan(3)
    expect(r.phase).toContain('run')
  })
})
