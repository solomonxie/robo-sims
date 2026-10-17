import * as THREE from 'three/webgpu'
import { ACCEL_FS_G, DEG, DROP_BODIES, DropBody, MOTIONS, Motion, accelReading, detectFall, dropRun, dropTime, toDeg, turnSpeed } from '../../core/physics'
import { Vec3 } from '../../core/fields'
import { degText, lengthText, msText, mpsText, signed } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  AXIS_RGB,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  cursorBar,
  forceArrow,
  lapseClock,
  liveLabel,
  memoBy,
  phoneModel,
  proofMassBox,
  quadcopter,
  robotCar,
  sideView,
  statusHeader,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, namesOf, n, opts, pick } from '../types'

const gText = (g: number, digits = 2) => `${signed(Math.abs(g) < 0.5 * 10 ** -digits ? 0 : g, digits)} g`
/** Body reading (X fwd, Y left, Z up) → proof-mass offset in scene axes (x right, y up, z out): it lags opposite to f. */
const massOffset = (f: Vec3, k: number, lim: number): V3 => {
  const c = (v: number) => Math.max(-lim, Math.min(lim, -v * k))
  return [c(f[0]), c(f[2]), -c(f[1])]
}

// --- Free fall: drop an IMU; it reads ~0 g in the air (drag only), a clipped spike on impact, then 1 g again. ---

const BODY_NAMES = namesOf(DROP_BODIES)
const ffParams = (p: Params) => ({ h: n(p, 'h'), body: pick(DROP_BODIES, p.body, 'phone') as DropBody, thr: n(p, 'thr') })
type FfQ = ReturnType<typeof ffParams>
const ffKey = (q: FfQ) => `${q.h} ${q.body}`
const ffRun = memoBy(ffKey, (q: FfQ) => {
  const R = dropRun(q.h, q.body)
  return { ...R, T: R.samples[R.samples.length - 1].t }
})
const ffDetect = memoBy(
  (q: FfQ) => `${ffKey(q)} ${q.thr}`,
  (q: FfQ) => detectFall(ffRun(q).samples, q.thr),
)
const FLOOR_Y = -9.5
const COL_X = -10
const PER_M = 4.4
const PLOT_G = 2
const SLOW = 0.25

