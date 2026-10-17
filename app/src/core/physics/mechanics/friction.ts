// Friction & traction: stick-slip drag on a spring, rolling resistance from deformation, wheel slip and weight transfer.
import { G } from '../common'
import { TT_CAR, TT_GEAR, GEARBOXES, gearEfficiency, shaftTorque } from '../actuators/dcmotor'

/** A 1 kg parts box dragged by a robot through a spring; `damp` N·s/m is the box's sliding damping. */
export const STICK_SLIP = { boxKg: 1, damp: 1.5 }

export interface StickFrame {
  t: number
  xr: number
  xb: number
  vb: number
  spring: number
  stuck: boolean
}

/** Robot drives at `speed`; spring `k` pulls the box; static μs·N holds it until exceeded, then μk·N + damping. */
export function stickSlipRun({ mus, muk, k, speed, seconds, mass = STICK_SLIP.boxKg, damp = STICK_SLIP.damp, dt = 0.002 }: { mus: number; muk: number; k: number; speed: number; seconds: number; mass?: number; damp?: number; dt?: number }) {
  const n = mass * G
  const out: StickFrame[] = []
  let xb = 0
  let vb = 0
  let stuck = true
  let slips = 0
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const t = i * dt
    const xr = speed * t
    const spring = k * (xr - xb)
    if (stuck && Math.abs(spring) > mus * n) [stuck, slips] = [false, slips + 1]
    out.push({ t, xr, xb, vb, spring, stuck })
    if (stuck) continue
    const vNext = vb + ((spring - muk * n * Math.sign(vb || spring) - damp * vb) / mass) * dt
    if (vNext <= 0 && Math.abs(k * (xr - xb)) <= mus * n) [vb, stuck] = [0, true]
    else vb = vNext
    xb += vb * dt
  }
  const late = out.filter((f) => f.t > seconds / 3)
  const hi = Math.max(...late.map((f) => f.spring))
  const lo = Math.min(...late.map((f) => f.spring))
  return { run: out, slips, swing: hi - lo, staticN: mus * n, kineticN: muk * n, sticking: late.some((f) => f.stuck) }
}

/** Tilt test: the box slips when tan θ > μs, so the slip angle measures μs. */
export const slipAngle = (mus: number) => Math.atan(mus)

/** Wheels: radius m, tyre stiffness N/m, hysteresis (share of deformation energy lost). */
export const WHEEL_TYPES = {
  tt: { name: 'TT 65 mm rubber', r: 0.0325, k: 4000, loss: 0.1 },
  hard: { name: '40 mm hard PLA', r: 0.02, k: 80000, loss: 0.08 },
  foam: { name: '65 mm soft foam', r: 0.0325, k: 1200, loss: 0.15 },
  big: { name: '100 mm pneumatic', r: 0.05, k: 5000, loss: 0.06 },
}
export type WheelType = keyof typeof WHEEL_TYPES

/** Floors: stiffness N/m under a small wheel and hysteresis. */
export const ROLL_SURFACES = {
  tile: { name: 'Tile', k: 2e6, loss: 0.1 },
  wood: { name: 'Wood', k: 8000, loss: 0.3 },
  carpet: { name: 'Carpet', k: 800, loss: 0.4 },
  grass: { name: 'Lawn', k: 300, loss: 0.55 },
}
export type RollSurface = keyof typeof ROLL_SURFACES

/** One wheel carrying `loadN`: tyre and floor squash (series springs), the contact runs ±a, and hysteresis shifts the
 *  floor's push ahead of the axle by e; rolling resistance F = N·e/r, so Crr = e/r. */
export function rollingDrag(wheel: WheelType, surface: RollSurface, loadN: number) {
  const w = WHEEL_TYPES[wheel]
  const s = ROLL_SURFACES[surface]
  const tyre = loadN / w.k
  const floor = loadN / s.k
  const sink = tyre + floor
  const a = Math.sqrt(2 * w.r * sink)
  const loss = (w.loss * tyre + s.loss * floor) / sink
  const e = loss * a
  const crr = e / w.r
  return { tyre, floor, a, e, crr, force: crr * loadN }
}

/** Robot of `massKg` on four wheels at `speed`: rolling force, power and energy per metre. */
export function rollingCost(wheel: WheelType, surface: RollSurface, massKg: number, speed: number) {
  const d = rollingDrag(wheel, surface, (massKg * G) / 4)
  const force = 4 * d.force
  return { ...d, total: force, power: force * speed, perMetre: force }
}

/** Tyre grip vs slip ratio κ (magic-formula shape): peaks at μ at κ = 0.15, falls to ~⅔ μ at full spin. */
export const SLIP_PEAK = 0.15
const SHAPE = 1.65
const STIFF = Math.tan(Math.PI / (2 * SHAPE)) / SLIP_PEAK
export const tractionMu = (mu: number, kappa: number) => mu * Math.sin(SHAPE * Math.atan(STIFF * kappa))

