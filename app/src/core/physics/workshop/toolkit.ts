// Tool kit, Starter bench: which tools a robo-car build needs, step by step, inside a budget, with the safety kit that
// comes with an iron, cutters or a charger. Prices are rough illustrative ranges (USD, hobby market), not quotes.
import { puzzleVerdict } from '../challenges/verdict'
import { OXIDE, ironIdle } from './iron'
import { ALLOYS } from './soldering'
import { doublingRate } from './technique'

/** Price range [low, high], USD; illustrative only. */
export type Usd = [number, number]
export const usdMid = (r: Usd) => (r[0] + r[1]) / 2
export const usdSum = (rs: readonly Usd[]): Usd => rs.reduce<Usd>((s, r) => [s[0] + r[0], s[1] + r[1]], [0, 0])
/** Range × quantity. */
export const usdTimes = (r: Usd, qty: number): Usd => [r[0] * qty, r[1] * qty]

export interface Tool {
  name: string
  usd: Usd
  /** Protective kit rather than a working tool. */
  safety: boolean
  /** Lessons that use it (category › topic › lesson). */
  lessons: string[]
}

export const TOOLS = {
  station: { name: 'Temperature-controlled iron', usd: [25, 45], safety: false, lessons: ['Soldering › Iron and flux', 'Soldering › Good vs cold joints'] },
  penIron: { name: 'Fixed 30 W pen iron', usd: [8, 15], safety: false, lessons: ['Soldering › Iron and flux'] },
  solder: { name: 'Sn63 rosin-core solder', usd: [8, 15], safety: false, lessons: ['Soldering › Good vs cold joints'] },
  desolder: { name: 'Solder pump + braid', usd: [6, 12], safety: false, lessons: ['Soldering › Desoldering'] },
  dmm: { name: 'Multimeter', usd: [15, 30], safety: false, lessons: ['Using a multimeter › Continuity test', 'Using a multimeter › Voltage test'] },
  cutters: { name: 'Flush cutters', usd: [5, 12], safety: false, lessons: ['Crimping & connectors › Crimping a pin'] },
  strippers: { name: 'Wire strippers', usd: [8, 20], safety: false, lessons: ['Crimping & connectors › Crimping a pin'] },
  crimper: { name: 'Ratchet crimper', usd: [20, 35], safety: false, lessons: ['Crimping & connectors › Crimping a pin'] },
  psu: { name: 'Bench PSU, current limit', usd: [40, 70], safety: false, lessons: ['Robo-car › Chassis & power', 'Won’t power on › Short circuit'] },
  charger: { name: 'Balance charger', usd: [25, 50], safety: false, lessons: ['Safety › LiPo safety'] },
  lipoBag: { name: 'LiPo bag', usd: [5, 12], safety: true, lessons: ['Safety › LiPo safety'] },
  glasses: { name: 'Safety glasses', usd: [3, 8], safety: true, lessons: ['Safety › Fume and eye protection'] },
  extractor: { name: 'Fume extractor', usd: [15, 30], safety: true, lessons: ['Safety › Fume and eye protection'] },
  breadboard: { name: 'Breadboard + jumpers', usd: [6, 12], safety: false, lessons: ['Breadboarding › Rails and rows', 'Breadboarding › Tidy wiring'] },
  caliper: { name: 'Digital caliper', usd: [10, 25], safety: false, lessons: ['Measuring › Reading a caliper', 'Measuring › Tolerances'] },
  hands: { name: 'Helping hands', usd: [8, 15], safety: false, lessons: ['Soldering › Good vs cold joints'] },
} satisfies Record<string, Tool>
export type ToolId = keyof typeof TOOLS

const IRONS: ToolId[] = ['station', 'penIron']

/** Robo-car build steps (Robot projects › Robo-car + the Workshop lessons); each needs one tool from every group. */
export const BUILD_STEPS = {
  prototype: { name: 'Breadboard the circuit', needs: [['breadboard']] },
  headers: { name: 'Solder header pins', needs: [IRONS, ['solder']] },
  fix: { name: 'Fix a bridged joint', needs: [IRONS, ['desolder']] },
  leads: { name: 'Crimp the motor leads', needs: [['cutters'], ['strippers'], ['crimper']] },
  check: { name: 'Continuity + rail checks', needs: [['dmm']] },
  power: { name: 'Current-limited power-up', needs: [['psu']] },
  charge: { name: 'Balance-charge the pack', needs: [['charger']] },
  fit: { name: 'Measure the printed fits', needs: [['caliper']] },
} satisfies Record<string, { name: string; needs: ToolId[][] }>
export type BuildStepId = keyof typeof BUILD_STEPS
const ALL_STEPS = Object.keys(BUILD_STEPS) as BuildStepId[]

/** Budget tiers: what you plan to get done and what you can spend. */
export const BENCH_TIERS = {
  first: { name: '$120: breadboard + headers', usd: 120, steps: ['prototype', 'headers', 'check'] },
  wire: { name: '$240: wire and power the car', usd: 240, steps: ['prototype', 'headers', 'fix', 'leads', 'check', 'power'] },
  full: { name: '$320: the whole robo-car', usd: 320, steps: ALL_STEPS },
} satisfies Record<string, { name: string; usd: number; steps: BuildStepId[] }>
export type BenchTier = keyof typeof BENCH_TIERS

