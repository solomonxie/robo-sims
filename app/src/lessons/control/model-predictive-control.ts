import * as THREE from 'three/webgpu'
import { BALANCER, DEG, MpcFrame, MpcPlan, fellAt, fixedStepAt, mpcDesign, mpcRun, toDeg, BALANCER_TOL } from '../../core/physics'
import { pct, cmText, degText } from '../../core/units'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  SIDE_SCOPE,
  SIDE_VIEW,
  addLabel,
  balanceBot,
  balanceFloor,
  flatBox,
  glowMat,
  lerp,
  liveLabel,
  memoBy,
  onBalancer,
  pointCloud,
  rayFan,
  scope,
  scopeLabels,
  setGlow,
  statusHeader,
  traceRun,
  balanceCues,
  lapseClock,
  sideScope,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const TS = 0.02
const N_MAX = 40
const SECONDS = 7
const GO = 0.5
const MOVE = 0.3
const PUSH = { at: 4.5, kick: 1 }
const SLOW = 0.5
const RIG = { at: [-10.5, -2.4, 0] as V3, k: 19, half: 0.36 }
const MOVES = { at: [-10.5, -6.7, 0] as V3, w: 11, h: 2.4 }
const PLAN = { y: 1.2, h: 4, xMax: 0.4, thMax: 20 * DEG }
const RUN = { y: -6.3, h: 4 }
const target = (t: number) => (t >= GO ? MOVE : 0)
const deg = (a: number) => degText(toDeg(a))
const ms = (s: number) => `${Math.round(s * 1000)} ms`
const at = (run: MpcFrame[], t: number) => fixedStepAt(run, t, BALANCER.dt)
const peakTilt = (run: MpcFrame[]) => Math.max(...run.map((f) => Math.abs(f.tilt)))
const yX = (x: number, h: number) => (x / PLAN.xMax) * (h / 2)
const yTh = (a: number, h: number) => (a / PLAN.thMax) * (h / 2)

const clock = () => lapseClock(SECONDS, SLOW, 0.6)

/** Balancer on a scrolling floor, target flag, acceleration and push arrows, and the plan as ghost bodies running ahead. */
function botRig(scene: THREE.Object3D) {
  const floor = balanceFloor(scene, RIG.at, RIG.k, RIG.half)
  const bot = balanceBot(floor.g)
  const ghosts = pointCloud(floor.g, 2 * N_MAX, 0.006)
  const bodies = rayFan(floor.g, N_MAX, glowMat(RING, 0.35), 0.0025)
  const cues = balanceCues(floor.g, RIG.half)
  const c = new THREE.Color()
  const ring = new THREE.Color(RING)
  const grey = new THREE.Color(GREY)
  return {
    set(f: MpcFrame, plan: MpcPlan | undefined, pushed: boolean) {
      bot.set(f.tilt, f.x)
      floor.roll(f.x)
      const xs = plan?.x ?? []
      let dots = 0
      const segs: [V3, V3][] = []
      xs.forEach((s, k) => {
        const dx = s[0] - f.x
        const head = onBalancer(s[2], BALANCER.h * 1.6, -0.1)
        const tip: V3 = [head[0] + dx, head[1], head[2]]
        if (Math.max(Math.abs(dx), Math.abs(tip[0])) > RIG.half - 0.02) return
        const axle: V3 = [dx, -0.1, BALANCER.wheelR]
        const col = c.copy(ring).lerp(grey, k / Math.max(1, xs.length - 1))
        ghosts.set(dots++, tip, col)
        ghosts.set(dots++, axle, col, 0.7)
        if (k % 5 === 4 || k === xs.length - 1) segs.push([axle, tip])
      })
      ghosts.show(dots)
      bodies(segs)
      cues(f, pushed)
    },
  }
}

