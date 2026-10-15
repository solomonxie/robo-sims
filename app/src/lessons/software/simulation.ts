import * as THREE from 'three/webgpu'
import {
  Contact,
  DR_SIMS,
  Gap,
  IDEAL,
  Integrator,
  PHYS,
  PHYS_RUN,
  PUSH_WORLD,
  PhysFrame,
  Plant,
  ROUTE,
  TWIN,
  TwinFrame,
  contactOmega,
  contactZeta,
  offRoute,
  physRun,
  randomPlant,
  realPlant,
  realTimeFactor,
  runError,
  stableDt,
  stepCpuMs,
  tuneTwin,
  twinGap,
  twinRun,
} from '../../core/physics'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  flatBox,
  glowBox,
  glowMat,
  lidarRobot,
  liveLabel,
  memoBy,
  moduleBlock,
  pointCloud,
  rayFan,
  rodBetween,
  simClock,
} from '../fx'
import { Lesson, Params, Stage, pick } from '../types'

const choice = <R extends Record<string, string>>(key: string, rec: R, initial: keyof R & string) => ({
  kind: 'choice' as const,
  key,
  options: Object.keys(rec).map((k) => ({ value: k, label: rec[k] })),
  initial,
})

// --- Physics engine: detect → forces → integrate on a robot pushing a box and a dropped stack. ---

const DT = { d05: '0.5 ms step', d1: '1 ms step', d2: '2 ms', d4: '4 ms', d6: '6 ms', d10: '10 ms' }
const DT_S: Record<keyof typeof DT, number> = { d05: 0.0005, d1: 0.001, d2: 0.002, d4: 0.004, d6: 0.006, d10: 0.01 }
const HOW: Record<Integrator, string> = { semi: 'Semi-implicit Euler', euler: 'Explicit Euler' }
const peParams = (p: Params) => ({ dt: DT_S[pick(DT, p.dt, 'd1')], how: pick(HOW, p.how, 'semi') as Integrator })
const peRun = memoBy((p: { dt: number; how: Integrator }) => `${p.dt}|${p.how}`, (p) => physRun(p.dt, p.how))
const peRef = memoBy(() => 'ref', () => physRun(PHYS_RUN.refDt, 'semi'))
const SLOW = 3
const W = { at: [-10.6, -2.6, 0] as V3, k: 6 }
const BOX_C = ['#d8dbe2', '#c8a26a', '#5d7fd6', '#5d7fd6', '#5d7fd6']
const STACK_M = PUSH_WORLD[2].m
const PIPE = ['1 · collide', '2 · forces', '3 · integrate']
const PIPE_X = [-8.9, -3.9, 1.1]
const PIPE_Y = 4.4
/** Last frame before it blew up, or the whole run. */
const shown = (run: PhysFrame[]) => (run[run.length - 1].blown ? run.slice(0, -1) : run)

