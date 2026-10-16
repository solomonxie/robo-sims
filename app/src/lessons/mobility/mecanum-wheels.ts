import * as THREE from 'three/webgpu'
import {
  MECANUM,
  MEC_RUN,
  MEC_WHEELS,
  MecLayout,
  MecMove,
  Pose,
  Wheel4,
  mecForceSum,
  mecInverse,
  mecPushLimit,
  mecPushTwist,
  mecRun,
  mecScale,
  mecWheels,
  tileHeight,
  toDeg,
  twistStep,
} from '../../core/physics'
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
  cursorBar,
  flatBox,
  floorMat,
  floorView,
  glowMat,
  liveLabel,
  mecanumBot,
  mecanumWheel,
  memoBy,
  pointCloud,
  scope,
  simClock,
  stickPhone,
  stretchArrow,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const { halfL: L, halfW: W, wheelR: R, maxRim } = MECANUM
const signText = (v: number) => (Math.abs(v) < 1e-6 ? '0' : v > 0 ? '+' : '−')
const speedText = (v: number) => `${v < -1e-6 ? '−' : v > 1e-6 ? '+' : ''}${Math.abs(v).toFixed(2)}`
const pattern = (s: number[]) => s.map(signText).join(' ')
const inside = (p: Pose, fx: [number, number], fy: [number, number]) => p.x >= fx[0] && p.x <= fx[1] && p.y >= fy[0] && p.y <= fy[1]

/** Floor force arrows at each wheel, their sum at the centre and a yaw-torque arc, in the robot's frame. */
function forceGlyphs(parent: THREE.Object3D, kF: number, kNet: number) {
  const wheel = [0, 1, 2, 3].map(() => stretchArrow(parent, HEAT, 0.0035))
  const rim = [0, 1, 2, 3].map(() => stretchArrow(parent, B_FIELD, 0.0028))
  const net = stretchArrow(parent, POWER, 0.005)
  const arc = pointCloud(parent, 40, 0.0045)
  const head = stretchArrow(parent, RING, 0.0035)
  const z = 0.09
  return (f: Wheel4, layout: MecLayout) => {
    const sum = mecForceSum(f, layout)
    mecWheels(layout).forEach((k, i) => {
      rim[i]([k.x, k.y, z], [k.x + f[i] * kF, k.y, z])
      wheel[i]([k.x, k.y, z + 0.004], [k.x + sum.forces[i][0] * kF, k.y + sum.forces[i][1] * kF, z + 0.004])
    })
    net([0, 0, z + 0.01], [sum.fx * kNet, sum.fy * kNet, z + 0.01])
    const span = Math.max(-1, Math.min(1, sum.tz / (4 * (L + W)))) * Math.PI * 1.1
    const r = 0.055
    const dots = Math.round(Math.abs(span) / 0.12)
    for (let i = 0; i < dots; i++) {
      const a = -Math.PI / 2 + (span * i) / Math.max(1, dots)
      arc.set(i, [r * Math.cos(a), r * Math.sin(a), z + 0.01], RING)
    }
    arc.show(dots)
    const a1 = -Math.PI / 2 + span
    const d = Math.sign(span) * 0.03
    head([r * Math.cos(a1 - d * 0.3), r * Math.sin(a1 - d * 0.3), z + 0.01], [r * Math.cos(a1) - Math.sin(a1) * d, r * Math.sin(a1) + Math.cos(a1) * d, z + 0.01])
    return sum
  }
}

// --- Roller geometry: a free roller only holds along its axle, so each wheel pushes the floor at 45°; the hands must form an X from above. ---

const MOVES1 = { fwd: 'Forward', strafe: 'Strafe left', spin: 'Spin left' }
const LAYOUTS: Record<MecLayout, string> = { x: 'X from above', o: 'O from above (swapped)' }
const RG = { at: [6.6, -1.7, 0] as V3, k: 24, fx: [-0.3, 0.3] as [number, number], fy: [-0.25, 0.25] as [number, number], rim: 0.15, cAt: [-9.6, -1.7, 0] as V3, cK: 85, kF: 0.034, slowRoll: 0.35 }
const rgParams = (p: Params) => {
  const move = pick(MOVES1, p.move, 'strafe')
  const layout = pick(LAYOUTS, p.layout, 'x') as MecLayout
  const s = move === 'fwd' ? mecInverse(RG.rim, 0, 0) : move === 'strafe' ? mecInverse(0, RG.rim, 0) : mecInverse(0, 0, RG.rim / (L + W))
  const f = s.map((v) => v / RG.rim) as Wheel4
  return { move, layout, s, f, twist: mecPushTwist(s, layout), sum: mecForceSum(f, layout) }
}
type RgQ = ReturnType<typeof rgParams>
const scrubbing = (q: RgQ) => Math.max(...q.twist.scrub.map(Math.abs)) > 0.01
function rgWord(q: RgQ) {
  if (q.layout === 'x') return { fwd: 'All four push forward; the sideways halves cancel', strafe: 'Front pair crosses the back pair: forward halves cancel, sideways add', spin: 'Every floor force leans around the centre: pure torque' }[q.move]
  if (q.move === 'fwd') return 'Swapped hands still drive forward: the sideways halves cancel either way'
  if (q.move === 'strafe') return 'Swapped: the same wheel pattern strafes RIGHT'
  return 'Swapped: forces point almost at the centre, little torque, the wheels scrub'
}
const startOf = (q: RgQ): Pose => {
  const { vx, vy } = q.twist
  const d = Math.hypot(vx, vy)
  return d < 1e-6 ? { x: 0, y: 0, th: 0 } : { x: (-vx / d) * 0.2, y: (-vy / d) * 0.12, th: 0 }
}

