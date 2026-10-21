import {
  ALLOYS,
  AlloyKey,
  BARREL_MM3,
  DESOLDER_METHODS,
  DesolderCfg,
  DesolderMethod,
  FILLET_MM3,
  FLUX,
  FLUX_KINDS,
  FluxKind,
  IDEAL_FEED_MM,
  IDLE_S,
  PADS,
  PadKey,
  SolderCfg,
  TIPS,
  TipKey,
  WETTING,
  contactAngle,
  desolderRun,
  filletProfile,
  fixedStepAt,
  fluxBurnRate,
  solderRun,
  steadyJointC,
} from '../../core/physics'
import { celsiusText, fixedText, mmFixed, ohmsText, pct, secsText, si } from '../../core/units'
import {
  B_FIELD,
  BENCH_VIEW,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  clamp01,
  columnGauge,
  lapseClock,
  liveLabel,
  memoBy,
  puzzleStage,
  solderBraid,
  solderPump,
  solderRig,
  solderLook,
  verdictTint,
} from '../fx'
import { LegendItem, Lesson, Params, Readout, Stage, n, namesOf, opts, pick, toneOf, verdictReadout } from '../types'

// --- Shared: a time-lapse of the joint at half speed, temperatures plotted top right, two gauges under it. ---

const SLOW = 0.5
const C = (c: number) => celsiusText(c)
const wetC = (a: AlloyKey) => ALLOYS[a].liquidusC + WETTING.superC
const lapseText = (now: number, seconds: number) => `${fixedText(now, 1)} / ${fixedText(seconds, 0)} s · ½×`
const benchTag = (scene: Parameters<typeof liveLabel>[0]) => liveLabel(scene, [-16.5, -11.2, 0.3], { size: 0.28, align: 'left' })
const tipSlider = (initial: number) => ({ kind: 'slider' as const, key: 'tipC', label: 'Tip temperature', min: 220, max: 450, step: 5, initial, format: (v: number) => `${v} °C` })
const PLOT_LEGEND: LegendItem[] = [
  { color: HEAT, label: 'Tip °C', shape: 'dot' },
  { color: RING, label: 'Joint (pad + lead) °C', shape: 'dot' },
  { color: LABEL, label: 'Barrel °C', shape: 'dot' },
  { color: POWER, label: 'Solder melts (liquidus)', shape: 'dot' },
  { color: B_FIELD, label: 'Wets well (+30 °C)', shape: 'dot' },
]
const peakGauge = (scene: Parameters<typeof columnGauge>[0], a: AlloyKey) =>
  columnGauge(scene, 1, {
    min: 25,
    max: 450,
    window: [wetC(a), 360],
    marks: [[ALLOYS[a].liquidusC, 'melts', POWER]],
    caption: 'Joint peak (green: wets, pad safe)',
    ticks: [[100, '100'], [200, '200'], [300, '300'], [400, '400 °C']],
  })

const key = (c: SolderCfg) => `${c.alloy}|${c.setC}|${c.tip}|${c.pad}|${c.flux}|${c.tinned}|${c.dwellS}|${c.feedMm}`
const solve = memoBy(key, solderRun)
type Run = ReturnType<typeof solderRun>

