import { castRoom, rayDir, shuttle, toRoom, walledRoom } from './room'

const room = walledRoom(4, 3, 2, [
  { kind: 'box', name: 'crate', x: [2, 2.5], y: [0.5, 1], h: 0.4, refl: 0.5 },
  { kind: 'post', name: 'leg', at: [1, 2], r: 0.05, h: 0.5, refl: 0.5 },
])

describe('room ray cast', () => {
  it('hits the facing wall with a normal back at the ray', () => {
    const h = castRoom(room, [1, 1.5, 0.2], rayDir(0))!
    expect(h.m).toBeCloseTo(3)
    expect(h.n).toEqual([-1, 0, 0])
    expect(h.solid!.name).toBe('wall')
  })

  it('finds boxes and posts in front of the wall, and over low boxes', () => {
    expect(castRoom(room, [1, 0.75, 0.2], rayDir(0))!.solid!.name).toBe('crate')
    expect(castRoom(room, [1, 0.75, 0.2], rayDir(0))!.m).toBeCloseTo(1)
    expect(castRoom(room, [1, 0.75, 0.6], rayDir(0))!.solid!.name).toBe('wall')
    const leg = castRoom(room, [1, 0.5, 0.2], rayDir(Math.PI / 2))!
    expect(leg.solid!.name).toBe('leg')
    expect(leg.m).toBeCloseTo(1.45)
    expect(leg.n[1]).toBeCloseTo(-1)
  })

  it('downward rays meet the floor; range limit and skip apply', () => {
    const f = castRoom(room, [1, 1.5, 0.5], rayDir(0, -Math.PI / 4))!
    expect(f.solid).toBeNull()
    expect(f.m).toBeCloseTo(0.5 * Math.SQRT2)
    expect(castRoom(room, [1, 1.5, 0.2], rayDir(0), 2)).toBeNull()
    const wall = castRoom(room, [1, 0.75, 0.2], rayDir(0))!
    expect(castRoom(room, [1, 0.75, 0.2], rayDir(0), Infinity, wall.solid!)!.m).toBeCloseTo(3)
  })

  it('robot frame → room frame, and shuttle back and forth', () => {
    const [x, y] = toRoom({ x: 1, y: 1, th: Math.PI / 2 }, 1, 0)
    expect(x).toBeCloseTo(1)
    expect(y).toBeCloseTo(2)
    expect(shuttle(0, 1, 1, 3)).toBe(1)
    expect(shuttle(1.5, 1, 1, 3)).toBeCloseTo(2.5)
    expect(shuttle(3, 1, 1, 3)).toBeCloseTo(2)
    expect(shuttle(4, 1, 1, 3)).toBeCloseTo(1)
  })
})
