import * as THREE from 'three/webgpu'
import {
  FILE_FEATURES,
  HubForm,
  INFILL_PATTERNS,
  InfillPattern,
  Orientation,
  SEAM_MODES,
  SUPPORT_KINDS,
  SeamMode,
  SupportKind,
  formatView,
  hubShape,
  infillView,
  layerHeightView,
  pathMm,
  seamView,
  supportView,
  toolpathAt,
  wallsView,
} from '../../core/physics'
import { bytesText, degText, fixedText, hoursText, mmFixed, pct } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  FILAMENT_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  POWER,
  RING,
  SEG_COLORS,
  SEG_NAMES,
  WIDE_VIEW,
  addLabel,
  countBars,
  hubLathe,
  layerPreview,
  liveLabel,
  memoBy,
  plotY,
  shadowlessRod,
  slicerRig,
  statusHeader,
  stretchRod,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const minText = (s: number) => hoursText(s / 3600)
const RIG = { at: [-9.6, -9.4, 0] as V3, k: 0.34 }
const PREVIEW = { at: [8.6, -8.4, 0] as V3, span: 46, size: 9.6 }
const shade = (i: number) => (i % 2 ? '#d9732f' : FILAMENT_COLOR)
const segLegend = (kinds: (keyof typeof SEG_COLORS)[]) => kinds.map((k) => ({ color: SEG_COLORS[k], label: SEG_NAMES[k], shape: 'dot' as const }))

// --- STL and 3MF: the same hub saved two ways; what each file carries. ---

const FORMATS = { stl: 'STL', '3mf': '3MF' }
const EXTRA_COLORS = ['#5aa9ff', '#7ee081', '#ff5fd2']
const fmRun = memoBy((p: Params) => `${p.seg} ${p.extra}`, (p: Params) => formatView(n(p, 'seg'), 1 + n(p, 'extra')))

