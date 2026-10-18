// Sumo robot: a 4WD TT-motor pusher on a 77 cm ring. The shove (grip, weight transfer, who gets the wedge under whom)
// and the match brain (two ToF rangers find the rival, two TCRT5000s on the white edge, stop before the rim).
import { G, clamp, gaussAt, wrapPi } from '../common'
import { GEARBOXES, TT_CAR, TT_GEAR, TT_INERTIA, gearEfficiency, shaftTorque, stallTorque } from '../actuators/dcmotor'
import { brakeOnlyStop } from '../mechanics/collision'
import { axleLoads, slipRatio, tractionMu } from '../mechanics/friction'
import { diffStep } from '../mobility/diffdrive'
import { Pose, toRoom } from '../room'
import { TCRT, tapeCover } from '../sensors/infrared'
import { TOF_MODES, VL53L0X, reportedMm, tofRanging } from '../sensors/tof'
import { barCoupling, barSpot, LINE_BAR } from './linecar'

/** Mini-sumo ring: 77 cm black disc, 2.5 cm white edge, 2.5 cm high; start lines 10 cm apart. */
export const SUMO_RING = { r: 0.385, edge: 0.025, h: 0.025, startGap: 0.1 }

/** 4 × TT 1:48 on 65 mm wheels: base build mass, class limit, length, wheelbase, track, wedge contact ahead of the front axle, push height, motor volts. */
export const SUMO_BOT = { baseKg: 0.6, maxKg: 1, len: 0.15, wheelbase: 0.1, track: 0.13, lead: 0.03, pushH: 0.015, volts: 6, crr: TT_CAR.crr, wheelM: TT_CAR.wheelM }

export const SUMO_FRONTS = {
  flat: { name: 'Flat bumper', lipMm: 8, deg: 90 },
  printed: { name: 'Printed wedge, 1.5 mm lip', lipMm: 1.5, deg: 25 },
  steel: { name: 'Steel-edged wedge, 0.2 mm lip', lipMm: 0.2, deg: 20 },
}
export type SumoFront = keyof typeof SUMO_FRONTS
export const SUMO_TYRES = {
  tt: { name: 'Stock TT tyres', mu: 0.7 },
  silicone: { name: 'Cast silicone tyres', mu: 1.1 },
  dusty: { name: 'Silicone, dusty', mu: 0.6 },
}
export type SumoTyre = keyof typeof SUMO_TYRES
export interface SumoSide {
  kg: number
  tyre: SumoTyre
  front: SumoFront
}
export const SUMO_RIVALS = {
  box: { name: 'Flat box, 0.8 kg', kg: 0.8, tyre: 'tt', front: 'flat' },
  wedge: { name: 'Printed wedge, 0.8 kg', kg: 0.8, tyre: 'tt', front: 'printed' },
  heavy: { name: 'Heavy box, 1 kg, silicone', kg: 1, tyre: 'silicone', front: 'flat' },
} satisfies Record<string, SumoSide & { name: string }>
export type SumoRival = keyof typeof SUMO_RIVALS

/** Which side's wedge gets under the other: the lower lip, if it is a wedge and at least 0.3 mm lower. */
export function wedgeUnder(a: SumoFront, b: SumoFront): 0 | 1 | null {
  const [fa, fb] = [SUMO_FRONTS[a], SUMO_FRONTS[b]]
  if (fa.deg < 90 && fa.lipMm + 0.3 <= fb.lipMm) return 0
  if (fb.deg < 90 && fb.lipMm + 0.3 <= fa.lipMm) return 1
  return null
}

/** Axle loads (N) of a robot pushed at its nose by `P` at push height (load shifts to the rear axle, as axleLoads does for acceleration);
 *  `lift` up at the nose from a wedge under it, `carry` down on its own wedge. */
export function sumoLoads(kg: number, P: number, lift = 0, carry = 0) {
  const { wheelbase: L, lead: d, pushH } = SUMO_BOT
  const b = axleLoads(kg, pushH, 0, P / kg, L)
  const k = (L + d) / L
  return { rear: Math.max(0, b.rear + ((lift - carry) * d) / L), front: Math.max(0, b.front - (lift - carry) * k) }
}

/** Lift a wedge face at `deg` puts on the robot it is under: P / tan(deg), until that robot's front wheels leave the mat. */
export function wedgeLift(P: number, deg: number, kg: number) {
  const { wheelbase: L, lead: d } = SUMO_BOT
  return Math.min(P / Math.tan((deg * Math.PI) / 180), Math.max(0, sumoLoads(kg, P).front) * (L / (L + d)))
}

