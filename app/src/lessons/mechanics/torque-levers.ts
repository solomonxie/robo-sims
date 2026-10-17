import { ARM_BUILD, ARM_SERVOS, ArmServo, BOOM, DEG, G, LEVER_CLASSES, LeverClass, balanceRadius, boomTorques, holdVerdict, hornSag, leverForces, leverLayout, leverTravel, reachLimit, torqueOf } from '../../core/physics'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, FORCE, GREY, HEAT, HIGH_V, LABEL, POWER, RING, SIDE_SCOPE, addLabel, countBars, dotPen, forceArrow, liveLabel, memoBy, scope, sg90Servo, statusHeader, sumBars } from '../fx'
import { Lesson, Params, Stage, angleSlider, n, opts, pick, toneOf } from '../types'
import * as THREE from 'three/webgpu'

const VIEW = { center: [-2.4, 0, 0] as V3, radius: 52, polar: 1.45, azimuth: 0 }
const nm = (v: number) => `${Math.abs(v).toFixed(3)} N·m`
const newtons = (f: number) => `${f.toFixed(2)} N`
const cm = (m: number) => (Number.isFinite(m) ? `${(m * 100).toFixed(1)} cm` : 'any length')
const grams = (v: number) => `${v} g`
const VERDICT_TONE = { ok: 'ok', thin: 'warn', weak: 'bad' } as const

// --- Moment arm: a force on a servo horn at a distance and an angle; τ = F·r·sin θ against the servo's stall torque. ---

const MA = { pivot: [-13.5, -1.6, 0] as V3, k: 150, fK: 0.6, plot: [SIDE_SCOPE.x + 0.6, -0.2, 0] as V3, w: 10.5, h: 5, tauMax: 0.5, scale: 1.2 }
const SERVOS = Object.fromEntries(Object.entries(ARM_SERVOS).map(([k, d]) => [k, `${d.name} (${d.stallNm.toFixed(2)} N·m stall)`])) as Record<ArmServo, string>
const maParams = (p: Params) => ({ r: n(p, 'r') / 100, deg: n(p, 'angle'), f: n(p, 'force'), servo: pick(SERVOS, p.servo, 'sg90') })
type MaQ = ReturnType<typeof maParams>
const maKey = (q: MaQ) => `${q.r}|${q.deg}|${q.f}|${q.servo}`
const maRun = memoBy(maKey, (q: MaQ) => {
  const d = ARM_SERVOS[q.servo]
  const t = torqueOf(q.f, q.r, q.deg * DEG)
  return { d, t, sag: hornSag(t.tau, d), reach: reachLimit(d.stallNm, q.f, q.deg * DEG), verdict: holdVerdict(Math.abs(t.tau) / d.stallNm) }
})

