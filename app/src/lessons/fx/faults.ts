// Debug it: fault-hunt stage (symptom + PROBE / FOUND / WRONG), a meter whose probes jump to test points, the suspect
// table, and the robo-car supply bench (6 × AA holder → plug → switch → fuse or guard diode → LM2596 → ESP32).
import * as THREE from 'three/webgpu'
import { FaultHunt, MeterRead, PuzzleVerdict, caseFaults, decisiveProbe, huntVerdict, sameReading, stillSuspect } from '../../core/physics'
import { fixedText } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { diodeAlong, glowHalo, motorCan } from './circuit'
import { buildElectrolyticCap } from '../../models/passives'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, glowMat, setGlow } from './colors'
import { dcdcModule, esp32Board, i2cBreakout } from './modules'
import { probe } from './displays'
import { cableRun, wire } from './layout'
import { glassFuse } from './parts'
import { benchMeter, puzzleHeader } from './puzzles'
import { boxScope } from './rigs'
import { flatBox } from './shapes'
import { addLabel, liveLabel } from './text'
import { emptyGroup } from './util'
import { Control, Params, Readout, huntReadout, namesOf, opts, pick } from '../types'

/** Span-40 stage with the fault-hunt header: `set(symptom, verdict, why, hint)`, badge PROBE / FOUND / WRONG. */
export function huntStage() {
  const scene = createStage({ span: 40 })
  const h = puzzleHeader(scene)
  return {
    scene,
    header: {
      set: (symptom: string, v: PuzzleVerdict, why: string, hint = '') =>
        h.set(symptom, v, why, hint, { lead: 'Symptom', badge: v.pass ? 'FOUND' : v.near ? 'PROBE' : 'WRONG' }),
    },
  }
}

export const PROBE_RED = '#d23b3b'
export const PROBE_BLACK = '#202226'

/** Legend: found / probing / ruled out, plus the probe colours. */
export const HUNT_LEGEND = [
  { color: POWER, label: 'Found / fits your readings', shape: 'dot' as const },
  { color: RING, label: 'Probing / this test point', shape: 'dot' as const },
  { color: HIGH_V, label: 'Wrong / ruled out', shape: 'dot' as const },
  { color: LABEL, label: 'Red probe + , black probe COM', shape: 'dot' as const },
]

/** Lesson point: how a hunt works. */
export const HUNT_HOWTO =
  'The hunt: each case hides one suspect (shuffled). Pick a test point: the probes jump there and the meter reads it. Compare with the Healthy row; when one suspect fits everything you measured, pick it. A wrong pick says which reading rules it out; the right one opens the table: green fits, red rules out.'

const shown = (v: number) => (Math.abs(v) < 0.005 ? 0 : v)

/** Four-digit meter text for a reading (`flip` shows the flicker value); OL for open, dashes for a firmware log line. */
export function meterText(r: MeterRead, flip = false) {
  if (r.unit === 'log') return '----'
  if (r.open) return '0L'
  const v = shown(flip && r.alt !== undefined ? r.alt : r.value)
  const a = Math.abs(v)
  const digits = r.unit === '°C' || a >= 99.95 ? 0 : a >= 9.995 ? 1 : r.unit === 'A' && a < 1 ? 3 : 2
  return fixedText(v, digits).replace('−', '-')
}

/** Table text for a reading: "8.40 V", "4.50↔8.40 V" (flickering), "OL", "149 °C lead", "min 2.19 V", a log line. */
export function readingText(r: MeterRead): string {
  if (r.unit === 'log') return r.label ?? ''
  if (r.hold) return `${r.hold} ${readingText({ ...r, hold: undefined })}`
  if (r.open) return 'OL'
  const one = (v: number) => {
    const x = shown(v)
    if (r.unit === 'A') return Math.abs(x) < 1 ? `${Math.round(x * 1000)} m` : `${fixedText(x, 2)} `
    return r.unit === '°C' ? `${Math.round(x)} ` : `${fixedText(x, r.unit === 'Ω' ? 1 : 2)} `
  }
  const unit = r.unit === 'A' ? 'A' : r.unit
  const v = r.alt !== undefined ? `${one(r.value).trim()}↔${one(r.alt)}${unit}` : `${one(r.value)}${unit}`
  return r.label ? `${v} ${r.label}` : v
}

/** Multimeter (scale `k`) at `at` with red / black probes; `aim(red, black)` moves the tips (rebuilds only on change),
 *  `park()` lays them down beside the meter, `show(r, t)` writes the reading, flickering between `value` and `alt` every
 *  ½ s, with a MIN / MAX tag for a held reading. Cables drop to `laneY` and run over. */
export function probeMeter(parent: THREE.Object3D, at: V3, k = 0.42, laneY = -3) {
  const g = add(parent, new THREE.Group())
  const { meter, jack } = benchMeter(g, at[0], at[1], k)
  const leads = add(g, new THREE.Group())
  const holdTag = liveLabel(g, [at[0] - 2.2 * k, at[1] + 6.9 * k, 0.4], { size: 0.32, align: 'left' })
  let key = ''
  const parked: [V3, V3] = [[at[0] - 1.4, laneY - 0.3, 0.4], [at[0] - 2.4, laneY - 0.3, 0.4]]
  const aim = (red: V3, black: V3) => {
    const next = `${red}|${black}`
    if (next === key) return
    key = next
    emptyGroup(leads)
    for (const [tip, color, to, dx] of [[red, PROBE_RED, jack(meter.red), 0.2], [black, PROBE_BLACK, jack(meter.black), -0.2]] as const) {
      const end = probe(leads, tip, [dx, tip[1] < 0 ? 0.45 : -0.45, 1], color)
      cableRun(leads, [end, [end[0], laneY, end[2]], [to[0], laneY - (color === PROBE_RED ? 0 : 0.3), to[2] + 0.6], [to[0], to[1] - 0.6, to[2] + 0.4], to], color, 0.09)
    }
  }
  return {
    meter,
    aim,
    park: () => aim(...parked),
    show(r: MeterRead, t: number) {
      if (r.unit !== 'log') meter.dial(r.unit)
      meter.display.set(meterText(r, r.alt !== undefined && Math.floor(t * 2) % 2 === 1))
      holdTag.set(r.hold ? `${r.hold.toUpperCase()} HOLD` : '', RING)
    },
  }
}

interface TableOpts {
  cols: string[]
  rows: string[]
  /** Name column width, value column width, row pitch; a gap after row `gapAfter`. */
  nameW?: number
  colW?: number
  rowH?: number
  gapAfter?: number
  size?: number
}

/** Suspect table at `at` (top-left): a header row of probe names, then named rows. `cell(i, j, text, colour)`,
 *  `name(i, text, colour)`, `markCol(j | null)` lights a column, `markRow(i, colour | null)` a row. */
