import * as THREE from 'three/webgpu'
import {
  CONNECTORS,
  CONNECTOR_JOBS,
  CRIMP,
  CRIMP_LAPSE,
  CRIMP_LAPSE_S,
  ConnectorId,
  CrimpCfg,
  DieSlot,
  JobKey,
  TERMINALS,
  TerminalKey,
  awgDiameter,
  conductorMm2,
  crimpAt,
  crimpRun,
  plugLapseS,
  plugRun,
  plugTempAt,
  PLUG_LAPSE,
} from '../../core/physics'
import { celsiusText, fixedText, lowerFirst, mmFixed, ohmsText, pct, si } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { buildTtMotor } from '../../models/motion'
import {
  BENCH_VIEW,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LEAD_TINT,
  POWER,
  RING,
  cableRun,
  clamp01,
  columnGauge,
  crimpSection,
  crimpTerminal,
  i2cBreakout,
  label,
  lapseClock,
  liveLabel,
  memoBy,
  plugPair,
  puzzleStage,
  sg90Servo,
  stretchArrow,
  textRows,
  verdictLegend,
  verdictTint,
} from '../fx'
import { LegendItem, Lesson, Params, Stage, n, namesOf, opts, pick, toneOf, verdictReadout } from '../types'

const N = (f: number) => `${fixedText(f, f < 10 ? 1 : 0)} N`
const A = (a: number) => si(a, 'A', 2)
const C = (c: number) => celsiusText(c)
/** Copper fill; past 100 % the die asks for more room than the copper has: it crushes. */
const fillText = (f: number) => (f > 1 ? `${pct(f - 1)} too much` : pct(f))

// --- Crimping a pin: strip, gauge, die slot and ratchet decide how full of copper the barrel ends up. ---

const SLOW = 0.5
const TERM_NAMES = namesOf(TERMINALS)
const DIE_OPTS: Record<DieSlot, string> = { match: 'Die slot matches the wire', big: 'Die slot one size big', small: 'Die slot one size small' }
const STROKE_OPTS = { full: 'Squeeze till the ratchet releases', early: 'Let go before the ratchet clicks' }
const cpCfg = (p: Params): CrimpCfg => ({
  terminal: pick(TERM_NAMES, p.terminal, 'dupont') as TerminalKey,
  awg: n(p, 'awg'),
  stripMm: n(p, 'strip'),
  die: pick(DIE_OPTS, p.die, 'match') as DieSlot,
  fullStroke: p.stroke !== 'early',
})
const cpKey = (c: CrimpCfg) => `${c.terminal}|${c.awg}|${c.stripMm}|${c.die}|${c.fullStroke}`
const cpSolve = memoBy(cpKey, crimpRun)
type CpRun = ReturnType<typeof crimpRun>

function crimpWhy(r: CpRun): string {
  const c = r.cfg
  const T = r.terminal
  const [lo, hi] = r.window
  switch (r.verdict.fail) {
    case 'range':
      return `${T.name} takes ${T.awg[0]}–${T.awg[1]} AWG: ${c.awg} AWG is too ${c.awg < T.awg[0] ? 'thick, the wings can’t close round it' : 'thin for the barrel'}`
    case 'short':
      return `Stripped ${mmFixed(c.stripMm)}: only ${pct(r.cover.cond)} of the conductor wings grip copper, the rest bite insulation`
    case 'over':
      return `Die too small: fill ${fillText(r.fill)}, it crushes the strands, ${pct(r.cut)} cut. It snaps at ${N(r.holdN)}`
    case 'pull':
      return `${c.fullStroke ? 'Die too big' : 'Released early'}: ${pct(r.fill)} fill, it pulls out at ${N(r.holdN)}, spec ${N(r.specN)}`
    case 'loose':
      return `${pct(r.fill)} fill: not gas-tight, air gets in and the crimp oxidises. Matching die, full stroke`
    case 'long':
      return `Stripped ${mmFixed(c.stripMm)}: the insulation wings grip bare strands. No strain relief; aim ${fixedText(lo, 1)}–${fixedText(hi, 1)} mm`
    case 'insul':
      return `${fixedText(r.odMm, 2)} mm insulation, the wings close on ${T.od[0]}–${T.od[1]} mm: ${r.odMm > T.od[1] ? 'they can’t wrap it' : 'they grip it loosely'}`
    case 'hot':
      return `${ohmsText(r.ohms)} crimp at ${A(r.testA)}: the contact reaches ${C(r.heat?.tempC ?? 0)}`
    default:
      return `Gas-tight ${pct(r.fill)} fill, ${ohmsText(r.ohms)}, holds ${N(r.holdN)} (spec ${N(r.specN)}): the wire gives first`
  }
}

