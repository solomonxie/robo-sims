// Measuring close-ups: a 150 mm caliper (vernier / dial / digital) drawn mm × k, zoomed scale windows, a dial face, and
// fit / stack-up sections with a batch strip for tolerances.
import * as THREE from 'three/webgpu'
import { CaliperKind, FitClass, VERNIER } from '../../core/physics'
import { V3, add, box, cylinder, mat } from '../../models/kit'
import { B_FIELD, GREY, HEAT, HIGH_V, INK, POWER, RING, glowMat, setGlow } from './colors'
import { flatBox } from './shapes'
import { liveLabel } from './text'

/** Fit class → colour (Design for printing, Tolerances). */
export const FIT_TINT: Record<FitClass, string> = { stuck: HIGH_V, press: HEAT, snug: POWER, slide: B_FIELD, loose: RING }
/** Printed PLA, and bought steel parts. */
export const PLA_TINT = '#e8833a'
export const PART_STEEL = '#c9ced6'

const CAL_STEEL = () => mat('#c9ced6', { metal: 0.55, rough: 0.3 })
const SCALE_INK = () => mat(INK, { rough: 0.9 })
/** Main-scale band on the beam (mm above the beam's lower edge): ticks rise from `y`; the vernier hangs below it. */
const SCALE = { y: 8, beamH: 16, jawL: 40, knifeL: 14 }

/**
 * 150 mm caliper seen face-on, mm × `k`: beam along +x, the fixed jaws' measuring faces at x = 0, outside jaws down,
 * knife (inside) jaws up, depth rod out of the beam end. `setKind` shows the vernier plate, a dial or an LCD;
 * `set(gapMm, text, needle)` opens it (text on the LCD, needle = fraction of a dial turn); `tint(c)` colours the jaw tips.
 */
