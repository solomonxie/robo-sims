import { BALANCER, fallTau } from '../mobility/balance'
import { charPoly, cholSolve, eigenvalues, expm, matInv, matMul, polyRoots } from './linalg'
import { balancerModel } from './lqr'

test('polyRoots finds real and complex roots', () => {
  const r = polyRoots([6, -5, 1]).map((z) => z.re).sort()
  expect(r[0]).toBeCloseTo(2, 9)
  expect(r[1]).toBeCloseTo(3, 9)
  const c = polyRoots([5, 2, 1])
  expect(c.every((z) => Math.abs(z.re + 1) < 1e-9 && Math.abs(Math.abs(z.im) - 2) < 1e-9)).toBe(true)
})

test('matrix helpers: inverse, e^M, characteristic polynomial', () => {
  const a = [[4, 7], [2, 6]]
  expect(matMul(a, matInv(a)).flat().map((x) => Math.round(x * 1e9) / 1e9)).toEqual([1, 0, 0, 1])
  const r = expm([[0, 1], [-1, 0]])
  expect(r[0][0]).toBeCloseTo(Math.cos(1), 12)
  expect(r[0][1]).toBeCloseTo(Math.sin(1), 12)
  expect(charPoly([[2, 0], [0, 3]])).toEqual([6, -5, 1])
  expect(eigenvalues(balancerModel().A).map((z) => z.re).sort((x, y) => x - y)[3]).toBeCloseTo(1 / fallTau(BALANCER.h), 6)
})

test('Cholesky solve matches the inverse', () => {
  const H = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]]
  const b = [1, -2, 0.5]
  const want = matMul(matInv(H), b.map((x) => [x])).map((r) => r[0])
  cholSolve(H, b).forEach((x, i) => expect(x).toBeCloseTo(want[i], 12))
})
