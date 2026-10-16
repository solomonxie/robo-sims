import * as THREE from 'three/webgpu'
import {
  BALANCER,
  BalanceFrame,
  DEG,
  Gains,
  balanceLoop,
  catchAccel,
  comOffset,
  fallTau,
  fallTime,
  fellAt,
  fixedStepAt,
  gravityAlpha,
  kpMin,
  toDeg,
  torqueLimit,
} from '../../core/physics'
import { msText, pct } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  IDLE,
  LABEL,
  POWER,
  RING,
  addLabel,
  balanceBot,
  balanceBotHeight,
  emptyGroup,
  flatBox,
  glowMat,
  liveLabel,
  memoBy,
  moduleBlock,
  pointCloud,
  scope,
  smoothstep,
  stretchArrow,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const deg = (a: number, digits = 0) => `${toDeg(a).toFixed(digits)}°`
const mm = (m: number) => `${Math.round(m * 1000)} mm`
const R = BALANCER.wheelR
const NONE: Gains = { kp: 0, ki: 0, kd: 0 }
const TILT: Gains = { kp: 0.05, ki: 0, kd: 0.003 }
const SPEED: Gains = { kp: 5, ki: 2, kd: 0 }
const at = (run: BalanceFrame[], t: number) => fixedStepAt(run, t, BALANCER.dt)
const VIEW = { center: [-2.2, -0.4, 0] as V3, radius: 52, polar: 1.45, azimuth: 0 }
const SCOPE = { x: 6.4, w: 10.5 }

function header(scene: THREE.Object3D) {
  return {
    status: liveLabel(scene, [-17, 6.6, 0.3], { size: 0.42, align: 'left' }),
    sub: liveLabel(scene, [-17, 5.7, 0.3], { size: 0.3, color: GREY, align: 'left' }),
    event: liveLabel(scene, [-17, 4.9, 0.3], { size: 0.32, align: 'left' }),
  }
}

/** Side view in metres: x forward (screen right), z up, −y toward the viewer; a floor whose 0.1 m tape scrolls under a robot that stays put. */
function sideRig(parent: THREE.Object3D, origin: V3, k: number, half: number) {
  const g = add(parent, new THREE.Group(), origin)
  g.scale.setScalar(k)
  g.rotation.x = -Math.PI / 2 + 0.22
  flatBox(g, [2 * half, 0.2, 0.01], glowMat(IDLE, 0.12), [0, 0, -0.005])
  const tapeM = glowMat(GREY, 0.25)
  const tape = Array.from({ length: Math.round(2 * half * 10) }, () => flatBox(g, [0.004, 0.2, 0.004], tapeM, [0, 0, 0.002]))
  const span = tape.length * 0.1
  return {
    g,
    roll(x: number) {
      tape.forEach((b, i) => (b.position.x = ((((i * 0.1 - x) % span) + span) % span) - half))
    },
  }
}
/** Point `up` metres along the body axis above the axle, leaning `tilt`, at depth `y`. */
const onBody = (tilt: number, up: number, y = -0.1, along = 0): V3 => [up * Math.sin(tilt) + along * Math.cos(tilt), y, R + up * Math.cos(tilt) - along * Math.sin(tilt)]

function plotLabels(scene: THREE.Object3D, y: number, h: number, seconds: number | null, left: string, right?: string) {
  if (left) addLabel(scene, left, [SCOPE.x - SCOPE.w / 2, y + h / 2 + 1.1, 0.3], LABEL, 0.3, 'left')
  if (right) addLabel(scene, right, [SCOPE.x + SCOPE.w / 2, y + h / 2 + 1.1, 0.3], LABEL, 0.3, 'right')
  if (seconds === null) return
  addLabel(scene, '0', [SCOPE.x - SCOPE.w / 2, y - h / 2 - 1.1, 0.3], GREY, 0.26, 'left')
  addLabel(scene, `${seconds} s`, [SCOPE.x + SCOPE.w / 2, y - h / 2 - 1.1, 0.3], GREY, 0.26, 'right')
}
/** Draws `value(frame)` (scene units from the centre) from 0 to `now`. */
function plotRun(tr: ReturnType<ReturnType<typeof scope>['trace']>, run: BalanceFrame[], seconds: number, now: number, value: (f: BalanceFrame) => number, samples = 200) {
  const k = Math.max(2, Math.round((Math.min(now, seconds) / seconds) * (samples - 1)) + 1)
  const us: number[] = []
  const ys: number[] = []
  for (let i = 0; i < k; i++) {
    const u = i / (samples - 1)
    us.push(u)
    ys.push(value(at(run, u * seconds)))
  }
  tr.points(us, ys)
}

