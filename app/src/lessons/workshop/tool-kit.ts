import * as THREE from 'three/webgpu'
import {
  ALLOYS,
  BENCH_TIERS,
  BREADBOARDS,
  BenchRun,
  BenchTier,
  BomCfg,
  BomRun,
  BuckKind,
  CAR_BOM,
  CAR_PACKS,
  CHASSIS,
  CONNECTORS,
  CONNECTOR_SPECS,
  CarPack,
  ConnectorId,
  DCDC_MODULES,
  DRIVERS,
  DriverChip,
  KIT_CHOICES,
  KitGroup,
  KitPicks,
  PEN_IRON,
  PSU_FIRST_POWER,
  ROBOCAR,
  SPARE_LEVELS,
  STATION_SET_C,
  SpareLevel,
  TOOLS,
  ToolId,
  Usd,
  awgDiameter,
  benchRun,
  bomRun,
  kitTools,
  plugLapseS,
  plugTempAt,
  robocarParts,
} from '../../core/physics'
import { celsiusText, fixedText } from '../../core/units'
import { V3, add } from '../../models/kit'
import {
  BENCH_TOP_Y,
  BENCH_VIEW,
  DRIVER_BOARD_COLOR,
  GREY,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  benchExtractor,
  benchSupply,
  benchTop,
  breadboardModel,
  cableRun,
  caliper,
  chassisModel,
  columnGauge,
  dcdcModule,
  emptyGroup,
  flatBox,
  glowMat,
  handTool,
  helpingHands,
  hobbyCharger,
  i2cBreakout,
  ironStand,
  ironStation,
  lapseClock,
  lipoBag,
  lipoPack,
  liveLabel,
  memoBy,
  multimeter,
  packHolder,
  pegboard,
  plugPair,
  puzzleStage,
  safetyGlasses,
  setGlow,
  slotPad,
  solderPump,
  solderWire,
  solderingIron,
  verdictTint,
} from '../fx'
import { LegendItem, Lesson, Params, Stage, n, namesOf, opts, pick, toneOf, verdictReadout } from '../types'

const C = (c: number) => celsiusText(c)
const usd = (v: number) => `$${fixedText(v, 2)}`
const usdWhole = (v: number) => `$${Math.round(v)}`
const usdRange = (r: Usd) => (r[1] < 20 ? `$${fixedText(r[0], 2)}–${fixedText(r[1], 2)}` : `$${Math.round(r[0])}–${Math.round(r[1])}`)
const PRICE_NOTE = 'prices: rough illustrative ranges, not quotes'
const linkText = (s: string) => s.replace(' › ', ': ')

// --- Starter bench: a budget tier and a pick per tool group; the build steps the bench can do, played in turn. ---

const TIER_NAMES = namesOf(BENCH_TIERS)
const GROUPS = Object.keys(KIT_CHOICES) as KitGroup[]
const SB_INITIAL: KitPicks = { iron: 'pen', wire: 'strip', test: 'dmm', battery: 'charger', safety: 'glasses', extras: 'breadboard' }
const sbCfg = (p: Params) => ({
  tier: pick(BENCH_TIERS, p.tier, 'full') as BenchTier,
  picks: Object.fromEntries(GROUPS.map((g) => [g, pick(KIT_CHOICES[g] as Record<string, unknown>, p[g], SB_INITIAL[g] as string)])) as KitPicks,
})
type SbCfg = ReturnType<typeof sbCfg>
const sbKey = (c: SbCfg) => `${c.tier}|${GROUPS.map((g) => c.picks[g]).join('|')}`
const sbSolve = memoBy(sbKey, (c: SbCfg) => benchRun(c.tier, kitTools(c.picks)))

const SHORT: Record<ToolId, string> = {
  station: 'iron station',
  penIron: 'pen iron',
  solder: 'solder',
  desolder: 'pump + braid',
  dmm: 'multimeter',
  cutters: 'cutters',
  strippers: 'strippers',
  crimper: 'crimper',
  psu: 'bench PSU',
  charger: 'charger',
  lipoBag: 'LiPo bag',
  glasses: 'glasses',
  extractor: 'extractor',
  breadboard: 'breadboard',
  caliper: 'caliper',
  hands: 'helping hands',
}
const toolList = (ts: readonly ToolId[]) => ts.map((t) => SHORT[t]).join(', ')
const wholeRange = (r: Usd) => `$${Math.round(r[0])}–${Math.round(r[1])}`
const toolPrice = (t: ToolId) => wholeRange(TOOLS[t].usd)

