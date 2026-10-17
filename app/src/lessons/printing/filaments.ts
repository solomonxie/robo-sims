import * as THREE from 'three/webgpu'
import {
  CF_BASES,
  CfBase,
  FEEDERS,
  FILAMENTS,
  FILAMENT_KEYS,
  FILAMENT_PARTS,
  FILAMENT_PROPS,
  FeederKey,
  FilamentKey,
  FilamentPart,
  GRIP_N,
  NOZZLES,
  NOZZLE_MM,
  NozzleKey,
  PICK_PARTS,
  PickPart,
  TG_BRACKET,
  TPU_GRADES,
  TpuGrade,
  bracketSag,
  cfBlend,
  diffusivity,
  dryingPct,
  filamentMaterial,
  filamentScores,
  modulusRatio,
  moistureView,
  nozzleBore,
  padSquash,
  parkMiller,
  pickFilament,
  pushNeedN,
  softenC,
  stressAt,
  tpuFeed,
  uptakePct,
} from '../../core/physics'
import { celsiusText, fixedText, hoursText, mmFixed, newtonsText, pct } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  FILAMENT_TINT,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  WIDE_VIEW,
  addLabel,
  cantileverBeam,
  countBars,
  cursorBar,
  emptyGroup,
  filamentSpool,
  filamentStrand,
  glowDot,
  liveLabel,
  memoBy,
  partGlow,
  plotY,
  printedPart,
  shellMat,
  statusHeader,
  tempColor,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const filOf = (p: Params, d: FilamentKey = 'pla') => pick(FILAMENTS, p.fil, d) as FilamentKey
const filLegend = (keys: readonly FilamentKey[]) => keys.map((k) => ({ color: FILAMENT_TINT[k], label: FILAMENTS[k].name, shape: 'dot' as const }))
const PLOT = { x: 8.6, w: 12.4 }
const B_TINT = '#5ab8ff'

// --- Material properties: six filaments scored on nine properties, and a pick for a robot part. ---

const PROP_NAMES: Record<(typeof FILAMENT_PROPS)[number], string> = {
  strength: 'strength',
  stiffness: 'stiffness',
  toughness: 'toughness',
  heat: 'heat resistance',
  ease: 'easy to print',
  cheap: 'low cost',
  outdoor: 'UV / outdoors',
  flex: 'flexibility',
  wear: 'wear, low friction',
}
const mpRun = memoBy((p: Params) => `${p.part} ${p.fil}`, (p: Params) => {
  const part = pick(FILAMENT_PARTS, p.part, 'finger') as FilamentPart
  return { part, fil: filOf(p), R: pickFilament(part) }
})

export const filamentsMaterialProperties: Lesson = {
  id: 'filaments-material-properties',
  title: 'Material properties',
  tagline: 'PLA, PETG, ASA, TPU, nylon, PC: pick by what the part does',
  formula: (p) => {
    const { fil, part, R } = mpRun(p)
    const f = FILAMENTS[fil]
    const w = Object.entries(FILAMENT_PARTS[part].w).map(([k, v]) => `${v} × ${PROP_NAMES[k as keyof typeof PROP_NAMES]}`).join(' + ')
    return `${f.name}: nozzle ${f.nozzleC} °C, bed ${f.bedC} °C${f.enclosure ? ', enclosure' : ''}, E ${fixedText(f.E / 1e9, 2)} GPa, tensile ${Math.round(f.utsPa / 1e6)} MPa, HDT ${f.hdtC} °C, $${f.costKg}/kg (typical) · ${FILAMENT_PARTS[part].name}: score = ${w}, −3 if HDT < ${FILAMENT_PARTS[part].hotC + 10} °C → ${FILAMENTS[R.best].name}`
  },
  legend: filLegend(FILAMENT_KEYS),
  points: [
    'Filament is the material your part is made of, so choose it like any engineering material (Materials › Stress and strain). PLA is stiff, strong and easy, but brittle and soft above ~55 °C. PETG is tougher and takes more heat. ASA (outdoor ABS) takes heat and sunlight but warps without an enclosure. TPU is rubber. Nylon is tough and slippery: gears and hinges. PC takes the most heat and impact and is the hardest to print.',
    'Print settings follow the material: hotter nozzles and beds for the high-temperature plastics, and an enclosure for ASA, ABS, nylon and PC so the part cools evenly and does not warp (Temperature & cooling, Print problems).',
    'Pick from the job, not from a ranking. A gripper finger pad needs grip and flex: TPU. A motor mount sits next to a 50–60 °C motor, so PLA creeps (Materials › Thermal design); PETG or ASA hold. A gear needs toughness and low wear: nylon. An electronics box just needs to print easily and cheaply: PLA. Outdoors, sunlight yellows and embrittles PLA and ABS: ASA.',
    'The numbers are typical datasheet values for printed parts. Real parts are weaker across the layers (Strength) and every brand differs, so test a sample before trusting a load-bearing part.',
  ],
  controls: [
    { kind: 'choice', key: 'part', options: opts(namesOf(FILAMENT_PARTS)), initial: 'finger' },
    { kind: 'choice', key: 'fil', options: opts(namesOf(FILAMENTS)), initial: 'pla' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const spools = FILAMENT_KEYS.map((key, i) => {
      const x = -15.6 + i * 2.75
      const s = filamentSpool(scene, [x, 1.6, 0], 0.013)
      s.set(FILAMENT_TINT[key], 0.9)
      s.group.rotation.y = 0.5
      const name = liveLabel(scene, [x, -0.3, 0.4], { size: 0.26 })
      return { key, s, x, name }
    })
    const ring = glowDot(scene, 0.16, RING)
    const base = add(scene, new THREE.Group(), [-8.6, -10, 0])
    base.rotation.x = 0.3
    cylinder(base, 5, 0.5, mat('#2e323a', { rough: 0.6 }), [0, -0.25, 0], 'y', 40)
    const turn = add(base, new THREE.Group())
    const pickTag = liveLabel(scene, [-8.6, -2.6, 0.4], { size: 0.38 })
    const BX = 6
    addLabel(scene, 'selected filament (0…1, typical)', [2.4, 4.1, 0.3], LABEL, 0.3, 'left')
    const props = countBars(scene, [BX, 3.2, 0], FILAMENT_PROPS.map((k) => PROP_NAMES[k]), 6, { row: 0.86, size: 0.29 })
    const scoreTitle = liveLabel(scene, [2.4, -5.3, 0.3], { size: 0.3, align: 'left' })
    const scores = countBars(scene, [BX, -6.3, 0], FILAMENT_KEYS.map((k) => FILAMENTS[k].name), 6, { row: 0.86, size: 0.29 })
    const st = { key: '', spin: 0, glow: (_f: number) => {} }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { part, fil, R } = mpRun(p)
        const P = FILAMENT_PARTS[part]
        const key = `${part} ${R.best}`
        if (key !== st.key) {
          st.key = key
          emptyGroup(turn)
          const model = P.model as PickPart
          const k = Math.min(8.4 / PICK_PARTS[model].size, 6.8 / PICK_PARTS[model].h)
          printedPart(turn, model, k, mat(FILAMENT_TINT[R.best], { rough: 0.55 }, true))
          st.glow = partGlow(turn, RING)
        }
        st.spin += dt * 0.5
        turn.rotation.y = st.spin
        st.glow(0.15 + 0.1 * Math.sin(st.spin * 4))
        for (const s of spools) {
          const on = s.key === fil
          s.s.group.position.y = 1.6 + (on ? 0.5 : 0)
          s.s.group.rotation.z = on ? st.spin : 0
          s.name.set(FILAMENTS[s.key].name.replace(' (PA6)', '').replace('Polycarbonate', 'PC'), on ? FILAMENT_TINT[s.key] : s.key === R.best ? RING : GREY)
          if (s.key === R.best) ring.position.set(s.x, -0.9, 0.4)
        }
        const sc = filamentScores(fil)
        props.set(FILAMENT_PROPS.map((k) => sc[k]), FILAMENT_PROPS.map((k) => pct(sc[k])), FILAMENT_PROPS.map(() => FILAMENT_TINT[fil]), 1)
        scoreTitle.set(`score for a ${P.name.toLowerCase()}`, LABEL)
        scores.set(R.rows.map((r) => r.score), R.rows.map((r) => (r.hotOk ? fixedText(r.score, 1) : `${fixedText(r.score, 1)} too hot`)), R.rows.map((r) => (r.key === R.best ? RING : r.hotOk ? FILAMENT_TINT[r.key] : HIGH_V)))
        const f = FILAMENTS[fil]
        pickTag.set(`${P.name} in ${FILAMENTS[R.best].name}`, RING)
        head.status.set(`Material properties · ${f.name}`)
        head.sub.set(`nozzle ${f.nozzleC} °C · bed ${f.bedC} °C · ${f.enclosure ? 'needs an enclosure' : 'open printer is fine'} · $${f.costKg}/kg (typical)`, GREY)
        head.event.set(`best for a ${P.name.toLowerCase()}: ${FILAMENTS[R.best].name}`, RING)
      },
      readouts: (p) => {
        const { fil, R } = mpRun(p)
        const f = FILAMENTS[fil]
        return [
          { label: 'Best pick', value: FILAMENTS[R.best].name },
          { label: 'Print temp', value: celsiusText(f.nozzleC) },
          { label: 'Softens near', value: celsiusText(f.hdtC) },
        ]
      },
    }
  },
}

