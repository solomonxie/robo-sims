import * as THREE from 'three/webgpu'
import {
  ACCELERATORS, NOMINAL, PINION_TEETH, SHIFT_N, SHIFT_ONSET, SHIFT_SCENES, VIB_BANDS, VIB_EDGES, VIB_FAULTS, VIB_HZ, VIB_N, VIB_WINDOW_S, VibFault, alarmStats,
  learnBaseline, mlpMacs, shiftRun, vibModel, vibRms, vibSpectrum, vibWindow, zScore, zScores,
} from '../../core/physics'
import { msText } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  DATA_COLOR, GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, countBars, cursorBar, flatBox, glowMat, i2cBreakout, liveLabel, memoBy, scope, setGlow, statusHeader,
} from '../fx'
import { Lesson, Params, Readout, Stage, n, opts, pick } from '../types'

const VIEW = { center: [-0.6, -0.4, 0] as V3, radius: 62, polar: Math.PI / 2, azimuth: 0 }
const toneOf = (good: boolean, ok: boolean): Readout['tone'] => (good ? 'ok' : ok ? 'warn' : 'bad')
const WAVE_C = DATA_COLOR
const ESP = ACCELERATORS.esp32
const DFT_MACS = VIB_N * (VIB_N / 2 + 1) * 2
const rpmText = (v: number) => `${v} rpm`
const gText = (v: number) => `${v.toFixed(3)} g`
const bandName = (b: number) => `${VIB_EDGES[b]}–${VIB_EDGES[b + 1]} Hz`
const zColor = (z: number) => (Math.abs(z) < 3 ? POWER : Math.abs(z) < 5 ? HEAT : HIGH_V)

/** Side-view gearmotor on a bracket with an accelerometer on the gearbox; shake the `body`, spin the `wheel`. */
function gearmotorRig(scene: THREE.Object3D, at: V3, k = 1) {
  const g = add(scene, new THREE.Group(), at)
  g.scale.setScalar(k)
  box(g, [7.4, 0.4, 2.4], mat('#3a3d44', { rough: 0.6 }), [0, -2.3, 0])
  const body = add(g, new THREE.Group())
  cylinder(body, 1.1, 3.4, mat('#c9ccd1', { metal: 0.45, rough: 0.35 }), [-1.9, 0, 0], 'x', 32)
  cylinder(body, 1.12, 0.3, mat('#8d939c', { metal: 0.3, rough: 0.45 }), [-3.6, 0, 0], 'x', 32)
  box(body, [2.6, 2.6, 2.0], mat('#e8c547', { rough: 0.55 }), [1.1, 0.2, 0])
  box(body, [3.6, 0.3, 1.8], mat('#9aa0a8', { metal: 0.3, rough: 0.5 }), [0.4, -1.95, 0])
  const bolts = [-1.2, 2.0].map((x) => cylinder(body, 0.16, 0.5, mat('#d4d7dc', { metal: 0.5, rough: 0.3 }), [x, -1.9, 0.7], 'y', 12))
  cylinder(body, 0.18, 1.6, mat('#b9bec6', { metal: 0.4, rough: 0.4 }), [3.0, 0.2, 0], 'x', 12)
  const wheel = add(body, new THREE.Group(), [3.7, 0.2, 0])
  cylinder(wheel, 1.5, 0.6, mat('#202226', { rough: 0.8 }), [0, 0, 0], 'x', 32)
  box(wheel, [0.66, 2.2, 0.3], mat('#e8c547', { rough: 0.55 }), [0, 0, 0])
  const sensor = i2cBreakout(body, [1.1, 1.65, 0.6], { name: 'MPU-6050', k: 0.09 })
  sensor.group.rotation.x = -Math.PI / 2
  const lamp = glowMat(GREY, 0.3)
  add(body, mesh(new THREE.SphereGeometry(0.28, 14, 10), lamp), [-1.9, 1.35, 0]).castShadow = false
  return {
    group: g,
    body,
    bolts,
    lamp,
    set(dt: number, rpm: number, shake: number) {
      wheel.rotation.x -= ((dt * rpm) / 60 / 40) * 2 * Math.PI
      body.position.y = shake
      body.rotation.z = shake * 0.06
    },
  }
}

// --- Vibration baselines: one window → 8 band levels → z-score per band against a learned healthy baseline. ---