export function suspectTable(parent: THREE.Object3D, at: V3, o: TableOpts) {
  const g = add(parent, new THREE.Group(), at)
  const nameW = o.nameW ?? 4.8
  const colW = o.colW ?? 3.3
  const rowH = o.rowH ?? 0.66
  const size = o.size ?? 0.25
  const width = nameW + o.cols.length * colW
  const rowY = (i: number) => -(i + 1) * rowH - (o.gapAfter !== undefined && i > o.gapAfter ? 0.25 : 0)
  const colX = (j: number) => nameW + (j + 0.5) * colW
  o.cols.forEach((c, j) => addLabel(g, c, [colX(j), 0, 0.2], GREY, size * 0.9))
  flatBox(g, [width, 0.04, 0.04], glowMat(GREY, 0.3), [width / 2, -rowH / 2, 0.05])
  const tintMat = (c: string) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.25, transparent: true, opacity: 0.16, depthWrite: false })
  const colBar = flatBox(g, [colW - 0.1, 1, 0.04], tintMat(RING), [0, 0, -0.05])
  const rowMat = tintMat(POWER)
  const rowBar = flatBox(g, [width, rowH * 0.9, 0.03], rowMat, [width / 2, 0, -0.04])
  colBar.visible = rowBar.visible = false
  const names = o.rows.map((r, i) => liveLabel(g, [0, rowY(i), 0.2], { size, align: 'left' }))
  names.forEach((l, i) => l.set(o.rows[i], LABEL))
  const cells = o.rows.map((_, i) => o.cols.map((__, j) => liveLabel(g, [colX(j), rowY(i), 0.2], { size })))
  const top = rowH / 2
  const bottom = rowY(o.rows.length - 1) - rowH / 2
  return {
    group: g,
    cell: (i: number, j: number, text: string, color: string) => cells[i][j].set(text, color),
    name: (i: number, text: string, color: string) => names[i].set(text, color),
    markCol(j: number | null) {
      colBar.visible = j !== null
      if (j === null) return
      colBar.position.set(colX(j), (top + bottom) / 2, -0.05)
      colBar.scale.y = top - bottom
    },
    markRow(i: number | null, color = POWER) {
      rowBar.visible = i !== null
      if (i === null) return
      rowBar.position.y = rowY(i)
      rowMat.color.set(color)
      rowMat.emissive.set(color)
    },
  }
}

// --- The robo-car supply bench ---

export type SupplyTp = 'pack' | 'gndPack' | 'swIn' | 'swOut' | 'guardIn' | 'guardOut' | 'buckIn' | 'rail5' | 'rail33' | 'gnd'
export type SupplyPart = 'holder' | 'lead' | 'plug' | 'switch' | 'guard' | 'buck' | 'driver' | 'ldo' | 'esp'

const YT = 2.6
const YB = -2.2
const BUCK: V3 = [-1.8, -0.2, 0]
const BUCK_K = 0.11
const ESP: V3 = [4, -0.2, 0]
const SW_X = -9.8
const GUARD: [number, number] = [-7.7, -5.5]
const PLUG_X = -12.2
const LEAD_X = -13.6
const HOLDER: V3 = [-14.6, 0.2, 0]
const RAIL_X = -4.4

/** Face-on supply chain between a + rail (top) and GND (bottom): a 6 × AA holder, its JST plug, a slide switch, a T1A
 *  fuse or a series 1N4007 (`guard`), the LM2596 module, an optional DRV8833 on the pack rail and the ESP32 DevKit
 *  (AMS1117 + red power LED). `tp` = test points; `setSwitch(on)`, `setLed(f)`, `glow(part, f, colour)` (heat or a
 *  reveal mark), `flipCells(n)` turns n cells backwards, `flipGuard(on)` solders the diode backwards, `fuse.set(heat, melt)`. */