export const torqueLeversMomentArm: Lesson = {
  id: 'torque-levers-moment-arm',
  title: 'Moment arm',
  tagline: 'Same force, farther out, more twist',
  formula: (p) => {
    const q = maParams(p)
    const { t, d } = maRun(q)
    return `τ = F·r·sin θ = F·d = ${q.f.toFixed(1)} N × ${cm(q.r)} × sin ${q.deg}° = ${q.f.toFixed(1)} N × ${cm(t.d)} = ${nm(t.tau)} · ${d.name} stall ${nm(d.stallNm)}`
  },
  legend: [
    { color: POWER, label: 'Force F at the end of the horn', shape: 'arrow-right' },
    { color: GREY, label: 'F split: along the horn / across it (F sin θ)', shape: 'dot' },
    { color: RING, label: 'Moment arm d: pivot ⟂ line of action', shape: 'dot' },
    { color: FORCE, label: `τ(θ) for this F and r (plot 0…${MA.tauMax} N·m)`, shape: 'dot' },
    { color: HIGH_V, label: 'Servo stall torque', shape: 'dot' },
  ],
  points: [
    'A force turns things about a pivot. How hard it turns is the torque (moment) τ = F·d: the force times the moment arm d, the perpendicular distance from the pivot to the force’s line of action. Units: N·m. Servo datasheets often say kg·cm: 1 kg·cm ≈ 0.098 N·m.',
    'Pull at angle θ to the horn and only the part across it, F sin θ, turns it; the part along it just pulls on the shaft bearing. Same thing seen the other way: d = r sin θ. Push straight along the horn (θ = 0°) and nothing turns however hard you push; at 90° you get the full F·r.',
    'Move the same force out along the horn and the torque grows in proportion. That is why a long arm needs a strong servo, and why the load at the end of a robot arm matters far more than its weight near the shoulder.',
    'A hobby servo pushes back in proportion to how far it is pushed off target, so it sags a little under load and, past its stall torque, gets back-driven (horn slips, red). Servo › Inside a hobby servo shows that loop; Robot arm build › Assemble the arm and Dynamics › Gravity torque size the servos for a whole arm.',
  ],
  controls: [
    { kind: 'slider', key: 'r', label: 'Distance r from the shaft', min: 1, max: 8, step: 0.5, initial: 5, format: (v) => `${v.toFixed(1)} cm` },
    angleSlider('angle', 'Angle θ between horn and force', 0, 180, 90),
    { kind: 'slider', key: 'force', label: 'Force F', min: 0.5, max: 6, step: 0.5, initial: 2.5, format: (v) => newtons(v) },
    { kind: 'choice', key: 'servo', options: opts(SERVOS), initial: 'sg90' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const [px, py] = MA.pivot
    const mount = add(scene, new THREE.Group(), MA.pivot)
    mount.scale.setScalar(MA.scale)
    const horn = sg90Servo(mount, [0.75, 0, -1.75])
    const armMat = mat('#f2f2f2', { rough: 0.45 })
    const bar = box(horn, [0.42, 1, 0.22], armMat, [0, 0, 0.05])
    const eye = cylinder(horn, 0.26, 0.3, mat('#c9ccd3'), [0, 0, 0.1], 'z', 16)
    const name = liveLabel(scene, [px - 1.5, py - 2.8, 0.3], { size: 0.3, color: GREY })
    const tauTag = liveLabel(scene, [px - 0.6, py + 1.4, 1], { size: 0.34, align: 'right' })
    const pen = dotPen(scene, 400, 0.07)
    const force = forceArrow(scene, POWER)
    const perp = forceArrow(scene, GREY, { r: 0.06, size: 0.26 })
    const along = forceArrow(scene, GREY, { r: 0.06, size: 0.26 })
    const dTag = liveLabel(scene, [0, 0, 1], { size: 0.3, color: RING })
    const thTag = liveLabel(scene, [0, 0, 1], { size: 0.32, color: LABEL })
    const [sx, sy] = MA.plot
    const plot = scope(scene, MA.w, MA.h, { divs: [6, 5], zeroAt: 0 })
    plot.group.position.set(...MA.plot)
    addLabel(scene, `torque τ 0…${MA.tauMax} N·m`, [sx - MA.w / 2, sy + MA.h / 2 + 1.1, 0.3], LABEL, 0.3, 'left')
    addLabel(scene, '0°', [sx - MA.w / 2, sy - MA.h / 2 - 1.1, 0.3], GREY, 0.26, 'left')
    addLabel(scene, 'angle θ', [sx, sy - MA.h / 2 - 1.1, 0.3], GREY, 0.26)
    addLabel(scene, '180°', [sx + MA.w / 2, sy - MA.h / 2 - 1.1, 0.3], GREY, 0.26, 'right')
    const curve = plot.trace(FORCE, { samples: 91, radius: 0.07 })
    const stall = plot.trace(HIGH_V, { samples: 2, radius: 0.04 })
    const stallTag = liveLabel(scene, [sx + MA.w / 2 - 0.2, 0, 0.3], { size: 0.26, color: HIGH_V, align: 'right' })
    const yOf = (tau: number) => (Math.abs(tau) / MA.tauMax - 0.5) * MA.h
    let ang = 0
    let wob = 0
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = maParams(p)
        const { d, t, sag, verdict } = maRun(q)
        wob += dt
        const target = sag.slips ? -15 * DEG + 0.04 * Math.sin(wob * 40) : -sag.sagRad * Math.sign(t.tau)
        ang += (target - ang) * Math.min(1, dt * 4)
        horn.rotation.z = -Math.PI / 2 + ang
        const sc = MA.scale * (q.servo === 'mg996r' ? 1.6 : 1)
        mount.scale.setScalar(sc)
        const L = (q.r * MA.k) / sc
        bar.scale.y = L + 0.5
        bar.position.y = L / 2
        eye.position.y = L
        const R = q.r * MA.k
        const tip: V3 = [px + R * Math.cos(ang), py + R * Math.sin(ang), 1.2]
        const th = q.deg * DEG
        const u: V3 = [Math.cos(ang - th), Math.sin(ang - th), 0]
        const F = q.f * MA.fK
        force(tip, [tip[0] + u[0] * F, tip[1] + u[1] * F, 1.2], `F ${newtons(q.f)}`)
        const a: V3 = [Math.cos(ang), Math.sin(ang), 0]
        const nrm: V3 = [Math.sin(ang), -Math.cos(ang), 0]
        along(tip, [tip[0] + a[0] * t.fPar * MA.fK, tip[1] + a[1] * t.fPar * MA.fK, 1.1], '')
        perp(tip, [tip[0] + nrm[0] * t.fPerp * MA.fK, tip[1] + nrm[1] * t.fPerp * MA.fK, 1.1], '')
        pen.begin()
        pen.line([tip[0] - u[0] * 6, tip[1] - u[1] * 6, 0.9], [tip[0] + u[0] * 6, tip[1] + u[1] * 6, 0.9], 0.45, GREY, 0.6)
        const s = (px - tip[0]) * u[0] + (py - tip[1]) * u[1]
        const foot: V3 = [tip[0] + u[0] * s, tip[1] + u[1] * s, 1]
        pen.line([px, py, 1], foot, 0.3, RING, 1.2)
        pen.line([px, py, 1.15], [px + R, py, 1.15], 0.5, GREY, 0.5)
        for (let i = 0; i <= 12; i++) {
          const b = ang - (th * i) / 12
          pen.dot([tip[0] + 1.3 * Math.cos(b), tip[1] + 1.3 * Math.sin(b), 1.2], LABEL, 0.7)
        }
        pen.end()
        dTag.group.position.set((px + foot[0]) / 2 - 0.4 * u[0], (py + foot[1]) / 2 - 0.4 * u[1] + 0.35, 1.3)
        dTag.set(t.d > 0.002 ? `d ${cm(t.d)}` : '', RING)
        const mid = ang - th / 2
        thTag.group.position.set(tip[0] + 2 * Math.cos(mid), tip[1] + 2 * Math.sin(mid), 1.3)
        thTag.set(q.deg > 8 ? 'θ' : '')
        name.set(d.name)
        const tone = sag.slips ? HIGH_V : verdict === 'thin' ? HEAT : POWER
        tauTag.set(`τ ${nm(t.tau)}`, tone)
        curve.draw((v) => yOf(q.f * q.r * Math.sin(v * Math.PI)), q.deg / 180)
        const over = d.stallNm > MA.tauMax
        stall.group.visible = !over
        stall.points([0, 1], [yOf(d.stallNm), yOf(d.stallNm)])
        stallTag.group.position.y = sy + (over ? MA.h / 2 - 0.4 : yOf(d.stallNm) + 0.4)
        stallTag.set(over ? `stall ${nm(d.stallNm)} (off the top)` : `${d.name} stall ${nm(d.stallNm)}`)
        head.status.set(`τ = F·d = ${nm(t.tau)}`, LABEL)
        head.sub.set(`front view of a ${d.name} with a long horn · F applied ${cm(q.r)} from the shaft at ${q.deg}°`)
        head.event.set(
          sag.slips
            ? `${Math.round(sag.share * 100)} % of stall: the ${d.name} is back-driven, the horn slips`
            : t.d < 0.002
              ? 'force along the horn: no moment arm, no torque'
              : `${Math.round(sag.share * 100)} % of stall: holds, sagging ${(sag.sagRad / DEG).toFixed(1)}° off target`,
          tone,
        )
      },
      readouts: (p) => {
        const q = maParams(p)
        const { d, t, sag, reach, verdict } = maRun(q)
        return [
          { label: 'Moment arm d = r sin θ', value: cm(t.d) },
          { label: 'Torque τ = F·d', value: `${nm(t.tau)} = ${(Math.abs(t.tau) / (G / 100)).toFixed(2)} kg·cm` },
          { label: `${d.name} load`, value: `${Math.round(sag.share * 100)} % of stall`, tone: VERDICT_TONE[verdict] },
          { label: 'Holds this F out to', value: cm(reach), tone: toneOf(reach >= q.r * 2, reach >= q.r) },
        ]
      },
    }
  },
}

