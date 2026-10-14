import * as THREE from 'three/webgpu'
import {
  DRAM,
  FLASH,
  MODERN_NMOS,
  SRAM,
  SRAM_VDD,
  SramCell,
  channelOverdrive,
  chargeShare,
  dramLeak,
  dramRetention,
  dramTau,
  electrons,
  flashRead,
  flashStep,
  flashVth,
  floatingGateV,
  nmosPass,
  senseBit,
  sramBit,
  sramStep,
} from '../../core/physics'
import { si, tiny, volts } from '../../core/units'
import { V3, add, box, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  ELECTRON,
  GREY,
  LABEL,
  LED_RED,
  RING,
  chargeTank,
  clamp01,
  ease,
  gateMetal,
  gateSymbol,
  glowMat,
  halton,
  groundSymbol,
  icPackage,
  junction,
  ledLamp,
  litWire,
  mosfetDie,
  oxideGlass,
  partLetter,
  potentialColor,
  pulseLabel,
  scope,
  storyClock,
  storySlider,
  ticks,
  wire,
} from '../fx'
import { Lesson, Stage, n } from '../types'


// --- SRAM latch: two inverters feed each other; access switches on the word line connect them to the bit lines. ---

const V = SRAM_VDD
const IDLE_S = 0.8
const PULSE_S = 2.4
const PERIOD_S = 5
const PULSE_PS = 40
const SRAM_SLOW = PULSE_S / (PULSE_PS * 1e-12)
const XN = 5.6
const XA = 10.8
const XBL = 16
const YI = 3.2
const YWL = 7.4
const YBL = 8.4

type SramOp = 'hold' | 'write0' | 'write1' | 'read'
const OP_LABEL: Record<SramOp, string> = { hold: 'Hold', write0: 'Write 0', write1: 'Write 1', read: 'Read' }
const startCell = (held: number): SramCell => ({ q: held ? V : 0, qb: held ? 0 : V, bl: V, blb: V })
const sramDrive = (op: SramOp): [number, number] | undefined => (op === 'write0' ? [0, V] : op === 'write1' ? [V, 0] : undefined)

/** Result of one full access from the held bit: the bit afterwards and the bit-line split. */
const sramResult = (held: number, op: SramOp) => {
  if (op === 'hold') return { cell: startCell(held), bit: held }
  const cell = sramStep(startCell(held), { wl: V, drive: sramDrive(op) }, PULSE_PS * 1e-12)
  return { cell, bit: sramBit(cell) }
}