export function supplyBench(parent: THREE.Object3D, o: { guard: 'fuse' | 'diode'; driver?: boolean }) {
  const g = add(parent, new THREE.Group())
  const r = 0.11
  // Holder: six AA side by side, alternating, in a black tray.
  box(g, [3.3, 3.8, 0.6], mat('#1a1b1f', { rough: 0.7 }), [HOLDER[0], HOLDER[1], -0.3])
  const cells = add(g, new THREE.Group())
  const cellAt = (i: number, flip: boolean) => {
    const c = add(cells, new THREE.Group(), [HOLDER[0] - 1.25 + i * 0.5, HOLDER[1], 0.25])
    const up = (i % 2 === 0) !== flip ? 1 : -1
    cylinder(c, 0.23, 2.5, mat('#26272c', { rough: 0.4 }), [0, -0.35 * up, 0], 'y', 20)
    cylinder(c, 0.235, 0.8, mat('#c9772b', { metal: 0.3, rough: 0.35 }), [0, 0.85 * up, 0], 'y', 20)
    cylinder(c, 0.08, 0.12, mat('#c4c8cf', { metal: 0.5 }), [0, 1.3 * up, 0], 'y', 12)
  }
  let flipped = -1
  const flipCells = (n: number) => {
    if (n === flipped) return
    flipped = n
    emptyGroup(cells)
    for (let i = 0; i < 6; i++) cellAt(i, i >= 6 - n)
  }
  flipCells(0)
  addLabel(g, '6 × AA', [HOLDER[0], HOLDER[1] + 2.3, 0.2], GREY, 0.26)
  cableRun(g, [[LEAD_X, HOLDER[1] + 1.8, 0], [LEAD_X, YT, 0], [PLUG_X - 0.5, YT, 0]], PROBE_RED, r)
  cableRun(g, [[HOLDER[0], HOLDER[1] - 1.9, 0], [HOLDER[0], YB, 0], [RAIL_X, YB, 0], [RAIL_X, -1.135, 0]], PROBE_BLACK, r)
  // Plug, switch, guard along the + rail.
  box(g, [1, 0.7, 0.6], mat('#e8e2d0', { rough: 0.6 }), [PLUG_X, YT, 0])
  addLabel(g, 'JST', [PLUG_X, YT + 0.75, 0.2], GREY, 0.22)
  box(g, [1.8, 0.8, 0.6], mat('#1c1d22', { rough: 0.6 }), [SW_X, YT, 0])
  const slider = box(g, [0.6, 0.55, 0.35], mat('#e8e8e8', { rough: 0.5 }), [SW_X, YT, 0.45])
  addLabel(g, 'switch', [SW_X, YT + 0.8, 0.2], GREY, 0.22)
  wire(g, [[PLUG_X + 0.5, YT, 0], [SW_X - 0.9, YT, 0]], r)
  wire(g, [[SW_X + 0.9, YT, 0], [GUARD[0], YT, 0]], r)
  const guardG = add(g, new THREE.Group())
  let fuse: ReturnType<typeof glassFuse> | null = null
  let backwards: boolean | null = null
  const flipGuard = (back: boolean) => {
    if (back === backwards) return
    backwards = back
    emptyGroup(guardG)
    if (o.guard === 'fuse') {
      fuse = glassFuse(guardG, [(GUARD[0] + GUARD[1]) / 2, YT, 0], { scale: 0.36, slow: true })
      wire(guardG, [[GUARD[0], YT, 0], fuse.ends[0]], r)
      wire(guardG, [fuse.ends[1], [GUARD[1], YT, 0]], r)
    } else {
      const [a, b]: V3[] = [[GUARD[0], YT, 0], [GUARD[1], YT, 0]]
      diodeAlong(guardG, back ? b : a, back ? a : b, { scale: 0.75 })
    }
  }
  flipGuard(false)
  addLabel(g, o.guard === 'fuse' ? 'T1A fuse' : '1N4007', [(GUARD[0] + GUARD[1]) / 2, YT + 0.8, 0.2], GREY, 0.22)
  // LM2596 and the rails round it.
  const buck = dcdcModule(g, BUCK, 'lm2596', BUCK_K)
  const { inP, inM, outP, outM } = buck.pins
  wire(g, [[GUARD[1], YT, 0], [o.driver ? 1.4 : RAIL_X, YT, 0]], r)
  wire(g, [[RAIL_X, YT, 0], [RAIL_X, inP[1], 0], inP], r)
  wire(g, [inM, [RAIL_X, inM[1], 0]], r)
  addLabel(g, 'LM2596 → 5 V', [BUCK[0], BUCK[1] - 1.75, 0.2], GREY, 0.24)
  if (o.driver) {
    box(g, [2.4, 1, 0.3], mat('#b8322a', { rough: 0.55 }), [2.6, YT, 0])
    addLabel(g, 'DRV8833', [2.6, YT, 0.25], LABEL, 0.22)
  }
  // ESP32 DevKit: PCB, module can, AMS1117 and the power LED.
  const [ex, ey] = [ESP[0], ESP[1]]
  box(g, [3.6, 3, 0.25], mat('#1d2a3a', { rough: 0.6 }), [ex, ey, -0.1])
  box(g, [1.8, 1.4, 0.3], mat('#b9bec6', { metal: 0.4, rough: 0.35 }), [ex + 0.6, ey - 0.4, 0.15])
  addLabel(g, 'ESP32', [ex + 0.6, ey - 0.4, 0.35], '#333842', 0.26)
  box(g, [0.7, 0.5, 0.3], mat('#1c1d22', { rough: 0.6 }), [ex - 0.9, ey + 0.75, 0.15])
  addLabel(g, 'AMS1117', [ex - 0.9, ey + 1.25, 0.3], GREY, 0.18)
  const ledMat = glowMat('#ff3030', 0)
  add(g, new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), ledMat), [ex + 1.3, ey + 1.05, 0.25])
  const ledHalo = glowHalo(g, [ex + 1.3, ey + 1.05, 0.5], 0.35)
  addLabel(g, 'PWR', [ex + 1.3, ey + 1.45, 0.3], GREY, 0.16)
  wire(g, [outP, [ex - 1.8, outP[1], 0]], r)
  wire(g, [outM, [ex - 1.8, outM[1], 0]], r)

  const tp: Record<SupplyTp, V3> = {
    pack: [LEAD_X, YT - 0.2, 0.2],
    gndPack: [-12.8, YB, 0.2],
    swIn: [SW_X - 1.1, YT, 0.2],
    swOut: [SW_X + 1.1, YT, 0.2],
    guardIn: [GUARD[0], YT, 0.2],
    guardOut: [GUARD[1], YT, 0.2],
    buckIn: [inP[0], inP[1], 0.3],
    rail5: [outP[0], outP[1], 0.3],
    rail33: [ex - 0.55, ey + 0.75, 0.35],
    gnd: [RAIL_X - 0.8, YB, 0.2],
  }
  const spots: Record<SupplyPart, V3> = {
    holder: [HOLDER[0], HOLDER[1], 0.8],
    lead: [LEAD_X, (HOLDER[1] + 1.8 + YT) / 2, 0.6],
    plug: [PLUG_X, YT, 0.6],
    switch: [SW_X, YT, 0.6],
    guard: [(GUARD[0] + GUARD[1]) / 2, YT, 0.6],
    buck: [BUCK[0] - 0.6, BUCK[1] - 0.5, 0.8],
    driver: [2.6, YT, 0.6],
    ldo: [ex - 0.9, ey + 0.75, 0.6],
    esp: [ex, ey, 0.6],
  }
  const halos = Object.fromEntries((Object.keys(spots) as SupplyPart[]).map((k) => [k, glowHalo(g, spots[k], k === 'holder' || k === 'esp' ? 0.6 : 0.45)])) as Record<SupplyPart, ReturnType<typeof glowHalo>>
  return {
    group: g,
    tp,
    spots,
    get fuse() {
      return fuse
    },
    flipCells,
    flipGuard,
    setSwitch(on: boolean) {
      slider.position.x = SW_X + (on ? 0.4 : -0.4)
    },
    setLed(f: number) {
      setGlow(ledMat, '#ff3030', 1.4 * f)
      ledHalo.set(0.8 * f, '#ff3030')
    },
    glow: (part: SupplyPart, f: number, color = HEAT) => halos[part].set(f, color),
    clearGlow: () => Object.values(halos).forEach((h) => h.set(0, HEAT)),
  }
}

// --- Lesson kit: case / probe / diagnosis controls, the visited-probe log, the table fill and the header wording ---

type Names<K extends string> = Record<K, { name: string }>
/** 'Flat pack' → 'flat pack'; acronyms ('STBY not wired') stay. */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

/** Everything a fault-hunt lesson shares. `seed` shuffles which suspect each case hides (`caseFaults`); `fixes[f]` is the
 *  header line when `f` is found. `track()` (per build) logs the probes visited in the current case. */
