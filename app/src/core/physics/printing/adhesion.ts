// Bed adhesion: bed height map and levelling (paper, 3-point plane, mesh), first-layer bead vs Z offset, build-surface grip, brim/ears/raft at a peeling corner.
import { clamp, clamp01, gaussRng, parkMiller } from '../common'
import { planeFit } from '../math/linearalgebra'
import { FILAMENTS } from './filaments'
import { COOL_SHRINK, CoolFilament } from './heaters'

/** Typical first layer for a 0.4 mm nozzle. */
export const FIRST_LAYER = { h: 0.2, w: 0.45 }

// --- First-layer bead: fixed volume per mm, squeezed into the nozzle-to-bed gap. ---

/** Cross-section of one first-layer line laid at `gapMm`: round strand if the gap is above its free diameter, else a stadium `h` × `w`. */
export function beadSection(gapMm: number, w = FIRST_LAYER.w, h = FIRST_LAYER.h) {
  const area = (w - h) * h + (Math.PI * h * h) / 4
  const dFree = Math.sqrt((4 * area) / Math.PI)
  const gap = Math.max(0.02, gapMm)
  const round = gap >= dFree
  const bh = round ? dFree : gap
  const bw = round ? dFree : (area - (Math.PI * bh * bh) / 4) / bh + bh
  const contact = round ? 0.3 * dFree * clamp01(dFree / gap) ** 2 : bw - bh
  const fuse = bw - w
  const state = gap > 1.3 * h ? 'gaps' : gap > 0.8 * h ? 'good' : gap > 0.45 * h ? 'squished' : 'scraping'
  return { area, dFree, round, h: bh, w: bw, contact, fuse, squish: 1 - bh / dFree, ridge: Math.max(0, fuse - 0.25 * w), state: state as 'gaps' | 'good' | 'squished' | 'scraping' }
}

// --- Z offset: M851 Z = nozzle tip below the probe trigger point; true value typical for a BLTouch mount. ---

export const PROBE_Z = { trueMm: -1.85, paperMm: 0.1 }
/** Gap under the nozzle on the first layer for a stored Z offset. */
export const zOffsetGap = (z: number, h = FIRST_LAYER.h) => h + (z - PROBE_Z.trueMm)
export const zOffsetView = (z: number) => {
  const gap = zOffsetGap(z)
  return { gap, bead: beadSection(gap), best: PROBE_Z.trueMm, footMm: Math.max(0, (beadSection(gap).w - FIRST_LAYER.w) / 2) }
}

// --- Bed levelling: a tilted, bowed bed; compensation estimates its height, the first layer feels the error. ---

export const BED_MAP = { mm: 220, margin: 20, probeS: 4, sigma: 0.003, paperSigma: 0.025, plane3: [[30, 30], [190, 30], [110, 190]] as const }
export const LEVEL_MODES = { none: 'No levelling (homed at the centre)', paper: 'Paper test at four corner screws', plane: '3-point probe, plane fit', mesh: 'Mesh probe, bilinear' }
export type LevelMode = keyof typeof LEVEL_MODES

/** Bed surface height (mm) at (x, y) mm: `tilt` across the diagonal, centre `warp` above the corners, small ripple. */
export function bedHeight(x: number, y: number, tilt: number, warp: number) {
  const u = x / BED_MAP.mm - 0.5
  const v = y / BED_MAP.mm - 0.5
  return tilt * (0.8 * u + 0.6 * v) + warp * (0.5 - 2 * (u * u + v * v)) + 0.012 * Math.sin(9 * u + 1) * Math.cos(7 * v)
}

/** Probe points of a mesh n × n over the reachable area. */
export const meshPoints = (n: number) => {
  const { mm, margin } = BED_MAP
  const step = (mm - 2 * margin) / (n - 1)
  return Array.from({ length: n * n }, (_, i) => [margin + (i % n) * step, margin + Math.floor(i / n) * step] as [number, number])
}

/** Marlin-style bilinear interpolation over an n × n grid of readings (extrapolated linearly outside the probed area). */
export function bilinear(z: readonly number[], n: number, x: number, y: number) {
  const { mm, margin } = BED_MAP
  const step = (mm - 2 * margin) / (n - 1)
  const gx = (x - margin) / step
  const gy = (y - margin) / step
  const i = clamp(Math.floor(gx), 0, n - 2)
  const j = clamp(Math.floor(gy), 0, n - 2)
  const fx = gx - i
  const fy = gy - j
  const at = (a: number, b: number) => z[b * n + a]
  return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy
}

