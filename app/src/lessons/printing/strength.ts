import * as THREE from 'three/webgpu'
import {
  ANNEAL,
  ANNEAL_MATS,
  ANNEAL_MAT_KEYS,
  ANNEAL_TIME_SWEEP,
  AnnealMat,
  FILAMENTS,
  INFILL_PATTERNS,
  InfillPattern,
  LINE_W,
  MATERIALS,
  SHELL_BAR,
  SHELL_RECIPES,
  WALL_SWEEP,
  WELD_MATS,
  WELD_MAT_KEYS,
  WELD_TIME_SWEEP,
  WeldMat,
  annealView,
  shellView,
  weldView,
} from '../../core/physics'
import { celsiusText, fixedText, mmFixed, pct, signed } from '../../core/units'
import { V3, add, box, mat } from '../../models/kit'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, PRINT_TINT, RING, Slab, WIDE_VIEW, addLabel, cursorBar, liveLabel, memoBy, printStage, shellMat, sliceSlabs, stressHex, stretchArrow } from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

// One board for all three: the printed part on the left (mm × k), rows top right, a plot bottom right, bars between.
function rig(scene: THREE.Object3D, at: V3, k: number, max: number, turn = -0.3, tilt = 0.12) {
  const g = add(scene, new THREE.Group(), at)
  g.rotation.set(tilt, turn, 0)
  return { g, slabs: sliceSlabs(g, [0, 0, 0], k, max) }
}

// --- Layer adhesion ---

const WELD_NAMES = Object.fromEntries(WELD_MAT_KEYS.map((m) => [m, FILAMENTS[m].name])) as Record<WeldMat, string>
const weldParams = (p: Params) => {
  const m = pick(WELD_NAMES, p.m, 'pla') as WeldMat
  return { m, dT: n(p, 'dT'), nozzle: FILAMENTS[m].nozzleC + n(p, 'dT'), fan: n(p, 'fan'), s: n(p, 'layer') }
}
const weldKey = (p: Params) => `${p.m} ${p.dT} ${p.fan} ${p.layer}`
const weldRun = memoBy(weldKey, (p: Params) => {
  const q = weldParams(p)
  return { q, V: weldView(q.m, q.nozzle, q.fan, q.s) }
})
const BAR = { k: 0.2, y: -10.8, len: 56, w: 10, d: 4, every: 2, cycle: 7 }

