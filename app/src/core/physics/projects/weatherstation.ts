// Weather station: ESP32 + BMP280 + SSD1306 on one I²C bus, the sensor in or out of the box (board heat vs cable capacitance),
// then a week on an 18650 (+ solar): wake, read, send over Wi-Fi to a dashboard that reduces to sea level and flags a falling glass.
import { clamp, gaussAt } from '../common'
import { boxAirRise } from '../materials/thermal'
import { I2C_CHIPS, I2C_MODES, chipAddress, i2cRiseTime, i2cScan, openDrainClock, pullupMax } from '../mcu/i2c'
import { DEVKIT_EXTRA_A, NODE_RADIO, NodeRadio, POWER_MODES, Step, averageAmps, nodeCycle, phaseTime } from '../mcu/sleep'
import { webExchange } from '../mcu/wireless'
import { P_SEA, airPressureAt, bmp280Mode } from '../waves/fluids'

/** Bench kit on USB: OLED draw, outdoor air, bus capacitance (ESP32 pin, breadboard + jumpers, each breakout, 4-core cable per m). */
export const WX_KIT = { usbV: 5, oledA: 0.02, airC: 12, espPf: 10, wiringPf: 15, boardPf: 10, cablePfPerM: 60 }
export const WX_ADDR = { oled: chipAddress(I2C_CHIPS.ssd1306, 0), bmp: chipAddress(I2C_CHIPS.bmp280, 0) }

const par = (...r: number[]) => 1 / r.reduce((s, x) => s + 1 / x, 0)
/** Pull-ups on SDA/SCL: each breakout ships with 10 kΩ, so they add in parallel. */
export const WX_PULLUPS = {
  one: { name: 'BMP280 board’s 10 kΩ only', ohms: 10e3 },
  both: { name: 'Both boards: 10 k ∥ 10 k', ohms: par(10e3, 10e3) },
  added: { name: '+ 2.2 kΩ at the ESP32', ohms: par(10e3, 10e3, 2.2e3) },
}
export type WxPullup = keyof typeof WX_PULLUPS
export type WxMode = 'standard' | 'fast'

export const wxBusPf = (cableM: number) => WX_KIT.espPf + WX_KIT.wiringPf + 2 * WX_KIT.boardPf + WX_KIT.cablePfPerM * cableM

/** SCL with the BMP280 `cableM` away: rise time vs the mode limit, whether a HIGH arrives in time, the longest cable in spec, the scan. */
export function wxBus(cableM: number, pullup: WxPullup, mode: WxMode) {
  const ohms = WX_PULLUPS[pullup].ohms
  const m = I2C_MODES[mode]
  const farads = wxBusPf(cableM) * 1e-12
  const clk = openDrainClock(m.hz, ohms, farads)
  const tr = i2cRiseTime(ohms, farads)
  const state: 'ok' | 'late' | 'fail' = tr <= m.trMax ? 'ok' : clk.ok ? 'late' : 'fail'
  const maxCableM = Math.max(0, (pullupMax(1e-12, m) / ohms - wxBusPf(0)) / WX_KIT.cablePfPerM)
  return { ohms, hz: m.hz, trMax: m.trMax, farads, clk, tr, state, maxCableM, found: state === 'fail' ? [] : i2cScan([WX_ADDR.oled, WX_ADDR.bmp]).found }
}

/** Heat the always-on prototype puts into its sealed 160 × 120 × 60 mm box: all USB power (ESP32 with Wi-Fi, DevKit extras, OLED). */
export const wxBoardW = () => WX_KIT.usbV * (POWER_MODES.active.amps + DEVKIT_EXTRA_A + WX_KIT.oledA)

/** BMP280 temperature: on the breadboard (cable 0) it sits in the box air; on a cable it hangs outside in a radiation shield. */
export function wxSensorC(cableM: number, airC = WX_KIT.airC) {
  const inside = cableM <= 0
  const rise = boxAirRise('closed', wxBoardW(), airC).rise
  return { inside, rise, boxC: airC + rise, readC: inside ? airC + rise : airC }
}

