import { DEG, G } from '../common'
import { fallTau } from '../mobility/balance'
import { medianMs } from '../../stopwatch'
import {
  BAL_IMU,
  BAL_KIT,
  balBody,
  balGroups,
  balMotors,
  baseRun,
  compBiasError,
  gyroBias,
  maxShove,
  mountedAccel,
  accelLean,
  packZ,
  shoveKick,
  tiltReadRun,
  tuneOffset,
  tuneRun,
  tuneSheet,
} from './balancebot'

describe('build the base', () => {
  it('a higher pack raises the CoM and the pendulum length, so it falls slower', () => {
    const [lo, mid, top] = ([0, 1, 2] as const).map(balBody)
    expect(top.m).toBeCloseTo(lo.m)
    expect(packZ(2)).toBeCloseTo(BAL_KIT.decks[2] + BAL_KIT.packUp)
    expect(lo.h).toBeLessThan(mid.h)
    expect(mid.h).toBeLessThan(top.h)
    for (const b of [lo, mid, top]) expect(b.L).toBeGreaterThan(b.h)
    expect(top.L).toBeCloseTo(0.2055, 3)
    expect(top.tau).toBeCloseTo(fallTau(top.L))
    expect(top.tau).toBeGreaterThan(lo.tau)
  })
  it('groups add up to the CoM; the pack lifts most of it on top', () => {
    const g = balGroups(2)
    const b = balBody(2)
    expect(g.map((x) => x.name)).toEqual(['motors', 'frame', 'ESP32 + IMU', '2×18650 pack'])
    expect(g.reduce((a, x) => a + x.mz, 0) / b.m).toBeCloseTo(b.h)
    expect(g[3].mz / (b.m * b.h)).toBeGreaterThan(0.7)
    expect(g[0].z).toBeCloseTo((0.004 * 0.026) / 0.062)
  })
  it('the same shove spins a bottom-heavy body several times harder', () => {
    expect(shoveKick(0, 0.04) / shoveKick(2, 0.04)).toBeGreaterThan(4)
  })
  it('1:120 trades top speed for torque', () => {
    const a = balMotors('tt48')
    const b = balMotors('tt120')
    expect(a).toMatchObject({ ratio: 48, aMax: 14, vMax: 1.1 })
    expect(b.aMax / a.aMax).toBeCloseTo(2.5)
    expect(b.vMax).toBeCloseTo(0.44)
  })
  it('pack on top with 1:48 takes the hardest shove', () => {
    expect(baseRun(2, 'tt48', 0.04).fell).toBeNull()
    expect(baseRun(0, 'tt48', 0.04).fell).not.toBeNull()
    expect(baseRun(1, 'tt120', 0.04).sat).toBe(true)
    expect(maxShove(2, 'tt48')).toBeGreaterThan(maxShove(2, 'tt120'))
    expect(maxShove(2, 'tt48')).toBeGreaterThan(maxShove(1, 'tt48'))
    expect(maxShove(1, 'tt48')).toBeGreaterThan(maxShove(0, 'tt48'))
  })
  it('the shove search stays fast', () => {
    expect(medianMs(() => maxShove(2, 'tt48'), 3)).toBeLessThan(400)
  })
})

describe('read the tilt', () => {
  it('a still accelerometer reads the lean; wheel acceleration reads as lean', () => {
    expect(accelLean(mountedAccel(5 * DEG, 0, 0, 0, 0.04))).toBeCloseTo(5 * DEG)
    expect(accelLean(mountedAccel(0, 0, 0, 0.1 * G, 0))).toBeCloseTo(-Math.atan(0.1))
  })
  it('at the pendulum length the accel feels no lean at all (centre of percussion)', () => {
    const L = 0.2
    const tilt = 0.1
    const a = 3
    const alpha = (G * Math.sin(tilt) - a * Math.cos(tilt)) / L
    expect(accelLean(mountedAccel(tilt, 0, alpha, a, L))).toBeCloseTo(0, 6)
  })
  it('accel alone falls, a short τ falls, τ = 1 s holds and tracks within a few degrees', () => {
    const run = (filter: 'accel' | 'gyro' | 'comp', tau: number, cal = true) => tiltReadRun({ filter, tau, r: BAL_IMU.low, biasDps: gyroBias(cal) })
    expect(run('accel', 1).fell).not.toBeNull()
    expect(run('comp', 0.1).fell).not.toBeNull()
    const ok = run('comp', 1)
    expect(ok.fell).toBeNull()
    expect(ok.rms).toBeLessThan(1.5 * DEG)
    expect(ok.accel.length).toBe(ok.run.length)
    expect(run('gyro', 1).fell).toBeNull()
    expect(run('gyro', 1, false).rms).toBeGreaterThan(5 * DEG)
    expect(run('comp', 3, false).rms).toBeGreaterThan(run('comp', 3).rms)
  })
  it('an uncalibrated gyro offset leaves bias × τ of lean error', () => {
    expect(gyroBias(false)).toBeCloseTo(1.6)
    expect(Math.abs(gyroBias(true))).toBeLessThan(0.01)
    expect(compBiasError(1.6, 2)).toBeCloseTo(3.2)
  })
})

describe('tune the loop', () => {
  const g = { kp: 0.08, kd: 0.003, sp: 5, si: 2 }
  it('the battery sits about a degree off the axle', () => {
    expect(tuneOffset() / DEG).toBeCloseTo(1, 0)
  })
  it('stages: P and PD run off, speed P creeps, speed I holds', () => {
    expect(tuneSheet(g).map((s) => s.verdict)).toEqual(['runsOff', 'runsOff', 'creeps', 'holds'])
  })
  it('weak P topples, strong P without D swings out, D brings it back', () => {
    expect(tuneRun('p', { ...g, kp: 0.01 }).verdict).toBe('topples')
    expect(tuneRun('p', { ...g, kp: 0.15 }).verdict).toBe('oscillates')
    expect(tuneRun('speedPI', { ...g, kp: 0.15, kd: 0.006 }).verdict).toBe('holds')
    expect(tuneRun('speedP', { ...g, kd: 0 }).verdict).toBe('oscillates')
  })
})
