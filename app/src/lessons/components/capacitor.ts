import * as THREE from 'three/webgpu'
import { capacitorCharge, capacitorEnergy, decoupleStep, electrolyticLeakage, rcFraction, rcStep, rcTau } from '../../core/physics'
import { nearestE12 } from '../../core/resistorColors'
import { fitDigits, ohms, si, volts } from '../../core/units'
import { BLACK_PLASTIC, V3, add, box, cylinder, lead, mat, mesh, rod, STEEL } from '../../models/kit'
import { buildCeramicCap, buildElectrolyticCap } from '../../models/passives'
import { createStage } from '../../scene/stage'
import {
  CELL_H,
  CONVENTIONAL,
  HIGH_V,
  LANE,
  LOW_V,
  RING,
  RS,
  cell,
  cellFraction,
  ceramicAlong,
  clamp01,
  coil,
  ease,
  emptyGroup,
  fieldLines,
  glowMat,
  halton,
  heatWaves,
  icPackage,
  lerp,
  plusFlow,
  plusGeometry,
  potentialColor,
  presence,
  pulseLabel,
  scope,
  segmentDisplay,
  smoke,
  swapResistor,
  wire,
} from '../fx'
import { ChoiceControl, Lesson, Params, SliderControl, Stage, e12, n } from '../types'

const VS = 9
const secs = (s: number) => si(s, 's', 3)
const lane = (pts: V3[], z = LANE): V3[] => pts.map(([x, y]): V3 => [x, y, z])

const modeControl: ChoiceControl = {
  kind: 'choice',
  key: 'mode',
  options: [
    { value: 'charge', label: 'Charge' },
    { value: 'discharge', label: 'Discharge' },
  ],
  initial: 'charge',
}
const rSlider = (min: number, max: number, initial: number): SliderControl => ({
  kind: 'slider',
  key: 'r',
  label: 'Resistor R',
  min,
  max,
  initial,
  log: true,
  format: (v) => ohms(nearestE12(v)),
})

/** Potential fraction round an RC loop: cell up the left side at `xl` (a plain wire when discharging), resistor on the
 *  top wire from `ra` to `rb`, the capacitor's + side (y > 0) right of it at `vc`, everything below the middle 0. */
function rcPotential(x: number, y: number, { h, xl, ra, rb, charging, vc }: { h: number; xl: number; ra: number; rb: number; charging: boolean; vc: number }) {
  if (y <= -h + 0.01) return 0
  if (x > rb) return y > 0 ? vc : 0
  const left = charging ? 1 : 0
  if (x <= xl + 0.01) return charging ? cellFraction(y) : 0
  if (x < ra || y < h - 0.01) return left
  return lerp(left, vc, (x - ra) / (rb - ra))
}

// --- Charging and discharging: a switch sends the battery's charge onto the plates, then lets it run back through R. ---

const C_PLATES = 100e-6
const W = 12
const H = 6
const PIVOT: V3 = [-6.5, H, 0]
const BLADE = 3
const THROW = (35 * Math.PI) / 180
const CONTACT_A: V3 = [PIVOT[0] - BLADE, H, 0]
const CONTACT_B: V3 = [PIVOT[0] - BLADE * Math.cos(THROW), H - BLADE * Math.sin(THROW), 0]
const R_X = 1.2
const PLATE = 5.4
const PLATE_T = 0.3
const GAP = 1.8
const MAX_TOKENS = 90
const FIELD_LINES = 16
const WINDOW = 20
const SCOPE_W = 13
const SCOPE_H = 6
const PER_SCOPE = (SCOPE_H / 2) * 0.9
const AMP_SPEED = 3000

const solveCharging = (p: Params) => {
  const charging = p.mode !== 'discharge'
  const r = e12(p, 'r')
  return { charging, r, tau: rcTau(r, C_PLATES), target: charging ? VS : 0 }
}

