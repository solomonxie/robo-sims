import {
  ARM_TASK,
  BURN_MARGIN_C,
  CAR_TASK,
  DRIVES,
  DriveKind,
  ampsAt,
  armGravityNm,
  armStallRad,
  availableNm,
  checkDrive,
  continuousAmps,
  feasibleMoveS,
  firstAbove,
  heatRun,
  indexAt,
  indexMove,
  operatingRpm,
  peakTorque,
  ratedNm,
  rmsTorque,
  steadyTempC,
  torqueBudget,
} from './sizing'

const car = (slopeDeg: number) => torqueBudget({ kind: 'car', ...CAR_TASK, slopeDeg })
const arm = (payloadKg: number) => torqueBudget({ kind: 'arm', ...ARM_TASK, payloadKg })
const verdicts = (b: ReturnType<typeof torqueBudget>) =>
  Object.fromEntries((Object.keys(DRIVES) as DriveKind[]).map((k) => [k, checkDrive(DRIVES[k], b, 1.5).verdict]))

describe('torque budget', () => {
  it('sums gravity, rolling, acceleration and friction per wheel', () => {
    const b = car(15)
    expect(b.gravity).toBeCloseTo((1.2 * 9.81 * Math.sin((15 * Math.PI) / 180) * 0.0325) / 2, 6)
    expect(b.accel).toBeCloseTo((1.2 * 0.5 * 0.0325) / 2, 6)
    expect(b.peak).toBeCloseTo(b.gravity + b.rolling + b.accel + b.friction, 9)
    expect(b.targetRpm).toBeCloseTo(88.1, 1)
  })
  it('arm needs its worst case held horizontal', () => {
    const t = { kind: 'arm' as const, ...ARM_TASK, payloadKg: 0.5 }
    expect(armGravityNm(t, 0)).toBeCloseTo((0.5 * 0.15 + 0.04 * 0.15) * 9.81, 6)
    expect(armGravityNm(t, Math.PI / 2)).toBeCloseTo(0, 9)
    expect(arm(0.5).peak).toBeGreaterThan(arm(0.1).peak)
  })
  it('only some drives cover each task', () => {
    expect(verdicts(car(0))).toEqual({ tt: 'ok', n20: 'ok', g37: 'ok', nema17: 'ok', servo: 'slow' })
    expect(verdicts(car(15))).toEqual({ tt: 'weak', n20: 'thin', g37: 'ok', nema17: 'ok', servo: 'slow' })
    expect(verdicts(car(30))).toEqual({ tt: 'stall', n20: 'weak', g37: 'ok', nema17: 'ok', servo: 'slow' })
    expect(verdicts(arm(0.1))).toEqual({ tt: 'stall', n20: 'stall', g37: 'ok', nema17: 'ok', servo: 'ok' })
    expect(verdicts(arm(0.5))).toEqual({ tt: 'stall', n20: 'stall', g37: 'ok', nema17: 'stall', servo: 'weak' })
  })
  it('DC slows down its line, a stepper holds speed or slips', () => {
    expect(operatingRpm(DRIVES.tt, 0.04, 300)).toBeCloseTo(100, 6)
    expect(operatingRpm(DRIVES.tt, 0, 50)).toBe(50)
    expect(operatingRpm(DRIVES.nema17, 0.3, 100)).toBe(100)
    expect(operatingRpm(DRIVES.nema17, 0.5, 100)).toBe(0)
    expect(availableNm(DRIVES.nema17, 0)).toBeCloseTo(0.4, 6)
    expect(availableNm(DRIVES.nema17, 1200)).toBeLessThan(0.4)
  })
  it('a weak arm stalls below horizontal', () => {
    const t = { kind: 'arm' as const, ...ARM_TASK, payloadKg: 0.5 }
    const s = armStallRad(DRIVES.nema17, t)!
    expect(s).toBeLessThan(0)
    expect(armGravityNm(t, s) + t.bearingNm).toBeCloseTo(availableNm(DRIVES.nema17, 0), 6)
    expect(armStallRad(DRIVES.servo, t)).toBeNull()
    expect(armStallRad(DRIVES.g37, t)).toBeNull()
  })
})