/** The plan's moves u₀…u_N as bars over a 0…0.8 s axis, with each step's limits; u₀ (applied) bright. */
function movesPanel(scene: THREE.Object3D, full: number) {
  const { at: p, w, h } = MOVES
  const plot = scope(scene, w, h, { divs: [8, 2], zeroAt: 0.5 })
  plot.group.position.set(...p)
  addLabel(scene, `the plan's wheel accelerations, ±${Math.round(full * 100)} % of full torque (first: applied)`, [p[0] - w / 2, p[1] + h / 2 + 0.55, 0.3], LABEL, 0.26, 'left')
  addLabel(scene, `0 → ${N_MAX * TS} s ahead`, [p[0] + w / 2, p[1] - h / 2 - 0.5, 0.3], GREY, 0.22, 'right')
  const slot = w / N_MAX
  const bars = Array.from({ length: N_MAX }, () => {
    const m = glowMat(RING, 0.7)
    return { m, box: flatBox(plot.group, [slot * 0.7, 1, 0.08], m, [0, 0, 0.12]) }
  })
  const limM = glowMat(HIGH_V, 0.9)
  const lims = Array.from({ length: 2 * N_MAX }, () => flatBox(plot.group, [slot * 0.9, 0.05, 0.08], limM, [0, 0, 0.16]))
  const tag = liveLabel(plot.group, [-w / 2, -h / 2 - 0.5, 0.3], { size: 0.22, color: GREY, align: 'left' })
  const yU = (u: number) => Math.max(-h / 2, Math.min(h / 2, (u / (full * BALANCER.aMax)) * (h / 2)))
  return {
    set(plan: MpcPlan | undefined, note: string) {
      const u = plan?.u ?? []
      bars.forEach((b, i) => {
        b.box.visible = i < u.length
        if (!b.box.visible) return
        const y = yU(u[i])
        b.box.scale.y = Math.max(0.02, Math.abs(y))
        b.box.position.set(-w / 2 + (i + 0.5) * slot, y / 2, 0.12)
        const pinned = plan!.lo[i] !== undefined && (u[i] <= plan!.lo[i] + 1e-6 || u[i] >= plan!.hi[i] - 1e-6)
        setGlow(b.m, pinned ? HIGH_V : i === 0 ? POWER : RING, i === 0 ? 1.1 : lerp(0.75, 0.3, i / N_MAX))
      })
      lims.forEach((l, j) => {
        const i = Math.floor(j / 2)
        const lim = j % 2 ? plan?.hi[i] : plan?.lo[i]
        l.visible = i < u.length && lim !== undefined && Math.abs(lim) <= full * BALANCER.aMax
        if (l.visible) l.position.set(-w / 2 + (i + 0.5) * slot, yU(lim!), 0.16)
      })
      tag.set(note, GREY)
    },
  }
}

/** Horizon window: the plan's x, tilt and target over the next N steps, on a 0…0.8 s axis. */
function planScreen(scene: THREE.Object3D) {
  const plot = sideScope(scene, PLAN.y, PLAN.h, { divs: [8, 4], zeroAt: 0.5 })
  scopeLabels(scene, PLAN.y, PLAN.h, null, `the plan: x ±${PLAN.xMax * 100} cm`, `θ ±${toDeg(PLAN.thMax)}°`)
  addLabel(scene, `now → ${N_MAX * TS} s ahead`, [SIDE_SCOPE.x + SIDE_SCOPE.w / 2, PLAN.y - PLAN.h / 2 - 0.55, 0.3], GREY, 0.24, 'right')
  const refT = plot.trace(B_FIELD, { samples: N_MAX + 1, radius: 0.05 })
  const thT = plot.trace(HEAT, { samples: N_MAX + 1, radius: 0.05 })
  const xT = plot.trace(RING, { samples: N_MAX + 1, radius: 0.08 })
  return {
    set(f: MpcFrame, plan: MpcPlan | undefined, refAt: (t: number) => number) {
      const xs = plan?.x ?? []
      const t0 = plan?.t ?? f.t
      const us = [0, ...xs.map((_, k) => (k + 1) / N_MAX)]
      for (const tr of [refT, thT, xT]) tr.group.visible = xs.length > 0
      if (!xs.length) return
      refT.points(us, us.map((u) => yX(refAt(t0 + u * N_MAX * TS), PLAN.h)))
      thT.points(us, [f.tilt, ...xs.map((s) => s[2])].map((a) => yTh(a, PLAN.h)))
      xT.points(us, [f.x, ...xs.map((s) => s[0])].map((x) => yX(x, PLAN.h)))
    },
  }
}

