import * as THREE from 'three/webgpu'
import { depletionWidth, diodeCurrent, drainCurrent, intrinsicCarriers, MODERN_NMOS } from '../core/physics'
import { sci, si } from '../core/units'
import { V3, add, box, cylinder, mat, mesh, rod } from '../models/kit'
import { createStage } from '../scene/stage'
import { ELECTRON, Flow, HOLE, Swarm, arrow, clamp01, dotSpeed, glowMat, inBox, path, rand, slot } from './fx'
import { Lesson, Stage, n, onChange } from './types'

const signedVolts = (v: number) => `${v > 0 ? '+' : ''}${si(v, 'V', 2)}`
const perCm3 = (v: number) => `${sci(v)} /cm³`
const DOPING = 1e16

function glass(color: string, opacity: number) {
  return new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.3, depthWrite: false })
}

function ghostBox(parent: THREE.Object3D, min: V3, max: V3, material: THREE.Material) {
  const m = box(parent, [max[0] - min[0], max[1] - min[1], max[2] - min[2]], material, [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ])
  m.castShadow = false
  return m
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

// --- Silicon lattice & doping ---

type Doping = 'pure' | 'n' | 'p'

function thermalPairs(kelvin: number) {
  return Math.max(0, Math.min(8, Math.round((Math.log10(intrinsicCarriers(kelvin)) - 6) * 0.8)))
}

function siliconLattice(parent: THREE.Object3D, doping: Doping) {
  const COLS = 7
  const ROWS = 5
  const S = 4
  const atoms: THREE.Vector3[] = []
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) atoms.push(new THREE.Vector3((i - 3) * S, (j - 2) * S, 0))
  const dopants = new Set([COLS * 1 + 1, COLS * 3 + 3, COLS * 1 + 5])

  const bonds: [number, number][] = []
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const a = j * COLS + i
      if (i < COLS - 1) bonds.push([a, a + 1])
      if (j < ROWS - 1) bonds.push([a, a + COLS])
    }
  }
  const neighbors = bonds.map(([a, b]) => bonds.flatMap(([c, d], k) => ((c === a || d === a || c === b || d === b) && !(c === a && d === b) ? [k] : [])))

  const atomColor = doping === 'n' ? '#4cd07d' : '#ff6fb0'
  atoms.forEach((p, i) => {
    const doped = doping !== 'pure' && dopants.has(i)
    add(parent, mesh(new THREE.SphereGeometry(1.05, 24, 16), mat(doped ? atomColor : '#9aa3ad', { rough: 0.45 })), p.toArray() as V3)
  })
  const bondMat = mat('#5d636e')
  bonds.forEach(([a, b]) => rod(parent, atoms[a].toArray() as V3, atoms[b].toArray() as V3, 0.12, bondMat, 8))

  // Two shared electrons per bond, side by side.
  const dots: THREE.Vector3[] = []
  bonds.forEach(([a, b]) => {
    const mid = atoms[a].clone().add(atoms[b]).multiplyScalar(0.5)
    const along = atoms[b].clone().sub(atoms[a]).normalize()
    const side = new THREE.Vector3(-along.y, along.x, 0).multiplyScalar(0.4)
    dots.push(mid.clone().add(side), mid.clone().sub(side))
  })
  const dotMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.26, 10, 8), glowMat(ELECTRON, 0.5), dots.length)
  parent.add(dotMesh)

  const MAX = 24
  const holeMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(0.32, 0.1, 8, 20), glowMat(HOLE, 1), MAX)
  holeMesh.frustumCulled = false
  parent.add(holeMesh)
  const free = new Swarm(new THREE.SphereGeometry(0.34, 12, 8), glowMat(ELECTRON, 1.1), MAX, (p) => p.set(rand(-12, 12), rand(-8, 8), rand(-0.5, 0.5)))
  parent.add(free.mesh)

  interface Hole {
    dot: number
    hopIn: number
    life: number // Infinity for acceptor holes
  }
  const holes: Hole[] = []
  const takenDots = () => new Set(holes.map((h) => h.dot))
  const freeDot = () => {
    const taken = takenDots()
    let d = 0
    do d = Math.floor(Math.random() * dots.length)
    while (taken.has(d))
    return d
  }
  const nearDot = (atom: number) => {
    const b = bonds.findIndex(([a, c]) => a === atom || c === atom)
    return b * 2
  }
  let donorElectrons = 0
  if (doping === 'p') [...dopants].forEach((a) => holes.push({ dot: nearDot(a), hopIn: rand(0.3, 1), life: Infinity }))
  if (doping === 'n') donorElectrons = dopants.size

  return {
    step(dt: number, kelvin: number) {
      const target = doping === 'pure' ? thermalPairs(kelvin) : Math.round(thermalPairs(kelvin) / 3)
      const thermal = holes.filter((h) => h.life !== Infinity)
      if (thermal.length < target) holes.push({ dot: freeDot(), hopIn: rand(0.3, 1), life: rand(2, 5) })
      if (thermal.length > target) holes.splice(holes.indexOf(thermal[0]), 1)

      for (const h of holes) {
        h.life -= dt
        h.hopIn -= dt
        if (h.life <= 0) {
          h.dot = freeDot()
          h.life = rand(2, 5)
        } else if (h.hopIn <= 0) {
          // A neighbor's bond electron jumps in; the hole moves the other way.
          const taken = takenDots()
          const options = neighbors[Math.floor(h.dot / 2)].flatMap((b) => [b * 2, b * 2 + 1]).filter((d) => !taken.has(d))
          if (options.length) h.dot = options[Math.floor(Math.random() * options.length)]
          h.hopIn = rand(0.4, 1.1) * (300 / kelvin)
        }
      }

      const m = new THREE.Matrix4()
      const taken = takenDots()
      dots.forEach((d, i) => dotMesh.setMatrixAt(i, taken.has(i) ? HIDDEN : m.makeTranslation(d)))
      dotMesh.instanceMatrix.needsUpdate = true
      holes.forEach((h, i) => holeMesh.setMatrixAt(i, m.makeTranslation(dots[h.dot])))
      holeMesh.count = holes.length
      holeMesh.instanceMatrix.needsUpdate = true

      free.mesh.count = Math.min(MAX, holes.filter((h) => h.life !== Infinity).length + donorElectrons)
      free.update(dt, { thermal: 2 + kelvin / 100, contain: (p, v) => inBox(p, v, [-13, -9, -0.6], [13, 9, 0.6]) })
    },
  }
}

