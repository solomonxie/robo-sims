// ESP32 memory: flash partitions, RAM regions, task stack + heap, flash wear (LittleFS, NVS).

export const KB = 1024
export const MB = 1024 * KB
export const FLASH_BYTES = 4 * MB
export const SECTOR = 4 * KB
export const APP_ALIGN = 64 * KB

// --- Flash layout: Arduino-ESP32 partition schemes for 4 MB. ---

export type PartKind = 'gap' | 'boot' | 'table' | 'nvs' | 'otadata' | 'app' | 'fs' | 'coredump'
export interface Partition {
  name: string
  kind: PartKind
  offset: number
  size: number
}
export type Scheme = 'default' | 'huge' | 'minfs'

const HEAD: [string, PartKind, number][] = [
  ['', 'gap', 0x1000],
  ['bootloader', 'boot', 0x7000],
  ['partition table', 'table', 0x1000],
  ['nvs', 'nvs', 0x5000],
  ['otadata', 'otadata', 0x2000],
]
const BODY: Record<Scheme, [string, PartKind, number][]> = {
  default: [['app0', 'app', 0x140000], ['app1', 'app', 0x140000], ['spiffs', 'fs', 0x160000], ['coredump', 'coredump', 0x10000]],
  huge: [['app0', 'app', 0x300000], ['spiffs', 'fs', 0xe0000], ['coredump', 'coredump', 0x10000]],
  minfs: [['app0', 'app', 0x1e0000], ['app1', 'app', 0x1e0000], ['spiffs', 'fs', 0x20000], ['coredump', 'coredump', 0x10000]],
}

/** Partitions back to back from 0x0: ROM loads the bootloader at 0x1000, the table sits at 0x8000. */
export function partitionTable(scheme: Scheme): Partition[] {
  let offset = 0
  return [...HEAD, ...BODY[scheme]].map(([name, kind, size]) => {
    const p = { name, kind, offset, size }
    offset += size
    return p
  })
}

export const appSlot = (scheme: Scheme) => partitionTable(scheme).find((p) => p.kind === 'app')!.size
export const hasOta = (scheme: Scheme) => partitionTable(scheme).filter((p) => p.kind === 'app').length > 1
export const fsSize = (scheme: Scheme) => partitionTable(scheme).find((p) => p.kind === 'fs')!.size

// --- Where things live: internal SRAM split by bus, external PSRAM, flash mapped through the cache. ---

export type Region = 'iram' | 'dram' | 'psram' | 'flash'
export const REGION_BYTES: Record<Region, number> = { iram: 128 * KB, dram: 320 * KB, psram: 4 * MB, flash: FLASH_BYTES }
export type Item = 'code' | 'const' | 'global' | 'isr' | 'psram'
/** Region an item runs/lives in, and whether boot copies it there from flash. */
export const PLACE: Record<Item, { region: Region; copied: boolean }> = {
  code: { region: 'flash', copied: false },
  const: { region: 'flash', copied: false },
  global: { region: 'dram', copied: true },
  isr: { region: 'iram', copied: true },
  psram: { region: 'psram', copied: false },
}
export const CPU_HZ = 240e6
/** Quad-SPI cache-line fill: 8 command clocks on one line, 24-bit address on 4 (6), 4 dummy, then 2 clocks a byte. */
export const lineFillS = (spiHz: number, lineBytes = 32) => (8 + 6 + 4 + 2 * lineBytes) / spiHz
/** Time to read one word: a cycle from SRAM or a cache hit, a line fill on a miss (flash 80 MHz, PSRAM 40 MHz). */
export const readS = (region: Region, hit = false) => (region === 'iram' || region === 'dram' || hit ? 1 / CPU_HZ : lineFillS(region === 'flash' ? 80e6 : 40e6))

// --- Stack: a task's stack is one heap block, filled from its top down, with a canary at the bottom. ---

export const STACK_BYTES = 8 * KB
export const FRAME_OVERHEAD = 32
export const CANARY_BYTES = 32
export interface Frame {
  fn: string
  locals: number
}
export const frameBytes = (f: Frame) => f.locals + FRAME_OVERHEAD
export const stackUsed = (frames: Frame[]) => frames.reduce((a, f) => a + frameBytes(f), 0)
/** Room before the canary; negative = overflowed. */
export const stackLeft = (frames: Frame[], size = STACK_BYTES) => size - CANARY_BYTES - stackUsed(frames)

export type StackRun = 'calls' | 'big' | 'recursion'
const LOOP: Frame = { fn: 'loop()', locals: 96 }
/** Call-stack snapshots, one per call or return. Ends at the first overflow, if any. */
export function stackScript(run: StackRun, size = STACK_BYTES): Frame[][] {
  const seq: Frame[][] = []
  const push = (fs: Frame[]) => {
    seq.push(fs)
    return stackLeft(fs, size) < 0
  }
  if (run === 'calls') {
    const read = { fn: 'readSensor()', locals: 48 }
    const parse = { fn: 'parse()', locals: 256 }
    for (const fs of [[LOOP], [LOOP, read], [LOOP, read, { fn: 'Wire.requestFrom()', locals: 64 }], [LOOP, read], [LOOP], [LOOP, parse], [LOOP, parse, { fn: 'printf()', locals: 512 }], [LOOP, parse], [LOOP]]) push(fs)
  } else if (run === 'big') {
    const up = { fn: 'upload()  buf[6144]', locals: 6144 }
    const post = { fn: 'http.POST()', locals: 1200 }
    for (const fs of [[LOOP], [LOOP, up], [LOOP, up, post], [LOOP, up, post, { fn: 'client.write()', locals: 900 }]]) if (push(fs)) break
  } else {
    const fs: Frame[] = [LOOP]
    for (let d = 1; !push([...fs]) && d < 1000; d++) fs.push({ fn: `walk(${d})`, locals: 128 })
  }
  return seq
}

