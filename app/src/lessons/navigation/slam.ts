import * as THREE from 'three/webgpu'
import { CLUTTER, Closure, DEG, Keyframe, MCL_LOOP, PgEdge, Pose, SLAM, XY, findClosures, integrateScan, keyframeMap, occModel, occStats, occTruth, poseCompose, poseDist, poseGraphSolve, roomOccGrid, scanBeams, scanWorld, slamDrive, slamGraph, wrapPi } from '../../core/physics'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, chordPath, glowMat, memoBy, occTiles, pointCloud, rayFan, simClock } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'
import { errScope, locStage } from './localization'

const VIEW = { center: [-0.6, 2.4, 0] as V3, radius: 60, polar: Math.PI / 2, azimuth: 0 }
const WF_H = 6.4
const C = { odo: '#9aa3b2', edge: '#6f9be8', path: '#4a5266', old: B_FIELD }
const cm = (m: number) => `${Math.round(m * 100)} cm`
const deg = (r: number) => `${((Math.abs(r) * 180) / Math.PI).toFixed(1)}°`
const lerpPose = (a: Pose, b: Pose, u: number): Pose => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, th: a.th + wrapPi(b.th - a.th) * u })
const yOf = (v: number, max: number) => (Math.min(1, Math.max(0, v / max)) - 0.5) * WF_H
const TRUTH = occTruth(CLUTTER, SLAM.res)
const inView = (w: XY) => w[0] > -0.15 && w[1] > -0.15 && w[0] < CLUTTER.w + 0.15 && w[1] < CLUTTER.d + 0.15

const driftSlider = { kind: 'slider' as const, key: 'drift', label: 'Wheel heading drift', min: 0, max: 6, step: 1, initial: 3, format: (v: number) => `${v}°/m` }
const seedSlider = { kind: 'slider' as const, key: 'seed', label: 'Noise seed', min: 1, max: 9, step: 1, initial: 1, format: (v: number) => `#${v}` }
const driveOf = memoBy((q: { drift: number; seed: number }) => `${q.drift}|${q.seed}`, (q) => slamDrive(q.drift * DEG, q.seed))

/** Occupancy grid after each keyframe, scans folded in at `poses`. */
function mapSnaps(kfs: readonly Keyframe[], poses: readonly Pose[]) {
  const g = roomOccGrid(CLUTTER, SLAM.res)
  const m = occModel()
  const snaps = kfs.map((k, i) => {
    integrateScan(g, m, poses[i], scanBeams(k.scan))
    return g.lo.slice()
  })
  return { g, snaps, wrong: occStats(g, TRUTH).wrong }
}

/** Room under a see-through occupancy map, true robot + estimate ghost, the true loop, keyframe nodes and edges. */
function slamStage(scene: THREE.Scene) {
  const s = locStage(scene, 0.12, 0.28)
  const tiles = occTiles(s.g, 3800)
  chordPath(s.g, 200, C.path, 0.005, 0.012)(MCL_LOOP.pts.map((p) => ({ x: p[0], y: p[1] })))
  const nodes = pointCloud(s.g, 48, 0.03)
  const odoE = rayFan(s.g, 48, glowMat(C.edge, 0.9), 0.008)
  const loopE = rayFan(s.g, 24, glowMat(HEAT, 1), 0.012)
  const at = (p: Pose, z: number): V3 => [p.x, p.y, z]
  const graph = (poses: readonly Pose[], upTo: number, loops: readonly [number, number][], color = RING) => {
    for (let i = 0; i <= upTo; i++) nodes.set(i, at(poses[i], 0.05), color)
    nodes.show(upTo + 1)
    odoE(poses.slice(1, upTo + 1).map((p, i): [V3, V3] => [at(poses[i], 0.045), at(p, 0.045)]))
    loopE(loops.filter(([a, b]) => a <= upTo && b <= upTo).map(([a, b]): [V3, V3] => [at(poses[a], 0.05), at(poses[b], 0.05)]))
  }
  return { ...s, tiles, graph }
}

