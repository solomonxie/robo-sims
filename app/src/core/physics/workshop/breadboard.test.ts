import { LEDS } from '../semiconductors'
import { ledLoopAt } from '../challenges/leds'
import { BOARD_CLIP, BREADBOARDS, CLIP_WORN, USB_MODULE, boardXZ, busHoles, busOf, holeExists, holeText, parseHole, railColNear, solveBoard } from './breadboard'

const split = BREADBOARDS.split
const full = BREADBOARDS.full

describe('hole addressing', () => {
  it('parses strip and rail holes and prints them back', () => {
    expect(parseHole('c12')).toEqual({ row: 'c', col: 12 })
    expect(parseHole('top+3')).toEqual({ row: 'top+', col: 3 })
    expect(holeText(parseHole('bottom-40'))).toBe('bottom-40')
    expect(() => parseHole('k3')).toThrow()
  })
  it('knows which holes exist: rails skip every sixth column', () => {
    expect(holeExists(full, parseHole('a63'))).toBe(true)
    expect(holeExists(full, parseHole('a64'))).toBe(false)
    expect(holeExists(full, parseHole('top+6'))).toBe(false)
    expect(railColNear(6)).toBe(5)
    expect(railColNear(7)).toBe(7)
  })
  it('centres the board: columns one pitch apart, the channel between e and f', () => {
    expect(boardXZ(full, parseHole('a1')).x).toBe(-31)
    expect(boardXZ(full, parseHole('a63')).x).toBe(31)
    expect(boardXZ(full, parseHole('e1')).z).toBeLessThan(0)
    expect(boardXZ(full, parseHole('f1')).z).toBeGreaterThan(0)
  })
})

describe('busOf', () => {
  it('joins the five holes a–e of a column, not across the channel or to the next column', () => {
    expect(busOf(full, 'a12')).toBe(busOf(full, 'e12'))
    expect(busOf(full, 'e12')).not.toBe(busOf(full, 'f12'))
    expect(busOf(full, 'a12')).not.toBe(busOf(full, 'a13'))
    expect(busHoles(full, busOf(full, 'c12'))).toHaveLength(5)
  })
  it('runs rails the full length unless the board splits them mid-way', () => {
    expect(busOf(full, 'top+1')).toBe(busOf(full, 'top+61'))
    expect(busOf(split, 'top+29')).not.toBe(busOf(split, 'top+31'))
    expect(busHoles(split, 'top+:1').length + busHoles(split, 'top+:2').length).toBe(busHoles(full, 'top+:1').length)
  })
  it('throws on a hole the board does not have', () => {
    expect(() => busOf(BREADBOARDS.half, 'a40')).toThrow()
  })
})

describe('solveBoard', () => {
  const loop = (r: string, led: [string, string], back: [string, string]) =>
    solveBoard(full, [
      { kind: 'V', a: 'top+1', b: 'top-1', ...USB_MODULE },
      { kind: 'wire', a: 'top+10', b: 'a10', ohms: 0 },
      { kind: 'R', a: 'c10', b: r, ohms: 330 },
      { kind: 'LED', a: led[0], b: led[1], led: LEDS.red },
      { kind: 'wire', a: back[0], b: back[1], ohms: 0 },
    ])
  it('matches the series LED loop when the parts sit in the right strips', () => {
    const s = loop('c14', ['e14', 'e15'], ['a15', 'top-16'])
    const clips = 10 * BOARD_CLIP.contactOhms
    expect(s.partA[3]).toBeCloseTo(ledLoopAt(USB_MODULE.volts, 330 + USB_MODULE.ohms + clips, LEDS.red).amps, 5)
    expect(s.partA[0]).toBeCloseTo(s.partA[3], 4)
    expect(s.live.has('top14')).toBe(true)
  })
  it('a resistor with both legs in one strip is bypassed; an LED with both legs in one strip stays dark', () => {
    const bypass = solveBoard(full, [
      { kind: 'V', a: 'top+1', b: 'top-1', ...USB_MODULE },
      { kind: 'wire', a: 'top+10', b: 'a10', ohms: 0 },
      { kind: 'R', a: 'b10', b: 'd10', ohms: 330 },
      { kind: 'LED', a: 'e10', b: 'e11', led: LEDS.red },
      { kind: 'wire', a: 'a11', b: 'top-11', ohms: 0 },
    ])
    expect(bypass.partA[3]).toBeGreaterThan(0.5)
    expect(Math.abs(bypass.partA[2])).toBeLessThan(1e-3)
    expect(loop('c14', ['d14', 'e14'], ['a15', 'top-16']).partA[3]).toBeLessThan(1e-6)
  })
  it('a dead-end net is live but carries no current; an untouched one floats', () => {
    const s = loop('c14', ['e14', 'e15'], ['a15', 'bottom-16'])
    expect(s.live.has('bottom-:1')).toBe(true)
    expect(s.partA[3]).toBeLessThan(1e-5)
    expect(s.live.has('top30')).toBe(false)
  })
  it('worn clips add their resistance in series: 8 clips round the loop', () => {
    const parts = [
      { kind: 'V' as const, a: 'top+1', b: 'top-1', volts: 5, ohms: 0 },
      { kind: 'wire' as const, a: 'top+10', b: 'a10', ohms: 0 },
      { kind: 'wire' as const, a: 'top-11', b: 'a11', ohms: 0 },
      { kind: 'R' as const, a: 'c10', b: 'c11', ohms: 10 },
    ]
    const worn = solveBoard(full, parts, CLIP_WORN)
    expect(worn.partA[3]).toBeCloseTo(5 / (10 + 8 * BOARD_CLIP.contactOhms * CLIP_WORN), 3)
    expect(worn.maxClipA).toBeCloseTo(worn.partA[3], 4)
  })
})
