// Brownouts: a load step sags the pack, the LDO drops out, the MCU rail falls below spec and the brownout detector resets it.

import { startAmps } from './budget'
import { LinearReg, dropoutVolts, linearReg } from './regulators'

/** ESP32 brownout detector thresholds on the 3.3 V rail, by menuconfig level 0–7. */
export const ESP32_BOD = [2.43, 2.48, 2.58, 2.62, 2.67, 2.7, 2.77, 2.8]
/** Below this the ESP32's flash and radio are out of spec: code fetches and writes may go wrong. */
export const ESP32_MIN_V = 3.0
export const BOD_HYSTERESIS = 0.05

/** Lowest input that keeps a linear regulator in regulation at `amps`. */
export const minInputVolts = (r: LinearReg, amps: number) => r.vout + dropoutVolts(r, amps)

/** Seconds a capacitor feeds `amps` while it falls from `from` to `to` volts: t = C·ΔV / I. */
export const rideThroughS = (farads: number, amps: number, from: number, to: number) => (from > to ? (farads * (from - to)) / amps : 0)

/** ESP32 sketch timeline after reset: boot, Wi-Fi start (calibration burst), then run with TX bursts and motors at `motorAt`. */
export const ESP32_TIMELINE = {
  resetA: 0.02,
  holdS: 0.03,
  bootS: 0.25,
  bootA: 0.06,
  wifiS: 0.12,
  wifiA: 0.35,
  runA: 0.1,
  txA: 0.24,
  txEvery: 0.1,
  txS: 0.008,
  motorAt: 0.6,
  crashS: 0.002,
}

export type Phase = 'reset' | 'boot' | 'wifi' | 'run'
export type ResetKind = 'poweron' | 'brownout' | 'panic'

export interface BrownoutRig {
  /** Pack open-circuit volts and internal + wiring resistance. */
  ocv: number
  ohms: number
  reg: LinearReg
  bod: number
  stallA: number
  cruiseA: number
  rampS: number
  tau: number
  /** Diode + bulk cap before the regulator. */
  holdup?: { farads: number; diodeV: number }
  /** Logic on its own supply (volts, ohms): motor current no longer sags it. */
  own?: { volts: number; ohms: number }
}

export function phaseAt(tb: number, tl = ESP32_TIMELINE): Exclude<Phase, 'reset'> {
  return tb < tl.bootS ? 'boot' : tb < tl.bootS + tl.wifiS ? 'wifi' : 'run'
}

/** MCU current at `tb` s since reset was released. */
export function logicAmps(tb: number, tl = ESP32_TIMELINE) {
  const ph = phaseAt(tb, tl)
  if (ph === 'boot') return tl.bootA
  if (ph === 'wifi') return tl.wifiA
  return ((tb - tl.bootS - tl.wifiS) % tl.txEvery) < tl.txS ? tl.txA : tl.runA
}

/** Steps the rig for `seconds`, starting `since` s after boot (0 = power-on). Motors only run while the MCU runs. */
export function brownoutRun(rig: BrownoutRig, seconds: number, dt: number, since = 0, tl = ESP32_TIMELINE) {
  const n = Math.round(seconds / dt)
  const pack: number[] = []
  const vin: number[] = []
  const rail: number[] = []
  const motor: number[] = []
  const phase: Phase[] = []
  const resets: { t: number; kind: ResetKind }[] = since === 0 ? [{ t: 0, kind: 'poweron' }] : []
  let tb = since
  let on = true
  let held = 0
  let below = 0
  let undefinedS = 0
  let cap = rig.holdup ? rig.ocv - rig.ohms * logicAmps(since, tl) - rig.holdup.diodeV : 0
  for (let i = 0; i < n; i++) {
    const t = i * dt
    const ia = on ? logicAmps(tb, tl) : tl.resetA
    const im = on && tb >= tl.motorAt ? startAmps(tb - tl.motorAt, rig.stallA, rig.cruiseA, rig.rampS, rig.tau) : 0
    const draw = ia + rig.reg.iq
    const vp = rig.ocv - rig.ohms * (im + (rig.own ? 0 : draw))
    let vi = vp
    if (rig.own) vi = rig.own.volts - rig.own.ohms * draw
    else if (rig.holdup) {
      cap = Math.max(vp - rig.holdup.diodeV, cap - (draw * dt) / rig.holdup.farads)
      vi = cap
    }
    const v = linearReg(rig.reg, vi, ia).vout
    pack.push(vp)
    vin.push(vi)
    rail.push(v)
    motor.push(im)
    phase.push(on ? phaseAt(tb, tl) : 'reset')
    if (on) {
      tb += dt
      below = v < ESP32_MIN_V ? below + dt : 0
      if (v < ESP32_MIN_V && v >= rig.bod) undefinedS += dt
      const kind: ResetKind | null = v < rig.bod ? 'brownout' : below > tl.crashS ? 'panic' : null
      if (kind) {
        resets.push({ t, kind })
        on = false
        held = 0
        below = 0
      }
    } else {
      held += dt
      if (held >= tl.holdS && v > rig.bod + BOD_HYSTERESIS) {
        on = true
        tb = 0
      }
    }
  }
  return { pack, vin, rail, motor, phase, resets, undefinedS }
}