export function huntKit<F extends string, P extends string>(h: FaultHunt<F, P>, faults: Names<F>, probes: Names<P>, seed: number) {
  const order = caseFaults(h.faults, seed)
  const CASES = Object.fromEntries(order.map((_, i) => [String(i + 1), `Case ${i + 1}`])) as Record<string, string>
  const GUESS = { none: 'Diagnosis?', ...namesOf(faults) } as Record<string, string>
  const PROBES = namesOf(probes) as Record<string, string>
  const name = (f: F) => faults[f].name
  const params = (p: Params) => {
    const c = pick(CASES, p.case, '1')
    const g = String(p.guess)
    return { c, truth: order[Number(c) - 1], probe: pick(PROBES, p.probe, h.probes[0]) as P, guess: g in faults ? (g as F) : null }
  }
  type Q = ReturnType<typeof params>
  return {
    order,
    params,
    name,
    controls: [
      { kind: 'choice', key: 'case', options: opts(CASES), initial: '1' },
      { kind: 'choice', key: 'probe', options: opts(PROBES), initial: h.probes[0] },
      { kind: 'choice', key: 'guess', options: opts(GUESS), initial: 'none' },
    ] as Control[],
    verdict: (q: Q) => huntVerdict(q.truth, q.guess),
    /** Probes visited in this case (resets when the case changes). */
    track() {
      let c = ''
      const seen: P[] = []
      return (q: Q) => {
        if (q.c !== c) {
          c = q.c
          seen.length = 0
        }
        if (!seen.includes(q.probe)) seen.push(q.probe)
        return [...seen]
      }
    },
    /** Suspect table: Healthy and Measured rows, then the suspects. */
    table: (parent: THREE.Object3D, at: V3, o: Partial<TableOpts> = {}) =>
      suspectTable(parent, at, { cols: h.probes.map((p) => probes[p].name), rows: ['Healthy', 'You measured', ...h.faults.map(name)], gapAfter: 1, ...o }),
    /** Fill the table: predictions stay hidden; a wrong pick opens its own row, the right one every row. Green cells fit
     *  what was measured, red ones rule the suspect out. */
    fill(t: ReturnType<typeof suspectTable>, q: Q, seen: P[]) {
      h.probes.forEach((p, j) => {
        const got = h.read(q.truth, p)
        t.cell(0, j, readingText(h.read('ok', p)), GREY)
        t.cell(1, j, seen.includes(p) ? readingText(got) : '?', seen.includes(p) ? RING : GREY)
        h.faults.forEach((f, i) => {
          const pred = h.read(f, p)
          const tint = !seen.includes(p) ? GREY : sameReading(pred, got) ? POWER : HIGH_V
          const open = q.guess === q.truth || q.guess === f
          t.cell(i + 2, j, open ? readingText(pred) : '·', open ? tint : GREY)
        })
      })
      h.faults.forEach((f, i) => t.name(i + 2, name(f), q.guess === q.truth && f === q.truth ? POWER : q.guess === f ? HIGH_V : LABEL))
      t.markCol(h.probes.indexOf(q.probe))
      t.markRow(q.guess ? h.faults.indexOf(q.guess) + 2 : null, q.guess === q.truth ? POWER : HIGH_V)
    },
    /** Header reason and hint for the current state. */
    words(q: Q, seen: P[], fixes: Record<F, string>, hint: string): [string, string] {
      if (!q.guess) return [`${stillSuspect(h, q.truth, seen).length} of ${h.faults.length} suspects fit your readings`, hint]
      // The reading that rules `f` out: one already taken if possible.
      const by = (f: F) => seen.find((x) => !sameReading(h.read(f, x), h.read(q.truth, x))) ?? decisiveProbe(h, q.truth, f)!
      const g = q.guess
      if (g !== q.truth) {
        const p = by(g)
        return [
          `Not ${lowerFirst(name(g))}: ${probes[p].name} would read ${readingText(h.read(g, p))}, it reads ${readingText(h.read(q.truth, p))}`,
          seen.includes(p) ? 'Its row shows what it predicts; red cells clash with your readings' : `Probe ${probes[p].name} and compare with the Healthy row`,
        ]
      }
      const list = `Ruled out: ${h.faults.filter((f) => f !== q.truth).map((f) => `${name(f)} (${probes[by(f)].name})`).join(' · ')}`
      return [fixes[q.truth], list.length <= 110 ? list : 'Every other row has a red cell: a reading that suspect can’t explain']
    },
    readouts(q: Q, seen: P[]): Readout[] {
      const got = h.read(q.truth, q.probe)
      return [
        { label: probes[q.probe].name, value: readingText(got), tone: sameReading(got, h.read('ok', q.probe)) ? 'ok' : 'bad' },
        { label: 'Healthy reads', value: readingText(h.read('ok', q.probe)) },
        { label: 'Suspects left', value: `${stillSuspect(h, q.truth, seen).length} of ${h.faults.length}` },
        huntReadout(huntVerdict(q.truth, q.guess)),
      ]
    },
  }
}

// --- Hunt rig: meter on the chosen test points, glows, header and table, on any bench ---

/** A bench a hunt runs on: test points and glow spots by name. */
export interface HuntBench<T extends string, S extends string> {
  tp: Record<T, V3>
  spots: Record<S, V3>
  glow: (part: S, f: number, color?: string) => void
  clearGlow: () => void
}

type Kit<F extends string, P extends string> = ReturnType<typeof huntKit<F, P>>
type HuntQ<F extends string, P extends string> = ReturnType<Kit<F, P>['params']>

export interface HuntRigSpec<F extends string, P extends string, T extends string, S extends string, Tip extends { red: T | S; black: T }> {
  hunt: FaultHunt<F, P>
  kit: Kit<F, P>
  bench: HuntBench<T, S>
  /** Where the probes sit per test point (red on a part = on its glow spot). */
  tips: Record<P, Tip>
  /** Part to mark per suspect when it's picked. */
  parts: Record<F, S>
  /** Thermal-camera reading label → part it glows. */
  hot?: Record<string, S>
  symptom: string
  hint: string
  fixes: Record<F, string>
  table: { colW: number; nameW?: number; at?: V3 }
  meterAt?: V3
  /** Extras each frame (switch, LEDs, spinning parts, reveals once found). */
  extra?: (s: { q: HuntQ<F, P>; read: MeterRead; tip: Tip; t: number; dt: number; found: boolean }) => void
}

/** Shared frame for a fault hunt: probe meter aimed at the chosen test point, heat and diagnosis glows, header, table. */
export function huntRig<F extends string, P extends string, T extends string, S extends string, Tip extends { red: T | S; black: T }>(
  scene: THREE.Object3D,
  header: ReturnType<typeof huntStage>['header'],
  s: HuntRigSpec<F, P, T, S, Tip>,
) {
  const { bench, kit } = s
  const meter = probeMeter(scene, s.meterAt ?? [9.8, 0.4, 0])
  const table = kit.table(scene, s.table.at ?? [-17, -3.9, 0], { colW: s.table.colW, nameW: s.table.nameW ?? 5.4 })
  const track = kit.track()
  const st = { t: 0, seen: [] as P[] }
  const hotPart = (read: MeterRead) => (read.unit === '°C' && read.label ? s.hot?.[read.label] : undefined)
  const spot = (k: T | S, read: MeterRead): V3 => (k in bench.tp ? bench.tp[k as T] : bench.spots[hotPart(read) ?? (k as S)])
  return {
    frame(dt: number, p: Params) {
      st.t += dt
      const q = kit.params(p)
      st.seen = track(q)
      const tip = s.tips[q.probe]
      const read = s.hunt.read(q.truth, q.probe)
      if (read.unit === 'log') meter.park()
      else meter.aim(spot(tip.red, read), bench.tp[tip.black])
      meter.show(read, st.t)
      bench.clearGlow()
      const hp = hotPart(read)
      if (hp) bench.glow(hp, Math.min(1.6, (read.value - 25) / 90), HEAT)
      const found = q.guess === q.truth
      if (q.guess) bench.glow(s.parts[q.guess], 0.8, found ? POWER : HIGH_V)
      s.extra?.({ q, read, tip, t: st.t, dt, found })
      const [why, hint] = kit.words(q, st.seen, s.fixes, s.hint)
      header.set(s.symptom, kit.verdict(q), why, hint)
      kit.fill(table, q, st.seen)
    },
    readouts: (p: Params) => kit.readouts(kit.params(p), st.seen),
  }
}

