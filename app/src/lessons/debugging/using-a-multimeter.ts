import {
  AMP_FAULTS,
  AMP_HUNT,
  AMP_PROBES,
  AmpFault,
  AmpProbe,
  CONT_FAULTS,
  CONT_HUNT,
  CONT_PROBES,
  ContFault,
  ContProbe,
  DMM,
  FUSES,
  METER_BOT,
  METER_NODE,
  VOLT_FAULTS,
  VOLT_HUNT,
  VOLT_PROBES,
  VoltFault,
  VoltProbe,
  ampSpot,
  contSpot,
  dmmMistake,
  fuseMeltTime,
  shortCircuitAmps,
  CHEMISTRIES,
  SUPPLY_BOT,
  spotRead,
  voltSpot,
} from '../../core/physics'
import { si, volts } from '../../core/units'
import { V3 } from '../../models/kit'
import { FACE_VIEW, GREY, HEAT, METER_LEGEND, SupplyPart, SupplyTp, dmmControls, glowHalo, huntKit, huntStage, liveLabel, meterRig, motorCan, readingText, supplyBench, wire } from '../fx'
import { Control, Lesson, Stage, opts, pick } from '../types'

const A = (a: number) => si(a, 'A', 2)
const OHM = (o: number) => si(o, 'Ω', 2)
const HOWTO =
  'The hunt: each case hides one suspect. Pick a test point, then set the meter for it: dial, red lead’s socket (black stays in COM) and power. A wrong setup shows what the meter really does and the reading doesn’t count; a fair one joins the table. When one suspect fits everything, pick it.'
/** Controls: case, test point, dial, socket, any extra, diagnosis. */
const withMeter = (kit: { controls: Control[] }, dial: Parameters<typeof dmmControls>, extra: Control[] = []) => [...kit.controls.slice(0, 2), ...dmmControls(...dial), ...extra, kit.controls[2]]

// --- Continuity test ---

const contKit = huntKit(CONT_HUNT, CONT_FAULTS, CONT_PROBES, 53)
const POWER_OPTS = { off: 'Pack unplugged', on: 'Pack in, switch on' }
const CONT_TIPS: Record<ContProbe, [SupplyTp, SupplyTp]> = {
  lead: ['pack', 'swIn'],
  switch: ['swIn', 'swOut'],
  diode: ['guardIn', 'guardOut'],
  diodeRev: ['guardOut', 'guardIn'],
  ground: ['gndPack', 'gnd'],
  rail: ['rail5', 'gnd'],
}
const cr = (f: ContFault | 'ok', p: ContProbe) => CONT_HUNT.read(f, p)
const CONT_FIX: Record<ContFault, string> = {
  lead: `Broken strand inside the red lead: OL end to end, though it looks fine. Replace the lead`,
  joint: `Cold joint on the switch: ${readingText(cr('joint', 'switch'))}, between the beeper’s 30 and 50 Ω, so it chirps. Reflow it`,
  diode: `1N4007 in backwards: OL with red on the anode side, ${readingText(cr('diode', 'diodeRev'))} the other way. Stripe toward the buck`,
  bridge: `Solder bridge, 5 V to GND: ${readingText(cr('bridge', 'rail'))} where a healthy board reads ${readingText(cr('ok', 'rail'))}. Clear it before powering up`,
}

