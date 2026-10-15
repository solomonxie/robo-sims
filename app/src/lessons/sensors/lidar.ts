import * as THREE from 'three/webgpu'
import {
  P3,
  Pose,
  RPLIDAR_A1,
  Room,
  RoomSolid,
  ScanPoint,
  VLP16,
  angularRes,
  beamGap,
  beamsAcross,
  cloudScan,
  clusterBoxes,
  clusterPoints,
  layerElevs,
  lidarRay,
  lidarReach,
  pointsPerRev,
  rayDir,
  scanPhase,
  scanRev,
  seamShift,
  seenChance,
  shuttle,
  turnSkewDeg,
  walledRoom,
} from '../../core/physics'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CODE_LEGEND,
  GREY,
  HEAT,
  IR_TINT,
  LABEL,
  POWER,
  RING,
  addLabel,
  codeBlock,
  glowMat,
  lidarRobot,
  liveLabel,
  memoBy,
  partLetter,
  pointCloud,
  potentialColor,
  rayFan,
  roomModel,
  scope,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const DIM = new THREE.Color(RING).multiplyScalar(0.35)
const BRIGHT = new THREE.Color(RING)
const PHANTOM = new THREE.Color(HEAT)
const cm = (m: number) => (m < 1 ? `${(m * 100).toFixed(m < 0.1 ? 1 : 0)} cm` : `${m.toFixed(2)} m`)

/** Room group in metres → scene: top view, `sc` units per m, room origin at `o`. */
function topView(parent: THREE.Object3D, o: V3, sc: number) {
  const g = add(parent, new THREE.Group(), o)
  g.scale.setScalar(sc)
  return { g, at: (x: number, y: number, z = 0): V3 => [o[0] + x * sc, o[1] + y * sc, o[2] + z * sc] }
}

// --- 2D scan: an RPLIDAR A1 spinning on a robot in a room. ---

const SAMPLE = { s2k: '2 k samples/s', s4k: '4 k samples/s', s8k: '8 k/s (boost)' }
const SAMPLE_HZ: Record<keyof typeof SAMPLE, number> = { s2k: 2000, s4k: 4000, s8k: 8000 }
const MOTION = { parked: 'Parked', drive: 'Driving 1 m/s', spin: 'Turning 90°/s' }
const DESKEW = { off: 'Raw scan', on: 'De-skewed' }
const S2 = { sc: 3.9, o: [-23.6, -7.6, 0] as V3, z: 0.2, slow: 20, drawMax: 1200, hScale: 0.25 }
const ROOM_A = walledRoom(6, 4, 1, [
  { kind: 'box', name: 'sofa', x: [0.4, 2.2], y: [3.25, 3.95], h: 0.8, refl: 0.35 },
  { kind: 'box', name: 'crate', x: [3.6, 4.2], y: [0.6, 1.2], h: 0.5, refl: 0.6 },
  { kind: 'box', name: 'shelf', x: [5.4, 5.95], y: [2.4, 3.7], h: 1.8, refl: 0.7 },
  { kind: 'post', name: 'pillar', at: [2.4, 0.9], r: 0.14, h: 1, refl: 0.7 },
  { kind: 'post', name: 'bin', at: [4.7, 3.3], r: 0.16, h: 0.6, refl: 0.3 },
])
const MOVE = { v: 1, a: 1.0, b: 4.4, y: 2.2, omegaDeg: 90 }
const poseAt = (motion: keyof typeof MOTION) => (t: number): Pose =>
  motion === 'drive'
    ? { x: shuttle(t, MOVE.v, MOVE.a, MOVE.b), y: MOVE.y, th: 0 }
    : { x: motion === 'spin' ? 3 : MOVE.a + 0.6, y: MOVE.y, th: motion === 'spin' ? (MOVE.omegaDeg * Math.PI * t) / 180 : 0 }

const scanRun = memoBy(
  (p: Params) => `${p.hz}|${p.rate}|${p.motion}|${p.deskew}`,
  (p: Params) => {
    const hz = n(p, 'hz')
    const rate = pick(SAMPLE, p.rate, 's8k')
    const motion = pick(MOTION, p.motion, 'drive')
    const deskew = pick(DESKEW, p.deskew, 'off') === 'on'
    const sampleHz = SAMPLE_HZ[rate]
    const N = pointsPerRev(sampleHz, hz)
    const stride = Math.ceil(N / S2.drawMax)
    return {
      hz,
      sampleHz,
      motion,
      deskew,
      N,
      stride,
      res: angularRes(sampleHz, hz),
      seam: motion === 'drive' ? seamShift(MOVE.v, hz) : 0,
      skew: motion === 'spin' ? turnSkewDeg(MOVE.omegaDeg, hz) : 0,
      pose: poseAt(motion),
      gapAt3: beamGap(3, angularRes(sampleHz, hz)),
    }
  },
)

