// ESP32 power modes: which domains stay powered, wake sources and boot cost, duty-cycled sensor-node battery life.

import { runtimeHours } from '../dc'

export type PowerMode = 'active' | 'modem' | 'light' | 'deep'
export type Domain = 'cpu' | 'radio' | 'ram' | 'periph' | 'rtc' | 'rtcMem' | 'ulp'
/** on = clocked; held = clock stopped, contents kept; off = unpowered, contents lost. */
export type DomainState = 'on' | 'held' | 'off'

/** CPU at 80 MHz with the radio off; the radio listening. */
export const CPU_80_A = 0.015
export const RADIO_RX_A = 0.1
/** Wi-Fi beacon interval (102.4 ms) and how long the radio wakes to catch one. */
export const BEACON_S = 0.1024
export const BEACON_AWAKE_S = 0.004
/** USB-UART, AMS1117 regulator and power LED on a DevKit, always on. */
export const DEVKIT_EXTRA_A = 0.008

/** Modem sleep: CPU runs, the radio wakes only for every `dtim`-th beacon to stay associated. */
export const modemSleepAmps = (dtim: number, cpuA = CPU_80_A, radioA = RADIO_RX_A) => cpuA + (radioA * BEACON_AWAKE_S) / (BEACON_S * dtim)

const D = (cpu: DomainState, radio: DomainState, ram: DomainState, periph: DomainState, ulp: DomainState): Record<Domain, DomainState> => ({
  cpu, radio, ram, periph, rtc: 'on', rtcMem: 'on', ulp,
})

/** Chip current (datasheet typicals), what is powered, and how it wakes. */
export const POWER_MODES: Record<PowerMode, { amps: number; domains: Record<Domain, DomainState>; wakeS: number; resumes: boolean }> = {
  active: { amps: 0.12, domains: D('on', 'on', 'on', 'on', 'off'), wakeS: 0, resumes: true },
  modem: { amps: modemSleepAmps(3), domains: D('on', 'held', 'on', 'on', 'off'), wakeS: 0, resumes: true },
  light: { amps: 0.0008, domains: D('held', 'off', 'held', 'held', 'off'), wakeS: 0.001, resumes: true },
  deep: { amps: 1e-5, domains: D('off', 'off', 'off', 'off', 'off'), wakeS: 0.19, resumes: false },
}

// --- Wake sources and boot cost ---

export type WakeSource = 'timer' | 'ext0' | 'ext1' | 'touch' | 'ulp'
/** Deep-sleep current with each source armed: ext0 keeps the RTC peripherals on, touch scans its pads, the ULP runs ~1 %. */
export const WAKE_SLEEP_A: Record<WakeSource, number> = { timer: 1e-5, ext0: 1.5e-5, ext1: 1e-5, touch: 3e-5, ulp: 1e-4 }

export interface Step {
  name: string
  s: number
  amps: number
}

/** Deep-sleep wake = reset: ROM loader, 2nd-stage bootloader (verifies the app unless skipped), app start-up. */
export const bootPhases = (fast: boolean): Step[] => [
  { name: 'ROM', s: 0.02, amps: 0.04 },
  { name: 'bootloader', s: fast ? 0.015 : 0.12, amps: 0.04 },
  { name: 'app init', s: fast ? 0.025 : 0.05, amps: 0.045 },
]

export const phaseCharge = (ps: Step[]) => ps.reduce((a, p) => a + p.s * p.amps, 0)
export const phaseTime = (ps: Step[]) => ps.reduce((a, p) => a + p.s, 0)

/** Wake interval below which light sleep (no reboot, higher floor) beats deep sleep. */
export const lightBreakEvenS = (bootC: number, lightA = POWER_MODES.light.amps, deepA = POWER_MODES.deep.amps) => bootC / (lightA - deepA)

/** Step index and time into it at `t` into a cycle of `ps` (wraps). */
export function stepAt(ps: Step[], t: number) {
  const T = phaseTime(ps)
  let u = ((t % T) + T) % T
  for (let i = 0; i < ps.length; i++) {
    if (u < ps[i].s || i === ps.length - 1) return { i, into: Math.min(u, ps[i].s) }
    u -= ps[i].s
  }
  return { i: 0, into: 0 }
}

// --- Battery budget: a sensor node that wakes, measures, sends and sleeps. ---

export type NodeRadio = 'wifi' | 'static' | 'espnow'
/** Air time per report at ~120 mA: full Wi-Fi join + DHCP, rejoin with saved channel + static IP, one ESP-NOW frame. */
export const NODE_RADIO: Record<NodeRadio, Step> = {
  wifi: { name: 'Wi-Fi join + send', s: 1.6, amps: 0.12 },
  static: { name: 'fast rejoin + send', s: 0.35, amps: 0.12 },
  espnow: { name: 'ESP-NOW send', s: 0.025, amps: 0.12 },
}
/** Radio transmit peak. */
export const NODE_PEAK_A = 0.35
/** Chip in deep sleep + low-Iq LDO + sensor standby. */
export const NODE_SLEEP_A = 1.5e-5
export const SENSOR_READ: Step = { name: 'read sensor', s: 0.012, amps: 0.04 }

export function nodeCycle(intervalS: number, radio: NodeRadio): Step[] {
  const awake = [...bootPhases(true), SENSOR_READ, NODE_RADIO[radio]]
  return [...awake, { name: 'deep sleep', s: Math.max(0, intervalS - phaseTime(awake)), amps: NODE_SLEEP_A }]
}

export const averageAmps = (ps: Step[]) => phaseCharge(ps) / phaseTime(ps)

export type CellId = 'cr2032' | 'aa2' | 'li18650'
/** Capacity, self-discharge per year, and the most current it can give without sagging below the ESP32's 2.3 V. */
export const NODE_CELLS: Record<CellId, { name: string; mAh: number; selfPerYear: number; maxA: number }> = {
  cr2032: { name: 'CR2032 coin', mAh: 220, selfPerYear: 0.01, maxA: 0.015 },
  aa2: { name: '2 × AA alkaline', mAh: 2500, selfPerYear: 0.03, maxA: 1 },
  li18650: { name: '18650 Li-ion', mAh: 3000, selfPerYear: 0.25, maxA: 5 },
}

export const YEAR_H = 8766

/** Years until empty: load plus self-discharge (taken as a constant drain on the full capacity). */
export function lifeYears(cell: CellId, avgA: number) {
  const c = NODE_CELLS[cell]
  const selfA = (c.mAh / 1000) * c.selfPerYear / YEAR_H
  return runtimeHours(c.mAh, (avgA + selfA) * 1000) / YEAR_H
}
