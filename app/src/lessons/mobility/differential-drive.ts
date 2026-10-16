import * as THREE from 'three/webgpu'
import {
  FLOORS,
  FloorKind,
  Pose,
  SLIP,
  SlipMove,
  TT_TRACK_M,
  UMB,
  diffForward,
  diffStep,
  gripAccel,
  iccOf,
  slipRun,
  squareError,
  squareRun,
  toDeg,
  toRoom,
  turnRadius,
} from '../../core/physics'
import { mmText } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  addRod,
  cursorBar,
  diffBot,
  flatBox,
  floorMat,
  floorView,
  glowMat,
  liveLabel,
  memoBy,
  pointCloud,
  scope,
  simClock,
  stretchArrow,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const HALF = TT_TRACK_M / 2
const lenText = (m: number) => (Math.abs(m) < 1 ? mmText(m) : `${m.toFixed(2)} m`)
const inside = (x: number, y: number, fx: [number, number], fy: [number, number]) => x >= fx[0] && x <= fx[1] && y >= fy[0] && y <= fy[1]
const errTone = (m: number) => (m < 0.01 ? 'ok' : m < 0.05 ? 'warn' : 'bad')

// --- Turn radius: two wheel speeds → v, ω and a centre of turning on the floor. ---

const TURN = { at: [-7, -1.6, 0] as V3, k: 22, fx: [-0.5, 0.5] as [number, number], fy: [-0.35, 0.35] as [number, number], px: 12.4, py: -0.8, wPx: 1.6, vPx: 8, span: 3.6, ring: 160, trail: 260 }
const turnParams = (p: Params) => {
  const vL = n(p, 'vl')
  const vR = n(p, 'vr')
  return { vL, vR, ...diffForward(vL, vR, TT_TRACK_M), R: turnRadius(vL, vR, TT_TRACK_M) }
}
type TurnQ = ReturnType<typeof turnParams>
const isSpin = (q: TurnQ) => q.R === 0 && q.vR !== 0
const turnWord = (q: TurnQ) => {
  if (q.vL === 0 && q.vR === 0) return 'stopped'
  if (!Number.isFinite(q.R)) return q.v > 0 ? 'straight ahead: ICC at infinity' : 'straight back: ICC at infinity'
  if (isSpin(q)) return `spinning in place ${q.w > 0 ? 'left' : 'right'}: ICC at the centre`
  return `turning ${q.w > 0 ? 'left' : 'right'}${q.v < 0 ? ' (reversing)' : ''} about the ICC, R = ${lenText(Math.abs(q.R))}`
}
function turnStart(q: TurnQ): Pose {
  if (!Number.isFinite(q.R)) return { x: q.v >= 0 ? -0.42 : 0.42, y: 0, th: 0 }
  if (Math.abs(q.R) <= 0.27) return { x: 0, y: -q.R, th: 0 }
  return { x: q.v >= 0 ? -0.42 : 0.42, y: -Math.sign(q.R * q.v) * 0.27, th: 0 }
}

