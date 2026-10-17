import * as THREE from 'three/webgpu'
import {
  Collect, CollectRound, DEMO_SLIP, DriveStep, IL, LaneState, Track, demoLaps, expertCurv, firstRound, imitationGap, laneDrive, laneFeatures, laneScore, lineAt, netCurv, nextRound,
  peanutTrack, toSamples, clonePolicy, Pose,
} from '../../core/physics'
import { pct } from '../../core/units'
import { V3, add, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { DATA_COLOR, ELECTRON, GREY, HEAT, HIGH_V, LABEL, POWER, addLabel, chordPath, countBars, diffBot, flatBox, floorView, glowMat, liveLabel, memoBy, pointCloud, setGlow, statusHeader } from '../fx'
import { Lesson, Params, Readout, Stage, n, opts, pick } from '../types'

const VIEW = { center: [-0.6, 1.0, 0] as V3, radius: 62, polar: Math.PI / 2, azimuth: 0 }
const toneOf = (good: boolean, ok: boolean): Readout['tone'] => (good ? 'ok' : ok ? 'warn' : 'bad')
const TRACK = peanutTrack()
const TESTS = 4
const SPEEDUP = 2
const HOLD_S = 1.6
const DEMO_C = ELECTRON
const CLONE_C = HEAT
const NEW_C = DATA_COLOR
const curvText = (u: number) => `${u > 0.05 ? 'left' : u < -0.05 ? 'right' : 'straight'} ${Math.abs(u).toFixed(1)} /m`

/** Lane surface between the two edges. */
function laneBand(g: THREE.Object3D, tr: Track) {
  const pos: number[] = []
  const N = tr.pts.length
  for (let i = 0; i < N; i++) {
    const [a, b] = [tr.pts[i], tr.pts[(i + 1) % N]]
    const edge = (q: typeof a, s: number): V3 => [q.x - s * tr.half * Math.sin(q.th), q.y + s * tr.half * Math.cos(q.th), 0.002]
    const [a0, a1, b0, b1] = [edge(a, -1), edge(a, 1), edge(b, -1), edge(b, 1)]
    pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.computeVertexNormals()
  const m = mesh(geo, mat('#3a3e46', { rough: 0.9 }))
  m.castShadow = false
  g.add(m)
  for (const s of [-1, 1]) chordPath(g, N, LABEL, 0.008, 0.006)([...tr.pts, tr.pts[0]].map((q) => ({ x: q.x - s * tr.half * Math.sin(q.th), y: q.y + s * tr.half * Math.cos(q.th) })))
  chordPath(g, N, '#f2f2ee', 0.012, 0.007)([...tr.pts, tr.pts[0]])
}

/** Track on a tilted floor, demonstrator ghost + clone robot, their paths, and a crash marker. */
function trackStage(scene: THREE.Scene, pathColor = DEMO_C) {
  const g = floorView(scene, [-8.0, -1.3, 0], 5.2, -0.6)
  flatBox(g, [3.6, 2.2, 0.01], mat('#24272d', { rough: 0.95 }), [0, 0, -0.006])
  laneBand(g, TRACK)
  const demoPath = chordPath(g, 900, pathColor, 0.01, 0.011)
  const clonePath = chordPath(g, 900, CLONE_C, 0.012, 0.013)
  const ghost = diffBot(g, { ghost: DEMO_C })
  const bot = diffBot(g)
  for (const b of [ghost, bot]) b.group.scale.setScalar(1.4)
  const crash = add(g, mesh(new THREE.TorusGeometry(0.14, 0.014, 8, 24), glowMat(HIGH_V, 1.2)))
  const tag = liveLabel(scene, [-8.0, -6.6, 3], { size: 0.3 })
  return { demoPath, clonePath, ghost, bot, crash, tag }
}

/** Plays a test drive at SPEEDUP× with a hold at the end; returns the step index. */
function playClock() {
  const s = { key: '', t: 0 }
  return (dt: number, key: string, steps: number) => {
    if (key !== s.key) Object.assign(s, { key, t: 0 })
    s.t += dt
    const dur = (steps * IL.dt) / SPEEDUP
    if (s.t > dur + HOLD_S) s.t = 0
    return Math.min(steps - 1, Math.floor((s.t * SPEEDUP) / IL.dt))
  }
}

const SC = { x: 10.8, y: 0.8, half: 2.8, m: 0.13 }
/** Scatter of what the camera sees: line position in the near row (x) vs the far row (y). */
function stateScatter(scene: THREE.Scene, max: number) {
  const g = add(scene, new THREE.Group(), [SC.x, SC.y, 0])
  const frame = mat('#4a4f58', { rough: 0.6 })
  flatBox(g, [2 * SC.half, 2 * SC.half, 0.04], mat('#1b1d22', { rough: 0.8 }), [0, 0, -0.1])
  flatBox(g, [2 * SC.half, 0.04, 0.04], frame, [0, 0, 0])
  flatBox(g, [0.04, 2 * SC.half, 0.04], frame, [0, 0, 0])
  const fov = (3.5 * IL.pitch * SC.half) / SC.m
  for (const [w, h, x, y] of [[2 * fov, 0.05, 0, fov], [2 * fov, 0.05, 0, -fov], [0.05, 2 * fov, fov, 0], [0.05, 2 * fov, -fov, 0]]) flatBox(g, [w, h, 0.05], mat('#6a6f78'), [x, y, 0.02])
  addLabel(scene, 'line seen by the camera, near row →', [SC.x, SC.y - SC.half - 0.5, 0.3], GREY, 0.24)
  addLabel(scene, 'far row ↑', [SC.x - SC.half - 0.2, SC.y + SC.half - 0.2, 0.3], GREY, 0.24, 'right')
  addLabel(scene, 'camera view', [SC.x + fov - 0.1, SC.y + fov + 0.3, 0.3], GREY, 0.22, 'right')
  const dots = pointCloud(g, max, 0.07)
  const k = { n: 0 }
  const at = (s: LaneState): V3 => {
    const c = (v: number) => Math.max(-SC.half, Math.min(SC.half, (v / SC.m) * SC.half))
    return [c(lineAt(s, IL.rows[0])), c(lineAt(s, IL.rows[1])), 0.08]
  }
  return {
    clear: () => (k.n = 0),
    add(steps: readonly DriveStep[], color: string, every = 1, scale = 1) {
      for (let i = 0; i < steps.length && k.n < max; i += every) dots.set(k.n++, at(steps[i].st), color, scale)
    },
    show: () => dots.show(k.n),
  }
}

const [CELL_OFF, CELL_ON, CELL_C] = [new THREE.Color('#202329'), new THREE.Color('#f2f2ee'), new THREE.Color()]
/** The clone's camera strip (2 rows × 7 cells) and what each driver would steer. */
function cameraPanel(scene: THREE.Scene, at: V3) {
  const cells = IL.rows.map((_row, r) =>
    Array.from({ length: IL.cells }, (_, j) => {
      const m = glowMat('#ffffff', 0.2)
      flatBox(scene, [0.62, 0.5, 0.06], m, [at[0] + (j - (IL.cells - 1) / 2) * 0.7, at[1] + (1 - r) * 0.6, 0])
      return m
    }),
  )
  addLabel(scene, 'clone camera strip (far, near)', [at[0], at[1] + 1.3, 0.3], GREY, 0.24)
  const bars = countBars(scene, [at[0] - 1.6, at[1] - 1.0, 0], ['demonstrator', 'clone'], 4.2, { row: 0.6, size: 0.26 })
  return {
    set(s: LaneState, uClone: number) {
      const f = laneFeatures(s)
      cells.forEach((row, r) => row.forEach((m, j) => setGlow(m, `#${CELL_C.lerpColors(CELL_OFF, CELL_ON, f[(IL.rows.length - 1 - r) * IL.cells + IL.cells - 1 - j]).getHexString()}`, 0.6)))
      const u = [expertCurv(s), uClone]
      bars.set(u.map(Math.abs), u.map(curvText), [DEMO_C, CLONE_C], IL.uMax)
    },
  }
}

const worstRun = <R extends { dist: number }>(runs: R[]) => runs.reduce((a, r) => (r.dist < a.dist ? r : a), runs[0])
const poseOf = (f: DriveStep): Pose => f.pose

// --- Behaviour cloning: fit demonstrator actions on demonstrator states; the clone's small errors carry it into states it never saw. ---

const bcParams = (p: Params) => ({ laps: n(p, 'laps'), slip: n(p, 'slip') })
type BcQ = ReturnType<typeof bcParams>
const bcTrain = memoBy(
  (q: BcQ) => `${q.laps}`,
  (q: BcQ) => {
    const demos = demoLaps(TRACK, q.laps, DEMO_SLIP)
    const steps = demos.flatMap((r) => r.steps)
    const data = toSamples(steps)
    const net = clonePolicy(data)
    return { demos, steps, data, net, gapDemo: imitationGap(net, steps) }
  },
)
const bcTest = memoBy(
  (q: BcQ) => `${q.laps}|${q.slip}`,
  (q: BcQ) => {
    const T = bcTrain(q)
    const score = laneScore(TRACK, (s) => netCurv(T.net, s), q.slip, TESTS)
    const run = worstRun(score.runs)
    const i = score.runs.indexOf(run)
    const expert = laneDrive(TRACK, expertCurv, { slip: q.slip, seed: 500 + i, start: Math.round((i * TRACK.pts.length) / TESTS) })
    const expertDone = laneScore(TRACK, expertCurv, q.slip, TESTS).done
    return { score, run, expert, expertDone, gapOwn: imitationGap(T.net, score.runs.flatMap((r) => r.steps)) }
  },
)

export const imitationLearningBehaviourCloning: Lesson = {
  id: 'imitation-learning-behaviour-cloning',
  title: 'Behaviour cloning',
  tagline: 'Record a good driver, then train a net to copy its steering from the camera. It copies well on the states it saw, but every small slip takes it somewhere new, and there it has no idea what to do',
  formula: `demonstrator: κ = κ_ahead − ${IL.k1}·d − ${IL.k2}·ψ · clone: κ = π(camera strip), 14 → ${IL.hidden} tanh → 1 · train: minimise Σ (π(s) − κ_demo(s))² over demo states · test: states come from the clone's own driving`,
  legend: [
    { color: DEMO_C, label: 'Demonstrator: demo states, ghost robot', shape: 'dot' },
    { color: CLONE_C, label: 'Clone: its test drive and the states it reached', shape: 'dot' },
    { color: '#f2f2ee', label: 'Tape line; lane ± 15 cm', shape: 'dot' },
    { color: HIGH_V, label: 'Left the lane', shape: 'dot' },
  ],
  points: [
    'Imitation learning skips the reward of Reinforcement learning: someone who can already do the task drives, and the robot records pairs of (what it sees, what the driver did). Here the driver is the PD steering from Control, Line following, plus a look at the bend ahead; it could equally be you with a joystick. The robot sees the tape through two rows of a camera strip.',
    'Behaviour cloning is plain supervised learning on those pairs: a small net (see Neural nets 101) maps the 14 camera cells to a steering curvature, trained to match the demonstrator. On the demo states it matches to a few hundredths of 1/m.',
    'The catch: a good driver stays near the line, so the data only shows the tape in the middle cells (blue cloud). The clone is a little off, and its errors move it into states the demonstrator never visited; there its outputs are guesses, the next error is bigger, and it walks off the lane. The training and test states come from different distributions: covariate shift. Errors compound with time instead of averaging out.',
    'Turn the floor slip up: the demonstrator, pushed around by the same bumps, still recovers every time; the clone only survives slip close to what it saw in the demos. More laps of the same careful driving add more of the same states and do not help. The fix is better data, not more: next lesson.',
  ],
  controls: [
    { kind: 'slider', key: 'laps', label: 'Demo laps', min: 1, max: 6, step: 1, initial: 2, format: (v: number) => `${v}` },
    { kind: 'slider', key: 'slip', label: 'Floor slip in the test', min: 0.05, max: 0.6, step: 0.05, initial: 0.3, format: (v: number) => `${v.toFixed(2)} rad/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const T = trackStage(scene)
    const sc = stateScatter(scene, 1400)
    const cam = cameraPanel(scene, [10.8, -4.4, 0])
    const clock = playClock()
    const st = { key: '', k: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = bcParams(p)
        const key = `${q.laps}|${q.slip}`
        const B = bcTrain(q)
        const R = bcTest(q)
        const k = clock(dt, key, R.run.steps.length)
        if (key !== st.key) {
          st.key = key
          st.k = -1
          T.demoPath(B.demos[0].steps.map(poseOf))
          status.set(`Behaviour cloning · ${q.laps} demo lap${q.laps > 1 ? 's' : ''} on a ${DEMO_SLIP} rad/s floor · test floor ${q.slip.toFixed(2)} rad/s`, LABEL)
          sub.set(`${B.data.length} (camera, steering) pairs · fit error on demo states ${B.gapDemo.toFixed(2)} /m · on its own states ${R.gapOwn.toFixed(2)} /m · ${SPEEDUP}× speed`, GREY)
          event.set(
            R.score.done === 1 ? 'the clone finishes every test lap: the test states look like the demos' : `worst of ${TESTS} test drives: off the lane after ${R.run.dist.toFixed(1)} m; demonstrator finishes ${pct(R.expertDone)}`,
            R.score.done === 1 ? POWER : R.score.done > 0 ? HEAT : HIGH_V,
          )
        }
        if (k === st.k) return
        st.k = k
        const f = R.run.steps[k]
        const ef = R.expert.steps[Math.min(k, R.expert.steps.length - 1)]
        T.bot.set(f.pose, k * IL.v * IL.dt, k * IL.v * IL.dt)
        T.ghost.set(ef.pose)
        T.clonePath(R.run.steps.map(poseOf), k + 1)
        const end = R.run.off && k === R.run.steps.length - 1
        T.crash.visible = end
        if (end) T.crash.position.set(f.pose.x, f.pose.y, 0.02)
        T.tag.set(end ? `left the lane after ${R.run.dist.toFixed(1)} m` : `clone ${(k * IL.v * IL.dt).toFixed(1)} m of ${TRACK.length.toFixed(1)} m · offset ${(f.st.d * 100).toFixed(1)} cm`, end ? HIGH_V : LABEL)
        cam.set(f.st, f.u)
        sc.clear()
        sc.add(B.steps, DEMO_C, Math.max(1, Math.round(B.steps.length / 600)))
        sc.add(R.run.steps.slice(0, k + 1), CLONE_C, 2, 1.3)
        sc.show()
      },
      readouts: (p) => {
        const q = bcParams(p)
        const B = bcTrain(q)
        const R = bcTest(q)
        return [
          { label: 'Error on demo states', value: `${B.gapDemo.toFixed(2)} /m`, tone: 'ok' },
          { label: 'Error on its own states', value: `${R.gapOwn.toFixed(2)} /m`, tone: toneOf(R.gapOwn < 0.15, R.gapOwn < 0.4) },
          { label: `Clone finishes (${TESTS} tests)`, value: pct(R.score.done), tone: toneOf(R.score.done === 1, R.score.done > 0) },
          { label: 'Demonstrator finishes', value: pct(R.expertDone), tone: toneOf(R.expertDone === 1, R.expertDone > 0) },
        ]
      },
    }
  },
}

// --- Data collection: more of the same vs noise-injected demos vs DAgger (the clone drives, the demonstrator labels). ---

const DC_HOW: Record<Collect, string> = { more: 'More clean demos', noisy: 'Demos with injected noise', dagger: 'DAgger: clone drives, expert labels' }
const DC_ROUNDS = 6
const dcParams = (p: Params) => ({ how: pick(DC_HOW, p.how, 'dagger') as Collect, round: n(p, 'round'), slip: n(p, 'slip') })
type DcQ = ReturnType<typeof dcParams>
let base: CollectRound | undefined
const dcBase = () => (base ??= firstRound(TRACK))
const dcChain = memoBy(
  (q: DcQ) => `${q.how}|${q.slip}`,
  () => [dcBase()],
)
const dcRound = (q: DcQ) => {
  const chain = dcChain(q)
  while (chain.length <= q.round) chain.push(nextRound(TRACK, q.how, chain[chain.length - 1], chain.length, q.slip))
  return chain[q.round]
}
const dcScores = new Map<string, ReturnType<typeof laneScore>>()
const dcScore = (q: DcQ, r: number) => {
  const key = `${q.how}|${q.slip}|${r}`
  if (!dcScores.has(key)) dcScores.set(key, laneScore(TRACK, (s) => netCurv(dcRound({ ...q, round: r }).net, s), q.slip, TESTS))
  return dcScores.get(key)!
}
const dcEval = memoBy(
  (q: DcQ) => `${q.how}|${q.slip}|${q.round}`,
  (q: DcQ) => {
    const R = dcRound(q)
    const score = dcScore(q, q.round)
    return { R, score, run: worstRun(score.runs), labels: R.data.length, history: Array.from({ length: q.round + 1 }, (_, r) => dcScore(q, r).done) }
  },
)

export const imitationLearningDataCollection: Lesson = {
  id: 'imitation-learning-data-collection',
  title: 'Data collection',
  tagline: 'A clone fails on the states it never saw, so collect those states. Shake the demonstrator off the line on purpose, or let the clone drive and have the demonstrator say what it should have done: DAgger',
  formula: 'DAgger round k: drive with π_k on the real floor → states s₁…s_T · ask the demonstrator a*(s) for each · D ← D ∪ {(s, a*)} · π_{k+1} = fit(D) · noisy demos: execute a* + N(0, σ²), store a*',
  legend: [
    { color: DEMO_C, label: 'Data from earlier rounds', shape: 'dot' },
    { color: NEW_C, label: 'Data added this round (its drive on the track)', shape: 'dot' },
    { color: CLONE_C, label: 'Clone of this round: test drive and its states', shape: 'dot' },
    { color: HIGH_V, label: 'Left the lane', shape: 'dot' },
  ],
  points: [
    'Behaviour cloning failed because the demos only covered states near the line. The data has to include the mistakes and how to recover from them. Three ways to spend one more lap of driving per round, starting from the same 2 clean laps:',
    'More clean demos: the demonstrator is good, so the new lap lands in the same blue cloud. The dataset grows, coverage does not, and the clone keeps leaving the lane.',
    'Noise injection (DART): the demonstrator drives with random wobble added to its own steering, but each state is stored with the clean action it wanted. The car is pushed off-line and the data records the way back. You choose the noise: too little adds nothing, too much and the demos stop looking like real driving.',
    'DAgger (dataset aggregation): the clone drives on the real test floor and the demonstrator only labels, saying what it would steer in each state the clone reached; the robot does not obey it. The new states are exactly where the clone goes wrong, so a few rounds close the gap. It needs a demonstrator that can label on demand (a controller, a planner, or a person with a joystick watching replays), and each round costs a test drive, so start somewhere safe. The same idea trains policies in simulation first: see Reinforcement learning, Sim to real.',
  ],
  controls: [
    { kind: 'choice', key: 'how', options: opts(DC_HOW), initial: 'dagger' },
    { kind: 'slider', key: 'round', label: 'Round', min: 0, max: DC_ROUNDS, step: 1, initial: 3, format: (v: number) => `${v}` },
    { kind: 'slider', key: 'slip', label: 'Floor slip in the test', min: 0.15, max: 0.45, step: 0.15, initial: 0.3, format: (v: number) => `${v.toFixed(2)} rad/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const T = trackStage(scene, NEW_C)
    T.ghost.group.visible = false
    const sc = stateScatter(scene, 2600)
    const bars = countBars(scene, [9.4, -4.3, 0], Array.from({ length: DC_ROUNDS + 1 }, (_, r) => `round ${r}`), 3.8, { row: 0.48, size: 0.26 })
    addLabel(scene, `clone finishes (${TESTS} test laps)`, [8.2, -3.6, 0.3], GREY, 0.26, 'left')
    const clock = playClock()
    const st = { key: '', k: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = dcParams(p)
        const key = `${q.how}|${q.round}|${q.slip}`
        const E = dcEval(q)
        const k = clock(dt, key, E.run.steps.length)
        if (key !== st.key) {
          st.key = key
          st.k = -1
          T.demoPath(E.R.added.map(poseOf))
          const rows = Array.from({ length: DC_ROUNDS + 1 }, (_, r) => (r <= q.round ? E.history[r] : null))
          bars.set(
            rows.map((v) => (v === null ? 0 : Math.max(0.02, v))),
            rows.map((v) => (v === null ? '' : pct(v))),
            rows.map((v, r) => (v !== null && r === q.round ? (v === 1 ? POWER : v > 0 ? HEAT : HIGH_V) : GREY)),
            1,
          )
          status.set(`Data collection · ${DC_HOW[q.how]} · round ${q.round} · test floor ${q.slip.toFixed(2)} rad/s`, LABEL)
          sub.set(`${E.labels} labelled states (round 0: 2 clean laps) · ${q.round ? `round ${q.round} added ${E.R.added.length} states (purple path)` : 'purple path: one of the demo laps'} · ${SPEEDUP}× speed`, GREY)
          event.set(
            E.score.done === 1 ? 'the clone finishes every test lap' : `worst of ${TESTS} test drives: off the lane after ${E.run.dist.toFixed(1)} m`,
            E.score.done === 1 ? POWER : E.score.done > 0 ? HEAT : HIGH_V,
          )
        }
        if (k === st.k) return
        st.k = k
        const f = E.run.steps[k]
        T.bot.set(f.pose, k * IL.v * IL.dt, k * IL.v * IL.dt)
        T.clonePath(E.run.steps.map(poseOf), k + 1)
        const end = E.run.off && k === E.run.steps.length - 1
        T.crash.visible = end
        if (end) T.crash.position.set(f.pose.x, f.pose.y, 0.02)
        T.tag.set(end ? `left the lane after ${E.run.dist.toFixed(1)} m` : `clone ${(k * IL.v * IL.dt).toFixed(1)} m of ${TRACK.length.toFixed(1)} m · offset ${(f.st.d * 100).toFixed(1)} cm`, end ? HIGH_V : LABEL)
        sc.clear()
        const chain = dcChain(q)
        for (let r = 0; r < q.round; r++) sc.add(chain[r].added, DEMO_C, 3)
        sc.add(E.R.added, q.round ? NEW_C : DEMO_C, q.round ? 2 : 3, q.round ? 1.2 : 1)
        sc.add(E.run.steps.slice(0, k + 1), CLONE_C, 2, 1.3)
        sc.show()
      },
      readouts: (p) => {
        const q = dcParams(p)
        const E = dcEval(q)
        return [
          { label: 'Labelled states', value: `${E.labels}` },
          { label: 'Clone finishes', value: pct(E.score.done), tone: toneOf(E.score.done === 1, E.score.done > 0) },
          { label: 'Error on its own states', value: `${imitationGap(E.R.net, E.score.runs.flatMap((r) => r.steps)).toFixed(2)} /m` },
          { label: 'Mean distance before leaving', value: `${E.score.dist.toFixed(1)} of ${TRACK.length.toFixed(1)} m` },
        ]
      },
    }
  },
}
