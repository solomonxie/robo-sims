// Speech, toy version: words synthesised from formant phones at 8 kHz, a log-band spectrogram (10 ms frames, 8 mel-like
// bands), a 1 s wake-word net run every 100 ms on a stream, and a command-word net + parser for spoken robot commands.
import { clamp, parkMiller } from '../common'
import { dftAmplitudes } from '../signals/fourier'
import { argmax, classTarget } from './gesture'
import { Mlp, Sample, mlpInit, mlpOut, mlpTrain } from './net'

export const SPEECH_HZ = 8000
export const FRAME_N = 80
export const FRAME_S = FRAME_N / SPEECH_HZ
/** Band edges in DFT bins of 100 Hz: 200 … 4000 Hz, narrow low, wide high (like mel). */
export const BAND_EDGES = [2, 4, 6, 8, 11, 15, 21, 29, 41]
export const BANDS = BAND_EDGES.length - 1
export const SLICES = 8
export const SPEECH_FEATURES = BANDS * SLICES

interface Phone { f1: number; f2: number; voice: number; hiss: number; hz: number; ms: number }
const V = (f1: number, f2: number, ms = 110, voice = 1): Phone => ({ f1, f2, voice, hiss: 0, hz: 0, ms })
const H = (hz: number, hiss: number, ms: number, voice = 0): Phone => ({ f1: 400, f2: 1500, voice, hiss, hz, ms })
const PHONES: Record<string, Phone> = {
  a: V(700, 1200), e: V(500, 1850), i: V(300, 2300), o: V(500, 900), u: V(350, 800), er: V(450, 1300),
  r: V(350, 1250, 60, 0.6), l: V(380, 1000, 60, 0.6), w: V(300, 700, 60, 0.6), m: V(250, 1100, 70, 0.4), n: V(250, 1600, 70, 0.4),
  s: H(3400, 0.5, 110), sh: H(2500, 0.5, 110), f: H(2800, 0.2, 90), th: H(3000, 0.15, 80), h: H(1600, 0.25, 70),
  _: H(0, 0, 45), b: H(600, 0.3, 15, 0.3), d: H(2500, 0.3, 15, 0.3), g: H(1800, 0.3, 15, 0.3), p: H(800, 0.5, 30), t: H(3500, 0.5, 30), k: H(2000, 0.5, 30),
}
/** Phone spellings; '_' is a stop closure. */
export const WORDS: Record<string, string> = {
  'hey robo': 'h e i r o _ b o',
  hello: 'h e l o',
  robot: 'r o _ b o _ t',
  rainbow: 'r e i n _ b o',
  hey: 'h e i',
  yellow: 'i e l o',
  forward: 'f o r w er _ d',
  back: '_ b a _ k',
  left: 'l e f _ t',
  right: 'r a i _ t',
  stop: 's _ t o _ p',
  one: 'w a n',
  two: '_ t u',
  three: 'th r i',
  um: 'a m',
  please: '_ p l i s',
  go: '_ g o',
  now: 'n a u',
}

export interface Voice { f0: number; k: number; rate: number; gain: number }
/** A speaker: pitch, formant scale (vocal tract), speaking rate, loudness. */
export function voiceOf(seed: number): Voice {
  const r = parkMiller(seed * 977 + 13)
  return { f0: 95 + 135 * r(), k: 0.9 + 0.25 * r(), rate: 0.8 + 0.4 * r(), gain: 0.6 + 0.4 * r() }
}
const phonesOf = (word: string) => WORDS[word].split(' ').map((p) => PHONES[p])
export const wordSeconds = (word: string, v: Voice) => phonesOf(word).reduce((s, p) => s + p.ms, 0) / 1000 / v.rate

