import * as THREE from 'three/webgpu'
import {
  DEG,
  FINISHES,
  Finish,
  OPTIC_MEDIA,
  OV2640,
  OpticMedium,
  apparentDepth,
  blurCircle,
  criticalDeg,
  detectorReturn,
  dofLimits,
  fresnelR,
  hyperfocal,
  magnification,
  scatterAt,
  snellDeg,
  thinLensV,
} from '../../core/physics'
import { cmText, degText, fixedText, lengthText, mmText, pct } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  IR_TINT,
  LABEL,
  POWER,
  RING,
  addLabel,
  addRod,
  beamCone,
  countBars,
  cursorBar,
  flatBox,
  glowMat,
  lightRay,
  liveLabel,
  memoBy,
  rayFan,
  setGlow,
  shellMat,
  sideView,
  statusHeader,
  stretchArrow,
  stretchRod,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, angleSlider, n, opts, pick } from '../types'

const VIEW = sideView(-2.2, -0.6)
const pctTenths = (f: number) => `${fixedText(f * 100, 1)} %`
const unit = (deg: number, side = 1): [number, number] => [side * Math.sin(deg * DEG), Math.cos(deg * DEG)]

/** A glowing straight ray a→b whose brightness follows `f` (≤ 0.02 hides it). */
function glowRay(parent: THREE.Object3D, color: string, r = 0.05) {
  const m = glowMat(color, 0.6)
  const o = addRod(parent, m)
  return (a: V3, b: V3, f: number, c = color) => {
    stretchRod(o, a, b, r)
    o.visible = o.visible && f > 0.02
    setGlow(m, c, f)
  }
}

/** Light emitter / detector block at `at` looking toward `to`. */
function aimedBlock(parent: THREE.Object3D, color: string) {
  const g = add(parent, new THREE.Group())
  box(g, [0.9, 1.4, 0.9], mat('#1b1c20', { rough: 0.6 }), [0, 0.7, 0])
  const m = glowMat(color, 0.6)
  cylinder(g, 0.3, 0.3, m, [0, -0.1, 0], 'y', 16)
  return {
    m,
    place(at: V3, to: V3) {
      g.position.set(...at)
      g.rotation.z = Math.atan2(to[1] - at[1], to[0] - at[0]) + Math.PI / 2
    },
  }
}

// --- Reflection: a ray fan off five finishes; a detector at an angle collects diffuse light plus any mirror glint. ---

const RF = { o: [-9, -6.8, 0.2] as V3, src: 9, det: 9, fan: 7.5, rays: 37, half: 8 }
const FINISH_LIST = Object.keys(FINISHES) as Finish[]
const FINISH_NAMES = Object.fromEntries(FINISH_LIST.map((k) => [k, FINISHES[k].name])) as Record<Finish, string>
const FINISH_LOOK: Record<Finish, { color: string; rough: number; metal: number }> = {
  mirror: { color: '#d8e0ea', rough: 0.05, metal: 1 },
  paper: { color: '#f2f0ea', rough: 1, metal: 0 },
  tile: { color: '#cfc8bd', rough: 0.15, metal: 0 },
  tape: { color: '#15161a', rough: 0.25, metal: 0 },
  card: { color: '#222326', rough: 1, metal: 0 },
}
const rfParams = (p: Params) => ({ f: pick(FINISHES, p.finish, 'tile') as Finish, th: n(p, 'inc'), at: n(p, 'det') })
type RfQ = ReturnType<typeof rfParams>
const rfRun = memoBy(
  (q: RfQ) => `${q.f}|${q.th}|${q.at}`,
  (q: RfQ) => {
    const all = Object.fromEntries(FINISH_LIST.map((k) => [k, detectorReturn(k, q.th, q.at, RF.half)])) as Record<Finish, ReturnType<typeof detectorReturn>>
    const fan = Array.from({ length: RF.rays }, (_, i) => {
      const phi = -85 + (170 * i) / (RF.rays - 1)
      const s = scatterAt(q.f, q.th, phi)
      return { phi, ...s }
    })
    return { ...q, all, me: all[q.f], fan, mirrorHit: Math.abs(q.at - q.th) <= RF.half }
  },
)
const fanLen = (I: number) => (RF.fan * I) / (I + 0.15)

