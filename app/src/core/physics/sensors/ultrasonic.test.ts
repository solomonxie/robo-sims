import {
  HCSR04,
  Reflector,
  arduinoCm,
  beamGain,
  echoSeconds,
  echoVia,
  listen,
  maxRange,
  pairReading,
  pingTimeline,
  rangeFromEcho,
  softPing,
  speedOfSound,
  targetEcho,
} from './ultrasonic'
import { SOUND_C } from '../common'
import { wavelength } from '../signals/radio'

const deg = (d: number) => (d * Math.PI) / 180
const wall = (x: number, tiltDeg: number, half = 2): Reflector => {
  const t = deg(tiltDeg)
  return { kind: 'wall', a: { x: x - half * Math.sin(t), y: -half * Math.cos(t) }, b: { x: x + half * Math.sin(t), y: half * Math.cos(t) }, refl: 1, name: 'wall' }
}

describe('ultrasonic time of flight', () => {
  it('sound is ~331 m/s at 0 °C, ~343 at 20 °C, faster when warm', () => {
    expect(speedOfSound(0)).toBeCloseTo(331.3, 1)
    expect(speedOfSound(20)).toBeCloseTo(343.2, 0)
    expect(speedOfSound(35)).toBeGreaterThan(speedOfSound(20))
    expect(wavelength(HCSR04.hz, speedOfSound(20)) * 1000).toBeCloseTo(8.6, 1)
  })
  it('d = c·t/2 round-trips; 1 m is ~5.8 ms, which /58 reads as ~100 cm', () => {
    const t = echoSeconds(1, 20)
    expect(t * 1000).toBeCloseTo(5.83, 2)
    expect(rangeFromEcho(t, speedOfSound(20))).toBeCloseTo(1, 9)
    expect(arduinoCm(t)).toBeCloseTo(100.5, 0)
  })
  it('a fixed 343 m/s overreads in the cold and underreads in the heat', () => {
    expect(rangeFromEcho(echoSeconds(2, -10), SOUND_C)).toBeGreaterThan(2.07)
    expect(rangeFromEcho(echoSeconds(2, 40), SOUND_C)).toBeLessThan(1.94)
  })
  it('ECHO rises after the 200 µs burst; stays up 38 ms when nothing comes back', () => {
    const p = pingTimeline(0.005)
    expect(p.echo[0]).toBeCloseTo(210e-6, 9)
    expect(p.echo[1] - p.echo[0]).toBeCloseTo(0.005, 9)
    const miss = pingTimeline(null)
    expect(miss.heard).toBe(false)
    expect(miss.echo[1] - miss.echo[0]).toBe(HCSR04.noEchoS)
  })
})

describe('ultrasonic beam', () => {
  const s = { x: 0, y: 0, heading: 0 }
  it('gain is −6 dB at the 15° half-angle', () => {
    expect(beamGain(0)).toBe(1)
    expect(beamGain(deg(15))).toBeCloseTo(0.5, 9)
  })
  it('a flat wall echoes on axis, but tilted past the beam it bounces the sound away', () => {
    expect(echoVia(s, s, wall(1.5, 0))!.heard).toBe(true)
    expect(echoVia(s, s, wall(1.5, 0))!.path).toBeCloseTo(3, 9)
    expect(echoVia(s, s, wall(1.5, 25))!.heard).toBe(false)
  })
  it('a box off axis is missed and the wall behind it answers', () => {
    const box = (a: number): Reflector => ({ kind: 'post', at: { x: 1.2 * Math.cos(deg(a)), y: 1.2 * Math.sin(deg(a)) }, width: 0.3, refl: 1, name: 'box' })
    expect(listen(s, s, [box(0), wall(3, 0)]).first!.name).toBe('box')
    expect(listen(s, s, [box(25), wall(3, 0)]).first!.name).toBe('wall')
  })
  it('fired together, a neighbour’s echo makes a phantom; taking turns fixes it', () => {
    const a = { x: 0, y: 0.2, heading: 0 }
    const b = { x: 0, y: -0.2, heading: 0 }
    const rs: Reflector[] = [{ kind: 'post', at: { x: 0.8, y: 0.2 }, width: 0.4, refl: 1, name: 'box' }, wall(3, 0)]
    const together = pairReading(a, b, rs, true)
    expect(together.phantom).toBe(true)
    expect(together.first!.path / 2).toBeLessThan(1)
    const turns = pairReading(a, b, rs, false)
    expect(turns.phantom).toBe(false)
    expect(turns.first!.name).toBe('wall')
  })
})

describe('soft targets', () => {
  it('a hard wall is heard to 4 m; curtain, foam and a chair leg much closer', () => {
    expect(maxRange('wall')).toBeCloseTo(4, 2)
    expect(maxRange('curtain')).toBeLessThan(2.2)
    expect(maxRange('foam')).toBeLessThan(1)
    expect(maxRange('chairLeg')).toBeLessThan(1)
    expect(targetEcho('cardboard', 1)).toBeGreaterThan(1)
  })
  it('a missed echo times out: pulseIn returns 0, not a distance', () => {
    expect(softPing('foam', 1.5, 20, 0.025).pulseInS).toBe(0)
    expect(softPing('wall', 1.5, 20, 0.025).pulseInS).toBeCloseTo(echoSeconds(1.5, 20), 9)
    expect(softPing('foam', 1.5, 20, 1).pulseInS).toBe(HCSR04.noEchoS)
  })
})
