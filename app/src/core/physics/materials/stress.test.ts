import { medianMs } from '../../stopwatch'
import { G } from '../common'
import { MATERIALS, MaterialKey, SECTIONS, SectionKey, bracketLoad, cantileverDeflection, hookeView, impactFactor, permanentSet, pullPath, rectI, regimeOf, sectionProps, sfVerdict, strengthOf, stressAt, thicknessFor, yieldStrain } from './stress'

const keys = Object.keys(MATERIALS) as MaterialKey[]

describe('stress–strain curves', () => {
  it('start with slope E (Hooke) and are continuous', () => {
    for (const k of keys) {
      const m = MATERIALS[k]
      const e = 1e-6
      expect(stressAt(m, e) / e).toBeCloseTo(m.E, -6)
      for (let i = 1; i < 400; i++) {
        const a = (m.failStrain * i) / 400
        expect(Math.abs(stressAt(m, a + 1e-7) - stressAt(m, a))).toBeLessThan(0.002 * m.utsPa)
      }
      expect(stressAt(m, m.failStrain * 1.01)).toBe(0)
    }
  })
  it('ductile metals yield, harden to UTS, then neck', () => {
    const al = MATERIALS.al6061
    expect(stressAt(al, yieldStrain(al))).toBeCloseTo(al.yieldPa, 0)
    expect(stressAt(al, 0.6 * al.failStrain)).toBeCloseTo(al.utsPa, 0)
    expect(stressAt(al, al.failStrain)).toBeLessThan(al.utsPa)
    expect(regimeOf(al, 0.002)).toBe('elastic')
    expect(regimeOf(al, 0.03)).toBe('plastic')
    expect(regimeOf(al, 0.1)).toBe('necking')
    expect(regimeOf(al, 0.2)).toBe('broken')
  })
  it('past yield leaves a permanent set ε − σ/E; elastic and brittle leave none', () => {
    const al = MATERIALS.al6061
    expect(permanentSet(al, 0.003)).toBe(0)
    expect(permanentSet(al, 0.02)).toBeCloseTo(0.02 - stressAt(al, 0.02) / al.E, 12)
    expect(permanentSet(MATERIALS.acrylic, 0.04)).toBe(0)
    const p = pullPath(al, 0.02)
    expect(p.unload[1][0]).toBeCloseTo(p.set, 12)
    expect((p.unload[0][1] - p.unload[1][1]) / (p.unload[0][0] - p.unload[1][0])).toBeCloseTo(al.E, -3)
    expect(pullPath(MATERIALS.pla, 0.05).broke).toBe(true)
  })
  it('brittle plastics break near their table strength at a few % strain', () => {
    expect(strengthOf(MATERIALS.pla) / 1e6).toBeGreaterThan(48)
    expect(strengthOf(MATERIALS.acrylic) / 1e6).toBeGreaterThan(65)
    expect(strengthOf(MATERIALS.steel)).toBe(MATERIALS.steel.yieldPa)
  })
})

describe('cantilever links', () => {
  it('section properties match textbook formulas', () => {
    expect(sectionProps(SECTIONS.solid.rects).I).toBeCloseTo(rectI(0.01, 0.01), 18)
    const tube = sectionProps(SECTIONS.tube.rects)
    expect(tube.I).toBeCloseTo((0.02 ** 4 - (0.02 - 2 * 0.00135) ** 4) / 12, 15)
    expect(tube.c).toBeCloseTo(0.01, 12)
    for (const k of Object.keys(SECTIONS) as SectionKey[]) expect(sectionProps(SECTIONS[k].rects).area * 1e6).toBeGreaterThan(95)
  })
  it('same area, very different stiffness: tube and I-beam beat a solid bar, a flat strip is floppy', () => {
    const v = hookeView('al6061', 'solid', 20, 0.2)
    const [strip, solid, tube, ibeam] = v.tips
    expect(solid / tube).toBeGreaterThan(6)
    expect(solid / ibeam).toBeGreaterThan(7)
    expect(strip / solid).toBeCloseTo(833.33 / 133.33, 1)
    expect(v.delta).toBeCloseTo((20 * 0.2 ** 3) / (3 * 69e9 * rectI(0.01, 0.01)), 12)
    expect(v.k * v.delta).toBeCloseTo(20, 9)
    expect(v.eps).toBeCloseTo(v.sigma / 69e9, 15)
    expect(cantileverDeflection(20, 0.2, 69e9, 1e-9, 0.1) / cantileverDeflection(20, 0.2, 69e9, 1e-9)).toBeCloseTo(5 / 16, 12)
  })
  it('a PLA strip under 20 N is past its strength; the tube is fine', () => {
    expect(hookeView('pla', 'strip', 20, 0.2).elastic).toBe(false)
    expect(hookeView('pla', 'tube', 20, 0.2).elastic).toBe(true)
  })
})

describe('safety factor', () => {
  it('static SF = strength / (6FL / bt²)', () => {
    const r = bracketLoad('al6061', 0.003, 1, 'hold')
    expect(r.sigma).toBeCloseTo((6 * G * 0.15) / (0.02 * 0.003 ** 2), 3)
    expect(r.sf).toBeCloseTo(276e6 / r.sigma, 9)
    expect(bracketLoad('al6061', 0.003, 1, 'swing').factor).toBeCloseTo(1 + 15 / G, 12)
  })
  it('a drop multiplies the load, more so on a stiff link', () => {
    expect(impactFactor(0, 0.001)).toBeCloseTo(2, 12)
    const thin = bracketLoad('al6061', 0.002, 1, 'bump').factor
    const thick = bracketLoad('al6061', 0.006, 1, 'bump').factor
    expect(thick).toBeGreaterThan(thin)
    expect(thin).toBeGreaterThan(2)
  })
  it('thicknessFor hits the target SF', () => {
    for (const lc of ['hold', 'swing', 'bump'] as const) {
      const t = thicknessFor('pla', 1, lc, 2.5)
      expect(bracketLoad('pla', t, 1, lc).sf).toBeCloseTo(2.5, 4)
    }
    expect(sfVerdict(0.8)).toBe('breaks')
    expect(sfVerdict(2.5)).toBe('just right')
  })
  it('a slider move recomputes fast', () => {
    expect(medianMs(() => keys.forEach((k) => {
      thicknessFor(k, 2, 'bump', 2.5)
      pullPath(MATERIALS[k], 0.05)
      hookeView(k, 'tube', 20, 0.2)
    }))).toBeLessThan(50)
  })
})
