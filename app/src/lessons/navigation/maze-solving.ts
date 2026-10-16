import * as THREE from 'three/webgpu'
import { DIR_TH, Dir, Hand, MAZE, Maze, cellDrive, centreGoal, descend, floodFill, genMaze, mouseRun, tremaux, wallAt, wallFollow } from '../../core/physics'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, chordPath, diffBot, floorView, liveLabel, mazeModel, memoBy, simClock } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const N = MAZE.n
const MV = { at: [-15.5, -6.4, 0] as V3, k: 7.6, tilt: -0.5, slow: 0.05, hold: 3 }
const TOP = MV.at[1] + N * MAZE.cellM * MV.k * Math.cos(MV.tilt)
const VIEW = { center: [-2.2, 2, 0] as V3, radius: 54, polar: Math.PI / 2, azimuth: 0 }
const RP = { x: 1.2, y: 3, row: 1.05 }
const C = { wall: '#d9dce3', ghost: '#5d626e', goal: '#6b4322', seen: '#1f3d47', twice: '#4d2630', path: '#1f5a3c', front: '#6b5a1c' }
const KINDS = { perfect: 'Perfect maze', loops: 'With loops', island: 'Goal on an island' }
type Kind = keyof typeof KINDS
const mazeOf = (kind: Kind, seed: number) => genMaze(N, N, seed, kind === 'perfect' ? {} : kind === 'loops' ? { loops: 6 } : { island: true, loops: 4 })
const SEED = { kind: 'slider' as const, key: 'seed', label: 'Maze seed', min: 1, max: 30, step: 1, initial: 5, format: (v: number) => `#${v}` }
const KIND = (initial: Kind) => ({ kind: 'choice' as const, key: 'maze', options: opts(KINDS), initial })
const MAZE_LEGEND = [
  { color: C.wall, label: 'Wall (5 cm high, 25 cm cells)', shape: 'dot' as const },
  { color: HEAT, label: 'Goal: the 2 × 2 centre', shape: 'dot' as const },
  { color: RING, label: 'Path driven', shape: 'dot' as const },
]

type Drive = ReturnType<typeof cellDrive>
/** Maze, trail and robot on a tilted floor, plus two header lines and a side panel of rows. */
function mazeStage(scene: THREE.Scene, rows: number, title: string) {
  const g = floorView(scene, MV.at, MV.k, MV.tilt)
  const mz = mazeModel(g, N, N)
  const trail = chordPath(g, 4 * N * N, RING, 0.007, 0.012)
  const bot = diffBot(g)
  const status = liveLabel(scene, [MV.at[0], TOP + 1.7, 0.3], { size: 0.44, align: 'left' })
  const sub = liveLabel(scene, [MV.at[0], TOP + 0.9, 0.3], { size: 0.3, color: GREY, align: 'left' })
  addLabel(scene, title, [RP.x, RP.y + 1.3, 0.3], LABEL, 0.4, 'left')
  const lines = Array.from({ length: rows }, (_, k) => liveLabel(scene, [RP.x, RP.y - k * RP.row, 0.3], { size: 0.36, align: 'left' }))
  const st = { pts: [] as { x: number; y: number }[], cells: null as number[] | null }
  return {
    mz,
    status,
    sub,
    lines,
    /** Robot at sample i of `d`; the trail runs through the cells already reached. */
    drive(cells: number[], d: Drive, i: number) {
      if (cells !== st.cells) {
        st.cells = cells
        st.pts = cells.map((c) => {
          const [x, y] = mz.centre(c)
          return { x, y }
        })
      }
      bot.set(d.poses[i], d.dL[i], d.dR[i])
      trail(st.pts, d.leg[i])
    },
    walls(m: Maze, colorOf = (c: number, dd: number) => (wallAt(m, c, dd) ? C.wall : null)) {
      mz.walls(colorOf)
    },
  }
}
const goalTiles = (goal: number[], other: (c: number) => string | null) => (c: number) => (goal.includes(c) ? C.goal : other(c))

