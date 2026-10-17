import * as THREE from 'three/webgpu'
import { BELT_MOTOR, COUPLERS, COUPLING, CouplerKey, CouplerVerdict, GRIPS, GT2, GripKey, BeltVerdict, MIN_MESH, beltDrive, couplerView, equivOffsetMm } from '../../core/physics'
import { degText, fixedText, hertz, mmFixed, mpsText, newtonsText, nmText } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  MATERIAL_TINT,
  POWER,
  RING,
  WIDE_RIGHT,
  WIDE_VIEW,
  addLabel,
  addRod,
  beltLoop,
  countBars,
  couplerModel,
  forceArrow,
  glowDot,
  glowMat,
  liveLabel,
  memoBy,
  plotY,
  setGlow,
  shellMat,
  statusHeader,
  stretchRod,
  textRows,
  timingPulley,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'


// --- Timing belt: a 20T GT2 motor pulley driving a bigger output pulley; ratio, teeth in mesh, tension window, stretch. ---

const TB = { at: [-15.2, -1.9, 0] as V3, k: 0.15, z1: 20, tMax: 100, nmMax: 0.6, bars: [-12.4, -9.8, 0] as V3 }
const VERDICT_TB: Record<BeltVerdict, [string, string]> = {
  ok: ['holds: slack side still taut, teeth seated', POWER],
  slack: ['slack side gone loose: lost motion when the motor reverses, close to skipping', HEAT],
  skips: ['too loose: the pull lifts the belt over the teeth, it skips (lost steps)', HIGH_V],
  'few teeth': [`fewer than ${MIN_MESH} teeth in mesh on the small pulley: they shear or jump`, HIGH_V],
  tight: ['too tight: the hub load bends the motor shaft and wears its bearings', HEAT],
}
const tbRun = memoBy(
  (p: Params) => `${p.z2} ${p.centre} ${p.tension} ${p.torque}`,
  (p: Params) => {
    const D = beltDrive(TB.z1, n(p, 'z2'), n(p, 'centre'), n(p, 'tension'), n(p, 'torque'))
    const ts = Array.from({ length: 101 }, (_, i) => (i / 100) * TB.tMax)
    const tooTight = ts.find((t) => beltDrive(TB.z1, n(p, 'z2'), n(p, 'centre'), t, n(p, 'torque')).verdict === 'tight') ?? TB.tMax
    return { z2: n(p, 'z2'), C: n(p, 'centre'), T0: n(p, 'tension'), Tm: n(p, 'torque'), D, ts, tooTight }
  },
)

