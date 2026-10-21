import {
  CHARGE_SPOTS,
  CHARGER_MODES,
  ChargeSpot,
  ChargerMode,
  FUME_SESSION,
  FUME_VENTS,
  FumeCfg,
  FumeVent,
  INSULATION_MAX_C,
  LIPO_CHEM,
  LIPO_DT,
  LIPO_FLAT_V,
  LIPO_HEAT,
  LIPO_PACK,
  LIPO_STORAGE_V,
  LipoCfg,
  LipoPhase,
  PACK_STATES,
  PackState,
  ROSIN_WEL,
  cellVolts,
  fumeAt,
  fumeRun,
  lipoAt,
  lipoChargeRun,
} from '../../core/physics'
import { celsiusText, fixedText, pct, si, voltText as V } from '../../core/units'
import {
  BENCH_PLOT,
  BENCH_TOP_Y,
  BENCH_VIEW,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  benchHead,
  benchTop,
  benchExtractor,
  benchPlot,
  chargeLeads,
  columnGauge,
  fumePlume,
  hobbyCharger,
  ironStand,
  lapseClock,
  leadSnippet,
  lipoBag,
  lipoPack,
  liveLabel,
  memoBy,
  nearDome,
  plotY,
  puzzleStage,
  solderingIron,
  textRows,
  ventFire,
  verdictTint,
} from '../fx'
import { add, box, mat } from '../../models/kit'
import { LegendItem, Lesson, Params, Stage, n, namesOf, opts, pick, toneOf, verdictReadout } from '../types'
import * as THREE from 'three/webgpu'

const C = (c: number) => celsiusText(c)
const mins = (s: number) => `${fixedText(s / 60, 0)} min`

// --- LiPo safety: charger program, rate, balance lead, pack state and where it charges; a charge time-lapse. ---

const MODE_NAMES = namesOf(CHARGER_MODES)
const STATE_NAMES = namesOf(PACK_STATES)
const SPOT_NAMES = namesOf(CHARGE_SPOTS)
const BAL_OPTS = { balance: 'Balance lead plugged in', main: 'Main lead only' }
const lpCfg = (p: Params): LipoCfg => ({
  mode: pick(MODE_NAMES, p.mode, 'lipo2s') as ChargerMode,
  rateC: n(p, 'rate'),
  balance: p.bal !== 'main',
  state: pick(STATE_NAMES, p.state, 'storage') as PackState,
  spot: pick(SPOT_NAMES, p.spot, 'tile') as ChargeSpot,
})
const lpKey = (c: LipoCfg) => `${c.mode}|${c.rateC}|${c.balance}|${c.state}|${c.spot}`
const lpSolve = memoBy(lpKey, lipoChargeRun)
type LpRun = ReturnType<typeof lipoChargeRun>

function lipoWhy(r: LpRun): string {
  const c = r.cfg
  const M = CHARGER_MODES[c.mode]
  const f = r.last
  switch (r.verdict.fail) {
    case 'puffed':
      return 'Puffed: gas inside means it’s damaged. Don’t charge or puncture it; keep it in a LiPo bag away from anything that burns, then recycle it'
    case 'flat':
      return `Run down to ${V(cellVolts(LIPO_CHEM, PACK_STATES[c.state].socs[0]))}/cell, under ${V(LIPO_FLAT_V)}: copper may have dissolved inside. Don’t charge it; retire it`
    case 'vent':
      return `${M.cvCell === Infinity ? 'No voltage limit' : `Set for ${M.cells} cells: aims at ${V(M.cells * M.cvCell)}`}: cells hit ${V(Math.max(...f.rest))}, heated to ${C(LIPO_HEAT.ventC)} and vented in ${mins(r.seconds)}${CHARGE_SPOTS[c.spot].attended ? '' : ', nobody home'}`
    case 'over':
      return c.balance && M.cvCell !== LIPO_CHEM.full
        ? `${M.name.split(' ·')[0]} program charges each cell to ${V(M.cvCell)}: past the ${V(LIPO_CHEM.full)} a standard LiPo is made for`
        : `Without the balance lead the charger only sees the total: cell ${f.rest[0] >= f.rest[1] ? 1 : 2} reached ${V(r.maxV)}, over ${V(LIPO_CHEM.full)}`
    case 'setting':
      return `Program set for ${M.cells} cells on a 2-cell pack: the balance lead let the charger catch it and refuse. Set the cell count yourself`
    case 'rate':
      return `${fixedText(c.rateC, 2)}C = ${si(r.setA, 'A', 2)}: faster than 1C ages the pack and heats it (peak ${C(r.peakC)}). Use 1C unless the label says more`
    case 'hot':
      return `Pack reached ${C(r.peakC)}: Li-ion should charge at 0–45 °C. Slower charge, let it cool first`
    case 'balance':
      return 'No balance lead: cells matched this time, but a drifted pack would overcharge one cell. Always balance-charge'
    case 'surface':
      return 'Charged fine, but on wood with no bag: if a pack ever vents, the bench catches. Charge on a non-flammable surface, in a bag'
    case 'alone':
      return 'Never leave a LiPo charging unattended: a bag only slows a fire, someone has to unplug it and get it out'
    default:
      return `Balanced 1C charge: ${V(r.maxV)}/cell max, peak ${C(r.peakC)}, ${mins(r.seconds)}. Store at ${V(LIPO_STORAGE_V)}/cell if it won’t be used soon`
  }
}

