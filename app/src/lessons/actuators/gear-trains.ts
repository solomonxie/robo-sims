import * as THREE from 'three/webgpu'
import {
  DEG,
  PLANET_PATHS,
  PlanetHeld,
  TrainGear,
  WORM,
  backlashStep,
  backlashTrace,
  centerDistanceMm,
  circularPitchMm,
  deadZoneMotorDeg,
  meshCount,
  meshTurn,
  pitchDiameterMm,
  pitchLineMmS,
  planetaryRatio,
  planetaryTurns,
  preloadDragNm,
  ringTeeth,
  ringTurn,
  splitGearGap,
  swingPeakNm,
  tipErrorMm,
  trainEfficiency,
  trainRatio,
  trainSpeeds,
  weightN,
  wrapPi,
  wormBackEfficiency,
  wormEfficiency,
  wormFrictionAngle,
  wormInputNm,
  wormLeadAngle,
  wormRatio,
  wormSelfLocking,
} from '../../core/physics'
import { add, box, cylinder, mat, rod, STEEL } from '../../models/kit'
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
  arrow,
  cursorBar,
  emptyGroup,
  frac,
  glowMat,
  leadScrew,
  liveLabel,
  ringGear,
  scope,
  shellMat,
  spurGear,
  ticks,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const num = (x: number) => (Math.abs(x - Math.round(x)) < 1e-9 ? `${Math.round(x)}` : x.toFixed(x < 10 ? 2 : 1))
const pct = (f: number) => `${Math.round(f * 100)} %`
const mNm = (nm: number) => `${(nm * 1000).toFixed(0)} mN·m`
const plastic = () => mat('#f1efe6', { rough: 0.55 })
const brass = () => mat('#d9b24a', { metal: 0.35, rough: 0.4 })
const torus = (parent: THREE.Object3D, r: number, color: string, at: [number, number, number], tube = 0.05) => {
  const m = add(parent, new THREE.Mesh(new THREE.TorusGeometry(r, tube, 6, Math.max(48, Math.round(r * 24))), glowMat(color, 1)), at)
  m.castShadow = false
  return m
}

// --- Gear ratio: pitch circles roll together, so speed ∝ 1/teeth; idlers flip direction, compound stages multiply. ---

const TRAINS = { pair: 'Pair', idler: 'With idler', compound: 'Compound' }
const MODS = { m05: 'Module 0.5', m1: 'Module 1', m15: 'Module 1.5' }
const MOD_MM = { m05: 0.5, m1: 1, m15: 1.5 }
const IN_RPM = 300
const IN_NM = 0.02
const MESH_EFF = 0.95
const IDLER = 15
const GR = { k: 0.22, w: 1.2, y: 0.8, rps: 0.25, fitW: 26, fitH: 13.5 }
const SLOW = IN_RPM / 60 / GR.rps
const ratioParams = (p: Params) => {
  const train = pick(TRAINS, p.train, 'pair')
  const z = n(p, 'teeth')
  const mod = MOD_MM[pick(MODS, p.mod, 'm1')]
  const gears: TrainGear[] =
    train === 'pair' ? [{ teeth: 10 }, { teeth: z }] : train === 'idler' ? [{ teeth: 10 }, { teeth: IDLER }, { teeth: z }] : [{ teeth: 10 }, { teeth: z }, { teeth: 10, shaft: true }, { teeth: 30 }]
  const speeds = trainSpeeds(gears)
  const N = trainRatio(gears)
  const eff = trainEfficiency(gears, MESH_EFF)
  const torques = gears.map((_, i) => IN_NM * Math.abs(1 / speeds[i]) * trainEfficiency(gears.slice(0, i + 1), MESH_EFF))
  return { train, z, mod, gears, speeds, N, eff, torques }
}
type RatioQ = ReturnType<typeof ratioParams>
const sense = (N: number) => (N > 0 ? 'same way' : 'reversed')

