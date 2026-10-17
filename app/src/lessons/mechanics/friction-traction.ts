import { DEG, DriveAxles, FLOORS, FRICTION_PAIRS, FloorKind, G, ROLL_SURFACES, RollSurface, SLIP_PEAK, STICK_SLIP, TT_CAR, WHEEL_TYPES, WheelType, fixedStepAt, rollingCost, slipAngle, stickSlipRun, tractionLimit, tractionMu, tractionRun } from '../../core/physics'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, SIDE_SCOPE, addLabel, coilSpring, countBars, flatBox, forceArrow, glowMat, lapseClock, liveLabel, memoBy, plotPanel, scope, scrollTape, sideCar, statusHeader, stretchArrow, traceRun } from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'
import * as THREE from 'three/webgpu'

const VIEW = { center: [-2.2, 1.8, 0] as V3, radius: 52, polar: 1.45, azimuth: 0 }
const newtons = (f: number) => `${f.toFixed(2)} N`
const mps = (v: number) => `${v.toFixed(2)} m/s`
const pctOf = (u: number) => `${Math.round(u * 100)} %`

// --- Static vs kinetic: a robot drags a parts box through a spring; slow drags stick and slip. ---

const SS = { seconds: 8, dt: 0.002, k: 30, at: [-4.5, -2.6, 0] as V3, rest: 0.12, boxM: 0.12, fMax: 10, vMax: 0.6, plot: { y: -1.2, h: 7.6 } }
const PAIRS = Object.fromEntries(Object.entries(FRICTION_PAIRS).map(([k, v]) => [k, v.name])) as Record<keyof typeof FRICTION_PAIRS, string>
const ssParams = (p: Params) => ({ pair: pick(PAIRS, p.pair, 'tile'), speed: n(p, 'speed'), k: n(p, 'spring') })
type SsQ = ReturnType<typeof ssParams>
const ssKey = (q: SsQ) => `${q.pair}|${q.speed}|${q.k}`
const ssRun = memoBy(ssKey, (q: SsQ) => stickSlipRun({ ...FRICTION_PAIRS[q.pair], k: q.k, speed: q.speed, seconds: SS.seconds, dt: SS.dt }))

