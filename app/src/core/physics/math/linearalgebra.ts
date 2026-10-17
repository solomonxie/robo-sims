// Linear algebra: least-squares line fit via the normal equations; 2×2 eigenvectors, repeated maps and PCA of a lidar wall.
import { V2 } from '../kinematics/transforms'
import { gaussRng, parkMiller } from '../common'
import { symEig } from '../control/linalg'
import { Mat2, apply2, inv2 } from './matrices'

// --- Least squares: motor duty d (0…1) vs measured wheel speed v (m/s), fit v = m·d + c. ---

export const MOTOR_CAL = { m: 0.62, c: -0.07, duties: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], slips: [[], [6], [2, 7]] as number[][], slipKeep: 0.45 }

/** Calibration readings with Gaussian noise `sigma` (m/s); `outliers` = 0/1/2 readings where the wheel slipped (speed × slipKeep). */
export function motorCalPoints(sigma: number, outliers: number, seed = 5) {
  const g = gaussRng(parkMiller(seed * 7919 + 13))
  const bad = MOTOR_CAL.slips[Math.max(0, Math.min(2, outliers))]
  const xs = [...MOTOR_CAL.duties]
  const ys = xs.map((d, i) => {
    const v = MOTOR_CAL.m * d + MOTOR_CAL.c + sigma * g()
    return bad.includes(i) ? v * MOTOR_CAL.slipKeep : v
  })
  return { xs, ys, bad }
}

/** Normal equations AᵀA·[m c] = Aᵀb for rows [x 1]; null when AᵀA is singular. */
export function lineNormalEq(xs: readonly number[], ys: readonly number[]) {
  let [sxx, sx, sxy, sy] = [0, 0, 0, 0]
  xs.forEach((x, i) => {
    sxx += x * x
    sx += x
    sxy += x * ys[i]
    sy += ys[i]
  })
  const AtA: Mat2 = [sxx, sx, sx, xs.length]
  const Atb: V2 = [sxy, sy]
  const inv = inv2(AtA)
  const sol = inv ? apply2(inv, Atb) : null
  return { AtA, Atb, inv, m: sol ? sol[0] : NaN, c: sol ? sol[1] : NaN }
}

export const sumSquares = (xs: readonly number[], ys: readonly number[], m: number, c: number) => xs.reduce((s, x, i) => s + (ys[i] - (m * x + c)) ** 2, 0)

/**
 * Best line by least squares, and a trial line whose slope is off by `nudge` (pivoting on the centroid, which the best line
 * always passes through): residuals, sum of squares, its parabola in slope, the fit without slipped readings and the deadband d where v = 0.
 */
export function leastSquaresView(sigma: number, outliers: number, nudge: number) {
  const { xs, ys, bad } = motorCalPoints(sigma, outliers)
  const N = lineNormalEq(xs, ys)
  const [mx, my] = [xs.reduce((s, x) => s + x, 0) / xs.length, ys.reduce((s, y) => s + y, 0) / ys.length]
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0)
  const tm = N.m + nudge
  const tc = my - tm * mx
  const residuals = xs.map((x, i) => ys[i] - (tm * x + tc))
  const best = sumSquares(xs, ys, N.m, N.c)
  const keep = xs.map((_, i) => i).filter((i) => !bad.includes(i))
  const clean = lineNormalEq(keep.map((i) => xs[i]), keep.map((i) => ys[i]))
  return {
    xs,
    ys,
    bad,
    fit: N,
    centroid: [mx, my] as V2,
    trial: { m: tm, c: tc },
    residuals,
    sse: sumSquares(xs, ys, tm, tc),
    best,
    sseAt: (m: number) => best + (m - N.m) ** 2 * sxx,
    clean,
    pull: N.m - clean.m,
    deadband: -N.c / N.m,
  }
}

// --- Eigenvectors of a 2×2: directions M only stretches, by λ. ---

