import { medianMs } from '../../stopwatch'
import { GCODE_HEAT, explainGcode, extrudeMm, gcodeAt, heatProgram, modesBefore, moveProgram, parseGcode, rowOf, runGcode, scriptProgram } from './gcode'

describe('G-code parsing', () => {
  it('splits a line into the command, words and comment', () => {
    const g = parseGcode('G1 X20.5 Y-3 E1.2 F1800 ; wall')
    expect(g.code).toBe('G1')
    expect(g.words.map((w) => `${w.letter}${w.value}`)).toEqual(['X20.5', 'Y-3', 'E1.2', 'F1800'])
    expect(g.comment).toBe('wall')
    expect(parseGcode('; just a note').code).toBeNull()
  })
  it('explains words in the modes in force; F is mm/min', () => {
    const g = parseGcode('G1 X20 E1.5 F1800')
    expect(explainGcode(g, true, false)).toEqual(['G1 = straight move, may extrude', 'X20 = go to X 20 mm', 'E1.5 = push 1.5 mm of filament', 'F1800 = 1800 mm/min = 30 mm/s'])
    expect(explainGcode(g, false, true)[1]).toBe('X20 = move X by 20 mm')
    expect(explainGcode(parseGcode('M106 S128'))[1]).toContain('50 %')
    const ls = ['G90', 'M83', 'G91', 'M82'].map(parseGcode)
    expect(modesBefore(ls, 2)).toEqual({ absXYZ: true, absE: false })
    expect(modesBefore(ls, 3)).toEqual({ absXYZ: false, absE: false })
    expect(modesBefore(ls, 4)).toEqual({ absXYZ: false, absE: true })
  })
})

describe('G0, G1 moves', () => {
  it('absolute and relative listings draw the same 80 mm square', () => {
    const a = runGcode(moveProgram('abs', 1800).src, { preheat: [210, 60] })
    const r = runGcode(moveProgram('rel', 1800).src, { preheat: [210, 60] })
    const ext = (run: typeof a) => run.moves.filter((m) => m.kind === 'extrude').map((m) => m.b.map((v) => Math.round(v * 10) / 10))
    expect(ext(a)).toEqual(ext(r))
    expect(ext(a)).toHaveLength(4)
    expect(a.laid).toBeCloseTo(4 * extrudeMm(80, 0.3), 1)
  })
  it('G91 with absolute numbers runs into the soft limits', () => {
    const m = runGcode(moveProgram('mixed', 1800).src, { preheat: [210, 60] })
    expect(m.moves.some((v) => v.clipped)).toBe(true)
    expect(m.events.some((e) => e.bad)).toBe(true)
  })
  it('F typed in mm/s crawls 60× slower', () => {
    const ok = runGcode(moveProgram('abs', 1800).src, { preheat: [210, 60] })
    const slow = runGcode(moveProgram('mms', 1800).src, { preheat: [210, 60] })
    const side = (run: typeof ok) => run.moves.filter((v) => v.kind === 'extrude')[0]
    const ratio = (side(slow).t1 - side(slow).t0) / (side(ok).t1 - side(ok).t0)
    expect(ratio).toBeGreaterThan(55)
    expect(ratio).toBeLessThan(65)
  })
  it('running-total E values in relative mode over-extrude 2.5×', () => {
    const ok = runGcode(moveProgram('abs', 1800).src, { preheat: [210, 60] })
    const blob = runGcode(moveProgram('absE', 1800).src, { preheat: [210, 60] })
    expect(blob.laid / ok.laid).toBeCloseTo(2.5, 1)
  })
})

describe('temperatures and fans', () => {
  it('M190/M109 block until hot; heating both at once is faster', () => {
    const s = runGcode(heatProgram('serial', 210, 100).src)
    const p = runGcode(heatProgram('parallel', 210, 100).src)
    expect(s.firstLay!.nozzle).toBeGreaterThan(210 - GCODE_HEAT.waitBand - 0.5)
    expect(p.firstLay!.t).toBeLessThan(s.firstLay!.t - 10)
    expect(s.firstLay!.t).toBeGreaterThan(60)
    expect(s.firstLay!.t).toBeLessThan(240)
  })
  it('without waits the nozzle is cold: extrusion is refused', () => {
    const r = runGcode(heatProgram('nowait', 210, 100).src)
    expect(r.moves.some((m) => m.cold)).toBe(true)
    expect(r.events.some((e) => e.text.startsWith('cold extrusion'))).toBe(true)
  })
  it('fan off on layer 1, set PWM from layer 2; fan on for layer 1 is flagged', () => {
    const r = runGcode(heatProgram('serial', 210, 50).src)
    const l1 = r.moves.find((m) => m.kind === 'extrude' && m.b[2] < 0.4)!
    const l2 = r.moves.find((m) => m.kind === 'extrude' && m.b[2] > 0.5)!
    expect(gcodeAt(r, (l1.t0 + l1.t1) / 2).fan).toBe(0)
    expect(gcodeAt(r, (l2.t0 + l2.t1) / 2).fan).toBeCloseTo(128 / 255, 3)
    expect(runGcode(heatProgram('fan1', 210, 50).src).events.some((e) => e.text.startsWith('fan on'))).toBe(true)
  })
})

describe('start and end scripts', () => {
  const run = (k: Parameters<typeof scriptProgram>[0]) => runGcode(scriptProgram(k).src, { at: [140, 90, 24], homed: false, tail: 60 })
  it('the full script homes, heats, purges, prints, lifts, parks and switches off', () => {
    const r = run('none')
    expect(r.events.filter((e) => e.bad)).toEqual([])
    expect(r.final.motors).toBe(false)
    expect(r.samples.at(-1)!.nozzle).toBeLessThan(200)
    expect(r.moves[0].kind).toBe('home')
  })
  it('each missing line shows its failure', () => {
    expect(run('G28').moves.some((m) => m.clipped)).toBe(true)
    expect(run('M109').moves.some((m) => m.cold)).toBe(true)
    const noPurge = run('purge').moves.filter((m) => m.e > 0)[0]
    expect(noPurge.laid).toBeLessThan(noPurge.e - 1)
    expect(run('lift').moves.some((m) => m.drag)).toBe(true)
    expect(run('heaters').samples.at(-1)!.nozzle).toBeGreaterThan(205)
    expect(run('M84').final.motors).toBe(true)
  })
  it('display rows fold the part into one row', () => {
    const p = scriptProgram('none')
    expect(p.rows.length).toBeLessThan(p.src.length)
    expect(rowOf(p, p.src.length - 1)).toBe(p.rows.length - 1)
  })
  it('runs fast enough for a slider', () => {
    expect(medianMs(() => run('none'))).toBeLessThan(60)
  })
})
