import * as THREE from 'three/webgpu'
import {
  AVOID,
  CLUTTER,
  ESP32_ABS_MAX,
  HCSR04,
  LOOK,
  LOOK_STATES,
  LookPlan,
  SONAR_MOUNT,
  MOUNT_TARGETS,
  MountTarget,
  Pose,
  STOP_TARGETS,
  STOP_TEST,
  StopTarget,
  echoPinVolts,
  lookRun,
  mountScan,
  servoWaitS,
  stopDecel,
  stopRun,
  stopSheet,
  toRoom,
} from '../../core/physics'
import { cmWhole, fixedText, mpsText, msText, pct } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  GREY,
  HEAT,
  HIGH_V,
  IR_TINT,
  LABEL,
  PIN_COLOR,
  PLAN_VIEW,
  POWER,
  RING,
  WIDE_VIEW,
  addLabel,
  beamCone,
  chordPath,
  codeListing,
  countBars,
  diffBot,
  floorMat,
  floorView,
  glowDot,
  glowMat,
  hcSr04,
  lapseClock,
  memoBy,
  pointCloud,
  roomModel,
  setGlow,
  sg90Servo,
  sideCar,
  simClock,
  statusHeader,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const cmOr = (m: number | null, none = 'none') => (m === null ? none : cmWhole(m))
const CODE_GREEN = '#9fe0a0'
const codeTint = (l: string) => (l.trim().startsWith('//') ? GREY : CODE_GREEN)

// --- Mount the sensor: side view of the car closing on a target; floor echoes from a low or tilted sensor, low obstacles under the beam. ---

/** Side view, metres × k: target face at x = 0, floor at y = floorY. */
const MS = { k: 10.5, faceX: -1, floorY: -1.6, driveS: 6, rest: 1.5, plot: { x: 8.6, y: -1.8, w: 11.6, h: 5.2 }, cmFull: 160 }
const TARGET_NAMES = namesOf(MOUNT_TARGETS)
const msParams = (p: Params) => ({ h: n(p, 'height') / 100, tilt: n(p, 'tilt'), target: pick(MOUNT_TARGETS, p.target, 'wall') as MountTarget })
const msRun = memoBy(
  (p: Params) => `${p.height} ${p.tilt} ${p.target}`,
  (p: Params) => {
    const q = msParams(p)
    return { ...q, S: mountScan(q.h, q.tilt, q.target) }
  },
)
const SRC_TINT = { target: POWER, floor: HIGH_V, none: GREY }