// --- The chicken-and-egg problem: the map needs the pose, the pose needs the map. ---

const SOURCES = { wheel: 'Pose from wheel odometry', icp: 'Pose from lidar odometry (ICP)', truth: 'True pose (a cheat)' }
type Src = keyof typeof SOURCES
const ceParams = (p: Params) => ({ src: pick(SOURCES, p.src, 'icp') as Src, drift: n(p, 'drift'), seed: n(p, 'seed') })
const ceRun = memoBy(
  (q: ReturnType<typeof ceParams>) => `${q.src}|${q.drift}|${q.seed}`,
  (q) => {
    const kfs = driveOf(q)
    const poses = kfs.map((k) => k[q.src])
    const errs = (src: Src) => kfs.map((k) => poseDist(k[src], k.truth))
    const last = kfs[kfs.length - 1]
    return { kfs, poses, ...mapSnaps(kfs, poses), wheel: errs('wheel'), icp: errs('icp'), err: errs(q.src), thErr: wrapPi(last[q.src].th - last.truth.th) }
  },
)
const CE_MAX = 1.0
const KF_SLOW = 0.4

export const slamTheChickenAndEggProblem: Lesson = {
  id: 'slam-the-chicken-and-egg-problem',
  title: 'The chicken-and-egg problem',
  tagline: 'A map needs to know where each scan was taken; knowing where you are needs a map. SLAM builds both at once, and any pose error is baked into the walls',
  formula: 'keyframe every 30 cm · pose_k = pose_k−1 ⊕ Δ (Δ from wheels, or ICP of scan k onto scan k−1) · map ← fold scan k in at pose_k (log-odds)',
  legend: [
    { color: RING, label: 'Keyframes at the estimated pose · ghost = estimate', shape: 'dot' },
    { color: C.edge, label: 'Odometry edge between keyframes', shape: 'dot' },
    { color: B_FIELD, label: 'This scan, drawn from the estimated pose', shape: 'dot' },
    { color: C.odo, label: 'Error on the scope: grey wheels, yellow lidar odometry', shape: 'dot' },
  ],
  points: [
    'Localisation (see Localization) needs a map; mapping (see Occupancy grids) needs the pose of every scan. A robot in a new room has neither. SLAM, simultaneous localisation and mapping, estimates the path and the map together.',
    'The simplest try: trust odometry and fold each scan in where it says. Wheel odometry (see Odometry) creeps in heading, so walls seen on the way back land rotated and the map shows double walls. Pick the true pose to see the map a perfect pose would give.',
    'Lidar odometry matches each new scan to the last keyframe with ICP (see Localization › Scan matching) and chains the small moves. It does not care about wheel slip, so it drifts far less, but every match has a centimetre or a fraction of a degree of error, and chained errors still grow without bound.',
    'Keyframes keep the cost fixed: a scan is stored only every 30 cm of travel, not every 0.1 s. The fix for the remaining drift is to notice a place seen before (Loop closure) and spread the error back over the path (Pose graphs).',
  ],
  controls: [{ kind: 'choice', key: 'src', options: opts(SOURCES), initial: 'icp' }, driftSlider, seedSlider],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = slamStage(scene)
    const beams = rayFan(s.g, SLAM.beams / 2, glowMat(B_FIELD, 0.35), 0.004)
    const sc = errScope(scene, 'position error vs keyframe', 'start')
    const tWheel = sc.plot.trace(GREY, { samples: 60, radius: 0.07 })
    const tIcp = sc.plot.trace(RING, { samples: 60, radius: 0.09 })
    const clock = simClock(KF_SLOW, 3)
    const st = { key: '', k: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = ceParams(p)
        const key = `${q.src}|${q.drift}|${q.seed}`
        const R = ceRun(q)
        const N = R.kfs.length - 1
        const t = clock(dt, key, N)
        const k = Math.min(N, Math.floor(t))
        const k1 = Math.min(N, k + 1)
        s.bot.set(lerpPose(R.kfs[k].truth, R.kfs[k1].truth, t - k), 0, 0)
        s.ghost.set(lerpPose(R.poses[k], R.poses[k1], t - k), 0, 0)
        if (key === st.key && k === st.k) return
        Object.assign(st, { key, k })
        s.tiles.draw(R.g, R.snaps[k])
        s.graph(R.poses, k, [])
        const pk = R.poses[k]
        beams(R.kfs[k].scan.flatMap((pt, i): [V3, V3][] => {
          const w = scanWorld(pk, pt)
          return i % 2 || !inView(w) ? [] : [[[pk.x, pk.y, 0.06], [w[0], w[1], 0.06]]]
        }))
        const us = R.kfs.slice(0, k + 1).map((_, i) => i / N)
        tWheel.points(us, R.wheel.slice(0, k + 1).map((e) => yOf(e, CE_MAX)))
        tIcp.points(us, R.icp.slice(0, k + 1).map((e) => yOf(e, CE_MAX)))
        sc.cursor(k / N)
        sc.range.set(`0 … ${cm(CE_MAX)} · grey wheels · yellow lidar odometry`)
        sc.xRight.set(`keyframe ${N} (${R.kfs[N].s.toFixed(1)} m)`)
        sc.lines[0].set(`keyframe ${k} of ${N} · ${R.kfs[k].s.toFixed(1)} m driven`, LABEL)
        sc.lines[1].set(`wheels off ${cm(R.wheel[k])} · lidar odometry off ${cm(R.icp[k])}`, GREY)
        sc.lines[2].set(q.src === 'truth' ? 'true pose: the map a perfect estimate gives' : k < N ? 'drift is folded into the map as it is drawn' : 'back at the start: the walls no longer line up', q.src === 'truth' ? POWER : k < N ? GREY : HIGH_V)
        const e = R.err[k]
        s.status.set(`${SOURCES[q.src]} · off by ${cm(e)}`, e < 0.05 ? POWER : e < 0.2 ? LABEL : HIGH_V)
        s.sub.set(`${N + 1} keyframes, one every ${cm(SLAM.kf)} · ${SLAM.beams}-beam lidar · wheel drift ${q.drift}°/m · ${KF_SLOW} s per keyframe`)
      },
      readouts: (p) => {
        const q = ceParams(p)
        const R = ceRun(q)
        const N = R.kfs.length - 1
        return [
          { label: 'Final error, this pose', value: `${cm(R.err[N])}, ${deg(R.thErr)}`, tone: R.err[N] < 0.05 ? 'ok' : 'bad' },
          { label: 'Wheels alone', value: cm(R.wheel[N]) },
          { label: 'Lidar odometry', value: cm(R.icp[N]) },
          { label: 'Map cells wrong', value: `${R.wrong}` },
        ]
      },
    }
  },
}