/** Reason for each failing check, in the learner's terms. */
function solderWhy(r: Run): string {
  const c = r.cfg
  const o = r.out
  const A = ALLOYS[c.alloy]
  switch (r.verdict.fail) {
    case 'nosolder':
      return `The wire never melted: the tip sagged to ${C(o.minTipC)}, the joint ${C(o.peakC)}, under ${C(A.liquidusC)}`
    case 'tip':
      return `Oxidised tip (${pct(o.oxide)} after ${IDLE_S} s bare at ${C(c.setC)}): solder beads off, heat can’t cross. Tin it, wipe on brass wool`
    case 'flux':
      return `No flux: oxide on pad and lead stops the solder wetting (${pct(o.wet)}). Use rosin-core wire`
    case 'cold':
      return `The joint peaked at ${C(o.peakC)}, under the ${C(A.liquidusC)} melting point: solder balled on the lead. ${c.pad === 'plane' ? 'The plane drains it: bigger tip' : 'Hotter or longer'}`
    case 'lifted':
      return `${C(o.peakC)} for too long: the pad used ${pct(o.dose)} of its heat budget and peeled off the FR4. Cooler, shorter`
    case 'wet':
      return `Only ${pct(o.wet)} wetted: the joint peaked at ${C(o.peakC)}, under ${C(wetC(c.alloy))} for long enough. Hold longer or go hotter`
    case 'burnt':
      return `Flux charred for ${secsText(o.charS)}: at ${C(o.peakC)} it burns off in ${secsText(1 / fluxBurnRate(o.peakC))}. Cooler tip, quicker joint`
    case 'little':
      return `${mmFixed(c.feedMm)} of wire fills ${pct(o.volFrac)} of the joint: the fillet doesn’t reach the pad edge. Feed ~${mmFixed(IDEAL_FEED_MM)}`
    case 'blob':
      return `${mmFixed(c.feedMm)} of wire is ${pct(o.volFrac)} of what it needs: a ball that hides the joint and can bridge. Feed less`
    case 'barrel':
      return `Barrel only ${pct(o.barrelFill)} full (IPC wants 75 %): the hole stayed under ${C(wetC(c.alloy))}. Hold a moment longer`
    default:
      return `Shiny ${fixedText(o.angleDeg, 0)}° fillet, barrel ${pct(o.barrelFill)} full, ${ohmsText(o.ohms)}: a joint that lasts`
  }
}

/** Joint rig driven by a soldering run: look, iron, wire, plot, tip tint. */
function solderStage(p2cfg: (p: Params) => SolderCfg, goal: (c: SolderCfg) => string, hint: string, row2: (scene: Parameters<typeof columnGauge>[0]) => { set: (r: Run) => void }, readouts: (r: Run) => Readout[]): Stage {
  const { scene, header } = puzzleStage()
  const rig = solderRig(scene)
  const clock = lapseClock(20, SLOW, 2)
  const gauges: Record<string, ReturnType<typeof peakGauge>> = {}
  const peak = (a: AlloyKey) => {
    gauges[a] ??= peakGauge(scene, a)
    for (const k of Object.keys(gauges)) gauges[k].group.visible = k === a
    return gauges[a]
  }
  const g2 = row2(scene)
  const tag = benchTag(scene)
  return {
    scene,
    view: BENCH_VIEW,
    frame(dt, p) {
      const c = p2cfg(p)
      const r = solve(c)
      const now = Math.min(clock(dt, key(c)), r.seconds)
      const f = fixedStepAt(r.frames, now, r.dt)
      const feeding = f.on && f.t >= WETTING.feedAtS && f.volMm3 < r.out.volMm3 - 1e-6
      rig.irons.show(c.tip)
      rig.irons.set(f.tipC, r.out.oxide)
      rig.pose(dt, f.on, feeding)
      rig.joint.set(solderLook(f))
      rig.plot.set(r.frames, r.dt, r.seconds, now, ALLOYS[c.alloy].liquidusC, wetC(c.alloy))
      rig.plot.tag.set(lapseText(now, r.seconds), LABEL)
      tag.set(f.on ? `iron on · tip ${C(f.tipC)} · joint ${C(f.jointC)}` : `iron off · joint ${C(f.jointC)}${f.jointC < ALLOYS[c.alloy].solidusC ? ' (solid)' : ''}`, f.on ? HEAT : GREY)
      peak(c.alloy).set(r.out.peakC, C(r.out.peakC), verdictTint(r.out.peakC >= wetC(c.alloy) && r.out.dose < 0.5, r.out.peakC >= ALLOYS[c.alloy].liquidusC && r.out.dose < 1))
      g2.set(r)
      header.set(goal(c), r.verdict, solderWhy(r), hint)
    },
    readouts: (p) => readouts(solve(p2cfg(p))),
  }
}

const TIP_NAMES = namesOf(TIPS)
const PAD_NAMES = namesOf(PADS)
const TIP_STATES = { tinned: 'Tip tinned and wiped', bare: `Tip left bare ${IDLE_S} s` }

// --- Iron and flux: heat has to cross tip → joint faster than the board drains it, with flux to strip the oxide. ---

const ifCfg = (p: Params): SolderCfg => ({
  alloy: 'sn63',
  setC: n(p, 'tipC'),
  tip: pick(TIP_NAMES, p.tip, 'chisel') as TipKey,
  pad: pick(PAD_NAMES, p.pad, 'signal') as PadKey,
  flux: pick(FLUX_KINDS, p.flux, 'core') as FluxKind,
  tinned: p.state !== 'bare',
  dwellS: 3,
  feedMm: 2.4,
})

