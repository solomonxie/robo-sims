import * as THREE from 'three/webgpu'
import { EM_LANDMARKS, IONISING_EV, OBSTACLES, Obstacle, SPECTRUM_PARTS, SpectrumPart, emAt, landmarkNear, partView } from '../../core/physics'
import { hertz, lengthText, pct, sci, si, wavelengthText } from '../../core/units'
import { add, box, mat, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import { BAND_TINT, B_FIELD, GREY, HEAT, HIGH_V, LABEL, POWER, RING, addLabel, countBars, emWave, flatBox, glowMat, liveLabel, memoBy, setGlow, sideView, spectrumStrip, statusHeader } from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const VIEW = sideView(-2.2, -1.4)
const STRIP = { x0: -16.5, w: 29 }
const plain = (s: string) => s.replace(/›/g, '>')
const evText = (ev: number) => si(ev, 'eV')
const rangeText = (a: string, b: string) => (a === b ? a : `${a} – ${b}`)
const SLOW = 0.5

// --- Wavelength and frequency: one slider sweeps radio to X-rays; the wave, λ and λ/4 drawn to scale against an everyday object. ---

const W = { x0: -16.5, x1: 4, y: -4.7, amp: 2.5, cycles: 2.5, obj: 6, base: -8, ox: 7.4, ax: 11.8 }
const STRIP_LANDMARKS = EM_LANDMARKS.filter((l) => !['red laser', 'green', 'blue LED'].includes(l.name)).map((l) => ({ ...l, name: l.name.replace('dental ', '') }))
const wfRun = memoBy(
  (p: Params) => `${n(p, 'logf')}`,
  (p: Params) => {
    const hz = 10 ** n(p, 'logf')
    const E = emAt(hz)
    const scale = Math.min((W.x1 - W.x0) / (W.cycles * E.lambda), W.obj / E.like.m)
    return { ...E, near: landmarkNear(hz), scale, slow: hz / SLOW }
  },
)
const seenText = (R: ReturnType<typeof wfRun>) =>
  R.ionising
    ? ['ionising: knocks electrons off atoms, so it is shielded', HIGH_V]
    : R.seenBy.includes('eye')
      ? ['eyes and camera silicon both see this', POWER]
      : R.seenBy.includes('silicon')
        ? ['camera silicon sees this; eyes do not', POWER]
        : R.seenBy.includes('thermal')
          ? ['a thermopile feels this as heat', HEAT]
          : R.antenna
            ? ['caught by an antenna a quarter-wave long', B_FIELD]
            : ['no sensor in a robot kit lives here', GREY]

export const electromagneticSpectrumWavelengthAndFrequency: Lesson = {
  id: 'electromagnetic-spectrum-wavelength-and-frequency',
  title: 'Wavelength and frequency',
  tagline: 'Radio, light and X-rays are one wave; only the frequency changes',
  formula: (p) => {
    const R = wfRun(p)
    return `λ = c / f = 3×10⁸ m/s / ${hertz(R.hz)} = ${wavelengthText(R.lambda)} · photon E = h·f = 6.63×10⁻³⁴ J·s × ${hertz(R.hz)} = ${evText(R.ev)}${R.antenna ? ` · λ/4 whip = 0.95 × λ/4 = ${lengthText(R.antenna)}` : ''}`
  },
  legend: [
    { color: HIGH_V, label: 'E field', shape: 'dot' },
    { color: B_FIELD, label: 'B field, at right angles', shape: 'dot' },
    { color: RING, label: 'Wavelength λ and where it sits (log scale)', shape: 'dot' },
    { color: LABEL, label: 'Everyday object, same scale as the wave', shape: 'dot' },
  ],
  points: [
    'Radio, microwaves, infrared, light, UV and X-rays are all the same thing: an electric and a magnetic field regenerating each other, travelling at c = 3×10⁸ m/s. The only thing that changes is how fast they oscillate. c = f·λ ties the frequency to the wavelength: 2.4 GHz Wi-Fi is 12 cm long, green light half a micrometre.',
    'The wavelength decides what can send and catch the wave. Down to millimetres you build an antenna about λ/4 long (Signals › Radio basics › Antenna types), so a 868 MHz LoRa whip is 8 cm and a 60 GHz radar antenna fits on the chip. Infrared and light are far too short for wires: atoms and semiconductor junctions emit and absorb them, which is why LEDs and photodiodes replace antennas.',
    'Light also comes in packets, photons, of energy E = h·f. A Wi-Fi photon carries 10 µeV, far too little to do anything but warm what absorbs it. Silicon needs 1.12 eV to free an electron, so cameras stop near 1.1 µm (Infrared & thermal › Black-body radiation). UV photons (3–10 eV) break chemical bonds: sunburn, yellowed plastic. Above about 10 eV they knock electrons off atoms (ionising), which is why X-rays are shielded and radio is not.',
    'The band names are conventions: radio turns into microwave around 3 GHz (10 cm), microwave into infrared at 1 mm. The spectrum strip is logarithmic: each tick is ten times shorter, and 11 decades fit across it.',
    'The wave is drawn to scale next to the everyday thing closest in size, and slowed so a crest takes 2 s per wavelength: by 10⁹ times for radio, 10¹⁵ for light.',
  ],
  controls: [
    {
      kind: 'slider',
      key: 'logf',
      label: 'Frequency (log)',
      min: 8,
      max: 19,
      step: 0.05,
      initial: 9.4,
      format: (v) => {
        const near = landmarkNear(10 ** v)
        return `${hertz(10 ** v)}${near ? ` · ${near.name}` : ''}`
      },
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const strip = spectrumStrip(scene, [STRIP.x0, 2.2, 0], STRIP.w, 0.9, 3, 10e-12, { size: 0.24 })
    const stemM = glowMat(GREY, 0.3)
    STRIP_LANDMARKS.forEach((l, i) => {
      const x = strip.xOf(emAt(l.hz).lambda)
      const y = 0.4 - (i % 3) * 0.55
      flatBox(scene, [0.05, 1.75 - y - 0.2, 0.05], stemM, [x, (1.75 + y + 0.2) / 2, -0.05])
      addLabel(scene, l.name, [x, y, 0.2], LABEL, 0.24)
    })

    const wave = emWave(scene, W.x0, W.x1, { y: W.y, arrows: 180 })
    addLabel(scene, 'E', [W.x1 + 0.7, W.y + W.amp * 0.7, 0], HIGH_V, 0.5, 'left')
    addLabel(scene, 'B', [W.x1 + 0.7, W.y - 0.3, W.amp * 0.8], B_FIELD, 0.5, 'left')

    const lamM = glowMat(RING, 0.8)
    const lam = add(scene, new THREE.Group(), [W.x0, W.base - 0.4, 0])
    const lamBar = add(lam, mesh(new THREE.BoxGeometry(1, 0.08, 0.08), lamM))
    const lamEnds = [0, 1].map(() => add(lam, mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), lamM)))
    const lamTag = liveLabel(lam, [0, -0.6, 0], { size: 0.34 })

    box(scene, [9, 0.12, 2.4], mat('#2a2d33', { rough: 0.8 }), [(W.ox + W.ax) / 2, W.base - 0.06, 0])
    const objM = glowMat(LABEL, 0.5)
    const obj = add(scene, mesh(new THREE.BoxGeometry(1.2, 1, 1.2), objM), [W.ox, W.base, 0])
    const objTag = liveLabel(scene, [W.ox, W.base - 0.6, 0.6], { size: 0.28 })
    const antM = mat('#c9ccd1', { metal: 0.6, rough: 0.3 })
    const ant = add(scene, mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 12), antM), [W.ax, W.base, 0])
    const antTag = liveLabel(scene, [(W.ox + W.ax) / 2, W.base - 1.2, 0.6], { size: 0.28 })
    const st = { t: 0 }
    return {
      scene,
      view: VIEW,
      frame(dt, p) {
        const R = wfRun(p)
        st.t += dt
        const lu = R.lambda * R.scale
        wave.set(lu, st.t * SLOW, W.amp)
        strip.cursor(R.lambda)
        const lw = Math.min(lu, W.x1 - W.x0)
        lamBar.scale.x = lw
        lamBar.position.x = lw / 2
        lamEnds[1].position.x = lw
        lamTag.group.position.x = lw / 2
        lamTag.set(`λ = ${wavelengthText(R.lambda)}`, RING)

        const oh = Math.max(0.05, R.like.m * R.scale)
        obj.scale.y = oh
        obj.position.y = W.base + oh / 2
        objTag.set(`${R.like.name}, ${wavelengthText(R.like.m)}`, LABEL)
        ant.visible = R.antenna !== null
        if (R.antenna) {
          const ah = R.antenna * R.scale
          ant.scale.y = ah
          ant.position.y = W.base + ah / 2
          antTag.set(`λ/4 whip ${lengthText(R.antenna)}`, B_FIELD)
        } else antTag.set('no antenna: atoms emit this', GREY)

        const [ev, evColor] = seenText(R)
        head.status.set(`${R.band.name} · ${hertz(R.hz)}${R.near ? ` · ${R.near.name}` : ''}`, BAND_TINT[R.band.key] === '#ffffff' ? RING : LABEL)
        head.sub.set(`photon ${evText(R.ev)}${R.ev >= IONISING_EV ? ' (≥ 10 eV)' : ''} · drawn to scale, slowed`)
        head.event.set(ev, evColor)
      },
      readouts: (p) => {
        const R = wfRun(p)
        return [
          { label: 'Frequency', value: hertz(R.hz) },
          { label: 'Wavelength', value: `${wavelengthText(R.lambda)} (${R.band.name})` },
          { label: 'Photon energy', value: evText(R.ev), tone: R.ionising ? 'bad' : R.ev > 3.3 ? 'warn' : 'ok' },
          { label: 'Slowed by', value: `${sci(R.slow, 1)} ×` },
        ]
      },
    }
  },
}

