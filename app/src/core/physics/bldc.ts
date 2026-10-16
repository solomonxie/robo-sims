// Brushless DC motor: six-step (trapezoidal) commutation, Hall and sensorless start-up, hobby ESC (PWM / DShot, limits).
// Angles are electrical (rad): a 2-pole rotor, so one electrical turn is one mechanical turn.
import { clamp, clamp01, wrap2pi, wrapPi } from './common'

const SIXTH = Math.PI / 3

// --- Three-phase drive: three half-bridges, two phases driven per step, the third floats. ---

/** [high-side phase, low-side phase] for steps 0…5 (0 = A, 1 = B, 2 = C): A+B−, A+C−, B+C−, B+A−, C+A−, C+B−. */
export const SIX_STEP: readonly (readonly [number, number])[] = [[0, 1], [0, 2], [1, 2], [1, 0], [2, 0], [2, 1]]
export const PHASE_NAMES = ['A', 'B', 'C']
export const mod6 = (k: number) => ((k % 6) + 6) % 6

/** +1 = high-side FET on, −1 = low-side FET on, 0 = floating. */
export const phaseState = (step: number, p: number) => {
  const [hi, lo] = SIX_STEP[mod6(step)]
  return hi === p ? 1 : lo === p ? -1 : 0
}
export const floatingPhase = (step: number) => 3 - SIX_STEP[mod6(step)][0] - SIX_STEP[mod6(step)][1]
export const stepName = (step: number) => `${PHASE_NAMES[SIX_STEP[mod6(step)][0]]}+ ${PHASE_NAMES[SIX_STEP[mod6(step)][1]]}−`

/** Winding axis of phase p: A 0°, B 120°, C 240°. */
export const phaseAxis = (p: number) => (p * 2 * Math.PI) / 3
/** Stator field direction in a step: (A+B−) points to −30°, each step turns it +60°. */
export const fieldAngle = (step: number) => -Math.PI / 6 + mod6(step) * SIXTH
/** Step whose field leads the rotor (field at `theta`) by 60…120°: torque never drops below sin 60° = 87 %. */
export const commutationStep = (theta: number) => mod6(Math.floor((wrap2pi(theta) + (5 * Math.PI) / 6) / SIXTH))
/** How far (0…1) the rotor is through its current step. */
export const stepProgress = (theta: number) => ((((wrap2pi(theta) + (5 * Math.PI) / 6) / SIXTH) % 1) + 1) % 1
/** Torque factor sin(field − rotor). */
export const torqueFactor = (step: number, theta: number) => Math.sin(fieldAngle(step) - theta)

/** Average terminal voltage of phase p, `u` 0…1 through the step: driven high = d·V, low = 0, floating = midpoint ± the
 *  trapezoidal back-EMF ramping from its last to its next driven level (`emf` = its amplitude / (d·V/2), 1 at no load). */
export function phaseVolts(step: number, u: number, p: number, volts: number, duty: number, emf = 1) {
  const s = phaseState(step, p)
  const ramp = s !== 0 ? s : emf * (phaseState(step - 1, p) + (phaseState(step + 1, p) - phaseState(step - 1, p)) * u)
  return duty * volts * (0.5 + 0.5 * ramp)
}

/** KV: no-load rpm per volt, so rpm ≈ KV · V · duty; torque constant Kt = Ke = 60 / (2π·KV). */
export const noLoadRpm = (kv: number, volts: number, duty = 1) => kv * volts * clamp01(duty)
export const kvToKt = (kv: number) => 60 / (2 * Math.PI * kv)
/** Electrical rpm = mechanical rpm × pole pairs; six commutation steps per electrical turn. */
export const eRpm = (rpm: number, poles: number) => (rpm * poles) / 2
export const commutationHz = (rpm: number, poles: number) => (6 * eRpm(rpm, poles)) / 60

// --- Hall sensors: three switches 120° apart give a 6-state code; sensorless reads the floating phase's back-EMF. ---

/** H1 H2 H3 (at 0°, 120°, 240°) are 1 while the rotor field (its S magnet) is within 90°; code = H1·4 + H2·2 + H3. */
export const hallBits = (theta: number) => [0, 1, 2].map((k) => (Math.cos(theta - phaseAxis(k)) > 0 ? 1 : 0))
export const hallCode = (theta: number) => hallBits(theta).reduce((a: number, b) => a * 2 + b, 0)
/** Lookup table, index = Hall code, value = step (−1 for the impossible 000 and 111). */
export const HALL_STEP: readonly number[] = (() => {
  const t = Array<number>(8).fill(-1)
  for (let k = 0; k < 6; k++) t[hallCode(k * SIXTH)] = commutationStep(k * SIXTH)
  return t
})()