const VB = { x: 0.4, w: 13, waveY: 2.4, waveH: 2.0, specY: -2.4, specH: 3.4 }
const LV = { lo: -3.3, hi: -0.7 }
const levelY = (v: number) => (Math.min(1, Math.max(0, (v - LV.lo) / (LV.hi - LV.lo))) - 0.5) * VB.specH
const VB_SLOW = 10
const BASELINE_N = 40
const BASELINE = (() => {
  let b: ReturnType<typeof learnBaseline> | null = null
  return () => (b ??= learnBaseline(NOMINAL, BASELINE_N))
})()
const vbParams = (p: Params) => ({ fault: pick(VIB_FAULTS, p.fault, 'healthy') as VibFault, sev: n(p, 'sev'), rpm: n(p, 'rpm'), take: n(p, 'take') })
type VbQ = ReturnType<typeof vbParams>
const vbWindow = memoBy(
  (q: VbQ) => `${q.fault}|${q.sev}|${q.rpm}|${q.take}`,
  (q: VbQ) => {
    const xs = vibWindow({ rpm: q.rpm, load: NOMINAL.load, fault: q.fault, severity: q.fault === 'healthy' ? 0 : q.sev }, 900 + q.take)
    const { levels } = vibSpectrum(xs)
    const z = zScores(levels, BASELINE())
    return { xs, levels, z, score: zScore(z), rms: vibRms(xs), top: z.map(Math.abs).indexOf(zScore(z)) }
  },
)
const vbAlarm = 4

