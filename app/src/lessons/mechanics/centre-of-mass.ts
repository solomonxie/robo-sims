import * as THREE from 'three/webgpu'
import { BATT_H, DEG, G, TIP_DESIGNS, TipDesign, designCom, fixedStepAt, massCentre, plumbHit, rotate2, tableTipRun, tipAccels, tipLimits, toDeg } from '../../core/physics'
import { cmText, degText } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, SIDE_VIEW, addLabel, comMarker, countBars, dotPen, ease, forceArrow, glowMat, lapseClock, liveLabel, memoBy, plotPanel, setGlow, statusHeader } from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const deg = (rad: number) => degText(toDeg(rad), 0)
const accel = (a: number) => `${a < -0.005 ? '−' : ''}${Math.abs(a).toFixed(1)} m/s²`
const footColor = (ok: boolean) => (ok ? POWER : HIGH_V)

/** Box robot, metres, origin on the floor at the left wheel contact: round (side-on) or flat (end-on) wheels, body, a load block, optional mast. */
function blockBot(parent: THREE.Object3D, k: number, wheelR: number, round: boolean) {
  const g = add(parent, new THREE.Group())
  g.scale.setScalar(k)
  const tyre = mat('#1c1c1f', { rough: 0.8 })
  const wheels = [0, 1].map(() => (round ? cylinder(g, wheelR, 0.02, tyre, [0, wheelR, 0.055], 'z', 28) : box(g, [0.024, 2 * wheelR, 0.03], tyre, [0, wheelR, 0.05])))
  const body = box(g, [1, 1, 1], mat('#d8dbe2', { rough: 0.5 }))
  const load = box(g, [1, 1, 1], mat('#b8923a', { metal: 0.4, rough: 0.4 }))
  const mastM = mat('#8a8f99', { metal: 0.5, rough: 0.4 })
  const mast = box(g, [1, 1, 1], mastM)
  const arm = box(g, [1, 1, 1], mastM)
  const com = comMarker(g, 0.016)
  const place = (m: THREE.Mesh, cx: number, cz: number, w: number, h: number, d: number, z = 0) => {
    m.position.set(cx, cz, z)
    m.scale.set(Math.max(1e-4, w), Math.max(1e-4, h), d)
  }
  return {
    g,
    /** Contacts at 0 and `span`; body x0…x1 from `clear` up `bodyH`; load box `size` at (lx, lz), on a mast when `onMast`; CoM marker at `c`. */
    set(span: number, [x0, x1]: [number, number], clear: number, bodyH: number, [lx, lz]: [number, number], size: [number, number], onMast: boolean, c: { x: number; z: number }) {
      wheels[1].position.x = span
      place(body, (x0 + x1) / 2, clear + bodyH / 2, x1 - x0, bodyH, 0.09)
      place(load, lx, lz, size[0], size[1], 0.06, 0.012)
      const top = clear + bodyH
      const mx = (x0 + x1) / 2
      mast.visible = arm.visible = onMast
      place(mast, mx, (top + lz) / 2, 0.008, lz - top, 0.008)
      place(arm, (mx + lx) / 2, lz, Math.abs(lx - mx), 0.008, 0.008)
      com.position.set(c.x, c.z, 0.075)
    },
  }
}

// --- Tipping angle: a robot on a tilting table tips once the plumb line from its CoM leaves the wheel footprint. ---

const TA = { k: 23, hinge: [-16, -8.3, 0] as V3, d0: 9, len: 17, rate: 10 * DEG, seconds: 8, gyr: 0.06, wheelR: 0.033, clear: 0.015, bodyH: 0.06, bodyKg: 1, loadKg: 0.5, load: 0.05, plot: { x: 7.4, y: -1.6, w: 10, h: 6.4 } }
const taParams = (p: Params) => ({ tilt: n(p, 'tilt') * DEG, height: n(p, 'height') / 100, offset: n(p, 'offset') / 100, track: n(p, 'track') / 100 })
type TaQ = ReturnType<typeof taParams>
const taKey = (q: TaQ) => `${q.tilt}|${q.height}|${q.offset}|${q.track}`
const taCom = (q: TaQ) =>
  massCentre([
    { kg: TA.bodyKg, x: 0, z: TA.clear + TA.bodyH / 2 },
    { kg: TA.loadKg, x: q.offset, z: q.height },
  ])
