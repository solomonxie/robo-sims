import * as THREE from 'three/webgpu'
import { CAN_CM_RANGE, CAN_RECESSIVE_V, CAN_RX_THRESHOLD, CAN_TERM, CanFieldSpan, canArbitrate, canFrame, canLink, canLoad, idBits, motorNoise } from '../../core/physics'
import { hexByte, secs, volts } from '../../core/units'
import { V3, add, box, cylinder, mat, mesh, rod } from '../../models/kit'
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
  LOW_V,
  POWER,
  RING,
  captureScreen,
  codeBlock,
  glowMat,
  i2cBreakout,
  litWire,
  liveLabel,
  memoBy,
  motorCan,
  partLetter,
  resistorAlong,
  setGlow,
  signalWire,
} from '../fx'
import { Lesson, Params, Stage, pick } from '../types'

const BAUD = 500e3
const NODES = ['base', 'shoulder', 'elbow', 'wrist'] as const
const NODE_COLORS = [HEAT, DATA_COLOR, CLK_COLOR, FORCE]
const BUS_M = 4
const SPARK = new THREE.Color(HEAT)
const hexId = (id: number) => `0x${id.toString(16).toUpperCase().padStart(3, '0')}`
/** Bus volts → potential colour fraction, −1…7 V spans the transceiver's common-mode range. */
const vf = (v: number) => (v + 1) / 8

// --- Shared scene: a 4-joint robot arm, one ESP32 + SN65HVD230 node per joint, the twisted pair along the arm. ---

const JOINTS: [number, number][] = [
  [-21, -1],
  [-21, 5],
  [-13, 9.3],
  [-5, 7],
  [-0.5, 3.5],
]
const NODE_AT: V3[] = [
  [-17.5, -1.6, 0.6],
  [-17.2, 4.2, 0.6],
  [-11.6, 6.2, 0.6],
  [-5.2, 3.8, 0.6],
]
const END_A: V3 = [-23.5, -1.6, 0.6]
const END_B: V3 = [-0.5, 0.2, 0.6]
const PAIR_GAP = 0.32

function offsetPath(pts: V3[], d: number): V3[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    return [p[0] - (dy / len) * d, p[1] + (dx / len) * d, p[2]]
  })
}