// --- Why it falls: inverted pendulum on wheels; gravity torque grows with tilt, fall time ∝ √h, wheels driving under the CoM. ---

const WF_MODES = { free: 'Hands off', catch: 'Wheels catch it' }
const WF = { robot: [-10, -7.4, 0] as V3, size: 10.5, sy: -2, sh: 8, slowFree: 0.25, slowCatch: 0.5 }
const wfParams = (p: Params) => ({ catchIt: pick(WF_MODES, p.mode, 'free') === 'catch', h: n(p, 'height') / 1000, th0: n(p, 'tilt') * DEG })
type WfQ = ReturnType<typeof wfParams>
const wfSeconds = (q: WfQ) => (q.catchIt ? 3 : 1.5)
const wfKey = (q: WfQ) => `${q.catchIt}|${q.h}|${q.th0}`
const wfCompute = (q: WfQ) => balanceLoop({ tilt: q.catchIt ? { ...TILT, kd: TILT.kd * Math.sqrt(q.h / BALANCER.h) } : NONE, seconds: wfSeconds(q), start: q.th0, h: q.h })
const wfRun = memoBy(wfKey, wfCompute)
const wfShort = memoBy(wfKey, (q: WfQ) => wfCompute({ ...q, h: q.h / 4 }))
const wfTop = (q: WfQ) => (q.catchIt ? 12 : 60)
/** Wheel acceleration over the step at `t`. */
const accelOf = (run: BalanceFrame[], t: number) => {
  const a = at(run, t)
  const b = at(run, t + BALANCER.dt)
  return b === a ? 0 : (b.v - a.v) / BALANCER.dt
}

