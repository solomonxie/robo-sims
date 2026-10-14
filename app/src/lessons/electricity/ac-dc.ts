import * as THREE from 'three/webgpu'
import {
  MAINS,
  RMS_FACTOR,
  Wave,
  acVolts,
  angularFrequency,
  driftVelocity,
  lampOhms,
  peakFromRms,
  peakToPeak,
  periodOf,
  powerV2R,
  rmsFromPeak,
  sloshAmplitude,
} from '../../core/physics'
import { fitDigits, secs, si, volts, watts } from '../../core/units'
import { V3, add, mesh, rod } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  HIGH_V,
  LANE,
  POWER,
  RING,
  acSource,
  bulb,
  cell,
  clamp01,
  ease,
  glowMat,
  phasor,
  plusFlow,
  presence,
  pulseLabel,
  scope,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const hz = (f: number) => `${+f.toPrecision(3)} Hz`

/** Loop with its source on the left side and a lamp lying on the top wire; + charges ride in front, coloured by
 *  potential: `f.top` on the wire into the lamp, `f.bottom` on the way back, graded across the source and lamp. */
function lampLoop(parent: THREE.Object3D, at: V3, { w, h, scale, sourceH }: { w: number; h: number; scale: number; sourceH: number }) {
  const group = add(parent, new THREE.Group(), at)
  const top = h / 2
  wire(group, [[2.1 * scale, top, 0], [w / 2, top, 0], [w / 2, -top, 0], [-w / 2, -top, 0], [-w / 2, top, 0], [-2.3 * scale, top, 0]])
  const lamp = bulb()
  lamp.group.scale.setScalar(scale)
  lamp.group.rotation.z = -Math.PI / 2
  lamp.group.position.set(0.4 * scale, top, 0)
  group.add(lamp.group)
  const half = 2.7 * scale
  const f = { top: 1, bottom: 0 }
  const potential = (x: number, y: number) => {
    if (x <= -w / 2 + 0.01) return f.bottom + (f.top - f.bottom) * clamp01((y + sourceH / 2) / sourceH)
    if (y >= top - 0.01 && x < half) return f.top + (f.bottom - f.top) * clamp01((x + half) / (2 * half))
    return f.bottom
  }
  const lane: V3[] = [[-w / 2, -top, LANE], [-w / 2, top, LANE], [w / 2, top, LANE], [w / 2, -top, LANE]]
  const flow = plusFlow(group, lane, (p) => potential(p.x, p.y), true)
  return { group, lamp, flow, f }
}

// --- Sine waves and RMS: the AC that heats a lamp as much as a DC voltage is its RMS value. ---

const MAX_VP = 12
const R_LAMP = 12
const MAX_W = powerV2R(MAX_VP, R_LAMP)
const VIS_HZ = 0.5
const WINDOW = 4
const SCOPE_X = -6.2
const SCOPE_W = 16
const V_Y = 3.6
const V_H = 8
const P_Y = -4.4
const P_H = 5
const PER_V = (V_H / 2) * 0.9 / MAX_VP
const PER_W = P_H * 0.9 / MAX_W
const ROW_X = 11.4
const ROW_W = 7.6
const SPEED = 4
const WAVE_ROOT: Record<Wave, string> = { sine: 'Vp / √2', square: 'Vp', triangle: 'Vp / √3' }

const solveRms = (p: Params) => {
  const shape = (p.wave as Wave) ?? 'sine'
  const vp = n(p, 'peak')
  const vrms = rmsFromPeak(vp, shape)
  return { shape, vp, vrms, pp: peakToPeak(vp), avgW: powerV2R(vrms, R_LAMP), peakW: powerV2R(vp, R_LAMP) }
}

