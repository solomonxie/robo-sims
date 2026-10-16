import { DEG, G } from '../common'
import { ARM_CAL, ARM_SERVOS, US_PER_RAD, actualJoints, armBudget, armMasses, driveAt, handGap, holdTorques, holdVerdict, hornShift, jointFromPulse, kickRail, logicMinVolts, pcaTicks, pulseUs, reversed, sagJoints, servoHoldAmps, servoStiffness, ticksUs } from './armbuild'
import { SERVO_ARM } from './chain'
import { armJacobian, jointTorques } from './jacobian'

const Q0 = [0, 0, 0, 0]

test('payload straight out: τ = m·g·lever per joint, base 0', () => {
  const t = holdTorques([{ at: [0.31, 0, 0.08], kg: 0.1, link: 4, what: 'p' }], Q0)
  expect(t[0]).toBeCloseTo(0, 12)
  expect(t[1]).toBeCloseTo(0.1 * G * 0.31, 12)
  expect(t[2]).toBeCloseTo(0.1 * G * 0.19, 12)
  expect(t[3]).toBeCloseTo(0.1 * G * 0.07, 12)
})

test('holding torque equals −Jᵀ·(0, 0, −m·g) at any pose', () => {
  const q = [0.3, 1.0, -0.7, 0.4]
  const p = armMasses(q, 0.1).find((m) => m.what === 'payload')!
  const viaJ = jointTorques(armJacobian(SERVO_ARM, q), [0, 0, -0.1 * G]).map((v) => -v)
  holdTorques([p], q).forEach((v, i) => expect(v).toBeCloseTo(viaJ[i], 12))
})

test('whole build straight out: brackets mid-link, servos at their joints, gripper + payload at the tool', () => {
  const t = holdTorques(armMasses(Q0, 0.1), Q0)
  expect(t[1]).toBeCloseTo(G * (0.03 * 0.06 + 0.055 * 0.12 + 0.025 * 0.18 + 0.009 * 0.24 + 0.015 * 0.275 + 0.134 * 0.31), 12)
  expect(t[2]).toBeCloseTo(G * (0.025 * 0.06 + 0.009 * 0.12 + 0.015 * 0.155 + 0.134 * 0.19), 12)
  expect(t[3]).toBeCloseTo(G * (0.015 * 0.035 + 0.134 * 0.07), 12)
  const up = [0, Math.PI / 2, 0, 0]
  holdTorques(armMasses(up, 0.2), up).forEach((v) => expect(v).toBeCloseTo(0, 12))
})

test('servo current, voltage scaling, rail kick', () => {
  const mg = ARM_SERVOS.mg996r
  expect(servoHoldAmps(mg, 0.5)).toBeCloseTo(0.01 + 0.5 * 2.3, 12)
  expect(servoHoldAmps(mg, 5)).toBeCloseTo(2.5, 12)
  expect(driveAt(mg, 5).stallNm).toBeCloseTo(5 / 6, 12)
  const k = kickRail(5, 0.6, [mg, mg, mg, ARM_SERVOS.sg90, ARM_SERVOS.sg90])
  expect(k.volts).toBeCloseTo(5 / (1 + 0.6 * (3 / 2.4 + 2 / 6.9)), 12)
  expect(k.amps).toBeCloseTo((5 - k.volts) / 0.6, 12)
  expect(logicMinVolts).toBeCloseTo(3.3 + 0.95 + 0.19 * 0.12, 12)
})

test('budget: USB rail browns the ESP32 out on start, the pack does not; shoulder thin', () => {
  const usb = armBudget(Q0, 0.1, 'usb')
  const pack = armBudget(Q0, 0.1, 'pack')
  expect(usb.resets).toBe(true)
  expect(pack.resets).toBe(false)
  expect(pack.joints[1].share).toBeCloseTo(G * 0.060725, 9)
  expect(pack.joints[1].verdict).toBe('thin')
  expect(usb.joints[1].share).toBeCloseTo((G * 0.060725) / (5 / 6), 9)
  expect([holdVerdict(0.5), holdVerdict(0.9), holdVerdict(1.2)]).toEqual(['ok', 'thin', 'weak'])
})

test('pulse ↔ angle, horn a tooth off, reversed servo, PCA9685 ticks', () => {
  expect(pulseUs(0, ARM_CAL[0])).toBe(1500)
  expect(pulseUs(Math.PI / 2, ARM_CAL[1])).toBeCloseTo(1500, 9)
  expect(pulseUs(Math.PI / 4, ARM_CAL[2])).toBeCloseTo(1000, 9)
  expect(pulseUs(-Math.PI, ARM_CAL[0])).toBe(500)
  expect(US_PER_RAD * DEG).toBeCloseTo(100 / 9, 9)
  expect(jointFromPulse(pulseUs(0.4, ARM_CAL[2]), ARM_CAL[2])).toBeCloseTo(0.4, 12)
  expect(jointFromPulse(pulseUs(0.4, ARM_CAL[3]), hornShift(ARM_CAL[3], 7.2))).toBeCloseTo(0.4 + 7.2 * DEG, 12)
  expect(jointFromPulse(pulseUs(0.4, ARM_CAL[3]), reversed(ARM_CAL[3]))).toBeCloseTo(-0.4, 12)
  expect(pcaTicks(1500)).toBe(307)
  expect(ticksUs(307)).toBeCloseTo(1499.0234375, 9)
  const qa = actualJoints([0.2, 1, -0.5, 0.1], ARM_CAL, ARM_CAL)
  qa.forEach((v, i) => expect(Math.abs(v - [0.2, 1, -0.5, 0.1][i])).toBeLessThan((ticksUs(1) / 2) / US_PER_RAD + 1e-12))
})

test('droop: half the play plus τ/k against gravity; error at the hand', () => {
  const mg = ARM_SERVOS.mg996r
  expect(servoStiffness(mg)).toBeCloseTo(1 / (10 * DEG), 12)
  const dq = sagJoints([0, 0.5, -0.2, 0], [mg, mg, mg, mg], 2 * DEG)
  expect(dq[0]).toBe(0)
  expect(dq[1]).toBeCloseTo(-6 * DEG, 12)
  expect(dq[2]).toBeCloseTo(3 * DEG, 12)
  expect(handGap(Q0, [0, DEG, 0, 0])).toBeCloseTo(2 * 0.31 * Math.sin(0.5 * DEG), 12)
})