// --- Lever types: fulcrum, effort and load in three orders; force traded for distance. ---

const LV = { k: 44, len: 0.3, at: [-14.6, -1.4, 0] as V3, swing: 12 * DEG, period: 4, arrowMax: 4, bars: [3.6, 1.6, 0] as V3 }
const CLASSES = Object.fromEntries(Object.entries(LEVER_CLASSES).map(([k, v]) => [k, v.name])) as Record<LeverClass, string>
const EXAMPLES: Record<LeverClass, [string, string]> = {
  first: ['seesaw, pliers, scissors', 'robot: gripper jaws pivoting on one pin'],
  second: ['wheelbarrow, nutcracker, bottle opener', 'robot: a legged robot rising on its toes'],
  third: ['tweezers, your forearm, a fishing rod', 'robot: servo arm, motor pushes near the joint'],
}
const lvParams = (p: Params) => ({ cls: pick(CLASSES, p.cls, 'first'), pos: n(p, 'pos') / 100, g: n(p, 'load') })
type LvQ = ReturnType<typeof lvParams>
const lvKey = (q: LvQ) => `${q.cls}|${q.pos}|${q.g}`
const lvRun = memoBy(lvKey, (q: LvQ) => {
  const l = leverLayout(q.cls, q.pos, LV.len)
  const w = (q.g / 1000) * G
  return { l, w, f: leverForces(l, w), travel: leverTravel(l, 2 * LV.swing) }
})

