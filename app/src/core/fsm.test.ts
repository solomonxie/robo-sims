import { Bit } from './logic'
import {
  AVOID,
  BRAKE_S,
  LIGHT_S,
  PRESS_MEALY,
  PRESS_MOORE,
  Robot,
  TRAFFIC,
  avoidTick,
  fsmRun,
  fsmStep,
  pressMealyOut,
  pressMooreOut,
  echoRange,
  rangeTo,
  trafficLamps,
} from './fsm'

const room = { x0: 0, y0: 0, x1: 100, y1: 60 }

describe('fsm', () => {
  it('takes the first matching edge, else stays', () => {
    expect(fsmStep(TRAFFIC, 'GREEN', { t: 10, ped: false })).toEqual({ state: 'GREEN', edge: -1 })
    expect(fsmStep(TRAFFIC, 'GREEN', { t: 10, ped: true })).toEqual({ state: 'YELLOW', edge: 0 })
    expect(fsmStep(TRAFFIC, 'GREEN', { t: LIGHT_S.green - 0.1, ped: true }).state).toBe('GREEN')
    for (const m of [PRESS_MOORE, PRESS_MEALY, TRAFFIC, AVOID]) {
      expect(m.states).toContain(m.start)
      m.edges.forEach((e) => expect(m.states).toEqual(expect.arrayContaining([e.from, e.to])))
    }
  })

  it('press detector: one pulse per press, Moore a clock later than Mealy', () => {
    const btn: Bit[] = [0, 1, 1, 1, 0, 1, 0, 0]
    const moore = fsmRun(PRESS_MOORE, btn)
    expect(moore.map((r) => r.state)).toEqual(['UP', 'EDGE', 'HELD', 'HELD', 'UP', 'EDGE', 'UP', 'UP'])
    expect(moore.map((r) => pressMooreOut(r.state))).toEqual([0, 1, 0, 0, 0, 1, 0, 0])
    const mealy = fsmRun(PRESS_MEALY, btn)
    const before = ['UP', ...mealy.map((r) => r.state)] as const
    expect(btn.map((b, k) => pressMealyOut(before[k], b))).toEqual([0, 1, 0, 0, 0, 1, 0, 0])
    expect(mealy.map((r) => r.edge)).toEqual([0, 1, 2, 2, 3, 1, 3, 0])
  })

  it('traffic light cycles only on a request', () => {
    expect(fsmStep(TRAFFIC, 'YELLOW', { t: LIGHT_S.yellow, ped: false }).state).toBe('RED')
    expect(fsmStep(TRAFFIC, 'RED', { t: LIGHT_S.red, ped: false }).state).toBe('GREEN')
    expect(trafficLamps('RED')).toEqual({ red: 1, yellow: 0, green: 0, walk: 1 })
    expect(trafficLamps('GREEN').walk).toBe(0)
  })

  it('range to walls and blocks', () => {
    expect(rangeTo(10, 30, 0, room)).toBeCloseTo(90)
    expect(rangeTo(10, 30, Math.PI / 2, room)).toBeCloseTo(30)
    expect(rangeTo(50, 30, Math.PI / 4, room)).toBeCloseTo(30 * Math.SQRT2)
    expect(rangeTo(10, 30, 0, room, [{ x0: 40, y0: 20, x1: 50, y1: 40 }])).toBeCloseTo(30)
    expect(rangeTo(10, 30, Math.PI, room, [{ x0: 40, y0: 20, x1: 50, y1: 40 }])).toBeCloseTo(10)
    expect(echoRange(50, 55, 0, 0.3, room)).toBeLessThan(rangeTo(50, 55, 0, room))
  })

  it('robot stops near a wall, brakes, turns until clear, drives on', () => {
    const o = { near: 20, speed: 30, spin: 2, nose: 5, cone: 0.26, room, blocks: [] }
    let r: Robot = { x: 50, y: 30, heading: 0, state: 'GO', t: 0 }
    const seen: string[] = []
    let minWall = Infinity
    for (let k = 0; k < 3000; k++) {
      const s = avoidTick(r, 0.02, o)
      if (s.edge >= 0) seen.push(r.state + '>' + s.robot.state)
      r = s.robot
      minWall = Math.min(minWall, room.x1 - r.x, r.x, room.y1 - r.y, r.y)
    }
    expect(seen.slice(0, 3)).toEqual(['GO>STOP', 'STOP>TURN', 'TURN>GO'])
    expect(minWall).toBeGreaterThan(8)
    const stop = avoidTick({ x: 80, y: 30, heading: 0, state: 'STOP', t: BRAKE_S }, 0.02, o)
    expect(stop.robot.state).toBe('TURN')
    expect(stop.robot.x).toBe(80)
  })

  it('robot never spins for ever around a pillar', () => {
    const blocks = [{ x0: 66, y0: 30, x1: 76, y1: 40 }]
    for (const near of [10, 20, 30]) {
      let r: Robot = { x: 30, y: 22, heading: 0.45, state: 'GO', t: 0 }
      let longest = 0
      for (let k = 0; k < 6000; k++) {
        r = avoidTick(r, 0.01, { near, speed: 30, spin: 1.8, nose: 7, cone: 0.26, room: { x0: 0, y0: 0, x1: 120, y1: 70 }, blocks }).robot
        if (r.state === 'TURN') longest = Math.max(longest, r.t)
      }
      expect(longest).toBeLessThan(4)
    }
  })
})
