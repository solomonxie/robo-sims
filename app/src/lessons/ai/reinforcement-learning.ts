import * as THREE from 'three/webgpu'
import { GridWorld, GwStepLog, QTable, argmaxQ, evalPolicy, greedyPolicy, gwRollout, parseGrid, qLearn, runningMean, valueIteration, valuesOf } from '../../core/physics'
import { pct } from '../../core/units'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { GREY, GW_COLORS, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, countBars, floorView, gridWorldBoard, liveLabel, memoBy, scope, statusHeader, valueTint } from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const VIEW = { center: [-0.6, 1.2, 0] as V3, radius: 62, polar: Math.PI / 2, azimuth: 0 }
const STEP_S = 0.45
const HOLD_S = 1.4
const SHOW_STEPS = 40
const ARROWS = ['↑', '→', '↓', '←']
const signed = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`

function board(scene: THREE.Scene, world: GridWorld, numberSize = 0) {
  const k = Math.min(11, 19 / (world.w * 0.25))
  const g = floorView(scene, [-18.6, -4.0 - (world.h * 0.25 * k * Math.cos(0.5)) / 2, 0], k, -0.5)
  return gridWorldBoard(g, world, { numberSize })
}
/** Episode replay: k steps done (fractional), a hold, then episode ep + 1. */
function replayClock() {
  const s = { key: '', t: 0, ep: 0 }
  return (dt: number, key: string, stepsOf: (ep: number) => number) => {
    if (key !== s.key) Object.assign(s, { key, t: 0, ep: 0 })
    s.t += dt
    if (s.t > stepsOf(s.ep) * STEP_S + HOLD_S) Object.assign(s, { t: 0, ep: s.ep + 1 })
    return { k: Math.min(stepsOf(s.ep), s.t / STEP_S), ep: s.ep }
  }
}
const endText = { goal: 'reached the dock', pit: 'fell down the drop', near: 'took the small prize', timeout: 'still wandering' }
const endColor = { goal: POWER, pit: HIGH_V, near: RING, timeout: HEAT }
const vText = (v: number) => (Math.abs(v) >= 9.95 ? v.toFixed(0) : v.toFixed(1))
const sumTo = (log: readonly GwStepLog[], k: number, gamma = 1) => log.slice(0, k).reduce((t, e, i) => t + e.r * gamma ** i, 0)

// --- Reward and policy: rewards define the task; value iteration turns them into V(s) and a policy. Step cost alone flips the route. ---

const RP_ROWS = ['.......', '.......', '.##.#..', '.......', 'SPPPPPG']
const RP_EVAL = 400
const rpParams = (p: Params) => ({ step: n(p, 'step'), gamma: n(p, 'gamma'), slip: n(p, 'slip') })
type RpQ = ReturnType<typeof rpParams>
const rpSolve = memoBy(
  (q: RpQ) => `${q.step}|${q.gamma}|${q.slip}`,
  (q: RpQ) => {
    const world = parseGrid(RP_ROWS, { step: q.step, goal: 10, pit: -10 })
    const vi = valueIteration(world, q.gamma, q.slip)
    return { world, ...vi, ev: evalPolicy(world, vi.policy, q.slip, RP_EVAL, 11) }
  },
)
const rpEpisode = memoBy(
  (a: { q: RpQ; ep: number }) => `${a.q.step}|${a.q.gamma}|${a.q.slip}|${a.ep}`,
  ({ q, ep }: { q: RpQ; ep: number }) => {
    const S = rpSolve(q)
    return gwRollout(S.world, S.policy, q.slip, 101 + ep, SHOW_STEPS)
  },
)
const rpRegime = (S: ReturnType<typeof rpSolve>) =>
  S.ev.timeout > 0.5
    ? { text: 'living pays: the best plan is to never finish', color: HEAT }
    : S.ev.pit > 0.5
      ? { text: 'each step hurts more than the drop: it jumps straight in', color: HIGH_V }
      : S.ev.meanSteps < 16
        ? { text: 'steps are dear: it takes the short way along the edge and sometimes falls', color: HEAT }
        : { text: 'steps are cheap: it takes the long way round, far from the edge', color: POWER }

export const reinforcementLearningRewardAndPolicy: Lesson = {
  id: 'reinforcement-learning-reward-and-policy',
  title: 'Reward and policy',
  tagline: 'You do not tell the robot what to do, only what you like: +10 at the dock, −10 down the stairs, a small cost per step. The best policy falls out of those numbers, and changing one of them changes the route',
  formula: (p) => {
    const q = rpParams(p)
    return `return G = r₁ + γ r₂ + γ² r₃ + … · V(s) = maxₐ Σ p(s′|s,a) [r + γ V(s′)] · π(s) = the action that achieves it · r = ${signed(q.step, 2)} per step, +10 dock, −10 drop · γ = ${q.gamma.toFixed(2)} · skid ${pct(q.slip)}`
  },
  legend: [
    { color: GW_COLORS.goal, label: 'Dock: +10, episode ends', shape: 'dot' },
    { color: GW_COLORS.pit, label: 'Drop (stairs): −10, episode ends', shape: 'dot' },
    { color: GW_COLORS.arrow, label: 'Policy π(s): best action; number = V(s)', shape: 'dot' },
    { color: GREY, label: 'Tile tint: value, red bad → green good', shape: 'dot' },
  ],
  points: [
    'Reinforcement learning frames a task as states, actions and rewards. Here the state is the cell the robot is in, the actions are the four moves, and the reward is a number the environment hands back after each move. The robot wants the largest return: the sum of rewards, with later ones discounted by γ per step.',
    'The floor is slippery: with the skid chance shown, a move goes sideways instead (half each way). So a plan is not a fixed path but a policy π(s): what to do in every cell. Its quality in a cell is the value V(s), the return expected from there.',
    'Value iteration computes V for this small known world: repeat V(s) ← maxₐ Σ p [r + γ V(s′)] until nothing changes, then point every arrow at the best action. This needs the full model of the world (where every move can land); Q-learning, next lesson, learns the same thing by trial and error.',
    'Now move the step reward. A small cost: the robot takes the long way, two rows from the edge, because a skid there costs little. A larger cost makes the short route along the drop worth its risk. Bigger still and the cheapest return is to jump in right away. A positive reward for each step and it never goes home. The robot did exactly what the rewards said: reward design is the hard part (reward hacking).',
    'Look at the start cell with skid on: the arrow points into the wall. Pushing west either bumps (stay) or skids north, never into the drop. Nobody programmed that; it falls out of the maths. Graph search for comparison: Navigation, Maze solving / path planning.',
  ],
  controls: [
    { kind: 'slider', key: 'step', label: 'Reward per step', min: -3, max: 1, step: 0.05, initial: -0.05, format: (v: number) => signed(v, 2) },
    { kind: 'slider', key: 'gamma', label: 'Discount γ', min: 0.5, max: 0.99, step: 0.01, initial: 0.95, format: (v: number) => v.toFixed(2) },
    { kind: 'slider', key: 'slip', label: 'Skid chance', min: 0, max: 0.3, step: 0.05, initial: 0.2, format: (v: number) => pct(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const world0 = parseGrid(RP_ROWS, { step: 0, goal: 10, pit: -10 })
    const B = board(scene, world0, 0.065)
    const P = { x: 8.4, y: 1.4 }
    addLabel(scene, 'this episode', [P.x - 3.6, P.y + 0.9, 0.3], GREY, 0.3, 'left')
    const epLine = liveLabel(scene, [P.x - 3.6, P.y, 0.3], { size: 0.34, align: 'left' })
    const sumLine = liveLabel(scene, [P.x - 3.6, P.y - 0.8, 0.3], { size: 0.3, align: 'left' })
    const discLine = liveLabel(scene, [P.x - 3.6, P.y - 1.5, 0.3], { size: 0.3, align: 'left' })
    addLabel(scene, `this policy over ${RP_EVAL} episodes`, [P.x - 3.6, -2.4, 0.3], GREY, 0.3, 'left')
    const bars = countBars(scene, [P.x + 1.6, -3.4, 0], ['reached the dock', 'fell down the drop', `wandering > ${4 * world0.cells.length} steps`], 6, { row: 0.75, size: 0.3 })
    const meanLine = liveLabel(scene, [P.x - 3.6, -6.0, 0.3], { size: 0.3, align: 'left' })
    const clock = replayClock()
    const st = { key: '', shown: -1, ep: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = rpParams(p)
        const key = `${q.step}|${q.gamma}|${q.slip}`
        const S = rpSolve(q)
        if (key !== st.key) {
          st.key = key
          const free = S.V.filter((_, c) => B.free[c])
          const top = Math.max(1e-9, ...free.map(Math.abs))
          B.tiles((c) => valueTint(S.V[c] / top))
          B.arrows((c) => S.policy[c])
          B.numbers((c) => (S.world.cells[c] === 'G' ? '+10' : S.world.cells[c] === 'P' ? '−10' : vText(S.V[c])), () => LABEL)
          const E = S.ev
          bars.set([E.goal, E.pit, E.timeout], [pct(E.goal), pct(E.pit), pct(E.timeout)], [POWER, HIGH_V, HEAT], 1)
          meanLine.set(`average return ${signed(E.meanReturn)} in ${E.meanSteps.toFixed(1)} steps`, LABEL)
          status.set(`Reward and policy · ${signed(q.step, 2)} per step · γ ${q.gamma.toFixed(2)} · skid ${pct(q.slip)}`, LABEL)
          sub.set(`value iteration: ${S.sweeps} sweeps over ${B.free.filter(Boolean).length} cells · V(start) = ${S.V[S.world.start].toFixed(2)} · one step shown in ${STEP_S} s`, GREY)
          const R = rpRegime(S)
          event.set(R.text, R.color)
        }
        const { k, ep } = clock(dt, key, (e) => rpEpisode({ q, ep: e }).log.length)
        const run = rpEpisode({ q, ep })
        B.drive(run.log, k)
        const shown = Math.floor(k)
        if (shown === st.shown && ep === st.ep) return
        st.shown = shown
        st.ep = ep
        const over = shown >= run.log.length
        const moves = run.log.slice(0, shown).map((e) => (e.moved === e.a ? ARROWS[e.a] : `${ARROWS[e.a]}~${ARROWS[e.moved]}`))
        epLine.set(`#${ep + 1}: ${over ? endText[run.end] : `step ${shown}`}`, over ? endColor[run.end] : LABEL)
        sumLine.set(`G = Σ r = ${signed(sumTo(run.log, shown))}${moves.length ? `  ·  last: ${moves.slice(-4).join(' ')}` : ''}`, LABEL)
        discLine.set(`discounted Σ γᵗ r = ${signed(sumTo(run.log, shown, q.gamma))}  (~ = skid)`, GREY)
      },
      readouts: (p) => {
        const S = rpSolve(rpParams(p))
        return [
          { label: 'V(start)', value: S.V[S.world.start].toFixed(2) },
          { label: 'Reach the dock', value: pct(S.ev.goal), tone: toneOf(S.ev.goal > 0.95, S.ev.goal > 0.7) },
          { label: 'Fall', value: pct(S.ev.pit), tone: toneOf(S.ev.pit < 0.02, S.ev.pit < 0.2) },
          { label: 'Mean steps', value: S.ev.meanSteps.toFixed(1) },
        ]
      },
    }
  },
}