export const anomalyDetectionVibrationBaselines: Lesson = {
  id: 'anomaly-detection-vibration-baselines',
  title: 'Vibration baselines',
  tagline: 'Record how a healthy gearmotor shakes, band by band, and every new window can be scored by how far it strays from that baseline: no faulty examples needed',
  formula: `accelerometer ${VIB_HZ} Hz, ${VIB_N}-sample window (${msText(VIB_WINDOW_S)}) → DFT → rms per band, log₁₀ · baseline: mean μ and spread σ per band over ${BASELINE_N} healthy windows · z = (level − μ) ÷ σ · alarm if max |z| ≥ ${vbAlarm}`,
  legend: [
    { color: WAVE_C, label: 'Accelerometer, one window', shape: 'dot' },
    { color: GREY, label: 'Healthy baseline μ ± 3σ per band', shape: 'dot' },
    { color: POWER, label: 'Band level within the baseline', shape: 'dot' },
    { color: HIGH_V, label: 'Band far outside it (|z| ≥ 5)', shape: 'dot' },
  ],
  points: [
    'Robots break slowly before they break for good: a wheel picks up a lump of dirt, a bearing wears, a bracket screw works loose. Each one changes how the drive shakes long before it fails. An accelerometer on the gearbox (see Sensors, IMU, Accelerometer) sampled fast enough hears it, and the robot can ask for service instead of stopping in the middle of a job.',
    'The catch is that faults are rare. Nobody has hundreds of recordings of broken bearings to train a classifier (see TinyML, Gesture recognition). What is easy to record is normal running. So anomaly detection learns only "healthy": here 40 windows at 1 500 rpm, each turned into 8 band levels by a DFT (see Signals, Fourier intuition), and per band the mean μ and spread σ. A new window scores z = (level − μ) ÷ σ per band; a healthy one stays within about ±3.',
    'Each fault lands in its own band. Imbalance (a lump on the wheel) grows the once-per-turn line at the shaft speed, 25 Hz. A loose mount rattles at ½×, 2× and 3× shaft speed. Bearing wear makes tiny impacts that ring the housing at a high resonance, a few times per turn. The gear mesh (see Motors, DC motor, Gearboxes), 12 teeth × 25 Hz = 300 Hz, is loud but normal, so it is part of the baseline. Which band lights up hints at what to fix.',
    'Now move the speed away from 1 500 rpm with a healthy motor: every line shifts and grows, and the baseline cries wolf. A baseline is only valid for the conditions it was recorded in. The next lesson compares a fixed threshold with a model that knows what normal looks like at every speed and load.',
  ],
  controls: [
    { kind: 'choice', key: 'fault', options: opts(VIB_FAULTS), initial: 'healthy' },
    { kind: 'slider', key: 'sev', label: 'Fault size', min: 0.1, max: 1, step: 0.1, initial: 0.4, format: (v: number) => `${Math.round(v * 100)} %` },
    { kind: 'slider', key: 'rpm', label: 'Motor speed', min: 900, max: 2100, step: 150, initial: 1500, format: rpmText },
    { kind: 'slider', key: 'take', label: 'Window', min: 1, max: 9, step: 1, initial: 1, format: (v: number) => `#${v}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const rig = gearmotorRig(scene, [-13.2, -0.6, 0], 0.95)
    const left = VB.x - VB.w / 2
    const wave = scope(scene, VB.w, VB.waveH, { divs: [10, 2] })
    wave.group.position.set(VB.x, VB.waveY, 0)
    const waveTr = wave.trace(WAVE_C, { samples: VIB_N, radius: 0.035 })
    const cursor = cursorBar(wave, LABEL, 0.06)
    addLabel(scene, '±0.1 g', [left - 0.35, VB.waveY, 0.3], GREY, 0.24, 'right')
    addLabel(scene, `0 … ${msText(VIB_WINDOW_S)}`, [left + VB.w, VB.waveY + VB.waveH / 2 + 0.75, 0.3], GREY, 0.24, 'right')
    const clock = liveLabel(scene, [left, VB.waveY + VB.waveH / 2 + 0.75, 0.3], { size: 0.24, color: GREY, align: 'left' })
    const spec = scope(scene, VB.w, VB.specH, { divs: [VIB_BANDS, 4], zeroAt: 0 })
    spec.group.position.set(VB.x, VB.specY, 0)
    const colW = VB.w / VIB_BANDS
    const B = BASELINE()
    const fills = Array.from({ length: VIB_BANDS }, (_, b) => {
      const cx = left + (b + 0.5) * colW
      const lo = levelY(B.mean[b] - 3 * B.std[b])
      const hi = levelY(B.mean[b] + 3 * B.std[b])
      flatBox(scene, [colW * 0.8, Math.max(0.08, hi - lo), 0.05], glowMat(GREY, 0.35), [cx, VB.specY + (lo + hi) / 2, 0.05])
      flatBox(scene, [colW * 0.8, 0.05, 0.05], glowMat(LABEL, 0.8), [cx, VB.specY + levelY(B.mean[b]), 0.12])
      const m = glowMat(POWER, 0.9)
      const bar = flatBox(scene, [colW * 0.36, 1, 0.08], m, [cx, 0, 0.2])
      addLabel(scene, `${VIB_EDGES[b]}`, [left + b * colW, VB.specY - VB.specH / 2 - 0.65, 0.3], GREY, 0.22)
      return { bar, m, cx }
    })
    addLabel(scene, `${VIB_EDGES[VIB_BANDS]} Hz`, [left + VB.w, VB.specY - VB.specH / 2 - 0.65, 0.3], GREY, 0.22)
    addLabel(scene, 'band level', [left - 0.35, VB.specY + 0.5, 0.3], GREY, 0.24, 'right')
    addLabel(scene, '(log)', [left - 0.35, VB.specY - 0.1, 0.3], GREY, 0.24, 'right')
    for (const [b, text] of [[0, '1×'], [1, '2×'], [5, `mesh ${PINION_TEETH}×`], [7, 'bearing ring']] as const)
      addLabel(scene, text, [left + (b + 0.5) * colW, VB.specY + VB.specH / 2 + 0.45, 0.3], GREY, 0.22)
    const ZX = 13.6
    addLabel(scene, '|z| per band', [ZX - 2.6, 2.95, 0.3], GREY, 0.27, 'left')
    const zBars = countBars(scene, [ZX, 2.2, 0], Array.from({ length: VIB_BANDS }, (_, b) => bandName(b)), 3.2, { row: 0.62, size: 0.24 })
    const verdict = liveLabel(scene, [ZX - 2.6, -3.4, 0.3], { size: 0.32, align: 'left' })
    const hint = liveLabel(scene, [ZX - 2.6, -4.1, 0.3], { size: 0.26, align: 'left', color: GREY })
    const st = { key: '', t: 0, k: -1 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = vbParams(p)
        const W = vbWindow(q)
        const key = `${q.fault}|${q.sev}|${q.rpm}|${q.take}`
        if (key !== st.key) {
          Object.assign(st, { key, t: 0, k: -1 })
          waveTr.points(W.xs.map((_, i) => i / (VIB_N - 1)), W.xs.map((v) => (Math.max(-0.1, Math.min(0.1, v)) / 0.1) * (VB.waveH / 2)))
          fills.forEach((f, b) => {
            const y0 = -VB.specH / 2
            const y1 = levelY(W.levels[b])
            f.bar.scale.y = Math.max(0.02, y1 - y0)
            f.bar.position.y = VB.specY + (y0 + y1) / 2
            setGlow(f.m, zColor(W.z[b]), 0.9)
          })
          zBars.set(W.z.map((z) => Math.min(8, Math.abs(z))), W.z.map((z) => z.toFixed(1)), W.z.map(zColor), 8)
        }
        st.t = (st.t + dt) % (VIB_WINDOW_S * VB_SLOW)
        const u = st.t / (VIB_WINDOW_S * VB_SLOW)
        const i = Math.min(VIB_N - 1, Math.floor(u * VIB_N))
        cursor(u)
        rig.set(dt, q.rpm, W.xs[i] * 3)
        clock.set(`t = ${msText(u * VIB_WINDOW_S)} (${VB_SLOW}× slower)`, GREY)
        const alarm = W.score >= vbAlarm
        setGlow(rig.lamp, alarm ? HIGH_V : POWER, alarm ? 2 : 0.8)
        const truth = q.fault !== 'healthy'
        verdict.set(alarm ? `ANOMALY  max |z| ${W.score.toFixed(1)}` : `normal  max |z| ${W.score.toFixed(1)}`, alarm ? (truth ? HIGH_V : HEAT) : truth ? HEAT : POWER)
        hint.set(alarm ? `worst band: ${bandName(W.top)}` : `alarm at ${vbAlarm}`, GREY)
        status.set(`Vibration baselines · ${VIB_FAULTS[q.fault]}${truth ? ` ${Math.round(q.sev * 100)} %` : ''} · ${q.rpm} rpm · window #${q.take}`, LABEL)
        sub.set(`baseline: ${BASELINE_N} healthy windows (${(BASELINE_N * VIB_WINDOW_S).toFixed(0)} s) at ${NOMINAL.rpm} rpm · shaft ${(q.rpm / 60).toFixed(1)} Hz, gear mesh ${((PINION_TEETH * q.rpm) / 60).toFixed(0)} Hz`, GREY)
        event.set(
          !truth && !alarm ? 'healthy and inside the baseline'
            : !truth ? `false alarm: healthy, but ${q.rpm} rpm is not what the baseline learned`
              : alarm ? `caught: ${bandName(W.top)} is ${Math.abs(W.z[W.top]).toFixed(1)} σ ${W.z[W.top] > 0 ? 'above' : 'below'} normal` : 'missed: the fault is still inside the healthy spread',
          !truth && !alarm ? POWER : alarm && truth ? POWER : HEAT,
        )
      },
      readouts: (p) => {
        const q = vbParams(p)
        const W = vbWindow(q)
        const truth = q.fault !== 'healthy'
        const alarm = W.score >= vbAlarm
        return [
          { label: 'Score (max |z|)', value: W.score.toFixed(1), tone: toneOf(W.score < 3, W.score < vbAlarm) },
          { label: 'Verdict', value: alarm ? (truth ? 'fault caught' : 'false alarm') : truth ? 'fault missed' : 'normal', tone: alarm === truth ? 'ok' : 'bad' },
          { label: 'rms (baseline)', value: `${gText(W.rms)} (${gText(B.rms.mean)})` },
          { label: 'ESP32 DFT per window', value: msText(DFT_MACS / ESP.f32) },
        ]
      },
    }
  },
}

