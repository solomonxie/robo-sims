// Toy vision-language grounding and task planning: hand-made 7-number embeddings, cosine scores, template plans. No learned model.
import { DEG, clamp, hash01 } from '../common'
import { servoArmIk } from '../kinematics/ik'
import { P3 } from '../room'

export const VLM_COLORS = ['red', 'yellow', 'green', 'blue'] as const
export const VLM_KINDS = ['cup', 'block', 'ball'] as const
export type VlmColor = (typeof VLM_COLORS)[number]
export type VlmKind = (typeof VLM_KINDS)[number]
export const VLM_CONCEPTS = [...VLM_COLORS, ...VLM_KINDS]
const HUE: Record<VlmColor, number> = { red: 0, yellow: 55, green: 125, blue: 220 }
const KIND_H: Record<VlmKind, number> = { cup: 0.045, block: 0.032, ball: 0.036 }

export interface DeskObj { id: number; color: VlmColor; kind: VlmKind; x: number; y: number; r: number; h: number }
const obj = (id: number, color: VlmColor, kind: VlmKind, x: number, y: number): DeskObj => ({ id, color, kind, x, y, r: kind === 'block' ? 0.016 : 0.018, h: KIND_H[kind] })
/** Desk in the arm's base frame (x forward, y left, metres). */
export const VLM_OBJS: DeskObj[] = [
  obj(0, 'red', 'cup', 0.17, 0.1),
  obj(1, 'red', 'cup', 0.14, -0.14),
  obj(2, 'yellow', 'cup', 0.11, 0.17),
  obj(3, 'blue', 'block', 0.18, -0.02),
  obj(4, 'green', 'block', 0.21, 0.035),
  obj(5, 'yellow', 'ball', 0.1, 0.04),
  obj(6, 'blue', 'ball', 0.3, -0.09),
]
export const VLM_PLACES = { tray: { x: 0.03, y: 0.205, half: 0.035 }, bin: { x: 0.03, y: -0.205, half: 0.035 } }
export type VlmPlace = keyof typeof VLM_PLACES
export const objName = (o: DeskObj) => `${o.color} ${o.kind}`

const angDiff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180
const unit = (v: number[]) => {
  const m = Math.hypot(...v)
  return m > 1e-12 ? v.map((x) => x / m) : v.map(() => 0)
}
export const cosSim = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x * b[i], 0)
const LAMP_HUE = 40

export interface Sighting { id: number; box: [number, number, number, number]; cx: number; cy: number; hue: number; emb: number[] }
/** Toy image encoder: each object's box, the hue the camera sees under a warm lamp (0…1), and a unit 7-vector of colour + class scores. */
export function seeDesk(objs: readonly DeskObj[], lamp: number, seed = 1): Sighting[] {
  return objs.map((o) => {
    const n = (k: number) => hash01(seed * 131 + o.id * 17 + k) - 0.5
    const hue = HUE[o.color] + lamp * angDiff(LAMP_HUE, HUE[o.color]) * (Math.abs(angDiff(LAMP_HUE, HUE[o.color])) < 90 ? 1 : 0.15) + 6 * n(1)
    const sat = Math.abs(angDiff(LAMP_HUE, HUE[o.color])) < 90 ? 1 : 1 - 0.5 * lamp
    const colour = VLM_COLORS.map((c) => sat * Math.exp(-((angDiff(hue, HUE[c]) / 30) ** 2)))
    const kind = VLM_KINDS.map((k, i) => clamp((k === o.kind ? 0.9 : 0.08) + 0.06 * n(2 + i), 0, 1))
    const [cx, cy] = [o.x + 0.004 * n(6), o.y + 0.004 * n(7)]
    return { id: o.id, box: [cx - o.r, cy - o.r, cx + o.r, cy + o.r], cx, cy, hue: (hue + 360) % 360, emb: unit([...colour, ...kind]) }
  })
}

const WORDS: Record<string, number> = { red: 0, yellow: 1, green: 2, blue: 3, cup: 4, mug: 4, cups: 4, block: 5, cube: 5, blocks: 5, ball: 6, balls: 6 }
const STOP = new Set(['the', 'a', 'an', 'one', 'of', 'to', 'both', 'all'])
export interface TextEmb { words: string[]; known: string[]; unknown: string[]; vec: number[] }
/** Toy text encoder: bag of known words → unit 7-vector; unknown words are dropped. */
export function embedText(phrase: string): TextEmb {
  const words = phrase.toLowerCase().split(/\s+/).filter((w) => w && !STOP.has(w))
  const v = VLM_CONCEPTS.map(() => 0)
  const known: string[] = []
  const unknown: string[] = []
  for (const w of words) {
    if (w in WORDS) {
      v[WORDS[w]] = 1
      known.push(w)
    } else unknown.push(w)
  }
  return { words, known, unknown, vec: unit(v) }
}

