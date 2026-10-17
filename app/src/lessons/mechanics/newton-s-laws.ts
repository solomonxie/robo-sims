import { DEG, FRICTION_PAIRS, G, NEWTON_CAR, ROLL_FLOORS, fixedStepAt, frictionRun, inclineForces, pushRun, rampRun } from '../../core/physics'
import { accelText, kgText, mpsText, newtonsText, secsText } from '../../core/units'
import { V3, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, FORCE, GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, flatBox, forceArrow, glowMat, lapseClock, liveLabel, memoBy, SIDE_SCOPE, scopeLabels, scrollTape, sideCar, sideScope, sideView, statusHeader, traceRun, trayMat } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'
import * as THREE from 'three/webgpu'

const VIEW = sideView(-2.2, 1.8)
const SCOPE = { y: -1.2, h: 7.6 }
const dt = 0.005
const SLOW = 0.5
const massOf = (p: Params) => NEWTON_CAR.massKg + n(p, 'load')
const loadSlider = { kind: 'slider', key: 'load', label: 'Payload', min: 0, max: 3, step: 0.5, initial: 1, format: (v: number) => `${v.toFixed(1)} kg` } as const

/** Scope header: status, sub-line and event text; time-lapse clock; signed traces on a top half / bottom half split. */
function lapseStage(seconds: number, top: string, bottom: string) {
  const scene = createStage({ span: 40 })
  const head = statusHeader(scene)
  const plot = sideScope(scene, SCOPE.y, SCOPE.h, { divs: [8, 4], zeroAt: 0.25 })
  scopeLabels(scene, SCOPE.y, SCOPE.h, seconds, top, bottom)
  const yTop = (u: number) => Math.max(-0.02, Math.min(1.05, u)) * (SCOPE.h / 2) * 0.9
  const yLow = (u: number) => -SCOPE.h / 4 + Math.max(-1.1, Math.min(1.1, u)) * (SCOPE.h / 4) * 0.9
  return { scene, ...head, plot, yTop, yLow, clock: lapseClock(seconds, SLOW, 0.8) }
}

// --- F = m a: a motor force pushes the car for 1 s, then it coasts on rolling resistance alone. ---

const FMA = { seconds: 4, push: 1, k: 30, at: [-9.6, -3.4, 0] as V3, nScale: 3.5, vMax: 2.5, aMax: 3 }
const FLOORS = { tile: ROLL_FLOORS.tile.name, wood: ROLL_FLOORS.wood.name, carpet: ROLL_FLOORS.carpet.name }
const fmaParams = (p: Params) => ({ f: n(p, 'force'), m: massOf(p), load: n(p, 'load'), floor: pick(FLOORS, p.floor, 'tile') })
type FmaQ = ReturnType<typeof fmaParams>
const fmaKey = (q: FmaQ) => `${q.f}|${q.m}|${q.floor}`
const fmaRun = memoBy(fmaKey, (q: FmaQ) => {
  const crr = ROLL_FLOORS[q.floor].crr
  const run = pushRun({ force: q.f, mass: q.m, crr, pushFor: FMA.push, seconds: FMA.seconds, dt })
  const pushA = run[1].a
  const top = Math.max(...run.map((f) => f.v))
  return { run, crr, pushA, top }
})

