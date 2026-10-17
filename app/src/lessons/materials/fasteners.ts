import * as THREE from 'three/webgpu'
import {
  ANCHORS,
  AnchorKey,
  HeadKey,
  IntoKey,
  LOCKS,
  LockKey,
  M3_INSERT,
  M3_PROOF_N,
  METRIC_SCREWS,
  NUT_FACTOR,
  PLA_SOFT_C,
  SCREW_HEADS,
  SHAKE_N_PER_G,
  ScrewKey,
  THREAD_INTO,
  JOINT_MU,
  anchorCurves,
  anchorPullout,
  caliperReading,
  ironInstall,
  loosenRun,
  screwFor,
  sizeFromCaliper,
} from '../../core/physics'
import { celsiusText, fixedText, mmFixed, newtonsText, pct } from '../../core/units'
import { V3, add, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  MATERIAL_TINT,
  POWER,
  RING,
  ScrewLook,
  WIDE_VIEW,
  addLabel,
  caliper,
  clearMeshes,
  countBars,
  flatBox,
  forceArrow,
  glowDot,
  glowMat,
  heatGlow,
  heatSetInsert,
  lapseClock,
  liveLabel,
  memoBy,
  nutModel,
  plotY,
  screwModel,
  shellMat,
  statusHeader,
  textRows,
  titledScope,
  unbalancedMotor,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const SIZE_KEYS = Object.keys(METRIC_SCREWS) as ScrewKey[]
const look = (sk: ScrewKey, hk: HeadKey): ScrewLook => {
  const s = METRIC_SCREWS[sk]
  return { d: s.d, pitch: s.pitch, hex: s.hex[hk], head: SCREW_HEADS[hk] }
}
const INTO_TINT: Record<IntoKey, string> = { nut: MATERIAL_TINT.steel, aluminium: MATERIAL_TINT.al6061, plastic: MATERIAL_TINT.pla }
/** Section of a slab with a hole: two blocks either side of a `gap`-wide hole, `w` wide overall, top at y. */
function slabSection(parent: THREE.Object3D, x: number, y: number, w: number, gap: number, t: number, m: THREE.Material) {
  const side = (w - gap) / 2
  ;[-1, 1].forEach((s) => add(parent, new THREE.Mesh(new THREE.BoxGeometry(side, t, w * 0.6), m), [x + s * (gap / 2 + side / 2), y - t / 2, -w * 0.3]))
}

// --- Metric sizes: M2…M5 to scale, holes, hex keys and the length for a plate stack. ---

const MS = { line: { x: -15.4, y: 2.5, k: 0.4, gap: 3.4, len: 10 }, sec: { x: -9.5, top: -4.6, h: 7.8, w: 9 }, cal: { at: [3, -4.4, 0] as V3, k: 0.42 } }
const msRun = memoBy(
  (p: Params) => `${p.size} ${p.head} ${p.into} ${p.stack}`,
  (p: Params) => {
    const sk = pick(METRIC_SCREWS, p.size, 'm3')
    const hk = pick(SCREW_HEADS, p.head, 'cap')
    const ik = pick(THREAD_INTO, p.into, 'nut')
    const stack = n(p, 'stack')
    const R = screwFor(sk, hk, ik, stack)
    const read = caliperReading(sk)
    return { sk, hk, ik, stack, R, read, named: sizeFromCaliper(read) }
  },
)

export const fastenersMetricSizes: Lesson = {
  id: 'fasteners-metric-sizes',
  title: 'Metric sizes',
  tagline: 'M3 × 10: thread diameter, pitch, holes, hex key and length',
  formula: (p) => {
    const { R, ik, stack } = msRun(p)
    const name = `${R.s.name} × ${R.s.pitch}`
    return `${name}: tap drill ≈ d − pitch = ${mmFixed(R.s.tap, 2)} · clearance hole ${mmFixed(R.s.clear)} · length ≥ stack + ${ik === 'nut' ? 'nut + 2 threads' : `${THREAD_INTO[ik].engage}·d`} = ${mmFixed(stack, 0)} + ${mmFixed(R.grip)} = ${mmFixed(R.need)} → ${R.length === null ? 'longer than stock' : `${R.s.name} × ${R.length}`}`
  },
  legend: [
    { color: RING, label: 'Chosen screw', shape: 'dot' },
    { color: MATERIAL_TINT.plywood, label: 'Plates: clearance hole', shape: 'dot' },
    { color: POWER, label: 'Engaged thread', shape: 'dot' },
    { color: HIGH_V, label: 'Too short', shape: 'dot' },
  ],
  points: [
    'Metric screws are named by thread diameter and length: M3 × 10 is 3 mm across the threads and 10 mm long under the head (countersunk: overall, because the head sinks into the plate). Coarse pitch is the default: 0.5 mm per turn for M3, 0.7 for M4.',
    'Two hole sizes per screw: a clearance hole (M3: 3.4 mm) where the screw just passes through a plate, and a tap-drill hole (about d − pitch, M3: 2.5 mm) where a tap cuts threads or a screw self-taps into plastic.',
    'Pick the length from the stack: the plates plus enough thread. Through a nut, the nut height plus two threads showing. Into a tapped hole, about 1.5·d in aluminium and 2·d in printed plastic (typical rules of thumb). Too long bottoms out in a blind hole; too short strips.',
    'Robots mostly use M2 (servo horns, small boards), M2.5 (Raspberry Pi, many PCBs), M3 (frames, motor mounts, the default) and M4–M5 (arm joints, 2020 extrusion). Socket cap heads take the biggest hex key and the most torque; button heads look neat, countersunk sit flush. Unknown screw? Measure the thread with calipers (it reads a little under nominal; Workshop skills › Measuring) and count threads over a known length. Screws in printed parts: Heat-set inserts; staying tight: Thread locker.',
  ],
  controls: [
    { kind: 'choice', key: 'size', options: opts(namesOf(METRIC_SCREWS)), initial: 'm3' },
    { kind: 'choice', key: 'head', options: opts(namesOf(SCREW_HEADS)), initial: 'cap' },
    { kind: 'choice', key: 'into', options: opts(namesOf(THREAD_INTO)), initial: 'nut' },
    { kind: 'slider', key: 'stack', label: 'Plate stack', min: 2, max: 24, step: 1, initial: 6, format: (v) => `${v} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const L = MS.line
    addLabel(scene, `M2 to M5, ${L.len} mm long, to scale`, [L.x - 1, L.y + 1.6, 0.3], LABEL, 0.28, 'left')
    const lineup = new Map<string, ReturnType<typeof screwModel>>()
    const lineName = SIZE_KEYS.map((sk, i) => liveLabel(scene, [L.x + i * L.gap, L.y - L.len * L.k - 0.7, 0.3], { size: 0.32 }))
    const lineKey = SIZE_KEYS.map((sk, i) => liveLabel(scene, [L.x + i * L.gap, L.y - L.len * L.k - 1.35, 0.3], { size: 0.24 }))
    const lineScrew = (sk: ScrewKey, hk: HeadKey, i: number) => {
      const key = `${sk}|${hk}`
      if (!lineup.has(key)) lineup.set(key, screwModel(scene, look(sk, hk), L.len, L.k, [L.x + i * L.gap, L.y, 0]))
      return lineup.get(key)!
    }
    const section = add(scene, new THREE.Group())
    let built = ''
    const C = MS.cal
    const cal = caliper(scene, C.k, C.at, 2)
    const calScrews = new Map<string, ReturnType<typeof screwModel>>()
    const calTag = liveLabel(scene, [C.at[0] + 4.2, C.at[1] - 2.6, 0.3], { size: 0.32, align: 'left' })
    const pitchTag = liveLabel(scene, [C.at[0] + 4.2, C.at[1] - 3.4, 0.3], { size: 0.28, align: 'left' })
    const useTag = liveLabel(scene, [C.at[0] + 4.2, C.at[1] - 4.2, 0.3], { size: 0.28, align: 'left' })
    addLabel(scene, 'unknown screw? caliper on the thread', [C.at[0] - 1.5, C.at[1] + 2, 0.3], LABEL, 0.28, 'left')
    const rows = textRows(scene, 4, 2.4, 3.4, 0.32, 0.75)
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { sk, hk, ik, stack, R, read, named } = msRun(p)
        lineup.forEach((m) => (m.group.visible = false))
        SIZE_KEYS.forEach((k, i) => {
          const m = lineScrew(k, hk, i)
          m.group.visible = true
          m.steel.emissive.set(RING)
          m.steel.emissiveIntensity = k === sk ? 0.35 : 0
          m.thread.emissive.set(RING)
          m.thread.emissiveIntensity = k === sk ? 0.35 : 0
          lineName[i].set(METRIC_SCREWS[k].name, k === sk ? RING : LABEL)
          lineKey[i].set(`${METRIC_SCREWS[k].hex[hk]} key`, GREY)
        })

        const key = `${sk}|${hk}|${ik}|${stack}`
        if (key !== built) {
          built = key
          clearMeshes(section)
          const S = MS.sec
          const s = R.s
          const len = R.length ?? R.need
          const above = R.head.flush ? 0 : R.head.k * s.d
          const below = ik === 'nut' ? s.nutH : R.grip + 2
          const K = Math.min(1.4, S.h / (above + stack + Math.max(len - stack, below)))
          const W = Math.min(S.w, 6 * s.d * K + 1)
          const face = S.top - above * K
          const plateM = shellMat(MATERIAL_TINT.plywood, 0.6, 0.6)
          const plates = stack >= 4 ? [stack / 2, stack / 2] : [stack]
          let y = face
          plates.forEach((t) => {
            slabSection(section, S.x, y - 0.02, W, s.clear * K, t * K - 0.04, plateM)
            y -= t * K
          })
          const scr = screwModel(section, look(sk, hk), len, K, [S.x, face, 0])
          scr.steel.emissive.set(RING)
          scr.steel.emissiveIntensity = 0.15
          if (ik === 'nut') {
            const nut = nutModel(section, s.nutAF, s.nutH, K, [S.x, y - s.nutH * K, 0])
            nut.steel.emissiveIntensity = 0
          } else {
            slabSection(section, S.x, y, W, s.tap * K, below * K, shellMat(INTO_TINT[ik], 0.55, 0.5))
          }
          const ok = R.length !== null
          const eTop = face - stack * K
          const eBot = face - len * K
          const ex = S.x + W / 2 + 0.5
          flatBox(section, [0.22, Math.max(0.05, eTop - eBot), 0.1], glowMat(ok ? POWER : HIGH_V, 1), [ex, (eTop + eBot) / 2, 0.3])
          addLabel(section, ok ? `engaged ${mmFixed(R.engaged)}` : 'no stock length', [ex + 0.4, (eTop + eBot) / 2 + 0.25, 0.3], ok ? POWER : HIGH_V, 0.28, 'left')
          addLabel(section, ik === 'nut' ? `${mmFixed(R.past)} past the nut` : `need ≥ ${mmFixed(R.grip)}`, [ex + 0.4, (eTop + eBot) / 2 - 0.4, 0.3], GREY, 0.24, 'left')
          addLabel(section, `stack ${mmFixed(stack, 0)}`, [ex + 0.4, (face + eTop) / 2, 0.3], MATERIAL_TINT.plywood, 0.26, 'left')
          addLabel(section, `clearance ${mmFixed(s.clear)}`, [S.x - W / 2 - 0.3, (face + eTop) / 2, 0.3], MATERIAL_TINT.plywood, 0.26, 'right')
          addLabel(section, ik === 'nut' ? `nut ${mmFixed(s.nutAF, 1)} AF` : `tap drill ${mmFixed(s.tap, 2)}`, [S.x - W / 2 - 0.3, eTop - 0.9, 0.3], INTO_TINT[ik], 0.26, 'right')
          addLabel(section, `${s.name} × ${Number.isInteger(len) ? len : fixedText(len, 1)}`, [S.x, S.top + 0.8, 0.3], ok ? RING : HIGH_V, 0.34)
        }

        calScrews.forEach((m) => (m.group.visible = false))
        const ck = `${sk}|${hk}`
        if (!calScrews.has(ck)) {
          const m = screwModel(scene, look(sk, hk), 10, C.k, [0, 0, 0])
          m.group.rotation.z = Math.PI
          calScrews.set(ck, m)
        }
        const cs = calScrews.get(ck)!
        cs.group.visible = true
        cs.group.position.set(C.at[0] + (read / 2) * C.k, C.at[1] - 0.5 - 10 * C.k, -0.1)
        cal.set(read)
        calTag.set(`reads ${mmFixed(read, 2)} → ${METRIC_SCREWS[named].name}`, RING)
        pitchTag.set(`pitch ${mmFixed(R.s.pitch, 2)}: ${Math.round(5 / R.s.pitch)} threads in 5 mm`, LABEL)
        useTag.set(`robots: ${R.s.use}`, GREY)

        const ok = R.length !== null
        rows[0].set(ok ? `buy ${R.s.name} × ${R.length}, ${R.head.name.toLowerCase()}` : `${R.s.name}: ${mmFixed(R.need, 0)} needed, no stock length`, ok ? RING : HIGH_V)
        rows[1].set(`pitch ${mmFixed(R.s.pitch, 2)} · ${mmFixed(R.hex)} hex key`, LABEL)
        rows[2].set(`clearance ${mmFixed(R.s.clear)} · tap drill ${mmFixed(R.s.tap, 2)}`, LABEL)
        rows[3].set(ik === 'nut' ? `nut ${mmFixed(R.s.nutH)} + 2 threads = ${mmFixed(R.grip)}` : `${THREAD_INTO[ik].name}: ≥ ${THREAD_INTO[ik].engage}·d = ${mmFixed(R.grip)} (typical)`, GREY)
        head.status.set(`Metric sizes · ${R.s.name} · ${R.head.name} · into ${THREAD_INTO[ik].name.toLowerCase()}`)
        head.sub.set(`plates ${mmFixed(stack, 0)} thick, joint section enlarged`, GREY)
        head.event.set(ok ? `${R.s.name} × ${R.length}: ${mmFixed(R.engaged)} of thread engaged, ${fixedText(R.threads, 0)} turns` : 'too long for stock screws: use a longer standoff or a thinner stack', ok ? POWER : HIGH_V)
      },
      readouts: (p) => {
        const { R } = msRun(p)
        return [
          { label: 'Screw', value: R.length === null ? '—' : `${R.s.name} × ${R.length}`, tone: R.length === null ? 'bad' : 'ok' },
          { label: 'Clearance hole', value: mmFixed(R.s.clear) },
          { label: 'Tap drill', value: mmFixed(R.s.tap, 2) },
          { label: 'Hex key', value: mmFixed(R.hex) },
        ]
      },
    }
  },
}

// --- Heat-set inserts: a hot iron sinks a brass insert into a PLA boss; pull-out vs a screw in plastic and a captive nut. ---

const ANCHOR_KEYS = Object.keys(ANCHORS) as AnchorKey[]
const ANCHOR_COLOR: Record<AnchorKey, string> = { insert: RING, screw: LOW_V, nut: POWER }
const HS = { x: -9.5, top: -3.6, k: 0.95, depth: 7, base: 1.5, wMax: 4, fMax: 1500, install: 4, pull: 4, plot: { x: 8.6, y: -8.4, w: 11.8, h: 5 } }
const hsRun = memoBy(
  (p: Params) => `${p.anchor} ${p.wall} ${p.iron}`,
  (p: Params) => {
    const ak = pick(ANCHORS, p.anchor, 'insert')
    const wall = n(p, 'wall')
    const iron = n(p, 'iron')
    const I = ironInstall(iron)
    const all = ANCHOR_KEYS.map((k) => anchorPullout(k, wall, iron))
    const reused = ANCHOR_KEYS.map((k) => anchorPullout(k, wall, iron, 5).force)
    return { ak, wall, iron, I, all, P: all[ANCHOR_KEYS.indexOf(ak)], reused, curves: anchorCurves(HS.wMax, iron, 80) }
  },
)

export const fastenersHeatSetInserts: Lesson = {
  id: 'fasteners-heat-set-inserts',
  title: 'Heat-set inserts',
  tagline: 'Brass threads melted into plastic: strong, and they survive re-assembly',
  formula: (p) => {
    const { I, P, ak, wall } = hsRun(p)
    return `pull-out ≈ τ · shear area · wall factor · τ PLA ≈ 20 MPa (printed, typical) · insert: π · 4.6 mm · 5.7 mm · knurl fill ${pct(I.fill)} · screw: π · 3 mm · 6 mm · ½ · nut: hex perimeter × 2 mm cover · wall ${mmFixed(wall)} of ${mmFixed(ANCHORS[ak].wallFull)} → ${pct(P.wallK)} · ${ANCHORS[ak].name} ≈ ${newtonsText(P.force, 0)}`
  },
  legend: [
    { color: ANCHOR_COLOR.insert, label: 'Heat-set insert', shape: 'dot' },
    { color: ANCHOR_COLOR.screw, label: 'Screw into plastic', shape: 'dot' },
    { color: ANCHOR_COLOR.nut, label: 'Captive nut', shape: 'dot' },
    { color: FORCE, label: 'Pull test', shape: 'dot' },
  ],
  points: [
    'A heat-set insert is a knurled brass sleeve with a machine thread inside. A soldering iron heats it and pushes it into a slightly undersized hole (M3: 4.0 mm for a 4.6 mm insert); PLA softens well above its glass transition (about 60 °C) and flows into the knurls, then freezes round them.',
    'Iron about 200–230 °C for PLA (typical). Too cold and the plastic stays hard and splits; too hot and it turns runny, oozes out and the insert sinks crooked. Press straight, stop flush, keep the iron still for a second, and let it cool before loading.',
    'A screw straight into a printed hole cuts its own thread in the plastic. It works, but the plastic threads strip easily and wear out each time you take it apart. Brass threads do not wear, so inserts suit parts you open often; a captive nut in a hex pocket is strongest when it pulls against a solid wall of plastic.',
    'Thin boss walls split before anything else: keep about half the insert diameter of plastic around it (typical) and use more perimeters in the slicer. Designing bosses and nut pockets for printing is in 3D printing › Functional parts; pull-out is shear strength over area, as in Stress & strain.',
  ],
  controls: [
    { kind: 'choice', key: 'anchor', options: opts(namesOf(ANCHORS)), initial: 'insert' },
    { kind: 'slider', key: 'wall', label: 'Boss wall thickness', min: 0.5, max: HS.wMax, step: 0.1, initial: 2.4, format: (v) => `${v.toFixed(1)} mm` },
    { kind: 'slider', key: 'iron', label: 'Iron temperature', min: 140, max: 300, step: 5, initial: 220, format: (v) => celsiusText(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const k = HS.k
    const boss = add(scene, new THREE.Group())
    const plaM = new THREE.MeshStandardMaterial({ color: MATERIAL_TINT.pla, roughness: 0.6, transparent: true, opacity: 0.8 })
    const meltM = glowMat(HEAT, 0)
    const melt = [-1, 1].map(() => flatBox(scene, [1, 1, 0.1], meltM, [0, 0, 0.6]))
    let built = ''
    const insert = heatSetInsert(scene, M3_INSERT.od, M3_INSERT.len, k)
    const screw = screwModel(scene, look('m3', 'cap'), 10, k)
    const nut = nutModel(scene, 5.5, 2.4, k)
    const iron = add(scene, new THREE.Group())
    const ironM = mat('#c9ccd1', { metal: 0.6, rough: 0.35 })
    add(iron, new THREE.Mesh(new THREE.ConeGeometry(0.5 * k, 2.5 * k, 20), ironM), [0, 1.25 * k, 0]).rotation.x = Math.PI
    cylinder(iron, 1.1 * k, 2 * k, mat('#3a3f4a', { rough: 0.5 }), [0, 3.5 * k, 0], 'y', 20)
    const tipGlow = glowDot(iron, 0.3 * k, HEAT, 0)
    const arrow = forceArrow(scene, FORCE, { r: 0.14, size: 0.3 })
    const crack = [0, 1].map(() => flatBox(scene, [0.12, 1, 0.1], glowMat(HIGH_V, 1.4), [0, 0, 0.7]))
    const clock = lapseClock(HS.install + HS.pull, 1, 1.5)

    addLabel(scene, 'pull-out force, same boss', [3.6, -1.1, 0.3], LABEL, 0.28, 'left')
    const bars = countBars(scene, [7.6, -2, 0], ANCHOR_KEYS.map((a) => ANCHORS[a].name), 5.4, { row: 0.75, size: 0.28 })
    const P = HS.plot
    const plot = titledScope(scene, P.y, P.h, 'pull-out vs boss wall', LABEL, 0, P.x, P.w)
    const py = plotY(0, HS.fMax, P.h)
    const curves = ANCHOR_KEYS.map((a) => plot.s.trace(ANCHOR_COLOR[a], { samples: 81, radius: 0.07 }))
    const marker = glowDot(plot.s.group, 0.26, RING)
    const rows = textRows(scene, 4, 2.4, 3.4, 0.32, 0.75)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { ak, wall, iron: tempC, I, all, P: R, reused, curves: cv } = hsRun(p)
        const a = ANCHORS[ak]
        const hole = a.hole
        const W = hole + 2 * wall
        const top = HS.top
        const bot = top - (HS.depth + HS.base) * k
        const key = `${ak}|${wall}`
        if (key !== built) {
          built = key
          clearMeshes(boss)
          if (ak === 'nut') {
            const pocketTop = top - 2 * k
            const pocketBot = pocketTop - 2.6 * k
            slabSection(boss, HS.x, top, W * k, a.hole * k, 2 * k, plaM)
            slabSection(boss, HS.x, pocketTop, W * k, 6.35 * k, (pocketTop - pocketBot), plaM)
            slabSection(boss, HS.x, pocketBot, W * k, a.hole * k, pocketBot - bot - HS.base * k, plaM)
          } else {
            slabSection(boss, HS.x, top, W * k, hole * k, HS.depth * k, plaM)
          }
          add(boss, new THREE.Mesh(new THREE.BoxGeometry(14, HS.base * k, W * k * 0.6), plaM), [HS.x, bot + (HS.base * k) / 2, -W * k * 0.3])
          addLabel(boss, `wall ${mmFixed(wall)}`, [HS.x + (W * k) / 2 + 0.3, top - 1.2, 0.3], MATERIAL_TINT.pla, 0.28, 'left')
          addLabel(boss, `hole ${mmFixed(hole)}`, [HS.x + (W * k) / 2 + 0.3, top - 2, 0.3], GREY, 0.26, 'left')
        }

        const t = clock(dt, `${ak}|${wall}|${tempC}`)
        const tin = Math.min(1, t / HS.install)
        const pullT = Math.max(0, t - HS.install) / HS.pull
        const F = pullT * HS.fMax
        const broke = F >= R.force
        const lift = broke ? Math.min(1.5, (F - R.force) / 150) : 0
        const installed = ak !== 'insert' || I.ok
        const sink = ak === 'insert' ? (I.ok ? 0.3 + 0.7 * Math.min(1, (tin * HS.install * 2.5) / Math.min(I.secs, 8)) : 0.3) : tin
        insert.group.visible = ak === 'insert'
        nut.group.visible = ak === 'nut'
        iron.visible = ak === 'insert' && t < HS.install
        screw.group.visible = ak !== 'insert' || t >= HS.install
        const insTop = top + (1 - sink) * M3_INSERT.len * k + (ak === 'insert' ? lift : 0)
        insert.group.position.set(HS.x, insTop, 0)
        iron.position.set(HS.x, insTop + 0.05, 0)
        tipGlow.scale.setScalar(1)
        ;(tipGlow.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.min(2, (tempC - 100) / 80)
        const hot = ak === 'insert' && t < HS.install + 0.8 ? Math.max(0, Math.min(1, (tempC - PLA_SOFT_C) / 80)) * (t < HS.install ? 1 : 1 - (t - HS.install) / 0.8) : 0
        heatGlow(meltM, hot)
        melt.forEach((m, i) => {
          m.visible = ak === 'insert' && I.ok && sink > 0.02
          const h = sink * M3_INSERT.len * k
          m.scale.set(0.35 * k * I.fill + 0.02, Math.max(0.01, h), 1)
          m.position.set(HS.x + (i ? 1 : -1) * (M3_INSERT.od / 2) * k, top - h / 2 + (ak === 'insert' ? lift : 0), 0.6)
        })
        const nutY = top - 2 * k - 2.4 * k - 0.1
        const slideIn = ak === 'nut' ? Math.min(1, tin * 2) : 1
        nut.group.position.set(HS.x + (1 - slideIn) * 8, nutY + lift, 0)
        const screwDrive = ak === 'insert' ? 1 : ak === 'nut' ? Math.max(0, tin * 2 - 1) : tin
        const screwTop = top + (1 - screwDrive) * 3 * k + 2.5 * k + lift
        screw.group.position.set(HS.x, screwTop, 0)
        screw.group.rotation.y = -screwDrive * 12
        const shown = t >= HS.install
        arrow([HS.x, screwTop + 3 * k + 0.5, 0.5], [HS.x, screwTop + 3 * k + 0.5 + (shown ? 0.8 + (Math.min(F, R.force) / HS.fMax) * 3.5 : 0), 0.5], `${newtonsText(Math.min(F, R.force), 0)}`, [1.3, -0.4, 0])
        crack.forEach((c, i) => {
          c.visible = broke && R.wallK < 0.75
          c.scale.y = HS.depth * k * 0.6
          c.position.set(HS.x + (i ? 1 : -1) * ((W * k) / 2 - 0.15), top - HS.depth * k * 0.3, 0.7)
        })
        const phase: [string, string] = [!shown ? (ak === 'insert' ? `pressing in: ${I.note}` : ak === 'nut' ? 'nut slides into its hex pocket' : 'screw cuts its own thread') : broke ? `failed: ${R.mode}` : `pulling: ${newtonsText(F, 0)}`, !shown ? (ak === 'insert' && !I.ok ? HIGH_V : HEAT) : broke ? HIGH_V : FORCE]

        const best = Math.max(...all.map((x) => x.force))
        bars.set(all.map((x) => x.force), all.map((x) => newtonsText(x.force, 0)), ANCHOR_KEYS.map((k2) => (k2 === ak ? ANCHOR_COLOR[k2] : GREY)), best * 1.05)
        cv.forEach(({ pts }, i) => curves[i].points(pts.map((_, j) => j / (pts.length - 1)), pts.map((f) => py(Math.min(f, HS.fMax))), null))
        const u = (wall - 0.5) / (HS.wMax - 0.5)
        marker.position.set(plot.s.xAt(u), py(Math.min(R.force, HS.fMax)), 0.46)
        ;(marker.material as THREE.MeshStandardMaterial).emissive.set(ANCHOR_COLOR[ak])
        plot.lo.set('wall 0.5 mm')
        plot.hi.set(`${HS.wMax} mm`)
        plot.right.set(newtonsText(R.force, 0), ANCHOR_COLOR[ak])

        const ri = ANCHOR_KEYS.indexOf(ak)
        rows[0].set(`${a.name}: ${newtonsText(R.force, 0)} pull-out (typical)`, ANCHOR_COLOR[ak])
        rows[1].set(`after 5 re-assemblies: ${newtonsText(reused[ri], 0)}`, reused[ri] < 0.9 * R.force ? HEAT : POWER)
        rows[2].set(R.wallK < 1 ? `wall ${mmFixed(wall)}: ${pct(R.wallK)} strength, aim ${mmFixed(a.wallFull)}` : `wall ${mmFixed(wall)}: full strength`, toneOf(R.wallK >= 1, R.wallK >= 0.75) === 'ok' ? POWER : R.wallK >= 0.75 ? HEAT : HIGH_V)
        rows[3].set(ak === 'insert' ? `iron ${celsiusText(tempC)}: knurls ${pct(I.fill)} filled` : 'no iron needed', ak === 'insert' ? (I.fill >= 0.9 ? POWER : HIGH_V) : GREY)
        head.status.set(`Heat-set inserts · ${a.name} · wall ${mmFixed(wall)}${ak === 'insert' ? ` · iron ${celsiusText(tempC)}` : ''}`)
        head.sub.set(`M3 in a printed PLA boss, cut in half: install, then pull until it fails by ${installed ? R.mode : 'never going in'}`, GREY)
        head.event.set(...phase)
      },
      readouts: (p) => {
        const { ak, P: R, reused, I } = hsRun(p)
        return [
          { label: 'Pull-out (typical)', value: newtonsText(R.force, 0), tone: toneOf(R.force > 800, R.force > 400) },
          { label: 'After 5 re-assemblies', value: newtonsText(reused[ANCHOR_KEYS.indexOf(ak)], 0) },
          { label: 'Boss wall', value: pct(R.wallK), tone: toneOf(R.wallK >= 1, R.wallK >= 0.75) },
          { label: 'Knurl fill', value: ak === 'insert' ? pct(I.fill) : '—', tone: ak === 'insert' ? toneOf(I.fill >= 0.9, I.fill > 0.5) : undefined },
        ]
      },
    }
  },
}

// --- Thread locker: torque sets preload; motor vibration slips the joint and backs a loose screw off. ---

const LOCK_KEYS = Object.keys(LOCKS) as LockKey[]
const LOCK_TINT: Record<LockKey, string> = { none: GREY, washer: '#c0c6d0', nyloc: '#4f7ad8', blue: '#3d8bff', red: HIGH_V }
const TL = { x: -10, top: 0.4, k: 0.85, secs: 60, slow: 6, plot: { x: 8.6, y: -3.4, w: 11.8, h: 4.8 }, bars: [8.2, -8.2, 0] as V3 }
const tlRun = memoBy(
  (p: Params) => `${p.torque} ${p.shake} ${p.lock}`,
  (p: Params) => {
    const T = n(p, 'torque')
    const g = n(p, 'shake')
    const lk = pick(LOCKS, p.lock, 'none')
    const all = LOCK_KEYS.map((k) => loosenRun(T, g, k, TL.secs))
    return { T, g, lk, all, R: all[LOCK_KEYS.indexOf(lk)], over: all[0].F0 > M3_PROOF_N }
  },
)

export const fastenersThreadLocker: Lesson = {
  id: 'fasteners-thread-locker',
  title: 'Thread locker',
  tagline: 'Torque makes clamp force; vibration steals it unless something locks the thread',
  formula: (p) => {
    const { R, T, g } = tlRun(p)
    return `T = K·F·d → F = T / (K·d) = ${fixedText(T)} N·m / (${NUT_FACTOR} × 3 mm) = ${newtonsText(R.F0, 0)} (M3 8.8 proof ${newtonsText(M3_PROOF_N, 0)}) · shake ${fixedText(g, 1)} g × ${SHAKE_N_PER_G} N/g = ${newtonsText(R.Ft, 0)} sideways (typical) · joint slips once μ·F < shake: F < ${newtonsText(R.slipN, 0)} at μ ${JOINT_MU} · each slip lets the thread turn back a little, so preload falls faster and faster`
  },
  legend: (p) => {
    const { lk } = tlRun(p)
    return [
      ...(lk === 'none' ? [] : [{ color: LOCK_TINT[lk], label: LOCKS[lk].name, shape: 'dot' as const }]),
      { color: GREY, label: lk === 'none' ? 'Bare screw and nut' : 'Nothing (for comparison)', shape: 'dot' },
      { color: FORCE, label: 'Clamp preload F', shape: 'dot' },
      { color: HIGH_V, label: 'Slips: shake beats friction', shape: 'dot' },
    ]
  },
  points: [
    'Tightening a screw stretches it like a stiff spring, and that stretch clamps the parts together: the preload. T = K·F·d with K ≈ 0.2 for dry steel threads, so 1.2 N·m on an M3 gives about 2 kN, roughly 70 % of what an 8.8 screw can take. Into plastic or acrylic you must stop far lower (Laser & CNC › Acrylic vs plywood).',
    'Friction from the preload holds the parts still. A motor shaking the joint (Vibration › Motor vibration) pushes sideways; once that beats μ·F the parts slip a little each cycle, the thread rides back a fraction of a turn each slip, preload drops, and it slips more: a loose screw falls out in seconds. A properly tight one never slips at all.',
    'Thread locker is an anaerobic glue that cures in the thread and stops it turning. Blue (medium) still comes undone with a hex key; red (high) is permanent until heated to about 250 °C. Use blue on motor mounts and set screws; keep it off plastic, it can crack some (acrylic, polycarbonate).',
    'A nylon lock nut drags on the thread so the nut stays on even if preload is lost; good for joints that must turn freely. Split spring washers barely help under sideways shake (vibration tests show it). First fix: enough torque. Then locker or a nylon nut where things shake.',
  ],
  controls: [
    { kind: 'slider', key: 'torque', label: 'Tightening torque (M3)', min: 0.1, max: 2.2, step: 0.05, initial: 0.4, format: (v) => `${v.toFixed(2)} N·m` },
    { kind: 'slider', key: 'shake', label: 'Motor vibration at the joint', min: 0, max: 10, step: 0.5, initial: 6, format: (v) => `${v.toFixed(1)} g` },
    { kind: 'choice', key: 'lock', options: opts(namesOf(LOCKS)), initial: 'none' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const k = TL.k
    const plate = 4
    const top = TL.top
    const frame = add(scene, new THREE.Group())
    const joint = add(scene, new THREE.Group())
    const lowM = shellMat(MATERIAL_TINT.al6061, 0.65, 0.4)
    const upM = shellMat(MATERIAL_TINT.plywood, 0.6, 0.6)
    slabSection(frame, TL.x, top - plate * k, 13, 3.4 * k, plate * k, lowM)
    slabSection(joint, TL.x, top, 13, 3.4 * k, plate * k, upM)
    addLabel(frame, 'frame', [TL.x - 6.2, top - plate * k * 2 - 0.5, 0.3], GREY, 0.26, 'left')
    addLabel(joint, 'motor bracket', [TL.x - 6.2, top + 0.5, 0.3], GREY, 0.26, 'left')
    const motor = unbalancedMotor(joint, [TL.x + 4, top + 2.2, 0], 1.4)
    const screws = add(scene, new THREE.Group())
    const scr = screwModel(screws, look('m3', 'cap'), 12, k, [0, 0, 0])
    const nutPlain = nutModel(scene, 5.5, 2.4, k)
    const nutLock = nutModel(scene, 5.5, 3.2, k, [0, 0, 0], true)
    const washer = add(screws, new THREE.Mesh(new THREE.TorusGeometry(2.1 * k, 0.4 * k, 8, 24, Math.PI * 1.9), mat('#c0c6d0', { metal: 0.7, rough: 0.35 })), [0, 0.3 * k, 0])
    washer.rotation.x = Math.PI / 2
    const press = [-1, 1].map(() => forceArrow(scene, FORCE, { r: 0.12, size: 0.26 }))
    const slipTag = liveLabel(scene, [TL.x, top - 11.4, 0.3], { size: 0.3 })
    const clock = lapseClock(TL.secs, TL.slow, 8)
    const shakeT = { t: 0 }

    const rows = textRows(scene, 3, 2.4, 3.4, 0.32, 0.75)
    const P = TL.plot
    const plot = titledScope(scene, P.y, P.h, 'preload vs time', LABEL, 0, P.x, P.w)
    const fMax = 3600
    const py = plotY(0, fMax, P.h)
    const ref = plot.s.trace(GREY, { samples: 241, radius: 0.06 })
    const curve = plot.s.trace(RING, { samples: 241, radius: 0.08 })
    const slipLine = plot.s.level(HIGH_V)
    const proofLine = plot.s.level(GREY)
    const marker = glowDot(plot.s.group, 0.26, RING)
    const slipLbl = liveLabel(plot.s.group, [0, 0, 0.4], { size: 0.22, color: HIGH_V, align: 'right' })
    addLabel(plot.s.group, 'proof', [P.w / 2 - 0.2, py(M3_PROOF_N) + 0.3, 0.4], GREY, 0.22, 'right')
    addLabel(scene, `preload left after ${TL.secs} s`, [3.6, TL.bars[1] + 1, 0.3], LABEL, 0.28, 'left')
    const bars = countBars(scene, TL.bars, LOCK_KEYS.map((l) => LOCKS[l].name), 4.6, { row: 0.7, size: 0.26 })
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { T, g, lk, all, R, over } = tlRun(p)
        const t = clock(dt, `${T}|${g}|${lk}`)
        const i = Math.min(R.t.length - 1, Math.round((t / TL.secs) * (R.t.length - 1)))
        const F = R.F[i]
        const slipping = R.Ft > JOINT_MU * F
        const turns = R.turns[i]
        shakeT.t += dt
        const amp = slipping ? Math.min(0.5, 0.12 + 0.4 * (1 - (JOINT_MU * F) / R.Ft)) : 0.03 * Math.min(1, g / 5)
        const dx = amp * Math.sin(shakeT.t * 2 * Math.PI * 7)
        joint.position.x = dx
        motor.set(shakeT.t * 25, 0.6)
        const rise = Math.min(4, turns * 0.5 * k)
        screws.position.set(TL.x + dx, top + rise, 0)
        scr.group.rotation.y = turns * 2 * Math.PI
        const lock = LOCKS[lk]
        scr.thread.color.set(lk === 'blue' || lk === 'red' ? LOCK_TINT[lk] : '#a9b0bb')
        washer.visible = lk === 'washer'
        nutPlain.group.visible = lk !== 'nyloc'
        nutLock.group.visible = lk === 'nyloc'
        const nutY = top - plate * k * 2 - 0.02
        const off = R.fellOff && F === 0 ? Math.min(3, turns * 0.4) : 0
        nutPlain.group.position.set(TL.x + dx * 0.3, nutY - 2.4 * k - off, 0)
        nutPlain.group.rotation.y = -turns * 2 * Math.PI
        nutLock.group.position.set(TL.x + dx * 0.3, nutY, 0)
        nutLock.group.rotation.x = Math.PI
        press.forEach((a, s) => {
          const x = TL.x + (s ? 1 : -1) * 3.6 + dx
          const len = (F / fMax) * 5
          a([x, top + 0.3 + len, 1.2], [x, top + 0.3, 1.2], s ? `F ${newtonsText(F, 0)}` : '', [1.4, 0.2, 0])
        })
        slipTag.set(slipping ? (lock.rate === 0 ? 'joint slips, but the locker holds the thread' : F === 0 ? (lock.holds ? 'no preload left: nut hangs on its nylon' : 'screw has backed out') : 'joint slips: screw turns back each cycle') : 'friction holds: no slip', slipping ? HIGH_V : POWER)

        const col = LOCK_TINT[lk] === GREY ? RING : LOCK_TINT[lk]
        curve.points(R.t.map((x) => x / TL.secs), R.F.map((f) => py(Math.min(fMax, f))), null)
        ref.points(all[0].t.map((x) => x / TL.secs), all[0].F.map((f) => py(Math.min(fMax, f))), null)
        slipLine.set(py(Math.min(fMax, R.slipN)))
        proofLine.set(py(M3_PROOF_N))
        slipLbl.group.position.set(P.w / 2 - 0.2, py(Math.min(fMax, R.slipN)) + 0.3, 0.4)
        slipLbl.set('slips below')
        marker.position.set(plot.s.xAt(t / TL.secs), py(Math.min(fMax, F)), 0.46)
        ;(marker.material as THREE.MeshStandardMaterial).emissive.set(col)
        plot.lo.set('0 s')
        plot.hi.set(`${TL.secs} s (×${TL.slow})`)
        plot.right.set(`F ${newtonsText(F, 0)}`, slipping ? HIGH_V : col)
        bars.set(all.map((r) => r.end / Math.max(1, r.F0)), all.map((r) => (r.fellOff ? 'fell out' : pct(r.end / Math.max(1, r.F0)))), LOCK_KEYS.map((l, j) => (l === lk ? col : all[j].end < 0.5 * all[j].F0 ? HIGH_V : GREY)), 1)

        rows[0].set(`${fixedText(T)} N·m → preload ${newtonsText(R.F0, 0)}`, over ? HIGH_V : LABEL)
        rows[1].set(`shake ${newtonsText(R.Ft, 0)} sideways: slips below ${newtonsText(R.slipN, 0)}`, R.F0 * 0.95 < R.slipN ? HIGH_V : POWER)
        rows[2].set(`${lock.name}: ${lock.undo}`, col)
        head.status.set(`Thread locker · M3 · ${fixedText(T)} N·m · ${fixedText(g, 1)} g · ${lock.name}`)
        head.sub.set(`motor shaking a bracket for ${TL.secs} s, sped up ×${TL.slow}, shake drawn slow`, GREY)
        head.event.set(over ? 'over proof load: the screw stretches for good or snaps' : R.fellOff ? `screw backs out after ${R.slipAt === null ? '—' : `${Math.round(R.slipAt)} s of slipping`}` : R.slipAt === null ? 'tight enough: never slips' : `keeps ${pct(R.end / R.F0)} of its preload`, over || R.fellOff ? HIGH_V : R.slipAt === null ? POWER : HEAT)
      },
      readouts: (p) => {
        const { R, over } = tlRun(p)
        return [
          { label: 'Preload', value: newtonsText(R.F0, 0), tone: over ? 'bad' : undefined },
          { label: 'Slips below', value: newtonsText(R.slipN, 0), tone: toneOf(R.F0 * 0.95 >= R.slipN, false) },
          { label: `Left after ${TL.secs} s`, value: R.fellOff ? 'fell out' : pct(R.end / R.F0), tone: toneOf(R.end > 0.8 * R.F0, R.end > 0) },
          { label: 'Undo', value: LOCKS[tlRun(p).lk].undo },
        ]
      },
    }
  },
}