export type VlmRel = 'left' | 'right'
export interface RefPhrase { target: TextEmb; rel: VlmRel | null; anchor: TextEmb | null }
export function parseRef(text: string): RefPhrase {
  const m = text.toLowerCase().match(/^(.*?)\s+(left|right)\s+of\s+(.*)$/)
  return m ? { target: embedText(m[1]), rel: m[2] as VlmRel, anchor: embedText(m[3]) } : { target: embedText(text), rel: null, anchor: null }
}

export type Speaker = 'robot' | 'facing'
export type GroundVerdict = 'go' | 'ask' | 'none'
export const GROUND = { tau: 0.05, minSim: 0.58, minProb: 0.7, side: 0.012 }
export interface Grounding { ref: RefPhrase; sim: number[]; anchorSim: number[] | null; rel: number[] | null; score: number[]; prob: number[]; order: number[]; best: number; margin: number; verdict: GroundVerdict }

/** Scores every sighting against a phrase: cosine to the target words × (relation to the best-matching anchor); softmax → probabilities. */
export function groundRef(text: string, sights: readonly Sighting[], speaker: Speaker = 'robot'): Grounding {
  const ref = parseRef(text)
  const sim = sights.map((s) => cosSim(ref.target.vec, s.emb))
  const anchorSim = ref.anchor ? sights.map((s) => cosSim(ref.anchor!.vec, s.emb)) : null
  const sign = (ref.rel === 'left' ? 1 : -1) * (speaker === 'robot' ? 1 : -1)
  const rel = anchorSim
    ? sights.map((a, i) => Math.max(0, ...sights.map((b, j) => (j === i ? 0 : anchorSim[j] / (1 + Math.exp((-sign * (a.cy - b.cy)) / GROUND.side))))) / Math.max(1e-9, ...anchorSim))
    : null
  const score = sim.map((s, i) => s * (rel ? rel[i] : 1))
  const top = Math.max(...score)
  const ex = score.map((s) => Math.exp((s - top) / GROUND.tau))
  const tot = ex.reduce((a, b) => a + b, 0)
  const prob = ex.map((e) => e / tot)
  const order = prob.map((_, i) => i).sort((a, b) => prob[b] - prob[a])
  const best = order[0]
  const verdict: GroundVerdict = score[best] < GROUND.minSim ? 'none' : prob[best] < GROUND.minProb ? 'ask' : 'go'
  return { ref, sim, anchorSim, rel, score, prob, order, best, margin: prob[best] - prob[order[1]], verdict }
}

// --- Task planning: template parse → step list → checks on a symbolic desk → execution with verification and replanning. ---

export type StepOp = 'find' | 'pick' | 'place'
export interface PlanStep { op: StepOp; obj: number; dest: VlmPlace | number; text: string }
export interface PlanIssue { step: number; why: string }
export interface Plan { steps: PlanStep[]; issues: PlanIssue[]; groundings: Grounding[]; goal: { obj: number; dest: VlmPlace | number }[] }

export const ARM_HOME: P3 = [0.12, 0, 0.11]
const TOP_DOWN = -90 * DEG
/** Hand straight down onto `p` within the servo limits, or null. */
export function topDownQ(p: P3) {
  const s = servoArmIk(p, TOP_DOWN)
  return s.reachable ? (s.solutions.find((x) => x.inLimits)?.q ?? null) : null
}
const graspAt = (o: { x: number; y: number }, z: number): P3 => [o.x, o.y, z]

const destText = (d: VlmPlace | number, objs: readonly DeskObj[]) => (typeof d === 'number' ? `on the ${objName(objs[d])}` : `in the ${d}`)
const destName = (d: string): VlmPlace | null => (d.includes('tray') ? 'tray' : d.includes('bin') ? 'bin' : null)

