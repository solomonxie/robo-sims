import * as THREE from 'three/webgpu'
import {
  HOTENDS,
  HotendKey,
  LAYER_OVERHEAD_S,
  LAYER_SWEEP,
  LINE_W,
  MOVE_MM,
  PLA_FLOW_C,
  PRINTER_KINDS,
  PRINT_MOVES,
  PRINT_SHAPES,
  PathSeg,
  PrintLayer,
  PrintMove,
  PrintShape,
  PrinterKind,
  coreXY,
  filamentArea,
  flowView,
  layerPath,
  machineView,
  motorTargets,
  movePath,
  sliceView,
  toolpathAt,
  toolpathLength,
} from '../../core/physics'
import { celsiusText, durationText, fixedText, mmFixed, newtonsText, pct } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  FILAMENT_COLOR,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  LOW_V,
  POWER,
  PrinterPart,
  RING,
  WIDE_RIGHT,
  WIDE_VIEW,
  addLabel,
  coreXYPrinter,
  cursorBar,
  deltaPrinter,
  fdmPrinter,
  glowDot,
  hotendSection,
  liveLabel,
  memoBy,
  plotY,
  printBeads,
  shellMat,
  statusHeader,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, namesOf, opts, pick, toneOf } from '../types'

const LINK_MOTION = 'Printer motion'

// --- Anatomy of a printer: a bed slinger printing a small tray; highlight each part. ---

const PARTS: Record<PrinterPart, { name: string; what: string; more: string }> = {
  frame: { name: 'Frame', what: 'aluminium extrusions: square and stiff, or prints wobble', more: 'stiffness sets the top speed' },
  x: { name: 'X axis', what: 'stepper + GT2 belt pull the carriage left and right', more: `belts and steps/mm: ${LINK_MOTION}` },
  y: { name: 'Y axis', what: 'a second belt slides the whole bed front to back', more: 'a heavy bed limits acceleration' },
  z: { name: 'Z axis', what: 'two lead screws lift the gantry one layer at a time', more: 'T8 screw: 8 mm per turn' },
  hotend: { name: 'Hotend', what: 'heater block melts the plastic, the nozzle shapes it', more: 'see Hotend and extruder' },
  extruder: { name: 'Extruder', what: 'drive gears push filament in at a metered rate', more: 'direct drive: on the carriage' },
  bed: { name: 'Heated bed', what: '60 °C plate the first layer sticks to', more: 'levelling and adhesion: Bed adhesion' },
  board: { name: 'Mainboard', what: 'MCU runs the G-code, 4 stepper drivers, heater FETs', more: 'see Printer electronics' },
  psu: { name: 'Power supply', what: '24 V, about 350 W: the bed draws most of it', more: 'mains inside, keep it covered' },
  spool: { name: 'Filament spool', what: '1 kg of 1.75 mm PLA, about 330 m', more: 'materials: Filaments' },
}
const PART_KEYS = Object.keys(PARTS) as PrinterPart[]
const PART_OPTS = { tour: 'Tour all parts', ...Object.fromEntries(PART_KEYS.map((k) => [k, PARTS[k].name])) } as Record<string, string>

const TRAY = { r: 30, h: 12, layerH: 0.3, infill: 0.15 }
const trayLayers = (): { layer: PrintLayer; segs: PathSeg[] }[] => {
  const count = Math.round(TRAY.h / TRAY.layerH)
  return Array.from({ length: count }, (_, i) => {
    const layer: PrintLayer = { z: i * TRAY.layerH, r: TRAY.r, solid: i < 3 || i >= count - 3, len: 0, time: 0 }
    return { layer, segs: layerPath('box', layer, i, TRAY.infill) }
  })
}
const TRAY_PLAN = (() => {
  const layers = trayLayers()
  const flat = layers.flatMap(({ layer, segs }, li) => segs.map((s) => ({ ...s, z: layer.z, li, len: Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) })))
  return { layers, flat, mm: flat.reduce((s, g) => s + g.len, 0) }
})()
const trayTime = (speed: number) => TRAY_PLAN.mm / speed + TRAY_PLAN.layers.length * LAYER_OVERHEAD_S
const LAPSE_S = 45

