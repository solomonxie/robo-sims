import * as THREE from 'three/webgpu'
import {
  DEG,
  GL5528,
  LAMP_FOLLOW,
  LAMP_MID,
  LAMP_MOTIONS,
  LAMP_MOUNTS,
  LAMP_PAIRS,
  LAMP_ROOMS,
  LAMP_WIRINGS,
  LampMotion,
  LampMount,
  LampPair,
  LampRoom,
  LampSample,
  LampWiring,
  SERVO_DEG_PER_S,
  fixedStepAt,
  lampDirectLux,
  lampEye,
  lampFollowRun,
  lampFollowStats,
  lampNull,
  lampShade,
} from '../../core/physics'
import { fixedText, ohms, volts } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'

import {
  B_FIELD,
  FACE_VIEW,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  SUN_TINT,
  addLabel,
  boxScope,
  codeBlock,
  cursorBar,
  headerStage,
  lapseClock,
  lightRay,
  liveLabel,
  memoBy,
  setGlow,
  sg90Servo,
  traceRun,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const signedDeg = (v: number, d = 0) => `${v > 0.05 ? '+' : v < -0.05 ? '−' : ''}${fixedText(Math.abs(v), d)}°`
const luxText = (l: number) => `${l >= 100 ? Math.round(l) : fixedText(l, l >= 10 ? 0 : 1)} lux`
const LAMP_R = 6.4
const CDS = '#d0782f'

/** Tilted desk: SG90 with an LDR pair on its horn (pivot at the origin, forward +y), an LED lamp on an arc, a window
 *  behind that glows with the room light; `set(lamp°, head°, lux, room)` moves and lights it. */
function deskRig(scene: THREE.Object3D, at: V3, k = 1) {
  const g = add(scene, new THREE.Group(), at)
  g.rotation.x = -0.75
  g.scale.setScalar(k)
  box(g, [15.5, 11, 0.3], mat('#6b4f3a', { rough: 0.85 }), [0, 2.4, -0.15]).receiveShadow = true
  const sunMat = new THREE.MeshStandardMaterial({ color: '#2a3140', emissive: SUN_TINT, emissiveIntensity: 0 })
  box(g, [9, 0.2, 3.2], sunMat, [0, 8.1, 1.6])
  const horn = sg90Servo(g, [0.75, 0, 1.1])
  const head = add(horn, new THREE.Group(), [0, 0.3, 0.25])
  box(head, [2.8, 1.2, 0.12], mat('#1f6b3a', { rough: 0.5 }), [0, 0.2, 0.06])
  const wall = box(head, [0.12, 1.9, 1.0], mat('#141418', { rough: 0.7 }), [0, 1.2, 0.6])
  const ldrMats = [0, 1].map(() => new THREE.MeshStandardMaterial({ color: CDS, roughness: 0.4, emissive: SUN_TINT, emissiveIntensity: 0 }))
  const ldrs = [1, -1].map((side, i) => {
    const o = add(head, new THREE.Group(), [-side * 0.42, 0.45, 0.6])
    cylinder(o, 0.32, 0.16, ldrMats[i], [0, 0, 0], 'y', 24)
    box(o, [0.5, 0.04, 0.06], mat('#3a2a1c'), [0, 0.09, 0.08])
    box(o, [0.5, 0.04, 0.06], mat('#3a2a1c'), [0, 0.09, -0.08])
    return o
  })
  const lamp = add(g, new THREE.Group())
  const black = mat('#24262c', { rough: 0.5 })
  cylinder(lamp, 0.9, 0.3, black, [0, 0, 0.15], 'z', 24)
  box(lamp, [0.18, 0.18, 2.8], black, [0, 0, 1.6])
  const shade = add(lamp, new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.2, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#d9dde4', roughness: 0.4, side: THREE.DoubleSide })), [0, -0.4, 3.1])
  shade.rotation.x = Math.PI
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4d6', emissiveIntensity: 1.6 })
  const bulb = add(lamp, new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), bulbMat), [0, -0.75, 3.1])
  const rays = [lightRay(g, 14, 0.11, 0.9), lightRay(g, 14, 0.11, 0.9)]
  const v = new THREE.Vector3()
  const local = (o: THREE.Object3D): V3 => {
    o.getWorldPosition(v)
    g.worldToLocal(v)
    return [v.x, v.y, v.z]
  }
  return {
    group: g,
    mount(m: LampMount) {
      wall.visible = LAMP_MOUNTS[m].wallMm > 0
      ldrs.forEach((o, i) => (o.rotation.z = (i === 0 ? 1 : -1) * LAMP_MOUNTS[m].toeDeg * DEG))
    },
    set(lampDeg: number, headDeg: number, lux: readonly number[], roomLux: number, t: number) {
      const a = lampDeg * DEG
      lamp.position.set(-LAMP_R * Math.sin(a), LAMP_R * Math.cos(a), 0)
      lamp.rotation.z = a
      horn.rotation.z = headDeg * DEG
      sunMat.emissiveIntensity = Math.min(1.4, roomLux / 1000)
      const e0 = lampDirectLux()
      const src = local(bulb)
      ldrs.forEach((o, i) => {
        ldrMats[i].emissiveIntensity = 0.9 * Math.min(1, Math.log10(Math.max(1, lux[i])) / Math.log10(2500))
        rays[i]([src, local(o)], t, Math.max(0, (lux[i] - roomLux) / e0) * 1.2, RING)
      })
    },
  }
}

