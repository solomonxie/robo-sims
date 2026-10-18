// Functional parts: heat-set insert bosses, captive-nut pockets, snap-fit hooks, living hinges, printed gears (typical values).
import { DEG, clamp01 } from '../common'
import { centerDistanceMm, tipErrorMm, trainRatio } from '../actuators/gearing'
import { ANCHORS, M3_INSERT, METRIC_SCREWS, anchorPullout } from '../materials/fasteners'
import { bridgeSag, fitClass, layerStrength } from './design'
import { LINE_W } from './fdm'
import { FILAMENTS } from './filaments'

const sweep = (lo: number, hi: number, n: number) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1))
const ACROSS = layerStrength(90)

// --- Heat-set insert boss: hole size, wall, depth and orientation for an M3 insert (Materials > Fasteners model). ---

export const INSERT_BOSS = { ...M3_INSERT, bestGrip: 0.5, idealWall: ANCHORS.insert.wallFull, groove: 0.15 }
export const BOSS_ORIENTS = { vertical: 'Insert axis vertical (pressed from the top)', horizontal: 'Insert axis horizontal (in a side wall)' } as const
export type BossOrient = keyof typeof BOSS_ORIENTS
export const BOSS_HOLE_SWEEP = sweep(3.4, 4.6, 25)

export function insertBoss(hole: number, wall: number, depth: number, orient: BossOrient) {
  const { od, len, bestGrip, groove } = INSERT_BOSS
  const squeeze = od - hole
  const grip = clamp01(squeeze / bestGrip)
  const orientK = orient === 'vertical' ? 1 : ACROSS
  const seated = Math.min(1, depth / len)
  const displaced = Math.max(0, (Math.PI / 4) * (od * od - hole * hole) * len - Math.PI * od * len * groove * 0.5)
  const room = (Math.PI / 4) * hole * hole * Math.max(0, depth - len)
  const overflow = Math.max(0, displaced - room)
  const hoop = (0.45 * Math.max(0, squeeze / 0.6) * (2 / wall)) / orientK
  const split = hoop >= 1
  const base = anchorPullout('insert', wall).force
  const tight = 1 - 0.5 * clamp01((squeeze - 0.8) / 0.6)
  const force = base * grip * tight * seated * orientK * (split ? 0.3 : 1)
  const mode = split ? 'boss splits along a layer line' : tight < 1 ? 'too tight: goes in crooked, melt wells up' : grip < 0.6 ? 'loose: insert spins and pulls out' : seated < 1 ? 'stands proud: hole too shallow' : anchorPullout('insert', wall).mode
  return { squeeze, grip, tight, orientK, seated, displaced, overflow, hoop, split, force, mode, lines: Math.round(wall / LINE_W) }
}

export function insertBossView(hole: number, wall: number, depth: number, orient: BossOrient) {
  const cur = insertBoss(hole, wall, depth, orient)
  return {
    cur,
    curve: BOSS_HOLE_SWEEP.map((h) => insertBoss(h, wall, depth, orient).force),
    ideal: anchorPullout('insert', INSERT_BOSS.idealWall).force,
    screw: anchorPullout('screw', wall).force,
    nut: anchorPullout('nut', wall).force,
  }
}

// --- Captive nut pocket: across-flats clearance, pocket style, cover over the nut. ---

export const NUT_POCKET = { s: METRIC_SCREWS.m3, holeShrink: 0.15, layerH: 0.2, fan: 1, speed: 30 }
export const POCKET_STYLES = { top: 'Drop in from the top', side: 'Side slot', buried: 'Buried: pause, sacrificial layer' } as const
export type PocketStyle = keyof typeof POCKET_STYLES
export const COVER_SWEEP = sweep(0.6, 4, 18)
const NUT_N_PER_MM = anchorPullout('nut', ANCHORS.nut.wallFull).force / 2

/** Degrees a hex nut turns in its pocket before a corner meets a flat. */
export const nutPlayDeg = (af: number, gap: number) => Math.max(0, 30 - Math.acos(Math.min(1, (af + Math.max(0, gap)) / ((2 * af) / Math.sqrt(3)))) / DEG)

export function nutPocket(clear: number, cover: number, style: PocketStyle) {
  const { s, holeShrink, layerH, fan, speed } = NUT_POCKET
  const gap = clear - holeShrink
  const fit = fitClass(gap)
  const span = s.nutAF + clear
  const roofSag = style === 'top' ? 0 : bridgeSag(span, fan, speed)
  const weakLayer = style === 'top' ? 0 : layerH
  const force = NUT_N_PER_MM * Math.max(0, cover - weakLayer - roofSag)
  const fallsOut = fit === 'slide' || fit === 'loose'
  const both = style !== 'top'
  return { gap, fit, span, roofSag, force, play: nutPlayDeg(s.nutAF, gap), fallsOut, both, needsPause: style === 'buried' }
}

