import * as THREE from 'three/webgpu'
import {
  CONNECTORS,
  ConnectorId,
  GroundLayout,
  COPPER_MELT_C,
  INSULATION_MAX_C,
  ROOM_C,
  adcCounts,
  ampacity,
  awgDiameter,
  connectorPoint,
  groundReturn,
  loopOhms,
  ohmsPerMetre,
  runPoint,
  wireTauS,
  wireTempAt,
} from '../../core/physics'
import { amps, ohms, pct, volts, watts } from '../../core/units'
import { buildTtMotor, buildWheel } from '../../models/motion'
import { buildEsp32, buildL298n } from '../../models/modules'
import { V3, add, box, cylinder, mat, mesh, tube } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  cell18650,
  cell18650Height,
  cellPackModel,
  clamp01,
  emptyGroup,
  glide,
  glowMat,
  heatGlow,
  heatWaves,
  label,
  lane,
  motorCan,
  plusFlow,
  pulseLabel,
  scope,
  smoke,
  thermometer,
  ticks,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const PACK_V = 7.4
const RED_INS = '#d8322c'
const BLACK_INS = '#2a2b30'
const celsius = (c: number) => (c > 999 ? '> 999 °C' : `${Math.round(c)} °C`)

/** Insulated wire through `points`, outer radius `r`; its own material so it can glow. */
function insulated(parent: THREE.Object3D, points: V3[], r: number, color: string) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.55 })
  for (let i = 0; i < points.length - 1; i++) tube(parent, [points[i], points[i + 1]], r, material, 4)
  for (let i = 1; i < points.length - 1; i++) add(parent, mesh(new THREE.SphereGeometry(r, 12, 8), material), points[i])
  return material
}

// --- Voltage drop: a pack feeds a motor through a twin run; gauge and length set the drop and how hot the copper gets. ---

const PACK_AT: V3 = [-14, 2, 0]
const RUN_Y = [-3, -4.6]
const PLAY_S = 8
const T_TOP = 250
const THERMO: V3 = [16.4, -6.4, 0]
const THERMO_H = 9
const VBAR: V3 = [-15.4, 7.6, 0]
const PER_V = 2.5

const solveDrop = (p: Params) => {
  const gauge = n(p, 'gauge')
  const len = n(p, 'len')
  const amp = n(p, 'amps')
  const run = runPoint(PACK_V, gauge, len, amp)
  const tau = wireTauS(gauge)
  const heatA = run.fused ? PACK_V / (PACK_V / amp + loopOhms(gauge, len)) : run.amps
  return {
    gauge,
    len,
    amp,
    run,
    tau,
    heatA,
    liveV: run.fused ? PACK_V - heatA * loopOhms(gauge, len) : run.loadV,
    perM: ohmsPerMetre(gauge, run.fused ? ROOM_C : run.tempC),
    pvcA: ampacity(gauge, INSULATION_MAX_C.pvc),
    silA: ampacity(gauge, INSULATION_MAX_C.silicone),
    speed: Math.max(1, Math.round((4 * tau) / PLAY_S)),
  }
}

