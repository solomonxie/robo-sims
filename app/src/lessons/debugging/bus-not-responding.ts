import {
  ADDR_FAULTS,
  ADDR_HUNT,
  ADDR_PROBES,
  AddrFault,
  AddrProbe,
  BUS_BOT,
  FaultHunt,
  I2C_MODES,
  INTERNAL_PULL_OHMS,
  PULL_FAULTS,
  PULL_HUNT,
  PULL_PROBES,
  PullFault,
  PullProbe,
  busFarads,
  i2cRiseTime,
  lowVolts,
  missingPullups,
  once,
  openDrainClock,
  pullupMax,
  pullupMin,
  wireAddressByte,
  wrongAddress,
} from '../../core/physics'
import { hexByte, millivolts, ohms, si } from '../../core/units'
import { BusPart, BusTp, BusTrace, FACE_VIEW, GREY, HIGH_V, HUNT_HOWTO, HUNT_LEGEND, POWER, busBench, busCapture, huntKit, huntRig, huntStage } from '../fx'
import { Lesson, Stage } from '../types'

type Bench = ReturnType<typeof busBench>
interface Tip {
  red: BusTp | BusPart
  black: BusTp
}

const V = (v: number) => si(v, 'V', 2)
const T = (s: number) => si(s, 's', 3)
const pF = (c: number) => si(c, 'F', 3)
const VDD = BUS_BOT.vdd
const SERIAL = { red: 'usb', black: 'gnd' } as const

interface BusSpec<F extends string, P extends string> {
  hunt: FaultHunt<F, P>
  kit: ReturnType<typeof huntKit<F, P>>
  oled: boolean
  tips: Record<P, Tip>
  parts: Record<F, BusPart>
  symptom: string
  hint: string
  fixes: Record<F, string>
  /** Capture for the probe: this case and healthy, the span, an optional zoom, two text lines; null = a meter probe. */
  capture: (truth: F, probe: P) => { got: BusTrace | null; ok: BusTrace | null; span: string; range?: [number, number]; stats: string; log: string; tone?: string } | null
  extra: (bench: Bench, truth: F, found: boolean) => void
}

/** Shared stage: I²C bench, meter, suspect table, and a logic analyser for what the meter can't show. */
function busBuild<F extends string, P extends string>(s: BusSpec<F, P>, colW: number): Stage {
  const { scene, header } = huntStage()
  const bench = busBench(scene, { oled: s.oled })
  const cap = busCapture(scene, [9.5, -6.2, 0], 4.4, 2.6)
  let shown = ''
  const rig = huntRig<F, P, BusTp, BusPart, Tip>(scene, header, {
    ...s,
    bench,
    table: { colW, nameW: 4.6 },
    extra({ q, found }) {
      s.extra(bench, q.truth, found)
      const key = `${q.truth}|${q.probe}`
      if (key === shown) return
      shown = key
      const c = s.capture(q.truth, q.probe)
      if (!c) {
        cap.show(null, null, '')
        cap.stats('Meter on the bench', GREY)
        cap.log('')
        return
      }
      cap.show(c.got, c.ok, c.span, c.range)
      cap.stats(c.stats, c.tone)
      cap.log(c.log)
    },
  })
  return { scene, view: FACE_VIEW, ...rig }
}

// --- Wrong address ---

const adKit = huntKit(ADDR_HUNT, ADDR_FAULTS, ADDR_PROBES, 101)
const wa = (f: AddrFault | 'ok') => wrongAddress(f)
const wireByte = wireAddressByte(BUS_BOT.datasheet8bit)
const adFixes = (): Record<AddrFault, string> => ({
  ad0: `AD0 tied to 3V3: the IMU answers at ${hexByte(wa('ad0').setup.sensor!)} (the scanner lists it), not ${hexByte(BUS_BOT.imu)}. Pull AD0 low, or call ${hexByte(wa('ad0').setup.sensor!)}`,
  eight: `Code passes the datasheet's 8-bit ${hexByte(BUS_BOT.datasheet8bit)}: Wire shifts it again, byte ${hexByte(wireByte)} = address ${hexByte(wa('eight').frame.addr)}. Use the 7-bit ${hexByte(BUS_BOT.imu)}`,
  swap: `SCL and SDA crossed at the IMU: 21 ↔ its SDA pin reads ${ohms(wa('swap').reads.sda.value)} (both pull-ups via 3V3). Swap them back`,
  vcc: `IMU VCC jumper loose: 0 V on its VCC, so only the OLED (${hexByte(BUS_BOT.oled)}) answers. Reseat it; the power LED should light`,
})

