import * as THREE from 'three/webgpu'
import {
  DEPTH_HOLE, DEPTH_SENSORS, DepthSensor, P3, RenderScene, backProject, camTf, chain4, trans4, depthShot, depthStep, depthView, dotHits, edgePixels, intrinsicsOf, isStereo, tofSigmaM, tofWrapM, voxelGrid,
} from '../../core/physics'
import { V3, add, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD, GREY, HEAT, HIGH_V, IR_TINT, LABEL, POWER, RING, addLabel, camBody, flatBox, glowMat, liveLabel, memoBy, pixelGrid, pointCloud, ringMarks, rodPool, setTf, shellMat, showImg, statusHeader, zUp,
} from '../fx'
import { Lesson, LegendItem, Params, Stage, n, opts, pick } from '../types'
import { frustum } from './camera-model'

const f0 = (v: number) => v.toFixed(0)
const f1 = (v: number) => v.toFixed(1)
const cm = (m: number) => (m >= 1 ? `${m.toFixed(2)} m` : m >= 0.01 ? `${f1(m * 100)} cm` : `${f1(m * 1000)} mm`)

// --- Shared room: a plain box, a speckled ball and a brick wall in front of a depth camera 30 cm up. ---

const K = intrinsicsOf(80, 60, 50)
const RIG = camTf([0, 0, 0.3], 0, 0.12)
const WALL = 2.4
const FLOOR_Y: [number, number] = [-1.3, 1.3]
const TILE = 0.25
const BOX = { y: [-0.5, -0.12] as [number, number], h: 0.42, half: 0.15, rgb: [150, 165, 185] as [number, number, number] }
const BALL = { c: [1.25, 0.3, 0.16] as P3, r: 0.16, rgb: [235, 120, 50] as [number, number, number] }
const Z_RANGE: [number, number] = [0.3, 2.6]
const PHI_NOISE = 0.01
const DOT_PITCH = 0.05
const roomScene = (dist: number): RenderScene => ({
  floor: { tile: TILE, a: [118, 112, 100], b: [70, 74, 82], x: [0, WALL], y: FLOOR_Y },
  wallX: WALL,
  light: [-0.55, 0.3, 0.78],
  blocks: [{ min: [dist - BOX.half, BOX.y[0], 0], max: [dist + BOX.half, BOX.y[1], BOX.h], rgb: BOX.rgb }],
  balls: [{ c: BALL.c, r: BALL.r, rgb: BALL.rgb, speckle: 48 }],
})

const SHOW = { depth: 'Depth map', error: 'Error map' }
const sensorOf = (p: Params): DepthSensor => pick(DEPTH_SENSORS, p.sensor, 'passive')
const fHz = (s: DepthSensor) => (s === 'tof100' ? 100e6 : 20e6)

const shotKey = (p: Params) => [sensorOf(p), p.base ?? 10, p.dist].join('|')
const shotOf = memoBy(shotKey, (p: Params) => {
  const sensor = sensorOf(p)
  const base = Number(p.base ?? 10) / 100
  const dist = n(p, 'dist')
  const sc = roomScene(dist)
  const s = depthShot(K, RIG, sc, sensor, { baseM: base, r: 2, maxD: Math.min(48, Math.ceil((K.fx * base) / 0.3)), noise: 2, dotPitch: DOT_PITCH, phiNoise: PHI_NOISE })
  const err = s.z.map((z, i) => (z > 0 && s.truth[i] > 0 ? z - s.truth[i] : NaN))
  const valid = err.filter((e) => !Number.isNaN(e))
  const abs = valid.map(Math.abs).sort((a, b) => a - b)
  const bad = Array.from(err).filter((e, i) => Math.abs(e) > 0.1 * s.truth[i]).length
  const count = (h: number) => s.hole.filter((x) => x === h).length
  return {
    sensor, base, dist, sc, ...s, err, bad,
    valid: valid.length,
    median: abs.length ? abs[Math.floor(abs.length / 2)] : 0,
    flat: count(DEPTH_HOLE.unclear),
    lr: count(DEPTH_HOLE.lr),
    weak: count(DEPTH_HOLE.weak),
    rgb: depthView(K, s.cam, sc).img,
    wallStep: isStereo(sensor) ? depthStep(K.fx, base, WALL, 0.25) : tofSigmaM(fHz(sensor), PHI_NOISE / Math.sqrt(0.6 / WALL ** 2)),
    dots: sensor === 'active' ? dotHits(RIG, sc, DOT_PITCH, Math.tan((25 * Math.PI) / 180), 0.36) : [],
  }
})
type Shot = ReturnType<typeof shotOf>

