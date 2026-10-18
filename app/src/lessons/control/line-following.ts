import * as THREE from 'three/webgpu'
import {
  CAR,
  Detector,
  GRID,
  JunctionCfg,
  JunctionFrame,
  JunctionState,
  PD_RUN,
  Pose,
  SteerCfg,
  SteerFrame,
  TCRT,
  TurnDir,
  WHEEL_TOP,
  barAt,
  darkness,
  errorSweep,
  fixedStepAt,
  gridTapes,
  junctionOutcome,
  junctionRun,
  sCourse,
  sensorX,
  steerRun,
  steerSeconds,
  steerStats,
  sweepHalf,
  sweepStats,
  turnWheels,
} from '../../core/physics'
import { signed, mmTenths } from '../../core/units'
import { V3, add, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  DATA_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  IR_TINT,
  LABEL,
  PID_COLORS,
  POWER,
  RING,
  SIDE_SCOPE,
  LINE_FLOOR,
  LINE_TAPE,
  addLabel,
  addRod,
  controlLoop,
  diffBot,
  flatBox,
  floorTrail,
  floorView,
  glowMat,
  liveLabel,
  memoBy,
  moduleBlock,
  noseBar,
  pointCloud,
  scopeLabels,
  setGlow,
  statusHeader,
  tapeFloor,
  stretchRod,
  termBars,
  traceRun,
  sideScope,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const VIEW = { center: [-2.2, -1.3, 0] as V3, radius: 54, polar: 1.45, azimuth: 0 }
const DIAG = { at: [SIDE_SCOPE.x, 2.4, 0] as V3, w: 12.5, h: 3.6 }
const SCOPE = { y: -4.4, h: 4.6 }
const smm = (m: number) => `${signed(m * 1000, 1)} mm`

// --- Error from sensors: a jig slides the tape under the bar; the weighted average is the error e. ---

const COUNTS = { '3': '3 sensors', '5': '5 sensors', '7': '7 sensors' }
const READS = { analog: 'Analog, weighted', digital: 'Digital, thresholded' }
const EF = { px: -9.6, py: -2.6, w: 15, h: 5.2, span: 13, period: 8, max: 7 }
const efParams = (p: Params) => ({ pitch: n(p, 'pitch') / 1000, count: Number(pick(COUNTS, p.count, '5')), digital: pick(READS, p.mode, 'analog') === 'digital' })
type EfQ = ReturnType<typeof efParams>
const efKey = (q: EfQ) => `${q.pitch}|${q.count}|${q.digital}`
const efRun = memoBy(efKey, (q: EfQ) => {
  const sweep = errorSweep(q.pitch, q.count, q.digital)
  return { sweep, stats: sweepStats(sweep), half: sweepHalf(q.pitch, q.count) }
})
const xsText = (q: EfQ) => Array.from({ length: q.count }, (_, i) => Math.round(sensorX(i, q.pitch, q.count) * 1000)).join(', ')

export const errorFromSensors: Lesson = {
  id: 'line-following-error-from-sensors',
  title: 'Error from sensors',
  tagline: 'Five darkness readings become one signed number: e',
  formula: (p) => {
    const q = efParams(p)
    return `w_i = (ADC_i − white) / (black − white)${q.digital ? ' → 0 or 1' : ''} · e = Σ w_i·x_i / Σ w_i, x_i = ${xsText(q)} mm · Σ w < 0.08 → lost`
  },
  legend: [
    { color: DATA_COLOR, label: 'Raw ADC per sensor (dark tape = high)', shape: 'dot' },
    { color: RING, label: 'Measured position e (marker, scope)', shape: 'dot' },
    { color: GREY, label: 'Scope: perfect reading, e = true offset', shape: 'dot' },
    { color: HIGH_V, label: 'Line lost: no sensor sees tape', shape: 'dot' },
  ],
  points: [
    'Steering needs one signed number: how far the line is from the middle of the bar. Each TCRT5000 gives a darkness 0…1 (how the sensor works: Sensors → Infrared → Line follower); the weighted average Σw·x / Σw turns them into millimetres. That is the error e, positive with the line to the right.',
    'The average only interpolates while the tape covers two sensors at once. With the pitch at or below the 18 mm tape width, e follows the truth to within ~3 mm across the bar. Spread the sensors wider and e sticks to the nearest one, then jumps: an S-shaped staircase.',
    'Thresholding each sensor (digital) throws the in-between away: only 2n − 1 values, 7.5 mm apart at 15 mm pitch. P steering then moves in jumps and the D term sees spikes (see PID → Derivative kick).',
    'e only exists while some sensor sees tape: about half the bar plus half the tape. Past that Σw → 0 and the code must remember which side the line went and turn back toward it. More sensors widen the range, closer ones make it smoother.',
  ],
  controls: [
    { kind: 'slider', key: 'pitch', label: 'Sensor pitch', min: 8, max: 30, step: 1, initial: 15, format: (v) => `${v} mm` },
    { kind: 'choice', key: 'count', options: opts(COUNTS), initial: '5' },
    { kind: 'choice', key: 'mode', options: opts(READS), initial: 'analog' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    flatBox(scene, [EF.w, EF.h, 0.1], mat(LINE_FLOOR, { rough: 0.9 }), [EF.px, EF.py, -0.25])
    const tape = flatBox(scene, [1, EF.h, 0.06], mat(LINE_TAPE, { rough: 0.8 }), [EF.px, EF.py, -0.15])
    const sy = EF.py + 1.2
    const barY = EF.py + EF.h / 2 + 0.4
    const body = flatBox(scene, [1, 0.5, 0.3], mat('#202226', { rough: 0.6 }), [EF.px, sy, 0.15])
    const mods = Array.from({ length: EF.max }, () => {
      const g = add(scene, new THREE.Group())
      const pcb = flatBox(g, [1, 1, 0.4], mat('#18191c', { rough: 0.6 }), [0, 0, 0.4])
      const spot = glowMat(IR_TINT, 0.5)
      const disc = add(g, mesh(new THREE.CircleGeometry(0.5, 20), spot), [0, -0.9, 0.02])
      const barM = glowMat(DATA_COLOR, 0.9)
      const bar = addRod(scene, barM)
      const val = liveLabel(scene, [0, 0, 0.3], { size: 0.26 })
      return { g, pcb, disc, spot, bar, val }
    })
    const marker = add(scene, mesh(new THREE.ConeGeometry(0.3, 0.8, 16), glowMat(RING, 1.2)))
    marker.rotation.z = Math.PI
    marker.castShadow = false
    const posTag = liveLabel(scene, [EF.px, EF.py - EF.h / 2 - 0.7, 0.3], { size: 0.34 })

    const loop = controlLoop(scene, DIAG.at, { ctrl: 'PD', plant: 'motors', sensor: 'IR bar → e', w: DIAG.w, h: DIAG.h })
    const plot = sideScope(scene, SCOPE.y, SCOPE.h, { divs: [8, 6] })
    const idealTr = plot.trace(GREY, { samples: 2, radius: 0.04 })
    const meas = pointCloud(plot.group, 241, 0.05)
    const nowTr = plot.trace(POWER, { samples: 1, radius: 0.06 })
    scopeLabels(scene, SCOPE.y, SCOPE.h, null, 'measured e', 'vs true offset')
    const axL = liveLabel(scene, [SIDE_SCOPE.x - SIDE_SCOPE.w / 2, SCOPE.y - SCOPE.h / 2 - 1.1, 0.3], { size: 0.26, color: GREY, align: 'left' })
    const axR = liveLabel(scene, [SIDE_SCOPE.x + SIDE_SCOPE.w / 2, SCOPE.y - SCOPE.h / 2 - 1.1, 0.3], { size: 0.26, color: GREY, align: 'right' })
    const yH = (SCOPE.h / 2) * 0.95

    const st = { key: '', t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = efParams(p)
        const { sweep, half } = efRun(q)
        const u = (off: number) => (off + half) / (2 * half)
        const yOf = (pos: number) => (pos / half) * yH
        if (efKey(q) !== st.key) {
          st.key = efKey(q)
          st.t = 0
          idealTr.points([0, 1], [-yH, yH])
          sweep.forEach((s, k) => meas.set(k, [(u(s.off) - 0.5) * SIDE_SCOPE.w, s.pos === null ? 0 : yOf(s.pos), 0.3], s.pos === null ? HIGH_V : RING))
          meas.show(sweep.length)
          axL.set(`tape ${mmTenths(-half)}`, GREY)
          axR.set(`+${mmTenths(half)}`, GREY)
        }
        st.t += dt
        const off = half * Math.sin((2 * Math.PI * st.t) / EF.period)
        const r = barAt(off, q.pitch, q.count, q.digital)
        const s = EF.span / (2 * half)
        tape.scale.x = TCRT.lineM * s
        tape.position.x = EF.px + off * s
        const modW = Math.min(0.85 * q.pitch, 0.011) * s
        body.scale.x = ((q.count - 1) * q.pitch) * s + modW + 0.4
        mods.forEach((m, i) => {
          m.g.visible = m.val.group.visible = m.bar.visible = i < q.count
          if (i >= q.count) return
          const x = EF.px + sensorX(i, q.pitch, q.count) * s
          m.g.position.set(x, sy, 0)
          m.pcb.scale.set(modW, 0.9, 1)
          m.disc.scale.setScalar(Math.max(0.25, TCRT.spotM * s * 0.5))
          const d = darkness(r.adc[i])
          setGlow(m.spot, IR_TINT, 0.25 + 1.1 * (1 - d))
          const top = barY + 0.05 + (r.adc[i] / 4095) * 3.2
          stretchRod(m.bar, [x, barY, 0.3], [x, top, 0.3], Math.min(0.35, modW * 0.35))
          m.val.group.position.set(x, top + 0.35, 0.3)
          m.val.set(`${r.adc[i]}`, DATA_COLOR)
        })
        marker.visible = r.pos !== null
        if (r.pos !== null) marker.position.set(EF.px + r.pos * s, EF.py - 0.6, 0.6)
        posTag.set(r.pos === null ? `true ${smm(off)} · line lost` : `e ${smm(r.pos)} · true ${smm(off)} · error ${mmTenths(Math.abs(r.pos - off))}`, r.pos === null ? HIGH_V : RING)
        nowTr.points([u(off)], [r.pos === null ? 0 : yOf(r.pos)])

        const e = r.pos ?? 0
        loop.set(dt, { r: 0.4, e: Math.min(1, Math.abs(e) / half), u: Math.min(1, Math.abs(e) / half), y: 0.5, m: r.pos === null ? 0 : 0.7 }, {
          r: 'line centre: 0',
          e: r.pos === null ? 'lost' : `e ${smm(e)}`,
          u: r.pos === null ? 'turn to last side' : e > 0.002 ? 'steer right' : e < -0.002 ? 'steer left' : 'straight',
          y: `true ${smm(off)}`,
          m: r.pos === null ? 'Σw ≈ 0' : smm(r.pos),
        })
        status.set(`${q.count} × TCRT5000 at ${Math.round(q.pitch * 1000)} mm pitch · ${q.digital ? 'thresholded' : 'analog weighted'}`, LABEL)
        const err = r.pos === null ? 0 : Math.abs(r.pos - off)
        if (r.pos === null) event.set(`no sensor sees the tape: e is undefined, steer toward the last side`, HIGH_V)
        else if (err > 0.003)
          event.set(
            `reading is ${mmTenths(err)} off the truth: ${q.digital ? 'thresholds round it to a step' : Math.abs(off) > sensorX(q.count - 1, q.pitch, q.count) ? 'past the outer sensor, e saturates' : 'only one sensor over the tape, nothing to interpolate'}`,
            HEAT,
          )
        else event.set(`tape under ${r.adc.filter((a) => darkness(a) > 0.05).length} sensors: the average interpolates between them`, POWER)
        sub.set(`jig slides the 18 mm tape ±${mmTenths(half)} every ${EF.period} s · 3 mm Gaussian spot per sensor · 12-bit ADC`)
      },
      readouts: (p) => {
        const q = efParams(p)
        const s = efRun(q).stats
        return [
          { label: 'Tracks within ±3 mm', value: s.range > 0.004 ? `±${mmTenths(s.range)}` : 'only near 0', tone: s.range > 0.02 ? 'ok' : 'warn' },
          { label: 'Line lost beyond', value: s.lostAt === null ? '—' : `±${mmTenths(s.lostAt)}` },
          { label: 'Blind gaps between sensors', value: s.blindM > 0 ? mmTenths(s.blindM) : 'none', tone: s.blindM > 0 ? 'bad' : 'ok' },
          { label: 'Distinct readings', value: s.levels > 60 ? 'smooth' : `${s.levels}`, tone: s.levels > 60 ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- PD steering: P weaves once the motor lag outruns the bar's lead; D adds the lead back. ---

const PD = { at: [-14.6, -4.4, 0] as V3, k: 10, tilt: -0.3, slow: 0.5, rest: 1, fx: [-0.2, 1.45] as [number, number], fy: [-0.08, 0.42] as [number, number] }
const pdParams = (p: Params): SteerCfg => ({ v: n(p, 'speed'), kp: n(p, 'kp'), kd: n(p, 'kd'), r: 0.12 })
const pdKey = (c: SteerCfg) => `${c.v}|${c.kp}|${c.kd}`
const pdRun = memoBy(pdKey, (c: SteerCfg) => {
  const run = steerRun(c)
  const ghost = steerRun({ ...c, kd: 0 })
  return { run, ghost, seconds: steerSeconds(c), stats: steerStats(run), ghostStats: steerStats(ghost) }
})
const turnPct = (t: number) => `${Math.round(t * 100)} %`

export const pdSteering: Lesson = {
  id: 'line-following-pd-steering',
  title: 'PD steering',
  tagline: 'Fast cars weave on P alone; D steers against the slide',
  formula: (p) => {
    const c = pdParams(p)
    return `turn = Kp·e + Kd·de/dt = ${c.kp}·e + ${c.kd}·ė, clamped ±${PD_RUN.maxTurn * 100} % · left = v(1 + turn), right = v(1 − turn), each ≤ ${WHEEL_TOP.toFixed(2)} m/s · motors lag ~0.12 s`
  },
  legend: [
    { color: RING, label: 'This car (Kd as set): trail, error e', shape: 'dot' },
    { color: GREY, label: 'Ghost: same Kp, P only (Kd = 0)', shape: 'dot' },
    { color: PID_COLORS.p, label: 'P term · D term · turn command (bars)', shape: 'dot' },
    { color: IR_TINT, label: 'Bar spots: pink on floor, yellow on tape', shape: 'dot' },
  ],
  points: [
    'The bar sits 9 cm ahead of the wheels, so e already contains the heading: a car pointing back at the line sees e shrink before it gets there. That lead is free damping, and at low speed P alone settles without a swing.',
    'Speed eats the lead. The TT motors need ~0.12 s to change speed: 2.4 cm of travel at 0.2 m/s, nearly 10 cm at 0.8 m/s, more than the bar\'s 9 cm. The correction lands late, the car overshoots and weaves, and more Kp only makes it weave faster.',
    'D puts the lead back: Kd·de/dt steers against how fast the line slides across the bar, so the car eases off before it crosses. Same Kp, same speed, and the weave dies in a swing. Too much Kd and every step in e becomes a twitch (filter it, see PID → Derivative kick).',
    'Line followers usually run PD, no I: on a steady bend P leaves only a small e (the turn needed ÷ Kp), and an I term would wind up every time the line is lost. Tuning: raise the speed until it weaves, add Kd until it stops, repeat.',
  ],
  controls: [
    { kind: 'slider', key: 'speed', label: 'Base speed', min: 0.2, max: 0.9, step: 0.05, initial: 0.7, format: (v) => `${v.toFixed(2)} m/s` },
    { kind: 'slider', key: 'kp', label: 'Kp (turn per metre)', min: 20, max: 200, step: 10, initial: 120, format: (v) => `${v}` },
    { kind: 'slider', key: 'kd', label: 'Kd (turn per m/s)', min: 0, max: 4, step: 0.25, initial: 1.5, format: (v) => v.toFixed(2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = floorView(scene, PD.at, PD.k, PD.tilt)
    tapeFloor(g, sCourse(), PD.fx, PD.fy)
    const trail = floorTrail(g, 500, 0.008, RING)
    const ghostTrail = floorTrail(g, 500, 0.008, GREY)
    const ghost = diffBot(g, { ghost: GREY })
    const bot = diffBot(g)
    const lights = noseBar(bot.group)
    const bars = termBars(scene, [-11.5, -7.4, 0], 6)

    const loop = controlLoop(scene, DIAG.at, { ctrl: 'PD', plant: 'motors + car', sensor: 'IR bar', w: DIAG.w, h: DIAG.h })
    const plot = sideScope(scene, SCOPE.y, SCOPE.h, { divs: [6, 4] })
    const gTr = plot.trace(GREY, { samples: 300, radius: 0.04 })
    const eTr = plot.trace(RING, { samples: 300, radius: 0.06 })
    scopeLabels(scene, SCOPE.y, SCOPE.h, null, 'error e ±30 mm', 'P only (grey)')
    const axR = liveLabel(scene, [SIDE_SCOPE.x + SIDE_SCOPE.w / 2, SCOPE.y - SCOPE.h / 2 - 1.1, 0.3], { size: 0.26, color: GREY, align: 'right' })
    addLabel(scene, '0', [SIDE_SCOPE.x - SIDE_SCOPE.w / 2, SCOPE.y - SCOPE.h / 2 - 1.1, 0.3], GREY, 0.26, 'left')
    const yE = (f: SteerFrame) => Math.max(-1, Math.min(1, (f.pos ?? f.e) / 0.03)) * (SCOPE.h / 2) * 0.95

    const st = { key: '', t: 0, prev: null as Pose | null, gPrev: null as Pose | null }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const c = pdParams(p)
        const { run, ghost: gRun, seconds, stats } = pdRun(c)
        const restart = () => {
          st.t = 0
          st.prev = st.gPrev = null
          trail.clear()
          ghostTrail.clear()
        }
        if (pdKey(c) !== st.key) {
          st.key = pdKey(c)
          restart()
          axR.set(`${seconds.toFixed(1)} s`, GREY)
        }
        st.t += dt * PD.slow
        if (st.t > seconds + PD.rest) restart()
        const t = Math.min(st.t, seconds)
        const f = fixedStepAt(run, t, PD_RUN.dt)
        const gf = fixedStepAt(gRun, t, PD_RUN.dt)
        bot.set(f.pose, f.dL, f.dR)
        ghost.set(gf.pose)
        ghost.group.visible = c.kd > 0
        lights(f.adc)
        if (st.prev) trail.add(st.prev, f.pose)
        if (st.gPrev && c.kd > 0) ghostTrail.add(st.gPrev, gf.pose)
        st.prev = f.pose
        st.gPrev = gf.pose
        traceRun(eTr, run, PD_RUN.dt, seconds, t, yE, 300)
        traceRun(gTr, gRun, PD_RUN.dt, seconds, c.kd > 0 ? t : 0, yE, 300)
        const wheels = turnWheels(c.v, f.turn)
        bars.set({ p: f.p, i: 0, d: f.d, u: f.turn }, Math.abs(f.turn) >= PD_RUN.maxTurn - 1e-9)

        loop.set(dt, { r: 0.4, e: Math.min(1, Math.abs(f.e) / 0.02), u: Math.min(1, Math.abs(f.turn)), y: f.done ? 0 : 0.7, m: f.pos === null ? 0 : 0.7 }, {
          r: 'e = 0',
          e: f.pos === null ? 'lost' : `e ${smm(f.e)}`,
          u: `turn ${turnPct(f.turn)}`,
          y: f.done ? 'stopped' : `L ${wheels[0].toFixed(2)} · R ${wheels[1].toFixed(2)} m/s`,
          m: f.pos === null ? 'Σw ≈ 0' : smm(f.pos),
        }, { ctrl: c.kd > 0 ? 'PD' : 'P only' })
        status.set(`${c.v.toFixed(2)} m/s · Kp ${c.kp} · Kd ${c.kd}${c.kd > 0 ? ' · ghost: P only' : ''}`, LABEL)
        if (f.done) event.set(`end of the tape: stopped`, GREY)
        else if (f.pos === null) event.set(`lost the line: turning toward the side it was last seen`, HIGH_V)
        else if (stats.swings > 8) event.set(`weaving: the motors lag more than the bar leads, ${stats.swings} swings across the line`, HEAT)
        else if (c.kd === 0) event.set(`P alone: turn ${turnPct(f.turn)}; at this speed the bar's 9 cm lead still damps it`, POWER)
        else event.set(`P ${turnPct(f.p)} + D ${turnPct(f.d)} → turn ${turnPct(f.turn)}: D brakes the swing before e crosses zero`, POWER)
        sub.set(`${t.toFixed(2)} / ${seconds.toFixed(1)} s · slowed ${1 / PD.slow}× · loop ${Math.round(1 / PD_RUN.dt)} Hz · starts ${mmTenths(PD_RUN.startY)} off, 12 cm bends`)
      },
      readouts: (p) => {
        const c = pdParams(p)
        const { stats, ghostStats } = pdRun(c)
        return [
          { label: 'Swings across the line: this · P only', value: `${stats.swings} · ${ghostStats.swings}`, tone: stats.swings > 8 ? 'bad' : stats.swings > 3 ? 'warn' : 'ok' },
          { label: 'RMS error e: this · P only', value: `${mmTenths(stats.rms)} · ${mmTenths(ghostStats.rms)}` },
          { label: 'Worst error from the bends on', value: mmTenths(stats.worst), tone: stats.worst > 0.025 ? 'warn' : 'ok' },
          { label: 'Line lost for', value: `${stats.lostS.toFixed(2)} s`, tone: stats.lostS > 0 ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Intersections: count crossings on rising edges, creep the wheels over the target one, spin onto the branch. ---

const JN = { at: [-14.6, -3.4, 0] as V3, k: 10, tilt: -0.45, slow: 0.6, rest: 1.2, fx: [-0.2, 1.45] as [number, number], fy: [-0.36, 0.36] as [number, number] }
const DIRS: Record<TurnDir, string> = { left: 'Turn left', right: 'Turn right', straight: 'Go straight' }
const DETECTORS: Record<Detector, string> = { edge: 'Count rising edges', level: 'Count while dark' }
const CREEP = { creep: 'Creep, then spin', spin: 'Spin at once' }
const STATES: JunctionState[] = ['follow', 'creep', 'spin', 'done']
const STATE_C: Record<JunctionState, string> = { follow: RING, creep: POWER, spin: HEAT, done: GREY }
const jnParams = (p: Params): JunctionCfg => ({
  v: n(p, 'speed'),
  target: Math.round(n(p, 'target')),
  dir: pick(DIRS, p.dir, 'left'),
  detector: pick(DETECTORS, p.detector, 'edge'),
  creep: pick(CREEP, p.creep, 'creep') === 'creep',
})
const jnKey = (c: JunctionCfg) => `${c.v}|${c.target}|${c.dir}|${c.detector}|${c.creep}`
const jnRun = memoBy(jnKey, (c: JunctionCfg) => {
  const run = junctionRun(c)
  const k = run.findIndex((f) => f.state === 'done')
  return { run, seconds: k < 0 ? GRID.seconds : Math.min(GRID.seconds, run[k].t + 0.6), out: junctionOutcome(run) }
})
const outcomeText = (c: JunctionCfg, o: ReturnType<typeof junctionOutcome>) => {
  if (c.dir === 'straight') return o.heading === 'straight' ? 'straight through' : 'left the line'
  if (o.turnedAt === null) return 'never turned'
  if (o.heading === 'back') return `back the way it came (#${o.turnedAt})`
  return `${o.heading} at #${o.turnedAt}${o.turnedAt !== c.target ? ', too early' : ''}`
}

export const intersections: Lesson = {
  id: 'line-following-intersections',
  title: 'Intersections',
  tagline: 'Count the crossings, then a small state machine makes the turn',
  formula: (p) => {
    const c = jnParams(p)
    return `junction = ≥ ${GRID.junctionAt} of 5 sensors dark · ${c.detector === 'edge' ? 'count++ when junction && !wasJunction' : 'count++ every 5 ms tick while junction'} · at count ${c.target}: ${c.creep ? `drive ${Math.round(CAR.barM * 100)} cm (bar → axle), ` : ''}spin until the middle sensor leaves and finds tape`
  },
  legend: [
    { color: RING, label: 'FOLLOW: PD on e', shape: 'dot' },
    { color: POWER, label: 'CREEP: wheels onto the crossing', shape: 'dot' },
    { color: HEAT, label: 'SPIN: until the middle sensor finds tape', shape: 'dot' },
    { color: B_FIELD, label: 'Scope: junction threshold · target count', shape: 'dot' },
  ],
  points: [
    'A plain PD follower drives straight over a crossing: the tape covers the whole bar, Σw·x / Σw stays near 0, nothing happens. To navigate a grid the robot has to notice crossings, count them and turn at the right one.',
    'A crossing shows up as most of the bar going dark at once. Count it once, on the rising edge (dark now, not dark last tick). Counting "while dark" adds one every 5 ms tick: a 2 cm crossing at 0.3 m/s is ~13 ticks, so the robot turns at the very first one.',
    'The bar sees the crossing 9 cm before the wheels reach it. Spin there and the bar sweeps a circle that never meets the branch, so it finds the old line behind and heads back (fast cars drift far enough to catch the branch anyway, at an angle). Creep 9 cm first so the robot spins on the crossing.',
    'That is a state machine: FOLLOW → CREEP → SPIN → FOLLOW, like the obstacle-avoider\'s GO/STOP/TURN. Grid robots and maze solvers are built from this plus a list of turns; the spin ends on the middle sensor, and the motors\' lag carries it a little past, which PD then trims.',
  ],
  controls: [
    { kind: 'slider', key: 'target', label: 'Turn at crossing', min: 1, max: 3, step: 1, initial: 2, format: (v) => `#${v}` },
    { kind: 'choice', key: 'dir', options: opts(DIRS), initial: 'left' },
    { kind: 'choice', key: 'detector', options: opts(DETECTORS), initial: 'edge' },
    { kind: 'choice', key: 'creep', options: opts(CREEP), initial: 'creep' },
    { kind: 'slider', key: 'speed', label: 'Base speed', min: 0.15, max: 0.5, step: 0.05, initial: 0.3, format: (v) => `${v.toFixed(2)} m/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = floorView(scene, JN.at, JN.k, JN.tilt)
    tapeFloor(g, gridTapes(), JN.fx, JN.fy)
    const flags = GRID.crossX.map((x, i) => {
      const m = glowMat(GREY, 0.4)
      add(g, mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.006, 20), m), [x + 0.05, GRID.arm + 0.025, 0.003]).rotation.x = Math.PI / 2
      addLabel(g, `${i + 1}`, [x + 0.05, GRID.arm + 0.025, 0.01], LABEL, 0.022)
      return m
    })
    const trail = floorTrail(g, 600, 0.008, RING)
    const bot = diffBot(g)
    const lights = noseBar(bot.group)
    const countTag = liveLabel(scene, [-8.4, -8.6, 0.3], { size: 0.45 })

    const chipY = DIAG.at[1] + 0.6
    const chips = STATES.map((s, i) => moduleBlock(scene, [SIDE_SCOPE.x - 4.65 + i * 3.1, chipY, 0], [2.6, 1.1, 0.4], s.toUpperCase()))
    for (let i = 0; i < 3; i++) addLabel(scene, '→', [SIDE_SCOPE.x - 3.1 + i * 3.1, chipY, 0.3], GREY, 0.4)
    const codeTag = liveLabel(scene, [SIDE_SCOPE.x - SIDE_SCOPE.w / 2, chipY - 1.5, 0.3], { size: 0.27, align: 'left' })
    const plot = sideScope(scene, SCOPE.y, SCOPE.h, { divs: [6, 4] })
    const thrTr = plot.trace(B_FIELD, { samples: 2, radius: 0.035 })
    const tgtTr = plot.trace(B_FIELD, { samples: 2, radius: 0.035 })
    const darkTr = plot.trace(DATA_COLOR, { samples: 400, radius: 0.05 })
    const cntTr = plot.trace(LABEL, { samples: 400, radius: 0.06 })
    scopeLabels(scene, SCOPE.y, SCOPE.h, null, 'sensors dark 0–5', 'count')
    const axR = liveLabel(scene, [SIDE_SCOPE.x + SIDE_SCOPE.w / 2, SCOPE.y - SCOPE.h / 2 - 1.1, 0.3], { size: 0.26, color: GREY, align: 'right' })
    addLabel(scene, '0', [SIDE_SCOPE.x - SIDE_SCOPE.w / 2, SCOPE.y - SCOPE.h / 2 - 1.1, 0.3], GREY, 0.26, 'left')
    const half = SCOPE.h / 2
    const yDark = (k: number) => 0.15 + (k / 5) * (half - 0.35)
    const yCount = (k: number, max: number) => -half + 0.2 + (Math.min(k, max) / max) * (half - 0.5)

    const st = { key: '', t: 0, prev: null as Pose | null, max: 3 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const c = jnParams(p)
        const { run, seconds, out } = jnRun(c)
        const restart = () => {
          st.t = 0
          st.prev = null
          trail.clear()
        }
        if (jnKey(c) !== st.key) {
          st.key = jnKey(c)
          restart()
          st.max = Math.max(4, out.count)
          thrTr.points([0, 1], [yDark(GRID.junctionAt - 0.5), yDark(GRID.junctionAt - 0.5)])
          tgtTr.points([0, 1], [yCount(c.target, st.max), yCount(c.target, st.max)])
          tgtTr.group.visible = c.dir !== 'straight'
          axR.set(`${seconds.toFixed(1)} s`, GREY)
          flags.forEach((m, i) => setGlow(m, c.dir !== 'straight' && i + 1 === c.target ? B_FIELD : GREY, c.dir !== 'straight' && i + 1 === c.target ? 1.2 : 0.3))
        }
        st.t += dt * JN.slow
        if (st.t > seconds + JN.rest) restart()
        const t = Math.min(st.t, seconds)
        const f = fixedStepAt(run, t, PD_RUN.dt) as JunctionFrame
        bot.set(f.pose, f.dL, f.dR)
        lights(f.adc)
        if (st.prev) trail.add(st.prev, f.pose)
        st.prev = f.pose
        traceRun(darkTr, run, PD_RUN.dt, seconds, t, (h) => yDark(h.dark), 400)
        traceRun(cntTr, run, PD_RUN.dt, seconds, t, (h) => yCount(h.count, st.max), 400)
        STATES.forEach((s, i) => chips[i](dt, STATE_C[s], f.state === s ? 1 : 0))
        codeTag.set(c.detector === 'edge' ? 'if (dark >= 4 && !wasDark) count++;' : 'if (dark >= 4) count++;  // every tick!', c.detector === 'edge' ? LABEL : HEAT)

        countTag.set(`count ${f.count}${c.dir !== 'straight' ? ` / ${c.target}` : ''} · ${f.dark} dark`, f.junction ? B_FIELD : STATE_C[f.state])
        status.set(`${DIRS[c.dir]}${c.dir !== 'straight' ? ` at crossing ${c.target}` : ''} · ${DETECTORS[c.detector].toLowerCase()} · ${c.creep ? 'creep first' : 'spin at once'}`, LABEL)
        const msg: Record<JunctionState, [string, string]> = {
          follow: f.junction ? [`junction under the bar: ${f.dark} of 5 dark`, B_FIELD] : [`following: PD keeps the middle sensor on the tape`, RING],
          creep: [`count reached ${c.target}: drive ${Math.round(CAR.barM * 100)} cm so the wheels sit on the crossing`, POWER],
          spin: [`spinning ${c.dir}: wait for the middle sensor to leave the tape, then find the next one`, HEAT],
          done: [`end of the tape: ${outcomeText(c, out)}`, out.turnedAt === c.target || (c.dir === 'straight' && out.heading === 'straight') ? POWER : HIGH_V],
        }
        event.set(...msg[f.state])
        sub.set(`${t.toFixed(2)} / ${seconds.toFixed(1)} s · slowed ${(1 / JN.slow).toFixed(1)}× · ${c.v.toFixed(2)} m/s · crossings every ${Math.round((GRID.crossX[1] - GRID.crossX[0]) * 100)} cm`)
      },
      readouts: (p) => {
        const c = jnParams(p)
        const { out } = jnRun(c)
        const good = c.dir === 'straight' ? out.heading === 'straight' : out.turnedAt === c.target && out.heading === c.dir
        return [
          { label: 'Where it went', value: outcomeText(c, out), tone: good ? 'ok' : 'bad' },
          { label: 'Crossings counted', value: `${out.count}`, tone: out.count > GRID.crossX.length ? 'bad' : 'ok' },
          { label: 'Ticks on one crossing', value: `≈ ${Math.round((TCRT.lineM + 0.004) / c.v / PD_RUN.dt)}` },
          { label: 'Bar ahead of the axle', value: `${Math.round(CAR.barM * 100)} cm` },
        ]
      },
    }
  },
}
