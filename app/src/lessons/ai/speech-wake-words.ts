import * as THREE from 'three/webgpu'
import {
  ACCELERATORS, CMD_CLASSES, FRAME_S, Intent, KWS_STREAM_S, SPECTRO_MACS_PER_S, SPEECH_HZ, STEP_M, TINY_MODELS, WAKE_WORD, deployCost, hearWords, intentMotion, kwsDetect, kwsStream,
  kwsTradeoff, mlpMacs, cmdNet, kwsNet, parseCommand, sayCommand,
} from '../../core/physics'
import type { Pose } from '../../core/physics'
import { msText, pct } from '../../core/units'
import { V3, add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  DATA_COLOR, GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, countBars, cursorBar, diffBot, flatBox, floorMat, floorView, glideAngle, glowMat, liveLabel, memoBy, pixelGrid, scope, setGlow, statusHeader,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const VIEW = { center: [-0.6, -0.4, 0] as V3, radius: 62, polar: Math.PI / 2, azimuth: 0 }
const WAVE_C = DATA_COLOR
const ESP = ACCELERATORS.esp32
const dbText = (v: number) => `${v} dB`

/** Peak |x| per column. */
function envelope(xs: readonly number[], cols: number) {
  const per = xs.length / cols
  return Array.from({ length: cols }, (_, c) => {
    let m = 0
    for (let i = Math.floor(c * per); i < Math.floor((c + 1) * per); i++) m = Math.max(m, Math.abs(xs[i]))
    return m
  })
}
/** Dark → blue → orange → yellow for 0…1. */
const heatRgb = (v: number): [number, number, number] => [Math.min(1, Math.max(0, 1.9 * v - 0.5)), Math.min(1, Math.max(0, 1.6 * v - 0.75)), Math.min(1, Math.max(0, 1.4 * v)) * (v < 0.5 ? 1 : 2 - 2 * v)]

/** Waveform scope with a ± envelope trace and a cursor. */
function waveScope(scene: THREE.Object3D, at: V3, w: number, h: number, cols: number, divs: [number, number]) {
  const plot = scope(scene, w, h, { divs: [divs[0], 2] })
  plot.group.position.set(...at)
  const up = plot.trace(WAVE_C, { samples: cols, radius: 0.04 })
  const dn = plot.trace(WAVE_C, { samples: cols, radius: 0.04 })
  const cursor = cursorBar(plot, LABEL, 0.06)
  return {
    plot,
    cursor,
    draw(env: readonly number[], k: number, full: number) {
      const us = env.slice(0, k).map((_, i) => i / (env.length - 1))
      up.points(us, env.slice(0, k).map((v) => Math.min(1, v / full) * (h / 2)))
      dn.points(us, env.slice(0, k).map((v) => -Math.min(1, v / full) * (h / 2)))
    },
  }
}

/** Small robot on a floor with a "listening" light. */
function robotCorner(scene: THREE.Object3D, at: V3, k: number, half: [number, number]) {
  const g = floorView(scene, at, k, -0.62)
  floorMat(g, [-half[0], half[0]], [-half[1], half[1]])
  const ghost = diffBot(g, { ghost: GREY })
  const bot = diffBot(g)
  for (const b of [bot, ghost]) b.group.scale.setScalar(1.5)
  const lamp = glowMat(GREY, 0.3)
  add(bot.group, mesh(new THREE.SphereGeometry(0.012, 14, 10), lamp), [-0.05, 0, 0.09]).castShadow = false
  return { g, bot, ghost, lamp }
}

// --- Keyword spotting: 1 s windows every 100 ms → small net → smoothed score vs threshold; misses vs false wakes. ---

const KS = { x: -4.4, w: 24, cols: 125, rows: 20 }
const KS_WAVE_Y = 2.6
const KS_SPEC_Y = -0.7
const KS_SCORE = { y: -4.7, h: 2.0 }
const KS_TH = Array.from({ length: 19 }, (_, i) => 0.05 + i * 0.05)
const ksParams = (p: Params) => ({ snr: n(p, 'snr'), th: n(p, 'th'), take: n(p, 'take') })
type KsQ = ReturnType<typeof ksParams>
const ksStream = memoBy(
  (q: KsQ) => `${q.take}|${q.snr}`,
  (q: KsQ) => {
    const S = kwsStream(q.take, q.snr)
    const per = S.spec.amps.length / KS.cols
    const img = new Float32Array(KS.cols * KS.rows)
    for (let c = 0; c < KS.cols; c++)
      for (let r = 0; r < KS.rows; r++) {
        let e = 0
        for (let f = Math.floor(c * per); f < Math.floor((c + 1) * per); f++) e += S.spec.amps[f][2 * r + 1] ** 2 + S.spec.amps[f][2 * r + 2] ** 2
        img[(KS.rows - 1 - r) * KS.cols + c] = 10 * Math.log10(e / per + 1e-12)
      }
    const top = Math.max(...img)
    const spec = img.map((v) => Math.max(0, 1 + (v - top) / 50))
    return { ...S, env: envelope(S.samples, 300), spec, curve: kwsTradeoff(S.times, S.wake, S.spoken, KS_TH) }
  },
)
const ksDetect = memoBy(
  (q: KsQ) => `${q.take}|${q.snr}|${q.th}`,
  (q: KsQ) => {
    const S = ksStream(q)
    return kwsDetect(S.times, S.wake, S.spoken, q.th)
  },
)
const KWS_COST = (() => {
  const real = deployCost(TINY_MODELS.kws, 8, ESP)
  return { realS: real.seconds, featLoad: SPECTRO_MACS_PER_S / ESP.f32 }
})()

export const speechWakeWordsKeywordSpotting: Lesson = {
  id: 'speech-wake-words-keyword-spotting',
  title: 'Keyword spotting',
  tagline: 'An always-on microphone, a tiny net looking at the last second of sound ten times a second, and one number to pick: how sure it must be before the robot wakes up',
  formula: (p) => {
    const q = ksParams(p)
    return `10 ms frames → 8 band energies (log) · last 1 s = 8 slices × 8 bands = 64 features → 64-12-3 net, every 100 ms · score = mean of last 3 · wake when score ≥ ${q.th.toFixed(2)}, then deaf 1 s`
  },
  legend: [
    { color: WAVE_C, label: 'Microphone signal (envelope)', shape: 'dot' },
    { color: HEAT, label: 'Spectrogram: loud frequencies glow', shape: 'dot' },
    { color: POWER, label: 'Wake word caught', shape: 'dot' },
    { color: HIGH_V, label: 'Missed wake word / false wake', shape: 'dot' },
  ],
  points: [
    'A robot that answers to "hey robo" cannot send all its audio to a server. A small net on the microcontroller listens all the time and only wakes the rest of the system when it hears the one word. Here the words are synthetic, built from vowel resonances (formants) and hiss, at 8 kHz, so the whole pipeline fits in the lesson.',
    'Every 10 ms the firmware takes 80 samples, runs a DFT (see Sensors, Microphone and sound) and adds up the energy in 8 bands, narrow at low pitch and wide at high pitch, like the ear (mel-like bands; real systems take one more step to MFCCs). That is the spectrogram. Every 100 ms the last second is boiled down to 8 time slices × 8 bands = 64 numbers, volume removed, and fed to a 64-12-3 net: wake word, other word, or silence.',
    'The net was trained once on windows cut from other recordings, by other voices, in different noise. A window counts as the wake word only if the whole word is inside it, so "rainbow" and "robot" sound close but must not fire. The score is the net\'s wake probability, averaged over three windows so one odd window does not fire it. After a wake the detector goes deaf for a second.',
    'The threshold is a trade. Low: every word that sounds a bit like "hey robo" wakes the robot (false wakes; a few per recording is hundreds per hour). High: real wake words get missed, more so in noise. Products tune for about one false wake a day and accept some misses. On the chip the features cost ~8 % of an ESP32; a real keyword model (DS-CNN, 38 k weights) takes 180 ms at int8, too slow for 100 ms hops, so it runs on an ESP32-S3 or every 200 ms (see TinyML, Quantization).',
  ],
  controls: [
    { kind: 'slider', key: 'snr', label: 'Speech above noise', min: 0, max: 30, step: 5, initial: 15, format: dbText },
    { kind: 'slider', key: 'th', label: 'Wake threshold', min: 0.1, max: 0.95, step: 0.05, initial: 0.5, format: (v: number) => v.toFixed(2) },
    { kind: 'slider', key: 'take', label: 'Recording', min: 1, max: 6, step: 1, initial: 1, format: (v: number) => `#${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const left = KS.x - KS.w / 2
    const wave = waveScope(scene, [KS.x, KS_WAVE_Y, 0], KS.w, 1.6, 300, [12, 2])
    const wordTags = Array.from({ length: 10 }, () => liveLabel(scene, [0, KS_WAVE_Y + 1.45, 0.3], { size: 0.24 }))
    const pitch = KS.w / KS.cols
    const grid = pixelGrid(scene, [KS.x, KS_SPEC_Y, 0], KS.cols, KS.rows, pitch)
    addLabel(scene, '4 kHz', [left - 0.35, KS_SPEC_Y + (KS.rows * pitch) / 2 - 0.15, 0.3], GREY, 0.24, 'right')
    addLabel(scene, '0', [left - 0.35, KS_SPEC_Y - (KS.rows * pitch) / 2 + 0.15, 0.3], GREY, 0.24, 'right')
    addLabel(scene, 'mic', [left - 0.35, KS_WAVE_Y, 0.3], GREY, 0.24, 'right')
    const specCursor = flatBox(scene, [0.06, KS.rows * pitch, 0.05], glowMat(LABEL, 1.2), [0, KS_SPEC_Y, 0.2])
    const sc = scope(scene, KS.w, KS_SCORE.h, { divs: [12, 4], zeroAt: 0 })
    sc.group.position.set(KS.x, KS_SCORE.y, 0)
    const scoreTr = sc.trace(RING, { samples: 120, radius: 0.05 })
    const scoreCursor = cursorBar(sc, LABEL, 0.06)
    const thLine = flatBox(sc.group, [KS.w, 0.05, 0.05], glowMat(HEAT, 1.2), [0, 0, 0.3])
    addLabel(scene, 'wake score', [left - 0.35, KS_SCORE.y + 0.5, 0.3], GREY, 0.24, 'right')
    const thTag = liveLabel(scene, [left - 0.35, KS_SCORE.y - 0.2, 0.3], { size: 0.24, align: 'right' })
    addLabel(scene, '0 s', [left, KS_SCORE.y - KS_SCORE.h / 2 - 0.85, 0.3], GREY, 0.24, 'left')
    addLabel(scene, `${KWS_STREAM_S} s`, [left + KS.w, KS_SCORE.y - KS_SCORE.h / 2 - 0.85, 0.3], GREY, 0.24, 'right')
    const clock = liveLabel(scene, [KS.x, KS_SCORE.y - KS_SCORE.h / 2 - 0.85, 0.3], { size: 0.24, color: GREY })
    const marks = Array.from({ length: 12 }, () => liveLabel(sc.group, [0, KS_SCORE.h / 2 + 0.05, 0.4], { size: 0.3 }))
    const R = robotCorner(scene, [13.4, 0.9, 0], 10, [0.32, 0.2])
    const awake = liveLabel(scene, [13.4, -1.6, 0.3], { size: 0.3 })
    const T = { x: 13.4, y: KS_SCORE.y, w: 5.6 }
    const trade = scope(scene, T.w, KS_SCORE.h, { divs: [6, 4], zeroAt: 0 })
    trade.group.position.set(T.x, T.y, 0)
    const missTr = trade.trace(HIGH_V, { samples: KS_TH.length, radius: 0.05 })
    const falseTr = trade.trace(HEAT, { samples: KS_TH.length, radius: 0.05 })
    const thCursor = cursorBar(trade, LABEL, 0.05)
    addLabel(scene, 'misses', [T.x - 0.2, T.y + KS_SCORE.h / 2 + 0.85, 0.3], HIGH_V, 0.26, 'right')
    addLabel(scene, 'false wakes', [T.x + 0.2, T.y + KS_SCORE.h / 2 + 0.85, 0.3], HEAT, 0.26, 'left')
    addLabel(scene, 'threshold 0 … 1', [T.x, T.y - KS_SCORE.h / 2 - 0.85, 0.3], GREY, 0.24)
    const st = { key: '', t: 0, k: -1, th: 0, head: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = ksParams(p)
        const key = `${q.take}|${q.snr}`
        const S = ksStream(q)
        const D = ksDetect(q)
        if (key !== st.key) {
          Object.assign(st, { key, t: 0, k: -1 })
          S.spoken.forEach((w, i) => {
            wordTags[i].group.position.x = left + (((w.at + w.end) / 2) / KWS_STREAM_S) * KS.w
            wordTags[i].set(w.word === WAKE_WORD ? '"hey robo"' : `"${w.word}"`, w.word === WAKE_WORD ? LABEL : GREY)
          })
          const top = Math.max(1, ...S.curve.map((c) => Math.max(c.misses, c.falses)))
          const us = S.curve.map((c) => c.th)
          missTr.points(us, S.curve.map((c) => (c.misses / top) * KS_SCORE.h - KS_SCORE.h / 2))
          falseTr.points(us, S.curve.map((c) => (c.falses / top) * KS_SCORE.h - KS_SCORE.h / 2))
        }
        st.t = (st.t + dt) % (KWS_STREAM_S + 1.5)
        const t = Math.min(KWS_STREAM_S, st.t)
        const k = Math.round((t / KWS_STREAM_S) * KS.cols)
        thLine.position.y = q.th * KS_SCORE.h - KS_SCORE.h / 2
        thTag.set(`threshold ${q.th.toFixed(2)}`, HEAT)
        thCursor(q.th)
        const u = t / KWS_STREAM_S
        wave.cursor(u)
        scoreCursor(u)
        specCursor.position.x = left + u * KS.w
        const recent = D.fires.filter((f) => f <= t && f > t - 1.5)
        const lit = recent.length > 0
        const falseLit = lit && D.falses.includes(recent[recent.length - 1])
        setGlow(R.lamp, lit ? (falseLit ? HIGH_V : POWER) : GREY, lit ? 2 : 0.3)
        awake.set(lit ? (falseLit ? 'woke up for nothing' : 'awake: listening for a command') : 'asleep, spotting keywords', lit ? (falseLit ? HIGH_V : POWER) : GREY)
        st.head = glideAngle(dt, st.head, lit ? -Math.PI / 2 : 0, 4)
        R.bot.set({ x: 0, y: 0, th: st.head })
        R.ghost.group.visible = false
        if (k === st.k && q.th === st.th) return
        st.k = k
        st.th = q.th
        wave.draw(S.env, Math.max(2, Math.round((t / KWS_STREAM_S) * S.env.length)), 0.9)
        for (let c = 0; c < KS.cols; c++)
          for (let r = 0; r < KS.rows; r++) {
            const i = r * KS.cols + c
            const [cr, cg, cb] = c < k ? heatRgb(S.spec[i]) : [0.02, 0.02, 0.03]
            grid.set(i, cr, cg, cb)
          }
        grid.commit()
        const shown = S.times.map((tt, i) => ({ tt, s: D.score[i] })).filter((x) => x.tt <= t)
        if (shown.length > 1) scoreTr.points(shown.map((x) => x.tt / KWS_STREAM_S), shown.map((x) => x.s * KS_SCORE.h - KS_SCORE.h / 2))
        else scoreTr.points([0, 0], [-KS_SCORE.h / 2, -KS_SCORE.h / 2])
        const wakes = S.spoken.filter((w) => w.word === WAKE_WORD)
        const items = [
          ...D.fires.map((f) => ({ at: f, text: D.falses.includes(f) ? '!' : '✓', c: D.falses.includes(f) ? HIGH_V : POWER })),
          ...wakes.flatMap((w, i) => (D.hit[i] ? [] : [{ at: w.end + 1, text: '✗', c: HIGH_V }])),
        ].filter((m) => m.at <= t)
        marks.forEach((m, i) => {
          const it = items[i]
          m.group.visible = !!it
          if (!it) return
          m.group.position.x = (it.at / KWS_STREAM_S - 0.5) * KS.w
          m.set(it.text, it.c)
        })
        clock.set(`${t.toFixed(1)} s, real time`, GREY)
        const hits = D.hit.filter(Boolean).length
        status.set(`Keyword spotting · "hey robo" · speech ${q.snr} dB above noise · threshold ${q.th.toFixed(2)}`, LABEL)
        sub.set(`recording #${q.take}: ${D.wakes} wake words among ${S.spoken.length - D.wakes} other words · net sees the last 1 s every 100 ms`, GREY)
        event.set(
          `caught ${hits} of ${D.wakes} · ${D.falses.length} false wake${D.falses.length === 1 ? '' : 's'}${D.misses && !D.falses.length ? ': raise the volume or lower the threshold' : D.falses.length && !D.misses ? ': raise the threshold' : ''}`,
          D.misses === 0 && D.falses.length === 0 ? POWER : D.misses + D.falses.length <= 1 ? HEAT : HIGH_V,
        )
      },
      readouts: (p) => {
        const q = ksParams(p)
        const D = ksDetect(q)
        const perHour = Math.round((D.falses.length * 3600) / KWS_STREAM_S)
        return [
          { label: 'Wake words caught', value: `${D.wakes - D.misses} of ${D.wakes}`, tone: toneOf(D.misses === 0, D.misses <= 1) },
          { label: 'False wakes', value: `${D.falses.length} (≈ ${perHour} per hour)`, tone: toneOf(D.falses.length === 0, D.falses.length <= 1) },
          { label: 'This net / ESP32', value: `${mlpMacs(kwsNet())} MACs, features ${pct(KWS_COST.featLoad)} CPU` },
          { label: 'DS-CNN KWS, ESP32 int8', value: `${msText(KWS_COST.realS)} per window`, tone: KWS_COST.realS < 0.1 ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Voice commands: find the words, classify each, parse ACTION [COUNT], act only when every word is sure enough. ---

const VC_CMDS = {
  'forward two': '"forward two"',
  'um left': '"um… left"',
  'back three': '"back three"',
  'right two': '"right two"',
  stop: '"stop"',
  'please forward one': '"please forward one"',
}
const VC_WAVE = { x: -9.0, y: 2.6, w: 15.6, h: 1.6 }
const VC_FLOOR = { at: [11.6, -2.8, 0] as V3, k: 6.2, half: [0.9, 0.6] as [number, number] }
const VC_HOLD = { listen: 0.6, drive: 2.2, rest: 1.6 }
const vcParams = (p: Params) => ({ cmd: pick(VC_CMDS, p.cmd, 'forward two'), snr: n(p, 'snr'), th: n(p, 'th'), voice: n(p, 'voice') })
type VcQ = ReturnType<typeof vcParams>
const vcHear = memoBy(
  (q: VcQ) => `${q.cmd}|${q.snr}|${q.voice}`,
  (q: VcQ) => {
    const A = sayCommand(q.cmd, q.voice, q.snr)
    const H = hearWords(A.samples)
    return { ...A, ...H, seconds: A.samples.length / SPEECH_HZ, env: envelope(A.samples, 200), truth: parseCommand(q.cmd.split(' ').map((w) => ({ word: CMD_CLASSES.includes(w) ? w : 'other', p: 1 })), 0).intent }
  },
)
const vcParse = (q: VcQ) => parseCommand(vcHear(q).heard, q.th)
const sameIntent = (a: Intent | null, b: Intent | null) => !!a && !!b && a.action === b.action && a.amount === b.amount
const intentText = (i: Intent) => {
  const m = intentMotion(i)
  return i.action === 'stop' ? 'stop the motors' : m.dist ? `drive ${m.dist > 0 ? 'forward' : 'back'} ${Math.abs(m.dist).toFixed(2)} m` : `turn ${i.action} ${i.amount * 90}°`
}
const CMD_NET_MACS = (() => mlpMacs(cmdNet()))

export const speechWakeWordsVoiceCommands: Lesson = {
  id: 'speech-wake-words-voice-commands',
  title: 'Voice commands',
  tagline: 'Once awake, the robot splits what you said into words, names each from a small vocabulary, fills in the action and the count, and asks you to say it again when it is not sure',
  formula: (p) => {
    const q = vcParams(p)
    return `words = runs of loud frames (voice activity) · each: 0.6 s → 64 features → 64-14-9 net · grammar: ACTION (forward | back | left | right | stop) [COUNT (one | two | three)], fillers dropped · act if every word ≥ ${q.th.toFixed(2)}, else "say again?"`
  },
  legend: [
    { color: WAVE_C, label: 'Microphone signal (envelope)', shape: 'dot' },
    { color: POWER, label: 'Word recognised, sure enough', shape: 'dot' },
    { color: HEAT, label: 'Word under the threshold', shape: 'dot' },
    { color: GREY, label: 'Filler ("other"), ignored', shape: 'dot' },
  ],
  points: [
    'After the wake word (previous lesson) the robot listens for a command. The trick that makes this fit on a microcontroller is a closed vocabulary: five actions, three numbers and a catch-all "other" class for anything else. Nine outputs instead of a whole language.',
    'First, voice activity detection: frames clearly louder than the quietest 10 % of the recording are speech, short gaps (the silent closure in "back" or "stop") are bridged, and each run is one word. Each word is centred in a 0.6 s window and turned into the same 64 band-energy features as the wake word; a 64-14-9 net names it. It was trained on words cut the same way from other speakers\' three-word phrases, neighbours and noise included.',
    'Then the grammar: an action, optionally followed by a count; "um" and "please" fall in the other class and are dropped. That turns words into a robot intent with slots (action = forward, count = two → 0.5 m). A missing count means one, and a phrase that does not fit the grammar is rejected rather than guessed.',
    'Confidence decides. The intent is only as sure as its least sure word. Under the threshold the robot says "say again?" and does nothing, which is annoying but safe. Set the threshold low in a noisy room and it will sometimes drive off doing the wrong thing with total conviction. On the chip this is cheap: the spectrogram is the same one the wake-word net uses, and the net is about a thousand multiply-adds per word.',
  ],
  controls: [
    { kind: 'choice', key: 'cmd', options: opts(VC_CMDS), initial: 'forward two' },
    { kind: 'slider', key: 'snr', label: 'Speech above noise', min: 0, max: 30, step: 5, initial: 20, format: dbText },
    { kind: 'slider', key: 'th', label: 'Confidence needed', min: 0.3, max: 0.95, step: 0.05, initial: 0.7, format: (v: number) => v.toFixed(2) },
    { kind: 'slider', key: 'voice', label: 'Speaker', min: 1, max: 6, step: 1, initial: 1, format: (v: number) => `#${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const W = VC_WAVE
    const left = W.x - W.w / 2
    const wave = waveScope(scene, [W.x, W.y, 0], W.w, W.h, 200, [10, 2])
    addLabel(scene, 'mic', [left - 0.35, W.y, 0.3], GREY, 0.24, 'right')
    const segMats = Array.from({ length: 6 }, () => glowMat(GREY, 0.5))
    const segs = segMats.map((m) => flatBox(wave.plot.group, [1, 0.16, 0.04], m, [0, -W.h / 2 - 0.85, 0.12]))
    const segTags = segMats.map(() => liveLabel(wave.plot.group, [0, -W.h / 2 - 1.35, 0.3], { size: 0.28 }))
    const BX = { x: -13.4, y: -1.0 }
    addLabel(scene, 'net output for the last word', [BX.x - 2.4, BX.y + 0.75, 0.3], GREY, 0.27, 'left')
    const bars = countBars(scene, [BX.x, BX.y, 0], CMD_CLASSES, 5.4, { row: 0.62, size: 0.27 })
    const PX = -4.0
    const parseLines = [0, 1, 2, 3].map((i) => liveLabel(scene, [PX, -1.2 - i * 1.05, 0.3], { size: i === 3 ? 0.36 : 0.32, align: 'left' }))
    addLabel(scene, 'grammar: ACTION [COUNT]', [PX, -0.2, 0.3], GREY, 0.27, 'left')
    const R = robotCorner(scene, VC_FLOOR.at, VC_FLOOR.k, VC_FLOOR.half)
    const said = liveLabel(scene, [VC_FLOOR.at[0], 1.6, 0.3], { size: 0.34 })
    const st = { key: '', t: 0, shown: -2 }
    const START: Pose = { x: 0, y: 0, th: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = vcParams(p)
        const H = vcHear(q)
        const P = vcParse(q)
        const key = `${q.cmd}|${q.snr}|${q.voice}|${q.th}`
        if (key !== st.key) {
          Object.assign(st, { key, t: 0, shown: -2 })
          segs.forEach((s, i) => {
            const h = H.heard[i]
            s.visible = segTags[i].group.visible = !!h
            if (!h) return
            const a = (h.from * FRAME_S) / H.seconds
            const b = ((h.to + 1) * FRAME_S) / H.seconds
            s.scale.x = (b - a) * W.w
            s.position.x = ((a + b) / 2 - 0.5) * W.w
            segTags[i].group.position.x = s.position.x
          })
          const m = intentMotion(P.intent)
          R.ghost.group.visible = !!P.intent && (m.dist !== 0 || m.turn !== 0)
          R.ghost.set({ x: m.dist, y: 0, th: m.turn })
        }
        const total = H.seconds + VC_HOLD.listen + VC_HOLD.drive + VC_HOLD.rest
        st.t = (st.t + dt) % total
        const t = st.t
        const tAudio = Math.min(t, H.seconds)
        const u = tAudio / H.seconds
        wave.cursor(t <= H.seconds ? u : null)
        wave.draw(H.env, Math.max(2, Math.round(u * H.env.length)), 0.9)
        const done = H.heard.filter((h) => (h.to + 1) * FRAME_S <= tAudio)
        H.heard.forEach((h, i) => {
          const on = i < done.length
          const c = h.word === 'other' ? GREY : h.p >= q.th ? POWER : HEAT
          setGlow(segMats[i], on ? c : '#3a3d44', on ? 0.6 : 0.2)
          segTags[i].set(on ? `${h.word} ${pct(h.p)}` : '…', on ? c : GREY)
        })
        const cur = done.length - 1
        if (cur !== st.shown) {
          st.shown = cur
          const h = done[cur]
          if (h) bars.set(h.probs, h.probs.map((v) => v.toFixed(2)), h.probs.map((_, j) => (j === h.k ? (h.word === 'other' ? GREY : h.p >= q.th ? POWER : HEAT) : GREY)), 1)
          else bars.set(CMD_CLASSES.map(() => 0), CMD_CLASSES.map(() => ''), CMD_CLASSES.map(() => GREY), 1)
        }
        const decided = t > H.seconds + VC_HOLD.listen * 0.5
        const right = sameIntent(P.intent, H.truth)
        const a = P.used[0]
        const c = P.used[1]
        parseLines[0].set(a ? `ACTION  ${a.word}  ${pct(a.p)}` : 'ACTION  (none)', !decided ? GREY : a && a.p >= q.th ? POWER : HEAT)
        parseLines[1].set(c ? `COUNT  ${c.word}  ${pct(c.p)}` : 'COUNT  (default one)', !decided || !a ? GREY : !c || c.p >= q.th ? POWER : HEAT)
        parseLines[2].set(!decided ? 'listening…' : P.intent || !P.why ? `intent conf. ${pct(P.conf)} (needs ${pct(q.th)})` : P.why, P.intent || !decided ? GREY : HEAT)
        parseLines[3].set(
          !decided ? '' : P.intent ? `→ ${intentText(P.intent)}${right ? '' : ': WRONG'}` : '→ "Say again?"',
          !P.intent ? HEAT : right ? POWER : HIGH_V,
        )
        said.set(`you: "${q.cmd}"`, LABEL)
        const m = intentMotion(P.intent)
        const tm = Math.min(1, Math.max(0, (t - H.seconds - VC_HOLD.listen) / VC_HOLD.drive))
        const e = tm * tm * (3 - 2 * tm)
        const pose: Pose = m.turn ? { ...START, th: m.turn * e } : { ...START, x: m.dist * e }
        R.bot.set(pose, m.dist * e - (m.turn * e * 0.06), m.dist * e + m.turn * e * 0.06)
        setGlow(R.lamp, P.intent ? (right ? POWER : HIGH_V) : decided ? HEAT : POWER, decided || t < H.seconds ? 1.6 : 0.3)
        status.set(`Voice commands · "${q.cmd}" · speech ${q.snr} dB above noise · speaker #${q.voice}`, LABEL)
        sub.set(`${H.heard.length} word${H.heard.length === 1 ? '' : 's'} found · 9-word vocabulary (5 actions, 3 counts, other) · one step = ${STEP_M} m, one turn = 90°`, GREY)
        event.set(
          P.intent ? (right ? `understood: ${intentText(P.intent)}` : `misheard and confident: ${intentText(P.intent)} instead of ${H.truth ? intentText(H.truth) : '?'}`) : `asks again: ${P.why}`,
          P.intent ? (right ? POWER : HIGH_V) : HEAT,
        )
      },
      readouts: (p) => {
        const q = vcParams(p)
        const H = vcHear(q)
        const P = vcParse(q)
        const right = sameIntent(P.intent, H.truth)
        return [
          { label: 'Heard', value: H.heard.map((h) => h.word).join(' ') || '(nothing)' },
          { label: 'Least sure word', value: `${pct(P.conf)} vs ${pct(q.th)}`, tone: toneOf(P.conf >= q.th, P.conf >= q.th - 0.15) },
          { label: 'Robot does', value: P.intent ? intentText(P.intent) : 'asks "say again?"', tone: P.intent ? (right ? 'ok' : 'bad') : 'warn' },
          { label: 'ESP32 per word', value: `${CMD_NET_MACS()} MACs ≈ ${Math.round((CMD_NET_MACS() / ESP.int8) * 1e6)} µs` },
        ]
      },
    }
  },
}