export const sineAndRms: Lesson = {
  id: 'ac-vs-dc-sine-waves-and-rms',
  title: 'Sine waves and RMS',
  tagline: 'The DC that heats the same',
  formula: (p) => {
    const s = solveRms(p)
    return `Vrms = ${WAVE_ROOT[s.shape]} = ${s.shape === 'square' ? '' : `${volts(s.vp)} × ${+RMS_FACTOR[s.shape].toFixed(3)} = `}${volts(s.vrms)}`
  },
  legend: [
    { color: HIGH_V, label: 'AC voltage v(t), peak Vp', shape: 'dot' },
    { color: RING, label: 'RMS: the equal DC, V', shape: 'dot' },
    { color: POWER, label: 'Lamp power v² / R, W', shape: 'dot' },
  ],
  points: [
    'AC pushes one way, then the other: v(t) = Vp × sin(2πft). It swings from +Vp to −Vp, so its plain average is 0 V. Here it’s slowed to one cycle every 2 s.',
    'A lamp doesn’t care which way current flows: its power v² / R is always positive. It peaks twice per cycle at Vp² / R and drops to 0 at each zero crossing.',
    'RMS (root of the mean square) is the DC voltage that heats the lamp just as much. Average v², then take the root. The flat green line is the DC lamp’s power, and it sits on the AC power’s average.',
    'For a sine, Vrms = Vp / √2 ≈ 0.707 Vp: a 12 V peak heats like 8.49 V DC. A square wave sits at ±Vp all the time, so its RMS is Vp; a triangle spends longer near 0, so it’s Vp / √3.',
    'Mains is quoted in RMS: 230 V mains peaks at 325 V. Meters on AC show RMS too (only “true RMS” ones get it right for non-sine waves).',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'wave',
      options: [
        { value: 'sine', label: 'Sine' },
        { value: 'square', label: 'Square' },
        { value: 'triangle', label: 'Triangle' },
      ],
      initial: 'sine',
    },
    { kind: 'slider', key: 'peak', label: 'Peak Vp', min: 1, max: MAX_VP, initial: 10, step: 0.5, format: volts },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const vScope = scope(scene, SCOPE_W, V_H)
    vScope.group.position.set(SCOPE_X, V_Y, 0)
    const pScope = scope(scene, SCOPE_W, P_H, { divs: [10, 4], zeroAt: 0 })
    pScope.group.position.set(SCOPE_X, P_Y, 0)
    const vTrace = vScope.trace(HIGH_V)
    const rmsUp = vScope.level(RING)
    const rmsDown = vScope.level(RING)
    const pTrace = pScope.trace(POWER)
    const dcPower = pScope.level(RING)

    const ac = lampLoop(scene, [ROW_X, V_Y - 0.4, 0], { w: ROW_W, h: 5.2, scale: 0.52, sourceH: 2.4 })
    add(ac.group, acSource(1.2), [-ROW_W / 2, 0, 0])
    const dc = lampLoop(scene, [ROW_X, P_Y, 0], { w: ROW_W, h: 4.6, scale: 0.52, sourceH: 3.2 })
    add(dc.group, cell(3.2, 1), [-ROW_W / 2, 0, 0])

    const left = SCOPE_X - SCOPE_W / 2 - 2.4
    const right = SCOPE_X + SCOPE_W / 2 + 2.2
    const vpLabel = pulseLabel(scene, 3, HIGH_V, [left, V_Y, 0], 1.2)
    const rmsLabel = pulseLabel(scene, 3, RING, [right, V_Y, 0], 1.2)
    const wLabel = pulseLabel(scene, 3, POWER, [left, P_Y, 0], 1.2)

    let t = 0
    const shown = { vp: 0, vrms: 0, avg: 0 }
    return {
      scene,
      view: { center: [-0.4, 1.8, 0], radius: 56, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveRms(p)
        t += dt
        shown.vp += (s.vp - shown.vp) * ease(dt)
        shown.vrms += (s.vrms - shown.vrms) * ease(dt)
        shown.avg += (s.avgW - shown.avg) * ease(dt)
        const v = (at: number) => acVolts(shown.vp, VIS_HZ, at, s.shape)
        vTrace.scroll((at) => v(at) * PER_V, t, WINDOW)
        pTrace.scroll((at) => powerV2R(v(at), R_LAMP) * PER_W - P_H / 2, t, WINDOW)
        rmsUp.set(shown.vrms * PER_V)
        rmsDown.set(-shown.vrms * PER_V)
        dcPower.set(shown.avg * PER_W - P_H / 2)

        const now = v(t)
        ac.lamp.setGlow(clamp01((1.6 * powerV2R(now, R_LAMP)) / MAX_W))
        dc.lamp.setGlow(clamp01((1.6 * shown.avg) / MAX_W))
        ac.f.top = 0.5 + (0.5 * now) / MAX_VP
        ac.f.bottom = 1 - ac.f.top
        dc.f.top = 0.5 + (0.5 * shown.vrms) / MAX_VP
        dc.f.bottom = 1 - dc.f.top
        ac.flow.step(shown.vrms > 0 ? (dt * SPEED * now) / shown.vrms : 0)
        dc.flow.step(dt * SPEED)
        vpLabel.display.group.position.y = V_Y + shown.vp * PER_V
        rmsLabel.display.group.position.y = V_Y + shown.vrms * PER_V
        wLabel.display.group.position.y = P_Y - P_H / 2 + Math.max(0.7, shown.avg * PER_W)
        vpLabel.show(fitDigits(s.vp, 3))
        rmsLabel.show(fitDigits(s.vrms, 3))
        wLabel.show(fitDigits(s.avgW, 3))
        for (const l of [vpLabel, rmsLabel, wLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveRms(p)
        return [
          { label: 'Peak Vp', value: volts(s.vp) },
          { label: 'Peak-to-peak', value: volts(s.pp) },
          { label: 'RMS', value: volts(s.vrms), tone: 'ok' },
          { label: 'Lamp power', value: watts(s.avgW) },
        ]
      },
    }
  },
}

// --- Frequency and period: a turning phasor draws the sine; one turn is one period. ---

const F_MIN = 0.5
const F_MAX = 5
const F_WINDOW = 2
const RADIUS = 3.6
const PHASOR_X = -13.2
const WAVE_Y = 0.6
const F_SCOPE_X = 4
const F_SCOPE_W = 20
const F_SCOPE_H = 9
const FREQ = '#b48cff'

const solveFreq = (p: Params) => {
  const f = n(p, 'hz')
  return { f, period: periodOf(f), omega: angularFrequency(f), cycles: f * F_WINDOW }
}

export const frequencyAndPeriod: Lesson = {
  id: 'ac-vs-dc-frequency-and-period',
  title: 'Frequency and period',
  tagline: 'How often it repeats',
  formula: (p) => {
    const s = solveFreq(p)
    return `T = 1 / f = 1 / ${hz(s.f)} = ${secs(s.period)} · ω = 2πf = ${+s.omega.toPrecision(3)} rad/s`
  },
  legend: [
    { color: HIGH_V, label: 'Phasor and its height v(t)', shape: 'dot' },
    { color: FREQ, label: 'Frequency f, Hz', shape: 'dot' },
    { color: RING, label: 'One period T, ms', shape: 'dot' },
  ],
  points: [
    'A sine is the height of a point going round a circle. Each turn of the arm draws one full cycle, then it repeats.',
    'Frequency f is turns per second, in hertz (Hz). The period T is the time for one turn: T = 1 / f. Double f and T halves.',
    'The yellow cursors are one period apart. The wave scrolls under them, but they always cut it at the same height: that’s what “periodic” means.',
    'The arm turns 2π radians per cycle, so its angular speed is ω = 2πf and v(t) = Vp × sin(ωt). The screen holds 2 s, so it shows f × 2 cycles.',
    'Mains turns 50 times a second in Europe (T = 20 ms) and 60 in the US (16.7 ms), ten times faster than the top of this slider. Audio runs 20 Hz to 20 kHz; Wi-Fi 2.4 GHz.',
  ],
  controls: [{ kind: 'slider', key: 'hz', label: 'Frequency f', min: F_MIN, max: F_MAX, initial: 1, step: 0.1, log: true, format: hz }],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const arm = phasor(scene, RADIUS)
    arm.group.position.set(PHASOR_X, WAVE_Y, 0)
    const screen = scope(scene, F_SCOPE_W, F_SCOPE_H, { divs: [10, 6] })
    screen.group.position.set(F_SCOPE_X, WAVE_Y, 0)
    const trace = screen.trace(HIGH_V, { samples: 300 })
    const edge = F_SCOPE_X - F_SCOPE_W / 2
    const link = add(scene, mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8), glowMat(HIGH_V, 0.4)))
    link.rotation.z = Math.PI / 2
    link.castShadow = false

    const cursorMat = glowMat(RING, 0.8)
    const half = F_SCOPE_H / 2
    const cursors = [0, 1].map(() => {
      const g = add(screen.group, new THREE.Group())
      rod(g, [0, -half, 0.3], [0, half, 0.3], 0.07, cursorMat)
      const dot = add(g, mesh(new THREE.SphereGeometry(0.38, 16, 12), glowMat(RING, 1.2)))
      return { g, dot }
    })
    const bracketY = -half - 1
    const bracket = add(screen.group, mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 8), cursorMat), [0, bracketY, 0.3])
    bracket.rotation.z = Math.PI / 2
    const ends = [0, 1].map(() => add(screen.group, mesh(new THREE.ConeGeometry(0.32, 0.7, 12), cursorMat)))
    ends[0].rotation.z = Math.PI / 2
    ends[1].rotation.z = -Math.PI / 2
    const tLabel = pulseLabel(screen.group, 4, RING, [0, bracketY - 1.5, 0.3], 1.2)
    const fLabel = pulseLabel(scene, 3, FREQ, [PHASOR_X, WAVE_Y + RADIUS + 2.1, 0], 1.3)

    let phase = 0
    let shownF = 1
    return {
      scene,
      view: { center: [-1.1, -0.6, 0], radius: 56, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveFreq(p)
        shownF += (s.f - shownF) * ease(dt, 4)
        phase += angularFrequency(shownF) * dt
        const tip = arm.set(phase)
        const y = (u: number) => RADIUS * Math.sin(phase - angularFrequency(shownF) * u * F_WINDOW)
        trace.draw(y, 0)
        const tipX = PHASOR_X + tip[0]
        link.scale.y = Math.max(0.001, edge - tipX)
        link.position.set((tipX + edge) / 2, WAVE_Y + tip[1], 0.1)

        const span = periodOf(shownF) / F_WINDOW
        const us = [0.5 - span / 2, 0.5 + span / 2].map((u) => Math.max(0, Math.min(1, u)))
        const xs = us.map(screen.xAt)
        cursors.forEach((c, k) => {
          c.g.position.x = xs[k]
          c.dot.position.set(0, y(us[k]), 0.3)
        })
        bracket.scale.y = Math.max(0.001, xs[1] - xs[0] - 1)
        ends[0].position.set(xs[0] + 0.35, bracketY, 0.3)
        ends[1].position.set(xs[1] - 0.35, bracketY, 0.3)
        tLabel.show(String(Math.round(s.period * 1000)))
        fLabel.show(fitDigits(s.f, 3))
        tLabel.frame(dt)
        fLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveFreq(p)
        return [
          { label: 'Frequency f', value: hz(s.f) },
          { label: 'Period T = 1 / f', value: secs(s.period), tone: 'ok' },
          { label: 'ω = 2πf', value: `${+s.omega.toPrecision(3)} rad/s` },
        ]
      },
    }
  },
}