export const gearRatioLesson: Lesson = {
  id: 'gear-trains-gear-ratio',
  title: 'Gear ratio',
  tagline: 'Count the teeth to trade speed for torque',
  formula: (p) => {
    const q = ratioParams(p)
    const v = pitchLineMmS(q.mod, 10, IN_RPM).toFixed(0)
    const ratio =
      q.train === 'pair' ? `N = ${q.z}/10 = ${num(Math.abs(q.N))}` : q.train === 'idler' ? `N = (${IDLER}/10)·(${q.z}/${IDLER}) = ${q.z}/10 = ${num(q.N)}, idler cancels` : `N = (${q.z}/10)·(30/10) = ${num(q.z / 10)} × 3 = ${num(q.N)}`
    return `${ratio} · d = m·z, a = m(z₁+z₂)/2 = ${num(centerDistanceMm(q.mod, 10, q.gears[1].teeth))} mm · pitch-line v = π·d·n = ${v} mm/s on both · T_out = ${mNm(IN_NM)}·${num(Math.abs(q.N))}·${q.eff.toFixed(2)} = ${mNm(q.torques[q.torques.length - 1])}`
  },
  legend: [
    { color: RING, label: 'Pitch circles: roll, no slip', shape: 'dot' },
    { color: B_FIELD, label: 'Pitch point: same speed v', shape: 'dot' },
    { color: POWER, label: 'Turns the motor\'s way', shape: 'dot' },
    { color: HIGH_V, label: 'Turns the other way', shape: 'dot' },
  ],
  points: [
    'Every gear has a pitch circle, d = m·z: the module m (mm of diameter per tooth) times the tooth count. Two meshing gears share a module, sit d₁/2 + d₂/2 apart, and their pitch circles roll on each other without slipping.',
    'Rolling means the same surface speed at the pitch point: π·d₁·n₁ = π·d₂·n₂, so n₂ = n₁·z₁/z₂. A 10-tooth pinion turns a 40-tooth gear 4× slower and, power in ≈ power out, with 4× the torque, less 2–5 % per mesh. On a robot that is the TT 1:48 gearmotor: see DC motor › Gearboxes.',
    'Each mesh flips the direction. An idler between two gears flips it back, and its own teeth cancel: (15/10)·(40/15) = 40/10. Use one to bridge a gap or to get the output turning the motor\'s way.',
    'Compound: a small gear keyed to a big one\'s shaft starts the next stage, and stage ratios multiply. 4 × 3 = 12 with nothing bigger than 40 teeth; one pair would need a 120-tooth gear. Keep stages around 1:3–1:6.',
    'Module changes the size, not the ratio: module 1.5 has 3× the tooth of module 0.5, far stronger but 3× the diameter. Servos use ~0.3–0.5, robot drivetrains 1–1.5. Below ~13 teeth a 20° involute tooth gets undercut and weak.',
  ],
  controls: [
    { kind: 'choice', key: 'train', options: opts(TRAINS), initial: 'pair' },
    { kind: 'slider', key: 'teeth', label: 'Driven gear', min: 20, max: 60, step: 10, initial: 40, format: (v) => `${v} teeth` },
    { kind: 'choice', key: 'mod', options: opts(MODS), initial: 'm1' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const holder = add(scene, new THREE.Group())
    const status = liveLabel(scene, [-13, 8.8, 0.4], { size: 0.46, align: 'left' })
    const foot = liveLabel(scene, [0, -8.6, 0.4], { size: 0.32, color: GREY })
    let pivots: THREE.Group[] = []
    const st = { key: '', angle: 0 }

    const rebuild = (q: RatioQ) => {
      emptyGroup(holder)
      const K = GR.k
      const r = (i: number) => (pitchDiameterMm(q.mod, q.gears[i].teeth) * K) / 2
      const xs: number[] = []
      const zs: number[] = []
      q.gears.forEach((g, i) => {
        xs.push(i === 0 ? 0 : g.shaft ? xs[i - 1] : xs[i - 1] + centerDistanceMm(q.mod, q.gears[i - 1].teeth, g.teeth) * K)
        zs.push(i === 0 ? 0 : g.shaft ? zs[i - 1] + GR.w : zs[i - 1])
      })
      const left = xs[0] - r(0)
      const right = Math.max(...xs.map((x, i) => x + r(i)))
      const dx = -(left + right) / 2
      const y = 0
      const rAll = Math.max(...q.gears.map((_, i) => r(i)))
      const s = Math.min(1, GR.fitW / (right - left), GR.fitH / (2 * rAll + 3.6))
      holder.scale.setScalar(s)
      holder.position.y = GR.y
      foot.set(`motor ${IN_RPM} rpm, ${mNm(IN_NM)} · shown ${num(SLOW)}× slower${s < 1 ? ` · drawn at ${pct(s)}` : ''}`)
      const yl = -rAll - 1
      const red = mat('#d23b3b', { rough: 0.5 })
      pivots = q.gears.map((g, i) => {
        const x = xs[i] + dx
        const pv = add(holder, new THREE.Group(), [x, y, zs[i]])
        spurGear(pv, g.teeth, q.mod * K, GR.w, i === 0 || g.shaft ? brass() : plastic())
        box(pv, [Math.max(0.2, r(i) * 0.25), 0.25, 0.1], red, [r(i) * 0.62, 0, GR.w / 2 + 0.05]).castShadow = false
        torus(holder, r(i), RING, [x, y, zs[i] + GR.w / 2 + 0.08])
        if (i > 0 && !g.shaft) {
          const dot = add(holder, new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), glowMat(B_FIELD, 1.3)), [xs[i - 1] + dx + r(i - 1), y, zs[i] + GR.w / 2 + 0.15])
          dot.castShadow = false
        }
        return pv
      })
      const shafts = [...new Set(xs)]
      const lx: number[] = []
      shafts.forEach((sx, k) => lx.push(k === 0 ? sx + dx : Math.max(sx + dx, lx[k - 1] + 4.4)))
      const lShift = (shafts[shafts.length - 1] + dx - lx[lx.length - 1]) / 2
      shafts.forEach((sx, k) => {
        const idx = q.gears.map((_, i) => i).filter((i) => xs[i] === sx)
        const last = idx[idx.length - 1]
        const rmax = Math.max(...idx.map(r))
        const x = sx + dx
        rod(holder, [x, y, -GR.w], [x, y, zs[last] + GR.w / 2 + 0.6], 0.12, STEEL())
        const w = q.speeds[last]
        const c = w > 0 ? POWER : HIGH_V
        arrow(holder, [x, y + rmax + 0.9, zs[last] + 0.6], [w > 0 ? -1 : 1, 0, 0], c, 0.4)
        const teeth = idx.map((i) => q.gears[i].teeth).join(' + ')
        const role = k === 0 ? 'motor' : q.train === 'idler' && k === 1 ? 'idler' : k === shafts.length - 1 ? 'output' : 'stage'
        const tx = lx[k] + lShift
        addLabel(holder, `${role} · ${teeth} t`, [tx, yl, 0.6], LABEL, 0.32)
        addLabel(holder, `${num(IN_RPM * Math.abs(w))} rpm`, [tx, yl - 0.8, 0.6], c, 0.32)
        addLabel(holder, mNm(q.torques[last]), [tx, yl - 1.5, 0.6], HEAT, 0.3)
        addLabel(holder, `Ø ${idx.map((i) => num(pitchDiameterMm(q.mod, q.gears[i].teeth))).join(' + ')} mm`, [tx, yl - 2.2, 0.6], GREY, 0.28)
      })
      cylinder(holder, Math.max(0.9, r(0) * 1.2), 3, mat('#c9ccd1', { metal: 0.45, rough: 0.35 }), [xs[0] + dx, y, -2.4], 'z', 32)
    }

    return {
      scene,
      view: { center: [0, 0.2, 0], radius: 46, polar: 1.42, azimuth: 0.12 },
      frame(dt, p) {
        const q = ratioParams(p)
        const key = `${q.train}|${q.z}|${q.mod}`
        if (key !== st.key) {
          st.key = key
          rebuild(q)
          status.set(`${num(Math.abs(q.N))} : 1, output turns ${sense(q.N)}`, q.N > 0 ? POWER : HIGH_V)
        }
        st.angle += dt * 2 * Math.PI * GR.rps
        const th: number[] = []
        q.gears.forEach((g, i) => th.push(i === 0 ? st.angle : g.shaft ? th[i - 1] : meshTurn(th[i - 1], q.gears[i - 1].teeth, g.teeth, 0)))
        pivots.forEach((pv, i) => (pv.rotation.z = th[i]))
      },
      readouts: (p) => {
        const q = ratioParams(p)
        return [
          { label: 'Ratio', value: `${num(Math.abs(q.N))} : 1 (${meshCount(q.gears)} mesh${meshCount(q.gears) > 1 ? 'es' : ''})` },
          { label: 'Output', value: `${num(IN_RPM / Math.abs(q.N))} rpm, ${sense(q.N)}`, tone: q.N > 0 ? 'ok' : undefined },
          { label: 'Torque', value: `${mNm(q.torques[q.torques.length - 1])} (η ${pct(q.eff)})` },
          { label: 'Tooth pitch', value: `p = π·m = ${circularPitchMm(q.mod).toFixed(2)} mm` },
        ]
      },
    }
  },
}

