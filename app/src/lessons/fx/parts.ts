// Real parts in lesson circuits: TO-92/TO-220 transistors, DIP-8 op-amp, SOT-223 regulator, HC-49 crystal, glass fuse.
import * as THREE from 'three/webgpu'
import { V3, add, box, cylinder, lead, mat, mesh, rod, STEEL } from '../../models/kit'
import { buildTo92, TO92, TO220, buildTo220 } from '../../models/passives'
import { glowHalo, icPackage } from './circuit'
import { CONVENTIONAL, LABEL, glowMat, potentialColor } from './colors'
import { heatGlow } from './heat'
import { LabelOpts, label } from './text'
import { clamp01 } from './util'

/** Static glowing text at `at` (centred unless `align`); `height` = cap height. */
export const partLetter = (parent: THREE.Object3D, text: string, at: V3, height: number, color = LABEL, align: LabelOpts['align'] = 'center') =>
  add(parent, label(text, { size: height, color, align }), at)

/** Lesson parts face the key light edge-on, so near-black epoxy reads as a hole; lift it to a glossy dark grey. */
export function litEpoxy(body: THREE.MeshStandardMaterial) {
  body.color.set('#4a4d57')
  body.roughness = 0.3
}

/** The TO-92 (`buildTo92`) at `scale`, laid on its side: legs pointing −x, ending at C = `at` + (0, scale), B = `at`,
 *  E = `at` − (0, scale), so the base faces its drive and C/E run up/down; lettered (`letters`, top first) right of the body. `set(f, heat)`:
 *  f = collector current / full scale glows the die, heat 0..1 reddens the epoxy. */
