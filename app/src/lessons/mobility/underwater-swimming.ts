import * as THREE from 'three/webgpu'
import {
  ALLOC,
  AXES,
  BuoyFrame,
  DEG,
  ROV,
  ROV_DYN,
  RovFrame,
  T200,
  THRUSTERS,
  WATERS,
  WaterKind,
  Wrench,
  allocate,
  buoyRun,
  buoyancyN,
  capForce,
  dragN,
  fixedStepAt,
  gaugeAt,
  leadForTrim,
  netKg,
  pressureAt,
  rightingMoment,
  rollPeriod,
  rovRun,
  rovTrim,
  thrustWrench,
  toDeg,
  topSpeed,
  topYawRate,
  weightN,
  wrapPi,
} from '../../core/physics'
import { signed } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, FORCE, GREY, HEAT, HIGH_V, LABEL, POWER, RING, SIDE_VIEW, addLabel, flatBox, glowMat, liveLabel, memoBy, rovModel, statusHeader, stretchArrow, tiltRig, waterTank } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const WATER_NAMES = { fresh: 'Fresh water (pool)', salt: 'Salt water (sea)' }
const degText = (a: number) => `${Math.round(toDeg(wrapPi(a))) || 0}°`
const bar = (pa: number) => `${(pa / 1e5).toFixed(3)} bar`
const kg = (v: number, digits = 2) => `${signed(v, digits)} kg`

function toScene(o: THREE.Object3D, p: V3): V3 {
  const w = o.localToWorld(new THREE.Vector3(...p))
  return [w.x, w.y, w.z]
}

// --- Buoyancy: ρ·V·g vs m·g, foam and lead trim, B above G rights it, fresh vs salt, pressure with depth. ---

const LAYOUTS = { top: 'Foam on top, lead low', low: 'Foam low, lead on top' }
const BY = { tank: [-10.6, 2.9, 0] as V3, k: 10.5, tilt: 0.1, size: [0.6, 1, 1] as V3, seconds: 20, depth0: 0.5, roll0: 30 * DEG, gap: 3, cols: [-1.6, 5, 8.7, 12.8], rows: [1.2, 0.2, -0.8, -2.1], bar: { x: -1.6, w: 14.2, y: [-3.9, -4.9] }, fMax: 130 }
const byParams = (p: Params) => {
  const water = pick(WATER_NAMES, p.water, 'fresh') as WaterKind
  return { water, rho: WATERS[water], foam: n(p, 'foam'), lead: n(p, 'lead'), foamLow: pick(LAYOUTS, p.layout, 'top') === 'low' }
}
type ByQ = ReturnType<typeof byParams>
const byKey = (q: ByQ) => `${q.rho}|${q.foam}|${q.lead}|${q.foamLow}`
const byRun = memoBy(byKey, (q: ByQ) => buoyRun({ trim: q, rho: q.rho, seconds: BY.seconds, depth0: BY.depth0, roll0: BY.roll0, tank: BY.size[2] }))
const liftKg = (rho: number, mass: number, volume: number) => netKg(buoyancyN(rho, volume) - weightN(mass))

