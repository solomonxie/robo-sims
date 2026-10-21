// Crimping a pin: wire gauge vs terminal, strip length vs barrel lengths, die slot and ratchet → how full of copper the
// barrel ends up. That fill sets gas-tightness, contact resistance (heat at a current) and pull-out force vs IEC 60352-2.
import { awgDiameter, wireArea } from '../dc'
import { clamp01 } from '../common'
import { CONNECTORS, ConnectorId, ampacity, connectorPoint } from '../power/wiring'
import { puzzleVerdict } from '../challenges/verdict'

export interface Terminal {
  name: string
  /** Mated contact it belongs to (rating, heat). */
  connector: ConnectorId
  /** Wire it takes, thickest…thinnest AWG. */
  awg: [number, number]
  /** Conductor barrel, transition gap, insulation barrel (mm). */
  condMm: number
  gapMm: number
  insulMm: number
  /** Insulation outer diameter the wings close on (mm). */
  od: [number, number]
}

export const TERMINALS = {
  dupont: { name: 'Dupont female 2.54', connector: 'dupont', awg: [22, 28], condMm: 1.9, gapMm: 0.8, insulMm: 2, od: [0.8, 1.6] },
  jstxh: { name: 'JST-XH (SXH) 2.5', connector: 'jstxh', awg: [22, 28], condMm: 1.8, gapMm: 0.8, insulMm: 1.8, od: [0.8, 1.5] },
  jstph: { name: 'JST-PH (SPH) 2.0', connector: 'jstph', awg: [24, 30], condMm: 1.3, gapMm: 0.6, insulMm: 1.3, od: [0.6, 1] },
} satisfies Record<string, Terminal>
export type TerminalKey = keyof typeof TERMINALS

/** Copper fill of the crimped barrel: a loose 7-strand bundle packs 7/9; gas-tight 0.86–0.95 (dies aim at 0.9); past
 *  0.97 strands neck and cut (all gone 0.08 later). Early ratchet release leaves 6 % more room. Strands stick out
 *  0.3 mm past the barrel (the brush). Thin-wall hook-up insulation 0.25 mm. Annealed copper breaks at 220 MPa; a
 *  good crimp holds 85 % of that. Gas-tight crimp ≈ 0.5 mΩ·mm² / conductor area. */
export const CRIMP = {
  strands: 7,
  looseFill: 7 / 9,
  gasLo: 0.86,
  gasHi: 0.95,
  target: 0.9,
  cutAt: 0.97,
  cutSpan: 0.08,
  earlyRoom: 1.06,
  brushMm: 0.3,
  wallMm: 0.25,
  copperUtsPa: 220e6,
  holdEff: 0.85,
  gasOhmMm2: 5e-4,
  coolC: 65,
}

/** Die slot vs the wire: the matching slot, one slot (2 AWG) bigger or smaller. */
export const DIE_SLOTS = { match: 0, big: -2, small: 2 }
export type DieSlot = keyof typeof DIE_SLOTS

/** Conductor area, mm². */
export const conductorMm2 = (awg: number) => wireArea(awgDiameter(awg)) * 1e6
/** Insulation outer diameter, mm. */
export const wireOdMm = (awg: number) => awgDiameter(awg) * 1e3 + 2 * CRIMP.wallMm
/** The wire's own breaking force, N. */
export const wireBreakN = (awg: number) => CRIMP.copperUtsPa * wireArea(awgDiameter(awg))

/** IEC 60352-2 minimum pull-out force by conductor area (mm², N). */
const PULL_SPEC: [number, number][] = [[0.05, 6], [0.08, 11], [0.12, 15], [0.14, 18], [0.22, 28], [0.25, 32], [0.32, 40], [0.5, 60], [0.75, 85], [1, 108]]

/** Minimum pull-out force for a conductor of `mm2`, linear between table rows. */
export function pullSpecN(mm2: number) {
  const t = PULL_SPEC
  if (mm2 <= t[0][0]) return (t[0][1] * mm2) / t[0][0]
  for (let i = 1; i < t.length; i++)
    if (mm2 <= t[i][0]) {
      const [a, fa] = t[i - 1]
      const [b, fb] = t[i]
      return fa + ((fb - fa) * (mm2 - a)) / (b - a)
    }
  return t[t.length - 1][1]
}

/** Copper fill after the stroke: wire area ÷ the room the closed die leaves (sized for its slot's wire at `target`). */
export const crimpFill = (awg: number, slotAwg: number, fullStroke = true) =>
  (CRIMP.target * conductorMm2(awg)) / conductorMm2(slotAwg) / (fullStroke ? 1 : CRIMP.earlyRoom)

/** Share of strands cut by an over-tight die. */
export const strandsCut = (fill: number) => clamp01((fill - CRIMP.cutAt) / CRIMP.cutSpan)

/** Share of the conductor barrel on bare strands, and of the insulation barrel on insulation, for a strip length. */
export function stripCover(t: Terminal, stripMm: number) {
  const cond = clamp01((stripMm - CRIMP.brushMm) / t.condMm)
  const insul = clamp01((CRIMP.brushMm + t.condMm + t.gapMm + t.insulMm - stripMm) / t.insulMm)
  return { cond, insul }
}

