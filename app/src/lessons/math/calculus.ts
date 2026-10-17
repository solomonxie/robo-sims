import * as THREE from 'three/webgpu'
import { ENCODER_DT, LINE_DRIVES, RULES, Strip, TURN, areaView, diffTradeoff, gyroIntegrate, lineDriveAt, ruleErrors, secantView, turnAngle, turnRate } from '../../core/physics'
import { cmText, degText, fixedText, mmTenths, mpsText, secsText, signed } from '../../core/units'
import { add } from '../../models/kit'
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
  areaStrips,
  countBars,
  diffBot,
  dotLine,
  floorMat,
  floorView,
  lapseClock,
  liveLabel,
  memoBy,
  pointCloud,
  statusHeader,
  titledScope,
  vecArrow,
  plotY,
  textRows,
  meterTrack,
  WIDE_VIEW,
  WIDE_LEFT,
  WIDE_RIGHT,
  glowDot,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const leftPair = (scene: THREE.Object3D, titles: [string, string], colors: [string, string], zero: [number, number]) => [
  titledScope(scene, WIDE_LEFT.top, WIDE_LEFT.topH, titles[0], colors[0], zero[0], WIDE_LEFT.x, WIDE_LEFT.w),
  titledScope(scene, WIDE_LEFT.low, WIDE_LEFT.lowH, titles[1], colors[1], zero[1], WIDE_LEFT.x, WIDE_LEFT.w),
]
const stripTops = (strips: readonly Strip[], u: (t: number) => number, y: (v: number) => number): [number[], number[]] => [strips.flatMap((s) => [u(s.t0), u(s.t1)]), strips.flatMap((s) => [y(s.y0), y(s.y1)])]
const ms = (v: number) => mpsText(v, 3).replace('-', '−')

// --- Derivative as slope: a secant over Δt on the encoder curve shrinks to the tangent; noise makes small Δt jumpy. ---

const DS = { lo: -0.1, hi: 0.7, vMax: 0.6, eMax: 0.2, hMin: ENCODER_DT, hMax: 2 }
const H_GRID = Array.from({ length: 61 }, (_, i) => DS.hMin * (DS.hMax / DS.hMin) ** (i / 60))
const dsRun = memoBy(
  (p: Params) => `${p.t} ${p.h} ${p.sigma}`,
  (p: Params) => {
    const [t, h, sigma] = [n(p, 't'), n(p, 'h'), n(p, 'sigma') / 1000]
    return { t, sigma, S: secantView('reverse', t, h, sigma), D: diffTradeoff('reverse', t, sigma, H_GRID) }
  },
)
const hU = (h: number) => Math.log(h / DS.hMin) / Math.log(DS.hMax / DS.hMin)

/** Points of the line y = y0 + k·(u − u0) for u in [ua, ub], cut where it leaves ±H/2. */
function lineIn(u0: number, y0: number, k: number, ua: number, ub: number, H: number): [number[], number[]] {
  let [a, b] = [ua, ub]
  if (Math.abs(k) > 1e-9) {
    const [c1, c2] = [u0 + (H / 2 - y0) / k, u0 + (-H / 2 - y0) / k]
    a = Math.max(a, Math.min(c1, c2))
    b = Math.min(b, Math.max(c1, c2))
  }
  if (b < a) b = a
  return [
    [a, b],
    [y0 + k * (a - u0), y0 + k * (b - u0)],
  ]
}

