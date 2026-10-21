import * as THREE from 'three/webgpu'
import {
  BOARD_CLIP,
  CLIP_WORN,
  LED_MAX_A,
  LED_RATED_A,
  MISTAKES,
  MistakesCfg,
  RAILS_ROWS,
  RailsRowsCfg,
  TIDY,
  TIDY_HOLES,
  TIDY_LOADS,
  TIDY_ROUTES,
  TIDY_WIRES,
  TidyCfg,
  TidyLoad,
  TidyRoute,
  TidyWire,
  USB_MODULE,
  mistakesRun,
  motorRpm,
  railsRowsRun,
  tidyRun,
} from '../../core/physics'
import { celsiusText, fixedText, pct, rpmText, si } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { buildTtMotor } from '../../models/motion'
import {
  BUS_LEGEND,
  BENCH_VIEW,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  POWER,
  WIRE_COLORS,
  arcFor,
  breadboardModel,
  label,
  liveLabel,
  memoBy,
  netTints,
  puzzleStage,
  usbModule,
  verdictTint,
  windowGauge,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf, verdictReadout } from '../types'

// --- Shared: the board fills the lower band, tilted toward the camera; up to three gauges in a row above it. ---

const FULL_K = 0.43
const FULL_AT: V3 = [-1.2, -8.4, 0]
const GAUGE_X = [-12.8, -2.8, 7.2]
const gauge = (scene: Parameters<typeof windowGauge>[0], i: number, o: Parameters<typeof windowGauge>[3]) => windowGauge(scene, [GAUGE_X[i], 0.9, 0], 7.6, o)
const A = (a: number) => si(Math.abs(a) < 1e-5 ? 0 : a, 'A', 2)
const ledGlow = (a: number) => Math.min(1, Math.sqrt(Math.max(0, a) / LED_RATED_A))
const ledGauge = (scene: Parameters<typeof windowGauge>[0], i: number) =>
  gauge(scene, i, {
    min: 1e-4,
    max: 3,
    log: true,
    window: [0.005, LED_RATED_A],
    marks: [[LED_MAX_A, 'max', HIGH_V]],
    caption: 'LED current (green: lit, safe)',
    ticks: [[1e-4, '0.1 mA'], [1e-2, '10 mA'], [1, '1 A']],
  })
const supplyGauge = (scene: Parameters<typeof windowGauge>[0], i: number) =>
  gauge(scene, i, {
    min: 1e-3,
    max: 5,
    log: true,
    window: [1e-3, 0.1],
    marks: [[BOARD_CLIP.ratedA, '1 A clip', HIGH_V]],
    caption: 'Supply current',
    ticks: [[1e-3, '1 mA'], [0.1, '0.1 A'], [5, '5 A']],
  })
const setLed = (g: { set: (v: number, t: string, c: string) => void }, a: number) => g.set(Math.max(1e-4, a), A(a), verdictTint(a >= 0.005 && a <= LED_RATED_A, a > 0.002 && a <= LED_MAX_A))
const setSupply = (g: { set: (v: number, t: string, c: string) => void }, a: number) => g.set(Math.max(1e-3, a), A(a), verdictTint(a <= 0.1, a <= BOARD_CLIP.ratedA))
const glowLed = (o: { userData: Record<string, unknown> }, a: number, t: number) => {
  const burning = a > LED_MAX_A
  ;(o.userData.setGlow as (l: number) => void)(burning ? 0.6 + 0.4 * Math.abs(Math.sin(t * 9)) : ledGlow(a))
}

// --- Rails and rows: which holes join, the centre channel, a rail that breaks mid-board. ---

const HALF_OPTS = { top: 'Lands in rows a–e', bottom: 'Lands in rows f–j' }
const BRIDGE_OPTS = { open: 'Rails as they come', bridge: 'Bridge the rail break' }
const rrCfg = (p: Params): RailsRowsCfg => ({ col: n(p, 'col'), half: p.half === 'bottom' ? 'bottom' : 'top', bridge: p.bridge === 'bridge' })
const rrKey = (c: RailsRowsCfg) => `${c.col}|${c.half}|${c.bridge}`
const rrSolve = memoBy(rrKey, railsRowsRun)
type RrRun = ReturnType<typeof railsRowsRun>