/** Samples of `word`: pitch-pulsed F1 + F2 tones for voicing, band noise for hiss, 20 ms glides between phones. */
export function sayWord(word: string, v: Voice, seed = 1) {
  const ph = phonesOf(word)
  const noise = fastNoise(seed * 31 + 7)
  let acc = 0
  const ends = ph.map((p) => (acc += p.ms / 1000 / v.rate))
  const n = Math.round(ends[ends.length - 1] * SPEECH_HZ)
  const out = new Array<number>(n)
  const [glide, tau] = [0.02, (2 * Math.PI) / SPEECH_HZ]
  let [k, p0, p1, p2, pc, lp] = [0, 0, 0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    const t = i / SPEECH_HZ
    while (k < ph.length - 1 && t >= ends[k]) k++
    const cur = ph[k]
    const prev = ph[Math.max(0, k - 1)]
    const w = k === 0 ? 1 : clamp((t - ends[k - 1]) / glide, 0, 1)
    const mix = (a: number, b: number) => a + (b - a) * w
    const f0 = v.f0 * (1.1 - 0.2 * (t / ends[ends.length - 1]))
    p0 += tau * f0
    p1 += tau * mix(prev.f1, cur.f1) * v.k
    p2 += tau * mix(prev.f2, cur.f2) * v.k
    pc += tau * (cur.hz || 1000)
    const vo = mix(prev.voice, cur.voice)
    const c = 0.5 + 0.5 * Math.cos(p0)
    const voiced = vo > 0 ? vo * c * c * c * (Math.sin(p1) + 0.6 * Math.sin(p2)) : 0
    let hiss = 0
    if (cur.hiss > 0) {
      lp += 0.35 * (noise() - lp)
      hiss = cur.hiss * lp * Math.sin(pc)
    }
    const edge = Math.min(1, t / 0.01, (n - i) / SPEECH_HZ / 0.01)
    out[i] = v.gain * edge * (0.5 * voiced + hiss)
  }
  return out
}

/** Unit-variance uniform noise, cheap enough for every audio sample (low-passing makes it near-Gaussian). */
export function fastNoise(seed: number) {
  const r = parkMiller(seed)
  return () => Math.sqrt(12) * (r() - 0.5)
}

/** Unit-rms room noise: low-passed hiss plus a little 100 Hz hum. */
export function roomNoise(n: number, seed: number) {
  const gauss = fastNoise(seed * 53 + 1)
  const out = new Array<number>(n)
  let lp = 0
  for (let i = 0; i < n; i++) {
    lp += 0.5 * (gauss() - lp)
    out[i] = lp + 0.15 * Math.sin((2 * Math.PI * 100 * i) / SPEECH_HZ)
  }
  const rms = Math.sqrt(out.reduce((s, x) => s + x * x, 0) / n)
  return out.map((x) => x / rms)
}

/** Typical speech rms; noise at `snrDb` below it. */
export const SPEECH_RMS = 0.14
export interface Spoken { word: string; at: number; end: number }

/** `seconds` of audio: each word at its start time, room noise `snrDb` below speech. */
export function mixAudio(words: readonly { word: string; at: number }[], seconds: number, snrDb: number, voice: Voice, seed: number) {
  const n = Math.round(seconds * SPEECH_HZ)
  const noise = roomNoise(n, seed)
  const g = SPEECH_RMS * 10 ** (-snrDb / 20)
  const samples = noise.map((x) => g * x)
  const spoken: Spoken[] = words.map(({ word, at }, j) => {
    const w = sayWord(word, voice, seed * 17 + j)
    const i0 = Math.round(at * SPEECH_HZ)
    for (let i = 0; i < w.length && i0 + i < n; i++) samples[i0 + i] += w[i]
    return { word, at, end: at + w.length / SPEECH_HZ }
  })
  return { samples, spoken }
}

/** 10 ms frames: amplitude per 100 Hz bin (Hann) and log10 energy per band. */
export function spectrogram(samples: readonly number[]) {
  const amps: number[][] = []
  const bands: number[][] = []
  for (let i = 0; i + FRAME_N <= samples.length; i += FRAME_N) {
    const a = dftAmplitudes(samples.slice(i, i + FRAME_N), true)
    amps.push(a)
    const row: number[] = []
    for (let b = 0; b < BANDS; b++) {
      let e = 0
      for (let m = BAND_EDGES[b]; m < BAND_EDGES[b + 1]; m++) e += a[m] * a[m]
      row.push(Math.log10(e + 1e-7))
    }
    bands.push(row)
  }
  return { amps, bands }
}
/** Multiply-adds per second for the features: a DFT of every 10 ms frame (2 per sample per bin). */
export const SPECTRO_MACS_PER_S = (FRAME_N / 2 + 1) * FRAME_N * 2 * (SPEECH_HZ / FRAME_N)

