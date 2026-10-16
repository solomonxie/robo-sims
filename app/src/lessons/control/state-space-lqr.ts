import * as THREE from 'three/webgpu'
import { BALANCER, Cx, DEG, G, StateFrame, Tolerances, balancerLqr, fellAt, fixedStepAt, stateRun, toDeg } from '../../core/physics'
import { pct } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  DATA_COLOR,
  FORCE,
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
  liveLabel,
  memoBy,
  onBalancer,
  pointCloud,
  sPlane,
  scope,
  scopeLabels,
  statusHeader,
  stretchArrow,
  sumBars,
  traceRun,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const DOT = '̇'
const NAMES = ['x', `x${DOT}`, 'θ', `θ${DOT}`]
const STATE_COLORS = [B_FIELD, DATA_COLOR, HEAT, FORCE]
const TOL: Tolerances = { pos: 0.1, speed: 0.5, tilt: 5 * DEG, rate: 50 * DEG, effort: 3 }
const RIG = { at: [-10.5, -2.4, 0] as V3, k: 19, half: 0.36, bars: [-10.2, -5.3, 0] as V3, barW: 6 }
const SLOW = 0.5
const deg = (a: number, digits = 1) => `${toDeg(a).toFixed(digits)}°`
const XD = `x${DOT}`
const TD = `θ${DOT}`
const cm = (m: number) => `${(m * 100).toFixed(1)} cm`
const kText = (k: readonly number[]) => k.map((x) => x.toFixed(Math.abs(x) < 10 ? 1 : 0)).join(' · ')
const poleText = (p: Cx) => (Math.abs(p.im) > 0.01 ? `${p.re.toFixed(1)} ± ${Math.abs(p.im).toFixed(1)}j /s` : `${p.re.toFixed(1)} /s`)
const slowest = (ps: readonly Cx[]) => ps.reduce((a, b) => (b.re > a.re ? b : a))
const at = (run: StateFrame[], t: number) => fixedStepAt(run, t, BALANCER.dt)

/** Balancer on a scrolling floor with a target flag, a wheel-acceleration arrow and a push arrow; state bars below. */
function botRig(scene: THREE.Object3D) {
  const floor = balanceFloor(scene, RIG.at, RIG.k, RIG.half)
  const bot = balanceBot(floor.g)
  const com = pointCloud(floor.g, 1, 0.009)
  const shove = stretchArrow(floor.g, HEAT, 0.004)
  const torque = stretchArrow(floor.g, POWER, 0.004)
  const flag = add(floor.g, new THREE.Group())
  flatBox(flag, [0.004, 0.004, 0.16], glowMat(B_FIELD, 0.8), [0, -0.1, 0.08])
  flatBox(flag, [0.05, 0.003, 0.03], glowMat(B_FIELD, 1), [0.025, -0.1, 0.145])
  const bars = sumBars(scene, RIG.bars, [...NAMES.map((label, i) => ({ label: `−k·${label}`, color: STATE_COLORS[i] })), { label: 'a', color: POWER }], RIG.barW)
  addLabel(scene, 'wheel acceleration a = −K·x, % of the motor limit', [RIG.bars[0] - RIG.barW / 2 - 1.6, RIG.bars[1] + 0.75, 0.2], LABEL, 0.28, 'left')
  return {
    set(f: StateFrame, pushed: boolean) {
      bot.set(f.tilt, f.x)
      floor.roll(f.x)
      com.set(0, onBalancer(f.tilt, BALANCER.h), RING, 1)
      com.show(1)
      const top = onBalancer(f.tilt, BALANCER.h * 1.6, -0.1, -0.05)
      shove(pushed ? [top[0] - 0.08, top[1], top[2]] : top, top)
      torque([0, -0.1, 0.004], [f.got * 0.12, -0.1, 0.004], f.sat ? HIGH_V : POWER)
      const d = f.ref - f.x
      flag.visible = Math.abs(d) < RIG.half - 0.03
      flag.position.x = d
      bars.set([...f.terms, f.cmd], f.sat)
    },
  }
}