// --- Loop closure: recognise a place seen before by matching against an old keyframe. ---

const lcParams = (p: Params) => ({ radius: n(p, 'radius'), rms: n(p, 'rms'), drift: n(p, 'drift'), seed: n(p, 'seed') })
const lcKey = (q: ReturnType<typeof lcParams>) => `${q.radius}|${q.rms}|${q.drift}|${q.seed}`
const corrOf = (est: readonly Pose[], c: Closure) => poseDist(est[c.i], poseCompose(est[c.j], c.z))
const lcRun = memoBy(lcKey, (q: ReturnType<typeof lcParams>) => {
  const kfs = driveOf(q)
  const est = kfs.map((k) => k.icp)
  const closures = findClosures(kfs, est, q.radius / 100, q.rms / 100)
  const at = new Map(closures.map((c) => [c.i, c]))
  const ok = closures.filter((c) => c.accepted)
  return { kfs, est, closures, at, ok, ...mapSnaps(kfs, est), err: kfs.map((k, i) => poseDist(est[i], k.truth)) }
})

export const slamLoopClosure: Lesson = {
  id: 'slam-loop-closure',
  title: 'Loop closure',
  tagline: 'Back near the start, match the new scan against the old keyframe there. If it fits, the match says exactly how far the estimate has drifted',
  formula: (p) => {
    const q = lcParams(p)
    return `candidate: an old keyframe within ${q.radius} cm of the estimate (≥ 8 keyframes back) · ICP current scan → old scan · accept if RMS < ${q.rms} cm and ≥ 60 % paired · loop edge = matched relative pose`
  },
  legend: [
    { color: C.old, label: 'Old keyframe scan, at its estimated pose', shape: 'dot' },
    { color: HIGH_V, label: 'New scan at the drifted estimate', shape: 'dot' },
    { color: POWER, label: 'New scan after ICP onto the old one', shape: 'dot' },
    { color: HEAT, label: 'Accepted loop-closure edge · ring = search radius', shape: 'dot' },
  ],
  points: [
    'Lidar odometry drifts (The chicken-and-egg problem). But a place seen earlier was seen with less accumulated error. If the robot can recognise it, matching the two scans gives the relative pose between then and now, independent of everything driven in between.',
    'Detection: search the keyframes near the current estimate, skipping the last few (those trivially overlap). The radius must cover the drift: too small and the old keyframe is never a candidate; too large and far-off keyframes get tested, costing time and risking a wrong match.',
    'Verification: ICP the new scan onto the old one from the estimated relative pose (see Localization › Scan matching) and accept only a tight fit. The green scan landing on the cyan one while the red one sits beside it is the drift made visible. Real systems first narrow candidates with appearance (scan descriptors, bag of visual words) and check geometry after.',
    'A false closure, two look-alike corridors matched, is far worse than a missed one: it pulls the map into knots. That is why the gate is strict and why back ends use robust weights. The accepted match becomes an edge in the pose graph (Pose graphs).',
  ],
  controls: [
    { kind: 'slider', key: 'radius', label: 'Search radius', min: 10, max: 100, step: 10, initial: 50, format: (v: number) => `${v} cm` },
    { kind: 'slider', key: 'rms', label: 'Accept if RMS below', min: 0.5, max: 4, step: 0.5, initial: 2.5, format: (v: number) => `${v} cm` },
    driftSlider,
    seedSlider,
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = slamStage(scene)
    const ring = chordPath(s.g, 48, HEAT, 0.006, 0.05)
    const dots = pointCloud(s.g, 3 * SLAM.beams, 0.018)
    const link = rayFan(s.g, 1, glowMat(HIGH_V, 1), 0.01)
    const sc = errScope(scene, 'drift: true vs measured by the closure', 'start')
    const tErr = sc.plot.trace(RING, { samples: 60, radius: 0.09 })
    const tCorr = sc.plot.trace(HEAT, { samples: 60, radius: 0.08 })
    const clock = simClock(KF_SLOW, 3)
    const st = { key: '', k: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = lcParams(p)
        const key = lcKey(q)
        const R = lcRun(q)
        const N = R.kfs.length - 1
        const t = clock(dt, key, N)
        const k = Math.min(N, Math.floor(t))
        const k1 = Math.min(N, k + 1)
        s.bot.set(lerpPose(R.kfs[k].truth, R.kfs[k1].truth, t - k), 0, 0)
        s.ghost.set(lerpPose(R.est[k], R.est[k1], t - k), 0, 0)
        if (key === st.key && k === st.k) return
        Object.assign(st, { key, k })
        s.tiles.draw(R.g, R.snaps[k])
        s.graph(R.est, k, R.ok.map((c) => [c.j, c.i]))
        const e = R.est[k]
        const r = q.radius / 100
        ring(Array.from({ length: 49 }, (_, i) => ({ x: e.x + r * Math.cos((i * Math.PI) / 24), y: e.y + r * Math.sin((i * Math.PI) / 24) })))
        const c = R.at.get(k)
        let shown = 0
        const put = (pose: Pose, scan: readonly XY[], color: string) => scan.forEach((pt) => {
          const w = scanWorld(pose, pt)
          if (inView(w)) dots.set(shown++, [w[0], w[1], 0.07], color)
        })
        if (c) {
          put(R.est[c.j], R.kfs[c.j].scan, C.old)
          put(e, R.kfs[k].scan, HIGH_V)
          if (c.accepted) put(poseCompose(R.est[c.j], c.z), R.kfs[k].scan, POWER)
          link([[[e.x, e.y, 0.06], [R.est[c.j].x, R.est[c.j].y, 0.06]]])
        } else link([])
        dots.show(shown)
        const us = R.kfs.slice(0, k + 1).map((_, i) => i / N)
        tErr.points(us, R.err.slice(0, k + 1).map((v) => yOf(v, 0.5)))
        const done = R.ok.filter((x) => x.i <= k)
        tCorr.points(done.map((x) => x.i / N), done.map((x) => yOf(corrOf(R.est, x), 0.5)))
        sc.cursor(k / N)
        sc.range.set('0 … 50 cm · yellow true · orange found by matching')
        sc.xRight.set(`keyframe ${N}`)
        sc.lines[0].set(c ? `keyframe ${k} vs old keyframe ${c.j}, ${cm(c.gap)} apart` : `keyframe ${k}: no old keyframe within ${q.radius} cm`, c ? LABEL : GREY)
        sc.lines[1].set(c ? `ICP RMS ${(c.rms * 100).toFixed(1)} cm (gate ${q.rms} cm) · ${Math.round(c.frac * 100)} % paired` : `${R.closures.filter((x) => x.i <= k).length} of ${R.closures.length} candidates tested so far`, GREY)
        sc.lines[2].set(c ? (c.accepted ? `accepted: drift measured ${cm(corrOf(R.est, c))}` : 'rejected: fit not tight enough') : `${done.length} loop closures accepted`, c ? (c.accepted ? POWER : HIGH_V) : GREY)
        s.status.set(`Loop closure · ${c ? (c.accepted ? 'match accepted' : 'match rejected') : 'searching'} · estimate off by ${cm(R.err[k])}`, c ? (c.accepted ? POWER : HIGH_V) : LABEL)
        s.sub.set(`lidar odometry, ${N + 1} keyframes · search ${q.radius} cm · gate ${q.rms} cm · wheel drift ${q.drift}°/m · ${KF_SLOW} s per keyframe`)
      },
      readouts: (p) => {
        const R = lcRun(lcParams(p))
        const first = R.ok[0]
        return [
          { label: 'Candidates tested', value: `${R.closures.length}` },
          { label: 'Closures accepted', value: `${R.ok.length}`, tone: R.ok.length ? 'ok' : 'bad' },
          { label: 'First closure', value: first ? `keyframe ${first.i} → ${first.j}` : 'none' },
          { label: 'Drift measured / true', value: first ? `${cm(corrOf(R.est, first))} / ${cm(R.err[first.i])}` : '—' },
        ]
      },
    }
  },
}

