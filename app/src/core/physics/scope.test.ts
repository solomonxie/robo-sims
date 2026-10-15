import {
  PROBE_X1,
  PROBE_X10,
  acCouple,
  bandwidthRise,
  displayedVolts,
  edgeStats,
  findTrigger,
  leadInductance,
  ledcBits,
  loadedVolts,
  measureWave,
  meanOf,
  oneTwoFive,
  probeResponse,
  ringHz,
  ringQ,
  toDivs,
  uartDecode,
  uartFrame,
  uartLevel,
} from '.'

describe('scope', () => {
  it('dials step 1-2-5 and volts map to divisions', () => {
    expect([0, 1, 2, 3, 4].map((i) => oneTwoFive(i, 0.2))).toEqual([0.2, 0.5, 1, 2, 5])
    expect(oneTwoFive(2, 50e-6)).toBeCloseTo(200e-6, 12)
    expect(oneTwoFive(-1, 1)).toBe(0.5)
    expect(toDivs(1.65, 0.5, -3)).toBeCloseTo(0.3, 9)
  })

  it('triggers on the chosen edge, interpolated, and hysteresis ignores small wiggles', () => {
    const s = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3]
    expect(findTrigger(s, 1.5, 'rise')).toBeCloseTo(1.5, 9)
    expect(findTrigger(s, 1.5, 'fall')).toBeCloseTo(4.5, 9)
    expect(findTrigger(s, 1.5, 'rise', 3)).toBeCloseTo(7.5, 9)
    expect(findTrigger(s, 5, 'rise')).toBeNull()
    const noisy = [0, 1.1, 0.9, 1.1, 0.9, 2, 3]
    expect(findTrigger(noisy, 1, 'rise', 1)).toBeCloseTo(2.5, 9)
    expect(findTrigger(noisy, 1, 'rise', 1, 0.5)).toBeNull()
    expect(findTrigger(noisy, 1, 'rise', 0, 0.5)).toBeCloseTo(0 + 1 / 1.1, 9)
  })

  it('probe attenuation, loading, bandwidth and lead ringing', () => {
    expect(displayedVolts(3.3, 10, 10)).toBeCloseTo(3.3, 9)
    expect(displayedVolts(3.3, 10, 1)).toBeCloseTo(0.33, 9)
    expect(displayedVolts(3.3, 1, 10)).toBeCloseTo(33, 9)
    expect(loadedVolts(1, 1e6, PROBE_X1.ohms)).toBeCloseTo(0.5, 9)
    expect(loadedVolts(1, 1e6, PROBE_X10.ohms)).toBeCloseTo(10 / 11, 9)
    expect(bandwidthRise(PROBE_X1.bwHz)).toBeCloseTo(58.3e-9, 10)
    expect(ringHz(leadInductance(150), 12e-12) / 1e6).toBeCloseTo(118.6, 0)
  })

  it('probeResponse settles to the step; narrow bandwidth slows the edge, a long lead overshoots', () => {
    const dt = 1e-9
    const step = Array.from({ length: 400 }, (_, i) => (i < 20 ? 0 : 1))
    const rise = (y: number[]) => (y.findIndex((v) => v > 0.9) - y.findIndex((v) => v > 0.1)) * dt
    const x1 = probeResponse(step, dt, { ringHz: 2e9, q: 0.7, bwHz: PROBE_X1.bwHz })
    expect(x1[399]).toBeCloseTo(1, 2)
    expect(rise(x1)).toBeCloseTo(bandwidthRise(PROBE_X1.bwHz), 8)
    const lead = probeResponse(step, dt, { ringHz: 100e6, q: 4, bwHz: PROBE_X10.bwHz })
    expect(Math.max(...lead)).toBeGreaterThan(1.4)
    expect(lead[399]).toBeCloseTo(1, 1)
    const e = edgeStats(x1, dt, 0, 1)
    expect(e.rise).toBeCloseTo(bandwidthRise(PROBE_X1.bwHz), 8)
    expect(e.overshoot).toBeLessThan(0.01)
    expect(edgeStats(lead, dt, 0, 1).overshoot).toBeGreaterThan(0.4)
    expect(ringQ(150e-9, 12e-12, 25)).toBeCloseTo(4.47, 2)
  })

  it('AC coupling removes the mean; measurements read a PWM back', () => {
    expect(meanOf(acCouple([0, 0, 3.3, 3.3]))).toBeCloseTo(0, 12)
    const pwm = Array.from({ length: 1000 }, (_, i) => ((i % 100) < 30 ? 3.3 : 0))
    const m = measureWave(pwm, 1e-6)
    expect(m.vpp).toBeCloseTo(3.3, 9)
    expect(m.hz).toBeCloseTo(10e3, 3)
    expect(m.duty).toBeCloseTo(0.3, 2)
    expect(m.mean).toBeCloseTo(0.99, 2)
    expect(measureWave([1, 1, 1], 1).hz).toBe(0)
    expect(ledcBits(1e6)).toBe(6)
    expect(ledcBits(5e3)).toBe(13)
  })

  it('UART frames are LSB first; the wrong baud garbles the byte', () => {
    expect(uartFrame(0x48)).toEqual([0, 0, 0, 0, 1, 0, 0, 1, 0, 1])
    const tx = (t: number) => uartLevel(0x48, 115200, t)
    expect(uartLevel(0x48, 115200, -1e-6)).toBe(1)
    const ok = uartDecode(tx, 115200)
    expect(ok.byte).toBe(0x48)
    expect(ok.framingOk).toBe(true)
    const slow = uartDecode(tx, 9600)
    expect(slow.byte).not.toBe(0x48)
    expect(slow.framingOk).toBe(true)
    expect(uartDecode(tx, 230400).byte).not.toBe(0x48)
  })
})