const STOPS: [number, number, number][] = [[255, 236, 110], [250, 150, 50], [226, 64, 92], [128, 64, 186], [44, 76, 168]]
/** Depth heat colour, sRGB 0…1: yellow near → blue far. */
function depthRgb(z: number): [number, number, number] {
  const t = Math.min(0.9999, Math.max(0, (z - Z_RANGE[0]) / (Z_RANGE[1] - Z_RANGE[0]))) * (STOPS.length - 1)
  const [i, f] = [Math.floor(t), t - Math.floor(t)]
  return [0, 1, 2].map((c) => (STOPS[i][c] + (STOPS[i + 1][c] - STOPS[i][c]) * f) / 255) as [number, number, number]
}
const HOLE_RGB: [number, number, number] = [0.07, 0.07, 0.09]
const hex = (h: string) => new THREE.Color(h)
const [OK_C, NEAR_C, FAR_C] = [hex(POWER), hex(B_FIELD), hex(HIGH_V)]
/** Error colour: green within 2 %, toward cyan (reads too near) or red (too far) by 15 %. */
function errRgb(e: number, z: number): [number, number, number] {
  const rel = e / Math.max(z, 0.05)
  const c = OK_C.clone().lerp(rel < 0 ? NEAR_C : FAR_C, Math.min(1, Math.max(0, (Math.abs(rel) - 0.02) / 0.13)))
  return [c.r, c.g, c.b]
}
const pixelRgb = (S: Shot, i: number, show: keyof typeof SHOW): [number, number, number] =>
  !(S.z[i] > 0) ? HOLE_RGB : show === 'error' ? (Number.isNaN(S.err[i]) ? HOLE_RGB : errRgb(S.err[i], S.truth[i])) : depthRgb(S.z[i])

/** The room in z-up metres: floor tiles, wall, box, ball, camera rig with projector/emitter, frustum rods; `set(S)` moves things. */
function roomModel(g: THREE.Object3D, ghost: boolean) {
  const m = (c: string) => (ghost ? shellMat(c, 0.28, 0.6) : mat(c, { rough: 0.85 }))
  for (let i = 0; i < Math.ceil(WALL / TILE); i++)
    for (let j = Math.floor(FLOOR_Y[0] / TILE); j < Math.ceil(FLOOR_Y[1] / TILE); j++)
      flatBox(g, [TILE, TILE, 0.004], mat((i + j) % 2 !== 0 ? '#464a52' : '#767064', { rough: 0.85 }), [(i + 0.5) * TILE, (j + 0.5) * TILE, ghost ? -0.015 : -0.002])
  flatBox(g, [0.04, FLOOR_Y[1] - FLOOR_Y[0], 0.9], m('#d6cdb8'), [WALL + 0.02, 0, 0.45])
  const box = add(g, mesh(new THREE.BoxGeometry(2 * BOX.half, BOX.y[1] - BOX.y[0], BOX.h), m('#96a5b9')))
  const ball = add(g, mesh(new THREE.SphereGeometry(BALL.r, 28, 18), m('#eb7832')), BALL.c as V3)
  box.castShadow = ball.castShadow = !ghost
  const camL = add(g, new THREE.Group())
  const camR = add(g, new THREE.Group())
  camBody(camL, 0.05)
  camBody(camR, 0.05)
  const emitter = add(g, new THREE.Group())
  const glow = glowMat(IR_TINT, 0.8)
  add(emitter, mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02), mat('#2a2c32', { rough: 0.4 })), [0, 0, -0.01])
  add(emitter, mesh(new THREE.CircleGeometry(0.012, 20), glow), [0, 0, 0.002]).castShadow = false
  const rods = rodPool(g, 8)
  const dots = pointCloud(g, 400, 0.012)
  return {
    glow,
    set(S: Shot) {
      box.position.set(S.dist, (BOX.y[0] + BOX.y[1]) / 2, BOX.h / 2)
      const stereo = isStereo(S.sensor)
      camR.visible = stereo
      emitter.visible = S.sensor !== 'passive'
      setTf(camL, S.cam)
      if (stereo) setTf(camR, chain4(S.cam, trans4([S.base, 0, 0])))
      setTf(emitter, stereo ? RIG : chain4(RIG, trans4([0.05, 0, 0])))
      frustum(rods, 0, K, S.cam, 0.3, 0.005, RING)
      rods.commit()
      if (!ghost) S.dots.forEach((p, i) => i < 400 && dots.set(i, p as V3, IR_TINT))
      dots.show(ghost ? 0 : S.dots.length)
    },
  }
}

