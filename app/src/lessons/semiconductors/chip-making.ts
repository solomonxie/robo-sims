import * as THREE from 'three/webgpu'
import {
  FIELD_MM,
  K1,
  MASK_REDUCTION,
  NODES,
  Node,
  SCANNERS,
  Scanner,
  WAFER_MM,
  WAFER_USD,
  atomsAcross,
  costPerGoodDie,
  defectCount,
  defectSpots,
  gatesAcrossHair,
  halfPitch,
  killedDies,
  nand2Density,
  opticsThroughput,
  photonEv,
  poissonYield,
  waferGrid,
} from '../../core/physics'
import { fitDigits, si } from '../../core/units'
import { V3, add, box, cylinder, lathe, mat, mesh, rod } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CONVENTIONAL,
  COPPER,
  ELECTRON,
  Flow,
  GREY,
  HIGH_V,
  POWER,
  RING,
  clamp01,
  ease,
  emptyGroup,
  glowMat,
  lerp,
  path,
  presence,
  pulseLabel,
  storyClock,
  storySlider,
} from '../fx'
import { Lesson, Params, Stage, n } from '../types'

const UV = '#a46bff'
const LASER = '#ff3b2f'
const RESIST = '#6a4f8f'
const glass = (color: string, opacity: number) =>
  new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.15, depthWrite: false, side: THREE.DoubleSide })
const percent = (f: number) => `${fitDigits(f * 100, 3)} %`
const nm = (v: number) => si(v * 1e-9, 'm', 3)

// --- Lithography machine: light from a tin plasma, bounced off 11 mirrors, prints a mask 4× smaller on a scanning wafer. ---

type Tool = keyof typeof SCANNERS
const LITHO_STEPS = ['Light', 'Shape', 'Mask', 'Shrink 4×', 'Scan'] as const
const SOURCE: V3 = [-14, -3, 0]
const RETICLE_Y = 8.6
const WAFER_AT: V3 = [2, -6, 0]
const WAFER_R = 3.2
const MM = WAFER_R / (WAFER_MM / 2)
const FIELD = { x: FIELD_MM.h * MM, z: FIELD_MM.w * MM }
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)
const rowDir = (z: number) => (Math.round(z / FIELD.z - 0.5) % 2 ? -1 : 1)

interface Optic {
  at: V3
  kind: 'source' | 'collector' | 'focus' | 'mirror' | 'mask' | 'lens' | 'wafer'
  /** Story step that lights the beam into this optic. */
  step: number
}

const optic = (x: number, y: number, kind: Optic['kind'], step: number): Optic => ({ at: [x, y, 0], kind, step })

/** Beam path from the source to the wafer: EUV folds through 11 mirrors (the mask is one), DUV runs through lenses. */
function train(tool: Tool): Optic[] {
  const end = optic(WAFER_AT[0], WAFER_AT[1] + 0.1, 'wafer', 3)
  if (tool === 'duv')
    return [
      optic(SOURCE[0] + 2.6, SOURCE[1], 'source', 0),
      optic(-9.5, -3, 'lens', 0),
      optic(-6, -3, 'mirror', 1),
      optic(-6, 10.6, 'mirror', 1),
      optic(2, 10.6, 'mirror', 1),
      optic(2, RETICLE_Y, 'mask', 2),
      ...[6, 4.2, 2.4, 0.6, -1.2, -3].map((y) => optic(2, y, 'lens', 3)),
      end,
    ]
  return [
    optic(SOURCE[0], SOURCE[1], 'source', 0),
    optic(SOURCE[0] - 2.6, SOURCE[1], 'collector', 0),
    optic(-10, -0.6, 'focus', 0),
    optic(-7.2, -3.6, 'mirror', 1),
    optic(-5.2, 4.2, 'mirror', 1),
    optic(-3, 7, 'mirror', 1),
    optic(2, RETICLE_Y - 0.2, 'mask', 2),
    optic(5, 4.8, 'mirror', 3),
    optic(-0.6, 3.4, 'mirror', 3),
    optic(5, 1.6, 'mirror', 3),
    optic(-0.6, 0, 'mirror', 3),
    optic(4.6, -1.8, 'mirror', 3),
    optic(0.8, -3.2, 'mirror', 3),
    end,
  ]
}

/** Builds the optics and beam for `tool` into `g`; the returned beam lights segment by segment as the story reaches it. */
function opticsFor(g: THREE.Group, tool: Tool) {
  const s: Scanner = SCANNERS[tool]
  const optics = train(tool)
  const mirror = mat('#8f96c8', { metal: 0.3, rough: 0.25 })
  const lens = glass('#cfe3ff', 0.35)
  const v = (p: V3) => new THREE.Vector3(...p)
  let left = 1
  const beams = optics.slice(1).map((to, i) => {
    const from = optics[i]
    if (from.kind === 'mirror' || from.kind === 'collector' || (from.kind === 'mask' && tool !== 'duv')) left *= s.reflectance
    const f = new Flow(path([from.at, to.at]), 0.7 / Math.sqrt(left), UV, 0.12 + 0.12 * Math.sqrt(left))
    g.add(f.mesh)
    return { flow: f, step: to.step }
  })
  optics.forEach((p, i) => {
    if (p.kind === 'mirror') {
      const into = v(optics[i - 1].at).sub(v(p.at)).normalize()
      const out = v(optics[i + 1].at).sub(v(p.at)).normalize()
      box(g, [2, 0.22, 2.4], mirror, p.at).quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), into.add(out).normalize())
    }
    if (p.kind === 'lens') {
      const disc = add(g, mesh(new THREE.SphereGeometry(1, 24, 12), lens), p.at)
      disc.scale.set(1.5, 0.28, 1.5)
      if (p.at[1] === optics[i + 1].at[1]) disc.rotation.z = Math.PI / 2
    }
  })
  if (tool === 'duv') cylinder(g, 1.1, 0.12, glass('#6fb6ff', 0.5), [WAFER_AT[0], WAFER_AT[1] + 0.32, 0])
  const perStep = (k: number) => beams.filter((b) => b.step === k).length
  return {
    frame(dt: number, done: (k: number) => number) {
      const seen: number[] = []
      for (const b of beams) {
        const i = (seen[b.step] = (seen[b.step] ?? 0) + 1)
        b.flow.mesh.visible = done(b.step) * 1.6 >= i / perStep(b.step) || done(b.step) === 1
        b.flow.step(dt * 7)
      }
    },
  }
}

