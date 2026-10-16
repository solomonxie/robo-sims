import * as THREE from 'three/webgpu'
import { CLUTTER, IcpIter, MCL, MCL_LOOP, MclFrame, MclStart, Pose, XY, icpRun, mapPoints, mclRun, scanPoints, scanWorld, wrapPi } from '../../core/physics'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, chordPath, covRings, cursorBar, diffBot, floorView, glowMat, liveLabel, memoBy, pointCloud, rayFan, roomModel, scope, simClock } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const RV = { at: [-18.6, -5.6, 0] as V3, k: 5.6, tilt: -0.5 }
const TOP = RV.at[1] + 2.5 * RV.k * Math.cos(RV.tilt)
const VIEW = { center: [-0.6, 2.4, 0] as V3, radius: 60, polar: Math.PI / 2, azimuth: 0 }
const WF = { x: 10.4, y: -0.6, w: 10.5, h: 6.4 }
const C = { lo: '#4a68a0', tick: '#7f9cc8', odo: '#9aa3b2', ghost: RING }
const cm = (m: number) => `${Math.round(m * 100)} cm`
const deg = (r: number) => `${Math.round((Math.abs(r) * 180) / Math.PI)}°`
const P = (p: XY) => ({ x: p[0], y: p[1] })
const lerpPose = (a: Pose, b: Pose, u: number): Pose => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, th: a.th + wrapPi(b.th - a.th) * u })

/** CLUTTER room on a tilted floor, the true robot, a ghost estimate and status lines over it. */
function locStage(scene: THREE.Scene, hScale: number) {
  const g = floorView(scene, RV.at, RV.k, RV.tilt)
  roomModel(g, hScale).draw(CLUTTER)
  return {
    g,
    bot: diffBot(g),
    ghost: diffBot(g, { ghost: C.ghost }),
    status: liveLabel(scene, [RV.at[0], TOP + 2.0, 0.3], { size: 0.44, align: 'left' }),
    sub: liveLabel(scene, [RV.at[0], TOP + 1.2, 0.3], { size: 0.3, color: GREY, align: 'left' }),
  }
}

/** Scope on the right: title, range note, x-axis ends and three text lines. */
function errScope(scene: THREE.Scene, title: string, xLeft: string) {
  const plot = scope(scene, WF.w, WF.h, { divs: [6, 4], zeroAt: 0 })
  plot.group.position.set(WF.x, WF.y, 0)
  addLabel(scene, title, [WF.x - WF.w / 2, WF.y + WF.h / 2 + 1.7, 0.3], LABEL, 0.34, 'left')
  const range = liveLabel(scene, [WF.x - WF.w / 2, WF.y + WF.h / 2 + 0.9, 0.3], { size: 0.28, color: GREY, align: 'left' })
  addLabel(scene, xLeft, [WF.x - WF.w / 2, WF.y - WF.h / 2 - 0.9, 0.3], GREY, 0.28, 'left')
  const xRight = liveLabel(scene, [WF.x + WF.w / 2, WF.y - WF.h / 2 - 0.9, 0.3], { size: 0.28, color: GREY, align: 'right' })
  const lines = [0, 1, 2].map((k) => liveLabel(scene, [WF.x - WF.w / 2, WF.y - WF.h / 2 - 2.0 - k * 0.8, 0.3], { size: 0.32, align: 'left' }))
  return { plot, range, xRight, lines, cursor: cursorBar(plot, LABEL, 0.05) }
}

// --- Particle filter: hundreds of guesses move with the odometry, get scored against the lidar scan and resampled. ---

const STARTS = { lost: 'Lost (anywhere)', known: 'Known start', kidnap: 'Kidnapped mid-run' }
const pfParams = (p: Params) => ({ count: n(p, 'count'), beams: n(p, 'beams'), inject: n(p, 'inject'), start: pick(STARTS, p.start, 'lost') as MclStart, seed: n(p, 'seed') })
type PfQ = ReturnType<typeof pfParams>
const pfKey = (q: PfQ) => `${q.count}|${q.beams}|${q.inject}|${q.start}|${q.seed}`
const FOUND = 0.15
const pfRun = memoBy(pfKey, (q: PfQ) => {
  const r = mclRun(q.count, q.beams, q.inject / 100, q.start, q.seed)
  const f = r.frames
  let lockAt = -1
  for (let i = f.length - 1; i >= 0 && f[i].err < FOUND; i--) lockAt = i
  return { ...r, lockAt, last: f[f.length - 1], resamples: f.filter((x) => x.resampled).length }
})
const ERR_MAX = 1.5
const SLOW = MCL.dt * MCL.every

