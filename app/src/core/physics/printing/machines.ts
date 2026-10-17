// Printer kinematics: Cartesian bed slinger, CoreXY (A = X + Y, B = X − Y) and linear delta (tower carriage IK).
import { TAU } from '../common'

/** Moving mass (kg) for X and Y moves, typical 220 mm printers. */
export const PRINTER_KINDS = {
  cartesian: { name: 'Cartesian bed slinger', motors: ['X', 'Y', 'Z'], massX: 0.45, massY: 1.4 },
  corexy: { name: 'CoreXY', motors: ['A', 'B', 'Z'], massX: 0.3, massY: 0.75 },
  delta: { name: 'Delta', motors: ['A', 'B', 'C'], massX: 0.25, massY: 0.25 },
}
export type PrinterKind = keyof typeof PRINTER_KINDS

/** Tower radius (carriage joint to effector joint, horizontal) and arm length, mm. */
export const DELTA = { R: 105, L: 215 }
export const deltaTower = (i: number): [number, number] => {
  const a = Math.PI / 2 + (i * TAU) / 3
  return [DELTA.R * Math.cos(a), DELTA.R * Math.sin(a)]
}

/** Carriage height on each tower for the nozzle at (x, y, z): z + √(L² − d²), d = horizontal distance to the tower. */
export const deltaCarriages = (x: number, y: number, z: number) =>
  [0, 1, 2].map((i) => {
    const [tx, ty] = deltaTower(i)
    return z + Math.sqrt(Math.max(0, DELTA.L ** 2 - (x - tx) ** 2 - (y - ty) ** 2))
  })

export const coreXY = (x: number, y: number): [number, number] => [x + y, x - y]
export const coreXYInverse = (a: number, b: number): [number, number] => [(a + b) / 2, (a - b) / 2]

export function motorTargets(kind: PrinterKind, x: number, y: number, z: number): number[] {
  if (kind === 'cartesian') return [x, y, z]
  if (kind === 'corexy') return [...coreXY(x, y), z]
  return deltaCarriages(x, y, z)
}

export const PRINT_MOVES = {
  x: { name: 'X move' },
  y: { name: 'Y move' },
  diag: { name: 'Diagonal' },
  circle: { name: 'Circle' },
}
export type PrintMove = keyof typeof PRINT_MOVES
export const MOVE_MM = 40

/** Nozzle (x, y) mm at u ∈ [0, 1] of a constant-speed back-and-forth move (or a circle). */
export function movePath(m: PrintMove, u: number): [number, number] {
  const s = MOVE_MM * (1 - 4 * Math.abs((((u % 1) + 1) % 1) - 0.5))
  if (m === 'x') return [s, 0]
  if (m === 'y') return [0, s]
  if (m === 'diag') return [s * Math.SQRT1_2, s * Math.SQRT1_2]
  return [MOVE_MM * Math.cos(TAU * u), MOVE_MM * Math.sin(TAU * u)]
}

const PATH_N = 120
const ACCEL = 3000

/** Per kind: which motors turn, their peak speed (mm/s of belt or carriage) at nozzle speed `speed`, mass moved, force at 3000 mm/s². */
export function machineView(move: PrintMove, speed: number, z = 0) {
  const pts = Array.from({ length: PATH_N + 1 }, (_, i) => movePath(move, i / PATH_N))
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  const dt = len / speed / PATH_N
  const kinds = (Object.keys(PRINTER_KINDS) as PrinterKind[]).map((kind) => {
    const K = PRINTER_KINDS[kind]
    const m = pts.map(([x, y]) => motorTargets(kind, x, y, z))
    const peak = K.motors.map((_, j) => {
      let v = 0
      for (let i = 1; i < m.length; i++) v = Math.max(v, Math.abs(m[i][j] - m[i - 1][j]) / dt)
      return v
    })
    const travel = K.motors.map((_, j) => Math.max(...m.map((r) => r[j])) - Math.min(...m.map((r) => r[j])))
    const hasX = pts.some(([x]) => Math.abs(x) > 1e-6)
    const hasY = pts.some(([, y]) => Math.abs(y) > 1e-6)
    const mass = Math.max(hasX ? K.massX : 0, hasY ? K.massY : 0)
    return { kind, peak, travel, moving: travel.map((t) => t > 1e-3), mass, forceN: mass * ACCEL * 1e-3 }
  })
  return { len, period: len / speed, kinds }
}
