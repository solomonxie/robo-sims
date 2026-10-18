// Printer heaters: hotend (cartridge → block → thermistor) and bed plate strip, Marlin-style bang-bang / PID / M303 relay autotune,
// thermal runaway watchdog; part cooling of a small tower layer by layer.
import { clamp } from '../common'
import { bangBang } from '../control/bangbang'
import { Gains, PID_MEM0, PidMem, pidTick, zieglerNichols } from '../control/pid'
import { FILAMENTS } from './filaments'
import { GCODE_HEAT } from './gcode'

const AMB = GCODE_HEAT.ambient
const PWM = 255

export interface HeaterPlant {
  read(): number
  actual(): number
  step(duty: number, dt: number, t: number): void
  extra?(): number[]
}

export type HeatCtrl = { kind: 'bang'; band: number; every?: number } | { kind: 'pid'; gains: Gains } | { kind: 'relay'; cycles?: number }
/** Marlin defaults: runaway once at target (`period` s below target − `hyst`), heating watch (+`watchRise` °C every `watchS` s), MAXTEMP. */
export interface Watchdog { period: number; hyst: number; watchS: number; watchRise: number; maxC: number }
export const MARLIN_WATCH: Watchdog = { period: 40, hyst: 4, watchS: 20, watchRise: 2, maxC: 275 }

export interface HeaterFrame { t: number; read: number; actual: number; duty: number; p: number; i: number; d: number; x: number[] }
export interface RelayTune { ku: number; tu: number; gains: Gains; doneAt: number; amp: number; d: number }
export interface HeaterRun { frames: HeaterFrame[]; dt: number; keep: number; halt: { t: number; why: string } | null; peak: number; tune: RelayTune | null }

/** Marlin PID: full on/off more than `band` °C from target (integral reset), else PID with D on measurement, integral held in 0…255. */
function marlinPid(mem: PidMem, sp: number, meas: number, g: Gains, dt: number, band = 10) {
  const e = sp - meas
  if (Math.abs(e) > band) return { mem: { ...PID_MEM0, prevMeas: meas }, duty: e > 0 ? 1 : 0, p: 0, i: 0, d: 0 }
  const r = pidTick(mem, sp, meas, { ...g, limit: PWM, dOnMeas: true, dTau: 1 }, dt)
  const m = { ...r.mem, integ: clamp(r.mem.integ, 0, PWM) }
  return { mem: m, duty: clamp(r.terms.p + m.integ + r.terms.d, 0, PWM) / PWM, p: r.terms.p, i: m.integ, d: r.terms.d }
}