export function transistorPart(parent: THREE.Object3D, at: V3, { scale = 1.6, letters = ['C', 'B', 'E'] } = {}) {
  const group = add(parent, new THREE.Group(), [at[0] + 1.5 * scale, at[1], at[2]])
  group.rotation.z = -Math.PI / 2
  const flip = add(group, new THREE.Group())
  flip.rotation.y = Math.PI
  const part = add(flip, buildTo92())
  part.scale.setScalar(scale)
  const body = part.userData.body as THREE.MeshStandardMaterial
  litEpoxy(body)
  const dieX = at[0] + (1.5 + TO92.base + TO92.h / 2) * scale
  const halo = glowHalo(flip, [0, (TO92.base + TO92.h / 2) * scale, -(TO92.r + 0.3) * scale], 0.8 * scale)
  const edge = at[0] + (1.5 + TO92.base + TO92.h + 0.45) * scale
  ;letters.forEach((t, i) => partLetter(parent, t, [edge, at[1] + (1 - i) * scale, at[2]], 0.5 * scale))
  return {
    group,
    pins: { c: [at[0], at[1] + scale, at[2]] as V3, b: at, e: [at[0], at[1] - scale, at[2]] as V3 },
    /** Centre of the body, where charges cross from C to E. */
    die: [dieX, at[1], at[2]] as V3,
    set(f: number, heat = 0) {
      halo.set(0.45 * Math.sqrt(clamp01(f)), CONVENTIONAL)
      heatGlow(body, heat)
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
    const t = transistorPart(parent, at, { scale, letters: ['D', 'G', 'S'] })
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
  partLetter(parent, 'D', [d[0] + 1.6 * k, d[1], at[2]], tag)
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

const DIP_W = 3.4
const DIP_H = 5.2
const DIP_PITCH = DIP_H / 4

/** Dual op-amp in a DIP-8 (TL072 pinout), top view facing +z, notch up: pins 1–4 down the left, 5–8 up the right.
 *  Two triangles are marked on the lid, A pointing at pin 1 (OUT A), B at pin 7 (OUT B). `pins[k]` is pin k's tip;
 *  `light(k, color)` glows a leg (null turns it off). */
export function dip8OpAmp(parent: THREE.Object3D, at: V3, scale = 1) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(scale)
  add(g, icPackage(DIP_W, DIP_H, 4))
  const rowY = (i: number) => DIP_H / 2 - (i + 0.5) * DIP_PITCH
  const xy = (k: number): [number, number] => (k <= 4 ? [-1, rowY(k - 1)] : [1, rowY(8 - k)])
  const ink = glowMat('#cfd3da', 0.25)
  const mark = (cx: number, cy: number, dir: number) => {
    const s = 0.55
    const pts: V3[] = [[cx - dir * s, cy + s, 0.63], [cx + dir * s, cy, 0.63], [cx - dir * s, cy - s, 0.63]]
    pts.forEach((p, i) => rod(g, p, pts[(i + 1) % 3], 0.05, ink))
  }
  mark(-0.75, rowY(0) - 0.25, -1)
  mark(0.75, rowY(2) + 0.25, 1)
  const legs: THREE.Mesh[] = []
  const pins: V3[] = [[0, 0, 0]]
  for (let k = 1; k <= 8; k++) {
    const [s, y] = xy(k)
    const leg = add(g, mesh(new THREE.BoxGeometry(0.95, 0.5, 0.3), glowMat('#ffffff', 1)), [s * (DIP_W / 2 + 0.4), y, -0.15])
    leg.visible = false
    legs.push(leg)
    pins.push([at[0] + s * (DIP_W / 2 + 0.85) * scale, at[1] + y * scale, at[2]])
  }
  return {
    group: g,
    pins,
    light(k: number, color: string | null) {
      const leg = legs[k - 1]
      leg.visible = color !== null
      if (!color) return
      const m = leg.material as THREE.MeshStandardMaterial
      m.color.set(color)
      m.emissive.set(color)
    },
  }
}

const MM = 1 / 2.54

/** AMS1117 in SOT-223 (6.5 × 3.5 mm body) facing +z at `at`, `scale` × real: the three gull-wing legs point +x
 *  (IN on top, OUT, GND at the bottom; labelled on the body), the big OUT tab sticks out −x. `pins` are the leg and tab tips at z = 0.
 *  `set(f, heat)`: f = current / rated glows the die, heat 0..1 reddens the body. */
export function sot223Regulator(parent: THREE.Object3D, at: V3, scale = 2.4) {
  const k = MM * scale
  const group = add(parent, new THREE.Group(), at)
  const bodyMat = mat('#1c1d22', { rough: 0.5 }, true)
  litEpoxy(bodyMat)
  box(group, [3.5 * k, 6.5 * k, 1.6 * k], bodyMat, [0, 0, 0])
  cylinder(group, 0.35 * k, 0.1 * k, mat('#30323a'), [-1 * k, -2.4 * k, 0.8 * k], 'z', 16)
  const tin = STEEL()
  box(group, [2.4 * k, 3 * k, 0.3 * k], tin, [-2.7 * k, 0, -0.65 * k])
  const legX = 1.75 * k
  const ys = [2.3, 0, -2.3].map((y) => y * k)
  for (const y of ys) {
    box(group, [0.9 * k, 0.7 * k, 0.26 * k], tin, [legX + 0.45 * k, y, -0.3 * k])
    box(group, [0.26 * k, 0.7 * k, 0.6 * k], tin, [legX + 0.9 * k, y, -0.55 * k])
    box(group, [0.9 * k, 0.7 * k, 0.26 * k], tin, [legX + 1.35 * k, y, -0.8 * k])
  }
  ;['IN', 'OUT', 'GND'].forEach((t, i) => partLetter(group, t, [legX - 0.3 * k, ys[i] - (i ? 0 : 0.95 * k), 0.85 * k], 0.6 * k, LABEL, 'right'))
  const halo = glowHalo(group, [0, 0, 1.2 * k], 1.4 * k)
  const tip = legX + 1.8 * k
  const p = (x: number, y: number): V3 => [at[0] + x, at[1] + y, at[2]]
  return {
    group,
    pins: { in: p(tip, ys[0]), out: p(tip, ys[1]), gnd: p(tip, ys[2]), tab: p(-3.9 * k, 0) },
    set(f: number, heat = 0) {
      halo.set(0.5 * Math.sqrt(clamp01(f)), CONVENTIONAL)
      heatGlow(bodyMat, heat)
    },
  }
}

const CAN_W = 4.35
const CAN_D = 1.83
const CAN_H = 5.3
const BASE_H = 0.45
const PIN_X = 0.96
const LEG = 1.6
const BLANK_R = 1.55
const BLANK_T = 0.24
const BLANK_Y = 3
const ELECTRODE_R = 0.95
const SHEAR = 0.24

function stadium(w: number, d: number) {
  const r = d / 2
  const c = w / 2 - r
  const s = new THREE.Shape()
  s.absarc(c, 0, r, -Math.PI / 2, Math.PI / 2, false)
  s.absarc(-c, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false)
  return s
}

function stadiumSolid(w: number, d: number, h: number, hole = 0) {
  const s = stadium(w, d)
  if (hole) s.holes.push(new THREE.Path(stadium(w - 2 * hole, d - 2 * hole).getPoints(24)))
  return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 16 }).rotateX(-Math.PI / 2)
}