// --- Backlash: the tooth gap is a dead zone at every reversal; at the end of an arm it is millimetres. ---

const FIXES = { none: 'Plain gears', split: 'Anti-backlash split gear' }
const BK = { zp: 12, zg: 36, mod: 0.36, w: 1.2, gx: -6, gy: 0, armL: 9, armMm: 250, amp: 30, period: 4, springNm: 0.05, sx: 10, sw: 10, samples: 240 }
const BK_N = BK.zg / BK.zp
const ZOOM = { x: -14.2, y: 6, k: 3, w: 4.4, h: 8 }
const SERVO_N = 300
const cmdAt = (t: number) => BK.amp * Math.sin((2 * Math.PI * t) / BK.period)
const backParams = (p: Params) => {
  const gap = n(p, 'gap')
  const fix = pick(FIXES, p.fix, 'none')
  const kg = n(p, 'payload')
  const loadNm = swingPeakNm(kg, BK.armMm / 1000, BK.amp, BK.period)
  const eff = fix === 'split' ? splitGearGap(gap, BK.springNm, loadNm) : gap
  return { gap, fix, kg, loadNm, eff, drag: fix === 'split' ? preloadDragNm(BK.springNm) : 0 }
}
type BackQ = ReturnType<typeof backParams>

export const backlash: Lesson = {
  id: 'gear-trains-backlash',
  title: 'Backlash',
  tagline: 'The play between teeth when you reverse',
  formula: (p) => {
    const q = backParams(p)
    const split = q.fix === 'split' ? ` · spring ${BK.springNm} N·m ${q.eff === 0 ? '≥' : '<'} I·Aω² = ${q.loadNm.toFixed(2)} N·m → gap ${q.eff === 0 ? 'shut' : 'back'}` : ''
    return `dead zone at the motor = gap × N = ${num(q.eff)}° × ${BK_N} = ${num(deadZoneMotorDeg(q.eff, BK_N))}° · tip error = L·θ = ${BK.armMm} mm × ${num(q.eff / 2)}° = ±${tipErrorMm(BK.armMm, q.eff / 2).toFixed(1)} mm${split}`
  },
  legend: [
    { color: LABEL, label: 'Commanded angle (ghost arm)', shape: 'dot' },
    { color: POWER, label: 'Actual joint angle', shape: 'dot' },
    { color: HIGH_V, label: 'Crossing the gap · tip error', shape: 'dot' },
    { color: RING, label: 'Spring-loaded half', shape: 'dot' },
  ],
  points: [
    'Teeth are cut a little thinner than the gaps between them so heat, dirt and machining errors can\'t jam the mesh. That play is backlash. Driving one way, one pair of flanks touches; reverse, and the input swings through the gap before the other flank is hit. Until then the output doesn\'t move: a dead zone.',
    'It is quoted at the output, in degrees or arcminutes. Through the reduction the motor has to turn gap × N before anything happens: 2° behind a 300:1 servo gearbox is 600° of motor shaft, nearly two turns of nothing.',
    'At the end of an arm the angle becomes distance: error = L·θ, so ±1° on a 250 mm link is ±4.4 mm at the gripper. Worse, a motor-side encoder can\'t see it, and a position loop can hunt back and forth inside the gap.',
    'A split (scissor) gear is two thin halves sprung apart so they pinch the mating tooth from both sides: zero play while the spring out-pulls the load torque. Swing a heavier payload faster than the spring can hold and the gap is back. The preload also adds friction.',
    'Other fixes: let gravity or a spring bias the joint so one flank always carries load, measure at the joint with an output encoder, or use near-zero-backlash strain-wave (harmonic) and cycloidal drives, the norm in robot arms.',
  ],
  controls: [
    { kind: 'slider', key: 'gap', label: 'Backlash', min: 0, max: 4, step: 0.5, initial: 2, format: (v) => `${v}°` },
    { kind: 'choice', key: 'fix', options: opts(FIXES), initial: 'none' },
    { kind: 'slider', key: 'payload', label: 'Payload', min: 0, max: 1, step: 0.1, initial: 0.3, format: (v) => `${v.toFixed(1)} kg` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const rp = (BK.mod * BK.zp) / 2
    const rg = (BK.mod * BK.zg) / 2
    const px = BK.gx - rp - rg
    const gears = add(scene, new THREE.Group())
    let pinion = new THREE.Group()
    let halves: THREE.Group[] = []
    cylinder(scene, 1.8, 3, mat('#c9ccd1', { metal: 0.45, rough: 0.35 }), [px, BK.gy, -2.4], 'z', 32)
    rod(scene, [px, BK.gy, -1], [px, BK.gy, BK.w / 2 + 0.4], 0.14, STEEL())
    addLabel(scene, `motor pinion ${BK.zp} t`, [px, BK.gy - rp - 1.4, 0.5], LABEL, 0.32)
    addLabel(scene, `joint gear ${BK.zg} t (${BK_N}:1)`, [BK.gx, BK.gy - rg - 1.2, 0.5], LABEL, 0.32)
    const halfTag = liveLabel(scene, [BK.gx, BK.gy - rg - 2, 0.5], { size: 0.3, color: RING })
    const pitchDot = add(scene, new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), glowMat(B_FIELD, 1.3)), [px + rp, BK.gy, BK.w / 2 + 0.3])
    pitchDot.castShadow = false

    const armZ = BK.w / 2 + 0.5
    const arm = add(scene, new THREE.Group(), [BK.gx, BK.gy, armZ])
    const ghost = add(scene, new THREE.Group(), [BK.gx, BK.gy, armZ + 0.5])
    const link = mat('#4a78c2', { rough: 0.45 })
    box(arm, [BK.armL, 0.8, 0.4], link, [BK.armL / 2, 0, 0])
    cylinder(arm, 0.8, 0.6, link, [0, 0, 0], 'z', 24)
    for (const s of [-1, 1]) box(arm, [1.1, 0.25, 0.4], STEEL(), [BK.armL + 0.4, s * 0.45, 0])
    const ghostMat = shellMat('#dfe9f5', 0.22)
    box(ghost, [BK.armL + 1, 0.5, 0.1], ghostMat, [(BK.armL + 1) / 2, 0, 0]).castShadow = false
    const tipTag = liveLabel(scene, [0, 0, 0.6], { size: 0.34 })
    const status = liveLabel(scene, [-10, 9.6, 0.4], { size: 0.42 })
    const zoom = add(scene, new THREE.Group(), [ZOOM.x, ZOOM.y, 0.6])
    zoom.rotation.z = -Math.PI / 2
    box(zoom, [ZOOM.w + 0.3, ZOOM.h + 0.3, 0.2], mat('#0b1013', { rough: 0.6 }), [0, 0, -0.4]).castShadow = false
    const root = 0.6 * BK.mod * ZOOM.k + 0.4
    box(zoom, [0.8, ZOOM.h, 0.3], brass(), [-root, 0, 0]).castShadow = false
    box(zoom, [0.8, ZOOM.h, 0.3], plastic(), [root, 0, 0]).castShadow = false
    addLabel(scene, `the mesh, ×${ZOOM.k}`, [ZOOM.x, ZOOM.y - ZOOM.w / 2 - 0.6, 0.6], GREY, 0.3)
    const zPitch = add(zoom, new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), glowMat(B_FIELD, 1.3)), [0, 0, 0.3])
    zPitch.castShadow = false
    let zTeeth: THREE.InstancedMesh[] = []
    const zm = new THREE.Matrix4()
    const zq = new THREE.Quaternion()
    const zv = new THREE.Vector3()
    const zAxis = new THREE.Vector3(0, 0, 1)
    const one = new THREE.Vector3(1, 1, 1)
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
    const place = (im: THREE.InstancedMesh, cx: number, r: number, z: number, th: number, dir: number, zOff: number) => {
      let k = 0
      for (let i = 0; i < z && k < 4; i++) {
        const a = th + (2 * Math.PI * i) / z
        const rel = wrapPi(a - dir)
        if (Math.cos(rel) < 0 || Math.abs(r * Math.sin(rel)) > ZOOM.h / 2 - 0.4) continue
        im.setMatrixAt(k++, zm.compose(zv.set(cx + r * Math.cos(a), r * Math.sin(a), zOff), zq.setFromAxisAngle(zAxis, a), one))
      }
      for (; k < 4; k++) im.setMatrixAt(k, hidden)
      im.instanceMatrix.needsUpdate = true
    }

    const angPlot = scope(scene, BK.sw, 4.4, { divs: [8, 4] })
    angPlot.group.position.set(BK.sx, 3, 0)
    const yA = (deg: number) => (deg / 80) * angPlot.height
    const tCmd = angPlot.trace(LABEL, { samples: BK.samples, radius: 0.05 })
    const tOut = angPlot.trace(POWER, { samples: BK.samples, radius: 0.07 })
    ticks(angPlot, [], [[0, '-40'], [0.5, '0'], [1, '40']], 0.3)
    addLabel(scene, `joint angle, ° · one ${BK.period} s swing`, [BK.sx, 0.2, 0.3], GREY, 0.3)
    const errPlot = scope(scene, BK.sw, 3, { divs: [8, 2] })
    errPlot.group.position.set(BK.sx, -3.6, 0)
    const yE = (mm: number) => (mm / 20) * errPlot.height
    const tErr = errPlot.trace(HIGH_V, { samples: BK.samples, radius: 0.07 })
    ticks(errPlot, [], [[0, '-10'], [0.5, '0'], [1, '10']], 0.3)
    addLabel(scene, `gripper error, mm · ${BK.armMm} mm arm`, [BK.sx, -5.9, 0.3], GREY, 0.3)
    const cursors = [cursorBar(angPlot, GREY, 0.06), cursorBar(errPlot, GREY, 0.06)]

    const rebuild = (q: BackQ) => {
      emptyGroup(gears)
      const thick = Math.max(0.06, (Math.PI * BK.mod - q.gap * DEG * rg) / 2)
      pinion = add(gears, new THREE.Group(), [px, BK.gy, 0])
      spurGear(pinion, BK.zp, BK.mod, BK.w, brass(), thick)
      const split = q.fix === 'split'
      halves = (split ? [0.25, -0.25] : [0]).map((z, k) => {
        const h = add(gears, new THREE.Group(), [BK.gx, BK.gy, z * BK.w])
        spurGear(h, BK.zg, BK.mod, split ? BK.w / 2 : BK.w, k === 1 ? mat(RING, { metal: 0.35, rough: 0.4 }) : plastic(), thick)
        return h
      })
      halfTag.set(split ? (q.eff > 0 ? 'load out-pulls the spring: halves pushed together' : 'gold half sprung against the white one') : '')
      for (const im of zTeeth) {
        zoom.remove(im)
        im.geometry.dispose()
      }
      const geo = new THREE.BoxGeometry(1.6 * BK.mod * ZOOM.k, thick * ZOOM.k, 0.3)
      zTeeth = [brass(), plastic(), mat(RING, { metal: 0.35, rough: 0.4 })].map((m) => {
        const im = new THREE.InstancedMesh(geo, m, 4)
        im.frustumCulled = false
        im.castShadow = false
        zoom.add(im)
        return im
      })
      zTeeth[2].visible = split
      const S = BK.samples
      const ins = Array.from({ length: 2 * S }, (_, i) => cmdAt((i / S) * BK.period))
      const outs = backlashTrace(ins, q.eff, 0).slice(S)
      const at = (u: number) => Math.min(S - 1, Math.round(u * (S - 1)))
      tCmd.draw((u) => yA(cmdAt(u * BK.period)), null)
      tOut.draw((u) => yA(outs[at(u)]), null)
      tErr.draw((u) => yE(tipErrorMm(BK.armMm, outs[at(u)] - ins[S + at(u)])), null)
    }

    const st = { key: '', t: 0, out: 0 }
    return {
      scene,
      view: { center: [-1, 0.6, 0], radius: 62, polar: 1.48, azimuth: 0.06 },
      frame(dt, p) {
        const q = backParams(p)
        const key = `${q.gap}|${q.fix}|${q.kg}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          st.out = 0
          rebuild(q)
        }
        st.t += dt
        const cmd = cmdAt(st.t)
        st.out = backlashStep(st.out, cmd, q.eff)
        const thP = -BK_N * cmd * DEG
        pinion.rotation.z = thP
        const base = meshTurn(thP, BK.zp, BK.zg, 0)
        const actual = base + (st.out - cmd) * DEG
        if (halves.length === 2 && q.eff === 0) {
          halves[0].rotation.z = base + (q.gap / 2) * DEG
          halves[1].rotation.z = base - (q.gap / 2) * DEG
        } else for (const h of halves) h.rotation.z = actual
        const zrp = rp * ZOOM.k
        const zrg = rg * ZOOM.k
        place(zTeeth[0], -zrp, zrp, BK.zp, thP, 0, 0)
        halves.forEach((h, k) => place(zTeeth[k + 1], zrg, zrg, BK.zg, h.rotation.z, Math.PI, k ? -0.15 : 0.15))
        arm.rotation.z = st.out * DEG
        ghost.rotation.z = cmd * DEG
        const errMm = tipErrorMm(BK.armMm, st.out - cmd)
        const tipA = st.out * DEG
        tipTag.group.position.set(BK.gx + (BK.armL + 2.2) * Math.cos(tipA), BK.gy + (BK.armL + 2.2) * Math.sin(tipA) + 0.9, armZ + 0.4)
        const floating = q.eff > 0 && Math.abs(Math.abs(st.out - cmd) - q.eff / 2) > 1e-6
        tipTag.set(`${errMm >= 0 ? '+' : '−'}${Math.abs(errMm).toFixed(1)} mm`, Math.abs(errMm) < 0.05 ? POWER : HIGH_V)
        status.set(floating ? 'reversing: crossing the gap, arm stalls' : q.eff === 0 && q.gap > 0 ? 'spring keeps both flanks in contact' : 'teeth in contact: driving', floating ? HIGH_V : POWER)
        const u = frac(st.t / BK.period)
        for (const c of cursors) c(u)
      },
      readouts: (p) => {
        const q = backParams(p)
        const rows = [
          { label: 'Motor dead zone', value: `${num(deadZoneMotorDeg(q.eff, BK_N))}° (${SERVO_N}:1: ${num(deadZoneMotorDeg(q.eff, SERVO_N))}°)` },
          { label: 'Gripper error', value: `±${tipErrorMm(BK.armMm, q.eff / 2).toFixed(1)} mm`, tone: q.eff === 0 ? ('ok' as const) : q.eff > 1 ? ('bad' as const) : ('warn' as const) },
        ]
        if (q.fix === 'split')
          rows.push(
            { label: 'Spring vs load', value: `${BK.springNm} vs ${q.loadNm.toFixed(2)} N·m`, tone: q.eff === 0 ? 'ok' : 'bad' },
            { label: 'Preload drag', value: `+${mNm(q.drag)}` },
          )
        else rows.push({ label: 'Swing torque', value: `${q.loadNm.toFixed(2)} N·m peak` })
        return rows
      },
    }
  },
}

// --- Planetary gears: sun, planets, ring and carrier; hold one, drive one, the third is the output. ---

const HELD = { ring: 'Ring held', carrier: 'Carrier held', sun: 'Sun held' }
const PL = { rp: 5.6, w: 1.2, cx: -7.4, cy: 0.6, vis: 1.6, sx: 7.4, planets: 3, spurW: 10 }
const PL_RPM = 300
const planetParams = (p: Params) => {
  const held = pick(HELD, p.held, 'ring') as PlanetHeld
  const S = n(p, 'sun')
  const P = n(p, 'planet')
  const R = ringTeeth(S, P)
  const N = planetaryRatio(S, R, held)
  const spur = held === 'ring' ? [S, S + R] : held === 'carrier' ? [S, R] : [R, R + S]
  return { held, S, P, R, N, spur, ...PLANET_PATHS[held] }
}
type PlanetQ = ReturnType<typeof planetParams>
const ROLE_COLOR = (q: PlanetQ, m: string) => (m === q.input ? POWER : m === q.output ? RING : GREY)
const roleText = (q: PlanetQ, m: string) => (m === q.input ? `input, ${PL_RPM} rpm` : m === q.output ? `output, ${num(Math.abs(PL_RPM / q.N))} rpm${q.N < 0 ? ', reversed' : ''}` : 'held')

export const planetaryGears: Lesson = {
  id: 'gear-trains-planetary-gears',
  title: 'Planetary gears',
  tagline: 'Big reduction in a small, coaxial package',
  formula: (p) => {
    const q = planetParams(p)
    const f = q.held === 'ring' ? `1 + R/S = 1 + ${q.R}/${q.S}` : q.held === 'carrier' ? `−R/S = −${q.R}/${q.S}` : `1 + S/R = 1 + ${q.S}/${q.R}`
    return `R = S + 2P = ${q.S} + 2×${q.P} = ${q.R} · ω_s − ω_c = −(R/S)(ω_r − ω_c) · ${q.held} held: N = ${f} = ${num(q.N)} · 2 stages: ${num(q.N * q.N)}`
  },
  legend: [
    { color: POWER, label: 'Input member', shape: 'dot' },
    { color: RING, label: 'Output member', shape: 'dot' },
    { color: GREY, label: 'Held member', shape: 'dot' },
  ],
  points: [
    'A sun gear in the middle, planets meshing round it on a carrier, and a ring with teeth on the inside around them all. The planets bridge the gap, so R = S + 2P, and equally spaced planets only fit when (S + R) / planets is whole.',
    'Hold one member, drive another, take the output from the third. Ring held, sun in, carrier out: N = 1 + R/S, the usual gearmotor stage (3:1 to 10:1). Willis\' equation covers every case: ω_s − ω_c = −(R/S)(ω_r − ω_c).',
    'Hold the carrier instead and the planets are just idlers: the ring turns backward at S/R of the sun. Hold the sun and drive the ring: the carrier creeps out at 1 + S/R, barely a reduction. Car automatic gearboxes switch ratios by braking different members.',
    'Why robots love it: input and output on one axis, and the load is shared by three planet meshes, so a planetary carries far more torque than a spur pair of the same size. Stages stack in one tube: 5:1 × 5:1 = 25:1 in a NEMA17 gearhead, metal-gear servos and robot-dog leg actuators.',
    'Each stage adds a little backlash (precision ones 3–15 arcmin) and ~3 % loss. A single spur pair for the same ratio needs a gear as big as S + R teeth and offsets the output shaft, shown at right.',
  ],
  controls: [
    { kind: 'choice', key: 'held', options: opts(HELD), initial: 'ring' },
    { kind: 'slider', key: 'sun', label: 'Sun', min: 12, max: 24, step: 6, initial: 12, format: (v) => `${v} teeth` },
    { kind: 'slider', key: 'planet', label: 'Planets', min: 12, max: 24, step: 6, initial: 18, format: (v) => `${v} teeth` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const holder = add(scene, new THREE.Group())
    const tint = (m: THREE.MeshStandardMaterial, color: string) => {
      m.emissive.set(color === GREY ? '#000000' : color)
      m.emissiveIntensity = color === GREY ? 0 : 0.35
    }
    let parts = { sun: new THREE.Group(), ring: new THREE.Group(), carrier: new THREE.Group(), planets: [] as THREE.Group[], spur: [] as THREE.Group[], a: 0, sp: [0, 0] }
    const tags = ['sun', 'ring', 'carrier'].map((_, k) => liveLabel(scene, [PL.sx - 5, 7.2 - k * 1.1, 0.4], { size: 0.36, align: 'left' }))
    const planetTag = liveLabel(scene, [PL.sx - 5, 7.2 - 3 * 1.1, 0.4], { size: 0.32, align: 'left', color: GREY })
    const heldTag = liveLabel(scene, [PL.cx, PL.cy - PL.rp - 2.4, 0.5], { size: 0.36, color: GREY })
    const spurTag = liveLabel(scene, [PL.sx - 2, -8.2, 0.4], { size: 0.3, color: GREY })
    const status = liveLabel(scene, [PL.cx, 9.2, 0.4], { size: 0.44 })

    const rebuild = (q: PlanetQ) => {
      emptyGroup(holder)
      const mod = (2 * PL.rp) / q.R
      const a = (mod * (q.S + q.P)) / 2
      const steel = STEEL()
      const mk = (m: string) => {
        const material = mat(m === 'ring' ? '#9aa1ab' : m === 'sun' ? '#d9b24a' : '#5d636c', { metal: 0.4, rough: 0.4 }, true)
        tint(material, ROLE_COLOR(q, m))
        return material
      }
      const sun = add(holder, new THREE.Group(), [PL.cx, PL.cy, 0])
      spurGear(sun, q.S, mod, PL.w, mk('sun'))
      rod(holder, [PL.cx, PL.cy, -PL.w / 2], [PL.cx, PL.cy, -3.4], 0.3, steel)
      cylinder(holder, 1.6, 2.4, mat('#c9ccd1', { metal: 0.45, rough: 0.35 }), [PL.cx, PL.cy, -4.6], 'z', 32)
      const ring = add(holder, new THREE.Group(), [PL.cx, PL.cy, 0])
      ringGear(ring, q.R, mod, PL.w, mk('ring'), 1.1)
      box(ring, [0.6, 0.6, PL.w], mat('#d23b3b', { rough: 0.5 }), [PL.rp + 1.1, 0, 0])
      const planetMat = mat('#f1efe6', { rough: 0.55 })
      const planets = Array.from({ length: PL.planets }, () => {
        const g = add(holder, new THREE.Group())
        spurGear(g, q.P, mod, PL.w, planetMat)
        box(g, [mod * q.P * 0.25, 0.22, 0.1], mat('#d23b3b', { rough: 0.5 }), [mod * q.P * 0.3, 0, PL.w / 2 + 0.05]).castShadow = false
        return g
      })
      const carrier = add(holder, new THREE.Group(), [PL.cx, PL.cy, PL.w / 2 + 0.35])
      const cm = mk('carrier')
      for (let k = 0; k < PL.planets; k++) {
        const ang = (2 * Math.PI * k) / PL.planets
        rod(carrier, [0, 0, 0], [a * Math.cos(ang), a * Math.sin(ang), 0], 0.32, cm)
        cylinder(carrier, 0.36, 0.7, cm, [a * Math.cos(ang), a * Math.sin(ang), -0.2], 'z', 16)
      }
      cylinder(carrier, 1, 0.5, cm, [0, 0, 0], 'z', 24)
      rod(carrier, [0, 0, 0], [0, 0, 2.2], 0.28, steel)
      box(carrier, [0.9, 0.3, 0.12], mat('#d23b3b', { rough: 0.5 }), [0.5, 0, 2.2]).castShadow = false

      const [z1, z2] = q.spur
      const sc = Math.min(0.5, PL.spurW / (mod * (z1 + z2)))
      const ms = mod * sc
      const r1 = (ms * z1) / 2
      const r2 = (ms * z2) / 2
      const x1 = PL.sx - r2
      const ghost = shellMat('#dfe9f5', 0.3)
      const spur = [add(holder, new THREE.Group(), [x1, -3.8, 0]), add(holder, new THREE.Group(), [x1 + r1 + r2, -3.8, 0])]
      spurGear(spur[0], z1, ms, 0.6, ghost)
      spurGear(spur[1], z2, ms, 0.6, ghost)
      parts = { sun, ring, carrier, planets, spur, a, sp: [z1, z2] }
      spurTag.set(`one spur pair, ${z1} t → ${z2} t, same ratio: ${num(z2 / q.R)}× the ring, drawn at ${pct(sc)}`)
      const names = { sun: `sun ${q.S} t`, ring: `ring ${q.R} t`, carrier: 'carrier' }
      ;(['sun', 'ring', 'carrier'] as const).forEach((m, k) => tags[k].set(`${names[m]} · ${roleText(q, m)}`, ROLE_COLOR(q, m)))
      planetTag.set(`${PL.planets} planets ${q.P} t share the torque`)
      heldTag.set(q.held === 'ring' ? 'ring held by the housing' : q.held === 'carrier' ? 'carrier pinned to the housing' : 'sun locked')
      status.set(`${num(Math.abs(q.N))} : 1${q.N < 0 ? ', output reversed' : ''}`, q.N < 0 ? HIGH_V : POWER)
    }

    const st = { key: '', inp: 0 }
    return {
      scene,
      view: { center: [-0.6, 0, 0], radius: 50, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const q = planetParams(p)
        const key = `${q.held}|${q.S}|${q.P}`
        if (key !== st.key) {
          st.key = key
          rebuild(q)
        }
        st.inp += dt * PL.vis
        const t = planetaryTurns(q.S, q.R, q.held, st.inp)
        parts.sun.rotation.z = t.sun
        parts.carrier.rotation.z = t.carrier
        let th0 = 0
        parts.planets.forEach((g, k) => {
          const al = t.carrier + (2 * Math.PI * k) / PL.planets
          g.position.set(PL.cx + parts.a * Math.cos(al), PL.cy + parts.a * Math.sin(al), 0)
          g.rotation.z = meshTurn(t.sun, q.S, q.P, al)
          if (k === 0) th0 = g.rotation.z
        })
        parts.ring.rotation.z = ringTurn(th0, q.P, q.R, t.carrier)
        const s0 = q.held === 'sun' ? t.ring : t.sun
        parts.spur[0].rotation.z = s0
        parts.spur[1].rotation.z = meshTurn(s0, parts.sp[0], parts.sp[1], 0)
      },
      readouts: (p) => {
        const q = planetParams(p)
        return [
          { label: 'Ratio', value: `${num(Math.abs(q.N))} : 1, ${q.input} → ${q.output}` },
          { label: 'Output', value: `${num(Math.abs(PL_RPM / q.N))} rpm${q.N < 0 ? ', reversed' : ''}`, tone: q.N < 0 ? 'warn' : 'ok' },
          { label: 'Torque', value: `×${num(Math.abs(q.N))} over ${PL.planets} meshes` },
          { label: 'Two stages', value: `${num(q.N * q.N)} : 1, same Ø` },
        ]
      },
    }
  },
}

// --- Worm drive: one tooth per worm turn, high ratio at right angles; low lead angle locks against back-driving. ---

const STARTS = { s1: '1-start worm', s2: '2-start', s4: '4-start' }
const START_N = { s1: 1, s2: 2, s4: 4 }
const DRUM_MM = 20
const WD = { mw: 0.2, cx: -8, cy: -0.6, len: 8, drum: 1, lift: 3, bottom: -6, liftS: 4, cycle: 9, sx: 7.4, sw: 10 }
const wormParams = (p: Params) => {
  const starts = START_N[pick(STARTS, p.starts, 's1')]
  const z = n(p, 'teeth')
  const kg = n(p, 'load')
  const lead = wormLeadAngle(starts)
  const fric = wormFrictionAngle()
  const eff = wormEfficiency(lead, fric)
  const back = wormBackEfficiency(lead, fric)
  const ratio = wormRatio(z, starts)
  const wheelNm = weightN(kg) * (DRUM_MM / 1000)
  return { starts, z, kg, lead, fric, eff, back, ratio, locks: wormSelfLocking(lead, fric), wheelNm, motorNm: wormInputNm(wheelNm, ratio, eff) }
}
type WormQ = ReturnType<typeof wormParams>

export const wormDrive: Lesson = {
  id: 'gear-trains-worm-drive',
  title: 'Worm drive',
  tagline: 'High ratio that holds its load with the power off',
  formula: (p) => {
    const q = wormParams(p)
    return `N = Z/starts = ${q.z}/${q.starts} = ${num(q.ratio)} · tan λ = starts/q = ${q.starts}/${WORM.q} → λ = ${(q.lead / DEG).toFixed(1)}°, φ = atan(μ/cos 20°) = ${(q.fric / DEG).toFixed(1)}° · η = tan λ / tan(λ+φ) = ${pct(q.eff)} · η_back = tan(λ−φ)/tan λ = ${pct(q.back)} · T_worm = ${q.wheelNm.toFixed(2)} N·m / (${num(q.ratio)}·${q.eff.toFixed(2)}) = ${mNm(q.motorNm)}`
  },
  legend: [
    { color: POWER, label: 'Efficiency worm → wheel', shape: 'dot' },
    { color: HEAT, label: 'Efficiency wheel → worm (back-drive)', shape: 'dot' },
    { color: RING, label: 'Friction angle φ: locks left of it', shape: 'dot' },
  ],
  points: [
    'A worm is a screw meshing with a gear at right angles. Each turn of a single-start worm advances the wheel one tooth, so N = wheel teeth / starts: 40:1 in one stage, where spur gears need three.',
    'The teeth slide rather than roll, like a nut on a screw: η = tan λ / tan(λ + φ), with λ the thread\'s lead angle and φ the friction angle. A 1-start worm wastes over half its power as heat; more starts raise λ and the efficiency but cut the ratio.',
    'Turn it around and let the load push. The wheel driving the worm sees η\' = tan(λ − φ) / tan λ, and when λ ≤ φ that is zero: friction wins and the load can\'t turn the worm. It holds with the power off, no brake, no holding current. That is why lifts, gates, pan-tilt heads and wiper motors use one.',
    'The price: any self-locking worm is under 50 % efficient. And it is not a safety brake: vibration, a slicker grease or a worn wheel can let it creep. A 2- or 4-start worm here back-drives and lets the load run down.',
    'Spur and planetary gearmotors back-drive (see DC motor › Gearboxes), so a lifted arm drops when the motor stops unless the controller holds it. Worms trade efficiency for that free hold.',
  ],
  controls: [
    { kind: 'choice', key: 'starts', options: opts(STARTS), initial: 's1' },
    { kind: 'slider', key: 'teeth', label: 'Wheel', min: 20, max: 60, step: 10, initial: 40, format: (v) => `${v} teeth` },
    { kind: 'slider', key: 'load', label: 'Load', min: 1, max: 10, step: 1, initial: 5, format: (v) => `${v} kg` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const holder = add(scene, new THREE.Group())
    let wheel = new THREE.Group()
    let worm = { spin: new THREE.Group() }
    const bronze = mat('#c58a3a', { metal: 0.45, rough: 0.35 })
    const xRope = WD.cx - WD.drum
    const rope = cylinder(scene, 0.06, 1, mat('#e8e2d0', { rough: 0.7 }), [xRope, 0, 1.2], 'y', 8)
    rope.castShadow = false
    const load = add(scene, new THREE.Group())
    box(load, [2, 1.6, 1.6], mat('#4b5563', { metal: 0.3, rough: 0.5 }), [0, -0.8, 1.2])
    const loadTag = liveLabel(load, [0, -0.8, 2.1], { size: 0.36, color: LABEL })
    const status = liveLabel(scene, [WD.sx, 6, 0.4], { size: 0.42 })
    const timeTag = liveLabel(scene, [0, WD.bottom - 1.2, 0.4], { size: 0.3, color: GREY })

    const plot = scope(scene, WD.sw, 5, { divs: [6, 4], zeroAt: 0 })
    plot.group.position.set(WD.sx, 1.6, 0)
    const LMAX = 30 * DEG
    const yP = (f: number) => (f - 0.5) * plot.height
    const tFwd = plot.trace(POWER, { samples: 100, radius: 0.06 })
    const tBack = plot.trace(HEAT, { samples: 100, radius: 0.06 })
    tFwd.draw((u) => yP(wormEfficiency(Math.max(1e-4, u * LMAX))), null)
    tBack.draw((u) => yP(wormBackEfficiency(Math.max(1e-4, u * LMAX))), null)
    cursorBar(plot, RING, 0.08)(wormFrictionAngle() / LMAX)
    const dots = [POWER, HEAT].map((c) => add(plot.group, new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), glowMat(c, 1.3))))
    ticks(plot, [0, 10, 20, 30].map((d): [number, string] => [d / 30, `${d}`]), [[0, '0'], [0.5, '50'], [1, '100']], 0.3)
    addLabel(scene, 'efficiency, % vs lead angle λ, °', [WD.sx, -2.4, 0.3], GREY, 0.3)
    const verdict = liveLabel(scene, [WD.sx, -3.8, 0.3], { size: 0.36 })

    const rebuild = (q: WormQ) => {
      emptyGroup(holder)
      const rw = (WD.mw * q.z) / 2
      const rWorm = (WORM.q * WD.mw) / 2
      wheel = add(holder, new THREE.Group(), [WD.cx, WD.cy, 0])
      spurGear(wheel, q.z, WD.mw, 1.2, bronze)
      cylinder(wheel, WD.drum, 1, mat('#5d636c', { metal: 0.3, rough: 0.4 }), [0, 0, 1.2], 'z', 24)
      box(wheel, [0.5, 0.25, 0.1], mat('#d23b3b', { rough: 0.5 }), [rw * 0.6, 0, 0.65]).castShadow = false
      rod(holder, [WD.cx, WD.cy, -1], [WD.cx, WD.cy, 1.8], 0.16, STEEL())
      const wy = WD.cy + rw + rWorm
      const ls = leadScrew(holder, [WD.cx - WD.len / 2, wy, 0], WD.len, { r: rWorm * 1.05, lead: q.starts * Math.PI * WD.mw, starts: q.starts })
      ls.group.rotation.z = -Math.PI / 2
      ls.nut.visible = false
      worm = ls
      const mx = WD.cx + WD.len / 2 + 1.6
      cylinder(holder, 1.3, 3, mat('#c9ccd1', { metal: 0.45, rough: 0.35 }), [mx, wy, 0], 'x', 28)
      addLabel(holder, 'motor', [mx, wy + 1.9, 0.4], GREY, 0.3)
      addLabel(holder, `${q.starts}-start worm`, [WD.cx - WD.len / 2 - 0.4, wy + 1.9, 0.4], LABEL, 0.3)
      addLabel(holder, `${q.z} t wheel`, [WD.cx + rw * 0.7 + 0.6, WD.cy - rw * 0.7 - 0.4, 0.8], LABEL, 0.3)
      loadTag.set(`${q.kg} kg`)
      dots[0].position.set(plot.xAt(q.lead / LMAX), yP(q.eff), 0.3)
      dots[1].position.set(plot.xAt(q.lead / LMAX), yP(q.back), 0.3)
      verdict.set(q.locks ? `λ ${(q.lead / DEG).toFixed(1)}° < φ: self-locking` : `λ ${(q.lead / DEG).toFixed(1)}° > φ: back-drives`, q.locks ? POWER : HIGH_V)
    }

    const st = { key: '', t: 0 }
    const wheelRadPerUnit = 1 / WD.drum
    return {
      scene,
      view: { center: [0.4, 0.2, 0], radius: 50, polar: 1.4, azimuth: 0.14 },
      frame(dt, p) {
        const q = wormParams(p)
        const key = `${q.starts}|${q.z}|${q.kg}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          rebuild(q)
        }
        st.t = (st.t + dt) % WD.cycle
        const t = st.t
        const lifting = t < WD.liftS
        const off = t - WD.liftS
        const fall = q.locks ? 0 : Math.min(WD.lift, 0.5 * 3 * q.back * off * off)
        const h = lifting ? (WD.lift * t) / WD.liftS : WD.lift - fall
        const wheelAng = -h * wheelRadPerUnit
        wheel.rotation.z = wheelAng
        worm.spin.rotation.y = -wheelAng * q.ratio
        const top = WD.cy
        const ly = WD.bottom + h
        load.position.set(xRope, ly, 0)
        rope.scale.y = top - ly
        rope.position.y = (top + ly) / 2
        status.set(lifting ? 'motor on: lifting' : q.locks ? 'power off: self-locked, load held' : fall >= WD.lift ? 'power off: load ran back down' : 'power off: load back-drives the worm', lifting ? POWER : q.locks ? POWER : HIGH_V)
        timeTag.set(`t = ${t.toFixed(1)} s · power ${lifting ? 'on' : 'off'} · ${num(q.ratio)} worm turns per wheel turn`)
      },
      readouts: (p) => {
        const q = wormParams(p)
        return [
          { label: 'Ratio', value: `${num(q.ratio)} : 1` },
          { label: 'Efficiency', value: `${pct(q.eff)}, back ${pct(q.back)}` },
          { label: 'Power off', value: q.locks ? `holds ${q.kg} kg` : 'back-drives', tone: q.locks ? 'ok' : 'bad' },
          { label: 'Motor torque', value: mNm(q.motorNm) },
        ]
      },
    }
  },
}
