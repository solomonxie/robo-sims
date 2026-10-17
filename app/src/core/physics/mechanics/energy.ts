// Energy and work: a car trading PE and KE on a U-track, a winch lifting a payload, losses from battery to wheel.
import { G } from '../common'
import { GEARBOXES, Gearbox, TT_CAR, TT_MOTOR, frictionNm, freeSpeed, gearEfficiency, gearRatio, motorK, shaftTorque } from '../actuators/dcmotor'
import { DriverChip, driverLoss } from '../actuators/hbridge'
import { CHEMISTRIES } from '../power/batteries'
import { packRuntime } from '../power/budget'
import { ROLL_FLOORS } from '../control/loop'

/** U-track: two ramps of `slope` m along at `deg`, a flat of `flat` m between. */
export const U_TRACK = { slope: 0.9, flat: 0.5, deg: 25, seconds: 12, dt: 0.001 }
export const TRACK_FLOORS = { ideal: { name: 'No losses', crr: 0 }, ...ROLL_FLOORS }
export type TrackFloor = keyof typeof TRACK_FLOORS
const SIN = Math.sin((U_TRACK.deg * Math.PI) / 180)
const COS = Math.cos((U_TRACK.deg * Math.PI) / 180)
export const trackLength = () => 2 * U_TRACK.slope + U_TRACK.flat
export const trackTop = () => U_TRACK.slope * SIN

/** Point `s` m along the track from the left top: x, height y (m) and pitch (rad, + nose up going right). */
export function trackAt(s: number) {
  const { slope, flat } = U_TRACK
  const pitch = (U_TRACK.deg * Math.PI) / 180
  if (s < slope) return { x: s * COS, y: (slope - s) * SIN, pitch: -pitch }
  if (s <= slope + flat) return { x: slope * COS + (s - slope), y: 0, pitch: 0 }
  const u = s - slope - flat
  return { x: slope * COS + flat + u * COS, y: u * SIN, pitch }
}

export interface UTrackFrame { t: number; s: number; v: number; h: number; ke: number; pe: number; loss: number }

/** Released from rest at height `h` m on the left ramp; gravity along the track and rolling resistance crr·m·g·cos θ. */
export function uTrackRun(kg: number, h: number, crr: number, seconds = U_TRACK.seconds, dt = U_TRACK.dt) {
  const { slope, flat } = U_TRACK
  const end = trackLength()
  let s = slope - Math.min(h, trackTop()) / SIN
  let v = 0
  let loss = 0
  const e0 = kg * G * trackAt(s).y
  const frames: UTrackFrame[] = []
  let bottomV = 0
  for (let i = 0; i <= Math.round(seconds / dt); i++) {
    const p = trackAt(s)
    const ke = 0.5 * kg * v * v
    frames.push({ t: i * dt, s, v, h: p.y, ke, pe: kg * G * p.y, loss })
    const onFlat = s >= slope && s <= slope + flat
    const down = s < slope ? SIN : onFlat ? 0 : -SIN
    const roll = crr * G * (onFlat ? 1 : COS)
    if (v === 0 && Math.abs(down) * G <= roll) continue
    const dir = v !== 0 ? Math.sign(v) : Math.sign(down)
    const vNext = v + (down * G - dir * roll) * dt
    const stopped = v !== 0 && Math.sign(vNext) !== Math.sign(v)
    const vNew = stopped ? 0 : vNext
    const ds = vNew * dt
    loss += kg * roll * Math.abs(ds)
    if (bottomV === 0 && s < slope && s + ds >= slope) bottomV = vNew
    s = Math.min(end, Math.max(0, s + ds))
    v = vNew
  }
  return { frames, e0, bottomV, idealV: Math.sqrt(2 * G * Math.min(h, trackTop())) }
}

/** Winch: TT motor at 6 V on the 1:120 box winding a 1.5 cm spool. */
export const WINCH = { volts: 6, gear: GEARBOXES.tt120 as Gearbox, spoolM: 0.015 }
const winchRatio = () => gearRatio(WINCH.gear)
const winchEff = () => gearEfficiency(WINCH.gear)

/** Pull the full-voltage motor can give at the rope while it moves at `v` m/s, and that power. */
export function winchPull(v: number) {
  const n = winchRatio()
  const f = Math.max(0, (shaftTorque(WINCH.volts, (v * n) / WINCH.spoolM) * n * winchEff()) / WINCH.spoolM)
  return { force: f, power: f * v }
}
export const winchFreeSpeed = () => (freeSpeed(WINCH.volts) / winchRatio()) * WINCH.spoolM

/** Lift `kg` by `d` m at `wantV` m/s (or the motor's top speed for that load): W = m g d, P = F v, electrical energy in. */
export function winchLift(kg: number, d: number, wantV: number) {
  const n = winchRatio()
  const k = motorK()
  const force = kg * G
  const loadNm = (force * WINCH.spoolM) / (n * winchEff())
  const amps = (loadNm + frictionNm()) / k
  const topV = Math.max(0, ((WINCH.volts - amps * TT_MOTOR.ohms) / k / n) * WINCH.spoolM)
  const v = Math.min(wantV, topV)
  const radS = (v * n) / WINCH.spoolM
  const work = force * d
  const time = v > 0 ? d / v : Infinity
  const powerIn = amps * (amps * TT_MOTOR.ohms + k * radS)
  return { force, amps, topV, v, limited: wantV > topV, power: force * v, work, time, powerIn, energyIn: powerIn * time, heat: amps * amps * TT_MOTOR.ohms * time, holdW: amps * amps * TT_MOTOR.ohms }
}

/** TT car climbing `deg` on 2S Li-ion through `chip`: per-stage power (W) from chemical to height. */
export const CHAIN_PACK = { chem: CHEMISTRIES.liion, series: 2 }
export type ChainGear = 'tt48' | 'tt120'

export function driveChain(chip: DriverChip, gear: ChainGear, deg: number) {
  const g = GEARBOXES[gear]
  const n = gearRatio(g)
  const eff = gearEfficiency(g)
  const k = motorK()
  const th = (deg * Math.PI) / 180
  const { massKg, crr, wheelM, driven } = TT_CAR
  const rollN = (massKg * G * crr * Math.cos(th)) / driven
  const liftN = (massKg * G * Math.sin(th)) / driven
  const loadNm = ((rollN + liftN) * wheelM) / (n * eff)
  const amps = (loadNm + frictionNm()) / k
  const { chem, series } = CHAIN_PACK
  const ocv = series * chem.nominal
  const packOhms = series * chem.cell.ohms
  const packA = driven * amps
  const term = ocv - packA * packOhms
  const drv = driverLoss(chip, amps, term)
  const radS = Math.max(0, (drv.motorV - amps * TT_MOTOR.ohms) / k)
  const v = (radS / n) * wheelM
  const each = (w: number) => driven * w
  const losses = {
    pack: packA * packA * packOhms,
    driver: each(drv.lossW),
    copper: each(amps * amps * TT_MOTOR.ohms),
    friction: each(frictionNm() * radS),
    gears: each(loadNm * radS * (1 - eff)),
    rolling: each(rollN * v),
  }
  const chemW = ocv * packA
  const liftW = each(liftN * v)
  const wheelW = losses.rolling + liftW
  const runtime = packRuntime(chem, series, 1, chemW)
  return { amps, motorV: drv.motorV, v, chemW, losses, liftW, wheelW, toWheel: wheelW / chemW, toHeight: liftW / chemW, hours: runtime.hours, wh: runtime.wh, stalled: radS <= 0 }
}
