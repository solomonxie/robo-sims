import { BUMP_BOT, G, brakeOnlyStop, bumpRun, cartsRun, fixedStepAt } from '../../core/physics'
import { energyText, kgText } from '../../core/units'
import { V3, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, SIDE_SCOPE, SIDE_VIEW, addLabel, coilSpring, dotPen, forceArrow, glowMat, lapseClock, liveLabel, lossWaterfall, memoBy, microSwitch, microSwitchReach, plotPanel, setGlow, sideCar, statusHeader, sumBars, traceRun } from '../fx'
import { Lesson, Params, Stage, n, toneOf } from '../types'

const mps = (v: number) => `${v < -0.005 ? '−' : ''}${Math.abs(v).toFixed(2)} m/s`
const pText = (p: number) => `${p < -0.0005 ? '−' : ''}${Math.abs(p).toFixed(2)} kg·m/s`
const mm = (x: number) => `${(x * 1000).toFixed(1)} mm`
const ms = (t: number) => `${(t * 1000).toFixed(0)} ms`

// --- Elastic and inelastic: cart A runs into cart B; momentum is always kept, kinetic energy only when e = 1. ---

const EI = { k: 20, floor: 1.4, vA: 0.5, strobe: 0.1, rest: 1.2, mom: [-8.6, -1.6, 0] as V3, ke: [3.6, -5.5, 0] as V3 }
const CART_KG = BUMP_BOT.massKg
const eiParams = (p: Params) => ({ mA: n(p, 'massA'), mB: n(p, 'massB'), vB: n(p, 'speedB'), e: n(p, 'restitution') })
type EiQ = ReturnType<typeof eiParams>
const eiKey = (q: EiQ) => `${q.mA}|${q.mB}|${q.vB}|${q.e}`
const eiRun = memoBy(eiKey, (q: EiQ) => cartsRun({ m1: q.mA, m2: q.mB, v1: EI.vA, v2: q.vB, e: q.e, end: 0.5 }))
const kind = (e: number) => (e >= 0.99 ? 'elastic' : e <= 0.01 ? 'perfectly inelastic: they stick' : 'partly inelastic')