export const gravityInertiaFreeFall: Lesson = {
  id: 'gravity-inertia-free-fall',
  title: 'Free fall',
  tagline: 'Drop an IMU and it reads zero: nothing is pushing on it',
  formula: (p) => {
    const q = ffParams(p)
    const R = ffRun(q)
    const D = ffDetect(q)
    return `reading = (a − g) / g: held a = 0 → 1 g · falling a = −g → 0 g (+ drag ${gText(R.dragAtImpact)} at impact) · t = √(2h/g) = ${msText(dropTime(q.h))} · detected ${msText(D.lenS)} → h = ½gt² = ${lengthText(D.heightM)}`
  },
  legend: [
    { color: POWER, label: 'Accelerometer magnitude |a| (g)', shape: 'dot' },
    { color: RING, label: 'Free-fall threshold', shape: 'dot' },
    { color: HEAT, label: 'Time below it: the fall timer', shape: 'dot' },
    { color: HIGH_V, label: 'Impact: clips at ±16 g', shape: 'dot' },
  ],
  points: [
    'An accelerometer measures the push of its springs on the proof mass: specific force, acceleration minus gravity. Sitting on a table the table pushes up, the springs hold the mass up, and it reads 1 g up. Drop it and the case and the mass fall together; no spring is stretched and it reads 0 g, even though it is accelerating at 9.8 m/s². It never feels gravity itself.',
    'So "how fast am I falling" is invisible to an accelerometer in the air. What it does see is the start and end: 1 g → 0 g on release, then a sharp spike when the floor stops it. That spike is hundreds of g for a phone on tiles, well past the ±16 g an MPU-6050 can report, so it clips.',
    'Drop detection: the MPU-6050 and most phone IMUs have a free-fall interrupt: |a| below a threshold for longer than a minimum time. Phones park hard-disk heads with it; drones use it to spot a motor failure; robots log a fall. Time how long it stayed low and h = ½gt² gives the height: 0.55 s is 1.5 m.',
    'Air drag is a real push, so a draggy body never reads quite 0 g: the reading is (v / v_terminal)² g and grows as it speeds up. A drone with its motors cut reaches 0.2–0.3 g within 3 m. Set the threshold too low and the timer stops early or never starts; too high and a bump or a hop starts it.',
    'This is the same physics as a thrown ball (Mechanics › Kinematics › Projectile motion): in flight the only force is gravity (plus drag), so an IMU riding a projectile reads ~0 g the whole arc. Next: what it reads when the robot is not falling (Accelerometer reading).',
  ],
  controls: [
    { kind: 'slider', key: 'h', label: 'Drop height', min: 0.3, max: 3, step: 0.1, initial: 1.5, format: (v) => `${v.toFixed(1)} m` },
    { kind: 'choice', key: 'body', options: opts(BODY_NAMES), initial: 'phone' },
    { kind: 'slider', key: 'thr', label: 'Free-fall threshold', min: 0.1, max: 0.6, step: 0.05, initial: 0.3, format: (v) => `${v.toFixed(2)} g` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    box(scene, [12, 0.4, 5], mat('#5a5048', { rough: 0.85 }), [COL_X + 1, FLOOR_Y - 0.2, 0])
    for (let m = 0; m <= 3; m += 0.5) {
      const y = FLOOR_Y + m * PER_M
      box(scene, [m % 1 ? 0.5 : 0.9, 0.06, 0.06], mat('#9aa0a8'), [COL_X - 5.2, y, 0])
      if (m % 1 === 0) addLabel(scene, `${m} m`, [COL_X - 5.9, y, 0.3], GREY, 0.3, 'right')
    }
    box(scene, [0.06, 3 * PER_M, 0.06], mat('#9aa0a8'), [COL_X - 5.2, FLOOR_Y + 1.5 * PER_M, 0])
    const shelf = box(scene, [5, 0.25, 3], mat('#8a6a48', { rough: 0.7 }), [COL_X, 0, -1.6])

    const rider = add(scene, new THREE.Group())
    const bodies: Record<DropBody, THREE.Group> = { phone: new THREE.Group(), robot: new THREE.Group(), drone: new THREE.Group() }
    for (const g of Object.values(bodies)) rider.add(g)
    phoneModel(bodies.phone, [0, 1.6, 0], 1.1)
    robotCar(bodies.robot, [0, 1.3, 0], 0.42)
    const quad = quadcopter(bodies.drone, { arcs: false })
    quad.group.scale.setScalar(26)
    quad.group.position.y = 0.4
    quad.group.rotation.set(-Math.PI / 2 + 0.35, 0, 0.4)
    quad.set([0, 0, 0, 0], [0, 0, 0, 0])
    const cell = proofMassBox(rider, [4.6, 1.6, 0], { h: 1.5, m: 0.5 })
    addLabel(rider, 'proof mass', [4.6, 3.6, 0.3], GREY, 0.28)
    const fArrow = forceArrow(rider, POWER, { r: 0.09, size: 0.28 })
    const dropTag = liveLabel(scene, [COL_X + 2, 0, 2], { size: 0.28 })

    const plot = titledScope(scene, -2.6, 8, '|a| from the IMU (g)', POWER, 0, 7.2, 12)
    const tr = plot.s.trace(POWER, { samples: 400, radius: 0.05 })
    const thr = plot.s.level(RING)
    const oneG = plot.s.level(GREY, 0.25)
    const win = plot.s.trace(HEAT, { samples: 2, radius: 0.1 })
    const cursor = cursorBar(plot.s, LABEL, 0.06)
    addLabel(scene, '1 g', [0.8, -2.6 - 4 + 4, 0.3], GREY, 0.26, 'right')
    addLabel(scene, `${PLOT_G} g`, [0.8, -2.6 + 4, 0.3], GREY, 0.26, 'right')
    const thrTag = liveLabel(scene, [0.8, 0, 0.3], { size: 0.26, align: 'right' })
    const timer = liveLabel(scene, [1.2, -9.4, 0.3], { size: 0.32, align: 'left' })
    let lastKey = ''
    let timeNow = 0
    return {
      scene,
      view: sideView(-1.5, -1.5),
      frame(dt, p) {
        const q = ffParams(p)
        const R = ffRun(q)
        const D = ffDetect(q)
        const key = ffKey(q)
        if (key !== lastKey) [lastKey, timeNow] = [key, 0]
        timeNow += dt * SLOW
        if (timeNow > R.T + 0.4) timeNow = 0
        const now = Math.min(timeNow, R.T)
        const i = Math.min(R.samples.length - 1, Math.max(0, Math.round(now / 0.001) - 1))
        const s = R.samples[i]
        for (const [k, g] of Object.entries(bodies)) g.visible = k === q.body
        const y = FLOOR_Y + Math.max(0, s.z) * PER_M
        rider.position.set(COL_X, y, 0)
        shelf.position.y = FLOOR_Y + q.h * PER_M - 0.15
        shelf.visible = now < R.holdS + 0.05
        cell.set(massOffset([0, 0, s.raw], 0.55, 0.7))
        fArrow([6.7, 0.2, 0], [6.7, 0.2 + Math.min(s.raw, 2.5) * 1.6, 0], `${s.g.toFixed(s.g >= 10 ? 0 : 2)} g`)

        const yOf = (g: number) => -plot.h / 2 + (Math.min(g, PLOT_G * 1.2) / PLOT_G) * plot.h
        const N = 400
        const k = Math.max(2, Math.round((now / R.T) * (N - 1)) + 1)
        const us: number[] = []
        const ys: number[] = []
        for (let j = 0; j < k; j++) {
          const u = j / (N - 1)
          let g = 0
          const a = Math.floor((u * R.T) / 0.001)
          const b = Math.max(a + 1, Math.floor(((u + 1 / (N - 1)) * R.T) / 0.001))
          for (let m = a; m < b && m < R.samples.length; m++) g = Math.max(g, R.samples[m].g)
          us.push(u)
          ys.push(yOf(g))
        }
        tr.points(us, ys)
        thr.set(yOf(q.thr))
        oneG.set(yOf(1))
        thrTag.group.position.y = -2.6 + yOf(q.thr)
        thrTag.set(`${q.thr.toFixed(2)} g`, RING)
        win.group.visible = D.found && now >= D.fromS
        if (D.found) win.points([D.fromS / R.T, Math.min(now, D.toS) / R.T], [yOf(q.thr), yOf(q.thr)])
        cursor(now / R.T)
        plot.lo.set('0')
        plot.hi.set(`${R.T.toFixed(2)} s`)
        plot.right.set(R.clipped ? `impact ${Math.round(R.peakRaw)} g, clipped at ${ACCEL_FS_G} g` : `impact ${R.peakRaw.toFixed(1)} g`, R.clipped ? HIGH_V : LABEL)
        const phase = now < R.holdS ? 'held still' : now < R.impactT ? 'falling' : now < R.impactT + 0.02 ? 'impact' : 'on the floor'
        dropTag.group.position.y = y - 0.9
        dropTag.set(`${phase} · v ${mpsText(Math.abs(s.v), 1)}`, phase === 'falling' ? HEAT : phase === 'impact' ? HIGH_V : LABEL)
        timer.set(
          D.found ? `fall timer ${msText(D.lenS)} → h = ½gt² = ${lengthText(D.heightM)} (true ${q.h.toFixed(1)} m)` : 'no free fall detected: drag kept |a| above the threshold',
          D.found && Math.abs(D.heightM - q.h) < 0.15 * q.h ? HEAT : HIGH_V,
        )
        head.status.set(`Free fall · ${DROP_BODIES[q.body].name.toLowerCase()} from ${q.h.toFixed(1)} m · ${phase}`)
        head.sub.set(`slow motion ${SLOW}× · t = ${now.toFixed(2)} s · reads ${s.g.toFixed(2)} g`)
        head.event.set(
          phase === 'falling' ? `no push on the mass: ${gText(s.raw)} (only air drag)` : phase === 'held still' ? 'the shelf pushes up: the springs hold the mass, 1 g' : `the floor stops it: peak ${Math.round(R.peakRaw)} g`,
          phase === 'falling' ? HEAT : phase === 'held still' ? POWER : HIGH_V,
        )
      },
      readouts: (p) => {
        const q = ffParams(p)
        const R = ffRun(q)
        const D = ffDetect(q)
        const err = D.heightM - q.h
        return [
          { label: 'Fall time (no drag: √(2h/g))', value: `${msText(R.fallS)} (${msText(dropTime(q.h))})` },
          { label: 'Reading just before impact', value: gText(R.dragAtImpact), tone: R.dragAtImpact > q.thr ? 'bad' : R.dragAtImpact > 0.1 ? 'warn' : 'ok' },
          { label: 'Height from the fall timer', value: D.found ? `${lengthText(D.heightM)} (${signed(err * 100, 0)} cm)` : 'not detected', tone: !D.found || Math.abs(err) > 0.15 * q.h ? 'bad' : 'ok' },
          { label: 'Impact peak', value: `${Math.round(R.peakRaw)} g${R.clipped ? `, reads ${ACCEL_FS_G}` : ''}`, tone: R.clipped ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Accelerometer reading: the proof mass in everyday motions; tilt from the accelerometer is only right when a = 0. ---

const MOTION_NAMES = namesOf(MOTIONS)
const TURN_R = 1
const arParams = (p: Params) => ({ motion: pick(MOTIONS, p.motion, 'forward') as Motion, aG: n(p, 'a'), pitch: n(p, 'pitch') * DEG })
const arRun = memoBy(
  (p: Params) => `${p.motion} ${p.a} ${p.pitch}`,
  (p: Params) => {
    const q = arParams(p)
    return { ...q, ...accelReading(q.motion, q.aG, q.pitch) }
  },
)
const usesA = (m: Motion) => m !== 'still' && m !== 'fall'
const CELL: V3 = [8.6, -1.2, 0]
const ROBOT: V3 = [-8.5, -4.6, 0]
const LOOP_S = 2.4
const AX_NAMES = ['X fwd', 'Y left', 'Z up']
const TURN_SPIN = 2 * Math.PI
const YAW = 0.6
/** Scene vector turned about the vertical by `yaw` (as `rotation.y`). */
const turnY = ([x, y, z]: V3, yaw: number): V3 => [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)]
const tiltBad = (R: { est: number; err: number; rollErr: number }) => Number.isNaN(R.est) || Math.abs(R.err) > DEG || Math.abs(R.rollErr) > DEG

/** Scene offset of the robot at loop time `t`: a constant-acceleration move scaled to stay on stage. */
function arMotion(m: Motion, a: number, t: number): V3 {
  const w = (t % LOOP_S) / LOOP_S
  const d = 12 * a
  if (m === 'forward') return [-3.5 + d * w * w, 0, 0]
  if (m === 'brake') return [-3.5 + d * (2 * w - w * w), 0, 0]
  if (m === 'liftUp') return [0, 0.4 * d * w * w, 0]
  if (m === 'liftDown') return [0, 0.4 * d * (1 - w * w), 0]
  if (m === 'fall') return [0, 3 * (1 - w * w), 0]
  if (m === 'turn') return [3 * Math.sin(w * TURN_SPIN), 0, 3 * (Math.cos(w * TURN_SPIN) - 1)]
  return [0, 0, 0]
}

export const gravityInertiaAccelerometerReading: Lesson = {
  id: 'gravity-inertia-accelerometer-reading',
  title: 'Accelerometer reading',
  tagline: 'Three axes of specific force: gravity up, minus whatever the robot is doing',
  formula: (p) => {
    const R = arRun(p)
    const [x, y, z] = R.f
    return `f = R⁻¹(a − g) = R⁻¹(a + 1 g up) · a = (${R.a.map((v) => v.toFixed(2)).join(', ')}) g → ax ${gText(x)}, ay ${gText(y)}, az ${gText(z)}, |f| = ${R.mag.toFixed(2)} g · pitch = atan2(ax, √(ay² + az²)) = ${Number.isNaN(R.est) ? '?' : degText(toDeg(R.est))} (true ${degText(toDeg(R.pitch))})`
  },
  legend: [
    { color: GREY, label: 'Gravity g (not felt)', shape: 'dot' },
    { color: HEAT, label: 'Robot acceleration a', shape: 'dot' },
    { color: POWER, label: 'IMU reads a − g', shape: 'dot' },
    { color: AXIS_RGB[0], label: 'Body X fwd, Y left, Z up', shape: 'dot' },
  ],
  points: [
    'Inside the IMU a proof mass hangs on springs in a little box fixed to the robot (Sensors › IMU › Accelerometer has the MEMS comb). Whatever pushes the box, the springs must pass on to the mass; their stretch on each axis is the reading. A still, level robot reads (0, 0, +1 g): the floor pushes up, so the springs push the mass up.',
    'The reading is a − g in the body frame: the robot\'s acceleration with gravity\'s pull subtracted, so a still robot shows gravity pointing up. Tilt the robot and that 1 g spreads across the axes: pitch nose-up 20° reads ax = sin 20° = +0.34 g. That is why an accelerometer makes a good level (Microcontrollers › I²C › MPU-6050).',
    'Speed up at 0.3 g and the mass lags back: ax = +0.3 g, exactly what a 17° nose-up tilt gives. Braking reads as nose-down. A lift starting up makes you heavier (1.3 g), starting down lighter (0.7 g): only the size changes, not the direction, so tilt still comes out right. Cut the cable and it reads 0 (Free fall).',
    'A left turn at speed v on radius r needs v²/r towards the centre, so the mass swings out to the right and ay reads + toward the centre: 0.3 g is only 1.7 m/s on a 1 m circle. A tilt estimate from ay would say the robot is rolled; centripetal load is why phones and drones misjudge their level in a fast turn.',
    'So tilt from the accelerometer is right only on average, when a = 0. The fix: trust the gyro over short times and pull slowly toward the accelerometer (Sensors › Sensor fusion › Complementary filter). On a balancing robot the wheel acceleration that keeps it up is exactly what fools the accel (Centre of mass › Low and wide uses the same g − a).',
  ],
  controls: [
    { kind: 'choice', key: 'motion', options: opts(MOTION_NAMES), initial: 'forward' },
    { kind: 'slider', key: 'a', label: 'Acceleration', min: 0.05, max: 0.6, step: 0.05, initial: 0.3, format: (v) => `${v.toFixed(2)} g` },
    { kind: 'slider', key: 'pitch', label: 'Robot pitch (nose up)', min: -30, max: 30, step: 1, initial: 0, format: (v) => `${v.toFixed(0)}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    box(scene, [17, 0.4, 9], mat('#3a3f4a', { rough: 0.85 }), [ROBOT[0] + 0.5, ROBOT[1] - 3.2, -1])
    const rig = add(scene, new THREE.Group(), ROBOT)
    const tilt = add(rig, new THREE.Group())
    box(tilt, [8.4, 0.3, 4.4], mat('#6b6f78', { rough: 0.7 }), [0, -1.35, 0])
    robotCar(tilt, [0, 0, 1.5], 0.5)
    const gArrow = forceArrow(scene, GREY, { r: 0.12, size: 0.32 })
    const aArrow = forceArrow(scene, HEAT, { r: 0.12, size: 0.32 })
    const fArrow = forceArrow(scene, POWER, { r: 0.14, size: 0.32 })

    const holder = add(scene, new THREE.Group(), CELL)
    holder.rotation.y = YAW
    const cell = proofMassBox(holder, [0, 0, 0], { h: 3, m: 1 })
    const axisEnds: V3[] = [[4.3, 0, 0], [0, 0, -5.2], [0, 4.3, 0]]
    axisEnds.forEach((e, i) => {
      const draw = forceArrow(holder, AXIS_RGB[i], { r: 0.07, size: 0.36 })
      draw(e.map((v) => v * 0.75) as V3, e, '')
      addLabel(holder, 'XYZ'[i], e.map((v) => v * 1.15) as V3, AXIS_RGB[i], 0.4)
    })
    addLabel(scene, 'IMU proof mass, magnified', [CELL[0], CELL[1] - 4.8, 0.3], GREY, 0.3)
    const axisTexts = [0, 1, 2].map((i) => liveLabel(scene, [CELL[0] - 3.4, CELL[1] - 6.0 - i * 0.75, 0.3], { size: 0.34, align: 'left' }))
    const magText = liveLabel(scene, [CELL[0] - 3.4, CELL[1] - 8.3, 0.3], { size: 0.32, align: 'left' })
    const tiltText = liveLabel(scene, [ROBOT[0] - 7.5, ROBOT[1] - 4.6, 4.2], { size: 0.32, align: 'left' })
    const clock = lapseClock(Infinity, 1, 0)
    return {
      scene,
      view: sideView(-1.5, -1.5),
      frame(dt, p) {
        const R = arRun(p)
        const t = clock(dt, `${R.motion} ${R.aG} ${R.pitch}`)
        const off = turnY(arMotion(R.motion, R.aG, t), YAW)
        const heading = YAW + (R.motion === 'turn' ? ((t % LOOP_S) / LOOP_S) * TURN_SPIN : 0)
        rig.position.set(ROBOT[0] + off[0], ROBOT[1] + off[1], ROBOT[2] + off[2])
        tilt.rotation.z = R.pitch
        rig.rotation.y = heading
        holder.rotation.z = R.pitch
        cell.set(massOffset(R.f, 1.1, 1.6))

        const c: V3 = [ROBOT[0], ROBOT[1] + 2.6, 2.4]
        const K = 3.2
        gArrow([c[0] - 5.4, c[1] + 2, c[2]], [c[0] - 5.4, c[1] + 2 - K, c[2]], 'g', [-0.6, 0.6, 0])
        const aw = turnY([R.a[0], R.a[2], -R.a[1]], heading)
        const am: V3 = [c[0] + 7, c[1] + 0.5, c[2]]
        aArrow([am[0] - (aw[0] * K) / 2, am[1] - (aw[1] * K) / 2, am[2] - (aw[2] * K) / 2], [am[0] + (aw[0] * K) / 2, am[1] + (aw[1] * K) / 2, am[2] + (aw[2] * K) / 2], `a ${Math.hypot(...R.a).toFixed(2)} g`, [0, 0.3, 0])
        const fw: V3 = [aw[0], aw[1] + 1, aw[2]]
        fArrow([c[0], c[1] + 0.4, c[2]], [c[0] + fw[0] * K, c[1] + 0.4 + fw[1] * K, c[2] + fw[2] * K], `a − g ${R.mag.toFixed(2)} g`, [2, -0.9, 0])

        R.f.forEach((v, i) => axisTexts[i].set(`a${'xyz'[i]} ${gText(v)}  (${AX_NAMES[i]})`, AXIS_RGB[i]))
        magText.set(`|a| ${R.mag.toFixed(2)} g`, POWER)
        const bad = tiltBad(R)
        tiltText.set(
          Number.isNaN(R.est) ? 'tilt from accel: no idea, it reads 0' : `from accel: pitch ${degText(toDeg(R.est))}, roll ${degText(toDeg(R.estRoll))} · true ${degText(toDeg(R.pitch))}, 0°`,
          bad ? HIGH_V : POWER,
        )
        head.status.set(`Accelerometer reading · ${MOTIONS[R.motion].name.toLowerCase()}${usesA(R.motion) ? ` at ${R.aG.toFixed(2)} g` : ''}`)
        head.sub.set(R.motion === 'turn' ? `${mpsText(turnSpeed(R.aG, TURN_R), 1)} on a ${TURN_R} m circle · real time` : `robot pitch ${signed(toDeg(R.pitch), 0)}° (nose up +) · real time`)
        head.event.set(
          Number.isNaN(R.est) ? 'nothing pushes the mass: it floats in the middle' : bad ? `the mass cannot tell this from a tilt: off ${signed(toDeg(Math.abs(R.err) > Math.abs(R.rollErr) ? R.err : R.rollErr))}°` : 'only gravity\'s support: tilt from the accelerometer is right',
          Number.isNaN(R.est) || bad ? HIGH_V : POWER,
        )
      },
      readouts: (p) => {
        const R = arRun(p)
        const bad = tiltBad(R)
        return [
          { label: 'ax, ay, az', value: R.f.map((v) => gText(v)).join(', ') },
          { label: 'Magnitude |a|', value: `${R.mag.toFixed(2)} g`, tone: Math.abs(R.mag - 1) > 0.05 ? 'warn' : 'ok' },
          { label: 'Pitch, roll from accel', value: Number.isNaN(R.est) ? 'none: reads 0 g' : `${degText(toDeg(R.est))}, ${degText(toDeg(R.estRoll))}`, tone: bad ? 'bad' : 'ok' },
          { label: 'Tilt error (pitch, roll)', value: Number.isNaN(R.est) ? '—' : `${signed(toDeg(R.err))}°, ${signed(toDeg(R.rollErr))}°`, tone: bad ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

