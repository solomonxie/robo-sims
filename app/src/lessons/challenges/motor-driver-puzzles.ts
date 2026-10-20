import {
  BRIDGE_GOALS,
  BRIDGE_PINS,
  BridgeChip,
  BridgeGoal,
  BridgeMode,
  DRIVERS,
  DriverChip,
  PWM_LOADS,
  PWM_PACKS,
  PWM_PUZZLE,
  PWM_TARGETS,
  Pins,
  PwmLoad,
  PwmPack,
  PwmTarget,
  RPM_PER_RADS,
  TT_GEAR,
  pwmTarget,
  truthChallenge,
} from '../../core/physics'
import { fixedText, msText, pct, rpmText, si, volts } from '../../core/units'
import {
  FACE_VIEW,
  GREY,
  HEAT,
  HIGH_V,
  HbRoute,
  LABEL,
  PIN_COLOR,
  POWER,
  RING,
  boxScope,
  columnGauge,
  hBridgeDiagram,
  liveLabel,
  memoBy,
  puzzleStage,
  simClock,
  speedWheel,
  verdictLegend,
  verdictTint,
} from '../fx'
import { Lesson, Params, Stage, bitChoice, n, namesOf, opts, pick, toneOf, verdictReadout } from '../types'

const LEGEND = verdictLegend('Fail / short')
const wheelRpm = (radS: number) => (radS * RPM_PER_RADS) / TT_GEAR

// --- Truth table challenge: set the driver's pins for forward / reverse / brake / coast without shorting the supply. ---

const CHIP_NAMES = namesOf(BRIDGE_PINS)
const GOAL_NAMES = namesOf(BRIDGE_GOALS)
const MODE_NAMES: Record<BridgeMode, string> = { forward: 'forward', reverse: 'reverse', brake: 'brake', coast: 'coast', shoot: 'shoot-through' }
const ttParams = (p: Params) => ({
  chip: pick(CHIP_NAMES, p.chip, 'l298n') as BridgeChip,
  goal: pick(GOAL_NAMES, p.goal, 'forward') as BridgeGoal,
  pins: [1, 2, 3, 4].map((k) => String(p[`p${k}`]) === '1') as Pins,
})
type TtQ = ReturnType<typeof ttParams>
const ttSolve = memoBy((q: TtQ) => `${q.chip}|${q.goal}|${q.pins.map(Number).join('')}`, (q: TtQ) => truthChallenge(q.chip, q.goal, q.pins))
const pinsText = (chip: BridgeChip, pins: Pins) =>
  BRIDGE_PINS[chip].pins.flatMap((name, k) => (name ? [`${name} ${Number(pins[k])}`] : [])).join(' · ')
const TT_HINT: Record<BridgeChip, string> = {
  l298n: 'Hint: ENA = 1 enables; IN1 IN2 = 10 forward, 01 reverse, equal = brake. ENA = 0 coasts',
  tb6612: 'Hint: STBY = 1; AIN1 AIN2 = 10 / 01 with PWMA = 1 drives; 11 or PWMA = 0 brakes; 00 coasts',
  drv8833: 'Hint: nSLEEP = 1; IN1 IN2 = 10 forward, 01 reverse, 11 brake, 00 coast',
  fets: 'Hint: a diagonal pair drives (Q1 + Q4, Q3 + Q2); both low sides brake; all off coasts',
}
const GOAL_TEXT: Record<BridgeGoal, string> = { forward: 'drive forward', reverse: 'drive in reverse', brake: 'brake to a fast stop', coast: 'coast to a free stop' }
const OFF_PIN: Record<BridgeChip, string> = { l298n: 'ENA is low', tb6612: 'STBY is low', drv8833: 'nSLEEP is low', fets: '' }
const RUN_MS = 600
const SLOW = 15