const PHASE_TEXT: Record<LipoPhase, string> = {
  refused: 'CELL COUNT ERR',
  pre: 'PRE-CHARGE',
  cc: 'CC',
  cv: 'CV',
  done: 'DONE',
  timer: 'TIMER STOP',
  vent: 'VENTED',
}

const LIPO_LEGEND: LegendItem[] = [
  { color: POWER, label: 'Cell 1 volts', shape: 'dot' },
  { color: RING, label: 'Cell 2 volts', shape: 'dot' },
  { color: HIGH_V, label: 'Full: 4.20 V/cell', shape: 'dot' },
  { color: GREY, label: 'Storage: 3.8 V/cell', shape: 'dot' },
]
const V_LO = 2.5
const V_HI = 5.2
const LP_LAPSE = 14

export const safetyLipoSafety: Lesson = {
  id: 'safety-lipo-safety',
  title: 'LiPo safety',
  tagline: 'Set the charger, the current, the balance lead and where it sits, then watch a whole charge in a time-lapse: cell volts and pack temperature',
  formula: (p) => {
    const r = lpSolve(lpCfg(p))
    return `I = ${fixedText(r.cfg.rateC, 2)}C × ${LIPO_PACK.mAh} mAh = ${si(r.setA, 'A', 2)} · CC, then CV at 4.20 V/cell, stop at C/10 · heat = I²R + side reactions past 4.20 V · leads shorted: I = V/R = ${si(r.short.amps, 'A', 3)}`
  },
  legend: LIPO_LEGEND,
  points: [
    'A LiPo cell is full at 4.20 V, nominal 3.7 V, empty at 3.0 V. Charging is CC then CV: constant current until the cell reaches 4.20 V, then hold 4.20 V while the current tapers, stop near C/10 (Power › Charging › Charge curve). The charger must be set to the right chemistry and cell count; a LiHV program (4.35 V) or a NiMH program (no voltage limit at all) overcharges a standard pack.',
    'Charge at 1C (the capacity in amps: 2.2 A for 2200 mAh) unless the maker says more. Always plug the balance lead in: it lets the charger watch each cell, stop the highest at 4.20 V and bleed it so the others catch up. With only the main lead it sees the total, and a drifted cell goes over (Power › 18650 packs › Balancing).',
    'Overcharge drives side reactions that turn the current into heat; past ~60–80 °C the cell starts heating itself and can run away into venting and fire (the temperatures here are illustrative). Charge between 0 and 45 °C (Power › Charging › Thermal limits).',
    'Never charge a puffed (swollen) or damaged pack, or one run below ~3.0 V/cell: retire it and take it to battery recycling. Store packs at ~3.8 V/cell, in a LiPo bag or metal box, away from anything flammable.',
    'Charge on a non-flammable surface (ceramic tile, inside a LiPo bag), with someone there, never overnight or while out. Keep bare leads apart: a short has only milliohms in its way, hundreds of amps and kilowatts inside the pack (Debug it › Won’t power on › Short circuit).',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(MODE_NAMES), initial: 'lipo2s' },
    { kind: 'slider', key: 'rate', label: 'Charge current', min: 0.5, max: 3, step: 0.25, initial: 1, format: (v) => `${fixedText(v, 2)}C = ${si((v * LIPO_PACK.mAh) / 1000, 'A', 2)}` },
    { kind: 'choice', key: 'bal', options: opts(BAL_OPTS), initial: 'main' },
    { kind: 'choice', key: 'state', options: opts(STATE_NAMES), initial: 'flown' },
    { kind: 'choice', key: 'spot', options: opts(SPOT_NAMES), initial: 'tile' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    const bench = benchTop(scene)
    const packAt = (top: number): [number, number, number] => [-12, top, 0]
    const pack = lipoPack(scene, packAt(bench.top('tile')))
    const charger = hobbyCharger(scene, [-2.6, BENCH_TOP_Y + 0.25, 0])
    const leads = chargeLeads(scene)
    const bag = lipoBag(scene, [-12, BENCH_TOP_Y + 0.25, 0], [9.4, 3.4, 4.6])
    const fire = ventFire(scene, [-12, BENCH_TOP_Y + 1.6, 0], 6)
    const cellTags = [0, 1].map(() => liveLabel(scene, [0, 0, 0], { size: 0.3 }))
    const who = liveLabel(scene, [-17, 1.6, 0.3], { size: 0.32, align: 'left' })
    const clockTag = liveLabel(scene, [-17, 0.4, 0.3], { size: 0.3, align: 'left' })
    const rows = textRows(scene, 2, -17, -8.9, 0.28, 1.1, 0.3)
    const { s, tag, draw } = benchPlot(scene, 'Cell volts vs time', [8, 3], [`${V_HI}`, `${V_LO}`], [[POWER, 0.07], [RING, 0.07]])
    const toPlot = plotY(V_LO, V_HI, BENCH_PLOT.h)
    const yV = (v: number) => toPlot(Math.min(V_HI, Math.max(V_LO, v)))
    s.level(HIGH_V).set(yV(LIPO_CHEM.full))
    s.level(GREY, 0.3).set(yV(LIPO_STORAGE_V))
    const vG = columnGauge(scene, 1, {
      min: V_LO,
      max: V_HI,
      window: [LIPO_FLAT_V, LIPO_CHEM.full],
      marks: [[LIPO_STORAGE_V, 'storage', GREY], [4.35, 'LiHV', RING]],
      caption: 'Highest cell (live)',
      ticks: [[3, '3.0'], [3.5, '3.5'], [4, '4.0'], [4.5, '4.5'], [5, '5.0 V']],
    })
    const tG = columnGauge(scene, 2, {
      min: 20,
      max: 160,
      window: [20, 45],
      marks: [[LIPO_HEAT.onsetC, 'self-heats', RING], [LIPO_HEAT.ventC, 'vents', HIGH_V]],
      caption: 'Pack °C (live, heat model illustrative)',
      ticks: [[25, '25'], [50, '50'], [100, '100'], [150, '150 °C']],
    })
    const clock = lapseClock(LP_LAPSE, 1, 2.5)
    let built = ''
    return {
      scene,
      view: BENCH_VIEW,
      frame(dt, p) {
        const c = lpCfg(p)
        const r = lpSolve(c)
        const spot = CHARGE_SPOTS[c.spot]
        const S = PACK_STATES[c.state]
        const surface = spot.flammable ? 'wood' : 'tile'
        if (built !== `${surface}|${c.balance}`) {
          built = `${surface}|${c.balance}`
          bench.set(surface)
          const top = bench.top(surface)
          pack.group.position.set(...packAt(top))
          leads.set([pack.end('main'), charger.ports.main], [pack.end('balance'), charger.ports.balance], c.balance, top)
        }
        bag.visible = spot.bag
        const now = clock(dt, lpKey(c))
        const simT = (now / LP_LAPSE) * r.seconds
        const f = lipoAt(r, simT)
        const vented = f.phase === 'vent'
        pack.set(S.puffed ? 0.6 : vented ? 1 : Math.max(0, (f.tempC - LIPO_HEAT.onsetC) / (LIPO_HEAT.ventC - LIPO_HEAT.onsetC)) * 0.8, (f.tempC - 25) / 125)
        fire.step(dt, vented)
        f.rest.forEach((v, i) => {
          const at = pack.cellTop(i)
          cellTags[i].group.position.set(at[0], at[1] + (S.puffed ? 0.9 : 0), at[2])
          cellTags[i].set(`cell ${i + 1}: ${V(f.volts[i])}`, verdictTint(f.volts[i] <= LIPO_CHEM.full + 0.01 && v >= LIPO_FLAT_V, f.volts[i] <= 4.3))
        })
        const M = CHARGER_MODES[c.mode]
        charger.screen(
          `${M.name.split(' ·')[0].replace(' (wrong cell count)', '')} ${si(r.setA, 'A', 2)}`,
          vented ? 'NO OUTPUT' : `${PHASE_TEXT[f.phase]} ${V(f.volts.reduce((a, b) => a + b, 0))} ${si(f.amps, 'A', 2)}`,
          f.phase === 'refused' || vented ? HIGH_V : f.phase === 'done' ? POWER : LABEL,
        )
        who.set(spot.attended ? 'you: in the room, watching' : 'you: out, nobody home', spot.attended ? POWER : HIGH_V)
        clockTag.set(`${mins(simT)} of ${mins(r.seconds)} · 1 s ≈ ${fixedText(r.seconds / LP_LAPSE / 60, 1)} min`, LABEL)
        rows[0].set(`${S.name} · ${CHARGE_SPOTS[c.spot].bag ? 'in a bag' : 'bare'} on ${surface === 'tile' ? 'ceramic' : 'wood'}`, GREY)
        rows[1].set(`if the bare leads touched: ${si(r.short.amps, 'A', 3)}, ${si(r.short.packW, 'W', 1)} inside the pack`, HIGH_V)
        const cellY = (i: number) => (j: number) => yV(r.frames[j].volts[i])
        draw(r.frames.length, Math.floor(simT / LIPO_DT) + 1, (j) => (r.seconds > 0 ? r.frames[j].t / r.seconds : 0), [cellY(0), cellY(1)])
        tag.set(mins(r.seconds), LABEL)
        const top = Math.max(...f.volts)
        vG.set(Math.min(V_HI, top), V(top), verdictTint(top <= LIPO_CHEM.full + 0.01 && top >= LIPO_FLAT_V, top <= 4.3))
        tG.set(Math.min(160, f.tempC), C(f.tempC), verdictTint(f.tempC <= 45, f.tempC <= LIPO_HEAT.onsetC))
        header.set('charge this 2S pack safely', r.verdict, lipoWhy(r), 'Hint: right program and cell count, 1C, balance lead in, non-flammable spot, stay with it')
      },
      readouts: (p) => {
        const r = lpSolve(lpCfg(p))
        return [
          { label: 'Highest cell', value: V(r.maxV), tone: toneOf(r.maxV <= LIPO_CHEM.full + 0.01, r.maxV <= 4.3) },
          { label: 'Pack peak', value: C(r.peakC), tone: toneOf(r.peakC <= 45, r.peakC <= LIPO_HEAT.onsetC) },
          { label: 'Ended', value: `${PHASE_TEXT[r.last.phase].toLowerCase()} · ${mins(r.seconds)}`, tone: toneOf(r.last.phase === 'done', r.last.phase === 'refused') },
          verdictReadout(r.verdict),
        ]
      },
    }
  },
}