export const voltageDrop: Lesson = {
  id: 'wiring-gauge-voltage-drop',
  title: 'Voltage drop',
  tagline: 'Every metre of copper steals volts and turns them into heat',
  formula: (p) => {
    const s = solveDrop(p)
    if (s.run.fused) return `I²R′ = (${amps(s.heatA)})² × ${ohms(s.perM)}/m: more heat than ${s.gauge} AWG can shed, the copper reaches ${COPPER_MELT_C} °C and melts open`
    return `V_drop = I · 2L · R′ = ${amps(s.run.amps)} × 2 × ${s.len.toFixed(1)} m × ${ohms(s.perM)}/m = ${volts(s.run.drop)} (${pct(s.run.drop / PACK_V)}) · P = I · V_drop = ${watts(s.run.heatW)}`
  },
  legend: [
    { color: POWER, label: 'Volts left for the motor', shape: 'dot' },
    { color: HIGH_V, label: 'Volts lost in + and − wires', shape: 'dot' },
    { color: HEAT, label: 'I²R heat in the copper', shape: 'dot' },
  ],
  points: [
    'The current goes out on the red wire and back on the black one: a 1 m run is 2 m of copper. R = 2L × R′ (Ω per metre, from the gauge).',
    'Drop = I × R. Aim for under 5 % on motor runs, 2–3 % on logic: a TT motor at 1 A is happy on 22 AWG; a 775 motor at 10 A over 1 m wants 14–16 AWG.',
    'Every 3 AWG steps double the area: 22 AWG ≈ 52 mΩ/m, 18 AWG ≈ 21 mΩ/m, 14 AWG ≈ 8 mΩ/m. Short and thick beats long and thin.',
    'The lost volts become heat, P = I²R. It warms the wire over about a minute (the time constant τ) and copper’s R climbs 0.4 % per °C as it does.',
    'Ampacity is the current that holds the wire at its insulation’s limit: PVC hook-up wire softens at 80 °C, silicone wire (RC/robot leads) takes 200 °C.',
    'Size for the stall current, not the cruise: a stalled motor pulls 5–10× its running current until the fuse or driver cuts it.',
  ],
  controls: [
    { kind: 'slider', key: 'gauge', label: 'Wire gauge', min: 12, max: 28, initial: 22, step: 2, format: (v) => `${v} AWG` },
    { kind: 'slider', key: 'len', label: 'Run length (one way)', min: 0.1, max: 3, initial: 1, step: 0.1, format: (v) => `${v.toFixed(1)} m` },
    { kind: 'slider', key: 'amps', label: 'Motor demand (on thick leads)', min: 0.5, max: 20, initial: 3, step: 0.5, format: (v) => `${v} A` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const r = 0.8
    const pack = cellPackModel(scene, 2, 1, { r, dx: 2.4 * r })
    pack.group.position.set(...PACK_AT)
    add(scene, label('2S 18650  7.4 V', { size: 0.55, color: LABEL }), [PACK_AT[0], PACK_AT[1] + pack.h / 2 + 1.2, 0])
    const plusAt: V3 = [pack.plus[0] + PACK_AT[0], pack.plus[1] + PACK_AT[1], 0]
    const minusAt: V3 = [pack.minus[0] + PACK_AT[0], pack.minus[1] + PACK_AT[1], 0]
    const motor = motorCan(scene, [0, 0.4, 0], { r: 1.8 })
    const runs = add(scene, new THREE.Group())
    const fumes = smoke(scene, 6, { count: 18, rise: 6 })
    const waves = heatWaves(scene, 6, { count: 5, rise: 3 })

    const vbar = add(scene, new THREE.Group(), VBAR)
    const vMotor = add(vbar, mesh(new THREE.BoxGeometry(1, 0.7, 0.4), glowMat(POWER, 0.8)))
    const vLost = add(vbar, mesh(new THREE.BoxGeometry(1, 0.7, 0.4), glowMat(HIGH_V, 0.8)))
    const vText = add(vbar, new THREE.Group())

    const thermo = thermometer(THERMO_H)
    add(scene, thermo.group, THERMO)
    const tY = (c: number) => THERMO[1] + 0.9 + ((c - ROOM_C) / (T_TOP - ROOM_C)) * THERMO_H
    for (const [c, text, color] of [[INSULATION_MAX_C.pvc, 'PVC', RING], [INSULATION_MAX_C.silicone, 'SILICONE', HIGH_V]] as const) {
      add(scene, mesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), glowMat(color, 0.8)), [THERMO[0], tY(c), 0.6])
      add(scene, label(`${text} ${c}`, { size: 0.38, color, align: 'right' }), [THERMO[0] - 1.1, tY(c), 0])
    }
    const tempNum = pulseLabel(scene, 3, HEAT, [THERMO[0] - 0.4, THERMO[1] - 1.6, 0], 0.8)

    const st = {
      key: '',
      open: null as boolean | null,
      t: 0,
      tempC: ROOM_C,
      shownLoad: PACK_V,
      s: solveDrop({ gauge: 22, len: 1, amps: 3 }),
      ins: [] as THREE.MeshStandardMaterial[],
      flows: [] as ReturnType<typeof plusFlow>[],
      callout: new THREE.Group(),
    }

    const rebuild = () => {
      const s = st.s
      emptyGroup(runs)
      const mx = -8 + 5.2 * s.len
      motor.group.position.x = mx
      const [lp, rp] = motor.pins.map((q): V3 => [q[0] + mx, q[1], 0])
      const rv = 0.2 * (awgDiameter(s.gauge) * 1000 + 0.8)
      const plus: V3[] = [plusAt, [plusAt[0], RUN_Y[0], 0], [lp[0], RUN_Y[0], 0], lp]
      const minus: V3[] = [rp, [rp[0], RUN_Y[1], 0], [minusAt[0], RUN_Y[1], 0], minusAt]
      st.ins = [insulated(runs, plus, rv, RED_INS), insulated(runs, minus, rv, BLACK_INS)]
      const f = () => (PACK_V - st.s.liveV) / PACK_V / 2
      const span = (x: number) => clamp01((x - plusAt[0]) / (lp[0] - plusAt[0]))
      st.flows = [
        plusFlow(runs, lane(plus, rv + 0.35), (at) => 1 - f() * span(at.x)),
        plusFlow(runs, lane(minus, rv + 0.35), (at) => f() * span(at.x)),
      ]
      const mid = (plusAt[0] + lp[0]) / 2
      fumes.group.position.set(mid, RUN_Y[0] + 0.6, 0)
      waves.group.position.set(mid, RUN_Y[0] + 0.8, 0)
      add(runs, label(`${s.gauge} AWG  ${(awgDiameter(s.gauge) * 1000).toFixed(2)} MM`, { size: 0.5, color: LABEL }), [mid, RUN_Y[1] - 1.4, 0])
      add(runs, label(`${s.len.toFixed(1)} M  ×2`, { size: 0.5, color: GREY }), [mid, RUN_Y[1] - 2.4, 0])
    }

    const setBar = (load: number) => {
      const wM = load * PER_V
      const wL = (PACK_V - load) * PER_V
      vMotor.scale.x = Math.max(0.001, wM)
      vMotor.position.x = wM / 2
      vLost.scale.x = Math.max(0.001, wL)
      vLost.position.x = wM + wL / 2
    }

    return {
      scene,
      view: { center: [0, 0.6, 0], radius: 60, polar: 1.4, azimuth: 0.06 },
      frame(dt, p) {
        const key = `${p.gauge}|${p.len}|${p.amps}`
        if (key !== st.key) {
          const geo = key.split('|')[0] !== st.key.split('|')[0] || key.split('|')[1] !== st.key.split('|')[1]
          st.key = key
          st.s = solveDrop(p)
          st.t = 0
          if (geo) rebuild()
          st.open = null
        }
        const s = st.s
        st.t = Math.min(st.t + dt * s.speed, 6 * s.tau)
        st.tempC = Math.min(COPPER_MELT_C, wireTempAt(s.gauge, s.heatA, st.t))
        const open = s.run.fused && st.tempC >= COPPER_MELT_C
        const loadV = open ? 0 : s.liveV
        if (open !== st.open) {
          st.open = open
          emptyGroup(vText)
          add(vText, label(`MOTOR ${volts(loadV)}`, { size: 0.5, color: POWER, align: 'left' }), [0, 1, 0])
          add(vText, label(open ? 'WIRE MELTED OPEN' : `WIRES ${volts(PACK_V - loadV)}`, { size: 0.5, color: HIGH_V, align: 'right' }), [PACK_V * PER_V, -1, 0])
          for (const fl of st.flows) fl.mesh.visible = !open
        }
        st.shownLoad = glide(dt, st.shownLoad, loadV, 6)
        setBar(st.shownLoad)
        const heat = clamp01((st.tempC - ROOM_C) / (INSULATION_MAX_C.silicone - ROOM_C))
        for (const m of st.ins) heatGlow(m, heat)
        waves.step(dt, open ? 0 : clamp01((st.tempC - 40) / 40))
        fumes.step(dt, clamp01((st.tempC - INSULATION_MAX_C.pvc) / 120))
        const v = dt * Math.min(9, 0.8 * s.heatA)
        for (const fl of st.flows) fl.step(v)
        motor.spin(dt, 40 * st.shownLoad)
        thermo.set((Math.min(T_TOP, st.tempC) - ROOM_C) / (T_TOP - ROOM_C))
        tempNum.show(String(Math.min(999, Math.round(st.tempC))))
        tempNum.frame(dt)
      },
      readouts: () => {
        const s = st.s
        const frac = s.run.drop / PACK_V
        const open = !!st.open
        return [
          s.run.fused
            ? { label: `Wire loop (2 × ${s.len.toFixed(1)} m)`, value: open ? 'melted open' : `${ohms(loopOhms(s.gauge, s.len))} cold`, tone: 'bad' }
            : { label: `Wire loop (2 × ${s.len.toFixed(1)} m)`, value: `${ohms(s.run.ohms)} · drop ${volts(s.run.drop)}`, tone: frac > 0.1 ? 'bad' : frac > 0.05 ? 'warn' : 'ok' },
          { label: 'Motor gets', value: open ? '0 V · 0 A' : `${volts(s.liveV)} · ${amps(s.heatA)}` },
          {
            label: `Copper at t = ${Math.round(st.t)} s (${s.speed}× fast)`,
            value: open ? 'melted' : `${celsius(st.tempC)} · ${watts(s.heatA * (PACK_V - s.liveV))}`,
            tone: st.tempC > INSULATION_MAX_C.silicone ? 'bad' : st.tempC > INSULATION_MAX_C.pvc ? 'warn' : undefined,
          },
          { label: 'Ampacity: PVC · silicone', value: `${amps(s.pvcA)} · ${amps(s.silA)}` },
        ]
      },
    }
  },
}

