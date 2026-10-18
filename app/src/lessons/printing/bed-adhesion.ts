import * as THREE from 'three/webgpu'
import {
  AIDS,
  AID_SWEEP,
  Aid,
  BED_MAP,
  BED_SURFACES,
  BedSurface,
  COOL_FILAMENTS,
  CoolFilament,
  FILAMENTS,
  FIRST_LAYER,
  LEVEL_MODES,
  LevelMode,
  PROBE_Z,
  RELEASE,
  SURFACE_PREP,
  SURFACE_SWEEP,
  SurfacePrep,
  beadSection,
  cornerView,
  gripTempFactor,
  levelView,
  shrinkPull,
  surfaceView,
  zOffsetGap,
} from '../../core/physics'
import { celsiusText, fixedText, mmFixed, pct, secs } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  FILAMENT_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  WIDE_VIEW,
  addLabel,
  bedRelief,
  beadCut,
  countBars,
  cursorBar,
  glowDot,
  ironbow,
  liveLabel,
  memoBy,
  plotY,
  printBeads,
  statusHeader,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const PLOT = { x: 8.6, w: 11.8, top: { y: -1.2, h: 6 }, low: { y: -8.7, h: 3.2 } }
const GAP_TONE = { gaps: B_FIELD, good: POWER, squished: HEAT, scraping: HIGH_V }
const GAP_NAME = { gaps: 'too high: round beads, gaps', good: 'good squish, lines fused', squished: 'squished: wide lines, ridges', scraping: 'nozzle scraping the bed' }
const MATS = opts(COOL_FILAMENTS)
/** Nearest sample of a sweep at 0…1. */
const sampleAt = (arr: readonly number[]) => (s: number) => arr[Math.min(arr.length - 1, Math.round(s * (arr.length - 1)))]

// --- Bed levelling: a tilted, bowed bed; none / paper / 3-point plane / mesh; the first layer laid across it. ---

const BL = { size: 14, n: 21, ex: 10, at: [-8.4, -3.6, 0] as V3, rows: [30, 70, 110, 150, 190], seg: 10, loop: 12 }
const PATH = (() => {
  const pts: [number, number][] = []
  BL.rows.forEach((y, r) => {
    for (let x = 20; x <= 200; x += BL.seg) pts.push([r % 2 ? 220 - x : x, y])
  })
  return pts
})()
const blParams = (p: Params) => ({ mode: pick(LEVEL_MODES, p.mode, 'none') as LevelMode, tilt: n(p, 'tilt'), warp: n(p, 'warp'), grid: n(p, 'grid') })
const blKey = (p: Params) => `${p.mode} ${p.tilt} ${p.warp} ${p.grid}`
const blRun = memoBy(blKey, (p: Params) => {
  const q = blParams(p)
  const v = levelView(q.tilt, q.warp, q.mode, q.grid, BL.n)
  const along = PATH.map(([x, y]) => ({ bed: v.true(x, y), est: v.est(x, y), gap: FIRST_LAYER.h + v.err(x, y) }))
  return { q, v, along }
})