function railsWhy(r: RrRun): string {
  const c = r.cfg
  switch (r.verdict.fail) {
    case 'over':
      return `Strip ${c.col} is the LED’s own: the 330 Ω is bypassed and ${A(r.ledA)} burns the LED. Land in the resistor’s column`
    case 'short':
      return `Strip ${c.col} holds the ground jumper: + rail straight into − rail, ${A(r.supplyA)} through clips rated 1 A`
    case 'strip':
      return `The jumper lands in column ${c.col}, the resistor’s leg in column 40: only one column’s five holes join`
    case 'channel':
      return 'Column 40, but rows f–j: the centre channel splits every column, so f40 never meets c40'
    case 'break':
      return 'These rails stop at the middle (see the gap in the red line): columns 31–63 get nothing. Bridge it'
    case 'dim':
      return `Only ${A(r.ledA)} reaches the LED`
    default:
      return `Lit at ${A(r.ledA)}: + rail → a40 → 330 Ω → LED → a45 → − rail, across the bridged break`
  }
}

export const breadboardingRailsAndRows: Lesson = {
  id: 'breadboarding-rails-and-rows',
  title: 'Rails and rows',
  tagline: 'Drop one jumper from the + rail: watch which metal strips join, and light the LED on the far half of a long board',
  formula: (p) => {
    const r = rrSolve(rrCfg(p))
    return `I = (5 V − V_f) / (330 Ω + ${USB_MODULE.ohms} Ω USB + 10 clips × 20 mΩ) = ${A(r.ledA)} · jumper ${r.feed[0]} → ${r.feed[1]} joins strip “${r.feedBus}”`
  },
  legend: BUS_LEGEND,
  points: [
    'Under each column of holes sits one spring-metal clip: a–e share it, f–j share another. Nothing joins along a row, and the centre channel splits every column in two.',
    'The channel is 0.3″ (3 holes) wide, the same as a DIP chip’s row spacing. A chip straddling it gets one strip per pin, with four spare holes beside each pin for wires.',
    'The long strips along each edge are the power rails: red line +, blue line −. Feed them once and every column can reach power with one short jumper.',
    'Many full-length boards split each rail in the middle; the red and blue lines show a gap there. A part on the far half sits on a dead rail until you bridge the gap.',
    'Check what’s joined with a meter’s beeper, probe in two holes (Debug it › Using a multimeter › Continuity test). The LED loop is the usual one: rail → resistor → LED → rail (Components › LED › Current-limiting resistor, Electricity › Kirchhoff’s laws › Nodal analysis).',
  ],
  controls: [
    { kind: 'slider', key: 'col', label: 'Jumper from the + rail, column', min: 1, max: 63, step: 1, initial: 20, format: (v) => `column ${v}` },
    { kind: 'choice', key: 'half', options: opts(HALF_OPTS), initial: 'top' },
    { kind: 'choice', key: 'bridge', options: opts(BRIDGE_OPTS), initial: 'open' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const R = RAILS_ROWS
    const bb = breadboardModel(scene, R.board, FULL_AT, FULL_K)
    const ledG = ledGauge(scene, 1)
    const supG = supplyGauge(scene, 2)
    const joinTag = liveLabel(scene, [-16.5, 0.4, 0.3], { size: 0.3, align: 'left' })
    const railTag = liveLabel(scene, [-16.5, -0.5, 0.3], { size: 0.3, align: 'left' })
    let built = ''
    let led: ReturnType<typeof bb.led> | null = null
    let t = 0
    return {
      scene,
      view: BENCH_VIEW,
      frame(dt, p) {
        t += dt
        const c = rrCfg(p)
        const r = rrSolve(c)
        if (built !== rrKey(c)) {
          built = rrKey(c)
          bb.clear()
          usbModule(bb, 'top+1', 'top-1', [-36.5, 0, -9])
          bb.resistor(R.resistor[0], R.resistor[1], R.ohms)
          led = bb.led(R.diode[0], R.diode[1], R.led.color)
          bb.jumper(R.ground[0], R.ground[1], WIRE_COLORS.minus)
          bb.jumper(r.feed[0], r.feed[1], WIRE_COLORS.plus)
          if (c.bridge) {
            bb.jumper('top+29', 'top+31', WIRE_COLORS.plus)
            bb.jumper('top-29', 'top-31', WIRE_COLORS.minus)
          }
          bb.bars(netTints(R.board, r.parts, r.sol))
        }
        if (led) glowLed(led, r.ledA, t)
        setLed(ledG, r.ledA)
        setSupply(supG, r.supplyA)
        joinTag.set(`${r.feed[1]} joins its strip “${r.feedBus}”${r.feedBus === r.target ? ' = the resistor’s' : ''}`, r.feedBus === r.target ? POWER : LABEL)
        railTag.set(`right-half + rail: ${r.rightLive ? fixedText(r.sol.busV['top+:2'], 2) + ' V' : 'not joined'}`, r.rightLive ? POWER : GREY)
        header.set('light the LED from the top + rail', r.verdict, railsWhy(r), 'Hint: one strip per column per side; the rail lines break at the middle')
      },
      readouts: (p) => {
        const r = rrSolve(rrCfg(p))
        return [
          { label: 'Jumper', value: `${r.feed[0]} → ${r.feed[1]}` },
          { label: 'LED', value: A(r.ledA), tone: toneOf(r.ledA >= 0.005 && r.ledA <= LED_RATED_A, r.ledA > 0.002 && r.ledA <= LED_MAX_A) },
          { label: 'Supply', value: A(r.supplyA), tone: toneOf(r.supplyA <= 0.1, r.supplyA <= BOARD_CLIP.ratedA) },
          verdictReadout(r.verdict),
        ]
      },
    }
  },
}

// --- Tidy wiring: jumper length and gauge, worn clips, the load's current, and loops that pick up motor spikes. ---

const HALF_K = 0.5
const HALF_AT: V3 = [-6.2, -7.6, 0]
const WIRE_NAMES = namesOf(TIDY_WIRES)
const LOAD_NAMES = namesOf(TIDY_LOADS)
const ROUTE_NAMES = namesOf(TIDY_ROUTES)
const CLIP_OPTS = { new: 'New board', worn: `Worn clips (×${CLIP_WORN} R)` }
const twCfg = (p: Params): TidyCfg => ({
  lenCm: n(p, 'len'),
  wire: pick(WIRE_NAMES, p.wire, 'dupont26') as TidyWire,
  load: pick(LOAD_NAMES, p.load, 'tt') as TidyLoad,
  worn: p.clips === 'worn',
  route: pick(ROUTE_NAMES, p.route, 'messy') as TidyRoute,
})
const twKey = (c: TidyCfg) => `${c.lenCm}|${c.wire}|${c.load}|${c.worn}|${c.route}`
const twSolve = memoBy(twKey, tidyRun)
type TwRun = ReturnType<typeof tidyRun>
const mV = (v: number) => si(v, 'V', 2)

function tidyWhy(r: TwRun): string {
  const L = TIDY_LOADS[r.cfg.load]
  switch (r.verdict.fail) {
    case 'hot':
      return `${si(r.clipOhms, 'Ω', 2)} clips at ${A(L.runA)} reach ${celsiusText(r.clip.tempC)}${r.clip.melts ? ': the plastic melts' : ''}. New board, or feed motors off-board`
    case 'drop':
      return `The ${L.name} gets ${fixedText(r.loadV, 2)} V of 5: ${pct(r.dropFrac)} lost in ${si(r.pathOhms, 'Ω', 2)} of jumpers and clips. Shorter, thicker`
    case 'noise':
      return `${mV(r.spikeV)} spikes on the sensor wire at every PWM edge (M = ${si(r.henries, 'H', 2)}). Flat, short, away from motor leads`
    case 'colour':
      return 'It works, but red is a signal and + is blue: the next person (you, next week) will short something'
    default:
      return `${fixedText(r.loadV, 2)} V at the ${L.name}, clips ${celsiusText(r.clip.tempC)}, ${mV(r.spikeV)} pickup: a board you can debug`
  }
}

/** MG996R: black case, white horn on top; `horn` rotates about y. */
function mg996r(parent: THREE.Object3D, at: V3) {
  const g = add(parent, new THREE.Group(), at)
  box(g, [15.7, 14.6, 7.9], mat('#1b1c20', { rough: 0.6 }), [0, 7.3, 0])
  box(g, [21.5, 1, 7.9], mat('#1b1c20', { rough: 0.6 }), [0, 10.5, 0])
  const horn = add(g, new THREE.Group(), [-4, 14.9, 0])
  box(horn, [10, 0.8, 2], mat('#efefef'), [0, 0.4, 0])
  const t = add(g, label('MG996R', { size: 1.6, color: '#d8dbe2' }), [0, 7, 3.97])
  t.castShadow = false
  return { group: g, horn }
}

export const breadboardingTidyWiring: Lesson = {
  id: 'breadboarding-tidy-wiring',
  title: 'Tidy wiring',
  tagline: 'Feed a motor through the board and run a sensor wire past it: set length, gauge, clip wear and routing, and see what sags, heats and hums',
  formula: (p) => {
    const r = twSolve(twCfg(p))
    return `V_load = 5 V − I·(8 clips + 2 jumpers + supply) = 5 − ${A(TIDY_LOADS[r.cfg.load].runA)} × ${si(r.pathOhms, 'Ω', 2)} = ${fixedText(r.loadV, 2)} V · spike = M·dI/dt = ${si(r.henries, 'H', 2)} × ${A(TIDY_LOADS[r.cfg.load].runA)}/${si(TIDY.edgeS, 's', 2)} = ${mV(r.spikeV)}`
  },
  legend: BUS_LEGEND.filter((l) => l.color !== GREY),
  points: [
    'Every jumper end and every lead sits in a spring clip of ~20 mΩ. A motor fed through the board passes eight of them, which already outweighs 20 cm of 26 AWG copper (Electricity › Resistance › Resistivity and wire gauge).',
    'Clips wear: bent by fat leads, oxidised, loose. At 0.5 Ω each they drop volts and run hot, and about 1 A per contact is the practical limit (Power › Wiring & gauge › Connector ratings). Motors and servos want their own wires straight from the supply, not the rails.',
    'A load’s current through thin, long jumpers sags its voltage (Power › Wiring & gauge › Voltage drop). Solid 22 AWG cut to length lies flat and stays short.',
    'Every PWM edge slams the motor current on or off in ~50 ns. A sensor wire and its ground make a loop; the motor lead’s changing field threads it and induces M·dI/dt. Tall loops near motor leads are antennas; flat and apart they barely see it (Signals › Grounding & shielding › Twisted pairs, Electricity › Magnetism › Induction).',
    'Colours are a convention, not physics: red +, black −, one colour per signal. They make the board readable at a glance, and a misplaced wire obvious.',
  ],
  controls: [
    { kind: 'slider', key: 'len', label: 'Jumper length', min: 5, max: 40, step: 1, initial: 30, format: (v) => `${v} cm` },
    { kind: 'choice', key: 'wire', options: opts(WIRE_NAMES), initial: 'dupont26' },
    { kind: 'choice', key: 'load', options: opts(LOAD_NAMES), initial: 'tt' },
    { kind: 'choice', key: 'clips', options: opts(CLIP_OPTS), initial: 'new' },
    { kind: 'choice', key: 'route', options: opts(ROUTE_NAMES), initial: 'messy' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const H = TIDY_HOLES
    const bb = breadboardModel(scene, { name: 'half', columns: 30, railBreak: null }, HALF_AT, HALF_K)
    const vG = windowGauge(scene, [GAUGE_X[0], 0.9, 0], 7.6, {
      min: 3,
      max: 5,
      window: [TIDY.volts * (1 - TIDY.dropOk), 5],
      caption: 'Volts at the load',
      ticks: [[3, '3'], [4, '4'], [5, '5 V']],
    })
    const sG = gauge(scene, 1, {
      min: 1e-4,
      max: 1,
      log: true,
      window: [1e-4, TIDY.spikeOk],
      caption: 'Spike on the sensor wire',
      ticks: [[1e-4, '0.1 mV'], [1e-2, '10 mV'], [1, '1 V']],
    })
    const cG = gauge(scene, 2, {
      min: 20,
      max: 200,
      window: [20, TIDY.coolC],
      marks: [[BOARD_CLIP.maxC, 'melts', HIGH_V]],
      caption: 'Hottest clip',
      ticks: [[25, '25'], [100, '100'], [200, '200 °C']],
    })
    const motor = add(scene, buildTtMotor(), [8.2, -8.8, 1])
    motor.scale.setScalar(0.3)
    motor.rotation.set(0.5, -0.5, 0)
    const hub = add(motor, new THREE.Group(), [-4, 3.7, 8])
    box(hub, [7, 1.4, 0.8], mat('#ff9a4d', { rough: 0.5 }), [0, 0, 0])
    const servo = mg996r(scene, [9.6, -10, 0])
    servo.group.scale.setScalar(0.3)
    servo.group.rotation.set(0.5, -0.4, 0)
    /** A point on `o` (its local coords) in board-local coords. */
    const onBoard = (o: THREE.Object3D, p: V3): V3 => {
      scene.updateMatrixWorld(true)
      const w = o.localToWorld(new THREE.Vector3(...p))
      return bb.group.worldToLocal(w).toArray() as V3
    }
    const spinTag = liveLabel(scene, [9.6, -3.4, 0.3], { size: 0.3 })
    let built = ''
    let spin = 0
    let t = 0
    return {
      scene,
      view: BENCH_VIEW,
      frame(dt, p) {
        t += dt
        const c = twCfg(p)
        const r = twSolve(c)
        const rt = TIDY_ROUTES[c.route]
        if (built !== twKey(c)) {
          built = twKey(c)
          bb.clear()
          buckModule(bb)
          const col = rt.colours ? { plus: WIRE_COLORS.plus, minus: WIRE_COLORS.minus, sig: WIRE_COLORS.signal } : { plus: WIRE_COLORS.blue, minus: WIRE_COLORS.white, sig: WIRE_COLORS.plus }
          const L = c.lenCm / 0.254
          const span = 25
          if (c.route === 'tidy') {
            bb.wireFlat(H.plus[0], H.plus[1], col.plus, arcFor(L, span, 7) * 0.4)
            bb.wireFlat(H.minus[0], H.minus[1], col.minus, arcFor(L, span, 7) * 0.4 - 0.8)
            bb.wireFlat('j4', 'j25', col.sig, -arcFor(L, 21, 4) * 0.4)
          } else {
            bb.jumper(H.plus[0], H.plus[1], col.plus, arcFor(L, span))
            bb.jumper(H.minus[0], H.minus[1], col.minus, arcFor(L, span) * 0.7)
            bb.jumper('c4', 'c25', col.sig, arcFor(L, 21) * 0.9)
          }
          const tt = c.load === 'tt'
          motor.visible = tt
          hub.visible = tt
          servo.group.visible = !tt
          bb.lead(tt ? onBoard(motor, [21, 3, 3]) : onBoard(servo.group, [-8, 4, 3.9]), H.load[0], WIRE_COLORS.plus)
          bb.lead(tt ? onBoard(motor, [21, 3, -3]) : onBoard(servo.group, [-8, 3, 3.9]), H.load[1], WIRE_COLORS.minus)
        }
        const hot = r.clip.tempC > TIDY.coolC
        const tint = hot ? HEAT : null
        bb.bars(
          { 'top+:1': tint ?? HIGH_V, top27: tint ?? HIGH_V, 'top-:1': tint ?? LOW_V, top28: tint ?? LOW_V },
          hot ? 0.5 + 0.4 * Math.abs(Math.sin(t * 5)) : 0.6,
        )
        const rpm = c.load === 'tt' ? motorRpm(r.loadV) : 0
        spin += dt * (c.load === 'tt' ? (rpm / 60) * 2 * Math.PI : 2.5 * (r.loadV / 5))
        hub.rotation.z = spin
        servo.horn.rotation.y = 0.9 * Math.sin(spin)
        spinTag.set(c.load === 'tt' ? `TT output ${rpmText(rpm)}` : 'MG996R sweeping', LABEL)
        vG.set(Math.max(3, r.loadV), `${fixedText(r.loadV, 2)} V`, verdictTint(r.dropFrac <= TIDY.dropOk, r.dropFrac <= TIDY.dropNear))
        sG.set(Math.max(1e-4, r.spikeV), mV(r.spikeV), verdictTint(r.spikeV <= TIDY.spikeOk, r.spikeV <= TIDY.spikeNear))
        cG.set(Math.min(200, r.clip.tempC), celsiusText(r.clip.tempC), verdictTint(!hot, !r.clip.melts))
        header.set('5 V at the load, a quiet sensor wire, cool clips', r.verdict, tidyWhy(r), 'Hint: motors off the rails, wires flat and short, + red, − black')
      },
      readouts: (p) => {
        const r = twSolve(twCfg(p))
        return [
          { label: 'At the load', value: `${fixedText(r.loadV, 2)} V`, tone: toneOf(r.dropFrac <= TIDY.dropOk, r.dropFrac <= TIDY.dropNear) },
          { label: 'Spike', value: mV(r.spikeV), tone: toneOf(r.spikeV <= TIDY.spikeOk, r.spikeV <= TIDY.spikeNear) },
          { label: 'Hottest clip', value: celsiusText(r.clip.tempC), tone: toneOf(r.clip.tempC <= TIDY.coolC, !r.clip.melts) },
          verdictReadout(r.verdict),
        ]
      },
    }
  },
}

/** 5 V buck module feeding the rails at the left end. */
const buckModule = (bb: ReturnType<typeof breadboardModel>) => usbModule(bb, 'top+1', 'top-1', [-19.6, 0, -9], '5V BUCK')

// --- Common mistakes: five placements on one build; the first one wrong is the reason. ---

const YES_NO = (yes: string, no: string) => ({ yes, no })
const CHIP_OPTS = YES_NO('555 straddles the channel', '555 on one side’s strips')
const GND_OPTS = YES_NO('Bottom − rail linked to top −', 'Bottom − rail on its own')
const FEED_OPTS = YES_NO('+ jumper into the resistor’s strip', '+ jumper into the LED’s strip')
const LED_OPTS = YES_NO('LED legs in two strips', 'LED legs in one strip')
const RAIL_OPTS = YES_NO('Rail break bridged', 'Rail break left open')
const cmCfg = (p: Params): MistakesCfg => ({
  straddle: p.chip !== 'no',
  linked: p.gnd !== 'no',
  feedOk: p.feed !== 'no',
  ledOk: p.led !== 'no',
  bridge: p.rail !== 'no',
})
const cmKey = (c: MistakesCfg) => `${c.straddle}|${c.linked}|${c.feedOk}|${c.ledOk}|${c.bridge}`
const cmSolve = memoBy(cmKey, mistakesRun)
type CmRun = ReturnType<typeof mistakesRun>

function mistakesWhy(r: CmRun): string {
  const c = r.cfg
  switch (r.verdict.fail) {
    case 'over':
      return `The + jumper feeds the LED’s strip, skipping the 470 Ω: ${A(r.ledA)} through a 30 mA LED. It dies`
    case 'short':
      return `Pins 1 and 8 share strip 10: + shorted to −, ${A(r.supplyA)} through 1 A clips, rail down to ${fixedText(r.railV, 2)} V`
    case 'chip':
      return c.straddle
        ? `The 555’s ground goes to the bottom − rail, which joins nothing: it sees ${fixedText(r.chipV, 2)} V, needs 4.5`
        : `Pins 1 and 8 sit in one strip: the 555 sees ${fixedText(r.chipV, 2)} V. Straddle the channel`
    case 'rail':
      return 'The LED is past the rail break: right-half rails are dead. Bridge + and − across the gap'
    case 'dark':
      return 'Both LED legs in strip 44: the strip shorts it, no current through the die. Turn it across two strips'
    default:
      return `555 at ${fixedText(r.chipV, 2)} V, LED at ${A(r.ledA)}, ${A(r.supplyA)} from USB: it all works`
  }
}

export const breadboardingCommonMistakes: Lesson = {
  id: 'breadboarding-common-mistakes',
  title: 'Common mistakes',
  tagline: 'A 555 and a power LED on a long board: five placements, each a classic way to lose an evening. Find the ones that are wrong',
  formula: (p) => {
    const r = cmSolve(cmCfg(p))
    return `Supply ${A(r.supplyA)} · 555 V_cc − GND = ${fixedText(r.chipV, 2)} V (min 4.5) · LED ${A(r.ledA)} (max ${A(LED_MAX_A)}) · hottest clip ${celsiusText(r.clip.tempC)}`
  },
  legend: BUS_LEGEND,
  points: [
    'A DIP chip must straddle the channel. Put both pin rows on one side and each pin shares a strip with the pin opposite: on a 555 that joins pin 8 (V_cc) to pin 1 (GND), a dead short (Circuit challenges › Timing puzzles › Blink at 1 Hz).',
    'A part with both legs in one strip is bypassed by the metal: an LED stays dark, a resistor might as well not be there. A resistor that’s skipped lets the LED take whatever the supply gives (Circuit challenges › LED puzzles › Safe LED current).',
    'Top and bottom rails are separate: if a chip’s ground lands on the bottom − rail, link it to the top one. Same for long boards whose rails break in the middle.',
    'Off by one row or column is the commonest mistake of all. Count from the printed numbers, and confirm with the meter’s beeper (Debug it › Using a multimeter › Continuity test).',
    'Some modules don’t fit at all: an ESP32 DevKit’s pin rows are 1″ (10 holes) apart, so on one board it covers every hole on one side and leaves one free on the other. Use two boards side by side, rails peeled off between them.',
  ],
  controls: [
    { kind: 'choice', key: 'chip', options: opts(CHIP_OPTS), initial: 'yes' },
    { kind: 'choice', key: 'gnd', options: opts(GND_OPTS), initial: 'no' },
    { kind: 'choice', key: 'feed', options: opts(FEED_OPTS), initial: 'yes' },
    { kind: 'choice', key: 'led', options: opts(LED_OPTS), initial: 'no' },
    { kind: 'choice', key: 'rail', options: opts(RAIL_OPTS), initial: 'yes' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const M = MISTAKES
    const bb = breadboardModel(scene, M.board, FULL_AT, FULL_K)
    const chipG = gauge(scene, 0, {
      min: 0,
      max: 5.5,
      window: [M.chipMinV, 5.5],
      caption: '555 supply (pin 8 − pin 1)',
      ticks: [[0, '0'], [2.5, '2.5'], [5, '5 V']],
    })
    const ledG = ledGauge(scene, 1)
    const supG = supplyGauge(scene, 2)
    let built = ''
    let led: ReturnType<typeof bb.led> | null = null
    let chip: ReturnType<typeof bb.dip> | null = null
    let t = 0
    return {
      scene,
      view: BENCH_VIEW,
      frame(dt, p) {
        t += dt
        const c = cmCfg(p)
        const r = cmSolve(c)
        if (built !== cmKey(c)) {
          built = cmKey(c)
          bb.clear()
          usbModule(bb, 'top+1', 'top-1', [-36.5, 0, -9])
          chip = bb.dip(r.pins, 'NE555')
          bb.resistor(M.resistor[0], M.resistor[1], M.ohms)
          led = bb.led(r.diode[0], r.diode[1], M.led.color)
          bb.jumper('top+10', c.straddle ? 'a10' : 'f10', WIRE_COLORS.plus)
          bb.jumper(c.straddle ? 'j10' : 'i10', 'bottom-10', WIRE_COLORS.minus)
          bb.jumper('top+40', c.feedOk ? 'a40' : 'a44', WIRE_COLORS.plus)
          bb.jumper(M.ground[0], M.ground[1], WIRE_COLORS.minus)
          if (c.linked) bb.jumper('top-2', 'bottom-2', WIRE_COLORS.minus, 2)
          if (c.bridge) {
            bb.jumper('top+29', 'top+31', WIRE_COLORS.plus)
            bb.jumper('top-29', 'top-31', WIRE_COLORS.minus)
          }
        }
        const tints = netTints(M.board, r.parts, r.sol)
        const hot = Object.values(tints).includes(HEAT)
        bb.bars(tints, hot ? 0.5 + 0.4 * Math.abs(Math.sin(t * 6)) : 0.6)
        if (led) glowLed(led, r.ledA, t)
        chip?.glow(r.chipV >= M.chipMinV ? 1 : 0)
        chipG.set(Math.max(0, r.chipV), `${fixedText(r.chipV, 2)} V`, verdictTint(r.chipV >= M.chipMinV, r.chipV >= M.chipMinV * 0.8))
        setLed(ledG, r.ledA)
        setSupply(supG, r.supplyA)
        header.set('the 555 powered and the LED lit, nothing hot', r.verdict, mistakesWhy(r), 'Hint: chips straddle, legs in two strips, rails linked and bridged')
      },
      readouts: (p) => {
        const r = cmSolve(cmCfg(p))
        return [
          { label: '555 supply', value: `${fixedText(r.chipV, 2)} V`, tone: toneOf(r.chipV >= M.chipMinV, r.chipV >= M.chipMinV * 0.8) },
          { label: 'LED', value: A(r.ledA), tone: toneOf(r.ledA >= 0.005 && r.ledA <= LED_RATED_A, r.ledA > 0.002 && r.ledA <= LED_MAX_A) },
          { label: 'Supply', value: A(r.supplyA), tone: toneOf(r.supplyA <= 0.1, r.supplyA <= BOARD_CLIP.ratedA) },
          verdictReadout(r.verdict),
        ]
      },
    }
  },
}
