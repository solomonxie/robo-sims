import { rssiDbm } from '../signals/radio'

export const WIFI_CH6_HZ = 2.437e9
/** Path-loss exponent for robots near the floor or ground, among furniture and people. */
export const NEAR_GROUND_N = 3
export const ESP_TX_DBM = 20
export const ESP_GAIN_DB = 2

export const linkRssi = (meters: number) => rssiDbm(ESP_TX_DBM, ESP_GAIN_DB, meters, WIFI_CH6_HZ, 0, NEAR_GROUND_N)

/** 802.11n HT20, one stream, 800 ns guard: MCS7 … MCS0 and the RSSI each needs on an ESP32. */
export const HT20_MCS: readonly [number, number][] = [
  [-64, 65],
  [-65, 58.5],
  [-66, 52],
  [-70, 39],
  [-74, 26],
  [-77, 19.5],
  [-79, 13],
  [-82, 6.5],
]

/** Best PHY rate (Mbit/s) the RSSI supports, 0 = no link. */
export const wifiRate = (rssi: number) => HT20_MCS.find(([min]) => rssi >= min)?.[1] ?? 0

/** A relay (the router) sends every frame twice on one channel, so the times add: 1 / (1/r1 + 1/r2 …). */
export const relayMbps = (rates: number[]) => (rates.some((r) => r <= 0) ? 0 : 1 / rates.reduce((s, r) => s + 1 / r, 0))

export type WifiMode = 'sta' | 'ap' | 'apsta'
export interface Hop {
  from: 'phone' | 'router' | 'robot'
  to: 'phone' | 'router' | 'robot'
  m: number
  rssi: number
  mbps: number
}
export const PHONE_TO_ROBOT_M = 3

const hop = (from: Hop['from'], to: Hop['to'], m: number): Hop => {
  const rssi = linkRssi(m)
  return { from, to, m, rssi, mbps: wifiRate(rssi) }
}

/** The phone stays next to the robot; the robot is `robotM` from the home router. Which hops carry phone ↔ robot traffic, and who has internet. */
export function wifiTopology(mode: WifiMode, robotM: number) {
  const up = hop('robot', 'router', robotM)
  const path = mode === 'sta' ? [hop('phone', 'router', robotM + PHONE_TO_ROBOT_M), hop('router', 'robot', robotM)] : [hop('phone', 'robot', PHONE_TO_ROBOT_M)]
  const mbps = relayMbps(path.map((h) => h.mbps))
  return {
    path,
    uplink: mode === 'ap' ? null : up,
    mbps,
    ok: mbps > 0,
    internet: mode !== 'ap' && up.mbps > 0,
    robotIp: mode === 'sta' ? '192.168.1.37' : '192.168.4.1',
    phoneIp: mode === 'sta' ? '192.168.1.20' : '192.168.4.2',
    dhcp: mode === 'sta' ? 'router' : 'robot',
  }
}

// --- HTTP polling vs a WebSocket push, one telemetry sample each ---

export const TCP_IP_BYTES = 40
export const HTTP_REQ_BYTES = 160
export const HTTP_RESP_BYTES = 110
export const WS_HDR_BYTES = 2

export type WebProto = 'http' | 'keepalive' | 'ws'
export interface WebPacket {
  what: string
  up: boolean
  bytes: number
  payload: number
}

/** TCP segments for one telemetry sample (robot → phone = down). */
export function webExchange(proto: WebProto, payload: number): WebPacket[] {
  const seg = (what: string, up: boolean, extra = 0, data = 0): WebPacket => ({ what, up, bytes: TCP_IP_BYTES + extra + data, payload: data })
  const getResp = [seg('GET', true, HTTP_REQ_BYTES), seg('200 OK', false, HTTP_RESP_BYTES, payload), seg('ACK', true)]
  if (proto === 'ws') return [seg('WS frame', false, WS_HDR_BYTES, payload), seg('ACK', true)]
  if (proto === 'keepalive') return getResp
  return [seg('SYN', true), seg('SYN-ACK', false), seg('ACK', true), ...getResp, seg('FIN', false), seg('FIN', true), seg('ACK', false)]
}

/** Round trips the phone waits per sample: polling must ask, a new connection must handshake first; a push needs none. */
export const webRounds = (proto: WebProto) => (proto === 'http' ? 2 : proto === 'keepalive' ? 1 : 0)