const doping: Lesson = {
  id: 'doping',
  title: 'Silicon & doping',
  tagline: 'Turning an insulator into a semiconductor',
  formula: 'n · p = nᵢ²',
  points: [
    'Silicon has 4 outer electrons. Each pairs up in a bond with a neighbor (blue pairs). Electrons locked in bonds can’t carry current.',
    'Heat shakes a few loose. Each frees an electron and leaves a hole (red ring). A neighbor’s electron can hop into the hole, so holes move too, like a + charge.',
    'n-type: a few phosphorus atoms (green, 5 outer electrons). The spare one is free to roam.',
    'p-type: boron (pink, 3 outer electrons) leaves a bond one short, a hole.',
    'About 1 dopant per 5 million silicon atoms raises conductivity roughly a million times.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'doping',
      initial: 'pure',
      options: [
        { value: 'pure', label: 'Pure' },
        { value: 'n', label: 'n-type (P)' },
        { value: 'p', label: 'p-type (B)' },
      ],
    },
    { kind: 'slider', key: 'k', label: 'Temperature', min: 200, max: 500, initial: 300, step: 5, format: (v) => `${Math.round(v)} K · ${Math.round(v - 273)} °C` },
  ],
  build(): Stage {
    const scene = createStage({ span: 20 })
    const next = slot(scene)
    let lattice: ReturnType<typeof siliconLattice> | null = null
    const rebuild = onChange(['doping'], (p) => (lattice = siliconLattice(next(), p.doping as Doping)))
    return {
      scene,
      view: { center: [0, 0, 0], radius: 34, polar: 1.35, azimuth: 0.25 },
      frame(dt, p) {
        rebuild(p)
        lattice?.step(dt, n(p, 'k'))
      },
      readouts: (p) => {
        const ni = intrinsicCarriers(n(p, 'k'))
        const [e, h] = p.doping === 'n' ? [DOPING, (ni * ni) / DOPING] : p.doping === 'p' ? [(ni * ni) / DOPING, DOPING] : [ni, ni]
        return [
          { label: 'Free electrons', value: perCm3(e) },
          { label: 'Holes', value: perCm3(h) },
          { label: 'Silicon atoms', value: perCm3(5e22) },
        ]
      },
    }
  },
}

// --- PN junction ---

