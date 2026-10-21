// Breadboarding lessons as boards: feed an LED from the rails, wire a motor tidily, and five classic layout mistakes.
// Every outcome is the solved netlist (solveBoard) plus a verdict whose first failing check is the reason.
import { puzzleVerdict } from '../challenges/verdict'
import { TT_MOTOR } from '../actuators/dcmotor'
import { TT_CRUISE_A } from '../power/budget'
import { connectorPoint, ohmsPerMetre } from '../power/wiring'
import { flatMutual } from '../materials/chassis'
import { LEDS, LED_MAX_A } from '../semiconductors'
import { BOARD_CLIP, BREADBOARDS, BoardPart, BoardSolution, CLIP_WORN, USB_MODULE, busOf, parseHole, railColNear, solveBoard } from './breadboard'

/** A 6 cm 22 AWG jumper. */
const JUMPER_OHMS = ohmsPerMetre(22) * 0.06
const wire = (a: string, b: string, ohms = JUMPER_OHMS): BoardPart => ({ kind: 'wire', a, b, ohms })
const usb = (): BoardPart => ({ kind: 'V', a: 'top+1', b: 'top-1', ...USB_MODULE })
/** Short jumpers across the mid-board rail break. */
const railBridges = () => [wire('top+29', 'top+31'), wire('top-29', 'top-31')]
/** Both right-half rail segments joined to the supply. */
const rightLive = (sol: BoardSolution) => sol.live.has('top+:2') && sol.live.has('top-:2')

// --- Rails and rows: feed a resistor + LED on the right half of a split-rail board from the top + rail. ---

export const RAILS_ROWS = {
  board: BREADBOARDS.split,
  ohms: 330,
  led: LEDS.red,
  resistor: ['c40', 'c44'],
  diode: ['e44', 'e45'],
  ground: ['a45', 'top-46'],
  /** Lit enough to see. */
  minA: 0.002,
}
type FeedHalf = 'top' | 'bottom'
export interface RailsRowsCfg {
  /** Column the + jumper lands in. */
  col: number
  /** Rows a–e or f–j. */
  half: FeedHalf
  bridge: boolean
}

export function railsRowsRun(c: RailsRowsCfg) {
  const R = RAILS_ROWS
  const feed = [`top+${railColNear(c.col)}`, `${c.half === 'top' ? 'a' : 'f'}${c.col}`]
  const parts: BoardPart[] = [
    usb(),
    { kind: 'R', a: R.resistor[0], b: R.resistor[1], ohms: R.ohms },
    { kind: 'LED', a: R.diode[0], b: R.diode[1], led: R.led },
    wire(R.ground[0], R.ground[1]),
    wire(feed[0], feed[1]),
    ...(c.bridge ? railBridges() : []),
  ]
  const sol = solveBoard(R.board, parts)
  const supplyA = sol.partA[0]
  const ledA = sol.partA[2]
  const feedBus = busOf(R.board, feed[1])
  const target = busOf(R.board, R.resistor[0])
  const col = parseHole(R.resistor[0]).col
  const verdict = puzzleVerdict([
    { id: 'over', ok: ledA <= LED_MAX_A },
    { id: 'short', ok: supplyA <= BOARD_CLIP.ratedA },
    { id: 'strip', ok: c.col === col, near: Math.abs(c.col - col) <= 2 },
    { id: 'channel', ok: feedBus === target, near: true },
    { id: 'break', ok: rightLive(sol) },
    { id: 'dim', ok: ledA >= R.minA },
  ])
  return { cfg: c, parts, sol, feed, supplyA, ledA, feedBus, target, rightLive: rightLive(sol), verdict }
}

// --- Tidy wiring: a load fed through rails and jumpers; a sensor wire beside its leads. ---

export const TIDY_WIRES = {
  solid22: { name: '22 AWG solid, cut to length', awg: 22 },
  dupont26: { name: '26 AWG Dupont jumpers', awg: 26 },
  dupont28: { name: '28 AWG Dupont jumpers', awg: 28 },
}
export type TidyWire = keyof typeof TIDY_WIRES
/** Running current; stall resistance for the start. MG996R moving under load ~0.9 A, ~2.5 A stalled. */
export const TIDY_LOADS = {
  tt: { name: 'TT motor', runA: TT_CRUISE_A, stallOhms: TT_MOTOR.ohms },
  servo: { name: 'MG996R servo', runA: 0.9, stallOhms: 2 },
}
export type TidyLoad = keyof typeof TIDY_LOADS
/** Motor pair gap, sensor-wire-to-its-ground loop gap and the distance between them (m); conventional colours or not. */
export const TIDY_ROUTES = {
  tidy: { name: 'Flat, short, red/black + colour per signal', pairGap: 0.0025, loopGap: 0.003, sep: 0.03, colours: true },
  messy: { name: 'Tall loops, any colour', pairGap: 0.015, loopGap: 0.04, sep: 0.008, colours: false },
}
export type TidyRoute = keyof typeof TIDY_ROUTES
/** 5 V buck from a 2S pack; PWM edge; share of the jumper run beside the sensor wire; drop and spike limits
 *  (an analog sensor on a 12-bit 3.3 V ADC: 20 mV ≈ 25 counts). */
export const TIDY = { volts: 5, ohms: 0.05, edgeS: 50e-9, besideFrac: 0.5, dropOk: 0.05, dropNear: 0.15, spikeOk: 0.02, spikeNear: 0.08, coolC: 55 }
export const TIDY_HOLES = { plus: ['top+2', 'a27'], minus: ['top-3', 'a28'], load: ['e27', 'e28'] }

