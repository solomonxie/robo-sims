import {
  MU_0,
  TT_MOTOR,
  motorAmps,
  motorRpm,
  DRIVER_LIMIT_A,
  GEARBOXES,
  TT_THERMAL,
  armatureAmps,
  backEmf,
  coilShares,
  freeSpeed,
  gearEfficiency,
  gearRatio,
  loadedSpeed,
  motorPoint,
  motorTau,
  peakEfficiency,
  peakPower,
  shaftTorque,
  spinUp,
  stallAmps,
  stallRun,
  stallTorque,
  wheelDrive,
  SRD_05,
  SSR_25DA,
  coilAmps,
  coilDecayTime,
  coilRiseTime,
  contactHeat,
  dropOutAmps,
  flybackStep,
  nextZeroCross,
  operateTime,
  pullInAmps,
  relayLatch,
  relayPull,
  releaseTime,
  ssrHeat,
  ssrInputAmps,
  ssrTriggered,
  zeroCrossConducts,
  attenuationDb,
  perceivedLevel,
  potDivider,
  taperFraction,
  SWITCHES,
  bounceEdges,
  bouncedState,
  debounceStep,
  latchToggle,
  rcDebounceStep,
  schmittHigh,
} from '.'

describe('DC motor', () => {
  it('stalls below I0·R, then holds the no-load current and spins ∝ back-EMF', () => {
    expect(motorAmps(0.5)).toBeCloseTo(0.1, 9)
    expect(motorRpm(0.5)).toBe(0)
    expect(motorAmps(5)).toBe(TT_MOTOR.noLoadA)
    expect(motorRpm(5)).toBeCloseTo(162, 0)
    expect(motorRpm(6)).toBeCloseTo(200, 0)
  })

  it('splits the supply into I·R + back-EMF, current falling as it speeds up', () => {
    const w = freeSpeed(5)
    expect(backEmf(w) + armatureAmps(5, w) * TT_MOTOR.ohms).toBeCloseTo(5, 9)
    expect(armatureAmps(5, w)).toBeCloseTo(TT_MOTOR.noLoadA, 9)
    expect(armatureAmps(5, 0)).toBe(stallAmps(5))
    expect(freeSpeed(5) * 60 / (2 * Math.PI) / 48).toBeCloseTo(motorRpm(5), 6)
    expect(spinUp(5, 0)).toBe(0)
    expect(spinUp(5, 5 * motorTau())).toBeCloseTo(w * (1 - Math.exp(-5)), 6)
    expect(spinUp(5, 1, stallTorque(5) * 2)).toBe(0)
  })

  it('has a straight torque–speed line with power peaking at half speed', () => {
    const ts = stallTorque(6)
    expect(shaftTorque(6, freeSpeed(6))).toBeCloseTo(0, 12)
    expect(shaftTorque(6, freeSpeed(6) / 2)).toBeCloseTo(ts / 2, 12)
    expect(ts * 48 * 0.73 * 100 / 9.81).toBeGreaterThan(1)
    const pp = peakPower(6)
    expect(motorPoint(6, pp.radS * 0.9).powerOut).toBeLessThan(pp.powerOut)
    const pe = peakEfficiency(6)
    expect(pe.radS).toBeGreaterThan(pp.radS)
    expect(motorPoint(6, pe.radS * 0.97).eff).toBeLessThan(pe.eff)
    expect(motorPoint(6, Math.min(freeSpeed(6), pe.radS * 1.03)).eff).toBeLessThan(pe.eff)
    expect(loadedSpeed(6, ts / 2)).toBeCloseTo(freeSpeed(6) / 2, 6)
    expect(loadedSpeed(6, ts)).toBeCloseTo(0, 6)
    expect(loadedSpeed(6, 0, TT_MOTOR, 1e-6)).toBeLessThan(freeSpeed(6))
  })

  it('commutates a 3-slot rotor: coil shares always sum to 0', () => {
    for (const th of [0, 0.3, Math.PI / 6, 1, 2.5, 4]) expect(coilShares(th).reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9)
    expect(coilShares(Math.PI / 2)).toEqual([2 / 3, -1 / 3, -1 / 3])
    expect(coilShares(0)).toEqual([-1 / 3, 2 / 3, -1 / 3])
    expect(coilShares(-Math.PI / 2)).toEqual([-2 / 3, 1 / 3, 1 / 3])
  })

  it('heats a stalled winding until R rises; a PTC or current limit saves it', () => {
    const hot = stallRun(6, 'none')
    expect(hot[0].amps).toBeCloseTo(1.2, 9)
    expect(hot.at(-1)!.tempC).toBeGreaterThan(TT_THERMAL.maxC)
    expect(hot.at(-1)!.amps).toBeLessThan(1.2)
    expect(stallRun(3, 'none').at(-1)!.tempC).toBeLessThan(TT_THERMAL.maxC)
    const ptc = stallRun(6, 'ptc')
    const trip = ptc.find((f) => f.tripped)!
    expect(trip.t).toBeGreaterThan(0.5)
    expect(trip.t).toBeLessThan(3)
    expect(ptc.at(-1)!.tempC).toBeLessThan(40)
    expect(stallRun(3, 'ptc').some((f) => f.tripped)).toBe(false)
    expect(Math.max(...stallRun(6, 'limit').map((f) => f.amps))).toBe(DRIVER_LIMIT_A)
  })

  it('trades speed for torque in the gearbox', () => {
    expect(gearRatio(GEARBOXES.tt48)).toBe(48)
    expect(gearRatio(GEARBOXES.direct)).toBe(1)
    expect(gearEfficiency(GEARBOXES.tt48)).toBeCloseTo(0.729, 9)
    const flat = wheelDrive(5, GEARBOXES.tt48, 0)
    expect(flat.speed).toBeGreaterThan(0.4)
    expect(flat.speed).toBeLessThan(0.6)
    const slow = wheelDrive(5, GEARBOXES.tt120, 0)
    expect(slow.speed).toBeLessThan(flat.speed)
    expect(slow.maxN).toBeGreaterThan(flat.maxN)
    const direct = wheelDrive(5, GEARBOXES.direct, 0.26)
    expect(direct.speed).toBe(0)
    expect(direct.amps).toBe(stallAmps(5))
    const hill = wheelDrive(5, GEARBOXES.tt48, 0.26)
    expect(hill.speed).toBeLessThan(flat.speed)
    expect(hill.amps).toBeGreaterThan(flat.amps)
  })
})

