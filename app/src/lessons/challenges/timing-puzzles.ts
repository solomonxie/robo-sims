import * as THREE from 'three/webgpu'
import {
  BLINK_CAPS,
  BLINK_GOALS,
  BlinkCap,
  BlinkGoal,
  DEBOUNCE_GOALS,
  DEBOUNCE_INPUTS,
  DEBOUNCE_PUZZLE,
  DebounceGoal,
  DebounceInput,
  LEDS,
  LED_PUZZLE,
  NE555,
  astableAt,
  blinkChallenge,
  debounceChallenge,
} from '../../core/physics'
import { E12, E24, E6 } from '../../core/resistorColors'
import { fixedText, ohms, pct, si, volts } from '../../core/units'
import { V3, add, box, cylinder, mat, rod, STEEL } from '../../models/kit'
import {
  FACE_VIEW,
  GREY,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  boxScope,
  cableRun,
  ceramicAlong,
  diodeAlong,
  emptyGroup,
  icPackage,
  junction,
  ledLamp,
  liveLabel,
  memoBy,
  partLetter,
  puzzleStage,
  swapResistor,
  tactSwitch,
  verdictTint,
  windowGauge,
  wire,
  cell,
  CELL_H,
} from '../fx'
import { Lesson, Params, Stage, namesOf, opts, pick, seriesOhms, seriesSlider, toneOf, verdictReadout } from '../types'

const farads = (f: number) => si(f, 'F', 2)
const time = (s: number) => (Number.isFinite(s) ? si(s, 's', 2) : 'never')
const amps = (a: number) => si(a, 'A', 2)
const hzText = (f: number) => `${fixedText(f, f < 10 ? 2 : 1)} Hz`
const tag = (scene: THREE.Object3D, at: V3, size = 0.3, align: 'left' | 'right' | 'center' = 'left') => liveLabel(scene, at, { size, align })

/** Timing cap along a → b (vertical): a blue electrolytic can or a red box film cap, leads to both ends. */
function timingCap(holder: THREE.Group, a: V3, b: V3, kind: 'electrolytic' | 'film') {
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]
  const half = kind === 'film' ? 0.75 : 1.05
  if (kind === 'film') box(holder, [1.7, 2 * half, 1.1], mat('#b8362f', { rough: 0.45 }), mid)
  else {
    cylinder(holder, 0.8, 2 * half, mat('#1e2f6e', { rough: 0.35 }), mid, 'y', 24)
    box(holder, [0.3, 2 * half - 0.1, 0.1], mat('#c6cde0'), [mid[0], mid[1], 0.78])
  }
  rod(holder, a, [mid[0], mid[1] + half, 0], 0.13, STEEL())
  rod(holder, [mid[0], mid[1] - half, 0], b, 0.13, STEEL())
}

// --- Blink at 1 Hz: NE555 astable, R1 / R2 / C and an optional diode set the rate and duty; an LED on the output. ---

const GOAL_NAMES = namesOf(BLINK_GOALS)
const CAP_NAMES = namesOf(BLINK_CAPS)
const DIODE = { none: 'No diode', diode: '1N4148 across R2' }
const bkParams = (p: Params) => ({
  goal: pick(GOAL_NAMES, p.goal, 'even') as BlinkGoal,
  r1: seriesOhms(p, 'r1', E24),
  r2: seriesOhms(p, 'r2', E24),
  c: seriesOhms(p, 'c', E6),
  cap: pick(CAP_NAMES, p.cap, 'electrolytic') as BlinkCap,
  diode: pick(DIODE, p.diode, 'none') === 'diode',
  rLed: seriesOhms(p, 'rled', E12),
})
type BkQ = ReturnType<typeof bkParams>
const bkSolve = memoBy(
  (q: BkQ) => `${q.goal}|${q.r1}|${q.r2}|${q.c}|${q.cap}|${q.diode}|${q.rLed}`,
  (q: BkQ) => blinkChallenge(q.goal, q.r1, q.r2, q.c, q.cap, q.diode, q.rLed),
)