function benchWhy(r: BenchRun): string {
  switch (r.verdict.fail) {
    case 'glasses':
      return `${r.soldering ? 'An iron' : 'Cutters'}, no glasses: clipped leads fly at your eyes. Add glasses (${toolPrice('glasses')})`
    case 'fumes':
      return 'An iron, no extractor: rosin fume goes straight to your face. Add one'
    case 'bag':
      return 'A LiPo charger, no LiPo bag: charge in a bag, on tile, attended'
    case 'blocked': {
      const b = r.blocked[0]
      return `${r.blocked.length} step${r.blocked.length > 1 ? 's' : ''} blocked: ${b.name.toLowerCase()} needs ${toolList(b.missing)}`
    }
    case 'budget':
      return `${usdWhole(r.mid)} typical, over ${usdWhole(r.T.usd)}${r.unused.length ? `: not needed yet: ${toolList(r.unused.slice(0, 3))}` : ''}`
    case 'iron':
      return `Pen iron idles ~${C(r.ironC!)}, ${fixedText(r.hotBy, 0)} °C too hot: tip oxide in ${fixedText(r.oxideS, 0)} s. A station holds ${C(STATION_SET_C)}`
    default:
      return `All ${r.steps.length} steps covered, safety kit in: ${usdWhole(r.mid)} typical of ${usdWhole(r.T.usd)}`
  }
}

const SB_LEGEND: LegendItem[] = [
  { color: POWER, label: 'Tool in use for this step', shape: 'dot' },
  { color: HIGH_V, label: 'Missing: the step is blocked', shape: 'dot' },
  { color: RING, label: 'Close miss / not needed yet', shape: 'dot' },
  { color: GREY, label: 'Prices: rough ranges, not quotes', shape: 'dot' },
]
const STEP_S = 2
const IRON_TILT = 0.6
const PEG_Z = -4.1
const B = BENCH_TOP_Y

interface Slot {
  /** Pad centre and size; flat pads lie on the bench. */
  pad: V3
  size: [number, number]
  flat: boolean
  tag: V3
}
const peg = (x: number, y: number, w: number, h: number): Slot => ({ pad: [x, y, PEG_Z - 0.3], size: [w, h], flat: false, tag: [x, 2.9, PEG_Z] })
const bench = (x: number, w: number): Slot => ({ pad: [x, B + 1.8, PEG_Z - 0.3], size: [w, 3.6], flat: false, tag: [x, B - 0.32, 2.15] })
const SLOTS: Record<ToolId | 'iron', Slot> = {
  cutters: peg(-16.2, -0.3, 1.4, 3.6),
  strippers: peg(-14.2, -0.3, 1.4, 3.6),
  crimper: peg(-12.1, -0.5, 1.6, 4.4),
  solder: peg(-9.8, 0.7, 2.6, 2.6),
  desolder: peg(-7.6, -0.1, 1.2, 3.4),
  caliper: peg(-3.6, 1.4, 6.2, 1.6),
  glasses: peg(1.6, 1.4, 2.8, 1.4),
  breadboard: bench(-15.2, 4.4),
  dmm: bench(-11.6, 2.6),
  iron: bench(-8.2, 4.4),
  extractor: bench(-4.6, 2.4),
  psu: bench(-1.9, 2.8),
  charger: bench(1.4, 3),
  lipoBag: { pad: [1.4, B + 0.03, 2.3], size: [3, 1.4], flat: true, tag: [1.4, B - 1.05, 2.15] },
  hands: { pad: [-13.4, B + 0.03, 2.3], size: [2, 1.4], flat: true, tag: [-13.4, B - 1.05, 2.15] },
  station: bench(-8.2, 4.4),
  penIron: bench(-8.2, 4.4),
}
const slotOf = (t: ToolId): ToolId | 'iron' => (t === 'station' || t === 'penIron' ? 'iron' : t)