/** Tin droplets falling past the laser: a pre-pulse flattens each, the main pulse turns it into a glowing plasma. */
function tinSource(scene: THREE.Object3D) {
  const g = add(scene, new THREE.Group(), SOURCE)
  add(g, mesh(new THREE.SphereGeometry(3.4, 32, 20), glass('#cfd8e8', 0.1)), [-0.6, 0, 0])
  lathe(g, [[0.25, 0], [1.2, -0.25], [2, -0.8], [2.5, -1.5]], new THREE.MeshStandardMaterial({ color: '#b8a4e8', metalness: 0.3, roughness: 0.25, side: THREE.DoubleSide }), [-2.6, 0, 0], 'x', 40)
  cylinder(g, 0.35, 1, mat('#5b606b', { rough: 0.5 }), [0, 3.6, 0])
  box(g, [3, 1.6, 1.6], mat('#3b2a2a', { rough: 0.5 }), [-7.4, 0, 0])
  const beamMat = new THREE.MeshBasicMaterial({ color: LASER, transparent: true, opacity: 0 })
  const beam = cylinder(g, 0.12, 5.9, beamMat, [-2.95, 0, 0], 'x')
  beam.castShadow = false
  const DROPS = 8
  const drops = Array.from({ length: DROPS }, (_, i) => add(g, mesh(new THREE.SphereGeometry(0.16, 12, 8), mat('#d4d7dc', { metal: 0.45, rough: 0.35 })), [0, 3 - i * 0.5, 0]))
  const plasma = add(g, mesh(new THREE.SphereGeometry(0.5, 20, 14), glowMat('#e6d4ff', 2)))
  plasma.castShadow = false
  const state = { phase: 0, flash: 0 }
  return {
    group: g,
    frame(dt: number) {
      const before = state.phase
      state.phase = (state.phase + dt * 0.9) % 1
      if (state.phase < before) state.flash = 1
      state.flash = Math.max(0, state.flash - dt * 4)
      drops.forEach((d, i) => {
        const y = 3 - ((i + state.phase) / DROPS) * 3 * (DROPS / 4)
        const squash = clamp01((0.6 - Math.abs(y)) / 0.6)
        d.position.y = y
        d.visible = y > 0
        d.scale.set(1 + squash * 1.4, 1 - squash * 0.7, 1 + squash * 1.4)
      })
      beamMat.opacity = 0.25 + 0.75 * state.flash
      presence(plasma, 0.2 + state.flash)
    },
  }
}

const scanner1 = (p: Params) => SCANNERS[p.tool as Tool]