// --- A week on the battery: wake, read, send, deep sleep; the dashboard plots sea-level pressure and flags a falling glass. ---

/** Station 250 m up; a front 130 h in drops sea-level pressure 15 hPa over 12 h, then it recovers; cloud while it passes. */
export const WX_WEEK = { days: 7, altM: 250, basePa: 101_800, tidePa: 50, frontH: 130, dropPa: 1500, dropH: 12, riseH: 30, cellMah: 2600, soc0: 0.4, panelV: 6, dt: 0.1 }
/** Falling more than 3.5 hPa in 3 h is "falling quickly" (WMO): storm warning. */
export const WX_ALERT = { windowH: 3, pa: 350 }

const ease = (u: number) => {
  const x = clamp(u, 0, 1)
  return x * x * (3 - 2 * x)
}
/** True sea-level pressure (Pa) at hour t: base, semi-diurnal tide, the front's fall and partial recovery. */
export const wxSeaPa = (tH: number, w = WX_WEEK) =>
  w.basePa + w.tidePa * Math.sin((2 * Math.PI * tH) / 12) - w.dropPa * ease((tH - w.frontH) / w.dropH) + 0.8 * w.dropPa * ease((tH - w.frontH - w.dropH) / w.riseH)
/** Outdoor air (°C): 9 ± 5, warmest at 15:00. */
export const wxAirC = (tH: number) => 9 + 5 * Math.sin((2 * Math.PI * (tH - 9)) / 24)
/** What the BMP280 reads at the station's height. */
export const wxStationPa = (tH: number, w = WX_WEEK) => airPressureAt(w.altM, wxSeaPa(tH, w))
/** Dashboard reduction to sea level with the standard atmosphere (exact inverse of `airPressureAt` for p0). */
export const wxSeaLevel = (pPa: number, altM: number) => (pPa * P_SEA) / airPressureAt(altM)

export const WX_BOARDS = {
  devkit: { name: 'DevKit (USB chip + AMS1117)', extraA: DEVKIT_EXTRA_A },
  bare: { name: 'Bare module + low-Iq LDO', extraA: 0 },
}
export type WxBoard = keyof typeof WX_BOARDS
/** 1 W 6 V panel through a TP4056 (linear: panel current = charge current); full-sun hours per day and daylight length. */
export const WX_SUN = {
  none: { name: 'No panel', panelW: 0, peakH: 0, dayH: 12 },
  summer: { name: '1 W panel, summer', panelW: 1, peakH: 5, dayH: 15 },
  winter: { name: '1 W panel, winter', panelW: 1, peakH: 1, dayH: 8 },
}
export type WxSun = keyof typeof WX_SUN
/** Cloud cover while the front passes: the panel gives 30 %. */
export const wxCloud = (tH: number, w = WX_WEEK) => (tH > w.frontH - 6 && tH < w.frontH + w.dropH + 12 ? 0.3 : 1)

/** Sunlight 0…1 at hour t: half-sine over the daylight, scaled so a day holds `peakH` full-sun hours. */
export function wxSunAt(sun: WxSun, tH: number) {
  const s = WX_SUN[sun]
  const h = ((tH % 24) + 24) % 24
  const u = (h - (12 - s.dayH / 2)) / s.dayH
  return u <= 0 || u >= 1 ? 0 : ((s.peakH * Math.PI) / (2 * s.dayH)) * Math.sin(Math.PI * u)
}
export const wxPanelA = (sun: WxSun, tH: number) => (WX_SUN[sun].panelW / WX_WEEK.panelV) * wxSunAt(sun, tH) * wxCloud(tH)

/** One wake cycle (`nodeCycle`) with the board's always-on extras added to every step. */
export const wxCycle = (everyS: number, radio: NodeRadio, board: WxBoard): Step[] => nodeCycle(everyS, radio).map((p) => ({ ...p, amps: p.amps + WX_BOARDS[board].extraA }))