/** Cut-open HC-49/U crystal (11 × 4.7 × 13.5 mm can) standing on its legs, `scale` × the real part, centred on its quartz
 *  blank at `at`. The disc is held edge-on by two spring clips, a silver electrode on each face. `set(strain, volts)`:
 *  strain −1..1 shears the faces against each other and flexes the disc (thickness-shear, hugely exaggerated); volts −1..1
 *  tints the electrodes by potential, front against back. `legs` are the lead tips. */
export function hc49Crystal(parent: THREE.Object3D, at: V3, { scale = 1 } = {}) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(scale)
  const body = add(group, new THREE.Group(), [0, -BLANK_Y, 0])
  const steel = mat('#c9cdd4', { metal: 0.4, rough: 0.35 })
  const shell = new THREE.MeshStandardMaterial({ color: '#d6dae2', metalness: 0.3, roughness: 0.3, transparent: true, opacity: 0.13, depthWrite: false })
  add(body, mesh(stadiumSolid(CAN_W, CAN_D, CAN_H - BASE_H, 0.06), shell), [0, BASE_H, 0]).castShadow = false
  add(body, mesh(stadiumSolid(CAN_W, CAN_D, 0.06), shell), [0, CAN_H - 0.06, 0]).castShadow = false
  add(body, mesh(stadiumSolid(CAN_W + 0.16, CAN_D + 0.16, BASE_H), steel))
  const seal = mat('#7fa59a', { rough: 0.3 })
  for (const s of [-1, 1]) {
    cylinder(body, 0.2, 0.08, seal, [s * PIN_X, BASE_H + 0.04, 0], 'y', 16)
    lead(body, [[s * PIN_X, -LEG, 0], [s * PIN_X, BASE_H + 0.6, 0], [s * (BLANK_R + 0.1), BLANK_Y - 1, 0], [s * (BLANK_R + 0.1), BLANK_Y, 0]], 0.07, steel)
    box(body, [0.22, 0.7, 0.42], steel, [s * (BLANK_R + 0.04), BLANK_Y, 0])
  }

  const blank = add(group, new THREE.Group())
  const geo = new THREE.CylinderGeometry(BLANK_R, BLANK_R, BLANK_T, 56, 1).rotateX(Math.PI / 2)
  const rest = Float32Array.from(geo.attributes.position.array)
  const quartz = new THREE.MeshStandardMaterial({ color: '#e6eef5', roughness: 0.15, transparent: true, opacity: 0.62, emissive: '#7fc4ff', emissiveIntensity: 0 })
  add(blank, mesh(geo, quartz))
  const electrodes = [1, -1].map((side) => {
    const m = new THREE.MeshStandardMaterial({ color: '#dfe3ea', metalness: 0.4, roughness: 0.3, emissive: '#000000' })
    const e = cylinder(blank, ELECTRODE_R, 0.03, m, [0, 0, side * (BLANK_T / 2 + 0.015)], 'z', 40)
    box(e, [BLANK_R - ELECTRODE_R + 0.15, 0.03, 0.2], m, [-side * (ELECTRODE_R + (BLANK_R - ELECTRODE_R) / 2), 0, 0])
    return { e, m, side }
  })

  const legs: [V3, V3] = [-1, 1].map((s) => [at[0] + s * PIN_X * scale, at[1] - (BLANK_Y + LEG) * scale, at[2]] as V3) as [V3, V3]
  const color = new THREE.Color()
  return {
    group,
    legs,
    set(strain: number, volts: number) {
      const pos = geo.attributes.position
      for (let i = 0; i < pos.count; i++) {
        const x = rest[3 * i]
        const y = rest[3 * i + 1]
        const z = rest[3 * i + 2]
        const w = Math.max(0, 1 - (x * x + y * y) / (BLANK_R * BLANK_R))
        pos.setXYZ(i, x + SHEAR * strain * w * (2 * z) / BLANK_T, y, z + 0.4 * SHEAR * strain * w)
      }
      pos.needsUpdate = true
      geo.computeVertexNormals()
      quartz.emissiveIntensity = 0.35 * Math.abs(strain)
      for (const { e, m, side } of electrodes) {
        e.position.x = 0.8 * SHEAR * strain * side
        e.position.z = side * (BLANK_T / 2 + 0.015) + 0.4 * SHEAR * strain
        m.emissive.copy(potentialColor(0.5 + 0.5 * side * volts, color))
        m.emissiveIntensity = 0.9 * Math.abs(volts)
      }
    },
  }
}

