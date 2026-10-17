import { medianMs } from '../../stopwatch'
import { ARM_JOINT, SINK_MOUNTS, boxAirRise, finGap, gravityNm, heatsinkView, jointHeat, sinkTheta } from './thermal'

describe('heatsinks', () => {
  it('natural convection has an optimum fin count: too few lack area, too many choke the channels', () => {
    const v = heatsinkView({ watts: 6, fins: 10, orient: 'vertical', air: 'open', mount: 'paste' })
    expect(v.best.fins).toBeGreaterThan(3)
    expect(v.best.fins).toBeLessThan(14)
    expect(v.sweep[0].theta).toBeGreaterThan(v.best.theta)
    expect(v.sweep[v.sweep.length - 1].theta).toBeGreaterThan(1.5 * v.best.theta)
    expect(v.best.theta).toBeGreaterThan(4)
    expect(v.best.theta).toBeLessThan(15)
  })
  it('airflow lowers θsa and moves the optimum to denser fins', () => {
    const still = heatsinkView({ watts: 6, fins: 10, orient: 'vertical', air: 'open', mount: 'paste' })
    const moving = heatsinkView({ watts: 6, fins: 10, orient: 'vertical', air: 'driving', mount: 'paste' })
    expect(moving.theta).toBeLessThan(0.6 * still.theta)
    expect(moving.best.fins).toBeGreaterThan(still.best.fins)
  })
  it('vertical fins beat horizontal ones', () => {
    expect(sinkTheta(8, 'vertical', 0, 6, 25).theta).toBeLessThan(sinkTheta(8, 'sideways', 0, 6, 25).theta)
  })
  it('paste beats a pad beats a dry loose joint', () => {
    expect(SINK_MOUNTS.paste.theta).toBeLessThan(SINK_MOUNTS.pad.theta)
    expect(SINK_MOUNTS.pad.theta).toBeLessThan(SINK_MOUNTS.loose.theta)
  })
  it('a closed box heats its own air; vents and a fan bring it down', () => {
    const closed = boxAirRise('closed', 8, 25).rise
    const vented = boxAirRise('vented', 8, 25).rise
    const fan = boxAirRise('fan', 8, 25).rise
    expect(boxAirRise('open', 8, 25).rise).toBe(0)
    expect(closed).toBeGreaterThan(20)
    expect(vented).toBeLessThan(closed)
    expect(fan).toBeLessThan(vented)
  })
  it('temperatures fall down the chain to room air', () => {
    const v = heatsinkView({ watts: 6, fins: 8, orient: 'vertical', air: 'closed', mount: 'pad' })
    for (let i = 1; i < v.temps.length; i++) expect(v.temps[i]).toBeLessThanOrEqual(v.temps[i - 1])
    expect(v.temps[v.temps.length - 1]).toBe(25)
    expect(finGap(8)).toBeCloseTo((0.04 - 8 * 0.0012) / 7, 9)
  })
  it('recomputes well under 100 ms', () => {
    expect(medianMs(() => heatsinkView({ watts: 9, fins: 14, orient: 'up', air: 'vented', mount: 'dry' }))).toBeLessThan(50)
  })
})

describe('motor heating', () => {
  it('a servo holding a heavy payload level overheats; a light one does not', () => {
    const heavy = jointHeat({ drive: 'servo', payloadKg: 0.3, busy: 1, idle: 1, ambC: 25 })
    const light = jointHeat({ drive: 'servo', payloadKg: 0.05, busy: 1, idle: 1, ambC: 25 })
    expect(heavy.steadyC).toBeGreaterThan(heavy.d.maxC)
    expect(heavy.overAt).not.toBeNull()
    expect(light.steadyC).toBeLessThan(light.d.maxC)
    expect(heavy.needNm).toBeCloseTo(gravityNm(0.3), 9)
  })
  it('parking the arm part of the time cools the servo', () => {
    const full = jointHeat({ drive: 'servo', payloadKg: 0.2, busy: 1, idle: 1, ambC: 25 })
    const part = jointHeat({ drive: 'servo', payloadKg: 0.2, busy: 0.3, idle: 1, ambC: 25 })
    expect(part.steadyC).toBeLessThan(full.steadyC)
  })
  it('continuous torque derates with ambient and sits well below stall', () => {
    const cool = jointHeat({ drive: 'servo', payloadKg: 0.1, busy: 1, idle: 1, ambC: 25 })
    const hot = jointHeat({ drive: 'servo', payloadKg: 0.1, busy: 1, idle: 1, ambC: 60 })
    expect(hot.contNm).toBeLessThan(cool.contNm)
    expect(cool.contNm).toBeLessThan(0.5 * cool.peakNm)
  })
  it('a stepper heats with no load; idle current reduction cuts heat as I² but holding torque only as I', () => {
    const full = jointHeat({ drive: 'stepper', payloadKg: 0, busy: 0.1, idle: 1, ambC: 25 })
    const half = jointHeat({ drive: 'stepper', payloadKg: 0, busy: 0.1, idle: 0.5, ambC: 25 })
    expect(full.steadyC).toBeGreaterThan(50)
    expect(half.wattsIdle / full.wattsIdle).toBeLessThan(0.3)
    expect(half.idleHoldNm / full.idleHoldNm).toBeCloseTo(0.5, 9)
    expect(half.steadyC).toBeLessThan(full.steadyC)
    expect(jointHeat({ drive: 'stepper', payloadKg: 0.4, busy: 0.1, idle: 0.2, ambC: 25 }).slipsIdle).toBe(true)
  })
  it('the run starts at ambient and spans the time-lapse; fast', () => {
    const r = jointHeat({ drive: 'stepper', payloadKg: 0.2, busy: 0.5, idle: 0.6, ambC: 40 })
    expect(r.run[0].tempC).toBe(40)
    expect(r.run[r.run.length - 1].t).toBe(ARM_JOINT.seconds)
    expect(medianMs(() => jointHeat({ drive: 'servo', payloadKg: 0.25, busy: 0.7, idle: 1, ambC: 40 }))).toBeLessThan(50)
  })
})
