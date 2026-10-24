// A silicon crystal drawn flat: atoms, two shared electrons per bond, dopants, free electrons and hopping holes.
import * as THREE from 'three/webgpu'
import { add, box, mesh } from '../../models/kit'
import { ELECTRON, HIGH_V, HOLE, LOW_V, RING, glowMat } from './colors'
import { partLetter } from './parts'
import { plusGeometry } from './shapes'
import { UP, clamp01, rand, rand01 } from './util'

const SILICON = '#9aa3ad'
export const DONOR = '#4cd07d'
export const ACCEPTOR = '#ff6fb0'
export type Dopant = 'donor' | 'acceptor'

const MAX = 64
const FLASHES = 12
const HOP_S = 0.24
const FREE_Z = 1.1
const SWEEP = 6
const MAJOR = 0
const CROSSING = 1
const MINOR = 2
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

interface Hole {
  slot: number
  from: number
  t: number
  wait: number
  bound: number
  tracked: boolean
  cross: number
  life: number
  leaving: boolean
}

interface Electron {
  p: THREE.Vector3
  v: THREE.Vector3
  orbit: number
  phase: number
  fall: Hole | null
  cross: number
  life: number
  leaving: boolean
}

/** A PN junction (p side at lower x): free electrons stay right of the depletion zone and holes left of it. */
export interface Junction {
  from: number
  to: number
  /** Carriers of each kind pushed across per second (forward bias); they recombine on the far side. */
  inject?: number
  /** Pairs per second torn free inside the zone (breakdown); the field sweeps them out. */
  generate?: number
  /** Ends wired to a battery: they refill carriers and take the excess away. Else excess carriers recombine in pairs at
   *  the junction. */
  contacts?: boolean
}

export interface CrystalStep {
  kelvin?: number
  /** Thermal electron–hole pairs to keep. */
  pairs?: number
  /** Electron drift in scene units/s toward −x (current flows +x); a function of x for non-uniform fields. */
  drift?: number | ((x: number) => number)
  /** Hole drift speed as a fraction of the electron's (μp / μn). */
  holeRatio?: number
  junction?: Junction
}

/** Atoms on a `cols` × `rows` grid of `pitch`, centred on the origin, facing +z; wraps around in x so carriers can flow
 *  through (with `wrap`; else the ends stop them). `dopants` maps a site (row × cols + col, row 0 at the bottom) to a donor (5th electron that escapes, leaving +)
 *  or an acceptor (a bond one short: a hole that wanders off, leaving −). Dopants ionize one by one after `ionizeAfter` s. */