/** One sample per `hz`; a poller can't ask faster than one request per `rounds` RTTs. Age = wait for the next sample + one-way trip. */
export function webTelemetry(proto: WebProto, hz: number, payload: number, rttS: number) {
  const packets = webExchange(proto, payload)
  const rounds = webRounds(proto)
  const maxHz = rounds ? 1 / (rounds * rttS) : Infinity
  const rate = Math.min(hz, maxHz)
  const bytes = packets.reduce((s, k) => s + k.bytes, 0)
  return {
    packets,
    bytes,
    overhead: 1 - payload / bytes,
    rate,
    maxHz,
    keepsUp: hz <= maxHz,
    bytesPerS: bytes * rate,
    ageS: 1 / (2 * rate) + rttS / 2,
  }
}

// --- BLE GATT: read vs notify on a 16-bit temperature characteristic ---

/** LL: preamble 1 + access address 4 + header 2 + CRC 3; L2CAP: length 2 + channel 2. */
export const BLE_LL_BYTES = 10
export const BLE_L2CAP_BYTES = 4
export const BLE_US_PER_BYTE = 8

/** Temperature characteristic 0x2A6E: sint16 in 0.01 °C, little-endian. */
export function tempBytes(c: number): [number, number] {
  const v = (Math.round(c * 100) + 0x10000) % 0x10000
  return [v % 256, Math.floor(v / 256)]
}
export const bytesTemp = ([lo, hi]: [number, number]) => {
  const v = hi * 256 + lo
  return (v >= 0x8000 ? v - 0x10000 : v) / 100
}

export type GattMode = 'read' | 'notify'
/** ATT PDUs per sample: Read Request (opcode + handle) and Read Response (opcode + value), or one Handle Value Notification. */
export function gattPdus(mode: GattMode, value = 2) {
  return mode === 'read'
    ? [
        { what: 'Read Req', up: true, att: 3 },
        { what: 'Read Rsp', up: false, att: 1 + value },
      ]
    : [{ what: 'Notify', up: false, att: 3 + value }]
}

/** Radio only talks at connection events every `ciS`. Read: request in one event, response in the next. Notify: the next event. */
export function gattLink(mode: GattMode, ciS: number, hz: number) {
  const pdus = gattPdus(mode)
  const events = pdus.length
  const maxHz = 1 / (events * ciS)
  const rate = Math.min(hz, maxHz)
  const bytes = pdus.reduce((s, p) => s + p.att + BLE_L2CAP_BYTES + BLE_LL_BYTES, 0)
  return {
    pdus,
    events,
    maxHz,
    rate,
    keepsUp: hz <= maxHz,
    bytes,
    airUs: bytes * BLE_US_PER_BYTE,
    ageS: 1 / (2 * rate) + (events - 0.5) * ciS,
  }
}

// --- ESP-NOW: vendor action frames at 1 Mbit/s, acked by the peer's MAC ---

export const ESPNOW_MAX = 250
/** MAC header 24 + category/OUI/random 8 + vendor element 7 + FCS 4. */
export const ESPNOW_FRAME_BYTES = 43
export const ESPNOW_SENS_DBM = -98
export const ESPNOW_RETRIES = 7
const PREAMBLE_S = 192e-6
const SIFS_S = 10e-6
const DIFS_S = 50e-6
const SLOT_S = 20e-6
const CW_MIN = 31

export const espNowAirtime = (payload: number, mbps = 1) => PREAMBLE_S + ((Math.min(payload, ESPNOW_MAX) + ESPNOW_FRAME_BYTES) * 8) / (mbps * 1e6)
export const ackAirtime = (mbps = 1) => PREAMBLE_S + (14 * 8) / (mbps * 1e6)
/** One attempt: wait DIFS + average backoff, send, SIFS, ACK. */
export const espNowAttempt = (payload: number) => DIFS_S + (CW_MIN / 2) * SLOT_S + espNowAirtime(payload) + SIFS_S + ackAirtime()
/** Frame error rate: ~0 well above sensitivity, 50 % at it, ~1 below. */
export const frameLoss = (rssi: number, sens = ESPNOW_SENS_DBM) => 1 / (1 + Math.exp((rssi - sens) / 1.5))

export function espNowLink(payload: number, meters: number) {
  const rssi = linkRssi(meters)
  const per = frameLoss(rssi)
  const attempt = espNowAttempt(payload)
  const n = ESPNOW_RETRIES + 1
  const delivered = 1 - per ** n
  const tries = per < 1 ? (1 - per ** n) / (1 - per) : n
  return { rssi, per, attempt, air: espNowAirtime(payload), tries, delivered, latencyS: tries * attempt }
}
