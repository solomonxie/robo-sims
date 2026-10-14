import * as THREE from 'three/webgpu'
import {
  BUCK_COILS,
  CHEMISTRIES,
  DCDC_MODULES,
  DcdcLimit,
  DcdcModule,
  LM2596,
  RunSample,
  boardC,
  buckRipple,
  cellVolts,
  dcdcPoint,
  outputRipple,
  potFor,
  regulatedShare,
  rippleAmps,
  runAt,
  runDown,
} from '../../core/physics'
import { amps, fitDigits, pct, volts, watts } from '../../core/units'
import { V3, add, mesh, rod } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  DcdcKind,
  GREY,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  cellPackModel,
  clamp01,
  dcdcModule,
  emptyGroup,
  glide,
  glowMat,
  heatWaves,
  ivScreen,
  label,
  lane,
  plusFlow,
  pulseLabel,
  scope,
  ticks,
  voltScale,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const LI = CHEMISTRIES.liion
const HEAT = '#ff9a4d'
const frac = (x: number) => x - Math.floor(x)
const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${+h.toFixed(1)} h`)
const mV = (v: number) => `${Math.round(v * 1000)} mV`
const uH = (h: number) => `${Math.round(h * 1e6)} µH`
const kOhm = (r: number) => (r < 1000 ? `${Math.round(r)} Ω` : `${+(r / 1000).toFixed(1)} kΩ`)

// --- Inductor ripple: the LM2596's coil current is a triangle round the load; too little load → DCM, too much → saturation. ---

const R_VIN = 12
const R_VOUT = 5
const OUT_C = 220e-6
const OUT_ESR = 0.08
const R_PERIOD_S = 1.6
const R_SLOW = Math.round(LM2596.sw.fHz * R_PERIOD_S)
const R_TOP = 5
const MOD1: V3 = [-7.6, 1.2, 0]
const K1 = 0.34
const SC1: V3 = [7.8, 0.6, 0]
const SC1_W = 10
const SC1_H = 8

const solveRipple = (p: Params) => {
  const coil = BUCK_COILS.find((c) => String(Math.round(c.henries * 1e6)) === p.coil) ?? BUCK_COILS[1]
  const iout = n(p, 'load')
  const r = buckRipple(R_VIN, R_VOUT, iout, coil.henries, LM2596.sw.fHz)
  const dI = r.iMax - r.iMin
  return { coil, iout, r, dI, vRipple: outputRipple(dI, LM2596.sw.fHz, OUT_C, OUT_ESR), saturating: r.iMax > coil.isat }
}

export const inductorRipple: Lesson = {
  id: 'buck-boost-inductor-ripple',
  title: 'Inductor ripple',
  tagline: 'The triangle in the coil, and what it does to your rail',
  formula: (p) => {
    const s = solveRipple(p)
    return `ΔI = (Vin − Vout)·D / (L·f) = 7 V × ${s.r.duty.toFixed(2)} / (${uH(s.coil.henries)} × 150 kHz) = ${amps(s.dI)} · peak = ${amps(s.r.iMax)}`
  },
  legend: [
    { color: CONVENTIONAL, label: 'Coil current', shape: 'dot' },
    { color: POWER, label: 'Average = load current', shape: 'dot' },
    { color: HIGH_V, label: 'Coil saturation current', shape: 'dot' },
  ],
  points: [
    'Inside an LM2596 board (150 kHz, 3S pack → 5 V) the coil current is a triangle round the load current: ΔI = (Vin − Vout)·D / (L·f).',
    'ΔI does not depend on the load. Below ΔI/2 of load the current hits zero every cycle: discontinuous mode (DCM). It still regulates, but the switch node rings.',
    'The peak, Iout + ΔI/2, must stay under the coil’s saturation current. Past it the core saturates, the inductance collapses and the current spikes: hot coil, noise, current limit.',
    'In the same size of core, more µH means more turns of thinner wire: less ripple but a lower saturation current. 33 µH is the stock LM2596 compromise.',
    'The output cap turns ΔI into voltage ripple, mostly ΔI × ESR: tens of mV. Fine for logic; add an LC filter or an LDO before an ADC or audio.',
    'Higher frequency shrinks the coil: the MT3608 switches at 1.2 MHz with a tiny 22 µH drum.',
  ],
  controls: [
    { kind: 'choice', key: 'coil', options: BUCK_COILS.map((c) => ({ value: String(Math.round(c.henries * 1e6)), label: uH(c.henries) })), initial: '33' },
    { kind: 'slider', key: 'load', label: 'Load current', min: 0.05, max: 3, initial: 1, step: 0.05, format: (v) => amps(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const mod = dcdcModule(scene, MOD1, 'lm2596', K1)
    const coilAt = mod.coilTop[0]
    const callout = add(scene, new THREE.Group())
    const tagAt: V3 = [coilAt[0] - 1.2, MOD1[1] - 6.4, 0]
    const status = add(scene, new THREE.Group(), [MOD1[0], MOD1[1] - 8.6, 0])
    const coilHeat = heatWaves(scene, 2.4, { count: 3, rise: 1.8 })
    coilHeat.group.position.set(coilAt[0], coilAt[1] + 1.8, coilAt[2] + 0.4)

    const plot = scope(scene, SC1_W, SC1_H, { divs: [6, 5], zeroAt: 0 })
    plot.group.position.set(...SC1)
    const yOf = (a: number) => (a / R_TOP) * SC1_H - SC1_H / 2
    ticks(plot, [], [0, 1, 2, 3, 4, 5].map((a): [number, string] => [a / R_TOP, String(a)]))
    add(plot.group, label('A', { size: 0.6, color: CONVENTIONAL }), [SC1_W / 2 + 1.5, SC1_H / 2 + 1.6, 0])
    add(plot.group, label('12 V TO 5 V  3 PERIODS = 20 µs', { size: 0.5, color: GREY }), [0, -SC1_H / 2 - 1.3, 0])
    const avg = plot.level(POWER)
    const sat = plot.level(HIGH_V, 0.35)
    const trace = plot.trace(CONVENTIONAL)
    const st = { key: '', t: 0, mode: '', s: solveRipple({ coil: '33', load: 1 }) }

    return {
      scene,
      view: { center: [-0.4, -1.2, 0], radius: 55, polar: 1.36, azimuth: 0.12 },
      frame(dt, p) {
        const s = solveRipple(p)
        st.s = s
        const key = `${s.coil.henries}`
        if (key !== st.key) {
          st.key = key
          emptyGroup(callout)
          rod(callout, [coilAt[0], coilAt[1] - 1.4, coilAt[2]], [coilAt[0], tagAt[1] + 0.9, coilAt[2]], 0.06, glowMat(RING, 0.6))
          add(callout, label(`${uH(s.coil.henries)}  ISAT ${amps(s.coil.isat)}`, { size: 0.6, color: RING }), tagAt)
        }
        st.t += dt
        const signal = (t: number) => yOf(rippleAmps(s.r, frac(t / R_PERIOD_S)))
        trace.scroll(signal, st.t, 3 * R_PERIOD_S)
        avg.set(yOf(s.iout))
        sat.set(yOf(s.coil.isat))
        const now = rippleAmps(s.r, frac(st.t / R_PERIOD_S))
        mod.set(0, 0.15 + (0.85 * now) / s.coil.isat)
        coilHeat.step(dt, s.saturating ? 0.9 : 0)
        const mode = s.saturating ? 'SATURATING' : s.r.ccm ? 'CONTINUOUS' : 'DISCONTINUOUS'
        if (mode !== st.mode) {
          st.mode = mode
          emptyGroup(status)
          add(status, label(mode, { size: 0.75, color: s.saturating ? HIGH_V : s.r.ccm ? POWER : RING }))
        }
      },
      readouts: () => {
        const s = st.s
        return [
          { label: 'Coil ripple ΔI (p-p)', value: amps(s.dI) },
          { label: 'Peak vs saturation', value: `${amps(s.r.iMax)} / ${amps(s.coil.isat)}`, tone: s.saturating ? 'bad' : s.r.iMax > 0.85 * s.coil.isat ? 'warn' : 'ok' },
          { label: 'Output ripple (220 µF)', value: mV(s.vRipple) },
          { label: `Mode (${R_SLOW.toLocaleString('en-US')}× slower)`, value: s.r.ccm ? 'continuous' : 'discontinuous' },
        ]
      },
    }
  },
}

// --- Efficiency: an LM2596 on a 2S or 3S pack, 5 V out, over a whole discharge. Pack current climbs as it sags. ---

const E_OUT = 5
const LOADS = [0.5, 1, 2, 3]
const PACK2: V3 = [-13, 0.6, 0]
const MOD2: V3 = [-1.4, 1.2, 0]
const K2 = 0.28
const PLOT2: V3 = [10, 0.6, 0]
const PLOT2_W = 9
const PLOT2_H = 7.5
const PLAY2_S = 12
const HOLD2_S = 2.5
const EFF_LO = 0.5

const solveEff = (p: Params) => {
  const series = n(p, 'pack')
  const iout = n(p, 'load')
  const run = runDown(LM2596, LI, series, E_OUT, iout, 240)
  const end = run[run.length - 1].hours
  const iTop = Math.ceil(Math.max(...run.map((r) => r.point.iin)) * 1.2)
  return { series, iout, run, end, iTop, speedup: Math.round((end * 3600) / PLAY2_S) }
}

const runStatus = (k: RunSample) => (k.point.regulating ? `${volts(k.point.vout)} OUT` : `DROPOUT ${volts(k.point.vout)}`)

export const efficiency: Lesson = {
  id: 'buck-boost-efficiency',
  title: 'Efficiency',
  tagline: 'Where the watts go over a whole battery',
  formula: (p) => {
    const series = n(p, 'pack')
    const iout = n(p, 'load')
    const k = dcdcPoint(LM2596, series * LI.nominal, E_OUT, iout)
    return `η = Pout / (Pout + losses) = ${watts(E_OUT * iout)} / (${watts(E_OUT * iout)} + ${watts(k.loss)}) = ${pct(k.efficiency)} · Iin = Pin / Vpack`
  },
  legend: [
    { color: POWER, label: 'Efficiency', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Current from the pack', shape: 'dot' },
    { color: RING, label: 'Pack voltage', shape: 'dot' },
  ],
  points: [
    'A buck trades volts for amps: Pin = Pout + losses, so the pack supplies less current than the 5 V load draws.',
    'Losses: switch I²R, the diode’s 0.5 V during the off-time, coil resistance, switching edges and the chip’s own few mA. An LM2596 lands at 80–90 %.',
    'The module draws constant power, not constant current: as the pack sags it pulls more amps to deliver the same watts, so the drain speeds up near the end.',
    'Efficiency drops at high current (I²R grows with the square). The boards say 3 A but get hot past ~2 A without a heatsink.',
    'A 2S pack near empty (≈ 6.3 V) is too close to 5 V: the buck runs out of headroom and drops out, and the MCU browns out. 3S has headroom to spare.',
    'Robot tip: set the low-voltage cut-off above the dropout point, or use 3S or a buck-boost for the logic rail.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'pack',
      options: [
        { value: '2', label: '2S (7.4 V)' },
        { value: '3', label: '3S (11.1 V)' },
      ],
      initial: '2',
    },
    { kind: 'choice', key: 'load', options: LOADS.map((a) => ({ value: String(a), label: amps(a) })), initial: '2' },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const mod = dcdcModule(scene, MOD2, 'lm2596', K2)
    const packs = new Map([2, 3].map((s) => [s, add(scene, new THREE.Group())]))
    const flows = new Map<number, ReturnType<typeof plusFlow>[]>()
    for (const [series, g] of packs) {
      const pack = cellPackModel(g, series, 1, { r: 0.9 })
      pack.group.position.set(...PACK2)
      const at = (v: V3): V3 => [v[0] + PACK2[0], v[1] + PACK2[1], 0]
      const plus = at(pack.plus)
      const minus = at(pack.minus)
      const e = pack.h / 2
      const out = Math.sign(plus[1] - PACK2[1]) * 0.9
      const { inP, inM } = mod.pins
      const pRoute: V3[] = [plus, [plus[0], plus[1] + out, 0], [-9.6, plus[1] + out, 0], [-9.6, inP[1], 0], [inP[0], inP[1], 0]]
      const mRoute: V3[] = [minus, [minus[0], PACK2[1] - e - 1.8, 0], [-9, PACK2[1] - e - 1.8, 0], [-9, inM[1], 0], [inM[0], inM[1], 0]]
      wire(g, pRoute, 0.16)
      wire(g, mRoute, 0.16)
      flows.set(series, [plusFlow(g, lane(pRoute, 0.9), () => 1), plusFlow(g, lane(mRoute, 0.9).reverse(), () => 0)])
      add(g, label(`${series}S`, { size: 0.7, color: LABEL }), [PACK2[0], PACK2[1] + e + 2.2, 0])
    }
    const packLabel = pulseLabel(scene, 4, RING, [PACK2[0], PACK2[1] - 7, 0], 1)
    const heat = heatWaves(scene, 3, { count: 4, rise: 2 })
    heat.group.position.set(mod.chipTop[0], mod.chipTop[1] + 1.6, mod.chipTop[2] + 0.4)
    const status = add(scene, new THREE.Group(), [MOD2[0], MOD2[1] - 5, 0])
    const boardAt: V3 = [MOD2[0], MOD2[1] - 7.4, 0]
    const boardLabel = pulseLabel(scene, 3, HEAT, [boardAt[0] - 1.2, boardAt[1], 0], 1)
    add(scene, label('°C BOARD', { size: 0.45, color: GREY, align: 'left' }), [boardAt[0] + 0.6, boardAt[1] - 0.4, 0])

    const { plot, dot, y } = ivScreen(scene, PLOT2, PLOT2_W, PLOT2_H, [5, 5])
    const yE = (e: number) => y((e - EFF_LO) / (1 - EFF_LO))
    const eTrace = plot.trace(POWER, { radius: 0.1 })
    const iTrace = plot.trace(CONVENTIONAL, { radius: 0.1 })
    const iDot = add(plot.group, mesh(new THREE.SphereGeometry(0.36, 16, 12), glowMat(CONVENTIONAL, 1.4)))
    add(plot.group, label('η %', { size: 0.55, color: POWER }), [PLOT2_W / 2 + 1.6, PLOT2_H / 2 + 0.9, 0])
    add(plot.group, label('HOURS', { size: 0.5, color: GREY }), [0, -PLOT2_H / 2 - 2.3, 0])
    const dynamic = add(plot.group, new THREE.Group())
    const st = { key: '', t: 0, status: '', s: solveEff({ pack: 2, load: 2 }) }
    const now = () => runAt(st.s.run, Math.min(st.t, PLAY2_S) * (st.s.end / PLAY2_S))

    return {
      scene,
      view: { center: [1.2, -1.2, 0], radius: 57, polar: 1.36, azimuth: 0.1 },
      frame(dt, p) {
        const key = `${p.pack}|${p.load}`
        if (key !== st.key) {
          const s = solveEff(p)
          st.key = key
          st.s = s
          st.t = 0
          for (const [series, g] of packs) g.visible = series === s.series
          const at = (u: number) => runAt(s.run, u * s.end)
          eTrace.draw((u) => yE(at(u).point.efficiency), null)
          iTrace.draw((u) => y(at(u).point.iin / s.iTop), null)
          emptyGroup(dynamic)
          const step = s.end > 6 ? 2 : s.end > 2 ? 1 : 0.5
          const xt = Array.from({ length: Math.floor(s.end / step) + 1 }, (_, i): [number, string] => [(i * step) / s.end, String(i * step)])
          ticks({ ...plot, group: dynamic }, xt, [0.5, 0.75, 1].map((e): [number, string] => [(e - EFF_LO) / (1 - EFF_LO), String(e * 100)]))
          add(dynamic, label(`${amps(s.iTop)}`, { size: 0.45, color: CONVENTIONAL, align: 'right' }), [-PLOT2_W / 2 - 0.4, PLOT2_H / 2 - 0.2, 0])
          const lost = s.run.find((r) => !r.point.regulating)
          if (lost) {
            const x = plot.xAt(lost.hours / s.end)
            add(dynamic, mesh(new THREE.BoxGeometry(0.08, PLOT2_H, 0.08), glowMat(HIGH_V, 0.6)), [x, 0, 0.15])
            add(dynamic, label('DROPOUT', { size: 0.4, color: HIGH_V, align: 'right' }), [x - 0.3, -PLOT2_H / 2 + 0.6, 0.2])
          }
        }
        st.t += dt
        if (st.t > PLAY2_S + HOLD2_S) st.t = 0
        const k = now()
        const u = k.hours / st.s.end
        dot.position.set(plot.xAt(u), yE(k.point.efficiency), 0.3)
        iDot.position.set(plot.xAt(u), y(k.point.iin / st.s.iTop), 0.3)
        const tC = boardC(LM2596, k.point.loss)
        mod.set((tC - 50) / 60, 0.2 + 0.25 * st.s.iout)
        heat.step(dt, k.point.loss / 4)
        for (const f of flows.get(st.s.series) ?? []) f.step(dt * (0.5 + 2 * k.point.iin))
        packLabel.show(fitDigits(k.vpack, 4))
        packLabel.frame(dt)
        boardLabel.show(String(Math.round(tC)))
        boardLabel.frame(dt)
        const text = runStatus(k)
        if (text !== st.status) {
          st.status = text
          emptyGroup(status)
          add(status, label(text, { size: 0.75, color: k.point.regulating ? POWER : HIGH_V }))
        }
      },
      readouts: () => {
        const k = now()
        return [
          { label: 'Pack · current in', value: `${volts(k.vpack)} · ${amps(k.point.iin)}` },
          { label: `Efficiency (${E_OUT} V × ${amps(st.s.iout)} out)`, value: pct(k.point.efficiency), tone: k.point.regulating ? undefined : 'bad' },
          { label: 'Lost as heat', value: watts(k.point.loss), tone: k.point.loss > 2 ? 'warn' : undefined },
          { label: `Time (${st.s.speedup}× fast) · charge`, value: `${hours(k.hours)} · ${pct(k.soc)}` },
        ]
      },
    }
  },
}

// --- Choosing a module: the pack's whole range against the rail. Above it → buck, below → boost, crossing → buck-boost. ---

const C_AMPS = 1
const KINDS: DcdcKind[] = ['lm2596', 'mt3608', 'xl6009']
const TOPO = { buck: 'buck', boost: 'boost', sepic: 'buck-boost' }
const RULER_X = -11.5
const RULER_Y = -6.6
const PER_V = 0.78
const V_MAX = 14
const MOD3: V3 = [3, 1.8, 0]
const K3 = 0.3
const PLAY3_S = 10
const HOLD3_S = 2
const LIMIT_TEXT: Record<DcdcLimit, string> = {
  off: 'OFF: INPUT BELOW 5 V',
  'over-voltage': 'INPUT OVER MAX',
  dropout: 'DROPOUT: PACK TOO LOW',
  'pass-through': 'PACK PASSES STRAIGHT THROUGH',
  'current-limit': 'CURRENT LIMIT',
}

const solveChoice = (p: Params) => {
  const kind = (KINDS.includes(p.module as DcdcKind) ? p.module : 'lm2596') as DcdcKind
  const m: DcdcModule = DCDC_MODULES[kind]
  const series = n(p, 'pack')
  const vset = n(p, 'vout')
  return { kind, m, series, vset, pot: potFor(m, vset), share: regulatedShare(m, LI, series, vset, C_AMPS) }
}

const verdict = (s: ReturnType<typeof solveChoice>) =>
  s.share.share > 0.999 ? 'full to empty' : s.share.share < 0.001 ? 'never' : `${pct(s.share.share)} of charge`

export const choosingAModule: Lesson = {
  id: 'buck-boost-choosing-a-module',
  title: 'Choosing a module',
  tagline: 'Buck, boost or both: compare the whole pack range to the rail',
  formula: (p) => {
    const s = solveChoice(p)
    return `Vout = Vref (1 + R_pot / R_low) = ${s.m.vref} V × (1 + ${kOhm(s.pot.ohms)} / ${kOhm(s.m.rLow)}) = ${volts(s.m.vref * (1 + s.pot.ohms / s.m.rLow))} · pack ${volts(s.series * LI.full)} → ${volts(s.series * LI.cutoff)}`
  },
  legend: [
    { color: RING, label: 'Pack voltage, full → empty', shape: 'dot' },
    { color: POWER, label: 'Output set by the trim pot', shape: 'dot' },
    { color: HIGH_V, label: 'Rail lost or too high', shape: 'dot' },
  ],
  points: [
    'Compare the rail to the pack’s whole range, not its nominal: 2S runs 8.4 → 6.0 V, 3S 12.6 → 9.0 V.',
    'Range always above the rail → buck (LM2596: cheap, efficient). Always below → boost (MT3608). Crossing it → buck-boost (XL6009 SEPIC).',
    'A buck drops out once the pack gets within ~1.5 V of the output. A boost cannot step down: above the set point the pack passes straight through the diode, so a “5 V” rail sees 8 V.',
    'Set the output before wiring the robot: power the module alone, meter on OUT, and turn the 25-turn trim pot. Vout = Vref (1 + R_pot / R_low).',
    'Typical robot: 2S → LM2596 at 5 V for the logic; motors straight off the pack, or an XL6009 for a steady 7.4 V or 12 V motor rail.',
    'Mind the current too: LM2596 ~2 A, MT3608 ~1 A, XL6009 ~1.5 A without a heatsink. The XL6009 needs at least 5 V in to start.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'pack',
      options: [
        { value: '2', label: '2S' },
        { value: '3', label: '3S' },
      ],
      initial: '2',
    },
    {
      kind: 'choice',
      key: 'module',
      options: KINDS.map((k) => ({ value: k, label: `${DCDC_MODULES[k].name} ${TOPO[DCDC_MODULES[k].topology]}` })),
      initial: 'lm2596',
    },
    { kind: 'slider', key: 'vout', label: 'Trim pot: output', min: 3.3, max: 12, initial: 5, step: 0.1, format: (v) => volts(v) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const ruler = add(scene, new THREE.Group(), [0, RULER_Y, 0])
    voltScale(ruler, RULER_X, 0, V_MAX, PER_V)
    for (const v of [0, 5, 10]) add(ruler, label(String(v), { size: 0.5, color: GREY, align: 'right' }), [RULER_X - 1.1, v * PER_V - 0.25, 0])
    add(ruler, label('V', { size: 0.55, color: GREY }), [RULER_X, V_MAX * PER_V + 0.9, 0])
    const band = add(ruler, mesh(new THREE.BoxGeometry(1, 1, 0.3), glowMat(RING, 0.35)), [RULER_X + 1.6, 0, 0])
    const packDot = add(ruler, mesh(new THREE.SphereGeometry(0.42, 18, 12), glowMat(RING, 1.4)), [RULER_X + 1.6, 0, 0.4])
    const setLine = add(ruler, mesh(new THREE.BoxGeometry(5.2, 0.14, 0.14), glowMat(POWER, 0.9)), [RULER_X + 2.2, 0, 0.3])
    const outMat = glowMat(POWER, 1.4)
    const outDot = add(ruler, mesh(new THREE.SphereGeometry(0.42, 18, 12), outMat), [RULER_X + 3.6, 0, 0.5])
    add(ruler, label('PACK', { size: 0.45, color: RING }), [RULER_X + 1.6, -1, 0])
    add(ruler, label('OUT', { size: 0.45, color: POWER }), [RULER_X + 3.6, -1, 0])

    const mods = new Map(KINDS.map((k) => [k, dcdcModule(scene, MOD3, k, K3)]))
    const name = add(scene, new THREE.Group(), [MOD3[0], MOD3[1] - 5.4, 0])
    const outAt: V3 = [MOD3[0] - 1.2, MOD3[1] - 7.5, 0]
    const outLabels = [pulseLabel(scene, 4, POWER, outAt, 1.1), pulseLabel(scene, 4, HIGH_V, outAt, 1.1)]
    add(scene, label('V OUT', { size: 0.5, color: GREY, align: 'left' }), [MOD3[0] + 1.6, MOD3[1] - 8, 0])
    const status = add(scene, new THREE.Group(), [MOD3[0], MOD3[1] - 9.7, 0])
    const bad = add(ruler, new THREE.Group())
    const st = { key: '', t: 0, turn: 0, status: '', s: solveChoice({ pack: 2, module: 'lm2596', vout: 5 }) }
    const soc = () => 1 - Math.min(st.t, PLAY3_S) / PLAY3_S
    const point = () => dcdcPoint(st.s.m, st.s.series * cellVolts(LI, soc()), st.s.vset, C_AMPS)

    return {
      scene,
      view: { center: [-1, -2.8, 0], radius: 48, polar: 1.36, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveChoice(p)
        const key = `${s.kind}|${s.series}|${s.vset}`
        if (key !== st.key) {
          st.key = key
          st.s = s
          st.t = 0
          for (const [k, m] of mods) m.group.visible = k === s.kind
          const hi = s.series * LI.full
          const lo = s.series * LI.cutoff
          band.scale.y = (hi - lo) * PER_V
          band.position.y = ((hi + lo) / 2) * PER_V
          setLine.position.y = s.vset * PER_V
          emptyGroup(bad)
          const badMat = glowMat(HIGH_V, 0.9)
          const N = 60
          for (let i = 0; i < N; i++) {
            const v = s.series * cellVolts(LI, 1 - (i + 0.5) / N)
            if (!dcdcPoint(s.m, v, s.vset, C_AMPS).regulating) {
              const h = ((s.series * cellVolts(LI, 1 - i / N) - s.series * cellVolts(LI, 1 - (i + 1) / N)) * PER_V)
              add(bad, mesh(new THREE.BoxGeometry(1.1, Math.max(0.05, h), 0.4), badMat), [RULER_X + 1.6, v * PER_V, 0.05])
            }
          }
          emptyGroup(name)
          add(name, label(`${s.m.name}  ${TOPO[s.m.topology].toUpperCase()}`, { size: 0.7, color: LABEL }))
        }
        st.t += dt
        if (st.t > PLAY3_S + HOLD3_S) st.t = 0
        const k = point()
        const mod = mods.get(s.kind)!
        st.turn = glide(dt, st.turn, s.pot.frac, 4)
        mod.turn(st.turn)
        mod.set(k.regulating ? 0.1 : 0, k.limit === 'off' ? 0 : 0.5)
        packDot.position.y = k.vin * PER_V
        outDot.position.y = Math.min(V_MAX, k.vout) * PER_V
        outMat.emissive.set(k.regulating ? POWER : HIGH_V)
        outMat.color.set(k.regulating ? POWER : HIGH_V)
        outLabels.forEach((l, i) => {
          l.display.group.visible = (i === 0) === k.regulating
          l.show(k.vout.toFixed(2))
          l.frame(dt)
        })
        const text = k.limit ? LIMIT_TEXT[k.limit] : 'REGULATING'
        if (text !== st.status) {
          st.status = text
          emptyGroup(status)
          add(status, label(text, { size: 0.7, color: k.limit ? HIGH_V : POWER }))
        }
      },
      readouts: () => {
        const s = st.s
        const k = point()
        const fail = s.share.failAt
        return [
          { label: 'Pack now · charge', value: `${volts(k.vin)} · ${pct(clamp01(soc()))}` },
          { label: `Output (set ${volts(s.vset)}, ${amps(C_AMPS)})`, value: k.limit === 'off' ? 'off' : volts(k.vout), tone: k.regulating ? 'ok' : 'bad' },
          { label: `Trim pot (R_low ${kOhm(s.m.rLow)})`, value: `${kOhm(s.pot.ohms)} · ${(s.pot.frac * 25).toFixed(1)} turns` },
          { label: fail && s.share.share > 0.001 ? `Rail holds (first lost at ${volts(fail.vpack)})` : 'Rail holds', value: verdict(s), tone: s.share.share > 0.999 ? 'ok' : s.share.share > 0.8 ? 'warn' : 'bad' },
        ]
      },
    }
  },
}
