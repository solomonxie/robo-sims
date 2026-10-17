import { CHAIN_PACK, ChainGear, DRIVERS, DriverChip, G, NEWTON_CAR, TRACK_FLOORS, TT_CAR, TrackFloor, U_TRACK, driveChain, fixedStepAt, trackAt, trackLength, trackTop, uTrackRun, winchFreeSpeed, winchLift, winchPull } from '../../core/physics'
import { energyText, kgText, pct } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, SIDE_VIEW, addLabel, addRod, countBars, dotPen, lapseClock, liveLabel, lossWaterfall, memoBy, plotPanel, scope, scrollTape, sideCar, statusHeader, stretchRod, traceRun } from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'
import * as THREE from 'three/webgpu'

const watts = (w: number) => (w < 1 ? `${(w * 1000).toFixed(0)} mW` : `${w.toFixed(2)} W`)
const cmS = (v: number) => `${(v * 100).toFixed(1)} cm/s`
const secs = (t: number) => `${t.toFixed(1)} s`

// --- Kinetic and potential: a TT car released on a U-track trades PE for KE; rolling resistance turns some into heat. ---

const KP = { k: 12.5, at: [-17.6, -9.6, 0] as V3, bars: [-12.6, 2.6, 0] as V3, plot: [6, 0.6, 0] as V3, w: 11, h: 3.6, rest: 1.5 }
const FLOOR_NAMES = Object.fromEntries(Object.entries(TRACK_FLOORS).map(([k, v]) => [k, `${v.name} (crr ${v.crr})`])) as Record<TrackFloor, string>
const kpParams = (p: Params) => ({ h: n(p, 'height') / 100, load: n(p, 'load'), floor: pick(FLOOR_NAMES, p.floor, 'wood') })
type KpQ = ReturnType<typeof kpParams>
const kpKey = (q: KpQ) => `${q.h}|${q.load}|${q.floor}`
const kpRun = memoBy(kpKey, (q: KpQ) => {
  const kg = NEWTON_CAR.massKg + q.load
  return { kg, ...uTrackRun(kg, q.h, TRACK_FLOORS[q.floor].crr) }
})