// --- Connector ratings: the same current through five real connectors; the contact's I²R heats the housing. ---

const K = 0.4
interface Shape {
  len: number
  w: number
  d: number
  pitch: number
  color: string
  pin: number
  wireR: number
  short: string
}
const SHAPES: Record<ConnectorId, Shape> = {
  dupont: { len: 14, w: 5.1, d: 2.5, pitch: 2.54, color: '#1c1c1f', pin: 0.32, wireR: 0.55, short: 'DUPONT' },
  jstph: { len: 6, w: 6, d: 4.5, pitch: 2, color: '#e9e4d4', pin: 0.25, wireR: 0.5, short: 'PH' },
  jstxh: { len: 9.8, w: 7.4, d: 5.8, pitch: 2.5, color: '#e9e4d4', pin: 0.32, wireR: 0.75, short: 'XH' },
  xt30: { len: 14, w: 10.2, d: 5.2, pitch: 5, color: '#f2c230', pin: 1, wireR: 1.3, short: 'XT30' },
  xt60: { len: 16, w: 15.5, d: 8.2, pitch: 7.3, color: '#f2c230', pin: 1.75, wireR: 1.65, short: 'XT60' },
}
const IDS = Object.keys(CONNECTORS) as ConnectorId[]
const WEAR = { new: 1, worn: 5 }
const CHART: V3 = [6.4, -7, 0]
const PER_A = 0.34
const BAR_GAP = 2.3
const CONN_AT: V3 = [-7.4, 0.6, 0]

