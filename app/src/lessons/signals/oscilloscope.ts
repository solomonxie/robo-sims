import * as THREE from 'three/webgpu'
import {
  Edge,
  PROBE_X1,
  PROBE_X10,
  acCouple,
  displayedVolts,
  edgeStats,
  findTrigger,
  leadInductance,
  measureWave,
  meanOf,
  oneTwoFive,
  probeResponse,
  ringHz,
  ringQ,
  toDivs,
  uartDecode,
  uartLevel,
} from '../../core/physics'
import { hasGlyph } from '../../core/strokeFont'
import { pct, si } from '../../core/units'
import { STEEL, V3, add, box, mat, mesh, rod, tube } from '../../models/kit'
import { buildEsp32 } from '../../models/modules'
import { createStage } from '../../scene/stage'
import { GREY, HEAT, HIGH_V, LABEL, POWER, RING, benchScope, cableRun, frac, glowMat, label, lieFlat, liveLabel, memoBy, probe } from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const TAU = 2 * Math.PI
const CH1 = RING
const DIVS: [number, number] = [10, 8]
const sec = (s: number) => si(s, 's', 3)
const volts = (v: number) => si(v, 'V', 3)
const text = (parent: THREE.Object3D, s: string, at: V3, color = GREY, size = 0.6, align: 'left' | 'center' | 'right' = 'center') =>
  add(parent, label(s, { size, color, align }), at)

type Bench = ReturnType<typeof benchScope>

/** `count` CH1 traces drawn as phosphor: the newest bright, older sweeps fading. `push(y)` adds a sweep. */
function phosphor(bench: Bench, count: number, samples = 260) {
  const base = new THREE.Color(CH1)
  const traces = Array.from({ length: count }, () => bench.screen.trace(CH1, { samples, radius: 0.07 }))
  const age = traces.map(() => Infinity)
  const paint = () =>
    traces.forEach((t, i) => {
      const f = age[i] === Infinity ? 0 : 0.62 ** age[i]
      t.group.visible = f > 0.02
      t.material.color.copy(base).multiplyScalar(0.25 + 0.75 * f)
      t.material.emissiveIntensity = 0.9 * f
    })
  return {
    push(y: (u: number) => number) {
      const i = age.indexOf(Math.max(...age))
      for (let k = 0; k < count; k++) age[k] += 1
      age[i] = 0
      traces[i].draw(y, null)
      traces[i].group.position.z = 0.02
      traces.forEach((t, k) => k !== i && (t.group.position.z = 0))
      paint()
    },
    clear() {
      age.fill(Infinity)
      paint()
    },
  }
}

/** An ESP32 lying face-up at `at` with a probe hooked on a pin; returns the probe cable's free end. */
function esp32Probe(scene: THREE.Object3D, at: V3, k = 0.5) {
  add(scene, lieFlat(buildEsp32(), k), at)
  const pin = (x: number, row: 1 | -1): V3 => [at[0] + x * k, at[1] - row * 5 * k, at[2] + 3.8 * k]
  const tip = pin(-1, 1)
  const gnd = pin(-7, 1)
  const end = probe(scene, tip, [0.15, -0.7, 0.7], '#2a2c32')
  cableRun(scene, [gnd, [gnd[0], gnd[1] - 1.6, gnd[2] + 0.4], [tip[0] - 0.4, tip[1] - 2.2, tip[2] + 1.4]], '#1c1c1f', 0.1)
  return { end, tip }
}

/** Probe cable from `from` sagging down and over to the scope's BNC at `to`. */
const probeCable = (scene: THREE.Object3D, from: V3, to: V3) => {
  const low = Math.min(from[1], to[1]) - 3
  cableRun(scene, [from, [from[0] + 0.6, low, from[2] + 1], [to[0] - 2, low, to[2] + 2.5], [to[0], to[1] - 0.4, to[2] + 1.2], to], '#2a2c32', 0.2)
}

// --- Triggering: free-run sweeps land anywhere and smear; an edge trigger starts every sweep at the same point. ---