export const slicingStlAnd3mf: Lesson = {
  id: 'slicing-stl-and-3mf',
  title: 'STL and 3MF',
  tagline: 'Triangles only, or a whole project in one zip',
  formula: (p) => {
    const V = fmRun(p)
    return `binary STL = 84 + 50 B × triangles = 84 + 50 × ${V.tris} = ${bytesText(V.stl)} · 3MF = zip(XML: shared vertices + triangles + units, colours, objects, settings) ≈ ${bytesText(V.zip)} (typical)`
  },
  legend: (p) => [
    { color: p.fmt === '3mf' ? FILAMENT_COLOR : '#b8bcc4', label: 'Hub', shape: 'dot' },
    { color: p.fmt === '3mf' ? EXTRA_COLORS[0] : '#b8bcc4', label: p.fmt === '3mf' ? 'Spacers, own colour + settings' : 'Spacers, merged into one mesh', shape: 'dot' },
    { color: RING, label: 'Triangle edges', shape: 'dot' },
  ],
  points: [
    'A slicer needs the part as a closed surface. CAD basics › Exporting STL covers how CAD turns curves into triangles, chord tolerance, unit mix-ups and mesh checks; this lesson is about the file that carries them.',
    'STL (1987) is a bare list of triangles: three corners and a normal each, 50 bytes per triangle in binary, about 250 in ASCII. No units (the slicer guesses mm), no colour, no names, and several parts saved together merge into one mesh.',
    '3MF is a zip of XML. Vertices are stored once and shared by triangles, so even uncompressed it beats ASCII STL, and zipped it is typically a third to half of binary STL. It records the unit, each object with its position, colours and materials for multi-material printers, and the slicer settings.',
    'Because 3MF carries settings, a project file opens with the same layer height, walls, supports and per-part modifiers (say 4 walls only on the flange). Send 3MF between people and slicers; keep STL for old tools and part libraries.',
  ],
  controls: [
    { kind: 'choice', key: 'fmt', options: opts(FORMATS), initial: '3mf' },
    { kind: 'slider', key: 'seg', label: 'Segments around', min: 24, max: 192, step: 8, initial: 64, format: (v) => `${v}` },
    { kind: 'slider', key: 'extra', label: 'Spacers on the plate', min: 0, max: 3, step: 1, initial: 2, format: (v) => `${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const rig = slicerRig(scene, RIG.at, RIG.k, { bed: 56 })
    const k = RIG.k
    const s = hubShape()
    const solid = new THREE.MeshStandardMaterial({ color: FILAMENT_COLOR, roughness: 0.5, flatShading: true })
    const hub = add(rig.holder, new THREE.Mesh(new THREE.BufferGeometry(), solid))
    const edges = add(rig.holder, new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: RING })))
    const SPOTS: [number, number][] = [[-21, 21], [0, 23], [21, 21]]
    const spacers = SPOTS.map(([x, y]) => {
      const m = add(rig.holder, new THREE.Mesh(new THREE.CylinderGeometry(5 * k, 5 * k, 6 * k, 16), new THREE.MeshStandardMaterial({ color: '#b8bcc4', roughness: 0.5, flatShading: true })), [x * k, 3 * k, -y * k])
      return m
    })
    const rows = textRows(scene, 6, 1.6, 3.4, 0.3, 0.72)
    addLabel(scene, 'file size, same triangles', [1.6, -1.9, 0.3], GREY, 0.3, 'left')
    const bars = countBars(scene, [5.2, -3.0, 0], ['Binary STL', 'ASCII STL', '3MF zipped'], 7, { row: 1, size: 0.3 })
    const keeps = textRows(scene, 4, 1.6, -7.0, 0.3, 0.75)
    const st = { key: '' }
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const V = fmRun(p)
        const mf = p.fmt === '3mf'
        const seg = n(p, 'seg')
        const extra = n(p, 'extra')
        const key = `${seg}`
        if (key !== st.key) {
          st.key = key
          hub.geometry.dispose()
          hub.geometry = hubLathe(s.profile, k, seg)
          edges.geometry.dispose()
          edges.geometry = new THREE.EdgesGeometry(hub.geometry, 1)
        }
        solid.color.set(mf ? FILAMENT_COLOR : '#b8bcc4')
        spacers.forEach((m, i) => {
          m.visible = i < extra
          ;(m.material as THREE.MeshStandardMaterial).color.set(mf ? EXTRA_COLORS[i] : '#b8bcc4')
        })
        if (mf) {
          rows[0].set('hub.3mf  (a zip)', LABEL)
          rows[1].set('3D/3dmodel.model   unit="millimeter"', POWER)
          rows[2].set(`  ${1 + extra} objects, each placed and named`, POWER)
          rows[3].set(`  ${Math.round(V.tris / 2)} vertices stored once, ${V.tris} triangles`, LABEL)
          rows[4].set('  colours / materials per object', POWER)
          rows[5].set('Metadata/*.config   layer height, walls, modifiers', POWER)
        } else {
          rows[0].set('hub.stl  (binary)', LABEL)
          rows[1].set('80-byte header, triangle count', GREY)
          rows[2].set(`${V.tris} × (normal + 3 corners) = 50 B each`, LABEL)
          rows[3].set('corners repeated in every triangle', GREY)
          rows[4].set('no unit: 22 could be mm or inches', HIGH_V)
          rows[5].set(extra ? `no objects: ${1 + extra} parts merge into one mesh` : 'no colour, no settings', HIGH_V)
        }
        bars.set([V.stl, V.stlAscii, V.zip], [bytesText(V.stl), bytesText(V.stlAscii), bytesText(V.zip)], [mf ? GREY : RING, GREY, mf ? POWER : GREY])
        keeps[0].set('STL keeps:', LABEL)
        keeps[1].set(`  ${FILE_FEATURES.filter((_, i) => V.stlKeeps[i]).join(', ').toLowerCase()} only`, mf ? GREY : HIGH_V)
        keeps[2].set(`3MF keeps: ${FILE_FEATURES.slice(0, 3).join(', ').toLowerCase()},`, mf ? POWER : GREY)
        keeps[3].set(`  ${FILE_FEATURES.slice(3).join(', ').toLowerCase()}`, mf ? POWER : GREY)
        head.status.set(`STL and 3MF · ${FORMATS[mf ? '3mf' : 'stl']}`)
        head.sub.set(`wheel hub, ${seg} segments round, ${V.tris / (1 + extra)} triangles`, GREY)
        head.event.set(mf ? '3MF: one file carries the whole plate' : 'STL: only the triangles survive', mf ? POWER : HEAT)
        rig.holder.rotation.y = -0.5 + Math.sin(performance.now() / 4000) * 0.15
      },
      readouts: (p) => {
        const V = fmRun(p)
        const mf = p.fmt === '3mf'
        return [
          { label: 'Triangles', value: `${V.tris}` },
          { label: 'File', value: bytesText(mf ? V.zip : V.stl) },
          { label: 'Keeps', value: mf ? '6 of 6' : '1 of 6', tone: mf ? 'ok' : 'warn' },
        ]
      },
    }
  },
}

// --- Layer height: fixed vs adaptive on the domed cap; the 75 % of nozzle limit. ---

const NOZZLES_MM = { '0.4': '0.4 mm nozzle', '0.6': '0.6 mm nozzle' }
const LH_MODES = { fixed: 'Fixed', adaptive: 'Adaptive' }
const lhRun = memoBy((p: Params) => `${p.mode} ${p.layer} ${p.nozzle}`, (p: Params) =>
  layerHeightView(pick(LH_MODES, p.mode, 'adaptive') as 'fixed' | 'adaptive', n(p, 'layer'), Number(pick(NOZZLES_MM, p.nozzle, '0.4'))),
)
const LH_MAX = 0.45

export const slicingLayerHeight: Lesson = {
  id: 'slicing-layer-height',
  title: 'Layer height',
  tagline: 'Thick where walls are straight, thin where they curve',
  formula: (p) => {
    const V = lhRun(p)
    return `stair step = h · sin(wall lean) · adaptive: h = step limit / sin(lean), between 0.08 and ${fixedText(n(p, 'layer'), 2)} mm → ${V.heights.length} layers, ${minText(V.slice.total)}, worst step ${mmFixed(V.cusp, 2)} · keep h ≤ 0.75 × nozzle (typical)`
  },
  legend: [
    { color: FILAMENT_COLOR, label: 'Thick layers', shape: 'dot' },
    { color: LOW_V, label: 'Thin layers', shape: 'dot' },
    { color: RING, label: 'Chosen (max) height', shape: 'dot' },
    { color: HIGH_V, label: '75 % of nozzle', shape: 'dot' },
  ],
  points: [
    'How FDM works › Layer by layer showed the basics: thinner layers mean more layers and longer prints, and curved tops come out as stairs. This lesson tunes the height per layer.',
    'The stair step a layer leaves is h × sin(lean): nothing on a vertical wall, the full height on a near-flat slope. So thin layers only pay off where the outline leans, like the hub\'s domed cap.',
    'Adaptive (variable) layer height does exactly that: thick layers up the straight boss, thin ones over the dome. Here it matches the look of 0.08 mm layers in a fraction of the time.',
    'Keep layer height at or below about 75 % of the nozzle: 0.3 mm on a 0.4 mm nozzle. Thicker beads are not squashed into the layer below, the bond weakens and gaps appear; a 0.6 mm nozzle allows 0.45 mm. Strength › Layer adhesion goes further.',
    'Thicker layers are a little stronger across layers (fewer seams to fail) and much faster; thin layers win on curved and sloped faces. The common default stays 0.2 mm.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(LH_MODES), initial: 'adaptive' },
    { kind: 'slider', key: 'layer', label: 'Layer height (max)', min: 0.08, max: LH_MAX, step: 0.02, initial: 0.28, format: (v) => `${fixedText(v, 2)} mm` },
    { kind: 'choice', key: 'nozzle', options: opts(NOZZLES_MM), initial: '0.4' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const rig = slicerRig(scene, RIG.at, RIG.k, { tilt: 0.3 })
    rig.beads.show(0)
    rig.nozzle.visible = false
    const plotH = 7
    const plot = titledScope(scene, -6.6, plotH, 'layer height up the part', RING, 0, 8.6, 12)
    const curve = plot.s.trace(LOW_V, { samples: 400, radius: 0.06 })
    const chosen = plot.s.level(RING)
    const limit = plot.s.level(HIGH_V)
    plot.lo.set('bed')
    plot.hi.set('top of dome')
    const yTag = liveLabel(plot.s.group, [-6 + 0.2, plotH / 2 - 0.35, 0.4], { size: 0.24, color: GREY, align: 'left' })
    const rows = textRows(scene, 4, 1.6, 3.4, 0.3, 0.72)
    const c = new THREE.Color()
    const thin = new THREE.Color(LOW_V)
    const thick = new THREE.Color(FILAMENT_COLOR)
    const st = { t: 0, key: '' }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const V = lhRun(p)
        const hMax = n(p, 'layer')
        const noz = Number(pick(NOZZLES_MM, p.nozzle, '0.4'))
        const key = `${p.mode} ${hMax} ${noz}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          rig.setShell(V.shape.profile)
        }
        st.t = (st.t + dt / 6) % 1.4
        const N = V.slice.layers.length
        const count = Math.round(Math.min(1, st.t) * N)
        rig.stack.set(V.slice.layers, count, 'round', (i) => {
          const h = V.heights[i]
          c.copy(thin).lerp(thick, Math.min(1, (h - 0.08) / 0.16))
          return '#' + c.multiplyScalar(i % 2 ? 0.85 : 1).getHexString()
        })
        const y = plotY(0, LH_MAX, plotH)
        const zs = V.slice.layers.map((l) => (l.z + l.h / 2) / V.shape.h)
        curve.points(zs, V.heights.map(y), Math.max(0, Math.min(N, count) - 1))
        chosen.set(y(hMax))
        limit.set(y(0.75 * noz))
        yTag.set(`${LH_MAX} mm`, GREY)
        plot.right.set(`${V.heights.length} layers, ${fixedText(V.minH, 2)}–${fixedText(Math.max(...V.heights), 2)} mm`, LOW_V)
        rows[0].set(`${V.heights.length} layers · print ${minText(V.slice.total)} (0.08 mm everywhere: ${minText(V.fineTime)})`, LABEL)
        rows[1].set(`worst stair step on the dome ${mmFixed(V.cusp, 2)}`, V.cusp < 0.08 ? POWER : V.cusp < 0.16 ? RING : HEAT)
        rows[2].set(V.tooThick ? `${fixedText(hMax, 2)} mm > 75 % of ${noz} mm: weak, gappy layers` : `${fixedText(hMax, 2)} mm ≤ 75 % of ${noz} mm nozzle: beads squash`, V.tooThick ? HIGH_V : POWER)
        rows[3].set(`layer bond ${pct(V.bond)} of best (typical)`, toneColor(V.bond))
        head.status.set(`Layer height · ${LH_MODES[p.mode === 'fixed' ? 'fixed' : 'adaptive']} · ${fixedText(hMax, 2)} mm`)
        head.sub.set('wheel hub: straight boss, domed cap', GREY)
        head.event.set(p.mode === 'fixed' ? 'fixed: every layer the same, steps on the dome' : 'adaptive: thin layers only where the dome leans', p.mode === 'fixed' ? LABEL : POWER)
      },
      readouts: (p) => {
        const V = lhRun(p)
        return [
          { label: 'Layers', value: `${V.heights.length}` },
          { label: 'Print time', value: minText(V.slice.total) },
          { label: 'Worst step', value: mmFixed(V.cusp, 2), tone: toneOf(V.cusp < 0.08, V.cusp < 0.16) },
        ]
      },
    }
  },
}

