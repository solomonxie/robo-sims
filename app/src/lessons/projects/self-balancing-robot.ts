import * as THREE from 'three/webgpu'
import {
  BALANCER,
  BASE_TEST,
  BAL_IMU,
  BAL_SPEED,
  BAL_TILT,
  BalGear,
  BalanceFrame,
  DEG,
  GYRO_RANGES,
  PackDeck,
  READ_TEST,
  TUNE,
  TUNE_STAGES,
  TUNE_VERDICTS,
  TiltFilter,
  TuneGains,
  TuneStage,
  TuneVerdict,
  balBody,
  balGroups,
  baseRun,
  compAlpha,
  compBiasError,
  fixedStepAt,
  gyroBias,
  maxShove,
  packZ,
  shoveKick,
  tiltReadRun,
  toDeg,
  tuneOffset,
  tuneRun,
  tuneSheet,
} from '../../core/physics'
import { fixedText, mmText, msText, pct } from '../../core/units'
import { V3 } from '../../models/kit'

import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  SIDE_SCOPE,
  SIDE_VIEW,
  addLabel,
  addRod,
  balanceBot,
  balanceFloor,
  countBars,
  emptyGroup,
  glowMat,
  headerStage,
  lapseClock,
  memoBy,
  onBalancer,
  pointCloud,
  scopeLabels,
  sideScope,
  stretchArrow,
  stretchRod,
  textRows,
  toneColor,
  traceRun,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const deg = (a: number, digits = 0) => `${fixedText(toDeg(a), digits)}°`
const at = (run: BalanceFrame[], t: number) => fixedStepAt(run, t, BALANCER.dt)
const ROBOT: V3 = [-10, -7.4, 0]
const K = 38
type Bot = ReturnType<typeof balanceBot>

/** Shove and wheel-torque arrows and a CoM dot on a `balanceFloor` group. */
function robotCues(g: THREE.Object3D) {
  const com = pointCloud(g, 1, 0.009)
  const shove = stretchArrow(g, HEAT, 0.004)
  const torque = stretchArrow(g, POWER, 0.004)
  return (f: BalanceFrame, comUp: number, offset: number, pushed: boolean) => {
    com.set(0, onBalancer(f.tilt + offset, comUp), RING, 1)
    com.show(1)
    const top = onBalancer(f.tilt, BALANCER.h * 1.6, -0.1, -0.05)
    shove(pushed ? [top[0] - 0.08, top[1], top[2]] : top, top)
    torque([0, -0.1, 0.004], [f.got * 0.12, -0.1, 0.004], f.sat ? HIGH_V : POWER)
  }
}
function swapBot(old: Bot | null, g: THREE.Object3D, o: Parameters<typeof balanceBot>[1]) {
  if (old) {
    emptyGroup(old.group)
    old.group.removeFromParent()
  }
  return balanceBot(g, o)
}

// --- Build the base: pack deck sets the CoM and pendulum length, the gearbox trades torque for top speed; a shove test. ---

const DECKS = { bottom: 'Pack on the bottom deck', middle: 'Pack on the middle deck', top: 'Pack on the top deck' }
const DECK_OF: Record<keyof typeof DECKS, PackDeck> = { bottom: 0, middle: 1, top: 2 }
const GEARS: Record<BalGear, string> = { tt48: 'TT 1:48 gearbox', tt120: 'TT 1:120 gearbox' }
const BB = { sy: 1.4, sh: 4.6, tiltMax: 15, bars: [SIDE_SCOPE.x - 3.4, -3.5, 0] as V3, slow: 0.5 }
const bbParams = (p: Params) => ({ deck: DECK_OF[pick(DECKS, p.deck, 'top') as keyof typeof DECKS], gear: pick(GEARS, p.gear, 'tt48') as BalGear, J: n(p, 'shove') / 1000 })
type BbQ = ReturnType<typeof bbParams>
const bbKey = (q: BbQ) => `${q.deck}|${q.gear}|${q.J}`
const bbRun = memoBy(bbKey, (q: BbQ) => baseRun(q.deck, q.gear, q.J))
const bbMax = memoBy((q: BbQ) => `${q.deck}|${q.gear}`, (q: BbQ) => maxShove(q.deck, q.gear))
const mNs = (J: number) => `${Math.round(J * 1000)} mN·s`

