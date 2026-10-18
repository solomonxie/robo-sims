// G-code: parse a line into words, run a short program on a Marlin-like bed slinger (moves, modes, heaters, fan, waits, homing).
import { clamp } from '../common'
import { P3 } from '../room'
import { LINE_W, filamentArea } from './fdm'
import { MACHINE, homingAt, homingPlan, softClip } from './motion'

interface GWord { letter: string; value: number }
interface GLine { raw: string; code: string | null; words: GWord[]; comment: string }

export function parseGcode(raw: string): GLine {
  const cut = raw.indexOf(';')
  const comment = cut < 0 ? '' : raw.slice(cut + 1).trim()
  const body = (cut < 0 ? raw : raw.slice(0, cut)).trim().toUpperCase()
  const words: GWord[] = []
  let code: string | null = null
  for (const m of body.matchAll(/([A-Z])\s*([-+]?\d*\.?\d+)?/g)) {
    const value = m[2] === undefined ? NaN : Number(m[2])
    if (code === null && (m[1] === 'G' || m[1] === 'M')) code = `${m[1]}${value}`
    else words.push({ letter: m[1], value })
  }
  return { raw, code, words, comment }
}

const wordOf = (g: GLine, letter: string) => g.words.find((w) => w.letter === letter)?.value

const GCODE_NAMES: Record<string, string> = {
  G0: 'travel move',
  G1: 'straight move, may extrude',
  G4: 'dwell (pause)',
  G28: 'home the axes',
  G90: 'absolute positions (E too)',
  G91: 'relative positions (E too)',
  G92: 'set the position counter',
  M82: 'absolute E',
  M83: 'relative E',
  M84: 'motors off',
  M104: 'nozzle target, no wait',
  M109: 'nozzle target, wait',
  M140: 'bed target, no wait',
  M190: 'bed target, wait',
  M106: 'part fan on',
  M107: 'part fan off',
}

const num = (v: number) => `${Math.round(v * 100) / 100}`.replace('-', '−')

/** What each word of a line means, given the modes in force (G90/G91, M82/M83). */
export function explainGcode(g: GLine, absXYZ = true, absE = false): string[] {
  if (!g.code) return [g.comment ? `comment: ${g.comment}` : '']
  const out = [`${g.code} = ${GCODE_NAMES[g.code] ?? 'unknown: ignored'}`]
  const temp = /^M(104|109|140|190)$/.test(g.code)
  for (const w of g.words) {
    const v = w.value
    const tag = `${w.letter}${num(v)}`
    if ('XYZ'.includes(w.letter)) out.push(g.code === 'G92' ? `${tag} = call this ${w.letter} ${num(v)}` : `${tag} = ${absXYZ ? `go to ${w.letter} ${num(v)} mm` : `move ${w.letter} by ${num(v)} mm`}`)
    else if (w.letter === 'E') out.push(g.code === 'G92' ? `${tag} = reset the E counter` : absE ? `${tag} = E counter to ${num(v)} mm` : `${tag} = push ${num(v)} mm of filament`)
    else if (w.letter === 'F') out.push(`${tag} = ${num(v)} mm/min = ${num(v / 60)} mm/s`)
    else if (w.letter === 'S' && temp) out.push(`${tag} = ${num(v)} °C${v === 0 ? ' (off)' : ''}`)
    else if (w.letter === 'S' && g.code === 'M106') out.push(`${tag} = ${Math.round((clamp(v, 0, 255) / 255) * 100)} % of 255`)
    else if (w.letter === 'S' && g.code === 'G4') out.push(`${tag} = wait ${num(v)} s`)
    else if (w.letter === 'P' && g.code === 'G4') out.push(`${tag} = wait ${num(v)} ms`)
    else out.push(`${tag} = ignored here`)
  }
  return out
}

/** Positioning modes in force when line `i` runs (Marlin: G90/G91 switch E too, M82/M83 only E). */
export function modesBefore(lines: readonly GLine[], i: number) {
  const m = { absXYZ: true, absE: true }
  for (let k = 0; k < Math.min(i, lines.length); k++) {
    const c = lines[k].code
    if (c === 'G90' || c === 'G91') m.absXYZ = m.absE = c === 'G90'
    if (c === 'M82' || c === 'M83') m.absE = c === 'M82'
  }
  return m
}

/** Heater models, typical 40 W hotend and 220 mm 24 V bed: full power heads for `max` with time constant `tau`; off, cools with `cool`. */
export const GCODE_HEAT = {
  ambient: 25,
  nozzle: { max: 400, tau: 60, cool: 90 },
  bed: { max: 115, tau: 150, cool: 600 },
  coldMin: 170,
  waitBand: 1,
  oozeMm: 2,
  startF: 3000,
}

