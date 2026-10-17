import { FLYWHEELS, Flywheel, RotorShape, SHOOTER, SPINNER, SpinMode, fixedStepAt, raceAngle, reactionRatio, rotorInertias, shooterRun, spinRace, spinnerRun } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, DATA_COLOR, GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, countBars, dotPen, lapseClock, liveLabel, memoBy, plotPanel, statusHeader, tiltRig, traceRun } from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'
import * as THREE from 'three/webgpu'

const VIEW = { center: [-2.4, -0.4, 0] as V3, radius: 52, polar: 1.45, azimuth: 0 }
const TAU = 2 * Math.PI
const rpm = (w: number) => `${Math.round(Math.abs(w) * (60 / TAU))} rpm`
const secs = (t: number) => `${t.toFixed(2)} s`
const joules = (e: number) => (e < 1 ? `${(e * 1000).toFixed(0)} mJ` : `${e.toFixed(1)} J`)
const inertia = (i: number) => `${(i * 1e4).toFixed(i < 1e-3 ? 2 : 1)} kg·cm²`
const mps = (v: number) => `${v.toFixed(1)} m/s`
const grams = (v: number) => `${v} g`

/** Disk (stripe), thin ring (rim + spokes) or a light arm with two weights, spinning about z. */
function rotor(parent: THREE.Object3D, shape: RotorShape, color: string) {
  const spin = add(parent, new THREE.Group())
  const m = mat(color, { rough: 0.45, metal: 0.2 })
  const mark = mat('#f2f2f2', { rough: 0.5 })
  const disk = cylinder(spin, 1, 1, m, [0, 0, 0], 'z', 48)
  const rim = add(spin, mesh(new THREE.TorusGeometry(1, 0.09, 12, 64), m))
  const spokes = [0, Math.PI / 2].map((a) => {
    const s = box(spin, [2, 0.04, 0.04], mat('#5a5f6a', { rough: 0.6 }))
    s.rotation.z = a
    return s
  })
  const bar = box(spin, [1, 0.25, 0.2], mat('#5a5f6a', { rough: 0.6 }))
  const balls = [1, -1].map(() => add(spin, mesh(new THREE.SphereGeometry(1, 24, 16), m)))
  const stripe = box(spin, [1, 0.22, 0.1], mark)
  cylinder(parent, 0.35, 1.2, mat('#2a2c32', { rough: 0.5 }), [0, 0, -0.7], 'z', 16)
  disk.visible = shape === 'disk'
  rim.visible = shape === 'ring'
  for (const s of spokes) s.visible = shape === 'ring'
  bar.visible = shape === 'arm'
  for (const b of balls) b.visible = shape === 'arm'
  return {
    /** Radius `r` and arm radius `armR` in scene units, ball radius `ball`. */
    size(r: number, armR: number, ball: number) {
      disk.scale.set(r, 0.5, r)
      rim.scale.setScalar(r)
      for (const s of spokes) s.scale.x = r
      bar.scale.x = Math.max(r, armR) * 2
      balls.forEach((b, i) => {
        b.scale.setScalar(ball)
        b.position.x = (i ? -1 : 1) * armR
      })
      const len = shape === 'arm' ? armR : r
      stripe.scale.x = len * 0.9
      stripe.position.set(len * 0.45, 0, shape === 'disk' ? 0.3 : 0.15)
    },
    set: (angle: number) => (spin.rotation.z = -angle),
  }
}

// --- Moment of inertia: same mass as a disk, a ring and two weights on an arm; same torque; α = τ/I race to 3 turns. ---

const MI = { turns: 3, k: 48, y: -0.4, xs: [-14.3, -7.8, -1.3] as const, bars: [5, 2, 0] as V3, w: 3.2, rest: 1.5 }
const SHAPES: { key: RotorShape; name: string; color: string }[] = [
  { key: 'disk', name: 'disk', color: B_FIELD },
  { key: 'ring', name: 'ring', color: HEAT },
  { key: 'arm', name: 'arm + 2 weights', color: DATA_COLOR },
]
const miParams = (p: Params) => ({ kg: n(p, 'mass') / 1000, r: n(p, 'radius') / 100, armR: n(p, 'armR') / 100, tau: n(p, 'torque') / 1000 })
type MiQ = ReturnType<typeof miParams>
const miKey = (q: MiQ) => `${q.kg}|${q.r}|${q.armR}|${q.tau}`
const miRun = memoBy(miKey, (q: MiQ) => {
  const I = rotorInertias(q.kg, q.r, q.armR)
  const race = SHAPES.map((s) => ({ ...s, I: I[s.key], ...spinRace(q.tau, I[s.key], MI.turns) }))
  return { race, end: Math.max(...race.map((r) => r.t)) }
})

