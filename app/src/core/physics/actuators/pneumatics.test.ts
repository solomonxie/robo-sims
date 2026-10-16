import {
  ATM_BAR,
  CYL_32,
  GRIP_OBJECTS,
  CYL_RUN,
  PNEUNET,
  airBounceHz,
  airPerCycleNl,
  airSpringNmm,
  annulusAreaMm2,
  circleAreaMm2,
  contactKPa,
  cylinderRun,
  gripHolds,
  gripOutcome,
  jammingHoldN,
  meterOutMmS,
  orificeNlS,
  pneuNetBendRad,
  pneuNetContact,
  pneuNetCurvature,
  pneuNetForceN,
  pneuNetPressureFor,
  pressForceN,
  regulatedBar,
  seriesConductance,
  strokeStats,
  trappedStiffnessNmm,
} from './pneumatics'

describe('pneumatic cylinder', () => {
  it('F = P·A: the rod side pushes less', () => {
    const A = circleAreaMm2(32)
    expect(A).toBeCloseTo(804.2, 1)
    expect(annulusAreaMm2(32, 12)).toBeCloseTo(691.2, 1)
    expect(pressForceN(6, A)).toBeCloseTo(482.5, 1)
    expect(pressForceN(6, annulusAreaMm2(32, 12))).toBeLessThan(pressForceN(6, A))
  })

  it('regulator only lowers, orifice chokes below the critical ratio', () => {
    expect(regulatedBar(5, 8)).toBe(5)
    expect(regulatedBar(9, 8)).toBe(8)
    expect(orificeNlS(7, 1, 0.5)).toBeCloseTo(3.5)
    expect(orificeNlS(7, 3, 0.5)).toBeCloseTo(3.5)
    expect(orificeNlS(7, 6, 0.5)).toBeLessThan(3.5)
    expect(orificeNlS(3, 3, 0.5)).toBe(0)
    expect(seriesConductance(0.5, 0.5)).toBeCloseTo(0.25)
  })

  it('meter-out sets the speed, not the supply', () => {
    const slow = { supplyBar: 6, needleC: 0.04, mode: 'cycle' as const }
    const v = strokeStats(cylinderRun(slow)).mmS
    const expected = meterOutMmS(seriesConductance(CYL_32.valveC, 0.04), annulusAreaMm2(32, 12))
    expect(v).toBeGreaterThan(expected * 0.7)
    expect(v).toBeLessThan(expected * 1.15)
    const v4 = strokeStats(cylinderRun({ ...slow, supplyBar: 4 })).mmS
    expect(Math.abs(v4 - v) / v).toBeLessThan(0.25)
    expect(strokeStats(cylinderRun({ ...slow, needleC: 0.3 })).mmS).toBeGreaterThan(3 * v)
  })

  it('extends, fills A to supply, retracts by the end of the run', () => {
    const run = cylinderRun({ supplyBar: 6, needleC: 0.2, mode: 'cycle' })
    const atRetract = run.filter((f) => f.t < CYL_RUN.retractS).at(-1)!
    expect(atRetract.x).toBeCloseTo(CYL_32.strokeMm)
    expect(atRetract.pA).toBeCloseTo(6, 1)
    expect(atRetract.pB).toBeCloseTo(0, 1)
    expect(run.at(-1)!.x).toBeCloseTo(0)
  })

  it('closed centre: trapped air overshoots, bounces and gives under a push', () => {
    const run = cylinderRun({ supplyBar: 6, needleC: 0.3, mode: 'stop' })
    const held = run.filter((f) => f.valve === 'hold')
    expect(held.length).toBeGreaterThan(10)
    const xs = held.map((f) => f.x)
    expect(Math.max(...xs)).toBeGreaterThan(CYL_RUN.stopAtMm + 1)
    const before = run.filter((f) => f.t < CYL_RUN.push[0]).at(-1)!
    const during = run.filter((f) => f.t < CYL_RUN.push[1]).at(-1)!
    const k = trappedStiffnessNmm(before.x, before.pA, before.pB)
    const dx = before.x - during.x
    expect(dx).toBeGreaterThan(0)
    expect(dx).toBeGreaterThan((CYL_RUN.pushN / k) * 0.4)
    expect(dx).toBeLessThan((CYL_RUN.pushN / k) * 2)
    expect(run.at(-1)!.x).toBeLessThan(5)
  })

  it('air spring and consumption', () => {
    expect(airSpringNmm(2, 100, 1000)).toBeCloseTo(2)
    expect(airBounceHz(10, 5)).toBeCloseTo(Math.sqrt(2000) / (2 * Math.PI))
    const nl = airPerCycleNl(32, 12, 100, 6)
    expect(nl).toBeCloseTo((1495.4 * 100 * (6 + ATM_BAR)) / ATM_BAR / 1e6, 2)
  })
})