// --- The robo-car drive bench: 2S pack → driver breakout → TT gear motor, ESP32 on USB driving the logic pins ---

export type DriverBenchChip = 'tb6612' | 'drv8833'
/** Bottom (logic) header per chip, left to right; each is jumpered to the ESP32 in order. */
export const DRIVER_LOGIC: Record<DriverBenchChip, string[]> = {
  tb6612: ['PWMA', 'AIN2', 'AIN1', 'STBY', 'VCC', 'GND'],
  drv8833: ['IN1', 'IN2', 'GND'],
}
const JUMPER_TINT = ['#e8c547', '#3fae6a', '#3a7bd5', '#e0782f', '#d8322c', PROBE_BLACK]
const DRV: V3 = [-5.6, 1.5, 0]
const DRV_W = 5.6
const DRV_H = 2.6
const ESPB: V3 = [-12.6, -1.6, 0]
const ESP_K = 0.3
const MOTOR: V3 = [0.4, 1.3, 0]
const PACKB: V3 = [-14.6, 2.3, 0]

/** Polyline cut to the stretch between fractions u0…u1 of its length. */
function polyPart(points: V3[], u0: number, u1: number): V3[] {
  const seg = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1], p[2] - points[i][2]))
  const total = seg.reduce((a, b) => a + b, 0)
  const at = (u: number): V3 => {
    let d = u * total
    for (let i = 0; i < seg.length; i++) {
      if (d <= seg[i] || i === seg.length - 1) {
        const f = seg[i] ? Math.min(1, d / seg[i]) : 0
        return [0, 1, 2].map((k) => points[i][k] + (points[i + 1][k] - points[i][k]) * f) as V3
      }
      d -= seg[i]
    }
    return points[points.length - 1]
  }
  let acc = 0
  const inner = points.filter((_, i) => {
    if (i === 0) return false
    acc += seg[i - 1]
    return acc / total > u0 && acc / total < u1
  })
  return [at(u0), ...inner, at(u1)]
}

/** Face-on drive bench: a 2 × 18650 holder, a TB6612FNG or DRV8833 breakout (top header VM GND AO1 AO2, bottom = logic
 *  pins per `DRIVER_LOGIC`), a TT gear motor with its wheel, an ESP32 DevKit on USB jumpered to the logic pins. `tp` =
 *  test points (`vm`, `gndM`, `ao1`, `ao2`, `m1`, `m2`, `espGnd`, `gpio` (ESP end of the first jumper), each logic pin by
 *  name); `spots` = `pack`, `driver`, `motor`, `esp` and one per wire (`w:VM`, `w:AO2`, `w:<logic pin>`). `wire(key,
 *  'ok' | 'off' | 'cut')` pulls a wire off its first end or cuts it; `spin(dt, rpm)` turns the wheel, `hum(f, t)` shakes
 *  the motor (stalled), `glow`/`clearGlow`. */