const LEGEND_COMMON: LegendItem[] = [
  { color: RING, label: 'Depth camera (left one for stereo)', shape: 'dot' },
  { color: IR_TINT, label: 'IR dot projector / ToF emitter', shape: 'dot' },
]

const sensorControl = { kind: 'choice' as const, key: 'sensor', options: opts(DEPTH_SENSORS), initial: 'passive' }
const distControl = { kind: 'slider' as const, key: 'dist', label: 'Box distance', min: 0.5, max: 1.9, step: 0.05, initial: 0.9, format: (v: number) => cm(v) }

/** Probe pixel for time `t` (0…1 loop): sweeps rows 18, 30, 42 left to right. */
function probeAt(t: number) {
  const rows = [18, 30, 42]
  const k = Math.min(rows.length - 1, Math.floor(t * rows.length))
  return { u: Math.min(K.w - 1, Math.floor((t * rows.length - k) * K.w)), v: rows[k] }
}

// --- Depth map: every pixel gets a distance; stereo matches blocks, ToF times modulated light. ---

const DM = { at: [-14.4, -5.0, 0] as V3, k: 7.0, img: [-0.1, -0.5, 0] as V3, map: [7.8, -0.5, 0] as V3, pitch: 0.09, bar: 0.18 }

export const depthSensingDepthMap: Lesson = {
  id: 'depth-sensing-depth-map',
  title: 'Depth map',
  tagline: 'A depth camera gives every pixel a distance instead of a colour. Stereo finds it by matching blocks between two images, a ToF camera by timing modulated light, and each fails in its own places',
  formula: (p) => {
    const S = shotOf(p)
    return isStereo(S.sensor)
      ? `every pixel: best 5 × 5 block match d (¼ px) → Z = fx·B / d = ${f0(K.fx)} px × ${f0(S.base * 100)} cm / d · step at the wall ΔZ ≈ Z²·¼ / (fx·B) = ±${cm(S.wallStep)}`
      : `every pixel: phase φ of the returned ${fHz(S.sensor) / 1e6} MHz light → r = c·φ / (4π f), wraps every c / 2f = ${cm(tofWrapM(fHz(S.sensor)))} · noise at the wall ±${cm(S.wallStep)}`
  },
  legend: (p) => [
    ...LEGEND_COMMON,
    ...(pick(SHOW, p.show, 'depth') === 'error'
      ? [
          { color: POWER, label: 'Within 2 % of true depth, black = hole', shape: 'dot' as const },
          { color: HIGH_V, label: 'Reads too far / cyan: too near', shape: 'dot' as const },
        ]
      : [{ color: HEAT, label: 'Yellow near → blue far, black = hole', shape: 'dot' as const }]),
  ],
  points: [
    'A depth image stores z, the distance along the camera axis, per pixel; a wall square to the camera is one colour. Holes (black) are pixels the sensor refuses to guess.',
    'Stereo (Camera model → Stereo depth did one ball): match a 5 × 5 block for every pixel along its row and take Z = f·B/d. Plain surfaces (the box, flat floor tiles) give no texture to match, and the left-right check fails where only one camera sees: both become holes.',
    'Active stereo (RealSense D4xx, OAK-D Pro) sprays IR dots so plain surfaces get texture. Depth still comes from triangulation, so the error grows as Z²/(f·B): watch the far wall in the error map. A wider baseline helps far away but widens the occlusion holes and the blind zone up close.',
    'A ToF camera floods the room with light flickering at f and measures each pixel\'s phase lag: r = c·φ/(4πf). The phase repeats every c/2f: at 100 MHz that is 1.5 m, so the 2.4 m wall reads about 0.9 m. 20 MHz reaches 7.5 m but is 5× noisier; real cameras combine two frequencies.',
    'ToF pixels on an edge see both surfaces and report a depth in between ("flying pixels"); light bouncing off a second surface (multipath) makes corners read far. The single-beam versions live in Sensors: Ultrasonic, Time-of-flight laser, LiDAR.',
  ],
  controls: [
    sensorControl,
    { kind: 'choice', key: 'show', options: opts(SHOW), initial: 'depth' },
    { kind: 'slider', key: 'base', label: 'Stereo baseline', min: 4, max: 20, step: 1, initial: 10, format: (v) => `${v} cm` },
    distControl,
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = zUp(scene, DM.at, DM.k, 0.42, 0.95)
    const room = roomModel(g, false)
    const probe = rodPool(g, 1)
    const img = pixelGrid(scene, DM.img, K.w, K.h, DM.pitch)
    const map = pixelGrid(scene, DM.map, K.w, K.h, DM.pitch)
    const top = (K.h * DM.pitch) / 2 + 0.45
    const imgTag = liveLabel(scene, [DM.img[0], DM.img[1] + top, 0], { size: 0.3 })
    const mapTag = liveLabel(scene, [DM.map[0], DM.map[1] + top, 0], { size: 0.3 })
    const barAt: V3 = [DM.map[0], DM.map[1] - top - 0.05, 0]
    const bar = pixelGrid(scene, barAt, 40, 1, DM.bar)
    const barL = liveLabel(scene, [barAt[0] - 20 * DM.bar, barAt[1] - 0.55, 0], { size: 0.26, color: GREY, align: 'left' })
    const barR = liveLabel(scene, [barAt[0] + 20 * DM.bar, barAt[1] - 0.55, 0], { size: 0.26, color: GREY, align: 'right' })
    const probeTag = liveLabel(scene, [DM.img[0], DM.img[1] - top - 0.35, 0], { size: 0.28 })
    const rings = ringMarks(scene, 2, 0.3)
    const st = { key: '', t: 0, pu: -1 }
    return {
      scene,
      view: { center: [-2.4, -0.8, 0], radius: 50, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = shotOf(p)
        const show = pick(SHOW, p.show, 'depth')
        st.t = (st.t + dt / 9) % 1
        room.glow.emissiveIntensity = 0.5 + 0.4 * Math.sin(st.t * 160)
        const key = `${shotKey(p)}|${show}`
        const pr = probeAt(st.t)
        if (key !== st.key) {
          st.key = key
          st.pu = -1
          room.set(S)
          showImg(img, S.seen)
          for (let i = 0; i < K.w * K.h; i++) map.set(i, ...pixelRgb(S, i, show))
          map.commit()
          for (let i = 0; i < 40; i++) {
            const t = (i + 0.5) / 40
            bar.set(i, ...(show === 'error' ? errRgb((t - 0.5) * 0.4, 1) : depthRgb(Z_RANGE[0] + t * (Z_RANGE[1] - Z_RANGE[0]))))
          }
          bar.commit()
          barL.set(show === 'error' ? '−20 %: too near' : `${cm(Z_RANGE[0])} near`, GREY)
          barR.set(show === 'error' ? 'too far: +20 %' : `${cm(Z_RANGE[1])} far`, GREY)
          imgTag.set(isStereo(S.sensor) ? `left ${S.sensor === 'active' ? 'IR ' : ''}camera, ${K.w} × ${K.h}` : 'ToF amplitude (returned light)', LABEL)
          mapTag.set(show === 'error' ? 'error map: measured − true depth' : 'depth map', LABEL)
          const tot = K.w * K.h
          status.set(`${DEPTH_SENSORS[S.sensor]} · ${K.w} × ${K.h} px, ${f0(K.fx)} px focal · box ${cm(S.dist)} away, wall ${cm(WALL)}`, LABEL)
          sub.set(isStereo(S.sensor) ? `baseline ${f0(S.base * 100)} cm · holes: ${f0((100 * S.flat) / tot)} % too plain, ${f0((100 * S.lr) / tot)} % failed left-right check` : `wraps every ${cm(tofWrapM(fHz(S.sensor)))} · ${f0((100 * S.weak) / tot)} % too weak`, GREY)
          const badPct = (100 * S.bad) / Math.max(1, S.valid)
          event.set(
            S.sensor === 'tof100' ? 'the wall is past the 1.5 m wrap: it reads near (phase went round once)' : badPct > 15 ? `${f0(badPct)} % of the depths are off by > 10 %` : S.sensor === 'passive' && S.flat > 0.3 * tot ? 'plain box and tiles: nothing to match, so holes instead of guesses' : `${f0(badPct)} % off by > 10 %, median error ${cm(S.median)}`,
            S.sensor === 'tof100' || badPct > 15 ? HIGH_V : S.sensor === 'passive' ? HEAT : POWER,
          )
        }
        if (pr.u === st.pu) return
        st.pu = pr.u
        const i = pr.v * K.w + pr.u
        const z = S.z[i]
        const end = backProject(K, S.cam, pr.u, pr.v, z > 0 ? z : S.truth[i] || 3) as V3
        probe.set(0, [S.cam[3], S.cam[7], S.cam[11]], end, 0.006, z > 0 ? LABEL : GREY)
        probe.commit()
        for (const [j, grid] of [img, map].entries()) rings.set(j, grid.cell(pr.u, pr.v).map((x, a) => (a === 2 ? x + 0.1 : x)) as V3, 0.16, RING)
        rings.commit()
        probeTag.set(`pixel (${pr.u}, ${pr.v}): ${z > 0 ? `z = ${cm(z)}` : 'hole'} · true ${S.truth[i] > 0 ? cm(S.truth[i]) : '–'}`, z > 0 ? LABEL : GREY)
      },
      readouts: (p) => {
        const S = shotOf(p)
        const badPct = (100 * S.bad) / Math.max(1, S.valid)
        return [
          { label: 'Pixels with a depth', value: `${f0((100 * S.valid) / (K.w * K.h))} %`, tone: S.valid > 0.8 * K.w * K.h ? 'ok' : S.valid > 0.5 * K.w * K.h ? 'warn' : 'bad' },
          { label: 'Median error', value: cm(S.median), tone: S.median < 0.02 ? 'ok' : S.median < 0.06 ? 'warn' : 'bad' },
          { label: 'Off by more than 10 %', value: `${f0(badPct)} %`, tone: badPct < 3 ? 'ok' : badPct < 15 ? 'warn' : 'bad' },
          { label: isStereo(S.sensor) ? 'Depth step at the wall' : 'Noise at the wall', value: `±${cm(S.wallStep)}` },
        ]
      },
    }
  },
}