export const extrudeMm = (len: number, h: number, w = LINE_W) => (len * w * h) / filamentArea()

type GMoveKind = 'travel' | 'extrude' | 'home'
interface GMove { line: number; t0: number; t1: number; a: P3; b: P3; kind: GMoveKind; e: number; laid: number; cold: boolean; drag: boolean; clipped: boolean }
interface GSample { t: number; nozzle: number; bed: number; fan: number; line: number }
interface GEvent { line: number; t: number; text: string; bad: boolean }
interface GState { absXYZ: boolean; absE: boolean; f: number; nozzleSet: number; bedSet: number; fan: number; homed: boolean; motors: boolean; eCount: number; deficit: number }
export interface GRun { lines: GLine[]; moves: GMove[]; samples: GSample[]; events: GEvent[]; lineT: number[]; total: number; dt: number; final: GState; firstLay: { t: number; nozzle: number } | null; laid: number }

const HOME = homingPlan('micro', 5)

const heatStep = (T: number, set: number, h: { max: number; tau: number; cool: number }, dt: number) => {
  const amb = GCODE_HEAT.ambient
  if (set > amb && T < set) return Math.min(set, h.max - (h.max - T) * Math.exp(-dt / h.tau))
  if (set > amb && T >= set && T - set < 0.5) return set
  return Math.max(set > amb ? set : amb, amb + (T - amb) * Math.exp(-dt / h.cool))
}

/** Runs `src` from `at` (actual mm). Unhomed, the firmware thinks it starts at 0, 0, 0, so every move lands offset by `at`
 *  until G28. Lines that take no time are held `linePause` s so they can be seen. Moves take distance / feedrate (no acceleration); M109/M190 block until within `waitBand`; E below `coldMin` is refused. */
