/** Low-discrepancy sequence in 0..1 (base `b`): pair bases 2 and 3 to scatter points evenly. */
export const halton = (i: number, b: number) => {
  let f = 1
  let r = 0
  for (let k = i + 1; k > 0; k = Math.floor(k / b)) {
    f /= b
    r += f * (k % b)
  }
  return r
}