export const lithographyMachine: Lesson = {
  id: 'chip-making-lithography-machine',
  title: 'Lithography machine',
  tagline: 'Printing with light 10 000× finer than a hair',
  formula: (p) => {
    const s = scanner1(p)
    return `Half-pitch = k1·λ/NA = ${K1} × ${s.nm} nm / ${s.na} = ${nm(halfPitch(s.nm, s.na))} · ${s.reflectance}^${s.mirrors} mirrors → ${percent(opticsThroughput(s))} reaches the wafer`
  },
  legend: [
    { color: UV, label: 'UV light, thinner after each mirror', shape: 'arrow-right' },
    { color: LASER, label: 'CO₂ laser hits a tin droplet', shape: 'dot' },
    { color: RING, label: 'Mask pattern, printed 4× smaller', shape: 'dot' },
    { color: GREY, label: 'λ nm; light % and half-pitch nm', shape: 'dot' },
  ],
  points: [
    'A scanner copies a chip layer from a mask onto a wafer coated with light-sensitive resist, 4× smaller, one 26 × 33 mm field at a time. A modern chip needs 60–100 layers.',
    'The finest line it can print scales with the wavelength: half-pitch = k1·λ/NA, with k1 ≈ 0.3 in practice (0.25 is the limit). Deep-UV scanners use a 193 nm ArF laser and a film of water under the last lens (NA 1.35): ~40 nm lines, finer only by exposing a layer 2–4 times.',
    'EUV light (13.5 nm) is made by hitting ~50 000 tin droplets a second with a CO₂ laser: a pre-pulse flattens each one, the main pulse turns it into a plasma hotter than the Sun’s surface that glows at 13.5 nm (invisible; drawn violet). Slowed ~50 000× here.',
    'Everything absorbs EUV, even air and glass. So the machine is a vacuum and every lens is a mirror of ~100 alternating molybdenum and silicon layers, each reflecting ~70 %. After 11 bounces about 2 % reaches the wafer: hence a 20 kW laser for a few hundred watts of light.',
    'Scan: mask and wafer sweep in opposite directions under a slit of light, the mask 4× faster, both placed to under a nanometre; a 300 mm wafer’s ~90 fields take seconds. High-NA EUV (NA 0.55) prints ~8 nm.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'tool',
      options: [
        { value: 'duv', label: 'DUV 193 nm' },
        { value: 'euv', label: 'EUV' },
        { value: 'highNa', label: 'High-NA EUV' },
      ],
      initial: 'euv',
    },
    storySlider(LITHO_STEPS),
  ],
  build(): Stage {
    const scene = createStage({ span: 26 })
    box(scene, [30, 0.6, 8], mat('#2b2e36', { rough: 0.85 }), [-6.5, -7.6, 0])
    const tin = tinSource(scene)
    const excimer = add(scene, new THREE.Group(), SOURCE)
    box(excimer, [5, 2, 2], mat('#3a3f4a', { rough: 0.5 }), [0, 0, 0])
    const window1 = box(excimer, [0.2, 1.1, 1.1], glowMat(UV, 0.4), [2.55, 0, 0])

    const reticle = add(scene, new THREE.Group(), [2, RETICLE_Y, 0])
    box(reticle, [3.4, 0.3, 3.4], mat('#c9ced8', { rough: 0.3 }), [0, 0.15, 0])
    const stripeMat = glowMat(RING, 0.3)
    for (let i = 0; i < 9; i++) box(reticle, [0.14, 0.06, 2.2], stripeMat, [-1.4 + i * 0.35, 0.33, 0])
    box(scene, [12, 0.4, 4], mat('#3a3d45', { rough: 0.6 }), [2, RETICLE_Y + 1.1 + 0.9, 0])

    const stage = add(scene, new THREE.Group(), [WAFER_AT[0], WAFER_AT[1] - 0.6, 0])
    box(stage, [9, 0.8, 7.4], mat('#4a4e58', { rough: 0.6 }), [0, -0.6, 0])
    const chuck = add(stage, new THREE.Group())
    cylinder(chuck, WAFER_R, 0.14, mat('#9aa0b8', { metal: 0.3, rough: 0.3 }), [0, 0.37, 0], 'y', 64)
    cylinder(chuck, WAFER_R - 0.06, 0.02, mat(RESIST, { rough: 0.4 }), [0, 0.45, 0], 'y', 64)
    const fields = waferGrid(WAFER_MM, FIELD_MM.h, FIELD_MM.w, 3, 'touch')
      .map((c) => ({ x: c.x * MM, z: c.y * MM }))
      .sort((a, b) => a.z - b.z || (a.x - b.x) * rowDir(a.z))
    const dies = fields.flatMap((c, field) =>
      [0, 1, 2].flatMap((col) =>
        [-0.25, 0.25].map((dz) => ({ field, col, x: c.x + ((col - 1) / 3) * FIELD.x, z: c.z + dz * FIELD.z })),
      ),
    ).filter((d) => Math.hypot(d.x, d.z) < WAFER_R - 0.15)
    const exposed = new THREE.InstancedMesh(new THREE.BoxGeometry(FIELD.x / 3 - 0.04, 0.03, FIELD.z / 2 - 0.04), glowMat(UV, 0.6), dies.length)
    exposed.frustumCulled = false
    chuck.add(exposed)
    const slit = box(scene, [0.2, 0.05, FIELD.z], glowMat('#e6d4ff', 1.5), [WAFER_AT[0], WAFER_AT[1] + 0.05, 0])

    const lambda = pulseLabel(scene, 4, GREY, [SOURCE[0], SOURCE[1] + 5.4, 0], 1)
    const share = pulseLabel(scene, 4, UV, [WAFER_AT[0] + 6.6, WAFER_AT[1] + 3.2, 0], 1)
    const pitch = pulseLabel(scene, 4, RING, [WAFER_AT[0] + 6.6, WAFER_AT[1] + 1.2, 0], 1)

    const opticsGroup = add(scene, new THREE.Group())
    const clock = storyClock([3.5, 3.5, 3.5, 3.5, 9])
    const m4 = new THREE.Matrix4()
    const state = { tool: '', euv: 1, time: 0, optics: null as ReturnType<typeof opticsFor> | null }
    return {
      scene,
      view: { center: [-5, 2.8, 0], radius: 56, polar: 1.3, azimuth: 0.35 },
      frame(dt, p) {
        const tool = p.tool as Tool
        if (tool !== state.tool) {
          state.tool = tool
          emptyGroup(opticsGroup)
          state.optics = opticsFor(opticsGroup, tool)
        }
        clock.frame(dt, n(p, 'step'))
        const s = SCANNERS[tool]
        state.euv += ((tool === 'duv' ? 0 : 1) - state.euv) * ease(dt, 5)
        presence(tin.group, state.euv)
        presence(excimer, 1 - state.euv)
        tin.frame(dt)
        state.time += dt
        ;(window1.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + 1.2 * Math.abs(Math.sin(state.time * 11))
        state.optics!.frame(dt, clock.done)
        stripeMat.emissiveIntensity = clock.step === 2 ? 0.4 + 1.4 * Math.abs(Math.sin(clock.t * Math.PI * 3)) : 0.4

        const scan = clock.step === 4 ? clock.t * fields.length : clock.step < 4 ? 0 : fields.length
        const k = Math.min(fields.length - 1, Math.floor(scan))
        const f = scan - k
        const at = clock.step === 4 ? fields[k] : { x: 0, z: 0 }
        const dir = rowDir(at.z)
        const sweep = clock.step === 4 ? (f - 0.5) * FIELD.x * dir : 0
        chuck.position.set(-at.x - sweep, 0, -at.z)
        reticle.position.x = 2 + MASK_REDUCTION * sweep
        slit.visible = clock.step === 4
        dies.forEach((d, i) => {
          const lit = d.field < k || (d.field === k && ((dir > 0 ? d.col : 2 - d.col) + 0.5) / 3 < f)
          exposed.setMatrixAt(i, lit ? m4.makeTranslation(d.x, 0.47, d.z) : HIDDEN)
        })
        exposed.visible = clock.step === 4
        exposed.instanceMatrix.needsUpdate = true

        lambda.show(fitDigits(s.nm, 3))
        share.show(fitDigits(opticsThroughput(s) * 100, 3))
        pitch.show(fitDigits(halfPitch(s.nm, s.na), 3))
        for (const l of [lambda, share, pitch]) l.frame(dt)
      },
      readouts: (p) => {
        const s = scanner1(p)
        return [
          { label: 'Step', value: `${clock.step + 1}. ${LITHO_STEPS[clock.step]}`, tone: 'ok' },
          { label: 'Half-pitch', value: nm(halfPitch(s.nm, s.na)) },
          { label: 'At wafer', value: percent(opticsThroughput(s)), tone: opticsThroughput(s) < 0.1 ? 'warn' : undefined },
          { label: 'Photon', value: si(photonEv(s.nm), 'eV', 3) },
        ]
      },
    }
  },
}

