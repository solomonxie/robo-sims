import { medianMs } from '../../stopwatch'
import { MATERIALS, stressAt } from '../materials/stress'
import {
  FILAMENTS,
  FILAMENT_KEYS,
  bracketSag,
  cfBlend,
  diffusionFrac,
  dryHours,
  filamentMaterial,
  fibreVolume,
  modulusRatio,
  moistureView,
  nozzleBore,
  padSquash,
  pickFilament,
  shoreToE,
  softenC,
  tpuFeed,
  uptakePct,
} from './filaments'

describe('material properties', () => {
  it('reuses the PLA and PETG data from materials/stress', () => {
    expect(FILAMENTS.pla.E).toBe(MATERIALS.pla.E)
    expect(FILAMENTS.petg.utsPa).toBe(MATERIALS.petg.utsPa)
    expect(stressAt(filamentMaterial('pla'), 0.01)).toBeCloseTo(stressAt(MATERIALS.pla, 0.01), -5)
  })
  it('picks TPU for a finger pad, PETG for a motor mount, nylon for a gear, PLA for a box, ASA outdoors', () => {
    expect(pickFilament('finger').best).toBe('tpu')
    expect(pickFilament('bracket').best).toBe('petg')
    expect(pickFilament('gear').best).toBe('nylon')
    expect(pickFilament('enclosure').best).toBe('pla')
    expect(pickFilament('outdoor').best).toBe('asa')
    expect(pickFilament('bracket').rows.find((r) => r.key === 'pla')!.hotOk).toBe(false)
  })
})

describe('glass transition', () => {
  it('modulus is 1 at room temperature and collapses past Tg; nylon keeps its crystalline share', () => {
    for (const k of FILAMENT_KEYS) expect(modulusRatio(k, 25)).toBeCloseTo(1, 6)
    expect(modulusRatio('pla', 50)).toBeGreaterThan(0.85)
    expect(modulusRatio('pla', 75)).toBeLessThan(0.1)
    expect(modulusRatio('petg', 75)).toBeGreaterThan(0.5)
    expect(modulusRatio('nylon', 120)).toBeGreaterThan(0.3)
    expect(softenC('pla')).toBeLessThan(softenC('petg'))
    expect(softenC('petg')).toBeLessThan(softenC('asa'))
    expect(softenC('asa')).toBeLessThan(softenC('pc'))
  })
  it('a PLA bracket holding 0.5 kg sags a few mm when cool and folds in a hot car', () => {
    const cool = bracketSag('pla', 25, 0.5)
    expect(cool.sagMm).toBeGreaterThan(0.3)
    expect(cool.sagMm).toBeLessThan(3)
    expect(bracketSag('pla', 70, 0.5).folds).toBe(true)
    expect(bracketSag('pc', 70, 0.5).folds).toBe(false)
  })
})

describe('flexible TPU', () => {
  it('Shore 95A is ~40 MPa and softer grades squash more', () => {
    expect(shoreToE(95) / 1e6).toBeGreaterThan(35)
    expect(shoreToE(95) / 1e6).toBeLessThan(55)
    expect(padSquash('a85', 40)).toBeGreaterThan(padSquash('a95', 40))
    expect(padSquash('a95', 40)).toBeGreaterThan(0.3)
    expect(padSquash('pla', 40)).toBeLessThan(0.01)
  })
  it('soft TPU buckles in a Bowden setup; direct drive lifts the limit; PLA never buckles', () => {
    expect(tpuFeed('a95', 'bowden', 20).buckles).toBe(false)
    expect(tpuFeed('a95', 'bowden', 60).buckles).toBe(true)
    expect(tpuFeed('a85', 'bowden', 10).buckles).toBe(true)
    expect(tpuFeed('a85', 'direct', 10).buckles).toBe(false)
    expect(tpuFeed('a95', 'direct', 20).maxSpeed).toBeGreaterThan(tpuFeed('a95', 'bowden', 20).maxSpeed)
    expect(tpuFeed('pla', 'bowden', 100).buckles).toBe(false)
    expect(tpuFeed('a95', 'bowden', 20).springMm).toBeGreaterThan(30 * tpuFeed('pla', 'bowden', 20).springMm)
  })
})

describe('carbon-fibre blends', () => {
  it('20 % fibre by weight is ~15 % by volume, roughly doubles stiffness, and costs toughness and layer bond', () => {
    expect(fibreVolume('pla', 0.2)).toBeCloseTo(0.147, 2)
    const b = cfBlend('pla', 0.2)
    expect(b.stiffer).toBeGreaterThan(1.5)
    expect(b.stiffer).toBeLessThan(2.5)
    expect(b.mat.failStrain).toBeLessThan(FILAMENTS.pla.failStrain)
    expect(b.layerBond).toBeLessThan(1)
    expect(cfBlend('pla', 0).stiffer).toBeCloseTo(1, 6)
  })
  it('a brass nozzle wears out within a kilogram; hardened steel barely moves', () => {
    const vf = fibreVolume('pla', 0.2)
    expect(nozzleBore('brass', vf, 1)).toBeGreaterThan(0.55)
    expect(nozzleBore('steel', vf, 1)).toBeLessThan(0.41)
    expect(nozzleBore('brass', 0, 5)).toBe(0.4)
  })
})

describe('drying wet filament', () => {
  it('radial diffusion goes 0 → 1 and scales with time × D / r²', () => {
    expect(diffusionFrac(0.01, 0.875, 0)).toBe(0)
    expect(diffusionFrac(0.01, 0.875, 1e4)).toBeCloseTo(1, 6)
    expect(diffusionFrac(0.01, 0.875, 10)).toBeCloseTo(diffusionFrac(0.04, 1.75, 10), 6)
  })
  it('nylon soaks up water in days, PLA slowly; heat dries it in hours; thick filament takes longer', () => {
    expect(uptakePct('nylon', 3)).toBeGreaterThan(FILAMENTS.nylon.wetPct)
    expect(uptakePct('pla', 3)).toBeLessThan(FILAMENTS.pla.wetPct)
    const h = dryHours('nylon', uptakePct('nylon', 7), 70)
    expect(h).toBeGreaterThan(3)
    expect(h).toBeLessThan(24)
    expect(dryHours('nylon', 2, 50)).toBeGreaterThan(h)
    expect(dryHours('nylon', 2, 70, 2.85)).toBeGreaterThan(2 * dryHours('nylon', 2, 70))
    const v = moistureView('nylon', 7, 70)
    expect(v.wetG - v.dryG).toBeGreaterThan(10)
  })
  it('recomputes fast', () => {
    expect(medianMs(() => FILAMENT_KEYS.forEach((k) => moistureView(k, 7, 60)))).toBeLessThan(50)
  })
})
