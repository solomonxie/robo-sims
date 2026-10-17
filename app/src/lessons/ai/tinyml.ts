import * as THREE from 'three/webgpu'
import {
  ACCELERATORS, FEATURE_MACS, FEATURE_NAMES, FIRMWARE_FLASH, FLASH_BUDGET, GESTURES, GESTURE_KEYS, IMU_HZ, Mlp, QGrain, SRAM_BUDGET, SYSTEM_SRAM, TINY_MODELS, WINDOW_N,
  actRanges, argmax, confusion, confusionAccuracy, deployCost, gestureFeatures, gestureNet, gestureSet, gestureWindow, mlpAccuracy, mlpArena, mlpForward, mlpInit, mlpMacs, mlpOut, mlpOutQ, mlpParams, mlpTrain,
  once, quantizeMlp, spanHistogram, TOY_SPAN, toySet,
} from '../../core/physics'
import { bytesText, msText, pct } from '../../core/units'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { CLASS_COLORS, DATA_COLOR, GREY, HEAT, HIGH_V, LABEL, POWER, RING, WEIGHT_COLORS, addLabel, classField, countBars, esp32Board, histChart, liveLabel, memoBy, memoryMap, netDiagram, scope, statusHeader } from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const VIEW = { center: [-0.6, 1.4, 0] as V3, radius: 64, polar: Math.PI / 2, azimuth: 0 }
const usText = (s: number) => (s < 1e-3 ? `${+(s * 1e6).toFixed(s < 1e-5 ? 1 : 0)} µs` : s < 1 ? msText(s) : `${+s.toFixed(1)} s`)
const SIGN_RGB = { pos: [0.3, 0.65, 1] as [number, number, number], neg: [1, 0.42, 0.35] as [number, number, number] }
const CHIPS = { esp32: ACCELERATORS.esp32, esp32s3: ACCELERATORS.esp32s3 }

/** Board, flash + SRAM bars and timing bars along the bottom. */
function deployPanel(scene: THREE.Scene, memRows: string[], timeRows: string[], y = -6.4) {
  esp32Board(scene, [-15.6, y - 0.4, 0], 0.17)
  addLabel(scene, 'on the ESP32', [-15.6, y + 1.5, 0.3], GREY, 0.26)
  const mem = memoryMap(scene, [-9.6, y + 0.5, 0], 7, memRows, { row: 0.62, size: 0.26 })
  const time = countBars(scene, [7.4, y + 0.5, 0], timeRows, 5.4, { row: 0.62, size: 0.26 })
  return { mem, time }
}

// --- Quantization: weights as b-bit integers on a scale; memory drops 4×, the boundary barely moves until very few bits. ---

