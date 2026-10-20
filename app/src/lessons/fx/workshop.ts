// Workshop close-ups: a cut-away through-hole joint on the bench (mm × k), soldering iron, solder wire + spool, brass-wool
// tip cleaner, solder pump and braid, and a tip / joint temperature plot. The cut faces the camera (z = 0), the rest is behind.
import * as THREE from 'three/webgpu'
import { BARREL_MM3, BENCH_C, IDEAL_MM3, JOINT, SolderFrame, TIPS, TipKey, contactAngle, filletProfile } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { GREY, HEAT, LABEL, RING, ironbow } from './colors'
import { boxScope } from './rigs'
import { addLabel } from './text'
import { clamp01, lerp } from './util'

/** Slightly-from-above camera on the bench; the header, gauges and plot stay readable on the z ≈ 0 plane. */
export const BENCH_VIEW = { center: [-2.4, -0.8, 0] as V3, radius: 50, polar: 1.38, azimuth: 0 }
/** Close-up scale (scene units per mm) and the joint origin: hole axis, board top. */
export const BENCH_K = 2.4
export const BENCH_AT: V3 = [-7, -2.4, 0]

const FR4 = '#c8b878'
const MASK = '#2f6b3a'
const COPPER_C = '#c8803f'
const SHINY = new THREE.Color('#dfe3e8')
const GRAINY = new THREE.Color('#7f8288')
const FLUX_C = new THREE.Color('#e0a43a')
const CHAR_C = new THREE.Color('#2a1a10')

/** Half solid of revolution about +y on the far side of the cut (z ≤ 0), from [r, y] points. */
function halfLathe(parent: THREE.Object3D, profile: [number, number][], material: THREE.Material, at: V3 = [0, 0, 0], segs = 18) {
  return add(parent, mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs, Math.PI / 2, Math.PI), material), at)
}
/** Flat cut face at z = 0 for a region bounded by [x, y] points. */
function cutFace(parent: THREE.Object3D, pts: [number, number][], material: THREE.Material) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  const m = add(parent, mesh(new THREE.ShapeGeometry(shape), material), [0, 0, 0.002])
  m.castShadow = false
  return m
}
/** Fillet section (right half): the pad from r_l out, back along h(r) to the lead. */
const filletCut = (points: [number, number][]): [number, number][] => [[points[0][0], 0], ...points.slice().reverse()]

export interface JointLook {
  /** Barrel filled from the top, 0…1. */
  barrel: number
  /** Fillet [r, h] mm from the lead out (filletProfile points); empty = none. */
  fillet: [number, number][]
  /** Unwetted solder balled on the lead, mm³. */
  ball?: number
  /** Wetted share: shiny vs grainy. */
  wet: number
  /** Flux left (0…1+) and how burnt it is (0…1). */
  flux: number
  char: number
  /** Joint temperature °C → thermal tint. */
  jointC: number
  /** Pad lift 0…1. */
  lift: number
}

/** Cut-away through-hole joint, board top at `at`, solder side up: FR4 with mask, plated barrel, pads, lead through it,
 *  solder in the barrel and a fillet; flux puddle; `set(JointLook)`. `point(r, y)` = scene point at radius r mm (−x side), y mm. */