// --- Wafer to chip: grow an ingot, slice a wafer, pattern it, test every die, keep the good ones. ---

const WAFER_STEPS = ['Grow ingot', 'Slice', 'Pattern', 'Test', 'Package'] as const
const R2 = 5.5
const MM2 = R2 / (WAFER_MM / 2)
const INGOT: V3 = [-11.5, -4, 0]
const INGOT_R = 1.6
const INGOT_H = 7
const WAFER2: V3 = [-0.5, -3, 0]
const PACKAGE: V3 = [10, -3.4, 0]
const LAYERS = 80
const DIE_BLUE = '#8d9bd6'

/** Every whole die on the wafer, the defects scattered over it and which dies they kill; cached per die size and D0. */
function waferMap(mm2: number, perCm2: number) {
  const side = Math.sqrt(mm2)
  const dies = waferGrid(WAFER_MM, side, side)
  const defects = defectSpots(defectCount(WAFER_MM, perCm2), WAFER_MM / 2 - 3)
  const killed = killedDies(dies, side, side, defects)
  const good = killed.filter((k) => !k).length
  return { side, dies, defects, killed, good }
}

const lastMap = { key: '', map: waferMap(100, 0.1) }
const wafer2 = (p: Params) => {
  const key = `${n(p, 'area')}|${n(p, 'd0')}`
  if (key !== lastMap.key) Object.assign(lastMap, { key, map: waferMap(n(p, 'area'), n(p, 'd0')) })
  return lastMap.map
}
const mm2 = (v: number) => `${Math.round(v)} mm²`

/** Ball-grid package: green substrate with solder balls, a heat-spreader lid that closes over the die. */
function chipPackage(scene: THREE.Object3D) {
  const g = add(scene, new THREE.Group(), PACKAGE)
  box(g, [4.4, 0.3, 4.4], mat('#2f6b47', { rough: 0.6 }), [0, 0, 0])
  const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 10, 8), mat('#d4d7dc', { metal: 0.45, rough: 0.35 }), 100)
  const m = new THREE.Matrix4()
  for (let i = 0; i < 100; i++) balls.setMatrixAt(i, m.makeTranslation(-1.98 + (i % 10) * 0.44, -0.2, -1.98 + Math.floor(i / 10) * 0.44))
  g.add(balls)
  const lid = add(g, new THREE.Group())
  box(lid, [3.8, 0.2, 3.8], mat('#c9ced8', { metal: 0.35, rough: 0.3 }), [0, 0.9, 0])
  for (const s of [-1, 1]) {
    box(lid, [3.8, 0.75, 0.2], mat('#c9ced8', { metal: 0.35, rough: 0.3 }), [0, 0.45, s * 1.8])
    box(lid, [0.2, 0.75, 3.8], mat('#c9ced8', { metal: 0.35, rough: 0.3 }), [s * 1.8, 0.45, 0])
  }
  return { group: g, lid }
}