export const scan2d: Lesson = {
  id: 'lidar-2d-scan',
  title: '2D scan',
  tagline: 'One laser rangefinder on a turntable: a ring of distances, many times a second',
  formula: (p) => {
    const R = scanRun(p)
    return `points / rev = ${R.sampleHz} samples/s ÷ ${R.hz} Hz = ${R.N} · Δθ = 360° × ${R.hz} / ${R.sampleHz} = ${R.res.toFixed(2)}° → ${cm(R.gapAt3)} apart at 3 m · moved per rev: ${R.motion === 'drive' ? `${MOVE.v} m/s ÷ ${R.hz} Hz = ${cm(R.seam)}` : R.motion === 'spin' ? `${MOVE.omegaDeg}°/s ÷ ${R.hz} Hz = ${R.skew.toFixed(1)}°` : '0'}`
  },
  legend: [
    { color: IR_TINT, label: `${RPLIDAR_A1.nm} nm laser beam, drawn pink`, shape: 'dot' },
    { color: RING, label: 'Scan points: bright = this rev', shape: 'dot' },
    { color: GREY, label: 'Range vs angle, last full rev', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'A 2D lidar is one laser rangefinder (see Time-of-flight laser › VL53L0X) on a spinning head. An RPLIDAR A1 turns at 2–10 Hz and takes up to 8000 range samples per second, so each turn is a ring of distances in a flat slice of the room, 15 cm to 12 m away.',
    'Samples per second are fixed by the ranging core, so spin and detail trade off: points per rev = sample rate ÷ scan rate. At 5.5 Hz and 8 k/s that is ~1450 points, one every 0.25°; spin at 10 Hz and you get half as many, but a fresh map twice as often.',
    'Each sample is (angle, distance). x = d·cos θ, y = d·sin θ turns it into a point around the robot; the A1 counts angles clockwise from its front mark.',
    'The scan is not a snapshot. Driving at 1 m/s with a 5.5 Hz scan, the robot moves 18 cm between the first and last point: walls bend and a seam opens where the turn starts. Turning is worse, the whole ring twists. Fix it by placing every point at the pose the robot had when that sample was taken (de-skew), using wheel odometry or an IMU.',
    'The ESP32 reads it over UART at 115200 baud (see Microcontrollers › UART); a PWM pin sets the motor speed. Each packet holds angle, distance, a quality byte and a start-of-rev flag.',
  ],
  controls: [
    { kind: 'slider', key: 'hz', label: 'Scan rate', min: 2, max: 10, step: 0.5, initial: 5.5, format: (v) => `${v} Hz` },
    { kind: 'choice', key: 'rate', options: opts(SAMPLE), initial: 's8k' },
    { kind: 'choice', key: 'motion', options: opts(MOTION), initial: 'drive' },
    { kind: 'choice', key: 'deskew', options: opts(DESKEW), initial: 'off' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { g, at } = topView(scene, S2.o, S2.sc)
    roomModel(g, S2.hScale).draw(ROOM_A)
    for (const o of ROOM_A.solids.filter((q) => q.name !== 'wall')) {
      const [x, y] = o.kind === 'box' ? [(o.x[0] + o.x[1]) / 2, (o.y[0] + o.y[1]) / 2] : o.at
      addLabel(scene, o.name, at(x, y, o.h * S2.hScale + 0.05), '#3a3d45', 0.34)
    }
    const robot = lidarRobot(g, 1.6)
    robot.group.position.z = 0
    const beam = rayFan(g, 4, glowMat(IR_TINT, 1.6), 0.025)
    const dots = pointCloud(g, S2.drawMax, 0.035)
    const ghost = rayFan(g, 2, glowMat(GREY, 0.5), 0.02)
    const seamText = liveLabel(scene, at(3, 4.35), { size: 0.34 })
    // Range vs angle.
    const PW = 15
    const PH = 7
    const PX = 12.2
    const PY = -3.5
    const plot = scope(scene, PW, PH, { divs: [8, 4], zeroAt: 0 })
    plot.group.position.set(PX, PY, 0)
    const trace = plot.trace(RING, { samples: 360, radius: 0.06 })
    const head = add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), glowMat(IR_TINT, 1.4)))
    partLetter(scene, '0°', [PX - PW / 2, PY - PH / 2 - 0.9, 0], 0.3, GREY, 'left')
    partLetter(scene, '360°', [PX + PW / 2, PY - PH / 2 - 0.9, 0], 0.3, GREY, 'right')
    partLetter(scene, 'range vs angle (0–6 m)', [PX, PY - PH / 2 - 0.9, 0], 0.3, LABEL)
    const code = codeBlock(scene, [-25, 14.6, 0], 0.34, 4)
    const status = liveLabel(scene, [-25, -12.4, 0.3], { size: 0.38, align: 'left' })
    const s = { key: '', T: 0, rev: -1, cur: [] as ScanPoint[], prev: [] as ScanPoint[] }
    const MAXM = 6
    const yOf = (m: number | null) => -PH / 2 + 0.1 + (Math.min(MAXM, m ?? 0) / MAXM) * (PH - 0.2)
    return {
      scene,
      view: { center: [-1.5, 0.6, 0], radius: 78, polar: 1.36, azimuth: 0.06 },
      frame(dt, p) {
        const R = scanRun(p)
        const key = `${R.hz}|${R.sampleHz}|${R.motion}|${R.deskew}`
        if (key !== s.key) {
          s.T = 0
          s.rev = -1
          s.prev = []
          s.key = key
        }
        s.T += dt / S2.slow
        const rev = Math.floor(s.T * R.hz)
        const frac = s.T * R.hz - rev
        if (rev !== s.rev) {
          s.prev = s.cur.length && s.rev === rev - 1 ? s.cur : []
          s.cur = scanRev(ROOM_A, R.pose, rev / R.hz, R.hz, R.sampleHz, S2.z, R.stride)
          s.rev = rev
          const full = s.prev
          if (full.length) trace.draw((u) => yOf(full[Math.min(full.length - 1, Math.floor(u * full.length))].m), null)
          else trace.draw(() => -PH / 2 + 0.1, null)
        }
        const pose = R.pose(s.T)
        robot.group.position.set(pose.x, pose.y, 0)
        robot.group.rotation.z = pose.th
        const a = 2 * Math.PI * frac
        robot.head.rotation.z = -a
        // Beam: from the head to whatever it hits now.
        const ex = pose.x + robot.eye[0] * Math.cos(pose.th)
        const ey = pose.y + robot.eye[0] * Math.sin(pose.th)
        const L = lidarRay(ROOM_A, [ex, ey, S2.z], rayDir(pose.th - a))
        const lift = (q: P3): V3 => [q[0], q[1], 0.3]
        beam(L.path.slice(1).map((q, i) => [lift(L.path[i]), lift(q)]))
        // Points: this rev up to the beam, the rest from the last rev.
        const shown = Math.min(s.cur.length, Math.floor(frac * s.cur.length))
        const total = s.prev.length || shown
        for (let i = 0; i < Math.max(total, shown); i++) {
          const q = i < shown ? s.cur[i] : s.prev[i]
          const xy = q ? (R.deskew ? q.world : q.raw) : null
          if (!xy) dots.set(i, [0, 0, -5], DIM, 0)
          else dots.set(i, [xy[0], xy[1], 0.3], q.phantom ? PHANTOM : i < shown ? BRIGHT : DIM, i < shown && shown - i < 12 ? 1.6 : 1)
        }
        dots.show(Math.max(total, shown))
        // Scan-start pose: where a raw scan assumes the robot stayed.
        const p0 = R.pose(rev / R.hz)
        const moving = R.motion !== 'parked'
        ghost(moving && !R.deskew ? [[[p0.x, p0.y, 0.32], [p0.x + 0.5 * Math.cos(p0.th), p0.y + 0.5 * Math.sin(p0.th), 0.32]]] : [])
        seamText.set(
          !moving ? 'parked: every point lands on its wall' : R.deskew ? 'de-skewed: each point placed at its own pose' : R.motion === 'drive' ? `raw: walls smeared, seam ${cm(R.seam)} (grey = scan-start pose)` : `raw: ring twisted ${R.skew.toFixed(1)}° over one rev`,
          !moving || R.deskew ? POWER : HEAT,
        )
        const cur = s.cur[Math.min(s.cur.length - 1, Math.floor(frac * s.cur.length))]
        head.position.set(PX + plot.xAt(frac), PY + yOf(cur?.m ?? null), 0.3)
        code([
          'RPLidar lidar;  lidar.begin(Serial2);  // 115200 baud',
          `lidar.startScan();  analogWrite(MOTOCTL, ${Math.round((R.hz / 10) * 255)});  // ~${R.hz} Hz`,
          'if (IS_OK(lidar.waitPoint())) { auto p = lidar.getCurrentPoint();',
          `  // p.angle ${((a * 180) / Math.PI).toFixed(1)}°  p.distance ${cur?.m ? Math.round(cur.m * 1000) : 0} mm  p.startBit ${frac < 0.05 ? 1 : 0}`,
        ])
        status.set(
          `t = ${s.T.toFixed(2)} s · slowed ${S2.slow}× · rev ${rev} · ${R.N} points/rev${R.stride > 1 ? ` (1 in ${R.stride} drawn)` : ''}`,
          LABEL,
        )
      },
      readouts: (p) => {
        const R = scanRun(p)
        return [
          { label: 'Points / rev', value: `${R.N}` },
          { label: 'Angular step', value: `${R.res.toFixed(2)}°` },
          { label: 'New map every', value: `${Math.round(1000 / R.hz)} ms` },
          {
            label: 'Moved per rev',
            value: R.motion === 'drive' ? cm(R.seam) : R.motion === 'spin' ? `${R.skew.toFixed(1)}°` : '0',
            tone: R.motion === 'parked' || R.deskew ? 'ok' : 'warn',
          },
        ]
      },
    }
  },
}

