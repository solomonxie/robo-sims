import * as THREE from 'three/webgpu'
import {
  BarCal,
  CHASSIS,
  GRID_GOALS,
  GRID_START,
  GridGoal,
  GridState,
  LAP_DUTIES,
  LINE_BAR,
  LINE_GRID,
  Tape,
  TurnEnd,
  arraySweep,
  barDarkness,
  barPosition,
  barReadings,
  barSpot,
  dutySpeed,
  gridLines,
  gridRun,
  gridSpinS,
  junctionName,
  lapRun,
  lapSheet,
  sensorX,
  sweepHalf,
  TCRT,
  trackPoint,
} from '../../core/physics'
import { fixedText, mmTenths, mpsText, msText, pct, signed } from '../../core/units'
import { V3, add, box, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  DATA_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  IR_TINT,
  LABEL,
  LINE_FLOOR,
  LINE_TAPE,
  PIN_COLOR,
  POWER,
  RING,
  WIDE_VIEW,
  addLabel,
  addRod,
  beamCone,
  codeListing,
  countBars,
  diffBot,
  flatBox,
  floorTrail,
  floorView,
  glowMat,
  lapseClock,
  liveLabel,
  memoBy,
  noseBar,
  pointCloud,
  setGlow,
  statusHeader,
  stretchRod,
  tapeFloor,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const smm = (m: number) => `${signed(m * 1000, 1)} mm`

// --- Sensor array: a front view of the bar over a sliding tape; height, part spread and calibration. ---

const CALS: Record<BarCal, string> = { none: 'One white/black for all', sweep: 'Calibrate each sensor (sweep)' }
const SA = { cx: -8.6, floorY: -3.6, s: 0.15, hs: 0.26, period: 8, plot: { x: 8.6, y: -1.6, w: 11.8, h: 6.2 } }
const saParams = (p: Params) => ({ h: n(p, 'height') / 1000, cal: pick(CALS, p.cal, 'sweep') as BarCal })
const saRun = memoBy(
  (p: Params) => `${p.height} ${p.cal}`,
  (p: Params) => {
    const q = saParams(p)
    return { ...q, S: arraySweep(q.h, q.cal), half: sweepHalf(TCRT.pitchM, TCRT.count) }
  },
)

export const lineFollowingCarSensorArray: Lesson = {
  id: 'line-following-car-sensor-array',
  title: 'Sensor array',
  tagline: 'Five TCRT5000s under the nose: height, calibration and the right pins',
  formula: (p) => {
    const { h, cal, S } = saRun(p)
    return `spot ≈ ${mmTenths(barSpot(h))} at ${mmTenths(h)} up · weakest sensor black − white = ${S.contrast} counts (noise ±${LINE_BAR.noise}) · w_i = ${cal === 'sweep' ? '(ADC_i − white_i) / (black_i − white_i), own limits' : '(ADC_i − 328) / (3787 − 328), same for all'} · bare floor Σw = ${fixedText(S.whiteSum, 2)} ${S.lostWorks ? '< 0.08: "lost" works' : '≥ 0.08: never reads lost'} · AO → GPIO ${LINE_BAR.pins.join(', ')} (ADC1)`
  },
  legend: [
    { color: IR_TINT, label: 'IR spot (wider the higher the bar)', shape: 'dot' },
    { color: DATA_COLOR, label: 'Raw ADC per sensor', shape: 'dot' },
    { color: RING, label: 'Position the bar reports', shape: 'dot' },
    { color: GREY, label: 'Scope: perfect reading', shape: 'dot' },
  ],
  points: [
    'The Robo-car gets a bar of five TCRT5000 modules across its nose, 15 mm apart and 9 cm ahead of the wheels. How one sensor sees tape is in Sensors › Infrared › Line follower; how five readings become one error is in Control › Line following › Error from sensors. This lesson is the build: where the bar sits and how the sketch reads it.',
    'Height: the TCRT5000 couples best a few mm off the floor. At 3–8 mm the spots are small and bright. Lower, the spot is too small to blend two sensors, so the position steps, and the bar scrapes on every tape edge. Higher, the spot spreads and the light falls off: at 12 mm black and white differ by a few hundred counts and noise wins. Use spacers to get about 5 mm.',
    'No two sensors read alike: these five differ by ±20 % in gain. With one white/black pair for all, the weak one reads grey on white floor, so the line seems shifted and bare floor never reads as lost. At start-up, swing the car over the tape for two seconds and keep each sensor’s own min and max; then the weights mean the same on every channel.',
    'Wiring: VCC 3.3 V (the AO swing then fits the ESP32 ADC), GND, and five AO lines to GPIO 36, 39, 34, 35 and 32, all on ADC1. ADC2 stops reading while Wi-Fi runs (the phone remote), and its pins 25, 26, 27, 14 already drive the DRV8833.',
  ],
  controls: [
    { kind: 'slider', key: 'height', label: 'Bar height', min: 2, max: 15, step: 1, initial: 5, format: (v) => `${v} mm` },
    { kind: 'choice', key: 'cal', options: opts(CALS), initial: 'sweep' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const X = (m: number) => SA.cx + m * 1000 * SA.s
    const floorW = 2 * (sweepHalf(TCRT.pitchM, TCRT.count) + 0.012) * 1000 * SA.s
    flatBox(scene, [floorW, 0.5, 2], mat(LINE_FLOOR, { rough: 0.9 }), [SA.cx, SA.floorY - 0.25, 0])
    const tape = flatBox(scene, [TCRT.lineM * 1000 * SA.s, 0.12, 2.02], mat(LINE_TAPE, { rough: 0.8 }), [SA.cx, SA.floorY + 0.02, 0])
    const barM = mat('#202226', { rough: 0.6 })
    const pcb = box(scene, [62 * SA.s + 1.2, 0.25, 1.2], mat('#1d6fd1', { rough: 0.5 }), [SA.cx, 0, 0])
    const mods = LINE_BAR.gains.map((_, i) => {
      const x = X(sensorX(i))
      const g = add(scene, new THREE.Group(), [x, 0, 0])
      box(g, [1.4, 0.7, 0.9], barM, [0, 0, 0])
      const cone = beamCone(scene, IR_TINT)
      const spotM = glowMat(IR_TINT, 0.8)
      const spot = flatBox(scene, [1, 0.06, 1.6], spotM, [x, SA.floorY + 0.08, 0.2])
      const rodM = glowMat(DATA_COLOR, 0.9)
      const rod = addRod(scene, rodM)
      const val = liveLabel(scene, [x, 0, 0.3], { size: 0.26 })
      return { x, g, cone, spot, spotM, rod, val }
    })
    const marker = add(scene, mesh(new THREE.ConeGeometry(0.3, 0.7, 16), glowMat(RING, 1.2)))
    marker.rotation.z = Math.PI
    marker.castShadow = false
    const hTag = liveLabel(scene, [X(-0.036), 0, 0.3], { size: 0.28, align: 'right' })
    const P = SA.plot
    const plot = titledScope(scene, P.y, P.h, 'reported vs true', LABEL, 0.5, P.x, P.w)
    const ideal = plot.s.trace(GREY, { samples: 2, radius: 0.04 })
    const dots = pointCloud(plot.s.group, 241, 0.06)
    const now = plot.s.trace(POWER, { samples: 1, radius: 0.09 })
    const rows = textRows(scene, 3, -17, -6.2, 0.27, 0.62)
    const st = { key: '', t: 0 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { h, cal, S, half } = saRun(p)
        const key = `${h} ${cal}`
        const yH = (P.h / 2) * 0.95
        const yOf = (m: number) => Math.max(-P.h / 2, Math.min(P.h / 2, (m / half) * yH))
        if (key !== st.key) {
          st.key = key
          ideal.points([0, 1], [-yH, yH])
          S.points.forEach((q, k) => dots.set(k, [(k / (S.points.length - 1) - 0.5) * P.w, q.pos === null ? 0 : yOf(q.pos), 0.3], q.pos === null ? HIGH_V : RING))
          dots.show(S.points.length)
          plot.lo.set(`tape ${smm(-half)}`)
          plot.hi.set(smm(half))
        }
        st.t += dt
        const off = half * Math.sin((2 * Math.PI * st.t) / SA.period)
        const adc = barReadings(off, h, Math.floor(st.t * 20))
        const lim = cal === 'sweep' ? S.lim : null
        const pos = barPosition(adc, lim)
        const w = barDarkness(adc, lim)
        const sy = SA.floorY + h * 1000 * SA.hs + 0.35
        tape.position.x = X(off)
        pcb.position.y = sy + 0.5
        hTag.group.position.y = sy
        hTag.set(`${mmTenths(h)} up`, LABEL)
        const halfAng = Math.atan((barSpot(h) * 1000 * SA.s) / (h * 1000 * SA.hs))
        mods.forEach((m, i) => {
          m.g.position.y = sy
          m.cone([m.x, sy - 0.35, 0.4], -Math.PI / 2, halfAng, (h * 1000 * SA.hs) / Math.cos(halfAng), 0.18, IR_TINT)
          m.spot.scale.x = barSpot(h) * 2 * 1000 * SA.s
          setGlow(m.spotM, IR_TINT, 0.2 + 1.2 * (1 - w[i]))
          const base = sy + 0.9
          const top = base + 0.05 + (adc[i] / 4095) * 3
          stretchRod(m.rod, [m.x, base, 0.3], [m.x, top, 0.3], 0.3)
          m.val.group.position.set(m.x, top + 0.35, 0.3)
          m.val.set(`${adc[i]}`, DATA_COLOR)
        })
        marker.visible = pos !== null
        if (pos !== null) marker.position.set(X(pos), SA.floorY + 0.75, 0.6)
        const u = (off + half) / (2 * half)
        now.points([u], [pos === null ? 0 : yOf(pos)])
        plot.right.set(pos === null ? 'lost' : `${smm(pos)} (true ${smm(off)})`, pos === null ? HIGH_V : RING)

        const L = S.lim
        rows[0].set(`white  ${L.lo.map((v) => String(v).padStart(4)).join(' ')}   black  ${L.hi.map((v) => String(v).padStart(4)).join(' ')}`, GREY)
        rows[1].set(S.lostWorks ? `Bare floor: Σw ${fixedText(S.whiteSum, 2)}, reads "lost" correctly` : `Bare floor: Σw ${fixedText(S.whiteSum, 2)}, never reads "lost"`, S.lostWorks ? POWER : HIGH_V)
        rows[2].set(`AO → GPIO ${LINE_BAR.pins.join(', ')}: ADC1, still reads with Wi-Fi on`, GREY)
        head.status.set(`Line-following car · bar ${mmTenths(h)} up · ${cal === 'sweep' ? 'calibrated per sensor' : 'uncalibrated'}`)
        head.sub.set(`a jig slides the 18 mm tape ±${mmTenths(half)} every ${SA.period} s · gains ${LINE_BAR.gains.map((g) => pct(g)).join(' ')}`, GREY)
        const err = pos === null ? null : Math.abs(pos - off)
        head.event.set(
          S.contrast < 600 ? `Too high: only ${S.contrast} counts between black and white, noise swamps it` : err === null ? 'No sensor sees tape: lost, turn toward the last side' : err > 0.003 ? `Reading ${mmTenths(err)} off the truth` : 'Reading tracks the tape',
          S.contrast < 600 ? HIGH_V : err === null ? HEAT : err > 0.003 ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const { S } = saRun(p)
        return [
          { label: 'Contrast (weakest)', value: `${S.contrast}`, tone: toneOf(S.contrast > 1500, S.contrast > 600) },
          { label: 'Tracks within ±3 mm', value: S.stats.range > 0.004 ? `±${mmTenths(S.stats.range)}` : 'only near 0', tone: toneOf(S.stats.range > 0.02, S.stats.range > 0.01) },
          { label: 'RMS error near centre', value: mmTenths(S.rms), tone: toneOf(S.rms < 0.0015, S.rms < 0.004) },
          { label: 'Bare floor', value: S.lostWorks ? 'lost ✓' : 'not lost', tone: S.lostWorks ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- PD controller: a lap of the test loop at a PWM duty, loop period and gains; the tuning sheet. ---

const PERIODS = { p5: '5 ms loop', p20: '20 ms loop', p50: '50 ms (Serial.print each loop)' }
const PERIOD_S = { p5: 0.005, p20: 0.02, p50: 0.05 }
const PD = { at: [-9.6, -1.6, 0] as V3, k: 6.6, tilt: -0.45, rest: 1.5, scope: { x: 8.8, y: 2.0, w: 11.6, h: 3.4 }, bars: [6.4, -2.4, 0] as V3 }
const TRACK: Tape = Array.from({ length: 241 }, (_, i) => {
  const q = trackPoint(i / 240)
  return [q.x, q.y] as [number, number]
})
const pdParams = (p: Params) => ({ duty: n(p, 'duty') / 100, kp: n(p, 'kp'), kd: n(p, 'kd'), periodS: PERIOD_S[pick(PERIODS, p.period, 'p5') as keyof typeof PERIOD_S] })
type PdQ = ReturnType<typeof pdParams>
const pdKey = (q: PdQ) => `${q.duty}|${q.kp}|${q.kd}|${q.periodS}`
const pdRun = memoBy(pdKey, (q: PdQ) => ({ R: lapRun(q), sheet: lapSheet(q.kp, q.kd, q.periodS) }))
const lapText = (s: number | null) => (s === null ? 'off' : `${s.toFixed(1)} s`)

export const lineFollowingCarPdController: Lesson = {
  id: 'line-following-car-pd-controller',
  title: 'PD controller',
  tagline: 'Tune Kp, Kd and the loop rate on the Robo-car for the fastest clean lap',
  formula: (p) => {
    const q = pdParams(p)
    const { R } = pdRun(q)
    return `every ${msText(q.periodS)}: e = position (m) · turn = ${q.kp}·e + ${q.kd}·de/dt (±1.5) · left = ${pct(q.duty)} × (1 + turn), right = ${pct(q.duty)} × (1 − turn) · base speed ${mpsText(R.v)} · bar 9 cm ahead, TT motors lag 0.12 s, right motor 6 % weak`
  },
  legend: [
    { color: RING, label: 'Bar position e (scope)', shape: 'dot' },
    { color: GREY, label: 'Path so far', shape: 'dot' },
    { color: POWER, label: 'Sheet: clean lap', shape: 'dot' },
    { color: HIGH_V, label: 'Ran off the line', shape: 'dot' },
  ],
  points: [
    'Control › Line following › PD steering has the theory: P steers toward the line, D steers against how fast the line slides across the bar. Now it runs on the Robo-car: the PWM duty sets the base speed (Drive with ESP32), the turn splits it into the two wheel duties, and the right motor is 6 % weak, which P absorbs as a small steady offset.',
    'The loop rate matters as much as the gains. A tight loop reads the bar and updates every 5 ms and laps cleanly at any speed. Print all five readings each loop with a delay(40) to keep the Serial Monitor readable and it becomes a 50 ms loop: the car steers on stale news and weaves 2 cm either side of the line at any speed. Print every tenth loop instead, without delay().',
    'Tuning on the floor: start slow with Kd = 0 and raise Kp until the car holds the bends; raise the duty until it weaves; add Kd until the weave stops; repeat. At a 20 ms loop, P alone weaves past ~60 % duty, while Kd = 1 brings the lap back.',
    'The sheet on the right runs the current gains at every duty: lap time and whether it stayed on. The fastest clean row is the setting to keep. Write the numbers down: batteries sag, and a full pack makes every duty faster.',
  ],
  controls: [
    { kind: 'slider', key: 'duty', label: 'Speed (duty)', min: 40, max: 100, step: 10, initial: 70, format: (v) => `${v} %` },
    { kind: 'slider', key: 'kp', label: 'Kp (turn per m)', min: 20, max: 160, step: 10, initial: 80, format: (v) => `${v}` },
    { kind: 'slider', key: 'kd', label: 'Kd (turn per m/s)', min: 0, max: 2, step: 0.25, initial: 0, format: (v) => v.toFixed(2) },
    { kind: 'choice', key: 'period', options: opts(PERIODS), initial: 'p20' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = floorView(scene, PD.at, PD.k, PD.tilt)
    tapeFloor(g, [TRACK], [-1.15, 1.15], [-0.72, 0.72])
    const bot = diffBot(g, { track: CHASSIS.track })
    const lights = noseBar(bot.group)
    const trail = floorTrail(g, 900, 0.01)
    const S = PD.scope
    const plot = titledScope(scene, S.y, S.h, 'e at the bar', RING, 0.5, S.x, S.w)
    const tr = plot.s.trace(RING, { samples: 240, radius: 0.05 })
    addLabel(scene, 'Tuning sheet: lap time at each duty', [PD.bars[0] - 3, PD.bars[1] + 0.9, 0.3], LABEL, 0.3, 'left')
    const bars = countBars(scene, PD.bars, LAP_DUTIES.map((d) => pct(d)), 6, { row: 0.62, size: 0.26 })
    const rows = textRows(scene, 2, -17, -7.2, 0.28, 0.66)
    const clock = lapseClock(30, 1, PD.rest)
    const st = { key: '', prev: GRID_START, i: -1 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const q = pdParams(p)
        const { R, sheet } = pdRun(q)
        const key = pdKey(q)
        const end = R.frames.at(-1)!.t
        const t = Math.min(clock(dt, key), end + PD.rest * 0.99)
        const i = Math.min(R.frames.length - 1, Math.round(t / 0.005))
        const f = R.frames[i]
        if (key !== st.key || i < st.i) {
          st.key = key
          trail.clear()
          st.prev = R.frames[0].pose
          plot.lo.set('0 s')
          plot.hi.set(`${end.toFixed(1)} s · ±3 cm`)
          bars.set(
            sheet.map((s) => (s.lapS === null ? 0.3 : 1 / s.lapS)),
            sheet.map((s) => (s.lapS === null ? 'ran off' : `${s.lapS.toFixed(1)} s · ±${mmTenths(s.rms)}`)),
            sheet.map((s) => (s.lapS === null ? HIGH_V : s.rms > 0.006 ? HEAT : POWER)),
            Math.max(...sheet.map((s) => (s.lapS === null ? 0 : 1 / s.lapS))) || 1,
          )
          sheet.forEach((s, j) => bars.rename(j, pct(s.duty), Math.abs(s.duty - q.duty) < 1e-9 ? LABEL : GREY))
        }
        st.i = i
        trail.add(st.prev, f.pose)
        st.prev = f.pose
        bot.set(f.pose, f.dL, f.dR)
        lights(f.adc)
        const step = Math.max(1, Math.ceil((i + 1) / 240))
        const idx = Array.from({ length: Math.ceil((i + 1) / step) }, (_, k) => k * step)
        tr.points(idx.map((k) => R.frames[k].t / end), idx.map((k) => Math.max(-1, Math.min(1, (R.frames[k].pos ?? 0.03 * Math.sign(R.frames[k].turn)) / 0.03)) * (S.h / 2)))
        plot.right.set(f.pos === null ? 'lost' : smm(f.pos), f.pos === null ? HIGH_V : RING)
        rows[0].set(`turn ${signed(f.turn, 2)} · left ${pct(Math.min(1, q.duty * (1 + f.turn)))} · right ${pct(Math.min(1, q.duty * (1 - f.turn)))} duty`, LABEL)
        rows[1].set(`lap ${pct(f.lap)} · ${R.ranOff && i === R.frames.length - 1 ? 'ran off the line' : `${f.t.toFixed(1)} s`}`, R.ranOff && i === R.frames.length - 1 ? HIGH_V : GREY)
        head.status.set(`Line-following car · ${pct(q.duty)} duty (${mpsText(R.v)}) · Kp ${q.kp}, Kd ${q.kd} · ${msText(q.periodS)} loop`)
        head.sub.set('the lobed test loop from the Infrared lessons, 1×', GREY)
        head.event.set(R.lapS !== null ? `Lap in ${R.lapS.toFixed(1)} s, RMS e ${mmTenths(R.rms)}` : R.ranOff ? `Ran off after ${end.toFixed(1)} s` : 'Driving…', R.lapS !== null ? (R.rms > 0.006 ? HEAT : POWER) : HIGH_V)
      },
      readouts: (p) => {
        const { R, sheet } = pdRun(pdParams(p))
        const best = sheet.filter((s) => s.lapS !== null).sort((a, b) => a.lapS! - b.lapS!)[0]
        return [
          { label: 'Lap', value: lapText(R.lapS), tone: R.lapS === null ? 'bad' : 'ok' },
          { label: 'RMS e', value: mmTenths(R.rms), tone: toneOf(R.rms < 0.003, R.rms < 0.008) },
          { label: 'Line lost', value: `${R.lostS.toFixed(2)} s`, tone: toneOf(R.lostS === 0, R.lostS < 0.2) },
          { label: 'Best on sheet', value: best ? `${pct(best.duty)}: ${lapText(best.lapS)}` : 'none', tone: best ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- Intersections: drive a route of turns through a tape grid to a goal; junctions read by the outer sensors. ---

const ENDS: Record<TurnEnd, string> = { sensor: 'Turn until the centre sees tape', timer: 'Turn for a fixed delay() (tuned at 70 %)' }
const GOAL_NAMES = Object.fromEntries(Object.entries(GRID_GOALS).map(([k, v]) => [k, v.name])) as Record<GridGoal, string>
const IX = { at: [-12.6, -6.0, 0] as V3, k: 9.2, tilt: -0.45, rest: 2 }
const ixParams = (p: Params) => ({ goal: pick(GRID_GOALS, p.goal, 'A') as GridGoal, duty: n(p, 'duty') / 100, end: pick(ENDS, p.end, 'sensor') as TurnEnd })
type IxQ = ReturnType<typeof ixParams>
const ixKey = (q: IxQ) => `${q.goal}|${q.duty}|${q.end}`
const ixRun = memoBy(ixKey, (q: IxQ) => gridRun(q.goal, q.duty, q.end))
const ixCode = (end: TurnEnd, route: string) => [
  `const char route[] = "${route}";  // then stop`,
  'switch (state) {',
  '  case FOLLOW: pd(); if (outerDark()) { slow(); go(CREEP); } break;',
  '  case CREEP:  L |= dark(0); R |= dark(4);',
  '    if (travel() > 9 cm) { S = dark(2); next = route[k++];',
  "      go(next == 'S' ? FOLLOW : BRAKE); } break;",
  '  case BRAKE:  drive(0, 0); if (stopped()) go(next ? SPIN : DONE); break;',
  end === 'sensor' ? '  case SPIN:   spin(next); if (offLine && dark(2)) go(FOLLOW); break;' : `  case SPIN:   spin(next); delay(${Math.round(gridSpinS(0.7) * 1000)}); go(FOLLOW); break;`,
  '  case DONE:   drive(0, 0);',
  '}',
]
const STATE_LINE: Record<GridState, number> = { follow: 2, creep: 4, brake: 6, spin: 7, arrived: 8, lost: 2, stuck: 5 }
const STATE_TEXT: Record<GridState, string> = { follow: 'FOLLOW', creep: 'CREEP', brake: 'BRAKE', spin: 'SPIN', arrived: 'DONE', lost: 'LOST', stuck: 'STUCK: no such way' }

export const lineFollowingCarIntersections: Lesson = {
  id: 'line-following-car-intersections',
  title: 'Intersections',
  tagline: 'Read each junction, take the next turn on the list, stop at the goal',
  formula: (p) => {
    const q = ixParams(p)
    const r = ixRun(q)
    return `route "${GRID_GOALS[q.goal].turns.join('')}" + stop · junction = outer sensor dark · creep 9 cm (bar → wheels) at ${pct(LINE_GRID.slowDuty)} while sensors 0 and 4 look for L and R · centre still dark → S · spin wheels ±${mpsText((q.end === 'timer' ? r.v : Math.min(r.v, dutySpeed(LINE_GRID.slowDuty))) * LINE_GRID.spinShare)}${q.end === 'timer' ? ` for ${msText(r.timedS)} (90° only at 70 %)` : ' until the centre leaves the old line and finds the new one'}`
  },
  legend: [
    { color: RING, label: 'Sensor over tape', shape: 'dot' },
    { color: GREY, label: 'Path so far', shape: 'dot' },
    { color: POWER, label: 'Goal reached', shape: 'dot' },
    { color: PIN_COLOR, label: 'Current state in the sketch', shape: 'dot' },
  ],
  points: [
    'Control › Line following › Intersections explains counting crossings and why the robot creeps 9 cm before it spins. A real course has more kinds of junction: crosses, T’s, branches off one side and plain corners. The bar can tell them apart in one pass.',
    'When an outer sensor goes dark, slow down and creep the bar length. On the way, sensor 0 seeing tape means a way left, sensor 4 a way right. At the end of the creep the bar is past the junction: the centre still on tape means the line goes on. Then brake, and the wheels sit on the junction for the turn.',
    'A route is just a string, one letter per junction: "LRS" means left at the first, right at the second, straight at the third, stop at the next. Checking that the letter is possible ("no left here") catches a miscount before the car wanders off. Maze solvers build that string themselves (Maze solver).',
    'End the turn on the sensor, not the clock. A delay() tuned at 70 % turns 90° only at 70 %: slower and it stops short, faster and it swings past, so the car takes the wrong branch. Spinning until the centre leaves the old line and finds the new one works at every speed and with a sagging battery.',
  ],
  controls: [
    { kind: 'choice', key: 'goal', options: opts(GOAL_NAMES), initial: 'A' },
    { kind: 'slider', key: 'duty', label: 'Speed (duty)', min: 40, max: 90, step: 10, initial: 50, format: (v) => `${v} %` },
    { kind: 'choice', key: 'end', options: opts(ENDS), initial: 'sensor' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = floorView(scene, IX.at, IX.k, IX.tilt)
    const c = LINE_GRID.cell
    tapeFloor(g, gridLines(), [-0.2, 2 * c + 0.2], [LINE_GRID.startY - 0.1, 2 * c + 0.2])
    const goalMs = (Object.keys(GRID_GOALS) as GridGoal[]).map((k) => {
      const [x, y] = GRID_GOALS[k].at
      const m = glowMat(GREY, 0.4)
      flatBox(g, [0.05, 0.05, 0.003], m, [x, y, 0.003])
      addLabel(g, k, [x + (x > c ? 0.08 : -0.08), y + 0.06, 0.01], LABEL, 0.06)
      return { k, m }
    })
    addLabel(g, 'start', [c + 0.1, LINE_GRID.startY + 0.05, 0.01], '#30333a', 0.04)
    const bot = diffBot(g, { track: CHASSIS.track })
    const lights = noseBar(bot.group)
    const trail = floorTrail(g, 1200, 0.01)
    const code = codeListing(scene, [1.2, 3.6, 0.3], 10, 15.6, 0.22, 0.54, PIN_COLOR)
    addLabel(scene, 'Junctions read so far', [1.2, -2.4, 0.3], LABEL, 0.3, 'left')
    const log = textRows(scene, 4, 1.2, -3.2, 0.28, 0.62)
    const clock = lapseClock(LINE_GRID.seconds, 1, IX.rest)
    const st = { key: '', prev: GRID_START, i: -1 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const q = ixParams(p)
        const r = ixRun(q)
        const key = ixKey(q)
        const t = Math.min(clock(dt, key), r.seconds + IX.rest * 0.99)
        const i = Math.min(r.frames.length - 1, Math.round(t / 0.005))
        const f = r.frames[i]
        if (key !== st.key || i < st.i) {
          st.key = key
          trail.clear()
          st.prev = r.frames[0].pose
        }
        st.i = i
        trail.add(st.prev, f.pose)
        st.prev = f.pose
        bot.set(f.pose, f.dL, f.dR)
        lights(f.adc)
        const done = i === r.frames.length - 1
        goalMs.forEach((gm) => setGlow(gm.m, gm.k === q.goal ? (done ? (r.arrived ? POWER : HIGH_V) : RING) : GREY, gm.k === q.goal ? 1 : 0.3))
        code.set(ixCode(q.end, GRID_GOALS[q.goal].turns.join('')), STATE_LINE[f.state], (l) => (l.trim().startsWith('//') ? GREY : '#9fe0a0'))
        log.forEach((row, k) => {
          const j = r.log[k]
          if (!j || k >= f.k) return row.set(k < GRID_GOALS[q.goal].turns.length + 1 ? `#${k + 1}  …` : '', GREY)
          const bad = (j.action === 'L' && !j.left) || (j.action === 'R' && !j.right) || (j.action === 'S' && !j.straight)
          row.set(`#${k + 1}  ${junctionName(j)} → ${j.action === 'stop' ? 'stop' : j.action}`, bad ? HIGH_V : j.action === 'stop' ? (r.arrived ? POWER : HIGH_V) : LABEL)
        })
        head.status.set(`Line-following car · to ${GRID_GOALS[q.goal].name} · ${pct(q.duty)} duty (${mpsText(r.v)})`)
        head.sub.set(`${STATE_TEXT[f.state]} · ${f.t.toFixed(1)} s · 40 cm grid, 1×`, GREY)
        head.event.set(
          !done ? `Junction ${f.k + (f.state === 'creep' ? 1 : 0)} of ${GRID_GOALS[q.goal].turns.length + 1}` : r.arrived ? `Arrived at ${q.goal} in ${r.seconds.toFixed(1)} s` : r.state === 'arrived' ? `Stopped ${(r.missM * 100).toFixed(0)} cm from ${q.goal}: took a wrong branch` : r.state === 'stuck' ? 'Stuck: the route asks for a way that is not there' : 'Lost the line',
          !done ? LABEL : r.arrived ? POWER : HIGH_V,
        )
      },
      readouts: (p) => {
        const q = ixParams(p)
        const r = ixRun(q)
        return [
          { label: 'Result', value: r.arrived ? 'arrived' : r.state === 'arrived' ? 'wrong place' : r.state, tone: r.arrived ? 'ok' : 'bad' },
          { label: 'Time', value: `${r.seconds.toFixed(1)} s` },
          { label: 'Junctions', value: `${r.log.length}` },
          { label: 'Spin', value: q.end === 'timer' ? `${msText(r.timedS)} fixed` : 'until line', tone: q.end === 'timer' ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