/** Runs `plant` toward `setC`; relay = M303 (bias/d adjust, Ku = 4d/(π·a), classic ZN), then holds with the found gains (U1). */
export function heaterRun(plant: HeaterPlant, o: { ctrl: HeatCtrl; setC: number; seconds: number; dt: number; watch?: Watchdog | null; keep?: number }): HeaterRun {
  const { setC, dt } = o
  const keep = o.keep ?? 1
  const frames: HeaterFrame[] = []
  let halt: HeaterRun['halt'] = null
  let tune: RelayTune | null = null
  let mem = PID_MEM0
  let on = false
  let duty = 0
  let peak = plant.actual()
  const rl = { heating: true, bias: PWM / 2, d: PWM / 2, t1: 0, t2: 0, hi: 0, lo: 0, max: setC, min: setC, cycles: 0 }
  const w = o.watch
  const watch = { until: NaN, target: NaN, stable: false, timer: Infinity }
  const arm = (t: number, r: number) => {
    if (w && r < setC - (w.watchRise + w.hyst + 1)) [watch.until, watch.target] = [t + w.watchS, r + w.watchRise]
    else watch.until = NaN
  }
  if (w) arm(0, plant.read())
  for (let k = 0; k * dt <= o.seconds + 1e-9; k++) {
    const t = k * dt
    const r = plant.read()
    let terms = { p: 0, i: 0, d: 0 }
    if (w && !halt) {
      if (r > w.maxC) halt = { t, why: 'MAXTEMP' }
      else if (t >= watch.until) {
        if (r < watch.target) halt = { t, why: 'Heating failed' }
        else arm(t, r)
      } else if (!watch.stable && r >= setC) [watch.stable, watch.timer] = [true, t + w.period]
      else if (watch.stable) {
        if (r >= setC - w.hyst) watch.timer = t + w.period
        else if (t > watch.timer) halt = { t, why: 'Thermal runaway' }
      }
    }
    const c = o.ctrl
    if (halt) duty = 0
    else if (c.kind === 'bang') {
      if (k % Math.max(1, Math.round((c.every ?? dt) / dt)) === 0) on = bangBang(on, r, setC, c.band)
      duty = on ? 1 : 0
    } else if (c.kind === 'relay' && !tune) {
      rl.max = Math.max(rl.max, r)
      rl.min = Math.min(rl.min, r)
      if (rl.heating && r > setC && t > rl.t2 + 5) [rl.heating, rl.t1, rl.hi, rl.max] = [false, t, t - rl.t2, setC]
      if (!rl.heating && r < setC && t > rl.t1 + 5) {
        ;[rl.heating, rl.t2, rl.lo] = [true, t, t - rl.t1]
        if (rl.cycles > 0) {
          rl.bias = clamp(rl.bias + (rl.d * (rl.hi - rl.lo)) / (rl.lo + rl.hi), 20, PWM - 20)
          rl.d = rl.bias > PWM / 2 ? PWM - 1 - rl.bias : rl.bias
          if (rl.cycles >= (c.cycles ?? 5)) {
            const amp = (rl.max - rl.min) / 2
            const ku = (4 * rl.d) / (Math.PI * amp)
            const tu = rl.lo + rl.hi
            tune = { ku, tu, gains: zieglerNichols(ku, tu, 'classic'), doneAt: t, amp, d: rl.d }
          }
        }
        rl.cycles++
        rl.min = setC
      }
      duty = (rl.bias + (rl.heating ? rl.d : -rl.d)) / PWM
    } else {
      const g = c.kind === 'pid' ? c.gains : tune!.gains
      const s = marlinPid(mem, setC, r, g, dt)
      ;[mem, duty, terms] = [s.mem, s.duty, s]
    }
    if (k % keep === 0) frames.push({ t, read: r, actual: plant.actual(), duty, p: terms.p, i: terms.i, d: terms.d, x: plant.extra?.() ?? [] })
    plant.step(duty, dt, t)
    peak = Math.max(peak, plant.actual())
  }
  return { frames, dt, keep, halt, peak, tune }
}

export const heaterAt = (run: HeaterRun, t: number) => run.frames[clamp(Math.round(t / (run.dt * run.keep)), 0, run.frames.length - 1)]

// --- Hotend: 40 W cartridge → aluminium block (GCODE_HEAT.nozzle: max, τ) → thermistor bead. ---

/** Typical V6-style hotend. Faults: thermistor out of the block, cartridge dropping to `weak` power, part fan blowing on a bare block. */
export const HOTEND = { watts: 40, cartJPerK: 2, cartWPerK: 0.5, sensorTau: 2.5, looseTau: 12, looseC: 45, ductWPerK: 0.03, bareWPerK: 0.125, weak: 0.3, dt: 0.1 }
export const HOTEND_LOSS = HOTEND.watts / (GCODE_HEAT.nozzle.max - AMB)
const BLOCK_J = HOTEND_LOSS * GCODE_HEAT.nozzle.tau
export const HOTEND_FAULTS = { none: 'Normal print', loose: 'Thermistor fell out', heater: 'Heater cartridge failing', fan: 'Fan blowing on bare block' }
export type HotendFault = keyof typeof HOTEND_FAULTS

export interface HotendCfg { fanAt?: number; fan?: number; fault?: HotendFault; faultAt?: number; startC?: number }
export function hotendPlant(c: HotendCfg = {}): HeaterPlant {
  const H = HOTEND
  const s = { cart: c.startC ?? AMB, block: c.startC ?? AMB, sense: c.startC ?? AMB }
  const fault = (t: number, f: HotendFault) => c.fault === f && t >= (c.faultAt ?? Infinity)
  return {
    read: () => s.sense,
    actual: () => s.block,
    extra: () => [s.cart],
    step(duty, dt, t) {
      const w = duty * H.watts * (fault(t, 'heater') ? H.weak : 1)
      const loss = HOTEND_LOSS + (t >= (c.fanAt ?? Infinity) ? (c.fan ?? 0) * H.ductWPerK : 0) + (fault(t, 'fan') ? H.bareWPerK : 0)
      const q = H.cartWPerK * (s.cart - s.block)
      s.cart += ((w - q) * dt) / H.cartJPerK
      s.block += ((q - loss * (s.block - AMB)) * dt) / BLOCK_J
      s.sense += fault(t, 'loose') ? (H.looseC - s.sense) * (dt / H.looseTau) : (s.block - s.sense) * (dt / H.sensorTau)
    },
  }
}