export function nutPocketView(clear: number, cover: number, style: PocketStyle) {
  return {
    cur: nutPocket(clear, cover, style),
    curve: COVER_SWEEP.map((c) => nutPocket(clear, c, style).force),
    insert: anchorPullout('insert', INSERT_BOSS.idealWall).force,
    screw: anchorPullout('screw', ANCHORS.screw.wallFull).force,
  }
}

// --- Snap fit: cantilever hook, strain ε = 1.5·t·y / L² vs the material's allowable strain. ---

/** Allowable strain for one snap (typical, printed along the layers). */
export const SNAP_MATS = {
  pla: { allow: 0.02 },
  petg: { allow: 0.04 },
  asa: { allow: 0.035 },
  nylon: { allow: 0.06 },
} as const
export type SnapMat = keyof typeof SNAP_MATS
export const SNAP_ORIENTS = { along: 'Hook bends along the layers (printed on its side)', across: 'Hook bends across the layers (printed standing)' } as const
export type SnapOrient = keyof typeof SNAP_ORIENTS
export const SNAP = { b: 6, leadDeg: 30, mu: 0.3 }
export const SNAP_L_SWEEP = sweep(5, 30, 26)

export const snapStrain = (t: number, y: number, L: number) => (1.5 * t * y) / (L * L)
/** Push needed to slide a hook with face angle α against deflection force P; Infinity once friction locks it. */
export const snapPushN = (P: number, deg: number, mu = SNAP.mu) => {
  const tan = Math.tan(Math.min(89.9, deg) * DEG)
  const den = 1 - mu * tan
  return den <= 0 ? Infinity : (P * (mu + tan)) / den
}

export function snapHook(mat: SnapMat, orient: SnapOrient, t: number, L: number, y: number, backDeg: number) {
  const allow = SNAP_MATS[mat].allow * (orient === 'along' ? 1 : ACROSS)
  const eps = snapStrain(t, y, L)
  const ratio = eps / allow
  const E = FILAMENTS[mat].E
  const P = (E * SNAP.b * t * t * eps) / (6 * L) * 1e-6
  return {
    allow,
    eps,
    ratio,
    P,
    push: snapPushN(P, SNAP.leadDeg),
    pull: snapPushN(P, backDeg),
    minL: Math.sqrt((1.5 * t * y) / allow),
    breaks: ratio > 1 && !FILAMENTS[mat].ductile,
    sets: ratio > 1 && FILAMENTS[mat].ductile,
  }
}

export function snapView(mat: SnapMat, orient: SnapOrient, t: number, L: number, y: number, backDeg: number) {
  return { cur: snapHook(mat, orient, t, L, y, backDeg), curve: SNAP_L_SWEEP.map((l) => snapStrain(t, y, l)) }
}

// --- Living hinge: a thin web folded θ; strain h·θ / (2·span) → cycles to cracking (typical, printed). ---

/** endure = strain amplitude that lasts a million folds. */
export const HINGE_MATS = {
  pp: { name: 'PP', endure: 0.2 },
  nylon: { name: FILAMENTS.nylon.name, endure: 0.15 },
  petg: { name: FILAMENTS.petg.name, endure: 0.07 },
  tpu: { name: FILAMENTS.tpu.name, endure: 0.6 },
  pla: { name: FILAMENTS.pla.name, endure: 0.018 },
} as const
export type HingeMat = keyof typeof HINGE_MATS
export const HINGE_LINES = { across: 'Lines across the hinge (leaf to leaf)', along: 'Lines along the fold' } as const
export type HingeLines = keyof typeof HINGE_LINES
export const HINGE = { span: 3, layerH: 0.2, slope: 4, alongK: 0.35, maxCycles: 1e7 }
export const HINGE_H_SWEEP = sweep(0.2, 0.8, 25)

