import {
  HoloDrive,
  OMNI,
  OmniBase,
  Pose,
  SWERVE,
  SWERVE_MODS,
  holoTopSpeed,
  omniInverse,
  omniSideSlip,
  omniWheels,
  swerveDesat,
  swerveFit,
  swerveModules,
  swerveStates,
  swerveTick,
  toDeg,
  twistStep,
} from '../../core/physics'
import { signText, velocityText } from '../../core/units'
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
  TOUR_MODES,
  TourSeg,
  addLabel,
  addRod,
  floorMat,
  floorTrail,
  floorView,
  glowMat,
  inField,
  liveLabel,
  omniBot,
  pointCloud,
  stickPhone,
  stretchArrow,
  stretchRod,
  swerveBot,
  tourAt,
  tourLength,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

// --- Omni wheels: rollers at 90° slide sideways; kiwi and X bases, wheel speeds from (vx, vy, ω), top speed vs mecanum. ---

const BASES: Record<OmniBase, string> = { kiwi: 'Kiwi (3 × 120°)', x: 'X (4 × 90°)' }
const OM_TOUR: TourSeg[] = [
  { name: 'Forward', short: 'Forward', t: [0.25, 0, 0], s: 1.6 },
  { name: 'Strafe left', short: 'Strafe', t: [0, 0.25, 0], s: 1.6 },
  { name: 'Spin left', short: 'Spin L', t: [0, 0, Math.PI / 3.2], s: 1.6 },
  { name: 'Spin right', short: 'Spin R', t: [0, 0, -Math.PI / 3.2], s: 1.6 },
  { name: 'Diagonal back-right', short: 'Diagonal', t: [-0.25, -0.25, 0], s: 1.6 },
  { name: 'Stop', short: 'Stop', t: [0, 0, 0], s: 1 },
]
const OM_S = tourLength(OM_TOUR)
const OM_START: Pose = { x: -0.2, y: -0.2, th: 0 }
const OM = { at: [-2.2, -1.8, 0] as V3, k: 21, fx: [-0.36, 0.36] as [number, number], fy: [-0.34, 0.34] as [number, number], kV: 0.32, px: 9.9, py: 0.2, pk: 3.4 }
const DRIVES: { d: HoloDrive; name: string }[] = [
  { d: 'kiwi', name: 'kiwi' },
  { d: 'x', name: 'X omni' },
  { d: 'mecanum', name: 'mecanum' },
]
const omParams = (p: Params) => ({ base: pick(BASES, p.base, 'kiwi'), tour: pick(TOUR_MODES, p.mode, 'tour') === 'tour', vx: n(p, 'vx'), vy: n(p, 'vy'), w: n(p, 'w') })
type OmQ = ReturnType<typeof omParams>
const OM_FORMULA: Record<OmniBase, string> = {
  kiwi: 'FL = 0.87vx − 0.5vy − rω · FR = 0.87vx + 0.5vy + rω · B = vy − rω, r = 115 mm',
  x: 'FL = 0.71(vx − vy) − rω · FR = 0.71(vx + vy) + rω · RL = 0.71(vx + vy) − rω · RR = 0.71(vx − vy) + rω, r = 125 mm',
}

function omCommand(q: OmQ, t: number) {
  const seg = q.tour ? tourAt(OM_TOUR, t % OM_S) : undefined
  const [vx0, vy0, w0] = seg ? seg.t : [q.vx, q.vy, q.w]
  const raw = omniInverse(vx0, vy0, w0, q.base)
  const k = Math.min(1, OMNI.maxRim / Math.max(...raw.map(Math.abs), 1e-12))
  const [vx, vy, w] = [vx0 * k, vy0 * k, w0 * k]
  return { name: seg?.name, short: seg?.short, vx, vy, w, k, speeds: raw.map((s) => s * k), side: omniSideSlip(vx, vy, w, q.base) }
}