export const waferToChip: Lesson = {
  id: 'chip-making-wafer-to-chip',
  title: 'Wafer to chip',
  tagline: 'From sand to hundreds of chips, minus the duds',
  formula: (p) => {
    const w = wafer2(p)
    const area = n(p, 'area')
    const d0 = n(p, 'd0')
    return `Y = e^(−A·D0) = e^(−${(area / 100).toFixed(2)} cm² × ${d0.toFixed(2)}/cm²) = ${percent(poissonYield(area, d0))} · this wafer: ${w.dies.length} dies, ${w.dies.length - w.good} hit by a defect → ${w.good} good`
  },
  legend: [
    { color: RING, label: 'Whole dies on the wafer', shape: 'dot' },
    { color: POWER, label: 'Passed the probe test', shape: 'dot' },
    { color: HIGH_V, label: 'Killed by a defect (white speck)', shape: 'dot' },
    { color: GREY, label: 'Mask layers so far', shape: 'dot' },
  ],
  points: [
    'Sand is purified to 99.999999999 % silicon and melted at 1414 °C. A seed crystal is dipped in and slowly pulled up while turning: the melt freezes onto it as one perfect crystal, an ingot 300 mm wide and ~2 m long.',
    'A diamond wire saw slices it into wafers 0.78 mm thick, polished flat to a few nanometres. The ingot is drawn small here and the wafer zoomed.',
    'Patterning repeats coat → expose → etch or implant → deposit, layer after layer: ~80 masks for a modern chip, about three months in the fab. Each square is one die, a copy of the chip.',
    'A probe card then tests every die. A single killer defect, a dust particle or a bridged wire, ruins its die. With D0 defects per cm², the chance a die of area A escapes is e^(−A·D0): big dies lose disproportionately, which is why huge chips are pricey and why designs split into chiplets.',
    'The wafer is diced, good dies are flipped onto a package substrate with solder balls and covered by a heat spreader. A ~$20 000 leading-edge wafer divided by its good dies sets the cost.',
  ],
  controls: [
    { kind: 'slider', key: 'area', label: 'Die area', min: 10, max: 800, initial: 100, log: true, format: mm2 },
    { kind: 'slider', key: 'd0', label: 'Defects D0', min: 0.02, max: 1, initial: 0.1, log: true, format: (v) => `${v.toFixed(2)} /cm²` },
    storySlider(WAFER_STEPS),
  ],
  build(): Stage {
    const scene = createStage({ span: 24 })
    cylinder(scene, 2.6, 2.4, mat('#3a3d45', { rough: 0.8 }), [INGOT[0], INGOT[1] - 1.2, 0], 'y', 40)
    const melt = cylinder(scene, 2.3, 0.1, glowMat(CONVENTIONAL, 0.8), [INGOT[0], INGOT[1] + 0.02, 0], 'y', 40)
    melt.castShadow = false
    const ingot = add(scene, new THREE.Group(), [INGOT[0], INGOT[1], 0])
    const silicon = mat('#a7b0bb', { metal: 0.3, rough: 0.35 })
    const body = cylinder(ingot, INGOT_R, 1, silicon, [0, 0.5, 0], 'y', 40)
    const cone = lathe(ingot, [[INGOT_R, 0], [0.9, 0.7], [0.15, 1.3]], silicon, [0, 1, 0], 'y', 40)
    rod(ingot, [0, 1.2, 0], [0, 11, 0], 0.06, mat('#5b606b'))

    const waferGroup = add(scene, new THREE.Group(), WAFER2)
    cylinder(waferGroup, R2, 0.16, mat('#aeb4c2', { metal: 0.3, rough: 0.3 }), [0, 0, 0], 'y', 96)
    const layerLabel = pulseLabel(scene, 2, GREY, [WAFER2[0], WAFER2[1] + 2.4, -R2], 1.2)
    const diesLabel = pulseLabel(scene, 4, RING, [PACKAGE[0], PACKAGE[1] + 5.6, 0], 1)
    const goodLabel = pulseLabel(scene, 4, POWER, [PACKAGE[0], PACKAGE[1] + 3.8, 0], 1)
    const pkg = chipPackage(scene)
    const flyer = box(scene, [1, 0.12, 1], mat(DIE_BLUE, { metal: 0.3, rough: 0.3 }), PACKAGE)
    const probe = add(scene, new THREE.Group())
    box(probe, [1.2, 0.3, 0.8], mat('#3a3d45', { rough: 0.5 }), [0, 1.6, 0])
    rod(probe, [0, 1.45, 0], [0, 0.1, 0], 0.04, mat('#d4d7dc', { metal: 0.45, rough: 0.35 }))

    const mapGroup = add(waferGroup, new THREE.Group())
    const clock = storyClock([4, 3, 4, 5, 5])
    const m4 = new THREE.Matrix4()
    const c = new THREE.Color()
    const COLORS = { blank: new THREE.Color(DIE_BLUE), good: new THREE.Color(POWER), bad: new THREE.Color(HIGH_V), dead: new THREE.Color('#4a2a2a') }
    let built = { key: '', dies: null as THREE.InstancedMesh | null, specks: null as THREE.InstancedMesh | null }
    return {
      scene,
      view: { center: [-0.6, -1.4, 0], radius: 54, polar: 1.1, azimuth: 0.15 },
      frame(dt, p) {
        const w = wafer2(p)
        if (built.key !== lastMap.key) {
          emptyGroup(mapGroup)
          const s = w.side * MM2
          const dies = new THREE.InstancedMesh(new THREE.BoxGeometry(s * 0.9, 0.06, s * 0.9), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.25 }), w.dies.length)
          const specks = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), glowMat('#ffffff', 0.8), Math.max(1, w.defects.length))
          for (const o of [dies, specks]) {
            o.frustumCulled = false
            o.castShadow = false
            mapGroup.add(o)
          }
          built = { key: lastMap.key, dies, specks }
          flyer.scale.set(Math.min(3, 1 + s * 2), 1, Math.min(3, 1 + s * 2))
        }
        clock.frame(dt, n(p, 'step'))
        const step = clock.step
        const t = clock.t

        const grown = clock.done(0)
        body.scale.y = Math.max(0.01, grown * INGOT_H)
        body.position.y = 0.5 * body.scale.y
        cone.position.y = body.scale.y
        ingot.rotation.y += dt * 0.8
        ;(melt.material as THREE.MeshStandardMaterial).emissiveIntensity = step === 0 ? 0.9 + 0.3 * Math.sin(t * 20) : 0.6

        const slid = clock.done(1)
        waferGroup.visible = slid > 0
        const fly = THREE.MathUtils.smootherstep(slid, 0, 1)
        waferGroup.position.set(lerp(INGOT[0], WAFER2[0], fly), lerp(INGOT[1] + 0.2, WAFER2[1], fly) + Math.sin(fly * Math.PI) * 3, 0)
        waferGroup.scale.setScalar(lerp(INGOT_R / R2, 1, fly))

        const shown = clock.done(2)
        const tested = step === 3 ? Math.floor(t * w.dies.length) : step > 3 ? w.dies.length : 0
        const diced = step === 4 ? clamp01(t / 0.3) : 0
        w.dies.forEach((d, i) => {
          const x = d.x * MM2
          const z = d.y * MM2
          const on = shown >= 1 || (x + R2) / (2 * R2) < shown * 1.1
          const killed = w.killed[i]
          c.copy(i >= tested ? COLORS.blank : killed ? (diced > 0 ? COLORS.dead : COLORS.bad) : COLORS.good)
          built.dies!.setColorAt(i, c)
          built.dies!.setMatrixAt(i, on ? m4.makeScale(1 - 0.2 * diced, 1, 1 - 0.2 * diced).setPosition(x, 0.11, z) : HIDDEN)
        })
        built.dies!.instanceMatrix.needsUpdate = true
        if (built.dies!.instanceColor) built.dies!.instanceColor.needsUpdate = true
        w.defects.forEach((d, i) => {
          const at = (i * 0.618) % 1
          built.specks!.setMatrixAt(i, shown > at ? m4.makeTranslation(d.x * MM2, 0.2, d.y * MM2) : HIDDEN)
        })
        built.specks!.instanceMatrix.needsUpdate = true

        probe.visible = step === 3 && tested < w.dies.length
        const under = w.dies[Math.min(tested, w.dies.length - 1)]
        if (under) probe.position.set(WAFER2[0] + under.x * MM2, WAFER2[1] + 0.2 + 0.25 * Math.abs(Math.sin(t * 160)), under.y * MM2)

        const pick = w.killed.indexOf(false)
        const lift = step === 4 && pick >= 0 ? clamp01((t - 0.3) / 0.4) : 0
        flyer.visible = lift > 0
        if (pick >= 0) {
          const from = new THREE.Vector3(WAFER2[0] + w.dies[pick].x * MM2, WAFER2[1] + 0.2, w.dies[pick].y * MM2)
          const to = new THREE.Vector3(PACKAGE[0], PACKAGE[1] + 0.22, 0)
          const e = THREE.MathUtils.smootherstep(lift, 0, 1)
          flyer.position.lerpVectors(from, to, e).setY(lerp(from.y, to.y, e) + Math.sin(e * Math.PI) * 4)
        }
        const close = step === 4 ? clamp01((t - 0.75) / 0.2) : 0
        pkg.lid.visible = close > 0 && pick >= 0
        pkg.lid.position.y = (1 - close) * 3

        layerLabel.display.group.visible = step === 2
        layerLabel.show(String(Math.max(1, Math.ceil(t * LAYERS))))
        diesLabel.display.group.visible = shown > 0
        diesLabel.show(String(w.dies.length))
        goodLabel.display.group.visible = step >= 3
        goodLabel.show(String(step === 3 ? w.killed.slice(0, tested).filter((k) => !k).length : w.good))
        for (const l of [layerLabel, diesLabel, goodLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const w = wafer2(p)
        const y = w.good / w.dies.length
        return [
          { label: 'Step', value: `${clock.step + 1}. ${WAFER_STEPS[clock.step]}`, tone: 'ok' },
          { label: 'Dies', value: String(w.dies.length) },
          { label: 'Yield', value: percent(y), tone: y < 0.5 ? 'bad' : y < 0.8 ? 'warn' : 'ok' },
          { label: 'Per good die', value: w.good ? `$${fitDigits(costPerGoodDie(WAFER_USD, w.good), 4)}` : 'None good', tone: w.good ? undefined : 'bad' },
        ]
      },
    }
  },
}

