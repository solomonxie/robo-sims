import * as THREE from 'three/webgpu'
import {
  CAL,
  DR,
  GROWTH,
  GYRO_ODO,
  HeadingSource,
  OdoMethod,
  TT_TRACK_M,
  TT_WHEEL_MM,
  cloudStats,
  covEllipse,
  deadReckonRun,
  growthRun,
  headingSigmaDeg,
  spinCal,
  straightCal,
} from '../../core/physics'
import { V3, add, box, mat } from '../../models/kit'
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
  addRod,
  chordPath,
  covRings,
  cursorBar,
  diffBot,
  emptyGroup,
  flatBox,
  floorMat,
  floorView,
  glowMat,
  liveLabel,
  memoBy,
  pointCloud,
  scope,
  simClock,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const mmOrCm = (m: number) => (Math.abs(m) < 0.1 ? `${(m * 1000).toFixed(Math.abs(m) < 0.01 ? 1 : 0)} mm` : `${(m * 100).toFixed(1)} cm`)
const errTone = (m: number) => (m < 0.01 ? 'ok' : m < 0.05 ? 'warn' : 'bad')
const niceTop = (v: number) => [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 1].find((t) => t >= v) ?? 1
const signed = (v: number, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`
const PLOT = { x: 8.6, y: 0.6, w: 10, h: 6.5, n: 300 }

function floorPlot(scene: THREE.Scene, title: string, color: string, right?: [string, string]) {
  const plot = scope(scene, PLOT.w, PLOT.h, { divs: [8, 5], zeroAt: 0 })
  plot.group.position.set(PLOT.x, PLOT.y, 0)
  addLabel(scene, title, [PLOT.x - PLOT.w / 2, PLOT.y + PLOT.h / 2 + 0.9, 0.3], color, 0.34, 'left')
  if (right) addLabel(scene, right[0], [PLOT.x + PLOT.w / 2, PLOT.y + PLOT.h / 2 + 0.9, 0.3], right[1], 0.34, 'right')
  const top = liveLabel(scene, right ? [PLOT.x, PLOT.y - PLOT.h / 2 - 1.8, 0.3] : [PLOT.x + PLOT.w / 2, PLOT.y + PLOT.h / 2 + 0.9, 0.3], { size: 0.34, color: GREY, align: right ? 'center' : 'right' })
  const axis = liveLabel(scene, [PLOT.x, PLOT.y - PLOT.h / 2 - 1, 0.3], { size: 0.34, color: GREY })
  return { plot, top, axis, yOf: (v: number, max: number) => (Math.min(1, v / max) - 0.5) * PLOT.h * 0.96 }
}

// --- Dead reckoning: whole ticks → pose at a loop rate, three ways to turn one update into motion. ---

const METHODS: Record<OdoMethod, string> = { euler: 'Euler (old heading)', midpoint: 'Mid-heading', exact: 'Exact arc' }
const ENCS = { disc: 'Slot disc 20/turn', hall1: 'Hall ×1: 528/turn', hall4: 'Hall ×4: 2112/turn' }
const CPR: Record<keyof typeof ENCS, number> = { disc: 20, hall1: 528, hall4: 2112 }
const RATES = [1, 2, 5, 10, 20, 50, 100]
const DRV = { at: [-7.4, -2.6, 0] as V3, k: 11, robotK: 1.6, slow: 3, hold: 2.5, maxDots: 420 }
const drParams = (p: Params) => {
  const method = pick(METHODS, p.method, 'euler') as OdoMethod
  const enc = pick(ENCS, p.enc, 'hall4') as keyof typeof ENCS
  return { method, enc, cpr: CPR[enc], hz: RATES[Math.round(n(p, 'rate'))] ?? 10 }
}
type DrQ = ReturnType<typeof drParams>
const drKey = (q: DrQ) => `${q.method}|${q.cpr}|${q.hz}`
const drRun = memoBy(drKey, (q: DrQ) => {
  const r = deadReckonRun(q.hz, q.cpr, q.method)
  return { ...r, top: niceTop(Math.max(...r.frames.map((f) => f.err))) }
})
const DR_FORMULA: Record<OdoMethod, string> = {
  euler: 'x += Δs·cos θ · y += Δs·sin θ · θ += Δθ',
  midpoint: 'x += Δs·cos(θ + Δθ/2) · y += Δs·sin(θ + Δθ/2) · θ += Δθ',
  exact: 'R = Δs/Δθ · x += R(sin θ′ − sin θ) · y −= R(cos θ′ − cos θ) · θ′ = θ + Δθ',
}

export const odometryDeadReckoning: Lesson = {
  id: 'odometry-dead-reckoning',
  title: 'Dead reckoning',
  tagline: 'Add up wheel ticks into a pose, one loop at a time',
  formula: (p) => `Δs = (ΔL + ΔR)/2 · Δθ = (ΔR − ΔL)/b · ${DR_FORMULA[drParams(p).method]}`,
  legend: [
    { color: LABEL, label: 'True robot and its path', shape: 'dot' },
    { color: RING, label: 'Odometry estimate: one corner per update', shape: 'dot' },
    { color: HIGH_V, label: 'Error: true − estimate', shape: 'dot' },
    { color: GREY, label: 'Figure-eight it drives (0.8 m loops)', shape: 'dot' },
  ],
  points: [
    'Every loop the firmware reads both encoder counts, turns the change into wheel travel ΔL, ΔR (ticks × mm per tick) and adds one small move to the pose: Δs forward, Δθ of turn. Nothing else is measured, so the pose is the sum of every update since power-on.',
    'In one update the robot really drove an arc. Euler pretends it went straight along the old heading and cuts every bend wide; mid-heading aims along the average heading (error ∝ Δθ³); the exact arc is right whenever wheel speeds held steady. At 1–2 Hz on 0.4 m circles the choice matters; above ~10 Hz the three agree.',
    'Between updates the estimate is stale: at 1 Hz it trails the robot by up to 30 cm. Coarse ticks add their own floor: one 10 mm slot on a 130 mm track is a 4.4° heading step, which no loop rate fixes.',
    'Each lap ends on the start because all three sum Δθ exactly. What this lesson hides are wrong wheel sizes and slip; those, not the arithmetic, make real odometry drift (see Error growth, and Mobility → Differential drive → Odometry).',
  ],
  controls: [
    { kind: 'choice', key: 'method', options: opts(METHODS), initial: 'euler' },
    { kind: 'slider', key: 'rate', label: 'Odometry loop', min: 0, max: RATES.length - 1, step: 1, initial: 1, format: (v) => `${RATES[Math.round(v)]} Hz` },
    { kind: 'choice', key: 'enc', options: opts(ENCS), initial: 'hall4' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17.5, 7.4, 0.3], { size: 0.44, align: 'left' })
    const sub = liveLabel(scene, [-17.5, 6.4, 0.3], { size: 0.32, color: GREY, align: 'left' })
    const g = floorView(scene, DRV.at, DRV.k, -0.6)
    const w = add(g, new THREE.Group())
    w.rotation.z = Math.PI / 2
    floorMat(w, [-0.55, 1.05], [-0.92, 0.92])
    const plan = pointCloud(w, DRV.maxDots, 0.005)
    const truePath = pointCloud(w, DRV.maxDots, 0.006)
    const knots = pointCloud(w, 2200, 0.011)
    const chords = chordPath(w, 2200, RING, 0.005)
    const bot = diffBot(w)
    const ghost = diffBot(w, { ghost: RING })
    bot.group.scale.setScalar(DRV.robotK)
    ghost.group.scale.setScalar(DRV.robotK)
    const errRod = addRod(w, glowMat(HIGH_V, 1))
    const errTag = liveLabel(g, [0, 0, 0.1], { size: 0.06, color: HIGH_V })
    const { plot, top, axis, yOf } = floorPlot(scene, 'error |true − estimate|', HIGH_V)
    const trace = plot.trace(HIGH_V, { samples: PLOT.n, radius: 0.07 })
    const cur = cursorBar(plot, LABEL, 0.06)
    const clock = simClock(DR.frameS / DRV.slow, DRV.hold)
    const st = { key: '', us: [] as number[], ys: [] as number[], kt: [] as number[] }
    return {
      scene,
      view: { center: [-1.5, 0, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = drParams(p)
        const key = drKey(q)
        const r = drRun(q)
        const i = Math.floor(clock(dt, key, r.frames.length - 1))
        const f = r.frames[i]
        if (key !== st.key) {
          st.key = key
          const stride = Math.ceil(r.frames.length / DRV.maxDots)
          for (let k = 0; k * stride < r.frames.length; k++) plan.set(k, [r.frames[k * stride].truth.x, r.frames[k * stride].truth.y, 0.003], GREY)
          plan.show(Math.ceil(r.frames.length / stride))
          r.frames.slice(0, DRV.maxDots).forEach((h, k) => truePath.set(k, [h.truth.x, h.truth.y, 0.004], LABEL))
          r.knots.forEach((h, k) => knots.set(k, [h.x, h.y, 0.01], RING))
          st.kt = r.knots.map((_, k) => Math.min(r.tEnd, k / q.hz))
          st.us = []
          st.ys = []
          const ps = Math.max(1, Math.ceil(r.frames.length / PLOT.n))
          for (let k = 0; k < r.frames.length; k += ps) {
            st.us.push(r.frames[k].t / r.tEnd)
            st.ys.push(yOf(r.frames[k].err, r.top))
          }
          top.set(`0 … ${mmOrCm(r.top)}`, GREY)
          axis.set(`${Math.round(r.tEnd)} s, ${(r.tEnd * DR.v).toFixed(1)} m · worst at an update ${mmOrCm(r.maxErr)}`, GREY)
        }
        truePath.show(Math.min(DRV.maxDots, i + 1))
        let nk = 0
        while (nk < st.kt.length && st.kt[nk] <= f.t + 1e-9) nk++
        knots.show(nk)
        chords(r.knots, nk)
        let upto = 0
        while (upto < st.us.length && st.us[upto] <= f.t / r.tEnd) upto++
        trace.points(st.us.slice(0, upto), st.ys.slice(0, upto))
        cur(f.t / r.tEnd)
        bot.set(f.truth, f.t * DR.v, f.t * DR.v)
        ghost.set(f.est)
        errRod.visible = f.err > 0.004
        stretchRod(errRod, [f.est.x, f.est.y, 0.03], [f.truth.x, f.truth.y, 0.03], 0.004)
        const [ex, ey] = [(f.est.x + f.truth.x) / 2, (f.est.y + f.truth.y) / 2]
        errTag.group.position.set(-ey + 0.2, ex + 0.06, 0.1)
        errTag.set(f.err > 0.004 ? mmOrCm(f.err) : '', HIGH_V)
        status.set(`${METHODS[q.method]} at ${q.hz} Hz · update ${Math.max(0, nk - 1)} · off by ${mmOrCm(f.err)}`, f.err < 0.01 ? POWER : f.err < 0.05 ? HEAT : HIGH_V)
        sub.set(`TT car, ${q.cpr} ticks per wheel turn, ${(r.tickM * 1000).toFixed(2)} mm per tick · robot drawn ${DRV.robotK}× · ${DRV.slow}× faster · t ${f.t.toFixed(1)} s`)
      },
      readouts: (p) => {
        const q = drParams(p)
        const r = drRun(q)
        const ds = DR.v / q.hz
        return [
          { label: 'Worst error at an update', value: mmOrCm(r.maxErr), tone: errTone(r.maxErr) },
          { label: 'Error at the end', value: mmOrCm(r.endErr), tone: errTone(r.endErr) },
          { label: 'One update on a loop', value: `Δs ${mmOrCm(ds)} · Δθ ${((ds / 0.4) * (180 / Math.PI)).toFixed(1)}°` },
          { label: 'One tick', value: `${(r.tickM * 1000).toFixed(2)} mm · ${((r.tickM / TT_TRACK_M) * (180 / Math.PI)).toFixed(2)}° of turn` },
        ]
      },
    }
  },
}

// --- Error growth: 40 noisy runs of the same drive; random spread follows the Jacobian covariance, systematic error shifts them all. ---

const SOURCES: Record<HeadingSource, string> = { wheels: 'Heading from wheels', gyro: 'Heading from a gyro' }
const GRW = { at: [-7.6, -2.2, 0] as V3, k: 7.8, robotK: 1.2, slow: 2, hold: 2.5, ringEvery: 0.5 }
const grParams = (p: Params) => ({ k: n(p, 'noise'), tyre: n(p, 'tyre'), src: pick(SOURCES, p.src, 'wheels') as HeadingSource })
type GrQ = ReturnType<typeof grParams>
const grKey = (q: GrQ) => `${q.k}|${q.tyre}|${q.src}`
const grRun = memoBy(grKey, (q: GrQ) => {
  const r = growthRun(q.k, q.tyre, q.src)
  const rand = r.frames.map((f) => covEllipse(f.P).a)
  const sys = r.frames.map((f) => Math.hypot(f.bias.x - f.truth.x, f.bias.y - f.truth.y))
  const ringAt: number[] = []
  r.frames.forEach((f, i) => {
    if (i > 0 && Math.floor((f.t * GROWTH.v) / GRW.ringEvery) > Math.floor((r.frames[i - 1].t * GROWTH.v) / GRW.ringEvery)) ringAt.push(i)
  })
  return { ...r, rand, sys, ringAt, top: niceTop(Math.max(...rand, ...sys)), end: cloudStats(r.frames.at(-1)!.runs) }
})

export const odometryErrorGrowth: Lesson = {
  id: 'odometry-error-growth',
  title: 'Error growth',
  tagline: 'Random slips spread out, wrong sizes push everything aside',
  formula: (p) => {
    const q = grParams(p)
    const head = q.src === 'gyro' ? `σ²Δθ = ARW²·Δt (${GYRO_ODO.arwDps}°/√s)` : 'σ²Δθ = k²(|ΔL| + |ΔR|)/b²'
    return `σ²wheel = k²·|d| · P′ = F·P·Fᵀ + G·Q·Gᵀ · F = ∂pose′/∂pose, G = ∂pose′/∂(Δs, Δθ) · ${head} · ellipse = 2σ of P(x, y)`
  },
  legend: [
    { color: LABEL, label: 'True robot and path', shape: 'dot' },
    { color: B_FIELD, label: '40 estimates with random wheel noise', shape: 'dot' },
    { color: RING, label: 'Noise-free estimate + 2σ ellipses (Jacobians)', shape: 'dot' },
    { color: HEAT, label: 'Systematic offset: true → estimate', shape: 'dot' },
  ],
  points: [
    'Two kinds of odometry error. Systematic: a tyre 0.6 % too big, a track a little wider than in code. Every run makes the same mistake, so it is fixable by calibration. Random: tread on grit, a seam in the floor, tick rounding. Every run differs; you can only bound it.',
    'Random errors add like a random walk: wheel variance grows with distance, σ² = k²|d|. Position spread grows faster than that, because a heading wobble early on swings every metre after it: lateral σ grows like d^1.5. That is why the cloud fans out sideways (a "banana") and the 2σ ellipses get long across the path.',
    'You don\'t need 40 runs to know the spread: push the 3×3 covariance P through each step with the Jacobians F (how pose errors carry forward) and G (how new wheel noise enters). The ellipses drawn are that prediction; the cyan dots are the Monte Carlo check.',
    'A gyro measures turn without the wheels, so heading noise stays tiny and the spread collapses; its own systematic errors (bias 0.05 °/s, 1 % scale) are far smaller than a 1 % tyre. Distance still comes from the wheels, so a wrong tyre size still stretches the path. Both still drift without bound; landmarks, lidar or GPS must pin the pose (see Localization).',
  ],
  controls: [
    { kind: 'slider', key: 'noise', label: 'Wheel noise k', min: 0.5, max: 5, step: 0.5, initial: 3, format: (v) => `${v.toFixed(1)} mm/√m` },
    { kind: 'slider', key: 'tyre', label: 'Right tyre vs left', min: -2, max: 2, step: 0.2, initial: 0.6, format: (v) => `${signed(v)} %` },
    { kind: 'choice', key: 'src', options: opts(SOURCES), initial: 'wheels' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17.5, 7.4, 0.3], { size: 0.44, align: 'left' })
    const sub = liveLabel(scene, [-17.5, 6.4, 0.3], { size: 0.32, color: GREY, align: 'left' })
    const g = floorView(scene, GRW.at, GRW.k, -0.6)
    const w = add(g, new THREE.Group(), [-0.9, -0.75, 0])
    floorMat(w, [-0.25, 2.05], [-0.35, 1.75])
    const maxF = 200
    const plan = pointCloud(w, maxF, 0.006)
    const biasPath = pointCloud(w, maxF, 0.007)
    const cloud = pointCloud(w, maxF * GROWTH.runs, 0.0035)
    const heads = pointCloud(w, GROWTH.runs, 0.011)
    const rings = covRings(w, 14, RING, { width: 0.005 })
    const now = covRings(w, 1, RING, { width: 0.009, z: 0.016 })
    const bot = diffBot(w)
    bot.group.scale.setScalar(GRW.robotK)
    const ghost = diffBot(w, { ghost: RING })
    ghost.group.scale.setScalar(GRW.robotK)
    const sysRod = addRod(w, glowMat(HEAT, 1))
    const { plot, top, axis, yOf } = floorPlot(scene, '2σ spread', RING, ['systematic', HEAT])
    const tRand = plot.trace(RING, { samples: PLOT.n, radius: 0.07 })
    const tSys = plot.trace(HEAT, { samples: PLOT.n, radius: 0.07 })
    const cur = cursorBar(plot, LABEL, 0.06)
    const clock = simClock((GROWTH.dt * GROWTH.every) / GRW.slow, GRW.hold)
    const st = { key: '', us: [] as number[], yr: [] as number[], ys: [] as number[] }
    const c = new THREE.Color(B_FIELD).multiplyScalar(0.45)
    return {
      scene,
      view: { center: [-1.5, 0, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = grParams(p)
        const key = grKey(q)
        const r = grRun(q)
        const i = Math.floor(clock(dt, key, r.frames.length - 1))
        const f = r.frames[i]
        if (key !== st.key) {
          st.key = key
          r.frames.forEach((h, k) => {
            plan.set(k, [h.truth.x, h.truth.y, 0.003], GREY)
            biasPath.set(k, [h.bias.x, h.bias.y, 0.006], RING)
            h.runs.forEach((e, j) => cloud.set(k * GROWTH.runs + j, [e.x, e.y, 0.005], c))
          })
          plan.show(r.frames.length)
          st.us = r.frames.map((h) => h.t / r.tEnd)
          st.yr = r.rand.map((v) => yOf(v, r.top))
          st.ys = r.sys.map((v) => yOf(v, r.top))
          top.set(`full scale ${mmOrCm(r.top)}`, GREY)
          axis.set(`${Math.round(r.tEnd)} s, ${r.distM.toFixed(1)} m driven`, GREY)
        }
        biasPath.show(i + 1)
        cloud.show((i + 1) * GROWTH.runs)
        f.runs.forEach((e, j) => heads.set(j, [e.x, e.y, 0.012], B_FIELD))
        heads.show(GROWTH.runs)
        rings(r.ringAt.filter((k) => k <= i).map((k) => [r.frames[k].bias.x, r.frames[k].bias.y, r.frames[k].P]))
        now([[f.bias.x, f.bias.y, f.P]])
        tRand.points(st.us.slice(0, i + 1), st.yr.slice(0, i + 1))
        tSys.points(st.us.slice(0, i + 1), st.ys.slice(0, i + 1))
        cur(f.t / r.tEnd)
        bot.set(f.truth, f.t * GROWTH.v, f.t * GROWTH.v)
        ghost.set(f.bias)
        sysRod.visible = r.sys[i] > 0.004
        stretchRod(sysRod, [f.truth.x, f.truth.y, 0.03], [f.bias.x, f.bias.y, 0.03], 0.004)
        const e = covEllipse(f.P)
        status.set(`2σ spread ${mmOrCm(e.a)} × ${mmOrCm(e.b)} · systematic ${mmOrCm(r.sys[i])}`, r.sys[i] > e.a ? HEAT : RING)
        sub.set(`${SOURCES[q.src]} · 40 runs, same drive, fresh noise · robot drawn ${GRW.robotK}× · ${GRW.slow}× faster · t ${f.t.toFixed(1)} s`)
      },
      readouts: (p) => {
        const q = grParams(p)
        const r = grRun(q)
        const last = r.frames.at(-1)!
        const e = covEllipse(last.P)
        return [
          { label: 'Random 2σ at the end', value: `${mmOrCm(e.a)} × ${mmOrCm(e.b)}`, tone: errTone(e.a / 4) },
          { label: 'Monte Carlo vs predicted', value: `${mmOrCm(r.end.rms)} vs ${mmOrCm(Math.sqrt(last.P[0][0] + last.P[1][1]))} rms` },
          { label: 'Systematic offset', value: mmOrCm(r.sys.at(-1)!), tone: errTone(r.sys.at(-1)! / 4) },
          { label: 'Heading 1σ', value: `${headingSigmaDeg(last.P).toFixed(2)}°` },
        ]
      },
    }
  },
}

// --- Calibrating wheel size: drive a taped distance (or spin whole turns) by odometry, measure, rescale. ---

const MODES = { straight: 'Straight run → wheel size', spin: 'Spin in place → track' }
type CalMode = keyof typeof MODES
const CALV = { at: [-1.5, 0.4, 0] as V3, len: 30, v: 0.3, spinW: 2.1, run: 4, hold: 1.6, spinAt: [-1.5, 1.5, 0] as V3, spinK: 17, nose: 0.3 }
const calParams = (p: Params) => {
  const mode = pick(MODES, p.mode, 'straight') as CalMode
  const err = n(p, 'err')
  const size = n(p, 'size')
  return { mode, err, size, s: straightCal(err, size), sp: spinCal(err, size) }
}
type CalQ = ReturnType<typeof calParams>
const ANIM = 2 * (CALV.run + CALV.hold)

export const odometryCalibratingWheelSize: Lesson = {
  id: 'odometry-calibrating-wheel-size',
  title: 'Calibrating wheel size',
  tagline: 'One tape measure turns a 2 % error into 0.04 %',
  formula: (p) => {
    const q = calParams(p)
    return q.mode === 'straight'
      ? `D = D₀ × real / odometry = ${TT_WHEEL_MM} mm × ${q.s.measM.toFixed(3)} / ${q.s.odoM.toFixed(3)} = ${q.s.calMm.toFixed(2)} mm · residual ≈ reading error / distance`
      : `b = b₀ × odometry / real = ${TT_TRACK_M * 1000} mm × ${q.sp.odoDeg}° / ${q.sp.measDeg.toFixed(1)}° = ${(q.sp.calM * 1000).toFixed(1)} mm · residual ≈ reading error / total angle`
  },
  legend: [
    { color: RING, label: 'Where odometry says it stopped', shape: 'dot' },
    { color: HEAT, label: 'Run 1: real stop, old value', shape: 'dot' },
    { color: POWER, label: 'Run 2: after calibration', shape: 'dot' },
    { color: GREY, label: 'Tape / start line', shape: 'dot' },
  ],
  points: [
    'Odometry converts ticks to metres with a number you typed in: 65 mm on the box. Real tyres are 64–67 mm, squash under load and wear down, and a 2 % size error is 2 cm per metre, on every move.',
    'Straight test: tell the robot to drive 5 m by odometry, tape-measure where it really stopped, and scale: D = D₀ × real/odometry. Your tape reading (±2 mm) is the only error left, and it is divided by the run length, so drive as far as the room allows.',
    'Spin test for the track b: spin 5 whole turns in place by odometry, see how far past or short of the start line the nose ends, and scale: b = b₀ × odometry angle/real angle. The effective track is set by where the tyres scrub, not by a ruler between treads; more turns divide the 1° protractor error further.',
    'Size the wheels first (straight runs don\'t depend on b), then the track. One wheel bigger than the other bends straight lines; UMBmark separates that from the track error (see Mobility → Differential drive → Odometry).',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'straight' },
    { kind: 'slider', key: 'err', label: 'Real size vs value in code', min: -4, max: 4, step: 0.5, initial: 2, format: (v) => `${signed(v)} %` },
    { kind: 'slider', key: 'size', label: 'Test run', min: 1, max: 10, step: 1, initial: 5, format: (v) => `${v} m · ${v} turns` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17.5, 7.4, 0.3], { size: 0.44, align: 'left' })
    const sub = liveLabel(scene, [-17.5, 6.4, 0.3], { size: 0.32, color: GREY, align: 'left' })
    const lines = [0, 1, 2, 3].map((k) => liveLabel(scene, [-8, -3.3 - k * 1.2, 0.3], { size: 0.46, align: 'left' }))
    const strip = new THREE.Group()
    scene.add(strip)
    const spinG = floorView(scene, CALV.spinAt, CALV.spinK, -0.7)
    floorMat(spinG, [-0.36, 0.36], [-0.3, 0.3])
    flatBox(spinG, [CALV.nose, 0.006, 0.004], glowMat(GREY, 0.8), [CALV.nose / 2, 0, 0.004])
    addLabel(spinG, 'start line', [0.25, -0.035, 0.01], GREY, 0.02)
    const spinBot = diffBot(spinG)
    spinBot.group.scale.setScalar(1.5)
    const noses = [RING, HEAT, POWER].map((col) => addRod(spinG, glowMat(col, 1)))
    const angTag = liveLabel(spinG, [0.2, 0.16, 0.02], { size: 0.028, color: HEAT })
    const st = { key: '', t: 0, k: 1, bot: null as ReturnType<typeof diffBot> | null, marks: [] as THREE.Object3D[], tags: [] as ReturnType<typeof liveLabel>[] }
    const buildStrip = (q: CalQ) => {
      emptyGroup(strip)
      const L = q.size + 0.8
      const k = CALV.len / L
      st.k = k
      const g = floorView(strip, [CALV.at[0] - CALV.len / 2 + 0.3 * k, CALV.at[1], 0], k, -0.95)
      floorMat(g, [-0.3, L - 0.3], [-0.22, 0.22])
      box(g, [q.size + 0.2, 0.025, 0.003], mat('#e8c547', { rough: 0.5 }), [(q.size + 0.2) / 2 - 0.1, -0.16, 0.003])
      const step = q.size > 5 ? 1 : 0.5
      for (let x = 0; x <= q.size + 1e-9; x += step) {
        flatBox(g, [0.004 * (12 / k), 0.03, 0.002], mat('#2a2c32'), [x, -0.16, 0.006])
        addLabel(g, `${x} m`, [x, -0.21, 0.01], GREY, 0.5 / k)
      }
      st.bot = diffBot(g)
      st.bot.group.scale.setScalar(Math.max(1, 9 / k))
      st.marks = [RING, HEAT, POWER].map((col) => box(g, [0.06 / k, 0.3 + 4.5 / k, 0.006], glowMat(col, 1), [0, 2.25 / k, 0.006]))
      st.tags = [RING, HEAT, POWER].map((col) => liveLabel(g, [0, 0, 0.02], { size: 0.42 / k, color: col, align: 'right' }))
    }
    return {
      scene,
      view: { center: [-1.5, 0, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = calParams(p)
        const key = `${q.mode}|${q.err}|${q.size}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          if (q.mode === 'straight') buildStrip(q)
          else emptyGroup(strip)
        }
        st.t = (st.t + dt) % ANIM
        const run2 = st.t >= CALV.run + CALV.hold
        const u = Math.min(1, (st.t - (run2 ? CALV.run + CALV.hold : 0)) / CALV.run)
        spinG.visible = q.mode === 'spin'
        const say = (k: number, s: string, col = LABEL) => lines[k].set(s, col)
        if (q.mode === 'straight' && st.bot) {
          const s = q.s
          const r2 = q.size + s.after
          const x = (run2 ? r2 : s.realM) * u
          st.bot.set({ x, y: 0, th: 0 }, x, x)
          const show = [true, run2 || u >= 1, run2 && u >= 1]
          const xs = [q.size, s.realM, r2]
          st.marks.forEach((m, j) => {
            m.visible = show[j]
            m.position.x = xs[j]
          })
          st.tags.forEach((tg, j) => {
            tg.group.position.set(xs[j] - 0.15 / st.k, 0.12 + (0.9 + j * 1.1) / st.k, 0.02)
            tg.group.visible = show[j]
          })
          st.tags[0].set(`odometry ${q.size} m`, RING)
          st.tags[1].set(`run 1: ${s.realM.toFixed(3)} m`, HEAT)
          st.tags[2].set(`run 2: ${r2.toFixed(4)} m`, POWER)
          status.set(run2 ? `Run 2 with D = ${s.calMm.toFixed(2)} mm: ${mmOrCm(Math.abs(s.after))} off` : `Run 1: drive ${q.size} m by odometry with D = ${TT_WHEEL_MM} mm`, run2 ? POWER : HEAT)
          sub.set(`${s.ticks.toLocaleString('en-US')} ticks · ${CAL.ticksPerRev} per wheel turn · real tyre ${s.trueMm.toFixed(2)} mm · ${(s.realM / CALV.v / CALV.run).toFixed(0)}× faster`)
          say(0, `Odometry: ${s.odoM.toFixed(4)} m (${s.ticks} ticks × ${((Math.PI * TT_WHEEL_MM) / CAL.ticksPerRev).toFixed(4)} mm)`, RING)
          say(1, `Tape: ${s.measM.toFixed(3)} m (read ${CAL.readMm} mm long)`, HEAT)
          say(2, `D = ${TT_WHEEL_MM} × ${s.measM.toFixed(3)} / ${s.odoM.toFixed(3)} = ${s.calMm.toFixed(2)} mm (really ${s.trueMm.toFixed(2)})`)
          say(3, `Left over: ${signed(s.residual * 100, 3)} % → ${mmOrCm(Math.abs(s.after))} on ${q.size} m`, POWER)
        } else {
          const s = q.sp
          const total = run2 ? s.odoDeg + s.after : s.realDeg
          const th = (total * u * Math.PI) / 180
          spinBot.set({ x: 0, y: 0, th }, (-th * TT_TRACK_M) / 2, (th * TT_TRACK_M) / 2)
          const ends = [0, ((s.realDeg - s.odoDeg) * Math.PI) / 180, (s.after * Math.PI) / 180]
          const show = [true, run2 || u >= 1, run2 && u >= 1]
          noses.forEach((rod, j) => {
            rod.visible = show[j] && (j === 0 || Math.abs(ends[j]) > 0.002 || j === 2)
            stretchRod(rod, [0, 0, 0.012 + j * 0.002], [CALV.nose * Math.cos(ends[j]), CALV.nose * Math.sin(ends[j]), 0.012 + j * 0.002], 0.004)
          })
          const off = s.realDeg - s.odoDeg
          angTag.group.position.set(CALV.nose * Math.cos(ends[1] / 2) + 0.02, CALV.nose * Math.sin(ends[1] / 2) + 0.03 * Math.sign(off), 0.02)
          angTag.group.visible = show[1]
          angTag.set(`${signed(off)}°`, HEAT)
          status.set(run2 ? `Run 2 with b = ${(s.calM * 1000).toFixed(1)} mm: ${Math.abs(s.after).toFixed(1)}° off` : `Run 1: spin ${q.size} turns by odometry with b = ${TT_TRACK_M * 1000} mm`, run2 ? POWER : HEAT)
          sub.set(`Real track ${(s.trueM * 1000).toFixed(1)} mm · spin ${((s.realDeg / 360) * (2 * Math.PI / CALV.spinW) / CALV.run).toFixed(0)}× faster · ${run2 ? 'run 2' : 'run 1'} · turned ${((total * u) / 360).toFixed(2)} turns`)
          say(0, `Odometry: ${q.size} × 360° = ${s.odoDeg}°`, RING)
          say(1, `Protractor: ${s.measDeg.toFixed(1)}° (${signed(off)}° vs the line, read ${CAL.readDeg}° over)`, HEAT)
          say(2, `b = ${TT_TRACK_M * 1000} × ${s.odoDeg} / ${s.measDeg.toFixed(1)} = ${(s.calM * 1000).toFixed(2)} mm (really ${(s.trueM * 1000).toFixed(2)})`)
          say(3, `Left over: ${signed(s.residual * 100, 3)} % → ${signed(s.after, 2)}° on ${s.odoDeg}°`, POWER)
        }
      },
      readouts: (p) => {
        const q = calParams(p)
        if (q.mode === 'straight')
          return [
            { label: 'Run 1 off by', value: mmOrCm(Math.abs(q.s.realM - q.size)), tone: errTone(Math.abs(q.s.realM - q.size)) },
            { label: 'Calibrated D', value: `${q.s.calMm.toFixed(2)} mm` },
            { label: 'Run 2 off by', value: mmOrCm(Math.abs(q.s.after)), tone: errTone(Math.abs(q.s.after)) },
            { label: 'Left-over error', value: `${(Math.abs(q.s.residual) * 100).toFixed(3)} %` },
          ]
        const off = q.sp.realDeg - q.sp.odoDeg
        return [
          { label: 'Run 1 off by', value: `${signed(off)}°`, tone: Math.abs(off) < 2 ? 'ok' : Math.abs(off) < 10 ? 'warn' : 'bad' },
          { label: 'Calibrated b', value: `${(q.sp.calM * 1000).toFixed(2)} mm` },
          { label: 'Run 2 off by', value: `${signed(q.sp.after, 2)}°`, tone: Math.abs(q.sp.after) < 2 ? 'ok' : 'warn' },
          { label: 'Left-over error', value: `${(Math.abs(q.sp.residual) * 100).toFixed(3)} %` },
        ]
      },
    }
  },
}