export interface TidyCfg {
  lenCm: number
  wire: TidyWire
  load: TidyLoad
  worn: boolean
  route: TidyRoute
}

export function tidyRun(c: TidyCfg) {
  const H = TIDY_HOLES
  const L = TIDY_LOADS[c.load]
  const rt = TIDY_ROUTES[c.route]
  const lenM = c.lenCm / 100
  const jumperOhms = ohmsPerMetre(TIDY_WIRES[c.wire].awg) * lenM
  const wear = c.worn ? CLIP_WORN : 1
  const base: BoardPart[] = [
    { kind: 'V', a: 'top+1', b: 'top-1', volts: TIDY.volts, ohms: TIDY.ohms },
    wire(H.plus[0], H.plus[1], jumperOhms),
    wire(H.minus[0], H.minus[1], jumperOhms),
  ]
  const board = BREADBOARDS.half
  const run = solveBoard(board, [...base, { kind: 'I', a: H.load[0], b: H.load[1], amps: L.runA }], wear)
  const start = solveBoard(board, [...base, { kind: 'R', a: H.load[0], b: H.load[1], ohms: L.stallOhms }], wear)
  const [la, lb] = run.pinV[3]
  const loadV = la - lb
  const dropFrac = 1 - loadV / TIDY.volts
  const startA = start.partA[3]
  const clip = connectorPoint(BOARD_CLIP, run.maxClipA, wear)
  const henries = flatMutual(rt.pairGap, rt.loopGap, rt.sep) * lenM * TIDY.besideFrac
  const spikeV = (henries * L.runA) / TIDY.edgeS
  const pathOhms = (TIDY.volts - loadV) / L.runA
  const verdict = puzzleVerdict([
    { id: 'hot', ok: clip.tempC <= TIDY.coolC, near: !clip.melts },
    { id: 'drop', ok: dropFrac <= TIDY.dropOk, near: dropFrac <= TIDY.dropNear },
    { id: 'noise', ok: spikeV <= TIDY.spikeOk, near: spikeV <= TIDY.spikeNear },
    { id: 'colour', ok: rt.colours, near: true },
  ])
  return { cfg: c, jumperOhms, clipOhms: BOARD_CLIP.contactOhms * wear, pathOhms, loadV, dropFrac, startA, clip, henries, spikeV, verdict }
}

// --- Common mistakes: a 555 on the left, a power LED on the right half of a split-rail board; five placements to get right. ---

export const MISTAKES = {
  board: BREADBOARDS.split,
  ohms: 470,
  led: LEDS.red,
  /** NE555 quiescent draw at 5 V (~5 mA) and its minimum supply. */
  chipOhms: 1000,
  chipMinV: 4.5,
  resistor: ['c40', 'c44'],
  ground: ['a45', 'top-46'],
  minA: 0.002,
}
export interface MistakesCfg {
  /** DIP straddles the channel, or both pin rows sit on one side. */
  straddle: boolean
  /** Bottom − rail linked to the top − rail. */
  linked: boolean
  /** + jumper into the resistor's strip (or the LED's). */
  feedOk: boolean
  /** LED legs in two strips (or both in one). */
  ledOk: boolean
  bridge: boolean
}

/** DIP-8 pin holes, notch left: pins 1–4 along the lower row, 8–5 along the upper, columns 10–13. */
export function chipHoles(straddle: boolean) {
  const [lo, hi] = straddle ? ['f', 'e'] : ['j', 'g']
  return Array.from({ length: 8 }, (_, i) => (i < 4 ? `${lo}${10 + i}` : `${hi}${17 - i}`))
}

export function mistakesRun(c: MistakesCfg) {
  const M = MISTAKES
  const pins = chipHoles(c.straddle)
  const diode = c.ledOk ? ['e44', 'e45'] : ['d44', 'e44']
  const parts: BoardPart[] = [
    usb(),
    { kind: 'R', a: pins[7], b: pins[0], ohms: M.chipOhms },
    { kind: 'R', a: M.resistor[0], b: M.resistor[1], ohms: M.ohms },
    { kind: 'LED', a: diode[0], b: diode[1], led: M.led },
    wire('top+10', c.straddle ? 'a10' : 'f10'),
    wire(c.straddle ? 'j10' : 'i10', 'bottom-10'),
    wire('top+40', c.feedOk ? 'a40' : 'a44'),
    wire(M.ground[0], M.ground[1]),
    ...(c.linked ? [wire('top-2', 'bottom-2')] : []),
    ...(c.bridge ? railBridges() : []),
  ]
  const sol = solveBoard(M.board, parts)
  const supplyA = sol.partA[0]
  const ledA = sol.partA[3]
  const chipV = sol.busV[busOf(M.board, pins[7])] - sol.busV[busOf(M.board, pins[0])]
  const clip = connectorPoint(BOARD_CLIP, sol.maxClipA)
  const railV = sol.busV['top+:1'] - sol.busV['top-:1']
  const verdict = puzzleVerdict([
    { id: 'over', ok: ledA <= LED_MAX_A },
    { id: 'short', ok: supplyA <= BOARD_CLIP.ratedA },
    { id: 'chip', ok: chipV >= M.chipMinV },
    { id: 'rail', ok: rightLive(sol) },
    { id: 'dark', ok: ledA >= M.minA },
  ])
  return { cfg: c, parts, pins, diode, sol, supplyA, ledA, chipV, railV, rightLive: rightLive(sol), clip, verdict }
}