export const strengthLayerAdhesion: Lesson = {
  id: 'strength-layer-adhesion',
  title: 'Layer adhesion',
  tagline: 'Why parts break along layers',
  formula: (p) => {
    const { q, V } = weldRun(p)
    const c = V.cur
    return `new bead lands at ${celsiusText(c.lay)} on a layer at ${celsiusText(c.below)} → interface ${celsiusText(c.t0)}, above Tg ${celsiusText(FILAMENTS[q.m].tgC)} for ${fixedText(c.above, 2)} s · weld = (∫ dt / τ(T))^¼ = ${pct(c.weld)} · Z = ${pct(WELD_MATS[q.m].zMax)} × weld = ${pct(c.zFrac)} of XY, typical`
  },
  legend: [
    { color: POWER, label: 'Z strength / XY vs layer time (these settings)', shape: 'dot' },
    { color: RING, label: 'Your layer time', shape: 'dot' },
    { color: HIGH_V, label: 'Bar colour: load / its strength (red = breaks)', shape: 'dot' },
  ],
  points: [
    'Along a line the plastic is one continuous extrusion. Between layers it is two beads that touched for a moment: the new one lands hot, warms the surface below, and polymer chains wriggle across the boundary until the interface cools under the glass transition (Filaments > Glass transition temp). Whatever has diffused by then is the weld.',
    'Chain motion speeds up steeply with temperature, so the weld depends on how hot the interface gets and how long it stays above Tg: a hotter nozzle helps a little, a slower fan or a shorter layer time (the layer below is still warm) helps a lot. The layer-below temperature is the same story as Temperature & cooling > Part cooling fan.',
    'Pull two test bars: printed flat, the load runs along the lines and it breaks at the full strength; printed upright, every layer line is a weak plane across the load and it snaps cleanly between two layers at 30–90 % of that. PETG and nylon weld well, ASA/ABS less (and it cools fastest out of the enclosure).',
    'It is a trade: full fan and long layers give sharp overhangs (Design for printing > Overhangs and bridges) but weak Z. For load-bearing parts turn them so the load runs along the layers (Design for printing > Orientation and strength), print a bit hotter, cut the fan to 30–50 % and print several parts at once.',
  ],
  controls: [
    { kind: 'choice', key: 'm', options: opts(WELD_NAMES), initial: 'pla' },
    { kind: 'slider', key: 'dT', label: 'Nozzle vs usual', min: -10, max: 30, step: 5, initial: 0, format: (v) => `${signed(v, 0)} °C` },
    { kind: 'slider', key: 'fan', label: 'Part cooling fan', min: 0, max: 1, step: 0.1, initial: 1, format: pct },
    { kind: 'slider', key: 'layer', label: 'Layer time', min: 2, max: 30, step: 1, initial: 10, format: (v) => `${v} s` },
  ],
  build(): Stage {
    const c = printStage('Z strength / XY vs layer time', `${WELD_TIME_SWEEP[0]} s`, `${WELD_TIME_SWEEP[WELD_TIME_SWEEP.length - 1]} s`, { title: 'Z / XY per material (these settings)', names: WELD_MAT_KEYS.map((m) => FILAMENTS[m].name) })
    const { scene, head, rows, plot, tally } = c
    const { k, y: by, len, w, d, every, cycle } = BAR
    const gripM = mat('#2e323a', { rough: 0.7 })
    const bar = (x: number, title: string) => {
      const g = add(scene, new THREE.Group(), [x, by, 0])
      g.rotation.set(0.08, -0.35, 0)
      box(g, [w * k * 1.9, 1.5, d * k * 3], gripM, [0, -0.75, 0])
      const top = add(g, new THREE.Group())
      box(top, [w * k * 1.9, 1.5, d * k * 3], gripM, [0, len * k + 0.75, 0])
      const lower = sliceSlabs(g, [0, 0, 0], k, 80)
      const upper = sliceSlabs(top, [0, 0, 0], k, 80)
      const pull = stretchArrow(scene, HIGH_V, 0.1)
      addLabel(scene, title, [x, -13.2, 0.5], LABEL, 0.32)
      const tag = liveLabel(scene, [x, -14, 0.5], { size: 0.3 })
      return { g, top, lower, upper, pull, tag, x }
    }
    const up = bar(-13.4, 'Upright: layers across the pull')
    const flat = bar(-5.2, 'Flat: lines along the pull')
    const S = plot.s
    const tr = S.trace(POWER, { samples: WELD_TIME_SWEEP.length, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const py = c.py(0, 1)
    const t0 = WELD_TIME_SWEEP[0]
    const span = WELD_TIME_SWEEP[WELD_TIME_SWEEP.length - 1] - t0
    const half = len / 2
    let t = 0
    let key = ''
    const fill = (layers: boolean, colorOf: (y: number) => string, y0: number, y1: number): Slab[] => {
      const out: Slab[] = []
      if (layers) for (let y = y0; y < y1 - 1e-6; y += every) out.push({ x0: -w / 2, x1: w / 2, y0: y, y1: y + every * 0.86, z0: -d / 2, z1: d / 2, color: colorOf(y) })
      else for (let x = -w / 2; x < w / 2 - 1e-6; x += w / 8) out.push({ x0: x, x1: x + (w / 8) * 0.86, y0, y1, z0: -d / 2, z1: d / 2, color: colorOf(y0) })
      return out
    }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = weldRun(p)
        if (key !== weldKey(p)) {
          key = weldKey(p)
          t = 0
        }
        t = (t + dt) % cycle
        const F = V.flatN * 1.1 * Math.min(1, t / (cycle - 1.5))
        for (const [b, strong, layers] of [[up, V.uprightN, true], [flat, V.flatN, false]] as const) {
          const broke = F >= strong
          const gap = broke ? Math.min(3, (F - strong) / (V.flatN * 0.02) + 1.5) : 0
          const tint = stressHex(broke ? 1 : F / strong)
          b.lower.set(fill(layers, () => tint, 0, half))
          b.upper.set(fill(layers, () => tint, half, len))
          b.top.position.y = gap * k
          const tipY = by + (len + gap) * k + 1.6
          b.pull([b.x, tipY, 0], [b.x, tipY + 0.6 + 1.6 * Math.min(1, F / V.flatN), 0])
          b.tag.set(broke ? `broke at ${Math.round(strong)} N` : `${Math.round(F)} of ${Math.round(strong)} N`, broke ? HIGH_V : F / strong > 0.5 ? RING : POWER)
        }
        tr.points(WELD_TIME_SWEEP.map((s) => (s - t0) / span), V.curve.map(py), null)
        cur((q.s - t0) / span)
        plot.right.set(`${q.s} s: ${pct(V.cur.zFrac)}`, RING)
        tally?.set(V.mats, V.mats.map(pct), WELD_MAT_KEYS.map((m) => (m === q.m ? RING : GREY)), 1)
        const cw = V.cur
        rows[0].set(`Bead lands at ${celsiusText(cw.lay)} on a layer at ${celsiusText(cw.below)}`, cw.below > FILAMENTS[q.m].tgC ? POWER : LABEL)
        rows[1].set(`Interface above Tg for ${fixedText(cw.above, 2)} s: weld ${pct(cw.weld)}`, cw.weld > 0.8 ? POWER : cw.weld > 0.5 ? RING : HEAT)
        rows[2].set(`Upright bar: ${pct(cw.zFrac)} of the flat bar, typical`, cw.zFrac > 0.7 ? POWER : cw.zFrac > 0.45 ? RING : HIGH_V)
        head.status.set(`${FILAMENTS[q.m].name} at ${celsiusText(q.nozzle)} · fan ${pct(q.fan)} · ${q.s} s layers`)
        head.sub.set(`tensile bars ${w} × ${d} mm, pulled to ${Math.round(V.flatN * 1.1)} N; layers drawn ${every / 0.2}× thick`, GREY)
        head.event.set(F >= V.uprightN ? 'upright bar split between two layers' : 'pulling...', F >= V.uprightN ? HIGH_V : LABEL)
      },
      readouts: (p) => {
        const { V } = weldRun(p)
        const cw = V.cur
        return [
          { label: 'Interface', value: celsiusText(cw.t0), tone: toneOf(cw.above > 1.5, cw.above > 0.8) },
          { label: 'Above Tg', value: `${fixedText(cw.above, 2)} s` },
          { label: 'Z / XY', value: pct(cw.zFrac), tone: toneOf(cw.zFrac > 0.7, cw.zFrac > 0.45) },
          { label: 'Upright breaks', value: `${Math.round(V.uprightN)} N` },
        ]
      },
    }
  },
}

