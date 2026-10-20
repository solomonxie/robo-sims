import { BENCH_C } from './technique'
import { PADS, STATION, TIPS, ironIdle, ironStep, padDoseRate, steadyJointC, tipOxide } from './iron'

const hold = (setC: number, tip: keyof typeof TIPS, pad: keyof typeof PADS, seconds: number, contact: number = TIPS[tip].wetWPerK) => {
  let n = ironIdle(setC, tip)
  let minTip = n.tipC
  for (let t = 0; t < seconds; t += 0.01) {
    n = ironStep(n, setC, tip, pad, contact, 0.01)
    minTip = Math.min(minTip, n.tipC)
  }
  return { n, minTip }
}

describe('iron heat circuit', () => {
  it('idles with the heater a P-offset under the set point and the tip just below it', () => {
    const n = ironIdle(350, 'chisel')
    expect(n.heaterC).toBeLessThan(350)
    expect(n.heaterC).toBeGreaterThan(349)
    expect(n.tipC).toBeLessThan(n.heaterC)
    expect(n.tipC).toBeGreaterThan(347)
    expect(n.jointC).toBe(BENCH_C)
  })
  it('a lifted iron stays at idle: no contact, no drift', () => {
    let n = ironIdle(330, 'chisel')
    for (let i = 0; i < 500; i++) n = ironStep(n, 330, 'chisel', 'signal', 0, 0.01)
    expect(n.tipC).toBeCloseTo(ironIdle(330, 'chisel').tipC, 6)
    expect(n.jointC).toBeCloseTo(BENCH_C, 6)
  })
  it('held long, the joint settles at the series-chain value', () => {
    const { n } = hold(350, 'chisel', 'signal', 30)
    expect(n.jointC).toBeCloseTo(steadyJointC(350, 'chisel', 'signal', TIPS.chisel.wetWPerK), -1)
    expect(n.jointC).toBeLessThan(350)
    expect(n.barrelC).toBeLessThan(n.jointC)
  })
  it('the tip dips on contact and recovers; a small tip dips more, a ground plane drags harder', () => {
    const small = hold(350, 'conical', 'plane', 3)
    const big = hold(350, 'wide', 'plane', 3)
    expect(small.minTip).toBeLessThan(big.minTip)
    expect(big.n.jointC).toBeGreaterThan(small.n.jointC + 80)
    expect(hold(350, 'chisel', 'plane', 3).n.jointC).toBeLessThan(hold(350, 'chisel', 'signal', 3).n.jointC - 40)
  })
  it('heater power is capped at the station rating', () => {
    expect(STATION.watts).toBe(60)
    const { n } = hold(450, 'wide', 'plane', 5)
    expect(n.heaterC).toBeLessThan(450)
  })
  it('a dry (oxidised) contact passes a fraction of the heat', () => {
    expect(hold(350, 'chisel', 'signal', 3, TIPS.chisel.dryWPerK).n.jointC).toBeLessThan(hold(350, 'chisel', 'signal', 3).n.jointC - 100)
  })
  it('tip oxide: parabolic, faster when hotter, full in 30 s at 350 °C', () => {
    expect(tipOxide(350, 30)).toBeCloseTo(1, 9)
    expect(tipOxide(350, 7.5)).toBeCloseTo(0.5, 9)
    expect(tipOxide(390, 15)).toBeCloseTo(1, 9)
    expect(tipOxide(250, 60)).toBeLessThan(tipOxide(300, 60))
  })
  it('pad lift dose: 30 s at 300 °C, ×2 per 20 °C', () => {
    expect(padDoseRate(300) * 30).toBeCloseTo(1, 9)
    expect(padDoseRate(340) / padDoseRate(300)).toBeCloseTo(4, 9)
  })
})
