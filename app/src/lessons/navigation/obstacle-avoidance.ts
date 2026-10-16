import * as THREE from 'three/webgpu'
import { AVOID, BRAIT, CLUTTER, HCSR04, Pose, REACT, RULE_TEXT, RuleSet, WALL, WIRINGS, WallCtl, BraitWiring, braitRun, clearance, proximity, reactiveRun, toRoom, wallFit, wallRun } from '../../core/physics'
import { V3, add, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  IR_TINT,
  LABEL,
  POWER,
  RING,
  addLabel,
  addRod,
  beamCone,
  chordPath,
  cursorBar,
  diffBot,
  floorView,
  glowMat,
  liveLabel,
  memoBy,
  pointCloud,
  rayFan,
  roomModel,
  scope,
  setGlow,
  simClock,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const cm = (m: number) => `${Math.round(m * 100)} cm`
const pct = (v: number) => `${Math.round(v * 100)} %`
const ms = (v: number) => `${v.toFixed(2)} m/s`
const RV = { at: [-18.6, -5.4, 0] as V3, k: 5.6, tilt: -0.5, speed: 2, hold: 2.5, every: 5 }
const TOP = RV.at[1] + CLUTTER.d * RV.k * Math.cos(RV.tilt)
const VIEW = { center: [-0.6, 2.4, 0] as V3, radius: 60, polar: Math.PI / 2, azimuth: 0 }
const ROOM_LEGEND = [
  { color: RING, label: 'Path so far', shape: 'dot' as const },
  { color: HIGH_V, label: 'Bump: the body touched something', shape: 'dot' as const },
]
const z = (x: number, y: number, h = 0.07): V3 => [x, y, h]

type Run = ReturnType<typeof reactiveRun>
/** Room, robot, trail and bump marks; `show(run, i)` puts frame i on screen. */
function roomStage(scene: THREE.Scene) {
  const g = floorView(scene, RV.at, RV.k, RV.tilt)
  roomModel(g, 0.5).draw(CLUTTER)
  for (const s of CLUTTER.solids)
    if (s.name !== 'wall') addLabel(g, s.name, s.kind === 'box' ? [(s.x[0] + s.x[1]) / 2, (s.y[0] + s.y[1]) / 2, s.h * 0.5 + 0.01] : [s.at[0], s.at[1] - s.r - 0.07, 0.01], GREY, 0.07)
  const trail = chordPath(g, Math.ceil((AVOID.seconds / AVOID.dt + 1) / RV.every), RING, 0.007, 0.012)
  const bumps = pointCloud(g, 120, 0.03)
  const bot = diffBot(g)
  const st = { run: null as Run | null, pts: [] as Pose[], hits: [] as number[] }
  return {
    g,
    bot,
    show(run: Run, i: number) {
      if (run !== st.run) {
        st.run = run
        st.pts = run.frames.filter((_, j) => j % RV.every === 0).map((f) => f.pose)
        st.hits = []
        run.frames.forEach((f, j) => {
          if (f.hit && !run.frames[j - 1]?.hit) {
            const [x, y] = toRoom(f.pose, AVOID.r * 0.9, 0)
            bumps.set(st.hits.length, [x, y, 0.03], HIGH_V)
            st.hits.push(j)
          }
        })
      }
      trail(st.pts, Math.floor(i / RV.every) + 1)
      let nb = 0
      while (nb < st.hits.length && st.hits[nb] <= i) nb++
      bumps.show(nb)
      const f = run.frames[i]
      bot.set(f.pose, f.dL, f.dR)
      bot.slip(f.hit ? 1 : 0, f.hit ? 1 : 0)
      return f
    },
  }
}
const headLabels = (scene: THREE.Scene) => [liveLabel(scene, [RV.at[0], TOP + 1.7, 0.3], { size: 0.44, align: 'left' }), liveLabel(scene, [RV.at[0], TOP + 0.9, 0.3], { size: 0.3, color: GREY, align: 'left' })]
const sensorAt = (p: Pose): V3 => {
  const [x, y] = toRoom(p, AVOID.mount, 0)
  return [x, y, AVOID.z]
}

// --- Reactive rules: a priority list from bumper and sonars straight to the wheels. ---

const RULESETS: Record<RuleSet, string> = { bump: 'Bumper only', sonar: 'One front sonar', three: 'Three sonars' }
const rrParams = (p: Params) => ({ set: pick(RULESETS, p.rules, 'three') as RuleSet, stop: n(p, 'stop'), v: n(p, 'speed') })
type RrQ = ReturnType<typeof rrParams>
const rrKey = (q: RrQ) => `${q.set}|${q.stop}|${q.v}`
const rrRun = memoBy(rrKey, (q: RrQ) => reactiveRun(q.set, q.stop, q.v))
const SONAR_DEG: Record<RuleSet, number[]> = { bump: [], sonar: [0], three: [REACT.sideDeg, 0, -REACT.sideDeg] }
const RP = { x: 5, y: 3.2, row: 1.15 }

export const obstacleAvoidanceReactiveRules: Lesson = {
  id: 'obstacle-avoidance-reactive-rules',
  title: 'Reactive rules',
  tagline: 'No map, no plan: every loop, read the sensors and let the first rule that matches set the wheels',
  formula: (p) => {
    const q = rrParams(p)
    return q.set === 'bump'
      ? 'if bumper: back up, spin away · else: forward. The robot learns about an obstacle only by hitting it'
      : `every loop: ${RULE_TEXT[q.set].map((r, i) => `${i + 1}) ${r}`).join(' · ')} · stop = ${cm(q.stop)}`
  },
  legend: [
    { color: IR_TINT, label: 'Sonar cone (±15°), length = reading', shape: 'dot' },
    { color: HIGH_V, label: 'Reading under the stop distance', shape: 'dot' },
    ...ROOM_LEGEND,
    { color: HEAT, label: 'The rule that fired this loop', shape: 'dot' },
  ],
  points: [
    'A reactive controller keeps no map and makes no plan. Each loop it reads the sensors and walks down a short list of rules; the first one whose condition is true sets both wheel speeds. Higher rules override lower ones, so safety goes on top.',
    'A bumper alone (a microswitch behind a sprung bar) works but only after contact: the robot finds every obstacle by hitting it. One front HC-SR04 sees things coming, but a fixed "always spin left" ends up sliding into corners and missing things off to the sides.',
    'Three sonars at −40°, 0°, +40° let the rules steer early: veer away from whichever side is close, and when the front is blocked spin towards the side with more room. The spin keeps going until the front reads 1.3 × the stop distance (hysteresis), or the robot would twitch back and forth on the threshold.',
    'The sonars fire one after another (they would hear each other\'s echoes, see Sensors › Ultrasonic › Beam angle), so each reads at 12.5 Hz while the wheel loop runs at 50 Hz. Too small a stop distance and the robot cannot turn in time; too large and it refuses gaps it could fit through and covers less floor.',
  ],
  controls: [
    { kind: 'choice', key: 'rules', options: opts(RULESETS), initial: 'three' },
    { kind: 'slider', key: 'stop', label: 'Stop distance', min: 0.1, max: 0.6, step: 0.05, initial: 0.3, format: (v) => cm(v) },
    { kind: 'slider', key: 'speed', label: 'Cruise speed', min: 0.1, max: 0.4, step: 0.05, initial: 0.25, format: ms },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const [status, sub] = headLabels(scene)
    const room = roomStage(scene)
    const cones = [0, 1, 2].map(() => beamCone(room.g, IR_TINT))
    const rays = rayFan(room.g, 3, glowMat(IR_TINT, 1.2), 0.006)
    addLabel(scene, 'Rules, checked top to bottom', [RP.x, RP.y + 1.3, 0.3], LABEL, 0.4, 'left')
    const rows = [0, 1, 2, 3, 4].map((k) => liveLabel(scene, [RP.x, RP.y - k * RP.row, 0.3], { size: 0.4, align: 'left' }))
    const reads = liveLabel(scene, [RP.x, RP.y - 5 * RP.row - 0.3, 0.3], { size: 0.34, color: GREY, align: 'left' })
    const clock = simClock(AVOID.dt / RV.speed, RV.hold)
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = rrParams(p)
        const run = rrRun(q)
        const i = Math.floor(clock(dt, rrKey(q), run.frames.length - 1))
        const f = room.show(run, i)
        const o = sensorAt(f.pose)
        const degs = SONAR_DEG[q.set]
        cones.forEach((c, k) => {
          const on = k < degs.length
          const m = on ? f.ranges[k] : 0.001
          c([o[0], o[1], 0.2 + 0.02], f.pose.th + (on ? degs[k] : 0) * (Math.PI / 180), (HCSR04.halfDeg * Math.PI) / 180, Math.max(0.001, m), on ? 0.22 : 0, on && m < q.stop ? HIGH_V : IR_TINT)
        })
        rays(degs.map((d, k) => [o, [o[0] + f.ranges[k] * Math.cos(f.pose.th + (d * Math.PI) / 180), o[1] + f.ranges[k] * Math.sin(f.pose.th + (d * Math.PI) / 180), o[2]]] as [V3, V3]))
        RULE_TEXT[q.set].forEach((r, k) => rows[k].set(`${k + 1}. ${r}`, k === f.rule ? HEAT : GREY))
        for (let k = RULE_TEXT[q.set].length; k < rows.length; k++) rows[k].set('')
        const names = q.set === 'three' ? ['left', 'front', 'right'] : ['front']
        reads.set(q.set === 'bump' ? `bumper ${f.hit ? 'PRESSED' : 'open'} · no range sensor` : names.map((nm, k) => `${nm} ${cm(f.ranges[k])}`).join(' · '), GREY)
        let nb = 0
        for (let j = 1; j <= i; j++) if (run.frames[j].hit && !run.frames[j - 1].hit) nb++
        status.set(`${RULESETS[q.set]} · t ${f.t.toFixed(1)} s · ${nb} bump${nb === 1 ? '' : 's'} so far`, nb === 0 ? POWER : nb < 4 ? HEAT : HIGH_V)
        sub.set(`TT car in a 3.6 × 2.4 m room · wheels 50 Hz${q.set === 'bump' ? '' : ', each sonar 12.5 Hz'} · ${RV.speed}× faster`)
      },
      readouts: (p) => {
        const r = rrRun(rrParams(p))
        return [
          { label: 'Bumps in 60 s', value: `${r.bumps}`, tone: r.bumps === 0 ? 'ok' : r.bumps < 4 ? 'warn' : 'bad' },
          { label: 'Floor covered', value: pct(r.coverage), tone: r.coverage > 0.5 ? 'ok' : r.coverage > 0.3 ? 'warn' : 'bad' },
          { label: 'Distance driven', value: `${r.dist.toFixed(1)} m` },
          { label: 'Sensors', value: rrParams(p).set === 'bump' ? 'microswitch bumper' : `${SONAR_DEG[rrParams(p).set].length} × HC-SR04 + bumper` },
        ]
      },
    }
  },
}

