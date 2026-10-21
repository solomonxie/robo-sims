import { LED_MAX_A } from '../semiconductors'
import { BOARD_CLIP } from './breadboard'
import { MISTAKES, MistakesCfg, TIDY, TidyCfg, chipHoles, mistakesRun, railsRowsRun, tidyRun } from './breadboarding'

describe('railsRowsRun', () => {
  it('lights the LED only with the jumper in column 40 on the top side and the rail break bridged', () => {
    const good = railsRowsRun({ col: 40, half: 'top', bridge: true })
    expect(good.verdict.pass).toBe(true)
    expect(good.ledA).toBeGreaterThan(0.005)
    expect(good.ledA).toBeLessThan(0.02)
  })
  it('names the first thing wrong: column, channel, then the rail break', () => {
    expect(railsRowsRun({ col: 20, half: 'top', bridge: false }).verdict.fail).toBe('strip')
    expect(railsRowsRun({ col: 39, half: 'top', bridge: true }).verdict).toMatchObject({ fail: 'strip', near: true })
    expect(railsRowsRun({ col: 40, half: 'bottom', bridge: true }).verdict.fail).toBe('channel')
    const open = railsRowsRun({ col: 40, half: 'top', bridge: false })
    expect(open.verdict.fail).toBe('break')
    expect(open.ledA).toBeLessThan(1e-4)
  })
  it('into the LED’s strip bypasses the resistor; into the ground strip shorts the supply', () => {
    const bypass = railsRowsRun({ col: 44, half: 'top', bridge: true })
    expect(bypass.verdict.fail).toBe('over')
    expect(bypass.ledA).toBeGreaterThan(LED_MAX_A * 10)
    const short = railsRowsRun({ col: 45, half: 'top', bridge: true })
    expect(short.verdict.fail).toBe('short')
    expect(short.supplyA).toBeGreaterThan(BOARD_CLIP.ratedA)
  })
})

describe('tidyRun', () => {
  const base: TidyCfg = { lenCm: 20, wire: 'dupont26', load: 'tt', worn: false, route: 'tidy' }
  it('passes a short tidy run to a TT motor on new clips', () => {
    const r = tidyRun(base)
    expect(r.verdict.pass).toBe(true)
    expect(r.dropFrac).toBeLessThan(TIDY.dropOk)
  })
  it('worn clips, not the copper, are what heats and drops: 8 clips at 0.5 Ω', () => {
    const r = tidyRun({ ...base, worn: true })
    expect(r.verdict.fail).toBe('hot')
    expect(r.pathOhms).toBeGreaterThan(8 * r.clipOhms)
    expect(r.jumperOhms).toBeLessThan(r.clipOhms)
  })
  it('a 0.9 A servo on long thin jumpers sags; short solid wire fixes it', () => {
    expect(tidyRun({ ...base, load: 'servo', wire: 'dupont28', lenCm: 40 }).verdict.fail).toBe('drop')
    expect(tidyRun({ ...base, load: 'servo', wire: 'solid22', lenCm: 10 }).verdict.pass).toBe(true)
  })
  it('tall loops crossing the motor leads pick up spikes ∝ length; tidy routing ~100× less', () => {
    const messy = tidyRun({ ...base, route: 'messy', lenCm: 30 })
    expect(messy.verdict.fail).toBe('noise')
    expect(tidyRun({ ...base, route: 'messy', lenCm: 15 }).spikeV).toBeCloseTo(messy.spikeV / 2, 9)
    expect(messy.spikeV / tidyRun({ ...base, lenCm: 30 }).spikeV).toBeGreaterThan(50)
    expect(tidyRun({ ...base, route: 'messy', lenCm: 5 }).verdict).toMatchObject({ fail: 'colour', near: true })
  })
  it('a stalled TT motor starts at under the 1 A clip rating', () => {
    expect(tidyRun(base).startA).toBeLessThan(BOARD_CLIP.ratedA)
  })
})

describe('mistakesRun', () => {
  const ok: MistakesCfg = { straddle: true, linked: true, feedOk: true, ledOk: true, bridge: true }
  it('places the DIP pins 1–4 low, 8–5 high', () => {
    expect(chipHoles(true)).toEqual(['f10', 'f11', 'f12', 'f13', 'e13', 'e12', 'e11', 'e10'])
    expect(chipHoles(false)[0]).toBe('j10')
  })
  it('passes when everything is placed right', () => {
    const r = mistakesRun(ok)
    expect(r.verdict.pass).toBe(true)
    expect(r.chipV).toBeGreaterThan(MISTAKES.chipMinV)
  })
  it('each mistake fails its own check', () => {
    const fail = (c: Partial<MistakesCfg>) => mistakesRun({ ...ok, ...c }).verdict.fail
    expect(fail({ straddle: false })).toBe('short')
    expect(fail({ linked: false })).toBe('chip')
    expect(fail({ bridge: false })).toBe('rail')
    expect(fail({ feedOk: false })).toBe('over')
    expect(fail({ ledOk: false })).toBe('dark')
  })
  it('a DIP across one side’s strips shorts + to − through pins 1 and 8: the rail collapses, clips overheat', () => {
    const r = mistakesRun({ ...ok, straddle: false })
    expect(r.supplyA).toBeGreaterThan(2)
    expect(r.railV).toBeLessThan(1)
    expect(r.clip.melts).toBe(true)
  })
})
