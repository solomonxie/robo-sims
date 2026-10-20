// 8-servo quadruped: 2-DOF sagittal legs (hip + knee SG90), servo travel and stride reach vs body height, stance load on the servos, a 50 Hz gait generator driving load-slowed servos.
import { SG90_LOOP } from '../actuators/servo'
import { DEG, G, clamp, toDeg } from '../common'
import { ARM_SERVOS, driveAt, holdVerdict } from '../kinematics/armbuild'
import { GAITS, Gait, footPath, hullMargin, legFK, legIK, legPhase, supportHull, swayAt } from '../mobility/legged'

type P2 = [number, number]

/** Femur / tibia lengths (m). */
export const QUAD_LINKS = {
  short: { name: 'Short 40 + 50 mm', femur: 0.04, tibia: 0.05 },
  kit: { name: 'Kit 50 + 60 mm', femur: 0.05, tibia: 0.06 },
  long: { name: 'Long 60 + 75 mm', femur: 0.06, tibia: 0.075 },
}
export type QuadLinks = keyof typeof QUAD_LINKS

/** Kit: hips at (±hipX, ±hipY), mass with pack, ESP32 and PCA9685; SG90s on a 5 V rail; swing lift. Legs LF, LH, RF, RH (as `GAITS`). */
export const QUAD_KIT = { hipX: 0.065, hipY: 0.05, massKg: 0.42, height: 0.07, lift: 0.02, servo: driveAt(ARM_SERVOS.sg90, 5), names: ['LF', 'LH', 'RF', 'RH'] }
/** Knee bend limits: the horn cannot straighten the leg fully, and the tibia hits the femur past 150°. */
export const KNEE_FOLD = [15 * DEG, 150 * DEG] as const

export const quadHips = (k = QUAD_KIT): P2[] => [[k.hipX, k.hipY], [-k.hipX, k.hipY], [k.hipX, -k.hipY], [-k.hipX, -k.hipY]]

/** Knees back. Servo horns centred (90°) with the femur straight down and the knee bent 90°. */
export const quadServoDeg = (hip: number, knee: number): P2 => [90 + toDeg(hip + Math.PI / 2), toDeg(knee)]

/** Foot (x forward, z up from the hip) → joint angles, and whether the leg reaches it inside servo travel and knee fold. */
export function quadStance(x: number, z: number, linksKey: QuadLinks = 'kit') {
  const L = QUAD_LINKS[linksKey]
  const s = legIK(x, z, L.femur, L.tibia, false)
  const [hipDeg, kneeDeg] = quadServoDeg(s.hip, s.knee)
  const fits = s.ok && hipDeg >= 0 && hipDeg <= 180 && s.knee >= KNEE_FOLD[0] && s.knee <= KNEE_FOLD[1]
  return { hip: s.hip, knee: s.knee, hipDeg, kneeDeg, fits }
}

/** Ground-line span [back, front] the foot reaches at body height h (around the point under the hip), 1 mm steps; null if not even under the hip. */
export function quadReach(h: number, linksKey: QuadLinks = 'kit'): P2 | null {
  if (!quadStance(0, -h, linksKey).fits) return null
  const edge = (dir: number) => {
    let x = 0
    while (Math.abs(x) < 0.2 && quadStance(x + dir * 0.001, -h, linksKey).fits) x += dir * 0.001
    return x
  }
  return [edge(-1), edge(1)]
}

/** Holding torque (N·m) at hip and knee with the foot at x, each of `feetDown` feet carrying an equal share of the weight straight up. */
export function quadLoads(x: number, h: number, feetDown: number, linksKey: QuadLinks = 'kit', k = QUAD_KIT) {
  const L = QUAD_LINKS[linksKey]
  const s = legIK(x, -h, L.femur, L.tibia, false)
  const knee = legFK(s.hip, s.knee, L.femur, L.tibia).knee
  const F = (k.massKg * G) / feetDown
  return { F, hipNm: F * Math.abs(x), kneeNm: F * Math.abs(x - knee[0]), kneeX: knee[0] }
}

/** Leg geometry check at body height h for a stride centred under the hip. */
export function quadGeometry(h: number, stride: number, feetDown: number, linksKey: QuadLinks = 'kit', k = QUAD_KIT) {
  const stand = quadStance(0, -h, linksKey)
  const reach = quadReach(h, linksKey)
  const maxStride = reach ? 2 * Math.min(-reach[0], reach[1]) : 0
  const half = Math.min(stride, maxStride) / 2
  let worstKnee = 0
  let worstHip = 0
  for (let i = 0; i <= 40; i++) {
    const l = quadLoads(-half + (i / 40) * 2 * half, h, feetDown, linksKey, k)
    worstKnee = Math.max(worstKnee, l.kneeNm)
    worstHip = Math.max(worstHip, l.hipNm)
  }
  const share = Math.max(worstKnee, worstHip) / k.servo.stallNm
  return { stand, reach, maxStride, fits: stride <= maxStride + 1e-9, worstKnee, worstHip, share, verdict: holdVerdict(share) }
}

