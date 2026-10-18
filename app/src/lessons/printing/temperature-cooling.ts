import * as THREE from 'three/webgpu'
import {
  BED,
  BED_CTRLS,
  BED_HEATERS,
  BED_INSUL,
  BedCtrl,
  BedHeater,
  BedInsul,
  COOL_FILAMENTS,
  CoolFilament,
  GCODE_HEAT,
  HOTEND_FAULTS,
  HeaterRun,
  HotendFault,
  MARLIN_WATCH,
  bedRun,
  coolRun,
  coreTempAt,
  heaterAt,
  holdStats,
  hotendRun,
  hotendTune,
  minLayerS,
  once,
} from '../../core/physics'
import { celsiusText, fixedText, pct, secs } from '../../core/units'
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
  boxFan,
  cursorBar,
  flatBox,
  glowMat,
  hotendSection,
  ironbow,
  lapseClock,
  liveLabel,
  memoBy,
  plotY,
  setGlow,
  statusHeader,
  tempColor,
  termBars,
  textRows,
  titledScope,
  traceRun,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const SET_C = 210
const HE = { at: [-12.2, 2.5, 0] as V3, k: 0.27 }
const PLOT = { x: 8.6, w: 11.8, top: { y: -1.2, h: 6 }, low: { y: -8.7, h: 3.2 } }

/** Hotend cut-away and a part fan aimed at the block from the right; `show(block, cart, fan, dt)`. */
function hotendRig(scene: THREE.Object3D) {
  const he = hotendSection(scene, HE.at, HE.k, 'v6')
  const blockY = HE.at[1] + he.tipY + 4.2 * HE.k
  const fan = boxFan(scene, [-4.6, blockY, 0], 2.6)
  fan.group.rotation.y = -0.7
  addLabel(scene, 'part fan', [-4.6, blockY + 2, 0.3], B_FIELD, 0.28)
  addLabel(scene, 'thermistor', [HE.at[0] + 2.4, blockY - 1.9, 0.6], LABEL, 0.24, 'left')
  addLabel(scene, 'heater', [HE.at[0] - 3.2, blockY - 1.9, 0.6], HEAT, 0.24, 'right')
  return {
    he,
    blockY,
    show(block: number, cart: number, fanF: number, dt: number) {
      he.set(0, (s) => coreTempAt('v6', block, 0, s), block, 0)
      const cm = he.cartridge.material as THREE.MeshStandardMaterial
      tempColor(cart + 40, cm.emissive)
      fan.spin(dt, 30 * fanF)
    },
  }
}

/** Temperature scope on the top right with target level and time cursor; `draw(run, t, value)` traces up to t. */
function tempScope(scene: THREE.Object3D, title: string, lo: number, hi: number, seconds: number, P = PLOT.top) {
  const plot = titledScope(scene, P.y, P.h, title, LABEL, 0, PLOT.x, PLOT.w)
  const py = plotY(lo, hi, P.h)
  plot.lo.set('0 s')
  plot.hi.set(secs(seconds))
  addLabel(scene, celsiusText(hi), [PLOT.x - PLOT.w / 2 + 0.2, P.y + P.h / 2 - 0.4, 0.4], GREY, 0.24, 'left')
  addLabel(scene, celsiusText(lo), [PLOT.x - PLOT.w / 2 + 0.2, P.y - P.h / 2 + 0.4, 0.4], GREY, 0.24, 'left')
  return { plot, py, cursor: cursorBar(plot.s, LABEL, 0.05) }
}

// --- Hotend PID tuning: 40 W cartridge, block, thermistor lag; bang-bang vs PID; M303 relay → Ku, Tu → ZN; fan as a disturbance. ---

const PT = { seconds: 300, fanAt: 200, lapse: 15, lo: 190, hi: 230 }
const PID_MODES = { bang: 'Bang-bang, ±2 °C', pid: 'PID, your gains', m303: 'M303 autotune, then its gains' }
const ptParams = (p: Params) => ({ mode: pick(PID_MODES, p.mode, 'pid'), g: { kp: n(p, 'kp'), ki: n(p, 'ki'), kd: n(p, 'kd') }, fan: n(p, 'fan') / 100 })
const ptKey = (p: Params) => `${p.mode} ${p.kp} ${p.ki} ${p.kd} ${p.fan}`
const ptRun = memoBy(ptKey, (p: Params) => {
  const q = ptParams(p)
  const run = hotendRun(q.mode === 'bang' ? { kind: 'bang', band: 4 } : q.mode === 'pid' ? { kind: 'pid', gains: q.g } : { kind: 'relay' }, SET_C, PT.seconds, { fanAt: PT.fanAt, fan: q.fan })
  const from = run.tune ? run.tune.doneAt : run.frames.find((f) => f.read >= SET_C)?.t ?? PT.fanAt
  const over = holdStats(run, from, PT.fanAt).max - SET_C
  const hold = holdStats(run, Math.max(150, from + 20), PT.fanAt)
  const dip = SET_C - holdStats(run, PT.fanAt).min
  return { q, run, over, hold, dip }
})