export const chargingAndDischarging: Lesson = {
  id: 'capacitor-charging-and-discharging',
  title: 'Charging and discharging',
  tagline: 'Fill the plates, then let them empty',
  formula: (p) => {
    const s = solveCharging(p)
    const law = s.charging ? 'Vc = V·(1 − e^(−t/RC)), I = (V − Vc) / R' : 'Vc = V₀·e^(−t/RC), I = −Vc / R'
    return `${law} · RC = ${ohms(s.r)} × 100 µF = ${secs(s.tau)}`
  },
  legend: [
    { color: HIGH_V, label: '+ on the plate; Vc on the scope, V', shape: 'dot' },
    { color: LOW_V, label: '− on the plate; wires by potential', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Current I, µA (scope top = V / R)', shape: 'dot' },
    { color: RING, label: 'Field in the gap', shape: 'dot' },
  ],
  points: [
    'A capacitor is two plates with an insulating gap. Switch to the battery and current flows: charge leaves one plate and piles up on the other, + on top, − below. None crosses the gap.',
    'As the plates fill, Vc rises and pushes back against the battery, so the current I = (V − Vc) / R fades. It is biggest at the start (V / R) and dies away as Vc nears 9 V.',
    'Switch to discharge: now the plates’ own voltage drives current backwards through R until they are empty. Vc falls along the same kind of curve.',
    'Both run on the time constant τ = RC: 22 kΩ × 100 µF = 2.2 s, shown in real time. A bigger R lets less current through, so filling and emptying take longer.',
    'The energy, ½CV² (4 mJ at 9 V), sits in the field across the gap. The capacitor keeps it after the battery is gone, which is why big ones can still bite when unplugged.',
  ],
  controls: [modeControl, rSlider(4700, 47000, 22000)],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const yTop = GAP / 2 + PLATE_T
    wire(scene, [[-W, -H, 0], [-W, H, 0], CONTACT_A])
    wire(scene, [PIVOT, [W, H, 0], [W, yTop, 0]])
    wire(scene, [[W, -yTop, 0], [W, -H, 0], [-W, -H, 0]])
    wire(scene, [CONTACT_B, [CONTACT_B[0], -H, 0]])
    add(scene, cell(CELL_H, 1.5), [-W, 0, 0])
    const contact = new THREE.SphereGeometry(0.42, 16, 12)
    for (const at of [CONTACT_A, CONTACT_B, PIVOT]) add(scene, mesh(contact, STEEL()), at)
    const blade = add(scene, new THREE.Group(), [PIVOT[0], PIVOT[1], 0.25])
    rod(blade, [0, 0, 0], [-BLADE, 0, 0], 0.26, STEEL())
    box(blade, [1.2, 0.7, 0.7], mat('#d23b3b', { rough: 0.5 }), [-BLADE * 0.55, 0, 0.4])
    const holder = add(scene, new THREE.Group())

    const plateGeo = new THREE.BoxGeometry(PLATE, PLATE_T, PLATE)
    const plateMats = [0, 1].map(
      () => new THREE.MeshStandardMaterial({ color: '#c9ccd3', emissive: LOW_V, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.4, transparent: true, opacity: 0.6, depthWrite: false }),
    )
    plateMats.forEach((m, k) => (add(scene, mesh(plateGeo, m), [W, (k ? -1 : 1) * (GAP / 2 + PLATE_T / 2), 0]).castShadow = false))
    const tokenGeo = new THREE.SphereGeometry(0.2, 10, 8)
    const m4 = new THREE.Matrix4()
    const tokens = [HIGH_V, LOW_V].map((c, k) => {
      const im = new THREE.InstancedMesh(tokenGeo, glowMat(c, 0.9), MAX_TOKENS)
      const y = k ? -GAP / 2 + 0.22 : GAP / 2 - 0.22
      for (let i = 0; i < MAX_TOKENS; i++) im.setMatrixAt(i, m4.makeTranslation(W + (halton(i, 2) - 0.5) * (PLATE - 0.6), y, (halton(i, 3) - 0.5) * (PLATE - 0.6)))
      im.frustumCulled = false
      im.count = 0
      scene.add(im)
      return im
    })
    const lines = fieldLines(scene, { maxSegments: FIELD_LINES, maxHeads: FIELD_LINES * 2, radius: 0.045, head: 0.16, spacing: 0.9, margin: 0.3 })
    const lineAt = Array.from({ length: FIELD_LINES }, (_, i): [number, number] => [W + (halton(i + 7, 2) - 0.5) * (PLATE - 1), (halton(i + 7, 3) - 0.5) * (PLATE - 1)])

    const state = { charging: true, key: '', r: NaN, vc: 0, amps: 0, t: 0, since: 0, lines: -1, blade: 0 }
    const paint = (at: THREE.Vector3) => rcPotential(at.x, at.y, { h: H, xl: -W, ra: R_X - RS, rb: R_X + RS, charging: state.charging, vc: state.vc / VS })
    const chargeFlow = plusFlow(scene, lane([[W, -yTop, 0], [W, -H, 0], [-W, -H, 0], [-W, H, 0], CONTACT_A, PIVOT, [W, H, 0], [W, yTop, 0]]), paint)
    const dischargeFlow = plusFlow(scene, lane([[W, -yTop, 0], [W, -H, 0], [CONTACT_B[0], -H, 0], CONTACT_B, PIVOT, [W, H, 0], [W, yTop, 0]]), paint)

    const plot = scope(scene, SCOPE_W, SCOPE_H, { divs: [10, 4] })
    plot.group.position.set(-0.4, -1.3, -0.8)
    const vTrace = plot.trace(HIGH_V, { radius: 0.1 })
    const iTrace = plot.trace(CONVENTIONAL, { radius: 0.1 })
    const iLabel = pulseLabel(scene, 3, CONVENTIONAL, [R_X, H + 1.7, 0], 1.2)
    const vLabel = pulseLabel(scene, 3, HIGH_V, [W - 4.4, 3.7, 0], 1.3)

    type Segment = { t0: number; v0: number; target: number; tau: number }
    let segments: Segment[] = []
    const segmentAt = (t: number) => {
      let s = segments[0]
      for (const g of segments) if (g.t0 <= t) s = g
      return s
    }
    const vAt = (t: number) => {
      const s = segmentAt(t)
      return t <= s.t0 ? s.v0 : rcStep(s.v0, s.target, s.tau, t - s.t0)
    }
    return {
      scene,
      view: { center: [1.4, 2.4, 0], radius: 54, polar: 1.38, azimuth: 0.16 },
      frame(dt, p) {
        const s = solveCharging(p)
        const key = `${s.charging}${s.r}`
        if (key !== state.key) {
          if (!segments.length) state.vc = s.charging ? 0 : VS
          state.key = key
          state.since = 0
          segments.push({ t0: state.t, v0: state.vc, target: s.target, tau: s.tau })
          if (s.r !== state.r) swapResistor(holder, (state.r = s.r), [R_X - 1, H, 0], [R_X + 1, H, 0])
        }
        state.charging = s.charging
        state.t += dt
        state.since += dt
        state.vc = rcStep(state.vc, s.target, s.tau, dt)
        state.amps = (s.target - state.vc) / s.r
        segments = segments.filter((g, i) => i === segments.length - 1 || segments[i + 1].t0 > state.t - WINDOW)

        const fill = state.vc / VS
        state.blade += ((s.charging ? 0 : 1) - state.blade) * ease(dt, 8)
        blade.rotation.z = THROW * state.blade
        potentialColor(fill, plateMats[0].emissive)
        for (const t of tokens) t.count = Math.round(MAX_TOKENS * fill)
        const k = Math.round(FIELD_LINES * fill)
        if (k !== state.lines) {
          state.lines = k
          lines.set(lineAt.slice(0, k).map(([x, z]): V3[] => [[x, GAP / 2, z], [x, -GAP / 2, z]]))
        }
        lines.step(dt * 0.6)

        chargeFlow.mesh.visible = s.charging
        dischargeFlow.mesh.visible = !s.charging
        ;(s.charging ? chargeFlow : dischargeFlow).step(dt * AMP_SPEED * state.amps)
        vTrace.scroll((t) => (vAt(t) / VS) * PER_SCOPE, state.t, WINDOW)
        iTrace.scroll((t) => ((segmentAt(t).target - vAt(t)) / VS) * PER_SCOPE, state.t, WINDOW)
        iLabel.show(fitDigits(Math.abs(state.amps) * 1e6, 3))
        vLabel.show(fitDigits(state.vc, 3))
        iLabel.frame(dt)
        vLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveCharging(p)
        return [
          { label: 'Vc', value: volts(state.vc), tone: 'ok' },
          { label: 'Current I', value: si(Math.abs(state.amps), 'A', 3) },
          { label: 'τ = RC', value: secs(s.tau) },
          { label: 'Since switching', value: `${state.since.toFixed(1)} s = ${(state.since / s.tau).toFixed(1)}τ` },
        ]
      },
    }
  },
}