export const sramLatch: Lesson = {
  id: 'memory-cell-sram-latch',
  title: 'SRAM latch',
  tagline: 'Two inverters holding each other up',
  formula: (p) => {
    const op = p.op as SramOp
    const held = n(p, 'held')
    const r = sramResult(held, op)
    if (op === 'read') return `Read: bit lines precharged to ${volts(V)}; the 0 side pulls its line down → ΔV = ${volts(Math.abs(r.cell.bl - r.cell.blb))} → reads ${held}`
    if (op === 'hold') return `Q = NOT(Q̄), Q̄ = NOT(Q): each inverter drives the other's input, so Q = ${held} holds itself as long as power is on`
    return `Write: BL = ${op === 'write1' ? 1 : 0}, BL̄ = ${op === 'write1' ? 0 : 1}; access switch (k ×2) beats the pull-up (k ×1) → Q ${held} → ${r.bit}`
  },
  legend: [
    { color: RING, label: 'Word line opens both access switches', shape: 'dot' },
    { color: ELECTRON, label: 'Access NMOS channel: bit line ↔ cell', shape: 'arrow-right' },
    { color: '#ff4d4d', label: 'Nodes and lines: red = 1, blue = 0', shape: 'dot' },
    { color: LABEL, label: 'Big digits: Q (left) and Q̄ (right)', shape: 'dot' },
  ],
  points: [
    'SRAM (static RAM) stores a bit in a loop of two inverters: Q feeds the bottom inverter, whose output Q̄ feeds the top one back to Q. A 1 holds a 0 holds a 1.',
    'Each inverter is two transistors, plus two NMOS access switches to the bit lines BL and BL̄: six transistors (6T) per bit. The word line turns the switches on for a whole row.',
    'Write: the driver forces BL and BL̄ to opposite levels and opens the word line. The access switch is sized stronger than the pull-up PMOS, so it drags Q past the switching point and the loop flips.',
    'Read: both bit lines are precharged high and left floating; the side holding 0 pulls its line down. The pull-down is stronger than the access switch, so Q only bumps up a little and the bit survives.',
    'No refresh is needed, and it is fast (well under a nanosecond), which is why CPU caches and registers are SRAM. But six transistors make it big, and the bit is gone the moment power is off. Slowed 6 × 10¹⁰×.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'held',
      options: [0, 1].map((v) => ({ value: String(v), label: `Holds ${v}` })),
      initial: '1',
    },
    { kind: 'choice', key: 'op', options: (Object.keys(OP_LABEL) as SramOp[]).map((o) => ({ value: o, label: OP_LABEL[o] })), initial: 'write0' },
  ],
  build(): Stage {
    const scene = createStage({ span: 32 })
    const h = 2.2
    const top = gateSymbol(scene, [0, YI, 0], 'NOT')
    top.group.rotation.z = Math.PI
    const flip = ([x, y, z]: V3): V3 => [-x, 2 * YI - y, z]
    const tIn = flip(top.pins.a)
    const tOut = flip(top.pins.out)
    const bot = gateSymbol(scene, [0, -YI, 0], 'NOT')
    const qNet: V3[] = [tOut, [-XN, YI, 0], [-XN, -YI, 0], bot.pins.a]
    const qbNet: V3[] = [bot.pins.out, [XN, -YI, 0], [XN, YI, 0], tIn]
    const access = [-1, 1].map((s) => {
      const die = mosfetDie(scene, [s * XA, -0.6, 0], { kind: 'n', width: 7.4, depth: 2.6, flip: s > 0 })
      const node: V3 = [s * XN, 0, 0]
      const stub: V3[] = [die.pins.drain, node]
      const line: V3[] = [die.pins.source, [s * XBL, 0, 0]]
      const bitline: V3[] = [[s * XBL, YBL, 0], [s * XBL, -YBL, 0]]
      const gate: V3[] = [die.pins.gate, [s * XA, YWL, 0]]
      for (const pts of [stub, line, bitline, gate]) wire(scene, pts)
      return {
        die,
        lit: { node: litWire(scene, stub), line: litWire(scene, line), bit: litWire(scene, bitline), gate: litWire(scene, gate) },
        ball: junction(scene, node, 0.5),
        end: junction(scene, [s * XBL, YBL, 0], 0.6),
        volts: pulseLabel(scene, 3, GREY, [s * XBL, -YBL - 1.4, 0], 0.9),
        digit: pulseLabel(scene, 1, LABEL, [s * (h + 1.2), 0, 0], 2.2),
      }
    })
    junction(scene, [-XBL, 0, 0], 0.4).set(0.5)
    junction(scene, [XBL, 0, 0], 0.4).set(0.5)
    for (const pts of [qNet, qbNet]) wire(scene, pts)
    const wl: V3[] = [[-XA - 2.6, YWL, 0], [XA + 2.6, YWL, 0]]
    wire(scene, wl)
    const lit = { q: litWire(scene, qNet), qb: litWire(scene, qbNet), wl: litWire(scene, wl) }

    const s = { key: '', t: 0, wl: 0, cell: startCell(1), ps: 0 }
    const c = new THREE.Color()
    return {
      scene,
      view: { center: [0, 1.9, 0], radius: 64, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const op = p.op as SramOp
        const held = n(p, 'held')
        const key = `${held}|${op}`
        if (key !== s.key || s.t >= PERIOD_S) Object.assign(s, { key, t: 0, wl: 0, cell: startCell(held), ps: 0 })
        s.t += dt
        const on = op !== 'hold' && s.t > IDLE_S && s.t < IDLE_S + PULSE_S
        s.wl += ((on ? V : 0) - s.wl) * ease(dt, 12)
        if (on) s.ps = Math.min(PULSE_PS, s.ps + (dt / SRAM_SLOW) * 1e12)
        const step = Math.min(dt, 0.05) / SRAM_SLOW
        s.cell = sramStep(s.cell, { wl: s.wl, drive: on ? sramDrive(op) : undefined }, step)
        if (!on && s.t > IDLE_S + PULSE_S) {
          s.cell.bl += (V - s.cell.bl) * ease(dt, 3)
          s.cell.blb += (V - s.cell.blb) * ease(dt, 3)
        }
        const { q, qb, bl, blb } = s.cell
        top.inputs(qb / V, 0)
        top.set(q / V)
        bot.inputs(q / V, 0)
        bot.set(qb / V)
        lit.q.set(1, potentialColor(q / V, c))
        lit.qb.set(1, potentialColor(qb / V, c))
        lit.wl.set(s.wl / V, c.set(RING))
        access.forEach((a, i) => {
          const node = i ? qb : q
          const line = i ? blb : bl
          const vgs = s.wl - Math.min(node, line)
          const amps = Math.abs(nmosPass(s.wl, line, node, SRAM.access))
          a.die.step(dt, {
            gate: clamp01(s.wl / V),
            deplete: 0.8 * Math.sqrt(clamp01(s.wl / SRAM.access.vthV)),
            channel: (u) => channelOverdrive(u, vgs, Math.abs(line - node), SRAM.access) / (V - SRAM.access.vthV),
            flow: 2 + 14 * clamp01(amps / 3e-4),
          })
          a.die.paintGate(s.wl / V)
          a.lit.gate.set(s.wl / V, c.set(RING))
          a.lit.node.set(1, potentialColor(node / V, c))
          a.lit.line.set(1, potentialColor(line / V, c))
          a.lit.bit.set(1, potentialColor(line / V, c))
          a.ball.set(node / V)
          a.end.set(line / V)
          a.volts.show(line.toFixed(2))
          a.volts.frame(dt)
          a.digit.show(String(Math.round(node / V)))
          a.digit.frame(dt)
        })
      },
      readouts: (p) => {
        const op = p.op as SramOp
        const r = sramResult(n(p, 'held'), op)
        return [
          { label: 'Q', value: `${sramBit(s.cell)} (${volts(tiny(s.cell.q, 1e-3))})` },
          { label: 'After', value: op === 'hold' ? 'Unchanged' : `${OP_LABEL[op]} → ${r.bit}` },
          { label: 'Word line on', value: `${Math.round(s.ps)} ps` },
          { label: 'BL − BL̄', value: volts(s.cell.bl - s.cell.blb) },
        ]
      },
    }
  },
}