export const torqueLeversLeverTypes: Lesson = {
  id: 'torque-levers-lever-types',
  title: 'Lever types',
  tagline: 'Trade force for distance',
  formula: (p) => {
    const { l, w, f } = lvRun(lvParams(p))
    return `balance: F_e × ${cm(l.effortArm)} = W × ${cm(l.loadArm)} · MA = effort arm / load arm = ${l.ma.toFixed(2)} · F_e = ${newtons(w)} / ${l.ma.toFixed(2)} = ${newtons(f.effort)} · load moves 1/MA as far`
  },
  legend: [
    { color: POWER, label: 'Effort F_e (what you or the motor push)', shape: 'dot' },
    { color: FORCE, label: 'Load weight W', shape: 'dot' },
    { color: B_FIELD, label: 'Fulcrum push on the beam', shape: 'dot' },
    { color: RING, label: 'Path of effort and load in one swing', shape: 'dot' },
  ],
  points: [
    'A lever is a stiff beam turning about a fulcrum. Held still, the torques balance (Moment arm): effort × effort arm = load × load arm. The ratio load / effort = effort arm / load arm is the mechanical advantage MA.',
    'Class 1 has the fulcrum between effort and load (seesaw, pliers). Class 2 puts the load in the middle (wheelbarrow): the effort arm is always the longer one, MA > 1. Class 3 puts the effort in the middle (tweezers, your forearm): MA < 1, you push harder than the load.',
    'Nothing is free. The beam turns as one piece, so each point moves in proportion to its distance from the fulcrum: with MA = 3 the load moves a third as far as the effort. Force × distance, the work, is the same on both sides (Energy & work).',
    'Robots use class 3 a lot: a servo or linkage acts close to the joint and the hand at the end moves far and fast, at the price of a large torque at the joint (Dynamics › Gravity torque). Gripper jaws are class 1 levers; Grippers › Parallel jaw works out their squeeze.',
  ],
  controls: [
    { kind: 'choice', key: 'cls', options: opts(CLASSES), initial: 'first' },
    { kind: 'slider', key: 'pos', label: 'Middle element position', min: 20, max: 80, step: 5, initial: 25, format: (v) => `${v} % along` },
    { kind: 'slider', key: 'load', label: 'Load', min: 100, max: 1000, step: 50, initial: 500, format: grams },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const rig = add(scene, new THREE.Group(), LV.at)
    rig.scale.setScalar(LV.k)
    const fulcrum = add(rig, new THREE.Group())
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 3), mat('#7a808c', { rough: 0.6 }))
    add(fulcrum, cone, [0, -0.031, 0])
    cylinder(fulcrum, 0.007, 0.05, mat('#c9ccd3', { metal: 0.5 }), [0, 0, 0.005], 'z', 12)
    box(rig, [LV.len + 0.05, 0.008, 0.08], mat('#3a3f4a', { rough: 0.8 }), [LV.len / 2, -0.06, 0])
    const beam = add(fulcrum, new THREE.Group())
    const plank = box(beam, [LV.len + 0.02, 0.012, 0.05], mat('#c8a46a', { rough: 0.6 }))
    const block = box(beam, [1, 1, 1], mat('#9a6a3a', { rough: 0.6 }))
    const handle = box(beam, [0.012, 0.03, 0.055], mat('#2a5bd7', { rough: 0.5 }))
    const pen = dotPen(rig, 300, 0.0025)
    const effort = forceArrow(scene, POWER)
    const weight = forceArrow(scene, FORCE)
    const react = forceArrow(scene, B_FIELD, { r: 0.08, size: 0.26 })
    const eTrav = liveLabel(scene, [0, 0, 1], { size: 0.28, color: RING })
    const lTrav = liveLabel(scene, [0, 0, 1], { size: 0.28, color: RING })
    const [bx, by] = LV.bars
    addLabel(scene, 'force to hold it level', [bx - 2.6, by + 0.9, 0.2], LABEL, 0.3, 'left')
    const forces = countBars(scene, [bx, by, 0], ['effort F_e', 'load W'], 6)
    addLabel(scene, 'distance moved in one swing', [bx - 2.6, by - 1.9, 0.2], LABEL, 0.3, 'left')
    const dists = countBars(scene, [bx, by - 2.8, 0], ['effort', 'load'], 6)
    const ex1 = liveLabel(scene, [bx - 2.6, by - 5.2, 0.2], { size: 0.3, color: GREY, align: 'left' })
    const ex2 = liveLabel(scene, [bx - 2.6, by - 5.9, 0.2], { size: 0.3, color: LABEL, align: 'left' })
    let key = ''
    let t = 0
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = lvParams(p)
        const { l, w, f, travel } = lvRun(q)
        t += dt
        const phi = LV.swing * Math.sin((2 * Math.PI * t) / LV.period)
        fulcrum.position.x = l.fulcrum
        beam.rotation.z = phi
        plank.position.x = LV.len / 2 - l.fulcrum
        const side = 0.03 + 0.02 * Math.cbrt(q.g / 500)
        block.scale.setScalar(side)
        block.position.set(l.load - l.fulcrum, 0.006 + side / 2, 0)
        handle.position.set(l.effort - l.fulcrum, 0.021, 0)
        const world = (x: number, up = 0): V3 => {
          const dx = x - l.fulcrum
          return [LV.at[0] + (l.fulcrum + dx * Math.cos(phi) - up * Math.sin(phi)) * LV.k, LV.at[1] + (dx * Math.sin(phi) + up * Math.cos(phi)) * LV.k, 1.6]
        }
        if (key !== lvKey(q)) {
          key = lvKey(q)
          pen.begin()
          for (const [x, c] of [[l.effort, RING], [l.load, RING]] as const) {
            const r = Math.abs(x - l.fulcrum)
            const base = x >= l.fulcrum ? 0 : Math.PI
            pen.arc([l.fulcrum, 0, 0.03], r, base - LV.swing, 2 * LV.swing, c)
          }
          pen.end()
        }
        const down = LEVER_CLASSES[q.cls].effortDown
        const aK = LV.arrowMax / Math.max(f.effort, w, Math.abs(f.fulcrum))
        const eLen = f.effort * aK
        const e = world(l.effort, 0.03)
        const eLabel = `F_e ${newtons(f.effort)}`
        if (down) effort([e[0], e[1] + eLen, e[2]], e, eLabel, [0, eLen + 0.9, 0])
        else effort(world(l.effort, -0.006), [e[0], e[1] + eLen, e[2]], eLabel, [0, 0, 0])
        const c = world(l.load, -0.006)
        weight([c[0], c[1], 2], [c[0], c[1] - w * aK, 2], `W ${newtons(w)}`, [0, -0.1, 0])
        const fp: V3 = [LV.at[0] + l.fulcrum * LV.k, LV.at[1] - 2.4, 2.2]
        const rLen = Math.abs(f.fulcrum) * aK
        react(f.fulcrum >= 0 ? [fp[0], fp[1] - rLen, 2.2] : [fp[0], fp[1] + 1.4, 2.2], f.fulcrum >= 0 ? fp : [fp[0], fp[1] + 1.4 - rLen, 2.2], `${newtons(Math.abs(f.fulcrum))}${f.fulcrum < 0 ? ' (pin pulls down)' : ''}`, [0, f.fulcrum >= 0 ? -rLen - 1 : -0.2, 0])
        const eArc = world(l.effort)
        eTrav.group.position.set(eArc[0], LV.at[1] - 3.4, 1.6)
        eTrav.set(`effort ↕ ${cm(travel.effort)}`)
        const lArc = world(l.load)
        lTrav.group.position.set(lArc[0], LV.at[1] + 3.6, 1.6)
        lTrav.set(`load ↕ ${cm(travel.load)}`)
        forces.set([f.effort, w], [newtons(f.effort), newtons(w)], [POWER, FORCE])
        dists.set([travel.effort, travel.load], [cm(travel.effort), cm(travel.load)], [POWER, FORCE])
        ex1.set(EXAMPLES[q.cls][0])
        ex2.set(EXAMPLES[q.cls][1])
        head.status.set(`${CLASSES[q.cls]} · MA ${l.ma.toFixed(2)}`, LABEL)
        head.sub.set(`side view · ${Math.round(LV.len * 100)} cm beam, weightless · rocking ±${LV.swing / DEG}°`)
        head.event.set(
          l.ma > 1.02 ? `MA ${l.ma.toFixed(2)}: ${l.ma.toFixed(1)}× less force, ${l.ma.toFixed(1)}× more distance` : l.ma < 0.98 ? `MA ${l.ma.toFixed(2)}: ${(1 / l.ma).toFixed(1)}× more force, the load moves ${(1 / l.ma).toFixed(1)}× farther and faster` : 'MA 1: same force, same distance',
          l.ma >= 1 ? POWER : HEAT,
        )
      },
      readouts: (p) => {
        const { l, w, f } = lvRun(lvParams(p))
        return [
          { label: 'Effort arm / load arm', value: `${cm(l.effortArm)} / ${cm(l.loadArm)}` },
          { label: 'Mechanical advantage', value: l.ma.toFixed(2), tone: l.ma >= 1 ? 'ok' : 'warn' },
          { label: 'Effort to hold the load', value: newtons(f.effort), tone: f.effort > w ? 'warn' : 'ok' },
          { label: 'Load moves per cm of effort', value: cm(1 / l.ma / 100) },
        ]
      },
    }
  },
}