// --- RC time constant: whatever R and C, each τ closes 63 % of the gap; the scope's grid is in τ. ---

const PLAY = 1.2
const HOLD = 1.5
const TAUS = 5
const L_LEFT = -17
const L_RIGHT = -10
const LH = 4.5
const CAP_S = 1.2
const CAP_X = L_RIGHT + 1.5 * CAP_S
const LEAD_Y = 0.5 * CAP_S
const R2_X = -13.5
const S2_X = 7
const S2_W = 14
const S2_H = 7.5

const solveTau = (p: Params) => {
  const charging = p.mode !== 'discharge'
  const r = e12(p, 'r')
  const uf = n(p, 'c')
  const tau = rcTau(r, uf * 1e-6)
  return { charging, r, uf, tau }
}
const shape = (charging: boolean, taus: number) => (charging ? rcFraction(taus, 1) : 1 - rcFraction(taus, 1))
const playback = (tau: number) => (tau < PLAY ? `${fitDigits(PLAY / tau, 2)}× slower` : `${fitDigits(tau / PLAY, 2)}× faster`)

export const rcTimeConstant: Lesson = {
  id: 'capacitor-rc-time-constant',
  title: 'RC time constant',
  tagline: 'One number sets the pace',
  formula: (p) => {
    const s = solveTau(p)
    return `τ = R·C = ${ohms(s.r)} × ${s.uf} µF = ${secs(s.tau)} · Vc = ${s.charging ? 'V·(1 − e^(−t/τ))' : 'V·e^(−t/τ)'}`
  },
  legend: [
    { color: HIGH_V, label: 'Vc, % of 9 V', shape: 'dot' },
    { color: RING, label: 'Each τ: % reached', shape: 'dot' },
    { color: '#8a8f99', label: 'Grid in τ, counted below', shape: 'dot' },
  ],
  points: [
    'τ = R × C sets the pace of every RC circuit. Ohms × farads = seconds: 10 kΩ × 100 µF = 1 s.',
    'Each τ closes 63 % of the gap that is left: 63 % after 1τ, 86 % after 2τ, 95 % after 3τ, 99 % after 5τ. Engineers call 5τ “done”.',
    'Discharging is the mirror image: 37 % left after 1τ, 14 % after 2τ, under 1 % after 5τ. Half-way takes 0.69τ either way.',
    'Double R or C and τ doubles; the curve keeps its shape, only the time scale stretches. Here every τ plays in 1.2 s, whatever its real length; the readout says how much that is slowed or sped up.',
    'RC timing is everywhere: power-on reset delays, button debouncing, 555 timers, and low-pass filters that smooth out noise.',
  ],
  controls: [
    modeControl,
    rSlider(1000, 100000, 10000),
    {
      kind: 'choice',
      key: 'c',
      options: [
        { value: '10', label: '10 µF' },
        { value: '100', label: '100 µF' },
        { value: '1000', label: '1000 µF' },
      ],
      initial: '100',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    wire(scene, [[L_RIGHT, LEAD_Y, 0], [L_RIGHT, LH, 0], [L_LEFT, LH, 0], [L_LEFT, -LH, 0], [L_RIGHT, -LH, 0], [L_RIGHT, -LEAD_Y, 0]])
    const battery = add(scene, cell(CELL_H, 1.5), [L_LEFT, 0, 0])
    const holder = add(scene, new THREE.Group())
    const cap = add(scene, buildElectrolyticCap(), [CAP_X, 0, 0])
    cap.scale.setScalar(CAP_S)
    cap.rotation.z = -Math.PI / 2
    const vLabel = pulseLabel(scene, 3, HIGH_V, [CAP_X + 3, 3, 0], 1.2)

    const state = { key: '', r: NaN, u: 0, hold: 0, charging: true, frac: 0, show: 1 }
    const flow = plusFlow(
      scene,
      lane([[L_RIGHT, -LEAD_Y, 0], [L_RIGHT, -LH, 0], [L_LEFT, -LH, 0], [L_LEFT, LH, 0], [L_RIGHT, LH, 0], [L_RIGHT, LEAD_Y, 0]]),
      (at) => rcPotential(at.x, at.y, { h: LH, xl: L_LEFT, ra: R2_X - RS, rb: R2_X + RS, charging: state.charging, vc: state.frac }),
    )

    const plot = scope(scene, S2_W, S2_H, { divs: [TAUS, 4], zeroAt: 0 })
    plot.group.position.set(S2_X, 0, 0)
    const y = (f: number) => f * S2_H - S2_H / 2
    const ghost = plot.trace('#6a4448', { samples: 120, radius: 0.07 })
    const live = plot.trace(HIGH_V, { radius: 0.12 })
    const head = add(plot.group, mesh(new THREE.SphereGeometry(0.34, 16, 12), glowMat(HIGH_V, 1.2)))
    const level = plot.level(RING)
    const marks = Array.from({ length: TAUS }, (_, i) => {
      const k = i + 1
      const dot = add(plot.group, mesh(new THREE.SphereGeometry(0.24, 14, 10), glowMat(RING, 1)))
      const label = pulseLabel(plot.group, 2, RING, [0, 0, 0.4], 0.9)
      const digit = segmentDisplay(1, 0.9, '#8a8f99', true)
      digit.set(String(k))
      add(plot.group, digit.group, [plot.xAt(k / TAUS), -S2_H / 2 - 1.3, 0])
      return { k, dot, label }
    })

    return {
      scene,
      view: { center: [-1.6, 1.6, 0], radius: 57, polar: 1.4, azimuth: 0.12 },
      frame(dt, p) {
        const s = solveTau(p)
        const key = `${s.charging}${s.r}${s.uf}`
        if (key !== state.key) {
          if (s.charging !== state.charging || !state.key) {
            ghost.draw((u) => y(shape(s.charging, u * TAUS)), null)
            level.set(y(shape(s.charging, 1)))
            for (const m of marks) {
              const f = shape(s.charging, m.k)
              m.dot.position.set(plot.xAt(m.k / TAUS), y(f), 0.35)
              m.label.display.group.position.set(plot.xAt(m.k / TAUS) + 0.7, y(f) + (s.charging ? -1.1 : 1.1), 0.4)
              m.label.show(String(Math.round(f * 100)))
            }
          }
          if (s.r !== state.r) swapResistor(holder, (state.r = s.r), [R2_X - 1, LH, 0], [R2_X + 1, LH, 0])
          state.key = key
          state.charging = s.charging
          state.u = 0
          state.hold = 0
        }
        if (state.u < TAUS) state.u = Math.min(TAUS, state.u + dt / PLAY)
        else if ((state.hold += dt) > HOLD) {
          state.u = 0
          state.hold = 0
        }
        const u = state.u
        state.frac = shape(s.charging, u)
        const h = Math.max(0.002, u / TAUS)
        live.group.scale.x = h
        live.group.position.x = (-S2_W / 2) * (1 - h)
        live.draw((v) => y(shape(s.charging, v * u)), null)
        head.position.set(plot.xAt(h), y(state.frac), 0.35)
        for (const m of marks) {
          const on = u >= m.k - 1e-6
          m.dot.visible = on
          m.label.display.group.visible = on
          m.label.frame(dt)
        }

        state.show += ((s.charging ? 1 : 0) - state.show) * ease(dt, 8)
        presence(battery, state.show)
        const rate = s.charging ? 1 - state.frac : -state.frac
        flow.step((dt * 5 * rate) / PLAY)
        vLabel.show(fitDigits(state.frac * VS, 3))
        vLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveTau(p)
        return [
          { label: 'τ = RC', value: secs(s.tau), tone: 'ok' },
          { label: 'Time t', value: secs(state.u * s.tau) },
          { label: 'Vc', value: volts(state.frac * VS) },
          { label: 'Shown', value: playback(s.tau) },
        ]
      },
    }
  },
}

// --- Decoupling: a chip's current spikes sag its supply pin unless a nearby capacitor supplies them. ---

const V_CHIP = 3.3
const R_PATH = 5
const PERIOD = 100e-9
const SPIKE_S = 10e-9
const IDLE_A = 5e-3
const V_LOGIC = 3.0
const SLOW = 1e7
const SUB = 0.5e-9
const D_WINDOW = 3 * PERIOD
const RING_N = Math.round(D_WINDOW / SUB) + 4
const DECOUPLERS: Record<string, { farads: number; scale: number }> = {
  none: { farads: 0, scale: 0 },
  '1n': { farads: 1e-9, scale: 1.1 },
  '10n': { farads: 10e-9, scale: 1.4 },
  '100n': { farads: 100e-9, scale: 1.8 },
}
const CELL_X = -16
const CHIP_X = 10
const CHIP_W = 5
const CHIP_H = 7.5
const RAIL = CHIP_H / 2 - CHIP_H / 8
const PIN_X = CHIP_X - CHIP_W / 2 - 0.85
const DCAP_X = 3.5
const COIL_X = -6
const D_SCOPE_Y = -8.6
const D_SCOPE_W = 24
const D_SCOPE_H = 6
const V_BOTTOM = 2.1
const V_SPAN = 1.4
const DRAW_SPEED = 300

const chipLoad = (t: number, spike: number) => (t % PERIOD < SPIKE_S ? spike : 0) + IDLE_A
const solveDecouple = (p: Params) => {
  const cap = (p.cap as string) in DECOUPLERS ? (p.cap as string) : '100n'
  const { farads } = DECOUPLERS[cap]
  const spike = n(p, 'spike') / 1000
  return { cap, farads, spike, dip: V_CHIP - decoupleStep(V_CHIP, V_CHIP, R_PATH, farads, spike, SPIKE_S) }
}

export const decoupling: Lesson = {
  id: 'capacitor-decoupling',
  title: 'Decoupling',
  tagline: 'A local tank for every chip',
  formula: (p) => {
    const s = solveDecouple(p)
    const i = si(s.spike, 'A', 3)
    return s.farads
      ? `ΔV = I·R·(1 − e^(−Δt/RC)) = ${i} × 5 Ω × (1 − e^(−10 ns / ${secs(R_PATH * s.farads)})) = ${si(s.dip, 'V', 2)}`
      : `No capacitor: ΔV = I·R = ${i} × 5 Ω = ${si(s.dip, 'V', 3)}`
  },
  legend: [
    { color: HIGH_V, label: 'Chip pin voltage; lowest, V', shape: 'dot' },
    { color: RING, label: '3.0 V: below it logic glitches', shape: 'dot' },
    { color: CONVENTIONAL, label: 'Charges, by potential', shape: 'dot' },
  ],
  points: [
    'A chip draws current in sharp spikes: at every clock edge millions of transistors switch at once. Here 100 mA for 10 ns, ten million times a second. Time is slowed 10,000,000×.',
    'The supply is far away, and at these speeds its long wires act like about 5 Ω (mostly their inductance, the coil). With nothing nearby each spike pulls the pin down by I·R = 0.5 V, below the 3.0 V a 3.3 V chip needs.',
    'A decoupling capacitor right at the pin is a local tank: it hands out each spike’s charge at once and refills from the supply between spikes. Its dip is about I·Δt / C: 10 mV for 100 nF.',
    'Too small (1 nF) and it runs dry within the spike. 100 nF ceramic is the standard, one per power pin and as close as it fits, so its own leads add little inductance.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'cap',
      options: [
        { value: 'none', label: 'None' },
        { value: '1n', label: '1 nF' },
        { value: '10n', label: '10 nF' },
        { value: '100n', label: '100 nF' },
      ],
      initial: 'none',
    },
    { kind: 'slider', key: 'spike', label: 'Spike current', min: 20, max: 200, initial: 100, step: 10, format: (v) => `${v} mA` },
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    add(scene, cell(CELL_H, 1.5), [CELL_X, 0, 0])
    const coilLen = 3.4
    const choke = coil(scene, { radius: 0.6, length: coilLen, turns: 6, thickness: 0.16 })
    choke.group.position.set(COIL_X, RAIL - 0.6, 0)
    wire(scene, [[CELL_X, -RAIL, 0], [CELL_X, RAIL, 0], [COIL_X - coilLen / 2, RAIL, 0]])
    wire(scene, [[COIL_X + coilLen / 2, RAIL, 0], [PIN_X, RAIL, 0]])
    wire(scene, [[CELL_X, -RAIL, 0], [PIN_X, -RAIL, 0]])
    const chip = add(scene, icPackage(CHIP_W, CHIP_H, 4), [CHIP_X, 0, 0])
    const coreMat = new THREE.MeshStandardMaterial({ color: '#2a2c32', emissive: '#ffb347', emissiveIntensity: 0, roughness: 0.5 })
    box(chip, [2.6, 2.6, 0.1], coreMat, [0, 0.4, 0.62])
    const okMat = glowMat('#5ce1a0', 1.2)
    add(chip, mesh(new THREE.SphereGeometry(0.32, 16, 12), okMat), [0, -2.6, 0.7])
    const holder = add(scene, new THREE.Group())
    const dots = [RAIL, -RAIL].map((yy) => add(scene, mesh(new THREE.SphereGeometry(0.4, 14, 10), mat('#c8803f', { metal: 0.35, rough: 0.4 })), [DCAP_X, yy, 0]))

    const state = { key: '', cap: '', t: 0, v: V_CHIP, load: IDLE_A, minV: V_CHIP }
    const ring = new Float32Array(RING_N)
    const slot = (t: number) => ((Math.floor(t / SUB) % RING_N) + RING_N) % RING_N
    const pinF = () => state.v / V_CHIP
    const supplyFlow = plusFlow(
      scene,
      lane([[CELL_X, -RAIL, 0], [CELL_X, RAIL, 0], [PIN_X, RAIL, 0], [PIN_X, -RAIL, 0]]),
      (at) => {
        if (at.y <= -RAIL + 0.01) return 0
        if (at.x <= CELL_X + 0.01) return cellFraction(at.y)
        if (at.x >= PIN_X - 0.01) return pinF() * clamp01((at.y + RAIL) / (2 * RAIL))
        return lerp(1, pinF(), (at.x - CELL_X) / (PIN_X - CELL_X))
      },
      true,
    )
    const capFlow = plusFlow(
      scene,
      lane([[DCAP_X, 1.2, 0], [DCAP_X, RAIL, 0], [PIN_X, RAIL, 0], [PIN_X, -RAIL, 0], [DCAP_X, -RAIL, 0], [DCAP_X, -1.2, 0]], LANE + 0.7),
      (at) => (at.x >= PIN_X - 0.01 ? pinF() * clamp01((at.y + RAIL) / (2 * RAIL)) : at.y > 0 ? pinF() : 0),
    )

    const plot = scope(scene, D_SCOPE_W, D_SCOPE_H, { divs: [12, 7], zeroAt: (V_CHIP - V_BOTTOM) / V_SPAN })
    plot.group.position.set(0, D_SCOPE_Y, 0)
    const vy = (v: number) => ((v - V_BOTTOM) / V_SPAN - 0.5) * D_SCOPE_H
    const trace = plot.trace(HIGH_V, { samples: 240, radius: 0.11 })
    plot.level(RING).set(vy(V_LOGIC))
    pulseLabel(scene, 2, RING, [-D_SCOPE_W / 2 - 2, D_SCOPE_Y + vy(V_LOGIC), 0], 1).show('3.0')
    const vLabel = pulseLabel(scene, 3, HIGH_V, [CHIP_X, CHIP_H / 2 + 1.6, 0], 1.3)

    return {
      scene,
      view: { center: [-2.2, -0.8, 0], radius: 57, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const s = solveDecouple(p)
        const key = `${s.cap}${s.spike}`
        if (key !== state.key) {
          const avg = IDLE_A + (s.farads ? (s.spike * SPIKE_S) / PERIOD : 0)
          if (s.cap !== state.cap) {
            state.cap = s.cap
            emptyGroup(holder)
            const { scale } = DECOUPLERS[s.cap]
            if (scale) ceramicAlong(holder, [DCAP_X, -RAIL, 0], [DCAP_X, RAIL, 0], scale)
          }
          state.key = key
          state.t = 0
          state.v = V_CHIP - avg * R_PATH
          ring.fill(state.v)
        }
        const h = dt / SLOW
        const steps = Math.max(1, Math.ceil(h / SUB))
        for (let k = 0; k < steps; k++) {
          state.t += h / steps
          state.load = chipLoad(state.t, s.spike)
          state.v = decoupleStep(state.v, V_CHIP, R_PATH, s.farads, state.load, h / steps)
          ring[slot(state.t)] = state.v
        }
        state.minV = ring.reduce((a, b) => Math.min(a, b), Infinity)

        const supplyA = (V_CHIP - state.v) / R_PATH
        supplyFlow.step(dt * DRAW_SPEED * supplyA)
        capFlow.step(dt * DRAW_SPEED * (state.load - supplyA))
        capFlow.mesh.visible = s.farads > 0
        for (const d of dots) d.visible = s.farads > 0
        coreMat.emissiveIntensity = 0.15 + (1.6 * (state.load - IDLE_A)) / 0.2
        okMat.color.set(state.minV >= V_LOGIC ? '#5ce1a0' : HIGH_V)
        okMat.emissive.copy(okMat.color)
        trace.scroll((t) => vy(ring[slot(t)]), state.t, D_WINDOW)
        vLabel.show(fitDigits(state.minV, 3))
        vLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveDecouple(p)
        const ok = state.minV >= V_LOGIC
        return [
          { label: 'Lowest at pin', value: volts(state.minV), tone: ok ? 'ok' : 'bad' },
          { label: 'Dip per spike', value: si(s.dip, 'V', 2) },
          { label: 'Logic', value: ok ? 'Clean' : 'Glitches', tone: ok ? 'ok' : 'bad' },
          { label: 'Sim time', value: si(state.t, 's', 3) },
        ]
      },
    }
  },
}