export const calculusDerivativeAsSlope: Lesson = {
  id: 'calculus-derivative-as-slope',
  title: 'Derivative as slope',
  tagline: 'Speed is the slope of position: shrink Δt and the secant becomes the tangent',
  formula: (p) => {
    const { S } = dsRun(p)
    return `slope = Δx/Δt = (x(t + Δt) − x(t))/Δt = ${fixedText(S.dx, 3)} m / ${secsText(S.h)} = ${ms(S.slope)} · true derivative dx/dt = ${ms(S.truth)} · error ${signed(S.error, 3)} m/s ≈ x″·Δt/2 (${signed(S.truncation, 3)}) + noise (±${fixedText(S.noiseGain, 3)})`
  },
  legend: [
    { color: POWER, label: 'Encoder position x(t)', shape: 'dot' },
    { color: RING, label: 'Secant over Δt: slope Δx/Δt', shape: 'dot' },
    { color: B_FIELD, label: 'Tangent: true speed dx/dt', shape: 'dot' },
    { color: HEAT, label: 'Δx/Δt at every t (noise blows up)', shape: 'dot' },
  ],
  points: [
    'A robot drives forward, backs up and goes again; its wheel encoder logs position x every 20 ms (top plot). Speed is how fast x changes: pick two readings Δt apart and divide, Δx/Δt. On the plot that is the slope of the secant line through the two points (yellow).',
    'Shrink Δt: the second point slides toward the first and the secant turns into the tangent (blue), the line that just touches the curve. Its slope is the derivative dx/dt, the speed at that instant. The error of the forward difference is about x″·Δt/2, so halving Δt halves it. Where the curve tops out (robot about to reverse) the tangent is flat: speed 0.',
    'Do it at every t and you get the whole speed curve (bottom left, orange vs the true blue one). Velocity is the slope of position and acceleration the slope of velocity: the plots in Mechanics › Kinematics › Velocity vs time plots.',
    'Now add encoder noise. Each reading is off by a few mm, and Δx/Δt divides that error by Δt: about √2·σ/Δt. At 20 ms, 1 mm of noise is ±0.07 m/s of fake speed. Small Δt is accurate but jumpy, large Δt is smooth but late and biased: the bottom-right plot shows the two errors crossing at a best step.',
    'This is exactly the D term of a PID controller: it differentiates the error every loop, so sensor noise becomes a jittery motor command (Control › PID › Derivative kick). Real code filters the derivative or differentiates the measurement, and speed from encoders often counts ticks over a longer window.',
  ],
  controls: [
    { kind: 'slider', key: 't', label: 'Time t', min: 0, max: 4, step: 0.1, initial: 1.2, format: (v) => secsText(v) },
    { kind: 'slider', key: 'h', label: 'Step Δt', min: DS.hMin, max: DS.hMax, step: 0.02, initial: 1, format: (v) => secsText(v) },
    { kind: 'slider', key: 'sigma', label: 'Encoder noise σ', min: 0, max: 5, step: 0.5, initial: 0, format: (v) => `${v.toFixed(1)} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const [px, pv] = leftPair(scene, ['position x(t) from the encoder', 'speed: slope at every t'], [POWER, HEAT], [(0 - DS.lo) / (DS.hi - DS.lo), 0.5])
    const yx = plotY(DS.lo, DS.hi, px.h)
    const yv = plotY(-DS.vMax, DS.vMax, pv.h)
    const trX = px.s.trace(POWER, { samples: 301, radius: 0.05 })
    const trTan = px.s.trace(B_FIELD, { samples: 2, radius: 0.05 })
    const trSec = px.s.trace(RING, { samples: 2, radius: 0.07 })
    const marks = [glowDot(px.s.group, 0.2, RING), glowDot(px.s.group, 0.2, RING)]
    const runT = dotLine(px.s.group, 0.06, 40)
    const riseX = dotLine(px.s.group, 0.06, 40)
    const tagT = liveLabel(px.s.group, [0, 0, 0.4], { size: 0.32 })
    const tagX = liveLabel(px.s.group, [0, 0, 0.4], { size: 0.32, align: 'left' })
    const trV = pv.s.trace(B_FIELD, { samples: 241, radius: 0.05 })
    const trEst = pv.s.trace(HEAT, { samples: 300, radius: 0.04 })
    const pe = titledScope(scene, WIDE_RIGHT.y, WIDE_RIGHT.h, 'error vs step Δt', LABEL, 0, WIDE_RIGHT.x, WIDE_RIGHT.w)
    const ye = plotY(0, DS.eMax, pe.h)
    const trTr = pe.s.trace(B_FIELD, { samples: 61, radius: 0.05 })
    const trNo = pe.s.trace(HEAT, { samples: 61, radius: 0.05 })
    const trAt = pe.s.trace(RING, { samples: 2, radius: 0.06 })

    const g = meterTrack(scene, [2.6, 1.2, 0], 15, [-0.05, 0.75])
    const bot = diffBot(add(g, new THREE.Group()))
    const ghost = diffBot(add(g, new THREE.Group()), { ghost: RING })
    const dxArrow = vecArrow(g, RING, 0.006, 0.05)
    const rows = textRows(scene, 4, 1.6, -2.3, 0.32, 0.75)
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { t, sigma, S, D } = dsRun(p)
        const T = 6
        const N = S.xs.length
        trX.points(S.xs.map((_, i) => i / (N - 1)), S.xs.map(yx), null)
        const [u0, u1] = [S.t0 / T, S.t1 / T]
        const [y0, y1] = [yx(S.x0), yx(S.x1)]
        const kSec = (y1 - y0) / (u1 - u0 || 1)
        const kTan = (yx(lineDriveAt('reverse', S.t0).x + S.truth) - yx(lineDriveAt('reverse', S.t0).x)) * T
        const ext = 0.12
        trSec.points(...lineIn(u0, y0, kSec, u0 - ext, u1 + ext, px.h), null)
        trTan.points(...lineIn(u0, yx(lineDriveAt('reverse', S.t0).x), kTan, u0 - 0.18, u0 + 0.18, px.h), null)
        const xAt = px.s.xAt
        marks[0].position.set(xAt(u0), y0, 0.35)
        marks[1].position.set(xAt(u1), y1, 0.35)
        runT([xAt(u0), y0, 0.3], [xAt(u1), y0, 0.3], LABEL)
        riseX([xAt(u1), y0, 0.3], [xAt(u1), y1, 0.3], LABEL)
        tagT.group.position.set(xAt((u0 + u1) / 2), y0 + (y1 >= y0 ? -0.45 : 0.45), 0.4)
        tagT.set(`Δt ${secsText(S.h)}`, LABEL)
        tagT.group.visible = u1 - u0 > 0.06
        tagX.group.position.set(xAt(u1) + 0.25, (y0 + y1) / 2, 0.4)
        tagX.set(`Δx ${cmText(S.dx)}`, LABEL)
        px.right.set(`x(t) = ${cmText(S.x0)}`, POWER)

        trV.draw((u) => yv(lineDriveAt('reverse', u * T).v), S.t0 / T)
        trEst.points(S.est.map((_, i) => (i * ENCODER_DT) / T), S.est.map(yv), Math.round(S.t0 / ENCODER_DT))
        pv.lo.set('0 s')
        pv.hi.set('6 s')
        pv.right.set(`Δx/Δt ${ms(S.slope)} · true ${ms(S.truth)}`, HEAT)

        const us = H_GRID.map(hU)
        trTr.points(us, D.rows.map((r) => ye(r.trunc)), null)
        trNo.points(us, D.rows.map((r) => ye(r.noise)), null)
        const ua = hU(S.h)
        trAt.points([ua, ua], [ye(0), ye(Math.abs(S.error))])
        pe.lo.set(`Δt ${secsText(DS.hMin)}`)
        pe.hi.set(`${secsText(DS.hMax)} (log)`)
        pe.right.set(`|error| ${fixedText(Math.abs(S.error), 3)} m/s`, RING)

        bot.set({ x: lineDriveAt('reverse', S.t0).x, y: 0, th: 0 })
        ghost.set({ x: lineDriveAt('reverse', S.t1).x, y: 0, th: 0 })
        dxArrow([lineDriveAt('reverse', S.t0).x, 0.15, 0.03], [lineDriveAt('reverse', S.t1).x, 0.15, 0.03], 'Δx', [0, 0.04, 0])

        rows[0].set(`Δx/Δt = ${fixedText(S.dx, 3)} m / ${secsText(S.h)}`, RING)
        rows[1].set(`= ${ms(S.slope)} vs dx/dt = ${ms(S.truth)}`, LABEL)
        rows[2].set(`curve bend: accel·Δt/2 ≈ ${signed(S.truncation, 3)} m/s`, B_FIELD)
        rows[3].set(sigma > 0 ? `noise √2·σ/Δt ≈ ±${fixedText(S.noiseGain, 3)} m/s${D.best ? ` · best Δt ≈ ${secsText(D.best)}` : ''}` : 'no noise: smaller Δt is always better', sigma > 0 ? HEAT : GREY)
        head.status.set(`Derivative as slope · t ${secsText(t)} · Δt ${secsText(S.h)} · σ ${mmTenths(sigma)}`)
        head.sub.set('top: position · bottom left: speed · robot = t, ghost = t + Δt', GREY)
        const big = Math.abs(S.error) > 0.05
        head.event.set(
          sigma > 0 && S.noiseGain > Math.abs(S.truncation) ? 'noise dominates: Δt too small, the slope jumps' : big ? 'Δt large: the secant cuts the curve, slope is off' : 'Δt small: secant ≈ tangent, slope ≈ speed',
          big || (sigma > 0 && S.noiseGain > Math.abs(S.truncation)) ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const { S } = dsRun(p)
        return [
          { label: 'Δx/Δt (m/s)', value: fixedText(S.slope) },
          { label: 'dx/dt (m/s)', value: fixedText(S.truth) },
          { label: 'Error (m/s)', value: fixedText(S.error), tone: toneOf(Math.abs(S.error) < 0.02, Math.abs(S.error) < 0.06) },
          { label: 'Noise (m/s)', value: `±${fixedText(S.noiseGain)}`, tone: toneOf(S.noiseGain < 0.02, S.noiseGain < 0.06) },
        ]
      },
    }
  },
}

// --- Integral as area: speed rectangles add up to distance; backing up is negative area. ---

const DRIVE_NAMES = { cruise: 'Always forward', reverse: 'Backs up mid-run' }
const IA = { vLo: -0.3, vHi: 0.45, T: 6, xHi: { cruise: 1.8, reverse: 0.8 } }
const iaRun = memoBy(
  (p: Params) => `${p.drive} ${p.T} ${p.n}`,
  (p: Params) => {
    const drive = pick(LINE_DRIVES, p.drive, 'reverse')
    const [T, N] = [n(p, 'T'), n(p, 'n')]
    return { drive, T, N, A: areaView(drive, T, N), full: areaView(drive, T, 200) }
  },
)

export const calculusIntegralAsArea: Lesson = {
  id: 'calculus-integral-as-area',
  title: 'Integral as area',
  tagline: 'Add up speed × time: the area under the speed curve is how far you went',
  formula: (p) => {
    const { T, N, A } = iaRun(p)
    return `x(T) = ∫₀ᵀ v dt ≈ Σ v(tᵢ)·Δt · ${N} rectangles, Δt = ${secsText(T / N)} → ${cmText(A.sum)} · exact ${cmText(A.exact)} · error ${signed(A.error * 100, 1)} cm · area below zero (backing up) counts negative: distance ∫|v| dt = ${cmText(A.distance)}`
  },
  legend: [
    { color: B_FIELD, label: 'Speed v(t)', shape: 'dot' },
    { color: POWER, label: 'Area above zero: forward', shape: 'dot' },
    { color: HIGH_V, label: 'Area below zero: backing up', shape: 'dot' },
    { color: HEAT, label: 'Rectangle sum = x(t)', shape: 'dot' },
  ],
  points: [
    'Drive at 0.3 m/s for 2 s and you go 0.6 m: speed × time. On a speed–time plot that is the area of a rectangle 2 s wide and 0.3 m/s tall. When the speed keeps changing, slice time into thin strips, treat the speed as constant in each, and add up the rectangles: Σ v·Δt.',
    'More, thinner rectangles hug the curve better and the sum closes in on the exact area (orange staircase vs the green x(t) below). That limit is the integral ∫ v dt. Integrating undoes differentiating: the slope of x(t) is v(t) (Derivative as slope), and the area under v(t) gives back x(t).',
    'Pick "Backs up mid-run": where v < 0 the strips hang below the axis and count negative. The net area is the displacement (where the robot ends up), while the total distance driven is the area of |v|. Odometry wants the signed one, a tyre-wear counter the other.',
    'Each rectangle is one pass of a robot loop: x += v·dt. That is dead reckoning: wheel speed integrated into position (Navigation › Odometry › Dead reckoning), and the area under a velocity plot in Mechanics › Kinematics › Velocity vs time plots.',
    'A PID I term is the same sum on the error: it keeps adding error × dt, so a small error that lasts grows a large area and pushes harder until the error is gone. If the motor saturates the area keeps growing anyway: Control › PID › Integral windup.',
  ],
  controls: [
    { kind: 'choice', key: 'drive', options: opts(DRIVE_NAMES), initial: 'reverse' },
    { kind: 'slider', key: 'T', label: 'Up to time T', min: 0.5, max: IA.T, step: 0.1, initial: 6, format: (v) => secsText(v) },
    { kind: 'slider', key: 'n', label: 'Rectangles', min: 1, max: 48, step: 1, initial: 8, format: (v) => `${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const [pv, px] = leftPair(scene, ['speed v(t): area = distance', 'position x(t) = area so far'], [B_FIELD, POWER], [-IA.vLo / (IA.vHi - IA.vLo), 0.1])
    const yv = plotY(IA.vLo, IA.vHi, pv.h)
    const fill = areaStrips(pv.s, 48)
    const trTops = pv.s.trace(HEAT, { samples: 100, radius: 0.04 })
    const trV = pv.s.trace(B_FIELD, { samples: 241, radius: 0.05 })
    const edge = pv.s.trace(RING, { samples: 2, radius: 0.04 })
    const trX = px.s.trace(POWER, { samples: 241, radius: 0.05 })
    const trSum = px.s.trace(HEAT, { samples: 100, radius: 0.05 })

    const g = meterTrack(scene, [1.8, 1.2, 0], 6.8, [-0.1, 1.8])
    const bot = diffBot(add(g, new THREE.Group()))
    bot.group.scale.setScalar(2)
    const ghost = diffBot(add(g, new THREE.Group()), { ghost: HEAT })
    ghost.group.scale.setScalar(2)
    const trail = pointCloud(g, 61, 0.012)
    const rows = textRows(scene, 3, 1.6, -2.2, 0.34, 0.75)
    const bars = countBars(scene, [6.2, -6.6, 0.2], ['forward', 'backing up', 'net ∫v dt', 'distance'], 6.4, { row: 1.8, size: 0.34 })
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { drive, T, N, A, full } = iaRun(p)
        const u = (t: number) => t / IA.T
        fill.set(A.strips.map((s) => ({ u0: u(s.t0), u1: u(s.t1), y0: yv(s.y0), y1: yv(s.y1), color: s.y0 >= 0 ? POWER : HIGH_V })), yv(0))
        trTops.points(...stripTops(A.strips, u, yv), null)
        trV.draw((x) => yv(lineDriveAt(drive, x * IA.T).v), u(T))
        edge.points([u(T), u(T)], [-pv.h / 2, pv.h / 2], null)
        pv.right.set(`${N} × Δt ${secsText(T / N)}`, HEAT)

        const yx = plotY(-IA.xHi[drive] / 9, IA.xHi[drive], px.h)
        trX.draw((x) => yx(lineDriveAt(drive, x * IA.T).x), u(T))
        trSum.points(A.running.map((_, i) => u((i * T) / N)), A.running.map(yx))
        px.lo.set('0 s')
        px.hi.set('6 s')
        px.right.set(`Σ ${cmText(A.sum)} · exact ${cmText(A.exact)}`, HEAT)

        bot.set({ x: A.exact, y: 0, th: 0 })
        ghost.set({ x: A.sum, y: 0, th: 0 })
        for (let i = 0; i <= 60; i++) {
          const t = (i / 60) * T
          const back = lineDriveAt(drive, t).v < 0
          trail.set(i, [lineDriveAt(drive, t).x, back ? -0.05 : 0.05, 0.005], back ? HIGH_V : POWER)
        }
        trail.show(61)

        const fwd = full.distance - full.back
        bars.set([fwd, full.back, Math.abs(full.exact), full.distance], [cmText(fwd), full.back > 0 ? `−${cmText(full.back)}` : cmText(0), cmText(full.exact), cmText(full.distance)], [POWER, HIGH_V, HEAT, B_FIELD])
        rows[0].set(`Σ v·Δt = ${cmText(A.sum)} (${N} rectangles)`, HEAT)
        rows[1].set(`∫v dt = ${cmText(A.exact)} · error ${signed(A.error * 100, 1)} cm`, Math.abs(A.error) < 0.01 ? POWER : LABEL)
        rows[2].set(full.back > 0 ? `backed up ${cmText(full.back)}: distance > displacement` : 'never reverses: distance = displacement', full.back > 0 ? HIGH_V : GREY)
        head.status.set(`Integral as area · ${DRIVE_NAMES[drive].toLowerCase()} · T ${secsText(T)} · ${N} strips`)
        head.sub.set('robot = exact x(T), orange ghost = rectangle sum · robot 2× size', GREY)
        head.event.set(Math.abs(A.error) < 0.01 ? 'thin strips: the sum is within 1 cm of the integral' : 'wide strips miss the curve: add more rectangles', Math.abs(A.error) < 0.01 ? POWER : HEAT)
      },
      readouts: (p) => {
        const { A } = iaRun(p)
        return [
          { label: 'Σ v·Δt', value: cmText(A.sum) },
          { label: '∫ v dt', value: cmText(A.exact) },
          { label: 'Error', value: `${signed(A.error * 100, 1)} cm`, tone: toneOf(Math.abs(A.error) < 0.01, Math.abs(A.error) < 0.04) },
          { label: 'Distance', value: cmText(A.distance), tone: A.back > 0 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Numerical integration: gyro rate → heading with left/right/midpoint/trapezoid/Simpson; error vs steps; bias drift. ---

const NI = { rLo: -20, rHi: 120, aLo: -60, aHi: 330, eLo: -4, eHi: 2, nMin: 2, nMax: 32 }
const N_GRID = Array.from({ length: (NI.nMax - NI.nMin) / 2 + 1 }, (_, i) => NI.nMin + 2 * i)
const niRun = memoBy(
  (p: Params) => `${p.rule} ${p.n} ${p.bias}`,
  (p: Params) => {
    const rule = pick(RULES, p.rule, 'left')
    const [N, bias] = [n(p, 'n'), n(p, 'bias')]
    return { rule, N, bias, G: gyroIntegrate(rule, N, bias), errs: ruleErrors(rule, N_GRID), ref: ruleErrors('left', N_GRID) }
  },
)
const niClock = lapseClock(TURN.T, 1, 1.5)
const errY = (h: number) => (e: number) => plotY(NI.eLo, NI.eHi, h)(Math.log10(Math.max(e, 10 ** NI.eLo)))

export const calculusNumericalIntegration: Lesson = {
  id: 'calculus-numerical-integration',
  title: 'Numerical integration',
  tagline: 'Gyro rate to heading: which slices you add up decides the error',
  formula: (p) => {
    const { rule, N, bias, G } = niRun(p)
    return `θ = ∫ ω dt · ${RULES[rule]} rule, ${N} steps of ${secsText(TURN.T / N)} → ${degText(G.final)} · true ${degText(G.truth)} · rule error ${signed(G.ruleError, 2)}° · bias ${signed(bias, 1)}°/s × ${TURN.T} s = ${signed(G.drift, 1)}° drift · total ${signed(G.error, 1)}°`
  },
  legend: [
    { color: B_FIELD, label: 'Gyro rate ω(t) and its slices', shape: 'dot' },
    { color: POWER, label: 'True heading θ(t)', shape: 'dot' },
    { color: HEAT, label: 'Integrated heading (ghost robot)', shape: 'dot' },
    { color: HIGH_V, label: 'Bias drift: bias × t', shape: 'dot' },
  ],
  points: [
    'A gyro measures turn rate ω in °/s, not the angle. To get the heading the robot adds up ω·Δt every loop: the area under the rate curve (Integral as area). With only samples, there are several ways to fill each slice, and they are not equally good.',
    'Left takes the rate at the start of each step, right at the end: on a rising curve one undershoots and the other overshoots, and the error halves when you double the steps (∝ 1/N). Midpoint samples the middle, trapezoid joins the ends with a straight line: their errors drop 4× per doubling (∝ 1/N²). Simpson fits a parabola through three samples: 16× per doubling (∝ 1/N⁴). The bottom-right plot shows it on a log scale.',
    'A real loop only has the samples it already read, so it uses left (θ += ω·Δt) or trapezoid (θ += (ωprev + ω)/2·Δt, one sample late). Midpoint and Simpson need a sample from between or ahead; they suit logged data. At a 100 Hz IMU loop all of them are already far better than the sensor.',
    'The error that matters is bias. A gyro reading 1°/s when still adds 1° every second whatever the rule: the drift grows in a straight line (red), 60° a minute. No integration rule can remove it, because it is in the data (Sensors › IMU › Drift, Gyroscope).',
    'So the gyro is trusted only for short moves and corrected by something that does not drift, an accelerometer or a magnetometer: Sensors › Sensor fusion › Complementary filter. Stepping a whole motion equation forward like this, and how the step size breaks it, is Maths › Differential equations.',
  ],
  controls: [
    { kind: 'choice', key: 'rule', options: opts(RULES), initial: 'left' },
    { kind: 'slider', key: 'n', label: 'Steps N', min: NI.nMin, max: NI.nMax, step: 2, initial: 4, format: (v) => `${v} (Δt ${secsText(TURN.T / v)})` },
    { kind: 'slider', key: 'bias', label: 'Gyro bias', min: -10, max: 10, step: 0.5, initial: 0, format: (v) => `${signed(v, 1)}°/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const [pr, pa] = leftPair(scene, ['gyro rate ω (°/s) and slices', 'heading θ = area so far'], [B_FIELD, POWER], [-NI.rLo / (NI.rHi - NI.rLo), -NI.aLo / (NI.aHi - NI.aLo)])
    const yr = plotY(NI.rLo, NI.rHi, pr.h)
    const ya = plotY(NI.aLo, NI.aHi, pa.h)
    const fill = areaStrips(pr.s, 4 * NI.nMax)
    const trTops = pr.s.trace(HEAT, { samples: 8 * NI.nMax, radius: 0.04 })
    const trR = pr.s.trace(B_FIELD, { samples: 201, radius: 0.05 })
    const trTrue = pa.s.trace(POWER, { samples: 201, radius: 0.05 })
    const trInt = pa.s.trace(HEAT, { samples: NI.nMax + 1, radius: 0.06 })
    const trDrift = pa.s.trace(HIGH_V, { samples: 2, radius: 0.04 })
    const pe = titledScope(scene, WIDE_RIGHT.y, WIDE_RIGHT.h, 'rule error vs steps (log)', LABEL, 0, WIDE_RIGHT.x, WIDE_RIGHT.w)
    const ye = errY(pe.h)
    const trRef = pe.s.trace(GREY, { samples: N_GRID.length, radius: 0.04 })
    const trErr = pe.s.trace(RING, { samples: N_GRID.length, radius: 0.06 })
    for (const d of [1, 0.01, 0.0001]) addLabel(pe.s.group, `${d}°`, [-pe.s.width / 2 + 0.2, ye(d) + 0.25, 0.4], GREY, 0.24, 'left')

    const g = floorView(scene, [8.2, 0.9, 0], 24, -0.35)
    floorMat(g, [-0.15, 0.15], [-0.14, 0.14])
    const bot = diffBot(add(g, new THREE.Group()))
    const ghost = diffBot(add(g, new THREE.Group()), { ghost: HEAT })
    const north = vecArrow(g, GREY, 0.003, 0.03)
    const sweep = pointCloud(g, 90, 0.005)
    const rows = textRows(scene, 3, 1.6, -3.6, 0.3, 0.75)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { rule, N, bias, G, errs, ref } = niRun(p)
        const T = TURN.T
        const now = niClock(dt, `${rule} ${N} ${bias}`)
        const u = (t: number) => t / T
        const ruleColor = (y: number) => (y >= 0 ? B_FIELD : HIGH_V)
        fill.set(G.strips.map((s) => ({ u0: u(s.t0), u1: u(s.t1), y0: yr(s.y0), y1: yr(s.y1), color: ruleColor(s.y0) })), yr(0))
        trTops.points(...stripTops(G.strips, u, yr), null)
        trR.draw((x) => yr(turnRate(x * T) + bias), u(now))
        pr.right.set(`${RULES[rule]} · ${N} × ${secsText(T / N)}`, HEAT)

        const k = Math.min(N, Math.floor((now / T) * N + 1e-9))
        trTrue.draw((x) => ya(turnAngle(x * T)), u(now))
        trInt.points(G.times.map(u), G.angles.map(ya), k)
        trDrift.points([0, 1], [ya(0), ya(bias * T)], null)
        trDrift.group.visible = bias !== 0
        pa.lo.set('0 s')
        pa.hi.set(`${T} s`)
        pa.right.set(`${degText(G.angles[k])} vs ${degText(turnAngle(G.times[k]))}`, HEAT)

        const nu = (m: number) => (m - NI.nMin) / (NI.nMax - NI.nMin)
        trRef.points(N_GRID.map(nu), ref.map(ye), null)
        trErr.points(N_GRID.map(nu), errs.map(ye), N_GRID.indexOf(N))
        trRef.group.visible = rule !== 'left'
        pe.lo.set(`N = ${NI.nMin}`)
        pe.hi.set(`${NI.nMax}`)
        pe.right.set(`${RULES[rule]}: ${fixedText(Math.abs(G.ruleError), Math.abs(G.ruleError) < 0.01 ? 4 : 2)}°`, RING)

        const rad = Math.PI / 180
        bot.set({ x: 0, y: 0, th: turnAngle(now) * rad })
        ghost.set({ x: 0, y: 0, th: G.angles[k] * rad })
        north([0, 0, 0.08], [0.17, 0, 0.08], '0°')
        const sw = turnAngle(now)
        for (let i = 0; i < 90; i++) {
          const a = (i / 89) * sw * rad
          sweep.set(i, [0.14 * Math.cos(a), 0.14 * Math.sin(a), 0.003], POWER)
        }
        sweep.show(sw > 1 ? 90 : 0)

        rows[0].set(`true ${degText(turnAngle(T))} · ${RULES[rule]} ${degText(G.final - G.drift)}`, LABEL)
        rows[1].set(`rule error ${signed(G.ruleError, 2)}° (${N} steps)`, Math.abs(G.ruleError) < 1 ? POWER : HEAT)
        rows[2].set(bias !== 0 ? `bias ${signed(bias, 1)}°/s × ${T} s = ${signed(G.drift, 1)}° drift` : 'no bias: only the rule error', bias !== 0 ? HIGH_V : GREY)
        head.status.set(`Numerical integration · ${RULES[rule]} · N ${N} · bias ${signed(bias, 1)}°/s`)
        head.sub.set(`gyro on a turning robot · ${secsText(now)} of ${T} s, real time · ghost = integrated`, GREY)
        const drifts = Math.abs(G.drift) > Math.abs(G.ruleError)
        head.event.set(drifts ? 'bias drift beats the rule error: more steps will not help' : Math.abs(G.ruleError) < 1 ? 'within 1°: the rule is good enough here' : 'coarse steps: try more steps or a better rule', drifts ? HIGH_V : Math.abs(G.ruleError) < 1 ? POWER : HEAT)
      },
      readouts: (p) => {
        const { G } = niRun(p)
        return [
          { label: 'Integrated θ', value: degText(G.final) },
          { label: 'True θ', value: degText(G.truth) },
          { label: 'Rule error', value: `${signed(G.ruleError, 2)}°`, tone: toneOf(Math.abs(G.ruleError) < 1, Math.abs(G.ruleError) < 5) },
          { label: 'Bias drift', value: `${signed(G.drift, 1)}°`, tone: toneOf(G.drift === 0, Math.abs(G.drift) < 5) },
        ]
      },
    }
  },
}