export interface Block {
  addr: number
  size: number
  id: string | null
}
export type HeapOp = { alloc: string; bytes: number } | { free: string }
export const HEAP_BYTES = 24 * KB
export const BIG_ASK = 8 * KB

/** First-fit allocator: snapshot of the arena after each op (a failed malloc leaves it unchanged). Neighbouring holes merge. */
export function heapRun(ops: HeapOp[], arena = HEAP_BYTES) {
  let blocks: Block[] = [{ addr: 0, size: arena, id: null }]
  return ops.map((op) => {
    let ok = true
    if ('alloc' in op) {
      const i = blocks.findIndex((b) => b.id === null && b.size >= op.bytes)
      if (i < 0) ok = false
      else {
        const h = blocks[i]
        const rest = h.size > op.bytes ? [{ addr: h.addr + op.bytes, size: h.size - op.bytes, id: null }] : []
        blocks = [...blocks.slice(0, i), { addr: h.addr, size: op.bytes, id: op.alloc }, ...rest, ...blocks.slice(i + 1)]
      }
    } else {
      blocks = blocks.map((b) => (b.id === op.free ? { ...b, id: null } : b))
      blocks = blocks.reduce<Block[]>((acc, b) => {
        const last = acc[acc.length - 1]
        if (last && last.id === null && b.id === null) acc[acc.length - 1] = { ...last, size: last.size + b.size }
        else acc.push(b)
        return acc
      }, [])
    }
    return { op, ok, blocks }
  })
}

export const freeBytes = (bs: Block[]) => bs.reduce((a, b) => a + (b.id === null ? b.size : 0), 0)
export const largestFree = (bs: Block[]) => bs.reduce((a, b) => (b.id === null ? Math.max(a, b.size) : a), 0)
/** 0 = all free space in one piece, → 1 = scattered in small holes. */
export const fragmentation = (bs: Block[]) => (freeBytes(bs) ? 1 - largestFree(bs) / freeBytes(bs) : 0)

export type HeapRun = 'churn' | 'reuse'
/** Six readings, each a kept 512 B String and a 3 KB JSON doc. Churn mallocs and frees the doc every time;
 *  reuse allocates one buffer up front. Both end asking for an 8 KB buffer. */
export function heapScript(run: HeapRun): HeapOp[] {
  const ops: HeapOp[] = run === 'reuse' ? [{ alloc: 'doc', bytes: 3 * KB }] : []
  for (let k = 1; k <= 6; k++) {
    if (run === 'churn') ops.push({ alloc: `doc${k}`, bytes: 3 * KB })
    ops.push({ alloc: `str${k}`, bytes: 512 })
  }
  if (run === 'churn') for (let k = 1; k <= 6; k++) ops.push({ free: `doc${k}` })
  ops.push({ alloc: 'big', bytes: BIG_ASK })
  return ops
}

// --- Wear: NOR flash erases 4 KB sectors, each good for ~100 k erase cycles. ---

export const ENDURANCE = 100_000
export const NVS_PAGES = 5
export const NVS_ENTRIES = 126
export type Store = 'raw' | 'littlefs' | 'nvs'
/** Sectors the writes spread over, and how many writes fill one before it must be erased. */
export const wearSpread = (store: Store, fsBytes = fsSize('default')) =>
  store === 'raw' ? { sectors: 1, perErase: 1 } : store === 'littlefs' ? { sectors: fsBytes / SECTOR, perErase: 1 } : { sectors: NVS_PAGES, perErase: NVS_ENTRIES }
/** Seconds until the most-worn sector reaches its endurance, writing a small value `rate` times a second. */
export function wearLifeS(store: Store, rate: number, fsBytes?: number) {
  const { sectors, perErase } = wearSpread(store, fsBytes)
  return (ENDURANCE * sectors * perErase) / rate
}
/** Erases of sector `i` after `writes` small writes; spread stores rotate round-robin. */
export function erasesOf(store: Store, writes: number, i: number, fsBytes?: number) {
  const { sectors, perErase } = wearSpread(store, fsBytes)
  if (i >= sectors) return 0
  const fills = Math.floor(writes / perErase)
  return Math.floor((fills + sectors - 1 - i) / sectors)
}

/** One update of a stored value, step by step; what a reboot finds if power dies during step `cut`. */
export const WRITE_STEPS: Record<Store, string[]> = {
  raw: ['erase sector', 'program new value'],
  littlefs: ['program new block', 'commit metadata', 'old block free'],
  nvs: ['entry: writing', 'entry: written', 'old entry: erased'],
}
export function afterCut(store: Store, cut: number): 'old' | 'new' | 'lost' {
  if (store === 'raw') return 'lost'
  if (store === 'littlefs') return cut <= 1 ? 'old' : 'new'
  return cut === 0 ? 'old' : 'new'
}