export const howFdmWorksAnatomyOfAPrinter: Lesson = {
  id: 'how-fdm-works-anatomy-of-a-printer',
  title: 'Anatomy of a printer',
  tagline: 'Frame, three axes, a hotend, an extruder and a hot bed',
  formula: (p) => {
    const v = n(p, 'speed')
    return `print time ≈ path length / speed + layers × overhead = ${fixedText(TRAY_PLAN.mm / 1000, 1)} m / ${v} mm/s + ${TRAY_PLAN.layers.length} × ${LAYER_OVERHEAD_S} s = ${durationText(trayTime(v))} (60 × 60 × 12 mm tray, 0.3 mm layers, ${pct(TRAY.infill)} infill; typical, ignores acceleration)`
  },
  legend: [
    { color: RING, label: 'Highlighted part', shape: 'dot' },
    { color: FILAMENT_COLOR, label: 'PLA filament and print', shape: 'dot' },
    { color: HEAT, label: 'Heated: bed and hotend', shape: 'dot' },
  ],
  points: [
    'Fused deposition modelling (FDM): a motor pushes a plastic thread (filament) into a hot nozzle, the melt squeezes out as a thin bead, and the machine draws the part one flat layer at a time. Everything on the printer serves one of three jobs: move the nozzle, melt and meter the plastic, or hold the part.',
    'Motion: on this bed slinger (Cartesian, like an Ender 3 or Prusa MK) the X stepper pulls the carriage left-right on a belt, the Y stepper slides the whole bed front-back, and two lead screws lift the gantry in Z after each layer. The steppers and belts are Actuators › Stepper motors and Materials › Belts, chains, couplers; homing, steps/mm and input shaping come in Printer motion.',
    'Plastic: the extruder\'s drive gears bite the filament and push it at a metered rate; the hotend melts it in a heater block and the 0.4 mm nozzle shapes the bead. Hotend and extruder shows the inside; Filaments compares PLA, PETG, TPU and nylon.',
    'The part: the heated bed (about 60 °C for PLA) keeps the first layer stuck and flat; a part-cooling fan on the carriage freezes each bead so the next layer has something to sit on. Bed adhesion and Temperature & cooling go deeper.',
    'Brains and power: a 24 V supply feeds the mainboard, whose MCU reads G-code line by line, steps four stepper drivers (X, Y, Z, E) and switches the heaters with MOSFETs under PID control. See Printer electronics, G-code and Temperature & cooling.',
  ],
  controls: [
    { kind: 'choice', key: 'part', options: opts(PART_OPTS), initial: 'tour' },
    { kind: 'slider', key: 'speed', label: 'Print speed', min: 20, max: 200, step: 10, initial: 60, format: (v) => `${v} mm/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const k = 0.034
    const holder = add(scene, new THREE.Group(), [2.6, -12.2, 0])
    holder.rotation.set(0.22, -0.55, 0)
    const pr = fdmPrinter(holder, [0, 0, 0], k)
    const beads = printBeads(pr.bed, TRAY_PLAN.flat.length, k)
    TRAY_PLAN.flat.forEach((s, i) => beads.lay(i, s.a, s.b, s.z, LINE_W * 2.2, TRAY.layerH))
    beads.show(0)
    const tag = liveLabel(scene, [0, 0, 1], { size: 0.36, align: 'left' })
    const dot = glowDot(scene, 0.22, RING)
    const rows = textRows(scene, 3, -17, -2.6, 0.3, 0.7)
    const mot = textRows(scene, 4, -17, -6.6, 0.3, 0.62)
    addLabel(scene, 'motors turning now', [-17, -5.85, 0.2], LABEL, 0.28, 'left')
    const cum: number[] = []
    TRAY_PLAN.flat.reduce((s, g, i) => (cum[i] = s + g.len), 0)
    const st = { t: 0, tour: 0, e: 0, speed: 0 }
    const w = new THREE.Vector3()
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const speed = n(p, 'speed')
        const total = trayTime(speed)
        if (speed !== st.speed) st.speed = speed
        st.t = (st.t + (dt * total) / LAPSE_S) % (total * 1.08)
        const printT = Math.min(st.t, total)
        const perLayer = LAYER_OVERHEAD_S
        let mm = 0
        let layerNow = 0
        {
          let tLeft = printT
          for (const L of TRAY_PLAN.layers) {
            const len = toolpathLength(L.segs)
            const need = len / speed + perLayer
            if (tLeft < need) {
              mm += Math.max(0, tLeft - perLayer) * speed
              break
            }
            tLeft -= need
            mm += len
            layerNow++
          }
        }
        let i = cum.findIndex((c) => c > mm)
        if (i < 0) i = TRAY_PLAN.flat.length - 1
        const g = TRAY_PLAN.flat[i]
        const into = mm - (cum[i] - g.len)
        const u = Math.min(1, into / g.len)
        const x = g.a[0] + (g.b[0] - g.a[0]) * u
        const y = g.a[1] + (g.b[1] - g.a[1]) * u
        const done = st.t >= total
        beads.show(done ? TRAY_PLAN.flat.length : i)
        st.e += done ? 0 : dt * 3
        pr.set(done ? 0 : x, done ? -80 : y, done ? g.z + 40 : g.z + TRAY.layerH, st.e)
        pr.heat(0.45, 0.9)
        pr.fan.rotation.z -= dt * 20

        st.tour += dt
        const sel = p.part === 'tour' ? PART_KEYS[Math.floor(st.tour / 3) % PART_KEYS.length] : (pick(PARTS, p.part, 'hotend') as PrinterPart)
        for (const key of PART_KEYS) pr.glow(key, key === sel ? 0.6 + 0.4 * Math.sin(st.tour * 5) : 0)
        holder.updateMatrixWorld(true)
        w.set(...pr.pin(sel))
        holder.localToWorld(w)
        dot.position.copy(w)
        tag.group.position.set(w.x + 0.6, w.y + 0.5, w.z + 0.5)
        tag.set(PARTS[sel].name, RING)

        const P = PARTS[sel]
        rows[0].set(P.name, RING)
        rows[1].set(P.what, LABEL)
        rows[2].set(P.more, GREY)
        const dx = Math.abs(g.b[0] - g.a[0]) > 1e-6
        const dy = Math.abs(g.b[1] - g.a[1]) > 1e-6
        const zMove = !done && printT > 0 && into <= 0
        mot[0].set(`X carriage ${done ? 'parked' : dx ? 'moving' : 'still'}`, !done && dx ? POWER : GREY)
        mot[1].set(`Y bed ${done ? 'parked' : dy ? 'moving' : 'still'}`, !done && dy ? POWER : GREY)
        mot[2].set(`Z screws ${zMove ? 'lifting one layer' : 'holding'}`, zMove ? POWER : GREY)
        mot[3].set(`E extruder ${done ? 'stopped' : 'feeding'}`, done ? GREY : FILAMENT_COLOR)
        head.status.set(`Anatomy of a printer · ${speed} mm/s`)
        head.sub.set(`t = ${durationText(printT)} of ${durationText(total)}, time-lapse ${Math.round(total / LAPSE_S)}×`, GREY)
        head.event.set(done ? 'print done: the gantry lifts and the bed comes forward' : `layer ${Math.min(layerNow + 1, TRAY_PLAN.layers.length)} of ${TRAY_PLAN.layers.length}: ${g.wall ? 'walls' : 'infill'}`, done ? POWER : LABEL)
      },
      readouts: (p) => {
        const speed = n(p, 'speed')
        return [
          { label: 'Tray print time', value: durationText(trayTime(speed)), tone: toneOf(speed <= 100, speed <= 150) },
          { label: 'Layers', value: `${TRAY_PLAN.layers.length} × 0.3 mm` },
          { label: 'Filament', value: `${fixedText((TRAY_PLAN.mm * LINE_W * TRAY.layerH) / filamentArea() / 1000, 1)} m` },
        ]
      },
    }
  },
}

// --- Hotend and extruder: cut-away from the drive gears to the nozzle; core temperature lags the block. ---

const heParams = (p: Params) => ({
  hotend: pick(HOTENDS, p.hotend, 'v6') as HotendKey,
  blockC: n(p, 'temp'),
  speed: n(p, 'speed'),
  layerH: n(p, 'layer'),
})
const heRun = memoBy((p: Params) => `${p.hotend} ${p.temp} ${p.speed} ${p.layer}`, (p: Params) => {
  const q = heParams(p)
  return { q, V: flowView(q) }
})
const HE = { at: [-11, 1.6, 0] as V3, k: 0.27, tMax: 280, qMax: 40, vMax: 200 }

export const howFdmWorksHotendAndExtruder: Lesson = {
  id: 'how-fdm-works-hotend-and-extruder',
  title: 'Hotend and extruder',
  tagline: 'Gears push, the heat break stops the heat, the block melts',
  formula: (p) => {
    const { q, V } = heRun(p)
    return `Q = line width × layer height × speed = ${LINE_W} × ${q.layerH} × ${q.speed} = ${fixedText(V.Q, 1)} mm³/s = filament area × feed = ${fixedText(V.area, 2)} mm² × ${fixedText(V.feed, 2)} mm/s · core at the tip = T_block − (T_block − 60)·e^(−L/(feed·τ)) = ${celsiusText(V.exitC)} · max flow ${fixedText(V.maxQ, 1)} mm³/s (typical)`
  },
  legend: [
    { color: HEAT, label: 'Filament core temperature', shape: 'dot' },
    { color: GREY, label: 'Metal temperature', shape: 'dot' },
    { color: POWER, label: `PLA flows freely (${PLA_FLOW_C} °C)`, shape: 'dot' },
    { color: HIGH_V, label: 'Max flow the melt zone keeps up with', shape: 'dot' },
  ],
  points: [
    'The extruder is a small stepper with a toothed drive gear and an idler pinching the 1.75 mm filament. Each step pushes a fixed length in (E-steps, set in Calibration). The solid filament is the piston: whatever goes in at the top must come out of the nozzle as melt.',
    'Below the gears the filament must stay hard. A finned heatsink with its own fan keeps the cold zone near room temperature, and the heat break, a thin steel or titanium tube, conducts so little heat that the temperature jumps from about 50 °C to the block temperature over a few millimetres. If heat creeps up, the filament softens too early, swells and jams (heat creep).',
    'The heater block holds a 40 W cartridge heater and a thermistor; the firmware runs a PID loop on it (Temperature & cooling › Hotend PID tuning). The filament core heats slowly, because plastic conducts heat badly: it approaches the block temperature with a time constant of about a second, so it needs time in the melt zone.',
    'Flow: every second the printer lays line width × layer height × speed of plastic, and the extruder feeds that volume as filament area × feed rate. 0.45 × 0.2 × 60 = 5.4 mm³/s means 2.2 mm/s of filament. Faster printing pushes the filament through quicker, the core leaves the nozzle colder, and past the max flow it no longer melts fully: the gears grind or skip and the print is under-extruded.',
    'More flow needs a longer melt zone (Volcano), better heat transfer into the core (split-bore and ceramic-core hotends), or a hotter block, at the cost of stringing and degraded plastic. A typical V6 manages about 11 mm³/s with PLA, so a 0.2 mm layer tops out near 120 mm/s. Calibration › Flow rate and Print problems › Under-extrusion follow on.',
  ],
  controls: [
    { kind: 'choice', key: 'hotend', options: opts(namesOf(HOTENDS)), initial: 'v6' },
    { kind: 'slider', key: 'temp', label: 'Block temperature', min: 190, max: 260, step: 5, initial: 210, format: (v) => `${v} °C` },
    { kind: 'slider', key: 'speed', label: 'Print speed', min: 10, max: 200, step: 10, initial: 60, format: (v) => `${v} mm/s` },
    { kind: 'slider', key: 'layer', label: 'Layer height', min: 0.1, max: 0.32, step: 0.02, initial: 0.2, format: (v) => `${fixedText(v, 2)} mm` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const sections = Object.fromEntries((Object.keys(HOTENDS) as HotendKey[]).map((h) => [h, hotendSection(scene, HE.at, HE.k, h)])) as Record<HotendKey, ReturnType<typeof hotendSection>>
    const zoneTags = Array.from({ length: 6 }, () => liveLabel(scene, [0, 0, 0.6], { size: 0.27, align: 'left' }))
    const plate = add(scene, new THREE.Group())
    const bead = Array.from({ length: 14 }, () => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: FILAMENT_COLOR, roughness: 0.5 }))
      plate.add(m)
      return m
    })
    const plateBox = new THREE.Mesh(new THREE.BoxGeometry(10, 0.3, 3), shellMat('#3a3f48', 0.9, 0.5))
    plate.add(plateBox)

    const P = WIDE_RIGHT
    const tp = titledScope(scene, -2.6, 3.2, 'temperature along the path', HEAT, 0, P.x, P.w)
    const ty = plotY(0, HE.tMax, 3.2)
    const metal = tp.s.trace(GREY, { samples: 61, radius: 0.05 })
    const core = tp.s.trace(HEAT, { samples: 61, radius: 0.07 })
    tp.s.level(POWER, 0.4).set(ty(PLA_FLOW_C))
    const tipDot = glowDot(tp.s.group, 0.24, RING)
    tp.lo.set('gears')
    const fp = titledScope(scene, -9.1, 3.4, 'flow vs print speed', RING, 0, P.x, P.w)
    const fy = plotY(0, HE.qMax, 3.4)
    const qLine = fp.s.trace(RING, { samples: 2, radius: 0.06 })
    const maxLine = fp.s.level(HIGH_V)
    const qDot = glowDot(fp.s.group, 0.26, RING)
    const qCursor = cursorBar(fp.s, RING, 0.05)
    fp.lo.set('0')
    fp.hi.set(`${HE.vMax} mm/s`)
    addLabel(fp.s.group, `${HE.qMax} mm³/s`, [P.w / 2 - 0.2, 1.3, 0.4], GREY, 0.22, 'right')
    const rows = textRows(scene, 3, 2.4, 3.4, 0.3, 0.72)
    const st = { travel: 0, scroll: 0 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = heRun(p)
        const z = V.zones
        const sec = sections[q.hotend]
        for (const h of Object.keys(sections) as HotendKey[]) sections[h].group.visible = h === q.hotend
        st.travel += dt * V.feed * Math.min(1, V.delivered + 0.05) * 2
        const coreAt = (s: number) => (s < 0 ? 25 : V.core[Math.min(V.core.length - 1, Math.round((s / z.tip) * (V.core.length - 1)))])
        sec.set(st.travel, coreAt, q.blockC, -st.travel / 5.5)
        const x0 = HE.at[0] + 3.6
        const tags: [number, string, string][] = [
          [3, 'drive gear + idler', LABEL],
          [(z.cold[0] + z.cold[1]) / 2, 'cold zone: fins + fan', LOW_V],
          [(z.brk[0] + z.brk[1]) / 2, 'heat break', GREY],
          [z.hot[0] + 3, `heater block ${celsiusText(q.blockC)}`, HEAT],
          [z.hot[1] - 6, 'heater + thermistor', HEAT],
          [z.tip, `nozzle 0.4 mm: core ${celsiusText(V.exitC)}`, V.ok ? POWER : HIGH_V],
        ]
        tags.forEach(([s, t, c], i) => {
          zoneTags[i].group.position.set(x0 + (i === 4 ? 0.4 : 0), HE.at[1] + sec.y(s), 0.6)
          zoneTags[i].set(t, c)
        })
        const tipY = HE.at[1] + sec.tipY
        plate.position.set(HE.at[0] - 2.2, tipY - q.layerH * HE.k * 4 - 0.15, 0)
        plateBox.position.set(0, -0.15, 0)
        st.scroll = (st.scroll + dt * q.speed * 0.02) % 0.8
        bead.forEach((m, i) => {
          const x = 2.2 - i * 0.8 + st.scroll
          m.visible = x < 2.6 && x > -4.6
          const gap = (1 - V.delivered) * 0.75
          m.scale.set(Math.max(0.05, 0.8 - gap), q.layerH * HE.k * 4, 0.6)
          m.position.set(x, (q.layerH * HE.k * 4) / 2, 0)
        })

        const us = V.s.map((s) => s / z.tip)
        metal.points(us, V.metal.map(ty), null)
        core.points(us, V.core.map(ty), null)
        tipDot.position.set(tp.s.xAt(1), ty(V.exitC), 0.46)
        tp.hi.set(`tip ${z.tip} mm`)
        tp.right.set(`tip core ${celsiusText(V.exitC)}`, V.ok ? POWER : HIGH_V)
        qLine.points([0, 1], [fy(0), fy(LINE_W * q.layerH * HE.vMax)], null)
        maxLine.set(fy(Math.min(HE.qMax, V.maxQ)))
        const u = q.speed / HE.vMax
        qDot.position.set(fp.s.xAt(u), fy(Math.min(HE.qMax, V.Q)), 0.46)
        qCursor(u)
        fp.right.set(`${fixedText(V.Q, 1)} of ${fixedText(V.maxQ, 1)} mm³/s`, V.ok ? POWER : HIGH_V)

        rows[0].set(`feed ${mmFixed(V.feed, 2)}/s, gear ${fixedText(V.gearRpm, 0)} rpm, ${fixedText(V.dwell, 1)} s in the melt zone`, LABEL)
        rows[1].set(`max ${fixedText(V.maxQ, 1)} mm³/s = ${Math.round(V.maxSpeed)} mm/s at this layer height`, V.ok ? POWER : HIGH_V)
        rows[2].set(V.ok ? 'core melts through before the tip' : `under-extruding: about ${pct(V.delivered)} of the plastic comes out`, V.ok ? GREY : HIGH_V)
        head.status.set(`Hotend and extruder · ${HOTENDS[q.hotend].name}`)
        head.sub.set(`${celsiusText(q.blockC)} block · ${q.speed} mm/s · ${fixedText(q.layerH, 2)} mm layers · PLA, values typical`, GREY)
        head.event.set(
          V.ok ? (V.Q > 0.8 * V.maxQ ? 'near the limit: little margin for a cold draft or a wet spool' : 'melts fully: smooth, even lines') : 'TOO FAST: the core leaves the nozzle half-melted; the gears skip',
          V.ok ? (V.Q > 0.8 * V.maxQ ? HEAT : POWER) : HIGH_V,
        )
      },
      readouts: (p) => {
        const { V } = heRun(p)
        return [
          { label: 'Flow', value: `${fixedText(V.Q, 1)} mm³/s`, tone: toneOf(V.Q <= 0.8 * V.maxQ, V.ok) },
          { label: 'Max flow', value: `${fixedText(V.maxQ, 1)} mm³/s` },
          { label: 'Core at the tip', value: celsiusText(V.exitC), tone: toneOf(V.ok, V.exitC > PLA_FLOW_C - 15) },
        ]
      },
    }
  },
}

// --- Layer by layer: a part sliced and built up line by line; layer height trades time for stair-steps. ---

const LB = { k: 0.5, at: [-7, -8, 0] as V3, lapse: 30, speed: 60, beads: 400 }
const lbParams = (p: Params) => ({ shape: pick(PRINT_SHAPES, p.shape, 'dome') as PrintShape, layerH: n(p, 'layer'), infill: n(p, 'infill') / 100, speed: LB.speed })
const lbRun = memoBy((p: Params) => `${p.shape} ${p.layer} ${p.infill}`, (p: Params) => {
  const q = lbParams(p)
  return { q, V: sliceView(q) }
})

export const howFdmWorksLayerByLayer: Lesson = {
  id: 'how-fdm-works-layer-by-layer',
  title: 'Layer by layer',
  tagline: 'Walls, infill, next layer: thin layers look better and take longer',
  formula: (p) => {
    const { q, V } = lbRun(p)
    return `layers = height / layer height = ${PRINT_SHAPES[q.shape].h} / ${fixedText(q.layerH, 2)} = ${V.layers.length} · time ≈ Σ (walls + infill length) / speed + ${LAYER_OVERHEAD_S} s per layer = ${durationText(V.total)} at ${LB.speed} mm/s · steepest stair step on the top ${mmFixed(V.step, 2)} (typical)`
  },
  legend: [
    { color: FILAMENT_COLOR, label: 'Printed layers', shape: 'dot' },
    { color: RING, label: 'Layer being printed / chosen height', shape: 'dot' },
    { color: LOW_V, label: 'Ideal CAD shape', shape: 'dot' },
  ],
  points: [
    'The slicer cuts the model into flat slices one layer height apart and turns each slice into a toolpath: two or more walls (perimeters) traced around the outline, then infill inside. The printer finishes a layer, Z lifts by one layer height, and the next layer is pressed onto the still-warm one below. Slicing covers the settings in detail.',
    'Walls carry most of the load and give the surface; infill is a sparse lattice (here straight lines turning 90° each layer) that holds the walls apart and supports the solid top. 15–25 % infill is typical for robot brackets; the first and last 3 layers are solid. Strength › Wall count vs infill shows what each buys.',
    'Layer height is the main time knob: halve it and there are twice as many layers to draw, so the print takes about twice as long. 0.2 mm is the common default for a 0.4 mm nozzle; 0.1 mm for fine detail, up to about 0.3 mm (75 % of the nozzle) for fast drafts.',
    'Curved or sloped tops come out as stairs: each layer is a flat slice, so a dome steps in by a full ring each layer. Near the flat top of a dome the steps grow, since a small rise moves the edge a long way. Thinner layers shrink the steps; tall walls do not care. Orientation (Design for printing) often matters more than layer height.',
    'Layers are also the weak direction: each one bonds to the one below only by melting into it, so a part pulled across its layers fails first along a layer line. See Strength › Layer adhesion.',
  ],
  controls: [
    { kind: 'choice', key: 'shape', options: opts(namesOf(PRINT_SHAPES)), initial: 'dome' },
    { kind: 'slider', key: 'layer', label: 'Layer height', min: 0.08, max: 0.32, step: 0.02, initial: 0.2, format: (v) => `${fixedText(v, 2)} mm` },
    { kind: 'slider', key: 'infill', label: 'Infill', min: 0, max: 100, step: 5, initial: 20, format: (v) => `${v} %` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const { k } = LB
    const holder = add(scene, new THREE.Group(), LB.at)
    holder.rotation.set(0.42, -0.5, 0)
    add(holder, new THREE.Mesh(new THREE.BoxGeometry(30 * k, 1.2 * k, 30 * k), new THREE.MeshStandardMaterial({ color: '#3a3f48', metalness: 0.3, roughness: 0.4 }))).position.y = -0.6 * k
    const MAXL = 400
    const wallMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 })
    const walls = {
      round: new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true), wallMat, MAXL),
      square: new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 4, 1, true), wallMat, MAXL),
    }
    walls.square.rotation.y = Math.PI / 4
    for (const m of Object.values(walls)) {
      m.frustumCulled = false
      holder.add(m)
    }
    const beads = printBeads(holder, LB.beads, k)
    const ghosts = {
      box: add(holder, new THREE.Mesh(new THREE.BoxGeometry(20 * k, 20 * k, 20 * k), shellMat('#6f8cff', 0.12)), [0, 10 * k, 0]),
      cylinder: add(holder, new THREE.Mesh(new THREE.CylinderGeometry(10 * k, 10 * k, 20 * k, 48), shellMat('#6f8cff', 0.12)), [0, 10 * k, 0]),
      dome: add(holder, new THREE.Mesh(new THREE.SphereGeometry(12 * k, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), shellMat('#6f8cff', 0.14)), [0, 0, 0]),
    }
    const nozzle = add(holder, new THREE.Mesh(new THREE.ConeGeometry(1.6 * k, 3 * k, 6), new THREE.MeshStandardMaterial({ color: '#d9b24a', metalness: 0.45, roughness: 0.35 })))
    nozzle.rotation.x = Math.PI
    const P = WIDE_RIGHT
    const plot = titledScope(scene, -6.8, 5.4, 'print time vs layer height', RING, 0, P.x, P.w)
    const curve = plot.s.trace(RING, { samples: LAYER_SWEEP.length, radius: 0.07 })
    const marker = glowDot(plot.s.group, 0.28, RING)
    const cursor = cursorBar(plot.s, RING, 0.05)
    plot.lo.set(`${LAYER_SWEEP[0]} mm`)
    plot.hi.set(`${fixedText(LAYER_SWEEP[LAYER_SWEEP.length - 1], 2)} mm`)
    const tMaxTag = liveLabel(plot.s.group, [P.w / 2 - 0.2, 2.25, 0.4], { size: 0.22, color: GREY, align: 'right' })
    const rows = textRows(scene, 4, 2.4, 3.4, 0.3, 0.72)
    const c = new THREE.Color()
    const M = new THREE.Matrix4()
    const st = { t: 0, key: '' }
    let path: PathSeg[] = []
    let pathIdx = -1
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = lbRun(p)
        const key = `${q.shape} ${q.layerH} ${q.infill}`
        if (key !== st.key) {
          st.key = key
          st.t = 0
          pathIdx = -1
        }
        const S = PRINT_SHAPES[q.shape]
        const N = V.layers.length
        st.t = (st.t + dt / LB.lapse) % 1.15
        const prog = Math.min(1, st.t) * N
        const li = Math.min(N - 1, Math.floor(prog))
        const done = st.t >= 1
        const wm = S.round ? walls.round : walls.square
        walls.round.visible = S.round
        walls.square.visible = !S.round
        const shown = done ? N : li
        for (let i = 0; i < Math.min(shown, MAXL); i++) {
          const L = V.layers[i]
          const R = (S.round ? L.r : L.r * Math.SQRT2) * k
          M.makeScale(R, q.layerH * k * 0.9, R).setPosition(0, (L.z + q.layerH / 2) * k, 0)
          wm.setMatrixAt(i, M)
          wm.setColorAt(i, c.set(FILAMENT_COLOR).multiplyScalar(i % 2 ? 0.82 : 1))
        }
        wm.count = Math.min(shown, MAXL)
        wm.instanceMatrix.needsUpdate = true
        if (wm.instanceColor) wm.instanceColor.needsUpdate = true
        for (const g of Object.keys(ghosts) as PrintShape[]) ghosts[g].visible = g === q.shape

        const L = V.layers[li]
        if (pathIdx !== li) {
          pathIdx = li
          path = layerPath(q.shape, L, li, q.infill).slice(0, LB.beads)
          path.forEach((s, i) => beads.lay(i, s.a, s.b, L.z, LINE_W, q.layerH, RING))
        }
        const at = toolpathAt(path, (prog - li) * toolpathLength(path))
        beads.show(done ? 0 : at.done)
        nozzle.visible = !done
        nozzle.position.set(at.x * k, (L.z + q.layerH + 1.5) * k, -at.y * k)

        const us = LAYER_SWEEP.map((_, i) => i / (LAYER_SWEEP.length - 1))
        const tMax = V.sweep[0] * 1.05
        const py = plotY(0, tMax, 5.4)
        curve.points(us, V.sweep.map(py), null)
        const u = (q.layerH - LAYER_SWEEP[0]) / (LAYER_SWEEP[LAYER_SWEEP.length - 1] - LAYER_SWEEP[0])
        marker.position.set(plot.s.xAt(u), py(V.total), 0.46)
        cursor(u)
        plot.right.set(`${durationText(V.total)} at ${fixedText(q.layerH, 2)} mm`, RING)
        tMaxTag.set(durationText(tMax), GREY)

        rows[0].set(`${N} layers · walls ${2} lines · infill ${pct(q.infill)}, solid top and bottom`, LABEL)
        rows[1].set(`print time ${durationText(V.total)} · ${fixedText(V.filamentMm3 / 1000, 1)} cm³ of plastic`, RING)
        rows[2].set(q.shape === 'dome' ? `top stair steps up to ${mmFixed(V.step, 2)} wide` : `flat top: no stair steps`, q.shape === 'dome' && V.step > 1.2 ? HEAT : POWER)
        rows[3].set(Math.abs(V.heightErr) > 0.01 ? `height rounds to ${mmFixed(N * q.layerH, 2)}` : 'height is a whole number of layers', GREY)
        head.status.set(`Layer by layer · ${S.name} · ${fixedText(q.layerH, 2)} mm`)
        head.sub.set(`time-lapse: the whole print in ${LB.lapse} s, ${LB.speed} mm/s, typical`, GREY)
        head.event.set(done ? 'done: compare the steps with the blue CAD shape' : `layer ${li + 1} of ${N}: ${L.solid ? 'solid' : 'walls + infill'}`, done ? POWER : LABEL)
      },
      readouts: (p) => {
        const { V } = lbRun(p)
        return [
          { label: 'Layers', value: `${V.layers.length}` },
          { label: 'Print time', value: durationText(V.total) },
          { label: 'Top stair step', value: mmFixed(V.step, 2), tone: toneOf(V.step < 1, V.step < 1.6) },
        ]
      },
    }
  },
}

// --- Cartesian, CoreXY, delta: the same move on three machines. ---

const KINDS = Object.keys(PRINTER_KINDS) as PrinterKind[]
const kmParams = (p: Params) => ({ move: pick(PRINT_MOVES, p.move, 'x') as PrintMove, speed: n(p, 'speed') })
const kmRun = memoBy((p: Params) => `${p.move} ${p.speed}`, (p: Params) => {
  const q = kmParams(p)
  return { q, V: machineView(q.move, q.speed, 10) }
})
const KM_SLOTS: { x: number; y: number }[] = [{ x: -12, y: -3.2 }, { x: 0.3, y: -3.4 }, { x: 11.6, y: -8 }]

export const howFdmWorksCartesianCorexyDelta: Lesson = {
  id: 'how-fdm-works-cartesian-corexy-delta',
  title: 'Cartesian, CoreXY, delta',
  tagline: 'Three ways to move a nozzle, and which motors turn',
  formula: (p) => {
    const { q } = kmRun(p)
    const [x, y] = movePath(q.move, 0.25)
    const [a, b] = coreXY(x, y)
    const d = motorTargets('delta', x, y, 10)
    return `at (${fixedText(x, 0)}, ${fixedText(y, 0)}) mm: Cartesian X = ${fixedText(x, 0)}, Y = ${fixedText(y, 0)} · CoreXY A = X + Y = ${fixedText(a, 0)}, B = X − Y = ${fixedText(b, 0)} · delta carriage = z + √(L² − d²) = ${d.map((v) => fixedText(v, 0)).join(', ')} mm (L = 215 mm, d = distance to each tower)`
  },
  legend: [
    { color: RING, label: 'Motor turning for this move', shape: 'dot' },
    { color: '#2a5bd7', label: 'CoreXY belt A', shape: 'dot' },
    { color: '#2fa84f', label: 'CoreXY belt B', shape: 'dot' },
  ],
  points: [
    'Cartesian: one motor per axis. On a bed slinger the X motor moves the hotend, the Y motor slides the bed with the part on it, Z lifts the gantry. Simple to build and tune, but the heavy bed (over 1 kg with glass and part, typical) limits how hard Y can accelerate, and a tall print sways.',
    'CoreXY: both motors sit still on the frame and drive two long crossed belts; the carriage position is the sum and difference of the belt travels: A = X + Y, B = X − Y, so X = (A + B)/2, Y = (A − B)/2. A pure X or Y move turns both motors, a 45° diagonal only one. Light moving parts and a bed that only moves in Z make CoreXY the usual fast printer (Voron, Bambu).',
    'Delta: three carriages ride up and down three vertical towers; pairs of parallel arms of fixed length L hang the effector from them. Each carriage sits at z + √(L² − d²), d being the horizontal distance from the nozzle to that tower: inverse kinematics like a parallel robot (Kinematics › Inverse kinematics). Every move turns all three motors, the moving mass is tiny, but the print area is round and calibration is fussy.',
    'Moving mass sets the force the motors and belts must supply, F = m·a, and how much the frame rings after a corner. The same 3000 mm/s² takes about 4 N for a delta effector but 4 N × 5 for a bed slinger\'s bed, which is why fast printers use input shaping (Printer motion › Input shaping).',
    'The firmware hides all this: G-code says "go to X, Y, Z" and the kinematics module turns it into motor steps (Printer motion › Steps per mm, G-code › G0, G1 moves).',
  ],
  controls: [
    { kind: 'choice', key: 'move', options: opts(namesOf(PRINT_MOVES)), initial: 'x' },
    { kind: 'slider', key: 'speed', label: 'Nozzle speed', min: 20, max: 300, step: 10, initial: 80, format: (v) => `${v} mm/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const tilt = (s: { x: number; y: number }, rx: number) => {
      const g = add(scene, new THREE.Group(), [s.x, s.y, 0])
      g.rotation.set(rx, -0.35, 0)
      return g
    }
    const cart = fdmPrinter(tilt(KM_SLOTS[0], 0.3), [0, -5, 0], 0.019)
    for (const part of ['board', 'psu', 'spool'] as PrinterPart[]) cart.parts[part].visible = false
    const cxy = coreXYPrinter(tilt(KM_SLOTS[1], 0.75), [0, 0, 0], 0.035)
    const dlt = deltaPrinter(tilt(KM_SLOTS[2], 0.25), [0, 0, 0], 0.023)
    const names = KINDS.map((kd, i) => {
      addLabel(scene, PRINTER_KINDS[kd].name, [KM_SLOTS[i].x, -10.5, 0.3], LABEL, 0.32, 'center')
      return textRows(scene, 3, KM_SLOTS[i].x - 4, -11.2, 0.3, 0.6)
    })
    const st = { u: 0 }
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, V } = kmRun(p)
        st.u = (st.u + dt / V.period) % 1
        const [x, y] = movePath(q.move, st.u)
        const pulse = (on: boolean) => (on ? 0.8 : 0)
        V.kinds.forEach((K, i) => {
          if (K.kind === 'cartesian') {
            cart.set(x * 1.5, y * 1.5, 30, 0)
            cart.glow('x', pulse(K.moving[0]))
            cart.glow('y', pulse(K.moving[1]))
            cart.glow('z', 0)
          } else if (K.kind === 'corexy') {
            cxy.set(x * 1.8, y * 1.8)
            K.moving.slice(0, 2).forEach((m, j) => cxy.glowMotor(j, pulse(m)))
          } else {
            dlt.set(x * 1.6, y * 1.6, 10)
            K.moving.forEach((m, j) => dlt.glowMotor(j, pulse(m)))
          }
          const M = PRINTER_KINDS[K.kind].motors
          const turning = M.filter((_, j) => K.moving[j])
          names[i][0].set(`turning: ${turning.join(', ') || 'none'}`, RING)
          names[i][1].set(`peak ${Math.round(Math.max(...K.peak))} mm/s`, LABEL)
          names[i][2].set(`${fixedText(K.mass, 2)} kg → ${newtonsText(K.forceN, 1)}`, K.mass > 1 ? HEAT : POWER)
        })
        head.status.set(`Cartesian, CoreXY, delta · ${PRINT_MOVES[q.move].name.toLowerCase()} at ${q.speed} mm/s`)
        head.sub.set(`same ${MOVE_MM * 2} mm move on each (drawn larger); force at 3000 mm/s², masses typical`, GREY)
        head.event.set(
          q.move === 'diag' ? 'CoreXY diagonal: only motor A turns' : q.move === 'circle' ? 'a circle needs every XY motor, speeds changing all the time' : 'straight move: Cartesian uses one motor, CoreXY both, delta all three',
          LABEL,
        )
      },
      readouts: (p) => {
        const { V } = kmRun(p)
        return V.kinds.map((K) => ({ label: PRINTER_KINDS[K.kind].name.split(' ')[0], value: `${PRINTER_KINDS[K.kind].motors.filter((_, j) => K.moving[j]).join('+') || '–'} · ${fixedText(K.mass, 2)} kg`, tone: toneOf(K.mass < 0.5, K.mass < 1) }))
      },
    }
  },
}
