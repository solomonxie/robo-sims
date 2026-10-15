import * as THREE from 'three/webgpu'
import {
  HCSR04,
  Reflector,
  Sonar,
  THRESHOLD,
  Target,
  arduinoCm,
  burstS,
  echoSeconds,
  echoVia,
  listen,
  maxRange,
  pairReading,
  pingTimeline,
  rangeFromEcho,
  softPing,
  speedOfSound,
  soundWavelength,
} from '../../core/physics'
import { msText } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CLK_COLOR,
  CODE_LEGEND,
  DATA_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  beamCone,
  codeBlock,
  glide,
  glowMat,
  hcSr04,
  liveLabel,
  memoBy,
  meterBar,
  partLetter,
  scope,
  setGlow,
  shadowlessRod,
  stretchRod,
  wavePool,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'

const HALF = (HCSR04.halfDeg * Math.PI) / 180
const HOLD_S = 1.2
const cmText = (m: number) => `${(m * 100).toFixed(m < 1 ? 1 : 0)} cm`
const rodTo = (parent: THREE.Object3D, a: V3, b: V3, m: THREE.Material, r = 0.08) => {
  const o = add(parent, shadowlessRod(m))
  stretchRod(o, a, b, r)
  return o
}

/** Loops `showS` seconds of animation plus a hold, restarting when `key` changes; → elapsed on-screen seconds. */
function loopClock() {
  const s = { key: '', t: 0 }
  return (dt: number, key: string, showS: number) => {
    if (key !== s.key) Object.assign(s, { key, t: 0 })
    s.t += dt
    if (s.t > showS + HOLD_S) s.t = 0
    return Math.min(s.t, showS)
  }
}

/** Dot glowing on a transducer: `set(f)`. */
function blip(parent: THREE.Object3D, at: V3, color: string) {
  const m = glowMat(color, 0.1)
  cylinder(parent, 0.5, 0.2, m, [at[0] + 0.15, at[1], at[2] + 0.3], 'x', 20)
  let k = 0
  return (dt: number, on: boolean, tint = color) => {
    k = glide(dt, k, on ? 1.6 : 0.1, 12)
    setGlow(m, tint, k)
  }
}

// --- Time of flight: trig → 40 kHz burst → echo; ECHO high for the round trip; d = c·t/2. ---

const MATH = { fixed: 'us / 58 (343 m/s)', temp: 'c from temperature' }
const TOF = { face: -19.4, sc: 9, y: 0 }

const tofRun = memoBy(
  (p: Params) => `${p.cm}|${p.temp}|${p.math}`,
  (p: Params) => {
    const m = n(p, 'cm') / 100
    const T = n(p, 'temp')
    const math = pick(MATH, p.math, 'fixed')
    const c = speedOfSound(T)
    const t = echoSeconds(m, T)
    const read = math === 'fixed' ? arduinoCm(t) / 100 : rangeFromEcho(t, c)
    return { m, T, math, c, t, read, err: read - m, line: pingTimeline(t) }
  },
)

