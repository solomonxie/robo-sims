import * as THREE from 'three/webgpu'
import {
  BIG_ASK,
  Block,
  CANARY_BYTES,
  ENDURANCE,
  FLASH_BYTES,
  Frame,
  HEAP_BYTES,
  HeapRun,
  Item,
  KB,
  PLACE,
  PartKind,
  Partition,
  REGION_BYTES,
  Region,
  STACK_BYTES,
  Scheme,
  StackRun,
  Store,
  WRITE_STEPS,
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
  wearSpread,
} from '../../core/physics'
import { bytesText, pct, secs, spanText } from '../../core/units'
import { V3, add, box, mesh } from '../../models/kit'
import { createStage } from '../../scene/stage'
import {
  CLK_COLOR,
  CODE_LEGEND,
  DATA_COLOR,
  FORCE,
  GREY,
  HEAT,
  HIGH_V,
  LABEL,
  POWER,
  RING,
  codeBlock,
  emptyGroup,
  glide,
  glowMat,
  liveLabel,
  partLetter,
  path,
  setGlow,
  shadowlessRod,
  stretchRod,
  trayMat,
} from '../fx'
import { Lesson, Params, Stage, n, opts, pick } from '../types'

const DARK = '#23262d'
const FILL = '#b5f6ff'
const hex = (b: number) => `0x${b.toString(16).toUpperCase()}`
const ns = (s: number) => (s < 1e-6 ? `${+(s * 1e9).toFixed(1)} ns` : secs(s))
const rod = (g: THREE.Object3D, a: V3, b: V3, m: THREE.Material, r = 0.06) => stretchRod(add(g, shadowlessRod(m)), a, b, r)

/** Unit box resized each frame: `set(x0, x1, y, h)`; zero width hides it. */
function slab(parent: THREE.Object3D, m: THREE.Material, z = 0, depth = 0.4) {
  const o = add(parent, mesh(new THREE.BoxGeometry(1, 1, depth), m))
  o.castShadow = false
  return (x0: number, x1: number, y: number, h: number, m2?: THREE.Material) => {
    if (m2) o.material = m2
    o.visible = x1 - x0 > 0.01
    o.scale.set(Math.max(0.01, x1 - x0), h, 1)
    o.position.set((x0 + x1) / 2, y, z)
  }
}

/** Dots running along a polyline; `run(t, u, color)` with u = 0 hides them. */
function dotLane(parent: THREE.Object3D, count = 7) {
  const m = glowMat(RING, 1)
  const dots = Array.from({ length: count }, () => {
    const o = add(parent, mesh(new THREE.SphereGeometry(0.28, 12, 8), m))
    o.castShadow = false
    return o
  })
  let curve: THREE.CurvePath<THREE.Vector3> | null = null
  let key = ''
  return (pts: V3[] | null, t: number, color: string, speed = 0.5) => {
    const k = JSON.stringify(pts)
    if (k !== key) {
      key = k
      curve = pts ? path(pts) : null
    }
    setGlow(m, color, 1)
    m.color.set(color)
    dots.forEach((o, i) => {
      o.visible = !!curve
      if (curve) o.position.copy(curve.getPointAt((((t * speed + i / count) % 1) + 1) % 1))
    })
  }
}

// --- Flash layout: the 4 MB chip as partitions to scale, and where code and data run from. ---

const KIND_COLOR: Record<PartKind, string> = { gap: '#30333a', boot: HEAT, table: RING, nvs: POWER, otadata: FORCE, app: CLK_COLOR, fs: DATA_COLOR, coredump: GREY }
const SCHEMES: Record<Scheme, string> = { default: 'Default', huge: 'Huge app', minfs: 'Minimal SPIFFS' }
const SCHEME_IDE: Record<Scheme, string> = { default: 'Default 4MB with spiffs', huge: 'Huge APP (3MB No OTA/1MB SPIFFS)', minfs: 'Minimal SPIFFS (1.9MB APP with OTA)' }
const ITEMS: Record<Item, string> = { code: 'Code', const: 'const', global: 'Global', isr: 'IRAM_ATTR', psram: 'PSRAM' }
const REGION_NAME: Record<Region, string> = { iram: 'IRAM', dram: 'DRAM', psram: 'PSRAM', flash: 'flash' }
const ITEM_CODE: Record<Item, [string, string]> = {
  code: ['void loop() { readSensor(); delay(10); }', '// runs straight from flash, through the cache'],
  const: ['const uint8_t font[4096] = { 0x3C, ... };', '// read-only: stays in flash, never copied'],
  global: ['int count = 5;  // a global with a start value', '// boot copies 5 from flash into DRAM'],
  isr: ['void IRAM_ATTR onPulse() { pulses++; }', '// copied to IRAM: runs even while flash is busy'],
  psram: ['uint8_t *frame = (uint8_t *)ps_malloc(320 * 240 * 2);', '// 150 KB camera frame in external PSRAM (WROVER)'],
}
const BOOT_STEPS: [PartKind, string][] = [
  ['boot', 'ROM loads the bootloader from 0x1000'],
  ['table', 'bootloader reads the partition table at 0x8000'],
  ['otadata', 'otadata says which app slot to run'],
  ['app', 'app0 mapped into the CPU address space'],
]
const BOOT_STEP_S = 0.8
const COPY_S = 1.4
const RUN_S = 3.6
const FLASH_CYCLE = BOOT_STEPS.length * BOOT_STEP_S + COPY_S + RUN_S
const ST = { x: -24, y: 4.5, w: 48, h: 2.2 }
const ZM = { x: -24, y: -2.6, w: 20, h: 2.2, bytes: 64 * KB }
const RAM_Y = -2.6
const RAM_BOX: Record<Region | 'cpu' | 'cache', [number, number, string, string]> = {
  iram: [-1, 3.2, POWER, 'IRAM 128 KB'],
  dram: [3.8, 10, POWER, 'DRAM 320 KB'],
  cpu: [11.2, 15, LABEL, 'CPU 240 MHz'],
  cache: [15.6, 18.6, RING, 'cache'],
  psram: [19.8, 24.5, DATA_COLOR, 'PSRAM 4 MB'],
  flash: [0, 0, CLK_COLOR, ''],
}