// --- Fume and eye protection: ventilation, tip temperature and bench habits over a 30-minute session. ---

const VENT_NAMES = namesOf(FUME_VENTS)
const GLASS_OPTS = { on: 'Safety glasses on', off: 'No glasses' }
const STAND_OPTS = { stand: 'Iron back in its stand', bench: 'Iron laid on the bench' }
const WASH_OPTS = { wash: 'Wash hands, no food at the bench', eat: 'Snack while soldering' }
const fmCfg = (p: Params): FumeCfg => ({
  vent: pick(VENT_NAMES, p.vent, 'still') as FumeVent,
  tipC: n(p, 'tipC'),
  glasses: p.glasses !== 'off',
  stand: p.stand !== 'bench',
  wash: p.wash !== 'eat',
})
const fmKey = (c: FumeCfg) => `${c.vent}|${c.tipC}|${c.glasses}|${c.stand}|${c.wash}`
const fmSolve = memoBy(fmKey, fumeRun)
type FmRun = ReturnType<typeof fumeRun>
const mg = (v: number) => `${fixedText(v, v < 0.1 ? 3 : 2)} mg/m³`

function fumeWhy(r: FmRun): string {
  const c = r.cfg
  switch (r.verdict.fail) {
    case 'stel':
      return `Breathing zone ${mg(r.peak15)} over 15 min: ${fixedText(r.peak15 / ROSIN_WEL.stel, 1)}× the EH40 limit. ${FUME_VENTS[c.vent].extractCm > 10 ? 'The extractor is too far to pull the plume in' : 'Rosin fume causes asthma: extract it at the joint'}`
    case 'eyes':
      return `${r.clipped} leads clipped in ${FUME_SESSION.minutes} min, and snippets fly at your face; hot flux can spit too. Wear safety glasses`
    case 'stand':
      return `${C(c.tipC)} tip lying on the bench: it scorches the mat, melts PVC leads (rated ${C(INSULATION_MAX_C.pvc)}) and you grab the wrong end. Use the stand`
    case 'hands':
      return 'Leaded solder: lead comes off on your fingers, not in the fume. Eating at the bench swallows it; wash hands, keep food away'
    case 'twa':
      return `Under the 15-min limit, but ${mg(r.mean)} is over the ${mg(ROSIN_WEL.twa)} 8-h limit if you solder like this all day. Closer extractor`
    case 'hot':
      return `${C(c.tipC)} is hotter than Sn63 needs: ${pct(r.share)} of the rosin burns off per joint. ~330 °C is plenty`
    default:
      return `Extractor pulls in ${pct(r.eta)} of the plume: ${mg(r.peak15)} over 15 min (limit ${mg(ROSIN_WEL.stel)}), eyes, hands and bench safe`
  }
}