/** Lesson pickers: each option adds a set of tools. */
export const KIT_CHOICES = {
  iron: {
    none: { name: 'No iron', tools: [] },
    pen: { name: 'Pen iron 30 W + solder', tools: ['penIron', 'solder'] },
    station: { name: 'Iron station + solder', tools: ['station', 'solder'] },
    rework: { name: 'Station + solder + pump & braid', tools: ['station', 'solder', 'desolder'] },
  },
  wire: {
    none: { name: 'No wire tools', tools: [] },
    cutters: { name: 'Flush cutters', tools: ['cutters'] },
    strip: { name: 'Cutters + strippers', tools: ['cutters', 'strippers'] },
    crimp: { name: 'Cutters + strippers + crimper', tools: ['cutters', 'strippers', 'crimper'] },
  },
  test: {
    none: { name: 'No meter', tools: [] },
    dmm: { name: 'Multimeter', tools: ['dmm'] },
    psu: { name: 'Multimeter + bench PSU', tools: ['dmm', 'psu'] },
  },
  battery: {
    none: { name: 'No charger', tools: [] },
    charger: { name: 'Balance charger', tools: ['charger'] },
    bagged: { name: 'Balance charger + LiPo bag', tools: ['charger', 'lipoBag'] },
  },
  safety: {
    none: { name: 'No safety kit', tools: [] },
    glasses: { name: 'Safety glasses', tools: ['glasses'] },
    extract: { name: 'Glasses + fume extractor', tools: ['glasses', 'extractor'] },
  },
  extras: {
    none: { name: 'No extras', tools: [] },
    breadboard: { name: 'Breadboard kit', tools: ['breadboard'] },
    caliper: { name: 'Breadboard + caliper', tools: ['breadboard', 'caliper'] },
    hands: { name: 'Breadboard + caliper + helping hands', tools: ['breadboard', 'caliper', 'hands'] },
  },
} satisfies Record<string, Record<string, { name: string; tools: ToolId[] }>>
export type KitGroup = keyof typeof KIT_CHOICES
export type KitPicks = { [G in KitGroup]: keyof (typeof KIT_CHOICES)[G] }

/** Tools from one pick per group. */
export const kitTools = (picks: KitPicks): ToolId[] =>
  (Object.keys(KIT_CHOICES) as KitGroup[]).flatMap((g) => (KIT_CHOICES[g] as Record<string, { tools: ToolId[] }>)[picks[g] as string].tools)

/** Unregulated pen iron: heater always on, so the tip idles far above a station's set point (illustrative ~420 °C). */
export const PEN_IRON = { watts: 30, idleC: 420 }
/** Suggested first power-up on a bench PSU: the 2S pack's nominal volts, a current limit well under one TT stall. */
export const PSU_FIRST_POWER = { volts: 7.4, limitA: 0.3 }
/** Station set point used for the comparison. */
export const STATION_SET_C = 330
/** Seconds for an untinned tip at `tipC` to oxidise right over (`tipOxide` reaches 1). */
export const oxideFullS = (tipC: number) => 1 / doublingRate(tipC, OXIDE.refC, OXIDE.fullS, OXIDE.doubleC)

export interface StepCheck {
  id: BuildStepId
  name: string
  ok: boolean
  /** One tool per missing group (the cheapest). */
  missing: ToolId[]
  /** Tools from the kit used for it. */
  uses: ToolId[]
}

/** Which steps a tool set can do. */
export function stepChecks(tools: readonly ToolId[], steps: readonly BuildStepId[] = ALL_STEPS): StepCheck[] {
  const has = new Set(tools)
  return steps.map((id) => {
    const S = BUILD_STEPS[id]
    const missing: ToolId[] = []
    const uses: ToolId[] = []
    for (const group of S.needs as ToolId[][]) {
      const got = group.find((t) => has.has(t))
      if (got) uses.push(got)
      else missing.push(group.reduce((a, b) => (usdMid(TOOLS[b].usd) < usdMid(TOOLS[a].usd) ? b : a)))
    }
    return { id, name: S.name, ok: missing.length === 0, missing, uses }
  })
}

/** The bench for a tier: steps done or blocked, safety kit, cost against the budget, and how hot the iron idles. */
export function benchRun(tier: BenchTier, tools: readonly ToolId[]) {
  const T = BENCH_TIERS[tier]
  const has = new Set(tools)
  const kit = [...has]
  const steps = stepChecks(kit, T.steps)
  const blocked = steps.filter((s) => !s.ok)
  const cost = usdSum(kit.map((t) => TOOLS[t].usd))
  const mid = usdMid(cost)
  const soldering = IRONS.some((t) => has.has(t))
  const cutting = has.has('cutters') || soldering
  const penOnly = has.has('penIron') && !has.has('station')
  const ironC = soldering ? (penOnly ? PEN_IRON.idleC : ironIdle(STATION_SET_C, 'chisel').tipC) : null
  const unused = kit.filter((t) => !TOOLS[t].safety && !steps.some((s) => s.uses.includes(t)))
  const verdict = puzzleVerdict([
    { id: 'glasses', ok: !cutting || has.has('glasses') },
    { id: 'fumes', ok: !soldering || has.has('extractor') },
    { id: 'bag', ok: !has.has('charger') || has.has('lipoBag') },
    { id: 'blocked', ok: blocked.length === 0, near: blocked.length === 1 },
    { id: 'budget', ok: mid <= T.usd, near: mid <= 1.1 * T.usd },
    { id: 'iron', ok: !penOnly, near: true },
  ])
  return {
    tier,
    T,
    tools: kit,
    steps,
    blocked,
    cost,
    mid,
    left: T.usd - mid,
    soldering,
    cutting,
    penOnly,
    ironC,
    hotBy: ironC === null ? 0 : ironC - ALLOYS.sn63.tipC[1],
    oxideS: ironC === null ? Infinity : oxideFullS(ironC),
    unused,
    verdict,
  }
}
export type BenchRun = ReturnType<typeof benchRun>
