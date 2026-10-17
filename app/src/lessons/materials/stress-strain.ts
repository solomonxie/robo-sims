import * as THREE from 'three/webgpu'
import {
  BRACKET,
  LOAD_CASES,
  MATERIALS,
  MaterialKey,
  SECTIONS,
  SF_BAND,
  SectionKey,
  bracketLoad,
  clamp,
  hookeView,
  neckStrain,
  pullPath,
  regimeOf,
  sfVerdict,
  strengthOf,
  stressAt,
  thicknessFor,
  yieldStrain,
} from '../../core/physics'
import { fixedText, newtonsText, paText, si } from '../../core/units'
import { V3, box, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  MATERIAL_TINT,
  POWER,
  RING,
  WIDE_VIEW,
  addLabel,
  addRod,
  cantileverBeam,
  countBars,
  forceArrow,
  glowDot,
  glowMat,
  lapseClock,
  liveLabel,
  memoBy,
  plotY,
  sectionSketch,
  statusHeader,
  stressColor,
  stressScale,
  stretchRod,
  tensileSpecimen,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const MAT_KEYS = Object.keys(MATERIALS) as MaterialKey[]
const SEC_KEYS = Object.keys(SECTIONS) as SectionKey[]
const pctText = (eps: number, digits = 2) => `${fixedText(eps * 100, digits)} %`
const mpa = (pa: number) => paText(pa)
const mm4 = (I: number) => `${Math.round(I * 1e12)} mm⁴`
const PLOT = { x: 8.6, y: -5.9, w: 11.8, h: 7.2 }

// --- Hooke's law: an end-loaded arm link; σ = E·ε at the root, δ = FL³/(3EI) at the tip, and I decides most of it. ---

const HK = { L: 0.2, root: [-15.5, 2.4, 0] as V3, len: 15, maxDrop: 4, sect: { at: [-15, -6.4, 0] as V3, k: 220 }, bars: [-8, -4.6, 0] as V3, epsMax: 0.015, sigMax: 100e6 }
const NICE = [1, 2, 5, 10, 20, 50, 100, 200]
/** Sag exaggeration per material so a solid bar at full load droops about 1.5 units. */
const sagScale = (mk: MaterialKey) => NICE.find((s) => hookeView(mk, 'solid', 30, HK.L).delta * (HK.len / HK.L) * s >= 1.5) ?? 200
const hkRun = memoBy(
  (p: Params) => `${p.load} ${p.mat} ${p.sec}`,
  (p: Params) => {
    const F = n(p, 'load')
    const mk = pick(MATERIALS, p.mat, 'pla')
    const sk = pick(SECTIONS, p.sec, 'solid')
    return { F, mk, sk, V: hookeView(mk, sk, F, HK.L), scale: sagScale(mk) }
  },
)

export const stressStrainHookesLaw: Lesson = {
  id: 'stress-strain-hooke-s-law',
  title: 'Hooke’s law',
  tagline: 'Stress is proportional to strain: every part is a stiff spring',
  formula: (p) => {
    const { F, V } = hkRun(p)
    return `σ = E·ε (Hooke) · pull: σ = F/A = ${newtonsText(F, 1)} / ${Math.round(V.area * 1e6)} mm² = ${mpa(V.pull)} · bend: σ = M·c/I = F·L·c/I = ${mpa(V.sigma)} · ε = σ/E = ${pctText(V.eps, 3)} · δ = F·L³/(3·E·I) = ${si(V.delta, 'm')} · k = 3·E·I/L³ = ${fixedText(V.k / 1000)} N/mm`
  },
  legend: [
    { color: LABEL, label: 'Arm link, 200 mm, end load', shape: 'dot' },
    { color: FORCE, label: 'Load F', shape: 'dot' },
    { color: RING, label: 'Cross-section and its I', shape: 'dot' },
    { color: POWER, label: 'σ–ε line: slope = E', shape: 'dot' },
  ],
  points: [
    'Pull on a bar and it stretches. Divide the force by the area it spreads over and you get stress σ = F/A (pascals, usually MPa). Divide the stretch by the length and you get strain ε = ΔL/L (no units, tiny, often a tenth of a percent). Hooke: σ = E·ε, a straight line whose slope E (Young’s modulus) is a property of the material, not the part. Steel is about 200 GPa, aluminium 69, plywood 9, PLA 3.5.',
    'A robot arm link is usually bent, not pulled. An end load F makes a moment M = F·L at the root (Torque & levers › Moment arm), the top fibres stretch, the bottom ones squash, and the outermost see σ = M·c/I. The tip sags δ = F·L³/(3·E·I): double the length and the sag goes up 8 times.',
    'I, the second moment of area, adds up area × (distance from the middle)². All four sections here have the same area, so the same mass, yet the tube and I-beam sag 7 times less than the solid bar and 40 times less than the flat strip: put material far from the neutral axis. Turn a strip on its edge and it gets 39 times stiffer.',
    'F = k·δ with k = 3EI/L³: the link is a spring, exactly the k of Oscillations › Spring-mass, so a floppy link also wobbles at a low frequency after every move (Vibration). Hooke only holds while the line is straight; push σ past the material’s limit and it bends for good or snaps: Yield strength.',
  ],
  controls: [
    { kind: 'slider', key: 'load', label: 'End load F', min: 0, max: 30, step: 0.5, initial: 20, format: (v) => newtonsText(v, 1) },
    { kind: 'choice', key: 'mat', options: opts(namesOf(MATERIALS)), initial: 'pla' },
    { kind: 'choice', key: 'sec', options: opts(namesOf(SECTIONS)), initial: 'solid' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const beam = cantileverBeam(scene, HK.root, HK.len, { clampH: 3 })
    const rest = addRod(scene, glowMat(GREY, 0.5))
    stretchRod(rest, [HK.root[0], HK.root[1], -0.9], [HK.root[0] + HK.len, HK.root[1], -0.9], 0.04)
    const dim = addRod(scene, glowMat(RING, 0.9))
    const dimTag = liveLabel(scene, [0, 0, 0.6], { size: 0.3, align: 'left' })
    const weight = box(scene, [1.6, 1.4, 1.6], mat('#4a505c', { metal: 0.4, rough: 0.4 }))
    const hanger = addRod(scene, glowMat(GREY, 0.6))
    const arrow = forceArrow(scene, FORCE, { r: 0.12, size: 0.32 })
    const scaleTag = liveLabel(scene, [HK.root[0] + 0.4, HK.root[1] + 1.4, 0.3], { size: 0.26, color: GREY, align: 'left' })

    const sk = sectionSketch(scene, HK.sect.at, HK.sect.k, 4.6)
    addLabel(scene, 'end view', [HK.sect.at[0], HK.sect.at[1] + 2.6, 0.3], LABEL, 0.3)
    const iTag = liveLabel(scene, [HK.sect.at[0], HK.sect.at[1] - 2.6, 0.3], { size: 0.3 })
    addLabel(scene, 'tip sag δ, same area (same mass)', [HK.bars[0] - 3.2, HK.bars[1] + 1, 0.3], LABEL, 0.3, 'left')
    const bars = countBars(scene, HK.bars, SEC_KEYS.map((k) => SECTIONS[k].name.replace(/ \d.*$/, '')), 4.4, { row: 0.75, size: 0.28 })

    const rows = textRows(scene, 4, 3.6, 3.4, 0.32, 0.75)
    const plot = titledScope(scene, PLOT.y, PLOT.h, 'σ vs ε: slope = E', POWER, 0, PLOT.x, PLOT.w)
    const [px, py] = [(e: number) => e / HK.epsMax, plotY(0, HK.sigMax, PLOT.h)]
    const others = MAT_KEYS.map(() => plot.s.trace(GREY, { samples: 2, radius: 0.04 }))
    const line = plot.s.trace(POWER, { samples: 2, radius: 0.08 })
    const marker = glowDot(plot.s.group, 0.28, RING)
    const eTags = (['right', 'left'] as const).map((align) => liveLabel(plot.s.group, [0, 0, 0.4], { size: 0.28, align }))
    addLabel(scene, '100 MPa', [PLOT.x + PLOT.w / 2 - 0.3, PLOT.y + PLOT.h / 2 - 0.5, 0.4], GREY, 0.24, 'right')
    const elasticEnd = (mk: MaterialKey) => {
      const m = MATERIALS[mk]
      const e = Math.min(HK.epsMax, strengthOf(m) / m.E, HK.sigMax / m.E)
      return [px(e), py(m.E * e)] as const
    }
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { F, mk, sk: secKey, V, scale } = hkRun(p)
        const tint = MATERIAL_TINT[mk]
        const drawn = Math.min(HK.maxDrop, V.delta * (HK.len / HK.L) * scale)
        const depth = clamp(2 * V.c * (HK.len / HK.L), 0.25, 1.6)
        beam.set(depth, (u) => (drawn * u * u * (3 - u)) / 2, () => (V.elastic ? tint : HIGH_V), 0.25)
        const [tx, ty] = beam.tip
        stretchRod(dim, [tx + 0.6, HK.root[1], 0.5], [tx + 0.6, ty, 0.5], 0.05)
        dimTag.group.position.set(tx + 0.9, (HK.root[1] + ty) / 2 + 0.6, 0.6)
        dimTag.set(`δ ${si(V.delta, 'm')}`, RING)
        stretchRod(hanger, [tx - 0.3, ty, 0], [tx - 0.3, ty - 1.1, 0], 0.05)
        weight.position.set(tx - 0.3, ty - 1.8, 0)
        arrow([tx - 1.6, ty - 1.2, 0.8], [tx - 1.6, ty - 1.2 - (F / 30) * 2.6, 0.8], `F ${newtonsText(F, 1)}`, [-1.2, 0.3, 0])
        scaleTag.set(scale === 1 ? 'sag drawn to scale' : `sag drawn ×${scale}`)

        sk.set(SECTIONS[secKey].rects, tint)
        iTag.set(`I ${mm4(V.I)}`, RING)
        bars.set(V.tips.map((d) => Math.min(d, V.tips[0])), V.tips.map((d) => si(d, 'm')), SEC_KEYS.map((k) => (k === secKey ? tint : GREY)))

        rows[0].set(`pull: σ = F/A = ${mpa(V.pull)} (${Math.round(V.area * 1e6)} mm²)`, GREY)
        rows[1].set(`bend: σ = F·L·c/I = ${mpa(V.sigma)} at the root`, V.elastic ? LABEL : HIGH_V)
        rows[2].set(`ε = σ/E = ${pctText(V.eps, 3)} (E ${paText(V.m.E)})`, POWER)
        rows[3].set(`k = 3EI/L³ = ${fixedText(V.k / 1000)} N/mm, F = k·δ`, RING)

        MAT_KEYS.forEach((k, i) => {
          others[i].group.visible = k !== mk
          const [u, y] = elasticEnd(k)
          others[i].points([0, u], [py(0), y], null)
        })
        const [u, y] = elasticEnd(mk)
        line.material.color.set(tint)
        line.material.emissive.set(tint)
        line.points([0, u], [py(0), y], null)
        const steep = u < 0.5
        eTags[0].group.position.set(plot.s.xAt(u * 0.55) + 0.3, py(0) + (y - py(0)) * 0.55 + 0.9, 0.4)
        eTags[1].group.position.set(plot.s.xAt(u) + 0.4, y - 0.3, 0.4)
        eTags.forEach((tag, i) => tag.set(i === Number(steep) ? `E ${paText(V.m.E)}` : '', tint))
        const [mx, my] = [plot.s.xAt(clamp(px(V.eps), 0, 1)), clamp(py(V.sigma), -PLOT.h / 2, PLOT.h / 2)]
        marker.position.set(mx, my, 0.45)
        ;(marker.material as THREE.MeshStandardMaterial).emissive.set(V.elastic ? RING : HIGH_V)
        plot.lo.set('ε 0')
        plot.hi.set(pctText(HK.epsMax, 1))
        plot.right.set(`σ ${mpa(V.sigma)}`, V.elastic ? RING : HIGH_V)

        head.status.set(`Hooke’s law · ${V.m.short} · ${SECTIONS[secKey].name} · F ${newtonsText(F, 1)}`)
        head.sub.set('arm link 200 mm long, clamped at the servo, load at the tip', GREY)
        head.event.set(V.elastic ? `σ ${mpa(V.sigma)} below ${mpa(V.strength)}: on the straight line, springs back` : `σ ${mpa(V.sigma)} past ${mpa(V.strength)}: off the line, see Yield strength`, V.elastic ? POWER : HIGH_V)
      },
      readouts: (p) => {
        const { V } = hkRun(p)
        return [
          { label: 'Root stress σ', value: mpa(V.sigma), tone: toneOf(V.sigma < V.strength / 2, V.elastic) },
          { label: 'Strain ε', value: pctText(V.eps, 3) },
          { label: 'Tip sag δ', value: si(V.delta, 'm') },
          { label: 'Stiffness k', value: `${fixedText(V.k / 1000)} N/mm` },
        ]
      },
    }
  },
}

