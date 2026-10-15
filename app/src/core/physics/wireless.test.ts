import { espNowAirtime, espNowLink, frameLoss, gattLink, bytesTemp, linkRssi, relayMbps, tempBytes, webExchange, webTelemetry, wifiRate, wifiTopology } from './wireless'

describe('Wi-Fi links', () => {
  it('RSSI falls with distance and picks slower rates', () => {
    expect(linkRssi(3)).toBeGreaterThan(linkRssi(30))
    expect(wifiRate(-50)).toBe(65)
    expect(wifiRate(-75)).toBe(19.5)
    expect(wifiRate(-90)).toBe(0)
  })
  it('a relay halves the rate of two equal hops', () => {
    expect(relayMbps([52, 52])).toBeCloseTo(26)
    expect(relayMbps([52, 0])).toBe(0)
  })
  it('station mode goes through the router, AP mode is one hop', () => {
    const sta = wifiTopology('sta', 25)
    const ap = wifiTopology('ap', 25)
    expect(sta.path.map((h) => h.to)).toEqual(['router', 'robot'])
    expect(ap.path).toHaveLength(1)
    expect(sta.internet).toBe(true)
    expect(ap.internet).toBe(false)
    expect(ap.mbps).toBeGreaterThan(sta.mbps)
  })
  it('far from the router only AP mode still reaches the phone', () => {
    expect(wifiTopology('sta', 150).ok).toBe(false)
    expect(wifiTopology('ap', 150).ok).toBe(true)
    expect(wifiTopology('apsta', 150)).toMatchObject({ ok: true, internet: false })
    expect(wifiTopology('apsta', 25)).toMatchObject({ ok: true, internet: true })
  })
})

describe('HTTP vs WebSocket', () => {
  it('a new HTTP connection costs 9 segments, a WebSocket push 2', () => {
    expect(webExchange('http', 40)).toHaveLength(9)
    expect(webExchange('keepalive', 40)).toHaveLength(3)
    expect(webExchange('ws', 40)).toHaveLength(2)
  })
  it('WebSocket has far less overhead and never caps the rate', () => {
    const http = webTelemetry('http', 50, 40, 0.025)
    const ws = webTelemetry('ws', 50, 40, 0.025)
    expect(http.overhead).toBeGreaterThan(0.9)
    expect(ws.overhead).toBeLessThan(0.7)
    expect(http.keepsUp).toBe(false)
    expect(http.maxHz).toBeCloseTo(20)
    expect(ws.keepsUp).toBe(true)
    expect(ws.ageS).toBeLessThan(http.ageS)
  })
})

describe('BLE GATT', () => {
  it('encodes temperature as little-endian 0.01 °C', () => {
    expect(tempBytes(23.45)).toEqual([0x29, 0x09])
    expect(bytesTemp(tempBytes(-5.5))).toBeCloseTo(-5.5)
  })
  it('notify needs one event, read two', () => {
    const r = gattLink('read', 0.03, 10)
    const n = gattLink('notify', 0.03, 10)
    expect(r.events).toBe(2)
    expect(n.events).toBe(1)
    expect(n.ageS).toBeLessThan(r.ageS)
    expect(n.bytes).toBeLessThan(r.bytes)
    expect(gattLink('read', 0.1, 10).keepsUp).toBe(false)
  })
})

describe('ESP-NOW', () => {
  it('airtime grows with payload at 1 Mbit/s', () => {
    expect(espNowAirtime(0)).toBeCloseTo(192e-6 + 344e-6)
    expect(espNowAirtime(250)).toBeCloseTo(192e-6 + 2344e-6)
  })
  it('loss is 50 % at sensitivity', () => {
    expect(frameLoss(-98)).toBeCloseTo(0.5)
    expect(frameLoss(-70)).toBeLessThan(1e-6)
  })
  it('close robots deliver everything in about a millisecond; far ones retry', () => {
    const near = espNowLink(32, 10)
    const far = espNowLink(32, 500)
    expect(near.delivered).toBeCloseTo(1)
    expect(near.tries).toBeCloseTo(1)
    expect(near.latencyS).toBeLessThan(2e-3)
    expect(far.tries).toBeGreaterThan(1.5)
    expect(far.delivered).toBeLessThan(near.delivered)
  })
})
