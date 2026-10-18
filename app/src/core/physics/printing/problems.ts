// Print problems: start from the symptom, rank the causes by how much fixing each alone helps; numbers from the calibration,
// adhesion, motion, hotend and filament models.
import { clamp, clamp01, sweep } from '../common'
import { AID_SWEEP, FIRST_LAYER, PROBE_Z, beadSection, cornerView, gripTempFactor, shrinkPull, zOffsetView } from './adhesion'
import { EXTRUDERS, RETRACT_SETUPS, RETRACT_TEST, beadWidth, gearSlip, retractView, towerBand } from './calibration'
import { FILAMENT_D, LINE_W, filamentArea, hotendZones, maxFlow } from './fdm'
import { FILAMENTS, FilamentKey, uptakePct } from './filaments'
import { CoolFilament } from './heaters'
import { driveForceN } from './motion'


export interface Cause<In> {
  name: string
  fix: Partial<In>
}
/** Badness (a continuous score, fine at or below `floor`) now, and how much each cause fixed alone takes off; the biggest drop is the culprit. */
export function rankCauses<In extends object>(base: In, score: (x: In) => number, causes: Record<string, Cause<In>>, floor = 0) {
  const now = score(base)
  const list = Object.entries(causes).map(([key, c]) => ({ key, name: c.name, gain: Math.max(0, now - Math.max(floor, score({ ...base, ...c.fix }))) }))
  const best = list.reduce((b, c) => (c.gain > b.gain ? c : b), list[0])
  return { now, floor, list, top: best.gain > 1e-6 ? best : null }
}

// --- Stringing: melt oozes during travel; hot nozzle, short retraction, wet filament and slow travel all add strings. ---

export const STRING_FILAMENTS: readonly FilamentKey[] = ['pla', 'petg', 'tpu', 'nylon']
/** Travel between the two towers (mm) and the travel time over which a string fully forms (s), typical. */
export const STRING_TEST = { travelMm: 40, formS: 0.4, travels: RETRACT_TEST.travels, okShare: 0.15, retractMmS: 40, goodRetract: RETRACT_SETUPS.direct.needMm }
interface StringIn {
  fil: FilamentKey
  dc: number
  retractMm: number
  wetDays: number
  travelMmS: number
}

/** Share of travels that leave a string (0…1) and its parts. */
function stringParts(s: StringIn) {
  const f = FILAMENTS[s.fil]
  const hot = towerBand(s.fil, f.nozzleC + s.dc).string
  const leak = retractView('direct', s.retractMm, STRING_TEST.retractMmS).string
  const wetPct = uptakePct(s.fil, s.wetDays)
  const steam = clamp01(wetPct / f.wetPct - 0.5)
  const ooze = clamp01(STRING_TEST.travelMm / Math.max(1, s.travelMmS) / STRING_TEST.formS)
  const raw = (0.25 + leak) * (0.15 + 1.5 * hot) * (0.4 + 0.6 * ooze) + 0.7 * steam
  return { hot, leak, wetPct, steam, ooze, raw, share: clamp01(raw) }
}
const stringShare = (s: StringIn) => stringParts(s).share
const stringRaw = (s: StringIn) => stringParts(s).raw

export function stringingView(s: StringIn) {
  const p = stringParts(s)
  const rank = rankCauses(s, stringRaw, {
    temp: { name: 'Nozzle too hot', fix: { dc: Math.min(s.dc, 0) } },
    retract: { name: 'Retraction too short', fix: { retractMm: Math.max(s.retractMm, STRING_TEST.goodRetract) } },
    wet: { name: 'Wet filament', fix: { wetDays: 0 } },
    travel: { name: 'Slow travel', fix: { travelMmS: Math.max(s.travelMmS, 200) } },
  }, STRING_TEST.okShare)
  const dcs = sweep(-20, 20, 41)
  return { ...p, count: Math.round(p.share * STRING_TEST.travels), rank, dcs, curve: dcs.map((dc) => stringShare({ ...s, dc })) }
}