const taRun = memoBy(taKey, (q: TaQ) => {
  const c = taCom(q)
  const half = q.track / 2
  return { c, half, run: tableTipRun({ x: c.x, h: c.z, rear: -half, tilt: q.tilt, ramp: q.tilt / TA.rate, seconds: TA.seconds, gyr: TA.gyr }) }
})

export const centreOfMassTippingAngle: Lesson = {
  id: 'centre-of-mass-tipping-angle',
  title: 'Tipping angle',
  tagline: 'Tips when the plumb line leaves the wheels',
  formula: (p) => {
    const q = taParams(p)
    const { c, half } = taRun(q)
    return `CoM = Σ mᵢ·rᵢ / Σ mᵢ · h = ${cmText(c.z)}, ${cmText(c.x)} uphill · tips when tan θ > (w/2 + x)/h = (${cmText(half)} + ${cmText(c.x)}) / ${cmText(c.z)} → θ_tip = ${deg(tipLimits(c.x, c.z, -half, half).back)}`
  },
  legend: [
    { color: LABEL, label: 'Centre of mass (chequered disk)', shape: 'dot' },
    { color: POWER, label: 'Wheel footprint: plumb line inside = stable', shape: 'dot' },
    { color: HIGH_V, label: 'Plumb line outside the downhill wheel: tips', shape: 'dot' },
    { color: B_FIELD, label: 'Table tilt θ (plot); robot lean in orange', shape: 'dot' },
  ],
  points: [
    'Every part of a robot pulls down with its own weight; together they act as one force at the centre of mass (CoM), the mass-weighted average position Σ m·r / Σ m. A heavy payload high on a mast drags the CoM up and towards it; the chassis and battery hold it low.',
    'Tilt the table. Gravity still points straight down, so follow the plumb line from the CoM to the table. While it lands between the wheel contacts, gravity’s torque about the downhill wheel pulls the robot back onto both wheels. Once it passes the downhill contact, the same torque turns it over: tan θ_tip = (w/2 + x) / h for track w, CoM height h and offset x uphill.',
    'So halve the CoM height or double the track and the tip angle climbs. This is Torque & levers › Static balance seen from the wheels: the weight’s moment arm about the edge changes sign. Tracked robots climbing slopes hit the same limit nose-up (Mobility › Tracks & terrain); a self-balancing robot lives permanently past it (Mobility › Balancing robots).',
  ],
  controls: [
    { kind: 'slider', key: 'tilt', label: 'Table tilt', min: 5, max: 50, step: 5, initial: 40, format: (v) => `${v}°` },
    { kind: 'slider', key: 'height', label: 'Payload height', min: 10, max: 30, step: 1, initial: 25, format: (v) => `${v} cm` },
    { kind: 'slider', key: 'offset', label: 'Payload offset (+ uphill)', min: -6, max: 6, step: 1, initial: 0, format: (v) => `${v > 0 ? '+' : ''}${v} cm` },
    { kind: 'slider', key: 'track', label: 'Track width w', min: 10, max: 30, step: 2, initial: 16, format: (v) => `${v} cm` },
  ],
  build(): Stage {
    const stage = createStage({ span: 40 })
    const head = statusHeader(stage)
    const { k, hinge, d0, len } = TA
    const table = add(stage, new THREE.Group(), hinge)
    box(table, [len, 0.35, 3.6], mat('#5a4a3a', { rough: 0.8 }), [len / 2, -0.175, 0])
    box(stage, [len * 0.9, 0.3, 3.6], mat('#3a3f4a', { rough: 0.8 }), [hinge[0] + len * 0.45, hinge[1] - 0.6, 0])
    const footM = glowMat(POWER, 0.8)
    const foot = box(table, [1, 0.08, 3.7], footM, [0, 0.02, 0])
    const pivot = add(table, new THREE.Group(), [d0, 0, 0])
    const bot = blockBot(pivot, k, TA.wheelR, false)
    const pen = dotPen(stage, 160, 0.09)
    const tipTag = liveLabel(stage, [0, 0, 0.5], { size: 0.3, align: 'right' })
    const tiltTag = liveLabel(stage, [0, 0, 0.5], { size: 0.32, color: B_FIELD, align: 'left' })
    const { x: px, y: py, w: pw, h: ph } = TA.plot
    const plot = plotPanel(stage, [px, py, 0], pw, ph, TA.seconds, 'table tilt θ and robot lean', '0…150°', 0, 8)
    const limTr = plot.trace(HIGH_V, { samples: 2, radius: 0.04 })
    const leanTr = plot.trace(HEAT, { samples: 200, radius: 0.06 })
    const tiltTr = plot.trace(B_FIELD, { samples: 200, radius: 0.06 })
    const limTag = liveLabel(stage, [px - pw / 2 + 0.2, 0, 0.3], { size: 0.24, color: HIGH_V, align: 'left' })
    const yDeg = (a: number) => -ph / 2 + Math.min(1, toDeg(a) / 150) * ph
    const clock = lapseClock(TA.seconds, 1, 1.5)
    return {
      scene: stage,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = taParams(p)
        const { c, half, run } = taRun(q)
        const t = clock(dt, taKey(q))
        const f = fixedStepAt(run.frames, t, run.dt)
        table.rotation.z = f.tilt
        pivot.rotation.z = f.roll
        const w = 2 * half
        const lx = half + q.offset
        bot.set(w, [0.012, w - 0.012], TA.clear, TA.bodyH, [lx, q.height], [TA.load, TA.load], true, { x: half + c.x, z: c.z })
        const [ox, oy] = rotate2(f.tilt, rotate2(f.roll, [(half + c.x) * k, c.z * k]))
        const cw: [number, number] = [hinge[0] + rotate2(f.tilt, [d0, 0])[0] + ox, hinge[1] + rotate2(f.tilt, [d0, 0])[1] + oy]
        const along = (cw[0] - hinge[0]) / Math.cos(f.tilt)
        const hitY = hinge[1] + (cw[0] - hinge[0]) * Math.tan(f.tilt)
        const inside = f.roll === 0 && along >= d0 - 0.01 && along <= d0 + w * k + 0.01
        foot.position.x = d0 + (w * k) / 2
        foot.scale.x = w * k
        foot.visible = f.roll === 0
        setGlow(footM, footColor(inside), 0.8)
        pen.begin()
        pen.line([cw[0], cw[1], 1.6], [cw[0], hitY, 1.6], 0.35, footColor(inside))
        pen.dot([cw[0], hitY, 1.9], footColor(inside), 2.2)
        const edge = rotate2(f.tilt, [d0, 0])
        pen.line([hinge[0] + edge[0], hinge[1] + edge[1], 1.6], [cw[0], cw[1], 1.6], 0.3, GREY, 0.6)
        for (let i = 0; i <= 14; i++) pen.dot([hinge[0] + 3.2 * Math.cos((f.tilt * i) / 14), hinge[1] + 3.2 * Math.sin((f.tilt * i) / 14), 1], B_FIELD, 0.8)
        pen.end()
        tiltTag.group.position.set(hinge[0] + 3.5, hinge[1] + 0.5 + 1.2 * Math.sin(f.tilt), 0.5)
        tiltTag.set(`θ ${deg(f.tilt)}`)
        tipTag.group.position.set(hinge[0] + edge[0] - 0.4, hinge[1] + edge[1] - 0.2, 0.5)
        tipTag.set('pivot', GREY)
        limTr.points([0, 1], [yDeg(run.beta), yDeg(run.beta)])
        limTag.group.position.y = py + yDeg(run.beta) + 0.35
        limTag.set(`tips at ${deg(run.beta)}`)
        const cnt = Math.max(2, Math.round((t / TA.seconds) * 199) + 1)
        const us = Array.from({ length: cnt }, (_, i) => i / 199)
        const fs = us.map((u) => fixedStepAt(run.frames, u * TA.seconds, run.dt))
        tiltTr.points(us, fs.map((g) => yDeg(g.tilt)))
        leanTr.points(us, fs.map((g) => yDeg(g.tilt + g.roll)))
        const tipped = t >= run.tipAt
        head.status.set(`Tilting table · CoM ${cmText(c.z)} high · track ${cmText(w)}`, LABEL)
        head.sub.set(`end-on view · table at ${deg(TA.rate)}/s · t = ${t.toFixed(1)} s · real time`)
        head.event.set(
          tipped ? (f.roll >= Math.PI / 2 - 1e-3 ? 'tipped over onto its side' : `plumb line passed the downhill wheel at ${deg(run.beta)}: tipping`) : q.tilt > run.beta ? 'tilting… plumb line moving towards the downhill wheel' : `stable: tip angle ${deg(run.beta)} is beyond the ${deg(q.tilt)} table`,
          tipped ? HIGH_V : POWER,
        )
      },
      readouts: (p) => {
        const q = taParams(p)
        const { c, half, run } = taRun(q)
        const lim = tipLimits(c.x, c.z, -half, half)
        return [
          { label: 'CoM height / offset', value: `${cmText(c.z)} / ${cmText(c.x)}` },
          { label: 'Tip angle (this way / other way)', value: `${deg(lim.back)} / ${deg(lim.forward)}`, tone: toneOf(lim.back > 40 * DEG, lim.back > 25 * DEG) },
          { label: 'Table tilt', value: `${deg(q.tilt)}${q.tilt > run.beta ? ' · tips' : ''}`, tone: q.tilt > run.beta ? 'bad' : 'ok' },
          { label: 'Without the payload', value: `tips at ${deg(Math.atan2(half, TA.clear + TA.bodyH / 2))}` },
        ]
      },
    }
  },
}

