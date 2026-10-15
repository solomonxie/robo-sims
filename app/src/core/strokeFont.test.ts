import { hasGlyph, layoutText } from './strokeFont'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+−×÷=.,/:%Ωµ°-()<>_\'"?!·#*²¹³⁺⁻λ;{}&±…≥≤≈→[]–—~^`|\\$@←↑↓↔↕⇄✓✗⚡‘’“”'

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

  it('raises superscripts above the x-height', () => {
    for (const ch of '¹²³⁺⁻') {
      const ys = layoutText(ch).lines.flat().map(([, y]) => y)
      expect(Math.min(...ys)).toBeGreaterThan(0.5)
    }
    expect(layoutText('e⁻').width).toBeLessThan(layoutText('e-').width)
  })

  it('draws math symbols as distinct strokes', () => {
    expect(layoutText('±').lines.length).toBe(3)
    expect(layoutText('…').lines.length).toBe(3)
    const ge = layoutText('≥').lines[0]
    const le = layoutText('≤').lines[0]
    expect(ge[1][0]).toBeGreaterThan(ge[0][0])
    expect(le[1][0]).toBeLessThan(le[0][0])
  })

  it('curls opening and closing quotes opposite ways', () => {
    const [open] = layoutText('‘').lines
    const [close] = layoutText('’').lines
    expect(open[open.length - 1][1]).toBeLessThan(open[0][1])
    expect(open[1][0]).toBeLessThan(open[0][0])
    expect(close[1][0]).toBeGreaterThan(close[0][0])
    expect(layoutText('“').lines.length).toBe(2)
    expect(layoutText('”').lines.length).toBe(2)
  })

  it('points arrows the right way and tells ✓ from ✗', () => {
    const [up] = layoutText('↑').lines
    const [down] = layoutText('↓').lines
    expect(up[1][1]).toBeGreaterThan(up[0][1])
    expect(down[1][1]).toBeLessThan(down[0][1])
    const [left] = layoutText('←').lines
    expect(left[1][0]).toBeLessThan(left[0][0])
    const [h, l, r] = layoutText('↔').lines
    expect(h[1][0]).toBeGreaterThan(h[0][0])
    expect(l[1][0]).toBeLessThan(r[1][0])
    const [, top, bottom] = layoutText('↕').lines
    expect(top[1][1]).toBeGreaterThan(bottom[1][1])
    const [fwd, , back] = layoutText('⇄').lines
    expect(fwd[0][1]).toBeGreaterThan(back[0][1])
    expect(back[1][0]).toBeLessThan(back[0][0])
    expect(layoutText('✓').lines.length).toBe(1)
    expect(layoutText('✗').lines.length).toBe(2)
    expect(layoutText('⚡').lines[0].length).toBe(4)
  })

  it('covers every printable ASCII character and dashes', () => {
    const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))
    for (const ch of [...ascii, '–', '—']) expect(hasGlyph(ch)).toBe(true)
  })

  it('covers the full Greek alphabet', () => {
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCharCode(a + i))
    const greek = [...range(0x391, 0x3a9), ...range(0x3b1, 0x3c9)].filter((ch) => ch !== '\u03a2')
    expect(greek).toHaveLength(49)
    for (const ch of greek) {
      expect(hasGlyph(ch)).toBe(true)
      const { lines, width } = layoutText(ch)
      expect(lines.length).toBeGreaterThan(0)
      for (const [x, y] of lines.flat()) {
        expect(x).toBeGreaterThanOrEqual(-0.2)
        expect(x).toBeLessThanOrEqual(width + 0.2)
        expect(y).toBeGreaterThanOrEqual(-0.4)
        expect(y).toBeLessThanOrEqual(1.1)
      }
    }
  })

  it('draws Greek letters apart from their Latin look-alikes', () => {
    const same = (a: string, b: string) => JSON.stringify(layoutText(a)) === JSON.stringify(layoutText(b))
    expect(same('Α', 'A')).toBe(true)
    for (const [greek, latin] of [['ε', 'e'], ['ν', 'v'], ['ρ', 'p'], ['υ', 'u'], ['κ', 'k'], ['θ', 'Θ'], ['φ', 'Φ'], ['ψ', 'Ψ'], ['σ', 'o'], ['Σ', 'E']]) expect(same(greek, latin)).toBe(false)
    expect(Math.min(...layoutText('ρ').lines.flat().map(([, y]) => y))).toBeLessThan(0)
  })

  it('renders unknown characters as a gap', () => {
    expect(layoutText('¤').lines).toEqual([])
    expect(layoutText('A¤A').width).toBeGreaterThan(layoutText('AA').width)
  })
})