const junction: Lesson = {
  id: 'junction',
  title: 'PN junction',
  tagline: 'How a diode works inside',
  formula: 'I = I_s · (e^(V / V_T) − 1)',
  points: [
    'Join p-type (holes, red) and n-type (electrons, blue). At the boundary they meet and cancel, leaving a depletion region with no free carriers.',
    'What remains there are fixed charged atoms (cubes): − on the p side, + on the n side. They create an electric field (yellow) and a ~0.7 V barrier.',
    'Reverse bias pulls carriers away and widens the barrier: almost no current.',
    'Forward bias above ~0.6 V collapses it. Carriers pour across and recombine, and current rises ~10× per 60 mV. In an LED, each recombination gives off light.',
    'Region widths are scaled to fit; the real one is under a micrometre.',
  ],
  controls: [{ kind: 'slider', key: 'v', label: 'Bias', min: -3, max: 0.8, initial: 0, step: 0.02, format: signedVolts }],
  build(): Stage {
    const scene = createStage({ span: 22, deskY: -7 })
    const X = 14
    const Y = 4
    ghostBox(scene, [-X, -Y, -Y], [0, Y, Y], glass('#ff7a6a', 0.12))
    ghostBox(scene, [0, -Y, -Y], [X, Y, Y], glass('#6a9dff', 0.12))
    const depletion = ghostBox(scene, [-0.5, -Y - 0.05, -Y - 0.05], [0.5, Y + 0.05, Y + 0.05], glass('#ffffff', 0.12))
    const contacts = [-1, 1].map((s) => {
      const material = mat('#b9bec6', { metal: 0.4, rough: 0.35 })
      box(scene, [0.5, Y * 2 + 0.6, Y * 2 + 0.6], material, [s * (X + 0.3), 0, 0])
      return material
    })

    const ionPos: THREE.Vector3[] = []
    for (let x = -X + 0.75; x < X; x += 1.5) for (const y of [-2.7, 0, 2.7]) for (const z of [-2.7, 0, 2.7]) ionPos.push(new THREE.Vector3(x, y, z))
    const ions = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat('#ffffff', { rough: 0.6 }), ionPos.length)
    ionPos.forEach((p, i) => ions.setColorAt(i, new THREE.Color(p.x < 0 ? '#3b5fae' : '#ae4a3b')))
    scene.add(ions)

    const N = 40
    const holes = new Swarm(new THREE.TorusGeometry(0.32, 0.11, 8, 18), glowMat(HOLE, 1), N, (p) => p.set(rand(-X, -1), rand(-Y, Y), rand(-Y, Y)))
    const electrons = new Swarm(new THREE.SphereGeometry(0.3, 12, 8), glowMat(ELECTRON, 1), N, (p) => p.set(rand(1, X), rand(-Y, Y), rand(-Y, Y)))
    scene.add(holes.mesh, electrons.mesh)
    const injected = { h: new Array(N).fill(false), e: new Array(N).fill(false) }
    const field = arrow(scene, [0, Y + 2, 0], [-1, 0, 0], '#ffd84d', 1.2)
    const w0 = depletionWidth(DOPING, DOPING, 0)
    const m = new THREE.Matrix4()

    return {
      scene,
      view: { center: [0, 0, 0], radius: 40, polar: 1.15, azimuth: 0.45 },
      frame(dt, p) {
        const v = n(p, 'v')
        const half = Math.min(13, Math.max(0.15, (3 * depletionWidth(DOPING, DOPING, v)) / w0))
        depletion.scale.x = half * 2
        ionPos.forEach((q, i) => ions.setMatrixAt(i, Math.abs(q.x) < half ? m.makeTranslation(q) : HIDDEN))
        ions.instanceMatrix.needsUpdate = true
        const rate = v > 0 ? clamp01(Math.log10(Math.max(diodeCurrent(v), 1e-12) / 1e-9) / 6) : 0
        const barrier = Math.max(0, half / 3)
        field.scale.setScalar(Math.min(1.6, barrier))
        field.visible = barrier > 0.08
        contacts[0].color.set(v > 0 ? '#ff7a6a' : v < 0 ? '#6a9dff' : '#b9bec6')
        contacts[1].color.set(v > 0 ? '#6a9dff' : v < 0 ? '#ff7a6a' : '#b9bec6')

        const wall = (side: -1 | 1, flags: boolean[]) => (q: THREE.Vector3, vel: THREE.Vector3, i: number) => {
          inBox(q, vel, [-X, -Y + 0.3, -Y + 0.3], [X, Y - 0.3, Y - 0.3])
          const depth = side * q.x // > 0 inside own region
          if (flags[i]) {
            if (depth < -half - 2.5) {
              flags[i] = false // recombined: a fresh carrier enters from the contact
              q.x = side * (X - rand(0, 1.5))
            }
          } else if (depth < half) {
            if (rate > 0.05 && Math.random() < rate) flags[i] = true
            else {
              q.x = side * half
              vel.x = side * Math.abs(vel.x)
            }
          }
        }
        holes.update(dt, { thermal: 3, drift: [rate * 7, 0, 0], contain: wall(-1, injected.h) })
        electrons.update(dt, { thermal: 3, drift: [-rate * 7, 0, 0], contain: wall(1, injected.e) })
      },
      readouts: (p) => {
        const v = n(p, 'v')
        const i = diodeCurrent(v)
        return [
          { label: 'Bias', value: signedVolts(v) },
          { label: 'Depletion width', value: si(depletionWidth(DOPING, DOPING, v), 'm', 2) },
          { label: 'Current', value: si(i, 'A', 2), tone: i > 1e-6 ? 'ok' : undefined },
          { label: 'State', value: i > 1e-6 ? 'Conducting' : 'Blocking' },
        ]
      },
    }
  },
}