/** A mated two-way connector along x (plug left, receptacle right), real size × `K` per mm, wires out both ends. */
function connectorPair(parent: THREE.Object3D, id: ConnectorId) {
  const s = SHAPES[id]
  const g = add(parent, new THREE.Group(), CONN_AT)
  const L = s.len * K
  const housing = new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.6, transparent: true, opacity: 0.55, depthWrite: false })
  for (const side of [-1, 1]) box(g, [L, s.w * K, s.d * K], housing, [(side * (L + 0.08)) / 2, 0, 0])
  const pins = [1, -1].map((sy) => {
    const metal = new THREE.MeshStandardMaterial({ color: '#d9b24a', metalness: 0.45, roughness: 0.35 })
    const y = (sy * s.pitch * K) / 2
    cylinder(g, s.pin * K, 1.6 * L, metal, [0, y, 0], 'x', 16)
    const spot = add(g, mesh(new THREE.SphereGeometry(Math.max(0.35, 1.4 * s.pin * K), 16, 12), glowMat(HEAT, 1.4)), [0, y, 0])
    for (const side of [-1, 1]) {
      const end = side * (L + 0.1)
      tube(g, [[end, y, 0], [end + side * 1.6, y, 0], [end + side * 3.2, y + sy * 0.6, 0]], s.wireR * K * 1.6, mat(sy > 0 ? RED_INS : BLACK_INS, { rough: 0.55 }), 16)
    }
    return { metal, spot }
  })
  return { group: g, housing, pins, width: 2 * L, top: (s.w * K) / 2 }
}

const solveConn = (p: Params) => {
  const id = (IDS.includes(p.conn as ConnectorId) ? p.conn : 'xt60') as ConnectorId
  const c = CONNECTORS[id]
  const wear = p.wear === 'worn' ? WEAR.worn : WEAR.new
  const amp = n(p, 'amps')
  return { id, c, wear, amp, pt: connectorPoint(c, amp, wear), all: IDS.map((k) => connectorPoint(CONNECTORS[k], amp, wear)) }
}