// --- Point clouds: a 16-laser head, points coloured by height, intensity or cluster. ---

const LAYERS = { l1: '1 laser (2D)', l4: '4 lasers', l16: '16 (VLP-16)', l32: '32 lasers' }
const LAYER_N: Record<keyof typeof LAYERS, number> = { l1: 1, l4: 4, l16: 16, l32: 32 }
const COLOR_BY = { height: 'Colour: height', intensity: 'Colour: intensity', cluster: 'Colour: clusters' }
const PC = { sc: 3.1, az: 180, hz: 10, slow: 20, eye: [3.4, 3, 0.7] as P3, roomH: 2.4 }
const PC_O: V3 = [-4 * PC.sc - 1, -6, 3 * PC.sc - 2]
const pcRoom = memoBy(
  (personM: number) => `${personM}`,
  (personM: number): Room =>
    walledRoom(8, 6, PC.roomH, [
      { kind: 'box', name: 'person', x: [PC.eye[0] + personM, PC.eye[0] + personM + 0.3], y: [3.3, 3.75], h: 1.75, refl: 0.4 },
      { kind: 'box', name: 'crate', x: [5.4, 6.1], y: [0.8, 1.5], h: 0.6, refl: 0.55 },
      { kind: 'box', name: 'cabinet', x: [0.3, 1.0], y: [4.4, 5.7], h: 1.2, refl: 0.6 },
      { kind: 'post', name: 'pillar', at: [2.2, 1.4], r: 0.16, h: PC.roomH, refl: 0.7 },
      { kind: 'post', name: 'cone', at: [6.6, 4.6], r: 0.13, h: 0.5, refl: 0.95 },
    ]),
)
const pcRun = memoBy(
  (p: Params) => `${p.layers}|${p.color}|${p.person}`,
  (p: Params) => {
    const layers = LAYER_N[pick(LAYERS, p.layers, 'l16')]
    const color = pick(COLOR_BY, p.color, 'height')
    const person = n(p, 'person')
    const room = pcRoom(person)
    const elevs = layerElevs(layers)
    const pts = cloudScan(room, PC.eye, elevs, PC.az)
    const solid = pts.filter((q) => !q.ground)
    const P = solid.map((q) => q.p)
    const labels = clusterPoints(P, 0.3, 4)
    const boxes = clusterBoxes(P, labels)
    const label = new Map(solid.map((q, i) => [q, labels[i]]))
    const realPerRev = layers * Math.round(360 / VLP16.resDeg)
    const walls = { ...room, solids: room.solids.filter((x: RoomSolid) => x.name !== 'wall') }
    return { layers, color, person, room, walls, elevs, pts, label, boxes, realPerRev, ground: pts.length - solid.length, personSeen: solid.some((q) => q.what === 'person') }
  },
)
const CLUSTER_COLORS = ['#ff6a5a', '#5ce1a0', '#5ad8e6', '#ffd84d', '#b48cff', '#ff9a2e', '#ff7ad9']
const INT_LO = new THREE.Color('#2a3a8a')
const INT_HI = new THREE.Color('#fff2a0')

