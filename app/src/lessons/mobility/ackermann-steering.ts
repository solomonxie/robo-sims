import * as THREE from 'three/webgpu'
import {
  ACKERMANN,
  DEG,
  Pose,
  SteerGeo,
  axleHits,
  bicycleIcc,
  bicycleRadius,
  bicycleStep,
  frontSlip,
  minTurn,
  parkPlan,
  parkPoseAt,
  polyPath,
  pursuitRun,
  spoolScrub,
  steerAngles,
  toDeg,
  wheelSpeeds,
  wrapPi,
} from '../../core/physics'
import { mmText } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  addRod,
  floorMat,
  floorTrail,
  floorView,
  glowMat,
  liveLabel,
  memoBy,
  pointCloud,
  rcCar,
  stretchArrow,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const { wheelbase: L, track: T } = ACKERMANN
const OFF = 0.022
const deg = (a: number) => `${Math.round(toDeg(a))}°`.replace('-', '−')
const metres = (m: number) => (Number.isFinite(m) ? `${Math.abs(m).toFixed(2)} m` : '∞')
const signed = (v: number, d = 2) => `${v < -1e-9 ? '−' : '+'}${Math.abs(v).toFixed(d)}`

// --- Steering geometry: servo → tie rods → steering arms; inner wheel turns more so both axles meet at one ICC; scrub, lock radius, rear differential. ---

const GEOS: Record<SteerGeo, string> = { ackermann: 'Ackermann', parallel: 'Parallel', anti: 'Anti-Ackermann' }
const REARS = { diff: 'Differential', spool: 'Locked axle' }
const SWEEP = { sweep: 'Auto sweep', hold: 'Hold steer' }
const SG = { at: [0.8, -3.4, 0] as V3, k: 19, y: [-0.36, 0.86] as [number, number], x: [-0.17, 0.44] as [number, number], v: 0.4, period: 7, cx: 8.6, cy: -3, ck: 0.1 }
const ARM_BETA: Record<SteerGeo, number> = { ackermann: Math.atan(T / 2 / L), parallel: 0, anti: -Math.atan(T / 2 / L) }
const sgParams = (p: Params) => ({
  geo: pick(GEOS, p.geo, 'ackermann'),
  spool: pick(REARS, p.rear, 'diff') === 'spool',
  sweep: pick(SWEEP, p.mode, 'sweep') === 'sweep',
  steer: n(p, 'steer') * DEG,
  lock: n(p, 'lock') * DEG,
})
type SgQ = ReturnType<typeof sgParams>
/** Centre steer δ that puts the inner wheel at the servo lock, per linkage. */
const lockDelta = (q: SgQ) => {
  let d = minTurn(q.lock).delta
  if (q.geo === 'parallel') d = q.lock
  if (q.geo === 'anti') d = Math.atan(L / (L / Math.tan(q.lock) - T / 2))
  return d
}
const sgDelta = (q: SgQ, t: number) => {
  const max = lockDelta(q)
  return q.sweep ? max * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / SG.period)) : Math.max(-max, Math.min(max, q.steer))
}
function sgState(q: SgQ, delta: number) {
  const angles = steerAngles(delta, q.geo)
  const R = bicycleRadius(delta, L)
  const hits = axleHits(angles)
  const slip = frontSlip(angles, R)
  const [fl, fr, rl, rr] = wheelSpeeds(SG.v, delta)
  const rearScrub = q.spool ? spoolScrub(SG.v, delta) : [0, 0]
  const inner = delta >= 0 ? 0 : 1
  return { angles, R, hits, slip, speeds: q.spool ? [fl, fr, SG.v, SG.v] : [fl, fr, rl, rr], rearScrub, inner, miss: Number.isFinite(hits[0]) ? Math.abs(hits[0] - hits[1]) : 0 }
}