/** The whole run: target, tilt, position, and optionally the other setting's position in grey. */
function runScreen(scene: THREE.Object3D) {
  const plot = sideScope(scene, RUN.y, RUN.h, { divs: [7, 4], zeroAt: 0.5 })
  scopeLabels(scene, RUN.y, RUN.h, SECONDS, `x ±${PLAN.xMax * 100} cm`, `θ ±${toDeg(PLAN.thMax)}°`)
  const refT = plot.trace(B_FIELD, { samples: 200, radius: 0.05 })
  const otherT = plot.trace(GREY, { samples: 200, radius: 0.05 })
  const thT = plot.trace(HEAT, { samples: 200, radius: 0.05 })
  const xT = plot.trace(RING, { samples: 200, radius: 0.08 })
  const dt = BALANCER.dt
  return (run: MpcFrame[], t: number, other?: MpcFrame[]) => {
    traceRun(refT, run, dt, SECONDS, t, (g) => yX(g.ref, RUN.h))
    otherT.group.visible = !!other
    if (other) traceRun(otherT, other, dt, SECONDS, t, (g) => yX(g.x, RUN.h))
    traceRun(thT, run, dt, SECONDS, t, (g) => yTh(g.tilt, RUN.h))
    traceRun(xT, run, dt, SECONDS, t, (g) => yX(g.x, RUN.h))
  }
}

/** Index of the last step that is more than 1 cm off the target after the move (null: never settles before `until`). */
function settleAfter(run: MpcFrame[], until: number) {
  const moving = run.filter((f) => f.t < until)
  const last = moving.filter((f) => Math.abs(f.x - f.ref) > 0.01 || f.t < GO).at(-1)!
  return last === moving.at(-1) ? null : last.t + BALANCER.dt - GO
}

// --- Receding horizon: plan N moves, apply one, re-plan; short plans without a tail are myopic and fall; the LQR tail makes MPC = LQR. ---

const TAILS = { none: 'No tail', lqr: 'LQR tail' }
const rhParams = (p: Params) => ({ N: Math.round(n(p, 'horizon')), tail: pick(TAILS, p.tail, 'none') === 'lqr' })
type RhQ = ReturnType<typeof rhParams>
const rhKey = (q: RhQ) => `${q.N}|${q.tail}`
const rhRun = memoBy(rhKey, (q: RhQ) => mpcRun({ design: mpcDesign({ horizon: q.N, ts: TS, tol: BALANCER_TOL, tail: q.tail }), seconds: SECONDS, target, pushes: [PUSH] }))

