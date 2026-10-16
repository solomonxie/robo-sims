import * as THREE from 'three/webgpu'
import {
  FOLLOWER,
  FollowCfg,
  FollowFrame,
  FollowMode,
  HEATERS,
  HEATER_BOX,
  Pose,
  RELAY_LIFE_OPS,
  ThermoFrame,
  cycleStats,
  fixedStepAt,
  followRun,
  followStats,
  relayLifeHours,
  thermostatRun,
} from '../../core/physics'
import { cmText } from '../../core/units'
import { V3, add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  POWER,
  RING,
  SIDE_SCOPE,
  cableRun,
  controlLoop,
  diffBot,
  flatBox,
  floorMat,
  floorView,
  glide,
  glowBox,
  glowMat,
  heatGlow,
  heatWaves,
  liveLabel,
  memoBy,
  pointCloud,
  relayPart,
  scopeLabels,
  shellMat,
  statusHeader,
  thermometer,
  traceRun,
  sideScope,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const VIEW = { center: [-2.2, -1.3, 0] as V3, radius: 54, polar: 1.45, azimuth: 0 }
const DIAG = { at: [SIDE_SCOPE.x, 2.4, 0] as V3, w: 12.5, h: 3.6 }
const SCOPE = { y: -4.4, h: 4.6 }
const degC = (c: number) => `${c.toFixed(1)} °C`
const kelvin = (k: number) => `${k.toFixed(1)} K`
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const lifeText = (h: number) => (!Number.isFinite(h) ? 'forever' : h > 24 * 365 ? `${(h / 24 / 365).toFixed(1)} years` : h > 48 ? `${Math.round(h / 24)} days` : h > 1 ? `${h.toFixed(1)} h` : `${Math.round(h * 60)} min`)

// --- Thermostat: a relay switches a 40 W heater in a box; the element's stored heat keeps the air rising after the relay opens. ---

const TH = { slow: 60, rest: 2, box: [-11.4, -3.4, 0] as V3, size: [8.6, 6, 3.2] as V3 }
const HEATER_OPTS = Object.fromEntries(Object.entries(HEATERS).map(([k, h]) => [k, h.name])) as Record<keyof typeof HEATERS, string>
const thParams = (p: Params) => {
  const heater = pick(HEATERS, p.heater, 'ceramic')
  return { sp: n(p, 'setpoint'), band: n(p, 'band'), heater, jPerK: HEATERS[heater].jPerK }
}
type ThQ = ReturnType<typeof thParams>
const thKey = (q: ThQ) => `${q.sp}|${q.band}|${q.jPerK}`
const thRun = memoBy(thKey, (q: ThQ) => {
  const run = thermostatRun(q.sp, q.band, q.jPerK)
  return { run, stats: cycleStats(run, q.sp, q.band) }
})

export const thermostat: Lesson = {
  id: 'bang-bang-hysteresis-thermostat',
  title: 'Thermostat',
  tagline: 'Full on, full off, and a band in between',
  formula: (p) => {
    const q = thParams(p)
    return `on if T < ${degC(q.sp - q.band / 2)} · off if T > ${degC(q.sp + q.band / 2)} · else keep · ${HEATER_BOX.watts} W heater, element ${q.jPerK} J/K, ${HEATER_BOX.elemWPerK} W/K into the air → still ~${Math.round(HEATER_BOX.watts / HEATER_BOX.elemWPerK)} K hotter than the air when the relay opens`
  },
  legend: [
    { color: RING, label: 'Air temperature in the box', shape: 'dot' },
    { color: B_FIELD, label: 'Setpoint band: switch-on / switch-off', shape: 'dot' },
    { color: POWER, label: 'Relay: heater on (scope bottom)', shape: 'dot' },
    { color: HEAT, label: 'Hot element: heat still flowing into the air', shape: 'dot' },
  ],
  points: [
    'Bang-bang is the simplest controller there is: the output is only full on or full off. A thermostat reads a thermistor in the box and clicks a relay that switches a 40 W heater. No tuning, no maths, and it is how ovens, fridges, kettles and 3D-printer enclosures are run.',
    'Switching at one exact temperature would make the relay rattle every time the reading crosses it, so the thermostat uses two thresholds: on below the lower one, off above the upper one, and in between it keeps doing what it was doing. That memory is hysteresis — the same trick as a Schmitt trigger on a signal (see Comparator).',
    'The temperature still goes past both thresholds. When the relay opens, the element is about 20 K hotter than the air and keeps pouring its stored heat in, and the probe lags behind the air, so the air overshoots; on the way down the heater needs time to warm up again. A heavier element (oil-filled) stores more and overshoots more — even with no band at all the box ripples by about a kelvin.',
    'The band is the trade-off: wide means fewer clicks and a longer relay life but a bigger temperature swing; narrow means a steadier box and a relay that wears out sooner (contacts last about 100 000 switchings). For a fixed band, more lag means slower but bigger cycles.',
  ],
  controls: [
    { kind: 'slider', key: 'band', label: 'Hysteresis band', min: 0, max: 6, step: 0.5, initial: 2, format: (v) => kelvin(v) },
    { kind: 'slider', key: 'setpoint', label: 'Setpoint', min: 30, max: 50, step: 1, initial: 40, format: (v) => `${v} °C` },
    { kind: 'choice', key: 'heater', options: opts(HEATER_OPTS), initial: 'ceramic' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const [bx, by] = TH.box
    const [w, h, d] = TH.size
    add(scene, mesh(new THREE.BoxGeometry(w, h, d), shellMat('#9fb4d0', 0.12)), TH.box).castShadow = false
    flatBox(scene, [w + 0.6, 0.5, d + 0.4], new THREE.MeshStandardMaterial({ color: '#3a3f4a', roughness: 0.8 }), [bx, by - h / 2 - 0.25, 0])
    const air = glowBox(scene, [w - 0.3, h - 0.3, d - 0.3], TH.box, LOW_V, 0.1)
    const airM = air.m
    const elemY = by - h / 2 + 0.9
    const elemM = new THREE.MeshStandardMaterial({ color: '#6b5a50', roughness: 0.5, metalness: 0.3 })
    const elem = add(scene, mesh(new THREE.CylinderGeometry(0.3, 0.3, 5, 20), elemM), [bx - 0.8, elemY, 0])
    elem.rotation.z = Math.PI / 2
    const waves = heatWaves(scene, 6.5, { count: 6, rise: 5 })
    waves.group.position.set(bx - 0.8, elemY + 0.3, 0)
    waves.group.scale.setScalar(0.6)
    const therm = thermometer(7)
    therm.group.scale.setScalar(0.6)
    add(scene, therm.group, [bx + 3.3, by - h / 2 + 0.3, 0.4])
    const airTag = liveLabel(scene, [bx, by + h / 2 + 0.55, 0.3], { size: 0.34 })
    const elemTag = liveLabel(scene, [bx - 0.8, elemY - 0.65, d / 2 + 0.1], { size: 0.26 })

    const relay = relayPart(scene, [-3.4, -6.6, 0], { scale: 0.4 })
    const relayTag = liveLabel(scene, [-3.3, -2.2, 0.3], { size: 0.3 })
    const { no, com } = relay.pins
    const floorY = -8.4
    cableRun(scene, [no, [no[0], floorY, 0], [bx + 1.7, floorY, 0], [bx + 1.7, elemY, 0]], '#d8322c', 0.08)
    cableRun(scene, [com, [com[0], floorY + 0.3, 0], [com[0] + 1.4, floorY + 0.3, 0]], '#d8322c', 0.08)
    liveLabel(scene, [com[0] + 1.6, floorY + 0.3, 0.3], { size: 0.26, color: GREY, align: 'left' }).set('mains L', GREY)

    const loop = controlLoop(scene, DIAG.at, { ctrl: 'thermostat', plant: 'heater + box', sensor: 'thermistor', disturb: true, w: DIAG.w, h: DIAG.h })
    const plot = sideScope(scene, SCOPE.y, SCOPE.h, { divs: [6, 4], zeroAt: -1 })
    const hiTr = plot.trace(B_FIELD, { samples: 2, radius: 0.04 })
    const loTr = plot.trace(B_FIELD, { samples: 2, radius: 0.04 })
    const onTr = plot.trace(POWER, { samples: 400, radius: 0.05 })
    const airTr = plot.trace(RING, { samples: 300, radius: 0.08 })
    scopeLabels(scene, SCOPE.y, SCOPE.h, null, 'air · setpoint −10 … +6 K', 'relay on/off')
    liveLabel(scene, [SIDE_SCOPE.x - SIDE_SCOPE.w / 2, SCOPE.y - SCOPE.h / 2 - 1.1, 0.3], { size: 0.26, color: GREY, align: 'left' }).set('0', GREY)
    liveLabel(scene, [SIDE_SCOPE.x + SIDE_SCOPE.w / 2, SCOPE.y - SCOPE.h / 2 - 1.1, 0.3], { size: 0.26, color: GREY, align: 'right' }).set(`${HEATER_BOX.seconds / 60} min`, GREY)
    const top = SCOPE.h / 2 - 0.2
    const bottom = -SCOPE.h / 2 + 1.2
    const yT = (q: ThQ, c: number) => bottom + ((c - (q.sp - 10)) / 16) * (top - bottom)
    const yOn = (on: boolean) => -SCOPE.h / 2 + (on ? 0.85 : 0.25)
    const cold = new THREE.Color(LOW_V)
    const hot = new THREE.Color(HEAT)

    const st = { key: '', t: 0, close: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = thParams(p)
        const { run, stats } = thRun(q)
        if (thKey(q) !== st.key) {
          st.key = thKey(q)
          st.t = 0
          hiTr.points([0, 1], [yT(q, q.sp + q.band / 2), yT(q, q.sp + q.band / 2)])
          loTr.points([0, 1], [yT(q, q.sp - q.band / 2), yT(q, q.sp - q.band / 2)])
        }
        st.t += dt * TH.slow
        if (st.t > HEATER_BOX.seconds + TH.rest * TH.slow) st.t = 0
        const t = Math.min(st.t, HEATER_BOX.seconds)
        const f = fixedStepAt(run, t, HEATER_BOX.dt) as ThermoFrame
        const i = Math.round(t / HEATER_BOX.dt)
        const prev = run[Math.max(0, i - Math.round(4 / HEATER_BOX.dt))]
        traceRun(airTr, run, HEATER_BOX.dt, HEATER_BOX.seconds, t, (g) => yT(q, g.air), 300)
        traceRun(onTr, run, HEATER_BOX.dt, HEATER_BOX.seconds, t, (g) => yOn(g.on), 400)

        const warm = THREE.MathUtils.clamp((f.air - HEATER_BOX.ambient) / 30, 0, 1)
        airM.color.copy(cold).lerp(hot, warm)
        airM.emissive.copy(airM.color)
        airM.opacity = 0.06 + 0.14 * warm
        const excess = f.elem - f.air
        heatGlow(elemM, excess / 22)
        waves.step(dt, excess / 20)
        therm.set((f.meas - HEATER_BOX.ambient) / 40)
        st.close = glide(dt, st.close, f.on ? 1 : 0, 30)
        relay.set(st.close, f.on ? 1 : 0)
        relay.coilFlow.step(f.on ? dt * 8 : 0)
        relayTag.set(f.on ? 'relay ON · heater 40 W' : 'relay OFF', f.on ? POWER : GREY)
        airTag.set(`air ${degC(f.air)} · probe ${degC(f.meas)}`, RING)
        elemTag.set(`element ${degC(f.elem)}`, excess > 3 ? HEAT : GREY)

        const lo = q.sp - q.band / 2
        const hi = q.sp + q.band / 2
        const rising = f.air > prev.air + 0.01
        loop.set(dt, { r: 0.5, e: Math.min(1, Math.abs(q.sp - f.meas) / 3), u: f.on ? 1 : 0, y: warm, m: warm, d: 0.4 }, {
          r: `${q.sp} °C ± ${(q.band / 2).toFixed(2)}`,
          e: f.meas < lo ? 'below band' : f.meas > hi ? 'above band' : 'in band: keep',
          u: f.on ? 'ON' : 'OFF',
          y: degC(f.air),
          m: degC(f.meas),
          d: `loss to ${HEATER_BOX.ambient} °C room`,
        })
        status.set(`Relay thermostat · ${q.sp} °C, band ${kelvin(q.band)} · ${HEATERS[q.heater].name.toLowerCase()} element`, LABEL)
        if (stats.settledAt === null || t < stats.settledAt) event.set(`warming up from ${HEATER_BOX.ambient} °C: heater on until the probe passes ${degC(hi)}`, POWER)
        else if (!f.on && rising) event.set(`relay off, but the element is ${kelvin(excess)} hotter: air still rising past ${degC(hi)}`, HEAT)
        else if (!f.on) event.set(`off: cooling toward ${degC(lo)}, then click on`, LOW_V)
        else if (!rising) event.set(`relay on, but the element must warm first: air still falling`, HIGH_V)
        else event.set(`on: heating toward ${degC(hi)}, then click off`, POWER)
        let clicks = 0
        for (let k = 1; k <= i; k++) if (run[k].on && !run[k - 1].on) clicks++
        sub.set(`${clock(t)} / ${clock(HEATER_BOX.seconds)} · time-lapse ${TH.slow}× · relay has clicked on ${clicks} times`)
      },
      readouts: (p) => {
        const q = thParams(p)
        const s = thRun(q).stats
        return [
          { label: 'Air ripple, peak to peak', value: kelvin(s.ripple), tone: s.ripple < 2 ? 'ok' : s.ripple < 4 ? 'warn' : 'bad' },
          { label: 'Overshoot past switch-off', value: `+${kelvin(s.overshoot)}`, tone: s.overshoot < 0.6 ? 'ok' : 'warn' },
          { label: 'Cycle period · clicks per hour', value: `${s.period === null ? '—' : clock(s.period)} · ${s.perHour.toFixed(0)}` },
          { label: `Relay life (${RELAY_LIFE_OPS / 1000}k ops)`, value: lifeText(relayLifeHours(s.perHour)), tone: s.perHour > 30 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Chatter: no band + sensor noise → the steering flips at loop rate; a band or a hold time calm it, P never flips. ---

const CH = { slow: 0.25, rest: 1, window: 1.5, every: 4, at: [-16.2, -3.6, 0] as V3, k: 10, robotK: 1.4, fx: [-0.1, 1.6] as [number, number], fy: [-0.14, 0.14] as [number, number] }
const MODES: Record<FollowMode, string> = { bang: 'Bang-bang', band: 'Hysteresis', hold: 'Min on/off time', p: 'Proportional' }
const chParams = (p: Params): FollowCfg => ({
  mode: pick(MODES, p.mode, 'bang'),
  noiseM: n(p, 'noise') / 1000,
  bandM: n(p, 'band') / 1000,
  holdS: n(p, 'hold') / 1000,
  kp: n(p, 'kp'),
})
const chKey = (c: FollowCfg) => `${c.mode}|${c.noiseM}|${c.bandM}|${c.holdS}|${c.kp}`
const chRun = memoBy(chKey, (c: FollowCfg) => {
  const run = followRun(c)
  const ghost = followRun({ ...c, mode: 'p' })
  return { run, ghost, stats: followStats(run), ghostStats: followStats(ghost) }
})
const ctrlText = (c: FollowCfg) =>
  c.mode === 'band' ? `band ±${Math.round(c.bandM * 1000)} mm` : c.mode === 'hold' ? `hold ≥ ${Math.round(c.holdS * 1000)} ms` : c.mode === 'p' ? `P: ${c.kp} %/cm` : 'bang-bang'
const blockText = (c: FollowCfg) => (c.mode === 'band' ? `±${Math.round(c.bandM * 1000)} mm` : c.mode === 'hold' ? `hold ${Math.round(c.holdS * 1000)}ms` : c.mode === 'p' ? 'P: Kp·e' : 'bang-bang')
const mmText = (m: number) => `${(m * 1000).toFixed(m < 0.01 ? 1 : 0)} mm`

export const chatter: Lesson = {
  id: 'bang-bang-hysteresis-chatter',
  title: 'Chatter',
  tagline: 'No band plus a noisy sensor: on-off-on-off at loop rate',
  formula: (p) => {
    const c = chParams(p)
    if (c.mode === 'p') return `steer = clamp(Kp·e) = ${c.kp} %/cm × e · small e → small steer, so noise only nudges it · no full-swing reversals`
    if (c.mode === 'band') return `right if e > +${mmText(c.bandM)} · left if e < −${mmText(c.bandM)} · else keep · noise must jump ${mmText(2 * c.bandM)} to flip it`
    if (c.mode === 'hold') return `steer = sign(e), but held ≥ ${Math.round(c.holdS * 1000)} ms after each flip → at most ${(1 / c.holdS).toFixed(1)} flips/s`
    return `steer = sign(e) every ${Math.round(FOLLOWER.dt * 1000)} ms · near the edge noise σ ${mmText(c.noiseM)} flips the sign on almost every sample`
  },
  legend: [
    { color: B_FIELD, label: 'Steering left (trail, sensor)', shape: 'dot' },
    { color: HEAT, label: 'Steering right; sensor offset e (scope ±3 cm)', shape: 'dot' },
    { color: POWER, label: 'Steer command (scope ±100 %)', shape: 'dot' },
    { color: GREY, label: 'Ghost: proportional steering, same noise', shape: 'dot' },
  ],
  points: [
    'A line follower is a bang-bang controller in its simplest form: one IR sensor on the line\'s edge, "if I see white, turn right, else turn left". Every 5 ms it decides again, and each decision drives the motors to the opposite extreme.',
    'With a perfect sensor it already buzzes: the robot sits on the edge, flipping left-right about 20 times a second. Add sensor noise (a few mm from a bumpy floor or flickering lights) and near the edge every sample is a coin toss: the command flips 60–80 times a second. That is chatter.',
    'Chatter is wear and noise. Each flip reverses the motors through the H-bridge: current spikes, heat, a buzzing gearbox and electrical noise (EMI) on the supply that can upset sensors and radio. On a relay it is far worse — at 50 flips/s its 100 000-switch contact life is gone in half an hour.',
    'Two fixes: a hysteresis band (only flip once the error passes ±b, like the thermostat) or a minimum on/off time. Both trade the buzz for a slower, wider zig-zag. The real cure is to stop being bang-bang: proportional steering turns gently for small errors, so noise only nudges it (see PID).',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'bang' },
    { kind: 'slider', key: 'noise', label: 'Sensor noise σ', min: 0, max: 5, step: 0.5, initial: 2, format: (v) => `${v.toFixed(1)} mm` },
    { kind: 'slider', key: 'band', label: 'Hysteresis ±', min: 1, max: 15, step: 1, initial: 6, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'hold', label: 'Min on/off time', min: 50, max: 400, step: 25, initial: 150, format: (v) => `${v} ms` },
    { kind: 'slider', key: 'kp', label: 'Kp (proportional)', min: 10, max: 80, step: 5, initial: 40, format: (v) => `${v} %/cm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = floorView(scene, CH.at, CH.k, -0.25)
    floorMat(g, CH.fx, CH.fy)
    flatBox(g, [CH.fx[1] - CH.fx[0], 0.019, 0.003], glowMat(LABEL, 0.35), [(CH.fx[0] + CH.fx[1]) / 2, -0.0095, 0.004])
    liveLabel(g, [CH.fx[0] + 0.02, -0.05, 0.01], { size: 0.03, color: GREY, align: 'left' }).set('line', GREY)
    const steps = Math.ceil(FOLLOWER.seconds / FOLLOWER.dt / CH.every) + 1
    const dots = pointCloud(g, steps, 0.0035)
    const ghost = diffBot(g, { ghost: GREY })
    ghost.group.scale.setScalar(CH.robotK)
    const bot = diffBot(g)
    bot.group.scale.setScalar(CH.robotK)
    const eyeM = glowMat(B_FIELD, 1.4)
    add(bot.group, mesh(new THREE.SphereGeometry(0.008, 12, 8), eyeM), [0.075, 0, 0.012])
    const flipTag = liveLabel(scene, [-8.4, -6.6, 0.3], { size: 0.45 })

    const loop = controlLoop(scene, DIAG.at, { ctrl: 'bang-bang', plant: 'motors', sensor: 'IR sensor', noise: true, w: DIAG.w, h: DIAG.h })
    const plot = sideScope(scene, SCOPE.y, SCOPE.h, { divs: [6, 4] })
    const sTr = plot.trace(POWER, { samples: 301, radius: 0.04 })
    const eTr = plot.trace(HEAT, { samples: 301, radius: 0.05 })
    scopeLabels(scene, SCOPE.y, SCOPE.h, null, 'sensor e ±3 cm', 'steer ±100 %')
    liveLabel(scene, [SIDE_SCOPE.x - SIDE_SCOPE.w / 2, SCOPE.y - SCOPE.h / 2 - 1.1, 0.3], { size: 0.26, color: GREY, align: 'left' }).set(`−${CH.window} s`, GREY)
    liveLabel(scene, [SIDE_SCOPE.x + SIDE_SCOPE.w / 2, SCOPE.y - SCOPE.h / 2 - 1.1, 0.3], { size: 0.26, color: GREY, align: 'right' }).set('now', GREY)
    const half = (SCOPE.h / 2) * 0.95
    const windowTrace = (tr: typeof sTr, run: FollowFrame[], now: number, value: (f: FollowFrame) => number) => {
      const k1 = Math.min(run.length - 1, Math.round(now / FOLLOWER.dt))
      const k0 = Math.max(0, k1 - Math.round(CH.window / FOLLOWER.dt))
      const us: number[] = []
      const ys: number[] = []
      for (let k = k0; k <= k1; k++) {
        us.push((run[k].t - now + CH.window) / CH.window)
        ys.push(value(run[k]))
      }
      tr.points(us, ys)
    }
    const steerColor = (s: number, c: FollowCfg) => (c.mode === 'p' ? (Math.abs(s) < 0.15 ? RING : s > 0 ? HEAT : B_FIELD) : s > 0 ? HEAT : B_FIELD)

    const st = { key: '', t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const c = chParams(p)
        const { run, ghost: gRun, stats } = chRun(c)
        if (chKey(c) !== st.key) {
          st.key = chKey(c)
          st.t = 0
        }
        st.t += dt * CH.slow
        if (st.t > FOLLOWER.seconds + CH.rest * CH.slow) st.t = 0
        const t = Math.min(st.t, FOLLOWER.seconds)
        const f = fixedStepAt(run, t, FOLLOWER.dt)
        const gf = fixedStepAt(gRun, t, FOLLOWER.dt)
        bot.set(f.pose as Pose, f.dL, f.dR)
        ghost.set(gf.pose as Pose)
        ghost.group.visible = c.mode !== 'p'
        const i = Math.round(t / FOLLOWER.dt)
        const shown = Math.floor(i / CH.every) + 1
        for (let j = 0; j < shown; j++) {
          const fr = run[j * CH.every]
          dots.set(j, [fr.pose.x, fr.pose.y, 0.004], steerColor(fr.steer, c))
        }
        dots.show(shown)
        eyeM.color.set(steerColor(f.steer, c))
        eyeM.emissive.set(steerColor(f.steer, c))
        windowTrace(eTr, run, t, (h) => Math.max(-1, Math.min(1, h.meas / 0.03)) * half)
        windowTrace(sTr, run, t, (h) => h.steer * half * 0.9)

        const recent = run[Math.max(0, i - Math.round(0.5 / FOLLOWER.dt))]
        const rate = i > 0 ? (f.flips - recent.flips) / Math.min(0.5, t) : 0
        flipTag.set(c.mode === 'p' ? `steer ${Math.round(f.steer * 100)} % · no flips` : `${f.flips} flips · ${rate.toFixed(0)}/s`, rate > 20 ? HIGH_V : rate > 5 ? HEAT : POWER)
        loop.set(dt, { r: 0.4, e: Math.min(1, Math.abs(f.meas) / 0.02), u: Math.abs(f.steer), y: 0.6, m: 0.6, n: c.noiseM * 200 }, {
          r: 'line edge',
          e: `e ${(f.meas * 1000).toFixed(1)} mm`,
          u: c.mode === 'p' ? `steer ${Math.round(f.steer * 100)} %` : f.steer > 0 ? 'RIGHT' : 'LEFT',
          y: `offset ${(f.pose.y * 1000).toFixed(1)} mm`,
          n: c.noiseM > 0 ? `noise σ ${mmText(c.noiseM)}` : 'no noise',
        }, { ctrl: blockText(c) })
        status.set(`Line follower on one IR sensor · ${ctrlText(c)}`, LABEL)
        if (c.mode === 'p') event.set(`steers in proportion: e ${(f.meas * 1000).toFixed(1)} mm → ${Math.round(f.steer * 100)} %, noise only nudges it`, POWER)
        else if (stats.flipsPerS > 20) event.set(`chatter: ${stats.flipsPerS.toFixed(0)} motor reversals per second while hugging the edge`, HIGH_V)
        else event.set(`calm: ${stats.flipsPerS.toFixed(1)} flips/s, but zig-zags ${cmText(stats.wiggle)} across the line`, HEAT)
        sub.set(`${t.toFixed(2)} / ${FOLLOWER.seconds} s · slowed ${1 / CH.slow}× · loop ${Math.round(1 / FOLLOWER.dt)} Hz · ${FOLLOWER.v} m/s`)
      },
      readouts: (p) => {
        const c = chParams(p)
        const { stats, ghostStats } = chRun(c)
        return [
          { label: 'Full-swing flips per second', value: stats.flipsPerS.toFixed(1), tone: stats.flipsPerS > 20 ? 'bad' : stats.flipsPerS > 5 ? 'warn' : 'ok' },
          { label: 'Zig-zag across the line, peak to peak', value: cmText(stats.wiggle), tone: stats.wiggle > 0.015 ? 'warn' : 'ok' },
          { label: 'RMS offset: this · proportional', value: `${mmText(stats.rms)} · ${mmText(ghostStats.rms)}` },
          { label: `A relay at this rate (${RELAY_LIFE_OPS / 1000}k ops)`, value: lifeText(relayLifeHours(stats.flipsPerS * 3600)), tone: stats.flipsPerS > 5 ? 'bad' : 'ok' },
        ]
      },
    }
  },
}