// --- Thresholds vs models: one window a minute over a shift; fixed RMS threshold vs a model of normal per speed and load. ---

const TV = { x: 3.0, w: 22, opY: 3.0, opH: 1.2, rmsY: 0.4, rmsH: 2.0, mY: -2.6, mH: 2.0 }
const RMS_FULL = 0.08
const SCORE_FULL = 8
const TV_PLAY = 9
const TV_HOLD = 2
const TV_FAULTS = VIB_FAULTS
const tvParams = (p: Params) => ({
  scene: pick(SHIFT_SCENES, p.scene, 'speeds'),
  fault: pick(TV_FAULTS, p.fault, 'bearing') as VibFault,
  rmsTh: n(p, 'rmsTh'),
  mTh: n(p, 'mTh'),
})
type TvQ = ReturnType<typeof tvParams>
const tvRun = memoBy((q: TvQ) => `${q.scene}|${q.fault}`, (q: TvQ) => shiftRun(q.scene, q.fault))
const tvStats = memoBy(
  (q: TvQ) => `${q.scene}|${q.fault}|${q.rmsTh}|${q.mTh}`,
  (q: TvQ) => {
    const R = tvRun(q)
    const faulty = q.fault !== 'healthy'
    return { rms: alarmStats(R.map((r) => r.rms), q.rmsTh, faulty), model: alarmStats(R.map((r) => r.score), q.mTh, faulty) }
  },
)
type Stats = ReturnType<typeof alarmStats>
const statText = (s: Stats, faulty: boolean) =>
  `${s.falses} false alarm${s.falses === 1 ? '' : 's'}${faulty ? (s.delay === null ? ', fault missed' : `, caught after ${s.delay} min`) : ''}`
