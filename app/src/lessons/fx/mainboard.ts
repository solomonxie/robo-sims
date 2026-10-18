// Printer mainboard (MCU, 4 driver sockets, heater MOSFETs, terminals, sensor headers, glowing traces) and a host SBC.
import * as THREE from 'three/webgpu'
import { V3, add, box, GOLD, mat, STEEL } from '../../models/kit'
import { glowMat, setGlow } from './colors'
import { stepDriver } from './modules'
import { label } from './text'

const SILK = { glow: false, color: '#eef2f6' } as const
const DIM = '#2a3a33'

type BoardSpot = 'usb' | 'sd' | 'power' | 'bed' | 'he0' | 'fan0' | 'th0' | 'tb' | 'endX' | 'endY' | 'endZ' | 'mcu' | 'qbed' | 'qhe' | `motor${number}`
type BoardPath = 'usb' | 'power' | 'bed' | 'he0' | 'th0' | 'tb' | `step${number}` | `coil${number}`
const BOARD_AXES = ['X', 'Y', 'Z', 'E'] as const
const DRV_X = [-40, -22, -4, 14]
const DRV_Y = 18

/** Printer mainboard (110 × 80 mm) face-on, facing +z, `k` units per mm (group unmoved for `spot`): MCU, X Y Z E driver
 *  sockets (`kind` A4988 / TMC2209 shown), motor plugs on top, POWER / BED / HE0 / FAN terminals and the two heater MOSFETs
 *  along the bottom, USB + SD on the left, endstop and thermistor headers on the right. `glow(part, color, f)` lights the MCU,
 *  a MOSFET or a copper path; `drivers[i].chip` the driver chips. */