export const collisionsElasticAndInelastic: Lesson = {
  id: 'collisions-elastic-and-inelastic',
  title: 'Elastic and inelastic',
  tagline: 'Momentum always survives, energy not',
  formula: (p) => {
    const q = eiParams(p)
    const r = eiRun(q)
    return `p = m·v · mA·vA + mB·vB = ${pText(r.p0)} before = ${pText(r.p1)} after · e = (vB′ − vA′)/(vA − vB) = ${q.e.toFixed(2)} · KE lost = ½·mA·mB/(mA+mB)·(1 − e²)·(vA − vB)² = ${energyText(r.lost)}`
  },
  legend: [
    { color: B_FIELD, label: 'Cart A: velocity, momentum, strobe every 0.1 s', shape: 'dot' },
    { color: RING, label: 'Cart B', shape: 'dot' },
    { color: POWER, label: 'Kinetic energy kept', shape: 'dot' },
    { color: HEAT, label: 'Kinetic energy lost to heat, sound, dents', shape: 'dot' },
  ],
  points: [
    `Cart A rolls at ${EI.vA} m/s into cart B. Momentum p = m·v is a vector: right is +, left is −. In the crash each cart pushes the other with the same force for the same time (Newton’s third law, Newton’s laws › F = m a), so whatever A loses B gains: the total before equals the total after, whatever the bumpers are made of.`,
    'Kinetic energy is not protected. The coefficient of restitution e says how fast they part compared with how fast they closed. e = 1 (a steel spring): elastic, every joule comes back; equal masses simply swap speeds. e = 0 (clay, Velcro): they stick and move on together at the shared speed, and the most energy is lost. Real carts sit in between.',
    'Watch the strobe dots: evenly spaced = constant speed (Kinematics), closer = slower. A heavy cart barely notices a light one, a light one bounces off a heavy one. The lost energy is the same (vA − vB)² term that dents chassis and breaks parts: a robot hitting a wall is a collision with an almost infinite mass, which is why it needs a bumper (Bump sensors).',
  ],
  controls: [
    { kind: 'slider', key: 'massA', label: 'Cart A mass', min: CART_KG, max: CART_KG + 1.5, step: 0.5, initial: CART_KG, format: kgText },
    { kind: 'slider', key: 'massB', label: 'Cart B mass', min: CART_KG, max: CART_KG + 1.5, step: 0.5, initial: CART_KG, format: kgText },
    { kind: 'slider', key: 'speedB', label: 'Cart B speed (+ right)', min: -0.5, max: 0.3, step: 0.1, initial: 0, format: mps },
    { kind: 'slider', key: 'restitution', label: 'Restitution e', min: 0, max: 1, step: 0.05, initial: 1, format: (v) => v.toFixed(2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const { k, floor } = EI
    const half = 0.61 * k
    box(scene, [2 * half, 0.3, 3.4], mat('#3a3f4a', { rough: 0.8 }), [0, floor - 0.15, 0])
    for (const s of [-1, 1]) box(scene, [0.3, 1.2, 3.4], mat('#6a6f7a', { rough: 0.6 }), [s * (half + 0.15), floor + 0.6, 0])
    const cars = [sideCar(scene, [0, floor, 0], k), sideCar(scene, [0, floor, 0], k)]
    const colors = [B_FIELD, RING]
    const tags = colors.map((color) => liveLabel(scene, [0, 0, 0.4], { size: 0.3, color }))
    const arrows = colors.map((c) => forceArrow(scene, c, { size: 0.26, min: 0.2 }))
    const top = floor + cars[0].top
    const pen = dotPen(scene, 80, 0.13)
    const [mx, my] = EI.mom
    addLabel(scene, 'momentum before', [mx - 3.5, my + 0.65, 0.2], LABEL, 0.3, 'left')
    addLabel(scene, 'after', [mx - 3.5, my - 1.67, 0.2], LABEL, 0.3, 'left')
    const rows = [{ label: 'A', color: B_FIELD }, { label: 'B', color: RING }, { label: 'total', color: LABEL }]
    const before = sumBars(scene, [mx, my, 0], rows)
    const after = sumBars(scene, [mx, my - 2.3, 0], rows)
    addLabel(scene, 'kinetic energy', [EI.ke[0], EI.ke[1] + 4.6, 0.2], LABEL, 0.3, 'left')
    const ke = lossWaterfall(scene, EI.ke, ['before', 'after'], 8, 3, { keep: POWER, lose: HEAT })
    const clock = lapseClock(3, 1, EI.rest)
    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = eiParams(p)
        const r = eiRun(q)
        const t = clock(dt, eiKey(q))
        const f = fixedStepAt(r.frames, Math.min(t, r.seconds), 0.005)
        const xs = [f.x1, f.x2]
        const vs = [f.v1, f.v2]
        const kgs = [q.mA, q.mB]
        cars.forEach((c, i) => {
          c.group.position.x = xs[i] * k
          c.set(xs[i], kgs[i] - CART_KG)
          tags[i].group.position.set(xs[i] * k, top + 0.6 + Math.ceil((kgs[i] - CART_KG) / 1) * 0.022 * k, 0.4)
          tags[i].set(`${'AB'[i]} ${kgText(kgs[i])}`)
          const y = floor - 0.9
          arrows[i]([xs[i] * k, y, 1], [xs[i] * k + vs[i] * 9, y, 1], mps(vs[i]), [0, -0.5, 0])
        })
        pen.begin()
        for (let s = 0; s <= Math.min(t, r.seconds) + 1e-9; s += EI.strobe) {
          const g = fixedStepAt(r.frames, s, 0.005)
          pen.dot([g.x1 * k, floor + 0.35, 2.2], B_FIELD)
          pen.dot([g.x2 * k, floor + 0.75, 2.2], RING)
        }
        pen.end()
        const hit = t > r.tHit
        const pA = [q.mA * EI.vA, q.mA * r.u1]
        const pB = [q.mB * q.vB, q.mB * r.u2]
        const full = Math.max(1e-9, ...[...pA, ...pB, r.p0].map(Math.abs))
        before.set([pA[0], pB[0], r.p0].map((v) => v / full), false, [pA[0], pB[0], r.p0].map(pText))
        const aft = hit ? [pA[1], pB[1], r.p1] : [0, 0, 0]
        after.set(aft.map((v) => v / full), false, hit ? aft.map(pText) : ['', '', ''])
        ke.set([r.ke0, hit ? r.ke1 : 0], [0, hit ? r.lost : 0], [energyText(r.ke0), hit ? `${energyText(r.ke1)} + ${energyText(r.lost)} lost` : 'not yet'], r.ke0)
        head.status.set(`Collision · ${kind(q.e)} · e ${q.e.toFixed(2)}`, LABEL)
        head.sub.set(`side view · t = ${t.toFixed(1)} s · real time`)
        head.event.set(
          r.tHit === Infinity ? 'B is faster: A never catches up' : hit ? `after: A ${mps(r.u1)}, B ${mps(r.u2)} · total momentum unchanged` : `closing at ${mps(EI.vA - q.vB)}`,
          hit ? (r.lost > 1e-6 ? HEAT : POWER) : LABEL,
        )
      },
      readouts: (p) => {
        const q = eiParams(p)
        const r = eiRun(q)
        const kept = r.ke1 / r.ke0
        return [
          { label: 'Speeds after: A / B', value: `${mps(r.u1)} / ${mps(r.u2)}` },
          { label: 'Total momentum before → after', value: `${pText(r.p0)} → ${pText(r.p1)}`, tone: 'ok' },
          { label: 'Kinetic energy kept', value: `${Math.round(kept * 100)} % (${energyText(r.lost)} lost)`, tone: toneOf(kept > 0.95, kept > 0.6) },
          { label: 'Shared (centre-of-mass) speed', value: mps(r.vcm) },
        ]
      },
    }
  },
}