/** Template planner: "put X in the tray/bin", "put both Xs in …", "stack X on Y" → find/pick/place steps, then precondition checks. */
export function planTask(command: string, objs: readonly DeskObj[], sights: readonly Sighting[]): Plan {
  const c = command.toLowerCase().replace(/\.$/, '')
  const issues: PlanIssue[] = []
  const groundings: Grounding[] = []
  const goal: Plan['goal'] = []
  const steps: PlanStep[] = []
  const stack = c.match(/^stack (.+) on (.+)$/)
  const put = c.match(/^put (.+) (?:in|into|on) (.+)$/)
  const what = stack?.[1] ?? put?.[1] ?? ''
  const where = stack?.[2] ?? put?.[2] ?? ''
  let dest: VlmPlace | number | null = destName(where)
  if (dest === null && where) {
    const g = groundRef(where, sights)
    groundings.push(g)
    dest = g.verdict === 'go' ? sights[g.best].id : null
    if (dest === null) issues.push({ step: 0, why: g.verdict === 'ask' ? `"${where}" could be several things: ask` : `no "${where}" on the desk` })
  }
  const plural = /\b(both|all)\b/.test(what)
  let targets: number[] = []
  if (plural) {
    const k = embedText(what).vec
    targets = sights.filter((s) => cosSim(k, s.emb) >= GROUND.minSim).map((s) => s.id)
    if (!targets.length) issues.push({ step: 0, why: `nothing matches "${what}"` })
  } else if (what) {
    const g = groundRef(what, sights)
    groundings.unshift(g)
    if (g.verdict === 'go') targets = [sights[g.best].id]
    else issues.push({ step: 0, why: g.verdict === 'ask' ? `"${what}" fits ${g.order.filter((i) => g.prob[i] > 0.15).length} objects: ask which` : `no "${what}" on the desk` })
  } else issues.push({ step: 0, why: 'no template matches the sentence' })
  if (dest === null && !issues.length) issues.push({ step: 0, why: `unknown destination "${where}"` })
  const d = dest ?? 'tray'
  for (const id of targets) {
    if (id === d) continue
    const o = objs[id]
    steps.push({ op: 'find', obj: id, dest: d, text: `find the ${objName(o)}` }, { op: 'pick', obj: id, dest: d, text: `pick the ${objName(o)}` }, { op: 'place', obj: id, dest: d, text: `place it ${destText(d, objs)}` })
    goal.push({ obj: id, dest: d })
  }
  if (!issues.length) issues.push(...checkPlan(steps, objs))
  return { steps, issues, groundings, goal }
}

/** Resting spot for an object placed at `dest`, given how many are already there. */
export function placeSpot(dest: VlmPlace | number, objs: readonly DeskObj[], slot: number, pos: readonly P3[]): P3 {
  if (typeof dest === 'number') {
    const b = pos[dest]
    return [b[0], b[1], b[2] + objs[dest].h]
  }
  const p = VLM_PLACES[dest]
  return [p.x + [0, 0.018, -0.018][slot % 3], p.y, 0.006]
}

/** Preconditions on the symbolic desk: reach (top-down IK within servo limits), hand empty/full, stack base is a free block. */
export function checkPlan(steps: readonly PlanStep[], objs: readonly DeskObj[]): PlanIssue[] {
  const out: PlanIssue[] = []
  let held: number | null = null
  const used = new Set<number>()
  steps.forEach((s, i) => {
    const o = objs[s.obj]
    if (s.op === 'pick') {
      if (held !== null) out.push({ step: i, why: 'hand already full' })
      else if (!topDownQ(graspAt(o, o.h * 0.6))) out.push({ step: i, why: `the ${objName(o)} is ${Math.round(Math.hypot(o.x, o.y) * 100)} cm out: beyond the arm's reach` })
      held = s.obj
    } else if (s.op === 'place') {
      if (held !== s.obj) out.push({ step: i, why: 'nothing in the hand' })
      const t = typeof s.dest === 'number' ? objs[s.dest] : VLM_PLACES[s.dest]
      if (typeof s.dest === 'number' && (objs[s.dest].kind !== 'block' || used.has(s.dest))) out.push({ step: i, why: `cannot stack on the ${objName(objs[s.dest])}` })
      if (!topDownQ([t.x, t.y, 0.06])) out.push({ step: i, why: 'destination out of reach' })
      if (typeof s.dest === 'number') used.add(s.dest)
      held = null
    }
  })
  return out
}

export type PlanSurprise = 'none' | 'slip' | 'moved'
export interface RunFrame { t: number; hand: P3; grip: number; q: number[]; pos: P3[]; step: number }
export interface StepLog { step: number; text: string; status: 'done' | 'failed' | 'redo'; note: string; t: number }
export interface PlanRun { frames: RunFrame[]; log: StepLog[]; ok: boolean; replans: number; duration: number }
export const RUN = { dt: 0.05, speed: 0.12, grip: 0.5, lift: 0.04 }