// --- Q-learning gridworld: no model, just trial and error; ε-greedy vs optimistic start; a nearby small prize traps a greedy learner. ---

const QL_ROWS = ['.......G', '.#####..', '...N.#..', '.###.#..', 'S.......']
const QL_EPISODES = 600
const QL_SNAP = 10
const QL_GAMMA = 0.95
const QL_ALPHA = 0.5
const QL_GOAL = 10
const QL_STARTS = { zero: 'Q starts at 0', optimistic: 'Q starts at +10 (optimistic)' }
const qlParams = (p: Params) => ({ episodes: n(p, 'episodes'), eps: n(p, 'eps'), start: pick(QL_STARTS, p.start, 'zero') })
type QlQ = ReturnType<typeof qlParams>
const QL_WORLD = parseGrid(QL_ROWS, { step: 0, goal: QL_GOAL, pit: -10, near: 1 })
const qlTrain = memoBy(
  (q: QlQ) => `${q.eps}|${q.start}`,
  (q: QlQ) => {
    const R = qLearn(QL_WORLD, { episodes: QL_EPISODES, alpha: QL_ALPHA, eps: q.eps, gamma: QL_GAMMA, slip: 0, seed: 5, q0: q.start === 'optimistic' ? QL_GOAL : 0, snapEvery: QL_SNAP })
    return { ...R, curve: runningMean(R.returns, 20) }
  },
)
const qlAt = memoBy(
  (q: QlQ) => `${q.eps}|${q.start}|${q.episodes}`,
  (q: QlQ) => {
    const T = qlTrain(q)
    const Q: QTable = T.snaps[Math.round(q.episodes / QL_SNAP)]
    const policy = greedyPolicy(Q)
    const run = gwRollout(QL_WORLD, policy, 0, 1, SHOW_STEPS)
    const done = T.outcomes.slice(0, q.episodes)
    const goals = done.filter((o) => o === 'goal').length
    return { Q, policy, run, goals, nears: done.filter((o) => o === 'near').length }
  },
)
const QL_END = { goal: 'dock', near: 'prize', pit: 'fell', timeout: 'loops' }
const triedRow = (q: ArrayLike<number>) => q[0] !== q[1] || q[1] !== q[2] || q[2] !== q[3]

