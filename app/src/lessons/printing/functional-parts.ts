import * as THREE from 'three/webgpu'
import {
  BOSS_HOLE_SWEEP,
  BOSS_ORIENTS,
  BossOrient,
  COVER_SWEEP,
  FILAMENTS,
  FIT_CLASSES,
  GEAR_MATS,
  GEAR_PAIR,
  GearMat,
  HINGE,
  HINGE_H_SWEEP,
  HINGE_LINES,
  HINGE_MATS,
  HingeLines,
  HingeMat,
  INSERT_BOSS,
  LINE_W,
  MODULE_SWEEP,
  NUT_POCKET,
  POCKET_STYLES,
  PRINT_GEAR_KINDS,
  PocketStyle,
  PrintGearKind,
  SNAP,
  SNAP_L_SWEEP,
  SNAP_MATS,
  SNAP_ORIENTS,
  SnapMat,
  SnapOrient,
  hingeView,
  insertBossView,
  lewisY,
  meshTurn,
  nutPocket,
  nutPocketView,
  printedGear,
  printedGearView,
  snapView,
} from '../../core/physics'
import { countText, degText, fixedText, mmFixed, newtonsText, nmText, pct } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  PRINT_TINT,
  RING,
  Slab,
  WIDE_VIEW,
  addLabel,
  cursorBar,
  emptyGroup,
  heatSetInsert,
  liveLabel,
  memoBy,
  nutModel,
  printStage,
  screwModel,
  spurGear,
  stressColor,
  stressHex,
  stretchArrow,
  verdictTint,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

// One board for all five: a printed part on the left (sliced sections, sizes in mm × k), rows top right, a plot bottom right.
const BASE = '#5d7a99'
const LH = 0.2
/** [lo, hi] minus the `holes` spans. */
function solidSpans(lo: number, hi: number, holes: [number, number][]): [number, number][] {
  let out: [number, number][] = [[lo, hi]]
  for (const [a, b] of holes) out = out.flatMap(([x0, x1]): [number, number][] => (b <= x0 || a >= x1 ? [[x0, x1]] : ([[x0, a], [b, x1]] as [number, number][]).filter(([u, v]) => v - u > 1e-6)))
  return out
}

// --- Heat-set inserts ---

const ORIENT_SHORT: Record<BossOrient, string> = { vertical: 'axis vertical', horizontal: 'axis horizontal' }
const ibParams = (p: Params) => ({ hole: n(p, 'hole'), wall: n(p, 'wall'), depth: n(p, 'depth'), o: pick(BOSS_ORIENTS, p.o, 'vertical') as BossOrient })
const ibKey = (p: Params) => `${p.hole} ${p.wall} ${p.depth} ${p.o}`
const ibRun = memoBy(ibKey, (p: Params) => {
  const q = ibParams(p)
  return { q, V: insertBossView(q.hole, q.wall, q.depth, q.o) }
})
const IB = { k: 1.05, floor: 2, every: 2 }

/** Half a boss cut through its axis (axis = local y, mouth at the top); layers across y (vertical) or across x (horizontal). */
function bossSlabs(hole: number, wall: number, depth: number, o: BossOrient, hoop: number, split: boolean, overflow: number): Slab[] {
  const R = hole / 2 + wall
  const H = depth + IB.floor
  const step = LH * IB.every
  const th = step * 0.82
  const crack = split ? 0.35 : 0
  const tint = (x: number) => stressHex(Math.min(1.2, hoop * (1 - (0.5 * Math.max(0, Math.abs(x) - hole / 2)) / wall)))
  const out: Slab[] = []
  const push = (x0: number, x1: number, y0: number, y1: number, color = tint((x0 + x1) / 2)) => {
    const dx = x0 >= 0 ? crack : 0
    out.push({ x0: x0 + dx, x1: x1 + dx, y0, y1, z0: -R, z1: 0, color })
  }
  if (o === 'vertical') {
    for (let y = 0; y < H - 1e-6; y += step) {
      if (y + step / 2 < IB.floor) push(-R, R, y, y + th, BASE)
      else for (const [a, b] of solidSpans(-R, R, [[-hole / 2, hole / 2]])) push(a, b, y, y + th)
    }
  } else {
    for (let x = -R; x < R - 1e-6; x += step) {
      const inHole = Math.abs(x + step / 2) < hole / 2
      push(x, x + th, 0, IB.floor, BASE)
      if (!inHole) push(x, x + th, IB.floor, H)
    }
  }
  if (overflow > 0) for (const s of [-1, 1]) push(s < 0 ? -hole / 2 - 0.8 : hole / 2, s < 0 ? -hole / 2 : hole / 2 + 0.8, H, H + 0.5, HEAT)
  return out
}