export const turnRadiusLesson: Lesson = {
  id: 'differential-drive-turn-radius',
  title: 'Turn radius',
  tagline: 'Two wheel speeds make every turn',
  formula: (p) => {
    const q = turnParams(p)
    const R = Number.isFinite(q.R) ? `${q.R.toFixed(3)} m` : '∞'
    return `v = (vR + vL)/2 = ${q.v.toFixed(2)} m/s · ω = (vR − vL)/b = ${q.w.toFixed(2)} rad/s · R = v/ω = (b/2)(vR + vL)/(vR − vL) = ${R}`
  },
  legend: [
    { color: HEAT, label: 'Left wheel speed and path', shape: 'dot' },
    { color: B_FIELD, label: 'Right wheel speed and path', shape: 'dot' },
    { color: POWER, label: 'Body speed v (centre of the axle)', shape: 'dot' },
    { color: RING, label: 'ICC: the point it turns about', shape: 'dot' },
  ],
  points: [
    'A differential-drive robot has no steering: two driven wheels on one axle (plus a caster) and the speed difference does the turning. Body speed is the average, v = (vR + vL)/2; turn rate is the difference over the track width b, ω = (vR − vL)/b.',
    'Every instant the robot rotates about one point on the axle line, the instantaneous centre of curvature (ICC). Its distance from the centre is R = v/ω = (b/2)(vR + vL)/(vR − vL). Each wheel rides its own circle, R − b/2 and R + b/2.',
    'Special cases: equal speeds → R = ∞, a straight line. One wheel stopped → R = b/2, it pivots about that tyre. Equal and opposite → R = 0: spin in place about the axle centre, something a car can\'t do.',
    'Run it backwards: for a wanted v and ω the wheels need vL = v − ωb/2 and vR = v + ωb/2. That\'s what a joystick mixer does (see Joystick over BLE); mismatched motors bend a "straight" line into a big circle (see Speed from ticks).',
  ],
  controls: [
    { kind: 'slider', key: 'vl', label: 'Left wheel', min: -0.4, max: 0.4, step: 0.02, initial: 0.1, format: (v) => `${v.toFixed(2)} m/s` },
    { kind: 'slider', key: 'vr', label: 'Right wheel', min: -0.4, max: 0.4, step: 0.02, initial: 0.24, format: (v) => `${v.toFixed(2)} m/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-18, 7.2, 0.3], { size: 0.46, align: 'left' })
    addLabel(scene, '130 mm track, 65 mm wheels · real time', [-18, 6.2, 0.3], GREY, 0.32, 'left')

    const g = floorView(scene, TURN.at, TURN.k, -0.55)
    floorMat(g, TURN.fx, TURN.fy)
    const rings = pointCloud(g, TURN.ring * 3, 0.005)
    const trail = pointCloud(g, TURN.trail, 0.006)
    const bot = diffBot(g)
    const arrows = [stretchArrow(bot.group, HEAT, 0.004), stretchArrow(bot.group, B_FIELD, 0.004), stretchArrow(bot.group, POWER, 0.005)]
    const icc = add(g, new THREE.Group())
    cylinder(icc, 0.02, 0.004, glowMat(RING, 1.2), [0, 0, 0.003], 'z', 24).castShadow = false
    cylinder(icc, 0.003, 0.05, glowMat(RING, 1), [0, 0, 0.025], 'z', 8).castShadow = false
    addLabel(icc, 'ICC', [-0.05, -0.03, 0.06], RING, 0.026, 'right')
    const spokes = [RING, GREY, GREY].map((c) => addRod(g, glowMat(c, c === RING ? 0.9 : 0.4)))

    // Speed profile across the axle: the line through both wheel speeds crosses zero at the ICC.
    const { px, py, wPx, vPx, span } = TURN
    addLabel(scene, 'wheel speeds across the axle', [px, py + span + 1.2, 0.3], LABEL, 0.38)
    stretchRod(addRod(scene, glowMat(GREY, 0.5)), [px - span, py, 0], [px + span, py, 0], 0.05)
    for (const s of [-1, 1]) box(scene, [0.6, 1.2, 0.4], mat('#1e1e1e', { rough: 0.9 }), [px + s * wPx, py, -0.1])
    addLabel(scene, 'L', [px - wPx - 0.8, py - 0.6, 0.3], HEAT, 0.4)
    addLabel(scene, 'R', [px + wPx + 0.8, py - 0.6, 0.3], B_FIELD, 0.4)
    const pArrows = [stretchArrow(scene, HEAT, 0.11), stretchArrow(scene, B_FIELD, 0.11), stretchArrow(scene, POWER, 0.09)]
    const profile = addRod(scene, glowMat(RING, 0.7))
    const pIcc = add(scene, mesh(new THREE.SphereGeometry(0.3, 16, 12), glowMat(RING, 1.2)))
    const pIccTag = liveLabel(scene, [0, 0, 0.4], { size: 0.34, color: RING })
    const pText = liveLabel(scene, [px, py - span - 1, 0.3], { size: 0.36 })

    const st = { key: '', pose: { x: 0, y: 0, th: 0 } as Pose, dL: 0, dR: 0, trail: 0, acc: 0 }
    return {
      scene,
      view: { center: [-2, -0.4, 0], radius: 64, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = turnParams(p)
        const key = `${q.vL}|${q.vR}`
        if (key !== st.key) {
          st.key = key
          Object.assign(st, { pose: turnStart(q), trail: 0, acc: 0 })
          trail.show(0)
          const c = iccOf(st.pose, q.vL, q.vR, TT_TRACK_M)
          let k = 0
          if (c && Math.abs(q.R) < 3)
            [
              [Math.abs(q.R - HALF), HEAT, 1],
              [Math.abs(q.R + HALF), B_FIELD, 1],
              [Math.abs(q.R), RING, 0.6],
            ].forEach(([r, color, s]) => {
              for (let i = 0; i < TURN.ring; i++) {
                const a = (i / TURN.ring) * 2 * Math.PI
                const x = c[0] + (r as number) * Math.cos(a)
                const y = c[1] + (r as number) * Math.sin(a)
                if (inside(x, y, TURN.fx, TURN.fy)) rings.set(k++, [x, y, 0.003], color as string, s as number)
              }
            })
          rings.show(k)
          icc.visible = !!c && inside(c[0], c[1], TURN.fx, TURN.fy)
          if (c) icc.position.set(c[0], c[1], 0)
          const yL = py + q.vL * vPx
          const yR = py + q.vR * vPx
          const xL = px - wPx
          const xR = px + wPx
          pArrows[0]([xL, py, 0.2], [xL, yL, 0.2])
          pArrows[1]([xR, py, 0.2], [xR, yR, 0.2])
          pArrows[2]([px, py, 0.25], [px, py + q.v * vPx, 0.25])
          const slope = (yR - yL) / (xR - xL)
          const yAt = (x: number) => yL + slope * (x - xL)
          const clipX = (x: number) => {
            const y = yAt(x)
            if (Math.abs(y - py) <= span || Math.abs(slope) < 1e-9) return x
            return xL + (py + Math.sign(y - py) * span - yL) / slope
          }
          const xa = clipX(px - span)
          const xb = clipX(px + span)
          profile.visible = q.vL !== 0 || q.vR !== 0
          stretchRod(profile, [xa, yAt(xa), 0.15], [xb, yAt(xb), 0.15], 0.05)
          const xi = Number.isFinite(q.R) ? px - (q.R / HALF) * wPx : Infinity
          pIcc.visible = Math.abs(xi - px) <= span
          pIcc.position.set(xi, py, 0.3)
          pIccTag.group.position.set(Math.max(px - span + 0.6, Math.min(px + span - 0.6, Number.isFinite(xi) ? xi : px + span)), py - 1.7, 0.4)
          pIccTag.set(pIcc.visible ? 'ICC' : Number.isFinite(q.R) ? `ICC ${q.R > 0 ? '←' : '→'} ${lenText(Math.abs(q.R))}` : 'ICC at ∞', RING)
          pText.set(`vL ${q.vL.toFixed(2)} · v ${q.v.toFixed(2)} · vR ${q.vR.toFixed(2)} m/s`, LABEL)
          status.set(turnWord(q), isSpin(q) ? RING : LABEL)
        }
        const prev = st.pose
        st.pose = diffStep(st.pose, q.vL, q.vR, TT_TRACK_M, dt)
        st.dL += q.vL * dt
        st.dR += q.vR * dt
        if (!inside(st.pose.x, st.pose.y, [TURN.fx[0] - 0.05, TURN.fx[1] + 0.05], [TURN.fy[0] - 0.05, TURN.fy[1] + 0.05])) {
          st.pose = turnStart(q)
          st.trail = 0
        }
        st.acc += Math.hypot(st.pose.x - prev.x, st.pose.y - prev.y) + Math.abs(st.pose.th - prev.th) * 0.01
        if (st.acc > 0.012) {
          st.acc = 0
          trail.set(st.trail % TURN.trail, [st.pose.x, st.pose.y, 0.004], GREY)
          st.trail++
          trail.show(Math.min(TURN.trail, st.trail))
        }
        bot.set(st.pose, st.dL, st.dR)
        const z = 0.08
        arrows[0]([0, HALF, z], [q.vL * 0.45, HALF, z])
        arrows[1]([0, -HALF, z], [q.vR * 0.45, -HALF, z])
        arrows[2]([0, 0, z + 0.01], [q.v * 0.45, 0, z + 0.01])
        const c = iccOf(st.pose, q.vL, q.vR, TT_TRACK_M)
        const near = !!c && Math.abs(q.R) < 2
        spokes.forEach((s, i) => {
          s.visible = near && !isSpin(q)
          if (!s.visible || !c) return
          const [wx, wy] = toRoom(st.pose, 0, i === 0 ? 0 : i === 1 ? HALF : -HALF)
          stretchRod(s, [c[0], c[1], 0.006], [wx, wy, 0.006], i === 0 ? 0.0025 : 0.0015)
        })
      },
      readouts: (p) => {
        const q = turnParams(p)
        const lap = Math.abs(q.w) > 1e-9 ? (2 * Math.PI) / Math.abs(q.w) : Infinity
        return [
          { label: 'Body speed v', value: `${q.v.toFixed(2)} m/s` },
          { label: 'Turn rate ω', value: `${q.w.toFixed(2)} rad/s · ${Math.round(toDeg(q.w))}°/s` },
          { label: 'Turn radius R', value: Number.isFinite(q.R) ? lenText(Math.abs(q.R)) : '∞ (straight)', tone: isSpin(q) ? 'warn' : undefined },
          { label: 'One full circle', value: Number.isFinite(lap) ? `${lap.toFixed(1)} s` : '—' },
        ]
      },
    }
  },
}

// --- Odometry: dead-reckon a 1 m square from ticks; a slightly wrong wheel or track makes the estimate drift (UMBmark). ---

const DIRS = { ccw: 'Counter-clockwise', cw: 'Clockwise' }
const ODO = { at: [-6.8, -1.6, 0] as V3, k: 11, robotK: 1.6, slow: 6, hold: 2.5, half: 0.82, maxDots: 1500, plotN: 400, px: 8.6, py: 0.6, pw: 10, ph: 6.5 }
const odoParams = (p: Params) => ({ ed: n(p, 'ed'), eb: n(p, 'eb'), cw: pick(DIRS, p.dir, 'ccw') === 'cw', laps: n(p, 'laps') })
type OdoQ = ReturnType<typeof odoParams>
const odoKey = (q: OdoQ) => `${q.ed}|${q.eb}|${q.cw}|${q.laps}`
const odoRun = memoBy(odoKey, (q: OdoQ) => {
  const r = squareRun(q.ed, q.eb, q.cw, q.laps)
  const errs = r.frames.map((f) => squareError(f.truth, f.est).distM)
  const top = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1].find((v) => v >= Math.max(...errs)) ?? 1
  return { ...r, errs, top, tEnd: r.frames.at(-1)!.t }
})
const NICE_MM = (m: number) => (m < 0.1 ? `${Math.round(m * 1000)} mm` : `${(m * 100).toFixed(0)} cm`)

export const odometryLesson: Lesson = {
  id: 'differential-drive-odometry',
  title: 'Odometry',
  tagline: 'Dead reckoning from wheel ticks, and why it drifts',
  formula: (p) => {
    const q = odoParams(p)
    const e = odoRun(q).ends
    return `Δs = (ΔL + ΔR)/2 · Δθ = (ΔR − ΔL)/b · x += Δs·cos(θ + Δθ/2) · y += Δs·sin(θ + Δθ/2) · θ += Δθ → after ${q.laps} lap${q.laps > 1 ? 's' : ''}: ${NICE_MM(e.at(-1)?.distM ?? 0)} off`
  },
  legend: [
    { color: LABEL, label: 'True robot and its path', shape: 'dot' },
    { color: RING, label: 'Odometry estimate (ghost) and path', shape: 'dot' },
    { color: HIGH_V, label: 'Error: true − estimate', shape: 'dot' },
    { color: GREY, label: 'The 1 m square it was told to drive', shape: 'dot' },
  ],
  points: [
    'Dead reckoning: no map, no beacons, just add up wheel motion. Each control tick turns encoder counts into travel per wheel (ΔL, ΔR), then Δs = (ΔL + ΔR)/2 forward and Δθ = (ΔR − ΔL)/b of turn, applied at the mid-heading. Small errors are summed too, so they never shrink.',
    'Two numbers set the scale: wheel diameter (mm per tick) and track width b. If the right tyre is 1 % bigger than the left, every "straight" bends; if the real b is 3 % wider than in code, every 90° turn by ticks only turns 87°. Heading errors are the bad ones: they swing the whole rest of the path.',
    'UMBmark (Borenstein, 1995) calibrates both: drive a 4 × 4 m square by odometry five times clockwise and five counter-clockwise, measure where it really stops. A track error bends both directions alike (mirror image); a diameter error bends them opposite ways, so in one direction the two can even cancel. The two clusters give two corrections.',
    'Even calibrated, odometry drifts with distance (ticks round off, tyres squash, floors slip — see Slip), so robots reset it with a gyro for heading (see Sensor fusion) and landmarks or lidar for position.',
  ],
  controls: [
    { kind: 'slider', key: 'ed', label: 'Right tyre vs left', min: -2, max: 2, step: 0.2, initial: -0.4, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} %` },
    { kind: 'slider', key: 'eb', label: 'True track vs code', min: -6, max: 6, step: 0.5, initial: 3, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} %` },
    { kind: 'choice', key: 'dir', options: opts(DIRS), initial: 'ccw' },
    { kind: 'slider', key: 'laps', label: 'Laps', min: 1, max: 4, step: 1, initial: 2, format: (v) => `${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17.5, 7.4, 0.3], { size: 0.44, align: 'left' })
    const sub = liveLabel(scene, [-17.5, 6.4, 0.3], { size: 0.32, color: GREY, align: 'left' })
    const g = floorView(scene, ODO.at, ODO.k, -0.6)
    floorMat(g, [-ODO.half, ODO.half], [-ODO.half, ODO.half])
    const w = add(g, new THREE.Group())
    const sides = [0, 1, 2, 3].map(() => addRod(w, glowMat(GREY, 0.5)))
    flatBox(w, [0.06, 0.06, 0.004], glowMat(POWER, 0.4), [0, 0, 0.003])
    const startTag = liveLabel(w, [0, 0, 0.02], { size: 0.045, color: GREY })
    const truePath = pointCloud(w, ODO.maxDots, 0.006)
    const estPath = pointCloud(w, ODO.maxDots, 0.0055)
    const lapDots = pointCloud(w, 4, 0.018)
    const bot = diffBot(w)
    const ghost = diffBot(w, { ghost: RING })
    bot.group.scale.setScalar(ODO.robotK)
    ghost.group.scale.setScalar(ODO.robotK)
    const errRod = addRod(w, glowMat(HIGH_V, 1))
    const errTag = liveLabel(w, [0, 0, 0.1], { size: 0.05, color: HIGH_V })

    const plot = scope(scene, ODO.pw, ODO.ph, { divs: [8, 5], zeroAt: 0 })
    plot.group.position.set(ODO.px, ODO.py, 0)
    const trace = plot.trace(HIGH_V, { samples: ODO.plotN, radius: 0.07 })
    const cur = cursorBar(plot, LABEL, 0.06)
    const plotLaps = pointCloud(plot.group, 4, 0.2)
    const topTag = liveLabel(scene, [ODO.px + ODO.pw / 2, ODO.py + ODO.ph / 2 + 0.9, 0.3], { size: 0.34, color: GREY, align: 'right' })
    const axisTag = liveLabel(scene, [ODO.px, ODO.py - ODO.ph / 2 - 1, 0.3], { size: 0.34, color: GREY })
    addLabel(scene, 'error |true − estimate|', [ODO.px - ODO.pw / 2, ODO.py + ODO.ph / 2 + 0.9, 0.3], HIGH_V, 0.34, 'left')

    const clock = simClock(UMB.dt * UMB.every / ODO.slow, ODO.hold)
    const st = { key: '', stride: 1, us: [] as number[], ys: [] as number[] }
    return {
      scene,
      view: { center: [-1.5, 0, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = odoParams(p)
        const key = odoKey(q)
        const r = odoRun(q)
        const i = Math.floor(clock(dt, key, r.frames.length - 1))
        const f = r.frames[i]
        const yOf = (e: number) => (Math.min(1, e / r.top) - 0.5) * ODO.ph * 0.96
        if (key !== st.key) {
          st.key = key
          const s = q.cw ? -1 : 1
          w.position.set(-0.5, -s * 0.5, 0)
          const c: V3[] = [[0, 0, 0.002], [1, 0, 0.002], [1, s, 0.002], [0, s, 0.002]]
          sides.forEach((rod, k) => stretchRod(rod, c[k], c[(k + 1) % 4], 0.003))
          startTag.group.position.set(-0.04, -s * 0.08, 0.02)
          startTag.set('start', GREY)
          st.stride = Math.max(1, Math.ceil(r.frames.length / ODO.maxDots))
          for (let k = 0; k * st.stride < r.frames.length; k++) {
            const h = r.frames[k * st.stride]
            truePath.set(k, [h.truth.x, h.truth.y, 0.004], LABEL)
            estPath.set(k, [h.est.x, h.est.y, 0.006], RING)
          }
          const pStride = Math.max(1, Math.ceil(r.frames.length / ODO.plotN))
          st.us = []
          st.ys = []
          for (let k = 0; k < r.frames.length; k += pStride) {
            st.us.push(r.frames[k].t / r.tEnd)
            st.ys.push(yOf(r.errs[k]))
          }
          let lap = 0
          r.frames.forEach((h, k) => {
            if (h.leg % 8 === 0 && h.leg / 8 > lap) {
              lapDots.set(lap, [h.truth.x, h.truth.y, 0.01], HIGH_V)
              plotLaps.set(lap, [plot.xAt(h.t / r.tEnd), yOf(r.errs[k]), 0.4], HIGH_V)
              lap++
            }
          })
          topTag.set(`0 … ${NICE_MM(r.top)}`, GREY)
          axisTag.set(`over ${Math.round(r.tEnd)} s, ${r.distM} m driven · dots: lap ends`, GREY)
        }
        const shown = Math.floor(i / st.stride) + 1
        truePath.show(shown)
        estPath.show(shown)
        const lapsDone = Math.floor(f.leg / 8)
        lapDots.show(lapsDone)
        plotLaps.show(lapsDone)
        let upto = 0
        while (upto < st.us.length && st.us[upto] <= f.t / r.tEnd) upto++
        trace.points(st.us.slice(0, upto), st.ys.slice(0, upto))
        cur(f.t / r.tEnd)
        const mmT = UMB.tickMm / 1000
        bot.set(f.truth, f.ticks[0] * mmT, f.ticks[1] * mmT)
        ghost.set(f.est)
        const e = squareError(f.truth, f.est)
        errRod.visible = e.distM > 0.004
        stretchRod(errRod, [f.est.x, f.est.y, 0.03], [f.truth.x, f.truth.y, 0.03], 0.004)
        errTag.group.position.set((f.est.x + f.truth.x) / 2 + 0.1, (f.est.y + f.truth.y) / 2 + 0.06, 0.1)
        errTag.set(e.distM > 0.004 ? NICE_MM(e.distM) : '', HIGH_V)
        const done = i >= r.frames.length - 1
        const lap = Math.min(q.laps, lapsDone + 1)
        const legN = (f.leg % 8) + 1
        status.set(
          done
            ? `Thinks it's home. Really ${NICE_MM(e.distM)} away, ${Math.abs(e.headDeg).toFixed(1)}° off`
            : `Lap ${lap}/${q.laps} · ${legN % 2 ? 'driving 1 m' : `turning 90° ${q.cw ? 'right' : 'left'}`} by counting ticks`,
          done ? (errTone(e.distM) === 'ok' ? POWER : errTone(e.distM) === 'warn' ? HEAT : HIGH_V) : LABEL,
        )
        sub.set(`TT car, 2112 ticks per wheel turn · robot drawn ${ODO.robotK}× · ${ODO.slow}× faster · t ${f.t.toFixed(1)} s`)
      },
      readouts: (p) => {
        const q = odoParams(p)
        const r = odoRun(q)
        const last = r.ends.at(-1) ?? { distM: 0, headDeg: 0 }
        return [
          { label: 'Error at the end', value: NICE_MM(last.distM), tone: errTone(last.distM) },
          { label: 'Heading error', value: `${last.headDeg.toFixed(1)}°`, tone: Math.abs(last.headDeg) < 1 ? 'ok' : Math.abs(last.headDeg) < 5 ? 'warn' : 'bad' },
          { label: 'Per lap', value: r.ends.map((x) => Math.round(x.distM * 1000)).join(' · ') + ' mm' },
          { label: 'Error per metre', value: `${((last.distM / r.distM) * 1000).toFixed(1)} mm/m` },
        ]
      },
    }
  },
}

