import {
  DRIVERS,
  DRIVER_PULL_OHMS,
  DRIVE_BOT,
  DRV8833_IN,
  ENABLE_FAULTS,
  ENABLE_HUNT,
  ENABLE_PROBES,
  EnableFault,
  EnableProbe,
  GPIO_VDD,
  GROUND_FAULTS,
  GROUND_HUNT,
  GROUND_PROBES,
  GroundFault,
  GroundProbe,
  LOW_DUTY,
  STALL_FAULTS,
  STALL_HUNT,
  STALL_PROBES,
  StallFault,
  StallProbe,
  TT_MOTOR,
  TT_THERMAL,
  commonGround,
  missingEnable,
  stalledGearbox,
} from '../../core/physics'
import { celsiusText, fixedText, ohms, pct, si, volts } from '../../core/units'
import { HUNT_HOWTO, HUNT_LEGEND, ProbeCase, driverBench, huntKit, huntRig, huntStage } from '../fx'
import { Lesson, Stage } from '../types'

type Bench = ReturnType<typeof driverBench>
type Tp = keyof Bench['tp'] & string
interface Tip {
  red: string
  black: string
}

interface DriveSpec<F extends string, P extends string> extends ProbeCase<F, P, Tip> {
  chip: 'tb6612' | 'drv8833'
  /** Wheel rpm and hum (0…1) with the real fault in, before it's fixed. */
  motion?: (truth: F) => { rpm: number; hum: number }
  /** Show the fault on the bench once it's found (a wire off, a cut jumper). */
  reveal?: (bench: Bench, truth: F, found: boolean) => void
}

const HOT = { 'TT motor': 'motor', TB6612: 'driver' }

/** Shared stage: drive bench, meter on the chosen test points, suspect table, hunt header. */
function driveBuild<F extends string, P extends string>(s: DriveSpec<F, P>, colW: number): Stage {
  const stage = huntStage()
  const bench = driverBench(stage.scene, { chip: s.chip })
  return huntRig<F, P, Tp, string, Tip>(stage, {
    ...s,
    bench,
    hot: HOT,
    table: { colW },
    extra({ q, t, dt, found }) {
      const m = s.motion?.(q.truth) ?? { rpm: 0, hum: 0 }
      bench.spin(dt, m.rpm)
      bench.hum(m.hum, t)
      s.reveal?.(bench, q.truth, found)
    },
  })
}

const A = (a: number) => si(a, 'A', 2)
const R_ON = (chip: 'tb6612' | 'drv8833') => DRIVERS[chip].drop(1)

// --- Missing enable pin ---

const enKit = huntKit(ENABLE_HUNT, ENABLE_FAULTS, ENABLE_PROBES, 41)
const en = (f: EnableFault | 'ok') => missingEnable(f)
const EN_FIX: Record<EnableFault, string> = {
  stby: `STBY floating: the pull-down holds it at 0 V, the chip sleeps, outputs off. Wire STBY to 3.3 V or a HIGH GPIO`,
  pwm: `PWMA undriven: 0 V = short brake all the time. Wire PWMA to the GPIO the code attaches`,
  same: `AIN1 = AIN2 = HIGH is short brake: both motor ends to ground. Write AIN2 LOW for forward`,
  vm: `VM unpowered: logic runs from VCC, the bridge has nothing to switch. Wire pack + to VM`,
}

export const motorDoesNothingMissingEnablePin: Lesson = {
  id: 'motor-does-nothing-missing-enable-pin',
  title: 'Missing enable pin',
  tagline: 'The code says forward at 80 %, the wheel doesn’t twitch: check every pin the driver needs, not just the direction pins',
  formula: () => {
    const r = en('ok').run
    return `V_motor = duty × (VM − I·R_on) = ${pct(DRIVE_BOT.duty)} × (${volts(r.vm)} − ${A(r.amps)} × ${fixedText(R_ON('tb6612'), 1)} Ω) = ${volts(r.term)}`
  },
  legend: HUNT_LEGEND,
  points: [
    HUNT_HOWTO,
    'A TB6612 channel needs four things at once: VM (the motor supply), STBY high (chip awake), PWMA high (drive; it carries the PWM), and AIN1/AIN2 for direction: 10 forward, 01 reverse, 11 short brake. PWMA low brakes too; STBY low switches every output off (Practice › Motor driver puzzles › Truth table challenge).',
    `An unconnected input is not HIGH. The TB6612 has ~${ohms(DRIVER_PULL_OHMS.tb6612)} pull-downs inside, so a forgotten STBY sits at 0 V and the chip stays asleep, no hum, no heat (Microcontrollers › GPIO › Pull-ups).`,
    `A meter on a PWM pin reads its average: ${pct(DRIVE_BOT.duty)} of ${volts(GPIO_VDD)} = ${volts(en('ok').reads.pwma.value)} (Microcontrollers › PWM › Average voltage). 0 V means the pin isn’t driven: a different GPIO in the code than on the wire, or a channel never attached.`,
    'Logic and motor supply are separate pins: VCC from the ESP32’s 3.3 V wakes the logic even with no VM. Measure VM to ground under the board, not at the pack.',
  ],
  controls: enKit.controls,
  build: () =>
    driveBuild<EnableFault, EnableProbe>(
      {
        hunt: ENABLE_HUNT,
        kit: enKit,
        chip: 'tb6612',
        tips: {
          stby: { red: 'STBY', black: 'GND' },
          pwma: { red: 'PWMA', black: 'GND' },
          ain2: { red: 'AIN2', black: 'GND' },
          vm: { red: 'vm', black: 'gndM' },
          term: { red: 'ao1', black: 'ao2' },
        },
        parts: { stby: 'w:STBY', pwm: 'w:PWMA', same: 'esp', vm: 'w:VM' },
        symptom: 'code says forward at 80 %: the wheel doesn’t move, no hum, nothing warm',
        hint: 'Hint: a TB6612 needs VM, STBY, PWMA and the direction pins all right',
        fixes: EN_FIX,
        reveal(bench, truth, found) {
          bench.wire('STBY', found && truth === 'stby' ? 'off' : 'ok')
          bench.wire('VM', found && truth === 'vm' ? 'off' : 'ok')
        },
      },
      3.4,
    ),
}