// --- Braitenberg vehicles: two proximity sensors wired straight to the wheels. ---

const WIRING_NAMES: Record<BraitWiring, string> = { fear: '2a Fear: straight, +', aggression: '2b Aggression: crossed, +', love: '3a Love: straight, −', explorer: '3b Explorer: crossed, −' }
const bvParams = (p: Params) => ({ w: pick(WIRING_NAMES, p.wiring, 'explorer') as BraitWiring, k: n(p, 'gain'), eye: n(p, 'eye') })
type BvQ = ReturnType<typeof bvParams>
const bvKey = (q: BvQ) => `${q.w}|${q.k}|${q.eye}`
const bvRun = memoBy(bvKey, (q: BvQ) => braitRun(q.w, q.k, q.eye))
const BD = { x: 11.2, y: -0.4, eyeX: 2.2, eyeY: 3.2, wheelX: 3.4, wheelY: -2.2, barK: 9 }
const BEHAVIOUR: Record<BraitWiring, string> = {
  fear: 'speeds up near things and turns away; corners trap it',
  aggression: 'turns towards what it sees and speeds up: rams it',
  love: 'turns towards it and slows, then sits facing it',
  explorer: 'turns away and slows down near things',
}

/** Top-down wiring sketch: eyes, wires (straight or crossed, + or −) lit by signal, wheel speed bars. */
function wiringDiagram(scene: THREE.Scene) {
  const g = add(scene, new THREE.Group(), [BD.x, BD.y, 0])
  g.scale.setScalar(1.15)
  const shell = mat('#3a3d45', { rough: 0.6 })
  const edge = (a: V3, b: V3) => stretchRod(addRod(g, shell), a, b, 0.06)
  const [ex, ey, wx, wy] = [BD.eyeX, BD.eyeY, BD.wheelX, BD.wheelY]
  edge([-wx + 0.5, ey + 0.4, 0], [wx - 0.5, ey + 0.4, 0])
  edge([-wx + 0.5, -3.6, 0], [wx - 0.5, -3.6, 0])
  for (const s of [-1, 1]) edge([s * (wx - 0.5), ey + 0.4, 0], [s * (wx - 0.5), -3.6, 0])
  const eyes = [1, -1].map((s) => {
    const m = glowMat(IR_TINT, 0.3)
    add(g, new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), m), [-s * ex, ey, 0.2])
    return m
  })
  const wheels = [1, -1].map((s) => {
    const m = glowMat(GREY, 0.3)
    add(g, new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.5), m), [-s * wx, wy, 0.1])
    return m
  })
  addLabel(g, 'left eye', [-ex, ey + 1.1, 0.2], GREY, 0.32)
  addLabel(g, 'right eye', [ex, ey + 1.1, 0.2], GREY, 0.32)
  addLabel(g, 'left wheel', [-wx, wy - 1.4, 0.2], GREY, 0.32)
  addLabel(g, 'right wheel', [wx, wy - 1.4, 0.2], GREY, 0.32)
  const wireMats = [glowMat(B_FIELD, 0.5), glowMat(B_FIELD, 0.5)]
  const wires = wireMats.map((m) => addRod(g, m))
  const signs = [0, 1].map(() => liveLabel(g, [0, 0, 0.3], { size: 0.8 }))
  const bars = [0, 1].map(() => addRod(g, glowMat(POWER, 1)))
  const barTags = [0, 1].map((k) => liveLabel(g, [(k === 0 ? -1 : 1) * wx, wy - 2.1, 0.3], { size: 0.36 }))
  let shape = ''
  return (w: BraitWiring, sL: number, sR: number, vL: number, vR: number) => {
    const { crossed, sign } = WIRINGS[w]
    if (shape !== w) {
      shape = w
      ;[-1, 1].forEach((s, k) => {
        const from: V3 = [s * ex, ey - 0.35, 0.15]
        const to: V3 = [(crossed ? -s : s) * (wx - 0.1), wy + 0.9, 0.15]
        stretchRod(wires[k], from, to, 0.07)
        signs[k].group.position.set(to[0] + (crossed ? s * 0.7 : -s * 0.7), wy + 1.1, 0.3)
        signs[k].set(sign > 0 ? '+' : '−', sign > 0 ? POWER : HIGH_V)
      })
    }
    ;[sL, sR].forEach((s, k) => {
      setGlow(eyes[k], IR_TINT, 0.2 + 2 * s)
      setGlow(wireMats[k], sign > 0 ? POWER : HIGH_V, 0.15 + 1.6 * s)
    })
    ;[vL, vR].forEach((v, k) => {
      const x = (k === 0 ? -1 : 1) * (wx + 0.7)
      stretchRod(bars[k], [x, wy, 0.2], [x, wy + v * BD.barK, 0.2], 0.12)
      setGlow(wheels[k], v >= 0 ? POWER : HIGH_V, 0.2 + Math.abs(v) * 3)
      barTags[k].set(ms(v), v >= 0 ? POWER : HIGH_V)
    })
  }
}

