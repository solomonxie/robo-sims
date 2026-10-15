import {
  LOAD_CELL,
  TOUCH,
  beamStrain,
  bridgeOut,
  calFactor,
  fingerC,
  gaugeDelta,
  hx711Code,
  hx711Lsb,
  loadCellRead,
  padFarads,
  padPeriod,
  padVolts,
  toGrams,
  touchCount,
  touchState,
  waterC,
} from './force'

const C = LOAD_CELL

describe('strain gauge', () => {
  it('1 kg bends the web ~500 µε; a 1 kΩ gauge moves ~1 Ω', () => {
    const e = beamStrain(9.81, C.arm, C.E, C.width, C.thick)
    expect(e).toBeGreaterThan(400e-6)
    expect(e).toBeLessThan(600e-6)
    expect(gaugeDelta(1000, 2, e)).toBeCloseTo(2000 * e, 9)
  })
  it('bridge output: quarter ≈ Vex·GF·ε/4, half /2, full exact', () => {
    const e = 500e-6
    const full = bridgeOut(3.3, 1000, 2, e, 'full')
    expect(full.out).toBeCloseTo(3.3 * 2 * e, 12)
    expect(bridgeOut(3.3, 1000, 2, e, 'half').out).toBeCloseTo((3.3 * 2 * e) / 2, 12)
    const q = bridgeOut(3.3, 1000, 2, e, 'quarter').out
    expect(q).toBeLessThan((3.3 * 2 * e) / 4)
    expect(q).toBeGreaterThan((3.3 * 2 * e) / 4 * 0.998)
    expect(bridgeOut(3.3, 1000, 2, 0, 'full').out).toBeCloseTo(0, 15)
    expect(bridgeOut(3.3, 1000, 2, 0, 'full', 0.12).out).toBeCloseTo((-3.3 * 0.06) / 2000.12, 12)
  })
  it('HX711 at gain 128 resolves ~1.5 nV and clips at ±12.9 mV', () => {
    expect(hx711Lsb(3.3)).toBeCloseTo(12.890625e-3 / 2 ** 23, 15)
    expect(hx711Code(1e-3, 3.3)).toBe(Math.round(1e-3 / hx711Lsb(3.3)))
    expect(hx711Code(1, 3.3)).toBe(2 ** 23 - 1)
    expect(hx711Code(-1, 3.3)).toBe(-(2 ** 23))
  })
  it('tare + one known weight turns counts into grams', () => {
    const tray = 0.05
    const rawTare = loadCellRead(tray, 'full', 3.3).code
    const factor = calFactor(loadCellRead(tray + 0.5, 'full', 3.3).code, rawTare, 500)
    expect(factor).toBeGreaterThan(1000)
    expect(toGrams(loadCellRead(tray + 0.2, 'full', 3.3).code, rawTare, factor)).toBeCloseTo(200, 1)
    const noisy = toGrams(loadCellRead(tray + 0.2, 'full', 3.3, 7).code, rawTare, factor)
    expect(Math.abs(noisy - 200)).toBeLessThan(0.2)
  })
  it('quarter bridge calibrated at 500 g reads 1 kg slightly low (non-linear)', () => {
    const rawTare = loadCellRead(0, 'quarter', 3.3).code
    const f = calFactor(loadCellRead(0.5, 'quarter', 3.3).code, rawTare, 500)
    const g = toGrams(loadCellRead(1, 'quarter', 3.3).code, rawTare, f)
    expect(g).toBeLessThan(1000)
    expect(g).toBeGreaterThan(998)
  })
})

describe('capacitive touch', () => {
  it('an idle pad counts ~68 cycles; a finger on the bare pad drops it under 25', () => {
    expect(padPeriod(TOUCH.padF)).toBeCloseTo((2 * 20e-12 * 2.2) / 12e-6, 15)
    const idle = touchCount(padFarads('bare', null, 'none'))
    expect(idle).toBeGreaterThan(60)
    expect(idle).toBeLessThan(75)
    expect(touchCount(padFarads('bare', 0, 'none'))).toBeLessThan(25)
  })
  it('thicker plastic and a hovering finger add less; the body caps it', () => {
    expect(fingerC('thin', 0)).toBeLessThan(fingerC('bare', 0))
    expect(fingerC('thick', 0)).toBeLessThan(fingerC('thin', 0))
    expect(fingerC('bare', 0.01)).toBeLessThan(fingerC('bare', 0.001))
    expect(fingerC('bare', 0)).toBeLessThan(TOUCH.bodyF)
  })
  it('a droplet barely moves the count; a puddle reaching ground looks like a finger through 1 mm', () => {
    const idle = touchCount(padFarads('thin', null, 'none'))
    expect(idle - touchCount(padFarads('thin', null, 'drop'))).toBeLessThan(3)
    const puddle = touchCount(padFarads('thin', null, 'puddle'))
    const finger = touchCount(padFarads('thin', 0, 'none'))
    expect(waterC('thin', 'none')).toBe(0)
    expect(idle - puddle).toBeGreaterThan(5)
    expect(Math.abs(puddle - finger)).toBeLessThan(6)
  })
  it('pad voltage is a triangle between the thresholds', () => {
    const T = padPeriod(TOUCH.padF)
    expect(padVolts(0, TOUCH.padF)).toBeCloseTo(0.5, 9)
    expect(padVolts(T / 2, TOUCH.padF)).toBeCloseTo(2.7, 9)
    expect(padVolts(T / 4, TOUCH.padF)).toBeCloseTo(1.6, 9)
  })
  it('hysteresis holds the state inside the band', () => {
    expect(touchState(false, 50, 48, 51)).toBe(false)
    expect(touchState(false, 47, 48, 51)).toBe(true)
    expect(touchState(true, 50, 48, 51)).toBe(true)
    expect(touchState(true, 52, 48, 51)).toBe(false)
    expect(touchState(true, 49, 48, 48)).toBe(false)
  })
})