export const solderingIronAndFlux: Lesson = {
  id: 'soldering-iron-and-flux',
  title: 'Iron and flux',
  tagline: 'Set the tip, the pad and the flux, then watch 3 s of heat flow decide whether the solder wets',
  formula: (p) => {
    const c = ifCfg(p)
    const T = TIPS[c.tip]
    const steady = steadyJointC(c.setC, c.tip, c.pad, T.wetWPerK)
    return `Joint → bench + (tip − bench) / (1 + G_board·(1/G_tip + 1/G_contact)) = ${C(steady)} held on · Sn63 melts at 183 °C, wets past ${C(wetC('sn63'))} · flux life ${secsText(1 / fluxBurnRate(Math.max(FLUX.activeC, solve(c).out.peakC)))}`
  },
  legend: PLOT_LEGEND,
  points: [
    'An iron doesn’t pour out temperature, it pours out heat. Heat flows heater → tip → joint like current through resistors: each link has a thermal resistance, the board drains the joint, and the joint settles where the two balance (Waves › Heat transfer › Thermal resistance).',
    'Tip size is the big lever. A 0.4 mm cone touches a tiny spot and stores little heat: on a ground-plane pad, which spreads heat into a copper sheet, it sags and the joint never melts. A 1.6–3.2 mm chisel carries far more. The station only regulates its sensor, so watch the tip trace dip and recover (3D printing › Temperature & cooling › Hotend PID tuning).',
    'Dry metal on metal barely conducts heat. A blob of molten solder between tip and joint (the “solder bridge”) multiplies the contact. That’s why you tin the tip and touch the wire where tip meets pad.',
    'Flux strips the oxide off pad and lead so solder can wet them. Rosin activates above ~150 °C and burns off: ~5 s at 300 °C, halving every 20 °C hotter. Too hot and it chars before the joint is done.',
    'An untinned hot tip oxidises in seconds (fully in ~30 s at 350 °C) and then won’t wet: solder beads off and the heat can’t cross. Keep it tinned, wipe it on brass wool, and drop the temperature when idle.',
  ],
  controls: [
    tipSlider(330),
    { kind: 'choice', key: 'tip', options: opts(TIP_NAMES), initial: 'chisel' },
    { kind: 'choice', key: 'pad', options: opts(PAD_NAMES), initial: 'signal' },
    { kind: 'choice', key: 'flux', options: opts(FLUX_KINDS), initial: 'core' },
    { kind: 'choice', key: 'state', options: opts(TIP_STATES), initial: 'tinned' },
  ],
  build: () =>
    solderStage(
      ifCfg,
      (c) => `${c.pad === 'plane' ? 'ground-plane' : 'signal-pad'} joint, wetted in 3 s`,
      'Hint: a bigger tip beats a hotter one on a ground plane',
      (scene) => {
        const g = columnGauge(scene, 2, {
          min: 0,
          max: 2,
          window: [0.2, 2],
          caption: 'Flux left (1 = one joint’s core)',
          ticks: [[0, '0'], [0.5, '0.5'], [1, '1'], [1.5, '1.5'], [2, '2']],
        })
        return { set: (r: Run) => g.set(Math.min(2, r.out.fluxLeft), fixedText(r.out.fluxLeft, 2), verdictTint(r.out.fluxLeft >= 0.2, r.out.fluxLeft >= 0.05)) }
      },
      (r) => [
        { label: 'Tip, lowest', value: C(r.out.minTipC), tone: toneOf(r.out.minTipC >= r.cfg.setC - 40, r.out.minTipC >= wetC(r.cfg.alloy)) },
        { label: 'Joint peak', value: C(r.out.peakC), tone: toneOf(r.out.peakC >= wetC(r.cfg.alloy) && r.out.dose < 0.5, r.out.peakC >= ALLOYS[r.cfg.alloy].liquidusC) },
        { label: 'Wetted', value: pct(r.out.wet), tone: toneOf(r.out.wet >= 0.9, r.out.wet >= 0.5) },
        verdictReadout(r.verdict),
      ],
    ),
}

// --- Good vs cold joints: temperature × time and the amount of solder decide the fillet. ---

