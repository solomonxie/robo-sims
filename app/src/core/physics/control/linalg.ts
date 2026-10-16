// Small dense linear algebra: complex numbers, polynomials (constant first), matrices, Cholesky.

export interface Cx { re: number; im: number }
export const cx = (re: number, im = 0): Cx => ({ re, im })
const cmul = (a: Cx, b: Cx) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
export const cdiv = (a: Cx, b: Cx) => {
  const d = b.re * b.re + b.im * b.im
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d)
}
const csub = (a: Cx, b: Cx) => cx(a.re - b.re, a.im - b.im)

/** Polynomials as coefficient arrays, constant first. */
export const polyMul = (a: readonly number[], b: readonly number[]) => {
  const out = Array(a.length + b.length - 1).fill(0)
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j] += x * y)))
  return out
}
export const polyAdd = (a: readonly number[], b: readonly number[]) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0))

/** All complex roots (Durand–Kerner). */
export function polyRoots(c: readonly number[]): Cx[] {
  const lead = c[c.length - 1]
  const m = c.map((x) => x / lead)
  const deg = m.length - 1
  const evalAt = (z: Cx) => m.reduceRight((acc, k) => cx(acc.re * z.re - acc.im * z.im + k, acc.re * z.im + acc.im * z.re), cx(0))
  const r = 1 + Math.max(...m.slice(0, -1).map(Math.abs))
  let z = Array.from({ length: deg }, (_, k) => cmul(cx(r * 0.9), cx(Math.cos((2 * Math.PI * k) / deg + 0.4), Math.sin((2 * Math.PI * k) / deg + 0.4))))
  for (let it = 0; it < 500; it++) {
    let moved = 0
    z = z.map((zi, i) => {
      const den = z.reduce((acc, zj, j) => (j === i ? acc : cmul(acc, csub(zi, zj))), cx(1))
      const step = cdiv(evalAt(zi), den)
      moved = Math.max(moved, Math.hypot(step.re, step.im))
      return csub(zi, step)
    })
    if (moved < 1e-12 * r) break
  }
  return z.map((v) => cx(v.re, Math.abs(v.im) < 1e-9 * r ? 0 : v.im))
}

export type Mat = number[][]
export const eye = (n: number): Mat => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)))
export const diag = (d: readonly number[]): Mat => d.map((x, i) => d.map((_, j) => (i === j ? x : 0)))
export const transpose = (a: Mat): Mat => a[0].map((_, j) => a.map((r) => r[j]))
export const matMul = (a: Mat, b: Mat): Mat => a.map((r) => b[0].map((_, j) => r.reduce((s, x, k) => s + x * b[k][j], 0)))
export const matAdd = (a: Mat, b: Mat, k = 1): Mat => a.map((r, i) => r.map((x, j) => x + k * b[i][j]))
export const matScale = (a: Mat, k: number): Mat => a.map((r) => r.map((x) => x * k))
export const normInf = (a: Mat) => Math.max(...a.map((r) => r.reduce((s, x) => s + Math.abs(x), 0)))

/** Inverse by Gauss–Jordan with partial pivoting. */
export function matInv(a: Mat): Mat {
  const n = a.length
  const m = a.map((r, i) => [...r, ...eye(n)[i]])
  for (let c = 0; c < n; c++) {
    const p = m.slice(c).reduce((best, r, k) => (Math.abs(r[c]) > Math.abs(m[best][c]) ? c + k : best), c)
    ;[m[c], m[p]] = [m[p], m[c]]
    const d = m[c][c]
    m[c] = m[c].map((x) => x / d)
    for (let r = 0; r < n; r++) if (r !== c) m[r] = m[r].map((x, j) => x - m[r][c] * m[c][j])
  }
  return m.map((r) => r.slice(n))
}

/** e^M by scaling and squaring of a Taylor series. */
export function expm(m: Mat): Mat {
  const s = Math.max(0, Math.ceil(Math.log2(normInf(m) || 1)) + 1)
  const a = matScale(m, 2 ** -s)
  let term = eye(m.length)
  let sum = eye(m.length)
  for (let k = 1; k <= 16; k++) {
    term = matScale(matMul(term, a), 1 / k)
    sum = matAdd(sum, term)
  }
  for (let i = 0; i < s; i++) sum = matMul(sum, sum)
  return sum
}

/** Characteristic polynomial det(sI − M), constant first (Faddeev–LeVerrier). */
export function charPoly(m: Mat): number[] {
  const n = m.length
  const c = Array(n + 1).fill(0)
  c[n] = 1
  let Mk = eye(n).map((r) => r.map(() => 0))
  for (let k = 1; k <= n; k++) {
    Mk = matAdd(matMul(m, Mk), eye(n), c[n - k + 1])
    const AM = matMul(m, Mk)
    c[n - k] = -AM.reduce((s, r, i) => s + r[i], 0) / k
  }
  return c
}
export const eigenvalues = (m: Mat): Cx[] => polyRoots(charPoly(m))

/** Solves H·x = b for symmetric positive definite H (Cholesky). */
export function cholSolve(H: Mat, b: readonly number[]): number[] {
  const n = b.length
  const L: Mat = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = H[i][j]
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-300)) : s / L[j][j]
    }
  const y = Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    let s = b[i]
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k]
    y[i] = s / L[i][i]
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]
    for (let k = i + 1; k < n; k++) s -= L[k][i] * y[k]
    y[i] = s / L[i][i]
  }
  return y
}