// --- Point cloud: back-project each depth pixel through K and the camera pose. ---

const CLEAN = { raw: 'Raw', edges: 'Drop flying pixels', voxel: 'Drop + 4 cm voxels' }
const COLOUR = { error: 'Colour: error', depth: 'Colour: depth', image: 'Colour: camera' }
const PC = { at: [-12.2, -5.4, 0] as V3, k: 5.7, map: [8.0, -0.2, 0] as V3, pitch: 0.08, voxel: 0.04 }

/** Voxel-grid the points, each voxel coloured with the mean of its points' colours. */
function voxelMix(pts: P3[], rgbs: [number, number, number][]) {
  const ch = [0, 1, 2].map((c) => voxelGrid(pts, PC.voxel, rgbs.map((x) => x[c])))
  return ch[0].map((v, i) => ({ p: v.p, rgb: [v.v, ch[1][i].v, ch[2][i].v] as [number, number, number] }))
}

const cloudKey = (p: Params) => [shotKey(p), p.clean, p.colour].join('|')
const cloudOf = memoBy(cloudKey, (p: Params) => {
  const S = shotOf(p)
  const clean = pick(CLEAN, p.clean, 'raw')
  const colour = pick(COLOUR, p.colour, 'error')
  const fly = edgePixels(K.w, K.h, S.z)
  const keep: number[] = []
  for (let i = 0; i < K.w * K.h; i++) if (S.z[i] > 0 && (clean === 'raw' || !fly[i])) keep.push(i)
  const pts = keep.map((i) => backProject(K, S.cam, i % K.w, Math.floor(i / K.w), S.z[i]))
  const errs = keep.map((i) => S.err[i])
  const rgbOf = (i: number, e: number): [number, number, number] =>
    colour === 'error' ? (Number.isNaN(e) ? [0.5, 0.5, 0.55] : errRgb(e, S.truth[i])) : colour === 'depth' ? depthRgb(S.z[i]) : [0, 1, 2].map((c) => S.rgb.data[3 * i + c] / 255) as [number, number, number]
  const out =
    clean === 'voxel'
      ? voxelMix(pts, keep.map((i, j) => rgbOf(i, errs[j])))
      : keep.map((i, j) => ({ p: pts[j], rgb: rgbOf(i, errs[j]) }))
  const abs = errs.filter((e) => !Number.isNaN(e)).map(Math.abs).sort((a, b) => a - b)
  return { clean, colour, out, raw: S.valid, flying: Array.from(fly).filter((f, i) => f && S.z[i] > 0).length, median: abs.length ? abs[Math.floor(abs.length / 2)] : 0 }
})