const ALLOY_NAMES = namesOf(ALLOYS)
const gcCfg = (p: Params): SolderCfg => ({
  alloy: pick(ALLOY_NAMES, p.alloy, 'sn63') as AlloyKey,
  setC: n(p, 'tipC'),
  tip: 'chisel',
  pad: 'signal',
  flux: 'core',
  tinned: true,
  dwellS: n(p, 'dwell'),
  feedMm: n(p, 'feed'),
})

export const solderingGoodVsColdJoints: Lesson = {
  id: 'soldering-good-vs-cold-joints',
  title: 'Good vs cold joints',
  tagline: 'Pick the alloy, tip temperature, dwell and how much wire: get a shiny concave fillet, not a grey ball or a lifted pad',
  formula: (p) => {
    const r = solve(gcCfg(p))
    return `R_joint = ρ·L / (A·wetted) = ${ohmsText(r.out.ohms)} → at 2 A: ${si(2 * r.out.ohms, 'V', 2)} lost, ${si(4 * r.out.ohms, 'W', 2)} heat · solder ${fixedText(r.out.volMm3, 2)} of ${fixedText(BARREL_MM3 + FILLET_MM3, 2)} mm³ · angle ${fixedText(r.out.angleDeg, 0)}°`
  },
  legend: PLOT_LEGEND,
  points: [
    'A good joint is shiny (leaded) or satin (lead-free), concave, and climbs the lead: the solder wetted both pad and lead with a low contact angle, and filled the plated barrel (IPC asks ≥ 75 %).',
    'Sn63/Pb37 is eutectic: it melts at exactly 183 °C. SAC305 (lead-free) melts over 217–220 °C, so it needs a hotter tip (≈ 340–370 °C vs 315–345 °C) and wets more slowly. Wetting wants the joint ~30 °C past the liquidus.',
    'Cold joint: the solder melted on the tip but the pad and lead never got past the liquidus, so it sits on them as a dull, grainy ball. It may look connected and measure fine, then crack. The contact area is tiny, so its resistance is 100× higher: R = ρL/A (Electricity › Resistance › Resistivity and gauge, Ohm’s law › V = IR).',
    'Too hot or too long is a different failure: rosin chars black and the copper pad’s bond to the FR4 gives up (here 30 s at 300 °C, twice as fast every 20 °C). Heat the joint, feed solder into the joint (not the tip), wait for it to flow, lift — 2–4 s.',
    'Amount matters too: ~2.3 mm of 0.8 mm wire fills this joint. Too little leaves a starved fillet; too much makes a ball that hides whether it wetted and can bridge to the next pad.',
  ],
  controls: [
    { kind: 'choice', key: 'alloy', options: opts(ALLOY_NAMES), initial: 'sn63' },
    tipSlider(330),
    { kind: 'slider', key: 'dwell', label: 'Iron on the joint', min: 1, max: 8, step: 0.5, initial: 3, format: (v) => `${v} s` },
    { kind: 'slider', key: 'feed', label: 'Solder fed (0.8 mm wire)', min: 0.5, max: 6, step: 0.1, initial: 2.4, format: (v) => mmFixed(v) },
  ],
  build: () =>
    solderStage(
      gcCfg,
      (c) => `${c.alloy === 'sn63' ? 'leaded' : 'lead-free'} joint, wetted, pad intact`,
      'Hint: 2–4 s with the tip ~150 °C over the melting point',
      (scene) => {
        const g = columnGauge(scene, 2, {
          min: 0,
          max: 3,
          window: [0.7, 1.8],
          caption: 'Solder ÷ what the joint needs',
          ticks: [[0, '0'], [1, '1×'], [2, '2×'], [3, '3×']],
        })
        return { set: (r: Run) => g.set(Math.min(3, r.out.volFrac), `${fixedText(r.out.volFrac, 2)}×`, verdictTint(r.out.volFrac >= 0.7 && r.out.volFrac <= 1.8, r.out.volFrac >= 0.5 && r.out.volFrac <= 2.3)) }
      },
      (r) => [
        { label: 'Joint peak', value: C(r.out.peakC), tone: toneOf(r.out.peakC >= wetC(r.cfg.alloy) && r.out.dose < 0.5, r.out.peakC >= ALLOYS[r.cfg.alloy].liquidusC && r.out.dose < 1) },
        { label: 'Contact angle', value: `${fixedText(contactAngle(r.out.wet), 0)}°`, tone: toneOf(r.out.wet >= 0.9, r.out.wet >= 0.5) },
        { label: 'Joint R', value: ohmsText(r.out.ohms), tone: toneOf(r.out.wet >= 0.9, r.out.wet >= 0.5) },
        verdictReadout(r.verdict),
      ],
    ),
}