export const TEACH_BLDC = { kv: 1000, ohms: 0.5, inertia: 2e-5, frictionNm: 0.002, damp: 2e-5, volts: 12, duty: 0.5 }
/** Sensorless: zero crossings vanish in PWM noise below this back-EMF; the open-loop start-up ramp. */
export const SENSORLESS = { zcVolts: 0.6, alignS: 0.15, rampDuty: 0.2, rampAcc: 300, restS: 0.25, slewPerS: 2 }

export type Sense = 'hall' | 'bemf'
export type StartPhase = 'hall' | 'align' | 'ramp' | 'closed' | 'desync'
export interface StartFrame {
  t: number
  /** Rotor angle (unwrapped) and speed, rad/s. */
  theta: number
  w: number
  step: number
  phase: StartPhase
  duty: number
  /** Back-EMF amplitude Ke·ω, V; whether its zero crossings can be seen. */
  emf: number
  zc: boolean
  tries: number
}
export const START_FRAME_S = 5e-4

/** Start from standstill with a friction load. Hall: commutate from the code at once. Back-EMF: no EMF at rest, so align
 *  to step 0, force steps faster and faster (open loop) until the EMF is big enough, then close the loop; if the rotor
 *  falls 150° behind the forced field it has lost sync: stop, rest, try again. */
export function bldcStartRun(sense: Sense, loadNm: number, seconds = 1, dt = 2e-5, m = TEACH_BLDC, s = SENSORLESS) {
  const k = kvToKt(m.kv)
  const st = { th: 0.4, w: 0, phase: (sense === 'hall' ? 'hall' : 'align') as StartPhase, t0: 0, forced: 0, wf: 0, duty: 0, step: 0, tries: 1 }
  const out: StartFrame[] = []
  const every = Math.round(START_FRAME_S / dt)
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const t = i * dt
    const since = t - st.t0
    const emf = k * Math.abs(st.w)
    const zc = emf > s.zcVolts
    let target = m.duty
    if (st.phase === 'hall' || st.phase === 'closed') st.step = sense === 'hall' ? HALL_STEP[hallCode(st.th)] : commutationStep(st.th)
    else if (st.phase === 'align') {
      st.step = 0
      target = s.rampDuty
      if (since > s.alignS) Object.assign(st, { phase: 'ramp', t0: t, forced: 0, wf: 0 })
    } else if (st.phase === 'ramp') {
      target = s.rampDuty
      st.wf += s.rampAcc * dt
      st.forced += st.wf * dt
      st.step = mod6(Math.floor(st.forced / SIXTH))
      const lag = wrapPi(fieldAngle(st.step) - st.th)
      if (zc && lag > 0 && lag < (2 * Math.PI) / 3) st.phase = 'closed'
      else if (Math.abs(lag) > (5 * Math.PI) / 6 || (since > 0.1 && st.w < 0.3 * st.wf)) Object.assign(st, { phase: 'desync', t0: t })
    } else {
      target = 0
      if (since > s.restS) Object.assign(st, { phase: 'align', t0: t, tries: st.tries + 1 })
    }
    st.duty = st.phase === 'closed' ? Math.min(target, st.duty + s.slewPerS * dt) : target
    const tf = torqueFactor(st.step, st.th)
    const amps = (m.volts * st.duty - k * st.w * tf) / m.ohms
    const drive = st.phase === 'desync' ? 0 : k * amps * tf
    const fric = m.frictionNm + loadNm
    const net = drive - m.damp * st.w
    const a = Math.abs(st.w) < 1e-3 && Math.abs(net) <= fric ? -st.w / dt : (net - Math.sign(st.w || net) * fric) / m.inertia
    st.w += a * dt
    st.th += st.w * dt
    if (i % every === 0) out.push({ t, theta: st.th, w: st.w, step: st.step, phase: st.phase, duty: st.duty, emf, zc, tries: st.tries })
  }
  return out
}

/** First time the rotor runs under closed-loop commutation, or null. */
export const closedAt = (run: StartFrame[]) => run.find((f) => f.phase === 'hall' ? f.w > 1 : f.phase === 'closed')?.t ?? null

// --- ESC basics: throttle in (PWM pulse or DShot frame), arming, ramp, current and heat limits, LiPo cells. ---

export const LIPO = { nominalV: 3.7, fullV: 4.2, emptyV: 3.5 }
export const packVolts = (cells: number, perCell = LIPO.nominalV) => cells * perCell