// --- Electrolytic vs ceramic: the same 9 V, a thousand times the charge, and only one of them cares which way round. ---

const E_FARADS = 100e-6
const E_RATED = 16
const C_FARADS = 100e-9
const V_MAX = 25
const PART_S = 2
const E_X = -6.5
const C_X = 6.5
const TRACE_Z = 4.5
const CAN_R = 1.24
const CAN_H = 4.3
const CAN_Y0 = 0.4
const DISC_Y = 2.2
const ANODE = '#e3e7ee'
const CATHODE = '#9aa0aa'
const PAPER = '#b98f4e'

const solveParts = (p: Params) => {
  const v = n(p, 'v')
  const reversed = p.pol === 'reversed'
  const abused = reversed ? v > 1 : v > E_RATED
  return {
    v,
    reversed,
    inside: p.view === 'inside',
    qe: capacitorCharge(E_FARADS, v),
    qc: capacitorCharge(C_FARADS, v),
    ue: capacitorEnergy(E_FARADS, v),
    uc: capacitorEnergy(C_FARADS, v),
    leak: electrolyticLeakage(E_FARADS, v),
    abused,
    heat: abused ? (reversed ? clamp01((v - 1) / 6) : clamp01(0.4 + (v - E_RATED) / 9)) : 0,
  }
}

