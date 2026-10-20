import { puzzleVerdict, targetWindow, windowMiss } from './verdict'

describe('puzzle verdicts', () => {
  it('the first failing check is the reason; near carries its tone', () => {
    expect(puzzleVerdict([{ id: 'a', ok: true }, { id: 'b', ok: false, near: true }, { id: 'c', ok: false }])).toEqual({ pass: false, near: true, fail: 'b' })
    expect(puzzleVerdict([{ id: 'a', ok: true }])).toEqual({ pass: true, near: false, fail: null })
    expect(puzzleVerdict([{ id: 'a', ok: false }]).near).toBe(false)
  })
  it('window miss is the fractional distance outside', () => {
    expect(windowMiss(4, 5, 20)).toEqual({ side: -1, miss: 0.2 })
    expect(windowMiss(25, 5, 20)).toEqual({ side: 1, miss: 0.25 })
    expect(windowMiss(10, 5, 20)).toEqual({ side: 0, miss: 0 })
    expect(targetWindow(10, 0.2)).toEqual([8, 12])
  })
})