export const functionalPartsHeatSetInserts: Lesson = {
  id: 'functional-parts-heat-set-inserts',
  title: 'Heat-set inserts',
  tagline: 'Design the boss: hole, wall, depth and which way it faces',
  formula: (p) => {
    const { q, V } = ibRun(p)
    const a = V.cur
    return `squeeze = ${INSERT_BOSS.od} − ${fixedText(q.hole, 1)} = ${mmFixed(a.squeeze, 2)} · F = ${Math.round(V.ideal)} N (ideal boss, Materials > Fasteners) × fill ${fixedText(a.grip, 2)}${a.tight < 1 ? ` × tight ${fixedText(a.tight, 2)}` : ''} × seated ${fixedText(a.seated, 2)} × layers ${fixedText(a.orientK, 2)}${a.split ? ' × split 0.3' : ''} = ${Math.round(a.force)} N, typical`
  },
  legend: [
    { color: POWER, label: 'Boss wall: hoop load low', shape: 'dot' },
    { color: HIGH_V, label: 'Hoop load near splitting', shape: 'dot' },
    { color: HEAT, label: 'Plastic squeezed out of the mouth', shape: 'dot' },
    { color: GREY, label: 'Ideal boss (Fasteners lesson)', shape: 'dot' },
  ],
  points: [
    'Materials > Fasteners > Heat-set inserts showed the install and the pull test. This is the printed side: the boss the insert goes into, which decides most of that pull-out force.',
    'Hole: about 0.6 mm under the knurl diameter (4.0 mm for the common M3 × 5.7 insert, 4.6 mm knurl), with a slight taper or a 0.5 mm chamfer so it starts straight. Too big and the knurls never bite; too small and the extra plastic has to go somewhere.',
    'Depth: insert length + 1 to 1.5 mm, so the melted plastic flows down instead of welling up round the mouth. Wall: 2 mm or more, which is 4 to 5 lines; set the slicer walls so the boss is solid lines, not infill.',
    'Orientation: press along Z into the top of an upright boss, so the hoop stress runs along the lines. An insert in a side wall pushes the layers apart and splits along one (why layers are weak: Strength > Layer adhesion, the next topic).',
  ],
  controls: [
    { kind: 'slider', key: 'hole', label: 'Hole diameter', min: 3.4, max: 4.6, step: 0.1, initial: 4, format: (v) => mmFixed(v, 1) },
    { kind: 'slider', key: 'wall', label: 'Boss wall', min: 0.8, max: 3.2, step: 0.2, initial: 2.4, format: (v) => mmFixed(v, 1) },
    { kind: 'slider', key: 'depth', label: 'Hole depth', min: 4, max: 9, step: 0.5, initial: 7.5, format: (v) => mmFixed(v, 1) },
    { kind: 'choice', key: 'o', options: opts(BOSS_ORIENTS), initial: 'vertical' },
  ],
  build(): Stage {
    const c = printStage('Pull-out vs hole diameter', mmFixed(BOSS_HOLE_SWEEP[0], 1), mmFixed(BOSS_HOLE_SWEEP[BOSS_HOLE_SWEEP.length - 1], 1), { title: 'Pull-out at this wall, N (Fasteners model)', names: ['This boss', 'Ideal insert boss', 'Screw into plastic', 'Captive nut'] })
    const { scene, head, rows, plot, tally } = c
    const { k } = IB
    const bench = c.bench([-9, -11, 0], k, 13, 11, 400, -0.35)
    const part = add(bench.g, new THREE.Group())
    part.add(bench.slabs.group)
    const insert = heatSetInsert(part, INSERT_BOSS.od, INSERT_BOSS.len, k)
    const pull = stretchArrow(part, HIGH_V, 0.12)
    const tag = liveLabel(bench.g, [0, 0, 0], { size: 0.36, align: 'left' })
    const S = plot.s
    const tr = S.trace(POWER, { samples: BOSS_HOLE_SWEEP.length, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const ideal = S.level(GREY)
    const lo = BOSS_HOLE_SWEEP[0]
    const span = BOSS_HOLE_SWEEP[BOSS_HOLE_SWEEP.length - 1] - lo
    let key = ''
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { q, V } = ibRun(p)
        const a = V.cur
        const py = c.py(0, V.ideal * 1.2)
        if (key !== ibKey(p)) {
          key = ibKey(p)
          bench.slabs.set(bossSlabs(q.hole, q.wall, q.depth, q.o, a.hoop, a.split, a.overflow))
          const R = q.hole / 2 + q.wall
          const H = q.depth + IB.floor
          const top = H + Math.max(0, INSERT_BOSS.len - q.depth)
          insert.group.position.set(0, top * k, 0)
          pull([0, (top + 0.3) * k, 0], [0, (top + 1 + (2.5 * a.force) / V.ideal) * k, 0])
          part.rotation.z = q.o === 'vertical' ? 0 : -Math.PI / 2
          part.position.set(q.o === 'vertical' ? 0 : -2 * k, q.o === 'vertical' ? 0 : R * k, 0)
          tag.group.position.set(q.o === 'vertical' ? (R + 2) * k : (H / 2) * k, q.o === 'vertical' ? (H + 2) * k : (2 * R + 1.5) * k, 0)
        }
        tag.set(`${Math.round(a.force)} N`, verdictTint(a.force > 0.8 * V.ideal, a.force > 0.5 * V.ideal))
        tr.points(BOSS_HOLE_SWEEP.map((h) => (h - lo) / span), V.curve.map(py), null)
        cur((q.hole - lo) / span)
        ideal.set(py(V.ideal))
        plot.right.set(`${fixedText(q.hole, 1)} mm: ${Math.round(a.force)} N`, RING)
        tally?.set([a.force, V.ideal, V.screw, V.nut], [a.force, V.ideal, V.screw, V.nut].map((f) => `${Math.round(f)}`), [RING, GREY, GREY, GREY], V.ideal * 1.2)
        rows[0].set(`Squeeze ${mmFixed(a.squeeze, 2)} on the ${INSERT_BOSS.od} mm knurl: ${a.tight < 1 ? 'too tight' : `${pct(a.grip)} bite`}`, verdictTint(a.grip >= 0.9 && a.tight === 1, a.grip >= 0.6))
        rows[1].set(`Wall ${mmFixed(q.wall, 1)} = ${a.lines} lines of ${LINE_W} mm · hoop ${pct(Math.min(9.99, a.hoop))} of splitting`, verdictTint(a.hoop < 0.6, a.hoop < 1))
        rows[2].set(a.overflow > 0 ? `${Math.round(a.overflow)} mm³ of melt has no room below` : a.seated < 1 ? `Hole ${mmFixed(INSERT_BOSS.len - q.depth, 1)} too shallow: insert stands proud` : 'Room below the insert for the melt', a.overflow > 0 || a.seated < 1 ? HEAT : POWER)
        head.status.set(`M3 insert boss · ${ORIENT_SHORT[q.o]}`)
        head.sub.set(`PLA, cut through the axis; layers drawn ${IB.every}× thick`, GREY)
        head.event.set(a.mode, verdictTint(!a.split && a.grip >= 0.9 && a.seated >= 1, !a.split))
      },
      readouts: (p) => {
        const { V } = ibRun(p)
        const a = V.cur
        return [
          { label: 'Pull-out', value: `${Math.round(a.force)} N`, tone: toneOf(a.force > 0.8 * V.ideal, a.force > 0.5 * V.ideal) },
          { label: 'Knurl bite', value: pct(a.grip), tone: toneOf(a.grip >= 0.9, a.grip >= 0.6) },
          { label: 'Hoop load', value: pct(Math.min(9.99, a.hoop)), tone: toneOf(a.hoop < 0.6, a.hoop < 1) },
          { label: 'Overflow', value: `${Math.round(a.overflow)} mm³`, tone: toneOf(a.overflow === 0, a.overflow < 5) },
        ]
      },
    }
  },
}

// --- Captive nuts ---

const STYLE_SHORT: Record<PocketStyle, string> = { top: 'drop-in from the top', side: 'side slot', buried: 'buried, sacrificial layer' }
const cnParams = (p: Params) => ({ clear: n(p, 'clear'), cover: n(p, 'cover'), style: pick(POCKET_STYLES, p.style, 'side') as PocketStyle })
const cnKey = (p: Params) => `${p.clear} ${p.cover} ${p.style}`
const cnRun = memoBy(cnKey, (p: Params) => {
  const q = cnParams(p)
  return { q, V: nutPocketView(q.clear, q.cover, q.style) }
})
const CN = { k: 0.9, W: 16, D: 12, floor: 2, screwLen: 8, ex: 10, plate: 2, head: 3.2 }
const NUT = NUT_POCKET.s
const COVER_TINT = '#c3a6ff'