// --- Bump sensors: a sprung bumper trips a microswitch; the robot must brake before the bumper bottoms out. ---

const BS = { k: 50, floor: -4.6, wall: -1.6, seconds: 0.3, slow: 1 / 15, swK: 0.12, fTop: 40, top: { y: 1.4, h: 4.4 }, bot: { y: -5.8, h: 4.4 }, sTop: 0.04 }
const bsParams = (p: Params) => ({ v0: n(p, 'speed'), k: n(p, 'stiffness'), travel: n(p, 'travel') / 1000, delay: n(p, 'delay') / 1000 })
type BsQ = ReturnType<typeof bsParams>
const bsKey = (q: BsQ) => `${q.v0}|${q.k}|${q.travel}|${q.delay}`
const bsRun = memoBy(bsKey, (q: BsQ) => bumpRun({ v0: q.v0, k: q.k, travel: q.travel, delay: q.delay, seconds: BS.seconds }))
const CONTACT = BUMP_BOT.lead

export const collisionsBumpSensors: Lesson = {
  id: 'collisions-bump-sensors',
  title: 'Bump sensors',
  tagline: 'Touch, trip, brake before the chassis hits',
  formula: (p) => {
    const q = bsParams(p)
    const r = bsRun(q)
    return `brakes alone need trip + v·t_r + v²/2μg = ${mm(brakeOnlyStop(q.v0, q.delay))} · spring alone needs v·√(m/k) = ${mm(q.v0 * Math.sqrt(BUMP_BOT.massKg / q.k))} · both: ${mm(r.squash)} of ${mm(q.travel)} travel · impulse ∫F dt = ${r.impulse.toFixed(2)} N·s`
  },
  legend: [
    { color: B_FIELD, label: `Bumper squash (top, 0…${BS.sTop * 1000} mm)`, shape: 'dot' },
    { color: HIGH_V, label: 'Travel: past this the chassis hits', shape: 'dot' },
    { color: RING, label: `Switch trips (${BUMP_BOT.trip * 1000} mm); brakes on after the delay`, shape: 'dot' },
    { color: HEAT, label: `Force on the robot (bottom, 0…${BS.fTop} N)`, shape: 'arrow-right' },
  ],
  points: [
    `A bump sensor is a lever microswitch behind a sprung bumper plate (Switches & buttons, Linear actuators › Limit switches). The plate touches first; after ${BUMP_BOT.trip * 1000} mm the lever snaps the contact from NC to NO and the code sees it. It then takes a reaction delay (debouncing, the loop period, Software › Safety & failsafes) before the motors brake, and the wheels can only brake at μ·g ≈ ${(BUMP_BOT.mu * G).toFixed(1)} m/s² (Friction & traction › Static vs kinetic).`,
    'Meanwhile the robot keeps moving and squashes the bumper. Stopping takes trip + v·t_r + v²/2μg of travel on the brakes alone; the bumper spring helps by pushing back with k·x. Double the speed and the braking part grows four times. If the squash reaches the travel, the chassis hits the wall: a stiff steel-on-wall contact, a sharp force spike many times the bumper force.',
    'The impulse ∫F dt equals the change in momentum (Newton’s laws › F = m a): the same either way, so the trick is to spread it over a longer time with a softer, longer bumper. A stiff bumper stops sooner but bounces the robot back (Elastic and inelastic, Oscillations › Damping). Better still, never touch: rangefinders and Navigation › Obstacle avoidance slow down before contact; the bumper is the last line.',
  ],
  controls: [
    { kind: 'slider', key: 'speed', label: 'Speed into the wall', min: 0.2, max: 1.2, step: 0.1, initial: 0.6, format: (v) => `${v.toFixed(1)} m/s` },
    { kind: 'slider', key: 'stiffness', label: 'Bumper spring k', min: 100, max: 3000, step: 100, initial: 600, format: (v) => `${v} N/m` },
    { kind: 'slider', key: 'travel', label: 'Bumper travel', min: 5, max: 30, step: 1, initial: 20, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'delay', label: 'Reaction delay t_r', min: 0, max: 100, step: 5, initial: 20, format: (v) => `${v} ms` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const { k, floor, wall } = BS
    box(scene, [16, 0.3, 4], mat('#3a3f4a', { rough: 0.8 }), [wall - 8, floor - 0.15, 0])
    box(scene, [1, 7.4, 4], mat('#8a8f99', { rough: 0.85 }), [wall + 0.5, floor + 3.7 - 0.3, 0])
    addLabel(scene, 'wall', [wall + 0.5, floor + 7.6, 0.3], GREY, 0.3)
    const car = sideCar(scene, [0, floor, 0], k)
    const plateM = glowMat('#c8ccd4', 0.15)
    const plate = box(scene, [0.25, 2.6, 5], plateM, [0, floor + 3, 0])
    const springs = [floor + 2.4, floor + 3.6].map((y) => ({ y, draw: coilSpring(scene, 0.3, 7, 0.05) }))
    const [, reachY] = microSwitchReach(BS.swK)
    const sw = microSwitch(scene, [0, 0, 0], BS.swK)
    sw.group.rotation.z = -Math.PI / 2
    const push = forceArrow(scene, HEAT, { size: 0.28 })
    const { x, w } = SIDE_SCOPE
    const { y: ty, h: th } = BS.top
    const { y: by, h: bh } = BS.bot
    const sPlot = plotPanel(scene, [x, ty, 0], w, th, BS.seconds, 'bumper squash', '', 0, 6)
    const fPlot = plotPanel(scene, [x, by, 0], w, bh, BS.seconds, 'force on the robot', '', 0, 6)
    const travelTr = sPlot.trace(HIGH_V, { samples: 2, radius: 0.04 })
    const tripTr = sPlot.trace(RING, { samples: 2, radius: 0.03 })
    const brakeTr = sPlot.trace(POWER, { samples: 2, radius: 0.03 })
    const sTr = sPlot.trace(B_FIELD, { samples: 300, radius: 0.06 })
    const fTr = fPlot.trace(HEAT, { samples: 300, radius: 0.06 })
    const brakeTag = liveLabel(scene, [0, ty + th / 2 - 0.4, 0.3], { size: 0.24, color: POWER, align: 'left' })
    const peakTag = liveLabel(scene, [x + w / 2 - 0.2, by + bh / 2 - 0.45, 0.3], { size: 0.26, color: HEAT, align: 'right' })
    const clock = lapseClock(BS.seconds, BS.slow, 0.06)
    const yS = (s: number) => -th / 2 + (Math.min(1.02, Math.max(0, s) / BS.sTop)) * th
    const yF = (f: number) => -bh / 2 + Math.min(1.02, f / BS.fTop) * bh
    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = bsParams(p)
        const r = bsRun(q)
        const t = clock(dt, bsKey(q))
        const f = fixedStepAt(r.frames, t, r.dt)
        const s = Math.max(0, f.x)
        const face = wall - Math.max(0, -f.x) * k
        plate.position.x = face - 0.125
        const front = wall + (f.x - q.travel) * k - 0.25
        car.group.position.x = front - 0.1 * k
        car.set(f.x, 0)
        for (const sp of springs) sp.draw([front, sp.y, 0], [face - 0.25, sp.y, 0])
        sw.group.position.set(front + 0.25 + q.travel * k - reachY, floor + 3, 3.8)
        sw.set(Math.min(1, (s * 1000) / 3.3), s >= BUMP_BOT.trip ? 'no' : 'nc')
        setGlow(plateM, f.f > 0 ? HEAT : '#c8ccd4', 0.15 + 0.8 * Math.min(1, f.f / BS.fTop))
        push([face - 0.5, floor + 5.2, 2.5], [face - 0.5 - Math.min(9, f.f * 0.25), floor + 5.2, 2.5], `${f.f.toFixed(1)} N`, [0, 0.45, 0])
        travelTr.points([0, 1], [yS(q.travel), yS(q.travel)])
        tripTr.points([0, 1], [yS(BUMP_BOT.trip), yS(BUMP_BOT.trip)])
        const ub = r.tBrake / BS.seconds
        brakeTr.group.visible = brakeTag.group.visible = ub < 1 && t >= r.tBrake
        brakeTr.points([ub, ub], [-th / 2, th / 2])
        brakeTag.group.position.x = x - w / 2 + ub * w + 0.15
        brakeTag.set('brakes on')
        traceRun(sTr, r.frames, r.dt, BS.seconds, t, (g) => yS(g.x), 300)
        traceRun(fTr, r.frames, r.dt, BS.seconds, t, (g) => yF(g.f), 300)
        peakTag.set(r.peak > BS.fTop && t > r.tHard ? `spike ${r.peak.toFixed(0)} N, off scale` : '')
        const hitNow = t >= r.tHard
        head.status.set(`Bump sensor · ${q.v0.toFixed(1)} m/s · k ${q.k} N/m · ${q.travel * 1000} mm travel`, LABEL)
        head.sub.set(`side view · t = ${ms(t)} of ${ms(BS.seconds)} · 1/15× slow motion`)
        head.event.set(
          hitNow ? `chassis hit the wall at ${mps(r.vHard)}` : t < CONTACT ? 'driving at the wall' : t < r.tTrip ? 'bumper touching, switch not yet tripped' : t < r.tBrake ? 'switch tripped, code reacting…' : f.v > 0 ? 'braking' : r.hit ? 'chassis hit' : 'stopped before the chassis touched',
          hitNow ? HIGH_V : t >= r.tBrake ? POWER : t >= r.tTrip ? RING : LABEL,
        )
      },
      readouts: (p) => {
        const q = bsParams(p)
        const r = bsRun(q)
        return [
          { label: 'Switch trips / brakes on after touch', value: `${ms(r.tTrip - CONTACT)} / ${ms(r.tBrake - CONTACT)}` },
          { label: 'Squash used of travel', value: r.hit ? `bottomed out at ${mps(r.vHard)}` : `${mm(r.squash)} of ${mm(q.travel)}`, tone: toneOf(!r.hit && r.squash < 0.8 * q.travel, !r.hit) },
          { label: 'Peak force on the robot', value: `${r.peak.toFixed(1)} N (${(r.peak / (BUMP_BOT.massKg * G)).toFixed(1)} g)`, tone: toneOf(r.peak < 20, r.peak < 60) },
          { label: 'Brakes alone would need', value: mm(brakeOnlyStop(q.v0, q.delay)) },
        ]
      },
    }
  },
}
