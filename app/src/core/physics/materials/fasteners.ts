// Fasteners: metric screw sizes and lengths, heat-set inserts vs screws in plastic vs captive nuts, preload and vibration loosening.

/** ISO metric coarse screws, sizes in mm: pitch, clearance (normal) and tap-drill holes, socket-cap head, hex keys per head type. */
export const METRIC_SCREWS = {
  m2: { name: 'M2', d: 2, pitch: 0.4, clear: 2.4, tap: 1.6, nutAF: 4, nutH: 1.6, hex: { cap: 1.5, button: 1.3, csk: 1.3 }, use: 'servos, small boards' },
  m2_5: { name: 'M2.5', d: 2.5, pitch: 0.45, clear: 2.9, tap: 2.05, nutAF: 5, nutH: 2, hex: { cap: 2, button: 1.5, csk: 1.5 }, use: 'Raspberry Pi, PCBs' },
  m3: { name: 'M3', d: 3, pitch: 0.5, clear: 3.4, tap: 2.5, nutAF: 5.5, nutH: 2.4, hex: { cap: 2.5, button: 2, csk: 2 }, use: 'frames, motor mounts' },
  m4: { name: 'M4', d: 4, pitch: 0.7, clear: 4.5, tap: 3.3, nutAF: 7, nutH: 3.2, hex: { cap: 3, button: 2.5, csk: 2.5 }, use: 'arm joints, brackets' },
  m5: { name: 'M5', d: 5, pitch: 0.8, clear: 5.5, tap: 4.2, nutAF: 8, nutH: 4, hex: { cap: 4, button: 3, csk: 3 }, use: '2020 extrusion' },
} as const
export type ScrewKey = keyof typeof METRIC_SCREWS
export type ScrewSize = (typeof METRIC_SCREWS)[ScrewKey]

/** Head diameter and height as multiples of d; a countersunk head sinks into the top plate, so its length counts from the top face. */
export const SCREW_HEADS = {
  cap: { name: 'Socket cap', dk: 1.75, k: 1, flush: false },
  button: { name: 'Button head', dk: 1.9, k: 0.55, flush: false },
  csk: { name: 'Countersunk', dk: 2, k: 0.6, flush: true },
} as const
export type HeadKey = keyof typeof SCREW_HEADS

/** Common stock lengths (mm). */
export const STOCK_LENGTHS = [4, 5, 6, 8, 10, 12, 14, 16, 20, 25, 30, 35, 40] as const

/** What the screw threads into; engagement in multiples of d (typical rules of thumb). */
export const THREAD_INTO = {
  nut: { name: 'Steel nut', engage: 0 },
  aluminium: { name: 'Tapped aluminium', engage: 1.5 },
  plastic: { name: 'Printed plastic', engage: 2 },
} as const
export type IntoKey = keyof typeof THREAD_INTO

/** Shortest stock screw for a plate stack `stack` mm thick: nut height + 2 threads past it, or the engagement depth. */
export function screwFor(sk: ScrewKey, hk: HeadKey, ik: IntoKey, stack: number) {
  const s = METRIC_SCREWS[sk]
  const grip = ik === 'nut' ? s.nutH + 2 * s.pitch : THREAD_INTO[ik].engage * s.d
  const need = stack + grip
  const length = STOCK_LENGTHS.find((l) => l >= need) ?? null
  const under = length ?? need
  return {
    s,
    head: SCREW_HEADS[hk],
    hex: s.hex[hk],
    grip,
    need,
    length,
    engaged: under - stack,
    past: ik === 'nut' ? under - stack - s.nutH : 0,
    hole: ik === 'nut' ? s.clear : s.tap,
    threads: (under - stack) / s.pitch,
  }
}

/** A caliper on a real screw reads the thread crests a little under nominal (typical 0.05–0.15 mm). */
export const caliperReading = (sk: ScrewKey) => METRIC_SCREWS[sk].d - 0.04 - 0.02 * METRIC_SCREWS[sk].d
/** Nearest metric size to a caliper reading of the thread (mm). */
export function sizeFromCaliper(mm: number): ScrewKey {
  const keys = Object.keys(METRIC_SCREWS) as ScrewKey[]
  return keys.reduce((a, b) => (Math.abs(METRIC_SCREWS[b].d - mm) < Math.abs(METRIC_SCREWS[a].d - mm) ? b : a))
}

// --- Anchoring an M3 screw in a printed PLA boss ---

/** Typical: printed PLA thread/knurl shear strength (Pa); M3 short insert 4.6 mm × 5.7 mm in a 4.0 mm hole. */
export const PLA_SHEAR_PA = 20e6
export const M3_INSERT = { od: 4.6, len: 5.7, hole: 4.0 }
export const PLA_SOFT_C = 160
export const ANCHORS = {
  insert: { name: 'Heat-set insert', hole: 4.0, depth: 5.7, wallFull: 2.3, reuse: 1 },
  screw: { name: 'Screw into plastic', hole: 2.5, depth: 6, wallFull: 2, reuse: 0.85 },
  nut: { name: 'Captive nut', hole: 3.4, depth: 2.4, wallFull: 1.6, reuse: 1 },
} as const
export type AnchorKey = keyof typeof ANCHORS