const QZ_GRAINS = { channel: 'One scale per neuron', tensor: 'One scale per layer' }
const QZ_MODELS = { kws: 'Keyword spotter', person: 'Person detector 96 × 96', mobilenet: 'MobileNet v2 224' }
const QZ_DATA = toySet('moons', 200, 0.12, 3)
const QZ_BINS = 48
const QZ_TILES = 30
const qzBase = once(() => {
    const net = mlpTrain(mlpInit([2, 10, 10, 1], ['tanh', 'tanh', 'sigmoid'], 4), QZ_DATA, { lr: 0.3, epochs: 150, batch: 20, loss: 'bce', l2: 0.002, snaps: 2 }).net
    const weights = net.flatMap((L) => L.W.flat())
    const wm = Math.max(...weights.map(Math.abs))
    const acc = (f: (x: number[]) => number) => QZ_DATA.filter((d) => f(d.x) > 0.5 === d.t[0] > 0.5).length / QZ_DATA.length
    return { net, weights, wm, ranges: actRanges(net, QZ_DATA), hist: spanHistogram(weights, -wm, wm, QZ_BINS), accF: mlpAccuracy(net, QZ_DATA), acc }
})
const qzParams = (p: Params) => ({ bits: n(p, 'bits'), grain: pick(QZ_GRAINS, p.grain, 'channel') as QGrain, model: pick(QZ_MODELS, p.model, 'person') })
type QzQ = ReturnType<typeof qzParams>
const qzRun = memoBy(
  (q: QzQ) => `${q.bits}|${q.grain}`,
  (q: QzQ) => {
    const B = qzBase()
    const Q = quantizeMlp(B.net, q.bits, q.grain)
    const out = (x: number[]) => mlpOutQ(Q.net, x, B.ranges, 8)[0]
    const field = new Float32Array(QZ_TILES * QZ_TILES)
    for (let r = 0; r < QZ_TILES; r++) for (let c = 0; c < QZ_TILES; c++) field[r * QZ_TILES + c] = out([-TOY_SPAN + ((c + 0.5) / QZ_TILES) * 2 * TOY_SPAN, TOY_SPAN - ((r + 0.5) / QZ_TILES) * 2 * TOY_SPAN])
    const qw = Q.net.flatMap((L) => L.W.flat())
    const levels = new Set(qw.map((v) => v.toFixed(6))).size
    const flips = QZ_DATA.filter((d) => out(d.x) > 0.5 !== mlpOut(B.net, d.x)[0] > 0.5).length
    return { ...Q, field, hist: spanHistogram(qw, -B.wm, B.wm, QZ_BINS), levels, flips, accQ: B.acc(out) }
  },
)
const qzDeploy = (q: QzQ) => {
  const m = TINY_MODELS[q.model]
  return { m, f: deployCost(m, 32, CHIPS.esp32), i: deployCost(m, q.bits, CHIPS.esp32), fs3: deployCost(m, 32, CHIPS.esp32s3), is3: deployCost(m, q.bits, CHIPS.esp32s3) }
}