/** Mean log energy per band in `SLICES` time slices of frames [from, from + count), minus the window mean (volume-free). */
export function windowFeatures(bands: readonly number[][], from: number, count: number) {
  const f: number[] = []
  for (let s = 0; s < SLICES; s++) {
    const a = from + Math.floor((s * count) / SLICES)
    const b = from + Math.floor(((s + 1) * count) / SLICES)
    for (let k = 0; k < BANDS; k++) {
      let sum = 0
      for (let j = a; j < b; j++) sum += bands[clamp(j, 0, bands.length - 1)][k]
      f.push(sum / Math.max(1, b - a))
    }
  }
  const mean = f.reduce((s, v) => s + v, 0) / f.length
  return f.map((v) => (v - mean) / 1.5)
}

function trainNet(data: Sample[], hidden: number, seed: number): Mlp {
  const sizes = [SPEECH_FEATURES, hidden, data[0].t.length]
  return mlpTrain(mlpInit(sizes, ['tanh', 'sigmoid'], seed), data, { lr: 0.5, epochs: 60, loss: 'bce', batch: 16, seed: seed + 1, snaps: 2 }).net
}
const once = <T>(f: () => T) => {
  let v: T | undefined
  return () => (v ??= f())
}

// --- Keyword spotting ---

export const WAKE_WORD = 'hey robo'
export const KWS_CLASSES = ['Hey robo', 'Other word', 'Silence']
export const OTHER_WORDS = ['hello', 'robot', 'rainbow', 'hey', 'yellow', 'go', 'stop', 'now']
export const KWS_FRAMES = 100
export const KWS_HOP = 10

/** A 12 s stream: ten 1.2 s slots, four hold the wake word, the rest other words, shuffled by `seed`. */
export function kwsScript(seed: number) {
  const r = parkMiller(seed * 101 + 9)
  const kinds = [0, 0, 0, 0, 1, 1, 1, 1, 1, 1]
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[kinds[i], kinds[j]] = [kinds[j], kinds[i]]
  }
  return kinds.map((k, i) => ({ word: k === 0 ? WAKE_WORD : OTHER_WORDS[Math.floor(r() * OTHER_WORDS.length)], at: 0.9 + i * 1.12 + 0.2 * r() }))
}
export const KWS_STREAM_S = 12.5

/** Label of the window [t0, t1]: 0 = holds a whole wake word, 1 = holds any other speech, 2 = only noise. */
export function kwsLabel(spoken: readonly Spoken[], t0: number, t1: number) {
  if (spoken.some((w) => w.word === WAKE_WORD && w.at >= t0 && w.end <= t1)) return 0
  return spoken.some((w) => w.end > t0 && w.at < t1) ? 1 : 2
}

/** Training windows cut from `streams` random streams (own speakers, SNR 5…30 dB): every wake window, every third other. */
export function kwsTrainSet(streams: number, seed: number): Sample[] {
  const out: Sample[] = []
  for (let s = 0; s < streams; s++) {
    const r = parkMiller(seed * 59 + s)
    const { samples, spoken } = mixAudio(kwsScript(seed + s), KWS_STREAM_S, 5 + 25 * r(), voiceOf(seed * 3 + s), seed + s)
    const { bands } = spectrogram(samples)
    for (let e = KWS_FRAMES, j = 0; e <= bands.length; e += KWS_HOP, j++) {
      const cls = kwsLabel(spoken, (e - KWS_FRAMES) * FRAME_S, e * FRAME_S)
      if (cls === 0 || j % 3 === 0) out.push({ x: windowFeatures(bands, e - KWS_FRAMES, KWS_FRAMES), t: classTarget(cls, 3) })
    }
  }
  return out
}
/** 64-12-3 net, trained once on windows from 8 streams. */
export const kwsNet = once(() => trainNet(kwsTrainSet(8, 1000), 12, 5))