interface ShoveFrame {
  t: number
  x: [number, number]
  v: [number, number]
  P: number
  lift: number
  /** Per robot: [rear, front] axle load, slip ratio, tyre push. */
  load: [number, number][]
  kappa: [number, number][]
  push: [number, number][]
  /** Rim travel of each robot's wheels (m), for turning the tyres. */
  turn: [number, number]
}

/** Wheel thrust (N) of four TT 1:48 motors stalled at `volts`, before the tyres slip. */
export const sumoThrust = (volts = SUMO_BOT.volts) => (4 * stallTorque(volts) * TT_GEAR * gearEfficiency(GEARBOXES.tt48)) / SUMO_BOT.wheelM

/** Both robots at full throttle from the start lines along one diameter (us → +x, rival → −x). Each axle: 2 TT motors, grip tractionMu(μ, κ)·N;
 *  contact is a stiff bumper; a robot is out when its rear axle passes the rim. */
export function sumoShove(sides: [SumoSide, SumoSide], { seconds = 4, dt = 0.0005, every = 10 } = {}) {
  const { len, wheelbase: L, wheelM: r, volts, crr } = SUMO_BOT
  const R = SUMO_RING.r
  const eff = gearEfficiency(GEARBOXES.tt48)
  const J = 2 * TT_INERTIA * TT_GEAR * TT_GEAR
  const under = wedgeUnder(sides[0].front, sides[1].front)
  const dir = [1, -1]
  const x: [number, number] = [-SUMO_RING.startGap / 2 - len / 2, SUMO_RING.startGap / 2 + len / 2]
  const v: [number, number] = [0, 0]
  const w = [[0, 0], [0, 0]]
  const turn: [number, number] = [0, 0]
  const frames: ShoveFrame[] = []
  let [out, tOut, tHit, peakP] = [null as 0 | 1 | null, Infinity, Infinity, 0]
  const n = Math.round(seconds / dt)
  for (let i = 0; i <= n; i++) {
    const t = i * dt
    const overlap = x[0] + len / 2 - (x[1] - len / 2)
    const P = overlap > 0 ? Math.max(0, 2e4 * overlap + 100 * (v[0] - v[1])) : 0
    if (P > 0 && tHit === Infinity) tHit = t
    peakP = Math.max(peakP, P)
    const lift = under === null ? 0 : wedgeLift(P, SUMO_FRONTS[sides[under].front].deg, sides[1 - under].kg)
    const load: [number, number][] = [0, 1].map((k) => {
      const l = sumoLoads(sides[k].kg, P, under === 1 - k ? lift : 0, under === k ? lift : 0)
      return [l.rear, l.front]
    })
    const kappa: [number, number][] = [[0, 0], [0, 0]]
    const push: [number, number][] = [[0, 0], [0, 0]]
    for (const k of [0, 1]) {
      const vf = dir[k] * v[k]
      const mu = SUMO_TYRES[sides[k].tyre].mu
      for (const a of [0, 1]) {
        kappa[k][a] = slipRatio(w[k][a] * r, vf)
        push[k][a] = tractionMu(mu, kappa[k][a]) * load[k][a]
      }
    }
    if (i % every === 0) frames.push({ t, x: [...x], v: [...v], P, lift, load, kappa, push, turn: [...turn] })
    if (out !== null) break
    for (const k of [0, 1]) {
      const vf = dir[k] * v[k]
      const roll = Math.abs(vf) > 1e-4 ? crr * (load[k][0] + load[k][1]) * Math.sign(vf) : 0
      const a = (push[k][0] + push[k][1] - P - roll) / sides[k].kg
      for (const ax of [0, 1]) {
        const motor = 2 * Math.max(0, shaftTorque(volts, w[k][ax] * TT_GEAR)) * TT_GEAR * eff
        w[k][ax] += ((motor - push[k][ax] * r) / J) * dt
      }
      v[k] += dir[k] * a * dt
      turn[k] += ((w[k][0] + w[k][1]) / 2) * r * dt
    }
    x[0] += v[0] * dt
    x[1] += v[1] * dt
    if (x[1] + L / 2 > R) [out, tOut] = [1, t]
    else if (x[0] - L / 2 < -R) [out, tOut] = [0, t]
  }
  const winner = out === null ? null : ((1 - out) as 0 | 1)
  const grip = (k: number) => SUMO_TYRES[sides[k].tyre].mu * sides[k].kg * G
  return { frames, dt: dt * every, under, winner, tOut, tHit, peakP, grip: [grip(0), grip(1)] }
}