// --- Wall count vs infill ---

const PATTERN_NAMES = Object.fromEntries(Object.entries(INFILL_PATTERNS).map(([key, v]) => [key, v.name])) as Record<InfillPattern, string>
const shellParams = (p: Params) => ({ walls: n(p, 'walls'), infill: n(p, 'infill'), pattern: pick(PATTERN_NAMES, p.pat, 'grid') as InfillPattern, F: n(p, 'load') })
const shellKey = (p: Params) => `${p.walls} ${p.infill} ${p.pat} ${p.load}`
const shellRun = memoBy(shellKey, (p: Params) => {
  const q = shellParams(p)
  return { q, V: shellView(q.walls, q.infill, q.pattern, q.F) }
})
const SEC = { k: 0.5, depth: 26, sideSegs: 8 }

function sectionSlabs(walls: number, infill: number, ratio: number, depth: number): Slab[] {
  const { W, H } = SHELL_BAR
  const lw = LINE_W
  const out: Slab[] = []
  const z0 = -depth
  const tint = (y: number) => stressHex((ratio * Math.abs(y)) / (H / 2))
  const m = Math.min(walls, Math.floor(H / 2 / lw))
  for (let i = 0; i < m; i++) {
    const a = i * lw
    const th = lw * 0.82
    out.push({ x0: -W / 2 + a, x1: W / 2 - a, y0: H / 2 - a - th, y1: H / 2 - a, z0, z1: 0, color: tint(H / 2 - a) })
    out.push({ x0: -W / 2 + a, x1: W / 2 - a, y0: -H / 2 + a, y1: -H / 2 + a + th, z0, z1: 0, color: tint(H / 2 - a) })
    const ys = H - 2 * a - 2 * lw
    if (ys <= 0) continue
    for (let j = 0; j < SEC.sideSegs; j++) {
      const y0 = -H / 2 + a + lw + (ys * j) / SEC.sideSegs
      const y1 = y0 + ys / SEC.sideSegs
      for (const x of [-W / 2 + a, W / 2 - a - th]) out.push({ x0: x, x1: x + th, y0, y1, z0, z1: 0, color: tint((y0 + y1) / 2) })
    }
  }
  const t = m * lw
  if (infill > 0 && t < H / 2) {
    const s = (2 * lw) / infill
    const th = lw * 0.7
    const dim = (y: number) => stressHex((0.35 * ratio * Math.abs(y)) / (H / 2))
    for (let x = -W / 2 + t + s / 2; x < W / 2 - t; x += s) out.push({ x0: x - th / 2, x1: x + th / 2, y0: -H / 2 + t, y1: H / 2 - t, z0: z0 + 0.4, z1: -0.4, color: dim(0) })
    for (let y = -H / 2 + t + s / 2; y < H / 2 - t; y += s) out.push({ x0: -W / 2 + t, x1: W / 2 - t, y0: y - th / 2, y1: y + th / 2, z0: z0 + 0.4, z1: -0.4, color: dim(y) })
  }
  return out
}

