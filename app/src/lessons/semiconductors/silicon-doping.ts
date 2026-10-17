import * as THREE from 'three/webgpu'
import {
  COPPER_FREE_ELECTRONS,
  RESISTIVITY,
  SEMICONDUCTORS,
  SI_ATOMS,
  TEMP_COEFF,
  carrierDensities,
  conductivity,
  driftSpeeds,
  electronShare,
  intrinsicDensity,
  metalResistance,
} from '../../core/physics'
import { fitDigits, sci, si, volts } from '../../core/units'
import { V3, add, box, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  ACCEPTOR,
  CELL_H,
  DONOR,
  Dopant,
  ELECTRON,
  GREY,
  HIGH_V,
  HOLE,
  RING,
  arrow,
  cell,
  ease,
  emptyGroup,
  glowMat,
  ivScreen,
  potentialColor,
  pulseLabel,
  rand,
  siliconCrystal,
  ticks,
  wire,
  rand01,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const SILICON = SEMICONDUCTORS.silicon
const perCm3 = (v: number) => `${sci(v * (1 + 1e-9))} /cm³`
const ohmCm = (r: number) => (r >= 1e16 ? `> 10¹⁶ Ω·cm` : r >= 1e9 ? `${sci(r)} Ω·cm` : si(r, 'Ω·cm', 3))
const kelvinFormat = (v: number) => `${Math.round(v)} K · ${Math.round(v - 273)} °C`
/** Carriers drawn for a density: log scale, 3 at silicon's 10¹⁰ /cm³. */
const shown = (density: number, max = 12) => Math.max(0, Math.min(max, Math.round(3 + (Math.log10(Math.max(density, 1)) - 10) * 1.5)))

// --- Band gap: electrons must jump the gap to move; heat supplies the jump. ---

type Material = 'copper' | 'germanium' | 'silicon' | 'diamond'
const LOOK: Record<Material, { label: string; color: string }> = {
  copper: { label: 'Copper', color: '#d08a4e' },
  germanium: { label: 'Germanium', color: '#e6c86e' },
  silicon: { label: 'Silicon', color: '#c8d2e0' },
  diamond: { label: 'Diamond', color: '#b48cff' },
}
const MATERIALS = Object.keys(LOOK) as Material[]
const materialOf = (p: Params): Material => (MATERIALS.includes(p.material as Material) ? (p.material as Material) : 'silicon')

function bands(m: Material, kelvin: number) {
  if (m === 'copper') {
    const rho = metalResistance(RESISTIVITY.copper * 100, TEMP_COEFF.copper, kelvin - 273.15)
    return { gap: 0, n: COPPER_FREE_ELECTRONS / 1e6, rho, kind: 'Conductor' }
  }
  const s = SEMICONDUCTORS[m]
  const ni = intrinsicDensity(kelvin, s)
  return { gap: s.gapEv, n: ni, rho: 1 / conductivity(ni, ni, s), kind: s.gapEv > 3 ? 'Insulator' : 'Semiconductor' }
}

const BX = -9.4
const BW = 10
const BAND_H = 2.6
const MID = 1.2
const GAP_PER_EV = 1.25
const OVERLAP = 0.6
const VB_COLS = 12
const VB_ROWS = 3
const MAX_E = 16
const METAL_E = 14
const LOG_TOP = 24
const T_MIN = 200
const T_MAX = 600
const S1: V3 = [6.4, MID, 0]

interface Excited {
  hole: number
  holeFrom: number
  holeT: number
  wait: number
  up: number
  from: THREE.Vector3
  to: THREE.Vector3
  fall: number
  fallFrom: THREE.Vector3
  p: THREE.Vector3
  v: THREE.Vector3
}

export const bandGap: Lesson = {
  id: 'silicon-doping-band-gap',
  title: 'Band gap',
  tagline: 'The jump an electron must make',
  formula: (p) => {
    const m = materialOf(p)
    const k = n(p, 'k')
    const b = bands(m, k)
    if (m === 'copper') return `Metal: the bands overlap, so n = ${sci(b.n)} /cm³ at any temperature · ρ = ${ohmCm(b.rho)}`
    return `n_i ∝ T^1.5 · e^(−Eg / 2kT) = e^(−${b.gap.toFixed(2)} eV / ${(2 * 8.617e-5 * k).toFixed(3)} eV) → ${perCm3(b.n)}`
  },
  legend: [
    { color: '#4a78c0', label: 'Valence band: electrons in bonds', shape: 'dot' },
    { color: GREY, label: 'Conduction band: free to move', shape: 'dot' },
    { color: ELECTRON, label: 'Electron; yellow while it jumps', shape: 'dot' },
    { color: HOLE, label: 'Hole it leaves behind', shape: 'dot' },
    { color: '#ffffff', label: 'Free carriers vs T, log₁₀ /cm³', shape: 'dot' },
  ],
  points: [
    'In a solid, electrons can only have energies in certain bands. The lower (valence) band holds the electrons locked in bonds; the upper (conduction) band is where an electron is free to move and carry current.',
    'Between them is a forbidden gap. An electron needs at least that much energy, the band gap Eg, to jump up. When it does, it leaves a hole behind in the bonds.',
    'In a metal like copper the bands overlap: plenty of electrons are already free, so it conducts at any temperature. In diamond the gap is 5.5 eV and almost nothing ever jumps: an insulator.',
    'Silicon’s 1.12 eV is in between, a semiconductor. Heat gives a few electrons the jump: about 10¹⁰ per cm³ at room temperature, out of 5 × 10²² atoms. That doubles every ~8 °C.',
    'Light can make the jump too, if each photon carries more than Eg: 1240 / 1.12 = 1107 nm or shorter. That is how solar cells and camera sensors work.',
  ],
  controls: [
    { kind: 'choice', key: 'material', options: MATERIALS.map((m) => ({ value: m, label: LOOK[m].label })), initial: 'silicon' },
    { kind: 'slider', key: 'k', label: 'Temperature', min: T_MIN, max: T_MAX, initial: 300, step: 5, format: kelvinFormat },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const glass = (color: string, opacity: number) =>
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, transparent: true, opacity, roughness: 0.4, depthWrite: false })
    const vb = add(scene, mesh(new THREE.BoxGeometry(BW, BAND_H, 1.6), glass('#2a4a78', 0.6)))
    const cb = add(scene, mesh(new THREE.BoxGeometry(BW, BAND_H, 1.6), glass('#4a5060', 0.45)))
    vb.castShadow = cb.castShadow = false

    const gapMat = glowMat(RING, 0.6)
    const marker = add(scene, new THREE.Group())
    const shaft = add(marker, mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 8), gapMat))
    const heads = [1, -1].map((s) => {
      const c = add(marker, mesh(new THREE.ConeGeometry(0.36, 0.6, 14), gapMat))
      if (s < 0) c.rotation.z = Math.PI
      return c
    })
    const egLabel = pulseLabel(scene, 4, RING, [BX + BW / 2 + 3.4, MID, 0], 1.1)

    const dotMat = glowMat(ELECTRON, 0.6)
    const vbDots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 12, 8), dotMat, VB_COLS * VB_ROWS)
    const free = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffffff' }), MAX_E)
    const rings = new THREE.InstancedMesh(new THREE.TorusGeometry(0.34, 0.1, 8, 24), glowMat(HOLE, 1.1), MAX_E)
    for (const o of [vbDots, free, rings]) {
      o.frustumCulled = false
      o.castShadow = false
      scene.add(o)
    }

    const { plot, dot, y } = ivScreen(scene, S1, 10.5, 9, [4, 6])
    ticks(plot, [[0, '200'], [0.5, '400'], [1, '600']], [[0, '0'], [1 / 3, '8'], [2 / 3, '16'], [1, '24']])
    const tOf = (u: number) => T_MIN + u * (T_MAX - T_MIN)
    const curve = (m: Material) => (u: number) => y(Math.log10(bands(m, tOf(u)).n) / LOG_TOP)
    for (const m of MATERIALS) {
      const t = plot.trace(LOOK[m].color, { radius: 0.06 })
      t.material.emissiveIntensity = 0.35
      t.draw(curve(m), null)
    }
    const live = plot.trace('#ffffff', { radius: 0.14 })

    const state = { m: '' as Material | '', gapH: GAP_PER_EV * SILICON.gapEv, k: 300, gen: 0, t: 0 }
    const excited: Excited[] = []
    const m4 = new THREE.Matrix4()
    const v = new THREE.Vector3()
    const col = new THREE.Color()
    const blue = new THREE.Color(ELECTRON)
    const yellow = new THREE.Color(RING)
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
    const vbTop = () => MID - state.gapH / 2
    const cbBot = () => MID + state.gapH / 2
    const dotAt = (i: number, out: THREE.Vector3) =>
      out.set(BX - BW / 2 + ((i % VB_COLS) + 0.5) * (BW / VB_COLS), vbTop() - (Math.floor(i / VB_COLS) + 0.5) * (BAND_H / VB_ROWS), 1.1)
    const cbSpot = () => new THREE.Vector3(rand(-BW / 2 + 0.5, BW / 2 - 0.5), rand(0.4, BAND_H - 0.4), 1.1)
    const absolute = (e: Excited, out: THREE.Vector3) => out.set(BX + e.p.x, cbBot() + e.p.y, 1.1)
    const neighbours = (i: number) =>
      [i - 1, i + 1, i - VB_COLS, i + VB_COLS].filter((j) => j >= 0 && j < VB_COLS * VB_ROWS && (Math.abs(j - i) !== 1 || Math.floor(j / VB_COLS) === Math.floor(i / VB_COLS)))

    return {
      scene,
      view: { center: [-0.8, MID + 1.2, 0], radius: 52, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const m = materialOf(p)
        state.t += dt
        if (m !== state.m) {
          state.m = m
          excited.length = 0
          live.material.color.set(LOOK[m].color)
          live.material.emissive.set(LOOK[m].color)
          live.draw(curve(m), null)
          if (m === 'copper')
            for (let i = 0; i < METAL_E; i++) {
              const s = cbSpot()
              s.y = rand(OVERLAP + 0.3, BAND_H - 0.35)
              excited.push({ hole: -1, holeFrom: -1, holeT: 1, wait: 0, up: 1, from: s, to: s, fall: -1, fallFrom: s, p: s.clone(), v: new THREE.Vector3() })
            }
        }
        state.k += (n(p, 'k') - state.k) * ease(dt, 5)
        const b = bands(m, state.k)
        state.gapH += ((m === 'copper' ? -OVERLAP : b.gap * GAP_PER_EV) - state.gapH) * ease(dt, 4)
        vb.position.set(BX, vbTop() - BAND_H / 2, 0)
        cb.position.set(BX, cbBot() + BAND_H / 2, 0)

        const span = Math.max(0, state.gapH - 1.2)
        marker.visible = state.gapH > 1.3
        marker.position.set(BX + BW / 2 + 1, MID, 0)
        shaft.scale.y = Math.max(0.01, span)
        heads[0].position.y = span / 2 + 0.3
        heads[1].position.y = -span / 2 - 0.3
        egLabel.show(fitDigits(b.gap, 3))
        egLabel.frame(dt)

        const thermal = 2.2 * Math.sqrt(state.k / 300)
        const want = m === 'copper' ? METAL_E : shown(b.n)
        const pairs = excited.filter((e) => e.hole >= 0 && e.fall < 0)
        state.gen -= dt
        if (m !== 'copper' && state.gen <= 0) {
          const taken = new Set(excited.flatMap((e) => [e.hole, e.holeFrom]))
          if (pairs.length < want) {
            const open = Array.from({ length: VB_COLS * 2 }, (_, i) => i).filter((i) => !taken.has(i))
            const hole = open[Math.floor(rand01() * open.length)]
            const from = dotAt(hole, new THREE.Vector3())
            const to = cbSpot()
            excited.push({ hole, holeFrom: hole, holeT: 1, wait: rand(0.8, 2), up: 0, from: from.clone().setX(from.x - BX), to, fall: -1, fallFrom: new THREE.Vector3(), p: to.clone(), v: new THREE.Vector3() })
            state.gen = rand(0.15, 0.35)
          } else if (pairs.length > want) {
            const e = pairs.find((x) => x.up >= 1)
            if (e) {
              e.fall = 0
              absolute(e, e.fallFrom)
            }
            state.gen = 0.15
          }
        }

        const taken = new Set(excited.flatMap((e) => [e.hole, e.holeFrom]))
        for (let i = excited.length - 1; i >= 0; i--) {
          const e = excited[i]
          if (e.hole >= 0) {
            if (e.holeT < 1) e.holeT = Math.min(1, e.holeT + dt / 0.3)
            else if ((e.wait -= dt) <= 0 && e.fall < 0) {
              e.wait = rand(0.8, 2) * Math.sqrt(300 / state.k)
              const opts = neighbours(e.hole).filter((j) => !taken.has(j))
              if (opts.length) {
                e.holeFrom = e.hole
                e.hole = opts[Math.floor(rand01() * opts.length)]
                e.holeT = 0
                taken.add(e.hole)
              }
            }
          }
          if (e.fall >= 0) {
            e.fall += dt / 0.45
            if (e.fall >= 1) excited.splice(i, 1)
            continue
          }
          if (e.up < 1) {
            e.up = Math.min(1, e.up + dt / 0.5)
            continue
          }
          if (rand01() < dt * 2) e.v.set(rand(-1, 1), rand(-0.5, 0.5), 0).setLength(thermal)
          e.p.addScaledVector(e.v, dt)
          const floor = m === 'copper' ? OVERLAP + 0.3 : 0.35
          if (Math.abs(e.p.x) > BW / 2 - 0.4) {
            e.p.x = Math.sign(e.p.x) * (BW / 2 - 0.4)
            e.v.x *= -1
          }
          if (e.p.y < floor || e.p.y > BAND_H - 0.35) {
            e.p.y = Math.min(BAND_H - 0.35, Math.max(floor, e.p.y))
            e.v.y *= -1
          }
        }

        const holeOf = new Map<number, Excited>()
        for (const e of excited) if (e.hole >= 0) holeOf.set(e.hole, e)
        const moving = new Map<number, Excited>()
        for (const e of excited) if (e.hole >= 0 && e.holeT < 1) moving.set(e.holeFrom, e)
        const a = new THREE.Vector3()
        const c = new THREE.Vector3()
        const jiggle = 0.04 * (state.k / 300)
        for (let i = 0; i < VB_COLS * VB_ROWS; i++) {
          const mv = moving.get(i)
          if (mv) {
            const t = mv.holeT * mv.holeT * (3 - 2 * mv.holeT)
            vbDots.setMatrixAt(i, m4.makeTranslation(dotAt(mv.hole, a).lerp(dotAt(i, c), t)))
          } else if (holeOf.has(i) && holeOf.get(i)!.up > 0) vbDots.setMatrixAt(i, hidden)
          else {
            dotAt(i, a)
            a.x += jiggle * Math.sin(state.t * 9 + i * 1.7)
            a.y += jiggle * Math.sin(state.t * 11 + i)
            vbDots.setMatrixAt(i, m4.makeTranslation(a))
          }
        }
        vbDots.instanceMatrix.needsUpdate = true

        let r = 0
        excited.forEach((e, i) => {
          if (e.fall >= 0) {
            const t = e.fall * e.fall
            v.copy(e.fallFrom).lerp(dotAt(e.hole, a), t)
            col.copy(blue).lerp(yellow, t)
          } else if (e.up < 1) {
            const t = e.up * e.up * (3 - 2 * e.up)
            a.set(BX + e.from.x, e.from.y, 1.1)
            v.copy(a).lerp(c.set(BX + e.to.x, cbBot() + e.to.y, 1.1), t)
            col.copy(yellow).lerp(blue, t)
          } else {
            absolute(e, v)
            col.copy(blue)
          }
          free.setMatrixAt(i, m4.makeTranslation(v))
          free.setColorAt(i, col)
          if (e.hole >= 0 && e.up > 0) {
            const t = e.holeT * e.holeT * (3 - 2 * e.holeT)
            rings.setMatrixAt(r++, m4.makeTranslation(dotAt(e.holeFrom, a).lerp(dotAt(e.hole, c), t)))
          }
        })
        free.count = excited.length
        rings.count = r
        free.instanceMatrix.needsUpdate = rings.instanceMatrix.needsUpdate = true
        if (free.instanceColor) free.instanceColor.needsUpdate = true

        const u = (state.k - T_MIN) / (T_MAX - T_MIN)
        dot.position.set(plot.xAt(u), Math.max(-4.5, y(Math.log10(b.n) / LOG_TOP)), 0.4)
      },
      readouts: (p) => {
        const b = bands(materialOf(p), state.k)
        return [
          { label: 'Band gap', value: b.gap ? `${b.gap.toFixed(2)} eV` : 'None (overlap)' },
          { label: 'Free electrons', value: b.n < 1 ? '< 1 /cm³' : perCm3(b.n) },
          { label: 'Resistivity', value: ohmCm(b.rho) },
          { label: 'Kind', value: b.kind, tone: b.kind === 'Conductor' ? 'ok' : b.kind === 'Insulator' ? 'warn' : undefined },
        ]
      },
    }
  },
}

