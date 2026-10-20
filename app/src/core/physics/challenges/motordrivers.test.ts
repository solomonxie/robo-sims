import { medianMs } from '../../stopwatch'
import { HBRIDGE } from '../actuators/hbridge'
import { BRIDGE_GOALS, BridgeChip, BridgeGoal, Pins, PWM_PUZZLE, pinBridge, pwmRpm, pwmTarget, truthChallenge } from './motordrivers'

const ALL_PINS: Pins[] = Array.from({ length: 16 }, (_, k) => [3, 2, 1, 0].map((b) => Math.floor(k / 2 ** b) % 2 === 1) as Pins)

describe('Truth table challenge', () => {
  it('datasheet tables: L298N EN low coasts, IN1 = IN2 brakes; TB6612 PWM low brakes; DRV8833 00 coasts', () => {
    expect(pinBridge('l298n', [true, false, true, false]).mode).toBe('forward')
    expect(pinBridge('l298n', [true, false, false, false])).toMatchObject({ mode: 'coast', off: true })
    expect(pinBridge('l298n', [true, true, true, false]).c).toMatchObject({ q1: true, q3: true, q2: false })
    expect(pinBridge('l298n', [false, false, true, false]).mode).toBe('brake')
    expect(pinBridge('tb6612', [false, true, true, true]).mode).toBe('reverse')
    expect(pinBridge('tb6612', [true, false, false, true]).mode).toBe('brake')
    expect(pinBridge('tb6612', [true, false, true, false])).toMatchObject({ mode: 'coast', off: true })
    expect(pinBridge('drv8833', [false, false, true, false]).mode).toBe('coast')
    expect(pinBridge('drv8833', [true, true, true, false]).mode).toBe('brake')
  })
  it('only the 4-FET bridge can shoot through, and that fails first', () => {
    for (const chip of ['l298n', 'tb6612', 'drv8833'] as const) for (const p of ALL_PINS) expect(pinBridge(chip, p).mode).not.toBe('shoot')
    const s = truthChallenge('fets', 'forward', [true, true, false, true])
    expect(s.verdict).toEqual({ pass: false, near: false, fail: 'shoot' })
    expect(s.shootA).toBeGreaterThan(10)
  })
  it('every chip has a pin pattern for every goal', () => {
    for (const chip of ['l298n', 'tb6612', 'drv8833', 'fets'] as BridgeChip[])
      for (const goal of Object.keys(BRIDGE_GOALS) as BridgeGoal[]) expect(ALL_PINS.some((p) => truthChallenge(chip, goal, p).verdict.pass)).toBe(true)
  })
  it('order: switched off, then wrong mode; brake vs coast is a close miss', () => {
    expect(truthChallenge('l298n', 'forward', [true, false, false, false]).verdict).toEqual({ pass: false, near: false, fail: 'off' })
    expect(truthChallenge('l298n', 'brake', [true, true, false, false]).verdict).toEqual({ pass: false, near: true, fail: 'off' })
    expect(truthChallenge('l298n', 'coast', [true, true, false, false]).verdict.pass).toBe(true)
    expect(truthChallenge('tb6612', 'coast', [true, false, false, true]).verdict).toEqual({ pass: false, near: true, fail: 'mode' })
    expect(truthChallenge('drv8833', 'forward', [false, true, true, false]).verdict).toEqual({ pass: false, near: false, fail: 'mode' })
  })
  it('brake stops faster than coast; the L298N drop leaves less speed', () => {
    const b = truthChallenge('drv8833', 'brake', [true, true, true, false])
    expect(b.stopS).toBe(b.brakeS)
    expect(b.brakeS).toBeLessThan(b.coastS / 2)
    expect(truthChallenge('l298n', 'forward', [true, false, true, false]).vs).toBeLessThan(HBRIDGE.vs - 1.4)
    expect(truthChallenge('l298n', 'forward', [true, false, true, false]).freeRadS).toBeLessThan(truthChallenge('tb6612', 'forward', [true, false, true, true]).freeRadS)
  })
})

describe('PWM speed target', () => {
  it('deadband: no motion until duty × volts beats friction and load', () => {
    const r = pwmTarget('tb6612', 'li2', 'tile', 'cruise', 0.05, 25000)
    expect(r.rpm).toBe(0)
    expect(r.verdict.fail).toBe('stall')
    expect(pwmRpm('tb6612', 'li2', 'tile', r.startDuty + 0.01).rpm).toBeGreaterThan(0)
    expect(pwmTarget('tb6612', 'li2', 'carpet', 'cruise', 0.5, 25000).startDuty).toBeGreaterThan(r.startDuty)
  })
  it('L298N eats ~1.5 V: on 4 × NiMH it can’t reach cruise at 100 %; a MOSFET driver can', () => {
    const l = pwmTarget('l298n', 'nimh4', 'tile', 'cruise', 1, 25000)
    expect(l.drop).toBeGreaterThan(1.4)
    expect(l.verdict).toEqual({ pass: false, near: true, fail: 'reach' })
    const t = pwmTarget('tb6612', 'nimh4', 'tile', 'cruise', 0.8, 25000)
    expect(t.needDuty).toBeLessThan(PWM_PUZZLE.maxDuty)
    expect(pwmTarget('tb6612', 'nimh4', 'tile', 'cruise', t.needDuty + 0.01, 25000).verdict.pass).toBe(true)
  })
  it('order: slow / fast (close within 15 %), headroom, whine', () => {
    const need = pwmTarget('drv8833', 'aa4', 'wood', 'cruise', 0.5, 25000).needDuty
    expect(pwmTarget('drv8833', 'aa4', 'wood', 'cruise', need - 0.05, 25000).verdict).toMatchObject({ fail: 'slow', near: true })
    expect(pwmTarget('drv8833', 'aa4', 'wood', 'cruise', 1, 25000).verdict).toMatchObject({ fail: 'fast', near: false })
    expect(pwmTarget('drv8833', 'aa4', 'wood', 'cruise', need + 0.01, 1000).verdict).toEqual({ pass: false, near: true, fail: 'whine' })
    expect(pwmTarget('drv8833', 'aa4', 'wood', 'cruise', need + 0.01, 20000).verdict.fail).toBe('whine')
    const lc = pwmTarget('l298n', 'li2', 'carpet', 'fast', 0.5, 25000)
    expect(lc.needDuty).toBeGreaterThan(PWM_PUZZLE.maxDuty)
    expect(pwmTarget('l298n', 'li2', 'carpet', 'fast', lc.needDuty + 0.01, 25000).verdict.fail).toBe('headroom')
  })
  it('low PWM frequency: the coil can’t smooth the current', () => {
    const lo = pwmTarget('tb6612', 'li2', 'tile', 'cruise', 0.5, 1000)
    const hi = pwmTarget('tb6612', 'li2', 'tile', 'cruise', 0.5, 25000)
    expect(lo.rippleA).toBeGreaterThan(5 * hi.rippleA)
    expect(lo.wave).toHaveLength(60)
    expect(hi.meanA).toBeGreaterThan(0)
    expect(Math.max(...lo.wave)).toBeGreaterThan(2 * lo.meanA)
    expect(hi.bits).toBe(11)
  })
  it('solves fast', () => {
    expect(medianMs(() => { for (let k = 0; k < 20; k++) pwmTarget('l298n', 'aa4', 'wood', 'cruise', 0.5 + k / 100, 25000) })).toBeLessThan(60)
    expect(medianMs(() => { for (let k = 0; k < 4; k++) truthChallenge('fets', 'brake', [false, true, false, true]) })).toBeLessThan(120)
  })
})