// --- Desoldering: braid wicks the pad, a pump empties the barrel; fresh solder first brings flux, a heat bridge and a lower melt. ---

const METHOD_NAMES = DESOLDER_METHODS
const FRESH_OPTS = { fresh: 'Add fresh Sn63 first', none: 'Straight onto the old joint' }
const dsCfg = (p: Params): DesolderCfg => ({
  method: pick(METHOD_NAMES, p.method, 'pump') as DesolderMethod,
  fresh: p.fresh === 'fresh',
  setC: n(p, 'tipC'),
  dwellS: n(p, 'dwell'),
})
const dsKey = (c: DesolderCfg) => `${c.method}|${c.fresh}|${c.setC}|${c.dwellS}`
const dsSolve = memoBy(dsKey, desolderRun)
type DsRun = ReturnType<typeof desolderRun>

function desolderWhy(r: DsRun): string {
  const o = r.out
  const c = r.cfg
  switch (r.verdict.fail) {
    case 'cold':
      return `The old joint only reached ${C(o.peakC)}, under its ${C(o.liquidusC)} melt: ${c.fresh ? 'hotter or longer' : 'oxidised and flux-free, it barely takes heat. Add fresh solder'}`
    case 'lifted':
      return `${C(o.peakC)} for ${c.dwellS} s used ${pct(o.dose)} of the pad’s heat budget: it lifted. Less heat, fewer tries`
    case 'stuck':
      return c.method === 'pump'
        ? `The pump fired with the barrel at ${C(o.barrelPeakC)}, under ${C(o.liquidusC)}: ${pct(o.barrelLeft)} still holds the lead. Heat until the whole joint melts`
        : `Braid cleared the pad but ${pct(o.barrelLeft)} stays in the barrel, held by the hole’s own capillary pull. Use a pump`
    case 'pad':
      return `${pct(o.topLeft)} of the fillet is still on the pad: ${c.method === 'braid' ? 'the braid is full, cut a fresh length' : 'add fresh solder and pump again'}`
    default:
      return `Barrel ${pct(1 - o.barrelLeft)} empty, pad clear, ${pct(o.dose)} of its heat budget used: the lead drops out`
  }
}

