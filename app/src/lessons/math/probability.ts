import * as THREE from 'three/webgpu'
import { averageView, bayesRun, binCounts, gaussPdf, gaussianView, varianceView } from '../../core/physics'
import { cmText, fixedText, pct, signed } from '../../core/units'
import { V3, add, box, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, areaStrips, countBars, diffBot, dotLine, glowMat, lapseClock, liveLabel, memoBy, meterTrack, plotY, pointCloud, setGlow, statusHeader, textRows, titledScope } from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const VIEW = { center: [-1.2, -1, 0] as V3, radius: 56, polar: 1.45, azimuth: 0 }
const LEFT = { x: -9, w: 15, top: -1.2, low: -10.3, h: 6.6 }
const RIGHT = { x: 8.6, w: 12.4, y: -10.3, h: 6.6 }
const dot = (g: THREE.Object3D, r: number, c: string) => add(g, mesh(new THREE.SphereGeometry(r, 16, 12), glowMat(c, 1.2)))
const cm = (v: number) => `${v.toFixed(1)} cm`
type Plot = ReturnType<typeof titledScope>
/** Vertical marker line at u across a plot. */
const marker = (p: Plot, color: string) => {
  const t = p.s.trace(color, { samples: 2, radius: 0.04 })
  return (u: number, top = p.h / 2) => t.points([u, u], [-p.h / 2, top], null)
}
const bars = (strips: { u0: number; u1: number; y: number; color: string }[]) => strips.map((s) => ({ ...s, y0: s.y, y1: s.y }))
const WALL = mat('#4a4f5a', { rough: 0.8 })
const rangeScene = (scene: THREE.Object3D) => {
  const g = meterTrack(scene, [3.4, 1.2, 0], 15, [-0.1, 0.75])
  diffBot(add(g, new THREE.Group())).set({ x: 0, y: 0, th: 0 })
  return g
}
/** Wall slab facing the robot, front face at x = 0 of the returned group. */
const wallAt = (g: THREE.Object3D) => {
  const w = add(g, new THREE.Group())
  box(w, [0.03, 0.2, 0.07], WALL, [0.015, 0, 0.035])
  return w
}

// --- Gaussian noise: repeated range readings stack into a histogram that becomes a bell; sum of uniform kicks → Gaussian. ---

const GN = { T: 6, half: 0.12, bins: 32 }
const gnClock = lapseClock(GN.T, 1, 2)
const gnKey = (p: Params) => `${p.mu} ${p.sigma} ${p.k} ${p.N}`
const gnRun = memoBy(
  (p: Params & { shown?: number }) => `${gnKey(p)} ${p.shown ?? p.N}`,
  (p: Params & { shown?: number }) => {
    const [mu, sigma, k, N] = [n(p, 'mu') / 100, n(p, 'sigma') / 100, n(p, 'k'), n(p, 'N')]
    return { mu, sigma, k, N, V: gaussianView(mu, sigma, k, N, p.shown ?? N, GN.bins) }
  },
)
const BAND_COLORS = [POWER, B_FIELD, RING, HIGH_V]
const bandOf = (z: number) => (z <= 1 ? 0 : z <= 2 ? 1 : z <= 3 ? 2 : 3)