/** Strip-length window: conductor barrel all on strands, insulation ending in the transition gap. */
export const stripWindow = (t: Terminal): [number, number] => [CRIMP.brushMm + t.condMm, CRIMP.brushMm + t.condMm + t.gapMm]

/** Crimp resistance (Ω): gas-tight baseline, ∝ 1 / squeeze below it, ÷ copper left when cut, ÷ barrel share on strands. */
export function crimpOhms(awg: number, fill: number, cond: number) {
  const C = CRIMP
  if (cond <= 0.02 || fill <= C.looseFill) return Infinity
  const gas = C.gasOhmMm2 / conductorMm2(awg)
  const squeeze = Math.min(1, (fill - C.looseFill) / (C.target - C.looseFill))
  return gas / squeeze / Math.max(0.02, 1 - strandsCut(fill)) / cond
}

/** Force that pulls the wire out (or snaps it at the crimp): grip grows with squeeze up to the target, cut strands
 *  weaken it, and only the barrel share on strands grips. */
export function pullOutN(awg: number, fill: number, cond: number) {
  const C = CRIMP
  const squeeze = clamp01((fill - C.looseFill) / (C.target - C.looseFill))
  return C.holdEff * wireBreakN(awg) * squeeze * (1 - strandsCut(fill)) * cond
}

export interface CrimpCfg {
  terminal: TerminalKey
  awg: number
  stripMm: number
  die: DieSlot
  fullStroke: boolean
}

export function crimpRun(c: CrimpCfg) {
  const T: Terminal = TERMINALS[c.terminal]
  const conn = CONNECTORS[T.connector]
  const fill = crimpFill(c.awg, c.awg + DIE_SLOTS[c.die], c.fullStroke)
  const cut = strandsCut(fill)
  const cover = stripCover(T, c.stripMm)
  const ohms = crimpOhms(c.awg, fill, cover.cond)
  const goodOhms = crimpOhms(c.awg, CRIMP.target, 1)
  const holdN = pullOutN(c.awg, fill, cover.cond)
  const specN = pullSpecN(conductorMm2(c.awg))
  const odMm = wireOdMm(c.awg)
  /** Test current: the terminal's rating or what the wire carries at 80 °C, whichever is less. */
  const testA = Math.min(conn.ratedA, ampacity(c.awg, 80))
  const open = !Number.isFinite(ohms)
  const heat = open ? null : connectorPoint(conn, testA, (conn.contactOhms + ohms) / (conn.contactOhms + goodOhms))
  const [thick, thin] = T.awg
  const offBy = Math.max(thick - c.awg, c.awg - thin, 0)
  const verdict = puzzleVerdict([
    { id: 'range', ok: offBy === 0, near: offBy <= 2 },
    { id: 'short', ok: cover.cond >= 1 - 1e-9, near: cover.cond >= 0.75 },
    { id: 'over', ok: fill <= CRIMP.gasHi, near: fill <= CRIMP.cutAt + 0.02 },
    { id: 'pull', ok: holdN >= specN, near: holdN >= 0.8 * specN },
    { id: 'loose', ok: fill >= CRIMP.gasLo, near: fill >= CRIMP.gasLo * 0.92 },
    { id: 'long', ok: cover.insul >= 1 - 1e-9, near: cover.insul >= 0.5 },
    { id: 'insul', ok: odMm >= T.od[0] && odMm <= T.od[1], near: true },
    { id: 'hot', ok: !!heat && heat.tempC <= CRIMP.coolC, near: !!heat && !heat.melts },
  ])
  return { cfg: c, terminal: T, conn, fill, cut, cover, ohms, goodOhms, holdN, specN, breakN: wireBreakN(c.awg), odMm, testA, heat, window: stripWindow(T), verdict }
}
export type CrimpRun = ReturnType<typeof crimpRun>

/** Time-lapse: the die closes, a pause, then a tug ramps to 1.3 × spec; the wire lets go at its pull-out force. */
export const CRIMP_LAPSE = { closeS: 1.5, pauseS: 0.5, tugS: 3, over: 1.3 }
export const CRIMP_LAPSE_S = CRIMP_LAPSE.closeS + CRIMP_LAPSE.pauseS + CRIMP_LAPSE.tugS

export function crimpAt(r: CrimpRun, t: number) {
  const L = CRIMP_LAPSE
  const closed = clamp01(t / L.closeS) * (r.cfg.fullStroke ? 1 : 1 / CRIMP.earlyRoom)
  const u = clamp01((t - L.closeS - L.pauseS) / L.tugS)
  const ramp = u * L.over * r.specN
  const failed = ramp >= r.holdN && u > 0
  const forceN = failed ? 0 : ramp
  /** How far the wire has slid out (mm) once it lets go. */
  const slideMm = failed ? Math.min(3, ((ramp - r.holdN) / (L.over * r.specN)) * 12) : 0
  return { closed, tugging: u > 0, forceN, failed, slideMm }
}
