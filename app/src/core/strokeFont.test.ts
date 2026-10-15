import { hasGlyph, layoutText } from './strokeFont'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+−×÷=.,/:%Ωµ°-()<>_\'"?!·#*²λ;{}&±…≥≤≈→[]'

describe('strokeFont', () => {
  it('has strokes for every supported character', () => {
    for (const ch of CHARS) {
      expect(hasGlyph(ch)).toBe(true)
      expect(layoutText(ch).lines.length).toBeGreaterThan(0)
    }
  })

  it('keeps glyphs within the em box', () => {
    for (const ch of CHARS) {
      const { lines, width } = layoutText(ch)
      for (const [x, y] of lines.flat()) {
        expect(x).toBeGreaterThanOrEqual(-0.2)
        expect(x).toBeLessThanOrEqual(width + 0.2)
        expect(y).toBeGreaterThanOrEqual(-0.4)
        expect(y).toBeLessThanOrEqual(1.1)
      }
    }
  })

  it('advances left to right with spacing', () => {
    const one = layoutText('H').width
    expect(layoutText('HH').width).toBeCloseTo(2 * one + 1.4 / 6)
    expect(layoutText('').width).toBe(0)
    expect(layoutText('').lines).toEqual([])
  })

  it('draws a combining overline over the previous glyph only', () => {
    const plain = layoutText('Q')
    const bar = layoutText('Q̄')
    expect(bar.width).toBe(plain.width)
    expect(bar.lines.length).toBe(plain.lines.length + 1)
    const [[x0, y], [x1]] = bar.lines.at(-1)!
    expect(y).toBeGreaterThan(1)
    expect([x0, x1]).toEqual([0, plain.width])
  })

  it('draws math symbols as distinct strokes', () => {
    expect(layoutText('±').lines.length).toBe(3)
    expect(layoutText('…').lines.length).toBe(3)
    const ge = layoutText('≥').lines[0]
    const le = layoutText('≤').lines[0]
    expect(ge[1][0]).toBeGreaterThan(ge[0][0])
    expect(le[1][0]).toBeLessThan(le[0][0])
  })

  it('renders unknown characters as a gap', () => {
    expect(layoutText('~').lines).toEqual([])
    expect(layoutText('A~A').width).toBeGreaterThan(layoutText('AA').width)
  })
})