/** The stream, its spectrogram, and the wake probability of every 1 s window, one per 100 ms (time = window end). */
export function kwsStream(seed: number, snrDb: number) {
  const voice = voiceOf(seed * 5 + 2)
  const { samples, spoken } = mixAudio(kwsScript(seed), KWS_STREAM_S, snrDb, voice, seed + 40)
  const spec = spectrogram(samples)
  const net = kwsNet()
  const times: number[] = []
  const post: number[][] = []
  for (let e = KWS_FRAMES; e <= spec.bands.length; e += KWS_HOP) {
    times.push(e * FRAME_S)
    post.push(mlpOut(net, windowFeatures(spec.bands, e - KWS_FRAMES, KWS_FRAMES)))
  }
  return { samples, spoken, spec, times, wake: post.map((y) => y[0] / Math.max(1e-9, y[0] + y[1] + y[2])) }
}

/** Fire when the mean of the last `smooth` wake scores crosses `threshold`, then stay deaf for `refractory` s. A fire within
 *  a wake word or 1 s after it is a hit; any other fire is a false wake; a wake word with no hit is a miss. */
export function kwsDetect(times: readonly number[], wake: readonly number[], spoken: readonly Spoken[], threshold: number, smooth = 3, refractory = 1) {
  const fires: number[] = []
  const score = wake.map((_, i) => {
    const a = Math.max(0, i - smooth + 1)
    return wake.slice(a, i + 1).reduce((s, v) => s + v, 0) / (i + 1 - a)
  })
  let deaf = -Infinity
  score.forEach((s, i) => {
    if (s >= threshold && times[i] >= deaf) {
      fires.push(times[i])
      deaf = times[i] + refractory
    }
  })
  const wakes = spoken.filter((w) => w.word === WAKE_WORD)
  const hitBy = (t: number) => wakes.findIndex((w) => t > w.at && t <= w.end + 1)
  const hit = wakes.map((_, k) => fires.some((t) => hitBy(t) === k))
  const falses = fires.filter((t) => hitBy(t) < 0)
  return { score, fires, hit, misses: hit.filter((h) => !h).length, falses, wakes: wakes.length }
}

/** Misses and false wakes for each threshold. */
export const kwsTradeoff = (times: readonly number[], wake: readonly number[], spoken: readonly Spoken[], thresholds: readonly number[]) =>
  thresholds.map((th) => {
    const d = kwsDetect(times, wake, spoken, th)
    return { th, misses: d.misses, falses: d.falses.length }
  })

// --- Voice commands ---

export const CMD_WORDS = ['forward', 'back', 'left', 'right', 'stop', 'one', 'two', 'three']
export const CMD_CLASSES = [...CMD_WORDS, 'other']
export const FILLERS = ['um', 'please', 'go', 'now', 'hello']
export const CMD_FRAMES = 60

/** Voice activity: frames whose total log energy is `rise` above the quietest 10 %; gaps under 150 ms merged, blips under 80 ms dropped. */
export function findWords(bands: readonly number[][], rise = 0.6) {
  const e = bands.map((row) => Math.log10(row.reduce((s, v) => s + 10 ** v, 0)))
  const floor = [...e].sort((a, b) => a - b)[Math.floor(e.length * 0.1)]
  const segs: [number, number][] = []
  e.forEach((v, i) => {
    if (v < floor + rise) return
    const last = segs[segs.length - 1]
    if (last && i - last[1] <= 15) last[1] = i
    else segs.push([i, i])
  })
  return { energy: e, floor, segs: segs.filter(([a, b]) => b - a >= 8) }
}

export interface Heard { from: number; to: number; probs: number[]; k: number; word: string; p: number }

/** Spoken text (words split by spaces) by `voice` with `gap` s between words, padded 0.4 s. */
export function sayCommand(text: string, seed: number, snrDb: number, gap = 0.3) {
  const voice = voiceOf(seed * 5 + 3)
  let t = 0.4
  const words = text.split(' ').map((word) => {
    const at = t
    t += wordSeconds(word, voice) + gap
    return { word, at }
  })
  return mixAudio(words, t - gap + 0.4, snrDb, voice, seed + 70)
}