/** Shared clock: restarts on a control change, loops with a pause. */
function clock(seconds: number) {
  const st = { key: '', t: 0 }
  return (dt: number, key: string) => {
    if (key !== st.key) [st.key, st.t] = [key, 0]
    st.t += dt * SLOW
    if (st.t > seconds + 0.6) st.t = 0
    return Math.min(st.t, seconds)
  }
}

// --- State vector: x, ẋ, θ, θ̇ fix the balancer's future; a = −K·x, tilt-only feedback leaves two poles at 0 and it drifts. ---

const SV = { seconds: 6, push: 2.5, phase: { y: 0.4, s: 5 }, sy: -6.3, sh: 3.6, xMax: 0.4, vMax: 0.5, thMax: 8 * DEG, wMax: 120 * DEG }
const SV_MODES = { full: 'Full state', tilt: 'Tilt only' }
const LQR0 = balancerLqr(TOL)
const svParams = (p: Params) => ({ full: pick(SV_MODES, p.mode, 'full') === 'full', kick: n(p, 'push') * DEG, x0: n(p, 'start') / 100 })
type SvQ = ReturnType<typeof svParams>
const svKey = (q: SvQ) => `${q.full}|${q.kick}|${q.x0}`
const svGains = (full: boolean) => (full ? LQR0.k : [0, 0, LQR0.k[2], LQR0.k[3]])
const svRun = memoBy(
  (q: SvQ) => svKey(q),
  (q: SvQ) => stateRun({ k: svGains(q.full), seconds: SV.seconds, x0: q.x0, pushes: q.kick ? [{ at: SV.push, kick: q.kick }] : [] }),
)

/** Phase-plane screen: horizontal ±`hx`, vertical ±`hy`; `draw(trace, run, t, fx, fy)` plots the state's path up to t. */
function phasePlane(scene: THREE.Object3D, x: number, title: string, axes: string) {
  const { y, s } = SV.phase
  const plot = scope(scene, s, s, { divs: [4, 4], zeroAt: 0.5 })
  plot.group.position.set(x, y, 0)
  addLabel(scene, title, [x - s / 2, y + s / 2 + 0.6, 0.3], LABEL, 0.28, 'left')
  addLabel(scene, axes, [x - s / 2, y - s / 2 - 0.55, 0.3], GREY, 0.24, 'left')
  return {
    trace: (color: string, radius: number) => plot.trace(color, { samples: 240, radius }),
    draw(tr: ReturnType<ReturnType<typeof scope>['trace']>, run: StateFrame[], t: number, fx: (f: StateFrame) => number, fy: (f: StateFrame) => number) {
      const k = Math.max(2, Math.round((t / SV.seconds) * 239) + 1)
      const us: number[] = []
      const ys: number[] = []
      for (let i = 0; i < k; i++) {
        const f = at(run, (i / 239) * SV.seconds)
        us.push(Math.min(1, Math.max(0, 0.5 + fx(f) / 2)))
        ys.push((fy(f) * s) / 2)
      }
      tr.points(us, ys)
    },
  }
}