const CRIMP_LEGEND: LegendItem[] = [
  { color: '#c8803f', label: 'Copper strands', shape: 'dot' },
  { color: '#d4d7dc', label: 'Tin-plated brass terminal', shape: 'dot' },
  { color: HIGH_V, label: 'Cut strands / pull-out', shape: 'dot' },
  { color: HEAT, label: 'Tug test force', shape: 'arrow-right' },
]

const SIDE_AT: V3 = [-9.2, 0.8, 0]
const SIDE_K = 1.1
const SECTION_AT: V3 = [-13.6, -8.2, 0]
const SECTION_W = 2.6

export const crimpingConnectorsCrimpingAPin: Lesson = {
  id: 'crimping-connectors-crimping-a-pin',
  title: 'Crimping a pin',
  tagline: 'Strip, pick the die slot and squeeze: see the barrel’s cross-section, then tug the wire against the IEC pull-out spec',
  formula: (p) => {
    const r = cpSolve(cpCfg(p))
    return `fill = A_copper / A_die = ${fixedText(conductorMm2(r.cfg.awg), 3)} mm² / room left = ${pct(r.fill)} (gas-tight ${pct(CRIMP.gasLo)}–${pct(CRIMP.gasHi)}) · pull-out ${N(r.holdN)} vs ${N(r.specN)} (IEC 60352-2)`
  },
  legend: CRIMP_LEGEND,
  points: [
    'A crimp is a cold weld by pressure: the die rolls the conductor wings round the strands and squeezes until copper and brass flow into each other with no air gaps. Gas-tight means no oxygen gets in, so it never corrodes, and it beats solder on a vibrating robot: no stiff, brittle wicked section (Workshop skills › Soldering › Good vs cold joints).',
    'The barrel has to end up about 90 % copper. Loose (a die slot too big, or letting go before the ratchet clicks) leaves voids: point contacts, rising resistance and a wire that pulls out. Too tight (a slot too small) thins and cuts strands, and it snaps at the crimp.',
    'Strip length matters both ways: the conductor wings must sit on bare strands only, a short brush poking out the front; the insulation wings must hold the insulation, as strain relief so flexing doesn’t break strands at the barrel.',
    'Each terminal takes a gauge range (Electricity › Resistance › Resistivity and wire gauge). Its pull-out spec (IEC 60352-2) scales with copper area: 40 N for 0.32 mm² (22 AWG), 6 N for 0.05 mm². A good crimp holds more than the wire itself; that’s the tug test.',
    'Contact resistance turns into heat at current: a gas-tight crimp is a milliohm or two, a loose one many times that, and it gets worse as it oxidises (Power › Wiring & gauge › Connector ratings).',
  ],
  controls: [
    { kind: 'choice', key: 'terminal', options: opts(TERM_NAMES), initial: 'dupont' },
    { kind: 'slider', key: 'awg', label: 'Wire gauge', min: 20, max: 30, step: 2, initial: 24, format: (v) => `${v} AWG (${fixedText(conductorMm2(v), 2)} mm²)` },
    { kind: 'slider', key: 'strip', label: 'Strip length', min: 0.6, max: 4.6, step: 0.1, initial: 2.5, format: (v) => `${fixedText(v, 1)} mm` },
    { kind: 'choice', key: 'die', options: opts(DIE_OPTS), initial: 'match' },
    { kind: 'choice', key: 'stroke', options: opts(STROKE_OPTS), initial: 'early' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const side = crimpTerminal(scene, SIDE_AT, SIDE_K)
    const section = crimpSection(scene, SECTION_AT, 4)
    const tug = stretchArrow(scene, HEAT, 0.12)
    const tugTag = liveLabel(scene, [-8.4, -4.4, 0.3], { size: 0.3, align: 'left' })
    const names = ['contact', 'conductor wings', 'insulation wings'].map(() => liveLabel(scene, [0, -1.7, 0.3], { size: 0.26 }))
    const secTag = liveLabel(scene, [SECTION_AT[0], -11.4, 0.3], { size: 0.28 })
    const rows = textRows(scene, 3, -8.4, -5.6, 0.3, 1.1, 0.3)
    const fillG = columnGauge(scene, 0, {
      min: 0.5,
      max: 1.1,
      window: [CRIMP.gasLo, CRIMP.gasHi],
      marks: [[CRIMP.looseFill, 'loose', GREY], [CRIMP.cutAt, 'cuts', HIGH_V]],
      caption: 'Copper fill of the barrel',
      ticks: [[0.5, '50'], [0.7, '70'], [0.9, '90'], [1.1, '110 %']],
    })
    const pullG = columnGauge(scene, 1, {
      min: 0,
      max: 2,
      window: [1, 2],
      caption: 'Pull-out force ÷ IEC spec',
      ticks: [[0, '0'], [1, '1× spec'], [2, '2×']],
    })
    const heatG = columnGauge(scene, 2, {
      min: 20,
      max: 120,
      window: [20, CRIMP.coolC],
      marks: [[85, 'housing max', HIGH_V]],
      caption: 'Contact °C at the test current',
      ticks: [[25, '25'], [50, '50'], [75, '75'], [100, '100 °C']],
    })
    const clock = lapseClock(CRIMP_LAPSE_S, SLOW, 1.5)
    return {
      scene,
      view: BENCH_VIEW,
      frame(dt, p) {
        const c = cpCfg(p)
        const r = cpSolve(c)
        const T = r.terminal
        const now = clock(dt, cpKey(c))
        const f = crimpAt(r, now)
        const wireMm = awgDiameter(c.awg) * 1e3
        const lift = clamp01((now - CRIMP_LAPSE.closeS) / CRIMP_LAPSE.pauseS) * 1.5
        side.set({ terminal: T, wireMm, odMm: r.odMm, stripMm: c.stripMm, closed: f.closed, lift, fill: r.fill, cut: r.cut, slideMm: f.slideMm, insulation: LEAD_TINT.red })
        const x = (mm: number) => SIDE_AT[0] + mm * SIDE_K
        names[0].group.position.x = x(-3)
        names[1].group.position.x = x(T.condMm / 2)
        names[2].group.position.x = x(T.condMm + T.gapMm + T.insulMm / 2) + 0.6
        names[1].group.position.y = -2.4
        names.forEach((l, i) => l.set(['contact', 'conductor wings', 'insulation wings'][i], GREY))
        const a = side.tugAt()
        tug(a, [a[0] + 1 + (f.forceN / r.specN) * 2, a[1], a[2]], f.failed ? HIGH_V : HEAT)
        tugTag.set(
          !f.tugging ? (f.closed < 1 && now < CRIMP_LAPSE.closeS ? 'die closing' : 'die open') : f.failed ? `let go at ${N(r.holdN)}` : `tug ${N(f.forceN)}`,
          f.failed ? HIGH_V : f.tugging ? HEAT : LABEL,
        )
        section.group.scale.setScalar(SECTION_W / wireMm)
        section.set({ wireMm, fill: r.fill, closed: f.closed, cut: r.cut, onInsulation: r.cover.cond < 0.5 ? LEAD_TINT.red : null })
        secTag.set('barrel cross-section, enlarged', GREY)
        const gas = r.fill >= CRIMP.gasLo && r.fill <= CRIMP.gasHi
        rows[0].set(`${c.awg} AWG, 7 strands · fill ${fillText(r.fill)}${gas ? ' · gas-tight' : r.fill > CRIMP.gasHi ? ' · crushed' : ' · voids'}`, verdictTint(gas, r.fill > CRIMP.looseFill))
        rows[1].set(`crimp ${ohmsText(r.ohms)} (good: ${ohmsText(r.goodOhms)})`, Number.isFinite(r.ohms) ? LABEL : HIGH_V)
        rows[2].set(`strip ${mmFixed(c.stripMm)} · aim ${fixedText(r.window[0], 1)}–${fixedText(r.window[1], 1)} mm`, verdictTint(r.cover.cond >= 1 - 1e-9 && r.cover.insul >= 1 - 1e-9, r.cover.cond >= 0.75))
        fillG.set(Math.min(1.1, Math.max(0.5, r.fill)), fillText(r.fill), verdictTint(gas, r.fill >= CRIMP.gasLo * 0.92 && r.fill <= CRIMP.cutAt + 0.02))
        const ratio = r.holdN / r.specN
        pullG.set(Math.min(2, ratio), N(r.holdN), verdictTint(ratio >= 1, ratio >= 0.8))
        if (r.heat) heatG.set(Math.min(120, r.heat.tempC), `${C(r.heat.tempC)} at ${A(r.testA)}`, verdictTint(r.heat.tempC <= CRIMP.coolC, !r.heat.melts))
        else heatG.set(20, 'open: no contact', HIGH_V)
        header.set(`${T.name} on ${c.awg} AWG: gas-tight, passes the tug test`, r.verdict, crimpWhy(r), 'Hint: matching die slot, full ratchet stroke, strip to the barrel length')
      },
      readouts: (p) => {
        const r = cpSolve(cpCfg(p))
        return [
          { label: 'Fill', value: fillText(r.fill), tone: toneOf(r.fill >= CRIMP.gasLo && r.fill <= CRIMP.gasHi, r.fill > CRIMP.looseFill && r.fill < CRIMP.cutAt) },
          { label: 'Pull-out', value: `${N(r.holdN)} / ${N(r.specN)}`, tone: toneOf(r.holdN >= r.specN, r.holdN >= 0.8 * r.specN) },
          { label: 'Crimp R', value: ohmsText(r.ohms), tone: toneOf(Number.isFinite(r.ohms) && r.ohms < 2 * r.goodOhms, Number.isFinite(r.ohms)) },
          verdictReadout(r.verdict),
        ]
      },
    }
  },
}

// --- Choosing connectors: a job and a part; contact heat through a burst, drop, keying, retention, matings. ---

const JOB_NAMES = namesOf(CONNECTOR_JOBS)
const CONN_NAMES = namesOf(CONNECTORS)
const FLIP_OPTS = { right: 'Plugged in the right way', flipped: 'Plugged in flipped' }
/** Lead colours per job, pin 1 first. */
const JOB_LEADS: Record<JobKey, string[]> = {
  servo: [LEAD_TINT.brown, LEAD_TINT.red, LEAD_TINT.orange],
  battery: [LEAD_TINT.red, LEAD_TINT.black],
  i2c: [LEAD_TINT.red, LEAD_TINT.black, LEAD_TINT.yellow, LEAD_TINT.blue],
  motor: [LEAD_TINT.red, LEAD_TINT.black],
  balance: [LEAD_TINT.black, LEAD_TINT.red, LEAD_TINT.white],
}
const SWAP_TEXT: Record<JobKey, string> = {
  servo: 'signal and ground swap: it just doesn’t move, no harm',
  battery: '+ onto −: reverse polarity, the ESC’s capacitors and FETs blow',
  i2c: 'VCC onto GND: the sensor’s regulator cooks',
  motor: 'leads swapped: the wheel drives backwards',
  balance: 'balance pins reversed: the charger shorts a cell',
}
const plCfg = (p: Params) => ({
  job: pick(JOB_NAMES, p.job, 'battery') as JobKey,
  conn: pick(CONN_NAMES, p.conn, 'dupont') as ConnectorId,
  flipped: p.flip === 'flipped',
})
type PlCfg = ReturnType<typeof plCfg>
const plKey = (c: PlCfg) => `${c.job}|${c.conn}`
const plSolve = memoBy(plKey, (c: PlCfg) => plugRun(c.job, c.conn))
type PlRun = ReturnType<typeof plugRun<JobKey>>

function plugWhy(r: PlRun): string {
  const { J, C: K, S } = r
  switch (r.verdict.fail) {
    case 'pins':
      return `${J.name} needs ${J.pins} wires; a ${K.name} has ${S.pins} contacts`
    case 'melts':
      return `${A(J.amps)} through ${K.name} contacts rated ${A(K.ratedA)}: the housing passes ${C(K.maxC)} and melts`
    case 'reverse':
      return `${K.name} isn’t keyed: plug it in flipped and ${SWAP_TEXT[r.job].split(':')[0]}. Use a keyed housing`
    case 'drop':
      return `${fixedText(r.drop, 2)} V lost across the pair at ${A(J.burstA)}: ${pct(r.dropFrac)} of ${fixedText(J.volts, 1)} V`
    case 'rating':
      return `Runs at ${A(J.amps)} on a ${A(K.ratedA)} rating: it survives, warm (${C(r.steady.tempC)}). Go a size up`
    case 'shake':
      return `It holds ${N(r.holdN)}; vibration and snags tug ${N(J.tugN)}: it shakes loose. Latching housing`
    case 'wear':
      return `${S.cycles} matings rated, the job sees ~${J.cycles}: the contacts wear out. Use a sturdier connector`
    case 'bulky':
      return `Works, but a ${K.name} (${A(K.ratedA)}) on ${A(J.burstA)} is heavy and stiff. A small JST does it`
    default:
      return `${K.name}: peak ${C(r.peakC)}, ${pct(r.dropFrac)} drop, holds ${N(r.holdN)}, ${S.keyed ? 'keyed' : 'swap is harmless'}: the right part`
  }
}

/** The thing on the end of the lead for each job. */
function jobItem(parent: THREE.Object3D, job: JobKey) {
  const g = add(parent, new THREE.Group(), [-15, -2.4, 0])
  if (job === 'servo') sg90Servo(g, [0, 0, 0]).scale.setScalar(1.2)
  else if (job === 'i2c') i2cBreakout(g, [0, 0, 0], { name: 'BME280', k: 0.3 })
  else if (job === 'motor') {
    const m = add(g, buildTtMotor(), [0, -1, 0])
    m.scale.setScalar(0.22)
    m.rotation.set(0.4, -0.6, 0)
  } else {
    box(g, [5.2, 3.4, 1.2], mat('#9aa3b2', { metal: 0.3, rough: 0.35 }), [0, 0, 0])
    box(g, [5.2, 1.4, 1.25], mat('#2856c8', { rough: 0.5 }), [0, 0.6, 0])
    add(g, label('2S 7.4 V LiPo', { size: 0.42, color: '#f2f2f2' }), [0, 0.6, 0.66])
  }
  return g
}

export const crimpingConnectorsChoosingConnectors: Lesson = {
  id: 'crimping-connectors-choosing-connectors',
  title: 'Choosing connectors',
  tagline: 'Pick a connector for each lead on a robot: watch its contacts heat through a current burst, and try plugging it in flipped',
  formula: (p) => {
    const r = plSolve(plCfg(p))
    return `P = I²·R per contact: ${A(r.J.burstA)}² × ${si(r.C.contactOhms, 'Ω', 2)} = ${si(r.J.burstA ** 2 * r.C.contactOhms, 'W', 2)} · ΔT ∝ P (30 K at ${A(r.C.ratedA)}), lag τ = ${r.S.tauS} s · drop = 2·I·R = ${si(r.drop, 'V', 2)}`
  },
  legend: [
    { color: HEAT, label: 'Contact heat (thermal tint)', shape: 'dot' },
    ...verdictLegend('Fails the job', 'Within the job’s limits', 'Works, but a close miss'),
  ],
  points: [
    'Current rating first. Every contact is a small resistor; I²R heat at the running current, plus bursts (a 2S drive pulling 40 A to accelerate), must stay under the housing’s limit. A Dupont pin is fine for a servo and melts on a battery lead (Power › Wiring & gauge › Connector ratings).',
    'Bursts are short and connectors have thermal mass: temperature lags with a time constant of tens of seconds, so an XT60 shrugs off a 5 s 40 A burst while a continuous overload cooks it.',
    'Keying: a housing that only fits one way stops a reversed battery, a sensor with VCC on GND, or motor leads swapped. Unkeyed Dupont is fine only where a flip is harmless, like a servo plug, whose + pin sits in the middle (Components › Fuses & protection › Reverse-polarity protection).',
    'Retention: robots shake. A latch or friction lock has to beat the tug from vibration and snags. Mating cycles: a battery plug is swapped hundreds of times, a sensor lead a handful; plating wears through.',
    'The usual answers: XT60 (or XT30 below 15 A) for battery power, JST-XH for balance leads (Power › 18650 packs › Balancing), JST-PH/XH for sensors and small motors, Dupont-type 3-pin for servos. Oversize works but costs weight and stiff leads.',
  ],
  controls: [
    { kind: 'choice', key: 'job', options: opts(JOB_NAMES), initial: 'battery' },
    { kind: 'choice', key: 'conn', options: opts(CONN_NAMES), initial: 'dupont' },
    { kind: 'choice', key: 'flip', options: opts(FLIP_OPTS), initial: 'right' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const pair = plugPair(scene, [-5.4, -1.6, 0], 0.3)
    const leads = add(scene, new THREE.Group())
    let item: THREE.Group | null = null
    const board = add(scene, new THREE.Group(), [1.2, -1.6, 0])
    box(board, [2.2, 6, 0.4], mat('#1f6b3a', { rough: 0.6 }), [0, 0, 0])
    const boardTag = liveLabel(scene, [1.2, 2, 0.3], { size: 0.28 })
    const itemTag = liveLabel(scene, [-15, 1.4, 0.3], { size: 0.28 })
    const flipTag = liveLabel(scene, [-7.5, -6.2, 0.3], { size: 0.3 })
    const timeTag = liveLabel(scene, [-7.5, 2.6, 0.3], { size: 0.3 })
    const rows = textRows(scene, 2, -17, -8.6, 0.28, 1.1, 0.3)
    const tempG = columnGauge(scene, 0, {
      min: 20,
      max: 150,
      window: [20, 60],
      caption: 'Contact temperature (live)',
      ticks: [[25, '25'], [75, '75'], [125, '125 °C']],
    })
    const maxMark = add(tempG.group, new THREE.Group())
    const dropG = columnGauge(scene, 1, {
      min: 0,
      max: 0.1,
      window: [0, 0.02],
      caption: 'Drop across the pair at the burst',
      ticks: [[0, '0'], [0.05, '5'], [0.1, '10 %']],
    })
    const holdG = columnGauge(scene, 2, {
      min: 1,
      max: 100,
      log: true,
      window: [3, 100],
      caption: 'Hold-in force (green: beats the tug)',
      ticks: [[1, '1'], [10, '10'], [100, '100 N']],
    })
    const smokeMat = new THREE.MeshStandardMaterial({ color: HIGH_V, emissive: HIGH_V, emissiveIntensity: 0.8, transparent: true, opacity: 0.3, depthWrite: false })
    const smoke = add(scene, new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), smokeMat), [-15, -2.4, 0.5])
    smoke.visible = false
    let built = ''
    let clock = lapseClock(1, 1, 1)
    let clockFor = ''
    let melted = false
    let last = 0
    return {
      scene,
      view: BENCH_VIEW,
      frame(dt, p) {
        const c = plCfg(p)
        const r = plSolve(c)
        const { J, C: K, S } = r
        const key = `${plKey(c)}|${c.flipped}`
        if (clockFor !== plKey(c)) {
          clockFor = plKey(c)
          clock = lapseClock(plugLapseS(J), 1, 1.5)
        }
        const blocked = c.flipped && S.keyed
        const gap = blocked ? 5 : 0
        if (built !== key) {
          built = key
          pair.build(c.conn, J.pins)
          pair.set(gap, c.flipped, 0, false)
          item?.removeFromParent()
          item = jobItem(scene, c.job)
          leads.clear()
          const left = pair.ends(-1)
          const right = pair.ends(1)
          const cols = c.flipped && !S.keyed ? [...JOB_LEADS[c.job]].reverse() : JOB_LEADS[c.job]
          left.forEach((e, i) => cableRun(leads, [[-12.4, -2.4 + (i - (J.pins - 1) / 2) * 0.5, 0], [e[0] - 1.5, e[1], e[2]], e], JOB_LEADS[c.job][i], 0.13))
          right.forEach((e, i) => cableRun(leads, [e, [e[0] + 1.2, e[1], e[2]], [0.1, -1.6 + (i - (J.pins - 1) / 2) * 0.6, 0]], cols[i], 0.13))
          maxMark.clear()
          const u = ((K.maxC - 20) / 130 - 0.5) * 7.6
          box(maxMark, [0.1, 1, 0.1], mat(HIGH_V), [u, 0, 0.08])
          add(maxMark, label(`melts ${C(K.maxC)}`, { size: 0.22, color: HIGH_V }), [u, 0.72, 0.2])
          dropG.setWindow(0, J.dropFrac)
          holdG.setWindow(J.tugN, 100)
          melted = false
        }
        const now = clock(dt, key)
        if (now < last) melted = false
        last = now
        const tC = blocked ? 25 : plugTempAt(K, S.tauS, J, now)
        melted ||= tC > K.maxC
        const inBurst = now >= PLUG_LAPSE.burstAtS && now < PLUG_LAPSE.burstAtS + J.burstS
        pair.set(gap, c.flipped, Math.max(0, Math.min(1, (tC - 40) / (K.maxC - 40))), melted)
        timeTag.set(blocked ? 'no current: it won’t go in' : `${fixedText(now, 1)} s · ${A(inBurst ? J.burstA : J.amps)}${inBurst ? ' burst' : ''}`, inBurst ? HEAT : LABEL)
        itemTag.set(J.name, LABEL)
        boardTag.set(c.job === 'balance' ? 'charger' : 'robot', GREY)
        const harm = c.flipped && !S.keyed ? J.swap : null
        smoke.visible = harm === 'damage'
        smoke.scale.setScalar(1.3 + 0.3 * Math.abs(Math.sin(now * 5)))
        flipTag.set(
          !c.flipped ? (S.keyed ? 'keyed: fits one way only' : 'not keyed: fits either way') : blocked ? 'flipped: the key blocks it' : `flipped: ${SWAP_TEXT[c.job]}`,
          !c.flipped ? (S.keyed ? POWER : RING) : blocked ? POWER : harm === 'harmless' ? RING : HIGH_V,
        )
        rows[0].set(`${K.name}: ${A(K.ratedA)} rated · ${si(K.contactOhms, 'Ω', 1)}/contact · ${S.keyed ? 'keyed' : 'not keyed'} · ${S.cycles} matings`, LABEL)
        rows[1].set(`${J.name}: ${J.pins} wires · ${A(J.amps)}, ${A(J.burstA)} for ${fixedText(J.burstS, 1)} s · tug ${N(J.tugN)}`, GREY)
        const hot = tC > K.maxC
        tempG.set(Math.min(150, tC), hot ? `melts (> ${C(K.maxC)})` : C(tC), verdictTint(tC <= 60, !hot))
        dropG.set(Math.min(0.1, r.dropFrac), pct(r.dropFrac), verdictTint(r.dropFrac <= J.dropFrac, r.dropFrac <= 2 * J.dropFrac))
        holdG.set(Math.min(100, r.holdN), N(r.holdN), verdictTint(r.holdN >= J.tugN, r.holdN >= 0.5 * J.tugN))
        header.set(`a connector for the ${lowerFirst(J.name.replace(/ \(.*\)/, ''))}`, r.verdict, plugWhy(r), 'Hint: amps first, then keying, then how it holds and how often it’s plugged')
      },
      readouts: (p) => {
        const r = plSolve(plCfg(p))
        return [
          { label: 'Peak contact', value: r.peakC > r.C.maxC ? 'melts' : C(r.peakC), tone: toneOf(r.peakC <= 60, r.peakC <= r.C.maxC) },
          { label: 'Drop', value: pct(r.dropFrac), tone: toneOf(r.dropFrac <= r.J.dropFrac, r.dropFrac <= 2 * r.J.dropFrac) },
          { label: 'Hold-in', value: N(r.holdN), tone: toneOf(r.holdN >= r.J.tugN, r.holdN >= 0.5 * r.J.tugN) },
          verdictReadout(r.verdict),
        ]
      },
    }
  },
}
