import {
  INMP441,
  TONE_HZ,
  WHINE_HZ,
  bearingFromDelay,
  bearingStep,
  corrPeaks,
  crossCorr,
  diaphragmShift,
  dominantHz,
  frontBackMirror,
  i2sSck,
  locate,
  micCapF,
  micCode,
  micDbfs,
  micSpectrum,
  noiseFloorSpl,
  paToSpl,
  pdmBits,
  peakLag,
  soundAt,
  spatialAliasing,
  spectralFlatness,
  splToPa,
  tdoa,
} from './microphone'

const deg = (r: number) => (r * 180) / Math.PI
const rad = (d: number) => (d * Math.PI) / 180

describe('MEMS mic', () => {
  it('94 dB SPL is 1 Pa and reads −26 dBFS', () => {
    expect(splToPa(94)).toBeCloseTo(1, 1)
    expect(paToSpl(1)).toBeCloseTo(94, 0)
    expect(micDbfs(94)).toBe(-26)
    expect(micDbfs(INMP441.aopDb)).toBe(0)
    expect(micCode(1)).toBeCloseTo(0.0501 * 2 ** 23, -3)
    expect(micCode(-1)).toBe(-micCode(1))
    expect(micCode(1000)).toBe(2 ** 23 - 1)
    expect(noiseFloorSpl()).toBe(33)
  })
  it('pressure closes the gap, so C rises by a tiny fraction', () => {
    const c0 = micCapF(0)
    expect(c0).toBeGreaterThan(0.5e-12)
    expect(c0).toBeLessThan(1.5e-12)
    const c1 = micCapF(diaphragmShift(1))
    expect(c1).toBeGreaterThan(c0)
    expect(c1 / c0 - 1).toBeLessThan(0.01)
    expect(micCapF(diaphragmShift(-1))).toBeLessThan(c0)
  })
  it('I²S clocks 64 bits per sample; PDM density follows the input', () => {
    expect(i2sSck(16000)).toBe(1.024e6)
    for (const v of [-0.6, 0, 0.3, 0.9]) {
      const bits = pdmBits(Array(400).fill(v))
      expect((2 * bits.reduce((s, b) => s + b, 0)) / bits.length - 1).toBeCloseTo(v, 1)
    }
  })
  it('sounds: clap decays, whine and tone keep going, cutoff removes partials', () => {
    expect(soundAt('clap', -0.001)).toBe(0)
    const rms = (a: number, b: number) => Math.sqrt(Array.from({ length: 200 }, (_, i) => soundAt('clap', a + ((b - a) * i) / 200) ** 2).reduce((s, v) => s + v, 0) / 200)
    expect(rms(0, 0.004)).toBeGreaterThan(5 * rms(0.02, 0.024))
    expect(soundAt('tone', 1 / (4 * TONE_HZ))).toBeCloseTo(1)
    expect(soundAt('tone', 0.1, 1000)).toBe(0)
    const peak = Math.max(...Array.from({ length: 2000 }, (_, i) => Math.abs(soundAt('whine', i / 96000))))
    expect(peak).toBeLessThanOrEqual(1)
    expect(peak).toBeGreaterThan(0.4)
  })
  it('spectrum: whine is lines at its fundamental, a clap is broad; fs/2 is the ceiling', () => {
    const w = micSpectrum('whine', 16000, 256)
    expect(dominantHz(w.amps, 16000, 256)).toBeCloseTo(WHINE_HZ, -2)
    const c = micSpectrum('clap', 16000, 256)
    expect(c.flatness).toBeGreaterThan(4 * w.flatness)
    expect(micSpectrum('clap', 48000, 256).flatness).toBeGreaterThan(4 * micSpectrum('whine', 48000, 256).flatness)
    expect(spectralFlatness([0, 1, 1, 1])).toBeCloseTo(1)
    const low = micSpectrum('whine', 8000, 256)
    const bin = (hz: number) => Math.round((hz / 8000) * 256)
    expect(low.db[bin(3600)]).toBeGreaterThan(-30)
    expect(Math.max(...low.db.slice(bin(4000) - 2))).toBeLessThan(-30)
    expect(Math.max(...c.db)).toBe(0)
  })
})

describe('sound direction', () => {
  it('delay, bearing and its mirror', () => {
    expect(tdoa(rad(90), 0.1)).toBeCloseTo(0.1 / 343, 9)
    expect(tdoa(0, 0.1)).toBe(0)
    expect(deg(bearingFromDelay(tdoa(rad(30), 0.1), 0.1))).toBeCloseTo(30)
    expect(deg(bearingFromDelay(tdoa(rad(150), 0.1), 0.1))).toBeCloseTo(30)
    expect(deg(frontBackMirror(rad(30)))).toBeCloseTo(150)
    expect(deg(frontBackMirror(rad(-30)))).toBeCloseTo(-150)
    expect(deg(bearingStep(0.1, 48000))).toBeCloseTo(4.1, 1)
    expect(bearingStep(0.2, 48000)).toBeLessThan(bearingStep(0.05, 48000))
  })
  it('cross-correlation finds a sub-sample delay', () => {
    const a = Array.from({ length: 300 }, (_, i) => soundAt('clap', i / 48000 - 0.001))
    const b = Array.from({ length: 300 }, (_, i) => soundAt('clap', i / 48000 - 0.001 - 3.4 / 48000))
    const r = crossCorr(a, b, 8)
    expect(r).toHaveLength(17)
    expect(peakLag(r, 8)).toBeCloseTo(3.4, 0)
    expect(Math.abs(peakLag(r, 8) - 3.4)).toBeLessThan(0.25)
    expect(crossCorr(a, a, 0)[0]).toBeCloseTo(1)
    expect(corrPeaks(r, 8, 8)).toHaveLength(1)
  })
  it('two mics hear a clap’s bearing but fold the back onto the front', () => {
    const f = locate('clap', rad(30), 0.1, 'two')
    expect(deg(f.estimate)).toBeCloseTo(30, -1)
    expect(Math.abs(deg(f.estimate) - 30)).toBeLessThan(3)
    const b = locate('clap', rad(150), 0.1, 'two')
    expect(Math.abs(deg(b.estimate) - 30)).toBeLessThan(3)
    expect(b.candidates.some((c) => Math.abs(deg(c) - 150) < 3)).toBe(true)
    expect(b.candidates).toHaveLength(2)
  })
  it('four mics resolve all the way round', () => {
    for (const d of [150, -120, -20, 95]) {
      const r = locate('clap', rad(d), 0.1, 'four')
      expect(Math.abs(deg(r.estimate) - d)).toBeLessThan(4)
      expect(r.candidates).toHaveLength(1)
    }
  })
  it('a tone with mics over half a wavelength apart gives several peaks', () => {
    expect(spatialAliasing(0.06, TONE_HZ)).toBe(false)
    expect(spatialAliasing(0.3, TONE_HZ)).toBe(true)
    expect(locate('tone', rad(20), 0.06, 'two').candidates).toHaveLength(2)
    expect(locate('tone', rad(20), 0.3, 'two').candidates.length).toBeGreaterThan(2)
    expect(locate('clap', rad(20), 0.3, 'two').candidates).toHaveLength(2)
  })
})
