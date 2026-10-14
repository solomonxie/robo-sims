import * as THREE from 'three/webgpu'
import {
  HC49_16M,
  WATCH_HZ,
  crystalBandwidth,
  crystalQ,
  dividerStages,
  driftPerDay,
  loadCapacitance,
  loadCapsFor,
  loadedFrequency,
  motionalL,
  motionalResponse,
  parallelResonance,
  pullPpm,
  responseDb,
  seriesResonance,
} from '../../core/physics'
import { si } from '../../core/units'
import { add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  GREY,
  HIGH_V,
  POWER,
  RING,
  acSource,
  ceramicAlong,
  clockFace,
  ease,
  emptyGroup,
  glowMat,
  groundSymbol,
  hc49Crystal,
  icPackage,
  junction,
  pulseLabel,
  scope,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const X = HC49_16M
const FS = seriesResonance(X)
const VIS_HZ = 1.6
const SLOW = Math.round(FS / VIS_HZ / 1e6)
const QUARTZ = '#7fc4ff'
const hz = (f: number) => si(f, 'Hz', 4)
const pf = (c: number) => `${+c.toFixed(1)} pF`
const signed = (v: number, digits = 3) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${+Math.abs(v).toPrecision(digits)}`
const ppm = (v: number) => `${signed(v)} ppm`

// --- Resonance: sweep a drive across the crystal; it only rings in a band fs / Q wide. ---

const SWEEP_S = 7
const HOLD_S = 1.2
const DB_RANGE = 60
const R_X = -13
const R_Y = 1.6
const R_SCALE = 1.6
const S_X = 3.4
const S_W = 15
const S_H = 10
const S_Y = 0.4

const solveResonance = (p: Params) => {
  const span = n(p, 'span')
  return { span, q: crystalQ(X), bw: crystalBandwidth(X), fp: parallelResonance(X) - FS, l1: motionalL(X) }
}

export const resonance: Lesson = {
  id: 'crystal-oscillator-resonance',
  title: 'Resonance',
  tagline: 'A tuning fork made of quartz',
  formula: (p) => {
    const s = solveResonance(p)
    return `fs = 1 / (2π√(L1·C1)) = ${hz(FS)} · Q = 1 / (2π·fs·C1·R1) = ${Math.round(s.q / 100) * 100} · BW = fs / Q = ${hz(s.bw)}`
  },
  legend: [
    { color: HIGH_V, label: 'Response vs drive frequency, dB', shape: 'dot' },
    { color: QUARTZ, label: 'Quartz blank flexing (exaggerated)', shape: 'dot' },
    { color: RING, label: 'Drive offset from fs, Hz', shape: 'dot' },
  ],
  points: [
    'Inside the can is a thin slice of quartz with a silver electrode on each face. Quartz is piezoelectric: a voltage across it shears it, and shearing it makes a voltage.',
    `Like a tuning fork, the slice has one frequency it loves to ring at, set by its thickness. This 16 MHz blank is about 0.1 mm thick. Its vibration is slowed ${(SLOW / 1e6).toFixed(0)} million× here and hugely exaggerated.`,
    'Electrically it acts like a series L1-C1-R1 (the motion) shunted by C0 (the holder). At series resonance fs, L1 and C1 cancel and only R1 is left: the current peaks.',
    `Q is how many cycles it keeps ringing: about ${Math.round(crystalQ(X) / 1000)} 000 for quartz, against ~100 for a coil and capacitor. So the peak is only fs / Q ≈ ${Math.round(crystalBandwidth(X))} Hz wide at 16 MHz, 18 parts per million.`,
    `Widen the span: ${(parallelResonance(X) / 1e3 - FS / 1e3).toFixed(0)} kHz above fs the motion resonates with C0 and the crystal blocks (parallel resonance fp). Oscillators run between fs and fp.`,
  ],
  controls: [{ kind: 'slider', key: 'span', label: 'Sweep span ±', min: 200, max: 50000, initial: 3000, log: true, format: (v) => si(v, 'Hz', 2) }],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const xtal = hc49Crystal(scene, [R_X, R_Y, 0], { scale: R_SCALE })
    const [la, lb] = xtal.legs
    const gy = la[1] - 2.2
    wire(scene, [la, [la[0], gy, 0], [R_X - 1.3, gy, 0]], 0.18)
    wire(scene, [lb, [lb[0], gy, 0], [R_X + 1.3, gy, 0]], 0.18)
    add(scene, acSource(1.3), [R_X, gy, 0])

    const screen = scope(scene, S_W, S_H, { divs: [10, 8], zeroAt: 1 })
    screen.group.position.set(S_X, S_Y, 0)
    const ghost = screen.trace(HIGH_V, { samples: 320, radius: 0.06 })
    ghost.material.transparent = true
    ghost.material.opacity = 0.22
    const trace = screen.trace(HIGH_V, { samples: 320 })
    ticks(screen, [], [[1, '0'], [0.5, '-30']])
    const spanTicks = new THREE.Group()
    screen.group.add(spanTicks)
    const offLabel = pulseLabel(screen.group, 6, RING, [0, S_H / 2 + 1.4, 0.3], 1.1)
    const drive = add(screen.group, mesh(new THREE.CylinderGeometry(0.05, 0.05, S_H, 8), glowMat(RING, 0.7)), [0, 0, 0.3])
    drive.castShadow = false

    const yOf = (db: number) => S_H / 2 + (Math.max(-DB_RANGE, db) / DB_RANGE) * S_H
    let t = 0
    let amp = 0
    let shownSpan = 0
    return {
      scene,
      view: { center: [-2.6, 0.4, 0], radius: 56, polar: 1.42, azimuth: 0.12 },
      frame(dt, p) {
        const s = solveResonance(p)
        if (s.span !== shownSpan) {
          shownSpan = s.span
          t = 0
          emptyGroup(spanTicks)
          const k = String(Math.round(s.span))
          ticks({ ...screen, group: spanTicks }, [[0, `-${k}`], [0.5, '0'], [1, k]], [])
          ghost.draw((u) => yOf(responseDb(X, FS + s.span * (2 * u - 1))), null)
        }
        t += dt
        const u = Math.min(1, (t % (SWEEP_S + HOLD_S)) / SWEEP_S)
        const f = FS + s.span * (2 * u - 1)
        trace.draw((v) => yOf(responseDb(X, FS + s.span * (2 * Math.min(v, u) - 1))), u)
        drive.position.x = screen.xAt(u)
        offLabel.display.group.position.x = Math.max(-S_W / 2 + 2, Math.min(S_W / 2 - 2, screen.xAt(u)))
        offLabel.show(String(Math.round(f - FS)))
        offLabel.frame(dt)
        amp += (motionalResponse(X, f) - amp) * ease(dt, 10)
        const ph = Math.sin(2 * Math.PI * VIS_HZ * t)
        xtal.set(amp * ph, 0.6 * ph)
      },
      readouts: (p) => {
        const s = solveResonance(p)
        return [
          { label: 'Series fs', value: `${(FS / 1e6).toFixed(5)} MHz` },
          { label: 'Q', value: `${Math.round(s.q / 100) / 10}k`, tone: 'ok' },
          { label: 'Bandwidth fs / Q', value: hz(s.bw) },
          { label: 'fp − fs', value: hz(s.fp) },
        ]
      },
    }
  },
}

// --- Load capacitors: the caps across the crystal pull its frequency; the marked value needs the rated load. ---

const STRAY = 5e-12
const C_MIN = 4
const C_MAX = 47
const P_LO = -200
const P_HI = 400
const L_X = -8.8
const CHIP_Y = 6.4
const XT_Y = 1.2
const XT_SCALE = 1.1
const NODE_X = 6
const NODE_Y = -4.1
const CAP_BOT = -7.6
const PL_X = 8.6
const PL_W = 12
const PL_H = 10
const PL_Y = 0

const solveLoad = (p: Params) => {
  const c = n(p, 'cap')
  const stray = n(p, 'stray')
  const cl = loadCapacitance(c, c, stray)
  const off = pullPpm(X, cl * 1e-12)
  return { c, stray, cl, off, f: loadedFrequency(X, cl * 1e-12), right: loadCapsFor(X.loadC, stray * 1e-12) * 1e12 }
}

export const loadCapacitors: Lesson = {
  id: 'crystal-oscillator-load-capacitors',
  title: 'Load capacitors',
  tagline: 'The two little caps that set the pitch',
  formula: (p) => {
    const s = solveLoad(p)
    return `CL = C/2 + Cstray = ${pf(s.c / 2)} + ${pf(s.stray)} = ${pf(s.cl)} → f = fs(1 + C1 / 2(C0 + CL)) = ${(s.f / 1e6).toFixed(6)} MHz (${ppm(s.off)})`
  },
  legend: [
    { color: HIGH_V, label: 'Frequency error vs cap value, ppm', shape: 'dot' },
    { color: RING, label: '±30 ppm crystal tolerance', shape: 'dot' },
    { color: POWER, label: 'Counter: running frequency, MHz', shape: 'dot' },
  ],
  points: [
    'A microcontroller drives the crystal with an inverting amplifier (a Pierce oscillator): XOUT kicks it, XIN listens. Each side has a small cap to ground.',
    'Seen from the crystal the two caps are in series, plus a few pF of pin and trace stray: CL = C1·C2 / (C1 + C2) + Cstray. That load nudges where between fs and fp it settles.',
    'The datasheet names the load it was cut for, here 18 pF. Only with that load does it run at the 16.000000 MHz printed on the can. Less load runs fast, more runs slow, about 17 ppm per pF here.',
    `So the caps are 2 × (CL − Cstray), not CL: with 5 pF stray an 18 pF crystal wants ${Math.round(loadCapsFor(X.loadC, STRAY) * 1e12)} pF (use 27). Fitting 18 pF caps is the classic mistake: ${ppm(pullPpm(X, loadCapacitance(18e-12, 18e-12, STRAY)))}.`,
    'A few ppm is fine for a UART. USB, CAN and radios need tighter, and a watch that’s 20 ppm off loses a minute a month.',
  ],
  controls: [
    { kind: 'slider', key: 'cap', label: 'Each cap C', min: C_MIN, max: C_MAX, initial: 22, step: 1, format: pf },
    { kind: 'slider', key: 'stray', label: 'Stray Cstray', min: 2, max: 8, initial: 5, step: 0.5, format: pf },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const circuit = add(scene, new THREE.Group(), [L_X, 0, 0])
    add(circuit, icPackage(7, 3.4, 2), [0, CHIP_Y, 0])
    const pinY = CHIP_Y - 0.85
    const xtal = hc49Crystal(circuit, [0, XT_Y, 0], { scale: XT_SCALE })
    for (const s of [-1, 1]) {
      const leg = xtal.legs[s < 0 ? 0 : 1]
      wire(circuit, [[s * 3.9, pinY, 0], [s * NODE_X, pinY, 0], [s * NODE_X, NODE_Y, 0], [leg[0], NODE_Y, 0], leg], 0.18)
      junction(circuit, [s * NODE_X, NODE_Y, 0], 0.4)
      add(circuit, groundSymbol(), [s * NODE_X, CAP_BOT, 0])
    }
    const holders = [-1, 1].map((s) => ({ s, g: add(circuit, new THREE.Group()) }))
    const capLabels = [-1, 1].map((s) => pulseLabel(circuit, 2, CONVENTIONAL, [s * (NODE_X - 2.5), (NODE_Y + CAP_BOT) / 2, 0], 1.1))
    const counter = pulseLabel(circuit, 8, POWER, [0, CHIP_Y + 3, 0], 1.2)

    const plot = scope(scene, PL_W, PL_H, { divs: [9, 6], zeroAt: -P_LO / (P_HI - P_LO) })
    plot.group.position.set(PL_X, PL_Y, 0)
    const curve = plot.trace(HIGH_V, { samples: 200 })
    const yOf = (v: number) => ((Math.min(P_HI, Math.max(P_LO, v)) - P_LO) / (P_HI - P_LO) - 0.5) * PL_H
    const uOf = (c: number) => (c - C_MIN) / (C_MAX - C_MIN)
    plot.level(RING).set(yOf(X.tolPpm))
    plot.level(RING).set(yOf(-X.tolPpm))
    ticks(plot, [[uOf(10), '10'], [uOf(20), '20'], [uOf(30), '30'], [uOf(40), '40']], [[0, '-200'], [1 / 3, '0'], [2 / 3, '200'], [1, '400']])
    const dot = add(plot.group, mesh(new THREE.SphereGeometry(0.42, 18, 12), glowMat('#ffffff', 1.4)))
    const offLabel = pulseLabel(plot.group, 4, HIGH_V, [0, 0, 0.3], 1.1)
    const rightMark = add(plot.group, mesh(new THREE.CylinderGeometry(0.05, 0.05, PL_H, 8), glowMat(POWER, 0.6)), [0, 0, 0.3])
    rightMark.castShadow = false

    let t = 0
    const shown = { c: 0, stray: 0, off: 0 }
    let built = -1
    return {
      scene,
      view: { center: [0.5, 0.2, 0], radius: 58, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveLoad(p)
        t += dt
        if (s.c !== built) {
          built = s.c
          const size = 0.8 + 0.5 * Math.sqrt(s.c / C_MAX)
          for (const h of holders) {
            emptyGroup(h.g)
            ceramicAlong(h.g, [h.s * NODE_X, NODE_Y, 0], [h.s * NODE_X, CAP_BOT, 0], size)
          }
        }
        if (s.stray !== shown.stray) {
          const capAt = (u: number) => (C_MIN + u * (C_MAX - C_MIN)) * 1e-12
          curve.draw((u) => yOf(pullPpm(X, loadCapacitance(capAt(u), capAt(u), s.stray * 1e-12))), null)
          rightMark.position.x = plot.xAt(uOf(s.right))
          rightMark.visible = s.right >= C_MIN && s.right <= C_MAX
          shown.stray = s.stray
        }
        shown.c += (s.c - shown.c) * ease(dt)
        shown.off += (s.off - shown.off) * ease(dt)
        const x = plot.xAt(uOf(shown.c))
        const y = yOf(shown.off)
        dot.position.set(x, y, 0.35)
        offLabel.display.group.position.set(Math.min(PL_W / 2 - 1.6, x + 1.6), y + (y > PL_H / 2 - 1.5 ? -1.2 : 1.2), 0.3)
        offLabel.show(String(Math.round(s.off)))
        for (const l of capLabels) l.show(String(Math.round(s.c)))
        counter.show((s.f / 1e6).toFixed(6))
        for (const l of [...capLabels, counter, offLabel]) l.frame(dt)
        const ph = Math.sin(2 * Math.PI * VIS_HZ * t)
        xtal.set(0.8 * ph, ph)
      },
      readouts: (p) => {
        const s = solveLoad(p)
        const off = Math.abs(s.off)
        return [
          { label: 'Load CL', value: pf(s.cl) },
          { label: 'Running at', value: `${(s.f / 1e6).toFixed(6)} MHz` },
          { label: 'Error', value: ppm(s.off), tone: off <= 5 ? 'ok' : off <= X.tolPpm ? 'warn' : 'bad' },
          { label: 'Right caps', value: pf(s.right) },
        ]
      },
    }
  },
}

// --- Clock accuracy: ppm off becomes seconds a day; a time-lapse of noons on a clock face. ---

const DAYS_PER_S = 5
const YEAR = 365
const BITS = dividerStages(WATCH_HZ)
const A_XT = -14.4
const DIV_X = -3.4
const DIV_W = 10
const CLOCK_X = 9
const CLOCK_R = 4.8

const solveClock = (p: Params) => {
  const err = n(p, 'ppm')
  const perDay = driftPerDay(err)
  return { err, perDay, month: 30 * perDay, year: YEAR * perDay }
}

const duration = (s: number) => {
  const a = Math.abs(s)
  const v = a < 60 ? `${+a.toPrecision(3)} s` : a < 3600 ? `${+(a / 60).toPrecision(3)} min` : `${+(a / 3600).toPrecision(3)} h`
  return `${s > 0 ? '+' : s < 0 ? '−' : ''}${v}`
}

export const clockAccuracy: Lesson = {
  id: 'crystal-oscillator-clock-accuracy',
  title: 'Clock accuracy',
  tagline: 'Parts per million, seconds per day',
  formula: (p) => {
    const s = solveClock(p)
    return `drift = error × 86 400 s/day = ${ppm(s.err)} × 86 400 = ${duration(s.perDay)} per day`
  },
  legend: [
    { color: HIGH_V, label: 'Crystal clock (bright second hand)', shape: 'dot' },
    { color: GREY, label: 'True time (ghost hands)', shape: 'dot' },
    { color: POWER, label: '15-stage divider: 32 768 Hz → 1 Hz', shape: 'dot' },
    { color: RING, label: 'Days passed', shape: 'dot' },
  ],
  points: [
    `A watch crystal rings at 32 768 Hz = 2¹⁵ Hz, so ${BITS} flip-flops, each halving, give exactly one tick a second (the last lamp). Watch crystals are tiny tuning forks; the cut-open HC-49 stands in.`,
    'Crystal accuracy is quoted in ppm, parts per million. 20 ppm fast means 32 768.66 Hz instead of 32 768: every second is counted 20 µs too soon.',
    'A day has 86 400 s, so each ppm is 0.0864 s/day: 20 ppm gains 1.7 s a day, 52 s a month, 10 min a year. Each frame here is noon on the next day, 5 days a second.',
    'Typical parts: ceramic resonator ±0.5 % (5000 ppm, 7 min/day: fine for a UART, useless for a clock), crystal ±10–50 ppm, temperature-compensated TCXO ±2 ppm, GPS-disciplined ≈ 0.',
    'Temperature bends it too: a watch crystal slows by 0.034 ppm/°C² away from 25 °C, which is why your wrist keeps a watch better than a cold car does. Clocks that must agree resync over NTP or GPS.',
  ],
  controls: [{ kind: 'slider', key: 'ppm', label: 'Frequency error', min: -200, max: 200, initial: 20, step: 1, format: ppm }],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const xtal = hc49Crystal(scene, [A_XT, 2.4, 0], { scale: 1 })
    add(scene, icPackage(DIV_W, 3.6, 2), [DIV_X, 0, 0])
    const [la, lb] = xtal.legs
    const pin = DIV_X - DIV_W / 2 - 0.8
    wire(scene, [la, [la[0], -3.4, 0], [pin - 1, -3.4, 0], [pin - 1, -0.9, 0], [pin, -0.9, 0]], 0.16)
    wire(scene, [lb, [lb[0], -2.6, 0], [pin - 2, -2.6, 0], [pin - 2, 0.9, 0], [pin, 0.9, 0]], 0.16)
    wire(scene, [[DIV_X + DIV_W / 2 + 0.8, 0.9, 0], [CLOCK_X - CLOCK_R - 0.4, 0.9, 0]], 0.16)
    const bitMats = Array.from({ length: BITS }, (_, k) => {
      const m = glowMat(k === BITS - 1 ? RING : POWER, 0)
      add(scene, mesh(new THREE.SphereGeometry(k === BITS - 1 ? 0.42 : 0.3, 14, 10), m), [DIV_X - 4.3 + (8.6 * k) / (BITS - 1), -0.3, 0.7])
      return m
    })
    const hzLabel = pulseLabel(scene, 5, POWER, [DIV_X, 3.2, 0], 1.1)
    hzLabel.show(String(WATCH_HZ))

    const face = clockFace(scene, [CLOCK_X, 0.9, 0], CLOCK_R, HIGH_V)
    const days = pulseLabel(scene, 3, RING, [CLOCK_X, 0.9 + CLOCK_R + 1.8, 0], 1.2)
    const off = pulseLabel(scene, 5, HIGH_V, [CLOCK_X, 0.9 - CLOCK_R - 1.8, 0], 1.1)

    let t = 0
    let shownErr = NaN
    return {
      scene,
      view: { center: [-2.2, 0.8, 0], radius: 56, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveClock(p)
        if (s.err !== shownErr) {
          shownErr = s.err
          t = 0
        }
        t += dt
        const d = Math.min(YEAR, Math.floor(t * DAYS_PER_S))
        if (t * DAYS_PER_S > YEAR + 10) t = 0
        const drift = d * s.perDay
        face.set(drift, 0)
        days.show(String(d))
        off.show(Math.abs(drift) < 100 ? drift.toFixed(Math.abs(drift) < 10 ? 2 : 1) : String(Math.round(drift)))
        for (const l of [days, off, hzLabel]) l.frame(dt)

        const count = Math.floor(t * WATCH_HZ * (1 + s.err * 1e-6))
        bitMats.forEach((m, k) => {
          m.emissiveIntensity = Math.floor(count / 2 ** k) % 2 ? 1.2 : 0.05
        })
        const ph = Math.sin(2 * Math.PI * VIS_HZ * t)
        xtal.set(0.8 * ph, ph)
      },
      readouts: (p) => {
        const s = solveClock(p)
        const tone = Math.abs(s.err) <= 2 ? 'ok' : Math.abs(s.err) <= 50 ? 'warn' : 'bad'
        return [
          { label: 'Error', value: ppm(s.err) },
          { label: 'Per day', value: duration(s.perDay), tone },
          { label: 'Per month', value: duration(s.month) },
          { label: 'Per year', value: duration(s.year) },
        ]
      },
    }
  },
}