export const toolKitStarterBench: Lesson = {
  id: 'tool-kit-starter-bench',
  title: 'Starter bench',
  tagline: 'Pick a budget and a tool from each group, then watch the robo-car build steps play on your bench: which ones the kit can do, which are blocked, what it costs',
  formula: (p) => {
    const r = sbSolve(sbCfg(p))
    return `kit = Σ tools: ${usdRange(r.cost)}, typical ${usdWhole(r.mid)} vs budget ${usdWhole(r.T.usd)} · a step is possible ⇔ one tool from each group it needs · pen iron idles ~${C(PEN_IRON.idleC)}: oxide doubles per 40 °C (${PRICE_NOTE})`
  },
  legend: SB_LEGEND,
  points: [
    'Buy for the build in front of you, not for every project at once. Each robo-car step needs certain tools: breadboarding needs a breadboard and jumpers (Breadboarding › Rails and rows), header pins need an iron and solder (Soldering › Iron and flux), a bridged joint needs a pump or braid (Soldering › Desoldering), motor leads need cutters, strippers and a ratchet crimper (Crimping & connectors › Crimping a pin), checking a build needs a multimeter (Using a multimeter).',
    'An iron is the one tool worth paying a little more for. A temperature-controlled iron (a cheap station or a USB-C pen with a sensor) holds ~330 °C. A fixed-wattage pen iron has no sensor: its heater is always on, so it idles far hotter, oxidises its tip in seconds and lifts pads, then sags on a big joint (Soldering › Good vs cold joints). The idle temperature used here is illustrative.',
    'Safety kit comes with the tools, not later: an iron or cutters means safety glasses, an iron means a fume extractor at the joint, a LiPo charger means a LiPo bag and a non-flammable spot (Safety › Fume and eye protection, Safety › LiPo safety). They’re cheap next to what they protect.',
    `A bench PSU with a current limit is the best first power-up: set ${PSU_FIRST_POWER.volts} V and ${PSU_FIRST_POWER.limitA} A, and a short shows up as the CC lamp instead of smoke (Robo-car › Chassis & power, Won’t power on › Short circuit). A caliper measures motor shafts and printed fits (Measuring › Reading a caliper). Helping hands are nice, not needed.`,
    'Prices are rough illustrative ranges (USD, hobby market), not quotes: they change by shop, country and year. Compare the typical total with your budget, and start with the stage you’ll actually build.',
  ],
  controls: [
    { kind: 'choice', key: 'tier', options: opts(TIER_NAMES), initial: 'full' },
    ...GROUPS.map((g) => ({ kind: 'choice' as const, key: g, options: opts(namesOf(KIT_CHOICES[g])), initial: SB_INITIAL[g] as string })),
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    benchTop(scene).set('wood')
    pegboard(scene, -17.5, 3, B, 3.2)
    const models: Partial<Record<ToolId, THREE.Object3D>> = {}
    models.cutters = handTool(scene, [-16.2, 1, PEG_Z], 'cutters', 0.8)
    models.strippers = handTool(scene, [-14.2, 1, PEG_Z], 'strippers', 0.8)
    models.crimper = handTool(scene, [-12.1, 1.2, PEG_Z], 'crimper', 0.8)
    const spool = solderWire(scene, [-9.8, 0.7, PEG_Z])
    spool.set([-9.8, -0.6, PEG_Z], false)
    models.solder = spool.group
    const pump = solderPump(scene, 0, 0.17)
    pump.place([-7.6, -1.7, PEG_Z])
    models.desolder = pump.group
    const cal = caliper(scene, 0.12, [-6, 1.6, PEG_Z])
    cal.set(18.5)
    models.caliper = cal.group
    models.glasses = safetyGlasses(scene, [1.6, 1.4, PEG_Z], 1)

    models.breadboard = breadboardModel(scene, BREADBOARDS.half, [-15.2, B + 0.35, 0.3], 0.13, 0.9).group
    const meter = multimeter()
    add(scene, meter.group, [-11.6, B + 1.75, 0.3]).scale.setScalar(0.28)
    meter.group.rotation.x = -0.12
    meter.display.set('7.40')
    models.dmm = meter.group
    const station = ironStation(scene, [-8.9, B, 0.3], 0.85)
    models.station = station.group
    const stand = ironStand(scene, [-6.9, B, 0.3], IRON_TILT, 4.4)
    stand.group.scale.setScalar(0.5)
    const iron = solderingIron(scene, 'chisel', 1.2, IRON_TILT)
    iron.group.scale.setScalar(0.3)
    iron.place([-6.9 + 0.45, B + 0.35, 0.3])
    const ext = benchExtractor(scene, [-4.6, B + 1, 0.3], 1.8)
    models.extractor = ext.group
    const psu = benchSupply(scene, [-1.9, B, 0.3], 0.75)
    models.psu = psu.group
    const charger = hobbyCharger(scene, [1.4, B, 0])
    charger.group.scale.setScalar(0.5)
    charger.screen('LiPo 2S 2.2A', 'READY', LABEL)
    models.charger = charger.group
    const bag = add(scene, new THREE.Group())
    lipoBag(bag, [1.4, B, 2.3], [3, 1.2, 1.3])
    lipoPack(bag, [1.4, B + 0.05, 2.3]).group.scale.setScalar(0.32)
    models.lipoBag = bag
    models.hands = helpingHands(scene, [-13.4, B, 2.3], 0.6)

    const tagKeys = (Object.keys(SLOTS) as (ToolId | 'iron')[]).filter((k) => k !== 'station' && k !== 'penIron')
    const pads = Object.fromEntries(tagKeys.map((k) => [k, slotPad(scene, SLOTS[k].pad, SLOTS[k].size, SLOTS[k].flat)])) as Record<string, ReturnType<typeof slotPad>>
    const tags = Object.fromEntries(
      tagKeys.map((k) => {
        const [x, y, z] = SLOTS[k].tag
        const big = SLOTS[k].flat ? 1 : 1.25
        return [k, { name: liveLabel(scene, [x, y, z], { size: 0.21 * big }), price: liveLabel(scene, [x, y - 0.3 * big, z], { size: 0.19 * big }) }]
      }),
    ) as Record<string, { name: ReturnType<typeof liveLabel>; price: ReturnType<typeof liveLabel> }>
    const rows = [0, 1, 2].map((i) => liveLabel(scene, [-17, -9.3 - i * 0.8, 0.3], { size: 0.27, align: 'left' }))
    const list = Array.from({ length: 8 }, (_, i) => liveLabel(scene, [4.3, -5.3 - i * 0.62, 0.3], { size: 0.25, align: 'left' }))
    const costG = columnGauge(scene, 0, {
      min: 0,
      max: 400,
      window: [0, 320],
      caption: 'Kit cost, typical (bar: rough range)',
      ticks: [[0, '$0'], [100, '100'], [200, '200'], [300, '300'], [400, '$400']],
    })
    const ironG = columnGauge(scene, 1, {
      min: 200,
      max: 460,
      window: [ALLOYS.sn63.tipC[0], ALLOYS.sn63.tipC[1]],
      marks: [[PEN_IRON.idleC, 'pen idles', RING]],
      caption: 'Iron tip at idle (Sn63 window green)',
      ticks: [[200, '200'], [300, '300'], [400, '400 °C']],
    })
    let t = 0
    let key = ''
    return {
      scene,
      view: BENCH_VIEW,
      frame(dt, p) {
        const c = sbCfg(p)
        const r = sbSolve(c)
        const k = sbKey(c)
        if (k !== key) [key, t] = [k, 0]
        t += dt
        const N = r.steps.length
        const cur = Math.floor(t / STEP_S) % N
        const pulse = 0.5 + 0.5 * Math.sin(t * 6)
        const step = r.steps[cur]
        const has = new Set(r.tools)
        for (const id of Object.keys(models) as ToolId[]) models[id]!.visible = has.has(id)
        const ironKind: ToolId | null = has.has('station') ? 'station' : has.has('penIron') ? 'penIron' : null
        iron.group.visible = stand.group.visible = ironKind !== null
        iron.set(r.ironC ?? 25, 0)
        station.screen(`${fixedText(r.ironC ?? 0, 0)}°C`, POWER)
        const needed = new Set(r.blocked.flatMap((s) => s.missing.map(slotOf)))
        const inUse = new Set(step.uses.map(slotOf))
        const missingNow = new Set(step.missing.map(slotOf))
        for (const s of tagKeys) {
          const pad = pads[s]
          if (missingNow.has(s)) pad.set(HIGH_V, pulse)
          else if (inUse.has(s)) pad.set(POWER, 0.6 + 0.4 * pulse)
          else if (needed.has(s)) pad.set(HIGH_V, 0.15)
          else pad.set(GREY, 0)
        }
        for (const s of tagKeys) {
          const tool: ToolId = s === 'iron' ? ironKind ?? 'penIron' : s
          const got = s === 'iron' ? ironKind !== null : has.has(s)
          const name = s === 'iron' && !got ? 'iron' : SHORT[tool]
          const price = s === 'iron' && !got ? wholeRange([TOOLS.penIron.usd[0], TOOLS.station.usd[1]]) : toolPrice(tool)
          const tone = got ? (r.unused.includes(tool) || tool === 'penIron' ? RING : LABEL) : needed.has(s) ? HIGH_V : GREY
          tags[s].name.set(`${!got && needed.has(s) ? '✗ ' : ''}${name}`, tone)
          tags[s].price.set(price, got ? GREY : tone)
        }
        const tick = (ok: boolean) => (ok ? '✓' : '✗')
        r.steps.forEach((s, i) => list[i].set(`${i === cur ? '→ ' : '   '}${tick(s.ok)} ${s.name}${s.ok ? '' : `: ${toolList(s.missing)}`}`, s.ok ? (i === cur ? POWER : LABEL) : HIGH_V))
        for (let i = N; i < list.length; i++) list[i].set('', GREY)
        rows[0].set(`Step ${cur + 1} of ${N}: ${step.name}: ${step.ok ? `with ${toolList(step.uses)}` : `blocked, no ${toolList(step.missing)}`}`, step.ok ? POWER : HIGH_V)
        const tools = [...step.uses, ...step.missing]
        rows[1].set(`learn: ${[...new Set(tools.flatMap((x) => TOOLS[x].lessons))].slice(0, 2).map(linkText).join(' · ')}`, GREY)
        rows[2].set(`kit ${usdRange(r.cost)}, typical ${usdWhole(r.mid)} of ${usdWhole(r.T.usd)} · ${PRICE_NOTE}`, GREY)
        costG.setWindow(0, r.T.usd)
        costG.set(Math.min(400, r.mid), usdWhole(r.mid), verdictTint(r.mid <= r.T.usd, r.mid <= 1.1 * r.T.usd), [Math.min(400, r.cost[0]), Math.min(400, r.cost[1])])
        if (r.ironC === null) ironG.set(200, 'no iron', GREY)
        else ironG.set(r.ironC, C(r.ironC), verdictTint(r.ironC <= ALLOYS.sn63.tipC[1] + 5, false))
        ext.spin(dt, has.has('extractor') ? 20 : 0)
        const on = step.id === 'power'
        psu.set(`${fixedText(on ? PSU_FIRST_POWER.volts : 0, 2)}V`, `${fixedText(on ? PSU_FIRST_POWER.limitA : 0, 2)}A`, false, '#ff8a4a')
        header.set(BENCH_TIERS[c.tier].name.replace(/^\$\d+: /, ''), r.verdict, benchWhy(r), 'Hint: one tool per step, safety kit with the iron, cutters and charger, then trim to the budget', { lead: 'Build' })
      },
      readouts: (p) => {
        const r = sbSolve(sbCfg(p))
        const ok = r.steps.filter((s) => s.ok).length
        return [
          { label: 'Steps possible', value: `${ok} / ${r.steps.length}`, tone: toneOf(ok === r.steps.length, ok >= r.steps.length - 1) },
          { label: 'Kit, typical', value: usdWhole(r.mid), tone: toneOf(r.mid <= r.T.usd, r.mid <= 1.1 * r.T.usd) },
          { label: 'Budget left', value: `${r.left < 0 ? '−' : ''}${usdWhole(Math.abs(r.left))}`, tone: toneOf(r.left >= 0, r.left >= -0.1 * r.T.usd) },
          verdictReadout(r.verdict),
        ]
      },
    }
  },
}

