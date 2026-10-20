import {
  AMS1117_33,
  CHEMISTRIES,
  DEAD_FAULTS,
  DEAD_HUNT,
  DEAD_PROBES,
  DeadFault,
  DeadProbe,
  FaultHunt,
  LM2596,
  MeterRead,
  REVERSE_FAULTS,
  REVERSE_HUNT,
  REVERSE_PROBES,
  ReverseFault,
  ReverseProbe,
  SHORT_FAULTS,
  SHORT_HUNT,
  SHORT_PROBES,
  SUPPLY_BOT,
  ShortFault,
  ShortProbe,
  deadBattery,
  guardCompare,
  holderVolts,
  reversePolarity,
  shortCircuit,
  shortCircuitAmps,
  shortedLdoRun,
} from '../../core/physics'
import { fixedText, si, volts } from '../../core/units'
import { V3 } from '../../models/kit'
import { FACE_VIEW, HEAT, HIGH_V, HUNT_LEGEND, POWER, SupplyPart, SupplyTp, huntKit, huntStage, probeMeter, readingText, supplyBench } from '../fx'
import { Lesson, Stage } from '../types'

const W = (w: number) => si(w, 'W', 3)
const C = (c: number) => `${Math.round(c)} °C`

interface Tip {
  red: SupplyTp | SupplyPart
  black: SupplyTp
  /** Switch position while probing. */
  on: boolean
}

interface HuntSpec<F extends string, P extends string> {
  hunt: FaultHunt<F, P>
  kit: ReturnType<typeof huntKit<F, P>>
  guard: 'fuse' | 'diode'
  driver?: boolean
  tips: Record<P, Tip>
  /** Probe whose reading says whether the ESP32's power LED is lit. */
  led: P
  parts: Record<F, SupplyPart>
  symptom: string
  hint: string
  fixes: Record<F, string>
  /** Extra visuals once the fault is found (cells turned round, a melted fuse…). */
  reveal?: (bench: ReturnType<typeof supplyBench>, truth: F, found: boolean) => void
}

const HOT: Record<string, SupplyPart> = { 'pack lead': 'lead', LM2596: 'buck', AMS1117: 'ldo' }

/** Shared stage: supply bench, meter on the chosen test points, suspect table, hunt header. */
function huntBuild<F extends string, P extends string>(s: HuntSpec<F, P>, colW: number): Stage {
  const { scene, header } = huntStage()
  const bench = supplyBench(scene, { guard: s.guard, driver: s.driver })
  const meter = probeMeter(scene, [9.8, 0.4, 0])
  const table = s.kit.table(scene, [-17, -3.9, 0], { colW, nameW: 5.4 })
  const track = s.kit.track()
  const st = { t: 0, seen: [] as P[] }
  const spot = (k: SupplyTp | SupplyPart, read: MeterRead): V3 => {
    if (k in bench.tp) return bench.tp[k as SupplyTp]
    const part = read.label ? HOT[read.label] : undefined
    return bench.spots[part ?? (k as SupplyPart)]
  }
  return {
    scene,
    view: FACE_VIEW,
    frame(dt, p) {
      st.t += dt
      const q = s.kit.params(p)
      st.seen = track(q)
      const tip = s.tips[q.probe]
      const read = s.hunt.read(q.truth, q.probe)
      meter.aim(spot(tip.red, read), bench.tp[tip.black])
      meter.show(read, st.t)
      bench.setSwitch(tip.on)
      const lit = s.hunt.read(q.truth, s.led)
      const blink = lit.alt !== undefined ? Math.floor(st.t * 2) % 2 : lit.value > 3 ? 1 : 0
      bench.setLed(tip.on ? blink : 0)
      bench.clearGlow()
      if (read.unit === '°C' && read.label && HOT[read.label]) bench.glow(HOT[read.label], Math.min(1.6, (read.value - 25) / 90), HEAT)
      const found = q.guess === q.truth
      if (q.guess) bench.glow(s.parts[q.guess], 0.8, found ? POWER : HIGH_V)
      s.reveal?.(bench, q.truth, found)
      const [why, hint] = s.kit.words(q, st.seen, s.fixes, s.hint)
      header.set(s.symptom, s.kit.verdict(q), why, hint)
      s.kit.fill(table, q, st.seen)
    },
    readouts: (p) => s.kit.readouts(s.kit.params(p), st.seen),
  }
}