/** Gaits for the 8-servo walker: no coxa, so the creep body shift can only go fore and aft. */
export const QUAD_GAITS = {
  trot: { gait: GAITS.trot, label: 'Trot (diagonal pairs)' },
  creep: { gait: { ...GAITS.creep, sway: 0 } as Gait, label: 'Creep, body still' },
  shift: { gait: { ...GAITS.creep, sway: 1 } as Gait, label: 'Creep + fore-aft body shift' },
}
export type QuadGait = keyof typeof QUAD_GAITS

/** Body shift along x at cycle fraction s (feet move by −shift in the body frame). */
export const quadShift = (g: Gait, s: number, k = QUAD_KIT) => swayAt(g, s, quadHips(k).map(([x]) => [x, 0] as P2))[0]

interface QuadFrame {
  t: number
  /** Commanded and actual [hip, knee] per leg (rad). */
  cmd: P2[]
  q: P2[]
  /** Actual foot [x, z] from its hip. */
  feet: P2[]
  down: boolean[]
  shift: number
  margin: number
}

/** 50 Hz gait generator: phase → foot path (stride, lift) → IK → servo commands; each SG90 follows at its P-loop lag,
 *  no faster than ω_free·(1 − τ/τ_stall) with τ the stance load. Runs `cycles`, measures the last. */
export function quadGaitRun(gaitKey: QuadGait, stride: number, T: number, h = QUAD_KIT.height, linksKey: QuadLinks = 'kit', k = QUAD_KIT, cycles = 3) {
  const g = QUAD_GAITS[gaitKey].gait
  const L = QUAD_LINKS[linksKey]
  const hips = quadHips(k)
  const tick = 0.02
  const sub = 10
  const dt = tick / sub
  const wFree = (k.servo.freeRpm * 2 * Math.PI) / 60
  const command = (s: number) => {
    const shift = quadShift(g, s, k)
    const legs = hips.map((_, i) => {
      const ph = legPhase(g, i, s)
      const [dx, dz] = footPath(ph.swing, ph.u, stride, k.lift)
      const st = quadStance(dx - shift, -h + dz, linksKey)
      const hipLo = -Math.PI
      return { a: [clamp(st.hip, hipLo, 0), clamp(st.knee, KNEE_FOLD[0], KNEE_FOLD[1])] as P2, down: !ph.swing }
    })
    return { shift, legs }
  }
  let q: P2[] = command(0).legs.map((l) => [...l.a] as P2)
  const frames: QuadFrame[] = []
  const n = Math.round((cycles * T) / tick)
  const t0 = (cycles - 1) * T
  const start: (number | null)[] = hips.map(() => null)
  const strides: number[] = []
  const clear: number[] = []
  const peak = hips.map(() => -Infinity)
  let lagMax = 0
  let margin = Infinity
  let minDown = Infinity
  let prev: boolean[] = []
  for (let j = 0; j <= n; j++) {
    const t = j * tick
    const c = command((t / T) % 1)
    const nDown = Math.max(1, c.legs.filter((l) => l.down).length)
    for (let m = 0; m < sub; m++) {
      q = q.map(([hip, knee], i) => {
        const f = legFK(hip, knee, L.femur, L.tibia)
        const F = c.legs[i].down ? (k.massKg * G) / nDown : 0
        const tau = [F * Math.abs(f.foot[0]), F * Math.abs(f.foot[0] - f.knee[0])]
        return [hip, knee].map((v, a) => {
          const wMax = wFree * Math.max(0.05, 1 - tau[a] / k.servo.stallNm)
          return v + clamp((c.legs[i].a[a] - v) / SG90_LOOP.tauS, -wMax, wMax) * dt
        }) as P2
      })
    }
    const feet = q.map(([hip, knee]) => legFK(hip, knee, L.femur, L.tibia).foot)
    const down = c.legs.map((l) => l.down)
    const pts = hips.map(([hx, hy], i) => [hx + feet[i][0], hy] as P2).filter((_, i) => down[i])
    const mg = hullMargin([0, 0], supportHull(pts))
    if (t >= t0) {
      margin = Math.min(margin, mg)
      minDown = Math.min(minDown, pts.length)
      c.legs.forEach((l, i) => (lagMax = Math.max(lagMax, ...l.a.map((v, a) => Math.abs(v - q[i][a])))))
    }
    down.forEach((d, i) => {
      if (d && prev[i] === false) {
        start[i] = feet[i][0]
        if (t >= t0 + tick && peak[i] > -Infinity) clear.push(peak[i] + h)
      }
      if (!d && prev[i] === true) {
        if (start[i] !== null && t >= t0) strides.push(start[i]! - feet[i][0])
        peak[i] = -Infinity
      }
      if (!d) peak[i] = Math.max(peak[i], feet[i][1])
    })
    prev = down
    frames.push({ t, cmd: c.legs.map((l) => l.a), q, feet, down, shift: c.shift, margin: mg })
  }
  const got = strides.length ? strides.reduce((a, b) => a + b, 0) / strides.length : 0
  const lift = clear.length ? Math.min(...clear) : k.lift
  return {
    frames: frames.filter((f) => f.t >= t0 - 1e-9),
    T,
    stride: got,
    speed: got / (g.duty * T),
    planned: stride / (g.duty * T),
    lift,
    lagMax,
    margin,
    minDown,
  }
}
