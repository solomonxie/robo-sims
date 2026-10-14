// MOSFETs: the real part (TO-92 or TO-220) in a circuit, and one cut open: substrate, wells, gate on its oxide, carriers.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, mat, STEEL } from '../../models/kit'
import { TO220, buildTo220 } from '../../models/passives'
import { litEpoxy, partLetter, transistorPart } from './bjt'
import { glowHalo } from './circuit'
import { CONVENTIONAL, ELECTRON, HIGH_V, HOLE, LOW_V, glowMat, potentialColor } from './colors'
import { ACCEPTOR, DONOR } from './crystal'
import { segmentDisplay } from './displays'
import { heatGlow } from './heat'
import { plusGeometry } from './shapes'
import { clamp01, rand } from './util'

const THICK = 4
const FRONT = THICK / 2 + 0.3
const WELL_D = 2.4
const OXIDE = 0.4
const GATE_H = 1.4
const CHANNEL_MAX = 1.8
const DEPLETE_MAX = 3
const SLICES = 32
const RIDERS = 36
const WALK = 2.6
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

export interface DieStep {
  /** Gate drive 0..1: charge on the gate. */
  gate: number
  /** Depletion depth under the gate, 0..1. */
  deplete: number
  /** Channel thickness 0..1 at `u` (0 = source end, 1 = drain end). */
  channel: (u: number) => number
  /** Channel carrier speed where the channel is full, scene units/s; faster where it thins (same current). */
  flow: number
  heat?: number
}

const tint = (color: string, k: number) => `#${new THREE.Color(color).lerp(new THREE.Color('#1c1e24'), k).getHexString()}`

/** Carriers wandering inside a region of the cut face; `walk(dt, keep)` moves them and pushes strays back. */
function swarm(parent: THREE.Object3D, count: number, hole: boolean, spawn: () => [number, number]) {
  const geometry = hole ? new THREE.TorusGeometry(0.3, 0.09, 8, 20) : new THREE.SphereGeometry(0.3, 12, 8)
  const dots = new THREE.InstancedMesh(geometry, glowMat(hole ? HOLE : ELECTRON, hole ? 1 : 1.3), count)
  dots.frustumCulled = false
  dots.castShadow = false
  parent.add(dots)
  const p = Array.from({ length: count }, () => new THREE.Vector2(...spawn()))
  const v = p.map(() => new THREE.Vector2(rand(-1, 1), rand(-1, 1)).setLength(WALK))
  const m = new THREE.Matrix4()
  return {
    walk(dt: number, keep: (p: THREE.Vector2, v: THREE.Vector2) => void) {
      p.forEach((q, i) => {
        if (Math.random() < dt * 3) v[i].rotateAround(new THREE.Vector2(), rand(-2, 2))
        q.addScaledVector(v[i], dt)
        keep(q, v[i])
        dots.setMatrixAt(i, m.makeTranslation(q.x, q.y, FRONT))
      })
      dots.instanceMatrix.needsUpdate = true
    },
  }
}

/** Bounces `q` back inside [x0, x1] × [y0, y1]; an edge that moved past it pulls it in smoothly. */
function inside(q: THREE.Vector2, v: THREE.Vector2, x0: number, x1: number, y0: number, y1: number, dt: number) {
  q.x = Math.min(x1, Math.max(x0, q.x))
  q.y = Math.max(y0, q.y)
  if (q.y > y1) q.y -= (q.y - y1) * Math.min(1, dt * 8 + 0.05)
  if (q.x <= x0 || q.x >= x1) v.x = Math.sign(-q.x + (x0 + x1) / 2) * Math.abs(v.x)
  if (q.y <= y0 || q.y >= y1) v.y = Math.sign(-q.y + (y0 + y1) / 2) * Math.abs(v.y)
}

/** MOSFET cross-section facing +z, the top of the silicon at y = 0. `kind` 'n': p substrate, n+ wells, an electron
 *  channel; 'p' the mirror (holes). Source on the left unless `flip`. `pins` are where wires attach, in `parent` space. */