export const temperatureCoolingHotendPidTuning: Lesson = {
  id: 'temperature-cooling-hotend-pid-tuning',
  title: 'Hotend PID tuning',
  tagline: 'Hold 210 °C within a degree, even when the fan kicks in',
  formula: (p) => {
    const { q, run } = ptRun(p)
    const t = run.tune
    if (q.mode === 'm303' && t)
      return `relay ±${Math.round(t.d)}/255 swings ±${fixedText(t.amp, 1)} °C · Ku = 4d / (π·a) = 4·${Math.round(t.d)} / (π·${fixedText(t.amp, 1)}) = ${fixedText(t.ku, 1)} · Tu = ${fixedText(t.tu, 1)} s · Kp = 0.6·Ku = ${fixedText(t.gains.kp, 1)}, Ki = 2·Kp/Tu = ${fixedText(t.gains.ki, 2)}, Kd = Kp·Tu/8 = ${fixedText(t.gains.kd, 1)}`
    if (q.mode === 'bang') return 'heater 100 % below 208 °C, 0 % above 212 °C · the block keeps heating after it switches off: thermistor and cartridge lag · model typical: 40 W, block τ 60 s'
    return `PWM = Kp·e + Ki·∫e dt − Kd·dT/dt = ${q.g.kp}·e + ${q.g.ki}·∫e − ${q.g.kd}·dT/dt (0…255) · full on more than 10 °C below (Marlin's PID range) · model typical: 40 W, block τ 60 s`
  },
  legend: [
    { color: HEAT, label: 'Block temperature (true)', shape: 'dot' },
    { color: RING, label: 'Thermistor reading', shape: 'dot' },
    { color: POWER, label: 'Heater PWM 0–100 %', shape: 'dot' },
    { color: B_FIELD, label: `Part fan on at ${PT.fanAt} s`, shape: 'dot' },
  ],
  points: [
    'A hotend is a 40 W heater cartridge in an aluminium block, with a thermistor bead in a second hole. The heat goes cartridge → block → thermistor, and each step lags: when the firmware sees 210 °C the cartridge is far hotter and keeps pushing heat in. That lag is why plain on/off (bang-bang) swings several degrees around the target.',
    'Marlin and Klipper run a PID loop on the heater PWM instead (the P, I and D terms, windup and derivative kick are in Control > PID). Two firmware details: more than 10 °C from the target the heater is simply full on or off, and D acts on the measured temperature, so changing the target does not kick it. The I term is what holds the ~50 % PWM needed against the heat lost at 210 °C.',
    'M303 E0 S210 C5 autotunes: it toggles the heater full on and off around 210 °C (a relay), measures the swing a and period Tu, and works out the ultimate gain Ku = 4d/(π·a), as in Ziegler–Nichols but without hunting for the edge by hand. Classic ZN then gives Kp = 0.6·Ku, Ki = 2·Kp/Tu, Kd = Kp·Tu/8. M500 saves them; tune at the temperature you print at, with the fan at its usual speed.',
    'A part fan that hits the block is a disturbance: more heat leaves, the temperature dips and the I term climbs until the PWM covers it. A silicone sock shrinks the dip. If the dip is large, retune with the fan on (M303 … U1 with M106 first). How the melt follows the block is in How FDM works > Hotend and extruder.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(PID_MODES), initial: 'pid' },
    { kind: 'slider', key: 'kp', label: 'Kp', min: 0, max: 60, step: 1, initial: 10, format: (v) => `${v} PWM/°C` },
    { kind: 'slider', key: 'ki', label: 'Ki', min: 0, max: 6, step: 0.1, initial: 0.5, format: (v) => `${v.toFixed(1)} PWM/°C·s` },
    { kind: 'slider', key: 'kd', label: 'Kd', min: 0, max: 200, step: 5, initial: 50, format: (v) => `${v} PWM·s/°C` },
    { kind: 'slider', key: 'fan', label: `Fan at ${PT.fanAt} s`, min: 0, max: 100, step: 10, initial: 100, format: (v) => `${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const rig = hotendRig(scene)
    const bars = termBars(scene, [-3.6, -9.4, 0], 5)
    const ts = tempScope(scene, 'temperature around 210 °C', PT.lo, PT.hi, PT.seconds)
    const tr = { block: ts.plot.s.trace(HEAT, { samples: 300, radius: 0.05 }), read: ts.plot.s.trace(RING, { samples: 300, radius: 0.07 }) }
    ts.plot.s.level(GREY).set(ts.py(SET_C))
    const L = PLOT.low
    const duty = titledScope(scene, L.y, L.h, 'heater PWM', POWER, 0, PLOT.x, PLOT.w)
    const dTr = duty.s.trace(POWER, { samples: 300, radius: 0.05 })
    const fanLv = cursorBar(duty.s, B_FIELD, 0.08)
    const dCur = cursorBar(duty.s, LABEL, 0.05)
    const clock = lapseClock(PT.seconds, PT.lapse, 30)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, run, dip } = ptRun(p)
        const t = clock(dt, ptKey(p))
        const f = heaterAt(run, t)
        const fanOn = t >= PT.fanAt ? q.fan : 0
        rig.show(f.actual, f.x[0], fanOn, dt)
        const sdt = run.dt * run.keep
        traceRun(tr.block, run.frames, sdt, PT.seconds, t, (g) => ts.py(g.actual), 300)
        traceRun(tr.read, run.frames, sdt, PT.seconds, t, (g) => ts.py(g.read), 300)
        traceRun(dTr, run.frames, sdt, PT.seconds, t, (g) => (g.duty - 0.5) * L.h * 0.96, 300)
        ts.cursor(t / PT.seconds)
        dCur(t / PT.seconds)
        fanLv(q.fan > 0 ? PT.fanAt / PT.seconds : null)
        ts.plot.right.set(`reads ${celsiusText(f.read, 1)}`, RING)
        duty.right.set(pct(f.duty), POWER)
        duty.lo.set('0 s')
        duty.hi.set(secs(PT.seconds))
        bars.set({ p: f.p / 255, i: f.i / 255, d: f.d / 255, u: f.duty }, false)
        const relay = q.mode === 'm303' && (!run.tune || t < run.tune.doneAt)
        head.status.set(`Hotend PID tuning · ${PID_MODES[q.mode]}`)
        head.sub.set(`t = ${secs(t)} of ${secs(PT.seconds)}, ${PT.lapse}× fast · grey dashes: target ${celsiusText(SET_C)}`, GREY)
        head.event.set(
          t < 20 ? 'heating from room temperature, full power' : relay ? 'M303: relay on/off around 210 °C, measuring swing and period' : t >= PT.fanAt && q.fan > 0 ? q.mode === 'bang' ? `fan on: heat leaves faster, swings sag up to ${fixedText(dip, 1)} °C low` : `fan on: heat leaves faster, dips ${fixedText(dip, 1)} °C until the I term catches up` : Math.abs(f.read - SET_C) < 1 ? 'holding 210 °C' : f.read > SET_C ? 'overshoot' : 'below target',
          relay ? RING : t >= PT.fanAt && q.fan > 0 ? B_FIELD : Math.abs(f.read - SET_C) < 1 ? POWER : HEAT,
        )
      },
      readouts: (p) => {
        const { q, run, over, hold, dip } = ptRun(p)
        const t = run.tune
        return [
          { label: 'Overshoot', value: celsiusText(Math.max(0, over), 1), tone: toneOf(over < 2, over < 5) },
          { label: 'Swing before the fan', value: celsiusText(hold.swing, 1), tone: toneOf(hold.swing < 1, hold.swing < 4) },
          { label: 'Fan dip', value: q.fan > 0 ? celsiusText(dip, 1) : 'fan off', tone: q.fan > 0 ? toneOf(dip < 3, dip < 8) : undefined },
          q.mode === 'm303' && t ? { label: 'M303 → Kp · Ki · Kd', value: `${fixedText(t.gains.kp, 1)} · ${fixedText(t.gains.ki, 2)} · ${fixedText(t.gains.kd, 0)}` } : { label: 'Settled at', value: celsiusText(hold.mean, 1) },
        ]
      },
    }
  },
}

// --- Heated bed: a slow plate; W/cm² vs size, edges cooler, insulation, bang-bang is fine, mains + SSR for big beds. ---

const HB = { seconds: 900, lapse: 45, lo: 20, hi: 120, at: [-9.4, -2.6, 0] as V3, tiles: 14 }
const bedW = (mm: number) => 5.5 + (mm - 120) * 0.025
const hbParams = (p: Params) => ({
  cfg: { sizeMm: n(p, 'size'), heater: pick(BED_HEATERS, p.heater, 'dc24') as BedHeater, insul: pick(BED_INSUL, p.insul, 'none') as BedInsul },
  ctrl: pick(BED_CTRLS, p.ctrl, 'bang') as BedCtrl,
  set: n(p, 'set'),
})
const hbKey = (p: Params) => `${p.size} ${p.heater} ${p.insul} ${p.ctrl} ${p.set}`
const hbRun = memoBy(hbKey, (p: Params) => {
  const q = hbParams(p)
  const r = bedRun(q.cfg, q.ctrl, q.set, HB.seconds)
  return { q, ...r, hold: holdStats(r.run, Math.max(500, (r.reach ?? 0) + 120)) }
})
const bedTint = (c: number, set: number, out = new THREE.Color()) => ironbow(0.1 + 0.85 * Math.min(1, Math.max(0, (c - 20) / (set - 15))) ** 3, out)

export const temperatureCoolingHeatedBed: Lesson = {
  id: 'temperature-cooling-heated-bed',
  title: 'Heated bed',
  tagline: 'A big slow plate: minutes to heat, cooler at the edges',
  formula: (p) => {
    const { q, watts, amps } = hbRun(p)
    const h = BED_HEATERS[q.cfg.heater]
    const a = (q.cfg.sizeMm - 24) / 10
    return `P = ${h.wPerCm2} W/cm² × (${fixedText(a, 1)} cm)² = ${Math.round(watts)} W · I = P / V = ${Math.round(watts)} / ${h.volts} = ${fixedText(amps, 1)} A · plate 3 mm aluminium + steel sheet ≈ ${Math.round(BED.jPerM2K / 100)} J/K per dm², typical`
  },
  legend: [
    { color: RING, label: 'Centre (thermistor)', shape: 'dot' },
    { color: HEAT, label: 'Edge of the plate', shape: 'dot' },
    { color: POWER, label: 'Heater on', shape: 'dot' },
  ],
  points: [
    'A bed is a flat heater (a PCB trace or a silicone pad) under an aluminium plate with a removable steel sheet on top. Its heat capacity is hundreds of joules per kelvin, against a few for the hotend, so it takes minutes to heat and drifts slowly. The heater is rated in watts per cm²: about 0.25 is sluggish, 0.4–0.5 is normal, 0.8 is fast.',
    'Power has to grow with area, and at 12 or 24 V the current grows with it: a 300 mm bed at 24 V draws over 15 A through the board\'s MOSFET and connectors. Big beds therefore run a mains silicone heater switched by a solid-state relay (SSR), with the board only driving the SSR\'s LED. Mains needs an earthed plate and a thermal fuse; see Printer electronics.',
    'The thermistor sits in the middle; the edges lose heat sideways and through the clips, and the heater stops short of them, so they run several °C cooler (corners more). That is where ABS corners lift first (Bed adhesion > warping). Cork or foil-backed foam underneath cuts the loss downwards: faster heating and a smaller gradient.',
    'Because the plate is slow, bang-bang control is fine: Marlin checks every 5 s and switches with ±2 °C hysteresis, and the print never notices a few degrees of ripple. PID (M303 E-1) holds tighter, but on a mains bed through a relay it switches far more often. Same heat-flow ideas as Waves > Heat transfer.',
  ],
  controls: [
    { kind: 'choice', key: 'heater', options: Object.entries(BED_HEATERS).map(([value, h]) => ({ value, label: h.name })), initial: 'dc24' },
    { kind: 'slider', key: 'size', label: 'Bed size', min: 120, max: 400, step: 20, initial: 220, format: (v) => `${v} × ${v} mm` },
    { kind: 'choice', key: 'insul', options: Object.entries(BED_INSUL).map(([value, h]) => ({ value, label: h.name })), initial: 'none' },
    { kind: 'choice', key: 'ctrl', options: opts(BED_CTRLS), initial: 'bang' },
    { kind: 'slider', key: 'set', label: 'Bed target', min: 50, max: 110, step: 5, initial: 60, format: (v) => `${v} °C` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const holder = add(scene, new THREE.Group(), HB.at)
    holder.rotation.set(0.55, -0.5, 0)
    const N = HB.tiles
    const tiles = Array.from({ length: N * N }, (_, i) => {
      const m = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 })
      const t = add(holder, new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1), m))
      return { t, m, u: (i % N) - (N - 1) / 2, v: Math.floor(i / N) - (N - 1) / 2 }
    })
    const padM = glowMat(HEAT, 0.2)
    const pad = add(holder, new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 1), padM))
    const insM = new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 0.9 })
    const ins = add(holder, new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1), insM))
    const probe = add(holder, new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), glowMat(RING, 0.8)))
    const supply = liveLabel(scene, [-16.5, -10.6, 0.3], { size: 0.3, align: 'left' })
    const sizeTag = liveLabel(scene, [-16.5, -11.5, 0.3], { size: 0.26, color: GREY, align: 'left' })
    const ts = tempScope(scene, 'centre and edge', HB.lo, HB.hi, HB.seconds)
    const tr = { c: ts.plot.s.trace(RING, { samples: 300, radius: 0.07 }), e: ts.plot.s.trace(HEAT, { samples: 300, radius: 0.05 }) }
    const lv = ts.plot.s.level(GREY)
    const L = PLOT.low
    const prof = titledScope(scene, L.y, L.h, 'across the bed now', LABEL, 0, PLOT.x, PLOT.w)
    prof.lo.set('centre')
    prof.hi.set('edge')
    const pTr = prof.s.trace(HEAT, { samples: BED.cells, radius: 0.07 })
    const pLv = prof.s.level(GREY)
    const clock = lapseClock(HB.seconds, HB.lapse, 120)
    const c = new THREE.Color()
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, run, reach, amps, hold } = hbRun(p)
        const t = clock(dt, hbKey(p))
        const f = heaterAt(run, t)
        const w = bedW(q.cfg.sizeMm)
        const cell = w / N
        tiles.forEach(({ t: m, m: mt, u, v }) => {
          m.scale.set(cell * 0.97, 1, cell * 0.97)
          m.position.set(u * cell, 0, v * cell)
          const r = Math.min(1, Math.hypot(u, v) / (N / 2)) * (BED.cells - 1)
          const i = Math.floor(r)
          const temp = f.x[i] + (f.x[Math.min(BED.cells - 1, i + 1)] - f.x[i]) * (r - i)
          bedTint(temp, q.set, c)
          mt.color.copy(c).multiplyScalar(0.6)
          mt.emissive.copy(c)
          mt.emissiveIntensity = 0.35
        })
        pad.scale.set(w * (1 - 24 / q.cfg.sizeMm), 1, w * (1 - 24 / q.cfg.sizeMm))
        pad.position.y = -0.32
        setGlow(padM, f.duty > 0.5 ? HEAT : '#5a2a20', 0.2 + 0.9 * f.duty)
        ins.visible = q.cfg.insul !== 'none'
        ins.scale.set(w, q.cfg.insul === 'foam' ? 1.6 : 1, w)
        ins.position.y = q.cfg.insul === 'foam' ? -0.85 : -0.67
        insM.color.set(q.cfg.insul === 'foam' ? '#c9ced6' : '#8a6a45')
        probe.position.set(0, -0.5, 0)
        const sdt = run.dt * run.keep
        traceRun(tr.c, run.frames, sdt, HB.seconds, t, (g) => ts.py(g.read), 300)
        traceRun(tr.e, run.frames, sdt, HB.seconds, t, (g) => ts.py(g.x[g.x.length - 1]), 300)
        lv.set(ts.py(q.set))
        ts.cursor(t / HB.seconds)
        ts.plot.right.set(`${celsiusText(f.read, 1)} · edge ${celsiusText(f.x[f.x.length - 1], 1)}`, RING)
        const ppy = plotY(Math.min(...f.x) - 2, Math.max(q.set, ...f.x) + 2, L.h)
        pTr.points(f.x.map((_, i) => i / (BED.cells - 1)), f.x.map((v) => ppy(v)))
        pLv.set(ppy(q.set))
        prof.right.set(`drop ${celsiusText(f.x[0] - f.x[f.x.length - 1], 1)}`, HEAT)
        const h = BED_HEATERS[q.cfg.heater]
        supply.set(q.cfg.heater === 'ac' ? `230 V mains through an SSR · ${fixedText(amps, 1)} A` : `${h.volts} V supply through the board MOSFET · ${fixedText(amps, 1)} A`, amps > 15 ? HIGH_V : amps > 10 ? HEAT : LABEL)
        sizeTag.set(`${q.cfg.sizeMm} mm plate, heater ${pct(f.duty)} · ${BED_INSUL[q.cfg.insul].name.toLowerCase()}`)
        head.status.set(`Heated bed · ${h.name}`)
        head.sub.set(`t = ${secs(t)} of ${secs(HB.seconds)}, ${HB.lapse}× fast · grey dashes: target ${celsiusText(q.set)}`, GREY)
        head.event.set(reach === null ? `never reaches ${celsiusText(q.set)}: not enough W/cm² for the losses` : t < reach ? `heating: ${celsiusText(f.read, 0)} of ${celsiusText(q.set)}` : `at target after ${secs(reach)}, ripple ${celsiusText(hold.swing, 1)}`, reach === null ? HIGH_V : t < reach ? HEAT : POWER)
      },
      readouts: (p) => {
        const { reach, edgeDrop, watts, amps, hold, q } = hbRun(p)
        return [
          { label: `Time to ${q.set} °C`, value: reach === null ? 'never' : secs(reach), tone: reach === null ? 'bad' : toneOf(reach < 180, reach < 420) },
          { label: 'Edge cooler by', value: celsiusText(edgeDrop, 1), tone: toneOf(edgeDrop < 3, edgeDrop < 8) },
          { label: 'Heater', value: `${Math.round(watts)} W · ${fixedText(amps, 1)} A`, tone: toneOf(amps < 10, amps < 15) },
          { label: 'Ripple at target', value: reach === null ? '—' : celsiusText(hold.swing, 1) },
        ]
      },
    }
  },
}

// --- Part cooling fan: a 20 mm tower; the layer below has to be under Tg when the next lands (minimum layer time). ---

const PC = { at: [-10, -10.4, 0] as V3, w: 5.4, slab: 0.52, show: 16, layers: 16 }
const pcParams = (p: Params) => ({ mat: pick(COOL_FILAMENTS, p.mat, 'pla') as CoolFilament, fan: n(p, 'fan') / 100, layer: n(p, 'layer') })
const pcKey = (p: Params) => `${p.mat} ${p.fan} ${p.layer}`
const pcRun = memoBy(pcKey, (p: Params) => {
  const q = pcParams(p)
  return { q, run: coolRun(q.mat, q.fan, q.layer, PC.layers), minS: minLayerS(q.mat, q.fan) }
})
const shrinkTone = (s: number) => toneOf(s < 40, s < 80)

export const temperatureCoolingPartCoolingFan: Lesson = {
  id: 'temperature-cooling-part-cooling-fan',
  title: 'Part cooling fan',
  tagline: 'Freeze each layer before the next one lands',
  formula: (p) => {
    const { q, run } = pcRun(p)
    return `next layer lands after ${q.layer} s: layer below at ${celsiusText(run.tArr)} vs Tg ${celsiusText(run.tg)} · air h ≈ 10 + 110 × fan = ${Math.round(10 + 110 * q.fan)} W/m²K · bead ${celsiusText(run.lay)}, air ${celsiusText(run.air)} · typical values`
  },
  legend: [
    { color: FILAMENT_COLOR, label: 'Top layer temperature', shape: 'dot' },
    { color: HIGH_V, label: 'Glass transition Tg', shape: 'dot' },
    { color: B_FIELD, label: 'Part fan', shape: 'dot' },
  ],
  points: [
    'Each new bead lands at about nozzle temperature on the layer below. That layer must have stiffened, below its glass transition temperature Tg (Filaments > Glass transition temp), or the new one squashes it: small parts and tower tops turn into droopy blobs, and overhangs and bridges sag because nothing below holds them.',
    'How fast a layer cools depends on how long the nozzle is away (the layer time) and how hard air blows on it. A big part has long layers and cools on its own; a 20 mm tower at speed comes back every few seconds into its own heat. Slicers therefore enforce a minimum layer time (often 5–10 s): they slow down, or park the nozzle aside, until the layer has had that long.',
    'The fan (M106, G-code > Temperatures and fans) multiplies the heat taken by the air several times over. PLA likes 100 % from layer 2 on: its Tg is only 60 °C and it hardly shrinks. Bridges and overhangs get full fan on every material, set separately in the slicer.',
    'ABS and ASA have a Tg near 105 °C and shrink more. Cool them hard and each layer freezes in a lot of shrink on a warm one below: the part warps, corners lift and layers split apart. They print with little or no fan, in an enclosure; PETG sits in between (30–50 %). The shrink figure here is a typical relative index, not a measurement.',
  ],
  controls: [
    { kind: 'choice', key: 'mat', options: opts(COOL_FILAMENTS), initial: 'pla' },
    { kind: 'slider', key: 'fan', label: 'Part fan', min: 0, max: 100, step: 5, initial: 0, format: (v) => `${v} % = M106 S${Math.round((v / 100) * 255)}` },
    { kind: 'slider', key: 'layer', label: 'Layer time', min: 2, max: 30, step: 1, initial: 6, format: (v) => `${v} s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const holder = add(scene, new THREE.Group(), PC.at)
    holder.rotation.set(0.35, -0.6, 0)
    const slabs = Array.from({ length: PC.show + 1 }, (_, i) => {
      const m = new THREE.MeshStandardMaterial({ roughness: 0.5 })
      const s = add(holder, new THREE.Mesh(new THREE.BoxGeometry(PC.w, PC.slab * 0.94, PC.w), m), [0, (i + 0.5) * PC.slab, 0])
      return { s, m }
    })
    const topY = (PC.show + 0.5) * PC.slab
    const nozzle = add(holder, new THREE.Group())
    add(nozzle, new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.8, 6), new THREE.MeshStandardMaterial({ color: '#d9b24a', metalness: 0.5, roughness: 0.35 })), [0, 0.9, 0]).rotation.x = Math.PI
    add(nozzle, new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 1.2), glowMat(HEAT, 0.3)), [0, 2.2, 0])
    const fan = boxFan(scene, [-3.6, PC.at[1] + topY + 1, 1], 2.6)
    fan.group.rotation.set(0, -0.9, 0.5)
    addLabel(scene, 'part fan', [-3.6, PC.at[1] + topY + 2.9, 0.3], B_FIELD, 0.28)
    const tags = textRows(scene, 2, -4.6, -10.4, 0.28, 0.6)
    const P = { y: -3.6, h: 9.2 }
    const ts = tempScope(scene, 'top layer, every layer', 20, 260, 1, P)
    const tr = ts.plot.s.trace(FILAMENT_COLOR, { samples: 1000, radius: 0.06 })
    const tgLv = ts.plot.s.level(HIGH_V, 0.3)
    const tgTag = liveLabel(scene, [PLOT.x + PLOT.w / 2 - 0.2, 0, 0.4], { size: 0.24, color: HIGH_V, align: 'right' })
    const clock = { key: '', t: 0 }
    const c = new THREE.Color()
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, run, minS } = pcRun(p)
        if (clock.key !== pcKey(p)) [clock.key, clock.t] = [pcKey(p), 0]
        const lapse = Math.max(2, q.layer / 1.5)
        clock.t += dt * lapse
        if (clock.t > run.total + 3 * lapse) clock.t = 0
        const t = Math.min(clock.t, run.total - 1e-6)
        const fr = run.tops[Math.min(run.tops.length - 1, Math.floor(t / run.dt))]
        const L = Math.floor(t / q.layer)
        const col = fr.col
        slabs.forEach(({ m }, i) => {
          const j = col.length - 1 - (PC.show - i)
          const v = j >= 0 ? col[j] : run.air
          tempColor(v, c)
          m.color.copy(c).multiplyScalar(0.7)
          m.emissive.copy(c)
          m.emissiveIntensity = v > run.tg ? 0.6 : 0.15
        })
        const u = (t % q.layer) / q.layer
        const a = u * Math.PI * 2
        const r = PC.w / 2 - 0.3
        const sq = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)))
        nozzle.position.set((Math.cos(a) / sq) * r, (PC.show + 1) * PC.slab + 0.05, (Math.sin(a) / sq) * r)
        fan.spin(dt, 30 * q.fan)
        const shown = run.tops.filter((g, i) => g.t <= t && i % Math.ceil(run.tops.length / 1000) === 0)
        tr.points(shown.map((g) => g.t / run.total), shown.map((g) => ts.py(g.c)))
        tgLv.set(ts.py(run.tg))
        tgTag.group.position.y = P.y + ts.py(run.tg) + 0.35
        tgTag.set(`Tg ${celsiusText(run.tg)}`, HIGH_V)
        ts.cursor(t / run.total)
        ts.plot.hi.set(secs(run.total))
        ts.plot.right.set(`top ${celsiusText(fr.c)}`, FILAMENT_COLOR)
        tags[0].set(`20 mm tower, 0.2 mm layers, layer ${L + 1} of ${PC.layers}`, LABEL)
        tags[1].set(`glowing = still above Tg (${celsiusText(run.tg)})`, GREY)
        head.status.set(`Part cooling fan · ${COOL_FILAMENTS[q.mat]} · fan ${pct(q.fan)}, ${q.layer} s per layer`)
        head.sub.set(`time-lapse ${fixedText(lapse, 0)}× · minimum layer time at this fan: ${Number.isFinite(minS) ? secs(minS) : 'over 60 s'}`, GREY)
        head.event.set(
          run.soft ? `layer below still at ${celsiusText(run.tArr)} when the next lands: soft, the top droops` : run.shrink >= 80 ? `cooled hard far under Tg: shrink freezes in, warping and split layers` : run.shrink >= 40 ? 'firm, but a lot of shrink is frozen in' : 'firm before the next layer: clean layers',
          run.soft || run.shrink >= 80 ? HIGH_V : run.shrink >= 40 ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const { run, minS } = pcRun(p)
        return [
          { label: 'Layer below when the next lands', value: celsiusText(run.tArr), tone: run.soft ? 'bad' : 'ok' },
          { label: 'Minimum layer time here', value: Number.isFinite(minS) ? secs(minS) : 'over 60 s', tone: toneOf(minS < 6, minS < 15) },
          { label: 'Frozen-in shrink (typical)', value: fixedText(run.shrink, 0), tone: shrinkTone(run.shrink) },
        ]
      },
    }
  },
}