export function runGcode(src: readonly string[], opts: { at?: P3; homed?: boolean; tail?: number; dt?: number; layerH?: number; linePause?: number; preheat?: [number, number] } = {}): GRun {
  const dt = opts.dt ?? 0.1
  const lines = src.map(parseGcode)
  const at: P3 = opts.at ?? [MACHINE.x / 2, MACHINE.y / 2, 10]
  const homed = opts.homed ?? true
  const H = GCODE_HEAT
  const s: GState = { absXYZ: true, absE: true, f: H.startF, nozzleSet: 0, bedSet: 0, fan: 0, homed, motors: true, eCount: 0, deficit: 0 }
  let off: P3 = homed ? [0, 0, 0] : [...at]
  let cmd: P3 = homed ? [...at] : [0, 0, 0]
  let pos: P3 = [...at]
  const [T0, B0] = opts.preheat ?? [H.ambient, H.ambient]
  if (opts.preheat) [s.nozzleSet, s.bedSet] = opts.preheat
  let T = T0
  let B = B0
  let t = 0
  let line = -1
  const samples: GSample[] = []
  const moves: GMove[] = []
  const events: GEvent[] = []
  const lineT: number[] = []
  let topZ = -1
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
  let firstLay: GRun['firstLay'] = null
  let laidTotal = 0
  const note = (text: string, bad = false) => events.push({ line, t, text, bad })
  const advance = (sec: number) => {
    const n = Math.max(0, Math.round(sec / dt))
    for (let i = 0; i < n; i++) {
      T = heatStep(T, s.nozzleSet, H.nozzle, dt)
      B = heatStep(B, s.bedSet, H.bed, dt)
      t += dt
      samples.push({ t, nozzle: T, bed: B, fan: s.fan, line })
    }
    return n * dt
  }
  samples.push({ t: 0, nozzle: T, bed: B, fan: 0, line: 0 })
  const waitFor = (which: 'nozzle' | 'bed', set: number) => {
    let guard = 0
    const cur = () => (which === 'nozzle' ? T : B)
    while ((set > H.ambient ? cur() < set - H.waitBand : cur() > H.ambient + 15) && guard++ < 12000) advance(dt)
  }
  for (let i = 0; i < lines.length; i++) {
    line = i
    lineT.push(t)
    const g = lines[i]
    const S = wordOf(g, 'S')
    const P = wordOf(g, 'P')
    switch (g.code) {
      case null:
        break
      case 'G90':
        s.absXYZ = s.absE = true
        break
      case 'G91':
        s.absXYZ = s.absE = false
        break
      case 'M82':
        s.absE = true
        break
      case 'M83':
        s.absE = false
        break
      case 'G92': {
        const e = wordOf(g, 'E')
        if (e !== undefined) s.eCount = e
        break
      }
      case 'M104':
      case 'M109':
        s.nozzleSet = S ?? 0
        if (g.code === 'M109') waitFor('nozzle', s.nozzleSet)
        if (g.code === 'M109' && s.nozzleSet > H.coldMin) s.deficit = Math.max(s.deficit, H.oozeMm)
        break
      case 'M140':
      case 'M190':
        s.bedSet = S ?? 0
        if (g.code === 'M190') waitFor('bed', s.bedSet)
        break
      case 'M106':
        s.fan = clamp(S ?? 255, 0, 255) / 255
        break
      case 'M107':
        s.fan = 0
        break
      case 'M84':
        s.motors = false
        break
      case 'G4':
        advance(S ?? (P ?? 0) / 1000)
        break
      case 'G28': {
        const t0 = t
        advance(HOME.total)
        const end = homingAt(HOME, HOME.total).pos
        moves.push({ line: i, t0, t1: t, a: [...pos], b: [end.x, end.y, end.z], kind: 'home', e: 0, laid: 0, cold: false, drag: false, clipped: false })
        pos = [end.x, end.y, end.z]
        cmd = [0, 0, 0]
        off = [0, 0, 0]
        s.homed = s.motors = true
        break
      }
      case 'G0':
      case 'G1': {
        s.motors = true
        const F = wordOf(g, 'F')
        if (F !== undefined && F > 0) s.f = F
        const next: P3 = [...cmd]
        ;(['X', 'Y', 'Z'] as const).forEach((L, k) => {
          const v = wordOf(g, L)
          if (v !== undefined) next[k] = s.absXYZ ? v : cmd[k] + v
        })
        const eW = wordOf(g, 'E')
        const de = eW === undefined ? 0 : s.absE ? eW - s.eCount : eW
        if (eW !== undefined) s.eCount = s.absE ? eW : s.eCount + eW
        let clipped = false
        const want: P3 = [next[0] + off[0], next[1] + off[1], next[2] + off[2]]
        const real = want.map((v, k) => softClip((['x', 'y', 'z'] as const)[k], v)) as P3
        if (real.some((v, k) => Math.abs(v - want[k]) > 1e-6)) {
          clipped = true
          note(s.homed ? 'soft limit: move clipped at the bed edge' : 'not homed: carriage runs into the frame', true)
        }
        cmd = next
        const len = Math.hypot(real[0] - pos[0], real[1] - pos[1], real[2] - pos[2])
        const cold = de > 0 && T < H.coldMin
        if (cold) note(`cold extrusion prevented: nozzle ${Math.round(T)} °C`, true)
        let laid = 0
        if (de > 0 && !cold) {
          laid = Math.max(0, de - s.deficit)
          s.deficit = Math.max(0, s.deficit - de)
        } else if (de < 0) s.deficit += -de
        const xyMove = Math.hypot(real[0] - pos[0], real[1] - pos[1]) > 1e-6
        const leaves = (p: P3) => p[0] < box.x0 - 1 || p[0] > box.x1 + 1 || p[1] < box.y0 - 1 || p[1] > box.y1 + 1
        const drag = laid <= 0 && xyMove && topZ >= 0 && box.x1 - box.x0 > 2 && box.y1 - box.y0 > 2 && Math.min(pos[2], real[2]) <= topZ + 0.15 && leaves(real) && !leaves(pos)
        if (drag) note('nozzle drags across the part', true)
        const dur = Math.max(len, Math.abs(de)) / (s.f / 60)
        const t0 = t
        if (laid > 0 && !firstLay) firstLay = { t: t0, nozzle: T }
        if (laid > 0 && s.fan > 0 && real[2] <= (opts.layerH ?? 0.3) + 0.05) note('fan on for the first layer: weak bed grip', true)
        advance(dur)
        moves.push({ line: i, t0, t1: t, a: [...pos], b: [...real], kind: laid > 0 ? 'extrude' : 'travel', e: de, laid, cold, drag, clipped })
        if (laid > 0) {
          laidTotal += laid
          topZ = Math.max(topZ, real[2])
          box.x0 = Math.min(box.x0, pos[0], real[0])
          box.x1 = Math.max(box.x1, pos[0], real[0])
          box.y0 = Math.min(box.y0, pos[1], real[1])
          box.y1 = Math.max(box.y1, pos[1], real[1])
        }
        pos = real
        break
      }
      default:
        note(`${g.code} not understood: skipped`)
    }
    if (t === lineT[i]) advance(opts.linePause ?? 0)
  }
  line = lines.length - 1
  advance(opts.tail ?? 0)
  return { lines, moves, samples, events, lineT, total: t, dt, final: s, firstLay, laid: laidTotal }
}