export function vernierCaliper(parent: THREE.Object3D, k: number, at: V3, reach = 100) {
  const group = add(parent, new THREE.Group(), at)
  const steel = CAL_STEEL()
  const ink = SCALE_INK()
  const tipMat = glowMat(POWER, 0)
  const s = (v: number) => v * k
  box(group, [s(reach + 12), s(SCALE.beamH), s(3)], steel, [s((reach - 12) / 2), s(SCALE.beamH / 2), 0])
  // Fixed jaws.
  box(group, [s(10), s(SCALE.jawL - 8), s(3)], steel, [s(-5), s(-(SCALE.jawL - 8) / 2), 0])
  box(group, [s(4), s(8), s(3)], tipMat, [s(-2), s(-SCALE.jawL + 4), 0])
  box(group, [s(3), s(SCALE.knifeL), s(1.5)], steel, [s(1.5), s(SCALE.beamH + SCALE.knifeL / 2), s(-0.8)])
  // Main scale: 1 mm ticks, every 10 mm numbered in cm.
  for (let m = 0; m <= reach - 4; m++) {
    const len = m % 10 === 0 ? 4.5 : m % 5 === 0 ? 3.2 : 2
    flatBox(group, [s(0.18), s(len), s(0.1)], ink, [s(m), s(SCALE.y + len / 2), s(1.6)])
    if (m % 10 === 0) liveLabel(group, [s(m), s(SCALE.y + 6.4), s(1.7)], { size: s(2.6), glow: false }).set(`${m / 10}`, INK)
  }
  const slider = add(group, new THREE.Group())
  box(slider, [s(62), s(SCALE.y + 2), s(4)], steel, [s(27), s(SCALE.y / 2 - 1), s(0.6)])
  box(slider, [s(62), s(3), s(4)], steel, [s(27), s(SCALE.beamH + 1.5), s(0.6)])
  box(slider, [s(10), s(SCALE.jawL - 8), s(3)], steel, [s(5), s(-(SCALE.jawL - 8) / 2), 0])
  box(slider, [s(4), s(8), s(3)], tipMat, [s(2), s(-SCALE.jawL + 4), 0])
  box(slider, [s(3), s(SCALE.knifeL), s(1.5)], steel, [s(-1.5), s(SCALE.beamH + SCALE.knifeL / 2), s(0.8)])
  cylinder(slider, s(4), s(3), mat('#7d838e', { rough: 0.5 }), [s(30), s(-5), s(0.6)], 'z', 20)
  // Vernier plate: 51 lines over 49 mm, numbered 0…10 every fifth.
  const vernier = add(slider, new THREE.Group(), [0, 0, s(2.7)])
  for (let i = 0; i <= VERNIER.lines; i++) {
    const len = i % 10 === 0 ? 4 : i % 5 === 0 ? 3 : 2
    flatBox(vernier, [s(0.18), s(len), s(0.1)], ink, [s(i * (VERNIER.spanMm / VERNIER.lines)), s(SCALE.y - len / 2), 0])
    if (i % 5 === 0) liveLabel(vernier, [s(i * (VERNIER.spanMm / VERNIER.lines)), s(SCALE.y - 6), s(0.1)], { size: s(2), glow: false }).set(`${i / 5}`, INK)
  }
  // Dial: 2 mm a turn, 100 divisions.
  const dial = add(slider, new THREE.Group(), [s(24), s(-10), s(2.7)])
  cylinder(dial, s(16), s(1), mat('#f2f2ee', { rough: 0.6 }), [0, 0, 0], 'z', 48)
  for (let i = 0; i < 100; i += 2) {
    const a = (i / 100) * Math.PI * 2
    const t = flatBox(dial, [s(0.25), s(i % 10 === 0 ? 2.6 : 1.4), s(0.1)], ink, [s(Math.sin(a) * 14.4), s(Math.cos(a) * 14.4), s(0.55)])
    t.rotation.z = -a
  }
  const needle = add(dial, new THREE.Group(), [0, 0, s(0.7)])
  flatBox(needle, [s(0.5), s(14), s(0.1)], glowMat(HIGH_V, 0.6), [0, s(6), 0])
  // Digital readout.
  const lcd = add(slider, new THREE.Group(), [s(26), s(-8), s(2.7)])
  box(lcd, [s(36), s(16), s(2)], mat('#2a2d34', { rough: 0.6 }), [0, 0, 0])
  box(lcd, [s(28), s(9), s(0.4)], mat('#9fb59a', { rough: 0.5, emissive: '#2a3a28' }), [0, s(1.5), s(1.1)])
  const lcdText = liveLabel(lcd, [0, s(1.5), s(1.4)], { size: s(5), glow: false })
  const rod = flatBox(group, [1, s(1.6), s(1.6)], steel, [0, s(SCALE.y), 0])
  return {
    group,
    slider,
    /** Knife-jaw tips (local), the depth rod's root. */
    knifeY: s(SCALE.beamH + SCALE.knifeL * 0.7),
    jawY: s(-SCALE.jawL / 2),
    endX: s(reach),
    rodY: s(SCALE.y),
    setKind(kind: CaliperKind) {
      vernier.visible = kind === 'vernier'
      dial.visible = kind === 'dial'
      lcd.visible = kind === 'digital'
    },
    set(gapMm: number, text: string, needleTurn: number, showRod = false) {
      slider.position.x = s(gapMm)
      needle.rotation.z = -needleTurn * Math.PI * 2
      lcdText.set(text, INK)
      const g = Math.max(0.01, s(gapMm))
      rod.scale.x = g
      rod.position.x = s(reach) + g / 2
      rod.visible = showRod && gapMm > 0.05
    },
    tint(color: string, glow: number) {
      setGlow(tipMat, color, glow)
      if (glow <= 0) tipMat.color.set('#c9ced6')
    },
  }
}

/**
 * Magnified strip of the main scale centred on `centreMm` (`kz` units per mm, `w` wide): main ticks up, and either the
 * vernier lines down (`vernier`) or the slider edge (`edge`). The line `glowLine` (and the main tick it meets) glows.
 */
