// H-bridge visuals: the four-switch H diagram (lit routes, beads) and a small driver breakout board.
import * as THREE from 'three/webgpu'
import { HBRIDGE, HSwitch } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { cell } from './circuit'
import { GREY, HEAT, HIGH_V, glowMat, lit, setGlow } from './colors'
import { loopBeads } from './flows'
import { lane, wire } from './layout'
import { litWire } from './logic'
import { IDLE, PIN_COLOR, fetSymbol } from './mcu'
import { brushedMotor } from './motors'
import { diodeSymbol } from './symbols'
import { addLabel } from './text'

const SW: HSwitch[] = ['q1', 'q2', 'q3', 'q4']

// Q1/Q2 left leg, Q3/Q4 right leg (P-FET high, N-FET low), motor across the middle.
export const HB_LX = 7
const TOP = 7
const CX = -13
const DX = 2.8
const PIN = 2.02
export type HbRoute = 'fwd' | 'rev' | 'brakeLo' | 'brakeHi' | 'shootL' | 'shootR' | 'fastOff' | 'diodeLo'
const IN_CELL: V3[] = [[CX, 2.9, 0], [CX, TOP, 0]]
const OUT_CELL: V3[] = [[CX, -TOP, 0], [CX, -2.6, 0]]
const ROUTES: Record<HbRoute, V3[]> = {
  fwd: [...IN_CELL, [-HB_LX, TOP, 0], [-HB_LX, 0, 0], [HB_LX, 0, 0], [HB_LX, -TOP, 0], ...OUT_CELL],
  rev: [...IN_CELL, [HB_LX, TOP, 0], [HB_LX, 0, 0], [-HB_LX, 0, 0], [-HB_LX, -TOP, 0], ...OUT_CELL],
  brakeLo: [[-HB_LX, 0, 0], [HB_LX, 0, 0], [HB_LX, -TOP, 0], [-HB_LX, -TOP, 0]],
  brakeHi: [[-HB_LX, 0, 0], [HB_LX, 0, 0], [HB_LX, TOP, 0], [-HB_LX, TOP, 0]],
  shootL: [...IN_CELL, [-HB_LX, TOP, 0], [-HB_LX, -TOP, 0], ...OUT_CELL],
  shootR: [...IN_CELL, [HB_LX, TOP, 0], [HB_LX, -TOP, 0], ...OUT_CELL],
  fastOff: [[-HB_LX, 0, 0], [HB_LX, 0, 0], [HB_LX + DX, 0, 0], [HB_LX + DX, TOP, 0], [CX, TOP, 0], [CX, 2.9, 0], [CX, -2.6, 0], [CX, -TOP, 0], [-HB_LX + DX, -TOP, 0], [-HB_LX + DX, 0, 0]],
  diodeLo: [[-HB_LX, 0, 0], [HB_LX, 0, 0], [HB_LX, -TOP, 0], [-HB_LX + DX, -TOP, 0], [-HB_LX + DX, 0, 0]],
}