export const obstacleAvoidingCarMountTheSensor: Lesson = {
  id: 'obstacle-avoiding-car-mount-the-sensor',
  title: 'Mount the sensor',
  tagline: 'Height and tilt decide what the HC-SR04 hears: obstacles, or the floor',
  formula: (p) => {
    const { h, tilt, target, S } = msRun(p)
    return `beam ±${HCSR04.halfDeg}° (−6 dB) · sensor ${cmWhole(h)} up, tilted ${tilt > 0 ? `${tilt}° down` : tilt < 0 ? `${-tilt}° up` : 'level'} → lower edge meets the floor ≈ ${h / Math.tan(Math.max(1e-3, (HCSR04.halfDeg + tilt) * (Math.PI / 180))) > 4 ? 'never' : cmWhole(h / Math.tan((HCSR04.halfDeg + tilt) * (Math.PI / 180)))} · floor echo ${S.floorM === null ? `${fixedText(S.floorPeak, 2)} × threshold: not heard` : `heard at ${cmWhole(S.floorM)}`} · ${MOUNT_TARGETS[target].name.toLowerCase()} heard ${S.seenFromM === null ? 'never' : `${cmWhole(S.seenFromM)} → ${cmWhole(S.lostAtM!)}`} · ECHO 5 V × 2k/(1k + 2k) = ${fixedText(echoPinVolts(true), 2)} V ≤ ${ESP32_ABS_MAX} V (typical)`
  },
  legend: [
    { color: IR_TINT, label: 'Beam (±15°)', shape: 'dot' },
    { color: POWER, label: 'Echo from the obstacle', shape: 'dot' },
    { color: HIGH_V, label: 'Echo from the floor: a phantom obstacle', shape: 'dot' },
    { color: GREY, label: 'True distance', shape: 'dot' },
  ],
  points: [
    'The Robo-car gets eyes: an HC-SR04 on an SG90 servo at the front (the servo comes in next lesson). How it hears is in Sensors › Ultrasonic: Time of flight for the echo timing, Beam angle for the ±15° cone that fans out ahead of it.',
    'Height matters. Low on the nose, the lower half of the cone grazes the floor a few cm ahead; rough flooring scatters a little back, and close by that is loud enough to count. The sketch then reads a wall 9 cm away all the time and never drives. Tilting the sensor down does the same from higher up.',
    'Too high and low things slip under the beam: a 2 cm door sill is only heard between about 50 and 20 cm at 8 cm high, never at 12 cm, and the shoe box goes faint. Level, 6 to 8 cm up, at the very front of the plate is the usual answer; anything lower than that needs a bumper or an IR sensor (Sensors › Infrared › Obstacle sensor).',
    'Wiring: VCC to the 5 V rail, TRIG to any output, but ECHO swings to 5 V and the ESP32 takes 3.6 V at most. Put a 1 kΩ / 2 kΩ divider on it (3.3 V), or use a 3.3 V part such as the RCWL-1601. Mount the module so the cans stick out past the plate edge, or the plate itself becomes the first echo.',
  ],
  controls: [
    { kind: 'slider', key: 'height', label: 'Sensor height', min: 2, max: 14, step: 1, initial: 8, format: (v) => `${v} cm` },
    { kind: 'slider', key: 'tilt', label: 'Tilt (+ down)', min: -10, max: 15, step: 5, initial: 0, format: (v) => `${v > 0 ? '+' : ''}${v}°` },
    { kind: 'choice', key: 'target', options: opts(TARGET_NAMES), initial: 'wall' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const k = MS.k
    const X = (m: number) => MS.faceX + m * k
    const floorW = (SONAR_MOUNT.fromM + 0.45) * k
    box(scene, [floorW, 0.3, 3], mat('#23262d', { rough: 0.85 }), [X(-(SONAR_MOUNT.fromM + 0.45) / 2 + 0.2), MS.floorY - 0.15, -0.6])
    box(scene, [floorW, 4.4, 0.1], mat('#1b1d22', { rough: 1 }), [X(-(SONAR_MOUNT.fromM + 0.45) / 2 + 0.2), MS.floorY - 2.5, 0.85]).castShadow = false
    for (let m = 0; m <= SONAR_MOUNT.fromM + 1e-9; m += 0.5) addLabel(scene, m ? `${m} m` : '0', [X(-m), MS.floorY - 0.65, 1], GREY, 0.24)
    const targetG = add(scene, new THREE.Group(), [MS.faceX, MS.floorY, 0])
    const targetM = mat('#8a6a4a', { rough: 0.8 })
    const block = box(targetG, [1, 1, 2], targetM, [0, 0, -0.4])
    const tName = textRows(scene, 1, X(0) + 0.3, MS.floorY + 3.8, 0.26)[0]
    const car = sideCar(scene, [0, MS.floorY, 0], k)
    const sensorG = add(scene, new THREE.Group())
    box(sensorG, [0.02 * k, 0.045 * k, 0.4], mat('#1e5fb8', { rough: 0.5 }), [0, 0, 0])
    for (const s of [-1, 1]) cylinder(sensorG, 0.008 * k, 0.012 * k, mat('#c9ced8', { metal: 0.5, rough: 0.35 }), [0.016 * k, s * 0.013 * k, 0], 'x', 16)
    const post = box(scene, [0.12, 1, 0.12], mat('#8a8f99', { metal: 0.3 }), [0, 0, 0])
    const cone = beamCone(scene, IR_TINT)
    const echo = glowDot(scene, 0.22, POWER)
    const floorSpot = box(scene, [1, 0.08, 1.2], glowMat(HIGH_V, 1), [0, MS.floorY + 0.02, 0])
    const P = MS.plot
    const plot = titledScope(scene, P.y, P.h, 'reading as the car closes in', LABEL, 0, P.x, P.w)
    const truth = plot.s.trace(GREY, { samples: 160, radius: 0.04 })
    const read = plot.s.trace(RING, { samples: 160, radius: 0.06 })
    plot.lo.set(`${SONAR_MOUNT.fromM} m away`)
    plot.hi.set(`${cmWhole(SONAR_MOUNT.toM)}`)
    const rows = textRows(scene, 3, -17, -7.4, 0.28, 0.66)
    const clock = lapseClock(MS.driveS, 1, MS.rest)
    const st = { key: '' }
    const yOf = (cm: number) => (Math.min(cm, MS.cmFull) / MS.cmFull) * P.h - P.h / 2
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { h, tilt, target, S } = msRun(p)
        const T = MOUNT_TARGETS[target]
        const key = `${h} ${tilt} ${target}`
        const t = clock(dt, key)
        const i = Math.min(S.frames.length - 1, Math.round((t / MS.driveS) * (S.frames.length - 1)))
        const f = S.frames[i]
        if (st.key !== key) {
          st.key = key
          const us = S.frames.map((_, j) => j / (S.frames.length - 1))
          const step = Math.ceil(S.frames.length / 160)
          const pick2 = <E,>(a: E[]) => a.filter((_, j) => j % step === 0 || j === a.length - 1)
          truth.points(pick2(us), pick2(S.frames.map((g) => yOf(g.d * 100))), null)
          block.scale.set(T.h < 0.05 ? 0.25 * k : 0.2 * k, T.h * k, 1)
          block.position.set(0.1 * k, (T.h * k) / 2, -0.4)
          targetM.color.set(target === 'wall' ? '#6b6f78' : target === 'box' ? '#a07a50' : '#8a6a4a')
          tName.set(T.name, GREY)
        }
        const us = S.frames.slice(0, i + 1).map((_, j) => j / (S.frames.length - 1))
        const step = Math.max(1, Math.ceil(us.length / 160))
        const idx = us.map((_, j) => j).filter((j) => j % step === 0 || j === i)
        read.points(idx.map((j) => us[j]), idx.map((j) => yOf(S.frames[j].cm)))
        setGlow(read.material, SRC_TINT[f.src], 0.9)

        const sx = X(-f.d)
        const sy = MS.floorY + h * k
        car.group.position.x = sx - 0.12 * k
        car.set(SONAR_MOUNT.fromM - f.d, 0)
        post.scale.y = Math.max(0.05, sy - (MS.floorY + car.top))
        post.position.set(sx - 0.02 * k, (sy + MS.floorY + car.top) / 2, 0.3)
        sensorG.position.set(sx, sy, 0.4)
        sensorG.rotation.z = (-tilt * Math.PI) / 180
        const half = (HCSR04.halfDeg * Math.PI) / 180
        const reach = f.src === 'none' ? f.d + 0.08 : f.cm / 100
        cone([sx + 0.02 * k, sy, 0.6], (-tilt * Math.PI) / 180, half, reach * k, 0.16, f.src === 'floor' ? HIGH_V : IR_TINT)
        echo.visible = f.src !== 'none'
        if (f.src === 'target') echo.position.set(MS.faceX, Math.min(sy, MS.floorY + T.h * k * 0.8), 0.9)
        setGlow(echo.material as THREE.MeshStandardMaterial, SRC_TINT[f.src], 1.4)
        floorSpot.visible = S.floorM !== null
        if (S.floorM !== null) {
          const gx = Math.sqrt(Math.max(0, S.floorM ** 2 - h ** 2))
          floorSpot.position.x = sx + gx * k
          floorSpot.scale.x = 0.06 * k
          if (f.src === 'floor') echo.position.set(sx + gx * k, MS.floorY + 0.1, 0.9)
        }

        const v = echoPinVolts(true)
        rows[0].set(S.floorM === null ? `Floor echo ${fixedText(S.floorPeak, 2)} × threshold: quiet` : `Floor echo at ${cmWhole(S.floorM)}: reads an obstacle there all the time`, S.floorM === null ? POWER : HIGH_V)
        rows[1].set(S.seenFromM === null ? `${T.name} never heard as itself` : `${T.name} heard from ${cmWhole(S.seenFromM)} down to ${cmWhole(S.lostAtM!)}`, S.seenFromM === null ? HIGH_V : S.lostAtM! > 0.15 ? HEAT : POWER)
        rows[2].set(`ECHO 5 V → 1 kΩ / 2 kΩ → GPIO ${fixedText(v, 2)} V (max ${ESP32_ABS_MAX} V)`, GREY)
        plot.right.set(f.cm ? `${f.cm.toFixed(0)} cm` : '0 (timeout)', SRC_TINT[f.src])
        head.status.set(`Obstacle-avoiding car · ${cmWhole(h)} up, ${tilt ? `${Math.abs(tilt)}° ${tilt > 0 ? 'down' : 'up'}` : 'level'}`)
        head.sub.set(`${cmWhole(f.d)} from the ${T.name.toLowerCase()} · creeping at ${mpsText((SONAR_MOUNT.fromM - SONAR_MOUNT.toM) / MS.driveS)}`, GREY)
        head.event.set(f.src === 'floor' ? `Reads ${f.cm.toFixed(0)} cm: the floor, not the ${target === 'wall' ? 'wall' : 'obstacle'}` : f.src === 'target' ? `Reads ${f.cm.toFixed(0)} cm: the ${T.name.toLowerCase()}` : 'No echo: pulseIn times out, reads 0', SRC_TINT[f.src])
      },
      readouts: (p) => {
        const { S } = msRun(p)
        return [
          { label: 'Floor echo', value: cmOr(S.floorM), tone: S.floorM === null ? 'ok' : 'bad' },
          { label: 'Heard from', value: cmOr(S.seenFromM, 'never'), tone: toneOf(S.seenFromM !== null && S.seenFromM > 1, S.seenFromM !== null && S.seenFromM > 0.3) },
          { label: 'Lost under', value: cmOr(S.lostAtM, '—'), tone: toneOf(S.lostAtM !== null && S.lostAtM < 0.1, S.lostAtM !== null && S.lostAtM < 0.25) },
          { label: 'ECHO pin', value: `${fixedText(echoPinVolts(true), 2)} V`, tone: 'ok' },
        ]
      },
    }
  },
}