// --- Wall follower: keep one hand on the wall; perfect mazes yes, islands no. Trémaux fixes it. ---

const RULES = { left: 'Left hand', right: 'Right hand', tremaux: 'Trémaux (chalk marks)' }
type Rule = keyof typeof RULES
const TURN_NAMES = ['straight on', 'turn right', 'turn back', 'turn left']
const HAND_ROWS: Record<Hand, [number, string][]> = {
  left: [[3, 'left open? turn left'], [0, 'ahead open? go straight'], [1, 'right open? turn right'], [2, 'dead end: turn back']],
  right: [[1, 'right open? turn right'], [0, 'ahead open? go straight'], [3, 'left open? turn left'], [2, 'dead end: turn back']],
}
const TREMAUX_ROWS = ['new cell: take an unmarked way', 'old cell via a new way: turn back', 'else the way with fewer marks', 'mark ways as used; never 3 times']
const wfParams = (p: Params) => ({ rule: pick(RULES, p.rule, 'left') as Rule, kind: pick(KINDS, p.maze, 'island') as Kind, seed: n(p, 'seed') })
type WfQ = ReturnType<typeof wfParams>
const wfKey = (q: WfQ) => `${q.rule}|${q.kind}|${q.seed}`
const wfRun = memoBy(wfKey, (q: WfQ) => {
  const m = mazeOf(q.kind, q.seed)
  const goal = centreGoal(m)
  const w = q.rule === 'tremaux' ? { ...tremaux(m, 0, 0, goal), looped: false } : wallFollow(m, 0, 0, goal, q.rule)
  const best = floodFill(m, goal)[0]
  return { m, goal, w, best, drive: cellDrive(m, w.cells, DIR_TH[0]), heads: w.cells.map((c, k) => (k ? dirOf(m, w.cells[k - 1], c) : 0)) }
})
const dirOf = (m: Maze, a: number, b: number) => (b - a === m.w ? 0 : b - a === 1 ? 1 : b - a === -m.w ? 2 : 3)

