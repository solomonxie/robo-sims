import { G } from '../common'
import { brakeOnlyStop } from '../mechanics/collision'
import { VL53L0X, tofMaxRange } from '../sensors/tof'
import { medianMs } from '../../stopwatch'
import { EDGE_THRESHOLD, SUMO_BOT, SUMO_COLORS, SUMO_EYES, SUMO_RING, SUMO_RIVALS, SumoSide, edgeAdc, edgeStop, rivalMm, sumoLoads, sumoMatch, sumoShove, sumoThrust, wedgeLift, wedgeUnder } from './sumobot'

const us = (front: SumoSide['front'], tyre: SumoSide['tyre'], kg: number): SumoSide => ({ front, tyre, kg })

describe('wedge and wheels', () => {
  it('the lower wedge lip gets under; flat fronts and equal lips do not', () => {
    expect(wedgeUnder('steel', 'printed')).toBe(0)
    expect(wedgeUnder('flat', 'printed')).toBe(1)
    expect(wedgeUnder('printed', 'printed')).toBeNull()
    expect(wedgeUnder('flat', 'flat')).toBeNull()
  })
  it('loads: half each axle at rest, the push moves P·h/L to the rear, a lift moves weight between robots', () => {
    const rest = sumoLoads(0.8, 0)
    expect(rest.rear).toBeCloseTo(0.4 * G, 6)
    expect(rest.front).toBeCloseTo(0.4 * G, 6)
    const pushed = sumoLoads(0.8, 4)
    expect(pushed.rear - rest.rear).toBeCloseTo((4 * SUMO_BOT.pushH) / SUMO_BOT.wheelbase, 6)
    const lifted = sumoLoads(0.8, 4, 1)
    const carrying = sumoLoads(0.6, 4, 0, 1)
    expect(lifted.rear + lifted.front).toBeCloseTo(0.8 * G - 1, 6)
    expect(carrying.rear + carrying.front).toBeCloseTo(0.6 * G + 1, 6)
  })
  it('wedge lift is P / tan α until the front wheels leave the mat', () => {
    expect(wedgeLift(0.5, 25, 0.8)).toBeCloseTo(0.5 / Math.tan((25 * Math.PI) / 180), 6)
    const big = wedgeLift(10, 25, 0.8)
    expect(sumoLoads(0.8, 10, big).front).toBeLessThan(1e-9)
  })
  it('motors could push far more than the tyres hold', () => {
    expect(sumoThrust()).toBeGreaterThan(2 * 1.1 * SUMO_BOT.maxKg * G)
  })
  it('mirror match is a stalemate; weight wins a flat-on-flat shove', () => {
    const twin = SUMO_RIVALS.heavy
    expect(sumoShove([twin, twin]).winner).toBeNull()
    expect(sumoShove([us('flat', 'tt', 0.6), SUMO_RIVALS.box]).winner).toBe(1)
    expect(sumoShove([us('flat', 'tt', 1), SUMO_RIVALS.box]).winner).toBe(0)
  })
  it('a wedge under the rival lifts its front axle off and wins at 0.6 kg; a lower lip beats it', () => {
    const r = sumoShove([us('printed', 'tt', 0.6), SUMO_RIVALS.box])
    expect(r.under).toBe(0)
    expect(r.winner).toBe(0)
    const pushing = r.frames.filter((f) => f.P > 0)
    const f = pushing[Math.floor(pushing.length * 0.6)]
    expect(f.load[1][1]).toBeLessThan(1e-6)
    expect(f.load[0][0] + f.load[0][1]).toBeGreaterThan(0.6 * G)
    expect(sumoShove([us('flat', 'tt', 0.6), SUMO_RIVALS.wedge]).under).toBe(1)
    expect(sumoShove([us('steel', 'tt', 0.6), SUMO_RIVALS.wedge]).winner).toBe(0)
    expect(sumoShove([us('printed', 'tt', 0.6), SUMO_RIVALS.wedge]).winner).toBe(1)
  })
  it('the loser is wheelspinning: its tyres are past the grip peak', () => {
    const r = sumoShove([us('flat', 'tt', 1), SUMO_RIVALS.box])
    const pushing = r.frames.filter((f) => f.P > 0)
    const f = pushing[Math.floor(pushing.length * 0.6)]
    expect(Math.min(...f.kappa[1])).toBeGreaterThan(0.5)
  })
  it('fast enough to redo on a control change', () => {
    expect(medianMs((i) => sumoShove([us('printed', 'silicone', 0.6 + 0.05 * (i % 4)), SUMO_RIVALS.heavy]), 3)).toBeLessThan(150)
  })
})

