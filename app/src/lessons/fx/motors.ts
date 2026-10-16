// Motors cut open: brushed DC motor (magnets, 3-slot armature, commutator and brushes), NEMA17 stepper, BLDC outrunner.
import * as THREE from 'three/webgpu'
import { coilShares } from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh, rod, STEEL } from '../../models/kit'
import { B_FIELD, DATA_COLOR, HEAT, HIGH_V, LOW_V, NORTH, SOUTH } from './colors'
import { heatGlow } from './heat'
import { partLetter } from './parts'
import { sectorGeometry } from './shapes'

const TAU = Math.PI * 2

/** Phase A/B/C colours for three-phase motors. */
export const PHASE_COLORS = [HEAT, B_FIELD, DATA_COLOR]

const tint = (m: THREE.MeshStandardMaterial, color: string, k: number) => {
  m.emissive.set(color)
  m.emissiveIntensity = k
}

/** Brushed DC motor facing +z with its front cap off, rotor radius `r`: ferrite magnets N (left) and S (right) in a steel
 *  can, a 3-slot laminated armature with copper coils, a 3-segment commutator in front and carbon brushes top (+) and
 *  bottom (−). `set(angle, level, heat)`: rotor turned clockwise by `angle`; coils glow N/S by their share of the current
 *  (`level` 0..1), or red-hot when `heat` > 0; the brushes and the segments under them light up. `pins` = [+, −] leads. */
export function brushedMotor(parent: THREE.Object3D, at: V3, r = 2) {
  const group = add(parent, new THREE.Group(), at)
  const L = 1.4 * r
  const can = new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.35, roughness: 0.4, side: THREE.DoubleSide })
  add(group, mesh(new THREE.CylinderGeometry(1.45 * r, 1.45 * r, 1.8 * r, 48, 1, true), can)).rotation.x = Math.PI / 2
  cylinder(group, 1.45 * r, 0.1, mat('#3a3d44', { rough: 0.6 }), [0, 0, -0.9 * r], 'z', 48)
  for (const [mid, color, name] of [[Math.PI, NORTH, 'N'], [0, SOUTH, 'S']] as const) {
    add(group, mesh(sectorGeometry(1.08 * r, 1.42 * r, mid, 1.9, L), mat(color, { rough: 0.55, emissive: color === NORTH ? '#3a0d0a' : '#0c1a40' })), [0, 0, -L / 2])
    partLetter(group, name, [1.25 * r * Math.cos(mid), 0, L / 2 + 0.05], 0.4 * r, '#ffffff')
  }

  const rotor = add(group, new THREE.Group())
  const iron = mat('#6f757e', { metal: 0.3, rough: 0.45 })
  cylinder(rotor, 0.26 * r, L, iron, [0, 0, 0], 'z', 24)
  const coils = [0, 1, 2].map((k) => {
    const a = (TAU * k) / 3
    const arm = add(rotor, new THREE.Group())
    arm.rotation.z = a
    box(arm, [0.62 * r, 0.26 * r, L], iron, [0.5 * r, 0, 0])
    add(rotor, mesh(sectorGeometry(0.8 * r, r, a, 1.45, L), iron), [0, 0, -L / 2])
    const m = new THREE.MeshStandardMaterial({ color: '#c8803f', metalness: 0.35, roughness: 0.4 })
    box(arm, [0.4 * r, 0.5 * r, L + 0.28 * r], m, [0.52 * r, 0, 0])
    return m
  })
  const zc = L / 2 + 0.5 * r
  const segs = [0, 1, 2].map((k) => {
    const m = new THREE.MeshStandardMaterial({ color: '#c8803f', metalness: 0.35, roughness: 0.35 })
    add(rotor, mesh(sectorGeometry(0.12 * r, 0.32 * r, (TAU * k) / 3 + Math.PI / 3, 1.75, 0.4 * r), m), [0, 0, zc - 0.2 * r])
    return m
  })
  rod(rotor, [0, 0, -1.05 * r], [0, 0, zc + 1.1 * r], 0.08 * r, STEEL())

  const brushMats = [HIGH_V, LOW_V].map((c, i) => {
    const s = i ? -1 : 1
    const m = new THREE.MeshStandardMaterial({ color: '#2d2e33', roughness: 0.8 })
    box(group, [0.24 * r, 0.36 * r, 0.26 * r], m, [0, s * 0.5 * r, zc])
    box(group, [0.08 * r, 0.9 * r, 0.3 * r], mat('#c9a14a', { metal: 0.4, rough: 0.35 }), [0, s * 1.1 * r, zc])
    return { m, c }
  })
  const pins: V3[] = [1, -1].map((s): V3 => [at[0], at[1] + s * 1.55 * r, at[2] + zc])

  return {
    group,
    rotor,
    pins,
    /** Front of the shaft, local coordinates. */
    shaftTip: [0, 0, zc + 1.1 * r] as V3,
    set(angle: number, level: number, heat = 0) {
      rotor.rotation.z = -angle
      const th = rotor.rotation.z
      coilShares(th).forEach((f, k) => (heat > 0 ? heatGlow(coils[k], heat) : tint(coils[k], f > 0 ? NORTH : SOUTH, 0.15 + Math.abs(f) * level * 2.4)))
      const mids = [0, 1, 2].map((k) => Math.sin(th + (TAU * k) / 3 + Math.PI / 3))
      const top = mids.indexOf(Math.max(...mids))
      const bottom = mids.indexOf(Math.min(...mids))
      segs.forEach((m, k) => tint(m, k === top ? HIGH_V : LOW_V, k === top || k === bottom ? level : 0))
      for (const b of brushMats) tint(b.m, b.c, level * 0.8)
    },
  }
}