// --- N-type and P-type: a few foreign atoms add carriers of one kind. ---

const COLS2 = 6
const ROWS2 = 4
const PITCH2 = 2.8
const CX2 = -7
const CY2 = 0.6
const DOPE_SITES = [8, 16, 13, 3, 21, 6]
const N_MIN = 13
const N_MAX = 18
const S2: V3 = [8.4, 0.6, 0]
const LOG_S = [-6, 3]
type Kind = 'pure' | 'n' | 'p'
const kindOf = (p: Params): Kind => (p.type === 'n' || p.type === 'p' ? p.type : 'pure')

function doped(p: Params) {
  const kind = kindOf(p)
  const level = n(p, 'dope')
  const nd = kind === 'n' ? level : 0
  const na = kind === 'p' ? level : 0
  const c = carrierDensities(300, { donors: nd, acceptors: na })
  const pure = carrierDensities(300)
  const sigma = conductivity(c.n, c.p)
  return { kind, level, ...c, sigma, gain: sigma / conductivity(pure.n, pure.p) }
}
const shownDopants = (level: number) => Math.max(1, Math.min(DOPE_SITES.length, 1 + Math.floor(Math.log10(level) - N_MIN + 1e-9)))

export const nAndPType: Lesson = {
  id: 'silicon-doping-n-type-and-p-type',
  title: 'N-type and P-type',
  tagline: 'One atom in a million changes everything',
  formula: (p) => {
    const d = doped(p)
    const sigma = `σ = q(nμn + pμp) = ${si(d.sigma, 'S/cm', 3)}`
    if (d.kind === 'pure') return `n = p = n_i = ${perCm3(d.ni)} · ${sigma}`
    const [major, minor] = d.kind === 'n' ? ['n ≈ Nd', 'p'] : ['p ≈ Na', 'n']
    return `${major} = ${sci(d.level)}, ${minor} = n_i² / ${major[0]} = ${perCm3(Math.min(d.n, d.p))} · ${sigma}, ×${sci(d.gain, 2)} pure`
  },
  legend: [
    { color: DONOR, label: 'Phosphorus (5 outer e⁻)', shape: 'dot' },
    { color: ACCEPTOR, label: 'Boron (3 outer e⁻)', shape: 'dot' },
    { color: ELECTRON, label: 'Electron: bonded, or free (big)', shape: 'dot' },
    { color: HOLE, label: 'Hole: a missing bond electron', shape: 'dot' },
    { color: '#ffffff', label: 'Conductivity vs doping, log', shape: 'dot' },
  ],
  points: [
    'Each silicon atom has 4 outer electrons and shares one with each of its 4 neighbours: every bond holds a pair. Pure silicon has almost no free carriers.',
    'Swap in a phosphorus atom, which has 5. Four fill its bonds; the fifth is barely held and wanders off at room temperature, leaving a fixed + ion. That is n-type: extra electrons.',
    'Boron has only 3, so one of its bonds is an electron short: a hole. A neighbour’s electron hops in, the hole moves on, and a fixed − ion stays behind. That is p-type: extra holes.',
    'Real doping is tiny: 10¹⁶ per cm³ is 1 atom in 5 million (drawn far denser here). Yet it gives a million times more carriers than pure silicon, so conductivity follows the dopant, not the temperature.',
    'The other carrier gets rarer, not commoner: n · p = n_i² stays fixed. With 10¹⁶ electrons, only 10⁴ holes are left. P-type conducts ~3× worse at the same doping because holes are slower.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'type',
      options: [
        { value: 'pure', label: 'Pure' },
        { value: 'n', label: 'N-type (P)' },
        { value: 'p', label: 'P-type (B)' },
      ],
      initial: 'n',
    },
    { kind: 'slider', key: 'dope', label: 'Dopants', min: 10 ** N_MIN, max: 10 ** N_MAX, initial: 1e16, log: true, format: (v: number) => `${sci(v, 2)} /cm³` },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const holder = add(scene, new THREE.Group(), [CX2, CY2, 0])
    let crystal: ReturnType<typeof siliconCrystal> | null = null

    const { plot, dot, y } = ivScreen(scene, S2, 9, 9, [5, 3])
    ticks(plot, [[0, '13'], [0.6, '16'], [1, '18']], [[0, '-6'], [1 / 3, '-3'], [2 / 3, '0'], [1, '3']])
    const ySigma = (sigma: number) => y((Math.log10(sigma) - LOG_S[0]) / (LOG_S[1] - LOG_S[0]))
    const levelAt = (u: number) => 10 ** (N_MIN + u * (N_MAX - N_MIN))
    plot.level(GREY).set(ySigma(conductivity(SILICON.ni300, SILICON.ni300)))
    for (const [kind, color] of [['n', DONOR], ['p', ACCEPTOR]] as const) {
      const t = plot.trace(color, { radius: 0.1 })
      t.draw((u) => ySigma(doped({ type: kind, dope: levelAt(u) }).sigma), null)
    }

    const state = { key: '', u: 0 }
    return {
      scene,
      view: { center: [0.4, 1.8, 0], radius: 53, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const d = doped(p)
        const count = d.kind === 'pure' ? 0 : shownDopants(d.level)
        const key = `${d.kind}${count}`
        if (key !== state.key) {
          state.key = key
          emptyGroup(holder)
          const kind: Dopant = d.kind === 'n' ? 'donor' : 'acceptor'
          crystal = siliconCrystal(holder, { cols: COLS2, rows: ROWS2, pitch: PITCH2, dopants: new Map(DOPE_SITES.slice(0, count).map((s) => [s, kind])) })
        }
        crystal?.step(dt, { pairs: shown(Math.min(d.n, d.p)) })
        state.u += ((Math.log10(d.level) - N_MIN) / (N_MAX - N_MIN) - state.u) * ease(dt, 6)
        dot.position.set(plot.xAt(state.u), ySigma(d.sigma), 0.4)
      },
      readouts: (p) => {
        const d = doped(p)
        return [
          { label: 'Free electrons', value: perCm3(d.n), tone: d.kind === 'n' ? 'ok' : undefined },
          { label: 'Holes', value: perCm3(d.p), tone: d.kind === 'p' ? 'ok' : undefined },
          { label: 'Resistivity', value: ohmCm(1 / d.sigma) },
          { label: 'Dopant share', value: d.kind === 'pure' ? 'None' : `1 in ${si(SI_ATOMS / d.level, '', 2).trim()} atoms` },
        ]
      },
    }
  },
}