export const reinforcementLearningQLearningGridworld: Lesson = {
  id: 'reinforcement-learning-q-learning-gridworld',
  title: 'Q-learning gridworld',
  tagline: 'No map, no model: the robot tries moves, keeps a table of how good each move turned out, and slowly the table becomes a policy. What it learns depends on how much it explores',
  formula: (p) => {
    const q = qlParams(p)
    return `Q(s,a) ← Q(s,a) + α [r + γ maxₐ′ Q(s′,a′) − Q(s,a)] · α = ${QL_ALPHA}, γ = ${QL_GAMMA} · ε-greedy: random move with chance ${q.eps.toFixed(1)}, else the best Q · +${QL_GOAL} dock, +1 small prize, 0 per step`
  },
  legend: [
    { color: GW_COLORS.goal, label: 'Dock: +10 (far)', shape: 'dot' },
    { color: GW_COLORS.near, label: 'Small prize: +1 (near), also ends the episode', shape: 'dot' },
    { color: POWER, label: 'Wedge per move: Q(s, a), grey 0 → green 10', shape: 'dot' },
    { color: GW_COLORS.arrow, label: 'Greedy policy: arrow = largest Q', shape: 'dot' },
    { color: RING, label: 'Return per training episode (mean of 20)', shape: 'dot' },
  ],
  points: [
    'Value iteration needed the full model: where every move can land. A real robot does not have that. Q-learning learns from experience instead: each cell keeps four numbers Q(s, a), one per move (the wedges), meaning "the return I expect if I make this move here and act well after".',
    'After every move the robot nudges that number toward what just happened: the reward plus γ times the best Q of the cell it landed in. Good news travels backwards one cell per visit: the wedges turn green from the dock outward as you scrub the episodes slider. The greedy policy is just the brightest wedge in each cell.',
    'There is a catch: you only learn about moves you try. Starting from zero with ε = 0 (always the best-looking move), the robot stumbles onto the small prize next door first, and from then on that looks better than every untried move. It settles for +1 forever and never finds the +10 dock. That is the exploration–exploitation trade-off.',
    'Two fixes. ε-greedy takes a random move with chance ε; it needs a lot of randomness here because the prize keeps ending episodes early. Optimistic start sets every Q to +10: untried moves look great, so the robot tries them all on purpose, finds the dock within a few episodes and settles on the 11-step route. Note the curve: training returns stay noisy as long as ε is high, even after the greedy policy is right.',
    'Tables work for 30 cells. For camera images or joint angles there are far too many states, so a neural net replaces the table (deep Q-network); see Neural nets 101.',
  ],
  controls: [
    { kind: 'slider', key: 'episodes', label: 'Training episodes', min: 0, max: QL_EPISODES, step: QL_SNAP, initial: 200, format: (v: number) => `${v}` },
    { kind: 'slider', key: 'eps', label: 'Exploration ε', min: 0, max: 1, step: 0.1, initial: 0.1, format: (v: number) => v.toFixed(1) },
    { kind: 'choice', key: 'start', options: opts(QL_STARTS), initial: 'zero' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const B = board(scene, QL_WORLD)
    const S = { x: 10.6, y: -0.2, w: 8, h: 4.4 }
    const plot = scope(scene, S.w, S.h, { divs: [6, 4], zeroAt: 0 })
    plot.group.position.set(S.x, S.y, 0)
    const CURVE_N = QL_EPISODES / 5 + 1
    const curve = plot.trace(RING, { samples: CURVE_N, radius: 0.07 })
    addLabel(scene, 'return per training episode (mean of 20)', [S.x - S.w / 2, S.y + S.h / 2 + 0.9, 0.3], LABEL, 0.28, 'left')
    addLabel(scene, '+10', [S.x - S.w / 2 - 0.3, S.y + S.h / 2, 0.3], GREY, 0.26, 'right')
    addLabel(scene, '0', [S.x - S.w / 2 - 0.3, S.y - S.h / 2, 0.3], GREY, 0.26, 'right')
    addLabel(scene, `${QL_EPISODES} episodes`, [S.x + S.w / 2, S.y - S.h / 2 - 0.9, 0.3], GREY, 0.26, 'right')
    addLabel(scene, 'Q at the start cell', [S.x - 2.6, -4.2, 0.3], GREY, 0.28, 'left')
    const qBars = countBars(scene, [S.x - 1.4, -5.1, 0], ['↑ north', '→ east', '↓ south', '← west'], 5, { row: 0.62, size: 0.28 })
    const clock = replayClock()
    const st = { key: '', shown: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = qlParams(p)
        const key = `${q.eps}|${q.start}|${q.episodes}`
        const A = qlAt(q)
        if (key !== st.key) {
          st.key = key
          st.shown = -1
          const T = qlTrain(q)
          B.tiles(() => '#2a2d34')
          B.wedges((c, a) => valueTint(Math.max(0, A.Q[c][a]) / QL_GOAL))
          B.arrows((c) => (triedRow(A.Q[c]) ? A.policy[c] : null))
          const us: number[] = []
          const ys: number[] = []
          for (let i = 0; i < q.episodes; i += 5) {
            us.push(i / QL_EPISODES)
            ys.push(-S.h / 2 + (T.curve[i] / QL_GOAL) * S.h)
          }
          curve.points(us, ys)
          curve.group.visible = us.length > 1
          const qs = Array.from(A.Q[QL_WORLD.start])
          const best = argmaxQ(qs)
          qBars.set(qs.map((v) => Math.max(0, v)), qs.map((v) => v.toFixed(2)), qs.map((_, a) => (a === best && triedRow(qs) ? POWER : GREY)), QL_GOAL)
          status.set(`Q-learning · ${q.episodes} episodes · ε ${q.eps.toFixed(1)} · ${QL_STARTS[q.start]}`, LABEL)
          sub.set(`so far: dock ${A.goals}×, small prize ${A.nears}× · greedy run below (no exploration), one step in ${STEP_S} s`, GREY)
          const end = A.run.end
          event.set(
            q.episodes === 0
              ? 'empty table: every move looks the same'
              : end === 'goal'
                ? `greedy policy reaches the dock in ${A.run.log.length} steps`
                : end === 'near'
                  ? 'greedy policy settles for the small prize: the dock was never (or barely) found'
                  : 'greedy policy goes round in circles: values have not reached the start yet',
            q.episodes === 0 ? GREY : end === 'goal' ? POWER : end === 'near' ? RING : HEAT,
          )
        }
        const { k } = clock(dt, key, () => A.run.log.length)
        B.drive(A.run.log, k)
      },
      readouts: (p) => {
        const q = qlParams(p)
        const A = qlAt(q)
        const T = qlTrain(q)
        const V = valuesOf(A.Q)
        return [
          { label: 'Greedy run', value: `${QL_END[A.run.end]}, ${A.run.log.length} steps`, tone: A.run.end === 'goal' ? 'ok' : A.run.end === 'near' ? 'warn' : 'bad' },
          { label: 'Q(start)', value: V[QL_WORLD.start].toFixed(2) },
          { label: 'Train return', value: q.episodes ? T.curve[q.episodes - 1].toFixed(1) : '–' },
        ]
      },
    }
  },
}