export const whyItFalls: Lesson = {
  id: 'balancing-robots-why-it-falls',
  title: 'Why it falls',
  tagline: 'An inverted pendulum: the more it leans, the harder gravity pulls',
  formula: (p) => {
    const q = wfParams(p)
    return `θ̈ = (g·sinθ − a·cosθ) / h · τ = √(h/g) = √(${mm(q.h)} / 9.81) = ${msText(fallTau(q.h))} · ${deg(q.th0)} → 30° in τ·acosh(30°/θ₀) = ${msText(fallTime(q.th0, 30 * DEG, q.h))}`
  },
  legend: [
    { color: RING, label: 'Centre of mass and its tilt (scope)', shape: 'dot' },
    { color: HIGH_V, label: 'Gravity (grey) and its tipping part g·sinθ', shape: 'dot' },
    { color: POWER, label: 'Wheel acceleration a', shape: 'dot' },
    { color: GREY, label: 'Same robot ¼ as tall (scope)', shape: 'dot' },
  ],
  points: [
    'A two-wheeled robot is an inverted pendulum: all its weight sits above the axle. Perfectly upright, gravity points straight through the axle and nothing turns it, but that balance is unstable: lean a little and the weight gets a lever arm h·sinθ, so gravity tilts it further with θ̈ = g·sinθ / h.',
    'The pull grows with the lean, so the fall runs away: near upright θ = θ₀·cosh(t/τ), growing e-fold every τ = √(h/g). From 3° to 30° takes τ·acosh(10) ≈ 3τ, about 0.3 s for a 120 mm CoM. The robot gives the controller only a few τ to react.',
    'Taller is easier: τ grows with √h, so a robot four times as tall falls half as fast (grey trace) and the loop has twice the time. That is why you balance a broom on your hand, not a pencil, and why balancers put the battery on top.',
    'The only push a wheeled robot has is at the floor. Accelerating the wheels forward at a adds −a·cosθ / h: the base runs under the CoM and swings it back. Holding a lean steady needs a = g·tanθ; to stand back up it must drive harder than that, then ease off. The next lesson closes that loop with the IMU tilt (see Complementary filter).',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(WF_MODES), initial: 'free' },
    { kind: 'slider', key: 'height', label: 'CoM height h', min: 80, max: 400, step: 10, initial: 120, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'tilt', label: 'Starting tilt θ₀', min: 1, max: 10, step: 1, initial: 3, format: (v) => `${v}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = header(scene)
    const holder = add(scene, new THREE.Group())

    const plot = scope(scene, SCOPE.w, WF.sh, { divs: [6, 8], zeroAt: 0.25 })
    plot.group.position.set(SCOPE.x, WF.sy, 0)
    const tr = plot.trace(RING, { samples: 200 })
    const short = plot.trace(GREY, { samples: 200, radius: 0.09 })
    addLabel(scene, '0', [SCOPE.x - SCOPE.w / 2, WF.sy - WF.sh / 2 - 1.1, 0.3], GREY, 0.26, 'left')
    const tags = [liveLabel(scene, [SCOPE.x + SCOPE.w / 2, WF.sy - WF.sh / 2 - 1.1, 0.3], { size: 0.26, color: GREY, align: 'right' }), liveLabel(scene, [SCOPE.x - SCOPE.w / 2, WF.sy + WF.sh / 2 + 1.1, 0.3], { size: 0.3, align: 'left' })]

    let rig: ReturnType<typeof makeRig> | null = null
    function makeRig(h: number) {
      emptyGroup(holder)
      const k = WF.size / (R + balanceBotHeight(h) + 0.03)
      const side = sideRig(holder, WF.robot, k, 13 / k)
      const bot = balanceBot(side.g, { h })
      const com = pointCloud(side.g, 1, 0.08 * h)
      const grav = stretchArrow(side.g, GREY, 0.02 * h)
      const tip = stretchArrow(side.g, HIGH_V, 0.014 * h)
      const push = stretchArrow(side.g, POWER, 0.014 * h)
      return { h, side, bot, com, grav, tip, push }
    }

    const st = { key: '', t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = wfParams(p)
        const run = wfRun(q)
        const T = wfSeconds(q)
        const top = wfTop(q)
        const yPlot = (a: number) => (toDeg(a) / top) * (WF.sh * 0.75) - WF.sh * 0.25
        if (!rig || rig.h !== q.h) rig = makeRig(q.h)
        if (wfKey(q) !== st.key) {
          st.key = wfKey(q)
          st.t = 0
          plotRun(short, wfShort(q), T, T, (f) => yPlot(f.tilt))
          tags[0].set(`${T} s`)
          tags[1].set(`tilt θ over time · top line ${top}°`, LABEL)
        }
        const slow = q.catchIt ? WF.slowCatch : WF.slowFree
        st.t += dt * slow
        if (st.t > T + 0.6) st.t = 0
        const t = Math.min(st.t, T)
        const f = at(run, t)
        const { bot, side, com, grav, tip, push, h } = rig
        bot.set(f.tilt, f.x)
        side.roll(f.x)
        const c = onBody(f.tilt, h)
        com.set(0, c, RING, 1)
        com.show(1)
        const L = 0.45 * h
        grav(c, [c[0], c[1], c[2] - L])
        const s = Math.sin(f.tilt)
        tip(c, [c[0] + L * 1.6 * s * Math.cos(f.tilt), c[1], c[2] - L * 1.6 * s * Math.sin(f.tilt)])
        const a = q.catchIt ? accelOf(run, t) : 0
        push([0, -0.1, 0.004], [(a / 14) * 2 * h, -0.1, 0.004])
        plotRun(tr, run, T, t, (g) => yPlot(g.tilt))

        status.set(q.catchIt ? `Wheels catch it · CoM ${mm(h)} high` : `Hands off, wheels held · CoM ${mm(h)} high`, LABEL)
        if (f.fallen) event.set(`on the floor after ${(fellAt(run) ?? 0).toFixed(2)} s`, HIGH_V)
        else if (q.catchIt && Math.abs(a) < 0.05) event.set(`tilt ${deg(f.tilt, 1)} · caught: the wheels just coast`, POWER)
        else if (q.catchIt) event.set(`tilt ${deg(f.tilt, 1)} · wheels ${a >= 0 ? 'drive forward' : 'brake'} ${Math.abs(a).toFixed(1)} m/s² under the CoM`, Math.abs(f.tilt) < 0.5 * DEG ? POWER : RING)
        else event.set(`tilt ${deg(f.tilt, 1)} · gravity adds ${Math.round(toDeg(gravityAlpha(f.tilt, h)))} °/s² of tilt rate`, f.tilt > 30 * DEG ? HIGH_V : HEAT)
        sub.set(`${t.toFixed(2)} / ${T} s · slowed ${1 / slow}× · tape every 100 mm`)
      },
      readouts: (p) => {
        const q = wfParams(p)
        return [
          { label: 'Time constant τ = √(h/g)', value: msText(fallTau(q.h)) },
          { label: `${deg(q.th0)} → 30°: this · ¼ as tall`, value: `${msText(fallTime(q.th0, 30 * DEG, q.h))} · ${msText(fallTime(q.th0, 30 * DEG, q.h / 4))}`, tone: 'warn' },
          { label: 'Gravity tilt accel at θ₀', value: `${Math.round(toDeg(gravityAlpha(q.th0, q.h)))} °/s²` },
          { label: 'Wheel accel to hold θ₀: g·tanθ', value: `${catchAccel(q.th0).toFixed(2)} m/s²` },
        ]
      },
    }
  },
}
// --- Tilt PID: P/I/D on tilt error → wheel torque; low P falls, high P oscillates, D damps, I and an off-centre battery. ---

const TP = { robot: [-10, -7.4, 0] as V3, k: 38, sy: -2.2, sh: 8.4, seconds: 7, start: 5 * DEG, push: 3.5, kick: 1.2, tiltMax: 10, slow: 0.5 }
const tpParams = (p: Params) => ({ g: { kp: n(p, 'kp') / 100, kd: n(p, 'kd') / 100, ki: n(p, 'ki') / 100 }, shift: n(p, 'battery') / 1000 })
type TpQ = ReturnType<typeof tpParams>
const tpKey = (q: TpQ) => `${q.g.kp}|${q.g.kd}|${q.g.ki}|${q.shift}`
const tpRun = memoBy(tpKey, (q: TpQ) =>
  balanceLoop({ tilt: q.g, seconds: TP.seconds, start: TP.start, offset: comOffset(q.shift), pushes: [{ at: TP.push, kick: TP.kick }] }),
)
function tpOutcome(run: BalanceFrame[]): { value: string; tone: 'ok' | 'warn' | 'bad' } {
  const fell = fellAt(run)
  if (fell !== null) return { value: `falls at ${fell.toFixed(1)} s`, tone: 'bad' }
  const tail = run.filter((f) => f.t > TP.seconds - 1).map((f) => f.tilt)
  if (Math.max(...tail) - Math.min(...tail) > 1 * DEG) return { value: 'still wobbling', tone: 'warn' }
  const v = run[run.length - 1].v
  if (Math.abs(v) > 0.15) return { value: `balances, drifting ${v.toFixed(2)} m/s`, tone: 'warn' }
  return { value: 'balances', tone: 'ok' }
}

export const tiltPid: Lesson = {
  id: 'balancing-robots-tilt-pid',
  title: 'Tilt PID',
  tagline: 'Turn the measured lean into wheel torque, fast',
  formula: (p) => {
    const { g } = tpParams(p)
    return `u = Kp·θ + Ki·∫θ dt + Kd·θ̇ = ${(g.kp * 100).toFixed(1)} %/°·θ + ${(g.ki * 100).toFixed(0)} %/(°·s)·∫θ + ${(g.kd * 100).toFixed(2)} %/(°/s)·θ̇ · stands up only if Kp > g/aMax = ${(kpMin() * 100).toFixed(1)} %/°`
  },
  legend: [
    { color: RING, label: 'Tilt θ (scope: ±10°)', shape: 'dot' },
    { color: POWER, label: 'Motor torque command u (±100 %)', shape: 'dot' },
    { color: HEAT, label: 'Push at 3.5 s', shape: 'dot' },
    { color: HIGH_V, label: 'Command clipped: motors at their limit', shape: 'dot' },
  ],
  points: [
    'The MPU-6050 gives tilt θ (fused, see Complementary filter) and tilt rate θ̇ (gyro) every 5 ms. A PID turns them into a wheel torque command: lean forward, drive forward. Here Kp is torque per degree of tilt; the motors give 14 m/s² at full torque.',
    'P is the spring. It must out-push gravity: aMax·Kp > g, so below ~1.2 %/° the wheels lose the race and it falls. Raise it and it stands, but alone it only trades tilt for speed: it swings through upright and back, and the motors lag 30 ms behind, so a big Kp overshoots more each swing and topples (try Kd = 0).',
    'D is the damper. It uses the gyro rate directly, so it brakes the swing before the tilt gets big: Kp 5 %/° with Kd 0.3 %/(°/s) settles a 5° start and a shove in a few wobbles. It ends upright but still rolling: the tilt loop never sees speed. Too much D amplifies gyro noise on the real robot; this model is noise-free.',
    'I sums the leftover error. Shift the battery forward and the CoM is off the axle: zero tilt is no longer balanced, so a P+D robot settles leaning back and rolls off. Adding I does zero that lean, but the robot then has to keep accelerating to hold it and runs away until back-EMF takes its torque. The real fix is an outer speed loop (next lesson); the Control section covers PID tuning in general.',
  ],
  controls: [
    { kind: 'slider', key: 'kp', label: 'Kp', min: 0, max: 30, step: 0.5, initial: 5, format: (v) => `${v.toFixed(1)} %/°` },
    { kind: 'slider', key: 'kd', label: 'Kd', min: 0, max: 0.8, step: 0.05, initial: 0.3, format: (v) => `${v.toFixed(2)} %/(°/s)` },
    { kind: 'slider', key: 'ki', label: 'Ki', min: 0, max: 20, step: 1, initial: 0, format: (v) => `${v} %/(°·s)` },
    { kind: 'slider', key: 'battery', label: 'Battery off-centre', min: 0, max: 20, step: 1, initial: 0, format: (v) => `${v} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = header(scene)
    const side = sideRig(scene, TP.robot, TP.k, 0.26)
    let bot = balanceBot(side.g)
    const com = pointCloud(side.g, 1, 0.009)
    const shove = stretchArrow(side.g, HEAT, 0.004)
    const torque = stretchArrow(side.g, POWER, 0.004)

    const plot = scope(scene, SCOPE.w, TP.sh, { divs: [7, 6] })
    plot.group.position.set(SCOPE.x, TP.sy, 0)
    const cmdTr = plot.trace(POWER, { samples: 200, radius: 0.09 })
    const tiltTr = plot.trace(RING, { samples: 200 })
    plotLabels(scene, TP.sy, TP.sh, TP.seconds, 'tilt θ ±10°', 'motor u ±100 %')
    const yTilt = (a: number) => (toDeg(a) / TP.tiltMax) * (TP.sh / 2)
    const yCmd = (u: number) => u * (TP.sh / 2)

    const st = { key: '', t: 0, shift: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = tpParams(p)
        const run = tpRun(q)
        if (tpKey(q) !== st.key) {
          st.key = tpKey(q)
          st.t = 0
          if (q.shift !== st.shift) {
            st.shift = q.shift
            emptyGroup(bot.group)
            bot.group.removeFromParent()
            bot = balanceBot(side.g, { shift: q.shift })
          }
        }
        st.t += dt * TP.slow
        if (st.t > TP.seconds + 0.8) st.t = 0
        const t = Math.min(st.t, TP.seconds)
        const f = at(run, t)
        bot.set(f.tilt, f.x)
        side.roll(f.x)
        const c = onBody(f.tilt + comOffset(q.shift), BALANCER.h)
        com.set(0, c, RING, 1)
        com.show(1)
        const hit = t >= TP.push && t < TP.push + 0.3
        const top = onBody(f.tilt, BALANCER.h * 1.6, -0.1, -0.05)
        shove(hit ? [top[0] - 0.08, top[1], top[2]] : top, top)
        torque([0, -0.1, 0.004], [f.got * 0.12, -0.1, 0.004], f.sat ? HIGH_V : POWER)
        plotRun(tiltTr, run, TP.seconds, t, (g) => yTilt(g.tilt))
        plotRun(cmdTr, run, TP.seconds, t, (g) => yCmd(g.got))

        status.set(`P ${pct(f.p)} + I ${pct(f.i)} + D ${pct(f.d)} = u ${pct(f.cmd)}`, LABEL)
        if (f.fallen) event.set(`fell at ${(fellAt(run) ?? 0).toFixed(1)} s`, HIGH_V)
        else if (hit) event.set('shoved forward: tilt rate jumps', HEAT)
        else if (f.sat) event.set(`tilt ${deg(f.tilt, 1)} · motors at their limit: u clipped to ${pct(f.got)}`, HIGH_V)
        else event.set(`tilt ${deg(f.tilt, 1)} · wheels ${f.v >= 0 ? 'forward' : 'back'} ${Math.abs(f.v).toFixed(2)} m/s`, Math.abs(f.tilt) < 1 * DEG ? POWER : RING)
        sub.set(`${t.toFixed(1)} / ${TP.seconds} s · slowed ${1 / TP.slow}× · loop 200 Hz · starts at ${deg(TP.start)}`)
      },
      readouts: (p) => {
        const q = tpParams(p)
        const run = tpRun(q)
        const after = run.filter((f) => f.t >= TP.push && f.t < TP.push + 1.5)
        const end = run[run.length - 1]
        return [
          { label: 'Outcome', ...tpOutcome(run) },
          { label: 'Peak tilt after the push', value: after[0].fallen ? '—' : deg(Math.max(...after.map((f) => Math.abs(f.tilt))), 1) },
          { label: `Lean · speed at ${TP.seconds} s`, value: end.fallen ? 'on the floor' : `${deg(end.tilt, 1)} · ${end.v.toFixed(2)} m/s` },
          { label: 'Kp to beat gravity', value: `> ${(kpMin() * 100).toFixed(1)} %/°`, tone: q.g.kp > kpMin() ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- Self-balancing car: ESP32 + MPU-6050; speed PI → target tilt → tilt PD → torque; lean to drive, push recovery, saturation. ---

const SB = { robot: [-10, -7.4, 0] as V3, k: 38, seconds: 10, push: 1.5, go: 3.5, stop: 7, ramp: 1, slow: 0.5, shift: 0.015, sy: [-0.9, -7.2], sh: 4.2, by: 3.5, vMax: 1, tiltMax: 15 }
const sbParams = (p: Params) => ({ vt: n(p, 'speed'), kick: n(p, 'push') * DEG, supply: n(p, 'battery') / 100 })
type SbQ = ReturnType<typeof sbParams>
const sbKey = (q: SbQ) => `${q.vt}|${q.kick}|${q.supply}`
const sbDrive = (vt: number) => (t: number) => vt * (smoothstep((t - SB.go) / SB.ramp) - smoothstep((t - SB.stop) / SB.ramp))
const sbRun = memoBy(sbKey, (q: SbQ) =>
  balanceLoop({ tilt: TILT, speed: SPEED, drive: sbDrive(q.vt), seconds: SB.seconds, offset: comOffset(SB.shift), pushes: [{ at: SB.push, kick: q.kick }], supply: q.supply }),
)
const sbBot = (q: SbQ) => ({ ...BALANCER, vMax: BALANCER.vMax * q.supply })
const sbHeadroom = (q: SbQ) => torqueLimit(1, q.vt, sbBot(q))

export const selfBalancingCar: Lesson = {
  id: 'balancing-robots-self-balancing-car',
  title: 'Self-balancing car',
  tagline: 'Two loops: speed sets the lean, tilt sets the torque',
  formula: (p) => {
    const q = sbParams(p)
    return `θ_target = ${SPEED.kp}°/(m/s)·(v_set − v) + ${SPEED.ki}°/m·∫(v_set − v) dt · u = ${TILT.kp * 100} %/°·(θ − θ_target) + ${TILT.kd * 100} %/(°/s)·θ̇ · torque left at ${q.vt.toFixed(1)} m/s: 1 − v/v_free = ${pct(Math.max(0, sbHeadroom(q)))}`
  },
  legend: [
    { color: B_FIELD, label: 'Set points: speed v_set, target tilt', shape: 'dot' },
    { color: RING, label: 'Measured: speed v, tilt θ', shape: 'dot' },
    { color: POWER, label: 'Motor torque (red: clipped)', shape: 'dot' },
    { color: HEAT, label: 'Push', shape: 'dot' },
  ],
  points: [
    'A real self-balancer (ESP32, MPU-6050, two geared motors, 2×18650 on top) runs two loops. The fast inner loop is the tilt PD from the last lesson, every 5 ms. Around it a slower speed loop does not touch the motors: it picks the tilt the inner loop should hold.',
    'To speed up, lean forward. The speed loop asks for a forward target tilt; to get there the inner loop first rolls the wheels back a touch, then chases the lean, and holding a lean takes a = g·tanθ. To slow down it leans back, which brakes. At a steady speed no push is needed, so it cruises back at its balance point (plus a little for friction on a real floor).',
    'The speed loop\'s I term finds the true balance point. This battery sits 15 mm forward, so the CoM is off the axle: the outer integral settles the target tilt near −3°, and the car stands still with the CoM over the wheels. This is the lean the tilt loop\'s own I could not fix.',
    'A push tips it forward: the inner loop drives under it, then the speed loop leans it back to stop and return. But every catch needs torque, and back-EMF leaves only 1 − v/v_free of it at speed v. A hard push, a fast cruise or a flat battery hits the limit (red), and once the wheels cannot outrun the fall, it is down.',
  ],
  controls: [
    { kind: 'slider', key: 'speed', label: 'Cruise speed v_set', min: 0, max: 0.9, step: 0.05, initial: 0.4, format: (v) => `${v.toFixed(2)} m/s` },
    { kind: 'slider', key: 'push', label: 'Push (tilt rate kick)', min: 0, max: 240, step: 10, initial: 80, format: (v) => `${v} °/s` },
    { kind: 'slider', key: 'battery', label: 'Battery charge', min: 40, max: 100, step: 5, initial: 100, format: (v) => `${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = header(scene)
    const side = sideRig(scene, SB.robot, SB.k, 0.26)
    const bot = balanceBot(side.g, { shift: SB.shift })
    const com = pointCloud(side.g, 1, 0.009)
    const shove = stretchArrow(side.g, HEAT, 0.004)
    const torque = stretchArrow(side.g, POWER, 0.004)
    const aim = stretchArrow(side.g, B_FIELD, 0.0018)

    const blocks = [-1, 0, 1].map((i) => moduleBlock(scene, [SCOPE.x + i * 3.65, SB.by, 0], [3.2, 1.1, 0.4], ''))
    for (const x of [SCOPE.x - 1.82, SCOPE.x + 1.82]) stretchArrow(scene, GREY, 0.05)([x - 0.2, SB.by, 0.3], [x + 0.25, SB.by, 0.3])
    const plots = SB.sy.map((y, i) => {
      const s = scope(scene, SCOPE.w, SB.sh, { divs: [10, 4], zeroAt: i === 0 ? 0.25 : 0.5 })
      s.group.position.set(SCOPE.x, y, 0)
      return s
    })
    const vSet = plots[0].trace(B_FIELD, { samples: 200, radius: 0.08 })
    const vTr = plots[0].trace(RING, { samples: 200 })
    const tSet = plots[1].trace(B_FIELD, { samples: 200, radius: 0.08 })
    const tTr = plots[1].trace(RING, { samples: 200 })
    plotLabels(scene, SB.sy[0], SB.sh, null, 'speed · top line 1 m/s')
    plotLabels(scene, SB.sy[1], SB.sh, SB.seconds, 'tilt ±15°')
    const ySpeed = (v: number) => (v / SB.vMax) * SB.sh * 0.75 - SB.sh * 0.25
    const yTilt = (a: number) => (toDeg(a) / SB.tiltMax) * (SB.sh / 2)

    const st = { key: '', t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = sbParams(p)
        const run = sbRun(q)
        if (sbKey(q) !== st.key) {
          st.key = sbKey(q)
          st.t = 0
        }
        st.t += dt * SB.slow
        if (st.t > SB.seconds + 0.8) st.t = 0
        const t = Math.min(st.t, SB.seconds)
        const f = at(run, t)
        const drive = sbDrive(q.vt)
        const balance = comOffset(SB.shift)
        bot.set(f.tilt, f.x)
        side.roll(f.x)
        com.set(0, onBody(f.tilt + comOffset(SB.shift), BALANCER.h), RING, 1)
        com.show(1)
        const hit = q.kick > 0 && t >= SB.push && t < SB.push + 0.3
        const top = onBody(f.tilt, BALANCER.h * 1.6, -0.1, -0.05)
        shove(hit ? [top[0] - 0.08, top[1], top[2]] : top, top)
        torque([0, -0.1, 0.004], [f.got * 0.12, -0.1, 0.004], f.sat ? HIGH_V : POWER)
        aim(onBody(f.target, 0.03, -0.11), onBody(f.target, f.fallen ? 0.03 : 0.22, -0.11))

        plotRun(vSet, run, SB.seconds, t, (g) => ySpeed(drive(g.t)))
        plotRun(vTr, run, SB.seconds, t, (g) => ySpeed(g.v))
        plotRun(tSet, run, SB.seconds, t, (g) => yTilt(g.target))
        plotRun(tTr, run, SB.seconds, t, (g) => yTilt(g.tilt))
        const on = f.fallen ? 0 : 1
        blocks[0](dt, B_FIELD, on, `speed ${deg(f.target, 1)}`)
        blocks[1](dt, RING, on, `tilt ${pct(f.cmd)}`)
        blocks[2](dt, f.sat ? HIGH_V : POWER, on, `${f.sat ? 'clip' : 'motor'} ${pct(f.got)}`)

        status.set(`set ${drive(t).toFixed(2)} m/s · v ${f.v.toFixed(2)} m/s · target tilt ${deg(f.target, 1)} · tilt ${deg(f.tilt, 1)}`, LABEL)
        if (f.fallen) event.set(`down at ${(fellAt(run) ?? 0).toFixed(1)} s: the motors could not outrun the fall`, HIGH_V)
        else if (hit) event.set('pushed: the wheels drive under it, then lean it back to stop', HEAT)
        else if (f.sat) event.set(`torque clipped: back-EMF leaves ${pct(torqueLimit(1, Math.abs(f.v), sbBot(q)))} at this speed`, HIGH_V)
        else if (Math.abs(drive(t) - f.v) > 0.06) event.set(`${drive(t) > f.v ? 'speeding up' : 'slowing'}: leaning ${deg(Math.abs(f.tilt + balance), 1)} ${f.tilt + balance > 0 ? 'ahead of' : 'behind'} the balance point`, B_FIELD)
        else if (drive(t) > 0.01) event.set(`cruising: back at the balance point ${deg(-balance, 1)}, no torque needed`, POWER)
        else event.set(`holding still: CoM over the axle at ${deg(f.tilt, 1)}`, POWER)
        sub.set(`${t.toFixed(1)} / ${SB.seconds} s · slowed ${1 / SB.slow}× · battery ${mm(SB.shift)} forward`)
      },
      readouts: (p) => {
        const q = sbParams(p)
        const run = sbRun(q)
        const fell = fellAt(run)
        const after = run.filter((f) => f.t >= SB.push && f.t < SB.go)
        const cruise = run.filter((f) => f.t > SB.go + SB.ramp + 1 && f.t < SB.stop)
        return [
          { label: 'Outcome', value: fell !== null ? `falls at ${fell.toFixed(1)} s` : 'stays up', tone: fell !== null ? 'bad' : 'ok' },
          { label: 'Peak tilt after the push', value: after[0].fallen ? '—' : deg(Math.max(...after.map((f) => Math.abs(f.tilt))), 1) },
          { label: 'Lean the speed I found · true', value: `${cruise.length && !cruise[0].fallen ? deg(cruise.reduce((s, f) => s + f.target, 0) / cruise.length, 1) : '—'} · ${deg(-comOffset(SB.shift), 1)}` },
          { label: 'Torque left at cruise', value: pct(Math.max(0, sbHeadroom(q))), tone: sbHeadroom(q) > 0.4 ? 'ok' : sbHeadroom(q) > 0.15 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}