describe('relays', () => {
  const r = SRD_05
  it('pull in under the datasheet’s 75 % of coil volts and drop out above its 10 %', () => {
    const pullV = pullInAmps(r) * r.ohms
    const dropV = dropOutAmps(r) * r.ohms
    expect(pullV).toBeCloseTo(3.44, 2)
    expect(pullV).toBeLessThan(0.75 * r.coilV)
    expect(dropV).toBeCloseTo(0.535, 2)
    expect(dropV).toBeGreaterThan(0.1 * r.coilV)
    expect(coilAmps(5, r)).toBeCloseTo(0.0714, 4)
  })

  it('pull grows with I² and 1/g², balancing the spring at pull-in and drop-out, capped by the iron', () => {
    expect(relayPull(pullInAmps(r), r.openGapM, r)).toBeCloseTo(r.springN, 9)
    expect(relayPull(dropOutAmps(r), r.closedGapM, r)).toBeCloseTo(r.springN, 9)
    expect(relayPull(0.02, r.openGapM, r) / relayPull(0.01, r.openGapM, r)).toBeCloseTo(4, 9)
    expect(relayPull(0.01, r.closedGapM, r) / relayPull(0.01, r.openGapM, r)).toBeCloseTo((0.45 / 0.07) ** 2, 6)
    expect(relayPull(1, r.closedGapM, r)).toBeCloseTo((1.6 ** 2 * r.poleM2) / (2 * MU_0), 9)
  })

  it('latch with hysteresis: closes at pull-in, holds down to drop-out', () => {
    expect(relayLatch(false, 0.045, r)).toBe(false)
    expect(relayLatch(false, 0.05, r)).toBe(true)
    expect(relayLatch(true, 0.01, r)).toBe(true)
    expect(relayLatch(true, 0.007, r)).toBe(false)
  })

  it('operate and release times: coil τ to pull-in / drop-out, plus the armature’s flight', () => {
    const tau = r.henries / r.ohms
    expect(coilRiseTime(0.5, 1, 70, 0.1)).toBeCloseTo(tau * Math.LN2, 12)
    expect(coilRiseTime(1, 1, 70, 0.1)).toBe(Infinity)
    expect(operateTime(5, r)).toBeCloseTo(3.67e-3, 5)
    expect(operateTime(3, r)).toBe(Infinity)
    expect(coilDecayTime(1, Math.exp(-1), 70, 0.1, 0)).toBeCloseTo(tau, 12)
    const diode = releaseTime(0.7, r)
    const avalanche = releaseTime(35, r)
    expect(diode).toBeCloseTo(4.2e-3, 4)
    expect(avalanche).toBeLessThan(diode)
    expect(avalanche - r.travelS).toBeLessThan((diode - r.travelS) / 10)
  })

  it('flybackStep agrees: a clamp at breakdown holds the node there while the current falls as coilDecayTime says', () => {
    const coil = { vs: 5, ohms: r.ohms, henries: r.henries, farads: 10e-9, breakdownV: 40, closed: false }
    let s = { amps: coilAmps(5, r), volts: 0 }
    let t = 0
    let peak = 0
    while (s.amps > dropOutAmps(r)) {
      s = flybackStep(s, coil, 1e-8)
      t += 1e-8
      peak = Math.max(peak, s.volts)
    }
    expect(peak).toBe(40)
    expect(t).toBeCloseTo(coilDecayTime(coilAmps(5, r), dropOutAmps(r), r.ohms, r.henries, 35), 5)
    expect(flybackStep({ amps: 0, volts: 0 }, { ...coil, closed: true, onVolts: 0.5 }, 1).amps).toBeCloseTo(4.5 / 70, 9)
    let low = 0
    for (let k = 0; k < 2e5; k++) low = Math.min(low, (s = flybackStep(s, { ...coil, floorV: -0.7 }, 1e-8)).volts)
    expect(low).toBe(-0.7)
    const ringAfter = (lossOhms: number) => {
      let q = { amps: coilAmps(5, r), volts: 5 }
      let swing = 0
      for (let k = 0; k < 6e5; k++) {
        q = flybackStep(q, { ...coil, lossOhms }, 1e-8)
        if (k > 3e5) swing = Math.max(swing, Math.abs(q.volts - 5))
      }
      return swing
    }
    expect(ringAfter(3000)).toBeLessThan(ringAfter(Infinity) / 10)
  })

  it('contacts and a triac SSR heat up differently', () => {
    expect(contactHeat(10, r)).toBeCloseTo(3, 9)
    expect(ssrHeat(10, SSR_25DA)).toBeCloseTo(14.4, 1)
  })

  it('SSR input is an LED: a 3.3 V pin drives it directly', () => {
    expect(ssrInputAmps(3.3, SSR_25DA)).toBeGreaterThan(6e-3)
    expect(ssrInputAmps(3.3, SSR_25DA)).toBeLessThan(8e-3)
    expect(ssrTriggered(3.3, SSR_25DA)).toBe(true)
    expect(ssrTriggered(2, SSR_25DA)).toBe(false)
    expect(ssrInputAmps(0, SSR_25DA)).toBe(0)
  })

  it('zero-cross SSR waits for the mains to pass 0 V, both ways', () => {
    expect(nextZeroCross(0, 50)).toBeCloseTo(0, 12)
    expect(nextZeroCross(4.2e-3, 50)).toBeCloseTo(10e-3, 12)
    expect(nextZeroCross(10e-3, 50)).toBeCloseTo(10e-3, 12)
    expect(zeroCrossConducts(8e-3, 4.2e-3, 54.2e-3, 50)).toBe(false)
    expect(zeroCrossConducts(11e-3, 4.2e-3, 54.2e-3, 50)).toBe(true)
    expect(zeroCrossConducts(58e-3, 4.2e-3, 54.2e-3, 50)).toBe(true)
    expect(zeroCrossConducts(60.5e-3, 4.2e-3, 54.2e-3, 50)).toBe(false)
  })
})