const POINTS_HUNT =
  'The hunt: each case hides one suspect (shuffled). Pick a test point: the probes jump there and the meter reads it. Compare with the Healthy row; when one suspect fits everything you measured, pick it. A wrong pick says which reading rules it out; the right one opens the table: green fits, red rules out.'

// --- Dead battery ---

const deadKit = huntKit(DEAD_HUNT, DEAD_FAULTS, DEAD_PROBES, 11)
const dead = (f: DeadFault | 'ok') => deadBattery(f)
const DEAD_FIX: Record<DeadFault, string> = {
  worn: `Worn-out cells: ${volts(dead('worn').ocv)} at rest, but ~${DEAD_FAULTS.worn.cellOhms} Ω each; they give at most ${W(dead('worn').maxW)}, the buck needs ${W(dead('worn').needW)}. Fresh cells`,
  flat: `Flat pack: ${volts(dead('flat').ocv)} is under the LM2596’s ${volts(LM2596.vinMin)} minimum, it never starts. Recharge or replace`,
  switch: `Switch contacts open: full volts before it, 0 V after. Replace the switch`,
  contact: `Corroded springs: the cells hold up, the crust drops the rest and the buck input collapses. Clean the contacts`,
  buck: `Dead LM2596: ${volts(dead('buck').ocv)} in, nothing out. Replace the module`,
}

export const wontPowerOnDeadBattery: Lesson = {
  id: 'won-t-power-on-dead-battery',
  title: 'Dead battery',
  tagline: 'The pack reads fine on the meter, yet the robot is dead: measure at rest and under load, then walk the chain',
  formula: (p) => {
    const q = deadKit.params(p)
    const d = dead(q.truth)
    if (q.guess === q.truth && (q.truth === 'worn' || q.truth === 'contact'))
      return `P_max = OCV² / 4R = ${fixedText(d.ocv, 2)}² / (4 × ${fixedText(d.rs + d.rl, 2)} Ω) = ${W(d.maxW)} < ${W(d.needW)} the buck needs → no steady point, it hiccups`
    return `V_loaded = OCV − I·R · healthy: ${volts(dead('ok').ocv)} − ${si(dead('ok').boot!.amps, 'A', 2)} × ${fixedText(dead('ok').rs, 2)} Ω = ${volts(dead('ok').boot!.packV)}`
  },
  legend: HUNT_LEGEND,
  points: [
    POINTS_HUNT,
    'Measure at rest and under load. With nothing drawing, a meter reads the open-circuit voltage, which says little about health: worn alkaline cells rest at a normal-looking 1.4 V each. Under load the internal resistance shows: V = OCV − I·R (Power › Battery chemistry › Internal resistance).',
    `A weak source can’t feed a regulator at all. A buck draws constant power, so as its input sags it pulls more current, which sags it more. A source gives at most OCV² / 4R (Electricity › Thevenin & Norton › Maximum power transfer); if that’s under the ${W(dead('ok').needW)} the boot burst needs, the input falls to the buck’s ${volts(LM2596.vinMin)} minimum, it quits, the pack recovers, repeat: the LED blinks and the meter flickers.`,
    'Walk the chain from the source: pack at rest, pack under load, buck input, 5 V rail. The fault is where the voltage goes missing: a sag at the pack terminals is the cells; full volts at the pack but a collapse at the buck input is the path between them (Power › Wiring & gauge › Voltage drop).',
    'Black probe on ground, red on the point: the meter reads red minus black (Electricity › Voltage › Measuring with a multimeter).',
  ],
  controls: deadKit.controls,
  build: () =>
    huntBuild<DeadFault, DeadProbe>(
      {
        hunt: DEAD_HUNT,
        kit: deadKit,
        guard: 'fuse',
        tips: {
          rest: { red: 'pack', black: 'gndPack', on: false },
          loaded: { red: 'pack', black: 'gndPack', on: true },
          buckIn: { red: 'buckIn', black: 'gnd', on: true },
          rail: { red: 'rail5', black: 'gnd', on: true },
        },
        led: 'rail',
        parts: { worn: 'holder', flat: 'holder', switch: 'switch', contact: 'holder', buck: 'buck' },
        symptom: 'switch on: the power LED stays dark or blinks, the ESP32 never boots',
        hint: 'Hint: rest vs switched on tells charge from health; then follow the volts to the ESP32',
        fixes: DEAD_FIX,
      },
      3.6,
    ),
}

// --- Reverse polarity ---