// --- LDR pair: where the two LDRs face, how well they match, how they are wired, and how bright the room is. ---

const MOUNT_NAMES = namesOf(LAMP_MOUNTS)
const PAIR_NAMES = namesOf(LAMP_PAIRS)
const WIRING_NAMES = namesOf(LAMP_WIRINGS)
const ROOM_NAMES = namesOf(LAMP_ROOMS)
const lpParams = (p: Params) => ({
  phi: n(p, 'phi'),
  mount: pick(MOUNT_NAMES, p.mount, 'flat') as LampMount,
  pair: pick(PAIR_NAMES, p.pair, 'matched') as LampPair,
  wiring: pick(WIRING_NAMES, p.wiring, 'two') as LampWiring,
  room: pick(ROOM_NAMES, p.room, 'dark') as LampRoom,
})
type LpQ = ReturnType<typeof lpParams>
const lpKey = (q: LpQ) => `${q.mount}|${q.pair}|${q.wiring}|${q.room}`
const nullOf = memoBy(lpKey, (q: LpQ) => lampNull(q))
const restText = (q: LpQ) => {
  const z = nullOf(q)
  if (z.deg === null) return z.offset === 0 ? 'anywhere: no signal' : `never: always turns ${z.offset > 0 ? 'left' : 'right'}`
  return `${signedDeg(z.deg, 1)} ± ${fixedText(LAMP_FOLLOW.deadCounts / Math.max(z.slope, 1e-6), 1)}°`
}
const RP = { x: 6.2, y: 1.2, w: 12, h: 3.4 }
const EP = { x: 6.2, y: -5.0, w: 12, h: 3.4 }
const ERR_MAX = 3000
const RIG1: V3 = [-9.6, -3.8, 0]

