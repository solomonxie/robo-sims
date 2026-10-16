import * as THREE from 'three/webgpu'
import {
  DEG, DRIVES, FINGER, FingerContact, FingerKind, G, JAWS, JawKind, PickDir, SUCTION_RUN, VAC_PUMP, VAC_SURFACES, VacSurface, angularTouchDeg, fingerPoints, gripWrap, jawForceN, jawHalfGap, jawHoldN, jawTouchDeg,
  linkagePadDropMm, requiredSqueezeN, servoSqueezeNm, squeezesOut, suctionForceN, suctionRun, vacuumSteadyKPa, vacuumTauS, wrapHoldN,
} from '../../core/physics'
import { V3, add, box, cylinder, mat, rod, tube } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, FORCE, GREY, HIGH_V, LABEL, POWER, RING, SIDE_SCOPE, SIDE_VIEW, addLabel, cursorBar, dotPen, liveLabel, memoBy, scopeLabels, shellMat, sideScope, smoothstep, spurGear, statusHeader, stretchArrow, traceRun } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const AIR = B_FIELD
const X0 = SIDE_SCOPE.x - SIDE_SCOPE.w / 2
const nf = (v: number, d = 1) => v.toFixed(d).replace('-', '−')
const PHASES: [number, string][] = [
  [1, 'lowering'],
  [2.4, 'closing'],
  [3.4, 'lifting'],
  [4.6, 'holding up'],
  [5.6, 'setting down'],
  [6.6, 'opening'],
  [7.6, 'rising'],
]
const CYCLE = 7.6
/** Grasp cycle: `down` 0 → 1 reaches the grasp height, `close` 0 → 1 drives the jaws, `lift` 0 → 1 raises. */
const cycleAt = (t: number) => {
  const s = (a: number, b: number) => smoothstep(Math.min(1, Math.max(0, (t - a) / (b - a))))
  return { down: s(0, 1) - s(6.6, 7.6), close: s(1, 2.4) - s(5.6, 6.6), lift: s(2.4, 3.4) - s(4.6, 5.6), name: PHASES.find(([end]) => t < end)?.[1] ?? 'rising' }
}
const lines4 = (scene: THREE.Object3D, y: number) => [0, 1, 2, 3].map((i) => liveLabel(scene, [X0, y - i * 0.7, 0.2], { size: 0.3, align: 'left' }))
const RUBBER = () => mat('#22242a', { rough: 0.95 })
const HOUSING = () => mat('#2c3038', { rough: 0.45, metal: 0.2 })
const ALU = () => mat('#aeb5bf', { rough: 0.35, metal: 0.6 })
const SERVO_BLUE = () => mat('#2f5fd0', { rough: 0.5 })

/** Hobby servo seen from the front, horn at (0, 0). */
function servoBody(parent: THREE.Object3D, at: V3) {
  const g = add(parent, new THREE.Group(), at)
  box(g, [40, 22, 20], SERVO_BLUE(), [0, 11, -12])
  box(g, [54, 3, 20], SERVO_BLUE(), [0, 16, -12])
  cylinder(g, 6, 6, mat('#f2f2f2', { rough: 0.6 }), [0, 0, 0], 'z', 20)
  return g
}

// --- Parallel jaw: servo angle → jaw gap through a rack, a parallelogram or a pivot; squeeze from stall torque; friction holds the weight. ---

const MECH = { rack: 'Rack and pinion', linkage: 'Parallelogram linkage', angular: 'Angular (pivoting)' }
const PJ_OBJ = { cell: '18650 cell 47 g', ball: 'Tennis ball 58 g', can: 'Full can 400 g' }
const PJ_LOOK = { cell: { r: 9, g: 47, color: '#3c9a52', end: '#c9ccd2' }, ball: { r: 33, g: 58, color: '#cfe04a', end: '#cfe04a' }, can: { r: 33, g: 400, color: '#c8283a', end: '#c9ccd2' } }
const PADS = { rubber: 'Rubber pads μ 0.8', plastic: 'Bare plastic μ 0.25' }
const PAD_MU = { rubber: 0.8, plastic: 0.25 }
const SERVOS = { sg90: 'SG90 0.18 N·m', mg996: 'MG996R 1.0 N·m' }
const SERVO_NM = { sg90: 0.18, mg996: DRIVES.servo.stallNm }
const PJ = { k: 0.056, at: [-6, -4.9, 0] as V3, travel: 32, safety: 2, liftA: 2, scope: { y: 0.6, h: 3.2 } }

const pjParams = (p: Params) => {
  const kind = pick(MECH, p.mech, 'rack') as JawKind
  const obj = pick(PJ_OBJ, p.obj, 'ball')
  const pads = pick(PADS, p.pads, 'rubber')
  const servo = pick(SERVOS, p.servo, 'sg90')
  const cmd = n(p, 'cmd')
  const look = PJ_LOOK[obj]
  const R = look.r
  const mu = PAD_MU[pads]
  const touch = jawTouchDeg(kind, R)
  const reach = touch <= 90 && touch >= 0
  const torque = reach ? servoSqueezeNm(cmd, touch, SERVO_NM[servo]) : 0
  const tilt = kind === 'angular' ? angularTouchDeg(R).phiDeg : 0
  const squeeze = torque > 0 ? jawForceN(kind, torque, touch, R) : 0
  const massKg = look.g / 1000
  const hold = jawHoldN(squeeze, mu, tilt)
  const weight = massKg * (G + PJ.liftA)
  const out = kind === 'angular' && squeezesOut(mu, tilt)
  const need = kind === 'angular' ? (out ? Infinity : (PJ.safety * weight) / (2 * (mu * Math.cos(tilt * DEG) + Math.sin(tilt * DEG)))) : requiredSqueezeN(massKg, mu, PJ.safety, PJ.liftA)
  return { kind, obj, pads, servo, cmd, look, R, mu, touch, reach, torque, tilt, squeeze, massKg, hold, weight, out, need, holds: reach && cmd > touch && hold >= weight, stop: Math.min(cmd, reach ? touch : 90) }
}
type PjQ = ReturnType<typeof pjParams>
/** Jaw pad centre height below the rig origin, at servo angle θ. */
const padDepth = (kind: JawKind, deg: number) => (kind === 'rack' ? 75 : kind === 'linkage' ? linkagePadDropMm(deg) + 30 : JAWS.depthMm)

