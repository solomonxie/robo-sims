import * as THREE from 'three/webgpu'
import { MAST, ODE_METHODS, OdeSystem, SPIN, SWING, SYSTEMS, eulerView, exactFrom, fieldGrid, freeAt, stepSizeView, swingW } from '../../core/physics'
import { cmText, fixedText, msText, secsText, signed } from '../../core/units'
import { V3, add, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  addLabel,
  dotLine,
  flatBox,
  glowMat,
  lapseClock,
  liveLabel,
  memoBy,
  plotY,
  rodPool,
  speedWheel,
  springRig,
  statusHeader,
  textRows,
  titledScope,
  vecArrow,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const VIEW = { center: [-1.2, -1, 0] as V3, radius: 56, polar: 1.45, azimuth: 0 }
const LEFT = { x: -9, w: 15, top: -1.2, topH: 6.6, low: -10.3, lowH: 6.6 }
const RIGHT = { x: 8.6, w: 12.4, y: -10.3, h: 6.6 }
const RPM = 60 / (2 * Math.PI)
const dot = (g: THREE.Object3D, r: number, c: string) => add(g, mesh(new THREE.SphereGeometry(r, 16, 12), glowMat(c, 1.2)))
const liveTitle = (scene: THREE.Object3D, y: number, h: number, x = LEFT.x, w = LEFT.w) => liveLabel(scene, [x - w / 2, y + h / 2 + 1.1, 0.3], { size: 0.3, align: 'left' })
const scopeAt = (scene: THREE.Object3D, y: number, h: number, zero: number, x = LEFT.x, w = LEFT.w) => titledScope(scene, y, h, '', LABEL, zero, x, w)
const rate = (w: number) => `${fixedText(w, 1)} rad/s`

/** Two hanging masses side by side: exact (left) and stepped (right); `set(xExact, xStep, …)` in metres, 1 cm = 0.6 units. */
function twinRigs(scene: THREE.Object3D, at: V3, gap: number) {
  const group = add(scene, new THREE.Group(), at)
  const rest = -4.2
  const rigs = [0, 1].map((i) => springRig(group, [i * gap, 0, 0]))
  const tags = [0, 1].map((i) => liveLabel(group, [i * gap, rest - 4, 0.3], { size: 0.32 }))
  for (const i of [0, 1]) flatBox(group, [4, 0.06, 0.06], glowMat(GREY, 0.5), [i * gap, rest - 0.53, 1.8])
  addLabel(group, 'rest', [-2.2, rest - 0.53, 1.8], GREY, 0.24, 'right')
  const clampY = (x: number) => rest + Math.max(-2.2, Math.min(2.2, x * 60))
  return {
    group,
    set(xe: number, xs: number, names: [string, string], colors: [string, string]) {
      rigs[0].set(clampY(xe), 0.4)
      rigs[1].set(clampY(xs), 0.4)
      tags[0].set(names[0], colors[0])
      tags[1].set(names[1], colors[1])
    },
  }
}

// --- Euler integration: the rule gives the slope; step along it, then ask again. ---

const EI = { wLo: -3, wHi: 36, eLo: -1, eHi: 7, Ehi: 4, span: 3, vSpan: 1.32 }
const eiRun = memoBy(
  (p: Params) => `${p.system} ${p.dt}`,
  (p: Params) => {
    const sys = pick(SYSTEMS, p.system, 'motor')
    return { sys, V: eulerView(sys, n(p, 'dt') / 1000) }
  },
)
const eiClocks = { motor: lapseClock(SPIN.T, 0.5, 0.6), spring: lapseClock(SWING.T, 0.5, 0.8) }

/** Main-plot coordinates (scene units from the plot centre) of state y at time t. */
function plotXY(sys: OdeSystem, t: number, y: readonly number[]): [number, number] {
  if (sys === 'motor') return [(t / SPIN.T - 0.5) * LEFT.w, plotY(EI.wLo, EI.wHi, LEFT.topH)(y[0])]
  return [(y[0] / (EI.span * SWING.x0)) * (LEFT.w / 2), (y[1] / (EI.vSpan * SWING.x0 * swingW)) * (LEFT.topH / 2)]
}
const inBox = ([x, y]: [number, number]) => Math.abs(x) <= LEFT.w / 2 && Math.abs(y) <= LEFT.topH / 2

export const differentialEquationsEulerIntegration: Lesson = {
  id: 'differential-equations-euler-integration',
  title: 'Euler integration',
  tagline: 'The equation only says how fast things change: step along that slope, then ask again',
  formula: (p) => {
    const { sys, V } = eiRun(p)
    const N = V.ts.length - 1
    return sys === 'motor'
      ? `J·dω/dt = τ − b·ω → ω(t + Δt) ≈ ω + Δt·(τ − b·ω)/J · Δt = ${msText(V.h)}, ${N} steps → ω = ${rate(V.ys[N][0])} vs exact ${rate(V.exact[N][0])} · biggest error ${rate(V.maxErr)} ∝ Δt`
      : `x′ = v, v′ = −k·x/m → x += Δt·v, v += Δt·(−k·x/m) (both from the old state) · each step multiplies energy by 1 + (ω·Δt)² = ${fixedText(V.growth ** 2, 4)} → after ${N} steps ×${fixedText(V.energy[N], 2)} · exact: energy constant`
  },
  legend: [
    { color: GREY, label: 'Slope field: the rule’s arrow at every state', shape: 'arrow-right' },
    { color: LABEL, label: 'Exact solution', shape: 'dot' },
    { color: RING, label: 'Euler steps', shape: 'dot' },
    { color: HEAT, label: 'This step: Δt along the arrow', shape: 'arrow-right' },
  ],
  points: [
    'A differential equation is a rule for how fast the state changes, given the state: rate = f(state). A motor with a wheel on it: J·dω/dt = τ − b·ω. The torque speeds it up, friction slows it more the faster it spins. It never says what ω is at 0.5 s; only how steep the curve is wherever you stand. Drawn at every point, those slopes are the grey arrow field.',
    'Euler’s method walks the field: read the slope where you are, go a step Δt along it in a straight line, read the slope again. In code that is one line per loop, ω += Δt·f(ω). If the rate did not depend on the state this is just the left-rectangle sum from Calculus › Numerical integration; here every step changes the slope used by the next one.',
    'The curve bends while the step goes straight, so each step lands a little off (bottom right, zoomed); the next step starts from the wrong place and the misses pile up. Halve Δt and the error halves: Euler is first order. On the motor the steps overshoot because the slope at the start of each step is the steepest it will be.',
    'Two states work the same way: a spring-mass has x′ = v and v′ = −k·x/m (Mechanics › Oscillations › Spring-mass). The arrows in the x–v phase plane go round in circles, and the true motion is a circle: energy stays put. Every Euler step leaves along the tangent, which points outside the circle, so the path spirals outward and energy grows by 1 + (ω·Δt)² per step, even though nothing is pushing it.',
    'This is how a physics sim, a robot model in a Kalman filter or an MPC predictor moves time forward. Euler is fine for slow, damped things with small steps; for springs and contacts there are better rules and a hard limit on Δt: Step size, Software › Simulation › Physics engine.',
  ],
  controls: [
    { kind: 'choice', key: 'system', options: opts(SYSTEMS), initial: 'motor' },
    { kind: 'slider', key: 'dt', label: 'Step Δt', min: 5, max: 200, step: 5, initial: 100, format: (v) => `${v} ms` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const pt = scopeAt(scene, LEFT.top, LEFT.topH, 0.5)
    const ptTitle = liveTitle(scene, LEFT.top, LEFT.topH)
    const field = rodPool(pt.s.group, 84, { heads: true })
    const trExact = pt.s.trace(LABEL, { samples: 161, radius: 0.05 })
    const trEuler = pt.s.trace(RING, { samples: 241, radius: 0.07 })
    const stepArrow = vecArrow(pt.s.group, HEAT, 0.07, 0.3)
    const freeLine = pt.s.level(B_FIELD)
    const pb = scopeAt(scene, LEFT.low, LEFT.lowH, 0)
    const pbTitle = liveTitle(scene, LEFT.low, LEFT.lowH)
    const trBad = pb.s.trace(HIGH_V, { samples: 241, radius: 0.06 })
    const trFlat = pb.s.trace(LABEL, { samples: 2, radius: 0.04 })
    const pz = titledScope(scene, RIGHT.y, RIGHT.h, 'one step, zoomed', LABEL, 0.5, RIGHT.x, RIGHT.w)
    const trLocal = pz.s.trace(LABEL, { samples: 40, radius: 0.06 })
    const zArrow = vecArrow(pz.s.group, HEAT, 0.08, 0.32)
    const zMiss = dotLine(pz.s.group, 0.07, 30)
    const zDots = [dot(pz.s.group, 0.2, RING), dot(pz.s.group, 0.2, HEAT), dot(pz.s.group, 0.2, LABEL)]

    const wheel = speedWheel(scene, [4.2, 2.4, 0], 2.6, 300)
    const rigs = twinRigs(scene, [4.4, 5.6, 0], 6.2)
    const rows = textRows(scene, 3, 1.6, -3.4, 0.32, 0.75)
    const st = { rev: 0, last: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const { sys, V } = eiRun(p)
        const motor = sys === 'motor'
        const now = eiClocks[sys](dt, `${sys} ${V.h}`)
        const N = V.ts.length - 1
        const k = Math.min(N, Math.floor(now / V.h + 1e-9))
        const P = V.ys.map((y, i) => plotXY(sys, V.ts[i], y))
        const out = P.findIndex((q) => !inBox(q))
        const kk = out < 0 ? k : Math.min(k, out - 1)
        const W = LEFT.w
        const U = (x: number) => x / W + 0.5

        const ax = motor ? [0, SPIN.T] : [-EI.span * SWING.x0, EI.span * SWING.x0]
        const ay = motor ? [0, 34] : [-EI.vSpan * SWING.x0 * swingW, EI.vSpan * SWING.x0 * swingW]
        const cells = fieldGrid(ax as [number, number], ay as [number, number], motor ? 12 : 14, motor ? 6 : 6, (a, b) => {
          if (motor) return [W / SPIN.T, V.f(0, [b])[0] * (LEFT.topH / (EI.wHi - EI.wLo))]
          const r = V.f(0, [a, b])
          return [r[0] * (W / 2 / (EI.span * SWING.x0)), r[1] * (LEFT.topH / 2 / (EI.vSpan * SWING.x0 * swingW))]
        })
        cells.forEach((c, i) => {
          const [X, Y] = motor ? plotXY(sys, c.at[0], [c.at[1]]) : plotXY(sys, 0, c.at)
          const len = Math.hypot(...c.d) || 1
          const [dx, dy] = [(c.d[0] / len) * 0.36, (c.d[1] / len) * 0.36]
          field.set(i, [X - dx, Y - dy, 0.12], [X + dx, Y + dy, 0.12], 0.025, '#5d636e')
        })
        field.hideFrom(cells.length)
        field.commit()

        if (motor) trExact.draw((u) => plotXY(sys, u * SPIN.T, exactFrom(sys, [0], u * SPIN.T))[1], null)
        else {
          const ring = Array.from({ length: 161 }, (_, i) => plotXY(sys, 0, exactFrom(sys, [SWING.x0, 0], (i / 160) * (2 * Math.PI) / swingW)))
          trExact.points(ring.map((q) => U(q[0])), ring.map((q) => q[1]), null)
        }
        trEuler.points(P.slice(0, kk + 1).map((q) => U(q[0])), P.slice(0, kk + 1).map((q) => q[1]))
        freeLine.set(motor ? plotY(EI.wLo, EI.wHi, LEFT.topH)(SPIN.torque / SPIN.b) : 99)
        const stepOn = kk < N && kk === k
        const [A, B] = [P[kk], P[Math.min(N, kk + 1)]]
        stepArrow([A[0], A[1], 0.35], stepOn && inBox(B) ? [B[0], B[1], 0.35] : [A[0], A[1], 0.35], '')
        ptTitle.set(motor ? 'speed ω (rad/s) vs time + slope field' : 'phase plane: x across, v up', LABEL)
        pt.right.set(motor ? `free ${rate(SPIN.torque / SPIN.b)}` : 'exact: a circle', motor ? B_FIELD : LABEL)
        pt.lo.set(motor ? '0 s' : `x ${cmText(ax[0])}`)
        pt.hi.set(motor ? `${SPIN.T} s` : `${cmText(ax[1])}`)

        const T = V.T
        const yb = motor ? plotY(EI.eLo, EI.eHi, LEFT.lowH) : plotY(0, EI.Ehi, LEFT.lowH)
        const bad = motor ? V.errs : V.energy
        trBad.points(V.ts.slice(0, k + 1).map((t) => t / T), bad.slice(0, k + 1).map(yb))
        trFlat.points([0, 1], [yb(motor ? 0 : 1), yb(motor ? 0 : 1)], null)
        pbTitle.set(motor ? 'error: Euler ω minus exact (rad/s)' : 'energy E/E0: exact stays at 1', HIGH_V)
        pb.right.set(motor ? `${signed(bad[k], 2)} rad/s` : `×${fixedText(bad[k], 2)}`, HIGH_V)
        pb.lo.set('0 s')
        pb.hi.set(`${T} s`)

        const s = V.steps[Math.min(kk, N - 1)]
        const y0 = s.y
        const t0 = V.ts[Math.min(kk, N - 1)]
        const path = Array.from({ length: 40 }, (_, i) => plotXY(sys, t0 + (i / 39) * V.h, exactFrom(sys, y0, (i / 39) * V.h)))
        const a = plotXY(sys, t0, y0)
        const b = plotXY(sys, t0 + V.h, y0.map((v, i) => v + V.h * s.rate[i]))
        const e = path[39]
        const all = [...path, b]
        const [x0, x1] = [Math.min(...all.map((q) => q[0])), Math.max(...all.map((q) => q[0]))]
        const [y0s, y1s] = [Math.min(...all.map((q) => q[1])), Math.max(...all.map((q) => q[1]))]
        const z = 0.8 * Math.min(RIGHT.w / Math.max(x1 - x0, 1e-6), RIGHT.h / Math.max(y1s - y0s, 1e-6))
        const [cx, cy] = [(x0 + x1) / 2, (y0s + y1s) / 2]
        const zx = (q: [number, number]): V3 => [(q[0] - cx) * z, (q[1] - cy) * z, 0.35]
        trLocal.points(path.map((q) => 0.5 + ((q[0] - cx) * z) / RIGHT.w), path.map((q) => (q[1] - cy) * z), null)
        zArrow(zx(a), zx(b), 'Δt·f', [0.2, 0, 0])
        zMiss(zx(b), zx(e), HIGH_V)
        zDots.forEach((d, i) => d.position.set(...zx([a, b, e][i])))
        const miss = Math.abs(s.local[0] - (y0[0] + V.h * s.rate[0]))
        pz.right.set(motor ? `miss ${rate(miss)}` : `lands ${fixedText((V.growth - 1) * 100, 2)} % outside the circle`, HIGH_V)
        pz.lo.set(`step ${Math.min(kk, N - 1) + 1} of ${N}`)
        pz.hi.set(`Δt ${msText(V.h)}`)

        wheel.group.visible = motor
        rigs.group.visible = !motor
        if (motor) {
          const wE = V.ys[k][0]
          const wX = exactFrom(sys, [0], now)[0]
          if (now < st.last) st.rev = 0
          st.rev += (wX * Math.max(0, now - st.last)) / (2 * Math.PI)
          wheel.set(dt, st.rev, wE * RPM, (SPIN.torque / SPIN.b) * RPM, wX * RPM, 1, 0)
        } else rigs.set(exactFrom(sys, [SWING.x0, 0], now)[0], V.ys[k][0], ['exact', 'Euler'], [LABEL, RING])
        st.last = now

        if (motor) {
          rows[0].set('ω += Δt·(τ − b·ω)/J', RING)
          rows[1].set(`${secsText(V.ts[k])}: Euler ${rate(V.ys[k][0])} · exact ${rate(V.exact[k][0])}`, LABEL)
          rows[2].set(`error ${signed(V.errs[k], 2)} rad/s · worst ${rate(V.maxErr)}`, V.maxErr < 0.5 ? POWER : HIGH_V)
        } else {
          rows[0].set('x += Δt·v,  v += Δt·(−k·x/m)', RING)
          rows[1].set(`every step: energy ×${fixedText(V.growth ** 2, 4)}`, HIGH_V)
          rows[2].set(`after ${secsText(V.ts[k])}: ×${fixedText(V.energy[k], 2)} (exact ×1)`, V.energy[k] < 1.2 ? POWER : HIGH_V)
        }
        head.status.set(`Euler integration · ${SYSTEMS[sys].toLowerCase()} · Δt ${msText(V.h)}`)
        head.sub.set(`half real time · grey arrows = the rule · yellow = Euler steps`, GREY)
        const fine = motor ? V.maxErr < 0.5 : V.energy[N] < 1.2
        head.event.set(fine ? 'small steps: Euler hugs the exact curve' : motor ? 'big steps overshoot the bend: shrink Δt' : 'every step leaves the circle: energy grows', fine ? POWER : HEAT)
      },
      readouts: (p) => {
        const { sys, V } = eiRun(p)
        const N = V.ts.length - 1
        return sys === 'motor'
          ? [
              { label: 'Steps', value: `${N}` },
              { label: 'Euler ω', value: rate(V.ys[N][0]) },
              { label: 'Exact ω', value: rate(V.exact[N][0]) },
              { label: 'Worst error', value: rate(V.maxErr), tone: toneOf(V.maxErr < 0.5, V.maxErr < 2) },
            ]
          : [
              { label: 'Steps', value: `${N}` },
              { label: 'Per step', value: `×${fixedText(V.growth ** 2, 4)}` },
              { label: 'Energy at 2 s', value: `×${fixedText(V.energy[N], 2)}`, tone: toneOf(V.energy[N] < 1.2, V.energy[N] < 2) },
              { label: 'Amplitude', value: `×${fixedText(Math.sqrt(V.energy[N]), 2)}` },
            ]
      },
    }
  },
}

// --- Step size: error ∝ Δt (or Δt⁴), and past a critical Δt every method blows up. ---

const SS = { hMin: 1, hMax: 100, gLo: 0.8, gHi: 1.2, eLo: -6, eHi: -1 }
const H_GRID = Array.from({ length: 31 }, (_, i) => (SS.hMin * (SS.hMax / SS.hMin) ** (i / 30)) / 1000)
const M_COLORS = { euler: HEAT, semi: POWER, rk4: B_FIELD }
const ssRun = memoBy(
  (p: Params) => `${p.method} ${p.dt} ${p.k}`,
  (p: Params) => {
    const method = pick(ODE_METHODS, p.method, 'euler')
    const [h, k] = [n(p, 'dt') / 1000, n(p, 'k')]
    return { method, h, k, S: stepSizeView(method, k, h, H_GRID) }
  },
)
const ssClock = lapseClock(MAST.T, 0.5, 0.6)
const hU = (h: number) => Math.log(h / (SS.hMin / 1000)) / Math.log(SS.hMax / SS.hMin)
const hz = (h: number) => `${Math.round(1 / h)} Hz`

export const differentialEquationsStepSize: Lesson = {
  id: 'differential-equations-step-size',
  title: 'Step size',
  tagline: 'Smaller steps are more accurate, and past a limit a big step does not just err: it explodes',
  formula: (p) => {
    const { method, h, S } = ssRun(p)
    return `x″ + 2ζω·x′ + ω²·x = 0 · ω = ${fixedText(S.w, 1)} rad/s, ζ = ${MAST.zeta} · ${ODE_METHODS[method]} at Δt = ${msText(h)} (${hz(h)}): growth per step |g| = ${fixedText(S.gain, 4)} · stable while Δt < Euler ${msText(S.crit.euler)} (2ζ/ω), semi-implicit ${msText(S.crit.semi)} (≈ 2/ω), RK4 ${msText(S.crit.rk4)} (≈ 2.8/ω) · error Euler ∝ Δt, RK4 ∝ Δt⁴`
  },
  legend: [
    { color: LABEL, label: 'Exact motion', shape: 'dot' },
    { color: HEAT, label: 'Explicit Euler', shape: 'dot' },
    { color: POWER, label: 'Semi-implicit Euler', shape: 'dot' },
    { color: B_FIELD, label: 'RK4', shape: 'dot' },
  ],
  points: [
    'Same spring-mass as Euler integration, now with a little damping: let go and the swing should die away. The simulation steps it with a fixed Δt (top). Shrink Δt and every method gets closer; the bottom-right plot shows the worst error against Δt on log scales. Euler and semi-implicit Euler are first order (halve Δt, halve the error); RK4 samples the slope four times per step and is fourth order (halve Δt, 1/16 of the error).',
    'Now raise Δt. Each step multiplies the swing by a growth factor |g| (bottom left). The real mast loses a little every step; once |g| passes 1 the numbers grow every step instead, and the sim rings up to infinity while the real one sits still. For explicit Euler on a lightly damped spring that happens at Δt = 2ζ/ω, here only a few ms.',
    'Semi-implicit (symplectic) Euler updates v first and moves x with the new v. One line swapped, same cost, but it keeps the energy of a spring in check and stays stable up to Δt ≈ 2/ω. RK4 costs four slope evaluations per step and goes to ≈ 2.8/ω. That is why game and robot physics engines use semi-implicit Euler (Software › Simulation › Physics engine).',
    'Stiffness is what hurts: a stiffer spring (or a contact, or a motor’s current loop with L/R ≈ 1 ms) has a larger ω and a smaller limit for every method. A system whose fast part forces tiny steps is called stiff; implicit methods solve for the end of the step and have no such limit, at the price of solving an equation every step.',
    'On a robot Δt is the control loop period. A 100 Hz loop is Δt = 10 ms: fine for a wheel speed with a 0.3 s time constant, far too slow for a 1 kHz current loop. Run the loop at a fixed rate (Software › Firmware structure › Fixed-rate control loop) at least ten times faster than the fastest thing you model or control; turning a continuous controller into a stepped one is State-space & LQR (c2d) and Maths › Signals.',
  ],
  controls: [
    { kind: 'choice', key: 'method', options: opts(ODE_METHODS), initial: 'euler' },
    { kind: 'slider', key: 'dt', label: 'Step Δt', min: SS.hMin, max: SS.hMax, step: 1, initial: 12, format: (v) => `${v} ms (${Math.round(1000 / v)} Hz)` },
    { kind: 'slider', key: 'k', label: 'Spring stiffness k', min: 50, max: 2000, step: 50, initial: 150, format: (v) => `${v} N/m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const px = titledScope(scene, LEFT.top, LEFT.topH, 'position x: stepped vs exact', LABEL, 0.5, LEFT.x, LEFT.w)
    const yx = plotY(-3 * MAST.x0, 3 * MAST.x0, px.h)
    const trExact = px.s.trace(LABEL, { samples: 301, radius: 0.05 })
    const pg = titledScope(scene, LEFT.low, LEFT.lowH, 'growth per step |g| vs Δt (log)', LABEL, 0.5, LEFT.x, LEFT.w)
    const yg = plotY(SS.gLo, SS.gHi, pg.h)
    const pe = titledScope(scene, RIGHT.y, RIGHT.h, 'worst error vs Δt (log)', LABEL, 0, RIGHT.x, RIGHT.w)
    const ye = (e: number) => plotY(SS.eLo, SS.eHi, pe.h)(Math.log10(Math.max(e, 10 ** SS.eLo)))
    const methods = Object.keys(ODE_METHODS) as (keyof typeof ODE_METHODS)[]
    const gTr = methods.map((m) => pg.s.trace(M_COLORS[m], { samples: H_GRID.length, radius: 0.05 }))
    const critTr = methods.map((m) => pg.s.trace(M_COLORS[m], { samples: 2, radius: 0.03 }))
    const critTag = methods.map(() => liveLabel(pg.s.group, [0, 0, 0.4], { size: 0.26 }))
    const eTr = methods.map((m) => pe.s.trace(M_COLORS[m], { samples: H_GRID.length, radius: 0.05 }))
    const runTr = methods.map((m) => px.s.trace(M_COLORS[m], { samples: 301, radius: 0.07 }))
    const gAt = pg.s.trace(RING, { samples: 2, radius: 0.06 })
    const eAt = pe.s.trace(RING, { samples: 2, radius: 0.06 })
    addLabel(pg.s.group, 'grows', [-pg.s.width / 2 + 0.2, yg(1.1), 0.4], HIGH_V, 0.26, 'left')
    addLabel(pg.s.group, 'decays', [-pg.s.width / 2 + 0.2, yg(0.9), 0.4], POWER, 0.26, 'left')
    for (const [d, s] of [[-2, '1 cm'], [-4, '0.1 mm'], [-6, '1 µm']] as const) addLabel(pe.s.group, s, [-pe.s.width / 2 + 0.2, ye(10 ** d) + (d === -6 ? 0.3 : 0.25), 0.4], GREY, 0.24, 'left')

    const rigs = twinRigs(scene, [4.4, 5.6, 0], 6.2)
    const rows = textRows(scene, 3, 1.6, -3.4, 0.32, 0.75)
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const { method, h, k, S } = ssRun(p)
        const color = M_COLORS[method]
        const now = ssClock(dt, `${method} ${h} ${k}`)
        const i = Math.min(S.ts.length - 1, Math.floor(now / h + 1e-9))
        const u = (t: number) => t / MAST.T
        const exactAt = (t: number) => freeAt(MAST.zeta, S.w, MAST.x0, t)
        trExact.draw((x) => yx(exactAt(x * MAST.T)), u(now))
        const trRun = runTr[methods.indexOf(method)]
        runTr.forEach((t) => (t.group.visible = t === trRun))
        const first = S.xs.findIndex((x) => Math.abs(x) > 3.5 * MAST.x0)
        const last = first < 0 ? i : Math.min(i, first)
        trRun.points(S.ts.slice(0, last + 1).map(u), S.xs.slice(0, last + 1).map(yx))
        px.right.set(`${ODE_METHODS[method]} · ${S.ts.length - 1} steps`, color)
        px.lo.set('0 s')
        px.hi.set(`${MAST.T} s`)

        const us = H_GRID.map(hU)
        methods.forEach((m, j) => {
          gTr[j].points(us, S.curves[m].gain.map(yg), null)
          eTr[j].points(us, S.curves[m].err.map(ye), null)
          const c = S.crit[m]
          const uc = hU(c)
          const show = uc >= 0 && uc <= 1
          critTr[j].group.visible = critTag[j].group.visible = show
          critTr[j].points([uc, uc], [yg(1), pg.h / 2 - j * 0.7 - 0.4], null)
          critTag[j].group.position.set(pg.s.xAt(Math.min(0.94, Math.max(0.06, uc))), pg.h / 2 - j * 0.7 - 0.3, 0.4)
          critTag[j].set(msText(c), M_COLORS[m])
        })
        const ua = hU(h)
        gAt.points([ua, ua], [yg(1), yg(S.gain)])
        eAt.points([ua, ua], [ye(10 ** SS.eLo), ye(S.error)])
        pg.right.set(`|g| = ${fixedText(S.gain, 4)}`, S.stable ? POWER : HIGH_V)
        pg.lo.set(`${SS.hMin} ms`)
        pg.hi.set(`${SS.hMax} ms`)
        pe.right.set(`${fixedText(S.error * 1000, 2)} mm${S.stable ? '' : ', growing'}`, S.stable ? color : HIGH_V)
        pe.lo.set(`${SS.hMin} ms`)
        pe.hi.set(`${SS.hMax} ms`)

        rigs.set(exactAt(now), S.xs[i], ['exact', ODE_METHODS[method]], [LABEL, color])
        rows[0].set(`loop Δt ${msText(h)} = ${hz(h)} · ω = ${fixedText(S.w, 1)} rad/s`, LABEL)
        rows[1].set(`stable below: Euler ${msText(S.crit.euler)} · semi ${msText(S.crit.semi)} · RK4 ${msText(S.crit.rk4)}`, GREY)
        rows[2].set(S.stable ? `${ODE_METHODS[method]} stable: |g| ${fixedText(S.gain, 3)} per step` : `${ODE_METHODS[method]} unstable: ×${fixedText(S.gain, 3)} every step`, S.stable ? POWER : HIGH_V)
        head.status.set(`Step size · ${ODE_METHODS[method]} · Δt ${msText(h)} · k ${k} N/m`)
        head.sub.set('damped spring-mass, half real time · left mass exact, right stepped', GREY)
        head.event.set(
          !S.stable ? 'step too big: the sim rings up while the real mass settles' : S.error > 0.002 ? 'stable but coarse: the swing has the wrong size and timing' : 'small enough: stepped ≈ exact',
          !S.stable ? HIGH_V : S.error > 0.002 ? HEAT : POWER,
        )
      },
      readouts: (p) => {
        const { method, h, S } = ssRun(p)
        return [
          { label: 'Loop rate', value: hz(h) },
          { label: 'Growth |g|', value: fixedText(S.gain, 4), tone: toneOf(S.gain < 1, S.gain < 1.0001) },
          { label: 'Limit Δt', value: msText(S.crit[method]), tone: toneOf(h < 0.5 * S.crit[method], h <= S.crit[method]) },
          { label: 'Worst error', value: `${fixedText(S.error * 1000, 2)} mm`, tone: S.stable ? toneOf(S.error < 0.0005, S.error < 0.005) : 'bad' },
        ]
      },
    }
  },
}
