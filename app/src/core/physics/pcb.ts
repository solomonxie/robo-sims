// Printed circuit boards: stackups, IPC-2221 current capacity, copper loss, loop inductance, ratsnest, drilling.

const MU0 = 4e-7 * Math.PI
const RHO_CU = 1.72e-8
const ALPHA_CU = 0.00393
const MIL = 0.0254

export type LayerKind = 'silk' | 'mask' | 'copper' | 'core' | 'prepreg'

export interface BoardLayer {
  name: string
  kind: LayerKind
  mm: number
}

const cu = (name: string): BoardLayer => ({ name, kind: 'copper', mm: 0.035 })
const outer = (side: 'TOP' | 'BOTTOM'): BoardLayer[] => [
  { name: `${side} SILK`, kind: 'silk', mm: 0.015 },
  { name: `${side} MASK`, kind: 'mask', mm: 0.025 },
]

/** Top to bottom; both build a 1.6 mm board. */
export const STACKUPS = {
  two: [...outer('TOP'), cu('TOP COPPER'), { name: 'FR4 CORE', kind: 'core', mm: 1.45 }, cu('BOTTOM COPPER'), ...outer('BOTTOM').reverse()],
  four: [
    ...outer('TOP'),
    cu('TOP · SIGNAL'),
    { name: 'PREPREG', kind: 'prepreg', mm: 0.2 },
    cu('INNER 1 · GND'),
    { name: 'FR4 CORE', kind: 'core', mm: 0.98 },
    cu('INNER 2 · POWER'),
    { name: 'PREPREG', kind: 'prepreg', mm: 0.2 },
    cu('BOTTOM · SIGNAL'),
    ...outer('BOTTOM').reverse(),
  ],
} satisfies Record<string, BoardLayer[]>

export const stackMm = (layers: BoardLayer[]) => layers.reduce((s, l) => s + l.mm, 0)

/** Copper foil thickness, µm: 1 oz/ft² ≈ 35 µm. */
export const copperUm = (oz: number) => 34.8 * oz

/** Trace cross-section, mil². */
export const traceAreaMil2 = (widthMm: number, oz: number) => (widthMm / MIL) * (copperUm(oz) / 1000 / MIL)

/** Via barrel cross-section, mil²: an annulus of plating inside the drilled hole. */
export const viaAreaMil2 = (drillMm: number, platingUm = 25) => {
  const r = drillMm / 2 / MIL
  const t = platingUm / 1000 / MIL
  return Math.PI * (r * r - (r - t) ** 2)
}

const ipcK = (inner: boolean) => (inner ? 0.024 : 0.048)

/** IPC-2221: I = k·ΔT^0.44·A^0.725 (A in mil², k 0.048 outer / 0.024 inner). */
export const ipcAmps = (areaMil2: number, riseC: number, inner = false) => ipcK(inner) * riseC ** 0.44 * areaMil2 ** 0.725

/** IPC-2221 solved for the temperature rise. */
export const ipcRise = (amps: number, areaMil2: number, inner = false) => (amps / (ipcK(inner) * areaMil2 ** 0.725)) ** (1 / 0.44)

/** Narrowest trace, mm, that carries `amps` within `riseC`. */
export const ipcWidthMm = (amps: number, riseC: number, oz: number, inner = false) => {
  const area = (amps / (ipcK(inner) * riseC ** 0.44)) ** (1 / 0.725)
  return (area / (copperUm(oz) / 1000 / MIL)) * MIL
}

/** Copper resistance of `lengthMm` with cross-section `areaMil2`. */
export const copperOhms = (lengthMm: number, areaMil2: number, tempC = 25) =>
  (RHO_CU * (1 + ALPHA_CU * (tempC - 20)) * (lengthMm / 1000)) / (areaMil2 * (MIL / 1000) ** 2)

/** Self-inductance of a w × h rectangular loop of round conductor radius a (all m). */
export function loopInductance(w: number, h: number, a: number) {
  const d = Math.hypot(w, h)
  return (MU0 / Math.PI) * (-2 * (w + h) + 2 * d - h * Math.asinh(h / w) - w * Math.asinh(w / h) + h * Math.log((2 * h) / a) + w * Math.log((2 * w) / a))
}

/** Return-current density in a plane at distance x from under a trace h above it, per unit width (integrates to 1). */
export const returnDensity = (x: number, h: number) => 1 / (Math.PI * h * (1 + (x / h) ** 2))

/** Share of the return current within ±k·h of the trace centreline. */
export const returnWithin = (k: number) => (2 / Math.PI) * Math.atan(k)

/** Minimum spanning tree (Prim) over 2-D points: the shortest ratsnest joining one net. */
export function mstEdges(points: [number, number][]): [number, number][] {
  if (points.length < 2) return []
  const dist = (i: number, j: number) => Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1])
  const inTree = [0]
  const edges: [number, number][] = []
  while (inTree.length < points.length) {
    let best: [number, number] = [-1, -1]
    let bestD = Infinity
    for (const i of inTree)
      for (let j = 0; j < points.length; j++) {
        if (inTree.includes(j)) continue
        const d = dist(i, j)
        if (d < bestD) [bestD, best] = [d, [i, j]]
      }
    edges.push(best)
    inTree.push(best[1])
  }
  return edges
}

type Seg = [[number, number], [number, number]]
const orient = (a: [number, number], b: [number, number], c: [number, number]) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))

/** True when two segments properly cross (shared endpoints don't count). */
export const segmentsCross = ([a, b]: Seg, [c, d]: Seg) =>
  orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0

export const crossings = (segs: Seg[]) => segs.reduce((n, s, i) => n + segs.slice(i + 1).filter((t) => segmentsCross(s, t)).length, 0)

/** Copper left around a drilled hole on its pad, mm; below 0 the drill breaks out of the pad. */
export const annularRing = (padMm: number, drillMm: number, offsetMm = 0) => (padMm - drillMm) / 2 - offsetMm

/** Boards that fit on a panel in a grid, either orientation; `gap` between boards, `rail` border. */
export function boardsPerPanel(panel: [number, number], board: [number, number], gap: number, rail: number) {
  const fit = (pw: number, ph: number, bw: number, bh: number) =>
    Math.floor((pw - 2 * rail + gap) / (bw + gap)) * Math.floor((ph - 2 * rail + gap) / (bh + gap))
  const [pw, ph] = panel
  const [bw, bh] = board
  return Math.max(0, Math.max(fit(pw, ph, bw, bh), fit(pw, ph, bh, bw)))
}
