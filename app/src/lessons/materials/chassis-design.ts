import * as THREE from 'three/webgpu'
import {
  BattDeck,
  CHASSIS,
  DECKS,
  awgDiameter,
  HARNESS,
  IMU_SPOTS,
  ImuSpot,
  MOTOR_LEAD,
  RouteVerdict,
  balanceSweep,
  cableRoute,
  chassisBalance,
  chassisLayout,
  flatMutual,
  sclTrace,
} from '../../core/physics'
import { accelText, celsiusText, degText, fixedText, mmText, pct, si, volts } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  ACRYLIC_TINT,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  WIDE_RIGHT,
  WIDE_VIEW,
  addLabel,
  addRod,
  cableRun,
  chassisModel,
  comMarker,
  countBars,
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
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'


// --- Layout and balance: slide the battery, pick the deck, wheelbase and IMU spot; CoM, wheel loads, slip and tip limits. ---

const PLOT = { ...WIDE_RIGHT, y: -8.6, h: 4.4 }
const LB = { at: [-8.4, -1.2, 0] as V3, tilt: -0.3, k: 58, bMin: -0.12, bMax: 0.03, aMax: 10, bars: [-10.4, -8, 0] as V3, side: { x: 9.6, y: -2.2, k: 48, ax: 2.6 } }
type Verdict = [string, string]
const lbRun = memoBy(
  (p: Params) => `${p.batt} ${p.deck} ${p.base} ${p.imu}`,
  (p: Params) => {
    const deck = pick(DECKS, p.deck, 'low') as BattDeck
    const imu = pick(IMU_SPOTS, p.imu, 'front') as ImuSpot
    const L = n(p, 'base') / 1000
    const bx = n(p, 'batt') / 1000
    const parts = chassisLayout(bx, deck, L, imu)
    const B = chassisBalance(parts, L)
    const sweep = balanceSweep(deck, L, imu, LB.bMin, LB.bMax)
    let v: Verdict = ['balanced: weight on the drive wheels, stays on all three contacts', POWER]
    if (B.share <= 0) v = ['tips back: the CoM is behind the caster', HIGH_V]
    else if (B.share >= 1) v = ['tips onto its nose: the CoM is ahead of the wheels', HIGH_V]
    else if (B.turnTip < B.turnSlip) v = ['rolls over in a hard turn before the tyres slide: CoM too high', HEAT]
    else if (B.brakeBy === 'tips' && B.brake < 3) v = ['noses over when it brakes hard: CoM close to the axle', HEAT]
    else if (B.share < 0.5) v = ['light on the drive wheels: they spin when it pulls away', HEAT]
    else if (B.imuAccel > 1) v = ['balanced, but the IMU is off the spin centre: turning reads as tilt', HEAT]
    return { deck, imu, L, bx, parts, B, sweep, v }
  },
)