export const hotendRun = (ctrl: HeatCtrl, setC: number, seconds: number, cfg: HotendCfg = {}, watch: Watchdog | null = null) =>
  heaterRun(hotendPlant(cfg), { ctrl, setC, seconds, dt: HOTEND.dt, watch })

/** Settled behaviour after `from` s: mean, swing (max − min) and the lowest reading. */
export function holdStats(run: HeaterRun, from: number, to = Infinity) {
  const fs = run.frames.filter((f) => f.t >= from && f.t <= to)
  const ys = fs.map((f) => f.read)
  return { mean: ys.reduce((a, b) => a + b, 0) / Math.max(1, ys.length), swing: Math.max(...ys) - Math.min(...ys), min: Math.min(...ys), max: Math.max(...ys) }
}

/** M303-style autotune of the stock hotend at `setC`. */
export const hotendTune = (setC: number) => hotendRun({ kind: 'relay' }, setC, 400).tune

// --- Heated bed: a strip from the centre to the edge (aluminium + steel sheet), heater pad short of the edge, thermistor at the centre. ---

export const BED = { jPerM2K: 9250, kT: 0.5, topH: 18, margin: 0.012, edgeWPerMK: 0.3, cells: 10, dt: 0.2, sensorTau: 3, hyst: 2, every: 5 }
export const BED_HEATERS = {
  dc12: { name: '12 V PCB bed, 0.26 W/cm²', wPerCm2: 0.26, volts: 12 },
  dc24: { name: '24 V PCB bed, 0.45 W/cm²', wPerCm2: 0.45, volts: 24 },
  ac: { name: 'Mains silicone pad + SSR, 0.8 W/cm²', wPerCm2: 0.8, volts: 230 },
}
export type BedHeater = keyof typeof BED_HEATERS
/** Loss through the underside, W/m²K, typical. */
export const BED_INSUL = { none: { name: 'Bare underside', h: 16 }, cork: { name: 'Cork sheet', h: 5 }, foam: { name: 'Foil-backed foam', h: 2 } }
export type BedInsul = keyof typeof BED_INSUL
export interface BedCfg { sizeMm: number; heater: BedHeater; insul: BedInsul }

export const bedWatts = (c: BedCfg) => BED_HEATERS[c.heater].wPerCm2 * ((c.sizeMm - 2 * BED.margin * 1000) / 10) ** 2

export function bedPlant(c: BedCfg): HeaterPlant {
  const N = BED.cells
  const dx = c.sizeMm / 2000 / N
  const T = Array<number>(N).fill(AMB)
  const h = BED.topH + BED_INSUL[c.insul].h
  const q = BED_HEATERS[c.heater].wPerCm2 * 1e4
  const heated = Array.from({ length: N }, (_, i) => clamp((c.sizeMm / 2000 - BED.margin - i * dx) / dx, 0, 1))
  const g = BED.kT / dx
  const cap = BED.jPerM2K * dx
  const s = { sense: AMB }
  return {
    read: () => s.sense,
    actual: () => T[0],
    extra: () => [...T],
    step(duty, dt) {
      const flow = T.map((v, i) => (i < N - 1 ? g * (v - T[i + 1]) : 0))
      for (let i = 0; i < N; i++) {
        const edge = i === N - 1 ? BED.edgeWPerMK * (T[i] - AMB) : 0
        T[i] += ((duty * q * heated[i] * dx - h * dx * (T[i] - AMB) - flow[i] + (i > 0 ? flow[i - 1] : 0) - edge) * dt) / cap
      }
      s.sense += (T[0] - s.sense) * (dt / BED.sensorTau)
    },
  }
}