// --- What 3 nm means: a node's name is a label; its gates, fins and wires are far bigger, its fins only ~20 atoms wide. ---

type NodeKey = keyof typeof NODES
const NANO_STEPS = ['Gates', 'Channels', 'Wires', 'Atoms'] as const
const NM = 0.25
const WINDOW = 220
const ZOOM = 16
const NANO_AT: V3 = [0, -6, 0]
const NANO_FOCUS: V3 = [0, -1, 0]
const GATE_ABOVE = 20
const WIRE_GAP = 15
const COPPER_C = '#c8803f'
const ATOM_ROWS_NM = 5

/** A strip of transistors in nm (scaled by the parent): fins or nanosheet stacks along x, gates across them every
 *  gate pitch (the last one cut at the +x end to show its cross-section), S/D epi and contacts between, wires above. */
function nanoStrip(g: THREE.Group, node: Node) {
  const half = WINDOW / 2
  const finZs = [-node.finPitch / 2, node.finPitch / 2]
  const spanZ = node.finPitch + 50
  const gaa = node.arch === 'gaa'
  const sheetW = 20
  const top = node.finH
  const gateTop = top + GATE_ABOVE
  const lg = node.cpp / 3
  box(g, [WINDOW, 25, spanZ], mat('#5b606b', { rough: 0.7 }), [0, -12.5, 0])
  const finMat = new THREE.MeshStandardMaterial({ color: '#a7b0bb', emissive: ELECTRON, emissiveIntensity: 0, roughness: 0.4 })
  for (const z of finZs) {
    if (gaa) {
      box(g, [WINDOW + 0.8, 6, sheetW], finMat, [0.4, 3, z])
      for (const y of [12.5, 27.5, top - 2.5]) box(g, [WINDOW + 0.8, node.fin, sheetW], finMat, [0.4, y, z])
    } else box(g, [WINDOW + 0.8, top, node.fin], finMat, [0.4, top / 2, z])
  }
  const gateMat = new THREE.MeshStandardMaterial({ color: '#9aa0ad', emissive: '#c9ced8', emissiveIntensity: 0.1, roughness: 0.4, transparent: true, opacity: 1 })
  const gates: number[] = []
  for (let x = half; x - lg / 2 > -half; x -= node.cpp) gates.push(x)
  for (const x of gates) {
    const w = x === half ? lg / 2 : lg
    box(g, [w, gateTop, spanZ - 10], gateMat, [x - (x === half ? w / 2 : 0), gateTop / 2, 0])
  }
  const epi = glass('#9aa6c8', 0.3)
  const contact = mat('#4a4e58', { metal: 0.4, rough: 0.35 })
  for (let i = 0; i + 1 < gates.length; i++) {
    const x = (gates[i] + gates[i + 1]) / 2
    const w = node.cpp - lg - 6
    box(g, [w, top + 4, spanZ - 16], epi, [x, (top + 4) / 2, 0])
    box(g, [w * 0.7, GATE_ABOVE - 2, spanZ - 24], contact, [x, top + 4 + (GATE_ABOVE - 2) / 2, 0])
  }
  const wires = add(g, new THREE.Group())
  const wireY = gateTop + WIRE_GAP + node.mmp / 2
  const count = Math.floor(spanZ / node.mmp)
  for (let i = 0; i < count; i++) box(wires, [WINDOW, node.mmp / 2, node.mmp / 2], COPPER(), [0, wireY, (i - (count - 1) / 2) * node.mmp])

  const w = gaa ? ATOM_ROWS_NM + 3 : node.fin
  const h = gaa ? node.fin : ATOM_ROWS_NM
  const z0 = finZs[1] + (gaa ? sheetW : node.fin) / 2 - w
  const across = atomsAcross(w)
  const rows = atomsAcross(h)
  const atoms = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), glowMat('#e8ecf2', 0.5), across * rows)
  const m = new THREE.Matrix4()
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < across; c++) atoms.setMatrixAt(r * across + c, m.makeTranslation(half + 0.9, top - (r + 0.5) * (h / rows), z0 + (c + 0.5) * (w / across)))
  atoms.frustumCulled = false
  g.add(atoms)
  const barAt = new THREE.Vector3(half + 1, top - h - 1.2, z0 + 1.5)
  box(g, [0.3, 0.4, 3], glowMat(RING, 1), barAt.toArray())
  return {
    gateMat,
    finMat,
    wires,
    atoms,
    anchors: {
      zoom: new THREE.Vector3(half, top - h / 2 - 1, z0 + w / 2),
      pitch: [gates[2] ?? gates[gates.length - 1], gates[1]] as [number, number],
      gateTop,
      fin: new THREE.Vector3(half, top / 2, spanZ / 2),
      wire: new THREE.Vector3(half, wireY, spanZ / 2),
      bar: barAt,
    },
  }
}