export function mosfetDie(parent: THREE.Object3D, at: V3, { kind = 'n' as 'n' | 'p', width = 16, depth = 7, flip = false } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const nmos = kind === 'n'
  const s = flip ? -1 : 1
  const wellW = width * 0.27
  const length = width - 2 * wellW
  const xs = s * (-width / 2 + wellW / 2)
  const xd = -xs
  const xAt = (u: number) => s * (-length / 2 + u * length)

  const substrate = mat(tint(nmos ? ACCEPTOR : DONOR, 0.62), { rough: 0.7 }, true)
  box(group, [width, depth, THICK], substrate, [0, -depth / 2, 0])
  const wellMat = mat(tint(nmos ? DONOR : ACCEPTOR, 0.35), { rough: 0.6 })
  for (const x of [xs, xd]) box(group, [wellW, WELL_D, THICK + 0.04], wellMat, [x, -WELL_D / 2 + 0.01, 0])
  const glass = new THREE.MeshStandardMaterial({ color: '#e8eef8', transparent: true, opacity: 0.55, roughness: 0.2, depthWrite: false })
  box(group, [length + 0.8, OXIDE, THICK], glass, [0, OXIDE / 2, 0]).castShadow = false
  const gateMat = new THREE.MeshStandardMaterial({ color: '#7f8590', roughness: 0.4, metalness: 0.2 })
  box(group, [length, GATE_H, THICK], gateMat, [0, OXIDE + GATE_H / 2, 0])
  const metal = mat('#b9bec6', { metal: 0.4, rough: 0.35 })
  for (const x of [xs, xd]) box(group, [wellW * 0.6, 0.6, THICK * 0.7], metal, [x, 0.3, 0])
  const letter = (text: string, x: number, y: number) => {
    const d = segmentDisplay(1, 0.9, '#c9ced8', true)
    d.set(text)
    add(group, d.group, [x, y, THICK / 2 + 0.05])
  }
  letter('S', xs, -depth - 1)
  letter('d', xd, -depth - 1)
  letter('G', 1.1, OXIDE + GATE_H + 0.9)

  const zone = box(group, [length, 1, 0.05], new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, depthWrite: false }), [0, 0, THICK / 2 + 0.05])
  zone.castShadow = false

  const ionGeo = nmos ? new THREE.BoxGeometry(0.6, 0.18, 0.18) : plusGeometry(0.6)
  const ionSpots: [number, number][] = []
  for (let row = 0; row < 4; row++)
    for (let x = -length / 2 + 0.6 + (row % 2) * 0.6; x < length / 2 - 0.3; x += 1.3) ionSpots.push([x, -0.45 - row * 0.8])
  const ions = new THREE.InstancedMesh(ionGeo, glowMat(nmos ? LOW_V : HIGH_V, 0.7), ionSpots.length)
  const gateSigns = new THREE.InstancedMesh(nmos ? plusGeometry(0.6) : new THREE.BoxGeometry(0.6, 0.18, 0.18), glowMat(nmos ? HIGH_V : LOW_V, 0.9), 7)
  const sliceMat = new THREE.MeshStandardMaterial({ color: nmos ? ELECTRON : HOLE, emissive: nmos ? ELECTRON : HOLE, emissiveIntensity: 0.9, transparent: true, opacity: 0.7, depthWrite: false })
  const slices = new THREE.InstancedMesh(new THREE.BoxGeometry(length / SLICES, 1, 0.05), sliceMat, SLICES)
  const riderGeo = nmos ? new THREE.SphereGeometry(0.3, 12, 8) : new THREE.TorusGeometry(0.3, 0.09, 8, 20)
  const riders = new THREE.InstancedMesh(riderGeo, glowMat(nmos ? ELECTRON : HOLE, 1.3), RIDERS)
  for (const o of [ions, gateSigns, slices, riders]) {
    o.frustumCulled = false
    o.castShadow = false
    group.add(o)
  }
  const m = new THREE.Matrix4()
  for (let i = 0; i < 7; i++) gateSigns.setMatrixAt(i, m.makeTranslation(((i - 3) / 3.4) * (length / 2), OXIDE + 0.35, THICK / 2 + 0.1))

  const majority = swarm(group, 22, nmos, () => [rand(-width / 2 + 0.5, width / 2 - 0.5), rand(-depth + 0.5, -WELL_D - 0.5)])
  const wells = [xs, xd].map((x) => ({ x, crowd: swarm(group, 12, !nmos, () => [x + rand(-wellW / 2, wellW / 2) * 0.8, rand(-WELL_D + 0.3, -0.3)]) }))
  const ride = Array.from({ length: RIDERS }, (_, i) => ({ u: (i + rand(0, 0.8)) / RIDERS, r: rand(0.15, 0.85) }))
  const c = new THREE.Color()

  return {
    group,
    length,
    pins: {
      source: [at[0] + xs, at[1] + 0.6, at[2]] as V3,
      drain: [at[0] + xd, at[1] + 0.6, at[2]] as V3,
      gate: [at[0], at[1] + OXIDE + GATE_H, at[2]] as V3,
    },
    /** Gate potential as a fraction of full scale. */
    paintGate(f: number) {
      potentialColor(f, c)
      gateMat.color.copy(c)
      gateMat.emissive.copy(c).multiplyScalar(0.35)
    },
    step(dt: number, { gate, deplete, channel, flow, heat = 0 }: DieStep) {
      const dz = deplete * DEPLETE_MAX
      zone.visible = dz > 0.05
      zone.scale.y = Math.max(0.01, dz)
      zone.position.y = -dz / 2
      ionSpots.forEach(([x, y], i) => ions.setMatrixAt(i, y > -dz ? m.makeTranslation(x, y, FRONT - 0.1) : HIDDEN))
      ions.instanceMatrix.needsUpdate = true
      gateSigns.count = Math.round(7 * clamp01(gate))

      let total = 0
      for (let k = 0; k < SLICES; k++) {
        const u = (k + 0.5) / SLICES
        const h = clamp01(channel(u)) * CHANNEL_MAX
        total += h / CHANNEL_MAX / SLICES
        slices.setMatrixAt(k, h > 0.01 ? m.makeScale(1, h, 1).setPosition(xAt(u), -h / 2, THICK / 2 + 0.08) : HIDDEN)
      }
      slices.instanceMatrix.needsUpdate = true
      const shown = Math.round(RIDERS * Math.sqrt(total))
      ride.forEach((q, i) => {
        if (i >= shown) return
        q.u += (flow * dt) / length / Math.max(0.15, channel(q.u))
        if (q.u > 1) q.u -= 1
        q.r = Math.min(0.9, Math.max(0.1, q.r + rand(-1, 1) * dt))
        const h = clamp01(channel(q.u)) * CHANNEL_MAX
        riders.setMatrixAt(i, m.makeTranslation(xAt(q.u) + rand(-0.04, 0.04), -0.1 - q.r * Math.max(0, h - 0.2), FRONT))
      })
      riders.count = shown
      riders.instanceMatrix.needsUpdate = true

      majority.walk(dt, (q, v) => {
        const under = Math.abs(q.x) < length / 2 + 0.3
        inside(q, v, -width / 2 + 0.4, width / 2 - 0.4, -depth + 0.4, under ? -0.4 - dz : -WELL_D - 0.4, dt)
      })
      for (const w of wells) w.crowd.walk(dt, (q, v) => inside(q, v, w.x - wellW / 2 + 0.4, w.x + wellW / 2 - 0.4, -WELL_D + 0.35, -0.3, dt))
      heatGlow(substrate, heat)
    },
  }
}