// --- Warping: each layer shrinks as it cools below Tg and pulls the corners up; grip and brim hold them down. ---

/** Enclosure air with the bed on (°C), and the extra pull of a draft across the part, typical. */
export const WARP = { chamberC: 45, draftGain: 1.2, liftMm: 3, goodBrim: 8 }
interface WarpIn {
  mat: CoolFilament
  bedC: number
  enclosed: boolean
  draft: number
  brimMm: number
}

const cornerCache = new Map<string, ReturnType<typeof cornerView>>()
function cornerOf(mat: CoolFilament, brimMm: number) {
  const key = `${mat} ${brimMm}`
  let c = cornerCache.get(key)
  if (!c) cornerCache.set(key, (c = cornerView(mat, brimMm > 0 ? 'brim' : 'none', brimMm, 0)))
  return c
}

function warpForces(w: WarpIn) {
  const f = FILAMENTS[w.mat]
  const c = cornerOf(w.mat, w.brimMm)
  const hold = (c.hold * gripTempFactor(w.mat, w.bedC)) / gripTempFactor(w.mat, f.bedC)
  const air = w.enclosed ? WARP.chamberC : 25
  const pull = c.pull * clamp((f.tgC - air) / (f.tgC - 25), 0.1, 1) * (1 + WARP.draftGain * w.draft) * (shrinkPull(w.mat, w.bedC) / shrinkPull(w.mat, f.bedC))
  return { hold, pull }
}
/** Corner lift (mm): 0 while the hold beats the pull. */
const warpLift = (w: WarpIn) => {
  const { hold, pull } = warpForces(w)
  return clamp01(1 - hold / pull) * WARP.liftMm
}

const warpRatio = (w: WarpIn) => {
  const { hold, pull } = warpForces(w)
  return pull / hold
}

export function warpView(w: WarpIn) {
  const { hold, pull } = warpForces(w)
  const rank = rankCauses(w, warpRatio, {
    bed: { name: 'Bed too cool', fix: { bedC: Math.max(w.bedC, FILAMENTS[w.mat].bedC) } },
    draft: { name: 'Draft on the part', fix: { draft: 0 } },
    open: { name: 'No enclosure', fix: { enclosed: true } },
    brim: { name: 'No brim', fix: { brimMm: Math.max(w.brimMm, WARP.goodBrim) } },
  }, 1)
  const curve = AID_SWEEP.map((b) => warpForces({ ...w, brimMm: b }))
  return { hold, pull, margin: hold / pull, lift: warpLift(w), rank, brims: AID_SWEEP, holds: curve.map((c) => c.hold), pulls: curve.map((c) => c.pull) }
}

// --- Layer shift: a move demands more force than the stepper (or a loose belt) can give, so it skips; every layer above is offset. ---

/** Bed-slinger Y axis: moving bed + print (kg), rail friction and a nozzle strike on a curled overhang (N), mm per lost step group, typical. */
export const SHIFT = { kg: 1.5, frictionN: 5, curlN: 25, mmPerSkip: 0.8, mmPerTooth: 2, layers: 40, maxSkips: 6 }
/** Force (N) before the belt jumps a pulley tooth, typical. */
export const BELT_TENSION = {
  tight: { name: 'Belt tight', jumpN: 90 },
  slack: { name: 'Belt slack', jumpN: 30 },
  loose: { name: 'Belt loose', jumpN: 14 },
}
export type BeltTension = keyof typeof BELT_TENSION
interface ShiftIn {
  speed: number
  accel: number
  amps: number
  belt: BeltTension
  curl: boolean
}

function shiftForces(s: ShiftIn) {
  const need = (SHIFT.kg * s.accel) / 1000 + SHIFT.frictionN + (s.curl ? SHIFT.curlN : 0)
  const motor = driveForceN('belt', s.speed, s.amps)
  const belt = BELT_TENSION[s.belt].jumpN
  return { need, motor, belt, limit: Math.min(motor, belt), byBelt: belt < motor }
}
/** Offset (mm) of the layers above the skip: groups of 4 full steps lost at the motor, whole teeth at a loose belt. */
function shiftMm(s: ShiftIn) {
  const f = shiftForces(s)
  if (f.need <= f.limit) return 0
  const skips = Math.min(SHIFT.maxSkips, Math.ceil((f.need / Math.max(1e-6, f.limit) - 1) * 4))
  return skips * (f.byBelt ? SHIFT.mmPerTooth : SHIFT.mmPerSkip)
}

