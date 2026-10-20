// A hobby multimeter as circuit elements: the dial picks what it reads, the red lead's socket picks what it is between the
// probes (10 MΩ, an ohmmeter's test source, or a current shunt that's always there). Misuse falls out of the same circuit.
import { Element, NodalSolution, solveNodal } from '../../nodal'
import { Diode, diodeAmps, thermalVoltage } from '../semiconductors'
import { FUSES, fuseMeltTime } from '../protection'
import { METER_INPUT_OHMS } from '../dc'

/** Dial: V⎓, V~, mV⎓, Ω, continuity beeper, diode test, mA, A. */
export type DmmDial = 'vdc' | 'vac' | 'mv' | 'ohm' | 'beep' | 'diode' | 'ma' | 'amp'
/** Red lead's socket (black stays in COM): VΩ, mA (fused 400 mA), 10A. */
export type DmmJack = 'v' | 'ma' | 'a10'
export interface DmmSetup {
  dial: DmmDial
  jack: DmmJack
}

/** Autoranging hobby meter. Volts: 10 MΩ, OL past 600 V (600 mV on mV). Ω and the beeper: a 1 V source behind 1 kΩ,
 *  ratiometric (R = R_ref·V / (V_open − V)), OL past 40 MΩ; beeps under 30 Ω, silent over 50 Ω, chirps between. Diode test:
 *  3 V behind 2.2 kΩ (~1 mA), OL past 2 V. Current: the shunt (+ fuse) sits between its socket and COM on every dial;
 *  mA = 1.5 Ω behind F400mA, 10A = 15 mΩ behind F10A. Both test leads together: 0.2 Ω. A motor spins up in ~0.1 s. */
export const DMM = {
  vOhms: METER_INPUT_OHMS,
  vMax: 600,
  mvMax: 0.6,
  ohmOpenV: 1,
  ohmRef: 1e3,
  ohmMax: 40e6,
  diodeOpenV: 3,
  diodeOhms: 2.2e3,
  diodeMax: 2,
  beep: { on: 30, off: 50 },
  leadOhms: 0.2,
  ma: { ohms: 1.5, fuse: FUSES.F400mA, max: 0.4 },
  a10: { ohms: 0.015, fuse: FUSES.F10A, max: 10 },
  startS: 0.1,
}

/** The right setup for each kind of measurement. */
export type MeterWant = 'beep' | 'diode' | 'vdc' | 'amp'
export const DMM_RIGHT: Record<MeterWant, DmmSetup> = {
  beep: { dial: 'beep', jack: 'v' },
  diode: { dial: 'diode', jack: 'v' },
  vdc: { dial: 'vdc', jack: 'v' },
  amp: { dial: 'amp', jack: 'a10' },
}

interface NetDiode {
  a: number
  b: number
  d: Diode
}
/** A bench as a netlist (node 0 = ground); `diodes` anode a, cathode b. */
export interface MeterNet {
  nodes: number
  elements: Element[]
  diodes?: NetDiode[]
}

/** Nodal solve with Shockley diodes: Newton on each diode's companion model (conductance + current source at the last
 *  voltage), forward steps limited logarithmically so the exponential can't run away. Null if a solve fails. */
export function diodeNetSolve(nodes: number, elements: Element[], diodes: NetDiode[] = []): (NodalSolution & { diodeA: number[] }) | null {
  if (!diodes.length) {
    const s = solveNodal(nodes, elements)
    return s && { ...s, diodeA: [] }
  }
  const v = diodes.map(() => 0)
  let sol: NodalSolution | null = null
  for (let it = 0; it < 300; it++) {
    const els = [...elements]
    diodes.forEach((x, k) => {
      const nvt = x.d.ideality * thermalVoltage()
      const e = Math.exp(v[k] / nvt)
      const g = (x.d.saturationA * e) / nvt + 1e-12
      els.push({ kind: 'R', a: x.a, b: x.b, ohms: 1 / g }, { kind: 'I', a: x.a, b: x.b, amps: x.d.saturationA * (e - 1) - g * v[k] })
    })
    sol = solveNodal(nodes, els)
    if (!sol) return null
    let moved = 0
    diodes.forEach((x, k) => {
      const nvt = x.d.ideality * thermalVoltage()
      let nv = sol!.volts[x.a] - sol!.volts[x.b]
      if (nv > v[k] && nv > 0.2) nv = v[k] + nvt * Math.log1p((nv - v[k]) / nvt)
      moved = Math.max(moved, Math.abs(nv - v[k]))
      v[k] = nv
    })
    if (moved < 1e-9) break
  }
  return { ...sol!, diodeA: diodes.map((x, k) => diodeAmps(v[k], x.d)) }
}