export const stateVector: Lesson = {
  id: 'state-space-lqr-state-vector',
  title: 'State vector',
  tagline: 'Four numbers that fix the future, and a gain on each',
  formula: (p) => {
    const q = svParams(p)
    return `state x = [x, ẋ, θ, θ̇] · ẋ = A·x + B·a: ẍ = a, θ̈ = (g·θ − a)/h = ${(G / BALANCER.h).toFixed(1)}·θ − ${(1 / BALANCER.h).toFixed(1)}·a · a = −K·x, K = [${kText(svGains(q.full))}] (m/s² per m, m/s, rad, rad/s)`
  },
  legend: [
    { color: RING, label: 'State: the dot in each phase plane · x(t)', shape: 'dot' },
    { color: GREY, label: 'The other mode, same push', shape: 'dot' },
    { color: B_FIELD, label: 'Home flag · −k·x term', shape: 'dot' },
    { color: POWER, label: 'Wheel acceleration a (red: clipped)', shape: 'dot' },
  ],
  points: [
    'A state is the shortest list of numbers that, with the inputs from now on, fixes the future. For the balancer (see Balancing robots) it is four: position x, speed ẋ, tilt θ and tilt rate θ̇. Near upright the physics is linear in them, ẋ = A·x + B·a, with the wheel acceleration a as the input.',
    'Plot pairs of states and the robot is a dot moving in a phase plane: tilt against tilt rate, position against speed. Upright and home is the origin of both. A controller is a rule that steers the dot there, and the simplest is linear: a = −K·x, one gain per state, summed (the bars).',
    'Tilt only feeds back θ and θ̇, like Tilt PID. It stands up, but nothing sees x or ẋ: the closed loop keeps two poles at s = 0 (see Stability), so after a push it rolls off at a steady speed and never comes back. Start it off home and it stays there.',
    'Full state adds gains on x and ẋ, and their sign surprises: when the robot is ahead of home, a = −k·x drives it further ahead for a moment. That tips the body back toward home, and then the tilt terms chase the lean. The encoders give x and ẋ, the IMU θ and θ̇ (see Complementary filter). These K come from LQR, next.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(SV_MODES), initial: 'full' },
    { kind: 'slider', key: 'push', label: 'Push at 2.5 s (tilt rate kick)', min: 0, max: 150, step: 10, initial: 60, format: (v) => `${v} °/s` },
    { kind: 'slider', key: 'start', label: 'Start off home', min: -30, max: 30, step: 5, initial: 15, format: (v) => `${v} cm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const rig = botRig(scene)
    const tilt = phasePlane(scene, SIDE_SCOPE.x - 2.75, `tilt θ → · rate ${TD} ↑`, `±${Math.round(toDeg(SV.thMax))}° · ±${Math.round(toDeg(SV.wMax))}°/s`)
    const pos = phasePlane(scene, SIDE_SCOPE.x + 2.75, `position x → · speed ${XD} ↑`, `±${SV.xMax * 100} cm · ±${SV.vMax} m/s`)
    const tiltG = tilt.trace(GREY, 0.05)
    const posG = pos.trace(GREY, 0.05)
    const tiltT = tilt.trace(RING, 0.07)
    const posT = pos.trace(RING, 0.07)
    const plot = scope(scene, SIDE_SCOPE.w, SV.sh, { divs: [6, 4], zeroAt: 0.5 })
    plot.group.position.set(SIDE_SCOPE.x, SV.sy, 0)
    scopeLabels(scene, SV.sy, SV.sh, SV.seconds, `position x ±${SV.xMax * 100} cm`, 'home = 0')
    const xG = plot.trace(GREY, { samples: 200, radius: 0.05 })
    const xT = plot.trace(RING, { samples: 200, radius: 0.08 })
    const yX = (x: number) => (x / SV.xMax) * (SV.sh / 2)
    const tick = clock(SV.seconds)
    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = svParams(p)
        const run = svRun(q)
        const other = svRun({ ...q, full: !q.full })
        const t = tick(dt, svKey(q))
        const f = at(run, t)
        const pushed = q.kick > 0 && t >= SV.push && t < SV.push + 0.3
        rig.set(f, pushed)
        const th = (g: StateFrame) => g.tilt / SV.thMax
        const w = (g: StateFrame) => g.rate / SV.wMax
        const x = (g: StateFrame) => g.x / SV.xMax
        const v = (g: StateFrame) => g.v / SV.vMax
        tilt.draw(tiltG, other, t, th, w)
        tilt.draw(tiltT, run, t, th, w)
        pos.draw(posG, other, t, x, v)
        pos.draw(posT, run, t, x, v)
        traceRun(xG, other, BALANCER.dt, SV.seconds, t, (g) => yX(g.x))
        traceRun(xT, run, BALANCER.dt, SV.seconds, t, (g) => yX(g.x))
        status.set(`${q.full ? 'Full state' : 'Tilt only'} · x ${cm(f.x)} · ${XD} ${f.v.toFixed(2)} m/s · θ ${deg(f.tilt)} · ${TD} ${Math.round(toDeg(f.rate))}°/s`, LABEL)
        if (f.fallen) event.set(`down at ${(fellAt(run) ?? 0).toFixed(1)} s: the push needed more than the motors have`, HIGH_V)
        else if (pushed) event.set(`pushed: ${TD} jumps, the dot leaps up the tilt plane`, HEAT)
        else if (f.sat) event.set('wheel acceleration clipped at the motor limit', HIGH_V)
        else if (!q.full && Math.abs(f.v) > 0.03) event.set(`upright, but rolling away at ${Math.abs(f.v).toFixed(2)} m/s: nothing feeds back x or ${XD}`, HEAT)
        else if (!q.full && Math.abs(f.x) > 0.02) event.set(`upright, parked ${cm(Math.abs(f.x))} off home: no gain on x`, HEAT)
        else if (Math.abs(f.tilt) > 0.3 * DEG) event.set(`${f.v * f.x < 0 ? 'heading home' : 'wheels run away from home'}: body leans ${deg(Math.abs(f.tilt))} ${f.tilt * f.x < 0 ? 'toward' : 'away from'} home`, RING)
        else if (Math.abs(f.x) > 0.01) event.set(`easing home: ${cm(Math.abs(f.x))} to go`, RING)
        else event.set('at the origin of both planes: home, upright, still', POWER)
        sub.set(`${t.toFixed(1)} / ${SV.seconds} s · slowed ${1 / SLOW}× · loop 200 Hz · floor tape every 100 mm`)
      },
      readouts: (p) => {
        const q = svParams(p)
        const run = svRun(q)
        const end = run[run.length - 1]
        const fell = fellAt(run)
        const back = Math.abs(end.x) < 0.01 && Math.abs(end.v) < 0.01
        return [
          { label: `Where it ends (${SV.seconds} s)`, value: fell !== null ? `fell at ${fell.toFixed(1)} s` : back ? 'home' : `${cm(end.x)} from home`, tone: fell !== null ? 'bad' : back ? 'ok' : 'warn' },
          { label: 'Speed at the end', value: fell !== null ? '—' : `${end.v.toFixed(2)} m/s`, tone: Math.abs(end.v) > 0.02 ? 'warn' : 'ok' },
          { label: 'Peak tilt', value: deg(Math.max(...run.map((f) => Math.abs(f.tilt)))) },
          { label: 'Peak wheel accel', value: pct(Math.max(...run.map((f) => Math.abs(f.got)))), tone: run.some((f) => f.sat) ? 'bad' : undefined },
        ]
      },
    }
  },
}

// --- LQR intuition: weights on errors and effort → Riccati → K; cheap effort = fast poles, tight tilt = slow moves, limits not in the model. ---

const LQ = { seconds: 7, go: 0.5, move: 0.3, push: 4.5, kick: 1, sy: -6.3, sh: 4, xMax: 0.4, thMax: 16 * DEG }
const SPLANE = { y: 1.2, per: 5, re: [-35, 10] as const, im: 15 }
const lqParams = (p: Params): Tolerances => ({ ...TOL, pos: n(p, 'pos') / 100, tilt: n(p, 'tilt') * DEG, effort: n(p, 'effort') })
const lqKey = (t: Tolerances) => `${t.pos}|${t.tilt}|${t.effort}`
const lqTarget = (t: number) => (t >= LQ.go ? LQ.move : 0)
const lqData = memoBy(lqKey, (tol: Tolerances) => {
  const lqr = balancerLqr(tol)
  const run = stateRun({ k: lqr.k, seconds: LQ.seconds, target: lqTarget, pushes: [{ at: LQ.push, kick: LQ.kick }], cost: tol })
  const locus = Array.from({ length: 16 }, (_, i) => balancerLqr({ ...tol, effort: 0.5 * 28 ** (i / 15) }).poles).flat()
  const moving = run.filter((f) => f.t < LQ.push)
  const last = moving.filter((f) => Math.abs(f.x - LQ.move) > 0.01 || f.t < LQ.go).at(-1)!
  return { ...lqr, run, locus, back: Math.min(0, ...moving.map((f) => f.x)), settle: last === moving.at(-1) ? null : last.t + BALANCER.dt - LQ.go }
})

export const lqrIntuition: Lesson = {
  id: 'state-space-lqr-lqr-intuition',
  title: 'LQR intuition',
  tagline: 'Say what you care about; the Riccati equation picks the gains',
  formula: (p) => {
    const tol = lqParams(p)
    const d = lqData(tol)
    return `J = Σ [(x/${cm(tol.pos)})² + (ẋ/${tol.speed} m/s)² + (θ/${deg(tol.tilt, 0)})² + (θ̇/${Math.round(toDeg(tol.rate))}°/s)² + (a/${tol.effort} m/s²)²]·dt · P ← Q + AᵀPA − AᵀPB(R + BᵀPB)⁻¹BᵀPA, ${d.iterations} passes → K = (R + BᵀPB)⁻¹BᵀPA`
  },
  legend: [
    { color: RING, label: 'Closed-loop poles · position x', shape: 'dot' },
    { color: GREY, label: 'Poles as the effort weight sweeps 0.5 → 14 m/s²', shape: 'dot' },
    { color: B_FIELD, label: 'Target: 0 → 30 cm, push at 4.5 s', shape: 'dot' },
    { color: HEAT, label: 'Tilt θ · push', shape: 'dot' },
  ],
  points: [
    'Placing four poles by hand (see Stability) is guesswork. LQR asks instead what you care about: a cost J that adds up squared state errors and squared effort over all time. Bryson\'s rule makes the weights readable: divide each by the largest value you would accept, so the sliders are tolerances.',
    'The best K for that cost comes from the Riccati equation. P is the cost-to-go: from state x the rest of the run costs xᵀPx. Start with P = Q and step it back one 5 ms tick at a time until it stops changing (the pass count is in the formula); then K = (R + BᵀPB)⁻¹BᵀPA. No tuning loop, one answer.',
    'The knobs trade against each other. Cheap effort sends the fast poles far left (grey path): a stiffer loop that hits a push harder, while the slow pair, set by the position and tilt tolerances, hardly moves. A tight position tolerance arrives sooner but leans further; a tight tilt tolerance stays upright and creeps. Nobody told it to, but every move starts by rolling back: to go forward it must first lean forward.',
    'LQR\'s guarantees (stable, phase margin ≥ 60°, any gain increase is fine) hold for the linear model with every state measured, in continuous time. The real robot adds a 30 ms motor lag and a torque limit LQR knows nothing of: ask for 1 cm on this 30 cm move and K wants some 20× full torque, clips and falls. Limits in the loop are Model predictive control.',
  ],
  controls: [
    { kind: 'slider', key: 'pos', label: 'Position error you accept', min: 1, max: 50, step: 1, initial: 10, log: true, format: (v) => `${v} cm` },
    { kind: 'slider', key: 'tilt', label: 'Tilt you accept', min: 1, max: 20, step: 1, initial: 5, log: true, format: (v) => `${v}°` },
    { kind: 'slider', key: 'effort', label: 'Wheel accel you accept', min: 0.5, max: 14, step: 0.5, initial: 3, log: true, format: (v) => `${v} m/s²` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const rig = botRig(scene)
    const plane = sPlane(scene, [SIDE_SCOPE.x, SPLANE.y, 0], SPLANE.per, SPLANE.re[0], SPLANE.re[1], SPLANE.im)
    addLabel(scene, 'poles of A − B·K', [SIDE_SCOPE.x - plane.w / 2, SPLANE.y + plane.h / 2 + 0.6, 0.3], LABEL, 0.28, 'left')
    addLabel(scene, `open loop ±${Math.sqrt(G / BALANCER.h).toFixed(1)}, 0, 0 /s`, [SIDE_SCOPE.x + plane.w / 2, SPLANE.y + plane.h / 2 + 0.6, 0.3], GREY, 0.24, 'right')
    const offTag = liveLabel(plane.group, [-plane.w / 2 + 0.25, -plane.h / 2 + 0.35, 0.35], { size: 0.24, color: GREY, align: 'left' })
    const plot = scope(scene, SIDE_SCOPE.w, LQ.sh, { divs: [7, 4], zeroAt: 0.5 })
    plot.group.position.set(SIDE_SCOPE.x, LQ.sy, 0)
    scopeLabels(scene, LQ.sy, LQ.sh, LQ.seconds, `x ±${LQ.xMax * 100} cm`, `θ ±${toDeg(LQ.thMax)}°`)
    const refT = plot.trace(B_FIELD, { samples: 200, radius: 0.05 })
    const thT = plot.trace(HEAT, { samples: 200, radius: 0.05 })
    const xT = plot.trace(RING, { samples: 200, radius: 0.08 })
    const yX = (x: number) => (x / LQ.xMax) * (LQ.sh / 2)
    const yTh = (a: number) => (a / LQ.thMax) * (LQ.sh / 2)
    const tick = clock(LQ.seconds)
    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const tol = lqParams(p)
        const d = lqData(tol)
        const t = tick(dt, lqKey(tol))
        const f = at(d.run, t)
        const pushed = t >= LQ.push && t < LQ.push + 0.3
        rig.set(f, pushed)
        plane.locus(d.locus, GREY)
        const off = plane.poles(d.poles)
        offTag.set(off ? `← ${off} fast poles off-screen` : '', GREY)
        traceRun(refT, d.run, BALANCER.dt, LQ.seconds, t, (g) => yX(g.ref))
        traceRun(thT, d.run, BALANCER.dt, LQ.seconds, t, (g) => yTh(g.tilt))
        traceRun(xT, d.run, BALANCER.dt, LQ.seconds, t, (g) => yX(g.x))
        status.set(`LQR · accept ${cm(tol.pos)}, ${deg(tol.tilt, 0)}, ${tol.effort} m/s² · K = [${kText(d.k)}]`, LABEL)
        if (f.fallen) event.set(`down at ${(fellAt(d.run) ?? 0).toFixed(1)} s: K asked for more torque than the motors have`, HIGH_V)
        else if (f.sat) event.set(`clipped: K wants ${pct(Math.abs(f.cmd))} of full torque`, HIGH_V)
        else if (pushed) event.set('pushed: the wheels run under it, then bring it back to the flag', HEAT)
        else if (t >= LQ.go && t < LQ.push && f.x < -0.002 && f.v < 0) event.set(`target 30 cm ahead, yet it rolls back ${cm(-f.x)} first: leaning the body forward`, B_FIELD)
        else if (t >= LQ.go && Math.abs(f.x - f.ref) > 0.01) event.set(`${cm(Math.abs(f.ref - f.x))} to go · lean ${deg(f.tilt)} · a ${pct(f.got)}`, RING)
        else event.set(t < LQ.go ? 'holding home; the flag is about to jump 30 cm ahead' : `at the flag · cost so far J = ${f.cost.toFixed(1)}`, POWER)
        sub.set(`${t.toFixed(1)} / ${LQ.seconds} s · slowed ${1 / SLOW}× · K from the 5 ms discrete model; the sim adds motor lag and the torque limit`)
      },
      readouts: (p) => {
        const d = lqData(lqParams(p))
        const fell = fellAt(d.run)
        const s = slowest(d.poles)
        return [
          { label: 'Slowest pole', value: poleText(s), tone: s.re > -1 ? 'warn' : 'ok' },
          { label: 'Peak accel asked · tilt', value: `${pct(Math.max(...d.run.map((f) => Math.abs(f.cmd))))} · ${deg(Math.max(...d.run.map((f) => Math.abs(f.tilt))))}`, tone: d.run.some((f) => f.sat) ? 'bad' : undefined },
          { label: 'Rolls back first', value: cm(-d.back) },
          { label: 'Within 1 cm after', value: fell !== null ? `falls at ${fell.toFixed(1)} s` : d.settle === null ? 'not by the push' : `${d.settle.toFixed(2)} s`, tone: fell !== null ? 'bad' : d.settle === null ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