export const mazeSolvingWallFollower: Lesson = {
  id: 'maze-solving-wall-follower',
  title: 'Wall follower',
  tagline: 'Put one hand on the wall and never let go: it solves any maze whose walls all join up, and walks in circles round an island',
  formula: (p) => {
    const q = wfParams(p)
    return q.rule === 'tremaux'
      ? 'chalk each passage when used · old cell entered by a new passage → back out · prefer 0 marks, then 1 · never 2 → every passage at most twice'
      : `at every cell try, in order: ${HAND_ROWS[q.rule].map(([, t]) => t.split('?')[0].split(':')[0]).join(' → ')}`
  },
  legend: [
    ...MAZE_LEGEND,
    { color: C.seen, label: 'Cell visited once', shape: 'dot' },
    { color: C.twice, label: 'Cell visited twice or more', shape: 'dot' },
  ],
  points: [
    'A maze robot sees only the walls of the cell it is in, so the oldest trick is to keep one hand on a wall. On a grid of cells that becomes a rule per cell: left hand = try left, then straight, then right, else turn back. On a real robot the hand is a side range sensor and a PD loop (see Navigation › Obstacle avoidance › Wall following).',
    'In a perfect maze (one path between any two cells, no loops) every wall is connected to the outer wall, so tracing it visits every dead end and eventually the goal. Left and right hand take different, often very different, routes.',
    'Micromouse mazes are built to beat it: the centre goal is an island, its walls touch nothing else. A wall follower traces only the wall it started on, comes back to the same cell facing the same way, and from then on repeats the lap forever.',
    'Trémaux (1882) needs memory, not a map: mark every passage when you use it, back out of a cell you have seen before if you got there by a new passage, and never use a passage a third time. It always reaches the goal, but explores a lot; flood fill (next) gets there by reasoning about distances.',
  ],
  controls: [{ kind: 'choice', key: 'rule', options: opts(RULES), initial: 'left' }, KIND('island'), SEED],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = mazeStage(scene, 5, 'At every cell')
    const clock = simClock(MV.slow, MV.hold)
    const st = { key: '', leg: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = wfParams(p)
        const key = wfKey(q)
        const r = wfRun(q)
        const i = Math.floor(clock(dt, key, r.drive.poses.length - 1))
        const leg = r.drive.leg[i]
        if (key !== st.key) {
          st.key = key
          st.leg = -1
          s.walls(r.m)
        }
        s.drive(r.w.cells, r.drive, i)
        if (leg !== st.leg) {
          st.leg = leg
          const visits = new Uint8Array(N * N)
          for (let k = 0; k <= leg; k++) visits[r.w.cells[k]]++
          s.mz.tiles(goalTiles(r.goal, (c) => (visits[c] === 0 ? null : visits[c] === 1 ? C.seen : C.twice)))
          const turn = leg > 0 ? (r.heads[leg] - r.heads[leg - 1] + 4) % 4 : -1
          if (q.rule === 'tremaux') TREMAUX_ROWS.forEach((t, k) => s.lines[k].set(`${k + 1}. ${t}`, LABEL))
          else HAND_ROWS[q.rule].forEach(([tk, t], k) => s.lines[k].set(`${k + 1}. ${t}`, tk === turn ? HEAT : GREY))
          s.lines[4].set(turn < 0 ? 'start: bottom-left, facing north' : `cell ${leg}: ${TURN_NAMES[turn]}`, GREY)
          const end = leg === r.w.cells.length - 1
          const looped = end && r.w.looped
          s.status.set(
            `${q.rule === 'tremaux' ? 'Tremaux' : RULES[q.rule]} · ${KINDS[q.kind]} · ${leg} cells${end ? (r.w.reached ? ' · goal reached' : looped ? ' · back where it started: loops forever' : ' · gave up') : ''}`,
            end ? (r.w.reached ? POWER : HIGH_V) : LABEL,
          )
          s.sub.set(`8 × 8 cells · shortest route ${r.best} cells · ${Math.round(MV.slow * 6 * 1000)} ms per cell on screen`)
        }
      },
      readouts: (p) => {
        const r = wfRun(wfParams(p))
        const ok = r.w.reached
        return [
          { label: 'Result', value: ok ? 'goal reached' : r.w.looped ? 'loops forever' : 'stuck', tone: ok ? 'ok' : 'bad' },
          { label: ok ? 'Cells driven' : 'One lap', value: `${r.w.cells.length - 1}`, tone: ok ? (r.w.cells.length - 1 <= r.best * 1.5 ? 'ok' : 'warn') : 'bad' },
          { label: 'Shortest route', value: `${r.best} cells` },
          { label: 'Cells seen', value: `${new Set(r.w.cells).size} of ${N * N}` },
        ]
      },
    }
  },
}

// --- Flood fill: number every cell by its distance to the goal, then always step downhill. ---

const GOALS = { centre: 'Goal: centre 2 × 2', corner: 'Goal: far corner' }
type GoalAt = keyof typeof GOALS
const ffParams = (p: Params) => ({ kind: pick(KINDS, p.maze, 'loops') as Kind, seed: n(p, 'seed'), goal: pick(GOALS, p.goal, 'centre') as GoalAt })
type FfQ = ReturnType<typeof ffParams>
const ffKey = (q: FfQ) => `${q.kind}|${q.seed}|${q.goal}`
const WAVE = 8
const ffRun = memoBy(ffKey, (q: FfQ) => {
  const m = mazeOf(q.kind, q.seed)
  const goal = q.goal === 'centre' ? centreGoal(m) : [N * N - 1]
  const dist = floodFill(m, goal)
  const path = descend(m, dist, 0, 0)
  const maxD = Math.max(...dist)
  const drive = cellDrive(m, path, DIR_TH[0])
  return { m, goal, dist, path, maxD, drive, waveTicks: (maxD + 1) * WAVE, reach: dist.filter((d) => d >= 0).length }
})
const FF_ROWS = ['1. goal cells = 0, into a queue', '2. take the next cell from the queue', '3. unnumbered open neighbour: +1, queue', '4. queue empty: number = steps to goal', '5. drive: step to a lower number']

