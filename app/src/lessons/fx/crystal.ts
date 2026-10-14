// A silicon crystal drawn flat: atoms, two shared electrons per bond, dopants, free electrons and hopping holes.
import * as THREE from 'three/webgpu'
import { add, mesh } from '../../models/kit'
import { ELECTRON, HIGH_V, HOLE, LOW_V, RING, glowMat } from './colors'
import { plusGeometry } from './shapes'
import { UP, clamp01, rand } from './util'

export const SILICON = '#9aa3ad'
export const DONOR = '#4cd07d'
export const ACCEPTOR = '#ff6fb0'
export type Dopant = 'donor' | 'acceptor'

const MAX = 64
const FLASHES = 12
const HOP_S = 0.24
const FREE_Z = 1.1
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

interface Hole {
  slot: number
  from: number
  t: number
  wait: number
  bound: number
  tracked: boolean
}

interface Electron {
  p: THREE.Vector3
  v: THREE.Vector3
  orbit: number
  phase: number
  fall: Hole | null
}

export interface CrystalStep {
  kelvin?: number
  /** Thermal electron–hole pairs to keep. */
  pairs?: number
  /** Electron drift in scene units/s toward −x (current flows +x); a function of x for non-uniform fields. */
  drift?: number | ((x: number) => number)
  /** Hole drift speed as a fraction of the electron's (μp / μn). */
  holeRatio?: number
}

/** Atoms on a `cols` × `rows` grid of `pitch`, centred on the origin, facing +z; wraps around in x so carriers can flow
 *  through. `dopants` maps a site (row × cols + col, row 0 at the bottom) to a donor (5th electron that escapes, leaving +)
 *  or an acceptor (a bond one short: a hole that wanders off, leaving −). Dopants ionize one by one after `ionizeAfter` s. */