// --- Match brain: two ToF rangers find the rival, two edge sensors on the white line. ---

/** Front-corner ToF rangers (x, ±y; toed out `toe`°), 'seen' under `seeMm`, high-speed mode; edge TCRT5000s at the front corners, `h` up; front axle and wheel y for "off the ring". */
export const SUMO_EYES = { x: 0.075, y: 0.04, toe: 10, seeMm: 700, mode: 'fast' as const, klux: 0.3 }
export const SUMO_EDGE = { x: 0.075, y: 0.06, h: LINE_BAR.h0, white: 0.85, black: 0.05, noise: 25, axleX: 0.05, wheelY: 0.065 }
export const SUMO_COLORS = { black: { name: 'Matte black rival', refl: 0.05 }, white: { name: 'White rival', refl: 0.88 } }
export type SumoColor = keyof typeof SUMO_COLORS
export const SUMO_STARTS = { facing: 'Facing', side: 'Side by side', back: 'Back to back' }
export type SumoStart = keyof typeof SUMO_STARTS
/** Search spin wheel speed, reverse and spin-away times after an edge, how long an attack keeps going blind; our tyres; match timeout; start centres at ±startX (behind the lines, 29 cm apart). */
export const SUMO_BRAIN = { spinV: 0.3, backS: 0.25, awayS: 0.35, lostS: 0.3, mu: SUMO_TYRES.silicone.mu, seconds: 12, startX: 0.22 }
/** Rival: box side; waits on its line, then circles the centre at r slowly; dodges sideways (v, s) when we charge inside `near` m, at most `dodges` times; turn rate rad/s. */
export const SUMO_RIVAL = { side: 0.15, wait: 0, v: 0.12, r: 0.25, near: 0.22, charge: 0.35, dodgeV: 0.5, dodgeS: 0.4, dodges: 2, turn: 8 }

/** Raw 12-bit TCRT5000 at radius `rM` (white edge high reflectance → low reading); off the ring the floor is `ring.h` further away, so it reads dark again. */
export function edgeAdc(rM: number, z = 0) {
  const { r, edge, h: ringH } = SUMO_RING
  const on = rM <= r
  const h = SUMO_EDGE.h + (on ? 0 : ringH)
  const refl = on ? SUMO_EDGE.black + (SUMO_EDGE.white - SUMO_EDGE.black) * tapeCover(rM - (r - edge / 2), edge, barSpot(h)) : SUMO_EDGE.black
  const k = (0.92 * barCoupling(h)) / barCoupling(LINE_BAR.h0)
  const adc = (1 - (k * refl) / TCRT.floor) * 4095 + SUMO_EDGE.noise * z
  return Math.round(clamp(adc, 0, 4095))
}
/** White if under halfway between the black-mat and white-edge readings. */
export const EDGE_THRESHOLD = Math.round((edgeAdc(0) + edgeAdc(SUMO_RING.r - SUMO_RING.edge / 2)) / 2)

/** Stop distance from `v` after a white read up to one loop late, braking at the grip limit, vs the room the edge gives (edge width + sensor ahead of the front wheels);
 *  `skip` = the sensor can cross the whole white band between two reads (driving straight at the rim). */
export function edgeStop(v: number, loopS: number, mu = SUMO_BRAIN.mu) {
  const need = brakeOnlyStop(v, loopS, 0, mu)
  const room = SUMO_RING.edge + SUMO_EDGE.x - SUMO_EDGE.axleX
  const skip = v * loopS > SUMO_RING.edge
  return { need, room, skip, ok: need < room && !skip }
}

/** Distance (m) along a ray from (ox, oy) heading `th` to a square box (side s, pose p), or Infinity. */
function rayBox(ox: number, oy: number, th: number, p: Pose, s: number) {
  const [c, sn] = [Math.cos(p.th), Math.sin(p.th)]
  const [lx, ly] = [(ox - p.x) * c + (oy - p.y) * sn, -(ox - p.x) * sn + (oy - p.y) * c]
  const [dx, dy] = [Math.cos(th - p.th), Math.sin(th - p.th)]
  let [t0, t1] = [-Infinity, Infinity]
  for (const [o, d] of [[lx, dx], [ly, dy]]) {
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(o) > s / 2) return Infinity
      continue
    }
    const [a, b] = [(-s / 2 - o) / d, (s / 2 - o) / d]
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }
  return t1 >= Math.max(t0, 0) ? Math.max(t0, 0) : Infinity
}