export const usingAMultimeterContinuityTest: Lesson = {
  id: 'using-a-multimeter-continuity-test',
  title: 'Continuity test',
  tagline: 'Beep along the supply chain with the pack out: broken wires, cold joints, a backwards diode and a short, before they cost a board',
  formula: `R = R_ref · V / (V_open − V) · beeps < ${DMM.beep.on} Ω, silent > ${DMM.beep.off} Ω · diode test ≈ 1 mA`,
  legend: METER_LEGEND,
  points: [
    HOWTO,
    `Ω and the beeper push the meter’s own small current (a ${volts(DMM.ohmOpenV)} source behind ${OHM(DMM.ohmRef)}) and read the volts it makes. So the circuit must be dead: pack in, the same good lead reads ${readingText(contRead('ok', 'lead', true))} instead of ${readingText(cr('ok', 'lead'))}, made up by the robot’s own current. Unplug first (Electricity › Ohm’s law › V = IR).`,
    `The beeper is a threshold, not a verdict: under ~${DMM.beep.on} Ω it beeps, over ~${DMM.beep.off} Ω it stays silent, in between it chirps. A ${OHM(METER_BOT.coldJointOhms)} cold joint can chirp “OK” and still drop volts under load; switch to Ω for a number. Touch the probes together first: ${OHM(DMM.leadOhms)} is the leads.`,
    `A diode conducts one way: the diode test pushes ~1 mA and shows the drop, ${readingText(cr('ok', 'diode'))} forward on a 1N4007, OL backwards (Semiconductors › Diodes). Ω can’t test it: the reading depends on the test current. Test both ways.`,
    `A short shows as a beep where there should be none: 5 V to GND on a healthy board reads ${readingText(cr('ok', 'rail'))} (the off board), not 0. Check every rail to GND before first power-up. Broken strands hide inside insulation: flex the wire while probing.`,
  ],
  controls: withMeter(contKit, ['beep', 'v'], [{ kind: 'choice', key: 'power', options: opts(POWER_OPTS), initial: 'off' }]),
  build(): Stage {
    const { scene, header } = huntStage()
    const bench = supplyBench(scene, { guard: 'diode' })
    const tag = liveLabel(scene, [-15.3, 3.2, 0.4], { size: 0.3 })
    const rig = meterRig<ContFault, ContProbe, SupplyTp, SupplyPart>(scene, header, {
      hunt: CONT_HUNT,
      kit: contKit,
      bench,
      measure(q, s, p) {
        const live = pick(POWER_OPTS, p.power, 'off') === 'on'
        const spot = contSpot(q.truth, q.probe, live)
        const r = spotRead(spot, s)
        const [red, black] = CONT_TIPS[q.probe]
        return { r, miss: dmmMistake(spot.want, s, r, { live }), want: spot.want, red, black }
      },
      parts: { lead: 'lead', joint: 'switch', diode: 'guard', bridge: 'buck' },
      shorted: 'holder',
      symptom: 'new harness, not yet powered: check it before the first switch-on',
      hint: 'Hint: beep each wire end to end, test the diode both ways, then 5 V to GND',
      fixes: CONT_FIX,
      table: { colW: 3.1, nameW: 5.6 },
      extra({ q, found, p }) {
        const live = p.power === 'on'
        bench.setSwitch(true)
        bench.setLed(live && contRead(q.truth, 'rail', true).value > 3 ? 1 : 0)
        tag.set(live ? '' : 'pack unplugged', GREY)
        bench.flipGuard(found && q.truth === 'diode')
      },
    })
    return { scene, view: FACE_VIEW, ...rig }
  },
}

/** The 5 V rail (or any probe) read with the right setup, powered or not. */
function contRead(f: ContFault | 'ok', p: ContProbe, live: boolean) {
  const spot = contSpot(f, p, live)
  const r = spotRead(spot, live ? { dial: p === 'rail' ? 'vdc' : 'ohm', jack: 'v' } : { dial: 'ohm', jack: 'v' })
  return { value: r.shown ?? Infinity, unit: p === 'rail' && live ? ('V' as const) : ('Ω' as const), open: r.shown === null }
}

// --- Voltage test ---

const voltKit = huntKit(VOLT_HUNT, VOLT_FAULTS, VOLT_PROBES, 59)
const COM_OPTS = { gnd: 'COM on GND', rail5: 'COM on 5 V' }
const VOLT_TIPS: Record<VoltProbe, [SupplyTp, SupplyTp]> = {
  pack: ['pack', 'gndPack'],
  fuse: ['guardIn', 'guardOut'],
  buckIn: ['buckIn', 'gnd'],
  rail5: ['rail5', 'gnd'],
  rail33: ['rail33', 'gnd'],
}
const vr = (f: VoltFault | 'ok', p: VoltProbe) => VOLT_HUNT.read(f, p)
const VOLT_FIX: Record<VoltFault, string> = {
  flat: `Flat pack: ${readingText(vr('flat', 'pack'))}, under the LM2596’s 4.5 V, so nothing downstream starts. Recharge or replace`,
  fuse: `Blown fuse: the whole ${readingText(vr('fuse', 'fuse'))} sits across it, 0 V after it. Find why it blew, then a new T1A`,
  buck: `Dead buck: ${readingText(vr('buck', 'buckIn'))} in, 0 V out. Replace the module`,
  ldo: `Dead AMS1117: 5 V in, 0 V on 3.3 V. Replace the regulator (or feed 3.3 V)`,
}
const PACK_SHORT = (() => {
  const r = spotRead(voltSpot('ok', 'pack'), { dial: 'vdc', jack: 'a10' })
  return r.amps
})()