const node3 = (p: Params) => NODES[p.node as NodeKey] as Node
const finWord = (nd: Node) => (nd.arch === 'gaa' ? 'Sheet' : 'Fin')

export const what3nmMeans: Lesson = {
  id: 'chip-making-what-3-nm-means',
  title: 'What 3 nm means',
  tagline: 'A name, not a ruler: transistors counted in atoms',
  formula: (p) => {
    const nd = node3(p)
    return `“${nd.name}”: gate pitch ${nd.cpp} nm = ${fitDigits(nd.cpp / parseFloat(nd.name), 3)}× the name · NAND2 = 4 transistors in 3 × ${nd.cpp} × ${nd.cellH} nm² → ${Math.round(nand2Density(nd.cpp, nd.cellH) / 1e6)} M/mm² · a 70 µm hair spans ${gatesAcrossHair(nd.cpp)} gates`
  },
  legend: [
    { color: RING, label: '3 nm drawn to scale; atoms across it', shape: 'dot' },
    { color: GREY, label: 'Gates (grey), pitch nm', shape: 'dot' },
    { color: ELECTRON, label: 'Channel: fin or nanosheets, nm wide', shape: 'dot' },
    { color: COPPER_C, label: 'Metal wires, pitch nm', shape: 'dot' },
  ],
  points: [
    'Node names once measured the gate length. Since ~2000 they are generation labels, each about 0.7× the last: nothing on a “3 nm” chip is 3 nm long. Drawn to scale here (1 nm = 0.25 units); the yellow bar is 3 nm.',
    'What sets density is the gate pitch (gate to gate, 48 nm at 3 nm) and the metal pitch (wire to wire, ~23 nm). A NAND gate’s 4 transistors fit in 3 gate pitches × one cell height: ~160 million per mm². Apple’s 3 nm A17 Pro holds 19 billion.',
    'FinFET: the channel is a thin vertical fin of silicon and the gate wraps its 3 sides, so it can switch the channel off much harder than a flat transistor. Fins are now ~5 nm wide and ~50 nm tall.',
    'Gate-all-around (TSMC 2 nm, Samsung 3 nm): stacked nanosheets ~5 nm thick, the gate on all 4 sides. More control, so shorter gates and wider sheets for more current.',
    'Zoom in to the cut end of a fin: those dots are single silicon atoms ~0.235 nm apart. A 5 nm fin is ~21 atoms wide; one stray atom of dopant matters. Pitches are public estimates for TSMC’s nodes.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'node',
      options: (Object.keys(NODES) as NodeKey[]).map((k) => ({ value: k, label: NODES[k].name })),
      initial: 'n3',
    },
    storySlider(NANO_STEPS),
  ],
  build(): Stage {
    const scene = createStage({ span: 32 })
    const device = add(scene, new THREE.Group(), NANO_AT)
    const bracket = add(scene, new THREE.Group())
    const bracketBar = box(bracket, [1, 0.25, 0.25], glowMat(GREY, 0.6))
    const ends = [-1, 1].map(() => box(bracket, [0.25, 1.4, 0.25], glowMat(GREY, 0.6)))
    const pitchLabel = pulseLabel(scene, 3, GREY, [0, 0, 0], 1.6)
    const finLabel = pulseLabel(scene, 3, ELECTRON, [0, 0, 0], 1.6)
    const wireLabel = pulseLabel(scene, 3, COPPER_C, [0, 0, 0], 1.6)
    const atomLabel = pulseLabel(scene, 2, RING, [0, 0, 0], 2.4)
    const clock = storyClock([3.5, 3.5, 3.5, 5])
    const v = new THREE.Vector3()
    const place = (o: THREE.Object3D, local: THREE.Vector3, dx = 0, dy = 0, dz = 0) => o.position.copy(device.localToWorld(v.copy(local))).add(new THREE.Vector3(dx, dy, dz))
    const state = { node: '', zoom: 0, wires: 0, glow: 0 }
    let strip: ReturnType<typeof nanoStrip> | null = null
    let nd: Node = NODES.n3
    return {
      scene,
      view: { center: [0, 4, 0], radius: 120, polar: 1.2, azimuth: 0.55 },
      frame(dt, p) {
        if (p.node !== state.node) {
          state.node = String(p.node)
          nd = node3(p)
          emptyGroup(device)
          strip = nanoStrip(device, nd)
        }
        const s = strip!
        clock.frame(dt, n(p, 'step'))
        const step = clock.step
        state.zoom += ((step === 3 ? 1 : 0) - state.zoom) * ease(dt, 2.5)
        state.wires += ((step >= 2 ? 1 : 0) - state.wires) * ease(dt, 4)
        state.glow += ((step >= 1 ? 1 : 0) - state.glow) * ease(dt, 4)

        const k = ZOOM ** state.zoom
        const a = (k - 1) / (ZOOM - 1)
        device.scale.setScalar(NM * k)
        const pivot = s.anchors.zoom
        device.position.set(
          lerp(NANO_AT[0] + pivot.x * NM, NANO_FOCUS[0], a) - pivot.x * NM * k,
          lerp(NANO_AT[1] + pivot.y * NM, NANO_FOCUS[1], a) - pivot.y * NM * k,
          lerp(NANO_AT[2] + pivot.z * NM, NANO_FOCUS[2], a) - pivot.z * NM * k,
        )
        device.updateMatrixWorld(true)

        s.gateMat.emissiveIntensity = step === 0 ? 0.15 + 0.35 * Math.abs(Math.sin(clock.t * Math.PI * 3)) : 0.1
        s.gateMat.opacity = 1 - 0.65 * state.glow * (1 - state.zoom)
        s.gateMat.depthWrite = s.gateMat.opacity > 0.9
        s.finMat.emissiveIntensity = 0.6 * state.glow
        s.wires.position.y = (1 - state.wires) * 60
        presence(s.wires, state.wires)
        s.atoms.visible = state.zoom > 0.05

        const [x0, x1] = s.anchors.pitch
        const y = s.anchors.gateTop + 8
        const left = device.localToWorld(new THREE.Vector3(x0, y, 0))
        const right = device.localToWorld(new THREE.Vector3(x1, y, 0))
        bracket.visible = state.zoom < 0.05
        bracketBar.position.copy(left).add(right).multiplyScalar(0.5)
        bracketBar.scale.x = right.x - left.x
        ends[0].position.copy(left)
        ends[1].position.copy(right)
        pitchLabel.display.group.position.copy(bracketBar.position).add(new THREE.Vector3(0, 2, 0))
        pitchLabel.display.group.visible = bracket.visible
        pitchLabel.show(String(nd.cpp))

        place(finLabel.display.group, s.anchors.fin, 6, 0)
        finLabel.display.group.visible = state.glow > 0.5 && state.zoom < 0.05
        finLabel.show(String(nd.fin))
        place(wireLabel.display.group, s.anchors.wire, 3.5, 0)
        wireLabel.display.group.visible = state.wires > 0.5 && state.zoom < 0.05
        wireLabel.show(String(nd.mmp))
        place(atomLabel.display.group, s.anchors.bar, -3.6, -0.6, 3)
        atomLabel.display.group.visible = state.zoom > 0.6
        atomLabel.show(String(atomsAcross(3)))
        for (const l of [pitchLabel, finLabel, wireLabel, atomLabel]) l.frame(dt)
      },
      readouts: (p) => {
        const nd3 = node3(p)
        return [
          { label: 'Step', value: `${clock.step + 1}. ${NANO_STEPS[clock.step]}`, tone: 'ok' },
          { label: 'Density', value: `${Math.round(nand2Density(nd3.cpp, nd3.cellH) / 1e6)} M/mm²` },
          { label: finWord(nd3), value: `${atomsAcross(nd3.fin)} atoms` },
        ]
      },
    }
  },
}