export function printerMainboard(parent: THREE.Object3D, at: V3, k: number, kind: 'a4988' | 'tmc2209' = 'tmc2209') {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(k)
  box(g, [110, 80, 1.6], mat('#1d2a4a', { rough: 0.6 }), [0, 0, -0.8])
  const spots = new Map<string, V3>()
  const put = (name: string, p: V3) => spots.set(name, p)
  const silk = (s: string, p: [number, number], size = 2.6, align: 'left' | 'center' | 'right' = 'center') => add(g, label(s, { ...SILK, size, align }), [p[0], p[1], 0.1])
  const glows = new Map<string, THREE.MeshStandardMaterial>()
  const glowOf = (name: string) => {
    if (!glows.has(name)) glows.set(name, glowMat(DIM, 0))
    return glows.get(name)!
  }
  const path = (name: string, pts: [number, number][], w = 1.1) => {
    const m = glowOf(name)
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      box(g, [Math.abs(x1 - x0) + w, Math.abs(y1 - y0) + w, 0.2], m, [(x0 + x1) / 2, (y0 + y1) / 2, 0.1])
    }
  }
  const terminal = (name: string, x: number, y: number, pins: number, text: string, big = false) => {
    const pw = big ? 7.5 : 5
    box(g, [pw * pins, 8, 9], mat(big ? '#2f8a4c' : '#2f8a4c', { rough: 0.6 }), [x, y, 4.5])
    for (let i = 0; i < pins; i++) box(g, [2.4, 2.4, 0.6], STEEL(), [x + (i - (pins - 1) / 2) * pw, y + 1, 9.1])
    silk(text, [x, y + 6.6], 2.8)
    put(name, [x, y - 4, 4.5])
  }
  const pinHeader = (name: string, x: number, y: number, pins: number, text: string) => {
    box(g, [2.5 * pins, 6, 4], mat('#f0ece2', { rough: 0.6 }), [x, y, 2])
    for (let i = 0; i < pins; i++) box(g, [0.7, 0.7, 6], GOLD(), [x + (i - (pins - 1) / 2) * 2.5, y, 3])
    silk(text, [x - 1.4 * pins - 1.2, y], 2.6, 'right')
    put(name, [x + 1.3 * pins, y, 3])
  }

  const mcuM = glowOf('mcu')
  mcuM.color.set('#16171b')
  box(g, [14, 14, 1.6], mcuM, [34, DRV_Y, 0.8])
  silk('MCU', [34, DRV_Y + 9.6], 3)
  put('mcu', [34, DRV_Y, 1.6])

  const drivers = DRV_X.map((x, i) => {
    const both = (['a4988', 'tmc2209'] as const).map((kd) => ({ kd, h: stepDriver(g, [x, DRV_Y, 0], kd, 1) }))
    box(g, [10, 5.5, 6], mat('#f0ece2', { rough: 0.6 }), [x, 34, 3])
    silk(BOARD_AXES[i], [x + 7.6, 34], 3.4, 'left')
    put(`motor${i}`, [x, 36.8, 3])
    path(`step${i}`, [[27, 11], [27, 4], [x - 6.3, 4], [x - 6.3, 8]])
    path(`coil${i}`, [[x + 6.3, 28.5], [x + 6.3, 31], [x + 3, 31]])
    return {
      chip: (c: string, f: number) => both.forEach((b) => b.h.chip(c, f)),
      show: (kd: 'a4988' | 'tmc2209') => both.forEach((b) => (b.h.group.visible = b.kd === kd)),
    }
  })
  const setKind = (kd: 'a4988' | 'tmc2209') => drivers.forEach((d) => d.show(kd))
  setKind(kind)

  terminal('power', -42, -33, 2, 'POWER IN', true)
  box(g, [8, 4, 4], mat('#e0c040', { rough: 0.5 }), [-42, -20, 2])
  silk('FUSE', [-42, -15.6], 2.4)
  terminal('bed', -24, -33, 2, 'BED', true)
  terminal('he0', -7, -33, 2, 'HE0')
  terminal('fan0', 7, -33, 2, 'FAN0')
  for (const [name, x] of [['qbed', -24], ['qhe', -7]] as const) {
    const m = glowOf(name)
    m.color.set('#1a1b1f')
    box(g, [6.6, 6, 2.2], m, [x, -19, 1.1])
    box(g, [5.4, 2.4, 0.4], STEEL(), [x, -15.2, 0.2])
    silk('Q', [x + 4.2, -19], 2.6, 'left')
    put(name, [x, -19, 2.2])
  }
  path('power', [[-42, -29], [-42, -26], [-34, -26], [-34, -12], [-7, -12], [-7, -15.5]])
  path('bed', [[28, 11], [28, -8], [-24, -8], [-24, -15.5]])
  path('he0', [[31, 11], [31, -10], [-3, -10], [-3, -15.5]])

  box(g, [9, 7.5, 3.4], STEEL(), [-53, 12, 1.7])
  silk('USB', [-53, 6.6], 2.6)
  put('usb', [-57.5, 12, 1.7])
  box(g, [12, 13, 1.6], STEEL(), [-48, -2, 0.8])
  silk('SD', [-40, -2], 2.6, 'left')
  put('sd', [-55, -2, 0.8])
  path('usb', [[-48.5, 12], [-48.5, 2], [-36, 2], [-36, 0], [25, 0], [25, 12]], 0.8)

  pinHeader('endX', 50, 4, 3, 'X STOP')
  pinHeader('endY', 50, -3, 3, 'Y STOP')
  pinHeader('endZ', 50, -10, 3, 'Z STOP')
  pinHeader('th0', 51, -19, 2, 'TH0')
  pinHeader('tb', 51, -27, 2, 'TB')
  path('th0', [[48, -19], [40, -19], [40, 11]], 0.8)
  path('tb', [[48, -27], [37, -27], [37, 11]], 0.8)

  return {
    group: g,
    drivers,
    setKind,
    /** A spot in `parent` space. */
    spot(name: BoardSpot): V3 {
      const p = spots.get(name)!
      return [at[0] + p[0] * k, at[1] + p[1] * k, at[2] + p[2] * k]
    },
    glow(part: BoardPath | 'mcu' | 'qbed' | 'qhe', color: string, f: number) {
      const m = glows.get(part)
      if (!m) return
      if (part === 'mcu' || part === 'qbed' || part === 'qhe') {
        m.emissive.set(color)
        m.emissiveIntensity = 0.45 * f
      } else setGlow(m, f > 0.02 ? color : DIM, Math.max(0.15, f))
    },
  }
}

/** Raspberry-Pi-style host computer (85 × 56 mm) face-on, `k` units per mm: SoC, RAM, GPIO header, USB + Ethernet on the
 *  right. `glow(color, f)` lights the SoC; `usb` = a USB port mouth in `parent` space. */
export function hostSbc(parent: THREE.Object3D, at: V3, k: number) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(k)
  box(g, [85, 56, 1.6], mat('#2a7a3e', { rough: 0.6 }), [0, 0, -0.8])
  const soc = new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.5, roughness: 0.4, emissive: '#000000' })
  box(g, [15, 15, 1.8], soc, [-14, 2, 0.9])
  box(g, [12, 10, 1.2], mat('#16171b', { rough: 0.5 }), [6, 2, 0.6])
  for (let i = 0; i < 20; i++) for (const y of [24, 21.5]) box(g, [0.7, 0.7, 6], GOLD(), [-30 + i * 2.54, y, 3])
  for (const y of [-18, 0]) box(g, [17, 13, 15], STEEL(), [36, y, 7.5])
  box(g, [21, 16, 13], STEEL(), [33, 18, 6.5])
  add(g, label('Raspberry Pi', { ...SILK, size: 4 }), [-14, -16, 0.1])
  return {
    group: g,
    usb: [at[0] + 44.5 * k, at[1] - 9 * k, at[2] + 7.5 * k] as V3,
    glow(color: string, f: number) {
      soc.emissive.set(color)
      soc.emissiveIntensity = f
    },
  }
}