export function siliconCrystal(
  parent: THREE.Object3D,
  { cols = 9, rows = 5, pitch = 3.2, dopants = new Map<number, Dopant>(), ionizeAfter = 0.8, track = false, wrap = true } = {},
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
    const around = sites[b].x < sites[a].x
    const end = around ? sites[a].clone().setX(sites[a].x + pitch) : sites[b]
    const mid = sites[a].clone().lerp(end, 0.5)
    if (around) mid.x -= pitch * 0.1
    const side = new THREE.Vector3(-(end.y - sites[a].y), end.x - sites[a].x, 0).setLength(off)
    slots.push(mid.clone().add(side), mid.clone().sub(side))
    if (around) wraps.push(2 * k, 2 * k + 1)
  })
  const touching = (k: number, atom: number) => bonds[k][0] === atom || bonds[k][1] === atom
  const bondOf = (s: number) => Math.floor(s / 2)
  const neighbours = slots.map((_, s) => {
    const [a, b] = bonds[bondOf(s)]
    const near = (o: number) => wrap || Math.abs(slots[o].x - slots[s].x) < width / 2
    return slots.flatMap((__, o) => (bondOf(o) !== bondOf(s) && (touching(bondOf(o), a) || touching(bondOf(o), b)) && near(o) ? [o] : []))
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
  const electron = (at: THREE.Vector3, v: THREE.Vector3, orbit = -1, phase = 0): Electron =>
    ({ p: at, v, orbit, phase, fall: null, cross: MAJOR, life: 0, leaving: false })
  const hole = (slot: number, bound = -1): Hole =>
    ({ slot, from: slot, t: 1, wait: rand(0.3, 0.8), bound, tracked: false, cross: MAJOR, life: 0, leaving: false })
  const targeted = (h: Hole) => electrons.some((e) => e.fall === h)
  const freeElectrons = () => electrons.filter((e) => e.orbit < 0 && !e.fall)
  const freeHoles = () => holes.filter((h) => h.bound < 0 && !targeted(h))

  for (const ion of ions) {
    if (ion.kind === 'donor') electrons.push(electron(sites[ion.at].clone(), new THREE.Vector3(), ion.at, rand(0, 6.3)))
    else holes.push(hole(2 * bonds.findIndex(([a]) => a === ion.at), ion.at))
  }

  const burst = (at: THREE.Vector3, color: string) => {
    if (flash.length >= FLASHES) flash.shift()
    flash.push({ at: at.clone().setZ(FREE_Z), t: 0, color: new THREE.Color(color) })
  }

  const net = { electrons: 0, holes: 0 }
  const state = { gen: 0, time: 0, injE: 0, injH: 0, born: 0 }
  const edge = width / 2 - 0.4
  const leftEdge = -width / 2 + pitch * 0.9
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

  const nearest = <T>(list: T[], key: (t: T) => number) =>
    list.reduce<T | undefined>((best, t) => (best === undefined || key(t) < key(best) ? t : best), undefined)
  const openSlot = (where: (x: number) => boolean) => {
    const busy = taken()
    const open = slots.map((_, s) => s).filter((s) => where(slots[s].x) && !busy.has(s))
    return open.length ? open[Math.floor(rand01() * open.length)] : -1
  }
  const pairAt = (s: number, thermal: number) => {
    holes.push(hole(s))
    electrons.push(electron(slots[s].clone().setZ(FREE_Z), thermalV().multiplyScalar(thermal * 1.5)))
    burst(slots[s], RING)
    state.gen = 0.12
  }

  const exchange = (dt: number, pairs: number, thermal: number) => {
    const freeE = freeElectrons().length
    const freeH = freeHoles().length
    const wantE = Math.min(MAX - 4, ions.filter((i) => i.kind === 'donor' && i.ionized).length + pairs)
    const wantH = Math.min(MAX - 4, ions.filter((i) => i.kind === 'acceptor' && i.ionized).length + pairs)
    state.gen -= dt
    if (state.gen <= 0 && freeE < wantE && freeH < wantH) {
      const s = openSlot(() => true)
      if (s >= 0) pairAt(s, thermal)
    }
    if (state.gen <= 0 && freeE > wantE && freeH > wantH) {
      const h = holes.find((x) => x.bound < 0 && !x.tracked && !targeted(x))
      const e = h && nearest(freeElectrons(), (x) => x.p.distanceTo(slots[h.slot]))
      if (h && e) e.fall = h
      state.gen = 0.12
    }
  }

  /** Keeps each side neutral outside the zone, pushes carriers across, tears pairs free and ends minority lifetimes. */
  const balance = (j: Junction, dt: number, thermal: number) => {
    const inZone = (x: number) => x > j.from && x < j.to
    const want = (kind: Dopant) => Math.min(MAX - 4, ions.filter((i) => i.kind === kind && i.ionized && !inZone(sites[i.at].x)).length)
    const es = freeElectrons()
    const hs = freeHoles()
    const majorE = es.filter((e) => e.cross === MAJOR && !e.leaving && e.p.x >= j.to)
    const majorH = hs.filter((h) => h.cross === MAJOR && !h.leaving && h.t >= 1 && slots[h.slot].x <= j.from)
    const extraE = es.filter((e) => !e.leaving).length - want('donor')
    const extraH = hs.filter((h) => !h.leaving).length - want('acceptor')
    state.gen -= dt
    if (state.gen <= 0) {
      state.gen = 0.12
      if (!j.contacts) {
        if (extraE > 0 || extraH > 0) {
          const mid = (j.from + j.to) / 2
          const h = nearest(majorH.filter((x) => !x.tracked), (x) => Math.abs(slots[x.slot].x - mid))
          const e = h && nearest(majorE, (x) => x.p.distanceTo(slots[h.slot]))
          if (h && e) e.fall = h
        }
      } else {
        if (extraE > 0) {
          const e = nearest(majorE, (x) => -x.p.x)
          if (e) e.leaving = true
        } else if (es.length < want('donor')) electrons.push(electron(new THREE.Vector3(edge, rand(-height / 2 + 0.6, height / 2 - 0.6), FREE_Z), new THREE.Vector3(-thermal, 0, 0)))
        if (extraH > 0) {
          const h = nearest(majorH, (x) => slots[x.slot].x)
          if (h) h.leaving = true
        } else if (hs.length < want('acceptor')) {
          const s = openSlot((x) => x < leftEdge)
          if (s >= 0) holes.push(hole(s))
        }
      }
    }

    state.injE = Math.min(1.5, state.injE + (j.inject ?? 0) * dt)
    state.injH = Math.min(1.5, state.injH + (j.inject ?? 0) * dt)
    const e = state.injE >= 1 && nearest(majorE, (x) => x.p.x)
    if (e) {
      e.cross = CROSSING
      state.injE -= 1
    }
    const h = state.injH >= 1 && nearest(majorH, (x) => -slots[x.slot].x)
    if (h) {
      h.cross = CROSSING
      h.wait = 0
      state.injH -= 1
    }
    state.born = Math.min(2, state.born + (j.generate ?? 0) * dt)
    if (state.born >= 1) {
      state.born -= 1
      const s = openSlot(inZone)
      if (s >= 0) pairAt(s, thermal)
    }

    for (const x of es)
      if (x.cross === MINOR && (x.life -= dt) <= 0) {
        const target = nearest(freeHoles().filter((o) => o.cross === MAJOR && !o.leaving), (o) => x.p.distanceTo(slots[o.slot]))
        if (target) x.fall = target
      }
    for (const x of hs)
      if (x.cross === MINOR && (x.life -= dt) <= 0 && !targeted(x)) {
        const by = nearest(freeElectrons().filter((o) => o.cross === MAJOR && !o.leaving), (o) => o.p.distanceTo(slots[x.slot]))
        if (by) by.fall = x
      }
  }

  const step = (dt: number, { kelvin = 300, pairs = 0, drift = 0, holeRatio = 480 / 1350, junction }: CrystalStep = {}) => {
    state.time += dt
    const driftAt = (x: number) => (typeof drift === 'number' ? drift : drift(x))
    const thermal = 2.6 * Math.sqrt(kelvin / 300)
    const inZone = (x: number) => !!junction && x > junction.from && x < junction.to

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
      const bare = junction ? (inZone(sites[ion.at].x) ? 1.35 : 0.65) : 1
      ion.grown += ((ion.ionized ? bare : 0) - ion.grown) * clamp01(dt * 4)
      ion.sign.visible = ion.grown > 0.02
      ion.sign.scale.setScalar(Math.max(0.001, ion.grown))
    }

    if (junction) balance(junction, dt, thermal)
    else exchange(dt, pairs, thermal)
    if (track && !holes.some((h) => h.tracked)) {
      const h = holes.filter((x) => x.bound < 0).sort((a, b) => Math.abs(slots[a.slot].x) - Math.abs(slots[b.slot].x))[0]
      if (h) h.tracked = true
    }

    const busy = taken()
    for (let i = holes.length - 1; i >= 0; i--) {
      const h = holes[i]
      if (h.t < 1) {
        h.t = Math.min(1, h.t + dt / HOP_S)
        if (h.t >= 1) busy.delete(h.from)
        continue
      }
      if (h.bound >= 0 || targeted(h)) continue
      const here = slots[h.slot]
      if (junction) {
        if (h.cross === CROSSING && here.x > junction.to + 0.3) {
          h.cross = MINOR
          h.life = rand(0.5, 1.2)
        } else if (h.cross === MINOR && here.x <= junction.from) h.cross = MAJOR
        if (h.leaving && here.x < leftEdge) {
          busy.delete(h.slot)
          holes.splice(i, 1)
          continue
        }
      }
      const forced = !junction ? 0 : h.cross === CROSSING ? 1 : h.leaving || inZone(here.x) ? -1 : 0
      const v = driftAt(here.x) * holeRatio
      const rate = forced ? 10 : Math.max(1.6 * Math.sqrt(kelvin / 300), (Math.abs(v) / (pitch * 0.5)) * 1.3)
      h.wait -= dt
      if (h.wait > 0) continue
      h.wait = rand(0.6, 1.4) / rate
      const allowed = (o: number) =>
        !junction || forced !== 0 || (h.cross === MINOR ? slots[o].x >= junction.to : slots[o].x <= junction.from)
      const options = neighbours[h.slot].filter((o) => !busy.has(o) && allowed(o) && forced * dxWrap(here, slots[o]) > -0.01)
      if (!options.length) continue
      const dir = forced || Math.sign(v)
      const bias = forced ? 1 : clamp01(Math.abs(v) / (pitch * 0.5 * rate))
      const next =
        rand01() < bias
          ? options.reduce((best, o) => (dir * dxWrap(here, slots[o]) > dir * dxWrap(here, slots[best]) ? o : best))
          : options[Math.floor(rand01() * options.length)]
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
      if (rand01() < dt * 3) e.v.copy(thermalV()).multiplyScalar(thermal)
      const before = e.p.x
      let vx = e.v.x - driftAt(e.p.x)
      if (junction) {
        if (e.cross === CROSSING) vx = -SWEEP
        else if (e.leaving) vx = SWEEP + Math.abs(e.v.x) * 0.5
        else if (inZone(e.p.x)) vx = SWEEP
      }
      e.p.x += vx * dt
      e.p.y += e.v.y * dt
      e.p.z += (FREE_Z - e.p.z) * clamp01(dt * 4)
      if (junction) {
        if (e.cross === CROSSING && e.p.x < junction.from - pitch * 0.5) {
          e.cross = MINOR
          e.life = rand(0.5, 1.2)
        } else if (e.cross === MAJOR && before >= junction.to && e.p.x < junction.to) {
          e.p.x = junction.to
          e.v.x = Math.abs(e.v.x)
        } else if (e.cross === MINOR && before <= junction.from && e.p.x > junction.from) {
          e.p.x = junction.from
          e.v.x = -Math.abs(e.v.x)
        } else if (e.cross === MINOR && e.p.x >= junction.to) e.cross = MAJOR
      }
      if (Math.sign(before) !== Math.sign(e.p.x) && Math.abs(e.p.x) < 1) net.electrons += before > 0 ? 1 : -1
      if (wrap) {
        if (e.p.x < -width / 2) e.p.x += width
        if (e.p.x > width / 2) e.p.x -= width
      } else {
        if (e.leaving && e.p.x > edge) {
          electrons.splice(i, 1)
          continue
        }
        if (Math.abs(e.p.x) > edge) {
          e.p.x = Math.sign(e.p.x) * edge
          e.v.x = -e.v.x
        }
      }
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

// --- PN junction helpers ---

/** P-side sites (col, row) on a 4-row crystal, spread so every column gets one early; the n side is the mirror image. */
const P_SPOTS: [number, number][] = [[3, 1], [1, 2], [2, 0], [0, 3], [3, 3], [1, 0], [2, 2], [0, 1], [3, 2], [1, 1]]

/** Acceptors on the left half, donors on the right, interleaved so both sides ionize together. */
export function junctionDopants(cols: number, p: number, nd: number, rows = 4) {
  const half = cols / 2
  const map = new Map<number, Dopant>()
  for (let i = 0; i < Math.max(p, nd); i++) {
    const [c, r] = P_SPOTS[i]
    const col = c + half - 4
    if (i < p && col >= 0) map.set(r * cols + col, 'acceptor')
    if (i < nd && col >= 0) map.set((rows - 1 - r) * cols + (cols - 1 - col), 'donor')
  }
  return map
}

/** Tinted backing behind each half and a pale slab marking the depletion zone; `zone(from, to)` moves it. */
export function junctionBacking(parent: THREE.Object3D, width: number, height: number) {
  const glass = (color: string, opacity: number) =>
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, transparent: true, opacity, roughness: 0.6, depthWrite: false })
  for (const [s, color] of [[-1, ACCEPTOR], [1, DONOR]] as const) box(parent, [width / 2, height, 0.2], glass(color, 0.16), [(s * width) / 4, 0, -1.4]).castShadow = false
  const slab = box(parent, [1, height + 0.6, 0.2], glass('#ffffff', 0.22), [0, 0, -1.2])
  slab.castShadow = false
  const letter = (text: string, x: number, color: string) => {
    partLetter(parent, text, [x, -height / 2 - 1.4, 0], 1.4, color)
  }
  letter('P', -width / 2 + 1, ACCEPTOR)
  letter('N', width / 2 - 1, DONOR)
  return (from: number, to: number) => {
    slab.visible = to - from > 0.05
    slab.scale.x = Math.max(0.01, to - from)
    slab.position.x = (from + to) / 2
  }
}

/** Zone edges in scene units: total width on a √ scale (`k` at 1 µm), split like xp : xn. */
export function zoneEdges(d: { w: number; xp: number }, k: number, half: number, min = 0.5) {
  const w = Math.max(min, k * Math.sqrt(d.w / 1e-6))
  const f = d.w > 0 ? d.xp / d.w : 0.5
  return { from: -Math.min(half - 1, w * f), to: Math.min(half - 1, w * (1 - f)) }
}