describe('switch bounce and debouncing', () => {
  const sw = SWITCHES.toggle
  const edges = bounceEdges(sw.makeS, sw.bounces)
  const pressed = (t: number) => bouncedState(t, edges, false)

  it('bounce edges start at 0, end at the bounce time and leave the contact made', () => {
    expect(edges).toHaveLength(2 * sw.bounces + 1)
    expect(edges[0]).toBe(0)
    expect(edges[edges.length - 1]).toBeCloseTo(sw.makeS, 12)
    expect(edges.every((e, i) => i === 0 || e > edges[i - 1])).toBe(true)
    expect(pressed(-1e-6)).toBe(false)
    expect(pressed(sw.makeS + 1e-6)).toBe(true)
    expect(bouncedState(1, edges, true)).toBe(false)
  })

  const run = (filter: (closed: boolean, dt: number) => boolean) => {
    const dt = 1e-6
    let out = filter(false, dt)
    let changes = 0
    let first = NaN
    for (let t = 0; t < 30e-3; t += dt) {
      const next = filter(pressed(t - 2e-3), dt)
      if (next !== out) {
        changes++
        if (Number.isNaN(first)) first = t - 2e-3
      }
      out = next
    }
    return { changes, first }
  }

  it('a raw pin sees every bounce; RC + Schmitt and a software timer see one press', () => {
    expect(run((c) => c).changes).toBe(2 * sw.bounces + 1)
    let vc = 3.3
    let high = true
    const rc = run((c, dt) => {
      vc = rcDebounceStep(vc, c, 3.3, 10e3, 1e3, 0.5e-6, dt)
      high = schmittHigh(high, vc, 3.3)
      return !high
    })
    expect(rc.changes).toBe(1)
    expect(rc.first).toBeLessThan(sw.makeS)
    let s = { stable: false, last: false, sinceS: 1 }
    const sw10 = run((c, dt) => (s = debounceStep(s, c, dt, 10e-3)).stable)
    expect(sw10.changes).toBe(1)
    expect(sw10.first).toBeCloseTo(sw.makeS + 10e-3, 4)
  })

  it('too short a filter lets bounces through', () => {
    let s = { stable: false, last: false, sinceS: 1 }
    expect(run((c, dt) => (s = debounceStep(s, c, dt, 20e-6)).stable).changes).toBeGreaterThan(1)
  })

  it('schmitt holds between its thresholds; a code toggle flips once per press', () => {
    expect(schmittHigh(true, 1.4, 3.3)).toBe(true)
    expect(schmittHigh(false, 1.4, 3.3)).toBe(false)
    expect(schmittHigh(false, 2, 3.3)).toBe(true)
    expect(latchToggle(false, false, true)).toBe(true)
    expect(latchToggle(true, true, true)).toBe(true)
    expect(latchToggle(true, true, false)).toBe(true)
  })
})

describe('potentiometer', () => {
  it('splits the track at the wiper', () => {
    const p = potDivider(3.3, 10e3, 0.5)
    expect(p.vout).toBeCloseTo(1.65)
    expect(p.lower + p.upper).toBeCloseTo(10e3)
    expect(p.amps).toBeCloseTo(0.33e-3)
    expect(potDivider(3.3, 10e3, 1.2).vout).toBeCloseTo(3.3)
  })
  it('log taper is 10 % at half turn and meets linear at the ends', () => {
    expect(taperFraction(0.5, 'log')).toBeCloseTo(0.1)
    expect(taperFraction(0, 'log')).toBe(0)
    expect(taperFraction(1, 'log')).toBeCloseTo(1)
    expect(taperFraction(0.3, 'linear')).toBeCloseTo(0.3)
  })
  it('maps output to perceived level in dB', () => {
    expect(attenuationDb(0.1)).toBeCloseTo(-20)
    expect(perceivedLevel(0.1)).toBeCloseTo(0.5)
    expect(perceivedLevel(0.5)).toBeCloseTo(0.849, 2)
    expect(perceivedLevel(0)).toBe(0)
    expect(perceivedLevel(taperFraction(0.75, 'log'))).toBeCloseTo(0.756, 2)
  })
})