export const hingeStrain = (h: number, foldDeg: number, span = HINGE.span) => (h * foldDeg * DEG) / (2 * span)
export function hingeCycles(mat: HingeMat, h: number, foldDeg: number, lines: HingeLines) {
  const endure = HINGE_MATS[mat].endure * (lines === 'across' ? 1 : HINGE.alongK)
  const eps = hingeStrain(h, foldDeg)
  return Math.max(1, Math.min(HINGE.maxCycles, 1e6 * (endure / eps) ** HINGE.slope))
}
export function hingeView(mat: HingeMat, h: number, foldDeg: number, lines: HingeLines) {
  const mats = Object.keys(HINGE_MATS) as HingeMat[]
  return {
    eps: hingeStrain(h, foldDeg),
    cycles: hingeCycles(mat, h, foldDeg, lines),
    layers: h / HINGE.layerH,
    curve: HINGE_H_SWEEP.map((x) => hingeCycles(mat, x, foldDeg, lines)),
    all: mats.map((m) => ({ m, cycles: hingeCycles(m, h, foldDeg, lines) })),
  }
}

// --- Printed gears: Lewis tooth bending, printer clearance → backlash, a 12:36 robot joint stage. ---

const LEWIS: [number, number][] = [[12, 0.245], [14, 0.277], [16, 0.296], [18, 0.309], [20, 0.322], [24, 0.337], [28, 0.353], [34, 0.371], [43, 0.397], [50, 0.409], [75, 0.435], [100, 0.447]]
/** Lewis form factor Y (20° full-depth, module based). */
export function lewisY(z: number) {
  if (z <= LEWIS[0][0]) return LEWIS[0][1]
  const i = LEWIS.findIndex(([n]) => n >= z)
  if (i < 0) return LEWIS[LEWIS.length - 1][1]
  const [z0, y0] = LEWIS[i - 1]
  const [z1, y1] = LEWIS[i]
  return y0 + ((y1 - y0) * (z - z0)) / (z1 - z0)
}
/** Allowed bending stress for continuous duty (MPa, typical printed) and wear (FILAMENTS.slide). */
export const GEAR_MATS = {
  pla: { allowMPa: 10, wear: FILAMENTS.pla.slide },
  petg: { allowMPa: 9, wear: FILAMENTS.petg.slide },
  nylon: { allowMPa: 14, wear: FILAMENTS.nylon.slide },
} as const
export type GearMat = keyof typeof GEAR_MATS
export const PRINT_GEAR_KINDS = { flat: 'Spur, printed flat', herring: 'Herringbone, printed flat', edge: 'Spur, printed on its edge' } as const
export type PrintGearKind = keyof typeof PRINT_GEAR_KINDS
export const GEAR_PAIR = { z1: 12, z2: 36, rpm: 300, clear: 0.15, pressureDeg: 20, eff: 0.9, armMm: 100, herringK: 1.25 }
export const MODULE_SWEEP = sweep(0.5, 2.5, 21)

/** Lewis: σ = Ft·Kv / (b·m·Y), Ft = 2T/d, Kv = (6.1 + v)/6.1. Returns MPa. */
export function lewisStress(T: number, mod: number, face: number, z: number, rpm = GEAR_PAIR.rpm) {
  const d = mod * z
  const Ft = (2000 * T) / d
  const v = (Math.PI * d * rpm) / 60000
  return { Ft, v, Kv: (6.1 + v) / 6.1, sigma: (Ft * ((6.1 + v) / 6.1)) / (face * mod * lewisY(z)) }
}

export function printedGear(T: number, mod: number, face: number, mat: GearMat, kind: PrintGearKind) {
  const { z1, z2, clear, pressureDeg, eff, armMm, herringK } = GEAR_PAIR
  const L = lewisStress(T, mod, face, z1)
  const allow = GEAR_MATS[mat].allowMPa * (kind === 'edge' ? ACROSS : kind === 'herring' ? herringK : 1)
  const ratio = Math.abs(trainRatio([{ teeth: z1 }, { teeth: z2 }]))
  const backlash = 2 * clear * Math.tan(pressureDeg * DEG)
  const playDeg = backlash / ((mod * z2) / 2) / DEG
  return {
    ...L,
    allow,
    sf: allow / L.sigma,
    sigmaGear: (L.sigma * lewisY(z1)) / lewisY(z2),
    ratio,
    outNm: T * ratio * eff,
    centre: centerDistanceMm(mod, z1, z2) + clear,
    backlash,
    playDeg,
    tipMm: tipErrorMm(armMm, playDeg),
    wear: GEAR_MATS[mat].wear,
  }
}

export function printedGearView(T: number, mod: number, face: number, mat: GearMat, kind: PrintGearKind) {
  return { cur: printedGear(T, mod, face, mat, kind), curve: MODULE_SWEEP.map((m) => lewisStress(T, m, face, GEAR_PAIR.z1).sigma) }
}