function jawRig(parent: THREE.Object3D, kind: JawKind, padMat: THREE.Material) {
  const g = add(parent, new THREE.Group())
  const steel = mat('#d9b24a', { metal: 0.5, rough: 0.35 })
  const dark = ALU()
  const parts: ((deg: number) => void)[] = []
  if (kind === 'rack') {
    box(g, [150, 76, 26], shellMat('#5a6070', 0.35), [0, 0, -14])
    const pin = add(g, new THREE.Group(), [0, 0, 4])
    spurGear(pin, 20, 2.5, 8, mat('#e3e6ea', { rough: 0.4, metal: 0.5 }))
    servoBody(g, [0, 0, -2]).position.y = 42
    rod(g, [0, 0, -2], [0, 42, -2], 3, steel)
    const racks = [1, -1].map((s) => {
      const side = s > 0 ? -1 : 1
      const r = add(g, new THREE.Group())
      box(r, [76, 8, 8], steel, [-side * 38, s * 29, 4])
      for (let i = 0; i < 10; i++) box(r, [3.4, 4, 8], steel, [-side * 38 - 34 + i * 7.85, s * 24.5, 4])
      const top = s * 29
      box(r, [10, top + 55, 12], dark, [side * 2, (top - 55) / 2, 6])
      box(r, [6, 40, 22], padMat, [0, -75, 6])
      return { r, side }
    })
    parts.push((deg) => {
      const h = jawHalfGap('rack', deg)
      pin.rotation.z = -deg * DEG
      racks.forEach(({ r, side }) => (r.position.x = side * (h + 3)))
    })
  } else if (kind === 'linkage') {
    const piv = JAWS.linkPivotMm + 4
    box(g, [70, 40, 22], dark, [0, 18, -14])
    servoBody(g, [0, 44, 0])
    const gears = [1, -1].map((s) => {
      const gr = add(g, new THREE.Group(), [s * piv, 0, 6])
      spurGear(gr, 12, 1.5, 5, mat('#e3e6ea', { rough: 0.4, metal: 0.5 }))
      return gr
    })
    const side = [1, -1].map((s) => {
      const cranks = [0, -14].map(() => add(g, new THREE.Group()))
      cranks.forEach((c) => box(c, [JAWS.crankMm, 6, 4], steel, [JAWS.crankMm / 2, 0, 10]))
      const carrier = add(g, new THREE.Group())
      box(carrier, [8, 46, 12], dark, [0, -16, 4])
      box(carrier, [6, 40, 22], padMat, [-s * 1, -30, 4])
      return { s, cranks, carrier }
    })
    parts.push((deg) => {
      const a = (deg + JAWS.crankStartDeg) * DEG
      gears.forEach((gr, i) => (gr.rotation.z = (i === 0 ? 1 : -1) * -a))
      side.forEach(({ s, cranks, carrier }) => {
        cranks.forEach((c, i) => {
          c.position.set(s * piv, -14 * i, 0)
          c.rotation.z = s > 0 ? -a : Math.PI + a
        })
        carrier.position.set(s * (piv + JAWS.crankMm * Math.cos(a)), -JAWS.crankMm * Math.sin(a), 0)
      })
    })
  } else {
    const p = JAWS.angPivotMm
    box(g, [64, 30, 22], dark, [0, 14, -14])
    servoBody(g, [0, 34, 0])
    const fingers = [1, -1].map((s) => {
      const f = add(g, new THREE.Group(), [s * p, 0, 0])
      const gr = spurGear(f, 14, 2, 5, mat('#e3e6ea', { rough: 0.4, metal: 0.5 }))
      gr.position.z = 8
      box(f, [10, JAWS.fingerMm, 10], dark, [s * 5, -JAWS.fingerMm / 2, 2])
      box(f, [3, JAWS.fingerMm * 0.55, 20], padMat, [s * 1.5, -JAWS.fingerMm * 0.62, 2])
      return { f, s }
    })
    parts.push((deg) => {
      const phi = (deg + JAWS.angStartDeg) * DEG
      fingers.forEach(({ f, s }) => (f.rotation.z = -s * phi))
    })
  }
  return { group: g, set: (deg: number) => parts.forEach((f) => f(deg)) }
}

function rollObject(parent: THREE.Object3D, look: (typeof PJ_LOOK)[keyof typeof PJ_LOOK]) {
  const g = add(parent, new THREE.Group())
  const m = mat(look.color, { rough: 0.6 }, true)
  if (look.r > 20 && look.color === '#cfe04a') {
    add(g, new THREE.Mesh(new THREE.SphereGeometry(look.r, 32, 20), m)).castShadow = true
  } else {
    cylinder(g, look.r, 46, m, [0, 0, 0], 'z', 32)
    cylinder(g, look.r * 0.92, 50, mat(look.end, { metal: 0.5, rough: 0.35 }), [0, 0, 0], 'z', 32)
  }
  return { group: g, mat: m }
}