const B = { x0: -15.8, top: 3, bottom: -6.2, xc: -7.8, yc: -0.5, xr: -2.6, ya: 0, yb: -3.1, xl: -12, xg: -13.8, vcc: -4.4, thr: -4 }
const DIP = { w: 3.2, h: 4 }
const pinY = (i: number) => B.yc + DIP.h / 2 - (i + 0.5) * (DIP.h / 4)
const PIN_L = B.xc - DIP.w / 2 - 0.85
const PIN_R = B.xc + DIP.w / 2 + 0.85
const SCOPE = { x: -2.3, y: -10.2, w: 25, h: 3.6 }
const SCOPE_S = 3
const VC_TOP = 0.7
const GX = 8
const GW = 8.6
const GY = [1.4, -3.6]

export const timingPuzzlesBlinkAt1Hz: Lesson = {
  id: 'timing-puzzles-blink-at-1-hz',
  title: 'Blink at 1 Hz',
  tagline: 'Pick R1, R2 and C for a 555 astable so an LED blinks at 1 Hz ±10 % with the right duty, on any parts in tolerance',
  formula: (p) => {
    const q = bkParams(p)
    const s = bkSolve(q)
    const charge = q.diode ? `R1·C·ln(…) (diode ${fixedText(s.vd, 2)} V)` : 'ln2·(R1 + R2)·C'
    return `t_H = ${charge} = ${time(s.tH)} · t_L = ln2·R2·C = ${time(s.tL)} · f = 1 / (t_H + t_L) = ${hzText(s.hz)} · duty = ${pct(s.duty)}`
  },
  legend: [
    { color: POWER, label: 'Target window / pass; 555 output', shape: 'dot' },
    { color: RING, label: 'Close miss; ⅓ and ⅔ VCC', shape: 'dot' },
    { color: HIGH_V, label: 'Fail', shape: 'dot' },
    { color: '#ffffff', label: 'Cap voltage (real time)', shape: 'dot' },
  ],
  points: [
    'The puzzle: a 555 in astable mode blinks an LED. The cap charges through R1 + R2 until it hits ⅔ VCC (output HIGH), then the DIS pin empties it through R2 down to ⅓ VCC (output LOW), and again. Pick R1, R2 and C to blink at 1 Hz ±10 % with the duty the goal asks for (Components › Capacitor › RC time constant).',
    'Each half is an RC curve between ⅓ and ⅔ of the supply, so it takes ln 2 ≈ 0.693 time constants: t_H = 0.693·(R1 + R2)·C, t_L = 0.693·R2·C, f ≈ 1.44 / ((R1 + 2·R2)·C). The supply cancels out, which is why the 555 is so steady. The first HIGH is longer: the cap starts from 0 V.',
    'Duty = (R1 + R2) / (R1 + 2·R2), always over 50 %: the charge path includes R2. For a short flash, put a diode across R2 so the cap charges through R1 alone. The diode’s ~0.5 V drop slows the charge, so t_H comes out longer than 0.693·R1·C.',
    'Tolerance: 1 % resistors are cheap, but an electrolytic is ±20 %, so the same build can blink anywhere from 0.8 to 1.25 Hz; a film cap (±5 %) holds ±10 %. Electrolytics also leak a few µA, which matters when the charge current through big resistors is only tens of µA (Components › Capacitor › Electrolytic vs ceramic).',
    'Keep R1 ≥ 1 kΩ: when DIS empties the cap, it also shorts R1 to ground. The output drives the LED directly: it sits ~1.5 V under VCC, so size the LED resistor for 5–20 mA (Circuit challenges › LED puzzles › Safe LED current).',
  ],
  controls: [
    { kind: 'choice', key: 'goal', options: opts(GOAL_NAMES), initial: 'even' },
    seriesSlider('r1', 'R1 (E24, 1 %)', E24, 100, 2.2e6, 10e3),
    seriesSlider('r2', 'R2 (E24, 1 %)', E24, 1e3, 2.2e6, 10e3),
    seriesSlider('c', 'C (E6)', E6, 10e-9, 1e-3, 10e-6, farads),
    { kind: 'choice', key: 'cap', options: opts(CAP_NAMES), initial: 'electrolytic' },
    { kind: 'choice', key: 'diode', options: opts(DIODE), initial: 'none' },
    seriesSlider('rled', 'LED resistor (E12)', E12, 22, 4.7e3, 220),
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const y1 = (B.top + B.ya) / 2
    const y2 = (B.ya + B.yb) / 2
    const y3 = (B.yb + B.bottom) / 2

    add(scene, cell(CELL_H, 1.5), [B.x0, (B.top + B.bottom) / 2, 0])
    tag(scene, [B.x0 + 1, B.top - 0.7, 0.3], 0.3).set('5 V', LABEL)
    wire(scene, [[B.x0, B.bottom, 0], [B.x0, B.top, 0], [B.xr, B.top, 0], [B.xr, B.bottom, 0], [B.x0, B.bottom, 0]])
    add(scene, icPackage(DIP.w, DIP.h, 4), [B.xc, B.yc, 0])
    partLetter(scene, 'NE555', [B.xc, B.yc + DIP.h / 2 + 0.55, 0.3], 0.36)
    const pinTag = (k: number, text: string, left: boolean) => tag(scene, [left ? PIN_L + 0.2 : PIN_R - 0.2, pinY(k) + 0.45, 0.3], 0.22, left ? 'left' : 'right').set(text, GREY)
    ;['GND', 'TRIG', 'OUT', 'RST'].forEach((t, i) => pinTag(i, t, true))
    ;['VCC', 'DIS', 'THR', 'CV'].forEach((t, i) => pinTag(i, t, false))
    wire(scene, [[PIN_R, pinY(0), 0], [B.vcc, pinY(0), 0], [B.vcc, B.top, 0]])
    wire(scene, [[PIN_R, pinY(1), 0], [B.xr, B.ya, 0]])
    wire(scene, [[PIN_R, pinY(2), 0], [B.thr, pinY(2), 0], [B.thr, B.yb, 0], [B.xr, B.yb, 0]])
    wire(scene, [[PIN_R, pinY(3), 0], [PIN_R + 0.5, pinY(3), 0]])
    wire(scene, [[PIN_L, pinY(0), 0], [B.xg, pinY(0), 0], [B.xg, B.bottom, 0]])
    wire(scene, [[PIN_L, pinY(2), 0], [B.xl, pinY(2), 0], [B.xl, B.bottom, 0]])
    const lift = 1.6
    cableRun(scene, [[PIN_L, pinY(1), 0], [PIN_L + 0.4, pinY(1), lift], [PIN_R - 0.4, pinY(2), lift], [PIN_R, pinY(2), 0]], '#e0b422', 0.12)
    cableRun(scene, [[PIN_L, pinY(3), 0], [PIN_L + 0.4, pinY(3), lift + 0.4], [PIN_R - 0.4, pinY(0), lift + 0.4], [PIN_R, pinY(0), 0]], '#d23b3b', 0.12)
    junction(scene, [B.vcc, B.top, 0], 0.32).set(1)
    junction(scene, [B.xg, B.bottom, 0], 0.32).set(0)
    junction(scene, [B.xl, B.bottom, 0], 0.32).set(0)
    const nodeA = junction(scene, [B.xr, B.ya, 0], 0.42)
    const nodeB = junction(scene, [B.xr, B.yb, 0], 0.42)

    const holders = { r1: add(scene, new THREE.Group()), r2: add(scene, new THREE.Group()), c: add(scene, new THREE.Group()), d: add(scene, new THREE.Group()), led: add(scene, new THREE.Group()) }
    const rTags = [y1, y2].map((y) => tag(scene, [B.xr + 1.2, y, 0.3], 0.28))
    const cTag = tag(scene, [B.xr + 1.2, y3, 0.3], 0.28)
    const led = ledLamp(scene, LEDS.red.color, [B.xl, -4.5, 0], { scale: 1, anodeRight: false })
    led.group.rotation.z = -Math.PI / 2
    const ledA = LED_PUZZLE.hiA
    let diodeShow: ReturnType<typeof diodeAlong> | null = null

    const sc = boxScope(scene, SCOPE, `Cap and output, last ${SCOPE_S} s (real time)`, [12, 4])
    const yOf = (v: number) => (v / NE555.vcc) * VC_TOP * SCOPE.h - SCOPE.h / 2
    sc.s.level(RING).set(yOf(NE555.hi * NE555.vcc))
    sc.s.level(RING).set(yOf(NE555.lo * NE555.vcc))
    const vcTrace = sc.s.trace('#ffffff', { samples: 300, radius: 0.07 })
    const outTrace = sc.s.trace(POWER, { samples: 300, radius: 0.07 })
    tag(scene, [SCOPE.x + SCOPE.w / 2 + 0.4, SCOPE.y + SCOPE.h * 0.37, 0.3], 0.24).set('out', POWER)
    tag(scene, [SCOPE.x + SCOPE.w / 2 + 0.4, SCOPE.y + yOf(NE555.hi * NE555.vcc), 0.3], 0.24).set('2/3', RING)
    tag(scene, [SCOPE.x + SCOPE.w / 2 + 0.4, SCOPE.y + yOf(NE555.lo * NE555.vcc), 0.3], 0.24).set('1/3', RING)

    const fG = windowGauge(scene, [GX, GY[0], 0], GW, {
      min: 0,
      max: 2,
      window: [0.9, 1.1],
      caption: 'Blink rate (bar = worst case)',
      ticks: [[0, '0'], [0.5, '0.5'], [1, '1'], [1.5, '1.5'], [2, '2 Hz']],
    })
    const dG = windowGauge(scene, [GX, GY[1], 0], GW, {
      min: 0,
      max: 1,
      window: BLINK_GOALS.even.duty,
      caption: 'Duty (LED on share)',
      marks: [[0.5, 'no diode', RING]],
      ticks: [[0, '0'], [0.25, '25'], [0.5, '50'], [0.75, '75'], [1, '100 %']],
    })
    const st = { key: '', t: 0, goal: '', shown: { r1: NaN, r2: NaN, c: '', rLed: NaN, diode: '' } }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = bkParams(p)
        const s = bkSolve(q)
        const key = `${q.r1}|${q.r2}|${q.c}|${q.diode}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
        }
        st.t += dt
        if (q.goal !== st.goal) {
          st.goal = q.goal
          dG.setWindow(...BLINK_GOALS[q.goal].duty)
        }
        const sh = st.shown
        if (sh.r1 !== q.r1) {
          sh.r1 = q.r1
          swapResistor(holders.r1, q.r1, [B.xr, y1 + 1, 0], [B.xr, y1 - 1, 0])
          rTags[0].set(`R1 ${ohms(q.r1)}`, LABEL)
        }
        if (sh.r2 !== q.r2) {
          sh.r2 = q.r2
          swapResistor(holders.r2, q.r2, [B.xr, y2 + 1, 0], [B.xr, y2 - 1, 0])
          rTags[1].set(`R2 ${ohms(q.r2)}`, LABEL)
        }
        const cKey = `${q.c}|${q.cap}`
        if (sh.c !== cKey) {
          sh.c = cKey
          emptyGroup(holders.c)
          timingCap(holders.c, [B.xr, y3 + 1.4, 0], [B.xr, y3 - 1.4, 0], q.cap)
          cTag.set(`C ${farads(q.c)} ${q.cap === 'film' ? 'film' : 'elec.'}`, LABEL)
        }
        if (sh.rLed !== q.rLed) {
          sh.rLed = q.rLed
          swapResistor(holders.led, q.rLed, [B.xl, -1.4, 0], [B.xl, -3.4, 0])
        }
        const dKey = String(q.diode)
        if (sh.diode !== dKey) {
          sh.diode = dKey
          emptyGroup(holders.d)
          diodeShow = null
          if (q.diode) {
            const xd = B.xr + 1.6
            wire(holders.d, [[B.xr, B.ya - 0.3, 0], [xd, B.ya - 0.3, 0], [xd, y2 + 0.9, 0]])
            wire(holders.d, [[xd, y2 - 0.9, 0], [xd, B.yb + 0.3, 0], [B.xr, B.yb + 0.3, 0]])
            diodeShow = diodeAlong(holders.d, [xd, y2 + 0.9, 0], [xd, y2 - 0.9, 0], { scale: 1.1, glass: true })
          }
          rTags[1].group.position.x = B.xr + (q.diode ? 2.5 : 1.2)
        }
        const now = astableAt(s, st.t)
        nodeA.set(now.high ? 0.5 + 0.5 * (now.vc / NE555.vcc) : 0.05)
        nodeB.set(now.vc / NE555.vcc)
        diodeShow?.set(now.high ? 0.8 : -0.6)
        led.set(now.high && !s.led.burnt ? s.led.amps / ledA : 0)
        led.burn(s.led.burnt)
        led.step(dt)
        const back = (u: number) => astableAt(s, Math.max(0, st.t - (1 - u) * SCOPE_S))
        vcTrace.draw((u) => (st.t - (1 - u) * SCOPE_S < 0 ? -SCOPE.h / 2 : yOf(back(u).vc)))
        outTrace.draw((u) => (back(u).high && st.t - (1 - u) * SCOPE_S >= 0 ? 0.95 : 0.78) * SCOPE.h - SCOPE.h / 2)
        sc.tag.set(`t_H ${time(s.tH)} · t_L ${time(s.tL)}`, LABEL)
        const v = s.verdict
        const g = BLINK_GOALS[q.goal]
        const inF = v.fail !== 'slow' && v.fail !== 'fast'
        fG.set(Math.min(s.hz, 2), hzText(s.hz), verdictTint(inF, Math.abs(s.hz - 1) < 0.3), s.corners)
        const inD = s.duty >= g.duty[0] && s.duty <= g.duty[1]
        dG.set(s.duty, pct(s.duty), verdictTint(inD, v.fail !== 'duty' || v.near))
        const flash = g.duty[1] < 0.5
        const why = {
          discharge: `DIS shorts R1 to ground every cycle: ${amps(s.dischargeA)} through ${ohms(q.r1)}. Use R1 ≥ 1 kΩ`,
          slow: `${hzText(s.hz)}: too slow. Smaller R2 or C (f ≈ 1.44 / ((R1 + 2·R2)·C))`,
          fast: `${hzText(s.hz)}: too fast. Bigger R2 or C (f ≈ 1.44 / ((R1 + 2·R2)·C))`,
          duty:
            flash && !q.diode
              ? `Duty ${pct(s.duty)}: without a diode it can’t go under 50 %. Add the diode across R2`
              : s.duty < g.duty[0]
                ? `Duty ${pct(s.duty)}, under ${pct(g.duty[0])}: R1 is too small next to ${q.diode ? 'R2' : '2·R2'}`
                : `Duty ${pct(s.duty)}, over ${pct(g.duty[1])}: ${q.diode ? 'make R1 smaller than R2' : 'make R2 bigger than R1'}`,
          leak: `Leaks ~${amps(s.leakA)} vs a ${amps(s.chargeA)} charge current (> 10 %). Smaller R, bigger C, or film`,
          bulky: `A ${farads(q.c)} film cap is a brick. Stay ≤ 10 µF and raise R`,
          spread: `±${pct(BLINK_CAPS[q.cap].tol)} parts could land at ${hzText(s.corners[0])} … ${hzText(s.corners[1])}. Use a film cap, aim at 1 Hz`,
          led: s.led.amps > LED_PUZZLE.hiA ? `LED gets ${amps(s.led.amps)}, over 20 mA. Bigger LED resistor` : `LED gets only ${amps(s.led.amps)}: barely lit. Smaller LED resistor`,
        }
        header.set(
          `blink an LED at 1 Hz ±10 %, duty ${pct(g.duty[0])}–${pct(g.duty[1])}`,
          v,
          v.fail ? why[v.fail] : `${hzText(s.hz)} (${hzText(s.corners[0])} … ${hzText(s.corners[1])} worst case), duty ${pct(s.duty)}, LED ${amps(s.led.amps)}: build it`,
          flash ? 'Hint: with the diode, t_H ≈ R1·C, t_L ≈ 0.69·R2·C' : `Hint: R1 + 2·R2 ≈ 1.44 s / C, with ${q.goal === 'even' ? 'R2 a few × R1' : 'R1 a few × R2'}`,
        )
      },
      readouts: (p) => {
        const q = bkParams(p)
        const s = bkSolve(q)
        const g = BLINK_GOALS[q.goal]
        return [
          { label: 'Blink rate', value: hzText(s.hz), tone: toneOf(s.verdict.fail !== 'slow' && s.verdict.fail !== 'fast', Math.abs(s.hz - 1) < 0.3) },
          { label: 'Duty', value: pct(s.duty), tone: toneOf(s.duty >= g.duty[0] && s.duty <= g.duty[1], false) },
          { label: 'LED', value: amps(s.led.amps), tone: toneOf(s.led.verdict.pass, s.led.verdict.near) },
          verdictReadout(s.verdict),
        ]
      },
    }
  },
}

// --- Debounce time: pull-up, cap and the input's thresholds turn a bouncy press into one clean, quick edge. ---

const DB_GOALS = namesOf(DEBOUNCE_GOALS)
const DB_INPUTS = namesOf(DEBOUNCE_INPUTS)
const dbParams = (p: Params) => ({
  goal: pick(DB_GOALS, p.goal, 'tact') as DebounceGoal,
  input: pick(DB_INPUTS, p.input, 'hc14') as DebounceInput,
  r: seriesOhms(p, 'r', E12),
  c: seriesOhms(p, 'c', E6),
})
type DbQ = ReturnType<typeof dbParams>
const dbSolve = memoBy((q: DbQ) => `${q.goal}|${q.input}|${q.r}|${q.c}`, (q: DbQ) => debounceChallenge(q.goal, q.input, q.r, q.c))
const DP = DEBOUNCE_PUZZLE

const D = { x0: -15.8, top: 3, bottom: -5.8, yn: -2.2, sw: -12.2, k: 1.4, ax: -6.4, ic: -3.6, rd: [-9.4, -7.4] as [number, number] }
const PANELS = [-10.3, 5.3]
const PW = 12.4
const LOGIC = { y: -7.9, h: 1.2 }
const ANALOG = { y: -11.3, h: 2.8 }
const PANEL_S = 4
const PRE = 0.1

export const timingPuzzlesDebounceTime: Lesson = {
  id: 'timing-puzzles-debounce-time',
  title: 'Debounce time',
  tagline: 'Pick the pull-up and the cap so a bouncy switch reads as one clean press, fast enough, through the right input',
  formula: (p) => {
    const q = dbParams(p)
    const s = dbSolve(q)
    return `release τ = R·C = ${ohms(q.r)} × ${farads(q.c)} = ${time(s.tauRelease)} · press τ = (R ∥ 1 kΩ)·C = ${time(s.tauPress)} · bounce ${time(s.part.makeS)} · budget ${time(s.respondS)}`
  },
  legend: [
    { color: '#ffffff', label: 'Node voltage at the input', shape: 'dot' },
    { color: RING, label: 'Input thresholds', shape: 'dot' },
    { color: GREY, label: 'Top: contacts touching', shape: 'dot' },
    { color: POWER, label: 'Top: what the input reads as pressed', shape: 'dot' },
  ],
  points: [
    'The puzzle: a button pulls an input LOW through 1 kΩ, a pull-up R brings it back, and a cap C on the node smooths the bounce. Pick R and C so every press reads as exactly one press, within the response budget (Components › Switches & buttons › Contact bounce).',
    'Press: the cap empties through 1 kΩ ∥ R, fast. Each bounce opens the contact for a moment and the cap starts to recharge through R; it must not climb back past the input’s threshold. Release: it recharges through R alone, τ = R·C, and the release bounces briefly short it again (Components › Switches & buttons › Debouncing).',
    'So τ needs to be long next to the bounce gaps, but short next to the budget: the slower edge is the release, ≈ 0.8·R·C to cross a 74HC14’s 1.8 V. R also has to beat the 1 kΩ: pressed, the node sits at 3.3 V × 1 k / (R + 1 k), which must be under the falling threshold.',
    'The input matters. A 74HC14 Schmitt trigger switches at 1.8 V going up and 1.0 V going down, so a slow, wobbly ramp gives one clean edge. A plain input only promises LOW under 0.83 V and HIGH over 2.48 V; in between, a slow edge can chatter into extra presses (Digital › Level shifting › Logic thresholds).',
    'An ESP32 pin with no Schmitt needs fast edges, so skip the cap and debounce in code instead: accept a level once it has held 5–20 ms (Microcontrollers › Timers & interrupts › Millis without delay).',
  ],
  controls: [
    { kind: 'choice', key: 'goal', options: opts(DB_GOALS), initial: 'tact' },
    { kind: 'choice', key: 'input', options: opts(DB_INPUTS), initial: 'hc14' },
    seriesSlider('r', 'Pull-up R (E12)', E12, 470, 1e6, 10e3),
    seriesSlider('c', 'C (E6)', E6, 1e-9, 10e-6, 10e-9, farads),
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    add(scene, cell(CELL_H, 1.5), [D.x0, (D.top + D.bottom) / 2, 0])
    tag(scene, [D.x0 + 1, D.top - 0.7, 0.3], 0.3).set('3.3 V', LABEL)
    const sw = tactSwitch(scene, [D.sw, D.yn + 0.9 * D.k, 0], { scale: D.k, cap: '#5a4a3c' })
    const { a, b } = sw.pins
    wire(scene, [[D.x0, D.bottom, 0], [D.x0, D.top, 0], [D.ax, D.top, 0], [D.ax, D.bottom, 0], [D.x0, D.bottom, 0]])
    wire(scene, [a, [a[0], D.bottom, 0]])
    wire(scene, [b, [D.rd[0], D.yn, 0]])
    wire(scene, [[D.rd[1], D.yn, 0], [D.ic - 1.6, D.yn, 0]])
    wire(scene, [[D.ic + 1.6, D.yn, 0], [D.ic + 2.4, D.yn, 0]])
    swapResistor(add(scene, new THREE.Group()), DP.dischargeOhms, [D.rd[0], D.yn, 0], [D.rd[1], D.yn, 0])
    tag(scene, [(D.rd[0] + D.rd[1]) / 2, D.yn + 1, 0.3], 0.28, 'center').set('1 kΩ', GREY)
    junction(scene, [a[0], D.bottom, 0], 0.32).set(0)
    const node = junction(scene, [D.ax, D.yn, 0], 0.45)
    add(scene, icPackage(2.4, 2.6, 1), [D.ic, D.yn, 0])
    const icTag = tag(scene, [D.ic, D.yn + 1.9, 0.3], 0.3, 'center')
    const outTag = tag(scene, [D.ic + 2.8, D.yn, 0.3], 0.3)
    const yr = (D.top + D.yn) / 2
    const yc = (D.yn + D.bottom) / 2
    const rHold = add(scene, new THREE.Group())
    const cHold = add(scene, new THREE.Group())
    const rTag = tag(scene, [D.ax - 0.9, yr + 0.4, 0.3], 0.3, 'right')
    const cTag = tag(scene, [D.ax + 1.6, yc, 0.3], 0.3)

    const panels = PANELS.map((x) => {
      const lg = boxScope(scene, { x, y: LOGIC.y, w: PW, h: LOGIC.h }, '', [10, 2])
      const an = boxScope(scene, { x, y: ANALOG.y, w: PW, h: ANALOG.h }, '', [10, 4])
      const hi = an.s.level(RING)
      const lo = an.s.level(RING)
      return {
        lg,
        an,
        hi,
        lo,
        made: lg.s.trace(GREY, { samples: 400, radius: 0.05 }),
        seen: lg.s.trace(POWER, { samples: 300, radius: 0.07 }),
        v: an.s.trace('#ffffff', { samples: 400, radius: 0.06 }),
        title: tag(scene, [x - PW / 2, LOGIC.y + LOGIC.h / 2 + 0.9, 0.3], 0.28),
      }
    })
    const vy = (v: number) => (v / 4) * ANALOG.h - ANALOG.h / 2
    const gauge = windowGauge(scene, [7.9, 0.8, 0], 8.8, {
      min: 1e-4,
      max: 0.1,
      log: true,
      window: [1e-4, 10e-3],
      caption: 'Slowest response',
      ticks: [[1e-4, '0.1'], [1e-3, '1'], [1e-2, '10'], [0.1, '100 ms']],
    })
    const slow = [0, 1].map((i) => tag(scene, [3.5, -2.6 - 0.7 * i, 0.3], 0.28))
    const st = { t: 0, key: '', goal: '', r: NaN, c: NaN, input: '' }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = dbParams(p)
        const s = dbSolve(q)
        const g = DEBOUNCE_GOALS[q.goal]
        const win = 2 * g.respondS
        if (q.goal !== st.goal) {
          st.goal = q.goal
          gauge.setWindow(1e-4, g.respondS)
          panels.forEach((pn, i) => pn.title.set(`${i ? 'Release' : 'Press'}: ${time(win)} across`, LABEL))
        }
        if (q.input !== st.input) {
          st.input = q.input
          icTag.set(q.input === 'hc14' ? '74HC14' : 'ESP32 pin', LABEL)
          for (const pn of panels) {
            pn.hi.set(vy(s.levels.hi))
            pn.lo.set(vy(s.levels.lo))
          }
        }
        if (q.r !== st.r) {
          st.r = q.r
          swapResistor(rHold, q.r, [D.ax, yr + 1, 0], [D.ax, yr - 1, 0])
          rTag.set(`R ${ohms(q.r)}`, LABEL)
        }
        if (q.c !== st.c) {
          st.c = q.c
          emptyGroup(cHold)
          ceramicAlong(cHold, [D.ax, yc + 1.4, 0], [D.ax, yc - 1.4, 0], 1.2)
          cTag.set(`C ${farads(q.c)}`, LABEL)
        }
        const key = `${q.goal}|${q.input}|${q.r}|${q.c}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
        }
        st.t = (st.t + dt) % (2 * PANEL_S)
        const which = st.t < PANEL_S ? 0 : 1
        const u = (st.t % PANEL_S) / PANEL_S
        const start = (i: number) => (i ? s.releaseS : DP.pressS) - PRE * win
        const idx = (i: number, x: number) => Math.min(s.n - 1, Math.max(0, Math.round((start(i) + x * win) / DP.dt)))
        panels.forEach((pn, i) => {
          const upTo = i < which ? 1 : u
          for (const tr of [pn.v, pn.made, pn.seen]) tr.group.visible = i <= which
          const at = (arr: ArrayLike<number>, x: number) => arr[idx(i, Math.min(x, upTo))]
          pn.v.draw((x) => vy(at(s.vc, x)), i === which ? u : null)
          pn.made.draw((x) => (at(s.made, x) ? 0.3 : 0.08) * LOGIC.h - LOGIC.h / 2, null)
          pn.seen.draw((x) => (at(s.pressed, x) ? 0.92 : 0.6) * LOGIC.h - LOGIC.h / 2, i === which ? u : null)
          const lag = i ? s.releaseLag : s.pressLag
          pn.lg.tag.set(`lag ${time(lag)}`, verdictTint(lag <= g.respondS, lag <= 2 * g.respondS))
        })
        const k = idx(which, u)
        node.set(s.vc[k] / DP.vdd)
        const tNow = k * DP.dt
        const travel = (t0: number) => Math.min(1, Math.max(0, (tNow - t0 + 1e-3) / 1e-3))
        sw.set(travel(DP.pressS) - travel(s.releaseS), !!s.made[k])
        outTag.set(s.pressed[k] ? 'pressed' : 'released', s.pressed[k] ? POWER : GREY)
        const v = s.verdict
        gauge.set(Math.min(Math.max(s.lagS, 1e-4), 0.1), time(s.lagS), verdictTint(s.lagS <= g.respondS, s.lagS <= 2 * g.respondS))
        slow[0].set(`Presses read: ${s.presses} of 1`, verdictTint(s.presses === 1, s.presses === 2))
        slow[1].set(`Scopes slowed ${Math.round(PANEL_S / win)}×; ${q.input === 'hc14' ? 'Schmitt 1.0 / 1.8 V' : 'VIL / VIH 0.83 / 2.48 V'}`, GREY)
        const why = {
          level: `Pressed, the node stops at ${volts(s.pressedV)} (R vs 1 kΩ), above ${volts(s.levels.lo)}. Bigger R`,
          missed: `The cap never drains below ${volts(s.levels.lo)} during the press. Smaller C`,
          bounce: `The bounces get through: one press reads as ${s.presses}. Bigger R·C`,
          slow: `It reads ${time(s.lagS)} late, over the ${time(g.respondS)} budget. Smaller R·C`,
          chatter: `The edge sits ${time(s.dwellS)} between VIL and VIH: a plain pin can chatter. Use the 74HC14`,
        }
        header.set(
          `${g.name.split(',')[0].toLowerCase()}: one press per press, read within ${time(g.respondS)}`,
          v,
          v.fail ? why[v.fail] : `One press, ${time(s.pressLag)} in, ${time(s.releaseLag)} out, τ = ${time(s.tauRelease)}: wire it`,
          'Hint: τ = R·C a few × the bounce, release ≈ 0.8·τ under the budget; R > 2.3 kΩ',
        )
      },
      readouts: (p) => {
        const q = dbParams(p)
        const s = dbSolve(q)
        return [
          { label: 'Presses read', value: `${s.presses} of 1`, tone: toneOf(s.presses === 1, s.presses === 2) },
          { label: 'Press lag', value: time(s.pressLag), tone: toneOf(s.pressLag <= s.respondS, s.pressLag <= 2 * s.respondS) },
          { label: 'Release lag', value: time(s.releaseLag), tone: toneOf(s.releaseLag <= s.respondS, s.releaseLag <= 2 * s.respondS) },
          verdictReadout(s.verdict),
        ]
      },
    }
  },
}

