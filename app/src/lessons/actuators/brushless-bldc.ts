import * as THREE from 'three/webgpu'
import {
  DSHOT600,
  ESC,
  ESC_FRAME_S,
  ESC_MOTOR,
  HALL_STEP,
  LIPO,
  PHASE_NAMES,
  SENSORLESS,
  SIX_STEP,
  START_FRAME_S,
  StartFrame,
  TEACH_BLDC,
  bldcStartRun,
  closedAt,
  commutationHz,
  commutationStep,
  dshotBits,
  dshotFrame,
  dshotValue,
  escCommand,
  escPulseUs,
  escRun,
  fieldAngle,
  fixedStepAt,
  floatingPhase,
  hallBits,
  hallCode,
  kvToKt,
  mod6,
  noLoadRpm,
  packVolts,
  phaseState,
  phaseVolts,
  propAmps,
  propSpeed,
  stepName,
  stepProgress,
} from '../../core/physics'
import { msText } from '../../core/units'
import { V3, add, box, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  DATA_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  PIN_COLOR,
  POWER,
  RING,
  addLabel,
  bldcMotor,
  codeBlock,
  cursorBar,
  esp32Board,
  fetSymbol,
  glowMat,
  heatWaves,
  litWire,
  liveLabel,
  memoBy,
  scope,
  simClock,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const PHASE_COLORS = [HEAT, B_FIELD, DATA_COLOR]
const lit = (c: string) => new THREE.Color(c)
const rpmText = (rpm: number) => `${Math.round(rpm).toLocaleString('en-US')} rpm`
const ampsOf = (step: number) => [0, 1, 2].map((p) => phaseState(step, p))
const stepAt = (u: number) => commutationStep(u * 2 * Math.PI)

/** Needle from the motor centre along +x (angle 0), `len` long. */
function needle(parent: THREE.Object3D, z: number, len: number, color: string, opacity = 1) {
  const g = add(parent, new THREE.Group(), [0, 0, z])
  const m = glowMat(color, 0.9)
  m.transparent = opacity < 1
  m.opacity = opacity
  box(g, [len, 0.18, 0.12], m, [len / 2, 0, 0]).castShadow = false
  add(g, mesh(new THREE.ConeGeometry(0.34, 0.7, 12), m), [len + 0.3, 0, 0]).rotation.z = -Math.PI / 2
  return g
}

/** BLDC with a stator-field needle (fixed to the stage) and a rotor needle. */
function motorWithNeedles(scene: THREE.Object3D, at: V3, r: number, halls = false) {
  const motor = bldcMotor(scene, at, r, { halls, phaseColors: PHASE_COLORS })
  const field = needle(scene, 0, 0.9 * r, RING, 0.5)
  field.position.set(at[0], at[1], at[2] + 0.35 * r)
  needle(motor.rotor, 0.25 * r, 1.05 * r, POWER)
  return { motor, field }
}

// --- Three-phase drive: three half-bridges energise two phases at a time; six steps turn the field a full turn. ---

const KVS = { k920: '920 KV (camera gimbal / big quad)', k1400: '1400 KV (7" quad)', k2300: '2300 KV (5" racer)' }
const KV = { k920: 920, k1400: 1400, k2300: 2300 }
const TP = { at: [-10.5, 0.2, 0] as V3, r: 3.2, legs: [1.2, 6.2, 11.2], top: 4.6, bot: -2, node: 1.3 }
const driveParams = (p: Params) => {
  const kv = KV[pick(KVS, p.kv, 'k2300')]
  const volts = n(p, 'volts')
  const duty = n(p, 'duty') / 100
  const rpm = noLoadRpm(kv, volts, duty)
  const visRev = 0.15 + 0.35 * Math.min(1, rpm / 40000)
  return { kv, volts, duty, rpm, visRev, slow: Math.max(1, Math.round(rpm / 60 / visRev)) }
}

export const threePhaseDrive: Lesson = {
  id: 'brushless-bldc-three-phase-drive',
  title: 'Three-phase drive',
  tagline: 'Six switches, six steps, a field that turns',
  formula: (p) => {
    const q = driveParams(p)
    return `rpm ≈ KV × V × duty = ${q.kv} × ${q.volts.toFixed(1)} × ${q.duty.toFixed(2)} = ${rpmText(q.rpm)} · Kt = 60 / (2π·KV) = ${(kvToKt(q.kv) * 1000).toFixed(2)} mN·m/A · 14-pole motor: ${Math.round(commutationHz(q.rpm, ESC_MOTOR.poles)).toLocaleString('en-US')} steps/s`
  },
  legend: [
    { color: RING, label: 'Stator field (jumps 60°)', shape: 'dot' },
    { color: POWER, label: 'Rotor field', shape: 'dot' },
    { color: HEAT, label: 'Phase A', shape: 'dot' },
    { color: B_FIELD, label: 'Phase B', shape: 'dot' },
    { color: DATA_COLOR, label: 'Phase C', shape: 'dot' },
  ],
  points: [
    'A brushless motor turns the brushed motor inside out: the magnets spin (here in an outrunner bell, as on drones) and the coils stay still on the stator, so nothing rubs. Electronics have to do the commutator\'s job instead.',
    'Three phases A, B, C, each wound on opposite teeth, meet at a star point. Three half-bridges (a high-side and a low-side MOSFET per phase, six in all) can tie each phase to +V, to ground, or leave it floating.',
    'Six-step drive turns on one high-side and one other low-side FET: current flows in one phase and out of another, and the third floats. Each step points the stator field 60° further on; six steps make one electrical turn.',
    'Switch at the right moment and the field always leads the rotor by 60…120°: the magnets are dragged round with at least 87 % of peak torque. The floating phase shows the back-EMF ramp between its two driven levels, the trapezoid on the scope.',
    'KV is rpm per volt with no load: rpm ≈ KV × V × duty, the ESC\'s PWM setting the duty. It is also the torque constant upside down: Kt = 60 / (2π·KV), so a 2300 KV motor spins fast but gives only 4.2 mN·m per amp. A 14-pole motor needs 7 electrical turns per revolution.',
  ],
  controls: [
    { kind: 'choice', key: 'kv', options: opts(KVS), initial: 'k2300' },
    { kind: 'slider', key: 'volts', label: 'Supply', min: 3.7, max: 16.8, step: 0.1, initial: 11.1, format: (v) => `${v.toFixed(1)} V` },
    { kind: 'slider', key: 'duty', label: 'PWM duty', min: 10, max: 100, step: 5, initial: 60, format: (v) => `${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { motor, field } = motorWithNeedles(scene, TP.at, TP.r)
    addLabel(scene, 'outrunner, front cap off', [TP.at[0], TP.at[1] + 5.2, 0.4], GREY, 0.36)
    const stepTag = liveLabel(scene, [TP.at[0], TP.at[1] + 6.2, 0.6], { size: 0.46 })

    wire(scene, [[TP.legs[0] - 2.6, TP.top, 0], [TP.legs[2] + 0.4, TP.top, 0]], 0.16)
    wire(scene, [[TP.legs[0] - 2.6, TP.bot, 0], [TP.legs[2] + 0.4, TP.bot, 0]], 0.16)
    const railTag = liveLabel(scene, [TP.legs[0] - 2.9, TP.top, 0.3], { size: 0.38, align: 'right', color: HIGH_V })
    addLabel(scene, 'GND', [TP.legs[0] - 2.9, TP.bot, 0.3], LOW_V, 0.38, 'right')
    const fets = TP.legs.map((x, k) => {
      const hi = fetSymbol(scene, [x, TP.top, 0], [x, TP.node + 0.5, 0], 'N', `${PHASE_NAMES[k]}H`)
      const lo = fetSymbol(scene, [x, TP.node - 0.5, 0], [x, TP.bot, 0], 'N', `${PHASE_NAMES[k]}L`)
      wire(scene, [[x, TP.node + 0.5, 0], [x, TP.node - 0.5, 0]], 0.2)
      const pin = motor.pins[k]
      const y = -5.9 - k * 0.45
      const path: V3[] = [[x, TP.node, 0], [x + 1.7, TP.node, 0], [x + 1.7, y, 0], [pin[0], y, 0], [pin[0], pin[1], pin[2]]]
      wire(scene, path, 0.09)
      addLabel(scene, PHASE_NAMES[k], [x + 2.2, TP.node + 0.5, 0.3], PHASE_COLORS[k], 0.5)
      return { hi, lo, glow: litWire(scene, path, 0.16) }
    })

    const sc = scope(scene, 12, 3.2, { divs: [12, 4], zeroAt: 0 })
    sc.group.position.set(6.2, -9.2, 0)
    const traces = PHASE_COLORS.map((c, k) => sc.trace(c, { samples: 241, radius: 0.045 + 0.012 * (2 - k) }))
    const cursor = cursorBar(sc, LABEL)
    ticks(sc, [0, 0.25, 0.5, 0.75, 1].map((u): [number, string] => [u, `${u * 360}`]), [], 0.36)
    addLabel(scene, 'phase voltage 0…V+ vs rotor angle (°), one electrical turn', [6.2, -12, 0.3], GREY, 0.3)
    const code = codeBlock(scene, [-16.6, -8.4, 0.3], 0.4)

    const st = { th: 0.3, key: '', step: -1, t: 0 }
    return {
      scene,
      view: { center: [-2.2, -1.6, 0], radius: 60, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = driveParams(p)
        st.t += dt
        st.th += 2 * Math.PI * q.visRev * dt
        const step = commutationStep(st.th)
        const key = `${q.volts}|${q.duty}`
        if (key !== st.key) {
          st.key = key
          const yv = (v: number) => (0.9 * v / q.volts - 0.45) * sc.height
          traces.forEach((tr, k) => tr.draw((u) => yv(phaseVolts(stepAt(u), stepProgress(u * 2 * Math.PI), k, q.volts, q.duty)), null))
          railTag.set(`+${q.volts.toFixed(1)} V`, HIGH_V)
          st.step = -1
        }
        motor.set(st.th, ampsOf(step))
        field.rotation.z = fieldAngle(step)
        cursor((((st.th / (2 * Math.PI)) % 1) + 1) % 1)
        const chop = 0.55 + 0.45 * (Math.sin(st.t * 50) > 1 - 2 * q.duty ? 1 : 0)
        fets.forEach((f, k) => {
          const s = phaseState(step, k)
          f.hi.set(s > 0 ? chop : 0)
          f.lo.set(s < 0 ? 1 : 0)
          f.glow.set(s === 0 ? 0.08 : 0.5, lit(s > 0 ? HIGH_V : s < 0 ? LOW_V : GREY))
        })
        if (step !== st.step) {
          st.step = step
          const [hi, lo] = SIX_STEP[step]
          stepTag.set(`Step ${step + 1}: ${stepName(step)}, ${PHASE_NAMES[floatingPhase(step)]} floating`, RING)
          code([`// step ${step + 1}: ${stepName(step)}, ${PHASE_NAMES[floatingPhase(step)]} floats`, `ledcWrite(HI[${PHASE_NAMES[hi]}], ${Math.round(q.duty * 255)});  // PWM ${Math.round(q.duty * 100)} %`, `digitalWrite(LO[${PHASE_NAMES[lo]}], HIGH);  // others off`])
        }
      },
      readouts: (p) => {
        const q = driveParams(p)
        return [
          { label: 'Animation', value: `${q.slow.toLocaleString('en-US')}× slower` },
          { label: 'No-load speed', value: rpmText(q.rpm) },
          { label: 'Torque per amp', value: `${(kvToKt(q.kv) * 1000).toFixed(2)} mN·m/A` },
          { label: 'Steps, 14-pole', value: `${Math.round(commutationHz(q.rpm, ESC_MOTOR.poles)).toLocaleString('en-US')} /s`, tone: commutationHz(q.rpm, ESC_MOTOR.poles) > 20000 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Hall sensors: a 6-state code picks the step from standstill; sensorless needs EMF, so it starts blind (align + ramp). ---

const SENSES = { hall: 'Hall sensors', bemf: 'Sensorless (back-EMF)' }
const HS = { at: [-11, 0.8, 0] as V3, r: 2.7, seconds: 1.2, slow: 20, emfMax: 7, rpmMax: 6000 }
const PHASE_TEXT = { hall: 'Halls: commutating from the code', align: 'Align: hold step 1, rotor snaps to it', ramp: 'Open loop: forcing steps blind', closed: 'Back-EMF zero crossings: closed loop', desync: 'Lost sync: stop and retry' }
const hallParams = (p: Params) => ({ sense: pick(SENSES, p.sense, 'hall'), load: n(p, 'load') })
type HallQ = ReturnType<typeof hallParams>
const hallKey = (q: HallQ) => `${q.sense}|${q.load}`
const hallMemo = memoBy(hallKey, (q: HallQ) => bldcStartRun(q.sense, q.load, HS.seconds))
const phaseTone = (f: StartFrame) => (f.phase === 'desync' ? HIGH_V : f.phase === 'align' || f.phase === 'ramp' ? HEAT : POWER)
const rpmOf = (w: number) => (w * 60) / (2 * Math.PI)
const zcRpm = rpmOf(SENSORLESS.zcVolts / kvToKt(TEACH_BLDC.kv))

export const hallSensors: Lesson = {
  id: 'brushless-bldc-hall-sensors',
  title: 'Hall sensors',
  tagline: 'Knowing where the rotor is',
  formula: (p) => {
    const q = hallParams(p)
    return q.sense === 'hall'
      ? 'code = H1·4 + H2·2 + H3 (6 valid states, 000 and 111 mean a broken sensor) → step = TABLE[code], works at 0 rpm'
      : `back-EMF = Ke·ω = ${kvToKt(TEACH_BLDC.kv).toFixed(4)} V·s × ω · zero crossings visible above ${SENSORLESS.zcVolts} V = ${Math.round(zcRpm)} rpm · below that: align, then force steps at ${SENSORLESS.rampAcc} rad/s²`
  },
  legend: [
    { color: RING, label: 'Hall high / stator field', shape: 'dot' },
    { color: POWER, label: 'Rotor field · speed', shape: 'dot' },
    { color: DATA_COLOR, label: 'Floating-phase back-EMF', shape: 'dot' },
    { color: HEAT, label: 'Zero-crossing threshold', shape: 'dot' },
  ],
  points: [
    'Six-step drive needs to know which of six 60° sectors the rotor is in. Three Hall-effect switches 120° apart on the stator each read the magnet passing over them: high near one pole, low near the other.',
    'Together they give a 3-bit code that steps through six states (1 to 6; 000 and 111 never happen with good sensors). A lookup table turns the code straight into the next step, so the motor starts with full torque from standstill and in either direction.',
    'Sensorless ESCs drop the Halls and their wires. In every step one phase floats, and its voltage is pure back-EMF: it crosses the midpoint halfway through the step. Wait another 30° after that zero crossing and commutate.',
    'Back-EMF is proportional to speed. At rest there is none, and at low speed it drowns in PWM noise, so the ESC is blind just when it starts. It aligns the rotor to a known step, then forces steps faster and faster open loop until zero crossings appear.',
    'If the load is heavy, or the ramp too fast, the rotor can\'t keep up with the forced steps and loses sync: the ESC stops and tries again (the stutter of a quad motor jammed by grass). Hall sensors are the cure for robots and e-bikes that must start under load.',
  ],
  controls: [
    { kind: 'choice', key: 'sense', options: opts(SENSES), initial: 'hall' },
    { kind: 'slider', key: 'load', label: 'Load (friction)', min: 0, max: 0.06, step: 0.005, initial: 0.02, format: (v) => `${(v * 1000).toFixed(0)} mN·m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { motor, field } = motorWithNeedles(scene, HS.at, HS.r, true)
    const codeTag = liveLabel(scene, [HS.at[0], HS.at[1] + 5.4, 0.6], { size: 0.44 })
    const phaseTag = liveLabel(scene, [HS.at[0], HS.at[1] + 4.5, 0.6], { size: 0.38 })
    addLabel(scene, 'Halls H1 H2 H3 on teeth A B C', [HS.at[0], HS.at[1] - 4.4, 0.4], GREY, 0.34)

    const ang = scope(scene, 12, 5.2, { divs: [12, 6], zeroAt: 0.25 })
    ang.group.position.set(6, 3.6, 0)
    const lane = (k: number, on: number) => ang.height / 2 - 0.45 - k * 0.8 - (on ? 0 : 0.5)
    const halls = [0, 1, 2].map(() => ang.trace(RING, { samples: 241, radius: 0.04 }))
    halls.forEach((tr, k) => tr.draw((u) => lane(k, hallBits(u * 2 * Math.PI)[k]), null))
    const hallTags = add(scene, new THREE.Group())
    ;['H1', 'H2', 'H3'].forEach((h, k) => addLabel(hallTags, h, [6 + ang.width / 2 + 0.9, 3.6 + lane(k, 1) - 0.25, 0.3], RING, 0.3))
    const yE = (e: number) => -ang.height / 4 + (e / HS.emfMax) * (ang.height / 4)
    const emfTr = ang.trace(DATA_COLOR, { samples: 241, radius: 0.06 })
    const thHi = ang.level(HEAT, 0.3)
    const thLo = ang.level(HEAT, 0.3)
    thHi.set(yE(SENSORLESS.zcVolts))
    thLo.set(yE(-SENSORLESS.zcVolts))
    const zcDots = [0, 1, 2, 3, 4, 5].map((k) => add(ang.group, mesh(new THREE.SphereGeometry(0.2, 12, 8), glowMat(POWER, 1.3)), [ang.xAt(k / 6), yE(0), 0.35]))
    const angCur = cursorBar(ang, LABEL)
    ticks(ang, [0, 0.25, 0.5, 0.75, 1].map((u): [number, string] => [u, `${u * 360}`]), [], 0.34)

    const ts = scope(scene, 12, 3.2, { divs: [12, 4], zeroAt: 0 })
    ts.group.position.set(6, -3.6, 0)
    const yR = (rpm: number) => (rpm / HS.rpmMax - 0.5) * ts.height
    const spd = ts.trace(POWER, { samples: 400, radius: 0.06 })
    ts.level(HEAT, 0.3).set(yR(zcRpm))
    const tCur = cursorBar(ts, LABEL)
    ticks(ts, [0, 400, 800, 1200].map((ms): [number, string] => [ms / 1000 / HS.seconds, `${ms}`]), [], 0.34)
    addLabel(scene, `speed 0…${HS.rpmMax} rpm vs time (ms) · dashed: EMF big enough`, [6, -6.7, 0.3], GREY, 0.3)
    const result = liveLabel(scene, [6, -7.7, 0.3], { size: 0.4 })
    const code = codeBlock(scene, [-16.6, -8.8, 0.3], 0.38)

    const clock = simClock(HS.slow / 1000, 2)
    const st = { t: 0, key: '' }
    return {
      scene,
      view: { center: [-2.6, -0.6, 0], radius: 60, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = hallParams(p)
        const run = hallMemo(q)
        const key = hallKey(q)
        const t = clock(dt, key, HS.seconds * 1000) / 1000
        st.t = t
        if (key !== st.key) {
          st.key = key
          const pts = run.filter((_, i) => i % 6 === 0)
          spd.points(pts.map((f) => f.t / HS.seconds), pts.map((f) => yR(rpmOf(f.w))))
          const at = closedAt(run)
          const tries = run[run.length - 1].tries
          result.set(at === null ? `Never caught: ${tries} start attempts, each lost sync` : q.sense === 'hall' ? 'Starts at once: full torque from 0 rpm' : `Closed loop after ${msText(at)} blind start${tries > 1 ? ` (${tries} tries)` : ''}`, at === null ? HIGH_V : q.sense === 'hall' ? POWER : HEAT)
          halls.forEach((tr) => (tr.group.visible = q.sense === 'hall'))
          hallTags.visible = q.sense === 'hall'
          code(
            q.sense === 'hall'
              ? [`const int8_t STEP_OF[8] = {-1, ${HALL_STEP.slice(1, 7).join(', ')}, -1};`, 'int h = H1 << 2 | H2 << 1 | H3;  // 3 digitalReads', 'commutate(STEP_OF[h]);  // on each Hall edge']
              : ['if (!running) { align(); rampOpenLoop(); }  // blind', 'if (zeroCross(floating)) after30deg(next);', 'if (timeout) { stop(); retry(); }  // lost sync'],
          )
        }
        const f = fixedStepAt(run, t, START_FRAME_S)
        motor.set(f.theta, f.phase === 'desync' ? [0, 0, 0] : ampsOf(f.step).map((a) => a * Math.min(1, 0.4 + f.duty)))
        field.visible = f.phase !== 'desync'
        field.rotation.z = fieldAngle(f.step)
        const bits = hallBits(f.theta)
        bits.forEach((b, k) => motor.hall(k, q.sense === 'hall' && b === 1))
        const code3 = hallCode(f.theta)
        codeTag.set(q.sense === 'hall' ? `H1 H2 H3 = ${bits.join(' ')} → code ${code3} → step ${HALL_STEP[code3] + 1}` : `no Halls · step ${mod6(f.step) + 1}: ${stepName(f.step)}`, q.sense === 'hall' ? RING : LABEL)
        phaseTag.set(PHASE_TEXT[f.phase], phaseTone(f))
        emfTr.draw((u) => {
          const th = u * 2 * Math.PI
          const s = commutationStep(th)
          const fl = floatingPhase(s)
          return yE(f.emf * (2 * (phaseVolts(s, stepProgress(th), fl, 1, 1) - 0.5)))
        }, null)
        zcDots.forEach((d) => (d.visible = f.zc))
        angCur((((f.theta / (2 * Math.PI)) % 1) + 1) % 1)
        tCur(t / HS.seconds)
      },
      readouts: (p) => {
        const q = hallParams(p)
        const f = fixedStepAt(hallMemo(q), st.t, START_FRAME_S)
        return [
          { label: 'Sim time', value: `${msText(st.t)} (${HS.slow}× slower)` },
          { label: 'Speed', value: rpmText(rpmOf(f.w)) },
          { label: 'Back-EMF', value: `${f.emf.toFixed(2)} V`, tone: f.zc ? 'ok' : 'warn' },
          { label: 'Commutation', value: q.sense === 'hall' ? 'Hall code' : f.phase === 'closed' ? 'zero crossing' : f.phase === 'desync' ? 'lost sync' : 'blind', tone: f.phase === 'desync' ? 'bad' : f.phase === 'align' || f.phase === 'ramp' ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- ESC basics: a hobby ESC takes a throttle signal, arms at zero, ramps, limits current and heat; LiPo cells set top speed. ---

const MODES = { pwm: 'PWM 1–2 ms', dshot: 'DShot600', d3d: 'DShot 3D (reversible)' }
const CELLS = { s2: '2S LiPo', s3: '3S LiPo', s4: '4S LiPo' }
const CELL_N = { s2: 2, s3: 3, s4: 4 }
const EC = { seconds: 6, bat: [-14.2, 1.4, 0] as V3, esc: [-6.6, 1.4, 0] as V3, motor: [1.2, 2.2, 0] as V3, r: 1.6, rpmMax: 30000 }
const STATE_TEXT = { boot: 'Power-up tones', arming: 'Arming: waiting for zero throttle', armed: 'Armed: beep, ready', run: 'Running', limit: 'Current limit: duty cut back', hot: 'Too hot: limit derated' }
const escParams = (p: Params) => {
  const mode = pick(MODES, p.mode, 'dshot')
  const cells = CELL_N[pick(CELLS, p.cells, 's3')]
  const thr = n(p, 'thr') / 100
  const threeD = mode === 'd3d'
  return { mode, cells, thr, threeD, volts: packVolts(cells), cmd: threeD ? thr : Math.max(0, thr), blocked: !threeD && thr < 0 }
}
type EscQ = ReturnType<typeof escParams>
const escKey = (q: EscQ) => `${q.cells}|${q.cmd}|${q.threeD}`
const escMemo = memoBy(escKey, (q: EscQ) => escRun(q.cells, q.cmd, q.threeD, EC.seconds))
const signalOf = (q: EscQ, cmd: number) => (q.mode === 'pwm' ? `${escPulseUs(cmd)} µs` : `DShot ${dshotValue(cmd, q.threeD)}`)

export const escBasics: Lesson = {
  id: 'brushless-bldc-esc-basics',
  title: 'ESC basics',
  tagline: 'Throttle in, three phases out',
  formula: (p) => {
    const q = escParams(p)
    const v = dshotValue(q.cmd, q.threeD)
    const sig = q.mode === 'pwm' ? `pulse = 1000 + 1000 × ${q.cmd.toFixed(2)} = ${escPulseUs(q.cmd)} µs` : `DShot ${v} → frame 0x${dshotFrame(v).toString(16).toUpperCase().padStart(4, '0')} (value, telemetry bit, XOR checksum)`
    return `${q.cells}S × ${LIPO.nominalV} V = ${q.volts.toFixed(1)} V · no load ${ESC_MOTOR.kv} KV × ${q.volts.toFixed(1)} V = ${rpmText(noLoadRpm(ESC_MOTOR.kv, q.volts))}, with 5" prop at full ${rpmText(rpmOf(propSpeed(q.volts, 1)))} @ ${propAmps(q.volts, 1).toFixed(0)} A · ${sig}`
  },
  legend: [
    { color: PIN_COLOR, label: 'Throttle signal', shape: 'dot' },
    { color: POWER, label: 'Motor speed', shape: 'dot' },
    { color: HEAT, label: 'Battery current', shape: 'dot' },
    { color: HIGH_V, label: 'ESC temperature', shape: 'dot' },
  ],
  points: [
    'An ESC (electronic speed controller) is the six-FET bridge plus a small MCU running sensorless six-step firmware (BLHeli, Bluejay, AM32). Battery in, three phase wires out, and one signal wire from the flight controller or receiver.',
    'The classic signal is a servo pulse: 1000 µs = stop, 2000 µs = full, 50–490 times a second. It is analog timing, so each ESC must be calibrated to the endpoints. DShot sends the throttle as a 16-bit digital frame (11-bit value 48…2047, telemetry bit, checksum): no calibration, no jitter, bad frames rejected.',
    'For safety an ESC only arms after it sees zero throttle for a moment after power-up (the beeps, one tone per stage). Plug in a battery with the stick up and it refuses to spin. Then it slews the duty up rather than jumping, so the start-up can\'t lose sync or brown out the pack.',
    'Current rises with speed cubed on a prop: a 4S pack gives 1.4× the voltage of 3S but asks ~1.6× the current. A 30 A ESC holds its current limit by cutting duty and, when its FETs pass ~100 °C, lowers the limit further. Top speed is KV × pack voltage, minus the prop\'s load.',
    'Reversing: a normal ESC spins one way (swap any two phase wires, or set it in the config). 3D mode splits the DShot range, 48…1047 backwards and 1049…2047 forwards, for crawlers and flip-over drones; the ESC brakes through zero before it reverses.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'dshot' },
    { kind: 'choice', key: 'cells', options: opts(CELLS), initial: 's3' },
    { kind: 'slider', key: 'thr', label: 'Throttle', min: -100, max: 100, step: 5, initial: 60, format: (v) => `${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const pack = add(scene, new THREE.Group(), EC.bat)
    const pouches = [0, 1, 2, 3].map((k) => box(pack, [1.05, 3.4, 2.6], mat('#2b2f38', { rough: 0.5 }), [(k - 1.5) * 1.15, 0, 0]))
    const sticker = box(pack, [4.4, 1.2, 0.05], mat('#e8c547', { rough: 0.6 }), [0, 0, 1.33])
    const packTag = liveLabel(scene, [EC.bat[0], EC.bat[1], 1.45], { size: 0.36, color: '#1c1c1f', glow: false })
    const voltTag = liveLabel(scene, [EC.bat[0], EC.bat[1] - 2.6, 0.4], { size: 0.36 })

    const escMat = new THREE.MeshStandardMaterial({ color: '#2a5bd7', emissive: HEAT, emissiveIntensity: 0, roughness: 0.55 })
    box(scene, [4, 1.8, 1], escMat, EC.esc)
    addLabel(scene, '30 A ESC', [EC.esc[0], EC.esc[1], 0.6], '#ffffff', 0.36)
    const waves = heatWaves(scene, 2, { count: 3, rise: 1.6 })
    waves.group.position.set(EC.esc[0] - 1, EC.esc[1] + 1.2, 0.6)
    const escR = EC.esc[0] + 2
    const escL = EC.esc[0] - 2
    const packR = EC.bat[0] + 2.3
    wire(scene, [[packR, EC.bat[1] + 0.5, 0], [escL, EC.esc[1] + 0.5, 0]], 0.12)
    wire(scene, [[packR, EC.bat[1] - 0.5, 0], [escL, EC.esc[1] - 0.5, 0]], 0.12)
    const plus = litWire(scene, [[packR, EC.bat[1] + 0.5, 0], [escL, EC.esc[1] + 0.5, 0]], 0.2)
    const espPin = esp32Board(scene, [-11.6, 7.6, 0], 0.26)
    const sigA = espPin(4, false)
    const sigPath: V3[] = [sigA, [sigA[0], 5.2, 0], [EC.esc[0], 5.2, 0], [EC.esc[0], EC.esc[1] + 0.9, 0]]
    wire(scene, sigPath, 0.07)
    const sigGlow = litWire(scene, sigPath, 0.14)
    addLabel(scene, 'signal', [EC.esc[0] + 0.9, 4.6, 0.3], PIN_COLOR, 0.32, 'left')

    const motor = bldcMotor(scene, EC.motor, EC.r, { phaseColors: PHASE_COLORS })
    motor.pins.forEach((pin, k) => {
      const y = EC.esc[1] + 0.5 - k * 0.5
      const yb = pin[1] - 0.6 - k * 0.3
      wire(scene, [[escR, y, 0], [escR + 1 + k * 0.4, y, 0], [escR + 1 + k * 0.4, yb, 0], [pin[0], yb, 0], pin], 0.07)
    })
    const prop = add(motor.rotor, new THREE.Group(), [0, 0, motor.shaftTip[2]])
    const bladeMat = mat('#e9edf2', { rough: 0.5 })
    bladeMat.transparent = true
    bladeMat.opacity = 0.35
    for (const s of [1, -1]) box(prop, [0.5, 2 * EC.r, 0.1], bladeMat, [0, s * 1.1 * EC.r, 0]).rotation.y = 0.35 * s
    const spinTag = liveLabel(scene, [EC.motor[0], EC.motor[1] + 3.4, 0.6], { size: 0.38 })

    const sig = scope(scene, 7.6, 2.4, { divs: [10, 2], zeroAt: 0.2 })
    sig.group.position.set(10, 3.6, 0)
    const sigTr = sig.trace(PIN_COLOR, { samples: 140, radius: 0.05 })
    const sigTag = liveLabel(scene, [10, 1.7, 0.3], { size: 0.3, color: GREY })

    const hist = scope(scene, 7.6, 4.4, { divs: [12, 4], zeroAt: 0.5 })
    hist.group.position.set(10, -3.6, 0)
    const yH = (v: number) => v * (hist.height / 2)
    const rpmTr = hist.trace(POWER, { samples: 300, radius: 0.05 })
    const ampTr = hist.trace(HEAT, { samples: 300, radius: 0.05 })
    const tmpTr = hist.trace(HIGH_V, { samples: 300, radius: 0.05 })
    hist.level(HEAT, 0.3).set(yH(ESC.limitA / 40))
    const hCur = cursorBar(hist, LABEL)
    ticks(hist, [0, 2, 4, 6].map((s): [number, string] => [s / EC.seconds, `${s}`]), [], 0.34)
    addLabel(scene, `±${EC.rpmMax / 1000}k rpm · 40 A · 130 °C vs time (s)`, [10, -7.1, 0.3], GREY, 0.3)
    const result = liveLabel(scene, [10, -8.1, 0.3], { size: 0.38 })
    const code = codeBlock(scene, [-16.6, -7.4, 0.3], 0.38)

    const clock = simClock(0.001, 2)
    const st = { t: 0, angle: 0, key: '', sigKey: '' }
    return {
      scene,
      view: { center: [-2.2, -0.2, 0], radius: 60, polar: 1.48, azimuth: 0.1 },
      frame(dt, p) {
        const q = escParams(p)
        const run = escMemo(q)
        const key = escKey(q)
        const t = clock(dt, key, EC.seconds * 1000) / 1000
        st.t = t
        if (key !== st.key) {
          st.key = key
          pouches.forEach((m, k) => {
            m.visible = k < q.cells
            m.position.x = (k - (q.cells - 1) / 2) * 1.15
          })
          sticker.scale.x = q.cells / 4
          packTag.set(`${q.cells}S ${q.volts.toFixed(1)}V`, '#1c1c1f')
          voltTag.set(`${q.cells} × ${LIPO.nominalV} V (${(q.cells * LIPO.fullV).toFixed(1)} V full)`, LABEL)
          const pts = run.filter((_, i) => i % 2 === 0)
          const us = pts.map((f) => f.t / EC.seconds)
          rpmTr.points(us, pts.map((f) => yH(f.rpm / EC.rpmMax)))
          ampTr.points(us, pts.map((f) => yH(f.amps / 40)))
          tmpTr.points(us, pts.map((f) => yH(f.tempC / 130)))
          const end = run[run.length - 1]
          result.set(
            q.blocked ? 'Reverse needs 3D mode: ESC holds stop' : end.state === 'hot' ? `Thermal derate: ${end.amps.toFixed(0)} A at ${end.tempC.toFixed(0)} °C` : end.state === 'limit' ? `Current-limited at ${ESC.limitA} A` : q.cmd === 0 ? 'Armed, idle' : `${end.rpm < 0 ? 'Reversed: ' : ''}${rpmText(Math.abs(end.rpm))} at ${end.amps.toFixed(1)} A`,
            q.blocked || end.state === 'hot' ? HIGH_V : end.state === 'limit' ? HEAT : POWER,
          )
        }
        const f = fixedStepAt(run, t, ESC_FRAME_S)
        const sent = escCommand(f.t, q.cmd)
        const sigKey = `${q.mode}|${sent}|${q.threeD}`
        if (sigKey !== st.sigKey) {
          st.sigKey = sigKey
          const yS = (h: number) => (h ? 0.8 : -0.8)
          if (q.mode === 'pwm') {
            const us = escPulseUs(sent)
            sigTr.draw((u) => yS(u * 2500 > 200 && u * 2500 < 200 + us ? 1 : 0), null)
            sigTag.set(`${us} µs pulse${sent !== q.cmd ? ' (arming)' : ''}, 0…2.5 ms window, every 20 ms`, GREY)
          } else {
            const v = dshotValue(sent, q.threeD)
            const bits = dshotBits(dshotFrame(v))
            sigTr.draw((u) => {
              const b = u * 16
              const i = Math.min(15, Math.floor(b))
              return yS(b - i < (bits[i] ? DSHOT600.one : DSHOT600.zero) ? 1 : 0)
            }, null)
            sigTag.set(`${sent !== q.cmd ? 'arming: DShot 0 · ' : ''}${bits.join('')} · ${(16 * DSHOT600.bitUs).toFixed(1)} µs`, GREY)
          }
          code(
            q.mode === 'pwm'
              ? ['esc.writeMicroseconds(1000); delay(2000);  // arm at zero', `esc.writeMicroseconds(${escPulseUs(q.cmd)});  // ${Math.round(q.cmd * 100)} %`, q.blocked ? '// below 1000 µs is just stop: no reverse' : '// 50 Hz servo pulse; calibrate end points once']
              : ['for (int i = 0; i < 300; i++) dshot.send(0);  // arm', `dshot.send(${dshotValue(q.cmd, q.threeD)});  // every loop, ≥ 1 kHz`, q.threeD ? '// 3D: 48…1047 back, 1049…2047 forward' : q.blocked ? '// set 3D mode (or DIR command) to reverse' : '// 600 kbit/s, checksum, no calibration'],
          )
        }
        const visW = (f.rpm / EC.rpmMax) * 2 * Math.PI * 2.2
        st.angle += visW * dt
        const e = commutationStep(st.angle)
        motor.set(st.angle, Math.abs(f.duty) > 0.01 ? ampsOf(e).map((a) => a * Math.min(1, 0.3 + Math.abs(f.duty))) : [0, 0, 0])
        hCur(t / EC.seconds)
        const heat = Math.max(0, (f.tempC - 40) / 80)
        escMat.emissiveIntensity = heat * 0.9
        waves.step(dt, f.tempC > 80 ? 1 : 0)
        plus.set(Math.min(1, f.amps / 30), lit(HIGH_V))
        sigGlow.set(f.state === 'boot' ? 0.05 : 0.3 + 0.5 * Math.abs(Math.sin(st.t * 30)), lit(PIN_COLOR))
        const state = q.blocked && f.state !== 'boot' && f.state !== 'arming' ? 'Armed: negative throttle = stop' : STATE_TEXT[f.state]
        spinTag.set(f.state === 'boot' ? `beep × ${q.cells} cells` : state, f.state === 'hot' ? HIGH_V : f.state === 'limit' || f.state === 'arming' ? HEAT : f.state === 'boot' ? RING : POWER)
      },
      readouts: (p) => {
        const q = escParams(p)
        const f = fixedStepAt(escMemo(q), st.t, ESC_FRAME_S)
        const sent = escCommand(f.t, q.cmd)
        return [
          { label: 'Sim time', value: `${msText(st.t)} (real time)` },
          { label: 'Throttle', value: signalOf(q, sent), tone: q.blocked || sent !== q.cmd ? 'warn' : 'ok' },
          { label: 'Speed / current', value: `${rpmText(f.rpm)} · ${f.amps.toFixed(1)} A`, tone: f.amps >= ESC.limitA - 0.1 ? 'warn' : 'ok' },
          { label: 'ESC temperature', value: `${f.tempC.toFixed(0)} °C`, tone: f.tempC > ESC.hotC ? 'bad' : f.tempC > 70 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