describe('soft PneuNet finger', () => {
  it('curls linearly with pressure, about a half turn near 50 kPa', () => {
    expect(pneuNetCurvature(0)).toBe(0)
    expect(pneuNetCurvature(40)).toBeCloseTo(2 * pneuNetCurvature(20))
    expect(pneuNetBendRad(50) / Math.PI).toBeGreaterThan(0.9)
    expect(pneuNetBendRad(50) / Math.PI).toBeLessThan(1.1)
    expect(pneuNetPressureFor(pneuNetCurvature(33))).toBeCloseTo(33)
  })

  it('touches the ball tangentially and then pushes harder with pressure', () => {
    const c = pneuNetContact(22)
    const s = 22 + PNEUNET.gapMm
    const rho = 1 / c.curv
    expect(Math.hypot(s - rho, PNEUNET.depthMm)).toBeCloseTo(rho - 22)
    expect(c.arcMm).toBeLessThan(PNEUNET.lengthMm)
    expect(pneuNetForceN(c.pKPa - 1, 22)).toBe(0)
    expect(pneuNetForceN(60, 22)).toBeGreaterThan(pneuNetForceN(40, 22))
    expect(pneuNetForceN(60, 22)).toBeLessThan(2)
  })

  it('gentle: soft contact stress stays far below a rigid jaw on the same object', () => {
    const soft = contactKPa(pneuNetForceN(60, 22), 16 * 12)
    expect(soft).toBeLessThan(10)
    expect(contactKPa(20, 4)).toBe(5000)
    expect(gripHolds(0.8, 2, 0.8, 60)).toBe(true)
    expect(gripHolds(0.2, 2, 0.8, 60)).toBe(false)
    expect(jammingHoldN(80, 22)).toBeGreaterThan(5)
  })
})

describe('gripOutcome', () => {
  it('soft holds an egg without cracking it; a stiff servo jaw cracks it', () => {
    const soft = gripOutcome('soft', 1, GRIP_OBJECTS.egg)
    expect(soft.holds).toBe(true)
    expect(soft.crushed).toBe(false)
    expect(gripOutcome('rigid', 1, GRIP_OBJECTS.egg).crushed).toBe(true)
    expect(gripOutcome('rigid', 0.1, GRIP_OBJECTS.egg).holds).toBe(true)
  })

  it('soft is too weak for a heavy steel ball; the jaw and the jamming bag carry it', () => {
    expect(gripOutcome('soft', 1, GRIP_OBJECTS.steel).holds).toBe(false)
    expect(gripOutcome('rigid', 1, GRIP_OBJECTS.steel).holds).toBe(true)
    expect(gripOutcome('jamming', 1, GRIP_OBJECTS.steel).holds).toBe(true)
    expect(gripOutcome('jamming', 1, GRIP_OBJECTS.berry).crushed).toBe(false)
    expect(gripOutcome('soft', 0, GRIP_OBJECTS.berry).holds).toBe(false)
  })
})