export const solderingDesoldering: Lesson = {
  id: 'soldering-desoldering',
  title: 'Desoldering',
  tagline: 'Get a lead-free through-hole part out: braid or pump, fresh solder first or not, how hot and how long',
  formula: (p) => {
    const r = dsSolve(dsCfg(p))
    return `T_liquidus ≈ (1 − f)·220 + f·183 = ${C(r.out.liquidusC)} (f = fresh Sn63 share) · barrel left ${pct(r.out.barrelLeft)}, pad ${pct(Math.min(1, r.out.topLeft))} · pad dose ${pct(r.out.dose)}`
  },
  legend: [
    ...PLOT_LEGEND.slice(0, 3),
    { color: POWER, label: 'Melts (mixed solder)', shape: 'dot' },
    { color: HIGH_V, label: 'Pad lifts at 100 %', shape: 'dot' },
  ],
  points: [
    'Factory joints are lead-free (SAC305, 220 °C), years old, their flux long gone and their surface oxidised. The iron touches them dry, so the heat barely crosses (Iron and flux).',
    'Add fresh solder first. Melting a bit of rosin-core Sn63 onto the old joint brings new flux, a molten heat bridge, and a mix that melts lower (by volume, about (1 − f)·220 + f·183 °C; real Pb–SAC mixes drop even faster). The joint you’re removing gets bigger, but it melts.',
    'Braid is fine copper weave soaked in flux: pressed on with the iron, molten solder wicks into it by capillary action. It clears a pad fast, but the plated barrel holds its solder with its own capillary pull, so through-holes drain slowly. Cut off the full part and use fresh braid.',
    'A spring pump sucks the whole joint in one shot, but only what is molten at that instant: heat until the barrel melts too (watch the barrel trace cross the line), then fire as you lift the iron. If it fails, add solder and repeat rather than heating longer.',
    'Each try heats the pad again; the bond to the FR4 has a heat budget (Good vs cold joints). On ground-plane pads, preheat or use a bigger tip.',
  ],
  controls: [
    { kind: 'choice', key: 'method', options: opts(METHOD_NAMES), initial: 'pump' },
    { kind: 'choice', key: 'fresh', options: opts(FRESH_OPTS), initial: 'none' },
    tipSlider(340),
    { kind: 'slider', key: 'dwell', label: 'Heat before lifting / firing', min: 1, max: 8, step: 0.5, initial: 2, format: (v) => `${v} s` },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const rig = solderRig(scene)
    const pump = solderPump(scene)
    const braid = solderBraid(scene, [rig.pts.iron(0)[0] + 1.2, rig.pts.iron(0)[1] - 0.7, 0.6], 3)
    const clock = lapseClock(20, SLOW, 2)
    const barrelG = columnGauge(scene, 1, {
      min: 0,
      max: 1,
      window: [0, 0.3],
      caption: 'Solder left in the barrel',
      ticks: [[0, '0'], [0.5, '50 %'], [1, '100 %']],
    })
    const doseG = columnGauge(scene, 2, {
      min: 0,
      max: 1.5,
      window: [0, 0.5],
      marks: [[1, 'lifts', HIGH_V]],
      caption: 'Pad heat budget used',
      ticks: [[0, '0'], [0.5, '50 %'], [1, '100 %'], [1.5, '150 %']],
    })
    const tag = benchTag(scene)
    return {
      scene,
      view: BENCH_VIEW,
      frame(dt, p) {
        const c = dsCfg(p)
        const r = dsSolve(c)
        const now = Math.min(clock(dt, dsKey(c)), r.seconds)
        const f = fixedStepAt(r.frames, now, r.dt)
        const isBraid = c.method === 'braid'
        const feeding = c.fresh && f.on && f.t < 0.3 + 0.6
        rig.irons.show('chisel')
        rig.irons.set(f.tipC, 0)
        rig.pose(dt, f.on, feeding, c.fresh)
        pump.group.visible = !isBraid
        braid.group.visible = isBraid
        pump.place(rig.pts.wire(f.on ? 0.4 : 1.2))
        pump.set(f.on)
        braid.set(f.braidMm3 / 2.5)
        const wet = 0.6
        const prof = filletProfile(f.topMm3, contactAngle(wet), wet, f.topMm3 / FILLET_MM3)
        rig.joint.set({ barrel: f.barrelMm3 / BARREL_MM3, fillet: f.topMm3 > 0.005 ? prof.points : [], wet: f.jointC >= f.liquidusC ? 0.9 : 0.35, flux: f.flux, char: 0, jointC: f.jointC, lift: clamp01((r.out.dose - 0.9) / 0.3) * (f.on ? now / c.dwellS : 1) })
        rig.plot.set(r.frames, r.dt, r.seconds, now, f.liquidusC, f.liquidusC + WETTING.superC)
        rig.plot.tag.set(lapseText(now, r.seconds), LABEL)
        tag.set(f.on ? `heating · joint ${C(f.jointC)} · barrel ${C(f.barrelC)}` : isBraid ? 'braid lifted' : 'pump fired', f.on ? HEAT : GREY)
        barrelG.set(r.out.barrelLeft, pct(r.out.barrelLeft), verdictTint(r.out.barrelLeft <= 0.3, r.out.barrelLeft <= 0.5))
        doseG.set(Math.min(1.5, r.out.dose), pct(r.out.dose), verdictTint(r.out.dose < 0.5, r.out.dose < 1))
        header.set('free the lead-free resistor lead', r.verdict, desolderWhy(r), 'Hint: fresh solder first, then heat until the barrel melts')
      },
      readouts: (p) => {
        const r = dsSolve(dsCfg(p))
        return [
          { label: 'Melts at', value: C(r.out.liquidusC) },
          { label: 'Barrel left', value: pct(r.out.barrelLeft), tone: toneOf(r.out.barrelLeft <= 0.3, r.out.barrelLeft <= 0.5) },
          { label: 'Pad budget', value: pct(r.out.dose), tone: toneOf(r.out.dose < 0.5, r.out.dose < 1) },
          verdictReadout(r.verdict),
        ]
      },
    }
  },
}