function armBus(scene: THREE.Object3D) {
  const metal = mat('#9aa1ad', { metal: 0.35, rough: 0.4 })
  const dark = mat('#2a2d36', { rough: 0.6 })
  box(scene, [7, 1, 4], dark, [JOINTS[0][0], JOINTS[0][1] - 0.5, -1.5])
  JOINTS.slice(0, -1).forEach((j, i) => rod(scene, [j[0], j[1], -1.5], [JOINTS[i + 1][0], JOINTS[i + 1][1], -1.5], 0.75 - i * 0.12, metal))
  JOINTS.slice(1, -1).forEach((j) => cylinder(scene, 1.1, 1.8, dark, [j[0], j[1], -1.5], 'z', 28))
  const tip = JOINTS[JOINTS.length - 1]
  for (const s of [-1, 1]) rod(scene, [tip[0], tip[1], -1.5], [tip[0] + 1.4, tip[1] + s * 0.9 - 1, -1.5], 0.22, metal)
  const route = [END_A, ...NODE_AT, END_B]
  const hPts = offsetPath(route, PAIR_GAP)
  const lPts = offsetPath(route, -PAIR_GAP)
  const canH = signalWire(scene, hPts)
  const canL = signalWire(scene, lPts)
  partLetter(scene, 'CANH', [END_A[0] - 0.7, END_A[1] + 0.5, 0.6], 0.38, HIGH_V, 'right')
  partLetter(scene, 'CANL', [END_A[0] - 0.7, END_A[1] - 0.9, 0.6], 0.38, LOW_V, 'right')
  const term = (h: V3, l: V3) => {
    const g = add(scene, new THREE.Group())
    const a: V3 = [h[0], h[1] + 0.9, h[2]]
    const b: V3 = [l[0], l[1] - 0.9, l[2]]
    signalWire(g, [h, a])(vf(CAN_RECESSIVE_V))
    signalWire(g, [l, b])(vf(CAN_RECESSIVE_V))
    resistorAlong(g, CAN_TERM, a, b, 0.75)
    partLetter(g, '120 Ω', [h[0], l[1] - 2, 0.6], 0.38, POWER)
    const off = partLetter(scene, 'no 120 Ω', [h[0], l[1] - 2, 0.6], 0.38, GREY)
    return { g, off }
  }
  const terms = [term(hPts[0], lPts[0]), term(hPts[hPts.length - 1], lPts[lPts.length - 1])]
  const nodes = NODE_AT.map((at, i) => {
    const bk = i2cBreakout(scene, [at[0], at[1] - 1.3, at[2] + 0.2], { name: 'HVD230', color: '#1d3d8f', k: 0.15, pins: ['CTX', 'CRX', 'H', 'L'] })
    const esp = mat('#1c1e24', { emissive: '#000000' }, true)
    const ex = at[0] + 2.6
    const ey = at[1] - 1.3
    box(scene, [2, 1.6, 0.4], esp, [ex, ey, at[2]])
    partLetter(scene, 'ESP32', [ex, ey - 0.15, at[2] + 0.25], 0.3, GREY)
    const name = partLetter(scene, NODES[i], i ? [at[0], at[1] + 1.1, at[2]] : [ex, at[1] + 0.6, at[2]], 0.42, NODE_COLORS[i])
    return { bk, esp, name }
  })
  return {
    terms,
    nodes,
    setBus(h: number, l: number) {
      canH(vf(h))
      canL(vf(l))
    },
  }
}

const reveal = (s: { key: string; t: number }, key: string, dt: number, run: number, hold: number) => {
  if (key !== s.key) Object.assign(s, { key, t: 0 })
  s.t = (s.t + dt) % (run + hold)
  return Math.min(1, s.t / run)
}

// --- Differential signalling: dominant pushes CANH up and CANL down; noise moves both, so H − L survives. ---

const DS_REVEAL = 7
const DS_HOLD = 2.4
const DS_FRAME = canFrame(0x121, [0x01, 0xf4])
const DS_BITS = DS_FRAME.bus.slice(0, 18)
const DS_WIN = DS_BITS.length / BAUD
const TERMS = { both: 2, one: 1, none: 0 } as const
const NOISE = { '0': 0, '1': 1, '3': 3 } as const

const dsSetup = (p: Params) => {
  const termKey = pick(TERMS, p.term, 'both')
  const noiseKey = pick(NOISE, p.noise, '3')
  const terms = TERMS[termKey]
  return { termKey, noiseKey, terms, noiseV: NOISE[noiseKey], load: canLoad(terms, NODES.length) }
}
const dsLink = memoBy(
  (p: Params) => `${p.term}|${p.noise}`,
  (p: Params) => {
    const S = dsSetup(p)
    return canLink(DS_BITS, { terms: S.terms, nodes: NODES.length, meters: BUS_M, noiseV: S.noiseV, baud: BAUD })
  },
)
/** Row 0 level that centres 2.5 V on the row 0/1 boundary and spans both rows (−1…6 V). */
const twoRow = (v: number) => -0.41 + (v - CAN_RECESSIVE_V) * 0.42
const ohmsText = (r: number) => (r >= 1000 ? `${(r / 1000).toFixed(1)} kΩ` : `${Math.round(r)} Ω`)

