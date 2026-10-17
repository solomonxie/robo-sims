import { ampRatio, dampRegime, decayEnvelope, drivenRun, fixedStepAt, freeAt, naturalW, phaseLag, releaseStats, resonancePeak, springPeriod, staticSag, toDeg } from '../../core/physics'
import { cmText } from '../../core/units'
import { createStage } from '../../scene/stage'
import { B_FIELD, DATA_COLOR, GREY, HEAT, LABEL, POWER, RING, SIDE_SCOPE, addLabel, flatBox, forceArrow, glowMat, lapseClock, liveLabel, memoBy, plotPanel, rigBlockH, scope, sideView, springRig, statusHeader } from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const VIEW = sideView(-2.2, -0.6)
const mm = (x: number) => `${(x * 1000).toFixed(1)} mm`
const sec = (t: number) => (t === Infinity ? 'never' : t < 1 ? `${(t * 1000).toFixed(0)} ms` : `${t.toFixed(2)} s`)
const hz = (f: number) => `${f.toFixed(2)} Hz`
const RIG_X = -9
function restMark(scene: Stage['scene'], y: number, left: number) {
  flatBox(scene, [1.6, 0.07, 0.07], glowMat(GREY, 0.6), [RIG_X - left - 0.8, y, 0.3])
  addLabel(scene, 'rest', [RIG_X - left - 1.8, y, 0.3], GREY, 0.26, 'right')
}
/** Rig whose block (resting) centres on height `eq`; returns the block top for displacement x (m) at `scale` units/m. */
const blockTop = (eq: number, kg: number, x: number, scale: number) => eq + x * scale + rigBlockH(kg) / 2

// --- Spring-mass: pull a hanging mass down and let go; it swings at T = 2π√(m/k) whatever the pull. ---

const SM = { seconds: 2, slow: 0.25, scale: 100, zeta: 0.01, ceil: 3.9, plot: { y: -2.6, h: 9.6 } }
const smParams = (p: Params) => ({ m: n(p, 'mass'), k: n(p, 'spring'), x0: n(p, 'pull') / 100 })
const smKey = (q: ReturnType<typeof smParams>) => `${q.m}|${q.k}|${q.x0}`