// --- Low and wide: two chassis on the same slope, braking or accelerating; the inertial force tilts the effective gravity. ---

const LW = { k: 25, gk: 0.34, y: -2.4, xs: { tall: -12.4, wide: -3.4 } as Record<TipDesign, number>, board: 8, wheelR: 0.03, bars: [7.4, 2.4, 0] as V3, mu: 0.9 }
const BATTERY = { low: 'Battery on the floor plate', high: 'Battery on the roof' }
const lwParams = (p: Params) => ({ slope: n(p, 'slope') * DEG, a: n(p, 'accel'), high: pick(BATTERY, p.battery, 'low') === 'high' })
type LwQ = ReturnType<typeof lwParams>
const lwState = memoBy(
  (q: LwQ) => `${q.slope}|${q.a}|${q.high}`,
  (q: LwQ) => {
    const out = {} as Record<TipDesign, { c: { x: number; z: number }; half: number; hit: number; lim: { back: number; forward: number }; acc: { wheelie: number; nose: number }; tips: 0 | 1 | -1 }>
    for (const d of Object.keys(TIP_DESIGNS) as TipDesign[]) {
      const c = designCom(d, q.high)
      const half = TIP_DESIGNS[d].wheelbase / 2
      const hit = plumbHit(c.x, c.z, q.slope, q.a)
      out[d] = { c, half, hit, lim: tipLimits(c.x, c.z, -half, half), acc: tipAccels(c.x, c.z, -half, half, q.slope), tips: hit > half ? 1 : hit < -half ? -1 : 0 }
    }
    return out
  },
)

