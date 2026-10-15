import * as THREE from 'three/webgpu'
import { Vec3 } from '../../core/fields'
import {
  DEG,
  EARTH_R,
  GPS_SKY,
  L1_HZ,
  L1_LAMBDA,
  LIGHT_C,
  RATIO_MIN,
  RTK_PPM,
  RtkState,
  canyonPath,
  carrierCycles,
  dop,
  fixKind,
  flightTime,
  parkedFixes,
  pseudoranges,
  radiusQuantile,
  rtkEpochs,
  skyPos,
  solveFix,
  uere,
} from '../../core/physics'
import { V3, add, box, cylinder, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  DATA_COLOR,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  add3,
  arcAt,
  glowMat,
  label,
  liveLabel,
  memoBy,
  packetPool,
  pointCloud,
  ripples,
  setGlow,
  shadowlessRod,
  smoothstep,
  stretchRod,
} from '../fx'
import { Lesson, Params, Stage, n, pick } from '../types'

const SAT_COLORS = [RING, B_FIELD, FORCE, DATA_COLOR]
/** Local (east, north, up) → stage: east +x, up +y, north −z (away from the camera). */
const enu = ([e, nn, u]: Vec3, k = 1): V3 => [e * k, u * k, -nn * k]
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len3 = (v: V3 | Vec3) => Math.hypot(v[0], v[1], v[2])
const lenText = (m: number) => {
  const a = Math.abs(m)
  if (a >= 1000) return `${(m / 1000).toFixed(a >= 1e4 ? 0 : 1)} km`
  if (a >= 1) return `${m.toFixed(a >= 10 ? 0 : 1)} m`
  return `${(m * 100).toFixed(a >= 0.1 ? 0 : 1)} cm`
}

/** GPS satellite: gold bus, two blue solar wings, an antenna toward Earth (`aim` turns it). */
function satellite(parent: THREE.Object3D, at: V3, color: string, k = 1) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(k)
  box(g, [1, 1, 1], mat('#c9a24d', { metal: 0.4, rough: 0.35 }))
  const wing = mat('#1d3b8f', { rough: 0.3, metal: 0.3, emissive: '#0a1640' })
  for (const s of [-1, 1]) {
    box(g, [1.9, 0.08, 0.9], wing, [s * 1.6, 0, 0])
    box(g, [0.5, 0.06, 0.06], mat('#9aa0ab'), [s * 0.6, 0, 0])
  }
  const horn = add(g, mesh(new THREE.ConeGeometry(0.32, 0.5, 14, 1, true), glowMat(color, 0.9)), [0, -0.7, 0])
  horn.rotation.x = Math.PI
  const beacon = glowMat(color, 1)
  add(g, mesh(new THREE.SphereGeometry(0.18, 10, 8), beacon), [0, 0.6, 0])
  g.traverse((o) => (o.castShadow = false))
  return {
    group: g,
    aim(to: V3) {
      const d = new THREE.Vector3(to[0] - g.position.x, to[1] - g.position.y, to[2] - g.position.z).normalize()
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d)
    },
    glow: (f: number) => setGlow(beacon, color, f),
  }
}

/** Small four-wheel robot with a GPS puck on a mast; nose toward +x. */
function gpsRover(parent: THREE.Object3D, at: V3, k = 1) {
  const g = add(parent, new THREE.Group(), at)
  g.scale.setScalar(k)
  box(g, [5, 1.2, 3.2], mat('#d8dbe2', { rough: 0.55 }), [0, 1.3, 0])
  const tyre = mat('#1c1c1f', { rough: 0.8 })
  for (const x of [-1.7, 1.7]) for (const z of [-1.9, 1.9]) cylinder(g, 0.75, 0.6, tyre, [x, 0.75, z], 'z', 20)
  cylinder(g, 0.12, 2, mat('#9aa0ab'), [-1, 2.9, 0], 'y', 8)
  cylinder(g, 0.75, 0.35, mat('#f2f2f0', { rough: 0.4 }), [-1, 4, 0], 'y', 24)
  const led = glowMat(POWER, 0)
  add(g, mesh(new THREE.SphereGeometry(0.16, 10, 8), led), [1.6, 2, 1.62])
  return { group: g, antenna: [at[0] - k, at[1] + 4.2 * k, at[2]] as V3, led }
}

/** Arc of a circle (radius 1 base, `half` each side of +x), turned by `place` to sit on a sphere around `c`. */
function sphereArc(parent: THREE.Object3D, color: string, half: number, tube = 0.06, glow = 0.9) {
  const R = 10
  const geo = new THREE.TorusGeometry(R, tube, 6, 64, 2 * half)
  geo.rotateZ(-half)
  const m = glowMat(color, glow)
  const o = add(parent, mesh(geo, m))
  o.castShadow = false
  const basis = new THREE.Matrix4()
  const x = new THREE.Vector3()
  const y = new THREE.Vector3()
  const z = new THREE.Vector3()
  return {
    mesh: o,
    material: m,
    /** Circle around `c` of radius `r`, centred on direction `d`, in the plane of `d` and the screen. */
    place(c: V3, d: V3, r: number) {
      x.set(...d).normalize()
      y.set(0, 0, 1).cross(x)
      if (y.lengthSq() < 1e-6) y.set(0, 1, 0).cross(x)
      y.normalize()
      z.copy(x).cross(y)
      o.quaternion.setFromRotationMatrix(basis.makeBasis(x, y, z))
      o.position.set(...c)
      o.scale.setScalar(Math.max(1e-3, r / R))
      o.visible = r > 1e-3
    },
  }
}

const dot = (parent: THREE.Object3D, color: string, r: number, glow = 1.1) => {
  const o = add(parent, mesh(new THREE.SphereGeometry(r, 16, 12), glowMat(color, glow)))
  o.castShadow = false
  return o
}

// --- Trilateration: timed signals, range spheres, and the 4th satellite that solves the clock. ---