export const energyWorkKineticAndPotential: Lesson = {
  id: 'energy-work-kinetic-and-potential',
  title: 'Kinetic and potential',
  tagline: 'Height becomes speed and back',
  formula: (p) => {
    const q = kpParams(p)
    const r = kpRun(q)
    return `PE = m g h = ${r.kg.toFixed(1)} × ${G} × ${q.h.toFixed(2)} = ${energyText(r.e0)} · KE = ½ m v² · PE + KE + heat = constant · ideal v at the bottom = √(2 g h) = ${r.idealV.toFixed(2)} m/s`
  },
  legend: [
    { color: B_FIELD, label: 'Potential energy m g h', shape: 'dot' },
    { color: POWER, label: 'Kinetic energy ½ m v²', shape: 'dot' },
    { color: HEAT, label: 'Lost to rolling resistance (heat)', shape: 'dot' },
    { color: RING, label: 'Total: never changes', shape: 'dot' },
  ],
  points: [
    'Energy is the ability to do work, measured in joules. A raised mass stores potential energy PE = m g h; a moving one carries kinetic energy KE = ½ m v². Lift a 1 kg payload 10 cm and it holds about 1 J.',
    'Let a car go from a height and PE turns into KE on the way down, then back into PE on the way up. With no losses it climbs back to exactly the height it started from and reaches √(2 g h) at the bottom whatever its mass: mass is in both PE and KE, so it cancels. Add payload and the energies grow, the motion does not.',
    'Real wheels lose a little to rolling resistance on every metre (Friction & traction › Rolling resistance): that energy leaves as heat, so each swing is lower and the car settles on the flat. Energy is never used up, only moved to places you cannot get it back from. The total bar never changes.',
    'Robots trade the same way: a legged robot’s body rises and falls each step, an arm lifting a payload stores PE that a back-drivable joint gives back on the way down, and a wheel or flywheel stores KE (Rotation › Flywheel). Forces on the slope: Newton’s laws › Free-body diagrams.',
  ],
  controls: [
    { kind: 'slider', key: 'height', label: 'Release height h', min: 10, max: 35, step: 5, initial: 30, format: (v) => `${v} cm` },
    { kind: 'slider', key: 'load', label: 'Payload on the car', min: 0, max: 1.5, step: 0.5, initial: 0.5, format: kgText },
    { kind: 'choice', key: 'floor', options: opts(FLOOR_NAMES), initial: 'wood' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const { k, at } = KP
    const P = (s: number): V3 => {
      const p = trackAt(s)
      return [at[0] + p.x * k, at[1] + p.y * k, 0]
    }
    const trackM = mat('#3a3f4a', { rough: 0.8 })
    const ends = [0, U_TRACK.slope, U_TRACK.slope + U_TRACK.flat, trackLength()]
    for (let i = 0; i < 3; i++) {
      const [a, b] = [P(ends[i]), P(ends[i + 1])]
      const phi = Math.atan2(b[1] - a[1], b[0] - a[0])
      const seg = box(scene, [Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.3, 0.3, 3], trackM, [(a[0] + b[0]) / 2 + 0.15 * Math.sin(phi), (a[1] + b[1]) / 2 - 0.15 * Math.cos(phi), 0])
      seg.rotation.z = phi
    }
    const holder = add(scene, new THREE.Group())
    const car = sideCar(holder, [0, 0, 0], k)
    const pen = dotPen(scene, 200, 0.07)
    const startTag = liveLabel(scene, [0, 0, 0.4], { size: 0.28, color: B_FIELD, align: 'left' })
    const [bx, by] = KP.bars
    addLabel(scene, 'energy now', [bx - 2.8, by + 0.9, 0.2], LABEL, 0.3, 'left')
    const bars = countBars(scene, [bx, by, 0], ['PE', 'KE', 'heat', 'total'], 6)
    const plot = plotPanel(scene, KP.plot, KP.w, KP.h, U_TRACK.seconds, 'energy ÷ start', '', 0, 6)
    const tr = [B_FIELD, POWER, HEAT].map((c) => plot.trace(c, { samples: 240, radius: 0.05 }))
    const clock = lapseClock(U_TRACK.seconds, 1, KP.rest)
    let shown = ''
    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = kpParams(p)
        const r = kpRun(q)
        const t = clock(dt, kpKey(q))
        const f = fixedStepAt(r.frames, t, U_TRACK.dt)
        const pt = trackAt(f.s)
        holder.position.set(at[0] + pt.x * k, at[1] + pt.y * k, 0)
        holder.rotation.z = pt.pitch
        car.set(f.s, q.load)
        if (shown !== kpKey(q)) {
          shown = kpKey(q)
          const y = at[1] + Math.min(q.h, trackTop()) * k
          pen.begin()
          pen.line([at[0], y, 1.8], [at[0] + trackAt(trackLength()).x * k, y, 1.8], 0.35, B_FIELD, 0.8)
          pen.end()
          startTag.group.position.set(at[0] + 0.3, y + 0.5, 1.8)
          startTag.set(`start h ${Math.round(q.h * 100)} cm`)
        }
        const vals = [f.pe, f.ke, f.loss, f.pe + f.ke + f.loss]
        bars.set(vals, vals.map((v) => energyText(v)), [B_FIELD, POWER, HEAT, RING], r.e0)
        const y = (v: number) => (v / r.e0 - 0.5) * KP.h * 0.96
        traceRun(tr[0], r.frames, U_TRACK.dt, U_TRACK.seconds, t, (x) => y(x.pe), 240)
        traceRun(tr[1], r.frames, U_TRACK.dt, U_TRACK.seconds, t, (x) => y(x.ke), 240)
        traceRun(tr[2], r.frames, U_TRACK.dt, U_TRACK.seconds, t, (x) => y(x.loss), 240)
        head.status.set(`Released from ${Math.round(q.h * 100)} cm · ${r.kg.toFixed(1)} kg · ${TRACK_FLOORS[q.floor].name.toLowerCase()}`, LABEL)
        head.sub.set(`side view · t = ${secs(t)} of ${U_TRACK.seconds} s · real time`)
        const still = f.v === 0 && t > 0.5
        head.event.set(
          still ? `stopped: all ${energyText(r.e0)} is now heat` : `h ${Math.round(f.h * 100)} cm · v ${Math.abs(f.v).toFixed(2)} m/s · ${pct(f.ke / r.e0)} of the energy is motion`,
          still ? HEAT : f.ke > f.pe ? POWER : B_FIELD,
        )
      },
      readouts: (p) => {
        const q = kpParams(p)
        const r = kpRun(q)
        const swing = r.frames.filter((f) => f.s > U_TRACK.slope + U_TRACK.flat)
        const reach = swing.length ? Math.max(...swing.map((f) => f.h)) : 0
        return [
          { label: 'Start energy m g h', value: energyText(r.e0) },
          { label: 'Speed at the bottom: ideal / real', value: `${r.idealV.toFixed(2)} / ${r.bottomV.toFixed(2)} m/s` },
          { label: 'Climbs back on the far side', value: `${Math.round(reach * 100)} of ${Math.round(Math.min(q.h, trackTop()) * 100)} cm`, tone: toneOf(reach > 0.95 * q.h, reach > 0.7 * q.h) },
          { label: `Lost as heat after ${U_TRACK.seconds} s`, value: pct(r.frames[r.frames.length - 1].loss / r.e0) },
        ]
      },
    }
  },
}

