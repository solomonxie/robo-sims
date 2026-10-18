import * as THREE from 'three/webgpu'
import {
  GCODE_HEAT,
  GProgram,
  GRun,
  HEAT_BED_C,
  HEAT_PROGRAMS,
  HOMING,
  HeatProgram,
  LINE_W,
  MACHINE,
  MOVE_PROGRAMS,
  MoveProgram,
  SCRIPT_SKIPS,
  SQUARE,
  ScriptSkip,
  explainGcode,
  extrudeMm,
  gcodeAt,
  heatProgram,
  modesBefore,
  moveProgram,
  rowOf,
  runGcode,
  scriptProgram,
} from '../../core/physics'
import { celsiusText, fixedText, pct, secs } from '../../core/units'
import { V3, add } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  B_FIELD,
  FILAMENT_COLOR,
  GCODE_LEGEND,
  GCODE_TINT,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  WIDE_VIEW,
  addLabel,
  codeListing,
  cursorBar,
  fdmPrinter,
  gcodeTint,
  memoBy,
  plotY,
  printBeads,
  scope,
  statusHeader,
  textRows,
  titledScope,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick, toneOf } from '../types'

const CX = MACHINE.x / 2
const CY = MACHINE.y / 2
const LINK_TEMP = 'Temperature & cooling'
const BEAD_W = 4
const BEAD_H = 1.2

/** Printer on the left, listing on the right; `show(run, t)` moves the head, lays the beads so far, lights the current row. */
function gcodeStage(scene: THREE.Object3D, rows: number, o: { k: number; at: V3; size: number; gap: number; top: number; bar: number }) {
  const holder = add(scene, new THREE.Group(), o.at)
  holder.rotation.set(0.42, 0.5, 0)
  const pr = fdmPrinter(holder, [0, 0, 0], o.k)
  const beads = printBeads(pr.bed, 64, o.k)
  const list = codeListing(scene, [1.4, o.top, 0.3], rows, o.bar, o.size, o.gap)
  const st = { e: 0 }
  return {
    pr,
    list,
    show(run: GRun, prog: GProgram, t: number, dt: number, h = 0.3) {
      const s = gcodeAt(run, t)
      let i = 0
      for (let m = 0; m <= s.moveIndex && m < run.moves.length; m++) {
        const mv = run.moves[m]
        if (mv.kind !== 'extrude') continue
        const len = Math.hypot(mv.b[0] - mv.a[0], mv.b[1] - mv.a[1])
        const r = len > 0 ? mv.laid / extrudeMm(len, h) : 1
        const b = m === s.moveIndex ? s.pos : mv.b
        beads.lay(i++, [mv.a[0] - CX, mv.a[1] - CY], [b[0] - CX, b[1] - CY], mv.b[2] - h, BEAD_W * Math.min(3, r), BEAD_H * Math.min(1.8, Math.max(0.35, r)), r < 0.7 ? HIGH_V : FILAMENT_COLOR)
      }
      beads.show(i)
      if (s.move?.kind === 'extrude') st.e += dt * 3
      pr.set(s.pos[0] - CX, s.pos[1] - CY, s.pos[2], st.e)
      pr.heat((s.bed - GCODE_HEAT.ambient) / 50, (s.nozzle - GCODE_HEAT.ambient) / 200)
      pr.fan.rotation.z -= dt * 30 * s.fan
      list.set(
        prog.rows.map((r) => r.text),
        rowOf(prog, s.line),
        gcodeTint,
      )
      const ev = [...run.events].reverse().find((e) => e.t <= t + 1e-6 && e.t >= t - 3)
      return { s, ev }
    },
  }
}

/** Sim-time clock: `slow` × real time, `fast` × while `waiting`, holds `hold` s at the end, restarts on a new key. */
function scriptClock(hold: number) {
  const st = { key: '', t: 0, wall: 0 }
  return (dt: number, key: string, total: number, rate: number) => {
    if (key !== st.key) [st.key, st.t, st.wall] = [key, 0, 0]
    if (st.t >= total) st.wall += dt
    else st.t = Math.min(total, st.t + dt * rate)
    if (st.wall > hold) [st.t, st.wall] = [0, 0]
    return st.t
  }
}
const isWait = (run: GRun, line: number) => /^M1[09]9$|^M190$/.test(run.lines[line]?.code ?? '')