export const chassisDesignLayoutAndBalance: Lesson = {
  id: 'chassis-design-layout-and-balance',
  title: 'Layout and balance',
  tagline: 'Where the battery and boards sit sets the grip, the tip-over limits and what the IMU feels',
  formula: (p) => {
    const { L, B } = lbRun(p)
    return `CoM x = Σm·x / Σm = ${mmText(B.x)} (axle = 0, caster at −${mmText(L)}) · drive share = (x + L)/L = ${pct(B.share)} · pull away before slip a = μg(x + L)/(L + μh) = ${accelText(B.accel)} · nose over when braking b = g·|x|/h · brake ${accelText(B.brake)} (${B.brakeBy}) · turn tips at g·d/h = ${accelText(B.turnTip)}, slides at μg = ${accelText(B.turnSlip)} · IMU ω²r = ${accelText(B.imuAccel)} at ${CHASSIS.spinHz} turn/s · μ ${CHASSIS.mu}, h ${mmText(B.h)} (typical)`
  },
  legend: [
    { color: '#f2f2f2', label: 'Centre of mass (above its floor point)', shape: 'dot' },
    { color: RING, label: 'Support triangle: wheels + caster', shape: 'dot' },
    { color: FORCE, label: 'Load on the wheels and the caster', shape: 'dot' },
    { color: HIGH_V, label: 'Tips or slips', shape: 'dot' },
  ],
  points: [
    'The chassis is the skeleton everything bolts to: a cut plate (Laser & CNC, CAD basics), screwed parts (Fasteners). Most of the mass is the battery and the motors, so where the battery goes decides where the centre of mass (CoM) lands (Centre of mass). On two driven wheels and a caster the robot stands on a triangle; the CoM must stay inside it, or it tips.',
    'Move the battery toward the axle and more weight presses the drive wheels: more grip before they spin (Friction & traction › Wheel slip). Go too far and it noses over when braking, because the CoM sits just behind the axle and the stop throws it forward. A longer wheelbase widens the window; keeping the battery low (under the plate) cuts both the nose-over and the roll-over in fast turns (Centre of mass › Low and wide).',
    'A two-wheeler spins about the middle of its axle. An IMU away from that point feels ω²r on every turn and reads it as tilt, so mount it near the axle centre, away from motors (Sensors › IMU). Access matters too: the battery must come out to charge, the ESP32 USB port must face an edge, and the wheels need clearance.',
    'Build the layout before the plate: weigh the parts, sum m·x, check the triangle, then draw holes in CAD. The same plate becomes the Practice robot car and the printed chassis (3D printing › Print a robot). Where the wires go next: Cable routing.',
  ],
  controls: [
    { kind: 'slider', key: 'batt', label: 'Battery position', min: LB.bMin * 1000, max: LB.bMax * 1000, step: 5, initial: -40, format: (v) => `${v > 0 ? '+' : ''}${v} mm from the axle` },
    { kind: 'choice', key: 'deck', options: opts(namesOf(DECKS)), initial: 'low' },
    { kind: 'slider', key: 'base', label: 'Wheelbase (axle to caster)', min: 70, max: 160, step: 10, initial: 110, format: (v) => `${v} mm` },
    { kind: 'choice', key: 'imu', options: opts(namesOf(IMU_SPOTS)), initial: 'front' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const k = LB.k
    const top = add(scene, new THREE.Group(), LB.at)
    top.rotation.x = LB.tilt
    const holder = add(top, new THREE.Group())
    let model: ReturnType<typeof chassisModel> | null = null
    let built = -1
    const tri = Array.from({ length: 3 }, () => addRod(top, glowMat(RING, 0.9)))
    const com = comMarker(top, 0.45)
    const comFoot = glowDot(top, 0.18, '#f2f2f2')
    const comPost = addRod(top, glowMat('#f2f2f2', 0.6))
    const axleTag = liveLabel(top, [0, 0, 0], { size: 0.26, color: GREY })
    const imuRing = add(top, new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 32), glowMat(HEAT, 1)))

    const S = LB.side
    const side = add(scene, new THREE.Group(), [S.x, S.y, 0])
    addLabel(scene, 'side view', [S.x - 6, S.y + 3, 0.3], LABEL, 0.28, 'left')
    const floor = addRod(side, mat('#5b606b'))
    stretchRod(floor, [-6.4, 0, 0], [6.2, 0, 0], 0.05)
    const sk = S.k
    cylinder(side, CHASSIS.wheelR * sk, 0.2, mat('#2b2d33', { rough: 0.9 }), [S.ax, CHASSIS.wheelR * sk, 0], 'z', 32)
    cylinder(side, CHASSIS.wheelR * 0.6 * sk, 0.22, mat('#e0e3e8'), [S.ax, CHASSIS.wheelR * sk, 0], 'z', 6)
    const caster = add(side, new THREE.Mesh(new THREE.SphereGeometry(0.008 * sk, 16, 12), mat('#c9ccd1', { metal: 0.4, rough: 0.3 })))
    const plateS = box(side, [1, 0.003 * sk, 0.3], shellMat(ACRYLIC_TINT, 0.7, 0.2))
    const deckS = box(side, [0.09 * sk, 0.003 * sk, 0.3], shellMat(ACRYLIC_TINT, 0.7, 0.2))
    const battS = box(side, [0.077 * sk, 0.02 * sk, 0.4], mat('#2856c8', { rough: 0.4 }))
    const comS = comMarker(side, 0.32)
    const legs = [addRod(side, glowMat(RING, 0.7)), addRod(side, glowMat(RING, 0.7))]
    const wheelF = forceArrow(side, FORCE, { r: 0.09, size: 0.24 })
    const casterF = forceArrow(side, FORCE, { r: 0.09, size: 0.24 })

    addLabel(scene, 'limits before it slips or tips', [LB.bars[0] - 3.6, LB.bars[1] + 0.9, 0.3], LABEL, 0.28, 'left')
    const bars = countBars(scene, LB.bars, ['pull away', 'brake', 'turn: tips at', 'turn: slides at'], 5.2, { row: 0.62, size: 0.26 })
    const P = PLOT
    const plot = titledScope(scene, P.y, P.h, 'limits vs battery position', LABEL, 0, P.x, P.w)
    const py = plotY(0, LB.aMax, P.h)
    const accelC = plot.s.trace(POWER, { samples: 41, radius: 0.06 })
    const brakeC = plot.s.trace(HEAT, { samples: 41, radius: 0.06 })
    const marks = [glowDot(plot.s.group, 0.24, POWER), glowDot(plot.s.group, 0.24, HEAT)]
    const cursor = addRod(plot.s.group, glowMat(RING, 0.6))
    const accelTag = liveLabel(plot.s.group, [0, 0, 0.4], { size: 0.22, color: POWER, align: 'left' })
    const brakeTag = liveLabel(plot.s.group, [0, 0, 0.4], { size: 0.22, color: HEAT, align: 'right' })
    addLabel(plot.s.group, `${LB.aMax} m/s²`, [P.w / 2 - 0.2, P.h / 2 - 0.4, 0.4], GREY, 0.22, 'right')
    const rows = textRows(scene, 4, 2.2, 5.2, 0.3, 0.7)
    const uOf = (bx: number) => (bx - LB.bMin) / (LB.bMax - LB.bMin)
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { deck, L, bx, parts, B, sweep, v } = lbRun(p)
        if (built !== L) {
          built = L
          holder.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
          holder.clear()
          model = chassisModel(holder, parts, k)
        }
        model!.place(parts)
        const xo = ((L - CHASSIS.front) / 2) * k
        top.position.x = LB.at[0] + xo
        const t2 = (CHASSIS.track / 2) * k
        const c: V3 = [-L * k, 0, 0.02]
        stretchRod(tri[0], [0, t2, 0.02], [0, -t2, 0.02], 0.07)
        stretchRod(tri[1], [0, t2, 0.02], c, 0.07)
        stretchRod(tri[2], [0, -t2, 0.02], c, 0.07)
        const ch = 0.1 * k
        com.position.set(B.x * k, B.y * k, ch)
        comFoot.position.set(B.x * k, B.y * k, 0.03)
        stretchRod(comPost, [B.x * k, B.y * k, 0.03], [B.x * k, B.y * k, ch], 0.04)
        setGlow(comFoot.material as THREE.MeshStandardMaterial, B.stable ? '#f2f2f2' : HIGH_V, 1.2)
        axleTag.group.position.set(0, -t2 - 1.4, 0.1)
        axleTag.set('axle')
        const ip = parts.find((q) => q.key === 'imu')!
        imuRing.position.set(ip.x * k, ip.y * k, ip.z * k + 0.6)
        setGlow(imuRing.material as THREE.MeshStandardMaterial, B.imuAccel > 1 ? HEAT : POWER, 1)

        const ax = S.ax
        const at = (x: number, z: number): V3 => [ax + x * sk, z * sk, 0]
        caster.position.set(...at(-L, 0.008))
        const front = CHASSIS.front
        const rear = -L - CHASSIS.rearPad
        plateS.scale.x = (front - rear) * sk
        plateS.position.set(...at((front + rear) / 2, CHASSIS.plateZ - 0.0015))
        const bp = parts.find((q) => q.key === 'battery')!
        battS.position.set(...at(bp.x, bp.z))
        deckS.position.set(...at(bp.x, bp.z - 0.0135))
        deckS.visible = deck === 'top'
        const cs = at(B.x, B.h)
        comS.position.set(cs[0], cs[1], 0.5)
        stretchRod(legs[0], [cs[0], cs[1], 0.3], at(0, 0), 0.04)
        stretchRod(legs[1], [cs[0], cs[1], 0.3], at(-L, 0), 0.04)
        const wl = 2 * Math.max(0, Math.min(1, B.share))
        const cl = 2 * Math.max(0, Math.min(1, 1 - B.share))
        wheelF([at(0, 0)[0], -wl, 0.4], [at(0, 0)[0], 0, 0.4], pct(Math.max(0, B.share)), [0.9, -wl - 0.4, 0])
        casterF([at(-L, 0)[0], -cl, 0.4], [at(-L, 0)[0], 0, 0.4], pct(Math.max(0, 1 - B.share)), [-0.9, -cl - 0.4, 0])

        bars.set(
          [B.accel, B.brake, B.turnTip, B.turnSlip].map((a) => (B.stable ? Math.min(a, 12) : 0)),
          [B.accel, B.brake, B.turnTip, B.turnSlip].map((a) => (B.stable ? accelText(a) : 'tips')),
          [B.share < 0.5 ? HEAT : POWER, B.brakeBy === 'tips' && B.brake < 3 ? HEAT : POWER, B.turnTip < B.turnSlip ? HIGH_V : POWER, GREY],
          12,
        )

        const us = sweep.map((s) => uOf(s.bx))
        accelC.points(us, sweep.map((s) => py(Math.min(LB.aMax, s.accel))), null)
        brakeC.points(us, sweep.map((s) => py(Math.min(LB.aMax, s.brake))), null)
        const xu = plot.s.xAt(uOf(bx))
        const st = B.stable
        marks[0].position.set(xu, py(st ? Math.min(LB.aMax, B.accel) : 0), 0.46)
        marks[1].position.set(xu, py(st ? Math.min(LB.aMax, B.brake) : 0), 0.46)
        stretchRod(cursor, [xu, -P.h / 2, 0.4], [xu, P.h / 2, 0.4], 0.04)
        const a0 = sweep[Math.round(sweep.length * 0.8)]
        accelTag.group.position.set(plot.s.xAt(uOf(a0.bx)) - 0.2, py(Math.min(LB.aMax, a0.accel)) + 0.5, 0.4)
        accelTag.set('pull away')
        const b0 = sweep[Math.round(sweep.length * 0.35)]
        brakeTag.group.position.set(plot.s.xAt(uOf(b0.bx)), py(Math.min(LB.aMax, b0.brake)) + 0.5, 0.4)
        brakeTag.set('brake')
        plot.lo.set(`battery ${LB.bMin * 1000} mm`)
        plot.hi.set(`+${LB.bMax * 1000} mm`)
        plot.right.set(`${mmText(bx)}`, RING)

        rows[0].set(`CoM ${mmText(-B.x)} behind the axle, ${mmText(B.h)} up · ${Math.round(B.kg * 1000)} g`, LABEL)
        rows[1].set(`drive wheels carry ${pct(Math.max(0, B.share))}, caster ${pct(Math.max(0, 1 - B.share))}`, B.share < 0.5 || !B.stable ? HEAT : LABEL)
        rows[2].set(`IMU ${mmText(B.imuR)} off centre: ${accelText(B.imuAccel)} = ${degText(B.imuTiltDeg, 0)} false tilt`, B.imuAccel > 1 ? HEAT : GREY)
        rows[3].set(deck === 'top' ? 'top deck: easy battery swap, CoM higher' : 'under the plate: CoM low, harder to swap', GREY)
        head.status.set(`Layout and balance · battery ${mmText(bx)} · ${DECKS[deck].name.replace('battery ', '')} · wheelbase ${mmText(L)}`)
        head.sub.set(`${Math.round(B.kg * 1000)} g robot on 65 mm wheels, μ ${CHASSIS.mu}, masses typical`, GREY)
        head.event.set(...v)
      },
      readouts: (p) => {
        const { B } = lbRun(p)
        return [
          { label: 'Drive-wheel share', value: pct(Math.max(0, B.share)), tone: toneOf(B.stable && B.share >= 0.6, B.stable) },
          { label: 'Pull away', value: B.stable ? accelText(B.accel) : 'tips', tone: toneOf(B.stable && B.share >= 0.5, B.stable) },
          { label: 'Brake', value: B.stable ? accelText(B.brake) : 'tips', tone: toneOf(B.stable && B.brake >= 3, B.stable) },
          { label: 'Turn tips at', value: accelText(B.turnTip), tone: toneOf(B.turnTip >= B.turnSlip, false) },
        ]
      },
    }
  },
}

