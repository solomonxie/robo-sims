import { DEG, G } from '../common'
import { armMasses, holdTorques } from './armbuild'
import {
  SERVO_DRIVES, TwoLink, armEnergy, coriolis, couplingTorque, driveClip, fastestMove, forwardDynamics, freeSwing, gravity, inverseDynamics, lumpLink, massMatrix, maxPayload, moveDemand, reflectedInertia, restMove, servoTwoLink, trackRun,
} from './dynamics'
import { jointTorques, planarJacobian } from './jacobian'
import { V2 } from './transforms'

const HAND: TwoLink = { l1: 1, l2: 1, links: [{ m: 1, lc: 0.5, I: 0.1 }, { m: 2, lc: 0.4, I: 0.2 }], rotor: [0, 0], damping: [0, 0] }

test('M(q) entries by hand', () => {
  const M0 = massMatrix(HAND, [0.3, 0])
  expect(M0[0][0]).toBeCloseTo(0.25 + 0.1 + 2 * (1 + 0.16 + 0.8) + 0.2, 12)
  expect(M0[0][1]).toBeCloseTo(2 * (0.16 + 0.4) + 0.2, 12)
  expect(M0[1][0]).toBeCloseTo(M0[0][1], 12)
  expect(M0[1][1]).toBeCloseTo(0.52, 12)
  const M90 = massMatrix(HAND, [0, Math.PI / 2])
  expect(M90[0][0]).toBeCloseTo(2.87, 12)
  expect(M90[0][1]).toBeCloseTo(0.52, 12)
  const geared = massMatrix({ ...HAND, rotor: [0.5, 0.25] }, [0, Math.PI / 2])
  expect(geared[0][0]).toBeCloseTo(3.37, 12)
  expect(geared[1][1]).toBeCloseTo(0.77, 12)
  expect(geared[0][1]).toBeCloseTo(0.52, 12)
})

test('Coriolis/centrifugal by hand: h = m2·l1·lc2·sin q2', () => {
  const c = coriolis(HAND, [0, Math.PI / 2], [1, 0])
  expect(c[0]).toBeCloseTo(0, 12)
  expect(c[1]).toBeCloseTo(0.8, 12)
  const c2 = coriolis(HAND, [0, Math.PI / 2], [1, 2])
  expect(c2[0]).toBeCloseTo(-0.8 * 2 * 4, 12)
  expect(couplingTorque(HAND, [0, Math.PI / 2], [1, 0], [2, 0])).toBeCloseTo(0.52 * 2 + 0.8, 12)
})

test('g(q) = Σ Jᵀ·m·g over each mass', () => {
  const q: V2 = [0.4, -0.9]
  const l1 = jointTorques(planarJacobian([0.5], [q[0]]), [0, 1 * G])
  const l2 = jointTorques(planarJacobian([1, 0.4], q), [0, 2 * G])
  const g = gravity(HAND, q)
  expect(g[0]).toBeCloseTo(l1[0] + l2[0], 12)
  expect(g[1]).toBeCloseTo(l2[1], 12)
})

test('g(q) of the servo build equals holdTorques on shoulder and elbow', () => {
  const { arm } = servoTwoLink(0.15)
  for (const [a, b] of [[0, 0], [40 * DEG, -70 * DEG], [100 * DEG, 30 * DEG]]) {
    const qs = [0, a, b, 0]
    const hold = holdTorques(armMasses(qs, 0.15), qs)
    const g = gravity(arm, [a, b])
    expect(g[0]).toBeCloseTo(hold[1], 12)
    expect(g[1]).toBeCloseTo(hold[2], 12)
  }
})

test('lumped link and reflected inertia', () => {
  const l = lumpLink([{ kg: 1, r: 0 }, { kg: 1, r: 2 }])
  expect(l).toEqual({ m: 2, lc: 1, I: 2 })
  expect(reflectedInertia(2.5e-7, 250)).toBeCloseTo(0.015625, 12)
})