// --- Work and power: a winch lifts a payload; same work at any speed, power = F v, capped by the motor's curve. ---

const WP = { k: 8.5, post: -14, floor: -9.8, spoolY: 1.4, plot: [4.4, -5.6, 0] as V3, w: 14, h: 5, bars: [1.6, 1.6, 0] as V3, play: 8, rest: 2 }
const wpParams = (p: Params) => ({ kg: n(p, 'mass') / 1000, d: n(p, 'height') / 100, v: n(p, 'speed') / 100 })
type WpQ = ReturnType<typeof wpParams>
const wpKey = (q: WpQ) => `${q.kg}|${q.d}|${q.v}`
const wpRun = memoBy(wpKey, (q: WpQ) => {
  const lift = winchLift(q.kg, q.d, q.v)
  const vFree = winchFreeSpeed()
  const curve = Array.from({ length: 41 }, (_, i) => winchPull((i / 40) * vFree).power)
  return { lift, vFree, curve, peak: Math.max(...curve) }
})

export const energyWorkWorkAndPower: Lesson = {
  id: 'energy-work-work-and-power',
  title: 'Work and power',
  tagline: 'Same job, faster costs more power',
  formula: (p) => {
    const q = wpParams(p)
    const { lift } = wpRun(q)
    return `W = F · d = ${lift.force.toFixed(2)} N × ${q.d.toFixed(2)} m = ${energyText(lift.work)} · P = W / t = F · v = ${lift.force.toFixed(2)} × ${(lift.v).toFixed(3)} = ${watts(lift.power)} · t = ${secs(lift.time)}`
  },
  legend: [
    { color: POWER, label: 'Most power the motor can give', shape: 'dot' },
    { color: RING, label: 'Power this load needs: m g v', shape: 'dot' },
    { color: HEAT, label: 'Electrical energy in', shape: 'dot' },
    { color: HIGH_V, label: 'Heat in the motor coil', shape: 'dot' },
  ],
  points: [
    'Work is force times the distance moved along it: W = F · d, in joules. Lifting a payload of weight m g by d takes W = m g d, the PE it gains (Kinetic and potential). Fast or slow, the work is the same.',
    'Power is how fast work is done: P = W / t = F · v, in watts (J/s). Lift twice as fast and you need twice the power for half the time. A motor has a power limit: its pull drops as it speeds up (DC motor › Torque and speed curve), so the power it can give is a hump, peaking at half its free speed.',
    'Ask for more speed than the curve allows at this load and the winch simply lifts slower: the yellow load line meets the green curve at the top speed. Heavier payloads tilt the load line up and the top speed falls; a bigger gear ratio trades speed for pull (DC motor › Gearboxes).',
    'The electricity bill is not the work. The coil current is set by the load, not the speed, so its I²R heat runs for the whole lift: a slow lift spends more energy than a fast one, and even holding still costs heat unless a worm gear or brake holds the load (Efficiency).',
  ],
  controls: [
    { kind: 'slider', key: 'mass', label: 'Payload', min: 100, max: 2000, step: 100, initial: 500, format: (v) => `${v} g` },
    { kind: 'slider', key: 'height', label: 'Lift height d', min: 20, max: 100, step: 10, initial: 80, format: (v) => `${v} cm` },
    { kind: 'slider', key: 'speed', label: 'Asked lift speed', min: 1, max: 12, step: 1, initial: 4, format: (v) => `${v} cm/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const { k, post, floor, spoolY } = WP
    const frame = mat('#3a3d45', { rough: 0.6 })
    box(scene, [9, 0.4, 4], mat('#3a3f4a', { rough: 0.8 }), [post + 2.5, floor - 0.2, 0])
    box(scene, [0.5, spoolY - floor + 1, 0.5], frame, [post - 1.2, (spoolY + floor) / 2 + 0.5, -0.6])
    box(scene, [3.6, 0.5, 0.5], frame, [post + 0.4, spoolY + 1, -0.6])
    const spool = add(scene, new THREE.Group(), [post + 1.6, spoolY, 0])
    cylinder(spool, 0.6, 1.2, mat('#c8803f', { metal: 0.4, rough: 0.4 }), [0, 0, 0], 'z', 32)
    box(spool, [1.1, 0.12, 1.25], mat('#f2f2f2'), [0, 0, 0])
    box(scene, [1.2, 1.2, 1.6], mat('#f2c12e', { rough: 0.55 }), [post + 1.6, spoolY, -1.5])
    addLabel(scene, 'TT motor 6 V, 1:120 · 1.5 cm spool', [post + 3.4, spoolY + 2, 0.4], GREY, 0.28)
    const rope = addRod(scene, mat('#d8dbe2', { rough: 0.6 }))
    const payload = box(scene, [1, 1, 1], mat('#b8923a', { metal: 0.4, rough: 0.4 }), [post + 2.2, floor, 0])
    const pen = dotPen(scene, 120, 0.06)
    const hTag = liveLabel(scene, [post + 4.2, floor, 0.4], { size: 0.28, color: B_FIELD, align: 'left' })
    const plot = scope(scene, WP.w, WP.h, { divs: [6, 4], zeroAt: 0 })
    const [px, py] = WP.plot
    plot.group.position.set(px, py, 0)
    addLabel(scene, 'power', [px - WP.w / 2, py + WP.h / 2 + 1.1, 0.3], LABEL, 0.3, 'left')
    const peakTag = liveLabel(scene, [px + WP.w / 2, py + WP.h / 2 + 1.1, 0.3], { size: 0.28, color: POWER, align: 'right' })
    addLabel(scene, '0', [px - WP.w / 2, py - WP.h / 2 - 1.1, 0.3], GREY, 0.26, 'left')
    addLabel(scene, 'lift speed', [px, py - WP.h / 2 - 1.1, 0.3], GREY, 0.26)
    const freeTag = liveLabel(scene, [px + WP.w / 2, py - WP.h / 2 - 1.1, 0.3], { size: 0.26, color: GREY, align: 'right' })
    const curve = plot.trace(POWER, { samples: 41, radius: 0.06 })
    const load = plot.trace(RING, { samples: 2, radius: 0.045 })
    const op = plot.trace(RING, { samples: 2, radius: 0.04 })
    const [bx, by] = WP.bars
    const bars = countBars(scene, [bx, by, 0], ['work m g h', 'electric in', 'coil heat'], 5)
    const clock = lapseClock(1e9, 1, 0)
    let shown = ''
    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = wpParams(p)
        const r = wpRun(q)
        const L = r.lift
        const play = Math.min(L.time, WP.play)
        const fast = L.time / play
        const real = clock(dt, wpKey(q)) % (play + WP.rest)
        const t = Math.min(L.time, real * fast)
        const y = L.v * t
        const side = 1.2 + 0.7 * Math.cbrt(q.kg)
        const py0 = floor + y * k
        payload.scale.setScalar(side)
        payload.position.y = py0 + side / 2
        stretchRod(rope, [post + 2.2, spoolY, 0.7], [post + 2.2, py0 + side, 0.7], 0.05)
        spool.rotation.z = -(y / 0.015) * 0.25
        hTag.group.position.y = py0 + side / 2
        hTag.set(`${Math.round(y * 100)} of ${Math.round(q.d * 100)} cm`)
        if (shown !== wpKey(q)) {
          shown = wpKey(q)
          const full = r.peak * 1.25
          const yOf = (w: number) => (w / full - 0.5) * WP.h
          curve.points(r.curve.map((_, i) => i / 40), r.curve.map(yOf))
          const vEnd = Math.min(r.vFree, (full * 0.98) / L.force)
          load.points([0, vEnd / r.vFree], [yOf(0), yOf(L.force * vEnd)])
          op.points([L.v / r.vFree, L.v / r.vFree], [yOf(0), yOf(L.power)])
          peakTag.set(`motor peak ${watts(r.peak)}`)
          freeTag.set(`free ${cmS(r.vFree)}`)
          pen.begin()
          pen.line([post + 0.8, floor + q.d * k, 0.6], [post + 6, floor + q.d * k, 0.6], 0.3, B_FIELD, 0.8)
          pen.end()
        }
        const vals = [L.force * y, L.powerIn * t, L.holdW * t]
        bars.set(vals, vals.map((v) => energyText(v)), [B_FIELD, HEAT, HIGH_V], L.energyIn)
        head.status.set(`Winch lifts ${Math.round(q.kg * 1000)} g by ${Math.round(q.d * 100)} cm at ${cmS(L.v)}${L.limited ? ' (motor limit)' : ''}`, LABEL)
        head.sub.set(`side view · t = ${secs(t)} of ${secs(L.time)} · ${fast > 1.01 ? `${fast.toFixed(1)}× real time` : 'real time'}`)
        head.event.set(
          t >= L.time ? `at the top: ${energyText(L.work)} of work · holding it still burns ${watts(L.holdW)} in the coil` : L.limited ? `asked ${cmS(q.v)}, the motor tops out at ${cmS(L.topV)} with this load` : `P = F v = ${watts(L.power)} of the motor’s ${watts(winchPull(L.v).power)} at this speed`,
          t >= L.time ? HEAT : L.limited ? HIGH_V : POWER,
        )
      },
      readouts: (p) => {
        const L = wpRun(wpParams(p)).lift
        return [
          { label: 'Work W = m g d', value: energyText(L.work) },
          { label: 'Power P = F v · time', value: `${watts(L.power)} · ${secs(L.time)}` },
          { label: 'Top speed with this load', value: cmS(L.topV), tone: L.limited ? 'warn' : 'ok' },
          { label: 'Electrical energy in (work / in)', value: `${energyText(L.energyIn)} (${pct(L.work / L.energyIn)})`, tone: toneOf(L.work / L.energyIn > 0.4, L.work / L.energyIn > 0.2) },
        ]
      },
    }
  },
}

// --- Efficiency: battery → driver → motor → gearbox → wheel, every loss stacked as a waterfall. ---

const EF = { k: 15, car: [-3.5, 1.4, 0] as V3, fall: [-17, -8.4, 0] as V3, w: 31, h: 4.8 }
const LOSS_NAMES = { pack: 'pack', driver: 'driver', copper: 'motor coil', friction: 'motor friction', gears: 'gearbox', rolling: 'rolling' }
const CHIPS = Object.fromEntries(Object.entries(DRIVERS).map(([key, d]) => [key, d.name])) as Record<DriverChip, string>
const GEARS: Record<ChainGear, string> = { tt48: 'TT 1:48', tt120: 'TT 1:120' }
const STAGES = ['battery', 'pack', 'driver', 'motor coil', 'motor friction', 'gearbox', 'wheel'] as const
const efParams = (p: Params) => ({ chip: pick(CHIPS, p.chip, 'l298n'), gear: pick(GEARS, p.gear, 'tt48'), deg: n(p, 'slope') })
type EfQ = ReturnType<typeof efParams>
const efKey = (q: EfQ) => `${q.chip}|${q.gear}|${q.deg}`
const efRun = memoBy(efKey, (q: EfQ) => driveChain(q.chip, q.gear, q.deg))

export const energyWorkEfficiency: Lesson = {
  id: 'energy-work-efficiency',
  title: 'Efficiency',
  tagline: 'Every stage takes a cut',
  formula: (p) => {
    const c = efRun(efParams(p))
    const { pack, driver, copper, friction, gears } = c.losses
    let w = c.chemW
    const eta = [pack, driver, copper + friction, gears].map((l) => {
      const e = (w - l) / w
      w -= l
      return pct(e)
    })
    return `η = P_out / P_in = η_pack × η_driver × η_motor × η_gear = ${eta.join(' × ')} = ${pct(c.toWheel)} battery → wheel · ${watts(c.chemW)} in, ${watts(c.wheelW)} at the wheels`
  },
  legend: [
    { color: POWER, label: 'Power still flowing on to the next stage', shape: 'dot' },
    { color: HIGH_V, label: 'Lost in that stage as heat', shape: 'dot' },
    { color: HEAT, label: 'At the wheel: rolling resistance (also heat)', shape: 'dot' },
    { color: B_FIELD, label: 'At the wheel: lifting the car (PE gained)', shape: 'dot' },
  ],
  points: [
    'Efficiency η = useful power out ÷ power in. Every stage of a drive train loses some as heat, and the efficiencies multiply: four stages at 90 % give 66 %, not 90 %.',
    'Follow the TT car up the slope. The pack loses I²R in its internal resistance (Battery chemistry › Internal resistance). An L298N drops about 2 V across its bipolar switches, a MOSFET driver a few tenths (H-bridge › L298N vs modern drivers). The motor loses I²R in its coil and pays brush and bearing friction even at no load; each gear mesh loses ~10 % (DC motor › Gearboxes).',
    'A small motor run lightly loaded is mostly friction: on the flat almost all the battery power goes to keeping the motor turning. Steeper slopes load it nearer its best point (DC motor › Torque and speed curve), so efficiency rises until coil heat takes over. On the flat even the wheel power ends as heat in rolling resistance: only the lifting part is stored.',
    'Efficiency is runtime: the pack holds a fixed number of watt-hours, so every wasted watt is minutes of driving (Power budget › Runtime estimate). Swapping an L298N for a MOSFET driver is the cheapest win on a small robot.',
  ],
  controls: [
    { kind: 'choice', key: 'chip', options: opts(CHIPS), initial: 'l298n' },
    { kind: 'choice', key: 'gear', options: opts(GEARS), initial: 'tt48' },
    { kind: 'slider', key: 'slope', label: 'Slope', min: 0, max: 20, step: 2, initial: 10, format: (v) => `${v}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const ramp = add(scene, new THREE.Group(), EF.car)
    const tape = scrollTape(ramp, [0, 0, 0], 12, 1.5)
    const car = sideCar(ramp, [0, 0, 0], EF.k)
    const speedTag = liveLabel(scene, [EF.car[0] + 7, EF.car[1] - 1.2, 0.4], { size: 0.3, color: POWER, align: 'left' })
    const fall = lossWaterfall(scene, EF.fall, STAGES, EF.w, EF.h)
    addLabel(scene, `power at each stage · 2S ${CHAIN_PACK.chem.name}, two TT motors`, [EF.fall[0], EF.fall[1] + EF.h + 1.5, 0.2], LABEL, 0.3, 'left')
    let x = 0
    let travel = 0
    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = efParams(p)
        const c = efRun(q)
        ramp.rotation.z = (q.deg * Math.PI) / 180
        travel += c.v * dt
        x += c.v * dt * EF.k
        tape(x)
        car.set(travel, 0)
        speedTag.set(`${cmS(c.v)} up ${q.deg}°`)
        const L = c.losses
        const loss = [0, L.pack, L.driver, L.copper, L.friction, L.gears]
        let left = c.chemW
        const kept = loss.map((l) => (left -= l))
        kept.push(L.rolling)
        loss.push(c.liftW)
        const texts = loss.map((l, j) => (j === 0 ? watts(c.chemW) : j === loss.length - 1 ? `lift ${watts(c.liftW)}` : `−${watts(l)}`))
        const colors = STAGES.map((_, j) => (j === 0 ? [POWER, LABEL] : j === STAGES.length - 1 ? [HEAT, B_FIELD] : [POWER, HIGH_V]) as [string, string])
        fall.set(kept, loss, texts, c.chemW, colors)
        head.status.set(`TT car up ${q.deg}° · ${CHIPS[q.chip]} · ${GEARS[q.gear]} · battery → wheel ${pct(c.toWheel)}`, LABEL)
        head.sub.set(`side view · ${(c.amps * 1000).toFixed(0)} mA per motor at ${c.motorV.toFixed(2)} V · steady climb, real time`)
        const big = (Object.entries(L) as [keyof typeof L, number][]).filter(([key]) => key !== 'rolling').reduce((a, b) => (b[1] > a[1] ? b : a))
        head.event.set(`biggest loss: ${LOSS_NAMES[big[0]]} ${watts(big[1])} (${pct(big[1] / c.chemW)})`, HIGH_V)
      },
      readouts: (p) => {
        const c = efRun(efParams(p))
        const climb = (c.liftW * c.hours * 3600) / (TT_CAR.massKg * G)
        return [
          { label: 'Battery → wheel', value: pct(c.toWheel), tone: toneOf(c.toWheel > 0.3, c.toWheel > 0.15) },
          { label: 'Drawn from the pack', value: watts(c.chemW) },
          { label: 'Runtime on the pack', value: `${c.hours.toFixed(1)} h (${c.wh.toFixed(0)} Wh)` },
          { label: 'Height climbed per charge', value: climb > 0 ? `${Math.round(climb)} m` : 'none on the flat' },
        ]
      },
    }
  },
}