export const selfBalancingRobotBuildTheBase: Lesson = {
  id: 'self-balancing-robot-build-the-base',
  title: 'Build the base',
  tagline: 'Stack the decks: where the battery goes and which gearbox decide how hard a shove it survives',
  formula: (p) => {
    const q = bbParams(p)
    const { body, motors } = bbRun(q)
    return `h = Σm·z / Σm = ${mmText(body.h)} · L = Σm·z² / Σm·z = ${mmText(body.L)} · τ = √(L/g) = ${msText(body.tau)} · shove ${mNs(q.J)} at the top deck → Δθ̇ = J·z / (m·h·L) = ${Math.round(toDeg(shoveKick(q.deck, q.J)))} °/s · 1:${motors.ratio}: a_max ${fixedText(motors.aMax, 0)} m/s², v_free ${fixedText(motors.vMax, 2)} m/s`
  },
  legend: [
    { color: RING, label: 'Centre of mass · tilt θ (scope ±15°)', shape: 'dot' },
    { color: POWER, label: 'Motor torque u (±100 %; red: clipped)', shape: 'dot' },
    { color: HEAT, label: 'Shove on the top deck at 1 s', shape: 'dot' },
    { color: B_FIELD, label: 'Bars: mass × height of each part', shape: 'dot' },
  ],
  points: [
    'The build: three acrylic decks on M3 standoffs over two TT gearmotors, a DRV8833 and the MPU-6050 low on the front, the ESP32 on the middle deck, 2×18650 on top. Motor wiring and pins are the Robo-car’s (Wire the motor driver); the theory is Mobility › Balancing robots › Why it falls.',
    'A car wants its battery low (Materials › Chassis design); a balancer wants it high. The dynamics see the pendulum length L = Σm·z² / Σm·z, which is longer than the CoM height h. The pack is half the body mass, so it decides both: on top, L ≈ 21 cm and a lean grows e-fold every 145 ms; on the bottom deck only 107 ms.',
    'A shove is an impulse J at the top deck. It spins the body by J·z / I, and I = m·h·L about the axle is over five times larger with the pack on top, so the same hand barely tips it. Bottom-heavy, the same shove tips it so fast that the wheels cannot get under it.',
    'The gearbox trades torque for speed. 1:120 has 2.5× the torque but tops out at 0.44 m/s, and catching a shove means driving under the CoM fast; back-EMF leaves only 1 − v/v_free of the torque (red arrow = clipped). 1:48 at 1.1 m/s survives the harder shove. Same stock gains in every case (Tune the loop).',
  ],
  controls: [
    { kind: 'choice', key: 'deck', options: opts(DECKS), initial: 'top' },
    { kind: 'choice', key: 'gear', options: opts(GEARS), initial: 'tt48' },
    { kind: 'slider', key: 'shove', label: 'Shove J', min: 0, max: 100, step: 5, initial: 40, format: (v) => `${v} mN·s` },
  ],
  build(): Stage {
    const { scene, status, sub, event } = headerStage()
    const side = balanceFloor(scene, ROBOT, K, 0.26)
    const cues = robotCues(side.g)
    let bot: Bot | null = null
    let deck = -1

    const plot = sideScope(scene, BB.sy, BB.sh, { divs: [12, 6] })
    const cmdTr = plot.trace(POWER, { samples: 200, radius: 0.08 })
    const tiltTr = plot.trace(RING, { samples: 200 })
    scopeLabels(scene, BB.sy, BB.sh, BASE_TEST.seconds, 'tilt θ ±15°', 'motor u ±100 %')
    const yTilt = (a: number) => Math.max(-1, Math.min(1, toDeg(a) / BB.tiltMax)) * (BB.sh / 2)
    addLabel(scene, 'What lifts the CoM: mass × height', [SIDE_SCOPE.x - SIDE_SCOPE.w / 2, BB.bars[1] + 0.85, 0.3], LABEL, 0.28, 'left')
    const names = balGroups(2).map((g) => g.name)
    const bars = countBars(scene, BB.bars, names, 3.6, { row: 0.66, size: 0.25, color: B_FIELD })
    const clock = lapseClock(BASE_TEST.seconds, BB.slow, 0.8)

    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = bbParams(p)
        const R = bbRun(q)
        if (q.deck !== deck) {
          deck = q.deck
          bot = swapBot(bot, side.g, { packZ: packZ(q.deck) })
          const g = balGroups(q.deck)
          bars.set(
            g.map((x) => x.mz),
            g.map((x) => `${Math.round(x.kg * 1000)} g at ${mmText(x.z)}`),
            g.map((x) => (x.name === names[3] ? RING : B_FIELD)),
            Math.max(...balGroups(2).map((x) => x.mz)),
          )
        }
        const t = clock(dt, bbKey(q))
        const f = at(R.run, t)
        bot!.set(f.tilt, f.x)
        side.roll(f.x)
        const pushed = q.J > 0 && t >= BASE_TEST.push && t < BASE_TEST.push + 0.3
        cues(f, R.body.h, 0, pushed)
        traceRun(tiltTr, R.run, BALANCER.dt, BASE_TEST.seconds, t, (g) => yTilt(g.tilt))
        traceRun(cmdTr, R.run, BALANCER.dt, BASE_TEST.seconds, t, (g) => g.got * (BB.sh / 2))

        status.set(`${DECKS[(Object.keys(DECK_OF) as (keyof typeof DECKS)[])[q.deck]]} · ${GEARS[q.gear]} · CoM ${mmText(R.body.h)} up`, LABEL)
        if (f.fallen) event.set(`down at ${fixedText(R.fell ?? 0, 1)} s: the wheels could not get under it`, HIGH_V)
        else if (pushed) event.set(`shoved: tilt rate +${Math.round(toDeg(shoveKick(q.deck, q.J)))} °/s`, HEAT)
        else if (f.sat) event.set(`tilt ${deg(f.tilt, 1)} · motors at their limit at ${fixedText(Math.abs(f.v), 2)} m/s`, HIGH_V)
        else event.set(`tilt ${deg(f.tilt, 1)} · wheels ${fixedText(f.v, 2)} m/s`, Math.abs(f.tilt) < 1 * DEG ? POWER : RING)
        sub.set(`${fixedText(t, 1)} / ${BASE_TEST.seconds} s · slowed ${1 / BB.slow}× · stock tilt PD + speed PI`)
      },
      readouts: (p) => {
        const q = bbParams(p)
        const R = bbRun(q)
        const best = bbMax(q)
        return [
          { label: 'Shove test', value: R.fell !== null ? `falls at ${fixedText(R.fell, 1)} s` : R.sat ? `holds, motors clipped` : `holds, peak ${deg(R.peak, 1)}`, tone: R.fell !== null ? 'bad' : R.sat ? 'warn' : 'ok' },
          { label: 'Hardest shove it survives', value: mNs(best), tone: toneOf(best >= 0.07, best >= 0.04) },
          { label: 'CoM h · pendulum L', value: `${mmText(R.body.h)} · ${mmText(R.body.L)}` },
          { label: 'Fall time constant τ', value: msText(R.body.tau), tone: toneOf(R.body.tau > 0.14, R.body.tau > 0.115) },
        ]
      },
    }
  },
}