test('free double pendulum keeps its energy (RK4)', () => {
  const run = freeSwing(HAND, [0.2, 1.1], 5, 0.001)
  const e0 = run[0].energy
  const drift = Math.max(...run.map((f) => Math.abs(f.energy - e0)))
  expect(drift / Math.abs(e0)).toBeLessThan(1e-6)
  expect(Math.max(...run.map((f) => Math.abs(f.qd[1])))).toBeGreaterThan(1)
})

test('inverse then forward dynamics round-trips', () => {
  const { arm } = servoTwoLink(0.1)
  const q = [0.5, -0.8]
  const qd = [1.2, -0.7]
  const qdd = [3, -5]
  const tau = inverseDynamics(arm, q, qd, qdd).tau
  const back = forwardDynamics(arm, q, qd, tau)
  expect(back[0]).toBeCloseTo(3, 9)
  expect(back[1]).toBeCloseTo(-5, 9)
  const e = armEnergy(arm, q, [0, 0])
  expect(e.kinetic).toBe(0)
})

test('drive clip: full stall when braking, T–ω line when driving', () => {
  const d = SERVO_DRIVES[0]
  const free = (d.freeRpm * 2 * Math.PI) / 60
  expect(driveClip(d, 0, 5)).toBeCloseTo(d.stallNm, 12)
  expect(driveClip(d, free / 2, 5)).toBeCloseTo(d.stallNm / 2, 12)
  expect(driveClip(d, free / 2, -5)).toBeCloseTo(-d.stallNm, 12)
  expect(driveClip(d, free, 0.3)).toBeCloseTo(0, 12)
})

test('gravity feed-forward removes the PD sag; full inverse dynamics tracks a fast move', () => {
  const { arm } = servoTwoLink(0.1)
  const qa = [10 * DEG, 20 * DEG]
  const qb = [70 * DEG, -60 * DEG]
  const ref = restMove(qa, qb, 0.6, 0.1)
  const cfg = { kp: [4, 2] as V2, kd: [0.3, 0.15] as V2 }
  const err = (run: ReturnType<typeof trackRun>, from = 0) => Math.max(...run.filter((f) => f.t >= from).map((f) => Math.hypot(f.ref.q[0] - f.q[0], f.ref.q[1] - f.q[1])))
  const pd = trackRun(arm, ref, { ...cfg, ff: 'none' }, 2.5)
  const pdg = trackRun(arm, ref, { ...cfg, ff: 'gravity' }, 2.5)
  const full = trackRun(arm, ref, { ...cfg, ff: 'full' }, 2.5)
  const last = pd[pd.length - 1]
  expect(last.q[0] - qb[0]).toBeCloseTo(-gravity(arm, last.q)[0] / 4, 2)
  expect(err(pdg, 2)).toBeLessThan(1e-3)
  expect(err(full)).toBeLessThan(err(pdg) / 5)
})

test('payload limits: heavier → slower; demand > 1 past the fastest time', () => {
  const qa = [-20 * DEG, 40 * DEG]
  const qb = [80 * DEG, -40 * DEG]
  const light = fastestMove(servoTwoLink(0).arm, qa, qb)
  const heavy = fastestMove(servoTwoLink(0.2).arm, qa, qb)
  expect(heavy).toBeGreaterThan(light)
  expect(moveDemand(servoTwoLink(0.2).arm, qa, qb, heavy * 0.9).worst).toBeGreaterThan(1)
  expect(moveDemand(servoTwoLink(0.2).arm, qa, qb, heavy * 1.01).worst).toBeLessThanOrEqual(1)
  const kg = maxPayload(qa, qb, heavy, (m) => servoTwoLink(m).arm)
  expect(kg).toBeCloseTo(0.2, 2)
  expect(fastestMove(servoTwoLink(5).arm, qa, qb)).toBe(Infinity)
})