/** Executes a checked plan from what the camera last saw. After each pick the jaws are checked; a surprise (object moved after it was seen, or slipping out on the lift) fails that check. With `replan` the robot looks again and redoes find + pick, else it carries on blind. */
export function runPlan(plan: Plan, objs: readonly DeskObj[], surprise: PlanSurprise, replan: boolean): PlanRun {
  const pos: P3[] = objs.map((o) => [o.x, o.y, 0])
  const seen: P3[] = pos.map((p) => [...p] as P3)
  const frames: RunFrame[] = []
  const log: StepLog[] = []
  let hand: P3 = [...ARM_HOME]
  let grip = 0
  let held: number | null = null
  let q = topDownQ(hand) ?? [0, 0, 0, 0]
  let t = 0
  let stepNo = 0
  let replans = 0
  let pending = surprise
  const push = () => {
    frames.push({ t, hand: [...hand], grip, q: [...q], pos: pos.map((p) => [...p] as P3), step: stepNo })
    t += RUN.dt
  }
  const moveTo = (p: P3) => {
    const from = hand
    const n = Math.max(1, Math.ceil(Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2]) / RUN.speed / RUN.dt))
    for (let k = 1; k <= n; k++) {
      const s = (k / n) * (k / n) * (3 - (2 * k) / n)
      hand = [from[0] + (p[0] - from[0]) * s, from[1] + (p[1] - from[1]) * s, from[2] + (p[2] - from[2]) * s]
      q = topDownQ(hand) ?? q
      if (held !== null) pos[held] = [hand[0], hand[1], hand[2] - objs[held].h * 0.6]
      push()
    }
  }
  const hold = (secs: number, g = grip) => {
    const g0 = grip
    const n = Math.round(secs / RUN.dt)
    for (let k = 1; k <= n; k++) {
      grip = g0 + ((g - g0) * k) / n
      push()
    }
  }
  const lift = (o: DeskObj, at: P3) => moveTo([at[0], at[1], at[2] + o.h + RUN.lift])
  const cm = (p: P3) => `${Math.round(p[0] * 100)}, ${Math.round(p[1] * 100)} cm`
  push()
  const queue = [...plan.steps]
  while (queue.length) {
    const s = queue.shift()!
    stepNo = plan.steps.indexOf(s)
    const o = objs[s.obj]
    if (s.op === 'find') {
      hold(0.6)
      seen[s.obj] = [...pos[s.obj]]
      let note = `seen at ${cm(seen[s.obj])}`
      if (pending === 'moved') {
        pending = 'none'
        pos[s.obj] = [pos[s.obj][0] - 0.03, pos[s.obj][1] - Math.sign(pos[s.obj][1] || 1) * 0.05, 0]
        note += ' · then a person moves it'
      }
      log.push({ step: stepNo, text: s.text, status: 'done', note, t })
      continue
    }
    if (s.op === 'pick') {
      const at = seen[s.obj]
      lift(o, at)
      moveTo([at[0], at[1], at[2] + o.h * 0.6])
      hold(RUN.grip, 1)
      const there = Math.hypot(pos[s.obj][0] - at[0], pos[s.obj][1] - at[1]) < o.r
      if (there) held = s.obj
      let why = there ? '' : 'jaws closed on air'
      if (there && pending === 'slip') {
        pending = 'none'
        moveTo([hand[0], hand[1], hand[2] + 0.03])
        held = null
        pos[s.obj] = [at[0] - 0.025, at[1] - 0.015, 0]
        why = 'slipped out on the lift'
      }
      lift(o, at)
      if (!why) log.push({ step: stepNo, text: s.text, status: 'done', note: 'jaws stop at its width: holding', t })
      else if (replan) {
        replans++
        log.push({ step: stepNo, text: s.text, status: 'redo', note: `${why}: look again, grasp again`, t })
        hold(RUN.grip, 0)
        queue.unshift(plan.steps[stepNo - 1], s)
      } else log.push({ step: stepNo, text: s.text, status: 'failed', note: `${why}; carries on blind`, t })
      continue
    }
    const slot = plan.goal.slice(0, plan.goal.findIndex((g) => g.obj === s.obj)).filter((g) => g.dest === s.dest).length
    const spot = placeSpot(s.dest, objs, slot, pos)
    const had = held === s.obj
    lift(o, spot)
    moveTo([spot[0], spot[1], spot[2] + o.h * 0.6])
    if (had) {
      held = null
      pos[s.obj] = spot
    }
    hold(RUN.grip, 0)
    lift(o, spot)
    log.push({ step: stepNo, text: s.text, status: had ? 'done' : 'failed', note: had ? 'released' : 'opened an empty hand', t })
  }
  moveTo(ARM_HOME)
  hold(0.4)
  const ok = plan.goal.every((g) => inPlace(pos[g.obj], g.dest, pos))
  return { frames, log, ok, replans, duration: t }
}

/** Goal check from object positions. */
export function inPlace(p: P3, dest: VlmPlace | number, pos: readonly P3[]) {
  if (typeof dest === 'number') return Math.hypot(p[0] - pos[dest][0], p[1] - pos[dest][1]) < 0.01 && p[2] > 0.01
  const d = VLM_PLACES[dest]
  return Math.abs(p[0] - d.x) < d.half && Math.abs(p[1] - d.y) < d.half
}