// --- Sim to real: a policy trained in an exact sim hugs the table edge; a skidding real robot falls. Domain randomisation trains a safer one. ---

const SR_ROWS = ['........', '........', '........', 'SPPPPPPG']
const SR_TRAIN = { exact: 'Trained in an exact sim (no skid)', random: 'Domain randomised: skid 0–30 %', measured: 'Sim set to the measured skid' }
const SR_EPISODES = 3000
const SR_EVAL = 500
const SR_WORLD = parseGrid(SR_ROWS, { step: -1, goal: 20, pit: -20 })
const srParams = (p: Params) => ({ train: pick(SR_TRAIN, p.train, 'exact'), real: n(p, 'real'), run: n(p, 'run') })
type SrQ = ReturnType<typeof srParams>
const srSimSlip = (q: SrQ) => (q.train === 'exact' ? 0 : q.train === 'random' ? 0.15 : q.real)
const srPolicy = memoBy(
  (q: SrQ) => `${q.train}|${q.train === 'measured' ? q.real : ''}`,
  (q: SrQ) => {
    const slip: number | [number, number] = q.train === 'exact' ? 0 : q.train === 'random' ? [0, 0.3] : q.real
    const R = qLearn(SR_WORLD, { episodes: SR_EPISODES, alpha: 0.1, eps: 0.2, gamma: 0.97, slip, seed: 3 })
    return { Q: R.Q, V: valuesOf(R.Q), policy: greedyPolicy(R.Q) }
  },
)
const srEval = memoBy(
  (q: SrQ) => `${q.train}|${q.real}`,
  (q: SrQ) => {
    const { policy } = srPolicy(q)
    return { sim: evalPolicy(SR_WORLD, policy, srSimSlip(q), SR_EVAL, 5), real: evalPolicy(SR_WORLD, policy, q.real, SR_EVAL, 9) }
  },
)
const srRun = memoBy(
  (q: SrQ) => `${q.train}|${q.real}|${q.run}`,
  (q: SrQ) => gwRollout(SR_WORLD, srPolicy(q).policy, q.real, 300 + q.run, 30),
)