export const pointClouds: Lesson = {
  id: 'lidar-point-clouds',
  title: 'Point clouds',
  tagline: 'Stack lasers at different angles and the scan becomes a 3D cloud',
  formula: (p) => {
    const R = pcRun(p)
    return `${R.layers} lasers × 360° / ${VLP16.resDeg}° = ${R.realPerRev.toLocaleString('en-US')} points/rev × ${VLP16.hz} Hz = ${(R.realPerRev * VLP16.hz).toLocaleString('en-US')} points/s · laser k at ${R.layers === 1 ? '0°' : `−15° + k × ${(30 / (R.layers - 1)).toFixed(2)}°`} · ground ring r = h / tan(15°) = ${(PC.eye[2] / Math.tan((15 * Math.PI) / 180)).toFixed(1)} m · ${R.boxes.filter((b) => b.kind === 'obstacle').length} obstacle clusters`
  },
  legend: [
    { color: IR_TINT, label: '905 nm lasers, one column at a time', shape: 'dot' },
    { color: HEAT, label: 'Height: blue floor → red 2.4 m', shape: 'dot' },
    { color: POWER, label: 'Clusters: one colour per object', shape: 'dot' },
  ],
  points: [
    'A 2D lidar sees one slice (see 2D scan): a table at knee height, or a person’s legs. Stack several lasers at fixed angles and spin them together, and each turn sweeps a set of cones: a 3D point cloud. A VLP-16 has 16 lasers 2° apart over ±15°.',
    'Each point is (x, y, z) plus an intensity: how strongly it came back. Bright paint, road signs and traffic cones return far more than dark cloth, so intensity helps tell materials apart.',
    'Lasers aimed down hit the floor in rings, closer for steeper lasers (r = height / tan angle). Most robots remove the ground first: drop points near z = 0.',
    'Then cluster: points closer than ~30 cm join the same object. Long flat clusters are walls; small ones are obstacles to plan around, each with a bounding box. A wall stub cut off by an obstacle’s shadow can pass for an obstacle; with only 4 lasers the rows are too far apart to join, so one object splits into slices.',
    'Clouds are heavy: 16 × 1800 points × 10 Hz is ~300 000 points/s over Ethernet, too much for an ESP32; a Raspberry Pi or Jetson runs it, often with ROS. Drawn here every 2°, real heads step 0.2°.',
  ],
  controls: [
    { kind: 'choice', key: 'layers', options: opts(LAYERS), initial: 'l16' },
    { kind: 'choice', key: 'color', options: opts(COLOR_BY), initial: 'height' },
    { kind: 'slider', key: 'person', label: 'Person ahead', min: 0.8, max: 4, step: 0.1, initial: 1.8, format: (v) => `${v.toFixed(1)} m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const g = add(scene, new THREE.Group(), PC_O)
    g.scale.setScalar(PC.sc)
    g.rotation.x = -Math.PI / 2
    const toScene = (q: P3): V3 => [PC_O[0] + q[0] * PC.sc, PC_O[1] + q[2] * PC.sc, PC_O[2] - q[1] * PC.sc]
    const room = roomModel(g, 1, 0.3)
    const robot = lidarRobot(g, 1.4)
    robot.group.position.set(PC.eye[0] - robot.eye[0], PC.eye[1], 0)
    cylinder(g, 0.02, PC.eye[2] - 0.2, mat('#8a8f99', { rough: 0.4 }), [PC.eye[0], PC.eye[1], 0.2 + (PC.eye[2] - 0.2) / 2], 'z', 12)
    const puck = cylinder(g, 0.05, 0.07, mat('#2a2c32', { rough: 0.35 }), [PC.eye[0], PC.eye[1], PC.eye[2]], 'z', 24)
    const cloud = pointCloud(g, 32 * PC.az, 0.028)
    const fan = rayFan(g, 32, glowMat(IR_TINT, 1.4), 0.012)
    const edges = rayFan(g, 12 * 8, glowMat(POWER, 0.9), 0.015)
    const tags = Array.from({ length: 6 }, () => liveLabel(scene, [0, 0, 0], { size: 0.34 }))
    const status = liveLabel(scene, toScene([0, -0.6, 0]), { size: 0.38, align: 'left' })
    const s = { key: '', T: 0, built: 0 }
    const col = new THREE.Color()
    return {
      scene,
      view: { center: [-1, -3.5, -2], radius: 60, polar: 0.98, azimuth: 0.15 },
      frame(dt, p) {
        const R = pcRun(p)
        const key = `${R.layers}|${R.color}|${R.person}`
        room.draw(R.walls)
        if (key !== s.key) {
          s.T = 0
          s.built = 0
          s.key = key
          R.pts.forEach((q, i) => {
            if (R.color === 'height') potentialColor(q.p[2] / PC.roomH, col)
            else if (R.color === 'intensity') col.copy(INT_LO).lerp(INT_HI, Math.min(1, q.intensity))
            else {
              const l = R.label.get(q) ?? -1
              const b = l >= 0 ? R.boxes[l] : null
              col.set(q.ground ? '#3a3e48' : !b ? '#666a74' : b.kind === 'wall' ? '#8a8f99' : CLUSTER_COLORS[l % CLUSTER_COLORS.length])
            }
            cloud.set(i, q.p, col)
          })
          const obstacles = R.color === 'cluster' ? R.boxes.filter((b) => b.kind === 'obstacle').slice(0, 8) : []
          edges(
            obstacles.flatMap((b) => {
              const c = (i: number): V3 => [i % 2 ? b.hi[0] : b.lo[0], Math.floor(i / 2) % 2 ? b.hi[1] : b.lo[1], i >= 4 ? b.hi[2] : b.lo[2]]
              return [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]].map(([u, v]) => [c(u), c(v)] as [V3, V3])
            }),
          )
          tags.forEach((t, i) => {
            const b = obstacles[i]
            t.group.visible = !!b
            if (!b) return
            t.group.position.set(...toScene([(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, b.hi[2] + 0.15]))
            t.set(`${(b.hi[0] - b.lo[0]).toFixed(1)}×${(b.hi[1] - b.lo[1]).toFixed(1)}×${b.hi[2].toFixed(1)} m`, POWER)
          })
        }
        // Sweep: the column of lasers turns, laying down points on the first rev.
        s.T += dt / PC.slow
        const frac = (s.T * PC.hz) % 1
        const az = 2 * Math.PI * frac
        puck.rotation.z = az
        if (s.built < 1) s.built = Math.min(1, s.T * PC.hz)
        const upTo = s.built >= 1 ? R.pts.length : R.pts.findIndex((q) => Math.atan2(q.p[1] - PC.eye[1], q.p[0] - PC.eye[0]) + (q.p[1] < PC.eye[1] ? 2 * Math.PI : 0) > az)
        cloud.show(upTo < 0 ? R.pts.length : upTo)
        fan(
          R.elevs.map((e) => {
            const d = rayDir(az, (e * Math.PI) / 180)
            const L = lidarRay(R.room, PC.eye, d, VLP16)
            const m = L.m ?? 1
            return [PC.eye, [PC.eye[0] + d[0] * m, PC.eye[1] + d[1] * m, PC.eye[2] + d[2] * m]] as [V3, V3]
          }),
        )
        status.set(
          `t = ${s.T.toFixed(2)} s · slowed ${PC.slow}× · ${R.pts.length} points drawn (every 2°) · ground ${R.ground} · person ${R.personSeen ? 'seen' : 'missed'}`,
          R.personSeen ? LABEL : HEAT,
        )
      },
      readouts: (p) => {
        const R = pcRun(p)
        const obs = R.boxes.filter((b) => b.kind === 'obstacle').length
        return [
          { label: 'Points / rev', value: R.realPerRev.toLocaleString('en-US') },
          { label: 'Points / s', value: (R.realPerRev * VLP16.hz).toLocaleString('en-US') },
          { label: 'Clusters', value: `${R.boxes.length - obs} wall, ${obs} obstacle` },
          { label: 'Person', value: R.personSeen ? 'in the cloud' : 'missed', tone: R.personSeen ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Resolution and range: thin, far, dark, clear and shiny targets. ---

const SURF = { white: 'White panel', black: 'Black panel', glass: 'Glass door', mirror: 'Mirror' }
const SURF_SOLID: Record<keyof typeof SURF, Pick<RoomSolid, 'refl' | 'optic'>> = {
  white: { refl: 0.85 },
  black: { refl: 0.05 },
  glass: { refl: 0.05, optic: 'glass' },
  mirror: { refl: 0.05, optic: 'mirror' },
}
const RR = { sc: 3.1, o: [-23, -3, 0] as V3, z: 0.2, robot: [0.6, 1.8] as [number, number], legR: 0.0125, legY: 2.5, slow: 10, hz: 5 }
const rrRun = memoBy(
  (p: Params) => `${p.res}|${p.leg}|${p.surf}|${p.panel}`,
  (p: Params) => {
    const res = n(p, 'res')
    const leg = n(p, 'leg')
    const surf = pick(SURF, p.surf, 'black')
    const panel = n(p, 'panel')
    const [rx, ry] = RR.robot
    const legAt: [number, number] = [rx + Math.sqrt(leg ** 2 - (RR.legY - ry) ** 2), RR.legY]
    const room = walledRoom(12, 3.6, 1, [
      { kind: 'post', name: 'chair leg', at: legAt, r: RR.legR, h: 0.45, refl: 0.6 },
      { kind: 'box', name: 'panel', x: [rx + panel, rx + panel + 0.04], y: [0.3, 1.5], h: 1, ...SURF_SOLID[surf] },
    ])
    const sampleHz = 360 / res
    const N = pointsPerRev(sampleHz, 1)
    const legAng = Math.atan2(legAt[1] - ry, legAt[0] - rx)
    return {
      res,
      leg,
      surf,
      panel,
      room,
      legAt,
      legAng,
      sampleHz,
      N,
      gap: beamGap(leg, res),
      chance: seenChance(2 * RR.legR, leg, res),
      reach: lidarReach(SURF_SOLID[surf].refl),
      /** Leg position in sample steps, clockwise like the scan. */
      legU: ((2 * Math.PI - legAng) / (2 * Math.PI)) * N,
    }
  },
)
const SURF_NOTE = (R: ReturnType<typeof rrRun>, panelPts: number, phantoms: number) =>
  R.surf === 'glass'
    ? `glass: beam passes through, ${panelPts} on it (only square-on)`
    : R.surf === 'mirror'
      ? `mirror: ${phantoms} phantom points behind it`
      : R.reach < R.panel
        ? `${SURF[R.surf].toLowerCase()} ${Math.round(SURF_SOLID[R.surf].refl * 100)} %: reach ${R.reach.toFixed(1)} m < ${R.panel} m → dropped`
        : `${SURF[R.surf].toLowerCase()} ${Math.round(SURF_SOLID[R.surf].refl * 100)} %: reach ${R.reach.toFixed(1)} m, ${panelPts} points`

export const rangeAndResolution: Lesson = {
  id: 'lidar-resolution-and-range',
  title: 'Resolution and range',
  tagline: 'Beams spread apart with distance, and some surfaces never send them back',
  formula: (p) => {
    const R = rrRun(p)
    return `gap = d × Δθ = ${R.leg.toFixed(1)} m × ${R.res}° × π/180 = ${cm(R.gap)} vs a 2.5 cm leg → seen in ${Math.round(R.chance * 100)} % of scans · reach ∝ √ρ: ${RPLIDAR_A1.maxM} m × √(${SURF_SOLID[R.surf].refl} / ${RPLIDAR_A1.refRefl}) = ${R.reach.toFixed(1)} m · ${R.N} points/rev`
  },
  legend: [
    { color: IR_TINT, label: 'Beams near the chair leg', shape: 'dot' },
    { color: RING, label: 'Scan points', shape: 'dot' },
    { color: HEAT, label: 'Phantom points (mirror)', shape: 'dot' },
  ],
  points: [
    'Beams leave the head at fixed angles, so the gap between neighbours grows with distance: gap = d × Δθ. At 1° that is 1.7 cm at 1 m but 14 cm at 8 m. A 2.5 cm chair leg at 8 m falls between beams most of the time and flickers in and out of the map.',
    'Finer steps help (see 2D scan: slow the spin or raise the sample rate). Far, thin things (legs, cables, poles) still need a second sensor such as a bumper or ultrasonic.',
    'Range depends on how much light comes back: return ∝ ρ·cos(angle) / d², so reach ∝ √ρ. The A1 is rated 12 m on 70 % white; black plastic at 5 % reaches only ~3 m, and grazing walls fade early too.',
    'Glass lets the beam through: the scan shows whatever is behind the door, as if it were open, except for the one or two beams that hit square-on.',
    'A mirror bounces the beam on, so the sensor reports the path length along its original angle: a phantom room appears behind the mirror. Mark glass and mirrors on the map, or tape them at beam height.',
  ],
  controls: [
    { kind: 'slider', key: 'res', label: 'Angular step', min: 0.25, max: 2, step: 0.05, initial: 1, format: (v) => `${v.toFixed(2)}° (${Math.floor(360 / v)} pts)` },
    { kind: 'slider', key: 'leg', label: 'Chair leg distance', min: 1, max: 10, step: 0.1, initial: 4, format: (v) => `${v.toFixed(1)} m` },
    { kind: 'choice', key: 'surf', options: opts(SURF), initial: 'black' },
    { kind: 'slider', key: 'panel', label: 'Panel distance', min: 1.5, max: 10, step: 0.5, initial: 5, format: (v) => `${v} m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { g, at } = topView(scene, RR.o, RR.sc)
    const room = roomModel(g, 0.25)
    const robot = lidarRobot(g, 2)
    robot.group.position.set(RR.robot[0] - 0.2, RR.robot[1], 0)
    const legMark = add(g, new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 24), glowMat(LABEL, 0.6)))
    const legText = liveLabel(scene, [0, 0, 0.3], { size: 0.32 })
    const panelText = liveLabel(scene, [0, 0, 0.3], { size: 0.32 })
    const dots = pointCloud(g, 1440, 0.035)
    const fan = rayFan(g, 9, glowMat(IR_TINT, 1.1), 0.012)
    const beam = rayFan(g, 4, glowMat(IR_TINT, 1.6), 0.025)
    addLabel(scene, '12 m corridor', at(6, 3.85), GREY, 0.3)
    // Inset: beams crossing the leg, magnified.
    const IN = { x: -4, y: -10, w: 24, h: 6.8 }
    box(scene, [IN.w + 0.6, IN.h + 0.6, 0.2], mat('#1d1f25', { rough: 0.6 }), [IN.x, IN.y, -0.3])
    const legDisc = cylinder(scene, 1, 0.3, mat('#c9ced8', { rough: 0.4 }), [IN.x + 2, IN.y, 0], 'z', 32)
    const inBeams = rayFan(scene, 7, glowMat(IR_TINT, 0.6), 0.07)
    const inHits = rayFan(scene, 7, glowMat(RING, 1.6), 0.12)
    const inText = liveLabel(scene, [IN.x, IN.y + IN.h / 2 + 0.9, 0.3], { size: 0.32 })
    const status = liveLabel(scene, [-25, -15.4, 0.3], { size: 0.38, align: 'left' })
    const s = { key: '', T: 0, rev: -1, cur: [] as ScanPoint[], prev: [] as ScanPoint[], seen: 0, revs: 0 }
    const pose = { x: RR.robot[0], y: RR.robot[1], th: 0 }
    return {
      scene,
      view: { center: [-1.5, -1.2, 0], radius: 78, polar: 1.36, azimuth: 0.06 },
      frame(dt, p) {
        const R = rrRun(p)
        const key = `${R.res}|${R.leg}|${R.surf}|${R.panel}`
        room.draw(R.room)
        if (key !== s.key) {
          s.T = 0
          s.rev = -1
          s.cur = []
          s.seen = s.revs = 0
          s.key = key
        }
        s.T += dt / RR.slow
        const rev = Math.floor(s.T * RR.hz)
        const frac = s.T * RR.hz - rev
        const phase = scanPhase(rev)
        if (rev !== s.rev) {
          s.prev = s.rev === rev - 1 ? s.cur : []
          s.cur = scanRev(R.room, () => pose, 0, 1, R.sampleHz, RR.z, 1, phase)
          s.rev = rev
          s.revs++
          if (s.cur.some((q) => q.m !== null && q.world && Math.hypot(q.world[0] - R.legAt[0], q.world[1] - R.legAt[1]) < 0.05)) s.seen++
        }
        const a = 2 * Math.PI * frac
        robot.head.rotation.z = -a
        const L = lidarRay(R.room, [pose.x, pose.y, RR.z], rayDir(-a))
        beam(L.path.slice(1).map((q, i) => [[L.path[i][0], L.path[i][1], 0.3], [q[0], q[1], 0.3]] as [V3, V3]))
        const shown = Math.floor(frac * s.cur.length)
        const total = Math.max(shown, s.prev.length)
        let panelPts = 0
        let phantoms = 0
        for (let i = 0; i < total; i++) {
          const q = i < shown ? s.cur[i] : s.prev[i]
          if (!q?.world) {
            dots.set(i, [0, 0, -5], DIM, 0)
            continue
          }
          if (q.phantom) phantoms++
          if (!q.phantom && Math.abs(q.world[0] - (RR.robot[0] + R.panel)) < 0.06 && q.world[1] < 1.55) panelPts++
          dots.set(i, [q.world[0], q.world[1], 0.3], q.phantom ? PHANTOM : i < shown ? BRIGHT : DIM)
        }
        dots.show(total)
        // Beams around the leg.
        const k = Math.round(R.legU - phase)
        fan(
          Array.from({ length: 9 }, (_, j) => {
            const ang = (-2 * Math.PI * (k - 4 + j + phase)) / R.N
            const r = lidarRay(R.room, [pose.x, pose.y, RR.z], rayDir(ang))
            const end = r.path[1]
            return [[pose.x, pose.y, 0.3], [end[0], end[1], 0.3]] as [V3, V3]
          }),
        )
        legMark.position.set(R.legAt[0], R.legAt[1], 0.12)
        legText.group.position.set(...at(R.legAt[0], R.legAt[1] + 0.35, 0.1))
        const ratio = s.revs ? s.seen / s.revs : 0
        legText.set(`chair leg 2.5 cm · ${cm(R.gap)} gaps`, R.chance >= 1 ? POWER : HEAT)
        panelText.group.position.set(...at(Math.min(9.2, RR.robot[0] + R.panel), -0.45, 0.1))
        panelText.set(SURF_NOTE(R, panelPts, phantoms), R.surf === 'white' || (R.surf === 'black' && R.reach >= R.panel) ? POWER : HEAT)
        // Inset: lateral offsets of the 7 nearest beams at the leg (from beamsAcross).
        const across = beamsAcross(2 * RR.legR, R.leg, R.res, (((phase - R.legU + 0.5) % 1) + 1) % 1, 3)
        const span = Math.max(7 * R.gap, 4 * RR.legR)
        const kk = (IN.h - 0.4) / span
        const rLeg = Math.max(0.1, Math.min(IN.h / 2 - 0.2, RR.legR * kk))
        legDisc.scale.set(rLeg, 1, rLeg)
        const x0 = IN.x - IN.w / 2 + 0.3
        const xl = IN.x + 2
        inBeams(across.map((b) => [[x0, IN.y + b.off * kk, 0.2], [b.hit ? xl - Math.sqrt(Math.max(0, rLeg ** 2 - (b.off * kk) ** 2)) : IN.x + IN.w / 2 - 0.3, IN.y + b.off * kk, 0.2]] as [V3, V3]))
        inHits(across.filter((b) => b.hit).map((b) => [[xl - rLeg - 0.6, IN.y + b.off * kk, 0.3], [xl - rLeg, IN.y + b.off * kk, 0.3]] as [V3, V3]))
        inText.set(`at the leg${kk / RR.sc >= 2 ? ` (×${Math.round(kk / RR.sc)})` : ''}: beams ${cm(R.gap)} apart · this rev ${across.some((b) => b.hit) ? 'HIT' : 'missed'} · seen ${Math.round(ratio * 100)} % of ${s.revs} revs`, across.some((b) => b.hit) ? POWER : HEAT)
        status.set(`t = ${s.T.toFixed(2)} s · slowed ${RR.slow}× at ${RR.hz} Hz · rev ${rev}: sample angles drift ${(phase * R.res).toFixed(2)}° each turn`, LABEL)
      },
      readouts: (p) => {
        const R = rrRun(p)
        return [
          { label: 'Points / rev', value: `${R.N}` },
          { label: 'Gap at the leg', value: cm(R.gap), tone: R.gap > 2 * RR.legR ? 'warn' : 'ok' },
          { label: 'Leg seen', value: `${Math.round(R.chance * 100)} % of scans`, tone: R.chance < 1 ? 'warn' : 'ok' },
          { label: 'Panel', value: R.surf === 'glass' ? 'see-through' : R.surf === 'mirror' ? 'phantoms' : `reach ${R.reach.toFixed(1)} m`, tone: R.surf === 'white' || (R.surf === 'black' && R.reach >= R.panel) ? 'ok' : 'warn' },
        ]
      },
    }
  },
}
