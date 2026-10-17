import * as THREE from 'three/webgpu'
import {
  ARM_HOME, DeskObj, GROUND, Grounding, P3, Plan, PlanRun, RUN, SERVO_ARM, Sighting, Speaker, PlanSurprise, VLM_CONCEPTS, VLM_OBJS, VLM_PLACES, GroundVerdict, groundRef, objName, planTask, runPlan, seeDesk, topDownQ,
} from '../../core/physics'
import { pct } from '../../core/units'
import { V3, add, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { ELECTRON, GREY, HEAT, HIGH_V, LABEL, POWER, RING, SERVO_ARM_LOOK, addLabel, countBars, dotPen, flatBox, glideAngle, glowMat, liveLabel, memoBy, serialArm, setGlow, statusHeader, zUp } from '../fx'
import { Lesson, Params, Readout, Stage, n, opts, pick } from '../types'

const VIEW = { center: [-0.4, -1.2, 0] as V3, radius: 60, polar: Math.PI / 2, azimuth: 0 }
const DESK = { at: [0, -3.0, 0] as V3, k: 33, tilt: 0.62 }
const TRUE_C: Record<DeskObj['color'], string> = { red: '#d8352f', yellow: '#f0c419', green: '#3fae4f', blue: '#2f6fd8' }
const VERDICT_C: Record<GroundVerdict, string> = { go: POWER, ask: HEAT, none: HIGH_V }
const tone = (v: GroundVerdict): Readout['tone'] => (v === 'go' ? 'ok' : v === 'ask' ? 'warn' : 'bad')
const cm = (o: { x: number; y: number }) => `${Math.round(o.x * 100)}, ${Math.round(o.y * 100)} cm`

/** Table seen from behind the arm (robot left = screen left), tray, bin, the 4-DOF servo arm, and one mesh per object. */
function deskStage(scene: THREE.Scene) {
  const g = zUp(scene, DESK.at, DESK.k, DESK.tilt, Math.PI / 2)
  const top = mat('#2b2e35', { rough: 0.9 })
  flatBox(g, [0.4, 0.56, 0.01], top, [0.15, 0, -0.006])
  for (const [name, p] of Object.entries(VLM_PLACES)) {
    const wall = name === 'bin' ? 0.03 : 0.008
    const m = mat(name === 'bin' ? '#4a4f5a' : '#6b5a44', { rough: 0.8 })
    flatBox(g, [2 * p.half, 2 * p.half, 0.004], m, [p.x, p.y, 0.002])
    for (const [w, h, dx, dy] of [[2 * p.half, 0.004, 0, p.half], [2 * p.half, 0.004, 0, -p.half], [0.004, 2 * p.half, p.half, 0], [0.004, 2 * p.half, -p.half, 0]]) flatBox(g, [w, h, wall], m, [p.x + dx, p.y + dy, wall / 2])
  }
  cylinder(g, 0.035, 0.01, mat('#24262c', { rough: 0.6 }), [0, 0, 0.004], 'z', 28)
  const arm = serialArm(g, SERVO_ARM, { ...SERVO_ARM_LOOK, axes: false })
  const objs = VLM_OBJS.map((o) => {
    const grp = add(g, new THREE.Group(), [o.x, o.y, 0])
    const m = mat(TRUE_C[o.color], { rough: 0.45 }, true)
    const geo =
      o.kind === 'cup' ? new THREE.CylinderGeometry(o.r, o.r * 0.8, o.h, 24).rotateX(Math.PI / 2) : o.kind === 'block' ? new THREE.BoxGeometry(2 * o.r, 2 * o.r, o.h) : new THREE.SphereGeometry(o.h / 2, 20, 14)
    add(grp, mesh(geo, m), [0, 0, o.h / 2])
    if (o.kind === 'cup') add(grp, mesh(new THREE.CircleGeometry(o.r * 0.82, 24), mat('#15161a')), [0, 0, o.h + 0.0005])
    return { grp, m }
  })
  const pen = dotPen(g, 1600, 0.0016)
  const world = (p: P3): V3 => {
    const v = g.localToWorld(new THREE.Vector3(...p))
    return [v.x, v.y, v.z]
  }
  g.updateWorldMatrix(true, false)
  return { g, arm, objs, pen, world }
}

/** Rectangle + optional ring on the table around an object's box. */
function outline(pen: ReturnType<typeof dotPen>, b: Sighting['box'], c: string, s = 1) {
  const [x0, y0, x1, y1] = [b[0] - 0.004, b[1] - 0.004, b[2] + 0.004, b[3] + 0.004]
  const z = 0.002
  const pts: V3[] = [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [x0, y0, z]]
  for (let i = 0; i < 4; i++) pen.line(pts[i], pts[i + 1], 0.004, c, s)
}

// --- Grounding objects: phrase → toy text vector; each box → toy image vector; cosine × relation → softmax → go / ask / none. ---

const REFS = {
  red: 'the red cup',
  redLeft: 'the red cup left of the block',
  ball: 'the yellow ball',
  purple: 'the purple mug',
  green: 'the green cup',
}
const SPEAKERS: Record<Speaker, string> = { robot: "Left = robot's left", facing: 'Left = left of a person facing it' }
const gParams = (p: Params) => ({ ref: pick(REFS, p.ref, 'redLeft') as keyof typeof REFS, speaker: pick(SPEAKERS, p.speaker, 'robot') as Speaker, lamp: n(p, 'lamp') })
type GQ = ReturnType<typeof gParams>
const gSolve = memoBy(
  (q: GQ) => `${q.ref}|${q.speaker}|${q.lamp}`,
  (q: GQ) => {
    const sights = seeDesk(VLM_OBJS, q.lamp)
    return { sights, g: groundRef(REFS[q.ref], sights, q.speaker) }
  },
)
const hueColor = (s: Sighting, lamp: number) => `#${new THREE.Color().setHSL(s.hue / 360, 0.75 - (VLM_OBJS[s.id].color === 'blue' || VLM_OBJS[s.id].color === 'green' ? 0.35 * lamp : 0), 0.5).getHexString()}`
const MX = { x: -12.6, y: -6.4, row: 0.56, cell: 1.15, c0: -5.2 }
const [CELL_OFF, CELL_C] = [new THREE.Color('#1d2026'), new THREE.Color()]
const verdictText = (G: Grounding, sights: readonly Sighting[]) => {
  const b = VLM_OBJS[sights[G.best].id]
  if (G.verdict === 'go') return `→ box ${G.best + 1} (the ${objName(b)} at ${cm(b)}), P = ${pct(G.prob[G.best])}: reach for it`
  if (G.verdict === 'ask') return `→ ${G.order.filter((i) => G.prob[i] > 0.1).map((i) => `box ${i + 1}`).join(' or ')}? best P only ${pct(G.prob[G.best])}: ask which one`
  return `→ best match ${G.score[G.best].toFixed(2)} < ${GROUND.minSim}: "I don't see that"`
}

export const visionLanguageModelsGroundingObjects: Lesson = {
  id: 'vision-language-models-grounding-objects',
  title: 'Grounding objects',
  tagline: 'Turn "the red cup left of the block" into one box on the table: put the words and every detected box into the same space of numbers, score how well they line up, and ask when two boxes score the same',
  formula: `text t = unit(Σ word vectors) · box b = unit([4 colour scores, 3 class scores]) · match = cos(t, b) = t·b · relation: × max_j cos(anchor, b_j)·σ((y_b − y_j)/${GROUND.side * 100} cm) · P = softmax(match / ${GROUND.tau}) · go if P > ${GROUND.minProb}, none if match < ${GROUND.minSim}`,
  legend: [
    { color: ELECTRON, label: 'Text vector from the words', shape: 'dot' },
    { color: POWER, label: 'Chosen box (confident)', shape: 'dot' },
    { color: HEAT, label: 'Tied boxes: ask', shape: 'dot' },
    { color: HIGH_V, label: 'No match, or a word it does not know', shape: 'dot' },
  ],
  points: [
    'A vision-language model (CLIP, OWL-ViT, Grounding DINO) maps a sentence and each image region to vectors in one shared space, trained on millions of captioned images so that matching pairs point the same way. Grounding = pick the region whose vector best matches the words. This lesson is a hand-made toy, not a trained model: 7 numbers per vector (4 colours, 3 kinds), written by hand, so every score can be read off the grid.',
    'The boxes come from a detector like the one in Perception, Object detection; each box gets a colour score from the hue the camera sees and the class scores. The words become a vector by adding up the ones it knows. The match is the cosine: 1 when the two vectors point the same way. Softmax turns matches into probabilities, sharper for a small temperature.',
    '"The red cup" fits two boxes equally: P ≈ 50 / 50. A robot that just takes the top score picks one by noise; the safe answer is to ask. A relation fixes it: "left of the block" multiplies each cup by how well some block sits to its right. But whose left? Switch the speaker to a person facing the robot and the same sentence means the other cup.',
    'Failure modes the toy shares with real models: a word outside its vocabulary ("purple") is silently dropped, so "the purple mug" becomes "the mug"; something that is not there ("the green cup") still gets a best score, so it needs a floor; and a warm lamp shifts every hue toward orange, the colour scores stop separating red from yellow, and confidence collapses. Next lesson: turn the chosen box into arm moves.',
  ],
  controls: [
    { kind: 'choice', key: 'ref', options: opts(REFS), initial: 'redLeft' },
    { kind: 'choice', key: 'speaker', options: opts(SPEAKERS), initial: 'robot' },
    { kind: 'slider', key: 'lamp', label: 'Warm lamp (colour cast)', min: 0, max: 1, step: 0.1, initial: 0, format: (v: number) => pct(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const D = deskStage(scene)
    const bulb = glowMat('#ffb060', 0)
    add(D.g, mesh(new THREE.SphereGeometry(0.014, 16, 12), bulb), [0.12, 0.25, 0.3])
    const tags = VLM_OBJS.map((o) => liveLabel(scene, D.world([o.x, o.y, o.h + 0.03]), { size: 0.28 }))

    const rows = 2 + VLM_OBJS.length
    const yOf = (r: number) => MX.y - r * MX.row
    VLM_CONCEPTS.forEach((c, j) => addLabel(scene, c, [MX.c0 + j * MX.cell, MX.y + 0.6, 0.2], GREY, 0.26))
    addLabel(scene, 'match', [MX.c0 + 7 * MX.cell + 0.5, MX.y + 0.6, 0.2], GREY, 0.26)
    addLabel(scene, 'probability', [7.6, MX.y + 0.6, 0.2], GREY, 0.26)
    const names = Array.from({ length: rows }, (_, r) => liveLabel(scene, [MX.x + 0.6, yOf(r), 0.2], { size: 0.3, align: 'left' }))
    const swatches = VLM_OBJS.map((_, i) => {
      const m = glowMat('#888888', 0.6)
      flatBox(scene, [0.36, 0.36, 0.06], m, [MX.x + 0.15, yOf(2 + i), 0])
      return m
    })
    const cells = Array.from({ length: rows }, (_, r) =>
      VLM_CONCEPTS.map((_c, j) => {
        const m = glowMat('#ffffff', 0.2)
        flatBox(scene, [MX.cell * 0.86, MX.row * 0.78, 0.06], m, [MX.c0 + j * MX.cell, yOf(r), 0])
        return m
      }),
    )
    const match = Array.from({ length: rows }, (_, r) => liveLabel(scene, [MX.c0 + 7 * MX.cell + 0.5, yOf(r), 0.2], { size: 0.28 }))
    const bars = countBars(scene, [4.6, yOf(2), 0], VLM_OBJS.map(() => ''), 6, { row: MX.row, size: 0.28 })
    const words = liveLabel(scene, [MX.x, MX.y + 2.0, 0.2], { size: 0.3, align: 'left' })
    const decide = liveLabel(scene, [MX.x, MX.y + 1.3, 0.2], { size: 0.34, align: 'left' })
    const st = { key: '', q: [0, 0, 0, 0], goal: [0, 0, 0, 0], t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = gParams(p)
        const { sights, g: G } = gSolve(q)
        const key = `${q.ref}|${q.speaker}|${q.lamp}`
        st.t += dt
        if (key !== st.key) {
          st.key = key
          setGlow(bulb, q.lamp ? '#ffb060' : '#3a3d45', 2.5 * q.lamp)
          const warm = new THREE.Color('#ff9a40')
          D.objs.forEach((o, i) => o.m.color.set(TRUE_C[VLM_OBJS[i].color]).lerp(warm, 0.45 * q.lamp))
          const rowVec = (r: number) => (r === 0 ? G.ref.target.vec : r === 1 ? (G.ref.anchor?.vec ?? null) : sights[r - 2].emb)
          for (let r = 0; r < rows; r++) {
            const v = rowVec(r)
            const c = r < 2 ? ELECTRON : r - 2 === G.best ? VERDICT_C[G.verdict] : G.prob[r - 2] > 0.1 ? HEAT : LABEL
            cells[r].forEach((m, j) => setGlow(m, `#${CELL_C.lerpColors(CELL_OFF, new THREE.Color(c), v ? v[j] : 0).getHexString()}`, 0.6))
            if (r >= 2) {
              const i = r - 2
              names[r].set(`box ${i + 1}`, c)
              match[r].set(G.score[i].toFixed(2), c)
              setGlow(swatches[i], hueColor(sights[i], q.lamp), 0.7)
            }
          }
          names[0].set(`"${G.ref.target.known.join(' ') || '?'}"`, ELECTRON)
          names[1].set(G.ref.anchor ? `${G.ref.rel} of "${G.ref.anchor.known.join(' ')}"` : '(no relation)', G.ref.anchor ? ELECTRON : GREY)
          match[0].set('', GREY)
          match[1].set('', GREY)
          bars.set(G.prob, G.prob.map((v) => pct(v)), G.prob.map((v, i) => (i === G.best ? VERDICT_C[G.verdict] : v > 0.1 ? HEAT : GREY)), 1)
          const unk = [...G.ref.target.unknown, ...(G.ref.anchor?.unknown ?? [])]
          words.set(`known: ${[...G.ref.target.known, ...(G.ref.anchor?.known ?? [])].join(', ')}${G.ref.rel ? ` · relation: ${G.ref.rel} of (${SPEAKERS[q.speaker].toLowerCase()})` : ''}${unk.length ? ` · dropped: ${unk.join(', ')}` : ''}`, unk.length ? HIGH_V : LABEL)
          decide.set(verdictText(G, sights), VERDICT_C[G.verdict])
          status.set(`Grounding "${REFS[q.ref]}"`, LABEL)
          sub.set(`toy encoders: 7 hand-made numbers per vector, no trained model · ${VLM_OBJS.length} detected boxes · lamp ${pct(q.lamp)}`, GREY)
          event.set(G.verdict === 'go' ? `one clear winner: box ${G.best + 1}` : G.verdict === 'ask' ? 'two or more boxes fit about equally: ask before moving' : 'nothing fits well enough: say so', VERDICT_C[G.verdict])
          tags.forEach((t, i) => t.set(`${i + 1}`, i === G.best ? VERDICT_C[G.verdict] : G.prob[i] > 0.1 ? HEAT : GREY))
          const b = VLM_OBJS[sights[G.best].id]
          st.goal = (G.verdict === 'go' ? topDownQ([b.x, b.y, b.h + 0.04]) : null) ?? topDownQ(ARM_HOME)!
        }
        st.q = st.q.map((v, i) => glideAngle(dt, v, st.goal[i], 3))
        D.arm.set(st.q)
        D.arm.jaw(1)
        const pulse = 1 + 0.25 * Math.sin(st.t * 5)
        D.pen.begin()
        sights.forEach((s, i) => {
          const c = i === G.best ? VERDICT_C[G.verdict] : G.prob[i] > 0.1 ? HEAT : GREY
          outline(D.pen, s.box, c, i === G.best || G.prob[i] > 0.1 ? pulse : 0.7)
        })
        D.pen.end()
      },
      readouts: (p) => {
        const { sights, g: G } = gSolve(gParams(p))
        return [
          { label: 'Top box', value: `${G.best + 1}: ${objName(VLM_OBJS[sights[G.best].id])}` },
          { label: 'Its probability', value: pct(G.prob[G.best]), tone: tone(G.verdict) },
          { label: 'Lead over the next', value: pct(G.margin), tone: G.margin > 0.4 ? 'ok' : 'warn' },
          { label: 'Decision', value: G.verdict === 'go' ? 'reach' : G.verdict === 'ask' ? 'ask which' : 'not found', tone: tone(G.verdict) },
        ]
      },
    }
  },
}

// --- Task planning: sentence → template → find / pick / place steps → checks on the desk → run with re-checks and replanning. ---

const TASKS = {
  tray: 'Put the red cup left of the block in the tray',
  stack: 'Stack the green block on the blue block',
  blocks: 'Put both blocks in the bin',
  ask: 'Put the red cup in the tray',
  far: 'Put the blue ball in the bin',
}
const SURPRISES: Record<PlanSurprise, string> = { none: 'No surprise', slip: 'First grasp slips', moved: 'A person moves it' }
const REPLAN = { on: 'Re-check and replan', off: 'Run the plan blind' }
const HOLD = 2.5
const tParams = (p: Params) => ({ task: pick(TASKS, p.task, 'stack') as keyof typeof TASKS, surprise: pick(SURPRISES, p.surprise, 'slip') as PlanSurprise, replan: pick(REPLAN, p.replan, 'on') === 'on' })
type TQ = ReturnType<typeof tParams>
const SIGHTS = seeDesk(VLM_OBJS, 0)
const tPlan = memoBy(
  (q: TQ) => q.task,
  (q: TQ): Plan => planTask(TASKS[q.task], VLM_OBJS, SIGHTS),
)
const tRun = memoBy(
  (q: TQ) => `${q.task}|${q.surprise}|${q.replan}`,
  (q: TQ): PlanRun | null => {
    const P = tPlan(q)
    return P.issues.length ? null : runPlan(P, VLM_OBJS, q.surprise, q.replan)
  },
)
const STEP_C = { done: POWER, redo: HEAT, failed: HIGH_V, doing: RING, todo: GREY }
const PL = { x: -13.6, y: -4.6, row: 0.8 }

export const visionLanguageModelsTaskPlanning: Lesson = {
  id: 'vision-language-models-task-planning',
  title: 'Task planning',
  tagline: 'A sentence becomes a short program: find, pick, place. Check it before the arm moves, re-check with the camera after each grasp, and replan when the world did not do what the plan assumed',
  formula: 'put X in D → [find X, pick X, place X in D] · stack X on Y → [find X, pick X, place X on Y] · checks: X grounded to one box, top-down IK within servo limits, hand empty before pick, Y a free block · after pick: jaws closed on air? → find X again, pick again',
  legend: [
    { color: POWER, label: 'Step done, check passed', shape: 'dot' },
    { color: RING, label: 'Step running', shape: 'dot' },
    { color: HEAT, label: 'Check failed: replanned', shape: 'dot' },
    { color: HIGH_V, label: 'Plan rejected, or a step failed blind', shape: 'dot' },
  ],
  points: [
    'Robot VLM planners (SayCan, Code as Policies, RT-2) let a language model write the step list, then hand each step to skills the robot already has. Here the "language model" is three sentence templates; honest and tiny, but the structure is the same: words → plan of skill calls → each skill grounded to an object (previous lesson) and solved with the arm\'s IK (Kinematics, Inverse kinematics).',
    'Check the plan before moving. Every step has preconditions you can test on the desk model: the object must ground to exactly one box ("the red cup" does not, so it asks), the hand must reach it straight down within the servo limits (the blue ball is 31 cm out: refused), the hand must be empty before a pick, and you can only stack on a free block. A plan that fails a check costs nothing; a plan that fails halfway leaves a cup in the air.',
    'Then the world changes. A grasp slips, or someone moves the block after the camera saw it, and the jaws close on air. Run blind, the arm carries on and places nothing; the plan "succeeded" step by step and the task failed. With a re-check after each pick (are the jaws stopped at the object\'s width?), the robot goes back one step: look again, grasp again. That loop, plan → act → check → replan, is the part that matters, whoever writes the plan.',
    'Real language planners also invent steps that sound right but are impossible ("pick the cup with the left hand"), so the checks are not optional. For learning the skills themselves from demonstrations, see Imitation learning; for the grasp physics, Kinematics, Grippers.',
  ],
  controls: [
    { kind: 'choice', key: 'task', options: opts(TASKS), initial: 'stack' },
    { kind: 'choice', key: 'surprise', options: opts(SURPRISES), initial: 'slip' },
    { kind: 'choice', key: 'replan', options: opts(REPLAN), initial: 'on' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const D = deskStage(scene)
    const parse = liveLabel(scene, [PL.x, PL.y, 0.2], { size: 0.34, align: 'left' })
    const rows = Array.from({ length: 6 }, (_, i) => liveLabel(scene, [PL.x, PL.y - 0.9 - i * PL.row, 0.2], { size: 0.36, align: 'left' }))
    const notes = Array.from({ length: 6 }, (_, i) => liveLabel(scene, [PL.x + 9.2, PL.y - 0.9 - i * PL.row, 0.2], { size: 0.3, align: 'left' }))
    const check = liveLabel(scene, [PL.x, PL.y - 6.0, 0.2], { size: 0.32, align: 'left' })
    const result = liveLabel(scene, [PL.x, PL.y - 6.8, 0.2], { size: 0.36, align: 'left' })
    const clock = { key: '', t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = tParams(p)
        const P = tPlan(q)
        const R = tRun(q)
        const key = `${q.task}|${q.surprise}|${q.replan}`
        if (key !== clock.key) {
          Object.assign(clock, { key, t: 0 })
          parse.set(`"${TASKS[q.task]}" → ${P.steps.length ? `${P.steps.length} steps` : 'no plan'}`, LABEL)
          status.set(`Task planning · ${SURPRISES[q.surprise].toLowerCase()} · ${REPLAN[q.replan ? 'on' : 'off'].toLowerCase()}`, LABEL)
          sub.set('toy planner: 3 sentence templates + grounding, not a language model · top-down grasps with the 4-DOF servo arm · real time', GREY)
          check.set(P.issues.length ? `checks before moving: ✗ step ${P.issues[0].step + 1}: ${P.issues[0].why}` : `checks before moving: ✓ grounded · ✓ in reach · ✓ hand free${P.goal.some((g) => typeof g.dest === 'number') ? ' · ✓ stack base' : ''}`, P.issues.length ? HIGH_V : POWER)
        }
        clock.t += dt
        const dur = R ? R.duration + HOLD : 1
        if (clock.t > dur) clock.t = 0
        const f = R ? R.frames[Math.min(R.frames.length - 1, Math.floor(clock.t / RUN.dt))] : null
        const now = f?.t ?? 0
        const seen = R ? R.log.filter((l) => l.t <= now) : []
        const done = !!R && now >= R.duration - 0.45
        rows.forEach((row, i) => {
          const s = P.steps[i]
          if (!s) {
            row.set(i === 0 && !P.steps.length ? '1. ask: which one do you mean?' : '', i === 0 && !P.steps.length ? HEAT : GREY)
            notes[i].set('', GREY)
            return
          }
          const last = [...seen].reverse().find((l) => l.step === i)
          const bad = P.issues.find((x) => x.step === i)
          const state = bad ? 'failed' : f && f.step === i && !done && (!last || now - last.t > RUN.dt * 1.5) ? 'doing' : (last?.status ?? 'todo')
          row.set(`${i + 1}. ${s.text}`, STEP_C[state])
          notes[i].set(bad ? `✗ ${bad.why}` : last ? `${last.status === 'done' ? '✓' : last.status === 'redo' ? 'redo:' : '✗'} ${last.note}` : '', STEP_C[state])
        })
        result.set(
          !R ? `rejected before moving: ${P.issues[0].why}` : done ? (R.ok ? `goal met${R.replans ? ` after ${R.replans} replan` : ''}: ${P.goal.map((g) => `${objName(VLM_OBJS[g.obj])} ${typeof g.dest === 'number' ? 'on the ' + objName(VLM_OBJS[g.dest]) : 'in the ' + g.dest}`).join(', ')}` : 'every step ran, goal NOT met: the plan never looked again') : `running · ${now.toFixed(1)} s of ${R.duration.toFixed(1)} s`,
          !R ? HIGH_V : done ? (R.ok ? POWER : HIGH_V) : GREY,
        )
        event.set(!R ? 'the arm stays put: a rejected plan costs nothing' : (seen.length ? seen[seen.length - 1].note : 'looking at the desk'), !R ? HEAT : seen.length ? STEP_C[seen[seen.length - 1].status] : GREY)
        const pos = f ? f.pos : VLM_OBJS.map((o): P3 => [o.x, o.y, 0])
        D.objs.forEach((o, i) => o.grp.position.set(...pos[i]))
        D.arm.set(f ? f.q : topDownQ(ARM_HOME)!)
        D.arm.jaw(f ? 1 - f.grip : 1)
        D.pen.begin()
        const hot = new Set<number>()
        if (!R) {
          const G = P.groundings[0]
          if (G && G.verdict === 'ask') G.order.filter((i) => G.prob[i] > 0.1).forEach((i) => hot.add(SIGHTS[i].id))
          P.steps.filter((s, i) => P.issues.some((x) => x.step === i)).forEach((s) => hot.add(s.obj))
        }
        VLM_OBJS.forEach((o, i) => {
          if (hot.has(i)) D.pen.arc([pos[i][0], pos[i][1], 0.002], o.r + 0.012, 0, 2 * Math.PI, HIGH_V, 1.2)
        })
        if (f && P.steps[f.step]) {
          const o = VLM_OBJS[P.steps[f.step].obj]
          D.pen.arc([pos[o.id][0], pos[o.id][1], 0.002], o.r + 0.01, 0, 2 * Math.PI, RING, 1)
        }
        D.pen.end()
      },
      readouts: (p) => {
        const q = tParams(p)
        const P = tPlan(q)
        const R = tRun(q)
        return [
          { label: 'Plan steps', value: `${P.steps.length}` },
          { label: 'Checks', value: P.issues.length ? 'rejected' : 'passed', tone: P.issues.length ? 'bad' : 'ok' },
          { label: 'Replans', value: R ? `${R.replans}` : '–', tone: R && R.replans ? 'warn' : undefined },
          { label: 'Goal', value: R ? (R.ok ? 'met' : 'not met') : 'not attempted', tone: R ? (R.ok ? 'ok' : 'bad') : 'warn' },
        ]
      },
    }
  },
}