// --- Where sensors live: robot parts placed on one log strip; picking one shows its band, its strengths, and what blocks it. ---

const PART_LIST = Object.keys(SPECTRUM_PARTS) as SpectrumPart[]
const PART_SHORT: Record<SpectrumPart, string> = {
  lora: 'LoRa',
  gps: 'GPS',
  wifi: 'Wi-Fi/BT',
  nrf24: 'nRF24',
  radar: '24G radar',
  remote: 'IR remote',
  tcrt: 'TCRT5000',
  tof: 'VL53L0X',
  camera: 'camera',
  thermal: 'thermal',
  uv: 'UV',
}
const PART_ROW: Record<SpectrumPart, number> = { lora: 0, gps: 1, wifi: 2, nrf24: 3, radar: 0, thermal: 0, camera: 0, remote: 1, tcrt: 2, tof: 3, uv: 1 }
const OBST = Object.keys(OBSTACLES) as Obstacle[]
const DB_FLOOR = 60
const sunText = (f: number) => (f < 0.001 ? (f < 1e-6 ? 'none' : '< 0.1 %') : f < 0.1 ? `${(f * 100).toFixed(1)} %` : pct(f))
const lossColor = (db: number) => (db < 3 ? POWER : db < 20 ? HEAT : HIGH_V)
const wsRun = memoBy(
  (k: SpectrumPart) => k,
  (k: SpectrumPart) => partView(k),
)
const wsParams = (p: Params) => pick(SPECTRUM_PARTS, p.part, 'wifi') as SpectrumPart