export const beltsChainsCouplersTimingBelt: Lesson = {
  id: 'belts-chains-couplers-timing-belt',
  title: 'Timing belt',
  tagline: 'Toothed belt between two pulleys: a gear ratio over a distance, if the tension is right',
  formula: (p) => {
    const { z2, T0, Tm, D } = tbRun(p)
    return `ratio = ${z2}T / ${TB.z1}T = ${fixedText(D.ratio, 2)} · belt speed v = ω·r = ${mpsText(D.beltMps)} at ${BELT_MOTOR.rpm} rpm · pull Fe = T/r = ${nmText(Tm)} / ${mmFixed(D.r1, 2)} = ${newtonsText(D.pull, 1)} · tight = T0 + Fe/2 = ${newtonsText(D.tight, 1)}, slack = T0 − Fe/2 = ${newtonsText(D.slack, 1)} · teeth jump above ≈ ${newtonsText(D.jumpN, 0)} (2.5·T0 or ${GT2.toothN} N per tooth in mesh, typical) · T0 ${newtonsText(T0, 0)}`
  },
  legend: [
    { color: '#d9d4c7', label: 'Every 10th belt tooth', shape: 'dot' },
    { color: FORCE, label: 'Belt tension, both spans', shape: 'dot' },
    { color: RING, label: 'This drive on the chart', shape: 'dot' },
    { color: HIGH_V, label: 'Skips or overloads', shape: 'dot' },
  ],
  points: [
    'A timing belt is a gear train with a long reach: the ratio is the tooth ratio, exactly as for gears (Gear trains › Gear ratio), and both pulleys see the same belt speed v = ω·r. A 20-tooth GT2 pulley (2 mm pitch) moves 40 mm of belt per turn. Unlike gears it spans 50–500 mm, runs quiet, needs no oil and has no gear backlash.',
    'The motor pulls one span tight and lets the other go slack: tight − slack = T/r. The installed tension keeps the slack side taut. Too loose and under torque the slack side goes limp, then the belt rides up over the teeth and skips (a stepper loses its place); too tight and the hub load bends the motor shaft and wears its bearings (Bearings › Ball bearings). Check by plucking the span: f = √(T/μ)/2L.',
    'Keep at least 6 teeth in mesh on the small pulley: a small pulley, a big ratio and short centres shrink the wrap angle. The belt is a stiff spring, not rigid: the glass-fibre cords stretch under the pull, so the output winds up a little before it moves, more for long spans. That springiness matters for 3D printers (3D printing › Printer motion).',
    'Chains do the same job for higher torque (bike, go-kart, big drive wheels): steel rollers on sprockets, strong and tolerant of dirt, but they need oil, stretch with wear, are noisy and have slack. For moving torque along a shaft line instead, use a coupler (Shaft couplers); for a rotary-to-linear drive, Linear actuators › Lead screw.',
  ],
  controls: [
    { kind: 'slider', key: 'z2', label: 'Output pulley', min: 20, max: 80, step: 4, initial: 60, format: (v) => `${v} teeth` },
    { kind: 'slider', key: 'centre', label: 'Centre distance', min: 50, max: 100, step: 5, initial: 80, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'tension', label: 'Belt tension', min: 4, max: TB.tMax, step: 1, initial: 20, format: (v) => `${v} N` },
    { kind: 'slider', key: 'torque', label: 'Motor torque', min: 0.05, max: 0.5, step: 0.01, initial: 0.2, format: (v) => nmText(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const k = TB.k
    const [x0, y0] = TB.at
    const motor = add(scene, new THREE.Group(), [x0, y0, -1.2])
    box(motor, [42 * k, 42 * k, 1.6], mat('#2b2d33', { rough: 0.55 }))
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) box(motor, [0.35, 0.35, 0.1], mat('#9aa1ab'), [sx * 15.5 * k, sy * 15.5 * k, 0.82])
    addLabel(scene, 'NEMA17', [x0, y0 - 21 * k - 0.6, 0.3], GREY, 0.26)
    const small = timingPulley(scene, TB.z1, k, [x0, y0, 0])
    addLabel(scene, `${TB.z1}T`, [x0, y0 + small.rp + 1.1, 0.6], LABEL, 0.26)
    const drive = add(scene, new THREE.Group())
    let built = ''
    let big: ReturnType<typeof timingPulley> | null = null
    let belt: ReturnType<typeof beltLoop> | null = null
    let flag: THREE.Object3D | null = null
    const bigTag = liveLabel(scene, [0, 0, 0.6], { size: 0.26 })
    const tightTag = liveLabel(scene, [0, 0, 0.6], { size: 0.26, color: FORCE })
    const slackTag = liveLabel(scene, [0, 0, 0.6], { size: 0.26, color: FORCE })
    const meshTag = liveLabel(scene, [x0 - small.rp - 0.6, y0 + 3.6, 0.6], { size: 0.26, align: 'left' })
    const st = { a: 0, travel: 0 }

    addLabel(scene, 'belt forces', [TB.bars[0] - 3.4, TB.bars[1] + 0.9, 0.3], LABEL, 0.28, 'left')
    const bars = countBars(scene, TB.bars, ['tight span', 'slack span', 'teeth jump at', 'motor hub'], 5.4, { row: 0.75, size: 0.26 })
    const P = WIDE_RIGHT
    const plot = titledScope(scene, P.y, P.h, 'motor torque before skipping', LABEL, 0, P.x, P.w)
    const py = plotY(0, TB.nmMax, P.h)
    const jump = plot.s.trace(HIGH_V, { samples: 101, radius: 0.06 })
    const torqueLine = plot.s.level(FORCE)
    const tightWall = addRod(plot.s.group, glowMat(HEAT, 0.8))
    const marker = glowDot(plot.s.group, 0.26, RING)
    addLabel(plot.s.group, 'skips', [plot.s.xAt(0.06), py(TB.nmMax * 0.85), 0.4], HIGH_V, 0.24, 'left')
    addLabel(plot.s.group, `${TB.nmMax} N·m`, [P.w / 2 - 0.2, P.h / 2 - 0.4, 0.4], GREY, 0.22, 'right')
    const tightTagP = liveLabel(plot.s.group, [0, 0, 0.4], { size: 0.22, color: HEAT, align: 'left' })
    const rows = textRows(scene, 4, 5.2, 3.4, 0.32, 0.75)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { z2, C, T0, Tm, D, ts, tooTight } = tbRun(p)
        const key = `${z2}|${C}`
        if (key !== built) {
          built = key
          drive.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
          drive.clear()
          big = timingPulley(drive, z2, k, [x0 + C * k, y0, 0])
          flag = box(big.group, [big.rp * 0.9, 0.3, 0.12], mat('#d23b3b', { rough: 0.5 }), [big.rp * 0.45, 0, 7 * k * 0.5 + 4.3 * k])
          belt = beltLoop(drive, D.r1, D.r2, C, k, [x0, y0, 0])
        }
        const skipping = D.verdict === 'skips'
        st.a += dt * 1.6
        st.travel += dt * 1.6 * D.r1 * (skipping ? 0.25 : 1)
        small.group.rotation.z = st.a
        big!.group.rotation.z = st.travel / D.r2
        flag!.visible = true
        const sag = 0.05 + 1.5 * Math.exp(-D.slack / 6)
        belt!.set(st.travel, sag)
        const xm = x0 + (C * k) / 2
        bigTag.group.position.set(x0 + C * k, y0 + D.r2 * k + 1.1, 0.6)
        bigTag.set(`${z2}T output`, LABEL)
        tightTag.group.position.set(xm, y0 + ((D.r1 + D.r2) / 2) * k + 0.75, 0.6)
        tightTag.set(`tight ${newtonsText(D.tight, 1)}`)
        slackTag.group.position.set(xm, y0 - ((D.r1 + D.r2) / 2) * k - sag - 0.75, 0.6)
        slackTag.set(`slack ${newtonsText(D.slack, 1)}`)
        meshTag.set(`${D.mesh} teeth in mesh`, D.mesh < MIN_MESH ? HIGH_V : LABEL)

        const vt = (v: number) => newtonsText(v, 0)
        bars.set(
          [D.tight, D.slack, D.jumpN, D.hubN],
          [vt(D.tight), vt(D.slack), vt(D.jumpN), vt(D.hubN)],
          [D.tight > GT2.workN ? HEAT : FORCE, D.slack <= 0 ? HEAT : FORCE, D.pull > D.jumpN ? HIGH_V : POWER, D.hubN > BELT_MOTOR.hubMaxN ? HEAT : GREY],
        )

        jump.points(ts.map((t) => t / TB.tMax), ts.map((t) => py(Math.min(TB.nmMax, D.jumpNmAt(t)))), null)
        torqueLine.set(py(Tm))
        const xw = plot.s.xAt(tooTight / TB.tMax)
        stretchRod(tightWall, [xw, -P.h / 2, 0.4], [xw, P.h / 2, 0.4], 0.05)
        tightWall.visible = tooTight < TB.tMax
        tightTagP.group.position.set(xw + 0.2, P.h / 2 - 1, 0.4)
        tightTagP.set(tooTight < TB.tMax ? 'too tight' : '')
        marker.position.set(plot.s.xAt(T0 / TB.tMax), py(Tm), 0.46)
        ;(marker.material as THREE.MeshStandardMaterial).emissive.set(VERDICT_TB[D.verdict][1])
        plot.lo.set('tension 0')
        plot.hi.set(`${TB.tMax} N`)
        plot.right.set(`motor ${nmText(Tm)}`, FORCE)

        rows[0].set(`ratio ${fixedText(D.ratio, 2)} : ${BELT_MOTOR.rpm} → ${fixedText(D.outRpm, 0)} rpm, ${nmText(D.outNm)} out`, LABEL)
        rows[1].set(`belt ${mpsText(D.beltMps)} · loop ${mmFixed(D.lengthMm, 0)} = ${Math.round(D.lengthMm / GT2.pitch)} teeth`, GREY)
        rows[2].set(`stretch ${mmFixed(D.stretchMm, 2)} → output winds up ${degText(D.windupDeg, 2)}`, D.windupDeg > 0.5 ? HEAT : LABEL)
        rows[3].set(`pluck the span: ≈ ${hertz(D.pluck)} (typical)`, GREY)
        head.status.set(`Timing belt · GT2 ${TB.z1}T → ${z2}T · ${mmFixed(C, 0)} · T0 ${newtonsText(T0, 0)} · ${nmText(Tm)}`)
        head.sub.set('6 mm GT2 belt, values typical; slack span sag exaggerated', GREY)
        head.event.set(...VERDICT_TB[D.verdict])
      },
      readouts: (p) => {
        const { D } = tbRun(p)
        return [
          { label: 'Ratio', value: fixedText(D.ratio, 2) },
          { label: 'Teeth in mesh', value: `${D.mesh}`, tone: toneOf(D.mesh >= MIN_MESH, false) },
          { label: 'Slack span', value: newtonsText(D.slack, 1), tone: toneOf(D.slack > 0, D.verdict !== 'skips') },
          { label: 'Motor hub load', value: newtonsText(D.hubN, 0), tone: toneOf(D.hubN <= BELT_MOTOR.hubMaxN, false) },
        ]
      },
    }
  },
}

