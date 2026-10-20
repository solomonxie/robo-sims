import { medianMs } from '../../stopwatch'
import {
  GL5528,
  LAMP_MID,
  LampCfg,
  lampAt,
  lampDirectLux,
  lampEye,
  lampFollowRun,
  lampFollowStats,
  lampLux,
  lampNull,
  lampRead,
  lampShade,
  ldrOhms,
} from './lamptracker'

const cfg = (c: Partial<LampCfg>): LampCfg => ({ mount: 'wall', pair: 'matched', wiring: 'half', room: 'dark', ...c })

describe('LDR pair', () => {
  it('GL5528: R10 at 10 lux, slope γ on log–log, capped by the dark resistance', () => {
    expect(ldrOhms(10)).toBeCloseTo((GL5528.r10 * GL5528.darkOhms) / (GL5528.r10 + GL5528.darkOhms), 6)
    expect(ldrOhms(1000) / ldrOhms(100)).toBeCloseTo(10 ** -GL5528.gamma, 2)
    expect(ldrOhms(1e-6)).toBeLessThan(GL5528.darkOhms)
  })
  it('the wall shades the far LDR from 0 to fully over atan(5 / 20) ≈ 14°', () => {
    expect(lampShade(0, 20)).toBe(0)
    expect(lampShade(-10, 20)).toBe(0)
    expect(lampShade(14.1, 20)).toBeCloseTo(1, 2)
    expect(lampShade(7, 20)).toBeGreaterThan(0.4)
    expect(lampShade(30, 0)).toBe(0)
    const [l, r] = lampLux(30, 'wall', 5)
    expect(l).toBeCloseTo(5 + lampDirectLux() * Math.cos(Math.PI / 6), 6)
    expect(r).toBe(5)
  })
  it('side by side and matched: no direction signal at all; mismatched: a constant push', () => {
    for (const phi of [-40, 0, 25]) expect(lampEye(phi, cfg({ mount: 'flat' })).err).toBe(0)
    expect(lampNull(cfg({ mount: 'flat' })).deg).toBeNull()
    const bag = lampNull(cfg({ mount: 'flat', pair: 'bag' }))
    expect(bag.deg).toBeNull()
    expect(bag.offset).toBeGreaterThan(100)
  })
  it('the wall gives the steepest error; toe-out a weak one; both rest on the lamp when matched', () => {
    const wall = lampNull(cfg({}))
    const toed = lampNull(cfg({ mount: 'toed' }))
    expect(Math.abs(wall.deg!)).toBeLessThan(0.5)
    expect(Math.abs(toed.deg!)).toBeLessThan(0.5)
    expect(wall.slope).toBeGreaterThan(3 * toed.slope)
    expect(wall.capture[0]).toBeLessThan(-80)
    expect(wall.capture[1]).toBeGreaterThan(80)
    expect(lampEye(20, cfg({})).err).toBeGreaterThan(0)
    expect(lampEye(-20, cfg({})).err).toBeLessThan(0)
  })
  it('a mismatched pair rests off the lamp, worse with toe-out than with the wall', () => {
    const wall = lampNull(cfg({ pair: 'bag' })).deg!
    const toed = lampNull(cfg({ mount: 'toed', pair: 'bag' })).deg!
    expect(wall).toBeLessThan(-2)
    expect(toed).toBeLessThan(wall - 10)
  })
  it('room light washes out the signal; 10 kΩ dividers bow into the ADC top, the half bridge keeps more of it', () => {
    const slope = (wiring: 'two' | 'half', room: 'dark' | 'day') => lampNull(cfg({ wiring, room })).slope
    expect(slope('half', 'day')).toBeLessThan(slope('half', 'dark'))
    expect(slope('two', 'day')).toBeLessThan(slope('two', 'dark'))
    expect(slope('half', 'day')).toBeGreaterThan(5 * slope('two', 'day'))
    const r = lampRead([800, 800], 'matched', 'two')
    expect(r.raws[0]).toBeGreaterThan(3500)
    expect(lampRead([300, 300], 'matched', 'half').err).toBe(0)
    expect(lampRead([300, 300], 'matched', 'half').raws[0]).toBe(LAMP_MID)
  })
})

describe('servo follow', () => {
  it('the lamp swings from −30° to +40° and stays', () => {
    expect(lampAt('swing', 0)).toBe(-30)
    expect(lampAt('swing', 1.05)).toBeCloseTo(5, 9)
    expect(lampAt('swing', 5)).toBe(40)
    expect(Math.abs(lampAt('wave', 0.4))).toBeCloseTo(45, 6)
  })
  it('a moderate gain settles on the lamp; double it and the head hunts in the dark, not with the room lights on', () => {
    const ok = lampFollowStats(lampFollowRun({ motion: 'swing', gain: 1, room: 'dark', wiring: 'half' }))
    expect(ok.rms).toBeLessThan(1)
    expect(ok.tailSwing).toBeLessThanOrEqual(2)
    const hunt = lampFollowStats(lampFollowRun({ motion: 'swing', gain: 2, room: 'dark', wiring: 'half' }))
    expect(hunt.tailSwing).toBeGreaterThan(20)
    const office = lampFollowStats(lampFollowRun({ motion: 'swing', gain: 2, room: 'office', wiring: 'half' }))
    expect(office.tailSwing).toBeLessThanOrEqual(2)
  })
  it('the gain tuned in the dark is sluggish by day; 10 kΩ dividers by day crawl inside the dead band', () => {
    const day = lampFollowStats(lampFollowRun({ motion: 'swing', gain: 0.5, room: 'day', wiring: 'half' }))
    const dark = lampFollowStats(lampFollowRun({ motion: 'swing', gain: 0.5, room: 'dark', wiring: 'half' }))
    expect(day.worst).toBeGreaterThan(5 * dark.worst)
    const two = lampFollowStats(lampFollowRun({ motion: 'swing', gain: 1, room: 'day', wiring: 'two' }))
    const half = lampFollowStats(lampFollowRun({ motion: 'swing', gain: 1, room: 'day', wiring: 'half' }))
    expect(two.rms).toBeGreaterThan(10 * half.rms)
  })
  it('a fast torch needs more gain to keep up', () => {
    const lo = lampFollowStats(lampFollowRun({ motion: 'wave', gain: 0.5, room: 'dark', wiring: 'half' }))
    const hi = lampFollowStats(lampFollowRun({ motion: 'wave', gain: 2, room: 'dark', wiring: 'half' }))
    expect(hi.rms).toBeLessThan(lo.rms / 2)
  })
  it('ten seconds is fast to recompute', () => {
    expect(medianMs(() => lampFollowRun({ motion: 'sweep', gain: 1, room: 'office', wiring: 'two' }), 3)).toBeLessThan(500)
  })
})