export const connectorRatings: Lesson = {
  id: 'wiring-gauge-connector-ratings',
  title: 'Connector ratings',
  tagline: 'Tiny contact resistance, big current: the joint heats first',
  formula: (p) => {
    const s = solveConn(p)
    return `P = I² · R_contact = (${amps(s.amp)})² × ${ohms(s.pt.ohms)} = ${watts(s.pt.heatW)} per contact · ΔT = 30 K × (I / I_rated)² × wear = ${Math.round(s.pt.tempC - ROOM_C)} K`
  },
  legend: [
    { color: HEAT, label: 'Contact heat, I²R', shape: 'dot' },
    { color: POWER, label: 'Within rating', shape: 'dot' },
    { color: RING, label: 'Over rating, still holding', shape: 'dot' },
    { color: HIGH_V, label: 'Housing melts', shape: 'dot' },
  ],
  points: [
    'Where two metals touch, only a few microscopic spots carry the current. That contact resistance is milliohms, but I²R puts all its heat in a tiny spot.',
    'Ratings mean ~30 °C rise at the rated current. Heat goes with I², so twice the current is four times the heat and rise.',
    'Dupont jumpers and JST-PH (2–3 A) are for signals and logic power. JST-XH (3 A) for balance leads and small motors.',
    'Battery and motor leads: XT30 (15 A) or XT60 (30 A). Their gold bullets clamp with far more contact area: ~0.5 mΩ instead of 20 mΩ.',
    'Worn, loose or oxidised contacts can have 5× the resistance: same current, 5× the heat. A brown, melted housing is the classic symptom.',
    'Rate connectors for the stall current too, and the contacts’ drop adds to the wire’s: a pair of Dupont pins at 3 A loses 0.12 V.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'conn',
      options: IDS.map((id) => ({ value: id, label: CONNECTORS[id].name })),
      initial: 'dupont',
    },
    { kind: 'slider', key: 'amps', label: 'Current', min: 0.5, max: 30, initial: 3, step: 0.5, format: (v) => `${v} A` },
    {
      kind: 'choice',
      key: 'wear',
      options: [
        { value: 'new', label: 'New contacts' },
        { value: 'worn', label: 'Worn, 5× R' },
      ],
      initial: 'new',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const holder = add(scene, new THREE.Group())
    const waves = heatWaves(scene, 4, { count: 4, rise: 3 })
    const fumes = smoke(scene, 4, { count: 20, rise: 6 })
    const degC = pulseLabel(scene, 3, HEAT, [CONN_AT[0] - 0.6, CONN_AT[1] + 9.2, 0], 1)
    add(scene, label('°C', { size: 0.6, color: GREY, align: 'left' }), [CONN_AT[0] + 1.6, CONN_AT[1] + 9.2, 0])
    const name = add(scene, new THREE.Group(), [CONN_AT[0], CONN_AT[1] - 6.2, 0])

    const chart = add(scene, new THREE.Group(), CHART)
    const axisMat = glowMat(GREY, 0.3)
    add(chart, mesh(new THREE.BoxGeometry(0.08, 30 * PER_A + 0.4, 0.08), axisMat), [-1.4, (30 * PER_A + 0.4) / 2, 0])
    for (const a of [0, 5, 10, 15, 20, 25, 30]) {
      add(chart, mesh(new THREE.BoxGeometry(0.4, 0.06, 0.06), axisMat), [-1.4, a * PER_A, 0])
      add(chart, label(String(a), { size: 0.42, color: GREY, align: 'right' }), [-1.8, a * PER_A, 0])
    }
    add(chart, label('RATED A', { size: 0.45, color: GREY, align: 'left' }), [-1.6, 30 * PER_A + 1, 0])
    const bars = IDS.map((id, i) => {
      const m = new THREE.MeshStandardMaterial({ color: POWER, emissive: POWER, emissiveIntensity: 0.5 })
      const h = CONNECTORS[id].ratedA * PER_A
      add(chart, mesh(new THREE.BoxGeometry(1.4, h, 0.5), m), [i * BAR_GAP, h / 2, 0])
      const tag = label(SHAPES[id].short, { size: 0.42, color: LABEL })
      add(chart, tag, [i * BAR_GAP, -0.8, 0])
      return { m, tag }
    })
    const line = add(chart, mesh(new THREE.BoxGeometry((IDS.length - 1) * BAR_GAP + 2.4, 0.12, 0.12), glowMat(RING, 1)), [((IDS.length - 1) * BAR_GAP) / 2, 0, 0.4])
    const lineText = add(chart, new THREE.Group())

    const st = { key: '', id: '' as ConnectorId | '', heat: 0, temp: ROOM_C, s: solveConn({ conn: 'dupont', amps: 3, wear: 'new' }), pair: null as ReturnType<typeof connectorPair> | null }
    const tone = (pt: ReturnType<typeof connectorPoint>) => (pt.melts ? HIGH_V : pt.load > 1 ? RING : POWER)

    return {
      scene,
      view: { center: [0, 0.4, 0], radius: 58, polar: 1.4, azimuth: 0.06 },
      frame(dt, p) {
        const key = `${p.conn}|${p.amps}|${p.wear}`
        if (key !== st.key) {
          st.key = key
          const s = (st.s = solveConn(p))
          if (s.id !== st.id) {
            st.id = s.id
            emptyGroup(holder)
            st.pair = connectorPair(holder, s.id)
            emptyGroup(name)
            add(name, label(`${s.c.name.toUpperCase()}  ${s.c.ratedA} A  ${+s.c.contactOhms.toFixed(4)} Ω`, { size: 0.6, color: LABEL }))
            waves.group.position.set(CONN_AT[0], CONN_AT[1] + st.pair.top + 0.6, 0)
            fumes.group.position.set(CONN_AT[0], CONN_AT[1] + st.pair.top + 0.4, 0)
          }
          bars.forEach((b, i) => {
            const c = new THREE.Color(tone(s.all[i]))
            b.m.color.copy(c)
            b.m.emissive.copy(c)
            b.m.emissiveIntensity = IDS[i] === s.id ? 0.9 : 0.25
          })
          line.position.y = Math.min(30, s.amp) * PER_A
          emptyGroup(lineText)
          add(lineText, label(amps(s.amp), { size: 0.5, color: RING, align: 'right' }), [(IDS.length - 1) * BAR_GAP + 1.2, line.position.y + 0.7, 1])
        }
        const s = st.s
        st.temp = glide(dt, st.temp, Math.min(400, s.pt.tempC), 2.5)
        const hot = clamp01((st.temp - ROOM_C) / (s.c.maxC - ROOM_C))
        const pair = st.pair!
        for (const pin of pair.pins) {
          heatGlow(pin.metal, hot)
          pin.spot.scale.setScalar(0.2 + 0.9 * hot)
          pin.spot.visible = hot > 0.05
        }
        const melt = clamp01((st.temp - s.c.maxC) / 60)
        pair.housing.color.set(SHAPES[s.id].color).lerp(new THREE.Color('#5a3a1e'), melt)
        waves.step(dt, hot)
        fumes.step(dt, melt)
        degC.show(String(Math.round(Math.min(999, st.temp))))
        degC.frame(dt)
      },
      readouts: () => {
        const { pt, c, amp } = st.s
        return [
          { label: 'Load vs rating', value: `${amps(amp)} / ${amps(c.ratedA)} · ${pct(pt.load)}`, tone: pt.load > 1 ? 'warn' : 'ok' },
          { label: 'Heat per contact', value: watts(pt.heatW) },
          { label: `Contact temp (limit ${c.maxC} °C)`, value: celsius(pt.tempC), tone: pt.melts ? 'bad' : pt.load > 1 ? 'warn' : undefined },
          { label: 'Drop across + and − contacts', value: volts(pt.pairDrop) },
        ]
      },
    }
  },
}

