import * as THREE from 'three/webgpu'
import {
  HCSR04,
  PANEL_HALF,
  SONARS,
  SOUND_C,
  SOUND_MEDIA,
  SonarKind,
  THRESHOLD,
  SoundMedium,
  Target,
  airSpeedLinear,
  blindRange,
  dopplerHz,
  echoDopplerHz,
  echoEnvelope,
  echoFronts,
  echoRanging,
  fixedSpeedRead,
  soundSpeedIn,
  sourceFronts,
  targetRefl,
  speedFromEcho,
  speedOfSound,
  wavelength,
} from '../../core/physics'
import { cmText, lengthText, mpsText, msText, niceCeil, pct, signed } from '../../core/units'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  CLK_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  SIDE_SCOPE,
  addLabel,
  beamCone,
  flatBox,
  glide,
  glowMat,
  hcSr04,
  lapseClock,
  liveLabel,
  memoBy,
  robotCar,
  setGlow,
  sideView,
  statusHeader,
  titledScope,
  wavePool,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const VIEW = sideView(-2.2, -0.6)
const { x: PX } = SIDE_SCOPE
const msPrecise = (s: number) => msText(s, 2)
const hzText = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 2 : 3)} kHz` : `${f.toFixed(1)} Hz`)
const dHz = (d: number) => `${d < 0 ? '−' : '+'}${hzText(Math.abs(d))}`

// --- Speed of sound: one clap races down air, water and steel; temperature changes air's speed and a fixed-343 sketch's range. ---

const SS = { x0: -16, x1: -2, lanes: [2.4, -0.8, -4], tMin: -20, tMax: 45, onScreenS: 3.5 }
const LANE: Record<SoundMedium, { color: string; fill: string }> = {
  air: { color: B_FIELD, fill: '#2a3440' },
  water: { color: '#4d8dff', fill: '#1d4470' },
  steel: { color: LABEL, fill: '#6d737d' },
}
const MEDIA_LIST = Object.keys(SOUND_MEDIA) as SoundMedium[]
const ssParams = (p: Params) => ({ T: n(p, 'temp'), m: n(p, 'dist') })
type SsQ = ReturnType<typeof ssParams>
const ssRun = memoBy(
  (q: SsQ) => `${q.T}|${q.m}`,
  (q: SsQ) => {
    const c = Object.fromEntries(MEDIA_LIST.map((k) => [k, soundSpeedIn(k, q.T)])) as Record<SoundMedium, number>
    const read = fixedSpeedRead(q.m, q.T)
    const errAt = (T: number) => fixedSpeedRead(q.m, T) - q.m
    const errRange = niceCeil(Math.max(Math.abs(errAt(SS.tMin)), Math.abs(errAt(SS.tMax))) * 100) / 100
    return { ...q, c, read, err: read - q.m, errAt, errRange, airS: q.m / c.air }
  },
)

export const soundUltrasoundSpeedOfSound: Lesson = {
  id: 'sound-ultrasound-speed-of-sound',
  title: 'Speed of sound',
  tagline: 'A pressure wave, faster in stiff things, faster when warm',
  formula: (p) => {
    const R = ssRun(ssParams(p))
    return `c = √(γ·R·T/M) = 331.3·√(1 + T/273.15) ≈ 331 + 0.6·T = ${mpsText(R.c.air, 1)} at ${R.T} °C · water ${mpsText(R.c.water, 0)}, steel ${mpsText(R.c.steel, 0)} (c = √(stiffness/density)) · a 343 m/s sketch reads d·343/c = ${cmText(R.read)} for ${cmText(R.m)}`
  },
  legend: [
    { color: B_FIELD, label: 'Air: wavefront from the clap (top lane)', shape: 'dot' },
    { color: '#4d8dff', label: 'Water', shape: 'dot' },
    { color: LABEL, label: 'Steel bar', shape: 'dot' },
    { color: HEAT, label: 'Range error of a 343 m/s sketch vs temperature', shape: 'dot' },
  ],
  points: [
    'Sound is a pressure wave: each layer of air shoves the next and springs back. Nothing travels from the clap to the microphone except that squeeze, passed along at the speed of sound c.',
    'How fast depends on how stiff the stuff is against its density: c = √(stiffness / density). Water is 800× denser than air but far stiffer, so sound goes ~4× faster; a steel bar ~15×. That is why you hear a train in the rail before the air.',
    'In air, c = 331.3·√(1 + T/273.15), close to 331 + 0.6·T m/s: warm air molecules move faster and pass the push on sooner. Humidity adds under 0.5 %, pressure nothing.',
    'Every echo sensor turns time into distance with c (Sensors › Ultrasonic › Time of flight). A sketch that bakes in 343 m/s is right only at 20 °C: off by about 0.17 % per °C, a few cm over 2 m on a cold or hot day. Read a temperature sensor and compute c if that matters.',
  ],
  controls: [
    { kind: 'slider', key: 'temp', label: 'Air temperature', min: SS.tMin, max: SS.tMax, step: 1, initial: 20, format: (v) => `${v} °C` },
    { kind: 'slider', key: 'dist', label: 'Distance', min: 0.5, max: 5, step: 0.1, initial: 2, format: (v) => `${v.toFixed(1)} m` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const L = SS.x1 - SS.x0
    const lanes = MEDIA_LIST.map((k, i) => {
      const y = SS.lanes[i]
      const { color, fill } = LANE[k]
      const strip = mat(fill, { rough: 0.6, metal: k === 'steel' ? 0.5 : 0 })
      if (k === 'water') {
        strip.transparent = true
        strip.opacity = 0.75
      }
      flatBox(scene, [L, 1.8, 0.3], strip, [(SS.x0 + SS.x1) / 2, y, -0.4])
      const clap = glowMat(RING, 0.2)
      box(scene, [0.5, 1.8, 0.8], clap, [SS.x0 - 0.3, y, 0])
      const micM = glowMat(color, 0.15)
      cylinder(scene, 0.45, 0.9, micM, [SS.x1 + 0.4, y, 0.2], 'x', 18)
      const name = liveLabel(scene, [SS.x0, y + 1.45, 0.3], { size: 0.32, color, align: 'left' })
      const arrive = liveLabel(scene, [SS.x1 + 1.1, y + 1.45, 0.3], { size: 0.3, align: 'right' })
      return { k, y, color, clap, micM, name, arrive }
    })
    addLabel(scene, 'clap', [SS.x0 - 0.3, SS.lanes[2] - 1.5, 0.3], RING, 0.26)
    addLabel(scene, 'mic', [SS.x1 + 0.4, SS.lanes[2] - 1.5, 0.3], GREY, 0.26)
    const span = liveLabel(scene, [(SS.x0 + SS.x1) / 2, SS.lanes[2] - 1.5, 0.3], { size: 0.28, color: GREY })
    const waves = wavePool(scene, 9, 14, 0.13)

    const top = titledScope(scene, 1.8, 4.2, 'c in air vs T (grey: 331 + 0.6·T)', B_FIELD, 0)
    const cExact = top.s.trace(B_FIELD, { samples: 66, radius: 0.06 })
    const cLin = top.s.trace(GREY, { samples: 2, radius: 0.03 })
    const [cLo, cHi] = [310, 370]
    const yC = (c: number) => -top.h / 2 + ((c - cLo) / (cHi - cLo)) * top.h
    top.lo.set(`${SS.tMin} °C`)
    top.hi.set(`${SS.tMax} °C`)
    const bot = titledScope(scene, -5.2, 4.2, '343 m/s sketch: error', HEAT, 0.5)
    const errTr = bot.s.trace(HEAT, { samples: 66, radius: 0.06 })
    bot.lo.set(`${SS.tMin} °C`)
    bot.hi.set(`${SS.tMax} °C`)
    const uOf = (T: number) => (T - SS.tMin) / (SS.tMax - SS.tMin)
    const clock = lapseClock(1, 1, 0.3)
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const R = ssRun(ssParams(p))
        const total = R.airS * 1.08
        const slow = SS.onScreenS / total
        const t = clock(dt / SS.onScreenS, `${R.T}|${R.m}`) * total
        const sc = L / R.m
        waves.begin()
        for (const ln of lanes) {
          const c = R.c[ln.k]
          const tArr = R.m / c
          const arrived = t >= tArr
          ln.name.set(`${SOUND_MEDIA[ln.k]}${ln.k === 'air' ? ` ${R.T} °C` : ''} · ${mpsText(c, 0)}`)
          ln.arrive.set(arrived ? `heard at ${msPrecise(tArr)}` : '', ln.color)
          setGlow(ln.micM, ln.color, arrived ? 1.4 : 0.15)
          setGlow(ln.clap, RING, t < total * 0.04 ? 1.6 : 0.2)
          for (let j = 0; j < 3; j++) {
            const r = (c * t - j * 0.03 * R.m) * sc
            if (r > 0 && r < L + 0.4) waves.put([SS.x0, ln.y, 0.3], r, 0, Math.min(1.2, 0.85 / Math.max(r, 0.5)), ln.color, 1.2 - j * 0.35)
          }
        }
        waves.end()
        span.set(`${R.m.toFixed(1)} m in every lane`)

        cExact.draw((u) => yC(speedOfSound(SS.tMin + u * (SS.tMax - SS.tMin))), uOf(R.T))
        cLin.points([0, 1], [yC(airSpeedLinear(SS.tMin)), yC(airSpeedLinear(SS.tMax))])
        top.right.set(`${cLo}…${cHi} m/s`, GREY)
        errTr.draw((u) => (R.errAt(SS.tMin + u * (SS.tMax - SS.tMin)) / R.errRange) * (bot.h / 2), uOf(R.T))
        bot.right.set(`±${cmText(R.errRange)} at ${R.m.toFixed(1)} m`, GREY)

        const bad = Math.abs(R.err) > 0.01
        head.status.set(`Speed of sound · ${R.T} °C · air ${mpsText(R.c.air, 1)}`, LABEL)
        head.event.set(
          t < R.m / R.c.steel ? 'clap!' : t < R.m / R.c.water ? 'steel hears it first' : t < R.airS ? 'steel, then water; air still on its way' : `air last: ${msPrecise(R.airS)}`,
          t < R.airS ? LABEL : B_FIELD,
        )
        head.sub.set(`shown ${Math.round(slow).toLocaleString('en-US')}× slower · sketch reads ${cmText(R.read)}${bad ? ' (>1 cm off)' : ''}`)
      },
      readouts: (p) => {
        const R = ssRun(ssParams(p))
        const bad = Math.abs(R.err) > 0.02
        return [
          { label: 'c in air (331 + 0.6·T)', value: `${mpsText(R.c.air, 1)} (${mpsText(airSpeedLinear(R.T), 1)})` },
          { label: 'Arrival air · water · steel', value: `${msPrecise(R.airS)} · ${msPrecise(R.m / R.c.water)} · ${msPrecise(R.m / R.c.steel)}` },
          { label: '343 m/s sketch reads', value: `${cmText(R.read)} (${signed(R.err * 100)} cm)`, tone: bad ? 'warn' : 'ok' },
          { label: 'λ at 40 kHz in air', value: `${(wavelength(HCSR04.hz, R.c.air) * 1000).toFixed(1)} mm` },
        ]
      },
    }
  },
}

// --- Echo ranging: pulse out, echo back; ringing blinds a one-can sensor up close, a tilted panel throws the echo aside. ---

const ER = { sx: -15.4, sy: -1, sc: 4.4, onScreenS: 3.2, dbLo: -10, dbHi: 40 }
const SURFACES = { wall: 'Hard wall', cardboard: 'Cardboard', curtain: 'Curtain', foam: 'Foam' } as const
const SURF_COLOR: Record<keyof typeof SURFACES, string> = { wall: '#9b8f86', cardboard: '#b88a55', curtain: '#7a5a8c', foam: '#c9c27a' }
const HALF = (HCSR04.halfDeg * Math.PI) / 180
const erParams = (p: Params) => ({
  kind: pick(SONARS, p.sonar, 'hcsr04') as SonarKind,
  m: n(p, 'dist'),
  tilt: n(p, 'tilt'),
  surface: pick(SURFACES, p.surface, 'wall') as Target & keyof typeof SURFACES,
})
type ErQ = ReturnType<typeof erParams>
const erRun = memoBy(
  (q: ErQ) => `${q.kind}|${q.m}|${q.tilt}|${q.surface}`,
  (q: ErQ) => {
    const r = echoRanging(q.kind, q.m, q.tilt, q.surface)
    const last = r.echoes.length ? r.echoes[r.echoes.length - 1].t : (2 * q.m) / r.c
    const W = Math.max(2.5 * r.blank, 1.15 * Math.max(last, (4 * q.m) / r.c))
    return { ...q, r, W }
  },
)
const erVerdict = (R: ReturnType<typeof erRun>) =>
  R.r.first?.kind === 'direct'
    ? { text: `reads ${cmText(R.r.reading!)}`, color: POWER }
    : R.r.first
      ? { text: `echo buried in the ringing: reads the double bounce, ${cmText(R.r.reading!)}`, color: HIGH_V }
      : R.r.echoes.length
        ? { text: 'echo too weak: no reading', color: HIGH_V }
        : { text: 'echo thrown off the panel: no reading', color: HIGH_V }

export const soundUltrasoundEchoRanging: Lesson = {
  id: 'sound-ultrasound-echo-ranging',
  title: 'Echo ranging',
  tagline: 'Out and back, so halve it; but only if the echo comes home',
  formula: (p) => {
    const R = erRun(erParams(p))
    const e = R.r.echoes[0]
    return `d = c·t/2${e ? ` = ${mpsText(R.r.c, 0)} × ${msPrecise(e.t)} / 2 = ${cmText((R.r.c * e.t) / 2)}` : ''} · deaf until the ringing dies: blind zone d_min = c·t_blank/2 = ${cmText(blindRange(R.kind, R.r.c))} · flat panel turned θ: echo comes back ${(2 * R.tilt).toFixed(0)}° off axis (beam ±${HCSR04.halfDeg}°)`
  },
  legend: [
    { color: CLK_COLOR, label: 'Ping going out', shape: 'dot' },
    { color: POWER, label: 'Echo off the panel (as if from its mirror image)', shape: 'dot' },
    { color: HEAT, label: 'Transducer still ringing: receiver deaf', shape: 'dot' },
    { color: RING, label: 'Detection threshold (0 dB)', shape: 'dot' },
  ],
  points: [
    'Echo ranging times a pulse out and back: d = c·t/2, halved because the sound travels the distance twice (Speed of sound; the HC-SR04 timing is in Sensors › Ultrasonic › Time of flight). The echogram is what the receiver hears in dB above its threshold; the first crossing after the blank is the reading.',
    'A transducer is a bell: after the burst it keeps ringing. The HC-SR04 uses separate T and R cans, so the receiver recovers in microseconds and reads down to a few cm. Waterproof one-can sensors (JSN-SR04T, car parking sensors) send and listen with the same can and are deaf for over a millisecond: a ~25 cm blind zone. An echo inside it is lost, and the sensor may report the double bounce (panel → face → panel) at twice the distance.',
    'Ultrasound at 8.6 mm wavelength bounces off a flat panel like light off a mirror (Light & optics › Reflection): angle in = angle out. Turned θ, the echo comes back 2θ off axis (and still measures the panel’s nearest point, d·cos θ); once that is outside the receiving beam, a perfectly good wall goes silent, or the echo bounces on and comes back late from somewhere else (multipath). Rough or rounded things scatter some sound back whatever the angle (Sensors › Ultrasonic › Beam angle).',
    'Soft, porous surfaces turn the pressure wave into heat instead of reflecting it, so curtains and foam are heard only close up (Sensors › Ultrasonic › Soft-target errors). Robots mount sonars square to what they need to see and fuse them with other sensors.',
  ],
  controls: [
    { kind: 'choice', key: 'sonar', options: opts(SONARS), initial: 'hcsr04' },
    { kind: 'choice', key: 'surface', options: opts(SURFACES), initial: 'wall' },
    { kind: 'slider', key: 'dist', label: 'Distance', min: 0.05, max: 3, step: 0.05, initial: 1, format: lengthText },
    { kind: 'slider', key: 'tilt', label: 'Panel angle θ', min: 0, max: 30, step: 1, initial: 0, format: (v) => `${v}°` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const hc = hcSr04(scene, [ER.sx - 5.05 * 0.3, ER.sy, 0], 0.3)
    const jsn = add(scene, new THREE.Group(), [ER.sx, ER.sy, 0])
    cylinder(jsn, 0.75, 1.2, mat('#1b1c20', { rough: 0.6 }), [-0.6, 0, 0], 'x', 24)
    cylinder(jsn, 0.25, 1.6, mat('#1b1c20', { rough: 0.6 }), [-2, 0, 0], 'x', 12)
    const faceM = glowMat(CLK_COLOR, 0.1)
    cylinder(scene, 0.55, 0.2, faceM, [ER.sx + 0.1, ER.sy, 0.4], 'x', 20)
    const sensorName = liveLabel(scene, [ER.sx - 1.8, ER.sy + 3.4, 0.3], { size: 0.3, align: 'left' })
    const deaf = liveLabel(scene, [ER.sx - 1.8, ER.sy - 3.2, 0.3], { size: 0.3, color: HEAT, align: 'left' })
    const panelG = add(scene, new THREE.Group(), [0, ER.sy, 0])
    const panelM = mat(SURF_COLOR.wall, { rough: 0.9 })
    box(panelG, [0.5, 2 * PANEL_HALF * ER.sc, 2.4], panelM, [0.2, 0, 0])
    const cone = beamCone(scene, CLK_COLOR)
    const waves = wavePool(scene, 8, 40, 0.12)
    const ruler = liveLabel(scene, [0, ER.sy - 4.4, 0.3], { size: 0.32 })

    const eg = titledScope(scene, -1, 8, 'echogram', LABEL, (0 - ER.dbLo) / (ER.dbHi - ER.dbLo))
    eg.s.level(RING).set(-eg.h / 2 + ((0 - ER.dbLo) / (ER.dbHi - ER.dbLo)) * eg.h)
    const ringTr = eg.s.trace(HEAT, { samples: 220, radius: 0.05 })
    const echoTr = eg.s.trace(POWER, { samples: 220, radius: 0.06 })
    const tags = [0, 1].map(() => liveLabel(scene, [0, 0, 0.4], { size: 0.26 }))
    eg.lo.set('0')
    const yDb = (a: number) => {
      const db = 20 * Math.log10(Math.max(a, 1e-3))
      return -eg.h / 2 + ((Math.min(ER.dbHi, Math.max(ER.dbLo, db)) - ER.dbLo) / (ER.dbHi - ER.dbLo)) * eg.h
    }
    const clock = lapseClock(1, 1, 0.35)
    const st = { x: ER.sx + ER.sc }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const R = erRun(erParams(p))
        const { r, W } = R
        const t = clock(dt / ER.onScreenS, `${R.kind}|${R.m}|${R.tilt}|${R.surface}`) * W
        hc.group.visible = R.kind === 'hcsr04'
        jsn.visible = R.kind === 'jsn'
        sensorName.set(SONARS[R.kind], LABEL)
        const th = (R.tilt * Math.PI) / 180
        st.x = glide(dt, st.x, ER.sx + R.m * ER.sc, 10)
        const px = st.x
        panelG.position.x = px
        panelG.rotation.z = -th
        setGlow(panelM, SURF_COLOR[R.surface], 0)
        panelM.color.set(SURF_COLOR[R.surface])
        const [nx, ny] = [Math.cos(th), -Math.sin(th)]
        const S: V3 = [ER.sx + 0.2, ER.sy, 0.3]
        const side = (x: number, y: number) => (x - px) * nx + (y - ER.sy) * ny
        const along = (x: number, y: number) => -(x - px) * ny + (y - ER.sy) * nx
        const perp = -side(S[0], S[1])
        const img: V3 = [S[0] + 2 * perp * nx, S[1] + 2 * perp * ny, 0.3]
        const half = PANEL_HALF * ER.sc
        const inView = (x: number, y: number) => x < -1.5 && y < ER.sy + 4.6 && y > ER.sy - 6
        const out = (x: number, y: number) => inView(x, y) && (side(x, y) < 0 || Math.abs(along(x, y)) > half)
        const back = (x: number, y: number) => inView(x, y) && side(x, y) < 0
        cone([ER.sx, ER.sy, 0], 0, HALF, Math.max(0.5, px - ER.sx), 0.07)
        const vis = ER.sc * r.c
        waves.begin()
        for (let k = 0; k < 3; k++) {
          const rr = (t - (k * 0.12e-3)) * vis
          if (rr <= 0) continue
          const f = 1.3 / (1 + rr / 16)
          waves.put(S, rr, 0, HALF * 1.6, CLK_COLOR, f, out)
          if (rr > perp) waves.put(img, rr, Math.PI - 2 * th, HALF * 1.6, POWER, f * targetRefl(R.surface), back)
        }
        waves.end()
        const ringing = t < r.blank
        setGlow(faceM, ringing ? HEAT : CLK_COLOR, ringing ? 1.5 : 0.1)
        deaf.set(ringing ? 'ringing: deaf' : '', HEAT)
        ruler.group.position.x = (ER.sx + px) / 2
        ruler.set(`${cmText(R.m)} · ${SURFACES[R.surface]} · θ ${R.tilt}°`, GREY)

        const samples = 220
        const kNow = Math.max(2, Math.round((t / W) * (samples - 1)) + 1)
        const us = Array.from({ length: kNow }, (_, i) => i / (samples - 1))
        const ringOnly = { ...r, echoes: [] }
        const ringAt = (u: number) => echoEnvelope(ringOnly, R.kind, u * W)
        ringTr.points(us, us.map((u) => yDb(ringAt(u))))
        echoTr.points(us, us.map((u) => yDb(echoEnvelope(r, R.kind, u * W) - ringAt(u))))
        r.echoes.forEach((e, i) => {
          tags[i].group.visible = t >= e.t && e.t < W
          tags[i].group.position.set(PX + eg.s.xAt(Math.min(0.82, e.t / W)), -1 + eg.h / 2 - 0.6 - i * 0.6, 0.4)
          tags[i].set(`${e.kind === 'direct' ? 'echo' : 'double'} ${msPrecise(e.t)}${e.heard ? ' ✓' : e.t < r.blank ? ' (deaf)' : ' (weak)'}`, e.heard ? POWER : GREY)
        })
        for (let i = r.echoes.length; i < 2; i++) tags[i].group.visible = false
        eg.right.set(`dB over threshold, ${ER.dbLo}…+${ER.dbHi}`, GREY)
        eg.hi.set(msPrecise(W))

        const v = erVerdict(R)
        head.status.set(`Echo ranging · ${SONARS[R.kind]} · blind under ${cmText(blindRange(R.kind, r.c))}`, LABEL)
        head.event.set(t >= (r.first?.t ?? W) || t >= W * 0.98 ? v.text : `t = ${msPrecise(t)}`, t >= (r.first?.t ?? W) || t >= W * 0.98 ? v.color : LABEL)
        head.sub.set(`shown ${Math.round(ER.onScreenS / W).toLocaleString('en-US')}× slower · 40 kHz, beam ±${HCSR04.halfDeg}°`)
      },
      readouts: (p) => {
        const R = erRun(erParams(p))
        const { r } = R
        const e = r.echoes[0]
        return [
          { label: 'Echo time (round trip)', value: e ? msPrecise(e.t) : '—' },
          { label: 'Echo above threshold', value: e ? `${signed(20 * Math.log10(e.amp / THRESHOLD), 0)} dB` : 'missed', tone: e && e.amp >= THRESHOLD ? 'ok' : 'bad' },
          { label: 'Reading', value: r.reading === null ? 'none' : cmText(r.reading), tone: r.first?.kind === 'direct' ? 'ok' : 'bad' },
          { label: 'Blind zone', value: cmText(blindRange(R.kind, r.c)), tone: R.m < blindRange(R.kind, r.c) ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Doppler: a moving beeper squeezes its wavefronts ahead; a sonar measures speed from the echo's shift. ---

const DOP = { modes: { source: 'Beeping robot', echo: 'Sonar speed trap' }, freqs: { buzz: '1 kHz buzzer', ultra: '40 kHz ultrasound' } } as const
const FREQ_HZ = { buzz: 1000, ultra: 40e3 }
const DV = { y: -2.8, x0: -14, x1: -4, cVis: 4.5, period: 0.42, exag: 10, vMax: 30, cycles: 10, floorY: -5, sonarX: -1.6, micL: -17.4, micR: -0.4 }
const dopParams = (p: Params) => ({ mode: pick(DOP.modes, p.mode, 'source'), v: n(p, 'speed'), freq: pick(DOP.freqs, p.freq, 'buzz') })
type DopQ = ReturnType<typeof dopParams>
const dopRun = (q: DopQ) => {
  const f = FREQ_HZ[q.freq]
  const c = SOUND_C
  const ahead = q.mode === 'source' ? dopplerHz(f, c, q.v) : echoDopplerHz(f, c, q.v)
  const behind = dopplerHz(f, c, -q.v)
  return { ...q, f, c, ahead, behind, back: q.mode === 'echo' ? speedFromEcho(f, ahead, c) : null }
}

export const soundUltrasoundDoppler: Lesson = {
  id: 'sound-ultrasound-doppler',
  title: 'Doppler',
  tagline: 'Chase your own wavefronts and they bunch up ahead',
  formula: (p) => {
    const R = dopRun(dopParams(p))
    return R.mode === 'source'
      ? `ahead f' = f·c/(c − v) = ${hzText(R.f)} × ${R.c}/(${R.c} − ${R.v}) = ${hzText(R.ahead)} · behind f·c/(c + v) = ${hzText(R.behind)} · Δf/f ≈ v/c = ${pct(R.v / R.c)}`
      : `echo f'' = f·(c + v)/(c − v) = ${hzText(R.ahead)} · Δf ≈ 2·f·v/c = ${hzText(R.ahead - R.f)} → v = c·(f'' − f)/(f'' + f) = ${mpsText(R.back!, 2)}`
  },
  legend: (p) =>
    dopParams(p).mode === 'source'
      ? [
          { color: B_FIELD, label: 'Mic ahead: fronts squeezed, pitch up', shape: 'dot' },
          { color: HEAT, label: 'Mic behind: stretched, pitch down', shape: 'dot' },
          { color: GREY, label: 'Sent tone (scope) · shift vs speed (bottom)', shape: 'dot' },
        ]
      : [
          { color: CLK_COLOR, label: 'Ping from the still sonar', shape: 'dot' },
          { color: POWER, label: 'Echo off the robot driving at it', shape: 'dot' },
          { color: GREY, label: 'Sent tone (scope) · shift vs speed (bottom)', shape: 'dot' },
        ],
  points: [
    'A beeper sends a wavefront every period T, and each spreads at c from where the robot was when it left. Driving at v, the robot chases the fronts it sent forward and runs away from the ones behind: ahead they are packed closer, behind further apart.',
    'Closer fronts arrive more often: f\' = f·c/(c − v) ahead, f·c/(c + v) behind. A listener moving towards a still source meets fronts sooner too, f·(c + v)/c. At robot speeds the shift is small, about v/c: 1 m/s is 0.3 %, a 3 Hz rise on a 1 kHz buzzer, but easy to measure (Signals › Fourier).',
    'Bounce a tone off a moving target and the shift happens twice: the target hears a raised pitch and sends it back as a moving source, f\'\' = f·(c + v)/(c − v) ≈ f·(1 + 2v/c). Measure f\'\' and v = c·(f\'\' − f)/(f\'\' + f): a speed straight from one echo, no distance needed. Radar guns, ultrasonic flow meters and Doppler sonar work this way.',
    'The wavefronts here are drawn with the speed exaggerated 10×; the numbers and the scope are real. Near v = c the fronts pile into a shock wave (a sonic boom).',
  ],
  controls: [
    { kind: 'choice', key: 'mode', options: opts(DOP.modes), initial: 'source' },
    { kind: 'choice', key: 'freq', options: opts(DOP.freqs), initial: 'buzz' },
    { kind: 'slider', key: 'speed', label: 'Robot speed v', min: 0, max: DV.vMax, step: 0.5, initial: 10, format: (v) => mpsText(v, 1) },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    flatBox(scene, [20, 0.4, 3], mat('#3a3d44', { rough: 0.8 }), [-9, DV.floorY, 0])
    const bot = add(scene, new THREE.Group())
    robotCar(bot, [0, 0, 0], 0.32)
    const beepM = glowMat(RING, 0.6)
    const beeper = cylinder(bot, 0.35, 0.3, beepM, [0, 1.25, 0.6], 'z', 18)
    const mics = [DV.micR, DV.micL].map((x, i) => {
      const g = add(scene, new THREE.Group())
      cylinder(g, 0.18, DV.y - DV.floorY, mat('#2a2c32', { rough: 0.5 }), [x, (DV.y + DV.floorY) / 2, 0], 'y', 12)
      cylinder(g, 0.42, 0.9, glowMat(i ? HEAT : B_FIELD, 0.5), [x, DV.y, 0.3], 'y', 16)
      const tag = liveLabel(scene, [x + (i ? -0.4 : 0.4), DV.floorY - 1, 0.3], { size: 0.3, align: i ? 'left' : 'right' })
      return { g, tag, x }
    })
    const sonar = hcSr04(scene, [DV.sonarX + 5.05 * 0.22, DV.y, 0], 0.22, Math.PI)
    const waves = wavePool(scene, 30, 72, 0.1)

    const sc = titledScope(scene, 1.6, 4.2, `${DV.cycles} cycles of the sent tone`, LABEL, 0.5)
    const sent = sc.s.trace(GREY, { samples: 260, radius: 0.04 })
    const up = sc.s.trace(B_FIELD, { samples: 260, radius: 0.05 })
    const dn = sc.s.trace(HEAT, { samples: 260, radius: 0.05 })
    sc.lo.set('0')
    const sh = titledScope(scene, -5.4, 4.2, 'pitch shift vs speed', LABEL, 0.5)
    const upCurve = sh.s.trace(B_FIELD, { samples: 61, radius: 0.05 })
    const dnCurve = sh.s.trace(HEAT, { samples: 61, radius: 0.05 })
    sh.lo.set('0')
    sh.hi.set(mpsText(DV.vMax, 0))
    const st = { t: 0, key: '' }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const R = dopRun(dopParams(p))
        const key = `${R.mode}|${R.v}`
        if (key !== st.key) [st.key, st.t] = [key, 0]
        st.t += dt
        const beta = Math.min(0.9, (DV.exag * R.v) / R.c)
        const vVis = beta * DV.cVis
        const isSource = R.mode === 'source'
        const run = isSource ? DV.x1 - DV.x0 : DV.sonarX - 3 - DV.x0
        const loop = vVis > 0 ? run / vVis : 6
        if (st.t > loop + (isSource ? 0 : 1.2)) st.t = 0
        const t = st.t
        const x = vVis > 0 ? DV.x0 + Math.min(run, vVis * t) : (DV.x0 + DV.x1) / 2
        bot.position.set(x, DV.floorY + 0.75, 0.5)
        sonar.group.visible = !isSource
        beeper.visible = isSource
        for (const m of mics) m.g.visible = isSource
        const clipR = (px: number, py: number) => px > -18.2 && px < 0.4 && py > DV.floorY + 0.2 && py < 3.8
        waves.begin()
        if (isSource) {
          for (const w of sourceFronts(t, DV.x0, vVis, DV.cVis, DV.period, 14)) waves.put([w.x, DV.y, 0.3], w.r, 0, Math.PI, RING, 1.1 / (1 + w.r / 8), clipR)
        } else {
          const e = echoFronts(t, sonar.tx[0], DV.x0, vVis, DV.cVis, DV.period, 14)
          for (const w of e.out) waves.put([w.x, DV.y, 0.3], w.r, Math.PI, 0.9, CLK_COLOR, 1.1 / (1 + w.r / 10), (px, py) => clipR(px, py) && px > x)
          for (const w of e.back) waves.put([w.x, DV.y, 0.3], w.r, 0, 0.9, POWER, 0.9 / (1 + w.r / 10), clipR)
        }
        waves.end()
        setGlow(beepM, RING, isSource ? 0.6 + 0.8 * Math.max(0, Math.sin((2 * Math.PI * t) / DV.period)) : 0)

        mics[0].tag.set(isSource ? `ahead ${hzText(R.ahead)}` : `echo ${hzText(R.ahead)}`, isSource ? B_FIELD : POWER)
        mics[1].tag.set(isSource ? `behind ${hzText(R.behind)}` : '', HEAT)
        const win = DV.cycles / R.f
        const amp = sc.h * 0.13
        const row = sc.h / 3
        sent.draw((u) => amp * Math.sin(2 * Math.PI * R.f * u * win) - (isSource ? 0 : row / 2), null)
        up.draw((u) => (isSource ? row : row / 2) + amp * Math.sin(2 * Math.PI * R.ahead * u * win), null)
        setGlow(up.material, isSource ? B_FIELD : POWER, 0.9)
        dn.group.visible = isSource
        dn.draw((u) => -row + amp * Math.sin(2 * Math.PI * R.behind * u * win), null)
        sc.hi.set(msText(win, 2))
        sc.right.set(`${isSource ? 'ahead' : 'echo'} +${((R.ahead / R.f - 1) * 100).toFixed(1)} %`, isSource ? B_FIELD : POWER)

        const full = isSource ? 10 : 20
        sh.right.set(`±${full} % of f`, GREY)
        const yPct = (fr: number) => ((fr - 1) * 100 * sh.h) / 2 / full
        const vAt = (u: number) => u * DV.vMax
        upCurve.draw((u) => yPct((isSource ? dopplerHz(1, R.c, vAt(u)) : echoDopplerHz(1, R.c, vAt(u)))), R.v / DV.vMax)
        setGlow(upCurve.material, isSource ? B_FIELD : POWER, 0.9)
        dnCurve.group.visible = isSource
        dnCurve.draw((u) => yPct(dopplerHz(1, R.c, -vAt(u))), R.v / DV.vMax)

        head.status.set(`Doppler · ${DOP.modes[R.mode]} · ${mpsText(R.v, 1)} · ${hzText(R.f)}`, LABEL)
        head.event.set(
          isSource ? `ahead ${dHz(R.ahead - R.f)}, behind ${dHz(R.behind - R.f)}` : `echo ${dHz(R.ahead - R.f)} → v = ${mpsText(R.back!, 2)}`,
          R.v > 0 ? B_FIELD : GREY,
        )
        head.sub.set(`wavefronts slowed, robot drawn ${DV.exag}× faster (v/c ${pct(beta)}) · scope and numbers real`)
      },
      readouts: (p) => {
        const R = dopRun(dopParams(p))
        return R.mode === 'source'
          ? [
              { label: 'Sent', value: hzText(R.f) },
              { label: 'Heard ahead', value: `${hzText(R.ahead)} (${dHz(R.ahead - R.f)})` },
              { label: 'Heard behind', value: `${hzText(R.behind)} (${dHz(R.behind - R.f)})` },
              { label: 'v / c', value: pct(R.v / R.c) },
            ]
          : [
              { label: 'Sent', value: hzText(R.f) },
              { label: 'Echo heard', value: `${hzText(R.ahead)} (${dHz(R.ahead - R.f)})` },
              { label: 'Speed from shift', value: mpsText(R.back!, 2), tone: 'ok' },
              { label: 'Shift ≈ 2·v/c', value: `${((2 * R.v * 100) / R.c).toFixed(2)} %` },
            ]
      },
    }
  },
}