const FUSE_L = 7.87
const FUSE_R = 0.985
const CAP_L = 2

/** 5×20 mm glass fuse centred at `at` along x, `scale` × the real part. `slow`: slow-blow, the element coiled round a core
 *  (more mass, more time); else a bare straight wire. `set(heat, melt)`: heat 0..1 glows the element, melt 0..1 parts it in
 *  the middle, pulls the halves back into beads and smokes the glass with metal vapour. `ends` are the cap tips. */
export function glassFuse(parent: THREE.Object3D, at: V3, { scale = 1, slow = false } = {}) {
  const group = add(parent, new THREE.Group(), at)
  group.scale.setScalar(scale)
  const half = FUSE_L / 2
  const glass = new THREE.MeshStandardMaterial({ color: '#e8eef8', transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false })
  cylinder(group, FUSE_R * 0.96, FUSE_L - 0.3, glass, [0, 0, 0], 'x', 32).castShadow = false
  const cap = mat('#c4c8cf', { metal: 0.45, rough: 0.3 })
  for (const s of [-1, 1]) {
    cylinder(group, FUSE_R + 0.04, CAP_L, cap, [s * (half - CAP_L / 2), 0, 0], 'x', 32)
    cylinder(group, FUSE_R * 0.7, 0.12, cap, [s * (half + 0.06), 0, 0], 'x', 24)
  }
  const span = half - CAP_L + 0.2
  if (slow) cylinder(group, 0.17, 2 * span, mat('#e6dcc2', { rough: 0.8 }), [0, 0, 0], 'x', 12)
  const metal = new THREE.MeshStandardMaterial({ color: '#d0d3d9', metalness: 0.4, roughness: 0.35 })
  const turns = 9
  const halves = [-1, 1].map((s) => {
    const anchor = add(group, new THREE.Group(), [s * (half - CAP_L + 0.2), 0, 0])
    if (slow) {
      const pts = Array.from({ length: 120 }, (_, i) => {
        const u = i / 119
        const a = 2 * Math.PI * turns * u
        return new THREE.Vector3(-s * span * u, 0.27 * Math.cos(a), 0.27 * Math.sin(a))
      })
      add(anchor, mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, 0.055, 6), metal))
    } else rod(anchor, [0, 0, 0], [-s * span, 0, 0], 0.07, metal, 8)
    const bead = add(anchor, mesh(new THREE.SphereGeometry(0.2, 12, 10), metal), [-s * span, slow ? 0.27 : 0, 0])
    return { anchor, bead, s }
  })
  const soot = new THREE.MeshStandardMaterial({ color: '#4a4a50', metalness: 0.3, roughness: 0.4, transparent: true, opacity: 0, depthWrite: false })
  cylinder(group, FUSE_R * 0.9, 3.2, soot, [0, 0, 0], 'x', 32).castShadow = false
  const ends: [V3, V3] = [
    [at[0] - (half + 0.12) * scale, at[1], at[2]],
    [at[0] + (half + 0.12) * scale, at[1], at[2]],
  ]
  return {
    group,
    ends,
    set(heat: number, melt: number) {
      const m = clamp01(melt)
      heatGlow(metal, Math.max(clamp01(heat), m > 0 && m < 1 ? 1 - m : 0))
      for (const h of halves) {
        h.anchor.scale.x = 1 - 0.45 * m
        h.bead.visible = m > 0.01
        h.bead.scale.set(1 / (1 - 0.45 * m), 1, 1).multiplyScalar(0.4 + 0.8 * m)
      }
      soot.opacity = 0.45 * m
    },
  }
}