// --- Reactive logic: drive until close, brake, swing the servo left and right, turn to the clearer side (or always left). ---

const RV = { at: [-18.6, -5.4, 0] as V3, k: 5.6, tilt: -0.5, speed: 2, hold: 2.5, every: 5 }
const PLANS: Record<LookPlan, string> = { left: 'Always spin left', look: 'Look both ways (servo)' }
const rlParams = (p: Params) => ({ plan: pick(PLANS, p.plan, 'look') as LookPlan, stop: n(p, 'stop'), duty: n(p, 'duty') / 100 })
type RlQ = ReturnType<typeof rlParams>
const rlKey = (q: RlQ) => `${q.plan}|${q.stop}|${q.duty}`
const rlRun = memoBy(rlKey, (q: RlQ) => lookRun(q.plan, q.stop, q.duty))
const rlCode = (plan: LookPlan, stop: number) => [
  `switch (state) {  // STOP = ${cmWhole(stop)}, ping every ${msText(LOOK.pingS)}`,
  '  case DRIVE: drive(v, v); if (ping() < STOP) go(BRAKE); break;',
  plan === 'look' ? '  case BRAKE: drive(0, 0); if (after(200)) { look(160); go(LOOK_L); } break;' : '  case BRAKE: drive(0, 0); if (after(200)) go(TURN); break;',
  plan === 'look' ? '  case LOOK_L: if (settled()) { left = ping(); look(20); go(LOOK_R); } break;' : '  // no LOOK_L: the servo stays at 90°',
  plan === 'look' ? '  case LOOK_R: if (settled()) { right = ping(); look(90);' : '  // no LOOK_R',
  plan === 'look' ? '      go(max(left, right) < STOP ? BACK : TURN); } break;' : '',
  plan === 'look' ? '  case BACK: drive(-v, -v); if (after(400)) go(TURN); break;' : '  // no BACK',
  plan === 'look' ? '  case TURN: spin(left >= right ? LEFT : RIGHT);' : '  case TURN: spin(LEFT);',
  `      if (ping() > ${LOOK.clearK} * STOP || after(${LOOK.maxTurnS * 1000})) go(DRIVE); break;`,
  '}',
]
const STATE_LINE = [1, 2, 3, 4, 6, 7]

