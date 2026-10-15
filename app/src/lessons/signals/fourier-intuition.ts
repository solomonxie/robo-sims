import * as THREE from 'three/webgpu'
import {
  Harmonic,
  Periodic,
  aliasFrequency,
  dftAmplitudes,
  fourierTerms,
  nyquist,
  periodicAt,
  rcGain,
  rcPhase,
  seriesPeak,
  seriesRmsError,
} from '../../core/physics'
import { fitDigits, pct, si } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh, rod } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  emptyGroup,
  frac,
  glide,
  glowBox,
  glowMat,
  label,
  memoBy,
  presence,
  pulseLabel,
  scope,
  ticks,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const hz = (f: number) => si(f, 'Hz', 3)
const TAU = 2 * Math.PI
const text = (parent: THREE.Object3D, s: string, at: V3, color = GREY, size = 0.6, align: 'left' | 'center' | 'right' = 'center') =>
  add(parent, label(s, { size, color, align }), at)

/** A thin glowing bar whose height and x are set per frame; `set(x, h)` grows it up from y = 0. */
function bar(parent: THREE.Object3D, color: string, width: number, depth = 0.3) {
  const m = add(parent, mesh(new THREE.BoxGeometry(1, 1, 1), glowMat(color, 0.8)))
  m.castShadow = false
  return {
    mesh: m,
    set(x: number, h: number, y0 = 0) {
      m.visible = h > 0.01
      m.scale.set(width, Math.max(0.001, h), depth)
      m.position.set(x, y0 + h / 2, 0.35)
    },
  }
}

/** A vertical glowing marker line from `bottom` to `top`; `setX` slides it. */
function vMarker(parent: THREE.Object3D, color: string, bottom: number, top: number) {
  const m = add(parent, mesh(new THREE.CylinderGeometry(0.06, 0.06, top - bottom, 8), glowMat(color, 0.9)), [0, (top + bottom) / 2, 0.4])
  m.castShadow = false
  return m
}

// --- Spectrum: a chain of rotating phasors, one per harmonic, adds sines into a square, saw or triangle. ---

const SHAPES: Record<Periodic, string> = { square: 'Square', saw: 'Saw', triangle: 'Triangle' }
const F0 = 100
const MAX_K = 25
const CYCLE_S = 4
const AMP = 3.6
const EPI_X = -19
const ROW_Y = 2.6
const SC_X = 2
const SC_W = 18
const SC_H = 10
const SP_Y = -6.6
const SP_H = 4.2
const colorOf = (k: number) => `#${new THREE.Color().setHSL(frac(0.5 + 0.083 * (k - 1)), 0.85, 0.62).getHexString()}`
const shapeOf = (p: Params): Periodic => (String(p.shape) in SHAPES ? (p.shape as Periodic) : 'square')

const solveSeries = memoBy(
  (p: Params) => `${shapeOf(p)}|${n(p, 'k')}`,
  (p: Params) => {
    const shape = shapeOf(p)
    const maxK = Math.round(n(p, 'k'))
    const terms = fourierTerms(shape, maxK)
    const peak = seriesPeak(terms)
    return { shape, maxK, terms, peak, overshoot: Math.max(0, (peak - 1) / 2), err: seriesRmsError(shape, terms) }
  },
)

const FORMULAS: Record<Periodic, string> = {
  square: '4/π (sin ωt + sin 3ωt / 3 + sin 5ωt / 5 + …)',
  saw: '2/π (sin ωt − sin 2ωt / 2 + sin 3ωt / 3 − …)',
  triangle: '8/π² (sin ωt − sin 3ωt / 9 + sin 5ωt / 25 − …)',
}