export function scaleZoom(parent: THREE.Object3D, at: V3, w: number, kz: number) {
  const group = add(parent, new THREE.Group(), at)
  flatBox(group, [w + 0.4, 3.7, 0.06], mat('#e9e6dc', { rough: 0.8 }), [0, 0, 0])
  flatBox(group, [w + 0.4, 0.05, 0.08], mat('#9a978e'), [0, 0, 0.04])
  const ink = SCALE_INK()
  const hot = glowMat(POWER, 1)
  const N = Math.ceil(w / kz) + 3
  const mains = Array.from({ length: N }, () => flatBox(group, [0.07, 1, 0.1], ink, [0, 0, 0.06]))
  const mainNums = Array.from({ length: N }, () => liveLabel(group, [0, 1.45, 0.12], { size: 0.3, glow: false }))
  const verns = Array.from({ length: N + 2 }, () => flatBox(group, [0.07, 1, 0.1], ink, [0, 0, 0.06]))
  const vernNums = Array.from({ length: N + 2 }, () => liveLabel(group, [0, -1.5, 0.12], { size: 0.28, glow: false }))
  const edge = flatBox(group, [0.12, 2, 0.12], glowMat(HIGH_V, 0.6), [0, -1, 0.08])
  const title = liveLabel(group, [-w / 2, 2.25, 0.12], { size: 0.28, align: 'left' })
  const half = w / 2
  return {
    group,
    title,
    set(mode: 'vernier' | 'edge', readingMm: number, centreMm: number, glowLine: number | null) {
      const x = (mm: number) => (mm - centreMm) * kz
      const first = Math.ceil(centreMm - half / kz)
      const glowMain = glowLine === null ? null : Math.round(readingMm + glowLine * (VERNIER.spanMm / VERNIER.lines))
      mains.forEach((t, i) => {
        const m = first + i
        const on = Math.abs(x(m)) <= half
        t.visible = on
        mainNums[i].group.visible = on
        if (!on) return
        const len = m % 10 === 0 ? 1.15 : m % 5 === 0 ? 0.9 : 0.6
        t.scale.y = len
        t.position.set(x(m), len / 2, 0.06)
        t.material = m === glowMain && mode === 'vernier' ? hot : ink
        mainNums[i].group.position.x = x(m)
        mainNums[i].set(`${m}`, m % 10 === 0 ? INK : '#4a4d55')
      })
      const step = VERNIER.spanMm / VERNIER.lines
      const i0 = Math.max(0, Math.ceil((centreMm - half / kz - readingMm) / step))
      verns.forEach((t, j) => {
        const i = i0 + j
        const xi = x(readingMm + i * step)
        const on = mode === 'vernier' && i <= VERNIER.lines && Math.abs(xi) <= half
        t.visible = on
        vernNums[j].group.visible = on && i % 5 === 0
        if (!on) return
        const len = i % 5 === 0 ? 1.05 : 0.7
        t.scale.y = len
        t.position.set(xi, -len / 2, 0.06)
        t.material = i === glowLine ? hot : ink
        vernNums[j].group.position.x = xi
        vernNums[j].set(`${i / 5}`, INK)
      })
      edge.visible = mode === 'edge' || Math.abs(x(readingMm)) <= half
      edge.position.x = x(readingMm)
      setGlow(edge.material as THREE.MeshStandardMaterial, mode === 'edge' ? HIGH_V : POWER, mode === 'edge' ? 0.6 : 0)
      if (mode === 'vernier') edge.visible = false
    },
  }
}

