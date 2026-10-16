import {
  ESC,
  HALL_STEP,
  bldcStartRun,
  closedAt,
  commutationHz,
  commutationStep,
  dshotBits,
  dshotFrame,
  dshotValue,
  escPulseUs,
  escRun,
  fieldAngle,
  floatingPhase,
  hallCode,
  kvToKt,
  noLoadRpm,
  packVolts,
  phaseState,
  phaseVolts,
  propAmps,
  propSpeed,
  stepName,
  stepProgress,
  torqueFactor,
} from './bldc'

const last = <T>(a: T[]) => a[a.length - 1]

describe('three-phase drive', () => {
  it('each step drives one phase high, one low and floats the third', () => {
    for (let s = 0; s < 6; s++) expect([0, 1, 2].map((p) => phaseState(s, p)).sort()).toEqual([-1, 0, 1])
    expect(stepName(0)).toBe('A+ B−')
    expect(floatingPhase(0)).toBe(2)
    expect(fieldAngle(1) - fieldAngle(0)).toBeCloseTo(Math.PI / 3)
    expect(stepProgress(0)).toBeCloseTo(0.5)
    expect(stepProgress(Math.PI / 6 + 1e-6)).toBeCloseTo(0)
  })
  it('commutation keeps the field 60…120° ahead of the rotor', () => {
    for (let th = -7; th < 7; th += 0.05) expect(torqueFactor(commutationStep(th), th)).toBeGreaterThan(Math.sin(Math.PI / 3) - 1e-9)
  })
  it('the floating phase ramps through the midpoint between its driven levels', () => {
    expect(phaseVolts(0, 0, 0, 12, 1)).toBe(12)
    expect(phaseVolts(0, 0, 1, 12, 1)).toBe(0)
    expect(phaseVolts(0, 0.5, 2, 12, 1)).toBeCloseTo(6)
    expect(phaseVolts(0, 0, 2, 12, 1)).toBeCloseTo(12)
    expect(phaseVolts(0, 1, 2, 12, 0.5)).toBeCloseTo(0)
  })
  it('KV is rpm per volt; Kt = 60 / (2π KV)', () => {
    expect(noLoadRpm(2300, 14.8)).toBeCloseTo(34040)
    expect(kvToKt(1000)).toBeCloseTo(0.00955, 5)
    expect(commutationHz(6000, 14)).toBeCloseTo(4200)
  })
})

describe('hall sensors', () => {
  it('six valid codes, each mapped to the step for that sector; 000 and 111 never occur', () => {
    const seen = new Set<number>()
    for (let th = 0; th < 2 * Math.PI; th += 0.01) {
      const c = hallCode(th)
      seen.add(c)
      expect(HALL_STEP[c]).toBe(commutationStep(th))
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6])
    expect(HALL_STEP[0]).toBe(-1)
    expect(HALL_STEP[7]).toBe(-1)
  })
  it('Halls start under any load; sensorless needs an open-loop ramp and loses sync under heavy load', () => {
    const hall = bldcStartRun('hall', 0.04)
    expect(closedAt(hall)).toBeLessThan(0.01)
    expect(last(hall).w).toBeGreaterThan(300)
    const easy = bldcStartRun('bemf', 0)
    expect(easy[0].zc).toBe(false)
    expect(easy.some((f) => f.phase === 'ramp')).toBe(true)
    expect(closedAt(easy)).toBeGreaterThan(0.15)
    expect(last(easy).phase).toBe('closed')
    const heavy = bldcStartRun('bemf', 0.04, 1.2)
    expect(closedAt(heavy)).toBeNull()
    expect(last(heavy).tries).toBeGreaterThan(1)
  })
})

describe('ESC basics', () => {
  it('PWM 1–2 ms and DShot values; the DShot checksum', () => {
    expect(escPulseUs(0.5)).toBe(1500)
    expect(dshotValue(0)).toBe(0)
    expect(dshotValue(1)).toBe(2047)
    expect(dshotValue(-1, true)).toBe(1047)
    expect(dshotValue(-0.5)).toBe(0)
    expect(dshotFrame(1046)).toBe(0x82c6)
    expect(dshotBits(0x8000)[0]).toBe(1)
  })
  it('more cells, more speed and far more current (prop load ∝ ω²)', () => {
    const [s2, s3, s4] = [2, 3, 4].map((c) => propSpeed(packVolts(c), 1))
    expect(s2).toBeLessThan(s3)
    expect(s3).toBeLessThan(s4)
    expect(propAmps(packVolts(4), 1) / propAmps(packVolts(2), 1)).toBeGreaterThan(2.5)
  })
  it('arms at zero throttle, ramps, holds the current limit, derates when hot, reverses only in 3D', () => {
    const r = escRun(3, 0.6, false)
    expect(r.find((f) => f.t > 1)?.state).toBe('arming')
    expect(r.find((f) => f.t >= ESC.goS + 0.1)!.rpm).toBeLessThan(last(r).rpm * 0.5)
    const big = escRun(4, 1, false)
    expect(Math.max(...big.map((f) => f.amps))).toBeLessThanOrEqual(ESC.limitA + 1e-6)
    expect(big.some((f) => f.state === 'limit')).toBe(true)
    expect(last(big).tempC).toBeLessThan(ESC.cutC)
    expect(big.some((f) => f.state === 'hot')).toBe(true)
    expect(last(escRun(3, -0.5, false)).rpm).toBe(0)
    expect(last(escRun(3, -0.5, true)).rpm).toBeLessThan(-1000)
  })
})