export const spectrum: Lesson = {
  id: 'fourier-intuition-spectrum',
  title: 'Spectrum',
  tagline: 'Every signal is a sum of sines',
  formula: (p) => {
    const s = solveSeries(p)
    return `${SHAPES[s.shape]} = ${FORMULAS[s.shape]} · ${s.terms.length} terms up to ${s.maxK}ω: peak ${s.peak.toFixed(3)}, RMS error ${pct(s.err)}`
  },
  legend: [
    { color: B_FIELD, label: 'Sum of the sines so far', shape: 'dot' },
    { color: LABEL, label: 'The ideal wave', shape: 'dot' },
    { color: RING, label: 'Overshoot at the jumps', shape: 'dot' },
  ],
  points: [
    'Fourier: any repeating signal is a sum of sines at whole multiples of its frequency, the harmonics. Each circle on the left is one sine: a phasor spinning k times per cycle, its size the amplitude.',
    'Stack them tip to tail and the last tip’s height traces the wave. Add circles (the slider) and the blue sum hugs the grey ideal wave closer.',
    'The bars below are the same signal seen as a spectrum: one bar per harmonic, its height the amplitude. Time view and frequency view hold exactly the same information.',
    'A square wave is odd harmonics only, at 1, 1/3, 1/5, … A saw uses every harmonic. A triangle’s fall as 1/k², so three terms already look right: smooth shapes need few harmonics, sharp edges need many.',
    'Gibbs: at a jump the sum overshoots by about 9 % of the step, and more terms only make the spike narrower, never lower. Ringing on a fast edge is this.',
    'At 100 Hz, a square edge needs harmonics far above 100 Hz. Cut them (a low-pass, a slow wire) and the edges round off. Time slowed 400×: one cycle takes 4 s.',
  ],
  controls: [
    { kind: 'choice', key: 'shape', options: Object.entries(SHAPES).map(([value, l]) => ({ value, label: l })), initial: 'square' },
    { kind: 'slider', key: 'k', label: 'Highest harmonic', min: 1, max: MAX_K, initial: 7, step: 1, format: (v) => `${Math.round(v)} · ${hz(Math.round(v) * F0)}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const epi = add(scene, new THREE.Group(), [EPI_X, ROW_Y, 0])
    const chain = add(epi, new THREE.Group())
    const link = add(scene, mesh(new THREE.BoxGeometry(1, 0.07, 0.07), glowMat(B_FIELD, 0.6)))
    link.castShadow = false
    const pen = add(scene, mesh(new THREE.SphereGeometry(0.42, 18, 12), glowMat(B_FIELD, 1.3)))

    const screen = scope(scene, SC_W, SC_H, { divs: [8, 6] })
    screen.group.position.set(SC_X, ROW_Y, 0)
    const ideal = screen.trace(LABEL, { samples: 400, radius: 0.07 })
    ideal.material.emissiveIntensity = 0.35
    const sum = screen.trace(B_FIELD, { samples: 400, radius: 0.14 })
    const peaks = [screen.level(RING), screen.level(RING)]
    text(scene, 'TIME', [SC_X - SC_W / 2, ROW_Y + SC_H / 2 + 1.3, 0], LABEL, 0.8, 'left')
    text(scene, '2 CYCLES', [SC_X + SC_W / 2, ROW_Y + SC_H / 2 + 1.3, 0], GREY, 0.55, 'right')

    const plot = scope(scene, SC_W, SP_H, { divs: [5, 2], zeroAt: 0 })
    plot.group.position.set(SC_X, SP_Y, 0)
    const bx = (k: number) => plot.xAt((k - 0.5) / MAX_K)
    let perAmp = 1
    const ghosts = Array.from({ length: MAX_K }, () => bar(plot.group, GREY, 0.18, 0.12))
    for (const g of ghosts) (g.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.15
    const bars = Array.from({ length: MAX_K }, (_, i) => bar(plot.group, colorOf(i + 1), 0.46))
    ticks(plot, [1, 5, 10, 15, 20, 25].map((k) => [(k - 0.5) / MAX_K, String(k)] as [number, string]), [], 0.6)
    text(scene, 'FREQUENCY', [SC_X - SC_W / 2, SP_Y + SP_H / 2 + 1.1, 0], LABEL, 0.8, 'left')
    text(scene, 'HARMONIC  × 100 HZ', [SC_X + SC_W / 2, SP_Y + SP_H / 2 + 1.1, 0], GREY, 0.55, 'right')
    const count = pulseLabel(scene, 2, B_FIELD, [EPI_X + 1.4, SP_Y - 0.4, 0], 1.3)
    text(scene, 'SINES', [EPI_X - 0.4, SP_Y - 0.4, 0], B_FIELD, 0.7, 'right')

    interface Ring {
      h: Harmonic
      group: THREE.Group
      arm: THREE.Group
      w: number
    }
    const st = { cyc: 0, shape: '' as Periodic | '', rings: [] as Ring[], w: new Array(MAX_K + 1).fill(0) as number[] }
    const rebuild = (shape: Periodic) => {
      emptyGroup(chain)
      st.rings = fourierTerms(shape, MAX_K).map((h) => {
        const r = Math.abs(h.amp) * AMP
        const group = add(chain, new THREE.Group())
        const faint = glowMat(colorOf(h.k), 0.25)
        add(group, mesh(new THREE.TorusGeometry(r, Math.min(0.07, 0.03 + r * 0.012), 6, 72), faint)).castShadow = false
        const arm = add(group, new THREE.Group())
        rod(arm, [0, 0, 0.1], [r, 0, 0.1], Math.min(0.1, 0.03 + r * 0.02), glowMat(colorOf(h.k), 0.8))
        add(arm, mesh(new THREE.SphereGeometry(Math.min(0.22, 0.06 + r * 0.05), 12, 8), glowMat(colorOf(h.k), 1.1)), [r, 0, 0.1])
        return { h, group, arm, w: 0 }
      })
      const amps = new Map(st.rings.map((r) => [r.h.k, Math.abs(r.h.amp)]))
      perAmp = (SP_H * 0.9) / Math.abs(st.rings[0].h.amp)
      ghosts.forEach((g, i) => g.set(bx(i + 1), (amps.get(i + 1) ?? 0) * perAmp, -SP_H / 2))
    }
    const partial = (c: number) => st.rings.reduce((s, r) => s + r.w * r.h.amp * Math.sin(TAU * r.h.k * c), 0) * AMP

    return {
      scene,
      view: { center: [-5.4, -0.6, 0], radius: 64, polar: 1.42, azimuth: 0.06 },
      frame(dt, p) {
        const s = solveSeries(p)
        const fresh = s.shape !== st.shape
        if (fresh) {
          st.shape = s.shape
          rebuild(s.shape)
        }
        st.cyc += dt / CYCLE_S
        let x = 0
        let y = 0
        for (const r of st.rings) {
          r.w = fresh && st.cyc < 0.1 ? Number(r.h.k <= s.maxK) : glide(dt, r.w, r.h.k <= s.maxK ? 1 : 0, 7)
          presence(r.group, r.w)
          r.group.position.set(x, y, 0)
          const angle = TAU * r.h.k * st.cyc + (r.h.amp < 0 ? Math.PI : 0)
          r.arm.rotation.z = angle
          const len = Math.abs(r.h.amp) * AMP * r.w
          x += len * Math.cos(angle)
          y += len * Math.sin(angle)
        }
        const tip: V3 = [EPI_X + x, ROW_Y + y, 0.1]
        pen.position.set(...tip)
        const edge = SC_X - SC_W / 2
        link.scale.x = Math.max(0.01, edge - tip[0])
        link.position.set((edge + tip[0]) / 2, tip[1], 0.1)
        sum.scroll(partial, st.cyc, 2, 'left')
        ideal.scroll((c) => periodicAt(s.shape, c) * AMP, st.cyc, 2, 'left')
        const showPeak = s.shape !== 'triangle'
        peaks[0].set(showPeak ? s.peak * AMP : 1e3)
        peaks[1].set(showPeak ? -s.peak * AMP : 1e3)
        const byK = new Map(st.rings.map((r) => [r.h.k, r]))
        bars.forEach((b, i) => {
          const r = byK.get(i + 1)
          b.set(bx(i + 1), r ? Math.abs(r.h.amp) * perAmp * r.w : 0, -SP_H / 2)
        })
        count.show(String(s.terms.length))
        count.frame(dt)
      },
      readouts: (p) => {
        const s = solveSeries(p)
        return [
          { label: 'Sines added', value: `${s.terms.length} · up to ${hz(s.maxK * F0)}` },
          {
            label: 'Overshoot at jump',
            value: s.shape === 'triangle' ? 'none, no jumps' : `${pct(s.overshoot)} of the step`,
            tone: s.shape === 'triangle' ? 'ok' : s.overshoot > 0.07 ? 'warn' : undefined,
          },
          { label: 'RMS error', value: pct(s.err), tone: s.err < 0.1 ? 'ok' : undefined },
          { label: 'Time slowed', value: `${F0 * CYCLE_S}× · f = ${hz(F0)}` },
        ]
      },
    }
  },
}

// --- Aliasing: a spinning wheel seen by a strobe / ADC at fs, and the slower sine that fits the same dots. ---

const SAMPLE_S = 0.3
const WIN = 10
const AL_F_MAX = 120
const WHEEL_X = -17
const AS_X = 3
const AS_W = 19
const AS_H = 8.4
const AS_Y = 2.8
const FL_Y = -6.4
const FL_H = 3.4

const solveAlias = (p: Params) => {
  const f = n(p, 'f')
  const fs = n(p, 'fs')
  const fa = aliasFrequency(f, fs)
  const seen = Math.abs(fa) < 0.05 ? 0 : fa
  return { f, fs, fa: seen, perCycle: fs / f, dir: seen === 0 ? 'standing still' : seen > 0 ? 'forwards' : 'backwards' }
}

export const aliasing: Lesson = {
  id: 'fourier-intuition-aliasing',
  title: 'Aliasing',
  tagline: 'Sample too slowly and a fast signal poses as a slow one',
  formula: (p) => {
    const s = solveAlias(p)
    return `f_seen = f − fs · round(f / fs) = ${+s.f.toFixed(1)} − ${s.fs} × ${Math.round(s.f / s.fs)} = ${+s.fa.toFixed(1)} Hz (${s.dir})`
  },
  legend: [
    { color: HIGH_V, label: 'The real signal', shape: 'dot' },
    { color: RING, label: 'Samples / strobe flashes', shape: 'dot' },
    { color: B_FIELD, label: 'What the samples look like', shape: 'dot' },
  ],
  points: [
    'An ADC doesn’t watch a signal, it takes snapshots: fs of them per second. Between snapshots it’s blind.',
    'The wheel spins at f and is only seen at each flash, like a camera filming a propeller. Set f just under fs: each flash catches it slightly short of a full turn, so it seems to creep backwards.',
    'On the scope the red sine is real, the gold dots are what the ADC records. The blue sine passes through the same dots: from the samples alone there’s no telling them apart. That impostor is an alias.',
    'The alias sits at f − fs × round(f / fs): fs = 50 Hz turns 48 Hz into −2 Hz and 52 Hz into +2 Hz. Only below fs/2 does every signal keep its own frequency.',
    'Bottom strip: the real tone (red) and where it lands (blue), folded back into 0 … fs/2 like paper at the gold line.',
    `Time slowed so each sample takes ${SAMPLE_S} s.`,
  ],
  controls: [
    { kind: 'slider', key: 'f', label: 'Signal frequency f', min: 1, max: AL_F_MAX, initial: 48, step: 0.5, format: hz },
    { kind: 'slider', key: 'fs', label: 'Sample rate fs', min: 20, max: 100, initial: 50, step: 1, format: hz },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const wheel = add(scene, new THREE.Group(), [WHEEL_X, AS_Y, 0])
    cylinder(wheel, 4.4, 0.4, mat('#2a2c32', { rough: 0.5 }), [0, 0, -0.4], 'z', 64)
    cylinder(wheel, 0.7, 0.9, mat('#b9bec6', { metal: 0.4, rough: 0.4 }), [0, 0, 0.2], 'z', 24)
    const rotor = add(wheel, new THREE.Group(), [0, 0, 0.3])
    for (let k = 0; k < 3; k++) {
      const blade = add(rotor, new THREE.Group())
      blade.rotation.z = (k * TAU) / 3
      box(blade, [3.4, 0.9, 0.18], k ? mat('#c9ced8', { rough: 0.5 }) : glowMat(HIGH_V, 0.7), [2.2, 0, 0])
    }
    const flashMat = glowMat(RING, 1.4)
    const flash = add(wheel, mesh(new THREE.TorusGeometry(4.7, 0.16, 8, 96), flashMat), [0, 0, 0])
    flash.castShadow = false
    text(scene, 'FLASH AT FS', [WHEEL_X, AS_Y - 6, 0], RING, 0.7)
    const seenLabel = pulseLabel(scene, 4, B_FIELD, [WHEEL_X + 0.6, AS_Y - 8.4, 0], 1.3)
    text(scene, 'HZ', [WHEEL_X + 3.6, AS_Y - 8.4, 0], B_FIELD, 0.7, 'left')
    text(scene, 'SEEN', [WHEEL_X - 2.6, AS_Y - 8.4, 0], B_FIELD, 0.7, 'right')

    const screen = scope(scene, AS_W, AS_H, { divs: [WIN, 4] })
    screen.group.position.set(AS_X, AS_Y, 0)
    const real = screen.trace(HIGH_V, { samples: 720, radius: 0.07 })
    const alias = screen.trace(B_FIELD, { samples: 240, radius: 0.15 })
    const amp = AS_H * 0.42
    const dotMat = glowMat(RING, 1.3)
    const stemMat = glowMat(RING, 0.5)
    const dots = Array.from({ length: WIN + 2 }, () => {
      const dot = add(screen.group, mesh(new THREE.SphereGeometry(0.36, 16, 10), dotMat))
      const stem = add(screen.group, mesh(new THREE.BoxGeometry(0.08, 1, 0.08), stemMat))
      dot.castShadow = stem.castShadow = false
      return { dot, stem }
    })
    text(scene, `${WIN} SAMPLES`, [AS_X + AS_W / 2, AS_Y + AS_H / 2 + 1.2, 0], GREY, 0.55, 'right')
    text(scene, 'TIME', [AS_X - AS_W / 2, AS_Y + AS_H / 2 + 1.2, 0], LABEL, 0.8, 'left')

    const strip = scope(scene, AS_W, FL_H, { divs: [6, 1], zeroAt: 0 })
    strip.group.position.set(AS_X, FL_Y, 0)
    const fx = (f: number) => strip.xAt(Math.min(1, Math.max(0, f / AL_F_MAX)))
    const shade = glowBox(strip.group, [1, FL_H, 0.1], [0, 0, 0.2], HIGH_V, 0.05)
    shade.m.emissiveIntensity = 0.05
    const halfLine = vMarker(strip.group, RING, -FL_H / 2, FL_H / 2 + 0.6)
    const fsLine = vMarker(strip.group, GREY, -FL_H / 2, FL_H / 2)
    const realBar = bar(strip.group, HIGH_V, 0.4)
    const aliasBar = bar(strip.group, B_FIELD, 0.5)
    ticks(strip, [0, 20, 40, 60, 80, 100, 120].map((f) => [f / AL_F_MAX, String(f)] as [number, string]), [], 0.6)
    text(scene, 'HZ', [AS_X + AS_W / 2 + 1.2, FL_Y - FL_H / 2 - 0.9, 0], GREY, 0.6, 'left')
    const fsText = add(strip.group, new THREE.Group(), [0, FL_H / 2 + 1.3, 0])
    add(fsText, label('FS/2', { size: 0.6, color: RING }))

    const st = { s: 0 }
    return {
      scene,
      view: { center: [-3.6, -0.4, 0], radius: 64, polar: 1.42, azimuth: 0.06 },
      frame(dt, p) {
        const a = solveAlias(p)
        st.s += dt / SAMPLE_S
        const ratio = a.f / a.fs
        const fa = aliasFrequency(a.f, a.fs) / a.fs
        const now = st.s
        const t0 = now - WIN
        real.scroll((s) => amp * Math.sin(TAU * ratio * s), now, WIN)
        alias.scroll((s) => amp * Math.sin(TAU * fa * s), now, WIN)
        const first = Math.ceil(t0)
        dots.forEach((d, i) => {
          const s = first + i
          const on = s <= now
          d.dot.visible = d.stem.visible = on
          if (!on) return
          const x = screen.xAt((s - t0) / WIN)
          const y = amp * Math.sin(TAU * ratio * s)
          d.dot.position.set(x, y, 0.4)
          d.stem.scale.y = Math.max(0.01, Math.abs(y))
          d.stem.position.set(x, y / 2, 0.35)
        })
        rotor.rotation.z = -TAU * ratio * Math.floor(now)
        flashMat.emissiveIntensity = 0.1 + 1.6 * Math.max(0, 1 - frac(now) * 4)

        const half = nyquist(a.fs)
        const hx = fx(half)
        halfLine.position.x = hx
        fsText.position.x = hx
        fsLine.position.x = fx(a.fs)
        fsLine.visible = a.fs <= AL_F_MAX
        const right = AS_W / 2
        shade.mesh.scale.x = Math.max(0.01, right - hx)
        shade.mesh.position.x = (right + hx) / 2
        realBar.set(fx(a.f), FL_H * 0.85, -FL_H / 2)
        aliasBar.set(fx(Math.abs(a.fa)), FL_H * 0.6, -FL_H / 2)
        seenLabel.show(fitDigits(Math.abs(a.fa), 3))
        seenLabel.frame(dt)
      },
      readouts: (p) => {
        const s = solveAlias(p)
        const ok = s.perCycle > 2
        return [
          { label: 'Samples per cycle', value: `${+s.perCycle.toPrecision(3)} · need > 2`, tone: ok ? 'ok' : 'bad' },
          { label: 'Looks like', value: `${hz(Math.abs(s.fa))} ${s.dir}`, tone: ok ? 'ok' : 'warn' },
          { label: 'Nyquist fs/2', value: hz(nyquist(s.fs)) },
          { label: 'Time slowed', value: `${+(s.fs * SAMPLE_S).toPrecision(2)}×` },
        ]
      },
    }
  },
}

// --- Nyquist: a slow sensor with motor hash at 600 Hz and up. Sample above twice the highest tone, or filter first. ---

interface Tone {
  hz: number
  amp: number
  ph: number
  motor?: boolean
}
const TONES: Tone[] = [
  { hz: 2, amp: 0.8, ph: 0 },
  { hz: 5, amp: 0.3, ph: 1.1 },
  { hz: 600, amp: 0.35, ph: 0.4, motor: true },
  { hz: 1200, amp: 0.15, ph: 2.2, motor: true },
  { hz: 1800, amp: 0.08, ph: 4.1, motor: true },
]
const MID = 1.65
const FC_AA = 20
const SLOW = 4
const DFT_N = 256
const SPEC_MAX = 2400
type Guard = 'none' | 'rc' | 'code'
const GUARDS: Record<Guard, string> = { none: 'No filter', rc: 'RC before ADC', code: 'Average in code' }
const guardOf = (p: Params): Guard => (String(p.guard) in GUARDS ? (p.guard as Guard) : 'none')

/** Each tone as it reaches the pin (`pin`) and as it shows in the readings: folded to fa, scaled by whichever filter acts. */
function shaped(guard: Guard, fs: number) {
  return TONES.map((t) => {
    const fa = aliasFrequency(t.hz, fs)
    const pin = guard === 'rc' ? { amp: t.amp * rcGain('low', t.hz, FC_AA), ph: t.ph + rcPhase('low', t.hz, FC_AA) } : { amp: t.amp, ph: t.ph }
    const read =
      guard === 'code' ? { amp: t.amp * rcGain('low', Math.abs(fa), FC_AA), ph: t.ph + Math.sign(fa) * rcPhase('low', Math.abs(fa), FC_AA) } : pin
    return { ...t, fa, pin, read }
  })
}
type Shaped = ReturnType<typeof shaped>

const pinAt = (tones: Shaped, t: number) => tones.reduce((s, x) => s + x.pin.amp * Math.sin(TAU * x.hz * t + x.pin.ph), MID)
const readAt = (tones: Shaped, i: number, fs: number) => tones.reduce((s, x) => s + x.read.amp * Math.sin((TAU * x.fa * i) / fs + x.read.ph), MID)
const rms = (amps: number[]) => Math.sqrt(amps.reduce((s, a) => s + (a * a) / 2, 0))

const solveNyquist = memoBy(
  (p: Params) => `${guardOf(p)}|${Math.round(n(p, 'fs'))}`,
  (p: Params) => {
    const guard = guardOf(p)
    const fs = Math.round(n(p, 'fs'))
    const tones = shaped(guard, fs)
    const readings = Array.from({ length: DFT_N }, (_, i) => readAt(tones, i, fs) - MID)
    const sensorRms = rms(TONES.filter((t) => !t.motor).map((t) => t.amp))
    const noise = rms(tones.filter((t) => t.motor).map((t) => t.read.amp)) / sensorRms
    const hum = tones.find((t) => t.motor)!
    return { guard, fs, tones, spectrum: dftAmplitudes(readings, true), noise, humAt: Math.abs(hum.fa), aliased: fs < 2 * 1800 }
  },
)

export const nyquistLimit: Lesson = {
  id: 'fourier-intuition-nyquist',
  title: 'Nyquist',
  tagline: 'Sample above twice the fastest tone, or filter first',
  formula: (p) => {
    const s = solveNyquist(p)
    return `fs > 2 × f_max: fs/2 = ${hz(nyquist(s.fs))}; the 600 Hz motor hum lands at |600 − ${s.fs} × ${Math.round(600 / s.fs)}| = ${hz(s.humAt)}`
  },
  legend: [
    { color: HIGH_V, label: 'Voltage at the ADC pin', shape: 'dot' },
    { color: B_FIELD, label: 'ADC readings, after any code filter', shape: 'dot' },
    { color: RING, label: 'fs/2: the Nyquist limit', shape: 'dot' },
  ],
  points: [
    'A line sensor changes at a few Hz, but its wire runs past the motors: brush hash at 600, 1200 and 1800 Hz rides on top (top-right spectrum, orange).',
    'Nyquist: sampling at fs keeps every tone below fs/2 intact. Anything above folds back below it, and once it’s in the readings no code can tell it from the real signal.',
    'Try fs = 620 Hz with no filter: the 600 Hz hum folds to 20 Hz and the readings wobble right where the sensor lives. A Pi Pico or ESP32 loop sampling at an unlucky rate does exactly this.',
    'Fix 1: sample faster than 3.6 kHz, twice the highest tone. Fix 2: an RC low-pass before the ADC (fc = 20 Hz) drains the hash before it is sampled: the anti-alias filter.',
    'Averaging in code comes too late: it can only cut what lands high in the readings band. A hum folded to 20 Hz looks just like signal and stays.',
    `Bottom-right is the DFT of ${DFT_N} readings: what the ADC sees, from 0 to fs/2. Time on the scope slowed ${SLOW}×.`,
  ],
  controls: [
    { kind: 'choice', key: 'guard', options: Object.entries(GUARDS).map(([value, l]) => ({ value, label: l })), initial: 'none' },
    { kind: 'slider', key: 'fs', label: 'Sample rate fs', min: 100, max: 4000, initial: 620, log: true, format: (v) => hz(Math.round(v)) },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const TX = -8.2
    const TW = 16
    const TH = 10
    const perV = (TH * 0.92) / 3.3
    const vy = (v: number) => v * perV - TH / 2 + 0.2
    const screen = scope(scene, TW, TH, { divs: [10, 6], zeroAt: 0.02 })
    screen.group.position.set(TX, 0.6, 0)
    const BINS = 480
    const pinTrace = screen.trace(HIGH_V, { samples: 2 * BINS, radius: 0.05 })
    const readTrace = screen.trace(B_FIELD, { samples: 2 * BINS, radius: 0.1 })
    readTrace.group.position.z = 0.08
    text(scene, 'TIME', [TX - TW / 2, 0.6 + TH / 2 + 1.2, 0], LABEL, 0.8, 'left')
    text(scene, '1 S', [TX + TW / 2, 0.6 + TH / 2 + 1.2, 0], GREY, 0.6, 'right')

    const PX = 11.6
    const PW = 13
    const PH = 4.2
    const pinPlot = scope(scene, PW, PH, { divs: [6, 2], zeroAt: 0 })
    pinPlot.group.position.set(PX, 3.6, 0)
    const perAmp = (PH * 0.9) / 0.85
    const px = (f: number) => pinPlot.xAt(Math.min(1, f / SPEC_MAX))
    const toneBars = TONES.map((t) => bar(pinPlot.group, t.motor ? HEAT : POWER, 0.34))
    const shade = glowBox(pinPlot.group, [1, PH, 0.1], [0, 0, 0.2], HIGH_V, 0.05)
    shade.m.emissiveIntensity = 0.05
    const half = vMarker(pinPlot.group, RING, -PH / 2, PH / 2 + 0.5)
    ticks(pinPlot, [0, 800, 1600, 2400].map((f) => [f / SPEC_MAX, String(f)] as [number, string]), [], 0.55)
    text(scene, 'AT THE PIN', [PX - PW / 2, 3.6 + PH / 2 + 1.1, 0], LABEL, 0.7, 'left')
    text(scene, 'HZ', [PX + PW / 2 + 1.1, 3.6 - PH / 2 - 0.9, 0], GREY, 0.55, 'left')

    const readPlot = scope(scene, PW, PH, { divs: [4, 2], zeroAt: 0 })
    readPlot.group.position.set(PX, -5.4, 0)
    const specTrace = readPlot.trace(B_FIELD, { samples: DFT_N / 2 + 1, radius: 0.09 })
    text(scene, 'IN THE READINGS', [PX - PW / 2, -5.4 + PH / 2 + 1.1, 0], LABEL, 0.7, 'left')
    text(scene, '0', [PX - PW / 2, -5.4 - PH / 2 - 0.9, 0], GREY, 0.6)
    const fsHalf = pulseLabel(scene, 4, RING, [PX + PW / 2 - 2.2, -5.4 - PH / 2 - 1.1, 0], 0.9)
    text(scene, 'HZ', [PX + PW / 2 + 1.1, -5.4 - PH / 2 - 1.1, 0], GREY, 0.55, 'left')
    const humMark = vMarker(readPlot.group, HEAT, -PH / 2, -PH / 2 + 0.7)

    const SUB = 10
    const pinY = new Array<number>(2 * BINS).fill(0)
    const readY = new Array<number>(2 * BINS).fill(0)
    /** Min and max per bin, alternated, so a fast wiggle draws as a filled band. */
    const zigzag = (ys: number[]) => (u: number) => ys[Math.round(u * (2 * BINS - 1))]
    const st = { t: 0, logFs: 0, init: false }
    return {
      scene,
      view: { center: [2.2, -0.6, 0], radius: 64, polar: 1.42, azimuth: 0.06 },
      frame(dt, p) {
        const target = solveNyquist(p)
        if (!st.init) Object.assign(st, { logFs: Math.log10(target.fs), init: true })
        st.logFs = glide(dt, st.logFs, Math.log10(target.fs), 8)
        const s = solveNyquist({ ...p, fs: Math.round(10 ** st.logFs) })
        st.t += dt / SLOW
        const t0 = st.t - 1
        const step = 1 / BINS
        for (let j = 0; j < BINS; j++) {
          const a = (Math.floor(t0 / step) + j) * step
          let lo = Infinity
          let hi = -Infinity
          for (let q = 0; q < SUB; q++) {
            const v = pinAt(s.tones, a + (q * step) / SUB)
            lo = Math.min(lo, v)
            hi = Math.max(hi, v)
          }
          pinY[2 * j] = vy(lo)
          pinY[2 * j + 1] = vy(hi)
          const first = Math.floor(a * s.fs)
          const last = Math.max(first, Math.floor((a + step) * s.fs))
          lo = hi = readAt(s.tones, first, s.fs)
          for (let i = first + 1; i <= last; i++) {
            const v = readAt(s.tones, i, s.fs)
            lo = Math.min(lo, v)
            hi = Math.max(hi, v)
          }
          readY[2 * j] = vy(lo)
          readY[2 * j + 1] = vy(hi)
        }
        pinTrace.draw(zigzag(pinY), 1)
        readTrace.draw(zigzag(readY), 1)

        s.tones.forEach((t, i) => toneBars[i].set(px(t.hz) + (t.motor ? 0 : i * 0.36), t.pin.amp * perAmp, -PH / 2))
        const hx = px(nyquist(s.fs))
        half.position.x = hx
        shade.mesh.visible = hx < PW / 2 - 0.05
        shade.mesh.scale.x = Math.max(0.01, PW / 2 - hx)
        shade.mesh.position.x = (PW / 2 + hx) / 2
        const last = s.spectrum.length - 1
        specTrace.draw((u) => -PH / 2 + Math.min(PH, s.spectrum[Math.round(u * last)] * perAmp), null)
        humMark.position.x = readPlot.xAt(Math.min(1, s.humAt / nyquist(s.fs)))
        fsHalf.show(String(Math.round(nyquist(target.fs))))
        fsHalf.frame(dt)
      },
      readouts: (p) => {
        const s = solveNyquist(p)
        const inBand = s.humAt < 25
        return [
          { label: 'Nyquist fs/2', value: `${hz(nyquist(s.fs))}${s.aliased ? ' · hash folds' : ' · all clear'}`, tone: s.aliased ? 'warn' : 'ok' },
          { label: '600 Hz hum shows at', value: hz(s.humAt), tone: inBand && s.guard !== 'rc' ? 'bad' : undefined },
          { label: 'Noise in readings', value: `${pct(s.noise)} of signal`, tone: s.noise < 0.05 ? 'ok' : s.noise > 0.2 ? 'bad' : 'warn' },
          { label: 'Time slowed', value: `${SLOW}×` },
        ]
      },
    }
  },
}
