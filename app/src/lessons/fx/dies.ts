// Cut-open transistor dies: an NPN slab (emitter → thin base → collector) and a MOSFET cross-section.
import * as THREE from 'three/webgpu'
import { V3, add, box, mat } from '../../models/kit'
import { ELECTRON, HIGH_V, HOLE, LOW_V, glowMat, potentialColor } from './colors'
import { ACCEPTOR, DONOR } from './crystal'
import { heatGlow } from './heat'
import { partLetter } from './parts'
import { plusGeometry } from './shapes'
import { clamp01, rand } from './util'

const tint = (color: string, k: number) => `#${new THREE.Color(color).lerp(new THREE.Color('#1c1e24'), k).getHexString()}`
const MAX_E = 140
const MAX_H = 24
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

export interface BjtDieStep {
  /** Electrons injected per second through the emitter (shown, not real), and the fraction that recombine in the base. */
  rate: number
  recombine: number
  /** 0..1: the collector junction forward-biased too; electrons crowd the base. */
  saturation: number
}

/** NPN cut open facing +z, centred on `at`: n+ emitter (left), a thin p base, n collector (right); contacts E, B (top of the
 *  base) and C. Electrons cross from E to C; a few recombine in the base with holes fed in from B (the base current). */
export function bjtDie(parent: THREE.Object3D, at: V3, { width = 12, height = 3.6, depth = 2.4 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const eW = width * 0.32
  const bW = width * 0.12
  const cW = width - eW - bW
  const x0 = -width / 2
  const xb = x0 + eW
  const xc = xb + bW
  box(group, [eW, height, depth], mat(tint(DONOR, 0.25), { rough: 0.6 }), [x0 + eW / 2, 0, 0])
  const baseMat = mat(tint(ACCEPTOR, 0.5), { rough: 0.6 }, true)
  box(group, [bW, height, depth], baseMat, [xb + bW / 2, 0, 0])
  box(group, [cW, height, depth], mat(tint(DONOR, 0.55), { rough: 0.6 }), [xc + cW / 2, 0, 0])
  const metal = mat('#b9bec6', { metal: 0.4, rough: 0.35 })
  box(group, [0.6, height + 0.4, depth * 0.8], metal, [x0 - 0.3, 0, 0])
  box(group, [0.6, height + 0.4, depth * 0.8], metal, [width / 2 + 0.3, 0, 0])
  box(group, [bW * 0.9, 0.5, depth * 0.8], metal, [xb + bW / 2, height / 2 + 0.25, 0])
  const front = depth / 2 + 0.06
  const lh = height * 0.22
  partLetter(group, 'n', [x0 + eW / 2, -height / 2 + lh * 0.9, front], lh)
  partLetter(group, 'P', [xb + bW / 2, -height / 2 + lh * 0.9, front], lh)
  partLetter(group, 'n', [xc + cW / 2, -height / 2 + lh * 0.9, front], lh)
  partLetter(group, 'E', [x0 - 1.2, 0, 0], 0.9)
  partLetter(group, 'C', [width / 2 + 1.2, 0, 0], 0.9)
  partLetter(group, 'B', [xb + bW / 2 + 1, height / 2 + 0.9, 0], 0.9)

  const electrons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 10, 8), glowMat(ELECTRON, 1.3), MAX_E)
  const holes = new THREE.InstancedMesh(new THREE.TorusGeometry(0.2, 0.07, 8, 16), glowMat(HOLE, 1.1), MAX_H)
  for (const o of [electrons, holes]) {
    o.frustumCulled = false
    o.castShadow = false
    group.add(o)
  }
  const es = Array.from({ length: MAX_E }, () => ({ live: false, x: 0, y: 0, stop: Infinity, fade: 0 }))
  const hs = Array.from({ length: MAX_H }, () => ({ live: false, x: 0, y: 0, stopY: 0 }))
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  const pinkBase = new THREE.Color(tint(ACCEPTOR, 0.5))
  const flooded = new THREE.Color(ELECTRON)
  let spawn = 0
  const y0 = -height / 2 + 0.35
  const y1 = height / 2 - 0.35

  return {
    group,
    pins: {
      e: [at[0] + x0 - 0.6, at[1], at[2]] as V3,
      b: [at[0] + xb + bW / 2, at[1] + height / 2 + 0.5, at[2]] as V3,
      c: [at[0] + width / 2 + 0.6, at[1], at[2]] as V3,
    },
    step(dt: number, { rate, recombine, saturation }: BjtDieStep) {
      spawn += dt * rate
      const speed = 7 * (1 - 0.3 * clamp01(saturation))
      for (const e of es) {
        if (spawn < 1) break
        if (e.live) continue
        spawn -= 1
        const dies = Math.random() < recombine
        Object.assign(e, { live: true, x: x0 + rand(0, 0.6), y: rand(y0, y1), stop: dies ? xb + rand(0.2, 0.85) * bW : Infinity, fade: 1 })
        if (dies) {
          const free = hs.find((h) => !h.live)
          if (free) Object.assign(free, { live: true, x: e.stop, y: height / 2, stopY: e.y })
        }
      }
      spawn = Math.min(spawn, 2)
      es.forEach((e, i) => {
        if (!e.live) return electrons.setMatrixAt(i, HIDDEN)
        const inBase = e.x > xb && e.x < xc
        const v = speed * (inBase ? 0.6 + 0.4 * (1 - clamp01(saturation)) : 1)
        if (e.x < e.stop) e.x = Math.min(e.stop, e.x + v * dt)
        else e.fade -= dt * 2.5
        e.y += rand(-1, 1) * dt * 0.8
        e.y = Math.min(y1, Math.max(y0, e.y))
        if (e.x > width / 2 || e.fade <= 0) e.live = false
        electrons.setMatrixAt(i, e.live ? m.compose(p.set(e.x, e.y, front + 0.1), q, s.setScalar(Math.max(0.01, e.fade))) : HIDDEN)
      })
      hs.forEach((h, i) => {
        if (!h.live) return holes.setMatrixAt(i, HIDDEN)
        h.y -= dt * 4
        if (h.y <= h.stopY) h.live = false
        holes.setMatrixAt(i, h.live ? m.makeTranslation(h.x, h.y, front + 0.12) : HIDDEN)
      })
      electrons.instanceMatrix.needsUpdate = holes.instanceMatrix.needsUpdate = true
      baseMat.color.copy(pinkBase).lerp(flooded, 0.45 * clamp01(saturation))
    },
  }
}

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
 *  channel; 'p' the mirror (holes). Source on the left unless `flip`; `gateLetter` '' hides the G. `pins` are where wires
 *  attach, in `parent` space. */
