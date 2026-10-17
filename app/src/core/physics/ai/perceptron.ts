// Rosenblatt perceptron: step output, w ← w + lr·(t − y)·x on every mistake.
import { Sample } from './net'

export interface PerceptronStep { w: [number, number]; b: number; i: number; y: number; wrong: boolean }

export const perceptronOut = (w: readonly number[], b: number, x: readonly number[]) => (w[0] * x[0] + w[1] * x[1] + b > 0 ? 1 : 0)

/** Every sample presented in order for up to `epochs` passes; stops after a pass with no mistakes. */
export function perceptronRun(data: readonly Sample[], lr: number, epochs: number, w0: [number, number] = [0, 0], b0 = 0) {
  let w: [number, number] = [...w0]
  let b = b0
  const steps: PerceptronStep[] = []
  const mistakes: number[] = []
  let converged: number | null = null
  for (let e = 0; e < epochs; e++) {
    let m = 0
    data.forEach((d, i) => {
      const y = perceptronOut(w, b, d.x)
      const err = d.t[0] - y
      if (err) {
        w = [w[0] + lr * err * d.x[0], w[1] + lr * err * d.x[1]]
        b += lr * err
        m++
      }
      steps.push({ w, b, i, y, wrong: err !== 0 })
    })
    mistakes.push(m)
    if (!m) {
      converged = e
      break
    }
  }
  return { w, b, steps, mistakes, converged }
}