const statShort = (s: Stats, faulty: boolean) => `${s.falses} false${faulty ? (s.delay === null ? ', missed' : `, +${s.delay} min`) : ''}`
const statTone = (s: Stats, faulty: boolean): Readout['tone'] => toneOf(s.falses === 0 && (!faulty || (s.delay !== null && s.delay < 10)), s.falses <= 1 && (!faulty || s.delay !== null))

export const anomalyDetectionThresholdsVsModels: Lesson = {
  id: 'anomaly-detection-thresholds-vs-models',
  title: 'Thresholds vs models',
  tagline: 'A single limit on how hard the motor shakes is easy, and fooled every time the robot speeds up; a small model of what normal sounds like at each speed and load is not, until the machine itself drifts',
  formula: (p) => {
    const q = tvParams(p)
    return `one ${msText(VIB_WINDOW_S)} window per minute · fixed: alarm if rms > ${gText(q.rmsTh)} · model: 2-10-8 net predicts the healthy band levels from speed and load, score = mean (residual ÷ σ)² ÷ healthy 95th percentile, alarm if > ${q.mTh} · both need 2 windows in a row`
  },
  legend: [
    { color: LABEL, label: 'Motor speed', shape: 'dot' },
    { color: DATA_COLOR, label: 'Load (motor current)', shape: 'dot' },
    { color: RING, label: 'Detector input; dashed bar = threshold', shape: 'dot' },
    { color: HIGH_V, label: 'Fault starts / false alarm (!) / missed (✗)', shape: 'dot' },
  ],
  points: [
    'The simplest detector watches one number, the overall rms vibration, and alarms above a fixed limit. Vibration standards for machines work this way, and on a fan that always turns at the same speed it is fine. Pick "Steady speed": a limit just above healthy catches the fault within minutes.',
    'A robot drive does not run at one speed. Faster means louder: the shaft line grows with speed squared and the gear mesh with speed and load. Pick "Speed and load change": a limit low enough to catch a young bearing fault at 1 200 rpm goes off every time the robot sprints, and one high enough to stay quiet at 2 100 rpm misses the fault for good. No single number fixes both.',
    'The model takes the same 8 band levels as the previous lesson but knows the operating point: the commanded speed and the load, read from the motor current (see Sensors, Current & voltage sensing). A 2-10-8 net (see Neural nets 101) was trained once on healthy windows across speeds and loads to predict the normal level of every band; the score is how far the measured bands sit from that prediction, in units of normal scatter. Speed changes are explained away; a fault is not. On an ESP32 it is ~100 multiply-adds next to a DFT.',
    'Neither copes with drift. Pick "Warm-up drift": as the gearbox warms the mesh gets a little louder, nothing is wrong, and both detectors slowly start to complain. Real systems re-learn the baseline after maintenance or let it follow slow changes, carefully, because a bearing that wears slowly is drift too. Other models of normal (autoencoders, Gaussian / Mahalanobis scores, isolation forests) trade the same things: false alarms against missed and late faults.',
  ],
  controls: [
    { kind: 'choice', key: 'scene', options: opts(SHIFT_SCENES), initial: 'speeds' },
    { kind: 'choice', key: 'fault', options: opts(TV_FAULTS), initial: 'bearing' },
    { kind: 'slider', key: 'rmsTh', label: 'RMS limit', min: 0.025, max: 0.08, step: 0.005, initial: 0.04, format: gText },
    { kind: 'slider', key: 'mTh', label: 'Model threshold', min: 1, max: 6, step: 0.5, initial: 2, format: (v: number) => v.toFixed(1) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const rig = gearmotorRig(scene, [-14.6, 0.2, 0], 0.62)
    const left = TV.x - TV.w / 2
    const mk = (y: number, h: number, divs: [number, number]) => {
      const s = scope(scene, TV.w, h, { divs, zeroAt: 0 })
      s.group.position.set(TV.x, y, 0)
      return s
    }
    const op = mk(TV.opY, TV.opH, [16, 2])
    const rpmTr = op.trace(LABEL, { samples: SHIFT_N, radius: 0.04 })
    const loadTr = op.trace(DATA_COLOR, { samples: SHIFT_N, radius: 0.04 })
    const rmsS = mk(TV.rmsY, TV.rmsH, [16, 4])
    const rmsTr = rmsS.trace(RING, { samples: SHIFT_N, radius: 0.045 })
    const mS = mk(TV.mY, TV.mH, [16, 4])
    const mTr = mS.trace(RING, { samples: SHIFT_N, radius: 0.045 })
    const cursors = [op, rmsS, mS].map((s) => cursorBar(s, LABEL, 0.05))
    const onsets = [op, rmsS, mS].map((s) => flatBox(s.group, [0.08, s.height, 0.05], glowMat(HIGH_V, 1), [s.xAt(SHIFT_ONSET / (SHIFT_N - 1)), 0, 0.25]))
    const thBar = (s: ReturnType<typeof scope>) => {
      const dashes = Array.from({ length: 22 }, (_, i) => flatBox(s.group, [TV.w / 44, 0.06, 0.05], glowMat(HEAT, 1.2), [-TV.w / 2 + (i + 0.25) * (TV.w / 22) + TV.w / 88, 0, 0.3]))
      return (y: number) => dashes.forEach((d) => (d.position.y = Math.min(s.height / 2, y)))
    }
    const rmsTh = thBar(rmsS)
    const mTh = thBar(mS)
    addLabel(scene, '900–2100 rpm', [left - 0.35, TV.opY + 0.25, 0.3], LABEL, 0.22, 'right')
    addLabel(scene, 'load 0–100 %', [left - 0.35, TV.opY - 0.35, 0.3], DATA_COLOR, 0.22, 'right')
    addLabel(scene, 'fixed: rms', [left - 0.35, TV.rmsY + 0.4, 0.3], LABEL, 0.26, 'right')
    addLabel(scene, `0 … ${RMS_FULL} g`, [left - 0.35, TV.rmsY - 0.25, 0.3], GREY, 0.22, 'right')
    addLabel(scene, 'model score', [left - 0.35, TV.mY + 0.4, 0.3], LABEL, 0.26, 'right')
    addLabel(scene, `0 … ${SCORE_FULL}`, [left - 0.35, TV.mY - 0.25, 0.3], GREY, 0.22, 'right')
    addLabel(scene, '0 min', [left, TV.mY - TV.mH / 2 - 0.7, 0.3], GREY, 0.22, 'left')
    addLabel(scene, `${SHIFT_N} min`, [left + TV.w, TV.mY - TV.mH / 2 - 0.7, 0.3], GREY, 0.22, 'right')
    const clock = liveLabel(scene, [TV.x, TV.mY - TV.mH / 2 - 0.7, 0.3], { size: 0.22, color: GREY })
    const marks = [rmsS, mS].map((s) => Array.from({ length: 10 }, () => liveLabel(s.group, [0, s.height / 2 + 0.3, 0.4], { size: 0.3 })))
    const rigTag = liveLabel(scene, [-14.6, -2.0, 0.3], { size: 0.28 })
    const st = { key: '', t: 0, k: -1 }
    const drawUpTo = (k: number, q: TvQ) => {
      const R = tvRun(q).slice(0, Math.max(2, k))
      const us = R.map((_, i) => i / (SHIFT_N - 1))
      rpmTr.points(us, R.map((r) => ((r.rpm - 900) / 1200) * TV.opH * 0.9 - TV.opH / 2 + TV.opH * 0.05))
      loadTr.points(us, R.map((r) => r.load * TV.opH - TV.opH / 2))
      rmsTr.points(us, R.map((r) => (Math.min(1, r.rms / RMS_FULL) - 0.5) * TV.rmsH))
      mTr.points(us, R.map((r) => (Math.min(1, r.score / SCORE_FULL) - 0.5) * TV.mH))
      const S = tvStats(q)
      const faulty = q.fault !== 'healthy'
      ;[S.rms, S.model].forEach((s, j) => {
        const items: { i: number; text: string; c: string }[] = []
        s.on.forEach((a, i) => {
          if (a && !s.on[i - 1] && i < k) items.push(faulty && i >= SHIFT_ONSET ? { i, text: '✓', c: POWER } : { i, text: '!', c: HIGH_V })
        })
        const firstHit = items.findIndex((m) => m.text === '✓')
        const shown = items.filter((m, idx) => m.text === '!' || idx === firstHit)
        if (faulty && s.delay === null && k >= SHIFT_N) shown.push({ i: SHIFT_N - 1, text: '✗', c: HIGH_V })
        marks[j].forEach((m, idx) => {
          const it = shown[idx]
          m.group.visible = !!it
          if (!it) return
          m.group.position.x = (it.i / (SHIFT_N - 1) - 0.5) * TV.w
          m.set(it.text, it.c)
        })
      })
    }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const q = tvParams(p)
        const R = tvRun(q)
        const S = tvStats(q)
        const faulty = q.fault !== 'healthy'
        const key = `${q.scene}|${q.fault}|${q.rmsTh}|${q.mTh}`
        if (key !== st.key) {
          const runChanged = !st.key.startsWith(`${q.scene}|${q.fault}|`)
          Object.assign(st, { key, k: -1 }, runChanged ? { t: 0 } : {})
          onsets.forEach((o) => (o.visible = faulty))
          rmsTh((Math.min(1, q.rmsTh / RMS_FULL) - 0.5) * TV.rmsH)
          mTh((Math.min(1, q.mTh / SCORE_FULL) - 0.5) * TV.mH)
        }
        st.t = (st.t + dt) % (TV_PLAY + TV_HOLD)
        const u = Math.min(1, st.t / TV_PLAY)
        const k = Math.round(u * SHIFT_N)
        cursors.forEach((c) => c(u))
        const cur = R[Math.min(SHIFT_N - 1, k)]
        const rmsOn = S.rms.on[Math.min(SHIFT_N - 1, k)]
        const mOn = S.model.on[Math.min(SHIFT_N - 1, k)]
        rig.set(dt, cur.rpm, Math.sin(st.t * 60) * cur.rms * 3)
        setGlow(rig.lamp, mOn ? HIGH_V : POWER, mOn ? 2 : 0.8)
        rigTag.set(`${cur.rpm} rpm · load ${Math.round(cur.load * 100)} %`, GREY)
        clock.set(`minute ${Math.min(SHIFT_N, k)} · ${SHIFT_N} minutes in ${TV_PLAY} s`, GREY)
        if (k !== st.k) {
          st.k = k
          drawUpTo(k, q)
        }
        status.set(`Thresholds vs models · ${SHIFT_SCENES[q.scene]} · ${VIB_FAULTS[q.fault]}${faulty ? ` from minute ${SHIFT_ONSET}` : ''}`, LABEL)
        sub.set(`now: rms ${gText(cur.rms)}${rmsOn ? ' ALARM' : ''} · model score ${cur.score.toFixed(1)}${mOn ? ' ALARM' : ''}`, GREY)
        const good = (s: Stats) => s.falses === 0 && (!faulty || s.delay !== null)
        event.set(
          `fixed: ${statText(S.rms, faulty)} · model: ${statText(S.model, faulty)}`,
          good(S.rms) && good(S.model) ? POWER : good(S.model) || good(S.rms) ? HEAT : HIGH_V,
        )
      },
      readouts: (p) => {
        const q = tvParams(p)
        const S = tvStats(q)
        const faulty = q.fault !== 'healthy'
        const M = vibModel()
        return [
          { label: 'Fixed rms limit', value: statShort(S.rms, faulty), tone: statTone(S.rms, faulty) },
          { label: 'Model of normal', value: statShort(S.model, faulty), tone: statTone(S.model, faulty) },
          { label: 'Model size', value: `${mlpMacs(M.net)} MACs` },
          { label: 'ESP32 per window', value: `${msText(DFT_MACS / ESP.f32 + mlpMacs(M.net) / ESP.f32)}` },
        ]
      },
    }
  },
}
