import { bandChecks, doublingRate } from './technique'

describe('technique helpers', () => {
  it('doublingRate: 1/refS at refC, ×2 every doubleC', () => {
    expect(doublingRate(300, 300, 30, 20)).toBeCloseTo(1 / 30, 12)
    expect(doublingRate(320, 300, 30, 20)).toBeCloseTo(2 / 30, 12)
    expect(doublingRate(260, 300, 30, 20)).toBeCloseTo(1 / 120, 12)
  })
  it('bandChecks: ok inside, near within slack, fail beyond', () => {
    expect(bandChecks('lo', 'hi', 1, 0.7, 1.8)).toEqual([{ id: 'lo', ok: true, near: true }, { id: 'hi', ok: true, near: true }])
    expect(bandChecks('lo', 'hi', 0.6, 0.7, 1.8, 0.3)[0]).toEqual({ id: 'lo', ok: false, near: true })
    expect(bandChecks('lo', 'hi', 0.4, 0.7, 1.8, 0.3)[0]).toEqual({ id: 'lo', ok: false, near: false })
    expect(bandChecks('lo', 'hi', 2.5, 0.7, 1.8, 0.3)[1]).toEqual({ id: 'hi', ok: false, near: false })
  })
})