// --- G0, G1 moves: an 80 mm square in G-code, line by line; absolute vs relative, F in mm/min, E relative. ---

const MV = { k: 0.032, at: [-10.4, -14.6, 0] as V3, pause: 0.7, top: { x: 12.1, y: 0.6, s: 4.8 } }
const mvParams = (p: Params) => ({ kind: pick(MOVE_PROGRAMS, p.prog, 'abs') as MoveProgram, f: n(p, 'feed') })
const mvRun = memoBy((p: Params) => `${p.prog} ${p.feed}`, (p: Params) => {
  const q = mvParams(p)
  const prog = moveProgram(q.kind, q.f)
  const run = runGcode(prog.src, { at: SQUARE.start, preheat: [210, 60], linePause: MV.pause })
  const mmS = (q.kind === 'mms' ? Math.round(q.f / 60) : q.f) / 60
  return { q, prog, run, mmS, nominal: 4 * extrudeMm(SQUARE.x1 - SQUARE.x0, SQUARE.h) }
})

export const gCodeG0G1Moves: Lesson = {
  id: 'g-code-g0-g1-moves',
  title: 'G0, G1 moves',
  tagline: 'Go there, in a straight line, pushing this much plastic',
  formula: (p) => {
    const { q, mmS, run, nominal } = mvRun(p)
    return `E per line = length × width × height / filament area = 80 × ${LINE_W} × ${SQUARE.h} / 2.405 = ${fixedText(extrudeMm(80, SQUARE.h), 2)} mm · speed = F / 60 = ${q.kind === 'mms' ? Math.round(q.f / 60) : q.f} / 60 = ${fixedText(mmS, 1)} mm/s · filament pushed ${fixedText(run.laid, 1)} mm (needs ${fixedText(nominal, 1)})`
  },
  legend: [...GCODE_LEGEND.slice(0, 1), { color: GCODE_TINT.mode, label: 'G90/G91, M82/M83 modes', shape: 'dot' }, { color: FILAMENT_COLOR, label: 'Bead, drawn 9× wide (red: starved)', shape: 'dot' }],
  points: [
    'A slicer turns the part into G-code: plain text, one command per line, which the printer firmware (Marlin, Klipper, RepRapFirmware) reads top to bottom. A line is a command letter and number (G1) followed by words: an axis letter and a value each. Anything after ";" is a comment.',
    'G0 is a travel move and G1 a straight move that may extrude; Marlin actually treats them the same, the slicer just uses G0 for moves without E. X, Y, Z are where to go, E is how much filament to push on the way, and F is the feedrate in mm per minute: F1800 is only 30 mm/s. F is modal: it stays until the next F.',
    'G90 makes X, Y, Z absolute (go to X150), G91 relative (move by +80). Extrusion has its own mode: M83 makes E relative (push 4.49 mm on this line), M82 absolute (the E counter reaches 4.49). In Marlin G90/G91 switch E too, which is why slicers write M83 after G90. Homing, steps/mm and soft limits are in Printer motion.',
    'Classic mistakes: F typed in mm/s (F30 crawls at 0.5 mm/s), relative numbers in absolute mode or the reverse (the head runs to the bed edge), and running-total E values in M83 mode: each line pushes the whole total again and the square turns into a blob. The slicer\'s G-code flavour setting has to match the firmware (Slicing).',
  ],
  controls: [
    { kind: 'choice', key: 'prog', options: opts(MOVE_PROGRAMS), initial: 'abs' },
    { kind: 'slider', key: 'feed', label: 'G1 feedrate F', min: 600, max: 6000, step: 300, initial: 1800, format: (v) => `F${v} = ${v / 60} mm/s` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = gcodeStage(scene, 8, { k: MV.k, at: MV.at, size: 0.36, gap: 0.82, top: 3.6, bar: 8 })
    addLabel(scene, 'what the current line says', [1.4, -3.6, 0.2], LABEL, 0.3, 'left')
    const means = textRows(scene, 5, 1.4, -4.5, 0.32, 0.72)
    const modes = textRows(scene, 2, 1.4, -8.6, 0.3, 0.68)
    const T = MV.top
    const top = scope(scene, T.s, T.s, { divs: [4, 4] })
    top.group.position.set(T.x, T.y, 0)
    addLabel(scene, 'top view, bed 0–220 mm', [T.x - T.s / 2, T.y + T.s / 2 + 0.9, 0.3], LABEL, 0.26, 'left')
    const path = top.trace(GREY, { samples: 24, radius: 0.03 })
    const laid = top.trace(FILAMENT_COLOR, { samples: 24, radius: 0.08 })
    const tx = (x: number) => x / MACHINE.x
    const ty = (y: number) => (y / MACHINE.y - 0.5) * T.s
    const clock = scriptClock(2.5)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, prog, run, mmS } = mvRun(p)
        const rate = Math.max(1, run.total / 24)
        const t = clock(dt, `${p.prog} ${p.feed}`, run.total, rate)
        const { s, ev } = g.show(run, prog, t, dt)
        const done = run.moves.slice(0, s.moveIndex + 1)
        const pts = [...done.map((m) => m.a), s.pos]
        path.points(pts.map((v) => tx(v[0])), pts.map((v) => ty(v[1])))
        const ext = done.filter((m) => m.kind === 'extrude')
        const ep = ext.length ? [ext[0].a, ...ext.map((m, i) => (i === ext.length - 1 && m === done.at(-1) ? s.pos : m.b))] : []
        laid.points(ep.map((v) => tx(v[0])), ep.map((v) => ty(v[1])), ep.length ? ep.length - 1 : null)
        const md = modesBefore(run.lines, s.line)
        const ex = explainGcode(run.lines[s.line], md.absXYZ, md.absE)
        means.forEach((r, i) => r.set(ex[i] ?? '', i === 0 ? gcodeTint(run.lines[s.line].raw) : LABEL))
        modes[0].set(`modes: ${md.absXYZ ? 'G90 absolute' : 'G91 relative'} XYZ · ${md.absE ? 'absolute' : 'relative'} E`, GCODE_TINT.mode)
        modes[1].set(`head at X${fixedText(s.pos[0], 1)} Y${fixedText(s.pos[1], 1)} Z${fixedText(s.pos[2], 1)} · F${run.lines.slice(0, s.line + 1).reduce((f, l) => l.words.find((w) => w.letter === 'F')?.value ?? f, GCODE_HEAT.startF)}`, GREY)
        head.status.set(`G0, G1 moves · ${MOVE_PROGRAMS[q.kind]}`)
        head.sub.set(`t = ${secs(t)} of ${secs(run.total)}${rate > 1.05 ? `, ${Math.round(rate)}× fast` : ', real time'} · square side at ${fixedText(mmS, 1)} mm/s`, GREY)
        const blob = run.laid > 1.5 * mvRun(p).nominal
        head.event.set(
          ev ? ev.text : t >= run.total ? (blob ? `done: ${fixedText(run.laid, 1)} mm pushed, a blob` : q.kind === 'mms' ? 'done, at a crawl: F is mm per minute' : 'done: 80 mm square, one 0.3 mm layer') : `line ${s.line + 1}: ${run.lines[s.line].raw.split(';')[0].trim()}`,
          ev?.bad || (t >= run.total && (blob || q.kind === 'mms')) ? HIGH_V : t >= run.total ? POWER : RING,
        )
      },
      readouts: (p) => {
        const { q, run, mmS, nominal } = mvRun(p)
        const r = run.laid / nominal
        return [
          { label: 'Side speed', value: `${fixedText(mmS, 1)} mm/s`, tone: toneOf(mmS >= 15, mmS >= 5) },
          { label: 'Filament pushed', value: `${fixedText(run.laid, 1)} mm (${pct(r)})`, tone: toneOf(Math.abs(r - 1) < 0.05, Math.abs(r - 1) < 0.3) },
          { label: 'Square time', value: secs(run.moves.filter((m) => m.e > 0).reduce((s, m) => s + m.t1 - m.t0, 0)), tone: q.kind === 'mixed' ? 'bad' : undefined },
        ]
      },
    }
  },
}