/** Zoom for the frame: START, the address byte, its ACK slot (and the STOP after a NACK). */
const ADDR_RANGE: [number, number] = [(BUS_BOT.pad.before - 1) * BUS_BOT.perQ, (BUS_BOT.pad.before + 54) * BUS_BOT.perQ]

export const busNotRespondingWrongAddress: Lesson = {
  id: 'bus-not-responding-wrong-address',
  title: 'Wrong address',
  tagline: 'The IMU never ACKs: a strapped address pin, the 8-bit address in code, crossed lines or no power?',
  formula: (p) => {
    const q = adKit.params(p)
    if (q.guess === q.truth && q.truth === 'eight') return `Wire sends (address << 1) | R/W in 8 bits: (${hexByte(BUS_BOT.datasheet8bit)} << 1) & 0xFF = ${hexByte(wireByte)} → address ${hexByte(wa('eight').frame.addr)}: nobody there, NACK`
    if (q.guess === q.truth && q.truth === 'swap') return `Power off, crossed: R(21 → IMU SDA) = 4.7 kΩ + 4.7 kΩ via 3V3 = ${ohms(wa('swap').reads.sda.value)} (a wire: ~0 Ω)`
    return `MPU-6050: 0x68 + AD0 → ${hexByte(BUS_BOT.imu)} (AD0 low) / ${hexByte(BUS_BOT.imu + 1)} (high) · first byte = address << 1 | R/W = ${hexByte(wireAddressByte(BUS_BOT.imu))} write`
  },
  legend: HUNT_LEGEND,
  points: [
    HUNT_HOWTO,
    'An I²C device answers only its 7-bit address: the ESP32 sends START, the address with R/W in bit 0, then lets SDA go for a 9th clock and the device pulls it low (ACK). Nobody home: SDA stays high (NACK), Wire.endTransmission() returns 2 and reads come back 0xFF (Microcontrollers › I²C).',
    `An I²C scanner calls every address 0x08–0x77 and prints who ACKs: the first test for any bus fault. Here the OLED at ${hexByte(BUS_BOT.oled)} answers too, so the ESP32, the pull-ups and the lanes work; the fault is at the IMU.`,
    `The MPU-6050’s AD0 pin picks the address: low ${hexByte(BUS_BOT.imu)}, high ${hexByte(BUS_BOT.imu + 1)} (so two fit on one bus). Datasheets often print the 8-bit form (${hexByte(BUS_BOT.datasheet8bit)} write, ${hexByte(BUS_BOT.datasheet8bit + 1)} read); Wire wants 7 bits and shifts them itself, so ${hexByte(BUS_BOT.datasheet8bit)} goes out as ${hexByte(wireByte)}: address ${hexByte(wa('eight').frame.addr)}. A logic analyser shows the address actually sent.`,
    `Crossed lines and a dead sensor both just NACK, so meter them. Power off, GPIO 21 ↔ the IMU’s SDA pin should be a wire (~0 Ω); crossed, it reads the two 4.7 kΩ pull-ups in series via 3V3, ${ohms(wa('swap').reads.sda.value)}. VCC at the breakout should read ${V(VDD)}.`,
  ],
  controls: adKit.controls,
  build: () =>
    busBuild<AddrFault, AddrProbe>(
      {
        hunt: ADDR_HUNT,
        kit: adKit,
        oled: true,
        tips: { scan: SERIAL, frame: SERIAL, ad0: { red: 'sAd0', black: 'sGnd' }, vcc: { red: 'sVcc', black: 'sGnd' }, sda: { red: 'gpio21', black: 'sSda' } },
        parts: { ad0: 'ad0', eight: 'esp', swap: 'wires', vcc: 'vcc' },
        symptom: 'MPU-6050 not found: Wire.endTransmission() returns 2 (NACK), reads 0xFF',
        hint: 'Hint: run the scanner, capture the frame, then meter AD0, VCC and the SDA wire',
        fixes: adFixes(),
        capture(truth, probe) {
          if (probe === 'scan') {
            const found = wa(truth).scan
            return { got: null, ok: null, span: '', stats: `Scanner found: ${found.length ? found.map(hexByte).join(', ') : 'nothing'}`, log: 'Serial monitor · Wire at 100 kHz', tone: found.length === 2 && found.includes(BUS_BOT.imu) ? POWER : HIGH_V }
          }
          if (probe !== 'frame') return null
          const f = wa(truth).frame
          return { got: f, ok: wa('ok').frame, span: '100 kHz', range: ADDR_RANGE, stats: `endTransmission() = ${f.acks ? 0 : 2} · ${f.text}`, log: 'grey healthy · cyan this case', tone: f.acks ? POWER : HIGH_V }
        },
        extra(bench, truth, found) {
          bench.ad0(found && truth === 'ad0')
          bench.swap(found && truth === 'swap')
          bench.power(!(found && truth === 'vcc'))
        },
      },
      3.4,
    ),
}