/** Toothed outline round the origin: `count` teeth from `r0` to `r1`, tooth `i` centred on `phase + i·2π/count`. */
function toothedShape(count: number, r0: number, r1: number, phase = 0) {
  const s = new THREE.Shape()
  const p = TAU / count
  for (let i = 0; i < count; i++) {
    const c = phase + i * p
    const pts: [number, number][] = [[r0, c - 0.27 * p], [r1, c - 0.17 * p], [r1, c + 0.17 * p], [r0, c + 0.27 * p]]
    pts.forEach(([r, a], j) => (i === 0 && j === 0 ? s.moveTo(r * Math.cos(a), r * Math.sin(a)) : s.lineTo(r * Math.cos(a), r * Math.sin(a))))
  }
  s.closePath()
  return s
}

/** NEMA17 hybrid stepper facing +z, front cap off, rotor radius `r`: square housing, laminated stator with 8 toothed poles
 *  (A at 0°/90°/180°/270°, B between; copper windings) round a 50-tooth rotor. `set(angle, ia, ib)`: rotor turned
 *  anticlockwise by `angle` (rad, 1.8° per full step); each pole glows N/S by its phase current (−1…1). `pins` =
 *  [A+, A−, B+, B−] lead ends below the housing; `rotor` takes a needle. */