// --- Temperatures and fans: M140/M190 bed, M104/M109 nozzle, waits block the moves; fan off for layer 1, M106 S0–255 after. ---

const TF = { k: 0.032, at: [-10.4, -14.6, 0] as V3, pause: 0.6, plot: { x: 8.2, w: 14, y: -9.7, h: 6.4 } }
const tfParams = (p: Params) => ({ kind: pick(HEAT_PROGRAMS, p.prog, 'serial') as HeatProgram, noz: n(p, 'noz'), fan: n(p, 'fan') })
const tfRun = memoBy((p: Params) => `${p.prog} ${p.noz} ${p.fan}`, (p: Params) => {
  const q = tfParams(p)
  const prog = heatProgram(q.kind, q.noz, q.fan)
  const run = runGcode(prog.src, { at: SQUARE.start, linePause: TF.pause, tail: 4 })
  return { q, prog, run }
})
const T_MAX = 260

export const gCodeTemperaturesAndFans: Lesson = {
  id: 'g-code-temperatures-and-fans',
  title: 'Temperatures and fans',
  tagline: 'Set, or set and wait; fan off for the first layer',
  formula: (p) => {
    const { q, run } = tfRun(p)
    const S = Math.round((q.fan / 100) * 255)
    return `M106 S = fan % × 255 = ${q.fan} % × 255 = S${S} · first bead at t = ${run.firstLay ? secs(run.firstLay.t) : 'never'} (${run.firstLay ? celsiusText(run.firstLay.nozzle) : 'cold'}) · heater models typical: 40 W hotend, 220 mm 24 V bed`
  },
  legend: [
    { color: HEAT, label: 'Nozzle temperature', shape: 'dot' },
    { color: RING, label: 'Bed temperature', shape: 'dot' },
    { color: B_FIELD, label: 'Part fan, 0–100 %', shape: 'dot' },
  ],
  points: [
    'Heaters take one line to set and minutes to reach. M104 S210 sets the nozzle target and carries on at once; M109 S210 sets it and blocks: no later line runs until the nozzle is there. The bed pair is M140 (set) and M190 (set and wait). S0 switches a heater off.',
    'Order matters. Bed then nozzle (M190 before M104) keeps the hot nozzle from oozing while the slow bed heats; setting both first and then waiting heats them together and starts sooner. Many slicers warm the nozzle to about 150 °C during the bed wait as a middle way.',
    'Without a wait the moves start at once with a cold nozzle. Marlin refuses to extrude below 170 °C ("cold extrusion prevented"), so the head draws a print without plastic; with the check off the extruder grinds the filament instead. Thermal runaway protection and PID tuning are in ' + LINK_TEMP + '.',
    'The part fan is a PWM output: M106 S0–255 (S128 ≈ 50 %), M107 is off. Slicers keep it off for the first layer or two so the bead stays hot enough to grip the bed (Bed adhesion), then run it near 100 % for PLA and lower for PETG or ABS, which warp and split when cooled hard.',
  ],
  controls: [
    { kind: 'choice', key: 'prog', options: opts(HEAT_PROGRAMS), initial: 'serial' },
    { kind: 'slider', key: 'noz', label: 'Nozzle target', min: 180, max: 250, step: 5, initial: 210, format: (v) => `${v} °C` },
    { kind: 'slider', key: 'fan', label: 'Fan from layer 2', min: 0, max: 100, step: 5, initial: 100, format: (v) => `${v} % = S${Math.round((v / 100) * 255)}` },
  ],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = gcodeStage(scene, 12, { k: TF.k, at: TF.at, size: 0.31, gap: 0.64, top: 3.8, bar: 12.4 })
    const P = TF.plot
    const plot = titledScope(scene, P.y, P.h, '°C and fan over time', LABEL, 0, P.x, P.w)
    const tr = { noz: plot.s.trace(HEAT, { samples: 200, radius: 0.07 }), bed: plot.s.trace(RING, { samples: 200, radius: 0.07 }), fan: plot.s.trace(B_FIELD, { samples: 200, radius: 0.05 }) }
    const lv = { noz: plot.s.level(HEAT), bed: plot.s.level(RING), cold: plot.s.level(HIGH_V, 0.25) }
    const cursor = cursorBar(plot.s, LABEL, 0.05)
    addLabel(scene, `${T_MAX} °C`, [P.x - P.w / 2 + 0.2, P.y + P.h / 2 - 0.45, 0.4], GREY, 0.24, 'left')
    const clock = scriptClock(3)
    const py = plotY(0, T_MAX, P.h)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const { q, prog, run } = tfRun(p)
        const key = `${p.prog} ${p.noz} ${p.fan}`
        const t0 = clock(0, key, run.total, 1)
        const waiting = isWait(run, gcodeAt(run, t0).line) && t0 < run.total
        const t = clock(dt, key, run.total, waiting ? 24 : 1.5)
        const { s, ev } = g.show(run, prog, t, dt)
        const N = 200
        const k = Math.max(2, Math.round((t / run.total) * (N - 1)) + 1)
        const us = Array.from({ length: k }, (_, i) => i / (N - 1))
        const at = (u: number) => run.samples[Math.min(run.samples.length - 1, Math.round((u * run.total) / run.dt))]
        tr.noz.points(us, us.map((u) => py(at(u).nozzle)))
        tr.bed.points(us, us.map((u) => py(at(u).bed)))
        tr.fan.points(us, us.map((u) => py(at(u).fan * T_MAX * 0.96)))
        lv.noz.set(py(q.noz))
        lv.bed.set(py(HEAT_BED_C))
        lv.cold.set(py(GCODE_HEAT.coldMin))
        cursor(t / run.total)
        plot.lo.set('0 s')
        plot.hi.set(secs(run.total))
        plot.right.set(`${Math.round(s.nozzle)} / ${celsiusText(s.bed)} · fan ${pct(s.fan)}`, LABEL)
        head.status.set(`Temperatures and fans · ${HEAT_PROGRAMS[q.kind]}`)
        head.sub.set(`t = ${secs(t)} of ${secs(run.total)}, ${waiting ? '24× fast while waiting' : '1.5× while moving'} · dashed: targets, red: 170 °C`, GREY)
        const code = run.lines[s.line].code
        head.event.set(
          ev ? ev.text : waiting ? `${code}: waiting, no line runs until ${code === 'M190' ? 'the bed' : 'the nozzle'} is hot` : t >= run.total ? (run.firstLay ? `done: first bead at ${secs(run.firstLay.t)}` : 'done: nothing extruded, the nozzle was cold') : `line ${s.line + 1}: ${run.lines[s.line].raw.split(';')[0].trim()}`,
          ev?.bad || (t >= run.total && !run.firstLay) ? HIGH_V : waiting ? HEAT : t >= run.total ? POWER : RING,
        )
      },
      readouts: (p) => {
        const { q, run } = tfRun(p)
        const f = run.firstLay
        return [
          { label: 'First bead at', value: f ? secs(f.t) : 'never', tone: f ? toneOf(f.t < 90, f.t < 150) : 'bad' },
          { label: 'Nozzle then', value: f ? celsiusText(f.nozzle) : 'too cold', tone: f ? 'ok' : 'bad' },
          { label: 'Layer 2 fan', value: `S${Math.round((q.fan / 100) * 255)}`, tone: q.kind === 'fan1' ? 'bad' : undefined },
        ]
      },
    }
  },
}