const toneColor = (f: number) => (f > 0.9 ? POWER : f > 0.75 ? RING : HIGH_V)

// --- Walls and perimeters: one layer in section; wall count, order, gap fill. ---

const ORDERS = { outer: 'Outer wall first', inner: 'Inner walls first' }
const wpRun = memoBy((p: Params) => `${p.walls} ${p.z} ${p.order}`, (p: Params) => wallsView(n(p, 'walls'), n(p, 'z'), pick(ORDERS, p.order, 'outer') as 'outer' | 'inner'))
const HUB_H = hubShape().h

/** Shared layer animation: stack below, toolpath beads on top, nozzle tracing it, flat preview tracing too. */
function layerScene(scene: THREE.Scene) {
  const rig = slicerRig(scene, RIG.at, RIG.k, { beads: 1500 })
  const prev = layerPreview(scene, PREVIEW.at, PREVIEW.span, PREVIEW.size)
  const st = { t: 0, key: '', n: 0, mm: 1 }
  return {
    rig,
    prev,
    frame(dt: number, key: string, V: { slice: { layers: { z: number; h: number; rOut: number; rIn: number }[] }; layer: { z: number; h: number; rOut: number }; path: Parameters<typeof prev.set>[0] }, index: number, lapse = 8) {
      if (key !== st.key) {
        st.key = key
        st.t = 0
        st.n = rig.layLayer(V.path, V.layer.z, V.layer.h)
        prev.set(V.path)
        prev.fit(V.layer.rOut)
        st.mm = pathMm(V.path.slice(0, st.n))
        rig.stack.set(V.slice.layers, index, 'round', shade)
      }
      st.t = (st.t + dt / lapse) % 1.25
      const at = toolpathAt(V.path.slice(0, st.n), Math.min(1, st.t) * st.mm)
      const shown = st.t >= 1 ? st.n : at.done
      rig.beads.show(shown)
      prev.show(shown)
      rig.nozzle.visible = st.t < 1
      rig.nozzleAt(at.x, at.y, V.layer.z + V.layer.h)
      prev.dotAt(st.t < 1 ? at : null)
      return st.t >= 1
    },
  }
}