export const usingAMultimeterVoltageTest: Lesson = {
  id: 'using-a-multimeter-voltage-test',
  title: 'Voltage test',
  tagline: 'Walk the volts down a powered robot: meter across, COM on ground, V⎓ on the dial and the red lead in VΩ, or it lies (or shorts)',
  formula: (p) => {
    const q = voltKit.params(p)
    if (q.probe === 'fuse') return `V = I·R: a good fuse drops ${si(SUPPLY_BOT.fuseOhms, 'Ω', 1)} × I, millivolts; an open one has the whole supply across it`
    return `V_meter = V_red − V_black · 10 MΩ across: I_meter = ${si(vr('ok', 'pack').value / DMM.vOhms, 'A', 2)}`
  },
  legend: METER_LEGEND,
  points: [
    HOWTO,
    'Volts are measured across, with the circuit running: black (COM) on ground, red on the point. The meter reads red minus black (Electricity › Voltage › Measuring with a multimeter); COM left on 5 V makes the 3.3 V rail read −1.7 V and the pack +3.8 V.',
    `Red lead left in the 10A socket from a current test: that socket is a ${si(DMM.a10.ohms, 'Ω', 2)} shunt to COM on every dial. Across the pack it’s a dead short: ${A(PACK_SHORT)} out of six AAs, the leads heat, the display says 0.00. A 2S Li-ion pack would push ~${A(shortCircuitAmps(CHEMISTRIES.liion, 0.8))}, past even the F10A.`,
    `Dial matters: V~ is AC-coupled, so a battery reads 0; mV⎓ is a ${si(DMM.mvMax, 'V', 1)} range, so 8 V reads OL, but it’s the right range for the drop across a good fuse. Ω or the beeper on a live rail just fight the circuit (Power › Brownouts).`,
    'Walk the chain from the pack: where the volts vanish is the fault. Full volts across a fuse = open; volts in but not out = that regulator.',
  ],
  controls: withMeter(voltKit, ['vdc', 'v'], [{ kind: 'choice', key: 'black', options: opts(COM_OPTS), initial: 'gnd' }]),
  build(): Stage {
    const { scene, header } = huntStage()
    const bench = supplyBench(scene, { guard: 'fuse' })
    const rig = meterRig<VoltFault, VoltProbe, SupplyTp, SupplyPart>(scene, header, {
      hunt: VOLT_HUNT,
      kit: voltKit,
      bench,
      measure(q, s, p) {
        const moved = pick(COM_OPTS, p.black, 'gnd') === 'rail5' && VOLT_PROBES[q.probe].ground
        const spot = voltSpot(q.truth, q.probe)
        const r = spotRead(spot, s, moved ? METER_NODE.rail5 : spot.black)
        const [red, black] = VOLT_TIPS[q.probe]
        return { r, miss: dmmMistake('vdc', s, r, { live: true, com: moved }), want: 'vdc', red, black: moved ? 'rail5' : black }
      },
      parts: { flat: 'holder', fuse: 'guard', buck: 'buck', ldo: 'ldo' },
      shorted: 'holder',
      symptom: 'switched on: the ESP32’s power LED stays dark',
      hint: 'Hint: start at the pack, follow the volts toward the ESP32',
      fixes: VOLT_FIX,
      table: { colW: 3.4 },
      extra({ q, found }) {
        bench.setSwitch(true)
        bench.setLed(vr(q.truth, 'rail33').value > 3 ? 1 : 0)
        bench.fuse?.set(0, found && q.truth === 'fuse' ? 1 : 0)
      },
    })
    return { scene, view: FACE_VIEW, ...rig }
  },
}

// --- Current test ---

const ampKit = huntKit(AMP_HUNT, AMP_FAULTS, AMP_PROBES, 61)
type AmpTp = SupplyTp | 'drvOut' | 'motor'
const AMP_TIPS: Record<AmpProbe, [AmpTp, AmpTp]> = {
  idle: ['swIn', 'swOut'],
  run: ['swIn', 'swOut'],
  motor: ['drvOut', 'motor'],
  pack: ['pack', 'gndPack'],
}
const ar = (f: AmpFault | 'ok', p: AmpProbe) => AMP_HUNT.read(f, p)
const AMP_FIX: Record<AmpFault, string> = {
  drag: `Tight gearbox: the motor pulls ${readingText(ar('drag', 'motor'))} where a free one takes ${readingText(ar('ok', 'motor'))}. Free it up or swap the motor`,
  leak: `Leaky 5 V cap: idle is ${readingText(ar('leak', 'idle'))}, not ${readingText(ar('ok', 'idle'))}, while the motor’s own current is normal. Replace the cap`,
  stuck: `Motor never stops: idle already draws the driving current. The driver input floats high: add a pull-down`,
  open: `Open winding: driving draws no more than idle, the motor lead reads 0. Replace the motor`,
}
const START = (() => {
  const r = spotRead(ampSpot('ok', 'run'), { dial: 'ma', jack: 'ma' })
  return { meltS: r.meltS, stallA: spotRead({ ...ampSpot('ok', 'run'), bench: ampSpot('ok', 'run').inrush! }, { dial: 'amp', jack: 'a10' }).amps }
})()
const IDLE_MA = spotRead(ampSpot('ok', 'idle'), { dial: 'ma', jack: 'ma' })
const AMP_SHORT = spotRead(ampSpot('ok', 'pack'), { dial: 'amp', jack: 'a10' }).amps