export const recedingHorizon: Lesson = {
  id: 'model-predictive-control-receding-horizon',
  title: 'Receding horizon',
  tagline: 'Plan the next half second, use 20 ms of it, plan again',
  formula: (p) => {
    const q = rhParams(p)
    return `every ${ms(TS)}: min over u₀…u₍N−1₎ of Σₖ₌₁ᴺ [(xₖ − r)ᵀQ(xₖ − r) + R·uₖ₋₁²]${q.tail ? ' with x_N weighted by P' : ''} · xₖ₊₁ = A·xₖ + B·uₖ, x = [x, ẋ, θ, θ̇, a] · apply u₀, discard the rest · N = ${q.N} (${ms(q.N * TS)})`
  },
  legend: [
    { color: RING, label: 'Plan: ghost bodies · predicted x · moves', shape: 'dot' },
    { color: POWER, label: 'u₀, the one move applied', shape: 'dot' },
    { color: B_FIELD, label: 'Target: 0 → 30 cm at 0.5 s, push at 4.5 s', shape: 'dot' },
    { color: HEAT, label: 'Tilt θ · push', shape: 'dot' },
  ],
  points: [
    'LQR (see State-space & LQR) folds the whole future into one gain. MPC plans out loud: every 20 ms it rolls the model forward N steps (the balancer plus its 30 ms motor lag, five states), picks the N wheel accelerations that minimise the same quadratic cost, applies only the first, then measures and plans again. The ghost bodies are the current plan.',
    'Re-planning is the feedback: a push or a model error shows up in the next measurement and the next plan bends around it. The plan also sees the target coming: the flag jumps at 0.5 s, but the plan starts rolling back to lean forward before that. LQR, which only knows the present error, cannot.',
    'Horizon length matters on an unstable robot. The cost stops at the last step, so a short plan happily ends still leaning: it skimps on the catch. Here 11 steps (0.22 s) or fewer fall, 12 stand but wander off, about 20 (0.4 s, a few fall times) arrive.',
    'The fix is a tail: weigh the last planned state by LQR\'s cost-to-go P, which prices everything after the horizon. With no limit active the first move is then exactly LQR\'s −K·x for any N, even 1 (tested). So MPC is LQR plus the ability to plan around limits: Constraints, next.',
  ],
  controls: [
    { kind: 'slider', key: 'horizon', label: 'Plan length N (× 20 ms)', min: 3, max: N_MAX, step: 1, initial: 25, format: (v) => `${v} steps · ${ms(v * TS)}` },
    { kind: 'choice', key: 'tail', options: opts(TAILS), initial: 'none' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const rig = botRig(scene)
    const moves = movesPanel(scene, 0.12)
    const plan = planScreen(scene)
    const runPlot = runScreen(scene)
    const tick = clock()
    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = rhParams(p)
        const r = rhRun(q)
        const t = tick(dt, rhKey(q))
        const f = at(r.frames, t)
        const pl = f.fallen ? undefined : r.plans[f.plan]
        const pushed = t >= PUSH.at && t < PUSH.at + 0.3
        rig.set(f, pl, pushed)
        moves.set(pl, pl ? `${pl.iterations} solver pass${pl.iterations > 1 ? 'es' : ''}` : '')
        plan.set(f, pl, target)
        runPlot(r.frames, t)
        status.set(`MPC · N = ${q.N} (${ms(q.N * TS)}) · ${q.tail ? 'LQR tail' : 'no tail'} · x ${cmText(f.x)} · θ ${deg(f.tilt)} · applying ${pct(f.u / BALANCER.aMax)}`, LABEL)
        const endX = pl?.x.at(-1)
        if (f.fallen) event.set(`down at ${(fellAt(r.frames) ?? 0).toFixed(1)} s: each ${ms(q.N * TS)} plan ended still leaning, and paid nothing for it`, HIGH_V)
        else if (pushed) event.set('pushed: the next plan starts from the new state and bends around it', HEAT)
        else if (t < GO && Math.abs(f.x) > 0.002) event.set(`the flag has not moved yet, but the plan sees it coming: rolling back ${cmText(-f.x)} to lean`, B_FIELD)
        else if (endX && Math.abs(endX[2]) > 2 * DEG) event.set(`plan ends leaning ${deg(endX[2])}: beyond ${ms(q.N * TS)} it does not care`, HEAT)
        else if (Math.abs(f.x - f.ref) > 0.01) event.set(`${cmText(Math.abs(f.ref - f.x))} to go · plan ends ${endX ? cmText(Math.abs(f.ref - endX[0])) : '—'} from the flag`, RING)
        else event.set(t < GO ? 'holding home; the flag jumps 30 cm ahead at 0.5 s' : 'at the flag: every plan is now "stay"', POWER)
        sub.set(`${t.toFixed(1)} / ${SECONDS} s · slowed ${1 / SLOW}× · plans every ${ms(TS)}, sim 200 Hz with motor lag and back-EMF · tape every 100 mm`)
      },
      readouts: (p) => {
        const q = rhParams(p)
        const r = rhRun(q)
        const fell = fellAt(r.frames)
        const s = settleAfter(r.frames, PUSH.at)
        const end = r.frames.at(-1)!
        return [
          { label: 'Plan looks ahead', value: `${ms(q.N * TS)} · ${q.N} moves` },
          { label: 'Within 1 cm after', value: fell !== null ? `falls at ${fell.toFixed(1)} s` : s === null ? 'not by the push' : `${s.toFixed(2)} s`, tone: fell !== null ? 'bad' : s === null ? 'warn' : 'ok' },
          { label: `Off target at ${SECONDS} s`, value: fell !== null ? '—' : cmText(Math.abs(end.x - end.ref)), tone: fell === null && Math.abs(end.x - end.ref) > 0.01 ? 'warn' : undefined },
          { label: 'Peak tilt', value: deg(peakTilt(r.frames)), tone: fell !== null ? 'bad' : undefined },
        ]
      },
    }
  },
}