// --- Missing pull-ups ---

const puKit = huntKit(PULL_HUNT, PULL_FAULTS, PULL_PROBES, 103)
const mp = (f: PullFault | 'ok') => missingPullups(f)
const PU = once(() => {
  const short = busFarads(BUS_BOT.shortM, 1)
  const long = busFarads(BUS_BOT.longM, 1)
  const fast = I2C_MODES.fast
  return {
    short,
    long,
    okRise: i2cRiseTime(BUS_BOT.pullOhms, short),
    intRise: i2cRiseTime(INTERNAL_PULL_OHMS, short),
    longRise: i2cRiseTime(BUS_BOT.pullOhms, long),
    intTop: openDrainClock(fast.hz, INTERNAL_PULL_OHMS, short).top,
    longTop: openDrainClock(fast.hz, BUS_BOT.pullOhms, long).top,
    rMin: pullupMin(VDD),
    rMax: pullupMax(long, fast),
    held: lowVolts(BUS_BOT.pullOhms, VDD),
  }
})
const puFixes = (): Record<PullFault, string> => ({
  none: `No pull-up resistors fitted: only the ESP32's internal 45 kΩ. SCL rises in ${T(PU().intRise)}, tops at ${V(PU().intTop)} at 400 kHz. Fit 4.7 kΩ to 3V3 on both lines`,
  scl: `SCL's 4.7 kΩ is missing: SCL on the internal 45 kΩ rises in ${T(PU().intRise)} (SDA is fine). Fit it back`,
  cable: `4 m of lead: ${pF(PU().long)} on the bus, 4.7 kΩ rises in ${T(PU().longRise)} > 300 ns. Run 100 kHz, or pull-ups of ${ohms(PU().rMin)}–${ohms(PU().rMax)}`,
  held: `The IMU holds SDA at ${millivolts(PU().held)} (reset mid-read): no START at any speed. Toggle SCL 9 times at boot, or power-cycle it`,
})
/** Zoom for the rise probe: from the START over the first three clocks. */
const RISE_RANGE: [number, number] = [(BUS_BOT.pad.before - 1) * BUS_BOT.perQ, (BUS_BOT.pad.before + 15) * BUS_BOT.perQ]

