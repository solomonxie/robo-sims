import * as THREE from 'three/webgpu'
import {
  GAITS,
  KNEE_FOLD,
  QUAD_GAITS,
  QUAD_KIT,
  QUAD_LINKS,
  QuadGait,
  QuadLinks,
  Walker,
  footPath,
  legFK,
  legPhase,
  pulseForDeg,
  quadGaitRun,
  quadGeometry,
  quadHips,
  quadLoads,
  quadServoDeg,
  quadStance,
  supportHull,
  toDeg,
} from '../../core/physics'
import { fixedText, mmText, nmText } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  IDLE,
  LABEL,
  POWER,
  RING,
  addLabel,
  addRod,
  emptyGroup,
  flatBox,
  floorMat,
  floorPolygon,
  floorView,
  frac,
  glowMat,
  liveLabel,
  memoBy,
  plotY,
  pointCloud,
  servoWalker,
  statusHeader,
  stretchArrow,
  stretchRod,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const VIEW = { center: [-1.2, -0.9, 0] as V3, radius: 58, polar: 1.45, azimuth: 0 }
const LINK_NAMES = Object.fromEntries(Object.entries(QUAD_LINKS).map(([k, v]) => [k, v.name])) as Record<QuadLinks, string>
const STALL = QUAD_KIT.servo.stallNm
const deg = (v: number) => `${Math.round(v)}°`
const us = (servoDeg: number) => `${Math.round(pulseForDeg(servoDeg, [500, 2500]))} µs`
const BODY_W = 2 * QUAD_KIT.hipY - 0.03
const nCm = (t: number) => `${fixedText(t * 100, 1)} N·cm`

/** 8-servo walker for `servoWalker`: no coxa, legs in the body's x–z plane. */
const quadWalker = (h: number, links: QuadLinks): Walker => ({
  coxa: 0,
  femur: QUAD_LINKS[links].femur,
  tibia: QUAD_LINKS[links].tibia,
  height: h,
  reach: 0,
  mounts: quadHips().map(([x, y]) => [x, y, 0] as [number, number, number]),
  names: QUAD_KIT.names,
})

/** Rebuilds the walker when its height or links change. */
function walkerSlot(parent: THREE.Object3D) {
  let bot: ReturnType<typeof servoWalker> | null = null
  let key = ''
  return (h: number, links: QuadLinks) => {
    const k = `${h}|${links}`
    if (k !== key || !bot) {
      key = k
      if (bot) {
        emptyGroup(bot.group)
        bot.group.removeFromParent()
      }
      bot = servoWalker(parent, quadWalker(h, links), { names: false, width: BODY_W })
    }
    return bot
  }
}

// --- Leg geometry: two servos per leg; height trades stride against knee load, and the horn centre sets the travel. ---

const FEET = { stand: 'Standing: 4 feet carry it', creep: 'Creep: 3 feet carry it', trot: 'Trot: 2 feet carry it' }
const FEET_N = { stand: 4, creep: 3, trot: 2 }
const lgParams = (p: Params) => {
  const feet = pick(FEET, p.feet, 'trot')
  return { links: pick(LINK_NAMES, p.links, 'kit'), h: n(p, 'height') / 1000, stride: n(p, 'stride') / 1000, feet, down: FEET_N[feet] }
}
type LgQ = ReturnType<typeof lgParams>
const lgCalc = memoBy((q: LgQ) => `${q.links}|${q.h}|${q.stride}|${q.down}`, (q: LgQ) => quadGeometry(q.h, q.stride, q.down, q.links))
const LG = { hip: [-11.6, 1.8, 0] as V3, k: 52, T: 1.4, span: 0.1, sx: 6.4, sy: 1.6, sw: 10.5, sh: 3.6, walker: [-4.6, -5.8, 0] as V3 }
const VERDICT = { ok: 'under half the stall torque', thin: 'over half the stall torque: hot and slow', weak: 'over the stall torque: the leg folds' }