/** The JSON each wake sends (sea-level hPa, °C, cell V). */
export const wxJson = (seaPa: number, airC: number, volts: number) => `{"id":"wx1","p":${(seaPa / 100).toFixed(1)},"t":${airC.toFixed(1)},"v":${volts.toFixed(2)}}`
/** Bytes on air per report: a fresh TCP connection + HTTP exchange after every deep sleep (none over ESP-NOW: one frame). */
export const wxReportBytes = (radio: NodeRadio) => {
  const payload = wxJson(101_325, 10, 3.9).length
  return radio === 'espnow' ? payload : webExchange('http', payload).reduce((s, k) => s + k.bytes, 0)
}

export interface WxCfg {
  everyS: number
  radio: NodeRadio
  board: WxBoard
  sun: WxSun
}
export interface WxReport {
  t: number
  seaPa: number
  airC: number
  /** 3-hour tendency (Pa per 3 h) from the reading 3 h back; null until there is one. */
  tend: number | null
}
export interface WxSample {
  t: number
  soc: number
  chargeA: number
  alive: boolean
}

/** First hour the true 3-h tendency drops past the alert. */
export function wxTrueAlertH(w = WX_WEEK) {
  for (let t = WX_ALERT.windowH; t <= w.days * 24; t += 0.01) if (wxSeaPa(t, w) - wxSeaPa(t - WX_ALERT.windowH, w) <= -WX_ALERT.pa) return t
  return null
}

/** A week: battery state every `dt` h (average draw vs panel current, dead while flat), a report every wake while alive, each reduced
 *  to sea level with BMP280 ×16 / IIR 4 noise, tendency vs the report ≥ 3 h older, first alert. */
export function wxWeek(cfg: WxCfg, w = WX_WEEK) {
  const cycle = wxCycle(cfg.everyS, cfg.radio, cfg.board)
  const avgA = averageAmps(cycle)
  const noise = bmp280Mode('x16', 'c4').noisePa
  const hours = w.days * 24
  const samples: WxSample[] = []
  const reports: WxReport[] = []
  const everyH = cfg.everyS / 3600
  let soc = w.soc0
  let emptyH: number | null = null
  let nextReport = 0
  let alertH: number | null = null
  let inAh = 0
  let back = 0
  const n = Math.round(hours / w.dt)
  for (let k = 0; k <= n; k++) {
    const t = k * w.dt
    const alive = soc > 0
    const chargeA = soc < 1 ? wxPanelA(cfg.sun, t) : 0
    samples.push({ t, soc, chargeA, alive })
    while (nextReport < t + w.dt && nextReport <= hours) {
      if (alive) {
        const seaPa = wxSeaLevel(wxStationPa(nextReport, w) + noise * gaussAt(reports.length + 1), w.altM)
        while (back + 1 < reports.length && reports[back + 1].t <= nextReport - WX_ALERT.windowH + 1e-9) back++
        const old = reports[back]
        const tend = old && old.t <= nextReport - WX_ALERT.windowH + 1e-9 ? ((seaPa - old.seaPa) * WX_ALERT.windowH) / (nextReport - old.t) : null
        reports.push({ t: nextReport, seaPa, airC: wxAirC(nextReport), tend })
        if (alertH === null && tend !== null && tend <= -WX_ALERT.pa) alertH = nextReport
      }
      nextReport += everyH
    }
    if (k === n) break
    inAh += chargeA * w.dt
    soc = clamp(soc + ((chargeA - (alive ? avgA : 0)) * w.dt) / (w.cellMah / 1000), 0, 1)
    if (soc <= 0 && emptyH === null) emptyH = t + w.dt
  }
  const awake = cycle.slice(0, -1)
  return {
    cycle,
    avgA,
    awakeS: phaseTime(awake),
    radioS: NODE_RADIO[cfg.radio].s,
    samples,
    reports,
    emptyH,
    alertH,
    trueAlertH: wxTrueAlertH(w),
    inMahPerDay: (inAh * 1000) / w.days,
    useMahPerDay: avgA * 24 * 1000,
    socEnd: soc,
    bytesPerDay: (86400 / cfg.everyS) * wxReportBytes(cfg.radio),
  }
}