/** Half block cut through the screw axis: hex pocket (cut across the flats), clearance hole, cover layers lighter. */
function pocketSlabs(clear: number, cover: number, style: PocketStyle, sag: number): Slab[] {
  const { W, D, floor } = CN
  const span = NUT.nutAF + clear
  const ph = NUT.nutH + 0.3
  const p0 = style === 'top' ? cover : floor
  const H = p0 + ph + (style === 'top' ? 0 : cover)
  const hole: [number, number] = [-NUT.clear / 2, NUT.clear / 2]
  const out: Slab[] = []
  if (style === 'top') for (const [a, b] of solidSpans(-W / 2, W / 2, [hole])) out.push({ x0: a, x1: b, y0: -CN.plate, y1: -0.05, z0: -D / 2, z1: 0, color: '#8a8f99' })
  for (let y = 0; y < H - 1e-6; y += LH) {
    const ym = y + LH / 2
    const inPocket = ym > p0 && ym < p0 + ph
    const inCover = style === 'top' ? ym < cover : ym > p0 + ph
    const firstRoof = style !== 'top' && ym > p0 + ph && ym < p0 + ph + LH
    const holes: [number, number][] = inPocket ? [style === 'side' ? [-span / 2, W] : [-span / 2, span / 2]] : firstRoof && style === 'buried' ? [] : [hole]
    for (const [a, b] of solidSpans(-W / 2, W / 2, holes)) {
      if (firstRoof && a < span / 2 && b > -span / 2 && style === 'side') {
        for (let j = 0; j < 6; j++) {
          const u0 = j / 6
          const x0 = Math.max(a, -span / 2 + span * u0)
          const x1 = Math.min(b, -span / 2 + span * (u0 + 1 / 6))
          const um = (x0 + x1) / 2 / span + 0.5
          if (x1 > x0) out.push({ x0, x1, y0: y - CN.ex * sag * 4 * um * (1 - um), y1: y + LH * 0.82, z0: -D / 2, z1: 0, color: B_FIELD })
        }
        for (const [u, v] of solidSpans(a, b, [[-span / 2, span / 2]])) out.push({ x0: u, x1: v, y0: y, y1: y + LH * 0.82, z0: -D / 2, z1: 0, color: COVER_TINT })
        continue
      }
      const color = firstRoof && style === 'buried' && a < span / 2 && b > -span / 2 ? RING : inCover ? COVER_TINT : PRINT_TINT
      out.push({ x0: a, x1: b, y0: y, y1: y + LH * 0.82, z0: -D / 2, z1: 0, color })
    }
  }
  return out
}

export const functionalPartsCaptiveNuts: Lesson = {
  id: 'functional-parts-captive-nuts',
  title: 'Captive nuts',
  tagline: 'A hex pocket that holds a steel nut',
  formula: (p) => {
    const { q, V } = cnRun(p)
    const a = V.cur
    return `pocket = ${NUT.nutAF} + ${fixedText(q.clear, 2)} across flats, prints ${NUT_POCKET.holeShrink} mm small → gap ${mmFixed(a.gap, 2)} (${a.fit}) · pull-through ∝ hex perimeter × cover${q.style === 'top' ? '' : ' − 1 bridged layer'} = ${Math.round(a.force)} N, typical`
  },
  legend: [
    { color: COVER_TINT, label: 'Cover the nut pulls against', shape: 'dot' },
    { color: B_FIELD, label: 'Bridged roof layer (sag drawn 10×)', shape: 'dot' },
    { color: RING, label: 'Sacrificial layer: poke the screw through', shape: 'dot' },
    { color: '#8a8f99', label: 'Part being clamped', shape: 'dot' },
  ],
  points: [
    'A steel M3 nut in a printed hex pocket holds far better than threads cut into plastic, and it can be undone a hundred times (the anchor comparison is in Materials > Fasteners > Heat-set inserts). The design is the pocket.',
    'Size: across flats 5.5 mm + 0.1 to 0.3 mm. Holes and pockets print about 0.15 mm small (Design for printing > Tolerances and fits), so 0.1 is a press fit, 0.2 to 0.3 slides in. The hex stops the nut turning: it can only rock a few degrees before a corner meets a flat.',
    'Style: a pocket open at the top is easiest, but only holds the nut when the screw pulls it onto the floor. A side slot holds it both ways; its roof is a short bridge. A buried pocket needs a pause at the pocket top (drop the nut in) and one bridged sacrificial layer that the screw pokes through.',
    'Strength: the nut punches a hex plug out of the cover, so pull-through grows with the cover thickness; 2 mm (10 layers) or more. A bridged first layer barely counts. More walls and solid infill round the pocket: Strength > Wall count vs infill.',
  ],
  controls: [
    { kind: 'slider', key: 'clear', label: 'Pocket clearance (across flats)', min: 0, max: 0.6, step: 0.05, initial: 0.2, format: (v) => mmFixed(v, 2) },
    { kind: 'slider', key: 'cover', label: 'Cover over the nut', min: 0.6, max: 4, step: 0.2, initial: 2, format: (v) => mmFixed(v, 1) },
    { kind: 'choice', key: 'style', options: opts(POCKET_STYLES), initial: 'side' },
  ],
  build(): Stage {
    const c = printStage('Pull-through vs cover thickness', mmFixed(COVER_SWEEP[0], 1), mmFixed(COVER_SWEEP[COVER_SWEEP.length - 1], 1), { title: 'Pull-out, N (Fasteners model)', names: ['This pocket', 'Heat-set insert', 'Screw into plastic'] })
    const { scene, head, rows, plot, tally } = c
    const { k } = CN
    const bench = c.bench([-12.8, -9.6, 0], k, 21, CN.D + 2, 200, -0.4)
    bench.slabs.group.position.x = 4 * k
    const holder = add(bench.g, new THREE.Group(), [4 * k, 0, 0])
    const nut = nutModel(holder, NUT.nutAF, NUT.nutH, k)
    const screw = screwModel(holder, { d: NUT.d, pitch: NUT.pitch, hex: NUT.hex.cap, head: { dk: 1.75, k: 1, flush: false } }, CN.screwLen, k)
    const tag = liveLabel(bench.g, [0, 0, 0], { size: 0.36, align: 'left' })
    const S = plot.s
    const tr = S.trace(POWER, { samples: COVER_SWEEP.length, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const ins = S.level(GREY)
    const lo = COVER_SWEEP[0]
    const span = COVER_SWEEP[COVER_SWEEP.length - 1] - lo
    const ymax = 1.15 * Math.max(nutPocket(0, 4, 'top').force, nutPocketView(0, 4, 'top').insert)
    const py = c.py(0, ymax)
    let key = ''
    let t = 0
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = cnRun(p)
        const a = V.cur
        t += dt
        if (key !== cnKey(p)) {
          key = cnKey(p)
          bench.slabs.set(pocketSlabs(q.clear, q.cover, q.style, a.roofSag))
          const ph = NUT.nutH + 0.3
          const p0 = q.style === 'top' ? q.cover : CN.floor
          const H = p0 + ph + (q.style === 'top' ? 0 : q.cover)
          nut.group.position.set(q.style === 'side' ? a.gap / 2 : 0, (q.style === 'top' ? p0 : p0 + ph - NUT.nutH) * k, 0)
          screw.group.rotation.x = q.style === 'top' ? Math.PI : 0
          screw.group.position.y = (q.style === 'top' ? -CN.plate : H) * k
          const lift = q.style === 'top' ? CN.plate + CN.head : 0
          bench.slabs.group.position.y = lift * k
          holder.position.y = lift * k
          tag.group.position.set((CN.W / 2 + 5) * k, (H + 3 + (q.style === 'top' ? CN.plate + CN.head : 0)) * k, 0)
        }
        nut.group.rotation.y = a.play * (Math.PI / 180) * Math.sin(t * 2.5)
        tag.set(`${Math.round(a.force)} N`, verdictTint(a.force >= 0.8 * V.insert, a.force >= 0.4 * V.insert))
        tr.points(COVER_SWEEP.map((v) => (v - lo) / span), V.curve.map(py), null)
        cur((q.cover - lo) / span)
        ins.set(py(V.insert))
        plot.right.set(`${fixedText(q.cover, 1)} mm: ${Math.round(a.force)} N`, RING)
        tally?.set([a.force, V.insert, V.screw], [a.force, V.insert, V.screw].map((f) => `${Math.round(f)}`), [RING, GREY, GREY], ymax)
        const fitOk = a.fit === 'press' || a.fit === 'snug' || a.fit === 'slide'
        rows[0].set(`Pocket ${mmFixed(NUT.nutAF + q.clear, 2)} prints ${mmFixed(NUT.nutAF + a.gap, 2)}: ${FIT_CLASSES[a.fit].toLowerCase()}`, verdictTint(a.fit === 'snug' || a.fit === 'press', fitOk))
        rows[1].set(`Nut rocks ±${degText(a.play, 0)} before a corner catches${a.fallsOut && q.style !== 'buried' ? '; loose' : ''}`, a.play < 8 ? LABEL : RING)
        rows[2].set(q.style === 'top' ? 'Open top: holds only when pulled onto the floor' : q.style === 'side' ? `Roof bridges ${mmFixed(a.span, 1)}: sag ${mmFixed(a.roofSag, 2)}, typical` : 'Pause at the pocket top, drop the nut in, bridge it over', q.style === 'top' ? RING : LABEL)
        head.status.set(`M3 nut pocket · ${STYLE_SHORT[q.style]}`)
        head.sub.set('PLA, cut through the screw; nut pulls toward the cover', GREY)
        head.event.set(q.cover < 1.2 ? 'cover too thin: the nut punches through' : a.fit === 'stuck' ? 'nut will not go in' : a.both ? 'holds both ways' : 'holds one way', verdictTint(q.cover >= 2 && a.fit !== 'stuck' && a.both, q.cover >= 1.2 && a.fit !== 'stuck'))
      },
      readouts: (p) => {
        const { q, V } = cnRun(p)
        const a = V.cur
        return [
          { label: 'Pull-through', value: `${Math.round(a.force)} N`, tone: toneOf(a.force >= 0.8 * V.insert, a.force >= 0.4 * V.insert) },
          { label: 'Printed gap', value: mmFixed(a.gap, 2), tone: toneOf(a.fit === 'snug' || a.fit === 'press', a.fit !== 'stuck' && a.fit !== 'loose') },
          { label: 'Rock', value: degText(a.play, 0) },
          { label: 'Cover layers', value: `${Math.round(q.cover / LH)}`, tone: toneOf(q.cover >= 2, q.cover >= 1.2) },
        ]
      },
    }
  },
}

