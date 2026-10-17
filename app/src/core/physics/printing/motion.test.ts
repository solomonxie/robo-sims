import { medianMs } from '../../stopwatch'
import {
  MACHINE,
  driveView,
  endstopTrials,
  homingAt,
  homingPlan,
  microstepError,
  repeatMm,
  residualVibration,
  ringRun,
  shaperImpulses,
  shaperView,
  softClip,
  stepsView,
} from './motion'

describe('axes and endstops', () => {
  it('homes X, Y then Z, each seek, back off, bump; sensorless skips the bump on X and Y', () => {
    const p = homingPlan('micro', 5)
    expect(p.segs.map((s) => `${s.axis} ${s.step}`)).toEqual(['x seek', 'x back off', 'x bump', 'y seek', 'y back off', 'y bump', 'z seek', 'z back off', 'z bump'])
    expect(homingPlan('sensorless', 5).segs.length).toBe(7)
    const end = homingAt(p, p.total + 1)
    expect(end.done).toBe(true)
    expect(end.pos).toEqual({ x: 0, y: 0, z: 0 })
    expect(homingAt(p, 0.5).seg?.axis).toBe('x')
  })
  it('a slower bump repeats better; optical beats a microswitch; sensorless is the loosest', () => {
    expect(repeatMm('micro', 2)).toBeLessThan(repeatMm('micro', 20))
    expect(repeatMm('optical', 5)).toBeLessThan(repeatMm('micro', 5))
    expect(repeatMm('sensorless', 2)).toBeGreaterThan(repeatMm('micro', 20))
    const t = endstopTrials('micro', 5, 200)
    expect(Math.max(...t) - Math.min(...t)).toBeLessThan(repeatMm('micro', 5) * 1.5)
    expect(endstopTrials('micro', 5, 5)).toEqual(endstopTrials('micro', 5, 5))
  })
  it('soft limits clip moves to the machine box', () => {
    expect(softClip('x', 250)).toBe(MACHINE.x)
    expect(softClip('z', -3)).toBe(0)
  })
})

describe('belts vs lead screws', () => {
  it('the belt moves 40 mm a turn and is fast; the screws push harder, resolve finer and hold Z unpowered', () => {
    const v = driveView(20, 1.5)
    const [belt, l8, l2] = v.drives
    expect(belt.mmRev).toBe(40)
    expect(l8.mmRev).toBe(8)
    expect(l2.forceN).toBeGreaterThan(l8.forceN)
    expect(l8.forceN).toBeGreaterThan(belt.forceN)
    expect(belt.topMmS).toBeGreaterThan(l8.topMmS)
    expect(l8.topMmS).toBeGreaterThan(l2.topMmS)
    expect(belt.umStep).toBeCloseTo(12.5, 6)
    expect(belt.holds).toBe(false)
    expect(l8.holds).toBe(true)
    expect(l2.holds).toBe(true)
    expect(belt.backlashMm).toBe(0)
    expect(belt.stretchMm).toBeGreaterThan(0)
  })
  it('recomputes fast', () => {
    expect(medianMs(() => driveView(120, 2))).toBeLessThan(60)
  })
})

describe('steps per mm', () => {
  it('(200 × microsteps) / mm per turn: 80 for a 20T belt at 16, 400 for a T8 lead 8', () => {
    expect(stepsView('gt2_20', 16, 0).trueSpm).toBe(80)
    expect(stepsView('t8l8', 16, 0).trueSpm).toBe(400)
    expect(stepsView('gt2_16', 16, 0).trueSpm).toBe(100)
  })
  it('a wrong setting moves the wrong distance; measuring 100 mm restores it', () => {
    const v = stepsView('gt2_20', 16, 2)
    expect(v.actualMm).toBeCloseTo(102, 1)
    expect(v.fixedSpm).toBeCloseTo(80, 6)
  })
  it('microsteps refine resolution but the detent ripple caps accuracy', () => {
    const v = stepsView('gt2_20', 256, 0)
    expect(v.microMm).toBeLessThan(0.001)
    expect(v.accMm).toBeGreaterThan(3 * v.microMm)
    const e1 = microstepError(40, 1).map((s) => Math.abs(s.err))
    const e256 = microstepError(40, 256).map((s) => Math.abs(s.err))
    expect(Math.max(...e1)).toBeGreaterThan(0.09)
    expect(Math.max(...e256)).toBeLessThan(v.accMm + v.microMm / 2 + 1e-9)
  })
})

describe('input shaping', () => {
  it('impulses sum to 1; a tuned shaper cancels the ringing at its frequency', () => {
    for (const k of ['zv', 'mzv', 'ei'] as const) {
      const imp = shaperImpulses(k, 45)
      expect(imp.a.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9)
      expect(residualVibration(imp, 45, 0.1)).toBeLessThan(0.06)
    }
    expect(residualVibration(shaperImpulses('none', 45), 45)).toBeCloseTo(1, 9)
  })
  it('MZV and EI tolerate mistuning better than ZV but delay the move more', () => {
    const at = (k: 'zv' | 'mzv' | 'ei') => residualVibration(shaperImpulses(k, 45), 55)
    expect(at('ei')).toBeLessThan(at('zv'))
    expect(at('mzv')).toBeLessThan(at('zv'))
    expect(shaperImpulses('ei', 45).t[2]).toBeGreaterThan(shaperImpulses('zv', 45).t[1])
  })
  it('a braking toolhead rings ~a/ω² and a shaper tuned to the frame cuts it', () => {
    const v = shaperView('none', 45, 150, 5000)
    expect(v.rawMm).toBeGreaterThan(0.01)
    expect(v.rawMm).toBeLessThan(0.15)
    expect(shaperView('mzv', 45, 150, 5000).ringMm).toBeLessThan(0.2 * v.rawMm)
    expect(ringRun(shaperImpulses('none', 45), 150, 5000).out[0].e).toBe(0)
  })
  it('recomputes fast', () => {
    expect(medianMs(() => shaperView('ei', 50, 200, 5000))).toBeLessThan(60)
  })
})