// --- Glass transition temp: modulus vs temperature, and a loaded bracket sagging as it passes Tg. ---

const TG_KEYS = ['pla', 'petg', 'asa', 'nylon', 'pc'] as const satisfies readonly FilamentKey[]
const TG_RANGE = [20, 160] as const
const TG_TEMPS = Array.from({ length: 141 }, (_, i) => TG_RANGE[0] + i)
const tgRun = memoBy((p: Params) => `${p.fil} ${p.temp} ${p.kg}`, (p: Params) => {
  const fil = pick(Object.fromEntries(TG_KEYS.map((k) => [k, 1])), p.fil, 'pla') as FilamentKey
  const c = n(p, 'temp')
  const kg = n(p, 'kg')
  return { fil, c, kg, ratio: modulusRatio(fil, c), S: bracketSag(fil, c, kg), cool: bracketSag(fil, 25, kg) }
})
const PLACES: [number, string][] = [
  [25, 'room'],
  [45, 'next to a motor'],
  [65, 'a car dashboard in sun'],
  [100, 'boiling water'],
]

export const filamentsGlassTransitionTemp: Lesson = {
  id: 'filaments-glass-transition-temp',
  title: 'Glass transition temp',
  tagline: 'Above Tg the plastic turns soft and leathery',
  formula: (p) => {
    const { fil, c, kg, ratio, S } = tgRun(p)
    const { lenMm: L, wMm: w, tMm: t } = TG_BRACKET
    return `E(${c} °C) = ${pct(ratio)} of E(25 °C) = ${fixedText(S.E, 0)} MPa (${FILAMENTS[fil].name}, Tg ≈ ${FILAMENTS[fil].tgC} °C, typical) · sag = F·L³ / 3EI = ${fixedText(kg * 9.81, 1)} N × (${L} mm)³ / (3 × ${fixedText(S.E, 0)} MPa × ${w}·${t}³/12 mm⁴) = ${mmFixed(S.sagMm, 1)}${S.folds ? ': folds over' : ''}`
  },
  legend: filLegend(TG_KEYS),
  points: [
    'A plastic is a tangle of long chains. Below the glass transition temperature Tg they are frozen in place and the part is stiff; above it they can slide past each other and the stiffness drops a hundredfold within a few degrees. Tg is not the melting point: the part does not drip, it goes soft and leathery and sags under any load.',
    'Typical Tg: PLA ≈ 60 °C, PETG ≈ 80 °C, ABS/ASA ≈ 105 °C, PC ≈ 147 °C. A car dashboard in the sun reaches 70–90 °C, a motor or driver heatsink 50–60 °C, so a PLA bracket there droops even before Tg, because plastics also creep slowly under load as they warm (Materials › Thermal design).',
    'Nylon is semi-crystalline: its Tg is low (≈ 55 °C dry), but the crystals keep part of the stiffness until they melt near 220 °C, which is why nylon gears survive warm motors. PLA can be annealed to grow crystals and keep stiffness to ~100 °C, at the price of shrinking and warping (Strength › Annealing).',
    'TPU has its Tg below −30 °C: at room temperature it is already past it, which is why it is rubbery (Flexible TPU). Pick a filament whose softening point is at least 10–20 °C above the hottest place the part will sit.',
  ],
  controls: [
    { kind: 'choice', key: 'fil', options: TG_KEYS.map((k) => ({ value: k, label: FILAMENTS[k].name })), initial: 'pla' },
    { kind: 'slider', key: 'temp', label: 'Part temperature', min: TG_RANGE[0], max: TG_RANGE[1], step: 5, initial: 25, format: (v) => `${v} °C` },
    { kind: 'slider', key: 'kg', label: 'Load on the arm', min: 0.1, max: 1, step: 0.1, initial: 0.5, format: (v) => `${fixedText(v, 1)} kg` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const LEN = 14
    const k = LEN / TG_BRACKET.lenMm
    const beam = cantileverBeam(scene, [-15.6, -1.4, 0], LEN, { width: 2.8, clampH: 5.5 })
    beam.group.rotation.y = 0.25
    const load = add(scene, new THREE.Group())
    box(load, [2.2, 2.2, 2.2], mat('#2b2d33', { rough: 0.55 }), [0, -2.6, 0])
    const hook = add(load, new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 8), mat('#aab1bb', { metal: 0.5 })), [0, -0.75, 0])
    hook.castShadow = false
    const loadTag = liveLabel(load, [0, -2.6, 1.3], { size: 0.32 })
    const sagTag = liveLabel(scene, [-8.6, -10.8, 0.3], { size: 0.4 })
    const placeTag = liveLabel(scene, [-8.6, -11.8, 0.3], { size: 0.32, color: GREY })
    const P = { ...PLOT, y: -2.4, h: 10 }
    const plot = titledScope(scene, P.y, P.h, 'stiffness vs temperature', LABEL, 0, P.x, P.w)
    plot.lo.set(`${TG_RANGE[0]} °C`)
    plot.hi.set(`${TG_RANGE[1]} °C`)
    addLabel(scene, '100 %', [P.x - P.w / 2 - 0.3, P.y + P.h / 2, 0.3], GREY, 0.24, 'right')
    addLabel(scene, '50 %', [P.x - P.w / 2 - 0.3, P.y, 0.3], GREY, 0.24, 'right')
    const curves = TG_KEYS.map((key) => plot.s.trace(FILAMENT_TINT[key], { samples: TG_TEMPS.length, radius: 0.05 }))
    const py = plotY(0, 1.05, P.h)
    const us = TG_TEMPS.map((c) => (c - TG_RANGE[0]) / (TG_RANGE[1] - TG_RANGE[0]))
    TG_KEYS.forEach((key, i) => curves[i].points(us, TG_TEMPS.map((c) => py(modulusRatio(key, c))), null))
    plot.s.level(GREY).set(py(0.5))
    const mark = glowDot(plot.s.group, 0.26, RING)
    const cursor = cursorBar(plot.s, RING, 0.05)
    const rows = textRows(scene, 3, 2.4, -10.2, 0.3, 0.72)
    const tint = new THREE.Color()
    const hot = new THREE.Color()
    const st = { drop: 0 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { fil, c, kg, ratio, S, cool } = tgRun(p)
        const target = 0.45 * LEN * Math.tanh((S.sagMm * k) / (0.45 * LEN))
        st.drop += (target - st.drop) * Math.min(1, dt * 4)
        tint.set(FILAMENT_TINT[fil]).lerp(tempColor(c * 1.4, hot), Math.min(0.6, (c - 20) / 200))
        beam.set(TG_BRACKET.tMm * k * 1.6, (u) => st.drop * (u * u * (3 - u)) / 2, () => tint, 0.15 + 0.4 * (1 - ratio))
        beam.group.updateMatrixWorld(true)
        const tip = new THREE.Vector3(LEN, -st.drop, 0)
        beam.group.localToWorld(tip)
        load.position.copy(tip)
        loadTag.set(`${fixedText(kg, 1)} kg`, LABEL)
        const u = (c - TG_RANGE[0]) / (TG_RANGE[1] - TG_RANGE[0])
        mark.position.set(plot.s.xAt(u), py(ratio), 0.46)
        ;(mark.material as THREE.MeshStandardMaterial).emissive.set(FILAMENT_TINT[fil])
        cursor(u)
        plot.right.set(`${FILAMENTS[fil].name}: ${pct(ratio)}`, FILAMENT_TINT[fil])
        const place = [...PLACES].reverse().find(([t]) => c >= t)
        sagTag.set(S.folds ? 'too soft to hold the load: folds over' : `tip sags ${mmFixed(S.sagMm, 1)}`, S.folds ? HIGH_V : S.soft ? HEAT : POWER)
        placeTag.set(place ? `${celsiusText(c)}: about ${place[1]}` : '', GREY)
        rows[0].set(`Tg ≈ ${celsiusText(FILAMENTS[fil].tgC)} · half stiffness at ${celsiusText(softenC(fil))}`, FILAMENT_TINT[fil])
        rows[1].set(`E = ${fixedText(S.E, 0)} MPa (cool: ${fixedText(cool.E, 0)} MPa)`, LABEL)
        rows[2].set(`bending stress ${fixedText(S.stressMPa, 0)} MPa · sag ${fixedText(S.sagMm / cool.sagMm, 1)} × the cool sag`, GREY)
        head.status.set(`Glass transition temp · ${FILAMENTS[fil].name} at ${celsiusText(c)}`)
        head.sub.set(`${TG_BRACKET.lenMm} mm printed arm, ${TG_BRACKET.wMm} × ${TG_BRACKET.tMm} mm, load at the tip (typical)`, GREY)
        head.event.set(S.folds ? 'past Tg: soft and leathery, the arm folds' : S.soft ? 'near Tg: softening, it will creep' : 'below Tg: glassy and stiff', S.folds ? HIGH_V : S.soft ? HEAT : POWER)
      },
      readouts: (p) => {
        const { fil, ratio, S } = tgRun(p)
        return [
          { label: 'Stiffness left', value: pct(ratio), tone: toneOf(ratio > 0.8, ratio > 0.5) },
          { label: 'Tip sag', value: S.folds ? 'folds' : mmFixed(S.sagMm, 1), tone: toneOf(!S.soft, !S.folds) },
          { label: 'Tg', value: celsiusText(FILAMENTS[fil].tgC) },
        ]
      },
    }
  },
}

