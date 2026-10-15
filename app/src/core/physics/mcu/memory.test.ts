import {
  APP_ALIGN,
  BIG_ASK,
  ENDURANCE,
  FLASH_BYTES,
  KB,
  STACK_BYTES,
  afterCut,
  appSlot,
  erasesOf,
  fragmentation,
  freeBytes,
  fsSize,
  hasOta,
  heapRun,
  heapScript,
  largestFree,
  lineFillS,
  partitionTable,
  readS,
  stackLeft,
  stackScript,
  stackUsed,
  wearLifeS,
} from './memory'

describe('ESP32 partition schemes', () => {
  it.each(['default', 'huge', 'minfs'] as const)('%s tiles 4 MB with 64 KB-aligned apps', (s) => {
    const t = partitionTable(s)
    t.slice(1).forEach((p, i) => expect(p.offset).toBe(t[i].offset + t[i].size))
    const last = t[t.length - 1]
    expect(last.offset + last.size).toBe(FLASH_BYTES)
    t.filter((p) => p.kind === 'app').forEach((p) => expect(p.offset % APP_ALIGN).toBe(0))
    expect(t.find((p) => p.kind === 'boot')!.offset).toBe(0x1000)
    expect(t.find((p) => p.kind === 'table')!.offset).toBe(0x8000)
  })
  it('trades OTA and file space for app size', () => {
    expect(appSlot('default')).toBe(1280 * KB)
    expect(hasOta('default')).toBe(true)
    expect(hasOta('huge')).toBe(false)
    expect(appSlot('huge')).toBe(3 * 1024 * KB)
    expect(fsSize('minfs')).toBe(128 * KB)
  })
  it('a cache miss costs a quad-SPI line fill, hundreds of CPU cycles', () => {
    expect(lineFillS(80e6)).toBeCloseTo(82 / 80e6)
    expect(readS('flash') / readS('iram')).toBeGreaterThan(200)
    expect(readS('flash', true)).toBe(readS('dram'))
    expect(readS('psram')).toBeCloseTo(2 * readS('flash'))
  })
})

describe('task stack', () => {
  it('normal calls return to the start and stay small', () => {
    const s = stackScript('calls')
    expect(s[s.length - 1]).toEqual(s[0])
    expect(Math.max(...s.map(stackUsed))).toBeLessThan(STACK_BYTES / 4)
  })
  it('a big local and a runaway recursion overflow into the canary', () => {
    for (const run of ['big', 'recursion'] as const) {
      const s = stackScript(run)
      expect(stackLeft(s[s.length - 1])).toBeLessThan(0)
      s.slice(0, -1).forEach((f) => expect(stackLeft(f)).toBeGreaterThanOrEqual(0))
    }
    expect(stackScript('recursion').length).toBe(52)
  })
})

describe('heap', () => {
  it('first fit splits a hole and merges freed neighbours', () => {
    const r = heapRun([{ alloc: 'a', bytes: 100 }, { alloc: 'b', bytes: 50 }, { free: 'a' }, { free: 'b' }], 1000)
    expect(r[1].blocks.map((b) => b.addr)).toEqual([0, 100, 150])
    expect(r[3].blocks).toEqual([{ addr: 0, size: 1000, id: null }])
  })
  it('churn leaves plenty free but no hole big enough', () => {
    const r = heapRun(heapScript('churn'))
    const end = r[r.length - 1]
    expect(end.ok).toBe(false)
    expect(freeBytes(end.blocks)).toBeGreaterThan(2 * BIG_ASK)
    expect(largestFree(end.blocks)).toBe(3 * KB)
    expect(fragmentation(end.blocks)).toBeCloseTo(1 - 3 / 21)
  })
  it('one reused buffer keeps the free space in one piece', () => {
    const r = heapRun(heapScript('reuse'))
    expect(r[r.length - 1].ok).toBe(true)
    expect(fragmentation(r[r.length - 2].blocks)).toBe(0)
  })
})

describe('flash wear', () => {
  it('rewriting one sector wears it out in a day at 1 write/s', () => {
    expect(wearLifeS('raw', 1)).toBe(ENDURANCE)
    expect(wearLifeS('littlefs', 1) / wearLifeS('raw', 1)).toBe(352)
    expect(wearLifeS('nvs', 1) / wearLifeS('raw', 1)).toBe(5 * 126)
  })
  it('round-robin spreads erases within one of each other', () => {
    const e = Array.from({ length: 352 }, (_, i) => erasesOf('littlefs', 1000, i))
    expect(e.reduce((a, b) => a + b)).toBe(1000)
    expect(Math.max(...e) - Math.min(...e)).toBe(1)
    expect(erasesOf('raw', 1000, 0)).toBe(1000)
    expect(erasesOf('raw', 1000, 1)).toBe(0)
    expect(erasesOf('nvs', 126 * 10, 0)).toBe(2)
  })
  it('only an in-place rewrite loses the value on a power cut', () => {
    expect(afterCut('raw', 0)).toBe('lost')
    expect(afterCut('littlefs', 1)).toBe('old')
    expect(afterCut('littlefs', 2)).toBe('new')
    expect(afterCut('nvs', 0)).toBe('old')
  })
})