// --- Mains vs battery: steady drift one way, or a slosh back and forth 50 times a second. ---

type Supply = 'battery' | 'eu' | 'us'

const BATTERY_V = 12
const LAMP_W = 60
const WIRE_M2 = 1.5e-6
const SLOW = 50
const M_W = 5
const M_H = 4.6
const M_X = -9.4
const M_SCOPE_X = 7.4
const M_SCOPE_W = 14
const M_SCOPE_H = 10
const SCALE_V = 400
const PER_MV = (M_SCOPE_H / 2) / SCALE_V
const M_WINDOW = 2
const M_SPEED = 3

const solveMains = (p: Params) => {
  const supply = (p.supply as Supply) ?? 'battery'
  const ac = supply !== 'battery'
  const rms = ac ? MAINS[supply as 'eu' | 'us'].rms : BATTERY_V
  const f = ac ? MAINS[supply as 'eu' | 'us'].hz : 0
  const peak = ac ? peakFromRms(rms) : rms
  const ohms = lampOhms(rms, LAMP_W)
  const amps = rms / ohms
  return {
    supply, ac, rms, f, peak, ohms, amps,
    drift: driftVelocity(amps, WIRE_M2),
    slosh: ac ? sloshAmplitude(amps * Math.SQRT2, WIRE_M2, f) : 0,
  }
}
const supplyVolts = (s: ReturnType<typeof solveMains>, realT: number) => (s.ac ? acVolts(s.peak, s.f, realT) : s.peak)