export const SHIFT_SPEEDS = sweep(20, 600, 59)
export function shiftView(s: ShiftIn) {
  const f = shiftForces(s)
  const rank = rankCauses(s, (x: ShiftIn) => shiftForces(x).need / shiftForces(x).limit, {
    accel: { name: 'Acceleration too high', fix: { accel: Math.min(s.accel, 3000) } },
    speed: { name: 'Travel too fast', fix: { speed: Math.min(s.speed, 250) } },
    amps: { name: 'Driver current too low', fix: { amps: Math.max(s.amps, 1.1) } },
    belt: { name: 'Loose belt', fix: { belt: 'tight' } },
    curl: { name: 'Nozzle hits a curled edge', fix: { curl: false } },
  }, 1)
  return { ...f, mm: shiftMm(s), rank, motors: SHIFT_SPEEDS.map((v) => driveForceN('belt', v, s.amps)) }
}

// --- Under-extrusion: the delivered flow falls short of what the slicer asks; the losses stack from the gear to the tip. ---

export const UNDER_FAULTS = { none: 'No fault', clog: 'Partial clog', gear: 'Gear slipping (worn, loose idler)', diameter: 'Filament is 1.65 mm' }
export type UnderFault = keyof typeof UNDER_FAULTS
/** Share of melt flow a partial clog leaves, grip of a worn gear (N), the thin filament (mm), typical. */
export const UNDER = { clogKeep: 0.4, wornGripN: 14, thinMm: 1.65, layerH: 0.2 }
export const UNDER_SPEEDS = sweep(10, 200, 39)

function underFlow(fault: UnderFault, speed: number, blockC: number) {
  const want = LINE_W * UNDER.layerH * speed
  const diam = fault === 'diameter' ? (UNDER.thinMm / FILAMENT_D) ** 2 : 1
  const healthy = gearSlip('mk8', want / filamentArea())
  const slip = fault === 'gear' ? gearSlip('mk8', want / filamentArea(), UNDER.wornGripN) : healthy
  const capClean = maxFlow('v6', blockC)
  const cap = fault === 'clog' ? capClean * UNDER.clogKeep : capClean
  const fed = want * diam * (1 - slip)
  const got = Math.min(fed, cap)
  const lost = { melt: want * diam * healthy + Math.max(0, fed - capClean), clog: Math.max(0, Math.min(fed, capClean) - cap), gear: want * diam * (slip - healthy), diameter: want * (1 - diam) }
  return { want, got, ratio: got / Math.max(1e-9, want), cap, capClean, slip, diam, lost }
}

export function underView(fault: UnderFault, speed: number, blockC: number) {
  const u = underFlow(fault, speed, blockC)
  const area = beadSection(UNDER.layerH, LINE_W, UNDER.layerH).area
  const wallMm = beadWidth(area * u.ratio, UNDER.layerH)
  const spacing = LINE_W - UNDER.layerH * (1 - Math.PI / 4)
  const curve = UNDER_SPEEDS.map((v) => underFlow(fault, v, blockC))
  return { ...u, wallMm, spacing, gapMm: Math.max(0, spacing - wallMm), wants: curve.map((c) => c.want), gots: curve.map((c) => c.got), maxSpeed: u.cap / (LINE_W * UNDER.layerH) }
}

// --- Elephant foot: the first layers bulge out from squish, a bed that keeps them soft, and the weight above. ---