// --- Parts shopping list: the robo-car BOM, each part checked against the others; a hard start heats the main plug. ---

const PACK_NAMES = namesOf(CAR_PACKS)
const DRIVER_NAMES = namesOf(DRIVERS)
const BUCK_OPTS: Record<BuckKind, string> = { lm2596: 'LM2596 buck', mt3608: 'MT3608 boost', xl6009: 'XL6009 buck-boost' }
const MAIN_OPTS: Partial<Record<ConnectorId, string>> = { dupont: 'Main plug: Dupont', jstxh: 'Main plug: JST-XH', xt30: 'Main plug: XT30', xt60: 'Main plug: XT60' }
const MOTOR_OPTS: Partial<Record<ConnectorId, string>> = { dupont: 'Motor plugs: Dupont', jstph: 'Motor plugs: JST-PH', jstxh: 'Motor plugs: JST-XH', xt30: 'Motor plugs: XT30' }
const SPARE_NAMES = namesOf(SPARE_LEVELS)
const plCfg = (p: Params): BomCfg => ({
  pack: pick(CAR_PACKS, p.pack, 'li2') as CarPack,
  driver: pick(DRIVERS, p.driver, 'drv8833') as DriverChip,
  buck: pick(BUCK_OPTS, p.buck, 'lm2596') as BuckKind,
  mainPlug: pick(MAIN_OPTS, p.main, 'xt30') as ConnectorId,
  motorPlug: pick(MOTOR_OPTS, p.motor, 'jstph') as ConnectorId,
  awg: n(p, 'awg'),
  spares: pick(SPARE_NAMES, p.spares, 'some') as SpareLevel,
})
const plKey = (c: BomCfg) => `${c.pack}|${c.driver}|${c.buck}|${c.mainPlug}|${c.motorPlug}|${c.awg}|${c.spares}`
const plSolve = memoBy(plKey, bomRun)
const V = (v: number) => `${fixedText(v, 2)} V`
const A = (a: number) => `${fixedText(a, 2)} A`