// --- Common ground missing ---

const gndKit = huntKit(GROUND_HUNT, GROUND_FAULTS, GROUND_PROBES, 53)
const gd = (f: GroundFault | 'ok') => commonGround(f)
const GND_FIX: Record<GroundFault, string> = {
  ground: `No ground wire: IN1 is ${si(gd('ground').inDrv, 'V', 2)} over the driver’s GND, a LOW. Join ESP32 GND to driver GND`,
  gpio34: `GPIO 34 is input-only: it can’t drive, the pull-down holds IN1 at 0 V. Use an output pin (e.g. 25)`,
  jumper: `Broken Dupont wire: 3.3 V at the ESP32 end, 0 V at the driver end. Replace the jumper`,
  lead: `Motor lead out of its terminal: full volts, no current, coil reads OL. Re-seat it, tighten the screw`,
}

export const motorDoesNothingCommonGroundMissing: Lesson = {
  id: 'motor-does-nothing-common-ground-missing',
  title: 'Common ground missing',
  tagline: 'ESP32 on USB, motor on the pack: the pin reads 3.3 V yet the driver sees nothing. Where is your black probe?',
  formula: (p) => {
    const q = gndKit.params(p)
    if (q.guess === q.truth && q.truth === 'ground')
      return `V_IN1 = 3.3 V × R_pd ∥ R_meter / (… + R_iso) = ${si(gd('ground').inDrv, 'V', 2)} < V_IL ${volts(DRV8833_IN.vil)} → LOW, outputs off`
    return `Driver reads IN1 against its own GND: HIGH ≥ ${volts(DRV8833_IN.vih)}, LOW ≤ ${volts(DRV8833_IN.vil)} · healthy ${volts(GPIO_VDD)} → forward, ${volts(gd('ok').reads.term.value)} on the motor`
  },
  legend: HUNT_LEGEND,
  points: [
    HUNT_HOWTO,
    'A voltage is always between two points. 3.3 V on the GPIO means 3.3 V above the ESP32’s ground; the DRV8833 compares IN1 with its own ground. With the ESP32 on a laptop’s USB and the driver on the pack, nothing joins the two grounds (Electricity › Voltage › Ground and reference).',
    `Without that wire the HIGH has no return path: the driver’s ${ohms(DRIVER_PULL_OHMS.drv8833)} pull-down wins against ~${ohms(DRIVE_BOT.isolationOhms)} of isolation, and IN1 sits at ${si(gd('ground').inDrv, 'V', 2)} on the driver’s side. The rule: every board that shares a signal shares a ground (Power › Wiring & gauge › Star ground).`,
    'GPIO 34–39 are input-only: no output driver, so a wire there reads whatever pulls it (Practice › Robo-car › Wire the motor driver).',
    `Walk the signal: GPIO pin, the jumper’s far end against the same ground, then against the driver’s ground; where it changes is the fault. Power off, resistance checks continuity: GND to GND ~${ohms(DRIVE_BOT.jumperOhms)}, the motor ${ohms(TT_MOTOR.ohms)}, OL = open (Electricity › Voltage › Measuring with a multimeter).`,
  ],
  controls: gndKit.controls,
  build: () =>
    driveBuild<GroundFault, GroundProbe>(
      {
        hunt: GROUND_HUNT,
        kit: gndKit,
        chip: 'drv8833',
        tips: {
          gpio: { red: 'gpio', black: 'espGnd' },
          inEsp: { red: 'IN1', black: 'espGnd' },
          inDrv: { red: 'IN1', black: 'gndM' },
          gnds: { red: 'espGnd', black: 'GND' },
          term: { red: 'ao1', black: 'ao2' },
          coil: { red: 'ao1', black: 'ao2' },
        },
        parts: { ground: 'w:GND', gpio34: 'esp', jumper: 'w:IN1', lead: 'w:AO2' },
        symptom: 'ESP32 runs and prints “forward”: the motor does nothing',
        hint: 'Hint: a voltage is between two points; try IN1 against each ground',
        fixes: GND_FIX,
        reveal(bench, truth, found) {
          bench.wire('GND', found && truth === 'ground' ? 'off' : 'ok')
          bench.wire('IN1', found && truth === 'jumper' ? 'cut' : 'ok')
          bench.wire('AO2', found && truth === 'lead' ? 'off' : 'ok')
        },
      },
      3.1,
    ),
}