// --- Read the tilt: the MPU-6050 in the loop; accel alone, gyro alone, complementary filter τ, gyro calibration. ---

const FILTERS: Record<TiltFilter, string> = { accel: 'Accelerometer only', gyro: 'Gyro only (integrated)', comp: 'Complementary filter' }
const CALS = { cal: 'Gyro calibrated at start-up', raw: 'No gyro calibration' }
const RT = { sy: 0.4, sh: 6.4, tiltMax: 15, slow: 0.5 }
const rtParams = (p: Params) => ({ filter: pick(FILTERS, p.filter, 'comp') as TiltFilter, tau: n(p, 'tau'), cal: pick(CALS, p.cal, 'cal') === 'cal' })
type RtQ = ReturnType<typeof rtParams>
const rtKey = (q: RtQ) => `${q.filter}|${q.tau}|${q.cal}`
const rtRun = memoBy(rtKey, (q: RtQ) => tiltReadRun({ filter: q.filter, tau: q.tau, r: BAL_IMU.low, biasDps: gyroBias(q.cal) }))
const rtDrive = (t: number) => (t >= READ_TEST.go && t < READ_TEST.stop ? READ_TEST.v : 0)

export const selfBalancingRobotReadTheTilt: Lesson = {
  id: 'self-balancing-robot-read-the-tilt',
  title: 'Read the tilt',
  tagline: 'The accelerometer lies whenever the wheels accelerate; the gyro drifts; blend them',
  formula: (p) => {
    const q = rtParams(p)
    const a = q.filter === 'accel' ? 0 : q.filter === 'gyro' ? 1 : compAlpha(q.tau, BALANCER.dt)
    return `every 5 ms: θ = ${fixedText(a, 3)}·(θ + ω·dt) + ${fixedText(1 - a, 3)}·atan2(a_x, a_z) · α = τ / (τ + dt)${q.filter === 'comp' ? ` = ${q.tau} / (${q.tau} + 0.005)` : ''} · gyro offset ${fixedText(gyroBias(q.cal), 2)} °/s → steady error bias·τ = ${q.filter === 'comp' ? deg(compBiasError(gyroBias(q.cal), q.tau) * DEG, 2) : q.filter === 'gyro' ? 'grows without limit' : '0'}`
  },
  legend: [
    { color: RING, label: 'True tilt θ', shape: 'dot' },
    { color: HEAT, label: 'Accelerometer tilt atan2(a_x, a_z)', shape: 'dot' },
    { color: B_FIELD, label: 'Tilt the loop uses (robot: blue rod)', shape: 'dot' },
  ],
  points: [
    'The MPU-6050 sits low on the front deck on I²C (SDA 21, SCL 22, address 0x68). Set the gyro to ±250 °/s (131 counts per °/s) and the accel to ±2 g, and read all six axes every 5 ms in the same loop as the PID. How each sensor works is Sensors › IMU; here they go into the loop.',
    'The accelerometer measures gravity and acceleration together. Standing still it gives the lean, but to catch a fall the wheels accelerate at several m/s², and a/g reads as a lean of tens of degrees. Steer on that and the robot fights its own wheels and falls in about 2 s (orange trace). It cannot tell leaning from accelerating.',
    'The gyro reads θ̇ cleanly and also feeds the D term, but integrating it adds up the offset: 1.6 °/s uncalibrated, so after 10 s it is about 15° wrong and the robot balances while rolling away. Average 500 still readings at start-up and subtract them; the leftover offset is well under 0.01 °/s.',
    'The complementary filter trusts the gyro for times under τ and the accel for times over it (Sensors › IMU › Complementary filter). The balancer needs a long τ: at 0.25 s (α = 0.98) the wheel acceleration still leaks in and it falls; about 1 s (α = 0.995) works. Longer τ also multiplies any gyro offset left (bias·τ), so calibrate it.',
  ],
  controls: [
    { kind: 'choice', key: 'filter', options: opts(FILTERS), initial: 'comp' },
    { kind: 'slider', key: 'tau', label: 'Filter τ', min: 0.1, max: 3, step: 0.05, initial: 1, format: (v) => `${v.toFixed(2)} s (α ${compAlpha(v, BALANCER.dt).toFixed(3)})` },
    { kind: 'choice', key: 'cal', options: opts(CALS), initial: 'cal' },
  ],
  build(): Stage {
    const { scene, status, sub, event } = headerStage()
    const side = balanceFloor(scene, ROBOT, K, 0.26)
    const bot = balanceBot(side.g)
    const cues = robotCues(side.g)
    const seenRod = addRod(side.g, glowMat(B_FIELD, 1.1))

    const plot = sideScope(scene, RT.sy, RT.sh, { divs: [10, 6] })
    const accTr = plot.trace(HEAT, { samples: 300, radius: 0.04 })
    const tiltTr = plot.trace(RING, { samples: 200, radius: 0.1 })
    const seenTr = plot.trace(B_FIELD, { samples: 200, radius: 0.06 })
    scopeLabels(scene, RT.sy, RT.sh, READ_TEST.seconds, 'tilt ±15°', 'drive 0.3 m/s from 3 s to 7 s')
    const yTilt = (a: number) => Math.max(-1, Math.min(1, toDeg(a) / RT.tiltMax)) * (RT.sh / 2)
    const rows = textRows(scene, 2, SIDE_SCOPE.x - SIDE_SCOPE.w / 2, -4.6, 0.26, 0.6)
    const clock = lapseClock(READ_TEST.seconds, RT.slow, 0.8)

    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = rtParams(p)
        const R = rtRun(q)
        const t = clock(dt, rtKey(q))
        const f = at(R.run, t)
        const acc = fixedStepAt(R.accel, t, BALANCER.dt)
        bot.set(f.tilt, f.x)
        side.roll(f.x)
        const pushed = t >= READ_TEST.push && t < READ_TEST.push + 0.3
        cues(f, balBody(2).h, 0, pushed)
        stretchRod(seenRod, onBalancer(f.seen, 0.02, -0.12), onBalancer(f.seen, 0.28, -0.12), 0.0025)
        traceRun(accTr, R.accel, BALANCER.dt, READ_TEST.seconds, t, yTilt, 300)
        traceRun(tiltTr, R.run, BALANCER.dt, READ_TEST.seconds, t, (g) => yTilt(g.tilt))
        traceRun(seenTr, R.run, BALANCER.dt, READ_TEST.seconds, t, (g) => yTilt(g.seen))

        const err = f.seen - f.tilt
        status.set(`${FILTERS[q.filter]}${q.filter === 'comp' ? ` τ ${q.tau.toFixed(2)} s` : ''} · ${q.cal ? 'gyro calibrated' : `gyro offset ${fixedText(gyroBias(false), 1)} °/s`}`, LABEL)
        if (f.fallen) event.set(`down at ${fixedText(R.fell ?? 0, 1)} s: it steered on a wrong tilt`, HIGH_V)
        else if (pushed) event.set('shoved: the wheels drive hard under it', HEAT)
        else event.set(`true ${deg(f.tilt, 1)} · accel says ${deg(acc, 1)} · loop uses ${deg(f.seen, 1)}`, Math.abs(err) < 1 * DEG ? POWER : Math.abs(err) < 3 * DEG ? RING : HIGH_V)
        sub.set(`${fixedText(t, 1)} / ${READ_TEST.seconds} s · slowed ${1 / RT.slow}× · set ${fixedText(rtDrive(t), 1)} m/s · v ${fixedText(f.v, 2)} m/s`)
        rows[0].set(`MPU-6050 0x68 · ±250 °/s = ${GYRO_RANGES[250]} counts per °/s`, GREY)
        rows[1].set(`error now ${deg(err, 1)} · RMS ${deg(R.rms, 1)}`, Math.abs(err) < 1 * DEG ? POWER : HEAT)
      },
      readouts: (p) => {
        const q = rtParams(p)
        const R = rtRun(q)
        return [
          { label: 'Outcome', value: R.fell !== null ? `falls at ${fixedText(R.fell, 1)} s` : 'balances and drives', tone: R.fell !== null ? 'bad' : 'ok' },
          { label: 'Tilt error RMS', value: deg(R.rms, 2), tone: toneOf(R.rms < 1.5 * DEG, R.rms < 4 * DEG) },
          { label: 'Worst tilt error', value: deg(R.peakErr, 1), tone: toneOf(R.peakErr < 3 * DEG, R.peakErr < 8 * DEG) },
          { label: 'Gyro offset left', value: `${fixedText(gyroBias(q.cal), 3)} °/s`, tone: q.cal ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Tune the loop: the four-step procedure on the real robot; a sheet runs every step with the same gains. ---

const TL = { sy: 1.6, sh: 4.4, tiltMax: 10, bars: [SIDE_SCOPE.x - 3.2, -3.6, 0] as V3, slow: 0.5 }
const tlParams = (p: Params) => ({ stage: pick(TUNE_STAGES, p.stage, 'speedPI') as TuneStage, g: { kp: n(p, 'kp') / 100, kd: n(p, 'kd') / 100, sp: n(p, 'sp'), si: n(p, 'si') } as TuneGains })
type TlQ = ReturnType<typeof tlParams>
const gKey = (g: TuneGains) => `${g.kp}|${g.kd}|${g.sp}|${g.si}`
const tlRun = memoBy((q: TlQ) => `${q.stage}|${gKey(q.g)}`, (q: TlQ) => tuneRun(q.stage, q.g))
const tlSheet = memoBy(gKey, tuneSheet)
const verdictTone = (v: TuneVerdict) => (v === 'holds' ? 'ok' : v === 'creeps' || v === 'wobbles' ? 'warn' : 'bad')
const STAGES = Object.keys(TUNE_STAGES) as TuneStage[]

export const selfBalancingRobotTuneTheLoop: Lesson = {
  id: 'self-balancing-robot-tune-the-loop',
  title: 'Tune the loop',
  tagline: 'Tilt P, then D, then the speed loop: one gain at a time on the real robot',
  formula: (p) => {
    const { stage, g } = tlParams(p)
    const k = STAGES.indexOf(stage)
    return `u = ${pct(g.kp)}/°·(θ − θ_t) + ${k >= 1 ? `${fixedText(g.kd * 100, 1)} %/(°/s)·θ̇` : '0·θ̇'} · θ_t = ${k >= 2 ? `${g.sp}°/(m/s)·(0 − v)` : '0'}${k >= 3 ? ` + ${g.si}°/m·∫(0 − v) dt` : ''} · battery 5 mm forward = CoM ${deg(tuneOffset(), 1)} off the axle · stock: ${pct(BAL_TILT.kp)}/°, ${BAL_TILT.kd * 100} %/(°/s), ${BAL_SPEED.kp}°/(m/s), ${BAL_SPEED.ki}°/m`
  },
  legend: [
    { color: RING, label: 'Tilt θ (scope ±10°) · CoM', shape: 'dot' },
    { color: POWER, label: 'Motor torque u · sheet: holds still', shape: 'dot' },
    { color: HEAT, label: 'Shove at 4 s · sheet: stands but moves', shape: 'dot' },
    { color: HIGH_V, label: 'Clipped · sheet: falls', shape: 'dot' },
  ],
  points: [
    'This is the robot as built: tilt from the complementary filter (Read the tilt), the battery 5 mm off-centre, a start 3° off and a shove at 4 s. Work through the stages in order and change one gain at a time. The theory is Mobility › Balancing robots › Tilt PID and Self-balancing car; Control › PID covers tuning in general.',
    'Step 1, tilt P only, speed loop off: below g/a_max ≈ 1.2 %/° it simply topples. Raise Kp until it fights back hard and starts to swing (about 15 %/°), then back off to roughly half.',
    'Step 2, add Kd from the gyro rate until the swing stops. It now stands for a couple of seconds, then rolls off and falls: the tilt it sees comes partly from the accelerometer, which cannot tell a lean from an acceleration, and nothing in the loop cares about speed. No tilt gains fix this.',
    'Step 3, the speed loop (wheel speed from the commanded duty or encoders) sets the target tilt: speed P stops the run-away but leaves a steady creep, because the off-centre battery needs a lean and P only gives one while it is moving. Step 4, speed I finds that lean and it stands still. The sheet runs all four stages with your gains; too much speed gain shakes it apart.',
  ],
  controls: [
    { kind: 'choice', key: 'stage', options: opts(TUNE_STAGES), initial: 'speedPI' },
    { kind: 'slider', key: 'kp', label: 'Tilt Kp', min: 1, max: 20, step: 1, initial: 8, format: (v) => `${v} %/°` },
    { kind: 'slider', key: 'kd', label: 'Tilt Kd', min: 0, max: 0.8, step: 0.1, initial: 0.3, format: (v) => `${v.toFixed(1)} %/(°/s)` },
    { kind: 'slider', key: 'sp', label: 'Speed Kp', min: 0, max: 12, step: 1, initial: 5, format: (v) => `${v}°/(m/s)` },
    { kind: 'slider', key: 'si', label: 'Speed Ki', min: 0, max: 6, step: 0.5, initial: 2, format: (v) => `${v}°/m` },
  ],
  build(): Stage {
    const { scene, status, sub, event } = headerStage()
    const side = balanceFloor(scene, ROBOT, K, 0.26)
    const bot = balanceBot(side.g, { shift: TUNE.battShift })
    const cues = robotCues(side.g)

    const plot = sideScope(scene, TL.sy, TL.sh, { divs: [8, 4] })
    const cmdTr = plot.trace(POWER, { samples: 200, radius: 0.08 })
    const tiltTr = plot.trace(RING, { samples: 200 })
    scopeLabels(scene, TL.sy, TL.sh, TUNE.seconds, 'tilt θ ±10°', 'motor u ±100 %')
    const yTilt = (a: number) => Math.max(-1, Math.min(1, toDeg(a) / TL.tiltMax)) * (TL.sh / 2)
    addLabel(scene, 'Tuning sheet: every stage, these gains', [SIDE_SCOPE.x - SIDE_SCOPE.w / 2, TL.bars[1] + 0.85, 0.3], LABEL, 0.28, 'left')
    const bars = countBars(scene, TL.bars, STAGES.map((s) => TUNE_STAGES[s]), 3.4, { row: 0.66, size: 0.25 })
    const clock = lapseClock(TUNE.seconds, TL.slow, 0.8)
    const st = { sheet: '' }

    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = tlParams(p)
        const R = tlRun(q)
        const key = `${q.stage}|${gKey(q.g)}`
        if (key !== st.sheet) {
          st.sheet = key
          const S = tlSheet(q.g)
          bars.set(
            S.map((s) => s.fell ?? TUNE.seconds),
            S.map((s) => (s.fell !== null ? `${TUNE_VERDICTS[s.verdict].split(':')[0]} at ${fixedText(s.fell, 1)} s` : TUNE_VERDICTS[s.verdict])),
            S.map((s) => toneColor[verdictTone(s.verdict)]),
            TUNE.seconds,
          )
          STAGES.forEach((s, j) => bars.rename(j, TUNE_STAGES[s], s === q.stage ? LABEL : GREY))
        }
        const t = clock(dt, key)
        const f = at(R.run, t)
        bot.set(f.tilt, f.x)
        side.roll(f.x)
        const pushed = t >= TUNE.push && t < TUNE.push + 0.3
        cues(f, balBody(2).h, tuneOffset(), pushed)
        traceRun(tiltTr, R.run, BALANCER.dt, TUNE.seconds, t, (g) => yTilt(g.tilt))
        traceRun(cmdTr, R.run, BALANCER.dt, TUNE.seconds, t, (g) => g.got * (TL.sh / 2))

        status.set(`${TUNE_STAGES[q.stage]} · P ${pct(f.p)} + D ${pct(f.d)} = u ${pct(f.cmd)}`, LABEL)
        if (f.fallen) event.set(`${TUNE_VERDICTS[R.verdict]} (down at ${fixedText(R.fell ?? 0, 1)} s)`, HIGH_V)
        else if (pushed) event.set('shoved at 4 s', HEAT)
        else event.set(`tilt ${deg(f.tilt, 1)} · target ${deg(f.target, 1)} · wheels ${fixedText(f.v, 2)} m/s`, Math.abs(f.v) < 0.05 && Math.abs(f.tilt) < 2 * DEG ? POWER : RING)
        sub.set(`${fixedText(t, 1)} / ${TUNE.seconds} s · slowed ${1 / TL.slow}× · starts 3° off · rolled ${fixedText(f.x, 2)} m`)
      },
      readouts: (p) => {
        const q = tlParams(p)
        const R = tlRun(q)
        return [
          { label: 'This stage', value: TUNE_VERDICTS[R.verdict], tone: verdictTone(R.verdict) },
          { label: 'Wobble in the last second', value: R.fell !== null ? '—' : deg(R.wobble, 1), tone: R.fell !== null ? 'bad' : toneOf(R.wobble < 1 * DEG, R.wobble < 2 * DEG) },
          { label: 'Speed at the end', value: R.fell !== null ? 'on the floor' : `${fixedText(R.v, 2)} m/s`, tone: R.fell !== null ? 'bad' : toneOf(Math.abs(R.v) < 0.05, Math.abs(R.v) < 0.15) },
          { label: 'Tilt sign changes', value: `${R.swings}` },
        ]
      },
    }
  },
}