export const mazeSolvingFloodFill: Lesson = {
  id: 'maze-solving-flood-fill',
  title: 'Flood fill',
  tagline: 'Pour water in at the goal: every cell gets its distance in steps, and from anywhere the way home is always downhill',
  formula: (p) => {
    const r = ffRun(ffParams(p))
    return `d(goal) = 0 · d(cell) = 1 + min d(open neighbour) · breadth-first, ${r.reach} cells each visited once · start → goal = ${r.dist[0]} steps`
  },
  legend: (p) => [
    ...MAZE_LEGEND.map((l) => (l.color === HEAT && ffParams(p).goal === 'corner' ? { ...l, label: 'Goal: the far corner cell' } : l)),
    { color: C.front, label: 'Wavefront: cells numbered this round', shape: 'dot' },
    { color: C.path, label: 'Downhill route: one lower each step', shape: 'dot' },
  ],
  points: [
    'Flood fill (Bellman\'s idea, called the "modified flood fill" in micromouse) works backwards from the goal. The goal cells get 0; their open neighbours 1; theirs 2; and so on, like water spreading through the corridors. It is a breadth-first search, so each cell is numbered once with its exact number of steps to the goal.',
    'Once every cell has its number the robot needs no plan: from wherever it is, step to any neighbour with a lower number. That walk is a shortest route. In a maze with loops several neighbours can tie; preferring straight on avoids needless turns (and turns cost time on a real robot).',
    'The cost is tiny: each cell is touched once and each wall checked twice, 64 cells here, 256 in a full 16 × 16 micromouse maze, well under a millisecond on an ESP32. A 16 × 16 map fits in 256 bytes of wall bits plus 256 numbers.',
    'Cells the water never reaches have no number: no route exists. Here the robot knows the whole maze in advance; Micromouse (next) does the same with only the walls it has seen so far, and re-floods as it learns.',
  ],
  controls: [KIND('loops'), SEED, { kind: 'choice', key: 'goal', options: opts(GOALS), initial: 'centre' }],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = mazeStage(scene, 6, 'Flood fill, breadth first')
    const clock = simClock(MV.slow, MV.hold)
    const st = { key: '', shown: -2 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = ffParams(p)
        const key = ffKey(q)
        const r = ffRun(q)
        const t = clock(dt, key, r.waveTicks + r.drive.poses.length - 1)
        if (key !== st.key) {
          st.key = key
          st.shown = -2
          s.walls(r.m)
        }
        const flooding = t < r.waveTicks
        const wave = flooding ? Math.floor(t / WAVE) : r.maxD + 1
        const i = flooding ? 0 : Math.min(r.drive.poses.length - 1, Math.floor(t - r.waveTicks))
        s.drive(r.path, r.drive, i)
        const show = flooding ? wave : r.maxD + 1 + r.drive.leg[i]
        if (show === st.shown) return
        st.shown = show
        const onPath = new Set(flooding ? [] : r.path.slice(0, r.drive.leg[i] + 1))
        s.mz.tiles(goalTiles(r.goal, (c) => (onPath.has(c) ? C.path : flooding && r.dist[c] === wave ? C.front : null)))
        s.mz.numbers(
          (c) => (r.dist[c] >= 0 && r.dist[c] <= wave ? `${r.dist[c]}` : ''),
          (c) => (flooding && r.dist[c] === wave ? RING : onPath.has(c) ? POWER : LABEL),
        )
        const row = flooding ? (wave === 0 ? 0 : 2) : 4
        FF_ROWS.forEach((txt, k) => s.lines[k].set(txt, k === row ? HEAT : GREY))
        const front = r.dist.filter((d) => d === wave).length
        s.lines[5].set(flooding ? `round ${wave}: ${front} cell${front === 1 ? '' : 's'} at distance ${wave}` : `route: ${r.path.length - 1} steps, ${((r.path.length - 1) * MAZE.cellM).toFixed(2)} m`, GREY)
        s.status.set(flooding ? `Flooding from the goal · round ${wave} of ${r.maxD}` : `Driving downhill · ${r.dist[r.path[r.drive.leg[i]]]} steps to go`, flooding ? RING : POWER)
        s.sub.set(`${KINDS[q.kind]} · ${r.reach} of ${N * N} cells reachable · the robot knows every wall here`)
      },
      readouts: (p) => {
        const r = ffRun(ffParams(p))
        const ties = r.path.slice(0, -1).filter((c) => [0, 1, 2, 3].filter((d) => !wallAt(r.m, c, d) && r.dist[c + [N, 1, -N, -1][d]] === r.dist[c] - 1).length > 1).length
        return [
          { label: 'Start → goal', value: `${r.dist[0]} cells (${(r.dist[0] * MAZE.cellM).toFixed(2)} m)` },
          { label: 'Highest number', value: `${r.maxD}` },
          { label: 'Cells numbered', value: `${r.reach} of ${N * N}`, tone: r.reach === N * N ? 'ok' : 'warn' },
          { label: 'Cells with a tie on the route', value: `${ties}` },
        ]
      },
    }
  },
}