// --- Flexible TPU: Shore hardness, a squashed gripper pad, and soft filament buckling between the gears and the hotend. ---

const SPEED_MAX = 80
const PAD_N = 40
const F_MAX = 60
const tpRun = memoBy((p: Params) => `${p.grade} ${p.feed} ${p.speed}`, (p: Params) => {
  const grade = pick(TPU_GRADES, p.grade, 'a95') as TpuGrade
  const feed = pick(FEEDERS, p.feed, 'bowden') as FeederKey
  const speed = n(p, 'speed')
  return { grade, feed, speed, F: tpuFeed(grade, feed, speed), squash: padSquash(grade, PAD_N) }
})
const gradeTint = (g: TpuGrade) => (g === 'pla' ? FILAMENT_TINT.pla : g === 'a85' ? '#b5ee8f' : g === 'a90' ? '#97df6f' : FILAMENT_TINT.tpu)
const SPEEDS = Array.from({ length: 41 }, (_, i) => (i * SPEED_MAX) / 40)

export const filamentsFlexibleTpu: Lesson = {
  id: 'filaments-flexible-tpu',
  title: 'Flexible TPU',
  tagline: 'Rubber you can print: slowly, and pushed from close by',
  formula: (p) => {
    const { grade, feed, F } = tpRun(p)
    return `buckling load = 4π²·E·I / L² = 4π² × ${fixedText(F.E / 1e6, 0)} MPa × π·1.75⁴/64 mm⁴ / (${FEEDERS[feed].gapMm} mm)² = ${newtonsText(F.pcr, 0)} · push needed ≈ 3 N + ${TPU_GRADES[grade].kPush} N per mm³/s × ${fixedText(F.flow, 1)} mm³/s = ${newtonsText(F.need, 1)} · gear grip ≈ ${GRIP_N} N (typical) · E from Shore A (Gent)`
  },
  legend: [
    { color: FILAMENT_TINT.tpu, label: 'Push the melt needs', shape: 'dot' },
    { color: HIGH_V, label: 'Buckling load in the gap', shape: 'dot' },
    { color: GREY, label: 'Drive-gear grip', shape: 'dot' },
  ],
  points: [
    'TPU (thermoplastic polyurethane) is a printable rubber. Its hardness is given on the Shore A scale: 85A is soft like an eraser, 95A like a skateboard wheel. Its modulus is 15–50 MPa, about a hundredth of PLA, so a TPU pad squashes, grips and springs back: tyres, gripper finger pads, bumpers, cable strain reliefs, dampers.',
    'Printing it is the hard part. The extruder pushes filament like a rod; a soft rod buckles if it is pushed over too long a free length (Euler: load ∝ E / L²). Between the drive gears and the next guide a Bowden extruder leaves several mm of free filament, a direct-drive extruder about 1–2 mm. Soft TPU buckles and coils up in the gap, or wraps round the gears.',
    'Even when it does not buckle, a Bowden tube makes TPU a long spring: hundreds of mm of soft filament between the gears and the nozzle compress before any plastic comes out, so retraction and flow control barely work (stringing and blobs, Print problems). Direct drive keeps that spring short.',
    'So print TPU slowly (15–30 mm/s), with retraction low or off, in a direct-drive extruder with a constrained path. Harder 95A tolerates a Bowden at slow speed; 85A really needs direct drive. TPU also soaks up water quickly: dry it first (Drying wet filament).',
  ],
  controls: [
    { kind: 'choice', key: 'grade', options: opts(namesOf(TPU_GRADES)), initial: 'a95' },
    { kind: 'choice', key: 'feed', options: opts(namesOf(FEEDERS)), initial: 'bowden' },
    { kind: 'slider', key: 'speed', label: 'Print speed', min: 5, max: SPEED_MAX, step: 5, initial: 20, format: (v) => `${v} mm/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const X = -11.2
    const GEAR_Y = 1.6
    const R = 1.1
    const gearM = mat('#d9b24a', { metal: 0.35, rough: 0.4 }, true)
    const gears = [-1, 1].map((s) => {
      const g = add(scene, new THREE.Group(), [X + s * (R + 0.18), GEAR_Y, 0])
      cylinder(g, R, 1.2, gearM, [0, 0, 0], 'z', 20)
      for (let i = 0; i < 12; i++) box(g, [0.24, 0.24, 1.2], gearM, [Math.cos((i / 12) * Math.PI * 2) * R, Math.sin((i / 12) * Math.PI * 2) * R, 0])
      return g
    })
    const guide = add(scene, new THREE.Group())
    const tubeM = shellMat('#dfe6ee', 0.35)
    const tube = cylinder(guide, 0.5, 1, tubeM, [0, 0, 0], 'y', 16)
    const hotend = add(scene, new THREE.Group(), [X, -9.6, 0])
    box(hotend, [2.6, 1.4, 1.6], mat('#aab1bb', { metal: 0.5, rough: 0.4 }), [0, 0, 0])
    cylinder(hotend, 0.5, 1, mat('#d9b24a', { metal: 0.4 }), [0, -1.1, 0], 'y', 12)
    const strand = filamentStrand(scene, 60, 0.2, FILAMENT_TINT.tpu)
    const gapTag = liveLabel(scene, [X + 1.6, 0, 0.4], { size: 0.3, align: 'left' })
    const stateTag = liveLabel(scene, [X, -11.9, 0.4], { size: 0.36 })
    const PAD = { x: -3.6, y: -8.2 }
    addLabel(scene, `pad, 15 % infill, ${PAD_N} N`, [PAD.x, PAD.y - 2.9, 3], GREY, 0.28)
    const padM = mat(FILAMENT_TINT.tpu, { rough: 0.8 }, true)
    const pad = box(scene, [5, 3, 5], padM, [PAD.x, PAD.y, 0])
    const jaw = box(scene, [5.6, 0.5, 5.6], mat('#5a606b', { metal: 0.4 }), [PAD.x, PAD.y + 1.75, 0])
    box(scene, [5.6, 0.5, 5.6], mat('#5a606b', { metal: 0.4 }), [PAD.x, PAD.y - 1.75, 0])
    const padTag = liveLabel(scene, [PAD.x, PAD.y + 2.7, 0.4], { size: 0.3 })
    const P = { ...PLOT, y: -2.4, h: 10 }
    const plot = titledScope(scene, P.y, P.h, 'force vs print speed', LABEL, 0, P.x, P.w)
    plot.lo.set('0 mm/s')
    plot.hi.set(`${SPEED_MAX} mm/s`)
    addLabel(scene, `${F_MAX} N`, [P.x - P.w / 2 - 0.3, P.y + P.h / 2, 0.3], GREY, 0.24, 'right')
    const need = plot.s.trace(FILAMENT_TINT.tpu, { samples: SPEEDS.length, radius: 0.06 })
    const py = plotY(0, F_MAX, P.h)
    const buckle = plot.s.level(HIGH_V)
    plot.s.level(GREY).set(py(GRIP_N))
    const mark = glowDot(plot.s.group, 0.26, RING)
    const cursor = cursorBar(plot.s, RING, 0.05)
    const rows = textRows(scene, 3, 2.4, -10.2, 0.3, 0.72)
    const st = { spin: 0, kink: 0, key: '' }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { grade, feed, speed, F, squash } = tpRun(p)
        const key = `${grade} ${feed}`
        if (key !== st.key) [st.key, st.kink] = [key, 0]
        const tint = gradeTint(grade)
        const gap = feed === 'bowden' ? 2.6 : 0.7
        const top = GEAR_Y
        const gapEnd = top - R - gap
        guide.position.set(X, (gapEnd - 8.9) / 2, 0)
        tube.scale.set(feed === 'bowden' ? 1 : 1.4, gapEnd + 8.9, feed === 'bowden' ? 1 : 1.4)
        tubeM.color.set(feed === 'bowden' ? '#dfe6ee' : '#8a929e')
        const stalled = F.buckles || F.slips
        st.spin += dt * (F.slips ? speed * 0.12 : stalled ? 0.3 : speed * 0.06)
        gears[0].rotation.z = -st.spin
        gears[1].rotation.z = st.spin
        gearM.emissive.set(F.slips ? HIGH_V : '#000000')
        st.kink = F.buckles ? Math.min(1, st.kink + dt * 0.8) : Math.max(0, st.kink - dt * 2)
        const pts: V3[] = []
        for (let i = 0; i <= 59; i++) {
          const y = top + 3 - (i / 59) * (top + 3 + 9.6)
          const inGap = y < top - R * 0.3 && y > gapEnd
          const s = inGap ? (top - R * 0.3 - y) / (top - R * 0.3 - gapEnd) : 0
          const amp = inGap ? st.kink * Math.min(1.6, gap * 0.8) * Math.sin(Math.PI * s) : 0
          pts.push([X + amp * Math.sin(s * Math.PI * 3), y, amp * 0.6 * Math.cos(s * Math.PI * 3)])
        }
        strand.set(pts)
        strand.color(tint)
        gapTag.set(`free gap ${FEEDERS[feed].gapMm} mm`, GREY)
        stateTag.set(F.buckles ? 'buckles in the gap: jam' : F.slips ? 'gears strip the filament' : 'feeds', F.buckles || F.slips ? HIGH_V : POWER)
        const sq = squash * 0.5
        pad.scale.y = (3 - sq) / 3
        pad.position.y = PAD.y - sq / 2
        jaw.position.y = PAD.y + 1.75 - sq
        padM.color.set(tint)
        padTag.set(`squashes ${mmFixed(squash, 2)}`, grade === 'pla' ? GREY : tint)
        need.points(SPEEDS.map((v) => v / SPEED_MAX), SPEEDS.map((v) => py(pushNeedN(grade, v))), null)
        need.material.color.set(tint)
        need.material.emissive.set(tint)
        buckle.set(py(F.pcr))
        const u = speed / SPEED_MAX
        mark.position.set(plot.s.xAt(u), Math.min(P.h / 2, py(F.need)), 0.46)
        cursor(u)
        plot.right.set(`buckles at ${F.pcr > F_MAX ? `> ${F_MAX}` : Math.round(F.pcr)} N`, HIGH_V)
        rows[0].set(`E ≈ ${fixedText(F.E / 1e6, 0)} MPa · push needed ${newtonsText(F.need, 1)}`, tint)
        rows[1].set(`max speed here ≈ ${Math.round(F.maxSpeed)} mm/s before ${F.maxSpeed > 0 && Math.min(F.pcr, GRIP_N) === GRIP_N ? 'the gears slip' : 'it buckles'}`, F.maxSpeed >= speed ? POWER : HIGH_V)
        rows[2].set(`spring in the path: ${mmFixed(F.springMm, 1)} of squeeze over ${FEEDERS[feed].pathMm} mm`, F.springMm > 5 ? HEAT : GREY)
        head.status.set(`Flexible TPU · ${TPU_GRADES[grade].name}, ${FEEDERS[feed].name}`)
        head.sub.set(`${speed} mm/s, 0.45 × 0.2 mm lines: ${fixedText(F.flow, 1)} mm³/s (typical)`, GREY)
        head.event.set(F.buckles ? 'the soft filament buckles before the melt moves' : F.slips ? 'push exceeds the gear grip' : 'filament feeds cleanly', F.buckles || F.slips ? HIGH_V : POWER)
      },
      readouts: (p) => {
        const { F, speed } = tpRun(p)
        return [
          { label: 'Push needed', value: newtonsText(F.need, 1), tone: toneOf(!F.buckles && !F.slips, false) },
          { label: 'Buckles at', value: newtonsText(F.pcr, 0) },
          { label: 'Max speed', value: `${Math.round(F.maxSpeed)} mm/s`, tone: toneOf(F.maxSpeed >= speed * 1.3, F.maxSpeed >= speed) },
        ]
      },
    }
  },
}

// --- Carbon-fibre blends: short fibres stiffen the plastic, cost toughness and layer bond, and wear brass nozzles. ---

const KG_MAX = 3
const cfRun = memoBy((p: Params) => `${p.base} ${p.cf} ${p.noz} ${p.kg}`, (p: Params) => {
  const base = pick(Object.fromEntries(CF_BASES.map((k) => [k, 1])), p.base, 'pla') as CfBase
  const w = n(p, 'cf') / 100
  const noz = pick(NOZZLES, p.noz, 'brass') as NozzleKey
  const kg = n(p, 'kg')
  const B = cfBlend(base, w)
  return { base, w, noz, kg, B, bore: nozzleBore(noz, B.vf, kg) }
})
const NOZ_COLOR: Record<NozzleKey, string> = { brass: '#d9b24a', steel: '#9aa3ad', ruby: '#ff4d6d' }
const CF_DARK = '#2a2c30'

export const filamentsCarbonFibreBlends: Lesson = {
  id: 'filaments-carbon-fibre-blends',
  title: 'Carbon-fibre blends',
  tagline: 'Stiffer and matte, but more brittle and hard on nozzles',
  formula: (p) => {
    const { base, w, B, noz, kg, bore } = cfRun(p)
    const f = FILAMENTS[base]
    return `fibre volume = (w/1.8) / (w/1.8 + (1−w)/${f.rho}) = ${pct(B.vf)} · E = E_plastic·(1 − Vf) + 0.1 × 230 GPa × Vf = ${fixedText(B.mat.E / 1e9, 1)} GPa (${fixedText(B.stiffer, 1)} × ${f.name}, short fibres, typical) · ${NOZZLES[noz].name} bore after ${fixedText(kg, 2)} kg of ${pct(w)} CF: ${mmFixed(bore, 2)} (from ${NOZZLE_MM} mm)`
  },
  legend: (p) => {
    const { base } = cfRun(p)
    return [
      { color: FILAMENT_TINT[base], label: `${FILAMENTS[base].name}, plain`, shape: 'dot' },
      { color: LABEL, label: `${FILAMENTS[base].name}-CF blend`, shape: 'dot' },
      ...(Object.keys(NOZZLES) as NozzleKey[]).map((k) => ({ color: NOZ_COLOR[k], label: `${NOZZLES[k].name} nozzle`, shape: 'dot' as const })),
    ]
  },
  points: [
    'Carbon-fibre filaments are ordinary PLA, PETG or nylon with 10–25 % chopped carbon fibres, each about 7 µm thick and a fraction of a mm long. The fibres are 60–100 times stiffer than the plastic and line up roughly along the printed lines, so the part gets stiffer, lighter-looking and matte, and warps less.',
    'Short, randomly placed fibres only pass on a fraction of their stiffness, so expect 1.5–2.5 × the stiffness, not carbon-tube numbers, and roughly the same strength. The fibres also stop the plastic stretching before it breaks (more brittle, see the curves) and get in the way at the layer joints, so layer adhesion drops (Strength).',
    'Carbon fibre is abrasive. It sands the inside of a soft brass nozzle: after a few hundred grams the 0.4 mm bore is visibly wider, lines get wider and blobby and fine detail goes. Use a hardened steel nozzle (lasts tens of kg; it conducts heat worse, so print ~10 °C hotter) or a ruby or carbide tip. Glass-fibre and glow-in-the-dark filaments are abrasive too.',
    'Use a 0.6 mm nozzle if you can: fibre clumps clog a 0.4 mm one (Print problems › Clogged nozzle). Good robot uses: stiff arm links, frames and brackets that must not flex; not snap fits or parts that take impacts.',
  ],
  controls: [
    { kind: 'choice', key: 'base', options: CF_BASES.map((k) => ({ value: k, label: FILAMENTS[k].name })), initial: 'pla' },
    { kind: 'slider', key: 'cf', label: 'Carbon fibre by weight', min: 0, max: 30, step: 5, initial: 20, format: (v) => `${v} %` },
    { kind: 'choice', key: 'noz', options: opts(namesOf(NOZZLES)), initial: 'brass' },
    { kind: 'slider', key: 'kg', label: 'Filament printed', min: 0, max: KG_MAX, step: 0.25, initial: 1, format: (v) => `${fixedText(v, 2)} kg` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const C = { x: -9.6, y: -2.4 }
    const S = 9
    const nozM = mat('#d9b24a', { metal: 0.5, rough: 0.35 }, true)
    const nozzle = add(scene, new THREE.Group(), [C.x, C.y, 0])
    nozzle.scale.setScalar(1.3)
    const walls = [-1, 1].map((s) => ({
      s,
      body: box(nozzle, [2.2, 3.4, 3], nozM, [0, 2.4, 0]),
      tip: box(nozzle, [1, 3, 2.2], nozM, [0, -0.8, 0]),
    }))
    const bore = add(nozzle, new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), shellMat('#0b0d10', 0.55)))
    const boreTag = liveLabel(scene, [C.x, C.y - 6.4, 0.4], { size: 0.38 })
    addLabel(scene, 'nozzle, cut open', [C.x, C.y + 6.6, 0.4], GREY, 0.3)
    const rng = parkMiller(11)
    const FIB = 90
    const fibreM = mat(CF_DARK, { rough: 0.4 }, true)
    const fibres = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), fibreM, FIB)
    fibres.frustumCulled = false
    fibres.castShadow = false
    nozzle.add(fibres)
    const seeds = Array.from({ length: FIB }, () => ({ u: rng(), x: rng() * 2 - 1, z: rng() * 2 - 1, tilt: (rng() - 0.5) * 0.7, spin: rng() * Math.PI * 2, len: 0.5 + rng() * 0.6 }))
    const meltM = shellMat(FILAMENT_TINT.pla, 0.5, 0.5)
    const melt = add(nozzle, new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), meltM))
    const bead = add(nozzle, new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), meltM))
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const hide = new THREE.Matrix4().makeScale(0, 0, 0)
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const rows = textRows(scene, 3, -16.6, -10.4, 0.3, 0.72)
    const T = { ...PLOT, y: 0.6, h: 5.2 }
    const ss = titledScope(scene, T.y, T.h, 'stress vs strain', LABEL, 0, T.x, T.w)
    const plain = ss.s.trace(FILAMENT_TINT.pla, { samples: 83, radius: 0.05 })
    const blend = ss.s.trace(LABEL, { samples: 83, radius: 0.06 })
    const W = { ...PLOT, y: -8.4, h: 5.2 }
    const ws = titledScope(scene, W.y, W.h, 'nozzle bore vs kg printed', LABEL, 0, W.x, W.w)
    ws.lo.set('0 kg')
    ws.hi.set(`${KG_MAX} kg`)
    addLabel(scene, '1 mm', [W.x - W.w / 2 - 0.3, W.y + W.h / 2, 0.3], GREY, 0.24, 'right')
    addLabel(scene, '0.4', [W.x - W.w / 2 - 0.3, W.y - W.h / 2, 0.3], GREY, 0.24, 'right')
    const NK = Object.keys(NOZZLES) as NozzleKey[]
    const wear = NK.map((k) => ws.s.trace(NOZ_COLOR[k], { samples: 41, radius: 0.05 }))
    const wy = plotY(NOZZLE_MM, 1, W.h)
    const mark = glowDot(ws.s.group, 0.24, RING)
    const cursor = cursorBar(ws.s, RING, 0.05)
    const st = { t: 0 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { base, w, noz, kg, B, bore: d } = cfRun(p)
        st.t += dt
        nozM.color.set(NOZ_COLOR[noz])
        const r = (d / 2) * S * 0.5
        for (const wl of walls) {
          wl.body.position.x = wl.s * (r + 1.1)
          wl.tip.position.x = wl.s * (r + 0.5)
        }
        bore.scale.set(r, 6.6, r)
        bore.position.y = 0.6
        meltM.color.set(FILAMENT_TINT[base])
        melt.scale.set(r * 0.95, 7.4, r * 0.95)
        melt.position.y = 0.4
        bead.scale.set(r, 1.4, r)
        bead.position.y = -3.4
        const shownFibres = Math.round(FIB * Math.min(1, B.vf / 0.2))
        seeds.forEach((s, i) => {
          if (i >= shownFibres) return fibres.setMatrixAt(i, hide)
          const u = (s.u + st.t * 0.12) % 1
          const y = 4 - u * 8
          const rr = r * 0.8
          e.set(s.tilt, s.spin, s.tilt * 0.5)
          q.setFromEuler(e)
          fibres.setMatrixAt(i, m4.compose(pos.set(s.x * rr, y, s.z * rr + 0.2), q, scl.set(1, s.len, 1)))
        })
        fibres.instanceMatrix.needsUpdate = true
        boreTag.set(`bore ${mmFixed(d, 2)}${d > 0.5 ? ': worn, lines blob' : ''}`, d > 0.5 ? HIGH_V : d > 0.43 ? HEAT : POWER)

        const pm = filamentMaterial(base)
        const eMax = pm.failStrain * 1.15
        const sMax = Math.max(pm.utsPa, B.mat.utsPa) * 1.15
        const sy = plotY(0, sMax, T.h)
        const es = Array.from({ length: 81 }, (_, i) => (i / 80) * eMax)
        const upTo = (m: typeof pm) => {
          const k = Math.min(80, Math.ceil((m.failStrain / eMax) * 80))
          const xs = es.slice(0, k + 1)
          return { u: [...xs.map((x) => x / eMax), xs[k] / eMax], y: [...xs.map((x) => sy(stressAt(m, Math.min(x, m.failStrain)))), sy(0)] }
        }
        const a = upTo(pm)
        plain.points(a.u, a.y, null)
        plain.material.color.set(FILAMENT_TINT[base])
        plain.material.emissive.set(FILAMENT_TINT[base])
        const b = upTo(B.mat)
        blend.points(b.u, b.y, w > 0 ? b.u.length - 2 : null)
        ss.lo.set('0')
        ss.hi.set(`strain ${pct(eMax)}`)
        ss.right.set(`${fixedText(B.mat.E / 1e9, 1)} GPa vs ${fixedText(pm.E / 1e9, 1)}`, LABEL)

        NK.forEach((k, i) => wear[i].points(Array.from({ length: 41 }, (_, j) => j / 40), Array.from({ length: 41 }, (_, j) => wy(nozzleBore(k, B.vf, (j / 40) * KG_MAX))), null))
        const u = kg / KG_MAX
        mark.position.set(ws.s.xAt(u), wy(d), 0.46)
        ;(mark.material as THREE.MeshStandardMaterial).emissive.set(NOZ_COLOR[noz])
        cursor(u)
        ws.right.set(`${NOZZLES[noz].name}: ${mmFixed(d, 2)}`, NOZ_COLOR[noz])
        rows[0].set(`fibre ${pct(w)} by weight = ${pct(B.vf)} by volume`, LABEL)
        rows[1].set(`stiffness ${fixedText(B.stiffer, 1)} × · stretch ${pct(B.toughness)} left`, B.stiffer > 1.2 ? POWER : GREY)
        rows[2].set(`layer bond ≈ ${pct(B.layerBond)} of plain (typical)`, B.layerBond < 0.8 ? HEAT : GREY)
        head.status.set(`Carbon-fibre blends · ${FILAMENTS[base].name}${w > 0 ? `-CF ${pct(w)}` : ''}`)
        head.sub.set(`${NOZZLES[noz].name} nozzle${NOZZLES[noz].extraC ? `, print ${NOZZLES[noz].extraC} °C hotter` : ''} · ${fixedText(kg, 2)} kg printed`, GREY)
        head.event.set(d > 0.5 ? 'nozzle worn out: replace it' : w > 0 && noz === 'brass' ? 'fibres are sanding the brass bore' : 'nozzle holds its size', d > 0.5 ? HIGH_V : w > 0 && noz === 'brass' ? HEAT : POWER)
      },
      readouts: (p) => {
        const { B, bore: d } = cfRun(p)
        return [
          { label: 'Stiffness', value: `${fixedText(B.stiffer, 1)} ×` },
          { label: 'Layer bond', value: pct(B.layerBond), tone: toneOf(B.layerBond > 0.85, B.layerBond > 0.65) },
          { label: 'Nozzle bore', value: mmFixed(d, 2), tone: toneOf(d < 0.43, d < 0.5) },
        ]
      },
    }
  },
}

// --- Drying wet filament: water diffuses into the strand over days in humid air and out over hours in a dryer. ---

const DAYS_MAX = 14
const DRY_SPAN = 24
const SOAK_S = 4
const DRY_S = 4
const HOLD_S = 2
const dwRun = memoBy((p: Params) => `${p.fil} ${p.days} ${p.dry} ${p.dia}`, (p: Params) => {
  const fil = filOf(p, 'nylon')
  const days = n(p, 'days')
  const dryC = n(p, 'dry')
  const dia = p.dia === '2.85' ? 2.85 : 1.75
  return { fil, days, dryC, dia, V: moistureView(fil, days, dryC, dia) }
})

export const filamentsDryingWetFilament: Lesson = {
  id: 'filaments-drying-wet-filament',
  title: 'Drying wet filament',
  tagline: 'Water soaks in over days and bakes out over hours',
  formula: (p) => {
    const { fil, dryC, dia, V } = dwRun(p)
    return `drying time ∝ radius² / D: (${fixedText(dia / 2, 3)} mm)² / ${fixedText(diffusivity(fil, dryC), 3)} mm²/h at ${dryC} °C (D doubles about every 13 °C) → ${Number.isFinite(V.hours) ? hoursText(V.hours) : '> 200 h'} to reach ${fixedText(FILAMENTS[fil].wetPct / 2, 2)} % · spool ${Math.round(V.wetG)} g wet → ${Math.round(V.dryG)} g dry (1 kg filament, typical)`
  },
  legend: filLegend(FILAMENT_KEYS),
  points: [
    'Most filaments absorb water from the air. Nylon and TPU soak it up within a day or two, PETG within days, PLA over weeks. A wet spool prints with popping and hissing as the water boils into steam in the nozzle, then strings, gives rough bubbly surfaces and weak, brittle parts (Print problems › Stringing).',
    'Water moves in and out of the strand by diffusion, so the time scales with the radius squared over the diffusivity D: a 2.85 mm filament takes about 2.7 times as long as 1.75 mm. Heat speeds diffusion up (D roughly doubles every 13 °C), which is why a dryer works in hours at 50–80 °C what would take weeks at room temperature.',
    'Dry below the filament\'s softening point (Glass transition temp), or the spool fuses into a solid lump: about 45–50 °C for PLA and TPU, 65 °C for PETG, 70–80 °C for nylon and ASA. The wraps deep on a full spool dry slower than this single strand, so allow extra time.',
    'Check by weighing: weigh the spool before and after drying; a 1 kg nylon spool that has sat out for a week can lose 20 g of water. Store dried spools in a sealed box with desiccant, and print nylon straight from a dry box.',
  ],
  controls: [
    { kind: 'choice', key: 'fil', options: opts(namesOf(FILAMENTS)), initial: 'nylon' },
    { kind: 'slider', key: 'days', label: 'Days in 50 % humid air', min: 0, max: DAYS_MAX, step: 0.5, initial: 7, format: (v) => `${v} d` },
    { kind: 'slider', key: 'dry', label: 'Dryer temperature', min: 40, max: 90, step: 5, initial: 70, format: (v) => `${v} °C` },
    { kind: 'choice', key: 'dia', options: opts({ '1.75': '1.75 mm', '2.85': '2.85 mm' }), initial: '1.75' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const SX = -9.4
    const scaleTop = -6.8
    box(scene, [9, 0.8, 5], mat('#c9ced6', { metal: 0.3, rough: 0.4 }), [SX, scaleTop - 0.4, 0])
    box(scene, [8, 1.4, 4.6], mat('#2e323a', { rough: 0.6 }), [SX, scaleTop - 1.5, 0])
    const gramsTag = liveLabel(scene, [SX, scaleTop - 1.5, 2.5], { size: 0.5 })
    const spool = filamentSpool(scene, [SX, scaleTop + 5, 0], 0.05)
    spool.group.rotation.y = 0.45
    const boxM = shellMat('#ffe2c4', 0.06)
    const dryer = box(scene, [11.5, 11, 7], boxM, [SX, scaleTop + 4.6, 0])
    const rng = parkMiller(5)
    const DROPS = 70
    const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), mat('#5ab8ff', { emissive: '#1d5a99', rough: 0.2 }, true), DROPS)
    drops.frustumCulled = false
    drops.castShadow = false
    scene.add(drops)
    const dropAt = Array.from({ length: DROPS }, () => {
      const a = rng() * Math.PI * 2
      const rr = 1.7 + rng() * 2.4
      return { x: SX + Math.cos(a) * rr * 0.9, y: scaleTop + 5 + Math.sin(a) * rr, z: (rng() - 0.5) * 2.6 + 1, out: rng() }
    })
    const phaseTag = liveLabel(scene, [SX, -10.9, 0.3], { size: 0.36 })
    const limitTag = liveLabel(scene, [SX, -11.8, 0.3], { size: 0.3, color: GREY })
    const A = { ...PLOT, y: 0, h: 5.6 }
    const up = titledScope(scene, A.y, A.h, 'in humid air', LABEL, 0, A.x, A.w)
    up.lo.set('0 d')
    up.hi.set(`${DAYS_MAX} d`)
    const D = { ...PLOT, y: -9.2, h: 5.6 }
    const dn = titledScope(scene, D.y, D.h, 'in the dryer', LABEL, 0, D.x, D.w)
    dn.lo.set('0 h')
    dn.hi.set(`${DRY_SPAN} h`)
    const upMax = liveLabel(scene, [A.x - A.w / 2 - 0.3, A.y + A.h / 2, 0.3], { size: 0.24, color: GREY, align: 'right' })
    const dnMax = liveLabel(scene, [D.x - D.w / 2 - 0.3, D.y + D.h / 2, 0.3], { size: 0.24, color: GREY, align: 'right' })
    const DAYS = Array.from({ length: 57 }, (_, i) => (i * DAYS_MAX) / 56)
    const HOURS = Array.from({ length: 61 }, (_, i) => (i * DRY_SPAN) / 60)
    const soak = FILAMENT_KEYS.map((k) => up.s.trace(FILAMENT_TINT[k], { samples: DAYS.length, radius: 0.05 }))
    const dryT = dn.s.trace(FILAMENT_TINT.nylon, { samples: HOURS.length, radius: 0.06 })
    const wetLine = up.s.level(HIGH_V)
    const goalLine = dn.s.level(POWER)
    const upMark = glowDot(up.s.group, 0.24, RING)
    const upCursor = cursorBar(up.s, RING, 0.05)
    const dnMark = glowDot(dn.s.group, 0.24, POWER)
    const dm = new THREE.Matrix4()
    const gone = new THREE.Matrix4().makeScale(0, 0, 0)
    const st = { t: 0, key: '' }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { fil, days, dryC, dia, V } = dwRun(p)
        const f = FILAMENTS[fil]
        const tint = FILAMENT_TINT[fil]
        const key = `${fil} ${days} ${dryC} ${dia}`
        if (key !== st.key) [st.key, st.t] = [key, 0]
        st.t = (st.t + dt) % (SOAK_S + DRY_S + HOLD_S)
        const soaking = st.t < SOAK_S
        const ds = soaking ? (st.t / SOAK_S) * days : days
        const hrs = Number.isFinite(V.hours) ? V.hours : DRY_SPAN
        const dh = soaking ? 0 : Math.min(1, (st.t - SOAK_S) / DRY_S) * hrs
        const now = soaking ? uptakePct(fil, ds, 0.5, dia) : dryingPct(fil, V.wet, dryC, dh, dia)
        spool.set(tint, 0.9)
        spool.group.rotation.z += dt * (soaking ? 0.1 : 0.4)
        dryer.visible = !soaking
        boxM.opacity = 0.05 + 0.07 * Math.min(1, (dryC - 40) / 50)
        const shown = Math.round(DROPS * Math.min(1, now / Math.max(0.3, f.satPct)))
        dropAt.forEach((d, i) => drops.setMatrixAt(i, i < shown ? dm.makeTranslation(d.x, d.y + (soaking ? 0 : (st.t * 0.6 + d.out) % 1.5), d.z) : gone))
        drops.instanceMatrix.needsUpdate = true
        gramsTag.set(`${Math.round(1000 * (1 + now / 100) + 250)} g`, now > f.wetPct ? HIGH_V : POWER)
        phaseTag.set(soaking ? `out in 50 % RH, day ${fixedText(ds, 1)}` : `in the dryer at ${dryC} °C, ${fixedText(dh, 1)} h${V.tooHot ? ': too hot, spool fuses' : ''}`, soaking ? B_TINT : V.tooHot ? HIGH_V : HEAT)

        const top = Math.max(uptakePct(fil, DAYS_MAX, 0.5, dia), f.wetPct) * 1.3
        const yu = plotY(0, top, A.h)
        FILAMENT_KEYS.forEach((k, i) => soak[i].points(DAYS.map((d) => d / DAYS_MAX), DAYS.map((d) => yu(uptakePct(k, d, 0.5, dia))), null))
        wetLine.set(yu(f.wetPct))
        upMark.position.set(up.s.xAt(days / DAYS_MAX), yu(V.wet), 0.46)
        ;(upMark.material as THREE.MeshStandardMaterial).emissive.set(tint)
        upCursor(days / DAYS_MAX)
        upMax.set(`${fixedText(top, 1)} %`, GREY)
        up.right.set(`${f.name}: ${fixedText(V.wet, 2)} % water`, tint)
        limitTag.set(`wet above ${f.wetPct} % (red) · dry to ${fixedText(f.wetPct / 2, 2)} % (green) · max ${f.dryC} °C`, GREY)
        const dTop = Math.max(V.wet, f.wetPct) * 1.1
        const yd = plotY(0, dTop, D.h)
        dryT.points(HOURS.map((h) => h / DRY_SPAN), HOURS.map((h) => yd(dryingPct(fil, V.wet, dryC, h, dia))), soaking ? null : Math.round((Math.min(dh, DRY_SPAN) / DRY_SPAN) * 60))
        dryT.material.color.set(tint)
        dryT.material.emissive.set(tint)
        goalLine.set(yd(f.wetPct / 2))
        dnMark.visible = Number.isFinite(V.hours) && V.hours <= DRY_SPAN && V.hours > 0
        dnMark.position.set(dn.s.xAt(Math.min(1, V.hours / DRY_SPAN)), yd(f.wetPct / 2), 0.46)
        dnMax.set(`${fixedText(dTop, 1)} %`, GREY)
        dn.right.set(V.hours === 0 ? 'already dry' : Number.isFinite(V.hours) ? `dry in ${hoursText(V.hours)}` : 'not dry in 200 h', V.hours > DRY_SPAN ? HEAT : POWER)
        head.status.set(`Drying wet filament · ${f.name}, ${dia} mm`)
        head.sub.set(`${fixedText(days, 1)} days in 50 % RH → ${fixedText(V.wet, 2)} % water · time-lapse: days and hours in seconds`, GREY)
        head.event.set(V.isWet ? `wet: steam pops, strings, weak parts (dry below ${f.dryC} °C)` : 'dry enough to print', V.isWet ? HIGH_V : POWER)
      },
      readouts: (p) => {
        const { V } = dwRun(p)
        return [
          { label: 'Water', value: `${fixedText(V.wet, 2)} %`, tone: toneOf(!V.isWet, V.pops < 0.5) },
          { label: 'Spool wet → dry', value: `${Math.round(V.wetG)} → ${Math.round(V.dryG)} g` },
          { label: 'Dry time', value: Number.isFinite(V.hours) ? hoursText(V.hours) : '> 200 h', tone: V.tooHot ? 'bad' : undefined },
        ]
      },
    }
  },
}