/** Eigenvalues (λ1 ≥ λ2 when real) and unit eigenvectors; complex pairs give re ± i·im and no vectors. */
export function eig2(M: Mat2) {
  const [a, b, c, d] = M
  const tr = a + d
  const det = a * d - b * c
  const disc = (tr * tr) / 4 - det
  if (disc < -1e-12) {
    const im = Math.sqrt(-disc)
    return { real: false as const, tr, det, values: [] as number[], vectors: [] as V2[], re: tr / 2, im, radius: Math.hypot(tr / 2, im) }
  }
  const r = Math.sqrt(Math.max(0, disc))
  const values = [tr / 2 + r, tr / 2 - r]
  const vecOf = (l: number, i: number): V2 => {
    const cand: V2[] = [[b, l - a], [l - d, c]]
    const v = Math.hypot(...cand[0]) >= Math.hypot(...cand[1]) ? cand[0] : cand[1]
    const len = Math.hypot(...v)
    if (len < 1e-12) return i ? [0, 1] : [1, 0]
    return v[0] < -1e-12 || (Math.abs(v[0]) <= 1e-12 && v[1] < 0) ? [-v[0] / len, -v[1] / len] : [v[0] / len, v[1] / len]
  }
  const vectors = values.map(vecOf)
  return { real: true as const, tr, det, values, vectors, re: tr / 2, im: 0, radius: Math.max(...values.map(Math.abs)) }
}

/** Signed turn (rad) from v to M·v, and stretch |M·v|, for the unit vector at angle phi. */
export function turnOf(M: Mat2, phi: number) {
  const v: V2 = [Math.cos(phi), Math.sin(phi)]
  const w = apply2(M, v)
  return { v, w, turn: Math.atan2(v[0] * w[1] - v[1] * w[0], v[0] * w[0] + v[1] * w[1]), stretch: Math.hypot(...w) }
}

/** M^k·v for k = 0…steps. */
export function repeatMap(M: Mat2, v: V2, steps: number) {
  const out: V2[] = [v]
  for (let k = 0; k < steps; k++) out.push(apply2(M, out[k]))
  return out
}

/** Probe at phi, eigen data, eigen-directions (0…π), the probe's angle to the nearest one, and stability of x(k+1) = M·x(k): every |λ| < 1. */
export function eigenView(M: Mat2, phi: number, steps = 10) {
  const E = eig2(M)
  const probe = turnOf(M, phi)
  const iterates = repeatMap(M, probe.v, steps)
  const eigenAngles = E.vectors.map((v) => ((Math.atan2(v[1], v[0]) % Math.PI) + Math.PI) % Math.PI)
  const nearest = eigenAngles.length ? Math.min(...eigenAngles.map((a) => Math.abs(((phi - a + Math.PI * 1.5) % Math.PI) - Math.PI / 2))) : Infinity
  return { E, probe, iterates, eigenAngles, nearest, stable: E.radius < 1, growth: E.radius }
}

// --- PCA: covariance of a lidar wall segment; its top eigenvector is the wall direction. ---

export const WALL_SCAN = { len: 1.2, count: 40, sigma: 0.025 }

/** Lidar hits along a wall at `angle` (rad) with range noise; covariance, eigen-axes and the fitted wall angle (0…π). */
export function wallPca(angle: number, sigma = WALL_SCAN.sigma, seed = 3) {
  const rng = parkMiller(seed * 104729 + 11)
  const g = gaussRng(rng)
  const [ux, uy] = [Math.cos(angle), Math.sin(angle)]
  const pts: V2[] = Array.from({ length: WALL_SCAN.count }, (_, i) => {
    const s = (i / (WALL_SCAN.count - 1) - 0.5) * WALL_SCAN.len
    const e = sigma * g()
    return [s * ux - e * uy, s * uy + e * ux]
  })
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length
  let [sxx, sxy, syy] = [0, 0, 0]
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2
    sxy += (x - mx) * (y - my)
    syy += (y - my) ** 2
  }
  const k = pts.length - 1
  const cov: Mat2 = [sxx / k, sxy / k, sxy / k, syy / k]
  const { values, vectors } = symEig([[cov[0], cov[1]], [cov[2], cov[3]]])
  const dir = vectors[0] as V2
  const fitted = ((Math.atan2(dir[1], dir[0]) % Math.PI) + Math.PI) % Math.PI
  return { pts, mean: [mx, my] as V2, cov, values, vectors: vectors as V2[], fitted, along: Math.sqrt(values[0]), across: Math.sqrt(Math.max(0, values[1])) }
}