export function jointSection(parent: THREE.Object3D, at: V3 = BENCH_AT, k = BENCH_K, halfW = 4, depth = 3) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(k)
  const J = JOINT
  const hr = J.holeMm / 2
  const lr = J.leadMm / 2
  const pr = J.padMm / 2
  const t = J.boardMm
  const fr4 = mat(FR4, { rough: 0.8 })
  const mask = mat(MASK, { rough: 0.5 })
  for (const s of [-1, 1]) {
    const w = halfW - hr
    box(g, [w, t, depth], fr4, [s * (hr + w / 2), -t / 2, -depth / 2])
    box(g, [w - (pr - hr), 0.04, depth], mask, [s * (pr + (w - (pr - hr)) / 2), 0.02, -depth / 2])
    box(g, [w - (pr - hr), 0.04, depth], mask, [s * (pr + (w - (pr - hr)) / 2), -t - 0.02, -depth / 2])
  }
  box(g, [2 * hr, t, depth - hr], fr4, [0, -t / 2, -(depth + hr) / 2])
  const hot = add(g, new THREE.Group())
  const copper = mat(COPPER_C, { metal: 0.35, rough: 0.4 }, true)
  copper.side = THREE.DoubleSide
  const pad = add(hot, new THREE.Group())
  halfLathe(pad, [[hr, 0], [pr, 0], [pr, 0.05], [hr, 0.05]], copper)
  halfLathe(hot, [[hr, -t - 0.05], [pr, -t - 0.05], [pr, -t], [hr, -t]], copper)
  halfLathe(hot, [[hr - 0.03, 0], [hr, 0], [hr, -t], [hr - 0.03, -t]], copper)
  const tin = mat('#c9ccd2', { metal: 0.45, rough: 0.35 }, true)
  tin.side = THREE.DoubleSide
  const top = J.stubMm
  const bottom = -t - 2.5
  add(hot, mesh(new THREE.CylinderGeometry(lr, lr, top - bottom, 16, 1, false, Math.PI / 2, Math.PI), tin), [0, (top + bottom) / 2, 0])
  cutFace(hot, [[-lr, bottom], [lr, bottom], [lr, top], [-lr, top]], tin)
  const solder = mat('#dfe3e8', { metal: 0.5, rough: 0.25 }, true)
  solder.side = THREE.DoubleSide
  const barrel = add(hot, new THREE.Group())
  halfLathe(barrel, [[lr, 0], [hr - 0.03, 0], [hr - 0.03, -1], [lr, -1]], solder)
  cutFace(barrel, [[lr, 0], [hr - 0.03, 0], [hr - 0.03, -1], [lr, -1]], solder)
  cutFace(barrel, [[-hr + 0.03, 0], [-lr, 0], [-lr, -1], [-hr + 0.03, -1]], solder)
  const fillet = add(hot, new THREE.Group())
  const ball = add(hot, new THREE.Group())
  add(ball, mesh(new THREE.SphereGeometry(1, 20, 14, Math.PI, Math.PI), solder))
  add(ball, mesh(new THREE.CircleGeometry(1, 24), solder), [0, 0, 0.002]).castShadow = false
  const fluxMat = new THREE.MeshStandardMaterial({ color: FLUX_C, transparent: true, opacity: 0.5, roughness: 0.2, depthWrite: false })
  const puddle = add(g, mesh(new THREE.CircleGeometry(1, 32, Math.PI, Math.PI), fluxMat), [0, 0.07, 0])
  puddle.rotation.x = -Math.PI / 2
  puddle.castShadow = false
  const mats = [copper, tin, solder]
  const tint = new THREE.Color()
  let shape = ''
  return {
    group: g,
    point: (r: number, y: number): V3 => [at[0] - r * k, at[1] + y * k, at[2]],
    set(o: JointLook) {
      barrel.scale.y = Math.max(0.001, clamp01(o.barrel) * t)
      barrel.visible = o.barrel > 0.01
      const key = o.fillet.map(([r, h]) => `${r.toFixed(2)},${h.toFixed(2)}`).join(';')
      if (key !== shape) {
        shape = key
        for (const c of [...fillet.children]) {
          fillet.remove(c)
          ;(c as THREE.Mesh).geometry.dispose()
        }
        const H = o.fillet.length ? Math.max(...o.fillet.map((p) => p[1])) : 0
        if (H > 0.005) {
          const prof = o.fillet.slice().reverse()
          halfLathe(fillet, [[prof[0][0], 0], ...prof, [lr, 0]].map(([r, h]) => [r, Math.min(h, top + 0.4)] as [number, number]), solder, [0, 0.05, 0])
          const cut = filletCut(o.fillet.map(([r, h]) => [r, Math.min(h, top + 0.4) + 0.05]))
          cutFace(fillet, cut, solder)
          cutFace(fillet, cut.map(([x, y]) => [-x, y] as [number, number]).reverse(), solder)
        }
      }
      const br = Math.cbrt((3 * (o.ball ?? 0)) / (4 * Math.PI))
      ball.visible = br > 0.05
      ball.scale.setScalar(Math.max(0.01, br))
      ball.position.y = Math.min(top, 0.25 + br)
      solder.color.copy(GRAINY).lerp(SHINY, clamp01(o.wet))
      solder.roughness = lerp(0.9, 0.25, o.wet)
      const f = clamp01((o.jointC - BENCH_C) / 400)
      ironbow(0.45 + 0.55 * f, tint)
      for (const m of mats) {
        m.emissive.copy(tint)
        m.emissiveIntensity = f * f * 0.35
      }
      const R = Math.max(pr + 0.25, ...o.fillet.map((p) => p[0] + 0.2))
      puddle.scale.setScalar(R)
      puddle.visible = o.flux > 0.02 || o.char > 0.05
      fluxMat.color.copy(FLUX_C).lerp(CHAR_C, clamp01(o.char))
      fluxMat.opacity = 0.25 + 0.45 * Math.max(clamp01(o.flux), clamp01(o.char))
      pad.rotation.z = -0.25 * clamp01(o.lift)
      pad.position.y = 0.15 * clamp01(o.lift)
    },
  }
}