export function driverBench(parent: THREE.Object3D, o: { chip: DriverBenchChip }) {
  const g = add(parent, new THREE.Group())
  const logic = DRIVER_LOGIC[o.chip]
  // Pack: two 18650s in a black holder.
  box(g, [3.8, 1.9, 0.5], mat('#1a1b1f', { rough: 0.7 }), [PACKB[0], PACKB[1], -0.3])
  for (const dy of [-0.45, 0.45]) {
    cylinder(g, 0.38, 3.2, mat('#2a6fb0', { rough: 0.45 }), [PACKB[0], PACKB[1] + dy, 0.15], 'x', 20)
    cylinder(g, 0.2, 0.12, mat('#c4c8cf', { metal: 0.5 }), [PACKB[0] + 1.65, PACKB[1] + dy, 0.15], 'x', 12)
  }
  addLabel(g, '2 × 18650', [PACKB[0], PACKB[1] - 1.25, 0.2], GREY, 0.24)
  const packP: V3 = [PACKB[0] + 1.9, PACKB[1] + 0.45, 0.1]
  const packM: V3 = [PACKB[0] + 1.9, PACKB[1] - 0.45, 0.1]
  // Driver breakout.
  const color = o.chip === 'tb6612' ? '#1f4fa0' : '#5a2a82'
  box(g, [DRV_W, DRV_H, 0.25], mat(color, { rough: 0.55 }), [DRV[0], DRV[1], -0.15])
  const chipMat = new THREE.MeshStandardMaterial({ color: '#1b1c20', roughness: 0.6 })
  box(g, [1.3, 0.9, 0.25], chipMat, [DRV[0], DRV[1], 0.1])
  addLabel(g, o.chip === 'tb6612' ? 'TB6612FNG' : 'DRV8833', [DRV[0], DRV[1] - 0.05, 0.3], LABEL, 0.2)
  const header = (names: string[], y: number, labelDy: number) =>
    Object.fromEntries(
      names.map((n, i) => {
        const x = DRV[0] + (i - (names.length - 1) / 2) * 0.88
        box(g, [0.3, 0.3, 0.3], mat('#141416', { rough: 0.7 }), [x, y, 0.1])
        box(g, [0.1, 0.1, 0.5], mat('#d9b24a', { metal: 0.45, rough: 0.35 }), [x, y, 0.35])
        addLabel(g, n, [x, y + labelDy, 0.05], '#eef2f6', 0.17)
        return [n, [x, y, 0.45] as V3]
      }),
    )
  const top = header(['VM', 'GND', 'AO1', 'AO2'], DRV[1] + DRV_H / 2 - 0.3, -0.38)
  const bot = header(logic, DRV[1] - DRV_H / 2 + 0.3, 0.38)
  // TT gear motor: silver can, yellow gearbox, wheel on the output shaft toward the viewer.
  const motorG = add(g, new THREE.Group(), MOTOR)
  cylinder(motorG, 0.62, 1.9, mat('#c9ccd1', { metal: 0.45, rough: 0.35 }), [-0.95, 0, 0], 'x', 28)
  box(motorG, [3.4, 1.7, 1.1], mat('#f2c230', { rough: 0.6 }), [1.7, 0, 0])
  const m1: V3 = [MOTOR[0] - 2, MOTOR[1] + 0.3, 0.2]
  const m2: V3 = [MOTOR[0] - 2, MOTOR[1] - 0.3, 0.2]
  for (const m of [m1, m2]) box(motorG, [0.25, 0.18, 0.3], mat('#d9b24a', { metal: 0.45 }), [m[0] - MOTOR[0], m[1] - MOTOR[1], 0])
  const wheel = add(motorG, new THREE.Group(), [2.4, 0, 0.9])
  cylinder(wheel, 1.75, 0.55, mat('#18191c', { rough: 0.85 }), [0, 0, 0], 'z', 40)
  cylinder(wheel, 1.2, 0.6, mat('#f2c230', { rough: 0.55 }), [0, 0, 0.02], 'z', 32)
  for (let k = 0; k < 6; k++) box(wheel, [0.22, 2.1, 0.08], mat('#c79a1c', { rough: 0.55 }), [0, 0, 0.34]).rotation.z = (k * Math.PI) / 6
  cylinder(wheel, 0.25, 0.7, mat('#e8e8e8', { rough: 0.5 }), [0, 0, 0.05], 'z', 16)
  addLabel(g, 'TT motor', [MOTOR[0] + 2.4, MOTOR[1] - 2.1, 0.2], GREY, 0.24)
  // ESP32 DevKit on USB.
  const espPin = esp32Board(g, ESPB, ESP_K)
  addLabel(g, 'ESP32', [ESPB[0] + 5.4, ESPB[1] - 0.6, 0.2], GREY, 0.24)
  const usbEnd: V3 = [ESPB[0] + 10 * ESP_K, ESPB[1], 0.3]
  cableRun(g, [usbEnd, [usbEnd[0] + 0.9, usbEnd[1], 0.3], [usbEnd[0] + 0.9, -2.9, 0.3]], '#9aa0aa', 0.12)
  addLabel(g, 'USB', [usbEnd[0] + 1.5, -2.5, 0.2], GREY, 0.2)
  const espAt = (k: number) => espPin(-6 + 2 * k, true)

  // Wires, each from its driver end; three prebuilt looks per wire.
  const wires: Record<string, { ok: THREE.Group; off: THREE.Group; cut: THREE.Group }> = {}
  const spots: Record<string, V3> = {
    pack: [PACKB[0], PACKB[1], 0.6],
    driver: [DRV[0], DRV[1], 0.5],
    motor: [MOTOR[0] + 0.3, MOTOR[1], 0.8],
    esp: [ESPB[0], ESPB[1], 0.8],
  }
  const run = (key: string, pts: V3[], tint: string, r = 0.09) => {
    const looks = { ok: add(g, new THREE.Group()), off: add(g, new THREE.Group()), cut: add(g, new THREE.Group()) }
    cableRun(looks.ok, pts, tint, r)
    const [a, b] = [pts[0], pts[1]]
    const away = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const loose: V3 = [a[0] + ((b[0] - a[0]) / away) * 0.7, a[1] + ((b[1] - a[1]) / away) * 0.7 - 0.5, a[2] + 0.5]
    cableRun(looks.off, [loose, ...polyPart(pts, 0.12, 1).slice(1)], tint, r)
    cableRun(looks.cut, polyPart(pts, 0, 0.42), tint, r)
    cableRun(looks.cut, polyPart(pts, 0.58, 1), tint, r)
    looks.off.visible = looks.cut.visible = false
    wires[key] = looks
    const mid = polyPart(pts, 0.5, 0.5)[0]
    spots[`w:${key}`] = [mid[0], mid[1], mid[2] + 0.3]
  }
  const yTop = DRV[1] + DRV_H / 2 + 0.75
  run('VM', [top.VM, [top.VM[0], yTop, 0.3], [packP[0] + 0.5, yTop, 0.3], [packP[0] + 0.5, packP[1], 0.2], packP], PROBE_RED, 0.11)
  run('GNDM', [top.GND, [top.GND[0], yTop - 0.3, 0.3], [packM[0] + 0.9, yTop - 0.3, 0.3], [packM[0] + 0.9, packM[1], 0.2], packM], PROBE_BLACK, 0.11)
  run('AO1', [top.AO1, [top.AO1[0], yTop - 0.15, 0.3], [m1[0] - 0.7, yTop - 0.15, 0.3], [m1[0] - 0.7, m1[1], 0.25], m1], '#d8322c', 0.08)
  run('AO2', [top.AO2, [top.AO2[0], yTop - 0.45, 0.3], [m2[0] - 0.4, yTop - 0.45, 0.3], [m2[0] - 0.4, m2[1], 0.25], m2], PROBE_BLACK, 0.08)
  logic.forEach((n, k) => {
    const d = bot[n]
    const e = espAt(k)
    const lane = d[1] - 0.55 - (logic.length - 1 - k) * 0.15
    run(n, [d, [d[0], lane, 0.5], [e[0], lane, 0.5], [e[0], e[1] + 0.1, 0.6], e], n === 'GND' ? PROBE_BLACK : n === 'VCC' ? '#d8322c' : JUMPER_TINT[k % 4], 0.07)
  })
  const tp: Record<string, V3> = {
    vm: top.VM,
    gndM: top.GND,
    ao1: top.AO1,
    ao2: top.AO2,
    m1,
    m2,
    espGnd: espAt(logic.length - 1),
    gpio: espAt(0),
    ...bot,
  }
  const halos = Object.fromEntries(Object.keys(spots).map((k) => [k, glowHalo(g, spots[k], k.startsWith('w:') ? 0.35 : 0.6)]))
  return {
    group: g,
    tp,
    spots,
    logic,
    wire(key: string, state: 'ok' | 'off' | 'cut') {
      const w = wires[key]
      w.ok.visible = state === 'ok'
      w.off.visible = state === 'off'
      w.cut.visible = state === 'cut'
    },
    spin(dt: number, rpm: number) {
      wheel.rotation.z -= (dt * rpm * 2 * Math.PI) / 60
    },
    hum(f: number, t: number) {
      motorG.position.set(MOTOR[0] + 0.03 * f * Math.sin(t * 190), MOTOR[1] + 0.03 * f * Math.sin(t * 230 + 1), 0)
    },
    glow: (part: string, f: number, c = HEAT) => halos[part].set(f, c),
    clearGlow: () => Object.values(halos).forEach((h) => h.set(0, HEAT)),
  }
}

// --- Rail capture: what a meter can't catch (a scope trace of a rail, the firmware's reset reason) ---

/** Small scope at `at` (centre) for a rail between `lo`…`hi` V: `levels` = dashed lines [volts, text, colour] (BOD, 3.0 V; the top label above its line, the rest below);
 *  `set(healthy, got, span)` draws the healthy trace in grey and the measured one in cyan (null hides; samples spread over
 *  the width), `span` = the timebase text; `log(text, colour)` writes a serial-monitor line under it. */
