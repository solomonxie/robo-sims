import * as THREE from 'three/webgpu'
import {
  DEG,
  G,
  Pose,
  SKID,
  SkidFrame,
  TANK,
  TERRAINS,
  Terrain,
  climbLimit,
  skidRun,
  slipFor,
  slopeForces,
  softPull,
  steerLimit,
  tipAngle,
  toDeg,
  toRoom,
  turnMoment,
  weightN,
} from '../../core/physics'
import { mmText } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  addRod,
  emptyGroup,
  flatBox,
  floorMat,
  floorTrail,
  floorView,
  glowMat,
  liveLabel,
  memoBy,
  pointCloud,
  shellMat,
  stretchArrow,
  stretchRod,
  trackedBot,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const B = TANK.gauge
const W = weightN(TANK.massKg)
const GROUND = Object.fromEntries(Object.entries(TERRAINS).map(([k, t]) => [k, t.name])) as Record<keyof typeof TERRAINS, string>
const deg = (a: number) => `${Math.round(toDeg(a))}°`
const newtons = (f: number) => `${f.toFixed(1)} N`
const amps = (a: number) => `${a.toFixed(2)} A`

// --- Skid steer: tracks slide sideways to turn; moment μt W L/4 against the outer track's grip through B; current spikes, scuffs, the turn centre moves. ---

const SS = { at: [-5, -2.4, 0] as V3, tilt: 0.55, w: 19, h: 12, kMax: 18, cx: 6.6, cy: -4.6, cw: 5.6, ch: 6.6 }
const ssParams = (p: Params) => {
  const terrain = pick(GROUND, p.ground, 'concrete')
  return { terrain, t: TERRAINS[terrain] as Terrain, ratio: n(p, 'ratio'), radius: n(p, 'radius') }
}
type SsQ = ReturnType<typeof ssParams>
const skidFrames = memoBy(
  (q: SsQ) => `${q.terrain}|${q.ratio}|${q.radius}`,
  (q: SsQ) => skidRun(q.t, q.ratio, q.radius),
)
const STEP = SKID.dt * SKID.every
const frameAt = (run: SkidFrame[], t: number) => run[Math.min(run.length - 1, Math.floor(t / STEP))]
function turnSummary(run: SkidFrame[]) {
  const turn = run.filter((f) => f.turning)
  const steady = turn[Math.floor(turn.length * 0.6)] ?? run[0]
  const straight = run.find((f) => !f.turning && f.t > 0.4) ?? run[0]
  const realR = Math.abs(steady.w) > 1e-6 ? Math.abs((steady.ground[0] + steady.ground[1]) / 2 / steady.w) : Infinity
  return { steady, straight, realR, stuck: turn.some((f) => f.stuck) }
}