// --- Snap fits ---

const SNAP_NAMES = Object.fromEntries((Object.keys(SNAP_MATS) as SnapMat[]).map((m) => [m, FILAMENTS[m].name])) as Record<SnapMat, string>
const sfParams = (p: Params) => ({ m: pick(SNAP_MATS, p.m, 'pla') as SnapMat, o: pick(SNAP_ORIENTS, p.o, 'along') as SnapOrient, t: n(p, 't'), L: n(p, 'len'), y: n(p, 'y'), back: n(p, 'back') })
const sfKey = (p: Params) => `${p.m} ${p.o} ${p.t} ${p.len} ${p.y} ${p.back}`
const sfRun = memoBy(sfKey, (p: Params) => {
  const q = sfParams(p)
  return { q, V: snapView(q.m, q.o, q.t, q.L, q.y, q.back) }
})
const SF = { k: 0.8, base: 5, segs: 20, layersZ: 8, plate: 2.5, cycle: 3.2 }
const pctTenths = (f: number) => `${fixedText(f * 100, 1)} %`
const forceText = (f: number) => (Number.isFinite(f) ? newtonsText(f, 1) : 'locks')

/** Hook protrusion at height s above the hook base: back face then the 30° lead. */
function hookAt(s: number, y: number, back: number) {
  const hb = back >= 89 ? 0 : y / Math.tan((back * Math.PI) / 180)
  const hl = y / Math.tan((SNAP.leadDeg * Math.PI) / 180)
  if (s < 0 || s > hb + hl) return 0
  return s < hb ? (y * s) / hb : y * (1 - (s - hb) / hl)
}
const hookH = (y: number, back: number) => (back >= 89 ? 0 : y / Math.tan((back * Math.PI) / 180)) + y / Math.tan((SNAP.leadDeg * Math.PI) / 180)