/** State at time `t`: actual nozzle position, temperatures, fan, the line being run and the move under way. */
export function gcodeAt(run: GRun, t: number) {
  const tt = clamp(t, 0, run.total)
  const smp = run.samples[Math.min(run.samples.length - 1, Math.round(tt / run.dt))]
  let move: GMove | null = null
  let k = -1
  for (let i = 0; i < run.moves.length; i++) {
    if (run.moves[i].t0 > tt) break
    k = i
  }
  if (k >= 0) move = run.moves[k]
  let pos: P3 = run.moves.length ? [...run.moves[0].a] : [0, 0, 0]
  let u = 1
  if (move) {
    u = move.t1 > move.t0 ? clamp((tt - move.t0) / (move.t1 - move.t0), 0, 1) : 1
    if (move.kind === 'home') {
      const h = homingAt(HOME, u * HOME.total).pos
      pos = [h.x, h.y, h.z]
    } else pos = move.a.map((a, j) => a + (move!.b[j] - a) * u) as P3
    if (u >= 1) move = tt <= move.t1 + 1e-9 ? move : null
  }
  let line = 0
  for (let i = 0; i < run.lineT.length; i++) if (run.lineT[i] <= tt + 1e-9) line = i
  return { pos, nozzle: smp.nozzle, bed: smp.bed, fan: smp.fan, line, move, u, moveIndex: k }
}

/** A listing: the G-code run, and display rows that may fold several source lines (`from`…`to`) into one. */
export interface GProgram { src: string[]; rows: { text: string; from: number; to: number }[] }
type Item = string | [string, string[]]
function gProgram(items: readonly Item[]): GProgram {
  const src: string[] = []
  const rows: GProgram['rows'] = []
  for (const it of items) {
    const [text, ls] = typeof it === 'string' ? [it, [it]] : it
    rows.push({ text, from: src.length, to: src.length + ls.length - 1 })
    src.push(...ls)
  }
  return { src, rows }
}
export const rowOf = (p: GProgram, line: number) => Math.max(0, p.rows.findIndex((r) => line >= r.from && line <= r.to))

const f2 = (v: number) => `${Math.round(v * 100) / 100}`
/** One square layer, corners (x0, y0)…(x1, y1) at height z: four G1 lines, relative E. */
function squareLayer(x0: number, y0: number, x1: number, y1: number, z: number, h: number, f?: number) {
  const e = (len: number) => f2(extrudeMm(len, h))
  const w = x1 - x0
  const d = y1 - y0
  return [`G1 X${x1} E${e(w)}${f ? ` F${f}` : ''}`, `G1 Y${y1} E${e(d)}`, `G1 X${x0} E${e(w)}`, `G1 Y${y0} E${e(d)}`]
}

/** G0, G1 moves: an 80 mm square at 0.3 mm, written correctly or with a classic mistake. */
export const MOVE_PROGRAMS = {
  abs: 'Absolute: G90 + M83',
  rel: 'Relative: G91',
  mixed: 'Mistake: G91, absolute numbers',
  mms: 'Mistake: F typed in mm/s',
  absE: 'Mistake: running-total E in M83',
}
export type MoveProgram = keyof typeof MOVE_PROGRAMS
export const SQUARE = { x0: 70, x1: 150, h: 0.3, start: [110, 110, 10] as P3 }
export function moveProgram(kind: MoveProgram, fMmMin: number): GProgram {
  const { x0, x1, h } = SQUARE
  const L = x1 - x0
  const e = f2(extrudeMm(L, h))
  const F = kind === 'mms' ? Math.round(fMmMin / 60) : fMmMin
  if (kind === 'rel')
    return gProgram(['G91 ; relative moves', 'G0 X-40 Y-40 Z-9.7 F6000', `G1 X${L} E${e} F${F}`, `G1 Y${L} E${e}`, `G1 X-${L} E${e}`, `G1 Y-${L} E${e}`, 'G0 Z10 ; lift'])
  const sq = kind === 'absE' ? [1, 2, 3, 4].map((k, i) => squareLayer(x0, x0, x1, x1, h, h, F)[i].replace(/E[\d.]+/, `E${f2(k * extrudeMm(L, h))}`)) : squareLayer(x0, x0, x1, x1, h, h, F)
  return gProgram([kind === 'mixed' ? 'G91 ; relative moves' : 'G90 ; absolute X Y Z', 'M83 ; relative E', `G0 X${x0} Y${x0} Z${h} F6000`, ...sq, `G0 Z${kind === 'mixed' ? 10 : 10 + h} ; lift`])
}