/** Labels pointing at the section's parts: pad, lead, barrel, FR4. */
export function sectionLabels(parent: THREE.Object3D, at: V3 = BENCH_AT, k = BENCH_K) {
  const x = at[0] + 4.3 * k
  addLabel(parent, 'FR4 board', [x, at[1] - 0.8 * k, 0.3], GREY, 0.28, 'right')
  addLabel(parent, 'lead', [at[0] + 0.5 * k, at[1] + 1.9 * k, 0.3], GREY, 0.26, 'left')
  addLabel(parent, 'barrel', [at[0] + 0.7 * k, at[1] - 1.9 * k, 0.3], GREY, 0.26, 'left')
}

/** Soldering iron, origin at the working end, handle up `angle` rad from vertical towards −x: tip by kind and width,
 *  steel sleeve, grip. `set(tipC, oxide)` tints the tip; `place(at)` moves the working end. */
export function solderingIron(parent: THREE.Object3D, tip: TipKey, k = BENCH_K, angle = 1.1) {
  const g = add(parent, new THREE.Group())
  const arm = add(g, new THREE.Group())
  arm.rotation.z = angle
  const tipMat = mat('#cfd3d8', { metal: 0.5, rough: 0.3 }, true)
  const w = TIPS[tip].mm * k
  const shaftR = Math.max(1.4, w / 2 + 0.3)
  const taper = 3.6
  const blade = add(arm, mesh(new THREE.CylinderGeometry(shaftR, w / 2, taper, 20), tipMat), [0, taper / 2, 0])
  if (tip !== 'conical') blade.scale.z = 0.35
  const len = taper
  cylinder(arm, shaftR, 2, tipMat, [0, len + 1, 0])
  cylinder(arm, 1.15, 6, mat('#b9bec6', { metal: 0.4, rough: 0.4 }), [0, len + 5, 0])
  cylinder(arm, 1.7, 5, mat('#2b5fa8', { rough: 0.7 }), [0, len + 10.5, 0])
  const c = new THREE.Color()
  return {
    group: g,
    set(tipC: number, oxide: number) {
      tipMat.color.set('#cfd3d8').lerp(new THREE.Color('#4a3a2c'), clamp01(oxide))
      tipMat.roughness = lerp(0.3, 0.85, oxide)
      const f = clamp01((tipC - BENCH_C) / 400)
      ironbow(0.45 + 0.55 * f, c)
      tipMat.emissive.copy(c)
      tipMat.emissiveIntensity = f * f * 0.4
    },
    place(at: V3) {
      g.position.set(...at)
    },
  }
}

/** 0.8 mm solder wire from a small spool at `spoolAt` down to the joint along `dir`; `set(end, shown)` moves its end. */
export function solderWire(parent: THREE.Object3D, spoolAt: V3, k = BENCH_K) {
  const g = add(parent, new THREE.Group())
  const reel = add(g, new THREE.Group(), spoolAt)
  cylinder(reel, 1.2, 0.2, mat('#3a3d44', { rough: 0.6 }), [0, 0, -0.6], 'z', 28)
  cylinder(reel, 1.2, 0.2, mat('#3a3d44', { rough: 0.6 }), [0, 0, 0.6], 'z', 28)
  cylinder(reel, 0.9, 1.1, mat('#c9ccd2', { metal: 0.45, rough: 0.35 }), [0, 0, 0], 'z', 28)
  cylinder(reel, 0.25, 1.4, mat('#1c1c1f'), [0, 0, 0], 'z', 12)
  const r = (JOINT.wireMm / 2) * k
  const wire = add(g, mesh(new THREE.CylinderGeometry(r, r, 1, 10).translate(0, 0.5, 0), mat('#c9ccd2', { metal: 0.45, rough: 0.35 })))
  const from = new THREE.Vector3(spoolAt[0] - 0.9, spoolAt[1] - 0.4, spoolAt[2])
  const v = new THREE.Vector3()
  return {
    group: g,
    set(end: V3, shown = true) {
      wire.visible = shown
      v.set(...end).sub(from)
      wire.position.copy(from)
      wire.scale.set(1, v.length(), 1)
      wire.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize())
    },
  }
}

