// FDM hotend: filament through the cold zone, heat break and melt zone; flow = line width × layer height × speed.
import { TAU } from '../common'

export const FILAMENT_D = 1.75
export const filamentArea = (d = FILAMENT_D) => (Math.PI * d * d) / 4
/** PLA core temperature that still flows freely through a 0.4 mm nozzle (typical). */
export const PLA_FLOW_C = 185
export const LINE_W = 0.45

/** Melt length (mm) and heating time constant τ (s) of the filament core, typical. */
export const HOTENDS = {
  v6: { name: 'Standard (V6-style)', meltMm: 11, tau: 1.34 },
  volcano: { name: 'Long melt zone (Volcano)', meltMm: 20, tau: 1.34 },
  highflow: { name: 'High-flow split-bore nozzle', meltMm: 16, tau: 0.65 },
}
export type HotendKey = keyof typeof HOTENDS

/** Path from the drive gears down (mm): gears, cold zone (heatsink), heat break, heater block to the nozzle tip. */
export const hotendZones = (h: HotendKey) => {
  const block = 30
  return { gears: [0, 6], cold: [6, 26], brk: [26, block], hot: [block, block + HOTENDS[h].meltMm], tip: block + HOTENDS[h].meltMm }
}
const T_ROOM = 25
const T_BREAK_OUT = 60

/** Core temperature of the filament s mm along the path at feed `feed` mm/s with the block at `blockC`. */
export function coreTempAt(h: HotendKey, blockC: number, feed: number, s: number) {
  const z = hotendZones(h)
  if (s < z.brk[0]) return T_ROOM
  if (s < z.brk[1]) return T_ROOM + ((s - z.brk[0]) / (z.brk[1] - z.brk[0])) * (T_BREAK_OUT - T_ROOM)
  if (feed <= 0) return blockC
  return blockC - (blockC - T_BREAK_OUT) * Math.exp(-(s - z.hot[0]) / (feed * HOTENDS[h].tau))
}

/** Metal temperature along the path: fan-cooled heatsink, steep heat break, hot block. */
function metalTempAt(h: HotendKey, blockC: number, s: number) {
  const z = hotendZones(h)
  if (s < z.cold[0]) return 30
  if (s < z.cold[1]) return 40 + ((s - z.cold[0]) / (z.cold[1] - z.cold[0])) * 10
  if (s < z.brk[1]) return 50 + ((s - z.brk[0]) / (z.brk[1] - z.brk[0])) * (blockC - 50)
  return blockC
}

/** Highest volumetric flow (mm³/s) whose core still reaches PLA_FLOW_C at the tip. */
export function maxFlow(h: HotendKey, blockC: number) {
  if (blockC <= PLA_FLOW_C) return 0
  const { meltMm, tau } = HOTENDS[h]
  return (meltMm / (tau * Math.log((blockC - T_BREAK_OUT) / (blockC - PLA_FLOW_C)))) * filamentArea()
}

interface FlowIn {
  hotend: HotendKey
  blockC: number
  speed: number
  layerH: number
  lineW?: number
}

export function flowView({ hotend, blockC, speed, layerH, lineW = LINE_W }: FlowIn) {
  const area = filamentArea()
  const Q = lineW * layerH * speed
  const feed = Q / area
  const maxQ = maxFlow(hotend, blockC)
  const z = hotendZones(hotend)
  const exitC = coreTempAt(hotend, blockC, feed, z.tip)
  const samples = 61
  const s = Array.from({ length: samples }, (_, i) => (i / (samples - 1)) * z.tip)
  return {
    area,
    Q,
    feed,
    maxQ,
    maxSpeed: maxQ / (lineW * layerH),
    exitC,
    ok: exitC >= PLA_FLOW_C,
    delivered: Q <= maxQ ? 1 : maxQ / Q,
    dwell: feed > 0 ? HOTENDS[hotend].meltMm / feed : Infinity,
    gearRpm: (feed / (TAU * 5.5)) * 60,
    zones: z,
    s,
    metal: s.map((x) => metalTempAt(hotend, blockC, x)),
    core: s.map((x) => coreTempAt(hotend, blockC, feed, x)),
  }
}