export const motorDriverPuzzlesTruthTableChallenge: Lesson = {
  id: 'motor-driver-puzzles-truth-table-challenge',
  title: 'Truth table challenge',
  tagline: 'Set a motor driver’s pins for forward, reverse, brake or coast: on an L298N, TB6612, DRV8833 or a bare 4-FET bridge',
  formula: (p) => {
    const q = ttParams(p)
    const s = ttSolve(q)
    const drop = q.chip === 'fets' ? 'no chip drop' : `${DRIVERS[q.chip].name} drop → ${volts(s.vs)}`
    return `${pinsText(q.chip, q.pins)} → ${MODE_NAMES[s.mode]} · 6 V pack, ${drop} · from full speed: brake ${msText(s.brakeS)}, coast ${msText(s.coastS)}`
  },
  legend: [...LEGEND, { color: PIN_COLOR, label: 'Pin high / switch on', shape: 'dot' }, { color: HEAT, label: 'Motor current', shape: 'dot' }],
  points: [
    'The puzzle: one motor, one driver, a goal. Set the logic pins so the bridge drives forward, reverse, brakes (shorts the motor, its back-EMF stops it fast) or coasts (opens it, only friction stops it) (Actuators › H-bridge › Four switches).',
    'L298N: IN1 / IN2 pick the direction and ENA enables the bridge. IN1 = IN2 with ENA high brakes; ENA low lets it coast whatever the INs say. That’s why PWM goes on ENA: off-time coasts.',
    'TB6612FNG adds STBY (low = whole chip asleep) and a PWM pin: AIN1 / AIN2 pick the direction, PWMA low brakes. DRV8833 has just two inputs per motor: 10, 01, 11 brake, 00 coast; nSLEEP low turns it off (Actuators › H-bridge › L298N vs modern drivers).',
    'A chip input drives one leg high or low, never both, so it can’t short the pack. A bare bridge of four FETs with a pin per gate can: Q1 + Q2 on at once is shoot-through, ~17 A from the pack and nothing for the motor (Actuators › H-bridge › Shoot-through).',
    'Brake vs coast matters on a robot: braking stops a TT wheel about 3× faster. Robo-car › Wire the motor driver uses the same DRV8833 table.',
  ],
  controls: [
    { kind: 'choice', key: 'chip', options: opts(CHIP_NAMES), initial: 'l298n' },
    { kind: 'choice', key: 'goal', options: opts(GOAL_NAMES), initial: 'forward' },
    bitChoice('p1', 'Pin 1 (IN1 / AIN1 / Q1)', 1),
    bitChoice('p2', 'Pin 2 (IN2 / AIN2 / Q2)', 0),
    bitChoice('p3', 'Pin 3 (EN / PWMA / nSLEEP / Q3)', 0),
    bitChoice('p4', 'Pin 4 (STBY / Q4)', 0),
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const h = hBridgeDiagram(scene, [-9.6, -2.6, 0], 0.5)
    const chipTag = liveLabel(scene, [-10.2, 2.4, 0.3], { size: 0.34 })
    const pinTags = [0, 1, 2, 3].map((k) => liveLabel(scene, [-16.6 + k * 3.2, -7.6, 0.3], { size: 0.32, align: 'left' }))
    const modeTag = liveLabel(scene, [-10.2, -8.8, 0.3], { size: 0.32 })
    const sG = columnGauge(scene, 0, {
      min: -220,
      max: 220,
      window: [-5, 5],
      caption: 'Wheel speed (replayed 15× slower)',
      ticks: [[-200, '−200'], [-100, '−100'], [0, '0'], [100, '100'], [200, '200 rpm']],
    })
    const aG = columnGauge(scene, 1, {
      min: 0.01,
      max: 30,
      log: true,
      window: [0.01, 2],
      caption: 'Peak current (≤ 2 A)',
      ticks: [[0.01, '10 mA'], [0.1, '0.1'], [1, '1'], [10, '10 A']],
    })
    const tG = columnGauge(scene, 2, {
      min: 0.01,
      max: 1,
      log: true,
      window: [0.01, 0.01],
      ticks: [[0.01, '10 ms'], [0.1, '100 ms'], [1, '1 s']],
    })
    const clock = simClock(SLOW / 1000, 2)
    const st = { key: '', angle: 0, ms: 0 }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = ttParams(p)
        const s = ttSolve(q)
        const key = `${q.chip}|${q.goal}`
        const free = wheelRpm(s.freeRadS)
        if (key !== st.key) {
          st.key = key
          const stop = q.goal === 'brake' || q.goal === 'coast'
          sG.setWindow(...((q.goal === 'forward' ? [0.8 * free, 1.05 * free] : q.goal === 'reverse' ? [-1.05 * free, -0.8 * free] : [-5, 5]) as [number, number]))
          tG.setWindow(...((q.goal === 'brake' ? [0.01, 1.3 * s.brakeS] : q.goal === 'coast' ? [0.8 * s.coastS, 1] : [0.01, 0.01]) as [number, number]))
          tG.caption.set(stop ? `Stop from full speed (${q.goal === 'brake' ? 'brake' : 'coast'}: ${msText(q.goal === 'brake' ? s.brakeS : s.coastS)})` : 'Stop time (only for brake / coast)', LABEL)
        }
        const ms = clock(dt, `${key}|${q.pins.map(Number).join('')}`, RUN_MS)
        st.ms = ms
        const f = s.run[Math.min(s.run.length - 1, Math.round((ms / RUN_MS) * (s.run.length - 1)))]
        const c = s.c
        const short = s.mode === 'shoot'
        h.set({ q1: +c.q1, q2: +c.q2, q3: +c.q3, q4: +c.q4 }, short ? { q1: +(c.q1 && c.q2), q2: +(c.q1 && c.q2), q3: +(c.q3 && c.q4), q4: +(c.q3 && c.q4) } : {})
        st.angle += (dt * f.radS) / SLOW / 10
        const level = Math.min(1, Math.abs(f.motorA) / 1.2)
        h.motor.set(st.angle, level)
        const route: HbRoute | null = s.mode === 'forward' ? 'fwd' : s.mode === 'reverse' ? 'rev' : s.mode === 'brake' ? (c.q2 ? 'brakeLo' : 'brakeHi') : null
        h.routes([
          ...(route ? [[route, Math.min(1, 0.25 + level), HEAT] as [HbRoute, number, string]] : []),
          ...(c.q1 && c.q2 ? [['shootL', 1, HIGH_V] as [HbRoute, number, string]] : []),
          ...(c.q3 && c.q4 ? [['shootR', 1, HIGH_V] as [HbRoute, number, string]] : []),
        ])
        h.flow('motor', route && Math.abs(f.motorA) > 0.01 ? route : null, (dt * f.motorA * 0.5) / 1.2)
        h.flow('short', short ? (c.q1 && c.q2 ? 'shootL' : 'shootR') : null, dt * 0.9)
        chipTag.set(q.chip === 'fets' ? 'Bare bridge: your pins are the gates' : `${BRIDGE_PINS[q.chip].name}: its logic sets these switches`, LABEL)
        BRIDGE_PINS[q.chip].pins.forEach((name, k) =>
          pinTags[k].set(name ? `${name} = ${Number(q.pins[k])}` : `pin ${k + 1}: —`, name ? (q.pins[k] ? PIN_COLOR : GREY) : GREY),
        )
        modeTag.set(`Bridge: ${MODE_NAMES[s.mode]}${s.off ? ' (chip off)' : ''}`, verdictTint(s.mode === q.goal, !short))
        const w = wheelRpm(f.radS)
        const inSpeed = q.goal === 'forward' ? w >= 0.8 * free : q.goal === 'reverse' ? w <= -0.8 * free : Math.abs(w) <= 5
        sG.set(w, rpmText(w), verdictTint(inSpeed && s.mode === q.goal, s.mode === q.goal))
        const peak = short ? s.shootA : s.peakA
        aG.set(Math.max(0.01, peak), si(peak, 'A', 2), verdictTint(peak <= 2, false))
        const stopS = Number.isFinite(s.stopS) ? s.stopS : 0.01
        tG.set(stopS, Number.isFinite(s.stopS) ? msText(s.stopS) : '—', Number.isFinite(s.stopS) ? verdictTint(s.mode === q.goal, true) : GREY)
        const v = s.verdict
        const why = {
          shoot: `Both switches of one leg on: ${fixedText(s.shootA, 1)} A straight from the pack, ${Math.round(s.fetW)} W per FET. Never both in one leg`,
          off:
            q.goal === 'brake'
              ? `${OFF_PIN[q.chip]}: the bridge is off, so the motor coasts (${msText(s.coastS)}), not brakes (${msText(s.brakeS)})`
              : `${OFF_PIN[q.chip]}: the whole bridge is off, the motor just coasts. Enable it`,
          mode:
            (s.mode === 'brake' || s.mode === 'coast') && (q.goal === 'brake' || q.goal === 'coast')
              ? `That pattern ${s.mode === 'brake' ? 'brakes' : 'coasts'}: it stops in ${msText(s.stopS)}, the goal ${q.goal === 'brake' ? 'brakes' : 'coasts'} in ${msText(q.goal === 'brake' ? s.brakeS : s.coastS)}`
              : `That pattern gives ${MODE_NAMES[s.mode]}, not ${q.goal}`,
        }
        header.set(
          `${GOAL_TEXT[q.goal]} with the ${BRIDGE_PINS[q.chip].name}`,
          v,
          v.fail ? why[v.fail] : `${pinsText(q.chip, q.pins)}: ${MODE_NAMES[s.mode]}${Number.isFinite(s.stopS) ? `, stops in ${msText(s.stopS)}` : `, ${rpmText(free)} free`}`,
          TT_HINT[q.chip],
        )
      },
      readouts: (p) => {
        const q = ttParams(p)
        const s = ttSolve(q)
        return [
          { label: 'Bridge', value: MODE_NAMES[s.mode], tone: s.mode === 'shoot' ? 'bad' : s.mode === q.goal ? 'ok' : 'warn' },
          { label: 'Sim time', value: `${msText(st.ms / 1000)} (${SLOW}× slower)` },
          { label: 'Peak current', value: si(s.mode === 'shoot' ? s.shootA : s.peakA, 'A', 2), tone: s.mode === 'shoot' ? 'bad' : 'ok' },
          verdictReadout(s.verdict),
        ]
      },
    }
  },
}