export const electromagneticSpectrumWhereSensorsLive: Lesson = {
  id: 'electromagnetic-spectrum-where-sensors-live',
  title: 'Where sensors live',
  tagline: 'Radios, cameras, lasers and thermal sensors on one strip',
  formula: (p) => {
    const R = wsRun(wsParams(p))
    return `${R.name}: ${rangeText(hertz(R.hzLo), hertz(R.hzHi))} · λ = c / f = ${rangeText(wavelengthText(R.hi), wavelengthText(R.lo))} · photon ${evText(R.ev)} · ${OBST.map((o, i) => `${OBSTACLES[o].name} −${Math.round(R.loss[i])} dB`).join(', ')}`
  },
  legend: [
    { color: RING, label: 'Selected part: its band on the strip', shape: 'dot' },
    { color: POWER, label: 'Passes (< 3 dB lost)', shape: 'dot' },
    { color: HEAT, label: 'Weakened (3–20 dB)', shape: 'dot' },
    { color: HIGH_V, label: 'Blocked (> 20 dB)', shape: 'dot' },
  ],
  points: [
    'Nearly every wireless link and many sensors on a robot are the same electromagnetic wave at different wavelengths. Radios sit at 0.1–1 m and use antennas; lasers, IR LEDs and cameras sit near 1 µm and use silicon; thermal sensors sit at 10 µm, where warm things glow (Infrared & thermal).',
    'Longer waves bend round and soak through more. LoRa at 868 MHz crosses buildings; 2.4 GHz Wi-Fi loses about 10 dB per wall (Signals › Radio basics › 2.4 GHz) and is soaked up by water and bodies; 24 and 60 GHz radar stops at a wall but sees straight through a plastic case.',
    'Why so much at 940 nm: silicon sees it, eyes do not, the LEDs cost cents, and water vapour in the air takes a bite out of sunlight there. The sun still floods it outdoors, which is the Sensors › Infrared › Sunlight interference problem; the chip shows the share of sunlight in each band.',
    'Glass is clear to light and near IR but a wall to thermal IR (8–14 µm) and to most UV: a thermal camera cannot see through a window, and needs a germanium lens. Fog scatters light and IR but not radar.',
    'Losses are rough, for a typical thickness (a brick wall, a window, 100 m of fog, 2 cm of water); real numbers depend on moisture, metal and angle.',
  ],
  controls: [{ kind: 'choice', key: 'part', options: opts(Object.fromEntries(PART_LIST.map((k) => [k, SPECTRUM_PARTS[k].name])) as Record<SpectrumPart, string>), initial: 'wifi' }],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const strip = spectrumStrip(scene, [STRIP.x0, 2.4, 0], STRIP.w, 1.2, 3, 100e-9, { size: 0.26 })
    const pins = PART_LIST.map((k) => {
      const v = partView(k)
      const x = strip.xOf(v.mid)
      const y = -0.3 - PART_ROW[k] * 0.6
      const m = glowMat(GREY, 0.3)
      flatBox(scene, [0.05, 1.8 - y - 0.2, 0.05], m, [x, (1.8 + y + 0.2) / 2, -0.05])
      return { k, m, tag: liveLabel(scene, [x, y, 0.2], { size: 0.26 }) }
    })

    const name = liveLabel(scene, [-16.5, -3.6, 0.3], { size: 0.5, align: 'left' })
    const lines = [0, 1, 2, 3, 4].map((i) => liveLabel(scene, [-16.5, -4.6 - i * 0.8, 0.3], { size: 0.3, align: 'left' }))
    addLabel(scene, `Signal left after (bar: 0 to −${DB_FLOOR} dB)`, [4.5, -3.6, 0.3], LABEL, 0.3, 'left')
    const bars = countBars(scene, [7.6, -4.6, 0], [...OBST.map((o) => OBSTACLES[o].name), 'Sunlight in band'], 4, { row: 0.8, size: 0.28 })
    return {
      scene,
      view: VIEW,
      frame(_dt, p) {
        const R = wsRun(wsParams(p))
        strip.span(R.lo, R.hi, 0.3)
        pins.forEach((q) => {
          const on = q.k === R.key
          q.tag.set(PART_SHORT[q.k], on ? RING : LABEL)
          setGlow(q.m, on ? RING : GREY, on ? 1 : 0.3)
        })
        name.set(R.name, RING)
        lines[0].set(`${R.band.name} · ${rangeText(hertz(R.hzLo), hertz(R.hzHi))} · λ ${rangeText(wavelengthText(R.hi), wavelengthText(R.lo))}`, LABEL)
        lines[1].set(R.antenna ? `antenna λ/4 ≈ ${lengthText(R.antenna)} · photon ${evText(R.ev)}` : `semiconductor detector · photon ${evText(R.ev)}`, R.antenna ? B_FIELD : LABEL)
        lines[2].set(`Good at: ${R.good}`, POWER)
        lines[3].set(`Blocked by: ${R.blocked}`, HEAT)
        lines[4].set(`See: ${plain(R.see)}`, GREY)
        const vals = [...R.loss.map((d) => Math.max(0, 1 - d / DB_FLOOR)), Math.min(1, R.sun / 0.5)]
        const texts = [...R.loss.map((d) => (d < 0.5 ? '0 dB' : `−${Math.round(d)} dB`)), sunText(R.sun)]
        bars.set(vals, texts, [...R.loss.map(lossColor), R.sun > 0.02 ? HEAT : POWER], 1)
        head.status.set(`Where sensors live · ${R.name}`, LABEL)
        head.sub.set('one log strip from 3 m radio to 100 nm UV')
        head.event.set(R.antenna ? 'radio: an antenna, walls cost dB' : R.band.key === 'infrared' && R.lo > 3e-6 ? 'thermal IR: sees heat, not through glass' : 'light: silicon detector, blocked by anything opaque', R.antenna ? B_FIELD : HEAT)
      },
      readouts: (p) => {
        const R = wsRun(wsParams(p))
        return [
          { label: 'Frequency', value: hertz(Math.sqrt(R.hzLo * R.hzHi)) },
          { label: 'Wavelength', value: wavelengthText(R.mid) },
          { label: 'Through a brick wall', value: `−${Math.round(R.loss[0])} dB`, tone: R.loss[0] < 3 ? 'ok' : R.loss[0] < 20 ? 'warn' : 'bad' },
          { label: 'Sunlight in band', value: sunText(R.sun), tone: R.sun > 0.02 ? 'warn' : 'ok' },
        ]
      },
    }
  },
}