export const deskLampTrackerLdrPair: Lesson = {
  id: 'desk-lamp-tracker-ldr-pair',
  title: 'LDR pair',
  tagline: 'Two light-dependent resistors on a servo horn: they only tell left from right with a wall or a toe-out between them, a matched pair, and wiring that copes with a bright room',
  formula: (p) => {
    const q = lpParams(p)
    const e = lampEye(q.phi, q)
    const room = LAMP_ROOMS[q.room].lux
    const shade = lampShade(Math.abs(q.phi), LAMP_MOUNTS[q.mount].wallMm)
    const read =
      q.wiring === 'two'
        ? `V = 3.3 V × 10 kΩ / (10 kΩ + R) = ${volts(e.volts[0])}, ${volts(e.volts[1])} · e = ${e.raws[0]} − ${e.raws[1]} = ${e.err}`
        : `V = 3.3 V × R_R / (R_L + R_R) = ${volts(e.volts[0])} · e = ${e.raws[0]} − ${LAMP_MID} = ${e.err}`
    return `E = ${room} + ${Math.round(lampDirectLux())} lux × cos(θ ∓ toe) × (1 − shade ${fixedText(shade, 2)}) = ${luxText(e.lux[0])}, ${luxText(e.lux[1])} · R = ${GL5528.r10 / 1000} kΩ × (E / 10)^−${GL5528.gamma} = ${ohms(e.ohms[0])}, ${ohms(e.ohms[1])} · ${read}`
  },
  legend: [
    { color: RING, label: 'Left LDR / lamp light', shape: 'dot' },
    { color: HEAT, label: 'Right LDR', shape: 'dot' },
    { color: B_FIELD, label: 'Direction error e (+ = lamp left)', shape: 'dot' },
    { color: POWER, label: 'Where the head rests (e = 0)', shape: 'dot' },
  ],
  points: [
    'A light-dependent resistor (GL5528) is a CdS track whose resistance falls with light: ~15 kΩ at 10 lux, ~1 kΩ under the lamp, ~1 MΩ in the dark, a straight line on log–log axes (slope γ ≈ 0.6). Put it in a divider and the ESP32 ADC reads light as a voltage (Electricity › Voltage divider › Divider as a sensor input).',
    'Two LDRs side by side, both facing forward, see the lamp at the same angle: equal readings wherever it is, so no direction at all. Toe them out ±30° and the cosines differ a little; put a black wall between them and the far one drops into shadow within ~14°: a steep error that keeps its sign out to the side.',
    `LDRs from one bag spread ±30 % or more. Mismatched, the "equal" point is no longer straight at the lamp: the head rests several degrees off, more with the weak toe-out signal; side by side it just turns until the end stop. Sort a pair with a meter under the same light, or trim the offset in code.`,
    `Two 10 kΩ dividers put the steep part of the curve near 10 kΩ, about 15 lux. Under the lamp each LDR is ~1 kΩ and both pins sit in the ESP32's bent top (Microcontrollers › ADC › ESP32 ADC quirks). A sunny room squeezes them to a few counts apart.`,
    'The half bridge, one LDR above the other on a single pin, compares them directly: V depends only on the ratio of the two lights, so it never saturates and needs one ADC pin. Room light still washes out the contrast: the error shrinks as the room gets brighter.',
  ],
  controls: [
    { kind: 'slider', key: 'phi', label: 'Lamp angle (+ left)', min: -90, max: 90, step: 1, initial: 20, format: (v) => signedDeg(v) },
    { kind: 'choice', key: 'mount', options: opts(MOUNT_NAMES), initial: 'flat' },
    { kind: 'choice', key: 'pair', options: opts(PAIR_NAMES), initial: 'matched' },
    { kind: 'choice', key: 'wiring', options: opts(WIRING_NAMES), initial: 'two' },
    { kind: 'choice', key: 'room', options: opts(ROOM_NAMES), initial: 'dark' },
  ],
  build(): Stage {
    const { scene, status, sub, event } = headerStage()
    const rig = deskRig(scene, RIG1, 0.95)
    const luxTags = [0, 1].map((i) => liveLabel(scene, [RIG1[0] + (i ? 3.4 : -3.4), RIG1[1] - 3.3, 0.5], { size: 0.28, color: i ? HEAT : RING }))
    const { s: rp, tag: rawTag } = boxScope(scene, RP, 'Raw ADC vs lamp angle', [12, 4], { axis: ['4095', '0'] })
    const trL = rp.trace(RING, { samples: 121, radius: 0.06 })
    const trR = rp.trace(HEAT, { samples: 121, radius: 0.06 })
    const midLv = rp.level(GREY)
    const rpCursor = cursorBar(rp, LABEL, 0.05)
    const { s: ep, tag: errTag } = boxScope(scene, EP, 'Direction error e, counts', [12, 4], { zeroAt: 0.5, axis: [`+${ERR_MAX}`, `−${ERR_MAX}`] })
    for (const a of [-90, -45, 0, 45, 90]) addLabel(scene, signedDeg(a), [EP.x + (a / 180) * EP.w, EP.y - EP.h / 2 - 0.6, 0.3], GREY, 0.24)
    addLabel(scene, 'lamp angle', [EP.x + EP.w / 2, EP.y - EP.h / 2 - 1.2, 0.3], GREY, 0.24, 'right')
    const trE = ep.trace(B_FIELD, { samples: 121, radius: 0.06 })
    const nullBar = cursorBar(ep, POWER, 0.08)
    const epCursor = cursorBar(ep, LABEL, 0.05)
    const code = codeBlock(scene, [-17.2, -8.4, 0.3], 0.24, 2)
    const ry = (raw: number) => (raw / 4095 - 0.5) * RP.h
    const ey = (e: number) => (e / ERR_MAX) * (EP.h / 2)
    const st = { key: '', t: 0 }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = lpParams(p)
        const e = lampEye(q.phi, q)
        const z = nullOf(q)
        const two = q.wiring === 'two'
        const key = `${lpKey(q)}|${q.phi}`
        st.t += dt
        if (key !== st.key) {
          st.key = key
          rig.mount(q.mount)
          const u = (q.phi + 90) / 180
          const at = (x: number) => lampEye(x * 180 - 90, q)
          trL.draw((x) => ry(at(x).raws[0]), u)
          trR.group.visible = two
          if (two) trR.draw((x) => ry(at(x).raws[1]), u)
          midLv.group.visible = !two
          midLv.set(ry(LAMP_MID))
          trE.draw((x) => ey(at(x).err), u)
          rpCursor(u)
          epCursor(u)
          nullBar(z.deg === null ? null : (z.deg + 90) / 180)
          rawTag.set(two ? `L ${e.raws[0]} · R ${e.raws[1]}` : `bridge ${e.raws[0]} · mid ${LAMP_MID}`, LABEL)
          errTag.set(`e = ${e.err > 0 ? '+' : ''}${e.err}`, Math.abs(e.err) > LAMP_FOLLOW.deadCounts ? B_FIELD : GREY)
          luxTags.forEach((tag, i) => tag.set(`${i ? 'R' : 'L'} ${luxText(e.lux[i])} · ${ohms(e.ohms[i])}`, i ? HEAT : RING))
          code(
            two
              ? [`int e = analogRead(34) - analogRead(35);  // ${e.raws[0]} − ${e.raws[1]}`, `if (abs(e) > ${LAMP_FOLLOW.deadCounts}) cmd += k * e;  // + = turn left`]
              : [`int e = analogRead(34) - ${LAMP_MID};  // ${e.raws[0]} − ${LAMP_MID}`, `if (abs(e) > ${LAMP_FOLLOW.deadCounts}) cmd += k * e;  // + = turn left`],
          )
          sub.set(`${LAMP_MOUNTS[q.mount].name} · ${LAMP_PAIRS[q.pair].name.toLowerCase()} · ${LAMP_ROOMS[q.room].name.toLowerCase()}`, GREY)
          if (z.deg === null && z.offset === 0) event.set('both LDRs see the lamp at the same angle: equal readings everywhere, no direction', HIGH_V)
          else if (z.deg === null) event.set(`no balance point: the mismatched pair always reads ${z.offset > 0 ? 'left' : 'right'} brighter, the head runs to the stop`, HIGH_V)
          else if (Math.abs(z.deg) > 2) event.set(`mismatched pair: e = 0 with the lamp at ${signedDeg(z.deg, 1)}, so the head rests that far off`, HEAT)
          else if (z.slope < 5) event.set(`only ${fixedText(z.slope, 1)} counts per degree near the lamp: a ±${LAMP_FOLLOW.deadCounts}-count dead band hides ±${fixedText(LAMP_FOLLOW.deadCounts / z.slope, 0)}°`, HEAT)
          else event.set(`${fixedText(z.slope, 0)} counts per degree, balanced straight at the lamp`, POWER)
        }
        rig.set(q.phi, 0, e.lux, LAMP_ROOMS[q.room].lux, st.t)
        status.set(`Lamp ${signedDeg(q.phi)} off axis, head held`, LABEL)
      },
      readouts: (p) => {
        const q = lpParams(p)
        const e = lampEye(q.phi, q)
        const z = nullOf(q)
        return [
          { label: 'Light L / R', value: `${luxText(e.lux[0])} / ${luxText(e.lux[1])}` },
          { label: 'LDR L / R', value: `${ohms(e.ohms[0])} / ${ohms(e.ohms[1])}` },
          { label: 'Slope at rest', value: `${fixedText(z.slope, 1)} counts/°`, tone: toneOf(z.slope >= 10, z.slope >= 3) },
          { label: 'Head rests at', value: restText(q), tone: z.deg === null ? 'bad' : toneOf(Math.abs(z.deg) < 2 && z.slope >= 10, Math.abs(z.deg) < 10) },
        ]
      },
    }
  },
}

