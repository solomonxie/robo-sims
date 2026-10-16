import * as THREE from 'three/webgpu'
import {
  CYL_32,
  CYL_RUN,
  CylFrame,
  GRIP_OBJECTS,
  GRIPPERS,
  GripperKind,
  PNEUNET,
  airBounceHz,
  airPerCycleNl,
  annulusAreaMm2,
  circleAreaMm2,
  cylinderRun,
  fixedStepAt,
  gripOutcome,
  jammingHoldN,
  meterOutMmS,
  pneuNetBendRad,
  pneuNetContact,
  pneuNetCurvature,
  pressForceN,
  regulatedBar,
  seriesConductance,
  strokeStats,
  trappedStiffnessNmm,
} from '../../core/physics'
import { V3, add, box, cylinder, mat, rod, tube, STEEL } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  FORCE,
  Flow,
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
  glide,
  glowMat,
  halton,
  liveLabel,
  memoBy,
  path,
  scope,
  setGlow,
  shellMat,
  smoothstep,
  ticks,
} from '../fx'
import { LegendItem, Lesson, Params, Stage, n, opts, pick } from '../types'

const AIR = B_FIELD
const hose = () => mat('#2f6fd6', { rough: 0.5 })
const alu = () => mat('#c9ccd1', { metal: 0.45, rough: 0.35 })
const dark = () => mat('#2a2c32', { rough: 0.5 })

/** Instanced dots that fill a region; `show(k)` keeps the first k. */
function dotCloud(parent: THREE.Object3D, max: number, color: string, r = 0.09) {
  const m = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 8, 6), glowMat(color, 1), max)
  m.frustumCulled = false
  m.castShadow = false
  parent.add(m)
  const mx = new THREE.Matrix4()
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
  return {
    mesh: m,
    place(k: number, at: (i: number) => V3) {
      for (let i = 0; i < max; i++) m.setMatrixAt(i, i < k ? mx.makeTranslation(...at(i)) : hidden)
      m.instanceMatrix.needsUpdate = true
    },
  }
}

// --- Pneumatic cylinder: compressor → regulator → 5/2 valve → double-acting cylinder; F = P·A, meter-out speed, springy air. ---

const MODES = { cycle: '5/2: full strokes', stop: '5/3: stop mid-way' }
const K = 0.08
const CY = { y: -4.6, x0: -12, cap: 0.9, rb: CYL_32.boreMm * K * 0.5, rr: CYL_32.rodMm * K * 0.5, tp: 0.8 }
const XI = CY.x0 + CY.cap
const XR = XI + (2 * CYL_32.deadMm + CYL_32.strokeMm) * K + CY.tp
const VALVE = { x: -6.2, y: 1.5, w: 7, h: 1.6, pa: -7.7, pb: -4.7 }
const TANK = { x: -12.2, y: 5.6 }
const REG = { x: -8.2, y: 5.6 }
const PLOT = { x: 8.9, y: 2.2, w: 6.4, h: 3.4 }
const SLOW_CYL = 3
const DOTS = 3.4
const FLOW_K = 5
const MAX_DOTS = 240
const TANK_BAR = 8

const cylParams = (p: Params) => {
  const bar = regulatedBar(n(p, 'bar'), TANK_BAR)
  const open = n(p, 'flow')
  const needleC = (0.6 * open) / 100
  const mode = pick(MODES, p.mode, 'cycle')
  const A = circleAreaMm2(CYL_32.boreMm)
  const Ab = annulusAreaMm2(CYL_32.boreMm, CYL_32.rodMm)
  return { bar, open, needleC, mode, A, Ab, fExt: pressForceN(bar, A), fRet: pressForceN(bar, Ab), vOut: meterOutMmS(seriesConductance(CYL_32.valveC, needleC), Ab) }
}
type CylQ = ReturnType<typeof cylParams>
const cylRun = memoBy((q: CylQ) => `${q.bar}|${q.needleC}|${q.mode}`, (q: CylQ) => cylinderRun({ supplyBar: q.bar, needleC: q.needleC, mode: q.mode }))
const holdFrame = (run: CylFrame[]) => run.filter((f) => f.t < CYL_RUN.push[0]).at(-1)!
const holdSpring = (run: CylFrame[]) => {
  const f = holdFrame(run)
  const k = trappedStiffnessNmm(f.x, f.pA, f.pB)
  return { k, hz: airBounceHz(k, CYL_32.massKg), x: f.x }
}
const STATUS: Record<CylFrame['valve'], string> = {
  extend: 'extend: A fills, B vents',
  retract: 'retract: B fills, A vents',
  hold: 'centre: both ports shut',
}