/** Enlarged dial face (radius `r`): 0…100 ring, needle at `turn` of a revolution. */
export function dialFace(parent: THREE.Object3D, at: V3, r: number) {
  const group = add(parent, new THREE.Group(), at)
  cylinder(group, r, 0.1, mat('#f2f2ee', { rough: 0.6 }), [0, 0, 0], 'z', 48)
  const ink = SCALE_INK()
  for (let i = 0; i < 100; i++) {
    const a = (i / 100) * Math.PI * 2
    const len = i % 10 === 0 ? r * 0.18 : i % 5 === 0 ? r * 0.12 : r * 0.07
    const t = flatBox(group, [0.05, len, 0.06], ink, [Math.sin(a) * (r - len / 2 - 0.08), Math.cos(a) * (r - len / 2 - 0.08), 0.08])
    t.rotation.z = -a
    if (i % 10 === 0) liveLabel(group, [Math.sin(a) * r * 0.62, Math.cos(a) * r * 0.62, 0.1], { size: r * 0.13, glow: false }).set(`${i}`, INK)
  }
  const needle = add(group, new THREE.Group(), [0, 0, 0.14])
  flatBox(needle, [0.08, r * 0.9, 0.06], glowMat(HIGH_V, 0.8), [0, r * 0.4, 0])
  return {
    group,
    set(turn: number) {
      needle.rotation.z = -turn * Math.PI * 2
    },
  }
}

type FitItem = 'bearing' | 'screw' | 'pin'

/**
 * Section through a printed block with a vertical hole (bed face up, so the elephant-foot lips sit at the mouth) and
 * the bought part going in from above. Widths are scene units: `set({ hole, mouth, shaft, depth, drop, stuckAt, tint })`
 * — `drop` 0…1 lowers it in; it stops on the lips when `stuck`.
 */
export function fitSection(parent: THREE.Object3D, at: V3, blockW = 12) {
  const group = add(parent, new THREE.Group(), at)
  const pla = mat(PLA_TINT, { rough: 0.7 })
  const left = flatBox(group, [1, 1, 1], pla, [0, 0, 0])
  const right = flatBox(group, [1, 1, 1], pla, [0, 0, 0])
  const lipMat = glowMat(HEAT, 0.3)
  const lipL = flatBox(group, [1, 0.45, 1.05], lipMat, [0, 0, 0])
  const lipR = flatBox(group, [1, 0.45, 1.05], lipMat, [0, 0, 0])
  const item = add(group, new THREE.Group())
  const steel = mat(PART_STEEL, { metal: 0.45, rough: 0.35 })
  const overlap = glowMat(HIGH_V, 0.8)
  const body = flatBox(item, [1, 1, 1], steel, [0, 0, 0])
  const head = flatBox(item, [1, 1, 1], steel, [0, 0, 0])
  const bore = flatBox(item, [1, 1, 1.02], mat('#2a2d34'), [0, 0, 0])
  const balls = [-1, 1].map((sx) => add(item, new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat('#e6e9ee', { metal: 0.4, rough: 0.25 })), [sx, 0, 0.3]))
  const bands = [-1, 1].map(() => flatBox(item, [0.12, 1, 1.1], overlap, [0, 0, 0]))
  return {
    group,
    set(o: { kind: FitItem; hole: number; mouth: number; shaft: number; depth: number; itemH: number; drop: number; stuck: boolean; press: boolean; wobble: number }) {
      const { hole, mouth, shaft, depth, itemH } = o
      const side = (blockW - hole) / 2
      left.scale.set(side, depth, 1.6)
      left.position.set(-hole / 2 - side / 2, -depth / 2, 0)
      right.scale.set(side, depth, 1.6)
      right.position.set(hole / 2 + side / 2, -depth / 2, 0)
      const lip = Math.max(0.001, (hole - mouth) / 2)
      lipL.visible = lipR.visible = hole - mouth > 0.01
      lipL.scale.x = lipR.scale.x = lip
      lipL.position.set(-hole / 2 + lip / 2, -0.22, 0.3)
      lipR.position.set(hole / 2 - lip / 2, -0.22, 0.3)
      body.scale.set(shaft, itemH, 1.2)
      body.position.set(0, -itemH / 2, 0)
      head.visible = o.kind === 'screw'
      head.scale.set(shaft * 1.9, shaft * 1.0, 1.2)
      head.position.set(0, shaft * 0.5, 0)
      bore.visible = o.kind === 'bearing'
      bore.scale.set(shaft * 0.36, itemH, 1)
      bore.position.set(0, -itemH / 2, 0.05)
      balls.forEach((b, i) => {
        b.visible = o.kind === 'bearing'
        b.scale.setScalar(itemH * 0.28)
        b.position.set((i ? 1 : -1) * shaft * 0.31, -itemH / 2, 0.4)
      })
      const rest = o.stuck ? itemH : o.kind === 'pin' ? itemH * 0.35 : 0
      const top = rest + (1 - o.drop) * (itemH * 0.6 + 1.5)
      item.position.set(0, top, 0)
      item.rotation.z = o.wobble
      bands.forEach((b, i) => {
        b.visible = o.press && o.drop > 0.6
        b.scale.y = itemH
        b.position.set((i ? 1 : -1) * shaft / 2, -itemH / 2, 0.9)
      })
    },
  }
}