export const slicingWallsAndPerimeters: Lesson = {
  id: 'slicing-walls-and-perimeters',
  title: 'Walls and perimeters',
  tagline: 'Outlines first, then fill the inside',
  formula: (p) => {
    const V = wpRun(p)
    return `walls that fit = ring width / (2 × line width) → ${V.fit.m} of ${n(p, 'walls')} · wall path this layer ${fixedText(V.wallMm / 1000, 2)} m · print ${minText(V.slice.total)} · side-load stiffness ${pct(V.stiff)} of solid (typical)`
  },
  legend: segLegend(['outer', 'inner', 'gap', 'skin', 'infill']),
  points: [
    'Each layer starts with walls (perimeters): loops traced around the outline and around every hole, here the 5 mm shaft bore. The outermost loop is the surface you see; the rest stack inward one line width (0.45 mm) apart.',
    'Walls carry most of the load, since bending and twisting stress is highest at the surface. Going from 2 to 4 walls is the cheapest strength upgrade for a robot part, far better than more infill; Strength › Wall count vs infill compares them.',
    'Outer wall first prints the visible loop onto nothing, so the outside is dimensionally accurate (good for bearing seats and press fits) but overhangs droop more. Inner first gives the outer loop something to lean on: better overhangs, slightly less accurate size.',
    'Inside the walls come solid skins where the layer is a top or bottom surface (the shelf of the flange, the first and last 3 layers) and sparse infill elsewhere.',
    'A feature too thin for another pair of walls leaves a sliver: the slicer fills it with one narrow gap-fill line. Near the top of the dome there is room for fewer walls. Make thin ribs a whole number of line widths (0.9, 1.35 mm…) to avoid it.',
  ],
  controls: [
    { kind: 'slider', key: 'walls', label: 'Wall count', min: 1, max: 6, step: 1, initial: 3, format: (v) => `${v}` },
    { kind: 'slider', key: 'z', label: 'Layer at', min: 0.2, max: Math.floor((HUB_H - 0.2) * 5) / 5, step: 0.2, initial: 12, format: (v) => mmFixed(v, 1) },
    { kind: 'choice', key: 'order', options: opts(ORDERS), initial: 'outer' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const L = layerScene(scene)
    const rows = textRows(scene, 4, 1.6, 3.4, 0.3, 0.72)
    const tag = liveLabel(scene, [PREVIEW.at[0], PREVIEW.at[1] + PREVIEW.size / 2 + 0.9, 0.3], { size: 0.3 })
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const V = wpRun(p)
        const walls = n(p, 'walls')
        L.frame(dt, `${p.walls} ${p.z} ${p.order}`, V, V.index)
        L.rig.setShell(V.shape.profile)
        tag.set(`layer ${V.index + 1} at ${mmFixed(V.layer.z, 1)}, seen from above`, LABEL)
        const short = V.fit.m < walls
        rows[0].set(`${V.fit.m} of ${walls} walls fit${V.fit.gap ? ' + gap fill' : ''} at radius ${mmFixed(V.layer.rOut, 1)}`, short ? HEAT : POWER)
        rows[1].set(`print ${minText(V.slice.total)} · side-load stiffness ${pct(V.stiff)} (typical)`, LABEL)
        const t2 = V.sweep[1]
        rows[2].set(`vs 2 walls: time ×${fixedText(V.slice.total / t2.time, 2)}, stiffness ×${fixedText(V.stiff / t2.stiff, 2)}`, RING)
        rows[3].set(p.order === 'inner' ? 'inner first: outer loop leans on them, better overhangs' : 'outer first: accurate outside, overhangs droop more', GREY)
        head.status.set(`Walls and perimeters · ${walls} walls`)
        head.sub.set(`wheel hub · 0.45 mm lines, 0.2 mm layers, 20 % infill`, GREY)
        head.event.set(V.fit.gap ? 'too thin for another pair of walls: gap fill' : V.layer.rCore < V.layer.rOut - walls * 0.45 - 0.2 ? 'top/bottom surface here: solid skin inside the walls' : 'walls, then sparse infill', V.fit.gap ? SEG_COLORS.gap : LABEL)
      },
      readouts: (p) => {
        const V = wpRun(p)
        return [
          { label: 'Walls fitted', value: `${V.fit.m} of ${n(p, 'walls')}`, tone: V.fit.m < n(p, 'walls') ? 'warn' : 'ok' },
          { label: 'Print time', value: minText(V.slice.total) },
          { label: 'Stiffness', value: pct(V.stiff) },
        ]
      },
    }
  },
}

