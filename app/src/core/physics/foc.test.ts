import {
  FOC_MOTOR,
  abcToDq,
  clarke,
  dqToAbc,
  focRun,
  invClarke,
  park,
  piGains,
  piStep,
  pmsmStep,
  pmsmTorque,
  iqRiseTime,
  sineCurrents,
  sixStepCurrents,
  svMaxVolts,
  svSector,
  svpwm,
} from './foc'

describe('Clarke and Park', () => {
  it('turns three sines into a rotating vector, then into steady d/q', () => {
    for (const th of [0, 0.7, 2, 4.5]) {
      const [a, b, c] = sineCurrents(2, th + Math.PI / 2)
      expect(a + b + c).toBeCloseTo(0)
      const v = clarke(a, b, c)
      expect(Math.hypot(v.alpha, v.beta)).toBeCloseTo(2)
      const dq = park(v.alpha, v.beta, th)
      expect(dq.d).toBeCloseTo(0)
      expect(dq.q).toBeCloseTo(2)
    }
    expect(invClarke(1, 0)).toEqual([1, -0.5, -0.5])
    const back = abcToDq(dqToAbc(0.3, -1.2, 1.1), 1.1)
    expect(back.d).toBeCloseTo(0.3)
    expect(back.q).toBeCloseTo(-1.2)
  })
  it('six-step torque ripples 13 %, FOC is flat', () => {
    const qs = Array.from({ length: 360 }, (_, k) => abcToDq(sixStepCurrents(1, (k + 0.5) * (Math.PI / 180)), (k + 0.5) * (Math.PI / 180)).q)
    expect(Math.min(...qs) / Math.max(...qs)).toBeCloseTo(Math.cos(Math.PI / 6), 2)
    expect(Math.max(...qs)).toBeCloseTo(2 / Math.sqrt(3), 2)
  })
})

describe('SVPWM', () => {
  it('centres at 50 %, reaches 0…1 at vbus/√3', () => {
    expect(svpwm(0, 0, 24)).toEqual([0.5, 0.5, 0.5])
    const d = svpwm(svMaxVolts(24) * Math.cos(Math.PI / 6), svMaxVolts(24) * 0.5, 24)
    expect(Math.max(...d)).toBeCloseTo(1)
    expect(Math.min(...d)).toBeCloseTo(0)
    expect(svSector(1, 0.1)).toBe(1)
    expect(svSector(-1, -0.1)).toBe(4)
  })
})

describe('Current loops', () => {
  it('PI clamps and stops winding up', () => {
    const s = piStep({ integ: 0, out: 0, sat: false }, 10, 1, 100, 0.01, 5)
    expect(s.out).toBe(5)
    expect(s.sat).toBe(true)
    expect(s.integ).toBe(0)
    expect(piGains(100, 0.2, 4e-4).kp).toBeCloseTo(0.2513, 3)
  })
  it('PMSM: torque from Iq, current settles at (V − EMF)/R', () => {
    expect(pmsmTorque(0, 10)).toBeCloseTo(0.84)
    let i = { d: 0, q: 0 }
    for (let k = 0; k < 20000; k++) i = pmsmStep(i, { d: 0, q: 2 }, 0, 1e-6)
    expect(i.q).toBeCloseTo(2 / FOC_MOTOR.ohms, 0)
  })
  it('tracks the step; faster with bandwidth; angle error loses torque as cos', () => {
    const slow = focRun(5, 200, 0)
    const fast = focRun(5, 1000, 0)
    const end = (r: ReturnType<typeof focRun>) => r[r.length - 1]
    expect(end(fast).iq).toBeCloseTo(5, 1)
    expect(Math.abs(end(fast).id)).toBeLessThan(0.05)
    expect(iqRiseTime(fast)!).toBeLessThan(iqRiseTime(slow)!)
    const off = end(focRun(5, 1000, Math.PI / 3))
    expect(off.iqSeen).toBeCloseTo(5, 1)
    expect(off.iq).toBeCloseTo(2.5, 1)
    expect(off.torque / end(fast).torque).toBeCloseTo(0.5, 1)
  })
  it('a big step saturates the bus voltage', () => {
    expect(focRun(10, 2000, 0).some((f) => f.sat)).toBe(true)
  })
})