const TRI = {
  sats: [
    { prn: 7, az: 272, el: 33 },
    { prn: 12, az: 95, el: 28 },
    { prn: 19, az: 150, el: 70 },
    { prn: 24, az: 320, el: 58 },
  ],
  earthR: 4.5,
  rx: [0, -9.5, 0] as V3,
  perUs: 0.16,
  send: 3,
  hold: 1.5,
  solve: 2.5,
  done: 3,
}
const TRI_K = TRI.earthR / EARTH_R
const TRI_CYCLE = TRI.send + TRI.hold + TRI.solve + TRI.done
const COUNTS = { '3': '3 satellites', '4': '4 satellites' }

function triSetup(p: Params) {
  const count = Number(pick(COUNTS, p.count, '4'))
  const clockUs = n(p, 'clock')
  const all = TRI.sats.map((s) => skyPos(s.az, s.el))
  const sats = all.slice(0, count)
  const rho = pseudoranges(sats, [0, 0, 0], clockUs * 1e-6)
  const fix = solveFix(sats, rho, count === 3 ? { bias: 0 } : {})
  const ranges = sats.map((s) => len3(s))
  return { count, clockUs, all, sats, rho, fix, ranges, err: len3(fix.pos), biasM: LIGHT_C * clockUs * 1e-6 }
}