// --- MOSFET ---

const onness = (vg: number) => clamp01((vg - MODERN_NMOS.vthV) / 0.4)

const mosfet: Lesson = {
  id: 'mosfet',
  title: 'Transistor (MOSFET)',
  tagline: 'A switch with no moving parts',
  formula: 'I_D ≈ ½ k (V_GS − V_th)²',
  points: [
    'Three terminals: source (blue cap, left), drain (orange cap, right) and gate (yellow cap, top). The body is p-type silicon with n-type wells under source and drain.',
    'The gate sits on a very thin insulator and never touches the silicon. Its voltage acts through the insulator as a field.',
    'Positive gate voltage pushes holes (red) down and pulls electrons up into a thin n-type channel (glowing).',
    'Above the threshold (~0.35 V here) the channel joins source to drain and current flows: on, a 1. Below it, only a tiny leak: off, a 0.',
    'A chip is billions of these switching billions of times a second.',
  ],
  controls: [{ kind: 'slider', key: 'vg', label: 'Gate voltage', min: 0, max: 1, initial: 0, step: 0.01, format: (v) => si(v, 'V', 2) }],
  build(): Stage {
    const scene = createStage({ span: 20, deskY: -8.5 })
    ghostBox(scene, [-12, -8, -5], [12, 0, 5], glass('#c98a7a', 0.22))
    ghostBox(scene, [-12, -3, -5], [-5, 0, 5], glass('#5b8dff', 0.35))
    ghostBox(scene, [5, -3, -5], [12, 0, 5], glass('#5b8dff', 0.35))
    ghostBox(scene, [-5.5, 0, -5], [5.5, 0.45, 5], glass('#ffffff', 0.45))
    box(scene, [10, 2, 10], mat('#7f8590', { metal: 0.35, rough: 0.4 }), [0, 1.45, 0])
    const pillar = mat('#b9bec6', { metal: 0.4, rough: 0.35 })
    const terminals: [number, number, string][] = [
      [-8.5, 0, '#4d8dff'],
      [8.5, 0, '#ff9a2e'],
      [0, 2.45, '#ffd84d'],
    ]
    for (const [x, y, color] of terminals) {
      cylinder(scene, 0.7, 4, pillar, [x, y + 2, 0], 'y', 16)
      cylinder(scene, 0.95, 0.5, glowMat(color, 0.6), [x, y + 4.2, 0], 'y', 20)
    }
    const channelMat = new THREE.MeshStandardMaterial({ color: ELECTRON, emissive: ELECTRON, emissiveIntensity: 1, transparent: true, opacity: 0, depthWrite: false })
    ghostBox(scene, [-5, -0.45, -4.6], [5, -0.02, 4.6], channelMat)

    const wells = [-1, 1].map((s) => {
      const sw = new Swarm(new THREE.SphereGeometry(0.22, 10, 8), glowMat(ELECTRON, 1), 22, (p) => p.set(s * rand(5.5, 11.5), rand(-2.7, -0.3), rand(-4.5, 4.5)))
      scene.add(sw.mesh)
      return { s, sw }
    })
    const holes = new Swarm(new THREE.TorusGeometry(0.25, 0.08, 8, 16), glowMat(HOLE, 1), 45, (p) => p.set(rand(-11.5, 11.5), rand(-7.5, -3.5), rand(-4.5, 4.5)))
    scene.add(holes.mesh)
    const lanes = [-3, 0, 3].map((z) => {
      const f = new Flow(path([[-9, -1.5, z], [-5, -0.25, z], [5, -0.25, z], [9, -1.5, z]]), 1.2, ELECTRON, 0.24)
      scene.add(f.mesh)
      return f
    })

    return {
      scene,
      view: { center: [0, -1, 0], radius: 36, polar: 1.2, azimuth: 0.55 },
      frame(dt, p) {
        const vg = n(p, 'vg')
        const on = onness(vg)
        channelMat.opacity = 0.75 * on
        const speed = dotSpeed(drainCurrent(vg), 1.5e-4, 10)
        lanes.forEach((f) => {
          f.mesh.visible = on > 0.02
          f.step(dt * speed)
        })
        wells.forEach(({ s, sw }) =>
          sw.update(dt, { thermal: 2.5, contain: (q, v) => inBox(q, v, s < 0 ? [-11.6, -2.8, -4.6] : [5.4, -2.8, -4.6], s < 0 ? [-5.4, -0.3, 4.6] : [11.6, -0.3, 4.6]) }),
        )
        const ceiling = -0.6 - 2.6 * clamp01(vg)
        holes.update(dt, {
          thermal: 2.5,
          contain: (q, v) => {
            inBox(q, v, [-11.6, -7.6, -4.6], [11.6, -0.3, 4.6])
            const top = Math.abs(q.x) < 5.5 ? ceiling : -3.3
            if (q.y > top) {
              q.y = top
              v.y = -Math.abs(v.y)
            }
          },
        })
      },
      readouts: (p) => {
        const vg = n(p, 'vg')
        const on = vg > MODERN_NMOS.vthV
        return [
          { label: 'Gate voltage', value: si(vg, 'V', 2) },
          { label: 'Drain current', value: si(drainCurrent(vg), 'A', 2) },
          { label: 'State', value: on ? 'On (1)' : 'Off (0)', tone: on ? 'ok' : undefined },
          { label: 'Leak when off', value: si(drainCurrent(0), 'A', 2) },
        ]
      },
    }
  },
}

