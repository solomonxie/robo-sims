// Desk lamp tracker: two LDRs on an SG90 horn, read by the ESP32 ADC (mount, matching, wiring, room light),
// then the servo turning toward the brighter side (gain vs LDR lag, room light changes the loop gain).
import { DEG, clamp, clamp01, gaussAt } from '../common'
import { GPIO_VDD } from '../mcu/gpio'
import { esp32Raw } from '../mcu/adc'
import { servoStep } from '../mcu/pwm'

// --- LDR pair ---

/** GL5528 CdS cell: 10–20 kΩ at 10 lux, log–log slope γ, 1 MΩ dark; rise/fall time constants. */
export const GL5528 = { r10: 15e3, gamma: 0.6, darkOhms: 1e6, riseS: 0.02, fallS: 0.03 }
/** LDR resistance at `lux`: R10·(E/10)^−γ, in parallel with the dark resistance. */
export function ldrOhms(lux: number, r10 = GL5528.r10) {
  const r = r10 * (Math.max(lux, 1e-3) / 10) ** -GL5528.gamma
  return (r * GL5528.darkOhms) / (r + GL5528.darkOhms)
}

/** LED desk lamp aimed at the head: 300 cd on axis, 60 cm away; LDR head 5 mm across, touching the wall. */
export const LAMP_EYE = { cd: 300, distM: 0.6, ldrMm: 5 }
export const lampDirectLux = (eye = LAMP_EYE) => eye.cd / eye.distM ** 2

export const LAMP_MOUNTS = {
  flat: { name: 'Side by side, both facing forward', toeDeg: 0, wallMm: 0 },
  toed: { name: 'Toed out ±30°', toeDeg: 30, wallMm: 0 },
  wall: { name: 'Black wall between them, 20 mm', toeDeg: 0, wallMm: 20 },
}
export type LampMount = keyof typeof LAMP_MOUNTS
export const LAMP_PAIRS = {
  matched: { name: 'Matched pair (sorted with a meter)', rightK: 1 },
  bag: { name: 'Two from the bag (right one +35 %)', rightK: 1.35 },
}
export type LampPair = keyof typeof LAMP_PAIRS
export const LAMP_WIRINGS = {
  two: { name: 'Two dividers (10 kΩ), two ADC pins' },
  half: { name: 'LDR–LDR half bridge, one pin' },
}
export type LampWiring = keyof typeof LAMP_WIRINGS
export const LAMP_ROOMS = {
  dark: { name: 'Evening, room lights off', lux: 5 },
  office: { name: 'Room lights on', lux: 300 },
  day: { name: 'Sunny window', lux: 1500 },
}
export type LampRoom = keyof typeof LAMP_ROOMS
export const LAMP_FIXED_OHMS = 10e3

/** Shade on one LDR from the wall when the lamp is `awayDeg` past the other side (0 none … 1 fully shaded). */
export const lampShade = (awayDeg: number, wallMm: number, ldrMm = LAMP_EYE.ldrMm) =>
  wallMm <= 0 || awayDeg <= 0 ? 0 : awayDeg >= 90 ? 1 : clamp01((wallMm * Math.tan(awayDeg * DEG)) / ldrMm)

/** Illuminance on [left, right] LDR with the lamp `phiDeg` off the head's axis (+ = to the left): room light plus the
 *  lamp × cos(incidence) × (1 − wall shade). */
export function lampLux(phiDeg: number, mount: LampMount, roomLux: number, eye = LAMP_EYE): [number, number] {
  const m = LAMP_MOUNTS[mount]
  const e0 = lampDirectLux(eye)
  const at = (side: 1 | -1) => roomLux + e0 * Math.max(0, Math.cos((phiDeg - side * m.toeDeg) * DEG)) * (1 - lampShade(-side * phiDeg, m.wallMm, eye.ldrMm))
  return [at(1), at(-1)]
}

/** The half-bridge zero: what the pin reads with equal resistances (3.3 V / 2). */
export const LAMP_MID = esp32Raw(GPIO_VDD / 2, '11')
/** Direction error in counts, + = lamp to the left: L − R for two dividers, raw − mid for the half bridge. */
export const lampErr = (raws: readonly number[], wiring: LampWiring) => (wiring === 'two' ? raws[0] - raws[1] : raws[0] - LAMP_MID)

/** LDR resistances, pin volts and raw ADC readings (11 dB) for given lux; dividers put the LDR on top (brighter → higher);
 *  the half bridge has the left LDR on top, the right one below. */
export function lampRead(lux: readonly number[], pair: LampPair, wiring: LampWiring) {
  const ohms: [number, number] = [ldrOhms(lux[0]), ldrOhms(lux[1], GL5528.r10 * LAMP_PAIRS[pair].rightK)]
  const volts = wiring === 'two' ? ohms.map((r) => (GPIO_VDD * LAMP_FIXED_OHMS) / (LAMP_FIXED_OHMS + r)) : [(GPIO_VDD * ohms[1]) / (ohms[0] + ohms[1])]
  const raws = volts.map((v) => esp32Raw(v, '11'))
  return { ohms, volts, raws, err: lampErr(raws, wiring) }
}

export interface LampCfg {
  mount: LampMount
  pair: LampPair
  wiring: LampWiring
  room: LampRoom
}
/** One look at the lamp from `phiDeg` off axis. */
export function lampEye(phiDeg: number, cfg: LampCfg) {
  const lux = lampLux(phiDeg, cfg.mount, LAMP_ROOMS[cfg.room].lux)
  return { lux, ...lampRead(lux, cfg.pair, cfg.wiring) }
}