/** Half-shell (the back half, open towards +z) of radius `r`, height `h`, centred at `y`. */
function halfShell(parent: THREE.Object3D, r: number, h: number, y: number, material: THREE.Material) {
  const m = add(parent, mesh(new THREE.CylinderGeometry(r, r, h, 32, 1, true, Math.PI / 2, Math.PI), material), [0, y, 0])
  m.castShadow = false
  return m
}
const doubleSided = (color: string, emissive = '#000000') => new THREE.MeshStandardMaterial({ color, emissive, roughness: 0.45, side: THREE.DoubleSide })

export const electrolyticVsCeramic: Lesson = {
  id: 'capacitor-electrolytic-vs-ceramic',
  title: 'Electrolytic vs ceramic',
  tagline: 'Big and polarised, or small and fast',
  formula: (p) => {
    const s = solveParts(p)
    return `Q = C·V: 100 µF × ${volts(s.v)} = ${si(s.qe, 'C', 3)} vs 100 nF × ${volts(s.v)} = ${si(s.qc, 'C', 3)} · U = ½CV² = ${si(s.ue, 'J', 3)} vs ${si(s.uc, 'J', 3)}`
  },
  legend: [
    { color: HIGH_V, label: '+ side: pads, plates', shape: 'dot' },
    { color: LOW_V, label: '− side', shape: 'dot' },
    { color: RING, label: 'Charge Q, µC', shape: 'dot' },
    { color: '#ff8a1e', label: 'Heat when abused', shape: 'dot' },
  ],
  points: [
    'Electrolytic: two aluminium foils rolled up with electrolyte-soaked paper. The dielectric is an oxide film only nanometres thick, grown on the + foil, which packs µF to mF into a small can.',
    'It is polarised: the stripe marks the − leg (the shorter one), and boards print a + by the other hole. Reversed, the oxide breaks down, current flows, the can heats and the scored top vents. Going over its rating (16 V here) ends the same way.',
    'Ceramic: thin ceramic layers between interleaved metal plates (a surface-mount MLCC stacks hundreds). No polarity, pF to tens of µF, and very low resistance and inductance, so it reacts in nanoseconds.',
    'At the same voltage the 100 µF electrolytic holds 1000× the charge of the 100 nF ceramic: Q = CV. Electrolytics also leak, rated at 0.01·C·V (9 µA at 9 V); ceramics barely do.',
    'So boards use both: an electrolytic for bulk storage at the power input, a 100 nF ceramic at every chip. Pick electrolytics rated well above the voltage they will see.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'view',
      options: [
        { value: 'outside', label: 'Outside' },
        { value: 'inside', label: 'Inside' },
      ],
      initial: 'outside',
    },
    {
      kind: 'choice',
      key: 'pol',
      options: [
        { value: 'correct', label: 'Stripe to −' },
        { value: 'reversed', label: 'Reversed' },
      ],
      initial: 'correct',
    },
    { kind: 'slider', key: 'v', label: 'Voltage', min: 0, max: V_MAX, initial: 9, step: 0.5, format: volts },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    box(scene, [30, 0.6, 11], mat('#1f5a3a', { rough: 0.6 }), [0, -0.31, 0])
    const silk = mat('#eef0f4', { emissive: '#555555' })
    const pads = [E_X - PART_S * 0.5, E_X + PART_S * 0.5, C_X - PART_S, C_X + PART_S].map((x) => {
      const m = glowMat(HIGH_V, 0.5)
      cylinder(scene, 0.6, 0.06, m, [x, 0.03, 0], 'y', 24)
      box(scene, [0.5, 0.06, TRACE_Z], m, [x, 0.03, TRACE_Z / 2])
      add(scene, mesh(new THREE.SphereGeometry(0.55, 18, 12), m), [x, 0.4, TRACE_Z])
      return m
    })
    add(scene, mesh(plusGeometry(1.1), silk), [E_X - PART_S * 0.5 - 1.4, 0.05, TRACE_Z - 1.2]).rotation.x = -Math.PI / 2

    const eOut = add(scene, buildElectrolyticCap(), [E_X, 0, 0])
    const cOut = add(scene, buildCeramicCap(), [C_X, 0, 0])

    const eIn = add(scene, new THREE.Group(), [E_X, 0, 0])
    halfShell(eIn, CAN_R, CAN_H, CAN_Y0 + CAN_H / 2, doubleSided('#1e2f6e'))
    cylinder(eIn, CAN_R - 0.1, 0.25, BLACK_PLASTIC(), [0, CAN_Y0 + 0.1, 0], 'y', 24)
    const anodeMat = doubleSided(ANODE, HIGH_V)
    const cathodeMat = doubleSided(CATHODE, LOW_V)
    const paperMat = doubleSided(PAPER)
    for (let i = 0; i < 9; i++) {
      const material = i % 2 ? paperMat : i % 4 === 0 ? anodeMat : cathodeMat
      const r = 0.25 + i * 0.105
      halfShell(eIn, r, CAN_H - 0.5, CAN_Y0 + CAN_H / 2 + 0.05, material)
      add(eIn, mesh(new THREE.RingGeometry(r - 0.05, r + 0.05, 32, 1, 0, Math.PI), material), [0, CAN_Y0 + CAN_H - 0.2, 0]).rotation.x = -Math.PI / 2
    }
    for (const s of [-1, 1]) rod(eIn, [s * 0.5, CAN_Y0, 0], [s * 0.5, -1.5, 0], 0.1, STEEL())

    const cIn = add(scene, new THREE.Group(), [C_X, 0, 0])
    const shellMat = new THREE.MeshStandardMaterial({ color: '#d9912b', transparent: true, opacity: 0.28, roughness: 0.4, depthWrite: false })
    const shell = add(cIn, mesh(new THREE.SphereGeometry(1, 28, 18), shellMat), [0, DISC_Y, 0])
    shell.scale.set(0.95, 0.95, 0.32)
    shell.castShadow = false
    const plateMats = [glowMat(HIGH_V, 0.6), glowMat(LOW_V, 0.6)]
    for (const s of [-1, 1]) box(cIn, [0.1, 1.15, 0.24], STEEL(), [s * 0.62, DISC_Y, 0])
    for (let i = 0; i < 7; i++) box(cIn, [0.95, 0.045, 0.22], plateMats[i % 2], [i % 2 ? 0.1 : -0.1, DISC_Y + (i - 3) * 0.15, 0])
    for (const s of [-1, 1]) lead(cIn, [[s * 0.62, DISC_Y - 0.5, 0], [s * 0.62, 1.4, 0], [s * 1, 0.6, 0], [s * 1, -1.5, 0]], 0.11)

    const top = (CAN_Y0 + CAN_H) * PART_S
    const glowMatE = new THREE.MeshStandardMaterial({ color: '#ff6a1e', emissive: '#ff6a1e', emissiveIntensity: 1, transparent: true, opacity: 0, depthWrite: false })
    const glow = add(scene, mesh(new THREE.CylinderGeometry(CAN_R * PART_S + 0.12, CAN_R * PART_S + 0.12, CAN_H * PART_S, 32, 1, true), glowMatE), [E_X, top - (CAN_H * PART_S) / 2, 0])
    glow.castShadow = false
    const dome = add(scene, mesh(new THREE.SphereGeometry((CAN_R - 0.08) * PART_S, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), STEEL()), [E_X, top, 0])
    const fumes = smoke(scene, 1.6, { count: 20, rise: 8 })
    fumes.group.position.set(E_X, top + 0.6, 0)
    const waves = heatWaves(scene, 3.2, { count: 4, rise: 5 })
    waves.group.position.set(E_X, top + 0.4, 0)

    const qLabels = [[E_X - 5.6, 6.5], [C_X + 5.4, 4.6]].map(([x, y]) => pulseLabel(scene, 4, RING, [x, y, 0], 1.3))
    const c = new THREE.Color()
    const shown = { v: 9, inside: 0, heat: 0 }
    return {
      scene,
      view: { center: [0, 6.4, 1], radius: 48, polar: 1.25, azimuth: 0.15 },
      frame(dt, p) {
        const s = solveParts(p)
        shown.v += (s.v - shown.v) * ease(dt)
        shown.inside += ((s.inside ? 1 : 0) - shown.inside) * ease(dt, 7)
        shown.heat += (s.heat - shown.heat) * ease(dt, s.heat > shown.heat ? 0.9 : 2)
        presence(eOut, 1 - shown.inside)
        presence(cOut, 1 - shown.inside)
        presence(eIn, shown.inside * PART_S)
        presence(cIn, shown.inside * PART_S)
        eOut.scale.multiplyScalar(PART_S)
        cOut.scale.multiplyScalar(PART_S)

        const swing = 0.5 * clamp01(shown.v / 5)
        const hi = 0.5 + swing
        const lo = 0.5 - swing
        const eSides = s.reversed ? [lo, hi] : [hi, lo]
        ;[...eSides, hi, lo].forEach((f, k) => {
          potentialColor(f, c)
          pads[k].color.copy(c)
          pads[k].emissive.copy(c)
        })
        potentialColor(eSides[0], anodeMat.emissive)
        potentialColor(eSides[1], cathodeMat.emissive)
        anodeMat.emissiveIntensity = cathodeMat.emissiveIntensity = 0.15 + 0.5 * swing
        potentialColor(hi, plateMats[0].emissive)
        potentialColor(lo, plateMats[1].emissive)
        plateMats[0].color.copy(plateMats[0].emissive)
        plateMats[1].color.copy(plateMats[1].emissive)

        glowMatE.opacity = 0.28 * shown.heat * (1 - 0.7 * shown.inside)
        glow.visible = shown.heat > 0.01
        dome.visible = shown.heat > 0.05
        dome.scale.y = 0.05 + 0.45 * shown.heat
        fumes.step(dt, shown.heat > 0.6 ? shown.heat : 0)
        waves.step(dt, shown.heat)

        qLabels[0].show(fitDigits(capacitorCharge(E_FARADS, s.v) * 1e6, 3))
        qLabels[1].show(fitDigits(capacitorCharge(C_FARADS, s.v) * 1e6, 4))
        for (const l of qLabels) l.frame(dt)
      },
      readouts: (p) => {
        const s = solveParts(p)
        const status = s.abused ? (s.reversed ? 'Reversed' : `Over ${E_RATED} V`) : s.v > 0.8 * E_RATED ? 'Near rating' : 'OK'
        return [
          { label: 'Electrolytic Q', value: si(s.qe, 'C', 3) },
          { label: 'Ceramic Q', value: si(s.qc, 'C', 3) },
          { label: 'Leakage', value: s.abused ? 'Amps!' : si(s.leak, 'A', 2), tone: s.abused ? 'bad' : undefined },
          { label: 'Electrolytic is', value: status, tone: s.abused ? 'bad' : s.v > 0.8 * E_RATED ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
