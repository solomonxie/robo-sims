import { medianMs } from '../../stopwatch'
import { HOTEND_FAULTS, HotendFault, MARLIN_WATCH, bedRun, coolRun, holdStats, hotendRun, hotendTune, minLayerS } from './heaters'

const tune = hotendTune(210)!

describe('Hotend PID tuning', () => {
  it('M303 relay finds Ku, Tu and classic ZN gains near typical Marlin values', () => {
    expect(tune.tu).toBeGreaterThan(10)
    expect(tune.tu).toBeLessThan(30)
    expect(tune.gains.kp).toBeGreaterThan(10)
    expect(tune.gains.kp).toBeLessThan(40)
    expect(tune.gains.ki).toBeCloseTo((2 * tune.gains.kp) / tune.tu, 6)
    expect(tune.gains.kd).toBeCloseTo((tune.gains.kp * tune.tu) / 8, 6)
  })
  it('bang-bang swings degrees around 210 °C; PID holds it and recovers from the fan', () => {
    const bang = holdStats(hotendRun({ kind: 'bang', band: 4 }, 210, 300), 120, 180)
    const pidRun = hotendRun({ kind: 'pid', gains: tune.gains }, 210, 300, { fanAt: 180, fan: 1 })
    const pid = holdStats(pidRun, 120, 180)
    expect(bang.swing).toBeGreaterThan(8)
    expect(pid.swing).toBeLessThan(0.5)
    const dip = holdStats(pidRun, 180)
    expect(dip.min).toBeLessThan(209)
    expect(dip.min).toBeGreaterThan(200)
    expect(Math.abs(holdStats(pidRun, 270).mean - 210)).toBeLessThan(0.5)
  })
  it('recomputes well under 100 ms', () => {
    expect(medianMs(() => hotendRun({ kind: 'relay' }, 210, 300, { fanAt: 220, fan: 1 }))).toBeLessThan(100)
  })
})

describe('Heated bed', () => {
  const cfg = { sizeMm: 220, heater: 'dc24' as const, insul: 'none' as const }
  it('takes minutes, faster with more W/cm², slower and more amps on 12 V', () => {
    const b24 = bedRun(cfg, 'bang', 60)
    const b12 = bedRun({ ...cfg, heater: 'dc12' }, 'bang', 60)
    const ac = bedRun({ ...cfg, heater: 'ac' }, 'bang', 60)
    expect(b24.reach!).toBeGreaterThan(60)
    expect(b12.reach!).toBeGreaterThan(b24.reach!)
    expect(ac.reach!).toBeLessThan(b24.reach!)
    expect(ac.amps).toBeLessThan(2)
    expect(b12.amps).toBeGreaterThan(7)
  })
  it('edges run cooler; insulation reaches 100 °C sooner; bang-bang ripple stays a few degrees', () => {
    const bare = bedRun({ ...cfg, sizeMm: 300 }, 'bang', 100)
    const foam = bedRun({ ...cfg, sizeMm: 300, insul: 'foam' }, 'bang', 100)
    expect(bare.edgeDrop).toBeGreaterThan(2)
    expect(foam.reach!).toBeLessThan(bare.reach!)
    expect(holdStats(bedRun(cfg, 'bang', 60).run, 500).swing).toBeLessThan(8)
    expect(holdStats(bedRun(cfg, 'pid', 60).run, 500).swing).toBeLessThan(0.5)
  })
  it('a 12 V bed cannot reach 110 °C', () => {
    expect(bedRun({ ...cfg, heater: 'dc12' }, 'bang', 110).reach).toBeNull()
  })
  it('recomputes well under 100 ms', () => {
    expect(medianMs((i) => bedRun({ ...cfg, sizeMm: 200 + i * 20 }, 'bang', 80))).toBeLessThan(100)
  })
})

describe('Part cooling fan', () => {
  it('short layers stay soft without fan; the fan brings PLA under Tg', () => {
    expect(coolRun('pla', 0, 6).soft).toBe(true)
    expect(coolRun('pla', 1, 10).soft).toBe(false)
    expect(minLayerS('pla', 1)).toBeLessThan(minLayerS('pla', 0.3))
  })
  it('full fan freezes in far more shrink on ASA than on PLA', () => {
    expect(coolRun('asa', 1, 15).shrink).toBeGreaterThan(2 * coolRun('pla', 1, 15).shrink)
  })
  it('recomputes well under 100 ms', () => {
    expect(medianMs(() => {
      coolRun('petg', 0.5, 30)
      minLayerS('petg', 0.5)
    })).toBeLessThan(100)
  })
})

describe('Thermal runaway protection', () => {
  const run = (f: HotendFault, on: boolean) => hotendRun({ kind: 'pid', gains: tune.gains }, 210, 400, { fault: f, faultAt: 150 }, on ? MARLIN_WATCH : null)
  it('a normal print never trips', () => expect(run('none', true).halt).toBeNull())
  it('every fault halts with protection; a loose thermistor cooks the block without it', () => {
    for (const f of Object.keys(HOTEND_FAULTS).filter((k) => k !== 'none') as HotendFault[]) {
      const h = run(f, true).halt
      expect(h?.why).toBe('Thermal runaway')
      expect(h!.t - 150).toBeLessThan(MARLIN_WATCH.period + 30)
    }
    expect(run('loose', false).peak).toBeGreaterThan(350)
    expect(run('loose', true).peak).toBeLessThan(300)
  })
  it('a dead heater during heat-up fails the watch period', () => {
    const r = hotendRun({ kind: 'pid', gains: tune.gains }, 210, 200, { fault: 'heater', faultAt: 20 }, MARLIN_WATCH)
    expect(r.halt?.why).toBe('Heating failed')
  })
})