export const rollerGeometry: Lesson = {
  id: 'mecanum-wheels-roller-geometry',
  title: 'Roller geometry',
  tagline: 'Free rollers at 45° turn a wheel push into a diagonal one',
  formula: (p) => {
    const q = rgParams(p)
    return `F_floor = f·(1, tan β), β = ±45° · ΣF = (${q.sum.fx.toFixed(1)}, ${q.sum.fy.toFixed(1)}) N · τ = Σ(x·Fy − y·Fx) = ${q.sum.tz.toFixed(2)} N·m for ${pattern(q.f)} × 1 N`
  },
  legend: [
    { color: B_FIELD, label: 'Motor push on the rim (1 N, along the wheel)', shape: 'dot' },
    { color: HEAT, label: 'Floor push: along the roller axle, 45°', shape: 'dot' },
    { color: POWER, label: 'Sum of the four at the chassis', shape: 'dot' },
    { color: RING, label: 'Yaw torque', shape: 'dot' },
  ],
  points: [
    'A mecanum wheel is a hub ringed with free rollers, here 9 on a 60 mm wheel, each on an axle at 45° to the wheel\'s. Only one roller touches the floor at a time, and it rolls freely across its axle, so the floor can only push back along that axle (perpendicular to the way it rolls).',
    'So the motor\'s forward push on the rim comes out at 45°: the forward part f balances the motor torque and an equal sideways part f·tan 45° comes free. Each wheel pushes diagonally, √2·f, and the chassis moves wherever the four arrows sum to.',
    'Forward: all four +, the sideways parts cancel. Strafe left: front-left and rear-right run backwards, the forward parts cancel and the sideways ones add. Spin: left side back, right side forward, the arrows lean around the centre and only torque is left.',
    'The hands matter. Seen from above the top rollers must form an X (the floor rollers form an O around the centre). Swap them and every floor arrow points almost through the centre: strafing reverses and spinning has no lever arm left, so the wheels just scrub (red).',
  ],
  controls: [
    { kind: 'choice', key: 'move', options: opts(MOVES1), initial: 'strafe' },
    { kind: 'choice', key: 'layout', options: opts(LAYOUTS), initial: 'x' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-16, 6.3, 0.3], { size: 0.4, align: 'left' })
    addLabel(scene, '60 mm wheels, 9 rollers · 170 × 200 mm chassis · real time', [-16, 5.4, 0.3], GREY, 0.3, 'left')

    // Close-up of the front-left wheel and the forces at its floor roller.
    const cg = floorView(scene, RG.cAt, RG.cK, -0.5)
    const c = add(cg, new THREE.Group())
    c.rotation.z = 0.55
    flatBox(c, [0.12, 0.1, 0.004], mat('#23262d', { rough: 0.85 }), [0, 0, -0.002])
    const wheel = mecanumWheel(c, [0, 0, R])
    const rubber = mat('#2a2c32', { rough: 0.85 })
    const hot = glowMat(HEAT, 0.7)
    const rollers = wheel.model.children.filter((o) => (o as THREE.Mesh).geometry?.type === 'LatheGeometry') as THREE.Mesh[]
    const axleRod = addRod(c, glowMat(HEAT, 0.45))
    const freeRod = addRod(c, glowMat(GREY, 0.5))
    const cRim = stretchArrow(c, B_FIELD, 0.0016)
    const cFloor = stretchArrow(c, HEAT, 0.002)
    const tags = { axle: liveLabel(c, [0, 0, 0.004], { size: 0.0055, color: HEAT }), free: liveLabel(c, [0, 0, 0.004], { size: 0.0055, color: GREY }) }
    addLabel(scene, 'front-left wheel', [RG.cAt[0], 3.9, 0.3], LABEL, 0.38)
    const cText = liveLabel(scene, [RG.cAt[0], 3.1, 0.3], { size: 0.3 })

    // Top view of the whole robot.
    const g = floorView(scene, RG.at, RG.k, -0.55)
    floorMat(g, RG.fx, RG.fy)
    const bot = mecanumBot(g)
    const glyphs = forceGlyphs(bot.group, 0.05, 0.026)
    const axles = [0, 1, 2, 3].map(() => addRod(bot.group, glowMat(HEAT, 0.3)))
    const names = MEC_WHEELS.map(() => liveLabel(bot.group, [0, 0, 0.1], { size: 0.016, color: LABEL }))
    const trail = pointCloud(g, 160, 0.005)

    const st = { key: '', pose: { x: 0, y: 0, th: 0 } as Pose, travel: [0, 0, 0, 0] as Wheel4, roll: 0, trail: 0, acc: 0 }
    const v = new THREE.Vector3()
    return {
      scene,
      view: { center: [-1.5, -0.4, 0], radius: 50, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = rgParams(p)
        const key = `${q.move}|${q.layout}`
        const ws = mecWheels(q.layout)
        if (key !== st.key) {
          st.key = key
          Object.assign(st, { pose: startOf(q), trail: 0, acc: 0 })
          trail.show(0)
          bot.layout(q.layout)
          wheel.hand(ws[0].tanB > 0)
          ws.forEach((k, i) => {
            const u: V3 = [Math.SQRT1_2, k.tanB * Math.SQRT1_2, 0]
            stretchRod(axles[i], [k.x - u[0] * 0.09, k.y - u[1] * 0.09, 0.006], [k.x + u[0] * 0.09, k.y + u[1] * 0.09, 0.006], 0.0015)
            names[i].group.position.set(k.x + Math.sign(k.x) * 0.06, k.y + Math.sign(k.y) * 0.02, 0.1)
            names[i].set(`${MEC_WHEELS[i]} ${signText(q.f[i])}`, q.f[i] > 0 ? POWER : q.f[i] < 0 ? HIGH_V : GREY)
          })
          const t = ws[0].tanB
          const f = q.f[0]
          stretchRod(axleRod, [-0.045, -0.045 * t, 0.001], [0.045, 0.045 * t, 0.001], 0.0006)
          stretchRod(freeRod, [-0.03, 0.03 * t, 0.001], [0.03, -0.03 * t, 0.001], 0.0004)
          tags.axle.group.position.set(-t * 0.052, -0.052, 0.004)
          tags.axle.set('roller axle', HEAT)
          tags.free.group.position.set(t * 0.04, -0.04, 0.004)
          tags.free.set('rolls free', GREY)
          const k = RG.kF
          cRim([0, 0, 0.003], [f * k, 0, 0.003])
          cFloor([0, 0, 0.004], [f * k, f * t * k, 0.004])
          cText.set(`FL motor ${signText(f)}1 N → floor (${f.toFixed(0)}, ${(f * t).toFixed(0)}) N, ${Math.SQRT2.toFixed(2)} N at 45°`, LABEL)
          status.set(rgWord(q), q.layout === 'x' ? LABEL : HEAT)
          glyphs(q.f, q.layout)
        }
        st.roll += q.s[0] * dt * RG.slowRoll
        wheel.group.rotation.y = st.roll / R
        let low: THREE.Mesh | undefined
        let lowZ = Infinity
        for (const r of rollers) {
          r.getWorldPosition(v)
          c.worldToLocal(v)
          if (v.z < lowZ) [low, lowZ] = [r, v.z]
          r.material = rubber
        }
        if (low) low.material = hot

        const prev = st.pose
        st.pose = twistStep(st.pose, q.twist.vx, q.twist.vy, q.twist.w, dt)
        q.s.forEach((s, i) => (st.travel[i] += s * dt))
        if (!inside(st.pose, [RG.fx[0] + 0.08, RG.fx[1] - 0.08], [RG.fy[0] + 0.1, RG.fy[1] - 0.1])) {
          st.pose = startOf(q)
          st.trail = 0
        }
        st.acc += Math.hypot(st.pose.x - prev.x, st.pose.y - prev.y)
        if (st.acc > 0.01) {
          st.acc = 0
          trail.set(st.trail % 160, [st.pose.x, st.pose.y, 0.004], GREY)
          st.trail++
          trail.show(Math.min(160, st.trail))
        }
        bot.set(st.pose, st.travel)
        bot.slip(q.twist.scrub.map((s) => Math.min(1, Math.abs(s) / RG.rim)))
      },
      readouts: (p) => {
        const q = rgParams(p)
        const scrub = Math.max(...q.twist.scrub.map(Math.abs))
        return [
          { label: 'Wheels FL FR RL RR', value: pattern(q.f) },
          { label: 'Net floor force', value: `${q.sum.fx.toFixed(1)} N fwd · ${q.sum.fy.toFixed(1)} N left`, tone: q.layout === 'o' && q.move === 'strafe' ? 'bad' : undefined },
          { label: 'Yaw torque', value: `${q.sum.tz.toFixed(2)} N·m`, tone: q.move === 'spin' ? (q.layout === 'x' ? 'ok' : 'bad') : undefined },
          { label: 'Wheel scrub', value: scrubbing(q) ? `${scrub.toFixed(2)} m/s` : 'none', tone: scrubbing(q) ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Strafe maths: (vx, vy, ω) → four rim speeds; a thumbstick drives the robot round the floor. ---

const MODES = { tour: 'Auto tour', sticks: 'Your sticks' }
const TOUR: { name: string; short: string; t: [number, number, number]; s: number }[] = [
  { name: 'Forward', short: 'Forward', t: [0.25, 0, 0], s: 1.6 },
  { name: 'Strafe left', short: 'Strafe', t: [0, 0.25, 0], s: 1.6 },
  { name: 'Spin left', short: 'Spin L', t: [0, 0, Math.PI / 3.2], s: 1.6 },
  { name: 'Spin right', short: 'Spin R', t: [0, 0, -Math.PI / 3.2], s: 1.6 },
  { name: 'Diagonal back-right', short: 'Diagonal', t: [-0.25, -0.25, 0], s: 1.6 },
  { name: 'Stop', short: 'Stop', t: [0, 0, 0], s: 1 },
]
const TOUR_S = TOUR.reduce((a, x) => a + x.s, 0)
const TOUR_START: Pose = { x: -0.2, y: -0.2, th: 0 }
const SM = { at: [-1.6, -1.9, 0] as V3, k: 18, fx: [-0.42, 0.42] as [number, number], fy: [-0.34, 0.34] as [number, number], bx: 9.2, by: 0.2, gap: 3.8, bh: 1.4, trail: 400 }
const smParams = (p: Params) => ({ tour: pick(MODES, p.mode, 'tour') === 'tour', vx: n(p, 'vx'), vy: n(p, 'vy'), w: n(p, 'w') })
type SmQ = ReturnType<typeof smParams>
function tourAt(t: number) {
  let u = t % TOUR_S
  for (const seg of TOUR) {
    if (u < seg.s) return seg
    u -= seg.s
  }
  return TOUR[TOUR.length - 1]
}
function smCommand(q: SmQ, t: number) {
  const seg = q.tour ? tourAt(t) : undefined
  const [vx, vy, w] = seg ? seg.t : [q.vx, q.vy, q.w]
  const raw = mecInverse(vx, vy, w)
  const { speeds, k } = mecScale(raw, maxRim)
  return { name: seg?.name, short: seg?.short, vx: vx * k, vy: vy * k, w: w * k, raw, speeds, k }
}

export const strafeMaths: Lesson = {
  id: 'mecanum-wheels-strafe-maths',
  title: 'Strafe maths',
  tagline: 'Three stick axes in, four wheel speeds out',
  formula: (p) => {
    const c = smCommand(smParams(p), 0)
    return `FL = vx − vy − (L+W)ω · FR = vx + vy + (L+W)ω · RL = vx + vy − (L+W)ω · RR = vx − vy + (L+W)ω, L+W = ${((L + W) * 1000).toFixed(0)} mm → ${c.speeds.map(speedText).join(' · ')} m/s`
  },
  legend: [
    { color: RING, label: 'Thumbstick: up = forward, side = strafe', shape: 'dot' },
    { color: POWER, label: 'Wheel rolling forward (+)', shape: 'dot' },
    { color: HIGH_V, label: 'Wheel rolling backward (−)', shape: 'dot' },
    { color: HEAT, label: 'Floor forces; their sum drives (green arrow)', shape: 'dot' },
  ],
  points: [
    'A mecanum robot is holonomic: forward vx, sideways vy and turn ω are independent, so the stick maps straight to motion. Each wheel adds the three with its own signs: FL = vx − vy − (L+W)ω, FR = vx + vy + (L+W)ω, RL = vx + vy − (L+W)ω, RR = vx − vy + (L+W)ω, with L and W the half wheelbase and half track.',
    'Read the patterns: forward + + + +; strafe left − + + −; spin left − + − +; diagonal forward-left 0 + + 0: two wheels stop and the other two carry it along their 45° arrows. Mixes add, so you can strafe while turning.',
    'Inverse kinematics gives speeds a motor may not reach (here 0.6 m/s at the rim). Clip one wheel and the direction bends; scale all four by the same factor instead and only the speed drops. Run it forwards (average the four with the same signs) and odometry gets vx, vy and ω back from the encoders.',
    'The rollers make this sound easier than it is: every number assumes each roller grips along its axle. Uneven floors and weight shifts break that, so strafing drifts (see Why they slip).',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'tour' },
    { kind: 'slider', key: 'vx', label: 'Forward vx', min: -0.4, max: 0.4, step: 0.05, initial: 0.2, format: (v) => `${v.toFixed(2)} m/s` },
    { kind: 'slider', key: 'vy', label: 'Strafe left vy', min: -0.4, max: 0.4, step: 0.05, initial: 0.2, format: (v) => `${v.toFixed(2)} m/s` },
    { kind: 'slider', key: 'w', label: 'Turn ω', min: -3, max: 3, step: 0.25, initial: 0, format: (v) => `${v.toFixed(2)} rad/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17, 6.6, 0.3], { size: 0.42, align: 'left' })
    const sub = liveLabel(scene, [-17, 5.7, 0.3], { size: 0.3, color: GREY, align: 'left' })

    const phone = stickPhone(scene, [-13.6, 0.2, 0], 2.2)
    const stickText = liveLabel(scene, [-13.6, -3.6, 0.3], { size: 0.32, color: RING })

    const g = floorView(scene, SM.at, SM.k, -0.55)
    floorMat(g, SM.fx, SM.fy)
    const trail = pointCloud(g, SM.trail, 0.005)
    const bot = mecanumBot(g)
    const glyphs = forceGlyphs(bot.group, 0.06, 0.035)

    addLabel(scene, 'rim speeds, m/s', [SM.bx, SM.by + SM.gap / 2 + SM.bh + 0.9, 0.3], LABEL, 0.38)
    const bars = MEC_WHEELS.map((nm, i) => {
      const x = SM.bx + (i % 2 ? 1 : -1) * 1.6
      const y = SM.by + (i < 2 ? 1 : -1) * (SM.gap / 2)
      box(scene, [1.1, SM.bh * 2, 0.2], mat('#1c1e24', { rough: 0.6 }), [x, y, -0.2])
      stretchRod(addRod(scene, glowMat(GREY, 0.5)), [x - 0.7, y, 0], [x + 0.7, y, 0], 0.03)
      const fill = box(scene, [0.8, 1, 0.3], glowMat(POWER, 0.8), [x, y, 0])
      fill.castShadow = false
      addLabel(scene, nm, [x + (i % 2 ? 0.8 : -0.8), y + 0.5, 0.3], LABEL, 0.32, i % 2 ? 'left' : 'right')
      return { x, y, fill, text: liveLabel(scene, [x + (i % 2 ? 0.8 : -0.8), y - 0.5, 0.3], { size: 0.32, align: i % 2 ? 'left' : 'right' }) }
    })
    addLabel(scene, 'front', [SM.bx, SM.by + SM.gap / 2 + SM.bh + 0.2, 0.3], GREY, 0.28)
    const scaleTag = liveLabel(scene, [SM.bx, SM.by - SM.gap / 2 - SM.bh - 0.6, 0.3], { size: 0.32 })

    const st = { key: '', t: 0, pose: { ...TOUR_START } as Pose, travel: [0, 0, 0, 0] as Wheel4, trail: 0, acc: 0, lap: -1, last: '' }
    return {
      scene,
      view: { center: [-2.2, -0.4, 0], radius: 52, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = smParams(p)
        const key = `${q.tour}|${q.vx}|${q.vy}|${q.w}`
        if (key !== st.key) {
          st.key = key
          Object.assign(st, { t: 0, pose: q.tour ? { ...TOUR_START } : { x: 0, y: 0, th: 0 }, trail: 0, acc: 0, lap: -1, last: '' })
          trail.show(0)
        }
        st.t += dt
        if (q.tour) {
          const lap = Math.floor(st.t / TOUR_S)
          if (lap !== st.lap) {
            st.lap = lap
            st.pose = { ...TOUR_START }
            st.trail = 0
          }
        }
        const c = smCommand(q, st.t)
        const prev = st.pose
        st.pose = twistStep(st.pose, c.vx, c.vy, c.w, dt)
        c.speeds.forEach((s, i) => (st.travel[i] += s * dt))
        if (!q.tour && !inside(st.pose, [SM.fx[0] + 0.12, SM.fx[1] - 0.12], [SM.fy[0] + 0.12, SM.fy[1] - 0.12])) {
          st.pose = { x: 0, y: 0, th: st.pose.th }
          st.trail = 0
        }
        st.acc += Math.hypot(st.pose.x - prev.x, st.pose.y - prev.y)
        if (st.acc > 0.008) {
          st.acc = 0
          trail.set(st.trail % SM.trail, [st.pose.x, st.pose.y, 0.004], GREY)
          st.trail++
          trail.show(Math.min(SM.trail, st.trail))
        }
        bot.set(st.pose, st.travel)
        const f = c.speeds.map((s) => s / 0.25) as Wheel4
        glyphs(f, 'x')
        phone.stick(-c.vy / 0.4, c.vx / 0.4)
        phone.lines[0].set(c.short ?? 'Sticks', LABEL)
        phone.lines[1].set(Math.abs(c.w) > 0.01 ? `twist ${c.w > 0 ? 'left' : 'right'}` : '', RING)
        stickText.set(`vx ${speedText(c.vx)} · vy ${speedText(c.vy)} · ω ${speedText(c.w)}`, RING)
        c.speeds.forEach((s, i) => {
          const b = bars[i]
          const h = Math.max(0.02, (Math.abs(s) / maxRim) * SM.bh)
          b.fill.scale.set(1, h, 1)
          b.fill.position.set(b.x, b.y + (Math.sign(s) * h) / 2, 0)
          const col = s > 1e-6 ? POWER : s < -1e-6 ? HIGH_V : GREY
          ;(b.fill.material as THREE.MeshStandardMaterial).color.set(col)
          ;(b.fill.material as THREE.MeshStandardMaterial).emissive.set(col)
          b.text.set(speedText(s), col)
        })
        scaleTag.set(c.k < 1 ? `all four × ${c.k.toFixed(2)}` : `max ${maxRim} m/s`, c.k < 1 ? HEAT : GREY)
        const word = `${c.name ?? 'Sticks'}: ${pattern(c.speeds)}`
        if (word !== st.last) {
          st.last = word
          status.set(word, LABEL)
        }
        sub.set(q.tour ? `tour ${(st.t % TOUR_S).toFixed(1)} / ${TOUR_S.toFixed(1)} s · real time · 0.5 m tape` : 'real time · 0.5 m tape · wraps to the centre at the edge')
      },
      readouts: (p) => {
        const q = smParams(p)
        const c = smCommand(q, 0)
        if (q.tour) return [{ label: 'Tour patterns FL FR RL RR', value: 'fwd + + + + · strafe − + + − · spin − + − + · diagonal 0 − − 0' }]
        return [
          { label: 'Command vx · vy · ω', value: `${q.vx.toFixed(2)} · ${q.vy.toFixed(2)} · ${q.w.toFixed(2)}` },
          { label: 'Wheels FL FR RL RR', value: c.speeds.map(speedText).join(' ') },
          { label: 'Scale to fit', value: c.k < 1 ? `× ${c.k.toFixed(2)}` : 'none', tone: c.k < 1 ? 'warn' : 'ok' },
          { label: 'Ground speed', value: `${Math.hypot(c.vx, c.vy).toFixed(2)} m/s` },
        ]
      },
    }
  },
}

// --- Why they slip: tiles and weight shifts unload rollers; strafing falls short and yaws unless an IMU holds the heading. ---

const MOVES3: Record<MecMove, string> = { strafe: 'Strafe left', diagonal: 'Diagonal', forward: 'Forward' }
const HEADINGS = { open: 'Open loop', imu: 'IMU heading hold' }
const WS = { at: [-10.8, -1.8, 0] as V3, k: 14, along: [-0.2, 1.0] as [number, number], perp: 0.3, slow: 2, hold: 2, px: 9.4, py: 0.4, pw: 7, ph: 5.2, tiles: 90, loadK: 0.12 }
const wsParams = (p: Params) => ({
  move: pick(MOVES3, p.move, 'strafe') as MecMove,
  bump: n(p, 'bump'),
  cog: n(p, 'cog'),
  imu: pick(HEADINGS, p.head, 'open') === 'imu',
})
type WsQ = ReturnType<typeof wsParams>
const wsKey = (q: WsQ) => `${q.move}|${q.bump}|${q.cog}|${q.imu}`
const wsRun = memoBy(wsKey, (q: WsQ) => {
  const r = mecRun(q.move, q.bump, q.cog, q.imu)
  const top = [2, 5, 10, 20, 45].find((v) => v >= Math.max(...r.frames.map((f) => Math.abs(toDeg(f.pose.th))))) ?? 45
  return { ...r, top }
})
const DIR_ANGLE: Record<MecMove, number> = { strafe: Math.PI / 2, forward: 0, diagonal: Math.PI / 4 }
const headTone = (d: number) => (Math.abs(d) < 1 ? 'ok' : Math.abs(d) < 3 ? 'warn' : 'bad')
const mmText = (m: number) => `${Math.round(m * 1000)} mm`
const PUSH = mecPushLimit(MEC_RUN.mu, MECANUM.massKg)

export const whyTheySlip: Lesson = {
  id: 'mecanum-wheels-why-they-slip',
  title: 'Why they slip',
  tagline: 'Rollers lose the floor, and strafing drifts',
  formula: (p) => {
    const q = wsParams(p)
    const r = wsRun(q)
    return `roller grip ≤ μN along its axle, only cos 45° pushes: ${PUSH.mecanum.toFixed(1)} N vs ${PUSH.tyre.toFixed(1)} N on tyres · N shifts with tiles, CoG, m·a·h/L → yaw ${r.headDeg.toFixed(1)}°, ${mmText(Math.abs(r.offM))} off the line`
  },
  legend: [
    { color: LABEL, label: 'True path (grey line: the plan)', shape: 'dot' },
    { color: POWER, label: 'Load on each wheel (red: nearly lifted)', shape: 'dot' },
    { color: HIGH_V, label: 'Roller slipping along its axle', shape: 'dot' },
    { color: HEAT, label: 'Heading error', shape: 'dot' },
  ],
  points: [
    'Mecanum maths needs all four floor rollers gripping. A rigid chassis on four wheels is one too many for an uneven floor: a 1–2 mm tile edge lifts one diagonal pair off its load, and a strafe needs both diagonals (each pair only pushes along its own 45° line). The robot falls short and veers; driving forward barely notices.',
    'Weight is never even. A battery up front loads the front rollers, and every start and stop shifts more (m·a·h over the wheelbase). Rollers drag as they spin, more under more load, so the front and back drag differently and the robot yaws while it strafes. Each roller hand-off (9 per turn) also jiggles the contact.',
    'Grip costs too: a roller can hold μN along its axle, but only cos 45° of that pushes the robot, so a mecanum robot pushes about 71 % as hard as one on rubber tyres before it slips, and strafing covers a little less ground than the wheels turned.',
    'So mecanum robots close the loop. An IMU gyro holds the heading (turn command ω = k·heading error), which fixes the yaw; sideways drift still needs position feedback (wheel odometry is fooled by slip, so add a lidar, camera or floor tracking sensor).',
  ],
  controls: [
    { kind: 'choice', key: 'move', options: opts(MOVES3), initial: 'strafe' },
    { kind: 'slider', key: 'bump', label: 'Tile unevenness', min: 0, max: 3, step: 0.5, initial: 1.5, format: (v) => `± ${v.toFixed(1)} mm` },
    { kind: 'slider', key: 'cog', label: 'Weight forward', min: 0, max: 40, step: 5, initial: 25, format: (v) => `${v} %` },
    { kind: 'choice', key: 'head', options: opts(HEADINGS), initial: 'open' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-16.5, 6.6, 0.3], { size: 0.38, align: 'left' })
    const sub = liveLabel(scene, [-16.5, 5.7, 0.3], { size: 0.3, color: GREY, align: 'left' })
    const g = floorView(scene, WS.at, WS.k, -0.6)
    const [a0, a1] = WS.along
    flatBox(g, [a1 - a0, 2 * WS.perp, 0.01], mat('#23262d', { rough: 0.85 }), [(a0 + a1) / 2, 0, -0.006])
    const w = add(g, new THREE.Group())
    const tiles = Array.from({ length: WS.tiles }, () => flatBox(w, [MEC_RUN.tileM - 0.006, MEC_RUN.tileM - 0.006, 0.004], mat('#353a44'), [0, 0, 0]))
    const planRod = addRod(w, glowMat(GREY, 0.5))
    const goal = flatBox(w, [0.05, 0.05, 0.004], glowMat(POWER, 0.5), [0, 0, 0.004])
    const path = pointCloud(w, 400, 0.005)
    const bot = mecanumBot(w)
    const loads = [0, 1, 2, 3].map(() => addRod(bot.group, glowMat(POWER, 0.9)))
    const floorTag = liveLabel(g, [a1, -WS.perp - 0.05, 0.01], { size: 0.03, color: GREY, align: 'right' })

    const plot = scope(scene, WS.pw, WS.ph, { divs: [9, 4] })
    plot.group.position.set(WS.px, WS.py, 0)
    const trace = plot.trace(HEAT, { samples: 400, radius: 0.07 })
    const cur = cursorBar(plot, LABEL, 0.06)
    const top = WS.py + WS.ph / 2 + 0.9
    addLabel(scene, 'heading error', [WS.px - WS.pw / 2, top, 0.3], HEAT, 0.34, 'left')
    const topTag = liveLabel(scene, [WS.px + WS.pw / 2, top, 0.3], { size: 0.34, color: GREY, align: 'right' })
    addLabel(scene, `0 … ${MEC_RUN.seconds} s`, [WS.px, WS.py - WS.ph / 2 - 1, 0.3], GREY, 0.34)
    const endTag = liveLabel(scene, [WS.px - WS.pw / 2, WS.py - WS.ph / 2 - 2.2, 0.3], { size: 0.36, align: 'left' })

    const clock = simClock(MEC_RUN.dt * MEC_RUN.every * WS.slow, WS.hold)
    const st = { key: '', us: [] as number[], ys: [] as number[] }
    const n0 = (MECANUM.massKg * 9.81) / 4
    return {
      scene,
      view: { center: [-1.5, 0, 0], radius: 52, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = wsParams(p)
        const key = wsKey(q)
        const r = wsRun(q)
        const i = Math.floor(clock(dt, key, r.frames.length - 1))
        const f = r.frames[i]
        if (key !== st.key) {
          st.key = key
          const ang = DIR_ANGLE[q.move]
          w.rotation.z = -ang
          const [dx, dy] = [Math.cos(ang), Math.sin(ang)]
          const tm = MEC_RUN.tileM
          let k = 0
          for (let ix = -8; ix <= 8; ix++)
            for (let iy = -8; iy <= 8; iy++) {
              const [cx, cy] = [(ix + 0.5) * tm, (iy + 0.5) * tm]
              const al = cx * dx + cy * dy
              const pe = -cx * dy + cy * dx
              if (al < a0 + tm / 2 - 0.02 || al > a1 - tm / 2 + 0.02 || Math.abs(pe) > WS.perp - tm / 2 + 0.02 || k >= WS.tiles) continue
              const h = q.bump > 0 ? tileHeight(cx, cy, q.bump / 1000) / (q.bump / 1000) : 0
              const shade = Math.round(46 + h * 30)
              const hex = `#${[shade, shade + 4, shade + 12].map((v) => v.toString(16).padStart(2, '0')).join('')}`
              tiles[k].material = mat(hex, { rough: 0.8 })
              tiles[k].position.set(cx, cy, 0.002)
              tiles[k].visible = true
              k++
            }
          for (; k < WS.tiles; k++) tiles[k].visible = false
          stretchRod(planRod, [0, 0, 0.005], [MEC_RUN.dist * dx, MEC_RUN.dist * dy, 0.005], 0.003)
          goal.position.set(MEC_RUN.dist * dx, MEC_RUN.dist * dy, 0.004)
          r.frames.forEach((h, j) => path.set(j, [h.pose.x, h.pose.y, 0.007], LABEL))
          floorTag.set(q.bump > 0 ? `20 cm tiles, ± ${q.bump} mm (darker = lower) · wood, μ ${MEC_RUN.mu}` : `flat floor · wood, μ ${MEC_RUN.mu}`, GREY)
          const yOf = (th: number) => Math.max(-0.5, Math.min(0.5, toDeg(th) / r.top / 2)) * WS.ph * 0.96
          st.us = r.frames.map((h) => h.t / MEC_RUN.seconds)
          st.ys = r.frames.map((h) => yOf(h.pose.th))
          topTag.set(`± ${r.top}°`, GREY)
        }
        path.show(i + 1)
        trace.points(st.us.slice(0, i + 1), st.ys.slice(0, i + 1))
        cur(f.t / MEC_RUN.seconds)
        bot.set(f.pose, f.travel)
        bot.slip(f.slip.map((s) => Math.min(1, s / 0.08)))
        mecWheels().forEach((k, j) => {
          const u = f.loads[j] / n0
          stretchRod(loads[j], [k.x, k.y, 0.075], [k.x, k.y, 0.075 + Math.max(0.002, u * WS.loadK)], 0.009)
          const m = loads[j].material as THREE.MeshStandardMaterial
          const col = u < 0.15 ? HIGH_V : POWER
          m.color.set(col)
          m.emissive.set(col)
        })
        const done = i >= r.frames.length - 1
        const head = toDeg(f.pose.th)
        const lifted = MEC_WHEELS.filter((_, j) => f.loads[j] < 0.15 * n0)
        status.set(
          done
            ? `${MOVES3[q.move]} 0.8 m ${q.imu ? 'with IMU hold' : 'open loop'}: yawed ${r.headDeg.toFixed(1)}°, ${mmText(Math.abs(r.offM))} off the line, ${mmText(r.shortM)} short`
            : `${MOVES3[q.move]} 0.8 m${lifted.length ? ` · ${lifted.join(' ')} nearly lifted` : ''}`,
          done ? (headTone(r.headDeg) === 'ok' && Math.abs(r.offM) < 0.03 ? POWER : HEAT) : lifted.length ? HIGH_V : LABEL,
        )
        sub.set(`1.6 kg, 170 × 200 mm, CoG ${q.cog} % forward · ${WS.slow}× slower · t ${f.t.toFixed(2)} s`)
        endTag.set(`now ${head >= 0 ? '+' : ''}${head.toFixed(1)}°${q.imu ? ' (gyro corrects it)' : ''}`, headTone(head) === 'ok' ? POWER : HEAT)
      },
      readouts: (p) => {
        const r = wsRun(wsParams(p))
        return [
          { label: 'Heading at the end', value: `${r.headDeg.toFixed(1)}°`, tone: headTone(r.headDeg) },
          { label: 'Off the line · short', value: `${mmText(Math.abs(r.offM))} · ${mmText(r.shortM)}`, tone: Math.abs(r.offM) + Math.abs(r.shortM) < 0.05 ? 'ok' : Math.abs(r.offM) + Math.abs(r.shortM) < 0.12 ? 'warn' : 'bad' },
          { label: 'A wheel nearly lifted', value: `${Math.round(r.liftedPct)} % of the time`, tone: r.liftedPct < 5 ? 'ok' : r.liftedPct < 30 ? 'warn' : 'bad' },
          { label: 'Push before slipping', value: `${PUSH.mecanum.toFixed(1)} N vs ${PUSH.tyre.toFixed(1)} N tyres (71 %)` },
        ]
      },
    }
  },
}