// --- Pose graphs: keyframes as nodes, odometry and closures as springs, Gauss–Newton pulls the path straight. ---

const MODES = { found: 'Closures found by matching', none: 'No closures (odometry only)', bad: 'Found + one false closure' }
type Mode = keyof typeof MODES
const PG_ITERS = 6
const pgParams = (p: Params) => ({ mode: pick(MODES, p.mode, 'found') as Mode, trust: n(p, 'trust'), drift: n(p, 'drift'), seed: n(p, 'seed') })
const pgKey = (q: ReturnType<typeof pgParams>) => `${q.mode}|${q.trust}|${q.drift}|${q.seed}`
const pgRun = memoBy(pgKey, (q: ReturnType<typeof pgParams>) => {
  const kfs = driveOf(q)
  const est = kfs.map((k) => k.icp)
  const closures = q.mode === 'none' ? [] : findClosures(kfs, est, 0.5, 0.025)
  const edges: PgEdge[] = slamGraph(est, closures, 10 ** q.trust)
  if (q.mode === 'bad') {
    const [i, j] = [4, Math.round(kfs.length / 2)]
    edges.push({ i, j, z: { x: 0.3, y: 0, th: 0 }, wXY: edges[0].wXY * 10 ** q.trust, wTh: edges[0].wTh * 10 ** q.trust, loop: true })
  }
  const sol = poseGraphSolve(est, edges, PG_ITERS)
  const maps = sol.poses.map((ps) => keyframeMap(kfs, ps))
  const errs = sol.poses.map((ps) => ps.map((pp, i) => poseDist(pp, kfs[i].truth)))
  const loops = edges.filter((e) => e.loop).map((e): [number, number] => [e.i, e.j])
  return { kfs, est, edges, loops, sol, maps, errs, wrong: maps.map((g) => occStats(g, TRUTH).wrong), maxErr: errs.map((e) => Math.max(...e)) }
})