export const trilateration: Lesson = {
  id: 'gps-trilateration',
  title: 'Trilateration',
  tagline: 'Each satellite says when it sent; flight time gives a range sphere, and four of them pin down place and clock',
  formula: (p) => {
    const S = triSetup(p)
    const fl = S.ranges.map((r) => r / LIGHT_C)
    return `ρ = c × (t_received − t_sent) = |s − p| + c·b · flights ${(Math.min(...fl) * 1e3).toFixed(1)}–${(Math.max(...fl) * 1e3).toFixed(1)} ms · c·b = 299 792 458 m/s × ${S.clockUs.toFixed(1)} µs = ${lenText(S.biasM)} on every range · unknowns x, y, z, b → ${S.count === 4 ? '4 ranges, least squares (Gauss–Newton) solves all four' : '3 ranges must assume b = 0'}`
  },
  legend: [
    { color: RING, label: 'Satellites: each arc is its range sphere', shape: 'dot' },
    { color: POWER, label: 'Receiver: true place, solved fix', shape: 'dot' },
    { color: HIGH_V, label: 'Fix with the clock error left in', shape: 'dot' },
    { color: GREY, label: 'Orbits 20 200 km up (to scale)', shape: 'dot' },
  ],
  points: [
    'Each GPS satellite carries atomic clocks and keeps broadcasting its position and the exact time. The signal flies at the speed of light and lands 67–86 ms later.',
    'Flight time × c = range: the receiver sits somewhere on a sphere around that satellite. Three spheres cross at one point on the Earth (the other is out in space).',
    "But the receiver's quartz clock is never exactly right. 1 µs off = 300 m added to every range, and three spheres still meet, just in the wrong place, with no sign of the error.",
    'A 4th satellite adds the 4th equation: solve x, y, z and the clock bias b together. Only one b makes all four spheres meet, so every GPS fix also sets the receiver clock to within ~20 ns.',
  ],
  controls: [
    { kind: 'choice', key: 'count', options: (Object.keys(COUNTS) as (keyof typeof COUNTS)[]).map((k) => ({ value: k, label: COUNTS[k] })), initial: '4' },
    { kind: 'slider', key: 'clock', label: 'Receiver clock error', min: 0, max: 10, step: 0.5, initial: 4, format: (v) => `${v.toFixed(1)} µs` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const rx = TRI.rx
    const centre: V3 = [rx[0], rx[1] - TRI.earthR, rx[2]]
    const sea = mat('#2c5aa0', { rough: 0.7, opacity: 0.72 })
    sea.transparent = true
    sea.depthWrite = false
    add(scene, mesh(new THREE.SphereGeometry(TRI.earthR, 48, 32), sea), centre).castShadow = false
    const land = mat('#3f8a4f', { rough: 0.8 })
    for (const [la, lo, r] of [[30, 20, 1.5], [-10, -60, 1.2], [55, -100, 1.3], [-25, 130, 1]] as const) {
      const v = new THREE.Vector3().setFromSphericalCoords(TRI.earthR * 0.985, (90 - la) * DEG, lo * DEG)
      const cap = add(scene, mesh(new THREE.SphereGeometry(r, 16, 10), land), add3(centre, [v.x, v.y, v.z]))
      cap.scale.set(1, 0.35, 1)
      cap.lookAt(...centre)
      cap.rotateX(Math.PI / 2)
    }
    const air = add(scene, mesh(new THREE.SphereGeometry(TRI.earthR * 1.06, 32, 20), glowMat(B_FIELD, 0.4)), centre)
    const airM = air.material as THREE.MeshStandardMaterial
    airM.transparent = true
    airM.opacity = 0.12
    airM.depthWrite = false
    air.castShadow = false

    const satAt = (i: number) => add3(rx, enu(skyPos(TRI.sats[i].az, TRI.sats[i].el), TRI_K))
    const sats = TRI.sats.map((s, i) => {
      const at = satAt(i)
      const orbit = sphereArc(scene, GREY, 0.75, 0.04, 0.25)
      const up = sub3(at, centre)
      orbit.place(centre, up, len3(up))
      orbit.mesh.rotateX((i % 2 ? -1 : 1) * (0.5 + 0.2 * i))
      const m = satellite(scene, at, SAT_COLORS[i], 0.85)
      m.aim(centre)
      const range = sphereArc(scene, SAT_COLORS[i], 0.32, 0.07, 1)
      const beam = add(scene, shadowlessRod(glowMat(SAT_COLORS[i], 0.25)))
      stretchRod(beam, at, rx, 0.03)
      const bead = dot(scene, SAT_COLORS[i], 0.22)
      const prn = add(scene, label(`PRN ${s.prn}`, { size: 0.5, color: SAT_COLORS[i] }), add3(at, [0, 1.6, 0]))
      prn.castShadow = false
      const tag = liveLabel(scene, add3(at, [0, -1.6, 0]), { size: 0.45 })
      return { at, m, orbit, range, beam, bead, prn, tag }
    })
    const truth = dot(scene, POWER, 0.32, 1.3)
    truth.position.set(...rx)
    const fixDot = dot(scene, POWER, 0.5, 1.4)
    const fixMat = fixDot.material as THREE.MeshStandardMaterial
    const offRod = add(scene, shadowlessRod(glowMat(HIGH_V, 0.8)))
    const rxTag = liveLabel(scene, add3(rx, [3.2, -0.6, 0]), { size: 0.5, align: 'left' })
    const fixTag = liveLabel(scene, [0, 0, 0], { size: 0.5, align: 'left' })

    const T0: V3 = [-18.5, 11.8, 0]
    const [phaseText, clockText, resultText] = [0, 1, 2].map((i) => liveLabel(scene, [T0[0], T0[1] - i * 1.3, 0], { size: 0.55, align: 'left' }))
    const status = liveLabel(scene, [T0[0], T0[1] - 4.1, 0], { size: 0.4, align: 'left' })
    const s = { key: '', t: 0 }
    return {
      scene,
      view: { center: [0, 1, 0], radius: 70, polar: 1.25, azimuth: 0 },
      frame(dt, p) {
        const S = triSetup(p)
        const key = `${S.count}|${S.clockUs}`
        if (key !== s.key) Object.assign(s, { key, t: 0 })
        s.t = (s.t + dt) % TRI_CYCLE
        const t = s.t
        const at = sats.slice(0, S.count).map((q) => sub3(q.at, rx))
        const B = S.clockUs * TRI.perUs
        const trueR = at.map(len3)
        const shown = S.count === 3 ? solveFix(at, trueR.map((r) => r + B), { bias: 0 }).pos : ([0, 0, 0] as Vec3)
        const target = add3(rx, shown as V3)
        const speed = Math.max(...trueR.map((r) => r + B)) / (TRI.send * 0.9)
        const solveU = S.count === 4 ? smoothstep((t - TRI.send - TRI.hold) / TRI.solve) : 0
        const solved = S.count === 4 && t >= TRI.send + TRI.hold + TRI.solve

        sats.forEach((q, i) => {
          const used = i < S.count
          q.m.group.visible = q.prn.visible = q.beam.visible = q.orbit.mesh.visible = used
          q.m.glow(used ? 0.6 + 0.6 * Math.max(0, 1 - t * 2) : 0)
          q.tag.group.visible = used
          if (!used) {
            q.range.mesh.visible = q.bead.visible = false
            return
          }
          const full = len3(sub3(target, q.at)) + (S.count === 4 ? B * (1 - solveU) : 0)
          const r = Math.min(full, speed * t)
          q.range.place(q.at, sub3(target, q.at), r)
          const u = Math.min(1, r / trueR[i])
          q.bead.visible = t < TRI.send && u < 1
          q.bead.position.set(...add3(q.at, sub3(rx, q.at), u))
          const meters = S.count === 4 ? S.ranges[i] + S.biasM * (1 - solveU) : S.rho[i]
          q.tag.set(r < full - 1e-6 ? `${(flightTime(skyPos(TRI.sats[i].az, TRI.sats[i].el)) * 1e3 * (r / trueR[i])).toFixed(1)} ms…` : `${Math.round(meters / 1e3).toLocaleString('en')} km`, SAT_COLORS[i])
        })
        const arrived = t >= TRI.send
        const wrong = S.count === 3 && S.err > 1
        fixDot.visible = arrived && (S.count === 3 || solved)
        fixDot.position.set(...target)
        setGlow(fixMat, wrong ? HIGH_V : POWER, 1.4)
        offRod.visible = fixDot.visible && wrong
        if (offRod.visible) stretchRod(offRod, rx, target, 0.06)
        fixTag.group.visible = fixDot.visible && wrong
        fixTag.group.position.set(...add3(target, [0.9, 0.9, 0]))
        fixTag.set(`fix: ${lenText(S.err)} off`, HIGH_V)
        rxTag.set(solved || !wrong ? 'receiver' : 'really here', POWER)

        phaseText.set(
          !arrived
            ? 'Satellites send "it is now t₀"; the wavefronts fly at c'
            : S.count === 3
              ? wrong
                ? 'Three spheres meet in one point: the wrong one'
                : 'Perfect clock: three spheres meet at the receiver'
              : t < TRI.send + TRI.hold
                ? B > 0
                  ? 'Four spheres miss: every range is too long by the same c·b'
                  : 'Four spheres meet: clock already exact'
                : solved
                  ? 'Fix: one b makes all four meet'
                  : 'Least squares shrinks every sphere by the same c·b',
          arrived && wrong ? HIGH_V : arrived ? POWER : LABEL,
        )
        clockText.set(`receiver clock ${S.clockUs.toFixed(1)} µs late → +${lenText(S.biasM)} on each range`, S.clockUs > 0 ? HEAT : GREY)
        resultText.set(
          S.count === 4 ? `solved b = ${((S.fix.bias / LIGHT_C) * 1e6).toFixed(3)} µs · fix error ${lenText(S.err)}` : `b assumed 0 → fix error ${lenText(S.err)}`,
          S.count === 3 && wrong ? HIGH_V : POWER,
        )
        const slow = TRI.send / Math.max(...S.ranges.map((r) => r / LIGHT_C))
        status.set(`Earth + orbits to scale · clock error drawn ${Math.round(TRI.perUs / (LIGHT_C * 1e-6 * TRI_K))}× · light slowed ${Math.round(slow)}×`, GREY)
      },
      readouts: (p) => {
        const S = triSetup(p)
        return [
          { label: 'Flight times', value: S.ranges.map((r) => (r / LIGHT_C) * 1e3).map((v) => v.toFixed(1)).join(' · ') + ' ms' },
          { label: 'Clock bias', value: S.count === 4 ? `${((S.fix.bias / LIGHT_C) * 1e6).toFixed(2)} µs (solved)` : `${S.clockUs.toFixed(1)} µs (unseen)`, tone: S.count === 4 || S.clockUs === 0 ? 'ok' : 'bad' },
          { label: 'Position error', value: lenText(S.err), tone: S.err < 1 ? 'ok' : 'bad' },
          { label: 'Equations · unknowns', value: `${S.count} · ${S.count === 4 ? '4 (x, y, z, b)' : '3 (b held 0)'}` },
        ]
      },
    }
  },
}

// --- Fix and accuracy: how many satellites, where in the sky, and what buildings do to a parked robot's fix. ---

const SKIES = { open: 'Open sky', canyon: 'Urban canyon' }
type Sky = keyof typeof SKIES
const FIX = {
  street: 20,
  wall: 40,
  k: 0.25,
  dome: 10,
  domeAt: [-8, -9, 0] as V3,
  turn: -0.55,
  plot: [11.5, -1.5, 0] as V3,
  plotR: 6,
  seconds: 600,
  speed: 30,
}
const FIX_COLOR = { direct: POWER, reflected: HEAT, blocked: HIGH_V }
const fixRun = memoBy(
  (p: Params) => `${p.sats}|${p.sky}`,
  (p: Params) => {
    const count = Math.round(n(p, 'sats'))
    const sky: Sky = pick(SKIES, p.sky, 'open')
    const list = GPS_SKY.slice(0, count).map((s) => ({ ...s, pos: skyPos(s.az, s.el), ...(sky === 'canyon' ? canyonPath(s.az, s.el, FIX.street, FIX.wall) : { path: 'direct' as const, extraM: 0 }) }))
    const used = list.filter((s) => s.path !== 'blocked')
    const kind = fixKind(used.length)
    const d = dop(used.map((s) => s.pos))
    const epochs = parkedFixes(used.map((s) => s.pos), used.map((s) => s.extraM), FIX.seconds)
    const pts = epochs.map((e) => e.err)
    const cep50 = radiusQuantile(pts, 0.5)
    const cep95 = radiusQuantile(pts, 0.95)
    const reach = Math.max(4, cep95 * 1.2)
    const ring = [2, 5, 10, 20, 50, 100].find((r) => r * 2 >= reach * 1.05) ?? 100
    return { count, sky, list, used, kind, d, epochs, cep50, cep95, ring, reflected: used.filter((s) => s.path === 'reflected').length }
  },
)
const dopText = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '—')