export const buoyancyLesson: Lesson = {
  id: 'underwater-swimming-buoyancy',
  title: 'Buoyancy',
  tagline: 'Trim an ROV to hover, and keep it upright for free',
  formula: (p) => {
    const q = byParams(p)
    const t = rovTrim(q, q.rho)
    return `B = ρ·V·g = ${q.rho}·${(t.volume * 1000).toFixed(2)} L·g = ${t.buoyancy.toFixed(1)} N · W = m·g = ${t.weight.toFixed(1)} N · righting = B·BG·sin φ · p = p₀ + ρ·g·h`
  },
  legend: [
    { color: B_FIELD, label: 'Buoyancy B = ρVg, acts at B (volume centre)', shape: 'dot' },
    { color: HEAT, label: 'Weight W = mg, acts at G (mass centre)', shape: 'dot' },
    { color: '#d9a521', label: 'Subsea foam: 1 L, 0.3 kg', shape: 'dot' },
    { color: '#6f7378', label: 'Lead bar: 0.2 kg', shape: 'dot' },
  ],
  points: [
    'Water pushes up on anything in it with the weight of the water it displaces: B = ρ·V·g (Archimedes). The ROV sinks if its weight m·g is bigger, floats up if smaller, and hovers when the two match. This hull (tubes, frame, electronics, battery) is 10 kg but displaces only 8.8 L, so on its own it sinks.',
    'Trimming is a shopping list: subsea foam (0.3 kg per litre) adds a lot of volume for little mass, lead adds mass for almost no volume. Pilots trim slightly positive, a few grams, so a dead ROV drifts up to the surface instead of sinking out of reach; the thrusters handle the rest.',
    'Where the foam and lead sit matters as much as how much. Foam high lifts the centre of buoyancy B, lead low drops the centre of mass G. Rolled, B and W form a couple B·BG·sin φ that swings it back: passive righting, no gyro or thrust needed. Fully underwater, B is the metacentre. Swap them (foam low, lead high) and the couple tips it over until it hangs upside down.',
    'Salt water is 2.5 % denser, so the same ROV is about 0.3 kg lighter in the sea: it needs two more lead bars than in a pool. Pressure grows by about 1 bar every 10 m: at the 100 m rating a 4" end cap carries close to a tonne of force, which is why the hull is thick acrylic or aluminium with O-ring seals.',
  ],
  controls: [
    { kind: 'choice', key: 'water', options: opts(WATER_NAMES), initial: 'fresh' },
    { kind: 'choice', key: 'layout', options: opts(LAYOUTS), initial: 'top' },
    { kind: 'slider', key: 'foam', label: 'Foam blocks', min: 0, max: 6, step: 1, initial: 3, format: (v) => `${v} × 1 L` },
    { kind: 'slider', key: 'lead', label: 'Lead bars', min: 0, max: 16, step: 1, initial: 5, format: (v) => `${v} × 0.2 kg` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const { g, holder } = tiltRig(scene, BY.tank, BY.k, BY.tilt)
    const [sx, sy, depth] = BY.size
    waterTank(holder, BY.size)
    const rov = rovModel(holder)
    rov.set([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])
    const bArrow = stretchArrow(holder, B_FIELD, 0.006)
    const wArrow = stretchArrow(holder, HEAT, 0.006)
    const dot = (c: string) => {
      const m = add(holder, new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 10), glowMat(c, 1)))
      m.castShadow = false
      return m
    }
    const bDot = dot(B_FIELD)
    const gDot = dot(HEAT)
    g.updateMatrixWorld(true)
    const tickM = glowMat(GREY, 0.5)
    for (let d = 0; d <= depth + 1e-9; d += 0.25) {
      flatBox(holder, [0.004, 0.05, 0.004], tickM, [-sx / 2, -sy / 2 - 0.03, -d])
      const at = toScene(holder, [-sx / 2, -sy / 2 - 0.07, -d])
      addLabel(scene, `${d.toFixed(2)} m`, [at[0], at[1], 0.3], GREY, 0.26, 'left')
    }
    const bLabel = liveLabel(scene, [0, 0, 0.6], { size: 0.32, color: B_FIELD, align: 'left' })
    const wLabel = liveLabel(scene, [0, 0, 0.6], { size: 0.32, color: HEAT, align: 'left' })
    const pLabel = liveLabel(scene, [0, 0, 0.3], { size: 0.28, align: 'right' })

    const [c0, c1, c2, c3] = BY.cols
    addLabel(scene, 'part', [c0, BY.rows[0] + 1.1, 0.3], LABEL, 0.3, 'left')
    addLabel(scene, 'mass', [c1, BY.rows[0] + 1.1, 0.3], LABEL, 0.3)
    addLabel(scene, 'volume', [c2, BY.rows[0] + 1.1, 0.3], LABEL, 0.3)
    addLabel(scene, 'lift', [c3, BY.rows[0] + 1.1, 0.3], LABEL, 0.3, 'right')
    const rowText = BY.rows.map((y) => [liveLabel(scene, [c0, y, 0.3], { size: 0.32, align: 'left' }), liveLabel(scene, [c1, y, 0.3], { size: 0.32 }), liveLabel(scene, [c2, y, 0.3], { size: 0.32 }), liveLabel(scene, [c3, y, 0.3], { size: 0.32, align: 'right' })])
    flatBox(scene, [c3 - c0, 0.05, 0.05], glowMat(GREY, 0.4), [(c0 + c3) / 2, BY.rows[3] + 0.55, 0])
    const { x: bx, w: bw } = BY.bar
    const fills = BY.bar.y.map((y, i) => {
      flatBox(scene, [bw + 0.3, 0.8, 0.2], glowMat('#1c1e24', 0.1), [bx + bw / 2, y, -0.15])
      return flatBox(scene, [1, 0.5, 0.25], glowMat(i ? HEAT : B_FIELD, 0.8), [bx, y, 0])
    })
    const barText = BY.bar.y.map((y, i) => liveLabel(scene, [bx + 0.3, y, 0.4], { size: 0.3, color: i ? '#2a1a10' : '#0f2a30', align: 'left' }))
    const netText = liveLabel(scene, [bx, -6.1, 0.3], { size: 0.32, align: 'left' })
    const rightText = liveLabel(scene, [bx, -7.1, 0.3], { size: 0.3, align: 'left' })

    const st = { key: '', t: 0 }
    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = byParams(p)
        const run = byRun(q)
        const tr = rovTrim(q, q.rho)
        if (byKey(q) !== st.key) {
          st.key = byKey(q)
          st.t = 0
        }
        st.t += dt
        if (st.t > BY.seconds + 1) st.t = 0
        const t = Math.min(st.t, BY.seconds)
        const f: BuoyFrame = fixedStepAt(run, t, 0.01)
        rov.trim(q.foam, q.lead, q.foamLow)
        rov.group.position.z = -f.depth
        rov.body.rotation.x = f.roll
        const mid = (tr.zB + tr.zG) / 2
        const vis = (z: number): V3 => {
          const zz = mid + (z - mid) * BY.gap
          return [-sx / 2 + 0.04, -Math.sin(f.roll) * zz, -f.depth + Math.cos(f.roll) * zz]
        }
        const pb = vis(tr.zB)
        const pg = vis(tr.zG)
        bDot.position.set(...pb)
        gDot.position.set(...pg)
        const len = (F: number) => 0.04 + (0.18 * Math.min(F, BY.fMax)) / BY.fMax
        bArrow(pb, [pb[0], pb[1], pb[2] + len(tr.buoyancy)])
        wArrow(pg, [pg[0], pg[1], pg[2] - len(tr.weight)])
        const bTip = toScene(holder, [pb[0], pb[1] - 0.03, pb[2] + len(tr.buoyancy) * 0.7])
        const wTip = toScene(holder, [pg[0], pg[1] - 0.03, pg[2] - len(tr.weight) * 0.7])
        bLabel.group.position.set(bTip[0], bTip[1], 0.6)
        wLabel.group.position.set(wTip[0], wTip[1], 0.6)
        bLabel.set(`B ${tr.buoyancy.toFixed(1)} N`, B_FIELD)
        wLabel.set(`W ${tr.weight.toFixed(1)} N`, HEAT)
        const side = toScene(holder, [0, 0.2, -f.depth + 0.12])
        pLabel.group.position.set(side[0], side[1], 0.3)
        pLabel.set(`${bar(pressureAt(q.rho, f.depth))} abs`, LABEL)

        const r = ROV
        const rows: [string, number, number][] = [
          ['hull', r.mass, r.volume],
          [`foam × ${q.foam}`, q.foam * r.foam.mass, q.foam * r.foam.volume],
          [`lead × ${q.lead}`, q.lead * r.lead.mass, q.lead * r.lead.volume],
          ['total', tr.mass, tr.volume],
        ]
        rows.forEach(([name, m, v], i) => {
          const lift = liftKg(q.rho, m, v)
          const c = i === 3 ? (Math.abs(lift) < 0.05 ? POWER : lift > 0 ? RING : HEAT) : LABEL
          rowText[i][0].set(name, i === 3 ? LABEL : [LABEL, '#d9a521', '#9aa0a8'][i])
          rowText[i][1].set(`${m.toFixed(2)} kg`, c === LABEL ? LABEL : c)
          rowText[i][2].set(`${(v * 1000).toFixed(2)} L`, c === LABEL ? LABEL : c)
          rowText[i][3].set(kg(lift), lift >= 0 ? (i === 3 ? c : POWER) : i === 3 ? c : HEAT)
        })
        ;[tr.buoyancy, tr.weight].forEach((F, i) => {
          const k = Math.min(1, F / BY.fMax) * bw
          fills[i].scale.x = Math.max(0.01, k)
          fills[i].position.x = bx + k / 2
          barText[i].set(i ? `W = m·g = ${tr.weight.toFixed(1)} N` : `B = ρ·V·g = ${tr.buoyancy.toFixed(1)} N`)
        })
        const nk = netKg(tr.net)
        const neutral = Math.abs(nk) < 0.05
        netText.set(neutral ? `net ${signed(tr.net, 2)} N: neutral, hovers (${Math.round(nk * 1000)} g)` : `net ${signed(tr.net, 1)} N (${kg(nk)}): ${tr.net > 0 ? 'floats up' : 'sinks'}`, neutral ? POWER : tr.net > 0 ? RING : HEAT)
        const tq = rightingMoment(tr, BY.roll0)
        rightText.set(tr.bg > 0 ? `B ${(tr.bg * 1000).toFixed(0)} mm above G: ${tq.toFixed(1)} N·m back at 30°, sways ${rollPeriod(tr).toFixed(1)} s` : `B ${(-tr.bg * 1000).toFixed(0)} mm below G: the couple tips it over`, tr.bg > 0 ? B_FIELD : HIGH_V)

        status.set(`depth ${f.depth.toFixed(2)} m · roll ${degText(f.roll)} · ${q.water} water ρ = ${q.rho} kg/m³`, LABEL)
        if (tr.bg <= 0 && Math.abs(f.roll) > 0.6) event.set(`B below G: the couple rolls it further, ${Math.abs(toDeg(f.roll)) > 170 ? 'now hanging upside down' : 'capsizing'}`, HIGH_V)
        else if (Math.abs(f.rate) > 10 * DEG) event.set(`rolled ${degText(f.roll)}: B·BG·sin φ = ${Math.abs(rightingMoment(tr, f.roll)).toFixed(2)} N·m swings it back`, B_FIELD)
        else if (f.floating) event.set('floats: buoyancy beats weight, it rests at the surface', RING)
        else if (f.grounded) event.set('sank to the floor: weight beats buoyancy, add foam or drop lead', HEAT)
        else if (neutral) event.set('neutral: hovers where it was let go, level', POWER)
        else event.set(`${tr.net > 0 ? 'rising' : 'sinking'} ${Math.abs(f.vz * 100).toFixed(0)} cm/s: water drag ∝ v² limits it`, tr.net > 0 ? RING : HEAT)
        sub.set(`${t.toFixed(1)} / ${BY.seconds} s · real time · let go at ${BY.depth0} m, rolled 30° · B–G gap drawn ${BY.gap}×`)
      },
      readouts: (p) => {
        const q = byParams(p)
        const tr = rovTrim(q, q.rho)
        const nk = netKg(tr.net)
        const need = leadForTrim(q.foam, q.rho)
        return [
          { label: 'Net buoyancy', value: `${kg(nk)} · ${signed(tr.net, 1)} N`, tone: Math.abs(nk) < 0.05 ? 'ok' : 'warn' },
          rovTrim({ foam: q.foam, lead: 0 }, q.rho).net < 0
            ? { label: 'Lead for neutral', value: 'sinks with none: add foam', tone: 'bad' }
            : { label: 'Lead for neutral', value: `${need} bars (fitted ${q.lead})`, tone: need === q.lead ? 'ok' : 'warn' },
          { label: 'B above G · roll period', value: tr.bg > 0 ? `${(tr.bg * 1000).toFixed(0)} mm · ${rollPeriod(tr).toFixed(1)} s` : `${(tr.bg * 1000).toFixed(0)} mm · capsizes`, tone: tr.bg > 0.02 ? 'ok' : tr.bg > 0 ? 'warn' : 'bad' },
          { label: `At ${ROV.rating} m: pressure · end cap`, value: `${(gaugeAt(q.rho, ROV.rating) / 1e5).toFixed(1)} bar · ${(capForce(q.rho, ROV.rating) / 1000).toFixed(1)} kN` },
        ]
      },
    }
  },
}