export const functionalPartsSnapFits: Lesson = {
  id: 'functional-parts-snap-fits',
  title: 'Snap fits',
  tagline: 'A printed hook that bends, clicks and holds',
  formula: (p) => {
    const { q, V } = sfRun(p)
    const a = V.cur
    return `ε = 1.5 t y / L² = 1.5 × ${q.t} × ${q.y} / ${q.L}² = ${pctTenths(a.eps)} vs ${pctTenths(a.allow)} allowed · P = E b t² ε / (6 L) = ${newtonsText(a.P, 1)} · push = P (μ + tan α) / (1 − μ tan α): in ${forceText(a.push)}, out ${forceText(a.pull)}, typical`
  },
  legend: [
    { color: POWER, label: 'Strain well under the limit', shape: 'dot' },
    { color: RING, label: 'Near the limit', shape: 'dot' },
    { color: HIGH_V, label: 'Over: cracks (PLA) or stays bent', shape: 'dot' },
    { color: GREY, label: 'Mating part', shape: 'dot' },
  ],
  points: [
    'A snap hook is a short cantilever. Pushing the mating part over the 30° lead bends it by the undercut y; the strain at its root is ε = 1.5 · t · y / L². Thicker or deeper hooks strain more, and length helps with the square.',
    'Keep ε under what the plastic takes once: PLA about 2 % (it is brittle and cracks), PETG about 4 %, nylon 6 % and more; TPU just flexes. Over the limit, tough plastics stay bent and lose their grip. Stiffness, strain and breaking come from Materials > Stress & strain.',
    'Print it so the hook bends along the layers: lying on its side, the lines run up the arm. Standing up, every layer line is a crack waiting at the root, and the allowance roughly halves (Design for printing > Orientation and strength).',
    'The face angles set the feel: a 30° lead pushes in easily; a 45° back lets it come apart again, and past about 73° friction locks it for good. A fillet at the root spreads the strain (Design for printing > Chamfers vs fillets).',
  ],
  controls: [
    { kind: 'choice', key: 'm', options: opts(SNAP_NAMES), initial: 'pla' },
    { kind: 'choice', key: 'o', options: opts(SNAP_ORIENTS), initial: 'along' },
    { kind: 'slider', key: 't', label: 'Arm thickness t', min: 0.8, max: 3, step: 0.2, initial: 1.6, format: (v) => mmFixed(v, 1) },
    { kind: 'slider', key: 'len', label: 'Arm length L', min: 6, max: 30, step: 1, initial: 12, format: (v) => mmFixed(v, 0) },
    { kind: 'slider', key: 'y', label: 'Undercut y', min: 0.4, max: 2, step: 0.1, initial: 1, format: (v) => mmFixed(v, 1) },
    { kind: 'slider', key: 'back', label: 'Back face angle', min: 30, max: 90, step: 15, initial: 45, format: (v) => `${v}°` },
  ],
  build(): Stage {
    const c = printStage('Root strain vs arm length', mmFixed(SNAP_L_SWEEP[0], 0), mmFixed(SNAP_L_SWEEP[SNAP_L_SWEEP.length - 1], 0), { title: 'Force to snap in and to pull out, typical', names: ['Push in', 'Pull out'] })
    const { scene, head, rows, plot, tally } = c
    const bench = c.bench([-11.4, -11.6, 0], 1, 16, SNAP.b + 4, 400, -0.3)
    bench.slabs.group.position.x = 4
    const tag = liveLabel(scene, [-4, 1.6, 0.3], { size: 0.36, align: 'left' })
    const S = plot.s
    const tr = S.trace(POWER, { samples: SNAP_L_SWEEP.length, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const limit = S.level(HIGH_V)
    const lo = SNAP_L_SWEEP[0]
    const span = SNAP_L_SWEEP[SNAP_L_SWEEP.length - 1] - lo
    const top = 0.08
    const py = c.py(0, top)
    let key = ''
    let t = 0
    let broke = false
    let peak = 0
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = sfRun(p)
        const a = V.cur
        if (key !== sfKey(p)) {
          ;[key, t, broke, peak] = [sfKey(p), 0, false, 0]
          bench.g.scale.setScalar(Math.min(SF.k, 17 / (q.L + SF.base + 4)))
        }
        t = (t + dt) % SF.cycle
        const B = SF.base
        const hh = hookH(q.y, q.back)
        const h0 = B + q.L - hh
        const yc = B + q.L + 1 - (Math.min(1, t / (SF.cycle * 0.7)) * (q.L + 1 + SF.plate)) / 1
        let push = 0
        for (let i = 0; i <= 12; i++) push = Math.max(push, hookAt(yc + (SF.plate * i) / 12 - h0, q.y, q.back))
        if (t < 0.05) [broke, peak] = [false, 0]
        if (a.ratio * (push / q.y) > 1 && !a.sets) broke = true
        peak = Math.max(peak, push)
        const set = a.sets ? q.y * (1 - 1 / a.ratio) * 0.5 * (peak / q.y) : 0
        const d = broke ? 0 : Math.max(push, Math.min(set, peak))
        const out: Slab[] = []
        const z0 = -SNAP.b / 2
        out.push({ x0: -4, x1: q.t + 3, y0: 0, y1: B, z0: z0 - 1, z1: -z0 + 1, color: BASE })
        const bend = (u: number) => -d * ((3 * u * u - u * u * u) / 2)
        const layerStep = Math.max(LH, q.L / 26)
        const segs = q.o === 'along' ? SF.segs : Math.round(q.L / layerStep)
        for (let i = 0; i < segs; i++) {
          const u = (i + 0.5) / segs
          const ratioU = a.ratio * (d / q.y) * (1 - u)
          const color = broke && i === 0 ? HIGH_V : stressHex(ratioU)
          const dx = bend(u) - (broke ? 0.6 + i * 0.03 : 0)
          const y0 = B + (q.L * i) / segs + (broke ? 0.3 : 0)
          const y1 = B + (q.L * (i + (q.o === 'along' ? 1 : 0.8))) / segs + (broke ? 0.3 : 0)
          if (q.o === 'along') for (let j = 0; j < SF.layersZ; j++) out.push({ x0: dx, x1: dx + q.t, y0, y1, z0: z0 + (SNAP.b * j) / SF.layersZ, z1: z0 + (SNAP.b * (j + 0.82)) / SF.layersZ, color })
          else out.push({ x0: dx, x1: dx + q.t, y0, y1, z0, z1: -z0, color })
        }
        const tipX = bend(1) - (broke ? 0.6 + segs * 0.03 : 0)
        for (let i = 0; i < 8; i++) {
          const s0 = (hh * i) / 8
          const w = hookAt(s0 + hh / 16, q.y, q.back)
          out.push({ x0: tipX + q.t - 0.01, x1: tipX + q.t + w, y0: h0 + s0 + (broke ? 0.3 : 0), y1: h0 + s0 + hh / 8 + (broke ? 0.3 : 0), z0, z1: -z0, color: PRINT_TINT })
        }
        out.push({ x0: q.t + 0.05, x1: q.t + 7, y0: yc, y1: yc + SF.plate, z0: z0 - 1, z1: -z0 + 1, color: '#8a8f99' })
        bench.slabs.set(out)
        tag.set(broke ? 'cracked at the root' : `strain now ${pctTenths((a.eps * d) / q.y)}`, broke ? HIGH_V : verdictTint(a.ratio * (d / q.y) < 0.8, a.ratio * (d / q.y) <= 1))
        tr.points(SNAP_L_SWEEP.map((l) => (l - lo) / span), V.curve.map((e) => py(Math.min(top, e))), null)
        cur((q.L - lo) / span)
        limit.set(py(Math.min(top, a.allow)))
        plot.right.set(`${q.L} mm: ${pctTenths(a.eps)}`, RING)
        const fin = [a.push, a.pull].filter(Number.isFinite)
        const full = Math.max(1, ...fin) * 1.1
        tally?.set([a.push, Number.isFinite(a.pull) ? a.pull : full], [forceText(a.push), forceText(a.pull)], [POWER, Number.isFinite(a.pull) ? RING : HIGH_V], full)
        rows[0].set(`Root strain ${pctTenths(a.eps)} of ${pctTenths(a.allow)} allowed for ${FILAMENTS[q.m].name}`, verdictTint(a.ratio < 0.8, a.ratio <= 1))
        rows[1].set(`Shortest safe arm for this hook: ${mmFixed(a.minL, 1)}`, q.L >= a.minL ? LABEL : HIGH_V)
        rows[2].set(`Deflecting it takes ${newtonsText(a.P, 1)} at the hook, typical`, LABEL)
        head.status.set(`Snap hook · ${FILAMENTS[q.m].name}, bends ${q.o} the layers`)
        head.sub.set(`${SNAP.b} mm wide, 30° lead, ${q.back}° back; drawn to scale`, GREY)
        head.event.set(a.ratio <= 0.8 ? 'clicks in and lasts' : a.ratio <= 1 ? 'works, little margin' : a.breaks ? 'cracks at the root' : 'stays bent: loses its grip', verdictTint(a.ratio <= 0.8, a.ratio <= 1))
      },
      readouts: (p) => {
        const { V } = sfRun(p)
        const a = V.cur
        return [
          { label: 'Root strain', value: pctTenths(a.eps), tone: toneOf(a.ratio < 0.8, a.ratio <= 1) },
          { label: 'Of allowed', value: pct(a.ratio), tone: toneOf(a.ratio < 0.8, a.ratio <= 1) },
          { label: 'Push in', value: forceText(a.push) },
          { label: 'Pull out', value: forceText(a.pull) },
        ]
      },
    }
  },
}