/** κ = (ω r − v) / max(|ω r|, |v|): 0 rolling, 1 spinning in place, −1 locked and skidding; below `floor` m/s
 *  the slip speed is taken relative to `floor` (tyre relaxation), so a launch is not an instant 100 %. */
export const slipRatio = (rim: number, v: number, floor = 0.3) => (rim - v) / Math.max(Math.abs(rim), Math.abs(v), floor)

/** TT car side-on: wheelbase, centre-of-mass height, payload height, rotor inertia seen at each wheel. */
export const TRACTION_CAR = { wheelbase: 0.13, comM: 0.045, loadM: 0.075, wheelJ: 3e-4, crr: 0.015, backstop: 0.3 }
export type DriveAxles = 'rear' | 'front' | 'all'

/** Axle loads on a slope `theta` while accelerating at `a` (weight shifts to the rear going uphill / speeding up). */
export function axleLoads(massKg: number, comM: number, theta: number, a: number, wheelbase = TRACTION_CAR.wheelbase) {
  const shift = (massKg * (G * Math.sin(theta) + a) * comM) / wheelbase
  const rear = Math.max(0, (massKg * G * Math.cos(theta)) / 2 + shift)
  return { rear, front: Math.max(0, massKg * G * Math.cos(theta) - rear) }
}

export interface TractionFrame {
  t: number
  x: number
  v: number
  a: number
  rim: [number, number]
  turn: [number, number]
  kappa: [number, number]
  load: [number, number]
  push: [number, number]
}

/** Step `volts` to TT motors on the driven axles (rear, front) from rest on a slope; each axle's grip is
 *  tractionMu(μ, κ)·N with N from axleLoads; a stop `backstop` m downhill catches a car that slides back. */
export function tractionRun({ mu, volts, theta, drive, loadKg, seconds, dt = 0.0005 }: { mu: number; volts: number; theta: number; drive: DriveAxles; loadKg: number; seconds: number; dt?: number }) {
  const { comM, loadM, wheelJ, crr } = TRACTION_CAR
  const m = TT_CAR.massKg + loadKg
  const h = (TT_CAR.massKg * comM + loadKg * loadM) / m
  const r = TT_CAR.wheelM
  const eff = gearEfficiency(GEARBOXES.tt48)
  const driven = [drive !== 'front', drive !== 'rear']
  const J = 2 * wheelJ
  const out: TractionFrame[] = []
  const w: [number, number] = [0, 0]
  const turn: [number, number] = [0, 0]
  let x = 0
  let v = 0
  let a = 0
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const t = i * dt
    const ld = axleLoads(m, h, theta, a)
    const load: [number, number] = [ld.rear, ld.front]
    const kappa: [number, number] = [0, 0]
    const push: [number, number] = [0, 0]
    for (const k of [0, 1]) {
      kappa[k] = slipRatio(w[k] * r, v)
      push[k] = tractionMu(mu, kappa[k]) * load[k]
    }
    out.push({ t, x, v, a, rim: [w[0] * r, w[1] * r], turn: [...turn], kappa, load, push })
    const roll = crr * (load[0] + load[1]) * Math.sign(v)
    a = (push[0] + push[1] - m * G * Math.sin(theta) - roll) / m
    for (const k of [0, 1]) {
      const motor = driven[k] ? 2 * Math.max(0, shaftTorque(volts, w[k] * TT_GEAR)) * TT_GEAR * eff : 0
      w[k] += ((motor - push[k] * r) / J) * dt
      if (!driven[k]) w[k] = v / r
      turn[k] += w[k] * r * dt
    }
    v += a * dt
    x += v * dt
    if (x < -TRACTION_CAR.backstop) [x, v] = [-TRACTION_CAR.backstop, Math.max(0, v)]
  }
  return out
}

/** Steady-state summary: peak grip on the driven axles vs the pull needed, and the steepest climbable slope. */
export function tractionLimit(mu: number, theta: number, drive: DriveAxles, loadKg: number) {
  const { comM, loadM, crr } = TRACTION_CAR
  const m = TT_CAR.massKg + loadKg
  const h = (TT_CAR.massKg * comM + loadKg * loadM) / m
  const gripAt = (th: number) => {
    const l = axleLoads(m, h, th, 0)
    return mu * (drive === 'rear' ? l.rear : drive === 'front' ? l.front : l.rear + l.front)
  }
  const needAt = (th: number) => m * G * (Math.sin(th) + crr * Math.cos(th))
  let lo = 0
  let hi = Math.PI / 2
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (gripAt(mid) >= needAt(mid)) lo = mid
    else hi = mid
  }
  const l = axleLoads(m, h, theta, 0)
  return { grip: gripAt(theta), need: needAt(theta), maxSlope: lo, rear: l.rear, front: l.front }
}