// --- Thruster layout: vectored BlueROV2, allocation matrix (pseudo-inverse), v² drag, weaker reverse thrust. ---

const REVERSE = { raw: 'Raw commands', comp: 'Compensate reverse' }
const TL = { rov: [-9, -2.8, 0] as V3, k: 17, tilt: 0.8, seconds: 10, cols: [3.9, 4.9, 5.9, 6.9], cmd: 9.4, force: 13, floor: 1, rows: [2.6, 1.75, 0.9, 0.05, -0.8, -1.65], lines: [-3.2, -4.05, -4.9, -5.75], tape: 0.25, floorZ: -0.3 }
const SHORT = ['T1 FR', 'T2 FL', 'T3 RR', 'T4 RL', 'T5 VR', 'T6 VL']
const AX_SHORT = ['Su', 'Sw', 'He', 'Ya']
const tlParams = (p: Params) => ({
  comp: pick(REVERSE, p.reverse, 'raw') === 'comp',
  w: { surge: n(p, 'surge') / 100, sway: n(p, 'sway') / 100, heave: n(p, 'heave') / 100, yaw: n(p, 'yaw') / 100 } as Wrench,
})
type TlQ = ReturnType<typeof tlParams>
const tlKey = (q: TlQ) => `${q.comp}|${AXES.map((a) => q.w[a]).join(',')}`
const tlRun = memoBy(tlKey, (q: TlQ) => rovRun(q.w, q.comp, TL.seconds))
const cleanWrench = (w: Wrench): Wrench => ({ surge: clean(w.surge), sway: clean(w.sway), heave: clean(w.heave), yaw: clean(w.yaw) })
const clean = (v: number) => (Math.abs(v) < 1e-6 ? 0 : v)
const sgn = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '0')
const sPct = (v: number) => `${v > 0.005 ? '+' : v < -0.005 ? '−' : ''}${Math.abs(Math.round(v * 100))} %`
const FULL = (sign: number) => thrustWrench(allocate({ surge: sign, sway: 0, heave: 0, yaw: 0 }).force).surge
/** Forces on axes the pilot did not ask for (N): what reverse asymmetry leaks. */
function leak(q: TlQ, f: Wrench) {
  return (['surge', 'sway', 'heave'] as const).filter((a) => Math.abs(q.w[a]) < 1e-9 && Math.abs(f[a]) > 0.5).map((a) => ({ axis: a, n: f[a] }))
}
const leakText = (l: { axis: string; n: number }) =>
  `${Math.abs(l.n).toFixed(0)} N ${l.axis === 'surge' ? (l.n > 0 ? 'forward' : 'back') : l.axis === 'sway' ? (l.n > 0 ? 'right' : 'left') : l.n > 0 ? 'up' : 'down'}`