export const oxideGlass = () => new THREE.MeshStandardMaterial({ color: '#e8eef8', transparent: true, opacity: 0.55, roughness: 0.2, depthWrite: false })
export const gateMetal = () => new THREE.MeshStandardMaterial({ color: '#7f8590', roughness: 0.4, metalness: 0.2 })

export function mosfetDie(parent: THREE.Object3D, at: V3, { kind = 'n' as 'n' | 'p', width = 16, depth = 7, flip = false, gateLetter = 'G' } = {}) {
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
  box(group, [length + 0.8, OXIDE, THICK], oxideGlass(), [0, OXIDE / 2, 0]).castShadow = false
  const gateMat = gateMetal()
  box(group, [length, GATE_H, THICK], gateMat, [0, OXIDE + GATE_H / 2, 0])
  const metal = mat('#b9bec6', { metal: 0.4, rough: 0.35 })
  for (const x of [xs, xd]) box(group, [wellW * 0.6, 0.6, THICK * 0.7], metal, [x, 0.3, 0])
  const letter = (text: string, x: number, y: number) => partLetter(group, text, [x, y, THICK / 2 + 0.05], 0.9)
  letter('S', xs, -depth - 1)
  letter('d', xd, -depth - 1)
  if (gateLetter) letter(gateLetter, 1.1, OXIDE + GATE_H + 0.9)

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