export const usingAMultimeterCurrentTest: Lesson = {
  id: 'using-a-multimeter-current-test',
  title: 'Current test',
  tagline: 'The pack runs flat in minutes: break the circuit, put the meter in series on the right socket, and don’t feed a motor start through the mA fuse',
  formula: (p) => {
    const q = ampKit.params(p)
    if (q.probe === 'pack') return `Across a source on A: I = V / (R_cells + R_shunt + R_leads) ≈ ${A(AMP_SHORT)}`
    return `Burden = I × R_meter · mA: ${A(IDLE_MA.amps)} × ${si(DMM.ma.ohms + DMM.leadOhms, 'Ω', 2)} = ${si(IDLE_MA.burden, 'V', 2)} lost to the meter`
  },
  legend: METER_LEGEND,
  points: [
    HOWTO,
    'Current is measured in series: open the circuit and let the meter close it, so every electron goes through it. Here the open power switch (switch off, probes across it) or the motor lead pulled off the driver. A meter on amps is a near-short: put across a source it is a short.',
    `Two current sockets: mA (${si(DMM.ma.ohms, 'Ω', 2)} shunt, ${FUSES.F400mA.ratedA * 1000} mA fuse) and 10A (${si(DMM.a10.ohms, 'Ω', 2)}, F10A). A TT motor starting is a stalled motor: ${A(START.stallA)} for ~${si(DMM.startS, 's', 1)}, which melts the F400mA in ${si(START.meltS, 's', 2)} even though it then runs on ${readingText(ar('ok', 'motor'))}. Unknown current: start on 10A (Actuators › DC motor › Stall current).`,
    `Burden: the meter is a small resistor in the loop. On mA the robot’s ${A(IDLE_MA.amps)} idle loses ${si(IDLE_MA.burden, 'V', 2)} across it; harmless here, but on a 3.3 V rail it can be enough to brown an ESP32 out. 10A loses far less but reads only to ~10 mA.`,
    `The classic slip: red still in 10A, then “just check the pack volts”. That’s ${A(AMP_SHORT)} through the leads (F10A melts in ${fuseMeltTime(AMP_SHORT, FUSES.F10A) === Infinity ? 'never: it holds' : si(fuseMeltTime(AMP_SHORT, FUSES.F10A), 's', 2)}). Move the red lead back to VΩ after every current test.`,
    'Current finds what volts can’t: a dragging gearbox (Debug it › Motor does nothing › Stalled gearbox) or an input that floats the driver on (Debug it › Sensor noise › Floating input) both look fine on a voltmeter.',
  ],
  controls: withMeter(ampKit, ['amp', 'a10']),
  build(): Stage {
    const { scene, header } = huntStage()
    const supply = supplyBench(scene, { guard: 'fuse', driver: true })
    // TT motor on the DRV8833's output.
    const MOTOR: V3 = [6.1, 3.8, 0]
    const motor = motorCan(scene, MOTOR, { r: 0.55, legs: 0.35 })
    wire(scene, [[3.8, 2.6, 0], [motor.pins[0][0], 2.6, 0], motor.pins[0]], 0.09)
    const heat = glowHalo(scene, MOTOR, 0.8)
    const bench = { ...supply, tp: { ...supply.tp, drvOut: [3.9, 2.6, 0.3] as V3, motor: [motor.pins[0][0], motor.pins[0][1], 0.3] as V3 } }
    const rig = meterRig<AmpFault, AmpProbe, AmpTp, SupplyPart>(scene, header, {
      hunt: AMP_HUNT,
      kit: ampKit,
      bench,
      measure(q, s) {
        const spot = ampSpot(q.truth, q.probe)
        const r = spotRead(spot, s)
        const [red, black] = AMP_TIPS[q.probe]
        return { r, miss: dmmMistake(spot.want, s, r, { live: true, series: spot.series }), want: spot.want, red, black }
      },
      parts: { drag: 'driver', leak: 'buck', stuck: 'driver', open: 'driver' },
      shorted: 'holder',
      symptom: 'a fresh set of AAs is flat after 20 minutes',
      hint: 'Hint: idle current, then driving, then the motor alone; compare with Healthy',
      fixes: AMP_FIX,
      table: { colW: 3.6 },
      extra({ q, shot, dt }) {
        supply.setSwitch(q.probe === 'motor' || q.probe === 'pack')
        const running = shot.r.volts[METER_NODE.motor] > 1 && q.truth !== 'open'
        supply.setLed(shot.r.volts[METER_NODE.rail33] > 3 ? 1 : 0)
        motor.spin(dt, running ? (q.truth === 'drag' ? 40 : 160) : 0)
        heat.set(running && q.truth === 'drag' ? 0.7 : 0, HEAT)
      },
    })
    return { scene, view: FACE_VIEW, ...rig }
  },
}