export const fixAndAccuracy: Lesson = {
  id: 'gps-fix-and-accuracy',
  title: 'Fix and accuracy',
  tagline: 'More satellites, spread wide, give a tight fix; buildings block and bounce them',
  formula: (p) => {
    const R = fixRun(p)
    const u = uere('single')
    return `σ_horizontal = HDOP × σ_range = ${dopText(R.d.h)} × ${u.toFixed(1)} m${Number.isFinite(R.d.h) ? ` = ${(R.d.h * u).toFixed(1)} m` : ''} · DOP from Q = (HᵀH)⁻¹, rows of H = unit vectors to the satellites · bounce off a wall d away: +2d·cos(el)·|sin az| of range`
  },
  legend: [
    { color: POWER, label: 'Line of sight · 3D fixes', shape: 'dot' },
    { color: HEAT, label: 'Bounced off a wall: arrives late', shape: 'dot' },
    { color: HIGH_V, label: 'Blocked by a building', shape: 'dot' },
    { color: RING, label: '2D fixes (altitude held) · 50 % circle', shape: 'dot' },
  ],
  points: [
    'A fix needs 4 satellites for 3D (x, y, z, clock). With 3 the receiver holds its last altitude and reports a 2D fix; with fewer it reports no fix at all ($GPGGA quality 0).',
    'Each range is off by a few metres (ionosphere, satellite clock and orbit, noise). Geometry scales that: DOP. Satellites spread across the sky cross at sharp angles (HDOP ~1); bunched ones cross at shallow angles and smear the fix.',
    'Parked, the fix still wanders: the errors drift over minutes, so the cloud is a slow scribble, not a dot. CEP 50 % is the circle half the fixes land in.',
    'In a street between tall buildings most of the sky is gone. Worse, a satellite hidden behind one building can bounce off the other: the late echo is trusted as a range and drags the fix tens of metres off.',
  ],
  controls: [
    { kind: 'slider', key: 'sats', label: 'Satellites above the horizon', min: 2, max: 10, step: 1, initial: 7, format: (v) => `${v.toFixed(0)}` },
    { kind: 'choice', key: 'sky', options: (Object.keys(SKIES) as Sky[]).map((k) => ({ value: k, label: SKIES[k] })), initial: 'open' },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const world = add(scene, new THREE.Group(), FIX.domeAt)
    world.rotation.y = FIX.turn
    const R = FIX.dome
    cylinder(world, R + 1, 0.3, mat('#2a2d33', { rough: 0.9 }), [0, -0.15, 0], 'y', 64)
    box(world, [FIX.street * FIX.k, 0.04, 2 * R + 2], mat('#3a3d44', { rough: 0.9 }), [0, 0.02, 0])
    const ringMat = glowMat(GREY, 0.25)
    for (const el of [0, 30, 60]) {
      const ring = add(world, mesh(new THREE.TorusGeometry(R * Math.cos(el * DEG), 0.03, 4, 72), ringMat), [0, R * Math.sin(el * DEG), 0])
      ring.rotation.x = Math.PI / 2
      ring.castShadow = false
    }
    for (const az of [0, 90]) {
      const arc = add(world, mesh(new THREE.TorusGeometry(R, 0.03, 4, 72, Math.PI), ringMat))
      arc.rotation.y = az * DEG
      arc.castShadow = false
    }
    const nTag = add(world, label('N', { size: 1, color: GREY }), [0, 0.1, -R - 1.6])
    nTag.rotation.x = -Math.PI / 2
    const wallMat = mat('#59606e', { rough: 0.8, opacity: 0.45 })
    wallMat.transparent = true
    wallMat.depthWrite = false
    const ledge = glowMat(GREY, 0.2)
    const walls = [-1, 1].map((sx) => {
      const g = add(world, new THREE.Group())
      const w = 3
      const h = FIX.wall * FIX.k
      const x = sx * ((FIX.street * FIX.k) / 2 + w / 2)
      box(g, [w, h, 2 * R + 2], wallMat, [x, h / 2, 0])
      for (let fl = 1; fl < 6; fl++) box(g, [0.04, 0.08, 2 * R + 2], ledge, [x - (sx * w) / 2 - sx * 0.03, fl * 1.65, 0])
      g.traverse((o) => (o.castShadow = false))
      return g
    })
    const rover = gpsRover(world, [0, 0, 0], 0.32)
    const ghost = dot(world, POWER, 0.32, 1.3)
    const ghostTag = liveLabel(world, [0, 0, 0], { size: 0.5 })

    const sats = GPS_SKY.map((s, i) => {
      const at = enu([Math.sin(s.az * DEG) * Math.cos(s.el * DEG), Math.cos(s.az * DEG) * Math.cos(s.el * DEG), Math.sin(s.el * DEG)], R)
      const m = satellite(world, at, LABEL, 0.4)
      m.aim([0, 0, 0])
      const a = add(world, shadowlessRod(glowMat(POWER, 0.8)))
      const b = add(world, shadowlessRod(glowMat(POWER, 0.8)))
      const tag = add(world, label(`${s.prn}`, { size: 0.5, color: GREY }), add3(at, [0, 0.9, 0]))
      return { s, at, m, a, b, tag, i }
    })

    const P = FIX.plot
    const plotMat = glowMat(GREY, 0.3)
    const cross = [0, 1].map(() => add(scene, shadowlessRod(plotMat)))
    stretchRod(cross[0], add3(P, [-FIX.plotR, 0, 0]), add3(P, [FIX.plotR, 0, 0]), 0.03)
    stretchRod(cross[1], add3(P, [0, -FIX.plotR, 0]), add3(P, [0, FIX.plotR, 0]), 0.03)
    add(scene, label('N', { size: 0.55, color: GREY }), add3(P, [0, FIX.plotR + 0.8, 0]))
    add(scene, label('E', { size: 0.55, color: GREY }), add3(P, [FIX.plotR + 0.8, 0, 0]))
    const scaleRings = [0, 1].map(() => add(scene, mesh(new THREE.TorusGeometry(1, 0.02, 4, 72), plotMat), P))
    const scaleTags = [0, 1].map(() => liveLabel(scene, [0, 0, 0], { size: 0.4, align: 'left' }))
    const cepRing = add(scene, mesh(new THREE.TorusGeometry(1, 0.025, 6, 72), glowMat(RING, 1.3)), P)
    const cloud = pointCloud(scene, FIX.seconds, 0.12)
    const now = dot(scene, LABEL, 0.24, 1.4)
    const plotTitle = liveLabel(scene, add3(P, [0, -FIX.plotR - 1.3, 0]), { size: 0.45 })

    const T0: V3 = [-18.5, 14.5, 0]
    const [fixText, dopLine, skyText] = [0, 1, 2].map((i) => liveLabel(scene, [T0[0], T0[1] - i * 1.3, 0], { size: 0.55, align: 'left' }))
    const status = liveLabel(scene, [T0[0], T0[1] - 4.1, 0], { size: 0.4, align: 'left' })
    const s = { key: '', t: 0 }
    const half = (FIX.street * FIX.k) / 2
    return {
      scene,
      view: { center: [0, 2, 0], radius: 70, polar: 1.12, azimuth: 0 },
      frame(dt, p) {
        const F = fixRun(p)
        const key = `${p.sats}|${p.sky}`
        if (key !== s.key) Object.assign(s, { key, t: 0 })
        s.t += dt
        const tSim = Math.min(FIX.seconds, s.t * FIX.speed)
        walls.forEach((w) => (w.visible = F.sky === 'canyon'))

        sats.forEach((q) => {
          const info = F.list[q.i]
          const on = !!info
          q.m.group.visible = q.tag.visible = on
          q.a.visible = q.b.visible = false
          if (!on) return
          const color = FIX_COLOR[info.path]
          q.m.glow(info.path === 'blocked' ? 0.15 : 0.9)
          setGlow(q.a.material as THREE.MeshStandardMaterial, color, 0.8)
          setGlow(q.b.material as THREE.MeshStandardMaterial, color, 0.8)
          const ant: V3 = [0, 1.35, 0]
          const u = sub3(q.at, ant)
          if (info.path === 'direct') {
            q.a.visible = true
            stretchRod(q.a, q.at, ant, 0.05)
          } else {
            const sx = Math.sign(u[0]) || 1
            const lam = half / Math.abs(u[0] / len3(u))
            const dir = u.map((c) => c / len3(u)) as V3
            if (info.path === 'blocked') {
              q.a.visible = true
              stretchRod(q.a, q.at, add3(ant, dir, lam), 0.035)
            } else {
              const hit: V3 = add3(ant, [-dir[0], dir[1], dir[2]], lam)
              hit[0] = -sx * half
              q.a.visible = q.b.visible = true
              stretchRod(q.a, q.at, hit, 0.04)
              stretchRod(q.b, hit, ant, 0.04)
            }
          }
        })

        const shown = F.epochs.filter((e) => e.t <= tSim)
        const k = FIX.plotR / (F.ring * 2)
        shown.forEach((e, i) => cloud.set(i, add3(P, [e.err[0] * k, e.err[1] * k, 0.05]), e.kind === '2D' ? RING : POWER, i === shown.length - 1 ? 0 : 1))
        cloud.show(shown.length)
        const last = shown[shown.length - 1]
        now.visible = ghost.visible = ghostTag.group.visible = !!last
        if (last) {
          now.position.set(...add3(P, [last.err[0] * k, last.err[1] * k, 0.1]))
          const g = enu(last.err, FIX.k)
          ghost.position.set(g[0], 1.35, g[2])
          ghostTag.group.position.set(g[0], 2.4, g[2])
          const c = last.kind === '2D' ? RING : POWER
          setGlow(ghost.material as THREE.MeshStandardMaterial, c, 1.3)
          ghostTag.set(`fix ${lenText(Math.hypot(last.err[0], last.err[1]))} off`, c)
        }
        rover.led.emissiveIntensity = last ? 1.2 * (0.5 + 0.5 * Math.cos(s.t * 6)) : 0
        scaleRings.forEach((r, i) => r.scale.setScalar(F.ring * (i + 1) * k))
        scaleTags.forEach((t, i) => {
          t.group.position.set(...add3(P, [F.ring * (i + 1) * k * 0.72 + 0.15, F.ring * (i + 1) * k * 0.72 + 0.15, 0]))
          t.set(`${F.ring * (i + 1)} m`, GREY)
        })
        const cep = radiusQuantile(shown.map((e) => e.err), 0.5)
        cepRing.visible = shown.length > 20
        cepRing.scale.setScalar(Math.max(1e-3, cep * k))
        cepRing.position.z = 0.15
        plotTitle.set(shown.length ? `${shown.length} fixes · CEP 50 % ${lenText(cep)}` : 'no fix: nothing to plot', shown.length ? LABEL : HIGH_V)

        const blocked = F.list.length - F.used.length
        fixText.set(
          F.kind === 'none' ? `${F.used.length} usable satellite${F.used.length === 1 ? '' : 's'}: no fix` : `${F.used.length} satellites → ${F.kind} fix`,
          F.kind === 'none' ? HIGH_V : F.kind === '2D' ? RING : POWER,
        )
        dopLine.set(F.kind === '3D' ? `HDOP ${dopText(F.d.h)} · VDOP ${dopText(F.d.v)} · PDOP ${dopText(F.d.p)}` : F.kind === '2D' ? 'altitude held · DOP needs 4' : 'DOP needs 4 satellites', F.d.h > 2 || F.kind !== '3D' ? HEAT : LABEL)
        skyText.set(F.sky === 'canyon' ? `street ${FIX.street} m, walls ${FIX.wall} m: ${blocked} blocked, ${F.reflected} bounced` : 'open sky: every satellite in line of sight', F.reflected ? HEAT : GREY)
        const mm = Math.floor(tSim / 60)
        status.set(`parked robot · 1 fix/s · t = ${mm}:${String(Math.floor(tSim % 60)).padStart(2, '0')} · ${FIX.speed}× real time`, GREY)
      },
      readouts: (p) => {
        const F = fixRun(p)
        return [
          { label: 'Fix', value: F.kind === 'none' ? 'none' : F.kind, tone: F.kind === '3D' ? 'ok' : F.kind === '2D' ? 'warn' : 'bad' },
          { label: 'Satellites used', value: `${F.used.length} of ${F.list.length}` },
          { label: 'HDOP', value: dopText(F.d.h), tone: F.d.h <= 1.5 ? 'ok' : F.d.h <= 3 ? 'warn' : 'bad' },
          { label: 'CEP 50 % · 95 %', value: F.epochs.length ? `${lenText(F.cep50)} · ${lenText(F.cep95)}` : '—', tone: !F.epochs.length || F.cep95 > 20 ? 'bad' : F.cep95 > 8 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}

// --- RTK: a base on a known spot sends corrections; carrier phase + whole cycles take the rover to centimetres. ---

const MODES = { single: 'GPS alone', dgps: 'Code corrections', rtk: 'RTK carrier' }
type Mode = keyof typeof MODES
const RTK = {
  seconds: 90,
  speed: 4,
  hold: 3,
  base: [-13, -8.5, 0] as V3,
  rover: [-1, -8.5, 0] as V3,
  sats: [[-15, 5.5, -2], [-6, 7, 0], [3, 5.5, -2]] as V3[],
  target: [13, -1.5, 0] as V3,
  targetR: 5.6,
  waveSat: 1,
  waveCycles: 18,
}
const STATE_COLOR: Record<RtkState, string> = { single: HIGH_V, dgps: HEAT, float: RING, fixed: POWER }
const STATE_TEXT: Record<RtkState, string> = { single: 'GPS alone', dgps: 'DGPS', float: 'RTK float', fixed: 'RTK fixed' }
const RTK_HDOP = dop(GPS_SKY.slice(0, 8).map((s) => skyPos(s.az, s.el))).h
const rtkRun = memoBy(
  (p: Params) => `${p.mode}|${p.km}`,
  (p: Params) => {
    const mode: Mode = pick(MODES, p.mode, 'rtk')
    const km = n(p, 'km')
    const epochs = rtkEpochs(mode, km, RTK.seconds, RTK_HDOP)
    const fixAt = epochs.findIndex((e) => e.state === 'fixed')
    return { mode, km, epochs, fixAt, last: epochs[epochs.length - 1] }
  },
)
/** Log-scale radius on the target: 3 mm at the centre … 30 m at the rim. */
const logR = (m: number) => Math.min(1, Math.max(0, Math.log10(m / 0.003) / 4))

export const rtk: Lesson = {
  id: 'gps-rtk',
  title: 'RTK',
  tagline: 'A base on a known spot sends its errors; counting 19 cm carrier waves brings the rover to centimetres',
  formula: (p) => {
    const R = rtkRun(p)
    return `λ = c / f = 299 792 458 / ${(L1_HZ / 1e6).toFixed(2)} MHz = ${(L1_LAMBDA * 100).toFixed(2)} cm · range = (N + φ) λ, φ measured to ~1 % (2 mm), N whole cycles unknown · rover − base cancels shared errors, ${(RTK_PPM * 1e3).toFixed(1)} mm/km left = ${lenText(RTK_PPM * R.km)} at ${R.km} km · fixed when ratio ≥ ${RATIO_MIN} and that < λ/8`
  },
  legend: [
    { color: HIGH_V, label: 'GPS alone: metres', shape: 'dot' },
    { color: HEAT, label: 'Base corrections on the code: < 1 m', shape: 'dot' },
    { color: RING, label: 'RTK float: cycles N as decimals', shape: 'dot' },
    { color: POWER, label: 'RTK fixed: N whole, ~1 cm', shape: 'dot' },
  ],
  points: [
    'Most GPS error (ionosphere, satellite clock and orbit) is the same for two receivers a few km apart. A base station on a surveyed spot knows its true ranges, so it can measure each satellite’s error and radio it to the rover (RTCM messages).',
    'Code corrections alone get under a metre. For centimetres RTK tracks the carrier itself: the 1575.42 MHz wave is 19 cm long and its phase is read to ~2 mm.',
    'The catch: the phase says where you are inside a wave, not how many whole waves N lie between you and the satellite. At first N is estimated as a decimal: a float solution, decimetres.',
    'As epochs pile up the decimals tighten until rounding to whole numbers is clearly right (the ratio test). Then the fix snaps to ~1 cm. Past ~15 km the base’s sky differs too much, the residual blurs the cycles and it stays float.',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: (Object.keys(MODES) as Mode[]).map((k) => ({ value: k, label: MODES[k] })), initial: 'rtk' },
    { kind: 'slider', key: 'km', label: 'Base to rover', min: 1, max: 30, step: 1, initial: 5, format: (v) => `${v.toFixed(0)} km` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    box(scene, [30, 0.4, 8], mat('#2f3a2c', { rough: 0.95 }), [-6, RTK.base[1] - 0.2, -1])
    const B = RTK.base
    const steel = mat('#9aa0ab', { rough: 0.45, metal: 0.3 })
    const top: V3 = [B[0], B[1] + 4.2, B[2]]
    for (const a of [0, 2.1, 4.2]) {
      const leg = add(scene, shadowlessRod(steel))
      stretchRod(leg, [B[0] + Math.cos(a) * 1.6, B[1], B[2] + Math.sin(a) * 1.6], top, 0.07)
      leg.castShadow = true
    }
    cylinder(scene, 0.9, 0.4, mat('#f2f2f0', { rough: 0.4 }), add3(top, [0, 0.3, 0]), 'y', 24)
    box(scene, [1.4, 1, 0.8], mat('#2a2c32', { rough: 0.6 }), [B[0] + 1.6, B[1] + 0.5, B[2] + 0.6])
    const whip = add(scene, shadowlessRod(mat('#1c1c1f')))
    const whipTop: V3 = [B[0] + 2, B[1] + 3.4, B[2] + 0.6]
    stretchRod(whip, [B[0] + 2, B[1] + 1, B[2] + 0.6], whipTop, 0.05)
    add(scene, label('BASE', { size: 0.55, color: LABEL }), [B[0], B[1] - 1.1, B[2] + 2])
    add(scene, label('surveyed spot', { size: 0.4, color: GREY }), [B[0], B[1] - 2, B[2] + 2])
    const baseAnt = add3(top, [0, 0.6, 0])
    const rover = gpsRover(scene, RTK.rover, 0.7)
    add(scene, label('ROVER', { size: 0.55, color: LABEL }), [RTK.rover[0], RTK.rover[1] - 1.1, RTK.rover[2] + 2])
    const dashMat = glowMat(GREY, 0.4)
    for (let x0 = B[0] + 1.5; x0 < RTK.rover[0] - 1.5; x0 += 0.85) stretchRod(add(scene, shadowlessRod(dashMat)), [x0, B[1] + 0.05, B[2] + 3], [x0 + 0.45, B[1] + 0.05, B[2] + 3], 0.04)
    const kmTag = liveLabel(scene, [(B[0] + RTK.rover[0]) / 2 + 0.6, B[1] + 0.6, B[2] + 3], { size: 0.45 })

    const sats = RTK.sats.map((at, i) => {
      const m = satellite(scene, at, SAT_COLORS[i], 0.75)
      m.aim([(B[0] + RTK.rover[0]) / 2, B[1], 0])
      const toBase = add(scene, shadowlessRod(glowMat(SAT_COLORS[i], 0.35)))
      const toRover = add(scene, shadowlessRod(glowMat(SAT_COLORS[i], 0.35)))
      stretchRod(toBase, at, baseAnt, 0.03)
      if (i !== RTK.waveSat) stretchRod(toRover, at, rover.antenna, 0.03)
      toRover.visible = i !== RTK.waveSat
      return m
    })
    const wave = pointCloud(scene, 260, 0.09)
    const cycleTag = liveLabel(scene, add3(rover.antenna, [1.2, 2.6, 0]), { size: 0.45, align: 'left' })
    const phaseTag = liveLabel(scene, add3(rover.antenna, [1.2, 1.8, 0]), { size: 0.45, align: 'left' })

    const radio = ripples(scene, whipTop, { count: 3, reach: 2.2, period: 1 })
    const packets = packetPool(scene, 3, 0.45)

    const P = RTK.target
    const TR = RTK.targetR
    const ringMat = glowMat(GREY, 0.3)
    ;[0.01, 0.1, 1, 10].forEach((m, i) => {
      add(scene, mesh(new THREE.TorusGeometry(TR * logR(m), 0.03, 4, 72), ringMat), P)
      add(scene, label(['1 cm', '10 cm', '1 m', '10 m'][i], { size: 0.38, color: GREY }), add3(P, [TR * logR(m) * 0.72 + 0.25, -TR * logR(m) * 0.72 - 0.25, 0]))
    })
    add(scene, label('error, log scale', { size: 0.4, color: GREY }), add3(P, [0, TR + 0.9, 0]))
    const sigmaRing = add(scene, mesh(new THREE.TorusGeometry(1, 0.016, 6, 72), glowMat(POWER, 1)), P)
    const sigmaMat = sigmaRing.material as THREE.MeshStandardMaterial
    const cloud = pointCloud(scene, RTK.seconds, 0.13)
    const now = dot(scene, LABEL, 0.24, 1.4)

    const T0: V3 = [-18.5, 14.5, 0]
    const [stateText, ambText, baseText] = [0, 1, 2].map((i) => liveLabel(scene, [T0[0], T0[1] - i * 1.3, 0], { size: 0.55, align: 'left' }))
    const status = liveLabel(scene, [T0[0], T0[1] - 4.1, 0], { size: 0.4, align: 'left' })
    const s = { key: '', t: 0 }
    const satAt = RTK.sats[RTK.waveSat]
    const along = sub3(rover.antenna, satAt)
    const side = new THREE.Vector3(...along).cross(new THREE.Vector3(0, 0, 1)).normalize()
    return {
      scene,
      view: { center: [0, 2, 0], radius: 70, polar: 1.3, azimuth: 0 },
      frame(dt, p) {
        const R = rtkRun(p)
        const key = `${p.mode}|${p.km}`
        if (key !== s.key) Object.assign(s, { key, t: 0 })
        s.t += dt
        const cycle = RTK.seconds / RTK.speed + RTK.hold
        const tl = s.t % cycle
        const k = Math.min(RTK.seconds - 1, Math.floor(tl * RTK.speed))
        const e = R.epochs[k]
        const color = STATE_COLOR[e.state]

        const corr = R.mode !== 'single'
        radio(s.t, DATA_COLOR, corr ? 1 : 0)
        packets.begin()
        if (corr)
          for (let i = 0; i < 2; i++) {
            const u = (s.t * 0.6 + i / 2) % 1
            packets.put(arcAt(whipTop, rover.antenna, u, 2.5), DATA_COLOR, { w: 1.2, text: i ? '' : 'RTCM', fade: Math.min(1, 6 * u, 6 * (1 - u)) })
          }
        packets.end()
        sats.forEach((m, i) => m.glow(0.6 + 0.4 * Math.sin(s.t * 3 + i)))

        const phase = s.t * 1.5
        for (let i = 0; i < 260; i++) {
          const u = i / 259
          const a = 0.35 * Math.sin(2 * Math.PI * (u * RTK.waveCycles - phase))
          const pt = add3(add3(satAt, along, u), [side.x, side.y, side.z], a)
          const tail = u > 1 - 1 / RTK.waveCycles
          wave.set(i, pt, R.mode === 'rtk' ? (tail ? RING : B_FIELD) : GREY, tail && R.mode === 'rtk' ? 1.4 : 1)
        }
        wave.show(260)
        const cyc = carrierCycles(20_183e3 + 800 * e.t)
        cycleTag.set(R.mode !== 'rtk' ? 'carrier unused' : `N ${e.state === 'fixed' ? '=' : '≈'} ${cyc.n.toLocaleString('en')}${e.state === 'fixed' ? '' : ` ± ${e.amb.toFixed(1)}`}`, R.mode !== 'rtk' ? GREY : color)
        phaseTag.set(R.mode !== 'rtk' ? '' : `phase ${cyc.frac.toFixed(2)} cycle`, RING)
        setGlow(rover.led, color, 1.2)

        const pts = R.epochs.slice(0, k + 1)
        pts.forEach((q, i) => {
          const r = Math.hypot(q.err[0], q.err[1])
          const f = (TR * logR(r)) / Math.max(r, 1e-9)
          cloud.set(i, add3(P, [q.err[0] * f, q.err[1] * f, 0.05]), STATE_COLOR[q.state], i === k ? 0 : 0.9)
        })
        cloud.show(pts.length)
        const r = Math.hypot(e.err[0], e.err[1])
        const f = (TR * logR(r)) / Math.max(r, 1e-9)
        now.position.set(...add3(P, [e.err[0] * f, e.err[1] * f, 0.1]))
        sigmaRing.scale.setScalar(Math.max(0.05, TR * logR(e.sigma)))
        setGlow(sigmaMat, color, 1)

        kmTag.set(`${R.km} km (not to scale)`, R.km * RTK_PPM >= L1_LAMBDA / 8 && R.mode === 'rtk' ? HEAT : GREY)
        stateText.set(`${STATE_TEXT[e.state]}: ±${lenText(e.sigma)}`, color)
        ambText.set(
          R.mode === 'rtk' ? (e.state === 'fixed' ? `whole cycles locked (ratio ${e.ratio.toFixed(1)})` : `ratio test ${e.ratio.toFixed(1)} (need ≥ ${RATIO_MIN})`) : R.mode === 'dgps' ? 'corrections cancel shared errors' : 'no base: every error stays in',
          R.mode === 'rtk' ? color : GREY,
        )
        const res = RTK_PPM * R.km
        baseText.set(corr ? `${R.km} km baseline leaves ${lenText(res)}${R.mode === 'rtk' && res >= L1_LAMBDA / 8 ? ` > λ/8: never fixes` : ''}` : `base ignored`, R.mode === 'rtk' && res >= L1_LAMBDA / 8 ? HEAT : GREY)
        status.set(`t = ${e.t} s · 1 epoch/s · ${RTK.speed}× real time · HDOP ${RTK_HDOP.toFixed(1)}, 8 satellites`, GREY)
      },
      readouts: (p) => {
        const R = rtkRun(p)
        const L = R.last
        return [
          { label: 'Solution after 90 s', value: STATE_TEXT[L.state], tone: L.state === 'fixed' ? 'ok' : L.state === 'single' ? 'bad' : 'warn' },
          { label: 'Horizontal 1σ', value: lenText(L.sigma), tone: L.sigma < 0.05 ? 'ok' : L.sigma < 1 ? 'warn' : 'bad' },
          { label: 'Time to fix', value: R.mode !== 'rtk' ? '—' : R.fixAt >= 0 ? `${R.fixAt} s` : 'no fix', tone: R.mode !== 'rtk' || R.fixAt >= 0 ? 'ok' : 'bad' },
          { label: 'Carrier wavelength', value: `${(L1_LAMBDA * 100).toFixed(1)} cm` },
        ]
      },
    }
  },
}
