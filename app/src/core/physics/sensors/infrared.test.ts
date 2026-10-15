import {
  FC51,
  detectRange,
  followStep,
  irLedAmps,
  linePosition,
  modulatedReceiver,
  obstacleReading,
  plainReceiver,
  sensorX,
  startFollower,
  tapeCover,
  tcrtAdc,
  trackOffset,
  trackPoint,
} from './infrared'

describe('IR obstacle sensor', () => {
  it('drives the IR LED at ~25 mA from 5 V through 150 Ω', () => {
    expect(irLedAmps(FC51.vcc, FC51.ledOhms) * 1000).toBeGreaterThan(22)
    expect(irLedAmps(FC51.vcc, FC51.ledOhms) * 1000).toBeLessThan(28)
  })

  it('reflection falls with distance, and black returns far less than white', () => {
    expect(obstacleReading(5, 'white', 1).v).toBeGreaterThan(obstacleReading(20, 'white', 1).v)
    expect(obstacleReading(10, 'black', 1).pdA).toBeLessThan(obstacleReading(10, 'white', 1).pdA / 10)
    expect(obstacleReading(1, 'white', 1).v).toBeLessThan(FC51.vcc)
  })

  it('OUT goes low only when the signal beats the pot; range follows the threshold', () => {
    const r = detectRange('white', 1.2)
    expect(r).toBeGreaterThan(25)
    expect(r).toBeLessThan(40)
    expect(obstacleReading(r - 1, 'white', 1.2).out).toBe(0)
    expect(obstacleReading(r + 1, 'white', 1.2).out).toBe(1)
    expect(detectRange('black', 1.2)).toBeLessThan(r / 3)
    expect(detectRange('white', 0.4)).toBeGreaterThan(r)
  })
})

describe('TCRT5000 line follower', () => {
  it('a spot over the tape reads dark (high), over the floor light (low)', () => {
    expect(tapeCover(0)).toBeGreaterThan(0.95)
    expect(tapeCover(0.03)).toBeLessThan(0.01)
    expect(tcrtAdc(0)).toBeGreaterThan(3500)
    expect(tcrtAdc(0.03)).toBeLessThan(600)
    expect(tcrtAdc(0.009)).toBeGreaterThan(tcrtAdc(0.012))
  })

  it('the weighted average finds the line between sensors; digital snaps it', () => {
    const at = (off: number) => [0, 1, 2, 3, 4].map((i) => tcrtAdc(sensorX(i) - off))
    expect(linePosition(at(0), false)).toBeCloseTo(0, 4)
    expect(linePosition(at(0.005), false)!).toBeGreaterThan(0.003)
    expect(linePosition(at(0.005), false)!).toBeLessThan(0.008)
    expect(linePosition(at(-0.02), false)!).toBeLessThan(-0.015)
    expect([0, 0.0075, 0.015]).toContain(+linePosition(at(0.005), true)!.toFixed(4))
    expect(linePosition(at(0.2), false)).toBeNull()
  })

  it('measures signed distance to the track', () => {
    const p = trackPoint(0.1)
    expect(Math.abs(trackOffset(p.x, p.y))).toBeLessThan(1e-3)
    expect(trackOffset(0, 0)).toBeGreaterThan(0.3)
  })

  it('enough gain keeps the line under the bar for a lap; too little runs off', () => {
    const run = (kp: number, digital = false) => {
      let f = startFollower()
      let lost = 0
      for (let i = 0; i < 4000; i++) {
        f = followStep(f, 0.005, 0.4, kp, digital)
        if (f.err === null) lost++
      }
      return lost
    }
    expect(run(60)).toBe(0)
    expect(run(60, true)).toBe(0)
    expect(run(5)).toBeGreaterThan(1000)
  })
})

describe('IR receivers in sunlight', () => {
  it('a DC photodiode is fooled by sunlight; the 38 kHz receiver keeps working', () => {
    expect(plainReceiver(0.5, 0.2).works).toBe(true)
    expect(plainReceiver(20, 0.2).falseHit).toBe(true)
    expect(plainReceiver(100, 0.1).swing).toBeLessThan(0.05)
    expect(modulatedReceiver(100, 1).works).toBe(true)
  })

  it('sunlight shrinks the modulated range by its shot noise (∝ √I)', () => {
    const indoor = modulatedReceiver(0.5, 1).rangeM
    const sun = modulatedReceiver(100, 1).rangeM
    expect(indoor).toBeGreaterThan(7)
    expect(sun).toBeLessThan(3)
    expect(modulatedReceiver(100, sun * 1.1).works).toBe(false)
  })
})