const PLUG_FAIL: Record<string, string> = {
  pins: 'too few pins',
  melts: 'melts at the burst current',
  reverse: 'not keyed: plugs in backwards',
  drop: 'drops too many volts',
  rating: 'run over its rating',
  shake: 'shakes loose',
  wear: 'wears out before its mating count',
  bulky: 'oversize for the current',
}

function listWhy(r: BomRun): string {
  const c = r.cfg
  const P = r.P
  const M = DCDC_MODULES[c.buck]
  switch (r.verdict.fail) {
    case 'rail':
      return P.cruise.railV > 5.25
        ? `${M.name} is a boost: it can’t step ${V(P.cruise.packV)} down, the 5 V rail sits at ${V(P.cruise.railV)}. Use a buck`
        : `${M.name} can’t make 5 V from ${CAR_PACKS[c.pack].name} (${V(P.cruise.packV)}): rail ${V(P.cruise.railV)}, the ESP32 never runs properly`
    case 'resets':
      return `Hard start: 2 × ${A(P.stall.motorA)} sags the pack to ${V(P.stall.packV)}, the 3.3 V rail falls to ${V(P.stall.mcuV)} and the ESP32 resets`
    case 'mainPlug':
      return `${CONNECTORS[c.mainPlug].name} on the main lead: ${PLUG_FAIL[r.main.verdict.fail!]}${r.main.verdict.fail === 'reverse' ? ', straight into the driver and buck' : r.main.verdict.fail === 'bulky' ? ` (${A(r.burstA)} burst, rated ${A(CONNECTORS[c.mainPlug].ratedA)})` : r.main.verdict.fail === 'wear' ? ` (${CONNECTOR_SPECS[c.mainPlug].cycles} matings, unplugged every charge)` : ''}`
    case 'motorPlug':
      return `${CONNECTORS[c.motorPlug].name} on the motors: ${PLUG_FAIL[r.motor.verdict.fail!]}${r.motor.verdict.fail === 'reverse' ? ': that wheel runs backwards' : ''}`
    case 'fit':
      return `${c.awg} AWG doesn’t fit the ${!r.fits.main ? CONNECTORS[c.mainPlug].name : CONNECTORS[c.motorPlug].name} terminals: buy wire in their range or other plugs`
    case 'wire':
      return `${c.awg} AWG carries ${A(r.wireA)} at 80 °C (PVC), less than the ${A(r.burstA)} hard start. Go one or two sizes thicker`
    case 'driver':
      return `${DRIVERS[c.driver].name} is rated ${A(DRIVERS[c.driver].maxA)} a channel; a stalled TT motor pulls ${A(P.stall.motorA)}. DRV8833 has the margin`
    case 'drop':
      return `${DRIVERS[c.driver].name} drops ${V(r.cruise.drop)} of ${V(P.cruise.packV)} (${fixedText(r.dropShare * 100, 0)} %) as heat: slower car, shorter runs. A MOSFET driver loses tenths`
    case 'slow':
      return `Runs, but slowly: ${CAR_PACKS[c.pack].name} gives the motors too few volts`
    case 'spares':
      return 'No spares: the first crimps and header cuts get wasted. Add ~20 % to the consumables'
    case 'budget':
      return `${usd(r.mid)} typical, over the ${usdWhole(CAR_BOM.usd)} target: trim the spares or pick cheaper parts`
    default:
      return `Every part matches: 5 V rail ${V(P.cruise.railV)}, ESP32 ${V(P.stall.mcuV)} at a hard start, plugs and wire rated, ${usd(r.mid)} of ${usdWhole(CAR_BOM.usd)}`
  }
}

