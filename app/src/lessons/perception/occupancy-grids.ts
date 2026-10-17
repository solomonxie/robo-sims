import * as THREE from 'three/webgpu'
import { Beam, OccSensor, Pose, Room, cellState, integrateScan, lapPath, logOdds, occCellOf, occCentre, occIndex, occModel, occRun, occScan, occStats, occTruth, probOf, roomOccGrid, walledRoom, wrapPi } from '../../core/physics'
import { V3 } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, HIGH_V, IR_TINT, LABEL, OCC_COLORS, POWER, RING, addLabel, beamCone, floorView, glowMat, lidarRobot, liveLabel, memoBy, occTiles, pointCloud, rayFan, roomModel, scope, statusHeader } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'
import { cmWhole } from '../../core/units'

const f2 = (v: number) => v.toFixed(2)
const sgn = (v: number, d = 2) => (+Math.abs(v).toFixed(d) === 0 ? (0).toFixed(d) : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`)
const pct = (v: number) => `${Math.round(v * 100)} %`
const MODEL = occModel(0.7, 0.4, 0.97)
const GRID_LEGEND = [
  { color: OCC_COLORS.unknown, label: 'Unknown cell (p = 0.5)', shape: 'dot' as const },
  { color: OCC_COLORS.free, label: 'Free (p → 0)', shape: 'dot' as const },
  { color: '#2a2c31', label: 'Occupied (p → 1), drawn black', shape: 'dot' as const },
]

// --- Ray casting: one scan, each beam walked cell by cell with Bresenham. ---

const ROOM = walledRoom(5, 3.6, 0.8, [
  { kind: 'box', name: 'partition', x: [3.0, 3.1], y: [0, 1.3], h: 0.8, refl: 0.8 },
  { kind: 'box', name: 'partition', x: [3.0, 3.1], y: [2.1, 3.6], h: 0.8, refl: 0.8 },
  { kind: 'box', name: 'sofa', x: [0.3, 1.7], y: [3.0, 3.5], h: 0.5, refl: 0.4 },
  { kind: 'box', name: 'crate', x: [1.8, 2.3], y: [0.35, 0.85], h: 0.4, refl: 0.6 },
  { kind: 'post', name: 'pillar', at: [2.25, 2.45], r: 0.12, h: 0.8, refl: 0.7 },
  { kind: 'box', name: 'shelf', x: [4.4, 4.9], y: [0.3, 1.2], h: 0.8, refl: 0.7 },
  { kind: 'post', name: 'bin', at: [4.2, 2.8], r: 0.15, h: 0.5, refl: 0.4 },
])
const SENSOR = { lidar360: 'Lidar, 360 beams', lidar36: 'Lidar, 36 beams', sonar: 'Sonar ring, 12 × HC-SR04' }
const SENSOR_N = { lidar360: 360, lidar36: 36, sonar: 12 }
const MAX_M = 4
const RC = { k: 3.1, tilt: -0.42, a: [-19.6, -7.6, 0] as V3, b: [0.8, -7.6, 0] as V3, sweep: 6, hold: 2.5 }

const rcKey = (p: Params) => [p.sensor, p.res, p.x].join('|')
const rcOf = memoBy(rcKey, (p: Params) => {
  const sensorKey = pick(SENSOR, p.sensor, 'lidar360')
  const sensor: OccSensor = sensorKey === 'sonar' ? 'sonar' : 'lidar'
  const res = n(p, 'res')
  const pose: Pose = { x: n(p, 'x'), y: 1.7, th: 0 }
  const beams = occScan(ROOM, pose, sensor, SENSOR_N[sensorKey], MAX_M)
  const g = roomOccGrid(ROOM, res)
  const cells = integrateScan(g, MODEL, pose, beams)
  const stats = occStats(g, occTruth(ROOM, res))
  const per = cells.reduce((s, c) => s + c.free.length + c.occ.length, 0) / cells.length
  return { sensorKey, sensor, res, pose, beams, cells, g, stats, per }
})

export const occupancyGridsRayCasting: Lesson = {
  id: 'occupancy-grids-ray-casting',
  title: 'Ray casting',
  tagline: 'An occupancy grid chops the floor into cells and keeps one number per cell: how sure the robot is that something is there. Each range beam is walked cell by cell: free where it passed, occupied where it stopped',
  formula: (p) => {
    const S = rcOf(p)
    return S.sensor === 'lidar'
      ? `cell = ⌊(x − x₀)/${S.res} m⌋ · Bresenham from the robot cell to the end cell: passed cells l += log(0.4/0.6) = −0.41, end cell l += log(0.7/0.3) = +0.85 · p = 1/(1 + e⁻ˡ)`
      : `sonar: every cell inside the ±15° cone short of the range l += −0.41; the whole arc at the range l += 0.85 × beam gain (something is somewhere on it) · p = 1/(1 + e⁻ˡ)`
  },
  legend: [
    { color: IR_TINT, label: 'Beam being folded in (lidar ray or sonar cone)', shape: 'dot' },
    { color: B_FIELD, label: 'Cells it passed: marked free', shape: 'dot' },
    { color: HIGH_V, label: 'Cell where it ended: marked occupied', shape: 'dot' },
    ...GRID_LEGEND,
  ],
  points: [
    'The map is a grid of cells, each holding the chance something is there. Every cell starts at p = 0.5: unknown. Rooms, walls and furniture become black cells; the floor the robot has seen becomes white.',
    'How each sensor measures range is in Sensors (Lidar › 2D scan, Ultrasonic › Beam angle) and Depth sensing. Here only the result matters: a beam left the robot at some angle and came back from a distance d, or found nothing within range.',
    'Ray casting turns that into cells. A beam that stopped at d says two things: the cells it passed are empty, and the cell at d holds something. Bresenham\'s line steps through exactly the cells a straight line crosses, using only integer adds, cheap enough to run for thousands of beams a second on an ESP32.',
    'A beam that returned nothing only frees cells, it marks nothing. A lidar ray is thin, so it clears a one-cell path and pins the hit to one cell. A sonar cone is 30° wide: it clears a whole wedge but can only say "something is on this arc", so doorways fill in and gaps between beams stay grey.',
    'Resolution is a trade-off. 5 cm cells draw thin legs and doorways sharply but need 16× the memory of 20 cm cells and many more beams to fill; coarse cells fill fast but swallow narrow gaps. Navigation lessons reuse this grid for planning and SLAM.',
  ],
  controls: [
    { kind: 'choice', key: 'sensor', options: opts(SENSOR), initial: 'lidar360' },
    { kind: 'slider', key: 'res', label: 'Cell size', min: 0.05, max: 0.4, step: 0.05, initial: 0.1, format: (v) => cmWhole(v) },
    { kind: 'slider', key: 'x', label: 'Robot x', min: 0.5, max: 2.7, step: 0.1, initial: 1.2, format: (v) => `${v.toFixed(1)} m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const below = (y: number, size: number, color?: string) => liveLabel(scene, [RC.a[0], RC.a[1] - y, 0.3], { size, color, align: 'left' })
    const [status, sub, event] = [below(3.0, 0.42), below(3.9, 0.3, GREY), below(4.7, 0.34)]
    const ga = floorView(scene, RC.a, RC.k, RC.tilt)
    roomModel(ga, 0.35).draw(ROOM)
    const robotA = lidarRobot(ga, 1.2)
    const rays = rayFan(ga, 400, glowMat(IR_TINT, 0.25), 0.006)
    const ray = rayFan(ga, 1, glowMat(IR_TINT, 1.6), 0.025)
    const cones = Array.from({ length: SENSOR_N.sonar }, () => beamCone(ga, IR_TINT))
    const gb = floorView(scene, RC.b, RC.k, RC.tilt)
    const tiles = occTiles(gb, 7600)
    const robotB = lidarRobot(gb, 1.2)
    const rayB = rayFan(gb, 1, glowMat(IR_TINT, 1.6), 0.02)
    const marks = pointCloud(gb, 2000, 0.02)
    const top = 4.1 * RC.k * Math.cos(RC.tilt)
    addLabel(scene, 'the room (what is really there)', [RC.a[0] + 2.5 * RC.k, RC.a[1] + top + 0.1, 0.3], LABEL, 0.34)
    const gTag = liveLabel(scene, [RC.b[0] + 2.5 * RC.k, RC.b[1] + top + 0.1, 0.3], { size: 0.34 })
    const note = liveLabel(scene, [RC.b[0] + 2.5 * RC.k, RC.b[1] - 1.7, 0.3], { size: 0.3 })
    const st = { key: '', t: 0, k: -1, lo: new Float32Array(0) }
    const FREE = new THREE.Color(B_FIELD)
    const OCC = new THREE.Color(HIGH_V)
    return {
      scene,
      view: { center: [-1.6, -1.9, 0], radius: 64, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = rcOf(p)
        const key = rcKey(p)
        if (key !== st.key) {
          Object.assign(st, { key, t: 0, k: -1 })
          for (const r of [robotA, robotB]) {
            r.group.position.set(S.pose.x, S.pose.y, 0)
            r.group.rotation.z = S.pose.th
          }
          status.set(`one scan from (${S.pose.x.toFixed(1)}, ${S.pose.y.toFixed(1)}) m · ${S.beams.length} ${S.sensor === 'lidar' ? 'beams' : 'sonar cones'} · ${S.g.nx} × ${S.g.ny} = ${S.g.lo.length} cells of ${cmWhole(S.res)}`, LABEL)
          sub.set(`after the scan: ${S.stats.free} free, ${S.stats.occ} occupied, ${pct(S.stats.unknown / S.stats.cells)} still unknown · ${S.per.toFixed(0)} cells touched per beam`, GREY)
          const wrongShare = S.stats.wrong / Math.max(1, S.stats.free + S.stats.occ)
          event.set(
            S.sensor === 'sonar' ? `wide cones: ${S.stats.wrong} cells wrong (${pct(wrongShare)} of what it claims), doorway and gaps smeared` : S.res >= 0.3 ? `coarse cells: the pillar and the doorway blur into a few blocks` : S.beams.length < 100 ? 'sparse beams: far walls dotted, wedges between rays stay grey' : 'thin rays: one-cell paths, hits pinned to one cell',
            S.sensor === 'sonar' || S.res >= 0.3 ? HEAT : S.beams.length < 100 ? HEAT : POWER,
          )
        }
        st.t = (st.t + dt) % (RC.sweep + RC.hold)
        const k = Math.min(S.beams.length, Math.floor((st.t / RC.sweep) * S.beams.length) + 1)
        if (k === st.k) return
        if (k < st.k || st.k < 0) {
          st.lo = new Float32Array(S.g.lo.length)
          st.k = 0
        }
        const g = { ...S.g, lo: st.lo }
        integrateScan(g, MODEL, S.pose, S.beams.slice(st.k, k))
        st.lo = g.lo.slice()
        st.k = k
        tiles.draw(S.g, st.lo)
        const b: Beam = S.beams[k - 1]
        const th = S.pose.th + b.a
        const end = (m: number): V3 => [S.pose.x + m * Math.cos(th), S.pose.y + m * Math.sin(th), 0.12]
        const o: V3 = [S.pose.x, S.pose.y, 0.12]
        robotA.head.rotation.z = b.a
        const done = k >= S.beams.length
        if (S.sensor === 'lidar') {
          rays(S.beams.slice(0, k).map((q) => {
            const t2 = S.pose.th + q.a
            return [o, [S.pose.x + q.m * Math.cos(t2), S.pose.y + q.m * Math.sin(t2), 0.12]] as [V3, V3]
          }))
          ray(done ? [] : [[o, end(b.m)]])
          rayB(done ? [] : [[[o[0], o[1], 0.03], [end(b.m)[0], end(b.m)[1], 0.03]]])
          cones.forEach((c) => c([o[0], o[1], 0.25], 0, 0.1, 0.1, 0))
        } else {
          rays([])
          ray([])
          rayB([])
          S.beams.forEach((q, i) => cones[i]([o[0], o[1], 0.25], S.pose.th + q.a, q.half, q.m, i < k ? (i === k - 1 && !done ? 0.4 : 0.12) : 0))
        }
        const c = S.cells[k - 1]
        let i = 0
        if (!done) {
          for (const q of c.free) if (i < 2000) marks.set(i++, [...occCentre(S.g, q), 0.03] as V3, FREE, S.res / 0.1)
          for (const q of c.occ) if (i < 2000) marks.set(i++, [...occCentre(S.g, q), 0.04] as V3, OCC, (1.6 * S.res) / 0.1)
        }
        marks.show(i)
        gTag.set(done ? 'occupancy grid after the whole scan' : `occupancy grid · beam ${k}/${S.beams.length} at ${Math.round(((b.a * 180) / Math.PI) % 360)}°`, LABEL)
        note.set(
          done ? `${S.stats.free} free, ${S.stats.occ} occupied, ${S.stats.unknown} unknown` : b.hit ? `${b.m.toFixed(2)} m: ${c.free.length} cells freed, ${c.occ.length} marked occupied` : `nothing within ${MAX_M} m: ${c.free.length} cells freed, none marked`,
          done ? GREY : b.hit ? LABEL : GREY,
        )
      },
      readouts: (p) => {
        const S = rcOf(p)
        const claimed = S.stats.free + S.stats.occ
        return [
          { label: 'Cells', value: `${S.g.nx} × ${S.g.ny} = ${S.g.lo.length}` },
          { label: 'Free / occupied', value: `${S.stats.free} / ${S.stats.occ}` },
          { label: 'Still unknown', value: pct(S.stats.unknown / S.stats.cells) },
          { label: 'Wrong vs the room', value: `${S.stats.wrong} (${pct(S.stats.wrong / Math.max(1, claimed))})`, tone: S.stats.wrong / Math.max(1, claimed) < 0.03 ? 'ok' : S.stats.wrong / Math.max(1, claimed) < 0.1 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}

// --- Log-odds update: laps round a room, evidence adds up per cell; a person stands then leaves; odometry drift smears the map. ---

const ROOM2_BASE: Room['solids'] = [
  { kind: 'box', name: 'sofa', x: [0.3, 1.9], y: [3.1, 3.55], h: 0.5, refl: 0.4 },
  { kind: 'box', name: 'crate', x: [0.15, 0.6], y: [0.15, 0.6], h: 0.4, refl: 0.6 },
  { kind: 'box', name: 'shelf', x: [4.6, 4.95], y: [2.4, 3.4], h: 0.8, refl: 0.7 },
  { kind: 'post', name: 'pillar', at: [2.5, 1.8], r: 0.15, h: 0.8, refl: 0.7 },
]
const ROOM2 = walledRoom(5, 3.6, 0.8, ROOM2_BASE)
const PERSON = { x: 3.45, y: 1.6, w: 0.3, leaveT: 16, v: 0.5 }
const personX = (t: number) => PERSON.x + Math.max(0, t - PERSON.leaveT) * PERSON.v
const ROOM2_AT = new Map<number, Room>()
const room2At = (t: number) => {
  const x = personX(t)
  if (x >= 5) return ROOM2
  const key = Math.round(x * 1000)
  let r = ROOM2_AT.get(key)
  if (!r) ROOM2_AT.set(key, (r = walledRoom(5, 3.6, 0.8, [...ROOM2_BASE, { kind: 'box', name: 'person', x: [x, x + PERSON.w], y: [PERSON.y, PERSON.y + PERSON.w], h: 1.7, refl: 0.4 }])))
  return r
}
const LAP = lapPath(2.5, 1.8, 1.9, 1.15, 0.45)
const LO = { T: 40, hz: 5, beams: 120, res: 0.1, speed: 2 }
const CLAMP = { c97: 'Clamp at p = 0.97', c88: 'Clamp at p = 0.88', none: 'No clamp' }
const CLAMP_P = { c97: 0.97, c88: 0.88, none: 1 }
const PROBE = { person: 'Probe: where the person stood', wall: 'Probe: a wall cell', floor: 'Probe: open floor' }
const LG = { k: 3.15, tilt: -0.42, at: [-21.4, -8.6, 0] as V3, sx: 8.4, sy: -1.6, sw: 13, sh: 6.4, lim: 10 }

const loKey = (p: Params) => [p.phit, p.clamp, p.drift].join('|')
const loOf = memoBy(loKey, (p: Params) => {
  const pHit = n(p, 'phit')
  const clamp = pick(CLAMP, p.clamp, 'c97')
  const driftDeg = n(p, 'drift')
  const model = occModel(pHit, 0.4, CLAMP_P[clamp])
  const frames = occRun({ room: room2At, path: LAP, sensor: 'lidar', beams: LO.beams, maxM: 6, res: LO.res, model, drift: (driftDeg * Math.PI) / 180, T: LO.T, scanHz: LO.hz })
  const g = roomOccGrid(ROOM2, LO.res)
  const truth = occTruth(ROOM2, LO.res)
  const last = frames[frames.length - 1]
  const stats = occStats({ ...g, lo: last.lo }, truth)
  const leave = frames.findIndex((f) => f.t >= PERSON.leaveT)
  let personK = -1
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) {
      const [ci, cj] = occCellOf(g, PERSON.x + 0.05 + i * 0.1, PERSON.y + 0.05 + j * 0.1)
      const k = occIndex(g, ci, cj)
      if (personK < 0 || frames[leave].lo[k] > frames[leave].lo[personK]) personK = k
    }
  const [wi, wj] = occCellOf(g, -0.05, 1.25)
  const [fi, fj] = occCellOf(g, 1.25, 1.85)
  const probes = { person: personK, wall: occIndex(g, wi, wj), floor: occIndex(g, fi, fj) }
  const clearAt = frames.findIndex((f, i) => i > leave && cellState(f.lo[personK]) !== 'occ')
  const ghost = frames.filter((f) => f.t > PERSON.leaveT + 3).every((f) => cellState(f.lo[personK]) === 'occ')
  return { pHit, clamp, driftDeg, model, frames, g, stats, probes, leave, clearAt, ghost, finalErr: Math.hypot(last.est.x - last.pose.x, last.est.y - last.pose.y), finalTh: wrapPi(last.est.th - last.pose.th) }
})

export const occupancyGridsLogOddsUpdate: Lesson = {
  id: 'occupancy-grids-log-odds-update',
  title: 'Log-odds update',
  tagline: 'One beam is weak evidence. Storing each cell as log-odds turns Bayes\' rule into a plain add per beam, so scan after scan the map firms up, and a clamp keeps it able to change its mind',
  formula: (p) => {
    const S = loOf(p)
    const lim = S.model.lMax === Infinity ? 'no clamp' : `clamp to ±${f2(S.model.lMax)}`
    return `l = log(p / (1 − p)) · per beam: l ← l + log(${f2(S.pHit)}/${f2(1 - S.pHit)}) = ${sgn(S.model.lOcc)} on a hit, ${sgn(S.model.lFree)} on a pass-through · ${lim} · p = 1 / (1 + e⁻ˡ)`
  },
  legend: [
    { color: IR_TINT, label: 'Lidar beams, this scan', shape: 'dot' },
    { color: RING, label: 'Probed cell and its log-odds', shape: 'dot' },
    { color: HEAT, label: 'Person (moving obstacle)', shape: 'dot' },
    { color: GREY, label: 'Where odometry thinks the robot is', shape: 'dot' },
  ],
  points: [
    'Each beam says "probably free" or "probably occupied", never certainly. Bayes\' rule combines them, but multiplying probabilities is slow and drifts to 0 or 1. In log-odds, l = log(p / (1 − p)), the update is an add: l ← l + l_sensor. Unknown is l = 0.',
    'The inverse sensor model is the pair of numbers added: here +0.85 when a beam ends in the cell (p_hit = 0.7) and −0.41 when it passes through (p = 0.4). A higher p_hit trusts single hits more: maps firm up faster, and so does noise.',
    'Things move. A person standing still piles up hits; once they walk off, each passing beam takes 0.41 back. Without a clamp a cell hit 100 times needs 200 misses to clear, so the person stays on the map as a ghost. Clamping l to about ±3.5 (p 0.03…0.97) keeps every cell a few scans from changing its mind.',
    'The map is only as good as the pose each scan is folded in at. Wheel odometry (Navigation › Odometry) slowly drifts in heading; every lap the walls land a little rotated, so they smear and double. Fixing that by matching scans to the map is SLAM.',
    'Same grid, same update, any range sensor: lidar, sonar (Ray casting), ToF or a depth camera\'s point cloud flattened to the floor (Depth sensing › Point cloud).',
  ],
  controls: [
    { kind: 'slider', key: 'phit', label: 'p_hit', min: 0.55, max: 0.95, step: 0.05, initial: 0.7, format: (v) => `${f2(v)} (${sgn(logOdds(v))})` },
    { kind: 'choice', key: 'clamp', options: opts(CLAMP), initial: 'c97' },
    { kind: 'slider', key: 'drift', label: 'Odometry drift', min: 0, max: 4, step: 0.5, initial: 0, format: (v) => `${v.toFixed(1)}°/m` },
    { kind: 'choice', key: 'probe', options: opts(PROBE), initial: 'person' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = floorView(scene, LG.at, LG.k, LG.tilt)
    const tiles = occTiles(g, 2400)
    const robot = lidarRobot(g, 1.2)
    const ghost = lidarRobot(g, 1.2)
    ghost.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = glowMat(GREY, 0.4)
    })
    const rays = rayFan(g, LO.beams, glowMat(IR_TINT, 0.6), 0.01)
    const person = new THREE.Mesh(new THREE.BoxGeometry(PERSON.w, PERSON.w, 0.5), glowMat(HEAT, 0.8))
    g.add(person)
    const probe = pointCloud(g, 1, 0.07)
    const top = 3.8 * LG.k * Math.cos(LG.tilt)
    const mapTag = liveLabel(scene, [LG.at[0] + 2.5 * LG.k, LG.at[1] + top + 0.4, 0.3], { size: 0.34 })
    const plot = scope(scene, LG.sw, LG.sh, { divs: [8, 4], zeroAt: 0.5 })
    plot.group.position.set(LG.sx, LG.sy, 0)
    const tr = plot.trace(RING, { samples: 220, radius: 0.07 })
    const hiLine = plot.level(GREY)
    const loLine = plot.level(GREY)
    const yOf = (l: number) => (Math.max(-LG.lim, Math.min(LG.lim, l)) / LG.lim) * (LG.sh / 2 - 0.1)
    const pTop = LG.sy + LG.sh / 2
    const pTitle = liveLabel(scene, [LG.sx - LG.sw / 2, pTop + 1.7, 0.3], { size: 0.32, align: 'left' })
    const pVal = liveLabel(scene, [LG.sx - LG.sw / 2, pTop + 0.9, 0.3], { size: 0.32, align: 'left' })
    addLabel(scene, `+${LG.lim}`, [LG.sx - LG.sw / 2 - 0.9, pTop - 0.2, 0.3], GREY, 0.24)
    addLabel(scene, '0', [LG.sx - LG.sw / 2 - 0.9, LG.sy, 0.3], GREY, 0.24)
    addLabel(scene, `−${LG.lim}`, [LG.sx - LG.sw / 2 - 0.9, LG.sy - LG.sh / 2 + 0.2, 0.3], GREY, 0.24)
    addLabel(scene, '0', [LG.sx - LG.sw / 2, LG.sy - LG.sh / 2 - 0.8, 0.3], GREY, 0.26, 'left')
    addLabel(scene, `${LO.T} s`, [LG.sx + LG.sw / 2, LG.sy - LG.sh / 2 - 0.8, 0.3], GREY, 0.26, 'right')
    const leaveU = PERSON.leaveT / LO.T
    addLabel(scene, '↑ person leaves', [LG.sx - LG.sw / 2 + leaveU * LG.sw, LG.sy - LG.sh / 2 - 0.8, 0.3], HEAT, 0.26)
    const pNote = liveLabel(scene, [LG.sx, LG.sy - LG.sh / 2 - 1.8, 0.3], { size: 0.3 })
    const st = { key: '', t: 0, i: -1 }
    return {
      scene,
      view: { center: [-3.2, -1.8, 0], radius: 64, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = loOf(p)
        const probeKey = pick(PROBE, p.probe, 'person')
        const key = `${loKey(p)}|${probeKey}`
        const pk = S.probes[probeKey]
        if (key !== st.key) {
          Object.assign(st, { key, t: 0, i: -1 })
          hiLine.set(S.model.lMax === Infinity ? 1e9 : yOf(S.model.lMax))
          loLine.set(S.model.lMax === Infinity ? 1e9 : yOf(S.model.lMin))
          const [cx, cy] = occCentre(S.g, pk)
          probe.set(0, [cx, cy, 0.06], RING)
          probe.show(1)
          sub.set(`final map: ${S.stats.free} free, ${S.stats.occ} occupied, ${S.stats.wrong} cells disagree with the room · odometry off by ${cmWhole(S.finalErr)}, ${sgn((S.finalTh * 180) / Math.PI, 1)}°`, GREY)
          event.set(
            S.driftDeg >= 2 ? 'odometry drift: each lap the walls land rotated, the map smears' : S.ghost ? 'no room to change its mind: the person stays on the map as a ghost' : S.stats.wrong > 40 ? 'noisy map: single hits count too much' : `the person's cells clear ${S.clearAt > 0 ? `${((S.clearAt - S.leave) / LO.hz).toFixed(1)} s` : ''} after they leave`,
            S.driftDeg >= 2 || S.ghost ? HIGH_V : S.stats.wrong > 40 ? HEAT : POWER,
          )
        }
        st.t = (st.t + dt * LO.speed) % (LO.T + 4)
        const i = Math.min(S.frames.length - 1, Math.floor(st.t * LO.hz))
        if (i === st.i) return
        st.i = i
        const f = S.frames[i]
        tiles.draw(S.g, f.lo)
        robot.group.position.set(f.pose.x, f.pose.y, 0)
        robot.group.rotation.z = f.pose.th
        robot.head.rotation.z = f.t * 6
        ghost.group.visible = S.driftDeg > 0
        ghost.group.position.set(f.est.x, f.est.y, 0)
        ghost.group.rotation.z = f.est.th
        const o: V3 = [f.pose.x, f.pose.y, 0.12]
        rays(f.beams.map((b) => [o, [f.pose.x + b.m * Math.cos(f.pose.th + b.a), f.pose.y + b.m * Math.sin(f.pose.th + b.a), 0.12]] as [V3, V3]))
        const px = personX(f.t)
        person.visible = px < 5 - PERSON.w
        person.position.set(px + PERSON.w / 2, PERSON.y + PERSON.w / 2, 0.25)
        const l = f.lo[pk]
        tr.points(S.frames.slice(0, i + 1).filter((_, j) => j % Math.ceil(S.frames.length / 220) === 0 || j === i).map((q) => q.t / LO.T), S.frames.slice(0, i + 1).filter((_, j) => j % Math.ceil(S.frames.length / 220) === 0 || j === i).map((q) => yOf(q.lo[pk])))
        pTitle.set(`log-odds of the probed cell: ${PROBE[probeKey].replace('Probe: ', '')}`, LABEL)
        pVal.set(`l = ${sgn(l)} → p = ${f2(probOf(l))}`, RING)
        pNote.set(Math.abs(l) > LG.lim ? `off the scale: ${f2(l)} (no clamp)` : S.model.lMax !== Infinity ? `dashed: clamp at ±${f2(S.model.lMax)}` : '', Math.abs(l) > LG.lim ? HIGH_V : GREY)
        mapTag.set(`occupancy grid · scan ${i + 1}/${S.frames.length}`, LABEL)
        status.set(`t = ${f.t.toFixed(1)} s of ${LO.T} s · sped up ${LO.speed}× · ${LO.hz} scans/s × ${LO.beams} beams · ${cmWhole(LO.res)} cells`, LABEL)
      },
      readouts: (p) => {
        const S = loOf(p)
        const pk = S.probes[pick(PROBE, p.probe, 'person')]
        const l = S.frames[S.frames.length - 1].lo[pk]
        return [
          { label: 'Probed cell at the end', value: `p = ${f2(probOf(l))}` },
          { label: 'Person cleared after', value: S.clearAt > 0 ? `${((S.clearAt - S.leave) / LO.hz).toFixed(1)} s` : 'never', tone: S.clearAt > 0 && S.clearAt - S.leave < 30 ? 'ok' : S.clearAt > 0 ? 'warn' : 'bad' },
          { label: 'Wrong cells', value: `${S.stats.wrong}`, tone: S.stats.wrong < 20 ? 'ok' : S.stats.wrong < 60 ? 'warn' : 'bad' },
          { label: 'Odometry error', value: `${cmWhole(S.finalErr)}, ${sgn((S.finalTh * 180) / Math.PI, 1)}°`, tone: S.finalErr < 0.05 ? 'ok' : S.finalErr < 0.2 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}