export const centreOfMassLowAndWide: Lesson = {
  id: 'centre-of-mass-low-and-wide',
  title: 'Low and wide',
  tagline: 'Low CoM, long wheelbase, nothing tips',
  formula: (p) => {
    const q = lwParams(p)
    const s = lwState(q)
    return `g_eff = g − a · lands at x − h·(g sin θ + a)/(g cos θ) · nose-over when braking harder than g·(L/2)/h: tall ${accel(-s.tall.acc.nose)}, low ${accel(-s.wide.acc.nose)} · wheelie past tall ${accel(s.tall.acc.wheelie)}, low ${accel(s.wide.acc.wheelie)}`
  },
  legend: [
    { color: GREY, label: 'Weight m·g', shape: 'arrow-right' },
    { color: B_FIELD, label: 'Inertial force −m·a (braking pushes it forward)', shape: 'arrow-right' },
    { color: RING, label: 'Effective gravity: where it meets the floor', shape: 'arrow-right' },
    { color: POWER, label: 'Footprint between the wheels (red: tips)', shape: 'dot' },
  ],
  points: [
    'Two robots with the same mass and battery: one tall with a short wheelbase, one low with a long one. On a slope the plumb line from the CoM moves h·tan θ downhill; the low, wide one has more footprint to spend and less height to spend it with, so it tips far later (Tipping angle).',
    'Speeding up or braking adds an inertial force −m·a at the CoM: braking throws it forward, accelerating backward. Add it to the weight and you get an effective gravity tilted by atan(a/g): the robot behaves as if standing on a slope that steep. Brake harder than g·(L/2)/h and the rear wheels lift and it noses over; launch harder than that and it wheelies. The same shift loads one axle and unloads the other (Friction & traction › Wheel slip; Newton’s laws › F = m a).',
    `Move the battery to the roof and both get worse. Heavy parts low, wheels spread wide, and accelerate gently: a ramped speed profile caps a (Control › Position control). On grippy floors (μ ≈ ${LW.mu}) only a robot with g·(L/2)/h below μ·g can nose over before its wheels skid.`,
  ],
  controls: [
    { kind: 'slider', key: 'slope', label: 'Slope (+ nose up)', min: -30, max: 30, step: 5, initial: -10, format: (v) => `${v}°` },
    { kind: 'slider', key: 'accel', label: 'Acceleration (− braking)', min: -8, max: 8, step: 0.5, initial: -4, format: accel },
    { kind: 'choice', key: 'battery', options: opts(BATTERY), initial: 'high' },
  ],
  build(): Stage {
    const stage = createStage({ span: 40 })
    const head = statusHeader(stage)
    const { k, gk, y } = LW
    const designs = Object.keys(TIP_DESIGNS) as TipDesign[]
    const rigs = designs.map((d) => {
      const s = TIP_DESIGNS[d]
      const slope = add(stage, new THREE.Group(), [LW.xs[d], y, 0])
      box(slope, [LW.board, 0.3, 3.4], mat('#3a3f4a', { rough: 0.8 }), [0, -0.15, 0])
      const footM = glowMat(POWER, 0.8)
      box(slope, [s.wheelbase * k, 0.08, 3.5], footM, [0, 0.02, 0])
      const pivot = add(slope, new THREE.Group())
      const bot = blockBot(pivot, k, LW.wheelR, true)
      addLabel(stage, s.name, [LW.xs[d], y - 5, 0.3], LABEL, 0.32)
      const tag = liveLabel(stage, [LW.xs[d], y - 5.8, 0.3], { size: 0.3 })
      const arrows = { w: forceArrow(stage, GREY, { size: 0.24 }), i: forceArrow(stage, B_FIELD, { size: 0.24 }), r: forceArrow(stage, RING, { size: 0.26 }) }
      return { d, s, slope, footM, pivot, bot, arrows, tag, lift: 0, edge: 1 }
    })
    const pen = dotPen(stage, 160, 0.09)
    addLabel(stage, 'tipping limits', [LW.bars[0] - 3.4, LW.bars[1] + 0.9, 0.3], LABEL, 0.3, 'left')
    const bars = countBars(stage, LW.bars, ['tall · slope', 'low · slope', 'tall · brake', 'low · brake', 'tall · launch', 'low · launch'], 4, { size: 0.26 })
    return {
      scene: stage,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = lwParams(p)
        const st = lwState(q)
        pen.begin()
        for (const r of rigs) {
          const s = st[r.d]
          const L = r.s.wheelbase
          if (s.tips) r.edge = s.tips
          const edge = r.edge * s.half
          r.lift += (Math.abs(s.tips) * 18 * DEG - r.lift) * ease(dt, 4)
          const turn = -r.edge * r.lift
          r.slope.rotation.z = q.slope
          r.pivot.position.x = edge * k
          r.pivot.rotation.z = turn
          r.bot.g.position.x = (-s.half - edge) * k
          const battZ = q.high ? r.s.clear + r.s.bodyH + BATT_H / 2 : r.s.clear + BATT_H / 2 + 0.005
          r.bot.set(L, [-0.02, L + 0.02], r.s.clear, r.s.bodyH, [L / 2, battZ], [0.09, BATT_H], false, { x: L / 2 + s.c.x, z: s.c.z })
          setGlow(r.footM, footColor(!s.tips), 0.8)
          const toWorld = (bx: number, bz: number): V3 => {
            const [lx, lz] = rotate2(turn, [bx - edge, bz])
            const [wx, wy] = rotate2(q.slope, [(lx + edge) * k, lz * k])
            return [LW.xs[r.d] + wx, y + wy, 2.2]
          }
          const c = toWorld(s.c.x, s.c.z)
          const ia: V3 = [-q.a * gk * Math.cos(q.slope), -q.a * gk * Math.sin(q.slope), 0]
          const wEnd: V3 = [c[0], c[1] - G * gk, c[2]]
          r.arrows.w(c, wEnd, 'g', [-0.6, 0.4, 0])
          r.arrows.i(wEnd, [wEnd[0] + ia[0], wEnd[1] + ia[1], c[2]], '−a', [0, 0.3, 0])
          r.arrows.r(c, [c[0] + ia[0], wEnd[1] + ia[1], c[2] + 0.1], 'g_eff', [0.6, -0.1, 0])
          const hit = toWorld(s.hit, 0)
          pen.line(c, hit, 0.3, footColor(!s.tips), 0.8)
          pen.dot([hit[0], hit[1], 2.4], footColor(!s.tips), 2.2)
          r.tag.set(s.tips ? (s.tips > 0 ? 'noses over the front wheels' : 'wheelies over the rear wheels') : 'stays on its wheels', s.tips ? HIGH_V : POWER)
        }
        pen.end()
        const sl = Math.abs(q.slope)
        const vals = designs.map((d) => st[d].lim.back)
        const brake = designs.map((d) => Math.max(0, -st[d].acc.nose))
        const launch = designs.map((d) => Math.max(0, st[d].acc.wheelie))
        bars.set(
          [...vals.map((v) => v / (60 * DEG)), ...brake.map((v) => v / 16), ...launch.map((v) => v / 16)],
          [...vals.map(deg), ...brake.map(accel), ...launch.map(accel)],
          [...vals.map((v) => footColor(sl <= v)), ...brake.map((v) => footColor(-q.a <= v)), ...launch.map((v) => footColor(q.a <= v))],
          1,
        )
        head.status.set(`Slope ${deg(q.slope)} · ${q.a < 0 ? `braking ${accel(-q.a)}` : q.a > 0 ? `accelerating ${accel(q.a)}` : 'coasting'}`, LABEL)
        head.sub.set(`side view · noses face right · ${BATTERY[q.high ? 'high' : 'low'].toLowerCase()}`)
        head.event.set(`effective gravity leans ${deg(Math.abs(Math.atan2(G * Math.sin(q.slope) + q.a, G * Math.cos(q.slope))))} from the robots’ vertical`, RING)
      },
      readouts: (p) => {
        const q = lwParams(p)
        const s = lwState(q)
        const row = (d: TipDesign) => ({ label: `${d === 'tall' ? 'Tall' : 'Low'}: CoM h / tip slope`, value: `${cmText(s[d].c.z)} / ${deg(s[d].lim.back)}`, tone: s[d].tips ? ('bad' as const) : ('ok' as const) })
        return [
          row('tall'),
          row('wide'),
          { label: 'Level-floor stop: tall / low', value: `${accel(-tipAccels(s.tall.c.x, s.tall.c.z, -s.tall.half, s.tall.half, 0).nose)} / ${accel(-tipAccels(s.wide.c.x, s.wide.c.z, -s.wide.half, s.wide.half, 0).nose)}` },
          { label: `Skid limit μ·g (μ ${LW.mu})`, value: accel(LW.mu * G) },
        ]
      },
    }
  },
}