const TO220_LEGS = 1

/** A discrete n-MOSFET with its gate lead ending at `at`, gate wire coming from −x. 'TO-92' (2N7000) lies on its side like
 *  `transistorPart`: D at `at` + (0, scale), S at `at` − (0, scale). 'TO-220' stands upright at 0.75 × `scale`: legs G D S
 *  pointing down, S two pitches right of G; the drain is taken off the tab's bolt hole, straight above the middle leg.
 *  `set(f, heat)`: f = drain current / full scale glows the die, heat 0..1 reddens the epoxy. */
export function fetPart(parent: THREE.Object3D, at: V3, pkg: 'TO-92' | 'TO-220', { scale = 1.6 } = {}) {
  if (pkg === 'TO-92') {
    const t = transistorPart(parent, at, { scale, letters: ['d', 'G', 'S'] })
    return { group: t.group, pins: { d: t.pins.c, g: t.pins.b, s: t.pins.e }, die: t.die, set: t.set }
  }
  const k = 0.75 * scale
  const { h, t, tabUp, holeDown } = TO220
  const group = add(parent, new THREE.Group(), [at[0] + k, at[1] + (TO220_LEGS - TO220.base) * k, at[2]])
  const part = add(group, buildTo220({ legs: TO220_LEGS }))
  part.scale.setScalar(k)
  const body = part.userData.body as THREE.MeshStandardMaterial
  litEpoxy(body)
  const y0 = at[1] + TO220_LEGS * k
  const d: V3 = [at[0] + k, y0 + (h + tabUp - holeDown) * k, at[2]]
  cylinder(parent, 0.5 * k, 0.4 * k, STEEL(), [d[0], d[1], at[2] + (TO220.tab - t / 2 + 0.2) * k], 'z', 16)
  const die: V3 = [at[0] + k, y0 + 0.5 * h * k, at[2]]
  const halo = glowHalo(parent, [die[0], die[1], at[2] + t * k], 1.1 * k)
  const tag = 0.4 * scale
  partLetter(parent, 'G', [at[0] - 0.6 * k, at[1] - 0.9 * k, at[2]], tag)
  partLetter(parent, 'S', [at[0] + 2.8 * k, at[1] + 0.6 * k, at[2]], tag)
  partLetter(parent, 'd', [d[0] + 1.6 * k, d[1], at[2]], tag)
  return {
    group,
    pins: { d, g: at, s: [at[0] + 2 * k, at[1], at[2]] as V3 },
    die,
    set(f: number, heat = 0) {
      halo.set(0.45 * Math.sqrt(clamp01(f)), CONVENTIONAL)
      heatGlow(body, heat)
    },
  }
}