export const obstacleAvoidingCarReactiveLogic: Lesson = {
  id: 'obstacle-avoiding-car-reactive-logic',
  title: 'Reactive logic',
  tagline: 'A state machine in loop(): drive, brake, look left and right, turn away',
  formula: (p) => {
    const q = rlParams(p)
    const r = rlRun(q)
    const lookS = servoWaitS(0, LOOK.lookDeg) + servoWaitS(LOOK.lookDeg, -LOOK.lookDeg) + LOOK.brakeS
    return `v = ${mpsText(r.v)} at ${pct(q.duty)} duty · brake under ${cmWhole(q.stop)}${q.plan === 'look' ? ` · look = brake ${msText(LOOK.brakeS)} + swing 70° at ${Math.round(LOOK.lookDeg / (servoWaitS(0, LOOK.lookDeg) - LOOK.settleS))}°/s + settle ${msText(LOOK.settleS)}, twice ≈ ${msText(lookS)}` : ''} · turn until > ${LOOK.clearK} × stop (hysteresis) · 60 s: ${r.bumps} bumps, ${r.turns} turns, ${fixedText(r.dist, 1)} m, ${pct(r.coverage)} of the floor`
  },
  legend: [
    { color: IR_TINT, label: 'Sonar on the servo (±15°)', shape: 'dot' },
    { color: RING, label: 'Path so far', shape: 'dot' },
    { color: HIGH_V, label: 'Bump: the body touched something', shape: 'dot' },
    { color: PIN_COLOR, label: 'Current state in the sketch', shape: 'dot' },
  ],
  points: [
    'The theory is in Navigation › Obstacle avoidance › Reactive rules: no map, every loop reads the sensor and reacts. Here it becomes the sketch on the Robo-car, written as a state machine (Digital › State machines): a switch on the current state, each case driving the wheels and checking when to move on. Nothing blocks, so the loop keeps pinging and could still read a bumper or a phone failsafe.',
    'With the sensor fixed straight ahead, the easy rule is "too close: brake, spin left until clear". It slides into corners on its right side and spins away from open space, and in the same room it bumps several times a minute.',
    'With the servo, it stops and looks: swing to 160°, wait for the horn to arrive and the echoes to die down, ping; the same at 20°; then turn toward the side with more room, or back up first when both are blocked. Bumps drop to one or two, but every look costs about 0.8 s standing still, so it covers less floor in a minute.',
    'Never read the sonar while the servo is still moving, and keep 60 ms between pings so the last ping’s echo has died (Sensors › Ultrasonic › Beam angle). The turn ends only once the front reads 1.3 × the stop distance, or the car would twitch back and forth on the threshold; a time cap stops it spinning for ever in a dead end.',
  ],
  controls: [
    { kind: 'choice', key: 'plan', options: opts(PLANS), initial: 'look' },
    { kind: 'slider', key: 'stop', label: 'Stop distance', min: 0.15, max: 0.4, step: 0.05, initial: 0.2, format: (v) => cmWhole(v) },
    { kind: 'slider', key: 'duty', label: 'Speed (duty)', min: 40, max: 80, step: 10, initial: 60, format: (v) => `${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const g = floorView(scene, RV.at, RV.k, RV.tilt)
    roomModel(g, 0.5).draw(CLUTTER)
    for (const s of CLUTTER.solids)
      if (s.name !== 'wall') addLabel(g, s.name, s.kind === 'box' ? [(s.x[0] + s.x[1]) / 2, (s.y[0] + s.y[1]) / 2, s.h * 0.5 + 0.01] : [s.at[0], s.at[1] - s.r - 0.07, 0.01], GREY, 0.07)
    const trail = chordPath(g, Math.ceil((LOOK.seconds / AVOID.dt + 1) / RV.every), RING, 0.007, 0.012)
    const bumps = pointCloud(g, 120, 0.03)
    const bot = diffBot(g)
    const cone = beamCone(g, IR_TINT)
    const top = RV.at[1] + CLUTTER.d * RV.k * Math.cos(RV.tilt)
    const status = textRows(scene, 2, RV.at[0], top + 1.7, 0.4, 0.8)
    const code = codeListing(scene, [3.2, 4.4, 0.3], 10, 16, 0.21, 0.5, PIN_COLOR)
    const servoG = add(scene, new THREE.Group(), [9.6, -4.6, 0])
    const horn = sg90Servo(servoG, [0, 0, 0])
    horn.children.forEach((c) => (c.visible = false))
    hcSr04(horn, [0, 0, 0.6], 0.2, Math.PI / 2)
    addLabel(scene, 'SG90 + HC-SR04, seen from above', [9.6, -1.4, 0.3], GREY, 0.26)
    const reads = textRows(scene, 3, 14, -3.6, 0.3, 0.7)
    const clock = simClock(AVOID.dt / RV.speed, RV.hold)
    const st = { run: null as ReturnType<typeof rlRun> | null, pts: [] as Pose[], hits: [] as number[] }
    return {
      scene,
      view: PLAN_VIEW,
      frame(dt, p) {
        const q = rlParams(p)
        const run = rlRun(q)
        const i = Math.floor(clock(dt, rlKey(q), run.frames.length - 1))
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
        const L = run.look[i]
        bot.set(f.pose, f.dL, f.dR)
        bot.slip(f.hit ? 1 : 0, f.hit ? 1 : 0)
        const [sx, sy] = toRoom(f.pose, AVOID.mount, 0)
        const servoRad = (L.servo * Math.PI) / 180
        const range = L.servo > 1 ? L.left : L.servo < -1 ? L.right : L.front
        cone([sx, sy, AVOID.z + 0.2], f.pose.th + servoRad, (HCSR04.halfDeg * Math.PI) / 180, Math.max(0.02, range), 0.22, range < q.stop ? HIGH_V : IR_TINT)
        horn.rotation.z = servoRad
        code.set(rlCode(q.plan, q.stop), STATE_LINE[f.rule], codeTint)
        reads[0].set(`front ${cmWhole(L.front)}`, L.front < q.stop ? HIGH_V : LABEL)
        reads[1].set(q.plan === 'look' ? `left ${cmWhole(L.left)}` : 'left —', q.plan === 'look' ? LABEL : GREY)
        reads[2].set(q.plan === 'look' ? `right ${cmWhole(L.right)}` : 'right —', q.plan === 'look' ? LABEL : GREY)
        status[0].set(`${PLANS[q.plan]} · ${LOOK_STATES[f.rule]} · t ${f.t.toFixed(1)} s · ${nb} bump${nb === 1 ? '' : 's'}`, nb === 0 ? POWER : nb < 4 ? HEAT : HIGH_V)
        status[1].set(`Robo-car in the 3.6 × 2.4 m room · servo ${Math.round(90 + L.servo)}° · ${RV.speed}× faster`, GREY)
      },
      readouts: (p) => {
        const r = rlRun(rlParams(p))
        return [
          { label: 'Bumps in 60 s', value: `${r.bumps}`, tone: r.bumps === 0 ? 'ok' : r.bumps < 4 ? 'warn' : 'bad' },
          { label: 'Floor covered', value: pct(r.coverage), tone: r.coverage > 0.5 ? 'ok' : r.coverage > 0.3 ? 'warn' : 'bad' },
          { label: 'Distance', value: `${r.dist.toFixed(1)} m` },
          { label: 'Turns', value: `${r.turns}` },
        ]
      },
    }
  },
}

// --- Tune and test: drive at five targets, brake under the stop distance; the test sheet. ---

const TT = { floor: [-16.6, -3.2, 0] as V3, k: 11.5, tilt: -0.5, rest: 1.6, bars: [7, 3.4, 0] as V3 }
const PINGS = { p60: 'Ping every 60 ms', p250: 'Ping every 250 ms (Serial + delay)' }
const PING_S = { p60: 0.06, p250: 0.25 }
const STOP_NAMES = namesOf(STOP_TARGETS)
const ttParams = (p: Params) => ({ target: pick(STOP_TARGETS, p.target, 'wall') as StopTarget, duty: n(p, 'duty') / 100, stop: n(p, 'stop'), ping: PING_S[pick(PINGS, p.ping, 'p60') as keyof typeof PING_S] })
const ttKey = (p: Params) => `${p.target} ${p.duty} ${p.stop} ${p.ping}`
const ttRun = memoBy(ttKey, (p: Params) => {
  const q = ttParams(p)
  return { ...q, R: stopRun(q.target, q.duty, q.stop, q.ping), sheet: stopSheet(q.duty, q.stop, q.ping) }
})
const ttCode = (stop: number, ping: number) => [
  'void loop() {',
  '  float cm = pulseIn(ECHO, HIGH, 30000) / 58.0;  // 0 = no echo',
  `  if (cm > 0 && cm < ${Math.round(stop * 100)}) brake();  // 11 on both`,
  ping > 0.1 ? '  Serial.println(cm); delay(200); }' : '  delay(60); }',
]

export const obstacleAvoidingCarTuneAndTest: Lesson = {
  id: 'obstacle-avoiding-car-tune-and-test',
  title: 'Tune and test',
  tagline: 'Stop distance, speed and ping rate against walls, foam, chair legs and angles',
  formula: (p) => {
    const { duty, stop, ping, R } = ttRun(p)
    return `stop gap ≈ STOP − v·(up to one ping period) − v²/2μg: ${cmWhole(stop)} − ${mpsText(R.v0)} × ${msText(ping)} = ${cmWhole(Math.max(0, stop - R.v0 * ping))} worst case − ${cmWhole(R.v0 ** 2 / (2 * stopDecel()))} skid (μ = ${fixedText(stopDecel() / 9.81, 1)}) · ${pct(duty)} duty · an echo only counts if it comes back: soft, thin or slanted targets return less or bounce away`
  },
  legend: [
    { color: IR_TINT, label: 'Sonar beam, length = reading', shape: 'dot' },
    { color: POWER, label: 'Stopped short', shape: 'dot' },
    { color: HEAT, label: 'Stopped, but under 5 cm', shape: 'dot' },
    { color: HIGH_V, label: 'Crashed', shape: 'dot' },
  ],
  points: [
    'Test before you trust it: drive the car straight at a target from 1.2 m and see where it stops. Then repeat for every kind of thing it will meet. The sheet on the right runs all five at the current settings.',
    'Speed and ping rate set the margin. The car only learns something new every ping, so it can run up to v × period past the stop distance before it even starts braking; the tyres then skid a few cm (Mechanics › Friction). A Serial.println plus delay(200) in loop() makes that 250 ms, and fast runs at a short stop distance hit the wall.',
    'Some targets barely echo. Foam soaks the sound up and is heard from under a metre; a 25 mm chair leg catches a sliver of the beam (Sensors › Ultrasonic › Soft-target errors). A wall at 45° is the worst: it mirrors the ping away like light off glass and nothing comes back, so pulseIn times out, the sketch reads 0 and drives into it.',
    'Fixes: a stop distance of about v × period + 10 cm, pings every 60 ms with no delay() in the loop, the servo look from the last lesson or two sensors angled out, and a bumper switch for what sonar cannot hear. Then run the sheet again; when every row is green, the car is done. Next: Line-following car.',
  ],
  controls: [
    { kind: 'choice', key: 'target', options: opts(STOP_NAMES), initial: 'wall' },
    { kind: 'slider', key: 'duty', label: 'Speed (duty)', min: 40, max: 100, step: 10, initial: 60, format: (v) => `${v} %` },
    { kind: 'slider', key: 'stop', label: 'Stop distance', min: 0.1, max: 0.4, step: 0.05, initial: 0.2, format: (v) => cmWhole(v) },
    { kind: 'choice', key: 'ping', options: opts(PINGS), initial: 'p60' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const floor = floorView(scene, TT.floor, TT.k, TT.tilt)
    floorMat(floor, [-0.25, STOP_TEST.startM + 0.15], [-0.35, 0.35])
    for (let m = 0; m <= STOP_TEST.startM + 1e-9; m += 0.4) addLabel(floor, `${fixedText(STOP_TEST.startM - m, 1)} m`, [m, -0.3, 0.01], GREY, 0.035)
    const bot = diffBot(floor)
    const cone = beamCone(floor, IR_TINT)
    const targetG = add(floor, new THREE.Group(), [STOP_TEST.startM, 0, 0])
    const wallM = glowMat('#5a5e68', 0.2)
    const wall = box(targetG, [0.04, 0.6, 0.25], wallM, [0.02, 0, 0.125])
    const leg = cylinder(targetG, 0.0125, 0.4, glowMat('#c9ced8', 0.2), [0, 0, 0.2], 'z', 16)
    const echo = glowDot(floor, 0.015, POWER)
    const code = codeListing(scene, [-16.6, 3.6, 0.3], 4, 14, 0.22, 0.5)
    addLabel(scene, 'Test sheet: gap left at the stop', [TT.bars[0] - 3.4, TT.bars[1] + 1, 0.3], LABEL, 0.3, 'left')
    const bars = countBars(scene, TT.bars, Object.values(STOP_NAMES), 4.6, { row: 0.72, size: 0.26 })
    const rows = textRows(scene, 3, 3.8, -1.6, 0.28, 0.66)
    const st = { key: '' }
    const clock = lapseClock(STOP_TEST.seconds, 1, TT.rest)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { target, stop, ping, R, sheet } = ttRun(p)
        const key = ttKey(p)
        const T = STOP_TARGETS[target]
        if (st.key !== key) {
          st.key = key
          wall.visible = !T.leg
          leg.visible = !!T.leg
          targetG.rotation.z = (-T.deg * Math.PI) / 180
          setGlow(wallM, target === 'foam' ? '#c9a46a' : '#5a5e68', 0.2)
        }
        const end = R.frames.findIndex((f, j) => j > 0 && f.v === 0 && R.frames[j - 1].v === 0)
        const tEnd = R.crashed ? R.frames.find((f) => f.x >= R.hitX)!.t + 0.6 : end > 0 ? R.frames[end].t + 0.6 : STOP_TEST.seconds
        const t = Math.min(clock(dt, key), tEnd)
        const f = R.frames[Math.min(R.frames.length - 1, Math.round(t / STOP_TEST.dt))]
        bot.set({ x: f.x - AVOID.mount, y: 0, th: 0 }, f.x, f.x)
        const crashedNow = R.crashed && f.x >= R.hitX - 1e-9
        bot.slip(f.braking ? 1 : 0, f.braking ? 1 : 0)
        setGlow(wallM, crashedNow ? HIGH_V : target === 'foam' ? '#c9a46a' : '#5a5e68', crashedNow ? 1 : 0.2)
        const reach = f.cm > 0 ? f.cm / 100 : 1.6
        cone([f.x, 0, AVOID.z + 0.2], 0, (HCSR04.halfDeg * Math.PI) / 180, Math.min(reach, STOP_TEST.startM - f.x), 0.2, f.cm > 0 && f.cm < stop * 100 ? HIGH_V : IR_TINT)
        echo.visible = f.cm > 0
        echo.position.set(f.x + f.cm / 100, 0, AVOID.z)
        code.set(ttCode(stop, ping), f.braking ? 2 : 1, codeTint)

        const tint = (s: (typeof sheet)[number]) => (s.crashed ? HIGH_V : s.gapM < 0.05 ? HEAT : POWER)
        bars.set(
          sheet.map((s) => (s.crashed ? 0.4 : s.gapM)),
          sheet.map((s) => (s.crashed ? `crash ${mpsText(s.impact)}` : cmWhole(s.gapM))),
          sheet.map(tint),
          0.4,
        )
        sheet.forEach((s, j) => bars.rename(j, STOP_TARGETS[s.target].name, s.target === target ? LABEL : GREY))
        const passed = sheet.filter((s) => !s.crashed && s.gapM >= 0.05).length
        rows[0].set(`Reading ${f.cm > 0 ? `${f.cm.toFixed(0)} cm` : '0 (no echo)'} · ${f.braking ? 'braking' : 'driving'} at ${mpsText(f.v)}`, f.cm > 0 ? LABEL : HEAT)
        rows[1].set(R.seenM === null ? 'Never heard: the echo never came back' : `First heard at ${cmWhole(R.seenM)}, brake at ${cmWhole(R.hitX - R.brakeX!)}`, R.seenM === null ? HIGH_V : LABEL)
        rows[2].set(`Sheet: ${passed} of ${sheet.length} pass`, passed === sheet.length ? POWER : passed >= sheet.length - 1 ? HEAT : HIGH_V)
        head.status.set(`Obstacle-avoiding car · ${T.name}`)
        head.sub.set(`${fixedText(f.t, 2)} s · 1× · stop at ${cmWhole(stop)}, ping ${msText(ping)}`, GREY)
        head.event.set(R.crashed ? (crashedNow ? `Crashed at ${mpsText(R.impact)}` : 'Driving…') : f.v === 0 && f.braking ? `Stopped ${cmWhole(R.gapM)} short` : f.braking ? 'Braking' : 'Driving…', R.crashed && crashedNow ? HIGH_V : f.braking ? POWER : LABEL)
      },
      readouts: (p) => {
        const { R, sheet } = ttRun(p)
        const passed = sheet.filter((s) => !s.crashed && s.gapM >= 0.05).length
        return [
          { label: 'Result', value: R.crashed ? 'crash' : `${cmWhole(R.gapM)} short`, tone: R.crashed ? 'bad' : toneOf(R.gapM >= 0.05, true) },
          { label: 'Heard at', value: cmOr(R.seenM, 'never'), tone: R.seenM === null ? 'bad' : 'ok' },
          { label: 'Speed', value: mpsText(R.v0), tone: 'ok' },
          { label: 'Sheet', value: `${passed} / ${sheet.length}`, tone: toneOf(passed === sheet.length, passed >= sheet.length - 1) },
        ]
      },
    }
  },
}
