// Sound as a pressure wave: its speed in air, water and steel, echo ranging (ringing, tilted panels, double bounces) and the Doppler shift. SI units.
import { DEG, SOUND_C, clamp } from '../common'
import { HCSR04, Reflector, Sonar, THRESHOLD, Target, beamGain, burstS, echoVia, speedOfSound, spread, targetRefl } from '../sensors/ultrasonic'

export const SOUND_MEDIA = { air: 'Air', water: 'Water', steel: 'Steel' } as const
export type SoundMedium = keyof typeof SOUND_MEDIA

/** Air: ideal gas; fresh water: polynomial fit 0…40 °C (clamped); steel: longitudinal wave in a long bar. */
export function soundSpeedIn(m: SoundMedium, tempC: number) {
  if (m === 'air') return speedOfSound(tempC)
  if (m === 'steel') return 5100
  const T = clamp(tempC, 0, 40)
  return 1402.4 + 5.04 * T - 0.0581 * T ** 2 + 0.000334 * T ** 3
}
/** The rule of thumb c ≈ 331 + 0.6·T. */
export const airSpeedLinear = (tempC: number) => 331 + 0.6 * tempC
/** What a sketch that assumes `assumedC` reads for a target `m` away at `tempC`. */
export const fixedSpeedRead = (m: number, tempC: number, assumedC = SOUND_C) => (m * assumedC) / speedOfSound(tempC)

// --- Echo ranging: ringing blinds the receiver, a tilted panel throws the echo aside, a strong echo bounces twice. ---

export const SONARS = { hcsr04: 'HC-SR04 · two cans', jsn: 'JSN-SR04T · one can' } as const
export type SonarKind = keyof typeof SONARS
/** `ringS`: after the burst the transducer rings this long above the threshold; `tau`: its decay time. */
const SONAR_RING: Record<SonarKind, { ringS: number; tau: number }> = {
  hcsr04: { ringS: 0.03e-3, tau: 0.02e-3 },
  jsn: { ringS: 1.3e-3, tau: 0.3e-3 },
}
/** Share of an echo the sensor face bounces back out. */
const FACE_REFL = 0.4
export const PANEL_HALF = 0.4

/** The receiver can't hear anything until ringing falls below the threshold. */
const blankS = (k: SonarKind) => burstS() + SONAR_RING[k].ringS
export const blindRange = (k: SonarKind, c = SOUND_C) => (c * blankS(k)) / 2

export interface RangeEcho {
  kind: 'direct' | 'double'
  t: number
  amp: number
  heard: boolean
}

/** A flat panel `m` ahead turned `tiltDeg`: the direct echo (null if the bounce misses the panel), its double bounce, and what the sensor reads. */
export function echoRanging(kind: SonarKind, m: number, tiltDeg: number, surface: Target, tempC = 20) {
  const c = speedOfSound(tempC)
  const tilt = tiltDeg * DEG
  const s: Sonar = { x: 0, y: 0, heading: 0 }
  const panel: Reflector = {
    kind: 'wall',
    a: { x: m - PANEL_HALF * Math.sin(tilt), y: -PANEL_HALF * Math.cos(tilt) },
    b: { x: m + PANEL_HALF * Math.sin(tilt), y: PANEL_HALF * Math.cos(tilt) },
    refl: targetRefl(surface),
    name: surface,
  }
  const blank = blankS(kind)
  const direct = echoVia(s, s, panel)
  const echoes: RangeEcho[] = []
  if (direct) {
    const g2 = beamGain(tilt) ** 2
    const amps = [direct.amp, FACE_REFL * panel.refl ** 2 * g2 ** 2 * spread(2 * direct.path)]
    amps.forEach((amp, i) => {
      const t = ((i + 1) * direct.path) / c
      echoes.push({ kind: i ? 'double' : 'direct', t, amp, heard: amp >= THRESHOLD && t >= blank && t <= HCSR04.noEchoS })
    })
  }
  const first = echoes.find((e) => e.heard) ?? null
  return { c, blank, echoes, first, reading: first ? (c * first.t) / 2 : null, buried: echoes.length > 0 && echoes[0].t < blank, perp: direct ? direct.path / 2 : null }
}
export type Ranging = ReturnType<typeof echoRanging>

/** Received amplitude ÷ threshold at time `t`: the transducer's own ringing plus each echo, a burst long. */
export function echoEnvelope(r: Ranging, kind: SonarKind, t: number) {
  const { tau } = SONAR_RING[kind]
  const ring = t < 0 ? 0 : Math.min(300, Math.exp((r.blank - t) / tau))
  const b = burstS()
  const echo = r.echoes.reduce((sum, e) => sum + (t >= e.t && t < e.t + b ? (e.amp / THRESHOLD) * Math.sin((Math.PI * (t - e.t)) / b) : 0), 0)
  return ring + echo
}

// --- Doppler: a moving source squeezes its wavefronts ahead and stretches them behind. ---

/** Heard frequency; speeds along the line between them, positive when moving towards the other. */
export const dopplerHz = (f: number, c: number, vSource: number, vListener = 0) => (f * (c + vListener)) / (c - vSource)
/** A target closing at `v` hears f·(c+v)/c and sends it back as a moving source: f·(c+v)/(c−v). */
export const echoDopplerHz = (f: number, c: number, v: number) => (f * (c + v)) / (c - v)
/** Inverts `echoDopplerHz`: closing speed from the sent and echoed frequencies. */
export const speedFromEcho = (f: number, fEcho: number, c: number) => (c * (fEcho - f)) / (fEcho + f)

export interface Front {
  x: number
  r: number
}

/** Fronts of a source at x0 + v·t, one every `period` from t = 0, at time `t`; newest first, at most `max`. */
export function sourceFronts(t: number, x0: number, v: number, c: number, period: number, max: number): Front[] {
  const out: Front[] = []
  for (let k = Math.floor(t / period); k >= 0 && out.length < max; k--) out.push({ x: x0 + v * k * period, r: c * (t - k * period) })
  return out
}

/** A still emitter at `xs` sends fronts left every `period`; a target at x0 + v·t (v > 0 closing) re-emits each front the moment it meets it. */
export function echoFronts(t: number, xs: number, x0: number, v: number, c: number, period: number, max: number) {
  const out = sourceFronts(t, xs, 0, c, period, max)
  const back: Front[] = []
  for (let k = Math.floor(t / period); k >= 0 && back.length < max; k--) {
    const hit = (xs - x0 + c * k * period) / (c + v)
    if (hit <= t) back.push({ x: x0 + v * hit, r: c * (t - hit) })
  }
  return { out, back }
}
