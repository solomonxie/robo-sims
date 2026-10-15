// HC-SR04 ultrasonic ranging: speed of sound, echo timing, beam, echo strength and missed echoes. Metres and seconds.

/** Speed of sound in dry air, m/s. */
export const speedOfSound = (tempC: number) => 331.3 * Math.sqrt(1 + tempC / 273.15)
/** Arduino's `us / 58` divisor: µs of round trip per cm at 343 m/s. */
const US_PER_CM = 58

export const HCSR04 = {
  hz: 40e3,
  cycles: 8,
  trigS: 10e-6,
  minM: 0.02,
  maxM: 4,
  halfDeg: 15,
  /** Echo pin stays high this long when nothing comes back. */
  noEchoS: 0.038,
}
export const burstS = () => HCSR04.cycles / HCSR04.hz

/** Round-trip time to a target `m` away. */
export const echoSeconds = (m: number, tempC: number) => (2 * m) / speedOfSound(tempC)
/** d = c·t/2. */
export const rangeFromEcho = (s: number, c: number) => (c * s) / 2
/** What `pulseIn(ECHO, HIGH) / 58.0` prints, cm. */
export const arduinoCm = (s: number) => (s * 1e6) / US_PER_CM

/** Trig high 0…10 µs, then the 8-cycle burst; ECHO rises when the burst is out and falls when the echo arrives (or at `noEchoS`). */
export function pingTimeline(echoS: number | null) {
  const echoUp = HCSR04.trigS + burstS()
  const width = echoS ?? HCSR04.noEchoS
  return { trig: [0, HCSR04.trigS], burst: [HCSR04.trigS, echoUp], echo: [echoUp, echoUp + width], heard: echoS !== null }
}

// --- Beam and echo strength. ---

/** Air absorption at 40 kHz, dB/m. */
const AIR_DB_PER_M = 1.3
/** One-way transducer gain off axis: −6 dB at the half-angle. */
export const beamGain = (offRad: number, halfRad = (HCSR04.halfDeg * Math.PI) / 180) => 2 ** -((offRad / halfRad) ** 2)
/** Spreading (1/path) and air loss over a round-trip `path`, m. */
export const spread = (path: number) => (1 / Math.max(path, 0.04)) * 10 ** (-(AIR_DB_PER_M * path) / 20)
/** A hard wall on axis is heard out to `maxM`: that echo is the receiver's threshold. */
export const THRESHOLD = spread(2 * HCSR04.maxM)

export interface Pt {
  x: number
  y: number
}
export interface Sonar extends Pt {
  heading: number
}
/** `wall`: flat, mirror-like (a..b). `post`: narrower than the beam, scatters back a share ~ width / beam width. */
export type Reflector = { kind: 'wall'; a: Pt; b: Pt; refl: number; name: string } | { kind: 'post'; at: Pt; width: number; refl: number; name: string }

const angleOff = (s: Sonar, p: Pt) => {
  const d = Math.atan2(p.y - s.y, p.x - s.x) - s.heading
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)))
}
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/** Share of the beam a narrow target `width` wide catches at `m`. */
const postShare = (width: number, m: number, halfRad = (HCSR04.halfDeg * Math.PI) / 180) =>
  Math.min(1, width / (2 * Math.max(m, 0.01) * Math.tan(halfRad)))

export interface Echo {
  name: string
  /** Where it bounced. */
  at: Pt
  /** Total path tx → target → rx, m. */
  path: number
  amp: number
  heard: boolean
}

/** One echo path from `tx` via `r` to `rx`: walls by the mirror image of `tx` (null if the bounce misses the wall), posts by scattering. */
export function echoVia(tx: Sonar, rx: Sonar, r: Reflector): Echo | null {
  let at: Pt
  let path: number
  let refl = r.refl
  if (r.kind === 'wall') {
    const ux = r.b.x - r.a.x
    const uy = r.b.y - r.a.y
    const len = Math.hypot(ux, uy)
    const nx = -uy / len
    const ny = ux / len
    const side = (tx.x - r.a.x) * nx + (tx.y - r.a.y) * ny
    const im = { x: tx.x - 2 * side * nx, y: tx.y - 2 * side * ny }
    const sr = (rx.x - r.a.x) * nx + (rx.y - r.a.y) * ny
    if (side * sr <= 0) return null
    const f = side / (side + sr)
    const along = { x: im.x + (rx.x - im.x) * f, y: im.y + (rx.y - im.y) * f }
    const k = ((along.x - r.a.x) * ux + (along.y - r.a.y) * uy) / (len * len)
    if (k < 0 || k > 1) return null
    at = along
    path = dist(im, rx)
  } else {
    at = r.at
    path = dist(tx, r.at) + dist(r.at, rx)
    refl *= postShare(r.width, dist(tx, r.at))
  }
  const amp = refl * beamGain(angleOff(tx, at)) * beamGain(angleOff(rx, at)) * spread(path)
  return { name: r.name, at, path, amp, heard: amp >= THRESHOLD }
}

/** Every echo of `tx`'s ping at `rx`, earliest first; the receiver latches the first one it hears. */
export function listen(tx: Sonar, rx: Sonar, rs: Reflector[]) {
  const all = rs.map((r) => echoVia(tx, rx, r)).filter((e): e is Echo => e !== null)
  all.sort((a, b) => a.path - b.path)
  return { all, first: all.find((e) => e.heard) ?? null }
}

/** Two sensors side by side: fired together, `b` latches whichever echo it hears first, its own or `a`'s. */
export function pairReading(a: Sonar, b: Sonar, rs: Reflector[], together: boolean) {
  const own = listen(b, b, rs).first
  const cross = together ? listen(a, b, rs).first : null
  const first = cross && (!own || cross.path < own.path) ? cross : own
  return { own, cross, first, phantom: first !== null && first === cross }
}

// --- Soft targets and missed echoes. ---

export type Target = 'wall' | 'cardboard' | 'curtain' | 'foam' | 'chairLeg'
/** Share of the sound sent back: hard surfaces near 1, soft and porous ones soak it up. */
const TARGETS: Record<Target, { refl: number; width?: number }> = {
  wall: { refl: 1 },
  cardboard: { refl: 0.7 },
  curtain: { refl: 0.25 },
  foam: { refl: 0.08 },
  chairLeg: { refl: 1, width: 0.025 },
}

/** On-axis echo strength from `target` at `m`, as a multiple of the threshold. */
export function targetEcho(target: Target, m: number) {
  const t = TARGETS[target]
  const refl = t.width ? t.refl * postShare(t.width, m) : t.refl
  return (refl * spread(2 * m)) / THRESHOLD
}

/** Farthest range at which `target` is still heard, m (bisection; strength falls with distance). */
export function maxRange(target: Target) {
  let lo = 0.01
  let hi = 10
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (targetEcho(target, mid) >= 1) lo = mid
    else hi = mid
  }
  return lo
}

/** One reading of `target` at `m`: echo time (null = missed) and what `pulseIn(ECHO, HIGH, timeoutS)` returns, s (0 = timed out). */
export function softPing(target: Target, m: number, tempC: number, timeoutS: number) {
  const strength = targetEcho(target, m)
  const echoS = strength >= 1 && m <= HCSR04.maxM ? echoSeconds(m, tempC) : null
  const pulse = echoS ?? HCSR04.noEchoS
  const pulseInS = pulse > timeoutS ? 0 : pulse
  return { strength, echoS, pulseInS, blockedS: Math.min(timeoutS, pulse) + HCSR04.trigS + burstS() }
}
