import * as THREE from 'three/webgpu'
import {
  INMP441,
  MEMS,
  SOUND_C,
  TONE_HZ,
  WHINE_HZ,
  bearingStep,
  diaphragmShift,
  dominantHz,
  i2sSck,
  locate,
  maxLagSamples,
  micArray,
  micCapF,
  micCode,
  micCutoff,
  micDbfs,
  micSpectrum,
  pdmBits,
  soundAt,
  spatialAliasing,
  splToPa,
  tdoa,
} from '../../core/physics'
import type { MicSet, Sound } from '../../core/physics'
import { hertz, si } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh, rod } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  CLK_COLOR,
  DATA_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  POWER,
  RING,
  addLabel,
  arrow,
  esp32Board,
  frac,
  glowMat,
  i2cBreakout,
  label as textMesh,
  lightRay,
  liveLabel,
  memoBy,
  pointArrow,
  scope,
  setGlow,
  speaker,
  wavePool,
  wire,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'

const textLines = (scene: THREE.Scene, T0: V3) => {
  const [a, b, c] = [0, 1, 2].map((i) => liveLabel(scene, [T0[0], T0[1] - i * 1.2, 0], { size: 0.5, align: 'left' }))
  const status = liveLabel(scene, [T0[0], T0[1] - 3.7, 0], { size: 0.38, align: 'left' })
  return { a, b, c, status }
}
const deg = (r: number) => (r * 180) / Math.PI
const degText = (r: number) => `${Math.round(deg(r))}°`.replace("-", "−")
const us = (s: number) => si(s, 's', 3)

// --- MEMS mic: sound through the bottom port bends a diaphragm under a perforated backplate (a capacitor), the ASIC's
// sigma-delta + decimation filter turn it into 24-bit samples, clocked out over I²S to an ESP32; spectrum of a clap vs a motor whine. ---

const SOUNDS: Record<'clap' | 'whine', string> = { clap: 'Hand clap', whine: 'Motor whine' }
const RATES: Record<string, string> = { '8000': '8 kHz', '16000': '16 kHz', '48000': '48 kHz' }
const MIC_SLOW = 500
const CLAP_CYCLE = 9
const N_FFT = 256
const SCOPE_WINDOW = 0.004
const MX = -12
const PCB_Y = -5.4
const DIA_Y = -1.7
const BACK_Y = -0.9
const SPAN = 5
const SRC_Y = -14
const WAVE_V = 4
const ARRIVE = (PCB_Y - SRC_Y) / WAVE_V

function micSetup(p: Params) {
  const kind = pick(SOUNDS, p.sound, 'whine') as Sound
  const fs = Number(pick(RATES, String(p.rate), '16000'))
  const spl = n(p, 'level')
  const peakPa = splToPa(spl)
  const dbfs = micDbfs(spl)
  const peakFs = Math.min(1, 10 ** (dbfs / 20))
  const c0 = micCapF(0)
  const dC = micCapF(diaphragmShift(peakPa)) - c0
  return { kind, fs, spl, peakPa, dbfs, peakFs, c0, dC, cut: micCutoff(fs), key: `${kind}|${fs}|${spl}` }
}
type MicSetup = ReturnType<typeof micSetup>
const spectrumOf = memoBy((M: MicSetup) => `${M.kind}|${M.fs}`, (M: MicSetup) => micSpectrum(M.kind, M.fs, N_FFT))
const fsOf = (M: MicSetup, s: number) => Math.max(-1, Math.min(1, s * 10 ** (M.dbfs / 20)))
const hex24 = (code: number) => `0x${((code + 2 ** 24) % 2 ** 24).toString(16).toUpperCase().padStart(6, '0')}`

function micHeadline(M: MicSetup) {
  if (M.dbfs > 0) return `Over ${INMP441.aopDb} dB SPL: samples clip at full scale`
  if (M.kind === 'whine' && M.fs === 8000) return `8 kHz sampling: harmonics above 4 kHz are filtered off`
  if (M.kind === 'whine') return `Motor whine: a ${hertz(WHINE_HZ)} line and its harmonics`
  return M.fs === 8000 ? 'A clap is broadband: 8 kHz keeps only the bottom of it' : 'A clap: energy smeared across the whole band'
}