export const slamPoseGraphs: Lesson = {
  id: 'slam-pose-graphs',
  title: 'Pose graphs',
  tagline: 'Keyframes are nodes, every odometry step and loop closure is a spring between two of them. Least squares finds the poses that stretch the springs least, and the map snaps straight',
  formula: 'edge error eᵢⱼ = (xᵢ⁻¹ ⊕ xⱼ) − zᵢⱼ · minimise χ² = Σ eᵀΩe · Gauss–Newton: H = ΣJᵀΩJ, b = ΣJᵀΩe, solve HΔ = −b, x ← x + Δ (first node held)',
  legend: [
    { color: RING, label: 'Keyframes being optimised · grey dots = before', shape: 'dot' },
    { color: C.edge, label: 'Odometry edge (lidar odometry)', shape: 'dot' },
    { color: HEAT, label: 'Loop-closure edge', shape: 'dot' },
    { color: C.odo, label: 'Scope: error per keyframe, grey before, yellow now', shape: 'dot' },
  ],
  points: [
    'Front end, back end. The front end turns sensor data into constraints: odometry between consecutive keyframes (The chicken-and-egg problem) and loop closures to old ones (Loop closure). The back end treats each constraint as a spring with a stiffness Ω = 1/σ² and finds the poses with the least total stretch, χ².',
    'Before optimising, all the drift sits in the loop-closure edge: the odometry chain says the robot is 20 cm away, the closure says it is back. Gauss–Newton linearises every edge around the current poses, solves one sparse linear system for all corrections at once and repeats; in 2-D it settles in 2 or 3 steps.',
    'The error is spread along the loop in proportion to stiffness, not dumped at the end: early keyframes move a little, late ones a lot. Then the map is redrawn from the corrected poses, which is why SLAM keeps the scans, not just the grid (see Occupancy grids).',
    'Trust sets the closure stiffness relative to odometry; with the closure much weaker it barely pulls. A false closure is believed just as firmly and warps the whole map: robust kernels (Huber, switchable constraints) shrink edges that disagree with the rest. g2o, GTSAM, Ceres and slam_toolbox in ROS 2 do the same at thousands of nodes using the sparsity of H.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'found' },
    { kind: 'slider', key: 'trust', label: 'Closure trust vs odometry', min: -2, max: 2, step: 1, initial: 0, format: (v: number) => `${10 ** v}×` },
    driftSlider,
    seedSlider,
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = slamStage(scene)
    const before = pointCloud(s.g, 48, 0.022)
    const beforeE = rayFan(s.g, 48, glowMat(GREY, 0.5), 0.004)
    const sc = errScope(scene, 'error per keyframe', 'keyframe 0')
    const tBefore = sc.plot.trace(GREY, { samples: 60, radius: 0.07 })
    const tNow = sc.plot.trace(RING, { samples: 60, radius: 0.09 })
    const clock = simClock(1.1, 3)
    const st = { key: '', k: -1, u: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = pgParams(p)
        const key = pgKey(q)
        const R = pgRun(q)
        const N = R.kfs.length - 1
        const t = clock(dt, key, PG_ITERS + 1) - 1
        const k = Math.max(0, Math.min(PG_ITERS, Math.floor(t)))
        const u = t < 0 || k === PG_ITERS ? 0 : Math.min(1, (t - k) * 1.6)
        const P = R.sol.poses
        const poses = P[k].map((pp, i) => lerpPose(pp, P[Math.min(PG_ITERS, k + 1)][i], u))
        s.bot.set(R.kfs[N].truth, 0, 0)
        s.ghost.set(poses[N], 0, 0)
        if (key === st.key && k === st.k && Math.abs(u - st.u) < 0.01) return
        if (key !== st.key) {
          R.est.forEach((pp, i) => before.set(i, [pp.x, pp.y, 0.04], GREY))
          before.show(R.est.length)
          beforeE(R.est.slice(1).map((pp, i): [V3, V3] => [[R.est[i].x, R.est[i].y, 0.04], [pp.x, pp.y, 0.04]]))
        }
        const step = k !== st.k || key !== st.key
        Object.assign(st, { key, k, u })
        s.graph(poses, N, R.loops)
        if (!step) return
        s.tiles.draw(R.maps[k])
        const us = R.kfs.map((_, i) => i / N)
        tBefore.points(us, R.errs[0].map((v) => yOf(v, 0.5)))
        tNow.points(us, R.errs[k].map((v) => yOf(v, 0.5)))
        sc.cursor(1)
        sc.range.set('0 … 50 cm · grey before · yellow after this iteration')
        sc.xRight.set(`keyframe ${N}`)
        const nLoop = R.loops.length
        sc.lines[0].set(`iteration ${k} of ${PG_ITERS} · χ² ${R.sol.costs[k].toFixed(1)} (start ${R.sol.costs[0].toFixed(1)})`, LABEL)
        sc.lines[1].set(`${R.edges.length - nLoop} odometry edges · ${nLoop} loop edges · ${N + 1} nodes`, GREY)
        const good = R.maxErr[k] < 0.06
        sc.lines[2].set(`worst keyframe ${cm(R.maxErr[k])}, was ${cm(R.maxErr[0])}`, good ? POWER : k ? HIGH_V : GREY)
        s.status.set(`Pose graph · ${t < 0 ? 'before optimising' : `Gauss–Newton step ${k}`} · worst keyframe ${cm(R.maxErr[k])}`, good ? POWER : LABEL)
        s.sub.set(`${MODES[q.mode]} · closure trust ${10 ** q.trust}× · wheel drift ${q.drift}°/m · 1.1 s per step`)
      },
      readouts: (p) => {
        const R = pgRun(pgParams(p))
        const L = PG_ITERS
        return [
          { label: 'χ² before → after', value: `${R.sol.costs[0].toFixed(0)} → ${R.sol.costs[L].toFixed(1)}` },
          { label: 'Worst keyframe', value: `${cm(R.maxErr[0])} → ${cm(R.maxErr[L])}`, tone: R.maxErr[L] < 0.06 ? 'ok' : 'bad' },
          { label: 'Map cells wrong', value: `${R.wrong[0]} → ${R.wrong[L]}` },
          { label: 'Loop edges', value: `${R.loops.length}` },
        ]
      },
    }
  },
}