export const reinforcementLearningSimToReal: Lesson = {
  id: 'reinforcement-learning-sim-to-real',
  title: 'Sim to real',
  tagline: 'RL needs thousands of tries, so robots learn in simulation. A policy trained in a perfect sim drives along the table edge; the real robot skids and falls off. Train over many randomised sims and it keeps its distance',
  formula: (p) => {
    const q = srParams(p)
    const E = srEval(q)
    return `Q-learning, ${SR_EPISODES} sim episodes, ε 0.2, α 0.1, γ 0.97 · −1 per step, +20 dock, −20 off the table · sim skid ${q.train === 'random' ? 'drawn 0–30 % per episode' : pct(srSimSlip(q))} → real skid ${pct(q.real)} · reach the dock: sim ${pct(E.sim.goal)}, real ${pct(E.real.goal)}`
  },
  legend: [
    { color: GW_COLORS.goal, label: 'Dock: +20', shape: 'dot' },
    { color: GW_COLORS.pit, label: 'Table edge: −20, the robot falls off', shape: 'dot' },
    { color: GW_COLORS.arrow, label: 'Policy learned in simulation', shape: 'dot' },
    { color: HIGH_V, label: 'Real run: ~ marks a skid', shape: 'dot' },
  ],
  points: [
    'Q-learning took hundreds of episodes on a 30-cell grid; a walking or grasping policy takes millions. Nobody wants a real robot to fall off the table a million times, so policies are trained in a simulator, often thousands of copies in parallel, and then copied to the robot.',
    'Here the sim is exact: every move goes where it is told. The learned policy is the shortest route, one cell from the edge. It scores perfectly in the sim. The real floor is dusty: some moves skid sideways. Raise the real skid: on that route one skid toward the edge ends the run, and success drops fast.',
    'Domain randomisation trains on many slightly different sims: each episode draws a skid chance between 0 and 30 %. The policy that is best on average over all of them keeps a row of safety margin. It is a bit slower in a perfect world, but the real robot is just one more sample from the range it trained on.',
    'Measuring the real skid and putting it in the sim (system identification) works too, but only for what you measured, and it can over-fit to a quirk: with a known skid the policy at the start pushes into the wall to slide north on purpose. Fine while the floor matches; on a freshly cleaned floor it pushes forever. Randomise what you cannot measure, measure what you can. The same gap for a classic controller: Simulation, Sim-to-real gap.',
  ],
  controls: [
    { kind: 'choice', key: 'train', options: opts(SR_TRAIN), initial: 'exact' },
    { kind: 'slider', key: 'real', label: 'Real skid chance', min: 0, max: 0.3, step: 0.05, initial: 0.2, format: (v: number) => pct(v) },
    { kind: 'slider', key: 'run', label: 'Real run', min: 1, max: 9, step: 1, initial: 1, format: (v: number) => `#${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const B = board(scene, SR_WORLD, 0.065)
    const P = { x: 10.6 }
    addLabel(scene, `same policy, ${SR_EVAL} runs each`, [P.x - 5.4, 0.8, 0.3], GREY, 0.3, 'left')
    const simTag = liveLabel(scene, [P.x - 5.4, -0.2, 0.3], { size: 0.3, align: 'left' })
    const simBars = countBars(scene, [P.x, -1.0, 0], ['reached the dock', 'fell off'], 5.4, { row: 0.7, size: 0.3 })
    const realTag = liveLabel(scene, [P.x - 5.4, -2.8, 0.3], { size: 0.3, align: 'left' })
    const realBars = countBars(scene, [P.x, -3.6, 0], ['reached the dock', 'fell off', 'stuck'], 5.4, { row: 0.7, size: 0.3 })
    const runLine = liveLabel(scene, [P.x - 5.4, -6.4, 0.3], { size: 0.32, align: 'left' })
    const clock = replayClock()
    const st = { key: '', shown: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = srParams(p)
        const key = `${q.train}|${q.real}|${q.run}`
        const run = srRun(q)
        if (key !== st.key) {
          st.key = key
          st.shown = -1
          const pol = srPolicy(q)
          const E = srEval(q)
          const free = pol.V.filter((_, c) => B.free[c])
          const top = Math.max(1e-9, ...free.map(Math.abs))
          B.tiles((c) => valueTint(pol.V[c] / top))
          B.arrows((c) => pol.policy[c])
          B.numbers((c) => (SR_WORLD.cells[c] === 'G' ? '+20' : SR_WORLD.cells[c] === 'P' ? '−20' : vText(pol.V[c])), () => LABEL)
          simTag.set(`in the sim (skid ${q.train === 'random' ? '15 %, mid-range' : pct(srSimSlip(q))})`, LABEL)
          simBars.set([E.sim.goal, E.sim.pit], [pct(E.sim.goal), pct(E.sim.pit)], [POWER, HIGH_V], 1)
          realTag.set(`on the real robot (skid ${pct(q.real)})`, LABEL)
          realBars.set([E.real.goal, E.real.pit, E.real.timeout], [pct(E.real.goal), pct(E.real.pit), pct(E.real.timeout)], [POWER, HIGH_V, HEAT], 1)
          status.set(`Sim to real · ${SR_TRAIN[q.train]}`, LABEL)
          sub.set(`Q-learning on an 8 × 4 table top · policy copied unchanged to the robot · one step in ${STEP_S} s`, GREY)
          const gap = E.sim.goal - E.real.goal
          event.set(
            E.real.timeout > 0.5
              ? 'the policy relies on a skid that the real floor does not have: it pushes into the wall forever'
              : gap > 0.15
                ? `sim-to-real gap: ${pct(E.sim.goal)} in sim, ${pct(E.real.goal)} on the robot`
                : `transfers: ${pct(E.real.goal)} on the robot`,
            E.real.timeout > 0.5 ? HEAT : gap > 0.15 ? HIGH_V : POWER,
          )
        }
        const { k } = clock(dt, key, () => run.log.length)
        B.drive(run.log, k)
        const shown = Math.floor(k)
        if (shown === st.shown) return
        st.shown = shown
        const over = shown >= run.log.length
        const skids = run.log.slice(0, shown).filter((e) => e.moved !== e.a).length
        const moves = run.log.slice(0, shown).map((e) => (e.moved === e.a ? ARROWS[e.a] : `${ARROWS[e.a]}~${ARROWS[e.moved]}`))
        runLine.set(
          `real run #${q.run}: ${over ? (run.end === 'timeout' ? 'stuck' : endText[run.end]) : `step ${shown}`} · ${skids} skid${skids === 1 ? '' : 's'}${moves.length ? ` · ${moves.slice(-4).join(' ')}` : ''}`,
          over ? endColor[run.end] : LABEL,
        )
      },
      readouts: (p) => {
        const E = srEval(srParams(p))
        return [
          { label: 'Sim: dock', value: pct(E.sim.goal), tone: toneOf(E.sim.goal > 0.95, E.sim.goal > 0.8) },
          { label: 'Real: dock', value: pct(E.real.goal), tone: toneOf(E.real.goal > 0.9, E.real.goal > 0.7) },
          { label: 'Real: fell', value: pct(E.real.pit), tone: toneOf(E.real.pit < 0.05, E.real.pit < 0.2) },
          { label: 'Real return', value: signed(E.real.meanReturn) },
        ]
      },
    }
  },
}