export const probabilityGaussianNoise: Lesson = {
  id: 'probability-gaussian-noise',
  title: 'Gaussian noise',
  tagline: 'Read the same wall a thousand times: the readings pile up into a bell curve set by μ and σ',
  formula: (p) => {
    const { mu, sigma, N, V } = gnRun(p)
    return `reading = μ + noise · μ = ${cmText(mu)}, σ = ${cmText(sigma)} · p(x) = e^(−(x − μ)²/2σ²) / (σ√(2π)) · ${N} readings: mean ${cmText(V.mean)}, σ ${cmText(V.sd)} · inside ±1σ/±2σ/±3σ: ${V.within.map(pct).join(' / ')} (normal: 68 / 95 / 99.7 %)`
  },
  legend: [
    { color: POWER, label: 'Readings within ±1σ of μ', shape: 'dot' },
    { color: B_FIELD, label: '±1σ to ±2σ', shape: 'dot' },
    { color: RING, label: '±2σ to ±3σ (red: beyond)', shape: 'dot' },
    { color: HEAT, label: 'Normal curve for this μ and σ', shape: 'dot' },
  ],
  points: [
    'Point an ultrasonic or IR range sensor at a wall that does not move and log it again and again. The numbers jitter by a few mm around the true distance. Stack them into a histogram (count per 2.5 mm bin) and a shape appears: tall in the middle, thin tails, symmetric.',
    'That shape is the normal (Gaussian) curve. Two numbers describe it: μ, the centre (the true distance if the sensor has no bias), and σ, the standard deviation, the typical size of the error. About 68 % of readings land within ±1σ, 95 % within ±2σ and 99.7 % within ±3σ.',
    'Why a bell? The error is the sum of many small independent kicks: electrical noise, the echo bouncing off a rough surface, timer jitter, air currents. Set "noise sources" to 1: one uniform kick gives a flat box. Two give a triangle. By four or five the sum is already a bell. That is the central limit theorem, and it is why Gaussian noise is the default model.',
    'With few readings the histogram is ragged and the sample σ can be well off; it settles as the count grows. So σ is a property of the sensor you measure once, from many readings. A rule like "ignore anything beyond 3σ" then throws away only 0.3 % of good data: the z-score test of AI › Anomaly detection.',
    'Averaging many readings narrows the spread by √N, and two sensors with different σ can be blended so the result beats both: Variance. Sensors › Sensor fusion › Kalman intuition keeps the whole bell as the robot’s belief.',
  ],
  controls: [
    { kind: 'slider', key: 'mu', label: 'Wall distance μ', min: 20, max: 70, step: 1, initial: 45, format: (v) => `${v} cm` },
    { kind: 'slider', key: 'sigma', label: 'Noise σ', min: 0.5, max: 3, step: 0.25, initial: 2, format: cm },
    { kind: 'slider', key: 'k', label: 'Noise sources added', min: 1, max: 12, step: 1, initial: 12, format: (v) => `${v}` },
    { kind: 'slider', key: 'N', label: 'Readings', min: 20, max: 2000, step: 20, initial: 1000, format: (v) => `${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const H = LEFT.top - LEFT.low + LEFT.h
    const ph = titledScope(scene, (LEFT.top + LEFT.low) / 2, H, 'histogram of readings', LABEL, 0, LEFT.x, LEFT.w)
    const fill = areaStrips(ph.s, GN.bins, 0.7)
    const curve = ph.s.trace(HEAT, { samples: 121, radius: 0.06 })
    const muLine = marker(ph, LABEL)
    const lastLine = marker(ph, RING)
    const sigTags = [-3, -2, -1, 1, 2, 3].map((z) => {
      const l = liveLabel(ph.s.group, [0, -H / 2 - 0.85, 0.4], { size: 0.26, color: GREY })
      l.set(`${Math.abs(z)}σ`)
      return { z, l: l.group }
    })

    const g = rangeScene(scene)
    const wall = wallAt(g)
    const cloud = pointCloud(g, 80, 0.008)
    const ping = dotLine(g, 0.004, 30)
    const rows = textRows(scene, 3, 1.6, -2.3, 0.32, 0.75)
    const share = countBars(scene, [5, -8.2, 0.2], ['±1σ', '±2σ', '±3σ'], 7.4, { row: 1.6, size: 0.34 })
    addLabel(scene, 'share inside each band (normal in brackets)', [RIGHT.x - RIGHT.w / 2, -6.2, 0.3], LABEL, 0.3, 'left')
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const now = gnClock(dt, gnKey(p))
        const total = n(p, 'N')
        const shown = Math.max(1, Math.ceil(total * (now / GN.T) ** 2))
        const { mu, sigma, k, V } = gnRun({ ...p, shown })
        const u = (x: number) => (x - (mu - GN.half)) / (2 * GN.half)
        const w = (V.hi - V.lo) / GN.bins
        const top = Math.max(1, ...V.counts, V.expected[GN.bins / 2] ?? 0) * 1.15
        const y = plotY(0, top, H)
        fill.set(bars(V.counts.map((c, i) => ({ u0: u(V.lo + i * w), u1: u(V.lo + (i + 1) * w), y: y(c), color: BAND_COLORS[bandOf(Math.abs(V.lo + (i + 0.5) * w - mu) / sigma)] }))), y(0))
        curve.draw((s) => y(V.xs.length * w * gaussPdf(mu - GN.half + s * 2 * GN.half, mu, sigma)), null)
        muLine(0.5)
        const last = V.xs[V.xs.length - 1]
        lastLine(u(last), -H / 2 + 1.2)
        for (const t of sigTags) {
          t.l.position.x = ph.s.xAt(u(mu + t.z * sigma))
          t.l.visible = Math.abs(t.z * sigma) < GN.half * 0.95 && (sigma * LEFT.w) / (2 * GN.half) > 1.1
        }
        ph.lo.set(cmText(mu - GN.half))
        ph.hi.set(cmText(mu + GN.half))
        ph.right.set(`${V.xs.length} of ${total} readings`, LABEL)

        wall.position.x = mu
        const m = Math.min(80, V.xs.length)
        for (let i = 0; i < m; i++) {
          const x = V.xs[V.xs.length - 1 - i]
          cloud.set(i, [x, ((i * 37) % 17) / 17 * 0.12 - 0.06, 0.012], i === 0 ? RING : BAND_COLORS[bandOf(Math.abs(x - mu) / sigma)], i === 0 ? 2 : 1)
        }
        cloud.show(m)
        ping([0.07, 0, 0.05], [last, 0, 0.05], RING)

        share.set(V.within, V.within.map((s, i) => `${pct(s)} (${pct(V.ideal[i])})`), [POWER, B_FIELD, RING], 1)
        rows[0].set(`last reading ${cmText(last)} · error ${signed((last - mu) * 100, 1)} cm`, RING)
        rows[1].set(`mean ${cmText(V.mean)} · sample σ ${cmText(V.sd)}`, LABEL)
        rows[2].set(k === 1 ? 'one uniform source: a flat box, not a bell' : k < 4 ? `${k} sources: the sum is rounding into a bell` : `${k} sources added: a Gaussian bell`, k < 4 ? HEAT : POWER)
        head.status.set(`Gaussian noise · μ ${cmText(mu)} · σ ${cmText(sigma)} · ${k} source${k > 1 ? 's' : ''}`)
        head.sub.set('range sensor reading a fixed wall, real time · dots = latest readings on the floor', GREY)
        const settled = V.xs.length >= 200
        head.event.set(
          !settled ? `only ${V.xs.length} readings: ragged, σ still uncertain` : k < 4 ? 'same μ and σ, but the shape is not a bell: add sources' : `${V.xs.length} readings: the histogram matches the curve`,
          settled && k >= 4 ? POWER : HEAT,
        )
      },
      readouts: (p) => {
        const { sigma, V } = gnRun(p)
        return [
          { label: 'Mean, all N', value: cmText(V.mean) },
          { label: 'Sample σ', value: cmText(V.sd), tone: toneOf(Math.abs(V.sd / sigma - 1) < 0.05, Math.abs(V.sd / sigma - 1) < 0.15) },
          { label: 'Inside ±1σ', value: pct(V.within[0]), tone: toneOf(Math.abs(V.within[0] - 0.683) < 0.03, Math.abs(V.within[0] - 0.683) < 0.08) },
          { label: 'Inside ±2σ', value: pct(V.within[1]) },
        ]
      },
    }
  },
}

// --- Bayes rule: is that a door? prior × likelihood → posterior, sharpened reading by reading; false alarms vs base rate. ---

const HIT = 0.8
const BR = { K: 12, lo: -7, hi: 7 }
const TRUTH = { door: 'Truth: door', wall: 'Truth: wall' }
const brRun = memoBy(
  (p: Params) => `${p.prior} ${p.fa} ${p.truth}`,
  (p: Params) => {
    const [prior, fa] = [n(p, 'prior') / 100, n(p, 'fa') / 100]
    const truth = pick(TRUTH, p.truth, 'door')
    return { prior, fa, truth, R: bayesRun(prior, HIT, fa, truth === 'door', BR.K) }
  },
)
const brAt = (p: Params) => {
  const r = brRun(p)
  const k = Math.min(BR.K, Math.max(0, n(p, 'k')))
  return { ...r, k, belief: r.R.beliefs[k], step: k > 0 ? r.R.steps[k - 1] : null }
}

export const probabilityBayesRule: Lesson = {
  id: 'probability-bayes-rule',
  title: 'Bayes rule',
  tagline: 'Prior × likelihood → posterior: how a robot decides a door is there from a sensor that sometimes lies',
  formula: (p) => {
    const { prior, fa, k, belief, step } = brAt(p)
    const one = (HIT * prior) / (HIT * prior + fa * (1 - prior))
    return `P(door | beep) = P(beep | door)·P(door) / P(beep) = ${pct(HIT)}·${pct(prior)} / (${pct(HIT)}·${pct(prior)} + ${pct(fa)}·${pct(1 - prior)}) = ${pct(one)} after one beep · after ${k} reading${k === 1 ? '' : 's'}: ${pct(belief)}${step ? ` · last: P(reading) = ${fixedText(step.evidence, 3)}` : ''} · each beep adds ln(${HIT}/${fa.toFixed(2)}) = ${signed(Math.log(HIT / fa), 2)} to the log-odds`
  },
  legend: [
    { color: POWER, label: 'P(door): the belief', shape: 'dot' },
    { color: RING, label: 'Beep (detector says door)', shape: 'dot' },
    { color: GREY, label: 'Silent (detector says wall)', shape: 'dot' },
    { color: B_FIELD, label: 'Log-odds: one step per reading', shape: 'dot' },
  ],
  points: [
    'A robot rolls along a corridor and wants to know: is there a doorway ahead? Its IR detector beeps for a door 80 % of the time (likelihood P(beep | door)), but it also beeps at a plain wall now and then: the false-alarm rate P(beep | wall).',
    'Before any reading the robot has a prior: how common doors are along this corridor. Bayes rule combines the two: posterior ∝ prior × likelihood. Multiply each hypothesis by how well it explains the reading, then divide by the total so they add up to 100 % (the bars, bottom right).',
    'Set the prior to 2 % and the false-alarm rate to 20 %: after one beep the door is still unlikely, because walls are so much more common that most beeps come from walls. This is the base-rate effect, the same reason a rare-disease test with a small false-positive rate mostly flags healthy people. Cut false alarms to 2 % and one beep is convincing.',
    'Each new reading uses the last posterior as the next prior, so belief sharpens reading by reading (top plot) and settles on the truth, unless the detector is no better than chance. In log-odds, ln(P/(1 − P)), every beep just adds ln(hit/false alarm): a straight staircase (lower plot). Occupancy grids store each cell exactly like this: Navigation › Occupancy grids › Log-odds update.',
    'A particle filter is Bayes rule over thousands of guesses of the robot’s pose at once, weighting each by the likelihood of the scan: Navigation › Localization › Particle filter. The likelihood of a range reading is usually the Gaussian of Gaussian noise.',
  ],
  controls: [
    { kind: 'slider', key: 'prior', label: 'Prior P(door)', min: 1, max: 90, step: 1, initial: 10, format: (v) => `${v} %` },
    { kind: 'slider', key: 'fa', label: 'False alarms P(beep | wall)', min: 2, max: 60, step: 1, initial: 20, format: (v) => `${v} %` },
    { kind: 'choice', key: 'truth', options: opts(TRUTH), initial: 'door' },
    { kind: 'slider', key: 'k', label: 'Readings so far', min: 0, max: BR.K, step: 1, initial: 5, format: (v) => `${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const pb = titledScope(scene, LEFT.top, LEFT.h, 'belief P(door) after each reading', POWER, 0, LEFT.x, LEFT.w)
    const pl = titledScope(scene, LEFT.low, LEFT.h, 'log-odds ln(P/(1 − P))', B_FIELD, 0.5, LEFT.x, LEFT.w)
    for (const [v, t] of [[1, '100 %'], [0.5, '50 %'], [0, '0 %']] as const) addLabel(pb.s.group, t, [-LEFT.w / 2 - 0.25, plotY(0, 1, pb.h)(v), 0.4], GREY, 0.24, 'right')
    const yb = plotY(0, 1.08, pb.h)
    const yl = plotY(BR.lo, BR.hi, pl.h)
    const trB = pb.s.trace(POWER, { samples: BR.K + 1, radius: 0.06 })
    const trL = pl.s.trace(B_FIELD, { samples: BR.K + 1, radius: 0.06 })
    const nowB = marker(pb, LABEL)
    const nowL = marker(pl, LABEL)
    const reads = Array.from({ length: BR.K }, () => dot(pb.s.group, 0.22, RING))
    const readMats = reads.map((r) => (r as THREE.Mesh).material as THREE.MeshStandardMaterial)

    const g = rangeScene(scene)
    const solid = box(g, [0.03, 0.2, 0.07], WALL, [0.515, 0, 0.035])
    const sides = [-1, 1].map((s) => box(g, [0.03, 0.05, 0.07], WALL, [0.515, s * 0.075, 0.035]))
    addLabel(g, 'door?', [0.5, 0.15, 0.01], GREY, 0.03)
    g.rotation.x = -0.7
    const led = dot(g, 0.015, RING)
    led.position.set(0.02, 0, 0.1)
    const ledMat = (led as THREE.Mesh).material as THREE.MeshStandardMaterial
    const ping = dotLine(g, 0.004, 24)
    const rows = textRows(scene, 3, 1.6, -2.3, 0.32, 0.75)
    const post = countBars(scene, [7.4, -6.4, 0.2], ['prior: door', 'prior: wall', '× likelihood: door', '× likelihood: wall', 'posterior: door', 'posterior: wall'], 5.6, { row: 1.05, size: 0.3 })
    return {
      scene,
      view: VIEW,
      frame(_dt, p) {
        const { prior, fa, truth, R, k, belief, step } = brAt(p)
        const u = (i: number) => i / BR.K
        const us = R.beliefs.slice(0, k + 1).map((_, i) => u(i))
        trB.points(us, R.beliefs.slice(0, k + 1).map(yb), k)
        trL.points(us, R.logOdds.slice(0, k + 1).map((v) => yl(Math.max(BR.lo, Math.min(BR.hi, v)))), k)
        nowB(u(k))
        nowL(u(k))
        reads.forEach((r, i) => {
          r.visible = i < k
          r.position.set(pb.s.xAt(u(i + 1)), -pb.h / 2 - 0.85, 0.4)
          setGlow(readMats[i], R.reads[i] ? RING : GREY, R.reads[i] ? 1.2 : 0.3)
        })
        pb.right.set(`P(door) ${pct(belief)}`, POWER)
        pl.lo.set('reading 0')
        pl.hi.set(`${BR.K}`)
        pl.right.set(`${signed(R.logOdds[k], 2)}`, B_FIELD)

        const door = truth === 'door'
        solid.visible = !door
        for (const s of sides) s.visible = door
        const beep = step ? R.reads[k - 1] : false
        setGlow(ledMat, beep ? RING : GREY, beep ? 1.4 : 0.2)
        ping([0.07, 0, 0.06], [0.48, 0, 0.06], beep ? RING : GREY)

        const pr = step ? R.beliefs[k - 1] : prior
        post.set(
          step ? [pr, 1 - pr, step.door, step.wall, step.posterior, 1 - step.posterior] : [pr, 1 - pr, 0, 0, pr, 1 - pr],
          step ? [pct(pr), pct(1 - pr), fixedText(step.door, 3), fixedText(step.wall, 3), pct(step.posterior), pct(1 - step.posterior)] : [pct(pr), pct(1 - pr), '—', '—', pct(pr), pct(1 - pr)],
          [POWER, GREY, POWER, GREY, POWER, GREY],
          1,
        )
        rows[0].set(step ? `reading ${k}: ${beep ? 'beep' : 'silent'} · L door ${pct(step.lDoor)}, wall ${pct(step.lWall)}` : 'no readings yet: belief = prior', beep ? RING : LABEL)
        rows[1].set(`P(door) ${pct(prior)} → ${pct(belief)} after ${k}`, POWER)
        rows[2].set(`hit ${pct(HIT)} vs false alarm ${pct(fa)}: a beep is ${fixedText(HIT / fa, 1)}× evidence`, HIT / fa > 5 ? POWER : HEAT)
        head.status.set(`Bayes rule · prior ${pct(prior)} · false alarms ${pct(fa)} · ${door ? 'there is a door' : 'plain wall'}`)
        head.sub.set('robot facing a gap or a wall · LED = last reading · bars: last update', GREY)
        const right = door ? belief > 0.9 : belief < 0.1
        head.event.set(right ? 'belief has settled on the truth' : k <= 1 && prior < 0.1 && fa > 0.05 ? 'base rate: one beep is not enough for a rare door' : 'still unsure: take more readings', right ? POWER : HEAT)
      },
      readouts: (p) => {
        const { truth, k, belief, R } = brAt(p)
        const right = truth === 'door' ? belief > 0.9 : belief < 0.1
        return [
          { label: 'P(door)', value: pct(belief), tone: toneOf(right, (truth === 'door') === belief > 0.5) },
          { label: 'Readings', value: `${k}` },
          { label: 'Beeps', value: `${R.reads.slice(0, k).filter(Boolean).length}` },
          { label: 'Log-odds', value: fixedText(R.logOdds[k]) },
        ]
      },
    }
  },
}

// --- Variance: averaging N readings shrinks σ by √N; fusing two sensors by 1/σ² weights beats both. ---

const VA = { mu: 0.45, half: 0.2, fHalf: 0.1, bins: 40, nMax: 64, batches: 400 }
const vaRun = memoBy(
  (p: Params) => `${p.N} ${p.sa} ${p.sb}`,
  (p: Params) => {
    const [N, sa, sb] = [n(p, 'N'), n(p, 'sa') / 100, n(p, 'sb') / 100]
    const A = averageView(VA.mu, sa, N, VA.batches)
    return { N, sa, sb, A, counts: binCounts(A.avgs, VA.mu - VA.half, VA.mu + VA.half, VA.bins), V: varianceView(VA.mu, sa, sb, N) }
  },
)

export const probabilityVariance: Lesson = {
  id: 'probability-variance',
  title: 'Variance',
  tagline: 'Average N readings and σ shrinks by √N; blend two sensors by 1/σ² and the result beats both',
  formula: (p) => {
    const { N, sa, sb, A, V } = vaRun(p)
    return `variance = σ² · mean of ${N}: σ/√N = ${cmText(sa)}/√${N} = ${cmText(A.predicted)} (measured ${cmText(A.sd)}) · fuse with sensor B (σ ${cmText(sb)}): w = (1/σ²)/Σ(1/σ²) → A ${pct(V.fused.wA)}, B ${pct(V.fused.wB)} · 1/σ² = 1/σA² + 1/σB² → σ ${cmText(V.fused.sigma)}`
  },
  legend: [
    { color: GREY, label: 'One reading of A (σA)', shape: 'dot' },
    { color: HEAT, label: 'Mean of N readings: σA/√N', shape: 'dot' },
    { color: B_FIELD, label: 'Sensor B, one reading (σB)', shape: 'dot' },
    { color: POWER, label: 'Fused: narrower than both', shape: 'dot' },
  ],
  points: [
    'Variance is σ², the average squared error. It is the number that adds: the errors of independent readings add their variances, not their σs. That one rule explains both tricks below.',
    'Average N readings of the same distance: the sum has N× the variance, and dividing by N divides the variance by N², so the mean has σ²/N, a spread of σ/√N. Four readings halve the noise, 16 quarter it, and 64 only take it to an eighth: diminishing returns (bottom right). The top histogram is 400 such averages. This is the ADC trick in Microcontrollers › ADC › Noise and averaging; it only works on noise that changes between readings, not on a fixed bias.',
    'Now two different sensors see the same wall: the averaged ultrasonic (A) and one ToF reading (B). Trust each in proportion to 1/σ², its precision: x = wA·zA + wB·zB. The fused variance is 1/(1/σA² + 1/σB²), smaller than either: the green bell is narrower than both (lower plot). A sensor 3× noisier gets 9× less weight but still helps a little.',
    'Plain averaging is the special case where every reading has the same σ, so every weight is 1/N. Take more readings of A and its bell narrows, so the blend shifts toward A.',
    'That weighted blend is exactly one Kalman update: the gain K = σA²/(σA² + σB²) is B’s weight. The Kalman filter repeats it every step, with the motion model as one "sensor": Sensors › Sensor fusion › Kalman intuition and Control › Filters in the loop › Kalman filter.',
  ],
  controls: [
    { kind: 'slider', key: 'N', label: 'Readings averaged (A)', min: 1, max: VA.nMax, step: 1, initial: 4, format: (v) => `${v}` },
    { kind: 'slider', key: 'sa', label: 'Ultrasonic σA', min: 1, max: 5, step: 0.25, initial: 3, format: cm },
    { kind: 'slider', key: 'sb', label: 'ToF σB', min: 0.5, max: 5, step: 0.25, initial: 2, format: cm },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const pa = titledScope(scene, LEFT.top, LEFT.h, `${VA.batches} means of N readings of A`, HEAT, 0, LEFT.x, LEFT.w)
    const pf = titledScope(scene, LEFT.low, LEFT.h, 'fusing mean of A with one reading of B', POWER, 0, LEFT.x, LEFT.w)
    const fill = areaStrips(pa.s, VA.bins, 0.6)
    const one = pa.s.trace(GREY, { samples: 121, radius: 0.05 })
    const avg = pa.s.trace(HEAT, { samples: 121, radius: 0.06 })
    const muA = marker(pa, LABEL)
    const bA = pf.s.trace(HEAT, { samples: 121, radius: 0.05 })
    const bB = pf.s.trace(B_FIELD, { samples: 121, radius: 0.05 })
    const bF = pf.s.trace(POWER, { samples: 121, radius: 0.07 })
    const [zA, zB, zF] = [marker(pf, HEAT), marker(pf, B_FIELD), marker(pf, POWER)]
    const pn = titledScope(scene, RIGHT.y, RIGHT.h, 'σ of the mean vs N', HEAT, 0, RIGHT.x, RIGHT.w)
    const trN = pn.s.trace(HEAT, { samples: VA.nMax, radius: 0.05 })
    const nowN = marker(pn, LABEL)
    for (const [v, t] of [[1, 'σ'], [0.5, 'σ/2'], [0.25, 'σ/4']] as const) addLabel(pn.s.group, t, [RIGHT.w / 2 - 0.2, plotY(0, 1.1, RIGHT.h)(v) + 0.25, 0.4], GREY, 0.24, 'right')

    const g = rangeScene(scene)
    wallAt(g).position.x = VA.mu
    const cloud = pointCloud(g, VA.nMax, 0.007)
    const mA = dot(g, 0.012, HEAT)
    const mB = dot(g, 0.012, B_FIELD)
    const mF = dot(g, 0.016, POWER)
    const rows = textRows(scene, 3, 1.6, -2.3, 0.32, 0.75)
    return {
      scene,
      view: VIEW,
      frame(_dt, p) {
        const { N, sa, sb, A, counts, V } = vaRun(p)
        const u = (x: number) => (x - (VA.mu - VA.half)) / (2 * VA.half)
        const w = (2 * VA.half) / VA.bins
        const top = Math.max(...counts, VA.batches * w * gaussPdf(0, 0, A.predicted)) * 1.1
        const y = plotY(0, top, pa.h)
        fill.set(bars(counts.map((c, i) => ({ u0: i / VA.bins, u1: (i + 1) / VA.bins, y: y(c), color: HEAT }))), y(0))
        const xs = (s: number, h: number) => VA.mu - h + s * 2 * h
        one.draw((s) => y(VA.batches * w * gaussPdf(xs(s, VA.half), VA.mu, sa)), null)
        avg.draw((s) => y(VA.batches * w * gaussPdf(xs(s, VA.half), VA.mu, A.predicted)), null)
        muA(u(VA.mu))
        pa.lo.set(cmText(VA.mu - VA.half))
        pa.hi.set(cmText(VA.mu + VA.half))
        pa.right.set(`σ ${cmText(sa)} → ${cmText(A.sd)}`, HEAT)

        const F = V.fused
        const fu = (x: number) => (x - (VA.mu - VA.fHalf)) / (2 * VA.fHalf)
        const yf = plotY(0, gaussPdf(0, 0, F.sigma) * 1.12, pf.h)
        bA.draw((s) => yf(gaussPdf(xs(s, VA.fHalf), V.avgA, V.sigmaAvg)), null)
        bB.draw((s) => yf(gaussPdf(xs(s, VA.fHalf), V.zB, sb)), null)
        bF.draw((s) => yf(gaussPdf(xs(s, VA.fHalf), F.x, F.sigma)), null)
        const clip = (v: number) => Math.min(1, Math.max(0, v))
        zA(clip(fu(V.avgA)), yf(gaussPdf(0, 0, V.sigmaAvg)))
        zB(clip(fu(V.zB)), yf(gaussPdf(0, 0, sb)))
        zF(clip(fu(F.x)), yf(gaussPdf(0, 0, F.sigma)))
        pf.lo.set(cmText(VA.mu - VA.fHalf))
        pf.hi.set(cmText(VA.mu + VA.fHalf))
        pf.right.set(`weights A ${pct(F.wA)} · B ${pct(F.wB)}`, POWER)

        const yn = plotY(0, 1.1, pn.h)
        const nu = (m: number) => (m - 1) / (VA.nMax - 1)
        trN.points(Array.from({ length: VA.nMax }, (_, i) => nu(i + 1)), Array.from({ length: VA.nMax }, (_, i) => yn(1 / Math.sqrt(i + 1))), N - 1)
        nowN(nu(N))
        pn.lo.set('N = 1')
        pn.hi.set(`${VA.nMax}`)
        pn.right.set(`N ${N}: ${cmText(A.predicted)}`, HEAT)

        V.readsA.forEach((x, i) => cloud.set(i, [x, -0.03 - ((i * 37) % 17) / 17 * 0.05, 0.012], GREY))
        cloud.show(N)
        mA.position.set(V.avgA, -0.03, 0.025)
        mB.position.set(V.zB, 0.04, 0.025)
        mF.position.set(F.x, 0, 0.03)

        rows[0].set(`mean of ${N}: ${cmText(V.avgA)} ± ${cmText(V.sigmaAvg)} (A)`, HEAT)
        rows[1].set(`one ToF reading: ${cmText(V.zB)} ± ${cmText(sb)} (B)`, B_FIELD)
        rows[2].set(`fused ${cmText(F.x)} ± ${cmText(F.sigma)} · true ${cmText(VA.mu)}`, POWER)
        head.status.set(`Variance · N ${N} · σA ${cmText(sa)} · σB ${cmText(sb)}`)
        head.sub.set('two range sensors on one wall · grey dots: readings of A · green: fused', GREY)
        const gain = Math.min(V.sigmaAvg, sb) / F.sigma
        head.event.set(N > 16 ? `N ${N}: σ/√N gains little now, ${cmText(A.predicted)}` : `fused σ ${cmText(F.sigma)}: ${fixedText(gain, 2)}× tighter than the better sensor`, N > 16 ? HEAT : POWER)
      },
      readouts: (p) => {
        const { A, V } = vaRun(p)
        return [
          { label: 'σ of mean', value: cmText(A.predicted) },
          { label: 'Weight A', value: pct(V.fused.wA) },
          { label: 'Weight B', value: pct(V.fused.wB) },
          { label: 'Fused σ', value: cmText(V.fused.sigma), tone: 'ok' },
        ]
      },
    }
  },
}
