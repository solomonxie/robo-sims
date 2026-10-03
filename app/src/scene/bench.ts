// The demo bench: an 18650 lighting an LED through a resistor on a breadboard,
// with the robo-car parts laid out on the desk around it.
import * as THREE from 'three/webgpu'
import { BOARD, Hole, holePosition } from '../core/breadboard'
import { CatalogEntry, entry, num } from '../core/catalog'
import { LedReading, solveLedLoop } from '../core/circuit'
import { buildModel } from '../models'
import { buildJumper, buildLead } from '../models/wire'
import { bottomOf, createStage } from './stage'
import { createXray } from './xray'

export const DESK_Y = -BOARD.height

export interface PlacedPart {
  id: string
  entry: CatalogEntry
  object: THREE.Object3D
  /** Holes its pins sit in, for the inspector. */
  holes: string[]
}

interface Placement {
  id: string
  name: string
  at: [number, number, number]
  rotX?: number
  rotY?: number
  holes?: string[]
  onDesk?: boolean
}

const hole = (row: string, col: number) => holePosition({ row, col } as Hole)

const LED_LOOP: Placement[] = [
  { id: 'R1', name: 'resistor-220', at: [hole('c', 12).x, 0, hole('c', 12).z], holes: ['c10', 'c14'] },
  { id: 'D1', name: 'led-red', at: [hole('e', 14).x + 0.5, 0, hole('e', 14).z], holes: ['e14 (+)', 'e15 (−)'] },
]

const LAYOUT: Placement[] = [
  { id: 'BB1', name: 'breadboard-half', at: [0, 0, 0] },
  ...LED_LOOP,
  { id: 'C1', name: 'cap-100uf', at: [hole('top+', 4).x, 0, -9], rotY: Math.PI / 2, holes: ['top+4', 'top−4'] },
  { id: 'C2', name: 'cap-100nf', at: [hole('i', 19).x, 0, hole('i', 19).z], holes: ['i18', 'i20'] },
  { id: 'U1', name: 'hc-sr04', at: [hole('h', 23).x + 0.5, 0, hole('h', 23).z], holes: ['h22–h25'] },
  { id: 'U2', name: 'dht11', at: [hole('g', 5).x + 0.5, 0, hole('g', 5).z], holes: ['g4–g7'] },
  { id: 'BT1', name: 'battery-18650', at: [-1, 0, -21], onDesk: true },
  { id: 'MCU', name: 'esp32-devkit', at: [-34, 0, -2], rotY: Math.PI / 2, onDesk: true },
  { id: 'DRV', name: 'l298n', at: [33, 0, -8], onDesk: true },
  { id: 'M1', name: 'tt-motor', at: [32, 0, 15], onDesk: true },
  { id: 'W1', name: 'wheel-65', at: [12, 0, 30], rotX: Math.PI / 2, onDesk: true },
  { id: 'W2', name: 'mecanum-60', at: [-30, 0, 22], rotY: 0.5, onDesk: true },
]

export interface Bench {
  scene: THREE.Scene
  parts: PlacedPart[]
  supplyV: number
  /** Swap R1 for another resistor and re-solve the LED loop. */
  setResistor: (name: string) => LedReading
  reading: () => LedReading
  setXray: (on: boolean) => void
  /** Advance the X-ray current animation (seconds). */
  tick: (dt: number) => void
}

export function createBench(): Bench {
  const scene = createStage({ deskY: DESK_Y, span: 45 })
  const parts: PlacedPart[] = []

  const place = (p: Placement): PlacedPart => {
    const e = entry(p.name)
    const object = buildModel(e)
    object.rotation.set(p.rotX ?? 0, p.rotY ?? 0, 0)
    object.position.set(...p.at)
    if (p.onDesk) object.position.y = DESK_Y - bottomOf(object)
    object.userData.partId = p.id
    scene.add(object)
    const placed = { id: p.id, entry: e, object, holes: p.holes ?? [] }
    parts.push(placed)
    return placed
  }
  LAYOUT.forEach(place)

  // Wiring: battery → top rails, + rail → resistor, LED cathode → − rail.
  const battery = parts.find((p) => p.id === 'BT1')!.object
  battery.updateMatrixWorld(true)
  const { pos, neg } = battery.userData.leads as { pos: THREE.Vector3; neg: THREE.Vector3 }
  const wires = [
    buildLead(battery.localToWorld(pos.clone()), hole('top+', 2), '#d4282b'),
    buildLead(battery.localToWorld(neg.clone()), hole('top-', 3), '#202020'),
    buildJumper(hole('top+', 10), hole('a', 10), '#e8b021'),
    buildJumper(hole('a', 15), hole('top-', 16), '#2a55c9'),
  ]
  wires.forEach((w) => scene.add(w))

  const supplyV = num(entry('battery-18650'), 'volts')
  const led = () => parts.find((p) => p.id === 'D1')!
  const resistor = () => parts.find((p) => p.id === 'R1')!

  const reading = () => {
    const d = led().entry
    return solveLedLoop({
      supplyV,
      ohms: num(resistor().entry, 'ohms'),
      forwardVoltageV: num(d, 'forwardVoltageV'),
      maxCurrentMA: num(d, 'maxCurrentMA'),
    })
  }

  const glow = () => {
    const r = reading()
    // Perceived brightness rises fast at low current; sqrt keeps 1 kΩ visible.
    led().object.userData.setGlow(Math.sqrt(r.brightness))
    return r
  }

  const setResistor = (name: string) => {
    const old = resistor()
    scene.remove(old.object)
    parts.splice(parts.indexOf(old), 1)
    place({ ...LED_LOOP[0], name })
    if (xrayOn) xray.setOn(true)
    return glow()
  }

  const xray = createXray({
    scene,
    targets: () => scene.children,
    batteryLeads: {
      pos: battery.localToWorld(pos.clone()),
      neg: battery.localToWorld(neg.clone()),
    },
  })
  let xrayOn = false
  const setXray = (on: boolean) => {
    xrayOn = on
    xray.setOn(on)
  }
  const tick = (dt: number) => xray.update(dt, reading())

  glow()
  return { scene, parts, supplyV, setResistor, reading, setXray, tick }
}