// --- Holes and electrons: under a field electrons drift one way, holes the other; both carry the same current. ---

const COLS3 = 8
const ROWS3 = 3
const PITCH3 = 3
const CY3 = 0
const CELL_X = 6.5
const V3_MAX = 5
const DRIFT_PER_V = 1.1 // scene units/s; the real drift is ~1000× slower than the thermal motion
const SAMPLE_M = 1e-3

export const holesAndElectrons: Lesson = {
  id: 'silicon-doping-holes-and-electrons',
  title: 'Holes and electrons',
  tagline: 'Two carriers, opposite ways, one current',
  formula: (p) => {
    const v = driftSpeeds(n(p, 'v'), SAMPLE_M)
    const ni = intrinsicDensity(n(p, 'k'), SILICON)
    return `v = μE: electron ${SILICON.mobilityN} × E = ${si(v.electron, 'm/s', 3)}, hole ${SILICON.mobilityP} × E = ${si(v.hole, 'm/s', 3)} · n = p = ${perCm3(ni)}`
  },
  legend: [
    { color: ELECTRON, label: 'Free electron, drifts to +', shape: 'arrow-left' },
    { color: HOLE, label: 'Hole, drifts to −', shape: 'arrow-right' },
    { color: RING, label: 'One hole followed, and its filler', shape: 'dot' },
    { color: HIGH_V, label: 'Plates by potential', shape: 'dot' },
  ],
  points: [
    'Heat breaks a bond now and then: a free electron (blue) and a hole (red ring) are born together, with a flash. When a free electron meets a hole they cancel again.',
    'A hole isn’t a particle. It is a missing bond electron. When a neighbouring bond electron hops in, the gap moves the other way. Follow the yellow hole: each step is an electron stepping back.',
    'Apply a voltage and free electrons drift toward +. Bond electrons also hop toward +, one gap at a time, so the holes drift toward −, like positive charges.',
    'Both carry current the same way (+ → −). The counters show net carriers crossing the middle line. Holes are slower: μp = 480 vs μn = 1350 cm²/V·s, so in pure silicon electrons carry ~74 %.',
    'Heat makes more pairs: pure silicon conducts better hot, unlike a metal. The drift here is hugely exaggerated; the real one is far slower than the random thermal motion.',
  ],
  controls: [
    { kind: 'slider', key: 'v', label: 'Voltage', min: 0, max: V3_MAX, initial: 2, step: 0.1, format: volts },
    { kind: 'slider', key: 'k', label: 'Temperature', min: 250, max: 500, initial: 300, step: 5, format: kelvinFormat },
  ],
  build(): Stage {
    const scene = createStage({ span: 22 })
    const crystal = siliconCrystal(add(scene, new THREE.Group(), [0, CY3, 0]), { cols: COLS3, rows: ROWS3, pitch: PITCH3, track: true })
    const half = crystal.width / 2
    const plateX = half + 0.7
    const plateH = crystal.height + 0.6
    const plates = [-1, 1].map((s) => {
      const material = new THREE.MeshStandardMaterial({ roughness: 0.4 })
      box(scene, [0.7, plateH, 2.4], material, [s * plateX, CY3, 0])
      return material
    })
    const topY = CY3 + plateH / 2 + 3.2
    wire(scene, [[-plateX, CY3 + plateH / 2, 0], [-plateX, topY, 0], [CELL_X - CELL_H / 2 - 0.4, topY, 0]])
    wire(scene, [[CELL_X + CELL_H / 2, topY, 0], [plateX, topY, 0], [plateX, CY3 + plateH / 2, 0]])
    const battery = add(scene, cell(CELL_H, 1.2), [CELL_X, topY, 0])
    battery.rotation.z = Math.PI / 2

    const line = add(scene, mesh(new THREE.BoxGeometry(0.12, crystal.height, 0.12), glowMat(RING, 0.5)), [0, CY3, 1.6])
    line.castShadow = false
    const labelY = CY3 + crystal.height / 2 + 1.3
    const eCount = pulseLabel(scene, 3, ELECTRON, [-4.5, labelY, 0], 1.1)
    const hCount = pulseLabel(scene, 3, HOLE, [4.5, labelY, 0], 1.1)
    const eArrow = arrow(scene, [-8.6, labelY, 0], [-1, 0, 0], ELECTRON, 0.6)
    const hArrow = arrow(scene, [8.6, labelY, 0], [1, 0, 0], HOLE, 0.6)
    const follow = add(scene, mesh(new THREE.TorusGeometry(0.75, 0.07, 8, 32), glowMat(RING, 0.9)))
    follow.castShadow = false

    const state = { v: 2, k: 300, key: '', t: 0 }
    const at = new THREE.Vector3()
    const c = new THREE.Color()
    return {
      scene,
      view: { center: [0, 2.8, 0], radius: 56, polar: 1.42, azimuth: 0.1 },
      frame(dt, p) {
        const key = `${n(p, 'v')}|${n(p, 'k')}`
        if (key !== state.key) {
          state.key = key
          crystal.net.electrons = crystal.net.holes = 0
        }
        state.t += dt
        state.v += (n(p, 'v') - state.v) * ease(dt, 5)
        state.k += (n(p, 'k') - state.k) * ease(dt, 5)
        const ni = intrinsicDensity(state.k, SILICON)
        crystal.step(dt, { kelvin: state.k, pairs: Math.max(1, shown(ni) + 2), drift: state.v * DRIFT_PER_V, holeRatio: SILICON.mobilityP / SILICON.mobilityN })
        potentialColor(state.v / V3_MAX, c)
        plates[0].color.copy(c)
        plates[0].emissive.copy(c).multiplyScalar(0.4)
        plates[1].color.copy(potentialColor(0, c))
        plates[1].emissive.copy(c).multiplyScalar(0.4)
        eCount.show(String(Math.max(0, crystal.net.electrons)))
        hCount.show(String(Math.max(0, crystal.net.holes)))
        eCount.frame(dt)
        hCount.frame(dt)
        eArrow.visible = hArrow.visible = state.v > 0.05
        const h = crystal.tracked(at)
        follow.visible = !!h
        if (h) follow.position.set(h.x, h.y + CY3, 0.3)
        follow.scale.setScalar(1 + 0.12 * Math.sin(state.t * 6))
      },
      readouts: () => {
        const v = driftSpeeds(state.v < 1e-3 ? 0 : state.v, SAMPLE_M)
        const ni = intrinsicDensity(state.k, SILICON)
        const share = electronShare(ni, ni)
        return [
          { label: 'Electron drift', value: si(v.electron, 'm/s', 3) },
          { label: 'Hole drift', value: si(v.hole, 'm/s', 3) },
          { label: 'Current split', value: `${Math.round(share * 100)} % e⁻ · ${Math.round((1 - share) * 100)} % holes` },
          { label: 'n = p', value: perCm3(ni) },
        ]
      },
    }
  },
}