export function railCapture(parent: THREE.Object3D, at: V3, w: number, h: number, o: { lo: number; hi: number; title: string; levels: [number, string, string][] }) {
  const g = add(parent, new THREE.Group())
  const { s, tag } = boxScope(g, { x: at[0], y: at[1], w, h }, o.title, [6, 4], { axis: [`${o.hi} V`, `${o.lo} V`], axisSize: 0.22 })
  const y = (v: number) => ((v - o.lo) / (o.hi - o.lo)) * h - h / 2
  const top = Math.max(...o.levels.map(([v]) => v))
  for (const [v, text, color] of o.levels) {
    s.level(color, 0.3).set(y(v))
    addLabel(g, text, [at[0] + w / 2 - 0.1, at[1] + y(v) + (v === top ? 0.25 : -0.25), 0.3], color, 0.2, 'right')
  }
  const traces = [s.trace(GREY, { samples: 160, radius: 0.035 }), s.trace(B_FIELD, { samples: 160, radius: 0.06 })]
  const line = liveLabel(g, [at[0] + w / 2, at[1] - h / 2 - 0.85, 0.3], { size: 0.22, align: 'right' })
  const draw = (k: number, d: readonly number[] | null) => {
    traces[k].group.visible = !!d
    if (d) traces[k].draw((u) => y(d[Math.min(d.length - 1, Math.round(u * (d.length - 1)))]), null)
  }
  return {
    group: g,
    set(healthy: readonly number[] | null, got: readonly number[] | null, span: string) {
      draw(0, healthy)
      draw(1, got)
      tag.set(span, GREY)
    },
    log: (text: string, color = LABEL) => line.set(text, color),
  }
}

// --- The reset bench: a pack or buck → lead → (driver + 4 TT motors, Schottky + hold-up cap) → ESP32 VIN, AMS1117 → 3.3 V ---

export type ResetSource = '4aa' | 'buck' | '3s' | 'hidden'
export type ResetTp = 'pack' | 'packGnd' | 'rail' | 'gnd' | 'vin' | 'v33' | 'usb'
export type ResetPart = 'source' | 'lead' | 'driver' | 'motors' | 'cap' | 'esp' | 'ldo' | 'decoupling' | 'sensors'

const RB = { yt: 3.4, yb: -3.1, src: [-14.8, 0.8, 0] as V3, railX: -11, esp: [-1.6, -1.2, 0] as V3, espK: 0.3, holdX: -8.6 }

/** Face-on reset bench between a + rail (top) and GND (bottom): the source (`'4aa'` holder, `'buck'` LM2596 at 5 V or
 *  `'3s'` 18650 pack, `'hidden'` a box marked ?; `source(kind)`), its lead (`lead(thin)`: a long thin coil), with `motors` a DRV8833 + four TT
 *  motors on the rail and a Schottky + 10 mF hold-up cap into VIN (`holdup(on)`), the ESP32 DevKit (AMS1117, 3.3 V
 *  decoupling cap `decoupling(on)`), with `sensors` a 3.3 V sensor board, a USB lead to the serial monitor. `spin(dt, f)`
 *  turns the motors, `glow`/`clearGlow` per part. */