export const localizationParticleFilter: Lesson = {
  id: 'localization-particle-filter',
  title: 'Particle filter',
  tagline: 'Hundreds of guesses of where the robot is: move them all with the wheels, score each against the lidar scan, keep the ones that fit',
  formula: 'predict: each particle ← odometry step + noise · weight ∝ Π p(beam end lands on a wall) · Neff = 1/Σw² < N/2 → resample (low-variance)',
  legend: [
    { color: RING, label: 'Particles, bright = high weight · yellow ghost = weighted mean, 2σ ring', shape: 'dot' },
    { color: C.odo, label: 'Grey ghost: odometry alone from the true start', shape: 'dot' },
    { color: B_FIELD, label: 'Lidar beams from the real robot', shape: 'dot' },
    { color: HIGH_V, label: 'Neff / N on the scope (100 % = all weights equal)', shape: 'dot' },
  ],
  points: [
    'Odometry alone drifts without bound (see Odometry). Localisation fixes that by comparing what the sensors see with a map the robot already has: here the room as an occupancy map (see Occupancy grids). A fiducial tag on the wall gives the pose in one shot (see Fiducial markers); a lidar scan only says "walls at these ranges", which fits many places a little and one place well.',
    'Monte Carlo localisation keeps N particles, each a full guess (x, y, θ). Predict: move every particle by the measured odometry plus random noise, so the cloud spreads like the error does. Update: project each beam from the particle and look up how far its end lands from the nearest wall (a precomputed likelihood field). Close to a wall = likely; the product over all beams is the weight.',
    'Resample: when the effective sample size Neff = 1/Σw² drops below N/2, draw a new set with copies in proportion to weight. Low-variance resampling uses one random number and N evenly spaced pointers, so a particle with 10 % of the weight gets exactly 10 % of the copies. Lost robot: the cloud starts everywhere and collapses onto the true pose within a few scans, unless too few particles or beams make it lock onto a look-alike spot.',
    'Particle deprivation: once the cloud has collapsed, no particle is left elsewhere. Kidnap the robot and the filter keeps tracking the old spot, confidently wrong. Swapping a few particles for random poses before every scan lets it find the robot again: one lucky guess near the truth outscores the whole stale cloud (Augmented MCL raises that share when the scores drop). A Kalman filter (see Filters in the loop) keeps one Gaussian instead and is cheaper, but cannot represent "here or over there".',
  ],
  controls: [
    { kind: 'slider', key: 'count', label: 'Particles', min: 50, max: 500, step: 50, initial: 300, format: (v: number) => `${v}` },
    { kind: 'slider', key: 'beams', label: 'Lidar beams', min: 4, max: 12, step: 2, initial: 8, format: (v: number) => `${v}` },
    { kind: 'slider', key: 'inject', label: 'Random particles per scan', min: 0, max: 30, step: 5, initial: 10, format: (v: number) => `${v} %` },
    { kind: 'choice', key: 'start', options: opts(STARTS), initial: 'lost' },
    { kind: 'slider', key: 'seed', label: 'Random seed', min: 1, max: 9, step: 1, initial: 5, format: (v: number) => `#${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = locStage(scene, 0.4)
    const odo = diffBot(s.g, { ghost: C.odo })
    chordPath(s.g, 200, '#4a5266', 0.005, 0.004)(MCL_LOOP.pts.map(P))
    const dots = pointCloud(s.g, 500, 0.03)
    const ticks = rayFan(s.g, 500, glowMat(C.tick, 0.5), 0.005)
    const beams = rayFan(s.g, 12, glowMat(B_FIELD, 0.9), 0.005)
    const ring = covRings(s.g, 1, RING, { width: 0.008, z: 0.03 })
    const sc = errScope(scene, 'position error and Neff vs time', '0 s')
    const tErr = sc.plot.trace(RING, { samples: 160, radius: 0.09 })
    const tOdo = sc.plot.trace(GREY, { samples: 160, radius: 0.06 })
    const tNeff = sc.plot.trace(HIGH_V, { samples: 160, radius: 0.05 })
    const found = sc.plot.level(POWER)
    const clock = simClock(SLOW, 2.5)
    const [lo, hi, col] = [new THREE.Color(C.lo), new THREE.Color(RING), new THREE.Color()]
    const st = { key: '', k: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = pfParams(p)
        const key = pfKey(q)
        const R = pfRun(q)
        const F = R.frames
        const t = clock(dt, key, F.length - 1)
        const k = Math.min(F.length - 1, Math.floor(t))
        const [a, b] = [F[k], F[Math.min(F.length - 1, k + 1)]]
        const u = t - k
        const jump = Math.hypot(b.truth.x - a.truth.x, b.truth.y - a.truth.y) > 0.3
        s.bot.set(jump ? a.truth : lerpPose(a.truth, b.truth, u), 0, 0)
        odo.set(lerpPose(a.odo, b.odo, u), 0, 0)
        s.ghost.set(Math.hypot(b.est.x - a.est.x, b.est.y - a.est.y) > 0.3 ? a.est : lerpPose(a.est, b.est, u), 0, 0)
        if (key === st.key && k === st.k) return
        Object.assign(st, { key, k })
        const f: MclFrame = a
        let wMax = 0
        for (let i = 0; i < f.w.length; i++) wMax = Math.max(wMax, f.w[i])
        const segs: [V3, V3][] = []
        for (let i = 0; i < f.w.length; i++) {
          const rel = wMax > 0 ? Math.sqrt(f.w[i] / wMax) : 0
          const [x, y, th] = [f.px[i], f.py[i], f.pth[i]]
          dots.set(i, [x, y, 0.025], col.lerpColors(lo, hi, rel), 0.6 + 0.9 * rel)
          segs.push([[x, y, 0.025], [x + 0.07 * Math.cos(th), y + 0.07 * Math.sin(th), 0.025]])
        }
        dots.show(f.w.length)
        ticks(segs)
        beams(f.ranges.flatMap((r, i): [V3, V3][] => (r >= MCL.maxM ? [] : [[[f.truth.x, f.truth.y, 0.06], [f.truth.x + r * Math.cos(f.truth.th + R.angles[i]), f.truth.y + r * Math.sin(f.truth.th + R.angles[i]), 0.06]]])))
        ring([[f.est.x, f.est.y, f.P]])
        const us = F.slice(0, k + 1).map((x) => x.t / R.tEnd)
        const yOf = (v: number) => (Math.min(1, Math.max(0, v)) - 0.5) * WF.h
        tErr.points(us, F.slice(0, k + 1).map((x) => yOf(x.err / ERR_MAX)))
        tOdo.points(us, F.slice(0, k + 1).map((x) => yOf(x.odoErr / ERR_MAX)))
        tNeff.points(us, F.slice(0, k + 1).map((x) => yOf(x.neff / q.count)))
        found.set(yOf(FOUND / ERR_MAX))
        sc.cursor(f.t / R.tEnd)
        sc.range.set(`0 … ${ERR_MAX} m · yellow filter · grey odometry · red Neff`)
        sc.xRight.set(`${R.tEnd.toFixed(0)} s`)
        const kidnapped = R.kidnapT >= 0 && f.t >= R.kidnapT
        sc.lines[0].set(`t = ${f.t.toFixed(1)} s · ${f.resampled ? 'Neff < N/2: resampled' : 'weights kept, no resample'}`, f.resampled ? HEAT : LABEL)
        sc.lines[1].set(`Neff ${Math.round(f.neff)} of ${q.count} · 2σ ring ${cm(Math.sqrt(Math.max(0, f.P[0][0] + f.P[1][1])) * 2)}`, GREY)
        sc.lines[2].set(R.kidnapT < 0 ? 'green line: 15 cm, counted as found' : kidnapped ? `kidnapped at ${R.kidnapT.toFixed(1)} s: carried half a loop` : `kidnap at ${R.kidnapT.toFixed(1)} s`, kidnapped ? HIGH_V : POWER)
        const ok = f.err < FOUND
        s.status.set(`Particle filter · ${ok ? 'found' : 'not found'} · error ${cm(f.err)} (odometry ${cm(f.odoErr)})`, ok ? POWER : HIGH_V)
        s.sub.set(`${STARTS[q.start]} · ${q.count} particles · ${q.beams} beams · ${q.inject} % random · real time`)
      },
      readouts: (p) => {
        const q = pfParams(p)
        const R = pfRun(q)
        return [
          { label: 'Final error', value: cm(R.last.err), tone: R.last.err < FOUND ? 'ok' : 'bad' },
          { label: 'Odometry alone', value: cm(R.last.odoErr) },
          { label: 'Found for good at', value: R.lockAt < 0 ? 'never' : `${R.frames[R.lockAt].t.toFixed(1)} s`, tone: R.lockAt < 0 ? 'bad' : 'ok' },
          { label: 'Resamples', value: `${R.resamples} of ${R.frames.length - 1} scans` },
        ]
      },
    }
  },
}

// --- Scan matching: ICP slides the scan onto the map, pair by nearest point, fit, repeat. ---

const SM = { truth: { x: 1.2, y: 1.2, th: 0.3 } as Pose, beams: 90, iters: 20, dir: -0.45, slow: 0.45 }
const MAP_PTS = mapPoints(CLUTTER)
const smParams = (p: Params) => ({ shift: n(p, 'shift'), turn: n(p, 'turn'), noise: n(p, 'noise'), reject: n(p, 'reject') })
type SmQ = ReturnType<typeof smParams>
const smKey = (q: SmQ) => `${q.shift}|${q.turn}|${q.noise}|${q.reject}`
const smRun = memoBy(smKey, (q: SmQ) => {
  const scan = scanPoints(CLUTTER, SM.truth, SM.beams, q.noise / 1000, 1)
  const t = SM.truth
  const guess = { x: t.x + (q.shift / 100) * Math.cos(SM.dir), y: t.y + (q.shift / 100) * Math.sin(SM.dir), th: t.th + (q.turn * Math.PI) / 180 }
  const its = icpRun(scan, MAP_PTS, guess, SM.iters, q.reject / 100)
  const errOf = (it: IcpIter) => ({ d: Math.hypot(it.pose.x - t.x, it.pose.y - t.y), th: wrapPi(it.pose.th - t.th) })
  return { scan, guess, its, errs: its.map(errOf), last: its[its.length - 1], lastErr: errOf(its[its.length - 1]) }
})
const SM_MAX = 0.6
const inView = (w: XY) => w[0] > -0.15 && w[1] > -0.15 && w[0] < CLUTTER.w + 0.15 && w[1] < CLUTTER.d + 0.15

export const localizationScanMatching: Lesson = {
  id: 'localization-scan-matching',
  title: 'Scan matching',
  tagline: 'Slide and turn the lidar scan until its points sit on the walls of the map: the shift that fits is the correction to the pose',
  formula: 'ICP: place scan at guess → pair each point with its nearest map point (≤ d max) → best rotation + shift for the pairs (closed form) → repeat',
  legend: [
    { color: POWER, label: 'Scan point, paired with a map point', shape: 'dot' },
    { color: HIGH_V, label: 'Scan point, nearest map point too far: ignored', shape: 'dot' },
    { color: HEAT, label: 'Pair: scan point → nearest map point', shape: 'dot' },
    { color: RING, label: 'Yellow ghost: pose estimate · grey ghost: odometry guess', shape: 'dot' },
  ],
  points: [
    'The particle filter scores guesses; scan matching instead solves for the pose directly. Start from the odometry guess (see Odometry), draw the scan there and it lands slightly off the walls. The offset between scan and map is the error of the guess.',
    'ICP (iterative closest point): pair every scan point with the nearest point on the map, then find the rotation and shift that best move the scan points onto their partners. In 2-D that has a closed form: centroids give the shift, the summed cross products give the angle. Pairs are only guesses, so repeat: each round the pairs get more right and the residual falls.',
    'Pairs farther apart than d max are ignored. Too small and a large initial error leaves nothing to pair; too large and points pair with the wrong wall. ICP only finds the nearest fit: past roughly 30 to 40 degrees or half a metre it slides into a wrong, but self-consistent, alignment. That is why it is used for tracking from a good guess, often seeded by a particle filter, and why scan-to-scan matching gives lidar odometry.',
    'Real stacks match against an occupancy grid (see Occupancy grids) with point-to-line or likelihood-field scores, search a coarse window first (correlative matching) and use a k-d tree for the nearest points. The noise slider shows how lidar noise sets the floor of the residual but barely moves the answer.',
  ],
  controls: [
    { kind: 'slider', key: 'shift', label: 'Guess shifted by', min: 0, max: 60, step: 5, initial: 25, format: (v: number) => `${v} cm` },
    { kind: 'slider', key: 'turn', label: 'Guess turned by', min: -60, max: 60, step: 5, initial: 20, format: (v: number) => `${v}°` },
    { kind: 'slider', key: 'noise', label: 'Lidar noise', min: 0, max: 40, step: 5, initial: 10, format: (v: number) => `${v} mm` },
    { kind: 'slider', key: 'reject', label: 'd max (pair distance)', min: 10, max: 100, step: 10, initial: 50, format: (v: number) => `${v} cm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = locStage(scene, 0.1)
    const guessBot = diffBot(s.g, { ghost: C.odo })
    const map = pointCloud(s.g, MAP_PTS.length, 0.008)
    MAP_PTS.forEach((m, i) => map.set(i, [m[0], m[1], 0.035], '#6f7787'))
    map.show(MAP_PTS.length)
    const dots = pointCloud(s.g, SM.beams, 0.022)
    const pairs = rayFan(s.g, SM.beams, glowMat(HEAT, 0.9), 0.005)
    const sc = errScope(scene, 'error vs ICP iteration', 'guess')
    const tPos = sc.plot.trace(RING, { samples: 60, radius: 0.09 })
    const tRms = sc.plot.trace(B_FIELD, { samples: 60, radius: 0.07 })
    const tTh = sc.plot.trace(HEAT, { samples: 60, radius: 0.06 })
    const clock = simClock(SM.slow, 3)
    const st = { key: '', k: -1, u: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = smParams(p)
        const key = smKey(q)
        const R = smRun(q)
        const N = R.its.length - 1
        const t = clock(dt, key, N + 1)
        const k = Math.min(N, Math.floor(t))
        const u = Math.min(1, Math.max(0, (t - k) * 2 - 1))
        const pose = k < N ? lerpPose(R.its[k].pose, R.its[k + 1].pose, u) : R.its[N].pose
        s.bot.set(SM.truth, 0, 0)
        s.ghost.set(pose, 0, 0)
        guessBot.set(R.guess, 0, 0)
        if (key === st.key && k === st.k && Math.abs(u - st.u) < 0.02) return
        Object.assign(st, { key, k, u })
        const it = R.its[k]
        const segs: [V3, V3][] = []
        let shown = 0
        R.scan.forEach((pt, i) => {
          const w = scanWorld(pose, pt)
          const j = it.match[i]
          if (inView(w)) dots.set(shown++, [w[0], w[1], 0.05], j < 0 ? HIGH_V : POWER)
          if (j >= 0 && u === 0 && inView(w)) segs.push([[w[0], w[1], 0.045], [MAP_PTS[j][0], MAP_PTS[j][1], 0.045]])
        })
        dots.show(shown)
        pairs(segs)
        const us = R.its.slice(0, k + 1).map((_, i) => i / N)
        const yOf = (v: number) => (Math.min(1, Math.max(0, v / SM_MAX)) - 0.5) * WF.h
        tPos.points(us, R.errs.slice(0, k + 1).map((e) => yOf(e.d)))
        tRms.points(us, R.its.slice(0, k + 1).map((x) => yOf(Number.isFinite(x.rms) ? x.rms : SM_MAX)))
        tTh.points(us, R.errs.slice(0, k + 1).map((e) => yOf((Math.abs(e.th) * 180) / Math.PI / 100)))
        sc.cursor(k / N)
        sc.range.set(`0 … ${cm(SM_MAX)} · yellow pose · blue RMS · orange θ`)
        sc.xRight.set(`iteration ${N}`)
        const e = R.errs[k]
        sc.lines[0].set(`iteration ${k} · ${it.inliers} of ${R.scan.length} points paired`, it.inliers < R.scan.length / 3 ? HIGH_V : LABEL)
        sc.lines[1].set(`RMS residual ${Number.isFinite(it.rms) ? `${(it.rms * 100).toFixed(1)} cm` : '—'} · pose off ${cm(e.d)}, ${deg(e.th)}`, GREY)
        const good = R.lastErr.d < 0.03 && Math.abs(R.lastErr.th) < 0.05
        sc.lines[2].set(k < N ? 'pairs shown in orange, then the fitted move' : good ? 'converged onto the true pose' : 'stuck in a wrong alignment', k < N ? GREY : good ? POWER : HIGH_V)
        s.status.set(`Scan matching · ICP iteration ${k} of ${N} · off by ${cm(e.d)}, ${deg(e.th)}`, e.d < 0.03 && Math.abs(e.th) < 0.05 ? POWER : LABEL)
        s.sub.set(`${R.scan.length}-point scan · map = outlines every 3 cm · guess ${q.shift} cm, ${q.turn}° off · noise ${q.noise} mm`)
      },
      readouts: (p) => {
        const R = smRun(smParams(p))
        const good = R.lastErr.d < 0.03 && Math.abs(R.lastErr.th) < 0.05
        return [
          { label: 'Final position error', value: cm(R.lastErr.d), tone: good ? 'ok' : 'bad' },
          { label: 'Final heading error', value: deg(R.lastErr.th), tone: good ? 'ok' : 'bad' },
          { label: 'RMS residual', value: Number.isFinite(R.last.rms) ? `${(R.last.rms * 100).toFixed(1)} cm` : '—' },
          { label: 'Points paired', value: `${R.last.inliers} of ${R.scan.length}` },
        ]
      },
    }
  },
}