export const strengthWallCountVsInfill: Lesson = {
  id: 'strength-wall-count-vs-infill',
  title: 'Wall count vs infill',
  tagline: 'Strength lives in the skin',
  formula: (p) => {
    const { q, V } = shellRun(p)
    const s = V.cur
    return `I = I(shell ${mmFixed(s.t, 2)}) + ${fixedText(s.e, 2)} × I(core) = ${pct(s.bend)} of solid for ${pct(s.mass)} of the plastic · σ = (F L / 4) c / I = ${fixedText(V.sigma / 1e6, 1)} MPa → SF ${fixedText(V.sf, 2)} (PLA ${fixedText(MATERIALS.pla.utsPa / 1e6, 0)} MPa) · ${V.patternName} ${pct(q.infill)}, typical`
  },
  legend: [
    { color: POWER, label: 'Adding walls (1 to 13) at this infill', shape: 'dot' },
    { color: HEAT, label: 'Adding infill (0 to 100 %) at these walls', shape: 'dot' },
    { color: RING, label: 'This bar (dot on both paths)', shape: 'dot' },
    { color: HIGH_V, label: 'Section colour: stress / strength', shape: 'dot' },
  ],
  points: [
    'Bend a bar and the top fibres squash while the bottom ones stretch; the middle hardly works. Stress grows with distance from the neutral axis and stiffness with distance squared (Materials > Stress & strain), which is why an I-beam puts its metal in the flanges.',
    'A print is already built that way: walls and top/bottom layers form a solid skin, infill is a sparse core. Each extra wall adds plastic exactly where the stress is, so it raises strength and stiffness far more per gram than more infill, which adds plastic near the middle and is only 5–30 % as stiff as solid (Slicing > Infill patterns).',
    'Twisting loves walls even more: a closed tube carries torsion with its skin, so shafts and arms want 4–6 walls. Infill earns its keep in compression and local loads: it holds the skin up under a clamped screw or a heat-set insert and stops thin top skins sagging (Slicing > Walls and perimeters).',
    'Rule of thumb for robot parts: 3–5 walls (top/bottom layers to match), 15–30 % gyroid or cubic, add walls around holes and at corners. Then check the orientation (Layer adhesion, Design for printing > Orientation and strength).',
  ],
  controls: [
    { kind: 'slider', key: 'walls', label: 'Walls', min: 1, max: 10, step: 1, initial: 2, format: (v) => `${v}` },
    { kind: 'slider', key: 'infill', label: 'Infill density', min: 0, max: 1, step: 0.05, initial: 0.2, format: pct },
    { kind: 'choice', key: 'pat', options: opts(PATTERN_NAMES), initial: 'grid' },
    { kind: 'slider', key: 'load', label: 'Load at mid-span', min: 50, max: 600, step: 25, initial: 250, format: (v) => `${v} N` },
  ],
  build(): Stage {
    const c = printStage('strength vs plastic used', '0 %', '100 % plastic', { title: 'Strength per gram (solid = 1)', names: SHELL_RECIPES.map((r) => r.name) })
    const { scene, head, rows, plot, tally } = c
    const { k, depth } = SEC
    const { W, H, L } = SHELL_BAR
    const r = rig(scene, [-10.4, -8, 0], k, 700, -0.42, 0.3)
    const steel = mat('#5c6370', { rough: 0.5, metal: 0.4 })
    for (const z of [-depth + 3, -3]) box(r.g, [W * k * 1.3, 0.5, 0.5], steel, [0, (-H / 2) * k - 0.3, z * k])
    const load = stretchArrow(r.g, HIGH_V, 0.12)
    load([0, (H / 2 + 9) * k, (-depth / 2) * k], [0, (H / 2 + 0.6) * k, (-depth / 2) * k])
    const fTag = liveLabel(r.g, [0.6, (H / 2 + 6) * k, (-depth / 2) * k], { size: 0.34, align: 'left' })
    const sTag = liveLabel(scene, [-10.4, -12.8, 0.5], { size: 0.32 })
    const S = plot.s
    const wTr = S.trace(POWER, { samples: 12, radius: 0.06 })
    const iTr = S.trace(HEAT, { samples: 24, radius: 0.06 })
    const py = c.py(0, 1)
    let key = ''
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { q, V } = shellRun(p)
        const s = V.cur
        if (key !== shellKey(p)) {
          key = shellKey(p)
          r.slabs.set(sectionSlabs(q.walls, q.infill, 1 / V.sf, depth))
        }
        const wi = WALL_SWEEP.indexOf(q.walls)
        wTr.points(V.byWalls.map((b) => b.mass), V.byWalls.map((b) => py(b.bend)), wi >= 0 ? wi : null)
        iTr.points(V.byInfill.map((b) => b.mass), V.byInfill.map((b) => py(b.bend)), Math.round(q.infill * 20))
        plot.right.set(`${pct(s.bend)} for ${pct(s.mass)}`, RING)
        tally?.set(V.recipes.map((b) => b.perGram), V.recipes.map((b) => fixedText(b.perGram, 2)), SHELL_RECIPES.map((rc) => (rc.walls === q.walls && rc.infill === q.infill ? RING : GREY)))
        fTag.set(`${q.F} N`, HIGH_V)
        sTag.set(`${W} × ${H} mm bar, ${L} mm span: ${q.walls} walls = ${mmFixed(s.t, 2)} skin`, LABEL)
        rows[0].set(`Skin stress ${fixedText(V.sigma / 1e6, 1)} of ${fixedText(MATERIALS.pla.utsPa / 1e6, 0)} MPa: SF ${fixedText(V.sf, 2)}`, V.sf >= 2 ? POWER : V.sf >= 1 ? RING : HIGH_V)
        rows[1].set(`${fixedText(V.grams, 1)} g: ${pct(s.bend)} as strong as solid, ${fixedText(s.perGram, 2)} per gram`, s.perGram >= 1.2 ? POWER : LABEL)
        rows[2].set(`Twist stiffness ${pct(s.twist)} of solid · infill core ${pct(s.e)} as stiff`, LABEL)
        head.status.set(`PLA bar · ${q.walls} walls · ${V.patternName.toLowerCase()} ${pct(q.infill)}`)
        head.sub.set(`3-point bend, ${q.F} N at mid-span; walls and top/bottom skin to match`, GREY)
        head.event.set(V.sf < 1 ? 'breaks at the skin' : V.sf < 2 ? 'holds, little margin' : 'strong enough', V.sf < 1 ? HIGH_V : V.sf < 2 ? RING : POWER)
      },
      readouts: (p) => {
        const { V } = shellRun(p)
        const s = V.cur
        return [
          { label: 'Strength', value: pct(s.bend) },
          { label: 'Plastic', value: `${fixedText(V.grams, 1)} g` },
          { label: 'Per gram', value: fixedText(s.perGram, 2), tone: toneOf(s.perGram >= 1.2, s.perGram >= 0.9) },
          { label: 'Safety factor', value: fixedText(V.sf, 2), tone: toneOf(V.sf >= 2, V.sf >= 1) },
        ]
      },
    }
  },
}