const FUME_LEGEND: LegendItem[] = [
  { color: HEAT, label: 'Breathing zone (near field)', shape: 'dot' },
  { color: LABEL, label: 'Room air (far field)', shape: 'dot' },
  { color: HIGH_V, label: 'EH40 15-min limit 0.15 mg/m³', shape: 'dot' },
  { color: RING, label: 'EH40 8-h limit 0.05 mg/m³', shape: 'dot' },
]
const C_LO = 0.005
const C_HI = 3
const FM_LAPSE = 15
const LOOP_S = 4
const JOINT_AT: [number, number, number] = [-8, BENCH_TOP_Y + 0.75, 0.6]
const UNITS_PER_CM = 0.25

export const safetyFumeAndEyeProtection: Lesson = {
  id: 'safety-fume-and-eye-protection',
  title: 'Fume and eye protection',
  tagline: 'Set the ventilation, the tip temperature and your bench habits, then watch a 30-minute session fill the air you breathe',
  formula: (p) => {
    const r = fmSolve(fmCfg(p))
    return `G = ${FUME_SESSION.perMin}/min × rosin/joint × ${pct(r.share)} burnt = ${fixedText(r.G, 2)} mg/min · C_near → G(1 − η)/β + G/Q · capture v = Q/(10x² + A), η = ${pct(r.eta)} · flow/zone sizes illustrative`
  },
  legend: FUME_LEGEND,
  points: [
    'Solder smoke is mostly burnt rosin flux, not metal. Rosin (colophony) fume irritates and is a known cause of occupational asthma; the UK limit (HSE EH40) is 0.15 mg/m³ over 15 minutes and 0.05 mg/m³ over 8 hours, and exposure should be kept as low as practicable. A hotter tip burns more of the flux off per joint (Workshop skills › Soldering › Iron and flux).',
    'The plume rises straight into your face if you lean over the joint. The air within ~30 cm of the joint (the near field, your breathing zone) is far richer than the room. Opening a window dilutes the room, but the near field barely changes.',
    'An extractor pulls air in with a speed that falls with distance squared (v = Q/(10x² + A)): it must sit a few centimetres from the joint, not across the bench. Carbon-filter bench units catch the particles and some vapour; ducted outside is better still. (Room size, air speeds and the extractor’s airflow here are illustrative.)',
    'Eyes: clipped leads fly off fast and sharp, and flux can spit molten solder. Wear safety glasses, hold the lead as you cut and point it down. Put the iron back in its stand every time: a 330 °C tip melts cable insulation and burns whatever it touches.',
    'Leaded solder: at soldering temperatures lead barely evaporates, so it’s in the fume very little; it gets in by hand to mouth. Wash your hands after, keep food and drink off the bench. Lead-free still leaves flux residue: wash anyway.',
  ],
  controls: [
    { kind: 'choice', key: 'vent', options: opts(VENT_NAMES), initial: 'window' },
    { kind: 'slider', key: 'tipC', label: 'Tip temperature', min: 280, max: 420, step: 5, initial: 330, format: (v) => `${v} °C` },
    { kind: 'choice', key: 'glasses', options: opts(GLASS_OPTS), initial: 'off' },
    { kind: 'choice', key: 'stand', options: opts(STAND_OPTS), initial: 'stand' },
    { kind: 'choice', key: 'wash', options: opts(WASH_OPTS), initial: 'wash' },
  ],
  build(): Stage {
    const { scene, header } = puzzleStage()
    benchTop(scene).set('wood')
    const board = add(scene, new THREE.Group(), [JOINT_AT[0], BENCH_TOP_Y, 0])
    box(board, [6.5, 0.3, 4], mat('#2f6b3a', { rough: 0.5 }), [0, 0.45, 0])
    for (const [x, z, c] of [[-2, 0.8, '#d8b26a'], [1.8, -0.6, '#1c1c1f'], [-0.6, -1, '#4d7dff']] as const) box(board, [1, 0.6, 0.6], mat(c, { rough: 0.5 }), [x, 0.9, z])
    const dome = nearDome(scene, [JOINT_AT[0], BENCH_TOP_Y + 0.6, 0], 7)
    const head = benchHead(scene, [-11.2, 0.2, 0.6])
    const iron = solderingIron(scene, 'chisel', 1.2, 1.1)
    iron.group.scale.setScalar(0.3)
    const stand = ironStand(scene, [-14.6, BENCH_TOP_Y, 0])
    const scorch = add(scene, new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), mat('#2a1a10', { rough: 1 })), [-12.2, BENCH_TOP_Y + 0.02, 0.8])
    scorch.rotation.x = -Math.PI / 2
    const plume = fumePlume(scene, JOINT_AT)
    const fan = benchExtractor(scene, [0, 0, 0])
    const windowG = add(scene, new THREE.Group(), [-15.5, -0.6, -3])
    box(windowG, [3.6, 4.4, 0.2], mat('#c9ced8', { rough: 0.5 }), [0, 0, 0])
    box(windowG, [3, 3.8, 0.24], mat('#8fd0ff', { emissive: '#2a5070', rough: 0.2 }), [0, 0, 0.02])
    const windowTag = liveLabel(scene, [-15.5, 2.2, 0.3], { size: 0.28 })
    const snippet = leadSnippet(scene)
    const rows = textRows(scene, 3, -17, -8.7, 0.28, 1.05, 0.3)
    const { s, tag, draw } = benchPlot(scene, 'Rosin fume (log)', [6, 4], [`${C_HI}`, `${C_LO}`], [[HEAT, 0.08], [LABEL, 0.05]])
    const yC = (c: number) => (Math.log(Math.min(C_HI, Math.max(C_LO, c)) / C_LO) / Math.log(C_HI / C_LO)) * BENCH_PLOT.h - BENCH_PLOT.h / 2
    s.level(HIGH_V).set(yC(ROSIN_WEL.stel))
    s.level(RING, 0.3).set(yC(ROSIN_WEL.twa))
    const peakG = columnGauge(scene, 1, {
      min: 0.01,
      max: 3,
      log: true,
      window: [0.01, ROSIN_WEL.stel],
      marks: [[ROSIN_WEL.twa, '8 h', RING]],
      caption: 'Breathing zone, worst 15-min average',
      ticks: [[0.01, '0.01'], [0.1, '0.1'], [1, '1 mg/m³']],
    })
    const capG = columnGauge(scene, 2, {
      min: 0,
      max: 1,
      window: [0.9, 1],
      caption: 'Plume captured at the joint',
      ticks: [[0, '0'], [0.5, '50'], [1, '100 %']],
    })
    const clock = lapseClock(FM_LAPSE, 1, 2)
    let loop = 0
    let built = ''
    return {
      scene,
      view: BENCH_VIEW,
      frame(dt, p) {
        const c = fmCfg(p)
        const r = fmSolve(c)
        const Vt = FUME_VENTS[c.vent]
        if (built !== c.vent) {
          built = c.vent
          const fx = JOINT_AT[0] + 1.2 + Vt.extractCm * UNITS_PER_CM
          fan.group.position.set(fx, BENCH_TOP_Y + 1.9, 0.4)
          fan.group.visible = Vt.extractCm > 0
          plume.reach(Math.max(1, Vt.extractCm * UNITS_PER_CM + 0.8))
          windowG.visible = c.vent === 'window'
          windowTag.set(c.vent === 'window' ? 'window open' : '', LABEL)
        }
        fan.spin(dt, Vt.extractCm > 0 ? 25 : 0)
        const now = clock(dt, fmKey(c))
        const simMin = (now / FM_LAPSE) * FUME_SESSION.minutes
        const f = fumeAt(r, simMin)
        loop = (loop + dt) % LOOP_S
        const on = loop < 1.6
        const rest = c.stand ? stand.seat : ([-12.2, BENCH_TOP_Y + 0.35, 0.8] as [number, number, number])
        iron.group.rotation.z = !on && !c.stand ? 0.46 : 0
        iron.place(on ? [JOINT_AT[0] - 0.3, JOINT_AT[1] + 0.2, JOINT_AT[2]] : rest)
        iron.set(c.tipC, 0)
        scorch.visible = !c.stand
        plume.step(dt, on ? 1 : 0.1, r.eta)
        const u = (loop - 1.8) / 0.6
        snippet.fly([JOINT_AT[0] + 0.4, JOINT_AT[1] + 0.4, JOINT_AT[2]], c.glasses ? head.lens() : head.eye(), u, c.glasses)
        head.glasses(c.glasses)
        head.hit(!c.glasses && u > 0.65 && u < 1.4 ? 1 - Math.abs(u - 1) * 2 : 0)
        const ratio = f.near / ROSIN_WEL.stel
        dome.set(ratio <= 1 ? POWER : ratio <= 2 ? RING : HIGH_V, 0.05 + 0.13 * Math.min(1, Math.log10(1 + ratio)), `breathing zone ${mg(f.near)}`)
        draw(r.frames.length, Math.floor((simMin * 60) / FUME_SESSION.dtS) + 1, (j) => r.frames[j].t / FUME_SESSION.minutes, [(j) => yC(r.frames[j].near), (j) => yC(r.frames[j].far)])
        tag.set(`${fixedText(simMin, 0)} / ${FUME_SESSION.minutes} min`, LABEL)
        rows[0].set(`joint ${C(r.jointC)}: ${pct(r.share)} of each joint’s rosin burns off · ${fixedText(r.G, 2)} mg/min`, r.verdict.fail === 'hot' ? RING : GREY)
        rows[1].set(`glasses ${c.glasses ? 'on' : 'off'} · iron ${c.stand ? 'in the stand' : 'on the bench'}`, verdictTint(c.glasses && c.stand, false))
        rows[2].set(c.wash ? 'hands washed, no food at the bench' : 'snacking at the bench: lead from fingers to mouth', c.wash ? POWER : HIGH_V)
        peakG.set(Math.max(0.01, Math.min(3, r.peak15)), mg(r.peak15), verdictTint(r.peak15 <= ROSIN_WEL.stel, r.peak15 <= 2 * ROSIN_WEL.stel))
        capG.set(r.eta, pct(r.eta), verdictTint(r.eta >= 0.9, r.eta >= 0.5))
        header.set('a 30-minute soldering session, lungs, eyes and hands intact', r.verdict, fumeWhy(r), 'Hint: extractor a few cm from the joint, glasses on, iron in the stand, wash up')
      },
      readouts: (p) => {
        const r = fmSolve(fmCfg(p))
        return [
          { label: '15 min, mg/m³', value: fixedText(r.peak15, r.peak15 < 0.1 ? 3 : 2), tone: toneOf(r.peak15 <= ROSIN_WEL.stel, r.peak15 <= 2 * ROSIN_WEL.stel) },
          { label: 'Captured', value: pct(r.eta), tone: toneOf(r.eta >= 0.9, r.eta >= 0.5) },
          { label: 'Fume, mg/min', value: fixedText(r.G, 2), tone: toneOf(r.verdict.fail !== 'hot', true) },
          verdictReadout(r.verdict),
        ]
      },
    }
  },
}