export const newtonsLawsFMA: Lesson = {
  id: 'newton-s-laws-f-m-a',
  title: 'F = m a',
  tagline: 'Net force speeds a mass up',
  formula: (p) => {
    const q = fmaParams(p)
    const { crr, pushA } = fmaRun(q)
    const rr = crr * q.m * G
    return `a = F_net / m = (F − C_rr·m·g) / m = (${q.f.toFixed(2)} − ${rr.toFixed(2)}) N / ${kgText(q.m)} = ${accelText(pushA)} · coasting: a = −C_rr·g = ${accelText(-crr * G)}`
  },
  legend: [
    { color: POWER, label: 'Motor drive force F (floor pushes the tyre)', shape: 'arrow-right' },
    { color: HEAT, label: 'Rolling resistance', shape: 'arrow-left' },
    { color: FORCE, label: 'Net force F_net = m a', shape: 'arrow-right' },
    { color: RING, label: `Speed (scope top 0…${FMA.vMax} m/s)`, shape: 'dot' },
    { color: B_FIELD, label: `Acceleration (bottom ±${FMA.aMax} m/s²)`, shape: 'dot' },
  ],
  points: [
    'Newton’s second law: the net force on a body equals its mass times its acceleration, F = m a. Net means all forces added with their signs: here the motor’s drive force forward minus rolling resistance backward.',
    `For ${FMA.push} s the motor pushes, so the car speeds up at a steady a = F_net/m and the speed line climbs straight. Add payload and the same force gives less acceleration: double the mass, half the a. That is why a loaded robot feels sluggish and needs more motor current to keep up.`,
    'Then the motor lets go. First law: with no net force a body keeps its speed. Only rolling resistance is left, so the car coasts and slows gently on tile, quickly on carpet. Acceleration jumps to a small negative value the instant the force changes; speed can only bend.',
    'Third law: the tyre pushes the floor backward (grey arrow) and the floor pushes the car forward with an equal force. No floor grip, no drive force: see Friction and later Friction & traction › Wheel slip. Real motors lose force as they speed up (Actuators › DC motor › Torque and speed curve); here F is held constant.',
  ],
  controls: [
    { kind: 'slider', key: 'force', label: 'Motor force F', min: 0.2, max: 2, step: 0.1, initial: 1, format: (v) => newtonsText(v) },
    loadSlider,
    { kind: 'choice', key: 'floor', options: opts(FLOORS), initial: 'tile' },
  ],
  build(): Stage {
    const s = lapseStage(FMA.seconds, `speed 0…${FMA.vMax} m/s`, `accel ±${FMA.aMax} m/s²`)
    const roll = scrollTape(s.scene, FMA.at, 15, 1.2)
    const car = sideCar(s.scene, FMA.at, FMA.k)
    const wheelX = 0.065 * FMA.k
    const drive = forceArrow(s.scene, POWER)
    const rr = forceArrow(s.scene, HEAT)
    const net = forceArrow(s.scene, FORCE)
    const react = forceArrow(s.scene, GREY, { size: 0.26 })
    addLabel(s.scene, 'floor', [FMA.at[0] - 6.6, FMA.at[1] - 0.75, 0.3], GREY, 0.26, 'left')
    const vTr = s.plot.trace(RING, { samples: 300, radius: 0.07 })
    const aTr = s.plot.trace(B_FIELD, { samples: 300, radius: 0.05 })
    return {
      scene: s.scene,
      view: VIEW,
      frame(dtF, p) {
        const q = fmaParams(p)
        const r = fmaRun(q)
        const t = s.clock(dtF, fmaKey(q))
        const f = fixedStepAt(r.run, t, dt)
        traceRun(vTr, r.run, dt, FMA.seconds, t, (g) => s.yTop(g.v / FMA.vMax), 300)
        traceRun(aTr, r.run, dt, FMA.seconds, t, (g) => s.yLow(g.a / FMA.aMax), 300)
        roll(f.x * FMA.k)
        car.set(f.x, q.load)
        const [x0, y0] = FMA.at
        const K = FMA.nScale
        drive([x0 - wheelX, y0 + 0.15, 2.6], [x0 - wheelX + f.drive * K, y0 + 0.15, 2.6], `F ${newtonsText(f.drive)}`, [0.3, 0.45, 0])
        rr([x0 + wheelX, y0 + 0.15, 2.8], [x0 + wheelX + f.roll * K, y0 + 0.15, 2.8], `${newtonsText(-f.roll)}`, [0, -0.5, 0])
        react([x0 - wheelX, y0 - 0.5, 2], [x0 - wheelX - f.drive * K, y0 - 0.5, 2], 'tyre → floor', [-0.6, -0.4, 0])
        const ny = y0 + car.top + 2.4
        net([x0, ny, 0.5], [x0 + f.net * K, ny, 0.5], `F_net ${newtonsText(f.net)} → a ${accelText(f.a)}`, [f.net >= 0 ? 2.2 : -2.2, 0.45, 0])
        s.status.set(`F = m a · F ${newtonsText(q.f)} · m ${kgText(q.m)} · ${FLOORS[q.floor]}`, LABEL)
        if (f.drive > 0) s.event.set(`pushing: F_net ${newtonsText(f.net)} / ${kgText(q.m)} = ${accelText(f.a)} · ${mpsText(f.v)}`, POWER)
        else if (f.v > 0) s.event.set(`motor off, coasting: only rolling resistance, a ${accelText(f.a)} · ${mpsText(f.v)}`, HEAT)
        else s.event.set(`stopped after ${f.x.toFixed(2)} m`, GREY)
        s.sub.set(`${t.toFixed(2)} / ${FMA.seconds} s · slowed ${1 / SLOW}× · motor on for ${FMA.push} s`)
      },
      readouts: (p) => {
        const q = fmaParams(p)
        const r = fmaRun(q)
        return [
          { label: 'Total mass m', value: kgText(q.m) },
          { label: 'Net force while pushing', value: newtonsText(r.run[1].net), tone: r.run[1].net > 0 ? 'ok' : 'bad' },
          { label: 'Acceleration a = F_net / m', value: accelText(r.pushA), tone: r.pushA > 0 ? 'ok' : 'bad' },
          { label: 'Top speed', value: mpsText(r.top), tone: r.top > 1.2 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Free-body diagram: weight, normal and drive force on a car on a ramp, resolved and summed tip to tail. ---

const FBD = { seconds: 3, half: 0.4, k: 12, base: [-15.5, -5.6, 0] as V3, nScale: 0.15, sum: [SIDE_SCOPE.x, -1.6, 0] as V3 }
const fbdParams = (p: Params) => ({ th: n(p, 'angle') * DEG, deg: n(p, 'angle'), drive: n(p, 'drive'), m: massOf(p), load: n(p, 'load') })
type FbdQ = ReturnType<typeof fbdParams>
const fbdKey = (q: FbdQ) => `${q.deg}|${q.drive}|${q.m}`
const fbdRun = memoBy(fbdKey, (q: FbdQ) => ({ f: inclineForces(q.m, q.th, q.drive), run: rampRun({ mass: q.m, theta: q.th, drive: q.drive, half: FBD.half, seconds: FBD.seconds, dt }) }))
const fbdVerdict = (net: number) => (Math.abs(net) < 0.05 ? 'balanced: no net force' : net > 0 ? 'net force up the slope' : 'net force down the slope')

export const newtonsLawsFreeBodyDiagrams: Lesson = {
  id: 'newton-s-laws-free-body-diagrams',
  title: 'Free-body diagrams',
  tagline: 'Draw every force, then add them',
  formula: (p) => {
    const q = fbdParams(p)
    const { f } = fbdRun(q)
    return `W = m g = ${newtonsText(f.w)} · N = m g cos θ = ${newtonsText(f.n)} · along the slope: F − m g sin θ = ${q.drive.toFixed(1)} − ${f.wPar.toFixed(2)} = ${newtonsText(f.net)} → a = ${accelText(f.a)}`
  },
  legend: [
    { color: HIGH_V, label: 'Weight W = m g (straight down)', shape: 'dot' },
    { color: GREY, label: 'Weight split: along / into the slope', shape: 'dot' },
    { color: B_FIELD, label: 'Normal force N (floor pushes back)', shape: 'dot' },
    { color: POWER, label: 'Motor drive force F (up the slope)', shape: 'dot' },
    { color: FORCE, label: 'Net force = sum of all arrows', shape: 'dot' },
  ],
  points: [
    'A free-body diagram isolates one body and draws every force acting on it as an arrow from its centre: here gravity (weight), the ramp’s push (normal force) and the drive force the floor gives the tyres. Forces the car exerts on other things do not belong on its diagram.',
    'Pick axes that fit the problem: along the slope and across it. Weight is the only arrow not on those axes, so split it into m g sin θ pulling down the slope and m g cos θ pressing into it (the grey pair).',
    'Across the slope the car does not move, so the normal force must cancel m g cos θ exactly: N = m g cos θ, a little less than the weight. Steeper ramp, less normal force, and less grip for the tyres.',
    'Along the slope whatever is left over is the net force, and F = m a turns it into acceleration. The right panel adds the arrows tip to tail: the gap from the first tail to the last tip is the net force. Match F to m g sin θ and the arrows close into a triangle: no net force, the car holds still or keeps its speed. Can the tyres really give F? See Friction.',
  ],
  controls: [
    { kind: 'slider', key: 'angle', label: 'Ramp angle θ', min: 0, max: 35, step: 1, initial: 20, format: (v) => `${v}°` },
    { kind: 'slider', key: 'drive', label: 'Drive force F', min: 0, max: 15, step: 0.5, initial: 9, format: (v) => newtonsText(v) },
    loadSlider,
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const clock = lapseClock(FBD.seconds, SLOW, 0.8)
    const ramp = new THREE.Group()
    ramp.position.set(...FBD.base)
    scene.add(ramp)
    const len = (2 * FBD.half + 0.35) * FBD.k
    box(ramp, [len, 0.4, 3.2], mat('#4a505c', { rough: 0.8 }), [len / 2, -0.2, 0])
    const tick = glowMat(GREY, 0.4)
    for (let i = 0; i <= 8; i++) flatBox(ramp, [0.06, 0.03, 2.8], tick, [(0.175 + (i / 8) * 2 * FBD.half) * FBD.k, 0.01, 0])
    flatBox(scene, [len + 4, 0.3, 3.4], mat('#3a3f4a', { rough: 0.8 }), [FBD.base[0] + len / 2, FBD.base[1] - 0.35, 0])
    const car = sideCar(ramp, [(0.175 + FBD.half) * FBD.k, 0, 0], FBD.k)
    const arrows = { w: forceArrow(scene, HIGH_V), par: forceArrow(scene, GREY, { r: 0.06, size: 0.26 }), perp: forceArrow(scene, GREY, { r: 0.06, size: 0.26 }), n: forceArrow(scene, B_FIELD), f: forceArrow(scene, POWER), net: forceArrow(scene, FORCE) }
    box(scene, [SIDE_SCOPE.w, 9, 0.4], trayMat(), [FBD.sum[0], FBD.sum[1], -0.6])
    addLabel(scene, 'add the arrows tip to tail', [FBD.sum[0], FBD.sum[1] + 5.2, 0.3], LABEL, 0.32)
    const tray = { r: 0.07, size: 0.28 }
    const sum = { w: forceArrow(scene, HIGH_V, tray), n: forceArrow(scene, B_FIELD, tray), f: forceArrow(scene, POWER, tray), net: forceArrow(scene, FORCE, tray) }
    const thLabel = liveLabel(scene, [0, 0, 0.4], { size: 0.4 })
    thLabel.set('θ')
    return {
      scene,
      view: VIEW,
      frame(dtF, p) {
        const q = fbdParams(p)
        const { f, run } = fbdRun(q)
        const t = clock(dtF, fbdKey(q))
        const fr = fixedStepAt(run, t, dt)
        ramp.rotation.z = q.th
        thLabel.group.position.set(FBD.base[0] + 3.4 * Math.cos(q.th / 2), FBD.base[1] + 0.2 + 3.4 * Math.sin(q.th / 2), 0.4)
        car.group.position.x = (0.175 + FBD.half + fr.s) * FBD.k
        car.set(fr.s, q.load)
        const c = Math.cos(q.th)
        const sn = Math.sin(q.th)
        const along: V3 = [c, sn, 0]
        const into: V3 = [sn, -c, 0]
        const d = car.group.position.x
        const hC = car.top * 0.6
        const o: V3 = [FBD.base[0] + d * c - hC * sn, FBD.base[1] + d * sn + hC * c, 2.2]
        const K = FBD.nScale
        const at = (v: V3, m: number, from: V3 = o): V3 => [from[0] + v[0] * m * K, from[1] + v[1] * m * K, from[2]]
        arrows.w(o, at([0, -1, 0], f.w), `W ${newtonsText(f.w)}`, [-1.2, 0, 0])
        arrows.par(o, at(along, -f.wPar), `mg sin θ`, [-0.4, -0.35, 0])
        arrows.perp(o, at(into, f.wPerp), `mg cos θ`, [1.3, 0.2, 0])
        arrows.n(o, at(into, -f.n), `N ${newtonsText(f.n)}`, [0, 0.1, 0])
        arrows.f(o, at(along, q.drive), `F ${newtonsText(q.drive)}`, [0.4, 0.3, 0])
        const lift = f.n * K + 1.2
        const no: V3 = [o[0] - into[0] * lift, o[1] - into[1] * lift, 2.6]
        arrows.net(no, at(along, f.net, no), `net ${newtonsText(f.net)}`, [0, f.net >= 0 ? 0.5 : -0.5, 0])
        const Ks = 6 / f.w
        const tail = (v: V3, m: number, from: V3): V3 => [from[0] + v[0] * m * Ks, from[1] + v[1] * m * Ks, from[2]]
        const s0: V3 = [FBD.sum[0] + 1, FBD.sum[1] + 3.4, 0.2]
        const s1 = tail([0, -1, 0], f.w, s0)
        const s2 = tail(along, q.drive, s1)
        const s3 = tail(into, -f.n, s2)
        sum.w(s0, s1, 'W', [-0.6, 0.6, 0])
        sum.f(s1, s2, 'F', [0.2, -0.3, 0])
        sum.n(s2, s3, 'N', [(s2[0] - s3[0]) / 2 + 0.6, (s2[1] - s3[1]) / 2 - 0.55, 0])
        sum.net([s0[0], s0[1], 0.5], [s3[0], s3[1], 0.5], `net ${newtonsText(f.net)}`, [0, 0.45, 0])
        head.status.set(`Free-body diagram · θ ${q.deg}° · F ${newtonsText(q.drive)} · m ${kgText(q.m)}`, LABEL)
        const v = fbdVerdict(f.net)
        const atEnd = Math.abs(fr.s) >= FBD.half - 1e-9
        head.event.set(atEnd && Math.abs(f.net) >= 0.05 ? `${v}: reached the ${fr.s > 0 ? 'top' : 'bottom'} of the ramp` : `${v} · a ${accelText(f.a)} · ${mpsText(fr.v)}`, Math.abs(f.net) < 0.05 ? RING : f.net > 0 ? POWER : HIGH_V)
        head.sub.set(`${t.toFixed(2)} / ${FBD.seconds} s · slowed ${1 / SLOW}× · arrows ${(1 / K).toFixed(1)} N per unit · wheels roll freely`)
      },
      readouts: (p) => {
        const { f } = fbdRun(fbdParams(p))
        return [
          { label: 'Weight W = m g', value: newtonsText(f.w) },
          { label: 'Normal force N = m g cos θ', value: newtonsText(f.n) },
          { label: 'Down-slope pull m g sin θ', value: newtonsText(f.wPar) },
          { label: 'Net force → acceleration', value: `${newtonsText(f.net)} → ${accelText(f.a)}`, tone: Math.abs(f.net) < 0.05 ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Friction: push a robot with locked wheels harder and harder; static friction holds, then lets go. ---

const FR = { seconds: 6, rate: 5, hold: 0.5, k: 18, at: [-9.5, -2.6, 0] as V3, nScale: 0.25, fMax: 20, vMax: 1.2 }
const PAIRS = Object.fromEntries(Object.entries(FRICTION_PAIRS).map(([k, v]) => [k, v.name])) as Record<keyof typeof FRICTION_PAIRS, string>
const frParams = (p: Params) => ({ pair: pick(PAIRS, p.pair, 'tile'), m: n(p, 'mass') })
type FrQ = ReturnType<typeof frParams>
const frKey = (q: FrQ) => `${q.pair}|${q.m}`
const frRun = memoBy(frKey, (q: FrQ) => frictionRun({ mass: q.m, ...FRICTION_PAIRS[q.pair], rate: FR.rate, hold: FR.hold, seconds: FR.seconds, dt }))

export const newtonsLawsFriction: Lesson = {
  id: 'newton-s-laws-friction',
  title: 'Friction',
  tagline: 'Grips until it slips',
  formula: (p) => {
    const q = frParams(p)
    const { mus, muk } = FRICTION_PAIRS[q.pair]
    const N = q.m * G
    return `N = m g = ${newtonsText(N)} · static: f ≤ μs·N = ${mus} × ${N.toFixed(1)} = ${newtonsText(mus * N)} · sliding: f = μk·N = ${muk} × ${N.toFixed(1)} = ${newtonsText(muk * N)}`
  },
  legend: [
    { color: POWER, label: `Push (ramps up ${FR.rate} N/s; scope top 0…${FR.fMax} N)`, shape: 'arrow-right' },
    { color: HEAT, label: 'Friction from the floor', shape: 'arrow-left' },
    { color: GREY, label: 'Breakaway limit μs·N', shape: 'dot' },
    { color: RING, label: `Speed (scope bottom 0…${FR.vMax} m/s)`, shape: 'dot' },
  ],
  points: [
    'Push a robot whose wheels are locked and at first nothing happens. Static friction pushes back exactly as hard as you push, so the net force stays zero: the orange and green lines lie on top of each other.',
    'Static friction has a ceiling, μs·N, where N is the normal force (here the weight). Push past it and the robot breaks free. The coefficient μ depends on the pair of surfaces, not on the contact area: a heavier robot needs proportionally more push.',
    'Once sliding, kinetic friction μk·N takes over, and it is smaller than the static limit. The same push now leaves a net force, so the robot jumps forward: the stick-slip that makes a dragged chair judder. Let go and kinetic friction alone brakes it to a stop.',
    'Wheels use the same static grip: a rolling tyre does not slide on the floor, and μs·N caps the drive force F from F = m a and the braking force. This is the introduction; Friction & traction covers static vs kinetic, rolling resistance and wheel slip in depth (see also Mobility › Differential drive › Wheel slip).',
  ],
  controls: [
    { kind: 'choice', key: 'pair', options: opts(PAIRS), initial: 'tile' },
    { kind: 'slider', key: 'mass', label: 'Robot mass m', min: 0.5, max: 2, step: 0.1, initial: 1, format: (v) => kgText(v) },
  ],
  build(): Stage {
    const s = lapseStage(FR.seconds, `force 0…${FR.fMax} N`, `speed 0…${FR.vMax} m/s`)
    const [x0, y0] = FR.at
    box(s.scene, [11, 0.3, 3], mat('#3a3f4a', { rough: 0.8 }), [x0 + 4.5, y0 - 0.15, 0])
    const tick = glowMat(GREY, 0.4)
    for (let i = 0; i <= 5; i++) {
      flatBox(s.scene, [0.06, 0.04, 2.6], tick, [x0 + i * 0.1 * FR.k, y0 + 0.01, 0])
      addLabel(s.scene, `${(i / 10).toFixed(1)} m`, [x0 + i * 0.1 * FR.k, y0 - 1.1, 1.6], GREY, 0.24)
    }
    const car = sideCar(s.scene, FR.at, FR.k)
    const push = forceArrow(s.scene, POWER)
    const fric = forceArrow(s.scene, HEAT)
    const pushTr = s.plot.trace(POWER, { samples: 300, radius: 0.06 })
    const fricTr = s.plot.trace(HEAT, { samples: 300, radius: 0.045 })
    const limTr = s.plot.trace(GREY, { samples: 2, radius: 0.03 })
    const vTr = s.plot.trace(RING, { samples: 300, radius: 0.06 })
    return {
      scene: s.scene,
      view: VIEW,
      frame(dtF, p) {
        const q = frParams(p)
        const r = frRun(q)
        const t = s.clock(dtF, frKey(q))
        const f = fixedStepAt(r.run, t, dt)
        traceRun(pushTr, r.run, dt, FR.seconds, t, (g) => s.yTop(g.push / FR.fMax), 300)
        traceRun(fricTr, r.run, dt, FR.seconds, t, (g) => s.yTop(-g.fric / FR.fMax), 300)
        traceRun(vTr, r.run, dt, FR.seconds, t, (g) => s.yLow(-1 + (2 * g.v) / FR.vMax), 300)
        limTr.points([0, 1], [s.yTop(r.breakN / FR.fMax), s.yTop(r.breakN / FR.fMax)])
        car.group.position.x = x0 + f.x * FR.k
        car.set(0, 0)
        const cx = car.group.position.x
        const half = 0.1 * FR.k
        const K = FR.nScale
        const py = y0 + car.top * 0.6
        push([cx - half - 0.2 - f.push * K, py, 2.4], [cx - half - 0.2, py, 2.4], `push ${newtonsText(f.push)}`, [-0.55 - (f.push * K) / 2, 0.55, 0])
        fric([cx, y0 + 0.2, 2.2], [cx + f.fric * K, y0 + 0.2, 2.2], `friction ${newtonsText(-f.fric)}`, [0, -0.55, 0])
        const { mus, muk } = FRICTION_PAIRS[q.pair]
        s.status.set(`Friction · ${PAIRS[q.pair]} · μs ${mus} · μk ${muk} · m ${kgText(q.m)}`, LABEL)
        if (r.breakAt === null || t < r.breakAt) s.event.set(`stuck: static friction matches the push, ${newtonsText(f.push)} of ${newtonsText(r.breakN)} max`, HEAT)
        else if (f.push > 0) s.event.set(`broke free: sliding friction ${newtonsText(r.kineticN)} < push ${newtonsText(f.push)} → net ${newtonsText(f.push + f.fric)}`, POWER)
        else if (f.v > 0) s.event.set(`let go: kinetic friction brakes it, ${mpsText(f.v)}`, HIGH_V)
        else s.event.set(`stopped after sliding ${(f.x * 100).toFixed(1)} cm`, GREY)
        s.sub.set(`${t.toFixed(2)} / ${FR.seconds} s · slowed ${1 / SLOW}× · push held ${FR.hold} s after it breaks free`)
      },
      readouts: (p) => {
        const r = frRun(frParams(p))
        return [
          { label: 'Normal force N = m g', value: newtonsText(n(p, 'mass') * G) },
          { label: 'Breakaway μs·N', value: newtonsText(r.breakN) },
          { label: 'Sliding friction μk·N', value: newtonsText(r.kineticN) },
          { label: 'Breaks free at', value: secsText(r.breakAt), tone: r.breakAt === null ? 'bad' : 'ok' },
        ]
      },
    }
  },
}