/** Ranger `slot` (0 left, 1 right) origin and heading. */
export function sumoEye(p: Pose, slot: number) {
  const s = slot === 0 ? 1 : -1
  return { at: toRoom(p, SUMO_EYES.x, s * SUMO_EYES.y), th: p.th + s * SUMO_EYES.toe * (Math.PI / 180) }
}

/** One ToF reading of the rival: nearest return over 3 rays across the 25° cone; out of range beyond the ring (nothing there). */
export function rivalMm(p: Pose, slot: number, rival: Pose, refl: number, k: number) {
  const e = sumoEye(p, slot)
  const half = ((VL53L0X.fovDeg / 2) * Math.PI) / 180
  const m = Math.min(...[0, half, -half].map((a) => rayBox(e.at[0], e.at[1], e.th + a, rival, SUMO_RIVAL.side)))
  if (!(m < VL53L0X.maxM)) return VL53L0X.outOfRange
  const t = tofRanging(m, refl, SUMO_EYES.klux, SUMO_EYES.mode)
  return reportedMm(m, t.sigma, t.ok, gaussAt(k))
}

interface Rival {
  pose: Pose
  dodging: number
  dodges: number
  side: number
}
const rivalStart = (start: SumoStart): Rival => ({ pose: { x: SUMO_BRAIN.startX, y: 0, th: start === 'facing' ? Math.PI : start === 'side' ? Math.PI / 2 : 0 }, dodging: -1, dodges: 0, side: 1 })
const turnToward = (th: number, target: number, max: number) => th + clamp(wrapPi(target - th), -max, max)

/** Rival step: waits, then circles the centre (heading = tangent, steered back to radius r); a close charge from us (nose inside `near`, closing faster than `charge`) makes it swerve sideways. */
function rivalStep(rv: Rival, t: number, us: Pose, usV: number, dt: number): Rival {
  const R = SUMO_RIVAL
  const p = rv.pose
  if (t < R.wait) return rv
  const nose = toRoom(us, SUMO_BOT.len / 2, 0)
  const gap = Math.hypot(p.x - nose[0], p.y - nose[1])
  const toward = Math.cos(Math.atan2(p.y - us.y, p.x - us.x) - us.th) * usV
  let { dodging, dodges, side } = rv
  if (dodging < 0 && dodges < R.dodges && gap < R.near && toward > R.charge) [dodging, dodges, side] = [t, dodges + 1, -side]
  if (dodging >= 0 && t - dodging > R.dodgeS) dodging = -1
  const r = Math.hypot(p.x, p.y)
  const target = dodging >= 0 ? us.th + side * (Math.PI / 2) : Math.atan2(p.y, p.x) + Math.PI / 2 + clamp((2 * (r - R.r)) / R.r, -1, 1)
  const th = turnToward(p.th, target, R.turn * dt)
  const v = dodging >= 0 ? R.dodgeV : R.v
  return { pose: { x: p.x + v * Math.cos(th) * dt, y: p.y + v * Math.sin(th) * dt, th }, dodging, dodges, side }
}
const ourStart = (start: SumoStart): Pose => ({ x: -SUMO_BRAIN.startX, y: 0, th: start === 'facing' ? 0 : start === 'side' ? Math.PI / 2 : Math.PI })

export type SumoState = 'search' | 'roam' | 'attack' | 'back' | 'away'
interface MatchFrame {
  t: number
  pose: Pose
  rival: Pose
  state: SumoState
  /** Latest ToF readings (mm) and edge readings (ADC), left/right. */
  tof: [number, number]
  edge: [number, number]
  dL: number
  dR: number
}

/** The match brain at loop period `loopS`: search spin (one turn), then roam straight → attack on ToF → edge escape (reverse, spin away). Wheels slew at μ·g; ToF updates every 20 ms.
 *  Ends on contact (front face on the rival), off the ring (a front wheel past the rim) or timeout. */