export const physicsEngine: Lesson = {
  id: 'simulation-physics-engine',
  title: 'Physics engine',
  tagline: 'Detect, push apart, step forward, repeat',
  formula: (p) => {
    const { how } = peParams(p)
    return `each step: contacts → F = k·depth − c·v_n (k ${PHYS.k / 1000} kN/m, c ${PHYS.c} N·s/m), friction ≤ μ·F (μ ${PHYS.mu}) → ${how === 'semi' ? 'v += F/m·dt, then x += v·dt' : 'x += v·dt with the old v, then v += F/m·dt'} · a ${STACK_M} kg box rings at ω = √(k/m) = ${contactOmega(STACK_M).toFixed(0)} rad/s (ζ ${contactZeta(STACK_M).toFixed(2)}): stable only for dt < ${(stableDt(STACK_M, how) * 1000).toFixed(0)} ms, less for a stack`
  },
  legend: [
    { color: FORCE, label: 'Contact (normal) force', shape: 'dot' },
    { color: HEAT, label: 'Friction / wheel drive', shape: 'dot' },
    { color: GREY, label: 'Reference run, 0.1 ms steps', shape: 'dot' },
    { color: HIGH_V, label: 'Blown up: energy out of nowhere', shape: 'dot' },
  ],
  points: [
    'Gazebo, Webots and Isaac Sim all wrap a physics engine (ODE, Bullet, DART, PhysX, MuJoCo) that runs one fixed loop. Each step it finds what touches what (collision detection), works out the forces at every contact, then integrates: new velocities and positions dt later. Gazebo\'s default is a 1 ms step.',
    'Here the contacts are soft, like ODE\'s: two boxes may sink into each other a little, and a spring (k) with a damper (c) pushes them apart in proportion to the depth. Friction at each contact is capped at μ times the normal force. The robot\'s wheels push on the ground the same way, up to their grip.',
    'Every step trusts that forces stay constant for dt. Explicit Euler moves the bodies with the velocity they had at the start of the step; semi-implicit (symplectic) Euler updates the velocity first and moves with the new one. That small reordering keeps the energy of a spring bounded instead of growing each step.',
    'A stiff contact is a fast spring: a 0.5 kg box on 20 kN/m rings at 200 rad/s, a period of 31 ms. Take steps that are a sizeable fraction of that and the integrator overshoots: each bounce comes back harder. Explicit Euler goes at 4 ms here, semi-implicit at 6 ms once the stack lands (the stacked boxes form a stiffer chain). At 10 ms everything explodes.',
    'Smaller steps cost CPU. The real-time factor (RTF) is sim seconds per wall second: Gazebo targets 1× (max_step_size × real_time_update_rate), and when one step takes longer to compute than it simulates, RTF drops below 1. Here a modelled step costs about 0.9 ms of CPU, so 0.5 ms steps run at about 0.5×.',
    'In a .world or .sdf file: <max_step_size>, <real_time_update_rate>, the solver (iters, sor), and per-surface <kp>, <kd>, <mu>. Too-stiff contacts or too-light parts with too-big steps cause jitter and robots that fly off.',
  ],
  controls: [choice('dt', DT, 'd1'), choice('how', HOW, 'semi')],
  build(): Stage {
    const scene = createStage({ span: 34 })
    const w = add(scene, new THREE.Group(), W.at)
    w.scale.setScalar(W.k)
    flatBox(w, [3.7, 0.05, 0.7], mat('#3a3e48', { rough: 0.8 }), [1.55, -0.025, 0])
    const mats = BOX_C.map((c) => mat(c, { rough: 0.6 }, true))
    const bodies = PUSH_WORLD.map((b, i) => {
      const g = add(w, new THREE.Group())
      if (i === 0) {
        box(g, [b.w, b.h * 0.55, 0.32], mats[0], [0, b.h * 0.12, 0])
        for (const x of [-0.13, 0.13]) cylinder(g, 0.065, 0.36, mat('#1c1c1f', { rough: 0.8 }), [x, -b.h / 2 + 0.065, 0], 'z', 20)
        box(g, [0.06, 0.04, 0.2], glowMat(B_FIELD, 0.8), [b.w / 2 - 0.03, b.h * 0.28, 0])
      } else box(g, [b.w, b.h, 0.3], mats[i])
      return g
    })
    const ghosts = PUSH_WORLD.map((b) => glowBox(w, [b.w, b.h, 0.31], [0, 0, 0], GREY, 0.3).mesh)
    addLabel(w, 'robot drives at 0.35 m/s', [0.3, -0.1, 0.4], GREY, 0.06)
    addLabel(w, 'dropped stack', [2.8, -0.1, 0.4], GREY, 0.06)
    const normals = rayFan(w, 24, glowMat(FORCE, 1.2), 0.025)
    const tangents = rayFan(w, 24, glowMat(HEAT, 1.2), 0.025)
    const dots = pointCloud(w, 24, 0.022)

    const pipe = PIPE.map((name, i) => moduleBlock(scene, [PIPE_X[i], PIPE_Y, 0], [4.4, 1.3, 0.4], name))
    const pipeNotes = PIPE_X.map((x) => liveLabel(scene, [x, PIPE_Y - 1.15, 0.3], { size: 0.32 }))
    const pipeM = glowMat(GREY, 0.5)
    for (let i = 0; i < 2; i++) rodBetween(scene, [PIPE_X[i] + 2.2, PIPE_Y, 0], [PIPE_X[i + 1] - 2.2, PIPE_Y, 0], pipeM, 0.08)
    rodBetween(scene, [PIPE_X[2], PIPE_Y + 0.7, 0], [PIPE_X[2], PIPE_Y + 1.3, 0], pipeM, 0.06)
    rodBetween(scene, [PIPE_X[2], PIPE_Y + 1.3, 0], [PIPE_X[0], PIPE_Y + 1.3, 0], pipeM, 0.06)
    rodBetween(scene, [PIPE_X[0], PIPE_Y + 1.3, 0], [PIPE_X[0], PIPE_Y + 0.7, 0], pipeM, 0.06)
    const loopNote = liveLabel(scene, [-11, PIPE_Y + 1.9, 0.3], { size: 0.36, align: 'left' })
    const status = liveLabel(scene, [-10.8, -4.9, 0.3], { size: 0.46, align: 'left' })

    const clock = simClock(PHYS_RUN.every * SLOW, 2.5)
    const st = { f: null as PhysFrame | null, err: 0, blown: false, rtf: 1, wall: 0 }
    return {
      scene,
      view: { center: [-0.6, 1.6, 0], radius: 44, polar: 1.48, azimuth: 0.04 },
      frame(dt, p) {
        const P = peParams(p)
        const full = peRun(P)
        const run = shown(full)
        const ref = peRef(null)
        const i = Math.min(run.length - 1, Math.floor(clock(dt, `${P.dt}|${P.how}`, run.length - 1)))
        const f = run[i]
        const blown = full[full.length - 1].blown && i === run.length - 1
        st.f = f
        st.blown = blown
        st.err = runError(run, ref, i)
        st.rtf = realTimeFactor(P.dt, stepCpuMs(f.bodies.length, f.contacts.length))
        f.bodies.forEach((b, k) => {
          bodies[k].position.set(b.x, b.y, 0)
          ghosts[k].position.set(ref[i].bodies[k].x, ref[i].bodies[k].y, 0)
          if (k) mats[k].emissive.set(blown ? HIGH_V : '#000000')
          if (k) mats[k].emissiveIntensity = blown ? 0.6 : 0
        })
        const cap = (fN: number) => Math.min(0.45, fN * 0.012)
        const on = (c: Contact) => (c.b < 0 ? 1 : -1)
        normals(f.contacts.filter((c) => c.fn > 0.05).map((c): [V3, V3] => [[c.x, c.y, 0.2], [c.x + on(c) * c.nx * cap(c.fn), c.y + on(c) * c.ny * cap(c.fn), 0.2]]))
        tangents(f.contacts.filter((c) => Math.abs(c.ft) > 0.05).map((c): [V3, V3] => [[c.x, c.y, 0.2], [c.x - on(c) * c.ny * cap(c.ft), c.y + on(c) * c.nx * cap(c.ft), 0.2]]))
        f.contacts.forEach((c, k) => dots.set(k, [c.x, c.y, 0.2], HEAT))
        dots.show(f.contacts.length)
        st.wall += dt
        const phase = Math.floor((st.wall * 2) % 3)
        pipe.forEach((b, k) => b(dt, blown ? HIGH_V : k === phase ? RING : GREY, blown ? 0.6 : k === phase ? 1 : 0.15))
        const sumF = f.contacts.reduce((s, c) => s + Math.hypot(c.fn, c.ft), 0)
        pipeNotes[0].set(`${f.contacts.length} contacts · ${(Math.max(0, ...f.contacts.map((c) => c.depth)) * 1000).toFixed(1)} mm deep`, LABEL)
        pipeNotes[1].set(`Σ|F| = ${sumF.toFixed(0)} N`, blown ? HIGH_V : LABEL)
        pipeNotes[2].set(P.how === 'semi' ? 'v += a·dt; x += v·dt' : 'x += v·dt; v += a·dt', LABEL)
        loopNote.set(`one loop per ${(P.dt * 1000).toFixed(1)} ms of sim time · ${Math.round(1 / P.dt)} loops per sim second`, GREY)
        status.set(
          blown
            ? `Blew up at ${full[full.length - 1].t.toFixed(2)} s: energy ${f.energy.toFixed(0)} J and climbing, it started with ${run[0].energy.toFixed(1)} J`
            : `t ${f.t.toFixed(2)} s (${SLOW}× slow motion) · ${HOW[P.how]}, ${(P.dt * 1000).toFixed(1)} ms steps`,
          blown ? HIGH_V : LABEL,
        )
      },
      readouts: () => {
        const f = st.f
        if (!f) return []
        return [
          { label: 'Sim time', value: `${f.t.toFixed(2)} s (1/${SLOW}×)` },
          { label: 'Energy', value: `${f.energy.toFixed(1)} J`, tone: st.blown ? 'bad' : undefined },
          { label: 'Error vs 0.1 ms', value: st.blown ? 'blew up' : `${(st.err * 1000).toFixed(1)} mm`, tone: st.blown ? 'bad' : st.err < 0.005 ? 'ok' : 'warn' },
          { label: 'Real-time factor', value: `${st.rtf.toFixed(2)}×`, tone: st.rtf > 0.99 ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Sim-to-real gap: one controller on the ideal twin and on the real robot; domain randomisation. ---

const GAP: Record<Gap, string> = { none: 'Perfect twin', friction: 'Friction & load', motors: 'Deadband & latency', sensing: 'Noise & wheel slip', all: 'All of them' }
const TUNE = { nominal: 'Tuned on the nominal sim', dr: 'Domain randomisation' }
const tunedFor = memoBy((dr: boolean) => `${dr}`, tuneTwin)
const twinFor = memoBy((p: { gap: Gap; dr: boolean }) => `${p.gap}|${p.dr}`, (p) => {
  const c = tunedFor(p.dr)
  return { c, sim: twinRun(IDEAL, c), real: twinRun(realPlant(p.gap), c, 99) }
})
const drTrails = memoBy((dr: boolean) => `${dr}`, (dr) => Array.from({ length: DR_SIMS }, (_, i) => twinRun(randomPlant(i), tunedFor(dr), i + 1)))
const twParams = (p: Params) => ({ gap: pick(GAP, p.gap, 'all') as Gap, dr: pick(TUNE, p.tune, 'nominal') === 'dr' })
const SPEED = 2
const TW = { at: [-12.6, -2.6, 0] as V3, k: 4.2 }
const ROWS: [string, (q: Plant) => string][] = [
  ['wheel speed / command', (q) => `${(q.gain * 100).toFixed(0)} %`],
  ['motor lag', (q) => `${(q.tau * 1000).toFixed(0)} ms`],
  ['deadband', (q) => `${(q.deadband * 100).toFixed(0)} cm/s`],
  ['command latency', (q) => `${(q.latency * 1000).toFixed(0)} ms`],
  ['turn lost to slip', (q) => `${(q.slip * 100).toFixed(0)} %`],
  ['pose noise', (q) => `${(q.noise * 100).toFixed(0)} cm, ${((q.noiseTh * 180) / Math.PI).toFixed(1)}°`],
]
const trail = (run: TwinFrame[], upto: number, every = 3): [V3, V3][] => {
  const out: [V3, V3][] = []
  for (let k = every; k <= Math.min(upto, run.length - 1); k += every) out.push([[run[k - every].x, run[k - every].y, 0.02], [run[k].x, run[k].y, 0.02]])
  return out
}

export const simToRealGap: Lesson = {
  id: 'simulation-sim-to-real-gap',
  title: 'Sim-to-real gap',
  tagline: 'Same code, different robot',
  formula: (p) => {
    const P = twParams(p)
    const { c, sim, real } = twinFor(P)
    return `pure pursuit: ω = kp × angle to a carrot L ahead on the route, v = ${TWIN.v} m/s · ${P.dr ? `tuned over ${DR_SIMS} randomised sims` : 'tuned on the ideal sim'} → kp ${c.kp}, L ${c.look} m · off the route on average: sim ${(offRoute(sim) * 100).toFixed(1)} cm, real ${(offRoute(real) * 100).toFixed(1)} cm · lap ${sim[sim.length - 1].t.toFixed(1)} s vs ${real[real.length - 1].t.toFixed(1)} s`
  },
  legend: [
    { color: B_FIELD, label: 'Sim twin (ideal plant)', shape: 'dot' },
    { color: HEAT, label: 'Real robot, same code', shape: 'dot' },
    { color: FORCE, label: 'Pose the real controller sees (noisy)', shape: 'dot' },
    { color: GREY, label: 'Randomised sims it was tuned on', shape: 'dot' },
  ],
  points: [
    'A simulator is a model, and the model is always a little wrong. A controller tuned until it is perfect in Gazebo meets a robot whose wheels slip, whose motors ignore small commands, whose commands arrive late and whose pose estimate jitters. The difference in behaviour is the sim-to-real gap.',
    'Both robots run exactly the same code: pure pursuit, steering at a carrot point L metres further along the route with gain kp. The blue twin uses the ideal plant; the orange one gets the mismatch you pick.',
    'Friction and load make the wheels turn slower than commanded and respond later: the real robot is late, but still on the line. A motor deadband (small PWM does nothing) and 200 ms of latency (ROS 2 hops, a slow serial link, a filter) hurt the most: the loop keeps correcting for where the robot was, and a high-gain controller swings around the line.',
    'Tuned on the ideal sim alone, the search picks the sharpest controller (high kp, short L): best in sim, worst on the real robot. Domain randomisation instead tunes over many sims, each with friction, lag, deadband, latency, slip and noise drawn at random around the expected range. The winner is calmer, slightly worse in sim and much better on the robot: the real robot is just one more sample.',
    'Other ways to close the gap: measure the real parameters (system identification) and put them into the URDF/SDF and motor model, add the latency and noise to the sim on purpose, and keep a feedback loop on real sensors so small model errors get corrected instead of integrated.',
  ],
  controls: [choice('gap', GAP, 'all'), choice('tune', TUNE, 'nominal')],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const g = add(scene, new THREE.Group(), TW.at)
    g.rotation.x = -0.5
    g.scale.setScalar(TW.k)
    flatBox(g, [6.8, 2.4, 0.02], mat('#2b2f37', { rough: 0.85 }), [3, 0, -0.012])
    const routeM = glowMat(GREY, 0.5)
    ROUTE.slice(1).forEach((q, i) => rodBetween(g, [ROUTE[i][0], ROUTE[i][1], 0.005], [q[0], q[1], 0.005], routeM, 0.012))
    ROUTE.forEach((q) => cylinder(g, 0.03, 0.14, glowMat(POWER, 0.8), [q[0], q[1], 0.07], 'z', 12))
    addLabel(g, 'start', [0, -0.25, 0.01], GREY, 0.11)
    addLabel(g, 'goal', [6, -0.25, 0.01], POWER, 0.11)
    const simTrail = rayFan(g, 700, glowMat(B_FIELD, 1), 0.025)
    const realTrail = rayFan(g, 700, glowMat(HEAT, 1), 0.025)
    const drTrail = rayFan(g, 2400, glowMat(GREY, 0.35), 0.01)
    const seen = pointCloud(g, 40, 0.022)
    const robots = [B_FIELD, HEAT].map((c, k) => {
      const r = lidarRobot(g, 0.6)
      const tag = add(r.group, new THREE.Group())
      addLabel(tag, k ? 'real' : 'sim', [0, 0.3, 0.05], c, 0.12)
      const ring = add(r.group, new THREE.Mesh(new THREE.RingGeometry(0.15, 0.18, 32), glowMat(c, 1)))
      ring.position.z = 0.01
      return { ...r, tag }
    })
    const rowText = ROWS.map((_, i) => liveLabel(scene, [i < 3 ? -12.6 : 0.6, -8.4 - (i % 3) * 0.95, 0.3], { size: 0.4, align: 'left' }))
    const status = liveLabel(scene, [-12.6, 5.6, 0.3], { size: 0.5, align: 'left' })
    const result = liveLabel(scene, [-12.6, 4.5, 0.3], { size: 0.5, align: 'left' })

    const clock = simClock(TWIN.dt / SPEED, 2.5)
    const st = { i: 0, key: '', run: null as ReturnType<typeof twinFor> | null }
    return {
      scene,
      view: { center: [0, -1.4, 0], radius: 50, polar: 1.42, azimuth: 0.04 },
      frame(dt, p) {
        const P = twParams(p)
        const run = twinFor(P)
        const key = `${P.gap}|${P.dr}`
        const ticks = Math.max(run.sim.length, run.real.length) - 1
        const i = Math.floor(clock(dt, key, ticks))
        if (key !== st.key) drTrail(P.dr ? drTrails(true).flatMap((r) => trail(r, r.length, 5)) : [])
        st.key = key
        st.i = i
        st.run = run
        const sims = [run.sim, run.real]
        sims.forEach((r, k) => {
          const f = r[Math.min(i, r.length - 1)]
          robots[k].group.position.set(f.x, f.y, 0)
          robots[k].group.rotation.z = f.th
          robots[k].tag.rotation.z = -f.th
          robots[k].head.rotation.z -= dt * 10
        })
        simTrail(trail(run.sim, i))
        realTrail(trail(run.real, i))
        const real = realPlant(P.gap)
        const from = Math.max(0, Math.min(i, run.real.length - 1) - 39)
        let n = 0
        if (real.noise > 0) for (let k = from; k <= Math.min(i, run.real.length - 1); k++) seen.set(n++, [run.real[k].mx, run.real[k].my, 0.03], FORCE)
        seen.show(n)
        ROWS.forEach(([name, fmt], k) => {
          const a = fmt(IDEAL)
          const b = fmt(real)
          rowText[k].set(`${name}: ${a}  →  ${b}`, a === b ? GREY : HEAT)
        })
        const t = Math.min(i, ticks) * TWIN.dt
        const done = (r: TwinFrame[]) => i >= r.length - 1
        status.set(`t ${t.toFixed(1)} s (${SPEED}× real time) · kp ${run.c.kp}, L ${run.c.look} m${P.dr ? ` from ${DR_SIMS} random sims` : ' from the ideal sim'}`, LABEL)
        result.set(
          done(run.real) && done(run.sim)
            ? `Lap: sim ${run.sim[run.sim.length - 1].t.toFixed(1)} s, real ${run.real[run.real.length - 1].t.toFixed(1)} s`
            : done(run.sim)
              ? `Sim finished in ${run.sim[run.sim.length - 1].t.toFixed(1)} s · the real robot is still driving`
              : `Gap between the two robots: ${(twinGap(run.sim, run.real, i) * 100).toFixed(0)} cm`,
          done(run.sim) && !done(run.real) ? HEAT : LABEL,
        )
      },
      readouts: () => {
        const run = st.run
        if (!run) return []
        const i = st.i
        const gap = twinGap(run.sim, run.real, i)
        const offR = offRoute(run.real, i + 1)
        return [
          { label: 'Sim time', value: `${(i * TWIN.dt).toFixed(1)} s (${SPEED}×)` },
          { label: 'Sim ↔ real now', value: `${(gap * 100).toFixed(0)} cm`, tone: gap < 0.1 ? 'ok' : gap < 0.4 ? 'warn' : 'bad' },
          { label: 'Real off route', value: `${(offR * 100).toFixed(1)} cm avg`, tone: offR < 0.06 ? 'ok' : offR < 0.1 ? 'warn' : 'bad' },
          { label: 'Sim off route', value: `${(offRoute(run.sim, i + 1) * 100).toFixed(1)} cm avg` },
        ]
      },
    }
  },
}
