import * as THREE from 'three/webgpu'
import { ACKERMANN, CarTrackFrame, Pose, Route, XY, errorStats, filleted, frontAxle, pursuitCarRun, pursuitDiffRun, routeOf, stanleyRun, steerAngles } from '../../core/physics'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, addRod, chordPath, diffBot, floorMat, floorView, glowMat, lapseClock, liveLabel, memoBy, placeAt, pointCloud, rcCar, scope, stretchArrow, stretchRod, PLAN_SCOPE, PLAN_VIEW, floorPt, planScope, xyPose } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'
import { cmWhole } from '../../core/units'

const TOP = 7.6
const DT = 0.02
const SHOW_S = 20
const OFFSET = 0.3
const SEMI = Array.from({ length: 17 }, (_, i) => [0.9 + 0.7 * Math.sin((Math.PI * i) / 16), -0.7 * Math.cos((Math.PI * i) / 16)] as XY)
/** Closed course: straight, smooth hairpin, square notch (four sharp corners). */
const COURSE: XY[] = [[-0.6, -0.7], [0.9, -0.7], ...SEMI.slice(1), [-0.1, 0.7], [-0.1, 0.1], [-0.7, 0.1], [-0.7, 0.7], [-1.5, 0.7], [-1.5, -0.7], [-0.6, -0.7]]
const scaled = (k: number): XY[] => COURSE.map(([x, y]) => [x * k, y * k])
const ERR = [0.03, 0.08, 0.15]
const errColor = (e: number) => (Math.abs(e) < ERR[0] ? POWER : Math.abs(e) < ERR[1] ? RING : Math.abs(e) < ERR[2] ? HEAT : HIGH_V)
const ERR_LEGEND = { color: POWER, label: 'Trail coloured by error: < 3 · < 8 · < 15 cm · more', shape: 'dot' as const }
const sCm = (m: number) => (Math.round(m * 100) === 0 ? '0 cm' : `${m > 0 ? '+' : '−'}${cmWhole(Math.abs(m))}`)

/** Floor with the route on the left, status lines over it, error scope on the right. */
function trackStage(scene: THREE.Scene, route: Route, k: number, title: string) {
  const xs = route.pts.map((p) => p[0])
  const ys = route.pts.map((p) => p[1])
  const pad = (0.3 * 5.4) / k
  const fx: [number, number] = [Math.min(...xs) - pad, Math.max(...xs) + pad]
  const fy: [number, number] = [Math.min(...ys) - pad, Math.max(...ys) + pad]
  const g = floorView(scene, [-7.6 - k * (fx[0] + fx[1]) * 0.5, -1.8, 0], k, -0.5)
  floorMat(g, fx, fy)
  const line = chordPath(g, 400, B_FIELD, 0.006 * (5.4 / k), 0.006)
  const drawn = { r: null as Route | null }
  const draw = (r: Route) => {
    if (r !== drawn.r) line((drawn.r = r).pts.map(xyPose))
  }
  draw(route)
  addLabel(g, 'start', [route.pts[0][0], route.pts[0][1] - 0.12 * (5.4 / k), 0.01], B_FIELD, 0.07 * (5.4 / k))
  const trail = pointCloud(g, 900, 0.009 * (5.4 / k))
  const status = liveLabel(scene, [-18.6, TOP + 1.2, 0.3], { size: 0.44, align: 'left' })
  const sub = liveLabel(scene, [-18.6, TOP + 0.4, 0.3], { size: 0.3, color: GREY, align: 'left' })
  const { xRight: tEnd, ...sc } = planScope(scene, title, '0 s', { zeroAt: 0.5 })
  return { g, draw, trail, status, sub, ...sc, tEnd }
}

/** Dots every `step` m of travel, coloured by |e|, as (frame index, point, colour). */
function trailDots<F extends { pose: Pose; e: number }>(run: F[], step: number, at = (f: F) => f.pose as Pose) {
  const out: { i: number; p: Pose; c: string }[] = []
  let last = at(run[0])
  run.forEach((f, i) => {
    const p = at(f)
    if (Math.hypot(p.x - last.x, p.y - last.y) < step) return
    last = p
    out.push({ i, p, c: errColor(f.e) })
  })
  return out
}