export const frictionTractionStaticVsKinetic: Lesson = {
  id: 'friction-traction-static-vs-kinetic',
  title: 'Static vs kinetic',
  tagline: 'Stick, slip, stick again',
  formula: (p) => {
    const q = ssParams(p)
    const r = ssRun(q)
    const jump = (2 * (r.staticN - r.kineticN)) / q.k
    return `holds until k·stretch = μs·N = ${newtons(r.staticN)} · slides at μk·N = ${newtons(r.kineticN)} · force drop ≈ 2(μs − μk)·N = ${newtons(2 * (r.staticN - r.kineticN))} · jump ≈ 2(μs − μk)·N / k = ${(jump * 100).toFixed(1)} cm`
  },
  legend: [
    { color: POWER, label: `Spring pull on the box (scope 0…${SS.fMax} N)`, shape: 'arrow-right' },
    { color: HEAT, label: 'Floor friction on the box', shape: 'arrow-left' },
    { color: GREY, label: 'Static limit μs·N (top) and sliding μk·N', shape: 'dot' },
    { color: RING, label: `Box speed (scope bottom 0…${SS.vMax} m/s)`, shape: 'dot' },
  ],
  points: [
    'A robot tows a 1 kg parts box through a spring at a steady speed. While the box is stuck, static friction matches the spring pull exactly, so the spring just stretches and the force climbs in a straight ramp.',
    'At μs·N the box lets go. Sliding friction μk·N is smaller, so the spring now pulls harder than the floor holds: the box lurches, overtakes the slack, and the spring force drops below μk·N before the box stops and sticks again. The force traces a sawtooth: stick-slip. It is the squeal of a brake, the judder of a dragged chair and the jerky start of a slow gantry or a 3D-printer axis.',
    'Drag faster and the box never quite stops between lurches: damping settles it into smooth sliding at μk·N. A stiffer spring makes the jumps shorter and more frequent but does not cure them; a slick pair (PTFE) with μs close to μk barely sticks at all. Machine slides use PTFE or rolling bearings for this reason.',
    'Measuring μs without a force gauge: tilt a ramp under the robot until it starts to slide. At that angle m g sin θ = μs·m g cos θ, so μs = tan θ (readout). The breakaway push itself is in Newton’s laws › Friction; for wheels, which grip by static friction, see Wheel slip.',
  ],
  controls: [
    { kind: 'choice', key: 'pair', options: opts(PAIRS), initial: 'tile' },
    { kind: 'slider', key: 'speed', label: 'Towing speed', min: 0.02, max: 0.3, step: 0.02, initial: 0.06, format: (v) => mps(v) },
    { kind: 'slider', key: 'spring', label: 'Spring stiffness k', min: 50, max: 400, step: 25, initial: 150, format: (v) => `${v} N/m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const clock = lapseClock(SS.seconds, 1, 1)
    const [x0, y0] = SS.at
    const tape = scrollTape(scene, [x0 - 5, y0, 0], 15, 1.5)
    const car = sideCar(scene, SS.at, SS.k)
    const bs = SS.boxM * SS.k
    const crate = box(scene, [bs, bs * 0.8, bs], mat('#c58a3c', { rough: 0.7 }), [0, y0 + bs * 0.4, 0])
    const spring = coilSpring(scene, 0.35, 9)
    const pull = forceArrow(scene, POWER, { size: 0.28 })
    const fric = forceArrow(scene, HEAT, { size: 0.28 })
    const { x, w, h } = { ...SIDE_SCOPE, ...SS.plot }
    const plot = plotPanel(scene, [x, SS.plot.y, 0], w, h, SS.seconds, `spring force 0…${SS.fMax} N`, `box speed 0…${SS.vMax} m/s`, 0, SS.seconds)
    const yF = (f: number) => -h / 2 + 0.3 * h + (Math.max(0, f) / SS.fMax) * 0.68 * h
    const yV = (v: number) => -h / 2 + (Math.max(0, v) / SS.vMax) * 0.26 * h
    const fTr = plot.trace(POWER, { samples: 400, radius: 0.06 })
    const vTr = plot.trace(RING, { samples: 400, radius: 0.05 })
    const sTr = plot.trace(GREY, { samples: 2, radius: 0.03 })
    const kTr = plot.trace(GREY, { samples: 2, radius: 0.03 })
    const tagS = liveLabel(scene, [x - w / 2 + 0.2, 0, 0.3], { size: 0.24, color: GREY, align: 'left' })
    const tagK = liveLabel(scene, [x - w / 2 + 0.2, 0, 0.3], { size: 0.24, color: GREY, align: 'left' })
    return {
      scene,
      view: VIEW,
      frame(dtF, p) {
        const q = ssParams(p)
        const r = ssRun(q)
        const t = clock(dtF, ssKey(q))
        const f = fixedStepAt(r.run, t, SS.dt)
        traceRun(fTr, r.run, SS.dt, SS.seconds, t, (g) => yF(g.spring), 400)
        traceRun(vTr, r.run, SS.dt, SS.seconds, t, (g) => yV(g.vb), 400)
        sTr.points([0, 1], [yF(r.staticN), yF(r.staticN)])
        kTr.points([0, 1], [yF(r.kineticN), yF(r.kineticN)])
        tagS.group.position.y = SS.plot.y + yF(r.staticN) + 0.35
        tagS.set('μs·N')
        tagK.group.position.y = SS.plot.y + yF(r.kineticN) - 0.35
        tagK.set('μk·N')
        tape(f.xr * SS.k)
        car.set(f.xr, 0)
        const tail = x0 - 0.1 * SS.k
        const front = tail - (SS.rest + f.spring / q.k) * SS.k
        const boxX = front - bs / 2
        crate.position.x = boxX
        const sy = y0 + bs * 0.45
        spring([front, sy, 0], [tail, sy, 0])
        const K = 0.35
        pull([front, sy + 1.4, 1.8], [front + f.spring * K, sy + 1.4, 1.8], `${newtons(f.spring)}`, [0, 0.45, 0])
        const fr = f.stuck ? f.spring : r.kineticN + STICK_SLIP.damp * f.vb
        fric([boxX, y0 + 0.2, 2.2], [boxX - fr * K, y0 + 0.2, 2.2], `${newtons(fr)}`, [-0.3, -0.5, 0])
        const { mus, muk } = FRICTION_PAIRS[q.pair]
        head.status.set(`Stick-slip · ${PAIRS[q.pair]} · μs ${mus} · μk ${muk} · k ${q.k} N/m`, LABEL)
        if (f.stuck) head.event.set(`stuck: static friction holds ${newtons(f.spring)} of ${newtons(r.staticN)} max`, HEAT)
        else head.event.set(`slipping: box ${mps(f.vb)} vs robot ${mps(q.speed)}, spring ${newtons(f.spring)}`, POWER)
        head.sub.set(`${t.toFixed(2)} / ${SS.seconds} s · real time · box ${STICK_SLIP.boxKg} kg · ${r.slips} breakaway${r.slips === 1 ? '' : 's'} in ${SS.seconds} s`)
      },
      readouts: (p) => {
        const q = ssParams(p)
        const r = ssRun(q)
        return [
          { label: 'Static limit μs·N', value: newtons(r.staticN) },
          { label: 'Sliding friction μk·N', value: newtons(r.kineticN) },
          { label: 'Motion', value: r.sticking ? `stick-slip, ${newtons(r.swing)} swing` : 'smooth sliding', tone: r.sticking ? 'warn' : 'ok' },
          { label: 'Tilt test: slips at θ = atan μs', value: `${(slipAngle(FRICTION_PAIRS[q.pair].mus) / DEG).toFixed(0)}°` },
        ]
      },
    }
  },
}

// --- Rolling resistance: tyre and floor squash, hysteresis shifts the floor's push ahead of the axle. ---

const RR = { K: 85, squash: 5, hub: [-9, 0, 0] as V3, floorY: -4.6, depth: 1.4, bars: [4.6, 2.6, 0] as V3, bars2: [4.6, -3.3, 0] as V3, barW: 5.4 }
const WHEELS = Object.fromEntries(Object.entries(WHEEL_TYPES).map(([k, v]) => [k, v.name])) as Record<WheelType, string>
const SURFACES = Object.fromEntries(Object.entries(ROLL_SURFACES).map(([k, v]) => [k, v.name])) as Record<RollSurface, string>
const FLOOR_LOOK: Record<RollSurface, string> = { tile: '#c9ced6', wood: '#a8743f', carpet: '#7a4a5a', grass: '#4f7a3a' }
const TYRE_LOOK: Record<WheelType, string> = { tt: '#5c5c66', hard: '#e8e2d0', foam: '#6a7180', big: '#50505a' }
const rrParams = (p: Params) => ({ wheel: pick(WHEELS, p.wheel, 'tt'), surface: pick(SURFACES, p.surface, 'carpet'), v: n(p, 'speed'), m: TT_CAR.massKg + n(p, 'load'), load: n(p, 'load') })
type RrQ = ReturnType<typeof rrParams>
const rrKey = (q: RrQ) => `${q.wheel}|${q.surface}|${q.v}|${q.m}`
const rrCalc = memoBy(rrKey, (q: RrQ) => ({
  c: rollingCost(q.wheel, q.surface, q.m, q.v),
  bySurface: (Object.keys(ROLL_SURFACES) as RollSurface[]).map((s) => rollingCost(q.wheel, s, q.m, q.v)),
  byWheel: (Object.keys(WHEEL_TYPES) as WheelType[]).map((w) => rollingCost(w, q.surface, q.m, q.v)),
}))

/** Tyre ring flattened `flat` units at the bottom; floor slab whose top follows the tyre into a `sink` deep dent. */
function wheelShapes(R: number, flat: number, sink: number, width: number) {
  const tyre = new THREE.Shape()
  const yCut = -(R - flat)
  const steps = 72
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const [px, py] = [R * Math.cos(a), Math.max(yCut, R * Math.sin(a))]
    if (i === 0) tyre.moveTo(px, py)
    else tyre.lineTo(px, py)
  }
  const hole = new THREE.Path()
  hole.absarc(0, 0, R * 0.62, 0, Math.PI * 2, true)
  tyre.holes.push(hole)
  const floor = new THREE.Shape()
  floor.moveTo(-width / 2, -2.6)
  floor.lineTo(-width / 2, 0)
  for (let i = 0; i <= 80; i++) {
    const x = -R + (2 * R * i) / 80
    const outline = -(sink + flat) + (R - Math.sqrt(Math.max(0, R * R - x * x)))
    floor.lineTo(x, Math.min(0, Math.max(-sink, outline)))
  }
  floor.lineTo(width / 2, 0)
  floor.lineTo(width / 2, -2.6)
  const ext = (s: THREE.Shape, d: number) => new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 48 }).translate(0, 0, -d / 2)
  return { tyre: ext(tyre, RR.depth), floor: ext(floor, 3.2) }
}

export const frictionTractionRollingResistance: Lesson = {
  id: 'friction-traction-rolling-resistance',
  title: 'Rolling resistance',
  tagline: 'Squash, rebound, lose a little',
  formula: (p) => {
    const q = rrParams(p)
    const { c } = rrCalc(q)
    return `C_rr = e / r = ${(c.e * 1000).toFixed(2)} mm / ${(WHEEL_TYPES[q.wheel].r * 1000).toFixed(1)} mm = ${c.crr.toFixed(3)} · F = C_rr·m·g = ${newtons(c.total)} · P = F·v = ${c.power.toFixed(2)} W`
  },
  legend: [
    { color: B_FIELD, label: 'Floor push N, shifted ahead of the axle by e', shape: 'dot' },
    { color: HIGH_V, label: 'Load on this wheel (¼ of the robot)', shape: 'dot' },
    { color: HEAT, label: 'Rolling resistance F = N·e / r', shape: 'arrow-left' },
    { color: POWER, label: 'Rolling power F·v on each floor (this wheel)', shape: 'dot' },
  ],
  points: [
    'A wheel is never a perfect circle on a perfect plane: the tyre flattens and the floor dents under the load. Rubber, foam and carpet are springy but not perfectly: squashing them takes more energy than they give back on the rebound (hysteresis). That lost energy is rolling resistance.',
    'Where it shows: the front half of the contact is being squashed and pushes back harder than the rebounding rear half. The floor’s total push N sits a distance e ahead of the axle, and the moment N·e must be paid by a backward force F at the axle: F = N·e/r, or C_rr = e/r. Squash is drawn 5× exaggerated.',
    'Bigger wheels roll easier: the same dent is a gentler slope for them. Hard wheels win on hard floors (almost no squash) and lose on soft ones, where the floor does all the deforming; soft foam tyres waste energy even on tile. Carpet and lawn dominate everything: a TT car pays ten times the rolling force on carpet that it pays on tile.',
    'Power is P = C_rr·m·g·v, so it grows with speed and payload, and energy per metre is just F. On the flat that is where all the wheel power ends up (Energy & work › Efficiency); for sinkage in sand and soil see Tracks & terrain › Traction.',
  ],
  controls: [
    { kind: 'choice', key: 'wheel', options: opts(WHEELS), initial: 'tt' },
    { kind: 'choice', key: 'surface', options: opts(SURFACES), initial: 'carpet' },
    { kind: 'slider', key: 'speed', label: 'Speed v', min: 0.1, max: 1, step: 0.1, initial: 0.5, format: (v) => mps(v) },
    { kind: 'slider', key: 'load', label: 'Payload', min: 0, max: 3, step: 0.5, initial: 1, format: (v) => `${v.toFixed(1)} kg` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const wheel = add(scene, new THREE.Group(), RR.hub)
    const tyreM = mat('#1c1c1f', { rough: 0.8 })
    const tyre = new THREE.Mesh(new THREE.BufferGeometry(), tyreM)
    wheel.add(tyre)
    const spokes = add(wheel, new THREE.Group())
    const rimM = mat('#c8ccd2', { metal: 0.3, rough: 0.4 })
    const floorM = mat('#7a4a5a', { rough: 0.9 })
    const floor = add(scene, new THREE.Mesh(new THREE.BufferGeometry(), floorM), [RR.hub[0], RR.floorY, 0])
    const marks = Array.from({ length: 6 }, () => flatBox(scene, [0.1, 0.04, 2.8], glowMat(GREY, 0.4), [0, RR.floorY + 0.02, 0]))
    const press = Array.from({ length: 9 }, () => stretchArrow(scene, B_FIELD, 0.05))
    const nArrow = forceArrow(scene, B_FIELD, { size: 0.28 })
    const wArrow = forceArrow(scene, HIGH_V, { size: 0.28 })
    const fArrow = forceArrow(scene, HEAT, { size: 0.28 })
    const eTag = liveLabel(scene, [0, 0, 1.2], { size: 0.26, color: B_FIELD })
    addLabel(scene, 'squash × 5', [RR.hub[0] - 6, RR.floorY - 1.2, 1.7], GREY, 0.26, 'left')
    const names = Object.values(SURFACES)
    addLabel(scene, 'rolling power, this wheel, each floor', [RR.bars[0] - 3.6, RR.bars[1] + 1, 0.2], LABEL, 0.3, 'left')
    const bars = countBars(scene, RR.bars, names, RR.barW, { row: 0.72 })
    addLabel(scene, 'C_rr on this floor, each wheel', [RR.bars2[0] - 3.6, RR.bars2[1] + 1, 0.2], LABEL, 0.3, 'left')
    const bars2 = countBars(scene, RR.bars2, Object.values(WHEELS), RR.barW, { row: 0.72, color: HEAT })
    let key = ''
    let spin = 0
    let roll = 0
    let geo = { R: 0, flat: 0, sink: 0, a: 0, e: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = rrParams(p)
        const r = rrCalc(q)
        const w = WHEEL_TYPES[q.wheel]
        if (key !== rrKey(q)) {
          key = rrKey(q)
          const R = w.r * RR.K
          const flat = Math.min(0.3 * R, r.c.tyre * RR.K * RR.squash)
          const sink = Math.min(0.3 * R, r.c.floor * RR.K * RR.squash)
          const s = wheelShapes(R, flat, sink, 16)
          tyre.geometry.dispose()
          tyre.geometry = s.tyre
          floor.geometry.dispose()
          floor.geometry = s.floor
          tyreM.color.set(TYRE_LOOK[q.wheel])
          floorM.color.set(FLOOR_LOOK[q.surface])
          wheel.position.y = RR.floorY - sink - flat + R
          spokes.clear()
          for (let i = 0; i < 3; i++) {
            const b = new THREE.Mesh(new THREE.BoxGeometry(R * 1.24, 0.22, 0.2), rimM)
            b.rotation.z = (i * Math.PI) / 3
            b.position.z = RR.depth / 2 + 0.1
            spokes.add(b)
          }
          const a = Math.sqrt(2 * R * (flat + sink))
          geo = { R, flat, sink, a, e: Math.min(a * 0.9, r.c.e * RR.K * RR.squash) }
        }
        spin += (q.v / w.r) * dt
        roll += q.v * dt * RR.K * 0.25
        spokes.rotation.z = -spin
        const span = 15
        marks.forEach((m, i) => {
          const x = ((((i * span) / marks.length - roll) % span) + span) % span - span / 2
          m.position.x = RR.hub[0] + x
          m.visible = Math.abs(x) > geo.a + 0.2
        })
        const cx = RR.hub[0]
        const yc = RR.floorY - geo.sink
        const skew = Math.min(1, (geo.e / Math.max(geo.a, 1e-6)) * 10)
        press.forEach((draw, i) => {
          const u = -1 + (2 * i) / (press.length - 1)
          const len = Math.max(0, (1 - u * u) * (1 + skew * u)) * 0.6
          const px = cx + u * geo.a * 0.95
          draw([px, yc - 0.05 - len, 1.8], [px, yc - 0.05, 1.8])
        })
        const N = (q.m * G) / 4
        const hubY = wheel.position.y
        nArrow([cx + geo.e, yc - 0.1, 2], [cx + geo.e, hubY - 0.6, 2], `N ${newtons(N)}`, [1.3, -0.6, 0])
        wArrow([cx, hubY + geo.R + 2.2, 2], [cx, hubY + geo.R + 0.3, 2], `${newtons(N)}`, [0.9, 0.6, 0])
        const F = r.c.force
        fArrow([cx, hubY, 2.4], [cx - Math.max(0.2, F * 4), hubY, 2.4], `F ${newtons(F)}`, [-0.6, 0.4, 0])
        eTag.group.position.set(cx + geo.a + 1.6, RR.floorY - 0.9, 1.8)
        eTag.set(`e ${(r.c.e * 1000).toFixed(2)} mm`)
        const sk = Object.keys(ROLL_SURFACES) as RollSurface[]
        const wk = Object.keys(WHEEL_TYPES) as WheelType[]
        bars.set(r.bySurface.map((c) => c.power), r.bySurface.map((c) => `${c.power.toFixed(2)} W`), sk.map((s) => (s === q.surface ? POWER : GREY)))
        bars2.set(r.byWheel.map((c) => c.crr), r.byWheel.map((c) => c.crr.toFixed(3)), wk.map((k) => (k === q.wheel ? HEAT : GREY)))
        head.status.set(`Rolling resistance · ${WHEELS[q.wheel]} on ${SURFACES[q.surface]} · C_rr ${r.c.crr.toFixed(3)}`, LABEL)
        head.sub.set(`side view · ${q.m.toFixed(1)} kg on four wheels · tyre squash ${(r.c.tyre * 1000).toFixed(2)} mm, floor ${(r.c.floor * 1000).toFixed(2)} mm`)
        head.event.set(`${r.c.tyre > r.c.floor ? 'tyre' : 'floor'} does most of the squashing · ${(r.c.perMetre).toFixed(2)} J lost per metre`, HEAT)
      },
      readouts: (p) => {
        const q = rrParams(p)
        const { c } = rrCalc(q)
        return [
          { label: 'C_rr = e / r', value: c.crr.toFixed(3), tone: toneOf(c.crr < 0.03, c.crr < 0.1) },
          { label: 'Rolling force C_rr·m·g', value: newtons(c.total) },
          { label: 'Power at this speed', value: `${c.power.toFixed(2)} W` },
          { label: 'Energy per 100 m', value: `${(c.perMetre * 100).toFixed(0)} J` },
        ]
      },
    }
  },
}

// --- Wheel slip: grip = μ(κ)·N on the driven axle; weight transfer on a slope; wheelspin when torque beats grip. ---

const WS = { seconds: 2.5, dt: 0.0005, slow: 0.25, k: 30, base: [-17.5, -3.6, 0] as V3, len: 14, vMax: 0.8, loadKg: 0.5, curve: { y: 2, h: 3 }, time: { y: -4.2, h: 3 } }
const DRIVES: Record<DriveAxles, string> = { rear: 'Rear-wheel drive', front: 'Front-wheel drive', all: 'Four motors (4WD)' }
const SLIP_FLOORS = Object.fromEntries(Object.entries(FLOORS).map(([k, v]) => [k, `${v.name} μ ${v.mu}`])) as Record<FloorKind, string>
const AXLE = ['rear', 'front'] as const
const AXLE_COLORS = [HEAT, B_FIELD]
const wsParams = (p: Params) => ({ drive: pick(DRIVES, p.drive, 'rear'), floor: pick(SLIP_FLOORS, p.floor, 'wood'), deg: n(p, 'slope'), volts: n(p, 'volts') })
type WsQ = ReturnType<typeof wsParams>
const wsKey = (q: WsQ) => `${q.drive}|${q.floor}|${q.deg}|${q.volts}`
const wsRun = memoBy(wsKey, (q: WsQ) => {
  const mu = FLOORS[q.floor].mu
  const run = tractionRun({ mu, volts: q.volts, theta: q.deg * DEG, drive: q.drive, loadKg: WS.loadKg, seconds: WS.seconds, dt: WS.dt })
  const driven = [q.drive !== 'front', q.drive !== 'rear']
  const peak = Math.max(...run.map((f) => Math.max(...f.kappa.map((k, i) => (driven[i] ? Math.abs(k) : 0)))))
  return { mu, run, driven, peak, lim: tractionLimit(mu, q.deg * DEG, q.drive, WS.loadKg), end: run[run.length - 1] }
})

export const frictionTractionWheelSlip: Lesson = {
  id: 'friction-traction-wheel-slip',
  title: 'Wheel slip',
  tagline: 'Grip is μ times the weight on the driven wheels',
  formula: (p) => {
    const q = wsParams(p)
    const r = wsRun(q)
    return `κ = (ω r − v) / ω r · grip ≤ μ·N_driven = ${r.mu} × ${(r.lim.grip / r.mu).toFixed(2)} N = ${newtons(r.lim.grip)} vs needed m g (sin θ + C_rr cos θ) = ${newtons(r.lim.need)} · N_rear = m g cos θ / 2 + m g sin θ · h / L`
  },
  legend: [
    { color: HEAT, label: 'Rear axle: load N, slip, rim speed', shape: 'dot' },
    { color: B_FIELD, label: 'Front axle: load N, slip, rim speed', shape: 'dot' },
    { color: POWER, label: 'Tyre push (red: past the grip peak)', shape: 'arrow-right' },
    { color: LABEL, label: `Car speed (scope 0…${WS.vMax} m/s)`, shape: 'dot' },
  ],
  points: [
    'A driven tyre pushes the car by static friction at the contact patch, so the most it can give is μ·N, with N the weight on the driven wheels only. Motor torque above μ·N·r does not push harder; it just spins the wheel.',
    'Grip depends on slip ratio κ = (ω r − v) / ω r: how much faster the rim moves than the car. A rolling tyre needs a few per cent of slip to push at all; grip peaks near κ ≈ 15 % and then falls toward sliding friction as the wheel spins up (the curve top right). Once past the peak, more spin means less grip, so a spinning wheel keeps spinning until the torque is backed off: traction control.',
    'On a slope, part of the weight shifts onto the rear axle (m g sin θ · h / L, h = centre-of-mass height, L = wheelbase), and accelerating shifts more. Rear-wheel drive gains grip going uphill; front-wheel drive loses it and spins first. Four motors use all the weight and climb steepest (readout).',
    'Every slipping turn is counted by the encoder but not travelled: the sub line compares the two, and that gap is odometry error (Mobility › Differential drive › Slip, Navigation › Odometry › Error growth). Slew-limit the throttle, keep weight over the driven wheels and pick softer tyres for slick floors.',
  ],
  controls: [
    { kind: 'choice', key: 'drive', options: opts(DRIVES), initial: 'rear' },
    { kind: 'choice', key: 'floor', options: opts(SLIP_FLOORS), initial: 'wood' },
    { kind: 'slider', key: 'slope', label: 'Slope θ', min: 0, max: 30, step: 1, initial: 15, format: (v) => `${v}°` },
    { kind: 'slider', key: 'volts', label: 'Motor voltage (throttle)', min: 2, max: 8, step: 0.5, initial: 4, format: (v) => `${v.toFixed(1)} V` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const clock = lapseClock(WS.seconds, WS.slow, 0.6)
    const ramp = add(scene, new THREE.Group(), WS.base)
    const len = WS.len
    const tape = scrollTape(ramp, [len / 2, 0, 0], len, 1.5)
    const car = sideCar(ramp, [len / 2, 0, 0], WS.k)
    flatBox(scene, [len + 4, 0.3, 3.4], mat('#3a3f4a', { rough: 0.8 }), [WS.base[0] + len / 2, WS.base[1] - 0.35, 0])
    const nArr = AXLE.map((_, i) => forceArrow(scene, AXLE_COLORS[i], { size: 0.26 }))
    const pushArr = AXLE.map(() => forceArrow(scene, POWER, { size: 0.26 }))
    const spinArr = AXLE.map(() => forceArrow(scene, HIGH_V, { size: 0.26 }))
    const { x, w } = SIDE_SCOPE
    const curve = scope(scene, w, WS.curve.h, { divs: [10, 4], zeroAt: 0 })
    curve.group.position.set(x, WS.curve.y, 0)
    const ch = WS.curve.h
    addLabel(scene, 'grip μ(κ) vs slip ratio κ', [x - w / 2, WS.curve.y + ch / 2 + 1.1, 0.3], LABEL, 0.3, 'left')
    addLabel(scene, 'κ 0', [x - w / 2, WS.curve.y - ch / 2 - 0.9, 0.3], GREY, 0.26, 'left')
    addLabel(scene, '100 %', [x + w / 2, WS.curve.y - ch / 2 - 0.9, 0.3], GREY, 0.26, 'right')
    addLabel(scene, `peak ${pctOf(SLIP_PEAK)}`, [x - w / 2 + SLIP_PEAK * w, WS.curve.y + ch / 2 + 0.35, 0.3], GREY, 0.24)
    const muTr = curve.trace(GREY, { samples: 80, radius: 0.05 })
    const dots = AXLE.map((_, i) => curve.trace(AXLE_COLORS[i], { samples: 2, radius: 0.06 }))
    const yMu = (m: number) => -ch / 2 + (Math.max(0, m) / 1) * ch * 0.95
    const th = WS.time.h
    const plot = plotPanel(scene, [x, WS.time.y, 0], w, th, WS.seconds, `car speed and rim speed ωr`, `0…${WS.vMax} m/s`, 0.25, 10)
    const yV = (v: number) => -th / 4 + (v / WS.vMax) * 0.72 * th
    const vTr = plot.trace(LABEL, { samples: 250, radius: 0.06 })
    const rimTr = AXLE.map((_, i) => plot.trace(AXLE_COLORS[i], { samples: 250, radius: 0.045 }))
    let shown = ''
    return {
      scene,
      view: VIEW,
      frame(dtF, p) {
        const q = wsParams(p)
        const r = wsRun(q)
        const t = clock(dtF, wsKey(q))
        const f = fixedStepAt(r.run, t, WS.dt)
        if (shown !== `${q.floor}`) {
          shown = `${q.floor}`
          const us = Array.from({ length: 80 }, (_, i) => i / 79)
          muTr.points(us, us.map((u) => yMu(tractionMu(r.mu, u))))
        }
        AXLE.forEach((_, i) => {
          const kp = Math.max(0, Math.min(1, f.kappa[i]))
          dots[i].group.visible = r.driven[i]
          dots[i].points([kp, kp], [yMu(tractionMu(r.mu, kp)), yMu(tractionMu(r.mu, kp))])
          rimTr[i].group.visible = r.driven[i]
          traceRun(rimTr[i], r.run, WS.dt, WS.seconds, t, (g) => yV(g.rim[i]), 250)
        })
        traceRun(vTr, r.run, WS.dt, WS.seconds, t, (g) => yV(g.v), 250)
        const tr = q.deg * DEG
        ramp.rotation.z = tr
        tape(f.x * WS.k)
        car.set(f.x, WS.loadKg, f.turn)
        const c = Math.cos(tr)
        const s = Math.sin(tr)
        const at = (along: number, up: number, z: number): V3 => [WS.base[0] + along * c - up * s, WS.base[1] + along * s + up * c, z]
        const K = 0.45
        AXLE.forEach((_, i) => {
          const ax = len / 2 + (i === 0 ? -0.065 : 0.065) * WS.k
          const nN = f.load[i]
          const z = i === 0 ? 2.4 : 2.8
          nArr[i](at(ax, -0.1, z), at(ax, -0.1 + nN * K, z), `N ${newtons(nN)}`, [i === 0 ? -1.4 : 1.4, -0.3, 0])
          const pN = f.push[i]
          const over = Math.abs(f.kappa[i]) > SLIP_PEAK * 1.5
          const tip = at(ax + pN * K * 1.4, 0.15, z + 0.4)
          const base = at(ax, 0.15, z + 0.4)
          pushArr[i](base, over ? base : tip, newtons(pN), [0, -0.6, 0])
          spinArr[i](base, over ? tip : base, `spin ${newtons(pN)}`, [0, -0.6, 0])
        })
        head.status.set(`Wheel slip · ${DRIVES[q.drive]} · ${FLOORS[q.floor].name} μ ${r.mu} · ${q.deg}° · ${q.volts.toFixed(1)} V`, LABEL)
        const kd = Math.max(...f.kappa.map((k, i) => (r.driven[i] ? k : 0)))
        if (f.x <= -0.299 && f.v <= 0) head.event.set('slid back to the bottom: grip on the driven wheels < pull down the slope', HIGH_V)
        else if (f.v < -0.01) head.event.set(`sliding back: wheels spin forward at κ ${pctOf(kd)} while the car rolls down`, HIGH_V)
        else if (kd > SLIP_PEAK * 1.5) head.event.set(`wheelspin: torque beats grip, κ ${pctOf(kd)}, past the ${pctOf(SLIP_PEAK)} peak`, HIGH_V)
        else head.event.set(`gripping: κ ${pctOf(kd)}, ${newtons(f.push[0] + f.push[1])} of ${newtons(r.lim.grip)} max · ${mps(f.v)}`, POWER)
        const enc = Math.max(...f.turn.map((d, i) => (r.driven[i] ? d : -Infinity)))
        head.sub.set(`${t.toFixed(2)} / ${WS.seconds} s · slowed ${1 / WS.slow}× · encoder ${(enc * 100).toFixed(0)} cm, car ${(f.x * 100).toFixed(0)} cm`)
      },
      readouts: (p) => {
        const q = wsParams(p)
        const r = wsRun(q)
        return [
          { label: `Axle loads rear / front (${r.driven[0] && r.driven[1] ? 'both' : r.driven[0] ? 'rear' : 'front'} driven)`, value: `${r.lim.rear.toFixed(1)} / ${r.lim.front.toFixed(1)} N` },
          { label: 'Grip μ·N vs pull needed', value: `${newtons(r.lim.grip)} vs ${newtons(r.lim.need)}`, tone: toneOf(r.lim.grip > r.lim.need * 1.3, r.lim.grip > r.lim.need) },
          { label: 'Peak slip ratio', value: pctOf(Math.min(2, r.peak)), tone: toneOf(r.peak < SLIP_PEAK, r.peak < 0.5) },
          { label: 'Steepest climb, this drive', value: `${(r.lim.maxSlope / DEG).toFixed(0)}°` },
        ]
      },
    }
  },
}