// --- Thermal runaway protection: faults with and without Marlin's watch (rise check while heating, hysteresis/period at target). ---

const TR = { seconds: 400, faultAt: 150, lapse: 16, hi: 420 }
const TR_PROT = { on: 'Protection on (Marlin)', off: 'Protection disabled' }
const trParams = (p: Params) => ({ fault: pick(HOTEND_FAULTS, p.fault, 'loose') as HotendFault, prot: pick(TR_PROT, p.prot, 'on'), period: n(p, 'period') })
const trKey = (p: Params) => `${p.fault} ${p.prot} ${p.period}`
const tunedGains = once(() => hotendTune(SET_C)!.gains)
const trRun = memoBy(trKey, (p: Params) => {
  const q = trParams(p)
  const run: HeaterRun = hotendRun({ kind: 'pid', gains: tunedGains() }, SET_C, TR.seconds, { fault: q.fault, faultAt: TR.faultAt }, q.prot === 'on' ? { ...MARLIN_WATCH, period: q.period } : null)
  return { q, run }
})
const FAULT_NOTE: Record<HotendFault, string> = {
  none: 'normal print: reading and block agree',
  loose: 'thermistor out of the block: it reads the air, the heater runs flat out',
  heater: 'cartridge failing: full PWM no longer holds 210 °C',
  fan: 'fan on a bare block: heat leaves faster than 40 W can replace',
}