/** The H at `at`, scaled by `s`: `fets` light per switch, `route(key, level, color)` lights a current path, beads ride it. */
export function hBridgeDiagram(scene: THREE.Object3D, at: V3, s: number, { volts = HBRIDGE.vs, diodes = false } = {}) {
  const g = add(scene, new THREE.Group(), at)
  g.scale.setScalar(s)
  add(g, cell(5, 1.5), [CX, 0, 0])
  wire(g, [[CX, 2.9, 0], [CX, TOP, 0], [HB_LX, TOP, 0]], 0.2)
  wire(g, [[CX, -2.6, 0], [CX, -TOP, 0], [HB_LX, -TOP, 0]], 0.2)
  addLabel(g, `+${volts} V`, [CX - 0.4, TOP + 1, 0.3], HIGH_V, 0.7, 'left')
  addLabel(g, '0 V', [CX - 0.4, -TOP - 1, 0.3], GREY, 0.7, 'left')
  const fets = {
    q1: fetSymbol(g, [-HB_LX, TOP, 0], [-HB_LX, 0, 0], 'P', 'Q1'),
    q2: fetSymbol(g, [-HB_LX, 0, 0], [-HB_LX, -TOP, 0], 'N', 'Q2'),
    q3: fetSymbol(g, [HB_LX, TOP, 0], [HB_LX, 0, 0], 'P', 'Q3'),
    q4: fetSymbol(g, [HB_LX, 0, 0], [HB_LX, -TOP, 0], 'N', 'Q4'),
  }
  const dots = SW.map((k) => {
    const m = glowMat(IDLE, 0.4)
    add(g, mesh(new THREE.SphereGeometry(0.42, 16, 12), m), fets[k].gate)
    return m
  })
  if (diodes)
    for (const x of [-HB_LX, HB_LX])
      for (const sy of [1, -1]) {
        const dx = x + DX
        const d = add(g, diodeSymbol(1.2, '#c9ced8'), [dx, (sy * TOP) / 2, 0])
        d.rotation.z = Math.PI / 2
        wire(g, [[dx, (sy * TOP) / 2 + 1.2, 0], [dx, sy > 0 ? TOP : 0, 0], [x, sy > 0 ? TOP : 0, 0]], 0.14)
        wire(g, [[dx, (sy * TOP) / 2 - 1.2, 0], [dx, sy > 0 ? 0 : -TOP, 0], [x, sy > 0 ? 0 : -TOP, 0]], 0.14)
      }
  wire(g, [[-HB_LX, 0, 0], [-PIN, 0, 0], [-PIN, 0, 1.56]], 0.2)
  wire(g, [[HB_LX, 0, 0], [PIN, 0, 0], [PIN, 0, 1.56]], 0.2)
  const motor = brushedMotor(g, [0, 0, 0], 1.3)
  motor.group.rotation.z = Math.PI / 2
  const glows = Object.fromEntries((Object.keys(ROUTES) as HbRoute[]).map((k) => [k, litWire(g, ROUTES[k], 0.34)])) as Record<HbRoute, ReturnType<typeof litWire>>
  const beads = { motor: loopBeads(g, 16, HEAT, { r: 0.26 }), short: loopBeads(g, 16, HIGH_V, { r: 0.26 }) }
  const on = { motor: '', short: '' }
  return {
    g,
    motor,
    /** Switch states 0..1 with heat 0..1, gate dots lit when driven. */
    set(c: Record<HSwitch, number>, heat: Partial<Record<HSwitch, number>> = {}) {
      SW.forEach((k, i) => {
        fets[k].set(c[k], heat[k] ?? 0)
        setGlow(dots[i], c[k] > 0.5 ? PIN_COLOR : IDLE, c[k] > 0.5 ? 1.2 : 0.4)
      })
    },
    /** Lit routes this frame, `[route, level 0..1, colour]`. */
    routes(list: [HbRoute, number, string][]) {
      for (const k of Object.keys(glows) as HbRoute[]) {
        const hit = list.find((r) => r[0] === k)
        glows[k].set(hit ? hit[1] : 0, lit(hit ? hit[2] : HEAT))
      }
    },
    /** Beads on route `r` (null hides them), moved by `du` of the loop. */
    flow(kind: 'motor' | 'short', r: HbRoute | null, du: number) {
      const b = beads[kind]
      b.show(r !== null)
      if (r === null) return
      if (on[kind] !== r) {
        b.setPath(lane(ROUTES[r], 0.9))
        on[kind] = r
      }
      b.step(du)
    },
  }
}


/** Small breakout board, chip on top; returns the chip material for heat glow. */
export function driverBreakout(parent: THREE.Object3D, at: V3, color: string) {
  const g = add(parent, new THREE.Group(), at)
  box(g, [7, 0.4, 5], mat(color, { rough: 0.5 }), [0, 0.2, 0])
  const chip = new THREE.MeshStandardMaterial({ color: '#1b1c20', roughness: 0.6 })
  box(g, [2.2, 0.4, 1.8], chip, [0, 0.6, 0])
  for (const z of [-2, 2]) for (let k = 0; k < 8; k++) cylinder(g, 0.18, 0.5, mat('#d4b25a', { metal: 0.4, rough: 0.35 }), [-2.8 + k * 0.8, 0.6, z], 'y', 8)
  for (let k = 0; k < 6; k++) for (const s of [-1, 1]) box(g, [0.12, 0.06, 0.3], mat('#c9ced8'), [-0.6 + k * 0.24, 0.43, s * 1.05])
  return { g, chip }
}

/** Breakout colours: TB6612 blue, DRV8833 purple. */
export const DRIVER_BOARD_COLOR = { tb6612: '#1f4fa0', drv8833: '#5a2a82' }