export const oscillationsSpringMass: Lesson = {
  id: 'oscillations-spring-mass',
  title: 'Spring-mass',
  tagline: 'Heavier swings slower, stiffer swings faster',
  formula: (p) => {
    const q = smParams(p)
    const T = springPeriod(q.m, q.k)
    return `F = −k·x · ωn = √(k/m) = ${naturalW(q.m, q.k).toFixed(1)} rad/s · T = 2π√(m/k) = ${sec(T)} · f = 1/T = ${hz(1 / T)} · sag = m·g/k = ${cmText(staticSag(q.m, q.k))} → f = √(g/sag)/2π`
  },
  legend: [
    { color: B_FIELD, label: `Displacement x from rest (scope ±${(SM.plot.h / 2 / SM.scale * 100).toFixed(1)} cm, level with the block)`, shape: 'dot' },
    { color: POWER, label: 'Spring force −k·x, always back towards rest', shape: 'arrow-right' },
    { color: RING, label: 'One period T', shape: 'dot' },
  ],
  points: [
    'Hang a mass on a spring and it settles where the spring holds its weight: the static sag m·g/k. Pull it down by x and let go. The extra stretch pushes back with F = −k·x, so the further it is from rest the harder it is pulled back. It overshoots, gets pulled back again and swings: simple harmonic motion, a sine wave in time.',
    'Period T = 2π√(m/k). Four times the mass doubles it; four times the stiffness halves it. The pull does not matter: a bigger swing is pulled back harder in exact proportion, so it takes the same time. Gravity only shifts where rest is, which is why the sag alone tells you the frequency: f = √(g/sag)/2π (2 cm of sag ≈ 3.5 Hz).',
    'On a robot: suspension, a camera on a springy mast (Control › Position control), a long arm with flexible links or a sensor on a rubber mount all have this frequency built in. Anything that shakes them near it gets amplified (Resonance); hitting a bump or stopping hard sets them ringing at it (Damping).',
  ],
  controls: [
    { kind: 'slider', key: 'mass', label: 'Mass m', min: 0.1, max: 1, step: 0.05, initial: 0.4, format: (v) => `${v.toFixed(2)} kg` },
    { kind: 'slider', key: 'spring', label: 'Spring stiffness k', min: 50, max: 500, step: 10, initial: 150, format: (v) => `${v} N/m` },
    { kind: 'slider', key: 'pull', label: 'Pull down by', min: 1, max: 4, step: 0.5, initial: 3, format: (v) => `${v} cm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const clock = lapseClock(SM.seconds, SM.slow, 0.5)
    const { x, w } = SIDE_SCOPE
    const { y: py, h } = SM.plot
    const rig = springRig(scene, [RIG_X, SM.ceil, 0])
    const force = forceArrow(scene, POWER, { size: 0.28 })
    restMark(scene, py, 1.6)
    const plot = plotPanel(scene, [x, py, 0], w, h, SM.seconds, 'displacement x', '', 0.5, 8)
    const xTr = plot.trace(B_FIELD, { samples: 400, radius: 0.06 })
    const tTr = plot.trace(RING, { samples: 2, radius: 0.05 })
    const tTag = liveLabel(scene, [x - w / 2, py + h / 2 - 0.45, 0.3], { size: 0.26, color: RING })
    return {
      scene,
      view: VIEW,
      frame(dtF, p) {
        const q = smParams(p)
        const t = clock(dtF, smKey(q))
        const wn = naturalW(q.m, q.k)
        const T = springPeriod(q.m, q.k)
        const at = (s: number) => -freeAt(SM.zeta, wn, q.x0, s)
        const xs = at(t)
        const k = Math.max(2, Math.round((t / SM.seconds) * 399) + 1)
        const us = Array.from({ length: k }, (_, i) => i / 399)
        xTr.points(us, us.map((u) => at(u * SM.seconds) * SM.scale))
        const uT = Math.min(1, T / SM.seconds)
        tTr.points([0, uT], [h / 2 - 1, h / 2 - 1])
        tTag.group.position.x = x - w / 2 + (uT * w) / 2
        tTag.set(`T = ${sec(T)}`)
        const top = blockTop(py, q.m, xs, SM.scale) - SM.ceil
        rig.set(top, q.m)
        const fy = py + xs * SM.scale
        const F = -q.k * xs
        force([RIG_X + 2.2, fy, 1.6], [RIG_X + 2.2, fy + F * 0.6, 1.6], `${F.toFixed(1)} N`, [0.9, 0, 0])
        head.status.set(`Spring-mass · m ${q.m.toFixed(2)} kg · k ${q.k} N/m`, LABEL)
        head.event.set(`x ${xs >= 0 ? '+' : '−'}${cmText(Math.abs(xs))} · swings every ${sec(T)}`, B_FIELD)
        head.sub.set(`${t.toFixed(2)} / ${SM.seconds} s · ¼× slow motion`)
      },
      readouts: (p) => {
        const q = smParams(p)
        const T = springPeriod(q.m, q.k)
        return [
          { label: 'Period T = 2π√(m/k)', value: sec(T) },
          { label: 'Frequency f', value: hz(1 / T) },
          { label: 'Static sag m·g/k', value: cmText(staticSag(q.m, q.k)) },
          { label: 'Peak pull-back k·x₀', value: `${(q.k * q.x0).toFixed(1)} N` },
        ]
      },
    }
  },
}

// --- Damping: an oil damper drains each swing; ζ sets under-, critically or over-damped. ---

const DM = { seconds: 1.5, slow: 0.25, scale: 100, m: 0.5, x0: 0.04, ceil: 3.9, plot: { y: -2.6, h: 9.6 } }
const dmParams = (p: Params) => ({ zeta: n(p, 'zeta'), k: n(p, 'spring') })
type DmQ = ReturnType<typeof dmParams>
const dmStats = memoBy((q: DmQ) => `${q.zeta}|${q.k}`, (q: DmQ) => releaseStats(q.zeta, naturalW(DM.m, q.k)))
const REGIME = { none: 'undamped', under: 'underdamped', critical: 'critically damped', over: 'overdamped' } as const

export const oscillationsDamping: Lesson = {
  id: 'oscillations-damping',
  title: 'Damping',
  tagline: 'Ring, settle, or creep',
  formula: (p) => {
    const q = dmParams(p)
    const wn = naturalW(DM.m, q.k)
    const c = 2 * q.zeta * Math.sqrt(q.k * DM.m)
    return `m·ẍ + c·ẋ + k·x = 0 · ζ = c / 2√(k·m) = ${q.zeta.toFixed(2)} (c = ${c.toFixed(1)} N·s/m) · envelope x₀·e^(−ζ·ωn·t), ζ·ωn = ${(q.zeta * wn).toFixed(1)} /s · critical c = 2√(k·m) = ${(2 * Math.sqrt(q.k * DM.m)).toFixed(1)} N·s/m`
  },
  legend: [
    { color: B_FIELD, label: `Displacement x (scope ±${(DM.plot.h / 2 / DM.scale * 100).toFixed(1)} cm)`, shape: 'dot' },
    { color: GREY, label: 'Decay envelope ±x₀·e^(−ζωn t)', shape: 'dot' },
    { color: DATA_COLOR, label: 'Critical damping (ζ = 1) for comparison', shape: 'dot' },
    { color: HEAT, label: 'Damper force −c·ẋ', shape: 'arrow-right' },
  ],
  points: [
    'A real spring-mass loses energy every swing: an oil damper (dashpot), rubber, air drag or friction pushes against the motion with F = −c·ẋ. One number says how much: the damping ratio ζ = c / 2√(k·m), the damper compared with what the spring and mass can store.',
    'ζ < 1, underdamped: it still swings but every peak is a fixed share of the last, inside an envelope x₀·e^(−ζωn t). ζ = 1, critically damped: the fastest return without overshoot. ζ > 1, overdamped: no overshoot but it creeps back slowly, because the damper also resists the return.',
    'This is the same equation as a closed control loop: ζ and ωn are the poles of Control › Stability › Poles and damping, and a release from x₀ is an upside-down Step response (overshoot, settle time). Car suspensions sit near ζ ≈ 0.3, door closers and instrument needles near 0.7–1. Stopping a robot that carries a tall mast or a long arm sets it ringing at the damped period: Vibration › Damping mounts adds rubber to tame it.',
  ],
  controls: [
    { kind: 'slider', key: 'zeta', label: 'Damping ratio ζ', min: 0, max: 2, step: 0.05, initial: 0.15, format: (v) => v.toFixed(2) },
    { kind: 'slider', key: 'spring', label: 'Spring stiffness k', min: 50, max: 400, step: 10, initial: 200, format: (v) => `${v} N/m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const clock = lapseClock(DM.seconds, DM.slow, 0.5)
    const { x, w } = SIDE_SCOPE
    const { y: py, h } = DM.plot
    const rig = springRig(scene, [RIG_X, DM.ceil, 0], { damper: true })
    const push = forceArrow(scene, HEAT, { size: 0.28 })
    restMark(scene, py, 1.6)
    const plot = plotPanel(scene, [x, py, 0], w, h, DM.seconds, 'displacement x', '', 0.5, 6)
    const crit = plot.trace(DATA_COLOR, { samples: 200, radius: 0.035 })
    const envUp = plot.trace(GREY, { samples: 200, radius: 0.035 })
    const envDn = plot.trace(GREY, { samples: 200, radius: 0.035 })
    const xTr = plot.trace(B_FIELD, { samples: 400, radius: 0.06 })
    return {
      scene,
      view: VIEW,
      frame(dtF, p) {
        const q = dmParams(p)
        const s = dmStats(q)
        const t = clock(dtF, `${q.zeta}|${q.k}`)
        const wn = naturalW(DM.m, q.k)
        const at = (u: number) => -freeAt(q.zeta, wn, DM.x0, u * DM.seconds) * DM.scale
        crit.draw((u) => -freeAt(1, wn, DM.x0, u * DM.seconds) * DM.scale, null)
        const under = q.zeta < 1
        envUp.group.visible = envDn.group.visible = under
        envUp.draw((u) => decayEnvelope(q.zeta, wn, DM.x0, u * DM.seconds) * DM.scale, null)
        envDn.draw((u) => -decayEnvelope(q.zeta, wn, DM.x0, u * DM.seconds) * DM.scale, null)
        const k = Math.max(2, Math.round((t / DM.seconds) * 399) + 1)
        const us = Array.from({ length: k }, (_, i) => i / 399)
        xTr.points(us, us.map(at))
        const xs = -freeAt(q.zeta, wn, DM.x0, t)
        const dt = 1e-4
        const v = (-freeAt(q.zeta, wn, DM.x0, t + dt) - xs) / dt
        rig.set(blockTop(py, DM.m, xs, DM.scale) - DM.ceil, DM.m, Math.min(1, q.zeta / 1.5))
        const F = -2 * q.zeta * Math.sqrt(q.k * DM.m) * v
        const fy = py + xs * DM.scale
        push([RIG_X - 2.4, fy + 0.8, 1.6], [RIG_X - 2.4, fy + 0.8 + Math.max(-4, Math.min(4, F * 0.6)), 1.6], `${F.toFixed(1)} N`, [-1, 0, 0])
        const reg = dampRegime(q.zeta)
        head.status.set(`Damping · ζ ${q.zeta.toFixed(2)} · ${REGIME[reg]}`, LABEL)
        head.event.set(reg === 'critical' ? 'back to rest as fast as possible, no overshoot' : reg === 'over' ? 'no overshoot, but creeps back slowly' : `each swing keeps ${Math.round(s.ratio * 100)} % of the last`, reg === 'none' ? HEAT : B_FIELD)
        head.sub.set(`${t.toFixed(2)} / ${DM.seconds} s · ¼× slow motion · m ${DM.m} kg, pulled ${DM.x0 * 100} cm`)
      },
      readouts: (p) => {
        const q = dmParams(p)
        const s = dmStats(q)
        const reg = dampRegime(q.zeta)
        return [
          { label: 'Regime', value: REGIME[reg], tone: reg === 'critical' ? 'ok' : reg === 'none' ? 'bad' : 'warn' },
          { label: 'Peak-to-peak keeps', value: reg === 'none' || reg === 'under' ? `${Math.round(s.ratio * 100)} % every ${sec(s.td)}` : 'no swing' },
          { label: 'Settles within 2 %', value: sec(s.settle) },
          { label: 'Poles s = −ζωn ± jωd', value: `${s.poles.re.toFixed(1)} ± ${s.poles.im.toFixed(1)}j` },
        ]
      },
    }
  },
}

// --- Resonance: shake the mass at f; near fn the swing grows until damping eats as much as the drive feeds. ---

const RS = { seconds: 10, slow: 0.5, window: 2, scale: 50, m: 0.5, k: 200, f0: 0.5, fMax: 8, ampTop: 0.045, ceil: -0.4, top: { y: 1.4, h: 4.4 }, bot: { y: -5.8, h: 4.4 } }
const rsParams = (p: Params) => ({ f: n(p, 'freq'), zeta: n(p, 'zeta') })
type RsQ = ReturnType<typeof rsParams>
const rsKey = (q: RsQ) => `${q.f}|${q.zeta}`
const rsRun = memoBy(rsKey, (q: RsQ) => drivenRun({ m: RS.m, k: RS.k, zeta: q.zeta, f0: RS.f0, w: 2 * Math.PI * q.f, seconds: RS.seconds, dt: 0.001 }))
const FN = naturalW(RS.m, RS.k) / (2 * Math.PI)
const steadyAmp = (q: RsQ) => (RS.f0 / RS.k) * ampRatio(q.zeta, q.f / FN)

export const oscillationsResonance: Lesson = {
  id: 'oscillations-resonance',
  title: 'Resonance',
  tagline: 'Small pushes, big swings',
  formula: (p) => {
    const q = rsParams(p)
    const r = q.f / FN
    return `F₀·sin(2πf·t) on m·ẍ + c·ẋ + k·x · X = (F₀/k) / √((1 − r²)² + (2ζr)²), r = f/fn = ${r.toFixed(2)} → ${mm(steadyAmp(q))} · lag φ = atan(2ζr / (1 − r²)) = ${toDeg(phaseLag(q.zeta, r)).toFixed(0)}° · peak ≈ 1/2ζ = ${(1 / (2 * q.zeta)).toFixed(1)}×`
  },
  legend: [
    { color: B_FIELD, label: `Steady amplitude vs drive f (top, 0…${RS.ampTop * 1000} mm)`, shape: 'dot' },
    { color: RING, label: 'Phase lag behind the push (0…180°)', shape: 'dot' },
    { color: HEAT, label: `Shaker force ±${RS.f0} N`, shape: 'arrow-right' },
    { color: POWER, label: `Displacement x (bottom, ±${(RS.bot.h / 2 / RS.scale * 100).toFixed(1)} cm)`, shape: 'dot' },
  ],
  points: [
    `A small shaker pushes the ${RS.m} kg mass up and down with ±${RS.f0} N. Slowly (r = f/fn ≪ 1) the spring just follows the force: x ≈ F₀/k = ${mm(RS.f0 / RS.k)}, in step with the push. Fast (r ≫ 1) the mass is too heavy to follow and barely moves, half a cycle behind.`,
    `Near the natural frequency fn = ${hz(FN)} every push lands just as the mass is already moving that way (it lags by 90°), so each cycle adds energy. The swing grows over many cycles until the damper takes as much per cycle as the shaker feeds: peak ≈ 1/(2ζ) times the static stretch. Halve ζ and the peak doubles, and it takes twice as long to build.`,
    'Robots meet this everywhere: a walking gait at the frequency of a springy leg, a motor speed that makes a frame panel buzz, the stepper motor mid-band resonance (Actuators › Stepper), a control loop whose poles sit near a mechanical mode. The fixes: move fn away (stiffer or lighter), add damping, or keep drives out of the band. Unbalanced motors, whose force grows with speed, are in Vibration › Motor vibration; spotting a new peak in a spectrum is AI › Anomaly detection.',
  ],
  controls: [
    { kind: 'slider', key: 'freq', label: 'Drive frequency f', min: 0.5, max: RS.fMax, step: 0.1, initial: 2.5, format: (v) => `${v.toFixed(1)} Hz` },
    { kind: 'slider', key: 'zeta', label: 'Damping ratio ζ', min: 0.03, max: 0.5, step: 0.01, initial: 0.06, format: (v) => v.toFixed(2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const clock = lapseClock(RS.seconds, RS.slow, 1)
    const { x, w } = SIDE_SCOPE
    const rig = springRig(scene, [RIG_X, RS.ceil, 0], { damper: true })
    const push = forceArrow(scene, HEAT, { size: 0.28 })
    restMark(scene, RS.bot.y, 1.6)
    const { y: ty, h: th } = RS.top
    const amp = scope(scene, w, th, { divs: [RS.fMax, 4], zeroAt: 0 })
    amp.group.position.set(x, ty, 0)
    addLabel(scene, `amplitude 0…${RS.ampTop * 1000} mm`, [x - w / 2, ty + th / 2 + 1.1, 0.3], B_FIELD, 0.3, 'left')
    addLabel(scene, 'phase lag 0…180°', [x + w / 2, ty + th / 2 + 1.1, 0.3], RING, 0.3, 'right')
    addLabel(scene, '0', [x - w / 2, ty - th / 2 - 0.9, 0.3], GREY, 0.26, 'left')
    addLabel(scene, `${RS.fMax} Hz drive`, [x + w / 2, ty - th / 2 - 0.9, 0.3], GREY, 0.26, 'right')
    addLabel(scene, 'fn', [x - w / 2 + (FN / RS.fMax) * w, ty - th / 2 - 0.9, 0.3], GREY, 0.26)
    const fnLine = amp.trace(GREY, { samples: 2, radius: 0.03 })
    fnLine.points([FN / RS.fMax, FN / RS.fMax], [-th / 2, th / 2])
    const phTr = amp.trace(RING, { samples: 200, radius: 0.04 })
    const ampTr = amp.trace(B_FIELD, { samples: 300, radius: 0.06 })
    const { y: by, h: bh } = RS.bot
    const tPlot = plotPanel(scene, [x, by, 0], w, bh, RS.window, 'last 2 s: push and response', '', 0.5, 8)
    const fTr = tPlot.trace(HEAT, { samples: 300, radius: 0.04 })
    const xTr = tPlot.trace(POWER, { samples: 300, radius: 0.06 })
    const yAmp = (a: number) => -th / 2 + Math.min(1.05, a / RS.ampTop) * th
    return {
      scene,
      view: VIEW,
      frame(dtF, p) {
        const q = rsParams(p)
        const run = rsRun(q)
        const t = clock(dtF, rsKey(q))
        const fAt = (u: number) => u * RS.fMax
        phTr.draw((u) => -th / 2 + (phaseLag(q.zeta, fAt(u) / FN) / Math.PI) * th, q.f / RS.fMax)
        ampTr.draw((u) => yAmp((RS.f0 / RS.k) * ampRatio(q.zeta, fAt(u) / FN)), q.f / RS.fMax)
        const sig = (key: 'x' | 'f') => (s: number) => (s < 0 ? 0 : key === 'x' ? fixedStepAt(run, s, 0.001).x * RS.scale : (fixedStepAt(run, s, 0.001).f / RS.f0) * bh * 0.3)
        fTr.scroll(sig('f'), t, RS.window)
        xTr.scroll(sig('x'), t, RS.window)
        const fr = fixedStepAt(run, t, 0.001)
        rig.set(blockTop(by, RS.m, fr.x, RS.scale) - RS.ceil, RS.m, Math.min(1, q.zeta / 0.5))
        const fy = by + fr.x * RS.scale
        push([RIG_X - 2.4, fy, 1.8], [RIG_X - 2.4, fy + (fr.f / RS.f0) * 1.6, 1.8], `${fr.f >= 0 ? '+' : '−'}${Math.abs(fr.f).toFixed(2)} N`, [-1.3, 0, 0])
        const r = q.f / FN
        const near = Math.abs(r - 1) < 0.15
        head.status.set(`Resonance · drive ${hz(q.f)} · fn ${hz(FN)} · ζ ${q.zeta.toFixed(2)}`, LABEL)
        head.event.set(near ? `at resonance: ${ampRatio(q.zeta, r).toFixed(1)}× the static stretch` : r < 1 ? 'below fn: follows the push' : 'above fn: too heavy to follow', near ? HEAT : B_FIELD)
        head.sub.set(`${t.toFixed(1)} / ${RS.seconds} s from rest · ½× slow motion`)
      },
      readouts: (p) => {
        const q = rsParams(p)
        const r = q.f / FN
        const pk = resonancePeak(q.zeta)
        return [
          { label: 'Natural frequency fn', value: hz(FN) },
          { label: 'Steady amplitude', value: `${mm(steadyAmp(q))} (${ampRatio(q.zeta, r).toFixed(1)}×)`, tone: ampRatio(q.zeta, r) > 3 ? 'warn' : 'ok' },
          { label: 'Mass lags the push by', value: `${toDeg(phaseLag(q.zeta, r)).toFixed(0)}°` },
          { label: 'Peak at this ζ', value: `${pk.ratio.toFixed(1)}× at ${hz(pk.r * FN)}` },
        ]
      },
    }
  },
}