export const steeringGeometry: Lesson = {
  id: 'ackermann-steering-steering-geometry',
  title: 'Steering geometry',
  tagline: 'Inner wheel turns more: all four roll round one centre',
  formula: (p) => {
    const q = sgParams(p)
    const s = sgState(q, sgDelta(q, q.sweep ? SG.period / 2 : 0))
    return `R = L / tan δ · Ackermann: tan δi = L / (R − T/2), tan δo = L / (R + T/2) · L ${mmText(L)}, T ${mmText(T)} → ${GEOS[q.geo]}: inner ${deg(Math.abs(s.angles[s.inner]))}, outer ${deg(Math.abs(s.angles[1 - s.inner]))}`
  },
  legend: [
    { color: B_FIELD, label: 'Servo, centre link, tie rods', shape: 'dot' },
    { color: RING, label: 'Wheel axle lines; one crossing = ICC', shape: 'dot' },
    { color: POWER, label: 'Path and speed of each wheel', shape: 'dot' },
    { color: HIGH_V, label: 'Tyre scrubbing sideways', shape: 'dot' },
  ],
  points: [
    'A car turns about one point, the instantaneous centre of curvature (ICC). Its rear wheels cannot steer, so the ICC lies on the rear axle line, and every wheel must roll at right angles to the line from it to the ICC. The inner front wheel is closer, so it has to turn more than the outer one: tan δi = L / (R − T/2), tan δo = L / (R + T/2).',
    'One servo does it: its horn pushes a centre link sideways, tie rods pull the steering arms on each knuckle. Angle both arms in so their lines meet near the rear axle centre (a trapezoid) and the inner wheel automatically gains angle. Parallel arms give both wheels the same angle; arms angled out (anti-Ackermann) turn the outer wheel more.',
    'If the axle lines miss each other, the front tyres want different circles and one of them is dragged sideways: scrub. That wears tyres, wastes power and pushes the nose wide at low speed. Racing cars use some anti-Ackermann on purpose: at speed the loaded outer tyre does the work and needs the larger slip angle.',
    'Full lock sets the tightest turn: rear-axle radius R = L / tan δi,max + T/2, and the outer front wheel sweeps √(L² + (R + T/2)²), the kerb-to-kerb radius. A longer wheelbase or less lock means a bigger circle. On the rear axle the outer wheel covers more ground than the inner, so a differential lets them turn at different speeds; a locked axle (spool) makes one of them skip.',
  ],
  controls: [
    { kind: 'choice', key: 'geo', options: opts(GEOS), initial: 'ackermann' },
    { kind: 'choice', key: 'rear', options: opts(REARS), initial: 'diff' },
    { kind: 'choice', key: 'mode', options: opts(SWEEP), initial: 'sweep' },
    { kind: 'slider', key: 'steer', label: 'Steer δ (+ = left)', min: -35, max: 35, step: 1, initial: 20, format: (v) => `${v}°` },
    { kind: 'slider', key: 'lock', label: 'Servo lock (inner wheel)', min: 20, max: 45, step: 1, initial: 30, format: (v) => `${v}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17, 6.6, 0.3], { size: 0.42, align: 'left' })
    const sub = liveLabel(scene, [-17, 5.7, 0.3], { size: 0.3, color: GREY, align: 'left' })
    const event = liveLabel(scene, [-17, 4.9, 0.3], { size: 0.32, align: 'left' })

    const g = floorView(scene, SG.at, SG.k, -0.55)
    const f = add(g, new THREE.Group())
    f.rotation.z = Math.PI / 2
    floorMat(f, SG.x, SG.y)
    const car = rcCar(f)
    const [y0, y1] = SG.y
    const z = 0.004
    stretchRod(addRod(f, glowMat(GREY, 0.35)), [0, y0, z], [0, y1, z], 0.003)
    const axisRods = [0, 1].map(() => addRod(f, glowMat(RING, 0.8)))
    const icc = pointCloud(f, 3, 0.012)
    const iccTag = liveLabel(f, [0, 0, 0.01], { size: 0.03, color: RING })
    iccTag.group.rotation.z = -Math.PI / 2
    const NP = 26
    const paths = pointCloud(f, 4 * NP, 0.0045)
    const tags = [0, 1, 2, 3].map(() => {
      const t = liveLabel(f, [0, 0, 0.01], { size: 0.022 })
      t.group.rotation.z = -Math.PI / 2
      return t
    })
    const wheelAt: [number, number][] = [
      [L, T / 2 + OFF],
      [L, -T / 2 - OFF],
      [0, T / 2 + OFF],
      [0, -T / 2 - OFF],
    ]

    const { cx, cy, ck } = SG
    const C = (outer: number, inner: number): V3 => [cx + toDeg(outer) * ck, cy + toDeg(inner) * ck, 0.1]
    const axM = glowMat(GREY, 0.35)
    stretchRod(addRod(scene, axM), C(0, 0), C(45 * DEG, 0), 0.025)
    stretchRod(addRod(scene, axM), C(0, 0), C(0, 45 * DEG), 0.025)
    addLabel(scene, 'inner vs outer wheel', [cx - 0.4, cy + 45 * ck + 0.9, 0.3], LABEL, 0.32, 'left')
    addLabel(scene, 'outer 45°', [cx + 45 * ck, cy - 0.5, 0.3], GREY, 0.24, 'right')
    const curves = (Object.keys(GEOS) as SteerGeo[]).map((geo) => {
      const c = pointCloud(scene, 60, 0.05)
      return { geo, c, tag: liveLabel(scene, [0, 0, 0.3], { size: 0.24, align: geo === 'ackermann' ? 'right' : 'left' }) }
    })
    const lockLine = addRod(scene, glowMat(HIGH_V, 0.5))
    const lockTag = liveLabel(scene, [cx + 50 * ck, 0, 0.3], { size: 0.24, color: HIGH_V, align: 'right' })
    const nowDot = pointCloud(scene, 1, 0.16)

    const st = { key: '', geoKey: '', t: 0, travel: [0, 0, 0, 0], flow: [0, 0, 0, 0], last: '' }
    return {
      scene,
      view: { center: [-2.2, -0.4, 0], radius: 52, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = sgParams(p)
        const key = `${q.geo}|${q.sweep}|${q.lock}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          car.arms(ARM_BETA[q.geo])
          curves.forEach(({ geo, c, tag }) => {
            const col = geo === q.geo ? RING : GREY
            const max = lockDelta({ ...q, geo })
            for (let i = 0; i < 60; i++) {
              const a = steerAngles((i / 59) * max, geo)
              c.set(i, C(a[1], a[0]), col, a[1] > 46 * DEG ? 0 : geo === q.geo ? 1 : 0.6)
            }
            c.show(60)
            const mid = steerAngles(max * (geo === 'ackermann' ? 1 : geo === 'anti' ? 0.75 : 0.5), geo)
            const at = C(mid[1], mid[0])
            const [dx, dy] = geo === 'ackermann' ? [-0.1, 0.3] : geo === 'anti' ? [0.25, -0.3] : [0.3, -0.2]
            tag.group.position.set(at[0] + dx, at[1] + dy, 0.3)
            tag.set(geo === 'ackermann' ? GEOS[geo] : geo, col)
          })
          stretchRod(lockLine, C(0, q.lock), C(45 * DEG, q.lock), 0.02)
          lockTag.group.position.set(cx - 0.2, cy + toDeg(q.lock) * ck, 0.3)
          lockTag.set(`lock ${deg(q.lock)}`, HIGH_V)
        }
        st.t += dt
        const delta = sgDelta(q, st.t)
        const s = sgState(q, delta)
        s.speeds.forEach((v, i) => {
          st.travel[i] += v * dt
          st.flow[i] = (st.flow[i] + v * dt) % 0.04
        })
        car.set({ x: 0, y: 0, th: 0 }, s.angles, st.travel)
        const scrubU = [...s.slip.map((a) => Math.min(1, Math.abs(a) / (3 * DEG))), ...s.rearScrub.map((v) => Math.min(1, v / (0.05 * SG.v)))]
        car.scrub(scrubU)

        const side = delta >= 0 ? y1 : y0
        const clipY = (y: number) => Math.max(y0, Math.min(y1, y))
        s.angles.forEach((a, i) => {
          const ky = (i ? -1 : 1) * (T / 2)
          const hit = s.hits[i]
          let end: V3 = Number.isFinite(hit) ? [0, hit, z] : [L, side, z]
          if (Number.isFinite(hit) && (hit < y0 || hit > y1)) {
            const u = (clipY(hit) - ky) / (hit - ky)
            end = [L * (1 - u), clipY(hit), z]
          }
          stretchRod(axisRods[i], [L, ky, z + 0.001 * i], end, 0.0025)
        })
        const inView = (y: number) => Number.isFinite(y) && y >= y0 && y <= y1
        const pts: [number, number, string][] = []
        if (inView(s.R)) pts.push([0, s.R, RING])
        if (q.geo !== 'ackermann') s.hits.forEach((h) => inView(h) && pts.push([0, h, HIGH_V]))
        pts.forEach(([x, y, c], i) => icc.set(i, [x, y, 0.012], c, c === RING ? 1 : 0.7))
        icc.show(pts.length)
        const tagY = Number.isFinite(s.R) ? clipY(s.R) : side
        iccTag.group.position.set(-0.11, tagY + (inView(s.R) ? 0 : delta >= 0 ? -0.12 : 0.12), 0.012)
        iccTag.set(Number.isFinite(s.R) ? `${inView(s.R) ? '' : delta >= 0 ? '← ' : ''}ICC R ${metres(s.R)}${inView(s.R) || delta >= 0 ? '' : ' →'}` : 'straight: ICC at ∞', RING)

        const centres: [number, number][] = [
          [0, s.hits[0]],
          [0, s.hits[1]],
          [0, s.R],
          [0, s.R],
        ]
        let np = 0
        wheelAt.forEach(([wx, wy], i) => {
          const [ox, oy] = centres[i]
          const rx = wx - ox
          const ry = wy - oy
          const r = Math.hypot(rx, ry)
          const sg = Math.sign(oy)
          const fast = Math.abs(s.speeds[i]) / SG.v
          for (let j = 0; j < NP; j++) {
            const d = j * 0.04 + st.flow[i]
            let px = wx + d
            let py = wy
            if (Number.isFinite(oy)) {
              const phi = (d / r) * sg
              px = ox + rx * Math.cos(phi) - ry * Math.sin(phi)
              py = oy + rx * Math.sin(phi) + ry * Math.cos(phi)
            }
            if (px < SG.x[1] && py > y0 && py < y1) paths.set(np++, [px, py, 0.006], POWER, 0.6 + 0.6 * Math.max(0, fast - 0.8))
          }
          const out = (i % 2 ? -1 : 1) * 0.07
          tags[i].group.position.set(wx + (i < 2 ? 0.05 : -0.05), wy + out, 0.012)
          const blocked = scrubU[i] > 0.3
          tags[i].set(`${Math.round(fast * 100)} %`, blocked ? HIGH_V : POWER)
        })
        paths.show(np)

        const inner = Math.abs(s.angles[s.inner])
        const outer = Math.abs(s.angles[1 - s.inner])
        nowDot.set(0, [...C(outer, inner).slice(0, 2), 0.2] as V3, Math.abs(delta) < 1e-6 ? GREY : RING)
        nowDot.show(1)
        const word = `${GEOS[q.geo]} · ${Math.abs(delta) < 0.5 * DEG ? 'straight' : `δ ${deg(Math.abs(delta))} ${delta > 0 ? 'left' : 'right'}`}`
        if (word !== st.last) {
          st.last = word
          status.set(word, LABEL)
        }
        const maxSlip = Math.max(...s.slip.map(Math.abs))
        const parts = [
          maxSlip > 0.5 * DEG ? `front tyres scrub ${deg(maxSlip)}, axle lines miss by ${mmText(s.miss)}` : Math.abs(delta) > 0.5 * DEG ? 'axle lines meet at one ICC: no scrub' : '',
          q.spool && Math.abs(delta) > 0.5 * DEG ? `locked axle: rear tyres skip ${Math.round((Math.max(...s.rearScrub) / SG.v) * 100)} %` : '',
        ].filter(Boolean)
        event.set(parts.join(' · ') || 'wheels straight: ICC at infinity', maxSlip > 0.5 * DEG || (q.spool && Math.abs(delta) > 0.5 * DEG) ? HIGH_V : RING)
        sub.set(`${q.sweep ? `sweep ${(st.t % SG.period).toFixed(1)} / ${SG.period} s · ` : ''}rolling ${SG.v} m/s · real time · 0.5 m tape`)
      },
      readouts: (p) => {
        const q = sgParams(p)
        const m = minTurn(q.lock)
        const s = sgState(q, q.sweep ? lockDelta(q) : sgDelta(q, 0))
        const [, , rl, rr] = wheelSpeeds(1, q.sweep ? lockDelta(q) : sgDelta(q, 0))
        const [ri, ro] = s.inner ? [rr, rl] : [rl, rr]
        return [
          { label: q.sweep ? 'Lock: inner · outer' : 'Inner · outer', value: `${deg(Math.abs(s.angles[s.inner]))} · ${deg(Math.abs(s.angles[1 - s.inner]))}` },
          { label: 'Axle lines miss by', value: q.geo === 'ackermann' ? '0 mm' : mmText(s.miss), tone: q.geo === 'ackermann' ? 'ok' : 'warn' },
          { label: 'Tightest turn · kerb', value: `${metres(m.rear)} · ${metres(m.outer)}` },
          { label: 'Rear inner · outer', value: q.spool ? '100 % · 100 %' : `${Math.round(ri * 100)} % · ${Math.round(ro * 100)} %`, tone: q.spool ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Bicycle model: one front and one rear wheel, (x, y, θ) from v and δ; no sideways motion → multi-point parallel parking; pure pursuit. ---

const BM_MODES = { circle: 'Hold steer', follow: 'Follow path', park: 'Parallel park' }
const BM = { at: [-2.4, -2.3, 0] as V3, k: 6.2, fx: [-1.75, 1.75] as [number, number], fy: [-1.05, 1.05] as [number, number], parkV: 0.25, shift: 0.27, slotY: -0.66, slotX: 0.25, back: 0.07, seconds: 24, parkK: 10.5 }
const bmParams = (p: Params) => ({ mode: pick(BM_MODES, p.mode, 'follow'), steer: n(p, 'steer') * DEG, v: n(p, 'v'), look: n(p, 'look'), room: n(p, 'room') })
type BmQ = ReturnType<typeof bmParams>
const arc = (cx: number, a0: number, a1: number, r: number, k: number) =>
  Array.from({ length: k }, (_, i) => [cx + r * Math.cos(a0 + ((a1 - a0) * i) / k), r * Math.sin(a0 + ((a1 - a0) * i) / k)] as [number, number])
const TRACK: [number, number][] = [
  ...Array.from({ length: 16 }, (_, i) => [-0.85 + (1.7 * i) / 16, -0.7 + 0.12 * Math.sin((Math.PI * i) / 16) ** 2] as [number, number]),
  ...arc(0.85, -Math.PI / 2, Math.PI / 2, 0.7, 24),
  ...Array.from({ length: 8 }, (_, i) => [0.85 - (1.7 * i) / 8, 0.7] as [number, number]),
  ...arc(-0.85, Math.PI / 2, (3 * Math.PI) / 2, 0.7, 24),
  [-0.85, -0.7],
]
const TRACK_PATH = polyPath(TRACK)
const followRun = memoBy(
  (q: BmQ) => `${q.look}|${q.v}`,
  (q: BmQ) => pursuitRun(TRACK, q.look, q.v, BM.seconds),
)
const { rear: R_MIN, delta: D_MAX } = minTurn(ACKERMANN.maxSteer)
function parkSetup(room: number) {
  const plan = parkPlan(BM.shift, room, R_MIN, L)
  const slot = ACKERMANN.length + room
  const xa = BM.slotX - slot / 2 + BM.back
  const start: Pose = { x: xa + plan.travel, y: BM.slotY + BM.shift, th: 0 }
  const total = plan.moves.reduce((s, m) => s + m.len, 0) / BM.parkV
  return { plan, slot, start, total, cycle: total + 2 }
}
const circleStart = (delta: number): Pose => {
  const R = bicycleRadius(delta, L)
  return Number.isFinite(R) ? { x: 0, y: -R, th: 0 } : { x: BM.fx[0] + 0.3, y: 0, th: 0 }
}
const insideFloor = (p: Pose, m: number) => p.x > BM.fx[0] + m && p.x < BM.fx[1] - m && p.y > BM.fy[0] + m && p.y < BM.fy[1] - m

export const bicycleModel: Lesson = {
  id: 'ackermann-steering-bicycle-model',
  title: 'Bicycle model',
  tagline: 'Two wheels, three numbers: x, y and heading',
  formula: () => `ẋ = v cos θ · ẏ = v sin θ · θ̇ = v tan δ / L, L = ${mmText(L)} · sideways speed always 0 · pure pursuit: δ = atan(2L sin α / ld)`,
  legend: [
    { color: RING, label: 'Bicycle: one front, one rear wheel; its ICC', shape: 'dot' },
    { color: POWER, label: 'Path driven (rear-axle centre)', shape: 'dot' },
    { color: B_FIELD, label: 'Target path; carrot ld ahead', shape: 'dot' },
    { color: HIGH_V, label: 'Sideways: the move a car cannot make', shape: 'dot' },
  ],
  points: [
    'Planning with four wheels is messy, but with Ackermann geometry they all agree on one ICC, so merge each axle into one wheel on the centreline: the bicycle model. Track the rear-axle centre: pose (x, y, θ), inputs speed v and steer angle δ. The car moves along its heading and turns at θ̇ = v tan δ / L, around a circle of radius L / tan δ.',
    'Each step: x += v cos θ · dt, y += v sin θ · dt, θ += v tan δ / L · dt. Three numbers of pose but only two inputs, and the rear wheel can never slide sideways: v_side = 0. That is a nonholonomic constraint, and it is why a car can reach any (x, y, θ) only by driving there, never straight across.',
    'Parallel parking shows it. Shifting sideways by d takes an S: arc one way, arc back, each of angle φ, for a lateral step 2R(1 − cos φ) and a fore-aft travel 2R sin φ. A short slot limits φ, so each S shifts less and the car needs more moves, alternating reverse and forward. Change the spare room and count the moves.',
    'To follow a path, pure pursuit picks a carrot point ld ahead on the path and steers onto the arc through it: δ = atan(2L sin α / ld), α the bearing to the carrot. Short lookahead tracks tightly but weaves and saturates the lock; long lookahead is smooth but cuts corners. Here each command reaches the servo 80 ms late and it slews at 4 rad/s: at speed a short lookahead overshoots, weaves and pins the steering at lock.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(BM_MODES), initial: 'follow' },
    { kind: 'slider', key: 'steer', label: 'Steer δ (+ = left)', min: -25, max: 25, step: 1, initial: 18, format: (v) => `${v}°` },
    { kind: 'slider', key: 'v', label: 'Speed v', min: 0.2, max: 1.2, step: 0.1, initial: 0.6, format: (v) => `${v.toFixed(1)} m/s` },
    { kind: 'slider', key: 'look', label: 'Lookahead ld', min: 0.15, max: 1, step: 0.05, initial: 0.45, format: (v) => `${Math.round(v * 1000)} mm` },
    { kind: 'slider', key: 'room', label: 'Spare room in the slot', min: 0.2, max: 0.8, step: 0.04, initial: 0.4, format: (v) => `${Math.round(v * 1000)} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17, 6.6, 0.3], { size: 0.42, align: 'left' })
    const sub = liveLabel(scene, [-17, 5.7, 0.3], { size: 0.3, color: GREY, align: 'left' })
    const event = liveLabel(scene, [-17, 4.9, 0.3], { size: 0.32, align: 'left' })
    const pose = liveLabel(scene, [-17, 4.1, 0.3], { size: 0.3, align: 'left' })

    const g = floorView(scene, BM.at, BM.k, -0.55)
    const floors = [add(g, new THREE.Group()), add(g, new THREE.Group())]
    floorMat(floors[0], BM.fx, BM.fy)
    floorMat(floors[1], [-0.75, 1.25], [-0.95, 0.1])
    const zoom = (k: number, cx: number, cy: number) => {
      g.scale.setScalar(k)
      g.position.set(BM.at[0] - k * cx, BM.at[1] - k * cy * Math.cos(0.55), BM.at[2] + k * cy * Math.sin(0.55))
    }
    const trail = floorTrail(g, 500, 0.02, POWER)
    const target = pointCloud(g, 160, 0.008)
    const car = rcCar(g)
    const zb = 0.1
    const ringM = glowMat(RING, 1)
    const spine = addRod(car.group, ringM)
    stretchRod(spine, [0, 0, zb], [L, 0, zb], 0.006)
    const rearW = box(car.group, [0.07, 0.014, 0.004], ringM, [0, 0, zb])
    rearW.castShadow = false
    const frontW = add(car.group, new THREE.Group(), [L, 0, zb])
    box(frontW, [0.07, 0.014, 0.004], ringM, [0, 0, 0]).castShadow = false
    const iccRods = [0, 1].map(() => addRod(g, glowMat(RING, 0.5)))
    const iccDot = pointCloud(g, 1, 0.02)
    const carrot = pointCloud(g, 1, 0.022)
    const carrotRod = addRod(g, glowMat(B_FIELD, 0.7))
    const sideArrow = stretchArrow(g, HIGH_V, 0.008)
    const cross = [0, 1].map(() => addRod(g, glowMat(HIGH_V, 0.9)))
    const parkedM = mat('#5a5f69', { rough: 0.6 })
    const parked = [0, 1].map(() => box(g, [ACKERMANN.length, ACKERMANN.width, 0.06], parkedM, [0, 0, 0.03]))
    const kerb = box(g, [2, 0.04, 0.03], mat('#9aa0aa', { rough: 0.7 }), [BM.slotX, BM.slotY - 0.17, 0.015])

    const st = { key: '', t: 0, pose: { x: 0, y: 0, th: 0 } as Pose, delta: 0, travel: [0, 0, 0, 0], lap: -1, last: '' }
    const hide = (o: THREE.Object3D, v: boolean) => (o.visible = v)
    return {
      scene,
      view: { center: [-2.2, -0.4, 0], radius: 52, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = bmParams(p)
        const key = `${q.mode}|${q.steer}|${q.v}|${q.look}|${q.room}`
        const park = q.mode === 'park' ? parkSetup(q.room) : undefined
        if (key !== st.key) {
          st.key = key
          Object.assign(st, { t: 0, lap: -1, last: '', delta: 0, pose: q.mode === 'circle' ? circleStart(q.steer) : st.pose })
          trail.clear()
          const show = q.mode === 'follow'
          if (show) {
            for (let i = 0; i < 160; i++) {
              const pt = TRACK_PATH.at((i / 160) * TRACK_PATH.length)
              target.set(i, [pt[0], pt[1], 0.003], B_FIELD, 0.6)
            }
            target.show(160)
          } else target.show(0)
          floors[0].visible = !park
          floors[1].visible = !!park
          if (park) zoom(BM.parkK, BM.slotX, BM.slotY + 0.25)
          else zoom(BM.k, 0, 0)
          parked.forEach((b) => hide(b, !!park))
          hide(kerb, !!park)
          if (park) {
            parked[0].position.set(BM.slotX + park.slot / 2 + ACKERMANN.length / 2, BM.slotY + 0, 0.03)
            parked[1].position.set(BM.slotX - park.slot / 2 - ACKERMANN.length / 2, BM.slotY, 0.03)
          }
        }
        st.t += dt
        const prev = st.pose
        let moveText = ''
        let carrotAt: [number, number] | undefined
        let err = 0
        if (q.mode === 'circle') {
          st.delta = q.steer
          st.pose = bicycleStep(st.pose, q.v, st.delta, L, dt)
          if (!insideFloor(st.pose, 0.15)) {
            st.pose = circleStart(q.steer)
            trail.clear()
          }
        } else if (q.mode === 'follow') {
          const run = followRun(q)
          const lap = Math.floor(st.t / BM.seconds)
          if (lap !== st.lap) {
            st.lap = lap
            trail.clear()
          }
          const fr = run[Math.min(run.length - 1, Math.floor((st.t % BM.seconds) / 0.01))]
          st.pose = fr.pose
          st.delta = fr.delta
          carrotAt = fr.carrot
          err = fr.err
        } else if (park) {
          const u = st.t % park.cycle
          const lap = Math.floor(st.t / park.cycle)
          if (lap !== st.lap) {
            st.lap = lap
            trail.clear()
          }
          const tm = Math.max(0, u - 0.6)
          const r = parkPoseAt(park.start, park.plan.moves, BM.parkV, L, tm)
          st.pose = r.pose
          st.delta = u < 0.6 || !r.move ? 0 : r.move.delta
          moveText = u < 0.6 ? 'start alongside' : r.move ? `move ${Math.floor(r.i / 2) + 1} / ${park.plan.k} · ${r.move.dir < 0 ? 'reverse' : 'forward'}, full ${r.move.delta < 0 ? 'right' : 'left'} lock` : 'parked'
        }
        const ds = (Math.cos(st.pose.th) * (st.pose.x - prev.x) + Math.sin(st.pose.th) * (st.pose.y - prev.y)) || 0
        const v = q.mode === 'park' ? (st.delta === 0 && !moveText.startsWith('move') ? 0 : Math.sign(ds) * BM.parkV) : q.v
        const ang = steerAngles(st.delta, 'ackermann')
        wheelSpeeds(ds, st.delta).forEach((w, i) => (st.travel[i] += w))
        car.set(st.pose, ang, st.travel)
        frontW.rotation.z = st.delta
        if (Math.hypot(st.pose.x - prev.x, st.pose.y - prev.y) < 0.2) trail.add(prev, st.pose)

        const c = bicycleIcc(st.pose, st.delta, L)
        const [ct, sn] = [Math.cos(st.pose.th), Math.sin(st.pose.th)]
        const front: V3 = [st.pose.x + L * ct, st.pose.y + L * sn, 0.012]
        if (c && Math.hypot(c[0] - st.pose.x, c[1] - st.pose.y) < 2.2) {
          stretchRod(iccRods[0], [st.pose.x, st.pose.y, 0.012], [c[0], c[1], 0.012], 0.004)
          stretchRod(iccRods[1], front, [c[0], c[1], 0.012], 0.004)
          iccDot.set(0, [c[0], c[1], 0.014], RING)
          iccDot.show(1)
        } else {
          iccRods.forEach((r) => (r.visible = false))
          iccDot.show(0)
        }
        carrot.show(carrotAt ? 1 : 0)
        carrotRod.visible = !!carrotAt
        if (carrotAt) {
          carrot.set(0, [carrotAt[0], carrotAt[1], 0.014], B_FIELD)
          stretchRod(carrotRod, [st.pose.x, st.pose.y, 0.013], [carrotAt[0], carrotAt[1], 0.013], 0.003)
        }
        const sideLen = park ? BM.shift : 0.16
        const tail: V3 = park ? [park.start.x + 0.13, park.start.y, 0.12] : [st.pose.x + 0.13 * ct, st.pose.y + 0.13 * sn, 0.12]
        const tip: V3 = park ? [tail[0], tail[1] - sideLen, 0.12] : [tail[0] + sideLen * sn, tail[1] - sideLen * ct, 0.12]
        const showSide = !park || st.t % park.cycle < 0.6
        sideArrow(tail, showSide ? tip : tail)
        const xc: V3 = [(tail[0] + tip[0]) / 2, (tail[1] + tip[1]) / 2, 0.13]
        cross.forEach((r, i) => {
          const a = Math.PI / 4 + (i * Math.PI) / 2
          stretchRod(r, [xc[0] - 0.035 * Math.cos(a), xc[1] - 0.035 * Math.sin(a), xc[2]], [xc[0] + 0.035 * Math.cos(a), xc[1] + 0.035 * Math.sin(a), xc[2]], 0.004)
          r.visible = showSide
        })

        const w = (v * Math.tan(st.delta)) / L
        pose.set(`x ${signed(st.pose.x)} · y ${signed(st.pose.y)} m · θ ${deg(wrapPi(st.pose.th))} · v ${signed(v)} m/s · ω = v tan δ / L = ${signed(w)} rad/s`, RING)
        const word = `${BM_MODES[q.mode]} · δ ${Math.abs(st.delta) < 0.5 * DEG ? '0°' : `${deg(Math.abs(st.delta))} ${st.delta > 0 ? 'left' : 'right'}`}`
        if (word !== st.last) {
          st.last = word
          status.set(word, LABEL)
        }
        if (q.mode === 'circle') event.set(Number.isFinite(bicycleRadius(q.steer, L)) ? `circle R = L / tan δ = ${metres(bicycleRadius(q.steer, L))} · sideways speed 0` : 'δ = 0: straight line, ICC at infinity', RING)
        else if (q.mode === 'follow') event.set(`cross-track ${mmText(err)} · ${Math.abs(st.delta) >= D_MAX - 1e-3 ? 'steering at full lock' : 'steering inside lock'}`, Math.abs(st.delta) >= D_MAX - 1e-3 ? HIGH_V : B_FIELD)
        else event.set(moveText, moveText.startsWith('move') ? RING : moveText === 'parked' ? POWER : HIGH_V)
        const simT = q.mode === 'follow' ? st.t % BM.seconds : park ? st.t % park.cycle : st.t
        sub.set(`t ${simT.toFixed(1)} s · real time · 0.5 m tape${park ? ` · ${BM.parkV} m/s` : ''}`)
      },
      readouts: (p) => {
        const q = bmParams(p)
        if (q.mode === 'circle') {
          const R = bicycleRadius(q.steer, L)
          return [
            { label: 'Turn radius L / tan δ', value: metres(R) },
            { label: 'Turn rate θ̇', value: `${signed((q.v * Math.tan(q.steer)) / L)} rad/s` },
            { label: 'Lap time', value: Number.isFinite(R) ? `${((2 * Math.PI * Math.abs(R)) / q.v).toFixed(1)} s` : '—' },
            { label: 'Sideways speed', value: '0 (nonholonomic)', tone: 'ok' as const },
          ]
        }
        if (q.mode === 'follow') {
          const run = followRun(q)
          const lap2 = run.slice(Math.floor(run.length / 2))
          const worst = Math.max(...lap2.map((f) => f.err))
          const sat = lap2.filter((f) => Math.abs(f.delta) >= D_MAX - 1e-3).length / lap2.length
          return [
            { label: 'Lookahead · speed', value: `${mmText(q.look)} · ${q.v.toFixed(1)} m/s` },
            { label: 'Worst cross-track (settled)', value: mmText(worst), tone: worst < 0.05 ? 'ok' : worst < 0.15 ? 'warn' : 'bad' },
            { label: 'Time at full lock', value: `${Math.round(sat * 100)} %`, tone: sat > 0.1 ? 'warn' : 'ok' },
            { label: 'Track lap', value: `${TRACK_PATH.length.toFixed(1)} m · ${(TRACK_PATH.length / q.v).toFixed(1)} s` },
          ]
        }
        const { plan } = parkSetup(q.room)
        return [
          { label: 'Shift · min radius', value: `${mmText(BM.shift)} · ${metres(R_MIN)}` },
          { label: 'S-moves', value: `${plan.k} (${plan.k * 2} arcs)`, tone: plan.k === 1 ? 'ok' : plan.k < 4 ? 'warn' : 'bad' },
          { label: 'Each S: arc · fore-aft', value: `2 × ${deg(plan.phi)} · ${mmText(plan.travel)}` },
          { label: 'Shift per S', value: mmText(BM.shift / plan.k) },
        ]
      },
    }
  },
}