export const pneumaticCylinder: Lesson = {
  id: 'pneumatics-soft-robots-pneumatic-cylinder',
  title: 'Pneumatic cylinder',
  tagline: 'Compressed air pushes a piston',
  formula: (p) => {
    const q = cylParams(p)
    const head = `F_ext = P·A = ${q.bar} bar × ${q.A.toFixed(0)} mm² = ${q.fExt.toFixed(0)} N · F_ret = P·(A − a) = ${q.fRet.toFixed(0)} N`
    if (q.mode === 'stop') {
      const s = holdSpring(cylRun(q))
      return `${head} · trapped air k = Σ p·A²/V = ${s.k.toFixed(1)} N/mm → ${CYL_RUN.pushN} N push gives ${(CYL_RUN.pushN / s.k).toFixed(1)} mm, bounce f = √(k/m)/2π = ${s.hz.toFixed(1)} Hz`
    }
    return `${head} · meter-out, choked: v ≈ C/(A − a) = ${q.vOut.toFixed(0)} mm/s, whatever the supply`
  },
  legend: [
    { color: AIR, label: 'Air: denser dots = higher pressure', shape: 'dot' },
    { color: POWER, label: 'Piston position x(t)', shape: 'dot' },
    { color: RING, label: 'Cap side A pressure', shape: 'dot' },
    { color: FORCE, label: 'Rod side B pressure', shape: 'dot' },
  ],
  points: [
    'A compressor fills a tank to ~8 bar; a regulator drops it to a steady working pressure (it can only lower it). A 5/2 solenoid valve (5 ports, 2 positions) sends that air to one end of a double-acting cylinder and vents the other end through a muffler.',
    'Force is just pressure × area: F = P·A. 1 bar on 1 mm² is 0.1 N, so a Ø32 bore at 6 bar pushes ~480 N. Retracting, the rod covers part of the piston, so only A − a is pressed: ~14 % less pull.',
    'Speed is set by flow-control valves, normally on the exhaust (meter-out): a needle chokes the air leaving, so the piston rides on a cushion and moves smoothly. Choked flow is about C·p, so speed ≈ C/A, almost independent of the supply. Open the needles and it slams to the end stop.',
    'Air compresses. Shut both ports mid-stroke (a closed-centre 5/3 valve) and the load overshoots, bounces on the trapped air, and gives when pushed: k = p·A²/V is a spring, not a lock. That is why pneumatics is great for fast end-to-end moves and grippers, poor for holding a position.',
    'Each double stroke dumps both chambers: free air ≈ (A + A − a)·stroke·(P + 1 bar)/1 bar. The compressor pays for all of it, which is why air is a costly way to make motion.',
  ],
  controls: [
    { kind: 'slider', key: 'bar', label: 'Regulator', min: 2, max: 7, step: 0.5, initial: 6, format: (v) => `${v} bar` },
    { kind: 'slider', key: 'flow', label: 'Flow control', min: 10, max: 100, step: 10, initial: 30, format: (v) => `${v} % open` },
    { kind: 'choice', key: 'mode', options: opts(MODES), initial: 'cycle' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const status = liveLabel(scene, [-13.5, 9.4, 0.4], { size: 0.4, align: 'left' })
    const foot = liveLabel(scene, [PLOT.x, PLOT.y - PLOT.h / 2 - 2.3, 0.4], { size: 0.3, color: GREY })
    const valveTag = liveLabel(scene, [VALVE.x + VALVE.w / 2 + 1.4, VALVE.y, 0.4], { size: 0.32, color: LABEL, align: 'left' })
    const regTag = liveLabel(scene, [REG.x, REG.y + 1.9, 0.4], { size: 0.3, color: LABEL })

    // Compressor + tank.
    cylinder(scene, 1, 3.4, mat('#c8402e', { rough: 0.45 }), [TANK.x, TANK.y, 0], 'x', 28)
    box(scene, [1.6, 0.9, 1], dark(), [TANK.x - 0.4, TANK.y + 1.35, 0])
    cylinder(scene, 0.42, 0.9, alu(), [TANK.x + 0.8, TANK.y + 1.35, 0], 'x', 16)
    addLabel(scene, `tank ${TANK_BAR} bar`, [TANK.x, TANK.y - 1.6, 0.4], LABEL, 0.3)
    // Regulator with a dial.
    box(scene, [1.4, 1.4, 1.2], alu(), [REG.x, REG.y, 0])
    cylinder(scene, 0.25, 0.6, dark(), [REG.x, REG.y + 1, 0], 'y', 12)
    cylinder(scene, 0.55, 0.12, mat('#f1efe6', { rough: 0.5 }), [REG.x, REG.y, 0.66], 'z', 24)
    const needle = add(scene, new THREE.Group(), [REG.x, REG.y, 0.75])
    box(needle, [0.06, 0.45, 0.04], glowMat(HIGH_V, 1), [0, 0.2, 0]).castShadow = false
    tube(scene, [[TANK.x + 1.7, TANK.y, 0], [REG.x - 0.7, REG.y, 0]], 0.13, hose(), 4)
    tube(scene, [[REG.x + 0.7, REG.y, 0], [VALVE.x - 0.3, REG.y, 0], [VALVE.x, REG.y - 0.3, 0], [VALVE.x, VALVE.y + 0.8, 0]], 0.13, hose(), 24)

    // 5/2 (or 5/3) valve: body, see-through spool slot, coils at both ends, mufflers on R and S.
    box(scene, [VALVE.w, VALVE.h, 1.6], alu(), [VALVE.x, VALVE.y, 0])
    box(scene, [VALVE.w - 1.4, 0.5, 0.1], mat('#0b1013', { rough: 0.3 }), [VALVE.x, VALVE.y, 0.81])
    const spool = add(scene, new THREE.Group(), [VALVE.x, VALVE.y, 0.88])
    for (const dx of [-2, -0.7, 0.7, 2]) box(spool, [0.5, 0.42, 0.08], STEEL(), [dx, 0, 0]).castShadow = false
    box(spool, [4.6, 0.12, 0.06], STEEL(), [0, 0, 0]).castShadow = false
    const coilMats = [glowMat(GREY, 0.2), glowMat(GREY, 0.2)]
    ;[-1, 1].forEach((s, i) => {
      box(scene, [1.1, 1.5, 1.5], dark(), [VALVE.x + s * (VALVE.w / 2 + 0.55), VALVE.y, 0])
      box(scene, [0.5, 0.5, 0.1], coilMats[i], [VALVE.x + s * (VALVE.w / 2 + 0.55), VALVE.y, 0.78]).castShadow = false
    })
    for (const [x, t] of [[VALVE.pa, 'R'], [VALVE.pb, 'S']] as const) {
      cylinder(scene, 0.28, 0.7, mat('#b08a4a', { metal: 0.3, rough: 0.6 }), [x, VALVE.y + 1.15, 0], 'y', 12)
      addLabel(scene, t, [x + 0.6, VALVE.y + 1.15, 0.4], GREY, 0.26)
    }
    addLabel(scene, 'P', [VALVE.x + 0.45, VALVE.y + 1.15, 0.4], GREY, 0.26)

    // Cylinder: end caps, tie rods, see-through barrel, piston, rod, sled on a rail.
    const capMat = alu()
    const side = CY.rb * 2 + 0.6
    box(scene, [CY.cap, side, side], capMat, [CY.x0 + CY.cap / 2, CY.y, 0])
    box(scene, [CY.cap, side, side], capMat, [XR + CY.cap / 2, CY.y, 0])
    for (const [dy, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) rod(scene, [XI, CY.y + dy * (side / 2 - 0.2), dz * (side / 2 - 0.2)], [XR, CY.y + dy * (side / 2 - 0.2), dz * (side / 2 - 0.2)], 0.07, STEEL())
    const barrel = add(scene, new THREE.Mesh(new THREE.CylinderGeometry(CY.rb + 0.08, CY.rb + 0.08, XR - XI, 32, 1, true), shellMat('#cfe6ff', 0.22)), [(XI + XR) / 2, CY.y, 0])
    barrel.rotation.z = Math.PI / 2
    barrel.castShadow = false
    const piston = add(scene, new THREE.Group(), [0, CY.y, 0])
    cylinder(piston, CY.rb - 0.03, CY.tp, alu(), [CY.tp / 2, 0, 0], 'x', 28)
    cylinder(piston, CY.rb, 0.16, mat('#1c1c1f', { rough: 0.7 }), [CY.tp / 2, 0, 0], 'x', 28)
    const rodLen = CYL_32.strokeMm * K + CYL_32.deadMm * K + CY.cap + 1.4
    cylinder(piston, CY.rr, rodLen, STEEL(), [CY.tp + rodLen / 2, 0, 0], 'x', 16)
    const sled = add(piston, new THREE.Group(), [CY.tp + rodLen + 1, 0, 0])
    box(sled, [2, 2.2, 2.4], mat('#5a6270', { rough: 0.5 }), [0, 0, 0])
    addLabel(sled, `${CYL_32.massKg} kg`, [0, 0, 1.25], LABEL, 0.34)
    const railX0 = XR + CY.cap + 1.2
    box(scene, [CYL_32.strokeMm * K + 3, 0.3, 1.4], dark(), [railX0 + (CYL_32.strokeMm * K + 3) / 2, CY.y - 1.25, 0])
    const pushArrow = arrow(scene, [0, CY.y, 1.5], [1, 0, 0], HEAT, 0.5)
    const pushTag = liveLabel(scene, [0, CY.y + 1.7, 0.4], { size: 0.32, color: HEAT })
    const kick = arrow(scene, [0, CY.y + 0.5, 1.5], [-1, 0, 0], HIGH_V, 0.5)
    const pressTags = [liveLabel(scene, [0, CY.y - 2.1, 0.4], { size: 0.3, color: RING }), liveLabel(scene, [0, CY.y - 2.1, 0.4], { size: 0.3, color: FORCE })]
    addLabel(scene, `A = Ø32: ${circleAreaMm2(32).toFixed(0)} mm²`, [XI + 1.8, CY.y - 2.9, 0.4], GREY, 0.26)
    addLabel(scene, `A − a: ${annulusAreaMm2(32, 12).toFixed(0)} mm²`, [XR - 1.6, CY.y - 2.9, 0.4], GREY, 0.26)

    // Flow controls on both ports, hoses up to the valve.
    const portA: V3 = [CY.x0 + CY.cap / 2, CY.y + side / 2, 0]
    const portB: V3 = [XR + CY.cap / 2, CY.y + side / 2, 0]
    for (const [pt, t] of [[portA, 'A'], [portB, 'B']] as const) {
      box(scene, [0.8, 1, 0.8], mat('#3a4b8c', { rough: 0.5 }), [pt[0], pt[1] + 0.5, 0])
      cylinder(scene, 0.22, 0.4, mat('#d23b3b', { rough: 0.5 }), [pt[0] + 0.55, pt[1] + 0.5, 0], 'x', 12)
      addLabel(scene, t, [pt[0] - 0.75, pt[1] + 0.5, 0.4], GREY, 0.3)
    }
    const hoseRun = (pt: V3, vx: number, y: number): V3[] => [[vx, VALVE.y - 0.8, 0], [vx, y, 0], [pt[0], y, 0], [pt[0], pt[1] + 1, 0]]
    const runA = hoseRun(portA, VALVE.pa, -0.4)
    const runB = hoseRun(portB, VALVE.pb, -0.9)
    for (const r of [runA, runB]) for (let i = 0; i < r.length - 1; i++) rod(scene, r[i], r[i + 1], 0.13, hose())
    const fz = 0.25
    const lineA = new Flow(path(runA.map(([x, y]): V3 => [x, y, fz])), 0.7, AIR, 0.11)
    const lineB = new Flow(path(runB.map(([x, y]): V3 => [x, y, fz])), 0.7, AIR, 0.11)
    const supply = new Flow(path([[TANK.x + 1.7, TANK.y, fz], [VALVE.x, REG.y, fz], [VALVE.x, VALVE.y + 0.8, fz]]), 0.7, AIR, 0.11)
    const exA = new Flow(path([[VALVE.pa, VALVE.y + 1.5, fz], [VALVE.pa - 0.4, VALVE.y + 3, fz]]), 0.45, AIR, 0.09)
    const exB = new Flow(path([[VALVE.pb, VALVE.y + 1.5, fz], [VALVE.pb + 0.4, VALVE.y + 3, fz]]), 0.45, AIR, 0.09)
    for (const f of [lineA, lineB, supply, exA, exB]) scene.add(f.mesh)

    const cloudA = dotCloud(scene, MAX_DOTS, AIR)
    const cloudB = dotCloud(scene, MAX_DOTS, AIR)
    const seed = Array.from({ length: MAX_DOTS }, (_, i) => [halton(i + 1, 2), Math.sqrt(halton(i + 1, 3)), 2 * Math.PI * halton(i + 1, 5)])

    // x(t), pA, pB over the run with a time cursor.
    const plot = scope(scene, PLOT.w, PLOT.h, { divs: [8, 4], zeroAt: 0 })
    plot.group.position.set(PLOT.x, PLOT.y, 0)
    const tX = plot.trace(POWER, { samples: 200, radius: 0.06 })
    const tA = plot.trace(RING, { samples: 200, radius: 0.045 })
    const tB = plot.trace(FORCE, { samples: 200, radius: 0.045 })
    ticks(plot, [[0, '0'], [0.5, '2'], [1, '4']], [], 0.3)
    addLabel(scene, `x 0–100 mm · p 0–8 bar · t, s`, [PLOT.x, PLOT.y - PLOT.h / 2 - 1.5, 0.3], GREY, 0.28)
    const cursor = cursorBar(plot, GREY, 0.05)

    const st = { key: '', t: 0, run: [] as CylFrame[], spool: 0 }
    const yOf = (v: number) => (v - 0.5) * PLOT.h

    return {
      scene,
      view: { center: [0, 0.3, 0], radius: 46, polar: 1.45, azimuth: 0.1 },
      frame(dt, p) {
        const q = cylParams(p)
        const key = `${q.bar}|${q.needleC}|${q.mode}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          st.run = cylRun(q)
          const us = st.run.filter((_, i) => i % 2 === 0)
          const u = us.map((f) => f.t / CYL_RUN.seconds)
          tX.points(u, us.map((f) => yOf(f.x / CYL_32.strokeMm)))
          tA.points(u, us.map((f) => yOf(f.pA / 8)))
          tB.points(u, us.map((f) => yOf(f.pB / 8)))
          valveTag.set(q.mode === 'stop' ? '5/3, closed centre' : '5/2 valve')
          regTag.set(`regulator ${q.bar} bar`)
          needle.rotation.z = 2.3 - (q.bar / 10) * 4.6
        }
        st.t = (st.t + dt / SLOW_CYL) % CYL_RUN.seconds
        const dts = dt / SLOW_CYL
        const f = fixedStepAt(st.run, st.t, CYL_RUN.dt * CYL_RUN.every)
        const xp = XI + CYL_32.deadMm * K + f.x * K
        piston.position.x = xp
        cursor(st.t / CYL_RUN.seconds)

        const aEnd = xp
        const bStart = xp + CY.tp
        const lenA = aEnd - XI
        const lenB = XR - bStart
        const kA = Math.min(MAX_DOTS, Math.round(DOTS * (f.pA + 1) * lenA))
        const kB = Math.min(MAX_DOTS, Math.round(DOTS * (f.pB + 1) * lenB * (q.Ab / q.A)))
        const wob = st.t * SLOW_CYL * 7
        const at = (x0: number, len: number, rIn: number) => (i: number): V3 => {
          const [u, r, a] = seed[i]
          const rr = rIn + (CY.rb - 0.1 - rIn) * r
          return [x0 + 0.08 + (len - 0.16) * frac(u + 0.004 * Math.sin(wob + i)), CY.y + rr * Math.cos(a + 0.05 * Math.sin(wob * 1.3 + i)), rr * Math.sin(a)]
        }
        cloudA.place(kA, at(XI, lenA, 0))
        cloudB.place(kB, at(bStart, lenB, CY.rr + 0.06))

        lineA.step(f.qA * FLOW_K * dts)
        lineB.step(f.qB * FLOW_K * dts)
        supply.step((Math.max(0, f.qA) + Math.max(0, f.qB)) * FLOW_K * dts)
        exA.mesh.visible = f.qA < -0.02
        exB.mesh.visible = f.qB < -0.02
        exA.step(-f.qA * FLOW_K * dts)
        exB.step(-f.qB * FLOW_K * dts)

        const target = f.valve === 'extend' ? -0.6 : f.valve === 'retract' ? 0.6 : 0
        st.spool = glide(dt, st.spool, target, 18)
        spool.position.x = VALVE.x + st.spool
        setGlow(coilMats[0], f.valve === 'extend' ? HIGH_V : GREY, f.valve === 'extend' ? 1.2 : 0.2)
        setGlow(coilMats[1], f.valve === 'retract' ? HIGH_V : GREY, f.valve === 'retract' ? 1.2 : 0.2)

        const net = pressForceN(f.pA, q.A) - pressForceN(f.pB, q.Ab)
        const sledX = xp + CY.tp + rodLen + 1
        pushArrow.visible = Math.abs(net) > 20
        pushArrow.position.set(sledX + (net > 0 ? 1.6 : -1.6), CY.y, 1.5)
        pushArrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(net > 0 ? 1 : -1, 0, 0))
        pushTag.group.position.x = sledX
        pushTag.set(Math.abs(net) > 20 ? `${net > 0 ? 'push' : 'pull'} ${Math.abs(net).toFixed(0)} N` : '')
        kick.visible = f.pushN > 0
        kick.position.set(sledX + 2.6, CY.y + 0.5, 1.5)
        pressTags[0].group.position.x = XI + lenA / 2
        pressTags[1].group.position.x = bStart + lenB / 2
        pressTags[0].set(`A ${f.pA.toFixed(1)} bar`)
        pressTags[1].set(`B ${f.pB.toFixed(1)} bar`)
        status.set(f.pushN > 0 ? `${CYL_RUN.pushN} N shove: the air gives` : STATUS[f.valve], f.valve === 'hold' ? HEAT : POWER)
        foot.set(`t = ${st.t.toFixed(2)} s · ${SLOW_CYL}× slower · x ${f.x.toFixed(0)} mm`)
      },
      readouts: (p) => {
        const q = cylParams(p)
        const run = cylRun(q)
        const s = strokeStats(run)
        const spring = holdSpring(run)
        return [
          { label: 'Extend force', value: `${q.fExt.toFixed(0)} N (P·A)` },
          { label: 'Retract force', value: `${q.fRet.toFixed(0)} N (P·(A − a))` },
          q.mode === 'stop'
            ? { label: 'Air spring', value: `${spring.k.toFixed(1)} N/mm, ${spring.hz.toFixed(1)} Hz`, tone: 'warn' }
            : { label: 'Stroke', value: Number.isFinite(s.strokeS) ? `${s.strokeS.toFixed(2)} s, ${s.mmS.toFixed(0)} mm/s` : 'too slow for 2 s', tone: s.mmS > 300 ? 'warn' : undefined },
          { label: 'Air / cycle', value: `${airPerCycleNl(CYL_32.boreMm, CYL_32.rodMm, CYL_32.strokeMm, q.bar).toFixed(2)} Nl free air` },
        ]
      },
    }
  },
}

// --- Soft gripper: a PneuNet finger curls when its chambers inflate against a strain-limiting layer; it can't crush. ---

const KINDS = { soft: 'Soft PneuNet', rigid: 'Rigid jaws', jamming: 'Jamming bag' }
const OBJECTS = { egg: 'Egg', berry: 'Strawberry', steel: 'Steel ball' }
const OBJ_LOOK = { egg: { color: '#f3e7cf', sy: 1.28 }, berry: { color: '#d8263a', sy: 1.15 }, steel: { color: '#b9bec6', sy: 1 } }
const KS = 0.075
const SG = { objY: -1.6, up: 4.2, lift: 3, chambers: 9, cycle: 9, plotX: 8.4, plotY: 0.6, plotW: 7, plotH: 3.8 }
const PHASES: [number, string][] = [
  [1.2, 'lowering around it'],
  [2.8, 'squeezing'],
  [4, 'lifting'],
  [5.2, 'holding up'],
  [6.4, 'setting down'],
  [7.6, 'letting go'],
  [9, 'rising'],
]
const phaseAt = (t: number) => {
  const s = (a: number, b: number) => smoothstep(Math.min(1, Math.max(0, (t - a) / (b - a))))
  const act = s(1.2, 2.8) * (1 - s(6.4, 7.6))
  const rig = SG.up * (1 - s(0, 1.2)) + SG.lift * (s(2.8, 4) - s(5.2, 6.4)) + SG.up * s(7.6, 9)
  return { act, rig, lifted: s(2.8, 4) - s(5.2, 6.4), name: PHASES.find(([end]) => t < end)?.[1] ?? 'rising' }
}
const gripParams = (p: Params) => {
  const kind = pick(KINDS, p.kind, 'soft') as GripperKind
  const obj = pick(OBJECTS, p.obj, 'egg')
  const squeeze = n(p, 'squeeze') / 100
  const o = GRIP_OBJECTS[obj]
  return { kind, obj, squeeze, o, full: gripOutcome(kind, squeeze, o), contact: pneuNetContact(o.radiusMm) }
}
type GripQ = ReturnType<typeof gripParams>
const driveText = (kind: GripperKind, v: number) => (kind === 'soft' ? `${v.toFixed(0)} kPa` : kind === 'rigid' ? `${v.toFixed(0)} N` : `−${v.toFixed(0)} kPa`)
const stressText = (kpa: number) => (kpa >= 1e5 ? 'no limit' : kpa >= 1000 ? `${(kpa / 1000).toFixed(1)} MPa` : `${kpa.toFixed(kpa < 10 ? 1 : 0)} kPa`)

/** Arc of a finger hanging from (s0, 0), heading down and curling toward −x with curvature κ: point and heading at arc length s. */
const fingerAt = (s0: number, curv: number, s: number): [number, number, number] => {
  const psi = -Math.PI / 2 - curv * s
  if (curv < 1e-6) return [s0, -s, psi]
  return [s0 - (Math.sin(psi) + 1) / curv, (Math.cos(psi) - 0) / curv, psi]
}

function pneuNetFinger(parent: THREE.Object3D, side: 1 | -1, chamberMat: THREE.Material, postR: number) {
  const g = add(parent, new THREE.Group())
  const seg = (PNEUNET.lengthMm * KS) / SG.chambers
  const depth = PNEUNET.widthMm * KS
  const body = mat('#dfe9ee', { rough: 0.6 })
  const layer = mat('#f4e9b8', { rough: 0.8 })
  const parts = Array.from({ length: SG.chambers }, () => ({
    back: box(g, [seg, 3.5 * KS, depth], body),
    lay: box(g, [seg, 1.2 * KS, depth * 1.02], layer),
    ch: box(g, [seg * 0.72, 1, depth * 0.9], chamberMat),
  }))
  return (s0: number, curv: number, inflate: number) => {
    parts.forEach((pt, i) => {
      const [x, y, psi] = fingerAt(s0, curv, (i + 0.5) * seg)
      const ang = side > 0 ? psi : Math.PI - psi
      const nIn = side > 0 ? psi - Math.PI / 2 : Math.PI - (psi - Math.PI / 2)
      const ox = Math.cos(nIn)
      const oy = Math.sin(nIn)
      const px = side * x
      const place = (m: THREE.Mesh, off: number) => {
        m.position.set(px + ox * off, y + oy * off, side * (depth / 2 + postR + 0.1))
        m.rotation.z = ang
      }
      place(pt.lay, 0.6 * KS)
      place(pt.back, -2.3 * KS)
      const h = 12 * KS * (1 + 0.45 * inflate)
      pt.ch.scale.set(1 + 0.3 * inflate, h, 1 + 0.15 * inflate)
      place(pt.ch, -4 * KS - h / 2)
    })
  }
}

export const softGripper: Lesson = {
  id: 'pneumatics-soft-robots-soft-gripper',
  title: 'Soft gripper',
  tagline: 'Inflatable fingers that wrap around things',
  formula: (p) => {
    const q = gripParams(p)
    const f = q.full
    if (q.kind === 'soft') {
      const P = f.drive
      return `ε = (P/E)·(r/t)·φ, κ = ε/h → θ = κ·L = ${((pneuNetBendRad(P) * 180) / Math.PI).toFixed(0)}° free · touches at ${q.contact.pKPa.toFixed(0)} kPa · F = A·h·(P − Pc)/s = ${f.normalN.toFixed(2)} N · σ = F/A = ${stressText(f.stressKPa)} vs ${stressText(q.o.crushKPa)}`
    }
    if (q.kind === 'rigid') return `σ = F/A = ${f.normalN.toFixed(0)} N / ${GRIPPERS.rigid.areaMm2} mm² = ${stressText(f.stressKPa)} vs ${stressText(q.o.crushKPa)} to crack · grip 2μF = ${f.holdN.toFixed(1)} N vs mg ${f.weight.toFixed(2)} N`
    return `hold ≈ ΔP·πR²·k = ${f.drive.toFixed(0)} kPa × ${(Math.PI * q.o.radiusMm ** 2).toFixed(0)} mm² × 0.3 = ${jammingHoldN(f.drive, q.o.radiusMm).toFixed(1)} N vs mg ${f.weight.toFixed(2)} N · stress ≤ ΔP`
  },
  legend: (p) => {
    const kind = pick(KINDS, p.kind, 'soft')
    const parts: LegendItem[] =
      kind === 'soft'
        ? [
            { color: AIR, label: 'Air in the chambers', shape: 'dot' },
            { color: RING, label: 'Strain-limiting layer', shape: 'dot' },
          ]
        : kind === 'rigid'
          ? [{ color: HEAT, label: 'Servo jaw force', shape: 'dot' }]
          : [
              { color: AIR, label: 'Vacuum line', shape: 'dot' },
              { color: '#a07a4a', label: 'Grains: flow, then lock', shape: 'dot' },
            ]
    return [...parts, { color: POWER, label: 'Holds: friction ≥ weight', shape: 'dot' }, { color: HIGH_V, label: 'Slips or crushes', shape: 'dot' }]
  },
  points: [
    'A PneuNet finger is cast silicone with a row of chambers along one side and a strain-limiting layer (paper, fabric, stiffer rubber) along the other. Inflate it and the chamber walls stretch, but the layer can\'t, so the finger has to curl toward the layer.',
    'Curvature grows with pressure: κ = ε/h, with the wall strain ε ∝ P/E. Doubling the pressure doubles the curl; ~50 kPa (half a bar) curls this 90 mm finger through ~180°. A cheap 12 V pump and a solenoid valve drive it.',
    'Once the finger touches the object it stops bending; the extra pressure becomes grip. Because force comes from pressure on soft walls, the stress on the object can never exceed a few kPa: an egg or a strawberry is safe whatever the code does.',
    'A rigid jaw on a servo puts its whole force on a few mm² of hard contact: 40 N on 4 mm² is 10 MPa. It needs force control tuned to each object, or it cracks the egg. In return it holds a heavy steel ball that would slip out of soft fingers.',
    'A jamming gripper is a bag of grains (coffee, glass beads): pressed onto an object it flows around it, then a vacuum locks the grains solid, holding by shape and friction. Soft grippers trade strength and precision for safety and tolerance to shape.',
  ],
  controls: [
    { kind: 'choice', key: 'kind', options: opts(KINDS), initial: 'soft' },
    { kind: 'choice', key: 'obj', options: opts(OBJECTS), initial: 'egg' },
    { kind: 'slider', key: 'squeeze', label: 'Squeeze', min: 0, max: 100, step: 5, initial: 80, format: (v) => `${v} % of full` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const holder = add(scene, new THREE.Group())
    const status = liveLabel(scene, [-13.5, 9.4, 0.4], { size: 0.42, align: 'left' })
    const foot = liveLabel(scene, [SG.plotX, SG.plotY - SG.plotH / 2 - 2.3, 0.4], { size: 0.3, color: GREY })
    const driveTag = liveLabel(scene, [-13.5, 8.3, 0.4], { size: 0.36, color: AIR, align: 'left' })
    const objTag = liveLabel(scene, [-2, SG.objY - 4, 2.3], { size: 0.32 })
    const plotCap = liveLabel(scene, [SG.plotX, SG.plotY - SG.plotH / 2 - 1.5, 0.3], { size: 0.28, color: GREY })
    const plotTop = liveLabel(scene, [SG.plotX, SG.plotY + SG.plotH / 2 + 0.9, 0.3], { size: 0.3, color: LABEL })

    const plot = scope(scene, SG.plotW, SG.plotH, { divs: [6, 4], zeroAt: 0 })
    plot.group.position.set(SG.plotX, SG.plotY, 0)
    const curve = plot.trace(AIR, { samples: 60, radius: 0.06 })
    const crushLine = plot.level(HIGH_V)
    const touchBar = cursorBar(plot, RING, 0.06)

    let fingers: ((s0: number, curv: number, inflate: number) => void)[] = []
    let jaws: THREE.Object3D[] = []
    let grains: ReturnType<typeof dotCloud> | null = null
    let grainSeed: V3[] = []
    let bagR = 0
    let rig = new THREE.Group()
    let obj = new THREE.Group()
    let objMat = mat('#ffffff', {}, true)
    let air: Flow | null = null
    const chamberMat = new THREE.MeshStandardMaterial({ color: '#e9f4fb', emissive: AIR, emissiveIntensity: 0, roughness: 0.5, transparent: true, opacity: 0.92 })
    const st = { key: '', t: 0, crushed: false, act: 0 }

    const rebuild = (q: GripQ) => {
      emptyGroup(holder)
      const R = q.o.radiusMm * KS
      rig = add(holder, new THREE.Group(), [-2, 0, 0])
      obj = add(holder, new THREE.Group(), [-2, SG.objY, 0])
      const look = OBJ_LOOK[q.obj]
      objMat = mat(look.color, q.obj === 'steel' ? { metal: 0.45, rough: 0.3 } : { rough: 0.55 }, true)
      const ball = add(obj, new THREE.Mesh(new THREE.SphereGeometry(R, 32, 20), objMat))
      ball.scale.y = look.sy
      ball.castShadow = true
      const bottom = SG.objY - R * look.sy
      box(holder, [7, 0.4, 4], mat('#3a3d45', { rough: 0.7 }), [-2, bottom - 2.6, 0])
      cylinder(holder, R * 0.3, 2.4, dark(), [-2, bottom - 1.2, 0], 'y', 16)
      objTag.group.position.y = bottom - 3.4
      if (q.obj === 'berry') {
        for (let k = 0; k < 5; k++) {
          const leaf = box(obj, [0.5, 0.06, 0.18], mat('#3fa34d', { rough: 0.6 }), [0.22 * Math.cos((k * 2 * Math.PI) / 5), R * look.sy - 0.05, 0.22 * Math.sin((k * 2 * Math.PI) / 5)])
          leaf.rotation.y = (-k * 2 * Math.PI) / 5
        }
      }
      // Palm + lift rod.
      const palmW = q.kind === 'jamming' ? 3.2 : 2 * (R + PNEUNET.gapMm * KS) + 2.4
      box(rig, [palmW, 1, 2.2], alu(), [0, 0.5, 0])
      rod(rig, [0, 1, 0], [0, 12, 0], 0.3, STEEL())
      fingers = []
      jaws = []
      grains = null
      if (q.kind === 'soft') {
        fingers = [pneuNetFinger(rig, 1, chamberMat, R * 0.3), pneuNetFinger(rig, -1, chamberMat, R * 0.3)]
        tube(rig, [[0.4, 1, 0.9], [1.2, 2.6, 0.9], [1.4, 6, 0.9]], 0.12, hose(), 20)
        air = new Flow(path([[1.4, 6, 1.05], [1.2, 2.6, 1.05], [0.4, 1, 1.05]]), 0.5, AIR, 0.1)
        rig.add(air.mesh)
      } else if (q.kind === 'rigid') {
        box(rig, [1.4, 0.9, 1.6], dark(), [0, 1.5, 0])
        for (const s of [1, -1]) {
          const jaw = add(rig, new THREE.Group())
          box(jaw, [0.5, PNEUNET.depthMm * KS + R, 1.8], STEEL(), [s * 0.25, -(PNEUNET.depthMm * KS + R) / 2, 0])
          jaws.push(jaw)
        }
        air = null
      } else {
        bagR = R * 1.75
        const bag = add(rig, new THREE.Mesh(new THREE.SphereGeometry(bagR, 32, 20), shellMat('#d8d2c4', 0.28)), [0, -bagR, 0])
        bag.castShadow = false
        grains = dotCloud(rig, 420, '#a07a4a', 0.12)
        grainSeed = Array.from({ length: 420 }, (_, i): V3 => {
          const r = bagR * 0.92 * Math.cbrt(halton(i + 1, 2))
          const th = Math.acos(2 * halton(i + 1, 3) - 1)
          const ph = 2 * Math.PI * halton(i + 1, 5)
          return [r * Math.sin(th) * Math.cos(ph), -bagR + r * Math.cos(th), r * Math.sin(th) * Math.sin(ph)]
        })
        tube(rig, [[0.4, 1, 0.9], [1.2, 2.6, 0.9], [1.4, 6, 0.9]], 0.12, hose(), 20)
        air = new Flow(path([[0.4, 1, 1.05], [1.2, 2.6, 1.05], [1.4, 6, 1.05]]), 0.5, AIR, 0.1)
        rig.add(air.mesh)
      }
      const yOf = (v: number) => (Math.max(0, Math.min(1, v)) - 0) * SG.plotH - SG.plotH / 2
      if (q.kind === 'soft') {
        curve.draw((u) => yOf((pneuNetBendRad(u * GRIPPERS.soft.full) * 180) / Math.PI / 270), null)
        touchBar(q.contact.pKPa / GRIPPERS.soft.full)
        crushLine.set(99)
        plotTop.set('bend angle vs pressure')
        plotCap.set(`θ 0–270° · P 0–${GRIPPERS.soft.full} kPa`)
      } else {
        const logY = (kpa: number) => yOf((Math.log10(Math.max(0.1, kpa)) + 1) / 6)
        curve.draw((u) => logY(gripOutcome(q.kind, u, q.o).stressKPa), null)
        touchBar(null)
        crushLine.set(logY(q.o.crushKPa))
        plotTop.set('contact stress vs squeeze')
        plotCap.set('0.1 kPa – 100 MPa, log · red: crush')
      }
    }

    const grasp = (q: GripQ) => (q.kind === 'jamming' ? SG.objY + bagR * 1.75 : SG.objY + PNEUNET.depthMm * KS)

    return {
      scene,
      view: { center: [0, 0.3, 0], radius: 46, polar: 1.45, azimuth: 0.12 },
      frame(dt, p) {
        const q = gripParams(p)
        const key = `${q.kind}|${q.obj}|${q.squeeze}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          rebuild(q)
        }
        st.t = (st.t + dt) % SG.cycle
        if (st.t < 1.2) st.crushed = false
        const ph = phaseAt(st.t)
        const out = gripOutcome(q.kind, q.squeeze * ph.act, q.o)
        if (out.crushed && ph.act > 0.05) st.crushed = true
        const holds = q.full.holds && !st.crushed
        const R = q.o.radiusMm * KS
        const gy = grasp(q)
        rig.position.y = gy + ph.rig
        const look = OBJ_LOOK[q.obj]
        const squash = st.crushed ? (q.obj === 'egg' ? 0.72 : 0.8) : 1
        obj.position.y = SG.objY + (holds ? ph.lifted * SG.lift : 0) - R * look.sy * (1 - squash)
        obj.scale.set(st.crushed ? 1.15 : 1, squash, st.crushed ? 1.1 : 1)
        objMat.color.set(st.crushed ? (q.obj === 'egg' ? '#e2c27a' : '#7a1020') : look.color)
        const dAct = ph.act - st.act
        st.act = ph.act

        if (q.kind === 'soft') {
          const P = out.drive
          const free = pneuNetCurvature(P)
          const touching = ph.rig < 0.05 || holds
          const curv = Math.min(touching ? Math.min(free, q.contact.curv) : free, (0.88 * Math.PI) / PNEUNET.lengthMm)
          const s0 = R + PNEUNET.gapMm * KS
          fingers.forEach((f) => f(s0, curv / KS, P / GRIPPERS.soft.full))
          chamberMat.emissiveIntensity = 0.1 + 0.9 * (P / GRIPPERS.soft.full)
          curve.draw((u) => (Math.min(1, (pneuNetBendRad(u * GRIPPERS.soft.full) * 180) / Math.PI / 270)) * SG.plotH - SG.plotH / 2, P / GRIPPERS.soft.full)
          driveTag.set(`${P.toFixed(0)} kPa · θ ${((pneuNetBendRad(P) * 180) / Math.PI).toFixed(0)}° free${free > q.contact.curv && touching ? ' · blocked' : ''}`)
        } else if (q.kind === 'rigid') {
          const close = ph.act > 0.02 ? Math.min(1, ph.act * 4) : 0
          const open = R + 1.2
          const x = st.crushed ? R * 0.72 : open - (open - R) * close
          jaws.forEach((j, i) => (j.position.x = (i === 0 ? 1 : -1) * (x + 0.0)))
          driveTag.set(`servo ${out.drive.toFixed(0)} N on ${GRIPPERS.rigid.areaMm2} mm²`, HEAT)
          const logY = (kpa: number) => ((Math.log10(Math.max(0.1, kpa)) + 1) / 6) * SG.plotH - SG.plotH / 2
          curve.draw((u) => logY(gripOutcome('rigid', u, q.o).stressKPa), q.squeeze * ph.act)
        } else if (grains) {
          const dent = Math.max(0, 1 - ph.rig / 1.5)
          const lock = ph.act
          const oy = SG.objY - (rig.position.y)
          grains.place(420, (i) => {
            const [x, y, z] = grainSeed[i]
            const d = Math.hypot(x, y - oy, z)
            const need = R * look.sy + 0.12
            const push = d < need ? (need - d) * dent : 0
            const k = 1 - 0.06 * lock
            const nx = d > 1e-6 ? x / d : 0
            const ny = d > 1e-6 ? (y - oy) / d : 1
            const nz = d > 1e-6 ? z / d : 0
            return [(x + nx * push) * k, -bagR + (y + bagR + ny * push) * k, (z + nz * push) * k]
          })
          setGlow(grains.mesh.material as THREE.MeshStandardMaterial, lock > 0.5 ? '#6b4a26' : '#a07a4a', 0.2 + 0.4 * lock)
          driveTag.set(`−${out.drive.toFixed(0)} kPa · grains ${lock > 0.5 ? 'locked' : 'flow'}`)
          const logY = (kpa: number) => ((Math.log10(Math.max(0.1, kpa)) + 1) / 6) * SG.plotH - SG.plotH / 2
          curve.draw((u) => logY(gripOutcome('jamming', u, q.o).stressKPa), q.squeeze * ph.act)
        }
        if (air) {
          air.mesh.visible = Math.abs(dAct) > 1e-4
          air.step(dAct * 400)
        }
        const verdict = st.crushed ? (q.obj === 'egg' ? 'cracked' : 'crushed') : ph.act < 0.3 ? '' : holds ? 'held' : 'slips out'
        objTag.set(`${OBJECTS[q.obj].toLowerCase()} ${q.o.massG} g${verdict ? ` · ${verdict}` : ''}`, st.crushed || (!holds && ph.act >= 0.3) ? HIGH_V : verdict ? POWER : LABEL)
        status.set(`${KINDS[q.kind]}: ${ph.name}`, st.crushed ? HIGH_V : POWER)
        foot.set(`t = ${st.t.toFixed(1)} / ${SG.cycle} s, real time`)
      },
      readouts: (p) => {
        const q = gripParams(p)
        const f = q.full
        return [
          { label: q.kind === 'rigid' ? 'Servo force' : q.kind === 'soft' ? 'Pressure' : 'Vacuum', value: driveText(q.kind, f.drive) },
          q.kind === 'soft'
            ? { label: 'Bend', value: `${((pneuNetBendRad(f.drive) * 180) / Math.PI).toFixed(0)}° free, touches at ${q.contact.pKPa.toFixed(0)} kPa` }
            : { label: 'Grip', value: f.crushed ? 'crushes it first' : `${f.holdN.toFixed(1)} N holding` },
          { label: 'Contact stress', value: `${stressText(f.stressKPa)} / ${stressText(q.o.crushKPa)}`, tone: f.crushed ? 'bad' : 'ok' },
          { label: 'Grip vs weight', value: `${f.holdN.toFixed(2)} N vs ${f.weight.toFixed(2)} N`, tone: f.holds ? 'ok' : 'bad' },
        ]
      },
    }
  },
}