/** Probed points, the firmware's estimate of the bed and the first-layer error (estimate − true) over a `cells` × `cells` map. */
export function levelView(tilt: number, warp: number, mode: LevelMode, grid = 5, cells = 21, seed = 3) {
  const g = gaussRng(parkMiller(seed * 977 + 11))
  const true_ = (x: number, y: number) => bedHeight(x, y, tilt, warp)
  const { mm, margin } = BED_MAP
  const c = mm / 2
  const read = (x: number, y: number, s: number): [number, number, number] => [x, y, true_(x, y) + s * g()]
  let probes: [number, number, number][] = []
  let est: (x: number, y: number) => number
  if (mode === 'none') {
    probes = [read(c, c, BED_MAP.sigma)]
    est = () => probes[0][2]
  } else if (mode === 'paper') {
    probes = [[margin, margin], [mm - margin, margin], [mm - margin, mm - margin], [margin, mm - margin]].map(([x, y]) => read(x, y, BED_MAP.paperSigma))
    const p = planeFit(probes)!
    est = p.at
  } else if (mode === 'plane') {
    probes = BED_MAP.plane3.map(([x, y]) => read(x, y, BED_MAP.sigma))
    est = planeFit(probes)!.at
  } else {
    probes = meshPoints(grid).map(([x, y]) => read(x, y, BED_MAP.sigma))
    const zs = probes.map((p) => p[2])
    est = (x, y) => bilinear(zs, grid, x, y)
  }
  const err = (x: number, y: number) => est(x, y) - true_(x, y)
  const map: number[] = []
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) map.push(err(((i + 0.5) / cells) * mm, ((j + 0.5) / cells) * mm))
  const worst = Math.max(...map.map(Math.abs))
  const good = map.filter((e) => beadSection(FIRST_LAYER.h + e).state === 'good').length / map.length
  return { probes, est, err, map, cells, worst, good, range: Math.max(...map) - Math.min(...map), probeS: probes.length * (mode === 'paper' ? 60 : BED_MAP.probeS), true: true_ }
}

// --- Build surfaces: grip while hot vs the shrink pull, and what is left once it cools. ---

/** Hot grip (N/mm² of first layer, relative, typical), share kept once cooled, and the surface's own tear strength. */
export const BED_SURFACES = {
  smoothPei: { name: 'Smooth PEI sheet', grip: { pla: 1, petg: 1.6, asa: 0.9 }, keep: { pla: 0.15, petg: 0.9, asa: 0.2 }, tear: 1.2, oily: 0.4 },
  texturedPei: { name: 'Textured PEI sheet', grip: { pla: 0.8, petg: 1, asa: 0.8 }, keep: { pla: 0.1, petg: 0.25, asa: 0.15 }, tear: 2, oily: 0.6 },
  glass: { name: 'Bare glass', grip: { pla: 0.6, petg: 1.8, asa: 0.3 }, keep: { pla: 0.1, petg: 0.9, asa: 0.1 }, tear: 1, oily: 0.35 },
  glue: { name: 'Glass + glue stick', grip: { pla: 1, petg: 1, asa: 1 }, keep: { pla: 0.05, petg: 0.08, asa: 0.08 }, tear: 3, oily: 0.9 },
  buildtak: { name: 'BuildTak-style sheet', grip: { pla: 1.1, petg: 1.3, asa: 0.9 }, keep: { pla: 0.35, petg: 0.6, asa: 0.35 }, tear: 1.1, oily: 0.5 },
  tape: { name: "Painter's tape", grip: { pla: 0.9, petg: 0.7, asa: 0.4 }, keep: { pla: 0.4, petg: 0.4, asa: 0.4 }, tear: 0.5, oily: 0.7 },
}
export type BedSurface = keyof typeof BED_SURFACES
export const SURFACE_PREP = { clean: 'Wiped with IPA', prints: 'Fingerprints on it' }
export type SurfacePrep = keyof typeof SURFACE_PREP
/** Shrink pull at a cold bed (N/mm², PLA), typical. */
export const PULL_BASE = 0.3
/** Removal: pops off alone below `pop`, flexing the sheet releases up to `flex`. */
export const RELEASE = { pop: 0.15, flex: 0.45 }

/** Share of full grip at bed temperature `c`: a floor on a cold bed, full near Tg, falling off well above it. */
export function gripTempFactor(mat: CoolFilament, c: number) {
  const tg = FILAMENTS[mat].tgC
  const rise = clamp01((c - 25) / (tg - 5 - 25))
  return (0.25 + 0.75 * rise * rise * (3 - 2 * rise)) * (1 - clamp01((c - tg - 5) / 40) * 0.6)
}