export const rotationMomentOfInertia: Lesson = {
  id: 'rotation-moment-of-inertia',
  title: 'Moment of inertia',
  tagline: 'Where the mass sits matters',
  formula: (p) => {
    const q = miParams(p)
    const [d, r, a] = miRun(q).race
    return `I = Σ m r² · disk ½mR² = ${inertia(d.I)} · ring mR² = ${inertia(r.I)} · arm m r² = ${inertia(a.I)} · α = τ / I, θ = ½αt²`
  },
  legend: [
    { color: B_FIELD, label: 'Solid disk: I = ½ m R²', shape: 'dot' },
    { color: HEAT, label: 'Thin ring: I = m R²', shape: 'dot' },
    { color: DATA_COLOR, label: 'Two weights at r on a light arm: I = m r²', shape: 'dot' },
    { color: POWER, label: 'Same torque τ on every shaft', shape: 'dot' },
  ],
  points: [
    'Moment of inertia I is mass for turning: a torque τ gives an angular acceleration α = τ / I, just as F = m a (Newton’s laws › F = m a). Each bit of mass counts as m r², so mass far from the axis counts a lot more than mass near it.',
    'Same mass, three shapes. A ring keeps all of it at the rim: I = m R². A solid disk has much of it near the middle: I = ½ m R², half the ring, so it wins the race. Two weights on a light arm count as m r²: slide them out and I grows with r², double r and it takes 4× the torque for the same spin-up.',
    'With the same torque over the same 3 turns every rotor gets the same work τθ, so all three finish with the same energy ½Iω²: the heavy-to-turn one just finishes later and slower.',
    'For a robot: wheels, pulleys and arm links with mass far out are slow to speed up and stop, and the motor’s own rotor counts through the gearbox as J·N² (Dynamics › Inertia). Keep spinning parts small and light near the rim, unless you want stored energy (Flywheel).',
  ],
  controls: [
    { kind: 'slider', key: 'mass', label: 'Mass of each rotor', min: 50, max: 300, step: 25, initial: 200, format: grams },
    { kind: 'slider', key: 'radius', label: 'Disk and ring radius R', min: 2, max: 6, step: 0.5, initial: 5, format: (v) => `${v.toFixed(1)} cm` },
    { kind: 'slider', key: 'armR', label: 'Weights out on the arm, r', min: 1, max: 6, step: 0.5, initial: 3, format: (v) => `${v.toFixed(1)} cm` },
    { kind: 'slider', key: 'torque', label: 'Torque τ (all three)', min: 5, max: 30, step: 1, initial: 10, format: (v) => `${v} mN·m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const rotors = SHAPES.map((s, i) => {
      const g = add(scene, new THREE.Group(), [MI.xs[i], MI.y, 0])
      g.rotation.x = -0.35
      return { r: rotor(g, s.key, s.color), name: liveLabel(scene, [MI.xs[i], MI.y - 4.4, 1], { size: 0.32, color: s.color }), info: liveLabel(scene, [MI.xs[i], MI.y - 5.1, 1], { size: 0.28, color: GREY }) }
    })
    const pen = dotPen(scene, 300, 0.07)
    const [bx, by] = MI.bars
    addLabel(scene, 'spin now', [bx - 3, by + 0.9, 0.2], LABEL, 0.3, 'left')
    const speeds = countBars(scene, [bx, by, 0], SHAPES.map((s) => s.name.split(' ')[0]), MI.w)
    addLabel(scene, `time to ${MI.turns} turns`, [bx - 3, by - 2.4, 0.2], LABEL, 0.3, 'left')
    const times = countBars(scene, [bx, by - 3.3, 0], SHAPES.map((s) => s.name.split(' ')[0]), MI.w)
    const clock = lapseClock(1e9, 1, 0)
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = miParams(p)
        const { race, end } = miRun(q)
        const t = clock(dt, miKey(q)) % (end + MI.rest)
        const ball = 0.4 + 0.4 * Math.cbrt(q.kg / 0.2)
        pen.begin()
        race.forEach((s, i) => {
          const R = rotors[i]
          R.r.size(q.r * MI.k, q.armR * MI.k, ball)
          R.r.set(raceAngle(s.alpha, t, s.t))
          const done = t >= s.t
          R.name.set(done ? `${s.name} · done` : s.name, s.color)
          R.info.set(`I ${inertia(s.I)} · α ${s.alpha.toFixed(0)} rad/s²`)
          if (!done) for (let j = 0; j <= 10; j++) {
            const a = Math.PI * 0.6 + (j / 10) * 0.9 * Math.PI
            pen.dot([MI.xs[i] + 1.2 * Math.cos(a), MI.y + 1.2 * Math.sin(a), 1.5], POWER, j === 10 ? 2.2 : 1)
          }
        })
        pen.end()
        const w = race.map((s) => s.alpha * Math.min(t, s.t))
        speeds.set(w, w.map(rpm), race.map((s) => s.color), Math.max(...race.map((s) => s.omega)))
        times.set(race.map((s) => (t >= s.t ? s.t : t)), race.map((s) => (t >= s.t ? secs(s.t) : '…')), race.map((s) => s.color), end)
        const first = race.reduce((a, b) => (b.t < a.t ? b : a))
        head.status.set(`Same mass, same torque ${(q.tau * 1000).toFixed(0)} mN·m · race to ${MI.turns} turns from rest`, LABEL)
        head.sub.set(`front view · ${Math.round(q.kg * 1000)} g each · t = ${secs(Math.min(t, end))} · real time`)
        head.event.set(t >= end ? `all done · same energy ${joules(race[0].energy)} each: the slow one turns slower but harder to stop` : `${first.name} leads: least I, most α`, t >= end ? POWER : GREY)
      },
      readouts: (p) => {
        const q = miParams(p)
        const { race } = miRun(q)
        const [d, r, a] = race
        return [
          { label: 'Ring / disk inertia', value: `${(r.I / d.I).toFixed(1)}×` },
          { label: 'Arm / disk inertia', value: `${(a.I / d.I).toFixed(2)}×`, tone: toneOf(a.I < d.I, a.I < r.I) },
          { label: `Time to ${MI.turns} turns: disk / ring / arm`, value: `${secs(d.t)} / ${secs(r.t)} / ${secs(a.t)}` },
          { label: 'Energy at the finish (each) = τθ', value: joules(d.energy) },
        ]
      },
    }
  },
}

// --- Angular momentum: a robot on a turntable pulls its weights in and spins up; a reaction wheel turns the body back. ---

const AM = { k: 44, at: [-9, -1.4, 0] as V3, tilt: 0.8, bars: [3.4, 3, 0] as V3, plot: [6, -3.2, 0] as V3, w: 9, h: 3.6, slowArms: 1, wheelDraw: 0.05 }
const MODES: Record<SpinMode, string> = { arms: 'Arms in and out (L fixed)', wheel: 'Reaction wheel (L = 0)' }
const amParams = (p: Params) => ({ mode: pick(MODES, p.mode, 'arms'), kg: n(p, 'mass') / 1000, spin: n(p, 'spin'), wheel: n(p, 'wheel') })
type AmQ = ReturnType<typeof amParams>
const amKey = (q: AmQ) => `${q.mode}|${q.kg}|${q.spin}|${q.wheel}`
const AM_DT = 0.01
const amRun = memoBy(amKey, (q: AmQ) => {
  const run = spinnerRun(q.mode, q.kg, q.mode === 'arms' ? q.spin : q.wheel, AM_DT)
  const peak = (f: (x: (typeof run)[number]) => number) => Math.max(1e-9, ...run.map((x) => Math.abs(f(x))))
  const iw = 0.5 * q.kg * SPINNER.wheelR ** 2
  return { run, iw, ratio: reactionRatio(SPINNER.bodyKgM2, iw), max: { I: peak((x) => x.inertia), w: peak((x) => x.omega), ke: peak((x) => x.ke), wheel: peak((x) => x.wheel) } }
})

export const rotationAngularMomentum: Lesson = {
  id: 'rotation-angular-momentum',
  title: 'Angular momentum',
  tagline: 'Pull in, spin up',
  formula: (p) => {
    const q = amParams(p)
    const { run, iw, ratio } = amRun(q)
    if (q.mode === 'wheel') return `L = I_b ω_b + I_w (ω_b + ω_w) = 0 → ω_b = −I_w ω_w / (I_b + I_w) · body turns ${(ratio * 100).toFixed(1)} % of the wheel’s turns, backwards · I_w = ${inertia(iw)}`
    const [out, mid] = [run[0], run[Math.round(run.length / 2)]]
    return `L = I ω constant: ${inertia(out.inertia)} × ${rpm(out.omega)} = ${inertia(mid.inertia)} × ${rpm(mid.omega)} · KE = L² / 2I grows ${(mid.ke / out.ke).toFixed(1)}×`
  },
  legend: (p) =>
    amParams(p).mode === 'arms'
      ? [
          { color: B_FIELD, label: 'Moment of inertia I (bar ÷ peak)', shape: 'dot' },
          { color: POWER, label: 'Spin rate ω', shape: 'dot' },
          { color: RING, label: 'Angular momentum L = I ω', shape: 'dot' },
          { color: HEAT, label: 'Kinetic energy ½ I ω²', shape: 'dot' },
        ]
      : [
          { color: B_FIELD, label: 'Reaction wheel speed (relative to the body)', shape: 'dot' },
          { color: POWER, label: 'Body spin ω_b, the other way', shape: 'dot' },
          { color: RING, label: 'Total angular momentum (stays 0)', shape: 'dot' },
        ],
  points: [
    'Angular momentum L = I ω is the turning version of momentum (Collisions). With no outside torque about the axis it cannot change. A spinning skater pulls in her arms: I drops, so ω must rise by the same factor.',
    'Here a robot on a free turntable holds two weights out and is given a spin. As the arms pull in, I falls by up to ~3× and the spin speeds up to match; push them out and it slows again. L stays put; the kinetic energy L² / 2I does not: the arms do work pulling the weights in against the spin.',
    'Start at rest with a wheel on board and L stays at zero. Spin the wheel one way with the robot’s own motor and the body turns the other way, by I_w / (I_b + I_w) of the wheel’s turns. Stop the wheel and the body stops: it has turned without pushing on anything. Satellites point this way; a quadcopter yaws on the same rule, speeding up one pair of props (Drones & flight › Quadcopter mixing).',
    'Robots feel it as reaction torque: a motor speeding up a heavy wheel or arm twists the chassis back. Balancing robots and jumping robots use reaction wheels on purpose (Balancing robots).',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'arms' },
    { kind: 'slider', key: 'mass', label: 'Each hand weight / wheel mass', min: 50, max: 300, step: 25, initial: 200, format: grams },
    { kind: 'slider', key: 'spin', label: 'Starting spin, arms out', min: 10, max: 60, step: 5, initial: 30, format: (v) => `${v} rpm` },
    { kind: 'slider', key: 'wheel', label: 'Reaction wheel top speed', min: 100, max: 1000, step: 50, initial: 500, format: (v) => `${v} rpm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const { g } = tiltRig(scene, AM.at, AM.k, AM.tilt)
    cylinder(g, 0.09, 0.012, mat('#3a3f4a', { rough: 0.8 }), [0, 0, -0.07], 'z', 48)
    cylinder(g, 0.015, 0.05, mat('#7a808c', { metal: 0.5 }), [0, 0, -0.04], 'z', 16)
    const body = add(g, new THREE.Group())
    cylinder(body, 0.065, 0.01, mat('#c9ccd3', { rough: 0.5 }), [0, 0, -0.012], 'z', 48)
    box(body, [0.08, 0.06, 0.05], mat('#2a5bd7', { rough: 0.5 }), [0, 0, 0.02])
    box(body, [0.014, 0.04, 0.016], mat('#f2f2f2', { rough: 0.5 }), [0.045, 0, 0.03])
    const arms = [1, -1].map((s) => {
      const rod = box(body, [0.016, 1, 0.016], mat('#ffd84d', { rough: 0.5 }), [0, 0, 0.04])
      const hand = add(body, mesh(new THREE.SphereGeometry(1, 20, 14), mat('#6b7280', { metal: 0.6, rough: 0.35 })))
      return { s, rod, hand }
    })
    const wheel = add(body, new THREE.Group(), [0, 0, 0.06])
    cylinder(wheel, SPINNER.wheelR, 0.012, mat('#c8803f', { metal: 0.4, rough: 0.4 }), [0, 0, 0], 'z', 40)
    box(wheel, [SPINNER.wheelR * 1.8, 0.008, 0.016], mat('#f2f2f2'), [0, 0, 0.004])
    const pen = dotPen(scene, 200, 0.08)
    const [bx, by] = AM.bars
    const bars = countBars(scene, [bx, by, 0], ['I', 'ω', 'L', 'KE'], 5)
    const plot = plotPanel(scene, AM.plot, AM.w, AM.h, SPINNER.period, '', '', 0.5, 6)
    const plotTitle = liveLabel(scene, [AM.plot[0] - AM.w / 2, AM.plot[1] + AM.h / 2 + 1.1, 0.3], { size: 0.3, align: 'left' })
    const trW = plot.trace(POWER, { samples: 200, radius: 0.06 })
    const trI = plot.trace(B_FIELD, { samples: 200, radius: 0.06 })
    const clock = lapseClock(SPINNER.period, AM.slowArms, 0)
    let shown = ''
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = amParams(p)
        const { run, max } = amRun(q)
        const t = clock(dt, amKey(q)) % SPINNER.period
        const f = fixedStepAt(run, t, AM_DT)
        body.rotation.z = -f.theta
        const isArms = q.mode === 'arms'
        const ball = 0.01 + 0.01 * Math.cbrt(q.kg / 0.2)
        for (const a of arms) {
          const r = isArms ? f.r : SPINNER.armMin
          a.rod.scale.y = r
          a.rod.position.y = (a.s * r) / 2
          a.hand.visible = isArms
          a.hand.scale.setScalar(ball)
          a.hand.position.set(0, a.s * r, 0.04)
        }
        wheel.visible = !isArms
        wheel.rotation.z = -f.wheelAngle * AM.wheelDraw
        pen.begin()
        const sweep = Math.max(-1, Math.min(1, f.omega / max.w)) * Math.PI * 0.8
        for (let j = 0; j <= 12; j++) {
          const a = Math.PI / 2 - (sweep * j) / 12
          pen.dot([AM.at[0] + 7.2 * Math.cos(a), AM.at[1] + 4.2 * Math.sin(a), 3], POWER, j === 12 ? 2.4 : 1.2)
        }
        pen.end()
        if (isArms) {
          bars.set([f.inertia / max.I, Math.abs(f.omega) / max.w, 1, f.ke / max.ke], [inertia(f.inertia), rpm(f.omega), 'constant', joules(f.ke)], [B_FIELD, POWER, RING, HEAT], 1)
          for (const [j, name] of ['I', 'ω', 'L', 'KE'].entries()) bars.rename(j, name)
        } else {
          bars.set([Math.abs(f.wheel) / max.wheel, Math.abs(f.omega) / max.w, 0, f.ke / max.ke], [rpm(f.wheel), rpm(f.omega), '0', joules(f.ke)], [B_FIELD, POWER, RING, HEAT], 1)
          for (const [j, name] of ['wheel', 'body', 'L', 'KE'].entries()) bars.rename(j, name)
        }
        if (shown !== amKey(q)) {
          shown = amKey(q)
          plotTitle.set(isArms ? 'ω (green) and I (blue) over one cycle' : 'body ω (green) and wheel ω (blue), ± peak', LABEL)
        }
        const y = (v: number) => (isArms ? v - 0.5 : v / 2) * AM.h * 0.95
        traceRun(trW, run, AM_DT, SPINNER.period, t, (x) => y(x.omega / max.w))
        traceRun(trI, run, AM_DT, SPINNER.period, t, (x) => y(isArms ? x.inertia / max.I : x.wheel / max.wheel))
        const deg = (f.theta * 180) / Math.PI
        head.status.set(isArms ? `L = I ω = constant · arms ${Math.round(f.r * 100)} cm out` : `L = 0 · body turned ${deg.toFixed(0)}°`, LABEL)
        head.sub.set(`free turntable seen from above the side · t = ${t.toFixed(1)} s of a ${SPINNER.period} s cycle${isArms ? '' : ` · wheel drawn ${1 / AM.wheelDraw}× slower`}`)
        head.event.set(
          isArms
            ? f.r < SPINNER.armMin + 0.01
              ? `arms in: I ÷ ${(run[0].inertia / f.inertia).toFixed(1)}, spin × ${(f.omega / run[0].omega).toFixed(1)}`
              : 'arms out: biggest I, slowest spin'
            : Math.abs(f.wheel) < 1e-6
              ? 'wheel stopped: body stops too, at a new heading'
              : `wheel ${f.wheel > 0 ? 'clockwise' : 'anticlockwise'} → body turns the other way`,
          POWER,
        )
      },
      readouts: (p) => {
        const q = amParams(p)
        const { run, ratio, iw } = amRun(q)
        if (q.mode === 'wheel') {
          const half = run[Math.round(run.length / 2)]
          return [
            { label: 'Wheel / body inertia', value: `${inertia(iw)} / ${inertia(SPINNER.bodyKgM2)}` },
            { label: 'Body turn per wheel turn', value: `${(ratio * 360).toFixed(1)}°` },
            { label: 'Body heading after one push', value: `${((half.theta * 180) / Math.PI).toFixed(0)}°` },
            { label: 'Total L', value: '0 throughout', tone: 'ok' },
          ]
        }
        const [out, mid] = [run[0], run[Math.round(run.length / 2)]]
        return [
          { label: 'I arms out / in', value: `${inertia(out.inertia)} / ${inertia(mid.inertia)}` },
          { label: 'Spin arms out / in', value: `${rpm(out.omega)} / ${rpm(mid.omega)}` },
          { label: 'Angular momentum L', value: `${(out.L * 1000).toFixed(2)} mN·m·s, constant`, tone: 'ok' },
          { label: 'Kinetic energy out / in', value: `${joules(out.ke)} / ${joules(mid.ke)}` },
        ]
      },
    }
  },
}