/** Iron temperature (°C) → how fully the softened PLA flows into the knurls (0…1) and seconds to press in. */
export function ironInstall(tempC: number) {
  const over = tempC - PLA_SOFT_C
  if (over <= 0) return { fill: 0, secs: Infinity, ok: false, note: 'too cold: plastic stays hard, insert will not go in' }
  const fill = Math.min(1, over / 40) * (tempC > 240 ? Math.max(0.5, 1 - (tempC - 240) / 60) : 1)
  const secs = Math.max(2, 120 / over)
  const note = tempC > 240 ? 'too hot: runny plastic oozes out, insert sinks crooked' : fill < 0.9 ? 'barely soft: knurls only half filled' : 'plastic flows into the knurls'
  return { fill, secs, ok: true, note }
}

/** Pull-out force (N) of an M3 anchor in a PLA boss with walls `wall` mm, after `reuses` re-assemblies, iron at `tempC`. */
export function anchorPullout(ak: AnchorKey, wall: number, tempC = 220, reuses = 0) {
  const a = ANCHORS[ak]
  const wallK = Math.min(1, wall / a.wallFull)
  let shear: number
  let mode: string
  if (ak === 'insert') {
    shear = PLA_SHEAR_PA * Math.PI * M3_INSERT.od * 1e-3 * M3_INSERT.len * 1e-3 * 0.6 * ironInstall(tempC).fill
    mode = 'knurls tear out of the plastic'
  } else if (ak === 'screw') {
    shear = PLA_SHEAR_PA * Math.PI * 3e-3 * a.depth * 1e-3 * 0.5
    mode = 'plastic threads strip'
  } else {
    const cover = 2e-3
    shear = PLA_SHEAR_PA * 6 * (5.5e-3 / Math.sqrt(3)) * cover * 1.6
    mode = 'nut punches a hex plug out'
  }
  const force = shear * wallK * a.reuse ** reuses
  return { force, wallK, mode: wallK < 0.75 ? 'thin boss wall splits' : mode }
}

/** Pull-out vs wall thickness (0.5…`wMax` mm) for every anchor. */
export function anchorCurves(wMax: number, tempC: number, steps = 60) {
  return (Object.keys(ANCHORS) as AnchorKey[]).map((ak) => ({ ak, pts: Array.from({ length: steps + 1 }, (_, i) => anchorPullout(ak, 0.5 + ((wMax - 0.5) * i) / steps, tempC).force) }))
}

// --- Tightening torque, preload and vibration loosening of an M3 joint ---

export const NUT_FACTOR = 0.2
/** M3 class 8.8: stress area 5.03 mm², proof 580 MPa. */
export const M3_PROOF_N = 5.03e-6 * 580e6
export const JOINT_MU = 0.15
/** Typical transverse shake force at the joint per g of vibration (N/g). */
export const SHAKE_N_PER_G = 25
export const SHAKE_HZ = 50

/** T = K·F·d → clamp preload F (N) from torque T (N·m) on a d-mm screw. */
export const preloadOf = (T: number, dMm = 3, K = NUT_FACTOR) => T / (K * dMm * 1e-3)
export const torqueFor = (F: number, dMm = 3, K = NUT_FACTOR) => K * F * dMm * 1e-3

/** Locking options: slip loss rate multiplier, preload floor that keeps the nut from spinning off, how to undo it. */
export const LOCKS = {
  none: { name: 'Nothing', rate: 1, holds: false, undo: 'spins off by itself' },
  washer: { name: 'Spring washer', rate: 0.85, holds: false, undo: 'barely helps under shake' },
  nyloc: { name: 'Nylon lock nut', rate: 1, holds: true, undo: 'preload lost, but nut stays on' },
  blue: { name: 'Blue thread locker', rate: 0, holds: true, undo: 'removable with a hex key' },
  red: { name: 'Red thread locker', rate: 0, holds: true, undo: 'permanent: heat to 250 °C to undo' },
} as const
export type LockKey = keyof typeof LOCKS

/** Preload per shake cycle: the joint slips sideways once μ·F < shake force, and each slip lets the thread turn back a little. */
export function loosenRun(T: number, g: number, lk: LockKey, seconds = 60, samples = 241) {
  const lock = LOCKS[lk]
  const F0 = preloadOf(T)
  const Ft = SHAKE_N_PER_G * g
  const cycles = seconds * SHAKE_HZ
  const per = cycles / (samples - 1)
  const settle = 0.05
  const t: number[] = []
  const F: number[] = []
  const turns: number[] = []
  let f = F0 * (1 - settle)
  let turned = 0
  let slipAt: number | null = null
  for (let i = 0; i < samples; i++) {
    t.push((i * seconds) / (samples - 1))
    F.push(f)
    turns.push(turned)
    for (let c = 0; c < per; c++) {
      const slip = Ft > 0 ? Math.max(0, 1 - (JOINT_MU * f) / Ft) : 0
      if (slip > 0 && slipAt === null) slipAt = (i * seconds) / (samples - 1)
      const drop = 0.0008 * slip * lock.rate * F0
      f = Math.max(0, f - drop)
      if (lock.rate > 0 && slip > 0 && !(lock.holds && f === 0)) turned += 0.0015 * slip * lock.rate
      if (f === 0 && !lock.holds && slip > 0) turned += 0.002
    }
  }
  return { F0, Ft, slipN: Ft / JOINT_MU, t, F, turns, end: F[F.length - 1], slipAt, fellOff: !lock.holds && F[F.length - 1] === 0 }
}
