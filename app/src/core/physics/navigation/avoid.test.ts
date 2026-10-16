import { DEG } from '../common'
import { walledRoom } from '../room'
import { AVOID, CLUTTER, braitRun, braitWheels, clearance, heldSensor, hitSide, moveBot, proximity, rangeAt, reactiveRun, ruleFor, solidGap, sonarAt, wallFit, wallRun } from './avoid'

const EMPTY = walledRoom(2, 1, 0.3, [])

describe('geometry', () => {
  it('distance to a box and a post', () => {
    const b = { kind: 'box' as const, name: 'b', x: [1, 2] as [number, number], y: [0, 1] as [number, number], h: 1, refl: 0.5 }
    expect(solidGap(b, 0.7, 0.5)).toBeCloseTo(0.3, 12)
    expect(solidGap(b, 2.3, 1.4)).toBeCloseTo(0.5, 12) // 3-4-5 off the corner
    expect(solidGap(b, 1.2, 0.5)).toBeCloseTo(-0.2, 12)
    expect(solidGap({ kind: 'post', name: 'p', at: [0, 0], r: 0.1, h: 1, refl: 0.5 }, 0.3, 0.4)).toBeCloseTo(0.4, 12)
    expect(clearance(EMPTY, 0.5, 0.3)).toBeCloseTo(0.3, 12)
  })
  it('ranges from the sensor mount, 7 cm ahead of the axle', () => {
    const p = { x: 0.5, y: 0.5, th: 0 }
    expect(rangeAt(EMPTY, p, 0, 5)).toBeCloseTo(2 - 0.5 - AVOID.mount, 9)
    expect(rangeAt(EMPTY, p, 90 * DEG, 5)).toBeCloseTo(0.5, 9)
    expect(rangeAt(EMPTY, p, 0, 1)).toBe(1)
    // the cone's edge ray (15°) reaches the side wall first: 0.5 / sin 15° > front 1.43, so the front wins here
    expect(sonarAt(EMPTY, p, 0)).toBeCloseTo(1.43 / Math.cos(0), 9)
    expect(sonarAt(EMPTY, { x: 1, y: 0.2, th: 0 }, 0)).toBeCloseTo(0.2 / Math.sin(15 * DEG), 9)
  })
  it('a blocked move keeps its turn or scrapes along the wall, and flags a bump', () => {
    const p = { x: 1.888, y: 0.5, th: 0 }
    const m = moveBot(EMPTY, p, 0.2, 0.2)
    expect(m.hit).toBe(true)
    expect(m.pose.x).toBe(1.888)
    const s = moveBot(EMPTY, { x: 1.889, y: 0.5, th: 0.5 }, 0.2, 0.2)
    expect(s.hit).toBe(true)
    expect(s.pose.y).toBeGreaterThan(0.5)
    expect(s.pose.x).toBe(1.889)
    expect(hitSide(EMPTY, { x: 1, y: 0.88, th: 0 })).toBe(1)
    expect(hitSide(EMPTY, { x: 1, y: 0.12, th: 0 })).toBe(-1)
  })
  it('a held sensor reads every n-th step only', () => {
    let calls = 0
    const s = heldSensor(4, () => ++calls)
    expect([0, 1, 2, 3, 4, 5].map((i) => s({ x: 0, y: 0, th: 0 }, i))).toEqual([1, 1, 1, 1, 2, 2])
  })
})

describe('reactive rules', () => {
  it('three sonars: the first rule that fires wins', () => {
    expect(ruleFor('three', [0.5, 0.2, 1.5], 0.3, 0.2, 0)).toMatchObject({ rule: 1, vL: 0.2, vR: -0.2 }) // spins right, the clearer side
    expect(ruleFor('three', [0.2, 1, 1], 0.3, 0.2, 0)).toMatchObject({ rule: 2, vL: 0.2 })
    expect(ruleFor('three', [1, 1, 0.2], 0.3, 0.2, 0)).toMatchObject({ rule: 3, vR: 0.2 })
    expect(ruleFor('three', [1, 1, 1], 0.3, 0.2, 0)).toMatchObject({ rule: 4, vL: 0.2, vR: 0.2 })
    // keeps spinning the same way until the front clears 1.3 × stop
    expect(ruleFor('three', [2, 0.35, 0.5], 0.3, 0.2, -1)).toMatchObject({ rule: 1, vR: -0.2 })
    expect(ruleFor('sonar', [0.2], 0.3, 0.2, 0)).toMatchObject({ rule: 1, vL: -0.2, vR: 0.2 })
  })
  it('three sonars bump less and cover more than a bumper alone', () => {
    const bump = reactiveRun('bump', 0.3, 0.25)
    const three = reactiveRun('three', 0.3, 0.25)
    expect(bump.bumps).toBeGreaterThan(5)
    expect(three.bumps).toBeLessThanOrEqual(1)
    expect(three.coverage).toBeGreaterThan(bump.coverage)
  })
})

describe('Braitenberg', () => {
  it('obstacle on the left: straight excitation and crossed inhibition turn right (away)', () => {
    expect(proximity(0.2, 0.8)).toBeCloseTo(0.75, 12)
    expect(proximity(1, 0.8)).toBe(0)
    const [fl, fr] = braitWheels('fear', 1, 0, 0.2)
    expect(fl).toBeCloseTo(0.35, 12)
    expect(fr).toBeCloseTo(0.15, 12)
    const [el, er] = braitWheels('explorer', 1, 0, 0.2)
    expect(el).toBeCloseTo(0.15, 12)
    expect(er).toBeCloseTo(-0.05, 12)
    const [al, ar] = braitWheels('aggression', 1, 0, 0.2)
    expect(ar).toBeGreaterThan(al) // turns left, into it
    const [ll, lr] = braitWheels('love', 1, 0, 0.2)
    expect(lr).toBeGreaterThan(ll)
  })
  it('love comes to rest facing something; explorer roams further without bumping', () => {
    const love = braitRun('love', 0.2, 30)
    const exp = braitRun('explorer', 0.2, 45)
    expect(love.restT).not.toBeNull()
    expect(exp.dist).toBeGreaterThan(2 * love.dist)
    expect(exp.bumps).toBe(0)
  })
})

describe('wall following', () => {
  it('two rays fix the wall angle and distance', () => {
    const par = wallFit(0.3 / Math.cos(45 * DEG), 0.3)
    expect(par.alpha).toBeCloseTo(0, 12)
    expect(par.D).toBeCloseTo(0.3, 12)
    // heading 10° into a wall 0.3 m away: b = 0.3/cos 10°, a = 0.3/cos 35°
    const f = wallFit(0.3 / Math.cos(35 * DEG), 0.3 / Math.cos(10 * DEG))
    expect(f.alpha / DEG).toBeCloseTo(10, 9)
    expect(f.D).toBeCloseTo(0.3, 9)
    expect(f.ahead).toBeCloseTo(0.3 - 0.2 * Math.sin(10 * DEG), 9)
  })
  it('look-ahead PD holds the wall tighter than P on the raw side ray', () => {
    const p = wallRun('p', 0.25, 6)
    const look = wallRun('look', 0.25, 6)
    expect(look.bumps).toBe(0)
    expect(look.rms).toBeLessThan(p.rms)
    expect(look.dist).toBeGreaterThan(8)
  })
  it('the cluttered room is a closed box', () => {
    expect(rangeAt(CLUTTER, { x: 0.4, y: 1, th: Math.PI }, 0, 5)).toBeLessThan(0.4)
  })
})