// --- Start and end scripts: home, heat, purge, print, retract, lift, park, heaters and motors off; drop one line to see why it is there. ---

const SE = { k: 0.032, at: [-10.4, -14.6, 0] as V3, pause: 0.5 }
const seRun = memoBy((p: Params) => `${p.skip}`, (p: Params) => {
  const skip = pick(SCRIPT_SKIPS, p.skip, 'none') as ScriptSkip
  const prog = scriptProgram(skip)
  const run = runGcode(prog.src, { at: [HOMING.start.x, HOMING.start.y, HOMING.start.z], homed: false, linePause: SE.pause, tail: 40 })
  const end = run.samples[run.samples.length - 1]
  return { skip, prog, run, end }
})
const SE_CHECKS = (r: ReturnType<typeof seRun>) => [
  { ok: r.skip !== 'G28', text: 'homed before moving (G28)' },
  { ok: !r.run.moves.some((m) => m.cold), text: 'hot before extruding (M109)' },
  { ok: r.skip !== 'purge', text: 'nozzle primed (purge line)' },
  { ok: !r.run.moves.some((m) => m.drag), text: 'lifted clear before parking' },
  { ok: r.run.final.nozzleSet === 0 && r.run.final.bedSet === 0, text: 'heaters off at the end' },
  { ok: !r.run.final.motors, text: 'motors released (M84)' },
]