/** Bulge from a soft bottom (mm at full softness), the layers it spans, a fit tolerance (mm), typical. */
export const FOOT = { softMm: 0.2, softSpanC: 20, layers: 4, fitMm: 0.15, goodChamfer: 0.5 }
interface FootIn {
  mat: CoolFilament
  zOffset: number
  bedC: number
  chamfer: number
}
export function footParts(e: FootIn) {
  const tg = FILAMENTS[e.mat].tgC
  const squish = zOffsetView(e.zOffset).footMm
  const soft = FOOT.softMm * clamp01((e.bedC - tg + 10) / FOOT.softSpanC)
  const bulge = squish + soft
  return { squish, soft, bulge, left: Math.max(0, bulge - e.chamfer) }
}
const footLeft = (e: FootIn) => footParts(e).left
const FOOT_ZS = sweep(PROBE_Z.trueMm - 0.15, PROBE_Z.trueMm + 0.1, 26)

export function footView(e: FootIn) {
  const p = footParts(e)
  const rank = rankCauses(e, footLeft, {
    z: { name: 'Nozzle too close (Z offset)', fix: { zOffset: Math.max(e.zOffset, PROBE_Z.trueMm) } },
    bed: { name: 'Bed too hot', fix: { bedC: Math.min(e.bedC, FILAMENTS[e.mat].bedC - 5) } },
    chamfer: { name: 'No chamfer on the bottom edge', fix: { chamfer: Math.max(e.chamfer, FOOT.goodChamfer) } },
  }, FOOT.fitMm)
  return { ...p, gap: zOffsetView(e.zOffset).gap, rank, fits: p.left <= FOOT.fitMm, zs: FOOT_ZS, curve: FOOT_ZS.map((z) => footParts({ ...e, zOffset: z }).bulge), firstH: FIRST_LAYER.h }
}

// --- Clogged nozzle: heat creeps up past the heat break, soft filament swells and sticks; the push needed grows until the gear gives up. ---

export const CLOG_FILAMENTS: readonly CoolFilament[] = ['pla', 'petg', 'asa']
/** Heatsink rise over the air with the fan full (°C), push needed by a clean hotend and the plug growth rate (N, N/min), typical. */
export const CLOG = { sinkRiseC: 25, cleanN: 12, growN: 3, creepSpanC: 25, minutes: 60 }

interface ClogIn {
  mat: CoolFilament
  fan: number
  airC: number
  retractMm: number
}
/** Heatsink temperature: air + the rise, worse as the heat-break fan slows. */
const heatsinkC = (c: Pick<ClogIn, 'fan' | 'airC'>) => c.airC + CLOG.sinkRiseC / (0.2 + 0.8 * clamp01(c.fan))
function clogParts(c: ClogIn) {
  const sink = heatsinkC(c)
  const creep = clamp01((sink - FILAMENTS[c.mat].tgC) / CLOG.creepSpanC)
  const jam = retractView('direct', c.retractMm, STRING_TEST.retractMmS).jam
  return { sink, creep, jam, rate: creep + 0.6 * jam }
}
const clogRate = (c: ClogIn) => clogParts(c).rate

/** Push needed over time (N) against the gear grip, flow while it keeps up, minutes to a full clog (Infinity if never). */
export function clogView(c: ClogIn) {
  const p = clogParts(c)
  const grip = EXTRUDERS.mk8.gripN
  const perMin = CLOG.growN * p.rate
  const stopMin = perMin > 0 ? (grip - CLOG.cleanN) / perMin : Infinity
  const ts = sweep(0, CLOG.minutes, 61)
  const push = ts.map((t) => Math.min(grip * 1.2, CLOG.cleanN + perMin * t))
  const flow = ts.map((t) => clamp01((stopMin - t) / 2))
  const rank = rankCauses(c, clogRate, {
    fan: { name: 'Heat-break fan weak', fix: { fan: 1 } },
    air: { name: 'Hot enclosure', fix: { airC: Math.min(c.airC, 25) } },
    retract: { name: 'Retraction too long', fix: { retractMm: Math.min(c.retractMm, RETRACT_SETUPS.direct.safeMm) } },
  })
  return { ...p, grip, perMin, stopMin, ts, push, flow, rank, zones: hotendZones('v6'), tg: FILAMENTS[c.mat].tgC }
}