// --- 3 nm-class transistor, 1 unit = 1 nm ---

type Arch = 'finfet' | 'gaa'

const SI_ATOM_SPACING = 0.235 // nm, nearest-neighbor distance in silicon

function nanoTransistor(parent: THREE.Object3D, arch: Arch) {
  ghostBox(parent, [-70, -14, -30], [70, 0, 30], mat('#6f7782', { rough: 0.6 }))
  ghostBox(parent, [-70, 0, -30], [70, 12, 30], glass('#cfe3ff', 0.22))
  const silicon = mat('#a7b0bb', { rough: 0.4 })
  const glow = new THREE.MeshStandardMaterial({ color: ELECTRON, emissive: ELECTRON, emissiveIntensity: 1, transparent: true, opacity: 0, depthWrite: false })
  const lanes: Flow[] = []
  const lane = (y: number, z: number) => {
    const f = new Flow(path([[-24, y, z], [24, y, z]]), 2.6, ELECTRON, 0.9)
    parent.add(f.mesh)
    lanes.push(f)
  }

  let atomsAt: { from: V3; dir: V3; count: number }
  if (arch === 'finfet') {
    for (const z of [-13, 13]) {
      box(parent, [140, 50, 6], silicon, [0, 25, z])
      ghostBox(parent, [-8, 12, z - 3.2], [8, 50.2, z + 3.2], glow)
      lane(38, z)
      lane(24, z)
    }
    atomsAt = { from: [-37, 50.15, 10], dir: [0, 0, 1], count: Math.round(6 / SI_ATOM_SPACING) + 1 }
  } else {
    box(parent, [140, 12, 30], mat('#6f7782', { rough: 0.6 }), [0, 6, 0])
    for (const y of [20, 32, 44]) {
      box(parent, [120, 5, 30], silicon, [0, y, 0])
      ghostBox(parent, [-8, y - 2.6, -15.2], [8, y + 2.6, 15.2], glow)
      lane(y, -7)
      lane(y, 7)
    }
    atomsAt = { from: [-37, 41.5, 15.15], dir: [0, 1, 0], count: Math.round(5 / SI_ATOM_SPACING) + 1 }
  }

  // Gates every 48 nm (contacted gate pitch); only the middle one switches.
  const gateMat = glass('#d9a441', 0.38)
  const activeGate = glass('#ffcc4d', 0.42)
  for (const x of [-48, 0, 48]) ghostBox(parent, [x - 8, 12, -28], [x + 8, 62, 28], x === 0 ? activeGate : gateMat)
  const epi = glass('#4d7dff', 0.45)
  const contact = mat('#8d939c', { metal: 0.4, rough: 0.35 })
  for (const x of [-24, 24]) {
    ghostBox(parent, [x - 10, 12, -24], [x + 10, 56, 24], epi)
    box(parent, [14, 14, 44], contact, [x, 63, 0])
  }

  // A row of single silicon atoms for scale: pinch in to see them.
  const atoms = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 10, 8), glowMat('#e8ecf2', 0.4), atomsAt.count)
  const m = new THREE.Matrix4()
  for (let i = 0; i < atomsAt.count; i++) {
    const d = i * SI_ATOM_SPACING
    atoms.setMatrixAt(i, m.makeTranslation(atomsAt.from[0] + atomsAt.dir[0] * d, atomsAt.from[1] + atomsAt.dir[1] * d, atomsAt.from[2] + atomsAt.dir[2] * d))
  }
  parent.add(atoms)

  return {
    step(dt: number, vg: number) {
      const on = onness(vg)
      glow.opacity = 0.8 * on
      activeGate.emissive.set('#ffcc4d')
      activeGate.emissiveIntensity = 0.4 * clamp01(vg / 0.75)
      const speed = dotSpeed(drainCurrent(vg), 1.5e-4, 30)
      lanes.forEach((f) => {
        f.mesh.visible = on > 0.02
        f.step(dt * speed)
      })
    },
  }
}