const F_DAC = 1000
const dacAt = (t: number) => 1.65 + 1.1 * Math.sin(TAU * F_DAC * t) + 0.45 * Math.sin(2 * TAU * F_DAC * t + 0.9)
type Trig = 'free' | Edge
const TRIGS: Record<Trig, string> = { free: 'Free run', rise: 'Rising edge', fall: 'Falling edge' }
const trigOf = (p: Params): Trig => (String(p.trig) in TRIGS ? (p.trig as Trig) : 'free')
const tdivOf = (p: Params) => oneTwoFive(n(p, 'tdiv'), 50e-6)
const vdivOf = (p: Params) => oneTwoFive(n(p, 'vdiv'), 0.2)
const GROUND = -3
const SWEEP_S = 0.2
const SW = 260

/** One sweep starting at a random moment: free run shows it as is; a trigger slides it so the crossing sits mid-screen. */
function sweep(trig: Trig, level: number, window: number, start: number) {
  const dt = window / (SW - 1)
  const len = Math.ceil((window * 1.5 + 1.2 / F_DAC) / dt)
  const buf = Array.from({ length: len }, (_, i) => dacAt(start + i * dt))
  const at = trig === 'free' ? null : findTrigger(buf, level, trig, (SW - 1) / 2, 0.02)
  const t0 = at === null ? start : start + (at - (SW - 1) / 2) * dt
  return { t0, locked: at !== null }
}

const MEASURED = measureWave(
  Array.from({ length: 2000 }, (_, i) => dacAt(i * 2e-6)),
  2e-6,
)