export const busNotRespondingMissingPullUps: Lesson = {
  id: 'bus-not-responding-missing-pull-ups',
  title: 'Missing pull-ups',
  tagline: 'Fine at 100 kHz, dead at 400 kHz, or dead at any speed: who pulls the lines back up, and how fast?',
  formula: (p) => {
    const q = puKit.params(p)
    const u = PU()
    if (q.guess === q.truth && q.truth === 'cable') return `C = 10 + 15 + 10 pF + 60 pF/m × 4 m = ${pF(u.long)} → t_r = 0.85 × 4.7 kΩ × ${pF(u.long)} = ${T(u.longRise)} · 300 ns needs R ≤ ${ohms(u.rMax)}`
    if (q.guess === q.truth && (q.truth === 'none' || q.truth === 'scl')) return `t_r = 0.85 × 45 kΩ × ${pF(u.short)} = ${T(u.intRise)} · a 400 kHz half-clock is 1.25 µs: SCL tops at ${V(u.intTop)} < 0.7 × 3.3 V = ${V(0.7 * VDD)}`
    if (q.guess === q.truth && q.truth === 'held') return `SDA held low: 3.3 V × 133 Ω / (4.7 kΩ + 133 Ω) = ${millivolts(u.held)} (133 Ω = the 0.4 V at 3 mA a driver may have)`
    return `Rise 30 → 70 %: t_r = ln(7/3)·R·C = 0.85 × 4.7 kΩ × ${pF(u.short)} = ${T(u.okRise)} ≤ 300 ns (400 kHz), ≤ 1 µs (100 kHz)`
  },
  legend: HUNT_LEGEND,
  points: [
    HUNT_HOWTO,
    `I²C is open-drain: chips only ever pull SDA and SCL low. The pull-up resistor charges the bus capacitance back up, so rising edges are RC curves: 30 → 70 % takes 0.85·R·C. Spec: ≤ 1 µs at 100 kHz, ≤ 300 ns at 400 kHz. Here 4.7 kΩ × ${pF(PU().short)} = ${T(PU().okRise)} (Microcontrollers › I²C).`,
    `Without resistors, Wire.begin() leaves the ESP32’s internal ~45 kΩ pull-ups on: ${T(PU().intRise)} edges. At 100 kHz the 5 µs high half is long enough; at 400 kHz SCL tops out at ${V(PU().intTop)}, never the sensor’s 0.7 × VDD = ${V(0.7 * VDD)}, so it sees no clock. Idle, a meter shows 3.3 V either way; Ω to 3V3 with the power off finds the missing resistor (OL).`,
    `Cable adds ~60 pF/m: on 4 m the bus is ${pF(PU().long)} and the same 4.7 kΩ rises in ${T(PU().longRise)}. Stiffer pull-ups help down to ${ohms(PU().rMin)} (a driver must still pull 3 mA to 0.4 V); 300 ns here needs ≤ ${ohms(PU().rMax)}. Or run 100 kHz, or add a bus buffer.`,
    `A sensor reset in the middle of a read can keep SDA low forever: idle SDA reads ${millivolts(PU().held)} and no START is possible at any speed. Toggling SCL nine times at boot lets it finish its byte and let go.`,
  ],
  controls: puKit.controls,
  build: () =>
    busBuild<PullFault, PullProbe>(
      {
        hunt: PULL_HUNT,
        kit: puKit,
        oled: false,
        tips: { sda: { red: 'gpio21', black: 'gnd' }, rSda: { red: 'v33', black: 'gpio21' }, rScl: { red: 'v33', black: 'gpio22' }, rise: SERIAL, fast: SERIAL, slow: SERIAL },
        parts: { none: 'pulls', scl: 'pullScl', cable: 'cable', held: 'sensor' },
        symptom: 'The IMU on the robot: every read at 400 kHz fails (0xFF)',
        hint: 'Hint: SDA idle, Ω to 3V3 (power off), SCL rise on the scope, 400 vs 100 kHz',
        fixes: puFixes(),
        capture(truth, probe) {
          const m = mp(truth)
          const ok = mp('ok')
          if (probe === 'rise') {
            return {
              got: m.slow,
              ok: ok.slow,
              span: '100 kHz',
              range: RISE_RANGE,
              stats: `SCL rise ${m.rise === null ? 'never' : T(m.rise)} · 400 kHz: ≤ 300 ns`,
              log: 'grey healthy · cyan this case',
              tone: m.rise !== null && m.rise <= I2C_MODES.fast.trMax ? POWER : HIGH_V,
            }
          }
          if (probe !== 'fast' && probe !== 'slow') return null
          const f = m[probe]
          const s = probe === 'fast' ? m.fastSetup : m.slowSetup
          const top = openDrainClock(s.hz, s.sclOhms, s.farads).top
          return {
            got: f,
            ok: ok[probe],
            span: probe === 'fast' ? '400 kHz' : '100 kHz',
            stats: `${f.text} · SCL top ${V(top)} / ${V(0.7 * VDD)}`,
            log: 'grey healthy · cyan this case',
            tone: f.acks ? POWER : HIGH_V,
          }
        },
        extra(bench, truth, found) {
          bench.pulls(!(found && truth === 'none'), !(found && (truth === 'none' || truth === 'scl')))
          bench.cable(found && truth === 'cable')
        },
      },
      2.9,
    ),
}