/** Error trace (±`span` m) up to frame index `k`. */
function errTrace(tr: ReturnType<ReturnType<typeof scope>['trace']>, run: readonly { e: number }[], k: number, span: number, samples = 240) {
  const us: number[] = []
  const ys: number[] = []
  const stride = Math.max(1, Math.floor(run.length / samples))
  for (let i = 0; i <= k; i += stride) {
    us.push(i / (run.length - 1))
    ys.push((Math.max(-span, Math.min(span, run[i].e)) / span) * (PLAN_SCOPE.h / 2))
  }
  tr.points(us, ys)
}

/** Ring of `n` points round (x, y). */
const ring = (x: number, y: number, r: number, k = 48) => Array.from({ length: k + 1 }, (_, i) => ({ x: x + r * Math.cos((2 * Math.PI * i) / k), y: y + r * Math.sin((2 * Math.PI * i) / k) }))

/** Arc of curvature κ from pose p for length s. */
function arcFrom(p: Pose, kappa: number, s: number, k = 24) {
  return Array.from({ length: k + 1 }, (_, i) => {
    const u = (s * i) / k
    if (Math.abs(kappa) < 1e-6) return { x: p.x + u * Math.cos(p.th), y: p.y + u * Math.sin(p.th) }
    const a = p.th + kappa * u
    return { x: p.x + (Math.sin(a) - Math.sin(p.th)) / kappa, y: p.y - (Math.cos(a) - Math.cos(p.th)) / kappa }
  })
}

// --- Pure pursuit: chase a point one lookahead ahead on the route along the arc through it; diff-drive with lagging wheels. ---

const PP_ROUTE = routeOf(COURSE)
const PP_K = 5.0
const ppParams = (p: Params) => ({ look: n(p, 'look'), v: n(p, 'v'), tau: n(p, 'tau') })
type PpQ = ReturnType<typeof ppParams>
const ppKey = (q: PpQ) => `${q.look}|${q.v}|${q.tau}`
const ppRun = memoBy(ppKey, (q: PpQ) => {
  const seconds = PP_ROUTE.length / q.v + 1
  const run = pursuitDiffRun(PP_ROUTE, { ...q, seconds, offset: OFFSET, dt: DT })
  const wheels: [number, number][] = [[0, 0]]
  for (let i = 1; i < run.length; i++) wheels.push([wheels[i - 1][0] + run[i - 1].vL * DT, wheels[i - 1][1] + run[i - 1].vR * DT])
  const settle = 1 / q.v
  return { run, seconds, wheels, dots: trailDots(run, 0.02), stats: errorStats(run, settle), sat: run.filter((f) => f.sat).length / run.length, settle }
})