export const triggering: Lesson = {
  id: 'oscilloscope-triggering',
  title: 'Triggering',
  tagline: 'Start every sweep at the same point and the picture stands still',
  formula: (p) => {
    const trig = trigOf(p)
    const w = 10 * tdivOf(p)
    return trig === 'free'
      ? `Free run: each ${sec(w)} sweep starts whenever the last one ended, so every pass lands at a new phase`
      : `Trigger: first ${trig === 'rise' ? 'rising' : 'falling'} crossing of ${volts(n(p, 'level'))} → screen centre; window = 10 div × ${sec(tdivOf(p))} = ${sec(w)}`
  },
  legend: [
    { color: CH1, label: 'CH1: newest sweep, older ones fading', shape: 'dot' },
    { color: HEAT, label: 'Trigger level', shape: 'dot' },
    { color: POWER, label: 'TRIG’D lamp: sweep locked', shape: 'dot' },
  ],
  points: [
    'A scope draws voltage (up) against time (across). VOLTS/DIV sets how many volts each grid square is worth, TIME/DIV how much time: 10 squares across is the whole window.',
    'Here an ESP32 DAC pin plays a 1 kHz wave. Free running, each sweep starts whenever the last finished, at a random point in the wave, so the sweeps pile up as a smear.',
    'A trigger waits for the signal to cross a level in one direction, then starts the sweep there. Every sweep then shows the same slice of the wave and the picture stands still.',
    'Set the level outside the wave and nothing ever crosses it: on AUTO the scope gives up and free-runs again. Pick a level the wave crosses once per cycle.',
    'Rising vs falling picks which side of the wave sits at the centre mark. Turn TIME/DIV to zoom in on one edge or out to see many cycles.',
    `Slowed down: ${1 / SWEEP_S} sweeps a second here; a real scope draws thousands.`,
  ],
  controls: [
    { kind: 'choice', key: 'trig', options: Object.entries(TRIGS).map(([value, l]) => ({ value, label: l })), initial: 'free' },
    { kind: 'slider', key: 'level', label: 'Trigger level', min: -0.5, max: 4, initial: 1.6, step: 0.05, format: (v) => volts(v) },
    { kind: 'slider', key: 'tdiv', label: 'Time / div', min: 0, max: 5, initial: 2, step: 1, format: (i) => sec(oneTwoFive(i, 50e-6)) },
    { kind: 'slider', key: 'vdiv', label: 'Volts / div', min: 0, max: 3, initial: 1, step: 1, format: (i) => volts(oneTwoFive(i, 0.2)) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const SX = 4
    const SY = 1
    const W = 15
    const H = 12
    const div = H / DIVS[1]
    const bench = benchScope(scene, W, H, { divs: DIVS })
    bench.group.position.set(SX, SY, 0)
    const glow = phosphor(bench, 8, SW)
    const level = bench.screen.level(HEAT)
    const tMark = text(bench.group, 'T', [0.35, H / 2 - 0.45, 0.3], HEAT, 0.5, 'left')
    text(bench.group, '1>', [-W / 2 - 0.25, GROUND * div, 0.3], CH1, 0.5, 'right')
    const { end } = esp32Probe(scene, [-13.5, -1.2, 0])
    probeCable(scene, end, [SX + bench.ch1[0], SY + bench.ch1[1], bench.ch1[2]])
    text(scene, 'ESP32 DAC, 1 KHZ', [-13.5, 3.4, 0], LABEL, 0.6)

    const st = { clock: 0, wait: 0, key: '' }
    return {
      scene,
      view: { center: [0.6, 0.4, 0], radius: 80, polar: 1.42, azimuth: 0.06 },
      frame(dt, p) {
        const trig = trigOf(p)
        const tdiv = tdivOf(p)
        const vdiv = vdivOf(p)
        const lv = n(p, 'level')
        const key = `${trig}|${lv}|${tdiv}|${vdiv}`
        if (key !== st.key) {
          st.key = key
          st.wait = 0
          glow.clear()
        }
        bench.knobs.volts.set(n(p, 'vdiv') * 0.7 - 1)
        bench.knobs.time.set(n(p, 'tdiv') * 0.5 - 1.25)
        bench.knobs.level.set((lv - 1.75) * 1.1)
        st.clock += dt
        st.wait -= dt
        const window = 10 * tdiv
        if (st.wait <= 0) {
          st.wait = SWEEP_S
          const s = sweep(trig, lv, window, st.clock * 1.37 + Math.random() / F_DAC)
          glow.push((u) => toDivs(dacAt(s.t0 + u * window), vdiv, GROUND) * div)
          bench.lamp(POWER, s.locked)
          const mode = trig === 'free' ? ['FREE RUN', GREY] : s.locked ? [`${trig === 'rise' ? 'RISE' : 'FALL'} ${lv.toFixed(2)}V`, POWER] : ['AUTO', HEAT]
          bench.status[2].set(mode[0], mode[1])
        }
        level.set(trig === 'free' ? 1e3 : toDivs(lv, vdiv, GROUND) * div)
        tMark.visible = trig !== 'free'
        bench.status[0].set(`CH1 ${volts(vdiv).replace(' ', '')}`, CH1)
        bench.status[1].set(sec(tdiv).replace(' ', ''), LABEL)
      },
      readouts: (p) => {
        const trig = trigOf(p)
        const lv = n(p, 'level')
        const inRange = lv > MEASURED.mean - MEASURED.vpp / 2 && lv < MEASURED.mean + MEASURED.vpp / 2
        const w = 10 * tdivOf(p)
        return [
          trig === 'free'
            ? { label: 'Trigger', value: 'off · smears', tone: 'warn' }
            : inRange
              ? { label: 'Trigger', value: 'locked', tone: 'ok' }
              : { label: 'Trigger', value: 'misses · free-runs', tone: 'bad' },
          { label: 'Window', value: `${sec(w)} · ${+(w * F_DAC).toPrecision(2)} cycles` },
          { label: 'Measured', value: `${si(MEASURED.hz, 'Hz', 3)} · ${MEASURED.vpp.toFixed(2)} Vpp` },
          { label: 'Slowed', value: `${1 / SWEEP_S} sweeps/s` },
        ]
      },
    }
  },
}

// --- Probing: ×1 vs ×10, the ground lead's loop, AC vs DC coupling, on a 1 MHz PWM from an ESP32 pin. ---

const F_PWM = 1e6
const DUTY = 0.3
const VCC = 3.3
const R_SRC = 25
const P_TDIV = 100e-9
const P_GROUND = -2
const P_N = 400
const P_DT = (10 * P_TDIV) / P_N
const PRE = 1.5 * P_TDIV
const pwmAt = (t: number) => (frac(t * F_PWM) < DUTY ? VCC : 0)
type Ground = 'spring' | 'clip' | 'none'
const GROUNDS: Record<Ground, { label: string; mm: number }> = {
  spring: { label: 'Spring tip', mm: 10 },
  clip: { label: 'Long clip', mm: 150 },
  none: { label: 'No ground', mm: 150 },
}
const PROBES = { x1: PROBE_X1, x10: PROBE_X10 }
const pick = <R extends object>(rec: R, v: unknown, d: keyof R & string) => (String(v) in rec ? (v as keyof R & string) : d)
const probeParams = (p: Params) => ({
  probe: pick(PROBES, p.probe, 'x10'),
  menu: pick(PROBES, p.menu, 'x10'),
  ground: pick(GROUNDS, p.ground, 'spring'),
  ac: p.coupling === 'ac',
})

const solveProbe = memoBy(
  (p: Params) => JSON.stringify(probeParams(p)),
  (p: Params) => {
    const s = probeParams(p)
    const pr = PROBES[s.probe]
    const menu = PROBES[s.menu].ratio
    const henries = leadInductance(GROUNDS[s.ground].mm)
    const ring = ringHz(henries, pr.farads)
    const q = ringQ(henries, pr.farads, R_SRC)
    const settle = Math.round(1e-6 / P_DT)
    const input = Array.from({ length: settle + 3 * P_N }, (_, i) => pwmAt((i - settle) * P_DT - PRE))
    const raw = probeResponse(input, P_DT, { ringHz: ring, q, bwHz: pr.bwHz })
      .slice(settle)
      .map((v) => displayedVolts(v, pr.ratio, menu))
    const period = raw.slice(0, P_N)
    const shown = s.ac ? acCouple(period) : period
    const offset = s.ac ? meanOf(period) : 0
    const m = measureWave(raw, P_DT)
    const scale = menu / pr.ratio
    const edge = edgeStats(period.slice(0, P_N / 2), P_DT, 0, VCC * scale)
    return { ...s, pr, menu, scale, henries, ring, q, shown, vpp: m.vpp, mean: m.mean - offset, edge, ok: scale === 1 }
  },
)

/** Deterministic per-sample fuzz for the floating-ground hum. */
const fuzz = (i: number, seed: number) => frac(Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453) - 0.5

export const probing: Lesson = {
  id: 'oscilloscope-probing',
  title: 'Probing',
  tagline: 'The probe is part of the circuit: set its ratio, keep its ground short',
  formula: (p) => {
    const s = solveProbe(p)
    return `shown = pin ÷ probe × setting = ${VCC} ÷ ${s.pr.ratio} × ${s.menu} = ${+(VCC * s.scale).toPrecision(3)} V · ${GROUNDS[s.ground].mm} mm lead ≈ ${si(s.henries, 'H', 2)} with ${si(s.pr.farads, 'F', 2)} rings at ${si(s.ring, 'Hz', 3)}`
  },
  legend: [
    { color: CH1, label: 'CH1: the 1 MHz PWM as the scope sees it', shape: 'dot' },
    { color: HEAT, label: 'Ground lead: its loop is an inductor', shape: 'dot' },
    { color: LABEL, label: 'Probe ratio and scope setting', shape: 'dot' },
  ],
  points: [
    'The ESP32 drives a 3.3 V, 1 MHz PWM (LEDC, 30 % duty). The screen shows one period, 100 ns per square, 1 V per square.',
    'A ×10 probe divides by ten (10 MΩ inside the tip) so it barely loads the circuit: 12 pF instead of ~110 pF, and edges stay sharp. A ×1 probe’s slow 6 MHz bandwidth rounds them off.',
    'Tell the scope which probe is on: a ×10 probe read as ×1 shows 0.33 V, a ×1 read as ×10 shows 33 V. Many probes have a slide switch, so check both ends.',
    'The ground clip closes a loop. A 15 cm lead is ~150 nH, it rings with the tip capacitance near 100 MHz: the spikes on every edge aren’t in the circuit. A spring tip on the nearest GND kills them.',
    'Leave ground off and the probe picks up mains hum and the scope shows junk that jumps every sweep.',
    'DC coupling shows true volts from ground. AC puts a capacitor in series: the average (here 30 % × 3.3 V ≈ 1 V) is blocked and the wave centres on zero, handy for small ripple on a big DC level.',
  ],
  controls: [
    { kind: 'choice', key: 'probe', options: [{ value: 'x1', label: 'Probe ×1' }, { value: 'x10', label: 'Probe ×10' }], initial: 'x10' },
    { kind: 'choice', key: 'menu', options: [{ value: 'x1', label: 'Scope set ×1' }, { value: 'x10', label: 'Scope set ×10' }], initial: 'x10' },
    { kind: 'choice', key: 'ground', options: Object.entries(GROUNDS).map(([value, g]) => ({ value, label: g.label })), initial: 'clip' },
    { kind: 'choice', key: 'coupling', options: [{ value: 'dc', label: 'DC' }, { value: 'ac', label: 'AC' }], initial: 'dc' },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const SX = 7
    const SY = 1.4
    const W = 13
    const H = 10.4
    const div = H / DIVS[1]
    const bench = benchScope(scene, W, H, { divs: DIVS })
    bench.group.position.set(SX, SY, 0)
    const glow = phosphor(bench, 6, P_N)
    text(bench.group, '1>', [-W / 2 - 0.25, P_GROUND * div, 0.3], CH1, 0.5, 'right')
    bench.status[1].set('100NS', LABEL)

    const K = 0.72
    const B: V3 = [-13, -0.4, 0]
    add(scene, lieFlat(buildEsp32(), K), B)
    const pin = (x: number): V3 => [B[0] + x * K, B[1] + 5 * K, B[2] + 3.8 * K]
    const tip = pin(-1)
    const d = new THREE.Vector3(0.3, 1, 0.3).normalize()
    const along = (k: number): V3 => [tip[0] + d.x * k, tip[1] + d.y * k, tip[2] + d.z * k]
    const body = mat('#34373e', { rough: 0.5 })
    rod(scene, tip, along(0.9), 0.06, STEEL())
    rod(scene, along(0.9), along(1.3), 0.3, STEEL(), 16)
    rod(scene, along(1.3), along(5.6), 0.42, body, 20)
    rod(scene, along(1.9), along(2.2), 0.62, body, 20)
    rod(scene, along(3.3), along(4.1), 0.47, mat('#d8d8d8', { rough: 0.5 }), 16)
    const top = along(5.6)
    const ch1: V3 = [SX + bench.ch1[0], SY + bench.ch1[1], bench.ch1[2]]
    cableRun(scene, [top, [top[0] + 1.2, top[1] + 1, top[2] + 0.6], [top[0] + 4, top[1] - 1, 2], [SX - W / 2 - 2.5, ch1[1] - 1.8, 2.4], [ch1[0] - 1, ch1[1] - 1.6, 2.2], ch1], '#2a2c32', 0.2)
    const tag = liveLabel(scene, [along(3.7)[0] + 1, along(3.7)[1], along(3.7)[2]], { size: 0.6, align: 'left' })
    text(scene, 'GPIO', [tip[0] + 0.5, tip[1] - 1, tip[2]], GREY, 0.4)

    const ring = along(1.1)
    const leadMat = glowMat(HEAT, 0.45)
    const clip = (g: THREE.Group, at: V3) => {
      box(g, [0.5, 0.9, 0.35], mat('#1c1c1f', { rough: 0.6 }), [at[0], at[1] - 0.75, at[2]])
      box(g, [0.3, 0.5, 0.25], STEEL(), [at[0], at[1] - 0.1, at[2]])
    }
    const leads: Record<Ground, THREE.Group> = { spring: new THREE.Group(), clip: new THREE.Group(), none: new THREE.Group() }
    for (const g of Object.values(leads)) scene.add(g)
    const gNear = pin(-2)
    const coil = Array.from({ length: 60 }, (_, i): V3 => {
      const u = i / 59
      const a = u * TAU * 7
      return [ring[0] + (gNear[0] - ring[0]) * u + 0.16 * Math.cos(a), ring[1] + (gNear[1] - ring[1]) * u, ring[2] + (gNear[2] - ring[2]) * u + 0.16 * Math.sin(a)]
    })
    tube(leads.spring, coil, 0.04, STEEL(), 240)
    tube(leads.spring, [ring, gNear], 0.02, leadMat, 4)
    const gFar = pin(-7)
    const loop: V3[] = [ring, [ring[0] - 1, ring[1] + 2.4, ring[2] + 1.2], [ring[0] - 3, ring[1] + 3.6, ring[2] + 1.4], [gFar[0] - 1, gFar[1] + 3, gFar[2] + 1.2], [gFar[0], gFar[1] + 1.6, gFar[2] + 0.6]]
    tube(leads.clip, loop, 0.1, leadMat)
    clip(leads.clip, [gFar[0], gFar[1] + 1.2, gFar[2] + 0.6])
    const dangle: V3[] = [ring, [ring[0] - 1.4, ring[1] + 0.6, ring[2] + 1.4], [ring[0] - 2.2, ring[1] - 3, ring[2] + 1.8]]
    tube(leads.none, dangle, 0.1, mat('#1c1c1f', { rough: 0.6 }))
    clip(leads.none, [ring[0] - 2.2, ring[1] - 2.6, ring[2] + 1.8])
    text(scene, 'GND', [gFar[0] + 0.4, gFar[1] - 1, gFar[2]], GREY, 0.4)
    text(scene, 'ESP32 PWM, 1 MHZ', [B[0], B[1] - 5.4, 0], LABEL, 0.6)

    const st = { wait: 0, key: '', seed: 0 }
    return {
      scene,
      view: { center: [-0.8, 0.6, 0], radius: 78, polar: 1.42, azimuth: 0.06 },
      frame(dt, p) {
        const s = solveProbe(p)
        const key = JSON.stringify(probeParams(p))
        if (key !== st.key) {
          st.key = key
          st.wait = 0
          glow.clear()
          for (const [g, o] of Object.entries(leads)) o.visible = g === s.ground
          tag.set(s.probe === 'x10' ? '×10' : '×1', LABEL)
          bench.status[0].set(`CH1 ${s.ac ? 'AC' : 'DC'} ×${s.menu}`, CH1)
          bench.status[2].set(s.ground === 'none' ? 'AUTO' : s.ok ? 'RISE 1.00V' : 'CHECK PROBE', s.ok && s.ground !== 'none' ? POWER : HEAT)
          bench.knobs.volts.set(0)
          bench.knobs.time.set(-0.8)
        }
        st.wait -= dt
        if (st.wait > 0) return
        st.wait = SWEEP_S
        const seed = (st.seed += 1)
        const hum = s.ground === 'none' ? 2.6 * Math.sin(seed * 2.399) : 0
        const junk = s.ground === 'none' ? 0.9 : 0
        glow.push((u) => {
          const i = Math.round(u * (P_N - 1))
          return toDivs(s.shown[i] + hum + junk * fuzz(i, seed), 1, P_GROUND) * div
        })
        bench.lamp(POWER, s.ground !== 'none')
      },
      readouts: (p) => {
        const s = solveProbe(p)
        const rise = s.edge.rise
        return [
          { label: 'Pin really', value: `${VCC} V · ${si(F_PWM, 'Hz', 2)} · ${pct(DUTY)}` },
          s.ground === 'none'
            ? { label: 'Scope reads', value: 'hum, jumping', tone: 'bad' }
            : { label: 'Scope reads', value: `${s.vpp.toFixed(2)} Vpp · avg ${s.mean.toFixed(2)} V`, tone: !s.ok ? 'bad' : s.edge.overshoot > 0.15 ? 'warn' : 'ok' },
          {
            label: 'Edge',
            value: `${Number.isFinite(rise) ? sec(rise) : '—'} rise · ${pct(s.edge.overshoot)} ring`,
            tone: s.edge.overshoot > 0.15 || rise > 30e-9 ? 'warn' : 'ok',
          },
          { label: 'Probe load', value: `${si(s.pr.ohms, 'Ω', 2)} ‖ ${si(s.pr.farads, 'F', 2)}` },
        ]
      },
    }
  },
}

// --- Decoding a bus: trigger on the UART start bit, sample each bit centre, read the byte. The decoder must match the baud. ---

const TX_BAUD = 115200
const D_TDIV = 10e-6
const D_WIN = 10 * D_TDIV
const D_PRE = 0.5 * D_TDIV
const D_GROUND = -2
const SEND_S = 1.8
const REVEAL_S = 1.1
const BAUDS = [9600, 57600, 115200, 230400]
const charOf = (b: number) => (b > 32 && b < 127 ? `'${String.fromCharCode(b)}'` : '--')
/** Bytes the stroke font can't draw show as --. */
const glyphOf = (b: number) => (hasGlyph(String.fromCharCode(b)) ? charOf(b) : '--')
const hex = (b: number) => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`

const solveBus = (p: Params) => {
  const byte = Math.round(n(p, 'byte'))
  const baud = BAUDS.includes(Number(p.baud)) ? Number(p.baud) : TX_BAUD
  const line = (t: number) => uartLevel(byte, TX_BAUD, t)
  const dec = uartDecode(line, baud)
  return { byte, baud, line, dec, ok: dec.byte === byte && dec.framingOk }
}

export const decodingBus: Lesson = {
  id: 'oscilloscope-decoding-a-bus',
  title: 'Decoding a bus',
  tagline: 'Trigger on the start bit, read each bit at its centre',
  formula: (p) => {
    const s = solveBus(p)
    return `bit = 1 / baud = 1 / ${TX_BAUD} = ${sec(1 / TX_BAUD)} · 8N1: start 0, 8 data bits LSB first, stop 1 → ${hex(s.byte)} = ${s.byte.toString(2).padStart(8, '0')}`
  },
  legend: [
    { color: CH1, label: 'CH1: the ESP32 TX line', shape: 'dot' },
    { color: POWER, label: 'Decoder: samples at each bit centre', shape: 'dot' },
    { color: HEAT, label: 'Bit cells at the decoder’s baud', shape: 'dot' },
  ],
  points: [
    'Serial.print() on an ESP32 sends UART: the TX line idles high, drops for a start bit, then sends 8 data bits, least significant first, and a stop bit back high.',
    'Trigger on the falling edge of the start bit and every byte lands at the same place on screen, like any repeating signal.',
    'At 115200 baud each bit lasts 8.68 µs. A decoder (in the scope, a logic analyzer, or the receiving chip) samples the line in the middle of each bit and rebuilds the byte.',
    'Set the decoder to the wrong baud and it samples at the wrong moments: the bits come out shuffled or all ones, and the stop bit may read 0, a framing error. Garbage in a serial monitor is usually this.',
    'Most scopes decode UART, I²C and SPI on screen; with no decoder, count bits by eye with the 10 µs grid.',
    `Slowed ${+(REVEAL_S / D_WIN).toPrecision(2)}×: the 100 µs sweep is drawn over ${REVEAL_S} s.`,
  ],
  controls: [
    { kind: 'slider', key: 'byte', label: 'Byte sent', min: 33, max: 126, initial: 72, step: 1, format: (v) => `${charOf(Math.round(v))} ${hex(Math.round(v))}` },
    { kind: 'choice', key: 'baud', options: BAUDS.map((b) => ({ value: String(b), label: `Decode ${b / 1000}k` })), initial: String(TX_BAUD) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const SX = 4
    const SY = 1
    const W = 15
    const H = 12
    const div = H / DIVS[1]
    const bench = benchScope(scene, W, H, { divs: DIVS })
    bench.group.position.set(SX, SY, 0)
    const screen = bench.screen
    const trace = screen.trace(CH1, { samples: 400, radius: 0.08 })
    text(bench.group, '1>', [-W / 2 - 0.25, D_GROUND * div, 0.3], CH1, 0.5, 'right')
    text(bench.group, 'T', [screen.xAt(D_PRE / D_WIN) + 0.35, H / 2 - 0.45, 0.3], HEAT, 0.5, 'left')
    bench.status[0].set('CH1 1V', CH1)
    bench.status[1].set('10µS', LABEL)
    bench.status[2].set('FALL 1.65V', POWER)
    bench.lamp(POWER, true)
    bench.knobs.time.set(0.4)
    bench.knobs.volts.set(0)
    const { end } = esp32Probe(scene, [-13.5, -1.2, 0])
    probeCable(scene, end, [SX + bench.ch1[0], SY + bench.ch1[1], bench.ch1[2]])
    const sent = liveLabel(scene, [-13.5, 3.4, 0], { size: 0.6 })

    const yOf = (v: number) => toDivs(v, 1, D_GROUND) * div
    const hiY = yOf(VCC)
    const band = hiY + 0.8 - (yOf(0) - 0.8)
    const edgeGeo = new THREE.BoxGeometry(0.05, band, 0.05)
    const edgeMat = glowMat(HEAT, 0.25)
    const edges = Array.from({ length: 11 }, () => add(screen.group, mesh(edgeGeo, edgeMat)))
    const dotMat = glowMat(POWER, 1.2)
    const dots = Array.from({ length: 10 }, () => add(screen.group, mesh(new THREE.SphereGeometry(0.22, 12, 8), dotMat)))
    const bits = Array.from({ length: 10 }, () => liveLabel(screen.group, [0, hiY + 1.1, 0.3], { size: 0.5 }))
    const decoded = liveLabel(screen.group, [0, -H / 2 + 0.9, 0.3], { size: 0.8 })
    for (const o of [...edges, ...dots]) o.castShadow = false

    const tOf = (u: number) => u * D_WIN - D_PRE
    const uOf = (t: number) => (t + D_PRE) / D_WIN
    const st = { clock: SEND_S, key: '', prev: null as null | ((t: number) => number) }
    return {
      scene,
      view: { center: [0.6, 0.4, 0], radius: 80, polar: 1.42, azimuth: 0.06 },
      frame(dt, p) {
        const s = solveBus(p)
        const key = `${s.byte}|${s.baud}`
        if (key !== st.key) {
          st.key = key
          st.clock = Math.min(st.clock, SEND_S - 0.05)
          sent.set(`SENDS ${glyphOf(s.byte)} ${hex(s.byte)}`, LABEL)
        }
        st.clock += dt
        if (st.clock >= SEND_S) {
          st.clock = 0
          st.prev = st.prev ?? s.line
        }
        const prog = Math.min(1, st.clock / REVEAL_S)
        const prev = st.prev ?? s.line
        trace.draw((u) => yOf(VCC * (u <= prog ? s.line(tOf(u)) : prev(tOf(u)))), prog < 1 ? prog : null)
        if (prog >= 1) st.prev = s.line

        for (let k = 0; k <= 10; k++) {
          const u = uOf(k / s.baud)
          edges[k].visible = u <= 1
          edges[k].position.set(screen.xAt(Math.min(1, u)), yOf(0) - 0.8 + band / 2, 0.2)
        }
        s.dec.at.forEach((t, k) => {
          const u = uOf(t)
          const on = u <= Math.min(1, prog)
          dots[k].visible = on
          dots[k].position.set(screen.xAt(Math.min(1, u)), yOf(VCC * s.line(t)), 0.45)
          bits[k].group.position.x = screen.xAt(Math.min(1, u))
          bits[k].set(on ? (k === 0 ? 'S' : k === 9 ? 'P' : String(s.dec.bits[k])) : '', s.ok ? POWER : HIGH_V)
        })
        const done = prog >= uOf(s.dec.at[9]) || prog >= 1
        decoded.set(
          done ? `${hex(s.dec.byte)} ${glyphOf(s.dec.byte)}${s.dec.framingOk ? '' : ' FRAME ERR'}` : '',
          s.ok ? POWER : HIGH_V,
        )
      },
      readouts: (p) => {
        const s = solveBus(p)
        return [
          { label: 'Sent', value: `${charOf(s.byte)} ${hex(s.byte)}` },
          {
            label: 'Decoded',
            value: `${charOf(s.dec.byte)} ${hex(s.dec.byte)}${s.dec.framingOk ? '' : ' · framing'}`,
            tone: s.ok ? 'ok' : 'bad',
          },
          { label: 'Bit time', value: `${sec(1 / TX_BAUD)} · read ${sec(1 / s.baud)}`, tone: s.baud === TX_BAUD ? 'ok' : 'warn' },
          { label: 'Slowed', value: `${Math.round(REVEAL_S / D_WIN).toLocaleString('en')}×` },
        ]
      },
    }
  },
}
