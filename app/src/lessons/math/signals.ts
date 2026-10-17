import * as THREE from 'three/webgpu'
import { RECON, Z_INPUTS, sampleRateView, spectralImages, zView } from '../../core/physics'
import { fixedText, hertz, msText, signed } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  dotLine,
  glowMat,
  lapseClock,
  liveLabel,
  memoBy,
  moduleBlock,
  plotY,
  pointCloud,
  rodPool,
  statusHeader,
  textRows,
  titledScope,
  vecArrow,
  zPlane,
  WIDE_VIEW,
  WIDE_LEFT,
  WIDE_RIGHT,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'


// --- Sample rate: numbers at fs, the curve rebuilt from them, and the spectrum copied every fs. ---

const SR = { T: 0.2, fMax: 200, specMax: 600, slow: 1 / 40 }
const srRun = memoBy(
  (p: Params) => `${p.f} ${p.fs} ${p.recon}`,
  (p: Params) => {
    const [f, fs] = [n(p, 'f'), n(p, 'fs')]
    return { V: sampleRateView(f, fs, pick(RECON, p.recon, 'line'), SR.T), images: spectralImages(f, fs, SR.specMax) }
  },
)
const srClock = lapseClock(SR.T, SR.slow, 0.02)

/** Propeller seen face-on: grey real blades with a red tip, a gold copy frozen at the last camera frame. */
function propeller(scene: THREE.Object3D, at: V3, r: number) {
  const g = add(scene, new THREE.Group(), at)
  cylinder(g, r * 0.24, 0.6, mat('#2a2c32', { rough: 0.5 }), [0, 0, -0.3], 'z', 32)
  const blades = (color: string | null, z: number, opacity = 1) => {
    const rot = add(g, new THREE.Group(), [0, 0, z])
    const m = color ? glowMat(color, 0.5) : mat('#c9ced8', { rough: 0.5 })
    if (opacity < 1) Object.assign(m, { transparent: true, opacity })
    box(rot, [2 * r, r * 0.22, 0.12], m, [0, 0, 0])
    box(rot, [r * 0.3, r * 0.26, 0.16], glowMat(color ?? HIGH_V, 1.1), [r * 0.85, 0, 0.04])
    return rot
  }
  const real = blades(null, 0.1)
  const frame = blades(RING, 0.4, 0.55)
  cylinder(g, r * 0.12, 0.9, mat('#b9bec6', { metal: 0.4, rough: 0.4 }), [0, 0, 0.2], 'z', 16)
  return {
    group: g,
    set(aReal: number, aFrame: number) {
      real.rotation.z = aReal
      frame.rotation.z = aFrame
    },
  }
}