// --- Stalled gearbox ---

const stKit = huntKit(STALL_HUNT, STALL_FAULTS, STALL_PROBES, 67)
const sg = (f: StallFault | 'ok') => stalledGearbox(f)
const jam = sg('jammed').run
const okRun = sg('ok').run
const ST_FIX: Record<StallFault, string> = {
  jammed: `Locked gearbox: ${A(jam.amps)}, no back-EMF, winding ${celsiusText(jam.motorC)} in ${DRIVE_BOT.heatS} s. Cut power, clear the gears`,
  open: `Open winding: volts across it, ${A(0)} through it, OL with power off. Replace the motor`,
  duty: `ledcWrite(204) on 12 bits is ${pct(LOW_DUTY)}: ${volts(sg('duty').run.term)}, too little to start. Use 8 bits or write ${Math.round(DRIVE_BOT.duty * 4095)}`,
  dead: `Dead output stage: logic fine, 0 V on AO1/AO2. Replace the driver, then find what killed it`,
}

export const motorDoesNothingStalledGearbox: Lesson = {
  id: 'motor-does-nothing-stalled-gearbox',
  title: 'Stalled gearbox',
  tagline: 'The wheel won’t turn and something is warm: measure the current, not just the volts',
  formula: () =>
    `Locked: I = V / R = ${volts(jam.term)} / ${TT_MOTOR.ohms} Ω = ${A(jam.amps)} · turning: I = (V − E) / R = (${volts(okRun.term)} − ${volts(okRun.term - okRun.amps * TT_MOTOR.ohms)}) / ${TT_MOTOR.ohms} Ω = ${A(okRun.amps)}`,
  legend: HUNT_LEGEND,
  points: [
    HUNT_HOWTO,
    `A turning motor makes back-EMF that cancels most of the supply, so it draws ${A(okRun.amps)} here. Locked, there is no back-EMF: I = V / R = ${A(jam.amps)}, ${fixedText(jam.amps / okRun.amps, 1)}× more (Actuators › DC motor › Stall current).`,
    `Stall current is heat: ${si(jam.amps * jam.amps * TT_MOTOR.ohms, 'W', 2)} in a winding the size of a thumb reaches ${celsiusText(jam.motorC)} in ${DRIVE_BOT.heatS} s; the end cap softens near ${celsiusText(TT_THERMAL.maxC)}. The TB6612 is rated ${A(DRIVERS.tb6612.maxA)} per channel; a current limit or a PTC fuse saves both.`,
    'Volts at the terminals alone can’t separate a jam, an open winding and a healthy motor: all read about 6 V. Current can (meter in series), and so can the coil’s resistance with power off: ~5 Ω, OL = open.',
    `Code can stall it too: ledcWrite(204) is ${pct(DRIVE_BOT.duty)} on an 8-bit channel but ${pct(LOW_DUTY)} on a 12-bit one, ${volts(sg('duty').run.term)} average, under what starts the car (Microcontrollers › PWM › Duty cycle).`,
  ],
  controls: stKit.controls,
  build: () =>
    driveBuild<StallFault, StallProbe>(
      {
        hunt: STALL_HUNT,
        kit: stKit,
        chip: 'tb6612',
        tips: {
          term: { red: 'ao1', black: 'ao2' },
          amps: { red: 'ao2', black: 'm2' },
          coil: { red: 'm1', black: 'm2' },
          heat: { red: 'motor', black: 'gndM' },
        },
        parts: { jammed: 'motor', open: 'motor', duty: 'esp', dead: 'driver' },
        symptom: 'code says forward: the wheel stays put, maybe a faint hum',
        hint: 'Hint: the volts look normal in most cases; what does the current say?',
        fixes: ST_FIX,
        motion: (truth) => ({ rpm: 0, hum: truth === 'jammed' ? 1 : truth === 'duty' ? 0.2 : 0 }),
      },
      3.6,
    ),
}