// --- Servo follow: every 20 ms, step the servo by gain × error; the room light changes the loop gain. ---

const MOTION_NAMES = namesOf(LAMP_MOTIONS)
const sfParams = (p: Params) => ({
  motion: pick(MOTION_NAMES, p.motion, 'swing') as LampMotion,
  gain: n(p, 'gain'),
  room: pick(ROOM_NAMES, p.room, 'dark') as LampRoom,
  wiring: pick(WIRING_NAMES, p.wiring, 'half') as LampWiring,
})
type SfQ = ReturnType<typeof sfParams>
const sfKey = (q: SfQ) => `${q.motion}|${q.gain}|${q.room}|${q.wiring}`
const sfRun = memoBy(sfKey, (q: SfQ) => {
  const run = lampFollowRun(q)
  return { ...run, stats: lampFollowStats(run) }
})
const slopeOf = memoBy((q: SfQ) => `${q.room}|${q.wiring}`, (q: SfQ) => lampNull({ mount: 'wall', pair: 'matched', wiring: q.wiring, room: q.room }).slope)
const fullErr = memoBy((q: SfQ) => `${q.room}|${q.wiring}`, (q: SfQ) => lampEye(45, { mount: 'wall', pair: 'matched', wiring: q.wiring, room: q.room }).err)
const SERVO_FRAME_DEG = SERVO_DEG_PER_S * LAMP_FOLLOW.frameS
const SLOW = 0.5
const AP = { x: 6.2, y: 0.6, w: 12, h: 4.2 }
const ER = { x: 6.2, y: -5.4, w: 12, h: 2.6 }
const RIG2: V3 = [-9.6, -3.8, 0]
const ANG = 60