/** Side section of parts stacked between two printed walls: `set(widths, colours, slot, foot, height)` in scene units;
 *  parts that overrun the slot glow red at the right wall. */
export function stackSection(parent: THREE.Object3D, at: V3, n: number) {
  const group = add(parent, new THREE.Group(), at)
  const pla = mat(PLA_TINT, { rough: 0.7 })
  const wallL = flatBox(group, [1.4, 1, 1.6], pla, [0, 0, 0])
  const wallR = flatBox(group, [1.4, 1, 1.6], pla, [0, 0, 0])
  const footMat = glowMat(HEAT, 0.3)
  const feet = [0, 1].map(() => flatBox(group, [1, 0.5, 1.7], footMat, [0, 0, 0]))
  const parts = Array.from({ length: n }, () => {
    const m = new THREE.MeshStandardMaterial({ color: PART_STEEL, roughness: 0.5 })
    return { mesh: flatBox(group, [1, 1, 1.2], m, [0, 0, 0]), m }
  })
  const axle = flatBox(group, [1, 0.5, 1.3], mat('#7d838e', { metal: 0.4 }), [0, 0, 0.1])
  const clash = flatBox(group, [0.2, 1, 1.8], glowMat(HIGH_V, 0.9), [0, 0, 0])
  const gapBar = flatBox(group, [1, 0.25, 1.8], glowMat(POWER, 0.8), [0, 0, 0])
  return {
    group,
    set(widths: number[], colors: string[], heights: number[], slot: number, foot: number, H: number) {
      wallL.scale.y = wallR.scale.y = H
      wallL.position.set(-0.7, 0, 0)
      wallR.position.set(slot + 0.7, 0, 0)
      feet.forEach((f, i) => {
        f.visible = foot > 0.01
        f.scale.x = Math.max(0.01, foot)
        f.position.set(i ? slot - foot / 2 : foot / 2, -H / 2 + 0.25, 0.1)
      })
      let x = 0
      parts.forEach((p, i) => {
        p.mesh.scale.set(widths[i] - 0.06, heights[i], 1.2)
        p.mesh.position.set(x + widths[i] / 2, 0, 0)
        p.m.color.set(colors[i])
        x += widths[i]
      })
      axle.scale.x = x + 2.8
      axle.position.set(x / 2, 0, 0.1)
      clash.visible = x > slot
      clash.position.set(slot, 0, 0.2)
      clash.scale.y = H * 0.8
      gapBar.visible = slot > x
      gapBar.scale.x = Math.max(0.01, slot - x)
      gapBar.position.set((x + slot) / 2, H / 2 - 0.4, 0.2)
    },
  }
}

/** `n` small tiles in `cols` columns (left to right, top to bottom), `cell` apart; `set(colours)`. */
export function batchStrip(parent: THREE.Object3D, at: V3, n: number, cols: number, cell = 0.42) {
  const group = add(parent, new THREE.Group(), at)
  const mats = Array.from({ length: n }, (_, i) => {
    const m = glowMat(GREY, 0.5)
    flatBox(group, [cell * 0.8, cell * 0.8, 0.1], m, [(i % cols) * cell, -Math.floor(i / cols) * cell, 0])
    return m
  })
  return {
    group,
    set(colors: string[]) {
      mats.forEach((m, i) => setGlow(m, colors[i] ?? GREY, 0.6))
    },
  }
}