export const obstacleAvoidanceBraitenbergVehicles: Lesson = {
  id: 'obstacle-avoidance-braitenberg-vehicles',
  title: 'Braitenberg vehicles',
  tagline: 'Wire two sensors straight to two motors and behaviour appears: four wirings, four "personalities", no code beyond one line per wheel',
  formula: (p) => {
    const q = bvParams(p)
    const { crossed, sign } = WIRINGS[q.w]
    const [a, b] = crossed ? ['s_R', 's_L'] : ['s_L', 's_R']
    const op = sign > 0 ? '+' : '−'
    return `s = 1 − d/${BRAIT.maxM} m (0 far, 1 touching) · v_L = ${BRAIT.v0} ${op} ${q.k.toFixed(2)}·${a} · v_R = ${BRAIT.v0} ${op} ${q.k.toFixed(2)}·${b} (m/s)`
  },
  legend: [
    { color: IR_TINT, label: 'Proximity rays (0.8 m), brighter = closer', shape: 'dot' },
    { color: POWER, label: 'Excitatory wire (+) / forward wheel', shape: 'dot' },
    { color: HIGH_V, label: 'Inhibitory wire (−) / reverse wheel', shape: 'dot' },
    ...ROOM_LEGEND,
  ],
  points: [
    'Valentino Braitenberg\'s thought experiment: a cart with two sensors in front and two motors, each motor driven directly by one sensor. Wire them straight (left eye → left wheel) or crossed, and make a stronger signal speed the wheel up (+) or slow it down (−).',
    'Here the "eyes" are two short-range IR / ToF sensors (see Sensors › Time-of-flight laser) angled outwards, turned into a closeness s between 0 and 1. Each wheel speed is one line: a base speed plus or minus gain × s.',
    'Straight + (fear) and crossed − (explorer) turn away from whatever is near: both avoid obstacles. Crossed + (aggression) turns towards and speeds up, so it rams; straight − (love) turns towards and slows, coming to rest facing the thing. Nobody wrote "avoid" or "attack"; it falls out of the wiring.',
    'The weakness is symmetry. Head-on into a corner both eyes read the same, the turn cancels and the vehicle drives in (fear) or stalls there (explorer). Wider-set eyes see corners sooner; real robots add a little randomness or a rule on top (Reactive rules).',
  ],
  controls: [
    { kind: 'choice', key: 'wiring', options: opts(WIRING_NAMES), initial: 'explorer' },
    { kind: 'slider', key: 'gain', label: 'Gain k', min: 0.05, max: 0.4, step: 0.05, initial: 0.2, format: ms },
    { kind: 'slider', key: 'eye', label: 'Eye angle', min: 15, max: 75, step: 5, initial: 45, format: (v) => `±${v}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const [status, sub] = headLabels(scene)
    const room = roomStage(scene)
    const rayMats = [glowMat(IR_TINT, 1), glowMat(IR_TINT, 1)]
    const rays = rayMats.map((m) => addRod(room.g, m))
    const tips = pointCloud(room.g, 2, 0.02)
    const diagram = wiringDiagram(scene)
    const behave = liveLabel(scene, [BD.x, BD.y - 6.6, 0.3], { size: 0.3, color: GREY })
    const clock = simClock(AVOID.dt / RV.speed, RV.hold)
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = bvParams(p)
        const run = bvRun(q)
        const i = Math.floor(clock(dt, bvKey(q), run.frames.length - 1))
        const f = room.show(run, i)
        const o = sensorAt(f.pose)
        const s = f.ranges.map((m) => proximity(m))
        ;[q.eye, -q.eye].forEach((d, k) => {
          const a = f.pose.th + (d * Math.PI) / 180
          const end: V3 = [o[0] + f.ranges[k] * Math.cos(a), o[1] + f.ranges[k] * Math.sin(a), o[2]]
          stretchRod(rays[k], o, end, 0.006 + 0.01 * s[k])
          setGlow(rayMats[k], IR_TINT, 0.3 + 1.5 * s[k])
          tips.set(k, end, s[k] > 0 ? IR_TINT : GREY)
        })
        tips.show(2)
        diagram(q.w, s[0], s[1], f.vL, f.vR)
        behave.set(BEHAVIOUR[q.w], GREY)
        const resting = run.restT !== null && f.t >= run.restT
        status.set(`${WIRING_NAMES[q.w]} · t ${f.t.toFixed(1)} s${resting ? ' · at rest' : ''}`, resting ? HEAT : LABEL)
        sub.set(`eyes ±${q.eye}°, read at 25 Hz with 1 cm noise · ${BRAIT.seconds} s run · ${RV.speed}× faster`)
      },
      readouts: (p) => {
        const r = bvRun(bvParams(p))
        return [
          { label: 'Distance in 40 s', value: `${r.dist.toFixed(1)} m` },
          { label: 'Bumps', value: `${r.bumps}`, tone: r.bumps === 0 ? 'ok' : r.bumps < 4 ? 'warn' : 'bad' },
          { label: 'Came to rest', value: r.restT === null ? 'never' : `at ${r.restT.toFixed(0)} s`, tone: r.restT === null ? 'ok' : 'warn' },
          { label: 'Floor covered', value: pct(r.coverage) },
        ]
      },
    }
  },
}

// --- Wall following: two right-side rays, a fitted wall line, PD on the distance. ---

const CTLS: Record<WallCtl, string> = { p: 'P on the side ray', pd: 'PD on the fitted wall', look: 'PD + look-ahead' }
const wfParams = (p: Params) => ({ ctl: pick(CTLS, p.ctl, 'look') as WallCtl, set: n(p, 'set'), kp: n(p, 'kp') })
type WfQ = ReturnType<typeof wfParams>
const wfKey = (q: WfQ) => `${q.ctl}|${q.set}|${q.kp}`
const wfRun = memoBy(wfKey, (q: WfQ) => {
  const r = wallRun(q.ctl, q.set, q.kp)
  const gaps = r.frames.map((f) => Math.min(WF.top, clearance(CLUTTER, ...toRoom(f.pose, AVOID.mount, 0))))
  return { ...r, gaps }
})
const WF = { x: 11.2, y: -0.6, w: 12, h: 6.4, n: 300, top: 0.6 }
const RULE_NAMES = ['follow: PD on the wall distance', 'corner ahead: spin left', 'bumper: back up']

export const obstacleAvoidanceWallFollowing: Lesson = {
  id: 'obstacle-avoidance-wall-following',
  title: 'Wall following',
  tagline: 'Keep a wall on your right at a set distance: two side rays give its angle, a PD loop holds the gap, and corners need their own rules',
  formula: (p) => {
    const q = wfParams(p)
    const fit = 'α = atan2(b − a·cos 45°, a·sin 45°) · D = b·cos α'
    const meas = q.ctl === 'p' ? 'd = b' : q.ctl === 'pd' ? `${fit} · d = D` : `${fit} · d = D − ${WALL.lookM}·sin α`
    return `${meas} · ω = ${q.kp}·(${cm(q.set)} − d) − ${q.ctl === 'p' ? 0 : (q.kp * WALL.kdPerKp).toFixed(1)}·ḋ · v = ${WALL.v} m/s`
  },
  legend: [
    { color: IR_TINT, label: 'Rays: b (right), a (45° ahead), front', shape: 'dot' },
    { color: B_FIELD, label: 'Wall line fitted through the two side hits', shape: 'dot' },
    ...ROOM_LEGEND,
    { color: POWER, label: 'True gap to the nearest surface vs time', shape: 'dot' },
  ],
  points: [
    'Wall following is the simplest way to get round a room or a maze without a map: keep a wall on one side at a fixed gap. The gap is a setpoint, the side range is the measurement and the turn rate is the controller output, a PD loop like Control › PID on a moving robot.',
    'One side ray is not enough. When the robot is angled the ray hits the wall obliquely and reads long, so plain P steers late and weaves. A second ray 45° further forward gives the wall\'s angle α and the true perpendicular gap D; the derivative of D is the robot\'s closing speed, which damps the weave.',
    'Look-ahead goes one step further and controls the gap the robot will have 20 cm from now (D − L·sin α), so it starts turning before the error shows up. The ranges here come from short ToF sensors read at 25 Hz (see Sensors › Time-of-flight laser, and LiDAR for the scanning version).',
    'Corners are separate rules. When the front ray sees a wall closer than 1.2 × the gap, spin left (inside corner); when the side wall ends, the side ray reads its 1 m limit and the PD saturates into a tight right turn round the end. A wall follower started next to a free-standing block circles it forever: wall following only explores the wall it starts on.',
  ],
  controls: [
    { kind: 'choice', key: 'ctl', options: opts(CTLS), initial: 'look' },
    { kind: 'slider', key: 'set', label: 'Wall gap', min: 0.15, max: 0.4, step: 0.05, initial: 0.25, format: (v) => cm(v) },
    { kind: 'slider', key: 'kp', label: 'Kp', min: 1, max: 20, step: 1, initial: 6, format: (v) => `${v} rad/s per m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const [status, sub] = headLabels(scene)
    const room = roomStage(scene)
    const rays = rayFan(room.g, 3, glowMat(IR_TINT, 1.2), 0.008)
    const wallLine = addRod(room.g, glowMat(B_FIELD, 1.4))
    const plot = scope(scene, WF.w, WF.h, { divs: [6, 6], zeroAt: 0 })
    plot.group.position.set(WF.x, WF.y, 0)
    const yOf = (m: number) => (Math.min(1, m / WF.top) - 0.5) * WF.h
    addLabel(scene, 'gap to the nearest surface', [WF.x - WF.w / 2, WF.y + WF.h / 2 + 0.9, 0.3], POWER, 0.34, 'left')
    addLabel(scene, `0 … ${cm(WF.top)} · ${AVOID.seconds} s`, [WF.x + WF.w / 2, WF.y + WF.h / 2 + 0.9, 0.3], GREY, 0.34, 'right')
    const setTrace = plot.trace(RING, { samples: 2, radius: 0.04 })
    const trace = plot.trace(POWER, { samples: WF.n, radius: 0.06 })
    const cur = cursorBar(plot, LABEL, 0.05)
    const rule = liveLabel(scene, [WF.x - WF.w / 2, WF.y - WF.h / 2 - 0.9, 0.3], { size: 0.32, align: 'left' })
    const clock = simClock(AVOID.dt / RV.speed, RV.hold)
    const st = { key: '', us: [] as number[], ys: [] as number[] }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = wfParams(p)
        const key = wfKey(q)
        const run = wfRun(q)
        const i = Math.floor(clock(dt, key, run.frames.length - 1))
        if (key !== st.key) {
          st.key = key
          const step = Math.ceil(run.frames.length / WF.n)
          st.us = []
          st.ys = []
          for (let k = 0; k < run.frames.length; k += step) {
            st.us.push(k / (run.frames.length - 1))
            st.ys.push(yOf(run.gaps[k]))
          }
          setTrace.points([0, 1], [yOf(q.set), yOf(q.set)])
        }
        const f = room.show(run, i)
        const u = i / (run.frames.length - 1)
        let upto = 0
        while (upto < st.us.length && st.us[upto] <= u) upto++
        trace.points(st.us.slice(0, upto), st.ys.slice(0, upto))
        cur(u)
        const o = sensorAt(f.pose)
        const [b, a, fr] = f.ranges
        const dirs = [-Math.PI / 2, -Math.PI / 2 + WALL.theta, 0]
        const ends = [b, a, fr].map((m, k) => [o[0] + m * Math.cos(f.pose.th + dirs[k]), o[1] + m * Math.sin(f.pose.th + dirs[k]), o[2]] as V3)
        rays(ends.map((e) => [o, e] as [V3, V3]))
        const seen = a < WALL.maxM && b < WALL.maxM
        wallLine.visible = seen
        if (seen) {
          const [pb, pa] = [ends[0], ends[1]]
          const d = [pa[0] - pb[0], pa[1] - pb[1]]
          stretchRod(wallLine, z(pb[0] - d[0] * 0.25, pb[1] - d[1] * 0.25, o[2]), z(pa[0] + d[0] * 0.25, pa[1] + d[1] * 0.25, o[2]), 0.008)
        }
        const fit = a >= WALL.maxM ? null : wallFit(a, b)
        rule.set(`${RULE_NAMES[f.rule]}${fit && f.rule === 0 ? ` · α ${Math.round((fit.alpha * 180) / Math.PI) || 0}° · D ${cm(fit.D)}` : ''}`, f.rule === 0 ? LABEL : f.rule === 1 ? HEAT : HIGH_V)
        const gap = run.gaps[i]
        const err = Math.abs(gap - q.set)
        status.set(`${CTLS[q.ctl]} · gap ${cm(gap)} (want ${cm(q.set)})`, err < 0.04 ? POWER : err < 0.1 ? HEAT : HIGH_V)
        sub.set(`right-hand wall · rays at 25 Hz, 1 m range · t ${f.t.toFixed(1)} s · ${RV.speed}× faster`)
      },
      readouts: (p) => {
        const r = wfRun(wfParams(p))
        return [
          { label: 'RMS gap error on straights', value: cm(r.rms), tone: r.rms < 0.04 ? 'ok' : r.rms < 0.08 ? 'warn' : 'bad' },
          { label: 'Worst gap error', value: cm(r.worst), tone: r.worst < 0.1 ? 'ok' : r.worst < 0.2 ? 'warn' : 'bad' },
          { label: 'Bumps', value: `${r.bumps}`, tone: r.bumps === 0 ? 'ok' : 'bad' },
          { label: 'Distance along the wall', value: `${r.dist.toFixed(1)} m` },
        ]
      },
    }
  },
}