export const memsMic: Lesson = {
  id: 'microphone-sound-mems-mic',
  title: 'MEMS mic',
  tagline: 'Sound flexes a diaphragm a few nanometres over a backplate; the chip turns the changing capacitance into 24-bit samples on I²S',
  formula: (p) => {
    const M = micSetup(p)
    return `p = 20 µPa × 10^(${M.spl}/20) = ${si(M.peakPa, 'Pa', 3)} · x = ${MEMS.mPerPa * 1e9} nm/Pa × p = ${si(diaphragmShift(M.peakPa), 'm', 3)} · C = ε₀·A / (d − x) = ${si(M.c0 + M.dC, 'F', 4)} · level = −26 dBFS + (${M.spl} − 94) dB = ${M.dbfs} dBFS · SCK = 64 × ${hertz(M.fs)} = ${hertz(i2sSck(M.fs))}`
  },
  legend: [
    { color: RING, label: 'Sound pressure (slowed)', shape: 'dot' },
    { color: DATA_COLOR, label: 'SD: sample bits', shape: 'dot' },
    { color: CLK_COLOR, label: 'SCK bit clock', shape: 'dot' },
    { color: HEAT, label: 'WS: left/right word select', shape: 'dot' },
  ],
  points: [
    'A MEMS microphone is a speck of silicon in a metal can. Sound enters through a hole in the PCB underneath (bottom port) and pushes a diaphragm about 0.6 mm across. A few micrometres above it sits a stiff backplate full of holes, so air can get out of the way.',
    'Diaphragm and backplate are a capacitor of under 1 pF. Pressure moves the diaphragm by nanometres (94 dB SPL = 1 Pa ≈ 4 nm here), the gap shrinks and C rises a tiny fraction. The ASIC in the can biases it and reads that change.',
    'The INMP441 has the ADC inside: a sigma-delta modulator makes a fast 1-bit stream (the density of 1s follows pressure, like a PDM mic’s output), and a decimation filter turns it into 24-bit PCM. 94 dB reads −26 dBFS; at 120 dB the samples hit full scale and clip.',
    'It talks I²S: SCK clocks 64 bits per sample (two 32-bit slots), WS picks left or right (L/R to GND = left), SD carries the 24 bits MSB first. The ESP32’s I²S peripheral sets fs, e.g. 16 kHz → SCK 1.024 MHz, and DMA collects the samples.',
    'Sample rate sets the top of the band: only up to fs/2 (Nyquist), and the mic’s filter removes the rest so it can’t alias. A spectrum (DFT of 256 samples) shows a clap as a broad hump and a motor’s whine as sharp lines at its fundamental and harmonics: easy to tell apart.',
  ],
  controls: [
    { kind: 'choice', key: 'sound', options: Object.entries(SOUNDS).map(([value, label]) => ({ value, label })), initial: 'whine' },
    { kind: 'choice', key: 'rate', options: Object.entries(RATES).map(([value, label]) => ({ value, label })), initial: '16000' },
    { kind: 'slider', key: 'level', label: 'Peak level', min: 60, max: 126, initial: 100, step: 2, format: (v) => `${v} dB SPL` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const pcb = mat('#1f6b3a', { rough: 0.6 })
    const laminate = mat('#5a4a3a', { rough: 0.7 })
    const can = mat('#c9ccd1', { metal: 0.45, rough: 0.3 })
    const silicon = mat('#6d7686', { metal: 0.2, rough: 0.4 })
    for (const s of [-1, 1]) {
      box(scene, [6.4, 0.8, 3.4], pcb, [MX + s * 3.8, PCB_Y, 0])
      box(scene, [5, 0.6, 3], laminate, [MX + s * 3.1, PCB_Y + 0.7, 0])
      box(scene, [0.3, 6.85, 3], can, [MX + s * 5.45, PCB_Y + 1.0 + 3.425, -0.2])
      box(scene, [1, 2.6, 2.4], silicon, [MX + s * 3, PCB_Y + 1.0 + 1.3, 0])
    }
    box(scene, [11.2, 0.3, 3], can, [MX, PCB_Y + 1 + 6.85, -0.2])
    box(scene, [1.3, 1, 2], mat('#16171b', { rough: 0.5 }), [MX + 4.4, PCB_Y + 1.5, 0])
    rod(scene, [MX + 3.2, PCB_Y + 3.6, 0.6], [MX + 4.1, PCB_Y + 2.8, 0.6], 0.04, mat('#e8c15a', { metal: 0.5 }))
    rod(scene, [MX + 4.1, PCB_Y + 2.8, 0.6], [MX + 4.3, PCB_Y + 2, 0.6], 0.04, mat('#e8c15a', { metal: 0.5 }))
    const NSEG = 30
    const diaMat = mat('#e0b25a', { metal: 0.4, rough: 0.35 })
    const segW = 6 / NSEG
    const dia = Array.from({ length: NSEG }, (_, i) => add(scene, mesh(new THREE.BoxGeometry(segW + 0.02, 0.14, 2.2), diaMat), [MX - 3 + (i + 0.5) * segW, DIA_Y, 0]))
    const backMat = glowMat(HIGH_V, 0.2)
    for (let i = 0; i < 7; i++) box(scene, [0.6, 0.3, 2.2], backMat, [MX - 3 + 0.15 + 0.3 + i * 0.87, BACK_Y, 0])
    addLabel(scene, 'backplate (fixed, perforated)', [MX, BACK_Y + 0.75, 1.3], LABEL, 0.32)
    addLabel(scene, 'diaphragm', [MX, DIA_Y - 0.9, 1.3], LABEL, 0.32)
    addLabel(scene, 'ASIC', [MX + 4.4, PCB_Y + 2.35, 1.1], GREY, 0.28)
    addLabel(scene, '← sound port', [MX + 4.4, PCB_Y - 1.1, 1.8], GREY, 0.32, 'left')
    addLabel(scene, 'INMP441 cut open (gap ×1000, bend exaggerated)', [MX, PCB_Y + 8.6, 0], GREY, 0.32)
    const pool = wavePool(scene, 9, 44, 0.12)
    const keep = (x: number, y: number) => y < PCB_Y - 0.5 || (Math.abs(x - MX) < 0.55 && y < DIA_Y - 0.2)

    const BK: V3 = [-1.2, 1.4, 0]
    const PINS = ['VDD', 'GND', 'L/R', 'WS', 'SCK', 'SD']
    const brk = i2cBreakout(scene, BK, { name: 'INMP441', color: '#1d4fa8', k: 0.3, pins: PINS })
    addLabel(scene, 'mic on the back', [BK[0], BK[1] - 2.9, 0.3], GREY, 0.26)
    const ESP: V3 = [-0.5, -7.2, 0]
    const espPin = esp32Board(scene, ESP, 0.42)
    const espIdx = [4, 3, 2, 1, 0, -1]
    const routes = PINS.map((name, i) => {
      const j = 5 - i
      const a = brk.pin(name)
      const b = espPin(espIdx[i], true)
      const top = a[1] + 0.8 + j * 0.28
      const right = 2.9 + j * 0.3
      const bottom = b[1] + 1.4 + (5 - j) * 0.2
      const pts: V3[] = [a, [a[0], top, a[2]], [right, top, a[2]], [right, bottom, a[2]], [b[0], bottom, a[2]], b]
      wire(scene, pts, 0.09)
      return pts
    })
    addLabel(scene, 'SD → GPIO32 · SCK → GPIO14 · WS → GPIO15 · L/R → GND', [ESP[0], ESP[1] - 3.2, 0.5], GREY, 0.28)
    const rays = [
      { ray: lightRay(scene, 14, 0.13, 0.5), pts: routes[5], color: DATA_COLOR },
      { ray: lightRay(scene, 20, 0.1, 1.6), pts: routes[4], color: CLK_COLOR },
      { ray: lightRay(scene, 4, 0.13, 0.15), pts: routes[3], color: HEAT },
    ]
    const sdText = liveLabel(scene, [ESP[0], ESP[1] - 4, 0.5], { size: 0.32 })

    const W = 13
    const H = 5.2
    const tScope = scope(scene, W, H, { divs: [8, 4] })
    tScope.group.position.set(12, 3.2, 0)
    const tTrace = tScope.trace(B_FIELD, { samples: 220, radius: 0.08 })
    const tTitle = liveLabel(scene, [12, 3.2 + H / 2 + 1, 0], { size: 0.36 })
    const fScope = scope(scene, W, H, { divs: [8, 6], zeroAt: 0 })
    fScope.group.position.set(12, -5.2, 0)
    const fTrace = fScope.trace(POWER, { samples: N_FFT / 2 + 1, radius: 0.07 })
    const fTitle = liveLabel(scene, [12, -5.2 + H / 2 + 1, 0], { size: 0.36 })
    addLabel(scene, '0', [12 - W / 2, -5.2 - H / 2 - 0.9, 0], GREY, 0.3)
    const fEnd = liveLabel(scene, [12 + W / 2, -5.2 - H / 2 - 0.9, 0], { size: 0.3, color: GREY })
    addLabel(scene, '0 dB', [12 + W / 2 + 0.8, -5.2 + H / 2, 0], GREY, 0.26, 'left')
    addLabel(scene, '−60', [12 + W / 2 + 0.8, -5.2 - H / 2, 0], GREY, 0.26, 'left')
    const text = textLines(scene, [-19, 10.2, 0])
    const s = { key: '', t: 0, bend: 0 }
    return {
      scene,
      view: { center: [0, -0.5, 0], radius: 72, polar: 1.3, azimuth: 0 },
      frame(dt, p) {
        const M = micSetup(p)
        if (M.key !== s.key) Object.assign(s, { key: M.key, t: 0 })
        s.t += dt
        const clap = M.kind === 'clap'
        const tc = clap ? s.t % CLAP_CYCLE : s.t
        const audio = clap ? (tc - ARRIVE) / MIC_SLOW : s.t / MIC_SLOW
        const loud = 0.35 + (0.65 * (M.spl - 60)) / 66
        pool.begin()
        if (clap) {
          for (let k = 0; k < 5; k++) {
            const r = tc * WAVE_V - k * 0.35
            if (r > 0 && r < 12.5) pool.put([MX, SRC_Y, 0.4], r, Math.PI / 2, 0.5, RING, loud * Math.exp(-k * 0.5), keep)
          }
        } else {
          const lam = 1.4
          for (let k = 0; k < 9; k++) {
            const r = frac((s.t * WAVE_V) / lam) * lam + k * lam
            if (r < 12.5) pool.put([MX, SRC_Y, 0.4], r, Math.PI / 2, 0.5, RING, loud * 0.75, keep)
          }
        }
        pool.end()

        const pr = soundAt(M.kind, audio, M.cut)
        const bendTo = Math.max(-1, Math.min(1, pr)) * (0.15 + 0.4 * loud)
        s.bend = bendTo
        dia.forEach((m, i) => {
          const x = -3 + (i + 0.5) * segW
          const u = (x + 2.5) / SPAN
          m.position.y = DIA_Y + (u > 0 && u < 1 ? Math.sin(Math.PI * u) * s.bend : 0)
        })
        setGlow(backMat, HIGH_V, 0.2 + 0.8 * Math.max(0, s.bend))

        const zoom = Math.min(1024, 2 ** Math.max(0, Math.floor(Math.log2(0.85 / M.peakFs))))
        const held = (t: number) => fsOf(M, soundAt(M.kind, Math.floor(t * M.fs) / M.fs, M.cut))
        tTrace.scroll((t) => held(t) * zoom * (H / 2) * 0.95, audio, SCOPE_WINDOW)
        tTitle.set(`SD samples at ${hertz(M.fs)}, last 4 ms${zoom > 1 ? ` · zoom ×${zoom}` : ''}`, M.dbfs > 0 ? HEAT : LABEL)
        const sp = spectrumOf(M)
        fTrace.draw((u) => ((sp.db[Math.round(u * (sp.db.length - 1))] + 60) / 60) * H - H / 2, null)
        fTitle.set(M.kind === 'whine' ? `Spectrum: peak ${hertz(dominantHz(sp.amps, M.fs, N_FFT))} + harmonics` : `Spectrum: broad, flatness ${sp.flatness.toFixed(2)}`, POWER)
        fEnd.set(`fs/2 = ${hertz(M.fs / 2)}`)

        const code = micCode(M.peakPa * soundAt(M.kind, Math.floor(audio * M.fs) / M.fs, M.cut))
        sdText.set(`SD ${hex24(code)} = ${code}  (24 bits in a 32-bit slot)`, DATA_COLOR)
        for (const r of rays) r.ray(r.pts, s.t, 1, r.color)
        const bits = pdmBits(Array.from({ length: 24 }, (_, i) => fsOf(M, soundAt(M.kind, audio + i / (64 * M.fs), M.cut))))
        text.a.set(micHeadline(M), M.dbfs > 0 ? HEAT : POWER)
        text.b.set(`p ${si(M.peakPa * pr, 'Pa', 2)} → x ${si(diaphragmShift(M.peakPa * pr), 'm', 2)} → C ${(micCapF(diaphragmShift(M.peakPa * pr)) * 1e12).toFixed(4)} pF`, LABEL)
        text.c.set(`inside: 1-bit ${bits.join('')}… → 24-bit PCM`, CLK_COLOR)
        text.status.set(`slowed ×${MIC_SLOW} · sim ${si(Math.max(0, audio), 's', 3)} · SCK ${hertz(i2sSck(M.fs))}, WS ${hertz(M.fs)} · gap 3 µm drawn ×1000`, GREY)
      },
      readouts: (p) => {
        const M = micSetup(p)
        const sp = spectrumOf(M)
        return [
          { label: 'Peak level', value: M.dbfs > 0 ? '0 dBFS, clip' : `${M.dbfs} dBFS`, tone: M.dbfs > 0 ? 'bad' : M.dbfs < -50 ? 'warn' : 'ok' },
          { label: 'ΔC at peak', value: si(M.dC, 'F', 3), tone: 'ok' },
          { label: 'SCK', value: hertz(i2sSck(M.fs)), tone: 'ok' },
          M.kind === 'whine'
            ? { label: 'Spectrum peak', value: hertz(dominantHz(sp.amps, M.fs, N_FFT)), tone: 'ok' }
            : { label: 'Flatness', value: sp.flatness.toFixed(2), tone: 'ok' },
        ]
      },
    }
  },
}

// --- Sound source direction: a far source's plane wave reaches each mic at a different time; cross-correlating two mics
// finds the delay → bearing. Two mics fold back onto front; four resolve 360°; a tone with mics > λ/2 apart is ambiguous. ---

const MIC_SETS: Record<MicSet, string> = { two: '2 mics', four: '4 mics' }
const DIR_SOUNDS: Record<'clap' | 'tone', string> = { clap: 'Clap', tone: `${TONE_HZ / 1000} kHz tone` }
const FS = 48000
const DIR_SLOW = 4000
const PX = 20
const RC: V3 = [-7, -3, 0]
const RING_R = 7.5
const V_SCENE = (SOUND_C * PX) / DIR_SLOW
const LAM = (SOUND_C / TONE_HZ) * PX
const DIR_CYCLE = 7
const FAR = 60
const MAX_ARROWS = 12

function dirSetup(p: Params) {
  const bearing = (n(p, 'bearing') * Math.PI) / 180
  const set = pick(MIC_SETS, p.mics, 'two')
  const kind = pick(DIR_SOUNDS, p.sound, 'clap') as Sound
  const d = n(p, 'spacing') / 100
  return { bearing, set, kind, d, key: `${n(p, 'bearing')}|${set}|${kind}|${d}` }
}
type DirSetup = ReturnType<typeof dirSetup>
const located = memoBy((D: DirSetup) => D.key, (D: DirSetup) => locate(D.kind, D.bearing, D.d, D.set, FS))
const angDiff = (a: number, b: number) => Math.abs(deg(Math.atan2(Math.sin(a - b), Math.cos(a - b))))

function dirHeadline(D: DirSetup, R: ReturnType<typeof located>) {
  if (R.candidates.length > 2 || (D.set === 'four' && R.candidates.length > 1)) return `Mics ${Math.round(D.d * 100)} cm apart ≥ λ/2 = ${si(SOUND_C / TONE_HZ / 2, 'm', 2)}: ${R.candidates.length} bearings fit`
  if (angDiff(R.estimate, D.bearing) > 8) return `Behind! Two mics hear ${degText(R.estimate)}: same delay as ${degText(D.bearing)}`
  if (D.set === 'two' && R.candidates.length === 1) return `Delay ${us(R.dtLR)} → ${degText(R.estimate)}: on the mic axis, front = back`
  if (D.set === 'two') return `Delay ${us(R.dtLR)} → ${degText(R.estimate)}, or ${degText(R.candidates[1] ?? R.estimate)} behind`
  return `Two pairs, atan2 → ${degText(R.estimate)} (true ${degText(D.bearing)})`
}

export const soundSourceDirection: Lesson = {
  id: 'microphone-sound-sound-source-direction',
  title: 'Sound source direction',
  tagline: 'Sound reaches the nearer mic first; cross-correlation finds that delay in samples, and the delay gives the bearing',
  formula: (p) => {
    const D = dirSetup(p)
    const R = located(D)
    const dt = tdoa(D.bearing, D.d)
    return `Δt = d·sin θ / c = ${Math.round(D.d * 100)} cm × sin ${degText(D.bearing)} / ${SOUND_C} m/s = ${us(dt)} = ${(dt * FS).toFixed(1)} samples at 48 kHz · peak at ${R.lagLR.toFixed(1)} → θ = asin(c·Δt / d) = ${degText(Math.asin(Math.max(-1, Math.min(1, (SOUND_C * R.dtLR) / D.d))))}${D.set === 'four' ? ` · 4 mics: θ = atan2(Δt_LR, Δt_FB) = ${degText(R.estimate)}` : ' (or 180° − θ)'}`
  },
  legend: [
    { color: RING, label: 'Wavefront from a far source (slowed)', shape: 'dot' },
    { color: POWER, label: 'Estimated bearing', shape: 'dot' },
    { color: HEAT, label: 'Bearings the delays can’t rule out', shape: 'dot' },
    { color: B_FIELD, label: 'L–R correlation; F–B in purple', shape: 'dot' },
  ],
  points: [
    'From a few metres away a sound arrives as a nearly flat wavefront. Two mics d apart on the robot hear it at different times: Δt = d·sin θ / c, with θ the bearing from straight ahead and c ≈ 343 m/s. 10 cm apart, that’s at most 0.29 ms.',
    'To measure Δt the ESP32 records both mics at once (one I²S stream, left and right slot) and cross-correlates them: slide one recording past the other and multiply-add. The lag with the biggest sum is the delay; a parabola through the top three points gets below one sample.',
    'At 48 kHz one sample is 21 µs, about 7 mm of travel, so close mics give coarse bearings: about 4° per sample at 10 cm straight ahead, and worse towards the sides where sin θ flattens. Wider spacing means finer steps.',
    'Two mics only measure the angle to their axis. A source at 30° and one at 150° (behind) give the same delay: the pair is symmetric front-to-back. A third or fourth mic on the other axis adds Δt along it, and atan2 of the two resolves all 360°.',
    'A clap is broadband, so its correlation has one sharp peak. A pure tone repeats every wavelength (17 cm at 2 kHz): once the mics are more than λ/2 apart, several lags match equally well and the bearing is ambiguous. Keep d < λ/2 for the highest frequency you use, or listen to broadband sounds.',
  ],
  controls: [
    { kind: 'slider', key: 'bearing', label: 'Source bearing', min: -180, max: 180, initial: 30, step: 5, format: (v) => `${v}°` },
    { kind: 'choice', key: 'mics', options: (Object.keys(MIC_SETS) as MicSet[]).map((k) => ({ value: k, label: MIC_SETS[k] })), initial: 'two' },
    { kind: 'slider', key: 'spacing', label: 'Mic spacing', min: 2, max: 40, initial: 10, step: 1, format: (v) => `${v} cm` },
    { kind: 'choice', key: 'sound', options: Object.entries(DIR_SOUNDS).map(([value, label]) => ({ value, label })), initial: 'clap' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const ringMat = glowMat(GREY, 0.25)
    add(scene, mesh(new THREE.TorusGeometry(RING_R, 0.05, 6, 96), ringMat), [RC[0], RC[1], -0.6]).castShadow = false
    for (const [a, t] of [[0, '0° front'], [90, '90°'], [180, '180° back'], [-90, '−90°']] as const) {
      const r = (a * Math.PI) / 180
      addLabel(scene, t, [RC[0] + (RING_R + 1) * Math.sin(r), RC[1] + (RING_R + 0.8) * Math.cos(r), 0], GREY, 0.32)
    }
    box(scene, [4.2, 5.4, 0.8], mat('#d8dbe2', { rough: 0.55 }), [RC[0], RC[1], -0.5])
    for (const s of [-1, 1]) box(scene, [0.9, 2.4, 1.1], mat('#1c1c1f', { rough: 0.8 }), [RC[0] + s * 2.6, RC[1] + 0.8, -0.4])
    addLabel(scene, '↑', [RC[0], RC[1] + 1.6, 0.2], GREY, 0.6)
    const mirror = add(scene, mesh(new THREE.BoxGeometry(2 * RING_R, 0.06, 0.06), glowMat(GREY, 0.4)), [RC[0], RC[1], 0.15])
    mirror.castShadow = false
    const mirrorTag = add(scene, textMesh('mirror line', { size: 0.28, color: GREY }), [RC[0] + RING_R - 1.3, RC[1] + 0.45, 0.2])
    mirrorTag.castShadow = false
    const armMat = mat('#2a2c33', { rough: 0.6 })
    const mics = (['L', 'R', 'F', 'B'] as const).map((name) => {
      const g = add(scene, new THREE.Group())
      cylinder(g, 0.42, 0.5, mat('#22242a', { rough: 0.5 }), [0, 0, 0], 'z', 20)
      const m = glowMat(GREY, 0.2)
      cylinder(g, 0.28, 0.1, m, [0, 0, 0.3], 'z', 20)
      add(g, mesh(new THREE.BoxGeometry(1, 0.22, 0.16), armMat), [0, 0, -0.1])
      const tag = add(scene, textMesh(name, { size: 0.38 }))
      tag.castShadow = false
      return { name, g, m, arm: g.children[2] as THREE.Mesh, tag }
    })
    const src = add(scene, new THREE.Group())
    const spk = speaker(src, [0, 0, 0], 0.9)
    const srcTag = liveLabel(scene, [0, 0, 0], { size: 0.32, color: RING })
    const pool = wavePool(scene, 8, 48, 0.11)
    const main = arrow(scene, [0, 0, 0], [0, 1, 0], POWER, 1.1)
    const ghosts = Array.from({ length: MAX_ARROWS }, () => arrow(scene, [0, 0, 0], [0, 1, 0], HEAT, 0.8))

    const W = 13
    const H = 5.4
    const recScope = scope(scene, W, H, { divs: [8, 4] })
    recScope.group.position.set(12, 3.2, 0)
    const recColors = { L: B_FIELD, R: HEAT, F: POWER, B: DATA_COLOR }
    const recTraces = (['L', 'R', 'F', 'B'] as const).map((k) => ({ k, tr: recScope.trace(recColors[k], { samples: 97, radius: 0.06 }) }))
    const recTags = (['L', 'R', 'F', 'B'] as const).map((k) => ({ k, l: liveLabel(scene, [12 - W / 2 - 0.7, 0, 0], { size: 0.34, color: recColors[k] }) }))
    addLabel(scene, 'Each mic, 48 kHz samples, 2 ms', [12, 3.2 + H / 2 + 1, 0], LABEL, 0.36)
    const corrScope = scope(scene, W, H, { divs: [8, 4] })
    corrScope.group.position.set(12, -5.4, 0)
    const lrTrace = corrScope.trace(B_FIELD, { samples: 160, radius: 0.07 })
    const fbTrace = corrScope.trace(DATA_COLOR, { samples: 160, radius: 0.07 })
    const bounds = [-1, 1].map(() => add(corrScope.group, mesh(new THREE.BoxGeometry(0.08, H, 0.08), glowMat(GREY, 0.5)), [0, 0, 0.3]))
    const corrTitle = liveLabel(scene, [12, -5.4 + H / 2 + 1, 0], { size: 0.36 })
    const lagL = liveLabel(scene, [12 - W / 2, -5.4 - H / 2 - 0.9, 0], { size: 0.3, color: GREY })
    const lagR = liveLabel(scene, [12 + W / 2, -5.4 - H / 2 - 0.9, 0], { size: 0.3, color: GREY })
    addLabel(scene, 'lag (samples)', [12, -5.4 - H / 2 - 0.9, 0], GREY, 0.3)
    const text = textLines(scene, [-19, 10.2, 0])
    const s = { key: '', t: 0 }
    const toWorld = (x: number, y: number): V3 => [RC[0] + x * PX, RC[1] + y * PX, 0]
    return {
      scene,
      view: { center: [0, -0.5, 0], radius: 72, polar: 1.3, azimuth: 0 },
      frame(dt, p) {
        const D = dirSetup(p)
        const R = located(D)
        const u: V3 = [Math.sin(D.bearing), Math.cos(D.bearing), 0]
        const layout = micArray(D.set, D.d)
        if (D.key !== s.key) {
          Object.assign(s, { key: D.key, t: 0 })
          src.position.set(RC[0] + RING_R * u[0], RC[1] + RING_R * u[1], 0.6)
          srcTag.group.position.set(RC[0] + (RING_R + 1.9) * u[0], RC[1] + (RING_R + 1.9) * u[1] - 0.3, 0.8)
          for (const m of mics) {
            const at = layout.find((q) => q.name === m.name)
            m.g.visible = m.tag.visible = !!at
            if (!at) continue
            const w = toWorld(at.x, at.y)
            m.g.position.set(w[0], w[1], 0.4)
            const len = Math.hypot(at.x, at.y) * PX
            m.arm.scale.x = len
            m.arm.position.set((-at.x * PX) / 2, (-at.y * PX) / 2, -0.1)
            m.arm.rotation.z = Math.atan2(at.y, at.x)
            m.tag.position.set(w[0] + Math.sign(at.x) * 0.95, w[1] + Math.sign(at.y) * 0.95 + (at.x ? -0.9 : 0), 0.6)
          }
          mirror.visible = mirrorTag.visible = D.set === 'two'
          main.position.set(RC[0] + 4.4 * Math.sin(R.estimate), RC[1] + 4.4 * Math.cos(R.estimate), 0.8)
          pointArrow(main, [Math.sin(R.estimate), Math.cos(R.estimate), 0])
          const others = R.candidates.filter((c) => angDiff(c, R.estimate) > 1)
          ghosts.forEach((g, i) => {
            const c = others[i]
            g.visible = c !== undefined
            if (c === undefined) return
            g.position.set(RC[0] + 4.6 * Math.sin(c), RC[1] + 4.6 * Math.cos(c), 0.7)
            pointArrow(g, [Math.sin(c), Math.cos(c), 0])
          })

          const i0 = 12
          const rows = D.set === 'two' ? ['L', 'R'] : ['L', 'R', 'F', 'B']
          const gap = H / (rows.length + 0.4)
          for (const { k, tr } of recTraces) {
            const row = rows.indexOf(k)
            tr.group.visible = row >= 0
            if (row < 0) continue
            const y0 = H / 2 - gap * (row + 0.7)
            const rec = R.rec[k]!
            tr.draw((v) => y0 + rec[i0 + Math.round(v * 96)] * gap * 0.45, null)
          }
          for (const { k, l } of recTags) {
            const row = rows.indexOf(k)
            l.group.visible = row >= 0
            l.group.position.y = 3.2 + H / 2 - gap * (row + 0.7)
            l.set(k)
          }
          const L = R.L
          const yC = (r: number[]) => (v: number) => {
            const j = Math.min(2 * L - 1, Math.floor(v * 2 * L))
            return (r[j] + (r[j + 1] - r[j]) * (v * 2 * L - j)) * (H / 2) * 0.9
          }
          lrTrace.draw(yC(R.lr), (R.lagLR + L) / (2 * L))
          fbTrace.group.visible = !!R.fb
          if (R.fb) fbTrace.draw(yC(R.fb), (R.lagFB + L) / (2 * L))
          const valid = maxLagSamples(D.d, FS)
          bounds.forEach((b, i) => (b.position.x = corrScope.xAt((L + (i ? 1 : -1) * valid) / (2 * L))))
          lagL.set(`−${L}`)
          lagR.set(`+${L}`)
          corrTitle.set(`Cross-correlation: L-R peak ${R.lagLR >= 0 ? '+' : ''}${R.lagLR.toFixed(1)}${R.fb ? `, F-B ${R.lagFB >= 0 ? '+' : ''}${R.lagFB.toFixed(1)}` : ''}`, B_FIELD)
          srcTag.set(D.kind === 'clap' ? 'clap' : `${TONE_HZ / 1000} kHz`)
        }
        s.t += dt
        const clap = D.kind === 'clap'
        const tc = clap ? s.t % DIR_CYCLE : s.t
        const span = 2 * RING_R
        const keep = (x: number, y: number) => Math.hypot(x - RC[0], y - RC[1]) < RING_R - 0.2
        const center: V3 = [RC[0] + (RING_R + FAR) * u[0], RC[1] + (RING_R + FAR) * u[1], 0.2]
        const heading = Math.atan2(-u[1], -u[0])
        pool.begin()
        const front = (q: number, f: number) => {
          if (q > 0 && q < span) pool.put(center, FAR + q, heading, RING_R / (FAR + q), RING, f, keep)
        }
        if (clap) for (let k = 0; k < 3; k++) front(tc * V_SCENE - k * 0.3, 0.95 * Math.exp(-k * 0.6))
        else for (let k = 0; k < 6; k++) front(frac((s.t * V_SCENE) / LAM) * LAM + k * LAM, 0.7)
        pool.end()
        for (const m of mics) {
          const at = layout.find((q) => q.name === m.name)
          if (!at) continue
          const q = RING_R - (at.x * u[0] + at.y * u[1]) * PX
          const pr = clap ? Math.exp(-(((tc * V_SCENE - q) / 0.45) ** 2)) : Math.sin((2 * Math.PI * (s.t * V_SCENE - q)) / LAM)
          setGlow(m.m, pr >= 0 ? HIGH_V : LOW_V, 0.2 + 1.2 * Math.abs(pr))
        }
        spk.set(clap ? Math.exp(-tc * 6) : Math.sin((2 * Math.PI * s.t * V_SCENE) / LAM), clap ? Math.exp(-tc * 2) : 0.7, dt)

        const valid = maxLagSamples(D.d, FS)
        const dt0 = tdoa(D.bearing, D.d)
        const ambiguous = R.candidates.length > (D.set === 'two' ? 2 : 1)
        const wrong = angDiff(R.estimate, D.bearing) > 8
        text.a.set(dirHeadline(D, R), ambiguous || wrong ? HEAT : POWER)
        text.b.set(`Δt = ${Math.round(D.d * 100)} cm × sin ${degText(D.bearing)} / c = ${us(dt0)} = ${(dt0 * FS).toFixed(1)} samples (max ±${valid.toFixed(1)})`, LABEL)
        text.c.set(`${D.kind === 'tone' ? `λ = ${si(SOUND_C / TONE_HZ, 'm', 2)}, ${spatialAliasing(D.d, TONE_HZ) ? 'mics ≥ λ/2: aliased' : 'mics < λ/2: one peak'} · ` : ''}≈ ${deg(bearingStep(D.d, FS)).toFixed(1)}° per sample ahead`, D.kind === 'tone' && spatialAliasing(D.d, TONE_HZ) ? HEAT : B_FIELD)
        text.status.set(`slowed ×${DIR_SLOW} · sim ${si(tc / DIR_SLOW, 's', 3)} · 48 kHz · far source, mics to scale`, GREY)
      },
      readouts: (p) => {
        const D = dirSetup(p)
        const R = located(D)
        const ambiguous = R.candidates.length > (D.set === 'two' ? 2 : 1)
        return [
          { label: 'Delay L→R', value: us(R.dtLR), tone: 'ok' },
          { label: 'Peak lag', value: `${R.lagLR.toFixed(1)} smp`, tone: Math.abs(R.lagLR) < 2 && D.d < 0.05 ? 'warn' : 'ok' },
          { label: 'Bearing', value: degText(R.estimate), tone: angDiff(R.estimate, D.bearing) > 8 ? 'bad' : 'ok' },
          { label: 'Candidates', value: `${R.candidates.length}`, tone: ambiguous ? 'bad' : R.candidates.length > 1 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
