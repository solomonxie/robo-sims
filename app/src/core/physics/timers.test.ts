import {
  MILLIS_WRAP_DAYS,
  alarmPeriod,
  alarmTicks,
  driveToWall,
  elapsedMs,
  isDue,
  isrCounter,
  isrLoad,
  loopWallTime,
  pulseTrain,
  serialPrintS,
  serviceIrqs,
  softwareEdges,
  timerAt,
  timerTickHz,
} from './timers'

describe('hardware timer', () => {
  it('divides the 80 MHz APB clock: ÷80 gives 1 µs ticks', () => {
    expect(timerTickHz(80)).toBe(1e6)
    expect(alarmTicks(0.5, 80)).toBe(500000)
    expect(alarmPeriod(alarmTicks(0.5, 80), 80)).toBeCloseTo(0.5, 12)
  })

  it('rounds the alarm to whole ticks, so coarse ticks quantise the period', () => {
    expect(alarmTicks(0.00123, 8000)).toBe(12)
    expect(alarmPeriod(12, 8000)).toBeCloseTo(0.0012, 12)
    expect(alarmTicks(1e-9, 80)).toBe(1)
  })

  it('counts up and reloads at the alarm', () => {
    expect(timerAt(0.75, 80, 500000)).toEqual({ count: 250000, fired: 1 })
    expect(timerAt(1.0, 80, 500000)).toEqual({ count: 0, fired: 2 })
  })

  it('a delay() loop drifts by the work it does each pass', () => {
    const e = softwareEdges(100, 0.5, 0.02)
    const drift = e[99] - 100 * 0.5
    expect(drift).toBeGreaterThan(0.5)
    expect(drift).toBeLessThan(2)
    expect(softwareEdges(5, 0.5, 0)[4]).toBeCloseTo(2.5, 12)
  })
})

describe('ISR servicing', () => {
  it('runs every edge when the ISR is short', () => {
    const edges = pulseTrain(50, 1e-3)
    expect(serviceIrqs(edges, 2e-6).every((s) => s !== null)).toBe(true)
  })

  it('latches one pending edge, loses the rest', () => {
    const s = serviceIrqs([0, 1, 2, 3, 20], 5, 0)
    expect(s).toEqual([0, 5, null, null, 20])
  })

  it('loses about half the edges when the ISR takes twice the edge period', () => {
    const s = serviceIrqs(pulseTrain(200, 1e-3, 0), 2e-3, 0)
    expect(s.filter((x) => x === null).length).toBeGreaterThan(90)
    expect(s.filter((x) => x === null).length).toBeLessThan(110)
  })

  it('a Serial.println of 20 chars at 115200 takes ~1.7 ms', () => {
    expect(serialPrintS(20)).toBeCloseTo(1.736e-3, 5)
  })

  it('loop() time stretches by the ISRs that pre-empt it', () => {
    expect(loopWallTime(3, [[1, 2], [10, 11]])).toBe(4)
    expect(loopWallTime(0.5, [[1, 2]])).toBe(0.5)
  })

  it('volatile copy-then-clear wipes counts that land in the gap; critical sections keep all', () => {
    const edges = pulseTrain(400, 1e-3)
    const until = 0.3
    const vol = isrCounter(edges, 2e-6, 4e-3, 1e-3, 'volatile', until)
    const crit = isrCounter(edges, 2e-6, 4e-3, 1e-3, 'critical', until)
    const plain = isrCounter(edges, 2e-6, 4e-3, 1e-3, 'plain', until)
    const ran = (r: typeof vol, t: number) => r.runs.filter(([s]) => s <= t).length
    const sum = (r: typeof vol, k: 'got' | 'wiped') => r.reads.reduce((a, x) => a + x[k], 0)
    const lastCopy = (r: typeof vol) => r.reads[r.reads.length - 1].copy
    expect(sum(crit, 'got')).toBe(ran(crit, lastCopy(crit)))
    expect(sum(crit, 'wiped')).toBe(0)
    expect(sum(vol, 'wiped')).toBeGreaterThan(0.15 * ran(vol, until))
    expect(sum(vol, 'got') + sum(vol, 'wiped')).toBe(ran(vol, vol.reads[vol.reads.length - 1].clear))
    expect(sum(plain, 'got')).toBe(0)
  })

  it('a long ISR eats the CPU', () => {
    const r = isrCounter(pulseTrain(100, 1e-3), 5e-3, 4e-3, 0, 'critical', 0.08)
    expect(isrLoad(r.runs, 0.08)).toBeGreaterThan(0.95)
    expect(isrLoad(isrCounter(pulseTrain(100, 1e-3), 2e-6, 4e-3, 0, 'critical', 0.08).runs, 0.08)).toBeLessThan(0.01)
  })
})

describe('millis without delay', () => {
  it('unsigned subtraction survives the 49.7-day rollover', () => {
    expect(MILLIS_WRAP_DAYS).toBeCloseTo(49.71, 2)
    expect(elapsedMs(5, 4294967290)).toBe(11)
    expect(isDue(5, 4294967290, 10)).toBe(true)
    expect(isDue(1000, 600, 500)).toBe(false)
  })

  it('a robot reading its sensor once a second can hit the wall; every 50 ms it stops on the line', () => {
    const slow = driveToWall(60, 30, 15, 1, 0.2)
    expect(slow.crashed).toBe(true)
    expect(slow.stopD).toBe(0)
    const fast = driveToWall(60, 30, 15, 0.05)
    expect(fast.crashed).toBe(false)
    expect(fast.stopD).toBeGreaterThan(13.4)
    expect(fast.stopD).toBeLessThanOrEqual(15)
    const lucky = driveToWall(60, 30, 15, 1, 0.6)
    expect(lucky.crashed).toBe(false)
    expect(lucky.stopD).toBeCloseTo(12, 9)
  })
})