const revKit = huntKit(REVERSE_HUNT, REVERSE_FAULTS, REVERSE_PROBES, 23)
const GUARDS = guardCompare()
const okRev = reversePolarity('ok')
const REV_FIX: Record<ReverseFault, string> = {
  plug: `Plug wired backwards: ${readingText(reversePolarity('plug').reads.plug)} at the plug; the diode blocks it and saved the board. Re-pin the crimps`,
  cells: `Two cells in backwards: ${volts(reversePolarity('cells').ocv)} instead of ${volts(okRev.ocv)}, under the buck’s ${volts(LM2596.vinMin)}. Turn them round`,
  diode: `Guard diode backwards: all ${volts(okRev.ocv)} sits across it, nothing passes. Turn it round, stripe (cathode) toward the board`,
  buck: `Buck killed by a reverse before the guard went in: volts reach it, 0 V out. Replace it; keep the guard`,
}

export const wontPowerOnReversePolarity: Lesson = {
  id: 'won-t-power-on-reverse-polarity',
  title: 'Reverse polarity',
  tagline: 'A new pack and a dead robot: read the signs on the meter, find what’s backwards, and see what a guard saves',
  formula: () =>
    `No guard: ${si(GUARDS.noneA, 'A', 2)} through the substrate diodes · 1N4007: ${volts(GUARDS.diodeV)}, ${W(GUARDS.diodeW)} lost · P-FET: ${si(GUARDS.pfetV, 'V', 2)}, ${W(GUARDS.pfetW)}`,
  legend: HUNT_LEGEND,
  points: [
    POINTS_HUNT,
    `This board has a series 1N4007 guard: the right way round it drops ${volts(GUARDS.diodeV)} and passes ${si(okRev.boot!.amps, 'A', 2)}; backwards it blocks. A negative reading means the red probe sits on the lower side: on a plug, the crimps are swapped (Electricity › Voltage › Measuring with a multimeter).`,
    'Across a diode, red on the pack side: ~0.8 V with current flowing is normal; the whole pack voltage across it means it’s blocking, either because the pack is backwards (reads negative) or the diode is (stripe = cathode).',
    `What fails without a guard: backwards, every chip’s substrate (ESD) diodes conduct straight across the cells, ${si(GUARDS.noneA, 'A', 2)} here, ${W(GUARDS.noneW)} in silicon. A P-MOSFET guard costs only ${si(GUARDS.pfetV, 'V', 2)} where the diode costs ${volts(GUARDS.diodeV)} (Components › Fuses & protection › Reverse-polarity protection).`,
    `Cells in a holder add; a backwards one subtracts. Two of six turned round leave 2 × ${volts(holderVolts() / SUPPLY_BOT.series)} = ${volts(reversePolarity('cells').ocv)}. Current measured in series: here across the open switch, so the meter closes the circuit.`,
  ],
  controls: revKit.controls,
  build: () =>
    huntBuild<ReverseFault, ReverseProbe>(
      {
        hunt: REVERSE_HUNT,
        kit: revKit,
        guard: 'diode',
        tips: {
          plug: { red: 'pack', black: 'gndPack', on: true },
          guard: { red: 'guardIn', black: 'guardOut', on: true },
          buckIn: { red: 'buckIn', black: 'gnd', on: true },
          rail: { red: 'rail5', black: 'gnd', on: true },
          amps: { red: 'swIn', black: 'swOut', on: false },
        },
        led: 'rail',
        parts: { plug: 'plug', cells: 'holder', diode: 'guard', buck: 'buck' },
        symptom: 'new pack plugged in: no LED, nothing at all',
        hint: 'Hint: watch the sign at the plug, then the volts across the diode',
        fixes: REV_FIX,
        reveal(bench, truth, found) {
          bench.flipCells(found && truth === 'cells' ? 2 : 0)
          if (truth === 'diode') bench.flipGuard(found)
        },
      },
      3.4,
    ),
}

// --- Short circuit ---