// --- Shaft couplers: 5 mm motor shaft to an 8 mm lead screw; misalignment forces, set-screw grip, twist. ---

const SC = { k: 0.16, x0: -17, y0: -2.2, exag: 40, eMax: 0.4, fMax: 60, bars: [-10.6, -9.6, 0] as V3, rpm: 300 }
const GRIP_KEYS = Object.keys(GRIPS) as GripKey[]
const VERDICT_SC: Record<CouplerVerdict, [string, string]> = {
  ok: ['runs true: the coupler soaks up the misalignment', POWER],
  'over rated': ['past the coupler rating: it flexes too far each turn and fatigue-cracks', HEAT],
  bearing: ['the shafts are forced into line: big side load on the motor bearing, once per turn', HIGH_V],
  overload: ['torque above the coupler rating: it winds up and can crack', HIGH_V],
  slips: ['the hub slips on the shaft: the motor turns, the screw does not', HIGH_V],
}
const scRun = memoBy(
  (p: Params) => `${p.coupler} ${p.offset} ${p.angle} ${p.grip} ${p.torque}`,
  (p: Params) => {
    const ck = pick(COUPLERS, p.coupler, 'helical')
    const gk = pick(GRIPS, p.grip, 'dflat')
    return { ck, gk, e: n(p, 'offset'), ang: n(p, 'angle'), T: n(p, 'torque'), V: couplerView(ck, n(p, 'offset'), n(p, 'angle'), gk, n(p, 'torque')) }
  },
)