const nano: Lesson = {
  id: 'nano',
  title: '3 nm chips',
  tagline: 'Transistors counted in atoms',
  formula: (p) => (p.arch === 'finfet' ? 'FinFET: gate on 3 sides' : 'GAA: gate on all 4 sides'),
  points: [
    '“3 nm” is a generation name, not a measured length. Here 1 unit is 1 real nanometre: gates repeat every ~48 nm, about 200 silicon atoms apart.',
    'FinFET: each channel is a thin vertical fin and the gate wraps 3 sides, so it can shut the channel off much harder than a flat transistor.',
    'Gate-all-around: stacked nanosheets with the gate on all 4 sides. Used by Samsung’s 3 nm and TSMC’s N2, after TSMC’s 3 nm FinFETs.',
    'A ~5 nm sheet is only ~20 atoms thick. Pinch in on the left edge of the top fin or sheet: those dots are single silicon atoms.',
    'Apple’s A17 Pro (3 nm) holds ~19 billion transistors, around 200–300 million per mm².',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'arch',
      initial: 'finfet',
      options: [
        { value: 'finfet', label: 'FinFET' },
        { value: 'gaa', label: 'Gate-all-around' },
      ],
    },
    { kind: 'slider', key: 'vg', label: 'Gate voltage', min: 0, max: 0.75, initial: 0, step: 0.01, format: (v) => si(v, 'V', 2) },
  ],
  build(): Stage {
    const scene = createStage({ span: 90 })
    const next = slot(scene)
    let device: ReturnType<typeof nanoTransistor> | null = null
    const rebuild = onChange(['arch'], (p) => (device = nanoTransistor(next(), p.arch as Arch)))
    return {
      scene,
      view: { center: [0, 25, 0], radius: 150, polar: 1.1, azimuth: 0.65 },
      frame(dt, p) {
        rebuild(p)
        device?.step(dt, n(p, 'vg'))
      },
      readouts: (p) => {
        const vg = n(p, 'vg')
        const on = vg > MODERN_NMOS.vthV
        return [
          { label: 'Gate pitch', value: '≈ 48 nm' },
          { label: p.arch === 'finfet' ? 'Fin width' : 'Sheet thickness', value: p.arch === 'finfet' ? '≈ 6 nm ≈ 25 atoms' : '≈ 5 nm ≈ 20 atoms' },
          { label: 'Drain current', value: si(drainCurrent(vg), 'A', 2) },
          { label: 'State', value: on ? 'On (1)' : 'Off (0)', tone: on ? 'ok' : undefined },
        ]
      },
    }
  },
}

export const SEMICONDUCTORS: Lesson[] = [doping, junction, mosfet, nano]