export function resetBench(parent: THREE.Object3D, o: { motors?: boolean; sensors?: boolean }) {
  const g = add(parent, new THREE.Group())
  const r = 0.1
  const [sx, sy] = [RB.src[0], RB.src[1]]
  // Sources: three looks, one shown.
  const looks = Object.fromEntries((['4aa', 'buck', '3s', 'hidden'] as const).map((k) => [k, add(g, new THREE.Group())])) as Record<ResetSource, THREE.Group>
  box(looks.hidden, [2.8, 3.8, 0.6], mat('#3a3d45', { rough: 0.7 }), [sx, sy, -0.3])
  addLabel(looks.hidden, '?', [sx, sy, 0.2], LABEL, 0.9)
  addLabel(looks.hidden, 'power in', [sx, sy - 2.4, 0.2], GREY, 0.26)
  box(looks['4aa'], [2.4, 3.8, 0.6], mat('#1a1b1f', { rough: 0.7 }), [sx, sy, -0.3])
  for (let i = 0; i < 4; i++) {
    const up = i % 2 === 0 ? 1 : -1
    const c = add(looks['4aa'], new THREE.Group(), [sx - 0.75 + i * 0.5, sy, 0.25])
    cylinder(c, 0.23, 2.5, mat('#26272c', { rough: 0.4 }), [0, -0.35 * up, 0], 'y', 20)
    cylinder(c, 0.235, 0.8, mat('#c9772b', { metal: 0.3, rough: 0.35 }), [0, 0.85 * up, 0], 'y', 20)
  }
  addLabel(looks['4aa'], '4 × AA', [sx, sy - 2.4, 0.2], GREY, 0.26)
  dcdcModule(looks.buck, [sx, sy, 0], 'lm2596', 0.1)
  addLabel(looks.buck, 'buck → 5 V', [sx, sy - 2.4, 0.2], GREY, 0.26)
  box(looks['3s'], [2.8, 3.8, 0.5], mat('#1a1b1f', { rough: 0.7 }), [sx, sy, -0.3])
  for (const dx of [-0.85, 0, 0.85]) cylinder(looks['3s'], 0.38, 3.3, mat('#2a6fb0', { rough: 0.45 }), [sx + dx, sy, 0.15], 'y', 20)
  addLabel(looks['3s'], '3S Li-ion 12 V', [sx, sy - 2.4, 0.2], GREY, 0.26)
  const packP: V3 = [sx + 0.6, sy + 2, 0]
  const packM: V3 = [sx - 0.6, sy - 2, 0]
  // Lead: short and thick, or a long thin coil.
  const leads = { thick: add(g, new THREE.Group()), thin: add(g, new THREE.Group()) }
  cableRun(leads.thick, [packP, [packP[0], RB.yt, 0], [RB.railX, RB.yt, 0]], PROBE_RED, 0.13)
  cableRun(leads.thick, [packM, [packM[0], RB.yb, 0], [RB.railX, RB.yb, 0]], PROBE_BLACK, 0.13)
  const coil = (y0: number, from: V3, color: string, dy: number) => {
    const pts: V3[] = [from, [from[0], y0, 0]]
    for (let k = 0; k < 5; k++) {
      const x = from[0] + 0.5 + k * 0.6
      pts.push([x, y0, 0.2], [x + 0.15, y0 + dy, 0.4], [x + 0.3, y0, 0.2])
    }
    pts.push([RB.railX, y0, 0])
    cableRun(leads.thin, pts, color, 0.05)
  }
  coil(RB.yt, packP, PROBE_RED, -0.9)
  coil(RB.yb, packM, PROBE_BLACK, 0.9)
  addLabel(g, 'lead', [(packP[0] + RB.railX) / 2, RB.yt + 0.6, 0.2], GREY, 0.22)
  // Rails.
  const [ex, ey] = [RB.esp[0], RB.esp[1]]
  const usbEnd: V3 = [ex + 10 * RB.espK, ey, 0.3]
  const vinPin: V3 = [ex - 4.3, ey - 0.9, 0.4]
  const gndPin: V3 = [ex - 4.3, ey - 1.4, 0.4]
  wire(g, [[RB.railX, RB.yb, 0], [ex - 4.8, RB.yb, 0], [ex - 4.8, gndPin[1], 0], gndPin], r)
  const spots: Record<ResetPart, V3> = {
    source: [sx, sy, 0.8],
    lead: [(packP[0] + RB.railX) / 2, RB.yt, 0.5],
    driver: [-6, RB.yt, 0.6],
    motors: [1.6, RB.yt + 0.3, 0.8],
    cap: [RB.holdX + 1.6, 0, 0.8],
    esp: [ex, ey, 0.8],
    ldo: [ex + 2.2, ey + 1.05, 0.6],
    decoupling: [ex + 1.2, ey + 1.05, 0.6],
    sensors: [5.6, 1.6, 0.6],
  }
  const motorCans: ReturnType<typeof motorCan>[] = []
  const holdG = add(g, new THREE.Group())
  if (o.motors) {
    // DRV8833 on the rail, four TT motors.
    wire(g, [[RB.railX, RB.yt, 0], [-7.2, RB.yt, 0]], r)
    box(g, [2.4, 1.1, 0.3], mat('#5a2a82', { rough: 0.55 }), [-6, RB.yt, 0])
    addLabel(g, 'DRV8833', [-6, RB.yt, 0.25], LABEL, 0.22)
    for (let k = 0; k < 4; k++) {
      const m = motorCan(g, [-1.4 + k * 2, RB.yt + 0.3, 0], { r: 0.7, legs: 0.3 })
      motorCans.push(m)
      cableRun(g, [[-4.8, RB.yt - 0.2 - k * 0.08, 0.1], [m.pins[0][0], RB.yt - 0.2 - k * 0.08, 0.1], m.pins[0]], '#e0e0e0', 0.05)
    }
    addLabel(g, '4 × TT', [5.5, RB.yt + 0.3, 0.2], GREY, 0.22, 'left')
    // Schottky down from the rail, the hold-up cap to GND, on to VIN.
    wire(g, [[RB.holdX, RB.yt, 0], [RB.holdX, 2.2, 0]], r)
    diodeAlong(g, [RB.holdX, 2.2, 0.2], [RB.holdX, 0.6, 0.2], { scale: 0.6 })
    wire(g, [[RB.holdX, 0.6, 0], [RB.holdX, vinPin[1], 0], vinPin], r)
    addLabel(g, 'SS34', [RB.holdX - 0.4, 1.4, 0.2], GREY, 0.2, 'right')
    wire(holdG, [[RB.holdX, 0.1, 0], [RB.holdX + 1.6, 0.1, 0]], r)
    const cap = add(holdG, buildElectrolyticCap(), [RB.holdX + 1.6, -2.5, 0])
    cap.scale.setScalar(0.5)
    addLabel(holdG, '10 mF', [RB.holdX + 2.6, -1.2, 0.3], POWER, 0.22, 'left')
  } else {
    wire(g, [[RB.railX, RB.yt, 0], [RB.holdX, RB.yt, 0], [RB.holdX, vinPin[1], 0], vinPin], r)
  }
  // ESP32 DevKit, its AMS1117 and 3.3 V decoupling, the USB lead to the serial monitor.
  esp32Board(g, RB.esp, RB.espK)
  addLabel(g, 'ESP32', [ex - 1.5, ey + 2.1, 0.2], GREY, 0.24)
  addLabel(g, 'VIN', [vinPin[0] + 0.3, vinPin[1] + 0.4, 0.4], LABEL, 0.18, 'left')
  box(g, [0.9, 0.6, 0.3], mat('#1c1d22', { rough: 0.6 }), [spots.ldo[0], spots.ldo[1], 0.4])
  addLabel(g, 'AMS1117', [spots.ldo[0], spots.ldo[1] + 0.55, 0.5], LABEL, 0.17)
  const decoupG = add(g, new THREE.Group())
  box(decoupG, [0.45, 0.3, 0.3], mat('#c9a46a', { rough: 0.5 }), [spots.decoupling[0], spots.decoupling[1], 0.4])
  addLabel(decoupG, '10 µF', [spots.decoupling[0] - 0.2, spots.decoupling[1] + 0.55, 0.5], LABEL, 0.17)
  const v33: V3 = [ex + 2.2, ey + 0.3, 0.6]
  addLabel(g, '3V3', [v33[0] + 0.5, v33[1], 0.6], LABEL, 0.17, 'left')
  cableRun(g, [usbEnd, [usbEnd[0] + 1.2, usbEnd[1], 0.3], [usbEnd[0] + 1.2, -2.6, 0.3]], '#9aa0aa', 0.12)
  addLabel(g, 'USB: serial', [usbEnd[0] + 1.5, -2.2, 0.2], GREY, 0.2, 'left')
  if (o.sensors) {
    i2cBreakout(g, [spots.sensors[0], spots.sensors[1], 0], { name: 'ToF + OLED', k: 0.18 })
    cableRun(g, [v33, [v33[0], 1.6, 0.6], [spots.sensors[0] - 2.2, 1.6, 0.4]], '#d8322c', 0.06)
    addLabel(g, '60 mA on 3.3 V', [spots.sensors[0], spots.sensors[1] + 2, 0.2], GREY, 0.2)
  }
  const tp: Record<ResetTp, V3> = {
    pack: [packP[0], packP[1] + 0.4, 0.3],
    packGnd: [packM[0], packM[1] - 0.4, 0.3],
    rail: [RB.railX + 0.2, RB.yt, 0.3],
    gnd: [RB.railX + 0.6, RB.yb, 0.3],
    vin: vinPin,
    v33,
    usb: usbEnd,
  }
  const halos = Object.fromEntries((Object.keys(spots) as ResetPart[]).map((k) => [k, glowHalo(g, spots[k], k === 'esp' || k === 'motors' || k === 'source' ? 0.6 : 0.4)])) as Record<ResetPart, ReturnType<typeof glowHalo>>
  const bench = {
    group: g,
    tp,
    spots,
    source(kind: ResetSource) {
      for (const k of Object.keys(looks) as ResetSource[]) looks[k].visible = k === kind
    },
    lead(thin: boolean) {
      leads.thin.visible = thin
      leads.thick.visible = !thin
    },
    holdup: (on: boolean) => (holdG.visible = on),
    decoupling: (on: boolean) => (decoupG.visible = on),
    spin: (dt: number, f: number) => motorCans.forEach((m) => m.spin(dt, 400 * f)),
    glow: (part: ResetPart, f: number, c = HEAT) => halos[part].set(f, c),
    clearGlow: () => Object.values(halos).forEach((h) => h.set(0, HEAT)),
  }
  bench.source('4aa')
  bench.lead(false)
  return bench
}