/** Which BOM lines a failing check points at. */
const FAIL_LINES: Record<string, string[]> = {
  rail: ['buck', 'cells'],
  resets: ['cells'],
  mainPlug: ['mainPlug'],
  motorPlug: ['motorPlug'],
  fit: ['terminals', 'wire'],
  wire: ['wire'],
  driver: ['driver'],
  drop: ['driver'],
  slow: ['cells'],
  spares: ['terminals', 'wire', 'headers'],
  budget: [],
}
/** Car part to ring for each failing check. */
const FAIL_PART: Record<string, string> = { rail: 'buck', resets: 'battery', mainPlug: 'battery', motorPlug: 'motorL', fit: 'motorL', wire: 'battery', driver: 'driver', drop: 'driver', slow: 'battery' }

const PL_LEGEND: LegendItem[] = [
  { color: POWER, label: 'Part checks out', shape: 'dot' },
  { color: RING, label: 'Close miss / consumable (buy spares)', shape: 'dot' },
  { color: HIGH_V, label: 'Part that fails a check', shape: 'dot' },
  { color: GREY, label: 'Prices: rough ranges, not quotes', shape: 'dot' },
]
const CAR_K = 46
const CAR_AT: V3 = [-11.6, -0.4, 0]
const PL_LAPSE = 6