export function siliconCrystal(
  parent: THREE.Object3D,
  { cols = 9, rows = 5, pitch = 3.2, dopants = new Map<number, Dopant>(), ionizeAfter = 0.8, track = false } = {},
) {
  const group = add(parent, new THREE.Group())
  const width = cols * pitch
  const height = rows * pitch
  const site = (i: number) => new THREE.Vector3((((i % cols) - (cols - 1) / 2) * pitch), (Math.floor(i / cols) - (rows - 1) / 2) * pitch, 0)
  const sites = Array.from({ length: cols * rows }, (_, i) => site(i))

  const bonds: [number, number][] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = r * cols + c
      bonds.push([a, r * cols + ((c + 1) % cols)])
      if (r < rows - 1) bonds.push([a, a + cols])
    }
  const off = 0.42
  const slots: THREE.Vector3[] = []
  const wraps: number[] = []
  bonds.forEach(([a, b], k) => {
    const wrap = sites[b].x < sites[a].x
    const end = wrap ? sites[a].clone().setX(sites[a].x + pitch) : sites[b]
    const mid = sites[a].clone().lerp(end, 0.5)
    if (wrap) mid.x -= pitch * 0.1
    const side = new THREE.Vector3(-(end.y - sites[a].y), end.x - sites[a].x, 0).setLength(off)
    slots.push(mid.clone().add(side), mid.clone().sub(side))
    if (wrap) wraps.push(2 * k, 2 * k + 1)
  })
  const touching = (k: number, atom: number) => bonds[k][0] === atom || bonds[k][1] === atom
  const bondOf = (s: number) => Math.floor(s / 2)
  const neighbours = slots.map((_, s) => {
    const [a, b] = bonds[bondOf(s)]
    return slots.flatMap((__, o) => (bondOf(o) !== bondOf(s) && (touching(bondOf(o), a) || touching(bondOf(o), b)) ? [o] : []))
  })
  const dxWrap = (a: THREE.Vector3, b: THREE.Vector3) => {
    const d = b.x - a.x
    return d > width / 2 ? d - width : d < -width / 2 ? d + width : d
  }

  const atoms = new THREE.InstancedMesh(new THREE.SphereGeometry(0.85, 24, 16), new THREE.MeshStandardMaterial({ roughness: 0.45 }), sites.length)
  const c = new THREE.Color()
  sites.forEach((_, i) => atoms.setColorAt(i, c.set(dopants.get(i) === 'donor' ? DONOR : dopants.get(i) === 'acceptor' ? ACCEPTOR : SILICON)))

  const stubs: [THREE.Vector3, THREE.Vector3][] = []
  for (let r = 0; r < rows; r++) {
    const left = sites[r * cols]
    stubs.push([left.clone().setX(left.x - pitch / 2), left])
  }
  for (let col = 0; col < cols; col++) {
    const lo = sites[col]
    const hi = sites[(rows - 1) * cols + col]
    stubs.push([lo.clone().setY(lo.y - pitch / 2), lo], [hi, hi.clone().setY(hi.y + pitch / 2)])
  }
  const sticks: [THREE.Vector3, THREE.Vector3][] = [
    ...bonds.map(([a, b]): [THREE.Vector3, THREE.Vector3] => (sites[b].x < sites[a].x ? [sites[a], sites[a].clone().setX(sites[a].x + pitch / 2)] : [sites[a], sites[b]])),
    ...stubs,
  ]
  const rods = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.11, 1, 8), new THREE.MeshStandardMaterial({ color: '#5d636e', roughness: 0.6 }), sticks.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const d = new THREE.Vector3()
  const s3 = new THREE.Vector3()
  const p = new THREE.Vector3()
  sticks.forEach(([a, b], i) => {
    d.subVectors(b, a)
    q.setFromUnitVectors(UP, d.clone().normalize())
    rods.setMatrixAt(i, m.compose(p.addVectors(a, b).multiplyScalar(0.5), q, s3.set(1, d.length(), 1)))
  })

  const stubDots = stubs.flatMap(([a, b], i) => {
    if (i < rows) return []
    const mid = a.clone().lerp(b, (i - rows) % 2 ? 0.8 : 0.2)
    return [mid.clone().setX(mid.x + off), mid.clone().setX(mid.x - off)]
  })
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }), slots.length + wraps.length + stubDots.length)
  const free = new THREE.InstancedMesh(new THREE.SphereGeometry(0.46, 16, 12), glowMat(ELECTRON, 1.4), MAX)
  const rings = new THREE.InstancedMesh(new THREE.TorusGeometry(0.4, 0.12, 8, 24), new THREE.MeshBasicMaterial({ color: '#ffffff' }), MAX)
  const flashes = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    FLASHES,
  )
  for (const o of [atoms, rods, dots, free, rings, flashes]) {
    o.frustumCulled = false
    group.add(o)
  }
  for (const o of [dots, free, rings, flashes]) o.castShadow = false

  const ions = [...dopants].map(([at, kind]) => {
    const sign = kind === 'donor'
      ? mesh(plusGeometry(0.9), glowMat(HIGH_V, 0.8))
      : mesh(new THREE.BoxGeometry(0.9, 0.29, 0.29), glowMat(LOW_V, 0.8))
    add(group, sign, [sites[at].x, sites[at].y, 1]).visible = false
    return { at, kind, sign, delay: ionizeAfter, grown: 0, ionized: false }
  })
  ions.forEach((ion, i) => (ion.delay += i * 0.35))

  const electrons: Electron[] = []
  const holes: Hole[] = []
  const flash: { at: THREE.Vector3; t: number; color: THREE.Color }[] = []
  const thermalV = () => new THREE.Vector3(rand(-1, 1), rand(-1, 1), 0).normalize()
  const taken = () => new Set(holes.flatMap((h) => [h.slot, h.from]))

  for (const ion of ions) {
    if (ion.kind === 'donor') electrons.push({ p: sites[ion.at].clone(), v: new THREE.Vector3(), orbit: ion.at, phase: rand(0, 6.3), fall: null })
    else {
      const slot = 2 * bonds.findIndex(([a]) => a === ion.at)
      holes.push({ slot, from: slot, t: 1, wait: rand(0.3, 0.8), bound: ion.at, tracked: false })
    }
  }

  const burst = (at: THREE.Vector3, color: string) => {
    if (flash.length >= FLASHES) flash.shift()
    flash.push({ at: at.clone().setZ(FREE_Z), t: 0, color: new THREE.Color(color) })
  }

  const net = { electrons: 0, holes: 0 }
  const state = { gen: 0, time: 0 }
  const holeAt = (h: Hole, out: THREE.Vector3) => {
    const a = slots[h.from]
    const b = slots[h.slot]
    if (h.t >= 1) return out.copy(b)
    const t = h.t * h.t * (3 - 2 * h.t)
    return out.set(a.x + dxWrap(a, b) * t, a.y + (b.y - a.y) * t, 0)
  }
  const tmp = new THREE.Vector3()
  const yellow = new THREE.Color(RING)
  const blue = new THREE.Color(ELECTRON).multiplyScalar(0.7)
  const red = new THREE.Color(HOLE)

  const step = (dt: number, { kelvin = 300, pairs = 0, drift = 0, holeRatio = 480 / 1350 }: CrystalStep = {}) => {
    state.time += dt
    const driftAt = (x: number) => (typeof drift === 'number' ? drift : drift(x))
    const thermal = 2.6 * Math.sqrt(kelvin / 300)

    for (const ion of ions) {
      if (!ion.ionized && state.time >= ion.delay) {
        ion.ionized = true
        if (ion.kind === 'donor') {
          const e = electrons.find((x) => x.orbit === ion.at)
          if (e) {
            e.orbit = -1
            e.v.copy(thermalV()).multiplyScalar(thermal * 1.5)
            burst(e.p, ELECTRON)
          }
        } else {
          const h = holes.find((x) => x.bound === ion.at)
          if (h) h.bound = -1
        }
      }
      ion.grown += ((ion.ionized ? 1 : 0) - ion.grown) * clamp01(dt * 4)
      ion.sign.visible = ion.grown > 0.02
      ion.sign.scale.setScalar(Math.max(0.001, ion.grown))
    }

    const freeE = electrons.filter((e) => e.orbit < 0 && !e.fall).length
    const freeH = holes.filter((h) => h.bound < 0 && !electrons.some((e) => e.fall === h)).length
    const donorsOut = ions.filter((i) => i.kind === 'donor' && i.ionized).length
    const acceptorsOut = ions.filter((i) => i.kind === 'acceptor' && i.ionized).length
    const wantE = Math.min(MAX - 4, donorsOut + pairs)
    const wantH = Math.min(MAX - 4, acceptorsOut + pairs)
    state.gen -= dt
    if (state.gen <= 0 && freeE < wantE && freeH < wantH) {
      const busy = taken()
      const open = slots.map((_, s) => s).filter((s) => !busy.has(s))
      if (open.length) {
        const s = open[Math.floor(Math.random() * open.length)]
        holes.push({ slot: s, from: s, t: 1, wait: rand(0.3, 0.8), bound: -1, tracked: false })
        electrons.push({ p: slots[s].clone().setZ(FREE_Z), v: thermalV().multiplyScalar(thermal * 1.5), orbit: -1, phase: 0, fall: null })
        burst(slots[s], RING)
        state.gen = 0.12
      }
    }
    if (state.gen <= 0 && freeE > wantE && freeH > wantH) {
      const h = holes.find((x) => x.bound < 0 && !x.tracked && !electrons.some((e) => e.fall === x))
      const e = h && electrons.filter((x) => x.orbit < 0 && !x.fall).sort((a, b) => a.p.distanceTo(slots[h.slot]) - b.p.distanceTo(slots[h.slot]))[0]
      if (h && e) e.fall = h
      state.gen = 0.12
    }
    if (track && !holes.some((h) => h.tracked)) {
      const h = holes.filter((x) => x.bound < 0).sort((a, b) => Math.abs(slots[a.slot].x) - Math.abs(slots[b.slot].x))[0]
      if (h) h.tracked = true
    }

    const busy = taken()
    for (const h of holes) {
      if (h.t < 1) {
        h.t = Math.min(1, h.t + dt / HOP_S)
        if (h.t >= 1) busy.delete(h.from)
        continue
      }
      if (h.bound >= 0 || electrons.some((e) => e.fall === h)) continue
      const v = driftAt(slots[h.slot].x) * holeRatio
      const rate = Math.max(1.6 * Math.sqrt(kelvin / 300), (Math.abs(v) / (pitch * 0.5)) * 1.3)
      h.wait -= dt
      if (h.wait > 0) continue
      h.wait = rand(0.6, 1.4) / rate
      const options = neighbours[h.slot].filter((o) => !busy.has(o))
      if (!options.length) continue
      const bias = clamp01(Math.abs(v) / (pitch * 0.5 * rate))
      const here = slots[h.slot]
      const next =
        Math.random() < bias
          ? options.reduce((best, o) => (Math.sign(v) * dxWrap(here, slots[o]) > Math.sign(v) * dxWrap(here, slots[best]) ? o : best))
          : options[Math.floor(Math.random() * options.length)]
      const dx = dxWrap(here, slots[next])
      if (here.x < 0 !== here.x + dx < 0 && Math.abs(here.x) < width / 4) net.holes += Math.sign(dx)
      busy.delete(h.slot)
      busy.add(next)
      h.from = h.slot
      h.slot = next
      h.t = 0
      if (Math.abs(slots[next].x - here.x) > width / 2) h.t = 1
    }

    for (let i = electrons.length - 1; i >= 0; i--) {
      const e = electrons[i]
      if (e.orbit >= 0) {
        e.phase += dt * 4
        const at = sites[e.orbit]
        e.p.set(at.x + 1.35 * Math.cos(e.phase), at.y + 1.35 * Math.sin(e.phase), FREE_Z * 0.6)
        continue
      }
      if (e.fall) {
        const target = holeAt(e.fall, tmp).setZ(0)
        e.v.subVectors(target, e.p).setLength(Math.max(4, thermal * 2))
        if (e.p.distanceTo(target) < 0.35) {
          burst(target, RING)
          holes.splice(holes.indexOf(e.fall), 1)
          electrons.splice(i, 1)
          continue
        }
        if (Math.abs(target.x - e.p.x) > width / 2) e.p.x = target.x
        e.p.addScaledVector(e.v, dt)
        continue
      }
      if (Math.random() < dt * 3) e.v.copy(thermalV()).multiplyScalar(thermal)
      const before = e.p.x
      e.p.x += (e.v.x - driftAt(e.p.x)) * dt
      e.p.y += e.v.y * dt
      e.p.z += (FREE_Z - e.p.z) * clamp01(dt * 4)
      if (Math.sign(before) !== Math.sign(e.p.x) && Math.abs(e.p.x) < 1) net.electrons += before > 0 ? 1 : -1
      if (e.p.x < -width / 2) e.p.x += width
      if (e.p.x > width / 2) e.p.x -= width
      const top = height / 2 - 0.4
      if (Math.abs(e.p.y) > top) {
        e.p.y = Math.sign(e.p.y) * top
        e.v.y = -e.v.y
      }
    }

    const hopping = new Map<number, Hole>()
    for (const h of holes) if (h.t < 1) hopping.set(h.from, h)
    const hidden = new Set(holes.map((h) => h.slot))
    let k = 0
    const dot = (at: THREE.Vector3, color: THREE.Color) => {
      dots.setMatrixAt(k, m.makeTranslation(at))
      dots.setColorAt(k++, color)
    }
    const slotDot = (s: number, shift: number) => {
      const h = hopping.get(s)
      if (h) {
        const a = slots[h.slot]
        const t = h.t * h.t * (3 - 2 * h.t)
        tmp.set(a.x + dxWrap(a, slots[s]) * t + shift, a.y + (slots[s].y - a.y) * t, 0)
        dot(tmp, h.tracked ? yellow : blue)
      } else if (hidden.has(s)) dots.setMatrixAt(k++, HIDDEN)
      else dot(tmp.copy(slots[s]).setX(slots[s].x + shift), blue)
    }
    slots.forEach((_, s) => slotDot(s, 0))
    wraps.forEach((s) => slotDot(s, 0.2 * pitch - width))
    stubDots.forEach((at) => dot(at, blue))
    dots.instanceMatrix.needsUpdate = true
    dots.instanceColor!.needsUpdate = true

    holes.forEach((h, i) => {
      rings.setMatrixAt(i, m.makeTranslation(holeAt(h, tmp)))
      rings.setColorAt(i, h.tracked ? yellow : red)
    })
    rings.count = holes.length
    rings.instanceMatrix.needsUpdate = true
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true
    electrons.forEach((e, i) => free.setMatrixAt(i, m.makeTranslation(e.p)))
    free.count = electrons.length
    free.instanceMatrix.needsUpdate = true

    for (let i = flash.length - 1; i >= 0; i--) if ((flash[i].t += dt) > 0.6) flash.splice(i, 1)
    for (let i = 0; i < FLASHES; i++) {
      const f = flash[i]
      if (!f) {
        flashes.setMatrixAt(i, HIDDEN)
        continue
      }
      const u = f.t / 0.6
      flashes.setMatrixAt(i, m.compose(f.at, q.identity(), s3.setScalar(0.4 + 1.4 * u)))
      flashes.setColorAt(i, c.copy(f.color).multiplyScalar(0.9 * (1 - u) ** 2))
    }
    flashes.instanceMatrix.needsUpdate = true
    flashes.instanceColor!.needsUpdate = true

    const amp = 0.05 * (kelvin / 300)
    sites.forEach((at, i) => {
      const w = state.time * 9 + i * 1.7
      atoms.setMatrixAt(i, m.makeTranslation(p.set(at.x + amp * Math.sin(w), at.y + amp * Math.sin(w * 1.3 + 2), 0)))
    })
    atoms.instanceMatrix.needsUpdate = true
  }

  flashes.setColorAt(0, c.set('#000000'))
  step(0)
  return {
    group,
    width,
    height,
    sites,
    step,
    /** Carriers across x = 0 so far, counted along the current (+x): electrons going −x, holes going +x. */
    net,
    count: () => ({ electrons: electrons.filter((e) => e.orbit < 0).length, holes: holes.filter((h) => h.bound < 0).length }),
    /** Where the highlighted hole is (with `track`), or null. */
    tracked: (out: THREE.Vector3) => {
      const h = holes.find((x) => x.tracked)
      return h ? holeAt(h, out) : null
    },
  }
}