// --- Star ground: the motor's return current through the MCU's ground wire lifts the MCU's 0 V; a star keeps it out. ---

const LOGIC_A = 0.12
const SENSOR_V = 1.65
const RETURNS = {
  thin: { label: '26 AWG jumpers + Dupont', gauge: 26, len: 0.3, contact: CONNECTORS.dupont.contactOhms },
  thick: { label: '18 AWG + screw terminals', gauge: 18, len: 0.3, contact: 0.001 },
}
const PWM_S = 1
const SC: V3 = [12, -3.4, 0]
const SC_W = 5.4
const SC_H = 5
const LIFT_TOP = 0.5
const ESP: V3 = [-7, 2, 0]
const DRV: V3 = [1, 2, 0]
const MOTOR: V3 = [6.4, 2.4, 0]
const MOD_K = 0.22
const CELL_R = 0.55

const solveGround = (p: Params) => {
  const layout: GroundLayout = p.layout === 'daisy' ? 'daisy' : 'star'
  const w = p.wire === 'thick' ? RETURNS.thick : RETURNS.thin
  const wireOhms = ohmsPerMetre(w.gauge) * w.len + 2 * w.contact
  const motorA = n(p, 'motor')
  const on = groundReturn(layout, { packV: PACK_V, motorA, logicA: LOGIC_A, wireOhms })
  const off = groundReturn(layout, { packV: PACK_V, motorA: 0, logicA: LOGIC_A, wireOhms })
  const counts = adcCounts(SENSOR_V - on.lift, 3.3, 12)
  return { layout, w, wireOhms, motorA, on, off, counts, ideal: adcCounts(SENSOR_V, 3.3, 12) }
}