export const toolKitPartsShoppingList: Lesson = {
  id: 'tool-kit-parts-shopping-list',
  title: 'Parts shopping list',
  tagline: 'Build the robo-car’s shopping list: pack, driver, 5 V converter, plugs, wire gauge and spares, each checked against the others and the budget',
  formula: (p) => {
    const r = plSolve(plCfg(p))
    return `total = Σ qty × unit = ${usdRange(r.cost)} (typical ${usd(r.mid)}) · consumables × (1 + ${fixedText(r.spare * 100, 0)} %) · wire ${r.cfg.awg} AWG: ${A(r.wireA)} ≥ hard start 2 × I_stall = ${A(r.burstA)}? · 5 V rail ${V(r.P.cruise.railV)} · ${PRICE_NOTE}`
  },
  legend: PL_LEGEND,
  points: [
    'The shopping list for the Robo-car (Robot projects › Robo-car › Chassis & power): ESP32 DevKit, motor driver, two TT gearmotors with wheels, caster, plate, cells and holder, a 5 V converter, switch, polyfuse, plugs, crimp terminals, wire, header pins and heat-shrink. Parts must suit each other, not just the robot.',
    'Pack and converter go together. A buck (LM2596) only steps down: 2S Li-ion is plenty, one 18650 or four NiMH are too few volts and the ESP32 never gets 5 V. A boost (MT3608) only steps up: fine from one cell, but on 2S it just passes the pack through. Four alkalines sag at every hard start and the ESP32 resets (Power › Brownouts).',
    'Plugs and wire are rated parts too. The main lead needs a keyed plug (a reversed Dupont feeds −7.4 V into the driver and buck) rated for a hard start, and enough mating cycles to be unplugged every charge: XT30. JST-PH suits the motor leads (Crimping & connectors › Choosing connectors). Wire must fit the crimp terminals’ AWG range and carry the stall current (Power › Wiring).',
    'Driver: DRV8833 handles a stalled TT motor; TB6612 is rated under that, L298N burns a fifth of the pack in its bipolar switches (Actuators › H-bridge › L298N vs modern drivers). Buy ~20 % spare consumables (terminals, wire, headers): the first crimps fail.',
    'Prices are rough illustrative ranges (USD, hobby market), not quotes; the total shows the range and the typical middle. Tools to build it: Tool kit › Starter bench.',
  ],
  controls: [
    { kind: 'choice', key: 'pack', options: opts(PACK_NAMES), initial: 'li2' },
    { kind: 'choice', key: 'driver', options: opts(DRIVER_NAMES), initial: 'tb6612' },
    { kind: 'choice', key: 'buck', options: opts(BUCK_OPTS), initial: 'lm2596' },
    { kind: 'choice', key: 'main', options: opts(MAIN_OPTS as Record<string, string>), initial: 'dupont' },
    { kind: 'choice', key: 'motor', options: opts(MOTOR_OPTS as Record<string, string>), initial: 'jstph' },
    { kind: 'slider', key: 'awg', label: 'Power wire', min: 18, max: 30, step: 2, initial: 22, format: (v) => `${v} AWG` },
    { kind: 'choice', key: 'spares', options: opts(SPARE_NAMES), initial: 'none' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const top = add(scene, new THREE.Group(), CAR_AT)
    top.rotation.x = -0.3
    top.position.x += ((ROBOCAR.wheelbase - CHASSIS.front) / 2) * CAR_K
    const parts = robocarParts()
    const model = chassisModel(top, parts, CAR_K)
    model.part('imu').visible = false
    model.part('battery').visible = false
    model.part('driver').visible = false
    const km = CAR_K / 1000
    const bp = parts.find((q) => q.key === 'battery')!
    const setPack = packHolder(add(top, new THREE.Group()), [bp.x * CAR_K, bp.y * CAR_K, bp.z * CAR_K], CAR_K)
    const drvG = add(top, new THREE.Group())
    const buckG = add(top, new THREE.Group())
    const leadG = add(scene, new THREE.Group())
    const dAt = model.at('driver')
    const ring = slotPad(top, [0, 0, (CHASSIS.plateZ + 0.012) * CAR_K], [2.6, 2.6])
    const mainPair = plugPair(scene, [-1.6, 0.6, 0], 0.17)
    const motorPair = plugPair(scene, [-1.6, -3.4, 0], 0.17)
    const plugTags = [liveLabel(scene, [-1.6, 2.4, 0.3], { size: 0.26 }), liveLabel(scene, [-1.6, -1.6, 0.3], { size: 0.26 })]
    const carTag = liveLabel(scene, [CAR_AT[0], -5.7, 0.3], { size: 0.27 })
    const lines = Array.from({ length: 16 }, (_, i) => liveLabel(scene, [i < 8 ? -17 : -7.2, -6.7 - (i % 8) * 0.5, 0.3], { size: 0.23, align: 'left' }))
    const total = liveLabel(scene, [-17, -10.9, 0.3], { size: 0.25, align: 'left' })
    const costG = columnGauge(scene, 0, {
      min: 30,
      max: 70,
      window: [30, CAR_BOM.usd],
      caption: 'List total, typical (bar: rough range)',
      ticks: [[30, '$30'], [40, '40'], [50, '50'], [60, '60'], [70, '$70']],
    })
    const mcuG = columnGauge(scene, 1, {
      min: 0,
      max: 8,
      window: [4.75, 5.25],
      caption: '5 V rail; dot: ESP32 at a hard start',
      ticks: [[0, '0'], [2, '2'], [4, '4'], [6, '6'], [8, '8 V']],
    })
    const plugG = columnGauge(scene, 2, {
      min: 20,
      max: 130,
      window: [20, 85],
      caption: 'Main plug °C, 2 s hard start (live)',
      ticks: [[25, '25'], [50, '50'], [85, '85'], [120, '120 °C']],
    })
    const mcuText = liveLabel(scene, [4.3, -1.75, 0.3], { size: 0.27, align: 'left' })
    const mcuMat = glowMat(POWER, 1)
    const mcuDot = flatBox(scene, [0.3, 0.3, 0.2], mcuMat, [0, -3, 0.2])
    const clock = lapseClock(PL_LAPSE, 1, 2)
    let built = ''
    let t = 0
    return {
      scene,
      view: BENCH_VIEW,
      frame(dt, p) {
        const c = plCfg(p)
        const r = plSolve(c)
        t += dt
        setPack(c.pack)
        const k = plKey(c)
        if (built !== k) {
          built = k
          emptyGroup(drvG)
          const big = c.driver === 'l298n'
          i2cBreakout(drvG, [dAt[0], dAt[1], dAt[2]], { name: DRIVERS[c.driver].name, color: big ? '#b8322a' : DRIVER_BOARD_COLOR[c.driver as 'tb6612' | 'drv8833'], k: km * (big ? 1.8 : 1), pins: ['VM', 'GND', 'A', 'B'] }).group.rotation.z = -Math.PI / 2
          emptyGroup(buckG)
          dcdcModule(buckG, [-0.085 * CAR_K, -0.03 * CAR_K, (CHASSIS.plateZ + 0.002) * CAR_K], c.buck, km)
          mainPair.build(c.mainPlug, 2)
          motorPair.build(c.motorPlug, 2)
          emptyGroup(leadG)
          const rr = Math.max(0.05, awgDiameter(c.awg) * 1000 * 0.12)
          const from = new THREE.Vector3(bp.x * CAR_K, bp.y * CAR_K, bp.z * CAR_K)
          top.localToWorld(from)
          for (const [dy, col] of [[0.25, '#d4282b'], [-0.25, '#26282d']] as const) {
            cableRun(leadG, [[from.x + 2, from.y + dy, 1], [-5, 0.6 + dy, 0.6], [-3.4, 0.6 + dy, 0.2]], col, rr)
            cableRun(leadG, [[CAR_AT[0] + 1, -3.4 + dy, 1.2], [-5, -3.4 + dy, 0.6], [-3.4, -3.4 + dy, 0.2]], col, rr)
          }
        }
        const fail = r.verdict.fail
        const part = fail ? FAIL_PART[fail] : undefined
        if (part) {
          const at = part === 'buck' ? [-0.085 * CAR_K, -0.03 * CAR_K] : model.at(part)
          ring.mesh.position.set(at[0], at[1], (CHASSIS.plateZ + 0.012) * CAR_K)
          ring.set(r.verdict.near ? RING : HIGH_V, 0.5 + 0.5 * Math.sin(t * 6))
        } else ring.set(POWER, 0)
        const now = clock(dt, k)
        const tempC = plugTempAt(r.main.C, r.main.S.tauS, r.main.J, (now / PL_LAPSE) * plugLapseS(r.main.J))
        const melted = tempC > r.main.C.maxC
        mainPair.set(0, false, Math.min(1, (tempC - 25) / (r.main.C.maxC - 25)), melted)
        motorPair.set(0, false, 0, false)
        plugTags[0].set(`main: ${CONNECTORS[c.mainPlug].name}${r.main.verdict.pass ? ' ✓' : ` ✗ ${PLUG_FAIL[r.main.verdict.fail!]}`}`, verdictTint(r.main.verdict.pass, r.main.verdict.near))
        plugTags[1].set(`motors: ${CONNECTORS[c.motorPlug].name}${r.motor.verdict.pass ? ' ✓' : ` ✗ ${PLUG_FAIL[r.motor.verdict.fail!]}`}`, verdictTint(r.motor.verdict.pass, r.motor.verdict.near))
        carTag.set(`${CAR_PACKS[c.pack].name} · ${DRIVERS[c.driver].name} · ${DCDC_MODULES[c.buck].name} · ${c.awg} AWG`, LABEL)
        const bad = new Set(fail ? FAIL_LINES[fail] : [])
        r.lines.forEach((l, i) => {
          const tone = bad.has(l.key) ? (r.verdict.near ? RING : HIGH_V) : l.consumable ? RING : LABEL
          lines[i]?.set(`${l.qty} × ${l.name}  ${usdRange(l.total)}`, tone)
        })
        for (let i = r.lines.length; i < lines.length; i++) lines[i].set('', GREY)
        total.set(`total ${usdRange(r.cost)} · ${PRICE_NOTE}`, GREY)
        costG.set(Math.max(30, Math.min(70, r.mid)), usd(r.mid), verdictTint(r.mid <= CAR_BOM.usd, r.mid <= 1.1 * CAR_BOM.usd), [Math.max(30, r.cost[0]), Math.min(70, r.cost[1])])
        const rail = r.P.cruise.railV
        mcuG.set(Math.min(8, rail), V(rail), verdictTint(r.railOk, false))
        const gx = 8 + (Math.min(8, r.P.stall.mcuV) / 8 - 0.5) * 7.6
        mcuDot.position.x = gx
        const mcuTone = verdictTint(!r.P.stall.resets && r.P.stall.mcuV >= 3.25, !r.P.stall.resets)
        setGlow(mcuMat, mcuTone, 1)
        mcuText.set(`ESP32 ${V(r.P.stall.mcuV)}`, mcuTone)
        plugG.set(Math.min(130, tempC), melted ? `${C(tempC)} melts` : C(tempC), verdictTint(tempC <= 60, tempC <= r.main.C.maxC))
        header.set('a robo-car parts list that works, under ' + usdWhole(CAR_BOM.usd), r.verdict, listWhy(r), 'Hint: pack + converter first, keyed rated plugs, wire that fits the terminals, ~20 % spares', { lead: 'Shop' })
      },
      readouts: (p) => {
        const r = plSolve(plCfg(p))
        return [
          { label: 'List, typical', value: usd(r.mid), tone: toneOf(r.mid <= CAR_BOM.usd, r.mid <= 1.1 * CAR_BOM.usd) },
          { label: '5 V rail', value: V(r.P.cruise.railV), tone: toneOf(r.railOk, false) },
          { label: 'Wire / hard start', value: `${fixedText(r.wireA, 1)} / ${fixedText(r.burstA, 1)} A`, tone: toneOf(r.wireA >= r.burstA, r.wireA >= r.P.cruise.packA) },
          verdictReadout(r.verdict),
        ]
      },
    }
  },
}
