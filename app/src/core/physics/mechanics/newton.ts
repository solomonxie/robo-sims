// Newton's laws on a robot car: push and coast, forces on a ramp, static vs kinetic friction.
import { G } from '../common'
import { TT_CAR } from '../actuators/dcmotor'
import { ROLL_FLOORS } from '../control/loop'

/** TT car on tile: chassis mass and rolling resistance. */
export const NEWTON_CAR = { massKg: TT_CAR.massKg, crr: ROLL_FLOORS.tile.crr }

interface PushFrame {
  t: number
  x: number
  v: number
  a: number
  drive: number
  roll: number
  net: number
}

/** Motor force `force` N for `pushFor` s, then coast; rolling resistance crr·m·g opposes motion. */
export function pushRun({ force, mass, crr = NEWTON_CAR.crr, pushFor, seconds, dt = 0.005 }: { force: number; mass: number; crr?: number; pushFor: number; seconds: number; dt?: number }) {
  const out: PushFrame[] = []
  const rr = crr * mass * G
  let x = 0
  let v = 0
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const t = i * dt
    const drive = t < pushFor ? force : 0
    const roll = v > 1e-9 ? -rr : -Math.min(rr, Math.max(0, drive))
    const net = drive + roll
    const a = net / mass
    out.push({ t, x, v, a, drive, roll, net })
    const vNext = v + a * dt
    v = v > 0 && vNext < 0 ? 0 : Math.max(0, vNext)
    x += v * dt
  }
  return out
}

/** Forces on a car of `mass` on a ramp of `theta` rad with a drive force up the slope (wheels roll freely). */
export function inclineForces(mass: number, theta: number, drive: number) {
  const w = mass * G
  const wPar = w * Math.sin(theta)
  const wPerp = w * Math.cos(theta)
  const net = drive - wPar
  return { w, wPar, wPerp, n: wPerp, net, a: net / mass }
}

interface RampFrame {
  t: number
  s: number
  v: number
}

/** Position `s` along the slope (0 = middle, + up) under `inclineForces`; stops at ±`half` m. */
export function rampRun({ mass, theta, drive, half, seconds, dt = 0.005 }: { mass: number; theta: number; drive: number; half: number; seconds: number; dt?: number }) {
  const { a } = inclineForces(mass, theta, drive)
  const out: RampFrame[] = []
  let s = 0
  let v = 0
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    out.push({ t: i * dt, s, v })
    v += a * dt
    s += v * dt
    if (Math.abs(s) >= half) [s, v] = [Math.sign(s) * half, 0]
  }
  return out
}

/** Static and kinetic friction coefficients for a robot pushed with locked wheels or skids. */
export const FRICTION_PAIRS = {
  concrete: { name: 'Rubber on concrete', mus: 1.0, muk: 0.8 },
  tile: { name: 'Rubber on tile', mus: 0.7, muk: 0.5 },
  wood: { name: 'PLA skid on wood', mus: 0.4, muk: 0.3 },
  ptfe: { name: 'PTFE skid on steel', mus: 0.06, muk: 0.04 },
}

interface FrictionFrame {
  t: number
  push: number
  fric: number
  v: number
  x: number
  slipping: boolean
}

/** Push ramps at `rate` N/s until the block breaks free, is held for `hold` s, then released; friction opposes. */
export function frictionRun({ mass, mus, muk, rate, hold, seconds, dt = 0.005 }: { mass: number; mus: number; muk: number; rate: number; hold: number; seconds: number; dt?: number }) {
  const n = mass * G
  const out: FrictionFrame[] = []
  let x = 0
  let v = 0
  let broke: number | null = null
  let held = 0
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const t = i * dt
    const ramp = rate * t
    if (broke === null && ramp > mus * n) [broke, held] = [t, ramp]
    const push = broke === null ? ramp : t < broke + hold ? held : 0
    const moving = v > 1e-9 || (broke !== null && push > 0)
    const fric = moving ? -muk * n : -Math.min(push, mus * n)
    out.push({ t, push, fric, v, x, slipping: moving })
    const vNext = v + ((push + fric) / mass) * dt
    v = moving && vNext < 0 ? 0 : Math.max(0, vNext)
    x += v * dt
  }
  return { run: out, breakAt: broke, breakN: mus * n, kineticN: muk * n }
}