export const grippersParallelJaw: Lesson = {
  id: 'grippers-parallel-jaw',
  title: 'Parallel jaw',
  tagline: 'Two pads, one servo, friction does the lifting',
  formula: (p) => {
    const q = pjParams(p)
    const gap = q.kind === 'rack' ? 'h = h0 − r·θ' : q.kind === 'linkage' ? 'h = p + L·cos α' : 'tip h = p − L·sin φ'
    const force = q.kind === 'rack' ? 'F = τ/2r' : q.kind === 'linkage' ? 'F = τ/(2L·sin α)' : 'F = τ/2d'
    return `${gap} · ${force} = ${nf(q.squeeze)} N per jaw · hold = 2F(μ·cos φ + sin φ) = ${nf(q.hold)} N vs m(g + a) = ${nf(q.weight, 2)} N · safe at F ≥ ${PJ.safety}·m(g + a)/2μ`
  },
  legend: [
    { color: FORCE, label: 'Squeeze: normal force per jaw', shape: 'dot' },
    { color: POWER, label: 'Friction holding it up', shape: 'dot' },
    { color: HIGH_V, label: 'Weight + lift: m(g + a)', shape: 'dot' },
    { color: RING, label: 'Servo angle where the jaws touch', shape: 'dot' },
  ],
  points: [
    'A parallel gripper turns one servo into two jaws that close symmetrically. The cheapest way is a pinion between two racks: each jaw moves r·θ, so the gap is linear in the servo angle and the squeeze is F = τ/2r (see Gears & gearing).',
    'A parallelogram linkage keeps the pads parallel too, but they ride an arc: the gap goes as cos α and the pads drop as they close. Its force F = τ/(2L·sin α) rises near the open end, where the links act like a toggle. An angular gripper just pivots its fingers: simple, but the pads tilt.',
    'A position servo told to close further than the object allows pushes past contact and stalls: squeeze = stall torque once the error passes its band (see Servo motors). Command it short of the touch angle and the jaws never meet the part.',
    'Friction does the lifting: 2μF must beat m(g + a). Design for a safety factor of 2: F ≥ 2·m(g + a)/2μ. Rubber pads (μ ≈ 0.8) need three times less squeeze than bare plastic (μ ≈ 0.25), which is why real fingertips are rubber.',
    'Tilted pads change the sum. Angular fingers that touch a big object while still opened out push it down and out: past φ = −atan μ it squirts free at any force. On small objects they lean in and cradle it.',
  ],
  controls: [
    { kind: 'choice', key: 'mech', options: opts(MECH), initial: 'rack' },
    { kind: 'choice', key: 'obj', options: opts(PJ_OBJ), initial: 'ball' },
    { kind: 'choice', key: 'pads', options: opts(PADS), initial: 'rubber' },
    { kind: 'choice', key: 'servo', options: opts(SERVOS), initial: 'sg90' },
    { kind: 'slider', key: 'cmd', label: 'Servo command', min: 0, max: 90, step: 1, initial: 90, format: (v) => `${v}° (90 = shut)` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const world = add(scene, new THREE.Group(), PJ.at)
    world.scale.setScalar(PJ.k)
    const holder = add(world, new THREE.Group())
    const arrows = { sq: [0, 1].map(() => stretchArrow(world, FORCE, 1.6)), fr: [0, 1].map(() => stretchArrow(world, POWER, 1.6)), w: stretchArrow(world, HIGH_V, 1.8) }
    const { y: sy, h: sh } = PJ.scope
    const plot = sideScope(scene, sy, sh, { divs: [6, 5], zeroAt: 0 })
    const curve = plot.trace(GREY, { samples: 91, radius: 0.07 })
    const touchBar = cursorBar(plot, RING, 0.08)
    scopeLabels(scene, sy, sh, null, 'jaw half-gap vs servo angle (0 … 50 mm)', '')
    addLabel(scene, '0°', [X0, sy - sh / 2 - 0.9, 0.3], GREY, 0.26, 'left')
    addLabel(scene, '90°', [X0 + SIDE_SCOPE.w, sy - sh / 2 - 0.9, 0.3], GREY, 0.26, 'right')
    const lines = lines4(scene, sy - sh / 2 - 1.9)
    const padMat = mat('#22242a', { rough: 0.95 }, true)
    let rig: ReturnType<typeof jawRig> | null = null
    let ob: ReturnType<typeof rollObject> | null = null
    const st = { key: '', t: 0 }

    const rebuild = (q: PjQ) => {
      holder.clear()
      rig = jawRig(holder, q.kind, padMat)
      ob = rollObject(holder, q.look)
      box(holder, [160, 8, 70], mat('#3a3d45', { rough: 0.7 }), [0, -q.R - 44, 0])
      cylinder(holder, Math.min(6, q.R * 0.45), 40, HOUSING(), [0, -q.R - 20, 0], 'y', 16)
      padMat.color.set(q.pads === 'rubber' ? '#22242a' : '#d9dde3')
      const y = (h: number) => (Math.max(0, Math.min(50, h)) / 50) * sh - sh / 2
      curve.draw((u) => y(jawHalfGap(q.kind, u * 90)), null)
      touchBar(q.reach ? q.touch / 90 : null)
    }

    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = pjParams(p)
        const key = `${q.kind}|${q.obj}|${q.pads}|${q.servo}|${q.cmd}`
        if (key !== st.key) {
          if (!st.key || key.split('|').slice(0, 3).join() !== st.key.split('|').slice(0, 3).join()) rebuild(q)
          Object.assign(st, { key, t: 0 })
        }
        st.t = (st.t + dt) % CYCLE
        const c = cycleAt(st.t)
        const deg = q.stop * c.close
        const touching = q.reach && c.close > 0.98 && q.cmd > q.touch && (q.holds || c.lift < 0.05)
        const lifted = q.holds ? c.lift : 0
        rig!.set(deg)
        rig!.group.position.y = padDepth(q.kind, q.reach ? q.touch : 90) + PJ.travel * (1 - c.down) + PJ.travel * c.lift
        ob!.group.position.y = PJ.travel * lifted
        ob!.mat.emissive.set(!q.holds && c.lift > 0.05 ? '#3a0000' : '#000000')

        const sq = touching ? q.squeeze : 0
        const scale = 30 / Math.max(q.weight, q.squeeze, q.hold / 2)
        const cy = ob!.group.position.y
        ;[1, -1].forEach((s, i) => {
          arrows.sq[i]([s * (q.R + 6 + (sq ? 14 + sq * scale : 0)), cy, 40], [s * (q.R + 6), cy, 40])
          const fr = touching ? Math.min(q.hold, q.weight) / 2 : 0
          arrows.fr[i]([s * (q.R + 2), cy - 7 - (fr * scale) / 2, 42], [s * (q.R + 2), cy + 7 + (fr * scale) / 2, 42], q.holds ? POWER : HIGH_V)
          if (!fr) arrows.fr[i]([0, 0, 0], [0, 0, 0])
        })
        arrows.w([0, cy, 44], [0, cy - 14 - q.weight * scale, 44])

        const y = (h: number) => (Math.max(0, Math.min(50, h)) / 50) * sh - sh / 2
        curve.draw((u) => y(jawHalfGap(q.kind, u * 90)), deg / 90)
        const safe = q.squeeze >= q.need
        lines[0].set(q.reach ? `touches at ${nf(q.touch, 0)}° (half-gap ${q.R} mm)${q.kind === 'angular' ? `, pads tilted ${nf(q.tilt, 0)}°` : ''}` : 'too big: the jaws cannot open that wide', q.reach ? RING : HIGH_V)
        lines[1].set(q.cmd <= q.touch ? `command ${q.cmd}° stops short of contact: no squeeze` : `servo ${nf(q.torque, 2)} N·m → ${nf(q.squeeze)} N per jaw`, q.cmd <= q.touch ? HIGH_V : FORCE)
        lines[2].set(q.out ? `pads tilt past −atan μ = ${nf(-Math.atan(q.mu) / DEG, 0)}°: squeezed out` : `hold ${nf(q.hold)} N vs m(g + a) ${nf(q.weight, 2)} N`, q.holds ? POWER : HIGH_V)
        lines[3].set(q.out ? 'no squeeze is enough at this tilt' : `safe squeeze (×${PJ.safety}) ≥ ${nf(q.need)} N per jaw`, q.out ? HIGH_V : safe ? GREY : HIGH_V)
        status.set(`${MECH[q.kind]}: ${c.name}`, LABEL)
        sub.set(`${PJ_OBJ[q.obj]} · ${PADS[q.pads]} · ${SERVOS[q.servo]} · real time`, GREY)
        const ev = c.lift < 0.05 ? (touching ? (q.holds ? 'gripped' : 'touching, not enough grip') : '') : q.holds ? (safe ? 'held, with margin' : 'held, but under the ×2 safety factor') : q.cmd <= q.touch ? 'jaws never closed on it' : q.out ? 'squeezed out of tilted jaws' : 'slips: friction < weight'
        event.set(ev, q.holds ? (safe ? POWER : HIGH_V) : ev ? HIGH_V : LABEL)
      },
      readouts: (p) => {
        const q = pjParams(p)
        return [
          { label: 'Touch angle', value: q.reach ? `${nf(q.touch, 0)}°` : 'too wide', tone: q.reach && q.cmd > q.touch ? 'ok' : 'bad' },
          { label: 'Squeeze per jaw', value: `${nf(q.squeeze)} N` },
          { label: 'Hold vs m(g + a)', value: `${nf(q.hold)} N vs ${nf(q.weight, 2)} N`, tone: q.holds ? 'ok' : 'bad' },
          { label: 'Safe squeeze (×2)', value: q.out ? 'squeezed out' : `${nf(q.need)} N`, tone: q.squeeze >= q.need ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Suction: F = ΔP·A, the pump curve against the leak, and the lift that asks for more. ---

const SURF = { glass: 'Glass pane', cardboard: 'Cardboard box', textured: 'Textured plastic' }
const DIRS = { top: 'Pick from the top', side: 'Pick from the side' }
const SC = { k: 0.05, at: [-6, -4.2, 0] as V3, part: [120, 70, 90] as V3, scope: { y: 0.4, h: 3.4 }, rest: 1 }
const scParams = (p: Params) => {
  const surface = pick(SURF, p.surf, 'cardboard') as VacSurface
  const dir = pick(DIRS, p.dir, 'top') as PickDir
  return { surface, dir, diaMm: n(p, 'dia'), massKg: n(p, 'mass') / 1000 }
}
type ScQ = ReturnType<typeof scParams>
const scRun = memoBy((q: ScQ) => `${q.surface}|${q.dir}|${q.diaMm}|${q.massKg}`, (q: ScQ) => suctionRun(q))

function suctionCup(parent: THREE.Object3D, dia: number) {
  const g = add(parent, new THREE.Group())
  const rubber = mat('#3b3f48', { rough: 0.9 })
  const r = dia / 2
  const lip = new THREE.CylinderGeometry(r * 0.45, r, Math.max(4, r * 0.35), 32, 1, true)
  add(g, new THREE.Mesh(lip, rubber), [0, Math.max(4, r * 0.35) / 2, 0])
  for (let i = 0; i < 2; i++) {
    const t = add(g, new THREE.Mesh(new THREE.TorusGeometry(r * 0.42, Math.max(1.6, r * 0.12), 10, 28), rubber), [0, Math.max(4, r * 0.35) + 3 + i * 5, 0])
    t.rotation.x = Math.PI / 2
  }
  cylinder(g, 4, 20, ALU(), [0, Math.max(4, r * 0.35) + 18, 0], 'y', 16)
  return g
}

export const grippersSuction: Lesson = {
  id: 'grippers-suction',
  title: 'Suction',
  tagline: 'Air pressure does the holding',
  formula: (p) => {
    const q = scParams(p)
    const leak = VAC_SURFACES[q.surface]
    const vss = vacuumSteadyKPa(leak)
    return `F = ΔP·A = ${nf(vss, 0)} kPa × ${nf((Math.PI * q.diaMm ** 2) / 4, 0)} mm² = ${nf(suctionForceN(vss, q.diaMm))} N · ΔP = ΔPmax/(1 + C·ΔPmax/Qmax), τ = ${nf(vacuumTauS(leak), 2)} s · need m(g + a)${q.dir === 'side' ? '/μ' : ''}`
  },
  legend: [
    { color: AIR, label: 'Cup force ΔP·A', shape: 'dot' },
    { color: HIGH_V, label: 'Needed: m(g + a), side pick ÷ μ', shape: 'dot' },
    { color: RING, label: 'Leak air through the surface', shape: 'dot' },
    { color: POWER, label: 'Held', shape: 'dot' },
  ],
  points: [
    'A suction cup does not pull: the air outside pushes. The pump lowers the pressure inside by ΔP, so the cup is pressed on with F = ΔP·A. At −60 kPa a 30 mm cup holds about 42 N, double the diameter and the force goes up four times.',
    'A small diaphragm pump reaches about −65 kPa when sealed. Porous cardboard or a textured face leaks air in, and the vacuum settles where the pump curve meets the leak: ΔP = ΔPmax/(1 + C·ΔPmax/Qmax). Leaky parts need a bigger pump, a bigger cup or a foam ring.',
    'The vacuum takes time to build: τ = V/(Patm·(Qmax/ΔPmax + C)). Lift too early and the part stays on the table. Real cells wait for a vacuum switch to report "part held" before moving.',
    'Moving the part asks for more than its weight: the cup must also supply m·a while the arm accelerates up. Watch the red need curve bump at lift-off; a part that only just hangs on drops right there.',
    'From the side, the cup holds by friction only: it needs m(g + a)/μ, about twice the force with μ ≈ 0.5. Pick from the top whenever you can.',
  ],
  controls: [
    { kind: 'choice', key: 'surf', options: opts(SURF), initial: 'cardboard' },
    { kind: 'choice', key: 'dir', options: opts(DIRS), initial: 'top' },
    { kind: 'slider', key: 'dia', label: 'Cup diameter', min: 10, max: 50, step: 2, initial: 30, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'mass', label: 'Part mass', min: 100, max: 5000, step: 100, initial: 1500, format: (v) => `${(v / 1000).toFixed(1)} kg` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const world = add(scene, new THREE.Group(), SC.at)
    world.scale.setScalar(SC.k)
    box(world, [260, 10, 140], mat('#3a3d45', { rough: 0.7 }), [0, -5, 0])
    const holder = add(world, new THREE.Group())
    const pen = dotPen(world, 120, 1.6)
    const up = stretchArrow(world, AIR, 1.8)
    const down = stretchArrow(world, HIGH_V, 1.8)
    const { y: sy, h: sh } = SC.scope
    const plot = sideScope(scene, sy, sh, { divs: [7, 4], zeroAt: 0 })
    const fTr = plot.trace(AIR, { samples: 160, radius: 0.07 })
    const nTr = plot.trace(HIGH_V, { samples: 160, radius: 0.06 })
    const now = cursorBar(plot, GREY, 0.05)
    const top = liveLabel(scene, [X0, sy + sh / 2 + 1.1, 0.3], { size: 0.3, align: 'left' })
    scopeLabels(scene, sy, sh, SUCTION_RUN.seconds, '', '')
    const lines = lines4(scene, sy - sh / 2 - 1.9)
    const pump = add(world, new THREE.Group(), [-150, 0, 0])
    box(pump, [60, 44, 50], HOUSING(), [0, 22, 0])
    cylinder(pump, 16, 40, mat('#3b6fb0', { rough: 0.5 }), [0, 60, 0], 'z', 24)
    addLabel(pump, 'pump', [0, 22, 26], GREY, 8)
    const gauge = liveLabel(world, [-150, 110, 20], { size: 9, color: AIR })
    const HOSE = mat('#7fb2d9', { rough: 0.5 })
    let hose: THREE.Mesh | null = null
    let partG = new THREE.Group()
    let cupG = new THREE.Group()
    const st = { key: '', t: 0, hoseAt: NaN }

    const rebuild = (q: ScQ) => {
      holder.clear()
      hose?.geometry.dispose()
      hose = null
      st.hoseAt = NaN
      const [w, h, d] = SC.part
      partG = add(holder, new THREE.Group())
      const look = q.surface === 'glass' ? shellMat('#9fd6ff', 0.45, 0.05) : mat(q.surface === 'cardboard' ? '#b48a5a' : '#4a4e58', { rough: q.surface === 'cardboard' ? 0.95 : 0.6 })
      box(partG, [w, h, d], look, [0, h / 2, 0])
      if (q.surface === 'cardboard') box(partG, [w + 0.4, 6, d * 0.3], mat('#c9b48a', { rough: 0.5 }), [0, h - 2.6, 0])
      if (q.surface === 'textured') for (let i = 0; i < 9; i++) for (const yy of [h + 0.8]) box(partG, [6, 2, d * 0.9], mat('#3d414a', { rough: 0.8 }), [-w / 2 + 8 + i * 13, yy, 0])
      cupG = add(holder, new THREE.Group())
      const cup = suctionCup(cupG, q.diaMm)
      if (q.dir === 'side') {
        cup.rotation.z = Math.PI / 2
        cup.position.set(0, 0, 0)
      }
      rod(cupG, q.dir === 'top' ? [0, 40, 0] : [40, 0, 0], q.dir === 'top' ? [0, 120, 0] : [70, 0, 0], 5, ALU())
      if (q.dir === 'side') rod(cupG, [70, 0, 0], [70, 90, 0], 6, ALU())
    }

    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = scParams(p)
        const key = `${q.surface}|${q.dir}|${q.diaMm}`
        if (key !== st.key) {
          rebuild(q)
          st.key = key
        }
        const run = scRun(q)
        st.t = (st.t + dt) % (SUCTION_RUN.seconds + SC.rest)
        const t = Math.min(st.t, SUCTION_RUN.seconds)
        const f = run.frames[Math.min(run.frames.length - 1, Math.round(t / SUCTION_RUN.dt))]
        const [w, h] = SC.part
        const cupAt: V3 = q.dir === 'top' ? [0, h + f.z, 0] : [w / 2, h / 2 + f.z, 0]
        cupG.position.set(...cupAt)
        partG.position.y = f.partZ
        if (cupAt[1] !== st.hoseAt) {
          st.hoseAt = cupAt[1]
          hose?.removeFromParent()
          hose?.geometry.dispose()
          const stem: V3 = q.dir === 'top' ? [cupAt[0], cupAt[1] + 60, 0] : [cupAt[0] + 40, cupAt[1] + 8, 0]
          hose = tube(holder, [stem, [stem[0] - 30, stem[1] + 40, 15], [-110, 120, 15], [-150, 80, 15]], 2.2, HOSE, 30)
        }
        const fmax = Math.max(...run.frames.map((x) => Math.max(x.force, x.need)), 1) * 1.15
        const ys = (v: number) => (v / fmax) * sh - sh / 2
        traceRun(fTr, run.frames, SUCTION_RUN.dt, SUCTION_RUN.seconds, t, (x) => ys(x.force))
        traceRun(nTr, run.frames, SUCTION_RUN.dt, SUCTION_RUN.seconds, t, (x) => ys(x.need))
        now(t / SUCTION_RUN.seconds)
        top.set(`cup force vs need, 0 … ${nf(fmax, 0)} N`, LABEL)
        const k = 70 / fmax
        const base: V3 = q.dir === 'top' ? [w / 2 + 30, f.partZ + h / 2, 60] : [-w / 2 - 30, f.partZ + h / 2, 60]
        up(base, [base[0], base[1] + f.force * k, 60])
        down([base[0] + 10, base[1], 60], [base[0] + 10, base[1] - f.need * k, 60])
        pen.begin()
        const leak = VAC_SURFACES[q.surface]
        if (leak > 0 && f.held) {
          const m = Math.round(4 + leak * 6)
          for (let i = 0; i < m; i++) {
            const a = (i / m) * 2 * Math.PI
            const u = (st.t * 1.6 + i * 0.37) % 1
            const r = (q.diaMm / 2) * (1.6 - u * 0.6)
            pen.dot(q.dir === 'top' ? [cupAt[0] + r * Math.cos(a), cupAt[1] + 1, r * Math.sin(a)] : [cupAt[0] + 1, cupAt[1] + r * Math.cos(a), r * Math.sin(a)], RING, 1)
          }
        }
        pen.end()
        gauge.set(`−${nf(f.vac, 0)} kPa`, AIR)
        const vss = vacuumSteadyKPa(leak)
        lines[0].set(`vacuum −${nf(f.vac, 0)} kPa (settles at −${nf(vss, 0)}, τ ${nf(vacuumTauS(leak), 2)} s)`, AIR)
        lines[1].set(`F = ΔP·A = ${nf(f.force)} N, max ${nf(suctionForceN(vss, q.diaMm))} N`, AIR)
        lines[2].set(`need ${nf(f.need)} N = m(g + a)${q.dir === 'side' ? `/μ (μ ${VAC_PUMP.muCup})` : ''}`, HIGH_V)
        lines[3].set(Number.isNaN(run.dropT) ? 'held for the whole move' : run.dropZ < 1 ? 'never lifted: not enough force at lift-off' : `dropped at ${nf(run.dropT, 2)} s, ${nf(run.dropZ, 0)} mm up`, Number.isNaN(run.dropT) ? POWER : HIGH_V)
        const ph = t < SUCTION_RUN.liftS ? 'pump on, vacuum building' : t < SUCTION_RUN.liftS + SUCTION_RUN.moveS ? 'lifting' : 'holding up'
        status.set(`${DIRS[q.dir]}: ${ph}`, LABEL)
        sub.set(`${SURF[q.surface]} · Ø${q.diaMm} mm cup · ${nf(q.massKg, 1)} kg · t = ${nf(t, 1)} / ${SUCTION_RUN.seconds} s, real time`, GREY)
        event.set(f.held ? (t >= SUCTION_RUN.liftS ? `held: ${nf(f.force)} N ≥ ${nf(f.need)} N` : '') : 'let go: cup force fell below the need', f.held ? POWER : HIGH_V)
      },
      readouts: (p) => {
        const q = scParams(p)
        const run = scRun(q)
        const vss = vacuumSteadyKPa(VAC_SURFACES[q.surface])
        const peak = Math.max(...run.frames.map((x) => x.need))
        return [
          { label: 'Vacuum', value: `−${nf(vss, 0)} kPa`, tone: vss < 30 ? 'warn' : 'ok' },
          { label: 'Cup force', value: `${nf(suctionForceN(vss, q.diaMm))} N` },
          { label: 'Peak need', value: `${nf(peak)} N` },
          { label: 'Result', value: Number.isNaN(run.dropT) ? 'held' : 'dropped', tone: Number.isNaN(run.dropT) ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- Compliance: one tendon, two spring-loaded phalanges per finger; the finger wraps and adapts, the rigid claw shoves and pinches. ---

const FKIND = { underactuated: 'Underactuated (tendon + springs)', rigid: 'Rigid claw (position servo)' }
const BALLS = { small: 'Ball Ø20 mm, 20 g', mid: 'Ball Ø36 mm, 80 g', big: 'Ball Ø48 mm, 150 g' }
const BALL = { small: { r: 10, g: 20 }, mid: { r: 18, g: 80 }, big: { r: 24, g: 150 } }
const CP = { k: 0.058, at: [-6, -2.6, 0] as V3, mu: 0.5, levels: 30, maxT: 30, travel: 40, scope: { y: 0.6, h: 3.2 } }
const cpParams = (p: Params) => {
  const kind = pick(FKIND, p.finger, 'underactuated') as FingerKind
  const ball = pick(BALLS, p.ball, 'big')
  return { kind, ball, R: BALL[ball].r, massKg: BALL[ball].g / 1000, offset: n(p, 'offset'), T: n(p, 'tension') }
}
type CpQ = ReturnType<typeof cpParams>
const cpRamp = memoBy((q: CpQ) => `${q.kind}|${q.R}|${q.offset}|${q.T}`, (q: CpQ) => Array.from({ length: CP.levels + 1 }, (_, i) => gripWrap(q.kind, (q.T * i) / CP.levels, q.R, q.offset)))
const cpCurves = memoBy(
  (q: CpQ) => `${q.R}|${q.offset}`,
  (q: CpQ) => (['underactuated', 'rigid'] as const).map((k) => Array.from({ length: 31 }, (_, i) => {
    const g = gripWrap(k, (CP.maxT * i) / 30, q.R, q.offset)
    return wrapHoldN([...g.right.contacts, ...g.left.contacts], CP.mu)
  })),
)
const allContacts = (g: ReturnType<typeof gripWrap>) => [...g.right.contacts, ...g.left.contacts]

function fingerRig(parent: THREE.Object3D, s: 1 | -1) {
  const g = add(parent, new THREE.Group())
  const body = mat('#e8b04a', { rough: 0.5 })
  const pad = RUBBER()
  const w = FINGER.halfW * 2
  const l1 = add(g, new THREE.Group())
  box(l1, [w, FINGER.l1, 18], body, [0, -FINGER.l1 / 2, 0])
  box(l1, [2.5, FINGER.l1 * 0.7, 19], pad, [-s * (FINGER.halfW - 1), -FINGER.l1 * 0.55, 0])
  const l2 = add(g, new THREE.Group())
  box(l2, [w, FINGER.l2, 18], body, [0, -FINGER.l2 / 2, 0])
  box(l2, [2.5, FINGER.l2 * 0.7, 19], pad, [-s * (FINGER.halfW - 1), -FINGER.l2 * 0.5, 0])
  const joints = [0, 1].map(() => cylinder(g, FINGER.halfW + 1.5, 22, HOUSING(), [0, 0, 0], 'z', 20))
  return (t1: number, t2: number, b: number) => {
    const [base, j] = fingerPoints(t1, t2, b)
    const P = (q: number[]) => [s * q[0], q[1], 0] as const
    l1.position.set(...P(base))
    l1.rotation.z = -s * t1
    l2.position.set(...P(j))
    l2.rotation.z = -s * (t1 + t2)
    joints[0].position.set(...P(base))
    joints[1].position.set(...P(j))
  }
}

export const grippersCompliance: Lesson = {
  id: 'grippers-compliance',
  title: 'Compliance',
  tagline: 'Fingers that give way and wrap around',
  formula: (p) => {
    const q = cpParams(p)
    const g = cpRamp(q)[CP.levels]
    return `τ1 = T·r1 − k1θ1, τ2 = T·r2 − k2θ2 − pre · F2 = τ2/d2, F1 = (τ1 − F2·(d2 + L1·cos θ2))/d1 · hold = Σ F(n_y + μ|n_x|) = ${nf(wrapHoldN(allContacts(g), CP.mu), 2)} N vs mg ${nf(q.massKg * G, 2)} N`
  },
  legend: [
    { color: FORCE, label: 'Contact force onto the ball', shape: 'dot' },
    { color: RING, label: 'Tendon (one pull closes both links)', shape: 'dot' },
    { color: HIGH_V, label: 'Ejection, shove or slip', shape: 'dot' },
    { color: POWER, label: 'Held: Σ hold ≥ mg', shape: 'dot' },
  ],
  points: [
    'A rigid claw driven by a position servo closes along a fixed path: each finger touches once, near its tip, and if the part is off centre the first finger to touch shoves it across the table until the other one arrives.',
    'An underactuated finger has two links but one tendon. Springs keep the outer link straight, so the inner link swings first; once it is blocked by the part the tendon\'s pull goes into the outer link, which curls around. The finger takes the shape of the part with no extra motor.',
    'Both fingers hang on the same pull, so each stops where it touches: an off-centre ball is wrapped where it sits, not pushed. That tolerance to position error is what compliance buys: cheap vision, no force sensor.',
    'Contact forces follow from the joint torques (τ = JᵀF, see Jacobian): F2 = τ2/d2, then F1 = (τ1 − F2·(d2 + L1·cos θ2))/d1. If that comes out negative the inner link cannot push and the ball is squeezed out of the wrap: try the big ball at 30 N. Pulley radii and spring preload are tuned to avoid it.',
    'Wrapping puts contacts under the ball, whose push points upward: hold = Σ F(n_y + μ|n_x|). The springs cost some pull, so at equal tension the claw can squeeze harder, but the wrap holds by shape as well as friction.',
  ],
  controls: [
    { kind: 'choice', key: 'finger', options: opts(FKIND), initial: 'underactuated' },
    { kind: 'choice', key: 'ball', options: opts(BALLS), initial: 'big' },
    { kind: 'slider', key: 'offset', label: 'Ball off centre', min: -6, max: 6, step: 1, initial: 0, format: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} mm` },
    { kind: 'slider', key: 'tension', label: 'Tendon / drive pull T', min: 2, max: 30, step: 1, initial: 15, format: (v) => `${v} N` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const world = add(scene, new THREE.Group(), CP.at)
    world.scale.setScalar(CP.k)
    const rigG = add(world, new THREE.Group())
    box(rigG, [FINGER.baseMm * 2 + 24, 16, 26], HOUSING(), [0, 10, -2])
    rod(rigG, [0, 18, -2], [0, 120, -2], 5, ALU())
    const fingers = [fingerRig(rigG, 1), fingerRig(rigG, -1)]
    const pen = dotPen(rigG, 500, 1.1)
    const ballMat = mat('#4aa3df', { rough: 0.5 }, true)
    const ballG = add(world, new THREE.Group())
    const ballMesh = add(ballG, new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), ballMat))
    ballMesh.castShadow = true
    const post = cylinder(world, 4, 1, HOUSING(), [0, 0, 0], 'y', 16)
    const table = box(world, [200, 8, 80], mat('#3a3d45', { rough: 0.7 }), [0, 0, 0])
    const arrows = Array.from({ length: 4 }, () => stretchArrow(world, FORCE, 1.4))
    const { y: sy, h: sh } = CP.scope
    const plot = sideScope(scene, sy, sh, { divs: [6, 4], zeroAt: 0 })
    const tr = [plot.trace(RING, { samples: 31, radius: 0.07 }), plot.trace(GREY, { samples: 31, radius: 0.06 })]
    const wLine = plot.level(HIGH_V)
    const tBar = cursorBar(plot, LABEL, 0.05)
    const top = liveLabel(scene, [X0, sy + sh / 2 + 1.1, 0.3], { size: 0.3, align: 'left' })
    addLabel(scene, 'T 0', [X0, sy - sh / 2 - 0.9, 0.3], GREY, 0.26, 'left')
    addLabel(scene, `${CP.maxT} N`, [X0 + SIDE_SCOPE.w, sy - sh / 2 - 0.9, 0.3], GREY, 0.26, 'right')
    addLabel(scene, 'yellow: underactuated · grey: rigid · red: mg', [X0 + SIDE_SCOPE.w / 2, sy - sh / 2 - 0.9, 0.3], GREY, 0.22)
    const lines = lines4(scene, sy - sh / 2 - 1.9)
    const st = { t: 0, key: '' }

    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = cpParams(p)
        const ramp = cpRamp(q)
        const key = `${q.kind}|${q.R}|${q.offset}|${q.T}`
        if (key !== st.key) Object.assign(st, { key, t: 0 })
        st.t = (st.t + dt) % CYCLE
        const c = cycleAt(st.t)
        const g = ramp[Math.round(c.close * CP.levels)]
        const full = ramp[CP.levels]
        const weight = q.massKg * G
        const hold = wrapHoldN(allContacts(full), CP.mu)
        const holds = hold >= weight && !full.right.ejects && !full.left.ejects
        const depth = FINGER.depthMm
        const tableY = -FINGER.l1 - FINGER.l2 - 12
        table.position.y = tableY - 4
        post.scale.y = tableY + depth + q.R > 0 ? 1 : -(tableY + depth - q.R * 0.8)
        post.position.y = (tableY - depth + q.R * 0.8) / 2
        rigG.position.y = CP.travel * (1 - c.down) + CP.travel * c.lift
        const lifted = holds ? c.lift : 0
        const bx = q.kind === 'rigid' ? q.offset * (1 - Math.min(1, c.close * 1.6)) : q.offset
        ballG.position.set(bx, -depth + CP.travel * lifted, 0)
        ballMesh.scale.setScalar(q.R)
        ballMat.emissive.set(!holds && c.lift > 0.05 ? '#3a0000' : '#000000')
        fingers[0](g.right.t1, g.right.t2, FINGER.baseMm)
        fingers[1](g.left.t1, g.left.t2, FINGER.baseMm)

        pen.begin()
        ;([[g.right, 1], [g.left, -1]] as const).forEach(([s, side]) => {
          const [b, j, tip] = fingerPoints(s.t1, s.t2)
          const inset = (pt: number[], a: number, d: number): V3 => [side * (pt[0] - Math.cos(a) * d), pt[1] + Math.sin(a) * d, 14]
          pen.line(inset(b, s.t1, 3), inset(j, s.t1, 3), 2.5, RING, 0.9)
          pen.line(inset(j, s.t1 + s.t2, 3), inset(tip, s.t1 + s.t2, 3), 2.5, RING, 0.9)
          pen.arc([side * j[0], j[1], 13], FINGER.halfW + 4, 0, 2 * Math.PI * Math.min(1, s.t2 / 1.7 + 0.15), GREY, 0.7)
        })
        pen.end()
        const shown: FingerContact[] = c.close > 0.98 ? [...g.right.contacts, ...g.left.contacts.map((k) => ({ ...k, p: [-k.p[0], k.p[1]] as [number, number], n: [-k.n[0], k.n[1]] as [number, number] }))] : []
        const by = rigG.position.y
        arrows.forEach((a, i) => {
          const k = shown[i]
          if (!k) return a([0, 0, 0], [0, 0, 0])
          const len = 6 + k.forceN * 4
          const tip: V3 = [k.p[0] + k.n[0] * FINGER.halfW, k.p[1] + k.n[1] * FINGER.halfW + by, 30]
          a([tip[0] - k.n[0] * len, tip[1] - k.n[1] * len, 30], tip)
        })

        const hMax = Math.max(weight * 2, ...cpCurves(q).flat()) * 1.1
        const yv = (v: number) => (v / hMax) * sh - sh / 2
        cpCurves(q).forEach((cv, i) => tr[i].points(cv.map((_, j) => j / 30), cv.map(yv)))
        wLine.set(yv(weight))
        tBar(q.T / CP.maxT)
        top.set(`hold vs pull T, 0 … ${nf(hMax, 1)} N`, LABEL)

        const ej = full.right.ejects || full.left.ejects
        const f = (s: typeof full.right) => s.contacts.map((k) => `F${k.link} ${nf(k.forceN, 2)}`).join(', ') || 'none'
        lines[0].set(`${full.contacts} contacts · right ${f(full.right)} N`, FORCE)
        lines[1].set(`θ1 ${nf(full.right.t1 / DEG, 0)}°, θ2 ${nf(full.right.t2 / DEG, 0)}° (left ${nf(full.left.t1 / DEG, 0)}°, ${nf(full.left.t2 / DEG, 0)}°)`, LABEL)
        lines[2].set(ej ? 'inner link would have to pull: ball squeezed out' : full.shoveMm > 0 ? `shoved ${full.shoveMm} mm to the middle first` : q.offset ? 'wrapped where it sits, no shove' : 'centred', ej || full.shoveMm > 0 ? HIGH_V : POWER)
        lines[3].set(`hold ${nf(hold, 2)} N vs mg ${nf(weight, 2)} N`, holds ? POWER : HIGH_V)
        status.set(`${q.kind === 'rigid' ? 'Rigid claw' : 'Underactuated'}: ${c.name}`, LABEL)
        sub.set(`${BALLS[q.ball]} · μ ${CP.mu} · pull ${q.T} N · real time`, GREY)
        event.set(c.lift > 0.05 ? (holds ? 'held' : ej ? 'squeezed out of the wrap' : 'slips out') : c.close > 0.98 ? `${full.contacts} contacts` : '', c.lift > 0.05 ? (holds ? POWER : HIGH_V) : LABEL)
      },
      readouts: (p) => {
        const q = cpParams(p)
        const full = cpRamp(q)[CP.levels]
        const hold = wrapHoldN(allContacts(full), CP.mu)
        const ej = full.right.ejects || full.left.ejects
        return [
          { label: 'Contacts', value: `${full.contacts}` },
          { label: 'Hold vs mg', value: `${nf(hold, 2)} N vs ${nf(q.massKg * G, 2)} N`, tone: hold >= q.massKg * G && !ej ? 'ok' : 'bad' },
          { label: 'Shove', value: `${full.shoveMm} mm`, tone: full.shoveMm ? 'warn' : 'ok' },
          { label: 'Ejection', value: ej ? 'yes' : 'no', tone: ej ? 'bad' : 'ok' },
        ]
      },
    }
  },
}