type DmmUnit = 'V' | 'mV' | 'A' | 'Ω'
type DmmBeep = 'on' | 'chirp' | 'off'

export interface DmmResult {
  /** Display value in `unit`; null = OL. */
  shown: number | null
  unit: DmmUnit
  beep: DmmBeep
  /** Current through the meter, red → black, before any fuse goes. */
  amps: number
  /** Volts lost across the meter on a current socket (shunt + fuse + leads). */
  burden: number
  /** The meter's own fuse that melts (steady current or the motor's start), and when; null = none. */
  blown: DmmJack | null
  meltS: number
  /** The current that melts it (the start current when that's what does it). */
  meltA: number
  /** Node volts of the bench with the meter in (without it once its fuse has gone). */
  volts: number[]
}

const shuntOf = (jack: DmmJack) => (jack === 'ma' ? DMM.ma : jack === 'a10' ? DMM.a10 : null)
const unitOf = (dial: DmmDial): DmmUnit => (dial === 'mv' ? 'mV' : dial === 'ohm' || dial === 'beep' ? 'Ω' : dial === 'ma' || dial === 'amp' ? 'A' : 'V')

/** Solve `net` (a function of the last solution, so regulators can switch off or move their operating point; null =
 *  first pass) with `extra` elements on `extraNodes` more nodes, a few passes until it settles. */
function settle(net: (volts: number[] | null) => MeterNet, extra: (n: number) => Element[], extraNodes: number) {
  let volts: number[] | null = null
  let s: ReturnType<typeof diodeNetSolve> = null
  let base = 0
  for (let k = 0; k < 12; k++) {
    const n = net(volts)
    base = n.nodes
    s = diodeNetSolve(n.nodes + extraNodes, [...n.elements, ...extra(n.nodes)], n.diodes)
    if (!s) throw new Error('meter bench has no solution')
    const next = s.volts
    if (volts && next.every((x, i) => Math.abs(x - volts![i]) < 1e-7)) break
    volts = next
  }
  return { s: s!, base }
}

/** What the meter shows with `setup`, probes on `red` and `black` of the bench `net`. `inrush` = the same bench at the
 *  instant the meter closes it (a motor starting = stalled), for a current socket's fuse. */
export function dmmRead(setup: DmmSetup, net: (volts: number[] | null) => MeterNet, red: number, black: number, inrush?: (volts: number[] | null) => MeterNet): DmmResult {
  const { dial, jack } = setup
  const unit = unitOf(dial)
  const shunt = shuntOf(jack)
  const off = (volts: number[]): DmmResult => ({ shown: 0, unit, beep: 'off', amps: 0, burden: 0, blown: null, meltS: Infinity, meltA: 0, volts })
  if (shunt) {
    const ohms = shunt.ohms + DMM.leadOhms
    const through = (n: typeof net) => {
      const { s, base } = settle(n, () => [{ kind: 'R', a: red, b: black, ohms }], 0)
      return { amps: (s.volts[red] - s.volts[black]) / ohms, volts: s.volts.slice(0, base + 1) }
    }
    const run = through(net)
    const start = inrush ? Math.abs(through(inrush).amps) : 0
    const steadyS = fuseMeltTime(Math.abs(run.amps), shunt.fuse)
    const startS = fuseMeltTime(start, shunt.fuse)
    const meltS = startS < DMM.startS ? startS : steadyS
    const meltA = startS < DMM.startS ? start : Math.abs(run.amps)
    const blown = Number.isFinite(meltS) ? jack : null
    const reads = (dial === 'ma' && jack === 'ma') || (dial === 'amp' && jack === 'a10')
    const volts = blown ? settle(net, () => [], 0).s.volts : run.volts
    const shown = blown ? (unit === 'Ω' ? null : 0) : !reads ? (unit === 'Ω' || dial === 'diode' ? null : 0) : Math.abs(run.amps) > shunt.max ? null : run.amps
    return { shown, unit, beep: 'off', amps: run.amps, burden: Math.abs(run.amps) * ohms, blown, meltS, meltA, volts }
  }
  if (dial === 'ma' || dial === 'amp') return off(settle(net, () => [], 0).s.volts)
  if (dial === 'vdc' || dial === 'vac' || dial === 'mv') {
    const { s, base } = settle(net, () => [{ kind: 'R', a: red, b: black, ohms: DMM.vOhms }], 0)
    const vp = s.volts[red] - s.volts[black]
    const r = off(s.volts.slice(0, base + 1))
    // V~ is AC-coupled: a steady DC level reads 0.
    if (dial === 'vac') return r
    if (dial === 'mv') return { ...r, shown: Math.abs(vp) > DMM.mvMax ? null : vp * 1000 }
    return { ...r, shown: Math.abs(vp) > DMM.vMax ? null : vp }
  }
  // Ω, beeper, diode: the meter's own source pushes current out of red, through the bench, back into COM.
  const [openV, ref] = dial === 'diode' ? [DMM.diodeOpenV, DMM.diodeOhms] : [DMM.ohmOpenV, DMM.ohmRef]
  const { s, base } = settle(
    net,
    (n) => [
      { kind: 'V', a: n + 1, b: black, volts: openV },
      { kind: 'R', a: n + 1, b: n + 2, ohms: ref },
      { kind: 'R', a: n + 2, b: red, ohms: DMM.leadOhms },
    ],
    2,
  )
  const vj = s.volts[base + 2] - s.volts[black]
  const amps = (s.volts[base + 1] - s.volts[base + 2]) / ref
  const r = { ...off(s.volts.slice(0, base + 1)), amps }
  if (dial === 'diode') return { ...r, shown: vj > DMM.diodeMax || vj < -DMM.diodeMax ? null : vj }
  const ohms = (ref * vj) / (openV - vj)
  const shown = ohms < 0 || ohms > DMM.ohmMax || !Number.isFinite(ohms) ? null : ohms
  const beep: DmmBeep = dial !== 'beep' || shown === null ? 'off' : shown < DMM.beep.on ? 'on' : shown < DMM.beep.off ? 'chirp' : 'off'
  return { ...r, shown, beep }
}

