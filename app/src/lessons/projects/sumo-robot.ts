import * as THREE from 'three/webgpu'
import {
  EDGE_THRESHOLD,
  Pose,
  SUMO_BOT,
  SUMO_BRAIN,
  SUMO_COLORS,
  SUMO_EDGE,
  SUMO_EYES,
  SUMO_FRONTS,
  SUMO_RING,
  SUMO_RIVALS,
  SUMO_STARTS,
  SUMO_TYRES,
  SumoColor,
  SumoFront,
  SumoRival,
  SumoStart,
  SumoState,
  SumoTyre,
  VL53L0X,
  clamp01,
  edgeAdc,
  edgeStop,
  sumoEye,
  sumoMatch,
  sumoShove,
  sumoThrust,
  toRoom,
  tofMaxRange,
} from '../../core/physics'
import { fixedText, mmText, newtonsText, secsText } from '../../core/units'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  BOARD_VIEW,
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  addRod,
  chordPath,
  codeListing,
  commentTint,
  cursorBar,
  floorView,
  forceArrow,
  glowMat,
  lapseClock,
  liveLabel,
  memoBy,
  plotY,
  pointCloud,
  stretchRod,
  sumoBot,
  sumoRing,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const RV = { at: [-8.4, -1.6, 0] as V3, k: 19, tilt: -1.0 }
const US = '#3a8dde'
const THEM = HIGH_V

/** Span-40 stage: ring, two robots and two header lines over it. */
function ringStage(rivalTeam: string) {
  const scene = createStage({ span: 40 })
  const g = floorView(scene, RV.at, RV.k, RV.tilt)
  sumoRing(g)
  g.updateWorldMatrix(true, true)
  const v = new THREE.Vector3()
  return {
    scene,
    g,
    us: sumoBot(g, US),
    them: sumoBot(g, rivalTeam),
    world: (x: number, y: number, z: number): V3 => {
      g.localToWorld(v.set(x, y, z))
      return [v.x, v.y, v.z]
    },
    status: liveLabel(scene, [-16, 7.3, 0.3], { size: 0.44, align: 'left' }),
    sub: liveLabel(scene, [-16, 6.5, 0.3], { size: 0.3, color: GREY, align: 'left' }),
  }
}

// --- Wedge and wheels: the shove is decided by grip, weight transfer and whose wedge gets under. ---

const FRONT_NAMES = namesOf(SUMO_FRONTS)
const TYRE_NAMES = namesOf(SUMO_TYRES)
const RIVAL_NAMES = namesOf(SUMO_RIVALS)
const wwParams = (p: Params) => ({
  front: pick(FRONT_NAMES, p.front, 'printed') as SumoFront,
  kg: SUMO_BOT.baseKg + n(p, 'ballast') / 1000,
  tyre: pick(TYRE_NAMES, p.tyre, 'tt') as SumoTyre,
  rival: pick(RIVAL_NAMES, p.rival, 'box') as SumoRival,
})
type WwQ = ReturnType<typeof wwParams>
const wwKey = (q: WwQ) => `${q.front}|${q.kg}|${q.tyre}|${q.rival}`
const wwRun = memoBy(wwKey, (q: WwQ) => {
  const r = sumoShove([{ kg: q.kg, tyre: q.tyre, front: q.front }, SUMO_RIVALS[q.rival]])
  const touching = r.frames.filter((f) => f.P > 0)
  const mid = touching.length ? touching[Math.floor(touching.length * 0.6)] : r.frames[r.frames.length - 1]
  const sum = (a: [number, number]) => a[0] + a[1]
  return { r, mid, T: r.frames[r.frames.length - 1].t, pushUs: sum(mid.push[0]), pushThem: sum(mid.push[1]), nUs: sum(mid.load[0]), nThem: sum(mid.load[1]) }
})
const WW = { sx: 7.4, sy: 3.4, sw: 10.6, sh: 4.4, top: 12, slow: 0.25, rest: 0.6, nPerN: 0.022 }