const bedTuneMemo = new Map<string, Gains | null>()
/** M303 E-1 on this bed at `setC` (null when it cannot get there). */
export function bedTune(c: BedCfg, setC: number) {
  const key = `${c.sizeMm} ${c.heater} ${c.insul} ${setC}`
  if (!bedTuneMemo.has(key)) bedTuneMemo.set(key, heaterRun(bedPlant(c), { ctrl: { kind: 'relay' }, setC, seconds: 5400, dt: BED.dt, keep: 1e9 }).tune?.gains ?? null)
  return bedTuneMemo.get(key)!
}

export const BED_CTRLS = { bang: 'Bang-bang, ±2 °C every 5 s', pid: 'PID (M303 E-1 gains)' }
export type BedCtrl = keyof typeof BED_CTRLS
export function bedRun(c: BedCfg, ctrl: BedCtrl, setC: number, seconds = 900) {
  const g = ctrl === 'pid' ? bedTune(c, setC) : null
  const hc: HeatCtrl = g ? { kind: 'pid', gains: g } : { kind: 'bang', band: 2 * BED.hyst, every: BED.every }
  const run = heaterRun(bedPlant(c), { ctrl: hc, setC, seconds, dt: BED.dt, keep: 5 })
  const reach = run.frames.find((f) => f.read >= setC - 1)?.t ?? null
  const last = run.frames[run.frames.length - 1].x
  return { run, reach, gains: g, edgeDrop: last[0] - last[last.length - 1], watts: bedWatts(c), amps: bedWatts(c) / BED_HEATERS[c.heater].volts }
}

// --- Part cooling: a 20 mm tower; each new 0.2 mm layer lands hot on the one below, which must be under Tg by then. ---

export const TOWER = { mm: 20, layerMm: 0.2, layers: 30, dt: 0.05, layerWPerM2K: 1000, stillH: 10, fanH: 110, beadDrop: 15 }
/** Relative shrink per °C frozen in below Tg (PLA = 1), typical. */
export const COOL_SHRINK = { pla: 1, petg: 1.3, asa: 2.2 }
export const COOL_FILAMENTS = { pla: FILAMENTS.pla.name, petg: FILAMENTS.petg.name, asa: FILAMENTS.asa.name }
export type CoolFilament = keyof typeof COOL_FILAMENTS

export function coolRun(mat: CoolFilament, fan: number, layerS: number, layers = TOWER.layers) {
  const f = FILAMENTS[mat]
  const air = f.enclosure ? 40 : AMB
  const lay = f.nozzleC - TOWER.beadDrop
  const capA = FILAMENTS[mat].rho * 1000 * 1800 * TOWER.layerMm * 1e-3
  const h = TOWER.stillH + TOWER.fanH * fan
  const side = (4 * TOWER.layerMm) / TOWER.mm
  const g = TOWER.layerWPerM2K
  const T: number[] = []
  const steps = Math.round(layerS / TOWER.dt)
  const tops: { t: number; c: number; col: number[] }[] = []
  const arrive: number[] = []
  for (let L = 0; L < layers; L++) {
    if (L > 0) arrive.push(T[T.length - 1])
    T.push(lay)
    for (let k = 0; k < steps; k++) {
      const n = T.length
      const flow = T.map((v, i) => (i > 0 ? g * (v - T[i - 1]) : g * (v - f.bedC)))
      for (let i = 0; i < n; i++) {
        const out = h * (T[i] - air) * (side + (i === n - 1 ? 1 : 0))
        T[i] += ((-flow[i] + (i < n - 1 ? flow[i + 1] : 0) - out) * TOWER.dt) / capA
      }
      if (k % 10 === 0) tops.push({ t: (L * steps + k) * TOWER.dt, c: T[n - 1], col: T.slice(-16) })
    }
  }
  const tArr = arrive[arrive.length - 1]
  return { tops, dt: TOWER.dt * 10, total: layers * steps * TOWER.dt, arrive, tArr, lay, air, tg: f.tgC, soft: tArr > f.tgC, shrink: COOL_SHRINK[mat] * Math.max(0, f.tgC - tArr), column: [...T] }
}

/** Shortest layer time (s) at which the layer below is under Tg when the next lands. */
export function minLayerS(mat: CoolFilament, fan: number) {
  if (coolRun(mat, fan, 60, 12).soft) return Infinity
  let [lo, hi] = [0.5, 60]
  for (let k = 0; k < 10; k++) {
    const mid = (lo + hi) / 2
    if (coolRun(mat, fan, mid, 12).soft) lo = mid
    else hi = mid
  }
  return hi
}