export function nema17(parent: THREE.Object3D, at: V3, r = 2) {
  const group = add(parent, new THREE.Group(), at)
  const L = 1.5 * r
  const S = 1.95 * r
  const c = 0.4 * r
  const housing = new THREE.Shape()
  ;[[S - c, -S], [S, -S + c], [S, S - c], [S - c, S], [-S + c, S], [-S, S - c], [-S, -S + c], [-S + c, -S]].forEach(([x, y], i) => (i ? housing.lineTo(x, y) : housing.moveTo(x, y)))
  housing.holes.push(new THREE.Path().absarc(0, 0, 1.8 * r, 0, TAU, true))
  add(group, mesh(new THREE.ExtrudeGeometry(housing, { depth: L, bevelEnabled: false }), mat('#2b2d33', { rough: 0.55 })), [0, 0, -L])
  cylinder(group, 1.8 * r, 0.1, mat('#1d1e22', { rough: 0.7 }), [0, 0, -L], 'z', 48)
  const lam = mat('#8d939c', { metal: 0.3, rough: 0.45 })
  add(group, mesh(sectorGeometry(1.42 * r, 1.8 * r, 0, TAU, L - 0.04 * r), lam), [0, 0, -L])
  const pitch = TAU / 50
  const poles = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4
    const arm = add(group, new THREE.Group(), [0, 0, -L / 2])
    arm.rotation.z = a
    box(arm, [0.3 * r, 0.36 * r, L - 0.04 * r], lam, [1.28 * r, 0, 0])
    const shoe = new THREE.MeshStandardMaterial({ color: '#8d939c', metalness: 0.3, roughness: 0.45 })
    add(group, mesh(sectorGeometry(1.08 * r, 1.16 * r, a, 0.62, L - 0.04 * r), shoe), [0, 0, -L])
    for (let k = -2; k <= 2; k++) {
      const t = add(group, new THREE.Group(), [0, 0, -L / 2])
      t.rotation.z = a + k * pitch
      box(t, [0.07 * r, 0.06 * r, L - 0.04 * r], shoe, [1.05 * r, 0, 0])
    }
    const copper = new THREE.MeshStandardMaterial({ color: '#c8803f', metalness: 0.35, roughness: 0.4 })
    box(arm, [0.22 * r, 0.6 * r, L + 0.24 * r], copper, [1.29 * r, 0, 0])
    const name = `${i % 2 ? 'B' : 'A'}${i % 4 > 1 ? '\u0304' : ''}`
    partLetter(group, name, [1.6 * r * Math.cos(a), 1.6 * r * Math.sin(a), 0.1], 0.22 * r, '#ffffff')
    return { copper, shoe, phase: i % 2, sign: i % 4 > 1 ? -1 : 1 }
  })

  const rotor = add(group, new THREE.Group())
  add(rotor, mesh(new THREE.ExtrudeGeometry(toothedShape(50, 0.9 * r, r), { depth: L - 0.1 * r, bevelEnabled: false, curveSegments: 1 }), mat('#a3a9b2', { metal: 0.35, rough: 0.4 })), [0, 0, -L + 0.05 * r])
  cylinder(rotor, 0.55 * r, 0.04 * r, mat('#5d636c', { rough: 0.5 }), [0, 0, -0.03 * r], 'z', 32)
  box(rotor, [0.4 * r, 0.06 * r, 0.03 * r], mat('#f2f2f2'), [0.68 * r, 0, -0.03 * r])
  rod(rotor, [0, 0, -L - 0.3 * r], [0, 0, 1.2 * r], 0.12 * r, STEEL())

  const colors = ['#1c1c1f', '#2fa84f', '#d23b3b', '#2a5bd7']
  const pins = colors.map((col, i): V3 => {
    const x = (i - 1.5) * 0.32 * r
    rod(group, [x, -S, -0.6 * L], [x, -S - 0.5 * r, -0.6 * L], 0.07 * r, mat(col, { rough: 0.5 }))
    return [at[0] + x, at[1] - S - 0.5 * r, at[2] - 0.6 * L]
  })
  box(group, [1.5 * r, 0.25 * r, 0.4 * r], mat('#f2f2f2', { rough: 0.6 }), [0, -S - 0.1 * r, -0.6 * L])

  return {
    group,
    rotor,
    pins,
    shaftTip: [0, 0, 1.2 * r] as V3,
    set(angle: number, ia: number, ib: number) {
      rotor.rotation.z = angle
      for (const p of poles) {
        const f = p.sign * (p.phase ? ib : ia)
        tint(p.copper, f > 0 ? NORTH : SOUTH, 0.1 + Math.abs(f) * 1.6)
        tint(p.shoe, f > 0 ? NORTH : SOUTH, Math.abs(f) * 0.5)
      }
    },
  }
}

const BLDC_TEETH = [0, 2, 1, 0, 2, 1].map((phase, i) => ({ phase, sign: i % 2 ? -1 : 1 }))

/** Outrunner BLDC facing +z, front cap off, stator radius `r`: 6 laminated teeth wound A, C̄, B, Ā, C, B̄ (phase axes
 *  A 0°, B 120°, C 240°) inside a spinning bell with a 2-pole magnet ring (S at the rotor angle, N opposite).
 *  `set(angle, [ia, ib, ic])`: bell turned anticlockwise; each tooth glows N/S by its phase current (−1…1).
 *  `halls`: three Hall chips on teeth A, B, C, lit by `hall(k, on)`. `pins` = A, B, C lead ends below; `rotor` takes a needle. */