// --- PWM speed target: pick duty and frequency for a wheel speed under load, through the driver's drop and the deadband. ---

const DRIVER_NAMES = { l298n: 'L298N', tb6612: 'TB6612FNG', drv8833: 'DRV8833' }
const PACK_NAMES = namesOf(PWM_PACKS)
const LOAD_NAMES = namesOf(PWM_LOADS)
const TARGET_NAMES = namesOf(PWM_TARGETS)
const HZ = { '100': '100 Hz', '1000': '1 kHz', '5000': '5 kHz', '20000': '20 kHz', '25000': '25 kHz' }
const mA = (a: number) => `${Math.round(a * 1000)} mA`
const hzText = (hz: number) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`)
const pwParams = (p: Params) => ({
  chip: pick(DRIVER_NAMES, p.chip, 'l298n') as DriverChip,
  pack: pick(PACK_NAMES, p.pack, 'aa4') as PwmPack,
  load: pick(LOAD_NAMES, p.load, 'tile') as PwmLoad,
  target: pick(TARGET_NAMES, p.target, 'cruise') as PwmTarget,
  duty: n(p, 'duty') / 100,
  hz: Number(pick(HZ, p.hz, '1000')),
})
type PwQ = ReturnType<typeof pwParams>
const pwSolve = memoBy((q: PwQ) => `${q.chip}|${q.pack}|${q.load}|${q.target}|${q.duty}|${q.hz}`, (q: PwQ) => pwmTarget(q.chip, q.pack, q.load, q.target, q.duty, q.hz))
const SCOPE = { x: -10.4, y: -8, w: 11, h: 2.6 }
const PERIODS = 3

export const motorDriverPuzzlesPwmSpeedTarget: Lesson = {
  id: 'motor-driver-puzzles-pwm-speed-target',
  title: 'PWM speed target',
  tagline: 'Pick PWM duty and frequency to hit a wheel speed under load: through the driver’s drop, past the deadband, above hearing',
  formula: (p) => {
    const q = pwParams(p)
    const s = pwSolve(q)
    const vp = PWM_PACKS[q.pack].volts
    return `V_motor = duty × (V_pack − drop) = ${pct(q.duty)} × (${volts(vp)} − ${fixedText(s.drop, 2)} V) = ${volts(s.motorV)} → ${rpmText(s.rpm)} · moves from ${pct(s.startDuty)} · ${hzText(q.hz)}: ${s.bits}-bit LEDC`
  },
  legend: [...LEGEND, { color: PIN_COLOR, label: 'PWM pin', shape: 'dot' }, { color: HEAT, label: 'Motor current', shape: 'dot' }],
  points: [
    'The puzzle: a TT wheel should turn at a target speed with no encoder, open loop. You pick the driver, the pack, the duty and the PWM frequency; the floor and payload set the load.',
    'The motor sees duty × (pack − driver drop). The L298N’s two bipolar switches eat ~1.5 V at a TT’s 0.2 A; a TB6612 or DRV8833 loses under 0.15 V. On 4 × NiMH that is the difference between reaching cruise and not (Actuators › H-bridge › L298N vs modern drivers).',
    'Below a few volts nothing moves: the current can’t beat brush friction plus the load, so low duties just hum. That deadband grows on carpet or with payload (Control › Open vs closed loop › P-only deadband).',
    'Leave headroom: a target that needs over 90 % has nothing left for a sagging pack or a slope, which a speed loop would need (Control › Speed control).',
    'PWM frequency: the winding’s L/R is ~0.2 ms, so at 1 kHz the current pulses and the motor whines; anything up to 20 kHz is audible. 25 kHz is silent and the ESP32 LEDC still gives 11 bits (Microcontrollers › PWM › Frequency and resolution).',
  ],
  controls: [
    { kind: 'choice', key: 'chip', options: opts(DRIVER_NAMES), initial: 'l298n' },
    { kind: 'choice', key: 'pack', options: opts(PACK_NAMES), initial: 'aa4' },
    { kind: 'choice', key: 'load', options: opts(LOAD_NAMES), initial: 'tile' },
    { kind: 'choice', key: 'target', options: opts(TARGET_NAMES), initial: 'cruise' },
    { kind: 'slider', key: 'duty', label: 'PWM duty', min: 0, max: 100, step: 1, initial: 60, format: (v: number) => `${v} %` },
    { kind: 'choice', key: 'hz', options: opts(HZ), initial: '1000' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const wheel = speedWheel(scene, [-13.4, -0.8, 0], 2.3, 250)
    const dropTag = liveLabel(scene, [-16.6, 3.3, 0.3], { size: 0.3, align: 'left' })
    const sc = boxScope(scene, SCOPE, 'PWM pin + current', [6, 4], { tag: 0.26 })
    const pin = sc.s.trace(PIN_COLOR, { samples: 6 * PERIODS + 2, radius: 0.06 })
    const cur = sc.s.trace(HEAT, { samples: 60 * PERIODS, radius: 0.07 })
    const sG = columnGauge(scene, 0, {
      min: 0,
      max: 250,
      window: [100, 120],
      ticks: [[0, '0'], [50, '50'], [100, '100'], [150, '150'], [200, '200'], [250, '250 rpm']],
    })
    const dG = columnGauge(scene, 1, {
      min: 0,
      max: 1,
      window: [0, PWM_PUZZLE.maxDuty],
      caption: 'Duty: moves … 90 % headroom',
      marks: [[PWM_PUZZLE.maxDuty, '90 %', RING]],
      ticks: [[0, '0'], [0.25, '25'], [0.5, '50'], [0.75, '75'], [1, '100 %']],
    })
    const fG = columnGauge(scene, 2, {
      min: 50,
      max: 50e3,
      log: true,
      window: [20.001e3, 50e3],
      caption: 'PWM frequency (audible ≤ 20 kHz)',
      marks: [[20e3, '', HIGH_V]],
      ticks: [[100, '100 Hz'], [1e3, '1 kHz'], [1e4, '10 kHz']],
    })
    const st = { key: '', rev: 0 }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = pwParams(p)
        const s = pwSolve(q)
        const key = `${q.chip}|${q.pack}|${q.load}|${q.target}|${q.duty}|${q.hz}`
        const [lo, hi] = s.window
        if (key !== st.key) {
          st.key = key
          sG.setWindow(lo, hi)
          sG.caption.set(`Wheel speed (100 % gives ${rpmText(s.maxRpm)})`, LABEL)
          dG.setWindow(s.startDuty, PWM_PUZZLE.maxDuty)
          const iMax = Math.max(0.05, ...s.wave) * 1.15
          const us = Array.from({ length: s.wave.length * PERIODS }, (_, k) => k / (s.wave.length * PERIODS - 1))
          cur.points(us, us.map((_, k) => ((s.wave[k % s.wave.length] / iMax) - 0.5) * SCOPE.h * 0.9))
          const d = Math.min(0.999, Math.max(0.001, q.duty))
          const pu: number[] = []
          const py: number[] = []
          const yHi = SCOPE.h * 0.42
          const yLo = -SCOPE.h * 0.45
          for (let k = 0; k < PERIODS; k++) {
            const a = k / PERIODS
            const b = (k + d) / PERIODS
            pu.push(a, a, b, b)
            py.push(yLo, yHi, yHi, yLo)
          }
          pu.push(1)
          py.push(yLo)
          pin.points(pu, py, null)
          sc.tag.set(`${PERIODS} × ${si(1 / q.hz, 's', 2)} · ${mA(s.rippleA)} p-p`, s.audible ? RING : LABEL)
          dropTag.set(`${PACK_NAMES[q.pack]} → ${DRIVER_NAMES[q.chip]}: drops ${fixedText(s.drop, 2)} V`, s.drop > 1 ? HEAT : POWER)
        }
        st.rev += (s.rpm / 60) * dt
        wheel.set(dt, st.rev, s.rpm, s.want, s.rpm, q.duty, 0)
        const inWin = s.rpm >= lo && s.rpm <= hi
        sG.set(s.rpm, rpmText(s.rpm), verdictTint(inWin, s.rpm > 0 && s.rpm >= 0.85 * lo && s.rpm <= 1.15 * hi))
        dG.set(q.duty, pct(q.duty), verdictTint(q.duty >= s.startDuty && q.duty <= PWM_PUZZLE.maxDuty, q.duty >= s.startDuty))
        fG.set(q.hz, hzText(q.hz), verdictTint(!s.audible, true))
        const v = s.verdict
        const pv = volts(PWM_PACKS[q.pack].volts)
        const why = {
          reach: `Even 100 % gives ${rpmText(s.maxRpm)}: the ${DRIVER_NAMES[q.chip]} drops ${fixedText(s.drop, 2)} V of ${pv}. A MOSFET driver or a bigger pack`,
          stall: `${pct(q.duty)} gives ${volts(s.motorV)}: too little to beat friction and load, it hums but won’t turn. It starts at ${pct(s.startDuty)}`,
          slow: `${rpmText(s.rpm)}, under ${rpmText(lo)}. More duty (≈ ${pct(s.needDuty)})`,
          fast: `${rpmText(s.rpm)}, over ${rpmText(hi)}. Less duty (≈ ${pct(s.needDuty)})`,
          headroom: `On target, but at ${pct(q.duty)} nothing is left for a sagging pack or a slope. Keep ≤ 90 %: more volts or less drop`,
          whine: `On target, but ${hzText(q.hz)} is audible: the motor whines, current swings ${mA(s.rippleA)} p-p. Go to 25 kHz`,
        }
        header.set(
          `wheel at ${rpmText(s.want)} ±5 %, ${LOAD_NAMES[q.load].toLowerCase()}`,
          v,
          v.fail ? why[v.fail] : `${rpmText(s.rpm)} at ${pct(q.duty)}, ${hzText(q.hz)} (${s.bits}-bit), silent: ship it`,
          `Hint: duty ≈ volts needed / (pack − drop); it moves from ${pct(s.startDuty)}`,
        )
      },
      readouts: (p) => {
        const q = pwParams(p)
        const s = pwSolve(q)
        const [lo, hi] = s.window
        return [
          { label: 'Wheel', value: rpmText(s.rpm), tone: toneOf(s.rpm >= lo && s.rpm <= hi, s.rpm > 0) },
          { label: 'Motor volts', value: volts(s.motorV) },
          { label: 'Needs', value: s.needDuty >= 1 && s.maxRpm < lo ? 'over 100 %' : pct(s.needDuty), tone: toneOf(s.needDuty <= PWM_PUZZLE.maxDuty, s.maxRpm >= lo) },
          verdictReadout(s.verdict),
        ]
      },
    }
  },
}