/** Brass-wool tip cleaner in a cup at `at`. */
export function tipCleaner(parent: THREE.Object3D, at: V3) {
  const g = add(parent, new THREE.Group(), at)
  cylinder(g, 1.7, 1.2, mat('#3a3d44', { rough: 0.6 }), [0, 0, 0])
  const brass = mat('#c9a24a', { metal: 0.6, rough: 0.45 })
  for (let i = 0; i < 9; i++) {
    const ring = add(g, mesh(new THREE.TorusGeometry(0.9, 0.05, 6, 24), brass), [Math.sin(i * 2.1) * 0.4, 0.8 + (i % 3) * 0.15, Math.cos(i * 1.7) * 0.4])
    ring.rotation.set(i * 0.7, i * 1.3, i * 0.4)
  }
  addLabel(g, 'brass wool', [0, -1.1, 1.8], GREY, 0.26)
  return g
}

/** Spring solder pump scaled by `k`, nozzle (PTFE) at the origin, body up `angle` towards +x; `set(cocked)` pulls the plunger. */
export function solderPump(parent: THREE.Object3D, angle = -1.15, k = 0.5) {
  const g = add(parent, new THREE.Group())
  g.scale.setScalar(k)
  const arm = add(g, new THREE.Group())
  arm.rotation.z = angle
  add(arm, mesh(new THREE.CylinderGeometry(1.1, 0.5, 2.6, 20), mat('#f2f2ee', { rough: 0.5 })), [0, 1.3, 0])
  cylinder(arm, 1.4, 11, mat('#3b7bd1', { metal: 0.35, rough: 0.35 }), [0, 8.1, 0])
  const rod = add(arm, new THREE.Group(), [0, 13.6, 0])
  cylinder(rod, 0.35, 4, mat('#b9bec6', { metal: 0.4, rough: 0.4 }), [0, 2, 0])
  cylinder(rod, 1.2, 0.8, mat('#1c1c1f'), [0, 4.2, 0])
  return {
    group: g,
    set(cocked: boolean) {
      rod.position.y = cocked ? 13.6 : 11.2
    },
    place(at: V3) {
      g.position.set(...at)
    },
  }
}

/** Copper desoldering braid from `at` (its end on the joint) off towards −x, `w` deep; `set(fill)` turns it silver from the end. */
export function solderBraid(parent: THREE.Object3D, at: V3, w: number, len = 9) {
  const g = add(parent, new THREE.Group(), at)
  const cu = mat(COPPER_C, { metal: 0.35, rough: 0.55 })
  box(g, [len, 0.35, w], cu, [-len / 2 + 1, 0, -w / 2])
  const weave = mat('#9c5f2c', { rough: 0.7 })
  for (let x = 1; x > 1 - len; x -= 0.6) box(g, [0.08, 0.37, w], weave, [x, 0, -w / 2]).rotation.y = 0.6
  const tin = add(g, mesh(new THREE.BoxGeometry(1, 0.4, w).translate(-0.5, 0, 0), mat('#d4d7dc', { metal: 0.45, rough: 0.35 })), [1, 0, -w / 2])
  return {
    group: g,
    set(fill: number) {
      const f = clamp01(fill)
      tin.visible = f > 0.01
      tin.scale.x = Math.max(0.01, f * 4)
    },
  }
}