// --- Flywheel: a ball shooter with no / small / big flywheel; energy ½Iω² per shot, speed sag and spin-up time. ---

const FW = { k: 42, at: [-10, -1.6, 0] as V3, ballR: 0.025, plot: [7.2, 1.2, 0] as V3, w: 11, h: 4.6, bars: [4.6, -4, 0] as V3, draw: 1 / 40, fly: 0.4, flyK: 0.025, rest: 1.5 }
const WHEELS = Object.fromEntries(Object.entries(FLYWHEELS).map(([k, v]) => [k, v.name])) as Record<Flywheel, string>
const fwParams = (p: Params) => ({ fly: pick(WHEELS, p.fly, 'small'), gap: n(p, 'gap'), ballKg: n(p, 'ball') / 1000 })
type FwQ = ReturnType<typeof fwParams>
const fwKey = (q: FwQ) => `${q.fly}|${q.gap}|${q.ballKg}`
const fwRun = memoBy(fwKey, (q: FwQ) => {
  const r = shooterRun(q.fly, q.gap, q.ballKg)
  let a = 0
  const angles = r.frames.map((f) => (a += f.omega * SHOOTER.dt))
  return { ...r, angles }
})

export const rotationFlywheel: Lesson = {
  id: 'rotation-flywheel',
  title: 'Flywheel',
  tagline: 'Spin stores energy',
  formula: (p) => {
    const q = fwParams(p)
    const r = fwRun(q)
    const b = r.balls[0]
    return `E = ½ I ω² = ½ × ${inertia(r.inertia)} × (${SHOOTER.freeRadS} rad/s)² = ${joules(r.stored)} · one ball takes ${joules(b.wheelJ)} (${Math.round((b.wheelJ / r.stored) * 100)} %) · I ω₀ = I ω₁ + m v r`
  },
  legend: [
    { color: POWER, label: 'Wheel speed ω (plot 0…free speed)', shape: 'dot' },
    { color: GREY, label: 'Motor free speed', shape: 'dot' },
    { color: HIGH_V, label: 'A ball leaves: speed drops', shape: 'dot' },
    { color: RING, label: 'Exit speed of each ball', shape: 'dot' },
  ],
  points: [
    'A spinning wheel stores kinetic energy E = ½ I ω². Speed counts squared and I grows with mass far from the axis (Moment of inertia), so a heavy rim spun fast holds a lot. A flywheel is a store you fill slowly and empty fast.',
    'A ball shooter squeezes each ball between a spinning wheel and a hood. The wheel hands the ball its momentum at the rim and slows: I ω₀ = I ω₁ + m v r. With little inertia a heavy ball takes a big bite, so it leaves slow; a flywheel on the same shaft keeps ω, and so the exit speed, nearly the same.',
    'The price is spin-up: the same motor needs I ω_free / τ_stall per time constant to fill a bigger store, here seconds instead of a fraction of one. Fire faster than the motor refills it and every flywheel sags: the flywheel smooths peaks, it cannot beat the motor’s average power (Energy & work).',
    'The same idea smooths a lumpy load elsewhere: a punch, a single-cylinder engine, a hammering robot. Too much spinning mass also fights you when you want to change speed or turn the robot (Angular momentum).',
  ],
  controls: [
    { kind: 'choice', key: 'fly', options: opts(WHEELS), initial: 'small' },
    { kind: 'slider', key: 'gap', label: 'Time between balls', min: 0.1, max: 0.8, step: 0.05, initial: 0.3, format: (v) => `${v.toFixed(2)} s` },
    { kind: 'slider', key: 'ball', label: 'Ball mass', min: 30, max: 250, step: 10, initial: 150, format: grams },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const [ax, ay] = FW.at
    const rig = add(scene, new THREE.Group(), FW.at)
    rig.scale.setScalar(FW.k)
    box(rig, [0.3, 0.012, 0.06], mat('#3a3f4a', { rough: 0.8 }), [0.02, -0.12, -0.04])
    box(rig, [0.02, 0.12, 0.02], mat('#3a3d45', { rough: 0.6 }), [0, -0.06, -0.05])
    const motor = box(rig, [0.05, 0.04, 0.05], mat('#2a2c32', { rough: 0.5 }), [0.07, -0.095, -0.03])
    const spinG = add(rig, new THREE.Group())
    const flyDisk = cylinder(spinG, 1, 0.025, mat('#6b7280', { metal: 0.6, rough: 0.35 }), [0, 0, -0.03], 'z', 48)
    cylinder(spinG, SHOOTER.wheelR, 0.03, mat('#4f6a4f', { rough: 0.9 }), [0, 0, 0], 'z', 48)
    box(spinG, [SHOOTER.wheelR * 1.7, 0.006, 0.034], mat('#f2f2f2'), [0, 0, 0])
    const flyMark = box(spinG, [1, 0.008, 0.028], mat('#d8dbe2'), [0, 0, -0.03])
    const ballMat = mat('#ffb020', { rough: 0.5 })
    const balls = Array.from({ length: SHOOTER.balls }, () => add(rig, mesh(new THREE.SphereGeometry(1, 20, 14), ballMat)))
    const pen = dotPen(scene, 500, 0.06)
    addLabel(scene, 'motor 4:1', [ax + 0.07 * FW.k, ay - 0.135 * FW.k, 2], GREY, 0.28)
    const vTags = Array.from({ length: SHOOTER.balls }, () => liveLabel(scene, [0, 0, 2], { size: 0.28, color: RING }))
    const plot = plotPanel(scene, FW.plot, FW.w, FW.h, SHOOTER.seconds, `wheel speed 0…${rpm(SHOOTER.freeRadS)}`, '', 0, SHOOTER.seconds)
    const trW = plot.trace(POWER, { samples: 300, radius: 0.06 })
    const free = plot.trace(GREY, { samples: 2, radius: 0.03 })
    const [bx, by] = FW.bars
    addLabel(scene, `exit speed per ball (ideal ${mps((SHOOTER.freeRadS * SHOOTER.wheelR) / 2)})`, [bx - 2.6, by + 0.8, 0.2], LABEL, 0.28, 'left')
    const speedBars = countBars(scene, [bx, by, 0], Array.from({ length: SHOOTER.balls }, (_, i) => `#${i + 1}`), 6, { row: 0.5, size: 0.26 })
    const energyTag = liveLabel(scene, [FW.plot[0] + FW.w / 2, FW.plot[1] + FW.h / 2 + 1.1, 0.3], { size: 0.28, color: HEAT, align: 'right' })
    const clock = lapseClock(SHOOTER.seconds, 1, FW.rest)
    const s = SHOOTER.wheelR + FW.ballR * 1.2
    const exitA = Math.PI / 5
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = fwParams(p)
        const r = fwRun(q)
        const t = clock(dt, fwKey(q))
        const i = Math.min(r.frames.length - 1, Math.floor(t / SHOOTER.dt))
        const f = r.frames[i]
        const fw = FLYWHEELS[q.fly]
        flyDisk.visible = flyMark.visible = fw.kg > 0
        flyDisk.scale.set(fw.r || 1e-3, 1, fw.r || 1e-3)
        flyMark.scale.x = fw.r * 1.8
        spinG.rotation.z = -r.angles[i] * FW.draw
        motor.position.y = -0.095 - 0.002 * Math.sin(t * 60) * (f.omega / SHOOTER.freeRadS)
        const fired = r.balls.filter((b) => b.t <= t).length
        const ballS = FW.ballR * (0.8 + 0.4 * Math.cbrt(q.ballKg / 0.15))
        balls.forEach((m, k) => {
          m.scale.setScalar(ballS)
          const b = r.balls[k]
          if (k >= fired) {
            m.visible = k - fired < 2
            m.position.set(-s - (k - fired) * 1.6 * FW.ballR, -(k - fired) * 1.4 * FW.ballR, 0.01)
            vTags[k].set('')
            return
          }
          const age = t - b.t
          m.visible = age < FW.fly
          const d = b.v * age * FW.flyK
          const [x0, y0] = [s * Math.cos(exitA), s * Math.sin(exitA)]
          m.position.set(x0 + d * Math.cos(exitA), y0 + d * Math.sin(exitA) - 0.15 * age * age, 0.01)
          vTags[k].group.position.set(ax + m.position.x * FW.k, ay + m.position.y * FW.k + 1.6, 2)
          vTags[k].set(m.visible ? mps(b.v) : '')
        })
        pen.begin()
        for (let j = 0; j <= 30; j++) {
          const a = Math.PI * 0.95 - (j / 30) * (Math.PI * 0.95 - exitA)
          const R = (SHOOTER.wheelR + 2 * FW.ballR * 1.2 + 0.004) * FW.k
          pen.dot([ax + R * Math.cos(a), ay + R * Math.sin(a), 1.5], GREY, 1.4)
        }
        for (const b of r.balls) {
          const u = b.t / SHOOTER.seconds
          if (b.t <= t) pen.line([FW.plot[0] - FW.w / 2 + u * FW.w, FW.plot[1] - FW.h / 2, 0.3], [FW.plot[0] - FW.w / 2 + u * FW.w, FW.plot[1] + FW.h / 2, 0.3], 0.3, HIGH_V, 0.7)
        }
        pen.end()
        traceRun(trW, r.frames, SHOOTER.dt, SHOOTER.seconds, t, (x) => (x.omega / SHOOTER.freeRadS - 0.5) * FW.h, 300)
        free.points([0, 1], [FW.h / 2 - 0.02, FW.h / 2 - 0.02])
        energyTag.set(`½Iω² ${joules(f.energy)} of ${joules(r.stored)}`)
        speedBars.set(r.balls.map((b) => (b.t <= t ? b.v : 0)), r.balls.map((b) => (b.t <= t ? mps(b.v) : '')), r.balls.map((b) => (b.v > 0.85 * r.ideal ? POWER : b.v > 0.65 * r.ideal ? RING : HIGH_V)), r.ideal)
        head.status.set(`Ball shooter · ${FLYWHEELS[q.fly].name}`, LABEL)
        head.sub.set(`side view · spin-up from rest, ${SHOOTER.balls} balls from ${SHOOTER.fireAt} s · t = ${t.toFixed(2)} s, real time · wheel drawn ${1 / FW.draw}× slower`)
        head.event.set(
          fired === 0
            ? f.omega < 0.95 * SHOOTER.freeRadS
              ? `spinning up: ${Math.round((f.omega / SHOOTER.freeRadS) * 100)} % of free speed (95 % takes ${secs(r.spinUp95)})`
              : 'up to speed, store full'
            : `ball ${fired}: ${mps(r.balls[fired - 1].v)} · wheel at ${Math.round((f.omega / SHOOTER.freeRadS) * 100)} %`,
          fired && r.balls[fired - 1].v < 0.65 * r.ideal ? HIGH_V : POWER,
        )
      },
      readouts: (p) => {
        const r = fwRun(fwParams(p))
        return [
          { label: 'Inertia on the shaft', value: inertia(r.inertia) },
          { label: 'Stored at free speed', value: joules(r.stored) },
          { label: 'First / slowest ball', value: `${mps(r.balls[0].v)} / ${mps(r.worst)}`, tone: toneOf(r.sag < 0.2, r.sag < 0.4) },
          { label: 'Spin-up to 95 %', value: secs(r.spinUp95), tone: toneOf(r.spinUp95 < 1, r.spinUp95 < SHOOTER.fireAt) },
        ]
      },
    }
  },
}