// --- DRAM capacitor: one switch and one capacitor; the charge leaks, refresh reads it and writes it back. ---

const DRAM_SLOW = 40
const WINDOW_S = 0.2
const REFRESH_ANIM = [0.5, 0.5, 0.5]
const XD = -6
const XBD = -13
const XC = 1.6
const YC = -1.4
const TANK_H = 5
const SW = 11
const SH = 7.2
const SX = 12.6

const dramCase = (celsius: number, refreshMs: number) => {
  const tau = dramTau(celsius)
  const retention = dramRetention(tau)
  return { tau, retention, ok: refreshMs > 0 && retention > refreshMs / 1000 }
}

export const dramCapacitor: Lesson = {
  id: 'memory-cell-dram-capacitor',
  title: 'DRAM capacitor',
  tagline: 'A bucket of charge that leaks, so it gets refilled',
  formula: (p) => {
    const T = n(p, 'temp')
    const { tau, retention } = dramCase(T, n(p, 'refresh'))
    const share = chargeShare(DRAM.vdd)
    return `V(t) = Vdd·e^(−t/τ), τ = ${si(tau, 's', 2)} at ${T} °C · read: ΔV = (Vcell − Vdd/2)·Cc/(Cc + Cbl) = ±${volts(share.signal)} · readable for ${si(retention, 's', 2)}`
  },
  legend: [
    { color: '#ff4d4d', label: 'Stored charge: full = 1', shape: 'dot' },
    { color: RING, label: 'Word line opens the switch to read or refresh', shape: 'dot' },
    { color: ELECTRON, label: 'Scope: cell voltage, last 200 ms', shape: 'arrow-left' },
    { color: GREY, label: 'Dashed: lowest charge still readable', shape: 'dot' },
  ],
  points: [
    'DRAM (dynamic RAM) stores a bit as charge on a tiny capacitor, about 20 fF, behind one access transistor: 1T1C. Two parts per bit instead of six, which is why your gigabytes of main memory are DRAM.',
    'The capacitor leaks through the off transistor and the silicon, a little faster every 10 °C (here twice as fast). A stored 1 slowly drains toward 0.',
    'Reading opens the word line, and the cell shares its charge with a bit line about 4× bigger, precharged to Vdd/2. The line moves by only ~0.1 V, and the cell is left half empty: the read is destructive.',
    'So the sense amplifier blows that small swing up to a full 0 or 1 and writes it straight back. Refresh is just that, done to every row every 64 ms (32 ms above 85 °C).',
    'Wait too long, or run too hot, and the swing falls below what the sense amp can tell apart: the bit is lost, and refresh dutifully rewrites the wrong value. Slowed 40×.',
  ],
  controls: [
    { kind: 'slider', key: 'temp', label: 'Temperature', min: 25, max: 105, initial: 85, step: 5, format: (v) => `${v} °C` },
    {
      kind: 'choice',
      key: 'refresh',
      options: [
        { value: '0', label: 'No refresh' },
        { value: '64', label: 'Every 64 ms' },
        { value: '32', label: 'Every 32 ms' },
      ],
      initial: '64',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 34 })
    const die = mosfetDie(scene, [XD, 0, 0], { kind: 'n', width: 9, depth: 3 })
    const tank = chargeTank(TANK_H, 1.5, { color: '#ff4d4d' })
    add(scene, tank.group, [XC, YC, 0])
    const capTop = YC + TANK_H / 2 + 0.6
    const capNet: V3[] = [die.pins.drain, [die.pins.drain[0], 2.8, 0], [XC, 2.8, 0], [XC, capTop, 0]]
    const lineNet: V3[] = [die.pins.source, [XBD, die.pins.source[1], 0]]
    const bitline: V3[] = [[XBD, 5.6, 0], [XBD, -6.2, 0]]
    const wl: V3[] = [die.pins.gate, [XD, 5.4, 0], [XD - 3.6, 5.4, 0]]
    const gndY = YC - TANK_H / 2 - 1.8
    for (const pts of [capNet, lineNet, bitline, wl, [[XC, YC - TANK_H / 2, 0], [XC, gndY, 0]] as V3[]]) wire(scene, pts)
    add(scene, groundSymbol(), [XC, gndY, 0])
    junction(scene, [XBD, die.pins.source[1], 0], 0.4).set(0.5)
    const wlEnd = junction(scene, [XD - 3.6, 5.4, 0], 0.55)
    const lit = { cap: litWire(scene, capNet), line: litWire(scene, lineNet), bit: litWire(scene, bitline), wl: litWire(scene, wl) }
    const sa = icPackage(3.4, 2.4, 2)
    add(scene, sa, [XBD, -7.4, 0])
    partLetter(scene, 'SA', [XBD, -7.4, 0.65], 0.9)
    const cellV = pulseLabel(scene, 3, GREY, [XC + 3.4, YC + 1.2, 0], 0.9)
    const bitDigit = pulseLabel(scene, 1, LABEL, [XC + 3.4, YC - 1.4, 0], 1.6)
    const lineV = pulseLabel(scene, 3, GREY, [XBD - 2.6, 3.4, 0], 0.9)

    const drops = Array.from({ length: 5 }, (_, i) => ({ y: i / 5, m: add(scene, mesh(new THREE.SphereGeometry(0.22, 10, 8), glowMat('#ff4d4d', 1)), [XC, 0, 0]) }))
    const plot = scope(scene, SW, SH, { divs: [10, 6], zeroAt: 0 })
    plot.group.position.set(SX, 0.6, 0)
    ticks(plot, [], [[0, '0'], [1, '1.1']])
    const trace = plot.trace(ELECTRON)
    const vMin = DRAM.vdd / 2 + (DRAM.senseV * (DRAM.cellF + DRAM.bitlineF)) / DRAM.cellF
    plot.level(GREY).set((vMin / DRAM.vdd) * SH - SH / 2)

    const hist: { t: number; v: number }[] = []
    const s = { key: '', t: 0, v: DRAM.vdd, next: 0, bit: 1 as 0 | 1 | null, anim: -1, share: DRAM.vdd / 2, line: DRAM.vdd / 2, wl: 0, lostAt: -1 }
    const reset = (key: string, refresh: number) => {
      Object.assign(s, { key, t: 0, v: DRAM.vdd, next: refresh / 1000, bit: 1, anim: -1, line: DRAM.vdd / 2, wl: 0, lostAt: -1 })
      hist.length = 0
      hist.push({ t: 0, v: DRAM.vdd })
    }
    const at = (t: number) => {
      if (t <= hist[0].t) return hist[0].v
      let lo = 0
      let hi = hist.length - 1
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2)
        if (hist[mid].t <= t) lo = mid
        else hi = mid
      }
      return hist[lo].v
    }
    const c = new THREE.Color()
    return {
      scene,
      view: { center: [2.6, 2, 0], radius: 67, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const T = n(p, 'temp')
        const refresh = n(p, 'refresh')
        const key = `${T}|${refresh}`
        if (key !== s.key) reset(key, refresh)
        const tau = dramTau(T)
        const vpre = DRAM.vdd / 2
        let wlOn = false
        if (s.anim >= 0) {
          wlOn = true
          s.anim += dt
          const stage = s.anim < REFRESH_ANIM[0] ? 0 : s.anim < REFRESH_ANIM[0] + REFRESH_ANIM[1] ? 1 : 2
          if (stage === 0) {
            s.line += (s.share - s.line) * ease(dt, 10)
            s.v += (s.share - s.v) * ease(dt, 10)
          } else {
            const target = s.bit === 1 ? DRAM.vdd : 0
            s.line += (target - s.line) * ease(dt, 8)
            if (stage === 2) s.v += (target - s.v) * ease(dt, 10)
          }
          if (s.anim > REFRESH_ANIM.reduce((a, b) => a + b)) {
            s.anim = -1
            s.v = s.bit === 1 ? DRAM.vdd : 0
            s.line = vpre
          }
        } else {
          const step = dt / DRAM_SLOW
          s.t += step
          s.v = dramLeak(s.v, step, tau)
          if (s.bit === 1 && senseBit(s.v) !== 1 && s.lostAt < 0) s.lostAt = s.t
          if (refresh && s.t >= s.next) {
            s.next += refresh / 1000
            s.share = chargeShare(s.v).v
            s.bit = senseBit(s.v) ?? 0
            s.anim = 0
          }
          s.line += (vpre - s.line) * ease(dt, 6)
          if (s.lostAt >= 0 && s.t - s.lostAt > 0.15) reset(key, refresh)
        }
        hist.push({ t: s.t, v: s.v })
        while (hist.length > 2 && hist[1].t < s.t - WINDOW_S) hist.shift()
        s.wl += ((wlOn ? 1 : 0) - s.wl) * ease(dt, 14)

        const f = s.v / DRAM.vdd
        tank.set(f)
        cellV.show(s.v.toFixed(2))
        cellV.frame(dt)
        bitDigit.show(String(s.anim >= 0 ? s.bit : (senseBit(s.v) ?? '-')))
        bitDigit.frame(dt)
        lineV.show(s.line.toFixed(2))
        lineV.frame(dt)
        const vgs = s.wl * (DRAM.vdd + MODERN_NMOS.vthV + 0.4)
        die.step(dt, {
          gate: s.wl,
          deplete: 0.8 * s.wl,
          channel: (u) => channelOverdrive(u, vgs, Math.abs(s.v - s.line), MODERN_NMOS) / DRAM.vdd,
          flow: 2 + 12 * s.wl * clamp01(Math.abs(s.v - s.line) * 8),
        })
        die.paintGate(s.wl)
        wlEnd.set(s.wl)
        lit.wl.set(s.wl, c.set(RING))
        lit.cap.set(1, potentialColor(f, c))
        lit.line.set(1, potentialColor(s.line / DRAM.vdd, c))
        lit.bit.set(1, potentialColor(s.line / DRAM.vdd, c))
        const leak = clamp01((s.v / tau / (DRAM.vdd / dramTau(105))) * 4)
        drops.forEach((d, i) => {
          d.y = (d.y + dt * (0.4 + leak)) % 1
          d.m.visible = s.anim < 0 && f > 0.05 && i < Math.ceil(leak * drops.length + 0.5)
          d.m.position.set(XC + 0.6 * Math.sin(i * 2.4), YC - TANK_H / 2 - 0.3 - d.y * 1.2, 0.8)
        })
        trace.scroll((t) => (at(t) / DRAM.vdd) * SH - SH / 2, s.t, WINDOW_S)
      },
      readouts: (p) => {
        const refresh = n(p, 'refresh')
        const { retention, ok } = dramCase(n(p, 'temp'), refresh)
        return [
          { label: 'Cell', value: volts(s.v) },
          { label: 'Time', value: `${Math.round(s.t * 1000)} ms` },
          { label: 'Readable for', value: si(retention, 's', 2), tone: refresh && !ok ? 'warn' : undefined },
          { label: 'Bit', value: s.lostAt < 0 ? '1 kept' : 'Lost', tone: s.lostAt < 0 ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- Flash floating gate: electrons tunnel onto an insulated gate, raise the threshold and stay there with power off. ---

const PULSE = 10e-6
const STEPS = ['Program pulse', 'Power off 10 years', 'Read', 'Erase pulse', 'Read']
const STEP_S = [3.2, 3, 2.6, 3.2, 2.6]
const TEN_YEARS = 10 * 3.156e7
const FW = 18
const FD = 4
const YF = -0.6
const IPD = 0.5
const CG_H = 1.4
const DOTS = 40
const TUNNEL = 14
const PER_DOT = 40

type Bias = { vcg: number; vch: number; verify?: number }
const flashPlan = (vpgm: number) => {
  const qP = flashStep(0, { vcg: vpgm, vch: 0 }, PULSE)
  const qE = flashStep(qP, { vcg: 0, vch: vpgm, verify: FLASH.vth0 }, PULSE)
  const bias: Bias[] = [{ vcg: vpgm, vch: 0 }, { vcg: 0, vch: 0 }, { vcg: FLASH.vread, vch: 0 }, { vcg: 0, vch: vpgm, verify: FLASH.vth0 }, { vcg: FLASH.vread, vch: 0 }]
  return { qE, qP, start: [qE, qP, qP, qP, qE], bias }
}
const fmtTime = (k: number, t: number) => (k === 1 ? `${(t / 3.156e7).toFixed(1)} y` : k === 0 || k === 3 ? `${(t * 1e6).toFixed(1)} µs` : '-')

export const flashFloatingGate: Lesson = {
  id: 'memory-cell-flash-floating-gate',
  title: 'Flash floating gate',
  tagline: 'Electrons locked in glass keep the bit with power off',
  formula: (p) => {
    const f = flashPlan(n(p, 'vpgm'))
    const dv = flashVth(f.qP) - flashVth(f.qE)
    return `ΔVth = N·e / Ccg = ${Math.round(electrons(f.qP) - electrons(f.qE))} e⁻ × 1.6 × 10⁻¹⁹ C / ${si(FLASH.ccg, 'F', 2)} = ${volts(dv)} · read at ${volts(FLASH.vread)}: erased (Vth ${volts(flashVth(f.qE))}) → 1, programmed (${volts(flashVth(f.qP))}) → ${flashRead(f.qP)}`
  },
  legend: [
    { color: ELECTRON, label: 'Electrons tunnel to the floating gate (FG)', shape: 'arrow-right' },
    { color: '#ff4d4d', label: 'Control gate (CG), substrate: red = high V', shape: 'dot' },
    { color: LED_RED, label: 'LED lit: cell conducts at read = 1', shape: 'dot' },
  ],
  points: [
    'A Flash cell is a MOSFET with an extra gate: a floating gate of polysilicon sealed in oxide between the channel and the control gate. Nothing is wired to it, so charge put there has no way out.',
    'Program: ~18 V on the control gate couples the floating gate to ~11 V. Across 8 nm of oxide that is over 10⁹ V/m, enough for electrons to tunnel through the glass (Fowler–Nordheim). The current falls as the gate fills: it limits itself.',
    'Stored electrons cancel part of the control gate\'s pull, so the transistor needs a higher gate voltage to turn on: Vth rises by N·e / Ccg. A few hundred electrons move it by volts.',
    'Read: put a voltage between the two thresholds on the control gate. An erased cell conducts (1), a programmed one stays off (0). Erase reverses the field (high voltage on the substrate) and pulls the electrons out, checking Vth until it is back to 0 V (erase verify).',
    'With power off the field is tiny and tunnelling stops almost completely: data lasts 10 years or more. Each program/erase damages the oxide a little, so cells wear out after ~10³–10⁵ cycles. Try a lower program voltage.',
  ],
  controls: [
    { kind: 'slider', key: 'vpgm', label: 'Program voltage', min: 14, max: 20, initial: 18, step: 0.5, format: (v) => `${v} V` },
    storySlider(STEPS),
  ],
  build(): Stage {
    const scene = createStage({ span: 30 })
    const die = mosfetDie(scene, [0, YF, 0], { kind: 'n', width: FW, depth: FD, gateLetter: '' })
    const L = die.length
    const fgTop = die.pins.gate[1]
    const fgBot = YF + 0.4
    box(scene, [L + 0.8, IPD, 4], oxideGlass(), [0, fgTop + IPD / 2, 0]).castShadow = false
    const cgY = fgTop + IPD + CG_H / 2
    const cgMat = gateMetal()
    box(scene, [L, CG_H, 4], cgMat, [0, cgY, 0])
    partLetter(scene, 'CG', [-L / 2 + 1, cgY, 2.15], 0.8)
    partLetter(scene, 'FG', [-L / 2 + 1, (fgTop + fgBot) / 2, 2.15], 0.8)
    const cgTop: V3 = [0, cgY + CG_H / 2, 0]
    const cgPin: V3 = [0, cgTop[1] + 2.4, 0]
    wire(scene, [cgTop, cgPin])
    const cgBall = junction(scene, cgPin, 0.6)
    const cgVolts = pulseLabel(scene, 4, GREY, [2.8, cgPin[1], 0], 0.9)
    const subY = YF - FD - 2.6
    const subPin: V3 = [0, subY, 0]
    wire(scene, [[0, YF - FD, 0], subPin])
    const subBall = junction(scene, subPin, 0.6)
    const subVolts = pulseLabel(scene, 4, GREY, [2.8, subY, 0], 0.9)
    const gx = die.pins.source[0]
    const gy = YF - FD - 1.2
    wire(scene, [die.pins.source, [gx, die.pins.source[1] + 1.6, 0], [-FW / 2 - 1.4, die.pins.source[1] + 1.6, 0], [-FW / 2 - 1.4, gy, 0]])
    add(scene, groundSymbol(), [-FW / 2 - 1.4, gy, 0])
    const dx = die.pins.drain[0]
    const ledAt: V3 = [dx + 2.6, die.pins.drain[1] + 1.6, 0]
    wire(scene, [die.pins.drain, [dx, ledAt[1], 0], [ledAt[0] - 0.6, ledAt[1], 0]])
    const lamp = ledLamp(scene, LED_RED, ledAt, { scale: 1, anodeRight: true })
    const rail: V3[] = [[ledAt[0] + 0.6, ledAt[1], 0], [ledAt[0] + 2, ledAt[1], 0], [ledAt[0] + 2, gy, 0]]
    wire(scene, rail)
    const railBall = junction(scene, rail[2], 0.55)
    const bitDigit = pulseLabel(scene, 1, LABEL, [ledAt[0] + 4, ledAt[1], 0], 1.6)

    const eMat = glowMat(ELECTRON, 1.3)
    const stored = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 12, 8), eMat, DOTS)
    const tunnel = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 10, 8), eMat, TUNNEL)
    for (const o of [stored, tunnel]) {
      o.frustumCulled = false
      o.castShadow = false
      scene.add(o)
    }
    const m = new THREE.Matrix4()
    for (let i = 0; i < DOTS; i++)
      stored.setMatrixAt(i, m.makeTranslation(-L / 2 + 2.2 + halton(i + 1, 2) * (L - 2.7), fgBot + (0.2 + 0.6 * halton(i + 1, 3)) * (fgTop - fgBot), 2.3))
    const riders = Array.from({ length: TUNNEL }, (_, i) => ({ x: (((i * 0.618) % 1) - 0.5) * (L - 1), y: (i / TUNNEL) * 1 }))

    const clockS = storyClock(STEP_S)
    const s = { key: '', k: -1, q: 0, t: 0, plan: flashPlan(18), cg: 0, sub: 0, glow: 0 }
    const c = new THREE.Color()
    return {
      scene,
      view: { center: [1.2, 2.2, 0], radius: 55, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const vpgm = n(p, 'vpgm')
        if (String(vpgm) !== s.key) Object.assign(s, { key: String(vpgm), plan: flashPlan(vpgm), k: -1 })
        clockS.frame(dt, n(p, 'step'))
        const k = clockS.step
        if (k !== s.k) Object.assign(s, { k, q: s.plan.start[k], t: 0 })
        const bias = s.plan.bias[k]
        const pulse = k === 0 || k === 3
        const u = clamp01(clockS.t * 1.25)
        const tNext = pulse ? u * PULSE : k === 1 ? TEN_YEARS * u * u : 0
        const q0 = s.q
        if (tNext > s.t) s.q = flashStep(s.q, bias, tNext - s.t)
        s.t = tNext
        const live = pulse && clockS.t < 0.8
        const vcg = live || k === 2 || k === 4 ? bias.vcg : 0
        const vch = live ? bias.vch : 0
        s.cg += (vcg - s.cg) * ease(dt, 10)
        s.sub += (vch - s.sub) * ease(dt, 10)

        const vfg = floatingGateV(s.q, s.cg, s.sub)
        const vth = flashVth(s.q)
        const reading = (k === 2 || k === 4) && clockS.t > 0.15
        const on = reading ? clamp01((FLASH.vread - vth) * 2) : 0
        s.glow += (on - s.glow) * ease(dt, 8)
        const inversion = clamp01((vfg - s.sub - MODERN_NMOS.vthV) / 4)
        die.step(dt, {
          gate: clamp01(Math.max(0, vfg - s.sub) / 8),
          deplete: 0.9 * Math.sqrt(clamp01(Math.max(0, vfg - s.sub) / 2)),
          channel: (x) =>
            reading ? channelOverdrive(x, FLASH.vread - vth + MODERN_NMOS.vthV, 0.3, MODERN_NMOS) / 1.2 : inversion,
          flow: reading ? 2 + 10 * s.glow : 0.3,
        })
        die.paintGate(clamp01(0.5 + vfg / 8))
        potentialColor(clamp01(s.cg / 20), c)
        cgMat.color.copy(c)
        cgMat.emissive.copy(c).multiplyScalar(0.35)
        cgBall.set(clamp01(s.cg / 20))
        subBall.set(clamp01(s.sub / 20))
        cgVolts.show(`${s.cg.toFixed(1)}`)
        subVolts.show(`${s.sub.toFixed(1)}`)
        for (const l of [cgVolts, subVolts]) l.frame(dt)
        stored.count = Math.min(DOTS, Math.round(Math.max(0, electrons(s.q)) / PER_DOT))
        const rate = Math.abs(electrons(s.q) - electrons(q0)) / Math.max(dt, 1e-3)
        const shown = live ? Math.min(TUNNEL, Math.ceil(Math.log10(1 + rate) * 3)) : 0
        const up = bias.vch === 0
        riders.forEach((r, i) => {
          r.y = (r.y + dt * 1.6) % 1
          const y = up ? YF - 0.3 + r.y * (fgBot - YF + 0.5) : fgBot + 0.2 - r.y * (fgBot - YF + 0.5)
          tunnel.setMatrixAt(i, m.makeTranslation(r.x, y, 2.5))
        })
        tunnel.count = shown
        tunnel.instanceMatrix.needsUpdate = true
        lamp.set(s.glow)
        lamp.step(dt)
        railBall.set(reading ? 1 : 0)
        bitDigit.show(reading ? String(flashRead(s.q)) : ' ')
        bitDigit.frame(dt)
      },
      readouts: () => {
        const k = Math.max(0, s.k)
        return [
          { label: 'Vth', value: volts(tiny(flashVth(s.q), 0.01)) },
          { label: 'Electrons', value: String(Math.max(0, Math.round(electrons(s.q)))) },
          k === 2 || k === 4 ? { label: 'Read at', value: volts(FLASH.vread) } : { label: k === 1 ? 'Off for' : STEPS[k].split(' ')[0], value: fmtTime(k, s.t) },
          { label: 'Reads', value: String(flashRead(s.q)), tone: flashRead(s.q) ? 'ok' : undefined },
        ]
      },
    }
  },
}