export const thrusterLayout: Lesson = {
  id: 'underwater-swimming-thruster-layout',
  title: 'Thruster layout',
  tagline: 'Six thrusters, four motions: an allocation matrix like a quad mixer',
  formula: () => `u = A·[surge sway heave yaw]ᵀ, A = B⁺ = Bᵀ(B·Bᵀ)⁻¹ (pseudo-inverse) · T200: ${T200.fwd} N forward, ${T200.rev} N reverse · drag ½ρ·CdA·v² → v_top = √(2F/ρ·CdA)`,
  legend: [
    { color: POWER, label: 'Forward thrust on the ROV', shape: 'dot' },
    { color: HEAT, label: 'Reverse thrust (22 % weaker)', shape: 'dot' },
    { color: RING, label: 'Velocity', shape: 'dot' },
    { color: FORCE, label: 'Water drag ∝ v²', shape: 'dot' },
  ],
  points: [
    'A BlueROV2 has four horizontal thrusters angled at 45° and two vertical ones. Each angled thruster pushes partly forward and partly sideways, and sits off-centre so it also turns the ROV. The geometry matrix B says how much each thruster adds to surge, sway, heave and yaw; the controller needs the reverse, motion to thruster commands.',
    'Six thrusters, four motions: more columns than rows, so there are many answers. The pseudo-inverse B⁺ picks the one with the least total effort. For this symmetric frame it comes out as ±1s, just like a quad mixer: surge is all four forward, sway pairs the diagonals against each other, yaw runs the left side against the right. Ask for too much and every command is scaled down together, keeping the direction.',
    'Water drag grows with speed squared, F = ½ρ·CdA·v². Full surge gives ~146 N and the ROV tops out near 1.5 m/s (3 knots) when drag matches; doubling the speed would need four times the thrust. Sideways the frame is blunter, so it is slower, and the vertical pair only manages ~0.9 m/s.',
    'Props are shaped for one direction: a T200 gives 51.5 N forward but only 40.2 N in reverse. Reversing is ~12 % slower, and any move that runs some thrusters backwards (sway, yaw) leaks a push the pilot never asked for, so it creeps forward while strafing. Compensating scales the reverse commands up by 51.5/40.2 so the forces cancel again.',
  ],
  controls: [
    { kind: 'choice', key: 'reverse', options: opts(REVERSE), initial: 'raw' },
    { kind: 'slider', key: 'surge', label: 'Surge', min: -100, max: 100, step: 5, initial: 0, format: (v) => `${v > 0 ? '+' : ''}${v} %` },
    { kind: 'slider', key: 'sway', label: 'Sway', min: -100, max: 100, step: 5, initial: 60, format: (v) => `${v > 0 ? '+' : ''}${v} %` },
    { kind: 'slider', key: 'heave', label: 'Heave', min: -100, max: 100, step: 5, initial: 0, format: (v) => `${v > 0 ? '+' : ''}${v} %` },
    { kind: 'slider', key: 'yaw', label: 'Yaw', min: -100, max: 100, step: 5, initial: 0, format: (v) => `${v > 0 ? '+' : ''}${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const { holder } = tiltRig(scene, TL.rov, TL.k, TL.tilt)
    const pool = add(holder, new THREE.Group())
    flatBox(pool, [TL.floor, TL.floor, 0.01], glowMat('#17283a', 0.12), [0, 0, TL.floorZ])
    const tapeM = glowMat('#5f7f9a', 0.3)
    const nLines = Math.round(TL.floor / TL.tape)
    const lines = [0, 1].map((axis) => Array.from({ length: nLines }, () => flatBox(pool, axis ? [TL.floor, 0.006, 0.004] : [0.006, TL.floor, 0.004], tapeM, [0, 0, TL.floorZ + 0.008])))
    const rov = rovModel(holder, { arrowLen: 0.2, arrowR: 0.007, bubbles: true })
    rov.trim(3, 5)
    const vel = stretchArrow(rov.group, RING, 0.007)
    const drag = stretchArrow(rov.group, FORCE, 0.006)

    addLabel(scene, 'thruster', [0, TL.rows[0] + 1, 0.3], LABEL, 0.3, 'left')
    AX_SHORT.forEach((h, j) => addLabel(scene, h, [TL.cols[j], TL.rows[0] + 1, 0.3], LABEL, 0.3))
    addLabel(scene, 'cmd', [TL.cmd, TL.rows[0] + 1, 0.3], LABEL, 0.3)
    addLabel(scene, 'thrust', [TL.force, TL.rows[0] + 1, 0.3], LABEL, 0.3, 'right')
    const cells = THRUSTERS.map((_, i) => {
      const y = TL.rows[i]
      addLabel(scene, SHORT[i], [0, y, 0.3], i < 4 ? '#3fa7ff' : '#6fe0b0', 0.32, 'left')
      ALLOC[i].forEach((v, j) => addLabel(scene, sgn(v), [TL.cols[j], y, 0.3], v > 0 ? POWER : v < 0 ? HEAT : GREY, 0.36))
      return [liveLabel(scene, [TL.cmd, y, 0.3], { size: 0.32 }), liveLabel(scene, [TL.force, y, 0.3], { size: 0.32, align: 'right' })]
    })
    const axisText = TL.lines.map((y) => liveLabel(scene, [0, y, 0.3], { size: 0.3, align: 'left' }))

    const spin = [0, 0, 0, 0, 0, 0]
    const st = { key: '', t: 0 }
    return {
      scene,
      view: SIDE_VIEW,
      frame(dt, p) {
        const q = tlParams(p)
        const run = tlRun(q)
        if (tlKey(q) !== st.key) {
          st.key = tlKey(q)
          st.t = 0
        }
        st.t += dt
        if (st.t > TL.seconds + 0.5) st.t = 0
        const t = Math.min(st.t, TL.seconds)
        const f: RovFrame = fixedStepAt(run, t, 0.01)
        const a = allocate(q.w, q.comp)
        const F = cleanWrench(thrustWrench(a.force))
        a.cmd.forEach((u, i) => (spin[i] += dt * 30 * u))
        rov.set(spin, a.cmd)
        rov.wake(dt, a.cmd)
        rov.group.rotation.z = -f.heading
        rov.group.position.z = Math.max(-0.12, Math.min(0.12, -f.depth))
        const east = f.y
        const span = nLines * TL.tape
        const wrap = (v: number) => (((v % span) + span) % span) - span / 2
        lines[0].forEach((b, i) => (b.position.x = wrap(i * TL.tape - f.x)))
        lines[1].forEach((b, i) => (b.position.y = wrap(i * TL.tape + east)))
        const vs = 0.25
        const top = 0.17
        vel([0, 0, top], [f.u * vs, -f.v * vs, top + f.w * vs])
        const [cu, cv, cw] = ROV_DYN.cdA
        const ds = 0.0018
        drag([0, 0, top], [-dragN(f.u, cu) * ds, dragN(f.v, cv) * ds, top - dragN(f.w, cw) * ds])

        cells.forEach(([cmd, force], i) => {
          const c = a.cmd[i] > 0.005 ? POWER : a.cmd[i] < -0.005 ? HEAT : GREY
          cmd.set(sPct(a.cmd[i]), a.saturated && Math.abs(a.cmd[i]) > 0.999 ? HIGH_V : c)
          force.set(`${signed(a.force[i], 1)} N`, c)
        })
        const tops = [topSpeed(F.surge, cu), topSpeed(F.sway, cv), topSpeed(F.heave, cw)]
        ;(['surge', 'sway', 'heave'] as const).forEach((ax, j) => {
          const v = [f.u, f.v, f.w][j]
          const cdA = ROV_DYN.cdA[j]
          axisText[j].set(`${ax} ${signed(F[ax], 0)} N − drag ${Math.abs(dragN(v, cdA)).toFixed(0)} N · ${signed(v, 2)} m/s → top ${tops[j].toFixed(2)}`, Math.abs(F[ax]) < 0.5 ? GREY : LABEL)
        })
        axisText[3].set(`yaw ${signed(F.yaw, 1)} N·m · ${Math.round(toDeg(f.r)) || 0} °/s → top ${toDeg(topYawRate(F.yaw)).toFixed(0)} °/s`, Math.abs(F.yaw) < 0.05 ? GREY : LABEL)

        const lk = leak(q, F)
        status.set(`Su ${sPct(q.w.surge)} · Sw ${sPct(q.w.sway)} · He ${sPct(q.w.heave)} · Ya ${sPct(q.w.yaw)} → ${a.cmd.map((u) => Math.round(u * 100)).join(' ')} %`, LABEL)
        if (a.saturated) event.set(`commands passed 100 %: all six scaled ×${a.scale.toFixed(2)}, direction kept`, HIGH_V)
        else if (lk.length) event.set(`reverse is 22 % weaker: leaks ${lk.map(leakText).join(', ')} nobody asked for`, HEAT)
        else if (!q.comp && a.cmd.some((u) => u < -0.005) && q.w.surge < 0) event.set(`reverse: each T200 gives ${T200.rev} N, not ${T200.fwd} N → ${tops[0].toFixed(2)} m/s, not ${topSpeed(FULL(1) * Math.abs(q.w.surge), ROV_DYN.cdA[0]).toFixed(2)}`, HEAT)
        else if (AXES.every((ax) => q.w[ax] === 0)) event.set('sticks centred: all thrusters off, it drifts to a stop', GREY)
        else if (q.w.surge !== 0 && !q.w.sway && !q.w.heave && !q.w.yaw) event.set(`drag ∝ v²: ${Math.abs(f.u).toFixed(2)} of ${tops[0].toFixed(2)} m/s, double the speed needs 4× thrust`, FORCE)
        else event.set(q.comp ? `compensated: reverse commands × ${(T200.fwd / T200.rev).toFixed(2)}, forces cancel` : 'thrusts add up to exactly the asked motion', POWER)
        sub.set(`${t.toFixed(1)} / ${TL.seconds} s · real time · camera follows · tape every ${TL.tape} m · ${f.depth > 0 ? 'down' : 'up'} ${Math.abs(f.depth).toFixed(2)} m`)
      },
      readouts: (p) => {
        const q = tlParams(p)
        const a = allocate(q.w, q.comp)
        const F = cleanWrench(thrustWrench(a.force))
        const lk = leak(q, F)
        const [cu] = ROV_DYN.cdA
        return [
          { label: 'Full surge top speed fwd · rev', value: `${topSpeed(FULL(1), cu).toFixed(2)} · ${topSpeed(FULL(-1), cu).toFixed(2)} m/s` },
          { label: 'Net thrust', value: `${Math.hypot(F.surge, F.sway, F.heave).toFixed(0)} N · ${signed(F.yaw, 1)} N·m` },
          { label: 'Command scale', value: a.saturated ? `×${a.scale.toFixed(2)} (saturated)` : '×1.00', tone: a.saturated ? 'warn' : 'ok' },
          { label: 'Unasked push', value: lk.length ? lk.map(leakText).join(', ') : 'none', tone: lk.length ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