// --- Living hinges ---

const HINGE_NAMES = Object.fromEntries((Object.keys(HINGE_MATS) as HingeMat[]).map((m) => [m, HINGE_MATS[m].name])) as Record<HingeMat, string>
const lhParams = (p: Params) => ({ m: pick(HINGE_MATS, p.m, 'petg') as HingeMat, h: n(p, 'h'), fold: n(p, 'fold'), lines: pick(HINGE_LINES, p.lines, 'across') as HingeLines })
const lhKey = (p: Params) => `${p.m} ${p.h} ${p.fold} ${p.lines}`
const lhRun = memoBy(lhKey, (p: Params) => {
  const q = lhParams(p)
  return { q, V: hingeView(q.m, q.h, q.fold, q.lines) }
})
const LHG = { k: 0.8, leaf: 9, leafT: 2.4, D: 12, segs: 10, strips: 6, fold: 1.4, lapse: 9, hold: 1.5 }
const GOAL = 1e4
const log7 = (c: number) => Math.log10(c) / 7
const foldsText = (c: number) => `${countText(c)} ${c < 1.5 ? 'fold' : 'folds'}`

export const functionalPartsLivingHinges: Lesson = {
  id: 'functional-parts-living-hinges',
  title: 'Living hinges',
  tagline: 'A thin printed web that folds thousands of times',
  formula: (p) => {
    const { q, V } = lhRun(p)
    return `ε = h θ / (2 × span) = ${q.h} × ${q.fold}° / (2 × ${HINGE.span} mm) = ${pct(V.eps)} · folds ≈ 10⁶ × (ε₁ / ε)⁴ = ${countText(V.cycles)}, typical`
  },
  legend: [
    { color: POWER, label: 'Web strain low for this plastic', shape: 'dot' },
    { color: HIGH_V, label: 'Web near cracking', shape: 'dot' },
    { color: GREY, label: `Goal: ${countText(GOAL)} folds (a lid, years)`, shape: 'dot' },
    { color: RING, label: 'This web', shape: 'dot' },
  ],
  points: [
    'A living hinge is a thin web joining two stiff leaves, like the lid of a pill box. Folded θ over a span, the web bends to a radius span / θ and its surface strains by h · θ / (2 · span): thinner and longer webs strain less.',
    'Polypropylene is the classic: it survives a million folds. Printed PETG and nylon last thousands to hundreds of thousands, TPU just flexes; PLA is brittle and cracks within tens to hundreds (strain limits: Materials > Stress & strain).',
    'Print the web flat, as the first 2 or 3 layers (0.3 to 0.6 mm), with the lines running across the hinge from leaf to leaf (a modifier with 0° or 90° solid infill), so each fold bends lines along their length. Lines along the fold get pulled apart at every bend and crack early.',
    'Fold it a few times while it is still warm from the bed, round the inside corners of the leaves so they do not pinch the web, and use a pin hinge when it has to carry load (Strength > Layer adhesion is next).',
  ],
  controls: [
    { kind: 'choice', key: 'm', options: opts(HINGE_NAMES), initial: 'petg' },
    { kind: 'slider', key: 'h', label: 'Web thickness h', min: 0.2, max: 0.8, step: 0.1, initial: 0.4, format: (v) => mmFixed(v, 1) },
    { kind: 'slider', key: 'fold', label: 'Fold angle', min: 30, max: 180, step: 15, initial: 180, format: (v) => `${v}°` },
    { kind: 'choice', key: 'lines', options: opts(HINGE_LINES), initial: 'across' },
  ],
  build(): Stage {
    const names = Object.keys(HINGE_MATS) as HingeMat[]
    const c = printStage('Folds to cracking (log, 1 to 10M) vs web', mmFixed(HINGE_H_SWEEP[0], 1), mmFixed(HINGE_H_SWEEP[HINGE_H_SWEEP.length - 1], 1), { title: 'Folds before cracking at this web, typical', names: names.map((m) => HINGE_MATS[m].name) })
    const { scene, head, rows, plot, tally } = c
    const { k, leaf, leafT, D, segs, strips } = LHG
    const g = add(scene, new THREE.Group(), [-8, -6.8, 0])
    g.rotation.set(0.35, -0.45, 0)
    g.scale.setScalar(k)
    const leafMat = mat(PRINT_TINT, { rough: 0.55 })
    box(g, [leaf, leafT, D], leafMat, [-HINGE.span / 2 - leaf / 2, leafT / 2, 0])
    const right = add(g, new THREE.Group())
    box(right, [leaf, leafT, D], leafMat, [leaf / 2, leafT / 2, 0])
    const web = Array.from({ length: segs }, () => {
      const seg = add(g, new THREE.Group())
      const parts = Array.from({ length: strips }, (_, j) => {
        const m = new THREE.MeshStandardMaterial({ roughness: 0.5 })
        return { m, b: box(seg, [1, 1, (D / strips) * 0.96], m, [0, 0, -D / 2 + (D * (j + 0.5)) / strips]) }
      })
      return { seg, parts }
    })
    const tag = liveLabel(scene, [-12, -0.6, 0.3], { size: 0.4, align: 'left' })
    const S = plot.s
    const tr = S.trace(POWER, { samples: HINGE_H_SWEEP.length, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const goal = S.level(GREY)
    const lo = HINGE_H_SWEEP[0]
    const span = HINGE_H_SWEEP[HINGE_H_SWEEP.length - 1] - lo
    const py = c.py(0, 1)
    const col = new THREE.Color()
    let key = ''
    let t = 0
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = lhRun(p)
        if (key !== lhKey(p)) [key, t] = [lhKey(p), 0]
        t = (t + dt) % (LHG.lapse + LHG.hold)
        const count = 10 ** (7 * Math.min(1, t / LHG.lapse))
        const cracked = count >= V.cycles
        const phi = cracked ? 0.25 : (q.fold * Math.PI) / 180 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / LHG.fold))
        const h = q.h
        const sp = HINGE.span
        const R = phi > 1e-3 ? sp / phi : Infinity
        const at = (s: number): [number, number, number] => (R === Infinity ? [-sp / 2 + s, h / 2, 0] : [-sp / 2 + R * Math.sin(s / R), h / 2 - R + R * Math.cos(s / R), -s / R])
        const strain = phi / ((q.fold * Math.PI) / 180)
        const life = Math.min(1, log7(count) / Math.max(1e-6, log7(V.cycles)))
        web.forEach((w, i) => {
          const [x, y, a] = at(((i + 0.5) / segs) * sp)
          w.seg.position.set(x, y, 0)
          w.seg.rotation.z = a
          const gone = cracked && i === segs / 2
          w.parts.forEach((pt, j) => {
            pt.b.visible = !gone
            pt.b.scale.set((sp / segs) * (q.lines === 'along' ? 0.85 : 1.04), h, 1)
            const shade = q.lines === 'along' ? i % 2 : j % 2
            col.copy(stressColor(cracked ? 1.2 : 0.2 + 0.8 * life * Math.max(0.3, strain))).multiplyScalar(shade ? 0.78 : 1)
            pt.m.color.copy(col)
          })
        })
        const [ex, ey, ea] = at(sp)
        right.position.set(ex, ey - h / 2 + (cracked ? -1.2 : 0), 0)
        right.rotation.z = ea
        tag.set(cracked ? `cracked after ${foldsText(V.cycles)}` : foldsText(count), cracked ? HIGH_V : POWER)
        tr.points(HINGE_H_SWEEP.map((x) => (x - lo) / span), V.curve.map((nf) => py(log7(nf))), null)
        cur((q.h - lo) / span)
        goal.set(py(log7(GOAL)))
        plot.right.set(`${fixedText(q.h, 1)} mm: ${countText(V.cycles)}`, RING)
        tally?.set(V.all.map((a) => log7(a.cycles)), V.all.map((a) => countText(a.cycles)), V.all.map((a) => (a.m === q.m ? RING : a.cycles >= GOAL ? POWER : HIGH_V)), 1)
        rows[0].set(`Web strain ${pct(V.eps)} at ${q.fold}° over a ${HINGE.span} mm span`, LABEL)
        rows[1].set(`${HINGE_MATS[q.m].name}: about ${foldsText(V.cycles)} before it cracks`, verdictTint(V.cycles >= GOAL * 10, V.cycles >= GOAL))
        rows[2].set(`${fixedText(q.h, 1)} mm = ${fixedText(V.layers, 1)} layers; ${q.lines === 'across' ? 'lines bend along their length' : 'lines get pulled apart'}`, V.layers < 1.5 ? HEAT : q.lines === 'across' ? LABEL : RING)
        head.status.set(`Living hinge · ${HINGE_MATS[q.m].name}`)
        head.sub.set(`folding ${q.fold}° again and again; fold count sped up (log time)`, GREY)
        head.event.set(V.cycles >= GOAL * 10 ? 'lasts for years' : V.cycles >= GOAL ? 'fine for a lid' : 'cracks early', verdictTint(V.cycles >= GOAL * 10, V.cycles >= GOAL))
      },
      readouts: (p) => {
        const { V } = lhRun(p)
        return [
          { label: 'Web strain', value: pct(V.eps) },
          { label: 'Folds', value: countText(V.cycles), tone: toneOf(V.cycles >= GOAL * 10, V.cycles >= GOAL) },
          { label: 'Layers', value: fixedText(V.layers, 1), tone: toneOf(V.layers >= 1.5, false) },
        ]
      },
    }
  },
}