describe('duty cycle', () => {
  it('RMS of a trapezoid move', () => {
    const m = indexMove(0.3, 0)
    const [a, c, d] = m.segs.map((s) => s.torque)
    expect(rmsTorque(m.segs)).toBeCloseTo(Math.sqrt((a * a + c * c + d * d) / 3), 9)
    expect(peakTorque(m.segs)).toBeCloseTo(a, 9)
    expect(m.alpha).toBeCloseTo((4.5 * Math.PI) / 2 / 0.09, 6)
  })
  it('dwell lowers RMS but not peak', () => {
    const a = indexMove(0.3, 0)
    const b = indexMove(0.3, 0.6)
    expect(rmsTorque(b.segs)).toBeCloseTo(rmsTorque(a.segs) * Math.sqrt(0.3 / 0.9), 9)
    expect(peakTorque(b.segs)).toBe(peakTorque(a.segs))
    expect(rmsTorque(a.segs)).toBeGreaterThan(ratedNm(DRIVES.g37))
    expect(rmsTorque(b.segs)).toBeLessThan(ratedNm(DRIVES.g37))
    expect(feasibleMoveS(DRIVES.g37, 0.3)).toBe(0.3)
    const f = feasibleMoveS(DRIVES.n20, 0.3)
    expect(f).toBeGreaterThan(0.3)
    const x = indexMove(f, 0)
    expect(peakTorque(x.segs)).toBeCloseTo(availableNm(DRIVES.n20, (x.vmax * 60) / (2 * Math.PI)), 4)
  })
  it('index position follows the trapezoid', () => {
    expect(indexAt(0, 0.6, 0.4).pos).toBe(0)
    expect(indexAt(0.3, 0.6, 0.4).pos).toBeCloseTo(0.5, 9)
    expect(indexAt(0.8, 0.6, 0.4)).toMatchObject({ pos: 1, seg: 3 })
    expect(indexAt(1.1, 0.6, 0.4).seg).toBe(0)
  })
})

describe('thermal limits', () => {
  const d = DRIVES.g37
  it('continuous rating derates with ambient', () => {
    expect(continuousAmps(d) ** 2 * d.ohms * d.kPerW).toBeCloseTo(d.maxC - 25, 6)
    expect(ratedNm(d, 60)).toBeLessThan(ratedNm(d, 25))
    expect(ratedNm(d, d.maxC)).toBe(0)
  })
  it('heats with time constant τ toward the steady temperature', () => {
    const load = ratedNm(d) * 0.5
    const run = heatRun(d, load, 1, 10, 25, 2000)
    const ss = steadyTempC(d, load, 1, 25)
    const at = run.find((f) => f.t === d.tauS)!
    expect((at.tempC - 25) / (ss - 25)).toBeGreaterThan(0.55)
    expect((at.tempC - 25) / (ss - 25)).toBeLessThan(0.7)
    expect(run[run.length - 1].tempC).toBeCloseTo(ss, 0)
    expect(run[run.length - 1].tempC).toBeLessThan(d.maxC)
  })
  it('half duty halves the heat; overload cooks it', () => {
    expect(steadyTempC(d, 0.5, 1, 25)).toBeCloseTo(heatRun(d, 0.5, 1, 10, 25, 3000).at(-1)!.tempC, 0)
    expect(steadyTempC(d, 0.5, 0.5, 25)).toBeLessThan(steadyTempC(d, 0.5, 1, 25))
    expect(steadyTempC(d, 3, 1, 25)).toBe(Infinity)
    const burnt = heatRun(d, ratedNm(d) * 2.5, 1, 10, 25, 900)
    expect(burnt.some((f) => f.dead)).toBe(true)
    expect(Math.max(...burnt.map((f) => f.tempC))).toBeLessThan(d.maxC + BURN_MARGIN_C + 10)
    expect(burnt.at(-1)!.amps).toBe(0)
    expect(ampsAt(d, 0)).toBe(d.noLoadA)
    expect(firstAbove(heatRun(d, ratedNm(d) * 1.5, 1, 10, 25, 900), d.maxC)).not.toBeNull()
    expect(firstAbove(heatRun(d, ratedNm(d) * 1.5, 0.25, 10, 25, 900), d.maxC)).toBeNull()
  })
})