// --- Slip: rubber grips up to μ·N; ask for more and the wheels spin or skid while the ticks keep counting. ---

const MOVES: Record<SlipMove, string> = { launch: 'Hard start & stop', turn: 'Tight U-turn', spin: 'Spin in place' }
const FLOOR_NAMES = Object.fromEntries((Object.keys(FLOORS) as FloorKind[]).map((k) => [k, FLOORS[k].name])) as Record<FloorKind, string>
const FLOOR_LOOK: Record<FloorKind, [string, number]> = { carpet: ['#3b3249', 1], wood: ['#5a3f2a', 0.55], tile: ['#58606c', 0.12], dusty: ['#625e54', 0.75] }
const SL = { at: [-13.4, -2, 0] as V3, k: 15, fx: [-0.25, 1.0] as [number, number], fy: [-0.32, 0.46] as [number, number], slow: 4, hold: 2, px: 9.6, py: 0.6, pw: 9, ph: 6, vMax: 0.5, mark: 0.04 }
const slipParams = (p: Params) => {
  const move = pick(MOVES, p.move, 'turn') as SlipMove
  const floor = pick(FLOORS, p.floor, 'dusty') as FloorKind
  const accel = n(p, 'accel')
  const caster = n(p, 'caster') / 100
  return { move, floor, accel, caster, mu: FLOORS[floor].mu, grip: gripAccel(FLOORS[floor].mu, caster) }
}
type SlipQ = ReturnType<typeof slipParams>
const slipKey = (q: SlipQ) => `${q.move}|${q.floor}|${q.accel}|${q.caster}`
const slipMemo = memoBy(slipKey, (q: SlipQ) => slipRun(q.move, q.mu, q.accel, q.caster))
const turnNeed = 0.45 ** 2 / SLIP.uTurnR
function demandText(q: SlipQ) {
  const g = `grip ${q.grip.toFixed(1)} m/s²`
  if (q.move === 'turn') return `U-turn asks v²/R = ${turnNeed.toFixed(1)} m/s² sideways · speeding up ${q.accel} m/s² · ${g}`
  return `${q.move === 'spin' ? 'Spin-up' : 'Start & stop'} asks ${q.accel} m/s² at each tyre · ${g}${q.accel > q.grip ? ' → wheels slip' : ''}`
}