// --- Cable routing: motor leads (gauge, length, harness) beside the I²C wires: drop, heat, coupled spike on SCL. ---

const CR = { at: [-8.2, -1.4, 0] as V3, tilt: -0.3, k: 56, yLead: -0.04, sepMax: 0.06, vMax: 1.2, scl: { x: -8.4, y: -9.4, w: 12.4, h: 3.6 }, xs: { x: 4.2, y: -0.6, k: 0.17 }, win: 100e-6 }
const HARNESS_KEYS = Object.keys(HARNESS) as (keyof typeof HARNESS)[]
const VERDICT_CR: Record<RouteVerdict, [string, string]> = {
  ok: ['clean: SCL edges stay inside the margin, motor gets its volts', POWER],
  glitch: ['SCL glitches at every PWM edge: false clocks, I²C hangs or reads garbage', HIGH_V],
  sag: ['the leads eat the voltage: motor slower, brown-out risk at stall', HEAT],
  hot: ['wire too thin for the stall current: it runs hot', HIGH_V],
}
const ROUTE_PARTS = chassisLayout(-0.03, 'low', 0.12, 'front').map((q) => (q.key === 'driver' ? { ...q, x: -0.082, y: -0.036 } : q))
const crRun = memoBy(
  (p: Params) => `${p.harness} ${p.sep} ${p.gauge} ${p.length}`,
  (p: Params) => {
    const h = pick(HARNESS, p.harness, 'paired')
    const sep = n(p, 'sep') / 1000
    const gauge = n(p, 'gauge')
    const len = n(p, 'length')
    const R = cableRoute(h, sep, gauge, len)
    const seps = Array.from({ length: 59 }, (_, i) => 0.002 + (i / 58) * (CR.sepMax - 0.002))
    const curves = HARNESS_KEYS.map((hk) => seps.map((s) => cableRoute(hk, s, gauge, len).spike))
    return { h, sep, gauge, len, R, seps, curves }
  },
)