// --- Yield strength: a tensile test; straight line, yield, plastic flow, necking, fracture; let go and see what stays. ---

const YS = { at: [-11.5, -7.8, 0] as V3, gauge: 6, width: 2, exag: 2, maxStretch: 2, gaugeMm: 50, plot: { x: 6.6, y: -5.4, w: 15.4, h: 8.2 } }
const ysRun = memoBy(
  (p: Params) => `${p.mat} ${p.peak}`,
  (p: Params) => {
    const mk = pick(MATERIALS, p.mat, 'al6061')
    const peak = n(p, 'peak') / 100
    const m = MATERIALS[mk]
    return { mk, m, peak, path: pullPath(m, peak), regime: regimeOf(m, peak), epsMax: 1.15 * m.failStrain, sigMax: 1.15 * m.utsPa }
  },
)
const REGIME_TEXT = { elastic: 'elastic: springs back', plastic: 'plastic: stays stretched', necking: 'necking: about to break', broken: 'broken' }
const regimeColor = (r: keyof typeof REGIME_TEXT) => ({ elastic: POWER, plastic: RING, necking: HEAT, broken: HIGH_V })[r]
const CYCLE = { load: 2, hold: 0.5, unload: 0.8, rest: 1.4 }

export const stressStrainYieldStrength: Lesson = {
  id: 'stress-strain-yield-strength',
  title: 'Yield strength',
  tagline: 'Past the straight line a part bends for good, or snaps',
  formula: (p) => {
    const { m, path } = ysRun(p)
    return `tensile test: σ = F/A₀, ε = ΔL/L₀ · elastic while σ < σy: σ = E·ε · ${m.short}: E ${paText(m.E)}, ${m.ductile ? `yield σy ${mpa(m.yieldPa)} at ε ${pctText(yieldStrain(m))}, UTS ${mpa(m.utsPa)}` : `no yield, breaks at ${mpa(strengthOf(m))}`}, breaks at ε ${pctText(m.failStrain, 0)} · release from ε = ${pctText(path.top)}: springs back σ/E, keeps ${pctText(path.set)}`
  },
  legend: [
    { color: LABEL, label: 'Test bar, 50 mm gauge', shape: 'dot' },
    { color: RING, label: 'Path: load, then let go', shape: 'dot' },
    { color: GREY, label: 'Full curve to fracture', shape: 'dot' },
    { color: HEAT, label: 'Yield stress σy', shape: 'dot' },
  ],
  points: [
    'A tensile test pulls a standard bar apart and plots stress against strain. It starts as Hooke’s straight line (Hooke’s law): let go anywhere on it and the bar returns to its exact length. For aluminium the line ends at only 0.4 % strain, the stretch is invisible to the eye.',
    'At the yield strength σy the metal starts to flow: atoms slip past each other, the curve bends over, and a small extra force gives a lot of extra stretch. Let go now and the bar only springs back along a line parallel to the first one (slope E), so it keeps a permanent set. That is the arm link that stays bent after a crash.',
    'Keep pulling and it hardens up to the ultimate strength (UTS), then one spot thins (necking) and it breaks. Ductile metals stretch 10–20 % first, giving plenty of warning. Brittle acrylic, PLA and plywood have no yield: they follow a gently curving line and snap at a few percent, with no bend to warn you.',
    'Design rule: keep the worst-case stress below the yield strength (brittle: below the breaking stress) with a margin: Safety factor. A printed PLA part is weaker still across its layers, see 3D printing › Strength.',
  ],
  controls: [
    { kind: 'slider', key: 'peak', label: 'Pull to strain ε', min: 0.1, max: 25, step: 0.05, log: true, initial: 2, format: (v) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)} %` },
    { kind: 'choice', key: 'mat', options: opts(namesOf(MATERIALS)), initial: 'al6061' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const bar = tensileSpecimen(scene, YS.at, YS.gauge, YS.width)
    const restTop = addRod(scene, glowMat(GREY, 0.6))
    stretchRod(restTop, [YS.at[0] + 2.4, YS.at[1] + YS.gauge, 0.4], [YS.at[0] + 3.6, YS.at[1] + YS.gauge, 0.4], 0.05)
    addLabel(scene, 'start', [YS.at[0] + 3.8, YS.at[1] + YS.gauge, 0.4], GREY, 0.26, 'left')
    const up = forceArrow(scene, FORCE, { r: 0.12, size: 0.3 })
    const lenTag = liveLabel(scene, [YS.at[0] + 2.4, YS.at[1] + YS.gauge / 2, 0.4], { size: 0.3, align: 'left' })
    const clock = lapseClock(CYCLE.load + CYCLE.hold + CYCLE.unload, 1, CYCLE.rest)

    const rows = textRows(scene, 4, -0.6, 3.5, 0.32, 0.75)
    const sigTag = liveLabel(scene, [YS.at[0] + 2.4, YS.at[1] + YS.gauge / 2 - 0.8, 0.4], { size: 0.3, align: 'left' })
    const { x, y, w, h } = YS.plot
    const plot = titledScope(scene, y, h, 'stress σ vs strain ε', LABEL, 0, x, w)
    const full = plot.s.trace(GREY, { samples: 122, radius: 0.04 })
    const trail = plot.s.trace(RING, { samples: 100, radius: 0.08 })
    const yieldLine = plot.s.level(HEAT)
    const yieldTag = liveLabel(plot.s.group, [0, 0, 0.4], { size: 0.26, align: 'right' })
    const topTag = liveLabel(scene, [x - w / 2 + 0.3, y + h / 2 - 0.5, 0.4], { size: 0.24, color: GREY, align: 'left' })
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { mk, m, peak, path, regime, epsMax, sigMax } = ysRun(p)
        const [px, py] = [(e: number) => clamp(e / epsMax, 0, 1), plotY(0, sigMax, h)]
        const t = clock(dt, `${mk}|${peak}`)
        const tUn = (t - CYCLE.load - CYCLE.hold) / CYCLE.unload
        let eps: number
        let sig: number
        let broke = false
        if (t <= CYCLE.load || path.broke) {
          const e = (peak * Math.min(t, CYCLE.load)) / CYCLE.load
          broke = e > m.failStrain
          eps = Math.min(e, m.failStrain)
          sig = broke ? 0 : stressAt(m, eps)
        } else if (tUn <= 0) [eps, sig] = [path.top, path.peakStress]
        else {
          const f = Math.min(1, tUn + 1e-9)
          eps = m.ductile ? path.top - f * (path.top - path.set) : path.top * (1 - f)
          sig = m.ductile ? path.peakStress * (1 - f) : stressAt(m, eps)
        }
        const loaded = path.load.filter(([e]) => e <= eps || t > CYCLE.load)
        const us = [...loaded.map(([e]) => px(e)), px(broke ? m.failStrain : eps)]
        const ys = [...loaded.map(([, s]) => py(s)), py(sig)]
        trail.points(us, ys)
        full.draw((u) => (u * epsMax > m.failStrain ? py(0) : py(stressAt(m, u * epsMax))), null)

        const neck = m.ductile ? clamp((eps - neckStrain(m)) / (m.failStrain - neckStrain(m)), 0, 1) : 0
        bar.set(Math.min(YS.maxStretch, eps * YS.gauge * YS.exag), broke ? 1 : neck, broke ? 0.6 : 0, MATERIAL_TINT[mk])
        const topY = bar.topY()
        const arrowLen = (sig / m.utsPa) * 1.2
        up([YS.at[0], topY, 0.6], [YS.at[0], topY + arrowLen, 0.6], '')
        sigTag.set(`σ ${mpa(sig)}`, FORCE)
        lenTag.set(`${fixedText(YS.gaugeMm * (1 + eps), 2)} mm`, eps > yieldStrain(m) * 1.001 && m.ductile ? RING : LABEL)

        yieldLine.set(py(strengthOf(m)))
        yieldTag.group.position.set(w / 2 - 0.3, py(strengthOf(m)) + 0.45, 0.4)
        yieldTag.set(m.ductile ? `yield ${mpa(m.yieldPa)}` : `breaks ${mpa(strengthOf(m))}`, HEAT)
        topTag.set(mpa(sigMax))
        plot.lo.set('ε 0')
        plot.hi.set(pctText(epsMax, 1))
        plot.right.set(`now ε ${pctText(eps)}, σ ${mpa(sig)}`, regimeColor(regime))

        rows[0].set(m.ductile ? `straight to ε ${pctText(yieldStrain(m))}, then yields at ${mpa(m.yieldPa)}` : `no yield: curves and snaps at ${mpa(strengthOf(m))}`, GREY)
        rows[1].set(`pulled to ε ${pctText(path.top)}, σ ${mpa(path.peakStress)}`, LABEL)
        rows[2].set(path.broke ? `broke at ε ${pctText(m.failStrain, 1)}` : path.set > 0 ? `let go: springs back ${pctText(path.top - path.set)}, keeps ${pctText(path.set)}` : 'let go: back to its exact length', path.broke ? HIGH_V : path.set > 0 ? RING : POWER)
        rows[3].set(`stretch drawn ×${YS.exag}: elastic part is invisible`, GREY)
        head.status.set(`Yield strength · ${m.name} · pull to ε ${pctText(peak)}`)
        head.sub.set('tensile test bar, 50 mm gauge, pulled then released, looping', GREY)
        head.event.set(REGIME_TEXT[regime], regimeColor(regime))
      },
      readouts: (p) => {
        const { m, path, regime } = ysRun(p)
        return [
          { label: m.ductile ? 'Yield strength σy' : 'Breaking stress', value: mpa(strengthOf(m)) },
          { label: 'Peak stress reached', value: path.broke ? 'broke' : mpa(path.peakStress), tone: path.broke ? 'bad' : undefined },
          { label: 'Permanent set', value: path.broke ? '—' : `${pctText(path.set)} (${fixedText(path.set * YS.gaugeMm, 2)} mm)`, tone: toneOf(path.set === 0 && !path.broke, !path.broke) },
          { label: 'Regime', value: REGIME_TEXT[regime].split(':')[0], tone: toneOf(regime === 'elastic', regime === 'plastic') },
        ]
      },
    }
  },
}

// --- Safety factor: a printed or metal arm link under its worst case; stress map along it, SF vs thickness. ---

const SF = { root: [-15.5, 2.2, 0] as V3, len: 13, k: BRACKET.L, maxDrop: 4, bars: [-9.4, -4.4, 0] as V3, tMin: 1, tMax: 12, sfMax: 6, target: 2.5 }
const sfRun = memoBy(
  (p: Params) => `${p.mat} ${p.t} ${p.kg} ${p.lc}`,
  (p: Params) => {
    const mk = pick(MATERIALS, p.mat, 'pla')
    const lc = pick(LOAD_CASES, p.lc, 'swing')
    const t = n(p, 't') / 1000
    const kg = n(p, 'kg')
    const R = bracketLoad(mk, t, kg, lc)
    const curve = Array.from({ length: 121 }, (_, i) => bracketLoad(mk, (SF.tMin + ((SF.tMax - SF.tMin) * i) / 120) / 1000, kg, lc).sf)
    return { mk, lc, t, kg, R, curve, need: thicknessFor(mk, kg, lc, SF.target), each: MAT_KEYS.map((k) => bracketLoad(k, t, kg, lc).sf) }
  },
)
const sfColor = (sf: number) => ({ breaks: HIGH_V, 'too thin': HEAT, 'just right': POWER, heavy: RING })[sfVerdict(sf)]

export const stressStrainSafetyFactor: Lesson = {
  id: 'stress-strain-safety-factor',
  title: 'Safety factor',
  tagline: 'Size the part for the worst day, then add a margin',
  formula: (p) => {
    const { t, R, need } = sfRun(p)
    return `worst-case load F = m·g × ${fixedText(R.factor)} = ${newtonsText(R.F, 1)} · root moment M = F·L = ${fixedText(R.F * BRACKET.L)} N·m · rectangle b × t: σ = M·(t/2)/I = 6·M/(b·t²) = ${mpa(R.sigma)} at t = ${fixedText(t * 1000, 1)} mm · SF = strength / σ = ${mpa(R.strength)} / ${mpa(R.sigma)} = ${fixedText(R.sf)} · SF ${SF.target} needs t ≥ ${Number.isFinite(need) ? `${fixedText(need * 1000, 1)} mm` : 'more than 100 mm'}`
  },
  legend: [
    { color: POWER, label: 'SF 2–3: right-sized', shape: 'dot' },
    { color: RING, label: 'SF above 3: heavier than needed', shape: 'dot' },
    { color: HEAT, label: 'SF 1–2: too thin', shape: 'dot' },
    { color: HIGH_V, label: 'SF below 1: yields or breaks', shape: 'dot' },
  ],
  points: [
    'Safety factor SF = strength ÷ worst stress. SF 1 means the part is exactly at its limit: any surprise breaks it. Robot parts usually aim for SF 2–3, more for people-safety parts, less where mass is precious (drones). Above that the arm only gets heavier, slower and needs a bigger servo (Kinematics › Dynamics › Payload limits).',
    'The worst case is rarely standing still. Swinging the payload with 15 m/s² of acceleration adds m·a on top of m·g (Newton’s laws). A drop is worse: a payload falling only 10 mm onto the gripper hits with 1 + √(1 + 2h/δ) times its weight, and the stiffer the link the bigger that factor (Collisions).',
    'Bending stress is highest at the root, where the moment arm is longest (Torque & levers › Static balance), and falls to zero at the tip: the colour map shows it. That is where links crack and where a gusset, a fillet or extra thickness pays off. Stress goes as 1/t², so a little more thickness buys a lot of SF.',
    'Strength here is the yield stress for metals and PETG and the breaking stress for brittle PLA, acrylic and plywood (Yield strength). Printed parts are weaker between layers and with sparse infill, see 3D printing › Strength, so print brackets with the load along the layers or use a bigger SF.',
  ],
  controls: [
    { kind: 'slider', key: 't', label: 'Link thickness t', min: SF.tMin, max: SF.tMax, step: 0.5, initial: 6, format: (v) => `${v.toFixed(1)} mm` },
    { kind: 'slider', key: 'kg', label: 'Payload', min: 0.2, max: 3, step: 0.1, initial: 1, format: (v) => `${v.toFixed(1)} kg` },
    { kind: 'choice', key: 'lc', options: opts(namesOf(LOAD_CASES)), initial: 'swing' },
    { kind: 'choice', key: 'mat', options: opts(namesOf(MATERIALS)), initial: 'pla' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const beam = cantileverBeam(scene, SF.root, SF.len, { clampH: 4 })
    const payload = box(scene, [2, 1.6, 2], mat('#4a505c', { metal: 0.4, rough: 0.4 }))
    const kgTag = liveLabel(scene, [0, 0, 1.2], { size: 0.3 })
    const wArrow = forceArrow(scene, FORCE, { r: 0.12, size: 0.3 })
    const dArrow = forceArrow(scene, HEAT, { r: 0.12, size: 0.3 })
    const rootTag = liveLabel(scene, [SF.root[0] + 0.3, SF.root[1] - 2, 0.4], { size: 0.28, align: 'left' })
    stressScale(scene, [-17, -9.4, 0], 9)
    addLabel(scene, 'SF of every material, same link', [SF.bars[0] - 3, SF.bars[1] + 1, 0.3], LABEL, 0.3, 'left')
    const bars = countBars(scene, SF.bars, MAT_KEYS.map((k) => MATERIALS[k].short), 4.6, { row: 0.62, size: 0.26 })
    const c = new THREE.Color()

    const rows = textRows(scene, 4, 2.4, 3.4, 0.32, 0.75)
    const plot = titledScope(scene, PLOT.y, PLOT.h, 'SF vs thickness', LABEL, 0, PLOT.x, PLOT.w)
    const py = plotY(0, SF.sfMax, PLOT.h)
    const curve = plot.s.trace(RING, { samples: 121, radius: 0.07 })
    SF_BAND.forEach((b) => plot.s.level(POWER).set(py(b)))
    plot.s.level(HIGH_V).set(py(1))
    ;[1, ...SF_BAND].forEach((b) => addLabel(plot.s.group, `SF ${b}`, [-PLOT.w / 2 + 0.3, py(b) + 0.35, 0.4], b === 1 ? HIGH_V : POWER, 0.24, 'left'))
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { mk, lc, t, kg, R, curve: sfs, need, each } = sfRun(p)
        const drawn = Math.min(SF.maxDrop, R.delta * (SF.len / SF.k))
        const f = 1 / R.sf
        beam.set(clamp(t * 1000 * 0.2, 0.2, 2.4), (u) => (drawn * u * u * (3 - u)) / 2, (u) => stressColor(f * (1 - u), c), 0.55)
        const [tx, ty] = beam.tip
        payload.position.set(tx + 0.6, ty - 1.2, 0)
        kgTag.group.position.set(tx + 0.6, ty - 1.2, 1.2)
        kgTag.set(`${kg.toFixed(1)} kg`, LABEL)
        const wLen = 1.2
        const dLen = Math.min(4.5, wLen * R.factor)
        wArrow([tx + 1.9, ty - 1.2, 1], [tx + 1.9, ty - 1.2 - wLen, 1], 'm·g', [-0.9, 0.4, 0])
        dArrow([tx + 2.9, ty - 1.2, 1], [tx + 2.9, ty - 1.2 - dLen, 1], R.factor > 1.01 ? `×${fixedText(R.factor, 1)}` : '', [0.9, -0.3, 0])
        rootTag.set(`max σ ${mpa(R.sigma)} at the root`, sfColor(R.sf))

        bars.set(each.map((s) => Math.min(s, SF.sfMax)), each.map((s) => fixedText(s, 1)), each.map((s, i) => (MAT_KEYS[i] === mk ? sfColor(s) : GREY)), SF.sfMax)

        const sf = R.sf
        rows[0].set(`F = ${kg.toFixed(1)} kg · g × ${fixedText(R.factor)} = ${newtonsText(R.F, 1)}`, FORCE)
        rows[1].set(`σ = 6·F·L/(b·t²) = ${mpa(R.sigma)} (b 20, L 150 mm)`, LABEL)
        rows[2].set(`SF = ${mpa(R.strength)} / ${mpa(R.sigma)} = ${fixedText(sf)}: ${sfVerdict(sf)}`, sfColor(sf))
        rows[3].set(Number.isFinite(need) ? `SF ${SF.target} needs t ≥ ${fixedText(need * 1000, 1)} mm` : `SF ${SF.target} out of reach`, POWER)

        const u = (t * 1000 - SF.tMin) / (SF.tMax - SF.tMin)
        curve.draw((v) => py(sfs[Math.round(v * 120)]), u)
        plot.lo.set(`t ${SF.tMin} mm`)
        plot.hi.set(`${SF.tMax} mm`)
        plot.right.set(`now SF ${fixedText(sf, 1)}`, sfColor(sf))

        head.status.set(`Safety factor · ${MATERIALS[mk].name} · ${LOAD_CASES[lc].name}`)
        head.sub.set('arm link 150 × 20 mm at the servo, payload at the tip · thickness drawn ×2', GREY)
        head.event.set(sf < 1 ? 'SF below 1: the link yields or breaks' : sf < SF_BAND[0] ? 'too thin: one surprise from failure' : sf <= SF_BAND[1] ? 'SF 2–3: strong enough, no heavier than needed' : 'over-built: thinner would save mass', sfColor(sf))
      },
      readouts: (p) => {
        const { R, need } = sfRun(p)
        return [
          { label: 'Worst-case load', value: `${newtonsText(R.F, 1)} (×${fixedText(R.factor, 1)})` },
          { label: 'Root stress σ', value: mpa(R.sigma) },
          { label: 'Safety factor', value: fixedText(R.sf), tone: toneOf(R.sf >= SF_BAND[0] && R.sf <= SF_BAND[1], R.sf >= 1) },
          { label: `Thickness for SF ${SF.target}`, value: Number.isFinite(need) ? `${fixedText(need * 1000, 1)} mm` : '> 100 mm' },
        ]
      },
    }
  },
}