export const differentialSignalling: Lesson = {
  id: 'can-bus-differential-signalling',
  title: 'Differential signalling',
  tagline: 'Two wires pulled apart for 0, left together for 1',
  formula: (p) => {
    const S = dsSetup(p)
    const L = dsLink(p)
    return `Recessive (1): CANH = CANL = 2.5 V, H − L ≈ 0 · dominant (0): CANH ≈ 3.5 V, CANL ≈ 1.5 V · H − L = 3 V × ${ohmsText(S.load)} / (${ohmsText(S.load)} + 30 Ω) = ${volts(L.vDom)} · read 0 if H − L > ${volts(CAN_RX_THRESHOLD)} · noise ±${S.noiseV} V on both wires cancels · ${BAUD / 1e3} kbit/s, slowed ${Math.round(DS_REVEAL / DS_WIN).toLocaleString('en')}×`
  },
  legend: [
    { color: HIGH_V, label: 'CANH: up to 3.5 V when dominant', shape: 'dot' },
    { color: LOW_V, label: 'CANL: down to 1.5 V when dominant', shape: 'dot' },
    { color: RING, label: 'H − L: what every receiver reads', shape: 'dot' },
    { color: POWER, label: '120 Ω at each end of the bus', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'A robot arm puts a motor and a controller at every joint. CAN joins them all with one twisted pair, CANH and CANL, daisy-chained along the arm. Each node is an ESP32 (its CAN controller is called TWAI) plus a 3.3 V transceiver such as the SN65HVD230.',
    'Bits are not voltages on one wire but the gap between two. Recessive (logic 1): the transceiver lets go and both wires rest at 2.5 V. Dominant (logic 0): it pulls CANH up to ~3.5 V and CANL down to ~1.5 V, about 2 V apart.',
    'Noise from a motor or a ground offset lifts both wires by the same amount. The receiver only looks at CANH − CANL, so that common-mode part cancels; anything from −2 V to +7 V on the wires is still read correctly. Reading CANH alone against a fixed threshold fails as soon as the noise is ±1 V or more. The same idea as RS-485: see UART serial → Level and noise.',
    'Recessive is not driven: only the resistance across the pair pulls the wires back together. Fit a 120 Ω resistor at each physical end (60 Ω total). With none, the cable capacitance holds the dominant level and the 1s never arrive. With one, it works on a short bench bus, but edges reflect off the open end on a long one: see Transmission lines → Termination.',
    'Keep stubs from the trunk to each node short (< 30 cm at 500 kbit/s), twist the pair, and share a ground wire so the common-mode stays inside the transceiver’s range.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'term',
      options: [
        { value: 'both', label: '120 Ω both ends' },
        { value: 'one', label: 'One end' },
        { value: 'none', label: 'None' },
      ],
      initial: 'both',
    },
    {
      kind: 'choice',
      key: 'noise',
      options: [
        { value: '0', label: 'Quiet' },
        { value: '1', label: 'Noise ±1 V' },
        { value: '3', label: 'Noise ±3 V' },
      ],
      initial: '3',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const arm = armBus(scene)
    const motor = motorCan(scene, [-16, 12.6, -0.5], { r: 0.9, legs: 0.3 })
    partLetter(scene, 'motor', [-17.6, 12.4, 0], 0.4, GREY, 'right')
    const sparks = [-1, 0, 1].map((d) =>
      litWire(scene, [[-15.6 + d * 0.5, 11.5, 0.6], [-15.2 + d * 0.9 + 0.3, 10.2, 0.6], [-14.8 + d * 1.2 - 0.3, 8.6, 0.6], [-14.4 + d * 1.5, 6.9, 0.6]], 0.08),
    )
    // voltage ladder: where CANH and CANL sit right now
    const lx = 8.5
    const yOfV = (v: number) => -5 + (v - CAN_CM_RANGE[0]) * 1.15
    rod(scene, [lx, yOfV(CAN_CM_RANGE[0]), 0], [lx, yOfV(CAN_CM_RANGE[1]), 0], 0.06, mat('#46645a', { emissive: '#1a2a24' }))
    for (const v of [-2, 0, 2.5, 5, 7]) {
      rod(scene, [lx - 0.3, yOfV(v), 0], [lx + 0.3, yOfV(v), 0], 0.05, mat('#46645a'))
      partLetter(scene, `${v} V`, [lx - 0.6, yOfV(v) - 0.15, 0], 0.32, GREY, 'right')
    }
    partLetter(scene, 'receiver input', [lx, yOfV(7) + 0.8, 0], 0.4, LABEL)
    const bar = (color: string) => {
      const m = glowMat(color, 0.9)
      const o = add(scene, mesh(new THREE.BoxGeometry(3.2, 0.22, 0.25), m), [lx + 2, 0, 0.2])
      o.castShadow = false
      return { o, tag: liveLabel(scene, [lx + 3.9, 0, 0.2], { size: 0.4, align: 'left' }) }
    }
    const hBar = bar(HIGH_V)
    const lBar = bar(LOW_V)
    const span = add(scene, mesh(new THREE.BoxGeometry(0.16, 1, 0.16), glowMat(RING, 1)), [lx + 2, 0, 0.3])
    span.castShadow = false
    const diffTag = liveLabel(scene, [lx + 2, yOfV(-2) - 1.1, 0], { size: 0.46 })
    const scr = captureScreen(
      scene,
      [-3, -12.4, 0],
      [
        { label: 'H  L', color: LABEL },
        { label: '', color: LABEL },
        { label: 'H − L', color: RING },
      ],
      { width: 30, rowH: 1.5, decoder: true },
    )
    const chH = scr.channel(0, { color: HIGH_V, samples: 400 })
    const chL = scr.channel(0, { color: LOW_V, samples: 400 })
    const chD = scr.channel(2, { samples: 400 })
    const thr = add(scr.group, mesh(new THREE.BoxGeometry(scr.width, 0.05, 0.05), glowMat(RING, 0.4)), [0, scr.yOf(2, CAN_RX_THRESHOLD / 3), 0.1])
    thr.castShadow = false
    const code = codeBlock(scene, [-26, -7, 0], 0.36, 4)
    const s = { key: '', t: 0, wall: 0 }
    return {
      scene,
      view: { center: [-4.5, -0.5, 0], radius: 76, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const S = dsSetup(p)
        const L = dsLink(p)
        const prog = reveal(s, `${S.termKey}|${S.noiseKey}`, dt, DS_REVEAL, DS_HOLD)
        s.wall += dt
        const n = L.h.length
        const iAt = Math.min(n - 1, Math.floor(prog * n))
        const at = (arr: number[]) => (u: number) => arr[Math.min(n - 1, Math.floor(Math.min(u, prog) * n))]
        const head = prog < 1 ? prog : null
        chH.draw((u) => twoRow(at(L.h)(u)), head)
        chL.draw((u) => twoRow(at(L.l)(u)), head)
        chD.draw((u) => at(L.diff)(u) / 3, head)
        const bitNow = Math.floor(prog * DS_BITS.length)
        scr.annotate(
          L.read
            .map((r, b) => ({ r, b }))
            .filter(({ b }) => b < bitNow || prog >= 1)
            .map(({ r, b }) => ({ u0: b / DS_BITS.length, u1: (b + 1) / DS_BITS.length, text: String(r), color: r === DS_BITS[b] ? POWER : HIGH_V })),
        )
        const h = L.h[iAt]
        const l = L.l[iAt]
        arm.setBus(h, l)
        arm.terms.forEach((t, i) => {
          t.g.visible = i < S.terms
          t.off.visible = i >= S.terms
        })
        const tx = DS_BITS[Math.min(DS_BITS.length - 1, bitNow)]
        arm.nodes.forEach((nd, i) => {
          const sender = i === 0
          nd.bk.chip(sender ? HEAT : POWER, prog < 1 && (sender ? tx === 0 : true) ? 0.8 : 0.1)
          nd.esp.emissive.set(sender ? HEAT : '#000000')
          nd.esp.emissiveIntensity = sender && prog < 1 ? 0.35 : 0
        })
        const noisy = S.noiseV > 0
        motor.group.rotation.z += noisy ? dt * 6 : 0
        sparks.forEach((w, k) => w.set(noisy ? 0.4 + 0.6 * Math.abs(motorNoise(s.wall * 1e-4 + k * 1e-5)) : 0, SPARK))
        hBar.o.position.y = yOfV(h)
        lBar.o.position.y = yOfV(l)
        hBar.tag.group.position.y = yOfV(h) + 0.3
        lBar.tag.group.position.y = yOfV(l) - 0.8
        hBar.tag.set(`CANH ${volts(h)}`, HIGH_V)
        lBar.tag.set(`CANL ${volts(l)}`, LOW_V)
        const d = L.diff[iAt]
        span.position.y = (yOfV(h) + yOfV(l)) / 2
        span.scale.y = Math.max(0.05, Math.abs(yOfV(h) - yOfV(l)))
        diffTag.set(`H − L = ${volts(d)} → ${d > CAN_RX_THRESHOLD ? '0 dominant' : '1 recessive'}`, RING)
        code([
          'twai_driver_install(&g, &t, &f);',
          '  // g: GPIO5 → CTX, CRX → GPIO4; t: 500 kbit/s',
          'twai_start();',
          `// rx errors so far: ${L.errors}`,
        ])
      },
      readouts: (p) => {
        const S = dsSetup(p)
        const L = dsLink(p)
        return [
          { label: 'Load across pair', value: ohmsText(S.load), tone: S.terms === 2 ? 'ok' : S.terms === 1 ? 'warn' : 'bad' },
          { label: 'Recessive return', value: `τ = ${secs(L.tau.rec)} (bit ${secs(1 / BAUD)})`, tone: L.tau.rec < 0.2 / BAUD ? 'ok' : 'bad' },
          { label: 'Differential read', value: L.errors ? `${L.errors} / ${DS_BITS.length} bits wrong` : 'all bits right', tone: L.errors ? 'bad' : 'ok' },
          { label: 'CANH alone', value: L.singleErrors ? `${L.singleErrors} / ${DS_BITS.length} bits wrong` : 'all bits right', tone: L.singleErrors ? 'bad' : 'ok' },
        ]
      },
    }
  },
}

// --- Arbitration: everyone starts together; dominant 0 wins each bit, so the lowest ID is still sending after the ID field. ---

const AR_REVEAL = 10
const AR_HOLD = 3
type Tx = { node: number; id: number; data: number[]; what: string }
const SENDERS: Record<string, Tx[]> = {
  joints: [
    { node: 1, id: 0x124, data: [0x03, 0x84], what: 'shoulder 90.0°' },
    { node: 2, id: 0x121, data: [0x01, 0xf4], what: 'elbow 50.0°' },
    { node: 3, id: 0x130, data: [0x00, 0xc8], what: 'wrist 20.0°' },
  ],
  estop: [
    { node: 0, id: 0x010, data: [0x01], what: 'E-STOP' },
    { node: 1, id: 0x124, data: [0x03, 0x84], what: 'shoulder 90.0°' },
    { node: 2, id: 0x121, data: [0x01, 0xf4], what: 'elbow 50.0°' },
    { node: 3, id: 0x130, data: [0x00, 0xc8], what: 'wrist 20.0°' },
  ],
  close: [
    { node: 2, id: 0x121, data: [0x01, 0xf4], what: 'elbow 50.0°' },
    { node: 3, id: 0x120, data: [0x00, 0xc8], what: 'wrist 20.0°' },
  ],
}
const FIELD_TEXT = (f: CanFieldSpan) =>
  f.field === 'SOF' ? 'S' : f.field === 'ID' ? hexId(f.value) : f.field === 'CTRL' ? '' : f.field === 'DLC' ? `DLC ${f.value}` : f.field === 'DATA' ? hexByte(f.value) : f.field === 'CRC' ? `CRC ${f.value.toString(16).toUpperCase()}` : f.field === 'ACK' ? 'A' : f.field === 'EOF' ? 'EOF' : ''
const FIELD_COLOR: Record<string, string> = { SOF: GREY, ID: RING, CTRL: GREY, DLC: CLK_COLOR, DATA: DATA_COLOR, CRC: HEAT, ACK: POWER, EOF: GREY }

const arSetup = (p: Params) => {
  const key = pick(SENDERS, p.set, 'joints')
  const tx = SENDERS[key]
  const arb = canArbitrate(tx.map((t) => t.id))
  const win = tx[arb.winner]
  const frames = tx.map((t) => canFrame(t.id, t.data))
  const f = frames[arb.winner]
  return { key, tx, arb, win, frames, f, dur: f.bus.length / BAUD }
}
/** Each sender's TX line: its own frame until it loses (then recessive), receivers pull the ACK slot dominant. */
const txBits = (S: ReturnType<typeof arSetup>, i: number) => {
  const lost = S.arb.lostAt[i]
  const ack = S.f.fields.find((x) => x.field === 'ACK')!.start
  const own = i === S.arb.winner ? S.f.tx : S.frames[i].tx
  const cut = lost < 0 ? Infinity : S.f.pos[1 + lost] + 1
  return S.f.bus.map((_, b) => (i !== S.arb.winner && b === ack ? 0 : b < cut ? own[b] : 1))
}

const arLines = memoBy(
  (p: Params) => String(p.set),
  (p: Params) => {
    const S = arSetup(p)
    const ack = S.f.fields.find((x) => x.field === 'ACK')!.start
    return NODES.map((_, node) => {
      const i = S.tx.findIndex((t) => t.node === node)
      return i < 0 ? S.f.bus.map((_b, b) => (b === ack ? 0 : 1)) : txBits(S, i)
    })
  },
)

export const arbitration: Lesson = {
  id: 'can-bus-arbitration',
  title: 'Arbitration',
  tagline: 'Everyone talks at once; the lowest ID never notices',
  formula: (p) => {
    const S = arSetup(p)
    return `Bus = AND of every TX bit (0 dominant wins) · a node sending 1 that reads 0 stops at once · winner ${hexId(S.win.id)} = lowest ID · frame: 1 + 11 + 3 + 4 + ${8 * S.win.data.length} data + 15 CRC + 10 = ${S.f.rawBits} bits + ${S.f.stuffAt.length} stuff = ${S.f.bus.length} bits / ${BAUD / 1e3} kbit/s = ${secs(S.dur)} · slowed ${Math.round(AR_REVEAL / S.dur).toLocaleString('en')}×`
  },
  legend: [
    { color: RING, label: 'ID: also the priority, lower wins', shape: 'dot' },
    { color: GREY, label: 'Lost: stops sending, keeps listening', shape: 'dot' },
    { color: DATA_COLOR, label: 'Data bytes (DLC says how many)', shape: 'dot' },
    { color: POWER, label: 'ACK: every receiver pulls it dominant', shape: 'dot' },
    CODE_LEGEND,
  ],
  points: [
    'CAN has no master. Any node may start a frame once the bus has been idle, so two joints often start in the same bit time. Instead of a collision, the frame’s ID decides who carries on.',
    'The bus is a wired-AND: if any node drives dominant (0), everyone reads 0. Each node sends its ID from the top bit and reads the bus back. Sent 1 but read 0? Someone with a lower ID is sending: stop sending right there and just receive.',
    'The winner never sees a conflict: every bit it read back matched. Its frame goes through untouched, with no lost time. That is non-destructive arbitration, and it makes the ID a priority: give the e-stop 0x010 and it beats every joint update.',
    'The rest of the frame: RTR/IDE/r0 control bits, a 4-bit DLC (0–8 data bytes), the data, a CRC-15 and an ACK slot that the sender leaves recessive and every receiver pulls dominant. After five equal bits the sender inserts one opposite stuff bit so receivers keep their clocks in step.',
    'The losers retry automatically when the bus goes idle again; the TWAI hardware does it, your code just calls twai_transmit. Two nodes must never share an ID: they would both win and then clash in the data bits.',
  ],
  controls: [
    {
      kind: 'choice',
      key: 'set',
      options: [
        { value: 'joints', label: '3 joints' },
        { value: 'estop', label: '+ E-stop' },
        { value: 'close', label: '0x121 vs 0x120' },
      ],
      initial: 'joints',
    },
  ],
  build(): Stage {
    const scene = createStage({ span: 36 })
    const arm = armBus(scene)
    const tags = NODE_AT.map((at, i) => liveLabel(scene, i ? [at[0], at[1] + 2, at[2]] : [at[0] + 2.6, at[1] + 1.5, at[2]], { size: 0.38 }))
    // arbitration table: one row per node, a column per ID bit, the bus row at the bottom
    const tx0 = 6.5
    const cw = 1.05
    const ty0 = 5.4
    const rh = 1.2
    const cellGeo = new THREE.BoxGeometry(cw * 0.86, rh * 0.8, 0.3)
    const rows = [...NODES, 'bus'].map((nm, r) => {
      const y = ty0 - r * rh - (r === 4 ? 0.4 : 0)
      const name = liveLabel(scene, [tx0 - 0.8, y - 0.2, 0], { size: 0.4, align: 'right' })
      const cells = Array.from({ length: 11 }, (_, k) => {
        const m = glowMat(GREY, 0)
        const o = add(scene, mesh(cellGeo, m), [tx0 + (k + 0.5) * cw, y, 0])
        o.castShadow = false
        return { m, d: liveLabel(scene, [tx0 + (k + 0.5) * cw, y - 0.2, 0.25], { size: 0.45 }) }
      })
      return { name, cells, nm }
    })
    for (let k = 0; k < 11; k++) partLetter(scene, String(10 - k), [tx0 + (k + 0.5) * cw, ty0 + 1, 0], 0.3, GREY)
    partLetter(scene, 'ID bit', [tx0 - 0.8, ty0 + 0.85, 0], 0.32, GREY, 'right')
    const verdict = liveLabel(scene, [tx0 + 5.5 * cw, ty0 - 5 * rh - 1, 0], { size: 0.45 })
    const scr = captureScreen(
      scene,
      [-1.5, -10.9, 0],
      [...NODES.map((nm, i) => ({ label: `TX ${nm}`, color: NODE_COLORS[i] })), { label: 'bus', color: RING }],
      { width: 33, rowH: 0.98, decoder: true },
    )
    const chans = [0, 1, 2, 3, 4].map((k) => scr.channel(k, { samples: 420, radius: 0.07 }))
    const code = codeBlock(scene, [-26, -4.9, 0], 0.32, 4)
    const s = { key: '', t: 0 }
    return {
      scene,
      view: { center: [-4, -1, 0], radius: 78, polar: 1.47, azimuth: 0.06 },
      frame(dt, p) {
        const S = arSetup(p)
        const prog = reveal(s, S.key, dt, AR_REVEAL, AR_HOLD)
        const nb = S.f.bus.length
        const bf = prog * nb
        const bit = Math.floor(bf)
        const head = prog < 1 ? prog : null
        const senderOf = (node: number) => S.tx.findIndex((t) => t.node === node)
        const lines = arLines(p)
        const lv = (bits: number[]) => (u: number) => bits[Math.min(nb - 1, Math.floor(Math.min(u, prog) * nb))]
        lines.forEach((ln, node) => chans[node].draw(lv(ln), head))
        chans[4].draw(lv(S.f.bus), head)
        scr.annotate(
          S.f.fields
            .filter((f) => f.start < bit || prog >= 1)
            .filter((f) => f.field !== 'CRC DEL' && f.field !== 'ACK DEL')
            .map((f) => ({ u0: f.start / nb, u1: (f.start + f.len) / nb, text: FIELD_TEXT(f), color: FIELD_COLOR[f.field] })),
        )
        const busNow = S.f.bus[Math.min(nb - 1, bit)]
        arm.setBus(busNow ? CAN_RECESSIVE_V : 3.5, busNow ? CAN_RECESSIVE_V : 1.5)
        arm.terms.forEach((t) => (t.off.visible = false))
        const idBit = (k: number) => S.f.pos[1 + k]
        const kNow = [...Array(11).keys()].filter((k) => idBit(k) < bf).length
        arm.nodes.forEach((nd, node) => {
          const i = senderOf(node)
          const lost = i >= 0 && S.arb.lostAt[i] >= 0 && idBit(S.arb.lostAt[i]) < bf
          const won = i === S.arb.winner && kNow === 11
          const col = i < 0 ? GREY : lost ? GREY : won ? POWER : NODE_COLORS[node]
          nd.bk.chip(col, i < 0 || lost ? 0.1 : 0.8)
          setGlow(nd.esp, col, i < 0 || lost ? 0 : 0.35)
          tags[node].set(
            i < 0 ? 'listening' : lost ? `lost at bit ${10 - S.arb.lostAt[i]} · listens` : won ? `won · ${hexId(S.tx[i].id)}` : `sends ${hexId(S.tx[i].id)}`,
            i < 0 || lost ? GREY : won ? POWER : NODE_COLORS[node],
          )
        })
        rows.forEach((row, r) => {
          const i = r < 4 ? senderOf(r) : -1
          row.name.set(r < 4 ? `${row.nm} ${i >= 0 ? hexId(S.tx[i].id) : '—'}` : 'bus', r === 4 ? RING : i >= 0 ? NODE_COLORS[r] : GREY)
          const bits = r === 4 ? S.arb.bus : i >= 0 ? idBits(S.tx[i].id) : []
          row.cells.forEach((c, k) => {
            const shown = k < kNow && bits.length > 0
            const lostK = i >= 0 ? S.arb.lostAt[i] : -1
            const out = lostK >= 0 && k > lostK
            const here = lostK === k
            c.d.set(shown && !out ? String(bits[k]) : '', here ? HIGH_V : LABEL)
            setGlow(c.m, !shown || out ? '#1c1e24' : r === 4 ? RING : here ? HIGH_V : NODE_COLORS[r], shown && !out ? (bits[k] ? 0.12 : 0.55) : 0)
          })
        })
        verdict.set(
          kNow < 11 ? `ID bit ${10 - Math.min(10, kNow)}: bus = AND of all senders` : `${hexId(S.win.id)} wins: ${S.win.what}`,
          kNow < 11 ? GREY : POWER,
        )
        code([
          `twai_message_t m = {.identifier = ${hexId(S.win.id)},`,
          `  .data_length_code = ${S.win.data.length}, .data = {${S.win.data.map(hexByte).join(', ')}}};`,
          'twai_transmit(&m, pdMS_TO_TICKS(10));',
          '// lost arbitration? TWAI resends by itself',
        ])
      },
      readouts: (p) => {
        const S = arSetup(p)
        const losers = S.tx.filter((_, i) => i !== S.arb.winner)
        return [
          { label: 'Winner', value: `${hexId(S.win.id)} ${NODES[S.win.node]}`, tone: 'ok' },
          { label: 'Backed off', value: losers.map((t) => hexId(t.id)).join(', ') },
          { label: 'Frame', value: `${S.f.bus.length} bits · ${secs(S.dur)}` },
        ]
      },
    }
  },
}