// --- Micromouse: unknown maze; sense, re-flood, step; explore back; then the fast run. ---

const TRIPS = { off: 'Search only', on: 'Search + explore back' }
const mmParams = (p: Params) => ({ kind: pick(KINDS, p.maze, 'island') as Kind, seed: n(p, 'seed'), trip: pick(TRIPS, p.trip, 'on') as keyof typeof TRIPS })
type MmQ = ReturnType<typeof mmParams>
const mmKey = (q: MmQ) => `${q.kind}|${q.seed}|${q.trip}`
const mmRun = memoBy(mmKey, (q: MmQ) => {
  const m = mazeOf(q.kind, q.seed)
  const goal = centreGoal(m)
  const r = mouseRun(m, goal, q.trip === 'on')
  const nExplore = r.steps.findIndex((x) => x.phase === 'fast')
  const explore = r.steps.slice(0, nExplore).map((x) => x.cell)
  const fast = r.steps.slice(nExplore).map((x) => x.cell)
  const a = cellDrive(m, explore, DIR_TH[MAZE.startDir])
  const b = cellDrive(m, fast, DIR_TH[MAZE.startDir], 3)
  return { m, goal, r, nExplore, explore, fast, a, b, total: a.poses.length + b.poses.length }
})
const MM_ROWS = ['1. search: sense, re-flood, step down', '2. explore back: flood to the start', '3. fast run: fully seen cells only']
const PHASE_ROW = { search: 0, return: 1, fast: 2 }