export const pathTrackingPurePursuit: Lesson = {
  id: 'path-tracking-pure-pursuit',
  title: 'Pure pursuit',
  tagline: 'Pick a point one lookahead ahead on the route and drive the circle arc that reaches it: short lookahead weaves, long lookahead cuts corners',
  formula: 'goal = where the route leaves a circle of radius L round the robot · y = its sideways offset in the robot frame · κ = 2y / L² · ω = v κ',
  legend: [
    { color: B_FIELD, label: 'Route; lookahead circle of radius L', shape: 'dot' },
    { color: RING, label: 'Goal point and the arc through it', shape: 'dot' },
    { color: HIGH_V, label: 'Cross-track error (robot → route)', shape: 'dot' },
    ERR_LEGEND,
  ],
  points: [
    'A planner hands over a route as a polyline (see Sampling planners). Path tracking turns it into wheel speeds, many times a second. Pure pursuit (Coulter, 1992) is the classic: draw a circle of radius L, the lookahead, round the robot, take the point where the route leaves it, and steer onto the circle arc that starts along the current heading and passes through that point.',
    'Geometry gives the arc in one line. If the goal sits y to the left in the robot frame and L away, the arc through it has curvature κ = 2y / L². A diff-drive then turns at ω = v κ: wheel speeds v ∓ ω·b/2. A car steers δ = atan(wheelbase · κ), the same law shown in Mobility → Ackermann steering.',
    'L is the one knob. Short: the goal is close, κ is large for a small error, so it snaps back fast but over-reacts to lag: here each wheel takes τ to reach its new speed, and with a short L and slow wheels the robot weaves. Long: smooth and calm, but the goal sits round the next corner already, so the robot cuts every corner and the hairpin. Many stacks scale L with speed.',
    'If the robot is further from the route than L, the circle misses it: this version then aims at the closest point. Pure pursuit only ever sees one point, so it ignores the route heading; Line following steers off a sensor instead of a map. The Stanley controller next uses heading error as well.',
  ],
  controls: [
    { kind: 'slider', key: 'look', label: 'Lookahead L', min: 0.1, max: 1, step: 0.05, initial: 0.35, format: (v: number) => cmWhole(v) },
    { kind: 'slider', key: 'v', label: 'Speed v', min: 0.1, max: 0.5, step: 0.05, initial: 0.3, format: (v: number) => `${v.toFixed(2)} m/s` },
    { kind: 'slider', key: 'tau', label: 'Wheel lag τ', min: 0, max: 0.4, step: 0.02, initial: 0.1, format: (v: number) => `${Math.round(v * 1000)} ms` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = trackStage(scene, PP_ROUTE, PP_K, 'cross-track error e (+ = left of the route)')
    const bot = diffBot(s.g)
    const circle = chordPath(s.g, 48, B_FIELD, 0.004, 0.012)
    const arc = chordPath(s.g, 24, RING, 0.005, 0.014)
    const goal = pointCloud(s.g, 1, 0.022)
    const errArrow = stretchArrow(s.g, HIGH_V, 0.006)
    const tr = s.plot.trace(HIGH_V, { samples: 240, radius: 0.08 })
    const clock = lapseClock(1, 1, 0.12)
    const st = { key: '', shown: -1 }
    return {
      scene,
      view: PLAN_VIEW,
      frame(dt, p) {
        const q = ppParams(p)
        const key = ppKey(q)
        const R = ppRun(q)
        const fast = R.seconds / SHOW_S
        const t = clock(dt / SHOW_S, key) * R.seconds
        const k = Math.min(R.run.length - 1, Math.round(t / DT))
        const f = R.run[k]
        if (key !== st.key) {
          st.key = key
          R.dots.forEach((d, i) => s.trail.set(i, floorPt(d.p, 0.006), d.c))
        }
        let shown = 0
        while (shown < R.dots.length && R.dots[shown].i <= k) shown++
        if (shown !== st.shown) s.trail.show((st.shown = shown))
        bot.set(f.pose, R.wheels[k][0], R.wheels[k][1])
        circle(ring(f.pose.x, f.pose.y, q.look))
        goal.set(0, floorPt(f.goal, 0.03), f.hit ? RING : HIGH_V)
        goal.show(1)
        arc(arcFrom(f.pose, f.kappa, Math.min(2.5, Math.hypot(f.goal[0] - f.pose.x, f.goal[1] - f.pose.y) * 1.05)))
        const c = PP_ROUTE.frame(f.pose.x, f.pose.y).at
        errArrow(floorPt(f.pose, 0.03), floorPt(c, 0.03))
        errTrace(tr, R.run, k, 0.3)
        s.cursor(k / (R.run.length - 1))
        s.range.set('± 30 cm · starts 30 cm off the route')
        s.tEnd.set(`${R.seconds.toFixed(0)} s`)
        s.lines[0].set(`e ${sCm(f.e)} · κ ${f.kappa.toFixed(2)} /m → ${Math.abs(f.kappa) < 0.05 ? 'straight' : `turn radius ${cmWhole(1 / Math.abs(f.kappa))}`}`, errColor(f.e))
        s.lines[1].set(`wheels L ${f.vL.toFixed(2)} · R ${f.vR.toFixed(2)} m/s${f.sat ? ' · top speed: both slowed' : ''}`, f.sat ? HEAT : GREY)
        s.lines[2].set(f.hit ? 'goal: where the route leaves the circle' : 'route outside the circle: aiming at the closest point', f.hit ? GREY : HIGH_V)
        s.status.set(`Pure pursuit · L ${cmWhole(q.look)} · t ${f.t.toFixed(1)} s`, LABEL)
        s.sub.set(`TT diff-drive at ${q.v.toFixed(2)} m/s, wheel lag ${Math.round(q.tau * 1000)} ms · one lap at ×${fast.toFixed(1)} speed`)
      },
      readouts: (p) => {
        const R = ppRun(ppParams(p))
        return [
          { label: 'RMS error (after 1 m)', value: cmWhole(R.stats.rms), tone: R.stats.rms < 0.03 ? 'ok' : R.stats.rms < 0.06 ? 'warn' : 'bad' },
          { label: 'Worst error (after 1 m)', value: cmWhole(R.stats.peak), tone: R.stats.peak < 0.08 ? 'ok' : R.stats.peak < 0.15 ? 'warn' : 'bad' },
          { label: 'Wheel at top speed', value: `${Math.round(R.sat * 100)} % of the lap`, tone: R.sat > 0.1 ? 'warn' : undefined },
          { label: 'Lap', value: `${PP_ROUTE.length.toFixed(1)} m in ${(PP_ROUTE.length / ppParams(p).v).toFixed(0)} s` },
        ]
      },
    }
  },
}

// --- Stanley: steer the front wheels by heading error plus atan of the cross-track error at the front axle; pure-pursuit ghost on the same car. ---

const ST_K = 2.8
const ROUTES = { round: 'Corners rounded (r 60 cm)', sharp: 'Sharp corners' }
type RouteKey = keyof typeof ROUTES
const ST_ROUTES: Record<RouteKey, Route> = { round: routeOf(filleted(scaled(1.8), 0.6)), sharp: routeOf(scaled(1.8)) }
const { wheelbase: WB } = ACKERMANN
const stParams = (p: Params) => ({ k: n(p, 'k'), v: n(p, 'v'), look: n(p, 'look'), route: pick(ROUTES, p.route, 'round') as RouteKey })
type StQ = ReturnType<typeof stParams>
const stKey = (q: StQ) => `${q.k}|${q.v}|${q.look}|${q.route}`
const stRun = memoBy(stKey, (q: StQ) => {
  const route = ST_ROUTES[q.route]
  const seconds = route.length / q.v + 1
  const o = { dt: DT, steerRate: 4, lag: 0.08, g: ACKERMANN }
  const st = stanleyRun(route, q.k, q.v, seconds, OFFSET, o)
  const pp = pursuitCarRun(route, q.look, q.v, seconds, OFFSET, o)
  const settle = 1 / q.v
  const lock = (run: CarTrackFrame[]) => run.filter((f) => Math.abs(f.delta) > ACKERMANN.maxSteer * 0.85).length / run.length
  return {
    route,
    st,
    pp,
    seconds,
    dots: trailDots(st, 0.03, (f) => frontAxle(f.pose, WB)),
    ghostDots: trailDots(pp, 0.05),
    stats: { st: errorStats(st, settle), pp: errorStats(pp, settle) },
    lock: lock(st),
  }
})

/** See-through car outline (rear axle at the origin). */
function ghostCar(parent: THREE.Object3D, color: string) {
  const group = add(parent, new THREE.Group())
  const m = glowMat(color, 0.9)
  const [x0, x1, w, z] = [-0.07, 0.33, 0.1, 0.07]
  const c: V3[] = [[x0, w, z], [x1, w, z], [x1 + 0.05, 0, z], [x1, -w, z], [x0, -w, z]]
  c.forEach((a, i) => stretchRod(addRod(group, m), a, c[(i + 1) % c.length], 0.005))
  return group
}

export const pathTrackingStanleyController: Lesson = {
  id: 'path-tracking-stanley-controller',
  title: 'Stanley controller',
  tagline: 'Point the front wheels along the route, then add a turn towards it that grows with the error and shrinks with speed',
  formula: (p) => `δ = ψ + atan(k e / (v₀ + v)) · ψ = route heading − car heading, e = front-axle offset · k = ${n(p, 'k')} /s, v₀ = 0.1 m/s · |δ| ≤ lock`,
  legend: [
    { color: B_FIELD, label: 'Route; its heading at the closest point', shape: 'dot' },
    { color: HIGH_V, label: 'Cross-track error at the front axle', shape: 'dot' },
    { color: GREY, label: 'Ghost: pure pursuit on the same car', shape: 'dot' },
    ERR_LEGEND,
  ],
  points: [
    'Stanford\'s robot car Stanley won the 2005 DARPA Grand Challenge with this law. It works at the front axle, the point the steering actually moves: find the closest route point to it, read the cross-track error e and the route heading there.',
    'Two terms add up. Heading error ψ turns the wheels parallel to the route: on its own, the car would drive alongside it forever. The cross-track term atan(k e / v) turns towards the route; at large error it saturates at ±90°, so the car heads straight at the route instead of circling. Dividing by speed makes it gentler when fast, and the small v₀ keeps it finite when stopped. With no lag, e decays as e^(−k t) along a straight.',
    'The gain k sets how hard it pulls. Low k drifts back slowly and runs wide on the hairpin; high k snaps in but, with the servo here arriving 80 ms late and slewing at 4 rad/s, it starts to weave, especially at speed. Pick sharp corners: at the square notch the route heading jumps 90° in one step. Stanley turns at once, but no car turns on a point, so it overshoots by tens of centimetres. That is why routes are smoothed first (see Sampling planners), with corners no tighter than the car can turn.',
    'The grey ghost is pure pursuit on the same car, starting at the same pose (rear-axle error, lookahead set below). Pure pursuit looks ahead, so it starts each corner early and cuts it; Stanley only looks at the closest point, so it turns late but hugs straight lines tightly. The car model and servo are from Mobility → Ackermann steering.',
  ],
  controls: [
    { kind: 'slider', key: 'k', label: 'Gain k', min: 0.5, max: 10, step: 0.5, initial: 2.5, format: (v: number) => `${v.toFixed(1)} /s` },
    { kind: 'slider', key: 'v', label: 'Speed v', min: 0.3, max: 1.5, step: 0.1, initial: 0.8, format: (v: number) => `${v.toFixed(1)} m/s` },
    { kind: 'slider', key: 'look', label: 'Ghost lookahead L', min: 0.3, max: 1.5, step: 0.1, initial: 0.6, format: (v: number) => cmWhole(v) },
    { kind: 'choice', key: 'route', options: opts(ROUTES), initial: 'round' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const s = trackStage(scene, ST_ROUTES.sharp, ST_K, 'cross-track error e (+ = left of the route)')
    const ghostTrail = pointCloud(s.g, 600, 0.011)
    const car = rcCar(s.g)
    const ghost = ghostCar(s.g, GREY)
    const errArrow = stretchArrow(s.g, HIGH_V, 0.01)
    const tangent = addRod(s.g, glowMat(B_FIELD, 1.2))
    const marks = pointCloud(s.g, 2, 0.03)
    const tSt = s.plot.trace(HIGH_V, { samples: 240, radius: 0.08 })
    const tPp = s.plot.trace(GREY, { samples: 240, radius: 0.06 })
    const clock = lapseClock(1, 1, 0.12)
    const st = { key: '', shown: -1, ghost: -1 }
    const count = (dots: { i: number }[], k: number) => {
      let i = 0
      while (i < dots.length && dots[i].i <= k) i++
      return i
    }
    return {
      scene,
      view: PLAN_VIEW,
      frame(dt, p) {
        const q = stParams(p)
        const key = stKey(q)
        const R = stRun(q)
        s.draw(R.route)
        const t = clock(dt / SHOW_S, key) * R.seconds
        const k = Math.min(R.st.length - 1, Math.round(t / DT))
        const f = R.st[k]
        const g = R.pp[k]
        if (key !== st.key) {
          st.key = key
          R.dots.forEach((d, i) => s.trail.set(i, floorPt(d.p, 0.006), d.c))
          R.ghostDots.forEach((d, i) => ghostTrail.set(i, floorPt(d.p, 0.005), GREY, 0.8))
        }
        const a = count(R.dots, k)
        const b = count(R.ghostDots, k)
        if (a !== st.shown) s.trail.show((st.shown = a))
        if (b !== st.ghost) ghostTrail.show((st.ghost = b))
        const travel = q.v * f.t
        car.set(f.pose, steerAngles(f.delta, 'ackermann'), [travel, travel, travel, travel])
        placeAt(ghost, g.pose)
        const fa = frontAxle(f.pose, WB)
        errArrow(floorPt(fa, 0.04), floorPt(f.target, 0.04))
        const dir = R.route.frame(f.target[0], f.target[1]).dir
        const h = 0.3
        stretchRod(tangent, [f.target[0] - h * Math.cos(dir), f.target[1] - h * Math.sin(dir), 0.012], [f.target[0] + h * Math.cos(dir), f.target[1] + h * Math.sin(dir), 0.012], 0.006)
        marks.set(0, floorPt(f.target, 0.03), B_FIELD)
        marks.set(1, floorPt(g.target, 0.03), GREY, 0.7)
        marks.show(2)
        errTrace(tSt, R.st, k, 0.5)
        errTrace(tPp, R.pp, k, 0.5)
        s.cursor(k / (R.st.length - 1))
        s.range.set('± 50 cm · red Stanley · grey pure pursuit')
        s.tEnd.set(`${R.seconds.toFixed(0)} s`)
        const deg = (r: number) => `${r >= 0 ? '+' : '−'}${Math.abs(Math.round((r * 180) / Math.PI))}°`
        s.lines[0].set(`ψ ${deg(f.head)} + atan(k e / v) ${deg(f.cross)} → δ ${deg(f.delta)}${Math.abs(f.delta) > ACKERMANN.maxSteer * 0.85 ? ' (at lock)' : ''}`, LABEL)
        s.lines[1].set(`Stanley e ${sCm(f.e)}`, errColor(f.e))
        s.lines[2].set(`pure pursuit e ${sCm(g.e)} (L ${cmWhole(q.look)})`, GREY)
        s.status.set(`Stanley · k ${q.k.toFixed(1)} · t ${f.t.toFixed(1)} s`, LABEL)
        s.sub.set(`1/10 RC car at ${q.v.toFixed(1)} m/s, servo 80 ms late · ${R.route.length.toFixed(1)} m lap at ×${(R.seconds / SHOW_S).toFixed(1)} speed`)
      },
      readouts: (p) => {
        const R = stRun(stParams(p))
        const tone = (e: number) => (e < 0.05 ? 'ok' : e < 0.12 ? 'warn' : 'bad') as 'ok' | 'warn' | 'bad'
        return [
          { label: 'RMS error: Stanley', value: cmWhole(R.stats.st.rms), tone: tone(R.stats.st.rms) },
          { label: 'RMS error: pure pursuit', value: cmWhole(R.stats.pp.rms), tone: tone(R.stats.pp.rms) },
          { label: 'Worst: Stanley vs PP', value: `${cmWhole(R.stats.st.peak)} vs ${cmWhole(R.stats.pp.peak)}` },
          { label: 'Steering near lock', value: `${Math.round(R.lock * 100)} % of the lap`, tone: R.lock > 0.15 ? 'warn' : undefined },
        ]
      },
    }
  },
}