export const skidSteer: Lesson = {
  id: 'tracks-terrain-skid-steer',
  title: 'Skid steer',
  tagline: 'No steering: the tracks scrape sideways to turn',
  formula: (p) => {
    const q = ssParams(p)
    return `M = μt·W·L/4 · outer track F = f·W/2 + M/B ≤ μ·W/2 → turns only if L/B ≤ 2(μ − f)/μt = ${steerLimit(q.t).toFixed(2)} on ${q.t.name.toLowerCase()} (μ ${q.t.mu}, μt ${q.t.muT}, f ${q.t.roll})`
  },
  legend: [
    { color: POWER, label: 'Track thrust: outer pushes, inner holds back', shape: 'dot' },
    { color: HIGH_V, label: 'Track ends scraping sideways; scuff marks', shape: 'dot' },
    { color: RING, label: 'Real turning centre (grey: commanded)', shape: 'dot' },
    { color: B_FIELD, label: 'Motor current, left and right', shape: 'dot' },
  ],
  points: [
    'A tracked robot has no steering: it turns by running one track faster than the other, exactly like a differential drive. But a track touches the ground along its whole length L, so to rotate, both ends of every track must slide sideways across the ground. Sideways friction μt over the contact patch makes a resisting moment M = μt·W·L/4.',
    'The outer track must push forward and the inner one hold back, F_out − F_in = 2M/B: the moment acts through the gauge B. A long, narrow footprint (big L/B) means more moment and less lever, and once the outer track needs more than its grip μW/2 the robot just ploughs on with both tracks spinning. It turns only while L/B ≤ 2(μ − f)/μt, so real tracked robots sit near L/B ≈ 1–1.6. A 4WD skid-steer robot has the same problem with all its weight at the ends of its footprint.',
    'Driving straight, the motors only fight rolling resistance. In a turn they fight M as well, so the current jumps, most of all in a pivot turn on grippy ground; size the motors and the battery for turning, not cruising. The scraping is also what tears up lawns and carpets.',
    'The real turning centre is not where the motors put it. The outer track slips back and the inner is dragged ahead, so the robot turns wider than commanded, more on loose sand. Turning faster, the centripetal force shifts the pivot forward by s0 = (L/2)·a/(μt·g) and the tail swings out. Wheel encoders count the belts, not the ground (see Slip, Differential drive).',
  ],
  controls: [
    { kind: 'choice', key: 'ground', options: opts(GROUND), initial: 'concrete' },
    { kind: 'slider', key: 'ratio', label: 'Track length / gauge L/B', min: 0.6, max: 2.4, step: 0.1, initial: 1.2, format: (v) => v.toFixed(1) },
    { kind: 'slider', key: 'radius', label: 'Turn radius (0 = pivot)', min: 0, max: 0.4, step: 0.05, initial: 0.15, format: (v) => (v ? `${Math.round(v * 1000)} mm` : 'pivot') },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17, 6.6, 0.3], { size: 0.42, align: 'left' })
    const sub = liveLabel(scene, [-17, 5.7, 0.3], { size: 0.3, color: GREY, align: 'left' })
    const event = liveLabel(scene, [-17, 4.9, 0.3], { size: 0.32, align: 'left' })

    const g = floorView(scene, SS.at, 10, -SS.tilt)
    const floor = add(g, new THREE.Group())
    const w = add(g, new THREE.Group())
    const trail = floorTrail(w, 600, 0.012, GREY)
    const scuffs = [0, 1, 2, 3].map(() => floorTrail(w, 400, 0.008, HIGH_V))
    const marks = pointCloud(w, 2, 0.016)
    const thrust = [0, 1].map(() => stretchArrow(w, POWER, 0.005))
    const side = [0, 1, 2, 3].map(() => stretchArrow(w, HIGH_V, 0.004))
    const iccRod = addRod(w, glowMat(RING, 0.6))
    let bot = trackedBot(w)

    const { cx, cy, cw, ch } = SS
    const axM = glowMat(GREY, 0.35)
    stretchRod(addRod(scene, axM), [cx, cy, 0.1], [cx + cw, cy, 0.1], 0.025)
    stretchRod(addRod(scene, axM), [cx, cy, 0.1], [cx, cy + ch, 0.1], 0.025)
    addLabel(scene, 'motor current', [cx, cy + ch + 0.7, 0.3], LABEL, 0.32, 'left')
    addLabel(scene, `${SKID.seconds} s`, [cx + cw, cy - 0.5, 0.3], GREY, 0.24, 'right')
    const yTag = liveLabel(scene, [cx - 0.25, cy + ch, 0.3], { size: 0.24, color: GREY, align: 'right' })
    const NC = 320
    const curve = pointCloud(scene, 2 * NC, 0.055)
    const now = pointCloud(scene, 2, 0.16)
    const tags = [0, 1].map(() => liveLabel(scene, [0, 0, 0.3], { size: 0.24, align: 'left' }))

    const st = { key: '', ratio: 0, t: 0, prev: { x: 0, y: 0, th: 0 } as Pose, travel: [0, 0], ends: [] as Pose[], aMax: 1, lap: -1 }
    return {
      scene,
      view: { center: [-2.2, -0.4, 0], radius: 52, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = ssParams(p)
        const run = skidFrames(q)
        const L = q.ratio * B
        const key = `${q.terrain}|${q.ratio}|${q.radius}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          st.lap = -1
          if (q.ratio !== st.ratio) {
            st.ratio = q.ratio
            emptyGroup(bot.group)
            bot.group.removeFromParent()
            bot = trackedBot(w, { contact: L })
          }
          const xs = run.map((f) => f.pose.x)
          const ys = run.map((f) => f.pose.y)
          const m = L / 2 + 0.15
          const bx: [number, number] = [Math.min(...xs) - m, Math.max(...xs) + m]
          const by: [number, number] = [Math.min(...ys) - m, Math.max(...ys) + m]
          emptyGroup(floor)
          floorMat(floor, bx, by)
          const k = Math.min(SS.kMax, SS.w / (bx[1] - bx[0]), SS.h / ((by[1] - by[0]) * Math.cos(SS.tilt)))
          const [mx, my] = [(bx[0] + bx[1]) / 2, (by[0] + by[1]) / 2]
          g.scale.setScalar(k)
          g.position.set(SS.at[0] - k * mx, SS.at[1] - k * my * Math.cos(SS.tilt), SS.at[2] + k * my * Math.sin(SS.tilt))
          st.aMax = Math.max(0.5, Math.ceil(Math.max(...run.flatMap((f) => f.amps)) * 2.5) / 2)
          yTag.set(`${st.aMax.toFixed(1)} A`)
          const C = (t: number, a: number): V3 => [cx + (t / SKID.seconds) * cw, cy + (a / st.aMax) * ch, 0.1]
          for (let i = 0; i < NC; i++) {
            const f = frameAt(run, (i / (NC - 1)) * SKID.seconds)
            f.amps.forEach((a, s) => curve.set(s * NC + i, C(f.t, a), s ? POWER : B_FIELD, f.turning ? 1 : 0.6))
          }
          curve.show(2 * NC)
        }
        st.t = (st.t + dt) % SKID.seconds
        const lap = Math.floor(st.t / STEP) < 2 ? 0 : 1
        if (lap === 0 && st.lap !== 0) {
          trail.clear()
          scuffs.forEach((s) => s.clear())
          st.travel = [0, 0]
          st.prev = run[0].pose
          st.ends = []
        }
        st.lap = lap
        const f = frameAt(run, st.t)
        st.travel = st.travel.map((v, i) => v + f.belt[i] * dt)
        bot.set(f.pose, st.travel[0], st.travel[1])
        if (Math.hypot(f.pose.x - st.prev.x, f.pose.y - st.prev.y) < 0.2) trail.add(st.prev, f.pose)
        st.prev = f.pose
        const corners: [number, number][] = [
          [L / 2, B / 2],
          [L / 2, -B / 2],
          [-L / 2, B / 2],
          [-L / 2, -B / 2],
        ]
        const endPoses = corners.map(([bx, by]) => {
          const [x, y] = toRoom(f.pose, bx, by)
          return { x, y, th: 0 }
        })
        const u = Math.min(1, f.scuff / 0.15)
        if (f.scuff > 0.02 && st.ends.length) endPoses.forEach((e, i) => scuffs[i].add(st.ends[i], e))
        st.ends = endPoses
        bot.scuff(f.stuck ? [0, 0, 0, 0] : [u, u, u, u])
        bot.spin(f.stuck ? 1 : 0, f.stuck ? 1 : 0)

        const z = 0.07
        const FK = 0.03
        f.force.forEach((F, i) => {
          const by = (i ? -1 : 1) * (B / 2 + 0.035)
          const a = toRoom(f.pose, 0, by)
          const b = toRoom(f.pose, F * FK, by)
          thrust[i]([a[0], a[1], z], [b[0], b[1], z])
        })
        corners.forEach(([bx, by], i) => {
          const dir = f.turning && !f.stuck ? (bx > 0 ? -1 : 1) * Math.sign(f.w) : 0
          const len = dir * Math.min(0.12, f.scuff * 0.6)
          const a = toRoom(f.pose, bx, by)
          const b = toRoom(f.pose, bx, by + len)
          side[i]([a[0], a[1], 0.02], [b[0], b[1], 0.02])
        })
        const pts: [number, number, string][] = []
        if (f.turning && !f.stuck && Math.abs(f.w) > 1e-6) {
          const real = toRoom(f.pose, f.s0, (f.ground[0] + f.ground[1]) / 2 / f.w)
          const cmd = toRoom(f.pose, 0, q.radius)
          pts.push([...real, RING], [...cmd, GREY])
          stretchRod(iccRod, [...toRoom(f.pose, 0, 0), 0.01] as V3, [...real, 0.01] as V3, 0.003)
          iccRod.visible = true
        } else iccRod.visible = false
        pts.forEach(([x, y, c], i) => marks.set(i, [x, y, 0.012], c))
        marks.show(pts.length)

        const C = (t: number, a: number): V3 => [cx + (t / SKID.seconds) * cw, cy + (a / st.aMax) * ch, 0.2]
        f.amps.forEach((a, i) => {
          const at = C(f.t, a)
          now.set(i, at, i ? POWER : B_FIELD)
          tags[i].group.position.set(Math.min(at[0] + 0.3, cx + cw - 2.4), at[1] + (i ? 0.45 : -0.45), 0.3)
          tags[i].set(`${i ? 'right' : 'left'} ${amps(a)}`, i ? POWER : B_FIELD)
        })
        now.show(2)

        status.set(`${q.t.name} · L/B ${q.ratio.toFixed(1)} · ${f.turning ? (q.radius ? `turning, R ${mmText(q.radius)}` : 'pivot turn') : 'straight'}`, LABEL)
        const realR = Math.abs(f.w) > 1e-6 ? Math.abs((f.ground[0] + f.ground[1]) / 2 / f.w) : Infinity
        if (f.stuck) event.set(`L/B ${q.ratio.toFixed(1)} > ${steerLimit(q.t).toFixed(2)}: outer track out of grip, both tracks spin`, HIGH_V)
        else if (f.turning)
          event.set(`tracks scrape ${(f.scuff * 1000).toFixed(0)} mm/s sideways · real R ${mmText(realR)} vs ${mmText(q.radius)} · pivot ${mmText(f.s0)} ahead`, HEAT)
        else event.set('straight: tracks roll, no sideways scrape', POWER)
        sub.set(`${st.t.toFixed(1)} / ${SKID.seconds} s · outer belt ${SKID.v} m/s · real time · 0.5 m tape`)
      },
      readouts: (p) => {
        const q = ssParams(p)
        const s = turnSummary(skidFrames(q))
        const lim = steerLimit(q.t)
        return [
          { label: 'L/B · limit', value: `${q.ratio.toFixed(1)} · ${lim.toFixed(2)}`, tone: q.ratio <= lim ? 'ok' : 'bad' },
          { label: 'Turning moment', value: `${turnMoment(q.t.muT, W, q.ratio * B).toFixed(2)} N·m` },
          { label: 'Current straight · turn', value: `${amps(Math.max(...s.straight.amps))} · ${amps(Math.max(...s.steady.amps))}`, tone: s.stuck ? 'bad' : 'warn' },
          { label: 'Turn radius set · real', value: s.stuck ? 'no turn' : `${mmText(q.radius)} · ${mmText(s.realR)}`, tone: s.stuck ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Traction: thrust capped by μN or soil shear, tracks spreading weight vs wheels sinking, slope climb and tip-over. ---

const MODES = { soft: 'Tracks vs wheels', slope: 'Climb a slope' }
const GROUSERS = { on: 'Grousers', off: 'Smooth pads' }
const TR = { lanes: [2.6, -3.2], x0: -3, k: 18, tilt: 1.42, run: [-0.45, 0.55] as [number, number], v: 0.12, period: 11, slopeAt: [-11, -4.6, 0] as V3, sk: 15, ramp: [0, 0.9] as [number, number] }
const SOIL: Record<keyof typeof TERRAINS, string> = { concrete: '#8d9097', grass: '#3f6b35', sand: '#c9a86a', mud: '#5a4532' }
const trParams = (p: Params) => {
  const terrain = pick(GROUND, p.ground, 'mud')
  return {
    soft: pick(MODES, p.mode, 'soft') === 'soft',
    terrain,
    t: TERRAINS[terrain] as Terrain,
    grousers: pick(GROUSERS, p.grip, 'on') === 'on',
    slope: n(p, 'slope') * DEG,
    comH: n(p, 'com') / 1000,
  }
}
type TrQ = ReturnType<typeof trParams>
function slopeState(q: TrQ) {
  const f = slopeForces(q.t, q.slope, q.grousers)
  const tip = tipAngle(TANK.contact, q.comH)
  return { ...f, tip, tips: q.slope > tip, limit: climbLimit(q.t, q.grousers), slip: f.holds ? slipFor(f.need / f.have, TANK.contact, q.t.shearK) : 1 }
}

export const tractionLesson: Lesson = {
  id: 'tracks-terrain-traction',
  title: 'Traction',
  tagline: 'Spread the weight, bite the ground, keep the CoM low',
  formula: (p) => {
    const q = trParams(p)
    return q.soft
      ? `F ≤ μ·N (smooth) or A·c + N·tan φ (grousers) · p = W/A · sinkage z = (p / (kc/b + kφ))^(1/n) · pull = F − rut drag`
      : `need W·sin θ + f·W·cos θ ≤ thrust on W·cos θ · tips when θ > atan((L/2)/h) = atan(${mmText(TANK.contact / 2)} / ${mmText(q.comH)}) = ${deg(tipAngle(TANK.contact, q.comH))}`
  },
  legend: (p) =>
    trParams(p).soft
      ? [
          { color: POWER, label: 'Thrust the ground can take', shape: 'dot' },
          { color: HIGH_V, label: 'Rut drag; belt spinning', shape: 'dot' },
          { color: HEAT, label: 'Ground pressure under the patch', shape: 'dot' },
        ]
      : [
          { color: POWER, label: 'Thrust available', shape: 'dot' },
          { color: HIGH_V, label: 'Thrust needed: W·sin θ + rolling', shape: 'dot' },
          { color: RING, label: 'Centre of mass; plumb line', shape: 'dot' },
          { color: B_FIELD, label: 'Rear contact edge: the tipping pivot', shape: 'dot' },
        ],
  points: [
    'A track pushes the ground backward and the ground pushes the robot forward, but only so hard. On hard ground rubber grip caps the thrust at μN. On soft ground the soil itself shears: F = A·c + N·tan φ, cohesion c over the contact area A plus internal friction φ. Grousers, the ribs on each link, dig in and shear a whole slab of soil; smooth pads slide on top, which in mud (μ 0.3) is not much.',
    'Same 2 kg robot: tracks spread it over 2·b·L, about 160 cm², so ground pressure is about 1.2 kPa; four wheels carry it on small patches at several times that. Soft soil sinks until it carries the load, Bekker: p = (kc/b + kφ)·zⁿ. A deeper rut costs drag to plough, and once the wheels sink past the belly clearance the chassis sits on the mud: stuck, wheels spinning.',
    'On a slope θ the drive must hold W·sin θ plus rolling, while the grip only gets W·cos θ of normal load. On hard ground that gives tan θ ≈ μ − f; on soil the grousers\' cohesion term helps more. Past the limit the tracks spin and the robot slides back down.',
    'It can also flip first. The robot tips backwards when its centre of mass passes behind the rear contact edge: θ_tip = atan((L/2)/h). Mount a battery or arm high and it tips before traction runs out. Long tracks and a low CoM climb best; a raised front idler lets the track climb onto a step that would stop a wheel.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'soft' },
    { kind: 'choice', key: 'ground', options: opts(GROUND), initial: 'mud' },
    { kind: 'choice', key: 'grip', options: opts(GROUSERS), initial: 'on' },
    { kind: 'slider', key: 'slope', label: 'Slope θ', min: 0, max: 50, step: 1, initial: 25, format: (v) => `${v}°` },
    { kind: 'slider', key: 'com', label: 'CoM height h', min: 40, max: 200, step: 10, initial: 70, format: (v) => `${v} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17, 6.6, 0.3], { size: 0.42, align: 'left' })
    const sub = liveLabel(scene, [-17, 5.7, 0.3], { size: 0.3, color: GREY, align: 'left' })
    const event = liveLabel(scene, [-17, 4.9, 0.3], { size: 0.32, align: 'left' })

    const softRoot = add(scene, new THREE.Group())
    const lanes = (['track', 'wheels'] as const).map((gear, i) => {
      const g = floorView(softRoot, [TR.x0, TR.lanes[i], 0], TR.k, -TR.tilt)
      const soil = add(g, new THREE.Group())
      const bot = trackedBot(g, { wheels: gear === 'wheels' })
      const rut = mat('#24201c', { rough: 0.95 })
      const ruts = [1, -1].map((s) => {
        const r = box(g, [1, gear === 'track' ? TANK.belt : TANK.wheelB, 1], rut, [0, (s * B) / 2, 0])
        r.castShadow = false
        return r
      })
      const pressure = pointCloud(g, 40, 0.006)
      const fwd = stretchArrow(g, POWER, 0.006)
      const back = stretchArrow(g, HIGH_V, 0.006)
      const tag = liveLabel(softRoot, [TR.x0 - 10, TR.lanes[i] - 1.9, 0.4], { size: 0.32, align: 'left' })
      const tag2 = liveLabel(softRoot, [TR.x0 - 10, TR.lanes[i] - 2.6, 0.4], { size: 0.26, color: GREY, align: 'left' })
      return { gear, g, soil, bot, ruts, pressure, fwd, back, tag, tag2, travel: 0 }
    })

    const slopeRoot = add(scene, new THREE.Group())
    const sv = floorView(slopeRoot, TR.slopeAt, TR.sk, -TR.tilt)
    const ramp = add(sv, new THREE.Group())
    const rampSoil = add(ramp, new THREE.Group())
    const pivot = add(ramp, new THREE.Group())
    const climber = trackedBot(pivot)
    climber.group.position.x = TANK.contact / 2
    const mast = box(climber.body, [0.012, 0.012, 1], mat('#9aa0aa', { metal: 0.5, rough: 0.35 }), [0, 0, 0.5])
    const weight = box(climber.body, [0.05, 0.06, 0.03], mat('#2a6fd1', { rough: 0.5 }), [0, 0, 0.1])
    const com = pointCloud(sv, 2, 0.011)
    const plumb = addRod(sv, glowMat(RING, 0.8))
    const need = stretchArrow(sv, HIGH_V, 0.006)
    const have = stretchArrow(sv, POWER, 0.006)
    const angTag = liveLabel(sv, [0, 0, 0], { size: 0.03, color: LABEL, align: 'left' })
    angTag.group.rotation.x = TR.tilt
    const tipTag = liveLabel(sv, [0, 0, 0], { size: 0.026, color: B_FIELD, align: 'left' })
    tipTag.group.rotation.x = TR.tilt

    const st = { key: '', t: 0, x: 0, fall: 0, fallV: 0, travel: 0, word: '' }
    return {
      scene,
      view: { center: [-2.2, -0.4, 0], radius: 52, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = trParams(p)
        const key = `${q.soft}|${q.terrain}|${q.grousers}|${q.slope}|${q.comH}`
        if (key !== st.key) {
          st.key = key
          Object.assign(st, { t: 0, x: TR.ramp[0] + 0.3, fall: 0, fallV: 0, travel: 0 })
          softRoot.visible = q.soft
          slopeRoot.visible = !q.soft
          const col = SOIL[q.terrain]
          lanes.forEach((l) => {
            emptyGroup(l.soil)
            const [x0, x1] = TR.run
            const bed = box(l.soil, [x1 - x0 + 0.3, 0.42, 0.07], mat(col, { rough: 0.95 }), [0, 0.22, -0.035])
            bed.castShadow = bed.receiveShadow = false
            flatBox(l.soil, [x1 - x0 + 0.3, 0.14, 0.07], shellMat(col, 0.72, 0.9), [0, -0.08, -0.035])
            l.travel = 0
          })
          emptyGroup(rampSoil)
          box(rampSoil, [TR.ramp[1] - TR.ramp[0] + 0.1, 0.34, 0.06], mat(col, { rough: 0.95 }), [(TR.ramp[0] + TR.ramp[1]) / 2, 0.05, -0.03])
          ramp.rotation.y = -q.slope
          mast.scale.z = Math.max(0.001, q.comH - 0.05)
          mast.position.z = 0.05 + (q.comH - 0.05) / 2
          weight.position.z = q.comH
        }
        st.t += dt
        const cycle = st.t % TR.period
        if (q.soft) {
          lanes.forEach((l) => {
            const s = softPull(q.t, l.gear, q.grousers)
            const v = TR.v * (1 - s.slip)
            const [x0, x1] = TR.run
            const x = Math.min(x1, x0 + v * cycle)
            if (cycle < dt) l.travel = 0
            l.travel += TR.v * dt
            const dig = s.stuck ? Math.min(1, cycle / 2) : 1
            const sink = s.sink * dig
            l.bot.group.position.z = -Math.min(sink, s.bellied ? (l.gear === 'track' ? TANK.clearance : TANK.wheelClear) + 0.004 : sink)
            l.bot.set({ x, y: 0, th: 0 }, l.travel, l.travel)
            l.bot.spin(s.stuck ? 1 : s.slip, s.stuck ? 1 : s.slip)
            l.ruts.forEach((r) => {
              const len = Math.max(0.001, x - x0 + 0.05)
              r.scale.set(len, 1, Math.max(0.0005, sink))
              r.position.x = x0 - 0.05 + len / 2 - 0.03
              r.position.z = -sink / 2 + 0.0004
              r.visible = sink > 0.0005
            })
            const half = l.gear === 'track' ? TANK.contact / 2 : TANK.contact / 2 + TANK.wheelD / 2
            const pts = l.gear === 'track' ? 14 : 2
            for (let i = 0; i < pts; i++) {
              const px = l.gear === 'track' ? x - half + (2 * half * (i + 0.5)) / pts : x + ((i ? -1 : 1) * TANK.contact) / 2
              l.pressure.set(i, [px, -B / 2 - 0.03, l.bot.group.position.z - 0.004], HEAT, 0.6 + Math.min(3, s.pressureKpa / 1.5))
            }
            l.pressure.show(pts)
            const zA = 0.05 - sink
            const FK = 0.012
            l.fwd([x + half + 0.03, -B / 2 - 0.04, zA], [x + half + 0.03 + s.thrust * FK, -B / 2 - 0.04, zA])
            l.back([x - half - 0.03, -B / 2 - 0.04, zA], [x - half - 0.03 - s.drag * FK, -B / 2 - 0.04, zA])
            l.tag.set(`${l.gear === 'track' ? 'Tracks' : '4 wheels'}: ` + (s.stuck ? (s.bellied ? `bellied out in ${mmText(s.sink)}: stuck` : 'drag beats thrust: stuck') : `pulls ${newtons(s.pull)} spare, slip ${Math.round(s.slip * 100)} %`), s.stuck ? HIGH_V : POWER)
            l.tag2.set(`${s.pressureKpa.toFixed(1)} kPa on ${Math.round(s.areaM2 * 1e4)} cm² · sinks ${mmText(s.sink)} · thrust ${newtons(s.thrust)} · drag ${newtons(s.drag)}`)
          })
          const tr = softPull(q.t, 'track', q.grousers)
          const wh = softPull(q.t, 'wheels', q.grousers)
          status.set(`${q.t.name} · ${GROUSERS[q.grousers ? 'on' : 'off']} · same 2 kg robot`, LABEL)
          event.set(
            wh.stuck && !tr.stuck ? 'wheels sink and stop; tracks float on low pressure' : tr.stuck && wh.stuck ? 'both stuck: not enough thrust for this ground' : `pressure ${(wh.pressureKpa / tr.pressureKpa).toFixed(1)}× lower on tracks`,
            wh.stuck || tr.stuck ? HIGH_V : POWER,
          )
          sub.set(`${cycle.toFixed(1)} / ${TR.period} s · belt ${TR.v} m/s · real time · sinkage drawn true to scale`)
          return
        }

        const s = slopeState(q)
        const L = TANK.contact
        const T0 = 1
        let word: string
        if (s.tips && cycle > T0) {
          st.fallV += (G / Math.max(0.05, q.comH)) * Math.sin(q.slope - s.tip + st.fall) * dt * 0.5
          st.fall = Math.min(Math.PI / 2 + 0.3, st.fall + st.fallV * dt)
          word = 'tips over backwards'
        } else if (!s.holds && cycle > T0) {
          const a = (G * (s.need - s.have)) / W
          st.x = Math.max(TR.ramp[0] + 0.1, st.x - Math.min(0.15, a * (cycle - T0)) * dt)
          word = 'tracks spin, slides back'
        } else {
          st.x = Math.min(TR.ramp[1] - 0.12, st.x + TR.v * (1 - s.slip) * dt)
          word = s.tips ? 'about to tip' : 'climbing'
        }
        if (cycle < dt) Object.assign(st, { x: TR.ramp[0] + 0.3, fall: 0, fallV: 0 })
        st.travel += TR.v * dt
        pivot.position.x = st.x - L / 2
        pivot.rotation.y = -st.fall
        climber.set({ x: L / 2, y: 0, th: 0 }, st.travel, st.travel)
        const spinning = !s.holds && cycle > T0 && !s.tips
        climber.spin(spinning ? 1 : 0, spinning ? 1 : 0)

        const c = Math.cos(q.slope)
        const sn = Math.sin(q.slope)
        const toSv = (x: number, z: number): V3 => [x * c - z * sn, -0.2, x * sn + z * c]
        const rx = st.x - L / 2
        const cf = Math.cos(st.fall)
        const sf = Math.sin(st.fall)
        const comW = toSv(rx + (L / 2) * cf - q.comH * sf, (L / 2) * sf + q.comH * cf)
        const edge = toSv(rx, 0)
        com.set(0, comW, RING, 1.4)
        com.set(1, edge, B_FIELD, 1.2)
        com.show(2)
        stretchRod(plumb, comW, [comW[0], comW[1], Math.min(edge[2], comW[2]) - 0.06], 0.0022)
        const FK = 0.008
        const mid = toSv(st.x, 0.03)
        need(mid, [mid[0] - s.need * FK * c, mid[1], mid[2] - s.need * FK * sn])
        const up = toSv(st.x, 0.045)
        have(up, [up[0] + s.have * FK * c, up[1], up[2] + s.have * FK * sn])
        angTag.group.position.set(...toSv(TR.ramp[1] - 0.05, -0.09))
        angTag.set(`θ ${deg(q.slope)}`, LABEL)
        tipTag.group.position.set(...toSv(rx - 0.17, 0.03))
        tipTag.set(`tip at ${deg(s.tip)}`, s.tips ? HIGH_V : B_FIELD)

        if (word !== st.word) {
          st.word = word
          status.set(`${q.t.name} · ${deg(q.slope)} slope · ${word}`, LABEL)
        }
        event.set(
          s.tips ? `CoM ${mmText(q.comH)} high: plumb line falls behind the rear edge past ${deg(s.tip)}` : s.holds ? `needs ${newtons(s.need)} of ${newtons(s.have)} grip · slip ${Math.round(s.slip * 100)} %` : `needs ${newtons(s.need)}, ground gives ${newtons(s.have)}: limit ${deg(s.limit)}`,
          s.tips || !s.holds ? HIGH_V : POWER,
        )
        sub.set(`${cycle.toFixed(1)} / ${TR.period} s · belt ${TR.v} m/s · real time`)
      },
      readouts: (p) => {
        const q = trParams(p)
        if (q.soft) {
          const tr = softPull(q.t, 'track', q.grousers)
          const wh = softPull(q.t, 'wheels', q.grousers)
          return [
            { label: 'Pressure tracks · wheels', value: `${tr.pressureKpa.toFixed(1)} · ${wh.pressureKpa.toFixed(1)} kPa` },
            { label: 'Sinkage tracks · wheels', value: `${mmText(tr.sink)} · ${mmText(wh.sink)}`, tone: wh.bellied ? 'bad' : 'ok' },
            { label: 'Spare pull tracks · wheels', value: `${tr.stuck ? 'stuck' : newtons(tr.pull)} · ${wh.stuck ? 'stuck' : newtons(wh.pull)}`, tone: tr.stuck || wh.stuck ? 'bad' : 'ok' },
            { label: 'Peak thrust (tracks)', value: newtons(tr.thrust) },
          ]
        }
        const s = slopeState(q)
        return [
          { label: 'Thrust needed · grip', value: `${newtons(s.need)} · ${newtons(s.have)}`, tone: s.holds ? 'ok' : 'bad' },
          { label: 'Traction limit', value: deg(s.limit) },
          { label: 'Tip-over angle', value: deg(s.tip), tone: s.tips ? 'bad' : s.tip < s.limit ? 'warn' : 'ok' },
          { label: 'Weight', value: `${TANK.massKg} kg · ${newtons(W)}` },
        ]
      },
    }
  },
}