export const lightOpticsReflection: Lesson = {
  id: 'light-optics-reflection',
  title: 'Reflection',
  tagline: 'Mirrors bounce, paper scatters; an IR sensor sees both',
  formula: (p) => {
    const R = rfRun(rfParams(p))
    return `law of reflection: θ_out = θ_in = ${R.th}° · ${FINISHES[R.f].name}: ${pct(FINISHES[R.f].diffuse)} scattered everywhere (∝ cos φ), ${pct(FINISHES[R.f].spec)} into the mirror lobe · detector at ${R.at}°: ${pctTenths(R.me.total)} of the beam, ${pct(R.me.glare)} of it glint`
  },
  legend: [
    { color: IR_TINT, label: 'IR beam in, and light scattered every way (diffuse)', shape: 'dot' },
    { color: RING, label: 'Mirror lobe: angle out = angle in (specular)', shape: 'dot' },
    { color: B_FIELD, label: 'Detector and its field of view', shape: 'dot' },
    { color: HIGH_V, label: 'Bar mostly glint, not surface colour', shape: 'dot' },
  ],
  points: [
    'Light hitting a smooth surface leaves at the same angle on the other side of the normal: angle out = angle in. A mirror sends nearly all of it that way (specular reflection); you see the source, not the surface.',
    'A rough or matte surface scatters light in every direction (diffuse), brightest straight up and fading as cos φ toward grazing. White paper scatters ~85 % of the IR, matte black card ~5 %: that difference is what every reflectance sensor reads (Sensors › Infrared › Obstacle sensor).',
    'Most real things do both. Glossy tile, varnished wood and black vinyl tape scatter a little and mirror a few per cent, all of it into a narrow lobe. Off that lobe they look as their colour says; inside it they glint.',
    'A TCRT5000 line sensor puts LED and phototransistor side by side a few mm above the floor, so the detector sits close to the mirror angle (Sensors › Infrared › Line follower). Over glossy black tape it catches the glint and reads grey, not black; a polished floor reads brighter than white paper. Matte tape, a slight tilt or a little more height moves the detector out of the lobe.',
    'Sound does the same off a flat panel (Sound & ultrasound › Echo ranging): a tilted wall throws the echo away from the sensor.',
  ],
  controls: [
    { kind: 'choice', key: 'finish', options: opts(FINISH_NAMES), initial: 'tile' },
    angleSlider('inc', 'Beam angle θ_in', 0, 75, 15),
    angleSlider('det', 'Detector angle', -75, 75, 15),
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const O = RF.o
    const slabM = mat(FINISH_LOOK.tape.color, { rough: 0.3 }, true)
    flatBox(scene, [14, 0.6, 3], slabM, [O[0], O[1] - 0.3, -0.6])
    const surfName = liveLabel(scene, [O[0], O[1] - 1.2, 0.3], { size: 0.3, color: GREY })
    const normal = addRod(scene, glowMat(GREY, 0.3))
    stretchRod(normal, O, [O[0], O[1] + 8.6, O[2]], 0.025)
    addLabel(scene, 'normal', [O[0], O[1] + 9, 0.3], GREY, 0.24)
    const led = aimedBlock(scene, IR_TINT)
    const det = aimedBlock(scene, B_FIELD)
    const cone = beamCone(scene, B_FIELD)
    const beamIn = lightRay(scene, 18, 0.14)
    const toDet = lightRay(scene, 10, 0.12)
    const diffFan = rayFan(scene, RF.rays, glowMat(IR_TINT, 0.7), 0.06)
    const specFan = rayFan(scene, RF.rays, glowMat(RING, 1.1), 0.08)
    const inTag = liveLabel(scene, [0, 0, 0.4], { size: 0.28, color: IR_TINT, align: 'right' })
    const detTags = (['left', 'right'] as const).map((align) => liveLabel(scene, [0, 0, 0.4], { size: 0.28, color: B_FIELD, align }))

    addLabel(scene, 'What the detector collects (share of the beam)', [0.4, 3.6, 0.3], LABEL, 0.3, 'left')
    const bars = countBars(scene, [4.4, 2.4, 0], FINISH_LIST.map((k) => FINISHES[k].name), 5, { row: 1, size: 0.3 })
    const verdict = [0, 1].map((i) => liveLabel(scene, [0.4, -3.2 - i * 0.7, 0.3], { size: 0.28, align: 'left' }))
    const st = { t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const R = rfRun(rfParams(p))
        st.t += dt
        const look = FINISH_LOOK[R.f]
        slabM.color.set(look.color)
        slabM.roughness = look.rough
        slabM.metalness = look.metal
        surfName.set(FINISHES[R.f].name, GREY)
        const at = (deg: number, r: number, side = 1): V3 => {
          const [x, y] = unit(deg, side)
          return [O[0] + x * r, O[1] + y * r, O[2]]
        }
        const S = at(R.th, RF.src, -1)
        led.place(S, O)
        beamIn([S, O], st.t, 1.2)
        const D = at(R.at, RF.det)
        det.place(D, O)
        cone(D, Math.atan2(O[1] - D[1], O[0] - D[0]), RF.half * DEG, RF.det * 0.95, 0.12)
        const lit = Math.min(1.6, R.me.total * 9)
        toDet([O, D], st.t, lit, R.me.glare > 0.5 ? RING : IR_TINT)
        setGlow(det.m, B_FIELD, 0.2 + lit)
        diffFan(R.fan.map((r) => [O, at(r.phi, fanLen(r.diffuse))] as [V3, V3]))
        specFan(R.fan.filter((r) => fanLen(r.diffuse + r.spec) - fanLen(r.diffuse) > 0.08).map((r) => [at(r.phi, fanLen(r.diffuse)), at(r.phi, fanLen(r.diffuse + r.spec))] as [V3, V3]))
        inTag.group.position.set(S[0] - 0.9, S[1] + 0.6, 0.4)
        inTag.set(`IR LED ${R.th}°`)
        detTags.forEach((t, i) => {
          t.group.position.set(D[0] + (i ? -0.9 : 0.9), D[1] + 0.6, 0.4)
          t.set((R.at >= 0) === !i ? `detector ${R.at}°` : '', B_FIELD)
        })

        const paper = R.all.paper.total
        const full = paper * 1.4
        bars.set(
          FINISH_LIST.map((k) => Math.min(full, R.all[k].total)),
          FINISH_LIST.map((k) => pctTenths(R.all[k].total)),
          FINISH_LIST.map((k) => (R.all[k].glare > 0.5 ? HIGH_V : k === R.f ? POWER : GREY)),
          full,
        )
        const tapeVsPaper = R.all.tape.total / paper
        verdict[0].set(`black tape reads ${pct(tapeVsPaper)} of white paper`, tapeVsPaper > 0.2 ? HIGH_V : POWER)
        verdict[1].set(R.all.tile.total > paper ? 'glossy tile reads brighter than white paper' : `glossy tile reads ${pct(R.all.tile.total / paper)} of white paper`, R.all.tile.total > paper ? HIGH_V : GREY)
        head.status.set(`Reflection · ${FINISHES[R.f].name} · beam ${R.th}°`, LABEL)
        head.event.set(R.mirrorHit ? (R.me.glare > 0.5 ? 'detector inside the mirror lobe: it sees glint' : 'detector at the mirror angle') : 'detector off the mirror angle: diffuse light only', R.mirrorHit ? RING : POWER)
        head.sub.set(`detector ±${RF.half}° field of view · bars clipped at 1.4× paper`)
      },
      readouts: (p) => {
        const R = rfRun(rfParams(p))
        const tapeVsPaper = R.all.tape.total / R.all.paper.total
        return [
          { label: 'Mirror angle', value: `${R.th}° (detector at ${R.at}°)` },
          { label: 'Detector collects', value: pctTenths(R.me.total) },
          { label: 'Of that, glint', value: pct(R.me.glare), tone: R.me.glare > 0.5 ? 'warn' : 'ok' },
          { label: 'Black tape ÷ white paper', value: pct(tapeVsPaper), tone: tapeVsPaper > 0.2 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Refraction: a laser crossing a boundary bends by Snell's law, part reflects (Fresnel), past the critical angle all of it does. ---

const RR = { o: [-9.5, -2.4, 0.3] as V3, r: 6.4, w: 15, h: 5.6 }
const PAIRS = {
  'air-water': 'Air → water',
  'air-acrylic': 'Air → acrylic',
  'water-air': 'Water → air',
  'acrylic-air': 'Acrylic → air',
  'glass-air': 'Glass → air',
} as const
type Pair = keyof typeof PAIRS
const MEDIUM_LOOK: Record<OpticMedium, { color: string; opacity: number }> = {
  air: { color: '#2a3440', opacity: 0.12 },
  water: { color: '#2f6fb8', opacity: 0.45 },
  acrylic: { color: '#bcd8e8', opacity: 0.3 },
  glass: { color: '#8fc8b0', opacity: 0.35 },
}
const LASER = HIGH_V
const rrParams = (p: Params) => {
  const pair = pick(PAIRS, p.pair, 'air-water') as Pair
  const [a, b] = pair.split('-') as [OpticMedium, OpticMedium]
  return { pair, a, b, th: n(p, 'angle') }
}
type RrQ = ReturnType<typeof rrParams>
const rrRun = memoBy(
  (q: RrQ) => `${q.pair}|${q.th}`,
  (q: RrQ) => {
    const [n1, n2] = [OPTIC_MEDIA[q.a].n, OPTIC_MEDIA[q.b].n]
    const t2 = snellDeg(n1, n2, q.th)
    const crit = criticalDeg(n1, n2)
    const curve = (fn: (deg: number) => number) => Array.from({ length: 91 }, (_, i) => fn(i))
    return {
      ...q,
      n1,
      n2,
      t2,
      R: fresnelR(n1, n2, q.th),
      crit,
      t2Curve: curve((d) => snellDeg(n1, n2, d) ?? NaN),
      rCurve: curve((d) => fresnelR(n1, n2, d)),
      seen: apparentDepth(0.1, n2 > n1 ? n2 : n1, n2 > n1 ? n1 : n2),
    }
  },
)

export const lightOpticsRefraction: Lesson = {
  id: 'light-optics-refraction',
  title: 'Refraction',
  tagline: 'Light slows in glass and water, so it bends; past a critical angle it can’t get out',
  formula: (p) => {
    const R = rrRun(rrParams(p))
    const lhs = `n₁·sin θ₁ = ${R.n1.toFixed(3)}·sin ${R.th}° = ${(R.n1 * Math.sin(R.th * DEG)).toFixed(3)}`
    return R.t2 === null
      ? `${lhs} > n₂ = ${R.n2.toFixed(3)}: no θ₂ exists, total internal reflection (critical angle asin(n₂/n₁) = ${degText(R.crit!)})`
      : `${lhs} = n₂·sin θ₂ → θ₂ = ${degText(R.t2)} · reflected R = ${pctTenths(R.R)} (Fresnel)${R.crit !== null ? ` · critical angle ${degText(R.crit)}` : ''}`
  },
  legend: [
    { color: LASER, label: 'Laser in, and the part that crosses (refracted)', shape: 'dot' },
    { color: RING, label: 'Part reflected at the boundary', shape: 'dot' },
    { color: B_FIELD, label: 'θ₂ against θ₁ (top) · reflected share (bottom)', shape: 'dot' },
    { color: HEAT, label: 'Critical angle', shape: 'dot' },
  ],
  points: [
    'Light is slower in matter: c/n, with n = 1.33 in water, 1.49 in acrylic, 1.52 in glass. A beam crossing at an angle has one edge slow down first, so it turns: n₁·sin θ₁ = n₂·sin θ₂ (Snell’s law). Into a denser medium it bends toward the normal; out of one, away from it.',
    'Some light always bounces off the boundary: ~4 % head-on for air/acrylic, rising toward 100 % at grazing angles (Fresnel). That is the glare on a camera’s cover window, and why sensor windows get anti-reflection coatings or sit flush.',
    'Going out of the denser medium, θ₂ reaches 90° at the critical angle asin(n₂/n₁): 42° for acrylic, 49° for water. Beyond it no light gets out: total internal reflection. Light pipes and optical fibres use it to carry an LED’s light round bends, and edge-lit acrylic glows only where it is scratched or engraved.',
    'Refraction also lies about depth: looking straight down into water, the bottom appears at real depth ÷ 1.33, three quarters as deep. A camera looking through a tank or a dome port sees distorted, shifted distances; calibrate through the window (Perception › Camera model › Calibration).',
    'Lenses are refraction put to work on purpose: curved surfaces bend every ray by just the right amount to meet at a point (Lenses and focus).',
  ],
  controls: [
    { kind: 'choice', key: 'pair', options: opts(PAIRS), initial: 'air-water' },
    { kind: 'slider', key: 'angle', label: 'Angle θ₁', min: 0, max: 85, step: 1, initial: 40, format: (v) => `${v}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const O = RR.o
    const block = (y: number) => {
      const m = shellMat('#2a3440', 0.2)
      box(scene, [RR.w, RR.h, 2], m, [O[0], y, -1.4]).castShadow = false
      return m
    }
    const topM = block(O[1] + RR.h / 2)
    const botM = block(O[1] - RR.h / 2)
    flatBox(scene, [RR.w, 0.06, 0.1], glowMat(GREY, 0.4), [O[0], O[1], 0])
    const normal = addRod(scene, glowMat(GREY, 0.3))
    stretchRod(normal, [O[0], O[1] - RR.h + 0.3, 0.1], [O[0], O[1] + RR.h - 0.3, 0.1], 0.025)
    const topName = liveLabel(scene, [O[0] + RR.w / 2 - 0.3, O[1] + 0.45, 0.3], { size: 0.3, align: 'right' })
    const botName = liveLabel(scene, [O[0] + RR.w / 2 - 0.3, O[1] - 0.8, 0.3], { size: 0.3, align: 'right' })
    const laser = add(scene, new THREE.Group())
    box(laser, [0.6, 2.2, 0.6], mat('#2a2c32', { rough: 0.4 }), [0, 1.1, 0])
    const rIn = glowRay(scene, LASER)
    const rOut = glowRay(scene, LASER)
    const rBack = glowRay(scene, RING)
    const beads = [lightRay(scene, 14, 0.13), lightRay(scene, 14, 0.13), lightRay(scene, 14, 0.13)]
    const t1Tag = liveLabel(scene, [0, 0, 0.4], { size: 0.3, color: LASER })
    const t2Tag = liveLabel(scene, [0, 0, 0.4], { size: 0.3, color: LASER })
    const event = liveLabel(scene, [O[0], O[1] - RR.h - 0.9, 0.3], { size: 0.3 })

    const top = titledScope(scene, 2.2, 4.2, 'θ2 vs θ1', B_FIELD)
    const t2Tr = top.s.trace(B_FIELD, { samples: 91, radius: 0.06 })
    const critTop = cursorBar(top.s, HEAT, 0.08)
    top.lo.set('0°')
    top.hi.set('90°')
    top.right.set('0…90°', GREY)
    const bot = titledScope(scene, -5.2, 4.2, 'reflected share R', RING)
    const rTr = bot.s.trace(RING, { samples: 91, radius: 0.06 })
    const critBot = cursorBar(bot.s, HEAT, 0.08)
    bot.lo.set('0°')
    bot.hi.set('90°')
    bot.right.set('0…100 %', GREY)
    const st = { t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const R = rrRun(rrParams(p))
        st.t += dt
        for (const [m, k] of [[topM, R.a], [botM, R.b]] as const) {
          m.color.set(MEDIUM_LOOK[k].color)
          m.opacity = MEDIUM_LOOK[k].opacity
        }
        topName.set(`${OPTIC_MEDIA[R.a].name} · n1 = ${R.n1.toFixed(2)}`, LABEL)
        botName.set(`${OPTIC_MEDIA[R.b].name} · n2 = ${R.n2.toFixed(2)}`, LABEL)
        const at = (deg: number, r: number, sx: number, sy: number): V3 => [O[0] + sx * Math.sin(deg * DEG) * r, O[1] + sy * Math.cos(deg * DEG) * r, O[2]]
        const S = at(R.th, RR.r, -1, 1)
        laser.position.set(...S)
        laser.rotation.z = Math.atan2(O[1] - S[1], O[0] - S[0]) + Math.PI / 2
        const back = at(R.th, RR.r, 1, 1)
        const out = R.t2 === null ? null : at(R.t2, RR.r, 1, -1)
        const fOut = 1.4 * (1 - R.R)
        const fBack = 1.4 * Math.max(R.R, 0.04)
        rIn(S, O, 1.4)
        rBack(O, back, fBack)
        if (out) rOut(O, out, fOut)
        else rOut(O, O, 0)
        beads[0]([S, O], st.t, 1.2, LASER)
        beads[1]([O, back], st.t, fBack, RING)
        beads[2](out ? [O, out] : [], st.t, fOut, LASER)
        t1Tag.group.position.set(...at(R.th / 2, 4, -1, 1))
        t1Tag.set(`θ1 ${R.th}°`)
        t2Tag.group.position.set(...(out ? at(R.t2! / 2, 4, 1, -1) : O))
        t2Tag.set(R.t2 !== null ? `θ2 ${degText(R.t2)}` : '')
        event.set(R.t2 === null ? 'total internal reflection: everything bounces back' : R.t2 > R.th + 0.5 ? 'bends away from the normal' : R.t2 < R.th - 0.5 ? 'bends toward the normal' : 'head-on: goes straight through', R.t2 === null ? HEAT : LABEL)

        const deg = (u: number) => u * 90
        const ok = R.t2Curve.flatMap((v, i) => (Number.isFinite(v) ? [i] : []))
        t2Tr.points(ok.map((i) => i / 90), ok.map((i) => -top.h / 2 + (R.t2Curve[i] / 90) * top.h))
        rTr.draw((u) => -bot.h / 2 + R.rCurve[Math.round(deg(u))] * bot.h, R.th / 90)
        critTop(R.crit === null ? null : R.crit / 90)
        critBot(R.crit === null ? null : R.crit / 90)
        top.right.set(R.crit === null ? 'no critical angle' : `critical ${degText(R.crit)}`, R.crit === null ? GREY : HEAT)

        head.status.set(`Refraction · ${PAIRS[R.pair]} · θ1 ${R.th}°`, LABEL)
        head.event.set(R.t2 === null ? `past ${degText(R.crit!)}: light pipe` : `θ2 ${degText(R.t2)} · ${pct(1 - R.R)} crosses`, R.t2 === null ? HEAT : POWER)
        head.sub.set(`n1 = ${R.n1.toFixed(3)} · n2 = ${R.n2.toFixed(3)} · light ${R.n1 > R.n2 ? 'leaving' : 'entering'} the denser medium`)
      },
      readouts: (p) => {
        const R = rrRun(rrParams(p))
        return [
          { label: 'Refracted θ₂', value: R.t2 === null ? 'none' : degText(R.t2), tone: R.t2 === null ? 'warn' : 'ok' },
          { label: 'Reflected · crosses', value: `${pctTenths(R.R)} · ${pctTenths(1 - R.R)}` },
          { label: 'Critical angle', value: R.crit === null ? '— (into denser)' : degText(R.crit) },
          { label: '10 cm deep, seen from air', value: cmText(R.seen) },
        ]
      },
    }
  },
}

// --- Lenses and focus: a thin convex lens images an arrow; slide the sensor to focus, stop down to widen the depth of field. ---

const LF = { f: 0.05, k: 85, lx: -2.5, ay: 1.5, hObj: 2, lensH: 1.3, uMin: 0.075, uMax: 0.2, c: 0.2e-3, blurMax: 2.5e-3 }
const STOPS = { '2': 'f/2', '2.8': 'f/2.8', '4': 'f/4', '8': 'f/8', '16': 'f/16' } as const
const CAM_N = 2
const CAM_C = 2 * OV2640.pixelUm * 1e-6
const lfParams = (p: Params) => ({ u: n(p, 'obj') / 1000, s: n(p, 'sensor') / 1000, N: Number(pick(STOPS, p.stop, '4')) })
type LfQ = ReturnType<typeof lfParams>
const lfRun = memoBy(
  (q: LfQ) => `${q.u}|${q.s}|${q.N}`,
  (q: LfQ) => {
    const v = thinLensV(LF.f, q.u)
    const uFocus = thinLensV(LF.f, q.s)
    return {
      ...q,
      v,
      m: magnification(LF.f, q.u),
      blur: blurCircle(LF.f, q.N, q.u, q.s),
      aperture: LF.f / q.N,
      uFocus,
      dof: dofLimits(LF.f, q.N, uFocus, LF.c),
      camH: hyperfocal(OV2640.focalMm / 1000, CAM_N, CAM_C),
    }
  },
)
const blurText = (m: number) => `${fixedText(m * 1000, 2)} mm`

export const lightOpticsLensesAndFocus: Lesson = {
  id: 'light-optics-lenses-and-focus',
  title: 'Lenses and focus',
  tagline: 'Every ray from a point meets again at one distance; put the sensor there',
  formula: (p) => {
    const R = lfRun(lfParams(p))
    return `1/f = 1/u + 1/v → v = f·u/(u − f) = 50·${Math.round(R.u * 1000)}/(${Math.round(R.u * 1000)} − 50) = ${mmText(R.v)} · m = −v/u = ${fixedText(R.m, 2)} · blur on the sensor at ${mmText(R.s)}: (f/N)·|s − v|/v = ${mmText(R.aperture)}·${mmText(Math.abs(R.s - R.v))}/${mmText(R.v)} = ${blurText(R.blur)}`
  },
  legend: [
    { color: RING, label: 'Light from the arrow tip through the open aperture', shape: 'dot' },
    { color: GREY, label: 'Construction rays: parallel → through F, through the centre', shape: 'dot' },
    { color: HIGH_V, label: 'Blur spot on the sensor (red: bigger than c)', shape: 'dot' },
    { color: B_FIELD, label: 'Blur vs object distance with the sensor fixed', shape: 'dot' },
  ],
  points: [
    'A convex lens is refraction shaped so every ray from one object point, wherever it crosses the lens, bends to meet at one image point (Refraction). Parallel rays meet at the focal point F, f behind the lens; rays through the centre go straight.',
    'Object distance u and image distance v obey 1/f = 1/u + 1/v. Far away (u → ∞) the image sits at f; closer objects image further back: at u = 2f, v = 2f and the image is the same size, upside down. The pinhole model is this lens with all rays but the central one ignored (Perception › Camera model › Pinhole model).',
    'Focusing means moving the sensor (or the lens) to v. Off it, the cone of light from a point is cut by the sensor in a disc, the blur circle: (f/N)·|s − v|/v. Below the size the eye or the algorithm cares about (c, here 0.2 mm; about 2 pixels on a camera) it still looks sharp; the range of distances where that holds is the depth of field.',
    'The aperture sets the cone’s width: f/N. Stop down from f/2 to f/8 and the blur shrinks 4×, so the depth of field grows, at the cost of 16× less light (Sensors › Camera › Exposure).',
    'Phone and ESP32-CAM lenses are tiny (f = 3.4 mm), so the image shifts only µm with distance. The ESP32-CAM lens is screwed to focus about 1 m away and left there: at f/2 everything from about half that distance to infinity is sharp. Lens distortion is a separate flaw (Sensors › Camera › Lens distortion).',
  ],
  controls: [
    { kind: 'slider', key: 'obj', label: 'Object distance u', min: 75, max: 200, step: 5, initial: 120, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'sensor', label: 'Sensor distance s', min: 60, max: 160, step: 1, initial: 100, format: (v) => `${v} mm` },
    { kind: 'choice', key: 'stop', options: opts(STOPS), initial: '4' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const { lx, ay, k } = LF
    const X = (m: number) => lx + m * k
    flatBox(scene, [32, 0.05, 0.05], glowMat(GREY, 0.25), [lx - 3, ay, -0.2])
    const lens = add(scene, mesh(new THREE.SphereGeometry(1, 32, 16), shellMat('#bfe3ff', 0.35)), [lx, ay, 0])
    lens.scale.set(0.28, LF.lensH, LF.lensH)
    lens.castShadow = false
    const irisM = mat('#16171b', { rough: 0.7 })
    const iris = [1, -1].map((sg) => ({ sg, o: box(scene, [0.12, 1, 1.4], irisM, [lx - 0.32, ay, 0]) }))
    for (const sg of [-1, 1]) {
      add(scene, mesh(new THREE.SphereGeometry(0.1, 10, 8), glowMat(LABEL, 0.6)), [X(sg * LF.f), ay, 0.2])
      addLabel(scene, sg < 0 ? 'F' : "F'", [X(sg * LF.f), ay - 0.55, 0.3], LABEL, 0.26)
    }
    const objArrow = stretchArrow(scene, POWER, 0.09)
    const imgArrow = stretchArrow(scene, GREY, 0.05)
    const sensor = box(scene, [0.25, 5.4, 1.6], mat('#2f3a33', { rough: 0.5 }), [0, ay, -0.2])
    const spotM = glowMat(HIGH_V, 1.2)
    const spot = box(scene, [0.12, 1, 1.7], spotM, [0, ay, 0])
    const construct = [glowRay(scene, GREY, 0.03), glowRay(scene, GREY, 0.03)]
    const cone = [0, 1, 2].map(() => ({ inRod: glowRay(scene, RING, 0.04), outRod: glowRay(scene, RING, 0.04), beads: lightRay(scene, 12, 0.11) }))
    const tags = {
      u: liveLabel(scene, [0, ay - 2.4, 0.3], { size: 0.28, color: POWER }),
      s: liveLabel(scene, [0, ay + 3.3, 0.3], { size: 0.28, color: LABEL }),
      spot: liveLabel(scene, [0, 0, 0.4], { size: 0.28, align: 'left' }),
    }
    const plot = titledScope(scene, -6.6, 3, 'blur spot vs object distance (sensor fixed)', B_FIELD, 0, -4, 24)
    const blurTr = plot.s.trace(B_FIELD, { samples: 120, radius: 0.06 })
    const cLine = plot.s.level(HEAT)
    cLine.set(-plot.h / 2 + (LF.c / LF.blurMax) * plot.h)
    plot.lo.set(mmText(LF.uMin))
    plot.hi.set(mmText(LF.uMax))
    const st = { t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const R = lfRun(lfParams(p))
        st.t += dt
        const P: V3 = [X(-R.u), ay + LF.hObj, 0.3]
        objArrow([X(-R.u), ay, 0.3], P)
        const I: V3 = [X(R.v), ay - LF.hObj * (R.v / R.u), 0.3]
        const ghost = R.v <= 0.17
        if (ghost) imgArrow([X(R.v), ay, 0.25], I)
        else imgArrow([0, 0, 0], [0, 0, 0])
        const sx = X(R.s)
        sensor.position.x = sx
        const halfA = (R.aperture / 2) * k
        for (const { sg, o } of iris) {
          const len = LF.lensH + 0.2 - halfA
          o.scale.y = Math.max(0.01, len)
          o.position.y = ay + sg * (halfA + len / 2)
        }
        const onSensor = (lensY: number): V3 => {
          const L: V3 = [lx, lensY, 0.3]
          const u = R.s / R.v
          return [sx, L[1] + (I[1] - L[1]) * u, 0.3]
        }
        const ys = [ay + halfA, ay, ay - halfA]
        ys.forEach((y, i) => {
          const L: V3 = [lx, y, 0.3]
          const E = onSensor(y)
          cone[i].inRod(P, L, 0.6)
          cone[i].outRod(L, E, 0.6)
          cone[i].beads([P, L, E], st.t, i === 1 ? 0.9 : 1.2, RING)
        })
        const tipAtLens: V3 = [lx, P[1], 0.3]
        construct[0](tipAtLens, I, 0.35)
        construct[1](P, I, 0.35)
        const [y0, y1] = [onSensor(ys[0])[1], onSensor(ys[2])[1]]
        const sharp = R.blur <= LF.c
        spot.position.set(sx + 0.1, (y0 + y1) / 2, 0)
        spot.scale.y = Math.max(0.12, Math.abs(y0 - y1))
        setGlow(spotM, sharp ? POWER : HIGH_V, 1.2)
        tags.u.group.position.x = (X(-R.u) + lx) / 2
        tags.u.set(`u = ${mmText(R.u)}`)
        tags.s.group.position.x = sx
        tags.s.set(`sensor s = ${mmText(R.s)}`)
        tags.spot.group.position.set(sx + 0.5, Math.min(y0, y1) - 0.5, 0.4)
        tags.spot.set(`blur ${blurText(R.blur)}`, sharp ? POWER : HIGH_V)

        const yB = (b: number) => -plot.h / 2 + (Math.min(b, LF.blurMax) / LF.blurMax) * plot.h
        const uAt = (x: number) => LF.uMin + x * (LF.uMax - LF.uMin)
        blurTr.draw((x) => yB(blurCircle(LF.f, R.N, uAt(x), R.s)), (R.u - LF.uMin) / (LF.uMax - LF.uMin))
        const far = R.dof.far === Infinity ? '∞' : mmText(R.dof.far)
        plot.right.set(R.uFocus > 0 ? `sharp ${mmText(R.dof.near)} … ${far} (c ${blurText(LF.c)})` : '', HEAT)

        head.status.set(`Lenses and focus · f = 50 mm · f/${R.N}`, LABEL)
        head.event.set(sharp ? `in focus: image at ${mmText(R.v)}` : `out of focus: image at ${mmText(R.v)}, sensor ${R.s > R.v ? 'too far' : 'too close'}`, sharp ? POWER : HIGH_V)
        head.sub.set(`focused on ${lengthText(R.uFocus)} · image ${fixedText(Math.abs(R.m), 2)}× size, upside down`)
      },
      readouts: (p) => {
        const R = lfRun(lfParams(p))
        return [
          { label: 'Image at v', value: mmText(R.v) },
          { label: 'Blur spot', value: blurText(R.blur), tone: R.blur <= LF.c ? 'ok' : 'warn' },
          { label: 'Depth of field', value: `${mmText(R.dof.near)} … ${R.dof.far === Infinity ? '∞' : mmText(R.dof.far)}` },
          { label: 'ESP32-CAM sharp from', value: `${lengthText(R.camH / 2)} to ∞` },
        ]
      },
    }
  },
}