export function bldcMotor(parent: THREE.Object3D, at: V3, r = 2, { halls = false, phaseColors = ['#c8803f', '#c8803f', '#c8803f'] } = {}) {
  const group = add(parent, new THREE.Group(), at)
  const L = 0.9 * r
  const lam = mat('#8d939c', { metal: 0.3, rough: 0.45 })
  cylinder(group, 0.36 * r, L, lam, [0, 0, -L / 2], 'z', 32)
  const teeth = BLDC_TEETH.map(({ phase, sign }, i) => {
    const a = (i * Math.PI) / 3
    const arm = add(group, new THREE.Group(), [0, 0, -L / 2])
    arm.rotation.z = a
    box(arm, [0.5 * r, 0.22 * r, L], lam, [0.6 * r, 0, 0])
    const shoe = new THREE.MeshStandardMaterial({ color: '#8d939c', metalness: 0.3, roughness: 0.45 })
    add(group, mesh(sectorGeometry(0.84 * r, r, a, 0.82, L), shoe), [0, 0, -L])
    const copper = new THREE.MeshStandardMaterial({ color: '#c8803f', metalness: 0.35, roughness: 0.4 })
    box(arm, [0.36 * r, 0.42 * r, L + 0.2 * r], copper, [0.6 * r, 0, 0])
    partLetter(group, `${'ABC'[phase]}${sign < 0 ? '\u0304' : ''}`, [0.6 * r * Math.cos(a), 0.6 * r * Math.sin(a), 0.14 * r], 0.2 * r, phaseColors[phase])
    return { copper, shoe, phase, sign }
  })

  const rotor = add(group, new THREE.Group())
  const bell = new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.35, roughness: 0.4, side: THREE.DoubleSide })
  add(rotor, mesh(sectorGeometry(1.28 * r, 1.42 * r, 0, TAU, L + 0.15 * r), bell), [0, 0, -L - 0.15 * r])
  cylinder(rotor, 1.42 * r, 0.08 * r, mat('#3a3d44', { rough: 0.6 }), [0, 0, -L - 0.15 * r], 'z', 48)
  for (const [mid, color] of [[0, SOUTH], [Math.PI, NORTH]] as const) {
    add(rotor, mesh(sectorGeometry(1.06 * r, 1.28 * r, mid, 2.7, L), mat(color, { rough: 0.55, emissive: color === NORTH ? '#3a0d0a' : '#0c1a40' })), [0, 0, -L])
    partLetter(rotor, color === NORTH ? 'N' : 'S', [1.17 * r * Math.cos(mid), 1.17 * r * Math.sin(mid), 0.05], 0.2 * r, '#ffffff')
  }
  rod(rotor, [0, 0, -L - 0.3 * r], [0, 0, 0.5 * r], 0.08 * r, STEEL())

  const hallMats = halls
    ? [0, 1, 2].map((k) => {
        const a = (k * 2 * Math.PI) / 3
        const m = new THREE.MeshStandardMaterial({ color: '#1c1c1f', emissive: '#ffd84d', emissiveIntensity: 0, roughness: 0.6 })
        const chip = add(group, new THREE.Group(), [0.92 * r * Math.cos(a), 0.92 * r * Math.sin(a), 0.06 * r])
        chip.rotation.z = a
        box(chip, [0.12 * r, 0.26 * r, 0.1 * r], m)
        return m
      })
    : []

  const pins = [0, 1, 2].map((k): V3 => {
    const x = (k - 1) * 0.3 * r
    rod(group, [x, -0.5 * r, -0.4 * L], [x, -1.75 * r, -0.4 * L], 0.05 * r, mat(phaseColors[k], { rough: 0.5 }))
    return [at[0] + x, at[1] - 1.75 * r, at[2] - 0.4 * L]
  })

  return {
    group,
    rotor,
    pins,
    shaftTip: [0, 0, 0.5 * r] as V3,
    set(angle: number, amps: readonly number[]) {
      rotor.rotation.z = angle
      for (const t of teeth) {
        const f = t.sign * amps[t.phase]
        tint(t.copper, f > 0 ? NORTH : SOUTH, 0.1 + Math.abs(f) * 1.6)
        tint(t.shoe, f > 0 ? NORTH : SOUTH, Math.abs(f) * 0.6)
      }
    },
    hall(k: number, on: boolean) {
      if (hallMats[k]) hallMats[k].emissiveIntensity = on ? 1.4 : 0
    },
  }
}
