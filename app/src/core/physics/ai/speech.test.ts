import {
  BANDS, FRAME_S, SPEECH_FEATURES, SPEECH_HZ, SPEECH_RMS, STEP_M, TURN_RAD, WAKE_WORD, findWords, hearWords, intentMotion, kwsDetect, kwsLabel, kwsStream, kwsTradeoff,
  mixAudio, parseCommand, roomNoise, sayCommand, sayWord, spectrogram, voiceOf, windowFeatures, wordSeconds,
} from './speech'

const rms = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length)
const bandMeans = (xs: number[]) => {
  const { bands } = spectrogram(xs)
  return Array.from({ length: BANDS }, (_, k) => bands.reduce((s, r) => s + r[k], 0) / bands.length)
}

describe('speech audio', () => {
  it('a word lasts its phones ÷ rate; hiss is high, vowels low', () => {
    const v = voiceOf(2)
    expect(sayWord('go', v).length / SPEECH_HZ).toBeCloseTo(wordSeconds('go', v), 2)
    const s = bandMeans(sayWord('please', v).slice(-400))
    const o = bandMeans(sayWord('go', v).slice(-400))
    expect(s[BANDS - 1]).toBeGreaterThan(s[1])
    expect(o[1]).toBeGreaterThan(o[BANDS - 1])
  })
  it('room noise is unit rms; the mix puts it snr dB under speech', () => {
    expect(rms(roomNoise(4000, 3))).toBeCloseTo(1, 6)
    const { samples } = mixAudio([], 0.5, 20, voiceOf(1), 4)
    expect(rms(samples)).toBeCloseTo(SPEECH_RMS / 10, 6)
  })
  it('a 1 kHz tone lands in the 800–1100 Hz band; features are 64 and volume-free', () => {
    const tone = Array.from({ length: 800 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / SPEECH_HZ))
    const m = bandMeans(tone)
    expect(m.indexOf(Math.max(...m))).toBe(3)
    const { bands } = spectrogram(tone)
    const f = windowFeatures(bands, 0, 10)
    expect(f).toHaveLength(SPEECH_FEATURES)
    expect(f.reduce((s, v) => s + v, 0)).toBeCloseTo(0, 9)
    const hum = roomNoise(800, 2).map((x, i) => tone[i] + 0.05 * x)
    const f1 = windowFeatures(spectrogram(hum).bands, 0, 10)
    windowFeatures(spectrogram(hum.map((x) => 4 * x)).bands, 0, 10).forEach((v, i) => expect(v).toBeCloseTo(f1[i], 2))
  })
})

describe('keyword spotting', () => {
  it('window labels: whole wake word, other speech, noise', () => {
    const spoken = [{ word: WAKE_WORD, at: 1, end: 1.7 }, { word: 'go', at: 3, end: 3.2 }]
    expect(kwsLabel(spoken, 0.9, 1.9)).toBe(0)
    expect(kwsLabel(spoken, 1.2, 2.2)).toBe(1)
    expect(kwsLabel(spoken, 2.9, 3.9)).toBe(1)
    expect(kwsLabel(spoken, 4, 5)).toBe(2)
  })
  it('detector: smoothing, refractory, hits, misses, false wakes', () => {
    const times = Array.from({ length: 60 }, (_, i) => i * 0.1)
    const wake = times.map((t) => (t >= 1.5 && t < 2 ? 1 : t >= 4.5 && t < 4.7 ? 0.9 : 0))
    const spoken = [{ word: WAKE_WORD, at: 0.8, end: 1.4 }, { word: WAKE_WORD, at: 2.5, end: 3 }]
    const d = kwsDetect(times, wake, spoken, 0.5)
    expect(d.fires.map((t) => +t.toFixed(1))).toEqual([1.6, 4.6])
    expect(d.hit).toEqual([true, false])
    expect(d.misses).toBe(1)
    expect(d.falses.map((t) => +t.toFixed(1))).toEqual([4.6])
    expect(kwsDetect(times, wake, spoken, 0.95).fires).toHaveLength(1)
  })
  it('the trained net catches every wake word in a quiet room and few in a loud one', () => {
    const quiet = kwsStream(1, 25)
    const dq = kwsDetect(quiet.times, quiet.wake, quiet.spoken, 0.7)
    expect(dq.misses).toBe(0)
    expect(dq.falses.length).toBeLessThanOrEqual(1)
    const loud = kwsStream(1, 0)
    expect(kwsDetect(loud.times, loud.wake, loud.spoken, 0.7).misses).toBeGreaterThanOrEqual(3)
  })
  it('raising the threshold trades false wakes for misses', () => {
    const s = kwsStream(2, 10)
    const t = kwsTradeoff(s.times, s.wake, s.spoken, [0.1, 0.3, 0.5, 0.7, 0.9, 0.99])
    for (let i = 1; i < t.length; i++) expect(t[i].misses).toBeGreaterThanOrEqual(t[i - 1].misses)
    expect(t[0].falses).toBeGreaterThanOrEqual(t[t.length - 1].falses)
  })
})

describe('voice commands', () => {
  it('voice activity finds each word', () => {
    const { samples, spoken } = sayCommand('forward two', 3, 25)
    const { segs } = findWords(spectrogram(samples).bands)
    expect(segs).toHaveLength(2)
    segs.forEach(([a, b], i) => {
      expect(a * FRAME_S).toBeCloseTo(spoken[i].at, 0)
      expect(b * FRAME_S).toBeCloseTo(spoken[i].end, 0)
    })
  })
  it('grammar: fillers dropped, default count 1, low confidence or bad order → ask again', () => {
    const h = (word: string, p = 0.9) => ({ word, p })
    expect(parseCommand([h('other'), h('forward'), h('two')], 0.6).intent).toEqual({ action: 'forward', amount: 2 })
    expect(parseCommand([h('left')], 0.6).intent).toEqual({ action: 'left', amount: 1 })
    expect(parseCommand([h('left'), h('two', 0.4)], 0.6)).toMatchObject({ intent: null, conf: 0.4 })
    expect(parseCommand([h('two'), h('left')], 0.6).intent).toBeNull()
    expect(parseCommand([h('left'), h('right')], 0.6).intent).toBeNull()
    expect(parseCommand([h('stop'), h('one')], 0.6).intent).toBeNull()
    expect(parseCommand([h('other')], 0.6).intent).toBeNull()
  })
  it('heard end to end in a quiet room', () => {
    const { heard } = hearWords(sayCommand('um back three', 2, 25).samples)
    expect(heard.map((w) => w.word)).toEqual(['other', 'back', 'three'])
    expect(parseCommand(heard, 0.6).intent).toEqual({ action: 'back', amount: 3 })
  })
  it('motion: steps forward/back, quarter turns, stop stays', () => {
    expect(intentMotion({ action: 'back', amount: 2 })).toEqual({ dist: -2 * STEP_M, turn: 0 })
    expect(intentMotion({ action: 'right', amount: 1 })).toEqual({ dist: 0, turn: -TURN_RAD })
    expect(intentMotion({ action: 'stop', amount: 1 })).toEqual({ dist: 0, turn: 0 })
    expect(intentMotion(null)).toEqual({ dist: 0, turn: 0 })
  })
})