export const quadrupedLegGeometry: Lesson = {
  id: 'quadruped-leg-geometry',
  title: 'Leg geometry',
  tagline: 'Two SG90s per leg: body height trades stride against knee load',
  formula: (p) => {
    const q = lgParams(p)
    const R = lgCalc(q)
    const F = quadLoads(0, q.h, q.down, q.links).F
    return `F = m·g / feet = ${fixedText(QUAD_KIT.massKg, 2)} kg × 9.81 / ${q.down} = ${fixedText(F, 2)} N · τ_knee = F × lever (knee to foot) ≤ ${nCm(R.worstKnee)} · SG90 stall ${nCm(STALL)} at 5 V → ${Math.round(R.share * 100)} % · stride reach ${mmText(R.maxStride)}`
  },
  legend: [
    { color: B_FIELD, label: 'Ground the foot can reach (servo travel, knee fold)', shape: 'dot' },
    { color: POWER, label: 'Stride (red: past the reach)', shape: 'dot' },
    { color: HEAT, label: 'Knee holding torque (yellow: hip)', shape: 'dot' },
    { color: HIGH_V, label: 'SG90 stall torque', shape: 'dot' },
  ],
  points: [
    'An 8-servo quadruped has two SG90s per leg, a hip that swings the thigh fore and aft and a knee, so each foot moves only in the leg’s own vertical plane: no coxa servo, no sideways step. The leg is the two-link chain from Mobility › Legged walking › Leg IK, here with the knees pointing back; eight leads go to PCA9685 channels 0–7, the servos on the 5 V pack rail.',
    'Fit the horns as for the arm (Robot arm › Assemble): drive each servo to 1500 µs first, then press the horn on with the thigh straight down and the knee bent 90°. That puts both servos mid-travel standing. Crouch low and the hip servo already sits near 0° standing, so the foot can barely move back before the horn hits the end of its 180°: a short, lopsided stride.',
    'Height trades stride against load. Tall, the leg is nearly straight: the reach ring d ≤ femur + tibia cuts the stride, but the knee lever is short. Low, the stride is long but the foot sits far from the knee, and each foot pushes m·g / (feet down) up through it. Trot carries the robot on two feet, twice the load of standing on four.',
    'Size the knee for the worst point of the stride: holding torque = F × the horizontal distance knee → foot. Keep it under half the SG90’s stall torque (Kinematics › Robot arm build › Assemble the arm has the same rule), or the servo runs hot, slows down and sags. Longer links reach further but load the knee more; a heavier pack or metal-gear MG90S changes the sums.',
  ],
  controls: [
    { kind: 'choice', key: 'links', options: opts(LINK_NAMES), initial: 'kit' },
    { kind: 'choice', key: 'feet', options: opts(FEET), initial: 'trot' },
    { kind: 'slider', key: 'height', label: 'Body height', min: 45, max: 105, step: 5, initial: 70, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'stride', label: 'Stride', min: 10, max: 120, step: 10, initial: 50, format: (v) => `${v} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)

    const leg = add(scene, new THREE.Group(), LG.hip)
    leg.scale.setScalar(LG.k)
    const pen = pointCloud(leg, 420, 0.0011)
    const ground = addRod(leg, glowMat(IDLE, 0.6))
    const reachRod = addRod(leg, glowMat(B_FIELD, 0.8))
    const strideRod = addRod(leg, glowMat(POWER, 0.9))
    const servoM = glowMat('#2a5bd7', 0.35)
    flatBox(leg, [0.016, 0.016, 0.012], servoM, [0, 0, 0.004]).castShadow = false
    const kneeServo = flatBox(leg, [0.014, 0.014, 0.012], servoM, [0, 0, 0.004])
    kneeServo.castShadow = false
    const boneM = glowMat('#d9dce2', 0.35)
    const femurRod = addRod(leg, boneM)
    const tibiaRod = addRod(leg, boneM)
    const lever = addRod(leg, glowMat(HEAT, 0.9))
    const push = stretchArrow(leg, RING, 0.0014)
    const foot = pointCloud(leg, 2, 0.004)
    const hipTag = liveLabel(leg, [0.008, 0.012, 0.01], { size: 0.0058, align: 'left' })
    const kneeTag = liveLabel(leg, [0, 0, 0.01], { size: 0.0058, align: 'right' })
    const leverTag = liveLabel(leg, [0, 0, 0.01], { size: 0.0055, color: HEAT })

    const fv = floorView(scene, LG.walker, 36, -1.1)
    floorMat(fv, [-0.16, 0.16], [-0.12, 0.12])
    const slot = walkerSlot(fv)

    const sc = titledScope(scene, LG.sy, LG.sh, 'holding torque vs foot position', HEAT, 0, LG.sx, LG.sw)
    const kneeTr = sc.s.trace(HEAT, { samples: 120, radius: 0.07 })
    const hipTr = sc.s.trace(RING, { samples: 120, radius: 0.05 })
    const stallLvl = sc.s.level(HIGH_V)
    const halfLvl = sc.s.level(HEAT)
    sc.lo.set(`foot ${mmText(LG.span)} behind the hip`, GREY)
    sc.hi.set(`${mmText(LG.span)} ahead`, GREY)
    const rows = textRows(scene, 4, LG.sx - LG.sw / 2, -1.9, 0.3, 0.66)
    const st = { key: '', t: 0 }

    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = lgParams(p)
        const R = lgCalc(q)
        const L = QUAD_LINKS[q.links]
        const key = `${q.links}|${q.h}|${q.stride}|${q.down}`
        const yT = plotY(0, STALL * 1.25, LG.sh)
        if (key !== st.key) {
          st.key = key
          st.t = 0
          stretchRod(ground, [-0.12, -q.h, -0.002], [0.12, -q.h, -0.002], 0.0008)
          reachRod.visible = !!R.reach
          if (R.reach) stretchRod(reachRod, [R.reach[0], -q.h, 0], [R.reach[1], -q.h, 0], 0.0018)
          const s = q.stride / 2
          stretchRod(strideRod, [-s, -q.h - 0.004, 0], [s, -q.h - 0.004, 0], 0.0014)
          ;(strideRod.material as THREE.MeshStandardMaterial).color.set(R.fits ? POWER : HIGH_V)
          ;(strideRod.material as THREE.MeshStandardMaterial).emissive.set(R.fits ? POWER : HIGH_V)
          const dMax = Math.sqrt(L.femur ** 2 + L.tibia ** 2 + 2 * L.femur * L.tibia * Math.cos(KNEE_FOLD[0]))
          const dMin = Math.sqrt(L.femur ** 2 + L.tibia ** 2 + 2 * L.femur * L.tibia * Math.cos(KNEE_FOLD[1]))
          for (let i = 0; i < 180; i++) {
            const a = -Math.PI + (i / 179) * Math.PI
            pen.set(i, [dMax * Math.cos(a), dMax * Math.sin(a), 0], B_FIELD, 0.8)
            pen.set(180 + i, [dMin * Math.cos(a), dMin * Math.sin(a), 0], B_FIELD, 0.6)
          }
          pen.show(360)
          const xs: number[] = []
          const kn: number[] = []
          const hp: number[] = []
          if (R.reach)
            for (let i = 0; i < 120; i++) {
              const x = R.reach[0] + (i / 119) * (R.reach[1] - R.reach[0])
              const l = quadLoads(x, q.h, q.down, q.links)
              xs.push((x + LG.span) / (2 * LG.span))
              kn.push(yT(l.kneeNm))
              hp.push(yT(l.hipNm))
            }
          kneeTr.points(xs, kn, null)
          hipTr.points(xs, hp, null)
          stallLvl.set(yT(STALL))
          halfLvl.set(yT(STALL / 2))
        }
        st.t += dt
        const s = frac(st.t / LG.T)
        const stride = Math.min(q.stride, R.maxStride)
        const pose = (i: number) => {
          const ph = legPhase(GAITS.trot, i, s)
          const [dx, dz] = footPath(ph.swing, ph.u, stride, QUAD_KIT.lift)
          return { st: quadStance(dx, -q.h + dz, q.links), down: !ph.swing, x: dx }
        }
        const legs = [0, 1, 2, 3].map(pose)
        const bot = slot(q.h, q.links)
        bot.set({ x: 0, y: 0, th: -0.55 }, legs.map((l) => ({ yaw: 0, hip: l.st.hip, knee: l.st.knee })), legs.map((l) => l.down))

        const me = legs[0]
        const f = legFK(me.st.hip, me.st.knee, L.femur, L.tibia)
        stretchRod(femurRod, [0, 0, 0], [f.knee[0], f.knee[1], 0], 0.0032)
        stretchRod(tibiaRod, [f.knee[0], f.knee[1], 0], [f.foot[0], f.foot[1], 0], 0.0026)
        kneeServo.position.set(f.knee[0], f.knee[1], 0.004)
        foot.set(0, [f.foot[0], f.foot[1], 0.004], me.down ? POWER : GREY, 1.4)
        foot.set(1, [f.knee[0], f.knee[1], 0.008], RING, 0.6)
        foot.show(2)
        const ld = quadLoads(me.x, q.h, q.down, q.links)
        lever.visible = me.down
        stretchRod(lever, [f.knee[0], f.foot[1] + 0.003, 0.002], [f.foot[0], f.foot[1] + 0.003, 0.002], 0.0011)
        push([f.foot[0], f.foot[1], 0.004], [f.foot[0], f.foot[1] + (me.down ? 0.012 + ld.F * 0.006 : 0.0001), 0.004])
        leverTag.group.position.set((f.knee[0] + f.foot[0]) / 2, f.foot[1] - 0.009, 0.01)
        leverTag.set(me.down ? `τ ${nCm(ld.kneeNm)}` : '', HEAT)
        const okHip = me.st.hipDeg >= 0 && me.st.hipDeg <= 180
        hipTag.set(`hip ${deg(me.st.hipDeg)}`, okHip ? LABEL : HIGH_V)
        kneeTag.group.position.set(f.knee[0] - 0.008, f.knee[1], 0.01)
        kneeTag.set(`knee ${deg(me.st.kneeDeg)}`, me.st.fits ? LABEL : HIGH_V)

        const stand = R.stand
        rows[0].set(`standing: hip servo ${deg(stand.hipDeg)} (${us(stand.hipDeg)}) · knee ${deg(stand.kneeDeg)} (${us(stand.kneeDeg)})`, stand.fits ? LABEL : HIGH_V)
        rows[1].set(R.reach ? `foot reaches ${mmText(-R.reach[0])} back · ${mmText(R.reach[1])} forward` : 'cannot stand at this height', R.reach ? B_FIELD : HIGH_V)
        rows[2].set(`each foot pushes ${fixedText(ld.F, 2)} N (${q.down} feet down)`, RING)
        rows[3].set(`worst knee ${nCm(R.worstKnee)} · hip ${nCm(R.worstHip)} · stall ${nCm(STALL)}`, R.verdict === 'ok' ? POWER : R.verdict === 'thin' ? HEAT : HIGH_V)
        sc.right.set(`${Math.round(R.share * 100)} % of stall`, R.verdict === 'ok' ? POWER : R.verdict === 'thin' ? HEAT : HIGH_V)

        status.set(`${LINK_NAMES[q.links]} · body ${mmText(q.h)} high · ${FEET[q.feet]}`, LABEL)
        sub.set(`left: front-left leg, side view, hip servo at the top · knees back · stepping the ${mmText(stride)} stride in trot, real time`, GREY)
        event.set(
          !R.reach ? 'leg cannot reach the ground inside its servo travel' : !R.fits ? `stride ${mmText(q.stride)} > ${mmText(R.maxStride)} reach: ${-R.reach[0] < R.reach[1] ? 'hip servo at its stop behind' : 'leg too short'}` : `knee load ${VERDICT[R.verdict]}`,
          !R.reach || !R.fits || R.verdict === 'weak' ? HIGH_V : R.verdict === 'thin' ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const q = lgParams(p)
        const R = lgCalc(q)
        return [
          { label: 'Stride the leg reaches', value: mmText(R.maxStride), tone: toneOf(R.fits, R.maxStride > 0) },
          { label: 'Standing servos hip · knee', value: `${deg(R.stand.hipDeg)} · ${deg(R.stand.kneeDeg)}`, tone: R.stand.fits ? 'ok' : 'bad' },
          { label: 'Worst knee torque', value: nmText(R.worstKnee, 3) },
          { label: 'Share of SG90 stall', value: `${Math.round(R.share * 100)} %`, tone: R.verdict === 'ok' ? 'ok' : R.verdict === 'thin' ? 'warn' : 'bad' },
        ]
      },
    }
  },
}

// --- Gait generator: phase table → foot paths → IK → 8 pulses at 50 Hz; loaded SG90s fall behind on fast cycles. ---

const GAIT_NAMES = Object.fromEntries(Object.entries(QUAD_GAITS).map(([k, v]) => [k, v.label])) as Record<QuadGait, string>
const ggParams = (p: Params) => ({ gait: pick(GAIT_NAMES, p.gait, 'shift') as QuadGait, stride: n(p, 'stride') / 1000, T: n(p, 'period') })
type GgQ = ReturnType<typeof ggParams>
const ggKey = (q: GgQ) => `${q.gait}|${q.stride}|${q.T}`
const ggRun = memoBy(ggKey, (q: GgQ) => quadGaitRun(q.gait, q.stride, q.T))
const GG = { at: [-5.6, -3.4, 0] as V3, k: 40, run: [-0.12, 0.12] as [number, number], sx: 9.4, sy: 1.2, sw: 8.6, sh: 3.4 }
const HIP_LO = 0
const HIP_HI = 90

export const quadrupedGaitGenerator: Lesson = {
  id: 'quadruped-gait-generator',
  title: 'Gait generator',
  tagline: 'A phase table, two foot paths and IK turn into eight servo pulses every 20 ms',
  formula: (p) => {
    const q = ggParams(p)
    const R = ggRun(q)
    const g = QUAD_GAITS[q.gait].gait
    return `leg i: phase = frac(t/T − lift_i) · swing if phase < 1 − β (β ${fixedText(g.duty, 2)}) · foot → IK → hip, knee → pulse, 50 Hz · SG90 ≤ ω_free(1 − τ/τ_stall) · v = stride / (β·T) = ${mmText(R.planned)}/s planned, ${mmText(R.speed)}/s walked`
  },
  legend: [
    { color: POWER, label: 'Foot on the ground (footprints)', shape: 'dot' },
    { color: B_FIELD, label: 'Support polygon (red: CoM on or past an edge)', shape: 'dot' },
    { color: RING, label: 'Hip command (scope) and centre of mass', shape: 'dot' },
    { color: HEAT, label: 'Hip servo, where it really is', shape: 'dot' },
  ],
  points: [
    'The gait generator is a small table and a clock: each leg has a lift-off phase (Mobility › Legged walking › Gait cycle); at time t, a leg whose phase is under 1 − β swings, the rest stand. Swinging feet follow a lifted arc forward, standing feet slide back in a straight line, both around the point under the hip. Every 20 ms the firmware solves the leg IK for all four feet (Leg geometry) and writes eight pulses to the PCA9685.',
    'Trot moves diagonal pairs together: fast and simple, but only two feet are ever down, so the CoM sits on the line between them and the robot balances dynamically. Creep lifts one leg at a time with three feet down. Without a coxa servo the body cannot lean sideways, and the CoM stays on the diagonal of the three feet: margin zero, it rocks at every step.',
    'An 8-servo walker can still shift its body fore and aft: before a front leg lifts, all standing feet push the body back, which moves the CoM off the diagonal into the triangle of the other three feet; before a hind leg lifts it shifts forward. That buys 1–1.5 cm of static margin on this frame (Mobility › Legged walking › Zero-moment point covers the dynamic case).',
    'Faster cycles need faster servos. An SG90 turns at most about 500°/s unloaded and slower the harder it pushes (Actuators › Servo › Inside a hobby servo), so in a short swing the hip lags its command: the foot lands short and low, the stride shrinks, and the creep shift no longer arrives in time. Watch the scope: the real hip angle trails the commanded one; lengthen T until it follows.',
  ],
  controls: [
    { kind: 'choice', key: 'gait', options: opts(GAIT_NAMES), initial: 'shift' },
    { kind: 'slider', key: 'stride', label: 'Stride', min: 20, max: 70, step: 5, initial: 40, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'period', label: 'Cycle time T', min: 0.3, max: 2, step: 0.1, initial: 1.2, format: (v) => `${v.toFixed(1)} s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const fv = floorView(scene, GG.at, GG.k, -1.1)
    floorMat(fv, [GG.run[0] - 0.12, GG.run[1] + 0.12], [-0.13, 0.13])
    const prints = pointCloud(fv, 120, 0.008)
    const poly = floorPolygon(fv, 4, B_FIELD)
    const edgeM = glowMat(B_FIELD, 0.9)
    const edges = Array.from({ length: 4 }, () => addRod(fv, edgeM))
    const com = pointCloud(fv, 2, 0.009)
    const plumb = addRod(fv, glowMat(RING, 0.8))
    const bot = servoWalker(fv, quadWalker(QUAD_KIT.height, 'kit'), { names: false, width: BODY_W })
    const hips = quadHips()

    const sc = titledScope(scene, GG.sy, GG.sh, 'LF hip servo, one cycle', RING, 0, GG.sx, GG.sw)
    const cmdTr = sc.s.trace(RING, { samples: 101, radius: 0.06 })
    const realTr = sc.s.trace(HEAT, { samples: 101, radius: 0.06 })
    const yA = plotY(HIP_LO, HIP_HI, GG.sh)
    sc.lo.set('hip servo 0 … 90°', GREY)
    addLabel(scene, 'Every 20 ms: hip · knee pulses', [GG.sx - GG.sw / 2, -2.2, 0.2], GREY, 0.26, 'left')
    const rows = textRows(scene, 4, GG.sx - GG.sw / 2, -2.9, 0.28, 0.6)
    const st = { key: '', t: 0, x: GG.run[0], prev: [] as boolean[], n: 0 }

    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = ggParams(p)
        const R = ggRun(q)
        const key = ggKey(q)
        if (key !== st.key) {
          Object.assign(st, { key, t: 0, x: GG.run[0], prev: [], n: 0 })
          prints.show(0)
          const u = R.frames.map((f) => (f.t - R.frames[0].t) / R.T)
          cmdTr.points(u, R.frames.map((f) => yA(quadServoDeg(f.cmd[0][0], 0)[0])), null)
          realTr.points(u, R.frames.map((f) => yA(quadServoDeg(f.q[0][0], 0)[0])), null)
          sc.hi.set(`T = ${fixedText(R.T, 1)} s`, GREY)
        }
        st.t += dt
        const k = Math.min(R.frames.length - 1, Math.floor(frac(st.t / R.T) * (R.frames.length - 1)))
        const fr = R.frames[k]
        st.x += R.speed * dt
        if (st.x > GG.run[1]) {
          Object.assign(st, { x: GG.run[0], prev: [], n: 0 })
          prints.show(0)
        }
        bot.body.position.z = QUAD_KIT.height
        bot.set({ x: st.x, y: 0, th: 0 }, fr.q.map(([hip, knee]) => ({ yaw: 0, hip, knee })), fr.down)
        const world = hips.map(([hx, hy], i) => [st.x + hx + fr.feet[i][0], hy] as [number, number])
        fr.down.forEach((d, i) => {
          if (d && st.prev[i] === false) {
            prints.set(st.n % 120, [world[i][0], world[i][1], 0.003], POWER, 0.8)
            st.n++
            prints.show(Math.min(120, st.n))
          }
          st.prev[i] = d
        })
        const down = world.filter((_, i) => fr.down[i])
        const hull = supportHull(down)
        const col = fr.margin > 0.003 ? B_FIELD : HIGH_V
        poly(hull, 0.004, col)
        edgeM.color.set(col)
        edgeM.emissive.set(col)
        edges.forEach((e, i) => {
          e.visible = i < hull.length && hull.length >= 2 && !(hull.length === 2 && i > 0)
          if (!e.visible) return
          const a = hull[i]
          const b = hull[(i + 1) % hull.length]
          stretchRod(e, [a[0], a[1], 0.005], [b[0], b[1], 0.005], 0.002)
        })
        const comC = fr.margin > 0.003 ? RING : HIGH_V
        com.set(0, [st.x, 0, 0.006], comC, 1)
        com.set(1, [st.x, 0, QUAD_KIT.height + 0.03], comC, 1.2)
        com.show(2)
        stretchRod(plumb, [st.x, 0, QUAD_KIT.height + 0.03], [st.x, 0, 0.006], 0.0016)

        const servo = (i: number, a: 0 | 1, src: [number, number][]) => quadServoDeg(src[i][0], src[i][1])[a]
        fr.cmd.forEach((_, i) => {
          const h = [servo(i, 0, fr.cmd), servo(i, 0, fr.q)]
          const kn = [servo(i, 1, fr.cmd), servo(i, 1, fr.q)]
          const lag = Math.max(Math.abs(h[0] - h[1]), Math.abs(kn[0] - kn[1]))
          const stop = h[0] < 0.5 || h[0] > 179.5
          rows[i].set(`${QUAD_KIT.names[i]} ${(fr.down[i] ? 'stand' : 'swing').padEnd(5)} ${us(h[0])} · ${us(kn[0])} · ${stop ? 'hip at its stop' : `lag ${deg(lag)}`}`, lag > 8 || stop ? HIGH_V : fr.down[i] ? LABEL : GREY)
        })
        sc.right.set(`lag ≤ ${deg(toDeg(R.lagMax))}`, toDeg(R.lagMax) > 8 ? HIGH_V : POWER)

        const nDown = fr.down.filter(Boolean).length
        status.set(`${GAIT_NAMES[q.gait]} · ${nDown} of 4 feet down · walked ${mmText(R.stride)} of ${mmText(q.stride)} per step`, LABEL)
        sub.set(`${fixedText(frac(st.t / R.T) * R.T, 1)} / ${fixedText(R.T, 1)} s cycle · ${mmText(R.speed)}/s · real time · SG90s at 5 V, ${fixedText(QUAD_KIT.massKg, 2)} kg robot`, GREY)
        event.set(
          R.lift < 0.01 ? `swing feet lift only ${mmText(R.lift)}: they scuff, servos too slow for this cycle` : R.minDown < 3 ? 'two feet down: the CoM is on their line, balance is dynamic' : R.margin < 0.003 ? `CoM ${mmText(Math.max(0, R.margin))} from the support edge: rocks at every step` : `CoM at least ${mmText(R.margin)} inside the support polygon`,
          R.lift < 0.01 ? HIGH_V : R.minDown < 3 || R.margin < 0.003 ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const R = ggRun(ggParams(p))
        const ratio = R.planned > 0 ? R.speed / R.planned : 0
        return [
          { label: 'Speed walked · planned', value: `${mmText(R.speed)}/s · ${mmText(R.planned)}/s`, tone: toneOf(ratio > 0.9, ratio > 0.7) },
          { label: 'Swing foot lift', value: mmText(R.lift), tone: toneOf(R.lift > 0.015, R.lift > 0.01) },
          { label: 'Worst servo lag', value: deg(toDeg(R.lagMax)), tone: toneOf(R.lagMax < (5 * Math.PI) / 180, R.lagMax < (12 * Math.PI) / 180) },
          { label: 'Static margin', value: R.minDown < 3 ? 'none: 2 feet' : mmText(Math.max(0, R.margin)), tone: R.minDown < 3 ? 'warn' : toneOf(R.margin > 0.008, R.margin > 0.003) },
        ]
      },
    }
  },
}