export const signalsSampleRate: Lesson = {
  id: 'signals-sample-rate',
  title: 'Sample rate',
  tagline: 'A sampled signal is just numbers fs times a second: what you can rebuild from them depends on fs',
  formula: (p) => {
    const { V } = srRun(p)
    return `x[k] = x(k/fs) = sin(2π·${hertz(V.f)}·k/${hertz(V.fs)}) · ${fixedText(V.perCycle, 1)} samples per cycle · Nyquist fs/2 = ${hertz(V.nyquist)} · spectrum copies at k·fs ± f → seen at |f − k·fs| = ${hertz(V.seen)}${V.aliased ? ' (alias)' : ''} · ${RECON[V.kind]} rebuild error ${fixedText(V.rms, 2)} rms`
  },
  legend: [
    { color: HIGH_V, label: 'Real signal (blade tip height)', shape: 'dot' },
    { color: RING, label: 'Samples / camera frames', shape: 'dot' },
    { color: B_FIELD, label: 'Rebuilt from the samples', shape: 'dot' },
    { color: POWER, label: '0 … fs/2: the band samples can hold', shape: 'dot' },
  ],
  points: [
    'A propeller turning f times a second makes its blade tip go up and down as sin(2πft): the vibration an IMU on the arm feels. A camera or an ADC does not see that curve, only its value at k/fs: a list of numbers x[k]. Everything the robot knows about the signal is in those gold dots.',
    'To use the numbers between samples you rebuild a curve. A controller or a DAC holds each value until the next one (zero-order hold: a staircase, half a sample late on average). Joining the dots is better; the ideal rebuild adds a sinc pulse per sample and gets the exact sine back, as long as f < fs/2. More samples per cycle make every method closer.',
    'Why fs/2: sampling copies the spectrum of the signal to every multiple of fs (bottom left). A tone at f also appears at fs − f, fs + f, 2fs − f… The rebuild keeps only what lies in 0 … fs/2 (green band). Below Nyquist that is the real tone; above it, a copy at |f − k·fs| lands in the band instead, and that is the curve you get back: the alias. The zigzag (bottom right) is that fold for every f.',
    'The propeller shows the same thing: the gold frame copy jumps by f/fs of a turn per frame. Near f = fs it seems to crawl or turn backwards: the wagon-wheel effect. Signals › Fourier intuition › Aliasing and Nyquist cover the strobe and the anti-alias filter in front of the ADC; Microcontrollers › ADC › Sampling sets fs on the ESP32.',
    `Rule of thumb on a robot: sample at least 2× the highest frequency present (after filtering), and 5–10× the fastest thing you want to see or control. Time is slowed ${1 / SR.slow}×.`,
  ],
  controls: [
    { kind: 'slider', key: 'f', label: 'Signal f (prop rev/s)', min: 2, max: SR.fMax, step: 1, initial: 30, format: hertz },
    { kind: 'slider', key: 'fs', label: 'Sample rate fs', min: 20, max: 500, step: 5, initial: 100, format: hertz },
    { kind: 'choice', key: 'recon', options: opts(RECON), initial: 'line' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const pt = titledScope(scene, WIDE_LEFT.top, WIDE_LEFT.topH, 'blade tip height: real, samples, rebuilt', LABEL, 0.5, WIDE_LEFT.x, WIDE_LEFT.w)
    const yx = plotY(-1.3, 1.3, WIDE_LEFT.topH)
    const trTrue = pt.s.trace(HIGH_V, { samples: 400, radius: 0.04 })
    const trBuilt = pt.s.trace(B_FIELD, { samples: 400, radius: 0.07 })
    const dots = pointCloud(pt.s.group, 110, 0.14)
    const cursor = pt.s.trace(GREY, { samples: 2, radius: 0.03 })

    const ps = titledScope(scene, WIDE_LEFT.low, WIDE_LEFT.lowH, 'spectrum after sampling', LABEL, 0.05, WIDE_LEFT.x, WIDE_LEFT.w)
    const fx = (hz: number) => ps.s.xAt(hz / SR.specMax)
    const band = add(ps.s.group, new THREE.Mesh(new THREE.BoxGeometry(1, WIDE_LEFT.lowH, 0.02), new THREE.MeshBasicMaterial({ color: POWER, transparent: true, opacity: 0.16 })))
    const bars = rodPool(ps.s.group, 64)
    const nyqTag = liveLabel(ps.s.group, [0, 0, 0.4], { size: 0.26, color: POWER })
    const fsTag = liveLabel(ps.s.group, [0, 0, 0.4], { size: 0.26, color: GREY })

    const pf = titledScope(scene, WIDE_RIGHT.y, WIDE_RIGHT.h, 'seen frequency vs real f', LABEL, 0, WIDE_RIGHT.x, WIDE_RIGHT.w)
    const trFold = pf.s.trace(B_FIELD, { samples: 241, radius: 0.05 })
    const trDiag = pf.s.trace(GREY, { samples: 2, radius: 0.025 })
    const nyqLine = pf.s.level(POWER)

    const prop = propeller(scene, [4.6, 3.2, 0], 3.3)
    addLabel(scene, 'gold = last camera frame', [4.6, -0.6, 0.3], RING, 0.28)
    const rows = textRows(scene, 3, 1.6, -2.6, 0.32, 0.75)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { V, images } = srRun(p)
        const now = srClock(dt, `${V.f} ${V.fs} ${V.kind}`)
        const u = (t: number) => t / SR.T
        trTrue.points(V.ts.map(u), V.truth.map(yx), null)
        trBuilt.points(V.ts.map(u), V.rebuilt.map(yx), null)
        const shown = V.dots.filter((d) => d.t <= now + 1e-9)
        shown.forEach((d, i) => dots.set(i, [pt.s.xAt(u(d.t)), yx(d.x), 0.4], RING))
        dots.show(shown.length)
        cursor.points([u(now), u(now)], [-WIDE_LEFT.topH / 2, WIDE_LEFT.topH / 2], null)
        pt.right.set(`${fixedText(V.perCycle, 1)} samples / cycle`, V.perCycle > 2 ? RING : HIGH_V)
        pt.lo.set('0 ms')
        pt.hi.set(msText(SR.T))

        const ny = V.nyquist
        band.scale.x = Math.max(0.01, fx(Math.min(ny, SR.specMax)) - fx(0))
        band.position.set((fx(0) + fx(Math.min(ny, SR.specMax))) / 2, 0, 0.05)
        const base = -WIDE_LEFT.lowH / 2 + 0.05 * WIDE_LEFT.lowH
        images.forEach((im, i) => {
          const h = im.original ? 0.8 : im.seen ? 0.7 : 0.5
          bars.set(i, [fx(im.hz), base, 0.3], [fx(im.hz), base + h * (WIDE_LEFT.lowH * 0.9), 0.3], im.original ? 0.12 : 0.09, im.original ? HIGH_V : im.seen ? B_FIELD : GREY)
        })
        bars.hideFrom(images.length)
        bars.commit()
        nyqTag.group.position.set(Math.min(fx(ny), ps.s.width / 2 - 0.8), WIDE_LEFT.lowH / 2 - 0.4, 0.4)
        nyqTag.set('fs/2', POWER)
        fsTag.group.visible = V.fs <= SR.specMax
        fsTag.group.position.set(Math.min(fx(V.fs), ps.s.width / 2 - 0.6), WIDE_LEFT.lowH / 2 - 0.9, 0.4)
        fsTag.set('fs', GREY)
        ps.right.set(V.aliased ? `alias at ${hertz(V.seen)}` : `tone kept at ${hertz(V.f)}`, V.aliased ? HIGH_V : POWER)
        ps.lo.set('0 Hz')
        ps.hi.set(hertz(SR.specMax))

        const top = 1.15 * Math.min(V.nyquist, SR.fMax)
        const yf = plotY(0, top, WIDE_RIGHT.h)
        trFold.draw((x) => yf(Math.abs(x * SR.fMax - V.fs * Math.round((x * SR.fMax) / V.fs))), V.f / SR.fMax)
        trDiag.points([0, Math.min(1, top / SR.fMax)], [yf(0), yf(Math.min(top, SR.fMax))], null)
        nyqLine.set(yf(ny))
        pf.right.set(`${hertz(V.f)} → ${hertz(V.seen)}`, V.aliased ? HIGH_V : B_FIELD)
        pf.lo.set('f = 0 Hz')
        pf.hi.set(hertz(SR.fMax))

        const k = Math.floor(now * V.fs + 1e-9)
        prop.set(2 * Math.PI * V.f * now, 2 * Math.PI * V.f * (k / V.fs))
        const step = ((V.f / V.fs) % 1) * 360
        rows[0].set(`per frame the blade turns ${fixedText(V.f / V.fs, 2)} turns`, LABEL)
        rows[1].set(`looks like ${signed(step > 180 ? step - 360 : step, 0)}° per frame`, step > 180 ? HIGH_V : RING)
        rows[2].set(`rebuild error ${fixedText(V.rms, 2)} rms (${RECON[V.kind]})`, V.rms < 0.15 ? POWER : V.rms < 0.4 ? HEAT : HIGH_V)
        head.status.set(`Sample rate · f ${hertz(V.f)} · fs ${hertz(V.fs)}`)
        head.sub.set(`${1 / SR.slow}× slower · Nyquist ${hertz(ny)}`, GREY)
        head.event.set(V.aliased ? `f above fs/2: the samples spell a ${hertz(V.seen)} wave` : V.perCycle < 5 ? 'below Nyquist but few samples per cycle: only the ideal rebuild is close' : 'plenty of samples: every rebuild follows the signal', V.aliased ? HIGH_V : V.perCycle < 5 ? HEAT : POWER)
      },
      readouts: (p) => {
        const { V } = srRun(p)
        return [
          { label: 'Nyquist', value: hertz(V.nyquist) },
          { label: 'Per cycle', value: fixedText(V.perCycle, 1), tone: toneOf(V.perCycle >= 5, V.perCycle > 2) },
          { label: 'Seen as', value: hertz(V.seen), tone: V.aliased ? 'bad' : 'ok' },
          { label: 'Rebuild error', value: fixedText(V.rms, 2), tone: toneOf(V.rms < 0.15, V.rms < 0.4) },
        ]
      },
    }
  },
}