export const sumoRobotWedgeAndWheels: Lesson = {
  id: 'sumo-robot-wedge-and-wheels',
  title: 'Wedge and wheels',
  tagline: 'Two pushers nose to nose: the tyres let go long before the motors stall, so weight, grip and a low wedge decide who leaves the ring',
  formula: (p) => {
    const q = wwParams(p)
    const R = wwRun(q)
    const rv = SUMO_RIVALS[q.rival]
    return `push ≤ μ·N · us ${fixedText(SUMO_TYRES[q.tyre].mu, 1)} × ${newtonsText(R.nUs)} = ${newtonsText(R.pushUs)} vs rival ${fixedText(SUMO_TYRES[rv.tyre].mu, 1)} × ${newtonsText(R.nThem)} = ${newtonsText(R.pushThem)} · wedge lift = P / tan α, until their front wheels leave the mat · 4 TT motors could push ${newtonsText(sumoThrust())}`
  },
  legend: [
    { color: US, label: 'Us (blue plate)', shape: 'dot' },
    { color: THEM, label: 'Rival (red plate)', shape: 'dot' },
    { color: RING, label: 'Wedge lift on the robot it is under', shape: 'dot' },
    { color: HIGH_V, label: 'Tyre spinning (slip over 20 %)', shape: 'dot' },
  ],
  points: [
    'The build is the Robo-car grown to four wheels: four TT 1:48 motors on two DRV8833s, 2 × 18650, an ESP32, 0.6 kg in all. School and hobby classes cap the mass (1 kg here; mini-sumo is 500 g and 10 × 10 cm) and the robots start on the brown lines, 10 cm apart, on a 77 cm black ring with a white edge.',
    `Torque is not the limit. Stalled at 6 V the four motors could push ${newtonsText(sumoThrust())}, but the tyres let go at μ·N, about 4 N for 0.6 kg on stock tyres. Past that the wheels just spin (Mechanics › Friction & traction › Wheel slip), so mass and grip decide: ballast up to the limit, cast silicone tyres, and wipe them, because dust takes μ from 1.1 to 0.6.`,
    'Pushing at bumper height moves weight onto the rear axle, P·h/L, the same transfer as accelerating. A low push point keeps the front tyres working.',
    'The wedge is the trick. Whichever lip is lower gets under, and the slope turns the push into lift on the other robot’s nose, P / tan α, until its front wheels leave the mat. That load now sits on your wedge and your front axle: they lose grip, you gain it. A sharpened steel edge (0.2 mm) beats a printed lip (1.5 mm). Two equal lips cancel and it is back to mass and grip.',
  ],
  controls: [
    { kind: 'choice', key: 'front', options: opts(FRONT_NAMES), initial: 'printed' },
    { kind: 'slider', key: 'ballast', label: 'Ballast', min: 0, max: 400, step: 50, initial: 0, format: (v) => `${v} g → ${fixedText(SUMO_BOT.baseKg + v / 1000, 2)} kg` },
    { kind: 'choice', key: 'tyre', options: opts(TYRE_NAMES), initial: 'tt' },
    { kind: 'choice', key: 'rival', options: opts(RIVAL_NAMES), initial: 'box' },
  ],
  build(): Stage {
    const { scene, ...s } = ringStage(THEM)
    const thrust = [forceArrow(scene, US, { r: 0.07, size: 0.28 }), forceArrow(scene, THEM, { r: 0.07, size: 0.28 })]
    const liftA = forceArrow(scene, RING, { r: 0.07, size: 0.28 })
    const sc = titledScope(scene, WW.sy, WW.sh, 'Tyre push: us · rival', LABEL, 0, WW.sx, WW.sw)
    const tr = [US, THEM].map((c) => sc.s.trace(c, { samples: 400, radius: 0.05 }))
    const cursor = cursorBar(sc.s, LABEL, 0.06)
    const yF = plotY(0, WW.top, WW.sh)
    sc.lo.set('0 s', GREY)
    const rows = textRows(scene, 4, WW.sx - WW.sw / 2, -0.4, 0.3, 0.75)
    const st = { key: '', front: '' as SumoFront | '' }
    let clock = lapseClock(1, WW.slow, WW.rest)
    return {
      scene,
      view: BOARD_VIEW,
      frame(dt, p) {
        const q = wwParams(p)
        const key = wwKey(q)
        const R = wwRun(q)
        const { r } = R
        const rv = SUMO_RIVALS[q.rival]
        if (key !== st.key) {
          st.key = key
          clock = lapseClock(R.T, WW.slow, WW.rest)
          s.us.front(q.front)
          s.them.front(rv.front)
          const u = r.frames.map((f) => f.t / R.T)
          tr.forEach((t, k) => t.points(u, r.frames.map((f) => yF(Math.min(WW.top, f.push[k][0] + f.push[k][1]))), null))
          sc.hi.set(`${secsText(R.T)} · 0 … ${WW.top} N`, GREY)
          sc.right.set(r.winner === 0 ? `won in ${secsText(r.tOut)}` : r.winner === 1 ? `pushed out at ${secsText(r.tOut)}` : 'stalemate', r.winner === 0 ? POWER : r.winner === 1 ? HIGH_V : HEAT)
          s.sub.set(`${fixedText(q.kg, 2)} kg, ${TYRE_NAMES[q.tyre].toLowerCase()} vs ${RIVAL_NAMES[q.rival].toLowerCase()} · ${1 / WW.slow} × slower`, GREY)
        }
        const t = clock(dt, key)
        const f = r.frames[t >= R.T ? r.frames.length - 1 : Math.min(r.frames.length - 1, Math.round(t / r.dt))]
        s.us.set({ x: f.x[0], y: 0, th: 0 }, f.turn[0], f.turn[0])
        s.them.set({ x: f.x[1], y: 0, th: Math.PI }, f.turn[1], f.turn[1])
        const liftOf = (k: number) => (r.under === 1 - k ? (f.load[k][1] <= 1e-6 ? 0.008 : 0.008 * clamp01(f.lift / (f.lift + f.load[k][1]))) : 0)
        s.us.lift(liftOf(0))
        s.them.lift(liftOf(1))
        const slip = (k: number) => f.kappa[k].map((x) => clamp01((Math.abs(x) - 0.2) / 0.8))
        ;[s.us, s.them].forEach((b, k) => {
          const [rear, front] = slip(k)
          b.scuff([front, front, rear, rear])
        })
        ;[0, 1].forEach((k) => {
          const F = f.push[k][0] + f.push[k][1]
          const back = f.x[k] - (k === 0 ? 1 : -1) * (SUMO_BOT.len / 2 + 0.01)
          const tail = back - (k === 0 ? 1 : -1) * F * WW.nPerN
          const [a, b] = [s.world(tail, 0, 0.05), s.world(back, 0, 0.05)]
          const len = Math.abs(b[0] - a[0])
          thrust[k](a, b, newtonsText(F), [(k === 0 ? -1 : 1) * (len / 2 + 0.55), 0.55, 0])
        })
        const cx = (f.x[0] + f.x[1]) / 2
        liftA(s.world(cx, 0, 0.02), s.world(cx, 0, 0.02 + f.lift * WW.nPerN), f.lift > 0.05 ? `lift ${newtonsText(f.lift)}` : '')
        cursor(t / R.T)
        const ld = (k: number) => `rear ${newtonsText(f.load[k][0])} · front ${newtonsText(f.load[k][1])}${r.under === 1 - k && f.load[k][1] <= 1e-6 ? ' (lifted)' : ''}`
        rows[0].set(`us     ${ld(0)}`, US)
        rows[1].set(`rival  ${ld(1)}`, THEM)
        rows[2].set(r.under === null ? 'No wedge under: equal lips or no wedge' : `${r.under === 0 ? 'Our' : 'Their'} wedge is under · lift ${newtonsText(f.lift)}`, r.under === null ? GREY : RING)
        rows[3].set(`μ·m·g: us ${newtonsText(r.grip[0])} · rival ${newtonsText(r.grip[1])}`, GREY)
        const state = f.P > 0 ? 'Pushing' : f.t < r.tHit ? 'Charging off the line' : 'Apart'
        s.status.set(`${state} · ${secsText(f.t)}`, LABEL)
      },
      readouts: (p) => {
        const R = wwRun(wwParams(p))
        const { r } = R
        return [
          { label: 'Result', value: r.winner === 0 ? `Won in ${secsText(r.tOut)}` : r.winner === 1 ? `Pushed out at ${secsText(r.tOut)}` : 'Stalemate', tone: r.winner === 0 ? 'ok' : r.winner === 1 ? 'bad' : 'warn' },
          { label: 'Our tyre push', value: newtonsText(R.pushUs), tone: toneOf(R.pushUs > R.pushThem, R.pushUs >= R.pushThem * 0.98) },
          { label: 'Rival tyre push', value: newtonsText(R.pushThem) },
          { label: 'Wedge lift', value: r.under === null ? 'none' : `${newtonsText(R.mid.lift)} on ${r.under === 0 ? 'the rival' : 'us'}`, tone: r.under === null ? undefined : r.under === 0 ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- Edge and opponent sensing: edge sensors and stopping distance, ToF rangers and the black rival, the match state machine. ---

const COLOR_NAMES = namesOf(SUMO_COLORS)
const esParams = (p: Params) => ({
  v: n(p, 'speed'),
  loop: n(p, 'loop') / 1000,
  color: pick(COLOR_NAMES, p.color, 'black') as SumoColor,
  start: pick(SUMO_STARTS, p.start, 'back') as SumoStart,
})
type EsQ = ReturnType<typeof esParams>
const esKey = (q: EsQ) => `${q.v}|${q.loop}|${q.color}|${q.start}`
const TRAIL_STEP = 4
const esRun = memoBy(esKey, (q: EsQ) => {
  const r = sumoMatch({ vMax: q.v, loopS: q.loop, color: q.color, start: q.start })
  return { ...r, trail: r.frames.filter((_, k) => k % TRAIL_STEP === 0).map((f) => f.pose) }
})
const ES = { lx: 1.8, ly: 6.2, lw: 11.4, sx: 7.4, sy: -0.4, sw: 10.6, sh: 3.2, slow: 0.4, rest: 0.8 }
const BRAIN = (loopMs: number) => [
  `// every ${loopMs} ms, edge first`,
  'if (edgeL < thr || edgeR < thr) escape();',
  'else if (seenL && seenR) charge();',
  'else if (seenL || seenR) curve();',
  'else search();  // spin, then roam',
]
const lineOf = (state: SumoState, seen: boolean[]) => (state === 'back' || state === 'away' ? 1 : state === 'attack' ? (seen[0] && seen[1] ? 2 : 3) : 4)
const STATE_TEXT: Record<SumoState, string> = { search: 'Searching (spin)', roam: 'Roaming', attack: 'Attacking', back: 'Edge! Reversing', away: 'Spinning away from the edge' }
const tofText = (mm: number) => (mm >= VL53L0X.outOfRange ? 'no return' : `${mm} mm`)

export const sumoRobotEdgeAndOpponentSensing: Lesson = {
  id: 'sumo-robot-edge-and-opponent-sensing',
  title: 'Edge and opponent sensing',
  tagline: 'Two line sensors keep it on the ring and two laser rangers find the rival, if the loop is fast enough and the rival is not matte black',
  formula: (p) => {
    const q = esParams(p)
    const e = edgeStop(q.v, q.loop)
    return `stop = v·T + v²/(2μg) = ${fixedText(q.v, 1)} × ${Math.round(q.loop * 1000)} ms + ${fixedText(q.v, 1)}²/(2 × ${fixedText(SUMO_BRAIN.mu, 1)} × 9.81) = ${mmText(e.need)} vs ${mmText(e.room)} of room · v·T = ${mmText(q.v * q.loop)} ${e.skip ? '>' : '<'} ${mmText(SUMO_RING.edge)} white band · ToF sees a ${q.color} robot to ${mmText(tofMaxRange(SUMO_COLORS[q.color].refl, SUMO_EYES.klux, SUMO_EYES.mode))}`
  },
  legend: [
    { color: HEAT, label: 'ToF beam seeing the rival (under 700 mm)', shape: 'dot' },
    { color: B_FIELD, label: 'ToF beam with no return', shape: 'dot' },
    { color: HIGH_V, label: 'Edge sensor on white: escape', shape: 'dot' },
    { color: POWER, label: 'Edge sensor on black', shape: 'dot' },
  ],
  points: [
    `Two TCRT5000s sit at the front corners, 5 mm up, read every loop: the black mat reads about ${edgeAdc(0)}, the white edge about ${edgeAdc(SUMO_RING.r - SUMO_RING.edge / 2)}, threshold halfway at ${EDGE_THRESHOLD}. The same sensor as Line-following car › Sensor array, with the colours swapped. Past the rim the floor is 2.5 cm further down and reads dark again, so a sensor that crosses the whole 25 mm band between two reads never sees white.`,
    'The white can be read up to one loop late, then the robot reverses at the grip limit: stop = v·T + v²/(2μg), the bumper sum from Mechanics › Collisions › Bump sensors. The room is the white band plus how far the sensors sit ahead of the front wheels, 50 mm here. At 0.8 m/s and 20 ms it stops in 45 mm; at 1 m/s it needs 66 mm, so charge slower near the edge, loop faster, or move the sensors forward.',
    `Two VL53L0X rangers at the front corners, toed out 10°, in 20 ms high-speed mode (Sensors › Time-of-flight laser › VL53L0X; XSHUT pins to give them different addresses). A matte black robot reflects 5 %, so ranging fails beyond ${mmText(tofMaxRange(SUMO_COLORS.black.refl, SUMO_EYES.klux, SUMO_EYES.mode))}; a white one reads to ${mmText(tofMaxRange(SUMO_COLORS.white.refl, SUMO_EYES.klux, SUMO_EYES.mode))}, right across the ring. That is why sumo robots are painted black.`,
    'The brain is a small state machine (Programming › State machines › Robot behaviour FSM) that checks the edge first on every loop, whatever else it is doing (Navigation › Obstacle avoidance › Reactive rules). Both rangers see: charge. One sees: curve toward it. Neither: spin one turn, then roam straight until the edge. This rival side-steps a close charge twice, and a charge that misses turns into a run at the edge.',
  ],
  controls: [
    { kind: 'slider', key: 'speed', label: 'Charge speed', min: 0.4, max: 1.2, step: 0.1, initial: 0.8, format: (v) => `${v.toFixed(1)} m/s` },
    { kind: 'slider', key: 'loop', label: 'Loop period', min: 5, max: 60, step: 5, initial: 20, format: (v) => `${v} ms` },
    { kind: 'choice', key: 'color', options: opts(COLOR_NAMES), initial: 'black' },
    { kind: 'choice', key: 'start', options: opts(SUMO_STARTS), initial: 'back' },
  ],
  build(): Stage {
    const { scene, ...s } = ringStage('#202226')
    const trail = chordPath(s.g, 400, US, 0.006, 0.003)
    const beamM = [0, 1].map(() => glowMat(B_FIELD, 1))
    const beams = beamM.map((m) => addRod(s.g, m))
    const dots = pointCloud(s.g, 2, 0.011)
    addLabel(scene, 'Match loop', [ES.lx, ES.ly + 1.1, 0.3], LABEL, 0.36, 'left')
    const code = codeListing(scene, [ES.lx, ES.ly, 0.3], 5, ES.lw, 0.3)
    const sc = titledScope(scene, ES.sy, ES.sh, 'Edge sensors L · R (ADC)', LABEL, 0, ES.sx, ES.sw)
    const tr = [HEAT, B_FIELD].map((c) => sc.s.trace(c, { samples: 600, radius: 0.05 }))
    sc.s.level(HIGH_V).set(plotY(0, 4095, ES.sh)(EDGE_THRESHOLD))
    const cursor = cursorBar(sc.s, LABEL, 0.06)
    const yA = plotY(0, 4095, ES.sh)
    sc.lo.set('0 s', GREY)
    const rows = textRows(scene, 3, ES.sx - ES.sw / 2, -3.5, 0.3, 0.72)
    const st = { key: '', line: -1, state: '' }
    let clock = lapseClock(1, ES.slow, ES.rest)
    return {
      scene,
      view: BOARD_VIEW,
      frame(dt, p) {
        const q = esParams(p)
        const key = esKey(q)
        const r = esRun(q)
        const T = r.frames[r.frames.length - 1].t
        if (key !== st.key) {
          Object.assign(st, { key, line: -1, state: '' })
          clock = lapseClock(T, ES.slow, ES.rest)
          const u = r.frames.map((f) => f.t / T)
          tr.forEach((t, k) => t.points(u, r.frames.map((f) => yA(f.edge[k])), null))
          sc.hi.set(`${secsText(T)} · 0 … 4095`, GREY)
          sc.right.set(`white < ${EDGE_THRESHOLD}`, HIGH_V)
          s.sub.set(`${SUMO_STARTS[q.start].toLowerCase()} start · ${COLOR_NAMES[q.color].toLowerCase()} · ${fixedText(q.v, 1)} m/s, ${Math.round(q.loop * 1000)} ms loop · ${fixedText(1 / ES.slow, 1)} × slower`, GREY)
        }
        const t = clock(dt, key)
        const i = t >= T ? r.frames.length - 1 : Math.min(r.frames.length - 1, Math.round(t / r.dt))
        const f = r.frames[i]
        s.us.set(f.pose, f.dL, f.dR)
        s.them.set(f.rival, 0, 0)
        trail(r.trail, Math.floor(i / TRAIL_STEP) + 1)
        const seen = f.tof.map((mm) => mm < SUMO_EYES.seeMm)
        f.tof.forEach((mm, k) => {
          const e = sumoEye(f.pose, k)
          const len = mm >= VL53L0X.outOfRange ? 0.12 : mm / 1000
          stretchRod(beams[k], [e.at[0], e.at[1], 0.06], [e.at[0] + Math.cos(e.th) * len, e.at[1] + Math.sin(e.th) * len, 0.06], 0.003)
          const c = seen[k] ? HEAT : B_FIELD
          beamM[k].color.set(c)
          beamM[k].emissive.set(c)
          beamM[k].emissiveIntensity = mm >= VL53L0X.outOfRange ? 0.3 : 1
        })
        ;[1, -1].forEach((sg, k) => {
          const pt = toRoom(f.pose, SUMO_EDGE.x + 0.01, sg * SUMO_EDGE.y)
          dots.set(k, [pt[0], pt[1], 0.006], f.edge[k] < EDGE_THRESHOLD ? HIGH_V : POWER, 1)
        })
        dots.show(2)
        cursor(t / T)
        const line = lineOf(f.state, seen)
        if (line !== st.line) {
          st.line = line
          code.set(BRAIN(Math.round(q.loop * 1000)), line, commentTint)
        }
        const last = i === r.frames.length - 1
        const status = last ? (r.result === 'hit' ? `Contact at ${secsText(r.tEnd)}, ${Math.round(r.hitDeg)}° round from its nose` : r.result === 'out' ? `Off the ring at ${secsText(r.tEnd)}` : 'No contact: time up') : `${STATE_TEXT[f.state]} · ${secsText(f.t)}`
        if (status !== st.state) {
          st.state = status
          s.status.set(status, last ? (r.result === 'hit' ? POWER : HIGH_V) : f.state === 'back' || f.state === 'away' ? HIGH_V : LABEL)
        }
        rows[0].set(`ToF  L ${tofText(f.tof[0])} · R ${tofText(f.tof[1])}`, seen[0] || seen[1] ? HEAT : GREY)
        rows[1].set(`edge L ${f.edge[0]} · R ${f.edge[1]} (white under ${EDGE_THRESHOLD})`, f.edge.some((a) => a < EDGE_THRESHOLD) ? HIGH_V : POWER)
        const rim = rimOf(f.pose)
        rows[2].set(`front wheel to the rim ${rim < 0 ? 'over it' : mmText(rim)}`, rim < 0.02 ? HIGH_V : GREY)
      },
      readouts: (p) => {
        const q = esParams(p)
        const r = esRun(q)
        const e = edgeStop(q.v, q.loop)
        return [
          { label: 'Result', value: r.result === 'hit' ? `Contact at ${secsText(r.tEnd)}` : r.result === 'out' ? `Off the ring at ${secsText(r.tEnd)}` : 'No contact', tone: r.result === 'hit' ? 'ok' : 'bad' },
          { label: 'Edge escapes', value: `${r.edges}` },
          { label: 'Closest wheel to the rim', value: r.closest < 0 ? 'over it' : mmText(r.closest), tone: toneOf(r.closest > 0.02, r.closest > 0) },
          { label: 'Stop distance vs room', value: `${mmText(e.need)} / ${mmText(e.room)}${e.skip ? ', can skip the band' : ''}`, tone: toneOf(e.ok && e.need < e.room * 0.8, e.ok) },
        ]
      },
    }
  },
}
const rimOf = (p: Pose) =>
  Math.min(...[1, -1].map((sg) => {
    const w = toRoom(p, SUMO_EDGE.axleX, sg * SUMO_EDGE.wheelY)
    return SUMO_RING.r - Math.hypot(w[0], w[1])
  }))