export const omniWheelsLesson: Lesson = {
  id: 'omni-swerve-omni-wheels',
  title: 'Omni wheels',
  tagline: 'Rollers at 90°: push one way, slide the other',
  formula: (p) => {
    const q = omParams(p)
    const c = omCommand(q, 0)
    return `s = vx·cos d + vy·sin d + ω(x sin d − y cos d): ${OM_FORMULA[q.base]} → ${c.speeds.map(velocityText).join(' · ')} m/s`
  },
  legend: [
    { color: RING, label: 'Thumbstick: up = forward, side = strafe', shape: 'dot' },
    { color: HEAT, label: 'Rolling speed each motor drives', shape: 'dot' },
    { color: B_FIELD, label: 'Sideways slide the free rollers take', shape: 'dot' },
    { color: POWER, label: 'Chassis velocity; top speed of this base', shape: 'dot' },
  ],
  points: [
    'An omni wheel carries small free rollers whose axles run around its rim, 90° to the wheel axle: it drives along its rolling direction and slides freely sideways. Point the wheels different ways and their pushes add up to any vx, vy and ω, holonomic like Mecanum wheels but with plain rollers.',
    'Each motor drives the chassis velocity at its wheel projected on its rolling direction: s = vx·cos d + vy·sin d + ω·r. Kiwi has three wheels at 120°, so three speeds give exactly three motions and no wheel fights another. Going forward the back wheel only slides and the front two roll at cos 30°; a strafe is mostly the back wheel.',
    'The X base angles four wheels at 45° on the diagonals and reads like mecanum: forward + + + +, strafe left − + + −, spin left − + − +. Each wheel sees only cos 45° of the motion, a built-in 1.41:1 gear: rims spin slower, top speed is 41 % higher forwards, but the push is 71 %. Four wheels for three motions, so mismatched speeds scrub.',
    'Versus mecanum: same 3-DOF maths, but mecanum wheels sit parallel in a normal rectangular chassis and carry more weight, while omni bases need angled mounts and more room. Omni rollers are short, so the contact hops between the two rows (a buzz on hard floors, trouble on carpet and bumps). Kiwi keeps all three wheels on any floor; four-wheel bases rock (see Why they slip).',
  ],
  controls: [
    { kind: 'choice', key: 'base', options: opts(BASES), initial: 'kiwi' },
    { kind: 'choice', key: 'mode', options: opts(TOUR_MODES), initial: 'tour' },
    { kind: 'slider', key: 'vx', label: 'Forward vx', min: -0.4, max: 0.4, step: 0.05, initial: 0.2, format: (v) => `${v.toFixed(2)} m/s` },
    { kind: 'slider', key: 'vy', label: 'Strafe left vy', min: -0.4, max: 0.4, step: 0.05, initial: 0.1, format: (v) => `${v.toFixed(2)} m/s` },
    { kind: 'slider', key: 'w', label: 'Turn ω', min: -3, max: 3, step: 0.25, initial: 0, format: (v) => `${v.toFixed(2)} rad/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17, 6.6, 0.3], { size: 0.42, align: 'left' })
    const sub = liveLabel(scene, [-17, 5.7, 0.3], { size: 0.3, color: GREY, align: 'left' })
    const phone = stickPhone(scene, [-13.6, 0.2, 0], 2.2)
    const stickText = liveLabel(scene, [-13.6, -3.6, 0.3], { size: 0.32, color: RING })

    const g = floorView(scene, OM.at, OM.k, -0.55)
    floorMat(g, OM.fx, OM.fy)
    const trail = floorTrail(g, 400, 0.008)
    const bots: Record<OmniBase, ReturnType<typeof omniBot>> = { kiwi: omniBot(g, 'kiwi'), x: omniBot(g, 'x') }
    const roll = [0, 1, 2, 3].map(() => ({ kiwi: stretchArrow(bots.kiwi.group, HEAT, 0.0035), x: stretchArrow(bots.x.group, HEAT, 0.0035) }))
    const slide = [0, 1, 2, 3].map(() => ({ kiwi: stretchArrow(bots.kiwi.group, B_FIELD, 0.003), x: stretchArrow(bots.x.group, B_FIELD, 0.003) }))
    const netArrow = { kiwi: stretchArrow(bots.kiwi.group, POWER, 0.005), x: stretchArrow(bots.x.group, POWER, 0.005) }
    const wheelTags = [0, 1, 2, 3].map(() => liveLabel(g, [0, 0, 0], { size: 0.022 }))
    wheelTags.forEach((t) => (t.group.rotation.x = 0.55))

    const { px, py, pk } = OM
    const P = (a: number, r: number): V3 => [px - Math.sin(a) * r * pk, py + Math.cos(a) * r * pk, 0.1]
    addLabel(scene, 'top speed by direction', [px, py + 4.1, 0.3], LABEL, 0.34)
    addLabel(scene, `(no rim over ${OMNI.maxRim} m/s)`, [px, py + 3.55, 0.3], GREY, 0.28)
    const axisM = glowMat(GREY, 0.35)
    stretchRod(addRod(scene, axisM), P(0, 0.9), P(Math.PI, 0.9), 0.025)
    stretchRod(addRod(scene, axisM), P(Math.PI / 2, 0.9), P(-Math.PI / 2, 0.9), 0.025)
    addLabel(scene, 'fwd', [px + 0.3, py + 0.9 * pk - 0.2, 0.3], GREY, 0.26, 'left')
    addLabel(scene, 'left', [px - 0.9 * pk, py - 0.45, 0.3], GREY, 0.26)
    const curves = DRIVES.map(() => {
      const c = pointCloud(scene, 180, 0.06)
      c.show(180)
      return c
    })
    const curveTags = DRIVES.map(() => liveLabel(scene, [0, 0, 0.3], { size: 0.28 }))
    const dirArrow = stretchArrow(scene, POWER, 0.06)
    const topDot = pointCloud(scene, 1, 0.16)
    const topText = liveLabel(scene, [px, py - 4.2, 0.3], { size: 0.26 })

    const st = { key: '', base: '' as OmniBase | '', t: 0, pose: { ...OM_START } as Pose, travel: [0, 0, 0, 0], side: [0, 0, 0, 0], lap: -1, last: '' }
    return {
      scene,
      view: { center: [-2.2, -0.4, 0], radius: 52, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = omParams(p)
        const key = `${q.base}|${q.tour}|${q.vx}|${q.vy}|${q.w}`
        if (key !== st.key) {
          st.key = key
          Object.assign(st, { t: 0, pose: q.tour ? { ...OM_START } : { x: 0, y: 0, th: 0 }, lap: -1, last: '' })
          trail.clear()
        }
        if (q.base !== st.base) {
          st.base = q.base
          bots.kiwi.group.visible = q.base === 'kiwi'
          bots.x.group.visible = q.base === 'x'
          DRIVES.forEach(({ d }, j) => {
            const col = d === q.base ? POWER : d === 'mecanum' ? HIGH_V : GREY
            for (let i = 0; i < 180; i++) {
              const a = (i / 180) * 2 * Math.PI
              curves[j].set(i, P(a, holoTopSpeed(d, a)), col, d === q.base ? 1 : 0.6)
            }
            curves[j].show(180)
            const a = d === 'mecanum' ? (3 * Math.PI) / 4 : d === 'x' ? Math.PI : (-3 * Math.PI) / 4
            const at = P(a, holoTopSpeed(d, a) + 0.14)
            curveTags[j].group.position.set(at[0], at[1], 0.3)
            curveTags[j].set(DRIVES[j].name, col)
          })
        }
        st.t += dt
        if (q.tour) {
          const lap = Math.floor(st.t / OM_S)
          if (lap !== st.lap) {
            st.lap = lap
            st.pose = { ...OM_START }
            trail.clear()
          }
        }
        const c = omCommand(q, st.t)
        const prev = st.pose
        st.pose = twistStep(st.pose, c.vx, c.vy, c.w, dt)
        c.speeds.forEach((s, i) => (st.travel[i] += s * dt))
        c.side.forEach((s, i) => (st.side[i] += s * dt))
        if (!q.tour && !inField(st.pose, [OM.fx[0] + 0.14, OM.fx[1] - 0.14], [OM.fy[0] + 0.14, OM.fy[1] - 0.14])) {
          st.pose = { x: 0, y: 0, th: st.pose.th }
          trail.clear()
        } else trail.add(prev, st.pose)
        const bot = bots[q.base]
        bot.set(st.pose, st.travel, st.side)
        const ws = omniWheels(q.base)
        const z = 0.09
        for (let i = 0; i < 4; i++) {
          const k = ws[i]
          const tag = wheelTags[i]
          tag.group.visible = !!k
          if (!k) {
            roll[i][q.base]([0, 0, z], [0, 0, z])
            slide[i][q.base]([0, 0, z], [0, 0, z])
            continue
          }
          const [cd, sd] = [Math.cos(k.d), Math.sin(k.d)]
          const [s, sl] = [c.speeds[i] * OM.kV, c.side[i] * OM.kV]
          roll[i][q.base]([k.x, k.y, z], [k.x + s * cd, k.y + s * sd, z])
          slide[i][q.base]([k.x, k.y, z + 0.003], [k.x - sl * sd, k.y + sl * cd, z + 0.003])
          const r = Math.hypot(k.x, k.y) + 0.1
          const phi = Math.atan2(k.y, k.x) + st.pose.th
          tag.group.position.set(st.pose.x + r * Math.cos(phi), st.pose.y + r * Math.sin(phi), 0.03)
          tag.set(`${k.name} ${velocityText(c.speeds[i])}`, Math.abs(c.speeds[i]) < 1e-6 ? GREY : HEAT)
        }
        netArrow[q.base]([0, 0, z + 0.01], [c.vx * OM.kV, c.vy * OM.kV, z + 0.01])
        const v = Math.hypot(c.vx, c.vy)
        const a = Math.atan2(c.vy, c.vx)
        dirArrow(P(0, 0), P(a, v))
        const top = holoTopSpeed(q.base, a)
        topDot.set(0, P(a, top), v > 1e-6 ? POWER : GREY)
        topDot.show(v > 1e-6 ? 1 : 0)
        topText.set(v > 1e-6 ? `max ${top.toFixed(2)} m/s · mecanum ${holoTopSpeed('mecanum', a).toFixed(2)}` : 'spin or stop: no direction', v > 1e-6 ? POWER : GREY)
        phone.stick(-c.vy / 0.4, c.vx / 0.4)
        phone.lines[0].set(c.short ?? 'Sticks', LABEL)
        phone.lines[1].set(Math.abs(c.w) > 0.01 ? `twist ${c.w > 0 ? 'left' : 'right'}` : '', RING)
        stickText.set(`vx ${velocityText(c.vx)} · vy ${velocityText(c.vy)} · ω ${velocityText(c.w)}`, RING)
        const word = `${BASES[q.base]}, ${c.name ?? 'sticks'}: ${c.speeds.map(signText).join(' ')}`
        if (word !== st.last) {
          st.last = word
          status.set(word, LABEL)
        }
        sub.set(
          q.tour
            ? `tour ${(st.t % OM_S).toFixed(1)} / ${OM_S.toFixed(1)} s · real time · 0.5 m tape`
            : `real time · 0.5 m tape${c.k < 1 ? ` · all wheels × ${c.k.toFixed(2)} to fit ${OMNI.maxRim} m/s` : ''}`,
        )
      },
      readouts: (p) => {
        const q = omParams(p)
        const names = omniWheels(q.base).map((k) => k.name).join(' ')
        if (q.tour)
          return [
            { label: `Tour patterns ${names}`, value: q.base === 'kiwi' ? 'fwd + + 0 · strafe − + + · spin − + −' : 'fwd + + + + · strafe − + + − · spin − + − +' },
            { label: 'Top speed fwd · strafe', value: `${holoTopSpeed(q.base, 0).toFixed(2)} · ${holoTopSpeed(q.base, Math.PI / 2).toFixed(2)} m/s (mecanum ${OMNI.maxRim})` },
          ]
        const c = omCommand(q, 0)
        const v = Math.hypot(c.vx, c.vy)
        return [
          { label: 'Command vx · vy · ω', value: `${q.vx.toFixed(2)} · ${q.vy.toFixed(2)} · ${q.w.toFixed(2)}` },
          { label: `Wheels ${names}`, value: c.speeds.map(velocityText).join(' ') },
          { label: 'Scale to fit', value: c.k < 1 ? `× ${c.k.toFixed(2)}` : 'none', tone: c.k < 1 ? 'warn' : 'ok' },
          { label: 'Top speed this way', value: v > 1e-6 ? `${holoTopSpeed(q.base, Math.atan2(c.vy, c.vx)).toFixed(2)} m/s` : '—' },
        ]
      },
    }
  },
}

// --- Swerve module: a vector per module from the chassis twist, shortest-turn flips, steering lag that scrubs. ---

const OPTS = { short: 'Shortest turn (flip ≤ 90°)', fwd: 'Always roll forward' }
const SW_TOUR: TourSeg[] = [
  { name: 'Forward', short: 'Forward', t: [0.7, 0, 0], s: 1.2 },
  { name: 'Reverse', short: 'Reverse', t: [-0.7, 0, 0], s: 1.2 },
  { name: 'Strafe left', short: 'Strafe L', t: [0, 0.7, 0], s: 0.6 },
  { name: 'Spin left', short: 'Spin', t: [0, 0, Math.PI], s: 2 },
  { name: 'Strafe right', short: 'Strafe R', t: [0, -0.7, 0], s: 0.6 },
  { name: 'Stop', short: 'Stop', t: [0, 0, 0], s: 0.8 },
]
const SW_S = tourLength(SW_TOUR)
const SW_START: Pose = { x: -0.42, y: -0.21, th: 0 }
const SW = { at: [-2.4, -1.8, 0] as V3, k: 8, fx: [-0.95, 0.95] as [number, number], fy: [-0.78, 0.78] as [number, number], slow: 0.5, kV: 0.22, dx: 9.6, dy: 0.8, gap: 3.1, dr: 1.15 }
const swParams = (p: Params) => ({
  tour: pick(TOUR_MODES, p.mode, 'tour') === 'tour',
  shortest: pick(OPTS, p.opt, 'short') === 'short',
  rate: (n(p, 'rate') * Math.PI) / 180,
  vx: n(p, 'vx'),
  vy: n(p, 'vy'),
  w: n(p, 'w'),
})
type SwQ = ReturnType<typeof swParams>
const degText = (a: number) => `${Math.round(toDeg(Math.atan2(Math.sin(a), Math.cos(a))))}°`

function swCommand(q: SwQ, t: number) {
  const seg = q.tour ? tourAt(SW_TOUR, t % SW_S) : undefined
  const [vx, vy, w] = seg ? seg.t : [q.vx, q.vy, q.w]
  const raw = swerveStates(vx, vy, w)
  const { states, k } = swerveDesat(raw, SWERVE.maxSpeed)
  return { name: seg?.name, short: seg?.short, vx: vx * k, vy: vy * k, w: w * k, states, k }
}

export const swerveModule: Lesson = {
  id: 'omni-swerve-swerve-module',
  title: 'Swerve module',
  tagline: 'Every wheel steers: one vector per module',
  formula: (p) => {
    const q = swParams(p)
    const s = swCommand(q, 0).states[0]
    return `module at (x, y): v = (vx − ω·y, vy + ω·x) → angle = atan2(v), speed = |v| · if |angle − now| > 90°: angle ± 180°, speed × −1 · FL now ${degText(s.angle)}, ${s.speed.toFixed(2)} m/s`
  },
  legend: [
    { color: POWER, label: 'Drive motor; wheel vector (red: rolling backwards)', shape: 'dot' },
    { color: B_FIELD, label: 'Steer motor turning the module', shape: 'dot' },
    { color: GREY, label: 'Target vector from the chassis twist', shape: 'dot' },
    { color: HIGH_V, label: 'Tyre scrubbing sideways', shape: 'dot' },
  ],
  points: [
    'A swerve module is a wheel on a turntable with two motors: a drive motor rolls the wheel, a steer motor turns the whole module (with an absolute encoder for its angle). Four of them make an FRC-style robot fully holonomic on plain grippy tyres: no rollers, so it pushes as hard as a tank drive in any direction.',
    'Inverse kinematics is one vector per module: the chassis velocity at that corner, v = (vx − ω·y, vy + ω·x). Its direction is the module angle, its length the drive speed. Driving straight, all four point the same way; spinning, they sit tangent to a circle; both together, they mix (Mecanum wheels has the vx, vy, ω basics). Scale all four down together if one exceeds top speed.',
    'Never turn a module more than 90°: a wheel pointing backwards that rolls backwards gives the same vector. Reversing then costs no steering at all, just a sign flip on the drive motor. Without it, each reversal swings the modules 180° while the wheels keep pushing the old way.',
    'The steer motor needs time to turn, so after every change of command the wheels push in stale directions. If the modules disagree the chassis can only follow one compromise and the tyres scrub sideways (red patches): wear, current spikes, a wobble in the path. Real code also scales drive speed by cos(steer error) so a wheel waits until it points roughly right.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(TOUR_MODES), initial: 'tour' },
    { kind: 'choice', key: 'opt', options: opts(OPTS), initial: 'short' },
    { kind: 'slider', key: 'rate', label: 'Steer speed', min: 90, max: 1440, step: 30, initial: 540, format: (v) => `${v}°/s` },
    { kind: 'slider', key: 'vx', label: 'Forward vx', min: -2, max: 2, step: 0.25, initial: 1, format: (v) => `${v.toFixed(2)} m/s` },
    { kind: 'slider', key: 'vy', label: 'Strafe left vy', min: -2, max: 2, step: 0.25, initial: 0, format: (v) => `${v.toFixed(2)} m/s` },
    { kind: 'slider', key: 'w', label: 'Turn ω', min: -4, max: 4, step: 0.5, initial: 0, format: (v) => `${v.toFixed(2)} rad/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17, 6.6, 0.3], { size: 0.42, align: 'left' })
    const sub = liveLabel(scene, [-17, 5.7, 0.3], { size: 0.3, color: GREY, align: 'left' })
    const event = liveLabel(scene, [-17, 4.9, 0.3], { size: 0.32, align: 'left' })
    const phone = stickPhone(scene, [-13.6, 0.2, 0], 2.2)
    const stickText = liveLabel(scene, [-13.6, -3.6, 0.3], { size: 0.32, color: RING })

    const g = floorView(scene, SW.at, SW.k, -0.55)
    floorMat(g, SW.fx, SW.fy)
    const trail = floorTrail(g, 400, 0.025)
    const bot = swerveBot(g)
    const z = 0.26
    const mods = swerveModules()
    const wheelVec = mods.map(() => stretchArrow(bot.group, POWER, 0.012))
    const targetVec = mods.map(() => stretchArrow(bot.group, GREY, 0.008))

    addLabel(scene, 'modules, front up', [SW.dx, SW.dy + SW.gap / 2 + SW.dr + 1.0, 0.3], LABEL, 0.34)
    const dials = SWERVE_MODS.map((nm, i) => {
      const x = SW.dx + (i % 2 ? 1 : -1) * (SW.gap / 2)
      const y = SW.dy + (i < 2 ? 1 : -1) * (SW.gap / 2)
      const dots = pointCloud(scene, 48, 0.035)
      for (let j = 0; j < 48; j++) dots.set(j, [x + Math.cos((j / 48) * 2 * Math.PI) * SW.dr, y + Math.sin((j / 48) * 2 * Math.PI) * SW.dr, 0], GREY, 0.7)
      dots.show(48)
      addLabel(scene, nm, [x + (i % 2 ? 1 : -1) * (SW.dr + 0.2), y + SW.dr - 0.2, 0.3], LABEL, 0.3, i % 2 ? 'left' : 'right')
      return {
        x,
        y,
        wheel: addRod(scene, glowMat(LABEL, 0.6)),
        target: stretchArrow(scene, GREY, 0.035),
        vec: stretchArrow(scene, POWER, 0.05),
        text: liveLabel(scene, [x, y - SW.dr - 0.4, 0.3], { size: 0.26 }),
      }
    })

    const st = { key: '', t: 0, pose: { ...SW_START } as Pose, angles: [0, 0, 0, 0], travel: [0, 0, 0, 0], lap: -1, last: '', flipT: -9, scrubM: 0, flips: [false, false, false, false] }
    return {
      scene,
      view: { center: [-2.2, -0.4, 0], radius: 52, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = swParams(p)
        const key = `${q.tour}|${q.shortest}|${q.rate}`
        if (key !== st.key) {
          st.key = key
          Object.assign(st, { t: 0, pose: q.tour ? { ...SW_START } : { x: 0, y: 0, th: 0 }, angles: [0, 0, 0, 0], lap: -1, last: '', flipT: -9, scrubM: 0 })
          trail.clear()
        }
        const h = dt * SW.slow
        st.t += h
        if (q.tour) {
          const lap = Math.floor(st.t / SW_S)
          if (lap !== st.lap) {
            st.lap = lap
            st.pose = { ...SW_START }
            st.scrubM = 0
            trail.clear()
          }
        }
        const c = swCommand(q, st.t)
        const m = swerveTick(st.angles, c.states, { rate: q.rate, shortest: q.shortest }, h)
        st.angles = m.map((s) => s.angle)
        const fit = swerveFit(m)
        const prev = st.pose
        st.pose = twistStep(st.pose, fit.vx, fit.vy, fit.w, h)
        m.forEach((s, i) => (st.travel[i] += s.speed * h))
        st.scrubM += fit.scrub.reduce((a, v) => a + v, 0) * h
        if (!q.tour && !inField(st.pose, [SW.fx[0] + 0.38, SW.fx[1] - 0.38], [SW.fy[0] + 0.38, SW.fy[1] - 0.38])) {
          st.pose = { x: 0, y: 0, th: st.pose.th }
          trail.clear()
        } else trail.add(prev, st.pose)
        bot.set(st.pose, st.angles, st.travel)
        bot.glow(
          m.map((s) => Math.min(1, Math.abs(s.speed) / 1.5)),
          m.map((s) => Math.min(1, Math.abs(s.error) / 0.3)),
          fit.scrub.map((s) => Math.min(1, s / 0.4)),
        )
        if (m.some((s, i) => s.flipped && !st.flips[i])) st.flipT = st.t
        st.flips = m.map((s) => s.flipped)
        const maxErr = Math.max(...m.map((s) => Math.abs(s.error)))
        const maxScrub = Math.max(...fit.scrub)
        mods.forEach((md, i) => {
          const s = m[i]
          const t = c.states[i]
          const back = s.speed < -1e-6
          const col = back ? HIGH_V : POWER
          const [ca, sa] = [Math.cos(s.angle), Math.sin(s.angle)]
          wheelVec[i]([md.x, md.y, z], [md.x + s.speed * ca * SW.kV, md.y + s.speed * sa * SW.kV, z], col)
          targetVec[i]([md.x, md.y, z + 0.01], [md.x + t.speed * Math.cos(t.angle) * SW.kV, md.y + t.speed * Math.sin(t.angle) * SW.kV, z + 0.01])
          const d = dials[i]
          const S = (a: number, r: number): V3 => [d.x - Math.sin(a) * r, d.y + Math.cos(a) * r, 0.1]
          const half = SW.dr * 0.55
          const [a0, a1] = [S(s.angle, half), S(s.angle + Math.PI, half)]
          stretchRod(d.wheel, [a0[0], a0[1], 0.05], [a1[0], a1[1], 0.05], 0.09)
          d.target(S(0, 0), S(t.angle, t.speed > 1e-6 ? SW.dr * 0.95 : 0))
          const L = Math.min(SW.dr * 0.95, (Math.abs(s.speed) / 1.5) * SW.dr)
          d.vec(S(0, 0), S(back ? s.angle + Math.PI : s.angle, L), col)
          d.text.set(`${degText(s.angle)} ${velocityText(s.speed)}`, back ? HIGH_V : Math.abs(s.error) > 0.05 ? B_FIELD : LABEL)
        })
        phone.stick(-c.vy / 2, c.vx / 2)
        phone.lines[0].set(c.short ?? 'Sticks', LABEL)
        phone.lines[1].set(Math.abs(c.w) > 0.01 ? `twist ${c.w > 0 ? 'left' : 'right'}` : '', RING)
        stickText.set(`vx ${velocityText(c.vx)} · vy ${velocityText(c.vy)} · ω ${velocityText(c.w)}`, RING)
        const word = c.name ?? 'Sticks'
        if (word !== st.last) {
          st.last = word
          status.set(word, LABEL)
        }
        const flipNames = SWERVE_MODS.filter((_, i) => m[i].speed < -1e-6).join(', ')
        const parts = [
          st.t - st.flipT < 0.4 && flipNames ? `flip: ${flipNames} roll backwards` : '',
          maxErr > 0.05 ? `steering, ${Math.round(toDeg(maxErr))}° to go` : '',
          maxScrub > 0.05 ? 'tyres scrub' : '',
        ].filter(Boolean)
        event.set(parts.length ? parts.join(' · ') : 'modules on target', maxScrub > 0.05 || parts[0]?.startsWith('flip') ? HIGH_V : parts.length ? B_FIELD : GREY)
        sub.set(`${q.tour ? `tour ${(st.t % SW_S).toFixed(1)} / ${SW_S.toFixed(1)} s · ` : ''}½ × real time · scrubbed ${st.scrubM.toFixed(2)} m · 0.5 m tape`)
      },
      readouts: (p) => {
        const q = swParams(p)
        const t90 = Math.PI / 2 / q.rate
        const out = [
          { label: 'Steer speed', value: `90° in ${(t90 * 1000).toFixed(0)} ms, 180° in ${(2 * t90 * 1000).toFixed(0)} ms` },
          { label: 'Reversal', value: q.shortest ? 'flip the drive sign, 0° turn' : 'turn 180°', tone: q.shortest ? ('ok' as const) : ('warn' as const) },
        ]
        if (q.tour) return out
        const c = swCommand(q, 0)
        return [
          out[0],
          { label: 'Module angles FL FR RL RR', value: c.states.map((s) => (s.speed > 1e-6 ? degText(s.angle) : '—')).join(' ') },
          { label: 'Module speeds', value: `${c.states.map((s) => s.speed.toFixed(2)).join(' ')} m/s${c.k < 1 ? ` (× ${c.k.toFixed(2)})` : ''}` },
        ]
      },
    }
  },
}