/** Temperatures and fans: heat the bed and nozzle (one after the other, together, or without waiting), purge, two layers; fan from layer 2. */
export const HEAT_PROGRAMS = {
  serial: 'Bed, then nozzle (waits)',
  parallel: 'Both at once, then wait',
  nowait: 'Mistake: no waits (M104/M140)',
  fan1: 'Mistake: fan on for layer 1',
}
export type HeatProgram = keyof typeof HEAT_PROGRAMS
export const HEAT_BED_C = 60
export function heatProgram(kind: HeatProgram, nozzleC: number, fanPct: number): GProgram {
  const b = HEAT_BED_C
  const heat: Item[] =
    kind === 'serial' || kind === 'fan1'
      ? [`M140 S${b} ; bed target`, `M190 S${b} ; wait for the bed`, `M104 S${nozzleC} ; nozzle target`, `M109 S${nozzleC} ; wait for the nozzle`]
      : kind === 'parallel'
        ? [`M140 S${b} ; bed target`, `M104 S${nozzleC} ; nozzle target`, `M190 S${b} ; wait for the bed`, `M109 S${nozzleC} ; wait for the nozzle`]
        : [`M140 S${b} ; bed target, no wait`, `M104 S${nozzleC} ; nozzle target, no wait`]
  const { x0, x1 } = SQUARE
  const S = Math.round((fanPct / 100) * 255)
  return gProgram([
    'G90',
    'M83',
    ...heat,
    kind === 'fan1' ? 'M106 S255 ; fan on now' : 'M107 ; fan off for layer 1',
    `G0 X${x0} Y${x0 - 10} Z0.3 F6000 ; to the purge start`,
    `G1 X${x1} E${f2(extrudeMm(x1 - x0, 0.3, 0.8))} F1500 ; purge line`,
    [`G1 … layer 1 (4 lines)`, [`G0 X${x0} Y${x0}`, ...squareLayer(x0, x0, x1, x1, 0.3, 0.3, 1800)]],
    `M106 S${S} ; fan for layer 2 on`,
    [`G1 … layer 2 (5 lines)`, ['G0 Z0.6', ...squareLayer(x0, x0, x1, x1, 0.6, 0.3)]],
  ])
}

/** Start and end scripts, optionally missing one step. */
export const SCRIPT_SKIPS = {
  none: 'Full start and end script',
  G28: 'No G28 (home)',
  M109: 'No M109 (wait for the nozzle)',
  purge: 'No purge line',
  lift: 'No Z lift at the end',
  heaters: 'No heaters off (M104/M140 S0)',
  M84: 'No M84 (motors off)',
}
export type ScriptSkip = keyof typeof SCRIPT_SKIPS
export const PART = { x0: 90, x1: 130, layers: 4, h: 0.3, nozzle: 210, bed: 60 }
export function scriptProgram(skip: ScriptSkip): GProgram {
  const { x0, x1, layers, h, nozzle, bed } = PART
  const part: string[] = []
  for (let k = 1; k <= layers; k++) part.push(`G0 X${x0} Y${x0} Z${f2(k * h)} F6000`, ...squareLayer(x0, x0, x1, x1, k * h, h, 1800))
  const top = layers * h
  const items: (Item | false)[] = [
    skip !== 'G28' && 'G28 ; home X Y Z',
    `M140 S${bed} ; bed target`,
    `M190 S${bed} ; wait for the bed`,
    `M104 S${nozzle} ; nozzle target`,
    skip !== 'M109' && `M109 S${nozzle} ; wait for the nozzle`,
    'G90',
    'M83 ; relative E',
    'G0 X20 Y20 Z0.3 F6000',
    skip !== 'purge' && `G1 X120 E${f2(extrudeMm(100, 0.3, 0.8))} F1500 ; purge`,
    [`G1 … the part, ${layers} layers`, part],
    'G1 E-2 F2400 ; retract',
    skip !== 'lift' && `G0 Z${f2(top + 10)} ; lift 10 mm`,
    `G0 X0 Y200 F6000 ; park`,
    ...(skip !== 'heaters' ? ['M104 S0 ; nozzle off', 'M140 S0 ; bed off'] : []),
    'M107 ; fan off',
    skip !== 'M84' && 'M84 ; motors off',
  ]
  return gProgram(items.filter((x): x is Item => x !== false))
}