/** Tip / joint / barrel °C against time (0…run length) in the right column's top box, with the alloy's liquidus and wetting lines. */
export function jointPlot(scene: THREE.Object3D, maxC = 450) {
  const P = { x: 8, y: 1.9, w: 7.6, h: 3.2 }
  const { s, tag } = boxScope(scene, P, '°C vs time', [8, 3], { axis: [`${maxC}`, `${BENCH_C}`] })
  const tipT = s.trace(HEAT, { samples: 120, radius: 0.08 })
  const jointT = s.trace(RING, { samples: 120, radius: 0.08 })
  const barrelT = s.trace(LABEL, { samples: 120, radius: 0.05 })
  const melt = s.level('#5ce1a0')
  const wetL = s.level('#5ad8e6', 0.3)
  const y = (c: number) => ((c - BENCH_C) / (maxC - BENCH_C)) * P.h - P.h / 2
  return {
    tag,
    /** Frames every `dt`, total `seconds`, drawn up to `now`; lines at `meltC` and `wetC`. */
    set<F extends { tipC: number; jointC: number; barrelC: number }>(frames: readonly F[], dt: number, seconds: number, now: number, meltC: number, wetC: number) {
      const k = Math.min(frames.length, Math.max(2, Math.floor(now / dt) + 1))
      const step = Math.max(1, Math.ceil(k / 120))
      const us: number[] = []
      const ts: number[] = []
      const js: number[] = []
      const bs: number[] = []
      for (let i = 0; i < k; i += step) {
        us.push((i * dt) / seconds)
        ts.push(y(frames[i].tipC))
        js.push(y(frames[i].jointC))
        bs.push(y(frames[i].barrelC))
      }
      tipT.points(us, ts)
      jointT.points(us, js)
      barrelT.points(us, bs)
      melt.set(y(meltC))
      wetL.set(y(wetC))
    },
  }
}

/** The three tips' irons, one shown at a time: `show(tip)`, `set(tipC, oxide)`, `place(at)`. */
export function ironSet(parent: THREE.Object3D, k = BENCH_K, angle = 1.1) {
  const irons = (Object.keys(TIPS) as TipKey[]).map((t) => [t, solderingIron(parent, t, k, angle)] as const)
  let shown: TipKey = 'chisel'
  const pick = () => irons.find(([t]) => t === shown)![1]
  return {
    show(tip: TipKey) {
      shown = tip
      for (const [t, i] of irons) i.group.visible = t === tip
    },
    set: (tipC: number, oxide: number) => pick().set(tipC, oxide),
    place: (at: V3) => irons.forEach(([, i]) => i.place(at)),
  }
}

/** JointLook of a soldering frame: barrel filled by the wetted solder, the rest a fillet (a ball while under 30 % wetted), char from charring time. */
export function solderLook(f: SolderFrame): JointLook {
  const barrel = Math.min(1, f.volMm3 / BARREL_MM3) * f.barrelWet
  const filletMm3 = Math.max(0, f.volMm3 - barrel * BARREL_MM3)
  const balled = f.wet < 0.3
  const prof = filletProfile(filletMm3, contactAngle(f.wet), f.wet, f.volMm3 / IDEAL_MM3)
  return { barrel, fillet: filletMm3 > 0.005 && !balled ? prof.points : [], ball: balled ? filletMm3 : 0, wet: f.wet, flux: f.flux, char: clamp01(f.charS / 1.5), jointC: f.jointC, lift: clamp01((f.dose - 0.9) / 0.3) }
}

/** Contact points in scene units: where the iron (left) and the wire or pump (right) touch, `lift` = units up. */
export function benchPoints(at: V3 = BENCH_AT, k = BENCH_K) {
  const r = (JOINT.leadMm / 2 + 0.35) * k
  return {
    iron: (lift = 0): V3 => [at[0] - r - lift * 0.89, at[1] + 0.35 * k + lift * 0.45, 0.4],
    wire: (back = 0): V3 => [at[0] + r + back * 0.7, at[1] + 0.3 * k + back * 0.7, 0.4],
  }
}

/** Soldering bench: joint section + labels, iron (per tip), wire from a spool, brass wool, temperature plot.
 *  `pose(dt, on, feeding, wire)` glides the iron onto / off the joint and the wire in / out. */
export function solderRig(scene: THREE.Object3D) {
  const joint = jointSection(scene)
  sectionLabels(scene)
  const irons = ironSet(scene)
  const wire = solderWire(scene, [-0.5, 3.4, -1])
  tipCleaner(scene, [0.5, -9.2, 0])
  const plot = jointPlot(scene)
  const pts = benchPoints()
  const st = { lift: 3, back: 3 }
  return {
    joint,
    irons,
    wire,
    plot,
    pts,
    pose(dt: number, on: boolean, feeding: boolean, wireShown = true) {
      st.lift += ((on ? 0 : 3) - st.lift) * Math.min(1, dt * 10)
      st.back += ((feeding ? 0 : 3) - st.back) * Math.min(1, dt * 10)
      irons.place(pts.iron(st.lift))
      wire.set(pts.wire(st.back), wireShown)
    },
  }
}