export const slipLesson: Lesson = {
  id: 'differential-drive-slip',
  title: 'Slip',
  tagline: 'When the wheels turn but the robot doesn\'t follow',
  formula: (p) => {
    const q = slipParams(p)
    return `a_max = μ·g·(1 − caster share) = ${q.mu} × 9.81 × ${(1 - q.caster).toFixed(2)} = ${q.grip.toFixed(2)} m/s² · ask more and the tyres slide; ticks count the wheel, not the floor`
  },
  legend: [
    { color: LABEL, label: 'True robot and its path', shape: 'dot' },
    { color: RING, label: 'Odometry estimate (ghost) and path', shape: 'dot' },
    { color: HIGH_V, label: 'Tyre sliding: contact patch and skid marks', shape: 'dot' },
    { color: HEAT, label: 'Left tyre slip (right: cyan)', shape: 'dot' },
  ],
  points: [
    'Odometry assumes every tick of the wheel is a tick of floor. That holds only while the tyre grips: friction can push at most μ·N, where N is the weight on that wheel. Ask for more and the tyre slides, the encoder keeps counting, and the estimate runs off on its own.',
    'Speeding up: a = F/m, so the wheels give at most μ·g·(1 − caster share). Rubber on carpet manages ~6 m/s², polished tile ~2.6, dusty tile ~1.5. A TT car slammed to full PWM spins on tile; braking skids the other way, so part of the error cancels, but never reliably. Slew-limit the command (see Joystick over BLE).',
    'Turning: a curve at speed v and radius R needs v²/R of sideways grip. Too tight on a slick floor and the robot slides outward while odometry thinks it carved the perfect arc. Spin in place is the worst for heading: all the turn comes from tyre force at ±b/2.',
    'The caster matters too: weight it carries is weight the drive wheels don\'t, and a swivel caster drags and flips when you reverse. Wide tyres scrub when turning, so the real track b sits somewhere across the contact patch and changes with floor: calibrate it (see Odometry), and use a gyro for heading (see Sensor fusion).',
  ],
  controls: [
    { kind: 'choice', key: 'move', options: opts(MOVES), initial: 'turn' },
    { kind: 'choice', key: 'floor', options: opts(FLOOR_NAMES), initial: 'dusty' },
    { kind: 'slider', key: 'accel', label: 'Acceleration asked', min: 0.5, max: 8, step: 0.5, initial: 4, format: (v) => `${v.toFixed(1)} m/s²` },
    { kind: 'slider', key: 'caster', label: 'Weight on caster', min: 10, max: 50, step: 5, initial: 25, format: (v) => `${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-17.5, 7.4, 0.3], { size: 0.4, align: 'left' })
    const sub = liveLabel(scene, [-17.5, 6.4, 0.3], { size: 0.32, color: GREY, align: 'left' })
    const g = floorView(scene, SL.at, SL.k, -0.6)
    const [x0, x1] = SL.fx
    const [y0, y1] = SL.fy
    const plates = (Object.keys(FLOORS) as FloorKind[]).map((k) => {
      const [c, rough] = FLOOR_LOOK[k]
      return [k, flatBox(g, [x1 - x0, y1 - y0, 0.01], mat(c, { rough, metal: k === 'tile' ? 0.15 : 0 }), [(x0 + x1) / 2, (y0 + y1) / 2, -0.005])] as const
    })
    const grid = mat('#000000', { rough: 0.9, opacity: 0.25 })
    for (let x = Math.ceil(x0 * 10) / 10; x <= x1; x += 0.1) flatBox(g, [0.003, y1 - y0, 0.002], grid, [x, (y0 + y1) / 2, 0.001])
    for (let y = Math.ceil(y0 * 10) / 10; y <= y1; y += 0.1) flatBox(g, [x1 - x0, 0.003, 0.002], grid, [(x0 + x1) / 2, y, 0.001])
    const floorTag = liveLabel(g, [x1, y0 - 0.04, 0.01], { size: 0.024, color: GREY, align: 'right' })
    const w = add(g, new THREE.Group())
    const truePath = pointCloud(w, 400, 0.005)
    const estPath = pointCloud(w, 400, 0.0045)
    const marks = pointCloud(w, 800, 0.006)
    const bot = diffBot(w)
    const ghost = diffBot(w, { ghost: RING })

    const plot = scope(scene, SL.pw, SL.ph, { divs: [9, 5], zeroAt: 0 })
    plot.group.position.set(SL.px, SL.py, 0)
    const yOf = (v: number) => (Math.min(1, v / SL.vMax) - 0.5) * SL.ph * 0.96
    const traces = [plot.trace(HEAT, { samples: 400, radius: 0.07 }), plot.trace(B_FIELD, { samples: 400, radius: 0.07 })]
    const cur = cursorBar(plot, LABEL, 0.06)
    const top = SL.py + SL.ph / 2 + 0.9
    addLabel(scene, 'tyre slip:', [SL.px - SL.pw / 2, top, 0.3], LABEL, 0.34, 'left')
    addLabel(scene, 'left', [SL.px - SL.pw / 2 + 2.6, top, 0.3], HEAT, 0.34, 'left')
    addLabel(scene, 'right', [SL.px - SL.pw / 2 + 4, top, 0.3], B_FIELD, 0.34, 'left')
    addLabel(scene, `0 … ${SL.vMax} m/s`, [SL.px + SL.pw / 2, top, 0.3], GREY, 0.34, 'right')
    addLabel(scene, `0 … ${SLIP.seconds} s`, [SL.px, SL.py - SL.ph / 2 - 1, 0.3], GREY, 0.34)
    const errTag = liveLabel(scene, [SL.px - SL.pw / 2, SL.py - SL.ph / 2 - 2.2, 0.3], { size: 0.38, align: 'left' })

    const clock = simClock(SLIP.dt * SLIP.every * SL.slow, SL.hold)
    const st = { key: '', us: [] as number[], ys: [[], []] as number[][], marks: [] as number[] }
    return {
      scene,
      view: { center: [-1.5, 0, 0], radius: 58, polar: 1.45, azimuth: 0 },
      frame(dt, p) {
        const q = slipParams(p)
        const key = slipKey(q)
        const r = slipMemo(q)
        const i = Math.floor(clock(dt, key, r.frames.length - 1))
        const f = r.frames[i]
        if (key !== st.key) {
          st.key = key
          plates.forEach(([k, o]) => (o.visible = k === q.floor))
          floorTag.set(`${FLOORS[q.floor].name}, μ ${q.mu} · 10 cm grid`, GREY)
          w.position.set(q.move === 'spin' ? 0.4 : 0, q.move === 'spin' ? 0.08 : 0, 0)
          st.us = r.frames.map((h) => h.t / SLIP.seconds)
          st.ys = [0, 1].map((k) => r.frames.map((h) => yOf(h.slip[k])))
          st.marks = []
          r.frames.forEach((h, k) => {
            truePath.set(k, [h.truth.x, h.truth.y, 0.003], LABEL)
            estPath.set(k, [h.est.x, h.est.y, 0.005], RING)
            ;[HALF, -HALF].forEach((y, s) => {
              if (h.slip[s] < SL.mark) return
              const [mx, my] = toRoom(h.truth, 0, y)
              marks.set(st.marks.length, [mx, my, 0.002], HIGH_V, 0.6 + Math.min(1.4, h.slip[s] * 5))
              st.marks.push(k)
            })
          })
        }
        truePath.show(i + 1)
        estPath.show(i + 1)
        let m = 0
        while (m < st.marks.length && st.marks[m] <= i) m++
        marks.show(m)
        traces.forEach((t, k) => t.points(st.us.slice(0, i + 1), st.ys[k].slice(0, i + 1)))
        cur(f.t / SLIP.seconds)
        bot.set(f.truth, f.travel[0], f.travel[1])
        ghost.set(f.est)
        bot.slip(Math.min(1, f.slip[0] / 0.15), Math.min(1, f.slip[1] / 0.15))
        const e = squareError(f.truth, f.est)
        const sliding = Math.max(...f.slip) > SL.mark
        status.set(demandText(q), q.accel > q.grip || (q.move === 'turn' && turnNeed > q.grip) ? HEAT : POWER)
        sub.set(`0.8 kg TT car, ${Math.round(q.caster * 100)} % weight on the caster · ${SL.slow}× slower · t ${f.t.toFixed(2)} s${sliding ? ' · SLIDING' : ''}`)
        errTag.set(`odometry off by ${mmText(e.distM)}, ${e.headDeg.toFixed(1)}°`, e.distM < 0.01 && Math.abs(e.headDeg) < 1 ? POWER : HIGH_V)
      },
      readouts: (p) => {
        const q = slipParams(p)
        const r = slipMemo(q)
        const asked = q.move === 'turn' ? Math.max(q.accel, turnNeed) : q.accel
        return [
          { label: 'Grip limit', value: `${q.grip.toFixed(1)} m/s²`, tone: asked > q.grip ? 'bad' : 'ok' },
          { label: 'Peak tyre slip', value: `${r.peakSlip.toFixed(2)} m/s`, tone: r.peakSlip < SL.mark ? 'ok' : r.peakSlip < 0.15 ? 'warn' : 'bad' },
          { label: 'Odometry error at stop', value: mmText(r.end.distM), tone: errTone(r.end.distM) },
          { label: 'Heading error at stop', value: `${r.end.headDeg.toFixed(1)}°`, tone: Math.abs(r.end.headDeg) < 1 ? 'ok' : Math.abs(r.end.headDeg) < 5 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}