export const temperatureCoolingThermalRunawayProtection: Lesson = {
  id: 'temperature-cooling-thermal-runaway-protection',
  title: 'Thermal runaway protection',
  tagline: 'When the reading stops making sense, cut the heater',
  formula: (p) => {
    const { q, run } = trRun(p)
    return `at target: halt if the reading stays more than ${MARLIN_WATCH.hyst} °C below for ${q.period} s · heating: must rise ${MARLIN_WATCH.watchRise} °C every ${MARLIN_WATCH.watchS} s · MAXTEMP ${MARLIN_WATCH.maxC} °C · hottest block ${celsiusText(run.peak)} · model typical`
  },
  legend: [
    { color: HEAT, label: 'Block temperature (true)', shape: 'dot' },
    { color: RING, label: 'What the firmware reads', shape: 'dot' },
    { color: HIGH_V, label: `MAXTEMP ${MARLIN_WATCH.maxC} °C`, shape: 'dot' },
  ],
  points: [
    'The firmware only knows what the thermistor says. If it falls out of the block it reads the air, so the PID asks for more heat, forever: the block heats towards 400 °C, the PTFE liner and plastic smoke, and printers have caught fire this way. MAXTEMP does not help, because the reading is cold. Thermistor curves are in Sensors > Thermistor curve.',
    'Thermal runaway protection checks that the reading behaves like a heater. While heating, the temperature must rise by 2 °C every 20 s (WATCH_TEMP_PERIOD / _INCREASE) or "Heating failed". Once at the target, it may not stay more than 4 °C below for 40 s (THERMAL_PROTECTION_PERIOD / _HYSTERESIS). Either way the firmware turns every heater off and halts until reset.',
    'A failing cartridge or a broken wire looks the same from the firmware: full PWM, no heat. So does a part fan blowing on a bare block, a false alarm with a real cause, cured by a silicone sock or a better duct, not by a longer period. A shorted or open thermistor reads absurdly hot or cold and trips MAXTEMP / MINTEMP at once.',
    'Never print with the protection disabled; some early firmware shipped that way. A longer period makes false trips rarer but lets a loose thermistor cook the block for longer first. Hardware back-ups: a thermal fuse on mains beds and a PSU that the firmware can switch off. PID tuning that holds the target tightly keeps the hysteresis check from tripping.',
  ],
  controls: [
    { kind: 'choice', key: 'fault', options: opts(HOTEND_FAULTS), initial: 'loose' },
    { kind: 'choice', key: 'prot', options: opts(TR_PROT), initial: 'on' },
    { kind: 'slider', key: 'period', label: 'Protection period', min: 10, max: 120, step: 5, initial: 40, format: (v) => `${v} s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const rig = hotendRig(scene)
    const home = rig.he.thermistor.position.clone()
    const lcd = textRows(scene, 3, -6.6, -9.8, 0.3, 0.62)
    flatBox(scene, [9.6, 2.4, 0.05], new THREE.MeshStandardMaterial({ color: '#16213a', roughness: 0.8 }), [-2, -10.4, 0])
    const P = { y: -3.6, h: 9.2 }
    const ts = tempScope(scene, 'true vs read', 0, TR.hi, TR.seconds, P)
    const tr = { block: ts.plot.s.trace(HEAT, { samples: 300, radius: 0.07 }), read: ts.plot.s.trace(RING, { samples: 300, radius: 0.06 }) }
    ts.plot.s.level(GREY).set(ts.py(SET_C))
    ts.plot.s.level(HIGH_V, 0.3).set(ts.py(MARLIN_WATCH.maxC))
    const faultBar = cursorBar(ts.plot.s, B_FIELD, 0.08)
    const haltBar = cursorBar(ts.plot.s, HIGH_V, 0.1)
    const clock = lapseClock(TR.seconds, TR.lapse, 40)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, run } = trRun(p)
        const t = clock(dt, trKey(p))
        const f = heaterAt(run, t)
        const on = t >= TR.faultAt && q.fault !== 'none'
        rig.show(f.actual, q.fault === 'heater' && on ? GCODE_HEAT.ambient + (f.x[0] - GCODE_HEAT.ambient) * 0.5 : f.x[0], q.fault === 'fan' && on ? 1 : 0, dt)
        const out = q.fault === 'loose' ? Math.min(1, Math.max(0, (t - TR.faultAt) / 4)) : 0
        rig.he.thermistor.position.set(home.x + out * 2.6, home.y - out * 1.1, home.z + out * 0.6)
        rig.he.thermistor.rotation.x = out * 1.2
        const sdt = run.dt * run.keep
        traceRun(tr.block, run.frames, sdt, TR.seconds, t, (g) => ts.py(g.actual), 300)
        traceRun(tr.read, run.frames, sdt, TR.seconds, t, (g) => ts.py(g.read), 300)
        ts.cursor(t / TR.seconds)
        faultBar(q.fault !== 'none' ? TR.faultAt / TR.seconds : null)
        haltBar(run.halt && t >= run.halt.t ? run.halt.t / TR.seconds : null)
        ts.plot.right.set(`block ${celsiusText(f.actual)} · reads ${celsiusText(f.read)}`, f.actual > MARLIN_WATCH.maxC ? HIGH_V : LABEL)
        const halted = run.halt && t >= run.halt.t
        lcd[0].set(`T:${Math.round(f.read)} /${halted ? 0 : SET_C}  heater ${pct(f.duty)}`, '#9fd0ff')
        lcd[1].set(halted ? `Err: ${run.halt!.why}` : q.prot === 'off' ? 'protection: disabled' : `watch: ${q.period} s below ${SET_C - MARLIN_WATCH.hyst} °C halts`, halted ? HIGH_V : '#9fd0ff')
        lcd[2].set(halted ? 'PRINTER HALTED - reset required' : 'printing', halted ? HIGH_V : GREY)
        head.status.set(`Thermal runaway protection · ${HOTEND_FAULTS[q.fault]}`)
        head.sub.set(`t = ${secs(t)} of ${secs(TR.seconds)}, ${TR.lapse}× fast · blue bar: fault at ${TR.faultAt} s`, GREY)
        head.event.set(
          halted ? `${run.halt!.why}: heaters off ${fixedText(run.halt!.t - TR.faultAt, 0)} s after the fault` : on ? FAULT_NOTE[q.fault] : 'printing at 210 °C',
          halted ? POWER : on && f.actual > 260 ? HIGH_V : on ? HEAT : LABEL,
        )
      },
      readouts: (p) => {
        const { q, run } = trRun(p)
        const end = run.frames[run.frames.length - 1]
        return [
          { label: 'Hottest block', value: celsiusText(run.peak), tone: toneOf(run.peak < 230, run.peak < 280) },
          { label: 'Halted', value: run.halt ? `${run.halt.why} at ${secs(run.halt.t)}` : 'no', tone: q.fault === 'none' ? (run.halt ? 'bad' : 'ok') : run.halt ? 'ok' : 'bad' },
          { label: 'Block at the end', value: celsiusText(end.actual), tone: q.fault !== 'none' && !run.halt && end.actual < GCODE_HEAT.coldMin ? 'warn' : undefined },
        ]
      },
    }
  },
}