export const starGround: Lesson = {
  id: 'wiring-gauge-star-ground',
  title: 'Star ground',
  tagline: 'Return currents need their own path home',
  formula: (p) => {
    const s = solveGround(p)
    return s.layout === 'daisy'
      ? `V_lift = (I_motor + I_MCU) · R_gnd = (${amps(s.motorA)} + ${amps(LOGIC_A)}) × ${ohms(s.wireOhms)} = ${volts(s.on.lift)}`
      : `V_lift = I_MCU · R_gnd = ${amps(LOGIC_A)} × ${ohms(s.wireOhms)} = ${volts(s.on.lift)}`
  },
  legend: [
    { color: HIGH_V, label: '+ feed', shape: 'dot' },
    { color: B_FIELD, label: 'Return current, back to pack −', shape: 'dot' },
    { color: RING, label: 'MCU ground vs pack −', shape: 'dot' },
  ],
  points: [
    '“Ground” is just a wire back to the pack’s − terminal, and it has resistance like any other. Every amp returning through it lifts the far end.',
    'Daisy chain: the driver’s ground goes to the ESP32’s GND pin, then on to the pack. The motor’s amps share the ESP32’s ground wire and lift its 0 V.',
    'The ESP32 reads its sensors against its own GND. Lift it by 150 mV and a 1.65 V sensor reads 1.5 V; it jumps with every PWM pulse.',
    'Star ground: every module gets its own return wire to one point at the pack −. The motor’s current never flows through the logic’s ground.',
    'Thick, short returns with screw terminals shrink the lift for everything. Dupont jumpers add ~20 mΩ per contact on top of the thin wire.',
    'The PWM here is slowed 1000×: on a real 1 kHz motor drive the lift is a buzz you only see on a scope.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'layout',
      options: [
        { value: 'daisy', label: 'Daisy chain' },
        { value: 'star', label: 'Star' },
      ],
      initial: 'daisy',
    },
    { kind: 'slider', key: 'motor', label: 'Motor current (PWM on)', min: 0.2, max: 5, initial: 2, step: 0.1, format: (v) => `${v.toFixed(1)} A` },
    {
      kind: 'choice',
      key: 'wire',
      options: [
        { value: 'thin', label: RETURNS.thin.label },
        { value: 'thick', label: RETURNS.thick.label },
      ],
      initial: 'thin',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const h = cell18650Height(CELL_R)
    const PX = -16
    cell18650(scene, [PX, h / 2, 0], CELL_R)
    cell18650(scene, [PX, -h / 2, 0], CELL_R)
    add(scene, label('2S', { size: 0.55, color: LABEL, align: 'right' }), [PX - 1.2, 0, 0])
    const top: V3 = [PX, h + 0.1, 0]
    const bottom: V3 = [PX, -h - 0.1, 0]
    const star = add(scene, mesh(new THREE.SphereGeometry(0.45, 16, 12), glowMat(B_FIELD, 1)), [PX, -h - 0.5, 0])
    const starText = add(scene, label('STAR', { size: 0.5, color: B_FIELD, align: 'right' }), [PX - 0.8, -h - 1.2, 0])

    const flat = (o: THREE.Object3D, s: number) => {
      o.scale.setScalar(s)
      o.rotation.x = Math.PI / 2
      return o
    }
    flat(add(scene, buildEsp32(), ESP), MOD_K)
    add(scene, label('ESP32', { size: 0.5, color: B_FIELD, align: 'left' }), [ESP[0] + 0.2, ESP[1] + 2.4, 0])
    flat(add(scene, buildL298n(), DRV), MOD_K)
    add(scene, label('L298N', { size: 0.5, color: HEAT, align: 'left' }), [DRV[0] - 0.6, DRV[1] + 3.2, 0])
    add(scene, buildTtMotor(), MOTOR).scale.setScalar(0.16)
    const wheel = add(scene, buildWheel(), [MOTOR[0] - 0.64, MOTOR[1] + 0.6, -3])
    wheel.scale.setScalar(0.16)
    const FEED_Y = 6
    const espV: V3 = [ESP[0] - 0.8, ESP[1] + 1.4, 0]
    const drvV: V3 = [DRV[0] - 1.2, DRV[1] + 2.2, 0]
    const espG: V3 = [ESP[0] + 0.8, ESP[1] - 1.4, 0]
    const drvG: V3 = [DRV[0] + 0.5, DRV[1] - 2.2, 0]
    const feeds: V3[][] = [
      [top, [PX, FEED_Y, 0], [espV[0], FEED_Y, 0], espV],
      [[espV[0], FEED_Y, 0], [drvV[0], FEED_Y, 0], drvV],
    ]
    for (const f of feeds) insulated(scene, f, 0.16, RED_INS)
    const drvOut: V3 = [DRV[0] + 2, DRV[1] + 0.3, 0]
    insulated(scene, [drvOut, [MOTOR[0] - 0.4, drvOut[1], 0]], 0.12, '#e0e0e0')
    const feedFlows = feeds.map((f) => plusFlow(scene, lane(f, 0.5), () => 1))
    const espRet: V3[] = [espG, [espG[0], -5.4, 0], [PX + 0.5, -5.4, 0], [PX + 0.5, bottom[1], 0]]
    const routes = {
      daisy: [drvG, [drvG[0], -2.6, 0], [espG[0], -2.6, 0]] as V3[],
      star: [drvG, [drvG[0], -7, 0], [PX - 0.5, -7, 0], [PX - 0.5, bottom[1], 0]] as V3[],
    }
    const retGroup = add(scene, new THREE.Group())
    insulated(retGroup, espRet, 0.16, BLACK_INS)
    const espFlow = plusFlow(retGroup, lane(espRet, 0.5), () => 0)
    const drvRet = {
      daisy: add(scene, new THREE.Group()),
      star: add(scene, new THREE.Group()),
    }
    const drvFlows = {
      daisy: plusFlow(drvRet.daisy, lane(routes.daisy, 0.5), () => 0),
      star: plusFlow(drvRet.star, lane(routes.star, 0.5), () => 0),
    }
    insulated(drvRet.daisy, routes.daisy, 0.16, BLACK_INS)
    insulated(drvRet.star, routes.star, 0.16, BLACK_INS)
    const shared = add(scene, label('SHARED RETURN', { size: 0.45, color: RING, align: 'left' }), [PX + 1.4, -4.6, 0])
    const liftTag = pulseLabel(scene, 3, RING, [ESP[0] - 3.4, -1.4, 0], 0.7)
    add(scene, label('MV LIFT', { size: 0.4, color: GREY, align: 'left' }), [ESP[0] - 2, -1.4, 0])

    const plot = scope(scene, SC_W, SC_H, { divs: [6, 5], zeroAt: 0 })
    plot.group.position.set(...SC)
    const yOf = (v: number) => (v / LIFT_TOP) * SC_H - SC_H / 2
    ticks(plot, [], [0, 0.25, 0.5].map((v): [number, string] => [v / LIFT_TOP, String(Math.round(v * 1000))]), 0.5)
    add(plot.group, label('MCU GND  MV', { size: 0.42, color: RING }), [0, SC_H / 2 + 1, 0])
    add(plot.group, label('PWM 1000× SLOW', { size: 0.4, color: GREY }), [0, -SC_H / 2 - 1, 0])
    const trace = plot.trace(RING, { samples: 200, radius: 0.08 })

    const st = { key: '', t: 0, s: solveGround({ layout: 'daisy', motor: 2, wire: 'thin' }) }
    const isOn = (t: number) => ((t % PWM_S) + PWM_S) % PWM_S < PWM_S / 2

    return {
      scene,
      view: { center: [-1.2, 0, 0], radius: 62, polar: 1.4, azimuth: 0.06 },
      frame(dt, p) {
        const key = `${p.layout}|${p.motor}|${p.wire}`
        if (key !== st.key) {
          st.key = key
          st.s = solveGround(p)
          const daisy = st.s.layout === 'daisy'
          drvRet.daisy.visible = daisy
          drvRet.star.visible = !daisy
          shared.visible = daisy
          star.visible = !daisy
          starText.visible = !daisy
        }
        const s = st.s
        st.t += dt
        const on = isOn(st.t)
        const b = on ? s.on : s.off
        const motor = on ? s.motorA : 0
        const v = (a: number) => dt * Math.min(9, 2 * a)
        feedFlows[0].step(v(LOGIC_A + motor))
        feedFlows[1].step(v(motor))
        espFlow.step(v(s.layout === 'daisy' ? LOGIC_A + motor : LOGIC_A))
        drvFlows[s.layout].step(v(motor))
        wheel.rotation.z -= dt * 3 * motor
        trace.scroll((t) => yOf((isOn(t) ? s.on : s.off).lift), st.t, 3 * PWM_S)
        liftTag.show(String(Math.round(b.lift * 1000)))
        liftTag.frame(dt)
      },
      readouts: () => {
        const s = st.s
        const err = s.ideal - s.counts
        return [
          { label: 'MCU ground lift', value: `${Math.round(s.on.lift * 1000)} mV`, tone: s.on.lift > 0.1 ? 'bad' : s.on.lift > 0.03 ? 'warn' : 'ok' },
          { label: `ADC, ${volts(SENSOR_V)} sensor`, value: `${s.counts} / ${s.ideal}`, tone: err > 40 ? 'bad' : err > 10 ? 'warn' : 'ok' },
          { label: 'Each return wire', value: ohms(s.wireOhms) },
          { label: 'Wiring loss', value: watts(s.on.lossW) },
        ]
      },
    }
  },
}