export const depthSensingPointCloud: Lesson = {
  id: 'depth-sensing-point-cloud',
  title: 'Point cloud',
  tagline: 'Run the pinhole model backwards: each depth pixel plus its z is one 3D point. The cloud lands on the real surfaces, with the sensor\'s noise, holes and flying pixels in plain view',
  formula: () => `X = (u − ${f1(K.cx)})·z / ${f1(K.fx)} · Y = (v − ${f1(K.cy)})·z / ${f1(K.fy)} · Z = z → world = T_world←cam · [X Y Z 1]ᵀ, one point per valid pixel`,
  legend: [
    { color: RING, label: 'Depth camera and the probe pixel', shape: 'dot' },
    { color: LABEL, label: 'Ray from the camera through that pixel', shape: 'dot' },
    { color: POWER, label: 'Point within 2 % (error colours)', shape: 'dot' },
    { color: HIGH_V, label: 'Too far / cyan: too near', shape: 'dot' },
  ],
  points: [
    'Back-projection is the pinhole model (Camera model) run backwards: pixel (u, v) and its depth z give X = (u − cx)·z/fx, Y = (v − cy)·z/fy, Z = z in the camera frame; the camera pose puts the point in the room.',
    'One point per valid pixel, so an 80 × 60 depth image gives up to 4800 points. A pixel covers z/f metres, so far surfaces get sparser points; stereo depth noise grows as z² (the far wall turns into a thick slab).',
    'Flying pixels sit in the air between an edge and what is behind it. A simple filter drops any pixel whose neighbour\'s depth jumps by more than 10 %.',
    'A voxel grid keeps one averaged point per 4 cm cube: fewer points, less noise and an even density, ready for an occupancy grid or obstacle check. A spinning LiDAR (Sensors: LiDAR, Point clouds) gives the same kind of data, sparser but much farther.',
  ],
  controls: [
    { ...sensorControl, initial: 'active' },
    { kind: 'choice', key: 'clean', options: opts(CLEAN), initial: 'raw' },
    { kind: 'choice', key: 'colour', options: opts(COLOUR), initial: 'error' },
    distControl,
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const { status, sub, event } = statusHeader(scene)
    const g = zUp(scene, PC.at, PC.k, 0.5, 0.75)
    const room = roomModel(g, true)
    const cloud = pointCloud(g, K.w * K.h, 0.009)
    const probe = rodPool(g, 1)
    const hitMark = pointCloud(g, 1, 0.03)
    const map = pixelGrid(scene, PC.map, K.w, K.h, PC.pitch)
    const top = (K.h * PC.pitch) / 2 + 0.45
    addLabel(scene, 'depth map', [PC.map[0], PC.map[1] + top, 0], LABEL, 0.3)
    const probeTag = liveLabel(scene, [PC.map[0], PC.map[1] - top - 0.1, 0], { size: 0.26 })
    const probeTag2 = liveLabel(scene, [PC.map[0], PC.map[1] - top - 0.6, 0], { size: 0.26, color: GREY })
    const ring = ringMarks(scene, 1, 0.3)
    const st = { key: '', t: 0, pu: -1 }
    return {
      scene,
      view: { center: [-2.4, -0.8, 0], radius: 50, polar: Math.PI / 2, azimuth: 0 },
      frame(dt, p) {
        const S = shotOf(p)
        const C = cloudOf(p)
        st.t = (st.t + dt / 9) % 1
        room.glow.emissiveIntensity = 0.5 + 0.4 * Math.sin(st.t * 160)
        const key = cloudKey(p)
        if (key !== st.key) {
          st.key = key
          st.pu = -1
          room.set(S)
          C.out.forEach((o, i) => cloud.set(i, o.p as V3, new THREE.Color().setRGB(...o.rgb, THREE.SRGBColorSpace), C.clean === 'voxel' ? 1.8 : 1))
          cloud.show(C.out.length)
          for (let i = 0; i < K.w * K.h; i++) map.set(i, ...pixelRgb(S, i, 'depth'))
          map.commit()
          status.set(`${DEPTH_SENSORS[S.sensor]} · ${K.w} × ${K.h} depth image → ${C.out.length} ${C.clean === 'voxel' ? 'voxel ' : ''}points`, LABEL)
          sub.set(`${S.valid} valid pixels · ${C.flying} on depth edges${C.clean === 'raw' ? '' : ' (dropped)'} · median error ${cm(C.median)}`, GREY)
          event.set(
            S.sensor === 'tof100' ? 'wrapped phase: the wall\'s points land 1.5 m too near, floating in mid-room' : C.clean === 'raw' && C.flying > 150 ? 'streaks behind edges: flying pixels between surfaces' : C.clean === 'voxel' ? 'one averaged point per 4 cm cube: even, lighter, less noisy' : 'points sit on the real surfaces',
            S.sensor === 'tof100' ? HIGH_V : C.clean === 'raw' && C.flying > 150 ? HEAT : POWER,
          )
        }
        const pr = probeAt(st.t)
        if (pr.u === st.pu) return
        st.pu = pr.u
        const i = pr.v * K.w + pr.u
        const z = S.z[i]
        const end = backProject(K, S.cam, pr.u, pr.v, z > 0 ? z : S.truth[i] || 3)
        probe.set(0, [S.cam[3], S.cam[7], S.cam[11]], end as V3, 0.005, z > 0 ? LABEL : GREY)
        probe.commit()
        if (z > 0) hitMark.set(0, end as V3, RING)
        hitMark.show(z > 0 ? 1 : 0)
        ring.set(0, map.cell(pr.u, pr.v).map((x, a) => (a === 2 ? x + 0.1 : x)) as V3, 0.15, RING)
        ring.commit()
        probeTag.set(`pixel (${pr.u}, ${pr.v}) ${z > 0 ? `z = ${cm(z)}` : 'hole: no point'}`, z > 0 ? LABEL : GREY)
        const c = [((pr.u - K.cx) * z) / K.fx, ((pr.v - K.cy) * z) / K.fy, z]
        probeTag2.set(z > 0 ? `camera (X, Y, Z) = (${c.map((x) => x.toFixed(2)).join(', ')}) m` : '', GREY)
      },
      readouts: (p) => {
        const S = shotOf(p)
        const C = cloudOf(p)
        return [
          { label: 'Points', value: `${C.out.length} of ${K.w * K.h} pixels` },
          { label: 'Median depth error', value: cm(C.median), tone: C.median < 0.02 ? 'ok' : C.median < 0.06 ? 'warn' : 'bad' },
          { label: 'Edge pixels (jump > 10 %)', value: `${C.flying}${C.clean === 'raw' ? ' kept' : ' dropped'}`, tone: C.clean === 'raw' && C.flying > 150 ? 'warn' : 'ok' },
          { label: 'Holes', value: `${K.w * K.h - S.valid} px`, tone: S.valid > 0.8 * K.w * K.h ? 'ok' : 'warn' },
        ]
      },
    }
  },
}