const segFeatures = (bands: readonly number[][], [a, b]: [number, number]) => windowFeatures(bands, Math.round((a + b) / 2) - CMD_FRAMES / 2, CMD_FRAMES)

/** Found words from `count` random three-word utterances (SNR 5…30 dB), labelled by the spoken word they overlap most; fillers = 'other'. */
export function cmdTrainSet(count: number, seed: number): Sample[] {
  const pool = [...CMD_WORDS, ...FILLERS, ...FILLERS.slice(0, 3)]
  return Array.from({ length: count }, (_, u) => {
    const r = parkMiller(seed * 41 + u)
    const text = [0, 1, 2].map(() => pool[Math.floor(r() * pool.length)]).join(' ')
    const { samples, spoken } = sayCommand(text, seed + u, 5 + 25 * r())
    const { bands } = spectrogram(samples)
    return findWords(bands).segs.map((sg) => {
      const lap = spoken.map((w) => Math.min(sg[1] + 1, w.end / FRAME_S) - Math.max(sg[0], w.at / FRAME_S))
      const k = CMD_WORDS.indexOf(spoken[argmax(lap)].word)
      return { x: segFeatures(bands, sg), t: classTarget(k < 0 ? CMD_WORDS.length : k, CMD_CLASSES.length) }
    })
  }).flat()
}
/** 64-14-9 net, trained once on the words of 100 utterances. */
export const cmdNet = once(() => trainNet(cmdTrainSet(100, 1000), 14, 8))

/** Each found word: a 0.6 s window centred on it through the command net. */
export function hearWords(samples: readonly number[]) {
  const spec = spectrogram(samples)
  const { energy, floor, segs } = findWords(spec.bands)
  const net = cmdNet()
  const heard: Heard[] = segs.map(([from, to]) => {
    const y = mlpOut(net, segFeatures(spec.bands, [from, to]))
    const sum = y.reduce((s, v) => s + v, 0) || 1
    const probs = y.map((v) => v / sum)
    const k = argmax(probs)
    return { from, to, probs, k, word: CMD_CLASSES[k], p: probs[k] }
  })
  return { spec, energy, floor, heard }
}

export type Action = 'forward' | 'back' | 'left' | 'right' | 'stop'
export interface Intent { action: Action; amount: number }
const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3 }

/** Grammar: [filler…] ACTION [NUMBER] [filler…]. Fillers are dropped; a missing number means 1 (stop takes none).
 *  Any grammar word under `threshold` → ask again. */
export function parseCommand(heard: readonly { word: string; p: number }[], threshold: number) {
  const used = heard.filter((h) => h.word !== 'other')
  const conf = used.length ? Math.min(...used.map((h) => h.p)) : 0
  const fail = (why: string) => ({ intent: null as Intent | null, conf, why, used })
  if (!used.length) return fail('heard no command words')
  const [a, num, ...rest] = used
  if (a.word in NUMBERS) return fail(`"${a.word}" with no action`)
  if (rest.length || (num && !(num.word in NUMBERS))) return fail('two actions in one command')
  if (a.word === 'stop' && num) return fail('"stop" takes no number')
  if (conf < threshold) return fail(`not sure of "${used.find((h) => h.p === conf)!.word}" (${Math.round(conf * 100)} %)`)
  return { intent: { action: a.word as Action, amount: num ? NUMBERS[num.word] : 1 }, conf, why: '', used }
}

export const STEP_M = 0.25
export const TURN_RAD = Math.PI / 2
/** Robot motion for an intent: metres forward and radians left (a quarter turn per count). */
export function intentMotion(i: Intent | null) {
  if (!i || i.action === 'stop') return { dist: 0, turn: 0 }
  if (i.action === 'forward' || i.action === 'back') return { dist: (i.action === 'forward' ? 1 : -1) * STEP_M * i.amount, turn: 0 }
  return { dist: 0, turn: (i.action === 'left' ? 1 : -1) * TURN_RAD * i.amount }
}