export function sumoMatch({ vMax, loopS, color, start, dt = 0.001, every = 10 }: { vMax: number; loopS: number; color: SumoColor; start: SumoStart; dt?: number; every?: number }) {
  const { spinV, backS, awayS, lostS, mu, seconds } = SUMO_BRAIN
  const R = SUMO_RING.r
  const refl = SUMO_COLORS[color].refl
  const tofS = TOF_MODES[SUMO_EYES.mode].budgetMs / 1000
  const aMax = mu * G
  let pose = ourStart(start)
  let rv = rivalStart(start)
  let [vL, vR, tL, tR, dL, dR] = [0, 0, 0, 0, 0, 0]
  let state: SumoState = 'search'
  let [spinDir, tState, tSeen, nextLoop, nextTof, spun] = [1, 0, -Infinity, 0, 0, 0]
  let tof: [number, number] = [VL53L0X.outOfRange, VL53L0X.outOfRange]
  let edge: [number, number] = [edgeAdc(0), edgeAdc(0)]
  const frames: MatchFrame[] = []
  let [result, tEnd, edges, closest, k] = ['timeout' as 'hit' | 'out' | 'timeout', seconds, 0, Infinity, 0]
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const t = i * dt
    const rival = rv.pose
    if (t >= nextTof - 1e-9) {
      nextTof += tofS
      tof = [0, 1].map((s) => rivalMm(pose, s, rival, refl, 2 * k + s)) as [number, number]
    }
    if (t >= nextLoop - 1e-9) {
      nextLoop += loopS
      k++
      edge = [1, -1].map((s, j) => {
        const p = toRoom(pose, SUMO_EDGE.x, s * SUMO_EDGE.y)
        return edgeAdc(Math.hypot(p[0], p[1]), gaussAt(100000 + 2 * k + j))
      }) as [number, number]
      const white = edge.map((a) => a < EDGE_THRESHOLD)
      const seen = tof.map((m) => m < SUMO_EYES.seeMm)
      if (seen[0] || seen[1]) tSeen = t
      if ((white[0] || white[1]) && state !== 'back') {
        edges++
        ;[state, tState, spinDir] = ['back', t, white[0] ? -1 : 1]
      } else if (state === 'back' && t - tState >= backS) [state, tState] = ['away', t]
      else if (state === 'away' && t - tState >= awayS) [state, tState, spun] = ['search', t, 0]
      else if ((state === 'search' || state === 'roam' || state === 'attack') && (seen[0] || seen[1])) {
        state = 'attack'
        if (seen[0] !== seen[1]) spinDir = seen[0] ? 1 : -1
      } else if (state === 'attack' && t - tSeen > lostS) [state, spun] = ['search', 0]
      else if (state === 'search' && spun >= 2 * Math.PI) state = 'roam'
      if (state === 'back') [tL, tR] = [-vMax, -vMax]
      else if (state === 'roam') [tL, tR] = [vMax, vMax]
      else if (state === 'away' || state === 'search') [tL, tR] = [-spinDir * spinV, spinDir * spinV]
      else if (seen[0] && seen[1]) [tL, tR] = [vMax, vMax]
      else if (seen[0] || seen[1]) [tL, tR] = seen[0] ? [vMax * 0.4, vMax] : [vMax, vMax * 0.4]
    }
    if (i % every === 0) frames.push({ t, pose, rival, state, tof, edge, dL, dR })
    const step = aMax * dt
    vL += clamp(tL - vL, -step, step)
    vR += clamp(tR - vR, -step, step)
    rv = rivalStep(rv, t, pose, (vL + vR) / 2, dt)
    pose = diffStep(pose, vL, vR, SUMO_BOT.track, dt)
    if (state === 'search') spun += (Math.abs(vR - vL) / SUMO_BOT.track) * dt
    dL += vL * dt
    dR += vR * dt
    const wheels = [1, -1].map((s) => toRoom(pose, SUMO_EDGE.axleX, s * SUMO_EDGE.wheelY))
    const rim = Math.min(...wheels.map((p) => R - Math.hypot(p[0], p[1])))
    closest = Math.min(closest, rim)
    if (rim < 0) [result, tEnd] = ['out', t]
    else {
      const face = [-1, 0, 1].some((s) => {
        const p = toRoom(pose, SUMO_BOT.len / 2 + 0.003, (s * SUMO_BOT.len) / 2.2)
        const q = rv.pose
        const [c, sn] = [Math.cos(q.th), Math.sin(q.th)]
        const [lx, ly] = [(p[0] - q.x) * c + (p[1] - q.y) * sn, -(p[0] - q.x) * sn + (p[1] - q.y) * c]
        return Math.max(Math.abs(lx), Math.abs(ly)) <= SUMO_RIVAL.side / 2
      })
      if (face) [result, tEnd] = ['hit', t]
    }
    if (result !== 'timeout') {
      frames.push({ t, pose, rival: rv.pose, state, tof, edge, dL, dR })
      break
    }
  }
  const last = frames[frames.length - 1]
  const toRival = Math.atan2(last.pose.y - last.rival.y, last.pose.x - last.rival.x)
  const hitDeg = Math.abs(((toRival - last.rival.th + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * (180 / Math.PI)
  return { frames, dt: dt * every, result, tEnd, edges, closest, hitDeg, dodges: rv.dodges }
}