export const beltsChainsCouplersShaftCouplers: Lesson = {
  id: 'belts-chains-couplers-shaft-couplers',
  title: 'Shaft couplers',
  tagline: 'Joining a motor shaft to a lead screw: flexible beats rigid when the shafts never line up',
  formula: (p) => {
    const { e, ang, V } = scRun(p)
    return `misalignment ≈ offset + θ·L/2 = ${mmFixed(e, 2)} + ${degText(ang, 1)} · ${COUPLING.length / 2} mm = ${mmFixed(equivOffsetMm(e, ang), 2)} · side force = k·e = ${newtonsText(V.force, 1)} (coupler in series with shafts and mount) · motor shaft stress σ = F·L·c/I = ${fixedText(V.stressPa / 1e6, 0)} MPa, reversed every turn · hub grip ${nmText(V.grip)} (typical)`
  },
  legend: [
    { color: FORCE, label: 'Side force on the motor shaft', shape: 'dot' },
    { color: '#d23b3b', label: 'Elastomer spider', shape: 'dot' },
    { color: RING, label: 'This coupler on the chart', shape: 'dot' },
    { color: HIGH_V, label: 'Slips or overloads', shape: 'dot' },
  ],
  points: [
    'A coupler joins two shafts end to end, here a 5 mm stepper shaft to an 8 mm lead screw (Linear actuators › Lead screw). Rigid couplers are a solid sleeve: no play and very stiff in twist, but they demand perfect alignment. Flexible ones bend in the middle: a helical beam cut from one piece, or a jaw coupler with an elastomer spider between two claws.',
    'Real shafts never line up exactly: a printed motor mount puts them a few tenths of a mm apart (parallel offset) or at a small angle. A rigid coupler forces them into line, so the shafts bend and the motor bearing takes a big side load that swings round once per turn: noise, wear and wobble on the screw (Vibration › Motor vibration, Bearings › Ball bearings). A flexible coupler is a soft spring and takes it up with a few newtons.',
    'The hub holds the shaft with a set screw or a clamp. A set screw on a round shaft only grips by friction and slips under shock or reversals; tighten it onto a D-flat and it drives by shape. A clamp hub squeezes all round with a bigger screw. Thread locker keeps set screws in (Fasteners › Thread locker).',
    'Every coupler has a torque rating and allowed misalignment (typical small ones: helical beam ~0.25 mm and 3°, jaw ~0.1 mm and 1°). Flexible couplers also twist a little under torque, a small lag like belt stretch (Timing belt). Pick rigid only when both shafts sit in one accurately bored part; otherwise flexible.',
  ],
  controls: [
    { kind: 'choice', key: 'coupler', options: opts(namesOf(COUPLERS)), initial: 'helical' },
    { kind: 'slider', key: 'offset', label: 'Parallel offset', min: 0, max: SC.eMax, step: 0.01, initial: 0.1, format: (v) => `${v.toFixed(2)} mm` },
    { kind: 'slider', key: 'angle', label: 'Angle', min: 0, max: 3, step: 0.1, initial: 0.5, format: (v) => `${v.toFixed(1)}°` },
    { kind: 'choice', key: 'grip', options: opts(namesOf(GRIPS)), initial: 'dflat' },
    { kind: 'slider', key: 'torque', label: 'Peak torque', min: 0.05, max: 2, step: 0.05, initial: 0.3, format: (v) => nmText(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const k = SC.k
    const { x0, y0 } = SC
    const xF = x0 + 40 * k
    const xc = xF + 4 * k
    const xB = xc + COUPLING.length * k + COUPLING.screwL * k
    const xE = xB + 22 * k
    const motor = add(scene, new THREE.Group())
    box(motor, [40 * k, 42 * k, 2.4], mat('#3a3d45', { rough: 0.55 }), [x0 + 20 * k, 0, -0.6])
    box(motor, [1.6 * k, 22 * k, 22 * k], mat('#3a3d44', { rough: 0.5 }), [xF + 0.8 * k, 0, 0])
    addLabel(scene, 'NEMA17, 5 mm shaft', [x0 + 20 * k, y0 - 21 * k - 0.7, 0.3], GREY, 0.26)
    const steel = mat('#8f98a6', { metal: 0.6, rough: 0.35 })
    const screwM = mat('#b0a27a', { metal: 0.5, rough: 0.4 })
    const shaftSegs = Array.from({ length: 6 }, () => addRod(scene, steel))
    const screwSegs = Array.from({ length: 8 }, () => addRod(scene, screwM))
    const screwTail = addRod(scene, screwM)
    const block = add(scene, new THREE.Group())
    box(block, [9 * k, 30 * k, 1.6], shellMat(MATERIAL_TINT.plywood, 0.55, 0.6))
    addLabel(scene, 'bearing', [xB, y0 - 15 * k - 0.6, 0.3], GREY, 0.24)
    addLabel(scene, '8 mm lead screw', [xB + 1.1, y0 - 1.9, 0.3], GREY, 0.26, 'left')
    const cg = add(scene, new THREE.Group())
    let coupler: ReturnType<typeof couplerModel> | null = null
    let built = ''
    const arrow = forceArrow(scene, FORCE, { r: 0.12, size: 0.28 })
    const st = { spin: 0, hub: 0 }

    addLabel(scene, 'torque the hub holds', [SC.bars[0] - 4.6, SC.bars[1] + 0.9, 0.3], LABEL, 0.28, 'left')
    const bars = countBars(scene, SC.bars, [...GRIP_KEYS.map((g) => GRIPS[g].name), 'coupler rating'], 5, { row: 0.75, size: 0.26 })
    const demand = liveLabel(scene, [SC.bars[0] - 4.6, SC.bars[1] - 3.6, 0.3], { size: 0.28, align: 'left' })
    const P = WIDE_RIGHT
    const plot = titledScope(scene, P.y, P.h, 'side force vs offset', LABEL, 0, P.x, P.w)
    const py = plotY(0, SC.fMax, P.h)
    const CK = Object.keys(COUPLERS) as CouplerKey[]
    const curves = CK.map(() => plot.s.trace(GREY, { samples: 81, radius: 0.06 }))
    const limit = plot.s.level(HIGH_V)
    limit.set(py(BELT_MOTOR.radialN))
    addLabel(plot.s.group, `motor limit ${BELT_MOTOR.radialN} N`, [-P.w / 2 + 0.2, py(BELT_MOTOR.radialN) + 0.4, 0.4], HIGH_V, 0.22, 'left')
    addLabel(plot.s.group, `${SC.fMax} N`, [P.w / 2 - 0.2, P.h / 2 - 0.4, 0.4], GREY, 0.22, 'right')
    const marker = glowDot(plot.s.group, 0.26, RING)
    const tags = CK.map(() => liveLabel(plot.s.group, [0, 0, 0.4], { size: 0.22, align: 'right' }))
    const rows = textRows(scene, 4, 2.4, 3.4, 0.32, 0.75)
    const us = Array.from({ length: 81 }, (_, i) => i / 80)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { ck, gk, e, ang, T, V } = scRun(p)
        if (ck !== built) {
          built = ck
          cg.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
          cg.clear()
          coupler = couplerModel(cg, ck, k)
        }
        const E = equivOffsetMm(e, ang) * SC.exag * k
        const sh = V.shares
        const yMotor = y0 + sh.mount * E
        const yL = yMotor + sh.motor * E
        const yR = yL + sh.coupler * E
        const yS = y0 + E
        motor.position.y = yMotor
        const sCurve = (segs: THREE.Object3D[], xa: number, ya: number, xb: number, yb: number, r: number) =>
          segs.forEach((o, i) => {
            const at = (u: number): V3 => [xa + (xb - xa) * u, ya + (yb - ya) * (3 * u * u - 2 * u * u * u), 0]
            stretchRod(o, at(i / segs.length), at((i + 1) / segs.length), r)
          })
        sCurve(shaftSegs, xF, yMotor, xc + 3 * k, yL, 2.5 * k)
        sCurve(screwSegs, xc + (COUPLING.length - 3) * k, yR, xB, yS, 4 * k)
        stretchRod(screwTail, [xB, yS, 0], [xE, yS, 0], 4 * k)
        block.position.set(xB, yS, 0)

        const slips = V.verdict === 'slips'
        st.spin += dt * 2.4
        st.hub += dt * 2.4 * (slips ? 0.1 : 1)
        cg.position.set(xc, yL, 0)
        coupler!.set(st.hub, yR - yL)
        const len = Math.min(3, 0.5 + V.force / 15)
        const xa = (xF + xc) / 2
        const ya = (yMotor + yL) / 2 - 0.5
        arrow([xa, ya - len, 1.6], [xa, ya, 1.6], `F ${newtonsText(V.force, 1)}`, [0, -len - 1.2, 0])

        const g = V.grips
        bars.set([...g, V.c.ratedNm], [...g.map((t) => nmText(t)), nmText(V.c.ratedNm)], [...g.map((t) => (t >= T ? POWER : HIGH_V)), V.c.ratedNm >= T ? POWER : HIGH_V])
        GRIP_KEYS.forEach((key, j) => bars.rename(j, GRIPS[key].name, key === gk ? RING : GREY))
        demand.set(`peak torque ${nmText(T)} · twist ${degText(V.twistDeg, 2)}`, slips ? HIGH_V : LABEL)

        CK.forEach((c, j) => {
          const ys = us.map((u) => V.curves[j](u * SC.eMax))
          curves[j].points(us, ys.map((f) => py(Math.min(SC.fMax, f))), null)
          setGlow(curves[j].material, c === ck ? RING : GREY, c === ck ? 1.1 : 0.3)
          const i = ys.findIndex((f) => f > SC.fMax * 0.85)
          const uTag = i < 0 ? 0.97 : Math.max(0.12, us[i])
          tags[j].group.position.set(plot.s.xAt(uTag) - 0.1, py(Math.min(SC.fMax * 0.9, ys[Math.round(uTag * 80)])) + 0.55, 0.4)
          tags[j].set(COUPLERS[c].name, c === ck ? RING : GREY)
        })
        marker.position.set(plot.s.xAt(Math.min(1, e / SC.eMax)), py(Math.min(SC.fMax, V.force)), 0.46)
        ;(marker.material as THREE.MeshStandardMaterial).emissive.set(VERDICT_SC[V.verdict][1])
        plot.lo.set(`offset 0, angle ${degText(ang, 1)}`)
        plot.hi.set(`${SC.eMax} mm`)
        plot.right.set(newtonsText(V.force, 1), V.force > BELT_MOTOR.radialN ? HIGH_V : POWER)

        const c = V.c
        rows[0].set(`side force ${newtonsText(V.force, 1)} → front bearing ${newtonsText(V.bearing, 0)}`, V.force > BELT_MOTOR.radialN ? HIGH_V : LABEL)
        rows[1].set(`shaft bending ±${fixedText(V.stressPa / 1e6, 0)} MPa, ${SC.rpm} times a minute`, V.stressPa > 60e6 ? HEAT : GREY)
        rows[2].set(`${c.name} allows ${mmFixed(c.maxOffset, 2)}, ${degText(c.maxDeg, c.maxDeg < 1 ? 2 : 0)} (typical)`, V.overRated ? HEAT : GREY)
        rows[3].set(`taken up by: coupler ${Math.round(sh.coupler * 100)} %, shafts ${Math.round((sh.motor + sh.screw) * 100)} %, mount ${Math.round(sh.mount * 100)} %`, GREY)
        head.status.set(`Shaft couplers · ${c.name} · ${mmFixed(e, 2)} offset · ${degText(ang, 1)} · ${GRIPS[gk].name}`)
        head.sub.set(`5 mm motor shaft to 8 mm lead screw, misalignment drawn ×${SC.exag}`, GREY)
        head.event.set(...VERDICT_SC[V.verdict])
      },
      readouts: (p) => {
        const { T, V } = scRun(p)
        return [
          { label: 'Side force', value: newtonsText(V.force, 1), tone: toneOf(V.force <= BELT_MOTOR.radialN / 2, V.force <= BELT_MOTOR.radialN) },
          { label: 'Hub grip', value: nmText(V.grip), tone: toneOf(V.grip >= 1.5 * T, V.grip >= T) },
          { label: 'Shaft stress', value: `${fixedText(V.stressPa / 1e6, 0)} MPa` },
          { label: 'Twist', value: degText(V.twistDeg, 2) },
        ]
      },
    }
  },
}