const shortKit = huntKit(SHORT_HUNT, SHORT_FAULTS, SHORT_PROBES, 37)
const sh = (f: ShortFault) => shortCircuit(f)
const LDO = shortedLdoRun(SUPPLY_BOT.rail)
const LI_SHORT_A = shortCircuitAmps(CHEMISTRIES.liion, SUPPLY_BOT.soc)
const SHORT_FIX: Record<ShortFault, string> = {
  lead: `Pinched pack lead, before the fuse: ${si(sh('lead').amps, 'A', 2)} heats it to ${C(sh('lead').reads.heat.value)}. Re-route, sleeve, fuse at the pack`,
  blown: `Motor rail short blew the T1A in ${si(sh('blown').meltS, 's', 2)}: OL across it. Clear the short first, then a new fuse`,
  rail5: `Solder bridge on 5 V: the LM2596 sits at its current limit (${si(sh('rail5').amps, 'A', 2)}) at ${C(sh('rail5').reads.heat.value)}. Remove the bridge`,
  rail33: `Shorted 3.3 V cap: the AMS1117 trips at ${C(AMS1117_33.tOff)}, restarts at ${C(AMS1117_33.tOn)}, every ${si(LDO.period, 's', 2)}. Replace the cap`,
}

export const wontPowerOnShortCircuit: Lesson = {
  id: 'won-t-power-on-short-circuit',
  title: 'Short circuit',
  tagline: 'Dead and smelling hot: where is the short, and what limits the current: the cells, a fuse or a regulator?',
  formula: (p) => {
    const q = shortKit.params(p)
    if (q.guess === q.truth && q.truth === 'blown') return `t_melt = τ·ln(h / (h − 1)), h = (I / I_min)² · I = ${si(sh('blown').amps, 'A', 2)} → ${si(sh('blown').meltS, 's', 2)}`
    if (q.guess === q.truth && q.truth === 'rail33') return `T_j → 25 °C + θ·P = 25 + ${AMS1117_33.thetaJA} × ${W(SUPPLY_BOT.rail * AMS1117_33.maxAmps)}: trips in ${si(LDO.firstTripS, 's', 2)}, on ${Math.round(LDO.duty * 100)} % of the time`
    return `I_short = OCV / (R_cells + R_wire + R_short) = ${volts(holderVolts())} / ${fixedText(SUPPLY_BOT.series * CHEMISTRIES.alkaline.cell.ohms, 2)} Ω + … ≈ ${si(sh('lead').amps, 'A', 2)}`
  },
  legend: HUNT_LEGEND,
  points: [
    POINTS_HUNT,
    `A short draws whatever the source can give: I = OCV / (R_cells + R_wire + R_short). Six alkaline AAs (0.15 Ω each) limit it to ~${si(sh('lead').amps, 'A', 2)}; a Li-ion 18650 would push ~${si(LI_SHORT_A, 'A', 2)} (Power › Battery chemistry › Internal resistance).`,
    `A fuse guards only what’s after it. A short in the pack lead, before the fuse, just heats the wire: ${C(sh('lead').reads.heat.value)} on 22 AWG, past PVC’s 80 °C (Power › Wiring & gauge › Voltage drop). Fuse at the pack.`,
    `After the fuse, the T1A melts in ${si(sh('blown').meltS, 's', 2)} at ${si(sh('blown').amps, 'A', 2)} and reads OL, power off (Components › Fuses & protection › Fuse ratings). It blew for a reason: find the short before fitting a new one. A polyfuse would reset once it cools.`,
    `Regulators protect themselves: the LM2596 holds its switch current limit and runs hot; the AMS1117 into a short burns ${W(SUPPLY_BOT.rail * AMS1117_33.maxAmps)}, trips at ${C(AMS1117_33.tOff)}, restarts at ${C(AMS1117_33.tOn)} (Components › Voltage regulators › Dropout and heat). A thermal camera or a fingertip finds them fast.`,
  ],
  controls: shortKit.controls,
  build: () =>
    huntBuild<ShortFault, ShortProbe>(
      {
        hunt: SHORT_HUNT,
        kit: shortKit,
        guard: 'fuse',
        driver: true,
        tips: {
          pack: { red: 'pack', black: 'gndPack', on: true },
          fused: { red: 'guardOut', black: 'gnd', on: true },
          rail5: { red: 'rail5', black: 'gnd', on: true },
          rail33: { red: 'rail33', black: 'gnd', on: true },
          fuse: { red: 'guardIn', black: 'guardOut', on: false },
          heat: { red: 'buck', black: 'gnd', on: true },
        },
        led: 'rail33',
        parts: { lead: 'lead', blown: 'driver', rail5: 'buck', rail33: 'ldo' },
        symptom: 'switch on: no LED, and something smells hot',
        hint: 'Hint: find where the volts vanish, then check the fuse and what’s warm',
        fixes: SHORT_FIX,
        reveal(bench, truth, found) {
          bench.fuse?.set(0, truth === 'blown' && found ? 1 : 0)
        },
      },
      3.2,
    ),
}