/** Errors smaller than this are lost in ADC noise. */
export const LAMP_NOISE = 15
/** Where the head comes to rest (error crosses zero, searched over ±60°), the slope there (counts/°), and the capture range:
 *  how far (up to 90°) the lamp can be on each side with the error pushing the right way by more than the noise. */
export function lampNull(cfg: LampCfg) {
  const err = (phi: number) => lampEye(phi, cfg).err
  let best: number | null = null
  for (let a = -60; a < 60; a += 0.5) {
    const e0 = err(a)
    const e1 = err(a + 0.5)
    if (e0 < 0 && e1 >= 0 && (best === null || Math.abs(a) < Math.abs(best))) {
      let lo = a
      let hi = a + 0.5
      for (let i = 0; i < 30; i++) {
        const m = (lo + hi) / 2
        if (err(m) < 0) lo = m
        else hi = m
      }
      best = (lo + hi) / 2
    }
  }
  if (best === null) return { deg: null, slope: 0, capture: [0, 0] as [number, number], offset: err(0) }
  const slope = (err(best + 1) - err(best - 1)) / 2
  const reach = (dir: 1 | -1) => {
    let last = best!
    for (let a = best! + dir; Math.abs(a) <= 90; a += dir) {
      if (dir * err(a) > LAMP_NOISE) last = a
      else if (last !== best) break
    }
    return last
  }
  return { deg: best, slope, capture: [reach(-1), reach(1)] as [number, number], offset: err(0) }
}

// --- Servo follow ---

/** Firmware: read both pins every 20 ms (with ADC noise), step the servo command by gain × error, ignore errors inside
 *  the dead band, write whole degrees; servo travel ±90°; 1 ms physics. */
export const LAMP_FOLLOW = { dt: 0.001, frameS: 0.02, seconds: 10, sampleDt: 0.01, deadCounts: 25, travelDeg: 90 }
export const LAMP_MOTIONS = {
  swing: { name: 'Lamp swung across, then still' },
  sweep: { name: 'Lamp carried slowly side to side' },
  wave: { name: 'Torch waved fast' },
}
export type LampMotion = keyof typeof LAMP_MOTIONS
/** Lamp bearing (°, + left) at time t. */
export function lampAt(motion: LampMotion, t: number) {
  if (motion === 'swing') return -30 + 70 * clamp01((t - 1) / 0.1)
  if (motion === 'sweep') return 45 * Math.sin((2 * Math.PI * t) / 5)
  return 45 * Math.sin((2 * Math.PI * t) / 1.6)
}

export interface LampFollowCfg {
  motion: LampMotion
  /** Command step per frame, degrees per 100 counts of error. */
  gain: number
  room: LampRoom
  wiring: LampWiring
}
export interface LampSample {
  t: number
  lamp: number
  head: number
  cmd: number
  err: number
  lux: [number, number]
}

/** Follow run with the wall mount and a matched pair: lux → LDR lag (log lux, rise/fall τ) → ADC + noise → firmware → SG90
 *  slewing at 600 °/s; starts pointing at the lamp. Samples every 10 ms. */
export function lampFollowRun(cfg: LampFollowCfg, c = LAMP_FOLLOW) {
  const roomLux = LAMP_ROOMS[cfg.room].lux
  const steps = Math.round(c.seconds / c.dt)
  const every = Math.round(c.frameS / c.dt)
  const sampleEvery = Math.round(c.sampleDt / c.dt)
  let written = Math.round(lampAt(cfg.motion, 0))
  let head = written
  let cmd = written
  let err = 0
  let moves = 0
  const lnLux = lampLux(lampAt(cfg.motion, 0) - head, 'wall', roomLux).map(Math.log)
  const samples: LampSample[] = []
  for (let k = 0; k <= steps; k++) {
    const t = k * c.dt
    const lamp = lampAt(cfg.motion, t)
    const truth = lampLux(lamp - head, 'wall', roomLux)
    for (let i = 0; i < 2; i++) {
      const target = Math.log(truth[i])
      const tau = target > lnLux[i] ? GL5528.riseS : GL5528.fallS
      lnLux[i] += (target - lnLux[i]) * -Math.expm1(-c.dt / tau)
    }
    if (k % every === 0) {
      const f = k / every
      const r = lampRead([Math.exp(lnLux[0]), Math.exp(lnLux[1])], 'matched', cfg.wiring)
      const raws = r.raws.map((x, i) => clamp(Math.round(x + LAMP_NOISE * gaussAt(2 * f + i)), 0, 4095))
      err = lampErr(raws, cfg.wiring)
      if (Math.abs(err) > c.deadCounts) cmd = clamp(cmd + (cfg.gain * err) / 100, -c.travelDeg, c.travelDeg)
      const w = Math.round(cmd)
      if (w !== written) moves++
      written = w
    }
    head = servoStep(head, written, c.dt)
    if (k % sampleEvery === 0) samples.push({ t, lamp, head, cmd: written, err, lux: [Math.exp(lnLux[0]), Math.exp(lnLux[1])] })
  }
  return { samples, sampleDt: c.sampleDt, moves }
}

/** RMS and worst miss (lamp − head) after `fromS`, swing of the head over the last 2 s, servo moves per second. */
export function lampFollowStats(run: ReturnType<typeof lampFollowRun>, fromS = 2, c = LAMP_FOLLOW) {
  const after = run.samples.filter((s) => s.t >= fromS)
  const miss = after.map((s) => s.lamp - s.head)
  const tail = run.samples.filter((s) => s.t >= c.seconds - 2).map((s) => s.head)
  return {
    rms: Math.sqrt(miss.reduce((a, m) => a + m * m, 0) / miss.length),
    worst: Math.max(...miss.map(Math.abs)),
    tailSwing: Math.max(...tail) - Math.min(...tail),
    movesPerS: run.moves / c.seconds,
  }
}