// --- Annealing ---

const ANNEAL_NAMES = Object.fromEntries(ANNEAL_MAT_KEYS.map((m) => [m, FILAMENTS[m].name])) as Record<AnnealMat, string>
const annParams = (p: Params) => ({ m: pick(ANNEAL_NAMES, p.m, 'pla') as AnnealMat, c: n(p, 'oven'), min: n(p, 'min') })
const annKey = (p: Params) => `${p.m} ${p.oven} ${p.min}`
const annRun = memoBy(annKey, (p: Params) => {
  const q = annParams(p)
  return { q, V: annealView(q.m, q.c, q.min) }
})
const ANN = { k: 0.27, ex: 5, cols: 12, layers: 8 }
const CRYSTAL = '#eeeae0'

export const strengthAnnealing: Lesson = {
  id: 'strength-annealing',
  title: 'Annealing',
  tagline: 'Bake it above Tg so it crystallises',
  formula: (p) => {
    const { q, V } = annRun(p)
    const a = V.cur
    const f = FILAMENTS[q.m]
    return `crystallised = 1 − exp(−ln 2 (t / t½)^${ANNEAL.avrami}) = ${pct(a.done)} of ${pct(ANNEAL_MATS[q.m].xMax)} · HDT ${celsiusText(f.hdtC)} → ${celsiusText(a.hdt)} · size XY ${signed(a.xy * 100, 1)} %, Z ${signed(a.z * 100, 1)} % → scale the CAD XY × ${fixedText(a.scaleXY, 3)}, Z × ${fixedText(a.scaleZ, 3)}, typical`
  },
  legend: [
    { color: POWER, label: 'Heat deflection temp vs time in the oven', shape: 'dot' },
    { color: RING, label: 'Your bake time', shape: 'dot' },
    { color: HIGH_V, label: 'Hot car dashboard, about 80 °C', shape: 'dot' },
    { color: GREY, label: 'Outline: the part before (changes drawn 5×)', shape: 'dot' },
  ],
  points: [
    'Printed PLA is frozen almost amorphous: the lines cool too fast for the chains to fold into crystals. Above Tg (Filaments > Glass transition temp) but well under melting, they have time to line up. Bake a PLA part at 80–100 °C for 30–60 min and it turns cloudy and crystallises.',
    'The payoff is heat: a plain PLA bracket softens at about 55 °C (a car in summer), annealed it holds shape past 100 °C. It also gets a little stiffer, and the layers weld a bit more (Layer adhesion).',
    'The price is size. Crystals pack tighter, and the lines were laid down stretched, so the part shrinks along the lines (XY, a few %) and grows in Z. Thin or long parts bow and warp. Measure a test cube, then scale the CAD to pre-compensate, and bake big parts packed in salt or sand so they keep their shape.',
    'It only works on plastics that can crystallise. PETG and ASA are amorphous: above Tg they just slump without gaining anything (anneal them below Tg only to relieve stress). Nylon already prints partly crystalline and gains more heat resistance; “high-temp” PLA blends are made to anneal with less shrink.',
  ],
  controls: [
    { kind: 'choice', key: 'm', options: opts(ANNEAL_NAMES), initial: 'pla' },
    { kind: 'slider', key: 'oven', label: 'Oven temperature', min: 50, max: 130, step: 5, initial: 90, format: (v) => celsiusText(v) },
    { kind: 'slider', key: 'min', label: 'Time in the oven', min: 0, max: 120, step: 5, initial: 45, format: (v) => `${v} min` },
  ],
  build(): Stage {
    const top = ANNEAL_TIME_SWEEP[ANNEAL_TIME_SWEEP.length - 1]
    const c = printStage('heat deflection temp vs bake time', '0 min', `${top} min`, { title: 'Heat deflection after this bake', names: ANNEAL_MAT_KEYS.map((m) => FILAMENTS[m].name) })
    const { scene, head, rows, plot, tally } = c
    const { k, ex, cols, layers } = ANN
    const { L, W, H } = ANNEAL.block
    const r = rig(scene, [-9.2, -7.4, 0], k, cols * layers + 4, -0.32, 0.3)
    box(r.g, [(L + 16) * k, 0.25, (W + 14) * k], mat('#4a4f58', { rough: 0.5, metal: 0.4 }), [0, -0.15, 0])
    const ghost = new THREE.Mesh(new THREE.BoxGeometry(L * k, H * k, W * k), shellMat(GREY, 0.28))
    add(r.g, ghost, [0, (H / 2) * k, 0])
    const ovenTag = liveLabel(scene, [-9.6, -12.6, 0.5], { size: 0.32 })
    const S = plot.s
    const tr = S.trace(POWER, { samples: ANNEAL_TIME_SWEEP.length, radius: 0.06 })
    const cur = cursorBar(S, RING, 0.06)
    const car = S.level(HIGH_V)
    const [lo, hi] = [40, 160]
    const py = c.py(lo, hi)
    const tint = new THREE.Color()
    let key = ''
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { q, V } = annRun(p)
        const a = V.cur
        if (key !== annKey(p)) {
          key = annKey(p)
          const squash = Math.min(0.45, (a.slump * ex * 0.15) / H)
          const sx = (1 + ex * a.xy) * (1 + squash * 0.6)
          const sz = (1 + ex * a.z) * (1 - squash)
          const color = `#${tint.set(PRINT_TINT).lerp(new THREE.Color(CRYSTAL), a.done).getHexString()}`
          const slabs: Slab[] = []
          const cw = (L * sx) / cols
          const lh = (H * sz) / layers
          for (let j = 0; j < cols; j++) {
            const u = (j + 0.5) / cols
            const lift = Math.min(6, (a.warp - a.slump) * ex) * (2 * u - 1) ** 2
            const x0 = -(L * sx) / 2 + j * cw
            for (let i = 0; i < layers; i++) slabs.push({ x0, x1: x0 + cw * 0.97, y0: lift + i * lh, y1: lift + (i + 0.88) * lh, z0: (-W * sx) / 2, z1: (W * sx) / 2, color })
          }
          r.slabs.set(slabs)
        }
        tr.points(ANNEAL_TIME_SWEEP.map((t) => t / top), V.hdtCurve.map((h) => py(Math.min(hi, h))), null)
        cur(q.min / top)
        car.set(py(80))
        plot.right.set(`${q.min} min: ${celsiusText(a.hdt)}`, RING)
        tally?.set(V.mats.map((m) => m.hdt), V.mats.map((m) => celsiusText(m.hdt)), ANNEAL_MAT_KEYS.map((m) => (m === q.m ? RING : GREY)), hi)
        ovenTag.set(`${L} × ${W} × ${H} mm block, ${celsiusText(q.c)} for ${q.min} min`, LABEL)
        const f = FILAMENTS[q.m]
        rows[0].set(`Crystallised ${pct(a.done)} · heat deflection ${celsiusText(f.hdtC)} → ${celsiusText(a.hdt)}`, a.hdt > 80 ? POWER : LABEL)
        rows[1].set(`Stiffness × ${fixedText(a.stiff, 2)}, Z strength × ${fixedText(a.zGain, 2)}, typical`, LABEL)
        rows[2].set(`Size XY ${signed(a.xy * 100, 1)} %, Z ${signed(a.z * 100, 1)} % · warp ${mmFixed(a.warp, 1)}`, a.warp > 1 ? HIGH_V : a.warp > 0.3 ? RING : POWER)
        head.status.set(`${f.name} · ${celsiusText(q.c)} · ${q.min} min`)
        head.sub.set(`Tg ${celsiusText(f.tgC)}; size change and warp drawn ${ex}×`, GREY)
        const amorph = ANNEAL_MATS[q.m].xMax === 0
        head.event.set(
          a.warp > 1.5 ? (amorph ? 'slumps: amorphous, nothing to crystallise' : 'warps: too hot, pack it in salt') : q.c <= f.tgC ? 'under Tg: nothing happens' : a.done > 0.8 ? 'annealed' : amorph ? 'stress relief only' : 'still crystallising',
          a.warp > 1.5 ? HIGH_V : a.done > 0.8 ? POWER : B_FIELD,
        )
      },
      readouts: (p) => {
        const { V } = annRun(p)
        const a = V.cur
        return [
          { label: 'Heat deflection', value: celsiusText(a.hdt), tone: toneOf(a.hdt >= 80, a.hdt >= 60) },
          { label: 'Shrink XY', value: `${signed(a.xy * 100, 1)} %` },
          { label: 'Scale XY by', value: fixedText(a.scaleXY, 3) },
          { label: 'Warp', value: mmFixed(a.warp, 1), tone: toneOf(a.warp < 0.3, a.warp < 1) },
        ]
      },
    }
  },
}
