// Constants and helpers shared across physics domains.

/** Speed of light in vacuum, m/s. */
export const LIGHT_C = 299_792_458
/** Speed of sound most sketches bake in (dry air, 20 °C), m/s. */
export const SOUND_C = 343
/** Standard gravity, m/s². */
export const G = 9.81
export const weightN = (kg: number) => kg * G
export const DEG = Math.PI / 180
export const toDeg = (rad: number) => rad / DEG
export const mean = (xs: readonly number[]) => xs.reduce((a, x) => a + x, 0) / xs.length
/** Population standard deviation. */
export const stdDev = (xs: readonly number[]) => {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length)
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
export const clamp01 = (x: number) => clamp(x, 0, 1)
/** Smooth 0…1 ease (3x² − 2x³), clamped. */
export const smoothstep = (u: number) => {
  const x = clamp01(u)
  return x * x * (3 - 2 * x)
}
export const dist3 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
/** `n` evenly spaced values lo…hi (both ends included). */
export const sweep = (lo: number, hi: number, n: number) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1))
/** Edge between `yes` (ok) and `no` (not ok) after `n` halvings; returns the last point found ok. */
export function bisectEdge(ok: (x: number) => boolean, yes: number, no: number, n = 40) {
  for (let k = 0; k < n; k++) {
    const mid = (yes + no) / 2
    if (ok(mid)) yes = mid
    else no = mid
  }
  return yes
}
/** Root of `f` (positive below it) in [lo, hi] after `n` halvings. */
export function bisectRoot(f: (x: number) => number, lo: number, hi: number, n = 60) {
  for (let k = 0; k < n; k++) {
    const m = (lo + hi) / 2
    if (f(m) > 0) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

/** Sample of a fixed-step run (`dt` apart) at time `t`, held at the ends. */
export const fixedStepAt = <T>(run: readonly T[], t: number, dt: number) => run[clamp(Math.floor(t / dt), 0, run.length - 1)]

/** Computes `f` on first call, then returns the cached value. */
export const once = <T>(f: () => T) => {
  let v: T | undefined
  return () => (v ??= f())
}

export const TAU = 2 * Math.PI
export const frac = (x: number) => x - Math.floor(x)
export const wrap2pi = (a: number) => ((a % TAU) + TAU) % TAU
export const wrapPi = (a: number) => wrap2pi(a + Math.PI) - Math.PI

/** Repeatable 0…1 for integer `i` (sine hash). */
export const hash01 = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}
/** Deterministic standard normal for index `k` (sine hash + Box–Muller), so noise looks random but tests are stable. */
export function gaussAt(k: number) {
  const u = (i: number) => clamp(hash01(i), 1e-12, 1 - 1e-12)
  return Math.sqrt(-2 * Math.log(u(2 * k + 1))) * Math.cos(2 * Math.PI * u(2 * k + 2))
}

/** Same seed → same numbers in [0, 1) (sine hash). */
export function seededRng(seed: number) {
  let k = 0
  return () => hash01(seed * 7919 + ++k * 31.7)
}
/** Fast seeded uniform (0, 1), Park–Miller, for runs drawing ~10⁵ numbers. */
export function parkMiller(seed: number) {
  let x = (Math.abs(Math.floor(seed)) % 2147483646) + 1
  return () => {
    x = 48271 * (x % 44488) - 3399 * Math.floor(x / 44488)
    if (x <= 0) x += 2147483647
    return x / 2147483647
  }
}
/** Standard normal from a uniform rng. */
export function gaussRng(rng: () => number) {
  return () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng())
}

export class MinHeap<T> {
  private a: T[] = []
  constructor(private less: (x: T, y: T) => boolean) {}
  get size() {
    return this.a.length
  }
  peek(): T | undefined {
    return this.a[0]
  }
  push(v: T) {
    const a = this.a
    a.push(v)
    for (let i = a.length - 1; i > 0; ) {
      const p = Math.floor((i - 1) / 2)
      if (!this.less(a[i], a[p])) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop(): T | undefined {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (a.length && last !== undefined) {
      a[0] = last
      for (let i = 0; ; ) {
        const l = 2 * i + 1
        let m = i
        if (l < a.length && this.less(a[l], a[m])) m = l
        if (l + 1 < a.length && this.less(a[l + 1], a[m])) m = l + 1
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}