export const tinymlQuantization: Lesson = {
  id: 'tinyml-quantization',
  title: 'Quantization',
  tagline: 'Store every weight as a small integer times one scale. int8 is 4× smaller and much faster on a microcontroller, and the net hardly notices; at 2 or 3 bits it starts to break',
  formula: (p) => {
    const q = qzParams(p)
    return `w ≈ s · q, q integer in ±${2 ** (q.bits - 1) - 1} · s = max|w| ÷ ${2 ** (q.bits - 1) - 1} (${q.grain === 'channel' ? 'per neuron' : 'per layer'}) · activations: a ≈ s (q − z), 8 bits · y = sₐ s_w Σ (qₐ − z) q_w + b`
  },
  legend: [
    { color: WEIGHT_COLORS.pos, label: 'Positive weights (net and histogram)', shape: 'dot' },
    { color: WEIGHT_COLORS.neg, label: 'Negative weights', shape: 'dot' },
    { color: CLASS_COLORS[1], label: 'Class 1 region of the quantized net', shape: 'dot' },
    { color: GREY, label: 'Firmware / system memory', shape: 'dot' },
    { color: RING, label: 'Tensor arena (activations) in SRAM', shape: 'dot' },
  ],
  points: [
    'A trained net is a list of float32 weights: 4 bytes each. Post-training quantization maps each weight w to an integer q with w ≈ s · q. For int8, s = max|w| ÷ 127, so the biggest weight becomes ±127 and the rest round to the nearest step. The histogram shows it: the smooth spread of floats collapses onto evenly spaced spikes.',
    'Activations are quantized too, on ranges measured by running some calibration data through the net. They are not centred on zero, so they get a zero-point z: a ≈ s (q − z). A layer is then integer multiply-adds into a 32-bit sum, scaled once at the end. Tests check that int8 dot product against float.',
    'Each step rounds a weight by up to half a step. At 8 bits that is under 0.4 % of the largest weight and the boundary does not move. At 4 bits there are 15 levels; at 2 bits only three (−s, 0, +s) and the net falls apart. One scale per neuron (per channel) keeps small rows from rounding to zero when one row has big weights.',
    'The payoff is the bottom row. Weights live in flash; the tensor arena (the activations in flight) must fit in about 320 KB of SRAM beside Wi-Fi and the stack. A float person detector needs 544 KB of arena and spills into slow PSRAM; int8 needs 136 KB. And int8 math runs about 4× faster on an ESP32, 7× on an ESP32-S3 with its vector unit. Below 8 bits weights are packed in flash but unpacked to compute, so the speed stays at int8. Memory regions: see Microcontrollers, Memory and storage; on a camera: Object detection, Running on an ESP32-CAM.',
  ],
  controls: [
    { kind: 'slider', key: 'bits', label: 'Weight bits', min: 2, max: 8, step: 1, initial: 8, format: (v: number) => `int${v}` },
    { kind: 'choice', key: 'grain', options: opts(QZ_GRAINS), initial: 'channel' },
    { kind: 'choice', key: 'model', options: opts(QZ_MODELS), initial: 'person' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const net = netDiagram(scene, [2, 10, 10, 1], [-13.4, -0.4, 0], 5.4, 6.2, { r: 0.3 })
    addLabel(net.group, 'x1', [net.pos(0, 0)[0] - 0.7, net.pos(0, 0)[1], 0], LABEL, 0.3)
    addLabel(net.group, 'x2', [net.pos(0, 1)[0] - 0.7, net.pos(0, 1)[1], 0], LABEL, 0.3)
    addLabel(net.group, 'y', [net.pos(3, 0)[0] + 0.6, net.pos(3, 0)[1], 0], LABEL, 0.3)
    addLabel(scene, 'weights of the quantized net', [-13.4, -4.4, 0.3], GREY, 0.26)
    const field = classField(scene, [-2.4, -0.2, 0], QZ_TILES, 7.4, -TOY_SPAN, TOY_SPAN, 220)
    const fieldTag = liveLabel(scene, [-2.4, 4.0, 0.3], { size: 0.28 })
    const H = { x: 5.4, w: 10.4, h: 2.0 }
    const B = qzBase()
    const ends: [string, string] = [(-B.wm).toFixed(2), B.wm.toFixed(2)]
    const histF = histChart(scene, [H.x, 1.6, 0], H.w, H.h, QZ_BINS, { left: ends[0], right: ends[1], markers: 0 })
    const histQ = histChart(scene, [H.x, -2.9, 0], H.w, H.h, QZ_BINS, { left: ends[0], right: ends[1], markers: 0 })
    addLabel(scene, `float32 weights (${B.weights.length})`, [H.x, 1.6 + H.h + 0.45, 0.3], LABEL, 0.28, 'left')
    const qTag = liveLabel(scene, [H.x, -2.9 + H.h + 0.45, 0.3], { size: 0.28, align: 'left' })
    histF.set(B.hist, (i) => (i < QZ_BINS / 2 ? SIGN_RGB.neg : SIGN_RGB.pos))
    const D = deployPanel(scene, ['flash, float32', 'flash, int', 'SRAM, float32', 'SRAM, int'], ['ESP32 float32', 'ESP32 int', 'S3 float32', 'S3 int'])
    const deployTag = liveLabel(scene, [-9.6, -5.0, 0.3], { size: 0.27, align: 'left' })
    addLabel(scene, 'time per inference', [7.4, -5.0, 0.3], GREY, 0.27, 'left')
    const st = { key: '' }
    return {
      scene,
      view: VIEW,
      frame(_dt, p) {
        const q = qzParams(p)
        const key = `${q.bits}|${q.grain}|${q.model}`
        if (key === st.key) return
        st.key = key
        const R = qzRun(q)
        net.set(R.net, undefined, B.wm)
        field.paint(R.field)
        field.samples(QZ_DATA)
        field.probe(null)
        fieldTag.set(`int${q.bits} net: ${pct(R.accQ)} right (float ${pct(B.accF)})`, R.accQ >= B.accF - 0.01 ? POWER : R.accQ > 0.8 ? HEAT : HIGH_V)
        histQ.set(R.hist, (i) => (i < QZ_BINS / 2 ? SIGN_RGB.neg : SIGN_RGB.pos))
        qTag.set(`after int${q.bits}: ${R.levels} distinct values`, LABEL)
        const E = qzDeploy(q)
        const flashText = (c: typeof E.f) => `${bytesText(c.flash)}${c.fitsFlash ? '' : ' > 3 MB slot'}`
        const sramText = (c: typeof E.f) => `${bytesText(c.sram)}${c.fitsSram ? '' : ' → PSRAM'}`
        D.mem.set(0, FLASH_BUDGET, [[FIRMWARE_FLASH, GREY], [E.f.weights, WEIGHT_COLORS.pos]], flashText(E.f), E.f.fitsFlash ? LABEL : HIGH_V)
        D.mem.set(1, FLASH_BUDGET, [[FIRMWARE_FLASH, GREY], [E.i.weights, WEIGHT_COLORS.pos]], flashText(E.i), E.i.fitsFlash ? LABEL : HIGH_V)
        D.mem.set(2, SRAM_BUDGET, [[SYSTEM_SRAM, GREY], [E.f.arena, RING]], sramText(E.f), E.f.fitsSram ? LABEL : HIGH_V)
        D.mem.set(3, SRAM_BUDGET, [[SYSTEM_SRAM, GREY], [E.i.arena, RING]], sramText(E.i), E.i.fitsSram ? LABEL : HIGH_V)
        deployTag.set(`${E.m.name}, ${(E.m.params / 1e3).toFixed(0)} k weights`, GREY)
        const ts = [E.f, E.i, E.fs3, E.is3].map((c) => c.seconds)
        D.time.set(ts, ts.map(usText), [HEAT, POWER, HEAT, POWER])
        status.set(`Post-training quantization · int${q.bits} weights, ${q.grain === 'channel' ? 'per-neuron' : 'per-layer'} scale`, LABEL)
        sub.set(`2-10-10-1 net trained in float on 200 noisy two-moons points · activations int8 · weight error rms ${R.rms.toFixed(4)}`, GREY)
        event.set(
          R.flips === 0 ? 'no prediction changed: the rounding is far below what matters' : `${R.flips} of ${QZ_DATA.length} predictions flipped by rounding`,
          R.flips === 0 ? POWER : R.flips < 10 ? HEAT : HIGH_V,
        )
      },
      readouts: (p) => {
        const q = qzParams(p)
        const R = qzRun(q)
        const E = qzDeploy(q)
        return [
          { label: 'Accuracy float → int', value: `${pct(B.accF)} → ${pct(R.accQ)}`, tone: toneOf(R.accQ >= B.accF - 0.01, R.accQ > 0.8) },
          { label: 'Predictions flipped', value: `${R.flips} of ${QZ_DATA.length}`, tone: toneOf(R.flips === 0, R.flips < 10) },
          { label: 'Model weights float → int', value: `${bytesText(E.f.weights)} → ${bytesText(E.i.weights)}` },
          { label: 'ESP32 time float → int', value: `${usText(E.f.seconds)} → ${usText(E.i.seconds)}` },
        ]
      },
    }
  },
}

// --- Gesture recognition: accelerometer window → 12 features → 12-8-4 net; train on noisy data to survive a noisy sensor. ---

const GR_TRAIN = { clean: 'Trained on clean windows', noisy: 'Trained with noise added' }
const GR_TRAIN_NOISE = { clean: 0.05, noisy: 0.25 }
const GR_PLAY = 2
const GR_HOLD = 1.6
const AXIS_COLORS = [HEAT, POWER, DATA_COLOR]
const GR_G = 3
const grParams = (p: Params) => ({ gesture: pick(GESTURES, p.gesture, 'shake'), seed: n(p, 'seed'), noise: n(p, 'noise'), train: pick(GR_TRAIN, p.train, 'clean') })
type GrQ = ReturnType<typeof grParams>
const grNet = (q: GrQ) => gestureNet(GR_TRAIN_NOISE[q.train])
const grEval = memoBy(
  (q: GrQ) => `${q.train}|${q.noise}`,
  (q: GrQ) => {
    const { net } = grNet(q)
    const test = gestureSet(25, q.noise, 500)
    const m = confusion(net, test)
    const int8 = quantizeMlp(net, 8, 'channel').net
    return { m, acc: confusionAccuracy(m), accQ: confusionAccuracy(confusion(int8, test)) }
  },
)
const grWindow = memoBy(
  (q: GrQ) => `${q.gesture}|${q.seed}|${q.noise}|${q.train}`,
  (q: GrQ) => {
    const w = gestureWindow(q.gesture, 900 + q.seed, q.noise)
    const x = gestureFeatures(w)
    const { net } = grNet(q)
    const { a } = mlpForward(net, x)
    return { w, x, a, out: a[a.length - 1], k: argmax(a[a.length - 1]) }
  },
)
const grCost = once(() => {
  const net: Mlp = gestureNet(0.05).net
  const macs = mlpMacs(net)
  const params = mlpParams(net)
  return {
    macs,
    params,
    arena: mlpArena(net, 1) + 3 * WINDOW_N * 2,
    featS: FEATURE_MACS / CHIPS.esp32.f32,
    netS: macs / CHIPS.esp32.int8,
    netS3: macs / CHIPS.esp32s3.int8,
    rawParams: 3 * WINDOW_N * 8 + 8 + 8 * 4 + 4,
  }
})

export const tinymlGestureRecognition: Lesson = {
  id: 'tinyml-gesture-recognition',
  title: 'Gesture recognition',
  tagline: 'A one-second window of accelerometer data, boiled down to 12 numbers, fed to a net with 140 weights: shake, circle or punch, decided in microseconds on an ESP32',
  formula: `window: ${WINDOW_N} samples × 3 axes at ${IMU_HZ} Hz · features per axis: mean, σ, peak-to-peak, dominant frequency (DFT) · 12 → 8 tanh → 4 sigmoid · gesture = largest output`,
  legend: [
    { color: AXIS_COLORS[0], label: 'Accel x (forward)', shape: 'dot' },
    { color: AXIS_COLORS[1], label: 'Accel y (left)', shape: 'dot' },
    { color: AXIS_COLORS[2], label: 'Accel z (up, 1 g at rest)', shape: 'dot' },
    { color: WEIGHT_COLORS.pos, label: 'Positive weight; bright neuron = active', shape: 'dot' },
    { color: WEIGHT_COLORS.neg, label: 'Negative weight', shape: 'dot' },
  ],
  points: [
    'An IMU on the robot or a wristband samples acceleration 50 times a second. A gesture is a shape in that stream: a shake is a fast back-and-forth along x, a circle swings y and z out of phase, a punch is a sharp spike forward and a stop. Gravity adds 1 g on whichever axis points up, and every person does it a bit bigger, faster or tilted.',
    'Feeding all 150 raw numbers to a net works but needs about 1 200 weights and much more data. Instead the firmware computes 12 features per window: per axis the mean (which way is down), the spread σ (how hard), peak-to-peak and the dominant frequency from a DFT (how fast). These are the input neurons; a hidden layer of 8 and 4 outputs, one per gesture, do the rest.',
    'The net was trained once on 160 labelled windows with gradient descent (see Neural nets 101), and tested on 100 windows it never saw. Turn the sensor noise up: a net trained only on clean windows falls apart around 0.2 g, because σ and peak-to-peak swell with noise and idle starts to look like a gesture. Training with noise added (augmentation) keeps it working, at a small cost on clean data.',
    'On the chip the net is the cheap part: 128 multiply-adds, a few microseconds in int8, and 140 bytes of weights. The DFT features cost more, and the real delay is waiting for the one-second window to fill. That is TinyML in a nutshell: small models, careful features, quantized to int8 (previous lesson) and running on a coin-cell budget.',
  ],
  controls: [
    { kind: 'choice', key: 'gesture', options: opts(GESTURES), initial: 'shake' },
    { kind: 'slider', key: 'seed', label: 'Example', min: 1, max: 9, step: 1, initial: 1, format: (v: number) => `#${v}` },
    { kind: 'slider', key: 'noise', label: 'Sensor noise', min: 0, max: 0.5, step: 0.05, initial: 0.05, format: (v: number) => `${v.toFixed(2)} g` },
    { kind: 'choice', key: 'train', options: opts(GR_TRAIN), initial: 'clean' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const S = { x: -12.2, y: 0.2, w: 8.4, h: 5.4 }
    const plot = scope(scene, S.w, S.h, { divs: [10, 6], zeroAt: 0.5 })
    plot.group.position.set(S.x, S.y, 0)
    const traces = AXIS_COLORS.map((c) => plot.trace(c, { samples: WINDOW_N, radius: 0.06 }))
    addLabel(scene, `accelerometer, 1 s window (±${GR_G} g)`, [S.x - S.w / 2, S.y + S.h / 2 + 0.9, 0.3], LABEL, 0.28, 'left')
    addLabel(scene, '0', [S.x - S.w / 2, S.y - S.h / 2 - 0.9, 0.3], GREY, 0.26, 'left')
    addLabel(scene, '1 s', [S.x + S.w / 2, S.y - S.h / 2 - 0.9, 0.3], GREY, 0.26, 'right')
    const clock = liveLabel(scene, [S.x, S.y - S.h / 2 - 0.9, 0.3], { size: 0.26, color: GREY })
    const NX = 1.6
    const net = netDiagram(scene, [12, 8, 4], [NX, -0.2, 0], 5.6, 7.2, { r: 0.28, turn: 0.25 })
    FEATURE_NAMES.forEach((s, i) => addLabel(net.group, s, [net.pos(0, i)[0] - 0.45, net.pos(0, i)[1], 0], GREY, 0.22, 'right'))
    const outTags = GESTURE_KEYS.map((_, i) => liveLabel(net.group, [net.pos(2, i)[0] + 0.5, net.pos(2, i)[1], 0], { size: 0.28, align: 'left' }))
    const probs = countBars(scene, [12.4, 2.8, 0], GESTURE_KEYS.map((g) => GESTURES[g]), 4, { row: 0.72, size: 0.28 })
    addLabel(scene, 'net output', [12.4, 3.7, 0.3], GREY, 0.27, 'left')
    const verdict = liveLabel(scene, [12.4, -0.4, 0.3], { size: 0.34, align: 'left' })
    const GR_COST = grCost()
    const D = deployPanel(scene, ['flash (weights)', 'SRAM (arena)'], ['features, float', 'net, ESP32 int8', 'net, S3 int8'])
    addLabel(scene, 'time per window', [7.4, -5.0, 0.3], GREY, 0.27, 'left')
    addLabel(scene, `${GR_COST.params} weights, ${GR_COST.macs} multiply-adds · bars: 1 KB`, [-9.6, -5.0, 0.3], GREY, 0.27, 'left')
    D.mem.set(0, 1024, [[GR_COST.params, WEIGHT_COLORS.pos]], `${GR_COST.params} B int8`)
    D.mem.set(1, 1024, [[GR_COST.arena, RING]], `${GR_COST.arena} B`)
    D.time.set([GR_COST.featS, GR_COST.netS, GR_COST.netS3], [GR_COST.featS, GR_COST.netS, GR_COST.netS3].map(usText), [HEAT, POWER, POWER])
    const st = { key: '', t: 0, k: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = grParams(p)
        const key = `${q.gesture}|${q.seed}|${q.noise}|${q.train}`
        if (key !== st.key) [st.key, st.t, st.k] = [key, 0, -1]
        st.t += dt
        if (st.t > GR_PLAY + GR_HOLD) [st.t, st.k] = [0, -1]
        const k = Math.min(WINDOW_N, Math.max(2, Math.round((st.t / GR_PLAY) * WINDOW_N)))
        if (k === st.k) return
        st.k = k
        const W = grWindow(q)
        const axes = [W.w.ax, W.w.ay, W.w.az]
        traces.forEach((tr, a) => {
          const us: number[] = []
          const vs: number[] = []
          for (let i = 0; i < k; i++) {
            us.push(i / (WINDOW_N - 1))
            vs.push((Math.max(-GR_G, Math.min(GR_G, axes[a][i])) / GR_G) * (S.h / 2))
          }
          tr.points(us, vs)
        })
        clock.set(`${((k / WINDOW_N) * 1).toFixed(2)} s (shown 2× slower)`, GREY)
        const full = k === WINDOW_N
        const E = grEval(q)
        if (full) {
          const acts = W.a.map((row, l) => (l === 0 ? row.map((v) => Math.max(-1, Math.min(1, v))) : l === 1 ? row : row.map((v) => 2 * v - 1)))
          net.set(grNet(q).net, acts)
          probs.set(W.out, W.out.map((v) => v.toFixed(2)), W.out.map((_, i) => (i === W.k ? (W.k === GESTURE_KEYS.indexOf(q.gesture) ? POWER : HIGH_V) : GREY)))
          const right = W.k === GESTURE_KEYS.indexOf(q.gesture)
          verdict.set(`→ ${GESTURES[GESTURE_KEYS[W.k]]}${right ? ' ✓' : `: wrong, was ${GESTURES[q.gesture].toLowerCase()}`}`, right ? POWER : HIGH_V)
          GESTURE_KEYS.forEach((g, i) => outTags[i].set(GESTURES[g], i === W.k ? LABEL : GREY))
        } else {
          net.set(grNet(q).net)
          probs.set([0, 0, 0, 0], ['…', '…', '…', '…'], [GREY, GREY, GREY, GREY])
          verdict.set('filling the window…', GREY)
          GESTURE_KEYS.forEach((g, i) => outTags[i].set(GESTURES[g], GREY))
        }
        status.set(`Gesture recognition · ${GESTURES[q.gesture]} example #${q.seed} · noise ${q.noise.toFixed(2)} g`, LABEL)
        sub.set(`12-8-4 net, ${GR_TRAIN[q.train].toLowerCase()} (${GR_TRAIN_NOISE[q.train]} g) · 100 unseen test windows at this noise: ${pct(E.acc)} right`, GREY)
        const worst = E.m.map((r, i) => ({ i, miss: r.reduce((s, v) => s + v, 0) - r[i] })).sort((a, b) => b.miss - a.miss)[0]
        event.set(
          E.acc > 0.95 ? 'features separate the gestures cleanly' : `noise swamps the features: ${GESTURES[GESTURE_KEYS[worst.i]].toLowerCase()} missed ${worst.miss} of 25 times`,
          E.acc > 0.95 ? POWER : E.acc > 0.75 ? HEAT : HIGH_V,
        )
      },
      readouts: (p) => {
        const q = grParams(p)
        const E = grEval(q)
        const W = grWindow(q)
        return [
          { label: 'Test accuracy (100 windows)', value: pct(E.acc), tone: toneOf(E.acc > 0.95, E.acc > 0.75) },
          { label: 'Same net in int8', value: pct(E.accQ), tone: toneOf(E.accQ > 0.95, E.accQ > 0.75) },
          { label: 'This window', value: `${GESTURES[GESTURE_KEYS[W.k]]} (${W.out[W.k].toFixed(2)})`, tone: W.k === GESTURE_KEYS.indexOf(q.gesture) ? 'ok' : 'bad' },
          { label: 'Weights: features vs raw input', value: `${GR_COST.params} vs ${GR_COST.rawParams}` },
        ]
      },
    }
  },
}