// --- Z-transform intuition: y[n] = a·y[n−1] + b·x[n], a pole at z = a. ---

const ZT = { T: 0.01, N: 40, step: 0.16, dbLo: -30, dbHi: 30 }
const ztRun = memoBy(
  (p: Params) => `${p.a} ${p.input} ${p.f}`,
  (p: Params) => zView(n(p, 'a'), pick(Z_INPUTS, p.input, 'step'), ZT.N, ZT.T, 2 * Math.PI * n(p, 'f') * ZT.T),
)
const ztClock = lapseClock(ZT.N, 1 / ZT.step, 8)
const db = (m: number) => 20 * Math.log10(Math.max(m, 1e-6))

export const signalsZTransformIntuition: Lesson = {
  id: 'signals-z-transform-intuition',
  title: 'Z-transform intuition',
  tagline: 'z⁻¹ means one sample ago: a filter becomes a pole you can see, and inside the circle means it settles',
  formula: (p) => {
    const Z = ztRun(p)
    const s = Z.s.im ? `${fixedText(Z.s.re, 1)} ± j${fixedText(Z.s.im, 0)}` : fixedText(Z.s.re, 1)
    return `y[n] = a·y[n−1] + b·x[n] → Y = a·z⁻¹·Y + b·X → H(z) = b·z/(z − a), a = ${fixedText(Z.a, 2)}, b = ${fixedText(Z.b, 2)} · pole |a| ${Z.stable ? '< 1: decays' : '≥ 1: grows'} · z = e^(sT): s = ln(a)/T = ${s} /s · |H(e^(jωT))| = b/|e^(jωT) − a| = ${fixedText(Z.at.mag, 2)} at ${hertz(n(p, 'f'))}`
  },
  legend: [
    { color: GREY, label: 'Input x[n]', shape: 'dot' },
    { color: RING, label: 'Output y[n] and the pole z = a', shape: 'dot' },
    { color: B_FIELD, label: 'Test frequency: e^(jωT) on the circle', shape: 'dot' },
    { color: POWER, label: 'Unit circle: inside = stable', shape: 'dot' },
  ],
  points: [
    'The low-pass in almost every robot loop is one line: y = a·y + (1 − a)·x. It mixes the new reading x[n] with the last output y[n−1]: the exponential moving average of Control › Filters in the loop › Low-pass. The block diagram is a gain, a sum and a box z⁻¹ that hands back the value from one sample ago.',
    'The z-transform is that bookkeeping: write z⁻¹ for "one sample ago" and the loop becomes algebra, Y = a·z⁻¹·Y + b·X, so H(z) = b·z/(z − a). The output blows up where the bottom is zero, at z = a: the pole. An impulse comes out as b, b·a, b·a², …: each sample multiplied by a.',
    'So the pole decides everything. |a| < 1 (inside the unit circle) decays; closer to 1 is smoother and slower. A negative a flips sign every sample and rings. On or outside the circle (|a| ≥ 1) the output never settles or grows without end, like a too-big step in Differential equations › Step size.',
    'z = e^(sT) links it to continuous time: a pole at s = −1/τ becomes a = e^{−T/τ}, so the whole stable left half of the s-plane folds into the inside of the unit circle and the jω axis onto the circle itself. That is how State-space & LQR turns a model into a stepped one (c2d) at the loop period T.',
    `Frequency response: a sine at ω is the point e^(jωT) on the circle, from 1 (DC) round to −1 at fs/2. Its gain is b over the distance to the pole: near the pole it passes, far away it is cut. Here T = ${msText(ZT.T)} (fs = ${hertz(1 / ZT.T)}); one sample every ${ZT.step} s.`,
  ],
  controls: [
    { kind: 'slider', key: 'a', label: 'Pole a', min: -1.1, max: 1.1, step: 0.05, initial: 0.8, format: (v) => fixedText(v, 2) },
    { kind: 'choice', key: 'input', options: opts(Z_INPUTS), initial: 'step' },
    { kind: 'slider', key: 'f', label: 'Test frequency', min: 0, max: 50, step: 1, initial: 5, format: hertz },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const pt = titledScope(scene, WIDE_LEFT.top, WIDE_LEFT.topH, 'input x[n] and output y[n]', LABEL, 0.4, WIDE_LEFT.x, WIDE_LEFT.w)
    const yv = plotY(-1.1, 1.65, WIDE_LEFT.topH)
    const stems = rodPool(pt.s.group, 2 * ZT.N)
    const heads = pointCloud(pt.s.group, 2 * ZT.N, 0.13)
    const pb = titledScope(scene, WIDE_LEFT.low, WIDE_LEFT.lowH, 'gain |H| (dB) from DC to fs/2', LABEL, 0.5, WIDE_LEFT.x, WIDE_LEFT.w)
    const yd = plotY(ZT.dbLo, ZT.dbHi, WIDE_LEFT.lowH)
    const trGain = pb.s.trace(RING, { samples: 121, radius: 0.06 })
    const gAt = pb.s.trace(B_FIELD, { samples: 2, radius: 0.05 })

    const ZP = { x: 7.4, y: -9.6, side: 8.4 }
    const zp = zPlane(scene, [ZP.x, ZP.y, 0], 1.5 / (ZP.side / 2), 1.5)
    const dist = dotLine(zp.group, 0.07, 30)
    const pointDot = add(zp.group, new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), glowMat(B_FIELD, 1.2)))
    addLabel(scene, 'z-plane: pole × at a, zero o at 0', [ZP.x - ZP.side / 2, ZP.y + ZP.side / 2 + 1, 0.3], LABEL, 0.3, 'left')

    const D = { x: 4.6, y1: 5.2, y2: 1.6 }
    const gB = moduleBlock(scene, [D.x - 4.4, D.y1, 0], [2, 1.4, 0.8], '× b')
    const gS = moduleBlock(scene, [D.x, D.y1, 0], [1.4, 1.4, 0.8], 'Σ')
    const gZ = moduleBlock(scene, [D.x + 2.4, D.y2, 0], [2, 1.4, 0.8], 'z⁻¹')
    const gA = moduleBlock(scene, [D.x - 1.8, D.y2, 0], [2, 1.4, 0.8], '× a')
    const arrows = Array.from({ length: 7 }, () => vecArrow(scene, LABEL, 0.06, 0.28))
    const tags = { x: liveLabel(scene, [D.x - 6.6, D.y1 - 0.9, 0.3], { size: 0.3 }), y: liveLabel(scene, [D.x + 4.2, D.y1 + 1, 0.3], { size: 0.3 }), d: liveLabel(scene, [D.x + 2.4, D.y2 - 1.3, 0.3], { size: 0.28 }) }
    const rows = textRows(scene, 4, 1.6, -1.0, 0.32, 0.7)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const Z = ztRun(p)
        const f = n(p, 'f')
        const now = ztClock(dt, `${Z.a} ${p.input}`)
        const k = Math.min(ZT.N - 1, Math.floor(now))
        const xu = (i: number) => pt.s.xAt((i + 0.5) / ZT.N)
        const cy = (v: number) => Math.max(-WIDE_LEFT.topH / 2, Math.min(WIDE_LEFT.topH / 2, yv(v)))
        for (let i = 0; i < ZT.N; i++) {
          const on = i <= k
          const xs = Z.xs[i]
          const ys = Z.ys[i]
          if (on) {
            stems.set(2 * i, [xu(i) - 0.08, yv(0), 0.2], [xu(i) - 0.08, cy(xs), 0.2], 0.03, GREY)
            stems.set(2 * i + 1, [xu(i) + 0.08, yv(0), 0.3], [xu(i) + 0.08, cy(ys), 0.3], 0.05, RING)
          } else {
            stems.set(2 * i, [0, 0, 0], [0, 0, 0], 0, GREY)
            stems.set(2 * i + 1, [0, 0, 0], [0, 0, 0], 0, RING)
          }
          heads.set(2 * i, [xu(i) - 0.08, cy(xs), 0.25], GREY, on ? 0.6 : 0)
          heads.set(2 * i + 1, [xu(i) + 0.08, cy(ys), 0.35], RING, on ? 1 : 0)
        }
        stems.commit()
        heads.show(2 * ZT.N)
        pt.right.set(`n = ${k}: y = ${fixedText(Z.ys[k], 2)}`, Z.stable ? RING : HIGH_V)
        pt.lo.set('n = 0')
        pt.hi.set(`n = ${ZT.N} (${msText(ZT.N * ZT.T)})`)

        trGain.points(Z.freq.map((_, i) => i / (Z.freq.length - 1)), Z.freq.map((m) => yd(db(m))), null)
        const uf = f / (0.5 / ZT.T)
        gAt.points([uf, uf], [yd(ZT.dbLo), yd(db(Z.at.mag))])
        pb.right.set(`${hertz(f)}: ${signed(db(Z.at.mag), 1)} dB`, B_FIELD)
        pb.lo.set('0 Hz')
        pb.hi.set(`${hertz(0.5 / ZT.T)} = fs/2`)

        zp.poles([{ re: Z.a, im: 0 }], Z.stable ? RING : HIGH_V)
        zp.zeros([{ re: 0, im: 0 }])
        const [px, py] = zp.xy(Z.a, 0)
        const [qx, qy] = zp.xy(...Z.point)
        pointDot.position.set(qx, qy, 0.4)
        dist([px, py, 0.35], [qx, qy, 0.35], B_FIELD)
        rows[3].set(`gain = b / dist = ${fixedText(Z.b, 2)} / ${fixedText(Math.hypot(Z.point[0] - Z.a, Z.point[1]), 2)}`, B_FIELD)

        const [x0, y0] = [Z.xs[k], Z.ys[k]]
        const prev = k ? Z.ys[k - 1] : 0
        const c = Z.stable ? RING : HIGH_V
        arrows[0]([D.x - 7.4, D.y1, 0.3], [D.x - 5.5, D.y1, 0.3], '')
        arrows[1]([D.x - 3.4, D.y1, 0.3], [D.x - 0.8, D.y1, 0.3], '')
        arrows[2]([D.x + 0.7, D.y1, 0.3], [D.x + 4.6, D.y1, 0.3], '')
        arrows[3]([D.x + 2.4, D.y1, 0.3], [D.x + 2.4, D.y2 + 0.8, 0.3], '')
        arrows[4]([D.x + 1.4, D.y2, 0.3], [D.x - 0.7, D.y2, 0.3], '')
        arrows[5]([D.x - 2.9, D.y2, 0.3], [D.x - 3.6, D.y2, 0.3], '')
        arrows[6]([D.x - 3.6, D.y2, 0.3], [D.x - 0.5, D.y1 - 0.8, 0.3], '')
        gB(dt, GREY, 0.3)
        gS(dt, c, 0.5)
        gZ(dt, B_FIELD, 0.6)
        gA(dt, c, 0.3)
        tags.x.set(`x[n] = ${fixedText(x0, 2)}`, LABEL)
        tags.y.set(`y[n] = ${fixedText(y0, 2)}`, c)
        tags.d.set(`y[n−1] = ${fixedText(prev, 2)}`, B_FIELD)

        const s = Z.s
        rows[0].set(`pole a = ${fixedText(Z.a, 2)} → s = ln(a)/T = ${fixedText(s.re, 1)}${s.im ? ' ± jπ/T' : ''} /s`, c)
        rows[1].set(Number.isFinite(Z.tau) ? `τ = −T/ln(a) = ${msText(Z.tau)} · 2 % after ${Z.settle} samples` : Z.stable ? `negative a: sign flips each sample` : 'never settles', Number.isFinite(Z.tau) ? LABEL : Z.stable ? HEAT : HIGH_V)
        rows[2].set(`b = ${fixedText(Z.b, 2)}${Z.a > 0.95 ? ' (held at 0.05)' : ' = 1 − a'}`, GREY)
        head.status.set(`Z-transform intuition · a = ${fixedText(Z.a, 2)}`)
        head.sub.set(`T = ${msText(ZT.T)} · ${Z_INPUTS[pick(Z_INPUTS, p.input, 'step')].toLowerCase()} in`, GREY)
        head.event.set(!Z.stable ? 'pole on or outside the circle: no settling' : Z.rings ? 'pole left of 0: rings, flipping sign' : Z.a > 0.85 ? 'pole near 1: smooth but slow' : 'pole inside: decays quickly', !Z.stable ? HIGH_V : Z.rings ? HEAT : POWER)
      },
      readouts: (p) => {
        const Z = ztRun(p)
        return [
          { label: 'Pole |a|', value: fixedText(Math.abs(Z.a), 2), tone: toneOf(Math.abs(Z.a) < 1 && Z.a >= 0, Math.abs(Z.a) < 1) },
          { label: 'Time const', value: Number.isFinite(Z.tau) ? msText(Z.tau) : '—' },
          { label: 'Gain at f', value: `${signed(db(Z.at.mag), 1)} dB` },
          { label: 'Settles', value: Number.isFinite(Z.settle) ? `${Z.settle} samples` : 'never', tone: Number.isFinite(Z.settle) ? 'ok' : 'bad' },
        ]
      },
    }
  },
}