/** Classic RC throttle: 1000 µs = stop, 2000 µs = full, every 20 ms (50 Hz) up to 2.5 ms (400 Hz). */
export const escPulseUs = (throttle: number) => 1000 + 1000 * clamp01(throttle)
/** DShot throttle value 48…2047 (0 = disarmed/stop, 1…47 commands); 3D mode: 48…1047 reverse, 1049…2047 forward. */
export function dshotValue(throttle: number, threeD = false) {
  const t = clamp(throttle, threeD ? -1 : 0, 1)
  if (t === 0) return 0
  if (!threeD) return Math.round(48 + t * 1999)
  return t > 0 ? Math.round(1049 + t * 998) : Math.round(48 + -t * 999)
}
const xor4 = (a: number, b: number) => [1, 2, 4, 8].reduce((x, k) => x + (Math.floor(a / k) % 2 !== Math.floor(b / k) % 2 ? k : 0), 0)
/** 16-bit DShot frame: 11-bit value, telemetry bit, 4-bit XOR checksum of the three nibbles. */
export function dshotFrame(value: number, telemetry = false) {
  const p = value * 2 + (telemetry ? 1 : 0)
  return p * 16 + xor4(xor4(p % 16, Math.floor(p / 16) % 16), Math.floor(p / 256) % 16)
}
export const dshotBits = (frame: number) => Array.from({ length: 16 }, (_, i) => Math.floor(frame / 2 ** (15 - i)) % 2)
/** DShot600: 1.67 µs per bit, a 1 is high for 75 % of it, a 0 for 37.5 %. */
export const DSHOT600 = { bitUs: 1e6 / 600e3, one: 0.75, zero: 0.375 }

export const ESC_MOTOR = { kv: 2300, ohms: 0.08, noLoadA: 0.8, inertia: 1.5e-5, propKq: 2.14e-8, poles: 14 }
export const ESC = { limitA: 35, ratedA: 30, lossOhm: 0.012, kPerW: 6.5, jPerK: 0.35, ambientC: 25, hotC: 100, cutC: 120, rampPerS: 1.5, bootS: 0.4, armS: 1.2, goS: 1.4 }

export type EscState = 'boot' | 'arming' | 'armed' | 'run' | 'limit' | 'hot'
export interface EscFrame {
  t: number
  state: EscState
  duty: number
  rpm: number
  amps: number
  tempC: number
}
export const ESC_FRAME_S = 0.01

/** Steady prop speed (rad/s) at duty d: Kt·(I − I0) = kq·ω², I = (V·d − Ke·ω) / R. */
export function propSpeed(volts: number, duty: number, m = ESC_MOTOR) {
  const k = kvToKt(m.kv)
  const a = m.propKq
  const b = (k * k) / m.ohms
  const c = k * m.noLoadA - (k * volts * duty) / m.ohms
  return c >= 0 ? 0 : (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a)
}
export const propAmps = (volts: number, duty: number, m = ESC_MOTOR) => (volts * duty - kvToKt(m.kv) * propSpeed(volts, duty, m)) / m.ohms

/** Plug in a `cells`-S pack: tones, the flight controller holds zero throttle to arm, then asks for `throttle` (−1…1; below
 *  0 only in 3D mode). The ESC slews duty, cuts it back to hold the current limit and derates above 100 °C. */
export function escRun(cells: number, throttle: number, threeD: boolean, seconds = 6, dt = 1e-4, m = ESC_MOTOR, e = ESC) {
  const k = kvToKt(m.kv)
  const v = packVolts(cells)
  const cmd = threeD ? clamp(throttle, -1, 1) : clamp01(throttle)
  const st = { w: 0, duty: 0, temp: e.ambientC }
  const out: EscFrame[] = []
  const every = Math.round(ESC_FRAME_S / dt)
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const t = i * dt
    const want = t >= e.goS ? cmd : 0
    const hotK = clamp01((e.cutC - st.temp) / (e.cutC - e.hotC))
    const limit = e.limitA * hotK
    let duty = clamp(want, st.duty - e.rampPerS * dt, st.duty + e.rampPerS * dt)
    const sgn = Math.sign(duty) || 1
    const amps0 = (v * Math.abs(duty) - k * Math.abs(st.w)) / m.ohms
    let limited = false
    if (amps0 > limit) {
      duty = (sgn * (limit * m.ohms + k * Math.abs(st.w))) / v
      limited = true
    }
    st.duty = duty
    const amps = Math.max(0, (v * Math.abs(duty) - k * Math.abs(st.w)) / m.ohms)
    const torque = sgn * k * Math.max(0, amps - m.noLoadA) - Math.sign(st.w) * m.propKq * st.w * st.w
    st.w += (torque / m.inertia) * dt
    if (Math.abs(duty) < 1e-6 && Math.abs(st.w) < 1) st.w = 0
    st.temp += ((amps * amps * e.lossOhm - (st.temp - e.ambientC) / e.kPerW) / e.jPerK) * dt
    if (i % every === 0) {
      const state: EscState = t < e.bootS ? 'boot' : t < e.armS ? 'arming' : t < e.goS || cmd === 0 ? 'armed' : hotK < 1 && limited ? 'hot' : limited ? 'limit' : 'run'
      out.push({ t, state, duty, rpm: (st.w * 60) / (2 * Math.PI), amps, tempC: st.temp })
    }
  }
  return out
}