/** Shrink pull on the first layer: frozen-in shrink below Tg; a hot bed keeps the bottom near Tg so less is locked in. */
export const shrinkPull = (mat: CoolFilament, c: number) => PULL_BASE * COOL_SHRINK[mat] * clamp((FILAMENTS[mat].tgC - c) / (FILAMENTS[mat].tgC - 25), 0.15, 1)

export function surfaceView(s: BedSurface, mat: CoolFilament, c: number, prep: SurfacePrep) {
  const S = BED_SURFACES[s]
  const dirt = prep === 'prints' ? S.oily : 1
  const grip = S.grip[mat] * gripTempFactor(mat, c) * dirt
  const pull = shrinkPull(mat, c)
  const cold = S.grip[mat] * dirt * S.keep[mat]
  const release = cold > S.tear ? 'tears' : cold < RELEASE.pop ? 'pops' : cold < RELEASE.flex ? 'flex' : 'scraper'
  return { grip, pull, margin: grip / pull, holds: grip > pull, cold, release: release as 'tears' | 'pops' | 'flex' | 'scraper', tear: S.tear }
}

/** Grip and pull across bed temperatures 25…120 °C. */
export const SURFACE_SWEEP = Array.from({ length: 48 }, (_, i) => 25 + i * 2)

// --- Brim and raft: a tall box corner peeling up; aids add holding area right at the corner. ---

export const CORNER = { zoneMm: 10, peelMm: 0.6, partMm: [60, 20, 30] as const, pullN: 2.2, unevenMm: 0.25, raftUnevenMm: 1, raftMm: 5, raftLayers: 4 }
export const AIDS = { none: 'Nothing', brim: 'Brim', ears: 'Mouse ears', raft: 'Raft' }
export type Aid = keyof typeof AIDS

/** First-layer area (mm²) within `zoneMm` of the corner: part quadrant + brim strip of width b / ear disc of radius b / raft margin. */
export function cornerArea(aid: Aid, b: number, n = 60) {
  const R = CORNER.zoneMm + (aid === 'none' ? 0 : aid === 'raft' ? CORNER.raftMm : b)
  const step = (2 * R) / n
  let a = 0
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = -R + (i + 0.5) * step
      const y = -R + (j + 0.5) * step
      if (Math.hypot(x, y) > R) continue
      const out = Math.hypot(Math.max(x, 0), Math.max(y, 0))
      const inPart = out === 0
      const inAid = aid === 'brim' ? out <= b : aid === 'ears' ? Math.hypot(x, y) <= b : aid === 'raft' ? out <= CORNER.raftMm : false
      if (inPart || inAid) a += step * step
    }
  return a
}

/** Corner pull vs hold (N, typical) on textured PEI at the material's bed temperature, plus the aid's material, time and cleanup. */
export function cornerView(mat: CoolFilament, aid: Aid, b: number, uneven: number) {
  const f = FILAMENTS[mat]
  const grip = surfaceView('texturedPei', mat, f.bedC, 'clean').grip
  const flat = aid === 'raft' ? clamp01(1 - uneven / CORNER.raftUnevenMm) : clamp01(1 - uneven / CORNER.unevenMm)
  const area = cornerArea(aid, b)
  const hold = grip * area * CORNER.peelMm * 0.1 * flat * (aid === 'raft' ? 1.15 : 1)
  const pull = CORNER.pullN * COOL_SHRINK[mat] * (f.enclosure ? 1.4 : 1)
  const [L, W] = CORNER.partMm
  const gPerMm3 = f.rho / 1000
  const aidMm3 =
    aid === 'brim' ? (2 * (L + W) * b + Math.PI * b * b) * FIRST_LAYER.h
    : aid === 'ears' ? 4 * 0.75 * Math.PI * b * b * FIRST_LAYER.h
    : aid === 'raft' ? (L + 2 * CORNER.raftMm) * (W + 2 * CORNER.raftMm) * CORNER.raftLayers * 0.3 * 0.7
    : 0
  const minutes = aidMm3 / (FIRST_LAYER.w * FIRST_LAYER.h * 25 * 60)
  return { grip, area, hold, pull, margin: hold / pull, lifts: hold < pull, lift: clamp01(1 - hold / pull) * 3, grams: aidMm3 * gPerMm3, minutes, flat }
}

/** Corner margin over aid widths 0…12 mm. */
export const AID_SWEEP = Array.from({ length: 25 }, (_, i) => i * 0.5)