export const deskLampTrackerServoFollow: Lesson = {
  id: 'desk-lamp-tracker-servo-follow',
  title: 'Servo follow',
  tagline: 'Every 20 ms the ESP32 steps the servo toward the brighter LDR: enough gain to keep up with the lamp, not so much that it hunts, and a room that changes the gain for you',
  formula: (p) => {
    const q = sfParams(p)
    const s = slopeOf(q)
    return `every ${LAMP_FOLLOW.frameS * 1000} ms: |e| > ${LAMP_FOLLOW.deadCounts} → cmd += ${fixedText(q.gain, 1)}° × e / 100 · write(round(cmd)) · near the lamp e ≈ ${fixedText(s, 1)} counts/° × miss · lamp well off to one side: e = ${fullErr(q)} → ${fixedText((q.gain * fullErr(q)) / 100, 1)}° a frame vs the servo's ${SERVO_FRAME_DEG}° · LDR τ ${GL5528.riseS * 1000}/${GL5528.fallS * 1000} ms`
  },
  legend: [
    { color: GREY, label: 'Lamp angle', shape: 'dot' },
    { color: RING, label: 'Head (servo) angle', shape: 'dot' },
    { color: B_FIELD, label: 'Error e the ESP32 reads', shape: 'dot' },
    { color: POWER, label: `Dead band ±${LAMP_FOLLOW.deadCounts} counts`, shape: 'dot' },
    { color: HIGH_V, label: 'Hunting', shape: 'dot' },
  ],
  points: [
    'The head from LDR pair: wall between a matched pair, on an SG90 (Actuators › Hobby servo › Pulse to angle). Every 20 ms the ESP32 reads e and adds gain × e to the servo command. The servo holds a position, so adding to it each frame is integral action: it keeps turning until e = 0 (Control › PID).',
    `Too little gain and a moving lamp drags the head behind it. Too much and, when the lamp jumps, the error is huge: gain × e is a bigger step than the SG90 can turn in 20 ms (${SERVO_FRAME_DEG}°), and the LDRs report the light ~25 ms late. The command runs past the lamp, the head chases it, and it swings across the lamp for ever.`,
    'The slope is not yours to choose: the room sets it. Tune in the dark (steepest) and the same gain is sluggish by day; tune by day and it hunts at night. Tune for the darkest room you will use, or normalise e by the total light.',
    `The dead band (±${LAMP_FOLLOW.deadCounts} counts) keeps ADC noise from twitching the servo. With 10 kΩ dividers in a sunny room the whole error is only a few dozen counts: the head stops ten or more degrees off, then creeps in on noise. The half bridge keeps enough counts per degree.`,
    'Light is slow but cheap: an LDR head costs pennies and needs no camera, but it only finds the brightest direction. A window or a white wall pulls it too (Robot projects › Camera tracker for real targets).',
  ],
  controls: [
    { kind: 'choice', key: 'motion', options: opts(MOTION_NAMES), initial: 'swing' },
    { kind: 'slider', key: 'gain', label: 'Gain (° per 100 counts)', min: 0.1, max: 3, step: 0.1, initial: 1, format: (v) => v.toFixed(1) },
    { kind: 'choice', key: 'room', options: opts(ROOM_NAMES), initial: 'dark' },
    { kind: 'choice', key: 'wiring', options: opts(WIRING_NAMES), initial: 'half' },
  ],
  build(): Stage {
    const { scene, status, sub, event } = headerStage()
    const rig = deskRig(scene, RIG2, 0.95)
    rig.mount('wall')
    const { s: ap, tag: angTag } = boxScope(scene, AP, `Angle ±${ANG}°, ${LAMP_FOLLOW.seconds} s`, [10, 4], { zeroAt: 0.5 })
    const trLamp = ap.trace(GREY, { samples: 300, radius: 0.05 })
    const trHead = ap.trace(RING, { samples: 300, radius: 0.07 })
    const { s: er, tag: errTag } = boxScope(scene, ER, 'Error e, ±2000 counts', [10, 2], { zeroAt: 0.5 })
    addLabel(scene, '0', [ER.x - ER.w / 2, ER.y - ER.h / 2 - 0.6, 0.3], GREY, 0.24, 'left')
    addLabel(scene, `${LAMP_FOLLOW.seconds} s`, [ER.x + ER.w / 2, ER.y - ER.h / 2 - 0.6, 0.3], GREY, 0.24, 'right')
    const trErr = er.trace(B_FIELD, { samples: 300, radius: 0.05 })
    const ey = (e: number) => Math.max(-1, Math.min(1, e / 2000)) * (ER.h / 2)
    const dead = [er.level(POWER, 0.3), er.level(POWER, 0.3)]
    dead[0].set(ey(LAMP_FOLLOW.deadCounts))
    dead[1].set(ey(-LAMP_FOLLOW.deadCounts))
    const ay = (a: number) => Math.max(-1, Math.min(1, a / ANG)) * (AP.h / 2)
    const code = codeBlock(scene, [-17.2, -8.4, 0.3], 0.24, 2)
    let clock = lapseClock(LAMP_FOLLOW.seconds, SLOW, 1.5)
    const st = { key: '', t: 0 }
    return {
      scene,
      view: FACE_VIEW,
      frame(dt, p) {
        const q = sfParams(p)
        const R = sfRun(q)
        const key = sfKey(q)
        st.t += dt
        if (key !== st.key) {
          st.key = key
          clock = lapseClock(LAMP_FOLLOW.seconds, SLOW, 1.5)
          code([
            q.wiring === 'two' ? 'int e = analogRead(34) - analogRead(35);' : `int e = analogRead(34) - ${LAMP_MID};`,
            `if (abs(e) > ${LAMP_FOLLOW.deadCounts}) cmd += ${fixedText(q.gain / 100, 3)} * e;  servo.write(90 + round(cmd));`,
          ])
        }
        const t = clock(dt, key)
        const s: LampSample = fixedStepAt(R.samples, t, R.sampleDt)
        traceRun(trLamp, R.samples, R.sampleDt, LAMP_FOLLOW.seconds, t, (f) => ay(f.lamp), 300)
        traceRun(trHead, R.samples, R.sampleDt, LAMP_FOLLOW.seconds, t, (f) => ay(f.head), 300)
        traceRun(trErr, R.samples, R.sampleDt, LAMP_FOLLOW.seconds, t, (f) => ey(f.err), 300)
        const hunting = q.motion === 'swing' && R.stats.tailSwing > 10 && t > 2
        setGlow(trHead.material, hunting ? HIGH_V : RING, 0.9)
        rig.set(s.lamp, s.head, s.lux, LAMP_ROOMS[q.room].lux, st.t)
        const miss = s.lamp - s.head
        angTag.set(`lamp ${signedDeg(s.lamp)} · head ${signedDeg(s.head)}`, LABEL)
        errTag.set(`e = ${s.err > 0 ? '+' : ''}${s.err}`, Math.abs(s.err) > LAMP_FOLLOW.deadCounts ? B_FIELD : POWER)
        status.set(`${LAMP_MOTIONS[q.motion].name} · miss ${signedDeg(miss, 1)}`, LABEL)
        sub.set(`${s.t.toFixed(2)} / ${LAMP_FOLLOW.seconds} s · ${1 / SLOW}× slower · ${LAMP_ROOMS[q.room].name.toLowerCase()} · ${LAMP_WIRINGS[q.wiring].name}`, GREY)
        const slope = slopeOf(q)
        if (hunting) event.set(`steps of ${fixedText((q.gain * fullErr(q)) / 100, 0)}° a frame, the servo turns ${SERVO_FRAME_DEG}°: the command runs past the lamp and the head swings ${Math.round(R.stats.tailSwing)}° across it`, HIGH_V)
        else if (Math.abs(miss) > 5 && Math.abs(s.err) <= LAMP_FOLLOW.deadCounts) event.set(`${signedDeg(miss, 0)} off but e is inside the dead band: only ${fixedText(slope, 1)} counts per degree in this light`, HEAT)
        else if (Math.abs(miss) > 5) event.set(`dragging ${fixedText(Math.abs(miss), 0)}° behind the lamp: more gain, or more counts per degree`, HEAT)
        else event.set(`on the lamp: ${fixedText(Math.abs(miss), 1)}° off · ${fixedText(slope, 0)} counts/° in this light`, POWER)
      },
      readouts: (p) => {
        const q = sfParams(p)
        const { stats } = sfRun(q)
        const step = (q.gain * fullErr(q)) / 100
        return [
          { label: 'RMS miss after 2 s', value: `${fixedText(stats.rms, 1)}°`, tone: toneOf(stats.rms < 2, stats.rms < 6) },
          { label: 'Worst miss after 2 s', value: `${fixedText(stats.worst, 1)}°`, tone: toneOf(stats.worst < 4, stats.worst < 12) },
          { label: 'Head swing, last 2 s', value: q.motion === 'swing' ? `${fixedText(stats.tailSwing, 0)}°` : 'lamp moving', tone: q.motion === 'swing' ? toneOf(stats.tailSwing <= 2, stats.tailSwing <= 10) : undefined },
          { label: 'Step at full error', value: `${fixedText(step, 1)}° / 20 ms (servo ${SERVO_FRAME_DEG}°)` },
        ]
      },
    }
  },
}
