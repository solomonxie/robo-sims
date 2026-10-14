import * as THREE from 'three/webgpu'
import {
  AIR_ARC_V,
  IRON_CORE,
  inductorEnergy,
  inductorVolts,
  rcFraction,
  rlTau,
  solenoidB,
  solenoidInductance,
  switchOffSpike,
} from '../../core/physics'
import { nearestE12 } from '../../core/resistorColors'
import { fitDigits, ohms, si, volts } from '../../core/units'
import { V3, add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  CELL_H,
  CONVENTIONAL,
  Flow,
  GREY,
  HIGH_V,
  LANE,
  LOW_V,
  POWER,
  RING,
  RS,
  arcSpark,
  cell,
  cellFraction,
  clamp01,
  coilLines,
  currentSource,
  dropAlong,
  ease,
  emptyGroup,
  glowMat,
  inductorCoil,
  ivScreen,
  knifeSwitch,
  lerp,
  path,
  plusFlow,
  plusGeometry,
  presence,
  pulseLabel,
  scope,
  segmentDisplay,
  swapResistor,
  ticks,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const lane = (pts: V3[], z = LANE): V3[] => pts.map(([x, y]): V3 => [x, y, z])
const secs = (s: number) => si(s, 's', 3)
const henries = (h: number) => si(h, 'H', 3)
const grouped = (x: number) => String(Math.round(x)).replace(/\B(?=(\d{3})+$)/g, ',')

// --- Energy in a coil: current builds a field, and the field holds ½LI²; turns and an iron core raise L. ---

const LEN_M = 0.05
const RADIUS_M = 0.008
const MAX_A = 1
const E1_L = 10
const E1_R = 2.2
const E1_X = -7
const E1_Y = 0.6
const PER_DRAWN = 10
const SRC_X = -17.5
const W1_TOP = 6
const W1_BOT = -5
const W1_RIGHT = E1_X + E1_L / 2 + 2.6
const P1_X = 7.4
const P1_W = 8
const P1_H = 6.4
type Core = 'air' | 'iron'

const solveEnergy = (p: Params) => {
  const core: Core = p.core === 'iron' ? 'iron' : 'air'
  const turns = n(p, 'turns')
  const i = n(p, 'amps')
  const mur = core === 'iron' ? IRON_CORE.mur : 1
  const l = solenoidInductance(turns, LEN_M, RADIUS_M, mur)
  return { core, turns, i, l, b: solenoidB(turns, LEN_M, i, core === 'iron' ? IRON_CORE : undefined), e: inductorEnergy(l, i), other: inductorEnergy(solenoidInductance(turns, LEN_M, RADIUS_M, IRON_CORE.mur / mur), i) }
}
/** Line pairs for a field: one more per ×4.6 in B, so µT and T both read. */
const pairsFor = (b: number) => (b <= 1e-9 ? 0 : Math.max(1, Math.min(5, Math.round(1.5 * Math.log10(b / 1e-5)))))

export const energyInACoil: Lesson = {
  id: 'inductor-energy-in-a-coil',
  title: 'Energy in a coil',
  tagline: 'The field is where it’s kept',
  formula: (p) => {
    const s = solveEnergy(p)
    return `E = ½·L·I² = ½ × ${henries(s.l)} × (${si(s.i, 'A', 3)})² = ${si(s.e, 'J', 3)} · L = μ₀${s.core === 'iron' ? 'μr' : ''}·N²·A / l`
  },
  legend: [
    { color: CONVENTIONAL, label: 'Current I round the turns', shape: 'dot' },
    { color: B_FIELD, label: 'Field B', shape: 'dot' },
    { color: POWER, label: 'Stored energy E, µJ', shape: 'dot' },
    { color: '#ffffff', label: 'E vs I: 2× current, 4× energy', shape: 'dot' },
  ],
  points: [
    'An inductor is a coil of wire. Current through it builds a magnetic field, and building that field takes energy. The coil holds it as E = ½LI².',
    'Inductance L is how much field the coil links per amp. For a long coil L = μ₀μr·N²·A / l: twice the turns, four times L, since each turn makes more field and also catches more of it.',
    'An iron core lines its domains up with the field and multiplies L by μr, about 200 for an open rod: the same current now stores 200× the energy, until the iron saturates near 1.6 T.',
    'Energy grows with I²: double the current and the field holds four times as much. The plot traces E against I from 0 to 1 A; the dot is now.',
    'The energy sits in the field, not the wire. It can’t appear or vanish at once, so a coil’s current can’t jump either. The next two lessons show what that does in a circuit.',
  ],
  controls: [
    { kind: 'choice', key: 'core', options: [{ value: 'air', label: 'Air core' }, { value: 'iron', label: 'Iron core' }], initial: 'iron' },
    { kind: 'slider', key: 'amps', label: 'Current I', min: 0, max: MAX_A, initial: 0.5, step: 0.05, format: (v) => si(v, 'A', 3) },
    { kind: 'slider', key: 'turns', label: 'Turns N', min: 50, max: 200, initial: 100, step: 25, format: (v) => `${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const top = E1_Y + E1_R
    add(scene, currentSource(1.5), [SRC_X, 0, 0])
    wire(scene, [[E1_X - E1_L / 2, top, 0], [E1_X - E1_L / 2, W1_TOP, 0], [SRC_X, W1_TOP, 0], [SRC_X, W1_BOT, 0], [W1_RIGHT, W1_BOT, 0], [W1_RIGHT, W1_TOP, 0], [E1_X + E1_L / 2, W1_TOP, 0], [E1_X + E1_L / 2, top, 0]], 0.2)
    const holder = add(scene, new THREE.Group(), [E1_X, E1_Y, 0])
    const field = coilLines(scene, { radius: E1_R, length: E1_L, loops: 14, box: [9.4, 5.6], spacing: 2.8 })
    field.group.position.set(E1_X, E1_Y, 0)
    const storeMat = new THREE.MeshBasicMaterial({ color: POWER, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    const store = add(scene, mesh(new THREE.CylinderGeometry(E1_R * 0.92, E1_R * 0.92, E1_L, 32, 1, true), storeMat), [E1_X, E1_Y, 0])
    store.rotation.z = Math.PI / 2
    store.castShadow = false
    const wireFlow = new Flow(path(lane([[E1_X + E1_L / 2, W1_TOP, 0], [W1_RIGHT, W1_TOP, 0], [W1_RIGHT, W1_BOT, 0], [SRC_X, W1_BOT, 0], [SRC_X, W1_TOP, 0], [E1_X - E1_L / 2, W1_TOP, 0]], 0.6)), 1.6, CONVENTIONAL, 0.2)
    scene.add(wireFlow.mesh)

    const { plot, dot, y } = ivScreen(scene, [P1_X, E1_Y, 0], P1_W, P1_H, [4, 4])
    plot.trace(POWER, { samples: 80, radius: 0.09 }).draw((u) => y(u * u), null)
    const quarter = add(plot.group, mesh(new THREE.SphereGeometry(0.22, 12, 8), glowMat(GREY, 0.6)), [plot.xAt(0.5), y(0.25), 0.3])
    quarter.castShadow = false
    ticks(plot, [[0, '0'], [0.5, '0.5'], [1, '1']], [])
    const eLabel = pulseLabel(scene, 5, POWER, [P1_X, E1_Y + P1_H / 2 + 1.6, 0], 1.3)

    const st = { key: '', i: 0, flow: null as Flow | null, coil: null as ReturnType<typeof inductorCoil> | null }
    return {
      scene,
      view: { center: [-3.6, 0.8, 0], radius: 60, polar: 1.36, azimuth: 0.16 },
      frame(dt, p) {
        const s = solveEnergy(p)
        const key = `${s.core}${s.turns}`
        if (key !== st.key) {
          st.key = key
          emptyGroup(holder)
          st.coil = inductorCoil(holder, { radius: E1_R, length: E1_L, turns: Math.round(s.turns / PER_DRAWN), thickness: 0.16, core: s.core === 'iron' ? 1.4 : 0 })
          st.flow = new Flow(st.coil.lane(0.3), 1.4, CONVENTIONAL, 0.15)
          holder.add(st.flow.mesh)
        }
        st.i += (s.i - st.i) * ease(dt, 3)
        const mur = s.core === 'iron' ? IRON_CORE.mur : 1
        const l = solenoidInductance(s.turns, LEN_M, RADIUS_M, mur)
        const b = solenoidB(s.turns, LEN_M, st.i, s.core === 'iron' ? IRON_CORE : undefined)
        const e = inductorEnergy(l, st.i)
        st.flow?.step(dt * 2 * st.i)
        wireFlow.step(dt * 3 * st.i)
        field.set(pairsFor(b))
        field.step(dt * 1.5)
        storeMat.opacity = e > 1e-9 ? 0.08 + 0.4 * clamp01(Math.log10(e / 1e-8) / 6) : 0
        const u = st.i / MAX_A
        dot.position.set(plot.xAt(u), y(u * u), 0.4)
        quarter.visible = s.i >= 0.5
        eLabel.show(fitDigits(e * 1e6, 5))
        eLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveEnergy(p)
        return [
          { label: 'L = μ₀μr·N²A / l', value: henries(s.l) },
          { label: 'B inside', value: si(s.b, 'T', 3) },
          { label: 'E = ½LI²', value: si(s.e, 'J', 3), tone: 'ok' },
          { label: s.core === 'iron' ? 'Same, air core' : 'Same, iron core', value: si(s.other, 'J', 3) },
        ]
      },
    }
  },
}

// --- RL time constant: the twin of RC; the current, not the voltage, takes τ = L/R to settle, 63 % per τ. ---

const VS = 5
const PLAY = 1.2
const HOLD = 1.5
const TAUS = 5
const L_LEFT = -17
const L_RIGHT = -10
const LH = 4.5
const R2_X = -13.5
const C2_R = 0.95
const C2_LEN = 4.6
const S2_X = 7
const S2_W = 14
const S2_H = 7.5
const HENRIES: Record<string, number> = { '1': 1e-3, '10': 10e-3, '100': 100e-3 }

const solveRL = (p: Params) => {
  const on = p.mode !== 'off'
  const r = nearestE12(n(p, 'r'))
  const l = HENRIES[String(p.l)] ?? 10e-3
  return { on, r, l, tau: rlTau(r, l), final: VS / r }
}
/** Current as a fraction of V/R, and the coil's voltage as a fraction of V, `taus` after switching. */
const currentShape = (on: boolean, taus: number) => (on ? rcFraction(taus, 1) : 1 - rcFraction(taus, 1))
const coilShape = (on: boolean, taus: number) => (on ? 1 : -1) * (1 - rcFraction(taus, 1))

/** Potential fraction round the RL loop: cell up the left (a plain wire when off), resistor on the top wire, coil down the
 *  right; `i` is the current as a fraction of V/R. */
function rlPotential(at: THREE.Vector3, on: boolean, i: number) {
  if (on) {
    if (at.y <= -LH + 0.01) return 0
    if (at.x <= L_LEFT + 0.01) return cellFraction(at.y)
    if (at.y >= LH - 0.01) return dropAlong(at, [L_LEFT, LH, 0], [L_RIGHT, LH, 0], 1, 1 - i, RS)
    return (1 - i) * clamp01((at.y + C2_LEN / 2) / C2_LEN)
  }
  if (at.y >= LH - 0.01 && at.x > L_LEFT + 0.01) return dropAlong(at, [L_LEFT, LH, 0], [L_RIGHT, LH, 0], i, 0, RS)
  if (at.x >= L_RIGHT - 0.01 && at.y > -LH + 0.01) return i * clamp01((C2_LEN / 2 - at.y) / C2_LEN)
  return i
}

export const rlTimeConstant: Lesson = {
  id: 'inductor-rl-time-constant',
  title: 'RL time constant',
  tagline: 'Current that takes its time',
  formula: (p) => {
    const s = solveRL(p)
    return `τ = L / R = ${henries(s.l)} / ${ohms(s.r)} = ${secs(s.tau)} · I = (V/R)·${s.on ? '(1 − e^(−t/τ))' : 'e^(−t/τ)'} · V_L = L·dI/dt`
  },
  legend: [
    { color: CONVENTIONAL, label: 'Current I, mA; scope: % of V / R', shape: 'dot' },
    { color: HIGH_V, label: 'Coil voltage V_L = L·dI/dt', shape: 'dot' },
    { color: RING, label: 'Each τ: % reached', shape: 'dot' },
    { color: GREY, label: 'Grid in τ, counted below', shape: 'dot' },
    { color: B_FIELD, label: 'Field in the core', shape: 'dot' },
  ],
  points: [
    'A coil fights any change in its current. Switch on and at first the whole 5 V sits across the coil, V_L = L·dI/dt, while the current starts from zero, not from V / R.',
    'As the current climbs, the resistor takes more of the voltage and the coil less, so the climb slows: I = (V/R)·(1 − e^(−t/τ)) with τ = L / R. Henries per ohm are seconds: 10 mH / 100 Ω = 100 µs.',
    'Each τ closes 63 % of the gap: 86 % after 2τ, 99 % after 5τ. It is the capacitor’s RC curve with current in place of voltage (Capacitor → RC time constant).',
    'R sits underneath here: more resistance makes τ shorter, the opposite of RC. It burns the field’s energy faster, and lets less current build up in the first place.',
    'Take the supply out (a wire takes its place) and the coil keeps the current going on its own: it falls 37 % per τ and V_L flips sign. Each τ plays in 1.2 s; real ones last µs to ms.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: [{ value: 'on', label: 'Supply on' }, { value: 'off', label: 'Supply off' }], initial: 'on' },
    { kind: 'slider', key: 'r', label: 'Resistor R', min: 10, max: 1000, initial: 100, log: true, format: (v) => ohms(nearestE12(v)) },
    { kind: 'choice', key: 'l', options: [{ value: '1', label: '1 mH' }, { value: '10', label: '10 mH' }, { value: '100', label: '100 mH' }], initial: '10' },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    wire(scene, [[L_RIGHT, C2_LEN / 2, 0], [L_RIGHT, LH, 0], [L_LEFT, LH, 0], [L_LEFT, -LH, 0], [L_RIGHT, -LH, 0], [L_RIGHT, -C2_LEN / 2, 0]])
    const battery = add(scene, cell(CELL_H, 1.5), [L_LEFT, 0, 0])
    const holder = add(scene, new THREE.Group())
    const winding = inductorCoil(scene, { radius: C2_R, length: C2_LEN, turns: 8, thickness: 0.15, core: 0.55 })
    winding.group.position.set(L_RIGHT - C2_R, 0, 0)
    winding.group.rotation.z = -Math.PI / 2
    const iLabel = pulseLabel(scene, 4, CONVENTIONAL, [L_RIGHT + 4.4, 2.6, 0], 1.2)

    const state = { key: '', r: NaN, u: 0, hold: 0, on: true, i: 0, show: 1 }
    const flow = plusFlow(
      scene,
      lane([[L_RIGHT, -C2_LEN / 2, 0], [L_RIGHT, -LH, 0], [L_LEFT, -LH, 0], [L_LEFT, LH, 0], [L_RIGHT, LH, 0], [L_RIGHT, C2_LEN / 2, 0]]),
      (at) => rlPotential(at, state.on, state.i),
      true,
    )

    const plot = scope(scene, S2_W, S2_H, { divs: [TAUS, 4], zeroAt: 0.5 })
    plot.group.position.set(S2_X, 0, 0)
    const y = (f: number) => f * S2_H * 0.42
    const ghost = plot.trace('#6a4f38', { samples: 120, radius: 0.07 })
    const live = plot.trace(CONVENTIONAL, { radius: 0.12 })
    const vLive = plot.trace(HIGH_V, { radius: 0.09 })
    const head = add(plot.group, mesh(new THREE.SphereGeometry(0.34, 16, 12), glowMat(CONVENTIONAL, 1.2)))
    const level = plot.level(RING)
    const marks = Array.from({ length: TAUS }, (_, i) => {
      const k = i + 1
      const dot = add(plot.group, mesh(new THREE.SphereGeometry(0.24, 14, 10), glowMat(RING, 1)))
      const label = pulseLabel(plot.group, 2, RING, [0, 0, 0.4], 0.9)
      const digit = segmentDisplay(1, 0.9, GREY, true)
      digit.set(String(k))
      add(plot.group, digit.group, [plot.xAt(k / TAUS), -S2_H / 2 - 1.3, 0])
      return { k, dot, label }
    })
    const grow = (t: ReturnType<typeof plot.trace>, h: number) => {
      t.group.scale.x = h
      t.group.position.x = (-S2_W / 2) * (1 - h)
    }

    return {
      scene,
      view: { center: [-1.6, 1.4, 0], radius: 57, polar: 1.4, azimuth: 0.12 },
      frame(dt, p) {
        const s = solveRL(p)
        const key = `${s.on}${s.r}${s.l}`
        if (key !== state.key) {
          if (s.on !== state.on || !state.key) {
            ghost.draw((u) => y(currentShape(s.on, u * TAUS)), null)
            level.set(y(currentShape(s.on, 1)))
            for (const m of marks) {
              const f = currentShape(s.on, m.k)
              m.dot.position.set(plot.xAt(m.k / TAUS), y(f), 0.35)
              m.label.display.group.position.set(plot.xAt(m.k / TAUS) + (s.on ? -0.8 : 0.7), y(f) + (s.on ? 0.6 : 1.1), 0.4)
              m.label.show(String(Math.round(f * 100)))
            }
          }
          if (s.r !== state.r) swapResistor(holder, (state.r = s.r), [R2_X - 1, LH, 0], [R2_X + 1, LH, 0])
          state.key = key
          state.on = s.on
          state.u = 0
          state.hold = 0
        }
        if (state.u < TAUS) state.u = Math.min(TAUS, state.u + dt / PLAY)
        else if ((state.hold += dt) > HOLD) {
          state.u = 0
          state.hold = 0
        }
        const u = state.u
        state.i = currentShape(s.on, u)
        const h = Math.max(0.002, u / TAUS)
        grow(live, h)
        grow(vLive, h)
        live.draw((v) => y(currentShape(s.on, v * u)), null)
        vLive.draw((v) => y(coilShape(s.on, v * u)), 1)
        head.position.set(plot.xAt(h), y(state.i), 0.35)
        for (const m of marks) {
          const shown = u >= m.k - 1e-6
          m.dot.visible = shown
          m.label.display.group.visible = shown
          m.label.frame(dt)
        }

        state.show += ((s.on ? 1 : 0) - state.show) * ease(dt, 8)
        presence(battery, state.show)
        winding.set(0.7 * state.i)
        flow.step((dt * 5 * state.i) / PLAY)
        iLabel.show(fitDigits(state.i * s.final * 1000, 4))
        iLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveRL(p)
        return [
          { label: 'τ = L / R', value: secs(s.tau), tone: 'ok' },
          { label: 'Time t', value: `${secs(state.u * s.tau)} = ${state.u.toFixed(1)}τ` },
          { label: 'Current I', value: si(state.i * s.final, 'A', 3) },
          { label: 'Shown', value: `${grouped(PLAY / s.tau)}× slower` },
        ]
      },
    }
  },
}

// --- Flyback spike: cut a coil's current and it answers with V = L·dI/dt; the faster the cut, the higher the spike. ---

const VS3 = 12
const R_COIL = 240
const I0 = VS3 / R_COIL
const RATED = 40
const COILS: Record<string, number> = { '1': 1e-3, '20': 20e-3, '200': 200e-3 }
const ON_S = 1.6
const CUT_S = 1.4
const OFF_S = 1.6
const CLOSE_S = 1
const CYCLE = ON_S + CUT_S + OFF_S + CLOSE_S
const C3_X = -14
const TOP = 3
const BOT = -3.4
const COIL_X = -4
const COIL_L = 6.4
const COIL_R = 1.1
const CL = COIL_X - COIL_L / 2
const CR = COIL_X + COIL_L / 2
const RX = 8
const PIVOT: V3 = [5, BOT, 0]
const BLADE = 3.2
const THROW = (35 * Math.PI) / 180
const CONTACT: V3 = [PIVOT[0] - BLADE, BOT, 0]
const S3_Y = -8.4
const S3_W = 24
const S3_H = 5.6
const DECADES = 4

const solveSpike = (p: Params) => {
  const l = COILS[String(p.l)] ?? 0.2
  const tOff = n(p, 'toff')
  const coilV = inductorVolts(l, I0, tOff)
  return { l, tOff, coilV, spike: switchOffSpike(VS3, I0, l, tOff) }
}
/** Where display time `t` falls in the on → cut → off → close cycle: current fraction, switch volts, blade opening. */
function cycleAt(t: number, spike: number) {
  const c = ((t % CYCLE) + CYCLE) % CYCLE
  if (c < ON_S) return { i: 1, v: 0, open: 0, cutting: false }
  if (c < ON_S + CUT_S) {
    const u = (c - ON_S) / CUT_S
    return { i: 1 - u, v: spike, open: u, cutting: true }
  }
  if (c < ON_S + CUT_S + OFF_S) return { i: 0, v: VS3, open: 1, cutting: false }
  const u = (c - ON_S - CUT_S - OFF_S) / CLOSE_S
  return { i: rcFraction(u, 0.2), v: 0, open: 0, cutting: false }
}
const logY = (v: number) => (clamp01(Math.log10(Math.max(1, v)) / DECADES) - 0.5) * S3_H
const spikeTone = (v: number) => (v > AIR_ARC_V ? 'bad' : v > RATED ? 'warn' : 'ok')

export const flybackSpike: Lesson = {
  id: 'inductor-flyback-spike',
  title: 'Flyback spike',
  tagline: 'Cut the current, get the volts',
  formula: (p) => {
    const s = solveSpike(p)
    return `V = L·ΔI/Δt = ${henries(s.l)} × 50 mA / ${secs(s.tOff)} = ${volts(s.coilV)} · switch: 12 V + ${volts(s.coilV)} = ${volts(s.spike)}`
  },
  legend: [
    { color: HIGH_V, label: 'Switch voltage, log 1 V–10 kV; spike', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Coil current, 0–50 mA', shape: 'dot' },
    { color: RING, label: '40 V: a small transistor’s limit', shape: 'dot' },
    { color: '#cfe3ff', label: '330 V: air sparks over', shape: 'dot' },
    { color: B_FIELD, label: 'Field, collapsing as I falls', shape: 'dot' },
  ],
  points: [
    'A coil’s voltage depends on how fast its current changes: V = L·dI/dt. A steady current makes none; only a change does.',
    'Opening the switch cuts the 50 mA to zero in some time t. The coil answers with whatever voltage that change takes: 200 mH × 50 mA in 100 µs is 100 V.',
    'Ten times faster, ten times the volts. Cut it in 1 µs and the coil tries 10 kV: a transistor breaks down long before, and contacts arc (air sparks over above ~330 V).',
    'The coil’s voltage flips: while the current built up it opposed the supply; now it adds to it, + on the switch side. The switch sees 12 V + L·dI/dt, fed by the collapsing field’s ½LI².',
    'A slower cut keeps the spike down but burns that energy in the switch. The usual fix is to give the current a path instead: see Diode → Flyback diode.',
  ],
  controls: [
    { kind: 'choice', key: 'l', options: [{ value: '1', label: '1 mH' }, { value: '20', label: '20 mH' }, { value: '200', label: 'Relay 200 mH' }], initial: '200' },
    { kind: 'slider', key: 'toff', label: 'Switch-off time', min: 1e-6, max: 10e-3, initial: 100e-6, log: true, format: secs },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    add(scene, cell(CELL_H, 1.5), [C3_X, 0, 0])
    wire(scene, [CONTACT, [C3_X, BOT, 0], [C3_X, TOP, 0], [CL, TOP, 0]])
    wire(scene, [[CR, TOP, 0], [RX, TOP, 0], [RX, BOT, 0], PIVOT])
    const toggle = knifeSwitch(scene, PIVOT, BLADE, [Math.PI])
    const winding = inductorCoil(scene, { radius: COIL_R, length: COIL_L })
    winding.group.position.set(COIL_X, TOP - COIL_R, 0)
    const field = coilLines(scene, { radius: COIL_R, length: COIL_L, loops: 9, box: [8, 3.8], spacing: 2.2 })
    field.group.position.set(COIL_X, TOP - COIL_R, 0)
    field.set(3)
    const signs = add(scene, new THREE.Group(), [COIL_X, TOP + 1.4, 0.4])
    add(signs, mesh(plusGeometry(1), glowMat(HIGH_V, 1.2)), [COIL_L / 2 - 0.4, 0, 0])
    add(signs, mesh(new THREE.BoxGeometry(1, 0.28, 0.28), glowMat(LOW_V, 1.2)), [-COIL_L / 2 + 0.4, 0, 0])
    const spark = arcSpark(scene, [CONTACT[0] + 0.4, BOT + 0.9, 0.3])
    const peakLabel = pulseLabel(scene, 5, HIGH_V, [RX + 3.6, 0, 0], 1.4)
    peakLabel.display.set('')

    const plot = scope(scene, S3_W, S3_H, { divs: [12, DECADES], zeroAt: 0 })
    plot.group.position.set(0, S3_Y, 0)
    ticks(plot, [], [[0.25, '10'], [0.5, '100'], [0.75, '1000']])
    const vTrace = plot.trace(HIGH_V, { samples: 300, radius: 0.1 })
    const iTrace = plot.trace(CONVENTIONAL, { samples: 300, radius: 0.08 })
    plot.level(RING).set(logY(RATED))
    plot.level('#cfe3ff').set(logY(AIR_ARC_V))

    const state = { key: '', t: 0, spike: VS3, open: 0, i: 1, v: 0, cutting: false }
    const paint = (at: THREE.Vector3) => {
      if (at.x <= C3_X + 0.01) return cellFraction(at.y)
      if (at.y <= BOT + 0.01 && at.x < CONTACT[0] + 0.01) return 0
      const node = state.open > 0 ? state.v / VS3 : 0
      if (at.y >= TOP - 0.01 && at.x < CL) return 1
      if (at.y >= TOP - 0.01 && at.x < CR) return lerp(1, node, (at.x - CL) / COIL_L)
      return node
    }
    const flow = plusFlow(scene, lane([[C3_X, BOT, 0], [C3_X, TOP, 0], [RX, TOP, 0], [RX, BOT, 0], CONTACT]), paint, true)

    return {
      scene,
      view: { center: [-1.6, -1.7, 0], radius: 56, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveSpike(p)
        const key = `${s.l}${s.tOff}`
        if (key !== state.key) {
          state.key = key
          state.t = 0
        }
        state.spike = s.spike
        state.t += dt
        const now = cycleAt(state.t, s.spike)
        state.i = now.i
        state.v = now.v
        state.open = now.open
        state.cutting = now.cutting

        toggle.set(Math.PI - THROW * now.open)
        winding.set(now.i)
        presence(field.group, now.i)
        field.step(dt * 1.2)
        presence(signs, now.cutting ? 1 : 0)
        const arc = now.cutting ? clamp01(Math.log10(s.spike / AIR_ARC_V) / 1.5) : 0
        const tip: V3 = [PIVOT[0] + BLADE * Math.cos(Math.PI - THROW * now.open), BOT + BLADE * Math.sin(Math.PI - THROW * now.open), 0.3]
        spark.set([CONTACT[0], CONTACT[1], 0.3], tip, arc)

        flow.step(dt * 3 * now.i)
        vTrace.scroll((t) => logY(cycleAt(t, s.spike).v), state.t, CYCLE)
        iTrace.scroll((t) => (cycleAt(t, s.spike).i * 0.8 - 0.5) * S3_H, state.t, CYCLE)
        peakLabel.show(now.open ? String(Math.round(s.spike)) : '')
        peakLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveSpike(p)
        return [
          { label: 'dI/dt = 50 mA / t', value: si(I0 / s.tOff, 'A/s', 3) },
          { label: 'Coil L·dI/dt', value: volts(s.coilV) },
          { label: 'Switch sees', value: volts(s.spike), tone: spikeTone(s.spike) },
          { label: 'Cut shown', value: `${grouped(CUT_S / s.tOff)}× slower` },
        ]
      },
    }
  },
}
