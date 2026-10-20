import { medianMs } from '../../stopwatch'
import { ALLOYS, BARREL_MM3, FILLET_MM3, IDEAL_FEED_MM, IDEAL_MM3, SolderCfg, contactAngle, filletProfile, fluxBurnRate, jointOhms, solderRun } from './soldering'

const GOOD: SolderCfg = { alloy: 'sn63', setC: 330, tip: 'chisel', pad: 'signal', flux: 'core', tinned: true, dwellS: 3, feedMm: 2.4 }
const run = (o: Partial<SolderCfg> = {}) => solderRun({ ...GOOD, ...o })

describe('alloys and flux', () => {
  it('Sn63/Pb37 is eutectic at 183 °C; SAC305 melts over 217–220 °C', () => {
    expect(ALLOYS.sn63.solidusC).toBe(ALLOYS.sn63.liquidusC)
    expect(ALLOYS.sn63.liquidusC).toBe(183)
    expect([ALLOYS.sac305.solidusC, ALLOYS.sac305.liquidusC]).toEqual([217, 220])
  })
  it('flux is idle below 150 °C and burns twice as fast every 20 °C', () => {
    expect(fluxBurnRate(140)).toBe(0)
    expect(fluxBurnRate(300)).toBeCloseTo(1 / 5, 9)
    expect(fluxBurnRate(340) / fluxBurnRate(300)).toBeCloseTo(4, 9)
  })
})

describe('joint geometry', () => {
  it('fillet profile conserves volume and turns convex with a high contact angle', () => {
    for (const [v, a, w] of [[0.4, 20, 1], [0.4, 120, 0], [1.2, 60, 0.6]] as const) {
      const f = filletProfile(v, a, w, 1, 400)
      let vol = 0
      for (let i = 0; i < f.points.length - 1; i++) {
        const [r0, h0] = f.points[i]
        const [r1, h1] = f.points[i + 1]
        vol += 2 * Math.PI * ((r0 + r1) / 2) * ((h0 + h1) / 2) * (r1 - r0)
      }
      expect(vol).toBeCloseTo(v, 2)
    }
    expect(filletProfile(0.4, 20, 1).p).toBeGreaterThan(1)
    expect(filletProfile(0.4, 120, 0).p).toBeLessThan(1)
    expect(filletProfile(0.4, 120, 0).R).toBeLessThan(filletProfile(0.4, 20, 1).R)
  })
  it('ideal joint: full barrel + fillet ≈ 1.2 mm³ ≈ 2.3 mm of 0.8 mm wire', () => {
    expect(BARREL_MM3).toBeCloseTo(0.804, 3)
    expect(IDEAL_MM3).toBeCloseTo(BARREL_MM3 + FILLET_MM3, 12)
    expect(IDEAL_FEED_MM).toBeGreaterThan(2)
    expect(IDEAL_FEED_MM).toBeLessThan(2.6)
  })
  it('contact angle 20° wetted, 120° not', () => {
    expect(contactAngle(1)).toBe(20)
    expect(contactAngle(0)).toBe(120)
  })
  it('joint resistance: ρL/A ≈ 0.4 mΩ when wetted, ×100 on a cold joint, open with no solder', () => {
    expect(jointOhms('sac305', 1, 1)).toBeCloseTo((0.13e-6 * 1.6e-3) / ((Math.PI / 4) * 0.64e-6), 9)
    expect(jointOhms('sn63', 1, 0) / jointOhms('sn63', 1, 1)).toBeCloseTo(100, 6)
    expect(jointOhms('sn63', 0, 1)).toBe(Infinity)
  })
})

describe('solderRun', () => {
  it('a tinned chisel at 330 °C, core flux, 3 s and 2.4 mm makes a good leaded joint', () => {
    const r = run()
    expect(r.verdict.pass).toBe(true)
    expect(r.out.wet).toBe(1)
    expect(r.out.barrelFill).toBeGreaterThan(0.75)
    expect(r.out.peakC).toBeGreaterThan(ALLOYS.sn63.liquidusC + 30)
    expect(r.out.minTipC).toBeLessThan(330)
    expect(r.frames[0].t).toBe(0)
    expect(r.frames.at(-1)!.on).toBe(false)
  })
  it('oxidised tip, no flux, too small a tip on a ground plane: each named', () => {
    expect(run({ tinned: false }).verdict.fail).toBe('tip')
    expect(run({ flux: 'none' }).verdict.fail).toBe('flux')
    expect(run({ tip: 'conical', pad: 'plane' }).verdict.fail).toBe('cold')
    expect(run({ tip: 'wide', pad: 'plane' }).verdict.pass).toBe(true)
  })
  it('the iron lifted before the pad melts: cold joint, solder balled on the lead', () => {
    const r = run({ dwellS: 1 })
    expect(r.verdict.fail).toBe('cold')
    expect(r.out.angleDeg).toBeGreaterThan(90)
    expect(r.out.ohms).toBeGreaterThan(0.01)
  })
  it('lead-free needs more heat: 300 °C for 2 s does Sn63 but not SAC305', () => {
    expect(run({ dwellS: 2, setC: 300 }).verdict.pass).toBe(true)
    expect(run({ dwellS: 2, setC: 300, alloy: 'sac305' }).verdict.pass).toBe(false)
    expect(run({ alloy: 'sac305', setC: 350 }).verdict.pass).toBe(true)
  })
  it('too hot or too long lifts the pad and chars the flux', () => {
    const hot = run({ setC: 430, dwellS: 6 })
    expect(hot.verdict.fail).toBe('lifted')
    expect(hot.out.charS).toBeGreaterThan(1.5)
    expect(run({ setC: 350, dwellS: 8 }).verdict.pass).toBe(false)
  })
  it('too little / too much solder', () => {
    expect(run({ feedMm: 1 }).verdict.fail).toBe('little')
    expect(run({ feedMm: 6 }).verdict.fail).toBe('blob')
  })
  it('a ground-plane pad with a 1.6 mm chisel reaches less, flux pen helps the bridge', () => {
    expect(run({ pad: 'plane' }).out.peakC).toBeLessThan(run().out.peakC - 50)
    expect(run({ flux: 'pen' }).out.peakC).toBeGreaterThanOrEqual(run().out.peakC)
  })
  it('runs fast', () => {
    expect(medianMs(() => run({ dwellS: 8 }))).toBeLessThan(50)
  })
})