export const gCodeStartAndEndScripts: Lesson = {
  id: 'g-code-start-and-end-scripts',
  title: 'Start and end scripts',
  tagline: 'The lines around every print, and why each one is there',
  formula: (p) => {
    const { run, end } = seRun(p)
    return `start: G28 → heat bed (M190) → heat nozzle (M109) → purge → print · end: retract → lift → park → heaters off → M84 · this run: ${secs(run.total)}, ${fixedText(run.laid, 1)} mm filament laid, 40 s after the end: nozzle ${celsiusText(end.nozzle)}, bed ${celsiusText(end.bed)} (typical heater models)`
  },
  legend: (p) => {
    const fail = SE_CHECKS(seRun(p)).some((c) => !c.ok)
    return [...GCODE_LEGEND, { color: fail ? HIGH_V : POWER, label: fail ? 'A missing line: see the checks' : 'Every check passes', shape: 'dot' }]
  },
  points: [
    'The slicer wraps every print in a start and an end script (the printer profile\'s custom G-code). They are where most first-print failures hide, because each line guards against one specific problem. Pick a line to drop and watch what goes wrong.',
    'Start: G28 homes so the firmware knows where the nozzle is (Printer motion); without it the firmware assumes it powered on at 0, 0, 0 and every move lands offset. Then heat: bed first with M190, nozzle with M109, so nothing extrudes cold (Temperatures and fans). The purge line refills the nozzle, which oozed while heating, so the part starts with plastic flowing. The first layer height and Z offset are Bed adhesion.',
    'End: retract a little so the nozzle stops oozing, lift Z well clear, then park (bed forward for the slinger). Lift before the travel, or the nozzle drags across the top of the part and scars it. Then M104 S0 and M140 S0: a heater left on is the usual source of unattended fires, with thermal runaway protection the last guard (' + LINK_TEMP + ').',
    'M84 releases the steppers so they stop drawing current and humming, and the axes can be moved by hand; the firmware then forgets the position, so the next print homes again. Klipper and RepRapFirmware use macros (PRINT_START/PRINT_END) for the same steps.',
  ],
  controls: [{ kind: 'choice', key: 'skip', options: opts(SCRIPT_SKIPS), initial: 'none' }],
  build(): Stage {
    const scene = createStage({ span: 40 })
    const head = statusHeader(scene)
    const g = gcodeStage(scene, 17, { k: SE.k, at: SE.at, size: 0.3, gap: 0.62, top: 4.0, bar: 11.6 })
    const checks = textRows(scene, 6, 1.4, -7.3, 0.32, 0.7)
    const clock = scriptClock(3)
    return {
      scene,
      view: WIDE_VIEW,
      frame(dt, p) {
        const r = seRun(p)
        const { run, prog } = r
        const now = gcodeAt(run, clock(0, r.skip, run.total, 1))
        const fast = (isWait(run, now.line) || now.line >= run.lines.length - 1) && !now.move
        const t = clock(dt, r.skip, run.total, fast ? 20 : 2.5)
        const { s, ev } = g.show(run, prog, t, dt)
        const done = t >= run.total
        SE_CHECKS(r).forEach((c, i) => checks[i].set(`${c.ok ? '✓' : '✗'} ${c.text}`, done || c.ok ? (c.ok ? POWER : HIGH_V) : GREY))
        head.status.set(`Start and end scripts · ${SCRIPT_SKIPS[r.skip]}`)
        head.sub.set(`t = ${secs(t)} of ${secs(run.total)}, ${fast ? '20×' : '2.5×'} · nozzle ${celsiusText(s.nozzle)} · bed ${celsiusText(s.bed)} · motors ${s.line >= 0 && run.lines.slice(0, s.line + 1).some((l) => l.code === 'M84') ? 'off' : 'on'}`, GREY)
        head.event.set(
          ev ? ev.text : done ? (SE_CHECKS(r).some((c) => !c.ok) ? 'done, but a check failed: see the list' : 'done: parked, cooling, motors off') : `line ${s.line + 1}: ${run.lines[s.line].raw}`,
          ev?.bad || (done && SE_CHECKS(r).some((c) => !c.ok)) ? HIGH_V : done ? POWER : RING,
        )
      },
      readouts: (p) => {
        const r = seRun(p)
        const fails = SE_CHECKS(r).filter((c) => !c.ok).length
        return [
          { label: 'Checks', value: `${6 - fails} of 6`, tone: fails ? 'bad' : 'ok' },
          { label: 'Laid', value: `${fixedText(r.run.laid, 1)} mm filament`, tone: toneOf(r.run.laid > 40, r.run.laid > 20) },
          { label: '40 s after', value: `${celsiusText(r.end.nozzle)} / ${celsiusText(r.end.bed)}`, tone: r.run.final.nozzleSet === 0 ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