// --- Infill patterns: grid, gyroid, honeycomb, lines, cubic at 0–100 %. ---

const ifRun = memoBy((p: Params) => `${p.pattern} ${p.infill}`, (p: Params) => infillView(pick(INFILL_PATTERNS, p.pattern, 'gyroid') as InfillPattern, n(p, 'infill') / 100))
const ifFull = memoBy((p: Params) => `${p.pattern}`, (p: Params) => infillView(pick(INFILL_PATTERNS, p.pattern, 'gyroid') as InfillPattern, 1))

export const slicingInfillPatterns: Lesson = {
  id: 'slicing-infill-patterns',
  title: 'Infill patterns',
  tagline: 'A lattice inside: stiffness per gram and per minute',
  formula: (p) => {
    const V = ifRun(p)
    return `infill line spacing = line width / density · stiffness ≈ k × density^e per axis → X ${pct(V.xyz[0])}, Y ${pct(V.xyz[1])}, Z ${pct(V.xyz[2])} of solid · part ${pct(V.part)} · ${fixedText(V.slice.grams, 1)} g, ${minText(V.slice.total)} (typical)`
  },
  legend: segLegend(['outer', 'inner', 'skin', 'infill']),
  points: [
    'Infill is the sparse lattice inside the walls. Density sets the line spacing (line width ÷ density), so plastic and infill time grow straight with it, while the part gets only a little stiffer, because the walls already carry most of the load.',
    'Lines and grid are fast and simple; grid stacks the same lines every layer, making vertical walls that are stiff in Z, and its crossings can catch the nozzle. Honeycomb is very stiff in Z but slow (many turns) and weak sideways.',
    'Cubic and gyroid change with height, so they are about equally stiff in every direction. Gyroid is a smooth wavy surface: no crossings, good for any load, a common default for functional robot parts. It prints a bit slower than straight lines.',
    'Why 15–25 %: below about 10 % the top skin sags between infill lines (pillowing); above 30 % you pay plastic and time for little stiffness. For strength, add walls first (Walls and perimeters, Strength › Wall count vs infill).',
  ],
  controls: [
    { kind: 'choice', key: 'pattern', options: opts(namesOf(INFILL_PATTERNS)), initial: 'gyroid' },
    { kind: 'slider', key: 'infill', label: 'Density', min: 0, max: 100, step: 5, initial: 20, format: (v) => `${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const L = layerScene(scene)
    L.rig.setShell(hubShape().profile)
    const rows = textRows(scene, 2, 1.6, 3.4, 0.3, 0.72)
    addLabel(scene, 'infill stiffness per axis (red = weak axis)', [1.6, 1.6, 0.3], GREY, 0.26, 'left')
    const bars = countBars(scene, [5.4, 0.8, 0], ['X', 'Y', 'Z'], 7, { row: 0.62, size: 0.28 })
    const cost = countBars(scene, [5.4, -1.3, 0], ['Plastic', 'Print time'], 7, { row: 0.62, size: 0.28 })
    const tag = liveLabel(scene, [PREVIEW.at[0], PREVIEW.at[1] + PREVIEW.size / 2 + 0.5, 0.3], { size: 0.28 })
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const V = ifRun(p)
        const F = ifFull(p)
        const d = n(p, 'infill') / 100
        L.frame(dt, `${p.pattern} ${p.infill}`, V, V.index, 7)
        const pat = INFILL_PATTERNS[pick(INFILL_PATTERNS, p.pattern, 'gyroid') as InfillPattern]
        tag.set(`flange layer ${V.index + 1}, seen from above`, LABEL)
        const fg = V.slice.grams / F.slice.grams
        const ft = V.slice.total / F.slice.total
        const top = Math.max(1e-6, ...V.xyz)
        bars.set(V.xyz, V.xyz.map((x) => `${pct(x)} of solid`), V.xyz.map((x) => (x > 0.8 * top ? POWER : x > 0.4 * top ? RING : HIGH_V)), Math.max(0.05, 0.6 * d))
        cost.set([fg, ft], [`${fixedText(V.slice.grams, 1)} g`, minText(V.slice.total)], [HEAT, HEAT], 1)
        rows[0].set(`${pat.name} ${pct(d)} · part side-load stiffness ${pct(V.part)} of solid`, LABEL)
        const pillow = d > 0 && d < 0.1
        rows[1].set(d === 0 ? 'hollow: nothing holds up the top skin' : pillow ? 'below ~10 %: top skin sags (pillowing)' : d > 0.3 ? 'past ~30 %: plastic and time for little gain' : '15–25 %: the usual sweet spot', d === 0 || pillow ? HIGH_V : d > 0.3 ? RING : POWER)
        head.status.set(`Infill patterns · ${pat.name} ${pct(d)}`)
        head.sub.set('wheel hub · 3 walls, 0.2 mm layers · stiffness relative to solid, typical', GREY)
        head.event.set('plastic and time bars: full = 100 % infill', GREY)
      },
      readouts: (p) => {
        const V = ifRun(p)
        return [
          { label: 'Plastic', value: `${fixedText(V.slice.grams, 1)} g` },
          { label: 'Print time', value: minText(V.slice.total) },
          { label: 'Weakest axis', value: pct(Math.min(...V.xyz)) },
        ]
      },
    }
  },
}

// --- Supports: overhang threshold, normal vs tree, interface gap. ---

const ORIENT = { down: 'Flange down', up: 'Flange up' }
const spRun = memoBy((p: Params) => `${p.orient} ${p.chamfer} ${p.limit} ${p.kind} ${p.gap}`, (p: Params) =>
  supportView(pick(ORIENT, p.orient, 'up') as Orientation, n(p, 'chamfer'), n(p, 'limit'), pick(SUPPORT_KINDS, p.kind, 'normal') as SupportKind, n(p, 'gap')),
)

export const slicingSupports: Lesson = {
  id: 'slicing-supports',
  title: 'Supports',
  tagline: 'Scaffolding under overhangs, and what it costs',
  formula: (p) => {
    const V = spRun(p)
    return `support where overhang from vertical > ${degText(n(p, 'limit'), 0)} → ${Math.round(V.area)} mm² · support ${fixedText(V.grams, 1)} g, +${minText(V.minutes * 60)} on a ${fixedText(V.partGrams, 1)} g, ${minText(V.partMinutes * 60)} part (typical)`
  },
  legend: [
    { color: FILAMENT_COLOR, label: 'Prints fine', shape: 'dot' },
    { color: HIGH_V, label: 'Overhang past the limit', shape: 'dot' },
    { color: '#c7ccd6', label: 'Support', shape: 'dot' },
  ],
  points: [
    'Each layer must sit on the one below. A wall leaning out up to about 45° from vertical is fine, since each bead overlaps the one under it by half. Beyond that the bead hangs in air and droops, so the slicer adds supports under faces past the overhang threshold.',
    'Orientation comes first: flange down, the hub needs no support at all. Flange up, the flange shelf is a flat ceiling (90°) and the domed cap meets the bed at a steep angle. A 45° chamfer under a shelf prints without support; Design for printing › Overhangs and Bridges go further.',
    'Normal supports are a grid of columns straight down; tree supports grow a few branches from the bed to tips under the part. Trees use less plastic, touch less of the part and come off easier, but slice slower and can wobble when tall.',
    'The interface gap (Z distance) leaves an air layer between support and part. Too small and the support welds on and tears the surface; too big and the supported face droops. 0.2 mm is a typical start for PLA. Either way the supported face is rougher: plan where the scars go.',
  ],
  controls: [
    { kind: 'choice', key: 'orient', options: opts(ORIENT), initial: 'up' },
    { kind: 'choice', key: 'kind', options: opts(namesOf(SUPPORT_KINDS)), initial: 'normal' },
    { kind: 'slider', key: 'limit', label: 'Overhang threshold', min: 30, max: 75, step: 5, initial: 45, format: (v) => degText(v, 0) },
    { kind: 'slider', key: 'chamfer', label: 'Chamfer under flange', min: 30, max: 90, step: 5, initial: 60, format: (v) => degText(v, 0) },
    { kind: 'slider', key: 'gap', label: 'Interface gap', min: 0.1, max: 0.4, step: 0.05, initial: 0.2, format: (v) => mmFixed(v, 2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const rig = slicerRig(scene, [-8.8, -9.2, 0], 0.4, { tilt: -0.14 })
    const bedMat = (rig.holder.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    Object.assign(bedMat, { transparent: true, opacity: 0.3, depthWrite: false })
    rig.beads.show(0)
    rig.nozzle.visible = false
    rig.shell.visible = false
    const k = 0.4
    const faces = add(rig.holder, new THREE.Group())
    const okMat = new THREE.MeshStandardMaterial({ color: FILAMENT_COLOR, roughness: 0.55, side: THREE.DoubleSide })
    const badMat = new THREE.MeshStandardMaterial({ color: HIGH_V, emissive: HIGH_V, emissiveIntensity: 0.25, roughness: 0.55, side: THREE.DoubleSide })
    const supMat = new THREE.MeshStandardMaterial({ color: '#c7ccd6', roughness: 0.8, transparent: true, opacity: 0.45, depthWrite: false })
    const MAXC = 900
    const cols = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), supMat, MAXC)
    cols.frustumCulled = false
    rig.holder.add(cols)
    const rods = Array.from({ length: 120 }, () => add(rig.holder, shadowlessRod(supMat)))
    const rows = textRows(scene, 3, 1.6, 3.4, 0.3, 0.72)
    const bars = countBars(scene, [6.6, -2.8, 0], ['Supported', 'Contact', 'Plastic', 'Time', 'Removal'], 7, { row: 0.9, size: 0.3 })
    addLabel(scene, 'support cost, share of the part', [1.6, -1.6, 0.3], GREY, 0.3, 'left')
    const M = new THREE.Matrix4()
    const st = { key: '' }
    const zOn = (f: { a: [number, number]; b: [number, number] }, r: number) => {
      const u = (r - f.a[0]) / (f.b[0] - f.a[0] || 1)
      return f.a[1] + (f.b[1] - f.a[1]) * u
    }
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const V = spRun(p)
        const key = `${p.orient} ${p.chamfer} ${p.limit} ${p.kind} ${p.gap}`
        if (key !== st.key) {
          st.key = key
          for (const m of [...faces.children]) {
            ;(m as THREE.Mesh).geometry.dispose()
            faces.remove(m)
          }
          for (const f of V.faces) faces.add(new THREE.Mesh(hubLathe([f.a, f.b], k, 64), f.needs ? badMat : okMat))
          const P = V.shape.profile
          const inner: [number, number][] = P.filter(([r]) => Math.abs(r - V.shape.boreR) < 1e-6)
          if (inner.length >= 2) faces.add(new THREE.Mesh(hubLathe(inner, k, 48), okMat))
          const need = V.faces.filter((f) => f.needs)
          const gap = n(p, 'gap')
          let c = 0
          let ri = 0
          const tree = p.kind === 'tree'
          for (const f of need) {
            const r0 = Math.min(f.a[0], f.b[0])
            const r1 = Math.max(f.a[0], f.b[0])
            if (!tree) {
              for (let r = r0 + 0.9; r < r1; r += 1.8) {
                const nA = Math.max(6, Math.round((Math.PI * 2 * r) / 1.8))
                for (let j = 0; j < nA && c < MAXC; j++) {
                  const a = (j / nA) * Math.PI * 2
                  const h = Math.max(0.05, zOn(f, r) - gap)
                  M.makeScale(0.5 * k, h * k, 0.5 * k).setPosition(r * Math.cos(a) * k, (h / 2) * k, -r * Math.sin(a) * k)
                  cols.setMatrixAt(c++, M)
                }
              }
            } else {
              const rm = (r0 + r1) / 2
              const nT = Math.max(4, Math.round((Math.PI * 2 * rm) / 9))
              for (let j = 0; j < nT && ri + 3 < rods.length; j++) {
                const a = (j / nT) * Math.PI * 2
                const P3 = (r: number, z: number): V3 => [r * Math.cos(a) * k, z * k, -r * Math.sin(a) * k]
                const zTop = Math.min(zOn(f, r0), zOn(f, r1)) - gap
                const fork = Math.max(0.3, zTop * 0.55)
                const base = P3(rm, 0)
                const knee = P3(rm, fork)
                stretchRod(rods[ri++], base, knee, 0.5 * k)
                for (const r of [r0 + (r1 - r0) * 0.2, r1 - (r1 - r0) * 0.2]) stretchRod(rods[ri++], knee, P3(r, zOn(f, r) - gap), 0.28 * k)
              }
            }
          }
          cols.count = c
          cols.instanceMatrix.needsUpdate = true
          rods.forEach((r, i) => (r.visible = i < ri))
        }
        const pg = V.partGrams
        bars.set(
          [V.area / 1500, V.contact / 1500, V.grams / pg, V.minutes / V.partMinutes, V.stuck],
          [`${Math.round(V.area)} mm²`, `${Math.round(V.contact)} mm²`, `${fixedText(V.grams, 1)} g`, `+${minText(V.minutes * 60)}`, V.area ? (V.stuck > 0.6 ? 'hard' : V.stuck > 0.2 ? 'firm' : 'easy') : 'none'],
          [HIGH_V, HEAT, HEAT, HEAT, V.stuck > 0.6 ? HIGH_V : POWER],
          1,
        )
        const none = V.area === 0
        rows[0].set(none ? 'no face leans past the threshold: no support' : `${V.faces.filter((f) => f.needs).length} faces past ${degText(n(p, 'limit'), 0)}: worst ${degText(Math.max(...V.faces.filter((f) => f.needs).map((f) => f.deg)), 0)}`, none ? POWER : HIGH_V)
        rows[1].set(none ? 'flange down: the part supports itself' : `supported face droops ~${mmFixed(V.droop, 2)} (typical)`, none ? POWER : LABEL)
        rows[2].set(p.kind === 'tree' ? 'tree: few branches, small contact, easy off' : 'normal: columns under the whole face', GREY)
        head.status.set(`Supports · ${ORIENT[p.orient === 'down' ? 'down' : 'up']} · ${SUPPORT_KINDS[p.kind === 'tree' ? 'tree' : 'normal'].name}`)
        head.sub.set(`wheel hub, chamfer ${degText(n(p, 'chamfer'), 0)} from vertical · gap ${mmFixed(n(p, 'gap'), 2)}`, GREY)
        head.event.set(none ? 'prints without supports' : `support: ${fixedText(V.grams, 1)} g wasted, scars on ${Math.round(V.contact)} mm²`, none ? POWER : HEAT)
      },
      readouts: (p) => {
        const V = spRun(p)
        return [
          { label: 'Support', value: `${fixedText(V.grams, 1)} g` },
          { label: 'Extra time', value: minText(V.minutes * 60) },
          { label: 'Scars', value: `${Math.round(V.contact)} mm²`, tone: toneOf(V.contact === 0, V.contact < 400) },
        ]
      },
    }
  },
}

// --- Seams: where each layer starts and stops. ---

const FORMS = { round: 'Wheel hub (round)', square: 'Motor block (square)' }
const WIPE = { off: 'No coasting/wipe', on: 'Coast + wipe' }
const smRun = memoBy((p: Params) => `${p.mode} ${p.form} ${p.wipe}`, (p: Params) =>
  seamView(pick(SEAM_MODES, p.mode, 'aligned') as SeamMode, pick(FORMS, p.form, 'round') as HubForm, p.wipe === 'on'),
)

export const slicingSeams: Lesson = {
  id: 'slicing-seams',
  title: 'Seams',
  tagline: 'Every layer starts somewhere, and leaves a mark',
  formula: (p) => {
    const V = smRun(p)
    return `zit ≈ ${mmFixed(V.zit, 2)} per layer start · ${V.slice.layers.length} layers · extra travel = Σ chord between starts = ${fixedText(V.travelMm / 1000, 2)} m ≈ ${fixedText(V.travelS, 1)} s (typical)`
  },
  legend: [
    { color: FILAMENT_COLOR, label: 'Outer wall, layer by layer', shape: 'dot' },
    { color: RING, label: 'Seam zits (layer starts)', shape: 'dot' },
  ],
  points: [
    'The outer wall is a closed loop, so the nozzle has to start and stop it somewhere. At that point a little extra plastic oozes (a zit) or a small gap is left. Every layer has one.',
    'Aligned puts every start at the same angle, so the zits stack into one straight seam line up the part. On a cylinder like the hub there is nowhere to hide it. Rear does the same at the back, out of sight.',
    'Random scatters the starts: no line, but pimples all over the surface and extra travel each layer. It suits parts where a line would look worse than texture.',
    'Sharpest corner tucks the start into a corner, where the eye does not see it: perfect on the square block, but a round part has no corner, so the seam lands on the open surface. Many slicers also let you paint the seam onto an edge.',
    'Coasting (stop extruding a little early) and wiping (move inward along the wall before lifting) shrink the zit. Pressure advance in Calibration helps too; Print problems covers blobs and stringing.',
  ],
  controls: [
    { kind: 'choice', key: 'form', options: opts(FORMS), initial: 'round' },
    { kind: 'choice', key: 'mode', options: opts(SEAM_MODES), initial: 'aligned' },
    { kind: 'choice', key: 'wipe', options: opts(WIPE), initial: 'off' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const rig = slicerRig(scene, [-9.8, -9.8, 0], 0.38, { tilt: 0.22, turn: -0.3 })
    rig.beads.show(0)
    rig.shell.visible = false
    const k = 0.38
    const MAXZ = 200
    const zits = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial({ color: RING, emissive: RING, emissiveIntensity: 0.5 }), MAXZ)
    zits.frustumCulled = false
    rig.holder.add(zits)
    const plotH = 7.4
    const plot = titledScope(scene, -6.6, plotH, 'seam on the unrolled outer wall', RING, 0, 9, 11.6)
    plot.lo.set('left side')
    plot.hi.set('right side')
    addLabel(plot.s.group, 'front', [0, plotH / 2 - 0.35, 0.4], GREY, 0.24)
    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: RING, emissive: RING, emissiveIntensity: 1 }), MAXZ)
    dots.frustumCulled = false
    plot.s.group.add(dots)
    const rows = textRows(scene, 4, 1.6, 3.4, 0.3, 0.72)
    const M = new THREE.Matrix4()
    const st = { t: 0, key: '' }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const V = smRun(p)
        const form = pick(FORMS, p.form, 'round') as HubForm
        const key = `${p.mode} ${p.form} ${p.wipe}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
        }
        st.t = (st.t + dt / 8) % 1.4
        const N = V.slice.layers.length
        const count = Math.round(Math.min(1, st.t) * N)
        rig.stack.set(V.slice.layers, count, form, shade)
        const zr = (V.zit / 0.2) * 0.22
        for (let i = 0; i < Math.min(MAXZ, N); i++) {
          const L = V.slice.layers[i]
          const a = V.angles[i]
          const sq = form === 'square'
          const rr = sq ? L.rOut / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) : L.rOut
          const s = i < count ? zr * k : 0
          M.makeScale(s, s * 0.8, s).setPosition(rr * Math.cos(a) * k, (L.z + L.h / 2) * k, -rr * Math.sin(a) * k)
          zits.setMatrixAt(i, M)
          const u = (((a + Math.PI / 2 + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI)
          M.makeScale(i < count ? 1 : 0, 1, 1).setPosition(plot.s.xAt(u), -plotH / 2 + ((L.z + L.h / 2) / V.shape.h) * plotH, 0.3)
          dots.setMatrixAt(i, M)
        }
        zits.count = dots.count = Math.min(MAXZ, N)
        zits.instanceMatrix.needsUpdate = dots.instanceMatrix.needsUpdate = true
        const top = V.slice.layers[Math.min(N - 1, count)]
        const a0 = V.angles[Math.min(N - 1, count)]
        rig.nozzle.visible = st.t < 1
        rig.nozzleAt(top.rOut * Math.cos(a0), top.rOut * Math.sin(a0), top.z + top.h)
        plot.right.set(V.line ? (V.hidden ? 'one line, hidden' : 'one straight line') : 'scattered', V.line && !V.hidden ? HEAT : POWER)
        const mode = pick(SEAM_MODES, p.mode, 'aligned') as SeamMode
        rows[0].set(`${N} layers → ${N} starts, zit ~${mmFixed(V.zit, 2)} each (typical)`, LABEL)
        rows[1].set(V.hidden ? (mode === 'rear' ? 'seam at the back, out of sight' : 'seam tucked into a corner: hidden') : V.line ? 'seam line on the open surface: visible' : 'pimples all over, no line', V.hidden ? POWER : V.line ? HEAT : RING)
        rows[2].set(`extra travel ${fixedText(V.travelMm / 1000, 2)} m, ${fixedText(V.travelS, 1)} s`, V.travelMm > 0 ? RING : GREY)
        rows[3].set(mode === 'sharpest' && form === 'round' ? 'round part: no corner to hide in' : p.wipe === 'on' ? 'coast + wipe: smaller zits' : 'no coasting: full-size zits', GREY)
        head.status.set(`Seams · ${SEAM_MODES[mode]} · ${FORMS[form]}`)
        head.sub.set('outer wall start of each 0.2 mm layer, zits drawn larger', GREY)
        head.event.set(st.t < 1 ? `layer ${count + 1} of ${N}` : 'done: look along the wall for the seam', LABEL)
      },
      readouts: (p) => {
        const V = smRun(p)
        return [
          { label: 'Seam', value: V.line ? (V.hidden ? 'hidden line' : 'visible line') : 'scattered', tone: V.hidden ? 'ok' : 'warn' },
          { label: 'Zit', value: mmFixed(V.zit, 2), tone: V.zit < 0.1 ? 'ok' : 'warn' },
          { label: 'Extra travel', value: `${fixedText(V.travelS, 1)} s` },
        ]
      },
    }
  },
}