const flashSetup = (p: Params) => {
  const scheme = pick(SCHEMES, p.scheme, 'default')
  const item = pick(ITEMS, p.item, 'code')
  const sketch = n(p, 'sketch') * KB
  const slot = appSlot(scheme)
  return { scheme, item, sketch, slot, fill: sketch / slot, ota: hasOta(scheme), fs: fsSize(scheme), parts: partitionTable(scheme), place: PLACE[item] }
}

export const flashLayout: Lesson = {
  id: 'memory-storage-flash-layout',
  title: 'Flash layout',
  tagline: '4 MB of flash split into partitions; RAM for what must be fast',
  formula: (p) => {
    const S = flashSetup(p)
    const parts = S.parts.filter((x) => x.offset >= 64 * KB).map((x) => `${x.name} ${bytesText(x.size)}`)
    return `4 MB = 64 KB boot area + ${parts.join(' + ')} · sketch ${bytesText(S.sketch)} = ${pct(S.fill)} of the app slot · flash cache miss = (8 + 6 + 4 + 2 × 32 B) clocks / 80 MHz = ${ns(lineFillS(80e6))}, vs ${ns(readS('iram'))} from SRAM`
  },
  legend: [
    { color: HEAT, label: 'Bootloader · partition table (yellow)', shape: 'dot' },
    { color: POWER, label: 'NVS settings · internal SRAM', shape: 'dot' },
    { color: CLK_COLOR, label: 'App slots: your sketch', shape: 'dot' },
    { color: DATA_COLOR, label: 'File system · PSRAM', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'An ESP32 module has its program in a separate 4 MB SPI flash chip. The partition table at 0x8000 cuts it into named regions, chosen in the Arduino IDE under Tools → Partition Scheme.',
    'At reset the ROM loads the 2nd-stage bootloader from 0x1000; it reads the table, asks otadata which app slot is current and starts it. nvs holds key-value settings (Wi-Fi credentials, calibration); spiffs is the file system (LittleFS uses the same partition).',
    'Two app slots make over-the-air updates safe: the new firmware is written to the idle slot and otadata flips only once it is complete. Huge app drops the second slot for a 3 MB sketch: no OTA.',
    'Code isn’t copied to RAM: the flash is mapped into the address space and read through a small cache. A hit is one cycle; a miss fetches a 32-byte line over quad SPI, about 1 µs.',
    'The 520 KB of SRAM splits into IRAM (code that must never wait for flash: IRAM_ATTR interrupt handlers, which must also run while flash is being written) and DRAM (globals, stacks, heap). Globals with a start value are copied from flash at boot; const tables stay in flash.',
    'WROVER modules add 4–8 MB of PSRAM on the same SPI bus and cache, for camera frames and big buffers: roomy but slower than internal RAM. Why flash keeps data with the power off: Semiconductors → Memory cell → Flash floating gate.',
  ],
  controls: [
    { kind: 'choice', key: 'scheme', options: opts(SCHEMES), initial: 'default' },
    { kind: 'slider', key: 'sketch', label: 'Sketch', min: 200, max: 3200, step: 50, initial: 900, format: (v) => bytesText(v * KB) },
    { kind: 'choice', key: 'item', options: opts(ITEMS), initial: 'code' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const sx = (b: number) => ST.x + (b / FLASH_BYTES) * ST.w
    const zx = (b: number) => ZM.x + (b / ZM.bytes) * ZM.w
    box(scene, [ST.w + 0.6, ST.h + 0.6, 0.5], trayMat(), [ST.x + ST.w / 2, ST.y, -0.5])
    box(scene, [ZM.w + 0.6, ZM.h + 0.6, 0.5], trayMat(), [ZM.x + ZM.w / 2, ZM.y, -0.5])
    partLetter(scene, 'SPI flash · 4 MB · to scale', [ST.x, ST.y + 3.1, 0], 0.5, LABEL, 'left')
    partLetter(scene, 'first 64 KB, zoomed', [ZM.x, ZM.y - 3.6, 0], 0.42, GREY, 'left')
    const zoomMat = glowMat(GREY, 0.3)
    rod(scene, [sx(0), ST.y - ST.h / 2 - 0.3, 0], [ZM.x, ZM.y + ZM.h / 2 + 0.3, 0], zoomMat, 0.05)
    rod(scene, [sx(ZM.bytes), ST.y - ST.h / 2 - 0.3, 0], [ZM.x + ZM.w, ZM.y + ZM.h / 2 + 0.3, 0], zoomMat, 0.05)
    const ramMats = {} as Record<string, THREE.MeshStandardMaterial>
    for (const [k, [x0, x1, color, name]] of Object.entries(RAM_BOX)) {
      if (k === 'flash') continue
      box(scene, [x1 - x0 + 0.3, 2.9, 0.5], trayMat(), [(x0 + x1) / 2, RAM_Y, -0.5])
      ramMats[k] = glowMat(color, 0.15)
      const o = add(scene, mesh(new THREE.BoxGeometry(x1 - x0, 2.5, 0.3), ramMats[k]), [(x0 + x1) / 2, RAM_Y, 0])
      o.castShadow = false
      partLetter(scene, name, [(x0 + x1) / 2, RAM_Y + 2, 0.2], 0.4, LABEL)
    }
    partLetter(scene, 'inside the ESP32 (not to scale)', [-1, RAM_Y - 3, 0], 0.4, GREY, 'left')
    const ramValue = liveLabel(scene, [(RAM_BOX.cpu[0] + RAM_BOX.cpu[1]) / 2, RAM_Y, 0.4], { size: 0.42 })
    const parts = add(scene, new THREE.Group())
    const fillMat = glowMat(FILL, 1)
    const fill = slab(scene, fillMat, 0.35, 0.3)
    const over = slab(scene, glowMat(HIGH_V, 1), 0.35, 0.3)
    const fillLabel = liveLabel(scene, [0, ST.y, 0.6], { size: 0.45 })
    const lane = dotLane(scene)
    const phase = liveLabel(scene, [-24, -7.6, 0.3], { size: 0.5, align: 'left' })
    const code = codeBlock(scene, [-24.5, 12.6, 0], 0.38, 4)
    let segs: { p: Partition; m: THREE.MeshStandardMaterial[] }[] = []
    const s = { key: '', t: 0 }
    return {
      scene,
      view: { center: [0, 3, 0], radius: 86, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const S = flashSetup(p)
        if (S.scheme !== s.key) {
          s.key = S.scheme
          s.t = 0
          emptyGroup(parts)
          segs = S.parts.map((pt) => {
            const color = KIND_COLOR[pt.kind]
            const m = [glowMat(color, 0.25), glowMat(color, 0.25)]
            const draw = (x0: number, x1: number, y: number, k: number) => {
              const w = x1 - x0
              const o = add(parts, mesh(new THREE.BoxGeometry(Math.max(0.02, w - 0.06), ST.h, 0.3), m[k]), [(x0 + x1) / 2, y, 0])
              o.castShadow = false
              return w
            }
            const w = draw(sx(pt.offset), sx(pt.offset + pt.size), ST.y, 0)
            const cx = sx(pt.offset + pt.size / 2)
            const name = pt.kind === 'fs' ? 'spiffs (LittleFS)' : pt.name === 'app1' ? 'app1 (next OTA)' : pt.name
            if (w > 3) {
              partLetter(parts, name, [cx, ST.y + ST.h / 2 + 0.6, 0], 0.45, LABEL)
              partLetter(parts, bytesText(pt.size), [cx, ST.y - ST.h / 2 - 0.7, 0], 0.4, GREY)
            } else if (pt.kind === 'coredump') partLetter(parts, 'coredump', [ST.x + ST.w, ST.y + ST.h / 2 + 0.6, 0], 0.36, GREY, 'right')
            if (pt.offset < ZM.bytes) {
              const zw = draw(zx(pt.offset), zx(pt.offset + pt.size), ZM.y, 1)
              const zc = zx(pt.offset + pt.size / 2)
              if (pt.kind !== 'gap') {
                partLetter(parts, pt.kind === 'table' ? 'table' : pt.kind === 'otadata' ? 'ota' : name, [zc, ZM.y + ZM.h / 2 + 0.6, 0], zw > 2 ? 0.42 : 0.34, LABEL)
                partLetter(parts, bytesText(pt.size), [zc, ZM.y, 0.3], zw > 2 ? 0.4 : 0.3, '#14161b')
              }
              if (pt.kind !== 'gap' && pt.kind !== 'nvs') partLetter(parts, hex(pt.offset), [zx(pt.offset) + 0.1, ZM.y - ZM.h / 2 - 0.6, 0], 0.3, GREY, 'left')
            }
            return { p: pt, m }
          })
        }
        s.t += dt
        const u = s.t % FLASH_CYCLE
        const app0 = S.parts.find((x) => x.name === 'app0')!
        const ax0 = sx(app0.offset)
        const aw = sx(app0.offset + app0.size) - ax0
        fill(ax0, ax0 + Math.min(1, S.fill) * aw, ST.y, ST.h - 0.6)
        over(ax0 + aw, ax0 + Math.min(S.fill, 1.6) * aw, ST.y, ST.h - 0.6)
        fillLabel.group.position.x = Math.max(ax0 + 3.2, ax0 + (Math.min(1, S.fill) * aw) / 2)
        fillLabel.set(S.fill > 1 ? `sketch ${pct(S.fill)}: too big!` : `sketch ${pct(S.fill)}`, '#14161b')
        const bi = Math.floor(u / BOOT_STEP_S)
        const booting = bi < BOOT_STEPS.length
        const lit0 = booting ? BOOT_STEPS[bi][0] : null
        segs.forEach(({ p: pt, m }) => {
          const on = lit0 === pt.kind && (pt.kind !== 'app' || pt.name === 'app0') ? 1 : 0
          m.forEach((x) => setGlow(x, KIND_COLOR[pt.kind], 0.25 + 0.9 * on))
        })
        setGlow(fillMat, FILL, booting && lit0 === 'app' ? 1.4 : 0.8)
        const reg = S.place.region
        const after = u - BOOT_STEPS.length * BOOT_STEP_S
        const copying = !booting && after < COPY_S
        const top: V3 = [ax0 + Math.min(1, S.fill) * aw * 0.5, ST.y - ST.h / 2, 0.4]
        const mid = (k: keyof typeof RAM_BOX) => (RAM_BOX[k][0] + RAM_BOX[k][1]) / 2
        const ramTop = (k: keyof typeof RAM_BOX): V3 => [mid(k), RAM_Y + 1.3, 0.4]
        const busY = ST.y - ST.h / 2 - 2.2
        let pts: V3[] | null = null
        if (copying && S.place.copied) pts = [top, [top[0], busY, 0.4], [mid(reg), busY, 0.4], ramTop(reg)]
        else if (!booting && !copying) {
          const cpu: V3 = [mid('cpu'), RAM_Y, 0.4]
          if (reg === 'flash') pts = [top, [top[0], busY, 0.4], [mid('cache'), busY, 0.4], ramTop('cache'), [mid('cache'), RAM_Y, 0.4], cpu]
          else if (reg === 'psram') pts = [[mid('psram'), RAM_Y, 0.4], [mid('cache'), RAM_Y, 0.4], cpu]
          else pts = [[mid(reg), RAM_Y, 0.4], [mid(reg), RAM_Y - 1.7, 0.4], [mid('cpu'), RAM_Y - 1.7, 0.4], cpu]
        }
        lane(pts, s.t, copying ? HEAT : reg === 'flash' || reg === 'psram' ? RING : POWER, copying ? 0.7 : reg === 'flash' || reg === 'psram' ? 0.3 : 1)
        for (const k of Object.keys(ramMats)) {
          const hot = !booting && (k === reg || (k === 'cache' && (reg === 'flash' || reg === 'psram')) || (k === 'cpu' && !copying))
          setGlow(ramMats[k], RAM_BOX[k as keyof typeof RAM_BOX][2], hot ? 0.8 : 0.15)
        }
        ramValue.set(!booting && !copying ? ns(readS(reg)) : '', '#14161b')
        phase.set(
          booting
            ? BOOT_STEPS[bi][1]
            : copying
              ? S.place.copied
                ? `boot copies it from flash into ${REGION_NAME[reg]}`
                : reg === 'psram'
                  ? 'allocated at run time in PSRAM'
                  : 'not copied: flash is mapped through the cache'
              : `CPU reads it from ${REGION_NAME[reg]}: ${ns(readS(reg))} on a ${reg === 'flash' || reg === 'psram' ? 'cache miss' : 'read'}`,
          booting ? LABEL : copying ? HEAT : POWER,
        )
        code([`// Tools > Partition Scheme: ${SCHEME_IDE[S.scheme]}`, ...ITEM_CODE[S.item], `ESP.getSketchSize();  // ${bytesText(S.sketch)} of ${bytesText(S.slot)}`])
      },
      readouts: (p) => {
        const S = flashSetup(p)
        const reg = S.place.region
        return [
          { label: 'App slot', value: `${bytesText(S.slot)} · sketch ${pct(S.fill)}`, tone: S.fill > 1 ? 'bad' : S.fill > 0.9 ? 'warn' : 'ok' },
          { label: 'OTA updates', value: S.ota ? 'yes: two slots' : 'no: one big slot', tone: S.ota ? 'ok' : 'warn' },
          { label: 'File system', value: bytesText(S.fs) },
          { label: `${ITEMS[S.item]} lives in`, value: `${REGION_NAME[reg]} (${bytesText(REGION_BYTES[reg])}) · ${ns(readS(reg))}${reg === 'flash' || reg === 'psram' ? ' a miss' : ''}` },
        ]
      },
    }
  },
}

// --- Stack and heap: frames pushed down the task stack, blocks allocated and freed in the heap. ---

const STACK_RUNS: Record<StackRun, string> = { calls: 'Normal calls', big: 'Big local', recursion: 'Recursion' }
const HEAP_RUNS: Record<HeapRun, string> = { churn: 'malloc/free churn', reuse: 'Reuse a buffer' }
const STACK_STEP: Record<StackRun, number> = { calls: 0.9, big: 1.6, recursion: 0.14 }
const HEAP_STEP = 0.45
const HOLD_S = 2.2
const CRASH_S = 3
const SK = { x0: -20, x1: 24, y: 4.6, h: 2.4 }
const HP = { x0: -20, x1: 24, y: -3.6, h: 2.2 }
const NEIGHBOUR_W = 5.5
const FRAME_COLORS = [CLK_COLOR, '#4aa3b8']
const STACK_CODE: Record<StackRun, [string, string]> = {
  calls: ['void loop() { readSensor(); parse(line); }', '// each call pushes a frame; return pops it'],
  big: ['void upload() { char buf[6144]; http.POST(buf); }', '// fix: static char buf[6144]; or malloc it'],
  recursion: ['int walk(Node *n) { int seen[32]; return walk(n->next); }', '// no base case: 160 B more per call'],
}
const HEAP_CODE: Record<HeapRun, [string, string]> = {
  churn: ['char *doc = (char *)malloc(3072); /* ... */ free(doc);', 'String keep = reading;  // 512 B, kept'],
  reuse: ['static char *doc = (char *)malloc(3072);  // once', 'String keep = reading;  // 512 B, kept'],
}
const blockColor = (b: Block) => (b.id === null ? DARK : b.id.startsWith('str') ? RING : b.id === 'big' ? POWER : DATA_COLOR)

const stackSetup = (p: Params) => {
  const sr = pick(STACK_RUNS, p.stack, 'recursion')
  const hr = pick(HEAP_RUNS, p.heap, 'churn')
  const stack = stackScript(sr)
  const heap = heapRun(heapScript(hr))
  const peak = Math.max(...stack.map(stackUsed))
  const crash = stackLeft(stack[stack.length - 1]) < 0
  const end = heap[heap.length - 1]
  const before = heap[heap.length - 2].blocks
  return { sr, hr, stack, heap, peak, crash, end, before }
}

export const stackAndHeap: Lesson = {
  id: 'memory-storage-stack-and-heap',
  title: 'Stack and heap',
  tagline: 'Locals grow down a fixed stack; malloc carves up the heap',
  formula: (p) => {
    const S = stackSetup(p)
    const deepest = S.stack.reduce((a, f) => (stackUsed(f) > stackUsed(a) ? f : a))
    return `stack = Σ (locals + ${32} B frame) = ${deepest.length} frames = ${bytesText(S.peak)} of ${bytesText(STACK_BYTES)}${S.crash ? ' → past the canary' : ''} · heap before malloc(${bytesText(BIG_ASK)}): free ${bytesText(freeBytes(S.before))}, largest ${bytesText(largestFree(S.before))} → fragmentation = 1 − largest / free = ${pct(fragmentation(S.before))} · each call or malloc slowed to ~1 per second`
  },
  legend: [
    { color: CLK_COLOR, label: 'Stack frames: locals + return address', shape: 'dot' },
    { color: RING, label: 'Canary · kept 512 B Strings', shape: 'dot' },
    { color: DATA_COLOR, label: 'Heap: 3 KB JSON buffers', shape: 'dot' },
    { color: HIGH_V, label: 'Overflow / failed malloc', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'Every FreeRTOS task has its own stack, fixed when the task is created: Arduino’s loop() runs in loopTask with 8 KB. Each call pushes a frame (locals, saved registers, return address) toward lower addresses; returning pops it.',
    'The stack is just a block taken from the heap, so below it lies someone else’s memory. Overflow it and locals overwrite that block silently, unless something checks.',
    'ESP-IDF puts a canary (a known pattern, plus a watchpoint) at the end of every stack. Touch it and the chip halts: “Guru Meditation Error: Stack canary watchpoint triggered (loopTask)”, then reboots.',
    'Big local arrays and recursion without a limit are the usual causes. Make big buffers static or heap-allocated, or give the task more stack in xTaskCreate; uxTaskGetStackHighWaterMark() shows how close a task came.',
    'The heap (~300 KB of DRAM) is shared by malloc, new, String and every task stack. Allocating and freeing different sizes leaves holes between blocks still in use.',
    'Fragmentation: plenty of free bytes in total but no single hole big enough, so malloc returns NULL. Allocate long-lived buffers once at start-up and reuse them; ESP.getMaxAllocHeap() reports the largest hole. The SRAM cell itself: Semiconductors → Memory cell → SRAM latch.',
  ],
  controls: [
    { kind: 'choice', key: 'stack', options: opts(STACK_RUNS), initial: 'recursion' },
    { kind: 'choice', key: 'heap', options: opts(HEAP_RUNS), initial: 'churn' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const kx = (b: number) => SK.x1 - (b / STACK_BYTES) * (SK.x1 - SK.x0)
    const hx = (b: number) => HP.x0 + (b / HEAP_BYTES) * (HP.x1 - HP.x0)
    const tray = trayMat()
    box(scene, [SK.x1 - SK.x0 + NEIGHBOUR_W + 0.8, SK.h + 0.6, 0.5], tray, [(SK.x0 - NEIGHBOUR_W + SK.x1) / 2, SK.y, -0.5])
    box(scene, [HP.x1 - HP.x0 + 0.6, HP.h + 0.6, 0.5], tray, [(HP.x0 + HP.x1) / 2, HP.y, -0.5])
    partLetter(scene, 'loopTask stack · 8 KB · grows from the high address (right) down', [SK.x1, SK.y + SK.h / 2 + 0.9, 0], 0.48, LABEL, 'right')
    partLetter(scene, 'heap · 24 KB slice · first fit →', [HP.x0, HP.y + HP.h / 2 + 2.9, 0], 0.48, LABEL, 'left')
    const nbMat = glowMat(DATA_COLOR, 0.2)
    const nb = add(scene, mesh(new THREE.BoxGeometry(NEIGHBOUR_W - 0.2, SK.h, 0.3), nbMat), [SK.x0 - NEIGHBOUR_W / 2 - 0.25, SK.y, 0])
    nb.castShadow = false
    partLetter(scene, 'next heap block', [SK.x0 - NEIGHBOUR_W / 2 - 0.25, SK.y - SK.h / 2 - 0.8, 0], 0.36, GREY)
    const nbLabel = liveLabel(scene, [SK.x0 - NEIGHBOUR_W / 2 - 0.25, SK.y, 0.4], { size: 0.38 })
    const canMat = glowMat(RING, 0.8)
    const can = add(scene, mesh(new THREE.BoxGeometry(0.5, SK.h, 0.35), canMat), [SK.x0 + 0.25, SK.y, 0])
    can.castShadow = false
    partLetter(scene, 'canary', [SK.x0 + 0.25, SK.y + SK.h / 2 + 0.9, 0], 0.38, RING)
    const frameMats = [...FRAME_COLORS.map((c) => glowMat(c, 0.6)), glowMat(HIGH_V, 1)]
    const frames = Array.from({ length: 64 }, (_, i) => ({ set: slab(scene, frameMats[i % 2], 0.05, 0.3), i }))
    const frameLabels = Array.from({ length: 4 }, () => liveLabel(scene, [0, SK.y, 0.4], { size: 0.38 }))
    const spMat = glowMat(LABEL, 1)
    const sp = add(scene, shadowlessRod(spMat))
    const spLabel = liveLabel(scene, [0, SK.y - SK.h / 2 - 0.8, 0.3], { size: 0.4 })
    const hwm = add(scene, shadowlessRod(glowMat(RING, 0.9)))
    const usedLabel = liveLabel(scene, [SK.x0 + 2, SK.y + SK.h / 2 + 0.9, 0], { size: 0.42, align: 'left' })
    const heapG = add(scene, new THREE.Group())
    const ghost = slab(scene, glowMat(HIGH_V, 0.9), 0.1, 0.3)
    const ghostLabel = liveLabel(scene, [0, HP.y + HP.h / 2 + 1.5, 0.4], { size: 0.42, align: 'left' })
    const heapLabel = liveLabel(scene, [HP.x1, HP.y - HP.h / 2 - 0.9, 0], { size: 0.42, align: 'right' })
    const crashLabel = liveLabel(scene, [2, SK.y + 3.4, 0.6], { size: 0.55 })
    const code = codeBlock(scene, [-24.5, 12.4, 0], 0.38, 4)
    const s = { key: '', st: 0, ht: 0, peak: 0, hi: -1, nbGlow: 0 }
    return {
      scene,
      view: { center: [0, 3, 0], radius: 86, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const S = stackSetup(p)
        const key = `${S.sr}|${S.hr}`
        if (key !== s.key) Object.assign(s, { key, st: 0, ht: 0, peak: 0, hi: -1 })
        s.st += dt
        s.ht += dt
        const step = STACK_STEP[S.sr]
        const runS = S.stack.length * step
        if (S.crash && s.st > runS + CRASH_S) Object.assign(s, { st: 0, ht: 0, peak: 0, hi: -1 })
        if (!S.crash && s.st > runS + HOLD_S) Object.assign(s, { st: 0, peak: 0 })
        const crashed = S.crash && s.st >= runS - step
        const fs: Frame[] = S.stack[Math.min(S.stack.length - 1, Math.floor(s.st / step))]
        let at = 0
        let li = 0
        frameLabels.forEach((l) => l.set(''))
        frames.forEach(({ set, i }) => {
          const f = fs[i]
          if (!f) return set(0, 0, 0, 0)
          const b0 = at
          at += f.locals + 32
          const past = at > STACK_BYTES - CANARY_BYTES
          set(kx(Math.min(at, STACK_BYTES + (NEIGHBOUR_W * STACK_BYTES) / (SK.x1 - SK.x0))) + 0.03, kx(b0) - 0.03, SK.y, SK.h - 0.3, past ? frameMats[2] : frameMats[i % 2])
          if (kx(b0) - kx(at) > 3.2 && li < frameLabels.length) {
            const l = frameLabels[li++]
            l.group.position.x = (kx(b0) + kx(Math.min(at, STACK_BYTES))) / 2
            l.set(f.fn, '#14161b')
          }
        })
        const used = stackUsed(fs)
        s.peak = Math.max(s.peak, used)
        const spx = Math.max(kx(used), SK.x0 - NEIGHBOUR_W)
        stretchRod(sp, [spx, SK.y - SK.h / 2 - 0.3, 0.3], [spx, SK.y + SK.h / 2 + 0.3, 0.3], 0.08)
        spLabel.group.position.x = Math.min(Math.max(spx, SK.x0 + 2.5), SK.x1 - 3)
        spLabel.set(`SP · ${fs[fs.length - 1].fn}`, crashed ? HIGH_V : LABEL)
        const hx0 = kx(Math.min(s.peak, STACK_BYTES))
        stretchRod(hwm, [hx0, SK.y - SK.h / 2, 0.3], [hx0, SK.y + SK.h / 2, 0.3], 0.05)
        usedLabel.set(`used ${bytesText(used)} · free ${bytesText(Math.max(0, stackLeft(fs)))}`, crashed ? HIGH_V : POWER)
        setGlow(canMat, crashed ? HIGH_V : RING, crashed ? 1.4 : 0.8)
        s.nbGlow = glide(dt, s.nbGlow, crashed ? 1 : 0, 6)
        setGlow(nbMat, s.nbGlow > 0.5 ? HIGH_V : DATA_COLOR, 0.2 + 0.8 * s.nbGlow)
        nbLabel.set(crashed ? 'overwritten' : 'other data', crashed ? '#14161b' : LABEL)
        crashLabel.set(crashed ? 'Guru Meditation: Stack canary watchpoint triggered (loopTask) · rebooting' : '', HIGH_V)
        const hRun = S.heap.length * HEAP_STEP
        if (!crashed && s.ht > hRun + HOLD_S) s.ht = 0
        const hi = Math.min(S.heap.length - 1, Math.floor(s.ht / HEAP_STEP))
        const snap = S.heap[hi]
        if (hi !== s.hi) {
          s.hi = hi
          emptyGroup(heapG)
          snap.blocks.forEach((b) => {
            const x0 = hx(b.addr)
            const x1 = hx(b.addr + b.size)
            const o = add(heapG, mesh(new THREE.BoxGeometry(Math.max(0.02, x1 - x0 - 0.08), HP.h - (b.id ? 0.2 : 0.8), 0.3), glowMat(blockColor(b), b.id ? 0.6 : 0.1)), [(x0 + x1) / 2, HP.y, 0])
            o.castShadow = false
            if (b.id && x1 - x0 > 2.5) partLetter(heapG, b.id === 'big' ? 'buf 8 KB' : b.id, [(x0 + x1) / 2, HP.y, 0.3], 0.4, '#14161b')
            if (!b.id && x1 - x0 > 2.5) partLetter(heapG, `${bytesText(b.size)} free`, [(x0 + x1) / 2, HP.y, 0.3], 0.36, GREY)
          })
          box(heapG, [0.12, 0.6, 0.3], glowMat(LABEL, 0.8), [hx(0), HP.y - HP.h / 2 - 0.5, 0])
        }
        const failed = 'alloc' in snap.op && !snap.ok
        ghost(failed ? HP.x0 : 0, failed ? hx(BIG_ASK) : 0, HP.y + HP.h / 2 + 1.5, 1.4)
        ghostLabel.group.position.x = hx(BIG_ASK) + 0.6
        ghostLabel.set(failed ? `malloc(${bytesText(BIG_ASK)}) → NULL: no hole that big` : 'alloc' in snap.op ? `malloc(${bytesText(snap.op.bytes)})` : `free(${snap.op.free})`, failed ? HIGH_V : GREY)
        heapLabel.set(`free ${bytesText(freeBytes(snap.blocks))} · largest hole ${bytesText(largestFree(snap.blocks))} · fragmented ${pct(fragmentation(snap.blocks))}`, fragmentation(snap.blocks) > 0.5 ? HEAT : POWER)
        code([...STACK_CODE[S.sr], ...HEAP_CODE[S.hr]])
      },
      readouts: (p) => {
        const S = stackSetup(p)
        return [
          { label: 'Stack needs', value: `${bytesText(S.peak)} of ${bytesText(STACK_BYTES)}`, tone: S.crash ? 'bad' : S.peak > STACK_BYTES / 2 ? 'warn' : 'ok' },
          { label: 'Stack', value: S.crash ? 'overflow: canary trips, reboot' : 'fits', tone: S.crash ? 'bad' : 'ok' },
          { label: 'Heap free / largest', value: `${bytesText(freeBytes(S.before))} / ${bytesText(largestFree(S.before))}`, tone: fragmentation(S.before) > 0.5 ? 'warn' : 'ok' },
          { label: `malloc(${bytesText(BIG_ASK)})`, value: S.end.ok ? 'OK' : 'NULL: fragmented', tone: S.end.ok ? 'ok' : 'bad' },
        ]
      },
    }
  },
}

// --- LittleFS: wear spread across sectors, copy-on-write updates that survive a power cut, NVS key-value. ---

const STORES: Record<Store, string> = { raw: 'Raw sector', littlefs: 'LittleFS', nvs: 'NVS' }
const RATES = { min: 1 / 60, sec: 1, ten: 10 }
const RATE_TEXT: Record<keyof typeof RATES, string> = { min: '1 / min', sec: '1 / s', ten: '10 / s' }
const CUTS = { no: 'No cut', yes: 'Pull the plug' }
const SHOWN = 64
const LAPSE_S = 10
const LAPSE_HOLD = 2.5
const BAR_H = 7
const BAR = { x0: -22, x1: 24, y: -1 }
const W_STEP = 1.1
const LOST_S = 1
const RESULT_S = 1.8
const CELL_W = 6.5
const CELLS = { y: -5.6, old: -16, new: -8 }
const CUT_AT: Record<Store, number> = { raw: 1, littlefs: 0, nvs: 0 }
const STORE_CODE: Record<Store, [string, string]> = {
  raw: ['esp_partition_erase_range(part, 0, 4096);  // whole sector', 'esp_partition_write(part, 0, &count, sizeof count);'],
  littlefs: ['File f = LittleFS.open("/count.txt", "w");', 'f.print(count); f.close();  // close() commits'],
  nvs: ['prefs.begin("app");  // Preferences = NVS', 'prefs.putUInt("count", count);  // appends a 32 B entry'],
}
const wearColor = (u: number) => (u < 0.5 ? POWER : u < 0.9 ? RING : HIGH_V)

const fsSetup = (p: Params) => {
  const store = pick(STORES, p.store, 'littlefs')
  const rk = pick(RATES, p.rate, 'sec')
  const cut = pick(CUTS, p.cut, 'no') === 'yes'
  const rate = RATES[rk]
  const life = wearLifeS(store, rate)
  const spread = wearSpread(store)
  const steps = WRITE_STEPS[store]
  const cutAt = CUT_AT[store]
  const stepsShown = cut ? cutAt + 0.5 : steps.length
  const cycle = stepsShown * W_STEP + (cut ? LOST_S : 0) + RESULT_S
  return { store, rk, cut, rate, life, spread, steps, cutAt, stepsShown, cycle, after: afterCut(store, cutAt) }
}

function flashCell(root: THREE.Object3D, x: number) {
  const parent = add(root, new THREE.Group())
  box(parent, [CELL_W + 0.4, 2.4, 0.5], trayMat(), [x, CELLS.y, -0.5])
  const m = glowMat(RING, 0.6)
  const fill = slab(parent, m, 0, 0.3)
  const text = liveLabel(parent, [x, CELLS.y, 0.4], { size: 0.45 })
  const tag = liveLabel(parent, [x, CELLS.y - 1.9, 0], { size: 0.38 })
  return (f: number, color: string, label: string, tagText: string, tagColor = GREY, shown = true) => {
    parent.visible = shown
    fill(x - CELL_W / 2, x - CELL_W / 2 + CELL_W * f, CELLS.y, 2, m)
    setGlow(m, color, 0.6)
    m.color.set(color)
    text.set(label, f > 0.5 ? '#14161b' : GREY)
    tag.set(tagText, tagColor)
  }
}

export const littleFs: Lesson = {
  id: 'memory-storage-littlefs',
  title: 'LittleFS',
  tagline: 'Files and settings on flash that wears out',
  formula: (p) => {
    const F = fsSetup(p)
    return `life = ${ENDURANCE / 1000} k erases × ${F.spread.sectors} sector${F.spread.sectors > 1 ? 's' : ''} × ${F.spread.perErase} write${F.spread.perErase > 1 ? 's' : ''} per erase ÷ ${RATE_TEXT[F.rk]} = ${spanText(F.life / 3600)} · bars: that whole life time-lapsed into ${LAPSE_S} s · bottom: one update, slowed down`
  },
  legend: [
    { color: POWER, label: 'Erase count: fresh → worn (red)', shape: 'dot' },
    { color: RING, label: 'The value being saved', shape: 'dot' },
    { color: FORCE, label: 'LittleFS metadata pair', shape: 'dot' },
    { color: HIGH_V, label: 'Torn write / lost data', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'NOR flash can turn 1s into 0s a byte at a time, but only erasing a whole 4 KB sector turns them back to 1s. Each sector survives about 100 000 erases before bits stop holding (why: Semiconductors → Memory cell → Flash floating gate).',
    'Rewriting one value in place (EEPROM-style) erases the same sector every time: once a second, it is worn out in about a day.',
    'LittleFS never overwrites: a changed file goes to a fresh block, and blocks are handed out in rotation, so erases spread over the whole partition (352 sectors in the default scheme) and the chip lasts hundreds of times longer.',
    'That copy-on-write also makes it power-loss safe. The old block stays valid until a small metadata commit (written twice, with a checksum) points at the new one; pull the plug before that and a reboot simply finds the old file.',
    'An in-place rewrite has no such fallback: erase first, then program, and a cut in between leaves a blank sector.',
    'NVS (Preferences in Arduino) is for small settings: each put appends a 32-byte key-value entry to a 4 KB page, marked writing → written, and the old entry is marked erased. A sector is erased only when a page is full, every 126 writes, so it wears slowest of all.',
  ],
  controls: [
    { kind: 'choice', key: 'store', options: opts(STORES), initial: 'littlefs' },
    { kind: 'choice', key: 'rate', options: (Object.keys(RATES) as (keyof typeof RATES)[]).map((k) => ({ value: k, label: RATE_TEXT[k] })), initial: 'sec' },
    { kind: 'choice', key: 'cut', options: opts(CUTS), initial: 'no' },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const pitch = (BAR.x1 - BAR.x0) / SHOWN
    const bx = (i: number) => BAR.x0 + (i + 0.5) * pitch
    box(scene, [BAR.x1 - BAR.x0 + 0.6, 1.6, 0.5], trayMat(), [(BAR.x0 + BAR.x1) / 2, BAR.y, -0.5])
    const tiles = Array.from({ length: SHOWN }, (_, i) => {
      const m = glowMat(DARK, 0.2)
      const o = add(scene, mesh(new THREE.BoxGeometry(pitch - 0.12, 1.1, 0.3), m), [bx(i), BAR.y, 0])
      o.castShadow = false
      const bm = glowMat(POWER, 0.6)
      return { m, bm, bar: slab(scene, bm, 0, 0.4) }
    })
    const top = BAR.y + 0.8 + BAR_H
    rod(scene, [BAR.x0, top, 0], [BAR.x1, top, 0], glowMat(HIGH_V, 0.6), 0.05)
    partLetter(scene, '100 k erases: worn out', [BAR.x1, top + 0.6, 0], 0.4, HIGH_V, 'right')
    const caption = liveLabel(scene, [BAR.x0, BAR.y - 1.4, 0], { size: 0.4, align: 'left' })
    const clock = liveLabel(scene, [BAR.x0, top + 0.6, 0], { size: 0.5, align: 'left' })
    const worst = liveLabel(scene, [BAR.x1, BAR.y - 1.4, 0], { size: 0.4, align: 'right' })
    const oldCell = flashCell(scene, CELLS.old)
    const newCell = flashCell(scene, CELLS.new)
    const ptrMat = glowMat(FORCE, 0.9)
    const ptr = add(scene, shadowlessRod(ptrMat))
    const ptrHead = add(scene, mesh(new THREE.SphereGeometry(0.3, 12, 8), ptrMat))
    const ptrLabel = liveLabel(scene, [CELLS.old, CELLS.y + 1.6, 0], { size: 0.38, align: 'right' })
    const stepLabels = [0, 1, 2].map((k) => liveLabel(scene, [-2, CELLS.y + 1.2 - k * 0.95, 0], { size: 0.42, align: 'left' }))
    const result = liveLabel(scene, [-2, CELLS.y - 2, 0], { size: 0.48, align: 'left' })
    const code = codeBlock(scene, [-24.5, 12.4, 0], 0.38, 3)
    const s = { key: '', t: 0, w: 0, k: 0 }
    return {
      scene,
      view: { center: [0, 3, 0], radius: 86, polar: 1.45, azimuth: 0.05 },
      frame(dt, p) {
        const F = fsSetup(p)
        const key = `${F.store}|${F.rk}|${F.cut}`
        if (key !== s.key) Object.assign(s, { key, t: 0, w: 0, k: 0 })
        s.t += dt
        s.w += dt
        if (s.t > LAPSE_S + LAPSE_HOLD) s.t = 0
        if (s.w > F.cycle) {
          s.w = 0
          if (!F.cut || F.after !== 'old') s.k++
        }
        const simS = (Math.min(s.t, LAPSE_S) / LAPSE_S) * F.life
        const writes = simS * F.rate
        let most = 0
        const live = F.store === 'raw' ? 0 : F.store === 'littlefs' ? 2 + (s.k % (SHOWN - 2)) : 0
        tiles.forEach(({ m, bm, bar }, i) => {
          const e = erasesOf(F.store, writes, i)
          most = Math.max(most, e)
          const u = Math.min(1, e / ENDURANCE)
          bar(bx(i) - pitch * 0.32, bx(i) + pitch * 0.32, BAR.y + 0.8 + (u * BAR_H) / 2, u * BAR_H, bm)
          setGlow(bm, wearColor(u), 0.7)
          bm.color.set(wearColor(u))
          const used = i < F.spread.sectors
          const color = !used ? DARK : F.store === 'littlefs' && i < 2 ? FORCE : i === live ? RING : F.store === 'nvs' ? POWER : i % 7 < 3 ? DATA_COLOR : DARK
          setGlow(m, color, i === live && used ? 1 : used ? 0.35 : 0.1)
        })
        caption.set(
          F.store === 'raw' ? 'one fixed sector, rewritten in place' : F.store === 'littlefs' ? `${SHOWN} of ${F.spread.sectors} sectors (4 KB) in the littlefs partition` : `nvs partition: ${F.spread.sectors} pages × 126 entries`,
          GREY,
        )
        clock.set(`${spanText(simS / 3600)} · ${Math.round(writes).toLocaleString('en')} writes`, LABEL)
        worst.set(`most-worn sector: ${Math.round(most).toLocaleString('en')} erases`, wearColor(most / ENDURANCE))

        const u = s.w / W_STEP
        const lost = F.cut && u >= F.stepsShown && u < F.stepsShown + LOST_S / W_STEP
        const done = u >= F.stepsShown + (F.cut ? LOST_S / W_STEP : 0)
        const idx = Math.min(F.steps.length - 1, Math.floor(u))
        const into = Math.min(1, u - Math.floor(u))
        const torn = F.cut && (lost || done)
        const vOld = 41 + s.k
        const vNew = vOld + 1
        const stepDone = (k: number) => (torn ? k < F.cutAt : u >= k + 1 || done)
        const inStep = (k: number) => !done && !lost && idx === k
        const progress = (k: number) => (stepDone(k) ? 1 : inStep(k) ? into : torn && k === F.cutAt ? 0.5 : 0)
        const valid = torn ? F.after : done ? 'new' : 'old'
        if (F.store === 'raw') {
          const erased = progress(0)
          const prog = progress(1)
          const blank = erased >= 1 && prog < 1
          oldCell(
            erased < 1 ? 1 - erased : prog,
            torn ? HIGH_V : erased < 1 ? RING : POWER,
            erased < 1 ? `count = ${vOld}` : prog > 0 && !torn ? `count = ${vNew}` : blank ? 'FF FF FF FF' : `count = ${vNew}`,
            'sector 0, in place',
          )
          newCell(0, DARK, '', '', GREY, false)
        } else {
          const p0 = progress(0)
          const newText = F.store === 'nvs' ? `count = ${vNew}` : `"${vNew}"`
          const oldText = F.store === 'nvs' ? `count = ${vOld}` : `"${vOld}"`
          const freed = progress(2) >= 1
          oldCell(1, freed ? '#4a4f5a' : RING, oldText, freed ? (F.store === 'nvs' ? 'entry: erased' : 'block: free') : F.store === 'nvs' ? 'entry: written' : 'block A: live', freed ? GREY : POWER)
          newCell(
            p0,
            torn && valid === 'old' ? HIGH_V : POWER,
            p0 > 0 ? newText : '',
            p0 <= 0 ? (F.store === 'nvs' ? 'entry: empty' : 'block B: free') : torn && valid === 'old' ? 'torn: ignored on boot' : F.store === 'nvs' ? (progress(1) >= 1 ? 'entry: written' : 'entry: writing') : progress(1) >= 1 ? 'block B: live' : 'block B: unreferenced',
            torn && valid === 'old' ? HIGH_V : progress(1) >= 1 ? POWER : GREY,
          )
        }
        const showPtr = F.store === 'littlefs'
        const toX = showPtr && progress(1) >= 1 ? CELLS.new : CELLS.old
        const py = CELLS.y + 2.1
        stretchRod(ptr, [CELLS.old - 5, CELLS.y + 1.8, 0.3], [toX, py, 0.3], 0.07)
        ptr.visible = ptrHead.visible = showPtr
        ptrHead.position.set(toX, py, 0.3)
        ptrLabel.group.position.x = CELLS.old - 5.4
        ptrLabel.set(showPtr ? 'metadata' : '', FORCE)
        stepLabels.forEach((l, k) => {
          const st = F.steps[k]
          if (!st) return l.set('')
          const cutHere = torn && k === F.cutAt
          l.set(`${k + 1}. ${st}${cutHere ? ': CUT' : ''}`, cutHere ? HIGH_V : stepDone(k) ? POWER : inStep(k) ? LABEL : GREY)
        })
        result.set(
          lost ? 'power lost mid-write!' : done ? (torn ? (F.after === 'lost' ? 'reboot reads FF FF FF FF: value lost!' : `reboot reads count = ${vOld}: old value safe`) : `saved: count = ${vNew}`) : '',
          lost ? HIGH_V : torn ? (F.after === 'lost' ? HIGH_V : POWER) : POWER,
        )
        code([...STORE_CODE[F.store], `// ${F.steps.join(' → ')}`])
      },
      readouts: (p) => {
        const F = fsSetup(p)
        const years = F.life / 3600 / 8766
        return [
          { label: 'Lifetime', value: spanText(F.life / 3600), tone: years > 10 ? 'ok' : years > 1 ? 'warn' : 'bad' },
          { label: 'Erases spread', value: `${F.spread.sectors} sector${F.spread.sectors > 1 ? 's' : ''}, an erase per ${F.spread.perErase > 1 ? `${F.spread.perErase} writes` : 'write'}` },
          { label: 'If power cuts', value: F.after === 'lost' ? 'value lost' : 'old value kept', tone: F.after === 'lost' ? 'bad' : 'ok' },
        ]
      },
    }
  },
}