export const mazeSolvingMicromouse: Lesson = {
  id: 'maze-solving-micromouse',
  title: 'Micromouse',
  tagline: 'Flood fill on a map you are still drawing: assume no walls, re-flood every time you find one, then race the route you trust',
  formula: (p) => {
    const r = mmRun(mmParams(p)).r
    return `each cell: sense walls → flood fill (unknown = open) → step to the lowest neighbour · ${r.refloods} re-floods · fast run ${r.fast} cells, shortest ${r.best}`
  },
  legend: [
    { color: C.wall, label: 'Wall the mouse has seen', shape: 'dot' },
    { color: C.ghost, label: 'Wall it has not seen yet', shape: 'dot' },
    { color: HEAT, label: 'Goal: the 2 × 2 centre', shape: 'dot' },
    { color: C.seen, label: 'Visited while exploring', shape: 'dot' },
    { color: C.path, label: 'Fast run', shape: 'dot' },
  ],
  points: [
    'In a micromouse contest the robot starts in a corner of an unknown 16 × 16 maze of 18 cm cells and must reach the centre. Three IR or ToF sensors (left, front, right) tell it which walls the current cell has; the only thing it knows in advance is the outer wall.',
    'It runs flood fill on its own map, treating every unseen wall as open, the most hopeful guess. It steps to the lowest neighbour; when a new wall turns up the numbers are wrong, so it re-floods and the route bends. The numbers on the cells are the mouse\'s current belief, not the truth.',
    'The first route found is often not the shortest: the hopeful guess sends it down corridors that look short on its map. Rules give a few runs in a time limit, so mice explore on the way back (flooding towards the start, which visits new cells) and only then race.',
    'The fast run uses only passages it has actually seen, so it can never hit a surprise wall; with the extra exploring it is usually the true shortest route. Real mice also plan diagonals and speed profiles; that is Graph search and Path tracking later.',
  ],
  controls: [KIND('island'), SEED, { kind: 'choice', key: 'trip', options: opts(TRIPS), initial: 'on' }],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = mazeStage(scene, 5, 'Micromouse')
    const clock = simClock(MV.slow, MV.hold)
    const st = { key: '', step: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = mmParams(p)
        const key = mmKey(q)
        const R = mmRun(q)
        const { r, m } = R
        const i = Math.floor(clock(dt, key, R.total - 1))
        if (key !== st.key) Object.assign(st, { key, step: -1 })
        const inFast = i >= R.a.poses.length
        const j = inFast ? i - R.a.poses.length : i
        if (inFast) s.drive(R.fast, R.b, j)
        else s.drive(R.explore, R.a, j)
        const step = inFast ? R.nExplore + R.b.leg[j] : R.a.leg[j]
        if (step === st.step) return
        st.step = step
        const x = r.steps[step]
        s.walls(m, (c, d) => (!wallAt(m, c, d) ? null : x.seen[4 * c + d] ? C.wall : C.ghost))
        const visited = new Set(r.steps.slice(0, Math.min(step, R.nExplore - 1) + 1).map((y) => y.cell))
        const fastSoFar = new Set(inFast ? R.fast.slice(0, R.b.leg[j] + 1) : [])
        s.mz.tiles(goalTiles(R.goal, (c) => (fastSoFar.has(c) ? C.path : visited.has(c) ? C.seen : null)))
        s.mz.numbers(
          (c) => (x.dist[c] >= 0 ? `${x.dist[c]}` : ''),
          (c) => (c === x.cell ? RING : visited.has(c) ? LABEL : GREY),
        )
        MM_ROWS.forEach((t, k) => s.lines[k].set(t, k === PHASE_ROW[x.phase] ? HEAT : q.trip === 'off' && k === 1 ? '#4a4e57' : GREY))
        const near = ([0, 1, 2, 3] as Dir[]).filter((d) => !wallAt(m, x.cell, d) || !x.seen[4 * x.cell + d]).map((d) => `${'NESW'[d]} ${x.dist[x.cell + [N, 1, -N, -1][d]]}`)
        s.lines[3].set(x.phase === 'fast' ? `fast run: ${R.fast.length - 1} cells` : `here ${x.dist[x.cell]} · open: ${near.join(' · ')}`, GREY)
        s.lines[4].set(inFast && q.trip === 'off' ? 'carried back to the start for the fast run' : `cells seen ${visited.size} of ${N * N}`, GREY)
        const label = x.phase === 'search' ? `Search · ${step} cells` : x.phase === 'return' ? `Exploring back · ${step - r.search} cells` : `Fast run · ${R.b.leg[j]} of ${r.fast} cells`
        s.status.set(`${label}`, x.phase === 'fast' ? POWER : x.phase === 'return' ? RING : LABEL)
        s.sub.set(`${KINDS[q.kind]} · the numbers are the mouse's own map, unseen walls assumed open`)
      },
      readouts: (p) => {
        const r = mmRun(mmParams(p)).r
        return [
          { label: 'First search', value: `${r.search} cells`, tone: r.search === r.best ? 'ok' : 'warn' },
          { label: 'Explore back', value: r.back ? `${r.back} cells` : 'skipped' },
          { label: 'Fast run / shortest', value: `${r.fast} / ${r.best} cells`, tone: r.fast === r.best ? 'ok' : 'warn' },
          { label: 'Cells visited', value: `${r.visited} of ${N * N}` },
        ]
      },
    }
  },
}