describe('edge and opponent sensing', () => {
  it('edge sensor: black reads high, white low; past the rim it reads dark again', () => {
    const black = edgeAdc(0)
    const white = edgeAdc(SUMO_RING.r - SUMO_RING.edge / 2)
    expect(black).toBeGreaterThan(3500)
    expect(white).toBeLessThan(600)
    expect(EDGE_THRESHOLD).toBeGreaterThan(white)
    expect(EDGE_THRESHOLD).toBeLessThan(black)
    expect(edgeAdc(SUMO_RING.r + 0.01)).toBeGreaterThan(EDGE_THRESHOLD)
  })
  it('stop distance is the bumper sum; the band can be skipped between reads', () => {
    expect(edgeStop(0.8, 0.02).need).toBeCloseTo(brakeOnlyStop(0.8, 0.02, 0, 1.1), 9)
    expect(edgeStop(0.8, 0.02).ok).toBe(true)
    expect(edgeStop(1, 0.02).ok).toBe(false)
    expect(edgeStop(0.6, 0.05).skip).toBe(true)
  })
  it('ToF finds a white rival across the ring, a black one only close up', () => {
    const p = { x: 0, y: 0, th: 0 }
    const at = (m: number) => ({ x: SUMO_EYES.x + m + 0.075, y: SUMO_EYES.y, th: 0 })
    const blackMax = tofMaxRange(SUMO_COLORS.black.refl, SUMO_EYES.klux, SUMO_EYES.mode)
    expect(blackMax).toBeGreaterThan(0.25)
    expect(blackMax).toBeLessThan(0.33)
    expect(rivalMm(p, 0, at(0.2), SUMO_COLORS.black.refl, 1)).toBeLessThan(260)
    expect(rivalMm(p, 0, at(0.4), SUMO_COLORS.black.refl, 1)).toBe(VL53L0X.outOfRange)
    expect(rivalMm(p, 0, at(0.4), SUMO_COLORS.white.refl, 1)).toBeLessThan(460)
  })
  it('the default match finds the rival after one edge escape; too fast, or too slow a loop, drives off', () => {
    const ok = sumoMatch({ vMax: 0.8, loopS: 0.02, color: 'black', start: 'back' })
    expect(ok.result).toBe('hit')
    expect(ok.edges).toBe(1)
    expect(ok.closest).toBeGreaterThan(0)
    expect(sumoMatch({ vMax: 1.2, loopS: 0.02, color: 'black', start: 'back' }).result).toBe('out')
    expect(sumoMatch({ vMax: 0.6, loopS: 0.06, color: 'black', start: 'back' }).result).toBe('out')
  })
  it('a white rival is found sooner than a black one from back to back', () => {
    const w = sumoMatch({ vMax: 0.8, loopS: 0.02, color: 'white', start: 'back' })
    const b = sumoMatch({ vMax: 0.8, loopS: 0.02, color: 'black', start: 'back' })
    expect(w.result).toBe('hit')
    expect(w.tEnd).toBeLessThan(b.tEnd)
  })
  it('fast enough to redo on a slider drag', () => {
    expect(medianMs((i) => sumoMatch({ vMax: 0.8, loopS: 0.01 + 0.005 * (i % 3), color: 'black', start: 'back' }), 3)).toBeLessThan(150)
  })
})