// --- Static balance: a shoulder boom with a payload and a sliding counterweight; Σ τ = 0 and the servo makes up the rest. ---

const SB = { k: 42, pivot: [-9, -1.2, 0] as V3, stub: 0.17, wK: 0.4, sweep: 30 * DEG, mid: 0, period: 6, bars: [7.6, 1.8, 0] as V3 }
const SHOULDER = ARM_SERVOS[ARM_BUILD.servos[0]]
const sbParams = (p: Params) => ({ payloadKg: n(p, 'payload') / 1000, counterKg: n(p, 'counter') / 1000, counterM: n(p, 'counterR') / 100 })
type SbQ = ReturnType<typeof sbParams>
const sbKey = (q: SbQ) => `${q.payloadKg}|${q.counterKg}|${q.counterM}`
const sbRun = memoBy(sbKey, (q: SbQ) => {
  const flat = boomTorques(q, 0)
  return { flat, rBal: balanceRadius(q), share: Math.abs(flat.servo) / SHOULDER.stallNm }
})

export const torqueLeversStaticBalance: Lesson = {
  id: 'torque-levers-static-balance',
  title: 'Static balance',
  tagline: 'Every torque cancels',
  formula: (p) => {
    const q = sbParams(p)
    const { flat } = sbRun(q)
    return `Σ τ = W_p·${cm(BOOM.lenM)} + W_arm·${cm(BOOM.linkM)} − W_c·${cm(q.counterM)} = ${nm(flat.payload)} + ${nm(flat.link)} − ${nm(flat.counter)} = ${flat.net < 0 ? '−' : ''}${nm(flat.net)} (arm level) · servo supplies the rest`
  },
  legend: [
    { color: FORCE, label: 'Weights: payload, arm, counterweight', shape: 'dot' },
    { color: RING, label: 'Moment arms: horizontal distance to pivot', shape: 'dot' },
    { color: B_FIELD, label: 'Pivot push = total weight (Σ F = 0)', shape: 'dot' },
    { color: POWER, label: 'Shoulder servo torque (100 % = stall)', shape: 'dot' },
  ],
  points: [
    'A body stays still only if the forces and the torques both cancel: Σ F = 0 and Σ τ = 0. Take torques about any point; the pivot is handy because its own push has no moment arm there. A seesaw balances when weight × distance matches on both sides.',
    'Here the shoulder of a robot arm carries a payload 20 cm out and the arm’s own weight 10 cm out, both tipping it forward. A counterweight on a stub behind the pivot tips it back. Whatever is left over the shoulder servo must supply, all the time it holds the pose.',
    'Slide the counterweight to the balance distance and Σ τ = 0 with the servo idle: the combined centre of mass sits on the pivot, so the arm stays balanced at every angle. Off balance, the needed torque scales with cos of the arm angle: largest level, zero pointing straight up.',
    'The pivot always carries the full weight, counterweight included, and the extra mass adds inertia the servo must swing (Dynamics › Inertia). Springs do the same job without the mass. Dynamics › Gravity torque does this for a whole two-link arm.',
  ],
  controls: [
    { kind: 'slider', key: 'payload', label: 'Payload at the hand', min: 0, max: 400, step: 25, initial: 200, format: grams },
    { kind: 'slider', key: 'counter', label: 'Counterweight', min: 0, max: 600, step: 50, initial: 300, format: grams },
    { kind: 'slider', key: 'counterR', label: 'Counterweight distance', min: 0, max: 16, step: 0.5, initial: 8, format: (v) => `${v.toFixed(1)} cm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const [px, py] = SB.pivot
    const rig = add(scene, new THREE.Group(), SB.pivot)
    rig.scale.setScalar(SB.k)
    box(rig, [0.03, 0.12, 0.03], mat('#3a3d45', { rough: 0.6 }), [0, -0.075, -0.03])
    box(rig, [0.16, 0.01, 0.08], mat('#2a2c32', { rough: 0.7 }), [0, -0.14, -0.03])
    box(rig, [0.04, 0.02, 0.037], mat('#1f2f6b', { rough: 0.5 }), [0, -0.006, -0.03])
    const boom = add(rig, new THREE.Group())
    box(boom, [BOOM.lenM + SB.stub + 0.02, 0.012, 0.02], mat('#d8dbe2', { rough: 0.5 }), [(BOOM.lenM - SB.stub) / 2, 0, 0])
    cylinder(boom, 0.009, 0.03, mat('#f2f2f2'), [0, 0, 0.005], 'z', 16)
    box(boom, [0.012, 0.03, 0.025], mat('#2a5bd7', { rough: 0.5 }), [BOOM.lenM, -0.012, 0])
    const load = box(boom, [1, 1, 1], mat('#9a6a3a', { rough: 0.6 }))
    const counter = cylinder(boom, 1, 1, mat('#6b7280', { metal: 0.6, rough: 0.35 }), [0, 0, 0], 'z', 24)
    const pen = dotPen(scene, 400, 0.06)
    const wP = forceArrow(scene, FORCE)
    const wL = forceArrow(scene, FORCE, { r: 0.07, size: 0.26 })
    const wC = forceArrow(scene, FORCE)
    const up = forceArrow(scene, B_FIELD)
    const tauTag = liveLabel(scene, [px, py + 2.8, 1], { size: 0.34 })
    const [bx, by] = SB.bars
    addLabel(scene, `torque now · 100 % = ${nm(SHOULDER.stallNm)} stall`, [bx - 5, by + 1, 0.2], LABEL, 0.28, 'left')
    const bars = sumBars(scene, [bx, by, 0], [{ label: 'payload', color: FORCE }, { label: 'arm', color: FORCE }, { label: 'counter', color: FORCE }, { label: 'servo', color: POWER }], 6, ' over stall')
    const verdict = liveLabel(scene, [bx - 6, by - 3.2, 0.2], { size: 0.32, align: 'left' })
    const rLine = liveLabel(scene, [bx - 6, by - 4, 0.2], { size: 0.28, color: GREY, align: 'left' })
    let t = 0
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = sbParams(p)
        const { rBal, share } = sbRun(q)
        t += dt
        const phi = SB.mid + SB.sweep * Math.sin((2 * Math.PI * t) / SB.period)
        const now = boomTorques(q, phi)
        boom.rotation.z = phi
        const side = q.payloadKg > 0 ? 0.02 + 0.02 * Math.cbrt(q.payloadKg / 0.2) : 0
        load.visible = side > 0
        load.scale.setScalar(Math.max(side, 1e-3))
        load.position.set(BOOM.lenM, -0.027 - side / 2, 0)
        const cr = 0.008 + 0.01 * Math.cbrt(q.counterKg / 0.3)
        counter.visible = q.counterKg > 0
        counter.scale.set(cr, 0.03, cr)
        counter.position.set(-q.counterM, 0, 0)
        const c = Math.cos(phi)
        const s = Math.sin(phi)
        const at = (x: number, yOff = 0): V3 => [px + (x * c - yOff * s) * SB.k, py + (x * s + yOff * c) * SB.k, 1.8]
        const K = SB.wK
        const hand = at(BOOM.lenM, -0.027 - side)
        wP(hand, [hand[0], hand[1] - q.payloadKg * G * K * 2.5, 1.8], `W_p ${newtons(q.payloadKg * G)}`, [0, -0.1, 0])
        const mid = at(BOOM.linkM)
        wL(mid, [mid[0], mid[1] - BOOM.linkKg * G * K * 2.5, 1.8], 'W_arm', [0, -0.1, 0])
        const cw = at(-q.counterM)
        wC(cw, [cw[0], cw[1] - q.counterKg * G * K * 2.5, cw[2]], `W_c ${newtons(q.counterKg * G)}`, [0, -0.1, 0])
        up([px, py - 6.2, 2], [px, py - 6.2 + now.pivotN * K * 1.2, 2], `pivot ${newtons(now.pivotN)}`, [1.6, -0.6 - now.pivotN * K * 1.2, 0])
        pen.begin()
        for (const [x, show] of [[BOOM.lenM, q.payloadKg > 0], [BOOM.linkM, true], [-q.counterM, q.counterKg > 0]] as const) {
          if (!show || Math.abs(x) < 1e-3) continue
          const e = at(x)
          pen.line([px, py - 2.4, 1.4], [e[0], py - 2.4, 1.4], 0.3, RING, 1)
          pen.line([e[0], e[1], 1.4], [e[0], py - 2.4, 1.4], 0.45, GREY, 0.5)
        }
        const sweep = Math.max(-1, Math.min(1, now.servo / SHOULDER.stallNm)) * Math.PI
        const steps = Math.max(2, Math.round(Math.abs(sweep) * 10))
        for (let i = 0; i <= steps; i++) {
          const a = Math.PI / 2 + (sweep * i) / steps
          pen.dot([px + 2 * Math.cos(a), py + 2 * Math.sin(a), 2], POWER, i === steps ? 2.4 : 1.4)
        }
        pen.end()
        const over = Math.abs(now.servo) > SHOULDER.stallNm
        const bal = Math.abs(now.net) < 0.005
        tauTag.set(bal ? 'servo idle' : `servo ${nm(now.servo)} ${now.servo < 0 ? '↻' : '↺'}`, over ? HIGH_V : POWER)
        bars.set([now.payload, now.link, now.counter, now.servo].map((v) => v / SHOULDER.stallNm), over)
        verdict.set(bal ? 'balanced: Σ τ = 0 with the servo idle' : now.net > 0 ? 'tips forward: servo lifts the payload side' : 'tips back: servo holds the counterweight side', bal ? POWER : over ? HIGH_V : HEAT)
        rLine.set(Number.isFinite(rBal) ? `balance distance ${cm(rBal)}${rBal > SB.stub ? ' (past the stub: add weight)' : ''}` : 'no counterweight: the servo carries it all')
        head.status.set(`Static balance · Σ τ at arm level ${now.net < 0 ? '−' : ''}${nm(sbRun(q).flat.net)} · ${SHOULDER.name} at ${Math.round(share * 100)} %`, LABEL)
        head.sub.set(`side view · shoulder boom rocking ${Math.round((SB.mid - SB.sweep) / DEG)}…${Math.round((SB.mid + SB.sweep) / DEG)}° · arm ${phi >= 0 ? '+' : ''}${Math.round(phi / DEG)}°`)
        head.event.set(bal ? 'centre of mass on the pivot: balanced at every angle' : `torque ∝ cos(arm angle): now ${Math.round(Math.cos(phi) * 100)} % of the level value`, bal ? POWER : GREY)
      },
      readouts: (p) => {
        const q = sbParams(p)
        const { flat, rBal, share } = sbRun(q)
        return [
          { label: 'Payload + arm torque (level)', value: nm(flat.payload + flat.link) },
          { label: 'Counterweight torque', value: nm(flat.counter) },
          { label: 'Shoulder servo must supply', value: `${nm(flat.servo)} · ${Math.round(share * 100)} %`, tone: VERDICT_TONE[holdVerdict(share)] },
          { label: 'Balance distance', value: cm(rBal), tone: toneOf(Math.abs(rBal - q.counterM) < 0.005, rBal <= SB.stub) },
        ]
      },
    }
  },
}