export const mainsVsBattery: Lesson = {
  id: 'ac-vs-dc-mains-vs-battery',
  title: 'Mains vs battery',
  tagline: 'Steady flow versus sloshing',
  formula: (p) => {
    const s = solveMains(p)
    if (!s.ac) return `DC: I = P / V = ${LAMP_W} W / ${BATTERY_V} V = ${si(s.amps, 'A', 3)}, always the same way`
    return `v(t) = ${volts(s.peak)} × sin(2π × ${s.f} Hz × t), Vrms = ${volts(s.rms)}, Irms = ${si(s.amps, 'A', 3)}`
  },
  legend: [
    { color: HIGH_V, label: 'Mains on the scope, V', shape: 'dot' },
    { color: RING, label: 'Battery on the scope, V', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Charges, coloured by potential', shape: 'dot' },
  ],
  points: [
    'A battery is DC: its + terminal always sits 12 V above −, so charges drift steadily one way round the loop and the lamp glows evenly.',
    'Mains is AC: the live wire swings from +325 V to −325 V around neutral 50 times a second (60 in the US, at 120 V). Watch the colours swap. Time here is slowed 50×.',
    'Each half cycle the current reverses, so charges just slosh back and forth. In mains wire they move only tens of nanometres, yet the lamp still lights: energy rides the field, not the electrons’ trip.',
    'The lamp dims at every zero crossing, 100 times a second, too fast to see. Each lamp here is rated 60 W for its supply, so they glow alike on average.',
    'Why AC for the grid? Transformers step it up for thin long-distance lines and down for homes. Electronics want DC, so every charger turns AC into DC first.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'supply',
      options: [
        { value: 'battery', label: 'Battery 12 V' },
        { value: 'eu', label: 'Mains 230 V' },
        { value: 'us', label: 'Mains 120 V' },
      ],
      initial: 'eu',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const loop = lampLoop(scene, [M_X, 0, 0], { w: 2 * M_W, h: 2 * M_H, scale: 0.6, sourceH: 4.4 })
    const { lamp, flow, f } = loop
    const battery = add(loop.group, cell(4.4, 1.5), [-M_W, 0, 0])
    const mains = add(loop.group, acSource(1.8), [-M_W, 0, 0])
    const vNow = pulseLabel(loop.group, 4, HIGH_V, [1, -0.6, 0], 1.3)

    const screen = scope(scene, M_SCOPE_W, M_SCOPE_H)
    screen.group.position.set(M_SCOPE_X, 0, 0)
    const mainsTrace = screen.trace(HIGH_V)
    const batteryTrace = screen.trace(RING)
    for (const m of [mainsTrace.material, batteryTrace.material]) m.transparent = true
    const peakLabel = pulseLabel(scene, 3, HIGH_V, [M_SCOPE_X - M_SCOPE_W / 2 - 2.4, 0, 0], 1.2)

    let t = 0
    let shown = ''
    const w = { battery: 1, mains: 0 }
    return {
      scene,
      view: { center: [-0.6, 2.2, 0], radius: 56, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveMains(p)
        if (s.supply !== shown) {
          if (!shown) w.battery = s.ac ? 0 : 1
          shown = s.supply
          t = 0
        }
        t += dt
        const realT = t / SLOW
        w.battery += ((s.ac ? 0 : 1) - w.battery) * ease(dt)
        w.mains = 1 - w.battery
        presence(battery, w.battery)
        presence(mains, w.mains)

        const v = supplyVolts(s, realT)
        f.top = 0.5 + (0.5 * v) / s.peak
        f.bottom = 1 - f.top
        const i = v / s.ohms
        flow.step(dt * M_SPEED * (i / s.amps))
        lamp.setGlow(clamp01((0.55 * powerV2R(v, s.ohms)) / LAMP_W))

        const mainsShape = s.supply === 'us' ? MAINS.us : MAINS.eu
        const mainsPeak = peakFromRms(mainsShape.rms)
        mainsTrace.scroll((at) => acVolts(mainsPeak, mainsShape.hz, at / SLOW) * PER_MV, t, M_WINDOW)
        batteryTrace.scroll(() => BATTERY_V * PER_MV, t, M_WINDOW)
        mainsTrace.material.opacity = 0.25 + 0.75 * w.mains
        batteryTrace.material.opacity = 0.25 + 0.75 * w.battery
        peakLabel.display.group.position.y = s.peak * PER_MV + 0.9
        peakLabel.show(String(Math.round(s.peak)))
        vNow.show(String(Math.round(v)))
        peakLabel.frame(dt)
        vNow.frame(dt)
      },
      readouts: (p) => {
        const s = solveMains(p)
        return [
          { label: 'Supply', value: s.ac ? `${s.rms} V ${s.f} Hz` : `${s.rms} V DC` },
          { label: 'Peak', value: volts(s.peak) },
          { label: 'Current', value: si(s.amps, 'A', 3) },
          s.ac ? { label: 'Electrons', value: `± ${si(s.slosh, 'm', 2)}`, tone: 'ok' } : { label: 'Drift', value: `${si(s.drift, 'm', 2)}/s`, tone: 'ok' },
        ]
      },
    }
  },
}