// --- Constraints: same cost and model; clipped LQR falls at a tight tolerance, MPC plans inside the limits (box QP by active set). ---

const CN_MODES = { mpc: 'MPC', lqr: 'Clipped LQR' }
const CN_N = 30
const cnParams = (p: Params) => ({ mpc: pick(CN_MODES, p.mode, 'mpc') === 'mpc', pos: n(p, 'pos') / 100, limit: n(p, 'limit') / 100 })
type CnQ = ReturnType<typeof cnParams>
const cnKey = (q: CnQ) => `${q.mpc}|${q.pos}|${q.limit}`
const cnDesign = memoBy(
  (pos: number) => `${pos}`,
  (pos: number) => mpcDesign({ horizon: CN_N, ts: TS, tol: { ...BALANCER_TOL, pos }, tail: true }),
)
const cnRun = memoBy(cnKey, (q: CnQ) =>
  mpcRun({ design: cnDesign(q.pos), seconds: SECONDS, target, mode: q.mpc ? 'mpc' : 'lqr', limit: q.limit, preview: false, pushes: [PUSH] }),
)

export const mpcConstraints: Lesson = {
  id: 'model-predictive-control-constraints',
  title: 'Constraints',
  tagline: 'Plan inside the motor\'s limits instead of clipping after the fact',
  formula: (p) => {
    const q = cnParams(p)
    return q.mpc
      ? `min ½UᵀHU + fᵀU subject to loₖ ≤ uₖ ≤ hiₖ, k = 0…${CN_N - 1} · hiₖ = ${pct(q.limit)}·aMax·(1 − v̂ₖ/vMax), loₖ = −${pct(q.limit)}·aMax·(1 + v̂ₖ/vMax) · H, f from the model and the cost (accept ${cmText(q.pos)}) · active set`
      : `u = clip(−K·(x − r), lo, hi) · K from the same model and cost (accept ${cmText(q.pos)}) · lo…hi = ±${pct(q.limit)}·aMax·(1 ∓ v/vMax)`
  },
  legend: [
    { color: RING, label: 'Plan: ghosts · moves · x (grey: the other mode)', shape: 'dot' },
    { color: HIGH_V, label: 'Limits per step · a move pinned to one', shape: 'dot' },
    { color: B_FIELD, label: 'Target: 0 → 30 cm at 0.5 s, push at 4.5 s', shape: 'dot' },
    { color: HEAT, label: 'Tilt θ · push', shape: 'dot' },
  ],
  points: [
    'Motors have limits; LQR\'s K does not know them. Ask for a 1 cm position tolerance and K wants many times full torque on the first tick; the clip delivers less, the body leans further than K expected, the next demand is bigger still, and it falls (as in LQR intuition).',
    'MPC writes the limit into the plan: every move uₖ must lie between loₖ and hiₖ. The cost is still quadratic and the limits are boxes, so each plan is a small quadratic programme (QP). Here an active-set method solves it: solve with some moves pinned to their limits, free one whose pin pulls the wrong way, pin one that overshoots, repeat. Warm-started from the last plan it takes a few passes, well under a millisecond.',
    'Knowing it cannot brake harder later, the plan leans less now: same cost, same model, no preview for either (both see only the present target), and at 1 cm with half the torque only MPC arrives. The pinned red bars are the plan running at the limit on purpose.',
    'The torque limit shrinks with speed (back-EMF, 1 − v/vMax), so each step\'s box uses the speed the last plan predicted. And a plan is only as good as its model: give it 80 % or more at 1 cm and MPC falls too. It spends every bit of torque leaning 25–30°, where the linear model is up to 5 % (sin θ ≈ θ) and 13 % (cos θ ≈ 1) off, and nothing is left to absorb the error. Keeping a reserve, the torque share, is how real MPC copes; speed or tilt limits would make the QP general rather than boxes, which embedded solvers (OSQP, acados) handle.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(CN_MODES), initial: 'mpc' },
    { kind: 'slider', key: 'pos', label: 'Position error you accept', min: 1, max: 50, step: 1, initial: 1, log: true, format: (v) => `${v} cm` },
    { kind: 'slider', key: 'limit', label: 'Torque the plan may use', min: 30, max: 100, step: 5, initial: 50, format: (v) => `${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const rig = botRig(scene)
    const moves = movesPanel(scene, 1)
    const plan = planScreen(scene)
    const runPlot = runScreen(scene)
    const tick = clock()
    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = cnParams(p)
        const r = cnRun(q)
        const other = cnRun({ ...q, mpc: !q.mpc })
        const t = tick(dt, cnKey(q))
        const f = at(r.frames, t)
        const pl = f.fallen ? undefined : r.plans[f.plan]
        const pushed = t >= PUSH.at && t < PUSH.at + 0.3
        rig.set(f, pl, pushed)
        const pinned = pl ? pl.u.filter((u, i) => u <= pl.lo[i] + 1e-6 || u >= pl.hi[i] - 1e-6).length : 0
        moves.set(pl, !pl ? '' : q.mpc ? `${pinned} of ${CN_N} moves pinned · ${pl.iterations} pass${pl.iterations > 1 ? 'es' : ''}` : 'LQR: no plan, one move from −K·x')
        plan.set(f, pl, () => f.ref)
        runPlot(r.frames, t, other.frames)
        status.set(`${q.mpc ? 'MPC' : 'Clipped LQR'} · accept ${cmText(q.pos)} · ${pct(q.limit)} torque · x ${cmText(f.x)} · θ ${deg(f.tilt)}`, LABEL)
        const want = pl?.want ?? 0
        if (f.fallen) event.set(`down at ${(fellAt(r.frames) ?? 0).toFixed(1)} s: ${q.mpc ? 'the plan used all the torque, none was left for the model\'s error' : 'the clipped catch came too late'}`, HIGH_V)
        else if (pushed) event.set('pushed: the next plan starts from the new state', HEAT)
        else if (!q.mpc && pl && Math.abs(want) > Math.abs(pl.u[0]) + 0.01) event.set(`K asks ${pct(want / BALANCER.aMax)}, the limit allows ${pct(pl.u[0] / BALANCER.aMax)}`, HIGH_V)
        else if (f.sat) event.set('the motor clipped: the real robot is not quite the linear model', HIGH_V)
        else if (q.mpc && pinned) event.set(`${pinned} planned moves sit on the limit: braking is planned in, not hoped for`, RING)
        else if (Math.abs(f.x - f.ref) > 0.01) event.set(`${cmText(Math.abs(f.ref - f.x))} to go · lean ${deg(f.tilt)}`, RING)
        else event.set(t < GO ? 'holding home; the flag jumps 30 cm ahead at 0.5 s' : 'at the flag', POWER)
        sub.set(`${t.toFixed(1)} / ${SECONDS} s · slowed ${1 / SLOW}× · ${q.mpc ? `${CN_N} moves × ${ms(TS)} with the LQR tail` : `K for the same cost, every ${ms(TS)}`} · grey: ${q.mpc ? 'clipped LQR' : 'MPC'}`)
      },
      readouts: (p) => {
        const q = cnParams(p)
        const r = cnRun(q)
        const fell = fellAt(r.frames)
        const s = settleAfter(r.frames, PUSH.at)
        const passes = r.plans.map((x) => x.iterations)
        const clipped = r.frames.some((f) => f.sat) || r.plans.some((x) => x.want !== undefined && x.want !== x.u[0])
        return [
          { label: 'Within 1 cm after', value: fell !== null ? `falls at ${fell.toFixed(1)} s` : s === null ? 'not by the push' : `${s.toFixed(2)} s`, tone: fell !== null ? 'bad' : s === null ? 'warn' : 'ok' },
          { label: 'Peak tilt', value: deg(peakTilt(r.frames)), tone: fell !== null ? 'bad' : undefined },
          { label: q.mpc ? 'Motor clipped' : 'Command clipped', value: ms(q.mpc ? r.frames.filter((f) => f.sat).length * BALANCER.dt : r.plans.filter((x) => x.want !== x.u[0]).length * TS), tone: clipped ? 'warn' : 'ok' },
          { label: 'QP passes per plan', value: q.mpc ? `mean ${(passes.reduce((a, b) => a + b, 0) / passes.length).toFixed(1)} · max ${Math.max(...passes)}` : '— (no QP)' },
        ]
      },
    }
  },
}