export const bedAdhesionBedLevelling: Lesson = {
  id: 'bed-adhesion-bed-levelling',
  title: 'Bed levelling',
  tagline: 'A bed is never flat: probe it and let Z follow it',
  formula: (p) => {
    const { q, v } = blRun(p)
    if (q.mode === 'none') return `gap(x, y) = ${FIRST_LAYER.h} mm + z(centre) − z(x, y) · Z is set once at the centre; tilt and bow go straight into the first layer`
    if (q.mode === 'mesh') return `Z(x, y) = bilinear between the 4 nearest of ${q.grid} × ${q.grid} probes: (1−fx)(1−fy)·z00 + fx(1−fy)·z10 + (1−fx)fy·z01 + fx·fy·z11 · edges extrapolated`
    const a = v.est(0, 0)
    const b = (v.est(100, 0) - a) / 100
    const c = (v.est(0, 100) - a) / 100
    return `least-squares plane through ${v.probes.length} points: z = ${fixedText(a, 3)} ${b < 0 ? '−' : '+'} ${fixedText(Math.abs(b) * 100, 3)}·x/100 ${c < 0 ? '−' : '+'} ${fixedText(Math.abs(c) * 100, 3)}·y/100 mm · a plane cannot follow a bow`
  },
  legend: [
    { color: POWER, label: 'First layer squished right', shape: 'dot' },
    { color: B_FIELD, label: 'Nozzle too high: gaps', shape: 'dot' },
    { color: HEAT, label: 'Nozzle low: squished, red: scraping', shape: 'dot' },
    { color: RING, label: 'Probe points', shape: 'dot' },
  ],
  points: [
    'A first layer is 0.2 mm thick, so a bed that is 0.2 mm out across its width means half the plate is printed in mid-air and the other half is scraped. Real beds tilt (the frame or the gantry is not square) and bow (an aluminium plate warps when hot, often high in the middle). The heights here are exaggerated; the colours are the real first-layer gap error.',
    'Manual levelling: home Z, then at each corner turn the screw under the bed until a sheet of paper (about 0.1 mm) just drags under the nozzle. Four screws can only take out tilt, and paper feel varies by a few hundredths. Do it with the bed hot, since the bowl changes with temperature (Temperature & cooling > Heated bed).',
    'Automatic levelling probes the bed (BLTouch pin or inductive sensor, repeatable to a few µm, see Printer motion > Axes and endstops for trigger repeatability). G29 with 3 points fits a plane, the same least squares as Maths > Linear algebra, now with z = a + b·x + c·y; it removes tilt but not a bow. A mesh (G29 with a 5 × 5 to 9 × 9 grid) stores every height and interpolates bilinearly between the four nearest.',
    'The firmware then adds the interpolated height to Z on every move, fading the correction out over the first few mm so the top of the part is flat. Probing takes seconds per point, so store the mesh (M500) and load it in the start script (G-code > Start and end scripts) rather than probing every print. The probe still has to know how far it sits above the nozzle: that is Z offset.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(LEVEL_MODES), initial: 'none' },
    { kind: 'slider', key: 'tilt', label: 'Tilt corner to corner', min: 0, max: 0.6, step: 0.05, initial: 0.3, format: (v) => mmFixed(v, 2) },
    { kind: 'slider', key: 'warp', label: 'Centre above corners', min: -0.3, max: 0.3, step: 0.05, initial: 0.15, format: (v) => mmFixed(v, 2) },
    { kind: 'slider', key: 'grid', label: 'Mesh points per side', min: 3, max: 9, step: 1, initial: 5, format: (v) => `${v} × ${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const bed = bedRelief(scene, BL.at, BL.size, BL.n)
    bed.holder.rotation.set(0.62, -0.55, 0)
    const k = BL.size / BED_MAP.mm
    const lay = add(bed.holder, new THREE.Group(), [-BL.size / 2, 0, BL.size / 2])
    const beads = printBeads(lay, PATH.length, k)
    const probes = Array.from({ length: 81 }, () => glowDot(bed.holder, 0.17, RING))
    const nozzle = add(bed.holder, new THREE.Mesh(new THREE.ConeGeometry(0.35, 1, 20), new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 0.8, roughness: 0.3 })))
    nozzle.rotation.x = Math.PI
    addLabel(scene, `heights × ${Math.round(BL.ex / (BL.size / BED_MAP.mm))}, exaggerated`, [-16.6, 3.4, 0.3], GREY, 0.26, 'left')
    const T = PLOT.top
    const top = titledScope(scene, T.y, T.h, 'bed and nozzle Z', LABEL, 0.5, PLOT.x, PLOT.w)
    top.lo.set('start')
    top.hi.set('end of first layer')
    const trBed = top.s.trace(HEAT, { samples: PATH.length, radius: 0.06 })
    const trEst = top.s.trace(RING, { samples: PATH.length, radius: 0.05 })
    const L = PLOT.low
    const low = titledScope(scene, L.y, L.h, 'gap, 0 to 0.4 mm', POWER, 0, PLOT.x, PLOT.w)
    low.lo.set('start')
    low.hi.set('end')
    const trGap = low.s.trace(POWER, { samples: PATH.length, radius: 0.06 })
    low.s.level(GREY).set(plotY(0, 0.4, L.h)(FIRST_LAYER.h))
    const st = { key: '', t: 0 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, v, along } = blRun(p)
        const key = blKey(p)
        if (key !== st.key) [st.key, st.t] = [key, 0]
        st.t = (st.t + dt) % BL.loop
        const done = Math.min(PATH.length, Math.floor((st.t / (BL.loop - 2)) * PATH.length))
        const cell = BED_MAP.mm / BL.n
        bed.set(
          (i, j) => v.true((i + 0.5) * cell, (j + 0.5) * cell) * BL.ex,
          (i, j, out) => out.set(GAP_TONE[beadSection(FIRST_LAYER.h + v.map[j * BL.n + i]).state]).multiplyScalar(0.5),
        )
        for (let i = 0; i < done; i++) {
          const a = PATH[i]
          const b = PATH[Math.min(PATH.length - 1, i + 1)]
          const g = along[i]
          const st8 = beadSection(g.gap).state
          beads.lay(i, a, i + 1 < PATH.length && a[1] === b[1] ? b : a, (g.bed * BL.ex + 0.02) / k, 1.2 * FIRST_LAYER.w * 9, 0.12 / k, GAP_TONE[st8])
        }
        beads.show(done)
        probes.forEach((d, i) => {
          const pr = v.probes[i]
          d.visible = !!pr
          if (pr) d.position.set(...bed.local(pr[0] / BED_MAP.mm, pr[1] / BED_MAP.mm, pr[2] * BL.ex + 0.25))
        })
        const at = PATH[Math.min(PATH.length - 1, done)]
        const g = along[Math.min(PATH.length - 1, done)]
        nozzle.position.set(...bed.local(at[0] / BED_MAP.mm, at[1] / BED_MAP.mm, g.est * BL.ex + 0.75))
        const lo = Math.min(...along.map((a) => Math.min(a.bed, a.est))) - 0.05
        const hi = Math.max(...along.map((a) => Math.max(a.bed, a.est))) + 0.05
        const py = plotY(lo, hi, T.h)
        const u = done / (PATH.length - 1)
        trBed.draw((s) => py(sampleAt(along.map((a) => a.bed))(s)), u)
        trEst.draw((s) => py(sampleAt(along.map((a) => a.est))(s)), u)
        const gy = plotY(0, 0.4, L.h)
        trGap.draw((s) => gy(sampleAt(along.map((a) => a.gap))(s)), u)
        top.right.set(`Z ${mmFixed(g.est, 2)}`, RING)
        const s8 = beadSection(g.gap).state
        low.right.set(`${mmFixed(g.gap, 2)} · ${s8}`, GAP_TONE[s8])
        head.status.set(`Bed levelling · ${LEVEL_MODES[q.mode]}`)
        head.sub.set(`orange line: true bed · yellow: nozzle Z follows the estimate · ${q.mode === 'mesh' ? `${q.grid * q.grid} probes` : `${v.probes.length} point${v.probes.length > 1 ? 's' : ''}`}`, GREY)
        head.event.set(`nozzle here: ${GAP_NAME[s8]}`, GAP_TONE[s8])
      },
      readouts: (p) => {
        const { q, v } = blRun(p)
        return [
          { label: 'Worst gap error', value: mmFixed(v.worst, 2), tone: toneOf(v.worst < 0.05, v.worst < 0.1) },
          { label: 'Bed squished right', value: pct(v.good), tone: toneOf(v.good > 0.95, v.good > 0.7) },
          { label: 'Gap error spread', value: mmFixed(v.range, 2) },
          { label: q.mode === 'paper' ? 'Levelling by hand' : 'Probing', value: q.mode === 'none' ? '1 home' : `${v.probes.length} pts · ${secs(v.probeS)}` },
        ]
      },
    }
  },
}

// --- Z offset: the nozzle-to-probe distance sets the first-layer gap; beads round, fused or scraped. ---

const ZO = { k: 6, beads: 5, at: [-8.6, -4.6, 0] as V3, lo: -2.0, hi: -1.55 }
const ZO_SWEEP = Array.from({ length: 46 }, (_, i) => ZO.lo + i * 0.01)
const zoParams = (p: Params) => ({ z: n(p, 'z'), w: n(p, 'w') })
const zoRun = memoBy(
  (p: Params) => `${p.z} ${p.w}`,
  (p: Params) => {
    const q = zoParams(p)
    const gap = zOffsetGap(q.z)
    const bead = beadSection(gap, q.w)
    const sweep = ZO_SWEEP.map((z) => beadSection(zOffsetGap(z), q.w))
    return { q, gap, bead, sweep, foot: Math.max(0, (bead.w - q.w) / 2) }
  },
)

export const bedAdhesionZOffset: Lesson = {
  id: 'bed-adhesion-z-offset',
  title: 'Z offset',
  tagline: 'Hundredths of a millimetre between gaps and a scraped bed',
  formula: (p) => {
    const { q, gap, bead } = zoRun(p)
    return `gap = layer + (Z offset − true) = ${FIRST_LAYER.h} + (${fixedText(q.z, 2)} − (${PROBE_Z.trueMm})) = ${mmFixed(gap, 2)} · area kept: (w − h)·h + π·h²/4 = ${fixedText(bead.area, 3)} mm² · w = ${mmFixed(bead.w, 2)} at h = ${mmFixed(bead.h, 2)}`
  },
  legend: [
    { color: POWER, label: 'Lines fused, flat top', shape: 'dot' },
    { color: B_FIELD, label: 'Too high: round, not touching', shape: 'dot' },
    { color: HEAT, label: 'Too low: wide lines, ridges', shape: 'dot' },
    { color: HIGH_V, label: 'Scraping, extruder skips', shape: 'dot' },
  ],
  points: [
    'The probe triggers some way above the nozzle tip. Z offset (M851 Z, or "Probe Z offset" on the screen) tells the firmware that distance, so Z = 0 is the nozzle touching the bed. Swap a nozzle or bend the probe mount and it changes. Typical BLTouch values are around −1.5 to −2.5 mm; here the true one is −1.85.',
    'The slicer extrudes a fixed volume per mm: a 0.45 × 0.2 mm line with rounded sides. Whatever the gap, that area comes out. Too high and it falls out as a round strand that barely touches the bed and does not reach its neighbour. Right, and it is pressed flat into a line the width the slicer planned, just fused with the next.',
    'Too low and the same area is squeezed thinner and wider: lines overlap and push up ridges, the outline bulges outwards (elephant foot, see Print problems), and below about 0.05 mm the nozzle drags on the bed, back-pressure stops the flow and the extruder clicks. A wider first-layer line (120 % of the nozzle) tolerates more error.',
    'Set it on a single-layer square: babystep Z (M290) while it prints until the top is smooth with no gaps, then save (M500). The paper test gets within about 0.05 mm. Once the offset is right, levelling (Bed levelling) keeps the gap the same everywhere on the bed.',
  ],
  controls: [
    { kind: 'slider', key: 'z', label: 'Z offset (M851 Z)', min: ZO.lo, max: ZO.hi, step: 0.01, initial: -1.72, format: (v) => mmFixed(v, 2) },
    { kind: 'slider', key: 'w', label: 'First-layer line width', min: 0.4, max: 0.6, step: 0.05, initial: 0.45, format: (v) => mmFixed(v, 2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const cut = beadCut(scene, ZO.at, ZO.k, ZO.beads, 2.4)
    const gapTag = liveLabel(scene, [ZO.at[0] + 7, ZO.at[1] - 0.9, 0.6], { size: 0.3, align: 'right' })
    addLabel(scene, 'bed', [ZO.at[0] - 6.4, ZO.at[1] - 0.9, 0.6], GREY, 0.3, 'left')
    addLabel(scene, 'first-layer lines, cut across, magnified', [ZO.at[0], ZO.at[1] - 1.7, 0.6], GREY, 0.28)
    const rows = textRows(scene, 3, -16.6, -7.6, 0.32, 0.75)
    const T = PLOT.top
    const top = titledScope(scene, T.y, T.h, 'line height and width', LABEL, 0, PLOT.x, PLOT.w)
    top.lo.set(mmFixed(ZO.lo, 2))
    top.hi.set(mmFixed(ZO.hi, 2))
    const wy = plotY(0, 1, T.h)
    const trW = top.s.trace(RING, { samples: ZO_SWEEP.length, radius: 0.06 })
    const trH = top.s.trace(B_FIELD, { samples: ZO_SWEEP.length, radius: 0.06 })
    const trC = top.s.trace(POWER, { samples: ZO_SWEEP.length, radius: 0.05 })
    const lvW = top.s.level(GREY)
    const curT = cursorBar(top.s, LABEL, 0.05)
    const L = PLOT.low
    const low = titledScope(scene, L.y, L.h, 'overlap with the next line', POWER, 0.5, PLOT.x, PLOT.w)
    low.lo.set('nozzle low')
    low.hi.set('nozzle high')
    const fy = plotY(-0.3, 0.3, L.h)
    const trF = low.s.trace(POWER, { samples: ZO_SWEEP.length, radius: 0.06 })
    const curL = cursorBar(low.s, LABEL, 0.05)
    return {
      scene,
      view: WIDE_VIEW,
      frame(_dt, p) {
        const { q, gap, bead, sweep, foot } = zoRun(p)
        const tone = GAP_TONE[bead.state]
        cut.set(bead.h, bead.w, q.w, gap, tone)
        gapTag.set(`gap ${mmFixed(gap, 2)}`, tone)
        const u = (q.z - ZO.lo) / (ZO.hi - ZO.lo)
        trW.draw((s) => wy(sampleAt(sweep.map((b) => b.w))(s)), u)
        trH.draw((s) => wy(sampleAt(sweep.map((b) => b.h))(s)), u)
        trC.draw((s) => wy(sampleAt(sweep.map((b) => b.contact))(s)), u)
        lvW.set(wy(q.w))
        curT(u)
        trF.draw((s) => fy(sampleAt(sweep.map((b) => b.fuse))(s)), u)
        curL(u)
        top.right.set(`w ${mmFixed(bead.w, 2)} · h ${mmFixed(bead.h, 2)}`, RING)
        low.right.set(bead.fuse < 0 ? `gap ${mmFixed(-bead.fuse, 2)}` : `overlap ${mmFixed(bead.fuse, 2)}`, tone)
        rows[0].set('yellow: width · blue: height · green: on the bed', GREY)
        rows[1].set(`flat contact with the bed ${mmFixed(bead.contact, 2)}`, tone)
        rows[2].set(foot > 0.05 ? `outline bulges ${mmFixed(foot, 2)} each side (elephant foot)` : bead.round ? 'round strand: dragged, curls up, no grip' : 'outline true to size', foot > 0.05 || bead.round ? HEAT : POWER)
        head.status.set(`Z offset ${mmFixed(q.z, 2)} · true ${mmFixed(PROBE_Z.trueMm, 2)}`)
        head.sub.set(`first layer ${mmFixed(FIRST_LAYER.h, 1)}, line ${mmFixed(q.w, 2)} · grey dashes: planned width`, GREY)
        head.event.set(GAP_NAME[bead.state], tone)
      },
      readouts: (p) => {
        const { gap, bead } = zoRun(p)
        return [
          { label: 'Nozzle gap', value: mmFixed(gap, 2), tone: toneOf(bead.state === 'good', bead.state === 'squished') },
          { label: 'Line h × w', value: `${fixedText(bead.h, 2)} × ${fixedText(bead.w, 2)} mm` },
          { label: 'Squish', value: pct(bead.squish), tone: toneOf(bead.squish > 0.2 && bead.squish < 0.55, bead.squish > 0.05) },
          { label: 'Neighbour', value: bead.fuse < 0 ? `gap ${mmFixed(-bead.fuse, 2)}` : `fused ${mmFixed(bead.fuse, 2)}`, tone: toneOf(bead.fuse >= -0.02 && bead.ridge === 0, bead.fuse >= -0.05) },
        ]
      },
    }
  },
}

// --- Build surfaces: grip while hot vs shrink pull, and how the part lets go once cold. ---

const BS = { at: [-8.6, -4.4, 0] as V3, segs: 12, segW: 1.2, loop: 10, partW: 5, partH: 2.6 }
const RELEASE_NAME = { pops: 'pops off by itself as it cools', flex: 'flex the sheet and it pops off', scraper: 'stuck: needs a scraper', tears: 'bonded: tears the surface out' }
const RELEASE_TONE = { pops: POWER, flex: B_FIELD, scraper: HEAT, tears: HIGH_V }
const timesText = (m: number) => (m > 10 ? 'over ×10' : `×${fixedText(m, 1)}`)
const SURF_KEYS = Object.keys(BED_SURFACES) as BedSurface[]
const bsParams = (p: Params) => ({ s: pick(BED_SURFACES, p.surface, 'smoothPei') as BedSurface, mat: pick(COOL_FILAMENTS, p.mat, 'pla') as CoolFilament, c: n(p, 'bed'), prep: pick(SURFACE_PREP, p.prep, 'clean') as SurfacePrep })
const bsKey = (p: Params) => `${p.surface} ${p.mat} ${p.bed} ${p.prep}`
const bsRun = memoBy(bsKey, (p: Params) => {
  const q = bsParams(p)
  const v = surfaceView(q.s, q.mat, q.c, q.prep)
  const all = SURF_KEYS.map((s) => surfaceView(s, q.mat, q.c, q.prep))
  const dirt = v.grip / (BED_SURFACES[q.s].grip[q.mat] * gripTempFactor(q.mat, q.c))
  const grip = SURFACE_SWEEP.map((c) => BED_SURFACES[q.s].grip[q.mat] * gripTempFactor(q.mat, c) * dirt)
  const pull = SURFACE_SWEEP.map((c) => shrinkPull(q.mat, c))
  return { q, v, all, grip, pull }
})

export const bedAdhesionBuildSurfaces: Lesson = {
  id: 'bed-adhesion-build-surfaces',
  title: 'Build surfaces',
  tagline: 'Stick hard while hot, let go when cold',
  formula: (p) => {
    const { q, v } = bsRun(p)
    return `hold while printing: grip ${fixedText(v.grip, 2)} vs shrink pull ${fixedText(v.pull, 2)} N/mm² → ×${fixedText(v.margin, 1)} · cold: ${fixedText(v.cold, 2)} left (pops < ${RELEASE.pop}, flex < ${RELEASE.flex}, tears > ${v.tear}) · ${FILAMENTS[q.mat].name} Tg ${celsiusText(FILAMENTS[q.mat].tgC)} · relative values, typical`
  },
  legend: [
    { color: POWER, label: 'Grip at this bed temperature', shape: 'dot' },
    { color: HIGH_V, label: 'Shrink pull on the first layer', shape: 'dot' },
    { color: B_FIELD, label: 'Released by flexing the sheet', shape: 'dot' },
    { color: HEAT, label: 'Stuck after cooling', shape: 'dot' },
  ],
  points: [
    'A plastic sticks when the hot first layer wets the surface and stays a little soft. Warming the bed to near the plastic\'s glass transition (Filaments > Glass transition temp) keeps the bottom layers relaxed, so less shrink is locked in and less pulls on the edges. Much hotter and the bottom sags into elephant foot.',
    'PEI on a spring-steel sheet is the default: smooth PEI gives a glossy bottom, textured PEI a matte one and lets go more easily. As it cools the part shrinks and PEI\'s grip drops, so PLA pops off when you flex the sheet. Glass is flat and cheap but PLA barely holds on it cold and ABS/ASA hardly at all without help.',
    'PETG bonds too well to smooth PEI and bare glass: pulling it off rips out flakes of PEI or chips the glass. Use textured PEI, or a release layer: a thin coat of glue stick (water-soluble) or a light fingerprint film. Painter\'s tape and BuildTak-style sheets grip PLA cold but wear out.',
    'Grease from fingers ruins grip on PEI and glass. Wipe the plate with isopropyl alcohol (IPA), wash it with dish soap now and then, and hold the sheet by its edges. When corners still lift, the fix is more area at the corners: Brim and raft.',
  ],
  controls: [
    { kind: 'choice', key: 'surface', options: opts(namesOf(BED_SURFACES)), initial: 'smoothPei' },
    { kind: 'choice', key: 'mat', options: MATS, initial: 'pla' },
    { kind: 'slider', key: 'bed', label: 'Bed temperature', min: 25, max: 115, step: 5, initial: 60, format: (v) => `${v} °C` },
    { kind: 'choice', key: 'prep', options: opts(SURFACE_PREP), initial: 'clean' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const root = add(scene, new THREE.Group(), BS.at)
    root.rotation.set(0.35, -0.35, 0)
    const sheetM = new THREE.MeshStandardMaterial({ color: '#b98a3a', roughness: 0.5, metalness: 0.3, emissive: '#000000' })
    const segs = Array.from({ length: BS.segs }, () => add(root, new THREE.Mesh(new THREE.BoxGeometry(BS.segW * 1.02, 0.25, 7), sheetM)))
    const partM = new THREE.MeshStandardMaterial({ color: FILAMENT_COLOR, roughness: 0.5 })
    const part = add(root, new THREE.Group())
    const block = add(part, new THREE.Mesh(new THREE.BoxGeometry(BS.partW, 1, 3.4), partM))
    const flake = add(part, new THREE.Mesh(new THREE.BoxGeometry(BS.partW * 0.7, 0.12, 2.4), new THREE.MeshStandardMaterial({ color: '#e0b050', emissive: '#6a4a10', roughness: 0.4 })))
    const hole = add(root, new THREE.Mesh(new THREE.BoxGeometry(BS.partW * 0.7, 0.02, 2.4), new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9 })), [0, 0.14, 0])
    const tag = liveLabel(scene, [BS.at[0], BS.at[1] - 4.6, 0.6], { size: 0.32 })
    const T = PLOT.top
    const top = titledScope(scene, T.y, T.h, 'grip vs bed temperature', POWER, 0, PLOT.x, PLOT.w)
    top.lo.set(celsiusText(SURFACE_SWEEP[0]))
    top.hi.set(celsiusText(SURFACE_SWEEP[SURFACE_SWEEP.length - 1]))
    const gy = plotY(0, 2, T.h)
    const trG = top.s.trace(POWER, { samples: SURFACE_SWEEP.length, radius: 0.06 })
    const trP = top.s.trace(HIGH_V, { samples: SURFACE_SWEEP.length, radius: 0.06 })
    const cur = cursorBar(top.s, LABEL, 0.05)
    const tgBar = cursorBar(top.s, GREY, 0.04)
    addLabel(scene, 'left after cooling (relative)', [3.2, -6.6, 0.3], LABEL, 0.3, 'left')
    const bars = countBars(scene, [8.4, -7.6, 0], SURF_KEYS.map((s) => BED_SURFACES[s].name), 4.6, { row: 0.68, size: 0.26 })
    const st = { key: '', t: 0 }
    const c = new THREE.Color()
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, v, all, grip, pull } = bsRun(p)
        if (bsKey(p) !== st.key) [st.key, st.t] = [bsKey(p), 0]
        st.t = (st.t + dt) % BS.loop
        const t = st.t
        const grow = Math.min(1, t / 3)
        const heat = t < 3 ? 1 : Math.max(0, 1 - (t - 3) / 2)
        const flex = v.release === 'pops' || v.release === 'flex' ? Math.min(1, Math.max(0, (t - 5.2) / 2)) : v.release === 'tears' ? 0 : Math.min(0.25, Math.max(0, (t - 5.2) / 2))
        const kappa = 0.16 * flex + 1e-4
        segs.forEach((m, i) => {
          const s = (i - (BS.segs - 1) / 2) * BS.segW
          const th = kappa * s
          m.position.set(Math.sin(th) / kappa, (1 - Math.cos(th)) / kappa, 0)
          m.rotation.z = th
        })
        const bedC = q.c * heat + 25 * (1 - heat)
        ironbow(0.1 + 0.8 * Math.min(1, (bedC - 20) / 100) ** 2, c)
        sheetM.emissive.copy(c).multiplyScalar(0.35 * heat)
        const curl = v.holds ? 0 : 0.18 * grow
        block.scale.y = BS.partH * grow
        block.position.y = (BS.partH * grow) / 2 + 0.13
        part.rotation.z = curl
        const off = v.release === 'pops' ? Math.max(0, (t - 4.5) / 1.5) * 0.8 : v.release === 'flex' ? flex * 0.6 : v.release === 'tears' ? Math.max(0, (t - 5.2) / 1.5) * 2.4 : 0
        part.position.set(0, Math.min(2.4, off), 0)
        flake.visible = v.release === 'tears' && t > 5.2
        flake.position.y = 0.06
        hole.visible = flake.visible
        const uc = (c0: number) => (c0 - SURFACE_SWEEP[0]) / (SURFACE_SWEEP[SURFACE_SWEEP.length - 1] - SURFACE_SWEEP[0])
        trG.draw((s) => gy(sampleAt(grip)(s)), uc(q.c))
        trP.draw((s) => gy(sampleAt(pull)(s)), uc(q.c))
        cur(uc(q.c))
        tgBar(uc(FILAMENTS[q.mat].tgC))
        top.right.set(timesText(v.margin), v.holds ? POWER : HIGH_V)
        bars.set(
          all.map((a) => a.cold),
          all.map((a) => `${fixedText(a.cold, 2)} ${a.release}`),
          all.map((a) => RELEASE_TONE[a.release]),
          2,
        )
        SURF_KEYS.forEach((s, i) => bars.rename(i, BED_SURFACES[s].name, s === q.s ? LABEL : GREY))
        const phase = t < 3 ? 'printing' : t < 5 ? 'cooling' : 'removing'
        tag.set(phase === 'printing' ? (v.holds ? 'printing: holds down' : 'printing: corners lifting') : phase === 'cooling' ? 'cooling to room temperature' : RELEASE_NAME[v.release], phase === 'printing' ? (v.holds ? POWER : HIGH_V) : phase === 'cooling' ? LABEL : RELEASE_TONE[v.release])
        head.status.set(`${BED_SURFACES[q.s].name} · ${FILAMENTS[q.mat].name} · bed ${celsiusText(q.c)}`)
        head.sub.set(`${SURFACE_PREP[q.prep]} · loop: print, cool, remove · grey bar: Tg · relative, typical`, GREY)
        head.event.set(v.holds ? `holds ${timesText(v.margin)}, then ${RELEASE_NAME[v.release]}` : 'grip below shrink pull: the part comes loose mid-print', v.holds ? RELEASE_TONE[v.release] : HIGH_V)
      },
      readouts: (p) => {
        const { q, v } = bsRun(p)
        return [
          { label: 'Grip vs pull (hot)', value: timesText(v.margin), tone: toneOf(v.margin > 2, v.margin > 1) },
          { label: 'Suggested bed', value: celsiusText(FILAMENTS[q.mat].bedC), tone: Math.abs(q.c - FILAMENTS[q.mat].bedC) <= 10 ? 'ok' : 'warn' },
          { label: 'Left after cooling', value: fixedText(v.cold, 2), tone: v.release === 'tears' ? 'bad' : v.release === 'scraper' ? 'warn' : 'ok' },
          { label: 'Removal', value: v.release === 'pops' ? 'pops off' : v.release === 'flex' ? 'flex sheet' : v.release === 'scraper' ? 'scraper' : 'tears surface', tone: v.release === 'tears' ? 'bad' : v.release === 'scraper' ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- Brim and raft: a box corner peeling up; brim / mouse ears / raft add holding area at the corner. ---

const BR = { at: [-8.2, -4.4, 0] as V3, k: 0.17, loop: 9, ex: 12 }
const AID_KEYS = Object.keys(AIDS) as Aid[]
const brParams = (p: Params) => ({ mat: pick(COOL_FILAMENTS, p.mat, 'asa') as CoolFilament, aid: pick(AIDS, p.aid, 'none') as Aid, w: n(p, 'w'), uneven: n(p, 'uneven') })
const brKey = (p: Params) => `${p.mat} ${p.aid} ${p.w} ${p.uneven}`
const brRun = memoBy(brKey, (p: Params) => {
  const q = brParams(p)
  const v = cornerView(q.mat, q.aid, q.w, q.uneven)
  const each = AID_KEYS.map((a) => cornerView(q.mat, a, q.w, q.uneven))
  const brim = AID_SWEEP.map((b) => cornerView(q.mat, 'brim', b, q.uneven).margin)
  const ears = AID_SWEEP.map((b) => cornerView(q.mat, 'ears', b, q.uneven).margin)
  return { q, v, each, brim, ears }
})
const CLEANUP = { none: 'nothing to clean', brim: 'peel the brim, trim the edge', ears: 'snap off four discs', raft: 'rough underside, raft to break off' }

export const bedAdhesionBrimAndRaft: Lesson = {
  id: 'bed-adhesion-brim-and-raft',
  title: 'Brim and raft',
  tagline: 'More grip right where the corner wants to peel',
  formula: (p) => {
    const { v } = brRun(p)
    return `hold = grip × area within 10 mm of the corner × peel factor = ${fixedText(v.grip, 2)} × ${Math.round(v.area)} mm² × 0.06 = ${fixedText(v.hold, 1)} N vs shrink pull ${fixedText(v.pull, 1)} N → ×${fixedText(v.margin, 2)} · textured PEI, typical`
  },
  legend: [
    { color: RING, label: 'Brim: margin vs width', shape: 'dot' },
    { color: B_FIELD, label: 'Mouse ears: margin vs radius', shape: 'dot' },
    { color: POWER, label: 'Raft', shape: 'dot' },
    { color: HIGH_V, label: 'Corner peels below ×1 (red dashes)', shape: 'dot' },
  ],
  points: [
    'As each layer cools from near Tg to room temperature it shrinks, and a stack of shrinking layers bends the part like a bimetal strip. The pull ends up concentrated at the corners, where there is the least first layer to hold it: a long ABS or ASA box lifts at its corners first, PLA rarely does. Hotter beds, an enclosure and draft-free air are the first fixes (Build surfaces).',
    'A brim adds a few loops of first layer around the outline, touching it. Peeling now has to start at the brim\'s edge and drag the extra area at the corner with it. 3–8 mm is typical; it costs a fraction of a gram and peels off afterwards, sometimes leaving a lip to trim.',
    'Mouse ears are discs only at the corners: most of the brim\'s benefit for less cleanup. A raft prints a thick, loose base under the whole part with an air gap below the first real layer: it fills a bed that is far from flat and holds very well, but costs material and minutes, and the underside comes out rough.',
    'If the first layer lifts everywhere, it is the Z offset, the levelling or a dirty plate, not the corners. Warping, elephant foot and curling in full are in Print problems; rounding sharp corners in the model (Design for printing) helps too.',
  ],
  controls: [
    { kind: 'choice', key: 'mat', options: MATS, initial: 'asa' },
    { kind: 'choice', key: 'aid', options: opts(AIDS), initial: 'none' },
    { kind: 'slider', key: 'w', label: 'Brim width / ear radius', min: 0, max: 12, step: 0.5, initial: 5, format: (v) => mmFixed(v, 1) },
    { kind: 'slider', key: 'uneven', label: 'Bed unevenness', min: 0, max: 0.3, step: 0.02, initial: 0, format: (v) => mmFixed(v, 2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const k = BR.k
    const root = add(scene, new THREE.Group(), BR.at)
    root.rotation.set(0.5, -0.5, 0)
    const [L, W, H] = [60, 20, 30]
    add(root, new THREE.Mesh(new THREE.BoxGeometry(95 * k, 0.3, 45 * k), new THREE.MeshStandardMaterial({ color: '#3d3226', roughness: 0.7 })), [0, -0.15, 0])
    const body = add(root, new THREE.Group(), [(-L / 2 - 6) * k, 0, 0])
    const inner = add(body, new THREE.Group(), [(L / 2 + 6) * k, 0, 0])
    const partM = new THREE.MeshStandardMaterial({ color: FILAMENT_COLOR, roughness: 0.5 })
    const aidM = new THREE.MeshStandardMaterial({ color: '#ffb27a', roughness: 0.6, transparent: true, opacity: 0.9 })
    const part = add(inner, new THREE.Mesh(new THREE.BoxGeometry(L * k, 1, W * k), partM))
    const brim = add(inner, new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, 1), aidM))
    const raft = add(inner, new THREE.Mesh(new THREE.BoxGeometry((L + 10) * k, 0.5, (W + 10) * k), aidM))
    const ears = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ m: add(inner, new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.12, 28), aidM)), sx, sz })))
    const tag = liveLabel(scene, [-16.6, -9.8, 0.6], { size: 0.32, align: 'left' })
    const T = PLOT.top
    const top = titledScope(scene, T.y, T.h, 'hold / pull vs width', LABEL, 0, PLOT.x, PLOT.w)
    top.lo.set('0 mm')
    top.hi.set(mmFixed(AID_SWEEP[AID_SWEEP.length - 1], 0))
    const my = plotY(0, 4, T.h)
    top.s.level(HIGH_V).set(my(1))
    const trB = top.s.trace(RING, { samples: AID_SWEEP.length, radius: 0.06 })
    const trE = top.s.trace(B_FIELD, { samples: AID_SWEEP.length, radius: 0.06 })
    const raftLv = top.s.level(POWER)
    const cur = cursorBar(top.s, LABEL, 0.05)
    addLabel(scene, 'each aid at this width', [3.2, -6.6, 0.3], LABEL, 0.3, 'left')
    const bars = countBars(scene, [7.2, -7.6, 0], AID_KEYS.map((a) => AIDS[a]), 4.4, { row: 0.75, size: 0.28 })
    const st = { key: '', t: 0 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, v, each, brim: bm, ears: em } = brRun(p)
        if (brKey(p) !== st.key) [st.key, st.t] = [brKey(p), 0]
        st.t = (st.t + dt) % BR.loop
        const grow = Math.min(1, st.t / 6)
        const base = q.aid === 'raft' ? 0.5 : 0
        brim.visible = q.aid === 'brim' && q.w > 0
        brim.scale.set((L + 2 * q.w) * k, 1, (W + 2 * q.w) * k)
        brim.position.y = 0.06
        raft.visible = q.aid === 'raft'
        raft.position.y = 0.25
        ears.forEach(({ m, sx, sz }) => {
          m.visible = q.aid === 'ears' && q.w > 0
          m.scale.set(Math.max(0.01, q.w * k), 1, Math.max(0.01, q.w * k))
          m.position.set((sx * L * k) / 2, 0.07, (sz * W * k) / 2)
        })
        part.scale.y = H * k * grow
        part.position.y = base + (H * k * grow) / 2 + 0.1
        body.rotation.z = (v.lift * BR.ex * grow ** 2) / (L + 12)
        const u = q.w / AID_SWEEP[AID_SWEEP.length - 1]
        trB.draw((s) => my(sampleAt(bm)(s)), q.aid === 'brim' ? u : null)
        trE.draw((s) => my(sampleAt(em)(s)), q.aid === 'ears' ? u : null)
        raftLv.set(my(each[3].margin))
        cur(q.aid === 'brim' || q.aid === 'ears' ? u : null)
        top.right.set(`×${fixedText(v.margin, 2)}`, v.lifts ? HIGH_V : POWER)
        bars.set(
          each.map((e) => e.margin),
          each.map((e, i) => (i === 0 ? `×${fixedText(e.margin, 1)}` : `×${fixedText(e.margin, 1)} · ${fixedText(e.grams, 1)} g · ${Math.max(1, Math.round(e.minutes))} min`)),
          each.map((e) => (e.lifts ? HIGH_V : POWER)),
          4,
        )
        AID_KEYS.forEach((a, i) => bars.rename(i, AIDS[a], a === q.aid ? LABEL : GREY))
        tag.set(v.lifts ? `corner lifts ${mmFixed(v.lift * grow ** 2, 1)} as layers cool` : `corner held · ${CLEANUP[q.aid]}`, v.lifts ? HIGH_V : POWER)
        head.status.set(`Brim and raft · ${FILAMENTS[q.mat].name} box ${L} × ${W} × ${H} mm`)
        head.sub.set(`${AIDS[q.aid]}${q.aid === 'brim' || q.aid === 'ears' ? ` ${mmFixed(q.w, 1)}` : ''} · bed out by ${mmFixed(q.uneven, 2)} · lift exaggerated`, GREY)
        head.event.set(
          v.lifts ? (v.flat < 0.5 ? 'the bed is too uneven for the first layer to grip: a raft fills the dips' : 'shrink pull beats the grip at the corner: it peels') : `hold ${fixedText(v.hold, 1)} N against a pull of ${fixedText(v.pull, 1)} N`,
          v.lifts ? HIGH_V : POWER,
        )
      },
      readouts: (p) => {
        const { q, v } = brRun(p)
        return [
          { label: 'Corner hold / pull', value: `×${fixedText(v.margin, 2)}`, tone: toneOf(v.margin > 1.5, v.margin > 1) },
          { label: 'Hold · pull (typical)', value: `${fixedText(v.hold, 1)} · ${fixedText(v.pull, 1)} N` },
          { label: 'Extra material', value: q.aid === 'none' ? 'none' : `${fixedText(v.grams, 1)} g · ${Math.max(1, Math.round(v.minutes))} min` },
          { label: 'Cleanup', value: CLEANUP[q.aid], tone: q.aid === 'raft' ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