/** Four-digit display text: 0L, 7.62, -1.70, 0.123 (A), 30.2 (mV), 10.0 (kΩ), 1.20 (MΩ). */
export function dmmText(r: DmmResult): string {
  if (r.shown === null) return '0L'
  const v = Math.abs(r.shown) < 5e-4 ? 0 : r.shown
  const a = Math.abs(v)
  const fix = (x: number, d: number) => x.toFixed(d)
  if (r.unit === 'Ω') return a >= 1e6 ? fix(v / 1e6, 2) : a >= 1e3 ? fix(v / 1e3, a >= 1e4 ? 1 : 2) : fix(v, a >= 100 ? 0 : 1)
  if (r.unit === 'A') return fix(v, a >= 10 ? 1 : 3)
  if (r.unit === 'mV') return fix(v, a >= 100 ? 0 : 1)
  return fix(v, a >= 100 ? 0 : a >= 10 ? 1 : 2)
}

/** Unit as printed next to the digits (kΩ / MΩ follow the value). */
export function dmmUnitText(r: DmmResult): string {
  if (r.unit !== 'Ω' || r.shown === null) return r.unit
  const a = Math.abs(r.shown)
  return a >= 1e6 ? 'MΩ' : a >= 1e3 ? 'kΩ' : 'Ω'
}

/** The reading as text with its unit: "7.62 V", "OL", "0.123 A", "10.0 kΩ". */
export const dmmReading = (r: DmmResult) => (r.shown === null ? 'OL' : `${dmmText(r)} ${dmmUnitText(r)}`)

/** What went wrong with this setup for a `want` measurement; null = a fair reading. `live` = the bench is powered,
 *  `series` = the probes bridge a gap (the meter is the only path), `com` = black isn't where the reading needs it. */
export type DmmMiss = 'short' | 'fuse' | 'jack' | 'dial' | 'range' | 'live' | 'com'
export function dmmMistake(want: MeterWant, s: DmmSetup, r: DmmResult, o: { live: boolean; series?: boolean; com?: boolean }): DmmMiss | null {
  const current = s.jack !== 'v'
  if (r.blown) return 'fuse'
  if (want !== 'amp') {
    if (current) return Math.abs(r.amps) > 0.5 ? 'short' : 'jack'
    if (want === 'vdc') {
      if (s.dial === 'ohm' || s.dial === 'beep' || s.dial === 'diode') return 'live'
      if (s.dial !== 'vdc' && s.dial !== 'mv') return 'dial'
      if (r.shown === null) return 'range'
      return o.com ? 'com' : null
    }
    if (o.live) return 'live'
    const ok = want === 'beep' ? s.dial === 'beep' || s.dial === 'ohm' : s.dial === 'diode'
    return ok ? null : 'dial'
  }
  if (s.dial !== 'ma' && s.dial !== 'amp') return 'dial'
  if (!current || (s.dial === 'ma') !== (s.jack === 'ma')) return 'jack'
  if (r.shown === null) return 'range'
  return o.series === false ? 'short' : null
}