export const timeOfFlight: Lesson = {
  id: 'ultrasonic-time-of-flight',
  title: 'Time of flight',
  tagline: 'Time the echo, halve the trip, multiply by the speed of sound',
  formula: (p) => {
    const R = tofRun(p)
    const how = R.math === 'fixed' ? `code: ${Math.round(R.t * 1e6)} µs / 58 = ${cmText(R.read)}` : `code: ${R.c.toFixed(1)} × ${msText(R.t, 2)} / 2 = ${cmText(R.read)}`
    return `c = 331.3·√(1 + T/273.15) = ${R.c.toFixed(1)} m/s at ${R.T} °C · t = 2d / c = ${msText(R.t, 2)} · d = c·t/2 · ${how}`
  },
  legend: [
    { color: RING, label: 'TRIG: 10 µs pulse from the ESP32', shape: 'dot' },
    { color: CLK_COLOR, label: '8 × 40 kHz burst flying out', shape: 'dot' },
    { color: POWER, label: 'Echo back · ECHO pin high meanwhile', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'An HC-SR04 is a speaker and a microphone for 40 kHz, far above hearing. Pull TRIG high for 10 µs and it sends a burst of 8 cycles (200 µs) from the T can, then raises ECHO.',
    'The burst spreads out at the speed of sound, bounces off whatever is ahead and comes back to the R can. ECHO drops the moment the echo arrives, so the ECHO pulse is the round-trip time.',
    'Sound covers the distance twice, so d = c·t/2. At 20 °C, c ≈ 343 m/s: 1 m away takes 5.8 ms. That’s where Arduino’s us / 58 comes from: 58 µs of round trip per cm.',
    'The speed of sound rises about 0.6 m/s per °C (c = 331.3·√(1 + T/273.15)). A sketch that bakes in 343 m/s reads ~3 % long at −10 °C and ~3 % short at 40 °C; pass the temperature in if you need better than a few cm.',
    'pulseIn() blocks while it waits: up to 23 ms for 4 m. ECHO is a 5 V signal, so feed it to the ESP32 through a divider (see Level shifting → Divider shifter).',
  ],
  controls: [
    { kind: 'slider', key: 'cm', label: 'Distance', min: 5, max: 400, step: 5, initial: 100, format: (v) => `${v} cm` },
    { kind: 'slider', key: 'temp', label: 'Air temperature', min: -10, max: 40, step: 1, initial: 20, format: (v) => `${v} °C` },
    { kind: 'choice', key: 'math', options: (Object.keys(MATH) as (keyof typeof MATH)[]).map((k) => ({ value: k, label: MATH[k] })), initial: 'fixed' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const sensor = hcSr04(scene, [TOF.face - 5.05 * 0.32, TOF.y, 0], 0.32)
    partLetter(scene, 'T', [sensor.tx[0] - 3.4, sensor.tx[1], 0], 0.4, CLK_COLOR)
    partLetter(scene, 'R', [sensor.rx[0] - 3.4, sensor.rx[1], 0], 0.4, POWER)
    partLetter(scene, 'HC-SR04', [TOF.face - 1.6, TOF.y + 3.9, 0], 0.36, LABEL)
    const txBlip = blip(scene, sensor.tx, CLK_COLOR)
    const rxBlip = blip(scene, sensor.rx, POWER)
    const wall = add(scene, new THREE.Group(), [0, TOF.y, 0])
    box(wall, [1.2, 11, 3], mat('#9b8f86', { rough: 0.9 }), [0.6, 0, 0])
    const cone = beamCone(scene, CLK_COLOR)
    const waves = wavePool(scene, 8, 36)
    const rulerMat = glowMat(GREY, 0.4)
    const ruler = rodTo(scene, [0, 0, 0], [1, 0, 0], rulerMat, 0.05)
    const rulerText = liveLabel(scene, [0, TOF.y - 4.6, 0.3], { size: 0.42 })
    const airText = liveLabel(scene, [-2, 6.6, 0.3], { size: 0.42 })
    // Scope: TRIG and ECHO.
    const SW = 40
    const SH = 6.4
    const plot = scope(scene, SW, SH, { divs: [10, 4] })
    plot.group.position.set(0, -10.2, 0)
    partLetter(scene, 'TRIG', [-SW / 2 - 1, -10.2 + 1.7, 0], 0.4, RING, 'right')
    partLetter(scene, 'ECHO', [-SW / 2 - 1, -10.2 - 1.6, 0], 0.4, POWER, 'right')
    const trig = plot.trace(RING, { samples: 200, radius: 0.1 })
    const echo = plot.trace(POWER, { samples: 200, radius: 0.1 })
    const cursor = rodTo(scene, [0, 0, 0], [0, 1, 0], glowMat(LABEL, 1), 0.05)
    const pulseText = liveLabel(scene, [0, -10.2 - 1.6, 0.4], { size: 0.38 })
    const spanText = liveLabel(scene, [SW / 2, -10.2 - SH / 2 - 1.2, 0.3], { size: 0.36, align: 'right' })
    partLetter(scene, '0', [-SW / 2, -10.2 - SH / 2 - 1.2, 0.3], 0.36, GREY, 'left')
    const code = codeBlock(scene, [-25, 14.2, 0], 0.38, 5)
    const status = liveLabel(scene, [-25, -15.4, 0.3], { size: 0.42, align: 'left' })
    const clock = loopClock()
    const s = { key: '', x: TOF.face + 9 }
    return {
      scene,
      view: { center: [-1.5, -0.6, 0], radius: 80, polar: 1.42, azimuth: 0.12 },
      frame(dt, p) {
        const R = tofRun(p)
        const key = `${R.m}|${R.T}|${R.math}`
        const end = R.line.echo[1]
        const W = end * 1.15
        const slow = Math.max(150, 2.6 / end)
        const t = clock(dt, key, end * slow) / slow
        // Scene.
        s.x = glide(dt, s.x, TOF.face + Math.max(1.5, R.m * TOF.sc), 10)
        wall.position.x = s.x
        stretchRod(ruler, [TOF.face, TOF.y - 3.8, 0.3], [s.x, TOF.y - 3.8, 0.3], 0.05)
        rulerText.group.position.x = (TOF.face + s.x) / 2
        rulerText.set(`d = ${R.m * 100} cm`, LABEL)
        airText.set(`${R.T} °C · c = ${R.c.toFixed(1)} m/s · λ = ${(soundWavelength(R.T) * 1000).toFixed(1)} mm`, R.T < 10 ? CLK_COLOR : R.T > 30 ? HEAT : LABEL)
        cone([TOF.face, TOF.y, 0], 0, HALF, Math.max(0.5, s.x - TOF.face), 0.07)
        const inside = (x: number) => x <= s.x
        waves.begin()
        for (let k = 0; k < 3; k++) {
          const te = HCSR04.trigS + (k * burstS()) / 2
          if (t < te) continue
          const r = R.c * (t - te) * TOF.sc
          const back = r - (s.x - sensor.tx[0])
          const f = 1.3 / (1 + r / 14)
          const span = Math.min(0.5, 6 / Math.max(r, 1))
          waves.put(sensor.tx, r, 0, span, CLK_COLOR, f, inside)
          if (back > 0 && back < s.x - TOF.face + 4) waves.put([2 * s.x - sensor.tx[0], sensor.tx[1], 0], r, Math.PI, span, POWER, f, inside)
        }
        waves.end()
        txBlip(dt, t >= HCSR04.trigS && t < R.line.burst[1] + 0.0004)
        rxBlip(dt, t >= R.line.echo[1] - 0.0002)
        // Scope capture and cursor.
        if (key !== s.key) {
          const tw = Math.max(HCSR04.trigS, W * 0.012)
          trig.draw((v) => (v * W < tw ? 2.6 : 0.6), null)
          echo.draw((v) => (v * W >= R.line.echo[0] && v * W < R.line.echo[1] ? -0.6 : -2.6), null)
          const mid = (R.line.echo[0] + R.line.echo[1]) / 2 / W
          pulseText.group.position.x = plot.xAt(mid)
          spanText.set(msText(W, 2), GREY)
          s.key = key
        }
        pulseText.set(`t = ${msText(R.t, 2)}`, POWER)
        const cx = plot.xAt(Math.min(1, t / W))
        stretchRod(cursor, [cx, -10.2 - SH / 2, 0.4], [cx, -10.2 + SH / 2, 0.4], 0.05)
        // Code and status.
        const us = Math.round(R.t * 1e6)
        const heard = t >= R.line.echo[1]
        code([
          'digitalWrite(TRIG, HIGH); delayMicroseconds(10);',
          'digitalWrite(TRIG, LOW);',
          `unsigned long us = pulseIn(ECHO, HIGH, 30000);  // ${heard ? us : '…'}`,
          R.math === 'fixed' ? `float cm = us / 58.0;  // ${heard ? (arduinoCm(R.t)).toFixed(1) : '…'}` : `float c = 331.3 * sqrt(1 + tempC / 273.15);  // ${R.c.toFixed(1)} m/s`,
          R.math === 'fixed' ? '// 58 µs per cm assumes 343 m/s (20 °C)' : `float cm = us * c / 20000.0;  // ${heard ? (R.read * 100).toFixed(1) : '…'}`,
        ])
        const phase =
          t < HCSR04.trigS
            ? 'TRIG high for 10 µs'
            : t < R.line.burst[1]
              ? 'T sends 8 cycles at 40 kHz (200 µs), ECHO goes high'
              : t < HCSR04.trigS + burstS() + R.t / 2
                ? `the burst flies out at ${R.c.toFixed(0)} m/s`
                : !heard
                  ? 'echo on its way back to R'
                  : `R hears it: ECHO falls after ${msText(R.t, 2)} → d = c·t/2 = ${cmText(R.read)}`
        status.set(`t = ${msText(t, 2)} · ${phase} · slowed ${Math.round(slow)}×`, LABEL)
      },
      readouts: (p) => {
        const R = tofRun(p)
        const bad = Math.abs(R.err) > 0.03 * R.m + 0.005
        return [
          { label: 'Speed of sound', value: `${R.c.toFixed(1)} m/s` },
          { label: 'Echo pulse', value: msText(R.t, 2) },
          { label: 'Reading', value: cmText(R.read), tone: bad ? 'warn' : 'ok' },
          { label: 'Error', value: `${R.err >= 0 ? '+' : '−'}${Math.abs(R.err * 100).toFixed(1)} cm`, tone: bad ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Beam angle: ~15° cone, off-axis targets missed, tilted walls bounce the echo away, two sensors cross-talk. ---

const SCENES = { box: 'Box off axis', wall: 'Tilted wall', pair: 'Two sensors' }
const FIRE = { together: 'Fire together', turns: 'Take turns' }
type BeamScene = keyof typeof SCENES
const BEAM = { x0: -15, y0: 1.4, sc: 9, k: 0.17 }
const CYCLE_S = 0.022
const SLOW = 200
const bx = (x: number) => BEAM.x0 + x * BEAM.sc
const by = (y: number) => BEAM.y0 + y * BEAM.sc
const rad = (d: number) => (d * Math.PI) / 180
const wallAt = (x: number, tiltDeg: number, half: number, name: string): Reflector => {
  const t = rad(tiltDeg)
  return { kind: 'wall', a: { x: x - half * Math.sin(t), y: -half * Math.cos(t) }, b: { x: x + half * Math.sin(t), y: half * Math.cos(t) }, refl: 1, name }
}

const beamRun = memoBy(
  (p: Params) => `${p.scene}|${p.angle}|${p.fire}`,
  (p: Params) => {
    const scene: BeamScene = pick(SCENES, p.scene, 'box')
    const angle = n(p, 'angle')
    const together = pick(FIRE, p.fire, 'together') === 'together'
    const a: Sonar = { x: 0, y: scene === 'pair' ? 0.2 : 0, heading: 0 }
    const b: Sonar = { x: 0, y: -0.2, heading: 0 }
    const sonars = scene === 'pair' ? [a, b] : [a]
    const rs: Reflector[] =
      scene === 'box'
        ? [{ kind: 'post', at: { x: 1.2 * Math.cos(rad(angle)), y: 1.2 * Math.sin(rad(angle)) }, width: 0.3, refl: 1, name: 'box' }, wallAt(3, 0, 1, 'wall')]
        : scene === 'wall'
          ? [wallAt(1.5, angle, 1, 'wall')]
          : [{ kind: 'post', at: { x: 0.8 * Math.cos(rad(angle)), y: 0.2 + 0.8 * Math.sin(rad(angle)) }, width: 0.4, refl: 1, name: 'box' }, wallAt(3, 0, 1, 'wall')]
    const pings = scene === 'pair' && !together ? [{ i: 0, t0: 0 }, { i: 1, t0: CYCLE_S }] : sonars.map((_, i) => ({ i, t0: 0 }))
    const reads = sonars.map((s, i) => {
      if (scene !== 'pair') return { first: listen(s, s, rs).first, phantom: false, t0: 0 }
      const other = sonars[1 - i]
      const r = pairReading(other, s, rs, together)
      return { first: r.first, phantom: r.phantom, t0: pings.find((x) => x.i === i)!.t0 }
    })
    const main = scene === 'pair' ? sonars[1] : sonars[0]
    const target = rs[0]
    const strength = (echoVia(main, main, target)?.amp ?? 0) / THRESHOLD
    return { scene, angle, together, sonars, rs, pings, reads, strength, total: pings.at(-1)!.t0 + CYCLE_S }
  },
)

const readText = (r: { first: { path: number; name: string } | null; phantom: boolean }) =>
  r.first ? `${cmText(r.first.path / 2)} ${r.phantom ? '✗ phantom' : r.first.name === 'wall' ? '(wall)' : '(box)'}` : 'no echo: 38 ms timeout'

export const beamAngle: Lesson = {
  id: 'ultrasonic-beam-angle',
  title: 'Beam angle',
  tagline: 'It hears a cone, not a line, and only echoes that come back',
  formula: (p) => {
    const B = beamRun(p)
    if (B.scene === 'box') return `gain = 2^−(θ/15°)² each way · box at ${B.angle}° off axis: echo ${B.strength.toFixed(2)} × threshold → ${B.strength >= 1 ? 'heard' : 'missed, the wall behind answers'}`
    if (B.scene === 'wall') return `mirror bounce: echo leaves at 2 × ${B.angle}° = ${2 * B.angle}° from the axis · ${B.strength.toFixed(2)} × threshold → ${B.strength >= 1 ? 'heard' : 'deflected away, no echo'}`
    const r = B.reads[1]
    return `B ${B.together ? 'fires with A' : 'waits for A’s echoes to die (22 ms)'} · B latches the first echo it hears → ${readText(r)}`
  },
  legend: [
    { color: CLK_COLOR, label: 'Ping from A (cyan cone ≈ ±15°)', shape: 'dot' },
    { color: DATA_COLOR, label: 'Ping from B', shape: 'dot' },
    { color: GREY, label: 'Echoes keep the ping’s colour · grey: too weak', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'The 40 kHz beam isn’t a laser line: it’s a cone about ±15° wide (−6 dB at the edge), fading further out. Whatever is nearest anywhere in it answers first, so you get the distance to that, not to what’s straight ahead.',
    'A small target off to the side gets less of the ping and sends less back to the receiver: past ~12° a 30 cm box is missed and you read the wall behind it. A wide cone also means the sensor can’t tell you where in the cone the object is.',
    'Hard flat surfaces are mirrors for sound. A wall tilted more than about half the beam angle bounces the burst away, like light off glass, and nothing comes back: the sensor reports no echo and the robot drives into it. Corners and table edges cause the same thing.',
    'Two sensors pinging at once hear each other: B latches A’s echo off the box and reports a phantom obstacle in front of the open space. Fire them in turn (a ~25 ms gap lets the old echoes fade), or at least don’t trust B while A is pinging.',
    'For a robot: mount the sensor level and high enough that the cone misses the floor, and use several sensors in a fan, triggered one after another. The obstacle avoider in State machines → Robot behaviour reacts to exactly this range.',
  ],
  controls: [
    { kind: 'choice', key: 'scene', options: (Object.keys(SCENES) as BeamScene[]).map((k) => ({ value: k, label: SCENES[k] })), initial: 'box' },
    { kind: 'slider', key: 'angle', label: 'Box angle / wall tilt', min: 0, max: 40, step: 1, initial: 8, format: (v) => `${v}°` },
    { kind: 'choice', key: 'fire', options: (Object.keys(FIRE) as (keyof typeof FIRE)[]).map((k) => ({ value: k, label: FIRE[k] })), initial: 'together' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    partLetter(scene, 'top view', [BEAM.x0 - 1, BEAM.y0 + 5.6, 0], 0.34, GREY)
    const sensors = [[0.2, CLK_COLOR], [-0.2, DATA_COLOR], [0, CLK_COLOR]].map(([y, color]) => {
      const g = add(scene, new THREE.Group())
      hcSr04(g, [bx(0) - 5.05 * BEAM.k, by(+y), 0], BEAM.k)
      return { g, blip: blip(g, [bx(0) - 0.4, by(+y), 0.2], `${color}`) }
    })
    const names = [partLetter(scene, 'A', [bx(0) - 2.4, by(0.2) + 1.8, 0], 0.4, CLK_COLOR), partLetter(scene, 'B', [bx(0) - 2.4, by(-0.2) - 1.8, 0], 0.4, DATA_COLOR)]
    const cones = [beamCone(scene, CLK_COLOR), beamCone(scene, DATA_COLOR)]
    const reads = [liveLabel(scene, [bx(0) - 3.4, 0, 0.3], { size: 0.42, align: 'right' }), liveLabel(scene, [bx(0) - 3.4, 0, 0.3], { size: 0.42, align: 'right' })]
    const boxMat = mat('#b88a57', { rough: 0.85 })
    const crate = add(scene, new THREE.Group())
    box(crate, [1, 1, 2.4], boxMat, [0, 0, 0.2])
    const wallMat = mat('#9b8f86', { rough: 0.9 })
    const walls = [0, 1].map(() => {
      const g = add(scene, new THREE.Group())
      box(g, [0.9, 1, 3], wallMat, [0, 0, 0.3])
      return g
    })
    const axisMat = glowMat(GREY, 0.3)
    const axis = rodTo(scene, [0, 0, 0], [1, 0, 0], axisMat, 0.04)
    const bounce = rodTo(scene, [0, 0, 0], [1, 0, 0], glowMat(HIGH_V, 0.6), 0.07)
    const waves = wavePool(scene, 16, 40, 0.13)
    const code = codeBlock(scene, [-25, 13.8, 0], 0.38, 4)
    const status = liveLabel(scene, [-25, -12.6, 0.3], { size: 0.42, align: 'left' })
    const clock = loopClock()
    return {
      scene,
      view: { center: [-2, 1.4, 0], radius: 84, polar: 1.36, azimuth: 0.08 },
      frame(dt, p) {
        const B = beamRun(p)
        const key = `${B.scene}|${B.angle}|${B.together}`
        const t = clock(dt, key, B.total * SLOW) / SLOW
        const pair = B.scene === 'pair'
        sensors.forEach((x, i) => (x.g.visible = pair ? i < 2 : i === 2))
        names.forEach((o) => (o.visible = pair))
        // Targets.
        const post = B.rs.find((r) => r.kind === 'post')
        crate.visible = !!post
        if (post?.kind === 'post') {
          crate.position.set(bx(post.at.x), by(post.at.y), 0)
          crate.scale.set(post.width * BEAM.sc, post.width * BEAM.sc, 1)
        }
        const ws = B.rs.filter((r) => r.kind === 'wall')
        walls.forEach((g, i) => {
          const w = ws[i]
          g.visible = !!w
          if (w?.kind !== 'wall') return
          g.position.set(bx((w.a.x + w.b.x) / 2) + 0.45 * Math.cos(rad(B.scene === 'wall' ? B.angle : 0)), by((w.a.y + w.b.y) / 2) - 0.45 * Math.sin(rad(B.scene === 'wall' ? B.angle : 0)), 0)
          g.rotation.z = -Math.atan2(w.b.x - w.a.x, w.b.y - w.a.y)
          g.scale.y = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) * BEAM.sc
        })
        const sideOf = (w: Reflector, x: number, y: number) => {
          if (w.kind !== 'wall') return 1
          return (w.b.x - w.a.x) * (y - w.a.y) - (w.b.y - w.a.y) * (x - w.a.x)
        }
        const keep = (x: number, y: number) => ws.every((w) => sideOf(w, (x - BEAM.x0) / BEAM.sc, (y - BEAM.y0) / BEAM.sc) * sideOf(w, 0, 0) > 0)
        // Cones, axis and the mirror bounce.
        B.sonars.forEach((s, i) => cones[i]([bx(s.x), by(s.y), 0], 0, HALF, 3.3 * BEAM.sc, 0.07))
        if (B.sonars.length < 2) cones[1]([bx(0), by(0), 0], 0, 0.001, 0.01, 0)
        stretchRod(axis, [bx(0), by(B.sonars.at(-1)!.y), 0.25], [bx(3.2), by(B.sonars.at(-1)!.y), 0.25], 0.04)
        bounce.visible = B.scene === 'wall' && B.angle > 0
        if (B.scene === 'wall') {
          const hit = 1.5
          const out = 2 * rad(B.angle)
          stretchRod(bounce, [bx(hit), by(0), 0.3], [bx(hit - 1.3 * Math.cos(out)), by(1.3 * Math.sin(out)), 0.3], 0.07)
        }
        // Waves: each ping spreads out; every target sends back an echo in the ping's colour, bright if it's loud enough.
        waves.begin()
        for (const pg of B.pings) {
          const tx = B.sonars[pg.i]
          const color = pg.i === 0 ? CLK_COLOR : DATA_COLOR
          const dtS = t - pg.t0
          if (dtS < 0) continue
          const rM = speedOfSound(20) * dtS
          if (rM > 4.5) continue
          const span = (r: number, max: number) => Math.min(max, 8 / Math.max(r * BEAM.sc, 1))
          waves.put([bx(tx.x), by(tx.y), 0.3], rM * BEAM.sc, 0, span(rM, 0.75), color, 1.2 / (1 + rM), keep)
          for (const r of B.rs) {
            const loud = Math.max(...B.sonars.map((rx) => (echoVia(tx, rx, r)?.amp ?? 0) / THRESHOLD))
            const f = Math.min(1.2, 0.25 + 0.5 * loud)
            const tint = loud >= 1 ? color : GREY
            if (r.kind === 'post') {
              const d = Math.hypot(r.at.x - tx.x, r.at.y - tx.y)
              const back = rM - d
              if (back > 0 && back < d + 0.3) waves.put([bx(r.at.x), by(r.at.y), 0.3], back * BEAM.sc, Math.PI + Math.atan2(r.at.y - tx.y, r.at.x - tx.x), span(back, 0.8), tint, f)
            } else {
              const nx = -(r.b.y - r.a.y)
              const ny = r.b.x - r.a.x
              const len = Math.hypot(nx, ny)
              const side = ((tx.x - r.a.x) * nx + (tx.y - r.a.y) * ny) / len
              const im = { x: tx.x - (2 * side * nx) / len, y: tx.y - (2 * side * ny) / len }
              const u = (tx.y - r.a.y) / (r.b.y - r.a.y)
              const head = Math.atan2(tx.y - im.y, r.a.x + u * (r.b.x - r.a.x) - im.x)
              if (rM > Math.abs(side) && rM < 2 * Math.abs(side) + 0.5) waves.put([bx(im.x), by(im.y), 0.3], rM * BEAM.sc, head, span(rM, 0.75), tint, f, keep)
            }
          }
        }
        waves.end()
        // Readings: each receiver latches the first echo it hears.
        B.reads.forEach((r, i) => {
          const s = B.sonars[i]
          const arrive = r.first ? r.t0 + r.first.path / speedOfSound(20) : Infinity
          const got = t >= arrive
          const done = t >= r.t0 + CYCLE_S * 0.98
          const label = reads[i]
          label.group.position.y = by(s.y) + (pair ? (i === 0 ? 1.2 : -1.2) : 0)
          label.set(t < r.t0 ? 'waiting' : got ? readText(r) : done ? 'no echo: 38 ms timeout' : 'listening…', got ? (r.phantom ? HIGH_V : POWER) : done ? HIGH_V : GREY)
          sensors[pair ? i : 2].blip(dt, got && t < arrive + 0.004, r.phantom ? HIGH_V : POWER)
        })
        code(
          pair
            ? B.together
              ? ['ping(TRIG_A); ping(TRIG_B);  // together', 'long a = pulseIn(ECHO_A, HIGH, 25000);', 'long b = pulseIn(ECHO_B, HIGH, 25000);  // first echo wins', "// B can hear A's ping: phantom range"]
              : ['long a = readCm(TRIG_A, ECHO_A);', "delay(25);  // let A's echoes die out", 'long b = readCm(TRIG_B, ECHO_B);', '// one sensor at a time: no crosstalk']
            : ['long us = pulseIn(ECHO, HIGH, 25000);', 'if (us == 0) return NO_ECHO;  // missed or deflected', 'float cm = us / 58.0;  // the nearest echo in the cone', `// ${B.scene === 'box' ? `box ${B.angle}° off axis` : `wall tilted ${B.angle}°`}`],
        )
        const say =
          B.scene === 'box'
            ? B.strength >= 1
              ? `the box is inside the cone: its echo (${B.strength.toFixed(1)} × threshold) arrives first`
              : `the box at ${B.angle}° gets too little of the ping: missed, the wall at 300 cm answers`
            : B.scene === 'wall'
              ? B.strength >= 1
                ? `tilted ${B.angle}°, the wall still sends enough back (${B.strength.toFixed(1)} × threshold)`
                : `tilted ${B.angle}°, the echo leaves at ${2 * B.angle}°: nothing comes back, the robot sees open space`
              : B.together
                ? B.reads[1].phantom
                  ? "B hears A's echo off the box before its own from the wall: phantom obstacle"
                  : "B's first echo is its own: no crosstalk at this angle"
                : "B pings only after A's echoes are gone: each hears only its own"
        status.set(`t = ${msText(t, 1)} · ${say} · slowed ${SLOW}×`, LABEL)
      },
      readouts: (p) => {
        const B = beamRun(p)
        const r = B.reads.at(-1)!
        return [
          { label: B.scene === 'wall' ? 'Wall tilt' : 'Box off axis', value: `${B.angle}°`, tone: B.angle > HCSR04.halfDeg ? 'warn' : 'ok' },
          { label: B.scene === 'pair' ? 'B’s box echo' : 'Echo', value: `${B.strength.toFixed(2)}×`, tone: B.strength >= 1 ? 'ok' : 'warn' },
          { label: B.scene === 'pair' ? 'B reads' : 'Reading', value: r.first ? cmText(r.first.path / 2) : 'no echo', tone: r.phantom || !r.first ? 'bad' : 'ok' },
          { label: 'Verdict', value: r.phantom ? 'phantom' : !r.first ? 'no echo' : B.scene === 'box' && r.first.name === 'wall' ? 'box missed' : 'right', tone: r.phantom || !r.first ? 'bad' : B.scene === 'box' && r.first.name === 'wall' ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Soft-target errors: foam and cloth soak up the ping, thin legs scatter it, far targets time out. ---

const TARGET_TEXT: Record<Target, string> = { wall: 'Wall', cardboard: 'Cardboard box', curtain: 'Curtain', foam: 'Foam sofa', chairLeg: 'Chair leg' }
const HANDLE = { blocking: 'pulseIn(…) no timeout', zero: '25 ms timeout, 0 → 0 cm', checked: '25 ms timeout, checked' }
type Handle = keyof typeof HANDLE
const TIMEOUT: Record<Handle, number> = { blocking: 1, zero: 0.025, checked: 0.025 }
const SOFT = { face: -18.5, y: 0.6, sc: 6.4, floor: -4.4, k: 0.3 }
const WIN_S = 0.04
const SOFT_SLOW = 100

const softRun = memoBy(
  (p: Params) => `${p.target}|${p.m}|${p.handle}`,
  (p: Params) => {
    const target = pick(TARGET_TEXT, p.target, 'foam')
    const handle = pick(HANDLE, p.handle, 'checked')
    const m = n(p, 'm')
    const P = softPing(target, m, 20, TIMEOUT[handle])
    const cm = P.pulseInS > 0 ? arduinoCm(P.pulseInS) : 0
    const robot =
      P.echoS !== null
        ? cm < 30
          ? 'stops'
          : 'drives on'
        : handle === 'blocking'
          ? 'drives on: clear?'
          : handle === 'zero'
            ? 'stops for nothing'
            : 'slows, keeps last'
    return { target, handle, m, ...P, cm, robot, reach: maxRange(target) }
  },
)

export const softTargetErrors: Lesson = {
  id: 'ultrasonic-soft-target-errors',
  title: 'Soft-target errors',
  tagline: 'Foam, cloth and thin legs send back too little to hear',
  formula: (p) => {
    const S = softRun(p)
    const db = 20 * Math.log10(S.strength)
    return `echo = reflectivity × spreading × air loss = ${db >= 0 ? '+' : '−'}${Math.abs(db).toFixed(0)} dB vs threshold · ${TARGET_TEXT[S.target].toLowerCase()} heard out to ${cmText(Math.min(S.reach, HCSR04.maxM))} · ${S.echoS !== null ? `echo after ${msText(S.echoS, 2)}` : `missed: ECHO high ${msText(HCSR04.noEchoS, 0)}, pulseIn → ${S.pulseInS ? Math.round(S.pulseInS * 1e6) : 0}`}`
  },
  legend: [
    { color: CLK_COLOR, label: 'Ping', shape: 'dot' },
    { color: POWER, label: 'Echo above threshold · grey: too weak to hear', shape: 'dot' },
    { color: HIGH_V, label: 'pulseIn timeout', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'The receiver only reports an echo louder than its threshold. A hard wall sends almost all of the ping back and is heard to ~4 m; anything that soaks up or scatters sound is heard much closer.',
    'Soft, porous things (foam, cushions, curtains, clothes, fur) absorb 40 kHz. A curtain is lost past ~2 m, a foam sofa past ~80 cm, so the robot can drive straight into the sofa.',
    'Thin things (chair and table legs, cables, poles) catch only a sliver of the cone and scatter it every way: a 2.5 cm leg goes quiet past ~70 cm. The beam slips under the seat and you get the wall behind.',
    'With no echo, the HC-SR04 holds ECHO high for ~38 ms and gives up. pulseIn() without a timeout waits for that and returns 38000 µs: 655 cm, “all clear”, and your loop stalls 38 ms per ping. With a timeout it returns 0, which us / 58 turns into “0 cm”, a phantom wall.',
    'So treat 0 as “no reading”, not as a distance: keep the last good value, slow down, or check with another sensor (an IR or ToF sensor sees foam fine). The 25 ms timeout also caps the range at ~4.3 m.',
  ],
  controls: [
    { kind: 'choice', key: 'target', options: (Object.keys(TARGET_TEXT) as Target[]).map((k) => ({ value: k, label: TARGET_TEXT[k] })), initial: 'foam' },
    { kind: 'slider', key: 'm', label: 'Distance', min: 0.2, max: 5, step: 0.05, initial: 1.5, format: (v) => `${Math.round(v * 100)} cm` },
    { kind: 'choice', key: 'handle', options: (Object.keys(HANDLE) as Handle[]).map((k) => ({ value: k, label: HANDLE[k] })), initial: 'zero' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const sensor = hcSr04(scene, [SOFT.face - 5.05 * SOFT.k, SOFT.y, 0], SOFT.k)
    partLetter(scene, 'side view', [SOFT.face - 2, SOFT.y + 3.9, 0], 0.34, GREY)
    box(scene, [1.2, SOFT.y - 2.2 - SOFT.floor, 1.2], mat('#2a2c32', { rough: 0.6 }), [SOFT.face - 1.8, (SOFT.y - 2.2 + SOFT.floor) / 2, -1])
    const rxBlip = blip(scene, sensor.rx, POWER)
    box(scene, [42, 0.3, 4], mat('#3a3d44', { rough: 0.9 }), [1.5, SOFT.floor - 0.15, -1])
    const cone = beamCone(scene, CLK_COLOR)
    const waves = wavePool(scene, 6, 36)
    // Targets, each drawn with its front face at x = 0.
    const tg = add(scene, new THREE.Group(), [0, SOFT.floor, 0])
    const H = 11
    const looks: Record<Target, THREE.Group> = {
      wall: new THREE.Group(),
      cardboard: new THREE.Group(),
      curtain: new THREE.Group(),
      foam: new THREE.Group(),
      chairLeg: new THREE.Group(),
    }
    box(looks.wall, [1.2, H, 3], mat('#9b8f86', { rough: 0.9 }), [0.6, H / 2, 0])
    box(looks.cardboard, [4, 6.4, 3], mat('#b88a57', { rough: 0.85 }), [2, 3.2, 0])
    const cloth = mat('#8c3b5e', { rough: 1 })
    for (let k = 0; k < 6; k++) box(looks.curtain, [0.35, H, 3], cloth, [0.3 + (k % 2) * 0.5, H / 2, -1.5 + k * 0.6])
    for (let k = 0; k < 4; k++) box(looks.curtain, [0.6, 0.3, 3.2], cloth, [0.55, H - 0.2 - k * 0.01, 0])
    const foam = mat('#5f7fa8', { rough: 1 })
    box(looks.foam, [4, 7, 3.4], foam, [2.3, 3.5, 0])
    for (let y = 0.7; y < 7; y += 1) for (let z = -1.2; z <= 1.2; z += 1.2) cylinder(looks.foam, 0.3, 0.6, foam, [0.15, y, z], 'x', 10)
    const steel = mat('#b9bec6', { metal: 0.4, rough: 0.4 })
    for (const x of [0.2, 4.4]) cylinder(looks.chairLeg, 0.16, 6.2, steel, [x, 3.1, 0], 'y', 12)
    box(looks.chairLeg, [5, 0.5, 3], mat('#6b4a32', { rough: 0.7 }), [2.3, 6.4, 0])
    cylinder(looks.chairLeg, 0.16, 6, steel, [4.4, 9.4, 0], 'y', 12)
    for (const g of Object.values(looks)) tg.add(g)
    const rulerText = liveLabel(scene, [0, SOFT.floor - 1.2, 0.3], { size: 0.4 })
    const reachMat = glowMat(POWER, 0.6)
    const reach = rodTo(scene, [0, 0, 0], [0, 1, 0], reachMat, 0.06)
    const reachText = liveLabel(scene, [0, SOFT.floor - 2.4, 0.3], { size: 0.34 })
    // Echo strength vs threshold, dB.
    const meter = meterBar(scene, [-12, -9.8, 0], 22, 60, [[30, 'threshold', HIGH_V]], 'echo')
    // ECHO pin over 40 ms with the pulseIn timeout.
    const SW = 36
    const SH = 3.4
    const plot = scope(scene, SW, SH, { divs: [8, 2] })
    plot.group.position.set(1, -14.6, 0)
    partLetter(scene, 'ECHO', [1 - SW / 2 - 1, -14.6, 0], 0.4, POWER, 'right')
    const echo = plot.trace(POWER, { samples: 240, radius: 0.1 })
    const tmo = rodTo(scene, [0, 0, 0], [0, 1, 0], glowMat(HIGH_V, 0.9), 0.07)
    const tmoText = liveLabel(scene, [0, -14.6 + SH / 2 + 0.6, 0.3], { size: 0.34 })
    const cursor = rodTo(scene, [0, 0, 0], [0, 1, 0], glowMat(LABEL, 1), 0.05)
    partLetter(scene, '0', [1 - SW / 2, -14.6 - SH / 2 - 0.9, 0.3], 0.34, GREY, 'left')
    partLetter(scene, '40 ms', [1 + SW / 2, -14.6 - SH / 2 - 0.9, 0.3], 0.34, GREY, 'right')
    const code = codeBlock(scene, [-25, 10, 0], 0.38, 4)
    const status = liveLabel(scene, [-25, -18.6, 0.3], { size: 0.42, align: 'left' })
    const clock = loopClock()
    const s = { key: '', x: SOFT.face + 9 }
    return {
      scene,
      view: { center: [-1.5, -4, 0], radius: 82, polar: 1.42, azimuth: 0.14 },
      frame(dt, p) {
        const S = softRun(p)
        const key = `${S.target}|${S.m}|${S.handle}`
        const t = clock(dt, key, WIN_S * SOFT_SLOW) / SOFT_SLOW
        s.x = glide(dt, s.x, SOFT.face + S.m * SOFT.sc, 10)
        tg.position.x = s.x
        for (const [k, g] of Object.entries(looks)) g.visible = k === S.target
        rulerText.group.position.x = (SOFT.face + s.x) / 2
        rulerText.set(cmText(S.m), LABEL)
        const rx = SOFT.face + Math.min(S.reach, 5.2) * SOFT.sc
        stretchRod(reach, [SOFT.face, SOFT.floor - 1.9, 0.3], [rx, SOFT.floor - 1.9, 0.3], 0.06)
        setGlow(reachMat, S.echoS !== null ? POWER : HIGH_V, 0.6)
        reachText.group.position.x = Math.min(rx, 17)
        reachText.set(`heard out to ${cmText(Math.min(S.reach, HCSR04.maxM))}`, GREY)
        cone([SOFT.face, SOFT.y, 0], 0, HALF, Math.max(0.5, s.x - SOFT.face), 0.07)
        // Waves: the ping spreads, the echo comes back as loud as the target allows.
        const c = speedOfSound(20)
        const inside = (x: number) => x <= s.x + (S.target === 'chairLeg' ? 0.2 : 0)
        const rM = c * Math.max(0, t - HCSR04.trigS)
        const heard = S.echoS !== null
        waves.begin()
        for (let k = 0; k < 3; k++) {
          const r = Math.max(0, rM - k * 0.035) * SOFT.sc
          if (r > 0 && r < 40) waves.put(sensor.tx, r, 0, 0.55, CLK_COLOR, 1.2 / (1 + r / 12), inside)
          const back = r - (s.x - sensor.tx[0])
          if (back <= 0 || back > s.x - SOFT.face + 3) continue
          const f = Math.min(1.2, 0.15 + 0.6 * Math.sqrt(S.strength))
          const tint = heard ? POWER : GREY
          if (S.target === 'chairLeg') waves.put([s.x + 0.2, SOFT.y, 0], back, Math.PI, 1.2, tint, f, inside)
          else waves.put([2 * s.x - sensor.tx[0], sensor.tx[1], 0], r, Math.PI, 0.55, tint, f, inside)
        }
        waves.end()
        const P = pingTimeline(S.echoS)
        rxBlip(dt, heard && t >= P.echo[1] && t < P.echo[1] + 0.004)
        const db = 20 * Math.log10(Math.max(S.strength, 1e-3))
        meter(Math.max(0, Math.min(60, db + 30)), `${db >= 0 ? '+' : '−'}${Math.abs(db).toFixed(0)} dB`, heard ? POWER : HIGH_V)
        // Scope.
        if (key !== s.key) {
          echo.draw((v) => (v * WIN_S >= P.echo[0] && v * WIN_S < P.echo[1] ? 1.1 : -1.1), null)
          s.key = key
        }
        const tx = plot.xAt(Math.min(1, S.handle === 'blocking' ? 1 : TIMEOUT[S.handle] / WIN_S)) + 1
        tmo.visible = S.handle !== 'blocking'
        stretchRod(tmo, [tx, -14.6 - SH / 2, 0.4], [tx, -14.6 + SH / 2, 0.4], 0.07)
        tmoText.set(S.handle === 'blocking' ? 'no timeout: waits for ECHO to fall' : 'timeout 25 ms', HIGH_V)
        tmoText.group.position.x = S.handle === 'blocking' ? 1 + SW / 4 : tx
        const cx = plot.xAt(Math.min(1, t / WIN_S)) + 1
        stretchRod(cursor, [cx, -14.6 - SH / 2, 0.4], [cx, -14.6 + SH / 2, 0.4], 0.05)
        // Code and status.
        const done = heard ? t >= P.echo[1] : t >= Math.min(P.echo[1], TIMEOUT[S.handle])
        const us = Math.round(S.pulseInS * 1e6)
        const shown = done ? `${us}` : '…'
        code(
          S.handle === 'blocking'
            ? [`long us = pulseIn(ECHO, HIGH);  // ${shown}`, `float cm = us / 58.0;  // ${done ? S.cm.toFixed(0) : '…'}`, 'if (cm < 30) stop(); else drive();', '// no echo → 38 ms pulse → 655 cm: all clear?']
            : S.handle === 'zero'
              ? [`long us = pulseIn(ECHO, HIGH, 25000);  // ${shown}`, `float cm = us / 58.0;  // ${done ? S.cm.toFixed(0) : '…'}`, 'if (cm < 30) stop(); else drive();', '// timed out → 0 → 0 cm: a phantom wall']
              : [`long us = pulseIn(ECHO, HIGH, 25000);  // ${shown}`, 'if (us == 0) { slowDown(); return; }', `float cm = us / 58.0;  // ${done && us ? S.cm.toFixed(0) : '…'}`, 'if (cm < 30) stop(); else drive();'],
        )
        const say = !done
          ? heard
            ? 'listening: ECHO high until the echo returns'
            : S.strength < 1 && S.m <= HCSR04.maxM
              ? `${TARGET_TEXT[S.target].toLowerCase()} sends back too little: echo under the threshold`
              : 'beyond 4 m: the echo is too faint'
          : `pulseIn → ${us} µs · loop blocked ${msText(S.blockedS, 0)} · robot ${S.robot}`
        status.set(`t = ${msText(t, 1)} · ${say} · slowed ${SOFT_SLOW}×`, done && !heard ? HIGH_V : LABEL)
      },
      readouts: (p) => {
        const S = softRun(p)
        const db = 20 * Math.log10(Math.max(S.strength, 1e-3))
        const bad = S.echoS === null && S.handle !== 'checked'
        return [
          { label: 'Echo', value: `${db >= 0 ? '+' : '−'}${Math.abs(db).toFixed(0)} dB`, tone: S.echoS !== null ? 'ok' : 'bad' },
          { label: 'Reads', value: S.echoS !== null ? `${S.cm.toFixed(0)} cm` : S.handle === 'checked' ? 'no reading' : `${S.cm.toFixed(0)} cm`, tone: bad ? 'bad' : S.echoS === null ? 'warn' : 'ok' },
          { label: 'Loop waits', value: msText(S.blockedS, 1), tone: S.blockedS > 0.03 ? 'warn' : 'ok' },
          { label: 'Robot', value: S.robot, tone: bad ? 'bad' : S.echoS === null ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