export const chassisDesignCableRouting: Lesson = {
  id: 'chassis-design-cable-routing',
  title: 'Cable routing',
  tagline: 'Motor current and I²C signals share one plate: keep power loops small, short and away from the signal wires',
  formula: (p) => {
    const { h, sep, R } = crRun(p)
    const H = HARNESS[h]
    return `drop = I·R = ${MOTOR_LEAD.amps} A × ${fixedText(R.run.ohms, 3)} Ω = ${volts(R.run.drop)} (${pct(R.dropFrac)} of ${MOTOR_LEAD.packV} V) · M = μ0/2π·[ln((d+g)/d) − ln((d+g+s)/(d+s))]·ℓ = ${si(flatMutual(H.gap, MOTOR_LEAD.victimGap, sep) * R.beside, 'H', 2)}${H.pitch ? ', × twist residual' : ''} → ${si(R.henries, 'H', 2)} · spike = M·I/t = ${volts(R.spike)} per ${MOTOR_LEAD.edgeS * 1e9} ns PWM edge · d ${mmText(sep)}, s ${fixedText(H.gap * 1000, 1)} mm, g ${MOTOR_LEAD.victimGap * 1000} mm, ℓ ${mmText(R.beside)} (typical)`
  },
  legend: [
    { color: '#d8322c', label: 'Motor and battery leads (amps)', shape: 'dot' },
    { color: '#3a7bd5', label: 'I²C wires: SDA blue, SCL yellow', shape: 'dot' },
    { color: RING, label: 'This route on the chart', shape: 'dot' },
    { color: HIGH_V, label: 'Glitch margin crossed', shape: 'dot' },
  ],
  points: [
    'Two kinds of wire share the plate. Power wires (battery to driver, driver to motors) carry amps; signal wires (I²C to the IMU, encoders) carry milliamps and small voltages. Power leads need copper: a thin, long lead drops volts and heats up at stall (Power › Wiring: gauge, drop and heat). Keep them short and thick enough, and battery leads shortest of all.',
    'A motor lead is a loop: current out on one wire, back on the other. Every PWM edge changes that current in about 50 ns, and the loop\'s changing field induces a spike in any nearby loop, here SDA/SCL with their ground (Signals › Grounding and shielding). The spike grows with the power loop size (wire gap), the signal loop size, the length they run side by side, and falls off fast with distance.',
    'So: run each motor pair side by side, then twist it (each twist flips the loop, so the fields cancel). Keep I²C wires short, twisted with their ground, and a few cm from motor wires; cross at right angles where they must meet. Decoupling at the driver keeps the current loop local too (Power › Decoupling).',
    'Mechanics count: tie wires down near the board (strain relief) so a tug pulls the tie, not the solder joint; keep them clear of wheels and the caster; leave a service loop; put connectors (JST, XT30) at board boundaries so the battery and modules unplug for repair (Fasteners, Layout and balance).',
  ],
  controls: [
    { kind: 'choice', key: 'harness', options: opts(namesOf(HARNESS)), initial: 'loose' },
    { kind: 'slider', key: 'sep', label: 'Gap to the I²C wires', min: 2, max: CR.sepMax * 1000, step: 1, initial: 4, format: (v) => `${v} mm` },
    { kind: 'slider', key: 'gauge', label: 'Motor lead gauge', min: 20, max: 30, step: 2, initial: 26, format: (v) => `AWG ${v}` },
    { kind: 'slider', key: 'length', label: 'Motor lead length', min: 0.1, max: 0.6, step: 0.05, initial: 0.3, format: (v) => `${Math.round(v * 100)} cm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const k = CR.k
    const top = add(scene, new THREE.Group(), [CR.at[0] + ((0.12 - CHASSIS.front) / 2) * k, CR.at[1], 0])
    top.rotation.x = CR.tilt
    const model = chassisModel(top, ROUTE_PARTS, k)
    const wires = add(top, new THREE.Group())
    let built = ''
    let sclMat: THREE.MeshStandardMaterial | null = null
    let leadMats: THREE.MeshStandardMaterial[] = []
    const st = { t: 0 }
    const zw = (CHASSIS.plateZ + 0.004) * k
    const pinUp = (q: V3): V3 => [q[0], q[1], zw]
    const matsOf = (g: THREE.Object3D) => {
      const out: THREE.MeshStandardMaterial[] = []
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
        if (m && !out.includes(m)) out.push(m)
      })
      return out
    }
    const buildWires = (hk: keyof typeof HARNESS, sep: number, gauge: number) => {
      wires.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
      wires.clear()
      const H = HARNESS[hk]
      const rw = Math.max(0.05, (0.0004 + awgDiameter(gauge) / 2) * k * 1.4)
      const x0 = -0.07 * k
      const x1 = -0.036 * k
      const yl = CR.yLead * k
      const half = (H.gap / 2) * k
      const leadG = add(wires, new THREE.Group())
      const pair = (from: [V3, V3], ya: number, xa: number, xb: number, end: (s: number) => V3) =>
        [-1, 1].forEach((s, j) => {
          const pts: V3[] = [pinUp(from[j]), [xa, ya + s * half, zw]]
          const steps = H.pitch ? Math.ceil(((xb - xa) / k / H.pitch) * 12) : 1
          for (let i = 1; i <= steps; i++) {
            const u = i / steps
            const ph = H.pitch ? ((xb - xa) / k / H.pitch) * u * Math.PI * 2 : 0
            const c = Math.cos(ph + (s < 0 ? Math.PI : 0))
            pts.push([xa + (xb - xa) * u, ya + (H.pitch ? c * half : s * half), zw + (H.pitch ? Math.sin(ph + (s < 0 ? Math.PI : 0)) * half : 0)])
          }
          pts.push(end(s))
          cableRun(leadG, pts, s < 0 ? '#d8322c' : '#26282e', rw)
        })
      pair([model.driverPin('A'), model.driverPin('B')], yl, x0, x1, (s) => [x1 + 0.6, yl + s * half, (CHASSIS.wheelR + 0.006) * k])
      const yL = (CHASSIS.track / 2 - 0.022) * k
      cableRun(leadG, [pinUp(model.driverPin('A')), [x0 + 0.5, yl + 0.9, zw], [-0.05 * k, yl + 0.9, zw], [-0.05 * k, yL - 1, zw], [x1 + 0.6, yL - 0.8, (CHASSIS.wheelR + 0.006) * k]], '#d8322c', rw)
      cableRun(leadG, [pinUp(model.driverPin('B')), [x0 + 0.7, yl + 1.1, zw], [-0.048 * k, yl + 1.1, zw], [-0.048 * k, yL - 1, zw], [x1 + 0.9, yL - 0.8, (CHASSIS.wheelR + 0.006) * k]], '#26282e', rw)
      const batt = model.at('battery')
      cableRun(wires, [[batt[0] - 2.4, batt[1] - 0.3, batt[2]], [batt[0] - 2.6, -0.02 * k, zw], pinUp(model.driverPin('VM'))], '#d8322c', 0.09)
      cableRun(wires, [[batt[0] - 2.4, batt[1] + 0.3, batt[2]], [batt[0] - 2.8, -0.015 * k, zw], pinUp(model.driverPin('GND'))], '#26282e', 0.09)
      leadMats = matsOf(leadG)
      const yb = yl + (sep + H.gap / 2 + MOTOR_LEAD.victimGap / 2) * k
      const e = model.at('esp32')
      const colors = ['#d8322c', '#26282e', '#f2c12e', '#3a7bd5']
      ;['VCC', 'GND', 'SCL', 'SDA'].forEach((name, j) => {
        const dy = (j - 1.5) * (MOTOR_LEAD.victimGap / 3) * k
        const ex = e[0] + (j - 1.5) * 2.54 * (k / 1000) * 2 + 0.06 * k * 0.3
        const imuPin = model.imuPin(name)
        const g = add(wires, new THREE.Group())
        cableRun(g, [[ex, e[1] - 0.0127 * k, zw], [ex, yb + dy, zw], [imuPin[0] - 1, yb + dy, zw], [imuPin[0] - 0.6, imuPin[1], zw], imuPin], colors[j], 0.06)
        if (name === 'SCL') {
          sclMat = matsOf(g)[0]
          sclMat.emissive.set(HIGH_V)
        }
      })
    }

    const X = CR.xs
    const xs = add(scene, new THREE.Group(), [X.x, X.y, 0])
    addLabel(scene, 'cross-section, gaps to scale', [X.x - 1.8, X.y + 2.2, 0.3], LABEL, 0.28, 'left')
    const disc = (c: string) => cylinder(xs, 1, 0.2, glowMat(c, 0.3), [0, 0, 0], 'z', 24)
    const aggr = [disc('#d8322c'), disc('#6a6e78')]
    const vict = [disc('#3a7bd5'), disc('#6a6e78')]
    const gapTag = liveLabel(xs, [0, -1.2, 0.3], { size: 0.24, color: GREY })
    addLabel(xs, 'motor pair', [-0.8, -0.1, 0.3], GREY, 0.24, 'right')
    const victTag = liveLabel(xs, [0, 0, 0.3], { size: 0.24, color: GREY, align: 'left' })
    const gapRod = addRod(xs, glowMat(GREY, 0.5))

    const S = CR.scl
    const scl = titledScope(scene, S.y, S.h, 'SCL on a scope, 100 µs', LABEL, 0, S.x, S.w)
    const sy = plotY(-1.5, 5, S.h)
    const sclTr = scl.s.trace('#f2c12e', { samples: 400, radius: 0.05 })
    const lo = scl.s.level(HIGH_V)
    const hi = scl.s.level(HIGH_V)
    lo.set(sy(MOTOR_LEAD.marginV))
    hi.set(sy(MOTOR_LEAD.vdd - MOTOR_LEAD.marginV))
    const tUs = Array.from({ length: 400 }, (_, i) => i / 399)

    const P = PLOT
    const plot = titledScope(scene, P.y, P.h, 'spike vs gap to I²C', LABEL, 0, P.x, P.w)
    const py = plotY(0, CR.vMax, P.h)
    const curves = HARNESS_KEYS.map(() => plot.s.trace(GREY, { samples: 59, radius: 0.06 }))
    const margin = plot.s.level(HIGH_V)
    margin.set(py(MOTOR_LEAD.marginV))
    addLabel(plot.s.group, `glitch margin ${MOTOR_LEAD.marginV} V`, [P.w / 2 - 0.2, py(MOTOR_LEAD.marginV) + 0.4, 0.4], HIGH_V, 0.22, 'right')
    addLabel(plot.s.group, `${CR.vMax} V`, [P.w / 2 - 0.2, P.h / 2 - 0.4, 0.4], GREY, 0.22, 'right')
    const tags = HARNESS_KEYS.map(() => liveLabel(plot.s.group, [0, 0, 0.4], { size: 0.22, align: 'right' }))
    const marker = glowDot(plot.s.group, 0.26, RING)
    const rows = textRows(scene, 4, 2.2, 5.2, 0.3, 0.7)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { h, sep, gauge, len, R, seps, curves: cv } = crRun(p)
        const key = `${h}|${sep}|${gauge}`
        if (key !== built) {
          built = key
          buildWires(h, sep, gauge)
        }
        st.t += dt
        const ph = (st.t * 0.8) % 1
        const on = ph < 0.3
        const edge = Math.max(Math.exp(-ph * 14), Math.exp(-Math.abs(ph - 0.3) * 14 * (ph >= 0.3 ? 1 : 1e3)))
        leadMats.forEach((m) => {
          m.emissive.set(m.color)
          m.emissiveIntensity = on ? 0.5 : 0.05
        })
        if (sclMat) sclMat.emissiveIntensity = Math.min(2, (R.spike / MOTOR_LEAD.marginV) * edge * 1.5)

        const H = HARNESS[h]
        const xk = X.k * 1000
        const r = 0.2
        const spin = H.pitch ? st.t * 1.2 : 0
        const pc = 1.6 - (H.gap / 2) * xk
        aggr.forEach((d, j) => {
          const a = spin + j * Math.PI
          d.scale.set(r, 1, r)
          d.position.set(pc + Math.cos(a) * (H.gap / 2) * xk, Math.sin(a) * (H.gap / 2) * xk, 0)
        })
        const vx = pc + (H.gap / 2 + sep) * xk
        vict.forEach((d, j) => {
          d.scale.set(r, 1, r)
          d.position.set(vx + j * MOTOR_LEAD.victimGap * xk, 0, 0)
        })
        victTag.group.position.set(vx + MOTOR_LEAD.victimGap * xk + 0.5, -0.1, 0.3)
        victTag.set('SDA + GND')
        stretchRod(gapRod, [pc + (H.gap / 2) * xk, -0.7, 0.2], [vx, -0.7, 0.2], 0.03)
        gapTag.group.position.set((pc + vx) / 2, -1.2, 0.3)
        gapTag.set(`gap ${mmText(sep)}`)

        sclTr.points(tUs, tUs.map((u) => sy(Math.max(-1.5, Math.min(5, sclTrace(u * CR.win, R.spike, 1.2e-6))))), null)
        setGlow(sclTr.material, R.spike > MOTOR_LEAD.marginV ? HIGH_V : '#f2c12e', 1)
        scl.lo.set('PWM 20 kHz, 30 % · spikes drawn wider')
        scl.hi.set(`${CR.win * 1e6} µs`)
        scl.right.set(`spike ${volts(R.spike)}`, R.spike > MOTOR_LEAD.marginV ? HIGH_V : POWER)

        const us = seps.map((s) => (s - 0.002) / (CR.sepMax - 0.002))
        HARNESS_KEYS.forEach((hk, j) => {
          const sel = hk === h
          curves[j].points(us, cv[j].map((v) => py(Math.min(CR.vMax, v))), null)
          setGlow(curves[j].material, sel ? RING : GREY, sel ? 1.1 : 0.3)
          tags[j].group.position.set(P.w / 2 - 0.2, P.h / 2 - 0.9 - j * 0.5, 0.4)
          tags[j].set(HARNESS[hk].name, sel ? RING : GREY)
        })
        marker.position.set(plot.s.xAt((sep - 0.002) / (CR.sepMax - 0.002)), py(Math.min(CR.vMax, R.spike)), 0.46)
        setGlow(marker.material as THREE.MeshStandardMaterial, R.spike > MOTOR_LEAD.marginV ? HIGH_V : RING, 1.2)
        plot.lo.set('gap 2 mm')
        plot.hi.set(`${CR.sepMax * 1000} mm`)
        plot.right.set(volts(R.spike), R.spike > MOTOR_LEAD.marginV ? HIGH_V : POWER)

        rows[0].set(`motor leads AWG ${gauge}, ${Math.round(len * 100)} cm: ${fixedText(R.run.ohms, 3)} Ω out and back`, LABEL)
        rows[1].set(`at ${MOTOR_LEAD.amps} A stall: drop ${volts(R.run.drop)} (${pct(R.dropFrac)}), wire ${celsiusText(R.run.tempC)}`, R.verdict === 'sag' || R.verdict === 'hot' ? HEAT : GREY)
        rows[2].set(`${HARNESS[h].name}, ${mmText(R.beside)} beside I²C: ${si(R.henries, 'H', 2)} → ${volts(R.spike)} spikes`, R.spike > MOTOR_LEAD.marginV ? HIGH_V : GREY)
        rows[3].set('cross I²C at 90° · tie down by the wheels · plug at boards', GREY)
        head.status.set(`Cable routing · ${HARNESS[h].name} · ${mmText(sep)} from I²C · AWG ${gauge} · ${Math.round(len * 100)} cm`)
        head.sub.set(`2S ${MOTOR_LEAD.packV} V, ${MOTOR_LEAD.amps} A stall, ${MOTOR_LEAD.edgeS * 1e9} ns PWM edges, values typical`, GREY)
        head.event.set(...VERDICT_CR[R.verdict])
      },
      readouts: (p) => {
        const { R } = crRun(p)
        return [
          { label: 'Spike on SCL', value: volts(R.spike), tone: toneOf(R.spike <= MOTOR_LEAD.marginV / 2, R.spike <= MOTOR_LEAD.marginV) },
          { label: 'Lead drop', value: `${volts(R.run.drop)} · ${pct(R.dropFrac)}`, tone: toneOf(R.dropFrac <= 0.04, R.dropFrac <= 0.08) },
          { label: 'Wire temp', value: celsiusText(R.run.tempC), tone: toneOf(R.run.tempC <= 50, R.run.tempC <= 70) },
          { label: 'Coupling', value: `${si(R.henries, 'H', 2)}` },
        ]
      },
    }
  },
}
