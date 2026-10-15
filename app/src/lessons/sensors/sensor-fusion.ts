import * as THREE from 'three/webgpu'
import type { CompRun } from '../../core/physics'
import { COMP, FUSE, REBAR_AT, compRun, crossoverHz, fuseRun, gaussPdf, highGain, kalmanRun, kfSteady, lowGain, wrapPi } from '../../core/physics'
import { V3, add, box, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CLK_COLOR,
  DATA_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  addLabel,
  flatBox,
  glowMat,
  liveLabel,
  memoBy,
  robotCar,
  scope,
  setGlow,
  shadowlessRod,
  stretchRod,
  ticks,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'

const textLines = (scene: THREE.Scene, T0: V3) => {
  const [a, b, c] = [0, 1, 2].map((i) => liveLabel(scene, [T0[0], T0[1] - i * 1.2, 0], { size: 0.5, align: 'left' }))
  const status = liveLabel(scene, [T0[0], T0[1] - 3.7, 0], { size: 0.38, align: 'left' })
  return { a, b, c, status }
}
const DEG = Math.PI / 180
const sgn = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`
const metres = (v: number) => (v < 1 ? `${Math.round(v * 100)} cm` : `${v.toFixed(2)} m`)
const smooth = (f: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, f)))

/** A small robot car on a moving group, wheels on y = 0. */
function carOn(scene: THREE.Scene, k = 0.3) {
  const g = add(scene, new THREE.Group())
  robotCar(g, [0, 2.3 * k, 0], k)
  return g
}

// --- Why fuse: a robot on a 20 m track; odometry drifts, GPS is noisy, marker posts are exact but rare; a Kalman filter blends them. ---

const USES: Record<'all' | 'gps' | 'posts', string> = { all: 'All three', gps: 'Odometry + GPS', posts: 'Odometry + posts' }
const WF = { x0: -16, perM: 1.6, trackY: -1.4, rows: [4.6, 3.7, 2.8, 1.9], plotY: -7, plotW: 30, plotH: 4.6, errM: 3 }
const ROWS = [
  { name: 'odometry', color: CLK_COLOR },
  { name: 'GPS', color: HIGH_V },
  { name: 'last post', color: DATA_COLOR },
  { name: 'fused', color: POWER },
]
const wfRun = memoBy(
  (p: Params) => `${p.slip}|${p.gps}|${p.use}`,
  (p: Params) => {
    const use = pick(USES, p.use, 'all') as keyof typeof USES
    const slip = n(p, 'slip') / 100
    const gps = n(p, 'gps')
    const r = fuseRun(slip, gps, { gps: use !== 'posts', posts: use !== 'gps' })
    return { use, slip, gps, r, best: Math.min(r.err.odo, r.err.gps, r.err.post) }
  },
)

export const whyFuse: Lesson = {
  id: 'sensor-fusion-why-fuse',
  title: 'Why fuse',
  tagline: 'Odometry drifts, GPS jitters, landmarks come rarely; blended by how much each is trusted, they beat every one alone',
  formula: (p) => {
    const W = wfRun(p)
    const e = W.r.err
    return `predict: x̂ += Δodo, P += q·Δs · each fix z (σ): K = P / (P + σ²), x̂ += K (z − x̂), P ×= (1 − K) · GPS σ = ${W.gps} m, post σ = ${FUSE.postSigma * 100} cm · rms: odo ${metres(e.odo)}, GPS ${metres(e.gps)}, post ${metres(e.post)} → fused ${metres(e.fused)}`
  },
  legend: ROWS.map((r) => ({
    color: r.color,
    label: { odometry: 'Wheel odometry: smooth, drifts', GPS: 'GPS, 1 Hz: unbiased, noisy', 'last post': 'Last marker post: exact, rare', fused: 'Fused estimate ± σ' }[r.name]!,
    shape: 'dot' as const,
  })),
  points: [
    'Every sensor is wrong in its own way. Wheel odometry is smooth and updates fast, but slip makes each metre read a few % long, and that error only grows: it drifts.',
    'GPS has no drift: its errors average out to zero. But each fix is a metre or more off and comes once a second, so on its own the robot’s position jitters.',
    'A landmark, here a marker post every 5 m that the camera recognises, is exact to centimetres, but only as the robot passes one. In between the last fix goes stale: a slow sensor.',
    'Fusion uses odometry to carry the estimate forward and corrects it at every fix, each weighted by its variance: a fix pulls K = P / (P + σ²) of the way. The uncertainty P grows while driving and shrinks at each fix.',
    'The fused error is below every single sensor’s. Try one helper at a time: posts alone already pin the drift, GPS alone still stops it growing. The weighting is a Kalman filter (see Kalman intuition).',
  ],
  controls: [
    { kind: 'slider', key: 'slip', label: 'Wheel slip', min: 1, max: 10, initial: 5, step: 1, format: (v) => `${v} %` },
    { kind: 'slider', key: 'gps', label: 'GPS noise σ', min: 0.5, max: 3, initial: 1.5, step: 0.5, format: (v) => `${v.toFixed(1)} m` },
    { kind: 'choice', key: 'use', options: Object.entries(USES).map(([value, label]) => ({ value, label })), initial: 'all' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const xOf = (m: number) => WF.x0 + m * WF.perM
    const L = 20 * WF.perM
    box(scene, [L + 1.6, 0.5, 3.2], mat('#3a3d45', { rough: 0.8 }), [0, WF.trackY - 0.25, 0])
    for (let m = 0; m <= 20; m++) flatBox(scene, [0.06, 0.02, m % 5 ? 0.5 : 1.2], glowMat(GREY, 0.3), [xOf(m), WF.trackY + 0.01, 1.1])
    const plate = mat('#f1f1f1', { rough: 0.6 })
    const ink = mat('#16171b', { rough: 0.6 })
    const posts = [0, 5, 10, 15, 20].map((m) => {
      box(scene, [0.22, 1.5, 0.22], mat('#6b6f78', { rough: 0.6 }), [xOf(m), WF.trackY + 0.75, -1.1])
      box(scene, [0.9, 0.9, 0.08], plate, [xOf(m), WF.trackY + 1.7, -1.1])
      box(scene, [0.5, 0.5, 0.1], ink, [xOf(m) - 0.1, WF.trackY + 1.75, -1.1])
      const halo = glowMat(DATA_COLOR, 0)
      flatBox(scene, [1.1, 1.1, 0.04], halo, [xOf(m), WF.trackY + 1.7, -1.2])
      addLabel(scene, `${m} m`, [xOf(m), WF.trackY - 1.1, 1.6], GREY, 0.32)
      return halo
    })
    const car = carOn(scene)
    const truth = add(scene, shadowlessRod(glowMat(GREY, 0.5)))
    const rows = ROWS.map((r, i) => {
      const y = WF.rows[i]
      stretchRod(add(scene, shadowlessRod(glowMat(r.color, 0.12))), [xOf(0), y, 0], [xOf(20), y, 0], 0.04)
      addLabel(scene, r.name, [xOf(0) - 0.5 - r.name.length * 0.13, y, 0], r.color, 0.34)
      const m = glowMat(r.color, 0.9)
      const dot = add(scene, mesh(new THREE.SphereGeometry(0.32, 16, 12), m))
      dot.castShadow = false
      return { dot, m, y }
    })
    const band = flatBox(scene, [1, 0.42, 0.1], glowMat(POWER, 0.35), [0, WF.rows[3], -0.1])
    const plot = scope(scene, WF.plotW, WF.plotH, { divs: [12, 4] })
    plot.group.position.set(0, WF.plotY, 0)
    const traces = ROWS.map((r, i) => plot.trace(r.color, { samples: 240, radius: i === 3 ? 0.09 : 0.055 }))
    ticks(plot, [[0, '-36'], [0.5, '-18'], [1, '0']], [[1, '3'], [0.5, '0'], [0, '-3']], 0.4)
    addLabel(scene, 'estimate − truth (m) · last 36 s', [0, WF.plotY + WF.plotH / 2 + 0.75, 0], LABEL, 0.34)
    const text = textLines(scene, [-17.5, 10.6, 0])
    const s = { key: '', t: 0, k: -1, gpsGlow: 0, postGlow: [0, 0, 0, 0, 0] }
    return {
      scene,
      view: { center: [0, 2.6, 0], radius: 66, polar: 1.35, azimuth: 0 },
      frame(dt, p) {
        const W = wfRun(p)
        const { r } = W
        const key = `${p.slip}|${p.gps}|${p.use}`
        if (key !== s.key) Object.assign(s, { key, t: 0, k: -1 })
        s.t = (s.t + dt) % FUSE.seconds
        const k = Math.min(r.t.length - 1, Math.floor(s.t / FUSE.dt))
        for (let j = Math.max(0, s.k + 1); j <= k && s.k >= 0; j++) {
          if (r.gpsFix[j]) s.gpsGlow = 1
          if (r.postFix[j]) s.postGlow[Math.round(r.truth[j] / FUSE.posts)] = 1
        }
        if (k < s.k) s.postGlow[0] = 1
        s.k = k
        const x = r.truth[k]
        car.position.set(xOf(x), WF.trackY, 0.2)
        stretchRod(truth, [xOf(x), WF.trackY + 1.3, 0.3], [xOf(x), WF.rows[0] + 0.6, 0.3], 0.04)
        const est = [r.odo[k], r.gps[k], r.post[k], r.fused[k]]
        rows.forEach((row, i) => {
          row.dot.position.set(xOf(Math.min(21, Math.max(-1, est[i]))), row.y, 0.2)
          const flash = i === 1 ? s.gpsGlow : i === 2 ? Math.max(...s.postGlow) : 0
          row.dot.scale.setScalar(1 + 0.6 * flash)
          setGlow(row.m, ROWS[i].color, 0.9 + 1.5 * flash)
        })
        band.position.x = xOf(r.fused[k])
        band.scale.x = Math.max(0.05, 2 * r.sigma[k] * WF.perM)
        s.gpsGlow = Math.max(0, s.gpsGlow - dt * 2.5)
        posts.forEach((h, i) => {
          s.postGlow[i] = Math.max(0, s.postGlow[i] - dt * 1.2)
          setGlow(h, DATA_COLOR, 2 * s.postGlow[i])
        })
        const series = [r.odo, r.gps, r.post, r.fused]
        traces.forEach((tr, i) =>
          tr.scroll(
            (t) => {
              const j = Math.round(t / FUSE.dt) - 1
              return j < 0 ? 0 : ((series[i][j] - r.truth[j]) / WF.errM) * (WF.plotH / 2)
            },
            s.t,
            FUSE.seconds,
          ),
        )
        const e = r.err
        const wins = e.fused < W.best
        text.a.set(wins ? `Fused ${metres(e.fused)} rms: ×${(W.best / e.fused).toFixed(1)} better than the best single sensor` : `Fused ${metres(e.fused)} rms`, wins ? POWER : HEAT)
        const now = (i: number) => sgn(est[i] - x, 2)
        text.b.set(`now: odo ${now(0)} · GPS ${now(1)} · post ${now(2)} · fused ${now(3)} ± ${r.sigma[k].toFixed(2)} m`, LABEL)
        text.c.set(`${USES[W.use]}: odometry ${Math.round(W.slip * 100)} % long · GPS ±${W.gps} m at 1 Hz · posts every 5 m`, GREY)
        text.status.set(`t = ${s.t.toFixed(1)} s of ${FUSE.seconds} s · real time · filter at ${1 / FUSE.dt} Hz`, GREY)
      },
      readouts: (p) => {
        const { r, best } = wfRun(p)
        return [
          { label: 'Odometry rms', value: metres(r.err.odo), tone: r.err.odo > 0.5 ? 'bad' : 'warn' },
          { label: 'GPS rms', value: metres(r.err.gps), tone: 'warn' },
          { label: 'Last post rms', value: metres(r.err.post), tone: 'bad' },
          { label: 'Fused rms', value: metres(r.err.fused), tone: r.err.fused < best ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Complementary filter: wheel-odometry heading (smooth, drifts) + magnetometer (absolute, noisy, bent by steel) on a square loop. ---

const CF = { S: 3.3, C: [-10.5, -1.8] as const, mid: [1.77, 1.2] as const, speedup: 2, window: 15, errDeg: 45, needle: 3.6 }
const cfRun = memoBy(
  (p: Params) => `${p.tau}|${p.mismatch}|${p.noise}`,
  (p: Params) => {
    const tau = n(p, 'tau')
    const mismatch = n(p, 'mismatch') / 100
    const noise = n(p, 'noise')
    const r = compRun(tau, mismatch, noise * DEG)
    const e = { odo: r.err.odo / DEG, mag: r.err.mag / DEG, fused: r.err.fused / DEG }
    return { tau, mismatch, noise, r, e, fc: crossoverHz(tau) }
  },
)
type CfSetup = ReturnType<typeof cfRun>

function cfHeadline(C: CfSetup): [string, string] {
  const { e } = C
  if (e.fused < Math.min(e.odo, e.mag)) return [`Fused ${e.fused.toFixed(1)}° rms beats wheels ${e.odo.toFixed(1)}° and compass ${e.mag.toFixed(1)}°`, POWER]
  if (C.tau >= 1) return [`τ too long: the wheel drift leaks through (${e.fused.toFixed(1)}° rms)`, HEAT]
  return [`τ too short: compass noise and the steel pull go straight through`, HEAT]
}

export const complementaryHeading: Lesson = {
  id: 'sensor-fusion-complementary-filter',
  title: 'Complementary filter',
  tagline: 'Heading from the wheels for quick turns, from the compass over seconds; the crossover frequency splits the job',
  formula: (p) => {
    const C = cfRun(p)
    return `h = α (h + Δh_wheels) + (1 − α) h_compass · α = τ / (τ + dt) = ${C.r.alpha.toFixed(4)} at ${1 / COMP.dt} Hz · f_c = 1 / (2π τ) = ${C.fc < 0.1 ? C.fc.toFixed(3) : C.fc.toFixed(2)} Hz · below f_c: compass (low-pass) · above: wheels (high-pass) · gains add in quadrature to 1`
  },
  legend: [
    { color: CLK_COLOR, label: 'Wheel odometry heading (drifts)', shape: 'dot' },
    { color: HIGH_V, label: 'Compass heading (noisy, steel)', shape: 'dot' },
    { color: POWER, label: 'Fused; crossover', shape: 'dot' },
    { color: GREY, label: 'True path', shape: 'dot' },
  ],
  points: [
    'Heading from the wheels is (right − left) / track width, summed. It follows every turn smoothly, but a tyre 0.5 % bigger or a bit of skid in each turn adds an error that never goes away: the heading drifts.',
    'A magnetometer gives an absolute heading, so it can’t drift. But motor currents make it noisy, and steel nearby (rebar in the floor, a toolbox) bends the field and pulls it off by tens of degrees while the robot passes.',
    'Their errors live in different bands: wheel drift is slow, compass noise is fast. So high-pass the wheels and low-pass the compass with the same time constant τ: each loop add the wheel step, then pull (1 − α) toward the compass.',
    'The crossover f_c = 1 / (2π τ) is where both gains are 0.71; the two always add up to the true heading. τ = 2 s → 0.08 Hz: anything that changes faster than about once in 12 s comes from the wheels.',
    'Too short a τ lets compass noise and the steel through; too long and wheel drift survives. Same idea as the IMU complementary filter (gyro + accelerometer pitch); there it’s gyro for fast, gravity for slow.',
  ],
  controls: [
    { kind: 'slider', key: 'tau', label: 'Time constant τ', min: 0.1, max: 20, initial: 2, log: true, format: (v) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)} s` },
    { kind: 'slider', key: 'mismatch', label: 'Tyre mismatch', min: 0, max: 2, initial: 0.5, step: 0.1, format: (v) => `${v.toFixed(1)} %` },
    { kind: 'slider', key: 'noise', label: 'Compass noise σ', min: 2, max: 20, initial: 8, step: 1, format: (v) => `${v}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const toWorld = ([x, y]: readonly [number, number] | number[], z = 0): V3 => [CF.C[0] + (x - CF.mid[0]) * CF.S, CF.C[1] + (y - CF.mid[1]) * CF.S, z]
    flatBox(scene, [15, 15, 0.3], mat('#3b3f48', { rough: 0.85 }), [CF.C[0], CF.C[1], -0.5])
    const rust = mat('#8a4a2a', { rough: 0.8 })
    const rb = toWorld(REBAR_AT)
    const half = COMP.rebarR * CF.S * 1.1
    for (let i = -2; i <= 2; i++) {
      flatBox(scene, [2 * half, 0.12, 0.1], rust, [rb[0], rb[1] + (i * half) / 2, -0.3])
      flatBox(scene, [0.12, 2 * half, 0.1], rust, [rb[0] + (i * half) / 2, rb[1], -0.3])
    }
    addLabel(scene, 'steel in the floor', [rb[0] + half + 2.5, rb[1] + 1.2, 0], HEAT, 0.32)
    const pathMat = glowMat(GREY, 0.35)
    const pathRods: THREE.Mesh[] = []
    const bot = add(scene, new THREE.Group())
    bot.scale.setScalar(1.3)
    box(bot, [1.5, 2, 0.5], mat('#d8dbe2', { rough: 0.55 }), [0, 0, 0.3])
    for (const sx of [-1, 1]) box(bot, [0.35, 0.95, 0.75], mat('#1c1c1f', { rough: 0.8 }), [sx * 0.95, 0, 0.3])
    box(bot, [0.6, 0.3, 0.1], glowMat('#f2c230', 0.6), [0, 0.75, 0.6])
    const needles = [CLK_COLOR, HIGH_V, POWER].map((c) => add(scene, shadowlessRod(glowMat(c, 1))))

    const W = 14
    const errPlot = scope(scene, W, 5.6, { divs: [6, 4] })
    errPlot.group.position.set(10.5, 3.4, 0)
    const errTraces = [CLK_COLOR, HIGH_V, POWER].map((c, i) => errPlot.trace(c, { samples: 200, radius: i === 2 ? 0.09 : 0.05 }))
    ticks(errPlot, [[0, '-15'], [1, '0']], [[1, '45'], [0.5, '0'], [0, '-45']], 0.4)
    addLabel(scene, 'heading error ° · last 15 s', [10.5, 3.4 + 2.8 + 0.75, 0], LABEL, 0.34)
    const H = 4.2
    const gainPlot = scope(scene, W, H, { divs: [6, 2], zeroAt: 0 })
    gainPlot.group.position.set(10.5, -5.3, 0)
    const lowTr = gainPlot.trace(HIGH_V, { samples: 120, radius: 0.08 })
    const highTr = gainPlot.trace(CLK_COLOR, { samples: 120, radius: 0.08 })
    const fcLine = add(gainPlot.group, mesh(new THREE.BoxGeometry(0.1, H, 0.1), glowMat(POWER, 1)), [0, 0, 0.3])
    fcLine.castShadow = false
    ticks(gainPlot, [[0, '0.01'], [1 / 3, '0.1'], [2 / 3, '1'], [1, '10']], [[1, '1'], [0, '0']], 0.4)
    addLabel(scene, 'gain vs Hz', [10.5, -5.3 + H / 2 + 0.75, 0], LABEL, 0.34)
    addLabel(scene, 'compass: low-pass', [10.5 - W / 2 + 2, -5.3 + H / 2 + 0.75, 0], HIGH_V, 0.3)
    addLabel(scene, 'wheels: high-pass', [10.5 + W / 2 - 2, -5.3 + H / 2 + 0.75, 0], CLK_COLOR, 0.3)
    const fcTag = liveLabel(scene, [0, -5.3 - H / 2 - 1.5, 0.3], { size: 0.32, color: POWER })
    const text = textLines(scene, [-17.5, 10.6, 0])
    const s = { run: null as CompRun | null, t: 0 }
    const uOf = (f: number) => (Math.log10(f) + 2) / 3
    return {
      scene,
      view: { center: [0, 2.2, 0], radius: 64, polar: 1.4, azimuth: 0 },
      frame(dt, p) {
        const C = cfRun(p)
        const { r } = C
        if (C.r !== s.run) {
          Object.assign(s, { run: C.r, t: 0 })
          for (const m of pathRods) scene.remove(m)
          pathRods.length = 0
          const loop = [[0, 0], ...r.pos.filter((_, i) => i % 20 === 19)]
          for (let i = 0; i + 1 < loop.length; i++) {
            const m = add(scene, shadowlessRod(pathMat))
            stretchRod(m, toWorld(loop[i], -0.2), toWorld(loop[i + 1], -0.2), 0.06)
            pathRods.push(m)
          }
          lowTr.draw((u) => -H / 2 + lowGain(10 ** (-2 + 3 * u), C.tau) * H * 0.92, null)
          highTr.draw((u) => -H / 2 + highGain(10 ** (-2 + 3 * u), C.tau) * H * 0.92, null)
          const u = uOf(C.fc)
          fcLine.visible = u >= 0 && u <= 1
          fcLine.position.x = gainPlot.xAt(Math.min(1, Math.max(0, u)))
          fcTag.group.position.x = 10.5 + gainPlot.xAt(Math.min(1, Math.max(0, u)))
          fcTag.set(`f_c = ${C.fc < 0.1 ? C.fc.toFixed(3) : C.fc.toFixed(2)} Hz`)
        }
        s.t = (s.t + dt * CF.speedup) % COMP.seconds
        const k = Math.min(r.t.length - 1, Math.floor(s.t / COMP.dt))
        const h = r.truth[k]
        const [bx, by] = toWorld(r.pos[k])
        bot.position.set(bx, by, 0)
        bot.rotation.z = -h
        ;[r.odo, r.mag, r.fused].forEach((arr, i) => {
          const a = arr[k]
          const z = 1 + i * 0.08
          stretchRod(needles[i], [bx, by, z], [bx + CF.needle * Math.sin(a), by + CF.needle * Math.cos(a), z], 0.09)
        })
        const errs = [r.odo, r.mag, r.fused]
        errTraces.forEach((tr, i) =>
          tr.scroll(
            (t) => {
              const j = Math.round(t / COMP.dt) - 1
              return j < 0 ? 0 : (wrapPi(errs[i][j] - r.truth[j]) / DEG / CF.errDeg) * 2.8
            },
            s.t,
            CF.window,
          ),
        )
        const [hl, hc] = cfHeadline(C)
        text.a.set(hl, hc)
        const e = (arr: number[]) => sgn(wrapPi(arr[k] - h) / DEG, 0)
        text.b.set(`now: wheels ${e(r.odo)}° · compass ${e(r.mag)}° · fused ${e(r.fused)}°`, LABEL)
        text.c.set(`τ = ${C.tau < 1 ? C.tau.toFixed(2) : C.tau.toFixed(1)} s: slower than ${C.fc < 0.1 ? C.fc.toFixed(3) : C.fc.toFixed(2)} Hz from the compass, faster from the wheels`, GREY)
        text.status.set(`t = ${s.t.toFixed(1)} s · sped up ×${CF.speedup} · ${1 / COMP.dt} Hz loop · α = ${r.alpha.toFixed(4)}`, GREY)
      },
      readouts: (p) => {
        const C = cfRun(p)
        const best = C.e.fused < Math.min(C.e.odo, C.e.mag)
        return [
          { label: 'Crossover', value: `${C.fc < 0.1 ? C.fc.toFixed(3) : C.fc.toFixed(2)} Hz` },
          { label: 'Wheels rms', value: `${C.e.odo.toFixed(1)}°`, tone: C.e.odo > 15 ? 'bad' : 'warn' },
          { label: 'Compass rms', value: `${C.e.mag.toFixed(1)}°`, tone: 'warn' },
          { label: 'Fused rms', value: `${C.e.fused.toFixed(1)}°`, tone: best ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- Kalman intuition: bell curves on a track; predict slides and widens, a measurement brings its own bell, the update lands in between. ---

const KF = { steps: 7, u: 1, step: 3.2, spanM: 8, W: 34, H: 7.5, Y: 1.3, trackY: -7.2, sigmaTop: 0.22 }
const kRun = memoBy(
  (p: Params) => `${p.q}|${p.r}`,
  (p: Params) => {
    const sq = n(p, 'q')
    const sr = n(p, 'r')
    return { sq, sr, run: kalmanRun(sq, sr, KF.steps, KF.u), steady: kfSteady(sq * sq, sr * sr) }
  },
)
const PHASES = ['predict', 'measure', 'update', 'update'] as const

function kfHeadline(K: number): [string, string] {
  if (K > 0.7) return [`K = ${K.toFixed(2)}: the sensor is sharper, the estimate jumps to it`, HIGH_V]
  if (K < 0.3) return [`K = ${K.toFixed(2)}: the prediction is sharper, the sensor only nudges it`, CLK_COLOR]
  return [`K = ${K.toFixed(2)}: about equally sure, the estimate lands in between`, POWER]
}

export const kalmanIntuition: Lesson = {
  id: 'sensor-fusion-kalman-intuition',
  title: 'Kalman intuition',
  tagline: 'A belief is a bell curve: moving widens it, measuring narrows it, and the variances decide where it lands',
  formula: (p) => {
    const { sq, sr, steady } = kRun(p)
    return `predict: x̂ = x̂ + ${KF.u} m, P = P + Q · update: K = P / (P + R), x̂ = x̂ + K (z − x̂), P = (1 − K) P · Q = ${sq}² m², R = ${sr}² m² → steady P = ${steady.P.toFixed(3)} m², K = ${steady.K.toFixed(2)}`
  },
  legend: [
    { color: CLK_COLOR, label: 'Prediction (after moving)', shape: 'dot' },
    { color: HIGH_V, label: 'Measurement', shape: 'dot' },
    { color: POWER, label: 'Estimate (after update)', shape: 'dot' },
    { color: GREY, label: 'True position', shape: 'dot' },
  ],
  points: [
    'A Kalman filter keeps a belief, not just a number: a mean (best guess) and a variance P (how unsure). Drawn along the track it’s a bell curve; narrow and tall means confident.',
    'Predict: the robot is told to drive 1 m. The bell slides 1 m forward and widens, because wheels slip: P grows by the process noise Q every step.',
    'Measure: a sensor reports a position with its own bell, variance R. Update: multiply the two bells. The product sits K = P / (P + R) of the way from the prediction to the measurement, and is narrower than both: P ← (1 − K) P.',
    'Sloppy motion (big Q) → trust the sensor, K → 1. Noisy sensor (big R) → trust the prediction, K → 0. With fixed Q and R, K settles to a steady value within a few steps.',
    'That steady gain is a fixed blend, like the complementary filter. The full filter adds a velocity, several sensors and matrices, but every step is still predict → measure → weigh by variances.',
  ],
  controls: [
    { kind: 'slider', key: 'q', label: 'Process noise σq', min: 0.05, max: 1, initial: 0.3, step: 0.05, format: (v) => `${v.toFixed(2)} m` },
    { kind: 'slider', key: 'r', label: 'Measurement noise σr', min: 0.1, max: 1.5, initial: 0.5, step: 0.05, format: (v) => `${v.toFixed(2)} m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const plot = scope(scene, KF.W, KF.H, { divs: [12, 4], zeroAt: 0 })
    plot.group.position.set(0, KF.Y, 0)
    const xm = (m: number) => plot.xAt(m / KF.spanM)
    const A = 0.95 * (KF.H - 0.2) * KF.sigmaTop * Math.sqrt(2 * Math.PI)
    const bell = (mu: number, v: number, k = 1) => (u: number) => -KF.H / 2 + 0.1 + k * A * gaussPdf(u * KF.spanM, mu, Math.sqrt(v))
    const [priorTr, measTr, postTr] = [CLK_COLOR, HIGH_V, POWER].map((c) => plot.trace(c, { samples: 320, radius: 0.08 }))
    const truthRod = add(plot.group, shadowlessRod(glowMat(GREY, 0.7)))
    ticks(plot, Array.from({ length: 9 }, (_, i) => [i / 8, `${i}`] as [number, string]), [], 0.4)
    addLabel(scene, 'belief p(x) along the track (m)', [0, KF.Y + KF.H / 2 + 0.6, 0], LABEL, 0.34)

    const leverY = KF.Y - KF.H / 2 - 1.7
    const lever = add(scene, shadowlessRod(glowMat(GREY, 0.6)))
    const ends = [CLK_COLOR, HIGH_V, POWER].map((c, i) => {
      const o = add(scene, mesh(new THREE.SphereGeometry(i === 2 ? 0.34 : 0.24, 16, 12), glowMat(c, 1)))
      o.castShadow = false
      return o
    })
    const kTag = liveLabel(scene, [0, leverY, 0.3], { size: 0.34, color: POWER, align: 'left' })
    box(scene, [KF.W + 1, 0.5, 3], mat('#3a3d45', { rough: 0.8 }), [0, KF.trackY - 0.25, 0])
    const car = carOn(scene)
    const zMark = flatBox(scene, [0.18, 0.04, 2.6], glowMat(HIGH_V, 1.2), [0, KF.trackY + 0.03, 0])
    const text = textLines(scene, [-17.5, 10.6, 0])
    const s = { key: '', t: 0 }
    return {
      scene,
      view: { center: [0, 1.2, 0], radius: 66, polar: 1.35, azimuth: 0 },
      frame(dt, p) {
        const R = kRun(p)
        const key = `${p.q}|${p.r}`
        if (key !== s.key) Object.assign(s, { key, t: 0 })
        s.t = (s.t + dt) % (KF.steps * KF.step)
        const i = Math.floor(s.t / KF.step)
        const f = (s.t % KF.step) / KF.step
        const st = R.run[i]
        const prev = i > 0 ? R.run[i - 1].post : { x: 0, P: 0.04 }
        const prevTruth = i > 0 ? R.run[i - 1].truth : 0
        const fp = smooth(f / 0.3)
        const fm = smooth((f - 0.3) / 0.15)
        const fu = smooth((f - 0.5) / 0.25)
        const phase = PHASES[Math.min(3, Math.floor(f / 0.25))]
        priorTr.draw(bell(prev.x + (st.prior.x - prev.x) * fp, prev.P + (st.prior.P - prev.P) * fp), null)
        measTr.group.visible = fm > 0
        if (fm > 0) measTr.draw(bell(st.z, R.sr ** 2, fm), null)
        postTr.group.visible = fu > 0
        if (fu > 0) postTr.draw(bell(st.prior.x + (st.post.x - st.prior.x) * fu, st.prior.P + (st.post.P - st.prior.P) * fu), null)
        const tx = prevTruth + (st.truth - prevTruth) * fp
        stretchRod(truthRod, [xm(tx), -KF.H / 2, 0.3], [xm(tx), KF.H / 2, 0.3], 0.05)
        car.position.set(xm(tx), KF.trackY, 0.2)
        zMark.visible = fm > 0
        zMark.position.x = xm(st.z)
        const showLever = fm > 0
        lever.visible = kTag.group.visible = showLever
        ends.forEach((o) => (o.visible = showLever))
        if (showLever) {
          const [a, b] = [xm(st.prior.x), xm(st.z)]
          stretchRod(lever, [a, leverY, 0], [b, leverY, 0], 0.06)
          ends[0].position.set(a, leverY, 0.1)
          ends[1].position.set(b, leverY, 0.1)
          const c = a + (b - a) * st.K * fu
          ends[2].position.set(c, leverY, 0.2)
          kTag.group.position.x = Math.max(a, b) + 0.7
          kTag.set(`K = ${st.K.toFixed(2)}`)
        }
        const [hl, hc] = kfHeadline(st.K)
        text.a.set(hl, hc)
        text.b.set(`prediction σ ${Math.sqrt(st.prior.P).toFixed(2)} m · sensor σ ${R.sr.toFixed(2)} m → K = P / (P + R) = ${st.K.toFixed(2)}`, LABEL)
        text.c.set(`estimate P = (1 − K) P → σ ${Math.sqrt(st.post.P).toFixed(2)} m · error ${sgn(st.post.x - st.truth, 2)} m · steady K = ${R.steady.K.toFixed(2)}`, GREY)
        text.status.set(`step ${i + 1} of ${KF.steps} · ${phase} · drive ${KF.u} m per step · slowed for viewing`, GREY)
      },
      readouts: (p) => {
        const R = kRun(p)
        return [
          { label: 'Steady K', value: R.steady.K.toFixed(2), tone: 'ok' },
          { label: 'Steady prior σ', value: `${Math.sqrt(R.steady.P).toFixed(2)} m` },
          { label: 'Sensor σ', value: `${R.sr.toFixed(2)} m` },
          { label: 'Steady estimate σ', value: `${Math.sqrt((1 - R.steady.K) * R.steady.P).toFixed(2)} m`, tone: 'ok' },
        ]
      },
    }
  },
}