// --- Printed gears ---

const GEAR_NAMES = { pla: FILAMENTS.pla.name, petg: FILAMENTS.petg.name, nylon: FILAMENTS.nylon.name } as Record<GearMat, string>
const pgParams = (p: Params) => ({ T: n(p, 'torque'), mod: n(p, 'mod'), face: n(p, 'face'), m: pick(GEAR_MATS, p.m, 'pla') as GearMat, kind: pick(PRINT_GEAR_KINDS, p.kind, 'flat') as PrintGearKind })
const pgKey = (p: Params) => `${p.torque} ${p.mod} ${p.face} ${p.m} ${p.kind}`
const pgRun = memoBy(pgKey, (p: Params) => {
  const q = pgParams(p)
  return { q, V: printedGearView(q.T, q.mod, q.face, q.m, q.kind), all: (Object.keys(GEAR_MATS) as GearMat[]).map((m) => printedGear(q.T, q.mod, q.face, m, q.kind)) }
})
const PG = { width: 19, at: [-8, -5.2, 0] as V3, spin: 1.2, top: 30 }

export const functionalPartsPrintedGears: Lesson = {
  id: 'functional-parts-printed-gears',
  title: 'Printed gears',
  tagline: 'Plastic teeth sized for the load, with room for the printer',
  formula: (p) => {
    const { q, V } = pgRun(p)
    const a = V.cur
    return `Lewis: σ = Ft Kv / (b m Y) = ${newtonsText(a.Ft, 1)} × ${fixedText(a.Kv, 2)} / (${q.face} × ${q.mod} × ${fixedText(lewisY(GEAR_PAIR.z1), 3)}) = ${fixedText(a.sigma, 1)} MPa vs ${fixedText(a.allow, 1)} allowed → SF ${fixedText(a.sf, 2)} · backlash = 2 × ${GEAR_PAIR.clear} × tan 20° = ${mmFixed(a.backlash, 2)}, typical`
  },
  legend: [
    { color: POWER, label: 'Tooth stress low (SF 3+)', shape: 'dot' },
    { color: RING, label: 'SF about 2', shape: 'dot' },
    { color: HIGH_V, label: 'Over the allowed stress', shape: 'dot' },
    { color: GREY, label: 'Allowed for this plastic and print', shape: 'dot' },
  ],
  points: [
    'A 12-tooth pinion on the motor drives a 36-tooth gear: 3 × the torque at the joint (ratios and backlash: Actuators > Gear trains). The pinion teeth carry the same force as the big gear but are the weaker shape, so they set the size.',
    'Lewis treats a tooth as a little cantilever: σ = Ft / (b · m · Y). At a fixed torque σ falls with the square of the module, and straight with the face width. For a 0.4 mm nozzle keep the module 1 or more, or the teeth are only a couple of lines thick.',
    'Print gears flat: every tooth is then whole lines in one layer. On their edge, half the teeth bend across the layers at half the strength. Herringbone teeth share the load more smoothly, cannot walk off the shaft and still print flat.',
    'Add 0.1 to 0.2 mm to the centre distance for printer tolerance (Design for printing > Tolerances and fits); that is backlash at the joint. Nylon slides and wears least, PLA wears and creeps; 4 or more walls or solid infill under the teeth (Strength > Wall count vs infill).',
  ],
  controls: [
    { kind: 'slider', key: 'torque', label: 'Motor torque on the pinion', min: 0.02, max: 0.4, step: 0.02, initial: 0.1, format: (v) => nmText(v, 2) },
    { kind: 'slider', key: 'mod', label: 'Module', min: 0.5, max: 2.5, step: 0.25, initial: 1, format: (v) => mmFixed(v, 2) },
    { kind: 'slider', key: 'face', label: 'Face width', min: 3, max: 15, step: 1, initial: 6, format: (v) => mmFixed(v, 0) },
    { kind: 'choice', key: 'm', options: opts(GEAR_NAMES), initial: 'pla' },
    { kind: 'choice', key: 'kind', options: opts(PRINT_GEAR_KINDS), initial: 'flat' },
  ],
  build(): Stage {
    const mats = Object.keys(GEAR_MATS) as GearMat[]
    const c = printStage('Pinion tooth stress vs module', mmFixed(MODULE_SWEEP[0], 1), mmFixed(MODULE_SWEEP[MODULE_SWEEP.length - 1], 1), { title: 'Safety factor per plastic at this size', names: mats.map((m) => GEAR_NAMES[m]) })
    const { scene, head, rows, plot, tally } = c
    const { z1, z2 } = GEAR_PAIR
    const g = add(scene, new THREE.Group(), PG.at)
    g.rotation.set(0.25, -0.35, 0)
    const holder = add(g, new THREE.Group())
    const pinMat = new THREE.MeshStandardMaterial({ roughness: 0.5 })
    const gearMat = new THREE.MeshStandardMaterial({ roughness: 0.5 })
    const layerMat = mat('#20242b', { rough: 0.8 })
    const shaft = mat('#b9bec6', { metal: 0.4, rough: 0.4 })
    const bar = add(scene, new THREE.Group(), [-17, -11.6, 0.3])
    const barBox = box(bar, [1, 0.18, 0.1], mat(LABEL, { rough: 0.6 }), [0.5, 0, 0])
    addLabel(bar, '10 mm', [0, 0.5, 0], GREY, 0.3, 'left')
    const S = plot.s
    const tr = S.trace(POWER, { samples: MODULE_SWEEP.length, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const allow = S.level(GREY)
    const lo = MODULE_SWEEP[0]
    const span = MODULE_SWEEP[MODULE_SWEEP.length - 1] - lo
    const py = c.py(0, PG.top)
    let key = ''
    let kv = 1
    let a2 = 0
    let ang = 0
    let p1: THREE.Group | null = null
    let p2: THREE.Group | null = null
    const gear = (parent: THREE.Object3D, z: number, mod: number, w: number, m: THREE.Material, herring: boolean, edge: boolean) => {
      const grp = add(parent, new THREE.Group())
      if (herring) {
        for (const s of [-1, 1]) {
          const half = spurGear(grp, z, mod, w / 2, m)
          half.position.z = (s * w) / 4
          half.rotation.z = (s * Math.PI) / z / 2
        }
      } else spurGear(grp, z, mod, w, m)
      cylinder(grp, mod * 0.9, w + 0.4, shaft, [0, 0, 0], 'z', 16)
      if (edge) {
        const r = (mod * z) / 2 + mod
        for (let y = -r + 0.5 * mod; y < r; y += Math.max(0.12, 1.2 * mod)) {
          const half = Math.sqrt(Math.max(0, r * r - y * y))
          box(grp, [2 * half, 0.04, 0.02], layerMat, [0, y, w / 2 + 0.02])
        }
      }
      return grp
    }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V, all } = pgRun(p)
        const a = V.cur
        if (key !== pgKey(p)) {
          key = pgKey(p)
          emptyGroup(holder)
          kv = PG.width / (50 * q.mod)
          const mk = q.mod * kv
          a2 = (a.centre - 0) * kv
          p1 = gear(holder, z1, mk, q.face * kv, pinMat, q.kind === 'herring', q.kind === 'edge')
          p2 = gear(holder, z2, mk, q.face * kv, gearMat, q.kind === 'herring', q.kind === 'edge')
          p1.position.set(0, 0, 0)
          p2.position.set(a2, 0, 0)
          holder.position.x = -PG.width / 2 + 7 * mk
          barBox.scale.x = 10 * kv
        }
        ang += dt * PG.spin
        if (p1 && p2) {
          p1.rotation.z = ang
          p2.rotation.z = meshTurn(ang, z1, z2, 0)
        }
        pinMat.color.copy(stressColor(1 / a.sf))
        gearMat.color.copy(stressColor(a.sigmaGear / a.allow))
        tr.points(MODULE_SWEEP.map((m) => (m - lo) / span), V.curve.map((s) => py(Math.min(PG.top, s))), null)
        cur((q.mod - lo) / span)
        allow.set(py(Math.min(PG.top, a.allow)))
        plot.right.set(`m ${fixedText(q.mod, 2)}: ${fixedText(a.sigma, 1)} MPa`, RING)
        tally?.set(all.map((x) => Math.min(3, x.sf)), all.map((x) => fixedText(x.sf, 1)), all.map((x, i) => (mats[i] === q.m ? RING : x.sf >= 2 ? POWER : x.sf >= 1 ? GREY : HIGH_V)), 3)
        rows[0].set(`Tooth force Ft = 2T / d = ${newtonsText(a.Ft, 1)} on a ${mmFixed(q.mod * z1, 0)} pinion`, LABEL)
        rows[1].set(`Pinion tooth ${fixedText(a.sigma, 1)} of ${fixedText(a.allow, 1)} MPa allowed: SF ${fixedText(a.sf, 2)}`, verdictTint(a.sf >= 3, a.sf >= 1.5))
        rows[2].set(`+${GEAR_PAIR.clear} mm centres: ${degText(a.playDeg, 2)} play = ${mmFixed(a.tipMm, 2)} at a ${GEAR_PAIR.armMm} mm arm`, LABEL)
        head.status.set(`${z1} : ${z2} robot joint stage · ${GEAR_NAMES[q.m]}`)
        head.sub.set(`${PRINT_GEAR_KINDS[q.kind].toLowerCase()}; module ${fixedText(q.mod, 2)}, drawn to fit`, GREY)
        head.event.set(`${fixedText(a.ratio, 0)}× torque: ${nmText(a.outNm, 2)} at the joint · wear ${a.wear >= 0.8 ? 'low' : a.wear >= 0.4 ? 'medium' : 'high'}`, verdictTint(a.sf >= 3, a.sf >= 1.5))
      },
      readouts: (p) => {
        const { V } = pgRun(p)
        const a = V.cur
        return [
          { label: 'Tooth stress', value: `${fixedText(a.sigma, 1)} MPa`, tone: toneOf(a.sf >= 3, a.sf >= 1.5) },
          { label: 'Safety factor', value: fixedText(a.sf, 2), tone: toneOf(a.sf >= 3, a.sf >= 1.5) },
          { label: 'Joint torque', value: nmText(a.outNm, 2) },
          { label: 'Backlash', value: degText(a.playDeg, 2) },
        ]
      },
    }
  },
}
